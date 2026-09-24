// 상품 검색: GET search-by-query
const https = require("https");
const fs = require("fs");
const path = require("path");

const STATE_FILE = path.join(process.env.USERPROFILE || process.env.HOME, ".naver-auto", "naver-state.json");
const ACCT = "993045947072320";

function loadCookie() {
  const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  return raw.cookies
    .filter((c) => c.domain.includes("naver.com"))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

function callApi(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const isPost = method === "POST";
    const url = new URL(urlPath);
    const data = isPost ? JSON.stringify(body || {}) : null;
    const headers = {
      Cookie: loadCookie(),
      "x-space-id": ACCT,
      accept: "application/json, text/plain, */*",
      origin: "https://brandconnect.naver.com",
      referer: "https://brandconnect.naver.com/",
      "Accept-Encoding": "identity",
    };
    if (isPost) {
      headers["content-type"] = "application/json";
      headers["content-length"] = Buffer.byteLength(data);
    }
    const req = https.request(
      { hostname: url.hostname, port: 443, path: url.pathname + url.search, method, headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => {
          if (res.statusCode >= 300) {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 300)}`));
          } else {
            try { resolve(JSON.parse(body)); }
            catch { resolve(body); }
          }
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

async function main() {
  const keyword = process.argv[2];
  const limit = parseInt(process.argv[3] || "20");
  if (!keyword) { console.error("Usage: node bc_search_products.js <keyword> [limit]"); process.exit(1); }
  const enc = encodeURIComponent(keyword);
  const url = `https://gw-brandconnect.naver.com/affiliate/query/affiliate-products/search-by-query?query=${enc}&limit=${limit}`;
  const t0 = Date.now();
  const res = await callApi("GET", url);
  const ms = Date.now() - t0;
  if (!res.data || !Array.isArray(res.data)) {
    console.log(`HTTP ${res.status || "?"} | ${ms}ms | no data`);
    return;
  }
  console.log(`[${keyword}] ${res.data.length}건 | ${ms}ms`);
  res.data.forEach((p, i) => {
    const price = p.discountedSalePrice || p.salePrice || 0;
    const rate = p.commissionRate != null ? p.commissionRate + "%" : "?";
    const discount = p.discountedRate ? ` (-${p.discountedRate}%)` : "";
    console.log(`[${i}] id=${p.id} | ${p.storeName || "?"} | ${p.productName || "?"} | ${price.toLocaleString()}원${discount} | ${rate}`);
  });
}

main().catch((e) => { console.error(e.message); process.exit(1); });
