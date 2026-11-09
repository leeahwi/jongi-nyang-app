import { execFileSync } from "node:child_process";
import { BrowserWindow, Menu, Notification, Tray, app, clipboard, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, powerMonitor, screen, shell, systemPreferences, type MenuItemConstructorOptions, type WebFrameMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dayKey, logicalDayStart, type ArchiveEntry } from "../core/archive";
import { finishedThisWeek, lookbackMessage, weeklyLookback } from "../core/lookback";
import { isoDate, type TodoItem } from "../core/notebook";
import { pageOf, tabDrop } from "../core/shelf";
import { folderPlace, sameFolder, storageLabel, type StorageMoved } from "../core/storage";
import { noteOrigin, type Point } from "../core/placement";
import { ArchiveStore } from "./archiveStore";
import { CalendarService } from "./calendar";
import { defaultPrefs, readStateKind, stateChannels, stateSlice, type AppState, type StateKind, type NoteNotice, fontTitles, pomodoroSettings, textStepTitles, type Action, type FocusCommand, type IntentMade, type IntentRequest, type IntentResult, type NotebookFont, type ParsedWhen, type Prefs, type WireCandidate, type IntentPage } from "../core/types";
import { firstDayFromIntl, firstDayFromRegistry, hourCycle, nativeName, resolveLang, setHourCycle, setWeekStart, spokenTime, weekStartSet, type HourCycle, type Lang, type LanguageSetting } from "../core/lang";
import { lang, setLang, t } from "../i18n";
import { dateKey, localDate, weekDays, type CalendarSheetRequest } from "../core/calendar";
import { backupCounts, backupFileName, countsText, exportedText, makeBackup, parseBackup, parseSavedName, savedName, savedWhen, summary, summaryText, type BackupCounts, type BackupFiles, type BackupReason } from "../core/backup";
import { newAlarm, readAlarm, type Alarm } from "../core/alarm";
import { emptyIntentMemory, learnSwitch } from "../core/intent";
import { deskPanes, deskTitleBar, pageOfPane, readPane, type DeskPage, type DeskPane, type PaperSetting } from "../core/desk";
import { darkKinds, drawerKindOf, drawerShown, paperBackground, paperInk2, paperKinds, shownPaper, themeSourceOf, type NightChoice, type PaperChoice, type PaperKind, type PaperLook } from "../core/paper";
import { expand, type EventColor, type LocalEvent } from "../core/events";
import { glanceText, type GlanceTimer } from "../core/glance";
import { offscreen, offscreenEnabled, shortcutsDisabled, testHooks } from "./env";
import { guardOffscreen } from "./offscreenGuard";
import { Desk, type DeskExtra } from "./desk";
import { FloatingNote } from "./floating";
import { NoteEars, earsPreview } from "./noteEars";
import { GlanceWindow } from "./glanceWindow";
import { CalendarWidgets } from "./calendarWidget";
import { stayBehind } from "./stayBehind";
import { lunarCellWidth, scaleFits, widget as makeWidget, widgetScales, type WidgetKind, type WidgetStyle } from "../core/calendarWidget";
import { WidgetSheet } from "./widgetSheet";
import { layoutCheckScript, type LayoutCheckOptions, type LayoutReport } from "./layoutCheck";
import { DesktopPet } from "./pet";
import { TypingCatWindow } from "./typingCat";
import { loadKeyHook } from "./keyHook";
import { typingChatterQuietMs } from "../core/typingCat";
import { catSizes, type CatSize } from "../core/catSize";
import { ReminderPopup } from "./popup";
import { QuickEntry } from "./quick";
import { QuickMemo } from "./quickMemo";
import { MemoDrawer } from "./drawer";
import { emptyTrash, trashMemo } from "../core/memoTrash";
import { addFolder, deleteFolder, restoreFolder, folderName, inboxID, moveNotice, shortcutLabel, placementOf, moveMemo, pinAll, pinnedView, recolorFolder, renameFolder, reorderFolders, setFolderSort, setFolderView, setMemoPaper, setPinned, targetOf } from "../core/memoDrawer";
import { narrowNote, returnPoint, wideNote } from "../core/spaceGroups";
import { movedBlock, movedManyWords, restoredOrder } from "../core/selection";
import { addSpace, deleteSpace, findSpace, historySpaces, spaceIndex, generalName, liveSpaces, moveTodo, newSpaceID, recolorSpace, renameGeneral, renameSpace, reorderSpaces, restoreSpace, seriesSpaceOf, lensFor, lensNone, spaceColor, spaceOf, toSpaceWords, type SpaceChoice } from "../core/todoSpaces";
import { deviceWords } from "../core/spaceDevice";
import { drawerLegacy } from "../core/textSteps";
import { TimerSheet } from "./timerSheet";
import { AlarmClock } from "./alarms";
import { SlipConfirm, type ConfirmQuestion } from "./confirm";
import type { ShortcutSheetGroup } from "../renderer/confirm";
import { keyCaps, noteToggle, quickEntryShortcut, quickMemoShortcut } from "../core/shortcuts";
import { PeriodicReminders, TaskReminders } from "./reminders";
import { backupRefusal, hasList, importInto, moveData, readBackupText, readDataFiles, readDataFolder, removeLeftovers, takeMoved, usableFolder, writeDataFolder, writeFileAtomically, writeMoved } from "./storageFolder";
import { AutoBackup } from "./autoBackup";
import { Store } from "./store";
import { AiConnection, type AiFiles } from "./aiConnect";
import { aiAwayText, aiEntry, aiToastText, aiUndoText, type AiItem, type AiLogEntry } from "../core/ai";
import { FocusTimerWidget } from "./timer";
import { guardWebContents, openExternalSafely, refused, senderPage } from "./security";
import { mayAct, pageChannels, readAction, readCalendarRequest, readIntentRequest, type PageName } from "../core/ipcCheck";
import { widgetPressWhileUp } from "../core/slipMove";
import { FocusLog } from "./focusLog";
import { EveningSweep } from "./sweep";
import { focusRecord, type FocusRecord } from "../core/focus";
import { moveChoices, movedTomorrowText, tomorrowKey } from "../core/carry";
import { search, searchGroupTitle } from "../core/search";
import { snoozeChoices } from "../core/snooze";
import { badgeText, jumpTasks, launchCommand, loginFlag, shouldAskLogin, startedAtLogin, taskbarProgress, thumbButtons, type LaunchCommand, type TaskbarTimer, type ThumbButton } from "../core/taskbar";
import { acceptNotifyAction, makeNonce, notifyButtons, notifyScheme, readNotifyLink, toastXml, wantsSystemNotice, type NotifyAction } from "../core/notify";
import { dockFrame, stillDocked } from "../core/dock";
import { soonest } from "../core/glance";
import { movedText } from "../core/ahead";
import { focusMinutes as rangeFocusMinutes, rangeDay, validRange } from "../core/timeRange";

// Test runs only (#174: not in a release build, env.ts testHooks).
const snapshotDirectory = testHooks ? process.env.PAPERTODO_SNAPSHOT : undefined;
const demo = testHooks && (process.argv.includes("--demo") || Boolean(snapshotDirectory));
const rendererDirectory = path.join(__dirname, "renderer");
const assetsDirectory = path.join(__dirname, "..", "assets");

// Off-screen runs (#92): every window's place and size through one door, from its first moment (offscreenGuard.ts).
if (offscreenEnabled) guardOffscreen();
app.setAppUserModelId("com.noa.PaperTodo");
if (!snapshotDirectory && !app.requestSingleInstanceLock()) app.quit();

let store: Store;
/** AI 연결 (종이냥 for Claude): ai-link.json, the log's toasts, undo and stamps. */
let ai: AiConnection;
let note: BrowserWindow;
let desk: Desk;
let archive: ArchiveStore;
/** 자동 백업 (#139): the backup folder, the daily copy and the copies before an overwrite. */
let backups: AutoBackup;
let tray: Tray | undefined;
let floating: FloatingNote;
/** The cat's ears on the note's top edge (#151). */
let noteEars: NoteEars;
let pet: DesktopPet | undefined;
/** 치면 두드리는 고양이 (#289): its own cat in a corner, apart from the pet. */
let typingCat: TypingCatWindow | undefined;
let focusTimer: FocusTimerWidget;
let focusLog: FocusLog;
let taskReminders: TaskReminders;
let periodicPopup: ReminderPopup;
let taskPopup: ReminderPopup;
let periodic: PeriodicReminders;
let quick: QuickEntry;
let quickMemo: QuickMemo;
let drawer: MemoDrawer;
let timerSheet: TimerSheet;
let alarmClock: AlarmClock;
let calendar: CalendarService;
let confirmSlip: SlipConfirm;
let glance: GlanceWindow;
/** 바탕화면 달력 위젯 (#234) and the day sheet a click on one opens. */
let widgets: CalendarWidgets;
let widgetSheet: WidgetSheet;
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
    // #278: a demo run's folder goes when the run ends (snapshots used to leave one behind each time).
    process.once("exit", () => { try { fs.rmSync(temporary, { recursive: true, force: true }); } catch { /* left for the system */ } });
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
/**
 * The system's clock, 24-hour or 12-hour. Windows keeps it in the user's region settings (Settings → Time & language →
 * Region → short time, `sShortTime`: "HH:mm" is 24-hour, "tt h:mm" or "h:mm tt" 12-hour), which neither
 * app.getLocale() nor Intl sees, so it is read from the registry (with `iTime`, 1 = 24-hour, if the format is missing).
 * Elsewhere, or when that can't be read: what Intl says for the system's locale. Snapshots: each language's own
 * (`PAPERTODO_CLOCK=h12` / `h24` draws them on the other one).
 */
function systemHourCycle(): HourCycle {
  const forced = testHooks ? process.env.PAPERTODO_CLOCK : undefined;
  if (forced === "h12" || forced === "h24") return forced;
  if (snapshotDirectory) return lang() === "en" ? "h12" : "h24";
  if (process.platform === "win32") {
    try {
      const output = execFileSync("reg", ["query", "HKCU\\Control Panel\\International"], { encoding: "utf8", timeout: 1500, windowsHide: true });
      const format = /^\s*sShortTime\s+REG_SZ\s+(.+?)\s*$/m.exec(output)?.[1];
      if (format) return /H/.test(format) ? "h24" : "h12";
      const flag = /^\s*iTime\s+REG_SZ\s+(\d)\s*$/m.exec(output)?.[1];
      if (flag) return flag === "1" ? "h24" : "h12";
    } catch {
      // No reg.exe or no answer in time: Intl below.
    }
  }
  try {
    const cycle = new Intl.DateTimeFormat(app.getSystemLocale() || undefined, { hour: "numeric" }).resolvedOptions().hourCycle;
    return cycle === "h11" || cycle === "h12" ? "h12" : "h24";
  } catch {
    return hourCycle(lang());
  }
}

/**
 * The system's first day of the week (calendar-flows D4): Windows' own setting (설정 → 시간 및 언어 → 지역 형식 → 한 주의
 * 첫날, the registry's `iFirstDayOfWeek`), else the system locale's (Intl's week info). Snapshots keep each language's own.
 */
function systemWeekStart(): string | undefined {
  const forced = testHooks ? process.env.PAPERTODO_WEEKSTART : undefined;
  if (forced) return forced;
  if (snapshotDirectory) return undefined;
  if (process.platform === "win32") {
    try {
      const output = execFileSync("reg", ["query", "HKCU\\Control Panel\\International"], { encoding: "utf8", timeout: 1500, windowsHide: true });
      const found = firstDayFromRegistry(/^\s*iFirstDayOfWeek\s+REG_SZ\s+(\S+)\s*$/m.exec(output)?.[1]);
      if (found) return found;
    } catch {
      // No reg.exe or no answer in time: Intl below.
    }
  }
  try {
    const locale = new Intl.Locale(app.getSystemLocale() || "ko-KR") as Intl.Locale & { getWeekInfo?: () => { firstDay?: number }; weekInfo?: { firstDay?: number } };
    return firstDayFromIntl((locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay);
  } catch {
    return undefined;
  }
}

function appLanguage(settings: string): Lang {
  const forced = testHooks ? process.env.PAPERTODO_LANG : undefined;
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

/**
 * The pages (and the desk's frames) that listen for the state, the parts they listen for, and what each was sent last;
 * the others never hear it (see preload's `on`).
 */
const stateFrames = new Map<WebFrameMain, Map<StateKind, string | undefined>>();

/**
 * #71: each listening page gets its part of the state (StateKind), and only when that part changed since it last got
 * it — a check no longer sends the memos to the note or the list to the 메모 서랍, and an action that says "changed"
 * twice sends once. A new day sends again (pages group by the day). The desk's pages out of sight (the desk hidden or
 * minimized, another pane in front) hear nothing until it shows them again (`deskInSight`).
 */
function broadcast(): void {
  if (stateFrames.size > 0) sendState((frame) => !desk?.outOfSight(frame));
  updateTray();
}

/** The desk shown, restored or turned to another pane: its pages now in sight get what changed meanwhile, at once. */
function deskInSight(showing: boolean): void {
  sendState((frame) => desk.owns(frame) && !desk.outOfSight(frame, showing));
}

/** Sends each listening frame that `wanted` takes the parts that changed since it last got them. */
function sendState(wanted: (frame: WebFrameMain) => boolean): void {
  let state: AppState | undefined;
  let day: string | undefined;
  const parts = new Map<StateKind, { value: unknown; text: string }>();
  const part = (kind: StateKind) => {
    let made = parts.get(kind);
    if (!made) {
      state ??= store.state();
      if (day === undefined) { const now = new Date(); day = `${now.toDateString()}|${dayKey(now)}`; }
      const value = stateSlice(state, kind);
      made = { value, text: `${day}\n${JSON.stringify(value)}` };
      parts.set(kind, made);
    }
    return made;
  };
  for (const [frame, kinds] of stateFrames) {
    try {
      if (frame.detached) { stateFrames.delete(frame); continue; }
      if (!wanted(frame)) continue;
      for (const [kind, sent] of kinds) {
        const { value, text } = part(kind);
        if (text === sent) continue;
        frame.send(stateChannels[kind], value);
        kinds.set(kind, text);
      }
    } catch { stateFrames.delete(frame); /* a frame going away */ }
  }
}

/** Every page gets its part again on the next change (back from sleep: what they show may have moved on). */
function resendState(): void {
  for (const kinds of stateFrames.values()) for (const kind of kinds.keys()) kinds.set(kind, undefined);
}

// ─── 종이 (#244) ──────────────────────────────────────────────────────────────

/** 낮 · 밤, 종이 and 밤에는 as set. */
const paperChoice = (): PaperChoice => ({ dayNight: store.prefs.paper, paper: store.prefs.paperTheme, night: store.prefs.paperNight });
/**
 * The paper shown now. Windows' light or dark is asked only while the theme follows the system (themeSourceOf): where it
 * is set outright, the paper shown doesn't depend on it.
 */
const paperLookNow = (): PaperLook => shownPaper(paperChoice(), systemDark());
/**
 * Windows' light or dark (its apps' mode). Electron answers the theme set, so it is read while the theme follows the
 * system and remembered; with the theme set outright the notepad's paper doesn't need it, only a drawer with its own
 * paper might (the last answer then).
 */
let systemDarkSeen = nativeTheme.shouldUseDarkColors;
function systemDark(): boolean {
  if (nativeTheme.themeSource === "system") systemDarkSeen = nativeTheme.shouldUseDarkColors;
  return systemDarkSeen;
}
/** The drawer's paper shown now: the notepad's, or its own (노트와 같은 종이 off). */
const drawerPaperNow = (): PaperKind => drawerShown(
  { sameAsNote: store.prefs.drawerSameAsNote, paper: drawerKindOf(store.prefs.drawerTheme), night: store.prefs.drawerNight }, paperChoice(), systemDark());
/** Whether it is night now by 낮 · 밤 (밤, or 자동 with Windows dark): 설정 draws the drawer's own paper by it. */
const paperNightNow = (): boolean => store.prefs.paper === "night" || (store.prefs.paper === "auto" && systemDark());
let paperShownKey: string | undefined;

/** The settings decide Electron's theme (title bars, menus, scrollbars follow the shown paper's lightness); then every window hears. */
function applyPaper(): void {
  systemDark();
  nativeTheme.themeSource = themeSourceOf(paperChoice());
  refreshPaper();
}

/** Every window and frame turns to the paper now shown, and the windows' own backgrounds too (no flash). Once per change. */
function refreshPaper(): void {
  const look = paperLookNow();
  const nightNow = paperNightNow();
  const key = `${look.shown}|${look.scheme}|${nightNow}`;
  if (key === paperShownKey) return;
  paperShownKey = key;
  const color = paperBackground[look.shown];
  if (note && !note.isDestroyed()) note.setBackgroundColor(color);
  desk?.setBackground(color);
  sendEverywhere("paper", { paper: look.shown, dark: look.scheme === "dark", nightNow });
  drawer?.sendLook();
}

/** 2b (S45): the note's widest — 1,200 while 오늘 is grouped by space, else 720. */
function noteWidthCap(): number {
  return store.prefs.spaceGroups && liveSpaces(store.todoSpaces).length > 0 ? wideNote : narrowNote;
}
let noteCapApplied = 0;
/**
 * The cap follows grouping. Turned off (or the last space gone) while the note is wider: back to 720, the right edge
 * kept when docked on the right, and still on its display (off-screen runs stay where they were put).
 */
function applyNoteWidthCap(): void {
  if (!note || note.isDestroyed()) return;
  const cap = noteWidthCap();
  if (cap === noteCapApplied) return;
  noteCapApplied = cap;
  note.setMaximumSize(cap, 1200);
  const bounds = note.getBounds();
  if (bounds.width <= cap) return;
  let x = bounds.x;
  if (dockedSide() === "right") x += bounds.width - cap;
  if (!offscreenEnabled && !snapshotDirectory) {
    const area = screen.getDisplayMatching(bounds).workArea;
    x = Math.min(Math.max(x, area.x), area.x + area.width - cap);
  }
  note.setBounds({ ...bounds, x, width: cap });
}

function createNote(): BrowserWindow {
  const saved = store.memory.bounds;
  const window = new BrowserWindow({
    width: saved?.width ?? 420, height: saved?.height ?? 560,
    // Off-screen runs (perf, #92): the note starts far off every display, where macOS leaves it (enableLargerThanScreen).
    ...(offscreenEnabled ? { x: offscreen.x + 100, y: offscreen.y + 100 } : { x: saved?.x, y: saved?.y }),
    // 2b (S45): 1,200 wide while 오늘 is grouped by space, else 720.
    minWidth: 350, minHeight: 400, maxWidth: noteWidthCap(), maxHeight: 1200,
    frame: false, show: false, maximizable: false, fullscreenable: false,
    backgroundColor: paperBackground[paperLookNow().shown], title: t("종이냥"), icon: path.join(assetsDirectory, "cat.png"),
    alwaysOnTop: store.prefs.noteLayer === "top",
    webPreferences: webPreferences(), enableLargerThanScreen: Boolean(snapshotDirectory) || offscreenEnabled,
  });
  if (saved && !offscreenEnabled && !screen.getAllDisplays().some((display) => intersects(display.workArea, saved))) window.center();
  window.loadFile(path.join(rendererDirectory, "note.html"));
  // Off-screen runs show it without taking the keyboard from the app in front.
  // The ears come up with it (macOS sends no "show" for a window that comes up off every screen).
  window.once("ready-to-show", () => { if (!snapshotDirectory) { if (offscreenEnabled) window.showInactive(); else window.show(); noteEars?.sync(); } });
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

/**
 * 노트 위치 (#273): 항상 위에 두기 floats; 바탕화면에 두기 keeps the note under the other windows (stayBehind.ts) — a
 * click or typing on it doesn't bring it forward, being summoned does, until another window is clicked. Not while a
 * question waits over it: Windows keeps the question just above the note and would take it down too.
 */
function applyNoteLayer(): void {
  const layer = store.prefs.noteLayer;
  if (note.isAlwaysOnTop() !== (layer === "top")) note.setAlwaysOnTop(layer === "top", "floating");
  if (layer === "desktop") {
    stayBehind().keep(note, {
      summonable: true,
      pointerInside: () => { const point = screen.getCursorScreenPoint(); return intersects(note.getBounds(), { ...point, width: 1, height: 1 }); },
      holds: () => confirmSlip?.over === note,
    });
  } else stayBehind().release(note);
  noteEars?.sync();
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
    // (Off-screen runs, #250: the place is worked out on the displays, then shifted off them as the note started.)
    note.setPosition(Math.round(origin.x + offscreen.x), Math.round(origin.y + offscreen.y));
  }
  collapseAnchorInNote = undefined;
  floating.hide();
  if (note.isMinimized()) note.restore();
  // #273: 바탕화면에 두기 — summoned, it comes forward until another window is clicked.
  stayBehind().summon(note);
  // Off-screen runs show it without taking the keyboard from the app in front (as it starts).
  if (offscreenEnabled) note.showInactive();
  else { note.show(); note.focus(); if (stayBehind().isKept(note)) note.moveTop(); }
  noteEars.sync();
  focusTimer?.noteShown(); // 집중: the card is back, the board goes
}

function collapse(anchor?: Point): void {
  if (!note.isVisible()) return;
  note.webContents.send("note:commit-editing");
  // In the displays' coordinates (off-screen runs, #250: without the shift; floating.show adds it back).
  const shown = note.getBounds();
  const bounds = { ...shown, x: shown.x - offscreen.x, y: shown.y - offscreen.y };
  const point = anchor ?? { x: bounds.x + bounds.width / 2, y: bounds.y + 42 };
  note.hide();
  noteEars.sync();
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

/** 위젯의 메뉴 → 설정…: 책상 → 일정 with that widget's settings slip open (said again while a new desk loads). */
function openWidgetSettings(id: string): void {
  openDesk("events");
  for (const after of [0, 600, 1500]) setTimeout(() => desk.sendAll("desk:pane", { pane: "events", widget: id }), after);
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

/**
 * 달력: the month (or week) with the events and the tasks' deadlines and alerts, on `day` when given — with `event`'s
 * sheet open over it (고치기 · 지우기: an event pressed on a widget or its day sheet, calendar-flows D3).
 */
function openCalendar(day?: string, event?: string): void {
  const chosen = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
  const key = chosen && event && calendar.find(event) ? event : undefined;
  openDesk("calendar", chosen ? { day: chosen, ...(key ? { event: key } : {}) } : {});
}

/**
 * ⋯ → 키보드 단축키 (#86): the app's keys on a slip, in groups — 입력 · 이동 · 책상 달력 (#275) · 고른 할 일 · 어디서든 · 집중
 * · 메모 서랍, then the drawer's own two — each row what it does and its keys, one cap each (Ctrl + N). The changeable keys (the
 * note's, the drawer's) show the one chosen, or ‘끔’. The same groups, order and words as on the Mac (ShortcutList.swift).
 */
function shortcutQuestion(): ConfirmQuestion {
  const { prefs } = store;
  const sheet: ShortcutSheetGroup[] = [
    { title: t("입력"), rows: [
      { title: t("입력 줄로 가기"), keys: ["Ctrl", "N"] },
      { title: t("넣기 · 고치기 끝"), keys: ["Enter"] },
      { title: t("고치기 취소"), keys: ["Esc"] },
      { title: t("실행 취소"), keys: ["Ctrl", "Z"] },
      { title: t("다시 실행"), keys: ["Ctrl", "Y"] },
      { title: t("목록 복사"), keys: ["Ctrl", "Shift", "C"] },
      { title: t("텍스트로 내보내기"), keys: ["Ctrl", "E"] },
    ] },
    { title: t("이동"), rows: [
      { title: t("오늘"), keys: ["Ctrl", "1"] },
      { title: t("앞으로"), keys: ["Ctrl", "2"] },
      { title: t("검색"), keys: ["Ctrl", "F"] },
      { title: t("포스트잇으로 접기"), keys: ["Ctrl", "M"] },
      { title: t("책상"), keys: ["Ctrl", "D"] },
    ] },
    // #275: the desk's calendar — a new event on the picked day, and the day's events by the keys.
    { title: t("책상 달력"), rows: [
      { title: t("새 일정"), keys: ["Enter"] },
      { title: t("그날 일정으로"), keys: ["Tab"] },
      { title: t("일정 고르기"), keys: ["↑"], also: ["↓"] },
      { title: t("일정 고치기"), keys: ["Enter"] },
      { title: t("달력으로 돌아가기"), keys: ["Esc"] },
    ] },
    { title: t("고른 할 일"), rows: [
      { title: t("하루 뒤로"), keys: ["Alt", "→"] },
      { title: t("하루 앞으로"), keys: ["Alt", "←"] },
      { title: t("언젠가로"), keys: ["Alt", "↓"] },
      { title: t("집중 시작"), keys: ["F"] },
    ] },
    { title: t("어디서든"), rows: [
      { title: t("빠른 입력"), keys: keyCaps(quickEntryShortcut) },
      { title: t("빠른 메모"), keys: keyCaps(quickMemoShortcut) },
      { title: t("노트 보이기 · 숨기기"), keys: prefs.noteHotkey ? keyCaps(prefs.noteShortcut) : null },
    ] },
    { title: t("집중"), rows: [
      { title: t("일시정지 · 계속"), keys: [t("Space")] },
      // The focus card's button (en "Done", not the folded icon's "All done").
      { title: t("다 했어요", undefined, "focus"), keys: ["Ctrl", "Enter"] },
      { title: t("5분 더"), keys: ["Ctrl", "="] },
      { title: t("그만두기"), keys: ["Esc"] },
    ] },
    { title: t("메모 서랍"), rows: [
      { title: t("어디서든 열고 닫기"), keys: prefs.drawerShortcut ? keyCaps(prefs.drawerShortcut) : null },
      { title: t("노트에서 열기"), keys: ["Ctrl", "3"] },
      { title: t("새 메모"), keys: ["Ctrl", "Shift", "N"] },
    ] },
    ...drawerShortcutGroups(),
  ];
  return {
    icon: "keyboard", title: t("종이냥 단축키"), size: "keys", cat: false, cancelId: 0, sheet,
    message: [t("할 일을 누르면 바로 고칠 수 있어요. 줄 왼쪽 손잡이를 끌거나 우클릭 메뉴로 순서를 바꿔요."), t("노트와 메모 서랍의 키는 책상에서 바꿔요.")].join("\n"),
    buttons: [{ label: t("확인"), kind: "primary" }],
  };
}

/** #118: the drawer's own keys (a memo picked or open), and the keys while a memo is typed. The Mac's drawerGroups. */
function drawerShortcutGroups(): ShortcutSheetGroup[] {
  return [
    { title: t("메모 서랍 안에서"), rows: [
      { title: t("고르기"), keys: ["↑"], also: ["↓"] },
      { title: t("펼치기 · 접기"), keys: ["Enter"], also: ["Esc"] },
      { title: t("새 메모 · 찾기"), keys: ["Ctrl", "N"], also: ["Ctrl", "F"] },
      { title: t("폴더 · 고정"), keys: ["Ctrl", "1–9"], also: ["Ctrl", "0"] },
      { title: t("폴더 목록"), keys: ["Ctrl", "L"] },
      { title: t("폴더로 옮기기"), keys: ["Ctrl", "Shift", "M"] },
      { title: t("크게 보기"), keys: ["Ctrl", "Enter"] },
      { title: t("복사"), keys: ["Ctrl", "Shift", "C"] },
      { title: t("지우기"), keys: ["Ctrl", "Delete"] },
      { title: t("이 목록"), keys: ["Ctrl", "/"] },
    ] },
    { title: t("메모 고치기"), rows: [
      { title: t("굵게 · 기울임"), keys: ["Ctrl", "B"], also: ["Ctrl", "I"] },
      { title: t("취소선"), keys: ["Ctrl", "Shift", "X"] },
      { title: t("코드"), keys: ["Ctrl", "E"] },
      { title: t("링크 칸"), keys: ["Ctrl", "K"] },
      { title: t("제목 줄"), keys: ["Ctrl", "Alt", "1–3"] },
      { title: t("체크 목록"), keys: ["Ctrl", "Shift", "L"] },
      { title: t("체크 · 체크 풀기"), keys: ["Ctrl", "Shift", "U"] },
      { title: t("기호 늘 보이기"), keys: ["Ctrl", "Shift", "R"] },
      { title: t("줄 옮기기"), keys: ["Alt", "↑"], also: ["Alt", "↓"] },
    ] },
  ];
}

async function showShortcuts(): Promise<void> {
  await ask(note.isVisible() ? note : undefined, shortcutQuestion());
}

/** Ctrl+/ in the drawer (#118): its two groups on a slip of their own. */
function drawerShortcutQuestion(): ConfirmQuestion {
  return {
    icon: "keyboard", title: t("메모 서랍의 키"), size: "keys", cat: false, cancelId: 0, sheet: drawerShortcutGroups(),
    message: t("메모를 고르거나 펼친 채로 눌러요."), buttons: [{ label: t("확인"), kind: "primary" }],
  };
}

async function showDrawerShortcuts(): Promise<void> {
  await ask(undefined, drawerShortcutQuestion());
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
  powerMonitor.on("resume", () => { tick(); resendState(); store.changed(); armBoundary(); });
  startDeviceClock();
}

/**
 * 기기마다 보일 스페이스 (#196, D4): while a time rule is set, what this PC hides is worked out on each minute (and after
 * waking); every window draws again only when it changed. A lens on a space that just went hidden lets go (D7).
 */
let deviceClock: NodeJS.Timeout | undefined;
let deviceHiddenSeen = "";
function refreshDeviceHidden(): void {
  const hidden = store.hiddenNow();
  const seen = [...hidden].sort().join("\t");
  const lens = store.prefs.spaceLens?.spaceId;
  if (lens && hidden.has(lens) && !store.devicePeek.includes(lens)) store.setPref("spaceLens", null);
  if (seen === deviceHiddenSeen) return;
  deviceHiddenSeen = seen;
  store.changed();
}
function startDeviceClock(): void {
  const arm = () => {
    clearTimeout(deviceClock);
    deviceClock = undefined;
    deviceHiddenSeen = [...store.hiddenNow()].sort().join("\t");
    const timed = Object.values(store.prefs.spaceDevice).some((rule) => rule.show === "time");
    if (!timed) return;
    const tickAt = () => {
      refreshDeviceHidden();
      deviceClock = setTimeout(tickAt, 60_000 - (Date.now() % 60_000) + 200);
    };
    deviceClock = setTimeout(tickAt, 60_000 - (Date.now() % 60_000) + 200);
  };
  arm();
  store.on("prefs", (key: keyof Prefs) => { if (key === "spaceDevice") { arm(); refreshDeviceHidden(); } });
  powerMonitor.on("resume", () => { refreshDeviceHidden(); arm(); });
}

/**
 * The note opened, or a new day began with it open: the morning 저녁 정리 (yesterday's leftovers, when
 * the evening never came) and 오늘 꼭 하나 (the empty line asks for the day's one thing).
 */
function newDayOnNote(): void {
  if (snapshotDirectory || !note.isVisible() || note.isMinimized()) return;
  sweep?.noteOpened();
  const today = dayKey(new Date());
  // 한 스페이스만 보기 lets go at 4 a.m. (S11): the note already draws everything; the setting follows.
  if (store.prefs.spaceLens && store.prefs.spaceLens.day !== today) store.setPref("spaceLens", null);
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

/**
 * The note's ⋯ (#18): the same groups in the same order as the Mac's (PaperView.swift) — 만들기 | 찾기 | 보기 | 창 |
 * 책상 | 종이냥 · 타이머 | 편집 | 목록 | 도움 | 끝내기 (the last two and 오늘 · 앞으로 · 모두 내보내기 · 가져오기 are
 * Windows' own: the Mac has them in its menu bar).
 */
function moreMenu(): Menu {
  const prefs = store.prefs;
  const groups: MenuItemConstructorOptions[][] = [
    [
      { label: t("새 할 일"), accelerator: "CmdOrCtrl+N", click: () => note.webContents.send("note:focus-new") },
      { label: t("새 일정…"), click: () => calendar.newEvent() },
      { label: t("빠른 메모…"), accelerator: "Ctrl+Alt+M", registerAccelerator: false, click: () => quickMemo.open() },
    ],
    [
      { label: t("검색…"), accelerator: "CmdOrCtrl+F", click: openSearch },
      { label: t("오늘"), accelerator: "CmdOrCtrl+1", click: () => note.webContents.send("note:row-command", { id: "", command: "page-today" }) },
      { label: t("앞으로"), accelerator: "CmdOrCtrl+2", click: () => note.webContents.send("note:row-command", { id: "", command: "page-ahead" }) },
      // 1.28: the memo tab became the 메모 서랍 (Ctrl+3 in the note opens it too).
      { label: t("메모 서랍"), ...(store.prefs.drawerShortcut ? { accelerator: store.prefs.drawerShortcut, registerAccelerator: false } : {}), click: () => drawer.show() },
    ],
    [
      { label: t("글꼴"), submenu: (Object.keys(fontTitles.ko) as NotebookFont[]).map((font) => ({
        label: fontTitles[lang()][font], type: "radio" as const, checked: prefs.font === font, click: () => store.setPref("font", font),
      })) },
      { label: t("글자 크기"), submenu: textStepTitles[lang()].map((title, step) => ({
        label: title, type: "radio" as const, checked: prefs.textStep === step, click: () => store.setPref("textStep", step),
      })) },
      { label: t("완료 숨기기"), type: "checkbox", checked: prefs.hideCompleted, click: () => store.setPref("hideCompleted", !prefs.hideCompleted) },
      // 2b: 스페이스별로 묶기 (Ctrl+Shift+G in the note), only once there is a space.
      ...(liveSpaces(store.todoSpaces).length ? [{ label: t("스페이스별로 묶기"), type: "checkbox" as const, checked: prefs.spaceGroups, accelerator: "Ctrl+Shift+G", registerAccelerator: false,
        click: () => store.setPref("spaceGroups", !prefs.spaceGroups) }] : []),
    ],
    [
      { label: t("포스트잇으로 접기"), accelerator: "CmdOrCtrl+M", click: () => collapse() },
      // 화면 오른쪽 · 왼쪽에 붙이기 (checked while docked there; again: back where it was).
      { label: t("화면 오른쪽에 붙이기"), type: "checkbox", checked: dockedSide() === "right", click: () => dockNote("right") },
      { label: t("화면 왼쪽에 붙이기"), type: "checkbox", checked: dockedSide() === "left", click: () => dockNote("left") },
    ],
    [
      { label: t("달력…"), accelerator: "CmdOrCtrl+D", click: () => openCalendar() },
      { label: t("완료 기록…"), accelerator: "CmdOrCtrl+H", click: () => openHistory() },
      { label: t("반복 할 일…"), click: () => openSettings("repeat") },
      { label: t("알람…"), click: () => openSettings("clock") },
      { label: t("설정…"), accelerator: "CmdOrCtrl+,", click: () => openSettings() },
    ],
    petMenu(),
    [
      { label: t("완료한 일 정리"), enabled: store.todayItems.some((item) => item.isCompleted), click: clearCompleted },
      { label: t("실행 취소"), accelerator: "CmdOrCtrl+Z", enabled: store.history.canUndo, click: () => store.mutate((history) => history.undo()) },
      { label: t("다시 실행"), accelerator: "CmdOrCtrl+Y", enabled: store.history.canRedo, click: () => store.mutate((history) => history.redo()) },
    ],
    [
      { label: t("목록 복사"), accelerator: "CmdOrCtrl+Shift+C", enabled: store.items.length > 0, click: copyList },
      { label: t("텍스트로 내보내기…"), accelerator: "CmdOrCtrl+E", enabled: store.items.length > 0, click: exportList },
      { label: t("모두 내보내기…"), click: () => void fromStoragePane(exportBackup) },
      { label: t("가져오기…"), click: () => void fromStoragePane(importBackup) },
    ],
    [
      { label: t("사용 안내"), click: showGuide },
      { label: t("도움말…"), accelerator: "F1", click: () => openHelp() },
      { label: t("키보드 단축키"), click: () => void showShortcuts() },
    ],
    [{ label: t("종이냥 종료"), click: quit }],
  ];
  return Menu.buildFromTemplate(groups.flatMap((group, index) => (index === 0 ? group : [{ type: "separator" as const }, ...group])));
}

/** 종이냥 on/off and the focus timer (a board of its own, whether or not the pet is out), in the tray and the note's ⋯ menu. */
function petMenu(): MenuItemConstructorOptions[] {
  return [
    { label: t("종이냥 펫"), type: "checkbox", checked: store.prefs.petVisible, click: () => store.setPref("petVisible", !store.prefs.petVisible) },
    // #289: the typing cat on or off, apart from the pet (off remembers what it was).
    { label: t("타닥냥"), type: "checkbox", checked: store.prefs.typingCat !== "off", click: () => typingCat?.toggle() },
    { label: t("타이머"), submenu: focusTimer.timerMenu() },
  ];
}

/** A toast on the note for something done from a menu, a bubble or the cat (see NoteNotice); only while the note is up. */
function notice(value: NoteNotice): boolean {
  if (!note || note.isDestroyed() || !note.isVisible() || note.isMinimized()) return false;
  note.webContents.send("note:notice", value);
  return true;
}

// ─── AI 연결 ──────────────────────────────────────────────────────────────────

/**
 * The bundled 종이냥 for Claude: the .mcpb in resources\mcp in the installed app (mcp/dist while developing), and
 * the program for Claude Code's `--mcp-stdio` (#175: the server itself is out/mcp.js, inside the app).
 */
function aiFiles(): AiFiles {
  // Snapshots show where the installed app keeps it (a per-user install), not this checkout.
  if (snapshotDirectory) {
    const installed = "C:\\Users\\me\\AppData\\Local\\Programs\\종이냥"; // i18n-ok: a folder name
    return { mcpb: `${installed}\\resources\\mcp\\jongi-nyang.mcpb`, exe: `${installed}\\종이냥.exe` }; // i18n-ok
  }
  if (app.isPackaged) return { mcpb: path.join(process.resourcesPath, "mcp", "jongi-nyang.mcpb"), exe: process.execPath };
  return { mcpb: path.join(app.getAppPath(), "mcp", "dist", "jongi-nyang.mcpb"), exe: process.execPath, app: app.getAppPath() };
}

/**
 * Claude 데스크톱에 연결: AI 연결 goes on and the bundled .mcpb opens with what handles it (Claude Desktop asks
 * whether to install 종이냥 for Claude). Nothing handles it: a slip with the download page.
 */
async function connectClaudeDesktop(): Promise<void> {
  ai.setEnabled(true);
  const parent = dialogParent();
  const problem = fs.existsSync(ai.files.mcpb) ? await shell.openPath(ai.files.mcpb) : "missing";
  if (!problem) return;
  const answer = await ask(parent, {
    icon: "chat", title: t("Claude 데스크톱에 연결"), size: "m",
    message: t("Claude 데스크톱이 있어야 연결할 수 있어요."),
    detail: t("Claude 데스크톱을 설치한 뒤 다시 눌러 주세요. 설치하면 종이냥 for Claude가 바로 열려요."),
    buttons: [{ label: t("닫기"), kind: "ghost" }, { label: t("내려받는 곳 열기"), kind: "primary" }], cancelId: 0,
  });
  if (answer === 1) openExternalSafely("https://claude.ai/download");
}

/** The tasks 완료한 일 정리 put in the record last (its toast's 되돌리기 brings them back). */
let lastFiled: TodoItem[] = [];

/** 완료한 일 정리: today's finished tasks to the record now, with "N개를 완료 기록으로 옮겼어요 · 되돌리기". */
function clearCompleted(): void {
  lastFiled = archive.fileToday();
  if (lastFiled.length) notice({ icon: "leaf", text: t("{n}개를 완료 기록으로 옮겼어요", { n: lastFiled.length }), undo: "unfile" });
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
  notice({ icon: target.kind === "someday" ? "later" : "calendar", text: words, undo: "history" });
}

/**
 * A row menu entry as the note's paper menu draws it (1.30): its icon, red when it deletes, the spaces' submenu in
 * place, and (1.30.x) the row's own key at the right — the note takes it when the row is picked, the menu only shows it.
 */
type RowEntry = MenuItemConstructorOptions & { paperIcon?: string; danger?: boolean; spaces?: string; keyText?: string };

/** Groups of menu entries with one separator between those that aren't empty (none first or last). */
function grouped(groups: RowEntry[][]): RowEntry[] {
  return groups.filter((group) => group.length > 0).flatMap((group, index) => (index === 0 ? group : [{ type: "separator" } as RowEntry, ...group]));
}

/** The row menu, natively (the 하루 띠's snapshots list it; the note draws the paper one, see showPaperRowMenu). */
function rowMenu(id: string): Menu {
  return Menu.buildFromTemplate(rowMenuTemplate(id).map(({ keyText: _key, ...entry }) => (entry.spaces ? { label: entry.label, submenu: spaceMenuNative(entry.spaces) } : entry)));
}

/** 스페이스로 옮기기 ▸ as a native submenu: the spaces (✓ the current one), 일반. */
function spaceMenuNative(id: string): MenuItemConstructorOptions[] {
  const current = spaceOf(store.todoSpaces, id);
  return [
    ...liveSpaces(store.todoSpaces).map((space) => ({ label: space.name, type: "checkbox" as const, checked: current === space.id, click: () => moveToSpace([id], space.id) })),
    { type: "separator" },
    { label: generalName(store.todoSpaces, lang()), type: "checkbox", checked: current === undefined, click: () => moveToSpace([id], null) },
  ];
}

/** To-dos into a space (null: 일반), and the toast with 되돌리기 (their spaces as they were). */
function moveToSpace(ids: string[], space: string | null, previous?: string[]): void {
  // #168: only the ones not there already; one toast for them all (‘3개를 집으로 옮겼어요’), one 되돌리기.
  const index = spaceIndex(store.todoSpaces);
  const moving = ids.filter((id) => (index.get(id)?.id ?? null) !== space);
  if (moving.length === 0) return;
  const before = moving.map((id) => [id, spaceOf(store.todoSpaces, id) ?? null] as const);
  store.changeSpaces((data) => moving.reduce((next, id) => moveTodo(next, id, space), data));
  const name = findSpace(store.todoSpaces, space)?.name ?? generalName(store.todoSpaces, lang());
  const text = moving.length > 1 ? movedManyWords(moving.length, name, lang()) : t("{where} 옮겼어요", { where: toSpaceWords(name, lang()) });
  notice({ icon: "spaces", text, undo: "spaces", entry: JSON.stringify(previous ? { moves: before, previous } : before) });
}

/** #168 (S47): several picked to-dos dropped on another group — its head, or together before or after one of its rows. */
function dropManyInGroup(ids: string[], space: string | null, targetID: string | undefined, after: boolean): void {
  const previous = store.items.map((item) => item.id);
  if (targetID) store.mutate((history) => history.reorder(movedBlock(previous, ids, targetID, after)));
  moveToSpace(ids, space, targetID ? previous : undefined);
}

/**
 * 2b (J, S43): a to-do dropped on another group, on its head or before or after one of its rows — moved to that space
 * (and that place), with `집으로 옮겼어요 · 되돌리기`; 되돌리기 puts back the space and, after a drop between rows, the place.
 */
function dropInGroup(id: string, space: string | null, targetID: string | undefined, after: boolean): void {
  const back = targetID ? returnPoint(id, store.items.map((item) => item.id)) : undefined;
  if (targetID) store.mutate((history) => {
    const target = history.items.findIndex((item) => item.id === targetID);
    if (target >= 0 && id !== targetID) history.move(id, target + (after ? 1 : 0));
  });
  const was = spaceOf(store.todoSpaces, id) ?? null;
  if (was === space) return;
  store.changeSpaces((data) => moveTodo(data, id, space));
  const name = findSpace(store.todoSpaces, space)?.name ?? generalName(store.todoSpaces, lang());
  notice({ icon: "spaces", text: t("{where} 옮겼어요", { where: toSpaceWords(name, lang()) }), undo: "spaces", entry: JSON.stringify({ moves: [[id, was]], ...(back ? { back: { id, ...back } } : {}) }) });
}

/** The menus' entries as the note draws them: plain data, each click kept here until the next menu. */
interface PaperEntry { kind: "item" | "sub" | "sep" | "spaces"; label?: string; pick?: number; checked?: boolean; disabled?: boolean; danger?: boolean; icon?: string; key?: string; todo?: string; entries?: PaperEntry[] }
let paperClicks: (() => void)[] = [];
function paperEntries(template: readonly RowEntry[]): PaperEntry[] {
  return template.map((entry): PaperEntry => {
    if (entry.type === "separator") return { kind: "sep" };
    if (entry.spaces) return { kind: "spaces", label: String(entry.label), todo: entry.spaces, icon: entry.paperIcon };
    if (Array.isArray(entry.submenu)) return { kind: "sub", label: String(entry.label), icon: entry.paperIcon, entries: paperEntries(entry.submenu as RowEntry[]) };
    const click = entry.click;
    paperClicks.push(() => (click as (() => void) | undefined)?.());
    return {
      kind: "item", label: String(entry.label), pick: paperClicks.length - 1, icon: entry.paperIcon, danger: entry.danger, ...(entry.keyText ? { key: entry.keyText } : {}),
      ...(entry.type === "checkbox" || entry.type === "radio" ? { checked: Boolean(entry.checked) } : {}), ...(entry.enabled === false ? { disabled: true } : {}),
    };
  });
}

/** Right-click (or Shift+F10 · the Menu key) on a to-do in the note: the paper menu, drawn there (1.30). */
function showPaperRowMenu(id: string, at: { x?: number; y?: number; keyboard?: boolean }): void {
  paperClicks = [];
  const entries = paperEntries(rowMenuTemplate(id));
  note.webContents.send("note:row-menu", { id, entries, ...at });
}

/**
 * The row menu, the same on the Mac (TaskRowMenu.swift), in groups: 고치기 · 알림 · 마감 · 시간 · 완료 | 이거 집중 ▸ |
 * 내일 하기 · 날짜 바꾸기 ▸ · 언젠가로 · 오늘 꼭 하나 | 스페이스로 옮기기 ▸ · 위로 · 아래로 | 달력에 넣기 | 지우기.
 * A row's keys (note.ts listKey) are shown beside what they do.
 */
function rowMenuTemplate(id: string): RowEntry[] {
  const visible = store.todayItems.filter((item) => !store.prefs.hideCompleted || !item.isCompleted);
  const index = visible.findIndex((item) => item.id === id);
  const item = store.items.find((entry) => entry.id === id);
  if (!item) return [];
  const onToday = index >= 0;
  const open = !item.isCompleted;
  const send = (command: string) => note.webContents.send("note:row-command", { id, command });
  const moveTo = (target: number, after: boolean) => store.mutate((history) => {
    const targetIndex = history.items.findIndex((entry) => entry.id === visible[target].id);
    history.move(id, targetIndex + (after ? 1 : 0));
  });
  const someday = (): void => (onToday ? store.mutate((history) => history.setShelf(id, "later")) : moveTasks([id], { kind: "someday" }));
  // 날짜 바꾸기 ▸ 내일 · 이번 주 금요일 · 다음 주 월요일 · 언젠가 · 날짜 고르기….
  const dateItems: RowEntry[] = open ? [{
    label: t("날짜 바꾸기"), paperIcon: "calendar",
    submenu: moveChoices(new Date(), lang()).map((choice) => ({
      label: choice.title,
      click: () => (choice.kind === "pick" ? send("deadline") : choice.kind === "someday" ? moveTasks([id], { kind: "someday" }) : moveTasks([id], { kind: "day", day: choice.day! })),
    })),
  }] : [];
  const starred = store.prefs.starredTask === id && store.prefs.morningPickDay === dayKey(new Date());
  return grouped([
    [
      { label: t("고치기"), paperIcon: "edit", keyText: "Enter", click: () => send("edit") },
      { label: item.reminderAt ? t("알림 고치기…") : t("알림 설정…"), paperIcon: "bell", click: () => send("reminder") },
      { label: item.dueDate ? t("마감 바꾸기…") : t("마감 정하기…"), paperIcon: "flag", click: () => send("deadline") },
      // 시간 정하기: a task with a day (on 오늘, or a deadline) can have hours on it.
      ...(open && rangeDay(item, new Date()) ? [{ label: t("시간 정하기…"), paperIcon: "clock", click: () => send("time") }] : []),
      { label: open ? t("완료 표시") : t("완료 취소"), paperIcon: "checkBox", keyText: t("Space"), click: () => store.mutate((history) => history.toggle(id)) },
    ],
    open ? [{ label: t("이거 집중"), paperIcon: "timer", submenu: focusMenu(id) }] : [],
    onToday ? [
      ...(open ? [{ label: t("내일 하기"), paperIcon: "arrowRight", keyText: "Alt+→", click: () => moveTasks([id], { kind: "day", day: tomorrowKey(new Date()) }) }] : []),
      ...dateItems,
      ...(item.dueDate ? [] : [{ label: t("언젠가로 옮기기"), paperIcon: "later", keyText: open ? "Alt+↓" : undefined, click: someday }]),
      // 오늘 꼭 하나 (when it is on): this task is the day's one thing, starred at the top of 다음.
      ...(open && store.prefs.morningPick ? [{
        label: t("오늘 꼭 하나"), paperIcon: "star", type: "checkbox" as const, checked: starred,
        click: () => {
          store.setPref("morningPickDay", dayKey(new Date()));
          store.setPref("starredTask", starred ? "" : id);
        },
      }] : []),
    ] as RowEntry[] : [
      { label: t("오늘 하기"), paperIcon: "sun", click: () => store.mutate((history) => history.setShelf(id, item.dueDate ? "today" : undefined)) },
      ...dateItems,
      ...(item.dueDate ? [{ label: t("언젠가로 옮기기"), paperIcon: "later", keyText: open ? "Alt+↓" : undefined, click: someday }] : []),
    ] as RowEntry[],
    [
      // 할 일 스페이스 (1.30): 스페이스로 옮기기 ▸, once there is a space (스페이스 관리 makes the first).
      ...(liveSpaces(store.todoSpaces).length ? [{ label: t("스페이스로 옮기기"), paperIcon: "spaces", spaces: id }] : []),
      ...(onToday ? [
        { label: t("위로 이동"), paperIcon: "arrowUp", keyText: "Ctrl+↑", enabled: index > 0, click: () => moveTo(index - 1, false) },
        { label: t("아래로 이동"), paperIcon: "arrowDown", keyText: "Ctrl+↓", enabled: index < visible.length - 1, click: () => moveTo(index + 1, true) },
      ] : []),
    ],
    // 일정: a copy of the task as an event (changing one later doesn't change the other).
    open ? [{ label: t("달력에 넣기…"), paperIcon: "calendarClock", click: () => calendar.sendTask(id) }] : [],
    [{ label: t("지우기"), paperIcon: "trash", danger: true, keyText: "Del", click: () => { store.mutate((history) => history.delete(id)); notice({ icon: "trash", text: t("할 일을 지웠어요"), undo: "history" }); } }],
  ]);
}

/** An event's menu: 고치기… · 할 일로 추가 | 지우기…, with the row menu's icons (the Mac's TodayEventsStrip.menu). */
function eventMenuTemplate(key: string, inCalendar = false): RowEntry[] {
  if (!calendar.find(key)) return [];
  const edit = (confirmDelete: boolean) => (inCalendar
    ? calendar.editEvent(key, confirmDelete, (request) => desk.sendAll("calendar:event-sheet", request))
    : calendar.editEvent(key, confirmDelete));
  return grouped([
    [
      { label: t("고치기…"), paperIcon: "edit", click: () => edit(false) },
      { label: t("할 일로 추가"), paperIcon: "plus", click: () => calendar.addAsTask(key) },
    ],
    [{ label: t("지우기…"), paperIcon: "trash", danger: true, click: () => edit(true) }],
  ]);
}

/** A row of the 오늘 일정 strip (or of the 달력 window's day panel, whose sheet opens there), right-clicked: natively. */
function eventMenu(key: string, inCalendar = false): Menu {
  return Menu.buildFromTemplate(eventMenuTemplate(key, inCalendar).map(({ paperIcon: _icon, danger: _danger, keyText: _key, ...entry }) => entry));
}

/** An event on the note right-clicked: the paper menu at the point. */
function showPaperEventMenu(key: string, at: { x: number; y: number }): void {
  paperClicks = [];
  const entries = paperEntries(eventMenuTemplate(key));
  if (entries.length) note.webContents.send("note:row-menu", { id: "", entries, ...at });
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
  // I-08 (#173): written whole beside it and renamed in, like every other file.
  try { writeFileAtomically(result.filePath, store.plainText()); } catch {
    await ask(note, { icon: "warning", title: t("텍스트로 내보내기"), message: t("내보내지 못했어요."), detail: result.filePath, buttons: [{ label: t("확인"), kind: "primary" }], cancelId: 0 });
  }
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
    writeFileAtomically(result.filePath, makeBackup(readDataFiles(store.dataDirectory), backupSource(), new Date(), "export"));
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
    parsed = parseBackup(readBackupText(file, true), lang()); // #173: past 64MB it isn't read
  } catch (error) {
    const refused = backupRefusal(error, lang());
    await warn(refused ? t("가져오지 못했어요. 지금 목록은 그대로예요.") : t("파일을 읽지 못했어요."), refused ? `${refused}\n${path.basename(file)}` : path.basename(file));
    return;
  }
  if ("error" in parsed) {
    await warn(parsed.error, path.basename(file));
    return;
  }
  const { backup } = parsed;
  const when = exportedText(backup.exportedAt, lang());
  const response = await ask(parent, {
    icon: "box", title: t("가져오기"), message: t("이 백업을 가져올까요?"), replacesList: true, size: "m",
    detail: [
      path.basename(file),
      when ? t("{from}에서 {when} 내보냄", { from: backup.from ?? t("종이냥"), when }) : t("{from}에서 내보냄", { from: backup.from ?? t("종이냥") }),
      summaryText(summary(backup.files), lang()),
      "",
      t("합치기: 지금 것은 그대로 두고 없는 것만 더해요."),
      t("바꾸기: 지금 것을 모두 이 백업으로 바꿔요."),
      t("어느 쪽이든 지금 것은 먼저 백업해 둬요."),
    ].join("\n"),
    buttons: [{ label: t("취소"), kind: "ghost" }, { label: t("바꾸기"), kind: "danger" }, { label: t("합치기"), kind: "primary" }], cancelId: 0,
  });
  if (response === 0) return;
  const mode = response === 1 ? "replace" : "merge";
  if (mode === "replace") {
    const sure = await ask(parent, {
      icon: "warning", title: t("바꾸기"), message: t("지금 있는 할 일 · 메모 · 일정 · 기록이 이 백업으로 바뀌어요. 바꾸기 전 상태는 자동으로 백업해 둘게요."), replacesList: true,
      buttons: [{ label: t("취소"), kind: "ghost" }, { label: t("바꾸기"), kind: "primary", clay: true }], cancelId: 0, size: "m",
    });
    if (sure !== 1) return;
  }
  await settleEditing();
  let files: BackupFiles;
  backups.busy = true;
  try {
    files = importInto(store.dataDirectory, backups.folder, backup.files, mode, backupSource(), new Date()).files;
  } catch {
    store.reloadAll();
    await warn(t("가져오지 못했어요. 지금 목록은 그대로예요."));
    return;
  } finally {
    backups.busy = false;
    backups.refresh();
  }
  store.reloadAll();
  const done = await ask(parent, {
    icon: "box", title: t("가져오기"), message: t("가져왔어요."), detail: `${summaryText(summary(files), lang())}\n${t("가져오기 전 것도 ‘backups’ 폴더에 남겨 뒀어요.")}`,
    buttons: [{ label: t("백업 폴더 열기"), kind: "ghost" }, { label: t("확인"), kind: "primary" }], cancelId: 1, size: "m",
  });
  if (done === 0) openBackupFolder();
}

// ─── 자동 백업 · 백업 목록 (#139 · #140) ────────────────────────────────────────

/** The daily copy: checked half a minute after launch, an hour after each check, and on waking (never on quitting). */
function startBackups(): void {
  setTimeout(() => backups.daily(), 30_000);
  setInterval(() => backups.daily(), 3_600_000);
  powerMonitor.on("resume", () => setTimeout(() => backups.daily(), 5_000));
}

function openBackupFolder(): void {
  fs.mkdirSync(backups.folder, { recursive: true });
  void shell.openPath(backups.folder);
}

/** 지금 백업하기: what is being typed saved first, then 직접-… (kept until deleted). */
async function backupNow(): Promise<void> {
  await settleEditing();
  try {
    backups.copy("manual");
  } catch {
    await ask(dialogParent(), { icon: "warning", title: t("자동 백업"), message: t("백업하지 못했어요. 지금 목록은 그대로예요."), detail: t("마지막 백업을 하지 못했어요. 백업 폴더를 확인해 주세요."), buttons: [{ label: t("확인"), kind: "primary" }], cancelId: 0 });
  }
}

/** 다른 폴더…: anywhere but the storage folder or inside it (refused on a slip). */
async function chooseBackupFolder(): Promise<void> {
  const parent = dialogParent();
  const result = await dialog.showOpenDialog(parent, {
    title: t("백업을 둘 폴더를 골라요. 저장 폴더 안은 고를 수 없어요."), buttonLabel: t("이 폴더에 백업하기"), properties: ["openDirectory", "createDirectory", "promptToCreate"],
  });
  const folder = result.filePaths[0];
  if (result.canceled || !folder) return;
  if (!backups.setFolder(folder)) {
    await ask(parent, { icon: "folder", title: t("백업 폴더"), message: t("저장 폴더 안에는 백업을 둘 수 없어요."), detail: t("다른 폴더를 골라 주세요."), buttons: [{ label: t("확인"), kind: "primary" }], cancelId: 0 });
  }
}

/** The restore question (also drawn by the snapshots): when, what the copy holds, the two ways back, and the other devices. */
function restoreQuestion(date: Date, counts: ReturnType<typeof backupCounts>, shared: boolean): ConfirmQuestion {
  return {
    icon: "box", title: t("되돌리기", undefined, "restore"), message: t("{when} 백업으로 되돌릴까요?", { when: savedWhen(date, new Date(), lang(), true) }), replacesList: true, size: "m", cancelId: 0,
    detail: [countsText(counts, lang()), "", t("합치기: 지금 것은 두고, 그 뒤에 지운 것만 되살려요."), t("바꾸기: 지금 것을 모두 그때로 바꿔요."),
      t("어느 쪽이든 지금 것은 먼저 백업해 둬요."), ...(shared ? [t("다른 기기의 목록도 같이 바뀌어요.")] : [])].join("\n"),
    buttons: [{ label: t("취소"), kind: "ghost" }, { label: t("바꾸기"), kind: "danger" }, { label: t("합치기"), kind: "primary" }],
  };
}

/**
 * 되돌리기…: the copy read and checked; 합치기 (what was deleted since comes back) or 바꾸기 (everything as it was then);
 * either way 되돌리기-전-… first (its failure stops everything), then the list is read again — as an import.
 */
async function restoreBackup(name: string): Promise<void> {
  const parent = dialogParent();
  const file = backups.fileOf(name);
  const copy = parseSavedName(name);
  if (!file || !copy) return;
  const warn = (detail?: string) => ask(parent, { icon: "warning", title: t("되돌리기", undefined, "restore"), message: t("되돌리지 못했어요. 지금 목록은 그대로예요."), ...(detail ? { detail } : {}), buttons: [{ label: t("확인"), kind: "primary" }], cancelId: 0 });
  let parsed: ReturnType<typeof parseBackup>;
  try { parsed = parseBackup(readBackupText(file), lang()); } catch (error) { await warn(backupRefusal(error, lang())); return; }
  if ("error" in parsed) { await warn(parsed.error); return; }
  const { backup } = parsed;
  const response = await ask(parent, restoreQuestion(copy.date, backup.counts ?? backupCounts(backup.files), store.storage.custom));
  if (response === 0) return;
  await settleEditing();
  let files: BackupFiles;
  backups.busy = true;
  try {
    files = importInto(store.dataDirectory, backups.folder, backup.files, response === 1 ? "replace" : "merge", backupSource(), new Date(), "beforeRestore").files;
  } catch {
    store.reloadAll();
    await warn();
    return;
  } finally {
    backups.busy = false;
    backups.refresh();
  }
  store.reloadAll();
  await ask(parent, {
    icon: "box", title: t("되돌리기", undefined, "restore"), message: t("되돌렸어요."), detail: `${summaryText(summary(files), lang())}\n${t("되돌리기 전 것도 백업 목록에 남겨 뒀어요.")}`,
    buttons: [{ label: t("확인"), kind: "primary" }], cancelId: 0, size: "m",
  });
}

/** A copy's menu: 탐색기에서 보기, and 지우기 (to the Recycle Bin, so it can come back). */
function showBackup(name: string): void {
  const file = backups.fileOf(name);
  if (file) shell.showItemInFolder(file);
}

/** 기록 지우기 (#174): Claude's log emptied, after a yes on the slip. */
async function clearAiLog(): Promise<void> {
  const answer = await ask(dialogParent(), {
    icon: "trash", title: t("기록 지우기"), message: t("Claude가 한 일의 기록을 지울까요?"),
    detail: t("최근 AI 작업과 그 되돌리기가 함께 사라져요. 할 일 · 일정 · 메모는 그대로예요."),
    buttons: [{ label: t("취소"), kind: "ghost" }, { label: t("지우기"), kind: "primary", clay: true }], cancelId: 0,
  });
  if (answer === 1) ai.clearLog();
}

async function deleteBackup(name: string): Promise<void> {
  const file = backups.fileOf(name);
  if (!file) return;
  try { await shell.trashItem(file); } catch { /* still there: the list shows it */ }
  backups.refresh();
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
      message: folder ? t("이 폴더에 이미 종이냥 목록이 있어요.") : t("이 PC에 전에 쓰던 목록이 있어요."), replacesList: true,
      // An overwrite backs the overwritten list up first (#137, moveData); the record is merged either way.
      detail: [folder
        ? t("다른 기기에서 쓰던 목록이면 ‘폴더 목록 쓰기’를 고르면 돼요. 덮어써도 바꾸기 전 상태를 이 PC에 백업해 둬요.")
        : t("공유 폴더로 옮기기 전의 목록으로 돌아가려면 ‘전에 쓰던 목록 쓰기’를 고르면 돼요. 덮어써도 바꾸기 전 상태를 백업해 둬요."),
      t("어느 쪽이든 완료 기록은 합쳐지고, 종이냥이 다시 시작돼요.")].join("\n"),
      buttons: [{ label: t("취소"), kind: "ghost" }, { label: folder ? t("이 PC 목록으로 덮어쓰기") : t("공유 폴더 목록으로 덮어쓰기"), kind: "ghost" },
        { label: folder ? t("폴더 목록 쓰기") : t("전에 쓰던 목록 쓰기"), kind: "primary" }], cancelId: 0,
    });
    if (response === 0) return;
    copy = response === 1;
  } else if (!folder) {
    // #240: ‘이 PC에만’ is one click on the storage pane now — say what it does before the list moves and the app restarts.
    const response = await ask(parent, {
      icon: "folder", title: t("저장 위치"), size: "m", message: t("목록을 이 PC로 옮길까요?"),
      detail: t("지금 목록이 이 PC의 기본 폴더로 옮겨지고 종이냥이 다시 시작돼요. 공유 폴더의 파일은 그대로 남아요."),
      buttons: [{ label: t("취소"), kind: "ghost" }, { label: t("이 PC로 옮기기"), kind: "primary" }], cancelId: 0,
    });
    if (response !== 1) return;
  }
  store.flush();
  try {
    moveData(store.dataDirectory, target, copy, backups.folder, backupSource(), new Date());
    writeDataFolder(settingsDirectory, folder);
    // #195: the restarted app says once where the list went — the folder's name as the storage pane shows it, never its path.
    try {
      writeMoved(settingsDirectory, { ...(folder ? { folder: folderPlace(folder, os.homedir(), process.platform === "win32").name } : {}), kept: copy ? "moved" : "folder" });
    } catch { /* the move is done; only the toast is missed */ }
  } catch {
    await ask(parent, { icon: "warning", title: t("저장 위치"), message: t("폴더로 옮기지 못했어요. 지금 목록은 그대로예요."), buttons: [{ label: t("확인"), kind: "primary" }], cancelId: 0 });
    return;
  }
  app.relaunch();
  quit();
}

/** #195: the toast after a move — where the list went, or whose list is used now. */
function storageMovedText(moved: StorageMoved): string {
  if (moved.folder) return moved.kept === "moved" ? t("목록을 ‘{name}’ 폴더로 옮겼어요", { name: moved.folder }) : t("‘{name}’ 폴더의 목록을 써요", { name: moved.folder });
  return moved.kept === "moved" ? t("목록을 이 PC의 기본 위치로 옮겼어요") : t("이 PC에 전에 쓰던 목록을 써요");
}

async function chooseStorage(): Promise<void> {
  const parent = dialogParent();
  // #195: the dialog's title (Windows' folder dialog has no message line) and its button say what picking does.
  const result = await dialog.showOpenDialog(parent, {
    title: t("지금 목록을 옮길 폴더를 골라요. 옮기면 종이냥이 다시 시작돼요."), buttonLabel: t("이 폴더로 옮기기"), properties: ["openDirectory", "createDirectory", "promptToCreate"],
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
  const index = testHooks ? process.argv.indexOf("--weekly-now") : -1;
  const now = index >= 0 ? new Date(process.argv[index + 1]) : new Date();
  const result = weeklyLookback(now, archive.all(), store.prefs.lookbackWeek, lang());
  if (!result) return;
  store.setPref("lookbackWeek", result.week);
  pet.say(result.message, 10);
  pet.cheer();
}

function handle(action: Action, sender: Electron.WebContents, frame?: WebFrameMain | null): void {
  switch (action.type) {
    // ─── 메모 서랍 ───
    case "drawer": { if (action.command === "open") drawer.show({ memo: action.memo, write: action.write }); else if (action.command === "close") drawer.close(); else drawer.toggle(); return; }
    case "spaceAdd": {
      const color = action.color ?? undefined;
      store.changeSpaces((data) => addSpace(data, action.name, action.id, color));
      if (action.todo && findSpace(store.todoSpaces, action.id)) moveToSpace([action.todo], action.id);
      return;
    }
    case "spaceRename": return store.changeSpaces((data) => renameSpace(data, action.id, action.name));
    case "generalRename": return store.changeSpaces((data) => renameGeneral(data, action.name));
    case "spaceColor": return store.changeSpaces((data) => recolorSpace(data, action.id, spaceColor(action.color) === action.color ? action.color : "lavender"));
    case "spaceDelete": return store.changeSpaces((data) => deleteSpace(data, action.id).data);
    case "spaceRestore": return store.changeSpaces((data) => restoreSpace(data, action.id, action.todos));
    case "spaceOrder": return store.changeSpaces((data) => reorderSpaces(data, action.ids));
    case "todoSpace": return moveToSpace(action.ids, action.space);
    case "groupDrop": return action.ids && action.ids.length > 1 ? dropManyInGroup(action.ids, action.space, action.targetID, action.after ?? false)
      : dropInGroup(action.id, action.space, action.targetID, action.after ?? false);
    case "moveMany": return void store.mutate((history) => history.reorder(movedBlock(history.items.map((item) => item.id), action.ids, action.targetID, action.after)));
    case "restoreOrder": return void store.mutate((history) => history.reorder(restoredOrder(history.items.map((item) => item.id), action.ids, action.previous)));
    case "spaceLens": return store.setPref("spaceLens", action.space ? lensFor(action.space) : null);
    case "spacePeek": return store.setDevicePeek(action.spaces);
    case "openSpaces": return void openDesk("spaces");
    case "folderAdd": return store.changeFolders((data) => addFolder(data, action.name, action.color, action.id));
    case "folderRename": return store.changeFolders((data) => renameFolder(data, action.id, action.name));
    case "folderColor": return store.changeFolders((data) => recolorFolder(data, action.id, action.color));
    case "folderDelete": return store.changeFolders((data) => deleteFolder(data, action.id));
    case "folderRestore": return store.changeFolders((data) => restoreFolder(data, action.id, action.memos));
    case "folderOrder": return store.changeFolders((data) => reorderFolders(data, action.ids));
    case "memoMove": {
      store.changeFolders((data) => moveMemo(data, action.id, action.folder));
      // 폴더로 옮기기 ▸ 최근: the last two folders memos were moved to, newest first.
      const recent = [action.folder, ...store.prefs.drawerRecentMoves.filter((id) => id !== action.folder)].slice(0, 2);
      if (recent.join() !== store.prefs.drawerRecentMoves.join()) store.setPref("drawerRecentMoves", recent);
      return;
    }
    case "folderSort": {
      if (action.id === pinnedView) store.setPref("drawerPinnedSort", action.sort);
      else store.changeFolders((data) => setFolderSort(data, action.id, action.sort));
      return;
    }
    case "folderView": {
      if (action.id === pinnedView) store.setPref("drawerPinnedView", action.view);
      else store.changeFolders((data) => setFolderView(data, action.id, action.view));
      return;
    }
    case "folderDuplicate": return store.duplicateFolder(action.id, action.newID);
    case "memoPaper": return store.changeFolders((data) => setMemoPaper(data, action.id, action.paper));
    case "memoPinMany": return store.changeFolders((data) => (action.pinned ? pinAll(data, action.ids) : action.ids.reduce((next, id) => setPinned(next, id, false), data)));
    case "memoSetText": return store.setMemoText(action.id, action.text);
    case "memoDuplicate": { store.duplicateMemo(action.id); return; }
    case "drawerPaste": {
      // Answers whether there was text (the page says so when there wasn't).
      const added = Promise.resolve(clipboard.readText()).then((text) => Boolean(store.addMemoText(String(text).replace(/\r\n/g, "\n").trim(), targetOf(store.memoFolders, action.view))));
      return added as unknown as void;
    }
    case "openLink": { openExternalSafely(action.url); return; }
    case "editCommand": {
      if (action.command === "cut") sender.cut(); else if (action.command === "copy") sender.copy(); else if (action.command === "paste") sender.paste(); else sender.selectAll();
      return;
    }
    case "memoPin": return store.changeFolders((data) => setPinned(data, action.id, action.pinned));
    case "memoCheck": return store.toggleMemoLine(action.id, action.line);
    case "drawerWrite": { store.addMemoText(action.text.trim(), targetOf(store.memoFolders, action.view)); return; }
    case "drawerView": {
      // 고정 isn't a folder: the last folder stays what it was.
      if (action.view !== pinnedView) store.setPref("drawerLastFolder", action.view === inboxID ? "" : action.view);
      return;
    }
    case "copyText": { clipboard.writeText(action.text); return; }
    // #228 · #229: the question slip's paper dragged; a press a waiting question held up.
    case "slipDrag": {
      // #246: 빠른 입력 · 빠른 메모 drag by their paper too (and a double-click puts them back); the question slip (#228).
      if (quick?.dragSlip(sender, action.phase, action.x, action.y) || quickMemo?.dragSlip(sender, action.phase, action.x, action.y)) return;
      if (action.phase !== "reset") confirmSlip.dragSlip(sender, action.phase, action.x, action.y);
      return;
    }
    case "slipBlocked": return confirmSlip.nudge();
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
    // Ctrl+Z right after Claude's toast (nothing changed here since) takes Claude's entry back.
    case "undo": return ai.undoLatest() ? undefined : store.mutate((history) => history.undo());
    case "redo": return store.mutate((history) => history.redo());
    case "setReminder": return store.mutate((history) => history.setReminder(action.id, action.at ? new Date(action.at) : undefined));
    case "setRange": {
      const range = action.start === undefined ? undefined : { start: action.start, ...(action.end !== undefined ? { end: action.end } : {}) };
      if (range && !validRange(range)) return;
      return store.mutate((history) => history.setRange(action.id, range));
    }
    case "saveSeries": store.saveSeries(action); return;
    case "deleteSeries": return store.deleteSeries(action.id);
    case "restoreSeries": return store.restoreSeries(action.series, action.todos);
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
    case "memoUntrash": { store.restoreFromTrash(action.id); return; }
    case "memoTrashEmpty": return store.emptyTrash();
    case "editingReminder":
      store.editingReminderID = action.id;
      return store.changed();
    case "setPref": return setPref(action.key, action.value);
    case "collapse": return collapse(action.anchor);
    case "openSettings": return openSettings(action.tab);
    case "aiEnable": return ai.setEnabled(action.on);
    case "aiUndo": return ai.undo(action.id);
    case "aiConnectDesktop": void connectClaudeDesktop(); return;
    case "aiClearLog": void clearAiLog(); return;
    case "aiCopyCommand":
      clipboard.writeText(ai.command);
      return ai.markCopied();
    case "deskPane": return desk.choose(action.pane);
    case "openGuide": return showGuide();
    case "timerCommand": return focusTimer.command(action.command);
    case "focus": return focusCommand(action.command);
    case "chatterPreview": return pet?.speakUp();
    // #230: a key went down in one of the app's windows; the cat decides whether to tap along.
    case "typingTap": return typingCat?.tap();
    case "openHistory": return openHistory(action.day);
    case "openSearch": return openSearch();
    case "openCalendar": return openCalendar(action.day, action.event);
    case "exportBackup": void exportBackup(); return;
    case "importBackup": void importBackup(); return;
    case "setBackupAuto": return backups.setAuto(action.on);
    case "backupNow": void backupNow(); return;
    case "chooseBackupFolder": void chooseBackupFolder(); return;
    case "resetBackupFolder": backups.setFolder(undefined); return;
    case "openBackupFolder": return openBackupFolder();
    case "restoreBackup": void restoreBackup(action.name); return;
    case "showBackup": return showBackup(action.name);
    case "deleteBackup": void deleteBackup(action.name); return;
    case "calendarShowTask": return showTask(action.id);
    case "openHelp": return openHelp(action.topic);
    case "drawerShortcuts": return void showDrawerShortcuts();
    case "openArchiveFolder": return openArchiveFolder();
    case "openDataFolder": return openDataFolder();
    case "previewReminder": return periodic.preview();
    case "snoozePeriodic": return periodic.snooze(action.minutes);
    case "copyList": return copyList();
    // 바탕화면 달력 위젯 (#234).
    case "widgetAdd": { widgets.add(action.kind, action.style); return; }
    case "widgetChange": return widgets.change(action.id, action.changes);
    case "widgetRemove": return widgets.remove(action.id);
    case "widgetRestore": return widgets.restore(action.widget, action.index);
    case "exportList": void exportList(); return;
    case "showMenu": {
      const window = BrowserWindow.fromWebContents(sender);
      if (window) moreMenu().popup({ window, x: Math.round(action.x), y: Math.round(action.y) });
      return;
    }
    case "showRowMenu": return showPaperRowMenu(action.id, { x: action.x, y: action.y, keyboard: action.keyboard });
    case "rowMenuPick": { const click = paperClicks[action.pick]; paperClicks = []; click?.(); return; }
    case "calendarNewEvent": return calendar.newEvent(action.at);
    case "calendarEditEvent": return calendar.editEvent(action.key);
    case "showEventMenu": {
      const inCalendar = desk.isCalendarFrame(frame);
      // On the note: the paper menu, with the row menu's icons (the 달력 window keeps the native one).
      if (!inCalendar && action.x !== undefined && action.y !== undefined) return showPaperEventMenu(action.key, { x: action.x, y: action.y });
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
      void ask(note, {
        icon: "warning", title: t("저장 폴더 확인"), message: store.storageError ?? "", size: "m",
        buttons: [{ label: t("저장 폴더 열기"), kind: "ghost" }, { label: t("닫기"), kind: "primary" }], cancelId: 1,
      }).then((answer) => { if (answer === 0) void shell.openPath(store.dataDirectory); });
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

/** Puts a reading of the 입력 줄 in: what was made (to take back with the toast), or why not. `space`: a repeat's rule's (2a). */
function intentCommit(candidate: WireCandidate, page: IntentPage, space?: string): IntentResult {
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
      // 2a (A12): with its space (`#회사`, or the lens), so today's copy is made in it too.
      const id = store.saveSeries({ title: candidate.title, rule: candidate.rule, ...(candidate.time ? { remindAt: candidate.time } : {}), ...(space ? { space } : {}) }, now);
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

/**
 * `#회사` or the lens (S1–S8): a to-do just made goes into its space; `#세탁` with no such space makes it first (the
 * next colour, S4) — taken back with the to-do. Anything else made keeps no space (S9).
 */
function withSpace(result: IntentResult, space: SpaceChoice | undefined): IntentResult {
  if (!space || space.kind === "none" || result.made?.kind !== "todo" || !result.made.id) return result;
  const todo = result.made.id;
  if (space.kind === "space") {
    store.changeSpaces((data) => moveTodo(data, todo, space.id));
    return result;
  }
  const id = newSpaceID(store.todoSpaces);
  store.changeSpaces((data) => moveTodo(addSpace(data, space.name, id), todo, id));
  return findSpace(store.todoSpaces, id) ? { ...result, made: { ...result.made, space: id } } : result;
}

/**
 * 2a (S29–S31): a repeat takes its space before it is saved (its rule's, so today's copy is made in it); `#세탁` makes
 * the space first, taken back with the rule. Anything else: `withSpace` after it's made.
 */
function commitWithSpace(candidate: WireCandidate, page: IntentPage, space: SpaceChoice | undefined): IntentResult {
  if (candidate.kind !== "repeat" || !space || space.kind === "none") return withSpace(intentCommit(candidate, page), space);
  let made: string | undefined;
  if (space.kind === "new") {
    const id = newSpaceID(store.todoSpaces);
    store.changeSpaces((data) => addSpace(data, space.name, id));
    if (findSpace(store.todoSpaces, id)) made = id;
  }
  const result = intentCommit(candidate, page, space.kind === "space" ? space.id : made);
  if (!result.made) {
    if (made) store.changeSpaces((data) => deleteSpace(data, made!).data);
    return result;
  }
  return made ? { ...result, made: { ...result.made, space: made } } : result;
}

/** Takes back what a reading made: no trace, no line in the record. */
function intentUndo(made: IntentMade): void {
  takeBack(made);
  // A space the line made (`#세탁`) goes with what it made — when nothing else is in it now (A18): no to-do still on
  // the list and no repeat rule. The taken-back to-do's own entry stays in the file (30 days) and isn't counted.
  const space = made.space;
  if (space && lineSpaceIsEmpty(space)) store.changeSpaces((data) => deleteSpace(data, space).data);
}

/** A18: no to-do on the list and no repeat rule is in the space. */
function lineSpaceIsEmpty(space: string): boolean {
  return !store.items.some((item) => spaceOf(store.todoSpaces, item.id) === space)
    && !store.series.some((entry) => seriesSpaceOf(store.todoSpaces, entry.id) === space);
}

function takeBack(made: IntentMade): void {
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
  const made = commitWithSpace(request.candidate, request.from === "quick" ? "today" : request.page, request.space);
  // #196 (D12): a to-do put where this PC hides it — the toast says so.
  const hiddenIn = madeHiddenIn(made.made);
  const result: IntentResult = hiddenIn ? { ...made, hiddenIn } : made;
  // 빠른 입력 while the note is up: the card closes at once and the note shows the toast.
  if (result.made && request.from === "quick" && note.isVisible() && !note.isMinimized() && request.candidates && request.text !== undefined) {
    const index = request.candidates.findIndex((entry) => JSON.stringify(entry) === JSON.stringify(request.candidate));
    note.webContents.send("note:toast", { made: result.made, candidates: request.candidates, index: Math.max(0, index), text: request.text, ...(request.space ? { space: request.space } : {}), ...(hiddenIn ? { hiddenIn } : {}) });
    return { ...result, inNote: true };
  }
  return result;
}

/** #196: the name of the space a to-do just made went into, when this PC hides it (일반 by its name). */
function madeHiddenIn(made: IntentMade | undefined): string | undefined {
  if (made?.kind !== "todo" || !made.id) return undefined;
  const item = store.items.find((entry) => entry.id === made.id);
  if (!item || !store.hidesHere(item)) return undefined;
  return findSpace(store.todoSpaces, spaceOf(store.todoSpaces, item.id))?.name ?? generalName(store.todoSpaces, lang());
}

function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
  // 언어 asks first and starts the app again.
  if (key === "language") return void setLanguage(value as LanguageSetting);
  // #196: 이 기기에서 — kept cleaned, a space made visible noted (D10), its 잠깐 보기 ended (D6).
  if (key === "spaceDevice") return store.setDeviceRules(value as Prefs["spaceDevice"]);
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
  const dot = soonest(events, store.hereItems, now) !== undefined;
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
 * The tray's tooltip, like the Mac's menu bar text: "종이냥 · 21분 남음" while a timer runs (#46), "종이냥 · 치과
 * 40분" when an event or a reminder starts within the hour, else just "종이냥".
 */
function trayTooltip(now = new Date()): string {
  const events = nearEvents(now);
  const timer = glanceTimer(now.getTime());
  const text = glanceText(events, store.hereItems, timer, now, lang());
  // A timer runs and something comes within the hour (the dot): both, so the dot is named.
  const soon = timer && !timer.paused ? glanceText(events, store.hereItems, undefined, now, lang()) : undefined;
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
  if (link) return runNotifyAction(acceptNotifyAction(link, ringingNonce()));
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
function postNotice(notice: { kind: "tasks"; ids: string[]; title: string; lines: string[] } | { kind: "alarm"; title: string; lines: string[]; nonce: string }): boolean {
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
    else runNotifyAction(acceptNotifyAction(index === 0 ? { kind: "alarmStop", nonce: notice.nonce } : { kind: "alarmSnooze", nonce: notice.nonce }, ringingNonce()));
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
    case "alarmStop": alarmNonce = undefined; return alarmClock.stop();
    case "alarmSnooze": alarmNonce = undefined; return alarmClock.snooze(false);
  }
}

/** Task alerts: Windows' notification too, when the setting wants it. */
function taskNotice(items: readonly TodoItem[], locked: boolean): boolean {
  if (snapshotDirectory || items.length === 0 || !wantsSystemNotice(store.prefs.systemNotify, systemContext(locked))) return false;
  const title = items.length > 1 ? t("할 일 알림 · {n}개", { n: items.length }) : t("할 일 알림");
  return postNotice({ kind: "tasks", ids: items.map((item) => item.id), title, lines: items.slice(0, 2).map((item) => item.title) });
}

/**
 * #172 (review L-03): the one-time value in the ringing alarm's notification links (끄기 · 다시 알림). A link without it
 * (any web page can open `jongi-nyang:alarm-stop`) only opens the note; once used, or once the alarm stops, it is gone.
 */
let alarmNonce: string | undefined;
const ringingNonce = (): string | undefined => (alarmClock?.isRinging ? alarmNonce : undefined);

/** An alarm rang: Windows' notification too, when the setting wants it. */
function alarmNotice(alarm: Alarm): void {
  if (snapshotDirectory || !wantsSystemNotice(store.prefs.systemNotify, systemContext(false))) return;
  const [hour, minute] = alarm.time.split(":").map(Number);
  alarmNonce = makeNonce();
  postNotice({ kind: "alarm", title: t("알람 · {time}", { time: spokenTime(hour, minute, lang()) }), lines: alarm.label ? [alarm.label] : [], nonce: alarmNonce });
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
  if (link || command) setTimeout(() => (link ? runNotifyAction(acceptNotifyAction(link, ringingNonce())) : runLaunchCommand(command!)), 900);
  // 1.28: where the memo tab's memos went — once, when the note is first up.
  if (!demo && !store.prefs.drawerMoveNoticeShown) {
    if (note.isVisible()) setTimeout(moveNoticeOnce, 1500); else note.once("show", () => setTimeout(moveNoticeOnce, 800));
  }
  if (demo || startedAtLogin(process.argv)) return;
  // Counted only while 컴퓨터를 켤 때 같이 열기 is off (as on the Mac).
  if (!store.prefs.openAtLogin) store.setPref("manualLaunches", (store.prefs.manualLaunches ?? 0) + 1);
  setTimeout(askLogin, 25_000);
}

/** The move notice's slip (M1): 서랍 열기 (the drawer on 메모) · 나중에. Undefined without memos (M2). */
function moveQuestion(): ConfirmQuestion | undefined {
  const words = moveNotice(store.memos.length, false, store.prefs.drawerShortcut, lang());
  if (!words) return undefined;
  return { icon: "drawer", title: words.title, message: words.message, buttons: [{ label: words.later, kind: "ghost" }, { label: words.open, kind: "primary" }], cancelId: 0, cat: true };
}

/** M1–M3: the slip once per device, the flag set whichever way it goes (and when there are no memos). */
function moveNoticeOnce(): void {
  if (store.prefs.drawerMoveNoticeShown) return;
  store.setPref("drawerMoveNoticeShown", true);
  const question = moveQuestion();
  if (!question) return;
  void ask(note, question).then((answer) => {
    if (answer !== 1) return;
    store.setPref("drawerLastFolder", "");
    drawer.show();
  });
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
  const description = store.hereTodayItems.length === 0 ? t("새 할 일을 적어 보세요") : count === 0 ? t("다 했어요") : t("{count}개 남음", { count });
  return [
    { label: t("노트 열기 ({description})", { description }), click: showNote },
    { label: t("새 할 일"), click: () => { showNote(); note.webContents.send("note:focus-new"); } },
    { label: t("빠른 입력 (Ctrl+Alt+N)"), click: () => quick.open() },
    { label: t("빠른 메모 (Ctrl+Alt+M)"), click: () => quickMemo.open() },
    { label: t("메모 서랍"), click: () => drawer.show() },
    { type: "separator" },
    ...nextAlarmItem(),
    { label: t("주기 알림"), type: "checkbox", checked: store.prefs.reminderEnabled, click: () => store.setPref("reminderEnabled", !store.prefs.reminderEnabled) },
    { label: t("1시간 쉬기"), enabled: store.prefs.reminderEnabled, click: () => periodic.snooze(60) },
    { label: t("완료 기록…"), click: () => openHistory() },
    { label: t("달력…"), click: () => openCalendar() },
    ...(widgets?.trayItem() ?? []),
    { label: t("설정…"), click: () => openSettings() },
    { label: t("도움말…"), click: () => openHelp() },
    { type: "separator" },
    { label: t("모두 내보내기…"), click: () => void fromStoragePane(exportBackup) },
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

/**
 * #253 (docs/plans/widget-ask-cases.json `presses`): a widget's or its day sheet's action while a question waits. A line
 * that opens the note or the desk's calendar brings that window forward and the question stays over it (or nudges, when
 * it is the window the question was asked over); a press the sheet holds for the answer nudges the question without
 * taking the sheet's keys (it goes away when it loses them, its text kept).
 */
function widgetAct(action: Action, sender: Electron.WebContents, frame: WebFrameMain | null, page: "widget" | "widgetSheet"): void {
  if (action.type === "slipBlocked") return confirmSlip.nudge(page === "widget");
  if (confirmSlip.up === "none" || (action.type !== "calendarShowTask" && action.type !== "openCalendar")) return handle(action, sender, frame);
  handle(action, sender, frame);
  const opened = action.type === "calendarShowTask" ? note : desk.browserWindow;
  confirmSlip.cameForward(opened && !opened.isDestroyed() ? opened : undefined);
}

function registerIPC(): void {
  // #172 (review L-02): every message is checked — sent by one of our pages in a window of ours (senderPage), allowed
  // for that page (pageActions · pageChannels), and of the right shape (readAction and the other readers). Anything
  // else is refused and logged by its type only.
  const from = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent, channel?: string): PageName | undefined => {
    const page = senderPage(event, rendererDirectory);
    if (!page || (channel && !pageChannels[channel]?.has(page))) { refused(channel ?? "message", page); return undefined; }
    return page;
  };
  // --demo runs (never a release build, #174; never snapshots) are driven by tools/perf*.mjs and drag-probe.mjs through
  // the note with actions the note itself doesn't send: there any page of ours may ask for any (well-formed) action.
  const anyAction = demo && !snapshotDirectory;
  ipcMain.handle("state:get", (event) => (from(event, "state:get") ? store.state() : undefined));
  // A page (or a reloaded one) listening: it is sent its part on the next change, whatever it was sent before.
  ipcMain.on("state:want", (event, kind: unknown) => {
    const frame = event.senderFrame;
    if (!frame || !from(event)) return;
    const kinds = stateFrames.get(frame) ?? new Map<StateKind, string | undefined>();
    kinds.set(readStateKind(kind), undefined);
    stateFrames.set(frame, kinds);
  });
  // The preload asks once, before the page draws (every window speaks the app's language). A sender that isn't ours
  // still gets an answer (a sync message waits for one): the default.
  ipcMain.on("lang:get", (event) => { event.returnValue = from(event) ? lang() : "ko"; });
  ipcMain.on("clock:get", (event) => { event.returnValue = from(event) ? hourCycle(lang()) : "h24"; });
  ipcMain.on("week:get", (event) => { event.returnValue = from(event) ? weekStartSet() ?? "" : ""; });
  ipcMain.handle("act", (event, value: unknown) => {
    const page = from(event);
    const action = readAction(value);
    if (!page || !action || !(anyAction || mayAct(page, action))) return void refused("act", page, value);
    if (page === "widget" || page === "widgetSheet") return widgetAct(action, event.sender, event.senderFrame, page);
    return handle(action, event.sender, event.senderFrame);
  });
  // 밤 종이: asked by every page (and frame) as it loads, before it draws.
  ipcMain.on("paper:get", (event) => {
    const look = paperLookNow();
    event.returnValue = from(event) ? { paper: look.shown, dark: look.scheme === "dark", nightNow: paperNightNow() } : { paper: "day", dark: false, nightNow: false };
  });
  ipcMain.handle("history:get", (event) => {
    if (!from(event, "history:get")) return undefined;
    // 스페이스 2c (H1–H3): each line with its space worked out, the live spaces and 일반's name, for the filter.
    const lines = historySpaces(store.todoSpaces, archive.all(), focusLog.all());
    const spaces = liveSpaces(store.todoSpaces).map(({ id, name, color }) => ({ id, name, color }));
    return { ...lines, now: Date.now(), spaces, general: generalName(store.todoSpaces, lang()) };
  });
  ipcMain.handle("calendar:write", (event, value: unknown) => {
    const request = from(event, "calendar:write") ? readCalendarRequest(value) : undefined;
    return request ? calendar.write(request) : { ok: false, error: "" };
  });
  ipcMain.handle("intent", (event, value: unknown) => {
    const page = from(event, "intent");
    const request = page ? readIntentRequest(value) : undefined;
    // #253: from a widget or its day sheet, putting in and taking back wait while the question replaces the whole list
    // (the page dims and asks first; this is the main process's own check). The text stays in the sheet.
    if (request && (page === "widget" || page === "widgetSheet") && request.op !== "learn"
      && widgetPressWhileUp(request.op === "undo" ? "undo" : "add", confirmSlip.up) === "waits") {
      confirmSlip.nudge(false);
      return {};
    }
    return request ? intentRequest(request) : {};
  });
  ipcMain.handle("search", (event, query: unknown) => (from(event, "search") && typeof query === "string" && query.length <= 200
    ? search({ items: store.items, memos: store.memos, archive: archive.all(), events: store.events, dueStyle: store.prefs.dueStyle, memoFolder: memoFolderName, spaces: store.todoSpaces }, query, new Date(), lang())
    : []));
}

/** 메모 서랍: a memo's folder name for the note (none for the inbox, 메모). */
function memoFolderName(id: string): string | undefined {
  const folder = placementOf(store.memoFolders, id).folder;
  if (folder === inboxID) return undefined;
  const entry = store.memoFolders.folders.find((candidate) => candidate.id === folder);
  return entry ? folderName(entry, lang()) : undefined;
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
  if (process.env.PAPERTODO_SNAPSHOT_ONLY === "spaces2b") {
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
function pinSampleReminders(dayStart: Date): () => void {
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
async function cancelDrag(at: { x: number; y: number }, wait: Wait): Promise<void> {
  note.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  note.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape" });
  await wait(60);
  noteMouse("mouseUp", at.x, at.y);
  noteMouse("mouseMove", 2, 2);
  await wait(300);
}

async function dragBlock(title: string, where: "top" | "middle" | "bottom", dy: number, wait: Wait, place?: "top" | "middle"): Promise<{ x: number; y: number } | undefined> {
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
async function paperShots(directory: string, save: Save, wait: Wait): Promise<number> {
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
async function todayWindowShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
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

const glanceStateNames = ["nothing", "event-soon", "event-later", "timer", "alarm", "many", "busy"] as const;
type GlanceStateName = typeof glanceStateNames[number];

/**
 * Snapshots: the app's data for a state of the 오늘 창 — nothing at all; an event within the hour; a
 * timer running; alarms on; many tasks (다음, three more, 외 N개). Returns what puts things back.
 */
/** The 오늘 창's window holds all of its slip (nothing cut at the top or the bottom): "ok", or what is cut. */
async function glanceFit(window: BrowserWindow): Promise<string> {
  const [stageHeight, stageWidth] = await window.webContents.executeJavaScript(`(() => { const r = document.getElementById("stage").getBoundingClientRect(); return [Math.ceil(r.bottom), Math.ceil(r.right)]; })()`).catch(() => [0, 0]) as number[];
  const [width, height] = window.getContentSize();
  return stageHeight > height + 1 || stageWidth > width + 1 ? `CUT (slip ${stageWidth}×${stageHeight} in a ${width}×${height} window)` : `ok (${width}×${height})`;
}

function glanceState(name: GlanceStateName): () => void {
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
function confirmQuestions(): [string, ConfirmQuestion][] {
  return [
    ["confirm-language", languageQuestion(lang() === "en" ? "nl" : "en")],
    ["confirm-import", { icon: "box", title: t("가져오기"), message: t("이 백업을 가져올까요?"), replacesList: true, size: "m", cancelId: 0,
      detail: [`${t("종이냥")}-2026-10-08.jongi`, t("{from}에서 {when} 내보냄", { from: "Mac 1.34.0", when: exportedText(new Date().toISOString(), lang()) ?? "" }), summaryText({ todos: 12, memos: 3, repeats: 2, events: 9, archive: 140, alarms: 3, focus: 18 }, lang()), "", t("합치기: 지금 것은 그대로 두고 없는 것만 더해요."), t("바꾸기: 지금 것을 모두 이 백업으로 바꿔요."), t("어느 쪽이든 지금 것은 먼저 백업해 둬요.")].join("\n"),
      buttons: [{ label: t("취소"), kind: "ghost" }, { label: t("바꾸기"), kind: "danger" }, { label: t("합치기"), kind: "primary" }] }],
    ["confirm-restore", sampleRestoreQuestion(false)],
    ["confirm-storage", { icon: "folder", title: t("저장 위치"), size: "m", cancelId: 0, message: t("이 폴더에 이미 종이냥 목록이 있어요."), replacesList: true,
      detail: [t("다른 기기에서 쓰던 목록이면 ‘폴더 목록 쓰기’를 고르면 돼요. 덮어써도 바꾸기 전 상태를 이 PC에 백업해 둬요."), t("어느 쪽이든 완료 기록은 합쳐지고, 종이냥이 다시 시작돼요.")].join("\n"),
      buttons: [{ label: t("취소"), kind: "ghost" }, { label: t("이 PC 목록으로 덮어쓰기"), kind: "ghost" }, { label: t("폴더 목록 쓰기"), kind: "primary" }] }],
    // 1.28: where the memo tab's memos went (M1).
    ...(moveQuestion() ? [["confirm-move-notice", moveQuestion()!] as [string, ConfirmQuestion]] : []),
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

// ─── AI 연결's snapshots ─────────────────────────────────────────────────────

/**
 * Snapshots: Claude's work on the list as it stands — two to-dos it added today (one with hours), the time of
 * one of today's events it changed, and yesterday's work (an event; a to-do taken back) for the recent list.
 * The to-dos and the event are made here; the log says Claude made them, so they carry the stamp.
 */
function aiSample(onList = true): { entries: AiLogEntry[]; made: { tasks: string[]; event: string } } {
  const now = Date.now();
  const at = (minutes: number) => new Date(now - minutes * 60_000);
  const loose = (title: string, id: string): TodoItem => ({ id, title, isCompleted: false, createdAt: isoDate(new Date(now)) });
  let tasks: TodoItem[] = [loose(t("발표 자료 검토하기"), "AI-SAMPLE-1"), loose(t("치과 예약 전화"), "AI-SAMPLE-2")];
  if (onList) store.mutate((history) => {
    tasks = [history.addTo(t("발표 자료 검토하기"), undefined, new Date(), undefined, undefined, { start: 840, end: 900 })!, history.addTo(t("치과 예약 전화"), undefined, new Date())!];
  });
  const stamp = new Date(now - 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const before: LocalEvent = { id: "AI-SAMPLE-EVENT", title: t("팀 회의"), date: dayKey(new Date()), allDay: false, days: 1, start: 720, end: 780, repeat: "none", skip: [], color: "sage", location: t("회의실 A"), createdAt: stamp, updatedAt: stamp };
  const after: LocalEvent = { ...before, start: 780, end: 840, updatedAt: at(10).toISOString().replace(/\.\d{3}Z$/, "Z") };
  if (onList) store.replaceEvents([...store.events.filter((event) => event.id !== before.id), after]);
  const item = (value: object) => ({ ...value }) as AiItem;
  const gone = { id: "AI-SAMPLE-GONE", title: t("책 반납하기"), isCompleted: false, createdAt: stamp };
  const added = aiEntry({ client: "Claude", tool: "add_todos", kind: "add", target: "todos", title: tasks[0].title, changes: tasks.map((task) => ({ file: "todos.json", id: task.id, before: null, after: item(task) })) }, at(25));
  const moved = aiEntry({ client: "Claude", tool: "apply_changes", kind: "change", target: "events", title: after.title, changes: [{ file: "events.json", id: after.id, before: item(before), after: item(after) }] }, at(10));
  const yoga = aiEntry({ client: "Claude", tool: "add_event", kind: "add", target: "events", title: t("요가"), changes: [{ file: "events.json", id: "AI-SAMPLE-YOGA", before: null, after: item({ id: "AI-SAMPLE-YOGA", title: t("요가") }) }] }, at(60 * 26));
  const book = aiEntry({ client: "Claude", tool: "add_todos", kind: "add", target: "todos", title: gone.title, changes: [{ file: "todos.json", id: gone.id, before: null, after: item(gone) }] }, at(60 * 25));
  const undo = aiEntry({ client: "app", tool: "undo", kind: "undo", target: "todos", title: gone.title, undoes: book.id, changes: [{ file: "todos.json", id: gone.id, before: item(gone), after: null }], count: 1 }, at(60 * 25 - 2));
  return { entries: [yoga, book, undo, added, moved], made: { tasks: tasks.map((task) => task.id), event: after.id } };
}

/** Snapshots: Claude's sample taken away again (its to-dos, its event and the log). */
function aiSampleGone(made: { tasks: string[]; event: string }): void {
  store.mutate((history) => { for (const id of made.tasks) history.delete(id); });
  store.replaceEvents(store.events.filter((event) => event.id !== made.event));
  ai.seedForSnapshots([]);
}

/** What the AI 연결 shots check in the note: every stamp shown whole inside its row, the toast's words not cut. */
const aiNoteScript = `(() => {
  const out = [];
  const r = (element) => element.getBoundingClientRect();
  const stamps = [...document.querySelectorAll(".ai-stamp")].filter((stamp) => !stamp.hidden && stamp.offsetParent);
  for (const stamp of stamps) {
    const row = stamp.closest(".row, .strip-row, .lead-row");
    const box = r(stamp), outer = row ? r(row) : { left: 0, right: window.innerWidth, top: 0, bottom: window.innerHeight };
    if (box.left < outer.left - 0.5 || box.right > outer.right + 0.5 || box.right > window.innerWidth) out.push("stamp outside its row: " + (row?.textContent ?? ""));
    const neighbour = stamp.nextElementSibling;
    if (neighbour && getComputedStyle(neighbour).display !== "none" && r(neighbour).width > 0 && box.right > r(neighbour).left + 1) out.push("stamp under " + neighbour.className);
  }
  const text = document.querySelector(".toast .toast-text");
  if (text && text.scrollHeight > text.clientHeight + 1) out.push("toast cut: " + text.textContent);
  if (text && text.scrollWidth > text.clientWidth + 1) out.push("toast cut: " + text.textContent);
  const toast = document.querySelector(".toast");
  if (toast && (r(toast).left < 0 || r(toast).right > window.innerWidth)) out.push("toast outside the note");
  return (out.join("; ") || "ok") + " · " + stamps.length + " stamps";
})()`;

/** The settings pane's checks (the sweep's, and AI 연결's shots). */
const settingsPaneChecks: LayoutCheckOptions = {
  ignore: ".ph-cat",
  inside: [".pane-head", ".bottom", ".bottom > *"],
  oneLine: [".pane-head h1", ".segmented button", ".seg button", ".action", ".group > .label", ".tile .name", ".ai-time", ".ai-undone", ".ai-day"],
  rows: [".pane-head", ".row", ".bottom", ".form-actions"],
};

/**
 * `npm run snapshot -- ai` (and the full run): AI 연결 (1.27), day and night — the stamps on the list and the
 * strip, the toast with 되돌리기, 자리 비운 사이, a partial undo, and 설정 › AI 연결 (on with work, after an
 * undo, and off with nothing yet). Returns how many layout problems it found.
 */
async function aiShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
  let problems = 0;
  const run = (script: string) => note.webContents.executeJavaScript(script).catch((error: Error) => `script failed: ${error.message}`);
  floating.hide();
  focusTimer.command({ kind: "stop" });
  note.webContents.reload();
  note.showInactive();
  await wait(1200);
  store.setPref("calendarStrip", true);
  openDay(false);
  ai.setEnabled(true);
  const dayStart = logicalDayStart(new Date());
  const tenAM = new Date(dayStart.getTime() + 6 * 3_600_000).toISOString();
  const unpin = pinSampleReminders(dayStart);
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    const prefix = paper === "night" ? "night/" : "";
    if (paper === "night") fs.mkdirSync(path.join(directory, "night"), { recursive: true });
    const sample = aiSample();
    ai.seedForSnapshots(sample.entries);
    note.webContents.send("note:row-command", { id: "", command: "page-today" });
    await wait(400);
    // The strip at 10:00 of today, so the changed meeting and the to-do with hours are still ahead in it.
    await run(`window.ribbonNow = ${JSON.stringify(tenAM)}; window.dispatchEvent(new Event("ribbon-now")); document.querySelector(".sheet").scrollTop = 0`);
    const shot = async (name: string, checks = noteLayoutChecks) => {
      await wait(450);
      await settled(note);
      const report = await note.webContents.executeJavaScript(layoutCheckScript(checks)).catch((error: Error) => ({ problems: [`check failed: ${error.message}`], truncated: [] })) as LayoutReport;
      const own = await run(aiNoteScript) as string;
      const found = [...report.problems, ...(own.startsWith("ok") ? [] : [own])];
      console.log(`ai ${prefix}${name}: ${found.length ? found.join("; ") : "ok"} · ${own.replace(/^ok · /, "")}`);
      problems += found.length;
      await save(`${prefix}${name}`, note.webContents.capturePage());
    };
    await shot("ai-marked");
    await run(`document.querySelector(".lines .ai-stamp:not([hidden])")?.closest(".row")?.scrollIntoView({ block: "center" })`);
    // (The strip scrolled away above is meant.)
    await shot("ai-marked-list", { ...noteLayoutChecks, inside: noteLayoutChecks.inside?.filter((selector) => !selector.startsWith(".strip")) });
    await run(`document.querySelector(".sheet").scrollTop = 0`);
    const [, , , added, moved] = sample.entries;
    notice({ icon: "sparkles", text: aiToastText(added, lang()), undo: "ai", entry: added.id, long: true });
    await shot("ai-toast");
    notice({ icon: "sparkles", text: aiToastText(moved, lang()), undo: "ai", entry: moved.id, long: true });
    await shot("ai-toast-time");
    notice({ icon: "sparkles", text: aiAwayText(3, lang()), show: "ai", long: true });
    await shot("ai-away");
    notice({ icon: "warning", text: aiUndoText(1, 1, lang()), long: true });
    await shot("ai-undo-partial");
    await run(`document.querySelector(".toast")?.remove()`);

    // 설정 › AI 연결: on, with today's and yesterday's work.
    const pane = async (name: string) => {
      await showDeskPane("ai", wait);
      await wait(300);
      const report = await inPane("settings", layoutCheckScript(settingsPaneChecks)) as LayoutReport | string | undefined;
      const found = typeof report === "object" && report ? report.problems : [`check failed: ${String(report)}`];
      const groups = await inPane("settings", `[...document.querySelectorAll(".group")].map((g) => g.querySelector(".label").textContent + " (" + g.querySelectorAll(".row").length + ")").join(" · ")`);
      console.log(`ai ${prefix}${name}: ${found.length ? found.join("; ") : "ok"} · ${groups}`);
      if (typeof report === "object" && report?.truncated.length) console.log(`  … truncated: ${report.truncated.join(" · ")}`);
      problems += found.length;
      await save(`${prefix}${name}`, captureDesk(wait));
    };
    await pane("ai-settings");
    // 되돌리기 on Claude's two to-dos after one was changed here: the other goes, the entry says 되돌림 and how it went.
    store.mutate((history) => history.edit(sample.made.tasks[1], t("치과 예약 전화 (오후)")));
    ai.undo(added.id);
    await pane("ai-settings-undone");
    aiSampleGone(sample.made);
    ai.setEnabled(false);
    await pane("ai-settings-off");
    ai.setEnabled(true);
  }
  store.setPref("paper", "day");
  ai.setEnabled(false);
  await run(`window.ribbonNow = undefined; window.dispatchEvent(new Event("ribbon-now"))`);
  unpin();
  console.log(problems ? `AI PROBLEMS: ${problems}` : "AI OK");
  return problems;
}

// ─── 메모 서랍's snapshots ───────────────────────────────────────────────────

/**
 * Snapshots: the drawer's sample — folders 메모 · 회사 · 집 · 공부 (empty), five memos in 회사 (a long one, a
 * checklist half done, a command, a pinned one), a few in 메모 and 집. Times fixed relative to now.
 */
function drawerSample(): { ids: Record<string, string> } {
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
const drawerLayoutChecks: LayoutCheckOptions = {
  // Bookmarks write a name sideways or one letter; swatch names may end in … (the swatch says it); a link's faint
  // address (#84) breaks where it must in a narrow drawer, as an address does.
  ignore: ".ears, .tape, .tp, .bk, .swrow button > span, .md-mark",
  inside: [".dr", ".hd", ".ttl", ".ic", ".qk", ".ft", ".ft > *", ".menu", ".big", ".acts", ".pill", ".toast", ".tabs", ".tip"],
  oneLine: [".sub", ".menu .mi > .t", ".menu .label", ".menu .btn", ".qk-hint span", ".where", ".m", ".grp .lbl", ".ft .key", ".tip", ".acts .when", ".chip"],
  rows: [".ttl", ".it .row", ".acts", ".ft", ".kind", ".row-btns", ".swatches", ".grp"],
};

/** A busy desktop behind the window (two app windows on a bright wallpaper), for the 바탕 shots. */
const fakeDesktop = `(() => {
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
async function spacesShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
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
async function spaces2cShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
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

async function spaces2bShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
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
async function deviceShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
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

/**
 * #228 · #229 (docs/plans/slip-move-cases.json), off-screen: the question slip follows a drag on its title row but not one
 * that starts on its button; while it waits, presses on the note reach none of the note's own handlers and nudge it (one
 * each); answered, the note takes them again. The times slip moves about the 스페이스 pane by its paper, holds nothing
 * up (the next row's popup opens beside it), a space has one, and Esc closes the one with the focus. Prints
 * `slips <check>: ok` or what went wrong, and saves the question moved and two times slips.
 */
async function slipShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  const report = (name: string, wrong: string[]) => {
    console.log(`slips ${name}: ${wrong.length ? wrong.join("; ") : "ok"}`);
    problems += wrong.length;
  };
  fs.mkdirSync(path.join(directory, "slips"), { recursive: true });
  const press = async (contents: Electron.WebContents, x: number, y: number, to = { x, y }, button: "left" | "right" = "left") => {
    contents.sendInputEvent({ type: "mouseDown", x, y, button, clickCount: 1 });
    await wait(60);
    if (to.x !== x || to.y !== y) {
      contents.sendInputEvent({ type: "mouseMove", x: to.x, y: to.y, button, modifiers: [button === "left" ? "leftbuttondown" : "rightbuttondown"] });
      await wait(250);
    }
    contents.sendInputEvent({ type: "mouseUp", x: to.x, y: to.y, button, clickCount: 1 });
    await wait(250);
  };
  // The question: 저장 폴더's, asked over the note.
  const question = confirmQuestions().find(([name]) => name === "confirm-storage")?.[1] ?? confirmQuestions()[0][1];
  const answered = confirmSlip.ask(note, question);
  await wait(900);
  const slip = confirmSlip.snapshotWindow;
  if (!slip) { report("question", ["no question window"]); return problems; }
  // Pointer events as the page gets them, at the window's own place on the (off-screen) desktop: input sent to a window
  // that isn't key would make the system bring it onto a display first.
  const dragOn = async (selector: string, dx: number, dy: number) => {
    const { x, y } = slip.getBounds();
    const found = await slip.webContents.executeJavaScript(`(() => {
      const target = document.querySelector(${JSON.stringify(selector)});
      if (!target) return false;
      const r = target.getBoundingClientRect(), cx = r.left + Math.min(12, r.width / 2), cy = r.top + r.height / 2;
      const at = (type, mx, my) => new PointerEvent(type, { bubbles: true, button: 0, buttons: 1, pointerId: 9, clientX: cx + mx, clientY: cy + my, screenX: ${x} + cx + mx, screenY: ${y} + cy + my });
      target.dispatchEvent(at("pointerdown", 0, 0));
      window.dispatchEvent(at("pointermove", ${dx}, ${dy}));
      return true;
    })()`) as boolean;
    await wait(250);
    await slip.webContents.executeJavaScript(`window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 9 })); 0`);
    await wait(150);
    return found;
  };
  const before = slip.getBounds();
  const wrong: string[] = [];
  if (!await dragOn(".sbtn.primary", 40, 30)) wrong.push("no button on the slip");
  const still = slip.getBounds();
  if (still.x !== before.x || still.y !== before.y) wrong.push(`a drag from the button moved it (${still.x - before.x}, ${still.y - before.y})`);
  if (!await dragOn(".slip-heading", 30, 20)) wrong.push("no title on the slip");
  const moved = slip.getBounds();
  if (moved.x - before.x !== 30 || moved.y - before.y !== 20) wrong.push(`the title row's drag moved it by (${moved.x - before.x}, ${moved.y - before.y}), not (30, 20)`);
  report("question drag", wrong);
  await save("slips/question-moved", confirmSlip.capture());
  // Held: the note's handlers count what reaches them.
  await note.webContents.executeJavaScript(`window.__reached = 0; for (const type of ["pointerdown", "mousedown", "click", "contextmenu"]) document.addEventListener(type, () => { window.__reached += 1; }, true); 0`);
  const held: string[] = [];
  await press(note.webContents, 200, 300);
  await press(note.webContents, 200, 300, { x: 200, y: 300 }, "right");
  const reached = await note.webContents.executeJavaScript("window.__reached") as number;
  const shown = await slip.webContents.executeJavaScript(`document.getElementById("stage").dataset.nudges ?? "0"`) as string;
  if (reached !== 0) held.push(`the note's handlers heard ${reached} events`);
  if (confirmSlip.nudges !== 2) held.push(`${confirmSlip.nudges} nudges for 2 presses`);
  if (shown !== "2") held.push(`the question shook ${shown} times`);
  report("held presses", held);
  // Answered (Esc): the note works again.
  await slip.webContents.executeJavaScript(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); 0`);
  const answer = await Promise.race([answered, wait(1500).then(() => -1)]);
  await press(note.webContents, 200, 300);
  const after = await note.webContents.executeJavaScript("window.__reached") as number;
  report("answered", [...(answer === question.cancelId ? [] : [`answer ${String(answer)}`]), ...(after > 0 ? [] : ["the note still held up"])]);

  // The times slip in 설정 → 스페이스.
  const ids = { work: "s-m1a2b3", home: "s-m4c5d6", study: "s-m7e8f9" };
  store.changeSpaces((data) => addSpace(addSpace(addSpace(data, t("회사"), ids.work, "pink"), t("집"), ids.home, "mint"), t("공부"), ids.study, "sky"));
  await showDeskPane("spaces", wait);
  await wait(300);
  const open = async (id: string) => {
    await inPane("settings", `document.querySelector('.space-row[data-id="${id}"] .space-device').click()`);
    await wait(200);
    await inPane("settings", `(() => { const rows = [...document.querySelectorAll(".menu .mi")]; rows[rows.length - 1]?.click(); })()`);
    await wait(350);
  };
  const count = () => inPane("settings", `document.querySelectorAll(".device-slip").length`) as Promise<number>;
  const times: string[] = [];
  await open(ids.work);
  await open(ids.work);
  if (await count() !== 1) times.push(`asked twice for the first space: ${await count()} slips`);
  await open(ids.home);
  if (await count() !== 2) times.push(`two spaces: ${await count()} slips`);
  if (await inPane("settings", `document.querySelectorAll(".device-scrim").length`) !== 0) times.push("a scrim holds the pane up");
  // Dragged by its title row (pointer events as the page gets them), the second slip goes 40 left and 30 down.
  const dragged = await inPane("settings", `(() => {
    const slips = document.querySelectorAll(".device-slip"), slip = slips[slips.length - 1], head = slip.querySelector(".slip-heading");
    const from = slip.getBoundingClientRect(), r = head.getBoundingClientRect(), x = r.left + 10, y = r.top + r.height / 2;
    const at = (type, dx, dy) => new PointerEvent(type, { bubbles: true, button: 0, buttons: 1, pointerId: 7, clientX: x + dx, clientY: y + dy, screenX: x + dx, screenY: y + dy });
    head.dispatchEvent(at("pointerdown", 0, 0));
    window.dispatchEvent(at("pointermove", -40, 30));
    window.dispatchEvent(at("pointerup", -40, 30));
    const to = slip.getBoundingClientRect();
    return [Math.round(to.left - from.left), Math.round(to.top - from.top)];
  })()`) as [number, number];
  if (!Array.isArray(dragged) || dragged[0] !== -40 || dragged[1] !== 30) times.push(`the drag moved it by ${JSON.stringify(dragged)}, not [-40, 30]`);
  // The pane works beside the slips: the third space's popup opens.
  await inPane("settings", `document.querySelector('.space-row[data-id="${ids.study}"] .space-device').click()`);
  await wait(200);
  if (await inPane("settings", `document.querySelectorAll(".menu .mi").length`) === 0) times.push("the third space's popup didn't open beside the slips");
  await inPane("settings", `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await wait(150);
  await save("slips/times-two", captureDesk(wait));
  // Esc closes the slip with the focus only.
  await inPane("settings", `document.querySelector(".device-slip .device-presets .chip")?.focus(); document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
  await wait(150);
  if (await count() !== 1) times.push(`Esc in one slip left ${await count()}`);
  await inPane("settings", `document.querySelector(".device-slip .slip-x")?.click()`);
  await wait(150);
  if (await count() !== 0) times.push(`× left ${await count()} slips`);
  report("times slips", times);

  // #246: 빠른 입력 and 빠른 메모 move by their title row (not by their field), keeping what is typed and the caret.
  for (const [name, show, owner, typed] of [
    ["quick entry", () => quick.showForSnapshot(t("내일 3시 회의")), () => quick.snapshotWindow, "textarea.typed"],
    ["quick memo", () => quickMemo.showForSnapshot(t("장보기")), () => quickMemo.snapshotWindow, "textarea.ruled"],
  ] as const) {
    await show();
    await wait(900);
    const window = owner();
    const kept: string[] = [];
    if (!window) { report(`${name} drag`, ["no window"]); continue; }
    await window.webContents.executeJavaScript(`(() => { const f = document.querySelector(${JSON.stringify(typed)}); f.focus(); f.setSelectionRange(2, 2); return 0; })()`);
    const drag = async (selector: string, dx: number, dy: number) => {
      const { x, y } = window.getBounds();
      const found = await window.webContents.executeJavaScript(`(() => {
        const target = document.querySelector(${JSON.stringify(selector)});
        if (!target) return false;
        const r = target.getBoundingClientRect(), cx = r.left + Math.min(12, r.width / 2), cy = r.top + r.height / 2;
        const at = (type, mx, my) => new PointerEvent(type, { bubbles: true, button: 0, buttons: 1, pointerId: 11, clientX: cx + mx, clientY: cy + my, screenX: ${x} + cx + mx, screenY: ${y} + cy + my });
        target.dispatchEvent(at("pointerdown", 0, 0));
        window.dispatchEvent(at("pointermove", ${dx}, ${dy}));
        return true;
      })()`) as boolean;
      await wait(250);
      await window.webContents.executeJavaScript(`window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, pointerId: 11 })); 0`);
      await wait(150);
      return found;
    };
    const before = window.getBounds();
    if (!await drag(typed, 40, 30)) kept.push("no field");
    const still = window.getBounds();
    if (still.x !== before.x || still.y !== before.y) kept.push(`a drag from the field moved it (${still.x - before.x}, ${still.y - before.y})`);
    if (!await drag(".slip-heading", 30, 20)) kept.push("no title row");
    const moved = window.getBounds();
    if (moved.x - before.x !== 30 || moved.y - before.y !== 20) kept.push(`the title row's drag moved it by (${moved.x - before.x}, ${moved.y - before.y}), not (30, 20)`);
    const field = await window.webContents.executeJavaScript(`(() => { const f = document.querySelector(${JSON.stringify(typed)}); return [f.value, document.activeElement === f, f.selectionStart]; })()`) as [string, boolean, number];
    if (!field[1] || field[2] !== 2) kept.push(`after the drag the field ${field[1] ? "" : "lost the focus "}has its caret at ${field[2]}, not 2`);
    if (!field[0]) kept.push("what was typed is gone");
    report(`${name} drag`, kept);
    if (name === "quick entry") quick.hide(); else quickMemo.hide();
  }
  return problems;
}

/**
 * 달력의 알림 할 일 (#227): to-dos with a reminder over the month (three today, one due the same day as its reminder, one
 * finished) — a bell and the title in the cells after the events and deadlines, "+N" when they don't fit, their time in
 * the week. Checks that no cell spills and no title is cut without its ellipsis.
 */
/**
 * 바탕화면 달력 위젯 (#234): each kind over a sample wallpaper (day: light and busy; night: dark and busy) at 100 % and
 * 40 %, one hovered, the day sheet with a line typed in, and 책상 → 일정 with the gallery and a widget's settings slip.
 * The widgets' windows are never shown (they paint hidden). Each shot is checked for cut text and for a Korean word
 * broken across lines.
 */
async function widgetShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  fs.mkdirSync(path.join(directory, "widgets", "night"), { recursive: true });
  calendar.showSample();
  // calendar-flows: in October 2026, a three-day trip (Sun–Tue), a weekend one across two week rows (Fri–Sun) and a long
  // title in a cell with room — the bands joining and a title on two lines (sample data only).
  const flowStamp = new Date().toISOString();
  const flowEvent = (id: string, title: string, date: string, allDay: boolean, days: number, color: EventColor): LocalEvent => ({
    id, title, date, allDay, days, start: allDay ? 540 : 600, end: allDay ? 600 : 660, repeat: "none", skip: [], color, createdAt: flowStamp, updatedAt: flowStamp,
  });
  store.replaceEvents([...store.events, flowEvent("FLOWS-0001", t("제주 여행"), "2026-10-18", true, 3, "sage"),
    flowEvent("FLOWS-0002", t("가을 캠핑"), "2026-10-30", true, 3, "yellow"), flowEvent("FLOWS-0003", t("치과 정기 검진 예약"), "2026-10-14", false, 1, "blue"),
    // #260: February 2027 (설날 and its 대체공휴일) with a band through two of its holidays — their names keep one line there.
    flowEvent("FLOWS-0004", t("할머니 댁"), "2027-02-08", true, 2, "purple")]);
  const at = (days: number, hour: number, minute = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(hour, minute, 0, 0);
    return date;
  };
  const made: string[] = [];
  store.mutate((history) => {
    const add = (title: string, when: Date | undefined, due?: Date) => {
      const item = history.addTo(title, undefined, new Date(), due ? dateKey(due) : undefined, when?.toISOString());
      if (item) made.push(item.id);
    };
    add(t("치과 예약"), at(0, 23, 30));
    add(t("장보기"), undefined, at(0, 12));
    add(t("도서관 책 반납"), at(1, 11));
    add(t("보고서 초안"), undefined, at(3, 12));
    add(t("팀 회의 자료 보내기"), undefined, at(5, 12));
  });
  const check = `(() => {
    const out = [];
    const inner = document.querySelector(".wg .in");
    if (inner && inner.scrollHeight > inner.clientHeight + 1) out.push("overflow " + (inner.scrollHeight - inner.clientHeight) + "px");
    // (+N's button is wider to click than it looks: its hit area isn't text.)
    for (const el of document.querySelectorAll(".tt, .t, .tm, .w, .n, .sh, .empty, .m")) {
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow !== "ellipsis" && el.clientWidth > 0) out.push("cut: " + el.textContent);
    }
    // #295: nothing in a month tile's head is cut (the lunar date, +N, #296 the repeat mark).
    for (const head of document.querySelectorAll(".cl .head")) if (head.scrollWidth > head.clientWidth + 1) out.push("head cut " + head.parentElement.dataset.day);
    // A Korean word split across two lines.
    const range = document.createRange();
    // (The today widget's month and weekday are two lines on purpose.)
    for (const el of document.querySelectorAll(".empty, .sh, .wtoast .tx, .hd .t")) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let node; let lastTop; let prev = "";
      while ((node = walker.nextNode())) for (let i = 0; i < node.length; i++) {
        range.setStart(node, i); range.setEnd(node, i + 1); const rect = range.getClientRects()[0]; const ch = node.data[i];
        if (!rect || !rect.width || /\s/.test(ch)) { prev = ch; continue; }
        const top = Math.round(rect.top);
        if (lastTop !== undefined && Math.abs(top - lastTop) > 4 && /[\\uac00-\\ud7a3]/.test(prev) && /[\\uac00-\\ud7a3]/.test(ch)) out.push("split: " + el.textContent);
        lastTop = top; prev = ch;
      }
    }
    return out.length ? out.join("; ") : "ok · " + document.querySelectorAll(".ln, .cl, .c, .r").length + " cells";
  })()`;
  const kinds: { kind: WidgetKind; style: WidgetStyle }[] = [
    { kind: "today", style: "simple" }, { kind: "week", style: "simple" }, { kind: "week", style: "detail" },
    { kind: "month", style: "simple" }, { kind: "month", style: "detail" }, { kind: "month", style: "wall" }, { kind: "agenda", style: "simple" },
  ];
  // #234: the week and the month on October 2026 (개천절, its 대체공휴일 and 한글날, and the lunar dates), whatever today is.
  const holidayDay = "2026-10-05";
  const pageTo = (kind: WidgetKind) => {
    const now = new Date();
    if (kind === "month") return (2026 * 12 + 9) - (now.getFullYear() * 12 + now.getMonth());
    if (kind !== "week") return 0;
    const weekStart = (key: string) => localDate(weekDays(key, lang())[0])?.getTime() ?? 0;
    return Math.round((weekStart(holidayDay) - weekStart(dateKey(now))) / (7 * 86_400_000));
  };
  let offsetNow = 0;
  const shot = async (name: string, wall: string, hover = false) => {
    for (let tries = 0; tries < 50 && !widgets.isReady("snap"); tries += 1) await wait(100);
    const window = widgets.preview("snap", { wall, hover, offset: offsetNow });
    if (!window) { console.log(`widgets ${name}: NO WINDOW`); problems += 1; return; }
    await wait(450);
    const found = String(await window.webContents.executeJavaScript(check).catch((error: Error) => `script failed: ${error.message}`));
    console.log(`widgets ${name}: ${found}`);
    if (!found.startsWith("ok")) problems += 1;
    await save(`widgets/${name}`, window.webContents.capturePage());
  };
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "night/" : "";
    store.setPref("paper", paper);
    for (const { kind, style } of kinds) {
      for (const opacity of [100, 40]) {
        store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind, style, opacity, place: { display: "0", x: 1, y: 0 } })]);
        widgets.sync();
        offsetNow = pageTo(kind);
        for (const wall of paper === "day" ? ["light", "busy"] : ["dark", "busy"]) {
          if (opacity === 100 && wall === "busy") continue;
          await shot(`${prefix}${kind}-${style}-${opacity}-${wall}`, wall);
        }
      }
    }
    // 크기 (#271): every kind at 작게 · 크게 · 아주 크게 (보통 is above) — the same lines in each cell, nothing cut — and the
    // month at 아주 크게 and 40 % over the busy wallpaper (the floors hold at any size).
    for (const [scale, word] of [[0.85, "small"], [1.25, "large"], [1.5, "xlarge"]] as const) {
      for (const { kind, style } of kinds) {
        store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind, style, scale, place: { display: "0", x: 1, y: 0 } })]);
        widgets.sync();
        offsetNow = pageTo(kind);
        await shot(`${prefix}${kind}-${style}-size-${word}`, paper === "day" ? "light" : "dark");
      }
    }
    // #296: this month with two daily repeats and a weekday one — folded into each tile's head, no dot in 간단히; #295: today
    // busy (+N beside its lunar date).
    const itemsBefore = new Set(store.items.map((item) => item.id));
    const crowd = [
      store.saveSeries({ title: t("물 마시기"), rule: { kind: "daily" } }),
      store.saveSeries({ title: t("스트레칭"), rule: { kind: "daily" } }),
      store.saveSeries({ title: t("아침 운동"), rule: { kind: "weekdays" }, remindAt: "07:30" }),
    ].filter((id): id is string => Boolean(id));
    store.mutate((history) => {
      for (const [title, hour] of [[t("빨래 개기"), 20], [t("화분 물 주기"), 21], [t("엄마한테 전화하기"), 22]] as const) history.addTo(title, undefined, new Date(), undefined, at(0, hour).toISOString());
    });
    for (const style of ["simple", "detail", "wall"] as const) {
      for (const scale of style === "detail" ? [1, 0.85] : [1]) {
        store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind: "month", style, scale, place: { display: "0", x: 1, y: 0 } })]);
        widgets.sync();
        offsetNow = 0;
        await shot(`${prefix}month-${style}-repeats${scale === 1 ? "" : "-small"}`, paper === "day" ? "light" : "dark");
      }
    }
    for (const id of crowd) store.deleteSeries(id);
    // The busy day's to-dos and today's copies.
    const added = store.items.filter((item) => !itemsBefore.has(item.id)).map((item) => item.id);
    store.mutate((history) => { for (const id of added) history.delete(id); });
    store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind: "month", style: "detail", opacity: 40, scale: 1.5, place: { display: "0", x: 1, y: 0 } })]);
    widgets.sync();
    offsetNow = pageTo("month");
    await shot(`${prefix}month-detail-size-xlarge-40-busy`, "busy");
    // Hovered: solid, with ‹ 오늘 ›.
    store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind: "month", style: "detail", opacity: 40, place: { display: "0", x: 1, y: 0 } })]);
    widgets.sync();
    offsetNow = pageTo("month");
    await shot(`${prefix}month-detail-40-hover`, "busy", true);
    offsetNow = 0;
    // The day sheet beside it, a line typed in (read on that day).
    const sheet = await widgetSheet.showForSnapshot("snap", dateKey(at(2, 12)), t("3시 팀 회의"));
    await wait(700);
    await save(`widgets/${prefix}sheet`, sheet.webContents.capturePage());
    const busy = await widgetSheet.showForSnapshot("snap", dateKey(new Date()), "");
    await wait(500);
    await save(`widgets/${prefix}sheet-today`, busy.webContents.capturePage());
    // 책상 → 일정: the widgets' rows, then the gallery and a widget's settings slip.
    store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind: "month", style: "simple", place: { display: "0", x: 1, y: 0 } }), makeWidget({ id: "snap2", kind: "today", style: "simple", opacity: 70, clickThrough: true, place: { display: "0", x: 1, y: 1 } })]);
    widgets.sync();
    await showDeskPane("events", wait);
    await wait(500);
    await save(`widgets/${prefix}desk`, captureDesk(wait));
    await inPane("settings", `[...document.querySelectorAll(".action.small")].find((button) => button.querySelector(".icon") && button.closest(".group"))?.click()`);
    await wait(500);
    await save(`widgets/${prefix}gallery`, captureDesk(wait));
    await inPane("settings", `document.querySelector(".device-scrim")?.click()`);
    await wait(300);
    await inPane("settings", `document.querySelector(".widget-row .action.small")?.click()`);
    await wait(500);
    await save(`widgets/${prefix}settings`, captureDesk(wait));
    await inPane("settings", `document.querySelector(".device-scrim")?.click()`);
    await wait(300);
    // #271: 벽 달력 on a 1280×800 display — 크게 · 아주 크게 don't fit there and are greyed out.
    store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind: "month", style: "wall", place: { display: "0", x: 1, y: 0 } })]);
    widgets.sync();
    store.widgetFits = { snap: widgetScales.filter((scale) => scaleFits("month", "wall", scale, { x: 0, y: 0, width: 1280, height: 752 })) };
    store.changed();
    await wait(500);
    await inPane("settings", `document.querySelector(".widget-row .action.small")?.click()`);
    await wait(500);
    await save(`widgets/${prefix}settings-small-screen`, captureDesk(wait));
    await inPane("settings", `document.querySelector(".device-scrim")?.click()`);
    await wait(300);
    // The desk's 달력 on October 2026: holidays and lunar dates in the month and in the week.
    await showDeskPane("calendar", wait);
    desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
    openCalendar(holidayDay);
    await inPane("calendar", `document.querySelectorAll(".view-seg button")[1]?.click()`);
    await wait(500);
    await save(`widgets/${prefix}desk-calendar-month`, captureDesk(wait));
    // #260: February 2027 — 설날's three days and its 대체공휴일 (the long names on two lines where a cell has room).
    openCalendar("2027-02-08");
    await wait(500);
    await save(`widgets/${prefix}desk-calendar-seollal`, captureDesk(wait));
    openCalendar(holidayDay);
    await wait(300);
    await inPane("calendar", `document.querySelector(".view-seg button")?.click()`);
    await wait(500);
    await save(`widgets/${prefix}desk-calendar-week`, captureDesk(wait));
    await inPane("calendar", `document.querySelectorAll(".view-seg button")[1]?.click()`);
    // calendar-flows: a holiday's day sheet (its name first), and an event pressed on a widget — the desk's calendar on
    // its day with its sheet open (D3).
    const holidaySheet = await widgetSheet.showForSnapshot("snap", "2026-10-09", "");
    await wait(500);
    await save(`widgets/${prefix}sheet-holiday`, holidaySheet.webContents.capturePage());
    widgetSheet.hide();
    openCalendar("2026-10-18", "local/FLOWS-0001@2026-10-18");
    await wait(700);
    const opened = String(await inPane("calendar", `(() => { const sheet = document.querySelector(".event-sheet"); const field = sheet?.querySelector("input, textarea, [contenteditable]"); return sheet ? "sheet " + (field?.value ?? field?.textContent ?? "") + " · " + (document.querySelector(".cell.selected")?.dataset.day ?? "none") : "NO SHEET"; })()`));
    console.log(`widgets ${prefix}event-pressed: ${opened}`);
    if (!opened.startsWith("sheet")) problems += 1;
    await save(`widgets/${prefix}desk-calendar-event`, captureDesk(wait));
    await inPane("calendar", `document.querySelector(".event-sheet")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`);
    await wait(300);
  }
  problems += await widgetAskShots(save, wait);
  store.setPref("calendarWidgets", []);
  widgets.sync();
  store.mutate((history) => { for (const id of made) history.delete(id); });
  store.setPref("paper", "day");
  return problems;
}

/**
 * #253 (docs/plans/widget-ask-cases.json), off-screen, the widget kept on top: what is being typed in the memo drawer, the
 * quick entry and the quick memo keeps its text and caret while the widget is pressed (T1–T3). While a question waits,
 * the widget turns its months and the day sheet its days (W1 · W4), the sheet puts in and the toast takes back (W5 · W6),
 * a window coming forward under the question doesn't nudge it (O1), and the question floats over the widget (Z1). The
 * questions are asked over no window (see below). While a question that replaces the whole list waits, 넣기 dims and says why, and
 * Enter in the sheet and the toast's 되돌리기 nudge the question instead (L5 · L6), the text kept. Prints
 * `widgets asked <check>: ok` or what went wrong, and saves the waiting sheet.
 */
async function widgetAskShots(save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  const report = (name: string, wrong: string[]) => {
    console.log(`widgets asked ${name}: ${wrong.length ? wrong.join("; ") : "ok"}`);
    problems += wrong.length;
  };
  const run = (window: BrowserWindow | undefined, script: string) => (window ? window.webContents.executeJavaScript(script).catch((error: Error) => `script failed: ${error.message}`) : Promise.resolve("no window"));
  store.setPref("calendarWidgets", [makeWidget({ id: "snap", kind: "month", style: "simple", level: "top", place: { display: "0", x: 1, y: 0 } })]);
  widgets.sync();
  for (let tries = 0; tries < 50 && !widgets.isReady("snap"); tries += 1) await wait(100);
  const widget = widgets.windowOf("snap");
  if (!widget) { report("widget", ["no widget window"]); return problems; }
  await wait(400);
  const title = () => run(widget, `document.querySelector(".hd .t")?.textContent ?? ""`) as Promise<string>;
  const nextMonth = () => run(widget, `[...document.querySelectorAll(".nav button")].at(-1)?.click(); 0`);
  const backToday = () => run(widget, `document.querySelector(".nav .td")?.click(); 0`);

  // T1–T3: a line typed with the caret inside it; the widget pressed; the text and the caret where they were.
  const typing: string[] = [];
  await quick.showForSnapshot("");
  await quickMemo.showForSnapshot("");
  const drawerWindow = await drawer.showForSnapshot();
  await wait(500);
  const fields: [string, BrowserWindow | undefined, string][] = [
    ["drawer", drawerWindow, `document.querySelector("textarea[aria-label]")`],
    ["quick", quick.snapshotWindow, `document.querySelector("textarea.typed")`],
    ["quickMemo", quickMemo.snapshotWindow, `document.querySelector("textarea.ruled")`],
  ];
  for (const [name, window, field] of fields) {
    const typed = await run(window, `(() => { const f = ${field}; if (!f) return "no field"; f.focus(); f.value = ${JSON.stringify(t("겨울옷 정리하기"))}; f.setSelectionRange(3, 3); return "ok"; })()`);
    if (typed !== "ok") typing.push(`${name}: ${String(typed)}`);
  }
  const before = await title();
  await nextMonth();
  await wait(200);
  if (await title() === before) typing.push("the widget didn't turn its month");
  await backToday();
  for (const [name, window, field] of fields) {
    const kept = await run(window, `(() => { const f = ${field}; return f && f.value === ${JSON.stringify(t("겨울옷 정리하기"))} && f.selectionStart === 3 && f.selectionEnd === 3 && document.activeElement === f ? "ok" : "moved"; })()`);
    if (kept !== "ok") typing.push(`${name}: the text or the caret ${String(kept)}`);
  }
  await run(drawerWindow, `(() => { const f = document.querySelector("textarea[aria-label]"); if (f) { f.value = ""; f.blur(); } return 0; })()`);
  quick.hide();
  quickMemo.hide();
  drawer.hideForSnapshot();
  report("typing", typing);

  // A question (집중을 그만둘까요?) over the note: the widget and the sheet work.
  const plain: ConfirmQuestion = { icon: "timer", title: t("집중"), message: t("집중을 그만둘까요?"), buttons: [{ label: t("계속하기"), kind: "ghost" }, { label: t("그만두기"), kind: "primary" }], cancelId: 0 };
  const answer = async (asked: Promise<number>) => {
    await run(confirmSlip.snapshotWindow, `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); 0`);
    await Promise.race([asked, wait(1500)]);
    await wait(200);
  };
  const day = dateKey(new Date(Date.now() + 2 * 86_400_000));
  const titled = (text: string) => store.items.find((item) => item.title === text);
  const flower = t("택배 받기"), post = t("운동 가기");
  const put = async (sheet: BrowserWindow, text: string) => {
    await run(sheet, `(() => { const f = document.querySelector("textarea.typed"); f.value = ${JSON.stringify(text)}; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })); return 0; })()`);
    await wait(500);
  };
  const toastUndo = () => run(widget, `(() => { const b = document.querySelector(".wtoast button"); if (!b) return "no toast"; b.click(); return "ok"; })()`);
  const works: string[] = [];
  // Asked over no window: an off-screen run's windows have no owner on a Mac (offscreenGuard.ts, #250), so there is no
  // window it was asked over to check, and the widget's rules don't need one (O2 is the shared cases').
  let asked = confirmSlip.ask(undefined, plain);
  await wait(900);
  if (confirmSlip.up !== "question") works.push(`up: ${confirmSlip.up}`);
  if (!confirmSlip.floating) works.push("the question isn't over the widget kept on top");
  const shown = await title();
  await nextMonth();
  await wait(200);
  if (await title() === shown) works.push("‹ › held up");
  await backToday();
  let sheet = await widgetSheet.showForSnapshot("snap", day, "");
  await wait(400);
  const sheetTitle = () => run(sheet, `document.querySelector(".slip-title")?.textContent ?? ""`) as Promise<string>;
  const dayShown = await sheetTitle();
  await run(sheet, `document.querySelectorAll(".day-nav button")[1]?.click(); 0`);
  await wait(200);
  if (await sheetTitle() === dayShown) works.push("the sheet's next day held up");
  await run(sheet, `document.querySelectorAll(".day-nav button")[0]?.click(); 0`);
  await wait(200);
  await put(sheet, flower);
  if (!titled(flower)) works.push("put in held up");
  if (String(await toastUndo()) !== "ok") works.push("no toast after putting in");
  await wait(400);
  if (titled(flower)) works.push("taking back held up");
  // O1: a window coming forward under the question doesn't nudge it (O2, the window it was asked over, is the shared
  // cases' — told directly: opening the note focuses it, and a focused window in an off-screen run is pulled onto a screen).
  const nudged = confirmSlip.nudges;
  await put(sheet, flower);
  confirmSlip.cameForward(note);
  await wait(300);
  if (confirmSlip.nudges !== nudged) works.push("a window coming forward nudged the question");
  if (confirmSlip.up !== "question" || !confirmSlip.floating) works.push("the question isn't over everything after another window came");
  await answer(asked);
  if (confirmSlip.floating) works.push("still floating after the answer");
  report("question", works);

  // A question that replaces the whole list (되돌리기): the sheet and the toast wait, the text stays.
  const waits: string[] = [];
  asked = confirmSlip.ask(undefined, sampleRestoreQuestion(false));
  await wait(700);
  if (confirmSlip.up !== "replacesList") waits.push(`up: ${confirmSlip.up}`);
  const before2 = confirmSlip.nudges;
  if (String(await toastUndo()) !== "ok") waits.push("the toast went before the check");
  await wait(300);
  if (!titled(flower)) waits.push("taking back went through");
  if (confirmSlip.nudges !== before2 + 1) waits.push(`taking back: ${confirmSlip.nudges - before2} nudges, not 1`);
  const turned = await title();
  await nextMonth();
  await wait(200);
  if (await title() === turned) waits.push("‹ › held up");
  await backToday();
  sheet = await widgetSheet.showForSnapshot("snap", day, "");
  await wait(400);
  const why = t("질문에 답하면 넣을 수 있어요");
  const dim = await run(sheet, `(() => { const k = document.querySelector(".keys .waiting"); const f = document.querySelector("textarea.typed"); return k && k.title === ${JSON.stringify(why)} && f.getAttribute("aria-description") === ${JSON.stringify(why)} ? "ok" : "not dimmed"; })()`);
  if (dim !== "ok") waits.push(`the put-in key ${String(dim)}`);
  await put(sheet, post);
  if (titled(post)) waits.push("put in went through");
  if (confirmSlip.nudges !== before2 + 2) waits.push(`Enter: ${confirmSlip.nudges - before2 - 1} nudges, not 1`);
  const kept = await run(sheet, `document.querySelector("textarea.typed")?.value ?? ""`);
  if (kept !== post) waits.push(`the text became “${String(kept)}”`);
  const shook = await run(confirmSlip.snapshotWindow, `document.getElementById("stage").dataset.nudges ?? "0"`);
  if (Number(shook) < 2) waits.push(`the question shook ${String(shook)} times`);
  await save("widgets/sheet-waiting", sheet.webContents.capturePage());
  await answer(asked);
  const free = await run(sheet, `document.querySelector(".keys .waiting") ? "dimmed" : "ok"`);
  if (free !== "ok") waits.push("the put-in key still dimmed after the answer");
  report("replaces the list", waits);
  await run(sheet, `(() => { const f = document.querySelector("textarea.typed"); f.value = ""; f.dispatchEvent(new Event("input", { bubbles: true })); return 0; })()`);
  store.mutate((history) => { for (const one of store.items.filter((entry) => entry.title === flower || entry.title === post)) history.delete(one.id); });
  return problems;
}

async function calendarReminderShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  fs.mkdirSync(path.join(directory, "reminders", "night"), { recursive: true });
  const at = (days: number, hour: number, minute = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + days);
    date.setHours(hour, minute, 0, 0);
    return date;
  };
  const made: string[] = [];
  store.mutate((history) => {
    const add = (title: string, when: Date, due = false, done = false) => {
      const item = history.addTo(title, undefined, new Date(), due ? dateKey(when) : undefined, when.toISOString());
      if (!item) return;
      made.push(item.id);
      if (done) history.toggle(item.id);
    };
    add(t("치과 예약"), at(0, 15));
    add(t("엄마한테 전화하기"), at(0, 19, 30));
    add(t("약 먹기"), at(0, 21));
    add(t("택배 받기"), at(1, 10));
    add(t("보고서 보내기"), at(3, 9, 30), true);
    add(t("운동 가기"), at(3, 18));
    add(t("도서관 책 반납"), at(-2, 11));
    add(t("빨래 개기"), at(4, 8), false, true);
  });
  const check = `(() => {
    const out = [];
    for (const cell of document.querySelectorAll(".cell, .day-row")) if (cell.scrollHeight > cell.clientHeight + 1) out.push("overflow " + cell.dataset.day);
    for (const t of document.querySelectorAll(".item .t, .line .t")) if (t.scrollWidth > t.clientWidth + 1 && getComputedStyle(t).textOverflow !== "ellipsis") out.push("cut: " + t.textContent);
    // #295: nothing in a cell's head is cut (the lunar date, +N, #296 the repeat mark).
    for (const head of document.querySelectorAll(".cell-head")) if (head.scrollWidth > head.clientWidth + 1) out.push("head cut " + head.parentElement.dataset.day);
    const bells = document.querySelectorAll(".item.reminder, .dot.reminder, .line.task.reminder").length;
    // #295 · #296: today's head (the lunar date, +N), the cells' repeat marks and the repeat lines still written.
    const today = document.querySelector(".cell.today .cell-head");
    const head = today ? [...today.children].filter((el) => !el.hidden).map((el) => el.textContent).join(" ") : "";
    return (out.length ? out.join("; ") : "ok · " + bells + " reminders") + " · today [" + head + "] · " + document.querySelectorAll(".rmark:not([hidden])").length + " marks · " + document.querySelectorAll(".item.repeat").length + " repeat lines";
  })()`;
  const shot = async (name: string) => {
    await wait(400);
    await inPane("calendar", settledScript);
    const found = String(await inPane("calendar", check));
    console.log(`reminders ${name}: ${found}`);
    if (!found.startsWith("ok")) problems += 1;
    await save(`reminders/${name}`, captureDesk(wait));
  };
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "night/" : "";
    store.setPref("paper", paper);
    await showDeskPane("calendar", wait);
    desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
    openCalendar(dateKey(new Date()));
    await inPane("calendar", `document.querySelectorAll(".view-seg button")[1]?.click()`);
    await shot(`${prefix}month`);
    await inPane("calendar", `document.querySelector(".view-seg button")?.click()`);
    await shot(`${prefix}week`);
    await inPane("calendar", `document.querySelectorAll(".view-seg button")[1]?.click()`);
    // The smallest desk: shorter cells, so "+N" sooner.
    desk.browserWindow!.setContentSize(760, 520 + deskTitleBar);
    await shot(`${prefix}month-small`);
    desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
    // #296: two more daily repeats and a weekday one (with 물 마시기) — folded into each day's head; the events keep the lines.
    const itemsBefore = new Set(store.items.map((item) => item.id));
    const crowd = [
      store.saveSeries({ title: t("스트레칭"), rule: { kind: "daily" } }),
      store.saveSeries({ title: t("아침 운동"), rule: { kind: "weekdays" }, remindAt: "07:30" }),
    ].filter((id): id is string => Boolean(id));
    await shot(`${prefix}month-repeats`);
    desk.browserWindow!.setContentSize(760, 520 + deskTitleBar);
    await shot(`${prefix}month-repeats-small`);
    desk.browserWindow!.setContentSize(1280, 820 + deskTitleBar);
    await shot(`${prefix}month-repeats-wide`);
    desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
    for (const id of crowd) store.deleteSeries(id);
    // (Today's copies too.)
    const copies = store.items.filter((item) => !itemsBefore.has(item.id)).map((item) => item.id);
    store.mutate((history) => { for (const id of copies) history.delete(id); });
  }
  store.mutate((history) => { for (const id of made) history.delete(id); });
  store.setPref("paper", "day");
  return problems;
}

async function drawerShots(directory: string, save: Save, wait: Wait): Promise<number> {
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

/** The run's exit code says whether the size sweep found layout problems. */
/**
 * #85 · #86, day and night, into snapshots/shortcuts/: the shortcut list (the keys as they start; a note key of one's
 * own with the drawer's off; scrolling on a short screen), and 설정 › 꾸미기 › 빠른 입력 with the note's key row (at rest,
 * a refused key while listening, a key of one's own with ‘기본값’, off). Each with a layout check.
 */
async function shortcutShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  fs.mkdirSync(path.join(directory, "shortcuts"), { recursive: true });  const listCheck = `(() => {
    const out = [];
    const cut = (el) => el.scrollWidth > el.clientWidth + 1;
    for (const el of document.querySelectorAll(".keys-name, .keys-title, .keys-off, .keycap, .slip-title, .sbtn")) if (cut(el)) out.push("cut: " + el.textContent);
    for (const row of document.querySelectorAll(".keys-row")) { const caps = row.querySelector(".keys-caps, .keys-off"); if (caps && caps.getBoundingClientRect().right > row.getBoundingClientRect().right + 0.5) out.push("caps outside: " + row.textContent); }
    const card = document.querySelector("#card").getBoundingClientRect();
    if (card.width < 600) out.push("slip narrow: " + card.width);
    return out;
  })()`;
  const list = async (name: string, css?: string) => {
    await confirmSlip.showForSnapshot(shortcutQuestion());
    const window = confirmSlip.snapshotWindow!;
    const inserted = css ? await window.webContents.insertCSS(css) : undefined;
    await wait(800);
    const found = await window.webContents.executeJavaScript(listCheck).catch((error: Error) => [`check failed: ${error.message}`]) as string[];
    console.log(`shortcuts ${name}: ${found.length ? found.join("; ") : "ok"}`);
    problems += found.length;
    await save(`shortcuts/${name}`, confirmSlip.capture());
    if (inserted) await window.webContents.removeInsertedCSS(inserted);
  };
  const pane = async (name: string, script?: string) => {
    await showDeskPane("appearance", wait);
    await inPane("settings", `document.querySelector(".note-key")?.scrollIntoView({ block: "center" })`);
    if (script) await inPane("settings", script);
    await wait(400);
    const report = await inPane("settings", layoutCheckScript(settingsPaneChecks)) as LayoutReport | string | undefined;
    const found = typeof report === "object" && report ? report.problems : [`check failed: ${String(report)}`];
    console.log(`shortcuts ${name}: ${found.length ? found.join("; ") : "ok"}`);
    problems += found.length;
    await save(`shortcuts/${name}`, captureDesk(wait));
  };
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    const tag = paper === "night" ? "-night" : "";
    store.setPref("noteHotkey", true);
    store.setPref("noteShortcut", "Control+Alt+J");
    store.setPref("drawerShortcut", "Control+Shift+D");
    await list(`shortcut-list${tag}`);
    // A short screen: the groups scroll.
    await list(`shortcut-list-scroll${tag}`, ".keys-cols { max-height: 300px !important; }");
    store.setPref("noteShortcut", "Control+Alt+K");
    store.setPref("drawerShortcut", "");
    await list(`shortcut-list-custom${tag}`);
    confirmSlip.hide();
    store.setPref("noteShortcut", "Control+Alt+J");
    store.setPref("drawerShortcut", "Control+Shift+D");
    await pane(`shortcut-settings${tag}`);
    // Listening, then Ctrl+Shift+D (the drawer's): refused, said in the group's foot.
    await pane(`shortcut-settings-refused${tag}`, `document.querySelector(".note-key .keyfield").click();
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "D", code: "KeyD", ctrlKey: true, shiftKey: true, bubbles: true }))`);
    await inPane("settings", `window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }))`);
    store.setPref("noteShortcut", "Control+Alt+K");
    await pane(`shortcut-settings-custom${tag}`);
    // The narrowest pane: the desk just wide enough to keep its sidebar's names (deskSize.foldBelow).
    desk.browserWindow!.setContentSize(820, 640 + deskTitleBar);
    await pane(`shortcut-settings-custom-narrow${tag}`);
    desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
    store.setPref("noteHotkey", false);
    await pane(`shortcut-settings-off${tag}`);
    store.setPref("noteHotkey", true);
    store.setPref("noteShortcut", "Control+Alt+J");
  }
  store.setPref("paper", "day");
  return problems;
}

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
      for (const command of ["page-today", "page-ahead"]) {
        note.webContents.send("note:row-command", { id: "", command });
        await wait(160);
        // A missing element is a problem on the list, not a thrown script that stops the run (#178).
        const report = await note.webContents.executeJavaScript(`(() => { try {
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
          // #151: the cat left the header for the ears on the window's top edge (#178: this line still measured it).
          if (document.querySelector(".peek")) out.push("a cat in the header");
          if (r(document.querySelector(".title-text")).right > r(document.querySelector(".title-row")).right + 0.5) out.push("title runs out of its row");
          return out.join("; ");
        } catch (error) { return "check failed: " + error.message; } })()`);
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
  inside: [".tabs-row", ".tools button", ".index-tab", ".title-row", ".footer", ".footer > *", ".editor", ".event-sheet", ".event-sheet .tape", ".editor .actions .action", ".dock", ".inp", ".strip-top", ".strip-barline", ".strip-lead", ".tt-scroll", ".sheet-pop", ".slip-foot .sbtn",
    ".focus-card", ".fc-top", ".fc-close", ".fc-ring", ".fc-btn", ".fc-foot", ".fc-cat", ".pick-bar", ".pick-cancel", ".focus-pick",
    ".search-slip", ".search-line", ".search-foot", ".row.preview-hover .actions", ".fc-play"],
  oneLine: [".fc-kicker", ".fc-next", ".fc-btn", ".fc-rest", ".fc-row-title", ".pick-text", ".pick-cancel", ".focus-pick", ".group-name", ".group-count", ".footer > *", ".tab-label", ".editor .actions .action", ".seg button", ".quick button:not(.two-line)", ".choice-title", ".choice-sub", ".move", ".due", ".time",
    ".carry", ".search-head", ".search-meta", ".search-foot .keys > span", ".slip-title",
    ".date-line", ".prog", ".group-head span", ".group-mark span", ".chip", ".sbtn", ".kbd", ".slip-title", ".sheet-toggle", ".range-length",
    ".strip-link", ".ad-pill", ".ad-more", ".tt-title", ".strip-hours span", ".lead-kicker", ".lead-sub", ".strip-nothing", ".rc-text b", ".rc-text small:not(.two)", ".sr-time", ".sr-away",
    ".tt-hour span", ".tb-time", ".tb-title", ".tt-more", ".ttn-when", ".ttn-chip", ".tml-time"],
  rows: [".tabs-row", ".tools", ".index-tabs", ".title-row", ".footer", ".lines > .row", ".editor .actions", ".quick", ".custom", ".alert-row", ".month-row", ".time-line", ".search-row", ".search-head", ".actions",
    ".inp-row", ".strip-top", ".strip-barline", ".strip-lead", ".lead-row", ".strip-row", ".ttn-foot", ".tt-more-list button", ".slip-head", ".slip-foot", ".sheet-row", ".sheet-line", ".prog", ".fc-top", ".fc-btns", ".fc-foot", ".fc-row", ".pick-bar", ".group-head", ".group-mark"],
  // The focus card's column never needs to scroll (only its list does).
  noScroll: [".fc-body"],
  placeholders: [".inp .typed"],
};

/**
 * #151: the note as it stands on a desktop with the cat's ears on its top edge — wide, narrow (350) and short (350 × 400),
 * one ear mid-twitch, and the ears alone on light and dark desktops — day and night, into snapshots/ears/. Each note
 * first checks its header: no cat left in it, the header as tall as before (78 px, 58 when short) and nothing cut.
 * The pictures are put together in a hidden window (ears.html#preview); nothing is shown.
 */
/**
 * 노트 위치 (#273): the pin as each place shows it (보통 · 항상 위에 두기 · 바탕화면에 두기) with its words for a screen
 * reader, and its menu open, at the usual and the smallest size, day and night. A cut label or a menu out of the note
 * counts as a problem.
 */
/**
 * 타닥냥 (#289 · #288): 책상 → 종이냥 scrolled to its section — in this app, off (자리 dimmed) with the pet hidden,
 * in all apps without a keyboard hook (the line saying so) — and
 * the cat in its corner (resting, the left paw down, the right paw down), in typing/ and typing/night/. Each pane is
 * checked for text cut short.
 */
async function typingShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  const cut = `(() => [...document.querySelectorAll(".group .row, .group .label, .group .foot")].filter((element) => [element, ...element.querySelectorAll("*")]
    .some((part) => part.clientWidth && part.scrollWidth > part.clientWidth + 1)).map((element) => element.textContent.trim().slice(0, 40)))()`;
  fs.mkdirSync(path.join(directory, "typing", "night"), { recursive: true });
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "typing/night/" : "typing/";
    store.setPref("paper", paper);
    // #288: 모든 앱에서 — off-screen there is no keyboard hook, so this draws the line that says the cat hears this app only.
    for (const [name, scope, petShown] of [["settings-pet-typing", "app", true], ["settings-pet-typing-off", "off", false],
      ["settings-pet-typing-everywhere-no-hook", "everywhere", true]] as const) {
      store.setPref("typingCat", scope);
      store.setPref("petVisible", petShown);
      await showDeskPane("pet", wait);
      await inPane("settings", `document.querySelector(".content").scrollTop = 1e6`);
      await wait(400);
      const found = await inPane("settings", cut) as string[] | undefined;
      console.log(`typing ${prefix}${name}: ${found?.length ? `cut: ${found.join(" · ")}` : "ok"}`);
      problems += found?.length ?? 0;
      await save(`${prefix}${name}`, captureDesk(wait));
    }
    store.setPref("typingCat", "app");
    store.setPref("petVisible", true);
    for (const pose of ["idle", "left", "right"] as const) await save(`${prefix}typing-cat-${pose}`, typingCat?.preview(pose));
    typingCat?.refresh();
  }
  store.setPref("paper", "day");
  return problems;
}

/**
 * 크기 (#304): 책상 → 종이냥 with each section's 크기 row (the pet's at the top, 타닥냥's scrolled to), then the pet sitting
 * and asking a question, and 타닥냥 resting and with a paw down, at each size — in catsize/ and catsize/night/. A cut
 * label, a cat or bubble out of its window, or a window off the floor counts as a problem. 보통 is drawn first and again
 * after the other sizes: the two must be the same picture.
 */
async function catSizeShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  const cut = `(() => [...document.querySelectorAll(".group .row, .group .label, .group .foot")].filter((element) => [element, ...element.querySelectorAll("*")]
    .some((part) => part.clientWidth && part.scrollWidth > part.clientWidth + 1)).map((element) => element.textContent.trim().slice(0, 40)))()`;
  fs.mkdirSync(path.join(directory, "catsize", "night"), { recursive: true });
  const report = (what: string, found: string[] | undefined) => {
    console.log(`catsize ${what}: ${found?.length ? found.join(" · ") : "ok"}`);
    problems += found?.length ?? 0;
  };
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "catsize/night/" : "catsize/";
    store.setPref("paper", paper);
    store.setPref("petVisible", true);
    store.setPref("typingCat", "app");
    store.setPref("petSize", "large");
    store.setPref("typingSize", "large");
    for (const [name, scroll] of [["settings-pet-size", "0"], ["settings-typing-size", "1e6"]] as const) {
      await showDeskPane("pet", wait);
      await inPane("settings", `document.querySelector(".content").scrollTop = ${scroll}`);
      await wait(400);
      report(`${prefix}${name}`, await inPane("settings", cut) as string[] | undefined);
      await save(`${prefix}${name}`, captureDesk(wait));
    }
    const sizes: CatSize[] = ["regular", ...catSizes.filter((step) => step !== "regular"), "regular"];
    for (const size of sizes) {
      const again = size === "regular" && store.prefs.petSize !== "large" ? "-again" : "";
      store.setPref("petSize", size);
      store.setPref("typingSize", size);
      pet?.quiet();
      await wait(3200); // the one breath after it settles
      report(`${prefix}pet-${size}${again}`, await pet?.layoutProblems());
      await save(`${prefix}pet-${size}${again}`, pet?.capture());
      pet?.speakUp(() => 0.99);
      await wait(800);
      report(`${prefix}pet-question-${size}${again}`, await pet?.layoutProblems());
      await save(`${prefix}pet-question-${size}${again}`, pet?.capture());
      for (const pose of ["idle", "left"] as const) await save(`${prefix}typing-cat-${size}-${pose}${again}`, typingCat?.preview(pose));
      typingCat?.refresh();
    }
  }
  store.setPref("paper", "day");
  return problems;
}

async function layerShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
  let problems = 0;
  const check = `(() => {
    const out = [];
    const pin = document.querySelector(".tools .pin");
    out.push("label " + pin.getAttribute("aria-label"));
    const menu = document.querySelector(".menu");
    if (menu) {
      const box = menu.getBoundingClientRect();
      if (box.left < 0 || box.top < 0 || box.right > window.innerWidth || box.bottom > window.innerHeight) out.push("PROBLEM menu outside the note");
      for (const row of menu.querySelectorAll(".label, [role^=menuitem]")) {
        for (const element of [row, ...row.querySelectorAll("*")]) {
          if (element.clientWidth && element.scrollWidth > element.clientWidth + 1) out.push("PROBLEM cut: " + row.textContent.trim());
        }
      }
    }
    return out;
  })()`;
  fs.mkdirSync(path.join(directory, "layer", "night"), { recursive: true });
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "layer/night/" : "layer/";
    store.setPref("paper", paper);
    for (const [width, height] of [[420, 560], [350, 400]] as const) {
      note.setSize(width, height);
      for (const layer of ["normal", "top", "desktop"] as const) {
        store.setPref("noteLayer", layer);
        await wait(300);
        await settled(note);
        const name = `${prefix}note-layer-${layer}${width === 350 ? "-small" : ""}`;
        const found = await note.webContents.executeJavaScript(check).catch((error: Error) => [`PROBLEM script failed: ${error.message}`]) as string[];
        await save(name, note.webContents.capturePage());
        await note.webContents.executeJavaScript(`document.querySelector(".tools .pin").click()`);
        await wait(300);
        await settled(note);
        const open = await note.webContents.executeJavaScript(check).catch((error: Error) => [`PROBLEM script failed: ${error.message}`]) as string[];
        await save(`${name}-menu`, note.webContents.capturePage());
        await note.webContents.executeJavaScript(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
        const lines = [...found, ...open.filter((line) => !line.startsWith("label"))];
        console.log(`layer ${name}: ${lines.join("; ")}`);
        problems += lines.filter((line) => line.startsWith("PROBLEM")).length;
      }
    }
  }
  store.setPref("noteLayer", "normal");
  store.setPref("paper", "day");
  note.setSize(420, 560);
  return problems;
}

async function earsShots(directory: string, save: Save, wait: Wait, settled: (window: BrowserWindow) => Promise<unknown>): Promise<number> {
  let problems = 0;
  const check = `(() => {
    const out = [];
    if (document.querySelector(".peek")) out.push("the cat is still in the header");
    const row = document.querySelector(".title-row").getBoundingClientRect();
    const want = window.innerHeight <= 480 ? 58 : 78;
    if (Math.abs(row.height - want) > 0.5) out.push("header " + row.height + " px, was " + want);
    for (const selector of [".date-line", ".title", ".prog-text", ".space-pick-label"]) {
      const element = document.querySelector(selector);
      if (element && element.offsetParent && element.scrollWidth > element.clientWidth + 1) out.push(selector + " cut");
    }
    return out;
  })()`;
  fs.mkdirSync(path.join(directory, "ears", "night"), { recursive: true });
  const preview = async (name: string, payload: Parameters<typeof earsPreview>[1], size: { width: number; height: number }) => {
    const window = await earsPreview(rendererDirectory, payload, { ...size, x: offscreen.x + 200, y: offscreen.y + 200 });
    await wait(400);
    await settled(window);
    await save(name, window.webContents.capturePage());
    window.destroy();
  };
  for (const paper of ["day", "night"] as const) {
    const prefix = paper === "night" ? "ears/night/" : "ears/";
    store.setPref("paper", paper);
    for (const [name, width, height, held] of [["note-ears", 420, 560, false], ["note-ears-narrow", 350, 560, false],
      ["note-ears-small", 350, 400, false], ["note-ears-twitch", 420, 560, true]] as const) {
      note.setSize(width, height);
      await wait(400);
      await settled(note);
      const found = await note.webContents.executeJavaScript(check).catch((error: Error) => [`script failed: ${error.message}`]) as string[];
      console.log(`ears ${prefix}${name}: ${found.length ? found.join("; ") : "ok"}`);
      problems += found.length;
      const image = await note.webContents.capturePage();
      const [w, h] = note.getContentSize();
      await preview(`${prefix}${name}`, { image: image.toDataURL(), width: w, height: h, held }, { width: w + 48, height: h + 20 - 1 + 48 });
    }
    await preview(`${prefix}note-ears-edge`, { width: 0, height: 0, strip: ["#ffffff", "#fbf9f3", "#cdd6de", "#2a2924", "#000000"] }, { width: 600, height: 60 });
  }
  store.setPref("paper", "day");
  return problems;
}

type Save = (name: string, image?: Promise<Electron.NativeImage>) => Promise<void>;

/** Snapshots: fictional copies in the run's temporary backup folder (never this PC's), newest first as the list shows them. */
function seedSampleBackups(): void {
  const at = (daysAgo: number, hour: number, minute: number) => { const date = new Date(); date.setDate(date.getDate() - daysAgo); date.setHours(hour, minute, 0, 0); return date; };
  const samples: [BackupReason, Date, BackupCounts, number][] = [
    ["daily", at(0, 9, 12), { todos: 24, memos: 12, events: 6, archive: 310 }, 220],
    ["beforeImport", at(1, 21, 40), { todos: 22, memos: 12, events: 6, archive: 305 }, 216],
    ["daily", at(2, 8, 55), { todos: 19, memos: 11, events: 5, archive: 298 }, 209],
    ["beforeUpdate", at(3, 10, 2), { todos: 18, memos: 11, events: 5, archive: 290 }, 204],
    ["manual", at(5, 18, 30), { todos: 16, memos: 10, events: 4, archive: 281 }, 198],
    ["daily", at(6, 9, 4), { todos: 15, memos: 10, events: 4, archive: 276 }, 196],
    ["beforeFolderSwitch", at(7, 20, 15), { todos: 15, memos: 9, events: 4, archive: 270 }, 193],
    ["daily", at(8, 9, 30), { todos: 14, memos: 9, events: 3, archive: 262 }, 190],
  ];
  fs.mkdirSync(backups.folder, { recursive: true });
  for (const [reason, date, counts, kilobytes] of samples) {
    const text = JSON.stringify({ format: "jongi-nyang-backup", version: 1, exportedAt: date.toISOString(), from: "Windows 1.31.0", reason, counts, files: { "todos.json": JSON.stringify({ items: [] }) } }, null, 2);
    // (Spaces after the JSON stand in for the sample's size.)
    fs.writeFileSync(path.join(backups.folder, savedName(reason, date)), text.padEnd(kilobytes * 1024 - 1, " ") + "\n");
  }
  backups.refresh();
}

/** The restore question for the snapshots: the sample copy from two days ago. */
function sampleRestoreQuestion(shared: boolean): ConfirmQuestion {
  const date = new Date(); date.setDate(date.getDate() - 2); date.setHours(8, 55, 0, 0);
  return restoreQuestion(date, { todos: 19, memos: 11, events: 5, archive: 298 }, shared);
}

/**
 * `npm run snapshot -- backups` (#139 · #140): 저장과 백업 with the sample copies — the 자동 백업 group, the list opened up,
 * the whole pane, the narrowest desk, the switch off, a shared storage folder — and the restore slip (and its shared
 * line), day and night. Returns how many layout problems it found (cut words included).
 */
/**
 * 글꼴 · 종이 설정 (#141 · #142): 꾸미기 and 메모 서랍 in full on a tall desk — the note's font popup and seven-step
 * slider, the drawer's paper tiles with 밤에는 밤 종이로, its sample memo and font rows — day and night; then 메모 서랍
 * with another paper, face and size picked. Each fails on a word cut in its tiles, rows or slider values.
 */
async function fontShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  fs.mkdirSync(path.join(directory, "fonts"), { recursive: true });
  const cutScript = `(() => {
    const out = [];
    for (const el of document.querySelectorAll(".pt-name, .step-value, select.popup, .row .grow, .group > .label, .dfp-ln, .dfp-sub"))
      if (el.scrollWidth > el.clientWidth + 1) out.push("cut: " + el.textContent);
    return out;
  })()`;
  const pane = async (name: string, which: "appearance" | "drawer") => {
    await showDeskPane(which, wait);
    desk.browserWindow!.setContentSize(920, 1900 + deskTitleBar);
    await inPane("settings", `document.querySelector(".content").scrollTop = 0`);
    await wait(500);
    const found = await inPane("settings", cutScript) as string[] | string;
    const list = Array.isArray(found) ? found : [String(found)];
    console.log(`fonts ${name}: ${list.length ? list.join("; ") : "ok"}`);
    problems += list.length;
    await save(`fonts/${name}`, captureDesk(wait));
  };
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    await pane(`settings-appearance-${paper}`, "appearance");
    await pane(`settings-drawer-${paper}`, "drawer");
    store.setPref("drawerTheme", "hanji");
    store.setPref("drawerNightPaper", false);
    store.setPref("drawerFont", "pen");
    store.setPref("drawerTextPt", 18);
    store.setPref("drawerParagraph", "wide");
    store.setPref("textStep", 5);
    await pane(`settings-drawer-hanji-${paper}`, "drawer");
    await pane(`settings-appearance-larger-${paper}`, "appearance");
    store.setPref("drawerTheme", "auto");
    store.setPref("drawerNightPaper", true);
    store.setPref("drawerFont", "clean");
    store.setPref("drawerTextPt", 14);
    store.setPref("drawerParagraph", "regular");
    store.setPref("textStep", 2);
  }
  store.setPref("paper", "day");
  desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
  return problems;
}

async function backupShots(directory: string, save: Save, wait: Wait): Promise<number> {
  let problems = 0;
  fs.mkdirSync(path.join(directory, "backups"), { recursive: true });
  const cutScript = `(() => {
    const out = [];
    for (const el of document.querySelectorAll(".backup-when, .backup-chip, .backup-size, .backup-title, .backup-status .sub, .backup-counts, .backup-more, .folder-place .fp-name, .group > .label, .action"))
      if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) out.push("cut: " + el.textContent);
    return out;
  })()`;
  const pane = async (name: string, scroll: string) => {
    await showDeskPane("storage", wait);
    await inPane("settings", scroll);
    await wait(400);
    const report = await inPane("settings", layoutCheckScript(settingsPaneChecks)) as LayoutReport | string | undefined;
    const cut = await inPane("settings", cutScript) as string[] | string | undefined;
    const found = [...(typeof report === "object" && report ? report.problems : [`check failed: ${String(report)}`]), ...(Array.isArray(cut) ? cut : [`cut check failed: ${String(cut)}`])];
    console.log(`backups ${name}: ${found.length ? found.join("; ") : "ok"}`);
    problems += found.length;
    await save(`backups/${name}`, captureDesk(wait));
  };
  const toGroup = (index: number) => `document.querySelector(".content").scrollTop = 0; document.querySelectorAll(".content > .group")[${index}]?.scrollIntoView({ block: "start" })`;
  const slip = async (name: string, question: ConfirmQuestion) => {
    await confirmSlip.showForSnapshot(question);
    await wait(800);
    const window = confirmSlip.snapshotWindow;
    const found = window ? await window.webContents.executeJavaScript(`(() => { const out = []; for (const el of document.querySelectorAll(".slip-title, .sbtn, .slip-head *")) if (el.scrollWidth > el.clientWidth + 1) out.push("cut: " + el.textContent); return out; })()`).catch((error: Error) => [`check failed: ${error.message}`]) as string[] : ["not shown"];
    console.log(`backups ${name}: ${found.length ? found.join("; ") : "ok"}`);
    problems += found.length;
    await save(`backups/${name}`, confirmSlip.capture());
  };
  for (const paper of ["day", "night"] as const) {
    store.setPref("paper", paper);
    const tag = paper === "night" ? "-night" : "";
    await pane(`storage-backups${tag}`, toGroup(2));
    await inPane("settings", `document.querySelector(".backup-more")?.click()`);
    await pane(`storage-list-open${tag}`, toGroup(3));
    await inPane("settings", `document.querySelector(".backup-more")?.click()`);
    desk.browserWindow!.setContentSize(920, 1500 + deskTitleBar);
    await pane(`storage-full${tag}`, `document.querySelector(".content").scrollTop = 0`);
    desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
    // #195: 저장 위치 at the top — its footnote says a move copies the list there and restarts.
    await pane(`storage-move${tag}`, `document.querySelector(".content").scrollTop = 0`);
    // The narrowest desk that keeps its sidebar's names (#195's footnote on it too, in the same resize).
    desk.browserWindow!.setContentSize(820, 640 + deskTitleBar);
    await pane(`storage-backups-narrow${tag}`, toGroup(2));
    await pane(`storage-move-narrow${tag}`, `document.querySelector(".content").scrollTop = 0`);
    desk.browserWindow!.setContentSize(920, 640 + deskTitleBar);
    backups.setAuto(false);
    await pane(`storage-backups-off${tag}`, toGroup(2));
    backups.setAuto(true);
    Object.assign(store.storage, { custom: true, label: t("공유 폴더"), path: "C:\\Users\\sample\\OneDrive\\종이냥", archivePath: "C:\\Users\\sample\\OneDrive\\종이냥\\archive" }); // i18n-ok: a folder name
    backups.refresh();
    await pane(`storage-shared${tag}`, toGroup(2));
    await slip(`confirm-restore-shared${tag}`, sampleRestoreQuestion(true));
    Object.assign(store.storage, { custom: false, label: t("이 PC (기본)"), path: "C:\\Users\\sample\\AppData\\Roaming\\PaperTodo", archivePath: "C:\\Users\\sample\\AppData\\Roaming\\PaperTodo\\archive" });
    backups.refresh();
    await slip(`confirm-restore${tag}`, sampleRestoreQuestion(false));
    confirmSlip.hide();
    // #195: the toast the restarted app shows once (the sample folder's name), in the note as it is (nothing resized).
    note.webContents.send("note:notice", { icon: "folder", text: storageMovedText({ folder: t("종이냥"), kept: "moved" }) });
    await wait(700);
    await save(`backups/storage-moved-toast${tag}`, note.webContents.capturePage());
  }
  store.setPref("paper", "day");
  return problems;
}
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

// ─── The note's key: the note shown or put away from anywhere (#85) ───────────

/** The key held now ("" = none). */
let noteHotkeyHeld = "";

/**
 * Takes the note's key (Settings → 빠른 입력; Ctrl+Alt+J unless changed) or gives it back, and gives back the old
 * one when it changes. When another app holds it, Settings says so. Tests, snapshots and `npm run perf` take none.
 */
function updateNoteHotkey(): void {
  if (snapshotDirectory || offscreenEnabled || shortcutsDisabled) return;
  const wanted = store.prefs.noteHotkey ? store.prefs.noteShortcut : "";
  if (noteHotkeyHeld && noteHotkeyHeld !== wanted) {
    globalShortcut.unregister(noteHotkeyHeld);
    noteHotkeyHeld = "";
  }
  if (wanted && !noteHotkeyHeld) {
    let ok = false;
    try { ok = globalShortcut.register(wanted, toggleNote); } catch { ok = false; }
    if (ok) noteHotkeyHeld = wanted;
  }
  const problem = wanted && !noteHotkeyHeld ? t("다른 앱이 {key} 키를 쓰고 있어요. 다른 키를 골라 주세요.", { key: shortcutLabel(wanted) }) : undefined;
  if (problem !== store.noteShortcutProblem) {
    store.noteShortcutProblem = problem;
    store.changed();
  }
}

/**
 * The note's key: the note on screen goes away at once, even with another app in front (#85); hidden, minimised
 * or folded into the sticky note, it comes forward (unfolded). Windows can't tell whether other windows cover the
 * note, so a covered one goes away too and the next press brings it forward (noteToggle in core/shortcuts.ts).
 */
function toggleNote(): void {
  // #273: a note kept behind the other windows is taken for covered unless it was summoned (it comes forward).
  if (noteToggle({ visible: note.isVisible(), minimized: note.isMinimized(), folded: floating.isVisible, uncovered: stayBehind().inFront(note) }) === "hide") {
    note.webContents.send("note:commit-editing");
    note.hide();
    focusTimer?.noteShown();
    return;
  }
  showNote();
}

app.on("second-instance", (_event, argv) => secondLaunch(argv));
app.on("before-quit", () => { quitting = true; store?.flush(); });
app.on("will-quit", () => { typingCat?.dispose(); store?.flush(); quick?.dispose(); quickMemo?.dispose(); drawer?.dispose(); if (noteHotkeyHeld) globalShortcut.unregister(noteHotkeyHeld); globalShortcut.unregisterAll(); store?.unwatch(); ai?.stop(); });
app.on("window-all-closed", () => undefined);

app.whenReady().then(() => {
  // Off-screen runs on a Mac (snapshots, tests): no Dock icon either, so nothing of the run shows.
  if (offscreenEnabled) app.dock?.hide();
  const place = directories();
  settingsDirectory = place.settings;
  setLang(appLanguage(place.settings));
  // Every time in the app on the system's clock (preload hands it to each window: "clock:get").
  setHourCycle(systemHourCycle());
  // The week's first day from the system's too (preload: "week:get").
  setWeekStart(systemWeekStart());
  // Google 캘린더 · Tasks are gone: their sign-in and copies on this device go too.
  removeLeftovers(place.settings);
  // 자동 백업 (#139): a new version's first launch copies the storage folder before the store reads (and may rewrite) it.
  backups = new AutoBackup(place.settings, () => place.data, backupSource, () => store?.changed());
  if (!demo) backups.beforeUpdate(app.getVersion());
  store = new Store(place.data, demo, place.settings);
  const windows = process.platform === "win32";
  store.storage = {
    label: storageLabel(place.folder, os.homedir(), windows, "PC", lang()) + (place.unavailable ? ` ${t("(열 수 없음)")}` : ""), custom: Boolean(place.folder),
    path: place.data, archivePath: path.join(place.data, "archive"), home: os.homedir(),
  };
  // Snapshots: the demo's temporary folder said as the default one on a sample PC, so no real path is drawn (only what
  // the storage pane shows; the data stays in the temporary folder).
  if (snapshotDirectory) Object.assign(store.storage, { path: "C:\\Users\\sample\\AppData\\Roaming\\PaperTodo", archivePath: "C:\\Users\\sample\\AppData\\Roaming\\PaperTodo\\archive", home: "C:\\Users\\sample" });
  if (place.unavailable) store.storageError = t("‘{name}’ 폴더를 열 수 없어서 이 PC의 기본 위치에 저장하고 있어요. 폴더가 다시 보이면 종이냥을 다시 시작해 주세요.", { name: path.basename(place.unavailable) });
  ai = new AiConnection(store, place.settings, {
    toast: notice,
    noteVisible: () => Boolean(note && !note.isDestroyed() && note.isVisible() && !note.isMinimized()),
    // The cat's line about Claude: only when it is out and nothing else holds its attention.
    say: (line) => { if (pet?.isShown && !focusTimer?.isRunning && !periodicPopup?.isVisible && !taskPopup?.isVisible) pet.say(line, 8); },
    changed: () => store.changed(),
  }, aiFiles(), `windows ${app.getVersion()}`);
  store.aiView = () => ai.view();
  // Snapshots: the copies are fictional samples in the run's temporary folder, said as this PC's default one.
  store.backupsView = snapshotDirectory
    ? () => ({ ...backups.view(store.storage.custom), folder: "C:\\Users\\sample\\AppData\\Roaming\\PaperTodo\\backups" })
    : () => backups.view(Boolean(place.folder));
  if (snapshotDirectory) seedSampleBackups();
  // Another computer may change the shared files; snapshots work in a throwaway folder and don't watch.
  if (!snapshotDirectory) store.watch();
  archive = new ArchiveStore(store, place.data);
  if (snapshotDirectory) archive.seed(sampleHistory());
  startDayKeeper();
  // 완료 기록 reads the record again only when what it shows changed (finished tasks, another device's files),
  // not on every change of the list (each keystroke in a memo used to make it fetch the whole record).
  let historyKey = "";
  store.on("change", () => {
    // 2c: the spaces too (their names and colours, and each finished to-do's), for the record's filter.
    const key = JSON.stringify([store.items.filter((item) => item.isCompleted).map((item) => [item.id, item.title, item.createdAt, item.completedAt, item.timeStart, item.timeEnd, spaceOf(store.todoSpaces, item.id)]),
      liveSpaces(store.todoSpaces).map((space) => [space.id, space.name, space.color]), store.todoSpaces.general?.name]);
    if (key === historyKey) return;
    historyKey = key;
    desk.sendAll("history:changed");
  });
  store.on("reloaded", () => desk.sendAll("history:changed"));
  Menu.setApplicationMenu(null);
  registerIPC();
  // #253: every page hears what is up (the widgets and their day sheet wait only for a question that replaces the whole
  // list); the question floats over a widget kept on top and the day sheet.
  confirmSlip = new SlipConfirm(rendererDirectory, (on, replacesList) => sendEverywhere("slip:asking", on, replacesList),
    () => widgets?.floats === true || widgetSheet?.isVisible === true);
  periodicPopup = new ReminderPopup(rendererDirectory);
  taskPopup = new ReminderPopup(rendererDirectory);
  // 밤 종이 before the first window: its background is already the right paper.
  applyPaper();
  nativeTheme.on("updated", refreshPaper);
  store.on("prefs", (key: keyof Prefs) => { if (key === "paper" || key === "paperTheme" || key === "paperNight") applyPaper(); });
  desk = new Desk(store, rendererDirectory, {
    webPreferences, icon: path.join(assetsDirectory, "cat.png"), background: () => paperBackground[paperLookNow().shown], snapshots: Boolean(snapshotDirectory), guide: showGuide, search: openSearch,
    chrome: snapshotDirectory ? "preview" : process.platform === "win32" ? "overlay" : undefined, symbols: () => paperInk2[paperLookNow().shown],
    inSight: deskInSight,
  });
  note = createNote();
  // #195: after a move, once, where the list went (the folder's name only) — when the note is up.
  const moved = demo ? undefined : takeMoved(place.settings);
  if (moved) note.webContents.once("did-finish-load", () => setTimeout(() => notice({ icon: "folder", text: storageMovedText(moved) }), 1200));
  noteEars = new NoteEars(note, rendererDirectory, Boolean(snapshotDirectory));
  applyNoteLayer();
  floating = new FloatingNote(store, rendererDirectory, showNote, quit);
  const live = !snapshotDirectory && !offscreenEnabled;
  // A timer started, paused or ended: every window hears it (the 오늘 창's card), and the tray.
  focusLog = new FocusLog(place.data, () => {
    // Appended once, never tried again: this session isn't in the record.
    store.storageError = [t("집중 기록을 저장하지 못했어요."), t("이번 집중은 기록에 남지 않았어요."), t("저장 폴더가 열리는지 확인해 주세요.")].join(" ");
    store.changed();
  });
  focusTimer = new FocusTimerWidget(store, rendererDirectory, {
    changed: broadcast, cheer: () => pet?.cheer(), custom: (start) => timerSheet.open(start),
    // H3: the to-do's space when the session ended (none for 일반 and a plain timer).
    record: (record) => { const space = record.taskId ? spaceOf(store.todoSpaces, record.taskId) : undefined; if (focusLog.append(space ? { ...record, space } : record)) desk.sendAll("history:changed"); },
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
  // 바탕화면 달력 위젯 (#234): this PC's widgets (none until one is added in 책상 → 일정), and the day sheet beside one.
  widgetSheet = new WidgetSheet(rendererDirectory, live, Boolean(snapshotDirectory), {
    made: (id, payload) => widgets.windowOf(id)?.webContents.send("widget:made", payload),
    asked: () => confirmSlip.up,
    hidden: () => confirmSlip.raise(),
  });
  widgets = new CalendarWidgets(store, rendererDirectory, {
    openSettings: openWidgetSettings,
    // #253: a question waiting stays over the sheet.
    openSheet: (id, day, beside) => { widgetSheet.open(id, day, beside); confirmSlip.raise(); },
    changed: updateTray,
  }, Boolean(snapshotDirectory));
  widgets.sync();
  timerSheet = new TimerSheet(rendererDirectory, live, (minutes) => focusTimer.command({ kind: "countdown", minutes }));
  quickMemo = new QuickMemo(store, rendererDirectory, live, (id) => notice({ icon: "note", text: t("메모 서랍에 넣었어요"), show: "drawer", entry: id }));
  // 메모 서랍: its shortcut and its handle at the screen's edge (tests and snapshots take neither).
  drawer = new MemoDrawer(store, rendererDirectory, live, { look: drawerPaperNow, reduceMotion: () => !systemPreferences.getAnimationSettings().shouldRenderRichAnimation });
  pet = new DesktopPet(store, rendererDirectory, {
    openNote: showNote, changed: updateTray, timerMenu: () => focusTimer.timerMenu(),
    // 종이냥 한마디 waits while the timer runs or a reminder is up; ‘쉴래요’ starts five minutes.
    isBusy: () => focusTimer.isRunning || periodicPopup.isVisible || taskPopup.isVisible,
    rest: () => focusTimer.command({ kind: "countdown", minutes: 5 }),
    focus: () => focusTimer.command({ kind: "countdown", minutes: 25 }),
    // Created after the pet; asked only when the cat speaks up.
    calendar: () => calendar?.chatter(),
    quickMemo: () => quickMemo.open(),
    drawer: () => drawer.show(),
    alarms: () => openSettings("clock"),
    finished: () => archive?.all() ?? [],
    typingLately: () => typingCat?.typedWithin(typingChatterQuietMs) ?? false,
  });
  // #288: the keyboard hook for 모든 앱에서 is loaded only when it is chosen (never in --mcp-stdio, which loads none of this).
  typingCat = new TypingCatWindow(store, rendererDirectory, { changed: updateTray }, loadKeyHook);
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
  // AI 연결: the link at launch (on or off), and while on, what Claude did while the app was closed.
  // `npm run perf` with PAPERTODO_DEMO_AI=1 measures the app idle with it on.
  if (demo && !snapshotDirectory && process.env.PAPERTODO_DEMO_AI === "1") store.setPref("aiEnabled", true);
  ai.start();
  for (const event of ["show", "restore"] as const) note.on(event as "show", () => setTimeout(() => ai.noteShown(), 300));
  noteCapApplied = noteWidthCap();
  store.on("change", applyNoteWidthCap);
  store.on("prefs", (key: keyof Prefs) => {
    if (key === "spaceGroups") applyNoteWidthCap();
    if (key === "noteLayer") applyNoteLayer();
    // Started at sign-in with --at-login, so a launch by hand can be told apart (the cat's question).
    if (key === "openAtLogin" && !demo) app.setLoginItemSettings({ openAtLogin: store.prefs.openAtLogin, ...(process.platform === "win32" ? { args: [loginFlag] } : {}) });
    if (key === "taskbarBadge") updateTaskbar();
  });
  quick = new QuickEntry(store, rendererDirectory, !snapshotDirectory && !offscreenEnabled);
  store.on("prefs", (key: keyof Prefs) => { if (key === "noteHotkey" || key === "noteShortcut") updateNoteHotkey(); });
  updateNoteHotkey();
  if (!snapshotDirectory && !offscreenEnabled) createTray();
  drawer.start();
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
  if (!demo) startBackups();
  if (!snapshotDirectory) {
    setTimeout(lookBack, 8000);
    setInterval(lookBack, 5 * 60_000);
    powerMonitor.on("resume", lookBack);
  }
  if (snapshotDirectory) { for (const record of sampleFocus()) focusLog.append(record); }
  // A step that throws ends the run as a failure (#178: the error was logged and the run waited for its 90-minute timeout).
  if (snapshotDirectory) runSnapshots(snapshotDirectory).catch((error: unknown) => {
    console.log("SNAPSHOT RUN STOPPED:", error instanceof Error ? error.stack : error);
    finishSnapshots(1);
  });
});

// Keeps links out of the app's windows and frames, and refuses every permission request (#171, security.ts).
guardWebContents(rendererDirectory);

