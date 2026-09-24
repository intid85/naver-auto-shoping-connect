// 발행 전에 폴더 파싱이 제대로 되는지 눈으로 확인하는 용도.
// 실행: npm run parse

const config = require("./config.json");
const { parseFolder, listPostFolders } = require("./lib/parse");

const folders = listPostFolders(config.postsDir);
if (folders.length === 0) {
  console.log(`\n'${config.postsDir}' 안에 포스팅 폴더가 없습니다.`);
  console.log("각 폴더에 붙여넣기본문.txt 와 photos/ 가 있어야 합니다.\n");
  process.exit(0);
}

console.log(`\n총 ${folders.length}개 폴더 발견\n${"=".repeat(50)}`);

for (const folder of folders) {
  try {
    const p = parseFolder(folder);
    console.log(`\n[${p.name}]`);
    console.log(`  제목: ${p.title || "(없음!)"}`);
    console.log(
      `  본문블록: ${p.stats.textBlocks}개 / 사진슬롯: ${p.stats.imageSlots}개 / 사진파일: ${p.stats.photosFound}개`
    );
    console.log(`  태그: ${p.tags.join(", ") || "(없음)"}`);
    if (p.stats.slotsWithoutPhoto > 0) {
      console.log(`  ⚠️  사진이 부족한 슬롯 ${p.stats.slotsWithoutPhoto}개`);
    }
    if (!p.title) console.log("  ⚠️  제목 파싱 실패 - txt 첫 줄 '제목:' 확인");
    // 본문 미리보기
    const preview = p.blocks
      .map((b) =>
        b.type === "text"
          ? "  │ " + b.text.replace(/\n/g, " / ").slice(0, 60)
          : `  │ [사진] ${b.path ? require("path").basename(b.path) : "없음"}`
      )
      .join("\n");
    console.log(preview);
  } catch (e) {
    console.log(`\n[${require("path").basename(folder)}]  오류: ${e.message}`);
  }
}
console.log(`\n${"=".repeat(50)}\n확인 끝. 이상 없으면  npm run post\n`);
