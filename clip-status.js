// 클립 크리에이터 '콘텐츠' 목록을 읽어 각 클립의 제목·카테고리·상태(공개/초안/예약 등)·날짜·조회수를 JSON 으로 출력한다. 읽기만 하고 아무것도 바꾸지 않는다.
// 실행: node clip-status.js     (여러 계정이면 NAVER_ACCOUNT=계정이름)
// 출력 마지막 줄: CLIP_LIST_JSON:{"ok":true,"rows":[{title,category,status,date,views,likes,duration}]}

const { chromium } = require("playwright");
const fs = require("fs");
const { STATE_FILE } = require("./lib/paths");
const { autoSaveSession } = require("./lib/session");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!fs.existsSync(STATE_FILE)) {
    console.log("CLIP_LIST_JSON:" + JSON.stringify({ ok: false, reason: "login" }));
    process.exit(2);
  }
  const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] });
  try {
    const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1500, height: 1100 } });
    autoSaveSession(browser, ctx); // 닫을 때 갱신된 로그인 쿠키를 세션 파일에 저장
    const p = await ctx.newPage();
    await p.goto("https://clipcreators.naver.com/web/contents/clips", { waitUntil: "domcontentloaded", timeout: 40000 });
    await sleep(5000);
    if (/nidlogin|nid\.naver\.com/.test(p.url())) {
      console.log("CLIP_LIST_JSON:" + JSON.stringify({ ok: false, reason: "login" }));
      process.exit(2);
    }
    // 목록이 더 있으면 끝까지 스크롤해서 모두 불러온다 (개수가 더 늘지 않으면 멈춤)
    const readRows = () =>
      p.evaluate(() =>
        [...document.querySelectorAll("tr, li")]
          .map((e) => (e.innerText || "").trim())
          .filter((t) => /(공개|초안|예약|비공개|임시|대기)/.test(t) && t.split("\n").length >= 3 && t.length < 500)
      );
    let last = -1;
    for (let i = 0; i < 20; i++) {
      const n = (await readRows()).length;
      if (n === last) break;
      last = n;
      await p.mouse.move(700, 700);
      await p.mouse.wheel(0, 2500);
      await sleep(1200);
    }
    const raw = await readRows();
    const rows = [];
    for (const text of raw) {
      const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
      // 예: ["0:26", "고무장갑 추천합니다.", "리빙, 홈", "공개", "2026.10.07", "6", "0", "분석"]
      //     ["0:28", "다룸…mobile.mp4", "카테고리 선택", "초안", "-", "-", "-"]
      const duration = /^\d+:\d{2}$/.test(lines[0]) ? lines.shift() : "";
      const statusIdx = lines.findIndex((l) => /^(공개|초안|예약|비공개|임시저장|대기)/.test(l));
      if (statusIdx < 1) continue;
      const title = lines.slice(0, Math.max(1, statusIdx - 1)).join(" ");
      const category = lines[statusIdx - 1] || "";
      const status = lines[statusIdx];
      const rest = lines.slice(statusIdx + 1).flatMap((l) => l.split(/\s+/).filter(Boolean));
      const date = rest.find((l) => /^\d{4}\.\d{2}\.\d{2}/.test(l)) || "";
      const nums = rest.filter((l) => /^[\d,]+$/.test(l));
      rows.push({ title, category, status, date, views: nums[0] || "", likes: nums[1] || "", duration });
    }
    console.log("CLIP_LIST_JSON:" + JSON.stringify({ ok: true, rows }));
  } catch (e) {
    console.log("CLIP_LIST_JSON:" + JSON.stringify({ ok: false, reason: e.message.split("\n")[0].slice(0, 120) }));
    process.exitCode = 1;
  } finally {
    await browser.close().catch(() => {});
  }
})();
