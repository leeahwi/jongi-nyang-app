import { dayKey } from "./archive";
import { clock, dayWord, shortDate, timeRange as clockRange, type Lang } from "./lang";
import type { TodoItem } from "./notebook";

/**
 * 할 일 시간 정하기 (1.24): a to-do's time on its day — a start and an end ("14:00–15:30"), or a start alone
 * (drawn as 30 minutes). Kept on the task as `timeStart` / `timeEnd` ("HH:mm"), left out when there is none.
 * Times are read on the app's 4 a.m. day ("logical minutes": before 04:00 is the night after), so 23:00–01:00
 * is a range and 03:00–05:00 is not. The day is the task's deadline, or today while it sits on today's sheet
 * (not 언젠가). Same rules as the macOS app (TimeBlock.swift); shared cases in timeblock-cases.md.
 */

export interface TimeRange {
  /** Minutes after midnight (a clock: 0…1439). */
  start: number;
  /** A clock after `start` on the 4 a.m. day (01:00 after 23:00); undefined = a start alone. */
  end?: number;
}

/** A clock's place in the 4 a.m. day: before 04:00 counts as the night after (1440 + …). */
export const logicalMinutes = (minutes: number): number => (minutes < 240 ? minutes + 1440 : minutes);

/** Where the range lies in its day, in logical minutes (the end as drawn: a start alone is 30 minutes, never past 04:00). */
export function span(range: TimeRange): { from: number; to: number } {
  const from = logicalMinutes(range.start);
  return { from, to: range.end !== undefined ? logicalMinutes(range.end) : Math.min(from + defaultLength, 1680) };
}

/** A start alone lasts this long on the ribbon, the week view and in 다음's order. */
export const defaultLength = 30;

const pad = (value: number) => String(value).padStart(2, "0");

/** "9:05", "09:05" → minutes after midnight; anything else undefined. */
export function clockMinutes(text: unknown): number | undefined {
  if (typeof text !== "string") return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return undefined;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : undefined;
}

/** Minutes after midnight → "HH:mm". */
export const clockKey = (minutes: number): string => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** The range kept on a task, when its start reads (an end that doesn't, or isn't after the start, is left out). */
export function rangeOf(item: Pick<TodoItem, "timeStart" | "timeEnd">): TimeRange | undefined {
  const start = clockMinutes(item.timeStart);
  if (start === undefined) return undefined;
  const end = clockMinutes(item.timeEnd);
  return end !== undefined && logicalMinutes(end) > logicalMinutes(start) ? { start, end } : { start };
}

/** The fields to keep for `range` (none for undefined): written as "HH:mm". */
export function rangeFields(range: TimeRange | undefined): { timeStart?: string; timeEnd?: string } {
  if (!range) return {};
  return { timeStart: clockKey(range.start), ...(range.end !== undefined ? { timeEnd: clockKey(range.end) } : {}) };
}

/** A range that can be kept: clocks, and an end (if any) after the start on the 4 a.m. day. */
export const validRange = (range: TimeRange): boolean =>
  Number.isInteger(range.start) && range.start >= 0 && range.start < 1440 &&
  (range.end === undefined || (Number.isInteger(range.end) && range.end >= 0 && range.end < 1440 && logicalMinutes(range.end) > logicalMinutes(range.start)));

/** The end as drawn, in logical minutes (see `span`). */
export const drawnEnd = (range: TimeRange): number => span(range).to;

/** "14:00–15:30" · "2:00–3:30 PM" · "14:00–15:30"; a start alone is its clock ("14:00", "2:00 PM"). */
export function rangeText(range: TimeRange, lang: Lang = "ko"): string {
  const start = { hour: Math.floor(range.start / 60), minute: range.start % 60 };
  if (range.end === undefined) return clock(start.hour, start.minute, lang);
  return clockRange(start, { hour: Math.floor(range.end / 60) % 24, minute: range.end % 60 }, lang);
}

/** The range as the ribbon's tooltip says it, with the drawn end: "보고서 · 14:00–15:30". */
export function blockTooltip(item: TodoItem, lang: Lang = "ko"): string {
  const range = rangeOf(item);
  return range ? `${item.title} · ${rangeText({ start: range.start, end: drawnEnd(range) }, lang)}` : item.title;
}

/** The day ("yyyy-MM-dd") a task's range is on: its deadline, or the logical today unless it is saved for 언젠가. */
export function rangeDay(item: Pick<TodoItem, "dueDate" | "shelf">, now: Date): string | undefined {
  if (item.dueDate) return item.dueDate;
  return item.shelf === "later" ? undefined : dayKey(now);
}

const midnightOf = (day: string): Date => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date);
};
const at = (day: string, minutes: number): Date => {
  const midnight = midnightOf(day);
  return new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate(), Math.floor(minutes / 60), minutes % 60);
};

/** The range as times on its day (the end as drawn), or undefined without a range or a day. */
export function rangeTimes(item: TodoItem, now: Date): { day: string; start: Date; end: Date; range: TimeRange } | undefined {
  const range = rangeOf(item);
  const day = range ? rangeDay(item, now) : undefined;
  if (!range || !day) return undefined;
  const { from, to } = span(range);
  return { day, start: at(day, from), end: at(day, to), range };
}

/** The range is today (the logical day) — what the ribbon draws and 다음 orders. */
export function rangeToday(item: TodoItem, now: Date): { start: Date; end: Date; range: TimeRange } | undefined {
  const times = rangeTimes(item, now);
  return times && times.day === dayKey(now) ? times : undefined;
}

/** Over and still open (the ribbon's clay outline). */
export function rangeOverdue(item: TodoItem, now: Date): boolean {
  const times = rangeTimes(item, now);
  return Boolean(times && !item.isCompleted && times.end.getTime() <= now.getTime());
}

/**
 * The reminder after the range changes from what the task has to `range` (undefined = cleared): a task
 * without a reminder gets one at the new start when that is still ahead; a reminder at the old start moves
 * with it; any other reminder stays. Clearing the range leaves the reminder as it is. (ISO strings.)
 */
export function reminderFor(item: TodoItem, range: TimeRange | undefined, now: Date): Date | undefined {
  const current = item.reminderAt ? new Date(item.reminderAt) : undefined;
  if (!range) return current;
  const { timeStart: _start, timeEnd: _end, ...rest } = item;
  const moved = rangeTimes({ ...rest, ...rangeFields(range) }, now);
  if (!moved) return current;
  if (current) {
    const before = rangeTimes(item, now);
    return before && before.start.getTime() === current.getTime() ? moved.start : current;
  }
  return moved.start.getTime() > now.getTime() ? moved.start : undefined;
}

/** The task with its range set (or cleared) and the reminder that goes with it (see `reminderFor`). */
export function withRange(item: TodoItem, range: TimeRange | undefined, now: Date): TodoItem {
  const reminder = reminderFor(item, range, now);
  const next: TodoItem = { ...item };
  delete next.timeStart;
  delete next.timeEnd;
  Object.assign(next, rangeFields(range));
  const iso = reminder?.toISOString().replace(/\.\d{3}Z$/, "Z");
  if (iso !== item.reminderAt) {
    if (iso) next.reminderAt = iso; else delete next.reminderAt;
    delete next.reminderLastDeliveredAt;
    // Moved to a start already past (a drag back in time): it counts as rung, so no bubble pops up at once.
    if (reminder && reminder.getTime() <= now.getTime()) next.reminderLastDeliveredAt = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  }
  return next;
}

/** Begun within this long after the range's start, 집중 offers the whole range (a 30-minute task started at 14:01 is 30, not 29). */
export const focusGraceMs = 5 * 60_000;

/** 집중's first length for a ranged task, 1…180 (undefined unless today and not over): the whole range when started
 *  before it or within its first 5 minutes, otherwise the minutes left until its end, rounded up. Same rule as the Mac. */
export function focusMinutes(item: TodoItem, now: Date): number | undefined {
  const times = rangeToday(item, now);
  if (!times || times.end.getTime() <= now.getTime()) return undefined;
  const from = now.getTime() - times.start.getTime() <= focusGraceMs ? times.start.getTime() : now.getTime();
  const minutes = Math.ceil((times.end.getTime() - from) / 60_000);
  return minutes >= 1 && minutes <= 180 ? minutes : undefined;
}

/** The copy and export text's part: " (14:00–15:30)". */
export const exportRange = (item: TodoItem, lang: Lang = "ko"): string => {
  const range = rangeOf(item);
  return range ? ` (${rangeText(range, lang)})` : "";
};

/**
 * A drag on the ribbon: the range after moving `edge` by `delta` minutes, in 15-minute steps, inside `bounds`
 * (logical minutes: the track's hours, 4–28), at least 15 minutes long. Returns clocks again.
 */
export function dragged(range: TimeRange, edge: "start" | "end" | "whole", delta: number, bounds: { low: number; high: number }): TimeRange {
  const step = Math.round(delta / 15) * 15;
  const { from, to } = span(range);
  // On the quarter hours inside the track; never past the day's end at 04:00.
  const low = Math.ceil(Math.max(240, bounds.low) / 15) * 15, high = Math.floor(Math.min(1680, bounds.high) / 15) * 15;
  const clock = (minutes: number) => ((minutes % 1440) + 1440) % 1440;
  if (edge === "start") return { start: clock(Math.min(Math.max(low, from + step), to - 15)), end: clock(to) };
  if (edge === "end") return { start: range.start, end: clock(Math.max(from + 15, Math.min(high, to + step))) };
  const length = to - from;
  const moved = Math.min(Math.max(low, from + step), high - length);
  return range.end === undefined ? { start: clock(moved) } : { start: clock(moved), end: clock(moved + length) };
}

/** The range's day in words: "오늘" · "today" · "vandaag", "내일" · "tomorrow" · "morgen" (by the 4 a.m. day), else "10월 12일 (월)" · "Mon, Oct 12" · "ma 12 okt". */
export function rangeDayText(day: string, now: Date, lang: Lang = "ko"): string {
  const date = midnightOf(day);
  const today = midnightOf(dayKey(now));
  const offset = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (offset === 0 || offset === 1) return lang === "ko" ? dayWord(offset, lang)! : dayWord(offset, lang)!.toLowerCase();
  return shortDate(date, lang);
}

/** "오늘 14:00–15:30" · "today 2:00–3:30 PM" · "vandaag 14:00–15:30": the chip, the toast and the editor's summary. */
export const rangeWhenText = (day: string, range: TimeRange, now: Date, lang: Lang = "ko"): string => `${rangeDayText(day, now, lang)} ${rangeText(range, lang)}`;
