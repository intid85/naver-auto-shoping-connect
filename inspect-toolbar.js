// 스마트에디터 툴바 버튼들의 실제 라벨/클래스를 덤프한다.
const { chromium } = require("playwright");
const config = require("./config.json");
const { STATE_FILE } = require("./lib/paths");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, { waitUntil: "load", timeout: 30000 });
  await sleep(6000);

  // 복구 팝업 취소
  for (const sel of ['button.se-popup-button-cancel', 'button:has-text("취소")']) {
    const b = page.frameLocator("#mainFrame").locator(sel).first();
    if ((await b.count()) && (await b.isVisible().catch(() => false))) { await b.click().catch(() => {}); break; }
  }
  await sleep(2000);

  const btns = await page.frameLocator("#mainFrame").locator("button").evaluateAll((els) =>
    els
      .map((e) => ({
        text: (e.textContent || "").trim().slice(0, 20),
        aria: e.getAttribute("aria-label"),
        cls: e.getAttribute("class"),
        dataName: e.getAttribute("data-name"),
        dataType: e.getAttribute("data-type"),
      }))
      .filter((b) => b.aria || b.dataName || (b.cls && /align|strike|bold|toolbar/i.test(b.cls)))
  );
  console.log(JSON.stringify(btns, null, 1));
  await browser.close();
})();
