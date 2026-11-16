import { execFileSync } from "node:child_process";
import { BrowserWindow, Menu, Notification, Tray, app, clipboard, dialog, globalShortcut, ipcMain, nativeImage, nativeTheme, powerMonitor, screen, shell, systemPreferences, type MenuItemConstructorOptions, type WebFrameMain } from "electron";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { dayKey, logicalDayStart } from "../core/archive";
import { weeklyLookback } from "../core/lookback";
import { isoDate, type TodoItem } from "../core/notebook";
import { pageOf, tabDrop } from "../core/shelf";
import { folderPlace, sameFolder, storageLabel, type StorageMoved } from "../core/storage";
import { noteOrigin, type Point } from "../core/placement";
import { ArchiveStore } from "./archiveStore";
import { CalendarService } from "./calendar";
import { readStateKind, stateChannels, stateSlice, type AppState, type StateKind, type NoteNotice, fontTitles, pomodoroSettings, textStepTitles, type Action, type FocusCommand, type IntentMade, type IntentRequest, type IntentResult, type NotebookFont, type ParsedWhen, type Prefs, type WireCandidate, type IntentPage } from "../core/types";
import { firstDayFromIntl, firstDayFromRegistry, hourCycle, nativeName, resolveLang, setHourCycle, setWeekStart, spokenTime, weekStartSet, type HourCycle, type Lang, type LanguageSetting } from "../core/lang";
import { lang, setLang, t } from "../i18n";
import { type CalendarSheetRequest } from "../core/calendar";
import { backupCounts, backupFileName, countsText, exportedText, makeBackup, parseBackup, parseSavedName, savedWhen, summary, summaryText, type BackupFiles } from "../core/backup";
import { newAlarm, readAlarm, type Alarm } from "../core/alarm";
import { emptyIntentMemory, learnSwitch } from "../core/intent";
import { readPane, type DeskPane } from "../core/desk";
import { drawerKindOf, drawerShown, paperBackground, paperInk2, shownPaper, themeSourceOf, type PaperChoice, type PaperKind, type PaperLook } from "../core/paper";
import { expand } from "../core/events";
import { glanceText, type GlanceTimer } from "../core/glance";
import { offscreen, offscreenEnabled, shortcutsDisabled, testHooks } from "./env";
import { guardOffscreen } from "./offscreenGuard";
import { Desk, type DeskExtra } from "./desk";
import { FloatingNote } from "./floating";
import { NoteEars } from "./noteEars";
import { GlanceWindow } from "./glanceWindow";
import { CalendarWidgets } from "./calendarWidget";
import { stayBehind } from "./stayBehind";
import { reportInfo } from "./reportInfo";
import { WidgetSheet } from "./widgetSheet";
import { DesktopPet } from "./pet";
import { TypingCatWindow } from "./typingCat";
import { loadKeyHook } from "./keyHook";
import { NoteCaptionClicks } from "./captionClicks";
import { typingChatterQuietMs } from "../core/typingCat";
import { ReminderPopup } from "./popup";
import { QuickEntry } from "./quick";
import { QuickMemo } from "./quickMemo";
import { MemoDrawer } from "./drawer";
import { addFolder, deleteFolder, restoreFolder, folderName, inboxID, moveNotice, shortcutLabel, placementOf, moveMemo, pinAll, pinnedView, recolorFolder, renameFolder, reorderFolders, setFolderSort, setFolderView, setMemoPaper, setPinned, targetOf } from "../core/memoDrawer";
import { narrowNote, returnPoint, wideNote } from "../core/spaceGroups";
import { movedBlock, movedManyWords, restoredOrder } from "../core/selection";
import { addSpace, deleteSpace, findSpace, historySpaces, spaceIndex, generalName, liveSpaces, moveTodo, newSpaceID, recolorSpace, renameGeneral, renameSpace, reorderSpaces, restoreSpace, seriesSpaceOf, lensFor, spaceColor, spaceOf, toSpaceWords, type SpaceChoice } from "../core/todoSpaces";
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
import { FocusTimerWidget } from "./timer";
import { guardWebContents, openExternalSafely, refused, senderPage } from "./security";
import { mayAct, pageChannels, readAction, readCalendarRequest, readIntentRequest, type PageName } from "../core/ipcCheck";
import { widgetPressWhileUp } from "../core/slipMove";
import { FocusLog } from "./focusLog";
import { EveningSweep } from "./sweep";
import { moveChoices, movedTomorrowText, tomorrowKey } from "../core/carry";
import { search } from "../core/search";
import { badgeText, jumpTasks, launchCommand, loginFlag, shouldAskLogin, startedAtLogin, taskbarProgress, thumbButtons, type LaunchCommand, type TaskbarTimer, type ThumbButton } from "../core/taskbar";
import { acceptNotifyAction, makeNonce, notifyButtons, notifyScheme, readNotifyLink, toastXml, wantsSystemNotice, type NotifyAction } from "../core/notify";
import { dockFrame, stillDocked } from "../core/dock";
import { soonest } from "../core/glance";
import { movedText } from "../core/ahead";
import { focusMinutes as rangeFocusMinutes, rangeDay, validRange } from "../core/timeRange";
import { saveOnSessionEnd } from "./sessionEnd";
import { seedSampleBackups } from "./snapshots/settings";
import { runSnapshots, sampleFocus, sampleHistory } from "./snapshots/index";

// Test runs only (#174: not in a release build, env.ts testHooks).
declare const __TEST_HOOKS__: boolean;
/**
 * #408: `__TEST_HOOKS__` itself, not env.ts's testHooks, so a release build (tools/build.mjs --production) sees the
 * snapshot run is never there and leaves snapshots/*.ts out of out/app.js.
 */
const snapshotDirectory = __TEST_HOOKS__ ? process.env.PAPERTODO_SNAPSHOT : undefined;
const demo = testHooks && (process.argv.includes("--demo") || Boolean(snapshotDirectory));
export const rendererDirectory = path.join(__dirname, "renderer");
const assetsDirectory = path.join(__dirname, "..", "assets");

// Off-screen runs (#92): every window's place and size through one door, from its first moment (offscreenGuard.ts).
if (offscreenEnabled) guardOffscreen();
app.setAppUserModelId("com.noa.PaperTodo");
if (!snapshotDirectory && !app.requestSingleInstanceLock()) app.quit();

export let store: Store;
/** AI 연결 (종이냥 for Claude): ai-link.json, the log's toasts, undo and stamps. */
export let ai: AiConnection;
export let note: BrowserWindow;
export let desk: Desk;
export let archive: ArchiveStore;
/** 자동 백업 (#139): the backup folder, the daily copy and the copies before an overwrite. */
export let backups: AutoBackup;
let tray: Tray | undefined;
export let floating: FloatingNote;
/** The cat's ears on the note's top edge (#151). */
let noteEars: NoteEars;
export let pet: DesktopPet | undefined;
/** 치면 두드리는 고양이 (#289): its own cat in a corner, apart from the pet. */
export let typingCat: TypingCatWindow | undefined;
export let focusTimer: FocusTimerWidget;
let focusLog: FocusLog;
let taskReminders: TaskReminders;
export let periodicPopup: ReminderPopup;
export let taskPopup: ReminderPopup;
export let periodic: PeriodicReminders;
export let quick: QuickEntry;
export let quickMemo: QuickMemo;
export let drawer: MemoDrawer;
export let timerSheet: TimerSheet;
export let alarmClock: AlarmClock;
export let calendar: CalendarService;
export let confirmSlip: SlipConfirm;
export let glance: GlanceWindow;
/** 바탕화면 달력 위젯 (#234) and the day sheet a click on one opens. */
export let widgets: CalendarWidgets;
export let widgetSheet: WidgetSheet;
export let sweep: EveningSweep;

/** A question on a slip over `parent` (the 쪽지 family's confirm); resolves with the answer's index. */
function ask(parent: BrowserWindow | undefined, question: ConfirmQuestion): Promise<number> {
  return confirmSlip.ask(parent, question);
}
let quitting = false;
let toldAboutTray = false;
/** Where the icon sat on the note when it was folded, so unfolding mirrors it. */
let collapseAnchorInNote: Point | undefined;
/** Windows: double-clicking the note's header folds it (#323). */
let noteCaptionClicks: NoteCaptionClicks | undefined;

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

let regionRead: { output?: string } | undefined;

/**
 * Windows' region settings (`reg query "HKCU\\Control Panel\\International"`), read once at launch for both the clock
 * and the first day of the week (#408: it used to run reg.exe twice); undefined elsewhere, or with no reg.exe or no
 * answer in time.
 */
function regionSettings(): string | undefined {
  if (process.platform !== "win32") return undefined;
  if (!regionRead) {
    regionRead = {};
    try {
      regionRead.output = execFileSync("reg", ["query", "HKCU\\Control Panel\\International"], { encoding: "utf8", timeout: 1500, windowsHide: true });
    } catch {
      // No reg.exe or no answer in time: Intl instead.
    }
  }
  return regionRead.output;
}

/**
 * #380 (the Mac's StorageFolder.waitForChosen): the chosen folder isn't there at launch (Dropbox or OneDrive not running
 * yet, a disk unplugged), so nothing is read or written until it is — it is looked for every second and opens by itself
 * once there. 다시 확인 looks again, 폴더 다시 고르기 picks another (its own list opens; nothing is moved), 이 PC 목록 열기
 * opens this PC's list for this run (the folder stays chosen for the next launch; the storage problem says so).
 */
async function waitForDataFolder(place: ReturnType<typeof directories>): Promise<ReturnType<typeof directories>> {
  while (place.unavailable) {
    const missing = place.unavailable;
    const back = new AbortController();
    const look = setInterval(() => { if (usableFolder(missing)) back.abort(); }, 1000);
    const { response } = await dialog.showMessageBox({
      type: "warning", title: t("저장 폴더"), message: t("저장 폴더를 찾지 못했어요"),
      detail: t("‘{name}’ 폴더가 아직 보이지 않아요. Dropbox · OneDrive가 켜지거나 디스크가 연결되면 저절로 그 폴더로 열어요. 그전에는 아무 파일도 쓰지 않아요.", { name: path.basename(missing) }),
      buttons: [t("다시 확인"), t("폴더 다시 고르기"), t("이 PC 목록 열기")], defaultId: 0, cancelId: 0, noLink: true, signal: back.signal,
    });
    clearInterval(look);
    if (!back.signal.aborted && response === 2) return place;
    if (!back.signal.aborted && response === 1) {
      const picked = await dialog.showOpenDialog({ title: t("저장 폴더"), buttonLabel: t("이 폴더 열기"), properties: ["openDirectory", "createDirectory"] });
      if (!picked.canceled && picked.filePaths[0]) writeDataFolder(place.settings, picked.filePaths[0]);
    }
    place = directories();
  }
  return place;
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
  const output = regionSettings();
  if (output !== undefined) {
    const format = /^\s*sShortTime\s+REG_SZ\s+(.+?)\s*$/m.exec(output)?.[1];
    if (format) return /H/.test(format) ? "h24" : "h12";
    const flag = /^\s*iTime\s+REG_SZ\s+(\d)\s*$/m.exec(output)?.[1];
    if (flag) return flag === "1" ? "h24" : "h12";
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
  const output = regionSettings();
  if (output !== undefined) {
    const found = firstDayFromRegistry(/^\s*iFirstDayOfWeek\s+REG_SZ\s+(\S+)\s*$/m.exec(output)?.[1]);
    if (found) return found;
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
export function languageQuestion(value: LanguageSetting): ConfirmQuestion {
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
export function broadcast(): void {
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
  // Double-clicking the header folds the note into the post-it, where the click happened (#323: main/captionClicks.ts).
  if (process.platform === "win32") noteCaptionClicks = new NoteCaptionClicks(window, (point) => collapse(point));
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

export function collapse(anchor?: Point): void {
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
export function openHelp(topic?: string, query?: string): void {
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
export function openCalendar(day?: string, event?: string): void {
  const chosen = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : undefined;
  const key = chosen && event && calendar.find(event) ? event : undefined;
  openDesk("calendar", chosen ? { day: chosen, ...(key ? { event: key } : {}) } : {});
}

/**
 * ⋯ → 키보드 단축키 (#86): the app's keys on a slip, in groups — 입력 · 이동 · 책상 달력 (#275) · 고른 할 일 · 어디서든 · 집중
 * · 메모 서랍, then the drawer's own two — each row what it does and its keys, one cap each (Ctrl + N). The changeable keys (the
 * note's, the drawer's) show the one chosen, or ‘끔’. The same groups, order and words as on the Mac (ShortcutList.swift).
 */
export function shortcutQuestion(): ConfirmQuestion {
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
export function drawerShortcutQuestion(): ConfirmQuestion {
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

/**
 * #409 문제 보고용 정보 복사 (책상 → 도움): the displays, the note's and the cats' windows and the GPU, for a problem
 * that shows only on someone's PC (main/reportInfo.ts). No to-do, memo or path; the folder only as 공유 or not.
 */
function copyReportInfo(): void {
  const { prefs } = store;
  clipboard.writeText(reportInfo([["note", note], ["ears", noteEars?.reportWindow], ["pet", pet?.reportWindow], ["typing cat", typingCat?.reportWindow]], {
    noteLayer: prefs.noteLayer, petVisible: prefs.petVisible, petSize: prefs.petSize, typingCat: prefs.typingCat, typingCorner: prefs.typingCorner,
    typingSize: prefs.typingSize, paper: paperLookNow().shown, sharedFolder: store.dataDirectory !== settingsDirectory, offscreen: offscreenEnabled,
  }));
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
export function moreMenu(): Menu {
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
export function notice(value: NoteNotice): boolean {
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
export function rowMenu(id: string): Menu {
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
export function moveToSpace(ids: string[], space: string | null, previous?: string[]): void {
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
export function showPaperRowMenu(id: string, at: { x?: number; y?: number; keyboard?: boolean }): void {
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
export function eventMenu(key: string, inCalendar = false): Menu {
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
    // #390: 다시 시도 picks a place again (the Mac's slip is the same).
    const again = await ask(note, { icon: "warning", cat: false, title: t("텍스트로 내보내기"), message: t("내보내지 못했어요."), detail: t("다른 곳을 골라 다시 시도해 주세요."),
      buttons: [{ label: t("다시 시도"), kind: "ghost" }, { label: t("닫기"), kind: "primary" }], cancelId: 1 });
    if (again === 0) await exportList();
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
    const again = await ask(parent, { icon: "warning", cat: false, title: t("내보내기"), message: t("내보내지 못했어요."), detail: t("다른 곳을 골라 다시 시도해 주세요."),
      buttons: [{ label: t("다시 시도"), kind: "ghost" }, { label: t("닫기"), kind: "primary" }], cancelId: 1 });
    if (again === 0) await exportBackup();
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
  const warn = (message: string, detail?: string) => ask(parent, { icon: "warning", cat: false, title: t("가져오기"), message, ...(detail ? { detail } : {}), buttons: [{ label: t("닫기"), kind: "primary" }], cancelId: 0 });
  let parsed: ReturnType<typeof parseBackup>;
  try {
    parsed = parseBackup(readBackupText(file, true), lang()); // #173: past 64MB it isn't read
  } catch (error) {
    const refused = backupRefusal(error, lang());
    // #390: what didn't happen and that the list is safe first, then why (as the Mac's).
    await warn(t("가져오지 못했어요. 지금 목록은 그대로예요."), `${refused ?? t("파일을 읽지 못했어요.")}\n${path.basename(file)}`);
    return;
  }
  if ("error" in parsed) {
    await warn(t("가져오지 못했어요. 지금 목록은 그대로예요."), `${parsed.error}\n${path.basename(file)}`);
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
    icon: "box", title: t("가져오기"), message: t("가져왔어요."), detail: `${summaryText(summary(files), lang())}\n${t("가져오기 전 것도 백업 폴더에 남겨 뒀어요.")}`,
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
    const open = await ask(dialogParent(), { icon: "warning", cat: false, title: t("자동 백업"), message: t("백업하지 못했어요. 지금 목록은 그대로예요."), detail: t("백업 폴더를 열어 확인해 주세요."),
      buttons: [{ label: t("백업 폴더 열기"), kind: "ghost" }, { label: t("닫기"), kind: "primary" }], cancelId: 1 });
    if (open === 0) openBackupFolder();
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
    const again = await ask(parent, { icon: "folder", cat: false, title: t("백업 폴더"), message: t("저장 폴더 안에는 백업을 둘 수 없어요."), detail: t("다른 폴더를 골라 주세요."),
      buttons: [{ label: t("다른 폴더…"), kind: "ghost" }, { label: t("닫기"), kind: "primary" }], cancelId: 1 });
    if (again === 0) await chooseBackupFolder();
  }
}

/** The restore question (also drawn by the snapshots): when, what the copy holds, the two ways back, and the other devices. */
export function restoreQuestion(date: Date, counts: ReturnType<typeof backupCounts>, shared: boolean): ConfirmQuestion {
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
  const warn = (detail?: string) => ask(parent, { icon: "warning", cat: false, title: t("되돌리기", undefined, "restore"), message: t("되돌리지 못했어요. 지금 목록은 그대로예요."), ...(detail ? { detail } : {}), buttons: [{ label: t("닫기"), kind: "primary" }], cancelId: 0 });
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
  // #390: 다시 시도 moves again with the same answer (it doesn't ask again), as on the Mac.
  for (;;) {
    try {
      moveData(store.dataDirectory, target, copy, backups.folder, backupSource(), new Date());
      writeDataFolder(settingsDirectory, folder);
      // #195: the restarted app says once where the list went — the folder's name as the storage pane shows it, never its path.
      try {
        writeMoved(settingsDirectory, { ...(folder ? { folder: folderPlace(folder, os.homedir(), process.platform === "win32").name } : {}), kept: copy ? "moved" : "folder" });
      } catch { /* the move is done; only the toast is missed */ }
      break;
    } catch {
      const again = await ask(parent, { icon: "warning", cat: false, title: t("저장 위치"), message: t("폴더로 옮기지 못했어요. 지금 목록은 그대로예요."),
        detail: t("폴더에 쓸 수 있는지 확인하고 다시 시도해 주세요."), buttons: [{ label: t("다시 시도"), kind: "ghost" }, { label: t("닫기"), kind: "primary" }], cancelId: 1 });
      if (again !== 0) return;
    }
  }
  app.relaunch();
  quit();
}

/** #195: the toast after a move — where the list went, or whose list is used now. */
export function storageMovedText(moved: StorageMoved): string {
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
    case "aiCopyCommand": return ai.copyCommand((text) => clipboard.writeText(text));
    case "deskPane": return desk.choose(action.pane);
    case "openGuide": return showGuide();
    case "copyReportInfo": return copyReportInfo();
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
    case "showStorageProblem": {
      // #382: a file left unwritten because it didn't read can be read again from here.
      const reread = store.unreadFiles > 0 ? [{ label: t("다시 읽기"), kind: "ghost" as const }] : [];
      // #478: 열어 보기 while a cloud's conflict copies were moved to the backup folder (shown once).
      const copies = [...store.movedCopies];
      const show = copies.length ? [{ label: t("열어 보기"), kind: "ghost" as const }] : [];
      void ask(note, {
        icon: "warning", title: t("저장 폴더 확인"), message: store.storageError ?? "", size: "m",
        buttons: [{ label: t("저장 폴더 열기"), kind: "ghost" }, ...reread, ...show, { label: t("닫기"), kind: "primary" }], cancelId: 1 + reread.length + show.length,
      }).then((answer) => {
        if (copies.length) store.copiesShown();
        if (answer === 0) void shell.openPath(store.dataDirectory);
        else if (reread.length && answer === 1) store.reread();
        else if (show.length && answer === 1 + reread.length) shell.showItemInFolder(copies[copies.length - 1]); // the newest; the others are beside it
      });
      return;
    }
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
export function focusCommand(command: FocusCommand): void {
  if (command.kind === "askStop") {
    if (!focusTimer.focusing) return;
    // Time is up or the break is over: closing loses nothing — it ends like 다음에, no question (as on the Mac).
    const stage = focusTimer.focusView()?.stage;
    if (stage === "timeUp" || stage === "breakOver") { focusTimer.focus({ kind: "later" }); return; }
    void ask(note, {
      icon: "timer", title: t("집중"), message: t("집중을 그만둘까요?"), detail: t("지금까지 집중한 시간은 기록에 남아요."),
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
export function trayTooltip(now = new Date()): string {
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
  // #380: still waiting for the storage folder — nothing is open yet (the question stays up).
  if (!store) return;
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
export function moveQuestion(): ConfirmQuestion | undefined {
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
export function trayMenu(): MenuItemConstructorOptions[] {
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
 * #253 (shared/cases/widget-ask-cases.json `presses`): a widget's or its day sheet's action while a question waits. A line
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

export function finishSnapshots(problems: number): void {
  quitting = true;
  if (problems > 0) app.exit(1);
  else app.quit();
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
app.on("will-quit", () => { typingCat?.dispose(); noteCaptionClicks?.dispose(); store?.flush(); quick?.dispose(); quickMemo?.dispose(); drawer?.dispose(); if (noteHotkeyHeld) globalShortcut.unregister(noteHotkeyHeld); globalShortcut.unregisterAll(); store?.unwatch(); ai?.stop(); });
app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  // Off-screen runs on a Mac (snapshots, tests): no Dock icon either, so nothing of the run shows.
  if (offscreenEnabled) app.dock?.hide();
  const first = directories();
  settingsDirectory = first.settings;
  setLang(appLanguage(first.settings));
  // #380: a chosen folder that isn't there yet is waited for (the language first, for the question).
  const place = await waitForDataFolder(first);
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
  store.backupFolder = () => backups.folder;
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
  if (__TEST_HOOKS__ && snapshotDirectory) seedSampleBackups();
  // Another computer may change the shared files; snapshots work in a throwaway folder and don't watch.
  if (!snapshotDirectory) store.watch();
  archive = new ArchiveStore(store, place.data);
  if (__TEST_HOOKS__ && snapshotDirectory) archive.seed(sampleHistory());
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
  // #383: Windows shutting down or logging off sends no before-quit: what waits to be saved is written then.
  saveOnSessionEnd(note, { commitTyping: () => { note.webContents.send("note:commit-editing"); drawer?.flushTyping(); }, flush: () => store.flush() });
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
  if (__TEST_HOOKS__ && snapshotDirectory) { for (const record of sampleFocus()) focusLog.append(record); }
  // A step that throws ends the run as a failure (#178: the error was logged and the run waited for its 90-minute timeout).
  if (__TEST_HOOKS__ && snapshotDirectory) runSnapshots(snapshotDirectory).catch((error: unknown) => {
    console.log("SNAPSHOT RUN STOPPED:", error instanceof Error ? error.stack : error);
    finishSnapshots(1);
  });
});

// Keeps links out of the app's windows and frames, and refuses every permission request (#171, security.ts).
guardWebContents(rendererDirectory);

