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
  const frame = page.frameLocator("#mainFrame");
  for (const sel of ['button.se-popup-button-cancel', 'button:has-text("취소")']) {
    const b = frame.locator(sel).first();
    if ((await b.count()) && (await b.isVisible().catch(() => false))) { await b.click().catch(() => {}); break; }
  }
  await sleep(2000);
  await frame.locator(".se-component.se-text .se-text-paragraph").first().click().catch(() => {});
  await sleep(300);
  await page.keyboard.press("Control+a");
  await sleep(300);

  await frame.locator('button[data-name="align-drop-down-with-justify"]').first().click();
  await sleep(800);
  const opts = await frame.locator('button, [role="menuitem"], li').evaluateAll((els) =>
    els
      .filter((e) => /align|정렬|가운데|왼쪽|오른쪽|양쪽/i.test((e.className || "") + (e.textContent || "") + (e.getAttribute("data-name") || "")))
      .map((e) => ({ t: (e.textContent || "").trim().slice(0, 15), c: e.className, d: e.getAttribute("data-name"), title: e.getAttribute("title") }))
  );
  console.log(JSON.stringify(opts, null, 1));
  await browser.close();
})();
