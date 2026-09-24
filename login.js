// 네이버 로그인 -> 세션을 naver-state.json 으로 저장.
// 실행: npm run login
// 크롬 창에서 로그인. 로그 [Ns] 줄에 NID_AUT=O NID_SES=O 뜨면 채팅에 '완료'.

const { chromium } = require("playwright");
const fs = require("fs");
const { PROFILE_DIR, STATE_FILE, DONE_FILE } = require("./lib/paths");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (fs.existsSync(DONE_FILE)) fs.unlinkSync(DONE_FILE);

  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    channel: "chrome",
    viewport: null,
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized"],
  });

  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto("https://nid.naver.com/nidlogin.login?mode=form&url=https%3A%2F%2Fwww.naver.com");

  console.log("\n════════════════════════════════════════");
  console.log(" 이 크롬 창에서 네이버에 로그인하세요.");
  console.log(" - '로그인 상태 유지' 체크 / 'IP보안' 끄기");
  console.log(" - 로그가 NID_AUT=O NID_SES=O 되면 채팅에 '완료'");
  console.log("════════════════════════════════════════\n");

  const authOK = (cookies) => {
    const a = cookies.find((c) => c.name === "NID_AUT" && c.value.length > 20);
    const s = cookies.find((c) => c.name === "NID_SES" && c.value.length > 20);
    return a && s;
  };

  const DEADLINE = Date.now() + 30 * 60 * 1000;
  let tick = 0;
  let sawAuth = false;
  while (Date.now() < DEADLINE) {
    await sleep(2000);
    const cookies = await ctx.cookies().catch(() => []);
    if (authOK(cookies)) sawAuth = true;
    if (fs.existsSync(DONE_FILE)) break;
    tick += 2;
    if (tick % 10 === 0) {
      let url = "?";
      try { url = page.url(); } catch {}
      console.log(
        `[${tick}s] ${url.slice(0, 55)}  NID_AUT=${authOK(cookies) ? "O" : "x"}` +
          (authOK(cookies) ? "   <- 이제 채팅에 '완료'" : "")
      );
    }
  }
  const done = fs.existsSync(DONE_FILE);
  if (fs.existsSync(DONE_FILE)) fs.unlinkSync(DONE_FILE);

  const finalCookies = await ctx.cookies().catch(() => []);
  const good = authOK(finalCookies);

  // 세션 파일로 저장 (쿠키 + localStorage)
  await ctx.storageState({ path: STATE_FILE });

  console.log("\n최종 인증쿠키:", good ? "O (정상)" : "x (로그인 안 됨)");
  console.log("세션 파일:", STATE_FILE);
  if (!good && sawAuth) console.log("※ 중간엔 로그인됐다가 저장 시점에 빠졌습니다. 다시 시도하세요.");
  console.log(done ? "\n종료.\n" : "\n시간 초과.\n");

  await ctx.close();
  process.exit(good ? 0 : 1);
})();
