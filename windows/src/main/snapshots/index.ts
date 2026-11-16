import fs from "node:fs";
import path from "node:path";
import { BrowserWindow } from "electron";
import { type ArchiveEntry } from "../../core/archive";
import { finishedThisWeek, lookbackMessage } from "../../core/lookback";
import { lang, t } from "../../i18n";
import { offscreen } from "../env";
import { type FocusRecord, focusRecord } from "../../core/focus";
import { alarmClock, archive, calendar, collapse, confirmSlip, finishSnapshots, floating, focusTimer, note, periodic, periodicPopup, pet, quickMemo, store, taskPopup, timerSheet, typingCat } from "../main";
import { aiShots } from "./ai";
import { catSizeShots, checkHeader, earsShots, layerShots, typingShots } from "./cats";
import { convenienceShots, focusShots, paperShots, redesignShots, stage2Shots, stripShots, timeblockShots } from "./design";
import { confirmQuestions, deskShots, listMenus, nightShots, openDay, sampleAlarms, todayWindowShots } from "./desk";
import { drawerShots } from "./drawer";
import { backupShots, fontShots, shortcutShots } from "./settings";
import { calendarReminderShots, slipShots, widgetShots } from "./slips";
import { deviceShots, spaces2bShots, spaces2cShots, spacesShots } from "./spaces";
import { sizeSweep } from "./sweep";

/**
 * #408: the snapshot run (`npm run snapshot`, tools/snapshot.mjs): the sample data it starts from and the order of its
 * scenes, moved out of main.ts as they were. main.ts loads this only under `__TEST_HOOKS__` (tools/build.mjs), so a
 * release build leaves the snapshot tools out of out/app.js.
 */

/** A believable year of finished tasks for the history snapshot (deterministic, never real data). */
export function sampleHistory(): ArchiveEntry[] {
  const titles = [t("메일 정리"), t("책 10쪽 읽기"), t("산책"), t("회의 준비"), t("장보기"), t("운동"), t("일기 쓰기"), t("빨래"), t("보고서 초안"), t("물 마시기")];
  const entries: ArchiveEntry[] = [];
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const today = new Date();
  for (let back = 330; back >= 1; back -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, 10);
    const weekend = day.getDay() === 0 || day.getDay() === 6;
    const busy = Math.max(0, Math.round(random() * (weekend ? 3 : 7) - (back > 200 ? 2.5 : 1)));
    for (let index = 0; index < busy; index += 1) {
      const at = new Date(day.getTime() + index * 47 * 60_000);
      entries.push({ id: `sample-${back}-${index}`, title: titles[Math.floor(random() * titles.length)], createdAt: at.toISOString(), completedAt: at.toISOString() });
    }
  }
  return entries;
}

/** Focus sessions for the history snapshot: most weekdays of the last two months (deterministic). */
export function sampleFocus(): FocusRecord[] {
  const tasks: [string, string][] = [["F-1", t("보고서 마무리")], ["F-2", t("책 10쪽 읽기")], ["F-3", t("발표 자료 만들기")], ["F-4", t("메일 정리")]];
  const records: FocusRecord[] = [];
  let seed = 11;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const today = new Date();
  for (let back = 60; back >= 1; back -= 1) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back, 9, 30);
    if (day.getDay() === 0 || random() < 0.25) continue;
    const count = 1 + Math.floor(random() * 3);
    for (let index = 0; index < count; index += 1) {
      const [taskId, title] = tasks[Math.min(tasks.length - 1, Math.floor(random() * random() * tasks.length * 1.6))];
      const minutes = [25, 25, 25, 50, 40][Math.floor(random() * 5)];
      const start = new Date(day.getTime() + index * 95 * 60_000);
      const plain = random() < 0.15;
      const record = focusRecord({ id: `sample-focus-${back}-${index}`, ...(plain ? {} : { taskId }), title: plain ? "" : title, start, end: new Date(start.getTime() + minutes * 60_000), kind: plain ? "timer" : "focus", done: random() < 0.3 });
      if (record) records.push(record);
    }
  }
  return records;
}

export async function runSnapshots(directory: string): Promise<void> {
  process.on("unhandledRejection", (reason) => console.log("snapshot error:", reason instanceof Error ? reason.stack : reason));
  store.setPref("guideSeen", true); // the guide gets its own snapshots at the end
  store.setPref("paper", "day"); // whatever the system's appearance; 밤 종이 gets its own run (snapshots/night/)
  fs.mkdirSync(directory, { recursive: true });
  const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  // The page has painted and its one-off animations (an editor fading in) are done.
  const settled = (window: BrowserWindow) => window.webContents.executeJavaScript(`Promise.all(document.getAnimations()
    .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
    .map((animation) => animation.finished.catch(() => undefined)))
    .then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))`);
  // An off-screen window sometimes never delivers a frame; don't let one capture stall the run.
  const save = async (name: string, image?: Promise<Electron.NativeImage>) => {
    if (!image) return console.log(`snapshot ${name}: (nothing to capture)`);
    const result = await Promise.race([image.catch(() => undefined), wait(4000).then(() => undefined)]);
    if (result) fs.writeFileSync(path.join(directory, `${name}.png`), result.toPNG());
    else console.log(`snapshot ${name}: (capture failed)`);
  };
  const scheduled = store.items[1];
  store.mutate((history) => history.setReminder(scheduled.id, new Date(Date.now() + 3_600_000)));
  store.saveSeries({ taskID: store.items[3].id, rule: { kind: "weekly", weekdays: [1, 3, 5] } });
  store.saveSeries({ title: t("물 마시기"), rule: { kind: "daily" }, remindAt: "23:30" });
  store.saveSeries({ title: t("주간 회고 쓰기"), rule: { kind: "weekly", weekdays: [5] }, remindAt: "17:00" });
  const soon = new Date(); soon.setDate(soon.getDate() + 5);
  const later = new Date(); later.setDate(later.getDate() + 20);
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const key = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  store.mutate((history) => {
    history.setDeadline(store.items[2].id, key(soon), false);
    history.setDeadline(store.items[4].id, key(yesterday), false);
    history.addTo(t("여행 계획 세우기"), "later");
    history.addTo(t("겨울옷 정리하기"), "later");
    const project = history.addTo(t("발표 자료 만들기"), undefined)!;
    history.setDeadline(project.id, key(later), false);
  });
  for (const text of [t("장보기\n우유, 달걀, 사과"), t("회의 메모\n다음 주까지 시안 2개, 금요일 공유")]) store.updateMemo(store.addMemo(), text);
  // 시계: three alarms (one off), and two custom timer lengths for the timer menus.
  const alarms = sampleAlarms();
  store.replaceAlarms(alarms);
  store.setPref("timerRecent", [40, 90]);
  listMenus();
  note.setPosition(offscreen.x + 100, offscreen.y + 100);
  note.showInactive();
  await wait(1000);
  note.webContents.send("note:row-command", { id: "", command: "page-today" }); // the last run's tab is remembered
  await wait(300);
  await settled(note);
  // `npm run snapshot -- sweep`: only the size sweep.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "sweep") {
    calendar.showSample();
    return finishSnapshots(await sizeSweep(directory, save, wait, settled));
  }
  // `npm run snapshot -- papers`: 종이 테마 열다섯 가지 (#244) — every paper's notepad, desk calendar and drawer
  // (Korean), the 꾸미기 → 종이 gallery and the drawer's (every language), into snapshots/papers/.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "papers") {
    calendar.showSample();
    return finishSnapshots(await paperShots(directory, save, wait));
  }
  // `npm run snapshot -- redesign`: only the new design's shots (the note, the line, the slips).
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "redesign") {
    await redesignShots(save, wait, settled);
    await stage2Shots(save, wait, settled);
    return finishSnapshots(0);
  }
  // `npm run snapshot -- stage3`: only the desk and night paper.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "stage3") {
    calendar.showSample();
    await deskShots(save, wait, settled);
    await nightShots(directory, save, wait, settled);
    return finishSnapshots(0);
  }
  // `npm run snapshot -- stage4`: only 집중 (the card's states, the pick state, the board, the history) day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "stage4") {
    calendar.showSample();
    await focusShots(directory, save, wait, settled);
    return finishSnapshots(0);
  }
  // `npm run snapshot -- convenience`: only the 1.23 shots (day and night).
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "convenience") {
    calendar.showSample();
    await convenienceShots(directory, save, wait, settled);
    return finishSnapshots(0);
  }
  // `npm run snapshot -- timeblock`: only the 1.24 shots (task hours, snooze 없음), day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "timeblock") {
    calendar.showSample();
    return finishSnapshots(await timeblockShots(directory, save, wait, settled));
  }
  // `npm run snapshot -- strip`: only the 1.25 shots (the 하루 띠, the open day, the timer board's width), day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "strip") {
    calendar.showSample();
    return finishSnapshots(await stripShots(directory, save, wait, settled));
  }
  // `npm run snapshot -- drawer`: only 메모 서랍's shots (1.28).
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "drawer") {
    return finishSnapshots(await drawerShots(directory, save, wait));
  }
  // `npm run snapshot -- cardfont`: only the cards' preview lines in each face (#198).
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "cardfont") {
    return finishSnapshots(await drawerShots(directory, save, wait));
  }
  // `npm run snapshot -- markdown`: only the drawer's memo markdown, font and size shots (#84).
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "markdown") {
    return finishSnapshots(await drawerShots(directory, save, wait));
  }
  // `npm run snapshot -- drawer2b`: only the drawer's batch 2B shots (#117 · #118 · #119 · #134 · #135).
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "drawer2b") {
    return finishSnapshots(await drawerShots(directory, save, wait));
  }
  // `npm run snapshot -- spaces`: only 할 일 스페이스's shots (1.30), day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "spaces") {
    return finishSnapshots(await spacesShots(directory, save, wait, settled));
  }
  // `npm run snapshot -- spaces2b`: only 스페이스별로 묶기's shots (1.31), day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "spaces2b" || process.env.PAPERTODO_SNAPSHOT_ONLY === "spacepapers") {
    return finishSnapshots(await spaces2bShots(directory, save, wait, settled));
  }
  // `npm run snapshot -- device`: 기기마다 보일 스페이스 (#196), day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "device") {
    return finishSnapshots(await deviceShots(directory, save, wait, settled));
  }
  // `npm run snapshot -- reminders`: 달력의 알림 할 일 (#227) — the month, the week and a small desk, day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "reminders") {
    calendar.showSample();
    return finishSnapshots(await calendarReminderShots(directory, save, wait));
  }
  // `npm run snapshot -- widgets`: 바탕화면 달력 위젯 (#234) — every kind at 100 % and 40 % over sample wallpapers, the day
  // sheet, the gallery and the settings slip, day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "widgets") {
    return finishSnapshots(await widgetShots(directory, save, wait));
  }
  // `npm run snapshot -- spaces2c`: 찾기의 #스페이스 and 완료 기록 by space (1.32), day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "spaces2c") {
    return finishSnapshots(await spaces2cShots(directory, save, wait, settled));
  }
  // `npm run snapshot -- layer`: 노트 위치 (#273) — the pin in each place and its menu, day and night, into layer/.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "layer") {
    return finishSnapshots(await layerShots(directory, save, wait, settled));
  }
  // `npm run snapshot -- typing`: 타닥냥 (#289) — its settings section in each state and the cat in its corner, day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "typing") {
    return finishSnapshots(await typingShots(directory, save, wait));
  }
  // `npm run snapshot -- catsize`: 크기 of the pet and of 타닥냥 (#304) — the settings rows, and each cat at each size.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "catsize") {
    return finishSnapshots(await catSizeShots(directory, save, wait));
  }
  // `npm run snapshot -- ears`: the note with the cat's ears on its top edge (#151), day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "ears") {
    calendar.showSample();
    return finishSnapshots(await earsShots(directory, save, wait, settled));
  }
  // `npm run snapshot -- fonts`: 꾸미기 (낮 · 밤, 노트 글꼴) and 메모 서랍 (서랍 종이, 메모 글꼴) in full (#141 · #142), day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "fonts") {
    return finishSnapshots(await fontShots(directory, save, wait));
  }
  // `npm run snapshot -- backups`: only 저장과 백업's 자동 백업 · 백업 목록 and the restore slip (#139 · #140), day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "backups") {
    return finishSnapshots(await backupShots(directory, save, wait));
  }
  // `npm run snapshot -- ai`: only AI 연결's shots (1.27), day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "ai") {
    calendar.showSample();
    return finishSnapshots(await aiShots(directory, save, wait, settled));
  }
  // `npm run snapshot -- shortcuts`: only the shortcut list and the note's key row (#85 · #86), day and night.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "shortcuts") {
    return finishSnapshots(await shortcutShots(directory, save, wait));
  }
  // `npm run snapshot -- glance`: only the 오늘 창's states (#200), day and night, into glance/.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "glance") {
    return finishSnapshots(await todayWindowShots(directory, save, wait, settled));
  }
  // `npm run snapshot -- slips`: the question slip dragged and nudged, the times slip beside a working desk (#228 · #229).
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "slips") {
    return finishSnapshots(await slipShots(directory, save, wait));
  }
  // `npm run snapshot -- stage2`: only 앞으로 and the 오늘 창.
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "stage2") {
    await stage2Shots(save, wait, settled);
    return finishSnapshots(0);
  }
  await save("note", note.webContents.capturePage());
  // Two rows as if hovered: their actions float over the end of the title.
  await note.webContents.executeJavaScript(`document.querySelectorAll(".lines .row").forEach((row, index) => row.classList.toggle("preview-hover", index === 1 || index === 2))`);
  await wait(200);
  await save("row-hover", note.webContents.capturePage());
  await note.webContents.executeJavaScript(`document.querySelectorAll(".preview-hover").forEach((row) => row.classList.remove("preview-hover"))`);
  // The keyboard: ↓ twice selects the second row.
  const press = (name: string) => note.webContents.executeJavaScript(`document.body.dispatchEvent(new KeyboardEvent("keydown", { key: ${JSON.stringify(name)}, bubbles: true }))`);
  await press("ArrowDown");
  await press("ArrowDown");
  await wait(300);
  await save("note-selected", note.webContents.capturePage());
  await press("Escape");
  // Dragging the third row onto the 앞으로 tab.
  await note.webContents.executeJavaScript(`(() => {
    document.querySelectorAll(".lines .row")[2]?.classList.add("dragging", "to-tab");
    document.querySelector(".index-tab.tab-ahead")?.classList.add("drop-target");
  })()`);
  await wait(200);
  await save("note-drag-tab", note.webContents.capturePage());
  await note.webContents.executeJavaScript(`document.querySelectorAll(".dragging, .drop-target").forEach((element) => element.classList.remove("dragging", "to-tab", "drop-target"))`);
  store.setPref("textSize", "large");
  await wait(300);
  await save("note-large", note.webContents.capturePage());
  store.setPref("textSize", "regular");
  note.webContents.send("note:row-command", { id: scheduled.id, command: "reminder" });
  await wait(500);
  await settled(note);
  await save("note-editor", note.webContents.capturePage());
  note.webContents.send("note:row-command", { id: scheduled.id, command: "close-editor" });
  note.webContents.send("note:row-command", { id: store.items[3].id, command: "repeat" });
  await wait(500);
  await settled(note);
  await save("note-repeat-editor", note.webContents.capturePage());
  note.webContents.send("note:row-command", { id: scheduled.id, command: "close-editor" });
  // 일정: today's events above the tasks (sample events in the throwaway folder), folded, and all of them.
  const sampleEvents = calendar.showSample();
  await wait(400);
  await settled(note);
  await save("note-calendar", note.webContents.capturePage());
  openDay(true);
  await wait(500);
  await save("note-calendar-open", note.webContents.capturePage());
  openDay(false);
  await wait(200);
  // The event sheet — 넣기 under a task (then the task's mark), 새 일정, 고치기 on a repeating event
  // (반복 · 색 · 장소) and its delete question (이 날만 · 모두 지우기).
  const sheetShot = async (name: string) => {
    await wait(500);
    await settled(note);
    // The card must fit the note and nothing in it may spill sideways.
    const report = await note.webContents.executeJavaScript(`(() => {
      const card = document.querySelector(".event-sheet");
      if (!card) return "";
      const out = [];
      const r = card.getBoundingClientRect();
      if (r.bottom > window.innerHeight + 0.5 || r.top < 0) out.push("card off the note");
      for (const el of card.querySelectorAll(".sheet-row, .sheet-line, .sheet-colors, .slip-foot, .slip-head")) if (el.scrollWidth > el.clientWidth + 1) out.push("row overflows: " + el.className);
      const tape = card.querySelector(".tape");
      if (tape && tape.getBoundingClientRect().top < -0.5) out.push("tape cut off at the top");
      return out.join("; ");
    })()`).catch((error: Error) => error.message);
    console.log(`sheet ${name}: ${report || "ok"}`);
    await save(name, note.webContents.capturePage());
  };
  const closeSheet = async () => {
    note.webContents.send("note:row-command", { id: "", command: "close-editor" });
    await wait(200);
  };
  calendar.sendTask(scheduled.id);
  await sheetShot("calendar-sheet-send");
  await note.webContents.executeJavaScript(`document.querySelector(".event-sheet .sbtn.primary")?.click()`);
  await sheetShot("note-calendar-sent");
  console.log(`task mark: ${store.state().calendar.withEvents.includes(scheduled.id) ? "shown" : "MISSING"}`);
  calendar.newEvent();
  await sheetShot("calendar-sheet-new");
  await closeSheet();
  // The narrowest note, all day: 기간 instead of the times.
  note.setSize(350, 560);
  calendar.newEvent();
  await wait(300);
  await note.webContents.executeJavaScript(`document.querySelector(".event-sheet .switch")?.click()`);
  await sheetShot("calendar-sheet-narrow-allday");
  await closeSheet();
  note.setSize(420, 560);
  const standup = sampleEvents.find((event) => event.recurring && !event.allDay);
  if (standup) {
    calendar.editEvent(standup.key);
    await sheetShot("calendar-sheet-edit");
    await note.webContents.executeJavaScript(`document.querySelector(".event-sheet .sbtn.danger")?.click()`);
    await sheetShot("calendar-sheet-delete");
    await closeSheet();
  }
  // Events on other days only: the strip is its heading, with + to make one; no events at all: no strip.
  calendar.sampleWithoutToday();
  await sheetShot("note-calendar-empty");
  calendar.clearSample();
  await wait(400);
  console.log(`strip without events: ${await note.webContents.executeJavaScript(`document.querySelector(".strip")?.isConnected ? "SHOWN" : "hidden"`)}`);
  calendar.showSample();
  await wait(200);
  // 책상: every pane (달력 month and week, a new event, 완료 기록, every settings pane, 도움말 and a search).
  await deskShots(save, wait, settled);
  await wait(200);
  note.webContents.send("note:row-command", { id: "", command: "page-ahead" });
  await wait(400);
  await save("ahead-plain", note.webContents.capturePage());
  note.webContents.send("note:row-command", { id: store.items[2].id, command: "deadline" });
  await wait(500);
  await save("note-deadline-editor", note.webContents.capturePage());
  note.webContents.send("note:row-command", { id: "", command: "close-editor" });
  note.webContents.send("note:row-command", { id: "", command: "page-today" });
  await wait(300);
  // The redesign's note, line, toast and 빠른 입력 shots; 앞으로 and the 오늘 창.
  await redesignShots(save, wait, settled);
  await stage2Shots(save, wait, settled);
  // 직접 정하기…: a length understood, one that isn't, and the empty sheet.
  for (const [name, text] of [["timer-custom", t("1시간 30분")], ["timer-custom-invalid", t("반나절")], ["timer-custom-empty", ""]] as const) {
    await timerSheet.showForSnapshot(text);
    await wait(700);
    await save(name, timerSheet.capture());
  }
  timerSheet.hide();
  // 빠른 메모: a few lines written, and the empty card.
  for (const [name, text] of [["quick-memo", t("주말에 할 것\n화분 분갈이, 책 반납\n엄마께 전화")], ["quick-memo-empty", ""]] as const) {
    await quickMemo.showForSnapshot(text);
    await wait(700);
    await save(name, quickMemo.capture());
  }
  quickMemo.hide();
  // An alarm ringing (silent here): weekdays after a minute, once just now, and a long name.
  for (const [name, alarm, minutes] of [
    ["ring", alarms[0], 1], ["ring-once", { ...alarms[2], enabled: true, label: t("빨래 걷기") }, 0],
    ["ring-long", { ...alarms[1], label: t("점심 먹고 약 먹기 · 물도 한 잔 꼭 마시기") }, 3],
  ] as const) {
    await alarmClock.showForSnapshot(alarm, minutes);
    await wait(900);
    await save(name, alarmClock.capture());
  }
  alarmClock.hideSnapshot();
  // The app's questions on a slip: the language, an import, the storage folder.
  for (const [name, question] of confirmQuestions()) {
    await confirmSlip.showForSnapshot(question);
    await wait(800);
    await save(name, confirmSlip.capture());
  }
  confirmSlip.hide();
  store.setPref("petVisible", false); // each reminder style on its own first
  for (const style of ["compact", "paper", "character"] as const) {
    store.setPref("reminderStyle", style);
    periodic.preview();
    await wait(style === "compact" ? 900 : 3000);
    await save(`reminder-${style}`, periodicPopup.capture());
    periodicPopup.hide();
    await wait(200);
  }
  store.setPref("reminderStyle", "character");
  periodic.preview();
  await wait(700);
  await save("reminder-walking", periodicPopup.capture());
  periodicPopup.hide();
  // An event's alert: the task bubble without 완료 or 다시 알림.
  store.setPref("reminderStyle", "paper");
  calendar.previewAlert(sampleEvents.find((event) => event.title === t("점심 약속")) ?? sampleEvents[0]);
  await wait(3000);
  await save("reminder-calendar", taskPopup.capture());
  taskPopup.hide();
  await wait(200);
  store.setPref("reminderStyle", "character");
  // With the pet out, the reminder pops up just above the cat instead.
  store.setPref("petVisible", true);
  await wait(900);
  periodic.preview();
  await wait(900);
  console.log(`reminder on pet: ${pet?.anchor() ? "anchored" : "NO ANCHOR"}`);
  await save("reminder-on-pet", periodicPopup.capture());
  periodicPopup.hide();
  collapse({ x: 400, y: 300 });
  await wait(700);
  await save("floating", floating.capture());
  // 종이냥 on the floor; then the focus timer's own board, and a finished countdown's message.
  await save("pet", pet?.capture());
  // Sunday evening's look-back.
  pet?.say(lookbackMessage(Math.max(1, finishedThisWeek(archive.all(), new Date())), lang()), 10);
  await wait(800);
  await save("pet-weekly", pet?.capture());
  // 종이냥 한마디: a line about the sheet, then a question with answer buttons.
  pet?.speakUp(() => 0);
  await wait(800);
  await save("pet-line", pet?.capture());
  pet?.speakUp(() => 0.99);
  await wait(800);
  await save("pet-question", pet?.capture());
  // #289: the typing cat in its corner — resting, the left paw down, the right paw down.
  for (const pose of ["idle", "left", "right"] as const) await save(`typing-cat-${pose}`, typingCat?.preview(pose));
  typingCat?.refresh();
  focusTimer.command({ kind: "pomodoro" });
  await wait(1200);
  await save("timer", focusTimer.capture());
  // TimerSize: the same board larger and smaller, then back.
  for (const size of ["extraLarge", "small", "regular"] as const) {
    store.setPref("timerSize", size);
    await wait(500);
    if (size !== "regular") await save(`timer-${size}`, focusTimer.capture());
  }
  // The first round done: a rest with one filled round dot, then paused.
  focusTimer.finishNow();
  await wait(900);
  await save("timer-rest", focusTimer.capture());
  focusTimer.command({ kind: "togglePause" });
  await wait(700);
  await save("timer-paused", focusTimer.capture());
  focusTimer.command({ kind: "countdown", minutes: 25 });
  focusTimer.finishNow();
  await wait(900);
  await save("timer-done", focusTimer.capture());
  focusTimer.command({ kind: "stop" });
  await checkHeader(save, wait);
  // The first-launch guide: the first and the last card.
  note.setSize(420, 560);
  note.webContents.send("note:row-command", { id: "", command: "page-today" });
  note.webContents.send("note:row-command", { id: "", command: "guide" });
  await wait(500);
  await save("guide-1", Promise.race([note.webContents.capturePage(), wait(4000).then(() => undefined)]) as Promise<Electron.NativeImage>);
  for (let step = 0; step < 2; step += 1) await note.webContents.executeJavaScript(`document.querySelector(".guide .next")?.click()`);
  await wait(400);
  await save("guide-3", Promise.race([note.webContents.capturePage(), wait(4000).then(() => undefined)]) as Promise<Electron.NativeImage>);
  for (let step = 0; step < 2; step += 1) await note.webContents.executeJavaScript(`document.querySelector(".guide .next")?.click()`);
  await wait(400);
  await save("guide-5", Promise.race([note.webContents.capturePage(), wait(4000).then(() => undefined)]) as Promise<Electron.NativeImage>);
  // 집중: the focus card's states, day and night (and night/ for the rest below).
  await focusShots(directory, save, wait, settled);
  // 편의 기능 (1.23): every new face, day and night.
  await convenienceShots(directory, save, wait, settled);
  // 시간 정하기 · 다시 알림 없음 (1.24), day and night.
  const timeblockProblems = await timeblockShots(directory, save, wait, settled);
  // 하루 띠 · 하루 일정표 · the timer board's width (1.25), day and night.
  const stripProblems = await stripShots(directory, save, wait, settled);
  // AI 연결 (1.27): stamps, toasts, the settings pane, day and night.
  const aiProblems = await aiShots(directory, save, wait, settled);
  // 메모 서랍 (1.28): the handle, the four papers, every state, widths, sides, screens, settings and the memo tab.
  const drawerProblems = await drawerShots(directory, save, wait);
  // 밤 종이: every main screen and every slip again, in night paper (snapshots/night/).
  await nightShots(directory, save, wait, settled);
  finishSnapshots(timeblockProblems + stripProblems + aiProblems + drawerProblems + await sizeSweep(directory, save, wait, settled));
}

export type Save = (name: string, image?: Promise<Electron.NativeImage>) => Promise<void>;

export type Wait = (ms: number) => Promise<unknown>;
