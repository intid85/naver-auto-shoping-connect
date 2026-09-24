// 브랜드커넥트 상품 페이지 상세 정보 영역 스크롤 + 이미지 추출
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const https = require("https");

const STATE_FILE = path.join(process.env.USERPROFILE, ".naver-auto", "naver-state.json");
const ACCT = "993045947072320";
const PID = "886888149531168";
const PHOTOS_DIR = path.join("G:", "내 드라이브", "공유작업", "네이버 쇼핑커넥트", "2026-09-24", "PXG 0311 드라이버", "photos");
const PRODUCT_URL = `https://brandconnect.naver.com/${ACCT}/affiliate/products/${PID}`;

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

function extractRealUrl(dthumbUrl) {
  const match = dthumbUrl.match(/src%3D%22(https?%3A%2F%2F[^&]+)%22/);
  if (match) return decodeURIComponent(match[1]);
  return null;
}

async function main() {
  fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  console.log("Launching browser (headless)...");
  const browser = await chromium.launch({ headless: false, args: ["--no-sandbox"] });
  const context = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1280, height: 900 }, userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" });
  const page = await context.newPage();
  console.log("Navigating to:", PRODUCT_URL);
  await page.goto(PRODUCT_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(3000);

  // Scroll down slowly to trigger lazy loading of detail section
  console.log("Scrolling to load detail section...");
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(300);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(200);
  }

  // Get the page HTML and extract ALL image URLs
  const html = await page.content();
  
  // Extract dthumb URLs (which contain the real shop-phinf URL)
  const dthumbRegex = /https?:\/\/dthumb-phinf\.pstatic\.net\/[^\s"'<>]+/g;
  const dthumbMatches = html.match(dthumbRegex) || [];
  
  // Extract direct shop-phinf URLs
  const shopRegex = /https?:\/\/shop-phinf\.pstatic\.net\/[^\s"'<>]+/g;
  const shopMatches = html.match(shopRegex) || [];

  console.log("\n--- dthumb URLs ---");
  dthumbMatches.forEach((u, i) => console.log(`  [${i}] ${u.slice(0, 150)}`));
  
  console.log("\n--- shop-phinf URLs ---");
  shopMatches.forEach((u, i) => console.log(`  [${i}] ${u.slice(0, 120)}`));

  // Combine: resolve dthumb to real URLs + direct shop URLs
  const allUrls = new Set();
  
  shopMatches.forEach((u) => { if (!/logo/i.test(u)) allUrls.add(u); });
  dthumbMatches.forEach((u) => {
    const real = extractRealUrl(u);
    if (real && real.includes("shop-phinf.pstatic.net")) allUrls.add(real);
  });

  // Also look for data-src lazy-loaded images
  const lazyImgs = await page.evaluate(() => {
    const urls = new Set();
    document.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || img.getAttribute("data-origin");
      if (src && src.includes("shop-phinf.pstatic.net")) urls.add(src);
    });
    return Array.from(urls);
  });
  
  console.log("\n--- lazy-loaded URLs ---");
  lazyImgs.forEach((u, i) => console.log(`  [${i}] ${u.slice(0, 120)}`));
  lazyImgs.forEach((u) => { if (!/logo/i.test(u)) allUrls.add(u); });

  // Filter for high-res and PXG product
  const urls = Array.from(allUrls).filter((u) => {
    if (/logo|banner|linebn|freecare|chuseok|profile/i.test(u)) return false;
    if (/type=f\d+_\d+/.test(u)) return false;
    if (/type=w500_webp_q80/.test(u)) return false;
    return true;
  }).slice(0, 5);

  console.log("\n--- Final URLs ---");
  urls.forEach((u, i) => console.log(`  [${i}] ${u.slice(0, 120)}`));

  let saved = 0;
  for (let i = 0; i < urls.length; i++) {
    const dest = path.join(PHOTOS_DIR, `${String(saved + 1).padStart(2, "0")}.jpg`);
    try {
      const size = await downloadImage(urls[i], dest);
      if (size > 20000) {
        saved++;
        console.log(`  Saved ${String(saved).padStart(2, "0")}.jpg (${size} bytes)`);
      } else {
        fs.unlinkSync(dest);
        console.log(`  Skipped (too small: ${size} bytes)`);
      }
    } catch (e) {
      console.log(`  Error: ${e.message}`);
    }
  }

  console.log(`\nTotal saved: ${saved}/${urls.length} images`);
  await browser.close();
  console.log("Done.");
}

main().catch((e) => { console.error(e.message); process.exit(1); });
