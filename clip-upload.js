// 쇼핑클립 반자동 업로드: 클립 크리에이터 업로드 화면을 열어 영상·커버·설명·카테고리·광고협찬·쇼핑커넥트 상품까지 채운다.
// --publish 이면 채운 뒤 '등록'까지 자동으로 눌러 즉시 공개한다. --reserve "YYYY-MM-DD HH:MM" 이면 '등록 예약'을 맞추고 '등록'을 눌러 그 시각에 공개되게 한다.
// 둘 다 없으면 '등록'은 누르지 않고 화면을 열어 둔다. --no-submit 이면 위 옵션이 있어도 등록을 누르지 않는다(시험용).
// 필수 항목(설명·카테고리·AI/광고 스위치·쇼핑커넥트 상품·예약 시각) 중 하나라도 실패하면 자동 등록하지 않고 화면을 열어 둔다.
// --no-hold (일괄 실행용): 실패해도 창을 열어 두고 기다리지 않고, 창을 닫고 종료 코드로 알린다. 4 = 필수 항목 실패(등록 안 함), 5 = 등록 단계 실패.
//
// 사용:
//   node clip-upload.js --path "<상품 폴더 전체 경로>" [--draft <이미 올린 임시 클립 번호>] [--video full|mobile] [--hold-secs 3600]
//   (--draft 를 주면 영상은 새로 올리지 않고 그 임시 클립에 채운다. 시험용)
//
// 종료 코드: 0 = 채우기를 끝내고 창이 닫히거나 이동해서 종료, 1 = 오류

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const config = require("./clip-config.json");
const { STATE_FILE, LOG_DIR } = require("./lib/paths");
const { autoSaveSession } = require("./lib/session");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const log = (m) => console.log(`[${new Date().toLocaleTimeString("sv-SE")}] ${m}`);

const CLIP_DIR = "클립영상";
const DONE_FILE = "_클립업로드완료.txt";
const MAX_DESC = 300;

// "[제목] … [설명] … [해시태그] …" 형식 문구를 항목별로 나눈다 (대시보드와 같은 규칙)
function parseClipText(text) {
  const sections = {};
  let key = null;
  for (const line of String(text || "").split(/\r?\n/)) {
    const m = /^\[(.+?)\]\s*$/.exec(line.trim());
    if (m) { key = m[1].replace(/\s+/g, ""); sections[key] = []; continue; }
    if (key) sections[key].push(line);
  }
  const pick = (k) => (sections[k] || []).join("\n").trim();
  return { title: pick("제목"), description: pick("설명"), hashtags: pick("해시태그") };
}

// 제목 입력칸이 없으므로 설명 + 해시태그를 쓴다. 300자를 넘으면 설명을 문장 단위로 줄인다.
function buildDescription(text) {
  const tags = text.hashtags;
  const join = (d) => [d, tags].filter(Boolean).join("\n\n");
  let desc = text.description;
  if (join(desc).length <= MAX_DESC) return join(desc);
  const sentences = desc.split(/(?<=[.!?요])\s+/);
  while (sentences.length > 1 && join(sentences.join(" ")).length > MAX_DESC) sentences.pop();
  desc = sentences.join(" ");
  return join(desc).slice(0, MAX_DESC);
}

function pickCategory(folderName) {
  for (const rule of config.categoryRules || []) {
    if (rule.keywords.some((k) => folderName.includes(k))) return rule;
  }
  return config.defaultCategory;
}

(async () => {
  const productPath = arg("path");
  if (!productPath || !fs.existsSync(path.join(productPath, CLIP_DIR))) {
    console.log("⛔ --path 에 클립영상 폴더가 있는 상품 폴더를 주세요.");
    process.exit(1);
  }
  if (!fs.existsSync(STATE_FILE)) {
    console.log("⛔ 네이버 로그인 세션이 없습니다. node login.js 먼저.");
    process.exit(1);
  }
  const folderName = path.basename(productPath);
  const productName = folderName.replace(/^\d+_/, "").trim();
  const clipDir = path.join(productPath, CLIP_DIR);
  const files = fs.readdirSync(clipDir);
  const wantMobile = (arg("video") || config.video) === "mobile";
  const videoFile = files.find((f) => (wantMobile ? /_mobile\.mp4$/i : /\.mp4$/i).test(f) && (wantMobile || !/_mobile\.mp4$/i.test(f)) && !/_음악없음\.mp4$/i.test(f));
  const coverFile = files.find((f) => /커버\.(jpe?g|png)$/i.test(f));
  const textFile = files.find((f) => /업로드문구\.txt$/i.test(f));
  const articlePath = path.join(productPath, "붙여넣기본문.txt");
  const blogTitle = fs.existsSync(articlePath) ? (/^\s*제목\s*[:：]\s*(.+)$/m.exec(fs.readFileSync(articlePath, "utf8"))?.[1] || "").trim() : "";
  const draftId = arg("draft");
  const reserveAt = arg("reserve"); // "YYYY-MM-DD HH:MM"
  const reserveMatch = reserveAt ? /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(reserveAt) : null;
  if (reserveAt && !reserveMatch) { console.log('⛔ --reserve 는 "YYYY-MM-DD HH:MM" 형식이어야 합니다.'); process.exit(1); }
  const noHold = process.argv.includes("--no-hold");
  const wantSubmit = !process.argv.includes("--no-submit") && (process.argv.includes("--publish") || !!reserveAt);
  if (!videoFile && !draftId) { console.log("⛔ 영상 파일이 없습니다."); process.exit(1); }
  const text = textFile ? parseClipText(fs.readFileSync(path.join(clipDir, textFile), "utf8").replace(/^﻿/, "")) : { description: "", hashtags: "" };
  const description = buildDescription(text);
  const category = pickCategory(folderName);
  // 상품 검색어: 폴더 이름(번호 뗀 것)을 먼저, 안 나오면 참고글.txt 의 전체 상품명
  const refPath = path.join(productPath, "참고글.txt");
  const fullName = fs.existsSync(refPath) ? (/^제품\s*:\s*(.+)$/m.exec(fs.readFileSync(refPath, "utf8"))?.[1] || "").replace(/\s*\/.*$/, "").trim() : "";

  log(`상품: ${productName} | 영상: ${draftId ? `(임시 클립 ${draftId} 재사용)` : videoFile} | 커버: ${coverFile || "없음"}`);
  log(`설명 ${description.length}자 | 카테고리: ${category.category1} > ${category.category2} | AI활용 ${config.aiUsed ? "ON" : "OFF"} | 광고·협찬 ${config.adSponsored ? "ON" : "OFF"}`);

  const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--disable-blink-features=AutomationControlled", "--start-maximized"] });
  const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: null });
  autoSaveSession(browser, ctx); // 닫을 때 갱신된 로그인 쿠키를 세션 파일에 저장
  const p = await ctx.newPage();
  const warnings = [];
  const critical = []; // 실패하면 자동 등록을 막는 필수 단계
  const CRITICAL = /^(설명|카테고리|AI 활용|광고|쇼핑커넥트 상품|등록 예약)/;
  const step = async (name, fn) => {
    try { await fn(); log(`✔ ${name}`); return true; }
    catch (e) {
      const msg = `${name}: ${e.message.split("\n")[0].slice(0, 100)}`;
      warnings.push(msg);
      if (CRITICAL.test(name)) critical.push(msg);
      log(`⚠️ ${name} 실패 — ${e.message.split("\n")[0].slice(0, 100)}`);
      return false;
    }
  };
  const LIVE_SHOT = path.join(LOG_DIR, "clip-live.jpg");
  const shot = async (n) => { try { fs.mkdirSync(LOG_DIR, { recursive: true }); await p.screenshot({ path: path.join(LOG_DIR, `clip-${n}.png`) }); } catch {} };
  const liveShot = async () => { try { fs.mkdirSync(LOG_DIR, { recursive: true }); await p.screenshot({ path: LIVE_SHOT, type: "jpeg", quality: 60, fullPage: false }); } catch {} };
  let liveShotInterval = null;
  const startLiveShot = () => { if (liveShotInterval) return; liveShotInterval = setInterval(liveShot, 2500); };
  const stopLiveShot = () => { if (liveShotInterval) { clearInterval(liveShotInterval); liveShotInterval = null; } };

  try {
    // 1) 영상 올리기 (또는 임시 클립 열기)
    if (draftId) {
      await p.goto(`https://clipcreators.naver.com/web/draft/${draftId}`, { waitUntil: "domcontentloaded", timeout: 40000 });
    } else {
      await p.goto("https://clipcreators.naver.com/web/upload", { waitUntil: "domcontentloaded", timeout: 40000 });
      await p.waitForTimeout(4000);
      await p.locator("input[type=file]").first().setInputFiles(path.join(clipDir, videoFile));
    }
    await p.waitForSelector("textarea", { timeout: 60000 });
    await p.waitForTimeout(1500);
    log(`입력 화면 열림: ${p.url()}`);
    startLiveShot();

    // 2) 설명
    await step("설명 입력", async () => {
      const ta = p.locator("textarea").first();
      await ta.fill(description);
      if ((await ta.inputValue()).length < 10) throw new Error("설명이 입력되지 않음");
    });

    // 3) 커버: 만들어 둔 커버 이미지를 첫 칸에 올린다
    if (coverFile) {
      await step("커버 이미지 올리기", async () => {
        const input = p.locator("input[type=file][accept*=image], input[type=file][accept*=jpg], input[type=file][accept*=png]").first();
        if (!(await input.count())) throw new Error("커버 올리기 입력칸을 찾지 못함");
        await input.setInputFiles(path.join(clipDir, coverFile));
        await p.waitForTimeout(4000);
      });
    }

    // 4) 카테고리
    const chooseCategory = async (placeholder, name) => {
      const btn = p.locator("button", { hasText: new RegExp(`^(${placeholder}|.+)$`) }).filter({ hasText: placeholder }).first();
      await btn.click();
      await p.waitForTimeout(700);
      await p.getByText(name, { exact: true }).first().click();
      await p.waitForTimeout(900);
    };
    await step(`카테고리 1차 (${category.category1})`, async () => {
      const first = p.locator("button", { hasText: /^(1차 카테고리|플레이스|여행|푸드|일상기록|엔터|음악|뷰티|패션|프로스포츠|아웃도어, 운동|미술|경제|과학|리빙, 홈|동물|라이프스타일|테크|문학|인문, 교양|이슈|건강, 의학|유머|교육|어학, 외국어|자동차|전쟁|범죄|재난|종교|정치|커리어|커뮤니케이션|생산성|지도, 네비게이션|라이프 이벤트|시상식, 행사|장르)$/ }).first();
      await first.click();
      await p.waitForTimeout(700);
      await p.getByText(category.category1, { exact: true }).first().click();
      await p.waitForTimeout(900);
    });
    await step(`카테고리 2차 (${category.category2})`, async () => {
      await p.locator("button", { hasText: /^2차 카테고리$|^(인테리어, DIY|원예, 재배|공간정리|육아, 결혼|연애|10대|싱글 라이프|가족|스킨케어|헤어스타일, 헤어케어|메이크업|네일|향수|남성화장품|인터넷, AI|IT, 컴퓨터|휴대폰 및 액세서리|게임기|요리, 레시피)$/ }).first().click();
      await p.waitForTimeout(700);
      await p.getByText(category.category2, { exact: true }).first().click();
      await p.waitForTimeout(900);
    });

    // 5) 스위치: AI 활용 / 광고·협찬
    const setSwitch = async (labelRegex, want) => {
      const box = p.getByText(labelRegex).first().locator("xpath=following::input[@type='checkbox'][1]");
      if ((await box.isChecked().catch(() => false)) !== want) {
        await box.setChecked(want, { force: true }).catch(async () => { await box.click({ force: true }); });
        await p.waitForTimeout(800);
      }
      if ((await box.isChecked().catch(() => !want)) !== want) throw new Error("스위치 상태를 맞추지 못함");
    };
    await step(`AI 활용 설정 ${config.aiUsed ? "ON" : "OFF"}`, () => setSwitch(/^AI 활용 설정/, !!config.aiUsed));
    await step(`광고·협찬 설정 ${config.adSponsored ? "ON" : "OFF"}`, () => setSwitch(/^광고.협찬 설정/, !!config.adSponsored));
    await shot("after-switches");

    // 6) 쇼핑커넥트 상품 연결
    await step(`쇼핑커넥트 상품 연결 (${productName})`, async () => {
      await p.getByRole("button", { name: "쇼핑커넥트" }).first().click();
      await p.waitForTimeout(2500);
      const search = p.locator("input[placeholder*='쇼핑 상품 검색']").first();
      const trySearch = async (query) => {
        await search.fill(query);
        await search.press("Enter");
        await p.waitForTimeout(2500);
        const rows = p.locator("li, div").filter({ has: p.getByRole("button", { name: "선택" }) });
        return rows;
      };
      const tokens = productName.split(/\s+/).filter((t) => t.length >= 2);
      const pickRow = async (query) => {
        await trySearch(query);
        const buttons = p.getByRole("button", { name: "선택", exact: true });
        const n = await buttons.count();
        for (let i = 0; i < n; i++) {
          const rowText = await buttons.nth(i).locator("xpath=ancestor::*[self::li or self::div][.//img][1]").innerText().catch(() => "");
          if (tokens.length && tokens.filter((t) => rowText.includes(t)).length >= Math.min(2, tokens.length)) return buttons.nth(i);
        }
        return null;
      };
      let target = await pickRow(productName);
      if (!target && fullName) target = await pickRow(fullName);
      // 이름 매칭 실패 시: 짧은 키워드로 검색해서 첫 번째 결과 선택 (폴백)
      if (!target) {
        const shortQuery = (fullName || productName).split(/\s+/).slice(0, 3).join(" ");
        await trySearch(shortQuery);
        const firstBtn = p.getByRole("button", { name: "선택", exact: true }).first();
        if (await firstBtn.count()) {
          log(`⚠️ 상품 정확 매칭 실패 → "${shortQuery}" 첫 번째 결과 선택`);
          target = firstBtn;
        }
      }
      if (!target) { log("⚠️ 쇼핑커넥트 상품을 찾지 못함 — 연결 없이 진행"); return; }
      await target.click();
      await p.waitForTimeout(2000);
    });
    // 6-2) 같은 상품의 블로그 글 연결 (콘텐츠 링크). 공개된 글만 목록에 나오므로, 아직 공개 전이면 경고만 남기고 넘어간다.
    if (config.linkBlog !== false && blogTitle) {
      await step(`블로그 글 연결 (${blogTitle})`, async () => {
        await p.getByRole("button", { name: "블로그" }).first().click();
        await p.waitForTimeout(2500);
        const strip = (t) => String(t).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
        const clickMatch = async () => {
          const buttons = p.getByRole("button", { name: "선택", exact: true });
          const n = await buttons.count();
          for (let i = 0; i < n; i++) {
            const rowText = strip(await buttons.nth(i).locator("xpath=ancestor::*[self::li or self::div][1]").innerText().catch(() => ""));
            if (rowText.includes(blogTitle)) { await buttons.nth(i).click(); await p.waitForTimeout(1500); return true; }
          }
          return false;
        };
        // 1) 지금 글 제목으로 검색해서, 제목이 정확히 같은 글을 고른다. 안 나오면 상품 이름의 첫 단어(예: "다룸")로 한 번 더.
        const search = p.locator("input[placeholder*='블로그 검색']").first();
        for (const query of [...new Set([blogTitle, productName.split(/\s+/)[0]].filter(Boolean))]) {
          await search.fill(query);
          await search.press("Enter");
          await p.waitForTimeout(2500);
          if (await clickMatch()) { log(`   (검색어 "${query}"로 연결: 화면의 연결 제목에 태그 모양이 보여도 정상 연결입니다)`); return; }
        }
        // 2) 그래도 못 찾으면 검색을 비우고 기본 목록을 스크롤하며 찾는다.
        await search.fill("");
        await search.press("Enter");
        await p.waitForTimeout(2000);
        if (await clickMatch()) return;
        for (let i = 0; i < 25; i++) {
          await p.mouse.move(700, 650);
          await p.mouse.wheel(0, 700);
          await p.waitForTimeout(900);
          if (await clickMatch()) return;
        }
        await p.keyboard.press("Escape");
        throw new Error("공개된 블로그 글에서 같은 제목을 찾지 못함 — 글을 공개한 뒤 이 클립의 콘텐츠 링크에서 연결하세요");
      });
    }
    // 6-3) 예약 발행이면 '등록 예약'을 체크하고 날짜·시간·분을 맞춘다.
    if (reserveMatch) {
      const [, Y, M, D, HH, MM] = reserveMatch;
      await step(`등록 예약 설정 (${reserveAt})`, async () => {
        await p.getByText("등록 예약", { exact: true }).first().locator("xpath=preceding::input[@type='checkbox'][1]").setChecked(true, { force: true });
        await p.waitForTimeout(1200);
        log("   · 등록 예약 체크함");
        // 날짜: 달력을 열어 월을 맞추고 날짜를 눌러 '저장'
        await p.locator("button", { hasText: /^\d{4}\.\d{2}\.\d{2}$/ }).first().click();
        await p.waitForTimeout(800);
        log("   · 달력 열림");
        const header = p.getByText(/^\d{4}년 \d{1,2}월$/).first();
        const cal = header.locator("xpath=ancestor::*[.//button][1]");
        const want = `${Number(Y)}년 ${Number(M)}월`;
        for (let i = 0; i < 24; i++) {
          const cur = (await header.innerText()).trim();
          if (cur === want) break;
          const m = /^(\d{4})년 (\d{1,2})월$/.exec(cur);
          const diff = (Number(Y) - Number(m[1])) * 12 + (Number(M) - Number(m[2]));
          await cal.locator("button").nth(diff > 0 ? 2 : 1).click(); // ‹ 이전 달 / › 다음 달
          await p.waitForTimeout(400);
        }
        log("   · 달력 월 맞춤 시도 끝");
        if ((await header.innerText()).trim() !== want) throw new Error("달력을 원하는 달로 옮기지 못함");
        // 날짜 칸은 버튼이 아닐 수 있어서, 달력 전체(저장 버튼을 품은 가장 가까운 영역) 안에서 숫자 글자로 찾는다
        const calRoot = header.locator("xpath=ancestor::*[.//button[normalize-space()='저장']][1]");
        await calRoot.getByText(String(Number(D)), { exact: true }).first().click({ timeout: 8000 });
        await p.waitForTimeout(500);
        log("   · 날짜 클릭함");
        await p.getByRole("button", { name: "저장", exact: true }).click();
        await p.waitForTimeout(800);
        log("   · 달력 저장함");
        // 시간·분: 선택 목록을 열어 항목을 누른다
        for (const [label, value] of [["시간", HH], ["분", MM]]) {
          await p.locator(`button[aria-label='${label}']`).first().click();
          await p.waitForTimeout(700);
          await p.getByText(value, { exact: true }).last().click();
          await p.waitForTimeout(600);
          log(`   · ${label} 선택함`);
        }
        // 화면에 실제로 들어간 값을 다시 읽어 확인
        const shownDate = (await p.locator("button", { hasText: /^\d{4}\.\d{2}\.\d{2}$/ }).first().innerText()).trim();
        const shownH = (await p.locator("button[aria-label='시간']").first().innerText()).trim();
        const shownM = (await p.locator("button[aria-label='분']").first().innerText()).trim();
        if (shownDate !== `${Y}.${M}.${D}` || shownH !== HH || shownM !== MM) {
          throw new Error(`예약 시각이 맞지 않음: 화면 ${shownDate} ${shownH}:${shownM} / 요청 ${Y}.${M}.${D} ${HH}:${MM}`);
        }
      });
    }
    await shot("filled");

    // 6-4) 즉시발행/예약발행이면 필수 항목이 모두 성공했을 때만 '등록'을 누른다.
    if (wantSubmit) {
      if (critical.length) {
        log(`⛔ 필수 항목 ${critical.length}개가 실패해서 자동 등록하지 않습니다. 화면에서 직접 보완한 뒤 등록하세요.`);
        critical.forEach((c) => log(`   - ${c}`));
        if (noHold) { await shot("failed"); await browser.close().catch(() => {}); process.exit(4); }
      } else {
        const ok = await step(reserveMatch ? "등록 (예약)" : "등록 (즉시 공개)", async () => {
          const btn = p.getByRole("button", { name: "등록", exact: true }).last();
          // 영상 인코딩 중에는 등록 버튼이 비활성일 수 있어 켜질 때까지 기다린다 (최대 5분)
          for (let i = 0; i < 100 && !(await btn.isEnabled().catch(() => false)); i++) await sleep(3000);
          if (!(await btn.isEnabled().catch(() => false))) throw new Error("등록 버튼이 활성화되지 않음 (인코딩 중일 수 있음)");
          await btn.click();
          await p.waitForTimeout(2500);
          // 확인창이 뜨면 그 안의 '확인'/'등록'만 누른다
          const dlg = p.locator("[role=dialog] button, [class*=modal] button, [class*=Modal] button").filter({ hasText: /^(확인|등록)$/ }).first();
          if (await dlg.count()) { await dlg.click().catch(() => {}); }
          // 화면이 임시 클립(draft) 주소에서 벗어나면 등록된 것으로 본다 (최대 90초)
          let moved = false;
          for (let i = 0; i < 30; i++) {
            await sleep(3000);
            if (p.isClosed()) break;
            if (!/\/web\/draft\//.test(p.url())) { moved = true; break; }
          }
          if (!moved) throw new Error("등록 후 화면이 이동하지 않음 — 등록되었는지 직접 확인하세요");
          fs.writeFileSync(path.join(productPath, DONE_FILE), `${new Date().toISOString()}\n${reserveMatch ? `예약 ${reserveAt}` : "즉시 공개"}`, "utf8");
        });
        if (!ok && noHold) { stopLiveShot(); await shot("failed"); await browser.close().catch(() => {}); process.exit(5); }
        if (ok) {
          log(reserveMatch ? `등록 완료 — ${reserveAt}에 공개되도록 예약했습니다. 올림 표시를 남겼습니다.` : "등록 완료 — 즉시 공개되었습니다. 올림 표시를 남겼습니다.");
          stopLiveShot();
          await sleep(2000);
          await browser.close().catch(() => {});
          process.exit(0);
        }
      }
    }

    log("──────────────────────────────────────────────");
    log(wantSubmit ? "자동 등록이 끝나지 않았습니다. 화면에서 확인하고 필요하면 직접 등록하세요." : "채우기 끝. 화면에서 내용을 확인하고 직접 '등록'을 누르세요.");
    if (warnings.length) log(`⚠️ 직접 확인/보완할 항목: ${warnings.join(" / ")}`);
    log("──────────────────────────────────────────────");

    // 7) 사람이 등록할 때까지 창을 열어 둔다. draft/upload 화면에서 벗어나면 등록된 것으로 보고 올림 표시를 남긴다.
    const holdMs = Number(arg("hold-secs") || 3600) * 1000;
    const until = Date.now() + holdMs;
    while (Date.now() < until && !p.isClosed()) {
      await sleep(3000);
      let url = "";
      try { url = p.url(); } catch { break; }
      if (url && !/\/web\/draft\//.test(url) && !/\/web\/upload/.test(url)) {
        fs.writeFileSync(path.join(productPath, DONE_FILE), `${new Date().toISOString()}\n즉시 공개`, "utf8");
        log("화면이 이동했습니다. 올림 표시를 자동으로 남겼습니다.");
        stopLiveShot();
        break;
      }
    }
    await browser.close().catch(() => {});
    process.exit(0);
  } catch (e) {
    stopLiveShot();
    log(`❌ 오류: ${e.message}`);
    await shot("error");
    await browser.close().catch(() => {});
    process.exit(1);
  }
})();
