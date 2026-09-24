const { parseFolder } = require("./lib/parse");
const fs = require("fs");
const base = "G:/내 드라이브/공유작업/네이버 쇼핑커넥트/2026-09-25";
let ok = 0, fail = 0;
for (const d of fs.readdirSync(base).filter(x => /^\d/.test(x)).sort()) {
  const p = parseFolder(base + "/" + d);
  const tagsOk = p.tags.length === 7;
  const slotOk = p.stats.imageSlots === p.stats.photosFound;
  if (tagsOk && slotOk) { ok++; console.log("✅", d, "| 슬롯", p.stats.imageSlots, "사진", p.stats.photosFound, "태그", p.tags.length); }
  else { fail++; console.log("❌", d, "| 슬롯", p.stats.imageSlots, "사진", p.stats.photosFound, "태그", p.tags.length); }
}
console.log(`\n${ok}개 성공 / ${fail}개 실패`);
