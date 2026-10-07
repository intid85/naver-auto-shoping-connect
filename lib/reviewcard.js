// 쇼핑커넥트 상품 페이지에서 리뷰 수/평점을 읽어 "구매리뷰 카드" 이미지(PNG)로 만든다.
// 구매자 리뷰 본문·닉네임·사진·가격은 쓰지 않고, 숫자와 참고글.txt 에 적힌 장점만 넣는다.
// 카드 맨 아래 "구매리뷰 확인하기 ▼" 는 바로 아래에 붙는 쇼핑커넥트 상품 카드를 가리킨다.

const fs = require("fs");
const path = require("path");

const toNum = (s) => Number(String(s).replace(/,/g, ""));
const DEFAULT_ACCOUNT_ID = "993045947072320";

// 브랜드커넥트 상품 페이지에서 평점/리뷰 수를 읽는다.
// 이 페이지는 "4.85" / "리뷰 243" 처럼 라벨 없이 줄로 나온다. (창을 띄운 상태 + 로그인 세션 필요)
async function fetchReviewStats(page, productUrl) {
  await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(4000);
  const lines = (await page.evaluate(() => document.body.innerText || "")).split("\n").map((x) => x.trim());
  const idx = lines.findIndex((l) => /^리뷰\s*[\d,]+/.test(l));
  const reviewCount = idx >= 0 ? toNum(/[\d,]+/.exec(lines[idx])[0]) : null;
  // 리뷰 줄 바로 위쪽에서 0~5 사이 숫자 하나를 평점으로 본다.
  let rating = null;
  for (let i = idx - 1; i >= Math.max(0, idx - 4); i--) {
    if (/^[0-5](\.\d{1,2})?$/.test(lines[i])) {
      rating = Number(lines[i]);
      break;
    }
  }
  return { reviewCount, rating };
}

// 참고글.txt 의 "쇼핑커넥트: 계정ID …, 상품 id …" / "쇼핑커넥트: id …" 두 형식에서 상품 페이지 주소를 만든다.
function connectProductUrl(refText, fallbackAccountId) {
  // 상세페이지 주소가 그대로 적혀 있으면 그걸 쓴다.
  const direct = /https:\/\/brandconnect\.naver\.com\/\d+\/affiliate\/products\/\d+/.exec(refText || "")?.[0];
  if (direct) return direct;
  const line = /쇼핑커넥트\s*:[^\n]*/.exec(refText || "")?.[0] || "";
  const pid = /id\s*(\d+)/i.exec(line)?.[1];
  if (!pid) return null;
  const acct = /계정\s*ID\s*(\d+)/i.exec(line)?.[1] || fallbackAccountId || DEFAULT_ACCOUNT_ID;
  return `https://brandconnect.naver.com/${acct}/affiliate/products/${pid}`;
}

// 참고글.txt 의 "취합 팩트" 에서 카드용 문구를 뽑는다. 적힌 내용만 쓰고, 새로 지어내지 않는다.
//  - 장점(points): 부정 표현이 있는 줄은 뺀다.
//  - 본사 스토어 구매 이유(reasons): 정품·공식·증정·보증 같은 말이 실제로 적힌 줄만.
const NEG = /주의|단점|호불호|아쉬|불편|논란|단,|다만|하지만|문제|발열|소음|느림|얇은 편/;
const REASON = /정품|공식|본사|정식|증정|사은품|무료\s*배송|무료배송|A\/?S|보증|당일|빠른\s*배송|오늘출발/;

function extractPoints(refText) {
  const m = /취합 팩트\s*\n([\s\S]*?)(?:\n\s*\n|$)/.exec(refText);
  const facts = (m ? m[1] : "").split("\n").map((l) => l.replace(/^\s*[-•·]\s*/, "").trim()).filter(Boolean);
  const clean = (l) => l.replace(/\s*\(.*?\)\s*/g, " ").replace(/\s+/g, " ").trim();
  const positive = facts.filter((l) => !NEG.test(l) && !/^리뷰/.test(l));
  const reasons = positive.filter((l) => REASON.test(l)).map(clean);

  // 판매처/상품명에 실제로 적힌 표현만 구매 이유로 쓴다 (예: 삼성공식파트너, 2년보증, ~증정).
  const seller = /^판매처\s*:\s*(.+)$/m.exec(refText)?.[1]?.trim();
  if (seller && /공식|정식|정품|본사/.test(seller)) reasons.unshift(`${seller}에서 판매`);
  const product = /^제품\s*:\s*(.+)$/m.exec(refText)?.[1] || "";
  const warranty = /(\d+년\s*보증)/.exec(product)?.[1];
  if (warranty) reasons.push(`${warranty} 상품`);
  const gift = /[+(\[]\s*([^()+\[\]]*증정)/.exec(product)?.[1]?.trim();
  if (gift) reasons.push(gift);

  return {
    points: positive.filter((l) => !REASON.test(l)).map(clean).slice(0, 6),
    reasons: [...new Set(reasons)].slice(0, 3),
  };
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// 참고글.txt 의 "판매처:" 줄. 공식/정식/정품/본사 표현이 실제로 적혀 있을 때만 official=true.
function extractSeller(refText) {
  const seller = /^판매처\s*:\s*(.+)$/m.exec(refText || "")?.[1]?.trim() || "";
  return { seller, official: /공식|정식|정품|본사/.test(seller) };
}

// 위치별로 문구·구성을 다르게 한다. 숫자(리뷰 수/평점)는 같고, 장점·이유는 참고글에 적힌 것만 나눠 쓴다.
const VARIANTS = {
  top:    { head: null,                     btn: "구매리뷰 확인하기 ▼",          btnOfficial: "공식 스토어에서 구매리뷰 확인 ▼" },
  middle: { head: "읽다 보니 궁금해지셨죠?",   btn: "실구매 후기 보러 가기 ▼",       btnOfficial: "공식 스토어 실구매 후기 보기 ▼" },
  bottom: { head: "고민된다면 후기부터 보세요", btn: "리뷰 더 확인하고 결정하기 ▼",   btnOfficial: "공식 스토어에서 리뷰 확인하고 결정 ▼" },
};

function cardHtml({ title, reviewCount, rating, points = [], reasons = [], variant = "top", seller = "", official = false }) {
  const v = VARIANTS[variant] || VARIANTS.top;
  const stars = rating ? "★".repeat(Math.round(rating)) + "☆".repeat(5 - Math.round(rating)) : "";
  const list = (arr) => arr.map((p) => `<li>${esc(p)}</li>`).join("");
  const ratingText = rating != null ? rating.toFixed(2).replace(/0$/, "") : "";
  const compact = variant !== "top";
  const hasStats = reviewCount != null || rating != null;
  const stats = !hasStats
    ? `<div class="one nostat">${variant === "top" ? "실구매자 후기가 궁금하다면?" : "후기부터 확인해 보세요"}</div>`
    : compact
    ? `<div class="one">구매 리뷰 <b>${reviewCount != null ? reviewCount.toLocaleString("en-US") + "건" : ""}</b>${rating != null ? ` · 평점 <b>${ratingText}</b> <span class="stars">${stars}</span>` : ""}</div>`
    : `<div class="big">
    ${reviewCount != null ? `<div class="box"><div class="lab">구매 리뷰</div><div class="num">${reviewCount.toLocaleString("en-US")}건</div></div>` : ""}
    ${rating != null ? `<div class="box"><div class="lab">평점</div><div class="num">${ratingText}</div><div class="stars">${stars}</div></div>` : ""}
  </div>`;
  // 공식 판매처로 적혀 있을 때만 크게 강조한다. 아니면 배지 없음.
  const badge = official && seller ? `<div class="badge">✔ ${esc(seller)} 판매</div>` : "";
  return `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#fff;font-family:"Malgun Gothic","Apple SD Gothic Neo",sans-serif}
  #card{width:860px;box-sizing:border-box;padding:${compact ? 36 : 44}px 48px;background:linear-gradient(135deg,#03c75a,#02a14a);color:#fff;border-radius:28px}
  .badge{display:inline-block;background:#fff200;color:#111;font-size:26px;font-weight:800;border-radius:40px;padding:10px 24px;margin-bottom:18px}
  .t{font-size:${compact ? 34 : 30}px;font-weight:700;opacity:.97;margin-bottom:${compact ? 18 : 28}px;line-height:1.35}
  .one{background:#fff;color:#111;border-radius:16px;padding:18px 22px;font-size:28px;text-align:center}
  .one b{color:#02a14a;font-size:36px}
  .big{display:flex;gap:20px}
  .box{flex:1;background:#fff;color:#111;border-radius:20px;padding:26px 20px;text-align:center}
  .lab{font-size:22px;color:#666;margin-bottom:6px}
  .num{font-size:66px;font-weight:800;color:#02a14a;line-height:1.1}
  .stars{font-size:28px;color:#ffb400;letter-spacing:2px}
  .sec{margin-top:24px}
  .sh{font-size:22px;font-weight:700;opacity:.9;margin-bottom:6px}
  ul{margin:0;padding:0;list-style:none;font-size:27px;font-weight:600}
  li{margin-top:10px;line-height:1.35}li:before{content:"✔ ";color:#fff200}
  .btn{margin-top:30px;background:#fff200;color:#111;border-radius:60px;text-align:center;font-size:${official ? 32 : 34}px;font-weight:800;padding:20px 0}
  .foot{margin-top:18px;font-size:17px;opacity:.8;text-align:center}
  </style><div id="card">
  ${badge}
  <div class="t">${esc(v.head || title)}</div>
  ${stats}
  ${points.length ? `<div class="sec"><div class="sh">${variant === "top" ? "이 상품의 장점" : "후기에서 자주 보이는 점"}</div><ul>${list(points)}</ul></div>` : ""}
  ${reasons.length ? `<div class="sec"><div class="sh">공식 스토어에서 사는 이유</div><ul>${list(reasons)}</ul></div>` : ""}
  <div class="btn">${esc(official ? v.btnOfficial : v.btn)}</div>
  <div class="foot">네이버 쇼핑 구매 리뷰 기준 · 작성 시점에 따라 달라질 수 있어요</div>
  </div>`;
}

// 카드 HTML을 렌더해서 #card 요소만 PNG로 저장
async function renderCard(page, data, outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  await page.setViewportSize({ width: 960, height: 900 });
  await page.setContent(cardHtml(data), { waitUntil: "load" });
  await page.locator("#card").screenshot({ path: outPath });
  return outPath;
}

// 글 하나용 카드 3장(top / middle / bottom)을 항상 만든다. 프롬프트·설정과 무관하게 모든 쇼핑커넥트 글이 같은 구성이다.
//  - 리뷰 수/평점은 쇼핑커넥트 페이지에서 읽는다. 못 읽거나 minReviews 미만이면 숫자 없이 같은 형태의 카드로 만든다.
//  - 장점·구매 이유는 참고글.txt 에 적힌 것만. 없으면 그 칸만 빠진다.
//  반환: { top, middle, bottom } 파일 경로. 글쓰기는 카드 때문에 멈추지 않는다.
const CARD_PLACES = ["top", "middle", "bottom"];
async function buildReviewCards(ctx, post, folder, { minReviews = 10, accountId } = {}) {
  const refText = post.connect?.refText || "";
  const url = connectProductUrl(refText, accountId);
  const page = await ctx.newPage();
  const out = {};
  try {
    let stats = { reviewCount: null, rating: null };
    if (!url) {
      console.log("   (리뷰 수 없이 카드 생성: 참고글.txt 에 쇼핑커넥트 상품 id 없음)");
    } else {
      try {
        const read = await fetchReviewStats(page, url);
        if (read.reviewCount == null) console.log("   (리뷰 수 없이 카드 생성: 리뷰 수를 읽지 못함)");
        else if (read.reviewCount < minReviews) console.log(`   (리뷰 수 없이 카드 생성: 리뷰 ${read.reviewCount}건 < ${minReviews}건)`);
        else stats = read;
      } catch (e) {
        console.log(`   (리뷰 수 없이 카드 생성: ${e.message})`);
      }
    }
    const { points, reasons } = extractPoints(refText);
    const { seller, official } = extractSeller(refText);
    const title = post.connect?.productName?.replace(/\s*\/.*$/, "") || post.title;
    const parts = {
      top: { points: points.slice(0, 3), reasons: reasons.slice(0, 3) },
      middle: { points: points.slice(3, 6), reasons: [] },
      bottom: { points: [], reasons: reasons.slice(0, 2) },
    };
    for (const where of CARD_PLACES) {
      const file = path.join(folder, `_리뷰카드_${where}.png`);
      await renderCard(page, { title, ...stats, ...parts[where], variant: where, seller, official }, file);
      out[where] = file;
    }
    console.log(`   리뷰 카드 생성(top/middle/bottom): ${stats.reviewCount != null ? `리뷰 ${stats.reviewCount}건 / 평점 ${stats.rating ?? "-"}` : "숫자 없음"}${official ? " / 공식 판매처 배지" : ""}`);
    return out;
  } catch (e) {
    console.log(`   (리뷰 카드 건너뜀: ${e.message})`);
    return out;
  } finally {
    await page.close().catch(() => {});
  }
}

// 글쓰기 모델이 돌려준 cardFacts(장점 문구들)를 참고글.txt 의 "취합 팩트" 섹션으로 저장한다.
// 이미 있던 "취합 팩트" 블록은 새 것으로 바꾼다. 부정 표현·가격·최저가 문구는 여기서도 한 번 더 거른다.
const FACT_BLOCK = /\n?취합 팩트[ \t]*\r?\n(?:[ \t]*[-•·][^\n]*\n?)*/;
function writeCardFacts(folderPath, facts) {
  const clean = (Array.isArray(facts) ? facts : [])
    .map((f) => String(f || "").replace(/^\s*[-•·]\s*/, "").replace(/\s+/g, " ").trim())
    .filter((f) => f && f.length <= 60 && !NEG.test(f) && !/가격|\d[\d,]*\s*원|최저가|할인|https?:|naver\.me/.test(f))
    .slice(0, 6);
  if (!clean.length) return 0;
  const refPath = path.join(folderPath, "참고글.txt");
  const existing = fs.existsSync(refPath) ? fs.readFileSync(refPath, "utf8") : "";
  const base = existing.replace(FACT_BLOCK, "\n").replace(/\s+$/, "");
  fs.writeFileSync(refPath, `${base}\n\n취합 팩트\n${clean.map((f) => `- ${f}`).join("\n")}\n`, "utf8");
  return clean.length;
}

module.exports = { fetchReviewStats, renderCard, cardHtml, extractPoints, extractSeller, connectProductUrl, buildReviewCards, writeCardFacts };
