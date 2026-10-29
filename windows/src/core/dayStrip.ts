import { dayKey, logicalDayStart } from "./archive";
import { todayEvents, type CalendarEvent } from "./calendar";
import { hasEventWord, type Candidate } from "./intent";
import { clock, langIndex, timeRange as clockRange, type Lang } from "./lang";
import type { TodoItem } from "./notebook";
import { awayText as ribbonAway } from "./ribbon";
import { rangeToday } from "./timeRange";

/**
 * 하루 띠 (1.25): the strip under the 오늘 sheet's header — what's on now (or next) in large with a ring of the
 * time left, the next few things as rows, a thin bar of the whole day — and, opened, the day as a timetable
 * (하루 일정표). Pure: the note draws what this decides. Same rules and cases as the macOS app (DayStrip.swift),
 * listed in ribbon-cases.md (R1–R14, K1–K8, G1–G4, N1–N5; 1.26's drag and stretch: the "R — stretching" rows).
 */

/** Events first, then to-dos with a time, then reminders, wherever two start in the same minute. */
export type StripKind = "event" | "task" | "reminder";
const kindRank: Record<StripKind, number> = { event: 0, task: 1, reminder: 2 };

/** One thing on today's sheet with a time: a timed event, a to-do's time (its block) or a to-do's reminder. */
export interface StripItem {
  /** The event's key ("local/<id>@<day>") or the to-do's id. */
  id: string;
  kind: StripKind;
  title: string;
  start: Date;
  /** A reminder has none. */
  end?: Date;
  event?: CalendarEvent;
  taskId?: string;
  done: boolean;
  /** A to-do with a time that also has a reminder (the bell in the sub line). */
  hasReminder: boolean;
  /** Where it came in (events in the calendar's order, then the to-dos in the list's). */
  order: number;
}

/** The 4 a.m. day in logical minutes: 04:00 … 04:00 the next morning. */
export const dayStartMinutes = 240;
export const dayEndMinutes = 1680;

/**
 * Today's items: the timed events (all-day ones are the top line's), every to-do whose time is on today (done ones
 * too — they're drawn faded and never current or next), and the open to-dos without a time today whose reminder is
 * on today's sheet. A to-do with a time is one item: its reminder, at whatever time, isn't a second one. `events`
 * are occurrences around today (filtered to the logical day here).
 */
export function stripItems(events: readonly CalendarEvent[], tasks: readonly TodoItem[], now: Date): StripItem[] {
  const dayStart = logicalDayStart(now).getTime(), dayEnd = dayStart + 86_400_000;
  const items: StripItem[] = [];
  for (const event of todayEvents(events, now)) {
    if (event.allDay) continue;
    items.push({ id: event.key, kind: "event", title: event.title, start: event.start, end: event.end, event, done: false, hasReminder: false, order: items.length });
  }
  for (const task of tasks) {
    const times = rangeToday(task, now);
    if (times) {
      items.push({ id: task.id, kind: "task", title: task.title, start: times.start, end: times.end, taskId: task.id, done: task.isCompleted, hasReminder: Boolean(task.reminderAt), order: items.length });
      continue;
    }
    const at = task.reminderAt ? Date.parse(task.reminderAt) : NaN;
    if (!task.isCompleted && at >= dayStart && at < dayEnd) {
      items.push({ id: task.id, kind: "reminder", title: task.title, start: new Date(at), taskId: task.id, done: false, hasReminder: true, order: items.length });
    }
  }
  return items;
}

// ─── Now and next ────────────────────────────────────────────────────────────

/** `now`: something is going on (the ring shows its time left); `next`: nothing is (the time until the next thing); `nothing`: nothing more today. */
export type StripMode = "now" | "next" | "nothing";

export interface StripState {
  mode: StripMode;
  /** The large one: what's on now, or (`next`) the next thing. */
  lead?: StripItem;
  /** Minutes left (`now`) or until it starts (`next`), rounded up, at least 1. */
  minutes: number;
  /** How far through it is (`now`, 0…1); `next`: how much of the last hour before it has gone (0 when it's more than an hour away). */
  progress: number;
  /** The rows under it: what starts after now, in order (after the lead when the lead is the next thing). */
  rows: StripItem[];
}

const endOf = (item: StripItem) => (item.end ?? item.start).getTime();

/**
 * What's going on now: of the open events and to-dos with a time that have started and not ended, the one that
 * started last (an event before a to-do at the same start, then the one ending first, then the order).
 */
export function currentItem(items: readonly StripItem[], now: Date): StripItem | undefined {
  return items.filter((item) => item.kind !== "reminder" && !item.done && item.start.getTime() <= now.getTime() && endOf(item) > now.getTime())
    .sort((a, b) => b.start.getTime() - a.start.getTime() || kindRank[a.kind] - kindRank[b.kind] || endOf(a) - endOf(b) || a.order - b.order)[0];
}

const ahead = (a: StripItem, b: StripItem) =>
  a.start.getTime() - b.start.getTime() || kindRank[a.kind] - kindRank[b.kind] || endOf(a) - endOf(b) || a.order - b.order;

/** What starts after now, open, in order: by start, then events · to-dos · reminders, then the one ending first, then the order. */
export function upcomingItems(items: readonly StripItem[], now: Date): StripItem[] {
  return items.filter((item) => !item.done && item.start.getTime() > now.getTime()).sort(ahead);
}

/** Minutes until, rounded up, at least 1 (an end at 14:00 is 40 at 13:20:00 and at 13:20:30). */
export const minutesUntil = (now: Date, date: Date): number => Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 60_000));

/** The strip's state with at most `limit` rows. */
export function stripState(items: readonly StripItem[], now: Date, limit: number): StripState {
  const later = upcomingItems(items, now);
  const current = currentItem(items, now);
  if (current?.end) {
    const length = current.end.getTime() - current.start.getTime();
    const progress = length > 0 ? Math.min(1, Math.max(0, (now.getTime() - current.start.getTime()) / length)) : 1;
    return { mode: "now", lead: current, minutes: minutesUntil(now, current.end), progress, rows: later.slice(0, limit) };
  }
  const next = later[0];
  if (!next) return { mode: "nothing", minutes: 0, progress: 0, rows: [] };
  const away = minutesUntil(now, next.start);
  return { mode: "next", lead: next, minutes: away, progress: away <= 60 ? (60 - away) / 60 : 0, rows: later.slice(1, 1 + limit) };
}

/** Rows under the lead: one in a narrow note (≤ 400 px wide), three in a tall one (≥ 720 px high), else two. */
/**
 * #31: the list row's small mark for the to-do the strip shows going on now ("지금"). #47: only that one; done ones
 * get none. Same as DayStrip.marks (Swift).
 */
export function stripMarks(state: StripState): Map<string, "now" | "next"> {
  const marks = new Map<string, "now" | "next">();
  // #47: only 지금 — the to-dos up next sit under the list's own 다음 heading (a 다음 mark said it a third time).
  if (state.mode === "now" && state.lead && state.lead.kind !== "event" && !state.lead.done && state.lead.taskId) marks.set(state.lead.taskId, "now");
  return marks;
}

/** The mark's word: "지금" · "Now" · "Nu", "다음" · "Next" · "Volgende". */
export const markWord = (mode: "now" | "next", lang: Lang = "ko"): string => (mode === "now" ? ["지금", "Now", "Nu"] : ["다음", "Next", "Volgende"])[langIndex(lang)];

export const rowLimit = (width: number, height: number): number => (width <= 400 ? 1 : height >= 720 ? 3 : 2);

/** The top line's link: "하루 전체 ›" · "Whole day ›" · "Hele dag ›"; narrow (≤ 400 px) "전체 ›" · "Day ›" · "Dag ›". */
export const wholeDayLink = (narrow: boolean, lang: Lang = "ko"): string =>
  (narrow ? ["전체 ›", "Day ›", "Dag ›"] : ["하루 전체 ›", "Whole day ›", "Hele dag ›"])[langIndex(lang)];

// ─── Words ──────────────────────────────────────────────────────────────────

/**
 * The ring's centre: the number and the small word under it. Under an hour "40" + "분 남음" · "min left" · "min te gaan"
 * (#54: not "min over", which sat over "over 40 min" = in 40 min) (`next`: "분 뒤" · "min away" · "min te gaan"). An hour or more: the hours on top and the rest under them, so it reads
 * as a length, never a clock time (1.30 — "1:01 뒤" read as 1:01 beside "다음 · 15:45"): "1시간" + "20분 남음" · "1 h" +
 * "20 min left" · "1 u" + "en 20 min" (#60: "20 min te gaan" was cut under the hour); `next` "1시간" + "5분 뒤" · "1 h" + "5 min away" · "1 u" + "en 5 min"; on the
 * hour "2시간" + "뒤" · "away" · "te gaan". The rows' rule (`awayText`): from two hours away, the nearest whole hour
 * ("3시간" + "뒤" for 2 h 30 min); time left stays exact (`leftText`). Same as the Mac's DayStrip.ringText.
 */
export function ringText(minutes: number, mode: StripMode, lang: Lang = "ko"): { value: string; caption: string } {
  const left = mode !== "next", index = langIndex(lang);
  if (minutes < 60) return { value: String(minutes), caption: (left ? ["분 남음", "min left", "min te gaan"] : ["분 뒤", "min away", "min te gaan"])[index] };
  const shown = left || minutes < 120 ? minutes : Math.round(minutes / 60) * 60;
  const h = Math.floor(shown / 60), m = shown % 60;
  const value = [`${h}시간`, `${h} h`, `${h} u`][index];
  if (m === 0) return { value, caption: (left ? ["남음", "left", "te gaan"] : ["뒤", "away", "te gaan"])[index] };
  return { value, caption: (left ? [`${m}분 남음`, `${m} min left`, `en ${m} min`] : [`${m}분 뒤`, `${m} min away`, `en ${m} min`])[index] };
}

/**
 * A row's "when": "40분 뒤" · "in 40 min" · "over 40 min"; under two hours with its minutes ("1시간 5분 뒤", "1시간 뒤");
 * from two hours, the nearest whole hour ("2시간 뒤" for 2 h 10 min, "3시간 뒤" for 2 h 30 min).
 */
export function awayText(minutes: number, lang: Lang = "ko"): string {
  if (minutes < 120) return ribbonAway(minutes, lang);
  return ribbonAway(Math.round(minutes / 60) * 60, lang);
}

/** Within the hour: the row's "when" and the ring (`next`) in clay. */
export const isSoon = (minutes: number): boolean => minutes <= 60;

const clockOf = (date: Date, lang: Lang) => clock(date.getHours(), date.getMinutes(), lang);

/** "13:00–14:00", "1:00–2:00 PM". */
export const rangeText = (start: Date, end: Date, lang: Lang = "ko"): string =>
  clockRange({ hour: start.getHours(), minute: start.getMinutes() }, { hour: end.getHours(), minute: end.getMinutes() }, lang);

export const clockText = (date: Date, lang: Lang = "ko"): string => clockOf(date, lang);

const nowWords = ["지금", "Now", "Nu"];
const nextWords = ["다음", "Next", "Volgende"];

/**
 * The small line over the title: "지금 · 13:00–14:00" · "Now · 1:00–2:00 PM" · "Nu · 13:00–14:00", or "다음 · 14:00–15:30" ·
 * "Next · …" · "Volgende · …" (a reminder: its time alone). `short` (when the full one doesn't fit): "지금 · ~14:00" ·
 * "Now · until 2:00 PM" · "Nu · tot 14:00"; "다음 · 14:00".
 */
export function kicker(mode: StripMode, item: StripItem, lang: Lang = "ko", short = false): string {
  const index = langIndex(lang);
  const word = (mode === "now" ? nowWords : nextWords)[index];
  const start = clockOf(item.start, lang);
  if (!item.end || item.end.getTime() <= item.start.getTime()) return `${word} · ${start}`;
  const end = clockOf(item.end, lang);
  if (short) return mode === "now" ? `${word} · ${[`~${end}`, `until ${end}`, `tot ${end}`][index]}` : `${word} · ${start}`;
  return `${word} · ${rangeText(item.start, item.end, lang)}`;
}

/** Time left, said in full: "40분 남음", "1시간 20분 남음", "1시간 남음"; en "40 min left", "1 h 20 min left"; nl "nog 40 min", "nog 1 u 20 min". */
export function leftText(minutes: number, lang: Lang = "ko"): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  if (lang === "ko") return `${h === 0 ? `${m}분` : m === 0 ? `${h}시간` : `${h}시간 ${m}분`} 남음`;
  if (lang === "en") return `${h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`} left`;
  return `nog ${h === 0 ? `${m} min` : m === 0 ? `${h} u` : `${h} u ${m} min`}`;
}

/** "오늘 남은 일정이 없어요" · "Nothing else today" · "Verder niets vandaag". */
export const nothingLeftText = (lang: Lang = "ko"): string => ["오늘 남은 일정이 없어요", "Nothing else today", "Verder niets vandaag"][langIndex(lang)];

/**
 * The whole strip in one sentence (its accessible label): "지금 팀 회의, 40분 남음. 다음 14:00 보고서 마무리, 15:30 치과";
 * nothing on: "다음 14:00 보고서 마무리, 40분 뒤. 그다음 15:30 치과"; nothing left: "오늘 남은 일정이 없어요".
 */
export function stripSentence(state: StripState, lang: Lang = "ko"): string {
  const lead = state.lead;
  if (!lead || state.mode === "nothing") return nothingLeftText(lang);
  const index = langIndex(lang);
  const rows = state.rows.map((row) => `${clockOf(row.start, lang)} ${row.title}`).join(", ");
  if (state.mode === "now") {
    const first = `${nowWords[index]} ${lead.title}, ${leftText(state.minutes, lang)}`;
    return rows ? `${first}. ${nextWords[index]} ${rows}` : first;
  }
  const first = `${nextWords[index]} ${clockOf(lead.start, lang)} ${lead.title}, ${awayText(state.minutes, lang)}`;
  return rows ? `${first}. ${["그다음", "Then", "Daarna"][index]} ${rows}` : first;
}

// ─── The whole day (하루 일정표) ─────────────────────────────────────────────

/** 50 px for an hour. */
export const hourHeight = 50;
/** A reminder takes this long in the timetable (its 20 px pill is 24 minutes tall). */
export const reminderLength = 30;
export const maxColumns = 3;

/** Something in the timetable, in minutes after the day's midnight (logical: 01:00 that night is 1500). */
export interface Span { id: string; kind: StripKind; start: number; end: number; order: number }

/** Minutes of `date` after the midnight that starts `now`'s logical day. */
export function dayMinutes(date: Date, now: Date): number {
  const start = logicalDayStart(now);
  const midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  return Math.round((date.getTime() - midnight.getTime()) / 60_000);
}

/** The items as spans on the day's minutes (a reminder `reminderLength` long; an end past the 4 a.m. day is cut). */
export function stripSpans(items: readonly StripItem[], now: Date): Span[] {
  return items.map((item) => {
    const start = Math.max(dayStartMinutes, Math.min(dayEndMinutes - 15, dayMinutes(item.start, now)));
    const end = item.end ? Math.min(dayEndMinutes, Math.max(start + 1, dayMinutes(item.end, now))) : Math.min(dayEndMinutes, start + reminderLength);
    return { id: item.id, kind: item.kind, start, end, order: item.order };
  });
}

/** Where a span sits: its column and how many columns its group of overlapping spans has (1…3 drawn); `hidden` in a fourth column or further. */
export interface Placed { id: string; column: number; columns: number; hidden: boolean; /** [Win] Its group (0, 1, …): a group with a "+N" leaves room for the chip. */ group: number }
/** A group's "+N": the hidden spans, placed at the first hidden one's start. */
export interface More { ids: string[]; start: number; group: number }

/**
 * Side by side where they overlap. In order of start (then the longer first, then events · to-dos · reminders, then
 * the order), each span takes the first column whose last span has ended by its start (touching isn't overlapping).
 * A group is a run of spans that overlap one another, directly or through others; all of a group's spans share its
 * column count. Columns 4 and on aren't drawn: the group gets a "+N" chip instead.
 */
export function columns(spans: readonly Span[]): { placed: Placed[]; more: More[] } {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end || kindRank[a.kind] - kindRank[b.kind] || a.order - b.order);
  const placed: Placed[] = [];
  const more: More[] = [];
  let group: { span: Span; column: number }[] = [];
  let groupEnd = -Infinity;
  let columnEnds: number[] = [];
  let index = 0;
  const close = () => {
    if (group.length === 0) return;
    const used = Math.max(...group.map((entry) => entry.column)) + 1;
    const drawn = Math.min(used, maxColumns);
    for (const { span: entry, column } of group) placed.push({ id: entry.id, column, columns: drawn, hidden: column >= maxColumns, group: index });
    const hidden = group.filter((entry) => entry.column >= maxColumns).map((entry) => entry.span);
    if (hidden.length) more.push({ ids: hidden.map((entry) => entry.id), start: hidden[0].start, group: index });
    group = [];
    index += 1;
  };
  for (const entry of sorted) {
    if (entry.start >= groupEnd) { close(); columnEnds = []; }
    const free = columnEnds.findIndex((end) => end <= entry.start);
    const column = free >= 0 ? free : columnEnds.length;
    columnEnds[column] = entry.end;
    group.push({ span: entry, column });
    groupEnd = group.length === 1 ? entry.end : Math.max(groupEnd, entry.end);
  }
  close();
  return { placed, more };
}

/** A click on the timetable's empty space at `y` px from the top of the first hour: the quarter hour it's in (rounded down), kept from the first hour to an hour before the last. */
export function slot(y: number, startHour: number, endHour: number): number {
  const minutes = startHour * 60 + (Math.max(0, y) / hourHeight) * 60;
  const quarter = Math.floor(minutes / 15) * 15;
  return Math.min(Math.max(quarter, startHour * 60), endHour * 60 - 60);
}

/**
 * Where the timetable opens: the whole hour at or before (now − 1 h) at the top, so its line and label show (13:20 →
 * 12:00); px from the first hour, never below 0.
 */
export function scrollTop(now: Date, startHour: number): number {
  const start = logicalDayStart(now);
  const midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const minutes = (now.getTime() - midnight.getTime()) / 60_000;
  return Math.max(0, (Math.floor((minutes - 60) / 60) - startHour) * hourHeight);
}

/** What a drag on a block changes: the whole block (moved), or its start or its end (the other edge stays). */
export type DragEdge = "start" | "end" | "whole";

/** The shortest a block can be made by its edges. */
export const minimumLength = 15;

/**
 * Where a block may go: the timetable's hours, inside the 4 a.m. day — a to-do's end no later than 03:45 when the day
 * runs to 04:00 (an end at 04:00 isn't kept on a to-do; ribbon-cases R6).
 */
export function dragBounds(startHour: number, endHour: number, kind: StripKind = "event"): { low: number; high: number } {
  return { low: Math.max(dayStartMinutes, startHour * 60), high: Math.min(kind === "task" ? dayEndMinutes - 15 : dayEndMinutes, endHour * 60) };
}

/**
 * While the button is down the block follows the pointer exactly (R2): `pixels` in the grid, fractions of minutes, no
 * steps. Moved whole it keeps its length inside the bounds; its top never comes within 15 minutes of its end, nor its
 * end of its start (a block already shorter never shrinks or jumps).
 */
export function followedSpan(start: number, end: number, edge: DragEdge, pixels: number, startHour: number, endHour: number, kind: StripKind = "event"): { start: number; end: number } {
  const { low, high } = dragBounds(startHour, endHour, kind);
  const delta = (pixels / hourHeight) * 60;
  if (edge === "start") return { start: Math.min(Math.max(low, start + delta), Math.max(end - minimumLength, start)), end };
  if (edge === "end") return { start, end: Math.max(Math.min(high, end + delta), Math.min(start + minimumLength, end)) };
  const from = Math.min(Math.max(low, start + delta), high - (end - start));
  return { start: from, end: from + end - start };
}

/**
 * Where a block dragged `pixels` down (up when negative) lands. Moved whole (G rows, R8): by whole quarter hours (the
 * nearest, halves away from zero, as the Mac rounds), the length kept, inside the bounds. An edge (R3, R4): to the
 * nearest quarter hour of where it was dragged — unless moved less than half a step (7.5 minutes), then it stays —
 * at least 15 minutes from the other edge, inside the bounds. Logical minutes in and out.
 */
export function draggedSpan(start: number, end: number, edge: DragEdge, pixels: number, startHour: number, endHour: number, kind: StripKind = "event"): { start: number; end: number } {
  const { low, high } = dragBounds(startHour, endHour, kind);
  const delta = (pixels / hourHeight) * 60;
  if (edge === "whole") {
    const step = Math.sign(delta) * Math.round(Math.abs(delta) / 15) * 15;
    const from = Math.min(Math.max(low, start + step), high - (end - start));
    return { start: from, end: from + end - start };
  }
  const quarter = (minutes: number) => (Math.abs(delta) < 7.5 ? minutes : Math.round((minutes + delta) / 15) * 15);
  if (edge === "start") return { start: Math.min(Math.max(low, quarter(start)), Math.max(end - minimumLength, start)), end };
  return { start, end: Math.max(Math.min(high, quarter(end)), Math.min(start + minimumLength, end)) };
}

/**
 * The bands at a block's top and bottom where a press changes its start or end instead of moving it (R1): 6 px, less
 * on a short block so at least 10 px in the middle still moves it; none on a block under 20 px.
 */
export const edgeBand = (height: number): number => (height < 20 ? 0 : Math.max(0, Math.min(6, Math.floor((height - 10) / 2))));

/** Alt+↑ / Alt+↓: a block 15 minutes earlier or later, inside the day's hours. */
export const nudged = (start: number, end: number, steps: number, startHour: number, endHour: number, kind: StripKind = "event"): { start: number; end: number } =>
  draggedSpan(start, end, "whole", (steps * hourHeight) / 4, startHour, endHour, kind);

/** Shift+Alt+↑ / Shift+Alt+↓ (R7): a block's end 15 minutes earlier or later (at least 15 minutes after its start, inside the day's hours). */
export const stretched = (start: number, end: number, steps: number, startHour: number, endHour: number, kind: StripKind = "event"): { start: number; end: number } =>
  draggedSpan(start, end, "end", (steps * hourHeight) / 4, startHour, endHour, kind);

const pad = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/**
 * A click on the timetable's empty space at `minutes` (logical) and a title typed in its little line: a to-do with that
 * hour (`minutes`…+60, never past 04:00; a reminder at its start when that's still ahead) and an event at the same time,
 * an hour long. The to-do comes first unless `kind` says otherwise or (no `kind`) the title has an event word (as the
 * input line reads it).
 */
export function newCandidates(title: string, minutes: number, now: Date, lang: Lang = "ko", kind?: "todo" | "event"): Candidate[] {
  const name = title.trim();
  const start = Math.max(dayStartMinutes, Math.min(dayEndMinutes - 15, minutes));
  const end = Math.min(dayEndMinutes, start + 60);
  const dayStart = logicalDayStart(now);
  const at = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), Math.floor(start / 60), start % 60);
  const todo: Candidate = { kind: "todo", title: name, ...(at.getTime() > now.getTime() ? { reminderAt: at } : {}), range: { day: dayKey(now), start: start % 1440, end: end % 1440 } };
  const event: Candidate = { kind: "event", title: name, day: dateKey(at), start: start % 1440, end: end % 1440, allDay: false };
  const eventFirst = kind ? kind === "event" : hasEventWord(name, lang);
  return eventFirst ? [event, todo] : [todo, event];
}
