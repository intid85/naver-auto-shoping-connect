// 네이버 자동글쓰기 웹 대시보드 서버
// 실행: node dashboard/server.js
// 접속: http://localhost:3000

const express = require("express");
const { execFile, spawn } = require("child_process");
const https = require("https");
const path = require("path");
const fs = require("fs");

const app = express();
const PORT = 3000;

// 미들웨어
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// naver-auto 루트 경로
const NAVER_AUTO_ROOT = path.join(__dirname, "..");

// ===== 브랜드커넥트 API 직접 호출 =====
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
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(data);
    }
    const req = https.request(
      { hostname: url.hostname, port: 443, path: url.pathname + url.search, method, headers },
      (res) => {
        let buf = "";
        res.on("data", (c) => (buf += c));
        res.on("end", () => {
          if (res.statusCode >= 300) {
            resolve({ error: `HTTP ${res.statusCode}`, raw: buf.slice(0, 200) });
          } else {
            try { resolve(JSON.parse(buf)); }
            catch { resolve({ raw: buf.slice(0, 200) }); }
          }
        });
      }
    );
    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

// ===== API =====

// 로그인 상태 확인
app.get("/api/check-login", (req, res) => {
  const proc = spawn("node", ["check-login.js"], {
    cwd: NAVER_AUTO_ROOT,
    shell: true,
  });

  let output = "";
  proc.stdout.on("data", (data) => (output += data.toString()));
  proc.stderr.on("data", (data) => (output += data.toString()));

  proc.on("close", (code) => {
    res.json({ success: code === 0, output: output.trim() });
  });
});

// 상품 검색 (브랜드커넥트 API 직접 호출 → JSON 결과)
app.post("/api/search", async (req, res) => {
  const { query } = req.body;

  if (!query) {
    return res.json({ success: false, products: [], message: "검색어를 입력하세요" });
  }

  try {
    const enc = encodeURIComponent(query);
    const url = `https://gw-brandconnect.naver.com/affiliate/query/affiliate-products/search-by-query?query=${enc}&limit=20`;
    const result = await callApi("GET", url);

    // 디버깅: 응답 구조 콘솔 출력
    console.log("API 응답 키:", Object.keys(result || {}));
    console.log("result.data 길이:", result?.data?.length, "| 타입:", typeof result?.data, "| 배열:", Array.isArray(result?.data));
    if (result?.data?.length > 0) {
      console.log("첫 상품:", JSON.stringify(result.data[0]).slice(0, 150));
    }

    if (!result.data || !Array.isArray(result.data)) {
      return res.json({ success: false, products: [], message: "검색 결과 없음", debug: { keys: Object.keys(result || {}), dataType: typeof result?.data } });
    }

    const products = result.data.map((p, i) => ({
      index: i,
      pid: p.id,
      store: p.storeName || "?",
      name: p.productName || "?",
      price: (p.discountedSalePrice || p.salePrice || 0).toLocaleString() + "원",
      discount: p.discountedRate ? `-${p.discountedRate}%` : "",
      commission: p.commissionRate != null ? p.commissionRate + "%" : "?",
    }));

    res.json({ success: true, products, count: products.length });
  } catch (e) {
    res.json({ success: false, products: [], message: e.message });
  }
});

// 링크 발급 (pid로 단축링크 생성)
app.post("/api/issue", async (req, res) => {
  const { pid } = req.body;

  if (!pid) {
    return res.json({ success: false, message: "상품을 선택하세요" });
  }

  try {
    const url = `https://gw-brandconnect.naver.com/affiliate/command/affiliate-urls?affiliateProductId=${pid}`;
    const result = await callApi("POST", url);

    if (result && result.url) {
      res.json({
        success: true,
        link: result.url,
        affiliateUrlId: result.affiliateUrlId,
        pid,
      });
    } else {
      res.json({ success: false, message: "발급 실패", raw: JSON.stringify(result).slice(0, 200) });
    }
  } catch (e) {
    res.json({ success: false, message: e.message });
  }
});

// 오늘 날짜 폴더 목록
app.get("/api/folders", (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const dir = path.join(
    "G:", "내 드라이브", "공유작업", "네이버 쇼핑커넥트", date
  );

  try {
    const folders = fs
      .readdirSync(dir)
      .filter((f) => fs.statSync(path.join(dir, f)).isDirectory());
    res.json({ success: true, folders, date });
  } catch (e) {
    res.json({ success: true, folders: [], date });
  }
});

// 임시저장 실행 (post.js)
app.post("/api/post", (req, res) => {
  const { folder } = req.body;

  if (!folder) {
    return res.json({ success: false, output: "폴더를 선택하세요" });
  }

  const proc = spawn("node", ["post.js"], {
    cwd: NAVER_AUTO_ROOT,
    shell: true,
    env: { ...process.env, POST_FOLDER: folder },
  });

  let output = "";
  proc.stdout.on("data", (data) => (output += data.toString()));
  proc.stderr.on("data", (data) => (output += data.toString()));

  // 타임아웃 (5분)
  const timeout = setTimeout(() => {
    proc.kill();
    res.json({ success: false, output: output + "\n(타임아웃 5분)" });
  }, 300000);

  proc.on("close", (code) => {
    clearTimeout(timeout);
    res.json({ success: code === 0, output: output.trim() });
  });
});

// 일괄 폴더 생성 (아이템명 배열 → 날짜 폴더 아래 생성)
app.post("/api/create-folders", (req, res) => {
  const { items } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.json({ success: false, message: "아이템명이 없습니다" });
  }

  const today = new Date().toISOString().slice(0, 10);
  const baseDir = path.join("G:", "내 드라이브", "공유작업", "네이버 쇼핑커넥트", today);

  const results = [];
  let created = 0;
  let skipped = 0;

  items.forEach((itemName) => {
    const name = String(itemName).trim();
    if (!name) return;

    // 폴더명에서 사용 불가능한 문자 제거
    const safeName = name.replace(/[\\/:*?"<>|]/g, " ").trim();
    if (!safeName) return;

    const folderPath = path.join(baseDir, safeName);

    try {
      if (fs.existsSync(folderPath)) {
        skipped++;
        results.push({ name: safeName, status: "이미 있음", path: folderPath });
      } else {
        fs.mkdirSync(folderPath, { recursive: true });
        fs.mkdirSync(path.join(folderPath, "photos"), { recursive: true });
        created++;
        results.push({ name: safeName, status: "생성됨", path: folderPath });
      }
    } catch (e) {
      results.push({ name: safeName, status: "오류: " + e.message, path: folderPath });
    }
  });

  res.json({ success: true, date: today, created, skipped, results });
});

// 파이프라인 상태 확인 (폴더의 파일 존재 여부로 단계 판별)
app.get("/api/pipeline", (req, res) => {
  const date = req.query.date || new Date().toISOString().slice(0, 10);
  const baseDir = path.join(
    "G:", "내 드라이브", "공유작업", "네이버 쇼핑커넥트", date
  );

  try {
    const folders = fs
      .readdirSync(baseDir)
      .filter((f) => fs.statSync(path.join(baseDir, f)).isDirectory());

    const pipeline = folders.map((folder) => {
      const folderPath = path.join(baseDir, folder);
      const has = (file) => fs.existsSync(path.join(folderPath, file));

      // 단계별 상태 판별
      const step1 = has("참고글.txt");        // 진택: 링크발급+사진
      const step2 = has("붙여넣기본문.txt");   // 동선: 글쓰기
      const step3 = has("_완료.txt");          // 신혁: 임시저장

      let stage = "대기";
      let stageNum = 0;
      if (step3) { stage = "완료"; stageNum = 3; }
      else if (step2) { stage = "블로그발행 대기"; stageNum = 2; }
      else if (step1) { stage = "글작성 대기"; stageNum = 1; }

      // 사진 목록 (photos/ 폴더의 이미지 파일)
      let photos = [];
      const photosDir = path.join(folderPath, "photos");
      if (fs.existsSync(photosDir)) {
        try {
          photos = fs
            .readdirSync(photosDir)
            .filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f))
            .sort();
        } catch {}
      }

      return {
        folder,
        step1_jintae: step1,
        step2_dongsun: step2,
        step3_shinhuk: step3,
        stage,
        stageNum,
        photos,
      };
    });

    res.json({ success: true, date, pipeline });
  } catch (e) {
    res.json({ success: true, date, pipeline: [] });
  }
});

// 사진 파일 서빙 (보안: 경로 조작 방지)
app.get("/api/photo", (req, res) => {
  const date = path.basename(String(req.query.date || ""));
  const folder = path.basename(String(req.query.folder || ""));
  const file = path.basename(String(req.query.file || ""));

  if (!date || !folder || !file) {
    return res.status(400).send("bad request");
  }

  const filePath = path.join(
    "G:", "내 드라이브", "공유작업", "네이버 쇼핑커넥트", date, folder, "photos", file
  );

  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).send("not found");
  }
});

// 서버 시작
app.listen(PORT, () => {
  console.log(`\n🚀 네이버 자동글쓰기 대시보드`);
  console.log(`   접속: http://localhost:${PORT}\n`);
});
