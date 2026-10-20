import { dayKey, logicalDayStart } from "./archive";
import { key as dueKey } from "./deadline";
import type { TodoItem } from "./notebook";
import { pageOf } from "./shelf";

/**
 * 저녁 정리 (편의 기능 4): once a day, at the chosen time, the cat offers to move what is left on 오늘 to
 * tomorrow or 언젠가; the first time the note opens on a new day after a missed evening, the morning
 * version offers the same for yesterday's leftovers. Shared cases: convenience-cases.md §4.
 */

/** The times the setting offers: 18:00 to 22:00 every half hour. */
export const sweepTimes: readonly string[] = ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00"];
export const defaultSweepTime = "20:00";

/** Open tasks on 오늘, not repeating copies, without a reminder still to come — in the list's order. */
export function sweepItems(items: readonly TodoItem[], now: Date): TodoItem[] {
  return items.filter((item) => !item.isCompleted && !item.seriesID && pageOf(item, now) === "today"
    && (!item.reminderAt || Date.parse(item.reminderAt) <= now.getTime()));
}

/** The logical day's sweep moment ("20:00" on the day that started at 4 a.m.). */
function sweepMoment(now: Date, time: string): Date {
  const start = logicalDayStart(now);
  const [hour, minute] = (/^\d{2}:\d{2}$/.test(time) ? time : defaultSweepTime).split(":").map(Number);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), hour, minute);
}

/** The day key before the logical day of `now`. */
export function yesterdayKey(now: Date): string {
  const start = logicalDayStart(now);
  return dueKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() - 1, 12));
}

export interface SweepSettings { enabled: boolean; time: string; /** The logical day the evening sweep last came for. */ shown: string }

/** Whether the evening sweep is due now: on, past the time, not yet today, something left. */
export function eveningDue(items: readonly TodoItem[], now: Date, settings: SweepSettings): boolean {
  if (!settings.enabled || settings.shown === dayKey(now)) return false;
  if (now.getTime() < sweepMoment(now, settings.time).getTime()) return false;
  return sweepItems(items, now).length > 0;
}

/**
 * The morning version (the note opened on a new day): yesterday's evening never came, and tasks carried
 * over from before today are still open. Returns those tasks (empty: nothing to ask).
 */
export function morningItems(items: readonly TodoItem[], now: Date, settings: SweepSettings): TodoItem[] {
  if (!settings.enabled) return [];
  const yesterday = yesterdayKey(now);
  if (settings.shown && settings.shown >= yesterday) return [];
  const today = dayKey(now);
  return sweepItems(items, now).filter((item) => typeof item.todaySince === "string" && item.todaySince < today);
}
