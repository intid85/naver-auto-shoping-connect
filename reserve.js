// 임시저장된 글 1건을 열어 태그를 정리하고 예약 시각을 넣는다.
//
// 기본은 '미리 확인' 모드: 예약 시각까지 채운 뒤 캡처를 남기고 확정하지 않고 종료한다.
// 실제로 예약을 거는 것은 --commit 을 줄 때뿐이다.
//
// 사용:
//   node reserve.js --folder "<폴더 전체 경로>" --date 2026-10-14 --time 09:00 --pick 1 [--category "명세톡"] [--commit]
//
// 안전장치 (하나라도 어긋나면 예약하지 않고 멈춘다):
//   - 열린 글의 제목이 폴더의 제목과 같아야 한다
//   - 열린 글의 사진 수가 폴더의 사진 수와 같아야 한다
//   - 본문 맨 아래 태그 줄을 지웠다면, 실제로 지워졌는지 다시 읽어 확인한다
//   - 예약 시각이 지금보다 뒤여야 하고, 분은 10분 단위여야 한다
//   - 날짜·시·분을 넣은 뒤 화면 값을 다시 읽어 요청한 값과 같은지 확인한다
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const config = require("./config.json");
const { parseFolder } = require("./lib/parse");
const { STATE_FILE, LOG_DIR } = require("./lib/paths");
const { selectCategory, readSelectedCategory, normalize } = require("./lib/category");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const COMMIT = process.argv.includes("--commit");

function fail(message) {
  throw new Error(message);
}

function validateInputs() {
  const folder = arg("folder");
  const date = arg("date");
  const time = arg("time");
  const pick = Number(arg("pick"));
  if (!folder || !fs.existsSync(folder)) fail(`폴더를 찾지 못했습니다: ${folder}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) fail("--date 는 YYYY-MM-DD 형식이어야 합니다");
  const tm = /^(\d{2}):(\d{2})$/.exec(time || "");
  if (!tm) fail("--time 은 HH:MM 형식이어야 합니다");
  if (Number(tm[1]) > 23) fail("시는 00~23 이어야 합니다");
  if (Number(tm[2]) % 10 !== 0) fail("네이버 예약은 분을 10분 단위로만 지정할 수 있습니다 (00,10,20,30,40,50)");
  if (!Number.isInteger(pick) || pick < 0) fail("--pick 은 임시저장 목록의 위치(0부터)여야 합니다");
  const when = new Date(`${date}T${time}:00`);
  if (!(when.getTime() > Date.now() + 5 * 60 * 1000)) fail(`예약 시각이 지금보다 뒤여야 합니다: ${date} ${time}`);
  return { folder, date, hour: tm[1], minute: tm[2], pick, category: arg("category") || "" };
}

// 에디터에 열려 있는 글의 제목/문단/사진 수를 읽는다 (읽기만)
async function readDocument(frame) {
  return frame.locator("body").evaluate(() => {
    const title = (document.querySelector(".se-section-documentTitle")?.innerText || "").replace(/\s+/g, " ").trim();
    const paras = [...document.querySelectorAll(".se-section-text .se-text-paragraph")].map((p) => p.innerText.replace(/\s+/g, " ").trim());
    return { title, paras, images: document.querySelectorAll(".se-component.se-image").length };
  });
}

const lastNonEmpty = (paras) => {
  for (let i = paras.length - 1; i >= 0; i--) if (paras[i]) return { index: i, text: paras[i] };
  return null;
};

(async () => {
  const input = validateInputs();
  const post = parseFolder(input.folder);
  if (!post.title) fail("폴더에서 제목을 읽지 못했습니다");
  // 이미 예약한 글을 다시 예약하지 않는다 (예약이 끝나면 아래 표시 파일이 남는다)
  const reservedMarker = path.join(input.folder, "_네이버예약완료.txt");
  if (fs.existsSync(reservedMarker)) fail(`이미 예약한 글입니다: ${fs.readFileSync(reservedMarker, "utf8").trim()}`);
  const expectedImages = post.photos.length;
  console.log(`모드: ${COMMIT ? "★ 확정(실제 예약)" : "미리 확인(확정 안 함)"}`);
  console.log(`대상: ${post.name}\n제목: ${post.title}\n태그 ${post.tags.length}개: ${post.tags.join(" ")}\n예약: ${input.date} ${input.hour}:${input.minute}`);

  fs.mkdirSync(LOG_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] });
  let done = false;
  try {
    const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1400, height: 900 } });
    await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://blog.naver.com" }).catch(() => {});
    const page = await ctx.newPage();
    await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await sleep(5000);
    if (/nidlogin|nid\.naver\.com/.test(page.url())) fail("네이버 로그인이 만료됐습니다");
    const frame = page.frameLocator("#mainFrame");
    const cancel = frame.locator("button.se-popup-button-cancel").first();
    if (await cancel.count()) await cancel.click().catch(() => {});
    const help = frame.locator("button.se-help-panel-close-button").first();
    if (await help.count()) await help.click().catch(() => {});
    await sleep(800);

    // ① 임시저장 목록에서 글 열기 — 글 열기 버튼(article_button)만 누른다. 삭제 버튼은 선택 대상에 없다.
    await frame.locator('button[class*="save_count_btn"]').first().click();
    await sleep(2500);
    const openBtns = frame.locator('[class*="layer_popup"] button[class*="article_button"]');
    const total = await openBtns.count();
    if (input.pick >= total) fail(`임시저장 목록에 ${total}개뿐입니다`);
    const target = openBtns.nth(input.pick);
    const label = (await target.innerText()).replace(/\s+/g, " ");
    if (!label.startsWith(post.title)) fail(`목록 ${input.pick}번 글의 제목이 다릅니다: "${label}"`);
    console.log(`열기: ${label}`);
    await target.click();
    await sleep(6000);

    // ② 열린 글 검증
    let doc = await readDocument(frame);
    if (doc.title !== post.title) fail(`열린 글의 제목이 다릅니다: "${doc.title}"`);
    if (doc.images !== expectedImages) fail(`열린 글의 사진이 ${doc.images}장인데 폴더에는 ${expectedImages}장입니다 (다른 글을 열었을 수 있습니다)`);
    console.log(`검증 통과: 제목 일치, 사진 ${doc.images}장 일치`);

    // ③ 본문 맨 아래 태그 줄 삭제 (있을 때만). 지운 뒤 다시 읽어서 확인한다.
    const last = lastNonEmpty(doc.paras);
    if (last && last.text.startsWith("#")) {
      console.log(`태그 줄 발견 → 삭제: ${last.text.slice(0, 40)}…`);
      const paras = frame.locator(".se-section-text .se-text-paragraph");
      await paras.nth(last.index).click();
      await sleep(300);
      await paras.nth(last.index).click({ clickCount: 3 });
      await sleep(300);
      await page.keyboard.press("Backspace");
      await sleep(600);
      doc = await readDocument(frame);
      const after = lastNonEmpty(doc.paras);
      if (after && after.text.startsWith("#")) fail("본문의 태그 줄을 지우지 못했습니다 (예약하지 않고 멈춥니다)");
      console.log("태그 줄 삭제 확인됨");
    } else {
      console.log("본문에 태그 줄 없음 (이미 정리된 글)");
    }

    // ④ 발행 설정창 열기
    await frame.locator('button[class*="publish_btn"]').first().click();
    await sleep(2000);

    // ⑤ 카테고리 (지정했을 때만)
    if (input.category) console.log(`카테고리 선택됨: ${await selectCategory(frame, input.category)}`);

    // ⑥ 태그칸 입력 (기존 즉시발행 방식과 같게 하나씩 붙여넣고 Enter)
    const tagInput = frame.locator('input[class*="tag_input"]').first();
    for (const tag of post.tags) {
      await tagInput.click();
      await page.evaluate(async (v) => navigator.clipboard.writeText(v), tag);
      await page.keyboard.press("Control+V");
      await page.keyboard.press("Enter");
      await sleep(250);
    }
    const tagCount = await frame.locator('[class*="tag_area"] [class*="tag"], [class*="tag_list"] li').count().catch(() => 0);
    console.log(`태그 입력 완료 (화면에서 세어진 태그 요소: ${tagCount})`);

    // ⑦ 예약 선택 → 날짜(달력) → 시 → 분
    await frame.locator('label[class*="radio_label"]').filter({ hasText: /^\s*예약\s*$/ }).first().click();
    await sleep(1200);

    const dateBox = frame.locator('input[class*="input_date"]').first();
    await dateBox.click();
    await sleep(800);
    const [ty, tm, td] = input.date.split("-").map(Number);
    for (let step = 0; step < 24; step++) {
      const header = (await frame.locator(".ui-datepicker-title").first().innerText()).replace(/\s+/g, " ");
      const m = /(\d{4})\D+(\d{1,2})/.exec(header);
      if (!m) fail(`달력 제목을 읽지 못했습니다: ${header}`);
      const diff = (ty - Number(m[1])) * 12 + (tm - Number(m[2]));
      if (diff === 0) break;
      await frame.locator(diff > 0 ? ".ui-datepicker-next" : ".ui-datepicker-prev").first().click();
      await sleep(300);
    }
    // 이 달력은 날짜 칸에 클래스가 없고, 다른 달 칸은 빈 칸이다. 그래서 '글자가 정확히 일치하는 날짜 버튼'을 찾는다.
    // 조사에서 실제로 날짜가 잡혔던 방식(.ui-datepicker 안의 td 버튼)과 똑같이 찾는다.
    const dayBtn = frame.locator(".ui-datepicker td button").filter({ hasText: new RegExp(`^\\s*${td}\\s*$`) });
    const dayCount = await dayBtn.count();
    if (dayCount !== 1) {
      await page.screenshot({ path: path.join(LOG_DIR, "reserve-calendar-fail.png") });
      fail(`달력에서 ${td}일 버튼이 ${dayCount}개 발견됐습니다 (정확히 1개여야 합니다). 캡처: reserve-calendar-fail.png`);
    }
    await dayBtn.first().click();
    await sleep(600);
    await frame.locator('select[class*="hour_option"]').first().selectOption(input.hour);
    await frame.locator('select[class*="minute_option"]').first().selectOption(input.minute);
    await sleep(500);

    // ⑧ 입력한 값이 화면에 그대로 반영됐는지 다시 읽어 확인
    const shown = {
      date: (await dateBox.inputValue()).replace(/\s+/g, ""),
      hour: await frame.locator('select[class*="hour_option"]').first().inputValue(),
      minute: await frame.locator('select[class*="minute_option"]').first().inputValue(),
    };
    const want = { date: `${ty}.${String(tm).padStart(2, "0")}.${String(td).padStart(2, "0")}`, hour: input.hour, minute: input.minute };
    console.log("화면 값:", JSON.stringify(shown), "/ 요청 값:", JSON.stringify(want));
    if (shown.date !== want.date || shown.hour !== want.hour || shown.minute !== want.minute) fail("예약 시각이 요청한 값과 다르게 입력됐습니다 (예약하지 않고 멈춥니다)");

    // ⑧-2 확정 직전 최종 검증: 카테고리와 태그가 정말 원하는 값인지 화면에서 다시 읽는다
    if (input.category) {
      const shownCategory = await readSelectedCategory(frame);
      const wantedCategory = normalize(String(input.category).split(">").pop());
      console.log(`카테고리 확인: 화면 "${shownCategory}" / 요청 "${wantedCategory}"`);
      if (shownCategory !== wantedCategory) fail("카테고리가 요청한 값과 다릅니다 (예약하지 않고 멈춥니다)");
    }
    const panelText = await frame.locator('[class*="layer_content_set_publish"]').first().innerText();
    const missingTags = post.tags.filter((t) => !panelText.includes(t));
    console.log(`태그 확인: ${post.tags.length - missingTags.length}/${post.tags.length}개가 화면에 있음`);
    if (missingTags.length) fail(`태그가 화면에 없습니다: ${missingTags.join(", ")} (예약하지 않고 멈춥니다)`);

    const shot = path.join(LOG_DIR, `reserve-preview-${input.date}-${input.hour}${input.minute}.png`);
    await page.screenshot({ path: shot });
    console.log("PREVIEW_SCREENSHOT:", shot);

    if (!COMMIT) {
      console.log("RESULT: PREVIEW_OK (확정하지 않았습니다)");
      done = true;
      return;
    }

    // ⑨ 확정 — 발행 설정창의 최종 '발행' 버튼 (모드가 예약이므로 예약으로 확정된다)
    await frame.locator('button[class*="confirm_btn"]').first().click();
    await sleep(4000);
    await page.screenshot({ path: path.join(LOG_DIR, `reserve-committed-${input.date}-${input.hour}${input.minute}.png`) });
    fs.writeFileSync(
      reservedMarker,
      `예약 ${input.date} ${input.hour}:${input.minute}${input.category ? ` · 카테고리 ${input.category}` : ""} (확정 ${new Date().toLocaleString("ko-KR")})\n`,
      "utf8"
    );
    console.log("RESULT: COMMITTED");
    done = true;
  } finally {
    await browser.close().catch(() => {});
    console.log(done ? "BROWSER_CLOSED" : "BROWSER_CLOSED (완료되지 않음 — 예약되지 않았습니다)");
  }
})().catch((e) => {
  console.log("RESERVE_ERROR:", e.message);
  process.exit(1);
});
