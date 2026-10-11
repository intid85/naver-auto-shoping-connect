// 네이버 블로그 발행 설정창의 카테고리를 다루는 공통 함수.
// 임시저장 / 즉시발행 / 예약발행이 같은 함수를 쓴다.
//
// 카테고리 이름 형식:
//   "경제공부"                  → 최상위 카테고리
//   "경제공부 > 자금계획"        → 하위 카테고리 (부모를 함께 적으면 이름이 겹쳐도 안전)
//   "자금계획"                  → 하위 이름만 적어도 됨 (같은 이름이 하나뿐일 때)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 네이버는 클래스 이름 뒤에 바뀌는 코드를 붙이므로(예: selectbox_button__IxraO) 앞부분만 일치시킨다.
const SELECT_BUTTON = 'button[class*="selectbox_button"]';
// 드롭다운 항목 (툴바 등 다른 '...-item' 요소가 섞이지 않게 'item__' 로 좁힌다)
const OPTION_ITEM = '[class*="item__"]';

function normalize(text) {
  return String(text || "")
    .replace(/^\s*ㄴ\s*/, "")
    .replace(/^하위 카테고리\s*/, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 카테고리 이름("부모 > 자식" 또는 "이름")을 [{raw, depth}] 목록에서 찾아 위치를 돌려준다.
function findOption(options, wanted) {
  const parts = String(wanted).split(">").map(normalize).filter(Boolean);
  const target = parts[parts.length - 1];
  const parent = parts.length > 1 ? parts[0] : null;

  let currentParent = null;
  const matches = [];
  options.forEach((opt, i) => {
    const name = normalize(opt.raw);
    if (opt.depth === 0) currentParent = name;
    if (name === target) matches.push({ i, parent: opt.depth === 1 ? currentParent : null });
  });
  const scoped = parent ? matches.filter((m) => m.parent === parent) : matches;
  return { found: scoped[0] || null, count: scoped.length };
}

// 지금 화면에 보이는 드롭다운 항목을 [{ el, raw, depth }] 로 읽는다.
// 읽는 방법과 클릭하는 대상이 같은 요소라서, 목록 위치가 어긋날 일이 없다.
async function visibleOptions(frame) {
  const items = frame.locator(OPTION_ITEM);
  const total = await items.count();
  const out = [];
  for (let i = 0; i < total; i++) {
    const el = items.nth(i);
    if (!(await el.isVisible().catch(() => false))) continue;
    const raw = String((await el.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (!raw) continue;
    out.push({ el, raw, depth: /^ㄴ|^하위 카테고리/.test(raw) ? 1 : 0 });
  }
  return out;
}

// 발행 설정창이 열려 있는 상태에서 카테고리를 선택한다.
// 성공하면 선택된 카테고리 이름을, 실패하면 오류를 던진다.
async function selectCategory(frame, wanted) {
  const button = frame.locator(SELECT_BUTTON).first();
  if (!(await button.count())) throw new Error("카테고리 선택칸을 찾지 못했습니다 (발행 설정창이 열려 있어야 합니다)");

  const before = normalize(await button.innerText());
  await button.click();
  await sleep(700);

  const options = await visibleOptions(frame);
  const { found, count } = findOption(options, wanted);
  if (!found) {
    await frame.page().keyboard.press("Escape").catch(() => {});
    throw new Error(`카테고리 '${wanted}' 를 찾지 못했습니다 (보이는 항목 ${options.length}개)`);
  }
  if (count > 1) {
    await frame.page().keyboard.press("Escape").catch(() => {});
    throw new Error(`카테고리 '${wanted}' 가 여러 개입니다. '부모 > 자식' 형식으로 지정하세요`);
  }

  await options[found.i].el.click();
  await sleep(600);

  const after = normalize(await button.innerText());
  const expected = normalize(String(wanted).split(">").pop());
  if (after !== expected) {
    throw new Error(`카테고리 선택 확인 실패: '${expected}' 를 골랐는데 '${after}' 로 표시됩니다 (원래: '${before}')`);
  }
  return after;
}

// 현재 선택된 카테고리를 읽는다 (발행 설정창이 열려 있어야 한다).
async function readSelectedCategory(frame) {
  const button = frame.locator(SELECT_BUTTON).first();
  if (!(await button.count())) return null;
  return normalize(await button.innerText());
}

// 글 폴더에 '카테고리.txt'(예: "국내여행 > 강원")가 있으면 그 글은 그 카테고리로 간다. 없으면 대시보드에서 고른 값.
function folderCategory(folderPath, fallback = "") {
  try {
    const fs = require("fs");
    const path = require("path");
    const f = path.join(String(folderPath || ""), "카테고리.txt");
    if (folderPath && fs.existsSync(f)) {
      const v = fs.readFileSync(f, "utf8").replace(/^﻿/, "").split(/\r?\n/)[0].trim();
      if (v) return v;
    }
  } catch {}
  return fallback || "";
}

module.exports = { selectCategory, readSelectedCategory, findOption, normalize, folderCategory, SELECT_BUTTON };
