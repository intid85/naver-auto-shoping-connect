// posts 안 모든 폴더의 제목+태그를 태그목록.txt 로 뽑는다. (발행할 때 복붙용)
// 실행: node taglist.js

const fs = require("fs");
const path = require("path");
const config = require("./config.json");
const { parseFolder, listPostFolders } = require("./lib/parse");

const folders = listPostFolders(config.postsDir);
let out = "네이버 블로그 발행용 태그 목록\n" + "=".repeat(40) + "\n\n";

for (const folder of folders) {
  try {
    const p = parseFolder(folder);
    out += `[${p.name}]\n`;
    out += `제목: ${p.title}\n`;
    out += `태그: ${p.tags.join(" ")}\n`;
    out += `커넥트: (여기에 상품 URL/메모)\n\n`;
  } catch (e) {
    out += `[${path.basename(folder)}]  오류: ${e.message}\n\n`;
  }
}

const dest = path.join(config.postsDir, "..", "태그목록.txt");
fs.writeFileSync(dest, out, "utf8");
console.log("생성:", path.resolve(dest));
console.log(`\n폴더 ${folders.length}개 처리됨`);
