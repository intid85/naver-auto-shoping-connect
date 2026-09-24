// 저장된 임시글을 복구 -> 본문 전체선택 -> 서식 버튼들의 활성 상태 확인
const { chromium } = require("playwright");
const config = require("./config.json");
const { STATE_FILE } = require("./lib/paths");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1400, height: 1200 } });
  const page = await ctx.newPage();
  await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, { waitUntil: "load", timeout: 30000 });
  await sleep(6000);
  const frame = page.frameLocator("#mainFrame");

  // 복구 팝업 -> 확인(불러오기)
  for (const sel of ['button.se-popup-button-confirm', 'button:has-text("확인")']) {
    const b = frame.locator(sel).first();
    if ((await b.count()) && (await b.isVisible().catch(() => false))) { await b.click().catch(() => {}); break; }
  }
  await sleep(5000);

  // 본문 클릭 후 전체 선택
  await frame.locator(".se-component.se-text .se-text-paragraph").first().click();
  await sleep(300);
  await page.keyboard.press("Control+a");
  await sleep(500);

  const states = await frame.locator("button").evaluateAll((els) =>
    els
      .filter((e) => ["bold", "italic", "underline", "strikethrough"].includes(e.getAttribute("data-name")))
      .map((e) => ({
        name: e.getAttribute("data-name"),
        ariaPressed: e.getAttribute("aria-pressed"),
        class: e.getAttribute("class"),
      }))
  );
  console.log(JSON.stringify(states, null, 1));

  // 실제 본문 HTML 일부
  const html = await frame.locator(".se-component.se-text").first().evaluate((e) => e.innerHTML.slice(0, 400));
  console.log("\nBODY HTML:\n", html);

  await browser.close();
})();
