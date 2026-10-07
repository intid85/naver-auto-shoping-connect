// 네이버 블로그 자동 작성.
// 실행: npm run post
//
// config.json 의 mode:
//   "draft"    : 제목+본문+사진만 임시저장. (태그/커넥트/예약은 나중에 손으로)
//   "schedule" : 본문 작성 -> [커넥트 첨부 대기] -> 태그 입력 -> 예약발행.
//
// ⚠️ 스마트에디터 구조가 바뀌면 셀렉터 수정이 필요할 수 있습니다.
//    첫 실행은 config 의 limit 를 1 로 두고 폴더 1개로 테스트하세요.

const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const readline = require("readline");
const config = require("./config.json");
if (process.env.NAVER_BLOG_ID) config.blogId = process.env.NAVER_BLOG_ID;
const { parseFolder, listPostFolders } = require("./lib/parse");
const { STATE_FILE, LOG_DIR } = require("./lib/paths");
const { selectCategory } = require("./lib/category");
const { buildReviewCards } = require("./lib/reviewcard");

// 대시보드는 환경변수로 한 건의 실행 방식을 지정하고, 일반 실행은 config.json을 따른다.
const runtimeMode = ["draft", "publish"].includes(process.env.POST_MODE) ? process.env.POST_MODE : config.mode;

fs.mkdirSync(LOG_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ask = (q) =>
  new Promise((res) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, (a) => {
      rl.close();
      res(a);
    });
  });

// 여러 후보 셀렉터 중 먼저 보이는 것을 클릭
async function clickAny(scope, selectors, { timeout = 5000, optional = false } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    for (const sel of selectors) {
      const loc = scope.locator(sel).first();
      if ((await loc.count()) && (await loc.isVisible().catch(() => false))) {
        await loc.click().catch(() => {});
        return true;
      }
    }
    await sleep(250);
  }
  if (!optional) console.log(`   (셀렉터 못 찾음: ${selectors.join(" | ")})`);
  return false;
}

// 발행 설정창 열기/닫기. 네이버가 클래스 뒤 코드를 바꿔도 되도록 앞부분만 일치시킨다.
async function openPublishPanel(frame) {
  const opened = await clickAny(frame, ['button[class*="publish_btn"]', 'button[class*="publish"]:has-text("발행")']);
  if (!opened) throw new Error("발행 설정 버튼을 찾지 못했습니다");
  await sleep(1500);
}

// 발행하지 않고 설정창만 닫는다. 최종 '발행'(confirm) 버튼은 절대 누르지 않는다.
async function closePublishPanel(frame) {
  const closed = await clickAny(frame, ['button[class*="publish_fold_btn"]', 'button:has-text("발행 설정 닫기")'], { timeout: 3000, optional: true });
  if (!closed) await frame.page().keyboard.press("Escape").catch(() => {});
  await sleep(700);
}

async function dismissPopups(frame) {
  // 이전 작성글 복구 팝업 -> "취소" (새 글로 시작)
  await clickAny(
    frame,
    [
      "button.se-popup-button-cancel",
      '.se-popup-button-text:has-text("취소")',
      'button:has-text("취소")',
    ],
    { timeout: 3000, optional: true }
  );
  // 도움말/기타 레이어 닫기
  await clickAny(
    frame,
    ['button.se-help-panel-close-button', 'button[class*="close"]:visible'],
    { timeout: 1500, optional: true }
  );
}

async function writeOne(page, post) {
  const frame = page.frameLocator("#mainFrame");

  // 구매리뷰 카드(이미지): 쇼핑커넥트 상품 카드 바로 위에 들어간다. 만들지 못하면 카드 없이 그대로 진행.
  // 끄려면 환경변수 POST_REVIEWCARD=0
  // 쇼핑커넥트 글은 항상 같은 구성: 맨 위 / 본문 중간 / 태그 바로 위, 3곳에 [구매리뷰 카드 + 상품 카드]. 프롬프트·설정과 무관.
  let cards = {};
  if (post.connect && process.env.POST_REVIEWCARD !== "0") {
    cards = await buildReviewCards(page.context(), post, post.folder, {
      minReviews: config.reviewCardMinReviews ?? 10,
      accountId: config.connectAccountId,
    });
    await page.bringToFront().catch(() => {});
  }

  console.log(`   에디터 로딩...`);
  await sleep(3500);
  await dismissPopups(frame);

  // ---- 제목 ----
  console.log(`   제목 입력`);
  await clickAny(frame, [
    ".se-section-documentTitle .se-placeholder",
    ".se-section-documentTitle .se-text-paragraph",
    ".se-documentTitle",
  ]);
  await sleep(400);
  const pasteText = async (text) => {
    let pasted = false;
    try {
      await page.evaluate(async (value) => navigator.clipboard.writeText(value), text);
      await page.keyboard.press("Control+V");
      pasted = true;
    } catch {}
    if (!pasted) await page.keyboard.insertText(text);
  };
  await pasteText(post.title || "제목 없음");
  await sleep(300);

  // ---- 본문 진입 ----
  await clickAny(frame, [
    ".se-section-text .se-text-paragraph",
    ".se-component.se-text .se-text-paragraph",
    '.se-component-content [contenteditable="true"]',
  ]);
  await sleep(400);

  const imageCount = () => frame.locator(".se-component.se-image").count().catch(() => 0);

  // 입력 방식: 기본은 "본문을 먼저 다 쓰고 점(.) 자리로 돌아가 끼우기".
  // POST_SEQUENTIAL=1 (또는 config.sequentialInput) 이면 "위에서 아래로 쓰면서 그 자리에서 바로 끼우기" (커서가 위아래로 안 움직인다).
  const sequential = process.env.POST_SEQUENTIAL === "1" || config.sequentialInput === true;

  // 쇼핑커넥트 상품 검색 → 추가 → 카드가 실제로 생길 때까지 확인. (커서가 놓인 자리에 들어간다)
  const attachShop = async (query, label) => {
    const productToken = query.slice(0, 24);
    const beforeCards = await frame.locator(".se-component").filter({ hasText: productToken }).count();

    console.log(`   쇼핑커넥트 상품 첨부 (${label}): ${query}`);
    const shoppingButton = frame.locator('button[data-name="shopping-connect"]').first();
    if (!(await shoppingButton.count())) throw new Error("쇼핑커넥트 버튼을 찾지 못함");
    await shoppingButton.click();
    await sleep(1200);

    const searchInput = frame.locator('input[placeholder="쇼핑 커넥트 상품을 검색해 보세요."]').first();
    if (!(await searchInput.count())) throw new Error("쇼핑커넥트 검색창을 찾지 못함");
    await searchInput.fill(query);
    await frame.locator("button.se-popup-search-button").click();
    await sleep(1800);

    const item = frame.locator("li.se-shopping-connect-item").filter({ hasText: query }).first();
    const targetItem = (await item.count()) ? item : frame.locator("li.se-shopping-connect-item").first();
    if (!(await targetItem.count())) throw new Error(`쇼핑커넥트 상품 검색 결과 없음: ${query}`);
    await targetItem.locator("button.se-shopping-connect-item-add-button").click();
    await sleep(800);

    const confirm = frame.locator(".se-popup-shopping-connect-add-component-layer button.se-popup-button-confirm").first();
    if (!(await confirm.count())) throw new Error("쇼핑커넥트 추가 확인창을 찾지 못함");
    await confirm.click();
    await sleep(2200);

    const productCards = frame.locator(".se-component").filter({ hasText: productToken });
    const cardStarted = Date.now();
    while ((await productCards.count()) <= beforeCards && Date.now() - cardStarted < 15000) await sleep(500);
    if ((await productCards.count()) <= beforeCards) throw new Error(`쇼핑커넥트 상품 카드가 추가되지 않음: ${label}`);
    console.log(`     - ${label} 상품 카드 확인`);
  };

  // 사진 한 장 업로드 (커서가 놓인 자리에 들어간다)
  const uploadImage = async (photo) => {
    console.log(`   사진 업로드: ${path.basename(photo)}`);
    const before = await imageCount();
    const fcPromise = page.waitForEvent("filechooser", { timeout: 12000 });
    await clickAny(frame, ["button.se-image-toolbar-button", 'button[data-name="image"]', ".se-toolbar-item-image button"], { timeout: 5000 });
    const fc = await fcPromise;
    await fc.setFiles([photo]);
    const t0 = Date.now();
    let stable = 0;
    while (Date.now() - t0 < 25000 && stable < 5) {
      stable = (await imageCount()) > before ? stable + 1 : 0;
      await sleep(400);
    }
    if (stable < 5) throw new Error(`${path.basename(photo)} 업로드 완료를 확인하지 못함`);
    console.log(`     - 이미지 수 ${await imageCount()}장 안정 확인`);
  };

  // 본문 전체 선택 → 상속된 취소선/굵게 등 해제 → 가운데 정렬. 글자만 있을 때 하면 빠르다.
  const cleanFormatAndAlign = async () => {
    await frame.locator(".se-component.se-text .se-text-paragraph").first().click().catch(() => {});
    await sleep(200);
    await page.keyboard.press("Control+a");
    await sleep(500);

    for (const name of ["strikethrough", "bold", "italic", "underline"]) {
      const btn = frame.locator(`button[data-name="${name}"]`).first();
      if (!(await btn.count())) continue;
      const active = await btn.evaluate((e) => e.className.includes("se-is-selected")).catch(() => false);
      if (active) {
        await btn.click().catch(() => {});
        await sleep(250);
        console.log(`     - ${name} 해제`);
      }
    }

    if (config.centerAlign) {
      const alignBtn = frame.locator('button[data-name="align-drop-down-with-justify"]').first();
      if (await alignBtn.count()) {
        await alignBtn.click().catch(() => {});
        await sleep(600);
        const centerOpt = frame.locator("button.se-toolbar-option-align-center-button").first();
        const already = await centerOpt
          .evaluate((e) => e.className.includes("se-is-selected"))
          .catch(() => false);
        if (!already) {
          await centerOpt.click().catch(() => {});
          console.log(`     - 가운데 정렬 적용`);
          await sleep(300);
        } else {
          // 이미 가운데 -> 드롭다운만 닫기
          await alignBtn.click().catch(() => {});
        }
        await sleep(300);
      }
    }
    await diag("서식 정리/정렬 후");
  };

  // 진단(POST_DIAG=1): 단계별로 에디터가 스크롤된 횟수를 센다. 평소에는 아무것도 하지 않는다.
  const DIAG = process.env.POST_DIAG === "1";
  let diagLast = 0;
  const diag = async (label) => {
    if (!DIAG) return;
    const n = await frame.locator("body").evaluate(() => {
      if (!window.__scrollCount && window.__scrollCount !== 0) {
        window.__scrollCount = 0;
        window.addEventListener("scroll", () => { window.__scrollCount++; }, true);
      }
      return window.__scrollCount;
    }).catch(() => -1);
    console.log(`   [진단] ${label}: 스크롤 누적 ${n}회 (이 단계 +${n - diagLast})`);
    diagLast = n;
  };

  // 커서를 문서 맨 끝(마지막 빈 문단)으로
  const goToEnd = async () => {
    const last = frame.locator(".se-component.se-text .se-text-paragraph").last();
    if (await last.count()) await last.click({ force: true }).catch(() => {});
    await page.keyboard.press("Control+End");
    await sleep(200);
  };

  // === 1단계: 본문 텍스트를 한 번에 입력 (사진 자리에는 마커 줄) ===
  // 사진 삽입을 타이핑과 분리해야 커서 유실/줄 유실이 없다.
  console.log(`   본문 입력`);
  // 사진 자리는 영어 코드 대신 점 하나만 있는 독립 문단으로 표시한다.
  // 일반 문장 속 마침표와 구분하기 위해 아래에서 점 하나뿐인 문단만 찾는다.
  const PHOTO_MARK = ".";
  const PHOTO_MARK_PATTERN = /^\s*\.\s*$/;
  const slotPhotos = []; // 마커순서 -> 사진경로(없으면 null)

  // 붙여넣기 전에 이전 편집 상태에서 이어진 글자 서식을 끈다.
  for (const name of ["strikethrough", "bold", "italic", "underline"]) {
    const btn = frame.locator(`button[data-name="${name}"]`).first();
    if (!(await btn.count())) continue;
    const active = await btn
      .evaluate((e) => e.className.includes("se-is-selected") || e.getAttribute("aria-pressed") === "true")
      .catch(() => false);
    if (active) await btn.click().catch(() => {});
  }

  // ---- 본문 레이아웃 ----
  // 문서 순서대로 text / image(사진·구매리뷰 카드) / shop(쇼핑커넥트 상품 카드) 자리를 만든다.
  //  - 사진은 원고에 적힌 자리와 상관없이 본문 문단 사이에 고르게 퍼뜨린다.
  //    (원고에 자리가 없거나 몰려 있어도 사진이 한 줄로 이어 붙지 않게)
  //  - 상품 카드는 맨 위 / 중간 / 태그 바로 위 3곳. 구매리뷰 카드는 각 상품 카드 바로 위.
  const textBlocks = post.blocks.filter((x) => x.type === "text");
  const photoPaths = post.blocks.filter((x) => x.type === "image" && x.path).map((x) => x.path);
  const T = textBlocks.length;
  const hasConnect = !!post.connect;

  const inserts = photoPaths.map((p) => [{ role: "image", path: p }]); // 문단 사이에 끼울 묶음들
  if (hasConnect) {
    const mid = [];
    if (cards.middle) mid.push({ role: "image", path: cards.middle });
    mid.push({ role: "shop", label: "본문 중간" });
    inserts.splice(Math.floor(inserts.length / 2), 0, mid); // 사진들 가운데쯤
  }
  const K = inserts.length;
  const groupsAfter = new Map(); // n번째 문단 뒤 -> 묶음들
  inserts.forEach((group, i) => {
    const pos = T ? Math.min(T, Math.max(1, Math.round(((i + 1) * T) / (K + 1)))) : 0;
    if (!groupsAfter.has(pos)) groupsAfter.set(pos, []);
    groupsAfter.get(pos).push(group);
  });

  const layout = []; // {type:"text", lines} | {type:"dot", entry}
  const dot = (entry) => layout.push({ type: "dot", entry });
  if (hasConnect) {
    if (cards.top) dot({ role: "image", path: cards.top });
    dot({ role: "shop", label: "본문 맨 위" });
    // 수수료 고지 문구는 네이버가 상품 카드와 함께 맨 위에 자동으로 넣으므로 기본은 직접 적지 않는다.
    // 예전처럼 직접 적으려면 환경변수 POST_DISCLOSURE=1
    if (process.env.POST_DISCLOSURE === "1") {
      layout.push({ type: "text", lines: ["이 포스팅은 네이버 쇼핑 커넥트 활동의 일환으로, 판매 발생 시 수수료를 제공받습니다."] });
    }
  }
  for (const g of groupsAfter.get(0) || []) g.forEach(dot);
  textBlocks.forEach((b, j) => {
    layout.push({ type: "text", lines: b.text.split("\n").filter((l) => l.trim() !== "") });
    for (const g of groupsAfter.get(j + 1) || []) g.forEach(dot);
  });
  if (hasConnect) {
    if (cards.bottom) dot({ role: "image", path: cards.bottom });
    dot({ role: "shop", label: "태그 바로 위" });
  }

  const bodyLines = [];
  const roles = []; // 점(.) 자리 목록 (문서 순서)
  for (const item of layout) {
    if (item.type === "text") for (const line of item.lines) bodyLines.push(line, "");
    else {
      bodyLines.push(PHOTO_MARK, "");
      roles.push(item.entry);
    }
  }
  const imageEntries = roles.filter((e) => e.role === "image");
  const shopEntries = roles.filter((e) => e.role === "shop");
  imageEntries.forEach((e) => slotPhotos.push(e.path));
  console.log(`   본문 구성: 문단 ${T} / 사진 ${photoPaths.length} / 구매리뷰 카드 ${Object.keys(cards).length} / 상품 카드 ${shopEntries.length}`);

  // draft: 태그 줄을 본문 맨 아래에 남겨둔다 (발행 때 복사 → 태그칸 → 본문에서 삭제)
  if (runtimeMode === "draft" && post.tags && post.tags.length) {
    console.log(`   태그 줄 본문 맨 아래 입력 (${post.tags.length}개)`);
    bodyLines.push("#" + post.tags.join(" #"));
  }

  // 구성이 끝난 뒤 에디터 안의 실제 순서를 검사하기 위한 기대값 (문단=T 사진=I 상품카드=S, 연속 문단은 하나로)
  const expectedOrder = [];
  for (const item of layout) {
    const t = item.type === "text" ? "T" : item.entry.role === "shop" ? "S" : "I";
    if (!(t === "T" && expectedOrder[expectedOrder.length - 1] === "T")) expectedOrder.push(t);
  }

  if (sequential) {
    // ===== 순서대로 입력: 위에서 아래로 쓰면서 사진/카드를 그 자리에서 바로 끼운다 =====
    console.log(`   입력 방식: 순서대로 (커서 이동 없음)`);
    const query = post.connect?.productName || post.title;
    let buf = [];
    const flush = async () => {
      if (!buf.length) return;
      await pasteText(buf.join("\n"));
      buf = [];
      await sleep(500);
    };
    // 컴포넌트를 끼우기 전에 커서가 "빈 새 문단"에 있게 한다.
    const prepareEmptyParagraph = async () => {
      const lastText = await frame.locator(".se-component.se-text .se-text-paragraph").last().innerText().catch(() => "");
      if (lastText.trim()) await page.keyboard.press("Enter");
      await sleep(200);
    };
    for (const item of layout) {
      if (item.type === "text") {
        for (const line of item.lines) buf.push(line, "");
        continue;
      }
      await flush();
      await prepareEmptyParagraph();
      if (item.entry.role === "shop") await attachShop(query, item.entry.label);
      else await uploadImage(item.entry.path);
      await goToEnd();
    }
    if (runtimeMode === "draft" && post.tags && post.tags.length) buf.push("#" + post.tags.join(" #"));
    await flush();
  } else {
  // ===== 기본 방식: 본문을 먼저 다 붙여넣고, 점(.) 자리로 돌아가 끼운다 =====
  // 본문을 먼저 한 번에 붙여넣어 화면 대기를 줄인다.
  const bodyText = bodyLines.join("\n").replace(/\n+$/, "");
  await diag("본문 붙여넣기 직전");
  await pasteText(bodyText);
  await sleep(800);
  await diag("본문 붙여넣기 후");
  await cleanFormatAndAlign();

  // 쇼핑커넥트 상품 카드를 3곳(맨 위 / 중간 / 태그 바로 위)에 첨부한다.
  // 발급 URL은 본문 텍스트로 노출하지 않는다.
  // remaining: 아직 에디터에 남아 있는 점(.) 자리들. 인덱스 계산에 쓴다.
  const remaining = roles.slice();
  if (hasConnect) {
    const query = post.connect.productName || post.title;

    for (const entry of shopEntries) {
      const dotParagraphs = frame.locator(".se-text-paragraph").filter({ hasText: PHOTO_MARK_PATTERN });
      const dotCountBefore = await dotParagraphs.count();
      if (!dotCountBefore) throw new Error(`쇼핑커넥트 점(.) 위치를 찾지 못함: ${entry.label}`);
      const shopPara = dotParagraphs.nth(remaining.indexOf(entry));
      const shopNode = shopPara.locator("span.__se-node").filter({ hasText: PHOTO_MARK_PATTERN }).first();
      if (!(await shopNode.count())) throw new Error(`쇼핑커넥트 점(.) 글자 노드를 찾지 못함: ${entry.label}`);
      await shopNode.click({ force: true });
      await sleep(200);

      // 점 하나뿐인 문단이므로 줄 끝으로 이동한 뒤 Backspace 한 번으로 지운다.
      await page.keyboard.press("End");
      await page.keyboard.press("Backspace");
      await sleep(400);
      let dotCountAfter = await frame.locator(".se-text-paragraph").filter({ hasText: PHOTO_MARK_PATTERN }).count();
      if (dotCountAfter >= dotCountBefore) {
        await shopNode.click({ force: true });
        await page.keyboard.press("Home");
        await page.keyboard.press("Delete");
        await sleep(400);
        dotCountAfter = await frame.locator(".se-text-paragraph").filter({ hasText: PHOTO_MARK_PATTERN }).count();
      }
      if (dotCountAfter >= dotCountBefore) {
        console.log(`   ⚠️ 쇼핑커넥트 점(.)이 남았지만 계속 진행: ${entry.label}`);
      } else {
        remaining.splice(remaining.indexOf(entry), 1);
      }

      await attachShop(query, entry.label);
    }
    const totalCards = await frame.locator(".se-component").filter({ hasText: query.slice(0, 24) }).count();
    console.log(`     - 쇼핑커넥트 상품 카드 총 ${totalCards}개 확인 (목표 ${shopEntries.length}개)`);
    await diag("상품 카드 첨부 후");
  }

  // === 2단계: 마커를 뒤에서부터 찾아 사진으로 교체 ===
  for (let k = slotPhotos.length - 1; k >= 0; k--) {
    const photo = slotPhotos[k];
    const photoMarkers = frame.locator(".se-text-paragraph").filter({ hasText: PHOTO_MARK_PATTERN });
    const markerCountBefore = await photoMarkers.count();
    const para = photoMarkers.nth(remaining.indexOf(imageEntries[k]));
    try {
      if (!markerCountBefore) {
        console.log(`   ⚠️ 사진 점(.) 자리 ${k + 1} 못 찾음`);
        continue;
      }
      // 마커 글자만 DOM Range로 정확히 선택한 뒤 실제 키보드 입력으로 지운다.
      // execCommand/delete나 textContent 직접 변경은 스마트에디터의 내부 상태에
      // 반영되지 않아 ZI2Z 같은 영문 표식이 다시 살아나는 경우가 있다.
      const markerNode = para.locator("span.__se-node").filter({ hasText: PHOTO_MARK_PATTERN }).first();
      if (!(await markerNode.count())) throw new Error(`사진 점(.) 글자 노드를 찾지 못함: 슬롯 ${k + 1}`);
      await markerNode.click({ force: true });
      await sleep(200);

      await page.keyboard.press("End");
      await page.keyboard.press("Backspace");
      await sleep(400);

      // 첫 입력을 놓친 경우 같은 범위를 다시 잡고 Delete 키로 한 번 더 시도한다.
      let markerCountAfter = await frame
        .locator(".se-text-paragraph")
        .filter({ hasText: PHOTO_MARK_PATTERN })
        .count();
      if (markerCountAfter >= markerCountBefore) {
        const remainingMarkerNode = para.locator("span.__se-node").filter({ hasText: PHOTO_MARK_PATTERN }).first();
        if (await remainingMarkerNode.count()) {
          await remainingMarkerNode.click({ force: true });
          await page.keyboard.press("Home");
          await page.keyboard.press("Delete");
          await sleep(400);
          markerCountAfter = await frame
            .locator(".se-text-paragraph")
            .filter({ hasText: PHOTO_MARK_PATTERN })
            .count();
        }
      }
      if (markerCountAfter >= markerCountBefore) {
        console.log(`   ⚠️ 사진 점(.)이 남았지만 계속 진행: 슬롯 ${k + 1}`);
      }

      console.log(`   사진 업로드: ${path.basename(photo)}`);
      const before = await imageCount();
      const fcPromise = page.waitForEvent("filechooser", { timeout: 12000 });
      await clickAny(
        frame,
        ["button.se-image-toolbar-button", 'button[data-name="image"]', ".se-toolbar-item-image button"],
        { timeout: 5000 }
      );
      let fc;
      try {
        fc = await fcPromise;
      } catch {
        console.log("   ⚠️ 파일 선택창이 안 열림 - 건너뜀");
        continue;
      }
      await fc.setFiles([photo]);
      // 이미지가 실제로 추가될 때까지 (최대 25초)
      const t0 = Date.now();
      let imageAdded = false;
      let stableChecks = 0;
      while (Date.now() - t0 < 25000) {
        const currentCount = await imageCount();
        stableChecks = currentCount > before ? stableChecks + 1 : 0;
        if (stableChecks >= 5) {
          imageAdded = true;
          break;
        }
        await sleep(400);
      }
      if (!imageAdded) throw new Error(`${path.basename(photo)} 업로드 완료를 확인하지 못함`);
      console.log(`     - 이미지 수 ${(await imageCount())}장 안정 확인`);
      await sleep(250);
    } catch (e) {
      console.log(`   ⚠️ 슬롯 ${k} 처리 오류: ${e.message}`);
    }
  }

  }

  await diag("사진/카드 이미지 삽입 후");
  const remainingPhotoMarkers = await frame
    .locator(".se-text-paragraph")
    .filter({ hasText: PHOTO_MARK_PATTERN })
    .count();
  if (remainingPhotoMarkers) {
    console.log(`   ⚠️ 점(.) 자리표시자 ${remainingPhotoMarkers}개가 남았지만 임시저장은 계속 진행`);
  }

  // ---- 본문 전체 선택 후 서식 정리 ----
  // 스마트에디터는 직전 글의 글자서식(굵게/취소선 등)을 이어받는다.
  // 원치 않는 서식(특히 취소선)이 켜져 있으면 끈다.
  console.log(`   서식 정리 (원치 않는 취소선/굵게 등 해제)`);
  await diag("서식 정리 시작");
  const markerPattern = /ZI\d+Z|ZTOPZ|ZBOTZ|ZZIMG|IMGSLOT|ZZSHOPPING/i;
  const markerParagraphs = frame
    .locator(".se-component.se-text .se-text-paragraph")
    .filter({ hasText: markerPattern });
  for (let i = (await markerParagraphs.count()) - 1; i >= 0; i--) {
    const markerPara = markerParagraphs.nth(i);
    const markerNode = markerPara.locator("span.__se-node").filter({ hasText: markerPattern }).first();
    if (!(await markerNode.count())) continue;
    await markerNode.evaluate((el) => {
      el.textContent = "";
      el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
      const editor = el.closest(".se-component-content") || el.parentElement;
      editor?.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
    });
    await sleep(250);
  }
  const remainingMarkers = await frame
    .locator(".se-component.se-text .se-text-paragraph")
    .filter({ hasText: markerPattern })
    .allInnerTexts();
  if (remainingMarkers.length) throw new Error(`본문 자리표시자 잔존: ${remainingMarkers.join(", ")}`);

  const finalImageCount = await imageCount();
  if (finalImageCount !== slotPhotos.length) {
    const mismatch = `사진 수 불일치: 예상 ${slotPhotos.length}장 / 실제 ${finalImageCount}장`;
    if (runtimeMode === "draft") {
      console.log(`   ⚠️ ${mismatch} — 요청대로 임시저장은 계속 진행`);
    } else {
      throw new Error(mismatch);
    }
  }
  console.log(`   사진 검증 완료: ${finalImageCount}장 / 영문 자리표시자 없음`);

  // 에디터 안의 실제 순서 (T 문단 / I 사진 / S 쇼핑커넥트 상품 카드)
  {
    const token = (post.connect?.productName || post.title || "").slice(0, 24);
    const actual = await frame.locator(".se-component").evaluateAll((els, tk) => {
      const out = [];
      for (const e of els) {
        const c = e.classList;
        let t = "?";
        if (c.contains("se-image")) t = "I";
        else if (c.contains("se-text")) t = "T";
        else if (tk && (e.textContent || "").includes(tk)) t = "S";
        if (!(t === "T" && out[out.length - 1] === "T")) out.push(t);
      }
      return out;
    }, token).catch(() => []);
    // 문단(T)과 제목 칸(?)은 빼고 사진(I)/상품 카드(S) 순서만 비교한다. (빈 문단 수는 에디터가 정하므로)
    const joined = actual.filter((t) => t === "I" || t === "S").join(" ");
    const want = expectedOrder.filter((t) => t === "I" || t === "S").join(" ");
    console.log(`   순서 확인: ${joined === want ? "일치" : "불일치"}`);
    if (joined !== want) {
      console.log(`     예상: ${want}\n     실제: ${joined}`);
      if (sequential) throw new Error("에디터 안의 순서가 예상과 달라 저장하지 않고 멈춥니다");
    }
  }

  // 서식 정리/가운데 정렬은 기본 방식에서는 본문을 붙여넣은 직후(글자만 있을 때)에 이미 했다.
  // (사진·카드가 다 들어간 뒤에 전체 선택하면 에디터가 컴포넌트마다 화면을 오가며 느려진다)
  if (sequential) await cleanFormatAndAlign();
  await diag("가운데 정렬 후");
  await page.keyboard.press("End").catch(() => {});
  await sleep(300);

  // ---- 저장 / 발행 ----
  if (runtimeMode === "draft") {
    // 대시보드에서 카테고리를 골랐을 때만: 발행 설정창을 열어 카테고리를 맞추고 닫은 뒤 저장한다.
    // 지정하지 않으면 예전과 똑같이 동작한다.
    if (process.env.POST_CATEGORY) {
      console.log(`   카테고리 지정: ${process.env.POST_CATEGORY}`);
      await openPublishPanel(frame);
      const chosen = await selectCategory(frame, process.env.POST_CATEGORY);
      console.log(`   카테고리 선택됨: ${chosen}`);
      await closePublishPanel(frame);
    }
    if (process.env.POST_DRYRUN === "1") {
      console.log(`   (DRYRUN: 임시저장하지 않고 종료)`);
      return;
    }
    console.log(`   임시저장`);
    await clickAny(frame, [
      'button:has-text("저장")',
      "button.save_btn__bzc5B",
      'button[class*="save"]',
    ]);
    await sleep(2500);
    // "저장되었습니다" 확인 팝업이 뜨면 닫기
    await clickAny(frame, ['button:has-text("확인")'], { timeout: 2000, optional: true });
    console.log(`   ✅ 임시저장 완료`);
    return;
  }

  // 대시보드에서 사용자가 최종 확인한 한 건을 즉시 발행한다.
  if (runtimeMode === "publish") {
    console.log(`   즉시 발행 설정 열기`);
    const opened = await clickAny(frame, [
      "button.publish_btn__m9KHH",
      'button[class*="publish"]:has-text("발행")',
      'button:has-text("발행")',
    ]);
    if (!opened) throw new Error("발행 설정 버튼을 찾지 못했습니다");
    await sleep(1500);

    if (process.env.POST_CATEGORY) {
      console.log(`   카테고리 지정: ${process.env.POST_CATEGORY}`);
      const chosen = await selectCategory(frame, process.env.POST_CATEGORY);
      console.log(`   카테고리 선택됨: ${chosen}`);
    }

    if (post.tags.length) {
      console.log(`   태그 ${post.tags.length}개 붙여넣기`);
      for (const t of post.tags) {
        const tagInput = frame.locator('#tag-input, input[class*="tag_input"], input[placeholder*="태그"]').first();
        if (await tagInput.count()) {
          await tagInput.click();
          await page.evaluate(async (value) => navigator.clipboard.writeText(value), t);
          await page.keyboard.press("Control+V");
          await page.keyboard.press("Enter");
          await sleep(300);
        }
      }
    }

    await clickAny(frame, [
      'label:has-text("현재")',
      'label:has-text("지금")',
      'input[value="NOW"]',
    ], { timeout: 1200, optional: true });
    const published = await clickAny(frame, [
      'button.confirm_btn__WEaBq',
      '.layer_btn_area button:has-text("발행")',
      'button[class*="confirm"]:has-text("발행")',
    ]);
    if (!published) throw new Error("최종 발행 버튼을 찾지 못했습니다");
    await sleep(3000);
    console.log(`   ✅ 즉시 발행 완료`);
    return;
  }

  // schedule 모드
  if (runtimeMode === "schedule") {
    console.log("\n   ┌─ 커넥트(쇼핑) 상품을 지금 브라우저에서 첨부하세요.");
    await ask("   └─ 첨부 끝났으면 Enter > ");

    console.log(`   발행 설정 열기`);
    await clickAny(frame, [
      "button.publish_btn__m9KHH",
      'button[class*="publish"]:has-text("발행")',
      'button:has-text("발행")',
    ]);
    await sleep(1500);

    // 태그
    if (post.tags.length) {
      console.log(`   태그 ${post.tags.length}개 입력`);
      for (const t of post.tags) {
        const tagInput = frame
          .locator('#tag-input, input[class*="tag_input"], input[placeholder*="태그"]')
          .first();
        if (await tagInput.count()) {
          await tagInput.click();
          await page.keyboard.type(t, { delay: 20 });
          await page.keyboard.press("Enter");
          await sleep(300);
        }
      }
    }

    // 예약
    const when = post._when; // post.js 상단 루프에서 계산해 넣음
    console.log(`   예약 시각 설정: ${when.label}`);
    await clickAny(frame, [
      'label:has-text("예약")',
      'input[value="RESERVE"]',
      'span:has-text("예약")',
    ]);
    await sleep(800);
    // 날짜
    const dateInput = frame.locator('input[class*="date"], .se_date_input input, input[placeholder*="날짜"]').first();
    if (await dateInput.count()) {
      await dateInput.fill("");
      await dateInput.type(when.date, { delay: 30 });
      await page.keyboard.press("Escape");
    }
    // 시/분 (select 또는 커스텀 드롭다운)
    const hourSel = frame.locator('select[class*="hour"], select[name*="hour"]').first();
    const minSel = frame.locator('select[class*="minute"], select[name*="minute"]').first();
    if (await hourSel.count()) await hourSel.selectOption(when.hour).catch(() => {});
    if (await minSel.count()) await minSel.selectOption(when.minute).catch(() => {});
    await sleep(500);

    console.log("\n   ⚠️ 발행 레이어 상태를 브라우저에서 확인하세요 (태그/예약시각).");
    const go = await ask("   이대로 발행하려면 y, 건너뛰려면 n > ");
    if (go.trim().toLowerCase() !== "y") {
      console.log("   건너뜀 (이 글은 발행 안 됨).");
      return;
    }
    await clickAny(frame, [
      'button.confirm_btn__WEaBq',
      '.layer_btn_area button:has-text("발행")',
      'button[class*="confirm"]:has-text("발행")',
    ]);
    await sleep(3000);
    console.log(`   ✅ 예약발행 완료`);
  }
}

function computeSchedule(index) {
  // index: 0부터
  const [d, t] = config.schedule.start.split(" ");
  const base = new Date(`${d}T${t}:00`);
  base.setHours(base.getHours() + index * config.schedule.intervalHours);
  const pad = (n) => String(n).padStart(2, "0");
  const date = `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
  return {
    date,
    hour: pad(base.getHours()),
    minute: pad(Math.floor(base.getMinutes() / 10) * 10), // 10분 단위
    label: `${date} ${pad(base.getHours())}:${pad(base.getMinutes())}`,
  };
}

function resolvePostFolders() {
  const forcedFolderPath = process.env.POST_FOLDER_PATH;
  if (forcedFolderPath) {
    const resolved = path.resolve(forcedFolderPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`대시보드 선택 폴더를 찾을 수 없습니다: ${resolved}`);
    }
    return [resolved];
  }

  let folders = listPostFolders(config.postsDir);
  folders = folders.slice(config.startFrom - 1);
  if (config.limit > 0) folders = folders.slice(0, config.limit);
  return folders;
}

module.exports = { writeOne, computeSchedule, resolvePostFolders };

// sync.js 등에서 require 하면 아래 실행부는 건너뛴다
if (require.main !== module) return;

(async () => {
  if (!config.blogId || config.blogId.includes("여기에")) {
    console.log("\n⛔ config.json 의 blogId 를 먼저 설정하세요.\n");
    process.exit(1);
  }

  let folders;
  try {
    folders = resolvePostFolders();
  } catch (e) {
    console.log(`\n⛔ ${e.message}\n`);
    process.exit(1);
  }

  if (!folders.length) {
    console.log(`\n'${config.postsDir}' 에 처리할 폴더가 없습니다.\n`);
    process.exit(0);
  }

  console.log(`\n대상 ${folders.length}개 폴더, 모드=${runtimeMode}\n`);

  if (!fs.existsSync(STATE_FILE)) {
    console.log("⛔ 로그인 세션이 없습니다. 먼저:  npm run login\n");
    process.exit(1);
  }

  const browser = await chromium.launch({
    headless: config.headless,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled", "--start-maximized"],
  });
  const ctx = await browser.newContext({
    storageState: STATE_FILE,
    viewport: null,
    acceptDownloads: false,
  });
  await ctx
    .grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://blog.naver.com" })
    .catch(() => {});
  const page = await ctx.newPage();

  // 로그인 체크: 글쓰기 URL 이 로그인 페이지로 튕기는지
  await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, {
    waitUntil: "domcontentloaded",
    timeout: 25000,
  });
  await sleep(4000);
  if (/nidlogin|nid\.naver\.com/.test(page.url())) {
    console.log("⛔ 네이버 로그인이 만료됐습니다. 다시:  npm run login\n");
    await browser.close();
    process.exit(1);
  }

  const results = [];
  for (let i = 0; i < folders.length; i++) {
    const folder = folders[i];
    const name = path.basename(folder);
    console.log(`\n[${i + 1}/${folders.length}] ${name}`);
    try {
      const post = parseFolder(folder);
      if (!post.title) throw new Error("제목 파싱 실패");
      if (runtimeMode === "schedule") post._when = computeSchedule(config.startFrom - 1 + i);

      await page.goto(`https://blog.naver.com/${config.blogId}?Redirect=Write&`, {
        waitUntil: "domcontentloaded",
      });
      await writeOne(page, post);
      results.push({ name, ok: true });
    } catch (e) {
      console.log(`   ❌ 오류: ${e.message}`);
      await page
        .screenshot({ path: path.join(LOG_DIR, `${name}-error.png`), fullPage: true })
        .catch(() => {});
      results.push({ name, ok: false, error: e.message });
    }
    if (i < folders.length - 1) {
      console.log(`   ${config.betweenPostsDelaySec}초 대기...`);
      await sleep(config.betweenPostsDelaySec * 1000);
    }
  }

  console.log(`\n${"=".repeat(50)}\n결과`);
  for (const r of results) console.log(`  ${r.ok ? "✅" : "❌"} ${r.name}${r.error ? " - " + r.error : ""}`);

  // 반드시 닫는다: 열어두면 네이버가 그 글을 '편집 중'으로 잠가서
  // 사장님이 임시저장 글을 못 연다.
  await browser.close().catch(() => {});
  if (results.some((result) => !result.ok)) process.exitCode = 1;
  console.log(`\n브라우저 종료. 네이버 블로그 > 글쓰기 > '저장 N' 에서 초안 확인하세요.\n`);
})();
