import fs from "node:fs";
import path from "node:path";
import { BrowserWindow } from "electron";
import { dayKey, logicalDayStart } from "../../core/archive";
import { pageOf } from "../../core/shelf";
import { type NotebookFont, defaultPrefs } from "../../core/types";
import { lang, t } from "../../i18n";
import { type DeskPage, type DeskPane, deskTitleBar, pageOfPane } from "../../core/desk";
import { type LayoutCheckOptions, type LayoutReport, layoutCheckScript } from "../layoutCheck";
import { ReminderPopup } from "../popup";
import { aiToastText } from "../../core/ai";
import { snoozeChoices } from "../../core/snooze";
import { ai, alarmClock, broadcast, calendar, confirmSlip, desk, floating, focusCommand, focusTimer, glance, note, notice, openHelp, periodicPopup, quick, quickMemo, store, sweep, taskPopup, timerSheet } from "../main";
import { type Save, type Wait } from "./index";
import { aiNoteScript, aiSample, aiSampleGone, settingsPaneChecks } from "./ai";
import { aheadDragScript, noteLayoutChecks } from "./cats";
import { cancelDrag, dragBlock } from "./design";
import { confirmQuestions, glanceState, glanceStateNames, inPane, openDay, sampleAlarms, settledScript, showDeskPane } from "./desk";

/**
 * #408: the size sweep (`npm run snapshot -- sweep`, and the end of a full run), moved out of main.ts as it was. Test
 * runs only (see snapshots/index.ts).
 */

/**
 * Every window at the sizes it can take, saved to snapshots/sweep/ with a layout check per shot
 * (see layoutCheck.ts): the note on every page, with the 오늘 일정 strip and each card open, from
 * 350 × 400 to 720 × 1200; 도움말 and 완료 기록 from their smallest to a 2560 × 1440 screen;
 * 설정 and the note at 125 % and 150 % (zoomed, so the page keeps its CSS size while text is drawn
 * bigger, as Windows display scaling does); and the note and 설정 with Noto Sans KR standing in for
 * Malgun Gothic (taller line metrics, wider Hangul than the Mac's fonts). Returns how many problems
 * it found; the last line is "SWEEP OK" or "SWEEP PROBLEMS: n".
 */
export async function sizeSweep(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
  fs.mkdirSync(path.join(directory, "sweep"), { recursive: true });
  let problems = 0;
  const windowsFont = `:root { --ui: "Noto Sans KR", "Malgun Gothic", sans-serif !important; }`;
  /** Sizes the window's page to `width` × `height` CSS px, drawn at `zoom`. */
  const size = async (window: BrowserWindow, width: number, height: number, zoom = 1) => {
    window.webContents.setZoomFactor(zoom);
    window.setContentSize(Math.round(width * zoom), Math.round(height * zoom));
    await wait(350);
    const [innerWidth, innerHeight] = await window.webContents.executeJavaScript("[innerWidth, innerHeight]") as [number, number];
    if (Math.abs(innerWidth - width) > 1 || Math.abs(innerHeight - height) > 1) {
      console.log(`sweep: asked for ${width}×${height} at ${zoom}, got ${innerWidth}×${innerHeight}`);
      problems += 1;
    }
  };
  const check = async (window: BrowserWindow, label: string, options: LayoutCheckOptions) => {
    await wait(250);
    await settled(window);
    const report = await window.webContents.executeJavaScript(layoutCheckScript(options))
      .catch((error: Error) => ({ problems: [`check failed: ${error.message}`], truncated: [] })) as LayoutReport;
    console.log(`sweep ${label}: ${report.problems.length ? report.problems.join("; ") : "ok"}`);
    if (report.truncated.length) console.log(`  … truncated: ${report.truncated.join(" · ")}`);
    problems += report.problems.length;
    const image = await Promise.race([window.webContents.capturePage().catch(() => undefined), wait(4000).then(() => undefined)]);
    await save(`sweep/${label}`, image ? Promise.resolve(image) : undefined);
  };

  // ─── The note ───────────────────────────────────────────────────────────────
  const noteChecks = noteLayoutChecks;
  const send = (command: string, id = "") => note.webContents.send("note:row-command", { id, command });
  const run = (script: string) => note.webContents.executeJavaScript(script).catch(() => undefined);
  floating.hide();
  note.webContents.reload(); // a clean page: no guide, editor or selection left from the shots above
  note.showInactive();
  await wait(1200);
  store.mutate((history) => {
    history.add(t("다음 주 월요일 팀 회의 전까지 분기 보고서 초안을 정리해서 공유 폴더에 올리기"));
    for (let index = 0; index < 9; index += 1) history.add(t("정리할 일 {n}", { n: index + 1 }));
    history.addTo(t("언젠가 읽고 싶은 책 목록을 모아서 도서관 대출 예약까지 해 두기"), "later");
    // 앞으로: a long title on tomorrow, one next week, and one in a later month.
    const inDays = (days: number) => dayKey(new Date(logicalDayStart(new Date()).getTime() + days * 86_400_000 + 3_600_000));
    history.addTo(t("다음 주 발표 전에 자료와 시연 영상을 한 번 더 확인하고 팀에 공유하기"), undefined, new Date(), inDays(1));
    history.addTo(t("세금 신고"), undefined, new Date(), inDays(9));
    history.addTo(t("연말 정산 서류 모으기"), undefined, new Date(), inDays(70));
    // 시간 정하기 (1.24): hours on two of today's tasks (one a start alone), so the ribbon has task lanes.
    history.addTo(t("보고서 쓰기"), undefined, new Date(), undefined, undefined, { start: 840, end: 930 });
    history.addTo(t("엄마께 전화"), undefined, new Date(), undefined, undefined, { start: 1020 });
  });
  const scheduled = store.items.find((item) => item.reminderAt && !item.isCompleted) ?? store.items[1];
  const hours = store.items.find((item) => item.timeEnd) ?? store.items[1];
  const repeating = store.items.find((item) => item.seriesID) ?? store.items[3];
  const dated = store.items.find((item) => item.dueDate) ?? store.items[2];
  const standup = calendar.showSample().find((event) => event.recurring && !event.allDay);
  // 어제부터 · 3일째 on two of the plain tasks (the hovered row's tag gives way to → 내일 · 집중).
  {
    const plain = store.items.filter((item) => !item.isCompleted && !item.dueDate && !item.seriesID && !item.reminderAt && pageOf(item, new Date()) === "today");
    const ago = (days: number) => dayKey(new Date(logicalDayStart(new Date()).getTime() - days * 86_400_000 + 3_600_000));
    store.history.trackToday([{ id: plain[0].id, todaySince: ago(1) }, { id: plain[1].id, todaySince: ago(4) }]);
    store.changed();
  }
  const searchQuery = lang() === "ko" ? "ㅂㄱㅅ" : lang() === "en" ? "report" : "verslag";
  await wait(300);
  type NoteState = { name: string; open: () => Promise<unknown>; close?: () => Promise<unknown> };
  let deleted = 0; // the empty pages' tasks, put back with undo
  let dragging: { x: number; y: number } | undefined; // the open day's block held by the mouse
  // After Esc the block is where it was and nothing was written (a toast would say otherwise).
  // The block found as blockPoint finds it (its title in .tb-hand or .tb-title).
  const heldTime = () => run(`[...document.querySelectorAll(".tt-block")].find((element) => element.querySelector(".tb-hand, .tb-title")?.textContent === ${JSON.stringify(t("보고서 쓰기"))})?.querySelector(".tb-time")?.textContent + (document.querySelector(".toast") ? " + toast" : "")`);
  let heldBefore: unknown;
  const putBack = async () => {
    // The day is drawn again after Esc; on a small, busy run that can take longer than the drag's own 300 ms, so the
    // block gets a second to come back before it counts as not put back (#178: the default run's one miss, 350 × 400).
    let after = await heldTime();
    for (let tries = 0; after !== heldBefore && tries < 10; tries += 1) { await wait(100); after = await heldTime(); }
    if (after !== heldBefore) {
      const blocks = await run(`[...document.querySelectorAll(".tt-block")].map((element) => element.textContent.trim().slice(0, 40)).join(" | ")`);
      console.log(`sweep: the held block wasn't put back (${heldBefore} → ${after}; blocks now: ${blocks})`);
      problems += 1;
    }
  };
  const closeCards = async () => { send("close-editor"); await wait(200); };
  let aiMade: ReturnType<typeof aiSample> | undefined;
  let aiProblems = 0;
  const noteStates: NoteState[] = [
    { name: "today", open: async () => send("page-today") },
    // 하루 띠 (1.25): the whole day opened (scrolled to an hour before now), then a block picked with ↓.
    { name: "today-open", open: async () => openDay(true) },
    // 1.26: a block mid-drag and one mid-stretch (real mouse events, away from the timetable's edges; put back with Esc).
    { name: "today-open-drag", open: async () => { heldBefore = await heldTime(); dragging = await dragBlock(t("보고서 쓰기"), "middle", 30, wait, "middle"); },
      close: async () => { if (dragging) await cancelDrag(dragging, wait); dragging = undefined; await putBack(); } },
    { name: "today-open-stretch", open: async () => { heldBefore = await heldTime(); dragging = await dragBlock(t("보고서 쓰기"), "bottom", 24, wait, "top"); },
      close: async () => { if (dragging) await cancelDrag(dragging, wait); dragging = undefined; await putBack(); } },
    { name: "today-open-picked", open: () => run(`document.querySelector(".tt-scroll")?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))`), close: async () => openDay(false) },
    // 1.23: a carried row hovered (→ 내일 · ↓ 언젠가 · 집중 · 알림 · 지우기), and the search slip.
    // (The ribbon steps aside for this one, so the row needn't scroll it out of view.)
    { name: "row-hover", open: async () => {
      store.setPref("calendarStrip", false);
      await wait(250);
      await run(`(() => { const row = [...document.querySelectorAll(".lines .row")].find((element) => element.querySelector(".carry:not([hidden])")); row?.classList.add("preview-hover"); row?.scrollIntoView({ block: "nearest" }); })()`);
    }, close: async () => {
      await run(`document.querySelectorAll(".preview-hover").forEach((row) => row.classList.remove("preview-hover")); document.querySelector(".sheet").scrollTop = 0`);
      store.setPref("calendarStrip", true);
    } },
    // AI 연결 (1.27): Claude's to-dos and event stamped on the list and the strip, its toast up (two lines at most).
    { name: "ai", open: async () => {
      ai.setEnabled(true);
      aiMade = aiSample();
      ai.seedForSnapshots(aiMade.entries);
      await wait(250);
      notice({ icon: "sparkles", text: aiToastText(aiMade.entries[4], lang()), undo: "ai", entry: aiMade.entries[4].id, long: true });
      await wait(300);
      const own = await run(aiNoteScript) as string;
      if (!own.startsWith("ok")) { console.log(`sweep ai: ${own}`); aiProblems += 1; }
    }, close: async () => {
      await run(`document.querySelector(".toast")?.remove()`);
      if (aiMade) aiSampleGone(aiMade.made);
      ai.setEnabled(false);
    } },
    { name: "search", open: () => run(`window.showSearch()?.set(${JSON.stringify(searchQuery)})`), close: () => run(`document.querySelector(".search-field")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`) },
    { name: "reminder", open: async () => send("reminder", scheduled.id), close: closeCards },
    { name: "reminder-other", open: async () => { send("reminder", scheduled.id); await wait(300); await run(`document.querySelector(".editor .other-toggle")?.click()`); }, close: closeCards },
    { name: "repeat", open: async () => send("repeat", repeating.id), close: closeCards },
    // 1.24: the editor's 시간, its start list open, and the line reading a range.
    { name: "time-editor", open: async () => send("time", hours.id), close: closeCards },
    { name: "time-list", open: async () => { send("time", hours.id); await wait(300); await run(`document.querySelector(".editor .time-line .chip")?.click()`); },
      close: async () => { await run(`document.querySelectorAll(".sheet-pop, .pop-scrim").forEach((element) => element.remove())`); await closeCards(); } },
    { name: "range-chips", open: () => run(`(() => { const field = document.querySelector(".dock textarea.typed"); field.value = ${JSON.stringify(lang() === "ko" ? "3시부터 5시까지 보고서" : lang() === "en" ? "report 3-5pm" : "verslag van 3 tot 5 uur")}; field.dispatchEvent(new Event("input")); })()`), // i18n-ok
      close: () => run(`(() => { const field = document.querySelector(".dock textarea.typed"); field.value = ""; field.dispatchEvent(new Event("input")); })()`) },
    { name: "event-new", open: async () => calendar.newEvent(), close: closeCards },
    { name: "event-edit", open: async () => { if (standup) calendar.editEvent(standup.key); }, close: closeCards },
    { name: "ahead", open: async () => send("page-ahead") },
    { name: "deadline-editor", open: async () => send("deadline", dated.id), close: closeCards },
    // A task dragged over a day: the day lit up, the line where it lands, an empty 언젠가 to drop on.
    { name: "ahead-drag", open: () => run(aheadDragScript), close: async () => { send("page-today"); await wait(150); send("page-ahead"); } },
    // (Back to the top of 오늘 after: the memo states used to do that on the way, before the memo tab went.)
    { name: "ahead-end", open: () => run(`document.querySelector(".sheet").scrollTop = 1e6`), close: async () => { await run(`document.querySelector(".sheet").scrollTop = 0`); send("page-today"); await wait(150); } },
    // 집중: the card running, its list opened, a Pomodoro's time up (four buttons), and the pick state.
    { name: "focus", open: async () => { focusCommand({ kind: "start", taskId: scheduled.id, minutes: 25 }); focusTimer.elapseForSnapshot(12.5); } },
    { name: "focus-expanded", open: () => run(`document.querySelector(".fc-rest")?.click()`), close: async () => { focusTimer.focus({ kind: "later" }); } },
    { name: "focus-pomodoro-up", open: async () => { focusCommand({ kind: "start", taskId: scheduled.id, pomodoro: true }); focusTimer.finishNow(); }, close: async () => { focusTimer.focus({ kind: "later" }); } },
    { name: "pick", open: async () => { send("pick-focus"); await wait(200); await run(`document.querySelectorAll(".lines .row:not(.done)").forEach((row, index) => row.classList.toggle("preview-hover", index === 1))`); },
      close: async () => { await run(`document.querySelectorAll(".preview-hover").forEach((row) => row.classList.remove("preview-hover"))`); send("pick-cancel"); } },
    { name: "empty-today", open: async () => {
      send("page-today");
      calendar.clearSample();
      store.mutate((history) => { for (const item of [...history.items]) if (history.delete(item.id)) deleted += 1; });
    } },
    // Handwriting that reaches past its advance width (Caveat's d, e, f; Kalam's k) on the emptied page: the layout check's "ink cut".
    { name: "overhang", open: async () => {
      send("page-today");
      store.mutate((history) => { for (const word of ["Ahead", "coffee", "koffie", "kopje koffie halen", "Feedback"]) history.add(word); });
    }, close: async () => { store.mutate((history) => { for (let index = 0; index < 5; index += 1) history.undo(); }); } },
    { name: "empty-ahead", open: async () => send("page-ahead"), close: async () => {
      store.mutate((history) => { for (; deleted > 0; deleted -= 1) history.undo(); });
      calendar.showSample();
      send("page-today");
    } },
  ];
  const sweepNote = async (sizes: [number, number][], zoom: number, tag: string, only?: string[]) => {
    for (const [width, height] of sizes) {
      await size(note, width, height, zoom);
      for (const state of noteStates) {
        if (only && !only.includes(state.name)) continue;
        await state.open();
        await wait(450);
        await check(note, `note-${width}x${height}${tag}-${state.name}`, noteChecks);
        await state.close?.();
        await wait(150);
      }
      send("page-today");
    }
  };
  const noteSizes: [number, number][] = [[350, 400], [420, 560], [560, 800], [720, 1200]];
  await sweepNote(noteSizes, 1, "");
  const scaledStates = ["today", "row-hover", "search", "reminder", "repeat", "time-editor", "time-list", "range-chips", "event-new", "ahead", "ahead-drag", "focus", "focus-expanded", "focus-pomodoro-up", "pick"];
  await sweepNote([[420, 560]], 1.25, "@125", scaledStates);
  await sweepNote([[420, 560]], 1.5, "@150", scaledStates);
  note.webContents.setZoomFactor(1);
  const fontKey = await note.webContents.insertCSS(windowsFont);
  await sweepNote([[350, 400], [420, 560]], 1, "-noto", ["today", "today-open", "today-open-drag", "today-open-stretch", "today-open-picked", "row-hover", "search", "reminder", "reminder-other", "repeat", "time-editor", "time-list", "range-chips", "event-new", "ahead", "ahead-drag", "focus", "focus-expanded", "focus-pomodoro-up", "pick"]);
  // 집중 and the 하루 띠 in the other two fonts (the task's and the strip's titles are in the hand).
  for (const font of ["brush", "clean"] as const) {
    store.setPref("font", font);
    await sweepNote([[350, 400], [420, 560]], 1, `-${font}`, ["today", "today-open", "today-open-drag", "today-open-stretch", "today-open-picked", "focus", "focus-expanded", "focus-pomodoro-up", "pick", "overhang", "ahead"]);
  }
  store.setPref("font", defaultPrefs.font);
  await note.webContents.removeInsertedCSS(fontKey);
  await size(note, 420, 560);

  // ─── 책상: every pane at the desk's sizes (the sidebar folded under 820), scaled, and with the other font ───
  // Each pane is checked inside its own frame (its viewport is the pane), and the sidebar in the desk's page.
  const paneChecks: Record<DeskPage, LayoutCheckOptions> = {
    settings: settingsPaneChecks,
    history: {
      ignore: "#tooltip",
      inside: [".pane-head", ".ranges", ".foot", ".foot button"],
      rows: [".pane-head", ".tiles", ".split", ".legend", ".foot", ".day-head", ".focus-top"],
      oneLine: [".pane-head h1", ".ranges button", ".tile .k", ".tile .v", ".legend > *", ".foot > span:first-child", ".foot button", ".bar .m", ".day-head .date", ".ft-head", ".ft-min", ".day-focus"],
    },
    calendar: {
      ignore: ".cell, .day-row",
      inside: [".top", ".top > *", ".panel", ".calendar-body"],
      rows: [".top", ".panel-head", ".calendar-body"],
      oneLine: [".top .title", ".top .today", ".view-seg button", ".top-new", ".panel-head .date", ".new-event", ".section"],
      // #295: nothing in a month cell's head is cut at any size (the lunar date, #296 the repeat mark).
      whole: [".cell-head"],
    },
    help: {
      ignore: ".topics, .ph-cat",
      inside: [".pane-head", ".search", ".content", ".topics"],
      rows: [".pane-head", ".neighbours", ".found", ".card", ".kicker"],
      oneLine: [".pane-head h1", ".topic", ".chip", ".keys kbd", ".neighbour .title", ".group-title"],
      // #24: every topic's name and the search hint whole, at every size and in every language.
      whole: [".topic .label"],
      wholePlaceholders: [".search input"],
    },
  };
  const sidebarChecks: LayoutCheckOptions = { ignore: ".pane-frame", inside: [".dside", ".drow"], oneLine: [".drow", ".dhead"], rows: [".drow"] };
  const deskStates: { name: string; pane: DeskPane; open?: () => Promise<unknown>; close?: () => Promise<unknown> }[] = [
    { name: "calendar", pane: "calendar", open: () => inPane("calendar", `document.querySelectorAll(".view-seg button")[1]?.click()`) },
    { name: "calendar-week", pane: "calendar", open: () => inPane("calendar", `document.querySelector(".view-seg button")?.click()`), close: () => inPane("calendar", `document.querySelectorAll(".view-seg button")[1]?.click()`) },
    { name: "calendar-new", pane: "calendar", open: () => inPane("calendar", `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`), close: () => inPane("calendar", `document.querySelector(".event-sheet")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`) },
    { name: "history", pane: "history" },
    { name: "clock", pane: "clock" },
    { name: "clock-edit", pane: "clock", open: () => inPane("settings", `window.editAlarm(0); document.querySelector(".alarm-editor")?.scrollIntoView({ block: "nearest" })`), close: () => inPane("settings", `document.querySelector(".alarm-editor")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`) },
    { name: "appearance", pane: "appearance" },
    { name: "appearance-end", pane: "appearance", open: () => inPane("settings", `document.querySelector(".content").scrollTop = 1e6`), close: () => inPane("settings", `document.querySelector(".content").scrollTop = 0`) },
    { name: "notifications", pane: "notifications" },
    { name: "notifications-end", pane: "notifications", open: () => inPane("settings", `document.querySelector(".content").scrollTop = 1e6`), close: () => inPane("settings", `document.querySelector(".content").scrollTop = 0`) },
    { name: "repeat", pane: "repeat" },
    { name: "pet", pane: "pet" },
    { name: "events", pane: "events" },
    { name: "storage", pane: "storage" },
    // 1.30: a shared folder in OneDrive — the drive's name, then the folder's (as the Mac's desk-storage-shared).
    { name: "storage-shared", pane: "storage", open: async () => { Object.assign(store.storage, { custom: true, label: t("공유 폴더"), path: "C:\\Users\\sample\\OneDrive\\종이냥", archivePath: "C:\\Users\\sample\\OneDrive\\종이냥\\archive" }); broadcast(); await wait(200); }, // i18n-ok: a folder name
      close: async () => { Object.assign(store.storage, { custom: false, label: t("이 PC (기본)"), path: "C:\\Users\\sample\\AppData\\Roaming\\PaperTodo", archivePath: "C:\\Users\\sample\\AppData\\Roaming\\PaperTodo\\archive" }); broadcast(); } },
    // AI 연결 (1.27): on, with today's and yesterday's work in the list (log only: nothing on the note).
    { name: "ai", pane: "ai", open: async () => { ai.setEnabled(true); ai.seedForSnapshots(aiSample(false).entries); await wait(200); } },
    { name: "help", pane: "help", open: async () => { openHelp("window"); await wait(300); } },
    { name: "help-end", pane: "help", open: async () => { openHelp("tasks"); await wait(300); await inPane("help", `document.querySelector(".content").scrollTop = 1e6`); } },
    { name: "help-search", pane: "help", open: async () => { openHelp(undefined, t("알림")); await wait(300); }, close: () => inPane("help", `(() => { const input = document.querySelector(".search input"); input.value = ""; input.dispatchEvent(new Event("input")); })()`) },
  ];
  const checkDesk = async (label: string, pane: DeskPane) => {
    await wait(250);
    const window = desk.browserWindow!;
    await window.webContents.executeJavaScript(settledScript).catch(() => undefined);
    await inPane(pageOfPane(pane), settledScript);
    const inside = await inPane(pageOfPane(pane), layoutCheckScript(paneChecks[pageOfPane(pane)])) as LayoutReport | string | undefined;
    const side = await window.webContents.executeJavaScript(layoutCheckScript(sidebarChecks)).catch((error: Error) => ({ problems: [`check failed: ${error.message}`], truncated: [] })) as LayoutReport;
    const pageReport: LayoutReport = typeof inside === "object" && inside ? inside : { problems: [`pane check failed: ${String(inside)}`], truncated: [] };
    const found = [...pageReport.problems, ...side.problems.map((problem) => `sidebar: ${problem}`)];
    console.log(`sweep ${label}: ${found.length ? found.join("; ") : "ok"}`);
    if (pageReport.truncated.length) console.log(`  … truncated: ${pageReport.truncated.join(" · ")}`);
    problems += found.length;
    const image = await Promise.race([window.webContents.capturePage().catch(() => undefined), wait(4000).then(() => undefined)]);
    await save(`sweep/${label}`, image ? Promise.resolve(image) : undefined);
  };
  const sweepDesk = async (sizes: [number, number][], zoom: number, tag: string, only?: string[]) => {
    for (const [width, height] of sizes) {
      await size(desk.browserWindow!, width, height + deskTitleBar, zoom); // the pane's size, under the title strip
      for (const state of deskStates) {
        if (only && !only.includes(state.name)) continue;
        await showDeskPane(state.pane, wait);
        await state.open?.();
        await wait(350);
        await checkDesk(`desk-${width}x${height}${tag}-${state.name}`, state.pane);
        await state.close?.();
      }
    }
  };
  await showDeskPane("calendar", wait);
  const deskSizes: [number, number][] = [[760, 520], [819, 600], [820, 640], [920, 640], [1280, 800], [1920, 1080], [2560, 1440]];
  await sweepDesk(deskSizes, 1, "");
  await sweepDesk([[920, 640]], 1.25, "@125");
  await sweepDesk([[920, 640]], 1.5, "@150");
  desk.browserWindow!.webContents.setZoomFactor(1);
  // The other font: every frame of the desk gets it.
  const deskFont = async (on: boolean) => {
    for (const page of ["settings", "history", "calendar", "help"] as const) await inPane(page, on
      ? `(() => { const style = document.createElement("style"); style.id = "noto"; style.textContent = ${JSON.stringify(windowsFont)}; document.head.append(style); })()`
      : `document.getElementById("noto")?.remove()`);
  };
  await deskFont(true);
  const deskNoto = await desk.browserWindow!.webContents.insertCSS(windowsFont);
  await sweepDesk([[760, 520], [920, 640]], 1, "-noto");
  await desk.browserWindow!.webContents.removeInsertedCSS(deskNoto);
  await deskFont(false);
  await size(desk.browserWindow!, 920, 640 + deskTitleBar);

  // ─── The slips (빠른 입력 · 직접 정하기 · 빠른 메모 · 알람 · 질문): their sizes, and with the other font ───
  const cardChecks: LayoutCheckOptions = {
    ignore: ".cat, .stage img",
    inside: ["#card", ".slip", ".tape", ".slip-head", ".slip-foot", ".sbtn", ".chip", ".time", ".label", ".meta", ".toast"],
    rows: [".slip-head", ".slip-foot", ".chips", ".snz", ".hand-field", ".presets"],
    // (The alarm's label may wrap: two lines, then three a size smaller.)
    oneLine: [".slip-title", ".slip-ctx", ".sbtn", ".chip", ".keycap", ".field-hint:not(.bad)", ".time", ".label:not(.ring .label)", ".meta", ".ringing", ".slip-foot .keys > span"],
  };
  const sweepSlips = async (css: string, tag: string) => {
    const ask = async (index: number) => { await confirmSlip.showForSnapshot(confirmQuestions()[index][1]); return confirmSlip.snapshotWindow; };
    const cards: [string, () => Promise<BrowserWindow | undefined>][] = [
      ["quick-entry", async () => { await quick.showForSnapshot(t("내일 3시 회의")); return quick.snapshotWindow; }],
      ["quick-entry-empty", async () => { await quick.showForSnapshot(""); return quick.snapshotWindow; }],
      ["quick-entry-slash", async () => { await quick.showForSnapshot(t("/알람 언젠가")); return quick.snapshotWindow; }],
      ["timer-custom", async () => { await timerSheet.showForSnapshot(t("1시간 30분")); return timerSheet.snapshotWindow; }],
      ["timer-custom-invalid", async () => { await timerSheet.showForSnapshot(t("반나절")); return timerSheet.snapshotWindow; }],
      ["quick-memo", async () => { await quickMemo.showForSnapshot(t("주말에 할 것\n화분 분갈이, 책 반납\n엄마께 전화")); return quickMemo.snapshotWindow; }],
      ["ring", async () => { await alarmClock.showForSnapshot({ ...store.alarms[0] ?? sampleAlarms()[0], label: t("점심 먹고 약 먹기 · 물도 한 잔 꼭 마시기"), snooze: 15 }, 12); return alarmClock.snapshotWindow; }],
      ["ring-once", async () => { await alarmClock.showForSnapshot({ ...sampleAlarms()[2], enabled: true }); return alarmClock.snapshotWindow; }],
      ["confirm-language", () => ask(0)],
      ["confirm-import", () => ask(1)],
      ["confirm-restore", () => ask(2)],
      ["confirm-storage", () => ask(3)],
    ];
    for (const [name, open] of cards) {
      const window = await open();
      if (!window) { console.log(`sweep ${name}${tag}: NOT SHOWN`); problems += 1; continue; }
      const key = css ? await window.webContents.insertCSS(css) : undefined;
      await wait(500);
      await check(window, `${name}${tag}`, cardChecks);
      if (key) await window.webContents.removeInsertedCSS(key);
    }
    quick.hide();
    timerSheet.hide();
    quickMemo.hide();
    alarmClock.hideSnapshot();
    confirmSlip.hide();
  };
  await sweepSlips("", "");
  await sweepSlips(windowsFont, "-noto");

  // ─── The reminder bubble (1.23): a task alert with its ⌄ menu, an event's 5분 전에 다시, 저녁 · 아침 정리 ───
  const bubbleChecks: LayoutCheckOptions = {
    // (The ⌄ menu hangs out of its split button on purpose: the button's own overflow is skipped; the menu must be in view.)
    ignore: ".cat-track, .cat-img, .split",
    inside: [".bubble", ".slip-head", ".slip-foot", ".sbtn", ".split", ".pop-menu", ".pop-menu button", ".tape"],
    rows: [".slip-head", ".slip-foot", ".task"],
    oneLine: [".slip-title", ".slip-ctx", ".sbtn", ".split > button", ".pop-menu button", ".when"],
  };
  const sweepBubbles = async (css: string, tag: string) => {
    store.setPref("petVisible", false);
    store.setPref("reminderStyle", "paper");
    const plain = store.items.filter((item) => !item.isCompleted).slice(0, 2);
    const handlers = { onComplete: () => undefined, onSnooze: () => undefined, onOpen: () => undefined };
    const bubbles: [string, ReminderPopup, () => Promise<unknown>][] = [
      ["bubble-task-menu", taskPopup, async () => {
        taskPopup.show({ tasks: plain.map((item) => ({ id: item.id, title: item.title, scheduledAt: new Date().toISOString() })), scheduled: true, preview: true, canComplete: true, style: "paper", font: store.prefs.font, durationMs: 0, snoozeEnabled: true, reduceMotion: true,
          snoozeChoices: snoozeChoices(new Date(new Date().setHours(14, 50)), "task", lang()).map((choice) => ({ id: choice.id, title: choice.title, ...(choice.at ? { at: choice.at.toISOString() } : {}) })), tomorrow: true }, handlers);
        await wait(2800);
        await taskPopup.snapshotWindow?.webContents.executeJavaScript(`document.querySelector(".split > button:last-child")?.click()`);
        await wait(600);
      }],
      ["bubble-event-again", taskPopup, async () => {
        const event = calendar.showSample().find((entry) => !entry.allDay && entry.start.getTime() > Date.now() + 10 * 60_000) ?? calendar.showSample()[0];
        calendar.previewAlert(event);
        await wait(2800);
      }],
      ["bubble-sweep-evening", periodicPopup, async () => { sweep.preview("evening"); await wait(2800); }],
      ["bubble-sweep-morning", periodicPopup, async () => { sweep.preview("morning"); await wait(2800); }],
    ];
    for (const [name, popup, open] of bubbles) {
      await open();
      const window = popup.snapshotWindow;
      if (!window) { console.log(`sweep ${name}${tag}: NOT SHOWN`); problems += 1; continue; }
      const key = css ? await window.webContents.insertCSS(css) : undefined;
      await wait(300);
      await check(window, `${name}${tag}`, bubbleChecks);
      if (key) await window.webContents.removeInsertedCSS(key);
      popup.hide();
      await wait(200);
    }
    store.setPref("reminderStyle", "character");
    store.setPref("petVisible", true);
  };
  await sweepBubbles("", "");
  await sweepBubbles(windowsFont, "-noto");

  // ─── 오늘 창: each state in each font, and with the other font ─────────────
  const glanceChecks: LayoutCheckOptions = {
    ignore: ".strike",
    inside: ["#card", ".slip", ".cards3", ".c3", ".c3-tools", ".g-row", ".g-links", ".g-link", ".inp", ".g-more"],
    rows: [".cards3", ".g-row", ".g-links", ".inp-row"],
    oneLine: [".c3 small", ".c3 b", ".g-link", ".g-more", ".g-head", ".chip", ".meta"],
  };
  const sweepGlance = async (font: NotebookFont, css: string, tag: string) => {
    store.setPref("font", font);
    for (const name of glanceStateNames) {
      const restore = glanceState(name);
      const window = await glance.showForSnapshot();
      const key = css ? await window.webContents.insertCSS(css) : undefined;
      await wait(600);
      // The timer's pause and stop, shown as on hover.
      if (name === "timer") await window.webContents.executeJavaScript(`document.querySelectorAll(".c3-tools").forEach((tools) => { tools.style.opacity = "1"; })`);
      await check(window, `glance-${name}${tag}`, glanceChecks);
      if (key) await window.webContents.removeInsertedCSS(key);
      restore();
    }
  };
  for (const [font, css, tag] of [["pen", "", ""], ["brush", "", "-brush"], ["clean", "", "-clean"], ["pen", windowsFont, "-noto"]] as const) await sweepGlance(font, css, tag);
  store.setPref("font", defaultPrefs.font);
  glance.snapshotWindow?.hide();

  // ─── 밤 종이: the main sets again at night (same layout, other tokens, borders and shadows) ───
  store.setPref("paper", "night");
  await wait(500);
  await sweepNote([[350, 400], [420, 560], [720, 1200]], 1, "-night");
  await size(note, 420, 560);
  await sweepDesk([[760, 520], [920, 640], [1920, 1080]], 1, "-night");
  await size(desk.browserWindow!, 920, 640 + deskTitleBar);
  await sweepSlips("", "-night");
  await sweepBubbles("", "-night");
  for (const font of ["pen", "clean"] as const) await sweepGlance(font, "", `-${font}-night`);
  store.setPref("font", defaultPrefs.font);
  glance.snapshotWindow?.hide();
  store.setPref("paper", "day");

  problems += aiProblems;
  console.log(problems ? `SWEEP PROBLEMS: ${problems}` : "SWEEP OK");
  return problems;
}
