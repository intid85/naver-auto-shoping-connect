// 저장된 세션(naver-state.json)으로 로그인이 유효한지 확인.
// 실행: npm run check

const { chromium } = require("playwright");
const fs = require("fs");
const config = require("./config.json");
const { STATE_FILE } = require("./lib/paths");

(async () => {
  if (!fs.existsSync(STATE_FILE)) {
    console.log("세션 파일 없음. 먼저: npm run login");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: null });
  const page = await ctx.newPage();

  await page.goto("https://www.naver.com", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const cookies = await ctx.cookies();
  const aut = cookies.find((c) => c.name === "NID_AUT");

  const writeUrl = `https://blog.naver.com/${config.blogId}?Redirect=Write&`;
  await page.goto(writeUrl, { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForTimeout(4000);
  const finalUrl = page.url();
  const redirectedToLogin = /nidlogin|nid\.naver\.com/.test(finalUrl);

  let editorFound = false;
  try {
    const frame = page.frameLocator("#mainFrame");
    editorFound =
      (await frame.locator(".se-section-documentTitle, .se-placeholder-container").count()) > 0;
  } catch {}

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

  await browser.close();
})();
