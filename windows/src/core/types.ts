import type { TimerSize } from "./timerWidget";
import type { ChatterFrequency } from "./chatter";
import type { ArchiveAfterDays } from "./archive";
import type { TodoItem } from "./notebook";
import type { DueStyle } from "./deadline";
import type { Memo } from "./memo";
import type { PomodoroSettings, TimerCommand } from "./focusTimer";
import type { RepeatRule, Series } from "./repeat";
import type { NoteTab } from "./shelf";
import type { CalendarView } from "./calendar";
import type { LocalEvent } from "./events";
import type { Lang, LanguageSetting } from "./lang";
import type { Alarm } from "./alarm";
import type { IntentKind, IntentPrefer } from "./intent";
import type { AheadTarget } from "./ahead";
import type { DeskPane, PaperSetting } from "./desk";
import type { DrawerBackdrop, DrawerSide, DrawerTheme, FolderSort, MemoFolders, MemoPaper } from "./memoDrawer";
import type { SpaceChoice, SpaceLens, TodoSpaces } from "./todoSpaces";

export type NotebookFont = "pen" | "brush" | "clean";
export type TextSize = "small" | "regular" | "large" | "extraLarge";
export type ReminderStyle = "compact" | "paper" | "character";

export interface Prefs {
  /** The app's language: "auto" (the system's, see resolveLang) or ko · en · nl. Changing it restarts the app. */
  language: LanguageSetting;
  /** 종이 색: 자동 (the system's light or dark) · 낮 · 밤 — every window follows it at once. */
  paper: PaperSetting;
  font: NotebookFont;
  textSize: TextSize;
  reminderStyle: ReminderStyle;
  hideCompleted: boolean;
  alwaysOnTop: boolean;
  reminderEnabled: boolean;
  intervalMinutes: number;
  displaySeconds: number;
  openAtLogin: boolean;
  archiveAfterDays: ArchiveAfterDays;
  dueStyle: DueStyle;
  /** 종이냥 on the floor above the taskbar. The focus timer has its own board and does not depend on it. */
  petVisible: boolean;
  petWanders: boolean;
  pomodoroFocusMinutes: number;
  pomodoroRestMinutes: number;
  pomodoroLongRestMinutes: number;
  pomodoroRounds: number;
  pomodoroAutoContinue: boolean;
  timerSound: boolean;
  /** How big the floating timer is drawn. */
  timerSize: TimerSize;
  /** The custom timer lengths started last (minutes, newest first, at most three, never 5 · 15 · 25 · 50). */
  timerRecent: number[];
  /** The first-launch guide has been seen (or skipped); ⋯ → 사용 안내 shows it again. */
  guideSeen: boolean;
  /** Ctrl+Alt+N anywhere opens the small quick-entry window. */
  quickEntry: boolean;
  /** Ctrl+Alt+M anywhere opens 빠른 메모. */
  quickMemo: boolean;
  /** 빠른 메모's text not yet added (Esc keeps it, even across a restart). */
  quickMemoDraft: string;
  /** Alarm rings this device has handled ("<id>@<yyyy-MM-ddTHH:mm>", see alarm.ts), kept for three days. */
  alarmHandled: string[];
  /** The Monday (day key) of the last week the pet looked back on; once a week, Sunday evening. */
  lookbackWeek: string;
  /** Task alerts this device has shown ("id@seconds", see due.ts), kept for two days. */
  shownReminders: string[];
  /** 종이냥 한마디 (see chatter.ts): now and then the cat says something, sometimes asks. */
  chatter: boolean;
  chatterFrequency: ChatterFrequency;
  chatterQuestions: boolean;
  /** The last lines said, so they don't come round again too soon. */
  chatterRecent: string[];
  /** The day the cat last cheered a streak (7 · 30 · 100 days), as a day key: once that day (#42). */
  chatterMilestoneDay: string;
  /** 일정: today's events above today's tasks (when there are events). */
  calendarStrip: boolean;
  /** Minutes before an event its alert comes up; 0 turns them off. */
  calendarAlertMinutes: CalendarAlertMinutes;
  /** Event alerts this device has shown ("local/<id>@<day>@seconds"), kept for two days. */
  calendarAlertsShown: string[];
  /** The 달력 window shows a month or a week. */
  calendarView: "month" | "week";
  /** The colour the last new event took ("" for none yet: blue). */
  calendarLastColor: string;
  /** 하루 띠 (1.25): the day ("yyyy-MM-dd", 4 a.m. rule) whose strip is opened into the whole day; "" = closed. The next day starts closed again. */
  dayOpen: string;
  /** 입력 줄: the kinds learned from 바꾸기 (a title's first word → the kind it goes first as), at most 200. */
  intentPrefer: IntentPrefer;
  /** 입력 줄: switches made once (not yet a preference), and the keys oldest first (see intent.ts learnSwitch). */
  intentLearning: { streak: Record<string, { kind: IntentKind; count: number }>; order: string[] };
  /** 저녁 정리: at `eveningSweepTime` the cat offers to move what is left to tomorrow or 언젠가 (see sweep.ts). */
  eveningSweep: boolean;
  eveningSweepTime: string;
  /** The logical day ("yyyy-MM-dd") the evening sweep last came for. */
  sweepShown: string;
  /** 오늘 꼭 하나: the first time the note opens on a new day, the empty line asks for the one thing. */
  morningPick: boolean;
  /** The day the morning question was last asked, and the task picked that day (its star goes at the day's end). */
  morningPickDay: string;
  starredTask: string;
  /** 시스템 알림으로도 보내기: "missed" when a reminder or alarm couldn't be shown here, "always", or "off" (see notify.ts). */
  systemNotify: SystemNotify;
  /** Ctrl+Alt+J anywhere shows or hides the note. */
  noteHotkey: boolean;
  /** 빠른 메모를 열 때 복사한 글 넣기. */
  quickMemoClipboard: boolean;
  /** 작업 표시줄에 남은 개수: the taskbar button's small badge (Windows). */
  taskbarBadge: boolean;
  /** Launches by hand (not at sign-in), for the cat's one-time question about opening with the computer. */
  manualLaunches: number;
  loginAsked: boolean;
  /** AI 연결 (1.27): Claude may read and write the list through 종이냥 for Claude (written to ai-link.json). */
  aiEnabled: boolean;
  /** The last ai-log.jsonl entry dealt with ("seen until"): later ones are new (a toast, or 자리 비운 사이 at launch). */
  aiSeenId: string;
  aiSeenAt: string;
  /** When the cat last said something about Claude (ms; at most once in two hours). */
  aiCatSaid: number;
  /** 메모 서랍 (1.28), this device's: the shortcut (an Electron accelerator; "" = off), the side, the width (260–480),
   *  the edge handle and its place (0 top … 1 bottom of the work area), the look, the last folder shown, 위에 고정. */
  drawerShortcut: string;
  /** The key the drawer had when its switch was turned off (#27): turning it on brings that key back. */
  drawerShortcutLast: string;
  drawerSide: DrawerSide;
  drawerWidth: number;
  drawerHandle: boolean;
  drawerHandleY: number;
  drawerTheme: DrawerTheme;
  drawerLastFolder: string;
  drawerPinned: boolean;
  /** 1.28: the one-time slip saying the memo tab's memos are in the drawer was dealt with on this device (M1–M3). */
  drawerMoveNoticeShown: boolean;
  /** 1.29: the drawer's 바탕 (불투명 · 반투명 · 강하게 · 바탕 없음), the 고정 bookmark's 정렬 (고정 isn't a folder), and the
   *  last two folders a memo was moved to (폴더로 옮기기 ▸ 최근), newest first. */
  drawerBackdrop: DrawerBackdrop;
  drawerPinnedSort: FolderSort;
  drawerRecentMoves: string[];
  /** 할 일 스페이스 (1.30), this device's: the space 오늘 shows alone and the logical day it was picked (none: all). */
  spaceLens: SpaceLens | null;
}

export type SystemNotify = "missed" | "always" | "off";

export type CalendarAlertMinutes = 0 | 5 | 10 | 15 | 30;
export const calendarAlertChoices: { value: CalendarAlertMinutes; title: string }[] = [
  { value: 0, title: "끔" }, { value: 5, title: "5분 전" }, { value: 10, title: "10분 전" }, { value: 15, title: "15분 전" }, { value: 30, title: "30분 전" },
];
/** The event alert choices in a language: en "Off", "5 min before"…; nl "Uit", "5 min van tevoren"…. */
export function calendarAlertChoicesIn(lang: Lang = "ko"): { value: CalendarAlertMinutes; title: string }[] {
  if (lang === "ko") return calendarAlertChoices;
  return calendarAlertChoices.map(({ value }) => ({
    value, title: value === 0 ? (lang === "en" ? "Off" : "Uit") : lang === "en" ? `${value} min before` : `${value} min van tevoren`,
  }));
}

export const defaultPrefs: Prefs = {
  language: "auto",
  paper: "auto",
  font: "pen",
  textSize: "regular",
  reminderStyle: "paper",
  hideCompleted: false,
  alwaysOnTop: false,
  reminderEnabled: true,
  intervalMinutes: 30,
  displaySeconds: 15,
  openAtLogin: false,
  archiveAfterDays: 1,
  dueStyle: "dday",
  petVisible: true,
  petWanders: true,
  pomodoroFocusMinutes: 25,
  pomodoroRestMinutes: 5,
  pomodoroLongRestMinutes: 15,
  pomodoroRounds: 4,
  pomodoroAutoContinue: true,
  timerSound: true,
  timerSize: "regular",
  timerRecent: [],
  guideSeen: false,
  quickEntry: true,
  quickMemo: true,
  quickMemoDraft: "",
  alarmHandled: [],
  lookbackWeek: "",
  shownReminders: [],
  chatter: true,
  chatterFrequency: "normal",
  chatterQuestions: true,
  chatterRecent: [],
  chatterMilestoneDay: "",
  calendarStrip: true,
  calendarAlertMinutes: 10,
  calendarAlertsShown: [],
  calendarView: "month",
  calendarLastColor: "",
  dayOpen: "",
  intentPrefer: {},
  intentLearning: { streak: {}, order: [] },
  eveningSweep: true,
  eveningSweepTime: "20:00",
  sweepShown: "",
  morningPick: false,
  morningPickDay: "",
  starredTask: "",
  systemNotify: "missed",
  noteHotkey: true,
  quickMemoClipboard: false,
  taskbarBadge: false,
  manualLaunches: 0,
  loginAsked: false,
  aiEnabled: false,
  aiSeenId: "",
  aiSeenAt: "",
  aiCatSaid: 0,
  drawerShortcut: "Control+Shift+D",
  drawerShortcutLast: "Control+Shift+D",
  drawerSide: "right",
  drawerWidth: 300,
  drawerHandle: true,
  drawerHandleY: 0.42,
  drawerTheme: "auto",
  drawerLastFolder: "",
  drawerPinned: true,
  drawerMoveNoticeShown: false,
  drawerBackdrop: "solid",
  drawerPinnedSort: "edited",
  drawerRecentMoves: [],
  spaceLens: null,
}

export function pomodoroSettings(prefs: Prefs): PomodoroSettings {
  return {
    focusMinutes: prefs.pomodoroFocusMinutes,
    restMinutes: prefs.pomodoroRestMinutes,
    longRestMinutes: prefs.pomodoroLongRestMinutes,
    roundsBeforeLongRest: prefs.pomodoroRounds,
  };
}

export const textSizes: TextSize[] = ["small", "regular", "large", "extraLarge"];
export const textSizeTitles: Record<Lang, Record<TextSize, string>> = {
  ko: { small: "작게", regular: "보통", large: "크게", extraLarge: "아주 크게" },
  en: { small: "Small", regular: "Regular", large: "Large", extraLarge: "Extra large" },
  nl: { small: "Klein", regular: "Normaal", large: "Groot", extraLarge: "Extra groot" },
};
export const textSizeTitle: Record<TextSize, string> = textSizeTitles.ko;
export const textScale: Record<TextSize, number> = { small: 0.87, regular: 1, large: 1.13, extraLarge: 1.26 };
export const fontTitles: Record<Lang, Record<NotebookFont, string>> = {
  ko: { pen: "손글씨 펜", brush: "손글씨 붓", clean: "기본 글씨" },
  en: { pen: "Pen", brush: "Marker", clean: "Clean" },
  nl: { pen: "Pen", brush: "Stift", clean: "Strak" },
};
export const fontTitle: Record<NotebookFont, string> = fontTitles.ko;
export const baseFontSize: Record<NotebookFont, number> = { pen: 23, brush: 22, clean: 15 };
export const styleTitles: Record<Lang, Record<ReminderStyle, string>> = {
  ko: { compact: "미니", paper: "쪽지", character: "친구" },
  en: { compact: "Mini", paper: "Slip", character: "Friend" },
  nl: { compact: "Mini", paper: "Briefje", character: "Vriendje" },
};
export const styleTitle: Record<ReminderStyle, string> = styleTitles.ko;
export const styleDetails: Record<Lang, Record<ReminderStyle, string>> = {
  ko: {
    compact: "캐릭터 없이, 할 일만 작게",
    paper: "작은 친구가 건네는 알림 쪽지",
    character: "옆에서 인사하는 친구와 말풍선",
  },
  en: {
    compact: "Just the to-do, small, no character",
    paper: "A little friend hands you a reminder note",
    character: "A friend says hi beside you, with a speech bubble",
  },
  nl: {
    compact: "Alleen de taak, klein, zonder figuurtje",
    paper: "Een vriendje geeft je een herinneringsbriefje",
    character: "Een vriendje zegt hallo naast je, met een tekstballon",
  },
};
export const styleDetail: Record<ReminderStyle, string> = styleDetails.ko;

export function bodyFontSize(font: NotebookFont, size: TextSize): number {
  return Math.round(baseFontSize[font] * textScale[size]);
}

/** Everything a window needs to draw itself; sent from the main process on every change. */
export interface AppState {
  items: TodoItem[];
  canUndo: boolean;
  canRedo: boolean;
  prefs: Prefs;
  nextPeriodicDue?: number;
  storageError?: string;
  editingReminderID?: string;
  series: Series[];
  memos: Memo[];
  lastDeletedMemo?: boolean;
  /** Why Ctrl+Alt+N could not be registered (another app holds it), shown under the toggle. */
  shortcutProblem?: string;
  /** The same for Ctrl+Alt+M (빠른 메모). */
  memoShortcutProblem?: string;
  /** The same for Ctrl+Alt+J (노트 보이기 · 숨기기). */
  noteShortcutProblem?: string;
  /** The same for 메모 서랍's shortcut. */
  drawerShortcutProblem?: string;
  /** 반투명 · 강하게 drawn as 불투명 on this PC, and why (Windows 10, transparency effects off); none when they work. */
  drawerBackdropNote?: string;
  /** 메모 서랍: the folders and each memo's place (memo-folders.json). */
  memoFolders: MemoFolders;
  /** 할 일 스페이스: the spaces (todo-spaces.json; `items` left empty here — see spaceOf). */
  todoSpaces: TodoSpaces;
  /** Each to-do's live space: `<todo id>\t<space id>` lines (packSpaceOf; read with spaceIndexOf). */
  spaceOf: string;
  /** Where the list lives: "이 PC (기본)" or the shared folder (home shortened to ~). */
  /** Where everything is kept: the folder (todos, memos, repeats) and its archive folder for the record. */
  /** `home`: the home folder, said as ~ in the storage pane (1.30). */
  storage: { label: string; custom: boolean; path: string; archivePath: string; home: string };
  /** 일정: today's strip (worked out again every minute) and the tasks put in the calendar. */
  calendar: CalendarView;
  /** Every event kept in events.json (the 달력 window spreads them over the days it shows). */
  events: LocalEvent[];
  /** 시계 알람 (alarms.json). */
  alarms: Alarm[];
  /** The focus timer, while one is on (the 오늘 창's card counts down from it). */
  timer?: TimerView;
  /** 집중: a focus session on a task, while one is on (the note turns into the focus card). */
  focus?: FocusView;
  /** AI 연결: on or off, the rows Claude touched today, its recent work, the Claude Code command. */
  ai: AiView;
}

/** One entry of 설정 › AI 연결 › 최근 AI 작업: when, what (the toast's words), and whether it was undone. */
export interface AiRecent { id: string; day: "today" | "yesterday"; time: string; text: string; undone: boolean }

export interface AiView {
  enabled: boolean;
  /** Ids of the to-dos and events Claude added or changed today and nobody changed since (the small stamp). */
  marks: string[];
  recent: AiRecent[];
  /** The line to paste into a terminal for Claude Code. */
  command: string;
  /** The command was copied a moment ago (the button says so). */
  copied: boolean;
  /** How the last 되돌리기 went (shown under its entry for a few seconds). */
  undoNote?: { id: string; text: string };
}

/** A running (`endsAt`) or paused (`pausedRemainingMs`) timer, and its caption ("집중 1/4", "타이머"). */
export interface TimerView {
  endsAt?: number; pausedRemainingMs?: number; caption: string;
  /** A one-off countdown (not a pomodoro). */
  countdown: boolean;
  /** The phase's whole length (the focus card's ring). */
  durationMs: number;
}

/**
 * Where a focus session stands: the time running; the time up (a countdown or a Pomodoro round
 * finished, waiting for 다 했어요 · 5분 더 · 다음에 — or a break); a Pomodoro break running; the break over
 * (waiting for 다음 라운드 · 그만하기).
 */
export type FocusStage = "running" | "timeUp" | "break" | "breakOver";

/** 집중 as the note draws it. */
export interface FocusView {
  taskId?: string;
  title: string;
  stage: FocusStage;
  /** The focus length that ran (minutes), for "25분 다 됐어요". */
  minutes: number;
  /** A Pomodoro: rounds finished in this cycle, out of how many; and the next break's length. */
  pomodoro?: { done: number; total: number; breakMinutes: number };
  /** When the session began (ms), for the cat's nod every five minutes. */
  startedAt: number;
}

/** What the focus card, the menus and the line ask the focus timer to do. */
export type FocusCommand =
  /** A task (or a title to find or make one), for `minutes` or as a Pomodoro. */
  | { kind: "start"; taskId?: string; title?: string; minutes?: number; pomodoro?: boolean }
  | { kind: "done" }
  | { kind: "more" }
  | { kind: "later" }
  | { kind: "rest" }
  | { kind: "nextRound" }
  /** Esc or × on the card: the confirm slip first, then like 다음에. */
  | { kind: "askStop" }
  /** 직접 정하기… for a task: the timer sheet, then a focus of that length. */
  | { kind: "custom"; taskId: string };

/** A parsed date or time that goes with a new task (see quickParse.ts). */
export interface ParsedWhen {
  reminderAt?: string;
  dueDate?: string;
}

/**
 * A toast on the note for something done elsewhere (a menu, a bubble, the cat, Claude): its words and how its
 * 되돌리기 undoes it — "history" (Ctrl+Z), "memo" (지운 메모 되돌리기), "unfile" (완료한 일 정리 taken back),
 * "ai" (Claude's entry `entry`), "spaces" (to-dos back in their spaces: `entry` is [id, space | null][] as JSON); or `show`: a 보기 that opens 설정 › AI 연결 (자리 비운 사이).
 */
export interface NoteNotice { icon: string; text: string; undo?: "history" | "memo" | "unfile" | "ai" | "spaces"; entry?: string; /** 보기 → 설정 › AI 연결, or 열기 → the drawer on memo `entry`. */ show?: "ai" | "drawer"; /** A sentence (AI 연결's): up to two lines, a little longer up. */ long?: boolean }

export interface PopupTask {
  id: string;
  title: string;
  scheduledAt?: string;
  /** Event alerts: when it ends and where. */
  endsAt?: string;
  location?: string;
}

/** Where a line was typed: the note's page (a to-do goes to that page's default), or 빠른 입력 and the 오늘 창 (today). */
export type IntentPage = "today" | "ahead" | "memos";
/** A reading as it crosses to the main process (dates as ISO strings). */
export type WireCandidate =
  | { kind: "todo"; title: string; reminderAt?: string; dueDate?: string; range?: { day: string; start: number; end: number } }
  | { kind: "event"; title: string; day: string; start: number; end: number; allDay: boolean; repeat?: "daily" | "weekly" | "monthly" }
  | { kind: "timer"; minutes: number; title?: string }
  | { kind: "alarm"; time: string; days: number[]; label: string }
  | { kind: "memo"; text: string }
  | { kind: "repeat"; title: string; rule: RepeatRule; time?: string };
/** What putting a reading in made: its kind and the id of what was made (none for a timer). */
export interface IntentMade { kind: IntentKind; id?: string; /** A space made with it (`#세탁`): taken back with it. */ space?: string }
export type IntentRequest =
  | { op: "commit"; candidate: WireCandidate; page: IntentPage; from: "note" | "quick" | "glance"; candidates?: WireCandidate[]; text?: string; /** A to-do's space (`#회사`, the lens). */ space?: SpaceChoice }
  | { op: "undo"; made: IntentMade }
  | { op: "learn"; key?: string; from: IntentKind; to: IntentKind };
export interface IntentResult { made?: IntentMade; error?: string; /** 빠른 입력: the note is up and shows the toast itself. */ inNote?: boolean }
/** The note shows the toast for a line put in from 빠른 입력. */
export interface IntentToast { made: IntentMade; candidates: WireCandidate[]; index: number; text: string; space?: SpaceChoice }

export interface PopupPayload {
  tasks: PopupTask[];
  scheduled: boolean;
  preview: boolean;
  canComplete: boolean;
  style: ReminderStyle;
  font: NotebookFont;
  durationMs: number;
  snoozeEnabled: boolean;
  reduceMotion: boolean;
  travel: number;
  /** Event alerts: a calendar icon instead of the check circle; the title opens the 달력 on that day. */
  calendarEvents?: boolean;
  /** The ⌄ menu's choices (5분 · 10분 · 30분 · 1시간 뒤 · 오늘 저녁 7시 · 내일 아침 9시 · 내일로 미루기); see snooze.ts. */
  snoozeChoices?: { id: string; title: string; at?: string }[];
  /** A task's alert: 내일로 in the footer (the task moves to tomorrow). */
  tomorrow?: boolean;
  /** An event's alert: 5분 전에 다시 while that is still ahead. */
  eventAgain?: boolean;
  /** 저녁 정리 (or its morning version): the cat's question and the tasks, each one ticked to go along. */
  sweep?: { variant: "evening" | "morning"; message: string };
}

export type Action =
  | { type: "openDataFolder" }
  | { type: "chatterPreview" }
  | ({ type: "add"; title: string } & ParsedWhen)
  | { type: "rename"; id: string; title: string }
  | { type: "toggle"; id: string }
  | { type: "delete"; id: string }
  | { type: "move"; id: string; targetID: string; after: boolean }
  | { type: "clearCompleted" }
  /** 되돌리기 on 완료한 일 정리's toast. */
  | { type: "unfileCompleted" }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "setReminder"; id: string; at?: string }
  /** 시간 정하기 · 시간 지우기 (no start) · a drag on the ribbon: minutes after midnight; the reminder follows (timeRange.ts). */
  | { type: "setRange"; id: string; start?: number; end?: number }
  | { type: "saveSeries"; taskID?: string; seriesID?: string; title?: string; rule: RepeatRule; remindAt?: string }
  | { type: "deleteSeries"; id: string }
  /** 되돌리기 after 반복 그만하기: the rule back, and its open copies in it again. */
  | { type: "restoreSeries"; series: Series; todos: string[] }
  | { type: "setDeadline"; id: string; dueDate?: string; keepOnToday?: boolean }
  | { type: "moveToLater"; id: string }
  /** 날짜 바꾸기 · → 내일 · Alt+→ / ← / ↓ · 저녁 정리: tasks due on a day, or to 언젠가, as one undo step. */
  | { type: "moveTasks"; ids: string[]; target: { kind: "day"; day: string } | { kind: "someday" } }
  | { type: "dropOnTab"; id: string; tab: NoteTab }
  /** 앞으로: a task dropped on a day, on 언젠가 or on the 오늘 tab (and next to another task). */
  | { type: "dropAhead"; id: string; target: AheadTarget; near?: { id: string; after: boolean } }
  | { type: "chooseStorage" }
  | { type: "resetStorage" }
  | { type: "memoUpdate"; id: string; text: string; /** The editor's text before this change. */ from?: string }
  | { type: "memoDelete"; id: string }
  | { type: "memoClose"; id: string }
  | { type: "memoRestore" }
  | { type: "editingReminder"; id?: string }
  | { type: "setPref"; key: keyof Prefs; value: Prefs[keyof Prefs] }
  | { type: "collapse"; anchor?: { x: number; y: number } }
  /** Settings' panes on the desk ("calendar" is the old name of 일정, "events"). */
  | { type: "openSettings"; tab?: "calendar" | "clock" | "events" | "storage" | "drawer" | "spaces" | "ai" }
  /** 설정 › AI 연결: the switch, 되돌리기 on an entry (or its toast), Claude 데스크톱에 연결, Claude Code 명령 복사. */
  | { type: "aiEnable"; on: boolean }
  | { type: "aiUndo"; id: string }
  | { type: "aiConnectDesktop" }
  | { type: "aiCopyCommand" }
  | { type: "openHistory"; day?: string }
  /** 검색: the note's search slip (from the desk's sidebar). */
  | { type: "openSearch" }
  | { type: "openHelp"; topic?: string }
  /** 책상's sidebar: a pane chosen (a click, ↑ ↓). */
  | { type: "deskPane"; pane: DeskPane }
  /** 사용 안내 (the first-launch cards) on the note, from the desk's sidebar. */
  | { type: "openGuide" }
  | { type: "openArchiveFolder" }
  | { type: "previewReminder" }
  | { type: "snoozePeriodic"; minutes: number }
  | { type: "copyList" }
  | { type: "exportList" }
  | { type: "showMenu"; menu: "more"; x: number; y: number }
  /** A to-do's menu: the note draws it on paper (at the point, or under the row when `keyboard`: Shift+F10 · the Menu key). */
  | { type: "showRowMenu"; id: string; x?: number; y?: number; keyboard?: boolean }
  /** A row of that menu picked (its number in the menu the main process sent last). */
  | { type: "rowMenuPick"; pick: number }
  | { type: "timerCommand"; command: TimerCommand }
  /** 집중 (the focus card's buttons, the pick state's 집중). */
  | { type: "focus"; command: FocusCommand }
  | { type: "window"; command: "minimize" | "close" | "quit" }
  /** The strip's +, and ⋯ → 새 일정…. */
  | { type: "calendarNewEvent"; at?: { day: string; minutes: number } }
  /** A strip row: its event in the sheet (고치기). */
  | { type: "calendarEditEvent"; key: string }
  | { type: "showEventMenu"; key: string; x?: number; y?: number }
  | { type: "openCalendar"; day?: string }
  /** The 오늘 창's 노트 열기 (and 외 N개). */
  | { type: "openNote" }
  /** 백업 · 옮기기: 내보내기… and 가져오기… (Settings → 꾸미기, the ⋯ menu, the tray). */
  | { type: "exportBackup" }
  | { type: "importBackup" }
  /** A task in the 달력 window's day panel: the note, on its page, with the task selected. */
  | { type: "calendarShowTask"; id: string }
  | ({ type: "quickEvent"; title: string } & ParsedWhen)
  /** Settings → 시계: an alarm added or changed (saved at once), or deleted. */
  | { type: "alarmSave"; alarm: Alarm }
  | { type: "alarmDelete"; id: string }
  /** The footer's 저장 확인 필요: what went wrong, on a slip. */
  | { type: "showStorageProblem" }
  /** 메모 서랍: open (the note's drawer button, the ⋯ menu, the cat), close, or either; opened on a memo (expanded), or at its slip. */
  | { type: "drawer"; command: "open" | "close" | "toggle"; memo?: string; write?: boolean }
  /** 메모 서랍's folders: a new one, a new name or colour, deleted (its memos to 메모), a new order. */
  | { type: "folderAdd"; id: string; name: string; color: string }
  | { type: "folderRename"; id: string; name: string }
  | { type: "folderColor"; id: string; color: string }
  | { type: "folderDelete"; id: string }
  /** 되돌리기 on a deleted folder's toast: the folder back with the memos it had. */
  | { type: "folderRestore"; id: string; memos: string[] }
  | { type: "folderOrder"; ids: string[] }
  /** A memo to another folder (폴더 옮기기, dropped on a bookmark), pinned or not (고정). */
  | { type: "memoMove"; id: string; folder: string }
  | { type: "memoPin"; id: string; pinned: boolean }
  /** A checklist line's box (`- [ ]` ↔ `- [x]`), line counted from 0. */
  | { type: "memoCheck"; id: string; line: number }
  /** The drawer's slip (Enter): a new memo in the folder shown (고정: 메모, pinned). */
  | { type: "drawerWrite"; text: string; view: string }
  /** The folder the drawer shows now (remembered: 빠른 메모 and /메모 go there; 고정 isn't remembered). */
  | { type: "drawerView"; view: string }
  /** 1.29: 정렬 (고정's is a device setting), 복제 of a folder (its memos copied), a memo's own paper (none: 서랍 따라). */
  | { type: "folderSort"; id: string; sort: FolderSort }
  | { type: "folderDuplicate"; id: string; newID: string }
  | { type: "memoPaper"; id: string; paper?: MemoPaper }
  /** 고정 모두 풀기 and its 되돌리기. */
  | { type: "memoPinMany"; ids: string[]; pinned: boolean }
  /** A memo's whole text at once (체크한 줄 지우기 and its 되돌리기), saved now. */
  | { type: "memoSetText"; id: string; text: string }
  /** 복제 of one memo: the same text, folder, pin and paper, now. */
  | { type: "memoDuplicate"; id: string }
  /** 복사한 글로 새 메모: the clipboard's text as a new memo where the drawer is (answers whether there was any). */
  | { type: "drawerPaste"; view: string }
  /** A link chip: the URL in the default browser (http and https only). */
  | { type: "openLink"; url: string }
  /** The drawer's text menu: 오려 두기 · 복사하기 · 붙여넣기 · 모두 선택 in the page that asked. */
  | { type: "editCommand"; command: "cut" | "copy" | "paste" | "selectAll" }
  /** 할 일 스페이스 (1.30): a new space (and a to-do moved into it), a new name, colour or order, deleted (its to-dos to
   *  스페이스 없음) and its 되돌리기, to-dos moved (null: 스페이스 없음), and the lens (none: 모든 스페이스). */
  | { type: "spaceAdd"; id: string; name: string; color?: string; todo?: string }
  | { type: "spaceRename"; id: string; name: string }
  | { type: "spaceColor"; id: string; color: string }
  | { type: "spaceDelete"; id: string }
  | { type: "spaceRestore"; id: string; todos: string[] }
  | { type: "spaceOrder"; ids: string[] }
  | { type: "todoSpace"; ids: string[]; space: string | null }
  | { type: "spaceLens"; space?: string }
  /** The desk's 스페이스 pane (스페이스 관리…). */
  | { type: "openSpaces" }
  /** Text to the clipboard (a memo's 복사). */
  | { type: "copyText"; text: string };
