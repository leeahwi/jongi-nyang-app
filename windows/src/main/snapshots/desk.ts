import fs from "node:fs";
import path from "node:path";
import { BrowserWindow, Menu, type MenuItemConstructorOptions, nativeTheme } from "electron";
import { dayKey, logicalDayStart } from "../../core/archive";
import { isoDate } from "../../core/notebook";
import { pageOf } from "../../core/shelf";
import { lang, t } from "../../i18n";
import { exportedText, summaryText } from "../../core/backup";
import { type Alarm } from "../../core/alarm";
import { type DeskPage, type DeskPane, deskPanes, deskTitleBar, pageOfPane } from "../../core/desk";
import { offscreen } from "../env";
import { type DeskExtra } from "../desk";
import { lunarCellWidth } from "../../core/calendarWidget";
import { type ConfirmQuestion } from "../confirm";
import { alarmClock, calendar, collapse, confirmSlip, desk, eventMenu, floating, focusTimer, glance, languageQuestion, moreMenu, moveQuestion, note, openCalendar, openHelp, periodic, periodicPopup, pet, quick, quickMemo, rowMenu, store, taskPopup, timerSheet, trayMenu, trayTooltip, typingCat } from "../main";
import { type Save, type Wait } from "./index";
import { sampleRestoreQuestion } from "./settings";
import { aheadDragScript } from "./cats";

/**
 * #408: snapshots of the desk, 밤 종이, the 오늘 창 and the menus (`npm run snapshot -- stage3` · `glance`), moved out of
 * main.ts as they were. Test runs only (see snapshots/design.ts).
 */

/** A page has painted and its one-off animations are done (runs in a window's page or a desk pane's frame). */
export const settledScript = `Promise.all(document.getAnimations()
  .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
  .map((animation) => animation.finished.catch(() => undefined)))
  .then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))`;

/** Runs a script in a desk page's frame (undefined when that page isn't loaded). */
export function inPane(page: DeskPage, script: string): Promise<unknown> {
  const frame = desk.frameOf(page);
  return frame ? frame.executeJavaScript(script).catch((error: Error) => `script failed: ${error.message}`) : Promise.resolve(undefined);
}

/**
 * Snapshots: the desk (off-screen, never focused) on `pane`, once that pane's page has loaded and drawn.
 * The first call makes the window; later ones switch the pane the way the sidebar does.
 */
export async function showDeskPane(pane: DeskPane, wait: Wait, extra: DeskExtra = {}): Promise<BrowserWindow> {
  const fresh = !desk.isOpen;
  const window = desk.open(pane, extra, false);
  if (fresh) {
    window.setPosition(offscreen.x + 100, offscreen.y + 100);
    window.setContentSize(920, 640 + deskTitleBar); // the panes 920 × 640, under the title strip
    window.showInactive();
  }
  await desk.ready();
  const page = pageOfPane(pane);
  for (let tries = 0; tries < 50; tries += 1) {
    const ready = await inPane(page, `document.readyState === "complete" && (document.getElementById("app")?.childElementCount ?? 0) > 0 && !document.defaultView.frameElement?.classList.contains("away")`).catch(() => false);
    if (ready === true) break;
    await wait(100);
  }
  await wait(250);
  await inPane(page, settledScript);
  await window.webContents.executeJavaScript(settledScript).catch(() => undefined);
  return window;
}

/** The desk's capture (the sidebar and the pane's frame, composited). */
export const captureDesk = (wait: Wait): Promise<Electron.NativeImage> => {
  const window = desk.browserWindow!;
  return Promise.race([window.webContents.capturePage(), wait(4000).then(() => { throw new Error("no frame"); })]) as Promise<Electron.NativeImage>;
};

/** What a pane must not get wrong at the top: its title clipped, the sidebar's names clipped, a pane's toolbar wrapping. */
const deskTopScript = `(() => {
  const out = [];
  const title = document.querySelector(".pane-head h1, .top .title");
  if (title && title.scrollWidth > title.clientWidth + 1) out.push("title clipped: " + title.textContent);
  const top = document.querySelector(".top");
  if (top && top.scrollWidth > top.clientWidth + 1) out.push("toolbar overflows");
  return out.join("; ");
})()`;

const sidebarScript = `(() => {
  const out = [];
  for (const label of document.querySelectorAll(".drow .dlabel, .dhead")) if (getComputedStyle(label).display !== "none" && label.scrollWidth > label.clientWidth + 1) out.push("clipped: " + label.textContent);
  const chosen = document.querySelector('.drow[aria-selected="true"]');
  const shown = [...document.querySelectorAll(".pane-frame")].filter((frame) => !frame.classList.contains("away")).map((frame) => frame.dataset.page);
  return (out.join("; ") || "ok") + " · chosen " + (chosen?.dataset.pane ?? "none") + " · showing " + shown.join(",") + " · " + document.title;
})()`;

/**
 * Stage 3's desk shots: the window with every pane chosen (desk-<pane>), the 달력's week and a new
 * event, the settings panes' longer states, 도움말's topics and searches, the desk narrow (the sidebar
 * folded to icons), and its keys (Ctrl+2, ↓ in the sidebar, Ctrl+D) checked through the real input path.
 */
export async function deskShots(save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<void> {
  void settled;
  const shot = async (name: string, pane: DeskPane) => {
    const report = await inPane(pageOfPane(pane), deskTopScript);
    const side = await desk.browserWindow!.webContents.executeJavaScript(sidebarScript).catch((error: Error) => error.message);
    console.log(`desk ${name}: ${report || "ok"} | sidebar ${side}`);
    await save(name, captureDesk(wait));
  };
  // 달력: the month, the week, a new event over the month, then opened on a day 40 days on.
  await showDeskPane("calendar", wait);
  const calendarCheck = `(() => {
    const out = [];
    const r = (el) => el.getBoundingClientRect();
    for (const cell of document.querySelectorAll(".cell, .day-row")) if (cell.scrollHeight > cell.clientHeight + 1) out.push("overflow " + cell.dataset.day);
    const title = document.querySelector(".top .title"), today = document.querySelector(".top .today");
    if (title && today && r(title).right > r(today).left) out.push("title runs into the today button");
    if (title && r(title).height > 30) out.push("title wraps");
    const date = document.querySelector(".panel-head .date");
    if (date && date.scrollWidth > date.clientWidth + 1) out.push("panel date clipped");
    // calendar-flows 11: a wide cell without +N in its head keeps its lunar date.
    for (const cell of document.querySelectorAll(".month .cell")) {
      const lunar = cell.querySelector("[data-lunar-day]");
      if (lunar && lunar.hidden && cell.clientWidth >= ${lunarCellWidth} && !cell.querySelector(".more") && !cell.querySelector(".rmark:not([hidden])")) { out.push("lunar hidden " + cell.dataset.day + " w" + cell.clientWidth); break; }
    }
    // #295: nothing in a cell's head is cut (the lunar date, +N, #296 the repeat mark).
    for (const head of document.querySelectorAll(".cell-head")) if (head.scrollWidth > head.clientWidth + 1) out.push("head cut " + head.parentElement.dataset.day);
    return out.join("; ");
  })()`;
  const calendarShot = async (name: string) => {
    await wait(400);
    await inPane("calendar", settledScript);
    console.log(`calendar ${name}: ${await inPane("calendar", calendarCheck) || "ok"}`);
    await shot(name, "calendar");
  };
  await calendarShot("desk-calendar");
  await inPane("calendar", `document.querySelector(".view-seg button")?.click()`);
  await calendarShot("calendar-week");
  await inPane("calendar", `document.querySelectorAll(".view-seg button")[1]?.click()`);
  await wait(300);
  await inPane("calendar", `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  await calendarShot("calendar-month-new");
  await inPane("calendar", `document.querySelector(".event-sheet")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  // #275: Tab from the day to its list and ↓ to the next event — the ring, the focus and what Narrator reads; Esc back.
  await wait(300);
  const calendarKey = (key: string) => inPane("calendar", `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(key)}, bubbles: true }))`);
  await calendarKey("Tab");
  await calendarKey("ArrowDown");
  console.log(`calendar keys: ${await inPane("calendar", `(() => { const row = document.querySelector(".panel .ev.picked"); return row ? row.getAttribute("aria-label") + (document.activeElement === row ? " · focused" : " · NOT FOCUSED") : "NO RING"; })()`)}`);
  await calendarShot("calendar-keys");
  await calendarKey("Escape");
  console.log(`calendar keys after Esc: ${await inPane("calendar", `document.querySelector(".panel .ev.picked") ? "STILL PICKED" : "back to the day"`)}`);
  const ahead = new Date(); ahead.setDate(ahead.getDate() + 40);
  const aheadKey = dayKey(ahead);
  openCalendar(aheadKey);
  await wait(500);
  console.log(`calendar opened on a day: ${await inPane("calendar", `document.querySelector(".cell.selected")?.dataset.day ?? "none"`) === aheadKey ? "ok" : "WRONG DAY"}`);
  openCalendar(dayKey(new Date()));
  await wait(300);

  // Every other pane, as the sidebar shows it.
  for (const pane of deskPanes.filter((entry) => entry !== "calendar")) {
    await showDeskPane(pane, wait);
    await shot(`desk-${pane}`, pane);
    if (pane === "appearance" || pane === "notifications" || pane === "pet") {
      await inPane("settings", `document.querySelector(".content").scrollTop = 1e6`);
      await wait(300);
      await shot(`settings-${pane}-end`, pane);
      // #289: 타닥냥 off (자리 dimmed), with the pet hidden (nothing of it changes).
      if (pane === "pet") {
        store.setPref("typingCat", "off");
        store.setPref("petVisible", false);
        await wait(400);
        await inPane("settings", `document.querySelector(".content").scrollTop = 1e6`);
        await wait(200);
        await shot("settings-pet-typing-off", pane);
        store.setPref("typingCat", "app");
        store.setPref("petVisible", true);
        await wait(400);
      }
      await inPane("settings", `document.querySelector(".content").scrollTop = 0`);
    }
    if (pane === "storage") {
      console.log(`settings storage groups: ${await inPane("settings", `[...document.querySelectorAll(".group")].map((g) => g.querySelector(".label").textContent + " (" + [...g.querySelectorAll("button")].map((b) => b.textContent).join(" / ") + ")").join(" · ")`)}`);
    }
    if (pane === "events") {
      console.log(`settings events groups: ${await inPane("settings", `[...document.querySelectorAll(".group")].map((g) => g.querySelector(".label").textContent + " (" + g.querySelectorAll(".row").length + ")").join(" · ") + " | " + document.querySelector(".pane-head h1").textContent + " | " + document.querySelector(".pane-head .ph-sub").textContent`)}`);
    }
    if (pane === "clock") {
      console.log(`settings clock: ${await inPane("settings", `[...document.querySelectorAll(".group")].map((g) => g.querySelector(".label").textContent + " (" + g.querySelectorAll(".row, .alarm-editor").length + ")").join(" · ") + " | " + [...document.querySelectorAll(".row.alarm")].map((row) => row.textContent).join(" / ")`)}`);
      await inPane("settings", `window.editAlarm(0); document.querySelector(".alarm-editor")?.scrollIntoView({ block: "nearest" })`);
      await wait(400);
      console.log(`settings clock editor: ${await inPane("settings", `(() => {
        const out = [];
        const box = document.querySelector(".alarm-editor");
        if (!box) return "NO EDITOR";
        for (const el of box.querySelectorAll(".editor-row, .days, .form-actions, .segmented")) if (el.scrollWidth > el.clientWidth + 1) out.push("overflows: " + el.className);
        for (const el of box.querySelectorAll("button, .editor-label, .days-note, .time-preview")) if (el.scrollWidth > el.clientWidth + 1) out.push("clipped: " + el.textContent);
        return out.join("; ") || "ok";
      })()`)}`);
      await shot("settings-clock-edit", pane);
      await inPane("settings", `document.querySelector(".alarm-editor")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
      const alarms = [...store.alarms];
      store.replaceAlarms([]);
      await wait(400);
      await inPane("settings", `document.querySelector(".content").scrollTop = 0`);
      await shot("settings-clock-empty", pane);
      store.replaceAlarms(alarms);
      await wait(200);
    }
    if (pane === "help") {
      for (const [name, topic, query] of [["help-window", "window", undefined], ["help-desk", "desk", undefined], ["help-tasks", "tasks", undefined], ["help-calendar", "calendar", undefined], ["help-look", "look", undefined], ["help-backup", "backup", undefined], ["help-search", undefined, t("접기")], ["help-search-none", undefined, t("고양이 밥")]] as const) {
        openHelp(topic, query);
        await wait(500);
        await inPane("help", settledScript);
        await shot(name, "help");
        if (name === "help-window") {
          await inPane("help", `document.querySelector(".content").scrollTop = 1e6`);
          await wait(300);
          await shot("help-window-end", "help");
        }
      }
      await inPane("help", `(() => { const input = document.querySelector(".search input"); input.value = ""; input.dispatchEvent(new Event("input")); })()`);
      openHelp("start");
      await wait(300);
    }
  }
  console.log(`desk title: ${desk.browserWindow!.getTitle()}`);

  // Narrow: the sidebar folds to its icons under 820 wide.
  desk.browserWindow!.setContentSize(760, 560 + deskTitleBar);
  await wait(400);
  for (const pane of ["calendar", "history", "appearance", "help"] as const) {
    await showDeskPane(pane, wait);
    await shot(`desk-narrow-${pane}`, pane);
  }
  desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
  await wait(300);

  // The keys, through the real input path: Ctrl+2 (완료 기록), ↓ in the sidebar (시계), Ctrl+D (달력), F1 (도움말).
  const press = async (keyCode: string, modifiers: ("control" | "shift")[] = []) => {
    desk.browserWindow!.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    desk.browserWindow!.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers });
    await wait(350);
  };
  await press("2", ["control"]);
  const afterCtrl2 = desk.pane;
  await desk.browserWindow!.webContents.executeJavaScript(`document.querySelector('.drow[aria-selected="true"]').focus()`);
  await press("Down");
  const afterDown = desk.pane;
  await press("D", ["control"]);
  const afterCtrlD = desk.pane;
  await press("F1");
  const afterF1 = desk.pane;
  await press(",", ["control"]);
  console.log(`desk keys: Ctrl+2 → ${afterCtrl2}, ↓ → ${afterDown}, Ctrl+D → ${afterCtrlD}, F1 → ${afterF1}, Ctrl+, → ${desk.pane} (want history, clock, calendar, help, appearance)`);
  await showDeskPane("calendar", wait);
}

/** Snapshots in 밤 종이 (snapshots/night/): the note's pages and cards, the line and toast, the 오늘 창, every slip, the reminders, the pet and timer, the post-it, and the desk's panes. */
export async function nightShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<void> {
  fs.mkdirSync(path.join(directory, "night"), { recursive: true });
  const name = (shot: string) => `night/${shot}`;
  store.setPref("paper", "night");
  await wait(500);
  console.log(`night: note ${await note.webContents.executeJavaScript(`document.documentElement.dataset.paper`)}, background ${note.getBackgroundColor()}, theme dark ${nativeTheme.shouldUseDarkColors}`);
  const run = (script: string) => note.webContents.executeJavaScript(script).catch((error: Error) => console.log(`script: ${error.message}`));
  const shot = async (shotName: string, window: BrowserWindow = note) => {
    await wait(350);
    await settled(window);
    await save(name(shotName), window.webContents.capturePage());
  };
  // A clean note first: no guide, card or half-typed line left from the shots before.
  floating.hide();
  note.showInactive();
  note.webContents.reload();
  await wait(1200);
  note.setSize(420, 640);
  calendar.showSample();
  openDay(false);
  const send = (command: string, id = "") => note.webContents.send("note:row-command", { id, command });
  send("page-today");
  await wait(500);
  await shot("note");
  openDay(true);
  await shot("note-ribbon-open");
  openDay(false);
  await run(`document.querySelectorAll(".lines .row").forEach((row, index) => row.classList.toggle("preview-hover", index === 1))`);
  await shot("note-row-hover");
  await run(`document.querySelectorAll(".preview-hover").forEach((row) => row.classList.remove("preview-hover"))`);
  // Typing, then the toast.
  const type = async (text: string) => run(`(() => { const field = document.querySelector(".dock .typed"); field.focus(); document.querySelector(".dock .inp").classList.add("focused"); field.value = ${JSON.stringify(text)}; field.dispatchEvent(new Event("input")); })()`);
  await type(t("내일 3시 회의"));
  await shot("note-typing-event");
  await type(t("/알람 언젠가"));
  await shot("note-typing-slash-bad");
  await type(t("타이머 40"));
  await run(`document.querySelector(".dock .typed").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  await wait(300);
  await shot("note-toast");
  await run(`document.querySelector(".toast .toast-act")?.click()`);
  await run(`document.querySelector(".dock .typed").blur(); document.querySelector(".dock .inp").classList.remove("focused")`);
  focusTimer.command({ kind: "stop" });
  // The cards over the note: an alert, a repeat, the deadline, the event slip and its date picker.
  const scheduled = store.items.find((item) => item.reminderAt && !item.isCompleted) ?? store.items[1];
  send("reminder", scheduled.id);
  await shot("note-editor");
  send("close-editor");
  send("repeat", (store.items.find((item) => item.seriesID) ?? store.items[3]).id);
  await shot("note-repeat-editor");
  send("close-editor");
  calendar.newEvent();
  await wait(400);
  await shot("calendar-sheet-new");
  await run(`document.querySelector(".event-sheet .sheet-chip")?.click()`);
  await shot("calendar-sheet-date-picker");
  await run(`document.querySelector(".sheet-pop")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  send("close-editor");
  await wait(200);
  // The event slip's other faces: sending a task, a repeating event and its delete question, all day in the narrowest note.
  calendar.sendTask(scheduled.id);
  await wait(400);
  await shot("calendar-sheet-send");
  send("close-editor");
  await wait(200);
  const standup = calendar.showSample().find((event) => event.recurring && !event.allDay);
  if (standup) {
    calendar.editEvent(standup.key);
    await wait(400);
    await shot("calendar-sheet-edit");
    await run(`document.querySelector(".event-sheet .sbtn.danger")?.click()`);
    await shot("calendar-sheet-delete");
    send("close-editor");
    await wait(200);
  }
  note.setSize(350, 560);
  calendar.newEvent();
  await wait(300);
  await run(`document.querySelector(".event-sheet .switch")?.click()`);
  await shot("calendar-sheet-narrow-allday");
  send("close-editor");
  await wait(200);
  note.setSize(420, 640);
  // The deadline card (its summary pinned above the buttons).
  // On 앞으로, like the day shot (a task with a deadline ahead sits there, not on 오늘).
  send("page-ahead");
  await wait(300);
  send("deadline", (store.items.find((item) => item.dueDate && !item.isCompleted && pageOf(item, new Date()) === "deadline") ?? store.items[2]).id);
  await shot("note-deadline-editor");
  send("close-editor");
  send("page-today");
  await wait(200);
  // 앞으로 (and a drag lighting a day up), 메모, the guide.
  send("page-ahead");
  await shot("ahead");
  await run(aheadDragScript);
  await shot("ahead-drag");
  send("page-today");
  await wait(150);
  send("page-ahead");
  let removed = 0;
  calendar.clearSample();
  store.mutate((history) => { for (const item of [...history.items]) if (pageOf(item, new Date()) !== "today" && history.delete(item.id)) removed += 1; });
  await shot("ahead-empty");
  store.mutate((history) => { for (; removed > 0; removed -= 1) history.undo(); });
  calendar.showSample();
  send("page-today");
  note.setSize(350, 520);
  await shot("note-350");
  note.setSize(420, 560);
  send("guide");
  await wait(500);
  await save(name("guide-1"), Promise.race([note.webContents.capturePage(), wait(4000).then(() => undefined)]) as Promise<Electron.NativeImage>);
  for (const card of [3, 5]) {
    for (let step = 0; step < 2; step += 1) await run(`document.querySelector(".guide .next")?.click()`);
    await wait(400);
    await save(name(`guide-${card}`), Promise.race([note.webContents.capturePage(), wait(4000).then(() => undefined)]) as Promise<Electron.NativeImage>);
  }
  await run(`document.querySelector(".guide .skip, .guide .close")?.click()`);
  note.webContents.reload();
  await wait(1200);
  send("page-today");

  // 오늘 창: every state, then typing in its line and the toast.
  let restoreMany: (() => void) | undefined;
  for (const state of glanceStateNames) {
    const restore = glanceState(state);
    const window = await glance.showForSnapshot();
    await wait(700);
    await settled(window);
    await save(name(`glance-${state}`), window.webContents.capturePage());
    if (state === "many") restoreMany = restore; else restore();
  }
  const glanceWindow = glance.snapshotWindow!;
  await glanceWindow.webContents.executeJavaScript(`(() => { const field = document.querySelector(".typed"); field.focus(); document.querySelector(".inp").classList.add("focused"); field.value = ${JSON.stringify(t("내일 3시 회의"))}; field.dispatchEvent(new Event("input")); })()`);
  await wait(300);
  await save(name("glance-typing"), glanceWindow.webContents.capturePage());
  await glanceWindow.webContents.executeJavaScript(`document.querySelector(".typed").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  await wait(500);
  await save(name("glance-toast"), glanceWindow.webContents.capturePage());
  restoreMany?.();
  glance.snapshotWindow?.hide();

  // The slips.
  const alarms = store.alarms.length ? store.alarms : sampleAlarms();
  for (const [shotName, open, capture] of [
    ["quick-entry", () => quick.showForSnapshot(t("내일 3시 회의")), () => quick.capture()],
    ["quick-entry-empty", () => quick.showForSnapshot(""), () => quick.capture()],
    ["quick-memo", () => quickMemo.showForSnapshot(t("주말에 할 것\n화분 분갈이, 책 반납\n엄마께 전화")), () => quickMemo.capture()],
    ["timer-custom", () => timerSheet.showForSnapshot(t("1시간 30분")), () => timerSheet.capture()],
    ["timer-custom-invalid", () => timerSheet.showForSnapshot(t("반나절")), () => timerSheet.capture()],
    ["ring", () => alarmClock.showForSnapshot(alarms[0], 1), () => alarmClock.capture()],
    ["ring-once", () => alarmClock.showForSnapshot({ ...alarms[alarms.length - 1], enabled: true, label: t("빨래 걷기") }, 0), () => alarmClock.capture()],
    ["ring-long", () => alarmClock.showForSnapshot({ ...alarms[1 % alarms.length], label: t("점심 먹고 약 먹기 · 물도 한 잔 꼭 마시기") }, 3), () => alarmClock.capture()],
    ...confirmQuestions().map(([confirmName, question]) => [confirmName, () => confirmSlip.showForSnapshot(question), () => confirmSlip.capture()] as const),
  ] as const) {
    await open();
    await wait(800);
    await save(name(shotName), capture());
  }
  quick.hide();
  quickMemo.hide();
  timerSheet.hide();
  alarmClock.hideSnapshot();
  confirmSlip.hide();

  // The reminders, the pet's bubble, the timer's board, the post-it.
  store.setPref("petVisible", false);
  for (const style of ["compact", "paper", "character"] as const) {
    store.setPref("reminderStyle", style);
    periodic.preview();
    await wait(style === "compact" ? 900 : 3000);
    await save(name(`reminder-${style}`), periodicPopup.capture());
    periodicPopup.hide();
    await wait(200);
  }
  store.setPref("reminderStyle", "paper");
  const sample = calendar.showSample();
  calendar.previewAlert(sample.find((event) => event.title === t("점심 약속")) ?? sample[0]);
  await wait(3000);
  await save(name("reminder-calendar"), taskPopup.capture());
  taskPopup.hide();
  store.setPref("reminderStyle", "character");
  store.setPref("petVisible", true);
  await wait(900);
  pet?.speakUp(() => 0.99);
  await wait(800);
  await save(name("pet-question"), pet?.capture());
  for (const pose of ["idle", "left", "right"] as const) await save(name(`typing-cat-${pose}`), typingCat?.preview(pose));
  typingCat?.refresh();
  focusTimer.command({ kind: "pomodoro" });
  await wait(1200);
  await save(name("timer"), focusTimer.capture());
  for (const size of ["extraLarge", "small", "regular"] as const) {
    store.setPref("timerSize", size);
    await wait(500);
    if (size !== "regular") await save(name(`timer-${size}`), focusTimer.capture());
  }
  focusTimer.finishNow();
  await wait(900);
  await save(name("timer-rest"), focusTimer.capture());
  focusTimer.command({ kind: "countdown", minutes: 25 });
  focusTimer.finishNow();
  await wait(900);
  await save(name("timer-done"), focusTimer.capture());
  focusTimer.command({ kind: "stop" });
  collapse({ x: 400, y: 300 });
  await wait(700);
  await save(name("floating"), floating.capture());
  floating.hide();
  note.showInactive();

  // The desk: every pane, and narrow.
  for (const pane of deskPanes) {
    await showDeskPane(pane, wait);
    await save(name(`desk-${pane}`), captureDesk(wait));
  }
  await showDeskPane("calendar", wait);
  await inPane("calendar", `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))`);
  await wait(500);
  await save(name("calendar-month-new"), captureDesk(wait));
  await inPane("calendar", `document.querySelector(".event-sheet")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await showDeskPane("clock", wait);
  await inPane("settings", `window.editAlarm(0); document.querySelector(".alarm-editor")?.scrollIntoView({ block: "nearest" })`);
  await wait(400);
  await save(name("settings-clock-edit"), captureDesk(wait));
  await inPane("settings", `document.querySelector(".alarm-editor")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  const keptAlarms = [...store.alarms];
  store.replaceAlarms([]);
  await wait(400);
  await save(name("settings-clock-empty"), captureDesk(wait));
  store.replaceAlarms(keptAlarms);
  await wait(200);
  for (const pane of ["appearance", "notifications"] as const) {
    await showDeskPane(pane, wait);
    await inPane("settings", `document.querySelector(".content").scrollTop = 1e6`);
    await wait(300);
    await save(name(`settings-${pane}-end`), captureDesk(wait));
    await inPane("settings", `document.querySelector(".content").scrollTop = 0`);
  }
  openHelp(undefined, t("접기"));
  await showDeskPane("help", wait);
  await save(name("help-search"), captureDesk(wait));
  openHelp("start");
  desk.browserWindow!.setContentSize(760, 560 + deskTitleBar);
  await wait(400);
  for (const pane of ["calendar", "history", "appearance", "help"] as const) {
    await showDeskPane(pane, wait);
    await save(name(`desk-narrow-${pane}`), captureDesk(wait));
  }
  desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
  await showDeskPane("calendar", wait);
  // Back to day: every window follows at once.
  store.setPref("paper", "day");
  await wait(500);
  console.log(`day again: note ${await note.webContents.executeJavaScript(`document.documentElement.dataset.paper`)}, desk pane ${await inPane("calendar", `document.documentElement.dataset.paper`)}, background ${note.getBackgroundColor()}`);
}

/**
 * #200: the 오늘 창's states, day and night, into glance/ (glance/night/) — the Mac's `today-window-state-*` set: nothing
 * on and everything on (the sample events, a running timer, an alarm), each with 0 · 3 · many to-dos; one card only (the
 * alarm) with nine to-dos left, as the user's window; a to-do hovered; a short screen (three rows); everything done; two
 * cards and eight to-dos (no ‘외 1개’). Each shot checks that the window holds the slip and that no words are cut.
 */
export async function todayWindowShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
  let problems = 0;
  fs.mkdirSync(path.join(directory, "glance", "night"), { recursive: true });
  const titles = [
    t("보고서 초안 다듬기"), t("화분에 물 주기"),
    t("택배 반품 접수"), t("회의실 예약 확인"),
    t("운동 30분"), t("세탁소 들르기"),
    t("도서관 책 반납"), t("다음 주 일정 정리"),
    t("고양이 사료 주문"), t("영수증 정리"),
    t("사진 백업하기"), t("편지 답장 쓰기"),
    t("우유 사 오기"), t("책상 정리"), t("물 마시기"),
  ];
  const reset = () => {
    focusTimer.command({ kind: "stop" });
    calendar.clearSample();
    store.replaceAlarms([]);
    store.mutate((history) => { for (const item of [...history.items]) history.delete(item.id); });
  };
  /** `open` to-dos (the first `timed` with a reminder later today, for 다음), then `done` finished ones. */
  const todos = (open: number, timed = 0, done = 0, from = 0) => store.mutate((history) => {
    titles.slice(from, from + open + done).forEach((title, index) => {
      const item = history.addTo(title, undefined, new Date(), undefined, index < timed ? isoDate(new Date(Date.now() + (100 + 45 * index) * 60_000)) : undefined);
      if (item && index >= open) history.toggle(item.id);
    });
  });
  const fill = (event = true, timer = true, alarm = true) => {
    if (event) calendar.showSample();
    if (timer) focusTimer.command({ kind: "countdown", minutes: 25 });
    if (alarm) store.replaceAlarms([sampleAlarms()[0]]);
  };
  const check = `(() => {
    const out = [];
    for (const el of document.querySelectorAll(".g-date, .g-progress, .c3 small, .c3 b, .g-chip span, .g-more, .g-link span, .g-head")) if (el.offsetParent && el.scrollWidth > el.clientWidth + 1) out.push("cut: " + el.textContent);
    const slip = document.getElementById("card").getBoundingClientRect();
    for (const el of document.querySelectorAll(".g-chip, .c3")) { const r = el.getBoundingClientRect(); if (r.right > slip.right - 11) out.push("past the slip: " + el.textContent); }
    return out;
  })()`;
  const shots: [string, () => void, number?, boolean?][] = [
    ["user", () => { fill(false, false); todos(9, 0, 2, 1); }],
    ["user-hover", () => { fill(false, false); todos(9, 0, 2, 1); }, undefined, true],
    ["nothing-0", () => {}],
    ["nothing-3", () => todos(3, 1)],
    ["nothing-many", () => todos(12, 1, 3)],
    ["short", () => todos(12, 1, 3), 470],
    ["filled-0", () => fill()],
    ["filled-3", () => { fill(); todos(3, 1, 1); }],
    ["filled-many", () => { fill(); todos(12, 1, 3); }],
    ["timer-all-done", () => { fill(false, true, false); todos(0, 0, 3); }],
    ["two-cards-eight", () => { fill(true, false); todos(8); }],
  ];
  const alarms = [...store.alarms];
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "night/" : "";
    store.setPref("paper", paper);
    for (const [name, set, room, hover] of shots) {
      reset();
      set();
      const window = await glance.showForSnapshot();
      await wait(500);
      await window.webContents.executeJavaScript(`(() => {
        ${room ? `document.documentElement.dataset.room = "${room}";` : "delete document.documentElement.dataset.room;"}
        window.dispatchEvent(new Event("glance-room"));
        ${hover ? `document.querySelector(".g-row")?.classList.add("preview-hover");` : ""}
      })()`);
      await wait(300);
      await settled(window);
      const fit = await glanceFit(window);
      const found = await window.webContents.executeJavaScript(check).catch((error: Error) => [`script failed: ${error.message}`]) as string[];
      console.log(`glance ${prefix}${name}: ${fit}${found.length ? ` · ${found.join("; ")}` : ""}`);
      problems += found.length + (fit.startsWith("CUT") ? 1 : 0);
      await save(`glance/${prefix}${name}`, window.webContents.capturePage());
    }
  }
  glance.snapshotWindow?.hide();
  reset();
  store.replaceAlarms(alarms);
  store.setPref("paper", "day");
  return problems;
}

export const glanceStateNames = ["nothing", "event-soon", "event-later", "timer", "alarm", "many", "busy"] as const;

type GlanceStateName = typeof glanceStateNames[number];

/**
 * Snapshots: the app's data for a state of the 오늘 창 — nothing at all; an event within the hour; a
 * timer running; alarms on; many tasks (다음, three more, 외 N개). Returns what puts things back.
 */
/** The 오늘 창's window holds all of its slip (nothing cut at the top or the bottom): "ok", or what is cut. */
export async function glanceFit(window: BrowserWindow): Promise<string> {
  const [stageHeight, stageWidth] = await window.webContents.executeJavaScript(`(() => { const r = document.getElementById("stage").getBoundingClientRect(); return [Math.ceil(r.bottom), Math.ceil(r.right)]; })()`).catch(() => [0, 0]) as number[];
  const [width, height] = window.getContentSize();
  return stageHeight > height + 1 || stageWidth > width + 1 ? `CUT (slip ${stageWidth}×${stageHeight} in a ${width}×${height} window)` : `ok (${width}×${height})`;
}

export function glanceState(name: GlanceStateName): () => void {
  const alarms = [...store.alarms];
  let undo = 0;
  calendar.clearSample();
  store.replaceAlarms([]);
  focusTimer.command({ kind: "stop" });
  if (name === "nothing") store.mutate((history) => { for (const item of [...history.items]) if (history.delete(item.id)) undo += 1; });
  if (name === "event-soon") calendar.showSample();
  // #136: an event 3 h 40 min away — "3시간 40분 뒤" stays on one line, the name goes to the next.
  if (name === "event-later") {
    const start = new Date(Date.now() + 220 * 60_000);
    const minutes = start.getHours() * 60 + start.getMinutes();
    store.putEvent({ id: "00000000-0000-4000-8000-000000000136", title: t("치과 정기 검진"), date: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`, allDay: false, days: 1,
      start: minutes, end: (minutes + 60) % 1440, repeat: "none", skip: [], color: "blue", createdAt: isoDate(new Date()), updatedAt: isoDate(new Date()) });
  }
  if (name === "timer") focusTimer.command({ kind: "countdown", minutes: 25 });
  if (name === "alarm") store.replaceAlarms(alarms.length ? alarms : sampleAlarms());
  // A running timer with a long event and an alarm: every card's small line on two lines (the Mac's clipped 오늘 창).
  if (name === "busy") {
    calendar.showSample();
    focusTimer.command({ kind: "countdown", minutes: 25 });
    store.replaceAlarms((alarms.length ? alarms : sampleAlarms()).map((alarm) => ({ ...alarm, label: t("점심 먹고 약 먹기 · 물도 한 잔 꼭 마시기") })));
  }
  if (name === "many") {
    const soon = (minutes: number) => isoDate(new Date(Math.min(Date.now() + minutes * 60_000, logicalDayStart(new Date()).getTime() + 24 * 3_600_000 - 60_000)));
    // Each task added is one undo step.
    const before = store.items.length;
    store.mutate((history) => {
      history.addTo(t("분기 보고서 초안을 정리해서 공유 폴더에 올리고 팀에 알리기"), undefined, new Date(), undefined, soon(30));
      history.addTo(t("엄마께 전화"), undefined, new Date(), undefined, soon(90));
      history.addTo(t("약 먹기"), undefined, new Date(), undefined, soon(200));
      for (let index = 0; index < 6; index += 1) history.add(t("정리할 일 {n}", { n: index + 1 }));
    });
    undo = store.items.length - before;
    calendar.showSample();
    store.replaceAlarms(alarms.length ? alarms : sampleAlarms());
  }
  return () => {
    focusTimer.command({ kind: "stop" });
    store.mutate((history) => { for (; undo > 0; undo -= 1) history.undo(); });
    store.replaceAlarms(alarms);
    calendar.showSample();
  };
}

/** The questions the snapshots show on the confirm slip (the same words as the real ones). */
export function confirmQuestions(): [string, ConfirmQuestion][] {
  return [
    ["confirm-language", languageQuestion(lang() === "en" ? "nl" : "en")],
    ["confirm-import", { icon: "box", title: t("가져오기"), message: t("이 백업을 가져올까요?"), replacesList: true, size: "m", cancelId: 0,
      detail: [`${t("종이냥")}-2026-10-08.jongi`, t("{from}에서 {when} 내보냄", { from: "Mac 1.34.0", when: exportedText(new Date().toISOString(), lang()) ?? "" }), summaryText({ todos: 12, memos: 3, repeats: 2, events: 9, archive: 140, alarms: 3, focus: 18 }, lang()), "", t("합치기: 지금 것은 그대로 두고 없는 것만 더해요."), t("바꾸기: 지금 것을 모두 이 백업으로 바꿔요."), t("어느 쪽이든 지금 것은 먼저 백업해 둬요.")].join("\n"),
      buttons: [{ label: t("취소"), kind: "ghost" }, { label: t("바꾸기"), kind: "danger" }, { label: t("합치기"), kind: "primary" }] }],
    ["confirm-restore", sampleRestoreQuestion(false)],
    ["confirm-storage", { icon: "folder", title: t("저장 위치"), size: "m", cancelId: 0, message: t("이 폴더에 이미 종이냥 목록이 있어요."), replacesList: true,
      detail: [t("다른 기기에서 쓰던 목록이면 ‘폴더 목록 쓰기’를 고르면 돼요. 덮어써도 바꾸기 전 상태를 이 PC에 백업해 둬요."), t("어느 쪽이든 완료 기록은 합쳐지고, 종이냥이 다시 시작돼요.")].join("\n"),
      buttons: [{ label: t("취소"), kind: "ghost" }, { label: t("이 PC 목록으로 덮어쓰기"), kind: "ghost" }, { label: t("폴더 목록 쓰기"), kind: "primary" }] }],
    // #390: error slips — what didn't happen, what to do, the next step beside 닫기 (the same as the Mac's).
    ["error-backup-now", { icon: "warning", cat: false, title: t("자동 백업"), message: t("백업하지 못했어요. 지금 목록은 그대로예요."), detail: t("백업 폴더를 열어 확인해 주세요."),
      buttons: [{ label: t("백업 폴더 열기"), kind: "ghost" }, { label: t("닫기"), kind: "primary" }], cancelId: 1 }],
    ["error-storage-move", { icon: "warning", cat: false, title: t("저장 위치"), message: t("폴더로 옮기지 못했어요. 지금 목록은 그대로예요."), detail: t("폴더에 쓸 수 있는지 확인하고 다시 시도해 주세요."),
      buttons: [{ label: t("다시 시도"), kind: "ghost" }, { label: t("닫기"), kind: "primary" }], cancelId: 1 }],
    // 1.28: where the memo tab's memos went (M1).
    ...(moveQuestion() ? [["confirm-move-notice", moveQuestion()!] as [string, ConfirmQuestion]] : []),
  ];
}

/** Three alarms for the snapshots: weekdays 7:00 (기상), every day 13:30 (약 먹기, soft), once 22:00 (off). */
export function sampleAlarms(): Alarm[] {
  const stamp = isoDate(new Date(Date.now() - 86_400_000));
  const alarm = (id: string, time: string, label: string, days: number[], enabled: boolean, sound: Alarm["sound"], snooze: number): Alarm =>
    ({ id, time, label, days, enabled, sound, snooze, createdAt: stamp, updatedAt: stamp });
  return [
    alarm("00000000-0000-4000-8000-0000000000a1", "07:00", t("기상"), [1, 2, 3, 4, 5], true, "bell", 10),
    alarm("00000000-0000-4000-8000-0000000000a2", "13:30", t("약 먹기"), [0, 1, 2, 3, 4, 5, 6], true, "soft", 5),
    alarm("00000000-0000-4000-8000-0000000000a3", "22:00", "", [], false, "bell", 15),
  ];
}

/** Every menu's labels, in the run's language (native menus can't be captured as images). */
export function listMenus(): void {
  const labels = (items: readonly (MenuItemConstructorOptions | Electron.MenuItem)[]): string => items
    .filter((item) => item.type !== "separator")
    .map((item) => {
      const submenu = item.submenu instanceof Menu ? item.submenu.items : Array.isArray(item.submenu) ? item.submenu : undefined;
      return submenu ? `${item.label} [${labels(submenu)}]` : item.label;
    }).join(" | ");
  console.log(`menu more: ${labels(moreMenu().items)}`);
  console.log(`menu row: ${labels(rowMenu(store.items[1].id).items)}`);
  const event = calendar.showSample()[0];
  if (event) console.log(`menu event: ${labels(eventMenu(event.key).items)}`);
  calendar.clearSample();
  console.log(`tray tooltip: ${trayTooltip()}`);
  console.log(`menu tray: ${labels(trayMenu())}`);
  if (pet) console.log(`menu pet: ${labels(pet.menuTemplate())}`);
  console.log(`menu icon: ${labels(floating.menuTemplate())}`);
}

/** Snapshots: the 하루 띠 opened into the whole day today, or closed. */
export function openDay(open: boolean): void {
  store.setPref("dayOpen", open ? dayKey(new Date()) : "");
}
