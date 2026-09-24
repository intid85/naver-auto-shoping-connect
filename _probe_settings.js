const { chromium } = require("playwright");
const config = require("./config.json");
const { STATE_FILE } = require("./lib/paths");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1500, height: 1000 } });
  const page = await ctx.newPage();
  await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, { waitUntil: "load", timeout: 30000 });
  await sleep(6000);
  const frame = page.frameLocator("#mainFrame");
  // dismiss popups
  for (const s of ['button.se-popup-button-cancel','button:has-text("취소")','.se-help-panel-close-button']) {
    const b = frame.locator(s).first();
    if (await b.count() && await b.isVisible().catch(()=>false)) await b.click().catch(()=>{});
  }
  await sleep(1500);

  // 모든 툴바/헤더 버튼 텍스트+클래스 덤프
  const btns = await frame.locator('button').evaluateAll((els) =>
    els.slice(0, 120).map((e) => ({
      t: (e.textContent || "").trim().slice(0, 20),
      aria: e.getAttribute("aria-label") || "",
      name: e.getAttribute("data-name") || "",
      cls: (e.className || "").slice(0, 45),
    })).filter((x) => x.t || x.aria || x.name)
  );
  console.log("=== BUTTONS ===");
  btns.forEach((b) => console.log(JSON.stringify(b)));

  // '설정' / '환경설정' 관련 요소 검색
  const settingLike = await frame.locator('button, a, span').evaluateAll((els) =>
    els.filter((e) => /설정|환경|글감|추천|자동완성/.test(e.textContent || e.getAttribute("aria-label") || ""))
      .slice(0, 30)
      .map((e) => ({ tag: e.tagName, t: (e.textContent||"").trim().slice(0,25), aria: e.getAttribute("aria-label")||"", cls:(e.className||"").slice(0,45) }))
  );
  console.log("\n=== SETTING-LIKE ===");
  settingLike.forEach((s) => console.log(JSON.stringify(s)));

  await browser.close();
})();
