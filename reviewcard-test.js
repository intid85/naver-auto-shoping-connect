// 위치별 카드(top/middle/bottom) 미리보기. 사용: node reviewcard-test.js <참고글.txt 경로>
// 리뷰 수/평점은 예시값(실제 글쓰기에서는 쇼핑커넥트 페이지에서 읽는다).
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const { renderCard, extractPoints, extractSeller } = require("./lib/reviewcard");

(async () => {
  const ref = process.argv[2] ? fs.readFileSync(process.argv[2], "utf8") : "";
  const { points, reasons } = extractPoints(ref);
  const { seller, official } = extractSeller(ref);
  const title = /^제품\s*:\s*(.+)$/m.exec(ref)?.[1]?.replace(/\s*\/.*$/, "") || "샘플 상품";
  const stats = { reviewCount: 6048, rating: 4.92 };
  const parts = {
    top: { points: points.slice(0, 3), reasons: reasons.slice(0, 3) },
    middle: { points: points.slice(3, 6), reasons: [] },
    bottom: { points: [], reasons: reasons.slice(0, 2) },
  };
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  const page = await browser.newPage();
  for (const where of Object.keys(parts)) {
    const out = path.join(__dirname, `reviewcard-preview-${where}.png`);
    await renderCard(page, { title, ...stats, ...parts[where], variant: where, seller, official }, out);
    console.log("저장:", out);
  }
  await browser.close();
})();
