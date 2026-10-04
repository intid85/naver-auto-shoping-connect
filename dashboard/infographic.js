// 글의 숫자로 표·그래프 이미지를 직접 그린다 (AI 그림이 아니라서 숫자가 틀리거나 글자가 깨지지 않는다)
const { chromium } = require("playwright");

const TYPES = new Set(["table", "bar", "cards", "heading", "quote"]);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const clip = (s, n) => String(s ?? "").trim().slice(0, n);

// AI가 돌려준 값을 안전한 모양으로 정리한다. 쓸 수 없으면 null.
function sanitizeSpec(raw) {
  if (!raw || !TYPES.has(raw.type)) return null;
  const spec = {
    slot: Number(raw.slot) || 0,
    type: raw.type,
    title: clip(raw.title, raw.type === "heading" || raw.type === "quote" ? 60 : 50),
    subtitle: clip(raw.subtitle, 70),
    unit: clip(raw.unit, 10),
    source: clip(raw.source, 80),
    headers: (Array.isArray(raw.headers) ? raw.headers : []).slice(0, 5).map((h) => clip(h, 18)),
    rows: (Array.isArray(raw.rows) ? raw.rows : []).slice(0, 8).map((r) => (Array.isArray(r) ? r : []).slice(0, 5).map((c) => clip(c, 40))),
    labels: (Array.isArray(raw.labels) ? raw.labels : []).slice(0, 8).map((l) => clip(l, 18)),
    values: (Array.isArray(raw.values) ? raw.values : []).slice(0, 8).map(Number),
  };
  if (!spec.title) return null;
  if (spec.type === "table" && (!spec.headers.length || spec.rows.length < 2)) return null;
  if (spec.type === "cards" && spec.rows.length < 2) return null;
  if (spec.type === "bar" && (spec.labels.length < 2 || spec.values.length !== spec.labels.length || spec.values.some((v) => !Number.isFinite(v) || v < 0))) return null;
  return spec;
}

// 그림에 들어간 숫자가 모두 입력 자료나 글 안에 있는 숫자인지 확인한다 (AI가 지어낸 숫자를 걸러낸다)
function numbersIn(text) {
  return (String(text).replace(/,/g, "").match(/\d+(?:\.\d+)?/g) || []).filter((n) => n.replace(".", "").length >= 2);
}
function unsupportedNumbers(spec, referenceText) {
  const ref = String(referenceText).replace(/,/g, "");
  const parts = [spec.title, spec.subtitle, ...spec.headers, ...spec.rows.flat(), ...spec.labels, ...spec.values.map(String)];
  return [...new Set(numbersIn(parts.join(" ")))].filter((n) => !ref.includes(n));
}

function bodyHtml(spec) {
  if (spec.type === "table") {
    const head = spec.headers.map((h) => `<th>${esc(h)}</th>`).join("");
    const rows = spec.rows.map((r) => `<tr>${spec.headers.map((_, i) => `<td class="${i === 0 ? "first" : ""}">${esc(r[i] ?? "")}</td>`).join("")}</tr>`).join("");
    return `<table><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
  }
  if (spec.type === "cards") {
    return `<div class="cards">${spec.rows.slice(0, 4).map((r) => `<div class="card"><div class="cl">${esc(r[0])}</div><div class="cv">${esc(r[1])}</div>${r[2] ? `<div class="cn">${esc(r[2])}</div>` : ""}</div>`).join("")}</div>`;
  }
  const max = Math.max(...spec.values, 1);
  return `<div class="bars">${spec.labels.map((l, i) => `<div class="bar"><div class="bl">${esc(l)}</div><div class="bt"><div class="bf" style="width:${Math.max(3, Math.round((spec.values[i] / max) * 100))}%"></div></div><div class="bv">${esc(spec.values[i].toLocaleString("ko-KR"))}${esc(spec.unit)}</div></div>`).join("")}</div>`;
}

// 소제목 배너와 강조 문구 카드: 글 중간에 시선을 끌어 단조로움을 깨는 이미지
function bannerHtml(spec) {
  const isQuote = spec.type === "quote";
  const bg = isQuote ? "linear-gradient(135deg,#0b1f3a 0%,#143a7b 100%)" : "linear-gradient(135deg,#0066ff 0%,#3d8bff 100%)";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:1080px;font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif}
.b{background:${bg};color:#fff;padding:${isQuote ? "80px 90px" : "70px 80px"};position:relative;text-align:${isQuote ? "center" : "left"};overflow:hidden}
.b:before{content:"";position:absolute;right:-90px;top:-90px;width:320px;height:320px;border-radius:50%;background:rgba(255,255,255,.08)}
.b:after{content:"";position:absolute;left:-60px;bottom:-110px;width:260px;height:260px;border-radius:50%;background:rgba(255,255,255,.06)}
.k{display:inline-block;background:rgba(255,255,255,.2);border-radius:30px;padding:8px 24px;font-size:26px;font-weight:700;letter-spacing:1px;margin-bottom:26px}
.q{font-size:120px;line-height:.6;color:rgba(255,255,255,.35);font-weight:800;margin-bottom:26px}
h1{font-size:${isQuote ? "56px" : "62px"};line-height:1.35;font-weight:800;word-break:keep-all;position:relative}
.s{font-size:28px;margin-top:22px;color:rgba(255,255,255,.82);position:relative;line-height:1.5}
</style></head><body><div class="b" id="cap">${isQuote ? '<div class="q">“</div>' : (spec.unit ? `<div class="k">${esc(spec.unit)}</div><br>` : "")}<h1>${esc(spec.title)}</h1>${spec.subtitle ? `<div class="s">${esc(spec.subtitle)}</div>` : ""}</div></body></html>`;
}

function pageHtml(spec) {
  if (spec.type === "heading" || spec.type === "quote") return bannerHtml(spec);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:1080px;background:#fff;font-family:'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#1b2a41}
.wrap{padding:56px 60px 44px;background:linear-gradient(180deg,#f5f9ff 0%,#fff 38%)}
.bar-top{width:64px;height:8px;background:#0066ff;border-radius:4px;margin-bottom:22px}
h1{font-size:44px;line-height:1.3;font-weight:800;color:#0b1f3a}
.sub{font-size:25px;color:#5b6b82;margin-top:10px}
.body{margin-top:38px}
table{width:100%;border-collapse:separate;border-spacing:0;border-radius:18px;overflow:hidden;border:2px solid #dbe6f5;font-size:28px}
th{background:#0066ff;color:#fff;padding:20px 18px;font-weight:700;text-align:center}
td{padding:20px 18px;text-align:center;border-top:1px solid #e3ecf8}
td.first{font-weight:700;background:#f2f7ff;text-align:left}
tbody tr:nth-child(even) td:not(.first){background:#fafcff}
.cards{display:grid;grid-template-columns:repeat(2,1fr);gap:22px}
.card{background:#fff;border:2px solid #dbe6f5;border-radius:22px;padding:30px 28px;box-shadow:0 6px 18px rgba(0,60,160,.07)}
.cl{font-size:25px;color:#5b6b82;font-weight:600}
.cv{font-size:54px;font-weight:800;color:#0066ff;margin-top:10px;line-height:1.15;word-break:keep-all}
.cn{font-size:22px;color:#7a889c;margin-top:10px}
.bars{display:flex;flex-direction:column;gap:20px}
.bar{display:grid;grid-template-columns:210px 1fr 170px;align-items:center;gap:16px}
.bl{font-size:26px;font-weight:700;text-align:right}
.bt{background:#e8f0fc;border-radius:12px;height:42px;overflow:hidden}
.bf{height:100%;background:linear-gradient(90deg,#4d94ff,#0066ff);border-radius:12px}
.bv{font-size:27px;font-weight:800;color:#0b1f3a}
.src{margin-top:34px;font-size:21px;color:#8a97aa}
</style></head><body><div class="wrap" id="cap"><div class="bar-top"></div><h1>${esc(spec.title)}</h1>${spec.subtitle ? `<div class="sub">${esc(spec.subtitle)}</div>` : ""}<div class="body">${bodyHtml(spec)}</div>${spec.source ? `<div class="src">출처: ${esc(spec.source)}</div>` : ""}</div></body></html>`;
}

// 표·그래프 이미지를 PNG로 그려 돌려준다
async function renderInfographic(spec) {
  const browser = await chromium.launch({ headless: true, channel: "chrome" });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 800 }, deviceScaleFactor: 1 });
    await page.setContent(pageHtml(spec), { waitUntil: "load" });
    const buffer = await page.locator("#cap").screenshot({ type: "png" });
    return { buffer, ext: "png" };
  } finally {
    await browser.close();
  }
}

module.exports = { sanitizeSpec, unsupportedNumbers, renderInfographic };
