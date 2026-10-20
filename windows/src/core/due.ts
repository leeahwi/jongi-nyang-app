import type { TodoItem } from "./notebook";

/**
 * Which task alerts are due. Each device remembers what it has shown itself (`shownHere`), so in
 * a folder shared with another computer both show an alert when it comes due — the other one's
 * "delivered" mark doesn't silence this one. An alert another device already showed is left
 * alone once it is older than `freshness` (this device was off or asleep then).
 * Same rule as the macOS app (TaskReminderDue.swift).
 */
export const freshness = 10 * 60_000;

/** What this device records once it has shown an alert: the task and the alert's time. */
export function reminderKey(item: TodoItem): string | undefined {
  return item.reminderAt ? `${item.id}@${Math.floor(Date.parse(item.reminderAt) / 1000)}` : undefined;
}

function pending(items: readonly TodoItem[], now: number, shownHere: ReadonlySet<string>): TodoItem[] {
  return items.filter((item) => {
    if (item.isCompleted || !item.reminderAt) return false;
    if (shownHere.has(reminderKey(item)!)) return false;
    const at = Date.parse(item.reminderAt);
    if (!item.reminderLastDeliveredAt || Date.parse(item.reminderLastDeliveredAt) < at) return true;
    // Shown for this time already, elsewhere (or here before this device kept a record).
    return now - at < freshness;
  });
}

/** Open tasks whose alert time has passed and that this device hasn't shown yet, oldest first. */
export function readyItems(items: readonly TodoItem[], now: number, shownHere: ReadonlySet<string> = new Set()): TodoItem[] {
  return pending(items, now, shownHere)
    .filter((item) => Date.parse(item.reminderAt!) <= now)
    .sort((a, b) => Date.parse(a.reminderAt!) - Date.parse(b.reminderAt!) || Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** When the next alert is due (already past when one is waiting), or undefined. */
export function nextReminderTime(items: readonly TodoItem[], now = Date.now(), shownHere: ReadonlySet<string> = new Set()): number | undefined {
  const times = pending(items, now, shownHere).map((item) => Date.parse(item.reminderAt!));
  return times.length > 0 ? Math.min(...times) : undefined;
}
