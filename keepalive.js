// 저장된 네이버 로그인 세션이 아직 살아 있는지 확인하고, 살아 있으면 세션 파일을 새로 저장해 유효기간을 이어 간다.
// 실행: node keepalive.js        (여러 계정이면 NAVER_ACCOUNT=계정이름 node keepalive.js)
//
// - 비밀번호는 다루지 않는다. 이미 저장된 세션(naver-state.json)만 쓴다.
// - 로그인이 풀려 있으면 세션 파일을 건드리지 않고 "다시 로그인 필요"만 알린다. (정상 세션을 로그아웃 상태로 덮어쓰지 않는다)
// - 종료 코드: 0 = 로그인 유지됨(갱신 저장), 2 = 로그인 필요, 1 = 확인 실패(네트워크 등)

const { chromium } = require("playwright");
const fs = require("fs");
const config = require("./config.json");
if (process.env.NAVER_BLOG_ID) config.blogId = process.env.NAVER_BLOG_ID;
const { STATE_FILE } = require("./lib/paths");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleString("sv-SE");

const authOK = (cookies) => {
  const a = cookies.find((c) => c.name === "NID_AUT" && c.value.length > 20);
  const s = cookies.find((c) => c.name === "NID_SES" && c.value.length > 20);
  return !!(a && s);
};

async function check(headless) {
  const browser = await chromium.launch({
    headless,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  });
  try {
    const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    await page.goto("https://www.naver.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(3000);
    // 블로그 글쓰기 주소가 로그인 페이지로 튕기는지로 판단한다 (프로그램이 실제로 쓰는 경로)
    await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(3500);
    if (/nidlogin|nid\.naver\.com/.test(page.url())) return { ok: false, reason: "login" };
    const cookies = await ctx.cookies();
    if (!authOK(cookies)) return { ok: false, reason: "login" };
    return { ok: true, state: await ctx.storageState() };
  } finally {
    await browser.close().catch(() => {});
  }
}

(async () => {
  if (!fs.existsSync(STATE_FILE)) {
    console.log(`[${stamp()}] 세션 파일이 없습니다. node login.js 로 먼저 로그인하세요.`);
    process.exit(2);
  }
  let result;
  try {
    result = await check(true);
    if (!result.ok && result.reason !== "login") throw new Error(result.reason);
    // 화면 없이는 로그인 풀림으로 보여도 한 번 더 창을 띄워 확인 (대시보드 자동 실행 때는 창을 띄우지 않는다)
    if (!result.ok && !process.env.KEEPALIVE_HEADLESS_ONLY) result = await check(false);
  } catch (e) {
    if (process.env.KEEPALIVE_HEADLESS_ONLY) result = { ok: false, reason: e.message };
    else try { result = await check(false); } catch (e2) { result = { ok: false, reason: e2.message }; }
  }
  if (result.ok) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(result.state, null, 2), "utf8");
    const ses = result.state.cookies.find((c) => c.name === "NID_SES" && /naver\.com$/.test(c.domain));
    const left = ses && ses.expires > 0 ? Math.round(((ses.expires - Date.now() / 1000) / 86400) * 10) / 10 : "?";
    console.log(`[${stamp()}] 로그인 유지됨 — 세션 갱신 저장 (NID_SES 남은 ${left}일)`);
    process.exit(0);
  }
  if (result.reason === "login") {
    console.log(`[${stamp()}] 로그인이 풀렸습니다. node login.js 로 다시 로그인하세요. (세션 파일은 건드리지 않았습니다)`);
    process.exit(2);
  }
  console.log(`[${stamp()}] 확인 실패: ${result.reason}`);
  process.exit(1);
})();
