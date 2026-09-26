// 네이버 블로그 자동 작성.
// 실행: npm run post
//
// config.json 의 mode:
//   "draft"    : 제목+본문+사진만 임시저장. (태그/커넥트/예약은 나중에 손으로)
//   "schedule" : 본문 작성 -> [커넥트 첨부 대기] -> 태그 입력 -> 예약발행.
//
// ⚠️ 스마트에디터 구조가 바뀌면 셀렉터 수정이 필요할 수 있습니다.
//    첫 실행은 config 의 limit 를 1 로 두고 폴더 1개로 테스트하세요.

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const readline = require("readline");
const config = require("./config.json");
const { parseFolder, listPostFolders } = require("./lib/parse");
const { STATE_FILE, LOG_DIR } = require("./lib/paths");

fs.mkdirSync(LOG_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (q) =>
  new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => {
      rl.close();
      res(a);
    });
  });

// 여러 후보 셀렉터 중 먼저 보이는 것을 클릭
async function clickAny(scope, selectors, { timeout = 5000, optional = false } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const loc = scope.locator(sel).first();
      if ((await loc.count()) && (await loc.isVisible().catch(() => false))) {
        await loc.click().catch(() => {});
        return true;
      }
    }
    await sleep(250);
  }
  if (!optional) console.log(`   (셀렉터 못 찾음: ${selectors.join(" | ")})`);
  return false;
}

async function dismissPopups(frame) {
  // 이전 작성글 복구 팝업 -> "취소" (새 글로 시작)
  await clickAny(
    frame,
    [
      "button.se-popup-button-cancel",
      '.se-popup-button-text:has-text("취소")',
      'button:has-text("취소")',
    ],
    { timeout: 3000, optional: true }
  );
  // 도움말/기타 레이어 닫기
  await clickAny(
    frame,
    ['button.se-help-panel-close-button', 'button[class*="close"]:visible'],
    { timeout: 1500, optional: true }
  );
}

async function writeOne(page, post) {
  const frame = page.frameLocator("#mainFrame");

  console.log(`   에디터 로딩...`);
  await sleep(3500);
  await dismissPopups(frame);

  // ---- 제목 ----
  console.log(`   제목 입력`);
  await clickAny(frame, [
    ".se-section-documentTitle .se-placeholder",
    ".se-section-documentTitle .se-text-paragraph",
    ".se-documentTitle",
  ]);
  await sleep(400);
  const pasteText = async (text) => {
    let pasted = false;
    try {
      await page.evaluate(async (value) => navigator.clipboard.writeText(value), text);
      await page.keyboard.press("Control+V");
      pasted = true;
    } catch {}
    if (!pasted) await page.keyboard.insertText(text);
  };
  await pasteText(post.title || "제목 없음");
  await sleep(300);

  // ---- 본문 진입 ----
  await clickAny(frame, [
    ".se-section-text .se-text-paragraph",
    ".se-component.se-text .se-text-paragraph",
    '.se-component-content [contenteditable="true"]',
  ]);
  await sleep(400);

  const imageCount = () => frame.locator(".se-component.se-image").count().catch(() => 0);

  // === 1단계: 본문 텍스트를 한 번에 입력 (사진 자리에는 마커 줄) ===
  // 사진 삽입을 타이핑과 분리해야 커서 유실/줄 유실이 없다.
  console.log(`   본문 입력`);
  const MARK = (k) => `ZI${k}Z`;
  let slotIdx = 0;
  const slotPhotos = []; // 마커순서 -> 사진경로(없으면 null)

  // 붙여넣기 전에 이전 편집 상태에서 이어진 글자 서식을 끈다.
  for (const name of ["strikethrough", "bold", "italic", "underline"]) {
    const btn = frame.locator(`button[data-name="${name}"]`).first();
    if (!(await btn.count())) continue;
    const active = await btn
      .evaluate((e) => e.className.includes("se-is-selected") || e.getAttribute("aria-pressed") === "true")
      .catch(() => false);
    if (active) await btn.click().catch(() => {});
  }

  const bodyLines = [];
  for (const b of post.blocks) {
    if (b.type === "text") {
      for (const line of b.text.split("\n").filter((l) => l.trim() !== "")) {
        bodyLines.push(line, "");
      }
    } else if (b.path) {
      // 사진 있는 슬롯만 마커 (마커 줄만 단독으로 둔다 - 앞뒤 여백은 2단계에서)
      bodyLines.push(MARK(slotIdx), "");
      slotPhotos.push(b.path);
      slotIdx++;
    } else {
      // 사진 없는 슬롯 = 그냥 빈 줄
      bodyLines.push("");
    }
  }

  // draft: 태그 줄을 본문 맨 아래에 남겨둔다 (발행 때 복사 → 태그칸 → 본문에서 삭제)
  if (config.mode === "draft" && post.tags && post.tags.length) {
    console.log(`   태그 줄 본문 맨 아래 입력 (${post.tags.length}개)`);
    bodyLines.push("", "#" + post.tags.join(" #"));
  }

  const SHOP_MARK_TOP = "ZTOPZ";
  const SHOP_MARK_BOTTOM = "ZBOTZ";
  if (post.connect) {
    const disclosure = "이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다.";
    bodyLines.unshift(SHOP_MARK_TOP, "", disclosure, "");
    if (config.mode === "draft" && post.tags && post.tags.length) {
      bodyLines.splice(bodyLines.length - 2, 0, "", SHOP_MARK_BOTTOM, "");
    } else {
      bodyLines.push("", SHOP_MARK_BOTTOM);
    }
  }

  // 본문을 먼저 한 번에 붙여넣어 화면 대기를 줄인다.
  const bodyText = bodyLines.join("\n").replace(/\n+$/, "");
  await pasteText(bodyText);
  await sleep(800);

  // 쇼핑커넥트 고지와 전용 상품 카드를 본문 최상단에 둔다.
  // 발급 URL은 본문 텍스트로 노출하지 않는다.
  if (post.connect) {
    const query = post.connect.productName || post.title;

    const placements = [
      { marker: SHOP_MARK_TOP, label: "본문 맨 위" },
      { marker: SHOP_MARK_BOTTOM, label: "태그 바로 위" },
    ];
    for (const placement of placements) {
    const shopPara = frame.locator(`.se-text-paragraph:has-text("${placement.marker}")`).first();
    if (!(await shopPara.count())) throw new Error(`쇼핑커넥트 삽입 위치를 찾지 못함: ${placement.label}`);
    const shopNode = shopPara.locator("span.__se-node").filter({ hasText: placement.marker }).first();
    if (!(await shopNode.count())) throw new Error(`쇼핑커넥트 글자 노드를 찾지 못함: ${placement.label}`);
    await shopNode.click({ force: true });
    await sleep(200);

    const productTokenBefore = query.slice(0, 24);
    const beforeCards = await frame.locator(".se-component").filter({ hasText: productTokenBefore }).count();

    console.log(`   쇼핑커넥트 상품 첨부 (${placement.label}): ${query}`);
    const shoppingButton = frame.locator('button[data-name="shopping-connect"]').first();
    if (!(await shoppingButton.count())) throw new Error("쇼핑커넥트 버튼을 찾지 못함");
    await shoppingButton.click();
    await sleep(1200);

    const searchInput = frame.locator('input[placeholder="쇼핑 커넥트 상품을 검색해 보세요."]').first();
    if (!(await searchInput.count())) throw new Error("쇼핑커넥트 검색창을 찾지 못함");
    await searchInput.fill(query);
    await frame.locator("button.se-popup-search-button").click();
    await sleep(1800);

    const item = frame.locator("li.se-shopping-connect-item").filter({ hasText: query }).first();
    const targetItem = (await item.count()) ? item : frame.locator("li.se-shopping-connect-item").first();
    if (!(await targetItem.count())) throw new Error(`쇼핑커넥트 상품 검색 결과 없음: ${query}`);
    await targetItem.locator("button.se-shopping-connect-item-add-button").click();
    await sleep(800);

    const confirm = frame.locator(".se-popup-shopping-connect-add-component-layer button.se-popup-button-confirm").first();
    if (!(await confirm.count())) throw new Error("쇼핑커넥트 추가 확인창을 찾지 못함");
    await confirm.click();
    await sleep(2200);

    const productToken = query.slice(0, 24);
    const productCards = frame.locator(".se-component").filter({ hasText: productToken });
    const cardStarted = Date.now();
    while ((await productCards.count()) <= beforeCards && Date.now() - cardStarted < 15000) await sleep(500);
    const shoppingComponents = await productCards.count();
    if (shoppingComponents <= beforeCards) throw new Error(`쇼핑커넥트 상품 카드가 추가되지 않음: ${placement.label}`);
    console.log(`     - ${placement.label} 상품 카드 확인`);

    }
    const totalCards = await frame.locator(".se-component").filter({ hasText: query.slice(0, 24) }).count();
    console.log(`     - 쇼핑커넥트 상품 카드 총 ${totalCards}개 확인`);

  }

  // === 2단계: 마커를 뒤에서부터 찾아 사진으로 교체 ===
  for (let k = slotPhotos.length - 1; k >= 0; k--) {
    const photo = slotPhotos[k];
    const para = frame.locator(`.se-text-paragraph:has-text("${MARK(k)}")`).first();
    try {
      if (!(await para.count())) {
        console.log(`   ⚠️ 마커 ${k} 못 찾음`);
        continue;
      }
      // 마커 줄에 캐럿을 두고 그 줄만 선택해서 지운다 (트리플클릭은 옆 문단까지 먹는 일이 있어서 Home~Shift+End 사용)
      const markerNode = para.locator("span.__se-node").filter({ hasText: MARK(k) }).first();
      if (!(await markerNode.count())) throw new Error(`사진 글자 노드를 찾지 못함: ${MARK(k)}`);
      await markerNode.click({ force: true });
      await sleep(200);
      // 혹시 남았으면 한 번 더
      if (await frame.locator(`.se-text-paragraph:has-text("IMGSLOTZZ${k}")`).count()) {
        await frame.locator(`.se-text-paragraph:has-text("IMGSLOTZZ${k}")`).first().click({ timeout: 3000 }).catch(() => {});
        await page.keyboard.press("Home");
        await page.keyboard.press("Shift+End");
        await page.keyboard.press("Backspace");
        await sleep(200);
      }

      console.log(`   사진 업로드: ${path.basename(photo)}`);
      const before = await imageCount();
      const fcPromise = page.waitForEvent("filechooser", { timeout: 12000 });
      await clickAny(
        frame,
        ["button.se-image-toolbar-button", 'button[data-name="image"]', ".se-toolbar-item-image button"],
        { timeout: 5000 }
      );
      let fc;
      try {
        fc = await fcPromise;
      } catch {
        console.log("   ⚠️ 파일 선택창이 안 열림 - 건너뜀");
        continue;
      }
      await fc.setFiles([photo]);
      // 이미지가 실제로 추가될 때까지 (최대 25초)
      const t0 = Date.now();
      let imageAdded = false;
      let stableChecks = 0;
      while (Date.now() - t0 < 25000) {
        const currentCount = await imageCount();
        stableChecks = currentCount > before ? stableChecks + 1 : 0;
        if (stableChecks >= 5) {
          imageAdded = true;
          break;
        }
        await sleep(400);
      }
      if (!imageAdded) throw new Error(`${path.basename(photo)} 업로드 완료를 확인하지 못함`);
      console.log(`     - 이미지 수 ${(await imageCount())}장 안정 확인`);
      await sleep(250);
    } catch (e) {
      console.log(`   ⚠️ 슬롯 ${k} 처리 오류: ${e.message}`);
    }
  }

  // ---- 본문 전체 선택 후 서식 정리 ----
  // 스마트에디터는 직전 글의 글자서식(굵게/취소선 등)을 이어받는다.
  // 원치 않는 서식(특히 취소선)이 켜져 있으면 끈다.
  console.log(`   서식 정리 (원치 않는 취소선/굵게 등 해제)`);
  const markerPattern = /ZI\d+Z|ZTOPZ|ZBOTZ|ZZIMG|IMGSLOT|ZZSHOPPING/i;
  const markerParagraphs = frame
    .locator(".se-component.se-text .se-text-paragraph")
    .filter({ hasText: markerPattern });
  for (let i = (await markerParagraphs.count()) - 1; i >= 0; i--) {
    const markerPara = markerParagraphs.nth(i);
    const markerNode = markerPara.locator("span.__se-node").filter({ hasText: markerPattern }).first();
    if (!(await markerNode.count())) continue;
    await markerNode.evaluate((el) => {
      el.textContent = "";
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
      const editor = el.closest(".se-component-content") || el.parentElement;
      editor?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    });
    await sleep(250);
  }
  const remainingMarkers = await frame
    .locator(".se-component.se-text .se-text-paragraph")
    .filter({ hasText: markerPattern })
    .allInnerTexts();
  if (remainingMarkers.length) throw new Error(`본문 자리표시자 잔존: ${remainingMarkers.join(", ")}`);

  const finalImageCount = await imageCount();
  if (finalImageCount !== slotPhotos.length) {
    throw new Error(`사진 수 불일치: 예상 ${slotPhotos.length}장 / 실제 ${finalImageCount}장`);
  }
  console.log(`   사진 검증 완료: ${finalImageCount}장 / 영문 자리표시자 없음`);

  await frame.locator(".se-component.se-text .se-text-paragraph").first().click().catch(() => {});
  await sleep(200);
  await page.keyboard.press("Control+a");
  await sleep(500);

  for (const name of ["strikethrough", "bold", "italic", "underline"]) {
    const btn = frame.locator(`button[data-name="${name}"]`).first();
    if (!(await btn.count())) continue;
    const active = await btn.evaluate((e) => e.className.includes("se-is-selected")).catch(() => false);
    if (active) {
      await btn.click().catch(() => {});
      await sleep(250);
      console.log(`     - ${name} 해제`);
    }
  }

  if (config.centerAlign) {
    const alignBtn = frame.locator('button[data-name="align-drop-down-with-justify"]').first();
    if (await alignBtn.count()) {
      await alignBtn.click().catch(() => {});
      await sleep(600);
      const centerOpt = frame.locator("button.se-toolbar-option-align-center-button").first();
      const already = await centerOpt
        .evaluate((e) => e.className.includes("se-is-selected"))
        .catch(() => false);
      if (!already) {
        await centerOpt.click().catch(() => {});
        console.log(`     - 가운데 정렬 적용`);
        await sleep(300);
      } else {
        // 이미 가운데 -> 드롭다운만 닫기
        await alignBtn.click().catch(() => {});
      }
      await sleep(300);
    }
  }

  await page.keyboard.press("End").catch(() => {});
  await sleep(300);

  // ---- 저장 / 발행 ----
  if (config.mode === "draft") {
    console.log(`   임시저장`);
    await clickAny(frame, [
      'button:has-text("저장")',
      "button.save_btn__bzc5B",
      'button[class*="save"]',
    ]);
    await sleep(2500);
    // "저장되었습니다" 확인 팝업이 뜨면 닫기
    await clickAny(frame, ['button:has-text("확인")'], { timeout: 2000, optional: true });
    console.log(`   ✅ 임시저장 완료`);
    return;
  }

  // schedule 모드
  if (config.mode === "schedule") {
    console.log("\n   ┌─ 커넥트(쇼핑) 상품을 지금 브라우저에서 첨부하세요.");
    await ask("   └─ 첨부 끝났으면 Enter > ");

    console.log(`   발행 설정 열기`);
    await clickAny(frame, [
      "button.publish_btn__m9KHH",
      'button[class*="publish"]:has-text("발행")',
      'button:has-text("발행")',
    ]);
    await sleep(1500);

    // 태그
    if (post.tags.length) {
      console.log(`   태그 ${post.tags.length}개 입력`);
      for (const t of post.tags) {
        const tagInput = frame
          .locator('#tag-input, input[class*="tag_input"], input[placeholder*="태그"]')
          .first();
        if (await tagInput.count()) {
          await tagInput.click();
          await page.keyboard.type(t, { delay: 20 });
          await page.keyboard.press("Enter");
          await sleep(300);
        }
      }
    }

    // 예약
    const when = post._when; // post.js 상단 루프에서 계산해 넣음
    console.log(`   예약 시각 설정: ${when.label}`);
    await clickAny(frame, [
      'label:has-text("예약")',
      'input[value="RESERVE"]',
      'span:has-text("예약")',
    ]);
    await sleep(800);
    // 날짜
    const dateInput = frame.locator('input[class*="date"], .se_date_input input, input[placeholder*="날짜"]').first();
    if (await dateInput.count()) {
      await dateInput.fill("");
      await dateInput.type(when.date, { delay: 30 });
      await page.keyboard.press("Escape");
    }
    // 시/분 (select 또는 커스텀 드롭다운)
    const hourSel = frame.locator('select[class*="hour"], select[name*="hour"]').first();
    const minSel = frame.locator('select[class*="minute"], select[name*="minute"]').first();
    if (await hourSel.count()) await hourSel.selectOption(when.hour).catch(() => {});
    if (await minSel.count()) await minSel.selectOption(when.minute).catch(() => {});
    await sleep(500);

    console.log("\n   ⚠️ 발행 레이어 상태를 브라우저에서 확인하세요 (태그/예약시각).");
    const go = await ask("   이대로 발행하려면 y, 건너뛰려면 n > ");
    if (go.trim().toLowerCase() !== "y") {
      console.log("   건너뜀 (이 글은 발행 안 됨).");
      return;
    }
    await clickAny(frame, [
      'button.confirm_btn__WEaBq',
      '.layer_btn_area button:has-text("발행")',
      'button[class*="confirm"]:has-text("발행")',
    ]);
    await sleep(3000);
    console.log(`   ✅ 예약발행 완료`);
  }
}

function computeSchedule(index) {
  // index: 0부터
  const [d, t] = config.schedule.start.split(" ");
  const base = new Date(`${d}T${t}:00`);
  base.setHours(base.getHours() + index * config.schedule.intervalHours);
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
  return {
    date,
    hour: pad(base.getHours()),
    minute: pad(Math.floor(base.getMinutes() / 10) * 10), // 10분 단위
    label: `${date} ${pad(base.getHours())}:${pad(base.getMinutes())}`,
  };
}

module.exports = { writeOne, computeSchedule };

// sync.js 등에서 require 하면 아래 실행부는 건너뛴다
if (require.main !== module) return;

(async () => {
  if (!config.blogId || config.blogId.includes("여기에")) {
    console.log("\n⛔ config.json 의 blogId 를 먼저 설정하세요.\n");
    process.exit(1);
  }

  let folders = listPostFolders(config.postsDir);
  folders = folders.slice(config.startFrom - 1);
  if (config.limit > 0) folders = folders.slice(0, config.limit);

  if (!folders.length) {
    console.log(`\n'${config.postsDir}' 에 처리할 폴더가 없습니다.\n`);
    process.exit(0);
  }

  console.log(`\n대상 ${folders.length}개 폴더, 모드=${config.mode}\n`);

  if (!fs.existsSync(STATE_FILE)) {
    console.log("⛔ 로그인 세션이 없습니다. 먼저:  npm run login\n");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: config.headless,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized"],
  });
  const ctx = await browser.newContext({
    storageState: STATE_FILE,
    viewport: null,
    acceptDownloads: false,
  });
  await ctx
    .grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://blog.naver.com" })
    .catch(() => {});
  const page = await ctx.newPage();

  // 로그인 체크: 글쓰기 URL 이 로그인 페이지로 튕기는지
  await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, {
    waitUntil: "domcontentloaded",
    timeout: 25000,
  });
  await sleep(4000);
  if (/nidlogin|nid\.naver\.com/.test(page.url())) {
    console.log("⛔ 네이버 로그인이 만료됐습니다. 다시:  npm run login\n");
    await browser.close();
    process.exit(1);
  }

  const results = [];
  for (let i = 0; i < folders.length; i++) {
    const folder = folders[i];
    const name = path.basename(folder);
    console.log(`\n[${i + 1}/${folders.length}] ${name}`);
    try {
      const post = parseFolder(folder);
      if (!post.title) throw new Error("제목 파싱 실패");
      if (config.mode === "schedule") post._when = computeSchedule(config.startFrom - 1 + i);

      await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, {
        waitUntil: "domcontentloaded",
      });
      await writeOne(page, post);
      results.push({ name, ok: true });
    } catch (e) {
      console.log(`   ❌ 오류: ${e.message}`);
      await page
        .screenshot({ path: path.join(LOG_DIR, `${name}-error.png`), fullPage: true })
        .catch(() => {});
      results.push({ name, ok: false, error: e.message });
    }
    if (i < folders.length - 1) {
      console.log(`   ${config.betweenPostsDelaySec}초 대기...`);
      await sleep(config.betweenPostsDelaySec * 1000);
    }
  }

  console.log(`\n${"=".repeat(50)}\n결과`);
  for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} ${r.name}${r.error ? " - " + r.error : ""}`);

  // 반드시 닫는다: 열어두면 네이버가 그 글을 '편집 중'으로 잠가서
  // 사장님이 임시저장 글을 못 연다.
  await browser.close().catch(() => {});
  console.log(`\n브라우저 종료. 네이버 블로그 > 글쓰기 > '저장 N' 에서 초안 확인하세요.\n`);
})();
