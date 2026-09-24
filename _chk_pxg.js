const { parseFolder } = require("./lib/parse");
const dir = "G:/내 드라이브/공유작업/네이버 쇼핑커넥트/2026-09-24/PXG 0311 드라이버";
const p = parseFolder(dir);
console.log("제목:", p.title);
console.log("슬롯=", p.stats.imageSlots, "사진=", p.stats.photosFound, "태그=", p.tags.length);
console.log("태그:", p.tags.join(" "));
