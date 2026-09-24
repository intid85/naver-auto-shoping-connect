const { chromium } = require("playwright");
const config = require("./config.json");
const { STATE_FILE } = require("./lib/paths");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1400, height: 2000 } });
  const page = await ctx.newPage();
  await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, { waitUntil: "load", timeout: 30000 });
  await sleep(6000);
  const frame = page.frameLocator("#mainFrame");
  const clickIf = async (sel) => { const b = frame.locator(sel).first(); if ((await b.count()) && (await b.isVisible().catch(()=>false))) { await b.click().catch(()=>{}); return true;} return false; };
  await clickIf('button.se-popup-button-cancel');
  await clickIf('button:has-text("취소")');
  await sleep(1200);
  await clickIf('.se-help-panel-close-button');
  await sleep(800);
  await clickIf('button[class*="save_count"]');
  await sleep(2500);
  (await clickIf('button:has-text("불러오기")')) || (await clickIf('li[class*="item__"]'));
  await sleep(1500);
  await clickIf('button.se-popup-button-confirm');
  await clickIf('button:has-text("확인")');
  await sleep(6000);

  const paras = (await frame.locator(".se-component.se-text .se-text-paragraph").allInnerTexts())
    .map((t) => t.replace(/[​﻿]/g, "").trim());
  const imgs = await frame.locator(".se-component.se-image").count();
  const links = await frame.locator('.se-component.se-oglink, .se-component[class*="oglink"]').count();
  console.log("이미지:", imgs, "/ 링크카드:", links);
  console.log("--- 문단 ---");
  paras.forEach((p, i) => console.log(String(i).padStart(2), JSON.stringify(p.slice(0, 90))));
  await browser.close();
})();
