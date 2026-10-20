import { logicalDayStart } from "./archive";
import type { EventColor, EventRepeat } from "./events";
import { rangeOf, rangeText } from "./timeRange";
import { clock, days as dayCount, langIndex, longDate, minutesAway, monthTitle as monthTitleIn, plural, shortDate, timeRange, weekdayLetter, weekdayOrder, weekStartsMonday, weekTitle as weekTitleIn, type Lang } from "./lang";

/**
 * 일정: the app's own events (events.json, see events.ts) next to — never mixed with — the tasks:
 * today's strip, the alerts before an event, the sheet that makes and changes them, and the 달력
 * window. The rules are the same as the macOS app (PaperCore CalendarEvents.swift), with the same
 * test cases. A "day" ends at 4 a.m. in the note, at midnight in the 달력 window.
 */

/** One occurrence of a local event (see `occurrences` in events.ts). */
export interface CalendarEvent {
  /** "local/<id>@<the occurrence's day>" */
  key: string;
  /** Always "local". */
  calendarId: string;
  title: string;
  allDay: boolean;
  /** Timed: the moment. All-day: local midnight of the first day. */
  start: Date;
  /** Timed: the moment. All-day: local midnight of the day after the last (exclusive). */
  end: Date;
  location?: string;
  /** The palette colour as "#rrggbb". */
  color: string;
  /** The LocalEvent's id. */
  eventId: string;
  /** Always true: every event here is this app's own. */
  canEdit: boolean;
  /** One occurrence of a repeating event (changing it changes the whole series). */
  recurring: boolean;
  /** Put in from this task (캘린더에 넣기). */
  taskId?: string;
}

export type EventState = "upcoming" | "soon" | "now" | "past" | "allDay";

export const untitled = "(제목 없음)";
/** What an event without a title is called: "(제목 없음)", "(No title)", "(Geen titel)". */
export const untitledIn = (lang: Lang = "ko"): string => ["(제목 없음)", "(No title)", "(Geen titel)"][langIndex(lang)];
/** "종일", "All day", "Hele dag" */
export const allDayText = (lang: Lang = "ko"): string => ["종일", "All day", "Hele dag"][langIndex(lang)];
const minute = 60_000;
const day = 24 * 60 * minute;
const pad = (value: number) => String(value).padStart(2, "0");
const hhmm = (date: Date, lang: Lang = "ko") => clock(date.getHours(), date.getMinutes(), lang);
const range = (start: Date, end: Date, lang: Lang) =>
  timeRange({ hour: start.getHours(), minute: start.getMinutes() }, { hour: end.getHours(), minute: end.getMinutes() }, lang);
/** "2026-10-07" for a local date. */
export const dateKey = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

/** "2026-10-07" as local midnight; undefined when it isn't a real date. */
export function localDate(text: unknown): Date | undefined {
  if (typeof text !== "string") return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime()) || dateKey(date) !== text) return undefined;
  return date;
}

/** The logical day around `now`: 04:00 to the next 04:00. */
export function dayBounds(now: Date): { start: Date; end: Date } {
  const start = logicalDayStart(now);
  return { start, end: new Date(start.getTime() + day) };
}

const before = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** What today's strip shows: all-day events first (by title), then timed ones by start, then title. */
export function todayEvents(events: readonly CalendarEvent[], now: Date): CalendarEvent[] {
  const { start: S, end: E } = dayBounds(now);
  const D = new Date(S.getFullYear(), S.getMonth(), S.getDate());
  return events
    .filter((event) => {
      if (event.allDay) return event.start <= D && D < event.end;
      if (event.end.getTime() === event.start.getTime()) return event.start >= S && event.start < E;
      return event.start < E && event.end > S;
    })
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      if (a.allDay) return before(a.title, b.title);
      return a.start.getTime() - b.start.getTime() || before(a.title, b.title);
    });
}

/**
 * The strip's time column: "종일", "10:00", "~05:00" (began before today), "23:00~" (runs past today).
 * English on a 12-hour clock: "All day", "10:00 AM", "~5:00 AM", "11:00 PM~"; Dutch "Hele dag", "10:00".
 */
export function eventTimeLabel(event: CalendarEvent, now: Date, lang: Lang = "ko"): string {
  if (event.allDay) return allDayText(lang);
  const { start: S, end: E } = dayBounds(now);
  if (event.start < S) return `~${hhmm(event.end, lang)}`;
  if (event.end > E) return `${hhmm(event.start, lang)}~`;
  return hhmm(event.start, lang);
}

/** The strip's right-hand column: "40분 뒤", "진행 중", "끝남" — en "in 40 min", "Now", "Over"; nl "over 40 min", "Nu", "Voorbij". */
export function eventStatus(event: CalendarEvent, now: Date, lang: Lang = "ko"): { text: string; state: EventState } {
  if (event.allDay) return { text: "", state: "allDay" };
  const at = now.getTime();
  if (at < event.start.getTime()) {
    const minutes = Math.ceil((event.start.getTime() - at) / minute);
    return minutes <= 60 ? { text: minutesAway(minutes, lang), state: "soon" } : { text: "", state: "upcoming" };
  }
  if (at < event.end.getTime()) return { text: ["진행 중", "Now", "Nu"][langIndex(lang)], state: "now" };
  return { text: ["끝남", "Over", "Voorbij"][langIndex(lang)], state: "past" };
}

/** "제목 · 10:00–11:00 · 장소" (a hover on the strip); en "Title · 10:00–11:00 AM · Place". */
export function eventTooltip(event: CalendarEvent, lang: Lang = "ko"): string {
  const when = event.allDay ? allDayText(lang) : range(event.start, event.end, lang);
  return [event.title, when, event.location].filter(Boolean).join(" · ");
}

// ─── Alerts ───────────────────────────────────────────────────────────────────

/** What this device records once it has shown an event's alert: the event and its start. */
export function eventAlertKey(event: CalendarEvent): string {
  return `${event.key}@${Math.floor(event.start.getTime() / 1000)}`;
}

function alertable(events: readonly CalendarEvent[], now: Date, leadMinutes: number, shownHere: ReadonlySet<string>): CalendarEvent[] {
  if (leadMinutes <= 0) return [];
  return events.filter((event) => !event.allDay && now < event.start && !shownHere.has(eventAlertKey(event)));
}

/** Events to announce now: `lead` minutes before the start, once, never after it began. Soonest first. */
export function dueEventAlerts(events: readonly CalendarEvent[], now: Date, leadMinutes: number, shownHere: ReadonlySet<string> = new Set()): CalendarEvent[] {
  return alertable(events, now, leadMinutes, shownHere)
    .filter((event) => event.start.getTime() - leadMinutes * minute <= now.getTime())
    .sort((a, b) => a.start.getTime() - b.start.getTime() || before(a.title, b.title));
}

/** When the next event alert falls due (already past when one is waiting), or undefined. */
export function nextEventAlertTime(events: readonly CalendarEvent[], now: Date, leadMinutes: number, shownHere: ReadonlySet<string> = new Set()): number | undefined {
  const times = alertable(events, now, leadMinutes, shownHere).map((event) => event.start.getTime() - leadMinutes * minute);
  return times.length > 0 ? Math.min(...times) : undefined;
}

/** Today's first timed event that hasn't begun yet (for the cat's lines). */
export function nextEvent(events: readonly CalendarEvent[], now: Date): CalendarEvent | undefined {
  return todayEvents(events, now).find((event) => !event.allDay && event.start > now);
}

/** What the cat knows about today's calendar (CalendarDay.chatter on the Mac). */
export interface ChatterEvents { next?: string; nextIn: number; now?: string; ended?: string; left: number }

/**
 * The next timed event and the minutes to it (rounded up), the one going on (earliest start), one
 * that ended in the last 20 minutes (latest end), and how many timed events are still to come.
 * All-day events don't count.
 */
export function chatterEvents(events: readonly CalendarEvent[], now: Date): ChatterEvents {
  const timed = todayEvents(events, now).filter((event) => !event.allDay);
  const coming = timed.filter((event) => event.start > now).sort((a, b) => a.start.getTime() - b.start.getTime());
  const next = coming[0];
  const going = timed.filter((event) => event.start <= now && now < event.end).sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  const since = now.getTime() - 20 * 60_000;
  const ended = timed.filter((event) => event.end <= now && event.end.getTime() >= since && event.start < event.end)
    .sort((a, b) => b.end.getTime() - a.end.getTime())[0];
  const result: ChatterEvents = { nextIn: next ? Math.ceil((next.start.getTime() - now.getTime()) / 60_000) : 0, left: coming.length };
  if (next) result.next = next.title;
  if (going) result.now = going.title;
  if (ended) result.ended = ended.title;
  return result;
}

// ─── The event sheet (넣기 · 새 일정 · 고치기) ──────────────────────────────────

/** An event as the sheet edits it. Putting a task in makes a copy of it at that moment. */
export interface CalendarDraft {
  title: string;
  color: EventColor;
  /** The first day, "yyyy-MM-dd" (local). */
  date: string;
  allDay: boolean;
  /** All-day: how many days (≥ 1). Ignored for timed events. */
  days: number;
  /** Timed: 0…1439. */
  startMinutes: number;
  /** Timed: 0…1439; at or before the start means the next day (equal is an error). */
  endMinutes: number;
  repeat: EventRepeat;
  location?: string;
  /** Put in from this task. */
  taskId?: string;
}

const colors: readonly EventColor[] = ["blue", "sage", "coral", "purple", "yellow", "gray"];
/** The colour a new event takes: the last one used (prefs calendarLastColor), else blue. */
export const draftColor = (last?: string): EventColor => (colors.includes(last as EventColor) ? last as EventColor : "blue");

const minutesOf = (date: Date) => date.getHours() * 60 + date.getMinutes();

/** The next :00 or :30 (now if it is exactly one), half an hour later when that is under 10 minutes away. */
export function nextSlot(now: Date): { date: string; minutes: number } {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const into = now.getTime() - midnight.getTime();
  const slotMinutes = Math.ceil(into / (30 * minute)) * 30;
  let slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, slotMinutes);
  if (slot.getTime() < now.getTime() + 10 * minute) slot = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, slotMinutes + 30);
  return { date: dateKey(slot), minutes: minutesOf(slot) };
}

const timedDraft = (title: string, date: string, start: number, lastColor?: string, taskId?: string): CalendarDraft => ({
  title: title.trim(), color: draftColor(lastColor), date, allDay: false, days: 1,
  startMinutes: start, endMinutes: (start + 60) % 1440, repeat: "none", ...(taskId ? { taskId } : {}),
});

/** A task put in the calendar: at its alert (an hour), else all day on its deadline, else the next free half hour. */
export function draftForTask(title: string, reminderAt: Date | undefined, dueDate: string | undefined, now: Date, lastColor?: string, taskId?: string): CalendarDraft {
  if (reminderAt && !Number.isNaN(reminderAt.getTime())) return timedDraft(title, dateKey(reminderAt), minutesOf(reminderAt), lastColor, taskId);
  if (dueDate && localDate(dueDate)) {
    return { title: title.trim(), color: draftColor(lastColor), date: dueDate, allDay: true, days: 1, startMinutes: 540, endMinutes: 600, repeat: "none", ...(taskId ? { taskId } : {}) };
  }
  const slot = nextSlot(now);
  return timedDraft(title, slot.date, slot.minutes, lastColor, taskId);
}

/** 새 일정: untitled, at the next free half hour, an hour long. */
export function draftForNew(now: Date, lastColor?: string, at?: { day: string; minutes: number }): CalendarDraft {
  // A click on the ribbon's empty track: that moment (to the quarter hour), an hour long.
  if (at) return timedDraft("", at.day, at.minutes, lastColor);
  const slot = nextSlot(now);
  return timedDraft("", slot.date, slot.minutes, lastColor);
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/** What stops the sheet from saving, or undefined: en "Give it a title" · "It ends when it starts"; nl "Geef het een titel" · "Het eindigt wanneer het begint". */
export function validate(draft: CalendarDraft, lang: Lang = "ko"): string | undefined {
  const index = langIndex(lang);
  if (!draft.title.trim()) return ["제목을 적어 주세요", "Give it a title", "Geef het een titel"][index];
  if (!draft.allDay && draft.startMinutes === draft.endMinutes) return ["끝나는 시간이 시작과 같아요", "It ends when it starts", "Het eindigt wanneer het begint"][index];
  return undefined;
}

/** The draft as moments: all-day from midnight to midnight `days` later; timed ending the same or the next day. */
export function span(draft: Pick<CalendarDraft, "date" | "allDay" | "days" | "startMinutes" | "endMinutes">): { start: Date; end: Date } {
  const first = localDate(draft.date) ?? startOfDay(new Date());
  const [y, m, d] = [first.getFullYear(), first.getMonth(), first.getDate()];
  if (draft.allDay) return { start: new Date(y, m, d), end: new Date(y, m, d + Math.max(1, draft.days)) };
  const nextDay = draft.endMinutes <= draft.startMinutes ? 1 : 0;
  return { start: new Date(y, m, d, 0, draft.startMinutes), end: new Date(y, m, d + nextDay, 0, draft.endMinutes) };
}

/**
 * "1시간", "1시간 30분", "45분" (" · 다음 날" when it ends tomorrow); all day "하루" or "3일".
 * en "1 hour", "2 hours 30 min", "45 min" (" · next day"), "1 day", "3 days"; nl "1 uur", "2 uur 30 min", "45 min" (" · volgende dag"), "1 dag", "3 dagen".
 */
export function lengthText(draft: CalendarDraft, lang: Lang = "ko"): string {
  if (draft.allDay) return lang === "ko" && draft.days <= 1 ? "하루" : dayCount(Math.max(1, draft.days), lang);
  const nextDay = draft.endMinutes < draft.startMinutes;
  const length = draft.endMinutes - draft.startMinutes + (nextDay ? 1440 : 0);
  const hours = Math.floor(length / 60);
  const minutes = length % 60;
  const hourText = lang === "ko" ? `${hours}시간` : lang === "en" ? plural(hours, "hour", "hours") : `${hours} uur`;
  const minuteText = lang === "ko" ? `${minutes}분` : `${minutes} min`;
  const text = hours > 0 ? (minutes > 0 ? `${hourText} ${minuteText}` : hourText) : minuteText;
  return nextDay ? `${text} · ${["다음 날", "next day", "volgende dag"][langIndex(lang)]}` : text;
}

/** "10월 8일 (목)", "Thu, Oct 8", "do 8 okt" */
export function dayLabel(date: Date, lang: Lang = "ko"): string {
  return shortDate(date, lang);
}

// ─── What the windows draw ────────────────────────────────────────────────────

/** One line of today's strip, worked out in the main process (and again every minute). */
export interface CalendarRow { key: string; title: string; label: string; status: string; state: EventState; color: string; tooltip: string }

export interface CalendarView {
  /** Today's strip (the logical day). */
  today: CalendarRow[];
  /** At least one event is kept: the strip shows (its heading) even on a day without any. */
  hasEvents: boolean;
  /** Tasks put in the calendar: an event names them (taskId). */
  withEvents: string[];
}

/** How the event sheet opens (sent from the main process to the note or the 달력 window). */
export interface CalendarSheetRequest {
  mode: "send" | "new" | "edit";
  draft: CalendarDraft;
  /** 고치기: the occurrence chosen ("local/<id>@<day>"), its event and day. */
  key?: string;
  id?: string;
  day?: string;
  /** 고치기: a repeating event (the whole series changes). */
  recurring?: boolean;
  /** 넣기: the task row the sheet sits under. */
  taskId?: string;
  /** Opened at its delete question (지우기… on a strip row). */
  confirmDelete?: boolean;
  /** Shown at once (빠른 입력 whose line could not be made into an event). */
  error?: string;
}

/** What the sheet asks the main process to do: make, change, delete an event, or leave out one day of a repeating one. */
export interface CalendarWriteRequest { kind: "create" | "update" | "delete" | "skip"; draft?: CalendarDraft; id?: string; day?: string }

export type CalendarWriteResult = { ok: true } | { ok: false; error: string };

export function calendarRows(events: readonly CalendarEvent[], now: Date, lang: Lang = "ko"): CalendarRow[] {
  return todayEvents(events, now).map((event) => {
    const status = eventStatus(event, now, lang);
    return { key: event.key, title: event.title, label: eventTimeLabel(event, now, lang), status: status.text, state: status.state, color: event.color, tooltip: eventTooltip(event, lang) };
  });
}

// ─── 달력 (3단계): the month and week window ──────────────────────────────────
//
// The calendar window counts days from midnight (the note's "today" still turns at 4 a.m.),
// weeks start on Sunday (Monday in Dutch: weekStartsMonday), and every day is a local "yyyy-MM-dd".

const dayStart = (day: string) => localDate(day) ?? startOfDay(new Date());
const nextMidnight = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
const daysFrom = (first: Date, count: number) =>
  Array.from({ length: count }, (_, index) => dateKey(new Date(first.getFullYear(), first.getMonth(), first.getDate() + index)));

/** How many days back to the week's first day (Sunday; Monday in Dutch). */
const intoWeek = (date: Date, lang: Lang) => (weekStartsMonday(lang) ? (date.getDay() + 6) % 7 : date.getDay());

/** The month as six weeks (always 42 days), from the Sunday (Dutch: Monday) of the week holding the 1st. `month` is 1–12. */
export function monthGrid(year: number, month: number, lang: Lang = "ko"): string[] {
  const first = new Date(year, month - 1, 1);
  return daysFrom(new Date(year, month - 1, 1 - intoWeek(first, lang)), 42);
}

/** Sunday to Saturday (Dutch: Monday to Sunday) of the week holding `day`. */
export function weekDays(day: string, lang: Lang = "ko"): string[] {
  const date = dayStart(day);
  return daysFrom(new Date(date.getFullYear(), date.getMonth(), date.getDate() - intoWeek(date, lang)), 7);
}

/** The headings over a week's columns, in the week's order: "일"…"토", "S M T W T F S", "ma"…"zo". */
export function weekdayLabels(lang: Lang = "ko"): string[] {
  return weekdayOrder(lang).map((weekday) => weekdayLetter(weekday, lang));
}

/** What to fetch for these days: midnight of the first to midnight after the last. */
export function fetchRange(days: readonly string[]): { start: Date; end: Date } {
  const first = dayStart(days[0] ?? dateKey(new Date()));
  return { start: first, end: nextMidnight(dayStart(days[days.length - 1] ?? dateKey(first))) };
}

/** Events on that day (midnight to midnight), by the strip's rules: all-day first by title, then by start, then title. */
export function eventsOn(day: string, events: readonly CalendarEvent[]): CalendarEvent[] {
  const S = dayStart(day);
  const E = nextMidnight(S);
  return events
    .filter((event) => {
      if (event.allDay) return event.start <= S && S < event.end;
      if (event.end.getTime() === event.start.getTime()) return event.start >= S && event.start < E;
      return event.start < E && event.end > S;
    })
    .sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      if (a.allDay) return before(a.title, b.title);
      return a.start.getTime() - b.start.getTime() || before(a.title, b.title);
    });
}

/**
 * The day panel's time: "종일", "10:00–11:00", "~01:00" (began earlier), "23:30~" (runs on), "12:00" (no length).
 * English: "All day", "10:00–11:00 AM", "11:30 AM–12:30 PM", "~1:00 AM", "11:30 PM~", "12:00 PM".
 */
export function agendaTime(event: CalendarEvent, day: string, lang: Lang = "ko"): string {
  if (event.allDay) return allDayText(lang);
  const S = dayStart(day);
  const E = nextMidnight(S);
  const began = event.start < S;
  const runsOn = event.end > E;
  if (began && runsOn) return allDayText(lang);
  if (began) return `~${hhmm(event.end, lang)}`;
  if (runsOn) return `${hhmm(event.start, lang)}~`;
  if (event.end.getTime() === event.start.getTime()) return hhmm(event.start, lang);
  return range(event.start, event.end, lang);
}

/** A task on a day: its deadline, its alert (with the time), or its hours (시간 정하기: "14:00–15:30"; `due` when it is that day's deadline too). */
export interface DayTask { title: string; kind: "deadline" | "reminder" | "range"; time?: string; taskId: string; due?: boolean; /** A range's start alone ("14:00", the week rows' time column). */ start?: string }

type TaskLike = { id: string; title: string; isCompleted: boolean; dueDate?: string; reminderAt?: string; timeStart?: string; timeEnd?: string; shelf?: "later" | "today" };

/**
 * Unfinished tasks due that day or alerting that day (a task with both shows once, as its
 * deadline). Alerts first by time, then deadlines by title. An alert's time is on the language's
 * clock ("09:30", "9:30 AM").
 */
export function dayTasks(day: string, tasks: readonly TaskLike[], lang: Lang = "ko", today?: string): DayTask[] {
  const reminders: (DayTask & { at: number })[] = [];
  const deadlines: DayTask[] = [];
  for (const task of tasks) {
    if (task.isCompleted) continue;
    // 시간 정하기: a task with hours on this day (its deadline, or `today` for one on today's sheet) shows them, once.
    const hours = rangeOf(task);
    if (hours && (task.dueDate ?? (task.shelf === "later" ? undefined : today)) === day) {
      reminders.push({
        title: task.title, kind: "range", time: rangeText(hours, lang), start: clock(Math.floor(hours.start / 60), hours.start % 60, lang), taskId: task.id,
        at: hours.start * 60_000 - 1, ...(task.dueDate === day ? { due: true } : {}),
      });
      continue;
    }
    if (task.dueDate === day) { deadlines.push({ title: task.title, kind: "deadline", taskId: task.id }); continue; }
    const at = task.reminderAt ? new Date(task.reminderAt) : undefined;
    if (at && !Number.isNaN(at.getTime()) && dateKey(at) === day) reminders.push({ title: task.title, kind: "reminder", time: hhmm(at, lang), taskId: task.id, at: (at.getHours() * 60 + at.getMinutes()) * 60_000 });
  }
  reminders.sort((a, b) => a.at - b.at || before(a.title, b.title));
  deadlines.sort((a, b) => before(a.title, b.title));
  return [...reminders.map(({ at: _at, ...task }) => task), ...deadlines];
}

export type CellItem = { kind: "event"; event: CalendarEvent } | { kind: "task"; task: DayTask };

/** What a month cell shows: the day's events, then its deadlines (alerts stay in the day panel); the first `limit` and how many more. */
export function cellItems(day: string, events: readonly CalendarEvent[], tasks: readonly TaskLike[], limit = 3): { items: CellItem[]; more: number } {
  const all: CellItem[] = [
    ...eventsOn(day, events).map((event): CellItem => ({ kind: "event", event })),
    // (A deadline with hours on it is still the day's deadline here: cells keep their flag.)
    ...dayTasks(day, tasks).filter((task) => task.kind === "deadline" || task.due).map((task): CellItem => ({ kind: "task", task: { title: task.title, kind: "deadline", taskId: task.taskId } })),
  ];
  return { items: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

/** "2026년 10월", "October 2026", "oktober 2026" (`month` 1–12). */
export function monthTitle(year: number, month: number, lang: Lang = "ko"): string {
  return monthTitleIn(year, month, lang);
}

/**
 * "10월 4일 – 10일", "9월 27일 – 10월 3일", "2026년 12월 27일 – 2027년 1월 2일" — en "Oct 4 – 10", "Sep 27 – Oct 3",
 * "Dec 27, 2026 – Jan 2, 2027"; nl "4 – 10 okt", "27 sep – 3 okt", "27 dec 2026 – 2 jan 2027".
 */
export function weekTitle(days: readonly string[], lang: Lang = "ko"): string {
  const first = dayStart(days[0] ?? dateKey(new Date()));
  const last = dayStart(days[days.length - 1] ?? dateKey(first));
  return weekTitleIn(first, last, lang);
}

/** "10월 7일 수요일", "Wednesday, October 7", "woensdag 7 oktober" */
export function dayTitle(day: string, lang: Lang = "ko"): string {
  return longDate(dayStart(day), lang);
}

/**
 * 새 일정 on a day of the calendar: today as the strip's + (the next free half hour), unless that
 * slot falls tomorrow, then 21:00–22:00 today; any other day 09:00–10:00.
 */
export function draftForDay(day: string, now: Date, lastColor?: string): CalendarDraft {
  if (day !== dateKey(now)) return timedDraft("", day, 540, lastColor);
  const slot = nextSlot(now);
  return slot.date === day ? timedDraft("", day, slot.minutes, lastColor) : timedDraft("", day, 1260, lastColor);
}
