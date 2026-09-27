// 네이버 글쓰기 화면 상단에 보이는 '임시저장' 개수와 '예약 발행' 개수만 읽는다.
// 어떤 버튼도 누르지 않고, 글도 만들지 않는다. 결과를 한 줄 JSON(COUNTS_JSON:...)으로 출력한다.
// 브라우저는 항상 닫는다 (열어두면 네이버가 편집 중으로 잠글 수 있다).
const { chromium } = require("playwright");
const config = require("./config.json");
const { STATE_FILE } = require("./lib/paths");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// "예약 발행 45건" → 45 / "임시저장된 글 보기, 202개" → 202 (숫자에 쉼표가 있어도 처리)
function pickNumber(text, unit) {
  const m = new RegExp(`(\\d[\\d,]*)\\s*${unit}`).exec(String(text || ""));
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

async function readCounts(headless) {
  const browser = await chromium.launch({
    headless,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, { waitUntil: "domcontentloaded", timeout: 25000 });
    await sleep(3000);
    if (/nidlogin|nid\.naver\.com/.test(page.url())) return { ok: false, reason: "login" };

    const frame = page.frameLocator("#mainFrame");
    const reserveBtn = frame.locator('button[class*="reserve_btn"]').first();
    const saveBtn = frame.locator('button[class*="save_count_btn"]').first();
    await reserveBtn.waitFor({ timeout: 15000 });

    const reserveText = await reserveBtn.innerText();
    // 임시저장은 화면에 '99+' 로만 보이므로, 버튼 안쪽 라벨(예: '임시저장된 글 보기, 202개')을 우선 읽는다.
    const saveLabel = (await saveBtn.getAttribute("aria-label").catch(() => "")) || "";
    const saveText = await saveBtn.innerText().catch(() => "");

    const reserved = pickNumber(reserveText, "건");
    const drafts = pickNumber(saveLabel, "개") ?? (/^\d[\d,]*$/.test(saveText.trim()) ? Number(saveText.trim().replace(/,/g, "")) : null);
    if (reserved === null && drafts === null) return { ok: false, reason: "not-found" };
    return { ok: true, drafts, reserved };
  } finally {
    await browser.close().catch(() => {});
  }
}

(async () => {
  const startedAt = new Date().toISOString();
  let result;
  try {
    // 창이 안 보이는 방식으로 먼저 시도하고, 못 읽으면 창을 띄워서 한 번 더 시도한다.
    result = await readCounts(true).catch((e) => ({ ok: false, reason: e.message }));
    result.mode = "hidden";
    if (!result.ok && result.reason !== "login") {
      result = await readCounts(false).catch((e) => ({ ok: false, reason: e.message }));
      result.mode = "visible";
    }
  } catch (e) {
    result = { ok: false, reason: e.message };
  }
  console.log("COUNTS_JSON:" + JSON.stringify({ ...result, checkedAt: startedAt }));
})();
