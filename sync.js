// 자동 동기화: 구글 드라이브 공유폴더에서 아직 임시저장 안 한 글만 골라 네이버에 임시저장.
// 실행: node sync.js   (예약작업으로 정해진 시간에 자동 실행)
//
// 규칙
//  - postsDir 안의 폴더 중 "_완료.txt" 가 없는 것만 대상
//  - 본문(붙여넣기본문.txt) 파싱되고, 사진이 사진자리 수 이상 있어야 "준비됨"
//  - 준비 안 된 폴더는 건너뛰고 다음 회차에 재시도
//  - 임시저장 성공하면 그 폴더에 "_완료.txt" 기록
//  - 매 실행 결과를 상위 폴더의 "_협업.txt" 에 남김 (장환·한성이 확인)

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const config = require("./config.json");
const { parseFolder, listPostFolders } = require("./lib/parse");
const { writeOne } = require("./post.js");
const { STATE_FILE, LOG_DIR } = require("./lib/paths");

fs.mkdirSync(LOG_DIR, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleString("sv-SE").replace("T", " ").slice(0, 16); // YYYY-MM-DD HH:MM

const DONE = "_완료.txt";
const COLLAB = path.join(path.dirname(config.postsDir), "_협업.txt");

function logCollab(lines) {
  const block = `\n[효석 ${stamp()}]\n` + lines.map((l) => "  " + l).join("\n") + "\n";
  try {
    fs.appendFileSync(COLLAB, block, "utf8");
  } catch (e) {
    console.log("_협업.txt 기록 실패:", e.message);
  }
}

// 폴더가 임시저장할 준비가 됐는지 판단
function readiness(folder) {
  try {
    const p = parseFolder(folder);
    if (!p.title) return { ready: false, why: "제목 없음" };
    if (p.stats.imageSlots > 0 && p.stats.photosFound < p.stats.imageSlots) {
      return { ready: false, why: `사진 ${p.stats.photosFound}/${p.stats.imageSlots}` };
    }
    return { ready: true, post: p };
  } catch (e) {
    return { ready: false, why: e.message };
  }
}

(async () => {
  console.log(`\n=== sync ${stamp()} ===`);
  console.log(`postsDir: ${config.postsDir}`);

  if (config.mode !== "draft") {
    console.log("⛔ sync.js 는 draft 모드에서만 사용하세요. (config.mode)");
    process.exit(1);
  }
  if (!fs.existsSync(STATE_FILE)) {
    console.log("⛔ 네이버 로그인 세션 없음. node login.js 먼저.");
    logCollab(["실행 실패: 네이버 로그인 세션 없음 (node login.js 필요)"]);
    process.exit(1);
  }

  const all = listPostFolders(config.postsDir);
  const pending = all.filter((f) => !fs.existsSync(path.join(f, DONE)));

  if (!pending.length) {
    console.log("새로 처리할 폴더 없음 (전부 _완료.txt 있음).");
    process.exit(0);
  }

  const ready = [];
  const waiting = [];
  for (const f of pending) {
    const r = readiness(f);
    if (r.ready) ready.push({ folder: f, post: r.post });
    else waiting.push({ name: path.basename(f), why: r.why });
  }

  console.log(`대기중(미완성) ${waiting.length}개:`);
  waiting.forEach((w) => console.log(`  - ${w.name} (${w.why})`));
  console.log(`임시저장 대상 ${ready.length}개.`);

  if (!ready.length) {
    logCollab([
      `새 폴더 ${pending.length}개 확인. 준비된 글 없음.`,
      ...waiting.map((w) => `대기: ${w.name} (${w.why})`),
    ]);
    process.exit(0);
  }

  const browser = await chromium.launch({
    headless: config.headless,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized"],
  });
  const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: null, acceptDownloads: false });
  const page = await ctx.newPage();

  await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, {
    waitUntil: "domcontentloaded",
    timeout: 25000,
  });
  await sleep(4000);
  if (/nidlogin|nid\.naver\.com/.test(page.url())) {
    console.log("⛔ 네이버 로그인 만료. node login.js 다시.");
    logCollab(["실행 실패: 네이버 로그인 만료 (node login.js 필요)"]);
    await browser.close();
    process.exit(1);
  }

  const results = [];
  for (let i = 0; i < ready.length; i++) {
    const { folder, post } = ready[i];
    const name = path.basename(folder);
    console.log(`\n[${i + 1}/${ready.length}] ${name}`);
    try {
      await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, { waitUntil: "domcontentloaded" });
      await writeOne(page, post);
      fs.writeFileSync(path.join(folder, DONE), `${stamp()} 네이버 임시저장 완료 (효석)\n`, "utf8");
      results.push({ name, ok: true });
    } catch (e) {
      console.log(`   ❌ 오류: ${e.message}`);
      await page.screenshot({ path: path.join(LOG_DIR, `${name}-error.png`), fullPage: true }).catch(() => {});
      results.push({ name, ok: false, error: e.message });
    }
    if (i < ready.length - 1) {
      console.log(`   ${config.betweenPostsDelaySec}초 대기...`);
      await sleep(config.betweenPostsDelaySec * 1000);
    }
  }

  await browser.close().catch(() => {});

  const ok = results.filter((r) => r.ok).map((r) => r.name);
  const fail = results.filter((r) => !r.ok);
  console.log(`\n결과: 성공 ${ok.length} / 실패 ${fail.length}`);

  logCollab([
    `임시저장 완료: ${ok.length}개${ok.length ? " — " + ok.join(", ") : ""}`,
    ...fail.map((f) => `실패: ${f.name} — ${f.error}`),
    ...waiting.map((w) => `대기(미완성): ${w.name} (${w.why})`),
  ]);

  console.log("완료.\n");
})();
