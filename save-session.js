const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const browser = await chromium.connectOverCDP('http://localhost:9222');
    const ctx = browser.contexts()[0];
    const statePath = path.join(process.env.USERPROFILE, '.naver-auto', 'naver-state.json');
    console.log('Saving to:', statePath);
    await ctx.storageState({ path: statePath });
    console.log('세션 저장 성공!');
    await browser.close();
  } catch(e) { console.error('Error:', e.message); }
})();
