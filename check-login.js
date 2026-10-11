// 저장된 세션(naver-state.json)으로 로그인이 유효한지 확인.
// 실행: npm run check

const { chromium } = require("playwright");
const fs = require("fs");
const config = require("./config.json");
if (process.env.NAVER_BLOG_ID) config.blogId = process.env.NAVER_BLOG_ID;
const { STATE_FILE } = require("./lib/paths");
const { autoSaveSession } = require("./lib/session");

(async () => {
  if (!fs.existsSync(STATE_FILE)) {
    console.log("세션 파일 없음. 먼저: npm run login");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: true,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"], // 없으면 에디터가 로딩에서 멈춰 로그인 무효로 오판
  });
  const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: null });
  autoSaveSession(browser, ctx); // 닫을 때 갱신된 로그인 쿠키를 세션 파일에 저장
  const page = await ctx.newPage();

  await page.goto("https://www.naver.com", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const cookies = await ctx.cookies();
  const aut = cookies.find((c) => c.name === "NID_AUT");

  const writeUrl = `https://blog.naver.com/${config.blogId}?Redirect=Write&`;
  await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
  // 에디터 본문은 10초 넘게 걸릴 때가 있어 최대 30초까지 기다린다
  let editorFound = false;
  const frame = page.frameLocator("#mainFrame");
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (/nidlogin|nid\.naver\.com/.test(page.url())) break;
    try {
      editorFound = (await frame.locator(".se-section-documentTitle, .se-placeholder-container").count()) > 0;
    } catch {}
    if (editorFound) break;
    await page.waitForTimeout(500);
  }
  const finalUrl = page.url();
  const redirectedToLogin = /nidlogin|nid\.naver\.com/.test(finalUrl);

  console.log(
    JSON.stringify(
      {
        NID_AUT쿠키: aut ? "있음(len=" + aut.value.length + ")" : "없음",
        글쓰기_최종URL: finalUrl.slice(0, 90),
        로그인페이지로튕김: redirectedToLogin,
        에디터_발견: editorFound,
        판정: !redirectedToLogin && editorFound ? "로그인 유효 ✅" : "로그인 무효 ❌ (npm run login 다시)",
      },
      null,
      2
    )
  );

  await browser.close().catch(() => {});
  process.exit(!redirectedToLogin && editorFound ? 0 : 1);
})();
