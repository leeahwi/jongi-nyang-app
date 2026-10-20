import { daysLeft } from "./deadline";
import type { TodoItem } from "./notebook";

/** Saved for later, or pinned to today; undefined follows the deadline (same as macOS ShelfPin). */
export type ShelfPin = "later" | "today";
export type TaskPage = "today" | "deadline" | "later";
/**
 * Today's sheet holds undated tasks, anything pinned to today, and deadlines that have
 * arrived (due today or overdue). Deadlines still ahead and tasks saved for later wait on the
 * 앞으로 page (by date, and 언젠가 for the undated ones; see ahead.ts).
 */
export function pageOf(item: TodoItem, now: Date): TaskPage {
  if (item.shelf === "today") return "today";
  if (item.dueDate) return (daysLeft(item.dueDate, now) ?? 0) <= 0 ? "today" : "deadline";
  return item.shelf === "later" ? "later" : "today";
}

// ─── Dragging a task onto a page tab ─────────────────────────────────────────

export type NoteTab = "today" | "ahead" | "memos";
export type TabDrop = { kind: "deadline"; dueDate: string } | { kind: "later" };

/** The tab under the pointer, if any; a few pixels of slack make the small tabs easy to hit. */
export function tabAt(tabs: readonly { tab: NoteTab; left: number; top: number; right: number; bottom: number }[], x: number, y: number, slack = 4): NoteTab | undefined {
  return tabs.find((rect) => x >= rect.left - slack && x <= rect.right + slack && y >= rect.top - slack && y <= rect.bottom + slack)?.tab;
}

/** Tabs a task from 오늘 can be dropped on (오늘 changes nothing; 메모 takes no tasks). */
export const dropTabs: readonly NoteTab[] = ["ahead"];

/**
 * What dropping a task from 오늘 on the 앞으로 tab does: a deadline still ahead stays (only the pin to
 * today goes, so it waits on its day); anything else goes to 언젠가 (the 나중에 shelf, no deadline).
 */
export function tabDrop(item: TodoItem, tab: NoteTab, now: Date): TabDrop | undefined {
  if (tab !== "ahead") return undefined;
  if (item.dueDate && (daysLeft(item.dueDate, now) ?? 0) > 0) return { kind: "deadline", dueDate: item.dueDate };
  return { kind: "later" };
}
