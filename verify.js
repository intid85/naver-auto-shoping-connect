// 최신 임시저장 글의 본문을 뽑아 소스(parseFolder)와 대조한다.
const { chromium } = require("playwright");
const config = require("./config.json");
const { STATE_FILE } = require("./lib/paths");
const { parseFolder, listPostFolders } = require("./lib/parse");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const src = parseFolder(listPostFolders(config.postsDir)[0]);
  const srcLines = [];
  for (const b of src.blocks) if (b.type === "text") srcLines.push(...b.text.split("\n").filter((x) => x.trim()));

  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1400, height: 1200 } });
  const page = await ctx.newPage();
  await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, { waitUntil: "load", timeout: 30000 });
  await sleep(6000);
  const frame = page.frameLocator("#mainFrame");
  for (const s of ['button.se-popup-button-cancel', 'button:has-text("취소")']) {
    const b = frame.locator(s).first();
    if ((await b.count()) && (await b.isVisible().catch(() => false))) { await b.click().catch(() => {}); break; }
  }
  await sleep(1500);
  await frame.locator('button[class*="save_count"]').first().click().catch(() => {});
  await sleep(2000);
  await frame.locator('li[class*="item__"]').first().click().catch(() => {});
  await sleep(1500);
  for (const s of ['button.se-popup-button-confirm', 'button:has-text("확인")']) {
    const b = frame.locator(s).first();
    if ((await b.count()) && (await b.isVisible().catch(() => false))) { await b.click().catch(() => {}); break; }
  }
  await sleep(5000);

  const paras = (await frame.locator(".se-component.se-text .se-text-paragraph").allInnerTexts())
    .map((t) => t.replace(/​/g, "").trim())
    .filter(Boolean);

  console.log("=== 소스 문장 (" + srcLines.length + ") ===");
  console.log("=== 초안 문단 (" + paras.length + ") ===\n");

  const norm = (s) => s.replace(/\s+/g, "");
  let missing = [];
  for (const s of srcLines) {
    if (!paras.some((p) => norm(p) === norm(s) || norm(p).includes(norm(s)))) missing.push(s);
  }
  let extra = [];
  for (const p of paras) {
    if (!srcLines.some((s) => norm(s) === norm(p) || norm(s).includes(norm(p)))) extra.push(p);
  }
  console.log("빠진 문장:", missing.length ? missing : "없음 ✅");
  console.log("\n초안에만 있는 문단(마커찌꺼기 등):", extra.length ? extra : "없음 ✅");

  await browser.close();
})();
