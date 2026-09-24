// FAST PATH: 상품 대표컷 수집 (HTTP 1회 + 병렬 다운로드)
const https = require("https");
const http = require("http");
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

function fetchHtml(urlPath) {
  return new Promise((resolve, reject) => {
    const headers = {
      Cookie: loadCookie(),
      "x-space-id": ACCT,
      accept: "text/html,application/xhtml+xml",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      "Accept-Encoding": "identity",
    };
    const mod = urlPath.startsWith("https") ? https : http;
    const urlObj = new URL(urlPath);
    const req = mod.request(
      { hostname: urlObj.hostname, port: urlObj.port || (urlPath.startsWith("https") ? 443 : 80),
        path: urlObj.pathname + urlObj.search, method: "GET", headers },
      (res) => {
        let body = "";
        res.on("data", (c) => (body += c));
        res.on("end", () => resolve(body));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

function downloadImage(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const urlObj = new URL(url);
    const req = mod.request(
      { hostname: urlObj.hostname, port: urlObj.port || (url.startsWith("https") ? 443 : 80),
        path: urlObj.pathname + urlObj.search, method: "GET",
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          Referer: "https://brandconnect.naver.com/",
          "Accept-Encoding": "identity",
        }},
      (res) => {
        if (res.statusCode >= 300) { reject(new Error(`HTTP ${res.statusCode}`)); return; }
        const ws = fs.createWriteStream(dest);
        let size = 0;
        res.on("data", (c) => { size += c.length; });
        res.pipe(ws);
        ws.on("finish", () => resolve(size));
        ws.on("error", reject);
      }
    );
    req.on("error", reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error("timeout")); });
    req.end();
  });
}

function extractImageUrls(html) {
  const regex = /https?:\\?\/\\?\/shop-phinf\.pstatic\.net\\?\/[^"'\\s<>]+/g;
  const matches = html.match(regex) || [];
  return matches.map((m) => m.replace(/\\\//g, "/"));
}

async function collectOne(pid, photosDir) {
  const t0 = Date.now();
  const html = await fetchHtml(`https://brandconnect.naver.com/${ACCT}/affiliate/products/${pid}`);
  const urls = extractImageUrls(html);
  const ms = Date.now() - t0;
  if (!urls.length) {
    console.log(`  #${pid}: 이미지 0개 (${ms}ms)`);
    return 0;
  }
  // 5장만, 중복 제거
  const seen = new Set();
  const unique = urls.filter((u) => { if (seen.has(u)) return false; seen.add(u); return true; }).slice(0, 5);
  fs.mkdirSync(photosDir, { recursive: true });
  let saved = 0;
  const errors = [];
  await Promise.all(unique.map(async (url, i) => {
    const dest = path.join(photosDir, `${String(i+1).padStart(2,"0")}.jpg`);
    try {
      const size = await downloadImage(url, dest);
      if (size > 20000) saved++; // 20KB 미만은 저해상 제외
      else { fs.unlinkSync(dest); errors.push(`#${i+1} 저해상(${size}B)`); }
    } catch (e) { errors.push(`#${i+1} ${e.message}`); }
  }));
  const errStr = errors.length ? ` [${errors.join(", ")}]` : "";
  console.log(`  #${pid}: ${saved}/${unique.length}장 저장 (${ms}ms)${errStr}`);
  return saved;
}

async function main() {
  const mode = process.argv[2];
  if (mode === "one") {
    const pid = process.argv[3];
    const dir = process.argv[4];
    if (!pid || !dir) { console.error("Usage: node bc_fast.js one <pid> <photosDir>"); process.exit(1); }
    const t0 = Date.now();
    const n = await collectOne(pid, dir);
    console.log(`\n총 ${n}장 | ${Date.now()-t0}ms`);
  } else if (mode === "plan") {
    const planFile = process.argv[3];
    const plan = JSON.parse(fs.readFileSync(planFile, "utf-8"));
    const t0 = Date.now();
    let total = 0, success = 0, full = 0;
    for (const it of plan) {
      const dir = path.join(process.env.ROOT || "", it.folder || it.n, "photos");
      const n = await collectOne(it.pid || it.id, dir);
      total += n;
      success++;
      if (n === 5) full++;
    }
    console.log(`\n=== ${plan.length}개 / 성공 ${success} / 총 ${Date.now()-t0}ms (${Math.round((Date.now()-t0)/plan.length)}ms/개) ===`);
  } else {
    console.error("Usage: node bc_fast.js one <pid> <photosDir> | node bc_fast.js plan <plan.json>");
    process.exit(1);
  }
}

main().catch((e) => { console.error(e.message); process.exit(1); });
