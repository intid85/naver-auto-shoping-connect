// 런타임 데이터(크롬 프로필, 세션 파일, 로그)는 OneDrive 밖에 둔다.
// OneDrive 동기화가 SQLite 쿠키 파일을 깨뜨리기 때문.
const os = require("os");
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.join(os.homedir(), ".naver-auto");
fs.mkdirSync(DATA_DIR, { recursive: true });

module.exports = {
  DATA_DIR,
  PROFILE_DIR: path.join(DATA_DIR, "chrome-profile"),
  STATE_FILE: path.join(DATA_DIR, "naver-state.json"),
  DONE_FILE: path.join(DATA_DIR, "_login_done"),
  LOG_DIR: path.join(DATA_DIR, "logs"),
};
