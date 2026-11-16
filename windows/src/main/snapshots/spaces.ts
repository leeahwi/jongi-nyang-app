import fs from "node:fs";
import path from "node:path";
import { BrowserWindow } from "electron";
import { dayKey, logicalDayStart } from "../../core/archive";
import { isoDate } from "../../core/notebook";
import { lang, t } from "../../i18n";
import { type LayoutCheckOptions } from "../layoutCheck";
import { emptyTrash, trashMemo } from "../../core/memoTrash";
import { inboxID } from "../../core/memoDrawer";
import { addSpace, findSpace, generalName, lensFor, lensNone, moveTodo, renameGeneral, renameSpace, spaceOf } from "../../core/todoSpaces";
import { deviceWords } from "../../core/spaceDevice";
import { searchGroupTitle } from "../../core/search";
import { archive, calendar, focusCommand, focusTimer, glance, moveToSpace, note, showPaperRowMenu, store } from "../main";
import { type Save, type Wait } from "./index";
import { pinSampleReminders } from "./design";
import { captureDesk, inPane, openDay, settledScript, showDeskPane } from "./desk";

/**
 * #408: 메모 서랍's sample and 할 일 스페이스's snapshots (`npm run snapshot -- spaces` · `spaces2b` · `spaces2c` ·
 * `device`), moved out of main.ts as they were. Test runs only (see snapshots/design.ts).
 */

// ─── 메모 서랍's snapshots ───────────────────────────────────────────────────

/**
 * Snapshots: the drawer's sample — folders 메모 · 회사 · 집 · 공부 (empty), five memos in 회사 (a long one, a
 * checklist half done, a command, a pinned one), a few in 메모 and 집. Times fixed relative to now.
 */
export function drawerSample(): { ids: Record<string, string> } {
  const now = new Date();
  const at = (days: number, hour: number, minute: number) => { const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, hour, minute); return isoDate(date > now ? new Date(now.getTime() - 60_000) : date); };
  const memo = (key: string, text: string, updatedAt: string) => ({ key, memo: { id: `DRAWER-${key.toUpperCase()}`, text, createdAt: updatedAt, updatedAt } });
  const entries = [
    memo("meeting", t("주간 회의\n시안 2개는 금요일까지. 디자인 리뷰는 목요일 3시, QA 일정은 다시 잡기로.\n발표 자료는 수요일 오전에 공유."), at(0, 10, 12)),
    memo("release", t("배포 체크리스트\n- [x] 버전 올리기\n- [x] 변경 기록 쓰기\n- [ ] 설치 파일 만들고 열어 보기\n- [ ] 릴리스 노트 붙이기"), at(1, 18, 40)),
    memo("video", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", at(1, 15, 11)),
    memo("command", t("자주 쓰는 명령\ngit log --oneline -5"), at(6, 9, 5)),
    memo("contact", t("꽃집 전화 010 1234 5678"), at(9, 14, 30)),
    memo("idea", t("다음 분기 아이디어\n작은 화면에서도 한눈에 보이게, 단축키 정리"), at(12, 11, 0)),
    memo("usage", t("여행 준비물\n여권, 충전기, 우산"), at(40, 16, 20)),
    memo("retro", t("작년 회고\n잘한 일 세 가지, 아쉬운 일 두 가지"), at(400, 20, 0)),
    memo("shopping", t("장보기\n우유, 달걀, 사과"), at(0, 8, 30)),
    memo("books", t("읽을 책\n- [ ] 작은 습관의 힘\n- [x] 데미안"), at(3, 21, 0)),
    memo("thought", t("떠오른 생각\n주말에 화분 분갈이"), at(2, 13, 0)),
    // The dense folder (#14: two lines at most on a card): a long entry and a checklist first.
    memo("log1", t("하루 기록 1\n이번 주에 한 일을 한곳에 모아 두었어요. 급한 것부터 위에 적고, 끝난 건 지워 가며 정리하기. 다음 주 월요일에 한 번 더 보기."), at(0, 21, 30)),
    memo("log2", t("하루 기록 2\n- [x] 자료 모으기\n- [ ] 표 정리하기\n- [ ] 메일 보내기"), at(2, 21, 30)),
    ...Array.from({ length: 22 }, (_, index) => memo(`log${index + 3}`, t("하루 기록 {n}\n오늘 한 일 짧게", { n: index + 3 }), at((index + 2) * 2, 21, 30))),
  ];
  const ids = Object.fromEntries(entries.map((entry) => [entry.key, entry.memo.id]));
  store.memos = [...entries.map((entry) => entry.memo), ...store.memos.filter((existing) => !existing.id.startsWith("DRAWER-"))].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  store.saveMemos();
  const stamp = isoDate(now);
  const work = ["meeting", "release", "video", "command", "contact", "idea", "usage", "retro"];
  store.changeFolders(() => ({
    v: 1,
    folders: [
      { id: inboxID, name: t("메모"), color: "lavender", order: 0, updatedAt: stamp },
      { id: "DRAWER-WORK", name: t("회사"), color: "pink", order: 1, updatedAt: stamp },
      { id: "DRAWER-HOME", name: t("집"), color: "mint", order: 2, updatedAt: stamp },
      { id: "DRAWER-STUDY", name: t("공부"), color: "sky", order: 3, updatedAt: stamp },
      { id: "DRAWER-LOG", name: t("일기"), color: "peach", order: 4, updatedAt: stamp },
    ],
    placement: Object.fromEntries([
      ...work.map((key) => [ids[key], { folder: "DRAWER-WORK", pinned: key === "meeting", at: stamp, ...(key === "idea" ? { paper: "night" } : {}) }]),
      [ids.shopping, { folder: "DRAWER-HOME", pinned: true, at: stamp }], [ids.books, { folder: "DRAWER-HOME", pinned: false, at: stamp }],
      ...Array.from({ length: 24 }, (_, index) => [ids[`log${index + 1}`], { folder: "DRAWER-LOG", pinned: false, at: stamp }]),
    ]),
    updatedAt: stamp,
  }));
  store.setPref("drawerRecentMoves", ["DRAWER-HOME"]);
  // #120: three deleted memos in 지운 메모 (2, 5 and 12 days ago).
  const ago = (days: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - days, 11, 0);
  const gone = (key: string, text: string) => ({ id: `DRAWER-GONE-${key}`, text, createdAt: at(30, 9, 0), updatedAt: at(20, 9, 0) });
  let trash = emptyTrash();
  trash = trashMemo(trash, gone("trip", t("지난 여행 짐 목록\n- [x] 여권\n- [x] 충전기")), { folder: "DRAWER-HOME", pinned: false }, ago(2));
  trash = trashMemo(trash, gone("meeting", t("옛 회의 시간\n화요일 3시로 옮김")), { folder: "DRAWER-WORK", pinned: false }, ago(5));
  trash = trashMemo(trash, gone("book", t("읽다 만 책에서 적어 둔 문장")), { folder: inboxID, pinned: false }, ago(12));
  store.changeTrash(() => trash);
  return { ids };
}

/** What the drawer's shots check: nothing cut or spilling, one-line labels whole, rows not running into each other. */
export const drawerLayoutChecks: LayoutCheckOptions = {
  // Bookmarks write a name sideways or one letter; swatch names may end in … (the swatch says it); a link's faint
  // address (#84) breaks where it must in a narrow drawer, as an address does.
  ignore: ".ears, .tape, .tp, .bk, .swrow button > span, .md-mark",
  inside: [".dr", ".hd", ".ttl", ".ic", ".qk", ".ft", ".ft > *", ".menu", ".big", ".acts", ".pill", ".toast", ".tabs", ".tip"],
  oneLine: [".sub", ".menu .mi > .t", ".menu .label", ".menu .btn", ".qk-hint span", ".where", ".m", ".grp .lbl", ".ft .key", ".tip", ".acts .when", ".chip"],
  rows: [".ttl", ".it .row", ".acts", ".ft", ".kind", ".row-btns", ".swatches", ".grp"],
};

/** A busy desktop behind the window (two app windows on a bright wallpaper), for the 바탕 shots. */
export const fakeDesktop = `(() => {
  let desk = document.getElementById("fake-desktop");
  if (!desk) {
    desk = document.createElement("div");
    desk.id = "fake-desktop";
    desk.style.cssText = "position:fixed;inset:0;z-index:-1;pointer-events:none;background:radial-gradient(circle at 20% 25%,#f3a96b 0,transparent 42%),radial-gradient(circle at 80% 70%,#5b8bd6 0,transparent 45%),radial-gradient(circle at 30% 85%,#7cc39a 0,transparent 40%),linear-gradient(135deg,#e9d7f5,#9fb8e8)";
    desk.innerHTML = '<div style="position:absolute;left:10px;top:70px;width:150px;height:300px;background:#fff;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.18);padding:22px 12px 0"><i style="display:block;height:8px;width:70%;border-radius:4px;background:#3b4452;margin-bottom:10px"></i><i style="display:block;height:8px;border-radius:4px;background:#c9ced8;margin-bottom:10px"></i><i style="display:block;height:8px;width:85%;border-radius:4px;background:#c9ced8;margin-bottom:10px"></i><i style="display:block;height:60px;border-radius:6px;background:#e94f4f;margin-bottom:10px"></i></div><div style="position:absolute;left:120px;top:460px;width:200px;height:220px;background:#1f2a35;border-radius:8px;box-shadow:0 6px 18px rgba(0,0,0,.25)"></div>';
    document.body.prepend(desk);
  }
})()`;

/**
 * `npm run snapshot -- drawer` (and the full run): 메모 서랍 (1.28, 1.29) — the handle; the list in date groups with
 * kinds (a link, a phone number, a checklist), the hover pill and the open memo's bar in each paper; the folder
 * list, a memo's menu (and 폴더로 옮기기 ▸), the ⚙ menu, the text menu, a bookmark's menu (and 정렬 ▸), 고정's menu
 * and a bookmark's label; the four 바탕 over a busy fake desktop (낮 · 밤); a night memo in a day drawer; a dense
 * folder; editing, 크게 보기, a new folder, writing, an empty folder, 고정, search, 260 and 480 wide, the left side, and
 * short and tall screens. Each shot is checked (layoutCheck plus the drawer's own: the cat whole, the title not
 * under the icons, every bookmark inside the window). Returns how many problems it found.
 */
/**
 * 할 일 스페이스 (1.30), day and night (spaces/, spaces/night/): 오늘 with no space (as 1.29 drew it), the mixed sheet with
 * its bands, 회사만 보는 중 (the line at the end of the list, #87; the header keeps its height) and 일반만, the line's ● 회사,
 * + 새 스페이스 and #일반 chips, 모든 스페이스 ▾, the row menu's 스페이스로 옮기기 ▸, the editor's 스페이스, and the desk's
 * 스페이스 pane with 일반's fixed row (and renamed, #89). Each one is checked for cut words and menus outside the note.
 */
export async function spacesShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
  let problems = 0;
  const run = (script: string) => note.webContents.executeJavaScript(script).catch((error: Error) => `script failed: ${error.message}`);
  const check = `(() => {
    const out = [];
    const r = (el) => el.getBoundingClientRect();
    const cut = (el) => el && getComputedStyle(el).display !== "none" && el.scrollWidth > el.clientWidth + 1;
    const pick = document.querySelector(".space-pick:not([hidden]) .space-pick-label");
    if (cut(pick)) out.push("space button cut: " + pick.textContent);
    const button = document.querySelector(".space-pick:not([hidden])"), title = document.querySelector(".title");
    if (button && title && r(button).left < r(title).right - 0.5 && Math.abs(r(button).top - r(title).top) < 20) out.push("space button over the title");
    // #151: no cat at the header's end any more; the button keeps the header's right margin.
    if (button && r(button).right > window.innerWidth - 14) out.push("space button past the header's margin");
    const more = document.querySelector(".lens-more");
    if (more && (more.scrollWidth > more.clientWidth + 1 || cut(more.querySelector(".lens-more-text")))) out.push("end line cut: " + more.textContent);
    const all = more?.querySelector(".lens-all");
    if (all && (r(all).right > window.innerWidth - 4 || all.scrollWidth > all.clientWidth + 1)) out.push("show-all cut");
    for (const chip of document.querySelectorAll(".inp .chip")) if (chip.scrollWidth > chip.clientWidth + 1) out.push("chip cut: " + chip.textContent);
    const chips = document.querySelector(".inp .reads");
    if (chips && chips.scrollWidth > chips.clientWidth + 1) out.push("chips overflow the line");
    for (const menu of document.querySelectorAll(".menu")) { const m = r(menu); if (m.right > window.innerWidth + 0.5 || m.bottom > window.innerHeight + 0.5 || m.left < -0.5 || m.top < -0.5) out.push("menu outside the note"); if (menu.scrollHeight > menu.clientHeight + 1) out.push("menu scrolls"); }
    for (const label of document.querySelectorAll(".menu .mi > .t")) if (label.scrollWidth > label.clientWidth + 1) out.push("menu row cut: " + label.textContent);
    for (const band of document.querySelectorAll(".row .sband:not([hidden])")) { const b = r(band); if (b.width < 11 || b.height < 10 || getComputedStyle(band).backgroundColor === "rgba(0, 0, 0, 0)") out.push("band not drawn"); }
    const field = document.querySelector(".editor .space-field");
    if (field && field.scrollWidth > field.clientWidth + 1) out.push("editor space field cut");
    return out;
  })()`;
  const shot = async (name: string, prefix: string) => {
    await wait(350);
    await settled(note);
    const found = await run(check) as string[] | string;
    const list = Array.isArray(found) ? found : [found];
    console.log(`spaces ${prefix}${name}: ${list.length ? list.join("; ") : "ok"}`);
    problems += list.length;
    await save(`spaces/${prefix}${name}`, note.webContents.capturePage());
  };
  const send = (command: string, id = "") => note.webContents.send("note:row-command", { id, command });
  const today = () => store.todayItems;
  fs.mkdirSync(path.join(directory, "spaces", "night"), { recursive: true });
  note.setSize(400, 640);
  store.setPref("spaceLens", null);
  send("page-today");
  // 0 spaces first: the sheet as 1.29 drew it (compared with a 1.29 build's).
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    await shot("today-none", paper === "night" ? "night/" : "");
  }
  // Three spaces (회사 · 집 · 공부) and to-dos in them, a few without.
  const ids = { work: "s-a1b2c3", home: "s-d4e5f6", study: "s-0a9b8c" };
  store.changeSpaces((data) => addSpace(addSpace(addSpace(data, t("회사"), ids.work, "pink"), t("집"), ids.home, "mint"), t("공부"), ids.study, "sky"));
  store.mutate((history) => { history.add(t("세탁기 돌리기")); history.add(t("주간 보고서 초안")); });
  const items = today();
  const place: [number, string][] = [[0, ids.work], [1, ids.work], [2, ids.study], [3, ids.home], [items.length - 1, ids.work], [items.length - 2, ids.home]];
  store.changeSpaces((data) => place.reduce((next, [index, space]) => (items[index] ? moveTodo(next, items[index].id, space) : next), data));
  const rowID = items[1].id;
  const workName = t("회사");
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "night/" : "";
    store.setPref("paper", paper);
    store.setPref("spaceLens", null);
    await shot("today-mixed", prefix);
    const bands = await run(`document.querySelectorAll(".row .sband:not([hidden])").length`);
    console.log(`spaces ${prefix}bands drawn: ${bands}`);
    if (!bands) problems += 1;
    // 회사만 ▾, and at the end of the list 다른 스페이스에 N개 더 · 모두 보기 (#87). The header keeps its height.
    const titleTop = `document.querySelector(".title")?.getBoundingClientRect().top`;
    const before = await run(titleTop);
    store.setPref("spaceLens", lensFor(ids.work));
    await shot("today-lens", prefix);
    const after = await run(titleTop);
    const line = await run(`document.querySelector(".lens-more")?.textContent ?? ""`);
    console.log(`spaces ${prefix}lens: title ${before} → ${after}, end line ‘${line}’`);
    if (before !== after) problems += 1;
    if (!line) problems += 1;
    // 일반만 ▾ (#89).
    store.setPref("spaceLens", lensFor(lensNone));
    await shot("today-lens-general", prefix);
    if (await run(titleTop) !== before) problems += 1;
    store.setPref("spaceLens", null);
    // The line: ● 회사, then + 새 스페이스 ‘세탁’.
    await run(`(() => { const field = document.querySelector(".inp .typed"); field.focus(); field.value = ${JSON.stringify(`${t("견적서 보내기 금요일까지")} #${[...workName].slice(0, Math.max(1, Math.floor([...workName].length / 2))).join("")}`)}; field.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await shot("line-chip", prefix);
    await run(`(() => { const field = document.querySelector(".inp .typed"); field.value = ${JSON.stringify(`${t("빨래")} #${t("세탁")}`)}; field.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await shot("line-new", prefix);
    // #일반: no space (S27).
    await run(`(() => { const field = document.querySelector(".inp .typed"); field.value = ${JSON.stringify(`${t("빨래")} #${generalName(store.todoSpaces, lang()).toLowerCase()}`)}; field.dispatchEvent(new Event("input", { bubbles: true })); })()`);
    await shot("line-general", prefix);
    await run(`(() => { const field = document.querySelector(".inp .typed"); field.value = ""; field.dispatchEvent(new Event("input", { bubbles: true })); field.blur(); })()`);
    // 모든 스페이스 ▾
    await run(`document.querySelector(".space-pick").click()`);
    await shot("picker", prefix);
    // #185: while it's open a plain 2 picks the second space and 0 모든 스페이스; a 2 in the input line is only typed.
    const press = (key: string, where: string) => run(`${where}?.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true, cancelable: true }))`);
    await press("2", `document.querySelector(".menu")`);
    await wait(250);
    const second = store.prefs.spaceLens?.spaceId === ids.home && !(await run(`Boolean(document.querySelector(".menu"))`));
    await run(`document.querySelector(".space-pick").click()`);
    await press("0", `document.querySelector(".menu")`);
    await wait(250);
    const all = !store.prefs.spaceLens;
    await press("2", `document.querySelector(".inp .typed")`);
    await wait(250);
    const typed = !store.prefs.spaceLens;
    console.log(`spaces ${prefix}picker digits: ${second ? "2 → the second space" : "2 DIDN'T PICK"}, ${all ? "0 → all" : "0 DIDN'T PICK ALL"}, ${typed ? "2 in the line left alone" : "2 IN THE LINE PICKED A SPACE"}`);
    if (!second || !all || !typed) problems += 1;
    await run(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
    // Right-click → 스페이스로 옮기기 ▸
    const point = await run(`(() => { const row = document.querySelector('.row[data-id=${JSON.stringify(rowID)}]'); const box = row.getBoundingClientRect(); return { x: Math.round(box.left + 90), y: Math.round(box.top + box.height / 2) }; })()`) as { x: number; y: number };
    showPaperRowMenu(rowID, point);
    await wait(250);
    await run(`(() => { const label = ${JSON.stringify(t("스페이스로 옮기기"))}; const button = [...document.querySelectorAll(".menu .mi")].find((entry) => entry.textContent.includes(label)); button?.click(); })()`);
    await shot("row-menu", prefix);
    // #49: no menu drawn over another one's words (a submenu with no room beside stands in the menu's place).
    const covered = await run(`(() => { const shown = [...document.querySelectorAll(".menu")].filter((menu) => getComputedStyle(menu).visibility !== "hidden").map((menu) => menu.getBoundingClientRect()); return shown.some((a, i) => shown.some((b, j) => j > i && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom)); })()`);
    // ← goes back to the menu.
    await run(`document.querySelector(".menu.submenu")?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }))`);
    const back = await run(`document.querySelectorAll(".menu").length === 1 && getComputedStyle(document.querySelector(".menu")).visibility !== "hidden"`);
    console.log(`spaces ${prefix}row-menu: ${covered ? "SUBMENU OVER THE MENU" : "ok"}, ← ${back ? "back to the menu" : "DIDN'T GO BACK"}`);
    if (covered || !back) problems += 1;
    await run(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
    // The editor's 스페이스.
    send("reminder", rowID);
    await wait(500);
    await shot("editor", prefix);
    send("close-editor");
    await wait(200);
  }
  // The desk's 스페이스 pane, day and night.
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    await showDeskPane("spaces", wait);
    const report = await inPane("settings", `(() => { const out = []; for (const el of document.querySelectorAll(".space-row .space-name, .space-count, .group .foot, .row .grow")) if (el.scrollWidth > el.clientWidth + 1) out.push("cut: " + (el.value ?? el.textContent)); return out.join("; "); })()`);
    console.log(`spaces desk ${paper}: ${report || "ok"}`);
    if (report) problems += 1;
    await save(`spaces/${paper === "night" ? "night/" : ""}desk`, captureDesk(wait));
  }
  // 일반 renamed (#89): the desk's first row and the popup.
  store.setPref("paper", "day");
  store.changeSpaces((data) => renameGeneral(data, { ko: "기타", en: "Other", nl: "Overig" }[lang()])); // i18n-ok: sample names per language
  await showDeskPane("spaces", wait);
  await save("spaces/desk-general-renamed", captureDesk(wait));
  await run(`document.querySelector(".space-pick").click()`);
  await shot("picker-general-renamed", "");
  await run(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
  store.changeSpaces((data) => renameGeneral(data, ""));
  return problems + await spaces2aShots(ids, save, wait, settled, run);
}

/**
 * 할 일 스페이스 2a (spaces-phase2.md A1–A12): the other screens under the lens — 앞으로 with its bands, the 하루 띠's
 * dots, the timetable's edges, the 오늘 창, the focus card's space, and a rule's space in desk → 반복. Day and night;
 * the title's place is compared with and without the lens (the header keeps its height).
 */
async function spaces2aShots(ids: { work: string; home: string; study: string }, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>,
  run: (script: string) => Promise<unknown>): Promise<number> {
  let problems = 0;
  const send = (command: string, id = "") => note.webContents.send("note:row-command", { id, command });
  const cut = `(() => { const out = []; const over = (el) => el && getComputedStyle(el).display !== "none" && el.scrollWidth > el.clientWidth + 1;
    for (const el of document.querySelectorAll(".lens-more-text, .lead-title, .sr-title, .fc-space span, .tab-label, .progress-text")) if (over(el) && !el.matches(".lead-title, .sr-title")) out.push("cut: " + el.textContent);
    for (const dot of document.querySelectorAll(".sp-dot, .fc-space-dot")) { if (!dot.offsetParent) continue; const b = dot.getBoundingClientRect(); if (b.width < 5 || getComputedStyle(dot).backgroundColor === "rgba(0, 0, 0, 0)") out.push("dot not drawn"); }
    return out; })()`;
  const shot = async (name: string, prefix: string) => {
    await wait(380);
    await settled(note);
    const found = await run(cut) as string[] | string;
    const list = Array.isArray(found) ? found : [found];
    console.log(`spaces ${prefix}${name}: ${list.length ? list.join("; ") : "ok"}`);
    problems += list.length;
    await save(`spaces/${prefix}${name}`, note.webContents.capturePage());
  };
  calendar.showSample();
  store.setPref("calendarStrip", true);
  openDay(false);
  // Today at 14:50 (as the timeblock shots): to-dos with hours in three spaces and 일반, and a few ahead.
  const dayStart = logicalDayStart(new Date());
  const ribbonNow = new Date(dayStart.getTime() + (14 - 4) * 3_600_000 + 50 * 60_000);
  const unpin = pinSampleReminders(dayStart);
  const dayAfter = (days: number) => dayKey(new Date(dayStart.getTime() + days * 86_400_000 + 12 * 3_600_000));
  const made: Record<string, string> = {};
  store.mutate((history) => {
    const add = (key: string, title: string, range?: { start: number; end?: number }, due?: string) => {
      const item = history.addTo(title, undefined, new Date(), due, undefined, range);
      if (item) made[key] = item.id;
    };
    add("report", t("보고서 쓰기"), { start: 840, end: 930 });
    add("mail", t("메일 답장"), { start: 900, end: 930 });
    add("call", t("엄마께 전화"), { start: 1020 });
    add("quote", t("견적서 보내기"), undefined, dayAfter(1));
    add("prep", t("기획 회의 준비"), undefined, dayAfter(1));
    add("wash", t("세탁기 돌리기"), undefined, dayAfter(2));
    add("retro", t("주간 회고 쓰기"), undefined, dayAfter(9));
  });
  const places: [string, string][] = [["report", ids.work], ["call", ids.home], ["quote", ids.work], ["prep", ids.work], ["wash", ids.home], ["retro", ids.study]];
  store.changeSpaces((data) => places.reduce((next, [key, space]) => (made[key] ? moveTodo(next, made[key], space) : next), data));
  // The first rule in 집 (desk → 반복's editor shows its space).
  if (store.series[0]) store.saveSeries({ seriesID: store.series[0].id, rule: store.series[0].rule, ...(store.series[0].remindAt ? { remindAt: store.series[0].remindAt } : {}), space: ids.home });
  const titleTop = `document.querySelector(".title")?.getBoundingClientRect().top`;
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "night/" : "";
    store.setPref("paper", paper);
    store.setPref("spaceLens", null);
    note.setSize(420, 640);
    // 앞으로: the bands, then 회사만 — its to-dos only, the counts after the lens, the end line.
    send("page-ahead");
    await run(`document.querySelector(".sheet").scrollTop = 0`);
    const before = await run(titleTop);
    await shot("ahead-bands", prefix);
    const bands = await run(`document.querySelectorAll(".ahead .row .sband:not([hidden])").length`);
    store.setPref("spaceLens", lensFor(ids.work));
    await run(`document.querySelector(".sheet").scrollTop = 0`);
    await shot("ahead-lens", prefix);
    const after = await run(titleTop);
    const end = await run(`document.querySelector(".ahead .lens-more")?.textContent ?? ""`);
    const summary = await run(`document.querySelector(".ahead-sum")?.textContent ?? ""`);
    console.log(`spaces ${prefix}ahead: ${bands} bands; lens: title ${before} → ${after}, ‘${summary}’, end line ‘${end}’`);
    await run(`document.querySelector(".sheet").scrollTop = 1e6`);
    await shot("ahead-lens-end", prefix);
    // A17: the end line's words start with the titles; a drag takes it away while the empty days show.
    const offset = Number(await run(`(() => { const text = document.querySelector(".ahead .lens-more-text"), title = document.querySelector(".ahead .row .text"); return text && title ? Math.round(text.getBoundingClientRect().left - title.getBoundingClientRect().left - parseFloat(getComputedStyle(title).paddingLeft)) : 99; })()`));
    await run(`window.dispatchEvent(new CustomEvent("snapshot-drag"))`);
    const duringDrag = await run(`document.querySelectorAll(".ahead .lens-more").length`);
    send("page-today");
    send("page-ahead");
    await wait(300);
    console.log(`spaces ${prefix}ahead end line: ${offset}px from the titles, ${duringDrag} while dragging`);
    if (Math.abs(offset) > 1 || duringDrag !== 0) problems += 1;
    await run(`document.querySelector(".sheet").scrollTop = 0`);
    if (!bands || before !== after || !end) problems += 1;
    // 하루 띠: the dots, then under 회사만 (the next is picked in the lens; events stay).
    send("page-today");
    store.setPref("spaceLens", null);
    await run(`window.ribbonNow = ${JSON.stringify(ribbonNow.toISOString())}; window.dispatchEvent(new Event("ribbon-now")); document.querySelector(".sheet").scrollTop = 0`);
    await shot("strip-dots", prefix);
    store.setPref("spaceLens", lensFor(ids.work));
    await run(`document.querySelector(".sheet").scrollTop = 0`);
    await shot("strip-lens", prefix);
    console.log(`spaces ${prefix}strip lens: ${await run(`document.querySelector(".strip")?.getAttribute("aria-label") ?? "NO STRIP"`)} · dots ${await run(`document.querySelectorAll(".strip .sp-dot").length`)}`);
    // 하루 일정표: the to-dos' edges (all), then under the lens.
    store.setPref("spaceLens", null);
    openDay(true);
    await wait(500);
    await shot("timetable-edges", prefix);
    const edges = await run(`document.querySelectorAll(".tt-block.task.spaced").length`);
    store.setPref("spaceLens", lensFor(ids.work));
    await wait(300);
    await shot("timetable-lens", prefix);
    const lensed = await run(`[...document.querySelectorAll(".tt-block.task")].map((block) => block.getAttribute("aria-label")).join(" | ")`);
    console.log(`spaces ${prefix}timetable: ${edges} edges; lens: ${lensed}`);
    if (!edges) problems += 1;
    openDay(false);
    // 오늘 창 under the note's lens: bands and ● 회사만 · 다른 스페이스에 N개 더 · 모두 보기.
    const glanceWindow = await glance.showForSnapshot();
    await wait(700);
    await settled(glanceWindow);
    // A16: never cut (two lines when one can't hold it); no cat words when the lens hides every open to-do.
    const glanceCheck = `(() => { const line = document.querySelector(".g-lens"); const over = (el) => el && el.scrollWidth > el.clientWidth + 1;
      return [document.querySelectorAll(".g-band").length + " bands", line ? line.textContent + (line.classList.contains("two") ? " [two lines]" : "") : "NO LENS LINE",
        document.querySelector(".g-empty") ? "cat words" : "no cat words", [line, ...document.querySelectorAll(".g-lens-more, .g-lens-name")].some(over) ? "CUT" : "ok"].join(" · "); })()`;
    const glanceReport = await glanceWindow.webContents.executeJavaScript(glanceCheck).catch(() => "NO GLANCE");
    console.log(`spaces ${prefix}glance: ${glanceReport}`);
    if (String(glanceReport).includes("NO ") || String(glanceReport).includes("CUT")) problems += 1;
    await save(`spaces/${prefix}glance-lens`, glanceWindow.webContents.capturePage());
    // A space with no to-do on today's sheet: the lens hides every open one.
    if (!findSpace(store.todoSpaces, "s-e1f2a3")) store.changeSpaces((data) => addSpace(data, t("세탁"), "s-e1f2a3", "peach"));
    store.setPref("spaceLens", lensFor("s-e1f2a3"));
    await wait(300);
    await settled(glanceWindow);
    const emptyReport = await glanceWindow.webContents.executeJavaScript(glanceCheck).catch(() => "NO GLANCE");
    console.log(`spaces ${prefix}glance all hidden: ${emptyReport}`);
    if (String(emptyReport).includes("NO ") || String(emptyReport).includes("CUT") || String(emptyReport).includes("· cat words")) problems += 1;
    await save(`spaces/${prefix}glance-lens-empty`, glanceWindow.webContents.capturePage());
    // A long name: the line goes to two (the name, then the rest under it), nothing cut.
    store.changeSpaces((data) => renameSpace(data, "s-e1f2a3", t("주간 보고서 초안")));
    await wait(300);
    await settled(glanceWindow);
    const longReport = await glanceWindow.webContents.executeJavaScript(glanceCheck).catch(() => "NO GLANCE");
    console.log(`spaces ${prefix}glance long name: ${longReport}`);
    if (String(longReport).includes("NO ") || String(longReport).includes("CUT")) problems += 1;
    await save(`spaces/${prefix}glance-lens-long`, glanceWindow.webContents.capturePage());
    store.changeSpaces((data) => renameSpace(data, "s-e1f2a3", t("세탁")));
    store.setPref("spaceLens", null);
    await wait(300);
    await settled(glanceWindow);
    await save(`spaces/${prefix}glance-bands`, glanceWindow.webContents.capturePage());
    glance.hide();
    // The focus card: ● 회사 over the title.
    focusCommand({ kind: "start", taskId: made.report, minutes: 25 });
    focusTimer.elapseForSnapshot(12.5);
    await shot("focus-space", prefix);
    console.log(`spaces ${prefix}focus: ${await run(`document.querySelector(".fc-space:not([hidden])")?.textContent ?? "NO SPACE LINE"`)}`);
    focusTimer.focus({ kind: "later" });
    await wait(300);
    // desk → 반복: the rule's editor with its 스페이스 field.
    await showDeskPane("repeat", wait);
    await inPane("settings", `document.querySelector(".series-form") || document.querySelector(".row.series .quiet")?.click()`);
    await wait(400);
    const field = await inPane("settings", `(() => { const field = document.querySelector(".series-form .space-field"); return field ? field.textContent + (field.scrollWidth > field.clientWidth + 1 ? " CUT" : "") : "NO FIELD"; })()`);
    console.log(`spaces ${prefix}rule editor: ${field}`);
    if (String(field).includes("NO FIELD") || String(field).includes("CUT")) problems += 1;
    await save(`spaces/${prefix}rule-editor`, captureDesk(wait));
  }
  store.setPref("spaceLens", null);
  store.setPref("paper", "day");
  await run(`window.ribbonNow = undefined; window.dispatchEvent(new Event("ribbon-now"))`);
  unpin();
  return problems;
}

/**
 * 2b 스페이스별로 묶기 (spaces-phase2.md): F 메모지 and E 책갈피 on a mixed sheet of made-up to-dos, a finished row open,
 * folded groups, the shortcut chips, a drag over another group, the wide note's columns, the header's menu and the
 * settings' switch. Day and night, at 12:40; nothing cut, nothing past the note's edge.
 */
/**
 * Spaces 2c's shots (spaces-phase2.md C1–C5 · H1–H5), day and night (night/): the search slip with `#회사 보고서` and
 * the empty slip's second hint, and 완료 기록 filtered by 회사 and by 일반. Sample data only: three spaces, the sample
 * record's lines and focus placed by their titles.
 */
export async function spaces2cShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
  let problems = 0;
  const run = (script: string) => note.webContents.executeJavaScript(script).catch((error: Error) => `script failed: ${error.message}`);
  fs.mkdirSync(path.join(directory, "spaces2c", "night"), { recursive: true });
  const ids = { work: "s-a1b2c3", home: "s-d4e5f6", study: "s-0a9b8c" };
  store.changeSpaces((data) => addSpace(addSpace(addSpace(data, t("회사"), ids.work, "pink"), t("집"), ids.home, "mint"), t("공부"), ids.study, "sky"));
  store.mutate((history) => { history.add(t("주간 보고서 초안")); history.add(t("장보기")); });
  const byTitle: [string, string][] = [
    [t("보고서 초안"), ids.work], [t("회의 준비"), ids.work], [t("메일 정리"), ids.work], [t("주간 보고서 초안"), ids.work], [t("보고서 마무리"), ids.work], [t("발표 자료 만들기"), ids.work],
    [t("장보기"), ids.home], [t("빨래"), ids.home], [t("책 10쪽 읽기"), ids.study],
  ];
  const spaceFor = (title: string) => byTitle.find(([name]) => name === title)?.[1];
  const focusTasks: [string, string][] = [["F-1", t("보고서 마무리")], ["F-2", t("책 10쪽 읽기")], ["F-3", t("발표 자료 만들기")], ["F-4", t("메일 정리")]];
  store.changeSpaces((data) => [...store.items.map((item) => [item.id, item.title] as const), ...archive.all().map((entry) => [entry.id, entry.title] as const), ...focusTasks]
    .reduce((next, [id, title]) => { const space = spaceFor(title); return space ? moveTodo(next, id, space) : next; }, data));
  const word = t("보고서 초안").split(" ")[0];
  const query = `#${t("회사")} ${word}`;
  note.setSize(400, 640);
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "night/" : "";
    store.setPref("paper", paper);
    // The slip: #회사 보고서, then empty with the hint about #.
    for (const [name, text] of [["search-space", query], ["search-empty", ""]] as const) {
      await run(`window.showSearch(); document.querySelector(".search-slip") && window.showSearch().set(${JSON.stringify(text)})`);
      await wait(350);
      await settled(note);
      const report = await run(`(() => {
        const card = document.querySelector(".search-slip");
        if (!card) return "NO SLIP";
        const r = card.getBoundingClientRect(), out = [];
        if (r.top < 0 || r.bottom > innerHeight + 0.5 || r.left < 0 || r.right > innerWidth + 0.5) out.push("slip off the note");
        for (const row of card.querySelectorAll(".search-row")) { const text = row.querySelector(".search-text").getBoundingClientRect(), meta = row.querySelector(".search-meta")?.getBoundingClientRect(); if (meta && text.right > meta.left + 0.5) out.push("text under the date"); }
        const hint = card.querySelector(".search-hint");
        if (hint && hint.scrollWidth > hint.clientWidth + 1) out.push("hint cut");
        const heads = [...card.querySelectorAll(".search-head")].map((head) => head.textContent).join(" / ");
        return (out.join("; ") || "ok") + " · " + heads + (hint ? " · " + hint.textContent : "");
      })()`) as string;
      console.log(`spaces2c ${prefix}${name}: ${report}`);
      if (!report.startsWith("ok")) problems += 1;
      // C3: with a space, no memos and no events.
      const heads = report.split(" · ")[1] ?? "";
      if (name === "search-space" && [searchGroupTitle("memos", lang()), searchGroupTitle("events", lang())].some((title) => heads.includes(title))) problems += 1;
      if (name === "search-empty" && !report.includes("#")) problems += 1;
      await save(`spaces2c/${prefix}${name}`, note.webContents.capturePage());
      await run(`document.querySelector(".search-field")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    }
    // 완료 기록 by 회사, then by 일반: the menu, then the pane with the filter on.
    await showDeskPane("history", wait);
    for (const [name, label] of [["history-work", t("회사")], ["history-general", generalName(store.todoSpaces, lang())]] as const) {
      await inPane("history", `document.querySelector(".space-pick")?.click()`);
      await wait(250);
      if (name === "history-work") await save(`spaces2c/${prefix}history-menu`, captureDesk(wait));
      await inPane("history", `[...document.querySelectorAll(".menu .mi")].find((row) => row.textContent.includes(${JSON.stringify(label)}))?.click()`);
      await wait(400);
      await inPane("history", settledScript);
      const report = await inPane("history", `(() => {
        const out = [], pick = document.querySelector(".space-pick"), label = pick?.querySelector(".space-pick-label");
        if (!pick) return "NO PICK";
        if (label.scrollWidth > label.clientWidth + 1) out.push("pick cut");
        const head = document.querySelector(".pane-head"), ranges = document.querySelector(".ranges");
        if (ranges && ranges.getBoundingClientRect().right > head.getBoundingClientRect().right + 0.5) out.push("ranges past the header");
        if (pick.getBoundingClientRect().right > ranges.getBoundingClientRect().left + 0.5) out.push("pick over the ranges");
        for (const tile of document.querySelectorAll(".tile .kt, .tile .d")) if (tile.scrollWidth > tile.clientWidth + 1 && getComputedStyle(tile).textOverflow !== "ellipsis") out.push("tile cut");
        return (out.join("; ") || "ok") + " · " + label.textContent + " · " + [...document.querySelectorAll(".tile .v")].map((value) => value.textContent).join(" | ");
      })()`) as string;
      console.log(`spaces2c ${prefix}${name}: ${report}`);
      if (!String(report).startsWith("ok")) problems += 1;
      await save(`spaces2c/${prefix}${name}`, captureDesk(wait));
    }
    // Back to 모든 스페이스 for the next paper.
    await inPane("history", `document.querySelector(".space-pick")?.click()`);
    await wait(200);
    await inPane("history", `document.querySelector(".menu .mi")?.click()`);
  }
  store.setPref("paper", "day");
  console.log(problems ? `SPACES2C PROBLEMS: ${problems}` : "SPACES2C OK");
  return problems;
}

export async function spaces2bShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
  let problems = 0;
  const run = (script: string) => note.webContents.executeJavaScript(script).catch((error: Error) => `script failed: ${error.message}`);
  const check = `(() => {
    const out = [];
    const cut = (el) => el && getComputedStyle(el).display !== "none" && el.scrollWidth > el.clientWidth + 1;
    for (const el of document.querySelectorAll(".sgroup-name, .sgroup-left, .sgroup-next, .sgroup-count, .sgroup-done, .sgroup-drop, .schip, .scol-add")) if (cut(el)) out.push("cut: " + el.textContent);
    for (const el of document.querySelectorAll(".sgroup, .schips")) { const r = el.getBoundingClientRect(); if (r.width && r.right > window.innerWidth + 0.5 && !el.closest(".board")) out.push("past the note: " + el.className); }
    const board = document.querySelector(".lines.board");
    if (board && board.getBoundingClientRect().right > window.innerWidth + 0.5) out.push("board past the note");
    for (const menu of document.querySelectorAll(".menu .mi > .t")) if (cut(menu)) out.push("menu row cut: " + menu.textContent);
    return out;
  })()`;
  const shot = async (name: string, prefix: string) => {
    await wait(380);
    await settled(note);
    const found = await run(check) as string[] | string;
    const list = Array.isArray(found) ? found : [found];
    console.log(`spaces2b ${prefix}${name}: ${list.length ? list.join("; ") : "ok"}`);
    problems += list.length;
    await save(`spaces2b/${prefix}${name}`, note.webContents.capturePage());
  };
  const send = (command: string, id = "") => note.webContents.send("note:row-command", { id, command });
  fs.mkdirSync(path.join(directory, "spaces2b", "night"), { recursive: true });
  // Only these to-dos on today's sheet (the run's samples go).
  const old = store.items.map((item) => item.id);
  store.mutate((history) => { for (const id of old) history.delete(id); });
  const ids = { work: "s-b1a2c3", home: "s-b4d5e6", study: "s-b7f8a9" };
  store.changeSpaces((data) => addSpace(addSpace(addSpace(data, t("회사"), ids.work, "pink"), t("집"), ids.home, "mint"), t("공부"), ids.study, "sky"));
  const dayStart = logicalDayStart(new Date());
  const ribbonNow = new Date(dayStart.getTime() + (12 - 4) * 3_600_000 + 40 * 60_000);
  const made: Record<string, string> = {};
  store.mutate((history) => {
    // The hours as the app sets them, against the scene's 12:40 (#191): a start still ahead brings its reminder, so
    // 13:40's to-do has the bell in 다음 as on the Mac, whenever this is drawn.
    const add = (key: string, title: string, range?: { start: number; end?: number }) => {
      const item = history.addTo(title, undefined, new Date());
      if (!item) return;
      made[key] = item.id;
      if (range) history.setRange(item.id, range, ribbonNow);
    };
    add("coffee", t("창문 열고, 커피 한 잔"));
    add("plan", t("오늘 꼭 해야 할 일 정리하기"), { start: 13 * 60 + 40, end: 14 * 60 + 10 });
    add("report", t("주간 보고서 초안"));
    add("minutes", t("회의록 올리기"));
    add("laundry", t("세탁기 돌리기"), { start: 19 * 60, end: 19 * 60 + 30 });
    add("air", t("잠깐, 바깥 공기 쐬기"));
    add("book", t("미뤄 둔 책 10쪽 읽기"));
    add("memo", t("내일의 나에게 메모 남기기"));
    for (const key of ["coffee", "minutes"]) if (made[key]) history.toggle(made[key]);
  });
  const places: [string, string][] = [["plan", ids.work], ["report", ids.work], ["minutes", ids.work], ["laundry", ids.home], ["air", ids.home], ["book", ids.study]];
  store.changeSpaces((data) => places.reduce((next, [key, space]) => (made[key] ? moveTodo(next, made[key], space) : next), data));
  store.setPref("calendarStrip", true);
  store.setPref("spaceLens", null);
  store.setPref("spaceGroups", true);
  send("page-today");
  await run(`window.ribbonNow = ${JSON.stringify(ribbonNow.toISOString())}; window.dispatchEvent(new Event("ribbon-now"))`);
  // `npm run snapshot -- spacepapers` (#332): the ruled papers by space — 메모지, 책갈피 and 칸 보기 (one row picked in it),
  // with 낮 종이 and 밤 종이 beside them, into spaces2b/papers/.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "spacepapers") {
    fs.mkdirSync(path.join(directory, "spaces2b", "papers"), { recursive: true });
    const top = `document.querySelector(".sheet").scrollTop = 0`;
    store.setPref("spaceGroupsDoneOpen", []);
    store.setPref("spaceGroupsFolded", []);
    for (const theme of ["grid", "manuscript", "lined", "day", "night"] as const) {
      store.setPref("paper", theme === "night" ? "night" : "day");
      store.setPref("paperTheme", theme === "night" ? "day" : theme);
      await wait(450);
      for (const style of ["card", "bookmark"] as const) {
        store.setPref("spaceGroupStyle", style);
        note.setSize(420, 720);
        await run(top);
        await shot(`${theme}-${style}`, "papers/");
      }
      store.setPref("spaceGroupStyle", "card");
      note.setSize(1200, 640);
      await shot(`${theme}-board`, "papers/");
      await run(`document.querySelector('.lines.board .row[data-id="${made.report}"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
      await shot(`${theme}-board-picked`, "papers/");
      await run(`document.querySelector('.lines.board .row[data-id="${made.report}"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }))`);
    }
    store.setPref("paper", "day");
    store.setPref("paperTheme", "day");
    note.setSize(420, 720);
    return problems;
  }
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "night/" : "";
    store.setPref("paper", paper);
    const top = `document.querySelector(".sheet").scrollTop = 0`;
    // F 메모지 (the default), 일반's finished row open, then E 책갈피.
    store.setPref("spaceGroupStyle", "card");
    store.setPref("spaceGroupsDoneOpen", []);
    store.setPref("spaceGroupsFolded", []);
    note.setSize(420, 720);
    await run(top);
    await shot("card", prefix);
    note.setSize(350, 560);
    await run(top);
    await shot("card-narrow", prefix);
    note.setSize(420, 720);
    store.setPref("spaceGroupsDoneOpen", ["none"]);
    await run(top);
    await shot("card-done-open", prefix);
    store.setPref("spaceGroupsDoneOpen", []);
    store.setPref("spaceGroupStyle", "bookmark");
    await run(top);
    await shot("bookmark", prefix);
    note.setSize(350, 560);
    await run(top);
    await shot("bookmark-narrow", prefix);
    note.setSize(420, 720);
    store.setPref("spaceGroupStyle", "card");
    // Folded: 집 and 공부 only their heads.
    store.setPref("spaceGroupsFolded", [ids.home, ids.study]);
    await run(top);
    await shot("card-folded", prefix);
    store.setPref("spaceGroupStyle", "bookmark");
    await run(top);
    await shot("bookmark-folded", prefix);
    store.setPref("spaceGroupStyle", "card");
    store.setPref("spaceGroupsFolded", []);
    // A drag of 공부's book over 집: the group lights up in its colour and says where it goes.
    const dragOver = (on: boolean) => run(`window.dispatchEvent(new CustomEvent("snapshot-group-drag", { detail: ${on ? JSON.stringify({ id: made.book, group: ids.home }) : "{}"} }))`);
    await run(top);
    await wait(300);
    await dragOver(true);
    await shot("drag", prefix);
    await dragOver(false);
    store.setPref("spaceGroupStyle", "bookmark");
    await wait(300);
    await dragOver(true);
    await shot("bookmark-drag", prefix);
    await dragOver(false);
    store.setPref("spaceGroupStyle", "card");
    // Only 회사: its group alone.
    store.setPref("spaceLens", lensFor(ids.work));
    await run(top);
    await shot("lens", prefix);
    store.setPref("spaceLens", null);
    // I (S45): the note at 1,200 (its widest while grouped) — four columns; a drag over 집; 집's `+ 집에 넣기`, the line
    // writing into 집. At 720 four columns don't get 220 each: 메모지 as usual. Then three columns at 1,200 (only 회사 ·
    // 집 · 공부 with to-dos).
    note.setSize(1200, 640);
    await wait(300);
    const columns = async () => Number(await run(`document.querySelectorAll(".lines.board > .sgroup").length`));
    await shot("board", prefix);
    const four = await columns();
    note.setSize(720, 640);
    await wait(300);
    await shot("board-720-cards", prefix);
    const atNarrow = await columns();
    store.setPref("hideCompleted", true);
    store.changeSpaces((data) => moveTodo(data, made.memo, ids.study));
    note.setSize(1200, 640);
    await wait(300);
    await shot("board-three", prefix);
    const three = await columns();
    store.changeSpaces((data) => moveTodo(data, made.memo, null));
    store.setPref("hideCompleted", false);
    await wait(300);
    console.log(`spaces2b ${prefix}board columns: ${four} at 1,200, ${atNarrow} at 720, ${three} with three spaces`);
    if (four !== 4 || atNarrow !== 0 || three !== 3) problems += 1;
    await dragOver(true);
    await shot("board-drag", prefix);
    await dragOver(false);
    await run(`document.querySelector('.sgroup[data-group="${ids.home}"] .sgroup-add')?.click()`);
    await run(`(() => { const field = document.querySelector(".dock textarea, .dock input"); if (field) { field.value = ${JSON.stringify(t("빨래 개기"))}; field.dispatchEvent(new Event("input", { bubbles: true })); } })()`);
    await shot("board-add", prefix);
    await run(`(() => { const field = document.querySelector(".dock textarea, .dock input"); if (field) { field.value = ""; field.dispatchEvent(new Event("input", { bubbles: true })); field.blur(); field.dispatchEvent(new Event("blur")); } })()`);
    // #168: three picked (a click, then Ctrl-clicks) in 메모지, 책갈피 and the plain list; one dragged over 집 with the
    // ‘3개’ badge; the toast after they're moved (then put back).
    note.setSize(420, 720);
    await wait(300);
    const picks = [made.report, made.book, made.air];
    await run(`(() => { ${JSON.stringify(picks)}.forEach((id, index) => document.querySelector('.lines .row[data-id="' + id + '"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: index > 0 }))); return true; })()`);
    const pickedCount = Number(await run(`document.querySelectorAll(".lines .row.selected").length`));
    console.log(`spaces2b ${prefix}multi: ${pickedCount} rows picked`);
    if (pickedCount !== 3) problems += 1;
    await run(top);
    await shot("multi-pick", prefix);
    store.setPref("spaceGroupStyle", "bookmark");
    await wait(300);
    await shot("multi-pick-bookmark", prefix);
    store.setPref("spaceGroupStyle", "card");
    store.setPref("spaceGroups", false);
    await wait(300);
    await shot("multi-pick-plain", prefix);
    store.setPref("spaceGroups", true);
    await wait(300);
    await run(top);
    await run(`window.dispatchEvent(new CustomEvent("snapshot-group-drag", { detail: ${JSON.stringify({ id: made.report, group: ids.home, lift: 150 })} }))`);
    await shot("multi-drag", prefix);
    await dragOver(false);
    const before = picks.map((id) => [id, spaceOf(store.todoSpaces, id) ?? null] as const);
    moveToSpace(picks, ids.home);
    await wait(300);
    await shot("multi-toast", prefix);
    store.changeSpaces((data) => before.reduce((next, [id, space]) => moveTodo(next, id, space), data));
    await run(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    // The header's menu with 스페이스별로 묶기 ✓.
    note.setSize(420, 640);
    await run(`document.querySelector(".space-pick").click()`);
    await shot("menu", prefix);
    await run(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
    // 설정 → 스페이스: the switch and the look.
    await showDeskPane("spaces", wait);
    const report = await inPane("settings", `(() => { const out = []; for (const el of document.querySelectorAll(".row .grow, .segmented button, .group .foot")) if (el.scrollWidth > el.clientWidth + 1) out.push("cut: " + el.textContent); return out.join("; "); })()`);
    console.log(`spaces2b ${prefix}desk: ${report || "ok"}`);
    if (report) problems += 1;
    await save(`spaces2b/${prefix}desk`, captureDesk(wait));
  }
  store.setPref("paper", "day");
  store.setPref("spaceGroups", false);
  await run(`window.ribbonNow = undefined; window.dispatchEvent(new Event("ribbon-now"))`);
  return problems;
}

/**
 * 기기마다 보일 스페이스 (#196, spaces-device.md §4): the desk's rows with their 이 기기에서 lines and marks, its popup open,
 * the 시간 정하기 slip (several ranges; 주말 picked with a row added), the header's menu with 이 기기에서 숨김 and
 * 이 기기에서 숨기기 ▸ open, and the note with 회사 hidden (mixed, 메모지, peeked at, narrow) and the toast after `#회사`.
 * 공부's line says what its times mean at the moment the run draws it. Made-up to-dos only.
 */
export async function deviceShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
  let problems = 0;
  const run = (script: string) => note.webContents.executeJavaScript(script).catch((error: Error) => `script failed: ${error.message}`);
  const cutScript = `(() => {
    const out = [];
    const cut = (el) => el && getComputedStyle(el).display !== "none" && el.scrollWidth > el.clientWidth + 1;
    for (const el of document.querySelectorAll(".lens-more-text, .device-status, .menu .mi > .t, .device-summary b, .device-summary span, .device-lead, .search-text")) if (cut(el)) out.push("cut: " + el.textContent);
    for (const el of document.querySelectorAll(".lens-more, .device-slip, .menu")) { const r = el.getBoundingClientRect(); if (r.width && (r.right > window.innerWidth + 0.5 || r.left < -0.5)) out.push("past the window: " + el.className); }
    return out;
  })()`;
  const report = (name: string, found: unknown) => {
    const list = Array.isArray(found) ? found as string[] : found ? [String(found)] : [];
    console.log(`device ${name}: ${list.length ? list.join("; ") : "ok"}`);
    problems += list.length;
  };
  const shot = async (name: string) => {
    await wait(380);
    await settled(note);
    report(name, await run(cutScript));
    await save(`device/${name}`, note.webContents.capturePage());
  };
  const send = (command: string, id = "") => note.webContents.send("note:row-command", { id, command });
  fs.mkdirSync(path.join(directory, "device", "night"), { recursive: true });
  const old = store.items.map((item) => item.id);
  store.mutate((history) => { for (const id of old) history.delete(id); });
  const ids = { work: "s-d1a2b3", home: "s-d4c5d6", study: "s-d7e8f9" };
  store.changeSpaces((data) => addSpace(addSpace(addSpace(data, t("회사"), ids.work, "pink"), t("집"), ids.home, "mint"), t("공부"), ids.study, "sky"));
  const made: Record<string, string> = {};
  store.mutate((history) => {
    const add = (key: string, title: string, range?: { start: number; end?: number }) => {
      const item = history.addTo(title, undefined, new Date(), undefined, undefined, range);
      if (item) made[key] = item.id;
    };
    add("shopping", t("세탁기 돌리기"), { start: 20 * 60 + 30, end: 21 * 60 });
    add("laundry", t("빨래 개기"));
    add("report", t("주간 보고서 초안"));
    add("meeting", t("회의록 올리기"));
    add("book", t("미뤄 둔 책 10쪽 읽기"));
    add("plants", t("잠깐, 바깥 공기 쐬기"));
    if (made.laundry) history.toggle(made.laundry);
  });
  const places: [string, string][] = [["shopping", ids.home], ["laundry", ids.home], ["report", ids.work], ["meeting", ids.work], ["book", ids.study]];
  store.changeSpaces((data) => places.reduce((next, [key, space]) => (made[key] ? moveTodo(next, made[key], space) : next), data));
  store.setPref("spaceLens", null);
  store.setPref("spaceGroups", false);
  store.setDevicePeek([]);
  store.setDeviceRules({
    [ids.work]: { show: "hide" },
    [ids.study]: { show: "time", times: [{ days: [1, 2, 3, 4, 5], from: "07:00", to: "08:30" }, { days: [1, 2, 3, 4, 5], from: "19:00", to: "23:00" }] },
  });
  send("page-today");
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "night/" : "";
    store.setPref("paper", paper);
    store.setPref("spaceGroups", false);
    store.setDevicePeek([]);
    note.setSize(420, 640);
    await run(`document.querySelector(".sheet").scrollTop = 0`);
    await shot(`${prefix}note`);
    note.setSize(350, 520);
    await shot(`${prefix}note-narrow`);
    note.setSize(420, 720);
    store.setPref("spaceGroups", true);
    store.setPref("spaceGroupStyle", "card");
    await shot(`${prefix}note-cards`);
    note.setSize(1200, 640);
    await shot(`${prefix}note-board`);
    store.setPref("spaceGroups", false);
    note.setSize(420, 640);
    await run(`document.querySelector(".device-more .lens-all")?.click()`);
    await shot(`${prefix}note-peek`);
    store.setDevicePeek([]);
    // The toast after `보고서 쓰기 #회사` on this PC (회사 hidden): 되돌리기 takes it back.
    if (made.report) note.webContents.send("note:toast", { made: { kind: "todo", id: made.report }, candidates: [{ kind: "todo", title: t("주간 보고서 초안") }], index: 0, text: `${t("주간 보고서 초안")} #${t("회사")}`, hiddenIn: t("회사") });
    await shot(`${prefix}toast`);
    note.setSize(350, 520);
    await shot(`${prefix}toast-narrow`);
    await run(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    // The header's menu: 회사 under 이 기기에서 숨김 (보이기), 공부's hint, and 이 기기에서 숨기기 ▸ open.
    note.setSize(560, 640);
    await run(`document.querySelector(".space-pick").click()`);
    await wait(200);
    await run(`(() => { const row = [...document.querySelectorAll(".menu .mi")].find((el) => el.textContent.includes(${JSON.stringify(deviceWords.hideHere[lang()])})); row?.click(); })()`);
    await shot(`${prefix}menu`);
    await run(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
    await run(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    note.setSize(420, 640);
    // 설정 → 스페이스: the rows, the popup open on 공부, the slip.
    await showDeskPane("spaces", wait);
    const deskCut = `(() => { const out = []; for (const el of document.querySelectorAll(".row .grow, .device-status, .space-name, .group .foot, .menu .mi > .t, .device-summary b, .device-summary span, .device-lead")) if (getComputedStyle(el).display !== "none" && el.scrollWidth > el.clientWidth + 1) out.push("cut: " + (el.textContent || el.value)); for (const el of document.querySelectorAll(".device-slip, .menu")) { const r = el.getBoundingClientRect(); if (r.width && (r.right > window.innerWidth + 0.5 || r.bottom > window.innerHeight + 0.5 || r.top < -0.5)) out.push("past the pane: " + el.className); } return out.join("; "); })()`;
    report(`${prefix}desk`, await inPane("settings", deskCut));
    await save(`device/${prefix}desk`, captureDesk(wait));
    await inPane("settings", `document.querySelector('.space-row[data-id="${ids.study}"] .space-device').click()`);
    await wait(250);
    report(`${prefix}desk-popup`, await inPane("settings", deskCut));
    await save(`device/${prefix}desk-popup`, captureDesk(wait));
    await inPane("settings", `(() => { const rows = [...document.querySelectorAll(".menu .mi")]; rows[rows.length - 1]?.click(); })()`);
    await wait(350);
    report(`${prefix}times`, await inPane("settings", deskCut));
    await save(`device/${prefix}times`, captureDesk(wait));
    await inPane("settings", `(() => { const chips = document.querySelectorAll(".device-presets .chip"); chips[2]?.click(); document.querySelector(".device-add")?.click(); })()`);
    await wait(250);
    report(`${prefix}times-preset`, await inPane("settings", deskCut));
    await save(`device/${prefix}times-preset`, captureDesk(wait));
    await inPane("settings", `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await wait(150);
  }
  store.setPref("paper", "day");
  store.setDeviceRules({});
  store.setDevicePeek([]);
  return problems;
}
