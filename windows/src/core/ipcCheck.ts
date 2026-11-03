import { readAlarm } from "./alarm";
import type { CalendarWriteRequest } from "./calendar";
import { deskPanes, paperSettings } from "./desk";
import { drawerBackdrops, drawerFonts, drawerTextSizes, drawerThemes, folderSorts, folderViews, memoPapers } from "./memoDrawer";
import { codeFonts, drawerPoints, lineSpacings, noteScales, paragraphSpacings } from "./textSteps";
import { timerSizes } from "./timerWidget";
import { defaultPrefs, textSizes, type Action, type IntentRequest, type Prefs } from "./types";
import { deskFramePages, ownPage } from "./webGuard";

/**
 * 보안 (#172, review L-02): what a page may ask of the main process. Every `act` message is read here into a fresh
 * action — the right type, the right fields with the right kinds of value, no more — or refused; and each page may
 * ask only for the actions it has a button for (`pageActions`, taken from what each page's code sends; the test
 * checks the two against each other). The main process also checks that the message came from that page in a
 * window of ours (security.ts `senderPage`).
 */

/** The app's pages (renderer/<name>.html). The desk's four (settings · history · calendarWindow · help) live in its frames. */
export const pageNames = [
  "note", "popup", "floating", "settings", "history", "calendarWindow", "pet", "timer", "help", "quick", "quickMemo", "timerSheet",
  "ring", "confirm", "glance", "desk", "drawer", "handle", "ears",
] as const;
export type PageName = typeof pageNames[number];

/** The page of a file name ("note.html"), or undefined. */
export const pageOfFile = (file: string | undefined): PageName | undefined =>
  (pageNames as readonly string[]).find((name) => `${name}.html` === file) as PageName | undefined;

type ActionType = Action["type"];
const actions = <T extends ActionType>(...types: T[]): ReadonlySet<ActionType> => new Set<ActionType>(types);

/**
 * Each page's actions: what its code (and the modules it bundles) sends with `act`. A page not here sends none.
 * A new action takes three small steps (the type check and test/ipcCheck.test.ts fail until all are done):
 * 1. its type in `Action` (types.ts) and its case in main.ts `handle`;
 * 2. its fields' readers in `actionFields` below (a missing entry is a type error);
 * 3. its name in the list of each page that sends it, here.
 * A new setting a page writes: its key in that page's `pagePrefs`, and in `enumPrefs` / `prefReaders` when its value
 * is one of a few choices or has a shape (plain booleans, numbers, strings and string lists are read by kind).
 */
export const pageActions: Partial<Record<PageName, ReadonlySet<ActionType>>> = {
  note: actions(
    "aiUndo", "calendarEditEvent", "calendarNewEvent", "collapse", "copyList", "delete", "deleteSeries", "drawer", "dropAhead", "dropOnTab",
    "editingReminder", "exportList", "focus", "groupDrop", "memoRestore", "move", "moveTasks", "openCalendar", "openHelp", "openHistory",
    "openSettings", "openSpaces", "redo", "rename", "rowMenuPick", "saveSeries", "setDeadline", "setPref", "setRange", "setReminder",
    "showEventMenu", "showMenu", "showRowMenu", "showStorageProblem", "spaceAdd", "spaceLens", "timerCommand", "todoSpace", "toggle", "undo",
    "unfileCompleted", "window",
    // #168: several picked rows moved together, and put back by the toast's 되돌리기.
    "moveMany", "restoreOrder",
  ),
  settings: actions(
    "aiClearLog", "aiConnectDesktop", "aiCopyCommand", "aiEnable", "aiUndo", "alarmDelete", "alarmSave", "backupNow", "chatterPreview",
    "chooseBackupFolder", "chooseStorage", "deleteBackup", "deleteSeries", "drawer", "exportBackup", "generalRename", "importBackup",
    "openArchiveFolder", "openBackupFolder", "openDataFolder", "openHelp", "openHistory", "previewReminder", "resetBackupFolder", "resetStorage",
    "restoreBackup", "restoreSeries", "saveSeries", "setBackupAuto", "setPref", "showBackup", "snoozePeriodic", "spaceAdd", "spaceColor",
    "spaceDelete", "spaceOrder", "spaceRename", "spaceRestore", "timerCommand",
  ),
  history: actions("openArchiveFolder"),
  calendarWindow: actions("calendarShowTask", "setPref", "showEventMenu"),
  quick: actions("drawer"),
  glance: actions("calendarEditEvent", "calendarNewEvent", "drawer", "openCalendar", "openNote", "openSettings", "setPref", "spaceLens", "timerCommand", "toggle"),
  desk: actions("deskPane", "openGuide", "openSearch"),
  drawer: actions(
    "copyText", "drawerPaste", "drawerView", "drawerWrite", "editCommand", "folderAdd", "folderColor", "folderDelete", "folderDuplicate",
    "folderOrder", "folderRename", "folderRestore", "folderSort", "memoCheck", "memoClose", "memoDelete", "memoDuplicate", "memoMove",
    "memoPaper", "memoPin", "memoPinMany", "memoRestore", "memoSetText", "memoUpdate", "openHelp", "openLink", "openSettings", "setPref", "window",
    // 2A (#115 · #120): 보기 · 이 폴더, 지운 메모's 되돌리기 and 지금 모두 비우기.
    "folderView", "memoUntrash", "memoTrashEmpty",
    // 2B (#118): Ctrl+/ — the drawer's keys on a slip. (⇧M's list, the link field, the tick key and a box ticked in place
    // go through memoMove · memoUpdate · memoSetText, already here.)
    "drawerShortcuts",
  ),
};

type PrefKey = keyof Prefs;
const prefs = (...keys: PrefKey[]): ReadonlySet<PrefKey> => new Set(keys);

/** The settings each page may change with `setPref` (the settings panes nearly all; the others their own few). */
export const pagePrefs: Partial<Record<PageName, ReadonlySet<PrefKey>>> = {
  note: prefs("alwaysOnTop", "dayOpen", "guideSeen", "hideCompleted", "openAtLogin", "spaceGroups", "spaceGroupsDoneOpen", "spaceGroupsFolded", "starredTask", "textStep"),
  settings: prefs(
    "archiveAfterDays", "calendarAlertMinutes", "calendarStrip", "chatter", "chatterFrequency", "chatterQuestions", "displaySeconds", "drawerBackdrop",
    "drawerCodeFont", "drawerDoneToBottom", "drawerFont", "drawerHandle", "drawerLineHeight", "drawerNightPaper", "drawerParagraph", "drawerPinned",
    "drawerShortcut", "drawerShortcutLast", "drawerShowMarks", "drawerSide", "drawerTextPt", "drawerTheme", "drawerWidth", "dueStyle", "eveningSweep",
    "eveningSweepTime", "font", "intervalMinutes", "language", "morningPick", "noteHotkey", "noteShortcut", "openAtLogin", "paper", "petVisible",
    "petWanders", "pomodoroAutoContinue", "pomodoroFocusMinutes", "pomodoroLongRestMinutes", "pomodoroRestMinutes", "pomodoroRounds", "quickEntry",
    "quickMemo", "quickMemoClipboard", "reminderEnabled", "reminderStyle", "spaceGroupStyle", "spaceGroups", "systemNotify", "taskbarBadge",
    "textStep", "timerSize", "timerSound",
  ),
  calendarWindow: prefs("calendarView"),
  glance: prefs("petVisible"),
  drawer: prefs("drawerBackdrop", "drawerFont", "drawerPinned", "drawerShowMarks", "drawerSide", "drawerTextPt", "drawerTheme"),
};

// ─── Readers ──────────────────────────────────────────────────────────────────

/** A reader gives the value back (rebuilt, with only the fields it knows) or `bad`. */
const bad = Symbol("bad");
type Reader = (value: unknown) => unknown;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const test = (ok: (value: unknown) => boolean): Reader => (value) => (ok(value) ? value : bad);
const optional = (read: Reader): Reader => (value) => (value === undefined ? undefined : read(value));
const nullable = (read: Reader): Reader => (value) => (value === null ? null : read(value));
const str = (max: number, min = 0): Reader => test((value) => typeof value === "string" && value.length >= min && value.length <= max);
const pattern = (shape: RegExp): Reader => test((value) => typeof value === "string" && shape.test(value));
const bool = test((value) => typeof value === "boolean");
const num = (min: number, max: number): Reader => test((value) => typeof value === "number" && Number.isFinite(value) && value >= min && value <= max);
const int = (min: number, max: number): Reader => test((value) => Number.isInteger(value) && (value as number) >= min && (value as number) <= max);
const oneOf = (...values: readonly unknown[]): Reader => test((value) => values.includes(value));
const list = (read: Reader, max: number): Reader => (value) => {
  if (!Array.isArray(value) || value.length > max) return bad;
  const out: unknown[] = [];
  for (const entry of value) { const read1 = read(entry); if (read1 === bad) return bad; out.push(read1); }
  return out;
};
const shape = (fields: Record<string, Reader>): Reader => (value) => {
  if (!isObject(value)) return bad;
  const out: Record<string, unknown> = {};
  for (const [key, read] of Object.entries(fields)) {
    const field = read(value[key]);
    if (field === bad) return bad;
    if (field !== undefined) out[key] = field;
  }
  return out;
};
/** One of several shapes, told apart by `key` ("kind", "op"). */
const variants = (key: string, cases: Record<string, Record<string, Reader>>): Reader => (value) => {
  if (!isObject(value) || typeof value[key] !== "string" || !Object.hasOwn(cases, value[key] as string)) return bad;
  return shape({ [key]: test(() => true), ...cases[value[key] as string] })(value);
};

// The sizes: ids and names are short; a memo or a copied text may be long, but not without end.
const id = str(200);
const ids = list(id, 20_000);
/** #168: the rows picked together in the note (each an id string; far more than anyone picks by hand). */
const picked = list(id, 5_000);
const name = str(500);
const title = str(10_000);
const longText = str(2_000_000);
const day = pattern(/^\d{4}-\d{2}-\d{2}$/);
const time = pattern(/^\d{2}:\d{2}$/);
const iso = str(64);
const point = num(-1_000_000, 1_000_000);
const minutes = num(-100_000, 100_000);

const repeatRule = shape({ kind: oneOf("daily", "weekdays", "weekly", "monthly"), weekdays: optional(list(int(0, 6), 7)), monthDay: optional(int(1, 31)) });
const series = shape({ id, title, rule: repeatRule, remindAt: optional(time), createdAt: iso, lastPlaced: optional(str(64)) });
const aheadTarget = variants("kind", { day: { day }, someday: {}, today: {} });
const timerCommand = variants("kind", {
  countdown: { minutes: num(0, 100_000) }, pomodoro: {}, togglePause: {}, addMinutes: { minutes: num(-100_000, 100_000) }, stop: {},
});
const focusCommand = variants("kind", {
  start: { taskId: optional(id), title: optional(title), minutes: optional(num(0, 100_000)), pomodoro: optional(bool) },
  done: {}, more: {}, later: {}, rest: {}, nextRound: {}, askStop: {}, custom: { taskId: id },
});
const alarm: Reader = (value) => readAlarm(value) ?? bad;

/** Every action's fields (a new Action type without its reader here is a type error). */
const actionFields: { [K in ActionType]: Record<string, Reader> } = {
  openDataFolder: {}, chatterPreview: {},
  add: { title, reminderAt: optional(iso), dueDate: optional(str(10)) },
  rename: { id, title }, toggle: { id }, delete: { id },
  move: { id, targetID: id, after: optional(bool) },
  clearCompleted: {}, unfileCompleted: {}, undo: {}, redo: {},
  setReminder: { id, at: optional(iso) },
  setRange: { id, start: optional(minutes), end: optional(minutes) },
  saveSeries: { taskID: optional(id), seriesID: optional(id), title: optional(title), rule: repeatRule, remindAt: optional(time), space: optional(nullable(id)) },
  deleteSeries: { id },
  restoreSeries: { series, todos: ids },
  setDeadline: { id, dueDate: optional(str(10)), keepOnToday: optional(bool) },
  moveToLater: { id },
  moveTasks: { ids, target: variants("kind", { day: { day }, someday: {} }) },
  dropOnTab: { id, tab: oneOf("today", "ahead", "memos") },
  dropAhead: { id, target: aheadTarget, near: optional(shape({ id, after: optional(bool) })) },
  chooseStorage: {}, resetStorage: {},
  memoUpdate: { id, text: longText, from: optional(longText) },
  memoDelete: { id }, memoClose: { id }, memoRestore: {},
  memoUntrash: { id }, memoTrashEmpty: {},
  drawerShortcuts: {},
  editingReminder: { id: optional(id) },
  // The key and its value are checked together (readPref) in readAction.
  setPref: { key: str(64), value: test(() => true) },
  collapse: { anchor: optional(shape({ x: point, y: point })) },
  openSettings: { tab: optional(oneOf("calendar", "clock", "events", "storage", "drawer", "spaces", "ai")) },
  aiEnable: { on: bool }, aiUndo: { id }, aiConnectDesktop: {}, aiCopyCommand: {}, aiClearLog: {},
  openHistory: { day: optional(day) }, openSearch: {},
  openHelp: { topic: optional(str(200)) },
  deskPane: { pane: oneOf(...deskPanes) },
  openGuide: {}, openArchiveFolder: {}, previewReminder: {},
  snoozePeriodic: { minutes: int(1, 24 * 60) },
  copyList: {}, exportList: {},
  showMenu: { menu: oneOf("more"), x: point, y: point },
  showRowMenu: { id, x: optional(point), y: optional(point), keyboard: optional(bool) },
  rowMenuPick: { pick: int(0, 10_000) },
  timerCommand: { command: timerCommand },
  focus: { command: focusCommand },
  window: { command: oneOf("minimize", "close", "quit") },
  calendarNewEvent: { at: optional(shape({ day, minutes: num(0, 24 * 60) })) },
  calendarEditEvent: { key: str(500) },
  showEventMenu: { key: str(500), x: optional(point), y: optional(point) },
  openCalendar: { day: optional(day) },
  openNote: {}, exportBackup: {}, importBackup: {},
  setBackupAuto: { on: bool }, backupNow: {}, chooseBackupFolder: {}, resetBackupFolder: {}, openBackupFolder: {},
  restoreBackup: { name: str(255, 1) }, showBackup: { name: str(255, 1) }, deleteBackup: { name: str(255, 1) },
  calendarShowTask: { id },
  quickEvent: { title, reminderAt: optional(iso), dueDate: optional(str(10)) },
  alarmSave: { alarm },
  alarmDelete: { id },
  showStorageProblem: {},
  drawer: { command: oneOf("open", "close", "toggle"), memo: optional(id), write: optional(bool) },
  folderAdd: { id, name, color: str(40) }, folderRename: { id, name }, folderColor: { id, color: str(40) }, folderDelete: { id },
  folderRestore: { id, memos: ids }, folderOrder: { ids },
  memoMove: { id, folder: id }, memoPin: { id, pinned: bool }, memoCheck: { id, line: int(0, 10_000_000) },
  drawerWrite: { text: longText, view: id }, drawerView: { view: id },
  folderSort: { id, sort: oneOf(...folderSorts) }, folderView: { id, view: oneOf(...folderViews) }, folderDuplicate: { id, newID: id },
  memoPaper: { id, paper: optional(oneOf(...memoPapers)) },
  memoPinMany: { ids, pinned: bool }, memoSetText: { id, text: longText }, memoDuplicate: { id },
  drawerPaste: { view: id },
  openLink: { url: str(4096) },
  editCommand: { command: oneOf("cut", "copy", "paste", "selectAll") },
  spaceAdd: { id, name, color: optional(nullable(str(40))), todo: optional(id) },
  spaceRename: { id, name }, generalRename: { name }, spaceColor: { id, color: str(40) }, spaceDelete: { id },
  spaceRestore: { id, todos: ids }, spaceOrder: { ids },
  todoSpace: { ids, space: nullable(id) },
  groupDrop: { id, space: nullable(id), targetID: optional(id), after: optional(bool), ids: optional(picked) },
  // #168: several picked rows put together next to a row, and that put back (`previous`: the whole list's order before).
  moveMany: { ids: picked, targetID: id, after: bool },
  restoreOrder: { ids: picked, previous: ids },
  spaceLens: { space: optional(id) },
  openSpaces: {},
  copyText: { text: longText },
};

/** The settings a page may write, and how each value must look (the same rules `loadSettings` reads them with). */
const enumPrefs: Partial<Record<PrefKey, readonly unknown[]>> = {
  language: ["auto", "ko", "en", "nl"], paper: paperSettings, font: ["pen", "brush", "clean"], textSize: textSizes,
  reminderStyle: ["compact", "paper", "character"], archiveAfterDays: [0, 1, 3, 7], dueStyle: ["dday", "date"], timerSize: timerSizes,
  chatterFrequency: ["rare", "normal", "often"], calendarAlertMinutes: [0, 5, 10, 15, 30], calendarView: ["month", "week"],
  systemNotify: ["missed", "always", "off"], drawerSide: ["right", "left"], drawerTheme: drawerThemes, drawerBackdrop: drawerBackdrops,
  drawerPinnedSort: folderSorts, drawerPinnedView: folderViews, drawerFont: drawerFonts, drawerTextSize: drawerTextSizes, drawerLineHeight: lineSpacings,
  drawerParagraph: paragraphSpacings, drawerCodeFont: codeFonts, spaceGroupStyle: ["card", "bookmark"],
  textStep: noteScales.map((_, index) => index), drawerTextPt: drawerPoints,
};
const prefReaders: Partial<Record<PrefKey, Reader>> = {
  drawerShortcut: pattern(/^[A-Za-z0-9+`\-=[\]\\;',./]{0,64}$/), drawerShortcutLast: pattern(/^[A-Za-z0-9+`\-=[\]\\;',./]{0,64}$/),
  noteShortcut: pattern(/^[A-Za-z0-9+`\-=[\]\\;',./]{0,64}$/),
  eveningSweepTime: time, drawerWidth: num(100, 2000), drawerHandleY: num(0, 1), drawerNightPaper: bool,
  dayOpen: test((value) => value === "" || (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value))),
  timerRecent: list(num(0, 100_000), 50), quickMemoDraft: str(100_000),
  // Not written by any page: the main process keeps these itself.
  spaceLens: () => bad, intentPrefer: () => bad, intentLearning: () => bad,
};

/** A setting's value as a page sent it, checked; `bad` when it isn't one this setting can hold. */
function readPref(key: string, value: unknown): unknown {
  if (!Object.hasOwn(defaultPrefs, key) && key !== "drawerNightPaper") return bad;
  const prefKey = key as PrefKey;
  const choices = enumPrefs[prefKey];
  if (choices) return choices.includes(value) ? value : bad;
  const reader = prefReaders[prefKey];
  if (reader) return reader(value);
  const fallback = defaultPrefs[prefKey];
  if (typeof fallback === "boolean") return bool(value);
  if (typeof fallback === "number") return num(0, 1_000_000)(value);
  if (typeof fallback === "string") return str(10_000)(value);
  if (Array.isArray(fallback)) return list(str(200), 1_000)(value);
  return bad;
}

/** An `act` message read into an action (fresh, only its own fields), or undefined when it isn't one. */
export function readAction(value: unknown): Action | undefined {
  if (!isObject(value) || typeof value.type !== "string" || !Object.hasOwn(actionFields, value.type)) return undefined;
  const type = value.type as ActionType;
  const read = shape({ type: test(() => true), ...actionFields[type] })(value);
  if (read === bad) return undefined;
  if (type === "setPref") {
    const fields = read as { key: string; value: unknown };
    const checked = readPref(fields.key, fields.value);
    if (checked === bad) return undefined;
    return { type, key: fields.key as PrefKey, value: checked as Prefs[PrefKey] };
  }
  return read as Action;
}

/** Whether `page` may ask for `action` (and, for `setPref`, change that setting). */
export function mayAct(page: PageName, action: Action): boolean {
  if (!pageActions[page]?.has(action.type)) return false;
  if (action.type === "setPref") return Boolean(pagePrefs[page]?.has(action.key));
  return true;
}

// ─── The other invoke channels ────────────────────────────────────────────────

/** Which pages may use the main process's other questions (state, history, the event sheet, the input line, search). */
export const pageChannels: Record<string, ReadonlySet<PageName>> = {
  "state:get": new Set(pageNames),
  "history:get": new Set<PageName>(["history"]),
  "calendar:write": new Set<PageName>(["note", "calendarWindow"]),
  intent: new Set<PageName>(["note", "quick", "glance"]),
  search: new Set<PageName>(["note"]),
};

const wireCandidate = variants("kind", {
  todo: { title, reminderAt: optional(iso), dueDate: optional(str(10)), range: optional(shape({ day, start: minutes, end: minutes })) },
  event: { title, day, start: minutes, end: minutes, allDay: bool, repeat: optional(oneOf("daily", "weekly", "monthly")) },
  timer: { minutes: num(0, 100_000), title: optional(title) },
  alarm: { time, days: list(int(0, 6), 7), label: str(1_000) },
  memo: { text: longText },
  repeat: { title, rule: repeatRule, time: optional(time) },
});
const intentKind = oneOf("todo", "event", "timer", "alarm", "memo", "repeat");
const intentRequest = variants("op", {
  commit: {
    candidate: wireCandidate, page: oneOf("today", "ahead", "memos"), from: oneOf("note", "quick", "glance"),
    candidates: optional(list(wireCandidate, 50)), text: optional(longText),
    space: optional(variants("kind", { space: { id }, new: { name }, none: {} })),
  },
  undo: { made: shape({ kind: intentKind, id: optional(id), space: optional(id) }) },
  learn: { key: optional(str(200)), from: intentKind, to: intentKind },
});

/** An input-line request (`intent`), read like an action; undefined when it isn't one. */
export function readIntentRequest(value: unknown): IntentRequest | undefined {
  const read = intentRequest(value);
  return read === bad ? undefined : read as IntentRequest;
}

const calendarDraft = shape({
  title, color: str(40), date: day, allDay: bool, days: num(0, 3_660), startMinutes: num(0, 24 * 60), endMinutes: num(0, 24 * 60),
  repeat: oneOf("none", "daily", "weekly", "monthly", "yearly"), location: optional(str(1_000)), taskId: optional(id),
});
const calendarRequest = shape({ kind: oneOf("create", "update", "delete", "skip"), draft: optional(calendarDraft), id: optional(id), day: optional(day) });

/** The event sheet's request (`calendar:write`), read like an action; undefined when it isn't one. */
export function readCalendarRequest(value: unknown): CalendarWriteRequest | undefined {
  const read = calendarRequest(value);
  return read === bad ? undefined : read as CalendarWriteRequest;
}

// ─── Who sent it ──────────────────────────────────────────────────────────────

/** What the main process knows about a message's sender (security.ts reads it off the event). */
export interface SenderFacts {
  /** The sending frame's URL. */
  frameUrl: string;
  /** The frame is its window's own page (the main frame). */
  isMainFrame: boolean;
  /** The frame sits right inside its window's main frame (one of the desk's panes). */
  parentIsMain: boolean;
  /** The window's main frame's URL. */
  topUrl: string;
  /** The web contents belongs to one of the app's windows. */
  ourWindow: boolean;
}

/**
 * The page a message came from, or undefined: one of the app's pages from its own folder, in a window of ours — a
 * window's page in its main frame, or one of the desk's four panes in a frame right inside the desk's page.
 */
export function senderPageOf(facts: SenderFacts, rendererUrl: string): PageName | undefined {
  if (!facts.ourWindow) return undefined;
  const file = ownPage(facts.frameUrl, rendererUrl);
  const page = pageOfFile(file);
  if (!page || !file) return undefined;
  if (deskFramePages.includes(file)) return !facts.isMainFrame && facts.parentIsMain && ownPage(facts.topUrl, rendererUrl) === "desk.html" ? page : undefined;
  return facts.isMainFrame ? page : undefined;
}
