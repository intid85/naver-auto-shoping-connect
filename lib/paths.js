// 런타임 데이터(크롬 프로필, 세션 파일, 로그)는 OneDrive 밖에 둔다.
// OneDrive 동기화가 SQLite 쿠키 파일을 깨뜨리기 때문.
//
// 네이버 계정이 여러 개일 수 있어서, 환경변수 NAVER_ACCOUNT로 계정을 지정하면
// 그 계정 전용 폴더(accounts/<이름>/)에 세션·크롬 프로필을 따로 둔다.
// 지정 안 하면(기존 동작 그대로) 최상위 .naver-auto 폴더를 그대로 쓴다 — 이게 '기본 계정'.
const os = require("os");
const path = require("path");
const fs = require("fs");

const ROOT_DIR = path.join(os.homedir(), ".naver-auto");
const account = String(process.env.NAVER_ACCOUNT || "").trim();
const isSafeAccountName = /^[^\\/:*?"<>|]{1,40}$/.test(account);
const DATA_DIR = account && isSafeAccountName ? path.join(ROOT_DIR, "accounts", account) : ROOT_DIR;
fs.mkdirSync(DATA_DIR, { recursive: true });

module.exports = {
  ROOT_DIR,
  DATA_DIR,
  ACCOUNT: account && isSafeAccountName ? account : "",
  PROFILE_DIR: path.join(DATA_DIR, "chrome-profile"),
  STATE_FILE: path.join(DATA_DIR, "naver-state.json"),
  DONE_FILE: path.join(DATA_DIR, "_login_done"),
  LOG_DIR: path.join(DATA_DIR, "logs"),
};
