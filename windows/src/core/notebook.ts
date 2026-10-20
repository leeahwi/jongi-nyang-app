import type { AheadTarget } from "./ahead";
import { rangeFields, rangeOf, withRange, type TimeRange } from "./timeRange";

/** Same data model and JSON shape as the macOS app, so todos.json can move between them. */
export interface TodoItem {
  id: string;
  title: string;
  isCompleted: boolean;
  createdAt: string;
  /** When it was last checked off; cleared when unchecked. Drives archiving and the history calendar. */
  completedAt?: string;
  reminderAt?: string;
  reminderLastDeliveredAt?: string;
  /** Set on copies of a recurring task (see repeat.ts). */
  seriesID?: string;
  /** The last day to get it done, "yyyy-MM-dd" (see deadline.ts). */
  dueDate?: string;
  /** Saved for later, or pinned to today (see shelf.ts); absent follows the deadline. */
  shelf?: "later" | "today";
  /**
   * The logical (4 a.m.) day, "yyyy-MM-dd", this open undated task was first seen on 오늘 — for the
   * 어제부터 / 3일째 tag (see carry.ts). Kept only while the task is on 오늘 without a deadline.
   */
  todaySince?: string;
  /** 시간 정하기: the start on its day, "HH:mm" (see timeRange.ts). */
  timeStart?: string;
  /** …and the end, "HH:mm", after the start; absent with a start alone (30 minutes). */
  timeEnd?: string;
}

export interface NotebookData {
  items: TodoItem[];
}

/** Swift's ISO 8601 decoder rejects fractional seconds, so dates are written without them. */
export function isoDate(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function cleanedTitle(raw: string): string | undefined {
  const title = raw.replace(/\r?\n/g, " ").trim();
  return title.length > 0 ? title : undefined;
}

export function newID(): string {
  return crypto.randomUUID().toUpperCase();
}

/** Throws on blank titles or duplicate IDs, like the Swift decoder, so a damaged file is backed up instead of silently trimmed. */
export function parseNotebook(json: string): NotebookData {
  const value = JSON.parse(json) as { items?: unknown };
  if (!value || !Array.isArray(value.items)) throw new Error("items missing");
  const seen = new Set<string>();
  const items: TodoItem[] = [];
  for (const raw of value.items as Record<string, unknown>[]) {
    const title = typeof raw.title === "string" ? cleanedTitle(raw.title) : undefined;
    if (!title || typeof raw.id !== "string" || seen.has(raw.id)) throw new Error("invalid item");
    if (typeof raw.isCompleted !== "boolean" || typeof raw.createdAt !== "string") throw new Error("invalid item");
    seen.add(raw.id);
    const item: TodoItem = { id: raw.id, title, isCompleted: raw.isCompleted, createdAt: raw.createdAt };
    if (typeof raw.completedAt === "string") item.completedAt = raw.completedAt;
    if (typeof raw.reminderAt === "string") item.reminderAt = raw.reminderAt;
    if (typeof raw.reminderLastDeliveredAt === "string") item.reminderLastDeliveredAt = raw.reminderLastDeliveredAt;
    if (typeof raw.seriesID === "string") item.seriesID = raw.seriesID;
    if (typeof raw.dueDate === "string") item.dueDate = raw.dueDate;
    if (raw.shelf === "later" || raw.shelf === "today") item.shelf = raw.shelf;
    if (typeof raw.todaySince === "string") item.todaySince = raw.todaySince;
    // A range that doesn't read is left out (an end that isn't after the start goes alone).
    Object.assign(item, rangeFields(rangeOf({ timeStart: raw.timeStart as string | undefined, timeEnd: raw.timeEnd as string | undefined })));
    items.push(item);
  }
  return { items };
}

export function serializeNotebook(notebook: NotebookData): string {
  const items = notebook.items.map((item) => {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(item).sort()) sorted[key] = item[key as keyof TodoItem];
    return sorted;
  });
  return JSON.stringify({ items }, null, 2) + "\n";
}

const clone = (notebook: NotebookData): NotebookData => ({ items: notebook.items.map((item) => ({ ...item })) });
const same = (a: NotebookData, b: NotebookData) => JSON.stringify(a) === JSON.stringify(b);

/** A notebook with undo/redo. Each step keeps a copy, so history is capped. */
export class UndoableNotebook {
  static readonly undoLimit = 200;
  private undoStack: NotebookData[] = [];
  private redoStack: NotebookData[] = [];

  constructor(private current: NotebookData = { items: [] }) {}

  get notebook(): NotebookData { return this.current; }
  get items(): readonly TodoItem[] { return this.current.items; }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }
  get activeCount() { return this.current.items.filter((item) => !item.isCompleted).length; }
  get completedCount() { return this.current.items.filter((item) => item.isCompleted).length; }

  add(raw: string, now = new Date(), id = newID()): TodoItem | undefined {
    const title = cleanedTitle(raw);
    if (!title || this.current.items.some((item) => item.id === id)) return undefined;
    const item: TodoItem = { id, title, isCompleted: false, createdAt: isoDate(now) };
    this.perform((notebook) => notebook.items.push(item));
    return item;
  }

  edit(id: string, raw: string): boolean {
    const title = cleanedTitle(raw);
    if (!title) return false;
    return this.perform((notebook) => {
      const item = notebook.items.find((entry) => entry.id === id);
      if (item) item.title = title;
    });
  }

  toggle(id: string, now = new Date()): boolean {
    return this.perform((notebook) => {
      const item = notebook.items.find((entry) => entry.id === id);
      if (!item) return;
      item.isCompleted = !item.isCompleted;
      if (item.isCompleted) item.completedAt = isoDate(now); else delete item.completedAt;
    });
  }

  /**
   * Moves finished tasks out of the list. Like delivery, this is bookkeeping rather than an
   * edit: the tasks leave every undo/redo snapshot too, so undo can't bring back (and later
   * re-archive) a task that already lives in the record.
   */
  archive(ids: ReadonlySet<string>): TodoItem[] {
    const removed = this.current.items.filter((item) => ids.has(item.id));
    if (removed.length === 0) return [];
    const strip = (notebook: NotebookData): NotebookData => ({ items: notebook.items.filter((item) => !ids.has(item.id)) });
    this.current = strip(this.current);
    this.undoStack = this.undoStack.map(strip);
    this.redoStack = this.redoStack.map(strip);
    return removed;
  }

  setReminder(id: string, date: Date | undefined): boolean {
    return this.perform((notebook) => {
      const item = notebook.items.find((entry) => entry.id === id);
      const next = date ? isoDate(date) : undefined;
      if (!item || item.reminderAt === next) return;
      if (next) item.reminderAt = next; else delete item.reminderAt;
      delete item.reminderLastDeliveredAt;
    });
  }

  /** 시간 정하기 · 시간 지우기 (and a drag on the ribbon): the range, and the reminder that goes with it (timeRange.ts), as one undo step. */
  setRange(id: string, range: TimeRange | undefined, now = new Date()): boolean {
    return this.perform((notebook) => {
      const index = notebook.items.findIndex((entry) => entry.id === id);
      if (index < 0) return;
      notebook.items[index] = withRange(notebook.items[index], range, now);
    });
  }

  /** Delivery is bookkeeping, not an edit: it is not an undo step and is copied into history so undo can't re-arm a delivered alert. */
  markReminderDelivered(id: string, date: Date): boolean {
    const item = this.current.items.find((entry) => entry.id === id);
    if (!item?.reminderAt) return false;
    const scheduledAt = item.reminderAt;
    const stamp = isoDate(date);
    for (const notebook of [this.current, ...this.undoStack, ...this.redoStack]) {
      const match = notebook.items.find((entry) => entry.id === id && entry.reminderAt === scheduledAt);
      if (match) match.reminderLastDeliveredAt = stamp;
    }
    return true;
  }

  setDue(id: string, dueDate: string | undefined): boolean {
    return this.perform((notebook) => {
      const item = notebook.items.find((entry) => entry.id === id);
      if (!item) return;
      if (dueDate) item.dueDate = dueDate; else delete item.dueDate;
    });
  }

  setShelf(id: string, shelf: "later" | "today" | undefined): boolean {
    return this.perform((notebook) => {
      const item = notebook.items.find((entry) => entry.id === id);
      if (!item) return;
      if (shelf) item.shelf = shelf; else delete item.shelf;
    });
  }

  /** A deadline plus whether it also stays on today's sheet, as one undo step. */
  setDeadline(id: string, dueDate: string, keepOnToday: boolean): boolean {
    return this.perform((notebook) => {
      const item = notebook.items.find((entry) => entry.id === id);
      if (!item) return;
      item.dueDate = dueDate;
      if (keepOnToday) item.shelf = "today";
      else if (item.shelf === "today") delete item.shelf;
    });
  }

  /** Adds a task straight onto a shelf (or with a deadline, or an alert) as one undo step. */
  addTo(raw: string, shelf: "later" | "today" | undefined, now = new Date(), dueDate?: string, reminderAt?: string, range?: TimeRange): TodoItem | undefined {
    const title = cleanedTitle(raw);
    if (!title) return undefined;
    const item: TodoItem = {
      id: newID(), title, isCompleted: false, createdAt: isoDate(now),
      ...(reminderAt ? { reminderAt } : {}), ...(shelf ? { shelf } : {}), ...(dueDate ? { dueDate } : {}), ...rangeFields(range),
    };
    this.perform((notebook) => notebook.items.push(item));
    return item;
  }

  /**
   * 앞으로: a task dropped on a day (due that day, off any shelf), on 언젠가 (the 나중에 shelf, no
   * deadline) or on the 오늘 tab (pinned to today when it has a deadline) — and, given `near`, put
   * just before or after that task in the list — as one undo step.
   */
  dropAhead(id: string, target: AheadTarget, near?: { id: string; after: boolean }): boolean {
    return this.perform((notebook) => {
      const index = notebook.items.findIndex((entry) => entry.id === id);
      if (index < 0) return;
      const item = notebook.items[index];
      if (target.kind === "day") { item.dueDate = target.day; delete item.shelf; }
      else if (target.kind === "someday") { item.shelf = "later"; delete item.dueDate; }
      else if (item.dueDate) item.shelf = "today";
      else delete item.shelf;
      if (!near || near.id === id || !notebook.items.some((entry) => entry.id === near.id)) return;
      notebook.items.splice(index, 1);
      const at = notebook.items.findIndex((entry) => entry.id === near.id);
      notebook.items.splice(at + (near.after ? 1 : 0), 0, item);
    });
  }

  /**
   * 날짜 바꾸기 · 저녁 정리: tasks moved to a day (due then, off any shelf) or to 언젠가 (the 나중에 shelf,
   * no deadline), all as one undo step.
   */
  moveAll(ids: readonly string[], target: { kind: "day"; day: string } | { kind: "someday" }, options: { clearReminder?: boolean } = {}): boolean {
    const wanted = new Set(ids);
    return this.perform((notebook) => {
      for (const item of notebook.items) {
        if (!wanted.has(item.id)) continue;
        if (target.kind === "day") { item.dueDate = target.day; delete item.shelf; }
        else { item.shelf = "later"; delete item.dueDate; }
        // 내일로 미루기 from an alert: the alert that came goes too.
        if (options.clearReminder) { delete item.reminderAt; delete item.reminderLastDeliveredAt; }
      }
    });
  }

  /** 모두 끝냄: every open one of these checked, as one undo step. */
  completeAll(ids: readonly string[], now = new Date()): boolean {
    const wanted = new Set(ids);
    return this.perform((notebook) => {
      for (const item of notebook.items) if (wanted.has(item.id) && !item.isCompleted) { item.isCompleted = true; item.completedAt = isoDate(now); }
    });
  }

  /** Dropped on 언젠가 (or the 앞으로 tab): shelved for some day, without a deadline, as one undo step. */
  shelveForLater(id: string): boolean {
    return this.perform((notebook) => {
      const item = notebook.items.find((entry) => entry.id === id);
      if (!item) return;
      item.shelf = "later";
      delete item.dueDate;
    });
  }

  /** Links a task to a recurring series (or unlinks it). A normal, undoable edit. */
  setSeries(id: string, seriesID: string | undefined): boolean {
    return this.perform((notebook) => {
      const item = notebook.items.find((entry) => entry.id === id);
      if (!item) return;
      if (seriesID) item.seriesID = seriesID; else delete item.seriesID;
    });
  }

  /**
   * Links a task to a recurring series as one undo step. When the series has today's copy
   * (`placeToday`), the task leaves the "나중에" shelf and takes today's alert if given.
   */
  linkSeries(id: string, seriesID: string, placeToday: boolean, reminder?: Date): boolean {
    return this.perform((notebook) => {
      const item = notebook.items.find((entry) => entry.id === id);
      if (!item) return;
      item.seriesID = seriesID;
      if (!placeToday) return;
      if (item.shelf === "later") delete item.shelf;
      if (reminder && item.reminderAt !== isoDate(reminder)) {
        item.reminderAt = isoDate(reminder);
        delete item.reminderLastDeliveredAt;
      }
    });
  }

  /**
   * A series edited in Settings: its open copies take the new title and today's alert
   * (`reminderAt`, or none). Bookkeeping like `placeRecurring`, applied to every snapshot.
   */
  applySeries(seriesID: string, title: string, reminder: { at?: string } | undefined): void {
    for (const notebook of [this.current, ...this.undoStack, ...this.redoStack]) {
      for (const item of notebook.items) {
        if (item.seriesID !== seriesID || item.isCompleted) continue;
        item.title = title;
        if (!reminder || item.reminderAt === reminder.at) continue;
        if (reminder.at) item.reminderAt = reminder.at; else delete item.reminderAt;
        delete item.reminderLastDeliveredAt;
      }
    }
  }

  /**
   * Bookkeeping on the tasks' `todaySince` (see carry.ts): not an undo step, and copied into every
   * undo/redo snapshot that holds the task, so undoing an edit never brings back a stale day.
   */
  trackToday(changes: readonly { id: string; todaySince?: string }[]): boolean {
    if (changes.length === 0) return false;
    for (const notebook of [this.current, ...this.undoStack, ...this.redoStack]) {
      for (const change of changes) {
        const item = notebook.items.find((entry) => entry.id === change.id);
        if (!item) continue;
        // A day goes into older snapshots only where they have none; taking it away touches the list as it is now.
        if (notebook !== this.current && (item.todaySince !== undefined || change.todaySince === undefined)) continue;
        if (change.todaySince) item.todaySince = change.todaySince; else delete item.todaySince;
      }
    }
    return true;
  }

  /**
   * Places today's copies of recurring tasks. Like delivery, this is bookkeeping: the copies
   * enter every undo/redo snapshot, so undoing an unrelated edit never removes them.
   */
  placeRecurring(create: readonly TodoItem[], roll: readonly { id: string; reminderAt?: string }[]): void {
    const apply = (notebook: NotebookData) => {
      for (const change of roll) {
        const item = notebook.items.find((entry) => entry.id === change.id);
        if (!item) continue;
        if (change.reminderAt) item.reminderAt = change.reminderAt; else delete item.reminderAt;
        delete item.reminderLastDeliveredAt;
        // Today's occurrence belongs on today's sheet, even if the copy was shelved or has a later deadline.
        if (item.shelf === "later") delete item.shelf;
        if (item.dueDate) item.shelf = "today";
      }
      for (const item of create) if (!notebook.items.some((entry) => entry.id === item.id)) notebook.items.push({ ...item });
    };
    for (const notebook of [this.current, ...this.undoStack, ...this.redoStack]) apply(notebook);
  }

  /**
   * Takes back a task just made from the 입력 줄 (its toast's switch or Ctrl+Z): gone from the list
   * and from every undo/redo snapshot, as if it was never added — no undo step, nothing to archive.
   */
  retract(id: string): boolean {
    if (!this.current.items.some((item) => item.id === id)) return false;
    const strip = (notebook: NotebookData): NotebookData => ({ items: notebook.items.filter((item) => item.id !== id) });
    this.current = strip(this.current);
    this.undoStack = this.undoStack.map(strip).filter((notebook, index, list) => index === 0 || !same(notebook, list[index - 1]));
    this.redoStack = this.redoStack.map(strip);
    if (this.undoStack.length > 0 && same(this.undoStack[this.undoStack.length - 1], this.current)) this.undoStack.pop();
    return true;
  }

  /** Tasks put back on the list as they were (완료한 일 정리 taken back), as one undo step; ids already there are left. */
  restore(items: readonly TodoItem[]): boolean {
    return this.perform((notebook) => {
      for (const item of items) if (!notebook.items.some((entry) => entry.id === item.id)) notebook.items.push({ ...item });
    });
  }

  delete(id: string): boolean {
    return this.perform((notebook) => {
      notebook.items = notebook.items.filter((item) => item.id !== id);
    });
  }

  /** Moves to an insertion offset in the full list (0...count). */
  move(id: string, targetIndex: number): boolean {
    const sourceIndex = this.current.items.findIndex((item) => item.id === id);
    if (sourceIndex < 0 || targetIndex < 0 || targetIndex > this.current.items.length) return false;
    return this.perform((notebook) => {
      const [item] = notebook.items.splice(sourceIndex, 1);
      const adjusted = targetIndex > sourceIndex ? targetIndex - 1 : targetIndex;
      notebook.items.splice(Math.max(0, Math.min(adjusted, notebook.items.length)), 0, item);
    });
  }

  clearCompleted(): number {
    const before = this.current.items.length;
    this.perform((notebook) => {
      notebook.items = notebook.items.filter((item) => !item.isCompleted);
    });
    return before - this.current.items.length;
  }

  undo(): boolean {
    const previous = this.undoStack.pop();
    if (!previous) return false;
    this.redoStack.push(this.current);
    this.current = previous;
    return true;
  }

  redo(): boolean {
    const next = this.redoStack.pop();
    if (!next) return false;
    this.undoStack.push(this.current);
    this.current = next;
    return true;
  }

  private perform(mutation: (notebook: NotebookData) => void): boolean {
    const before = this.current;
    const draft = clone(before);
    mutation(draft);
    if (same(draft, before)) return false;
    this.undoStack.push(before);
    if (this.undoStack.length > UndoableNotebook.undoLimit) {
      this.undoStack.splice(0, this.undoStack.length - UndoableNotebook.undoLimit);
    }
    this.redoStack = [];
    this.current = draft;
    return true;
  }
}
