// 임시저장 글 전부 삭제. 실행: node clean-drafts.js
const { chromium } = require("playwright");
const path = require("path");
const config = require("./config.json");
const { STATE_FILE, LOG_DIR } = require("./lib/paths");
const fs = require("fs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1400, height: 1200 } });
  const page = await ctx.newPage();
  await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, { waitUntil: "load", timeout: 30000 });
  await sleep(6000);
  const frame = page.frameLocator("#mainFrame");

  const clickIf = async (sel, dbl) => {
    const b = frame.locator(sel).first();
    if ((await b.count()) && (await b.isVisible().catch(() => false))) {
      await b.click().catch(() => {});
      return true;
    }
    return false;
  };

  await clickIf('button.se-popup-button-cancel');
  await clickIf('button:has-text("취소")');
  await sleep(1500);

  await clickIf('button[class*="save_count"]');
  await sleep(2500);
  await page.screenshot({ path: path.join(LOG_DIR, "clean-1-list.png"), fullPage: true });

  let deleted = 0;
  for (let i = 0; i < 50; i++) {
    const del = frame.locator('button[class*="delete_button"]').first();
    if (!(await del.count())) {
      console.log("삭제 버튼 더 없음");
      break;
    }
    await del.click().catch(() => {});
    await sleep(1000);
    // 확인 팝업 (여러 후보)
    const confirmed =
      (await clickIf('.se-popup-button-confirm')) ||
      (await clickIf('button:has-text("확인")')) ||
      (await clickIf('button:has-text("삭제")')) ||
      (await clickIf('.se-popup-button-text:has-text("확인")'));
    await sleep(1500);
    deleted++;
    console.log(`  삭제 ${deleted} (확인클릭=${confirmed})`);
  }
  await page.screenshot({ path: path.join(LOG_DIR, "clean-2-after.png"), fullPage: true });
  console.log(`\n총 ${deleted}개 삭제 시도`);
  await browser.close();
})();
