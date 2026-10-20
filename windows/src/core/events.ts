import { dateKey, localDate, untitledIn, type CalendarDraft, type CalendarEvent } from "./calendar";
import type { Lang } from "./lang";
import { isoDate } from "./notebook";

/**
 * 자체 일정: the events this app keeps itself, in events.json beside todos.json (so a shared folder
 * shares them too) — `{ "events": [LocalEvent…] }`, the same file as the macOS app. Repeating events
 * are kept once and spread over the days they fall on (`occurrences`).
 */

export type EventRepeat = "none" | "daily" | "weekly" | "monthly" | "yearly";
export type EventColor = "blue" | "sage" | "coral" | "purple" | "yellow" | "gray";

export const eventRepeats: { value: EventRepeat; title: string }[] = [
  { value: "none", title: "안 함" }, { value: "daily", title: "매일" }, { value: "weekly", title: "매주" },
  { value: "monthly", title: "매월" }, { value: "yearly", title: "매년" },
];

/** The palette (the same hex on both apps); blue is the default. */
export const eventColors: { value: EventColor; hex: string; title: string }[] = [
  { value: "blue", hex: "#5b8bd0", title: "파랑" },
  { value: "sage", hex: "#6b8f71", title: "초록" },
  { value: "coral", hex: "#d9765f", title: "주황" },
  { value: "purple", hex: "#8e7cc3", title: "보라" },
  { value: "yellow", hex: "#d4a72c", title: "노랑" },
  { value: "gray", hex: "#8a8a8a", title: "회색" },
];

const repeatTitles: Record<Lang, Record<EventRepeat, string>> = {
  ko: { none: "안 함", daily: "매일", weekly: "매주", monthly: "매월", yearly: "매년" },
  en: { none: "Never", daily: "Every day", weekly: "Every week", monthly: "Every month", yearly: "Every year" },
  nl: { none: "Nooit", daily: "Elke dag", weekly: "Elke week", monthly: "Elke maand", yearly: "Elk jaar" },
};
const colorTitles: Record<Lang, Record<EventColor, string>> = {
  ko: { blue: "파랑", sage: "초록", coral: "주황", purple: "보라", yellow: "노랑", gray: "회색" },
  en: { blue: "Blue", sage: "Green", coral: "Orange", purple: "Purple", yellow: "Yellow", gray: "Gray" },
  nl: { blue: "Blauw", sage: "Groen", coral: "Oranje", purple: "Paars", yellow: "Geel", gray: "Grijs" },
};
/** A repeat's name: en "Never", "Every day", "Every week", "Every month", "Every year"; nl "Nooit", "Elke dag", … "Elk jaar". */
export const eventRepeatTitle = (repeat: EventRepeat, lang: Lang = "ko"): string => repeatTitles[lang][repeat];
/** A colour's name: en "Blue", "Green", "Orange", "Purple", "Yellow", "Gray"; nl "Blauw", "Groen", "Oranje", "Paars", "Geel", "Grijs". */
export const eventColorTitle = (color: EventColor, lang: Lang = "ko"): string => colorTitles[lang][color];

export const colorHex = (color: EventColor): string => (eventColors.find((entry) => entry.value === color) ?? eventColors[0]).hex;
/** Unknown values read as "none" and "blue". */
export const toRepeat = (value: unknown): EventRepeat => (eventRepeats.some((entry) => entry.value === value) ? value as EventRepeat : "none");
export const toColor = (value: unknown): EventColor => (eventColors.some((entry) => entry.value === value) ? value as EventColor : "blue");

export interface LocalEvent {
  /** A UUID. */
  id: string;
  title: string;
  /** The first day, "yyyy-MM-dd". */
  date: string;
  allDay: boolean;
  /** All day: how many days (≥ 1). Timed: 1. */
  days: number;
  /** Timed: minutes 0…1439; an end at or before the start is the next day. */
  start: number;
  end: number;
  repeat: EventRepeat;
  /** Days of a repeating event left out (이 날만 지우기). */
  skip: string[];
  color: EventColor;
  location?: string;
  /** Put in from this task. */
  taskId?: string;
  /** ISO 8601 to the second, "Z". */
  createdAt: string;
  updatedAt: string;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const minutes = (value: unknown, fallback: number) => (Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 1439 ? value as number : fallback);

/** One entry of events.json, or undefined when it has no id or no first day. */
function readEvent(value: unknown): LocalEvent | undefined {
  if (!isObject(value) || typeof value.id !== "string" || !value.id || !localDate(value.date)) return undefined;
  const allDay = value.allDay === true;
  const days = allDay && Number.isInteger(value.days) && (value.days as number) >= 1 ? value.days as number : 1;
  const stamp = (text: unknown) => (typeof text === "string" && text ? text : undefined);
  const createdAt = stamp(value.createdAt) ?? stamp(value.updatedAt) ?? isoDate(new Date(0));
  const event: LocalEvent = {
    id: value.id, title: typeof value.title === "string" ? value.title : "", date: value.date as string, allDay, days,
    start: minutes(value.start, 540), end: minutes(value.end, 600), repeat: toRepeat(value.repeat),
    skip: Array.isArray(value.skip) ? value.skip.filter((entry): entry is string => Boolean(localDate(entry))) : [],
    color: toColor(value.color), createdAt, updatedAt: stamp(value.updatedAt) ?? createdAt,
  };
  if (typeof value.location === "string" && value.location.trim()) event.location = value.location;
  if (typeof value.taskId === "string" && value.taskId) event.taskId = value.taskId;
  return event;
}

/** events.json; throws when it isn't `{ "events": [...] }` (a damaged file is kept aside, never trimmed). Entries without an id or a day are left out. */
export function parseEvents(text: string): LocalEvent[] {
  const value = JSON.parse(text) as unknown;
  if (!isObject(value) || !Array.isArray(value.events)) throw new Error("events missing");
  const seen = new Set<string>();
  const events: LocalEvent[] = [];
  for (const raw of value.events) {
    const event = readEvent(raw);
    if (!event || seen.has(event.id)) continue;
    seen.add(event.id);
    events.push(event);
  }
  return events;
}

/** Keys in order, two-space indent, like todos.json. */
export function serializeEvents(events: readonly LocalEvent[]): string {
  const sorted = events.map((event) => {
    const entry: Record<string, unknown> = {};
    for (const key of Object.keys(event).sort()) {
      const value = event[key as keyof LocalEvent];
      if (value !== undefined) entry[key] = value;
    }
    return entry;
  });
  return JSON.stringify({ events: sorted }, null, 2) + "\n";
}

// ─── Occurrences ──────────────────────────────────────────────────────────────

/** Whole days from a to b (local dates, so a change of clocks doesn't count). */
const daysBetween = (a: Date, b: Date) => Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 86_400_000);

/** Whether a repeating event falls on `day` (never before its first day, never on a skipped one). */
function fallsOn(event: LocalEvent, first: Date, day: Date): boolean {
  const offset = daysBetween(first, day);
  if (offset < 0 || event.skip.includes(dateKey(day))) return false;
  switch (event.repeat) {
    case "none": return offset === 0;
    case "daily": return true;
    case "weekly": return offset % 7 === 0;
    // A month without that day (the 31st, the 29th–30th of February) is passed over.
    case "monthly": return day.getDate() === first.getDate();
    // 29 February only in leap years.
    case "yearly": return day.getMonth() === first.getMonth() && day.getDate() === first.getDate();
  }
}

/** The occurrence on `day` as moments: all day from that midnight `days` days on; timed ending that day or the next. */
function momentsOn(event: LocalEvent, day: Date): { start: Date; end: Date } {
  const [y, m, d] = [day.getFullYear(), day.getMonth(), day.getDate()];
  if (event.allDay) return { start: new Date(y, m, d), end: new Date(y, m, d + Math.max(1, event.days)) };
  return { start: new Date(y, m, d, 0, event.start), end: new Date(y, m, d + (event.end <= event.start ? 1 : 0), 0, event.end) };
}

export const occurrenceKey = (id: string, day: string) => `local/${id}@${day}`;

/** "local/<id>@<day>" back into its event id and day. */
export function parseOccurrenceKey(key: string): { id: string; day: string } | undefined {
  const match = /^local\/(.+)@(\d{4}-\d{2}-\d{2})$/.exec(key);
  return match ? { id: match[1], day: match[2] } : undefined;
}

/**
 * The occurrences overlapping [from, to), in local time: one that began earlier is still in when
 * it ends after `from` (overnight, several days all day).
 */
export function occurrences(event: LocalEvent, from: Date, to: Date, lang: Lang = "ko"): CalendarEvent[] {
  const first = localDate(event.date);
  if (!first || to <= from) return [];
  const length = event.allDay ? Math.max(1, event.days) : 1;
  let day = new Date(from.getFullYear(), from.getMonth(), from.getDate() - length);
  if (day < first) day = new Date(first);
  const last = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  const title = event.title.trim() || untitledIn(lang);
  const found: CalendarEvent[] = [];
  for (; day <= last; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    if (!fallsOn(event, first, day)) continue;
    const { start, end } = momentsOn(event, day);
    if (!(start < to && end > from)) continue;
    found.push({
      key: occurrenceKey(event.id, dateKey(day)), calendarId: "local", title, allDay: event.allDay, start, end,
      ...(event.location ? { location: event.location.trim() } : {}), color: colorHex(event.color), eventId: event.id,
      canEdit: true, recurring: event.repeat !== "none", ...(event.taskId ? { taskId: event.taskId } : {}),
    });
  }
  return found;
}

/** Every event's occurrences in [from, to), by start, then title. */
export function expand(events: readonly LocalEvent[], from: Date, to: Date, lang: Lang = "ko"): CalendarEvent[] {
  return events.flatMap((event) => occurrences(event, from, to, lang))
    .sort((a, b) => a.start.getTime() - b.start.getTime() || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}

// ─── The sheet's draft ↔ the event ────────────────────────────────────────────

/** The sheet's draft as an event; changing one keeps when it was made, its skipped days and its task. */
export function eventFromDraft(draft: CalendarDraft, id: string, now: Date, existing?: LocalEvent): LocalEvent {
  const location = draft.location?.trim();
  const taskId = existing ? existing.taskId : draft.taskId;
  return {
    id, title: draft.title.trim(), date: draft.date, allDay: draft.allDay, days: draft.allDay ? Math.max(1, Math.floor(draft.days) || 1) : 1,
    start: minutes(draft.startMinutes, 540), end: minutes(draft.endMinutes, 600), repeat: toRepeat(draft.repeat), skip: existing ? [...existing.skip] : [],
    color: toColor(draft.color), ...(location ? { location } : {}), ...(taskId ? { taskId } : {}),
    createdAt: existing?.createdAt ?? isoDate(now), updatedAt: isoDate(now),
  };
}

/** An event as the sheet's draft: a repeating one is changed as a whole series (from its first day). */
export function draftFromEvent(event: LocalEvent): CalendarDraft {
  return {
    title: event.title, color: event.color, date: event.date, allDay: event.allDay, days: event.allDay ? event.days : 1,
    startMinutes: event.start, endMinutes: event.end, repeat: event.repeat,
    ...(event.location ? { location: event.location } : {}), ...(event.taskId ? { taskId: event.taskId } : {}),
  };
}

/** 이 날만 지우기: that day left out of a repeating event. */
export function skipDay(event: LocalEvent, day: string, now: Date): LocalEvent {
  return event.skip.includes(day) ? event : { ...event, skip: [...event.skip, day].sort(), updatedAt: isoDate(now) };
}
