// 저장된 세션으로 글쓰기 -> 도움말 닫기 -> 임시저장 목록 -> 최신 글 불러오기 -> 스크린샷
const { chromium } = require("playwright");
const path = require("path");
const config = require("./config.json");
const { STATE_FILE, LOG_DIR } = require("./lib/paths");
const fs = require("fs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1500, height: 2600 } });
  const page = await ctx.newPage();
  await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, { waitUntil: "load", timeout: 30000 });
  await sleep(6000);
  const frame = page.frameLocator("#mainFrame");

  const clickIf = async (sel) => {
    const b = frame.locator(sel).first();
    if ((await b.count()) && (await b.isVisible().catch(() => false))) { await b.click().catch(() => {}); return true; }
    return false;
  };

  // 복구 팝업: 취소
  await clickIf('button.se-popup-button-cancel');
  await clickIf('button:has-text("취소")');
  await sleep(1500);

  // 도움말 패널 닫기
  await clickIf('.se-help-panel-close-button');
  await clickIf('button[aria-label="닫기"]');
  await sleep(1000);

  // 임시저장 목록 열기
  await clickIf('button[class*="save_count"]');
  await sleep(2500);
  await page.screenshot({ path: path.join(LOG_DIR, "drafts-list.png"), fullPage: true });

  // 목록 항목 덤프
  const items = await frame.locator('a, button, li').evaluateAll((els) =>
    els
      .filter((e) => /불러오기|삭제|임시|draft|saved/i.test((e.textContent || "") + (e.className || "")))
      .slice(0, 25)
      .map((e) => ({ t: (e.textContent || "").trim().slice(0, 30), c: (e.className || "").slice(0, 50), tag: e.tagName }))
  );
  console.log("목록 항목:", JSON.stringify(items, null, 1));

  // 첫 번째 임시저장 항목 클릭 (불러오기)
  let loaded = await clickIf('button:has-text("불러오기")') || await clickIf('a:has-text("불러오기")');
  if (!loaded) loaded = await clickIf('li.item__k1QHQ');
  if (!loaded) loaded = await clickIf('li[class*="item__k1QHQ"]');
  if (!loaded) loaded = await clickIf('li[class*="item__"] a, li[class*="item__"]');
  await sleep(1500);
  await clickIf('button.se-popup-button-confirm');
  await clickIf('button:has-text("확인")');
  await sleep(6000);

  await clickIf('.se-help-panel-close-button');
  await sleep(500);
  await page.screenshot({ path: path.join(LOG_DIR, "draft-check.png"), fullPage: true });

  let title = "", bodyLen = 0, imgCount = 0, strikeHtml = false;
  try { title = await frame.locator(".se-section-documentTitle").innerText({ timeout: 3000 }); } catch {}
  try { bodyLen = (await frame.locator(".se-component.se-text").allInnerTexts()).join("").length; } catch {}
  try { imgCount = await frame.locator(".se-component.se-image").count(); } catch {}
  try {
    const html = (await frame.locator(".se-component.se-text").allInnerHTMLs()).join("");
    strikeHtml = /line-through|<s>|<strike|<del/i.test(html);
  } catch {}
  const markerDebug = await frame
    .locator(".se-text-paragraph")
    .filter({ hasText: /ZZIMG|IMGSLOT|ZZSHOPPING|ZI\d+Z|ZTOPZ|ZBOTZ/i })
    .evaluateAll((elements) => elements.map((el) => {
      const editable = el.closest('[contenteditable="true"]');
      return {
        text: (el.textContent || "").trim(),
        paragraph: el.outerHTML,
        editableTag: editable?.tagName || null,
        editableClass: editable?.className || null,
        editableHtml: editable?.outerHTML?.slice(0, 1200) || null,
      };
    }));
  console.log("표식DOM:", JSON.stringify(markerDebug, null, 2));
  console.log(JSON.stringify({ 불러오기클릭: loaded, 제목: title.slice(0, 60), 본문글자수: bodyLen, 이미지수: imgCount, 취소선HTML흔적: strikeHtml }, null, 2));

  // 본문 문단 대조
  try {
    const { parseFolder, listPostFolders } = require("./lib/parse");
    const src = parseFolder(listPostFolders(config.postsDir)[config.startFrom - 1]);
    const srcLines = [];
    for (const b of src.blocks) if (b.type === "text") srcLines.push(...b.text.split("\n").filter((x) => x.trim()));
    const paras = (await frame.locator(".se-component.se-text .se-text-paragraph").allInnerTexts())
      .map((t) => t.replace(/[​﻿]/g, "").trim()).filter(Boolean);
    const norm = (s) => s.replace(/\s+/g, "");
    const missing = srcLines.filter((s) => !paras.some((p) => norm(p).includes(norm(s))));
    const junk = paras.filter((p) => norm(p).length > 3 && !srcLines.some((s) => norm(s).includes(norm(p))) && !/일상을 기록/.test(p));
    const markerOrFileNames = paras.filter((p) => /ZZIMG|IMGSLOT|\.jpe?g|\.png|\.gif|\.webp/i.test(p));
    console.log("\n소스문장", srcLines.length, "/ 초안문단", paras.length);
    console.log("빠진 문장:", missing.length ? missing : "없음 ✅");
    console.log("찌꺼기(마커 등):", junk.length ? junk : "없음 ✅");
    console.log("영문 사진표시:", markerOrFileNames.length ? markerOrFileNames : "없음 ✅");
  } catch (e) { console.log("대조 실패:", e.message); }

  await browser.close();
})();
