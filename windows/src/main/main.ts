import { BrowserWindow, Menu, Notification, Tray, app, clipboard, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, powerMonitor, screen, shell, type MenuItemConstructorOptions, type WebFrameMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dayKey, logicalDayStart, type ArchiveEntry } from "../core/archive";
import { finishedThisWeek, lookbackMessage, weeklyLookback } from "../core/lookback";
import { isoDate, type TodoItem } from "../core/notebook";
import { pageOf, tabDrop } from "../core/shelf";
import { sameFolder, storageLabel } from "../core/storage";
import { noteOrigin, type Point } from "../core/placement";
import { ArchiveStore } from "./archiveStore";
import { CalendarService } from "./calendar";
import { defaultPrefs, type NoteNotice, fontTitles, pomodoroSettings, textSizeTitles, textSizes, type Action, type FocusCommand, type IntentMade, type IntentRequest, type IntentResult, type NotebookFont, type ParsedWhen, type Prefs, type WireCandidate, type IntentPage } from "../core/types";
import { nativeName, resolveLang, spokenTime, type Lang, type LanguageSetting } from "../core/lang";
import { lang, setLang, t } from "../i18n";
import type { CalendarSheetRequest, CalendarWriteRequest } from "../core/calendar";
import { backupFileName, exportedText, makeBackup, parseBackup, summary, summaryText, type BackupFiles } from "../core/backup";
import { newAlarm, readAlarm, type Alarm } from "../core/alarm";
import { emptyIntentMemory, learnSwitch } from "../core/intent";
import { deskPanes, deskTitleBar, pageOfPane, paperColor, paperInk2, readPane, themeSource, type DeskPage, type DeskPane } from "../core/desk";
import { expand, type EventColor, type LocalEvent } from "../core/events";
import { glanceText, type GlanceTimer } from "../core/glance";
import { offscreen, offscreenEnabled, shortcutsDisabled } from "./env";
import { Desk, type DeskExtra } from "./desk";
import { FloatingNote } from "./floating";
import { GlanceWindow } from "./glanceWindow";
import { layoutCheckScript, type LayoutCheckOptions, type LayoutReport } from "./layoutCheck";
import { DesktopPet } from "./pet";
import { ReminderPopup } from "./popup";
import { QuickEntry } from "./quick";
import { QuickMemo } from "./quickMemo";
import { TimerSheet } from "./timerSheet";
import { AlarmClock } from "./alarms";
import { SlipConfirm, type ConfirmQuestion } from "./confirm";
import { PeriodicReminders, TaskReminders } from "./reminders";
import { backupsFolder, copyData, hasList, importInto, mergeArchive, readDataFiles, readDataFolder, removeLeftovers, usableFolder, writeDataFolder, writeFileAtomically } from "./storageFolder";
import { Store } from "./store";
import { FocusTimerWidget } from "./timer";
import { FocusLog } from "./focusLog";
import { EveningSweep } from "./sweep";
import { focusRecord, type FocusRecord } from "../core/focus";
import { moveChoices, movedTomorrowText, tomorrowKey } from "../core/carry";
import { search } from "../core/search";
import { snoozeChoices } from "../core/snooze";
import { badgeText, jumpTasks, launchCommand, loginFlag, shouldAskLogin, startedAtLogin, taskbarProgress, thumbButtons, type LaunchCommand, type TaskbarTimer, type ThumbButton } from "../core/taskbar";
import { notifyButtons, notifyScheme, readNotifyLink, toastXml, wantsSystemNotice, type NotifyAction } from "../core/notify";
import { dockFrame, stillDocked } from "../core/dock";
import { soonest } from "../core/glance";
import { movedText } from "../core/ahead";
import { focusMinutes as rangeFocusMinutes, rangeDay, validRange } from "../core/timeRange";

const snapshotDirectory = process.env.PAPERTODO_SNAPSHOT;
const demo = process.argv.includes("--demo") || Boolean(snapshotDirectory);
const rendererDirectory = path.join(__dirname, "renderer");
const assetsDirectory = path.join(__dirname, "..", "assets");

app.setAppUserModelId("com.noa.PaperTodo");
if (!snapshotDirectory && !app.requestSingleInstanceLock()) app.quit();

let store: Store;
let note: BrowserWindow;
let desk: Desk;
let archive: ArchiveStore;
let tray: Tray | undefined;
let floating: FloatingNote;
let pet: DesktopPet | undefined;
let focusTimer: FocusTimerWidget;
let focusLog: FocusLog;
let taskReminders: TaskReminders;
let periodicPopup: ReminderPopup;
let taskPopup: ReminderPopup;
let periodic: PeriodicReminders;
let quick: QuickEntry;
let quickMemo: QuickMemo;
let timerSheet: TimerSheet;
let alarmClock: AlarmClock;
let calendar: CalendarService;
let confirmSlip: SlipConfirm;
let glance: GlanceWindow;
let sweep: EveningSweep;

/** A question on a slip over `parent` (the 쪽지 family's confirm); resolves with the answer's index. */
function ask(parent: BrowserWindow | undefined, question: ConfirmQuestion): Promise<number> {
  return confirmSlip.ask(parent, question);
}
let quitting = false;
let toldAboutTray = false;
/** Where the icon sat on the note when it was folded, so unfolding mirrors it. */
let collapseAnchorInNote: Point | undefined;

/** Settings live in %APPDATA%\PaperTodo; the data there too, unless a shared folder was chosen (see storageFolder.ts). */
let settingsDirectory: string;

function directories(): { data: string; settings: string; folder?: string; unavailable?: string } {
  if (demo) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "paper-todo-demo-"));
    // `npm run perf`: a demo run on a prepared data set (tools/perf-data.mjs), copied so the run may change it.
    const seed = process.env.PAPERTODO_DEMO_DATA;
    if (seed && !snapshotDirectory && fs.existsSync(seed)) fs.cpSync(seed, temporary, { recursive: true });
    return { data: temporary, settings: temporary };
  }
  const settings = path.join(app.getPath("appData"), "PaperTodo");
  const folder = readDataFolder(settings);
  if (folder && !usableFolder(folder)) return { data: settings, settings, folder, unavailable: folder };
  return { data: folder ?? settings, settings, folder };
}

/**
 * The language for this run, chosen once at launch (changing it restarts the app): PAPERTODO_LANG
 * (snapshots), else the setting kept in settings.json — "auto" follows the system's languages.
 */
function appLanguage(settings: string): Lang {
  const forced = process.env.PAPERTODO_LANG;
  if (forced === "ko" || forced === "en" || forced === "nl") return forced;
  let setting: string | undefined;
  try {
    setting = (JSON.parse(fs.readFileSync(path.join(settings, "settings.json"), "utf8")) as { prefs?: { language?: string } }).prefs?.language;
  } catch {
    // First launch or unreadable settings: automatic.
  }
  return resolveLang(setting, app.getPreferredSystemLanguages());
}

/**
 * 언어: the setting changes after a confirm, then the app starts again in it. A choice that comes
 * to the language already shown (자동 on an English system while English is shown) just saves.
 */
async function setLanguage(value: LanguageSetting): Promise<void> {
  if (store.prefs.language === value) return;
  if (resolveLang(value, app.getPreferredSystemLanguages()) === lang() || snapshotDirectory) return store.setPref("language", value);
  const parent = dialogParent();
  const response = await ask(parent, languageQuestion(value));
  if (response !== 1) return store.changed(); // the settings window shows the old choice again
  store.setPref("language", value);
  await settleEditing();
  store.flush();
  app.relaunch();
  app.exit(0);
}

/** "English로 바꿀까요?" (en "Switch to English?") and that the app starts again; as on the Mac. */
function languageQuestion(value: LanguageSetting): ConfirmQuestion {
  const message = value === "auto" ? t("자동으로 바꿀까요?") : t("{name}로 바꿀까요?", { name: nativeName[value] });
  return {
    icon: "globe", title: t("언어 바꾸기"), message, detail: t("종이냥이 다시 시작돼요. 적어 둔 건 그대로예요."),
    buttons: [{ label: t("그대로 두기"), kind: "ghost" }, { label: t("바꾸고 다시 시작"), kind: "primary" }], cancelId: 0,
  };
}

function webPreferences(): Electron.WebPreferences {
  // Snapshots render hidden, off-screen windows, which Chromium would otherwise stop animating.
  return { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, backgroundThrottling: !snapshotDirectory };
}

/** Sends to every window and every frame in it (the desk's panes are frames of their own). */
function sendEverywhere(channel: string, ...args: unknown[]): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    for (const frame of window.webContents.mainFrame.framesInSubtree) {
      try { frame.send(channel, ...args); } catch { /* a frame going away */ }
    }
  }
}

/** The pages (and the desk's frames) that listen for the state; the others never hear it (see preload's `on`). */
const stateFrames = new Set<WebFrameMain>();

function broadcast(): void {
  if (stateFrames.size > 0) {
    const state = store.state();
    for (const frame of stateFrames) {
      try {
        if (frame.detached) stateFrames.delete(frame); else frame.send("state", state);
      } catch { stateFrames.delete(frame); /* a frame going away */ }
    }
  }
  updateTray();
}

// ─── 밤 종이 ──────────────────────────────────────────────────────────────────

/** Night paper now: the setting (낮 · 밤), or with 자동 what the system's appearance says. */
const paperNight = (): boolean => nativeTheme.shouldUseDarkColors;
let nightShown: boolean | undefined;

/** The setting decides Electron's theme (title bars, menus, scrollbars follow it); then every window hears. */
function applyPaper(): void {
  nativeTheme.themeSource = themeSource(store.prefs.paper);
  refreshPaper();
}

/** Every window and frame turns to the paper now in force, and the windows' own backgrounds too (no flash). */
function refreshPaper(): void {
  const night = paperNight();
  if (night === nightShown) return;
  nightShown = night;
  const color = paperColor(night);
  if (note && !note.isDestroyed()) note.setBackgroundColor(color);
  desk?.setBackground(color);
  sendEverywhere("paper", night);
}

function createNote(): BrowserWindow {
  const saved = store.memory.bounds;
  const window = new BrowserWindow({
    width: saved?.width ?? 420, height: saved?.height ?? 560, x: saved?.x, y: saved?.y,
    minWidth: 350, minHeight: 400, maxWidth: 720, maxHeight: 1200,
    frame: false, show: false, maximizable: false, fullscreenable: false,
    backgroundColor: paperColor(paperNight()), title: t("종이냥"), icon: path.join(assetsDirectory, "cat.png"),
    alwaysOnTop: store.prefs.alwaysOnTop,
    webPreferences: webPreferences(), enableLargerThanScreen: Boolean(snapshotDirectory),
  });
  if (saved && !screen.getAllDisplays().some((display) => intersects(display.workArea, saved))) window.center();
  window.loadFile(path.join(rendererDirectory, "note.html"));
  window.once("ready-to-show", () => { if (!snapshotDirectory) window.show(); });
  const rememberBounds = () => { if (!window.isMinimized()) store.remember({ bounds: window.getBounds() }); };
  window.on("moved", rememberBounds);
  window.on("resized", rememberBounds);
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    window.webContents.send("note:commit-editing");
    window.hide();
    focusTimer?.noteShown(); // 집중: the board takes over from the card
    if (!toldAboutTray && process.platform === "win32") {
      toldAboutTray = true;
      tray?.displayBalloon({ title: t("종이냥은 계속 실행 중이에요"), content: t("알림 영역의 종이냥을 누르면 다시 열려요."), iconType: "info" });
    }
  });
  // Double-clicking the header folds the note into the post-it, where the click happened.
  if (process.platform === "win32") {
    const WM_NCLBUTTONDBLCLK = 0x00a3;
    window.hookWindowMessage(WM_NCLBUTTONDBLCLK, () => collapse(screen.getCursorScreenPoint()));
  }
  return window;
}

function intersects(a: Electron.Rectangle, b: Electron.Rectangle): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function showNote(): void {
  periodicPopup.hide();
  taskPopup.hide();
  const center = floating.center;
  if (center && collapseAnchorInNote) {
    const [width, height] = note.getSize();
    const origin = noteOrigin(center, collapseAnchorInNote, { width, height }, screen.getAllDisplays().map((display) => display.workArea));
    note.setPosition(Math.round(origin.x), Math.round(origin.y));
  }
  collapseAnchorInNote = undefined;
  floating.hide();
  if (note.isMinimized()) note.restore();
  note.show();
  note.focus();
  focusTimer?.noteShown(); // 집중: the card is back, the board goes
}

function collapse(anchor?: Point): void {
  if (!note.isVisible()) return;
  note.webContents.send("note:commit-editing");
  const bounds = note.getBounds();
  const point = anchor ?? { x: bounds.x + bounds.width / 2, y: bounds.y + 42 };
  note.hide();
  focusTimer?.noteShown();
  floating.show(point);
  const center = floating.center;
  collapseAnchorInNote = center ? { x: center.x - bounds.x, y: center.y - bounds.y } : undefined;
}

// ─── 책상 ─────────────────────────────────────────────────────────────────────

/** The desk on a pane (one window for 달력 · 완료 기록 · 시계 · the settings · 도움말). */
function openDesk(pane?: DeskPane, extra: DeskExtra = {}): BrowserWindow {
  return desk.open(pane, extra);
}

/** Settings → a pane of the desk (꾸미기 unless named; "calendar" is the old name of 일정). */
function openSettings(tab?: string): void {
  openDesk(readPane(tab, true) ?? "appearance");
}

/** 도움말: every topic, searchable. `topic` / `query` open it at a page (used by snapshots). */
function openHelp(topic?: string, query?: string): void {
  openDesk("help", { ...(topic ? { topic } : {}), ...(query ? { query } : {}) });
}

/** 완료 기록, on a day when given (a search result). */
function openHistory(day?: string): void {
  openDesk("history", day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? { day } : {});
}

/** 검색 (Ctrl+F, ⋯ → 검색…, the desk's 검색): the note, with its search slip. */
function openSearch(): void {
  showNote();
  note.webContents.send("note:row-command", { id: "", command: "search" });
}

/** 달력: the month (or week) with the events and the tasks' deadlines and alerts, on `day` when given. */
function openCalendar(day?: string): void {
  const chosen = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
  openDesk("calendar", chosen ? { day: chosen } : {});
}

/** 사용 안내: the first-launch cards again, on the note. */
function showGuide(): void {
  showNote();
  note.webContents.send("note:row-command", { id: "", command: "guide" });
}

/** A task chosen in the 달력 window: the note, on the page the task is on, with it selected. */
function showTask(id: string): void {
  showNote();
  note.webContents.send("note:row-command", { id, command: "select-task" });
}

/**
 * Day housekeeping: yesterday's finished work goes to the record, then today's recurring
 * copies appear. Runs at launch, every 30 minutes, after waking and right after 4 a.m.
 */
function startDayKeeper(): void {
  const tick = () => {
    archive.run();
    store.placeRecurring();
    store.trackToday();
  };
  let boundary: NodeJS.Timeout | undefined;
  const armBoundary = () => {
    clearTimeout(boundary);
    const next = logicalDayStart(new Date());
    next.setDate(next.getDate() + 1);
    // A new day re-sorts the pages (deadlines come due) even when nothing was archived or placed.
    boundary = setTimeout(() => { tick(); store.changed(); armBoundary(); newDayOnNote(); }, Math.max(1000, next.getTime() - Date.now() + 5000));
  };
  tick();
  armBoundary();
  setInterval(tick, 30 * 60_000);
  powerMonitor.on("resume", () => { tick(); store.changed(); armBoundary(); });
}

/**
 * The note opened, or a new day began with it open: the morning 저녁 정리 (yesterday's leftovers, when
 * the evening never came) and 오늘 꼭 하나 (the empty line asks for the day's one thing).
 */
function newDayOnNote(): void {
  if (snapshotDirectory || !note.isVisible() || note.isMinimized()) return;
  sweep?.noteOpened();
  const today = dayKey(new Date());
  if (store.prefs.morningPick && store.prefs.morningPickDay !== today) {
    store.setPref("morningPickDay", today);
    store.setPref("starredTask", "");
    note.webContents.send("note:row-command", { id: "", command: "morning-pick" });
  }
}

/** The folder with todos.json, memos.json, repeats.json, events.json and archive/, in Explorer. */
function openDataFolder(): void {
  fs.mkdirSync(store.dataDirectory, { recursive: true });
  void shell.openPath(store.dataDirectory);
}

function openArchiveFolder(): void {
  fs.mkdirSync(archive.directory, { recursive: true });
  void shell.openPath(archive.directory);
}

function quit(): void {
  quitting = true;
  note?.webContents.send("note:commit-editing");
  setTimeout(() => app.quit(), 120);
}

function moreMenu(): Menu {
  const prefs = store.prefs;
  const template: MenuItemConstructorOptions[] = [
    { label: t("새 할 일"), accelerator: "CmdOrCtrl+N", click: () => note.webContents.send("note:focus-new") },
    { label: t("검색…"), accelerator: "CmdOrCtrl+F", click: openSearch },
    { label: t("오늘"), accelerator: "CmdOrCtrl+1", click: () => note.webContents.send("note:row-command", { id: "", command: "page-today" }) },
    { label: t("앞으로"), accelerator: "CmdOrCtrl+2", click: () => note.webContents.send("note:row-command", { id: "", command: "page-ahead" }) },
    { label: t("메모"), accelerator: "CmdOrCtrl+3", click: () => note.webContents.send("note:row-command", { id: "", command: "page-memos" }) },
    { label: t("포스트잇으로 접기"), accelerator: "CmdOrCtrl+M", click: () => collapse() },
    // 화면 오른쪽 · 왼쪽에 붙이기 (checked while docked there; again: back where it was).
    { label: t("화면 오른쪽에 붙이기"), type: "checkbox", checked: dockedSide() === "right", click: () => dockNote("right") },
    { label: t("화면 왼쪽에 붙이기"), type: "checkbox", checked: dockedSide() === "left", click: () => dockNote("left") },
    { label: t("글꼴"), submenu: (Object.keys(fontTitles.ko) as NotebookFont[]).map((font) => ({
      label: fontTitles[lang()][font], type: "radio" as const, checked: prefs.font === font, click: () => store.setPref("font", font),
    })) },
    { label: t("글자 크기"), submenu: textSizes.map((size) => ({
      label: textSizeTitles[lang()][size], type: "radio" as const, checked: prefs.textSize === size, click: () => store.setPref("textSize", size),
    })) },
    { label: t("종이냥 설정…"), accelerator: "CmdOrCtrl+,", click: () => openSettings() },
    { label: t("완료 기록…"), accelerator: "CmdOrCtrl+H", click: () => openHistory() },
    { label: t("달력…"), accelerator: "CmdOrCtrl+D", click: () => openCalendar() },
    { label: t("새 일정…"), click: () => calendar.newEvent() },
    { label: t("반복 할 일…"), click: () => openSettings("repeat") },
    { label: t("빠른 메모…"), accelerator: "Ctrl+Alt+M", registerAccelerator: false, click: () => quickMemo.open() },
    { label: t("알람…"), click: () => openSettings("clock") },
    { label: t("사용 안내"), click: showGuide },
    { label: t("도움말…"), accelerator: "F1", click: () => openHelp() },
    { type: "separator" },
    ...petMenu(),
    { type: "separator" },
    { label: t("완료한 일 숨기기"), type: "checkbox", checked: prefs.hideCompleted, click: () => store.setPref("hideCompleted", !prefs.hideCompleted) },
    { label: t("완료한 일 정리"), enabled: store.todayItems.some((item) => item.isCompleted), click: clearCompleted },
    { type: "separator" },
    { label: t("실행 취소"), accelerator: "CmdOrCtrl+Z", enabled: store.history.canUndo, click: () => store.mutate((history) => history.undo()) },
    { label: t("다시 실행"), accelerator: "CmdOrCtrl+Y", enabled: store.history.canRedo, click: () => store.mutate((history) => history.redo()) },
    { type: "separator" },
    { label: t("목록 복사"), accelerator: "CmdOrCtrl+Shift+C", enabled: store.items.length > 0, click: copyList },
    { label: t("텍스트로 내보내기…"), accelerator: "CmdOrCtrl+E", enabled: store.items.length > 0, click: exportList },
    { type: "separator" },
    { label: t("내보내기…"), click: () => void fromStoragePane(exportBackup) },
    { label: t("가져오기…"), click: () => void fromStoragePane(importBackup) },
    { type: "separator" },
    { label: t("종이냥 종료"), click: quit },
  ];
  return Menu.buildFromTemplate(template);
}

/** 종이냥 on/off and the focus timer (a board of its own, whether or not the pet is out), in the tray and the note's ⋯ menu. */
function petMenu(): MenuItemConstructorOptions[] {
  return [
    { label: t("종이냥 펫"), type: "checkbox", checked: store.prefs.petVisible, click: () => store.setPref("petVisible", !store.prefs.petVisible) },
    { label: t("타이머"), submenu: focusTimer.timerMenu() },
  ];
}

/** A toast on the note for something done from a menu, a bubble or the cat (see NoteNotice); only while the note is up. */
function notice(value: NoteNotice): void {
  if (!note || note.isDestroyed() || !note.isVisible() || note.isMinimized()) return;
  note.webContents.send("note:notice", value);
}

/** The tasks 완료한 일 정리 put in the record last (its toast's 되돌리기 brings them back). */
let lastFiled: TodoItem[] = [];

/** 완료한 일 정리: today's finished tasks to the record now, with "N개를 기록으로 옮겼어요 · 되돌리기". */
function clearCompleted(): void {
  lastFiled = archive.fileToday();
  if (lastFiled.length) notice({ icon: "sprout", text: t("{n}개를 기록으로 옮겼어요", { n: lastFiled.length }), undo: "unfile" });
}

/** 되돌리기 after 완료한 일 정리: the tasks leave the record and come back to the list, checked. */
function unfileCompleted(): void {
  const items = lastFiled;
  lastFiled = [];
  if (items.length === 0) return;
  archive.unfile(new Set(items.map((item) => item.id)));
  store.mutate((history) => history.restore(items));
}

/** 날짜 바꾸기 · 내일 하기 · 저녁 정리: tasks due on a day or to 언젠가 (one undo step), and the toast saying where. */
function moveTasks(ids: string[], target: { kind: "day"; day: string } | { kind: "someday" }, text?: string): void {
  if (ids.length === 0) return;
  store.mutate((history) => history.moveAll(ids, target));
  const now = new Date();
  const words = text ?? (target.kind === "day" && target.day === tomorrowKey(now) ? movedTomorrowText(lang()) : movedText(target, now, lang()));
  notice({ icon: target.kind === "someday" ? "box" : "calendar", text: words, undo: "history" });
}

function rowMenu(id: string): Menu {
  const visible = store.todayItems.filter((item) => !store.prefs.hideCompleted || !item.isCompleted);
  const index = visible.findIndex((item) => item.id === id);
  const item = store.items.find((entry) => entry.id === id);
  if (!item) return Menu.buildFromTemplate([]);
  const onToday = index >= 0;
  const send = (command: string) => note.webContents.send("note:row-command", { id, command });
  const moveTo = (target: number, after: boolean) => store.mutate((history) => {
    const targetIndex = history.items.findIndex((entry) => entry.id === visible[target].id);
    history.move(id, targetIndex + (after ? 1 : 0));
  });
  // 일정: a copy of the task as an event (changing one later doesn't change the other).
  const calendarItems: MenuItemConstructorOptions[] = [
    { type: "separator" },
    { label: t("달력에 넣기…"), click: () => calendar.sendTask(id) },
  ];
  // 날짜 바꾸기 ▸ 내일 · 이번 주 금요일 · 다음 주 월요일 · 언젠가 · 날짜 고르기….
  const dateItems: MenuItemConstructorOptions[] = item.isCompleted ? [] : [{
    label: t("날짜 바꾸기"),
    submenu: moveChoices(new Date(), lang()).map((choice) => ({
      label: choice.title,
      click: () => (choice.kind === "pick" ? send("deadline") : choice.kind === "someday" ? moveTasks([id], { kind: "someday" }) : moveTasks([id], { kind: "day", day: choice.day! })),
    })),
  }];
  return Menu.buildFromTemplate([
    ...(item.isCompleted ? [] : [{ label: t("이거 집중"), submenu: focusMenu(id) }, { type: "separator" }] as MenuItemConstructorOptions[]),
    { label: t("고치기"), click: () => send("edit") },
    { label: item.reminderAt ? t("알림 고치기…") : t("알림 설정…"), click: () => send("reminder") },
    { label: item.dueDate ? t("마감 바꾸기…") : t("마감 정하기…"), click: () => send("deadline") },
    // 시간 정하기: a task with a day (on 오늘, or a deadline) can have hours on it.
    ...(item.isCompleted || !rangeDay(item, new Date()) ? [] : [{ label: t("시간 정하기…"), click: () => send("time") }]),
    { label: item.isCompleted ? t("완료 취소") : t("완료 표시"), click: () => store.mutate((history) => history.toggle(id)) },
    { type: "separator" },
    ...(onToday ? [
      ...(item.isCompleted ? [] : [{ label: t("내일 하기"), click: () => moveTasks([id], { kind: "day", day: tomorrowKey(new Date()) }) }]),
      // 오늘 꼭 하나 (when it is on): this task is the day's one thing, starred at the top of 다음.
      ...(item.isCompleted || !store.prefs.morningPick ? [] : [{
        label: t("오늘 꼭 하나"), type: "checkbox" as const, checked: store.prefs.starredTask === id && store.prefs.morningPickDay === dayKey(new Date()),
        click: () => {
          const starred = store.prefs.starredTask === id && store.prefs.morningPickDay === dayKey(new Date());
          store.setPref("morningPickDay", dayKey(new Date()));
          store.setPref("starredTask", starred ? "" : id);
        },
      }]),
      ...(item.dueDate ? [] : [{ label: t("언젠가로 옮기기"), click: () => store.mutate((history) => history.setShelf(id, "later")) }]),
      ...dateItems,
      { label: t("위로 이동"), enabled: index > 0, click: () => moveTo(index - 1, false) },
      { label: t("아래로 이동"), enabled: index < visible.length - 1, click: () => moveTo(index + 1, true) },
    ] as MenuItemConstructorOptions[] : [
      { label: t("오늘 하기"), click: () => store.mutate((history) => history.setShelf(id, item.dueDate ? "today" : undefined)) },
      ...dateItems,
    ] as MenuItemConstructorOptions[]),
    ...calendarItems,
    { type: "separator" },
    { label: t("지우기"), click: () => { store.mutate((history) => history.delete(id)); notice({ icon: "trash", text: t("지웠어요"), undo: "history" }); } },
  ]);
}

/** A row of the 오늘 일정 strip (or of the 달력 window's day panel, whose sheet opens there), right-clicked. */
function eventMenu(key: string, inCalendar = false): Menu {
  if (!calendar.find(key)) return Menu.buildFromTemplate([]);
  const edit = (confirmDelete: boolean) => (inCalendar
    ? calendar.editEvent(key, confirmDelete, (request) => desk.sendAll("calendar:event-sheet", request))
    : calendar.editEvent(key, confirmDelete));
  return Menu.buildFromTemplate([
    { label: t("고치기…"), click: () => edit(false) },
    { label: t("할 일로 추가"), click: () => calendar.addAsTask(key) },
    { type: "separator" },
    { label: t("지우기…"), click: () => edit(true) },
  ]);
}

/** The note, shown, with the event sheet open on it. */
function openEventSheet(request: CalendarSheetRequest): void {
  if (!snapshotDirectory) showNote(); // snapshots keep the note off-screen and unfocused
  note.webContents.send("note:event-sheet", request);
}

function copyList(): void {
  clipboard.writeText(store.plainText());
}

async function exportList(): Promise<void> {
  const result = await dialog.showSaveDialog(note, {
    title: t("텍스트로 내보내기"), defaultPath: `${t("종이냥")}.txt`, filters: [{ name: t("텍스트"), extensions: ["txt"] }],
  });
  if (result.canceled || !result.filePath) return;
  fs.writeFileSync(result.filePath, store.plainText(), "utf8");
}

// ─── 백업 · 옮기기 ────────────────────────────────────────────────────────────

/** "Windows 1.16.0": where a backup was made, shown when it is imported. */
const backupSource = () => `Windows ${app.getVersion()}`;
/** Questions and file pickers sit over the desk while it is up (its 저장과 백업 · 꾸미기 panes ask them), else over the note. */
const dialogParent = (): BrowserWindow => (desk?.isVisible ? desk.browserWindow! : note);

/** Edits still open in the note (a title being typed, a memo) are saved before the folder is read. */
async function settleEditing(): Promise<void> {
  note.webContents.send("note:commit-editing");
  await new Promise((resolve) => setTimeout(resolve, 150));
  store.flush();
}

/** The menus' 내보내기… and 가져오기…: the desk's 저장과 백업 pane first, then the question over it. */
async function fromStoragePane(run: () => Promise<void>): Promise<void> {
  const window = openDesk("storage");
  await desk.ready();
  if (!window.isVisible()) await new Promise<void>((resolve) => { window.once("show", () => resolve()); setTimeout(resolve, 1500); });
  await run();
}

/** 내보내기…: everything in the storage folder in one .jongi file, then that file in Explorer. */
async function exportBackup(): Promise<void> {
  await settleEditing();
  const parent = dialogParent();
  const result = await dialog.showSaveDialog(parent, {
    title: t("내보내기"), defaultPath: path.join(app.getPath("documents"), backupFileName(new Date(), lang())),
    filters: [{ name: t("종이냥 백업"), extensions: ["jongi"] }],
  });
  if (result.canceled || !result.filePath) return;
  try {
    writeFileAtomically(result.filePath, makeBackup(readDataFiles(store.dataDirectory), backupSource(), new Date()));
  } catch {
    await ask(parent, { icon: "warning", title: t("내보내기"), message: t("내보내지 못했어요."), detail: result.filePath, buttons: [{ label: t("확인"), kind: "primary" }], cancelId: 0 });
    return;
  }
  shell.showItemInFolder(result.filePath);
}

/**
 * 가져오기…: a .jongi (or .json) file, read and checked through before anything changes; then
 * 합치기 or 바꾸기 (asked once more). The folder as it was goes to backups/ first.
 */
async function importBackup(): Promise<void> {
  const parent = dialogParent();
  const picked = await dialog.showOpenDialog(parent, {
    title: t("가져오기"), buttonLabel: t("가져오기"), properties: ["openFile"],
    filters: [{ name: t("종이냥 백업"), extensions: ["jongi", "json"] }],
  });
  const file = picked.filePaths[0];
  if (picked.canceled || !file) return;
  const warn = (message: string, detail?: string) => ask(parent, { icon: "warning", title: t("가져오기"), message, ...(detail ? { detail } : {}), buttons: [{ label: t("확인"), kind: "primary" }], cancelId: 0 });
  let parsed: ReturnType<typeof parseBackup>;
  try {
    if (fs.statSync(file).size > 512 * 1024 * 1024) throw new Error("too large");
    parsed = parseBackup(fs.readFileSync(file, "utf8"), lang());
  } catch {
    await warn(t("파일을 읽지 못했어요."), path.basename(file));
    return;
  }
  if ("error" in parsed) {
    await warn(parsed.error, path.basename(file));
    return;
  }
  const { backup } = parsed;
  const when = exportedText(backup.exportedAt, lang());
  const response = await ask(parent, {
    icon: "box", title: t("가져오기"), message: t("이 백업을 가져올까요?"), size: "m",
    detail: [
      path.basename(file),
      when ? t("{from}에서 {when} 내보냄", { from: backup.from ?? t("종이냥"), when }) : t("{from}에서 내보냄", { from: backup.from ?? t("종이냥") }),
      summaryText(summary(backup.files), lang()),
      "",
      t("합치기: 지금 것은 그대로 두고 없는 것만 더해요."),
      t("바꾸기: 지금 것을 모두 이 백업으로 바꿔요."),
    ].join("\n"),
    buttons: [{ label: t("취소"), kind: "ghost" }, { label: t("바꾸기"), kind: "danger" }, { label: t("합치기"), kind: "primary" }], cancelId: 0,
  });
  if (response === 0) return;
  const mode = response === 1 ? "replace" : "merge";
  if (mode === "replace") {
    const sure = await ask(parent, {
      icon: "warning", title: t("바꾸기"), message: t("지금 있는 할 일 · 메모 · 일정 · 기록이 이 백업으로 바뀌어요. 바꾸기 전 상태는 자동으로 백업해 둘게요."),
      buttons: [{ label: t("취소"), kind: "ghost" }, { label: t("바꾸기"), kind: "primary", clay: true }], cancelId: 0, size: "m",
    });
    if (sure !== 1) return;
  }
  await settleEditing();
  let files: BackupFiles;
  try {
    files = importInto(store.dataDirectory, settingsDirectory, backup.files, mode, backupSource(), new Date()).files;
  } catch {
    store.reloadAll();
    await warn(t("가져오지 못했어요. 지금 목록은 그대로예요."), store.dataDirectory);
    return;
  }
  store.reloadAll();
  const done = await ask(parent, {
    icon: "box", title: t("가져오기"), message: t("가져왔어요."), detail: `${summaryText(summary(files), lang())}\n${t("바꾸기 전 상태는 ‘backups’ 폴더에 있어요.")}`,
    buttons: [{ label: t("백업 폴더 열기"), kind: "ghost" }, { label: t("확인"), kind: "primary" }], cancelId: 1, size: "m",
  });
  if (done === 0) void shell.openPath(backupsFolder(settingsDirectory));
}

// ─── Where the list lives ─────────────────────────────────────────────────────

/**
 * Moves the list to `folder` (undefined: back to this PC). A folder that already holds a list asks
 * which one to keep; otherwise this list is copied there. Then the app starts over to use it.
 */
async function switchStorage(folder: string | undefined): Promise<void> {
  const target = folder ?? settingsDirectory;
  if (sameFolder(target, store.dataDirectory, process.platform === "win32")) return;
  const parent = dialogParent();
  let copy = true;
  if (hasList(target)) {
    const response = await ask(parent, {
      icon: "folder", title: t("저장 위치"), size: "m",
      message: folder ? t("이 폴더에 이미 종이냥 목록이 있어요.") : t("이 PC에 전에 쓰던 목록이 있어요."),
      detail: folder
        ? t("‘그 목록 쓰기’는 폴더에 있던 목록을 그대로 쓰고, ‘지금 목록으로 바꾸기’는 지금 이 목록으로 덮어써요. 종이냥이 다시 시작돼요.")
        : t("‘그 목록 쓰기’는 공유 폴더로 옮기기 전의 목록으로 돌아가고, ‘지금 목록으로 바꾸기’는 지금 보고 있는 목록을 이 PC로 가져와요. 종이냥이 다시 시작돼요."),
      buttons: [{ label: t("취소"), kind: "ghost" }, { label: t("지금 목록으로 바꾸기"), kind: "ghost" }, { label: t("그 목록 쓰기"), kind: "primary" }], cancelId: 0,
    });
    if (response === 0) return;
    copy = response === 1;
  }
  store.flush();
  try {
    if (copy) copyData(store.dataDirectory, target);
    else mergeArchive(store.dataDirectory, target);
    writeDataFolder(settingsDirectory, folder);
  } catch {
    await ask(parent, { icon: "warning", title: t("저장 위치"), message: t("이 폴더에 목록을 저장하지 못했어요."), detail: target, buttons: [{ label: t("확인"), kind: "primary" }], cancelId: 0 });
    return;
  }
  app.relaunch();
  quit();
}

async function chooseStorage(): Promise<void> {
  const parent = dialogParent();
  const result = await dialog.showOpenDialog(parent, {
    title: t("종이냥 목록을 둘 폴더"), buttonLabel: t("이 폴더 쓰기"), properties: ["openDirectory", "createDirectory", "promptToCreate"],
  });
  const folder = result.filePaths[0];
  if (result.canceled || !folder) return;
  await switchStorage(sameFolder(folder, settingsDirectory, process.platform === "win32") ? undefined : folder);
}

/** A parsed alert or day sent by a window, checked and written the way the files keep them. */
function parsedWhen(value: ParsedWhen): { reminderAt?: string; dueDate?: string } {
  const at = value.reminderAt ? new Date(value.reminderAt) : undefined;
  return {
    reminderAt: at && !Number.isNaN(at.getTime()) ? isoDate(at) : undefined,
    dueDate: value.dueDate && /^\d{4}-\d{2}-\d{2}$/.test(value.dueDate) ? value.dueDate : undefined,
  };
}

// ─── Weekly look-back ─────────────────────────────────────────────────────────

/** Sunday evening, once a week: the pet cheers and says how many tasks were finished. */
function lookBack(): void {
  if (!pet?.isShown) return;
  // `--weekly-now 2026-10-04T19:00:00+09:00` checks the Sunday cheer on any day.
  const index = process.argv.indexOf("--weekly-now");
  const now = index >= 0 ? new Date(process.argv[index + 1]) : new Date();
  const result = weeklyLookback(now, archive.all(), store.prefs.lookbackWeek, lang());
  if (!result) return;
  store.setPref("lookbackWeek", result.week);
  pet.say(result.message, 10);
  pet.cheer();
}

function handle(action: Action, sender: Electron.WebContents, frame?: WebFrameMain | null): void {
  switch (action.type) {
    case "add": {
      const { reminderAt, dueDate } = parsedWhen(action);
      return store.mutate((history) => history.addTo(action.title, undefined, new Date(), dueDate, reminderAt));
    }
    case "rename": return store.mutate((history) => history.edit(action.id, action.title));
    case "toggle": return store.mutate((history) => history.toggle(action.id));
    case "delete": return store.mutate((history) => history.delete(action.id));
    case "move": return store.mutate((history) => {
      const target = history.items.findIndex((item) => item.id === action.targetID);
      if (target >= 0 && action.id !== action.targetID) history.move(action.id, target + (action.after ? 1 : 0));
    });
    case "clearCompleted": return clearCompleted();
    case "unfileCompleted": return unfileCompleted();
    case "undo": return store.mutate((history) => history.undo());
    case "redo": return store.mutate((history) => history.redo());
    case "setReminder": return store.mutate((history) => history.setReminder(action.id, action.at ? new Date(action.at) : undefined));
    case "setRange": {
      const range = action.start === undefined ? undefined : { start: action.start, ...(action.end !== undefined ? { end: action.end } : {}) };
      if (range && !validRange(range)) return;
      return store.mutate((history) => history.setRange(action.id, range));
    }
    case "saveSeries": store.saveSeries(action); return;
    case "deleteSeries": return store.deleteSeries(action.id);
    case "setDeadline": return store.mutate((history) => {
      if (action.dueDate) history.setDeadline(action.id, action.dueDate, Boolean(action.keepOnToday));
      else history.setDue(action.id, undefined);
    });
    case "moveToLater": return store.mutate((history) => history.setShelf(action.id, "later"));
    case "moveTasks": {
      const target = action.target;
      if (target.kind === "day" && !/^\d{4}-\d{2}-\d{2}$/.test(target.day)) return;
      return store.mutate((history) => history.moveAll(action.ids, target));
    }
    case "dropOnTab": return store.mutate((history) => {
      const item = history.items.find((entry) => entry.id === action.id);
      const drop = item ? tabDrop(item, action.tab, new Date()) : undefined;
      if (drop?.kind === "deadline") history.setDeadline(action.id, drop.dueDate, false);
      else if (drop?.kind === "later") history.shelveForLater(action.id);
    });
    case "dropAhead": {
      const target = action.target;
      if (target.kind === "day" && !/^\d{4}-\d{2}-\d{2}$/.test(target.day)) return;
      return store.mutate((history) => history.dropAhead(action.id, target, action.near));
    }
    case "openNote": return showNote();
    case "chooseStorage": void chooseStorage(); return;
    case "resetStorage": void switchStorage(undefined); return;
    case "memoUpdate": return store.updateMemo(action.id, action.text, action.from);
    case "memoDelete": return store.deleteMemo(action.id);
    case "memoClose": return store.closeMemo(action.id);
    case "memoRestore": return store.restoreMemo();
    case "editingReminder":
      store.editingReminderID = action.id;
      return store.changed();
    case "setPref": return setPref(action.key, action.value);
    case "collapse": return collapse(action.anchor);
    case "openSettings": return openSettings(action.tab);
    case "deskPane": return desk.choose(action.pane);
    case "openGuide": return showGuide();
    case "timerCommand": return focusTimer.command(action.command);
    case "focus": return focusCommand(action.command);
    case "chatterPreview": return pet?.speakUp();
    case "openHistory": return openHistory(action.day);
    case "openSearch": return openSearch();
    case "openCalendar": return openCalendar(action.day);
    case "exportBackup": void exportBackup(); return;
    case "importBackup": void importBackup(); return;
    case "calendarShowTask": return showTask(action.id);
    case "openHelp": return openHelp();
    case "openArchiveFolder": return openArchiveFolder();
    case "openDataFolder": return openDataFolder();
    case "previewReminder": return periodic.preview();
    case "snoozePeriodic": return periodic.snooze(action.minutes);
    case "copyList": return copyList();
    case "exportList": void exportList(); return;
    case "showMenu": {
      const window = BrowserWindow.fromWebContents(sender);
      if (window) moreMenu().popup({ window, x: Math.round(action.x), y: Math.round(action.y) });
      return;
    }
    case "showRowMenu": {
      rowMenu(action.id).popup({ window: note });
      return;
    }
    case "calendarNewEvent": return calendar.newEvent(action.at);
    case "calendarEditEvent": return calendar.editEvent(action.key);
    case "showEventMenu": {
      const inCalendar = desk.isCalendarFrame(frame);
      eventMenu(action.key, inCalendar).popup({ window: inCalendar ? desk.browserWindow! : note });
      return;
    }
    // 빠른 입력 with Ctrl+Enter: the line as an event.
    case "quickEvent": {
      const { reminderAt, dueDate } = parsedWhen(action);
      return calendar.quickEvent(action.title, reminderAt, dueDate);
    }
    case "alarmSave": {
      const alarm = readAlarm(action.alarm);
      return alarm ? store.putAlarm(alarm) : undefined;
    }
    case "alarmDelete": return store.removeAlarm(action.id);
    case "showStorageProblem":
      void ask(note, { icon: "warning", title: t("저장 확인 필요"), message: store.storageError ?? "", buttons: [{ label: t("확인"), kind: "primary" }], cancelId: 0, size: "m" });
      return;
    case "window":
      if (action.command === "quit") return quit();
      if (action.command === "minimize") return note.minimize();
      return note.close();
  }
}

// ─── 집중 ─────────────────────────────────────────────────────────────────────

/**
 * The task a line's "보고서 25분 집중" means: an open one with that title (trimmed, case ignored;
 * today's first), else a new one on today's page. `made` says it was just made.
 */
function focusTask(title: string): { id?: string; made: boolean } {
  const wanted = title.trim().toLowerCase();
  const open = store.items.filter((item) => !item.isCompleted && item.title.trim().toLowerCase() === wanted);
  const found = open.find((item) => pageOf(item, new Date()) === "today") ?? open[0];
  if (found) return { id: found.id, made: false };
  let made: { id: string } | undefined;
  store.mutate((history) => { made = history.addTo(title.trim(), undefined, new Date()); });
  return { id: made?.id, made: Boolean(made) };
}

/** The focus card's buttons and the menus' 이거 집중; Esc/× asks first. */
function focusCommand(command: FocusCommand): void {
  if (command.kind === "askStop") {
    if (!focusTimer.focusing) return;
    // Time is up or the break is over: closing loses nothing — it ends like 다음에, no question (as on the Mac).
    const stage = focusTimer.focusView()?.stage;
    if (stage === "timeUp" || stage === "breakOver") { focusTimer.focus({ kind: "later" }); return; }
    void ask(note, {
      icon: "timer", title: t("집중"), message: t("집중을 그만둘까요?"), detail: t("여기까지 한 시간은 집중 기록에 남아요."),
      buttons: [{ label: t("계속하기"), kind: "ghost" }, { label: t("그만두기"), kind: "primary" }], cancelId: 0,
    }).then((answer) => { if (answer === 1) focusTimer.focus({ kind: "later" }); });
    return;
  }
  if (command.kind === "custom") {
    const item = store.items.find((entry) => entry.id === command.taskId);
    if (item) timerSheet.open((minutes) => focusTimer.focus({ kind: "start", taskId: item.id, title: item.title, minutes }));
    return;
  }
  if (command.kind === "start" && command.taskId) {
    const item = store.items.find((entry) => entry.id === command.taskId);
    if (!item) return;
    // 시간 정하기: a task with hours today runs for what is left of them unless a length was chosen.
    const left = command.minutes === undefined && !command.pomodoro ? rangeFocusMinutes(item, new Date()) : undefined;
    return focusTimer.focus({ ...command, title: item.title, ...(left ? { minutes: left } : {}) });
  }
  focusTimer.focus(command);
}

/** 할 일 골라 집중…: the note on 오늘, its rows offering 집중. */
function pickFocus(): void {
  if (!snapshotDirectory) showNote();
  note.webContents.send("note:row-command", { id: "", command: "pick-focus" });
}

/** The row menu's 이거 집중 ▸: the Pomodoro's focus length, 50분, the recent lengths, 직접 정하기…, 뽀모도로로. */
function focusMenu(id: string): MenuItemConstructorOptions[] {
  const focusMinutes = pomodoroSettings(store.prefs).focusMinutes;
  const start = (minutes: number) => () => focusCommand({ kind: "start", taskId: id, minutes });
  const lengths = [focusMinutes, ...[50, ...(store.prefs.timerRecent ?? [])].filter((value, index, all) => value !== focusMinutes && all.indexOf(value) === index)];
  // 시간 정하기: a task with hours today offers what is left of them first.
  const task = store.items.find((item) => item.id === id);
  const left = task ? rangeFocusMinutes(task, new Date()) : undefined;
  return [
    ...(left ? [{ label: t("{minutes}분 (남은 시간)", { minutes: left }), click: start(left) }] : []),
    ...lengths.filter((minutes) => minutes !== left).map((minutes) => ({ label: minutes === focusMinutes ? t("{minutes}분 (기본)", { minutes }) : t("{minutes}분", { minutes }), click: start(minutes) })),
    { label: t("직접 정하기…"), click: () => focusCommand({ kind: "custom", taskId: id }) },
    { type: "separator" },
    { label: t("뽀모도로로"), click: () => focusCommand({ kind: "start", taskId: id, pomodoro: true }) },
  ];
}

// ─── 입력 줄 ─────────────────────────────────────────────────────────────────

/** Puts a reading of the 입력 줄 in: what was made (to take back with the toast), or why not. */
function intentCommit(candidate: WireCandidate, page: IntentPage): IntentResult {
  const now = new Date();
  switch (candidate.kind) {
    case "todo": {
      const { reminderAt, dueDate } = parsedWhen(candidate);
      let made: { id: string } | undefined;
      // 시간 정하기 from the line ("3시부터 5시까지"): its day is today or the deadline it came with, on any page.
      // (An end at 04:00 — the day's last hour, from the 하루 일정표 — is kept as a start alone: it's drawn to 04:00 all the same.)
      const range = !candidate.range ? undefined
        : validRange({ start: candidate.range.start, end: candidate.range.end }) ? { start: candidate.range.start, end: candidate.range.end }
        : validRange({ start: candidate.range.start }) && candidate.range.end === 240 ? { start: candidate.range.start } : undefined;
      store.mutate((history) => {
        if (range) made = history.addTo(candidate.title, undefined, now, dueDate, reminderAt, range);
        // 앞으로: a date (or an alert on a later day) puts it on that day; without one it goes to 언젠가.
        else if (page === "ahead") {
          const day = dueDate ?? (reminderAt && dayKey(new Date(reminderAt)) > dayKey(now) ? dayKey(new Date(reminderAt)) : undefined);
          made = history.addTo(candidate.title, day || reminderAt ? undefined : "later", now, day, reminderAt);
        } else made = history.addTo(candidate.title, undefined, now, dueDate, reminderAt);
      });
      return made ? { made: { kind: "todo", id: made.id } } : { error: "empty" };
    }
    case "event": {
      const result = calendar.createFromLine(candidate.title, candidate.day, candidate.allDay, candidate.start, candidate.end, now, candidate.repeat ?? "none");
      return "id" in result ? { made: { kind: "event", id: result.id } } : { error: result.error };
    }
    case "repeat": {
      // A repeating to-do (repeats.json); today's copy comes onto the list when the rule applies today.
      const id = store.saveSeries({ title: candidate.title, rule: candidate.rule, ...(candidate.time ? { remindAt: candidate.time } : {}) }, now);
      return id ? { made: { kind: "repeat", id } } : { error: "empty" };
    }
    case "timer": {
      // "보고서 25분 집중": a focus on that task (made on today's page when there is none).
      if (candidate.title?.trim()) {
        const { id, made } = focusTask(candidate.title);
        if (!id) return { error: "empty" };
        focusTimer.focus({ kind: "start", taskId: id, title: candidate.title.trim(), minutes: candidate.minutes });
        return { made: { kind: "timer", ...(made ? { id } : {}) } };
      }
      focusTimer.command({ kind: "countdown", minutes: candidate.minutes });
      return { made: { kind: "timer" } };
    }
    case "alarm": {
      const alarm = readAlarm({ ...newAlarm(now), time: candidate.time, days: candidate.days, label: candidate.label });
      if (!alarm) return { error: "alarm" };
      store.putAlarm(alarm);
      return { made: { kind: "alarm", id: alarm.id } };
    }
    case "memo": {
      const id = store.addMemoText(candidate.text);
      return id ? { made: { kind: "memo", id } } : { error: "empty" };
    }
  }
}

/** Takes back what a reading made: no trace, no line in the record. */
function intentUndo(made: IntentMade): void {
  if (made.kind === "todo" && made.id) store.mutate((history) => history.retract(made.id!));
  else if (made.kind === "event" && made.id) calendar.removeFromLine(made.id);
  else if (made.kind === "timer") {
    // A focus started from the line ends without a trace (and the task it made goes too).
    if (focusTimer.focusing) focusTimer.discardFocus(); else focusTimer.command({ kind: "stop" });
    if (made.id) store.mutate((history) => history.retract(made.id!));
  }
  else if (made.kind === "alarm" && made.id) store.removeAlarm(made.id);
  else if (made.kind === "memo" && made.id) store.discardMemo(made.id);
  else if (made.kind === "repeat" && made.id) store.retractSeries(made.id);
}

function intentRequest(request: IntentRequest): IntentResult {
  if (request.op === "undo") { intentUndo(request.made); return {}; }
  if (request.op === "learn") {
    const memory = learnSwitch({ ...emptyIntentMemory, ...store.prefs.intentLearning, prefer: store.prefs.intentPrefer ?? {} }, request.key, request.from, request.to);
    store.setPref("intentLearning", { streak: memory.streak, order: memory.order });
    store.setPref("intentPrefer", memory.prefer);
    return {};
  }
  const result = intentCommit(request.candidate, request.from === "quick" ? "today" : request.page);
  // 빠른 입력 while the note is up: the card closes at once and the note shows the toast.
  if (result.made && request.from === "quick" && note.isVisible() && !note.isMinimized() && request.candidates && request.text !== undefined) {
    const index = request.candidates.findIndex((entry) => JSON.stringify(entry) === JSON.stringify(request.candidate));
    note.webContents.send("note:toast", { made: result.made, candidates: request.candidates, index: Math.max(0, index), text: request.text });
    return { ...result, inNote: true };
  }
  return result;
}

function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  // 언어 asks first and starts the app again.
  if (key === "language") return void setLanguage(value as LanguageSetting);
  store.setPref(key, value);
}

/**
 * The tray's icon: a simple cat face (assets/tray, drawn by tools/tray-icon.cjs from the Mac's menu-bar
 * face) that stays recognisable at 16–24 px — ink on a light taskbar, warm white on a dark one (an .ico
 * with every size, so Windows picks the one for the display's scaling). On a Mac (demo runs) a template image.
 */
let trayVariant = "";
/** The tray shows its dot: something (an event or a reminder) within the hour (편의 기능 15). */
let trayDot = false;
function trayImage(): Electron.NativeImage {
  const folder = path.join(assetsDirectory, "tray");
  if (process.platform === "darwin") {
    const image = nativeImage.createFromPath(path.join(folder, "catFaceTemplate.png"));
    image.setTemplateImage(true);
    return image;
  }
  trayVariant = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ? "dark" : "light";
  const name = `cat-face-${trayVariant}${trayDot ? "-dot" : ""}`;
  if (process.platform === "win32") return nativeImage.createFromPath(path.join(folder, `${name}.ico`));
  const image = nativeImage.createEmpty();
  for (const [size, scaleFactor] of [[16, 1], [20, 1.25], [24, 1.5], [32, 2], [48, 3]]) {
    image.addRepresentation({ scaleFactor, buffer: fs.readFileSync(path.join(folder, `${name}-${size}.png`)) });
  }
  return image;
}

/** The taskbar turned light or dark: the face follows. */
function refreshTrayImage(): void {
  if (!tray || process.platform === "darwin") return;
  const variant = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ? "dark" : "light";
  if (variant !== trayVariant) tray.setImage(trayImage());
}

/** Something within the hour: the face gets its dot (and loses it after). The tooltip names it. */
function refreshTrayDot(now = new Date()): void {
  const events = nearEvents(now);
  const dot = soonest(events, store.items, now) !== undefined;
  if (dot === trayDot) return;
  trayDot = dot;
  if (tray && process.platform !== "darwin") tray.setImage(trayImage());
}

/**
 * The tray: a click opens the 오늘 창 next to the icon, a right-click the menu (Windows keeps it as the
 * icon's context menu; elsewhere it pops up on a right-click so the left one stays the window's).
 */
function createTray(): void {
  tray = new Tray(trayImage());
  nativeTheme.on("updated", refreshTrayImage);
  tray.on("click", () => glance.toggle(tray?.getBounds()));
  // A double-click (the old habit) opens the note itself.
  tray.on("double-click", () => { glance.hide(); showNote(); });
  if (process.platform !== "win32") tray.on("right-click", () => tray?.popUpContextMenu(Menu.buildFromTemplate(trayMenu())));
  updateTray();
  // The tooltip follows a running timer every second; otherwise what's coming changes by the minute, so a
  // look every ten seconds is plenty (and the main process sleeps in between).
  armTrayLook();
}

let trayLook: NodeJS.Timeout | undefined;
let trayLookFast = false;
/** The next look at the tooltip: in a second while a timer runs, else in ten (re-armed when a timer starts). */
function armTrayLook(): void {
  trayLookFast = focusTimer.isRunning;
  clearTimeout(trayLook);
  trayLook = setTimeout(() => { updateTooltip(); armTrayLook(); }, trayLookFast ? 1000 - (Date.now() % 1000) + 5 : 10_000);
}

/** Today's events and the days either side (kept by the calendar service until the events or the day change). */
function nearEvents(now: Date) {
  return calendar ? calendar.around(now) : expand(store.events, new Date(now.getTime() - 86_400_000), new Date(now.getTime() + 2 * 86_400_000), lang());
}

/** What the tray menu says, so it is built again only when that changed (every change of the list used to rebuild it). */
let trayMenuKey = "";
function updateTray(): void {
  if (!tray) return;
  updateTooltip();
  if (focusTimer.isRunning !== trayLookFast) armTrayLook();
  if (process.platform !== "win32") return;
  const template = trayMenu();
  const key = JSON.stringify(template.map((item) => [item.label, item.type, item.checked, item.enabled]));
  if (key === trayMenuKey) return;
  trayMenuKey = key;
  tray.setContextMenu(Menu.buildFromTemplate(template));
}

let shownTooltip = "";
function updateTooltip(): void {
  refreshTrayDot();
  updateTaskbar();
  const tooltip = trayTooltip();
  if (!tray || tooltip === shownTooltip) return;
  shownTooltip = tooltip;
  tray.setToolTip(tooltip);
}

/** The timer as the 오늘 창 and the tooltip see it, now. */
function glanceTimer(now = Date.now()): GlanceTimer | undefined {
  const view = focusTimer?.view();
  if (!view) return undefined;
  const focus = focusTimer.focusView();
  return {
    remainingMs: view.endsAt !== undefined ? Math.max(0, view.endsAt - now) : view.pausedRemainingMs ?? 0, paused: view.endsAt === undefined, caption: view.caption, countdown: view.countdown,
    ...(focus ? { focus: focus.title } : {}),
  };
}

/**
 * The tray's tooltip, like the Mac's menu bar text: "종이냥 · 12:30" while a timer runs, "종이냥 · 치과
 * 40분" when an event or a reminder starts within the hour, else just "종이냥".
 */
function trayTooltip(now = new Date()): string {
  const events = nearEvents(now);
  const timer = glanceTimer(now.getTime());
  const text = glanceText(events, store.items, timer, now, lang());
  // A timer runs and something comes within the hour (the dot): both, so the dot is named.
  const soon = timer && !timer.paused ? glanceText(events, store.items, undefined, now, lang()) : undefined;
  return [t("종이냥"), text, soon].filter(Boolean).join(" · ");
}

// ─── The taskbar (Windows): progress, the thumbnail toolbar, the badge, the Jump List ───

/** What the taskbar shows now (also read by the demo run on other systems, where nothing is applied). */
let taskbarShown: { progress: ReturnType<typeof taskbarProgress>; buttons: ThumbButton[]; badge?: string } = { progress: { value: -1, mode: "none" }, buttons: [] };
let thumbKey = "";
let shownProgress = "";
let badgeKey = "";

function taskbarTimer(now = Date.now()): TaskbarTimer | undefined {
  const view = focusTimer?.view();
  if (!view) return undefined;
  return { remainingMs: view.endsAt !== undefined ? Math.max(0, view.endsAt - now) : view.pausedRemainingMs ?? 0, durationMs: view.durationMs, paused: view.endsAt === undefined };
}

/** The note's taskbar button: the timer's progress, its ⏸ ⏹ +5 buttons, and the tasks left as a badge (the setting). */
function updateTaskbar(): void {
  if (!note || note.isDestroyed() || snapshotDirectory) return;
  const timer = taskbarTimer();
  const progress = taskbarProgress(timer);
  const buttons = thumbButtons(timer, lang());
  const badge = store.prefs.taskbarBadge ? badgeText(store.remainingCount) : undefined;
  taskbarShown = { progress, buttons: buttons.map((button) => button.id), ...(badge ? { badge } : {}) };
  if (process.platform !== "win32") return;
  // The taskbar is told only what changed (this runs every few seconds).
  const progressKey = `${progress.mode}:${progress.value.toFixed(3)}`;
  if (progressKey !== shownProgress) {
    shownProgress = progressKey;
    note.setProgressBar(progress.value, { mode: progress.mode });
  }
  const key = buttons.map((button) => button.id).join(",");
  if (key !== thumbKey && note.isVisible()) {
    const picture = (name: string) => {
      const image = nativeImage.createFromPath(path.join(assetsDirectory, "taskbar", `${name}.png`));
      const large = path.join(assetsDirectory, "taskbar", `${name}@2x.png`);
      if (fs.existsSync(large)) image.addRepresentation({ scaleFactor: 2, buffer: fs.readFileSync(large) });
      return image;
    };
    const run: Record<ThumbButton, () => void> = {
      pause: () => focusTimer.command({ kind: "togglePause" }), resume: () => focusTimer.command({ kind: "togglePause" }),
      stop: () => (focusTimer.focusing ? focusCommand({ kind: "askStop" }) : focusTimer.command({ kind: "stop" })),
      more: () => (focusTimer.focusing ? focusTimer.focus({ kind: "more" }) : focusTimer.command({ kind: "addMinutes", minutes: 5 })),
    };
    const icons: Record<ThumbButton, string> = { pause: "pause", resume: "play", stop: "stop", more: "plus5" };
    if (note.setThumbarButtons(buttons.map((button) => ({ tooltip: button.tooltip, icon: picture(icons[button.id]), click: run[button.id] })))) thumbKey = key;
  }
  if ((badge ?? "") !== badgeKey) {
    badgeKey = badge ?? "";
    note.setOverlayIcon(badge ? nativeImage.createFromPath(path.join(assetsDirectory, "taskbar", `badge-${badge.replace("+", "plus")}.png`)) : null,
      badge ? t("남은 할 일 {n}개", { n: store.remainingCount }) : "");
  }
}

/** The Jump List (right-click on the taskbar button): 빠른 입력 · 빠른 메모 · 책상 · 25분 집중 · 5분 타이머. */
function setJumpList(): void {
  if (process.platform !== "win32" || demo) return;
  const program = process.execPath;
  const prefix = app.isPackaged ? "" : `"${app.getAppPath()}" `;
  app.setUserTasks(jumpTasks(lang()).map((task) => ({ program, arguments: `${prefix}${task.args}`, title: task.title, description: task.description, iconPath: program, iconIndex: 0 })));
}

/** A launch's request (a Jump List task, the app started again with one): done. */
function runLaunchCommand(command: LaunchCommand): void {
  switch (command) {
    case "quick-entry": return quick.open();
    case "quick-memo": return quickMemo.open();
    case "desk": openDesk(); return;
    case "focus-25": return focusTimer.command({ kind: "countdown", minutes: 25 });
    case "timer-5": return focusTimer.command({ kind: "countdown", minutes: 5 });
    case "search": return openSearch();
  }
}

/** A second launch: a toast's button, a Jump List task, or just the note. */
function secondLaunch(argv: readonly string[]): void {
  const link = readNotifyLink(argv);
  if (link) return runNotifyAction(link);
  const command = launchCommand(argv);
  if (command) return runLaunchCommand(command);
  showNote();
}

// ─── 시스템 알림 (Windows' own notifications) ────────────────────────────────

/** The toasts kept until they're gone (an unreferenced Notification may be collected before it's clicked). */
const toasts = new Set<Notification>();

/** Whether a reminder or alarm that came now also goes to Windows' notifications (the setting). */
function systemContext(locked: boolean) {
  return { petShown: Boolean(pet?.isShown), noteShown: note.isVisible() && !note.isMinimized(), locked };
}

/** A toast with 끝냄 · 10분 뒤 (tasks) or 끄기 · 다시 알림 (an alarm); a click opens the note. */
function postNotice(notice: { kind: "tasks"; ids: string[]; title: string; lines: string[] } | { kind: "alarm"; title: string; lines: string[] }): boolean {
  if (!Notification.isSupported()) return false;
  const [first, second] = notifyButtons(notice.kind, lang());
  const toast = process.platform === "win32"
    ? new Notification({ toastXml: toastXml(notice, lang()) })
    : new Notification({ title: notice.title, body: notice.lines.join("\n"), silent: notice.kind !== "alarm", actions: [{ type: "button", text: first }, { type: "button", text: second }] });
  const forget = () => toasts.delete(toast);
  toast.on("click", () => { forget(); showNote(); });
  toast.on("close", forget);
  // macOS (demo runs): the buttons come back as actions; Windows sends our link to a second launch.
  toast.on("action", (_event, index) => {
    forget();
    if (notice.kind === "tasks") runNotifyAction(index === 0 ? { kind: "done", ids: notice.ids } : { kind: "snooze", ids: notice.ids, minutes: 10 });
    else runNotifyAction(index === 0 ? { kind: "alarmStop" } : { kind: "alarmSnooze" });
  });
  toast.on("show", () => console.log(`system notice shown: ${notice.title}`));
  toast.on("failed", (_event, error) => console.log(`system notice failed: ${error}`));
  toasts.add(toast);
  toast.show();
  lastNotice = { ...notice, at: Date.now() };
  return true;
}
/** The last toast posted (the demo run reads it). */
let lastNotice: Record<string, unknown> | undefined;

/** A toast's button (or a click on it). */
function runNotifyAction(action: NotifyAction): void {
  switch (action.kind) {
    case "open": return showNote();
    case "done": return store.mutate((history) => history.completeAll(action.ids));
    case "snooze": {
      const at = new Date(Date.now() + action.minutes * 60_000);
      return store.mutate((history) => { for (const id of action.ids) if (history.items.some((item) => item.id === id && !item.isCompleted)) history.setReminder(id, at); });
    }
    case "alarmStop": return alarmClock.stop();
    case "alarmSnooze": return alarmClock.snooze(false);
  }
}

/** Task alerts: Windows' notification too, when the setting wants it. */
function taskNotice(items: readonly TodoItem[], locked: boolean): boolean {
  if (snapshotDirectory || items.length === 0 || !wantsSystemNotice(store.prefs.systemNotify, systemContext(locked))) return false;
  const title = items.length > 1 ? t("할 일 알림 · {n}개", { n: items.length }) : t("할 일 알림");
  return postNotice({ kind: "tasks", ids: items.map((item) => item.id), title, lines: items.slice(0, 2).map((item) => item.title) });
}

/** An alarm rang: Windows' notification too, when the setting wants it. */
function alarmNotice(alarm: Alarm): void {
  if (snapshotDirectory || !wantsSystemNotice(store.prefs.systemNotify, systemContext(false))) return;
  const [hour, minute] = alarm.time.split(":").map(Number);
  postNotice({ kind: "alarm", title: t("알람 · {time}", { time: spokenTime(hour, minute, lang()) }), lines: alarm.label ? [alarm.label] : [] });
}

// ─── At launch ────────────────────────────────────────────────────────────────

/**
 * What a launch brings beyond the windows: the Jump List, Windows' link for the toasts' buttons, the
 * login item's argument, the launch's own request (a Jump List task, a toast's button), and — after the
 * third launch by hand while 컴퓨터를 켤 때 같이 열기 is off — the cat's one question about it.
 */
function startExtras(): void {
  setJumpList();
  if (process.platform === "win32" && !demo) {
    if (app.isPackaged) app.setAsDefaultProtocolClient(notifyScheme);
    else app.setAsDefaultProtocolClient(notifyScheme, process.execPath, [path.resolve(app.getAppPath())]);
    if (store.prefs.openAtLogin) app.setLoginItemSettings({ openAtLogin: true, args: [loginFlag] });
  }
  const link = readNotifyLink(process.argv);
  const command = launchCommand(process.argv);
  if (link || command) setTimeout(() => (link ? runNotifyAction(link) : runLaunchCommand(command!)), 900);
  if (demo || startedAtLogin(process.argv)) return;
  // Counted only while 컴퓨터를 켤 때 같이 열기 is off (as on the Mac).
  if (!store.prefs.openAtLogin) store.setPref("manualLaunches", (store.prefs.manualLaunches ?? 0) + 1);
  setTimeout(askLogin, 25_000);
}

/** "저를 켤 때마다 불러 주셨네요. 컴퓨터 켤 때 같이 열까요?" — once, by the cat (when it is out). */
function askLogin(): void {
  if (!shouldAskLogin({ openAtLogin: store.prefs.openAtLogin, asked: store.prefs.loginAsked, manualLaunches: store.prefs.manualLaunches })) return;
  const asked = pet?.ask(t("저를 켤 때마다 불러 주셨네요. 컴퓨터 켤 때 같이 열까요?"), [
    { label: t("열기"), reply: t("좋아요! 내일부터 먼저 와 있을게요."), run: () => store.setPref("openAtLogin", true) },
    { label: t("괜찮아요"), reply: t("알겠어요. 필요할 때 불러 주세요.") },
  ]);
  if (asked) store.setPref("loginAsked", true);
}

// ─── 화면 가장자리에 붙이기 ───────────────────────────────────────────────────

/** ⋯ → 화면 오른쪽에 붙이기 / 왼쪽에 붙이기: the note against that edge at full height; the same again puts it back. */
function dockNote(side: "left" | "right"): void {
  const bounds = note.getBounds();
  const docked = store.memory.docked;
  const area = screen.getDisplayMatching(bounds).workArea;
  const frame = dockFrame(area, bounds, side);
  if (docked && docked.side === side && stillDocked(bounds, frame)) {
    note.setBounds(docked.previous);
    store.remember({ docked: undefined });
    return;
  }
  const previous = docked && stillDocked(bounds, dockFrame(area, bounds, docked.side)) ? docked.previous : bounds;
  note.setBounds(frame);
  store.remember({ docked: { side, previous }, bounds: frame });
}

/** The side the note is docked to now (and still is), for the menu's check mark. */
function dockedSide(): "left" | "right" | undefined {
  const docked = store.memory.docked;
  if (!docked || !note) return undefined;
  const bounds = note.getBounds();
  return stillDocked(bounds, dockFrame(screen.getDisplayMatching(bounds).workArea, bounds, docked.side)) ? docked.side : undefined;
}

/** The tray's menu: the note (with how today stands), then the windows, alerts and the pet. */
function trayMenu(): MenuItemConstructorOptions[] {
  const count = store.remainingCount;
  const description = store.todayItems.length === 0 ? t("새 할 일을 적어 보세요") : count === 0 ? t("다 했어요") : t("{count}개 남음", { count });
  return [
    { label: t("노트 열기 ({description})", { description }), click: showNote },
    { label: t("새 할 일"), click: () => { showNote(); note.webContents.send("note:focus-new"); } },
    { label: t("빠른 입력 (Ctrl+Alt+N)"), click: () => quick.open() },
    { label: t("빠른 메모 (Ctrl+Alt+M)"), click: () => quickMemo.open() },
    { type: "separator" },
    ...nextAlarmItem(),
    { label: t("주기 알림"), type: "checkbox", checked: store.prefs.reminderEnabled, click: () => store.setPref("reminderEnabled", !store.prefs.reminderEnabled) },
    { label: t("1시간 쉬기"), enabled: store.prefs.reminderEnabled, click: () => periodic.snooze(60) },
    { label: t("완료 기록…"), click: () => openHistory() },
    { label: t("달력"), click: () => openCalendar() },
    { label: t("종이냥 설정…"), click: () => openSettings() },
    { label: t("도움말…"), click: () => openHelp() },
    { type: "separator" },
    { label: t("내보내기…"), click: () => void fromStoragePane(exportBackup) },
    { label: t("가져오기…"), click: () => void fromStoragePane(importBackup) },
    { type: "separator" },
    ...petMenu(),
    { type: "separator" },
    { label: t("종이냥 종료"), click: quit },
  ];
}

/** 다음 알람 오전 7:00 in the tray, when an alarm is on; it opens Settings → 시계. */
function nextAlarmItem(): MenuItemConstructorOptions[] {
  const next = alarmClock?.next();
  if (!next) return [];
  return [{ label: t("다음 알람 {time}", { time: spokenTime(next.at.getHours(), next.at.getMinutes(), lang()) }), click: () => openSettings("clock") }];
}

function registerIPC(): void {
  ipcMain.handle("state:get", () => store.state());
  ipcMain.on("state:want", (event) => { if (event.senderFrame) stateFrames.add(event.senderFrame); });
  // The preload asks once, before the page draws (every window speaks the app's language).
  ipcMain.on("lang:get", (event) => { event.returnValue = lang(); });
  ipcMain.handle("act", (event, action: Action) => handle(action, event.sender, event.senderFrame));
  // 밤 종이: asked by every page (and frame) as it loads, before it draws.
  ipcMain.on("paper:get", (event) => { event.returnValue = paperNight(); });
  ipcMain.handle("history:get", () => ({ entries: archive.all(), focus: focusLog.all(), now: Date.now() }));
  ipcMain.handle("memo:new", () => store.addMemo());
  ipcMain.handle("calendar:write", (_event, request: CalendarWriteRequest) => calendar.write(request));
  ipcMain.handle("intent", (_event, request: IntentRequest) => intentRequest(request));
  ipcMain.handle("search", (_event, query: unknown) => (typeof query === "string" && query.length <= 200
    ? search({ items: store.items, memos: store.memos, archive: archive.all(), events: store.events, dueStyle: store.prefs.dueStyle }, query, new Date(), lang())
    : []));
}

/** A believable year of finished tasks for the history snapshot (deterministic, never real data). */
function sampleHistory(): ArchiveEntry[] {
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
function sampleFocus(): FocusRecord[] {
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

async function runSnapshots(directory: string): Promise<void> {
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
  note.webContents.send("note:row-command", { id: "", command: "page-memos" });
  await wait(400);
  await save("memos", note.webContents.capturePage());
  await note.webContents.executeJavaScript(`document.querySelector(".memo-row")?.click()`).catch(() => undefined);
  await wait(400);
  await save("memo-editor", note.webContents.capturePage());
  note.webContents.send("note:row-command", { id: "", command: "page-today" });
  await wait(150);
  note.webContents.send("note:row-command", { id: "", command: "page-memos" });
  await wait(150);
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
  // 밤 종이: every main screen and every slip again, in night paper (snapshots/night/).
  await nightShots(directory, save, wait, settled);
  finishSnapshots(timeblockProblems + stripProblems + await sizeSweep(directory, save, wait, settled));
}

/**
 * The redesign's shots (stage 1): the note with the day ribbon, 다음 and the input line; the line
 * while typing each kind (and a slash it can't read); the toast; ribbon variants; and every slip.
 */
async function redesignShots(save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<void> {
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
  await run(`window.ribbonNow = ${JSON.stringify(new Date(today.getTime() + 19.83 * 3_600_000).toISOString())}; window.dispatchEvent(new Event("ribbon-now"))`);
  await shot("note-ribbon-nothing-ahead");
  await run(`window.ribbonNow = undefined; window.dispatchEvent(new Event("ribbon-now"))`);
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
  for (const [name, text] of [["quick-entry", t("내일 3시 회의")], ["quick-entry-timer", t("타이머 40")], ["quick-entry-empty", ""]] as const) {
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
async function stage2Shots(save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<void> {
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
async function focusShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<void> {
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
    await confirmSlip.showForSnapshot({ icon: "timer", title: t("집중"), message: t("집중을 그만둘까요?"), detail: t("여기까지 한 시간은 집중 기록에 남아요."), buttons: [{ label: t("계속하기"), kind: "ghost" }, { label: t("그만두기"), kind: "primary" }], cancelId: 0 });
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
async function convenienceShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<void> {
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
    for (const [name, notice] of [["deleted", { icon: "trash", text: t("지웠어요"), undo: "history" }], ["tomorrow", { icon: "calendar", text: movedTomorrowText(lang()), undo: "history" }], ["all-done", { icon: "check", text: t("{n}개 끝냈어요", { n: 3 }), undo: "history" }]] as const) {
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
 * 1.24's shots, day and night: the ribbon with task blocks (beside events, two lanes, done, over, a start alone;
 * hovered; a narrow note), rows with their hours, the editor's 시간 with its time list open, the line reading
 * "3시부터 5시까지 보고서", 앞으로 and the desk's week and day panel with a ranged task, the alarm editor's
 * 다시 알림 없음 and a ring without snooze. Each is checked like the size sweep; returns the problems found.
 */
async function timeblockShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
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
  console.log(problems ? `TIMEBLOCK PROBLEMS: ${problems}` : "TIMEBLOCK OK");
  return problems;
}

/**
 * 1.25's shots, day and night: the 하루 띠 in each of its states (something on now — an event, a to-do —, nothing on with
 * the next soon or far off, nothing left, all-day pills with +N, a long title, narrow with one row, tall with three) and
 * the day opened (scrolled to an hour before now, crowded hours side by side with +N, done and late to-dos, reminders, a
 * block picked, the little line a click opens, narrow and tall); then the timer board's width at several times, which
 * must not change within a form. Each note shot is checked like the size sweep; returns the problems found.
 */
async function stripShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
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
    event(t("치과 정기 검진"), 930, 990, "blue", t("연세치과")),
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
    // A crowded hour (side by side, +N), a done and a late to-do, reminders; now 14:20.
    store.replaceEvents([...baseEvents, event(t("점심 약속"), 720, 810, "blue", t("김밥천국"))]);
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

/** A page has painted and its one-off animations are done (runs in a window's page or a desk pane's frame). */
const settledScript = `Promise.all(document.getAnimations()
  .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
  .map((animation) => animation.finished.catch(() => undefined)))
  .then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))`;

/** Runs a script in a desk page's frame (undefined when that page isn't loaded). */
function inPane(page: DeskPage, script: string): Promise<unknown> {
  const frame = desk.frameOf(page);
  return frame ? frame.executeJavaScript(script).catch((error: Error) => `script failed: ${error.message}`) : Promise.resolve(undefined);
}

/**
 * Snapshots: the desk (off-screen, never focused) on `pane`, once that pane's page has loaded and drawn.
 * The first call makes the window; later ones switch the pane the way the sidebar does.
 */
async function showDeskPane(pane: DeskPane, wait: Wait, extra: DeskExtra = {}): Promise<BrowserWindow> {
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
const captureDesk = (wait: Wait): Promise<Electron.NativeImage> => {
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
async function deskShots(save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<void> {
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
    if (pane === "appearance" || pane === "notifications") {
      await inPane("settings", `document.querySelector(".content").scrollTop = 1e6`);
      await wait(300);
      await shot(`settings-${pane}-end`, pane);
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
async function nightShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<void> {
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
  await wait(150);
  send("page-memos");
  await shot("memos");
  await run(`document.querySelector(".memo-row")?.click()`);
  await shot("memo-editor");
  send("page-today");
  await wait(150);
  send("page-memos");
  await wait(150);
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

const glanceStateNames = ["nothing", "event-soon", "timer", "alarm", "many"] as const;
type GlanceStateName = typeof glanceStateNames[number];

/**
 * Snapshots: the app's data for a state of the 오늘 창 — nothing at all; an event within the hour; a
 * timer running; alarms on; many tasks (다음, three more, 외 N개). Returns what puts things back.
 */
function glanceState(name: GlanceStateName): () => void {
  const alarms = [...store.alarms];
  let undo = 0;
  calendar.clearSample();
  store.replaceAlarms([]);
  focusTimer.command({ kind: "stop" });
  if (name === "nothing") store.mutate((history) => { for (const item of [...history.items]) if (history.delete(item.id)) undo += 1; });
  if (name === "event-soon") calendar.showSample();
  if (name === "timer") focusTimer.command({ kind: "countdown", minutes: 25 });
  if (name === "alarm") store.replaceAlarms(alarms.length ? alarms : sampleAlarms());
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
function confirmQuestions(): [string, ConfirmQuestion][] {
  return [
    ["confirm-language", languageQuestion(lang() === "en" ? "nl" : "en")],
    ["confirm-import", { icon: "box", title: t("가져오기"), message: t("이 백업을 가져올까요?"), size: "m", cancelId: 0,
      detail: [`${t("종이냥")}-2026-10-08.jongi`, t("{from}에서 {when} 내보냄", { from: "Mac 1.34.0", when: exportedText(new Date().toISOString(), lang()) ?? "" }), summaryText({ todos: 12, memos: 3, repeats: 2, events: 9, archive: 140, alarms: 3, focus: 18 }, lang()), "", t("합치기: 지금 것은 그대로 두고 없는 것만 더해요."), t("바꾸기: 지금 것을 모두 이 백업으로 바꿔요.")].join("\n"),
      buttons: [{ label: t("취소"), kind: "ghost" }, { label: t("바꾸기"), kind: "danger" }, { label: t("합치기"), kind: "primary" }] }],
    ["confirm-storage", { icon: "folder", title: t("저장 위치"), size: "m", cancelId: 0, message: t("이 폴더에 이미 종이냥 목록이 있어요."),
      detail: t("‘그 목록 쓰기’는 폴더에 있던 목록을 그대로 쓰고, ‘지금 목록으로 바꾸기’는 지금 이 목록으로 덮어써요. 종이냥이 다시 시작돼요."),
      buttons: [{ label: t("취소"), kind: "ghost" }, { label: t("지금 목록으로 바꾸기"), kind: "ghost" }, { label: t("그 목록 쓰기"), kind: "primary" }] }],
  ];
}

/** Three alarms for the snapshots: weekdays 7:00 (기상), every day 13:30 (약 먹기, soft), once 22:00 (off). */
function sampleAlarms(): Alarm[] {
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
function listMenus(): void {
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
function openDay(open: boolean): void {
  store.setPref("dayOpen", open ? dayKey(new Date()) : "");
}

/** The run's exit code says whether the size sweep found layout problems. */
function finishSnapshots(problems: number): void {
  quitting = true;
  if (problems > 0) app.exit(1);
  else app.quit();
}

/**
 * The note's top row at every width, font and page, with two-digit counts: the tabs must not
 * run under the tools, nothing may be cut off, and every tab and tool must be clickable (not
 * inside a drag region). Prints one line per case and saves the narrowest and widest.
 */
async function checkHeader(save: (name: string, image?: Promise<Electron.NativeImage>) => Promise<void>, wait: (ms: number) => Promise<unknown>): Promise<void> {
  store.mutate((history) => { for (let index = 0; index < 12; index += 1) { history.add(t("할 일 {n}", { n: index + 1 })); history.addTo(t("나중에 {n}", { n: index + 1 }), "later"); } });
  const problems: string[] = [];
  floating.hide();
  note.showInactive(); // the earlier steps folded it into the post-it
  await wait(500);
  for (const font of ["pen", "brush", "clean"] as NotebookFont[]) {
    store.setPref("font", font);
    for (const width of [350, 380, 420, 520, 720]) {
      note.setSize(width, 560);
      for (const command of ["page-today", "page-ahead", "page-memos"]) {
        note.webContents.send("note:row-command", { id: "", command });
        await wait(160);
        const report = await note.webContents.executeJavaScript(`(() => {
          const r = (el) => el.getBoundingClientRect();
          const tabs = document.querySelector(".index-tabs"), tools = document.querySelector(".tools");
          const out = [];
          if (r(tabs).right > r(tools).left - 16) out.push("tabs within 16px of the tools (" + Math.round(r(tools).left - r(tabs).right) + "px gap)");
          if (r(tools).right > window.innerWidth + 0.5) out.push("tools cut off by " + Math.round(r(tools).right - window.innerWidth) + "px");
          for (const tab of document.querySelectorAll(".index-tab")) {
            const label = tab.querySelector(".tab-label");
            if (label.scrollWidth > label.clientWidth + 1) out.push("label clipped: " + label.textContent);
            if (getComputedStyle(tab).webkitAppRegion === "drag") out.push("tab in drag region");
          }
          for (const button of tools.querySelectorAll("button")) if (getComputedStyle(button).webkitAppRegion === "drag") out.push("tool in drag region");
          // Every tab's whole outline shows: no neighbour over it, nothing clipping its rounded top corners.
          const all = [...document.querySelectorAll(".index-tab")];
          const row = r(document.querySelector(".tabs-row"));
          all.forEach((tab, index) => {
            const box = r(tab);
            const name = tab.querySelector(".tab-label").textContent;
            if (all[index + 1] && box.right > r(all[index + 1]).left + 0.5) out.push("tabs overlap: " + name);
            if (box.top < row.top - 0.5 || box.left < row.left - 0.5 || box.right > window.innerWidth - 0.5) out.push("tab cut: " + name);
            for (const [x, y] of [[box.left + 3, box.top + 3], [box.right - 3, box.top + 3], [box.left + 2, box.bottom - 3], [box.right - 2, box.bottom - 3]]) {
              const hit = document.elementFromPoint(x, y);
              if (!hit || !tab.contains(hit)) { out.push("tab outline covered: " + name); break; }
            }
          });
          const title = document.querySelector(".title");
          if (title.scrollWidth > title.clientWidth + 1) out.push("title clipped: " + title.textContent);
          if (r(document.querySelector(".title-text")).right > r(document.querySelector(".peek")).left + 0.5) out.push("title runs under the cat");
          return out.join("; ");
        })()`);
        const line = `header ${font} ${width} ${command.replace("page-", "")}: ${report || "ok"}`;
        console.log(line);
        if (report) problems.push(line);
      }
      if (width === 350 || width === 720) {
        note.webContents.send("note:row-command", { id: "", command: "page-ahead" });
        note.webContents.invalidate();
        await wait(600);
        // An off-screen window sometimes never delivers a frame; don't let that stall the run.
        const image = await Promise.race([note.webContents.capturePage().catch(() => undefined), wait(3000).then(() => undefined)]);
        if (image) await save(`header-${font}-${width}`, Promise.resolve(image.crop({ x: 0, y: 0, width: image.getSize().width, height: Math.round(image.getSize().height * 100 / 560) })));
        else console.log(`header ${font} ${width}: (capture failed)`);
      }
    }
  }
  // The tab row zoomed, in each state (hovered, a task over 앞으로, 앞으로 open, a task from it over 오늘), for a close look.
  store.setPref("font", "pen");
  note.setSize(420, 560);
  note.webContents.send("note:row-command", { id: "", command: "page-today" });
  await wait(300);
  for (const [state, script] of [["plain", ""], ["hover", `document.querySelector(".tab-ahead").classList.add("hover")`], ["drop", `document.querySelector(".tab-ahead").classList.add("drop-target")`], ["ahead", `document.querySelector(".tab-ahead").click()`], ["ahead-drop", `document.querySelector(".tab-today").classList.add("drop-target")`]] as const) {
    if (script) await note.webContents.executeJavaScript(script);
    await wait(250);
    const check = await note.webContents.executeJavaScript(`(() => { const out = []; const all = [...document.querySelectorAll(".index-tab")];
      all.forEach((tab) => { const b = tab.getBoundingClientRect(); for (const [x, y] of [[b.left + 3, b.top + 3], [b.right - 3, b.top + 3]]) { const hit = document.elementFromPoint(x, y); if (!hit || !tab.contains(hit)) out.push("covered: " + tab.textContent); } });
      return out.join("; "); })()`);
    console.log(`tabs ${state}: ${check || "ok"}`);
    if (check) problems.push(`tabs ${state}: ${check}`);
    const image = await Promise.race([note.webContents.capturePage({ x: 0, y: 0, width: 420, height: 48 }).catch(() => undefined), wait(3000).then(() => undefined)]);
    if (image) await save(`tabs-${state}`, Promise.resolve(image));
    await note.webContents.executeJavaScript(`document.querySelectorAll(".index-tab").forEach((tab) => tab.classList.remove("hover", "drop-target"))`);
  }
  console.log(problems.length ? `HEADER PROBLEMS: ${problems.length}` : "HEADER OK");
  store.setPref("font", defaultPrefs.font);
}

/**
 * Snapshots: 앞으로 as if a task were being dragged — every day of the two weeks and an empty 언젠가
 * shown to drop on, the first dated row lifted, the next day lit up with the landing line on its
 * first row (or the day itself).
 */
const aheadDragScript = `(() => {
  window.dispatchEvent(new Event("snapshot-drag"));
  const rows = [...document.querySelectorAll(".ahead .aday .row")];
  const source = rows[0];
  if (!source) return;
  source.classList.add("dragging");
  const days = [...document.querySelectorAll(".ahead .aday")];
  const target = days.find((day) => !day.contains(source)) ?? days[0];
  target.classList.add("drop-target");
  target.querySelector(".row")?.classList.add("drop-before");
})()`;

/** What the size sweep (and the 1.24 shots) check in the note. */
const noteLayoutChecks: LayoutCheckOptions = {
  ignore: ".peek, .strike, .guide, .scrim",
  inside: [".tabs-row", ".tools button", ".index-tab", ".title-row", ".footer", ".footer > *", ".editor", ".event-sheet", ".event-sheet .tape", ".editor .actions .action", ".memo-bar > *", ".dock", ".inp", ".strip-top", ".strip-lead", ".tt-scroll", ".sheet-pop", ".slip-foot .sbtn",
    ".focus-card", ".fc-top", ".fc-close", ".fc-ring", ".fc-btn", ".fc-foot", ".fc-cat", ".pick-bar", ".pick-cancel", ".focus-pick",
    ".search-slip", ".search-line", ".search-foot", ".row.preview-hover .actions", ".fc-play"],
  oneLine: [".fc-kicker", ".fc-next", ".fc-btn", ".fc-rest", ".fc-row-title", ".pick-text", ".pick-cancel", ".focus-pick", ".group-name", ".group-count", ".footer > *", ".tab-label", ".editor .actions .action", ".seg button", ".quick button:not(.two-line)", ".choice-title", ".choice-sub", ".memo-back", ".move", ".due", ".time",
    ".carry", ".search-head", ".search-meta", ".search-foot .keys > span", ".slip-title",
    ".date-line", ".prog", ".group-head span", ".group-mark span", ".chip", ".sbtn", ".kbd", ".slip-title", ".sheet-toggle", ".range-length",
    ".strip-link", ".ad-pill", ".ad-more", ".tt-title", ".strip-hours span", ".lead-kicker", ".lead-sub", ".strip-nothing", ".rc-text b", ".rc-text small", ".sr-time", ".sr-away",
    ".tt-hour span", ".tb-time", ".tb-title", ".tt-more", ".ttn-when", ".ttn-chip", ".tml-time"],
  rows: [".tabs-row", ".tools", ".index-tabs", ".title-row", ".footer", ".lines > .row", ".editor .actions", ".memo-bar", ".memo-row .text", ".quick", ".custom", ".alert-row", ".month-row", ".time-line", ".search-row", ".search-head", ".actions",
    ".inp-row", ".strip-top", ".strip-lead", ".lead-row", ".strip-row", ".ttn-foot", ".tt-more-list button", ".slip-head", ".slip-foot", ".sheet-row", ".sheet-line", ".prog", ".fc-top", ".fc-btns", ".fc-foot", ".fc-row", ".pick-bar", ".group-head", ".group-mark"],
  // The focus card's column never needs to scroll (only its list does).
  noScroll: [".fc-body"],
  placeholders: [".inp .typed"],
};

type Save = (name: string, image?: Promise<Electron.NativeImage>) => Promise<void>;
type Wait = (ms: number) => Promise<unknown>;

/**
 * Every window at the sizes it can take, saved to snapshots/sweep/ with a layout check per shot
 * (see layoutCheck.ts): the note on every page, with the 오늘 일정 strip and each card open, from
 * 350 × 400 to 720 × 1200; 도움말 and 완료 기록 from their smallest to a 2560 × 1440 screen;
 * 설정 and the note at 125 % and 150 % (zoomed, so the page keeps its CSS size while text is drawn
 * bigger, as Windows display scaling does); and the note and 설정 with Noto Sans KR standing in for
 * Malgun Gothic (taller line metrics, wider Hangul than the Mac's fonts). Returns how many problems
 * it found; the last line is "SWEEP OK" or "SWEEP PROBLEMS: n".
 */
async function sizeSweep(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
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
  const closeCards = async () => { send("close-editor"); await wait(200); };
  const noteStates: NoteState[] = [
    { name: "today", open: async () => send("page-today") },
    // 하루 띠 (1.25): the whole day opened (scrolled to an hour before now), then a block picked with ↓.
    { name: "today-open", open: async () => openDay(true) },
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
    { name: "ahead-end", open: () => run(`document.querySelector(".sheet").scrollTop = 1e6`) },
    { name: "memos", open: async () => send("page-memos") },
    { name: "memo-editor", open: () => run(`document.querySelector(".memo-row")?.click()`), close: async () => { send("page-today"); await wait(150); send("page-memos"); } },
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
  const scaledStates = ["today", "row-hover", "search", "reminder", "repeat", "time-editor", "time-list", "range-chips", "event-new", "ahead", "ahead-drag", "memos", "memo-editor", "focus", "focus-expanded", "focus-pomodoro-up", "pick"];
  await sweepNote([[420, 560]], 1.25, "@125", scaledStates);
  await sweepNote([[420, 560]], 1.5, "@150", scaledStates);
  note.webContents.setZoomFactor(1);
  const fontKey = await note.webContents.insertCSS(windowsFont);
  await sweepNote([[350, 400], [420, 560]], 1, "-noto", ["today", "today-open", "today-open-picked", "row-hover", "search", "reminder", "reminder-other", "repeat", "time-editor", "time-list", "range-chips", "event-new", "ahead", "ahead-drag", "memos", "focus", "focus-expanded", "focus-pomodoro-up", "pick"]);
  // 집중 and the 하루 띠 in the other two fonts (the task's and the strip's titles are in the hand).
  for (const font of ["brush", "clean"] as const) {
    store.setPref("font", font);
    await sweepNote([[350, 400], [420, 560]], 1, `-${font}`, ["today", "today-open", "today-open-picked", "focus", "focus-expanded", "focus-pomodoro-up", "pick", "overhang", "ahead"]);
  }
  store.setPref("font", defaultPrefs.font);
  await note.webContents.removeInsertedCSS(fontKey);
  await size(note, 420, 560);

  // ─── 책상: every pane at the desk's sizes (the sidebar folded under 820), scaled, and with the other font ───
  // Each pane is checked inside its own frame (its viewport is the pane), and the sidebar in the desk's page.
  const paneChecks: Record<DeskPage, LayoutCheckOptions> = {
    settings: {
      ignore: ".ph-cat",
      inside: [".pane-head", ".bottom", ".bottom > *"],
      oneLine: [".pane-head h1", ".segmented button", ".seg button", ".action", ".group > .label", ".tile .name"],
      rows: [".pane-head", ".row", ".bottom", ".form-actions"],
    },
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
    },
    help: {
      ignore: ".topics, .ph-cat",
      inside: [".pane-head", ".search", ".content", ".topics"],
      rows: [".pane-head", ".neighbours", ".found", ".card", ".kicker"],
      oneLine: [".pane-head h1", ".topic", ".chip", ".keys kbd", ".neighbour .title", ".group-title"],
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
      ["confirm-storage", () => ask(2)],
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

  console.log(problems ? `SWEEP PROBLEMS: ${problems}` : "SWEEP OK");
  return problems;
}

// ─── Ctrl+Alt+J: the note shown or put away from anywhere ─────────────────────

const noteAccelerator = "Control+Alt+J";
let noteHotkeyHeld = false;

/** Takes or gives back Ctrl+Alt+J (Settings → 빠른 입력); when another app holds it, Settings says so. */
function updateNoteHotkey(): void {
  if (snapshotDirectory || offscreenEnabled || shortcutsDisabled) return;
  const wanted = store.prefs.noteHotkey;
  if (wanted && !noteHotkeyHeld) {
    try { noteHotkeyHeld = globalShortcut.register(noteAccelerator, toggleNote); } catch { noteHotkeyHeld = false; }
  } else if (!wanted && noteHotkeyHeld) {
    globalShortcut.unregister(noteAccelerator);
    noteHotkeyHeld = false;
  }
  const problem = wanted && !noteHotkeyHeld ? t("다른 앱이 Ctrl+Alt+J를 쓰고 있어 켜지 못했어요. 그 앱의 단축키를 바꾸고 다시 켜 보세요.") : undefined;
  if (problem !== store.noteShortcutProblem) {
    store.noteShortcutProblem = problem;
    store.changed();
  }
}

/** Ctrl+Alt+J: the note comes up (unfolded from the sticky note too), or goes away when it is up in front. */
function toggleNote(): void {
  if (note.isVisible() && !note.isMinimized() && note.isFocused()) {
    note.webContents.send("note:commit-editing");
    note.hide();
    focusTimer?.noteShown();
    return;
  }
  showNote();
}

app.on("second-instance", (_event, argv) => secondLaunch(argv));
app.on("before-quit", () => { quitting = true; store?.flush(); });
app.on("will-quit", () => { quick?.dispose(); quickMemo?.dispose(); if (noteHotkeyHeld) globalShortcut.unregister(noteAccelerator); globalShortcut.unregisterAll(); store?.unwatch(); });
app.on("window-all-closed", () => undefined);

app.whenReady().then(() => {
  const place = directories();
  settingsDirectory = place.settings;
  setLang(appLanguage(place.settings));
  // Google 캘린더 · Tasks are gone: their sign-in and copies on this device go too.
  removeLeftovers(place.settings);
  store = new Store(place.data, demo, place.settings);
  const windows = process.platform === "win32";
  store.storage = {
    label: storageLabel(place.folder, os.homedir(), windows, "PC", lang()) + (place.unavailable ? ` ${t("(열 수 없음)")}` : ""), custom: Boolean(place.folder),
    path: place.data, archivePath: path.join(place.data, "archive"),
  };
  if (place.unavailable) store.storageError = `${t("저장 폴더를 열 수 없어 이 PC의 기본 위치에 저장하고 있어요. 폴더가 다시 보이면 종이냥을 다시 시작하세요.")}\n${place.unavailable}`;
  // Another computer may change the shared files; snapshots work in a throwaway folder and don't watch.
  if (!snapshotDirectory) store.watch();
  archive = new ArchiveStore(store, place.data);
  if (snapshotDirectory) archive.seed(sampleHistory());
  startDayKeeper();
  // 완료 기록 reads the record again only when what it shows changed (finished tasks, another device's files),
  // not on every change of the list (each keystroke in a memo used to make it fetch the whole record).
  let historyKey = "";
  store.on("change", () => {
    const key = JSON.stringify(store.items.filter((item) => item.isCompleted).map((item) => [item.id, item.title, item.createdAt, item.completedAt, item.timeStart, item.timeEnd]));
    if (key === historyKey) return;
    historyKey = key;
    desk.sendAll("history:changed");
  });
  store.on("reloaded", () => desk.sendAll("history:changed"));
  Menu.setApplicationMenu(null);
  registerIPC();
  confirmSlip = new SlipConfirm(rendererDirectory);
  periodicPopup = new ReminderPopup(rendererDirectory);
  taskPopup = new ReminderPopup(rendererDirectory);
  // 밤 종이 before the first window: its background is already the right paper.
  applyPaper();
  nativeTheme.on("updated", refreshPaper);
  store.on("prefs", (key: keyof Prefs) => { if (key === "paper") applyPaper(); });
  desk = new Desk(store, rendererDirectory, {
    webPreferences, icon: path.join(assetsDirectory, "cat.png"), background: () => paperColor(paperNight()), snapshots: Boolean(snapshotDirectory), guide: showGuide, search: openSearch,
    chrome: snapshotDirectory ? "preview" : process.platform === "win32" ? "overlay" : undefined, symbols: () => paperInk2(paperNight()),
  });
  note = createNote();
  floating = new FloatingNote(store, rendererDirectory, showNote, quit);
  const live = !snapshotDirectory && !offscreenEnabled;
  // A timer started, paused or ended: every window hears it (the 오늘 창's card), and the tray.
  focusLog = new FocusLog(place.data, (file) => {
    store.storageError = `${t("집중 기록을 저장하지 못했어요.")}\n${file}`;
    store.changed();
  });
  focusTimer = new FocusTimerWidget(store, rendererDirectory, {
    changed: broadcast, cheer: () => pet?.cheer(), custom: (start) => timerSheet.open(start),
    record: (record) => { if (focusLog.append(record)) desk.sendAll("history:changed"); },
    complete: (taskId) => store.complete(taskId),
    showNote: () => { if (!snapshotDirectory) showNote(); else note.showInactive(); },
    noteVisible: () => note.isVisible() && !note.isMinimized(),
    pick: pickFocus,
    focusEnded: () => taskReminders?.poke(),
    taskTitle: (taskId) => store.items.find((item) => item.id === taskId)?.title,
    chime: () => note.webContents.send("focus:chime"),
    askStop: () => focusCommand({ kind: "askStop" }),
  });
  store.timerView = () => focusTimer.view();
  store.focusView = () => focusTimer.focusView();
  // The note's visibility settles after the event: look a moment later.
  for (const event of ["show", "hide", "minimize", "restore"] as const) note.on(event as "show", () => setTimeout(() => focusTimer.noteShown(), 50));
  glance = new GlanceWindow(rendererDirectory, live);
  timerSheet = new TimerSheet(rendererDirectory, live, (minutes) => focusTimer.command({ kind: "countdown", minutes }));
  quickMemo = new QuickMemo(store, rendererDirectory, live);
  pet = new DesktopPet(store, rendererDirectory, {
    openNote: showNote, changed: updateTray, timerMenu: () => focusTimer.timerMenu(),
    // 종이냥 한마디 waits while the timer runs or a reminder is up; ‘쉴래요’ starts five minutes.
    isBusy: () => focusTimer.isRunning || periodicPopup.isVisible || taskPopup.isVisible,
    rest: () => focusTimer.command({ kind: "countdown", minutes: 5 }),
    focus: () => focusTimer.command({ kind: "countdown", minutes: 25 }),
    // Created after the pet; asked only when the cat speaks up.
    calendar: () => calendar?.chatter(),
    quickMemo: () => quickMemo.open(),
    alarms: () => openSettings("clock"),
  });
  // 시계 알람: every device rings its own; snapshots never ring.
  alarmClock = new AlarmClock(store, rendererDirectory, { petAnchor: () => pet?.anchor(), changed: updateTray, rang: alarmNotice }, live);
  ReminderPopup.petAnchor = () => pet?.anchor();
  ReminderPopup.onPetAlert = () => pet?.greet();
  const hooks = {
    // 집중: the periodic nudge waits too.
    isBusy: () => note.isFocused() || desk.isFocused() || focusTimer.focusing,
    openNote: showNote,
    focusing: () => (focusTimer.focusing ? { taskId: focusTimer.focusTaskId } : undefined),
    moveToTomorrow: (ids: string[]) => {
      if (ids.length === 0) return;
      store.mutate((history) => history.moveAll(ids, { kind: "day", day: tomorrowKey(new Date()) }, { clearReminder: true }));
      notice({ icon: "calendar", text: ids.length > 1 ? t("{n}개를 내일로 옮겼어요", { n: ids.length }) : movedTomorrowText(lang()), undo: "history" });
    },
    systemNotice: (items: readonly TodoItem[], locked: boolean) => taskNotice(items, locked),
    notifyWhileLocked: () => store.prefs.systemNotify !== "off",
    completeAll: (ids: string[]) => {
      const open = ids.filter((id) => store.items.some((item) => item.id === id && !item.isCompleted));
      if (open.length === 0) return;
      store.mutate((history) => history.completeAll(open));
      if (open.length >= 2) notice({ icon: "check", text: t("{n}개 끝냈어요", { n: open.length }), undo: "history" });
    },
  };
  periodic = new PeriodicReminders(store, periodicPopup, taskPopup, hooks);
  // 저녁 정리: in the periodic bubble's window, never over another bubble, an alarm or 집중.
  sweep = new EveningSweep(store, periodicPopup, {
    isBusy: () => focusTimer.focusing || alarmClock.isRinging || taskPopup.isVisible || periodicPopup.isVisible,
    moved: (ids, target, text) => moveTasks(ids, target, text),
    openNote: showNote,
  });
  // (Shown again, or brought forward: both count as opening it; each day's questions come once.)
  if (!snapshotDirectory) for (const event of ["show", "focus"] as const) note.on(event as "show", () => setTimeout(newDayOnNote, 600));
  taskReminders = new TaskReminders(store, taskPopup, () => periodicPopup.hide(), hooks, () => store.prefs.displaySeconds * 1000);
  // 일정: its alerts use the task-alert bubble and wait for a task alert to finish.
  calendar = new CalendarService(store, {
    popup: taskPopup, beforeShow: () => periodicPopup.hide(), durationMs: () => store.prefs.displaySeconds * 1000,
    openSheet: openEventSheet, showCalendar: openCalendar,
  }, { alerts: !snapshotDirectory });
  store.on("change", broadcast);
  store.on("prefs", (key: keyof Prefs) => {
    if (key === "alwaysOnTop") note.setAlwaysOnTop(store.prefs.alwaysOnTop, "floating");
    // Started at sign-in with --at-login, so a launch by hand can be told apart (the cat's question).
    if (key === "openAtLogin" && !demo) app.setLoginItemSettings({ openAtLogin: store.prefs.openAtLogin, ...(process.platform === "win32" ? { args: [loginFlag] } : {}) });
    if (key === "taskbarBadge") updateTaskbar();
  });
  quick = new QuickEntry(store, rendererDirectory, !snapshotDirectory && !offscreenEnabled);
  store.on("prefs", (key: keyof Prefs) => { if (key === "noteHotkey") updateNoteHotkey(); });
  updateNoteHotkey();
  if (!snapshotDirectory && !offscreenEnabled) createTray();
  if (!snapshotDirectory) startExtras();
  // --demo: what the taskbar shows and the last system notice, for checking on any system (nothing else uses these).
  if (demo && !snapshotDirectory) {
    (globalThis as Record<string, unknown>).paperDemo = {
      taskbar: () => taskbarShown, lastNotice: () => lastNotice, trayDot: () => trayDot, tooltip: () => trayTooltip(),
      taskNotice: (ids: string[]) => taskNotice(store.items.filter((item) => ids.includes(item.id)), false),
      sweep: (variant: "evening" | "morning") => sweep.preview(variant), dock: dockNote, launch: runLaunchCommand, notifyAction: runNotifyAction,
      askLogin: () => { store.setPref("manualLaunches", 3); store.setPref("loginAsked", false); askLogin(); },
    };
  }
  if (!snapshotDirectory) {
    setTimeout(lookBack, 8000);
    setInterval(lookBack, 5 * 60_000);
    powerMonitor.on("resume", lookBack);
  }
  if (snapshotDirectory) { for (const record of sampleFocus()) focusLog.append(record); }
  if (snapshotDirectory) void runSnapshots(snapshotDirectory);
});

// Keeps links (none today) out of the app window.
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => { void shell.openExternal(url); return { action: "deny" }; });
  contents.on("will-navigate", (event) => event.preventDefault());
});

