// 링크 발급: POST affiliate-urls?affiliateProductId=<pid>
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
      referer: `https://brandconnect.naver.com/${ACCT}/affiliate/products`,
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

async function issue(pid) {
  const t0 = Date.now();
  const res = await callApi("POST",
    `https://gw-brandconnect.naver.com/affiliate/command/affiliate-urls?affiliateProductId=${pid}`, {});
  const ms = Date.now() - t0;
  if (res && res.url) {
    console.log(`OK | ${ms}ms | affiliateUrlId=${res.affiliateUrlId} | url=${res.url}`);
    return res;
  }
  console.log(`FAIL | ${ms}ms | ${JSON.stringify(res).slice(0, 200)}`);
  return null;
}

async function main() {
  const pids = process.argv.slice(2);
  if (!pids.length) { console.error("Usage: node bc_issue.js <pid> [pid2 ...]"); process.exit(1); }
  let ok = 0;
  for (const p of pids) {
    const r = await issue(p);
    if (r) ok++;
  }
  console.log(`\n발급 성공 ${ok} / 실패 ${pids.length - ok}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
