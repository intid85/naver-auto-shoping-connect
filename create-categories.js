// 블로그 카테고리를 한 번에 만든다: 상위(국내여행·맛집·아시아여행·유럽여행) + 하위 지역/나라.
// 이미 있는 상위 카테고리는 건너뛴다. 기존 카테고리는 건드리지 않고 맨 아래에 추가만 한 뒤 '확인'으로 저장한다.
// 사용: node create-categories.js            (실제 저장)
//       node create-categories.js --dry-run  (추가만 해 보고 저장하지 않음)
const { chromium } = require("playwright");
const path = require("path");
const config = require("./config.json");
const { STATE_FILE, LOG_DIR } = require("./lib/paths");
const { autoSaveSession } = require("./lib/session");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DRY = process.argv.includes("--dry-run");

const KOREA = ["서울", "부산", "인천", "대구", "대전", "광주전남", "울산", "세종", "경기", "강원", "충북", "충남", "전북", "경북", "경남", "제주"];
const PLAN = [
  { name: "국내여행", children: KOREA },
  { name: "맛집", children: KOREA },
  { name: "아시아여행", children: ["일본", "베트남", "태국", "필리핀", "대만", "중국", "홍콩", "싱가포르", "인도네시아(발리)", "말레이시아"] },
  { name: "유럽여행", children: ["프랑스", "이탈리아", "스페인", "영국", "스위스", "독일", "체코", "오스트리아", "포르투갈", "크로아티아", "그리스", "튀르키예"] },
];

const treeNames = (page) => page.evaluate(() => [...document.querySelectorAll("li[class*='tree-']")].filter((e) => e.offsetParent !== null)
  .map((e) => { let d = 0; let p = e.parentElement; while (p) { if (p.tagName === "LI") d++; p = p.parentElement; } return { depth: d, name: (e.querySelector("._categoryName input")?.value || e.querySelector("._categoryName")?.innerText || "").trim() }; }));

async function setName(page, name) {
  await page.locator("#category_name").click({ clickCount: 3 });
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(name, { delay: 40 });
  // 트리 이름은 keyup 때 반영돼서, 마지막 글자까지 들어가도록 키를 한 번 더 누른다
  await page.keyboard.press("End");
  await sleep(200);
  // 입력칸에서 포커스가 빠져야 트리 이름에 반영된다
  await page.locator("text=카테고리명").first().click();
  await sleep(400);
}

// 이름 입력이 트리에 반영된 노드를 고른다 (텍스트 일치)
async function selectNode(page, name) {
  const idx = await page.evaluate((n) => {
    const nodes = [...document.querySelectorAll("li[class*='tree-']")].filter((e) => e.offsetParent !== null);
    for (let i = nodes.length - 1; i >= 0; i--) {
      const t = (nodes[i].querySelector("._categoryName input")?.value || nodes[i].querySelector("._categoryName")?.innerText || "").trim();
      if (t === n) return i;
    }
    return -1;
  }, name);
  if (idx < 0) {
    const tail = (await treeNames(page)).slice(-4).map((x) => `${x.depth}:${x.name}`).join(" | ");
    const val = await page.locator("#category_name").inputValue().catch(() => "?");
    console.log("LAST NODES HTML:", await page.evaluate(() => [...document.querySelectorAll("li[class*='tree-']")].slice(-2).map((e) => e.outerHTML.slice(0, 600)).join("\n---\n")));
    throw new Error(`트리에서 "${name}"을 찾지 못했습니다 (트리 끝: ${tail} / 입력칸: ${val})`);
  }
  await page.locator("li[class*='tree-']").nth(idx).locator("._categoryName").first().click();
  await sleep(300);
}

(async () => {
  const browser = await chromium.launch({ headless: false, channel: "chrome", args: ["--disable-blink-features=AutomationControlled"] });
  try {
    const ctx = await browser.newContext({ storageState: STATE_FILE, viewport: { width: 1400, height: 1000 } });
    autoSaveSession(browser, ctx); // 닫을 때 갱신된 로그인 쿠키를 세션 파일에 저장
    // 카테고리 화면은 관리 화면(AdminMain) 안의 iframe이다. 저장은 바깥 화면의 확인 레이어를 거치므로 반드시 관리 화면 안에서 다룬다.
    const tab = await ctx.newPage();
    const dialogs = [];
    tab.on("dialog", (d) => { dialogs.push(d.message()); console.log("DIALOG:", d.type(), d.message()); d.accept().catch(() => {}); });
    const MAIN_URL = `https://admin.blog.naver.com/AdminMain.naver?blogId=${config.blogId}&Redirect=Categoryinfo`;
    let page;
    const openMain = async () => {
      await tab.goto(MAIN_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
      await sleep(3500);
      if (/nidlogin|nid\.naver\.com/.test(tab.url())) throw new Error("네이버 로그인이 만료되었습니다");
      const frame = tab.frames().find((f) => /AdminCategoryView/.test(f.url()));
      if (!frame) throw new Error("카테고리 화면을 찾지 못했습니다");
      page = { locator: (s) => frame.locator(s), evaluate: (...a) => frame.evaluate(...a), keyboard: tab.keyboard };
    };
    await openMain();
    const add = () => page.locator("img._addCategoryView").click();
    const BATCH = 10;

    // 저장된 트리에서 상위 → 하위 이름 목록
    const structure = async () => {
      const map = new Map();
      let cur = null;
      for (const n of await treeNames(page)) {
        if (n.depth === 0) { cur = n.name; if (!map.has(cur)) map.set(cur, []); } else if (cur) map.get(cur).push(n.name);
      }
      return map;
    };
    const reload = openMain;
    // 지금까지 추가한 것을 저장하고 다시 불러와 확인한다
    const save = async (label) => {
      if (DRY) { console.log(`DRY: ${label} 저장 생략`); return; }
      dialogs.length = 0;
      // 트리의 이름 편집 상태를 끝낸다 (편집 중이면 저장이 거부된다)
      await page.locator("text=카테고리 전체보기").first().click();
      await sleep(500);
      const respP = tab.waitForResponse((r) => /AdminCategoryUpdate/.test(r.url()), { timeout: 15000 }).catch(() => null);
      const struct = await page.evaluate(() => document.querySelector("[name=updatedCategoryListStruct]")?.value || "");
      await page.locator("#submit_button").click();
      await sleep(1500);
      // 바깥 화면에 뜨는 확인 레이어의 버튼을 누른다
      const layerBtns = await tab.evaluate(() => [...document.querySelectorAll("a, button, input[type=button], input[type=submit], img")].filter((e) => e.offsetParent !== null)
        .map((e, i) => ({ i, t: (e.innerText || e.value || e.alt || "").replace(/\s+/g, " ").trim(), cls: String(e.className).slice(0, 40) })).filter((x) => /확인|저장|적용/.test(x.t)));
      console.log("  확인 레이어 버튼:", JSON.stringify(layerBtns));
      const ok = tab.locator("a, button, input[type=button], input[type=submit], img").filter({ hasText: /^\s*확인\s*$/ });
      if (await ok.count()) await ok.first().click().catch(() => {});
      else { const alt = tab.locator("img[alt='확인'], input[value='확인']"); if (await alt.count()) await alt.first().click().catch(() => {}); }
      const resp = await respP;
      console.log(`  요청 ${resp ? `${resp.status()} ${(await resp.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200)}` : "없음"} · struct ${struct.length}자`);
      await sleep(3000);
      await reload();
      console.log(`저장: ${label}${dialogs.length ? ` (알림: ${dialogs.join(" / ") || "빈 알림"})` : ""}`);
    };

    for (const group of PLAN) {
      let tree = await structure();
      if (!tree.has(group.name)) {
        await page.locator("text=카테고리 전체보기").first().click(); await sleep(300);
        await add(); await sleep(600);
        await setName(page, group.name);
        await save(`상위 "${group.name}"`);
        tree = await structure();
        if (!DRY && !tree.has(group.name)) throw new Error(`"${group.name}" 저장 실패 — 블로그 카테고리 화면에서 직접 확인하세요`);
      }
      const missing = group.children.filter((c) => !(tree.get(group.name) || []).includes(c));
      for (let i = 0; i < missing.length; i += BATCH) {
        const chunk = missing.slice(i, i + BATCH);
        for (const child of chunk) {
          await selectNode(page, group.name);
          await add(); await sleep(500);
          await setName(page, child);
        }
        await save(`${group.name} › ${chunk.join(", ")}`);
        if (!DRY) {
          const got = (await structure()).get(group.name) || [];
          const lost = chunk.filter((c) => !got.includes(c));
          if (lost.length) throw new Error(`${group.name}: ${lost.join(", ")} 저장 실패 (다시 실행하면 빠진 것만 이어서 만듭니다)`);
        }
      }
      console.log(`완료: ${group.name}`);
    }

    const final = await structure();
    console.log([...final].map(([k, v]) => `${k}${v.length ? ` (${v.length}): ${v.join(", ")}` : ""}`).join("\n"));
    await tab.screenshot({ path: path.join(LOG_DIR, "categories-after-save.png"), fullPage: true });
  } finally {
    await browser.close().catch(() => {});
    console.log("BROWSER_CLOSED");
  }
})().catch((e) => { console.log("ERROR:", e.message); process.exit(1); });
