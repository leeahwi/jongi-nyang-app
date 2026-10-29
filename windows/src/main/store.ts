import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { dayKey, logicalDayStart } from "../core/archive";
import { UndoableNotebook, isoDate, newID, parseNotebook, serializeNotebook, type TodoItem } from "../core/notebook";
import { alertOn, isValidRule, occursOn, parseSeries, planToday, serializeSeries, type RepeatRule, type Series } from "../core/repeat";
import { isBlank, mergeMemos, newMemo, parseMemos, serializeMemos, type Memo } from "../core/memo";
import {
  clampDrawerWidth, duplicateFolder, emptyMemoFolders, lastFolderOf, memosIn, placementOf, readMemoPaper, setMemoPaper, visibleFolders, memoFoldersFileName, mergeMemoFolders, parseMemoFolders, placeNew, pruneMemoFolders, readDrawerShortcut,
  readDrawerBackdrop, readDrawerTheme, readSort, serializeMemoFolders, toggleChecklist, type MemoFolders, type MemoPlacement,
} from "../core/memoDrawer";
import { mergeText } from "../core/textMerge";
import { emptyTodoSpaces, mergeTodoSpaces, packSpaceOf, parseTodoSpaces, pruneTodoSpaces, readLens, serializeTodoSpaces, todoSpacesFileName, type TodoSpaces } from "../core/todoSpaces";
import { pageOf } from "../core/shelf";
import { todaySinceUpdates } from "../core/carry";
import { sharedFiles, type SharedFile } from "../core/storage";
import { defaultPrefs, type AiView, type AppState, type FocusView, type Prefs, type TimerView } from "../core/types";
import type { CalendarView } from "../core/calendar";
import { readPaper } from "../core/desk";
import { parseEvents, serializeEvents, type LocalEvent } from "../core/events";
import { parseAlarms, serializeAlarms, type Alarm } from "../core/alarm";
import { lang, t } from "../i18n";
import { exportRange } from "../core/timeRange";
import { takeLock } from "./aiLock";

export interface WindowMemory {
  bounds?: { x: number; y: number; width: number; height: number };
  floatingOrigin?: { x: number; y: number };
  pet?: PetMemory;
  timer?: TimerMemory;
  /** Where the 달력 window was last put, and its size (older files have only the place); the desk starts from it once. */
  calendar?: { x: number; y: number; width?: number; height?: number };
  /** 책상: where it was last put and its content size, and the pane it showed. */
  desk?: { x: number; y: number; width: number; height: number; pane?: string };
  /** 화면 오른쪽에 붙이기 / 왼쪽에 붙이기: the side the note is docked to, and where it was before (restored by the second click). */
  docked?: { side: "left" | "right"; previous: { x: number; y: number; width: number; height: number } };
}

/** Where 종이냥 sits, kept across launches. */
export interface PetMemory {
  /** Electron display id the pet lives on. */
  displayID?: number;
  /** Position along that display's floor, 0…1. */
  homeFraction?: number;
  /**
   * Earlier versions let the pet hold the timer and kept it here (validated with parseTimer); the timer
   * widget moves it to `TimerMemory.current` on launch. Also `freeOrigin`, now unused.
   */
  timer?: unknown;
  freeOrigin?: unknown;
}

/** The focus timer and where its board was last put, kept across launches. */
export interface TimerMemory {
  /** Top-left of the timer window (without any off-screen shift). */
  origin?: { x: number; y: number };
  /** The running or paused timer, validated with parseTimer on load. */
  current?: unknown;
  /** 집중: the session on a task around it (validated on load). */
  focus?: unknown;
  /** The focus phase now running: its focus.jsonl line's id and start. */
  round?: unknown;
}

/**
 * The single source of truth. Renderers never mutate data themselves; they send actions
 * here and redraw from the broadcast state.
 *
 * The data (todos, memos, repeats, events, alarms) may live in a folder shared with other computers. The store
 * remembers the exact text it last read or wrote for each file: a file that differs on disk was
 * changed elsewhere and is read back in (debounced, from `watch`), and every change first catches
 * up with the disk, so a newer file is never overwritten with stale data.
 */
/**
 * A failed save, the way every file says it (#34): what didn't happen, what's still safe, the next try, what to do.
 * Every file here is written whole on each change, so the next change really is the next try.
 */
export function saveProblem(what: string): string {
  return [what, t("앱을 끄기 전까지 적은 글은 화면에 그대로 있어요."), t("다음에 바뀔 때 다시 저장해 볼게요."), t("저장 폴더가 열리는지 확인해 주세요.")].join(" ");
}

/** An unreadable file copied aside: its name only — the storage folder button shows where (#25). */
function keptAside(copy: string): string {
  return t("원래 파일은 저장 폴더에 ‘{file}’ 이름으로 남겨 뒀어요.", { file: path.basename(copy) });
}

export class Store extends EventEmitter {
  readonly dataDirectory: string;
  readonly notebookPath: string;
  private readonly settingsPath: string;
  private readonly repeatsPath: string;
  series: Series[] = [];
  private readonly eventsPath: string;
  /** 일정 (events.json), in the file's order. */
  events: LocalEvent[] = [];
  /** Counts every change to `events` (they change in place), so their spread over days can be kept until the next. */
  eventsVersion = 0;
  private readonly alarmsPath: string;
  /** 시계 알람 (alarms.json), in the file's order. */
  alarms: Alarm[] = [];
  private readonly memosPath: string;
  /** Newest first. */
  memos: Memo[] = [];
  lastDeletedMemo?: Memo;
  /** 메모 서랍 (memo-folders.json): the folders and each memo's place; read with the memos, merged like them. */
  memoFolders: MemoFolders = emptyMemoFolders(lang());
  /** The deleted memo's place, put back with 되돌리기. */
  private lastDeletedPlacement?: MemoPlacement;
  private readonly memoFoldersPath: string;
  /** 할 일 스페이스 (todo-spaces.json): the spaces and each to-do's; merged with another device's like the folders. */
  todoSpaces: TodoSpaces = emptyTodoSpaces();
  private readonly todoSpacesPath: string;
  private memoTimer?: NodeJS.Timeout;
  private memoChangeTimer?: NodeJS.Timeout;
  history = new UndoableNotebook();
  prefs: Prefs = { ...defaultPrefs };
  memory: WindowMemory = {};
  storageError?: string;
  editingReminderID?: string;
  nextPeriodicDue?: number;
  private canSave = true;
  private settingsTimer?: NodeJS.Timeout;
  /** Where Ctrl+Alt+N stands (set by main), and where the list lives — shown in Settings. */
  shortcutProblem?: string;
  /** Where Ctrl+Alt+M (빠른 메모) stands. */
  memoShortcutProblem?: string;
  /** The same for Ctrl+Alt+J (노트 보이기 · 숨기기). */
  noteShortcutProblem?: string;
  /** The same for 메모 서랍's shortcut (Ctrl+Shift+D unless changed). */
  drawerShortcutProblem?: string;
  drawerBackdropNote?: string;
  storage = { label: t("이 PC (기본)"), custom: false, path: "", archivePath: "", home: "" };
  /** The focus timer as the windows draw it (set by main). */
  timerView: () => TimerView | undefined = () => undefined;
  /** 집중 as the note draws it (set by main). */
  focusView: () => FocusView | undefined = () => undefined;
  /** 일정 as the windows draw it (set by main/calendar.ts). */
  calendarView: () => CalendarView = () => ({ today: [], hasEvents: this.events.length > 0, withEvents: [] });
  /** AI 연결 as the windows draw it (set by main/aiConnect.ts). */
  aiView: () => AiView = () => ({ enabled: this.prefs.aiEnabled, marks: [], recent: [], command: "", copied: false });
  /** The text this app last read or wrote for each shared file; undefined while the file is absent. */
  private readonly known = new Map<SharedFile, string | undefined>();
  private readonly stamps = new Map<SharedFile, string | undefined>();
  /** Memos changed (or added) here since the last write, and memos deleted here: kept when another device's file comes in. */
  private readonly memoEdits = new Set<string>();
  private readonly memoDeletions = new Set<string>();
  /** The memo open in the editor once something was typed in it: it keeps this PC's text until closed. */
  private typedOpenMemo?: string;
  private watcher?: fs.FSWatcher;
  private poll?: NodeJS.Timeout;
  private readonly syncTimers = new Map<SharedFile, NodeJS.Timeout>();
  private readonly failedReads = new Map<SharedFile, number>();
  /**
   * AI 연결 on: ai-write.lock in the settings folder, held from catching up to writing so the extension
   * (mcp/) and this app never write todos.json, events.json or memos.json from the same stale copy.
   */
  aiLock?: string;
  private lockDepth = 0;

  constructor(directory: string, demo = false, settingsDirectory = directory) {
    super();
    this.setMaxListeners(40); // every window class listens for its settings
    fs.mkdirSync(directory, { recursive: true });
    fs.mkdirSync(settingsDirectory, { recursive: true });
    this.dataDirectory = directory;
    this.notebookPath = path.join(directory, "todos.json");
    this.settingsPath = path.join(settingsDirectory, "settings.json");
    this.repeatsPath = path.join(directory, "repeats.json");
    this.memosPath = path.join(directory, "memos.json");
    this.eventsPath = path.join(directory, "events.json");
    this.alarmsPath = path.join(directory, "alarms.json");
    this.memoFoldersPath = path.join(directory, memoFoldersFileName);
    this.todoSpacesPath = path.join(directory, todoSpacesFileName);
    const memos = this.readDisk("memos.json");
    this.noteKnown("memos.json", memos);
    if (memos !== undefined) {
      try { this.memos = parseMemos(memos).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); } catch { this.keepUnreadable(this.memosPath, "memos"); }
    }
    this.loadSettings();
    this.loadMemoFolders();
    this.loadRepeats();
    this.loadEvents();
    this.loadAlarms();
    this.loadNotebook();
    this.loadTodoSpaces();
    if (demo && this.history.items.length === 0) {
      const demoNotebook = new UndoableNotebook();
      for (const title of [t("창문 열고, 커피 한 잔"), t("오늘 꼭 해야 할 일 정리하기"), t("미뤄 둔 책 10쪽 읽기"), t("잠깐, 바깥 공기 쐬기"), t("내일의 나에게 메모 남기기")]) {
        demoNotebook.add(title);
      }
      demoNotebook.toggle(demoNotebook.items[0].id);
      this.history = new UndoableNotebook(demoNotebook.notebook);
    }
  }

  get items(): readonly TodoItem[] { return this.history.items; }
  /** Today's sheet — what the tray, the post-it and periodic reminders talk about. */
  get todayItems(): TodoItem[] {
    const now = new Date();
    return this.history.items.filter((item) => pageOf(item, now) === "today");
  }
  get remainingCount() { return this.todayItems.filter((item) => !item.isCompleted).length; }

  state(): AppState {
    return {
      items: this.history.items.map((item) => ({ ...item })),
      canUndo: this.history.canUndo,
      canRedo: this.history.canRedo,
      prefs: { ...this.prefs },
      nextPeriodicDue: this.nextPeriodicDue,
      storageError: this.storageError,
      editingReminderID: this.editingReminderID,
      series: this.series.map((entry) => ({ ...entry, rule: { ...entry.rule } })),
      memos: this.memos.map((memo) => ({ ...memo })),
      lastDeletedMemo: Boolean(this.lastDeletedMemo),
      shortcutProblem: this.shortcutProblem,
      memoShortcutProblem: this.memoShortcutProblem,
      noteShortcutProblem: this.noteShortcutProblem,
      drawerShortcutProblem: this.drawerShortcutProblem,
      drawerBackdropNote: this.drawerBackdropNote,
      memoFolders: { ...this.memoFolders, folders: this.memoFolders.folders.map((folder) => ({ ...folder })), placement: { ...this.memoFolders.placement } },
      todoSpaces: { ...this.todoSpaces, spaces: this.todoSpaces.spaces.map((space) => ({ ...space })), items: {} },
      spaceOf: this.packedSpaces(),
      storage: { ...this.storage },
      calendar: this.calendarView(),
      events: this.events.map((event) => ({ ...event, skip: [...event.skip] })),
      alarms: this.alarms.map((alarm) => ({ ...alarm, days: [...alarm.days] })),
      timer: this.timerView(),
      focus: this.focusView(),
      ai: this.aiView(),
    };
  }

  /** Runs a notebook mutation, saves if it changed anything, and tells every window. */
  mutate(action: (history: UndoableNotebook) => unknown): void {
    this.locked(() => this.mutateNow(action));
  }

  private mutateNow(action: (history: UndoableNotebook) => unknown): void {
    this.catchUp(["todos.json"]);
    const before = serializeNotebook(this.history.notebook);
    const undoBefore = this.history.canUndo;
    action(this.history);
    // 어제부터: the day each open undated task came onto 오늘 (bookkeeping, no undo step).
    this.history.trackToday(todaySinceUpdates(this.history.items, new Date()));
    const after = serializeNotebook(this.history.notebook);
    if (after !== before) this.saveNotebook(after);
    if (after !== before || undoBefore !== this.history.canUndo) this.changed();
  }

  /** The 어제부터 days brought up to date (launch, the 4 a.m. boundary, another device's list). */
  trackToday(): void {
    this.mutate(() => undefined);
  }

  /** Completing twice (from the bubble and the note) must never uncheck a task. */
  complete(id: string): void {
    this.mutate((history) => {
      if (history.items.some((item) => item.id === id && !item.isCompleted)) history.toggle(id);
    });
  }

  // ─── 할 일 스페이스 (todo-spaces.json) ────────────────────────────────────────

  private packed?: { data: TodoSpaces; text: string };
  /** What the windows get of each to-do's space, worked out again only when the spaces changed. */
  private packedSpaces(): string {
    if (this.packed?.data !== this.todoSpaces) this.packed = { data: this.todoSpaces, text: packSpaceOf(this.todoSpaces) };
    return this.packed.text;
  }

  /**
   * A change to the spaces or a to-do's space: caught up with the disk first (another device's copy merged in),
   * then saved at once and every window told. `change` returns the same value for nothing.
   */
  changeSpaces(change: (data: TodoSpaces) => TodoSpaces): void {
    this.locked(() => {
      this.catchUp(["todos.json", todoSpacesFileName]);
      const next = change(this.todoSpaces);
      if (next === this.todoSpaces) return;
      this.todoSpaces = next;
      this.saveTodoSpaces();
      this.changed();
    });
  }

  private loadTodoSpaces(): void {
    const text = this.readDisk(todoSpacesFileName);
    this.noteKnown(todoSpacesFileName, text);
    if (text === undefined) return;
    try {
      this.todoSpaces = parseTodoSpaces(text);
    } catch {
      this.todoSpaces = emptyTodoSpaces();
      this.keepSpacesAside();
    }
  }

  /** S21: an unreadable todo-spaces.json is moved aside as todo-spaces.json.unreadable-<UTC stamp> and the spaces start empty. */
  private keepSpacesAside(): void {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/T/, "-").replace(/\..*$/, "").replace(/Z$/, "");
    const aside = path.join(this.dataDirectory, `${todoSpacesFileName}.unreadable-${stamp}`);
    const message = t("스페이스 파일을 읽지 못해서 스페이스 없이 시작했어요. 할 일은 모두 그대로예요.");
    try {
      fs.renameSync(this.todoSpacesPath, aside);
      this.noteKnown(todoSpacesFileName, undefined);
      this.storageError = `${message} ${keptAside(aside)}`;
    } catch {
      this.storageError = `${message} ${t("저장 폴더가 열리는지 확인해 주세요.")}`;
    }
  }

  private saveTodoSpaces(): void {
    if (!this.mayWrite(todoSpacesFileName)) return;
    // S17, S22: entries of to-dos gone more than 30 days, and old tombstones, go.
    this.todoSpaces = pruneTodoSpaces(this.todoSpaces, new Set(this.history.items.map((item) => item.id)));
    const contents = serializeTodoSpaces(this.todoSpaces);
    if (contents === this.known.get(todoSpacesFileName)) return;
    try {
      this.writeAtomically(this.todoSpacesPath, contents);
      this.noteKnown(todoSpacesFileName, contents);
      this.clearError(t("스페이스를 저장하지 못했어요."));
    } catch {
      this.reportError(saveProblem(t("스페이스를 저장하지 못했어요.")));
    }
  }

  // ─── Memos ─────────────────────────────────────────────────────────────────

  addMemo(): string {
    this.catchUp(["memos.json"]);
    const memo = newMemo();
    this.memoEdits.add(memo.id);
    this.memos.unshift(memo);
    this.changed();
    return memo.id;
  }

  /**
   * `from` is the text the editor had before this change: when another device's edit was joined
   * in meanwhile (and the editor doesn't show it yet), the two are joined again.
   */
  updateMemo(id: string, typed: string, from?: string): void {
    const index = this.memos.findIndex((memo) => memo.id === id);
    if (index < 0) return;
    const current = this.memos[index].text;
    const text = from !== undefined && from !== current ? mergeText(from, typed, current) : typed;
    if (text === current) return;
    const memo = { ...this.memos[index], text, updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
    this.memoEdits.add(id);
    this.typedOpenMemo = id; // only the open memo's editor sends text
    this.memos.splice(index, 1);
    this.memos.unshift(memo);
    clearTimeout(this.memoTimer);
    this.memoTimer = setTimeout(() => this.saveMemos(), 400);
    // Typing: the windows hear once the keys pause (the editor keeps its own text), not on every key.
    clearTimeout(this.memoChangeTimer);
    this.memoChangeTimer = setTimeout(() => this.changed(), 150);
  }

  deleteMemo(id: string): void {
    this.catchUp(["memos.json"]);
    const memo = this.memos.find((entry) => entry.id === id);
    if (!memo) return;
    this.memos = this.memos.filter((entry) => entry.id !== id);
    this.memoDeletions.add(id);
    if (this.typedOpenMemo === id) this.typedOpenMemo = undefined;
    if (!isBlank(memo)) {
      this.lastDeletedMemo = memo;
      this.lastDeletedPlacement = this.memoFolders.placement[id];
    }
    this.saveMemos();
    this.changed();
  }

  /**
   * 빠른 메모 · /메모 · 메모 서랍's slip: a new memo with this text at the top, saved at once, in `target`
   * (빠른 메모 and /메모: the drawer's last folder). Blank text adds nothing.
   */
  addMemoText(text: string, target: { folder: string; pinned: boolean } = this.lastFolderTarget()): string | undefined {
    if (!text.trim()) return undefined;
    this.catchUp(["memos.json"]);
    const memo = { ...newMemo(), text };
    this.memoEdits.add(memo.id);
    this.memos.unshift(memo);
    this.saveMemos();
    this.changeFolders((data) => placeNew(data, memo.id, target));
    this.changed();
    return memo.id;
  }

  /** 빠른 메모 and /메모 go to the folder last shown in the drawer (never opened, or gone: 메모). */
  lastFolderTarget(): { folder: string; pinned: boolean } {
    return { folder: lastFolderOf(this.memoFolders, this.prefs.drawerLastFolder), pinned: false };
  }

  // ─── 메모 서랍 (memo-folders.json) ───────────────────────────────────────────

  /**
   * A change to the folders or a memo's place: caught up with the disk first (another device's copy is
   * merged in), then saved at once and every window told. `change` returns the same value for nothing.
   */
  changeFolders(change: (data: MemoFolders) => MemoFolders): void {
    this.locked(() => {
      this.catchUp(["memos.json", memoFoldersFileName]);
      const next = change(this.memoFolders);
      if (next === this.memoFolders) return;
      this.memoFolders = next;
      this.saveMemoFolders();
      this.changed();
    });
  }

  private loadMemoFolders(): void {
    const text = this.readDisk(memoFoldersFileName);
    this.noteKnown(memoFoldersFileName, text);
    if (text === undefined) { this.memoFolders = emptyMemoFolders(lang()); return; }
    try {
      this.memoFolders = parseMemoFolders(text, lang());
    } catch {
      this.memoFolders = emptyMemoFolders(lang());
      this.keepFoldersAside();
    }
  }

  /**
   * D15: an unreadable memo-folders.json is moved aside as memo-folders.unreadable-<UTC stamp>.json, said once the way
   * every file says it (#34). At launch (`starting`) the drawer starts afresh (every memo in 메모); later (another
   * device's file) this device's folders stay and are written in its place.
   */
  private keepFoldersAside(starting = true): void {
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/T/, "-").replace(/\..*$/, "").replace(/Z$/, "");
    const aside = path.join(this.dataDirectory, `memo-folders.unreadable-${stamp}.json`);
    const what = starting ? t("메모 폴더를 읽지 못해서 메모를 모두 ‘메모’ 폴더에 두고 시작했어요.") : t("메모 폴더를 읽지 못했어요. 여기 있던 폴더는 그대로예요.");
    try {
      fs.renameSync(this.memoFoldersPath, aside);
      this.noteKnown(memoFoldersFileName, undefined);
      this.storageError = `${what} ${keptAside(aside)}`;
    } catch {
      this.storageError = `${what} ${t("저장 폴더가 열리는지 확인해 주세요.")}`;
    }
  }

  private saveMemoFolders(): void {
    if (!this.mayWrite(memoFoldersFileName)) return;
    // D6: places of memos that are gone are dropped — not those set in the last hour (a cloud folder may
    // bring the two files separately, the memo still on its way).
    const recent = new Date(Date.now() - 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
    const keep = new Set([...this.memos.map((memo) => memo.id), ...Object.entries(this.memoFolders.placement).filter(([, entry]) => entry.at > recent).map(([id]) => id)]);
    if (this.lastDeletedMemo) keep.add(this.lastDeletedMemo.id);
    this.memoFolders = pruneMemoFolders(this.memoFolders, keep);
    const contents = serializeMemoFolders(this.memoFolders);
    if (contents === this.known.get(memoFoldersFileName)) return;
    try {
      this.writeAtomically(this.memoFoldersPath, contents);
      this.noteKnown(memoFoldersFileName, contents);
      this.clearError(t("메모 폴더를 저장하지 못했어요."));
    } catch {
      this.reportError(saveProblem(t("메모 폴더를 저장하지 못했어요.")));
    }
  }

  /** 메모 서랍: a checklist line's box turned over (D7, D8), saved at once. */
  toggleMemoLine(id: string, line: number): void {
    this.catchUp(["memos.json"]);
    const index = this.memos.findIndex((memo) => memo.id === id);
    if (index < 0) return;
    const text = toggleChecklist(this.memos[index].text, line);
    if (text === this.memos[index].text) return;
    const memo = { ...this.memos[index], text, updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
    this.memoEdits.add(id);
    this.memos.splice(index, 1);
    this.memos.unshift(memo);
    this.saveMemos();
    this.changed();
  }

  /** 메모 서랍: a memo's whole text at once (체크한 줄 지우기, its 되돌리기), saved now; the memo goes to the top as any edit. */
  setMemoText(id: string, text: string): void {
    this.catchUp(["memos.json"]);
    const index = this.memos.findIndex((memo) => memo.id === id);
    if (index < 0 || this.memos[index].text === text) return;
    const memo = { ...this.memos[index], text, updatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z") };
    this.memoEdits.add(id);
    this.memos.splice(index, 1);
    this.memos.unshift(memo);
    this.saveMemos();
    this.changed();
  }

  /** 복제 of one memo: a new memo on top with the same text, in the same folder, pinned and papered as it (now). */
  duplicateMemo(id: string): string | undefined {
    this.catchUp(["memos.json"]);
    const original = this.memos.find((memo) => memo.id === id);
    if (!original) return undefined;
    const copy = { ...newMemo(), text: original.text };
    this.memoEdits.add(copy.id);
    this.memos.unshift(copy);
    this.saveMemos();
    const place = placementOf(this.memoFolders, id);
    const paper = this.memoFolders.placement[id]?.paper;
    this.changeFolders((data) => {
      const placed = placeNew(data, copy.id, place);
      return paper ? setMemoPaper(placed, copy.id, readMemoPaper(paper) ?? undefined) : placed;
    });
    this.changed();
    return copy.id;
  }

  /**
   * 복제 of a folder (D21): its memos copied in memos.json (new ids, the same text and times, each right after
   * its original) and a new folder after it holding the copies.
   */
  duplicateFolder(id: string, newFolderID: string): void {
    this.catchUp(["memos.json", memoFoldersFileName]);
    if (!visibleFolders(this.memoFolders).some((folder) => folder.id === id) || this.memoFolders.folders.some((folder) => folder.id === newFolderID)) return;
    const originals = memosIn(this.memoFolders, this.memos, id);
    const copies: [string, string][] = [];
    const memos: Memo[] = [];
    for (const memo of this.memos) {
      memos.push(memo);
      if (!originals.includes(memo)) continue;
      const copy = { ...memo, id: newID() };
      copies.push([memo.id, copy.id]);
      this.memoEdits.add(copy.id);
      memos.push(copy);
    }
    this.memos = memos;
    if (copies.length) this.saveMemos();
    this.changeFolders((data) => duplicateFolder(data, id, newFolderID, copies, lang()));
    this.changed();
  }

  /** A memo just made from the 입력 줄, taken back: gone without "지운 메모 되돌리기". */
  discardMemo(id: string): void {
    this.catchUp(["memos.json"]);
    if (!this.memos.some((memo) => memo.id === id)) return;
    this.memos = this.memos.filter((memo) => memo.id !== id);
    this.memoDeletions.add(id);
    if (this.typedOpenMemo === id) this.typedOpenMemo = undefined;
    this.saveMemos();
    this.changed();
  }

  /** Leaving a memo: a blank one quietly disappears. */
  closeMemo(id: string): void {
    this.catchUp(["memos.json"]);
    const memo = this.memos.find((entry) => entry.id === id);
    if (memo && isBlank(memo)) this.memos = this.memos.filter((entry) => entry.id !== id);
    this.saveMemos();
    if (this.typedOpenMemo === id) this.typedOpenMemo = undefined;
    this.changed();
  }

  restoreMemo(): void {
    this.catchUp(["memos.json"]);
    if (!this.lastDeletedMemo) return;
    this.memoDeletions.delete(this.lastDeletedMemo.id);
    this.memoEdits.add(this.lastDeletedMemo.id);
    const restored = this.lastDeletedMemo;
    const place = this.lastDeletedPlacement;
    this.memos = [restored, ...this.memos.filter((memo) => memo.id !== restored.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    this.lastDeletedMemo = undefined;
    this.lastDeletedPlacement = undefined;
    this.saveMemos();
    // Back in its folder (with a new time, so the place dropped meanwhile elsewhere doesn't win).
    if (place) this.changeFolders((data) => placeNew(data, restored.id, place));
    this.changed();
  }

  saveMemos(): void {
    this.locked(() => this.saveMemosNow());
  }

  private saveMemosNow(): void {
    clearTimeout(this.memoTimer);
    // Another device wrote memos while an edit here waited: take theirs, keeping what changed here.
    if (this.differs("memos.json")) {
      this.reload("memos.json");
      if (this.differs("memos.json")) return; // not readable yet; tried again soon
    }
    const contents = serializeMemos(this.memos.filter((memo) => !isBlank(memo)));
    if (contents === this.known.get("memos.json")) return this.forgetMemoEdits();
    try {
      this.writeAtomically(this.memosPath, contents);
      this.noteKnown("memos.json", contents);
      this.forgetMemoEdits();
      this.clearError(t("메모를 저장하지 못했어요."));
    } catch {
      this.reportError(saveProblem(t("메모를 저장하지 못했어요.")));
    }
  }

  private forgetMemoEdits(): void {
    // A blank memo still open in the editor is never written, so it stays "edited here".
    for (const id of this.memoEdits) if (!this.memos.some((memo) => memo.id === id && isBlank(memo))) this.memoEdits.delete(id);
    this.memoDeletions.clear();
  }

  // ─── Recurring tasks ────────────────────────────────────────────────────────

  /**
   * Creates or updates a recurring task. From a row, the task itself becomes today's copy
   * when the rule applies today (and gets today's alert if that time is still ahead).
   */
  saveSeries(change: { taskID?: string; seriesID?: string; title?: string; rule: RepeatRule; remindAt?: string }, now = new Date()): string | undefined {
    if (!isValidRule(change.rule)) return undefined;
    this.catchUp(["repeats.json", "todos.json"]);
    const task = change.taskID ? this.items.find((item) => item.id === change.taskID) : undefined;
    let entry = this.series.find((candidate) => candidate.id === (change.seriesID ?? task?.seriesID));
    const title = change.title?.trim() || task?.title || entry?.title;
    if (!title) return undefined;
    if (entry) {
      entry.title = title;
      entry.rule = { ...change.rule };
      if (change.remindAt) entry.remindAt = change.remindAt; else delete entry.remindAt;
    } else {
      entry = { id: newID(), title, rule: { ...change.rule }, createdAt: isoDate(now), ...(change.remindAt ? { remindAt: change.remindAt } : {}) };
      this.series.push(entry);
    }
    const today = logicalDayStart(now);
    const occursToday = occursOn(entry.rule, today);
    // Today's alert only if it is still ahead; a time already past never fires at once.
    const alert = occursToday && entry.remindAt ? alertOn(today, entry.remindAt) : undefined;
    const upcoming = alert && alert > now ? alert : undefined;
    if (task) {
      const series = entry;
      this.mutate((history) => history.linkSeries(task.id, series.id, occursToday, upcoming));
      if (occursToday) entry.lastPlaced = dayKey(now);
    }
    this.saveRepeats();
    this.placeRecurring(now);
    if (!task) {
      const series = entry;
      const placedToday = occursToday && series.lastPlaced === dayKey(now);
      this.mutate((history) => history.applySeries(series.id, series.title, placedToday ? { at: upcoming ? isoDate(upcoming) : undefined } : undefined));
    }
    this.changed();
    return entry.id;
  }

  /** A repeat just made from the 입력 줄, taken back: the series and the copy it put on the list go without a trace. */
  retractSeries(id: string): void {
    this.catchUp(["repeats.json", "todos.json"]);
    this.series = this.series.filter((entry) => entry.id !== id);
    this.saveRepeats();
    const copies = this.items.filter((item) => item.seriesID === id && !item.isCompleted).map((item) => item.id);
    this.mutate((history) => { for (const copy of copies) history.retract(copy); });
    this.changed();
  }

  /** Stops the repetition; copies already on the list stay as ordinary tasks. */
  deleteSeries(id: string): void {
    this.catchUp(["repeats.json", "todos.json"]);
    this.series = this.series.filter((entry) => entry.id !== id);
    this.saveRepeats();
    this.mutate((history) => {
      for (const item of history.items) if (item.seriesID === id && !item.isCompleted) history.setSeries(item.id, undefined);
    });
    this.changed();
  }

  /** 되돌리기 after 반복 그만하기 (#22): the rule as it was, its open copies in it again (unless it is back already). */
  restoreSeries(entry: Series, todos: string[]): void {
    this.catchUp(["repeats.json", "todos.json"]);
    if (typeof entry?.id !== "string" || typeof entry.title !== "string" || !isValidRule(entry.rule) || this.series.some((candidate) => candidate.id === entry.id)) return;
    this.series = [...this.series, entry];
    this.saveRepeats();
    const ids = new Set(todos);
    this.mutate((history) => {
      for (const item of history.items) if (ids.has(item.id) && !item.isCompleted && !item.seriesID) history.setSeries(item.id, entry.id);
    });
    this.changed();
  }

  /** Puts today's copies on the list; runs at launch, every 30 minutes, after waking and at 4 a.m. */
  placeRecurring(now = new Date()): void {
    // Another computer may have placed today's copies already.
    this.catchUp(["repeats.json", "todos.json"]);
    const plan = planToday(this.series, this.items, now);
    if (plan.placed.length === 0) return;
    this.mutate((history) => history.placeRecurring(plan.create, plan.roll));
    const key = dayKey(now);
    for (const entry of this.series) if (plan.placed.includes(entry.id)) entry.lastPlaced = key;
    this.saveRepeats();
  }

  private loadRepeats(): void {
    const text = this.readDisk("repeats.json");
    this.noteKnown("repeats.json", text);
    if (text === undefined) return; // No recurring tasks yet.
    try {
      this.series = parseSeries(text);
    } catch {
      this.keepUnreadable(this.repeatsPath, "repeats");
    }
  }

  // ─── 일정 (events.json) ──────────────────────────────────────────────────────

  private loadEvents(): void {
    const text = this.readDisk("events.json");
    this.noteKnown("events.json", text);
    if (text === undefined) return; // No events yet.
    try {
      this.events = parseEvents(text);
    } catch {
      this.keepUnreadable(this.eventsPath, "events");
    }
  }

  /** Adds an event, or replaces the one with its id; saved at once. */
  putEvent(event: LocalEvent): void {
    this.locked(() => {
      this.catchUp(["events.json"]);
      const index = this.events.findIndex((entry) => entry.id === event.id);
      if (index >= 0) this.events[index] = event; else this.events.push(event);
      this.eventsChanged();
    });
  }

  removeEvent(id: string): void {
    this.locked(() => {
      this.catchUp(["events.json"]);
      if (!this.events.some((entry) => entry.id === id)) return;
      this.events = this.events.filter((entry) => entry.id !== id);
      this.eventsChanged();
    });
  }

  /** Every event at once (snapshots' sample days, an undo of Claude's). */
  replaceEvents(events: LocalEvent[]): void {
    this.locked(() => {
      this.catchUp(["events.json"]);
      this.events = events;
      this.eventsChanged();
    });
  }

  private eventsChanged(): void {
    this.eventsVersion += 1;
    this.saveEvents();
    this.emit("events");
    this.changed();
  }

  private saveEvents(): void {
    const contents = serializeEvents(this.events);
    if (contents === this.known.get("events.json")) return;
    if (!this.mayWrite("events.json")) return;
    try {
      this.writeAtomically(this.eventsPath, contents);
      this.noteKnown("events.json", contents);
      this.clearError(t("일정을 저장하지 못했어요."));
    } catch {
      this.reportError(saveProblem(t("일정을 저장하지 못했어요.")));
    }
  }

  // ─── 알람 (alarms.json) ──────────────────────────────────────────────────────

  private loadAlarms(): void {
    const text = this.readDisk("alarms.json");
    this.noteKnown("alarms.json", text);
    if (text === undefined) return; // No alarms yet.
    try {
      this.alarms = parseAlarms(text);
    } catch {
      this.keepUnreadable(this.alarmsPath, "alarms");
    }
  }

  /** Adds an alarm, or replaces the one with its id; saved at once. */
  putAlarm(alarm: Alarm): void {
    this.catchUp(["alarms.json"]);
    const index = this.alarms.findIndex((entry) => entry.id === alarm.id);
    if (index >= 0) this.alarms[index] = alarm; else this.alarms.push(alarm);
    this.alarmsChanged();
  }

  removeAlarm(id: string): void {
    this.catchUp(["alarms.json"]);
    if (!this.alarms.some((entry) => entry.id === id)) return;
    this.alarms = this.alarms.filter((entry) => entry.id !== id);
    this.alarmsChanged();
  }

  /** Every alarm at once (snapshots' samples). */
  replaceAlarms(alarms: Alarm[]): void {
    this.catchUp(["alarms.json"]);
    this.alarms = alarms;
    this.alarmsChanged();
  }

  private alarmsChanged(): void {
    this.saveAlarms();
    this.emit("alarms");
    this.changed();
  }

  private saveAlarms(): void {
    const contents = serializeAlarms(this.alarms);
    if (contents === this.known.get("alarms.json")) return;
    if (!this.mayWrite("alarms.json")) return;
    try {
      this.writeAtomically(this.alarmsPath, contents);
      this.noteKnown("alarms.json", contents);
      this.clearError(t("알람을 저장하지 못했어요."));
    } catch {
      this.reportError(saveProblem(t("알람을 저장하지 못했어요.")));
    }
  }

  /**
   * After 가져오기 wrote the folder: everything is read again from the disk, as if the app had just
   * started (the undo history starts over; edits not yet written were flushed before the import).
   */
  reloadAll(): void {
    clearTimeout(this.memoTimer);
    this.memoEdits.clear();
    this.memoDeletions.clear();
    this.typedOpenMemo = undefined;
    this.lastDeletedMemo = undefined;
    this.lastDeletedPlacement = undefined;
    this.memos = [];
    this.series = [];
    this.events = [];
    this.eventsVersion += 1;
    this.alarms = [];
    this.history = new UndoableNotebook();
    this.canSave = true;
    const memos = this.readDisk("memos.json");
    this.noteKnown("memos.json", memos);
    if (memos !== undefined) {
      try { this.memos = parseMemos(memos).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); } catch { this.keepUnreadable(this.memosPath, "memos"); }
    }
    this.loadMemoFolders();
    this.loadRepeats();
    this.loadEvents();
    this.loadAlarms();
    this.loadNotebook();
    for (const file of sharedFiles) this.emit("reloaded", file);
    this.emit("events");
    this.emit("alarms");
    this.changed();
  }

  /** An unreadable file is copied aside before anything is saved over it. */
  /** `starting`: read at launch, so that part starts empty; later (another device's file), what's here stays. */
  private keepUnreadable(file: string, what: "list" | "memos" | "repeats" | "events" | "alarms", starting = true): void {
    const backup = file.replace(/\.json$/, `.unreadable-${Math.floor(Date.now() / 1000)}.json`);
    const unread = {
      list: t("목록 파일을 읽지 못했어요."), memos: t("메모 파일을 읽지 못했어요."),
      repeats: t("반복 할 일 파일을 읽지 못했어요."), events: t("일정 파일을 읽지 못했어요."), alarms: t("알람 파일을 읽지 못했어요."),
    }[what];
    const emptied = {
      list: t("목록 파일을 읽지 못해서 빈 목록으로 시작했어요."), memos: t("메모 파일을 읽지 못해서 메모 없이 시작했어요."),
      repeats: t("반복 할 일 파일을 읽지 못해서 반복 없이 시작했어요."), events: t("일정 파일을 읽지 못해서 일정 없이 시작했어요."),
      alarms: t("알람 파일을 읽지 못해서 알람 없이 시작했어요."),
    }[what];
    try {
      fs.copyFileSync(file, backup);
      this.storageError = `${starting ? emptied : unread} ${keptAside(backup)}`;
    } catch {
      this.storageError = `${unread} ${t("저장 폴더가 열리는지 확인해 주세요.")}`;
    }
  }

  private saveRepeats(): void {
    const contents = serializeSeries(this.series);
    if (contents === this.known.get("repeats.json")) return;
    if (!this.mayWrite("repeats.json")) return;
    try {
      this.writeAtomically(this.repeatsPath, contents);
      this.noteKnown("repeats.json", contents);
      this.clearError(t("반복 할 일을 저장하지 못했어요."));
    } catch {
      this.reportError(saveProblem(t("반복 할 일을 저장하지 못했어요.")));
    }
  }

  setPref<K extends keyof Prefs>(key: K, value: Prefs[K]): void {
    if (this.prefs[key] === value) return;
    this.prefs = { ...this.prefs, [key]: value };
    this.saveSettingsSoon();
    this.emit("prefs", key);
    this.changed();
  }

  remember(memory: Partial<WindowMemory>): void {
    this.memory = { ...this.memory, ...memory };
    this.saveSettingsSoon();
  }

  /** Runs `work` holding AI 연결's write lock when it is on (briefly: after 300 ms it goes on without). */
  locked<T>(work: () => T): T {
    if (!this.aiLock || this.lockDepth > 0) {
      this.lockDepth += 1;
      try { return work(); } finally { this.lockDepth -= 1; }
    }
    const release = takeLock(this.aiLock, { waitMs: 300 });
    this.lockDepth += 1;
    try { return work(); } finally { this.lockDepth -= 1; release?.(); }
  }

  changed(): void {
    clearTimeout(this.memoChangeTimer);
    this.emit("change");
  }

  private reportError(message: string): void {
    if (this.storageError === message) return;
    this.storageError = message;
    this.changed();
  }

  private clearError(prefix: string): void {
    if (!this.storageError?.startsWith(prefix)) return;
    this.storageError = undefined;
    this.changed();
  }

  retrySave(): void {
    this.saveNotebook(serializeNotebook(this.history.notebook));
    this.changed();
  }

  flush(): void {
    clearTimeout(this.memoTimer);
    this.saveMemos();
    if (this.settingsTimer) {
      clearTimeout(this.settingsTimer);
      this.writeSettings();
    }
  }

  private loadNotebook(): void {
    const text = this.readDisk("todos.json");
    this.noteKnown("todos.json", text);
    if (text === undefined) return;
    try {
      this.history = new UndoableNotebook(parseNotebook(text));
    } catch {
      const backup = this.notebookPath.replace(/\.json$/, `.unreadable-${Math.floor(Date.now() / 1000)}.json`);
      try {
        fs.copyFileSync(this.notebookPath, backup);
        this.storageError = `${t("목록 파일을 읽지 못해서 빈 목록으로 시작했어요.")} ${keptAside(backup)}`;
      } catch {
        this.canSave = false;
        this.storageError = t("목록 파일을 읽지 못했어요. 원래 파일을 지키려고 그 위에 저장하지 않아요. 여기 적은 건 ‘텍스트로 내보내기’로 따로 남겨 두세요.");
      }
    }
  }

  /** Writes to a temporary file and renames it, so a crash never leaves a half-written list. */
  private saveNotebook(contents: string): void {
    if (!this.canSave || !this.mayWrite("todos.json")) return;
    try {
      this.writeAtomically(this.notebookPath, contents);
      this.noteKnown("todos.json", contents);
      if (this.storageError?.startsWith(t("할 일을 저장하지 못했어요."))) this.storageError = undefined;
    } catch {
      this.storageError = saveProblem(t("할 일을 저장하지 못했어요."));
    }
  }

  // ─── Sharing a folder with other computers ──────────────────────────────────

  private pathOf(file: SharedFile): string {
    return file === "todos.json" ? this.notebookPath : file === "memos.json" ? this.memosPath : file === "events.json" ? this.eventsPath : file === "alarms.json" ? this.alarmsPath
      : file === memoFoldersFileName ? this.memoFoldersPath : file === todoSpacesFileName ? this.todoSpacesPath : this.repeatsPath;
  }

  private readDisk(file: SharedFile): string | undefined {
    try {
      return fs.readFileSync(this.pathOf(file), "utf8");
    } catch {
      return undefined;
    }
  }

  /** Writes to a temporary file and renames it, so a crash (or a sync client) never sees half a file. */
  private writeAtomically(file: string, contents: string): void {
    const temporary = `${file}.tmp`;
    fs.writeFileSync(temporary, contents, "utf8");
    fs.renameSync(temporary, file);
  }

  /** A write is allowed only once this app has caught up with the file on disk. */
  private mayWrite(file: SharedFile): boolean {
    if (!this.differs(file)) return true;
    // Newer data came in: memory now matches the disk, and the stale contents must not be written.
    const replaced = this.reload(file);
    return !replaced && !this.differs(file);
  }

  /** Reads back any shared file that changed on disk since this app last read or wrote it. */
  catchUp(files: readonly SharedFile[] = sharedFiles, deep = false): boolean {
    let changed = false;
    for (const file of files) if (this.differs(file, deep)) changed = this.reload(file) || changed;
    return changed;
  }

  /** The text this app last read or wrote for a file, and the file's size and time then (see `differs`). */
  private noteKnown(file: SharedFile, text: string | undefined): void {
    this.known.set(file, text);
    this.stamps.set(file, text === undefined ? undefined : this.stampOf(file));
  }

  private stampOf(file: SharedFile): string | undefined {
    try {
      const stat = fs.statSync(this.pathOf(file));
      return `${stat.size}:${stat.mtimeMs}:${stat.ino}`;
    } catch {
      return undefined;
    }
  }

  /**
   * Whether the file on disk is not the text this app last read or wrote. A file with the same size, time
   * and inode as then is taken as unchanged without reading it (every change checks first, and the folder is
   * looked at every 30 seconds); `deep` reads it anyway (every fifth look, for folders that keep times oddly).
   */
  private differs(file: SharedFile, deep = false): boolean {
    const known = this.known.get(file);
    if (!deep && known !== undefined) {
      const stamp = this.stampOf(file);
      if (stamp !== undefined && stamp === this.stamps.get(file)) return false;
    }
    const text = this.readDisk(file);
    if (text !== known) return true;
    if (text !== undefined) this.stamps.set(file, this.stampOf(file));
    return false;
  }

  /**
   * Takes the file on disk: the list (undo history starts over), memos (keeping edits made here
   * since the last write) or repeats. A file that can't be read yet — perhaps still arriving — is
   * tried again shortly; one that stays unreadable is kept aside and then written over.
   */
  private reload(file: SharedFile): boolean {
    const text = this.readDisk(file);
    if (text === this.known.get(file)) return false;
    if (text === undefined) {
      // Deleted elsewhere (or mid-replace): keep what is here; the next change writes it back.
      this.noteKnown(file, undefined);
      return false;
    }
    try {
      if (file === "todos.json") {
        const theirs = parseNotebook(text);
        const known = this.known.get(file);
        // AI 연결 on: Claude's change comes in without wiping the undo history (when nothing here is unsaved).
        if (this.aiLock && known !== undefined && this.canSave && serializeNotebook(this.history.notebook) === known) this.history.absorb(parseNotebook(known), theirs);
        else this.history = new UndoableNotebook(theirs);
        this.canSave = true;
      } else if (file === "repeats.json") {
        this.series = parseSeries(text);
      } else if (file === "events.json") {
        this.events = parseEvents(text);
        this.eventsVersion += 1;
      } else if (file === "alarms.json") {
        this.alarms = parseAlarms(text);
      } else if (file === todoSpacesFileName) {
        // Another device's spaces (W3): the file's copy is the one already there; this device's wins only where newer.
        this.todoSpaces = mergeTodoSpaces(parseTodoSpaces(text), this.todoSpaces);
      } else if (file === memoFoldersFileName) {
        // Another device's folders: merged entry by entry (D13, D14), so nothing changed here is lost.
        this.memoFolders = mergeMemoFolders(this.memoFolders, parseMemoFolders(text, lang()));
      } else {
        const mine = new Set(this.memoEdits);
        if (this.typedOpenMemo) mine.add(this.typedOpenMemo);
        let base: Memo[] = [];
        try { base = parseMemos(this.known.get(file) ?? '{"memos":[]}'); } catch { /* nothing to start from */ }
        this.memos = mergeMemos(base, this.memos, parseMemos(text), mine, this.memoDeletions);
      }
    } catch {
      const failures = (this.failedReads.get(file) ?? 0) + 1;
      this.failedReads.set(file, failures);
      if (failures < 3) {
        this.syncSoon(file, 1500);
        return false;
      }
      this.failedReads.delete(file);
      if (file === todoSpacesFileName) {
        // Kept aside; this device's spaces are written in its place.
        this.keepSpacesAside();
        this.saveTodoSpaces();
        this.changed();
        return false;
      }
      if (file === memoFoldersFileName) {
        // Kept aside; this device's folders are written in its place.
        this.keepFoldersAside(false);
        this.saveMemoFolders();
        this.changed();
        return false;
      }
      this.keepUnreadable(this.pathOf(file), file === "todos.json" ? "list" : file === "memos.json" ? "memos" : file === "events.json" ? "events" : file === "alarms.json" ? "alarms" : "repeats", false);
      this.noteKnown(file, text);
      this.changed();
      return false;
    }
    this.failedReads.delete(file);
    this.noteKnown(file, text);
    this.emit("reloaded", file);
    if (file === "events.json") this.emit("events");
    if (file === "alarms.json") this.emit("alarms");
    this.changed();
    return true;
  }

  private syncSoon(file: SharedFile, delay = 500): void {
    clearTimeout(this.syncTimers.get(file));
    this.syncTimers.set(file, setTimeout(() => {
      this.syncTimers.delete(file);
      this.catchUp([file]);
    }, delay));
  }

  /**
   * Watches the data folder for the five shared files (the folder rather than the files, since
   * every save replaces the file). Cloud folders don't always report changes, so it also looks
   * every 30 seconds.
   */
  watch(): void {
    if (this.watcher || this.poll) return;
    try {
      this.watcher = fs.watch(this.dataDirectory, (_event, filename) => {
        const name = filename?.toString();
        if (!name) for (const file of sharedFiles) this.syncSoon(file);
        else if ((sharedFiles as readonly string[]).includes(name)) this.syncSoon(name as SharedFile);
      });
      this.watcher.on("error", () => { this.watcher?.close(); this.watcher = undefined; });
    } catch {
      // No change notifications here (some network drives): the poll below still notices.
    }
    let looks = 0;
    this.poll = setInterval(() => this.catchUp(sharedFiles, ++looks % 5 === 0), 30_000);
    this.poll.unref?.();
  }

  unwatch(): void {
    this.watcher?.close();
    this.watcher = undefined;
    clearInterval(this.poll);
    this.poll = undefined;
    for (const timer of this.syncTimers.values()) clearTimeout(timer);
    this.syncTimers.clear();
  }

  private loadSettings(): void {
    try {
      const saved = JSON.parse(fs.readFileSync(this.settingsPath, "utf8")) as { prefs?: Partial<Prefs>; memory?: WindowMemory };
      // Settings this version no longer has (Google 캘린더 · Tasks before 1.16.0) are left behind.
      const known = Object.fromEntries(Object.entries(saved.prefs ?? {}).filter(([key]) => key in defaultPrefs)) as Partial<Prefs>;
      this.prefs = {
        ...defaultPrefs, ...known, paper: readPaper(known.paper),
        // 메모 서랍's device settings, kept within what the drawer can take.
        drawerShortcut: readDrawerShortcut(known.drawerShortcut), drawerShortcutLast: readDrawerShortcut(known.drawerShortcutLast) || defaultPrefs.drawerShortcutLast, drawerWidth: clampDrawerWidth(known.drawerWidth), drawerTheme: readDrawerTheme(known.drawerTheme),
        drawerSide: known.drawerSide === "left" ? "left" : "right",
        drawerBackdrop: readDrawerBackdrop(known.drawerBackdrop), drawerPinnedSort: readSort(known.drawerPinnedSort),
        drawerRecentMoves: Array.isArray(known.drawerRecentMoves) ? known.drawerRecentMoves.filter((id): id is string => typeof id === "string").slice(0, 2) : [],
        spaceLens: readLens(known.spaceLens) ?? null,
        drawerHandleY: typeof known.drawerHandleY === "number" && known.drawerHandleY >= 0 && known.drawerHandleY <= 1 ? known.drawerHandleY : defaultPrefs.drawerHandleY,
      };
      this.memory = saved.memory ?? {};
    } catch {
      // First launch or unreadable settings: defaults are fine.
    }
  }

  private saveSettingsSoon(): void {
    if (this.settingsTimer) clearTimeout(this.settingsTimer);
    this.settingsTimer = setTimeout(() => this.writeSettings(), 300);
  }

  private writeSettings(): void {
    this.settingsTimer = undefined;
    const temporary = `${this.settingsPath}.tmp`;
    try {
      fs.writeFileSync(temporary, JSON.stringify({ prefs: this.prefs, memory: this.memory }, null, 2), "utf8");
      fs.renameSync(temporary, this.settingsPath);
    } catch {
      // Settings are a convenience; the list itself reports save failures.
    }
  }

  /** Today's sheet, then 앞으로 (dated, soonest first) and 언젠가 under their own headings. */
  plainText(now = new Date()): string {
    // 시간 정하기: "[ ] 보고서 (14:00–15:30)", before any deadline note.
    const line = (item: TodoItem) => `${item.isCompleted ? "[x]" : "[ ]"} ${item.title}${exportRange(item, lang())}`;
    let text = this.todayItems.map(line).join("\r\n") + "\r\n";
    const dated = this.items.filter((item) => pageOf(item, now) === "deadline").sort((a, b) => a.dueDate!.localeCompare(b.dueDate!));
    const someday = this.items.filter((item) => pageOf(item, now) === "later");
    for (const [heading, list] of [[t("앞으로"), dated], [t("언젠가"), someday]] as const) {
      if (list.length > 0) text += `\r\n[${heading}]\r\n` + list.map((item) => line(item) + (item.dueDate ? ` (~${item.dueDate})` : "")).join("\r\n") + "\r\n";
    }
    return text;
  }
}
