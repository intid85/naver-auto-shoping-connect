// 네이버는 쓸 때마다 세션 쿠키(NID_SES 등)를 새로 내려준다. 새 쿠키를 버리고 옛 쿠키를 계속 쓰면
// 결국 로그인이 풀리므로, 브라우저를 닫기 전(그리고 오래 열려 있으면 주기적으로) 세션 파일에 다시 저장한다.
// - 로그인된 상태일 때만 저장한다. 로그아웃된 쿠키로 정상 세션 파일을 덮어쓰지 않는다.
// - 임시 파일에 쓴 뒤 바꿔치기해서, 여러 스크립트가 동시에 써도 파일이 깨지지 않게 한다.
const fs = require("fs");
const { STATE_FILE } = require("./paths");

const authOK = (cookies) => {
  const a = cookies.find((c) => c.name === "NID_AUT" && c.value.length > 20);
  const s = cookies.find((c) => c.name === "NID_SES" && c.value.length > 20);
  return !!(a && s);
};

async function saveSession(ctx) {
  try {
    const state = await ctx.storageState();
    if (!authOK(state.cookies)) return false;
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, STATE_FILE);
    return true;
  } catch {
    return false;
  }
}

// browser.close() 직전에 자동 저장 + 실행 중 5분마다 저장
function autoSaveSession(browser, ctx, intervalMs = 5 * 60 * 1000) {
  const timer = setInterval(() => saveSession(ctx), intervalMs);
  timer.unref();
  const close = browser.close.bind(browser);
  browser.close = async (...args) => {
    clearInterval(timer);
    await saveSession(ctx);
    return close(...args);
  };
}

module.exports = { authOK, saveSession, autoSaveSession };
