import { dayKey as logicalDayKey, logicalDayStart } from "./archive";
import type { EventColor, EventRepeat } from "./events";
import { isValidRule, occursOn, type RepeatKind, type Series } from "./repeat";
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
// weeks start on the system's first day (Monday or Sunday; else Sunday, Monday in Dutch: weekStartsMonday), and every
// day is a local "yyyy-MM-dd".

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
      // calendar-flows D1: the all-day one begun first (then the longer) on top, so a trip keeps its place day after
      // day and its band joins; one-day ones by title, as before.
      if (a.allDay) return a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime() || before(a.title, b.title);
      return a.start.getTime() - b.start.getTime() || before(a.title, b.title);
    });
}

// ─── 여러 날 일정과 긴 이름 (calendar-flows D1 · D2) ─────────────────────────────

/**
 * The event's key when it is drawn as a band on `day` (all day, or running through the whole day: begun the day before
 * and ending the day after), else undefined. A band with the same key on the next day in the same place joins it.
 */
export function bandKey(event: CalendarEvent, day: string): string | undefined {
  const S = dayStart(day);
  const E = nextMidnight(S);
  if (event.allDay) return event.start <= S && S < event.end ? event.key : undefined;
  return event.start < S && event.end > E ? event.key : undefined;
}

/**
 * A line of a week row's cell as drawn: `run` ≥ 1 where its title is drawn — over how many days, its own and the following
 * ones where the same band sits in the same place; 0 where an earlier day's title runs over it (the band only).
 * `fromLeft` · `toRight`: it joins the day before · after in the row.
 */
export interface Band { run: number; fromLeft: boolean; toRight: boolean }

/** It lines up with another day (a title running on, or a band joined): it keeps one line. */
export const bandJoined = (band: Band): boolean => band.fromLeft || band.toRight || band.run > 1;

/**
 * A week row's bands: `rows[d]` are day d's lines as drawn, each its band key (`bandKey`) or null. The title is drawn
 * once per run — on the band's first day in the row (a new row draws it again) — and runs over the days the same band
 * keeps the same place; a band that moves to another place starts again. Same as CalendarMonth.bands.
 */
export function bands(rows: readonly (readonly (string | null | undefined)[])[]): Band[][] {
  const keyAt = (day: number, index: number) => rows[day]?.[index] ?? undefined;
  return rows.map((lines, day) => lines.map((band, index) => {
    if (band == null) return { run: 1, fromLeft: false, toRight: false };
    const fromLeft = keyAt(day - 1, index) === band;
    const toRight = keyAt(day + 1, index) === band;
    if (fromLeft) return { run: 0, fromLeft: true, toRight };
    let run = 1;
    while (keyAt(day + run, index) === band) run += 1;
    return { run, fromLeft: false, toRight };
  }));
}

/** How a month cell's line fits on one line: whole, cut, or a band joined to another day. */
export type LineFit = "fit" | "cut" | "band";

/**
 * Audit 3 · 28 (D2): the lines that take a second line for a cut title. The cell's spare lines (`room` less the lines
 * drawn) go to the cut titles from the top, one each — never to a band joined to another day, nor to a line above one
 * (the band would leave its place beside the next day). Same as CalendarMonth.twoLineTitles.
 */
export function twoLineTitles(room: number, lines: readonly LineFit[]): boolean[] {
  let spare = room - lines.length;
  const lastBand = lines.lastIndexOf("band");
  return lines.map((fit, index) => {
    if (spare <= 0 || fit !== "cut" || index <= lastBand) return false;
    spare -= 1;
    return true;
  });
}

/**
 * #260: as `twoLineTitles`, with the day's holiday name as the cell's first line (`holiday`, undefined on other days) and
 * `room` counting it. The spare lines go from the top, so the name comes first; it takes two lines only when no band
 * passes through that day (a band below it would leave its place beside the next day). Same as CalendarMonth's.
 */
export function cellTwoLines(room: number, holiday: LineFit | undefined, lines: readonly LineFit[]): { holiday: boolean; lines: boolean[] } {
  if (!holiday) return { holiday: false, lines: twoLineTitles(room, lines) };
  const two = twoLineTitles(room, [holiday, ...lines]);
  return { holiday: two[0], lines: two.slice(1) };
}

/** #260: English and Dutch also break a long word onto the second line, by the language's hyphenation; Korean between words only. */
export const hyphenates = (lang: Lang): boolean => lang !== "ko";

/**
 * #260: how a title that may not fit sits on one line. `overflows`: wider than the line; `betweenWords`: it may break
 * between words; `inWord`: a long word of it may break at a hyphenation point. Same as CalendarMonth.lineFit.
 */
export function lineFit(overflows: boolean, betweenWords: boolean, inWord: boolean, lang: Lang): LineFit {
  if (!overflows) return "fit";
  return betweenWords || (inWord && hyphenates(lang)) ? "cut" : "fit";
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

/**
 * A task on a day: its deadline, its alert (with the time), or its hours (시간 정하기: "14:00–15:30"; `due` when it is that day's
 * deadline too). #274 `repeat`: a day a repeating to-do comes back on (`repeatsOn`) — `taskId` its open copy ("" while today's
 * is done: the line opens the rule), `series` its rule, `ahead` after the next one (faded), `remindAt` the rule's alert "HH:mm".
 */
export interface DayTask {
  title: string; kind: "deadline" | "reminder" | "range" | "repeat"; time?: string; taskId: string; due?: boolean;
  /** A range's start alone ("14:00", the week rows' time column). */ start?: string;
  series?: string; ahead?: boolean; remindAt?: string;
  /** #296: a repeat's kind of rule (매일 · 평일 · 매주 · 매달). */
  rule?: RepeatKind;
}

/**
 * #296: a faded repeat that comes back every day or every weekday — a month cell doesn't write its name but counts it in its
 * head (`foldedRepeats`). The next one (solid) and weekly · monthly ones keep their line. Same as DayTask.folds on the Mac.
 */
export const folds = (task: DayTask): boolean => task.kind === "repeat" && Boolean(task.ahead) && (task.rule === "daily" || task.rule === "weekdays");

/** #274: a repeat's day as the calendar's to-dos carry it (`repeatItems`): a stand-in due that day, drawn as its line. */
type TaskLike = { id: string; title: string; isCompleted: boolean; dueDate?: string; reminderAt?: string; timeStart?: string; timeEnd?: string; shelf?: "later" | "today"; seriesID?: string; repeatLine?: DayTask };

/**
 * Unfinished tasks due that day or alerting that day (a task with both shows once, as its
 * deadline). Alerts first by time, then deadlines by title. An alert's time is on the language's
 * clock ("09:30", "9:30 AM").
 */
export function dayTasks(day: string, tasks: readonly TaskLike[], lang: Lang = "ko", today?: string): DayTask[] {
  const reminders: (DayTask & { at: number })[] = [];
  const deadlines: DayTask[] = [];
  // #274: the day's repeats after its to-dos (they come in their order).
  const repeats: DayTask[] = [];
  for (const task of tasks) {
    if (task.isCompleted) continue;
    if (task.repeatLine) { if (task.dueDate === day) repeats.push(task.repeatLine); continue; }
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
  return [...reminders.map(({ at: _at, ...task }) => task), ...deadlines, ...repeats];
}

/**
 * #274: the days a repeating to-do comes back on among `days`, from the note's today (4 a.m.) on — each a `repeat` line with
 * the rule's title and alert time. The next one is drawn as usual and the ones after it faded (`ahead`); where the open copy
 * already shows on today or later (its alert, deadline or hours), the copy is the next one and every repeat is faded. A day
 * the copy shows on has no repeat (it isn't drawn twice), and once today's copy is done (placed today, none open) the repeats
 * start tomorrow. A line opens the open copy (`taskId`), or the rule when there is none. Each day's repeats go by their
 * time, then title (no time last). Same rule and shared cases as the Mac (CalendarMonth.repeats,
 * docs/plans/calendar-flows-cases.json `repeats`).
 */
export function repeatsOn(days: Iterable<string>, series: readonly Series[], tasks: readonly TaskLike[], now: Date, lang: Lang = "ko"): Map<string, DayTask[]> {
  const found = new Map<string, { minutes: number; task: DayTask }[]>();
  if (series.length === 0) return new Map();
  const today = logicalDayKey(now);
  const wanted = new Set([...days].filter((day) => day >= today));
  if (wanted.size === 0) return new Map();
  const last = [...wanted].sort().pop()!;
  const open = new Map<string, TaskLike>();
  for (const task of tasks) {
    if (!task.isCompleted && task.seriesID && !open.has(task.seriesID)) open.set(task.seriesID, task);
  }
  for (const entry of series) {
    if (!isValidRule(entry.rule)) continue;
    const copy = open.get(entry.id);
    // The days the open copy is drawn on already.
    const shown = new Set<string>();
    if (copy) {
      if (copy.dueDate) shown.add(copy.dueDate);
      const at = copy.reminderAt ? new Date(copy.reminderAt) : undefined;
      if (at && !Number.isNaN(at.getTime())) shown.add(dateKey(at));
      const hoursDay = copy.dueDate ?? (copy.shelf === "later" ? undefined : today);
      if (rangeOf(copy) && hoursDay) shown.add(hoursDay);
    }
    const copyAhead = [...shown].some((day) => day >= today);
    const parts = entry.remindAt?.split(":").map(Number);
    const timed = parts?.length === 2 && parts.every(Number.isInteger);
    const time = timed ? clock(parts![0], parts![1], lang) : undefined;
    const minutes = timed ? parts![0] * 60 + parts![1] : Number.MAX_SAFE_INTEGER;
    const first = entry.lastPlaced === today && !copy ? 1 : 0;
    const start = localDate(today)!;
    let next: string | undefined;
    // Day by day from the first one on to the last day asked about (within two years, as nextOccurrence).
    for (let step = first; step < first + 750; step += 1) {
      const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + step);
      const day = dateKey(date);
      if (day > last && next) break;
      if (!occursOn(entry.rule, date)) continue;
      next ??= day;
      if (!wanted.has(day) || shown.has(day)) continue;
      const line: DayTask = {
        title: entry.title, kind: "repeat", ...(time ? { time, remindAt: entry.remindAt } : {}), taskId: copy?.id ?? "", series: entry.id,
        ahead: copyAhead || day !== next, rule: entry.rule.kind,
      };
      found.set(day, [...(found.get(day) ?? []), { minutes, task: line }]);
    }
  }
  return new Map([...found].map(([day, list]) => [day, list.sort((a, b) => a.minutes - b.minutes || before(a.task.title, b.task.title)).map((entry) => entry.task)]));
}

/**
 * #274: the repeats of `days` as the calendar's to-dos carry them — a stand-in to-do due that day for each line, which
 * `dayTasks` and `cellItems` draw as that line. The calendar, the widgets and the day sheet add them to the to-dos they show.
 */
export function repeatItems<T extends TaskLike>(tasks: readonly T[], series: readonly Series[], days: Iterable<string>, now: Date, lang: Lang = "ko"): (T | TaskLike)[] {
  const found = repeatsOn(days, series, tasks, now, lang);
  if (found.size === 0) return [...tasks];
  const extra: TaskLike[] = [];
  for (const [day, lines] of found) {
    lines.forEach((line, index) => extra.push({ id: `repeat:${line.series}@${day}#${index}`, title: line.title, isCompleted: false, dueDate: day, repeatLine: line }));
  }
  return [...tasks, ...extra];
}

export type CellItem = { kind: "event"; event: CalendarEvent } | { kind: "task"; task: DayTask };

/**
 * What a month cell shows: the day's events, then its deadlines, then its reminders (#227: the title only, the time is in
 * the tooltip and the day panel; a to-do due the same day shows once, as its deadline); the first `limit` and how many more.
 * `folding` (#296, the month's cells): without the faded daily · weekday repeats, which the head counts (`foldedRepeats`).
 */
export function cellItems(day: string, events: readonly CalendarEvent[], tasks: readonly TaskLike[], limit = 3, lang: Lang = "ko", folding = false): { items: CellItem[]; more: number } {
  const onDay = dayTasks(day, tasks, lang);
  const all: CellItem[] = [
    ...eventsOn(day, events).map((event): CellItem => ({ kind: "event", event })),
    // (A deadline with hours on it is still the day's deadline here: cells keep their flag.)
    ...onDay.filter((task) => task.kind === "deadline" || task.due).map((task): CellItem => ({ kind: "task", task: { title: task.title, kind: "deadline", taskId: task.taskId } })),
    ...onDay.filter((task) => task.kind === "reminder").map((task): CellItem => ({ kind: "task", task })),
    // #274: the repeats last, the first to go into +N.
    ...onDay.filter((task) => task.kind === "repeat" && !(folding && folds(task))).map((task): CellItem => ({ kind: "task", task })),
  ];
  return { items: all.slice(0, limit), more: Math.max(0, all.length - limit) };
}

/** #296: the day's faded daily · weekday repeats, which a month cell folds into its head (a mark and how many). */
export function foldedRepeats(day: string, tasks: readonly TaskLike[], lang: Lang = "ko"): DayTask[] {
  return dayTasks(day, tasks, lang).filter(folds);
}

/**
 * #296: what a month cell's head says for the repeats it folds — "매일 반복 2개", "평일 반복 1개", "매일 · 평일 반복 3개"; en
 * "2 daily repeats", "1 weekday repeat", "3 daily and weekday repeats"; nl "2 dagelijkse herhalingen", "1 doordeweekse
 * herhaling", "3 dagelijkse en doordeweekse herhalingen". The screen reader reads it; undefined for none.
 */
export function foldedLabel(tasks: readonly DayTask[], lang: Lang = "ko"): string | undefined {
  if (tasks.length === 0) return undefined;
  const daily = tasks.some((task) => task.rule === "daily"), weekdays = tasks.some((task) => task.rule === "weekdays");
  const n = tasks.length;
  if (lang === "ko") return `${daily && weekdays ? "매일 · 평일" : daily ? "매일" : "평일"} 반복 ${n}개`;
  if (lang === "en") return plural(n, `${daily && weekdays ? "daily and weekday" : daily ? "daily" : "weekday"} repeat`, `${daily && weekdays ? "daily and weekday" : daily ? "daily" : "weekday"} repeats`);
  const kind = daily && weekdays ? "dagelijkse en doordeweekse" : daily ? "dagelijkse" : "doordeweekse";
  return plural(n, `${kind} herhaling`, `${kind} herhalingen`);
}

/** #296: the folded repeats' tooltip — the label, then each one's time and name a line: "매일 반복 2개\n08:00 약 먹기\n물 마시기". */
export function foldedTooltip(tasks: readonly DayTask[], lang: Lang = "ko"): string | undefined {
  const label = foldedLabel(tasks, lang);
  return label === undefined ? undefined : [label, ...tasks.map((task) => (task.time ? `${task.time} ${task.title}` : task.title))].join("\n");
}

/** #296: whether a month cell's line may take a spare line (`cellTwoLines`): not a faded repeat — the spare lines go to the events and to-dos first. */
export const mayWrap = (item: CellItem): boolean => !(item.kind === "task" && item.task.kind === "repeat" && item.task.ahead);

/**
 * A week row's tasks (#227, as the month cell's order): the deadlines first, then the alerts and hours by time — when the
 * row is full, "+N개 더" takes the reminders first. The day panel keeps `dayTasks`' order.
 */
export function weekOrder(tasks: readonly DayTask[]): DayTask[] {
  return [...tasks.filter((task) => task.kind === "deadline"), ...tasks.filter((task) => task.kind !== "deadline")];
}

/**
 * A task line's tooltip in a month cell or a week row (#227): "알림 15:00 · 치과 예약", "마감 · 보고서 쓰기", "14:00–15:30 · 운동"
 * — en "Reminder 3:00 PM · …", "Due · …"; nl "Herinnering 15:00 · …", "Deadline · …".
 */
export function taskTooltip(task: DayTask, lang: Lang = "ko"): string {
  const index = langIndex(lang);
  if (task.kind === "reminder") return `${["알림", "Reminder", "Herinnering"][index]} ${task.time ?? ""} · ${task.title}`;
  if (task.kind === "deadline") return `${["마감", "Due", "Deadline"][index]} · ${task.title}`;
  // #274: "반복 예정 09:00 · 분리수거", the next one "반복 09:00 · …".
  if (task.kind === "repeat") return `${repeatWord(Boolean(task.ahead), lang)}${task.time ? ` ${task.time}` : ""} · ${task.title}`;
  return `${task.time ?? ""} · ${task.title}`;
}

/** #274: what a repeat's line is: "반복 예정" (faded) or "반복" (the next one) — en "Upcoming repeat" · "Repeat"; nl "Komende herhaling" · "Herhaling". */
export function repeatWord(ahead: boolean, lang: Lang = "ko"): string {
  return (ahead ? ["반복 예정", "Upcoming repeat", "Komende herhaling"] : ["반복", "Repeat", "Herhaling"])[langIndex(lang)];
}

/** #274: a repeat's spoken name: "분리수거, 09:00, 반복 예정" — en "Recycling, 9:00 AM, upcoming repeat"; other lines their tooltip. */
export function taskSpoken(task: DayTask, lang: Lang = "ko"): string {
  if (task.kind !== "repeat") return taskTooltip(task, lang);
  const word = repeatWord(Boolean(task.ahead), lang);
  return [task.title, ...(task.time ? [task.time] : []), lang === "ko" ? word : word.toLowerCase()].join(", ");
}

// ─── 날 목록을 키보드로 (#275) ──────────────────────────────────────────────────

export type ListKey = "tab" | "backTab" | "up" | "down" | "enter" | "escape" | "other";

/**
 * What a key does (#275): `picked` is the day list's event the keys are on (undefined: the days have them), `count` the day's
 * events. From the days, Tab goes to the first event (with none it passes on). In the list, ↑ ↓ move (they stop at the
 * ends), Tab · Shift+Tab go to the next · previous and past the ends back to the days, Enter opens the event (`open`), Esc
 * goes back to the days. Another key goes back to the days and is theirs (`handled: false`: ← → T move the day as before).
 * Same keys and shared cases as the Mac (CalendarMonth.listKey).
 */
export function listKey(key: ListKey, picked: number | undefined, count: number): { picked?: number; open?: number; handled: boolean } {
  const current = picked === undefined ? -1 : Math.min(picked, count - 1);
  if (current < 0) return key === "tab" && count > 0 ? { picked: 0, handled: true } : { handled: false };
  switch (key) {
    case "down": return { picked: Math.min(current + 1, count - 1), handled: true };
    case "up": return { picked: Math.max(current - 1, 0), handled: true };
    case "tab": return current + 1 < count ? { picked: current + 1, handled: true } : { handled: true };
    case "backTab": return current > 0 ? { picked: current - 1, handled: true } : { handled: true };
    case "enter": return { picked: current, open: current, handled: true };
    case "escape": return { handled: true };
    default: return { handled: false };
  }
}

/**
 * #275: an event row's spoken name — "디자인 리뷰, 14:00–15:00, 일정 3개 중 1번째"; en "Design review, 2:00–3:00 PM, event 1 of 3";
 * nl "Ontwerpbespreking, 14:00–15:00, afspraak 1 van 3".
 */
export function eventLabel(title: string, time: string, index: number, count: number, lang: Lang = "ko"): string {
  const place = lang === "ko" ? `일정 ${count}개 중 ${index + 1}번째` : lang === "en" ? `event ${index + 1} of ${count}` : `afspraak ${index + 1} van ${count}`;
  return `${title}, ${time}, ${place}`;
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
