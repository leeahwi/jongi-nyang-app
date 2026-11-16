import fs from "node:fs";
import path from "node:path";
import { isoDate } from "../../core/notebook";
import { lang, t } from "../../i18n";
import { type PaperKind, darkKinds, paperKinds } from "../../core/paper";
import { type LayoutReport, layoutCheckScript } from "../layoutCheck";
import { pinnedView, setFolderView } from "../../core/memoDrawer";
import { drawerLegacy } from "../../core/textSteps";
import { searchGroupTitle } from "../../core/search";
import { confirmSlip, drawer, drawerShortcutQuestion, moveQuestion, note, quickMemo, store } from "../main";
import { type Save, type Wait } from "./index";
import { noteLayoutChecks } from "./cats";
import { settingsPaneChecks } from "./ai";
import { captureDesk, inPane, settledScript, showDeskPane } from "./desk";
import { drawerLayoutChecks, drawerSample, fakeDesktop } from "./spaces";

/**
 * #408: 메모 서랍's snapshots (`npm run snapshot -- drawer` · `cardfont` · `markdown` · `drawer2b`), moved out of main.ts
 * as they were. Test runs only (see snapshots/design.ts).
 */

export async function drawerShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  const sample = drawerSample();
  const id = (key: string) => JSON.stringify(sample.ids[key]);
  store.setPref("drawerSide", "right");
  store.setPref("drawerWidth", 300);
  store.setPref("drawerShortcut", "Control+Shift+D");
  store.setPref("drawerBackdrop", "solid");
  // #244: the drawer follows the note by default; these shots pick the drawer's own paper (and its night one).
  store.setPref("drawerSameAsNote", false);
  const window = await drawer.showForSnapshot();
  const run = (script: string) => window.webContents.executeJavaScript(script).catch((error: Error) => `script failed: ${error.message}`);
  const own = `(() => {
    const out = [];
    const r = (el) => el.getBoundingClientRect();
    const ears = document.querySelector(".ears");
    if (ears && getComputedStyle(ears).display !== "none" && (r(ears).top < -0.5 || r(ears).right > window.innerWidth + 0.5 || r(ears).left < -0.5)) out.push("ears cut off");
    const title = document.querySelector(".fname:not([hidden]) .hw"), icons = document.querySelector(".ttl .ic");
    if (title && icons && r(title).right > r(icons).left + 0.5) out.push("title under the icons");
    if (title && title.scrollWidth > title.clientWidth + 1) out.push("title clipped: " + title.textContent);
    for (const tab of document.querySelectorAll(".bk")) { const b = r(tab); if (b.bottom > window.innerHeight || b.left < -0.5 || b.right > window.innerWidth + 0.5) out.push("bookmark outside: " + (tab.getAttribute("aria-label") || "")); }
    const on = document.querySelector(".bk.on:not(.paw)");
    if (on && on.scrollHeight > on.clientHeight + 1) out.push("bookmark name cut: " + on.textContent);
    for (const hw of document.querySelectorAll(".it .row .hw")) if (hw.scrollWidth > hw.clientWidth + 1 && !hw.title) out.push("card title cut without a tooltip");
    for (const menu of document.querySelectorAll(".menu")) { const m = r(menu); if (m.right > window.innerWidth + 0.5 || m.bottom > window.innerHeight + 0.5 || m.left < -0.5 || m.top < -0.5) out.push("menu outside the window"); if (menu.scrollHeight > menu.clientHeight + 1) out.push("menu scrolls"); }
    for (const chip of document.querySelectorAll(".menu .swrow button > span:last-child")) if (chip.scrollWidth > chip.clientWidth + 1) out.push("swatch name cut: " + chip.textContent);
    for (const card of document.querySelectorAll(".it:not(.open):not(.ti)")) { const h = r(card).height; if (h < (document.querySelector(".list.dense") ? 55.5 : 67.5)) out.push("card too short: " + Math.round(h)); }
    const when = document.querySelector(".acts .when");
    if (when && when.scrollWidth > when.clientWidth + 1) out.push("edited time cut: " + when.textContent);
    // #164: the close tab is out of the paper, against its inner edge, in the middle (or under the bookmarks), over none
    // of them and inside the window; no × in the header.
    const bar = document.querySelector(".closebar"), tab = document.querySelector(".closebar .bar"), paper = document.querySelector(".dr");
    if (!bar || !tab || !paper || r(tab).width === 0) out.push("no close tab");
    else {
      const b = r(tab), d = r(paper), right = document.querySelector(".stage.side-right");
      if (right ? b.right > d.left + 0.5 : b.left < d.right - 0.5) out.push("close tab on the paper");
      if (Math.abs(right ? b.right - d.left : b.left - d.right) > 1.5) out.push("close tab off the inner edge");
      if (b.left < -0.5 || b.right > window.innerWidth + 0.5 || b.bottom > window.innerHeight + 0.5) out.push("close tab outside the window");
      const middle = Math.abs((b.top + b.bottom) / 2 - (d.top + d.bottom) / 2) <= 1;
      const under = [...document.querySelectorAll(".bk")].some((mark) => Math.abs(r(bar).top - r(mark).bottom - 12) <= 1.5);
      if (!middle && !under) out.push("close tab neither in the middle nor under the bookmarks");
      // A bookmark scrolled out of the bookmarks' column (its hidden part) doesn't count.
      const column = r(document.querySelector(".tabs"));
      for (const mark of document.querySelectorAll(".bk")) { const m = r(mark); if (Math.min(m.bottom, column.bottom) > b.top + 0.5 && m.top < b.bottom - 0.5 && m.right > b.left + 0.5 && m.left < b.right - 0.5) out.push("close tab over a bookmark"); }
    }
    if (document.querySelectorAll(".hd .ic .ib").length !== 1) out.push("header icons: not just search"); // #111
    return out;
  })()`;
  const backdrop = (look: string) => darkKinds.includes(look as PaperKind) ? "#1f1e1b" : look === "kraft" ? "#cfc8bb" : look === "grid" ? "#d3d7db" : "#d8d4cc";
  const shot = async (name: string, prepare = "", desktop = false) => {
    if (prepare) await run(prepare);
    await wait(350);
    await window.webContents.executeJavaScript(settledScript).catch(() => undefined);
    const report = await window.webContents.executeJavaScript(layoutCheckScript(drawerLayoutChecks)).catch((error: Error) => ({ problems: [`check failed: ${error.message}`], truncated: [] })) as LayoutReport;
    const mine = await run(own) as string[] | string;
    const found = [...report.problems, ...(Array.isArray(mine) ? mine : [mine])];
    console.log(`drawer ${name}: ${found.length ? found.join("; ") : "ok"}${report.truncated.length ? ` · truncated: ${report.truncated.join(" · ")}` : ""}`);
    problems += found.length;
    // A desktop behind it, as the mock has, so the transparent window reads in the picture (바탕: a busy one).
    if (desktop) await run(fakeDesktop);
    else await run(`document.body.style.background = ${JSON.stringify("")} || (${JSON.stringify(Object.fromEntries(paperKinds.map((look) => [look, backdrop(look)])))})[document.documentElement.dataset.look] || "${backdrop("day")}"`);
    await wait(150);
    await save(`drawer/${name}`, window.webContents.capturePage());
    await run(`document.body.style.background = ""; document.getElementById("fake-desktop")?.remove()`);
  };
  fs.mkdirSync(path.join(directory, "drawer"), { recursive: true });
  const reset = `window.drawerTest.reset()`;
  /**
   * 메모 마크다운 · 글꼴 · 크기 (#84): a memo with every mark (fictional words) and one without boxes in 공부 — open in the
   * editor at the four sizes (낮 · 밤), in 크라프트지 and 모눈, at the largest size in the narrowest drawer (typed and as it
   * reads), as it reads with its boxes, being typed into, in 크게 보기, the three other faces, and the cards. Each shot
   * also checks that no line of the open memo runs out of its card.
   */
  const markdownSection = async () => {
    const full = t("{h1} 여행 준비\n**금요일**까지 _천천히_ 챙기기. ~~지난 목록~~은 버려요.\n{h2} 짐\n- 여권과 `충전기`\n  - 작은 가방\n1. 숙소 확인\n2) 기차표 출력\n> 비 오면 우산 챙기기\n- [ ] 환전하기\n- [x] 보험 들기\n---\n{h3} 링크\n[지도 보기](https://example.com/map) · https://example.com/info\n***꼭 기억하기***\n```\nls ~/여행\n```", { h1: "#", h2: "##", h3: "###" });
    const short = t("{h2} 장 볼 것\n- **우유** 두 통\n- 달걀 _열 개_\n3. 빵집 들르기\n> 저녁 전에", { h2: "##" });
    const stamp = isoDate(new Date());
    const made = [{ id: "DRAWER-MD", text: full, createdAt: stamp, updatedAt: stamp }, { id: "DRAWER-MD2", text: short, createdAt: stamp, updatedAt: isoDate(new Date(Date.now() - 60_000)) }];
    store.memos = [...made, ...store.memos.filter((memo) => !memo.id.startsWith("DRAWER-MD"))];
    store.saveMemos();
    store.changeFolders((data) => ({ ...data, placement: { ...data.placement, ...Object.fromEntries(made.map((memo) => [memo.id, { folder: "DRAWER-STUDY", pinned: false, at: stamp }])) }, updatedAt: stamp }));
    const spill = `(() => {
      const out = [];
      const card = document.querySelector(".it.open, .big");
      if (!card) return out;
      const edge = card.getBoundingClientRect();
      for (const line of card.querySelectorAll(".cm-line, .ln")) { const r = line.getBoundingClientRect(); if (r.width && r.right > edge.right + 0.5) out.push("line out of its card: " + line.textContent.slice(0, 30)); }
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) out.push("the page scrolls sideways");
      return out;
    })()`;
    const mdShot = async (name: string, prepare: string) => {
      await shot(name, `window.drawerTest.view("DRAWER-STUDY"); ${prepare}`);
      const found = await run(spill) as string[] | string;
      if (Array.isArray(found) && found.length) { console.log(`drawer ${name}: ${found.join("; ")}`); problems += found.length; }
    };
    const open = (edit: boolean) => `window.drawerTest.open("DRAWER-MD", ${edit})`;
    store.setPref("drawerWidth", 300);
    // The sizes on a tall screen: the whole memo (and its bar) in view at every size and language.
    await drawer.showForSnapshot(1340);
    for (const theme of ["day", "night"] as const) {
      store.setPref("drawerTheme", theme);
      // 1.30's four sizes by their old names (#141: 13 · 14 · 16 · 18 of the nine steps).
      for (const size of ["small", "regular", "large", "extraLarge"] as const) {
        store.setPref("drawerTextPt", drawerLegacy[size]);
        await run(reset);
        await mdShot(`drawer-md-${size}-${theme}`, open(true));
      }
      store.setPref("drawerTextPt", 14);
      await run(reset);
      await mdShot(`drawer-md-read-${theme}`, open(false));
      // 줄 간격 넉넉하게 · 문단 간격 아주 넓게 (#141), typed and as it reads.
      store.setPref("drawerLineHeight", "loose");
      store.setPref("drawerParagraph", "wider");
      await run(reset);
      await mdShot(`drawer-md-spacing-${theme}`, open(true));
      await run(reset);
      await mdShot(`drawer-md-spacing-read-${theme}`, open(false));
      store.setPref("drawerLineHeight", "regular");
      store.setPref("drawerParagraph", "regular");
      await run(reset);
      await mdShot(`drawer-md-card-${theme}`, "");
    }
    await drawer.showForSnapshot();
    for (const theme of ["kraft", "grid"] as const) {
      store.setPref("drawerTheme", theme);
      await run(reset);
      await mdShot(`drawer-md-${theme}`, open(true));
    }
    store.setPref("drawerTheme", "day");
    for (const face of ["pen", "brush", "mono"] as const) {
      store.setPref("drawerFont", face);
      await run(reset);
      await mdShot(`drawer-md-font-${face}`, open(true));
    }
    // 코드 글꼴 D2Coding (#143): the code block and `code` with Korean in them, and the 고정폭 face.
    store.setPref("drawerFont", "clean");
    store.setPref("drawerCodeFont", "d2coding");
    await run(reset);
    await mdShot("drawer-md-code-d2coding", open(true));
    store.setPref("drawerFont", "mono");
    await run(reset);
    await mdShot("drawer-md-font-mono-d2coding", open(true));
    store.setPref("drawerCodeFont", "system");
    store.setPref("drawerFont", "clean");
    // The largest size in the narrowest drawer on a tall screen (the whole memo in view): typed, as it reads, the cards.
    await drawer.showForSnapshot(1340);
    store.setPref("drawerTextPt", 18);
    store.setPref("drawerWidth", 260);
    for (const theme of ["day", "night"] as const) {
      store.setPref("drawerTheme", theme);
      await run(reset);
      await mdShot(`drawer-md-narrow-extraLarge-${theme}`, open(true));
      await run(reset);
      await mdShot(`drawer-md-narrow-extraLarge-read-${theme}`, open(false));
      await run(reset);
      await mdShot(`drawer-md-card-narrow-extraLarge-${theme}`, "");
      // #141: the new largest step, 20, in the narrowest drawer.
      store.setPref("drawerTextPt", 20);
      await run(reset);
      await mdShot(`drawer-md-narrow-20-${theme}`, open(true));
      store.setPref("drawerTextPt", 18);
    }
    store.setPref("drawerTheme", "day");
    store.setPref("drawerTextPt", 14);
    store.setPref("drawerWidth", 300);
    await drawer.showForSnapshot();
    // Being typed into: a new line with a mark still open (words until it pairs), then 크게 보기.
    await run(reset);
    await mdShot("drawer-md-typing", `${open(true)}; window.drawerTest.typeInMemo(${JSON.stringify(t("\n- 새로 적는 **줄"))})`);
    await run(reset);
    await mdShot("drawer-md-big", `window.drawerTest.select("DRAWER-MD"); window.drawerTest.big()`);
    // The Aa bar (2026-10-30), at 300 and at 260; every mark shown (기호 늘 보이기).
    await run(reset);
    await mdShot("drawer-md-format-bar", `${open(true)}; window.drawerTest.formatBar()`);
    store.setPref("drawerWidth", 260);
    await run(reset);
    await mdShot("drawer-md-format-bar-narrow", `${open(true)}; window.drawerTest.formatBar()`);
    store.setPref("drawerWidth", 300);
    store.setPref("drawerShowMarks", true);
    await run(reset);
    await mdShot("drawer-md-marks", open(true));
    store.setPref("drawerShowMarks", false);
    await run(reset);
    store.memos = store.memos.filter((memo) => !memo.id.startsWith("DRAWER-MD"));
    store.saveMemos();
  };
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "markdown") {
    await markdownSection();
    return problems;
  }
  /**
   * 메모 서랍 batch 2B (#117 · #118 · #119 · #134 · #135), day and night: the picked card's edge and Ctrl+Shift+M's
   * list, the quick-write slip typed into, the title line's `# ` hidden and faint and its ``` opening a block, the link
   * field (and narrow); the drawer's keys slip and 빠른 메모 with its folder chip and list. Each drawer shot also logs
   * what Narrator reads (the roles and names of what can be reached).
   */
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "drawer2b") {
    const full = t("{h1} 여행 준비\n**금요일**까지 _천천히_ 챙기기. ~~지난 목록~~은 버려요.\n{h2} 짐\n- 여권과 `충전기`\n  - 작은 가방\n1. 숙소 확인\n2) 기차표 출력\n> 비 오면 우산 챙기기\n- [ ] 환전하기\n- [x] 보험 들기\n---\n{h3} 링크\n[지도 보기](https://example.com/map) · https://example.com/info\n***꼭 기억하기***\n```\nls ~/여행\n```", { h1: "#", h2: "##", h3: "###" });
    const stamp = isoDate(new Date());
    const made = [
      { id: "DRAWER-MD", text: full, createdAt: stamp, updatedAt: stamp },
      { id: "DRAWER-FENCE", text: "```\nnpm run build\nnpm test\n```\n**done**", createdAt: stamp, updatedAt: isoDate(new Date(Date.now() - 60_000)) },
    ];
    store.memos = [...made, ...store.memos.filter((memo) => !made.some((entry) => entry.id === memo.id))];
    store.saveMemos();
    store.changeFolders((data) => ({ ...data, placement: { ...data.placement, ...Object.fromEntries(made.map((memo) => [memo.id, { folder: "DRAWER-STUDY", pinned: false, at: stamp }])) }, updatedAt: stamp }));
    const aria = `(() => {
      const out = [];
      const name = (el) => el.getAttribute("aria-label") || (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 60);
      for (const el of document.querySelectorAll("button, [role], input, textarea, .cm-content, [tabindex]")) {
        if (el.closest("[aria-hidden='true']") || el.closest("[hidden]")) continue;
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        const role = el.getAttribute("role") || el.tagName.toLowerCase();
        const extra = ["aria-description", "aria-selected", "aria-current", "aria-pressed", "aria-expanded", "aria-checked"].map((key) => el.hasAttribute(key) ? key.slice(5) + "=" + el.getAttribute(key) : "").filter(Boolean).join(" ");
        const label = name(el);
        if (!label && role === "div") continue;
        out.push(role + ": " + (label || "(no name)") + (extra ? " · " + extra : ""));
      }
      return out.join("\\n");
    })()`;
    const ariaShot = async (name: string, prepare: string) => {
      await shot(name, prepare);
      if (name.endsWith("-day")) console.log(`drawer ${name} reads:\n${await run(aria)}`);
    };
    await drawer.showForSnapshot(1000);
    for (const theme of ["day", "night"] as const) {
      store.setPref("drawerTheme", theme);
      await run(reset);
      await ariaShot(`drawer-2b-selected-${theme}`, `window.drawerTest.view("DRAWER-WORK"); window.drawerTest.select(${id("command")})`);
      await run(reset);
      await shot(`drawer-2b-move-${theme}`, `window.drawerTest.view("DRAWER-WORK"); window.drawerTest.moveList(${id("command")})`);
      await run(reset);
      await shot(`drawer-2b-quick-${theme}`, `window.drawerTest.view("DRAWER-WORK"); window.drawerTest.type(${JSON.stringify(t("내일 아침에 우체국 들르기"))})`);
      await run(reset);
      await ariaShot(`drawer-2b-title-${theme}`, `window.drawerTest.view("DRAWER-STUDY"); window.drawerTest.open("DRAWER-MD", true)`);
      await shot(`drawer-2b-title-caret-${theme}`, `window.drawerTest.titleCaret(true)`);
      await run(reset);
      await shot(`drawer-2b-fence-${theme}`, `window.drawerTest.view("DRAWER-STUDY"); window.drawerTest.open("DRAWER-FENCE", true)`);
      await run(reset);
      await shot(`drawer-2b-link-new-${theme}`, `window.drawerTest.view("DRAWER-STUDY"); window.drawerTest.open("DRAWER-MD", true); window.drawerTest.linkField("example.com/map", false)`);
      await run(reset);
      await ariaShot(`drawer-2b-link-edit-${theme}`, `window.drawerTest.view("DRAWER-STUDY"); window.drawerTest.open("DRAWER-MD", true); window.drawerTest.linkField("https://example.com/map", true)`);
    }
    // #163: a box ticked by a click — at rest, frozen mid-tick (the box filling, its mark drawing in), then done and
    // moved down — in the editor and in the memo as it reads.
    const seed = () => { store.memos = [...made, ...store.memos.filter((memo) => !made.some((entry) => entry.id === memo.id))]; store.saveMemos(); };
    const frozen = async (name: string, click: string) => {
      await run(click);
      await wait(100);
      await run(`document.getAnimations().forEach((a) => { a.pause(); a.currentTime = 110; })`);
      await wait(80);
      await save(`drawer/${name}`, window.webContents.capturePage());
      await run(`document.getAnimations().forEach((a) => a.finish())`);
    };
    for (const theme of ["day", "night"] as const) {
      store.setPref("drawerTheme", theme);
      seed();
      await run(reset);
      await shot(`drawer-2b-box-rest-${theme}`, `window.drawerTest.view("DRAWER-STUDY"); window.drawerTest.open("DRAWER-MD", true)`);
      await frozen(`drawer-2b-box-mid-${theme}`, `document.querySelector(".it.open .md-box:not(.on)")?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }))`);
      await wait(600);
      await shot(`drawer-2b-box-done-${theme}`);
      seed();
      await run(reset);
      await shot(`drawer-2b-card-box-rest-${theme}`, `window.drawerTest.view("DRAWER-STUDY"); window.drawerTest.open("DRAWER-MD", false)`);
      await frozen(`drawer-2b-card-box-mid-${theme}`, `document.querySelector(".it.open .ck:not(.done) > .bx")?.click()`);
      await wait(600);
      await shot(`drawer-2b-card-box-done-${theme}`);
    }
    seed();
    store.setPref("drawerTheme", "day");
    store.setPref("drawerWidth", 260);
    await run(reset);
    await shot("drawer-2b-link-edit-narrow-day", `window.drawerTest.view("DRAWER-STUDY"); window.drawerTest.open("DRAWER-MD", true); window.drawerTest.linkField("https://example.com/map", true)`);
    await run(reset);
    await shot("drawer-2b-quick-narrow-day", `window.drawerTest.view("DRAWER-WORK"); window.drawerTest.type(${JSON.stringify(t("내일 아침에 우체국 들르기"))})`);
    store.setPref("drawerWidth", 300);
    await run(reset);
    // The drawer's keys (Ctrl+/) and 빠른 메모 with its folder chip, then its folder list open — on day and night paper.
    for (const theme of ["day", "night"] as const) {
      store.setPref("paper", theme);
      await wait(300);
      await confirmSlip.showForSnapshot(drawerShortcutQuestion());
      await wait(800);
      await save(`drawer/drawer-2b-keys-${theme}`, confirmSlip.capture());
      confirmSlip.hide();
      await quickMemo.showForSnapshot(t("주말에 할 것\n화분 분갈이, 책 반납\n엄마께 전화"));
      await wait(700);
      await save(`drawer/quick-memo-2b-${theme}`, quickMemo.capture());
      await quickMemo.snapshotWindow?.webContents.executeJavaScript("window.quickMemoTest.folders()");
      await wait(400);
      if (theme === "day") console.log(`quick memo reads:\n${await quickMemo.snapshotWindow?.webContents.executeJavaScript(aria)}`);
      await save(`drawer/quick-memo-2b-folders-${theme}`, quickMemo.capture());
      quickMemo.hide();
    }
    store.setPref("paper", "day");
    store.memos = store.memos.filter((memo) => !made.some((entry) => entry.id === memo.id));
    store.saveMemos();
    return problems;
  }
  /**
   * #198: the cards' preview lines in the words' face — 기본 글씨, 손글씨 펜 and 손글씨 붓 on 낮 종이 and 먹색 종이, in the
   * drawer at 300 and at its narrowest (260); and 찾기's found lines in the pen. Each shot also checks that no preview
   * line is taller than the preview's line (the card keeps its height) and that a card's words stay on its sheet.
   */
  const cardFontSection = async () => {
    const lines = `(() => {
      const out = [];
      const line = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--m-preview-line"));
      for (const p of document.querySelectorAll(".it:not(.open) .p")) {
        const clamp = Number(getComputedStyle(p).webkitLineClamp) || 3;
        const style = getComputedStyle(p);
        const inner = p.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
        if (inner > clamp * line + 0.5) out.push("preview taller than its lines: " + p.textContent.slice(0, 20));
      }
      for (const row of document.querySelectorAll(".it:not(.open) .pr")) if (Math.abs(row.getBoundingClientRect().height - line) > 0.5) out.push("checklist row off its line");
      for (const card of document.querySelectorAll(".it:not(.open)")) {
        const edge = card.getBoundingClientRect();
        for (const p of card.querySelectorAll(".p, .pr")) { const r = p.getBoundingClientRect(); if (r.bottom > edge.bottom + 0.5 || r.right > edge.right + 0.5) out.push("preview off its sheet: " + p.textContent.slice(0, 20)); }
      }
      return out;
    })()`;
    const fontShot = async (name: string, prepare: string) => {
      await shot(name, prepare);
      const found = await run(lines) as string[] | string;
      if (Array.isArray(found) && found.length) { console.log(`drawer ${name}: ${found.join("; ")}`); problems += found.length; }
    };
    for (const face of ["clean", "pen", "brush"] as const) {
      store.setPref("drawerFont", face);
      for (const theme of ["day", "ink"] as const) {
        store.setPref("drawerTheme", theme);
        for (const width of [300, 260]) {
          store.setPref("drawerWidth", width);
          await run(reset);
          await fontShot(`drawer-card-font-${face}-${theme}${width === 260 ? "-260" : ""}`, `window.drawerTest.view("DRAWER-WORK")`);
        }
      }
      store.setPref("drawerWidth", 300);
      store.setPref("drawerTheme", "day");
      await run(reset);
      await fontShot(`drawer-card-font-${face}-search`, `window.drawerTest.view("DRAWER-WORK"); window.drawerTest.search("QA")`);
    }
    store.setPref("drawerFont", "clean");
    store.setPref("drawerTheme", "day");
    store.setPref("drawerWidth", 300);
    await run(reset);
  };
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "cardfont") {
    await cardFontSection();
    return problems;
  }
  await cardFontSection();
  // The list in date groups with its kinds and the hover pill, then the open checklist with its bar — each paper.
  // #142: 한지 · 쑥색 · 벚꽃 · 먹색 too.
  for (const theme of ["day", "night", "kraft", "grid", "hanji", "sage", "blossom", "ink"] as const) {
    store.setPref("drawerTheme", theme);
    await run(reset);
    await run(`window.drawerTest.view("DRAWER-WORK")`);
    await shot(`drawer-${theme}`, `window.drawerTest.hover(${id("command")})`);
    await run(reset);
    await shot(`drawer-${theme}-open`, `window.drawerTest.open(${id("release")}, false)`);
    await run(reset);
    await shot(`drawer-${theme}-scrolled`, `document.querySelector(".list").scrollTop = 10000`);
    // #115: 제목만 (the busy folder: about twelve to a screen).
    store.changeFolders((data) => setFolderView(data, "DRAWER-LOG", "titles"));
    await run(reset);
    await shot(`drawer-titles-${theme}`, `window.drawerTest.view("DRAWER-LOG")`);
    store.changeFolders((data) => setFolderView(data, "DRAWER-LOG", "cards"));
    await run(`window.drawerTest.view("DRAWER-WORK")`);
  }
  store.setPref("drawerTheme", "day");
  await run(reset);
  await shot("drawer-editing", `window.drawerTest.open(${id("meeting")}, true)`);
  await run(reset);
  // #133: a checklist typed — its boxes drawn in the editor, done items faint and struck through.
  await shot("drawer-editing-check", `window.drawerTest.open(${id("release")}, true)`);
  await run(reset);
  // #112: the open memo's ⋯ is the memo's own menu.
  await shot("drawer-memo-more", `window.drawerTest.open(${id("release")}, false); window.drawerTest.memoMore()`);
  await run(reset);
  await shot("drawer-big", `window.drawerTest.select(${id("meeting")}); window.drawerTest.big()`);
  await run(reset);
  await shot("drawer-move-menu", `window.drawerTest.open(${id("release")}, false); window.drawerTest.moveMenu()`);
  await run(reset);
  await shot("drawer-folder-list", `window.drawerTest.folderList()`);
  // #120: 지운 메모 — its slip and the question before 모두 비우기, day and night, and 한지 · 먹색 (#142).
  for (const theme of ["day", "night", "hanji", "ink"] as const) {
    store.setPref("drawerTheme", theme);
    await run(reset);
    await shot(`drawer-trash-${theme}`, `window.drawerTest.trash()`);
    await run(reset);
    await shot(`drawer-trash-ask-${theme}`, `window.drawerTest.trash(true)`);
  }
  store.setPref("drawerTheme", "day");
  await run(reset);
  // #115: 회사 in 제목만 with a memo open where it was (its card), at 300 and 260.
  store.changeFolders((data) => setFolderView(data, "DRAWER-WORK", "titles"));
  await run(reset);
  await shot("drawer-titles-open", `window.drawerTest.view("DRAWER-WORK"); window.drawerTest.open(${id("release")}, false)`);
  await run(reset);
  store.setPref("drawerWidth", 260);
  await shot("drawer-titles-260", `window.drawerTest.view("DRAWER-WORK")`);
  store.setPref("drawerWidth", 300);
  await run(reset);
  store.changeFolders((data) => setFolderView(data, "DRAWER-WORK", "cards"));
  await run(reset);
  await shot("drawer-memo-menu", `window.drawerTest.memoMenu(${id("command")})`);
  await run(reset);
  await shot("drawer-memo-menu-move", `window.drawerTest.memoMenu(${id("release")}, true)`);
  await run(reset);
  await shot("drawer-gear-menu", `window.drawerTest.gearMenu()`);
  await run(reset);
  await shot("drawer-text-menu", `window.drawerTest.textMenu(${id("release")})`);
  await run(reset);
  await shot("drawer-folder-menu", `window.drawerTest.folderMenu("DRAWER-WORK")`);
  await run(reset);
  await shot("drawer-sort-menu", `window.drawerTest.sortMenu("DRAWER-WORK")`);
  await run(reset);
  await shot("drawer-pinned-menu", `window.drawerTest.pinnedMenu()`);
  await run(reset);
  await shot("drawer-bookmark-tip", `window.drawerTest.tip("DRAWER-HOME")`);
  await run(reset);
  await shot("drawer-new-folder", `window.drawerTest.newFolder()`);
  await run(reset);
  await shot("drawer-typing", `window.drawerTest.type(${JSON.stringify(t("내일 아침에 우체국 들르기"))})`);
  await run(reset);
  // 이 메모의 종이: a night memo in a day drawer, closed and open.
  await shot("drawer-own-paper", `document.querySelector('.it[data-id=${id("idea")}]')?.scrollIntoView({ block: "center" })`);
  await run(reset);
  await shot("drawer-own-paper-open", `window.drawerTest.open(${id("idea")}, true)`);
  await run(reset);
  // Many memos: a little denser (12 px apart, 56 px cards).
  await shot("drawer-dense", `window.drawerTest.view("DRAWER-LOG")`);
  await run(reset);
  await shot("drawer-empty", `window.drawerTest.view("DRAWER-STUDY")`);
  await shot("drawer-pinned", `window.drawerTest.view(${JSON.stringify(pinnedView)})`);
  await run(`window.drawerTest.view("DRAWER-WORK")`);
  await shot("drawer-search", `window.drawerTest.search(${JSON.stringify(t("회의"))})`);
  await run(reset);
  await shot("drawer-search-none", `window.drawerTest.search("zzz")`);
  await run(reset);
  // #114: results by folder with the found line deep in a long one; 안 한 체크 alone; this folder only with 링크; day and night, and 한지 · 먹색 (#142).
  for (const theme of ["day", "night", "hanji", "ink"] as const) {
    store.setPref("drawerTheme", theme);
    await run(reset);
    await run(`window.drawerTest.view("DRAWER-WORK")`);
    await shot(`drawer-search-line-${theme}`, `window.drawerTest.search("QA")`);
    await run(reset);
    await shot(`drawer-search-open-${theme}`, `window.drawerTest.searchFilter("open")`);
    await run(reset);
    await run(`window.drawerTest.view("DRAWER-WORK")`);
    await shot(`drawer-search-here-${theme}`, `window.drawerTest.searchFilter("link"); window.drawerTest.searchHere()`);
  }
  store.setPref("drawerTheme", "day");
  await run(reset);
  // 바탕: 불투명 · 반투명 · 투명 · 바탕 없음 over a busy desktop, day and night.
  for (const theme of ["day", "night"] as const) {
    store.setPref("drawerTheme", theme);
    for (const mode of ["solid", "frost", "strong", "none"] as const) {
      store.setPref("drawerBackdrop", mode);
      await run(reset);
      await run(`window.drawerTest.view("DRAWER-WORK")`);
      await shot(`drawer-backdrop-${mode}-${theme}`, `window.drawerTest.open(${id("release")}, false)`, true);
    }
  }
  store.setPref("drawerBackdrop", "solid");
  store.setPref("drawerTheme", "day");
  await run(reset);
  await run(`window.drawerTest.view("DRAWER-WORK")`);
  for (const width of [260, 480]) {
    store.setPref("drawerWidth", width);
    await shot(`drawer-${width}`, `window.drawerTest.open(${id("release")}, false)`);
    await run(reset);
  }
  store.setPref("drawerWidth", 260);
  await shot("drawer-260-menu", `window.drawerTest.memoMenu(${id("command")})`);
  await run(reset);
  await shot("drawer-260-gear", `window.drawerTest.gearMenu()`);
  await run(reset);
  store.setPref("drawerWidth", 300);
  store.setPref("drawerSide", "left");
  await shot("drawer-left", `window.drawerTest.open(${id("release")}, false)`);
  await run(reset);
  await shot("drawer-left-tip", `window.drawerTest.tip("DRAWER-HOME")`);
  await run(reset);
  // #82 · #83: the empty bookmark (+) and the close bar as if under the pointer, on the left and the right, day and night.
  for (const theme of ["day", "night"] as const) {
    store.setPref("drawerTheme", theme);
    store.setPref("drawerSide", "left");
    await run(reset);
    await shot(`drawer-edge-hover-left-${theme}`, `window.drawerTest.edgeHover()`);
    store.setPref("drawerSide", "right");
    await run(reset);
    await shot(`drawer-edge-hover-${theme}`, `window.drawerTest.edgeHover()`);
  }
  store.setPref("drawerTheme", "day");
  store.setPref("drawerSide", "right");
  await run(reset);
  // Short and tall screens (a 768-pixel laptop under the taskbar; a 1440 monitor).
  for (const height of [560, 1340]) {
    await drawer.showForSnapshot(height);
    await shot(`drawer-height-${height}`, `window.drawerTest.view("DRAWER-WORK")`);
  }
  await drawer.showForSnapshot();
  // Windows' own UI face (Noto Sans KR standing in for Malgun Gothic: taller lines, wider Hangul), narrowest.
  const notoCSS = await window.webContents.insertCSS(`:root { --ui: "Noto Sans KR", "Malgun Gothic", sans-serif !important; }`);
  store.setPref("drawerWidth", 260);
  await shot("drawer-260-noto", `window.drawerTest.view("DRAWER-WORK"); window.drawerTest.open(${id("release")}, false)`);
  await run(reset);
  await shot("drawer-260-noto-menu", `window.drawerTest.folderMenu("DRAWER-WORK")`);
  await run(reset);
  await shot("drawer-260-noto-memo-menu", `window.drawerTest.memoMenu(${id("command")})`);
  await run(reset);
  store.setPref("drawerWidth", 300);
  await window.webContents.removeInsertedCSS(notoCSS);
  store.setPref("drawerTheme", "night");
  await shot("drawer-night-search", `window.drawerTest.search(${JSON.stringify(t("ㅎㅇ"))})`);
  store.setPref("drawerTheme", "auto");
  await run(reset);
  await markdownSection();
  // 설정 › 메모 서랍, and the note's memo tab with each memo's folder.
  const pane = await showDeskPane("drawer", wait);
  void pane;
  const paneReport = await inPane("settings", layoutCheckScript(settingsPaneChecks)) as LayoutReport | string | undefined;
  const paneFound = typeof paneReport === "object" && paneReport ? paneReport.problems : [`check failed: ${String(paneReport)}`];
  console.log(`drawer drawer-settings: ${paneFound.length ? paneFound.join("; ") : "ok"}`);
  problems += paneFound.length;
  await save("drawer/drawer-settings", captureDesk(wait));
  await inPane("settings", `document.querySelector(".keyfield")?.click()`);
  await wait(300);
  await save("drawer/drawer-settings-recording", captureDesk(wait));
  await inPane("settings", `document.querySelector(".keyfield")?.click()`);
  // The note without its memo tab (two tabs, the drawer button by the pin), and where memos open from it now:
  // a search hit opens the drawer on that memo (M5); /메모 says so with 열기 (M4).
  note.showInactive();
  note.webContents.send("note:row-command", { id: "", command: "page-today" });
  await wait(500);
  const noteReport = await note.webContents.executeJavaScript(layoutCheckScript(noteLayoutChecks)).catch((error: Error) => ({ problems: [`check failed: ${error.message}`], truncated: [] })) as LayoutReport;
  const tabsReport = await note.webContents.executeJavaScript(`(() => { const tabs = [...document.querySelectorAll(".index-tab")]; const drawer = document.querySelector(".tools .drawer-open"); return tabs.length + " tabs · " + tabs.map((tab) => tab.textContent).join(" | ") + " · drawer button " + (drawer && drawer.getBoundingClientRect().width > 0 ? "shown" : "MISSING"); })()`);
  console.log(`drawer note-two-tabs: ${noteReport.problems.length ? noteReport.problems.join("; ") : "ok"} · ${tabsReport}`);
  problems += noteReport.problems.length;
  await save("drawer/note-two-tabs", note.webContents.capturePage());
  // Two tabs, narrow and wide, day and night: the row balanced, nothing cut (the header check's own words).
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    for (const width of [350, 720]) {
      note.setSize(width, 560);
      await wait(400);
      const header = await note.webContents.executeJavaScript(`(() => {
        const r = (el) => el.getBoundingClientRect();
        const out = [];
        const tabs = [...document.querySelectorAll(".index-tab")], tools = document.querySelector(".tools");
        if (tabs.length !== 2) out.push(tabs.length + " tabs");
        if (r(tabs[tabs.length - 1]).right > r(tools).left - 16) out.push("tabs run into the tools");
        for (const tab of tabs) { const label = tab.querySelector(".tab-label"); if (label.scrollWidth > label.clientWidth + 1) out.push("label cut: " + label.textContent); }
        for (const button of tools.querySelectorAll("button")) if (r(button).right > window.innerWidth + 0.5) out.push("tool cut");
        return out.join("; ");
      })()`);
      console.log(`drawer note-tabs-${paper}-${width}: ${header || "ok"}`);
      if (header) problems += 1;
      await save(`drawer/note-tabs-${paper}-${width}`, note.webContents.capturePage());
    }
  }
  store.setPref("paper", "day");
  note.setSize(420, 560);
  await note.webContents.executeJavaScript(`window.showSearch(${JSON.stringify(t("회의"))})`).catch(() => undefined);
  await wait(500);
  await save("drawer/note-search-memo", note.webContents.capturePage());
  await note.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(`.search-group[aria-label="${searchGroupTitle("memos", lang())}"] .search-row`)})?.click()`).catch(() => undefined);
  await wait(700);
  const opened = await window.webContents.executeJavaScript(`document.querySelector(".it.open")?.dataset.id ?? ""`).catch(() => "");
  console.log(`drawer search-opens-memo: ${opened ? `ok (${opened})` : "NOT OPENED"}`);
  if (!opened) problems += 1;
  await shot("drawer-from-search");
  await run(`window.drawerTest.reset()`);
  note.webContents.send("note:row-command", { id: "", command: "page-today" });
  await note.webContents.executeJavaScript(`(() => { const field = document.querySelector("textarea.typed"); field.focus(); field.value = ${JSON.stringify(t("/메모 우유 사기"))}; field.dispatchEvent(new Event("input")); field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); })()`).catch(() => undefined);
  await wait(700);
  const toastText = await note.webContents.executeJavaScript(`document.querySelector(".toast")?.textContent ?? ""`).catch(() => "");
  console.log(`drawer memo-line-toast: ${toastText}`);
  await save("drawer/note-memo-toast", note.webContents.capturePage());
  // 1.28's one-time slip: where the memo tab's memos went (M1).
  const question = moveQuestion();
  if (question) {
    await confirmSlip.showForSnapshot(question);
    await wait(800);
    await save("drawer/move-notice", confirmSlip.capture());
    confirmSlip.hide();
  }
  // The handle, closed: today's number under the paw.
  const handle = await drawer.handleForSnapshot();
  await wait(400);
  if (handle) await save("drawer/drawer-handle", handle.webContents.capturePage());
  drawer.hideForSnapshot();
  console.log(problems ? `DRAWER PROBLEMS: ${problems}` : "DRAWER OK");
  store.setPref("drawerSameAsNote", true);
  return problems;
}
