// 폴더 하나를 {title, blocks[], tags[]} 로 파싱한다.
//
// 폴더 구조:
//   <폴더>/붙여넣기본문.txt
//   <폴더>/photos/01.jpg, 02.jpg ...
//
// 붙여넣기본문.txt:
//   제목: ...
//   (메타 줄들)
//   ----- 여기 아래만 본문에 붙여넣기 -----
//   문단들. 빈 줄 1개 = 문단 구분, 빈 줄 2개 이상 = 사진 삽입 위치
//   #태그1 #태그2   (맨 아래 줄)

const fs = require("fs");
const path = require("path");

const BODY_MARKER = "여기 아래만 본문에 붙여넣기";
const IMG_EXTS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

function listPhotos(folder) {
  const dir = path.join(folder, "photos");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => IMG_EXTS.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
    .map((f) => path.join(dir, f));
}

function parseFolder(folder) {
  const txtPath = path.join(folder, "붙여넣기본문.txt");
  if (!fs.existsSync(txtPath)) {
    throw new Error(`붙여넣기본문.txt 없음: ${folder}`);
  }
  const raw = fs.readFileSync(txtPath, "utf8");
  const lines = raw.split(/\r?\n/);

  // 제목
  let title = null;
  for (const ln of lines) {
    const m = ln.match(/^\s*제목\s*[:：]\s*(.+)/);
    if (m) {
      title = m[1].trim();
      break;
    }
  }

  // 본문 시작 지점
  let bodyStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(BODY_MARKER)) {
      bodyStart = i + 1;
      break;
    }
  }
  if (bodyStart === -1) {
    throw new Error(`본문 마커('${BODY_MARKER}') 없음: ${txtPath}`);
  }
  let body = lines.slice(bodyStart);

  // 뒤쪽 공백 제거
  while (body.length && body[body.length - 1].trim() === "") body.pop();

  // 맨 아래 태그 줄
  let tags = [];
  if (body.length && body[body.length - 1].trimStart().startsWith("#")) {
    const tagLine = body.pop();
    tags = tagLine
      .split(/\s+/)
      .filter((t) => t.startsWith("#"))
      .map((t) => t.replace(/^#+/, "").trim())
      .filter(Boolean);
    while (body.length && body[body.length - 1].trim() === "") body.pop();
  }

  const photos = listPhotos(folder);

  // 본문 → blocks
  const blocks = [];
  let paraBuf = [];
  let blankRun = 0;
  let photoIdx = 0;

  const flushPara = () => {
    if (paraBuf.length) {
      const text = paraBuf.map((x) => x.replace(/\s+$/, "")).join("\n").trim();
      if (text) blocks.push({ type: "text", text });
    }
    paraBuf = [];
  };

  for (const ln of body) {
    if (ln.trim() === "") {
      blankRun++;
      continue;
    }
    if (blankRun >= 2) {
      flushPara();
      blocks.push({
        type: "image",
        path: photoIdx < photos.length ? photos[photoIdx++] : null,
      });
    } else if (blankRun === 1) {
      flushPara();
    }
    blankRun = 0;
    paraBuf.push(ln);
  }
  flushPara();

  // 남은 사진은 본문 끝에
  while (photoIdx < photos.length) {
    blocks.push({ type: "image", path: photos[photoIdx++] });
  }

  const imageBlocks = blocks.filter((b) => b.type === "image");
  const missing = imageBlocks.filter((b) => b.path === null).length;

  return {
    folder,
    name: path.basename(folder),
    title,
    blocks,
    tags,
    photos,
    stats: {
      textBlocks: blocks.filter((b) => b.type === "text").length,
      imageSlots: imageBlocks.length,
      photosFound: photos.length,
      slotsWithoutPhoto: missing,
    },
  };
}

function listPostFolders(postsDir) {
  if (!fs.existsSync(postsDir)) return [];
  return fs
    .readdirSync(postsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(postsDir, d.name))
    .filter((p) => fs.existsSync(path.join(p, "붙여넣기본문.txt")))
    .sort((a, b) => path.basename(a).localeCompare(path.basename(b), "en", { numeric: true }));
}

module.exports = { parseFolder, listPostFolders };
