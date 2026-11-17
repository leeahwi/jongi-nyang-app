import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, nativeTheme } from "electron";
import { dayKey, logicalDayStart } from "../../core/archive";
import { isoDate } from "../../core/notebook";
import { pageOf } from "../../core/shelf";
import { lang, t } from "../../i18n";
import { type DeskPane, type PaperSetting } from "../../core/desk";
import { type NightChoice, type PaperKind, darkKinds, paperKinds } from "../../core/paper";
import { type EventColor, type LocalEvent } from "../../core/events";
import { widget as makeWidget } from "../../core/calendarWidget";
import { type LayoutReport, layoutCheckScript } from "../layoutCheck";
import { movedTomorrowText } from "../../core/carry";
import { snoozeChoices } from "../../core/snooze";
import { alarmClock, calendar, confirmSlip, drawer, floating, focusCommand, focusTimer, glance, note, periodicPopup, quick, quickMemo, rowMenu, store, sweep, taskPopup, trayTooltip, widgets } from "../main";
import { type Save, type Wait } from "./index";
import { aheadDragScript, noteLayoutChecks } from "./cats";
import { drawerSample } from "./spaces";
import { captureDesk, glanceFit, glanceState, glanceStateNames, inPane, openDay, settledScript, showDeskPane } from "./desk";

/**
 * #408: snapshots of the note's design stages (`npm run snapshot -- redesign` · `stage2` · `stage4` · `convenience` ·
 * `timeblock` · `strip` · `papers`), moved out of main.ts as they were. Test runs only: main.ts loads the snapshot
 * tools under `__TEST_HOOKS__`, so a release build leaves them out.
 */

/**
 * The redesign's shots (stage 1): the note with the day ribbon, 다음 and the input line; the line
 * while typing each kind (and a slash it can't read); the toast; ribbon variants; and every slip.
 */
export async function redesignShots(save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<void> {
  const run = (script: string) => note.webContents.executeJavaScript(script).catch((error: Error) => console.log(`script: ${error.message}`));
  const shot = async (name: string, window: BrowserWindow = note) => {
    await wait(350);
    await settled(window);
    await save(name, window.webContents.capturePage());
  };
  // Today with reminders later on (다음) and the sample events (the ribbon).
  const soon = (minutes: number) => new Date(Date.now() + minutes * 60_000);
  const today = logicalDayStart(new Date());
  const ends = today.getTime() + 24 * 3_600_000;
  store.mutate((history) => {
    const report = history.addTo(t("보고서 마무리"), undefined, new Date(), undefined, isoDate(soon(70) < new Date(ends) ? soon(70) : new Date(ends - 120_000)));
    const call = history.addTo(t("엄마께 전화"), undefined, new Date(), undefined, isoDate(soon(150) < new Date(ends) ? soon(150) : new Date(ends - 60_000)));
    void report; void call;
  });
  calendar.showSample();
  note.setSize(420, 640);
  note.webContents.send("note:row-command", { id: "", command: "page-today" });
  await wait(600);
  await shot("note-ribbon");
  // The ribbon's own states: its list opened, the 4 a.m. end (a late night), all-day pills only, nothing ahead.
  openDay(true);
  await shot("note-ribbon-open");
  openDay(false);
  const unpin = pinSampleReminders(today);
  await run(`window.ribbonNow = ${JSON.stringify(new Date(today.getTime() + 19.83 * 3_600_000).toISOString())}; window.dispatchEvent(new Event("ribbon-now"))`);
  await shot("note-ribbon-nothing-ahead");
  await run(`window.ribbonNow = undefined; window.dispatchEvent(new Event("ribbon-now"))`);
  unpin();
  // The input line while typing each kind.
  const type = async (text: string, pick = 0) => {
    // An off-screen window never has the focus: the line is drawn as if it had.
    await run(`(() => { const field = document.querySelector(".dock .typed"); field.focus(); document.querySelector(".dock .inp").classList.add("focused"); field.value = ${JSON.stringify(text)}; field.dispatchEvent(new Event("input")); })()`);
    for (let index = 0; index < pick; index += 1) await run(`document.querySelector(".dock .typed").dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }))`);
  };
  for (const [name, text, pick] of [
    ["note-typing-event", t("내일 3시 회의"), 0], ["note-typing-event-tab", t("내일 3시 회의"), 1], ["note-typing-todo", t("금요일까지 보고서 쓰기"), 0],
    ["note-typing-timer", t("타이머 40"), 0], ["note-typing-alarm", t("알람 7시 평일"), 0], ["note-typing-memo", t("장보기\n우유, 달걀, 사과"), 0],
    ["note-typing-slash", "/", 0], ["note-typing-slash-bad", t("/알람 언젠가"), 0],
  ] as const) {
    await type(text, pick);
    await shot(name);
  }
  // Put in: the toast with its switch.
  await type(t("내일 3시 회의"));
  await run(`document.querySelector(".dock .typed").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  await wait(300);
  await shot("note-toast");
  await run(`document.querySelector(".toast .toast-act")?.click()`);
  await wait(400);
  await shot("note-toast-switched");
  await run(`document.querySelector(".dock .typed").blur(); document.querySelector(".dock .inp").classList.remove("focused")`);
  // The event slip's pickers: the small month and the 15-minute list.
  calendar.newEvent();
  await wait(500);
  await run(`document.querySelector(".event-sheet .sheet-chip")?.click()`);
  await shot("calendar-sheet-date-picker");
  await run(`document.querySelector(".sheet-pop")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await run(`document.querySelectorAll(".event-sheet .sheet-chip")[1]?.click()`);
  await run(`(() => { const field = document.querySelector(".pop-field"); field.value = "17:20"; field.dispatchEvent(new Event("input")); })()`);
  await shot("calendar-sheet-time-picker");
  note.webContents.send("note:row-command", { id: "", command: "close-editor" });
  await wait(300);
  // Narrow and wide notes.
  for (const [width, height] of [[350, 520], [560, 760]] as const) {
    note.setSize(width, height);
    await wait(300);
    await shot(`note-ribbon-${width}`);
  }
  note.setSize(420, 560);
  // 빠른 입력 typing, empty, and its toast.
  // #387: the longest button ("Herhalende taak toevoegen") keeps its words; the hints keep only their keycaps.
  for (const [name, text] of [["quick-entry", t("내일 3시 회의")], ["quick-entry-timer", t("타이머 40")], ["quick-entry-empty", ""], ["quick-entry-repeat", t("매일 물 마시기")]] as const) {
    await quick.showForSnapshot(text);
    await wait(700);
    await save(name, quick.capture());
  }
  quick.hide();
}

/**
 * Stage 2's shots: 앞으로 (days with events and tasks, a drag lighting up a day, 그 뒤's months, empty,
 * narrow and wide, the toast after a move) and the 오늘 창 in its states, with the tray's tooltip for
 * each written to the log.
 */
export async function stage2Shots(save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<void> {
  const run = (script: string) => note.webContents.executeJavaScript(script).catch((error: Error) => console.log(`script: ${error.message}`));
  const shot = async (name: string, window: BrowserWindow = note) => {
    await wait(350);
    await settled(window);
    await save(name, window.webContents.capturePage());
  };
  const inDays = (days: number) => dayKey(new Date(logicalDayStart(new Date()).getTime() + days * 86_400_000 + 3_600_000));
  calendar.showSample();
  store.mutate((history) => {
    history.addTo(t("회의록 정리"), undefined, new Date(), inDays(1));
    // #48: a task with hours beside an untimed one — the flags line up in the last column, the time before it.
    const timed = history.addTo(t("보고서 쓰기"), undefined, new Date(), inDays(1));
    if (timed) history.setRange(timed.id, { start: 16 * 60, end: 17 * 60 + 30 });
    history.addTo(t("책 10쪽 읽기"), undefined, new Date(), inDays(3));
    history.addTo(t("발표 자료 보내기"), undefined, new Date(), inDays(8));
    history.addTo(t("세금 신고"), undefined, new Date(), inDays(30));
    history.addTo(t("연말 정산 서류 모으기"), undefined, new Date(), inDays(100));
    history.addTo(t("자전거 바람 넣기"), "later");
  });
  note.setSize(420, 640);
  note.webContents.send("note:row-command", { id: "", command: "page-ahead" });
  await wait(600);
  await shot("ahead");
  // A drag in progress: the next day lit up in sage, the line where it lands.
  await run(aheadDragScript);
  await shot("ahead-drag");
  note.webContents.send("note:row-command", { id: "", command: "page-today" });
  await wait(150);
  note.webContents.send("note:row-command", { id: "", command: "page-ahead" });
  await wait(300);
  // 그 뒤's months and 언젠가 at the end of the page.
  await run(`document.querySelector(".sheet").scrollTop = 1e6`);
  await shot("ahead-months");
  // A task moved to another day: the toast.
  const moved = store.items.find((item) => item.title === t("책 10쪽 읽기"));
  if (moved) {
    await run(`(() => { const row = document.querySelector('.ahead .row[data-id="${moved.id}"] .grip'); row?.scrollIntoView({ block: "center" }); })()`);
    store.mutate((history) => history.dropAhead(moved.id, { kind: "day", day: inDays(2) }));
    await run(`window.dispatchEvent(new CustomEvent("snapshot-moved", { detail: { kind: "day", day: ${JSON.stringify(inDays(2))} } }))`);
    await wait(300);
    await shot("ahead-moved");
  }
  // The toast gone (Esc), for the narrow and wide notes.
  await run(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  for (const [width, height] of [[350, 520], [560, 760]] as const) {
    note.setSize(width, height);
    await run(`document.querySelector(".sheet").scrollTop = 0`);
    await wait(300);
    await shot(`ahead-${width}`);
  }
  note.setSize(420, 560);
  // Nothing ahead: the cat and the hint.
  let removed = 0;
  calendar.clearSample();
  store.mutate((history) => { for (const item of [...history.items]) if (pageOf(item, new Date()) !== "today" && history.delete(item.id)) removed += 1; });
  await shot("ahead-empty");
  store.mutate((history) => { for (; removed > 0; removed -= 1) history.undo(); });
  note.webContents.send("note:row-command", { id: "", command: "page-today" });

  // ─── 오늘 창 ───────────────────────────────────────────────────────────────
  let restoreMany: (() => void) | undefined;
  for (const name of glanceStateNames) {
    const restore = glanceState(name);
    const window = await glance.showForSnapshot();
    await wait(700);
    await settled(window);
    console.log(`tray tooltip ${name}: ${trayTooltip()}`);
    console.log(`glance fit ${name}: ${await glanceFit(window)}`);
    await save(`glance-${name}`, window.webContents.capturePage());
    if (name === "timer") {
      focusTimer.command({ kind: "togglePause" });
      await wait(300);
      console.log(`tray tooltip timer-paused: ${trayTooltip()}`);
      await save("glance-timer-paused", window.webContents.capturePage());
    }
    if (name === "many") restoreMany = restore; else restore();
  }
  // Typing in its line: the chips.
  const window = glance.snapshotWindow!;
  await window.webContents.executeJavaScript(`(() => { const field = document.querySelector(".typed"); field.focus(); document.querySelector(".inp").classList.add("focused"); field.value = ${JSON.stringify(t("내일 3시 회의"))}; field.dispatchEvent(new Event("input")); })()`);
  await wait(300);
  await save("glance-typing", window.webContents.capturePage());
  await window.webContents.executeJavaScript(`document.querySelector(".typed").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  await wait(500);
  await save("glance-toast", window.webContents.capturePage());
  window.hide();
  restoreMany?.();
}

/**
 * Stage 4's shots (and again in night/): the focus card running (a countdown, a Pomodoro's second
 * round), time up, a break and its end, the folded list opened, a small window, the stop question,
 * the pick state, the board standing in when the note is away, the 오늘 창's card, and 완료 기록 with
 * focus time. Each card shot checks that nothing in it is cut off or overlaps.
 */
export async function focusShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<void> {
  const run = (script: string) => note.webContents.executeJavaScript(script).catch((error: Error) => console.log(`script: ${error.message}`));
  const send = (command: string, id = "") => note.webContents.send("note:row-command", { id, command });
  const cardCheck = `(() => {
    const out = [];
    const card = document.querySelector(".focus-card");
    if (!card || card.hidden) return "NO CARD";
    const r = (el) => el.getBoundingClientRect();
    for (const el of card.querySelectorAll(".fc-kicker, .fc-next, .fc-btn, .fc-rest, .fc-row-title, .fc-time")) if (!el.hidden && el.scrollWidth > el.clientWidth + 1) out.push("clipped: " + el.className + " " + el.textContent);
    const task = card.querySelector(".fc-task");
    if (task && task.scrollHeight > task.clientHeight + 2) out.push("title cut: " + task.textContent);
    const body = card.querySelector(".fc-body");
    if (body.scrollHeight > body.clientHeight + 1) out.push("card body cut (" + Math.round(body.scrollHeight - body.clientHeight) + "px)");
    const list = card.querySelector(".fc-list");
    if (list && !list.hidden && r(list).height < 60) out.push("list too short");
    const btns = [...card.querySelectorAll(".fc-btn")];
    for (let i = 0; i < btns.length; i += 1) for (let j = i + 1; j < btns.length; j += 1) { const a = r(btns[i]), b = r(btns[j]); if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.push("buttons overlap"); }
    const cat = r(card.querySelector(".fc-cat")), rest = card.querySelector(".fc-rest");
    if (rest && !rest.hidden && cat.right > r(rest).left + 0.5) out.push("cat under the rest line");
    if (r(card).right > innerWidth + 0.5 || r(card).bottom > innerHeight + 0.5) out.push("card off the window");
    for (const el of [card.querySelector(".fc-ring"), task, card.querySelector(".fc-btns")]) if (el && (r(el).left < -0.5 || r(el).right > innerWidth + 0.5)) out.push("off the side: " + el.className);
    return out.join("; ");
  })()`;
  let problems = 0;
  const shot = async (name: string, window: BrowserWindow = note) => {
    await wait(450);
    await settled(window);
    if (window === note && !name.endsWith("focus-pick")) {
      const report = await note.webContents.executeJavaScript(cardCheck).catch((error: Error) => error.message) as string;
      console.log(`focus ${name}: ${report || "ok"}`);
      if (report) problems += 1;
    }
    await save(name, window.webContents.capturePage());
  };
  // Today: the task to focus on (a long-ish title), a few others, the day's events (다음 · 15:30 치과).
  floating.hide();
  note.showInactive();
  note.setSize(420, 640);
  send("page-today");
  calendar.showSample();
  let task = store.items.find((item) => item.title === t("보고서 마무리") && !item.isCompleted);
  if (!task) store.mutate((history) => { task = history.addTo(t("보고서 마무리"), undefined, new Date()); });
  const focusId = task!.id;
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    const prefix = paper === "night" ? "night/" : "";
    if (paper === "night") fs.mkdirSync(path.join(directory, "night"), { recursive: true });
    await wait(300);
    // A countdown on the task, 12 and a half minutes in.
    focusCommand({ kind: "start", taskId: focusId, minutes: 25 });
    focusTimer.elapseForSnapshot(12.5);
    await shot(`${prefix}focus`);
    await run(`document.querySelector(".fc-rest")?.click()`);
    await shot(`${prefix}focus-expanded`);
    await run(`document.querySelector(".fc-rest")?.click()`);
    // #529: the list with the focus strip over it (the card's list button), then back by the strip.
    await run(`document.querySelector(".fc-to-list")?.click()`);
    await wait(450);
    await settled(note);
    const listed = await run(`(() => { const s = document.querySelector(".focus-strip"), c = document.querySelector(".focus-card"), l = document.querySelector(".sheet");
      if (!s || s.hidden || !c.hidden) return "NO STRIP";
      if (!l || l.getBoundingClientRect().height < 40) return "NO LIST";
      const t = s.querySelector(".fs-title"); return t.scrollWidth > t.clientWidth + 1 && t.textContent.length < 12 ? "title clipped" : ""; })()`) as string;
    console.log(`focus ${prefix}focus-list: ${listed || "ok"}`);
    if (listed) problems += 1;
    await save(`${prefix}focus-list`, note.webContents.capturePage());
    await run(`document.querySelector(".focus-strip")?.click()`);
    // Other sizes (at night the smallest only).
    for (const [width, height] of paper === "day" ? [[350, 400], [350, 520], [560, 760], [720, 1200]] as const : [[350, 400]] as const) {
      note.setSize(width, height);
      await shot(`${prefix}focus-${width}x${height}`);
    }
    note.setSize(350, 400);
    await run(`document.querySelector(".fc-rest")?.click()`);
    await shot(`${prefix}focus-350x400-expanded`);
    await run(`document.querySelector(".fc-rest")?.click()`);
    note.setSize(420, 640);
    // Time's up.
    focusTimer.finishNow();
    await shot(`${prefix}focus-time-up`);
    focusTimer.focus({ kind: "later" });
    // A Pomodoro: round 1 up, the break, the break over, round 2 under way.
    focusCommand({ kind: "start", taskId: focusId, pomodoro: true });
    focusTimer.finishNow();
    await shot(`${prefix}focus-pomodoro-time-up`);
    focusTimer.focus({ kind: "rest" });
    focusTimer.elapseForSnapshot(2);
    await shot(`${prefix}focus-break`);
    focusTimer.finishNow();
    await shot(`${prefix}focus-break-over`);
    focusTimer.focus({ kind: "nextRound" });
    focusTimer.elapseForSnapshot(9);
    await shot(`${prefix}focus-pomodoro`);
    // The note away: the board shows the task.
    note.hide();
    focusTimer.noteShown();
    await wait(900);
    console.log(`focus board: note visible ${note.isVisible()}, board ${focusTimer.capture() ? "shown" : "MISSING"}`);
    await save(`${prefix}focus-board`, focusTimer.capture());
    note.showInactive();
    focusTimer.noteShown();
    await wait(300);
    // The 오늘 창's timer card while focusing, and the tray's words.
    const glanceWindow = await glance.showForSnapshot();
    await wait(700);
    await settled(glanceWindow);
    console.log(`tray tooltip focus: ${trayTooltip()}`);
    await save(`${prefix}glance-focus`, glanceWindow.webContents.capturePage());
    glanceWindow.hide();
    // Esc: the question.
    await confirmSlip.showForSnapshot({ icon: "timer", title: t("집중"), message: t("집중을 그만둘까요?"), detail: t("지금까지 집중한 시간은 기록에 남아요."), buttons: [{ label: t("계속하기"), kind: "ghost" }, { label: t("그만두기"), kind: "primary" }], cancelId: 0 });
    await wait(800);
    await save(`${prefix}focus-confirm`, confirmSlip.capture());
    confirmSlip.hide();
    focusTimer.focus({ kind: "later" });
    await wait(300);
    // 할 일 골라 집중…: the pick state, a row as if hovered.
    send("pick-focus");
    await wait(300);
    await run(`document.querySelectorAll(".lines .row:not(.done)").forEach((row, index) => row.classList.toggle("preview-hover", index === 1))`);
    const pickReport = await run(`(() => { const row = document.querySelector(".row.preview-hover"); const b = row?.querySelector(".focus-pick"); if (!b) return "no focus button"; const r = b.getBoundingClientRect(); if (r.right > innerWidth - 4) return "focus button off the edge"; if (getComputedStyle(b).display === "none") return "focus button hidden"; const tools = document.querySelector(".tools").getBoundingClientRect(), tabs = document.querySelector(".index-tabs").getBoundingClientRect(); return tools.right > innerWidth + 0.5 ? "tools cut off after focus" : tabs.right > tools.left - 16 ? "tabs run into the tools after focus" : "ok"; })()`);
    if (pickReport !== "ok") problems += 1;
    console.log(`focus pick: ${pickReport}`);
    await shot(`${prefix}focus-pick`);
    await run(`document.querySelectorAll(".preview-hover").forEach((row) => row.classList.remove("preview-hover"))`);
    send("pick-cancel");
    // 완료 기록 with focus time.
    await showDeskPane("history", wait);
    console.log(`history focus: ${await inPane("history", `(() => { const tile = [...document.querySelectorAll(".tile")].at(-1); const top = document.querySelector(".focus-top"); return (tile ? tile.textContent : "NO TILE") + " | " + (top ? top.textContent : "NO TOP") + " | " + (document.querySelector(".day-focus")?.textContent ?? "-"); })()`)}`);
    await save(`${prefix}desk-history-focus`, captureDesk(wait));
    // The day panel on a day with focus.
    await inPane("history", `(() => { const days = [...document.querySelectorAll(".cell[data-level]:not([disabled])")]; const day = days.reverse().find((cell) => cell.getAttribute("aria-label").includes(${JSON.stringify(t("집중 {time}", { time: "" }).trim())})); day?.click(); })()`);
    await wait(400);
    await save(`${prefix}desk-history-focus-day`, captureDesk(wait));
  }
  store.setPref("paper", "day");
  console.log(problems ? `FOCUS PROBLEMS: ${problems}` : "FOCUS OK");
}

/**
 * 1.23's shots (편의 기능), day and night (night/): the 어제부터 · 3일째 tags, a row's hover with → 내일 and
 * 집중, 오늘 꼭 하나's star and question, the toasts after a delete and a move, the search slip (초성,
 * nothing found, empty), the event made from a click on the ribbon, the sleeping header cat and the
 * compact header, the reminder bubble with 내일로 and its ⌄ menu, an event's 5분 전에 다시, the 저녁 정리 and
 * 아침 정리 bubbles (one task left out; above the cat), and the quick note with copied text.
 */
export async function convenienceShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<void> {
  const run = (script: string) => note.webContents.executeJavaScript(script).catch((error: Error) => console.log(`script: ${error.message}`));
  const send = (command: string, id = "") => note.webContents.send("note:row-command", { id, command });
  const shot = async (name: string, window: BrowserWindow = note) => {
    await wait(380);
    await settled(window);
    await save(name, window.webContents.capturePage());
  };
  const daysAgo = (days: number) => dayKey(new Date(logicalDayStart(new Date()).getTime() - days * 86_400_000 + 3_600_000));
  floating.hide();
  focusTimer.command({ kind: "stop" });
  note.webContents.reload();
  note.showInactive();
  await wait(1200);
  calendar.showSample();
  openDay(false);
  // Today: two undated tasks carried over (yesterday, three days), a third picked as today's one thing.
  store.mutate((history) => {
    history.addTo(t("세탁소에 셔츠 맡기기"), undefined, new Date());
    history.addTo(t("우체국 들르기"), undefined, new Date());
    history.addTo(t("분기 보고서 초안"), undefined, new Date());
  });
  const open = () => store.items.filter((item) => !item.isCompleted && !item.dueDate && !item.seriesID && !item.reminderAt && pageOf(item, new Date()) === "today");
  const carried = open().slice(-3, -1);
  store.history.trackToday([{ id: carried[0].id, todaySince: daysAgo(1) }, { id: carried[1].id, todaySince: daysAgo(2) }]);
  store.changed();
  const starred = open()[0];
  const query = lang() === "ko" ? "ㅂㄱㅅ" : lang() === "en" ? "report" : "verslag";
  const menuChoices = (kind: "task" | "periodic") => snoozeChoices(new Date(), kind, lang()).map((choice) => ({ id: choice.id, title: choice.title, ...(choice.at ? { at: choice.at.toISOString() } : {}) }));
  console.log(`menu row (today): ${(() => {
    const items = rowMenu(carried[0].id).items.filter((item) => item.type !== "separator");
    return items.map((item) => (item.submenu ? `${item.label} [${item.submenu.items.map((entry) => entry.label).join(" | ")}]` : item.label)).join(" | ");
  })()}`);
  let problems = 0;
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    const prefix = paper === "night" ? "night/" : "";
    if (paper === "night") fs.mkdirSync(path.join(directory, "night"), { recursive: true });
    note.setSize(420, 640);
    send("page-today");
    await wait(400);
    // The tags, and a carried row hovered: → 내일, ↓ 언젠가, 집중, the bell, the trash.
    await run(`document.querySelector(".sheet").scrollTop = 1e6`);
    await shot(`${prefix}conv-carry`);
    const hoverReport = await run(`(() => {
      const rows = [...document.querySelectorAll(".lines .row")];
      const row = rows.find((element) => element.querySelector(".carry:not([hidden])"));
      if (!row) return "NO CARRIED ROW";
      row.classList.add("preview-hover");
      const out = [];
      const label = row.querySelector(".label").getBoundingClientRect(), actions = row.querySelector(".actions").getBoundingClientRect();
      if (actions.right > innerWidth - 4) out.push("actions off the edge");
      if (label.width < 40) out.push("title squeezed to " + Math.round(label.width) + "px");
      for (const move of row.querySelectorAll(".move:not([hidden])")) if (move.scrollWidth > move.clientWidth + 1) out.push("pill clipped: " + move.textContent);
      return out.join("; ") || "ok";
    })()`) as string;
    console.log(`conv ${prefix}row hover 420: ${hoverReport}`);
    if (hoverReport !== "ok") problems += 1;
    await shot(`${prefix}conv-row-hover`);
    note.setSize(350, 560);
    await wait(300);
    await run(`document.querySelector(".row.preview-hover")?.scrollIntoView({ block: "center" })`);
    const narrow = await run(`(() => { const row = document.querySelector(".row.preview-hover"); if (!row) return "gone"; const label = row.querySelector(".label").getBoundingClientRect(); const actions = row.querySelector(".actions").getBoundingClientRect(); return actions.right > innerWidth - 4 ? "actions off the edge" : label.width < 24 ? "title squeezed to " + Math.round(label.width) + "px" : "ok"; })()`) as string;
    console.log(`conv ${prefix}row hover 350: ${narrow}`);
    if (narrow !== "ok") problems += 1;
    await shot(`${prefix}conv-row-hover-350`);
    await run(`document.querySelectorAll(".preview-hover").forEach((row) => row.classList.remove("preview-hover"))`);
    note.setSize(420, 640);
    // 오늘 꼭 하나: the question in the empty line, then the star on top of 다음.
    store.setPref("morningPick", true);
    store.setPref("morningPickDay", dayKey(new Date()));
    store.setPref("starredTask", "");
    send("morning-pick");
    await shot(`${prefix}conv-morning-pick`);
    send("morning-pick-off");
    store.setPref("starredTask", starred.id);
    await shot(`${prefix}conv-star`);
    store.setPref("starredTask", "");
    store.setPref("morningPick", false);
    // The toasts: a delete, a move to tomorrow, 모두 끝냄.
    for (const [name, notice] of [["deleted", { icon: "trash", text: t("할 일을 지웠어요"), undo: "history" }], ["tomorrow", { icon: "calendar", text: movedTomorrowText(lang()), undo: "history" }], ["all-done", { icon: "check", text: t("{n}개 끝냈어요", { n: 3 }), undo: "history" }]] as const) {
      note.webContents.send("note:notice", notice);
      await shot(`${prefix}conv-toast-${name}`);
    }
    await run(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    // 검색: 초성 (or a word), nothing found, the empty slip's hint.
    for (const [name, text] of [["search", query], ["search-none", t("고양이 밥")], ["search-empty", ""]] as const) {
      await run(`window.showSearch(); document.querySelector(".search-slip") && window.showSearch().set(${JSON.stringify(text)})`);
      await wait(300);
      const report = await run(`(() => {
        const card = document.querySelector(".search-slip");
        if (!card) return "NO SLIP";
        const r = card.getBoundingClientRect(), out = [];
        if (r.top < 0 || r.bottom > innerHeight + 0.5 || r.left < 0 || r.right > innerWidth + 0.5) out.push("slip off the note");
        for (const row of card.querySelectorAll(".search-row")) { const text = row.querySelector(".search-text").getBoundingClientRect(), meta = row.querySelector(".search-meta")?.getBoundingClientRect(); if (meta && text.right > meta.left + 0.5) out.push("text under the date"); }
        return (out.join("; ") || "ok") + " · " + [...card.querySelectorAll(".search-head")].map((head) => head.textContent).join(" / ") + " · " + [...card.querySelectorAll("mark")].slice(0, 3).map((mark) => mark.textContent).join(",");
      })()`) as string;
      console.log(`conv ${prefix}${name}: ${report}`);
      if (!report.startsWith("ok")) problems += 1;
      await shot(`${prefix}conv-${name}`);
      await run(`document.querySelector(".search-field")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    }
    // (1.25) A double click on the open day's empty space: the new-event slip at that time.
    openDay(true);
    await wait(500);
    await run(`(() => { const grid = document.querySelector(".tt-grid"); const list = document.querySelector(".tt-scroll"); if (!grid || !list) return; list.scrollTop = (19 - 8) * 50; const r = grid.getBoundingClientRect(); grid.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: r.left + 200, clientY: r.top + 8 + (20.25 - 8) * 50 })); })()`);
    await wait(500);
    console.log(`conv ${prefix}ribbon click: ${await run(`[...document.querySelectorAll(".event-sheet .sheet-chip")].map((chip) => chip.textContent).join(" · ") || "NO SHEET"`)}`);
    await shot(`${prefix}conv-ribbon-new-event`);
    send("close-editor");
    openDay(false);
    await wait(200);
    // The sleeping cat in the header (11 p.m.–5 a.m.), and the compact header of a short note.
    await run(`window.catSleeps = true; window.dispatchEvent(new Event("ribbon-now"))`);
    await wait(300);
    const head = await Promise.race([note.webContents.capturePage({ x: 0, y: 0, width: 420, height: 130 }).catch(() => undefined), wait(3000).then(() => undefined)]);
    if (head) await save(`${prefix}conv-header-sleeping`, Promise.resolve(head));
    note.setSize(350, 400);
    await shot(`${prefix}conv-compact-sleeping`);
    await run(`window.catSleeps = undefined; window.dispatchEvent(new Event("ribbon-now"))`);
    await shot(`${prefix}conv-compact`);
    note.setSize(420, 460);
    await shot(`${prefix}conv-compact-420x460`);
    note.setSize(420, 640);

    // The reminder bubble: a task alert with 내일로, its ⌄ menu open; an event's 5분 전에 다시.
    store.setPref("petVisible", false);
    store.setPref("reminderStyle", "paper");
    const tasks = open().slice(0, 2).map((item) => ({ id: item.id, title: item.title, scheduledAt: new Date().toISOString() }));
    const handlers = { onComplete: () => undefined, onSnooze: () => undefined, onOpen: () => undefined };
    taskPopup.show({ tasks, scheduled: true, preview: true, canComplete: true, style: "paper", font: store.prefs.font, durationMs: 0, snoozeEnabled: true, reduceMotion: false, snoozeChoices: menuChoices("task"), tomorrow: true }, handlers);
    await wait(3000);
    await save(`${prefix}conv-reminder-task`, taskPopup.capture());
    const bubble = taskPopup.snapshotWindow!;
    await bubble.webContents.executeJavaScript(`document.querySelector(".split > button:last-child")?.click()`);
    await wait(700);
    console.log(`conv ${prefix}snooze menu: ${await bubble.webContents.executeJavaScript(`(() => { const menu = document.querySelector(".pop-menu"); if (!menu) return "NO MENU"; const r = menu.getBoundingClientRect(); return (r.top < 0 ? "MENU CUT OFF " : "") + [...menu.querySelectorAll("button")].map((b) => b.textContent).join(" | "); })()`)}`);
    await save(`${prefix}conv-reminder-snooze-menu`, taskPopup.capture());
    taskPopup.hide();
    await wait(200);
    const later = calendar.showSample().find((event) => event.title === t("치과 정기 검진")) ?? calendar.showSample()[2];
    calendar.previewAlert(later);
    await wait(3000);
    await save(`${prefix}conv-reminder-event-again`, taskPopup.capture());
    taskPopup.hide();
    // 저녁 정리 and 아침 정리 (a task left out), then above the cat.
    sweep.preview("evening");
    await wait(3000);
    await save(`${prefix}conv-sweep-evening`, periodicPopup.capture());
    await periodicPopup.snapshotWindow!.webContents.executeJavaScript(`document.querySelectorAll(".sweep-rows .check")[1]?.click()`);
    await wait(300);
    await save(`${prefix}conv-sweep-evening-untick`, periodicPopup.capture());
    periodicPopup.hide();
    await wait(200);
    sweep.preview("morning");
    await wait(3000);
    await save(`${prefix}conv-sweep-morning`, periodicPopup.capture());
    periodicPopup.hide();
    store.setPref("petVisible", true);
    await wait(900);
    sweep.preview("evening");
    await wait(1200);
    await save(`${prefix}conv-sweep-on-pet`, periodicPopup.capture());
    periodicPopup.hide();
    store.setPref("reminderStyle", "character");
    // The welcome tour's last card the first time through: 컴퓨터를 켤 때 같이 열기 on.
    store.setPref("guideSeen", false);
    store.setPref("openAtLogin", false);
    note.setSize(420, 560);
    send("guide");
    await wait(400);
    for (let step = 0; step < 4; step += 1) await run(`document.querySelector(".guide .next")?.click()`);
    await wait(400);
    console.log(`conv ${prefix}guide login switch: ${await run(`document.querySelector(".guide-login .switch")?.getAttribute("aria-checked") ?? "NO SWITCH"`)}`);
    await shot(`${prefix}conv-guide-login`);
    await run(`document.querySelector(".guide .next")?.click()`);
    await wait(200);
    store.setPref("guideSeen", true);
    store.setPref("openAtLogin", false);
    note.setSize(420, 640);
    // The quick note with copied text put in (selected).
    await quickMemo.showForSnapshot(t("회의실 예약 번호 4417, 3층 왼쪽 끝"), true);
    await wait(800);
    await save(`${prefix}conv-quick-memo-copied`, quickMemo.capture());
    quickMemo.hide();
  }
  store.setPref("paper", "day");
  console.log(problems ? `CONVENIENCE PROBLEMS: ${problems}` : "CONVENIENCE OK");
}

/**
 * #191: a scene drawn at a fixed moment (`window.ribbonNow`) keeps the run's earlier sample reminders — an hour or two
 * from the real clock — at fixed times of that day meanwhile (21:30, 21:40 …, as the Mac's 하루 띠 shots keep the demo
 * list's reminder at 21:30), so they don't land somewhere else on the day each time it's drawn. Returns the step that
 * puts them back.
 */
export function pinSampleReminders(dayStart: Date): () => void {
  const kept = store.items.filter((item) => item.reminderAt && !item.isCompleted).map((item) => [item.id, item.reminderAt!] as const);
  store.mutate((history) => kept.forEach(([id], index) => history.setReminder(id, new Date(dayStart.getTime() + (21 - 4) * 3_600_000 + (30 + index * 10) * 60_000))));
  return () => store.mutate((history) => { for (const [id, at] of kept) history.setReminder(id, new Date(at)); });
}

/**
 * 1.24's shots, day and night: the ribbon with task blocks (beside events, two lanes, done, over, a start alone;
 * hovered; a narrow note), rows with their hours, the editor's 시간 with its time list open, the line reading
 * "3시부터 5시까지 보고서", 앞으로 and the desk's week and day panel with a ranged task, the alarm editor's
 * 다시 알림 없음 and a ring without snooze. Each is checked like the size sweep; returns the problems found.
 */
export async function timeblockShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
  const run = (script: string) => note.webContents.executeJavaScript(script).catch((error: Error) => `script failed: ${error.message}`);
  const send = (command: string, id = "") => note.webContents.send("note:row-command", { id, command });
  let problems = 0;
  const check = async (name: string, window: BrowserWindow = note) => {
    await wait(380);
    await settled(window);
    if (window === note) {
      const report = await note.webContents.executeJavaScript(layoutCheckScript(noteLayoutChecks)).catch((error: Error) => ({ problems: [`check failed: ${error.message}`], truncated: [] })) as LayoutReport;
      console.log(`timeblock ${name}: ${report.problems.length ? report.problems.join("; ") : "ok"}`);
      problems += report.problems.length;
    }
    await save(name, window.webContents.capturePage());
  };
  floating.hide();
  focusTimer.command({ kind: "stop" });
  note.webContents.reload();
  note.showInactive();
  await wait(1200);
  calendar.showSample();
  openDay(false);
  store.setPref("calendarStrip", true);
  // The ribbon at 14:50 of today's (4 a.m.) day; the tasks' hours around it.
  const dayStart = logicalDayStart(new Date());
  const today = dayKey(new Date());
  const tomorrow = dayKey(new Date(dayStart.getTime() + 30 * 3_600_000));
  const ribbonNow = new Date(dayStart.getTime() + (14 - 4) * 3_600_000 + 50 * 60_000);
  const unpin = pinSampleReminders(dayStart);
  const made: string[] = [];
  store.mutate((history) => {
    const add = (title: string, range: { start: number; end?: number }, due?: string) => { const item = history.addTo(title, undefined, new Date(), due, undefined, range); if (item) made.push(item.id); return item; };
    add(t("보고서 쓰기"), { start: 840, end: 930 });
    add(t("메일 답장"), { start: 870, end: 900 });
    const done = add(t("아침 산책"), { start: 540, end: 600 });
    if (done) history.toggle(done.id);
    add(t("견적서 보내기"), { start: 660, end: 720 });
    add(t("엄마께 전화"), { start: 1020 });
    add(t("기획 회의 준비"), { start: 600, end: 690 }, tomorrow);
  });
  const report = store.items.find((item) => item.id === made[0])!;
  // (1.25) The task blocks are in the open day now; the strip's bar draws them in sage.
  const ranges = () => run(`[...document.querySelectorAll(".tt-block.task")].map((b) => (b.getAttribute("aria-label") ?? "") + (b.classList.contains("done") ? " [done]" : "") + (b.classList.contains("late") ? " [late]" : "")).join(" | ")`);
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    const prefix = paper === "night" ? "night/" : "";
    if (paper === "night") fs.mkdirSync(path.join(directory, "night"), { recursive: true });
    note.setSize(420, 640);
    send("page-today");
    await run(`window.ribbonNow = ${JSON.stringify(ribbonNow.toISOString())}; window.dispatchEvent(new Event("ribbon-now")); document.querySelector(".sheet").scrollTop = 0`);
    await wait(400);
    console.log(`timeblock ${prefix}strip: ${await run(`document.querySelectorAll(".strip-bar .task").length + " sage segments · " + document.querySelector(".strip")?.getAttribute("aria-label")`)}`);
    await check(`${prefix}tb-ribbon`);
    openDay(true);
    await wait(500);
    console.log(`timeblock ${prefix}blocks: ${await ranges()}`);
    await check(`${prefix}tb-ribbon-hover`);
    openDay(false);
    await wait(300);
    // The rows: the clock and the hours in place of the bell's time.
    console.log(`timeblock ${prefix}row meta: ${await run(`[...document.querySelectorAll(".lines .row .time.ranged")].map((time) => time.textContent).join(" | ")`)}`);
    // (The ranged rows sit in 다음, at the top: the ribbon stays in view.)
    await run(`document.querySelector(".sheet").scrollTop = 0`);
    await check(`${prefix}tb-rows`);
    note.setSize(350, 560);
    await run(`document.querySelector(".sheet").scrollTop = 0`);
    await check(`${prefix}tb-ribbon-350`);
    note.setSize(420, 640);
    // The editor's 시간, then its start list open.
    send("time", report.id);
    await wait(400);
    console.log(`timeblock ${prefix}editor: ${await run(`[...document.querySelectorAll(".editor .seg button, .editor .time-line .chip, .editor .range-length, .editor .pinned .when, .editor .pinned .hint")].map((element) => element.textContent).join(" | ")`)}`);
    await check(`${prefix}tb-editor`);
    await run(`document.querySelector(".editor .time-line .chip")?.click()`);
    await check(`${prefix}tb-editor-list`);
    send("close-editor");
    await run(`document.querySelectorAll(".sheet-pop, .pop-scrim").forEach((element) => element.remove())`);
    await wait(200);
    // The line reading a range: the to-do with its hours first, the event with the same hours next.
    const ranged = lang() === "ko" ? "3시부터 5시까지 보고서" : lang() === "en" ? "report 3-5pm" : "verslag van 3 tot 5 uur"; // i18n-ok
    await run(`(() => { const field = document.querySelector(".dock textarea.typed"); field.focus(); field.value = ${JSON.stringify(ranged)}; field.dispatchEvent(new Event("input")); })()`);
    console.log(`timeblock ${prefix}chips: ${await run(`[...document.querySelectorAll(".dock .chip")].map((chip) => chip.textContent).join(" | ")`)}`);
    await check(`${prefix}tb-chips`);
    await run(`(() => { const field = document.querySelector(".dock textarea.typed"); field.value = ""; field.dispatchEvent(new Event("input")); field.blur(); })()`);
    // 오늘 창: the tasks with their hours.
    const glanceWindow = await glance.showForSnapshot();
    await wait(700);
    await settled(glanceWindow);
    console.log(`timeblock ${prefix}glance: ${await glanceWindow.webContents.executeJavaScript(`[...document.querySelectorAll(".g-row")].map((row) => row.textContent).join(" | ")`).catch(() => "NO GLANCE")}`);
    await save(`${prefix}tb-glance`, glanceWindow.webContents.capturePage());
    glance.hide();
    // 앞으로: tomorrow's ranged task in its day.
    send("page-ahead");
    await wait(400);
    console.log(`timeblock ${prefix}ahead: ${await run(`[...document.querySelectorAll(".ahead .row .time.ranged")].map((time) => time.closest(".row").querySelector(".label").textContent + " " + time.textContent).join(" | ")`)}`);
    await check(`${prefix}tb-ahead`);
    send("page-today");
    // The desk: the week (tomorrow's outlined line) and the day panel of today.
    await showDeskPane("calendar", wait, { day: today });
    await inPane("calendar", `document.querySelector('.view-seg button')?.click()`);
    await wait(500);
    console.log(`timeblock ${prefix}week: ${await inPane("calendar", `[...document.querySelectorAll(".line.task.range")].map((line) => line.textContent).join(" | ")`)} · panel: ${await inPane("calendar", `[...document.querySelectorAll(".task-row.range")].map((row) => row.textContent).join(" | ")`)}`);
    await save(`${prefix}tb-desk-week`, captureDesk(wait));
    await inPane("calendar", `[...document.querySelectorAll('.view-seg button')].at(-1)?.click()`);
    await wait(400);
    await save(`${prefix}tb-desk-month`, captureDesk(wait));
    // 다시 알림 없음: the editor's choice and a ring with only 끄기.
    const alarm = store.alarms[0];
    if (alarm) {
      store.putAlarm({ ...alarm, snooze: 0 });
      await showDeskPane("clock", wait);
      await inPane("settings", `window.editAlarm(0); document.querySelector(".alarm-editor")?.scrollIntoView({ block: "nearest" })`);
      await wait(400);
      console.log(`timeblock ${prefix}alarm snooze: ${await inPane("settings", `[...document.querySelectorAll(".alarm-editor .segmented")].at(-1)?.textContent + " · on " + document.querySelector('.alarm-editor .segmented:last-of-type [aria-checked="true"]')?.textContent`)}`);
      await save(`${prefix}tb-alarm-editor`, captureDesk(wait));
      await inPane("settings", `document.querySelector(".alarm-editor")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
      await alarmClock.showForSnapshot({ ...alarm, snooze: 0 }, 1);
      await wait(1200);
      console.log(`timeblock ${prefix}ring: ${await alarmClock.snapshotWindow?.webContents.executeJavaScript(`(document.querySelector(".snz")?.hidden ? "no snooze row" : "SNOOZE ROW SHOWN") + " · " + [...document.querySelectorAll(".acts button")].map((b) => b.textContent).join(" | ")`).catch(() => "NO RING")}`);
      await save(`${prefix}tb-ring-no-snooze`, alarmClock.capture());
      alarmClock.hideSnapshot?.();
      store.putAlarm(alarm);
    }
  }
  store.setPref("paper", "day");
  await run(`window.ribbonNow = undefined; window.dispatchEvent(new Event("ribbon-now"))`);
  store.mutate((history) => { for (const id of made) history.delete(id); });
  unpin();
  console.log(problems ? `TIMEBLOCK PROBLEMS: ${problems}` : "TIMEBLOCK OK");
  return problems;
}

/** Snapshots: a real mouse on the note (CSS px of the page at zoom 1): a move — with the left button held when `held` —, a press or a release. */
function noteMouse(type: "mouseMove" | "mouseDown" | "mouseUp", x: number, y: number, held = false): void {
  note.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: "left", clickCount: 1, ...(held ? { modifiers: ["leftButtonDown"] } : {}) } as Electron.MouseInputEvent);
}

/**
 * Snapshots: a point on the open day's block titled `title` — in its top band, its middle or its bottom band. `place`:
 * the timetable is first scrolled so the block sits at its top (room to stretch the bottom) or in its middle, away
 * from the edges where a held drag would scroll it.
 */
function blockPoint(title: string, where: "top" | "middle" | "bottom", place?: "top" | "middle"): Promise<{ x: number; y: number } | undefined> {
  return note.webContents.executeJavaScript(`(() => {
    const block = [...document.querySelectorAll(".tt-block")].find((element) => element.querySelector(".tb-hand, .tb-title")?.textContent === ${JSON.stringify(title)});
    if (!block) return undefined;
    const scroller = block.closest(".tt-scroll");
    scroller.scrollIntoView({ block: "nearest" });
    if (${JSON.stringify(place ?? "")} === "top") scroller.scrollTop = block.offsetTop - 8;
    else if (${JSON.stringify(place ?? "")} === "middle") scroller.scrollTop = block.offsetTop - (scroller.clientHeight - block.offsetHeight) / 2;
    else block.scrollIntoView({ block: "nearest" });
    const box = block.getBoundingClientRect();
    return { x: box.left + box.width / 2, y: ${JSON.stringify(where)} === "top" ? box.top + 2 : ${JSON.stringify(where)} === "bottom" ? box.bottom - 2 : (box.top + box.bottom) / 2 };
  })()`).catch(() => undefined) as Promise<{ x: number; y: number } | undefined>;
}

/** Snapshots: a press on that block's `where`, dragged `dy` px in small steps and held there; where it was pressed. */
/** Snapshots: a held drag put back — Esc, then the button let go (nothing changes). */
export async function cancelDrag(at: { x: number; y: number }, wait: Wait): Promise<void> {
  note.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  note.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await wait(60);
  noteMouse("mouseUp", at.x, at.y);
  noteMouse("mouseMove", 2, 2);
  await wait(300);
}

export async function dragBlock(title: string, where: "top" | "middle" | "bottom", dy: number, wait: Wait, place?: "top" | "middle"): Promise<{ x: number; y: number } | undefined> {
  const from = await blockPoint(title, where, place);
  if (!from) return undefined;
  noteMouse("mouseMove", from.x, from.y);
  await wait(60);
  noteMouse("mouseDown", from.x, from.y);
  for (let moved = 0; Math.abs(moved) < Math.abs(dy); moved += Math.sign(dy) * 2) {
    noteMouse("mouseMove", from.x, from.y + moved, true);
    await wait(8);
  }
  noteMouse("mouseMove", from.x, from.y + dy, true);
  await wait(200);
  return from;
}

/**
 * 1.25's shots, day and night: the 하루 띠 in each of its states (something on now — an event, a to-do —, nothing on with
 * the next soon or far off, nothing left, all-day pills with +N, a long title, narrow with one row, tall with three) and
 * the day opened (scrolled to an hour before now, crowded hours side by side with +N, done and late to-dos, reminders, a
 * block picked, the little line a click opens, narrow and tall); then the timer board's width at several times, which
 * must not change within a form. Each note shot is checked like the size sweep; returns the problems found.
 */
export async function stripShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
  const run = (script: string) => note.webContents.executeJavaScript(script).catch((error: Error) => `script failed: ${error.message}`);
  const send = (command: string, id = "") => note.webContents.send("note:row-command", { id, command });
  let problems = 0;
  const check = async (name: string) => {
    await wait(420);
    await settled(note);
    const report = await note.webContents.executeJavaScript(layoutCheckScript(noteLayoutChecks)).catch((error: Error) => ({ problems: [`check failed: ${error.message}`], truncated: [] })) as LayoutReport;
    const said = await run(`(() => { const strip = document.querySelector(".strip"); if (!strip) return "NO STRIP"; return (strip.classList.contains("open") ? "[open] " : "") + strip.getAttribute("aria-label"); })()`);
    console.log(`strip ${name}: ${report.problems.length ? report.problems.join("; ") : "ok"} · ${said}`);
    if (report.truncated.length) console.log(`  … truncated: ${report.truncated.join(" · ")}`);
    problems += report.problems.length;
    await save(name, note.webContents.capturePage());
  };
  floating.hide();
  focusTimer.command({ kind: "stop" });
  note.webContents.reload();
  note.showInactive();
  await wait(1200);
  store.setPref("calendarStrip", true);
  openDay(false);
  // The day of the mock: events and to-dos at fixed hours of today's (4 a.m.) day; the list's own tasks step aside.
  const dayStart = logicalDayStart(new Date());
  const today = dayKey(new Date());
  const at = (hour: number, minute = 0) => new Date(dayStart.getTime() + (hour - 4) * 3_600_000 + minute * 60_000);
  const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  let count = 0;
  const event = (title: string, start: number, end: number, color: EventColor, location?: string, allDay = false): LocalEvent => ({
    id: `STRIP-${String(++count).padStart(4, "0")}`, title, date: today, allDay, days: 1, start, end, repeat: "none", skip: [], color,
    ...(location ? { location } : {}), createdAt: stamp, updatedAt: stamp,
  });
  const baseEvents = [
    event(t("엄마 생신"), 540, 600, "yellow", undefined, true),
    event(t("주간 회의"), 540, 600, "sage", t("회의실 A")),
    event(t("디자인 리뷰"), 780, 840, "sage", t("회의실 B")),
    event(t("치과 정기 검진"), 930, 990, "blue", t("동네 치과")),
    event(t("요가"), 1140, 1200, "purple"),
  ];
  const kept = store.items.map((item) => ({ ...item }));
  store.mutate((history) => { for (const item of [...history.items]) history.delete(item.id); });
  const made: Record<string, string> = {};
  const add = (key: string, title: string, range?: { start: number; end?: number }, reminder?: Date) => {
    store.mutate((history) => { const item = history.addTo(title, undefined, new Date(), undefined, reminder?.toISOString(), range); if (item) made[key] = item.id; });
  };
  add("report", t("보고서 마무리"), { start: 840, end: 930 }, at(14));
  add("water", t("물 마시기"), undefined, at(16));
  add("shop", t("장보기"), { start: 1020 });
  for (const title of [t("주간 회고 쓰기"), t("여행 계획 세우기")]) add(title, title);
  store.replaceEvents(baseEvents);
  const moment = async (hour: number, minute = 0) => {
    await run(`window.ribbonNow = ${JSON.stringify(at(hour, minute).toISOString())}; window.dispatchEvent(new Event("ribbon-now")); document.querySelector(".sheet").scrollTop = 0`);
    await wait(250);
  };
  const timerWidths = async (prefix: string) => {
    // The board at several times of each form: as wide at 10:00 as at 09:59, 01:11, 00:08 and 59:59; at 1:00:00 as at 9:59:59.
    focusTimer.command({ kind: "countdown", minutes: 61 });
    await wait(1200);
    const window = focusTimer.snapshotWindow;
    if (!window) { console.log("strip timer: NO BOARD"); problems += 1; return; }
    for (const size of ["regular", "extraLarge"] as const) {
      store.setPref("timerSize", size);
      await wait(500);
      const minutes = await window.webContents.executeJavaScript(`window.boardWidths(["10:00", "09:59", "01:11", "00:08", "59:59"])`).catch(() => []) as number[];
      const hours = await window.webContents.executeJavaScript(`window.boardWidths(["1:00:00", "1:11:11", "9:59:59"])`).catch(() => []) as number[];
      const same = (widths: number[]) => widths.length > 0 && widths.every((width) => Math.abs(width - widths[0]) < 0.01);
      console.log(`strip ${prefix}timer ${size}: mm:ss ${minutes.map((width) => width.toFixed(2)).join(" ")} · h:mm:ss ${hours.map((width) => width.toFixed(2)).join(" ")}`);
      if (!same(minutes) || !same(hours)) { console.log(`strip ${prefix}timer ${size}: WIDTH CHANGES`); problems += 1; }
    }
    store.setPref("timerSize", "regular");
    await wait(500);
    await save(`${prefix}strip-timer-hour`, focusTimer.capture());
    focusTimer.elapseForSnapshot(2.2);
    await wait(1200);
    await save(`${prefix}strip-timer-minutes`, focusTimer.capture());
    focusTimer.command({ kind: "stop" });
    await wait(300);
  };
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    const prefix = paper === "night" ? "night/" : "";
    if (paper === "night") fs.mkdirSync(path.join(directory, "night"), { recursive: true });
    note.setSize(420, 640);
    send("page-today");
    store.replaceEvents(baseEvents);
    // The strip's states.
    await moment(13, 20);
    await check(`${prefix}strip-now-event`);
    await moment(14, 20);
    await check(`${prefix}strip-now-task`);
    await moment(12, 40);
    await check(`${prefix}strip-next-soon`);
    await moment(10, 30);
    await check(`${prefix}strip-next-far`);
    await moment(20, 30);
    await check(`${prefix}strip-nothing-left`);
    // All-day pills and +N; then a long title going on now.
    store.replaceEvents([...baseEvents, event(t("부산 출장"), 540, 600, "purple", undefined, true), event(t("팀 워크숍"), 540, 600, "sage", undefined, true)]);
    await moment(13, 20);
    await check(`${prefix}strip-allday-more`);
    note.setSize(350, 560);
    await check(`${prefix}strip-allday-narrow`);
    note.setSize(420, 640);
    store.replaceEvents(baseEvents);
    add("long", t("다음 주 월요일 팀 회의 전까지 분기 보고서 초안을 정리해서 공유 폴더에 올리기"), { start: 785, end: 870 });
    await moment(13, 20);
    await check(`${prefix}strip-long-title`);
    store.mutate((history) => history.delete(made.long));
    // Narrow (one row, the short link) and tall (three rows).
    note.setSize(350, 560);
    await moment(13, 20);
    await check(`${prefix}strip-350`);
    note.setSize(560, 800);
    await moment(13, 20);
    await check(`${prefix}strip-560x800`);
    note.setSize(420, 640);
    // The day opened, an hour before now at the top.
    await moment(13, 20);
    openDay(true);
    await wait(500);
    await check(`${prefix}strip-day`);
    // 1.26, with real mouse events: the top band hovered (its grab bar), a block mid-drag (it follows the pointer, the
    // dashed outline where it lands, the new time on it), its top and its bottom mid-stretch, then let go (the toast).
    const report = t("보고서 마무리");
    const hover = await blockPoint(report, "top");
    if (hover) { noteMouse("mouseMove", hover.x, hover.y); await wait(200); }
    await check(`${prefix}strip-day-edge-hover`);
    for (const [name, where, dy] of [["strip-day-drag", "middle", 40], ["strip-day-stretch-top", "top", -30], ["strip-day-stretch-bottom", "bottom", 20]] as const) {
      const from = await dragBlock(report, where, dy, wait);
      console.log(`strip ${prefix}${name}: ${await run(`[document.querySelector(".tt-block.dragging .tb-drag")?.textContent ?? "NO LABEL", document.querySelector(".tt-ghost") ? "ghost" : "NO GHOST"].join(" · ")`)}`);
      await check(`${prefix}${name}`);
      if (!from) { problems += 1; continue; }
      if (name === "strip-day-stretch-bottom") {
        noteMouse("mouseUp", from.x, from.y + dy);
        noteMouse("mouseMove", 2, 2);
        await wait(500);
        console.log(`strip ${prefix}strip-day-dropped: ${await run(`document.querySelector(".toast")?.textContent ?? "NO TOAST"`)}`);
        await check(`${prefix}strip-day-dropped`);
        await run(`document.querySelector(".toast .toast-act")?.click()`); // 되돌리기
        await wait(400);
      } else await cancelDrag(from, wait);
    }
    noteMouse("mouseMove", 2, 2);
    // A crowded hour (side by side, +N), a done and a late to-do, reminders; now 14:20.
    store.replaceEvents([...baseEvents, event(t("점심 약속"), 720, 810, "blue", t("회사 앞 김밥집"))]);
    add("walk", t("아침 산책"), { start: 540, end: 570 });
    store.mutate((history) => history.toggle(made.walk));
    add("quote", t("견적서 보내기"), { start: 660, end: 720 });
    add("mail", t("메일 답장"), { start: 795, end: 825 });
    add("prep", t("기획 회의 준비"), { start: 810, end: 870 });
    add("call", t("엄마께 전화"), undefined, at(13, 20));
    await moment(14, 20);
    await run(`document.querySelector(".tt-scroll").scrollTop = ${(11 - 8) * 50}`);
    await check(`${prefix}strip-day-crowded`);
    await run(`document.querySelector(".tt-scroll").scrollTop = 0`);
    await check(`${prefix}strip-day-morning`);
    // A block picked with ↓, then the +N list, then the little line a click opens.
    await run(`(() => { const list = document.querySelector(".tt-scroll"); list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); list.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); })()`);
    await check(`${prefix}strip-day-picked`);
    await run(`document.querySelector(".tt-more")?.click()`);
    console.log(`strip ${prefix}more: ${await run(`[...document.querySelectorAll(".tt-more-list button")].map((row) => row.textContent).join(" | ") || "NO LIST"`)}`);
    await check(`${prefix}strip-day-more`);
    await run(`document.querySelector(".tt-scrim")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
    await run(`(() => { const list = document.querySelector(".tt-scroll"); list.scrollTop = (15 - 8) * 50; const grid = document.querySelector(".tt-grid"); const r = grid.getBoundingClientRect(); grid.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: r.left + 200, clientY: r.top + 8 + (16.5 - 8) * 50 + 10 })); })()`);
    await wait(400);
    await run(`(() => { const field = document.querySelector(".ttn-field"); if (field) { field.value = ${JSON.stringify(t("점심 약속"))}; field.dispatchEvent(new Event("input")); } })()`);
    console.log(`strip ${prefix}new item: ${await run(`[document.querySelector(".ttn-when")?.textContent, ...[...document.querySelectorAll(".ttn-chip")].map((chip) => chip.textContent + (chip.classList.contains("on") ? "*" : ""))].join(" | ") || "NO LINE"`)}`);
    await check(`${prefix}strip-day-new`);
    await run(`document.querySelector(".tt-scrim")?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))`);
    // Narrow and tall.
    note.setSize(350, 560);
    await moment(14, 20);
    await check(`${prefix}strip-day-350`);
    note.setSize(720, 1200);
    await moment(14, 20);
    await check(`${prefix}strip-day-720x1200`);
    note.setSize(420, 640);
    openDay(false);
    for (const key of ["walk", "quote", "mail", "prep", "call"]) store.mutate((history) => history.delete(made[key]));
    await timerWidths(prefix);
  }
  store.setPref("paper", "day");
  await run(`window.ribbonNow = undefined; window.dispatchEvent(new Event("ribbon-now"))`);
  store.mutate((history) => { for (const item of [...history.items]) history.delete(item.id); history.restore(kept); });
  calendar.showSample();
  note.setSize(420, 560);
  console.log(problems ? `STRIP PROBLEMS: ${problems}` : "STRIP OK");
  return problems;
}

/**
 * 종이 테마 열다섯 가지 (#244): in Korean, each paper's notepad, desk calendar (month) and drawer (노트와 같은 종이), by day;
 * a light paper at night (크라프트지 → 밤하늘, and 그대로); in every language, 꾸미기 → 종이 with a light and a dark paper
 * picked (밤에는 dimmed) and 메모 서랍 → 서랍 종이 with 노트와 같은 종이 off. Checks that no tile name or row is cut.
 */
export async function paperShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  fs.mkdirSync(path.join(directory, "papers"), { recursive: true });
  const korean = lang() === "ko";
  const choose = async (paper: PaperKind, dayNight: PaperSetting = "day", night: NightChoice = "night") => {
    store.setPref("paper", dayNight);
    store.setPref("paperTheme", paper);
    store.setPref("paperNight", night);
    await wait(450);
  };
  const tileCheck = `(() => {
    const out = [];
    for (const name of document.querySelectorAll(".pt-name, .pt-head, .row.paper-night .grow div")) if (name.scrollWidth > name.clientWidth + 1 || name.scrollHeight > name.clientHeight + 1) out.push("cut: " + name.textContent);
    const tiles = [...document.querySelectorAll(".paper-tiles .paper-tile")];
    const group = document.querySelector(".paper-tiles");
    if (group && group.getAttribute("role") !== "radiogroup") out.push("not one radio group");
    if (tiles.length && tiles.length !== 15) out.push(tiles.length + " tiles");
    if (tiles.filter((tile) => tile.getAttribute("aria-checked") === "true").length > 1) out.push("more than one picked");
    return (out.join("; ") || "ok") + " · " + tiles.filter((tile) => tile.getAttribute("aria-checked") === "true").map((tile) => tile.getAttribute("aria-label")).join("");
  })()`;
  const settingsShot = async (name: string, pane: DeskPane, selector: string) => {
    await showDeskPane(pane, wait);
    await inPane("settings", `document.querySelector(${JSON.stringify(selector)})?.closest(".group")?.scrollIntoView({ block: "start" })`);
    await wait(300);
    await inPane("settings", settledScript);
    const report = await inPane("settings", tileCheck) as string;
    if (!report.startsWith("ok")) problems += 1;
    console.log(`papers ${name}: ${report}`);
    await save(`papers/${name}`, captureDesk(wait));
  };
  // The galleries, in this run's language.
  await choose("memo");
  await settingsShot("settings-paper-light", "appearance", ".paper-tiles");
  await choose("chalk");
  await settingsShot("settings-paper-dark", "appearance", ".paper-tiles");
  await choose("day");
  store.setPref("drawerSameAsNote", true);
  await settingsShot("settings-drawer-same", "drawer", ".drawer-same");
  store.setPref("drawerSameAsNote", false);
  store.setPref("drawerTheme", "lined");
  await settingsShot("settings-drawer-own", "drawer", ".paper-tiles");
  store.setPref("drawerSameAsNote", true);
  store.setPref("drawerTheme", "auto");
  // A keyboard step on the gallery: → from 재생지 picks 밤 종이 and keeps the focus on it (K1).
  await choose("recycled");
  await showDeskPane("appearance", wait);
  await inPane("settings", `document.querySelector('.paper-tile[aria-checked="true"]')?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }))`);
  await wait(500);
  const stepped = `${store.prefs.paperTheme} · focus ${await inPane("settings", `document.activeElement?.dataset?.kind ?? "none"`)}`;
  console.log(`papers keyboard → from recycled: ${stepped}`);
  if (stepped !== "night · focus night") problems += 1;
  if (!korean) return problems;

  // Every paper, by day: the notepad, the desk calendar, the drawer.
  note.setSize(420, 600);
  drawerSample();
  store.setPref("drawerSide", "right");
  store.setPref("drawerWidth", 300);
  store.setPref("drawerBackdrop", "solid");
  for (const paper of paperKinds) {
    await choose(paper);
    const shown = await note.webContents.executeJavaScript(`document.documentElement.dataset.paper + "/" + document.documentElement.dataset.scheme`);
    console.log(`papers ${paper}: note ${shown}, background ${note.getBackgroundColor()}, theme ${nativeTheme.themeSource}`);
    if (shown !== `${paper}/${darkKinds.includes(paper) ? "dark" : "light"}`) problems += 1;
    await note.webContents.executeJavaScript(settledScript).catch(() => undefined);
    await save(`papers/${paper}-note`, note.webContents.capturePage());
    await showDeskPane("calendar", wait);
    await inPane("calendar", settledScript);
    await save(`papers/${paper}-calendar`, captureDesk(wait));
    const window = await drawer.showForSnapshot();
    await wait(450);
    await window.webContents.executeJavaScript(settledScript).catch(() => undefined);
    console.log(`papers ${paper}: drawer ${await window.webContents.executeJavaScript(`document.documentElement.dataset.look`)}`);
    await save(`papers/${paper}-drawer`, window.webContents.capturePage());
  }
  drawer.hideForSnapshot();
  // The desktop widget follows the paper shown (#234 · #244): this month (detail) solid and at 40 % over a busy
  // wallpaper, and the today widget, on a few papers of each kind.
  const widgetCheck = `(() => {
    const out = [];
    const inner = document.querySelector(".wg .in");
    if (inner && inner.scrollHeight > inner.clientHeight + 1) out.push("overflow");
    for (const el of document.querySelectorAll(".tt, .t, .tm, .n, .sh, .empty")) if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow !== "ellipsis" && el.clientWidth > 0) out.push("cut: " + el.textContent);
    return (out.join("; ") || "ok") + " · " + document.documentElement.dataset.paper + "/" + document.documentElement.dataset.scheme;
  })()`;
  for (const paper of ["kraft", "memo", "lined", "chalk", "nightsky"] as const) {
    await choose(paper);
    for (const [kind, style, opacity, wall] of [["month", "detail", 100, "light"], ["month", "detail", 40, "busy"], ["today", "simple", 85, "busy"]] as const) {
      store.setPref("calendarWidgets", [makeWidget({ id: "paper", kind, style, opacity, place: { display: "0", x: 1, y: 0 } })]);
      widgets.sync();
      for (let tries = 0; tries < 50 && !widgets.isReady("paper"); tries += 1) await wait(100);
      const window = widgets.preview("paper", { wall, hover: false, offset: 0 });
      if (!window) { console.log(`papers ${paper} widget: NO WINDOW`); problems += 1; continue; }
      await wait(500);
      const found = String(await window.webContents.executeJavaScript(widgetCheck).catch((error: Error) => `script failed: ${error.message}`));
      console.log(`papers ${paper} widget ${kind}-${style}-${opacity}: ${found}`);
      if (!found.startsWith("ok") || !found.endsWith(`${paper}/${darkKinds.includes(paper) ? "dark" : "light"}`)) problems += 1;
      await save(`papers/${paper}-widget-${kind}-${opacity}`, window.webContents.capturePage());
    }
  }
  store.setPref("calendarWidgets", []);
  widgets.sync();
  // A light paper at night: 밤에는 밤하늘 종이, then 그대로 (the menus stay light).
  await choose("kraft", "night", "nightsky");
  await save("papers/kraft-at-night-nightsky-note", note.webContents.capturePage());
  await choose("kraft", "night", "keep");
  console.log(`papers kraft at night, keep: theme ${nativeTheme.themeSource}`);
  await save("papers/kraft-at-night-keep-note", note.webContents.capturePage());
  await choose("day", "day", "night");
  note.setSize(420, 560);
  return problems;
}
