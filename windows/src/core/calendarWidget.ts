import { dayKey as logicalDayKey } from "./archive";
import { agendaTime, cellItems, dateKey, dayTasks, dayTitle, draftForDay, eventsOn, localDate, monthGrid, weekDays, type CalendarEvent, type CellItem } from "./calendar";
import { chipText, kindName, readIntent, slashOf, type Candidate } from "./intent";
import { clock, dayMonth, dayWord, langIndex, shortDate, timeRange, weekdayName, weekdayShort, type Lang } from "./lang";
import type { TodoItem } from "./notebook";
import { saysDay } from "./quickParse";
import { rangeText, rangeTimes } from "./timeRange";

/**
 * 바탕화면 달력 위젯 (#234): the rules of the calendar widgets on the desktop — what each kind shows, how the paper fades
 * and the text stays readable, where a widget sits on which display, what a line typed into its day sheet makes, and
 * when it draws again. The cells come from the desk calendar's core (calendar.ts: cellItems · dayTasks · eventsOn), with
 * the to-dos of the spaces this PC hides already left out. Days run midnight to midnight, like the calendar. Same rules
 * and shared cases as the Mac (PaperCore/CalendarWidget.swift, docs/plans/calendar-widget-cases.json).
 */

// ─── Kinds and settings ───────────────────────────────────────────────────────

export type WidgetKind = "today" | "week" | "month" | "agenda";
/** `wall` (벽 달력): the month detailed at a wall calendar's size (this month only). */
export type WidgetStyle = "simple" | "detail" | "wall";
/** `desktop`: under the other windows (바탕화면에 두기, the default); `top`: 항상 위에 두기. */
export type WidgetLevel = "desktop" | "top";
export const widgetKinds: readonly WidgetKind[] = ["today", "week", "month", "agenda"];
export const widgetStyles: readonly WidgetStyle[] = ["simple", "detail", "wall"];
export const widgetLevels: readonly WidgetLevel[] = ["desktop", "top"];

/** The display's id and the top-left corner as a share (0–1) of the room the widget can move in on its work area. */
export interface WidgetPlace { display: string; x: number; y: number }

export interface WidgetSettings {
  id: string;
  kind: WidgetKind;
  style: WidgetStyle;
  /** 20–100 in steps of 5. */
  opacity: number;
  solidOnHover: boolean;
  clickThrough: boolean;
  locked: boolean;
  level: WidgetLevel;
  allSpaces: boolean;
  place?: WidgetPlace;
}

/** A device keeps at most four (each is a window and its own page process). */
export const widgetLimit = 4;
export const defaultOpacity = 85;

/** Only the week and the month come in 간단히 and 자세히. */
export const hasStyles = (kind: WidgetKind): boolean => kind === "week" || kind === "month";
/** The month also comes as 벽 달력. */
export function stylesOf(kind: WidgetKind): readonly WidgetStyle[] {
  if (kind === "month") return ["simple", "detail", "wall"];
  if (kind === "week") return ["simple", "detail"];
  return ["simple"];
}
/** A style the kind has: the week's `wall` reads as `detail` (S6), anything else it lacks as `simple`. */
function styleFor(kind: WidgetKind, style: WidgetStyle | undefined): WidgetStyle {
  const wanted = style ?? "simple";
  if (stylesOf(kind).includes(wanted)) return wanted;
  return wanted === "wall" && kind === "week" ? "detail" : "simple";
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const share = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);
const numberOf = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

/** A widget with every field in range (the defaults for the rest). */
export function widget(fields: Partial<WidgetSettings> & Pick<WidgetSettings, "id" | "kind">): WidgetSettings {
  return {
    id: fields.id, kind: fields.kind, style: styleFor(fields.kind, fields.style),
    opacity: readOpacity(fields.opacity ?? defaultOpacity), solidOnHover: fields.solidOnHover ?? true, clickThrough: fields.clickThrough ?? false,
    locked: fields.locked ?? false, level: fields.level ?? "desktop", allSpaces: fields.allSpaces ?? true,
    ...(fields.place ? { place: { display: fields.place.display, x: share(fields.place.x), y: share(fields.place.y) } } : {}),
  };
}

/**
 * The widgets as stored (`prefs.calendarWidgets`; the Mac's `calendar.widgets`): an entry of the wrong shape is dropped
 * (S1), a value out of range is read as the nearest one, the fifth and later aren't read (S2), today and agenda are
 * always simple (S3), a missing key takes its default (S4); the same id twice keeps the first (S5).
 */
export function readWidgets(value: unknown): WidgetSettings[] {
  if (!Array.isArray(value)) return [];
  const found: WidgetSettings[] = [];
  value.forEach((entry, index) => {
    if (found.length >= widgetLimit || !isObject(entry)) return;
    if (!widgetKinds.includes(entry.kind as WidgetKind)) return;
    if (entry.style !== undefined && !widgetStyles.includes(entry.style as WidgetStyle)) return;
    if (entry.level !== undefined && !widgetLevels.includes(entry.level as WidgetLevel)) return;
    let place: WidgetPlace | undefined;
    if (entry.place !== undefined && entry.place !== null) {
      const p = entry.place;
      if (!isObject(p) || typeof p.display !== "string" || numberOf(p.x) === undefined || numberOf(p.y) === undefined) return;
      place = { display: p.display, x: share(p.x as number), y: share(p.y as number) };
    }
    const id = typeof entry.id === "string" && entry.id ? entry.id : `w-${index + 1}`;
    if (found.some((other) => other.id === id)) return;
    const flag = (key: string, fallback: boolean) => (typeof entry[key] === "boolean" ? entry[key] as boolean : fallback);
    const opacity = numberOf(entry.opacity);
    found.push(widget({
      id, kind: entry.kind as WidgetKind, style: (entry.style as WidgetStyle | undefined) ?? "simple",
      opacity: opacity === undefined ? defaultOpacity : Math.round(opacity),
      solidOnHover: flag("solidOnHover", true), clickThrough: flag("clickThrough", false), locked: flag("locked", false),
      level: (entry.level as WidgetLevel | undefined) ?? "desktop", allSpaces: flag("allSpaces", true), ...(place ? { place } : {}),
    }));
  });
  return found;
}

/** The widgets to store, in the shape `readWidgets` takes. */
export function writeWidgets(list: readonly WidgetSettings[]): WidgetSettings[] {
  return list.slice(0, widgetLimit).map((entry) => widget(entry));
}

/** A new widget's id: "w-" and four hex digits not taken yet. */
export function newWidgetId(taken: readonly string[], random: () => number = () => Math.floor(Math.random() * 0x10000)): string {
  for (;;) {
    const id = `w-${random().toString(16).padStart(4, "0").slice(-4)}`;
    if (!taken.includes(id)) return id;
  }
}

// ─── Sizes ────────────────────────────────────────────────────────────────────

/** The paper's size in DIPs (the Mac's points): fixed per kind, so each cell holds a known number of lines. */
export function widgetSize(kind: WidgetKind, style: WidgetStyle): { width: number; height: number } {
  if (kind === "today") return { width: 170, height: 170 };
  if (kind === "week") return { width: 344, height: 170 };
  if (kind === "agenda") return { width: 200, height: 360 };
  if (style === "wall") return { width: 880, height: 680 };
  return style === "detail" ? { width: 560, height: 440 } : { width: 344, height: 344 };
}

/** The ears' scale (the note's ears are 1): small 0.6, medium 0.75, large 0.9, the biggest and the tall list 1. */
export function earScale(kind: WidgetKind, style: WidgetStyle): number {
  if (kind === "today") return 0.6;
  if (kind === "week") return 0.75;
  if (kind === "agenda") return 1;
  if (style === "wall") return 1.15;
  return style === "detail" ? 1 : 0.9;
}

/** The ears stand this far above the paper (the note's ears are 16 tall). */
export const earHeightOf = (kind: WidgetKind, style: WidgetStyle): number => 16 * earScale(kind, style);

/** The window: the paper and the ears above it. Placing works on this frame, so the ears stay on screen too. */
export function windowSize(kind: WidgetKind, style: WidgetStyle): { width: number; height: number } {
  const paper = widgetSize(kind, style);
  return { width: paper.width, height: paper.height + earHeightOf(kind, style) };
}

/** The two ears' bases, in from the window's right edge (the note's 16–48 and 62–92), scaled. */
export function earBasesOf(kind: WidgetKind, style: WidgetStyle): { near: number; far: number }[] {
  const k = earScale(kind, style);
  return [{ near: 16 * k, far: 48 * k }, { near: 62 * k, far: 92 * k }];
}

/** The smallest a thing one clicks may be (+N, ‹ ›, the + of 오늘 and 오늘 목록), in DIPs. */
export const hitTarget = 24;

// ─── Opacity (#234 Q5–Q8) ─────────────────────────────────────────────────────

/** Read as 20–100 in steps of 5 (O1). */
export function readOpacity(value: number): number {
  const stepped = Math.round(value / 5) * 5;
  return Math.min(100, Math.max(20, Number.isFinite(stepped) ? stepped : defaultOpacity));
}

/** Below 85 % the day numbers are a step bolder (O7). */
export const backingOpacity = 85;

type Rgb = [number, number, number];
/** sRGB (0–1, rounded to 0–255 as the app's colours are): `alpha` of `a` over `b`. */
export function mix(a: Rgb, alpha: number, b: Rgb): Rgb {
  return [0, 1, 2].map((i) => Math.round((a[i] * alpha + b[i] * (1 - alpha)) * 255) / 255) as Rgb;
}
/** WCAG contrast of two sRGB colours (0–1). */
export function contrast(a: Rgb, b: Rgb): number {
  const channel = (c: number) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const luminance = (c: Rgb) => 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
/** "#rrggbb" as sRGB 0–1. */
export function rgbOf(hex: string): Rgb {
  const v = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

/**
 * The paper's floor (#234, frosted tiles): the faintest a day's tile or a line's backing may be, so ink on it keeps 4.5:1
 * over the worst wallpaper (black behind a light paper, white behind a dark one), in 5 % steps — day paper 60, kraft 65,
 * night 75 (cases O9, every paper of #244).
 */
export function floorOf(paper: Rgb, ink: Rgb, dark: boolean): number {
  const worst: Rgb = dark ? [1, 1, 1] : [0, 0, 0], other: Rgb = dark ? [0, 0, 0] : [1, 1, 1];
  for (let step = 20; step <= 100; step += 5) {
    const a = step / 100;
    if (contrast(ink, mix(paper, a, worst)) >= 4.5 && contrast(ink, mix(paper, a, other)) >= 4.5) return step;
  }
  return 100;
}
/** The weekend and holiday tiles' colour: the paper with its clay-2 mixed in (55 %). Its own floor (a little higher than
 *  the plain paper's on light papers: day 65, as the tint darkens it) keeps ink at 4.5:1 on it too. */
export const weekendTint = (clay2: Rgb, paper: Rgb): Rgb => mix(clay2, 0.55, paper);
/** A day's tile (the month and the week): the paper as drawn, never fainter than its floor. */
export const tile = (drawn: number, floor: number): number => Math.max(drawn, floor);
/** Text off the tiles gets a backing of the paper at its floor once the paper is fainter than that (O2). */
export const backing = (drawn: number, floor: number): boolean => drawn < floor;
/** Below 100 % ink2 · ink3 · sage-text · clay-text are drawn in ink (O3). */
export const inkOnly = (drawn: number): boolean => drawn < 100;
/** Below 85 % the day numbers are a step bolder; below 100 % the marks get a ring of paper (O7). */
export const bolder = (drawn: number): boolean => drawn < backingOpacity;
export const halo = (drawn: number): boolean => drawn < 100;

/** The paper as drawn (O4, O6): 100 with 투명도 줄이기, and while the pointer is over it (마우스를 올리면 선명하게). */
export function drawnOpacity(opacity: number, reduceTransparency: boolean, hover: boolean, solidOnHover: boolean): number {
  if (reduceTransparency || (hover && solidOnHover)) return 100;
  return readOpacity(opacity);
}

/** The ears never go below 85 % (O5): they are the handle, also while clicks pass through. */
export const earFloor = 85;
export const earOpacity = (drawn: number): number => Math.max(drawn, earFloor);
/** The edge line's strength (0–1): never fainter than half (O8). */
export const edgeStrength = (drawn: number): number => Math.max(0.5, drawn / 100);

// ─── Lines ────────────────────────────────────────────────────────────────────

/** One thing on a day as a widget shows it. */
export interface WidgetLine {
  kind: "event" | "deadline" | "reminder" | "range";
  title: string;
  /** "10:00", "10:00 AM", "~01:00", a range "14:00–15:30"; undefined for all day and deadlines (drawn 종일 · 마감). */
  time?: string;
  /** An event's "#rrggbb"; `clay` for a deadline, `sage` for a reminder or a range (the dots, #227). */
  color: string;
  allDay: boolean;
  eventKey?: string;
  taskId?: string;
  /** When it starts and ends; undefined for all-day events and deadlines. */
  at?: Date;
  end?: Date;
}

const hhmm = (date: Date, lang: Lang) => clock(date.getHours(), date.getMinutes(), lang);
const midnightOf = (day: string) => localDate(day) ?? new Date(new Date().setHours(0, 0, 0, 0));
const addDays = (day: string, count: number) => {
  const date = midnightOf(day);
  return dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + count));
};

/** Gone by at `now`: an event or a range once it ended, a reminder once its time came. */
export function lineOver(line: WidgetLine, now: Date): boolean {
  if (line.kind === "deadline") return false;
  if (line.kind === "event") {
    if (line.allDay || !line.at) return false;
    const end = line.end ?? line.at;
    return end.getTime() === line.at.getTime() ? line.at < now : end <= now;
  }
  if (line.kind === "reminder") return line.at ? line.at <= now : false;
  return line.end ? line.end <= now : false;
}

/**
 * A day's things in time order: all-day events, then the events, reminders and ranges by time (an event first at the
 * same time), then the deadlines by title (오늘 목록, the day sheet, the 오늘 widget).
 */
export function dayLines(day: string, events: readonly CalendarEvent[], tasks: readonly TodoItem[], now: Date, lang: Lang = "ko"): WidgetLine[] {
  const midnight = midnightOf(day);
  const next = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() + 1);
  const allDay: WidgetLine[] = [];
  const timed: { at: number; order: number; line: WidgetLine }[] = [];
  for (const event of eventsOn(day, events)) {
    if (event.allDay || (event.start < midnight && event.end > next)) {
      allDay.push({ kind: "event", title: event.title, color: event.color, allDay: true, eventKey: event.key });
      continue;
    }
    const time = event.start < midnight ? agendaTime(event, day, lang) : hhmm(event.start, lang);
    timed.push({ at: event.start.getTime(), order: 0, line: { kind: "event", title: event.title, time, color: event.color, allDay: false, eventKey: event.key, at: event.start, end: event.end } });
  }
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const deadlines: WidgetLine[] = [];
  for (const task of dayTasks(day, tasks, lang, logicalDayKey(now))) {
    if (task.kind === "deadline") { deadlines.push({ kind: "deadline", title: task.title, color: "clay", allDay: false, taskId: task.taskId }); continue; }
    const item = byId.get(task.taskId);
    if (task.kind === "reminder") {
      const at = item?.reminderAt ? new Date(item.reminderAt) : undefined;
      timed.push({ at: at?.getTime() ?? midnight.getTime(), order: 1, line: { kind: "reminder", title: task.title, time: task.time, color: "sage", allDay: false, taskId: task.taskId, ...(at ? { at } : {}) } });
      continue;
    }
    const span = item ? rangeTimes(item, now) : undefined;
    timed.push({ at: span?.start.getTime() ?? midnight.getTime(), order: 1, line: { kind: "range", title: task.title, time: task.time, color: "sage", allDay: false, taskId: task.taskId, ...(span ? { at: span.start, end: span.end } : {}) } });
  }
  const ordered = timed.map((entry, index) => ({ ...entry, index })).sort((a, b) => a.at - b.at || a.order - b.order || a.index - b.index).map((entry) => entry.line);
  return [...allDay, ...ordered, ...deadlines];
}

/** 오늘 · 이번 주 간단히: what is still to come today, the first `limit`, and how many more (K1, K2). */
export function upcoming(day: string, events: readonly CalendarEvent[], tasks: readonly TodoItem[], now: Date, limit = 3, lang: Lang = "ko"): { lines: WidgetLine[]; more: number } {
  const left = dayLines(day, events, tasks, now, lang).filter((line) => !lineOver(line, now));
  return { lines: left.slice(0, limit), more: Math.max(0, left.length - limit) };
}

/** A month cell's line as a widget line (the desk calendar's cell: events, then deadlines, then reminders). */
export function cellLine(item: CellItem, lang: Lang = "ko"): WidgetLine {
  if (item.kind === "event") {
    const event = item.event;
    return { kind: "event", title: event.title, ...(event.allDay ? {} : { time: hhmm(event.start, lang), at: event.start }), end: event.end, color: event.color, allDay: event.allDay, eventKey: event.key };
  }
  const task = item.task;
  return { kind: task.kind, title: task.title, ...(task.kind !== "deadline" && task.time ? { time: task.time } : {}), color: task.kind === "deadline" ? "clay" : "sage", allDay: false, taskId: task.taskId };
}

/** 간단히 (week, month): the cell's first three marks' colours, and whether there are more (K3, K5). */
export function dots(day: string, events: readonly CalendarEvent[], tasks: readonly TodoItem[]): { colors: string[]; plus: boolean } {
  const cell = cellItems(day, events, tasks, 3);
  return { colors: cell.items.map((item) => cellLine(item).color), plus: cell.more > 0 };
}

/** 이번 주 자세히: a day's row — its first thing and how many more (K4). */
export function weekRow(day: string, events: readonly CalendarEvent[], tasks: readonly TodoItem[], lang: Lang = "ko"): { first?: WidgetLine; more: number } {
  const cell = cellItems(day, events, tasks, 1, lang);
  return { ...(cell.items[0] ? { first: cellLine(cell.items[0], lang) } : {}), more: cell.more };
}

/** 이번 달 자세히: two titles a cell, the rest as +N beside the day's number (K6). */
export const detailLines = 2;
/** 벽 달력: four (K12). */
export const linesOf = (style: WidgetStyle): number => (style === "wall" ? 4 : detailLines);
export function monthCell(day: string, events: readonly CalendarEvent[], tasks: readonly TodoItem[], lang: Lang = "ko", style: WidgetStyle = "detail"): { lines: WidgetLine[]; more: number } {
  const cell = cellItems(day, events, tasks, linesOf(style), lang);
  return { lines: cell.items.map((item) => cellLine(item, lang)), more: cell.more };
}

/** 오늘 목록: today and tomorrow, each in time order with its deadlines last (K7). */
export function agenda(today: string, events: readonly CalendarEvent[], tasks: readonly TodoItem[], now: Date, lang: Lang = "ko"): { day: string; lines: WidgetLine[] }[] {
  return [today, addDays(today, 1)].map((day) => ({ day, lines: dayLines(day, events, tasks, now, lang) }));
}

/** The month `months` after today's (1–12). */
export function shiftedMonth(today: string, months: number): { year: number; month: number } {
  const index = Number(today.slice(0, 4)) * 12 + Number(today.slice(5, 7)) - 1 + months;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** The days a widget's page shows (and spreads the events over): today too, for the upcoming lines. */
export function pageDays(kind: WidgetKind, today: string, offset = 0, lang: Lang = "ko"): string[] {
  if (kind === "today") return [today];
  if (kind === "agenda") return [today, addDays(today, 1)];
  const days = kind === "week" ? weekDays(addDays(today, 7 * offset), lang) : (() => { const { year, month } = shiftedMonth(today, offset); return monthGrid(year, month, lang); })();
  return [...new Set([...days, today])].sort();
}

/** 오늘은 비어 있어요 (K9). */
export const emptyText = (lang: Lang = "ko"): string => ["오늘은 비어 있어요", "Nothing today", "Niets vandaag"][langIndex(lang)];

// ─── The day sheet (busy days) ────────────────────────────────────────────────

/** The day sheet beside the widget: every thing of that day with its time, in `dayLines`' order, also what is over (D1). */
export const sheetLines = dayLines;

/** Alt+← · Alt+→ in the sheet: the day before or after (D4). */
export const stepDay = (day: string, days: number): string => addDays(day, days);

/**
 * The lunar date beside a cell's number (calendar-flows 11): a cell narrower than this (px, the Mac's pt) shows the number
 * only — the lunar date pushed the head and the lines out of place.
 */
export const lunarCellWidth = 60;

/** Whether a cell's head shows its lunar date: not in a narrow cell; with +N in the head too, only on a lunar month's first day. Same as CalendarWidget.showsLunar. */
export function showsLunar(lunarDay: number, cellWidth: number, moreInHead: boolean): boolean {
  if (cellWidth < lunarCellWidth) return false;
  return moreInHead ? lunarDay === 1 : true;
}

/**
 * The sheet's first line on a holiday (calendar-flows): ‘공휴일’ in the time's column and the holiday's name beside it, as a
 * month cell's first line is the holiday's name.
 */
export const holidayWord = (lang: Lang = "ko"): string => ["공휴일", "Holiday", "Feestdag"][langIndex(lang)];

/** The sheet's heading: "11월 14일 토요일" (D7). */
export const sheetTitle = (day: string, lang: Lang = "ko"): string => dayTitle(day, lang);

/** The +N's spoken name: "3개 더 보기", "3 more", "nog 3" (D6). */
export const moreLabel = (count: number, lang: Lang = "ko"): string => [`${count}개 더 보기`, `${count} more`, `nog ${count}`][langIndex(lang)];

// ─── Quick entry (#234 Q9, Q10) ───────────────────────────────────────────────

type TodoCandidate = Extract<Candidate, { kind: "todo" }>;
type EventCandidate = Extract<Candidate, { kind: "event" }>;

/** A to-do read from today, put on `day`: its reminder or range at the same clock on that day — never in the past (then due that day without one) — and one with no time due that day. */
export function onDay(todo: TodoCandidate, day: string, now: Date): TodoCandidate {
  const midnight = midnightOf(day);
  const at = (minutes: number) => new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate(), 0, minutes);
  const { reminderAt: _reminder, dueDate: _due, range: _range, ...rest } = todo;
  if (todo.range) {
    const start = at(todo.range.start);
    const due = day === logicalDayKey(now) ? undefined : day;
    const reminderAt = start > now ? start : undefined;
    const dueDate = due ?? (reminderAt ? undefined : day);
    return { ...rest, ...(reminderAt ? { reminderAt } : {}), ...(dueDate ? { dueDate } : {}), range: { ...todo.range, day } };
  }
  if (todo.reminderAt) {
    const moment = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate(), todo.reminderAt.getHours(), todo.reminderAt.getMinutes());
    return moment > now ? { ...rest, reminderAt: moment } : { ...rest, dueDate: day };
  }
  return { ...rest, dueDate: day };
}

/** The day a to-do lands on: its deadline's (or range's), else its reminder's, else today. */
export function todoDay(todo: TodoCandidate, now: Date): string {
  return todo.dueDate ?? todo.range?.day ?? (todo.reminderAt ? dateKey(todo.reminderAt) : dateKey(now));
}

/** The day a candidate lands on (the toast says it). */
export function candidateDay(candidate: Candidate, now: Date): string {
  if (candidate.kind === "todo") return todoDay(candidate, now);
  if (candidate.kind === "event") return candidate.day;
  return dateKey(now);
}

/**
 * What a line typed on a day makes, best first: the input line's reading (`readIntent`), on the clicked day when the text
 * names no day (`saysDay`), else on the day it names (read from today). Only to-dos and events: an alarm becomes a to-do
 * with a reminder (Q4), a timer or a memo is left out (its to-do stays, Q5), a repeating line stays repeating (Q9). A line
 * that offers no event gets the day's new event (09:00–10:00, or the next half hour today) to Tab to.
 */
export function quickCandidates(text: string, day: string, now: Date, lang: Lang = "ko"): Candidate[] {
  const read = readIntent(text, now, lang);
  if (read.length === 0) return [];
  const said = saysDay(text, now, lang);
  const first = read[0];
  if (first.kind === "alarm") {
    const [hour, minute] = first.time.split(":").map(Number);
    const midnight = midnightOf(day);
    const at = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate(), hour || 0, minute || 0);
    return [onDay({ kind: "todo", title: first.label || text.trim(), reminderAt: at }, day, now)];
  }
  let found: Candidate[] = [];
  for (const candidate of read) {
    if (candidate.kind === "todo") found.push(said ? candidate : onDay(candidate, day, now));
    else if (candidate.kind === "event") found.push(!said && !candidate.repeat ? { ...candidate, day } : candidate);
    else if (candidate.kind === "repeat") found.push(candidate);
  }
  if (found.length === 0) found = [onDay({ kind: "todo", title: text.trim() }, day, now)];
  const todo = found.find((candidate): candidate is TodoCandidate => candidate.kind === "todo");
  if (!slashOf(text.trim(), lang) && !found.some((candidate) => candidate.kind === "event") && todo) {
    const draft = draftForDay(todoDay(todo, now), now);
    found.push({ kind: "event", title: todo.title, day: draft.date, start: draft.startMinutes, end: draft.endMinutes, allDay: false } satisfies EventCandidate);
  }
  return found;
}

/** "14일(토)", "Sat 14", "za 14"; another month than today's: "12월 2일(수)", "Wed, Dec 2", "wo 2 dec". */
export function chipDay(day: string, today: string | undefined, lang: Lang = "ko"): string {
  const date = midnightOf(day);
  const short = weekdayShort(date.getDay(), lang);
  if (!today || today.slice(0, 7) === day.slice(0, 7)) return lang === "ko" ? `${date.getDate()}일(${short})` : `${short} ${date.getDate()}`;
  return lang === "ko" ? `${dayMonth(date.getMonth() + 1, date.getDate(), undefined, lang)}(${short})` : shortDate(date, lang);
}

/** The chip's halves: "할 일" "14일(토) 마감", "할 일" "알림 14일(토) 15:00", "일정" "14일(토) 15:00–16:00"; a repeating one as the input line writes it. */
export function chipParts(candidate: Candidate, now: Date, lang: Lang = "ko"): { kind: string; when: string } {
  const i = langIndex(lang);
  const today = dateKey(now);
  if (candidate.kind === "todo") {
    const head = kindName("todo", lang);
    if (candidate.range) {
      const { start, end } = candidate.range;
      return { kind: head, when: `${chipDay(todoDay(candidate, now), today, lang)} ${rangeText({ start: start % 1440, end: end % 1440 }, lang)}` };
    }
    if (candidate.reminderAt) return { kind: head, when: `${["알림", "reminder", "herinnering"][i]} ${chipDay(dateKey(candidate.reminderAt), today, lang)} ${hhmm(candidate.reminderAt, lang)}` };
    if (candidate.dueDate) {
      const day = chipDay(candidate.dueDate, today, lang);
      return { kind: head, when: lang === "ko" ? `${day} 마감` : `${["", "due", "deadline"][i]} ${day}` };
    }
    return { kind: head, when: "" };
  }
  if (candidate.kind === "event" && !candidate.repeat) {
    const day = chipDay(candidate.day, today, lang);
    const when = candidate.allDay ? ["종일", "all day", "hele dag"][i]
      : timeRange({ hour: Math.floor(candidate.start / 60), minute: candidate.start % 60 }, { hour: Math.floor(candidate.end / 60) % 24, minute: candidate.end % 60 }, lang);
    return { kind: kindName("event", lang), when: `${day} ${when}` };
  }
  const [head, ...rest] = chipText(candidate, now, lang).split(" · ");
  return { kind: head, when: rest.join(" · ") };
}

export function widgetChip(candidate: Candidate, now: Date, lang: Lang = "ko"): string {
  const parts = chipParts(candidate, now, lang);
  return parts.when ? `${parts.kind} · ${parts.when}` : parts.kind;
}

/**
 * The toast once made (Q8): "{날} {할 일|일정}에 넣었어요" — 오늘 · 내일, a weekday within the week ahead, else "11월 21일";
 * en "Added a to-do for Thursday", nl "Taak toegevoegd voor donderdag". 되돌리기 follows.
 */
export function widgetAddedText(day: string, event: boolean, now: Date, lang: Lang = "ko"): string {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = midnightOf(day);
  const offset = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  let when: string;
  if (offset === 0 || offset === 1) when = lang === "ko" ? dayWord(offset, lang)! : dayWord(offset, lang)!.toLowerCase();
  else if (offset >= 2 && offset <= 6) when = weekdayName(target.getDay(), lang);
  else when = dayMonth(target.getMonth() + 1, target.getDate(), undefined, lang);
  if (lang === "ko") return `${when} ${event ? "일정" : "할 일"}에 넣었어요`;
  if (lang === "en") return `Added ${event ? "an event" : "a to-do"} for ${when}`;
  return `${event ? "Afspraak" : "Taak"} toegevoegd voor ${when}`;
}

// ─── Places (#234 P1–P6) ──────────────────────────────────────────────────────

export interface Box { x: number; y: number; width: number; height: number }
/** A display: its id and the area a window may use (without the taskbar). */
export interface WidgetScreen { id: string; area: Box }

const right = (box: Box) => box.x + box.width;
const bottom = (box: Box) => box.y + box.height;
const overlaps = (a: Box, b: Box) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a);
const overlap = (a: Box, b: Box) => Math.max(0, Math.min(right(a), right(b)) - Math.max(a.x, b.x)) * Math.max(0, Math.min(bottom(a), bottom(b)) - Math.max(a.y, b.y));

/** A frame pushed back inside the area, the whole widget and its ears (P4); one bigger than the area keeps its top left. */
export function inside(frame: Box, area: Box): Box {
  return {
    ...frame,
    x: Math.min(Math.max(frame.x, area.x), Math.max(area.x, right(area) - frame.width)),
    y: Math.min(Math.max(frame.y, area.y), Math.max(area.y, bottom(area) - frame.height)),
  };
}

/** The window's frame for a place (P1): on its display, else on the main one (the first) at the same shares (P2, P3). */
export function frameFor(place: WidgetPlace, width: number, height: number, screens: readonly WidgetScreen[]): Box {
  const screen = screens.find((entry) => entry.id === place.display) ?? screens[0];
  if (!screen) return { x: 0, y: 0, width, height };
  const area = screen.area;
  return inside({ x: area.x + share(place.x) * Math.max(0, area.width - width), y: area.y + share(place.y) * Math.max(0, area.height - height), width, height }, area);
}

/** The place of a frame (where a drag left it): the display it is mostly on, and its shares there. */
export function placeOf(frame: Box, screens: readonly WidgetScreen[]): WidgetPlace | undefined {
  let best = screens[0];
  for (const screen of screens) if (overlap(frame, screen.area) > overlap(frame, best.area)) best = screen;
  if (!best) return undefined;
  const area = best.area;
  const ratio = (offset: number, room: number) => (room <= 0 ? 0 : Math.round(Math.min(1, Math.max(0, offset / room)) * 10_000) / 10_000);
  return { display: best.id, x: ratio(frame.x - area.x, area.width - frame.width), y: ratio(frame.y - area.y, area.height - frame.height) };
}

/** Where a dropped frame snaps (P5): an edge within 8 of the area's edge or another widget's edge goes onto it; then inside. */
export const snapDistance = 8;
export function snap(frame: Box, area: Box, others: readonly Box[]): Box {
  const nearest = (value: number, targets: number[]) => {
    let best: number | undefined;
    for (const target of targets) if (best === undefined || Math.abs(target - value) < Math.abs(best - value)) best = target;
    return best !== undefined && Math.abs(best - value) <= snapDistance ? best : value;
  };
  const xs = [area.x, right(area) - frame.width];
  const ys = [area.y, bottom(area) - frame.height];
  for (const other of others) {
    if (frame.y < bottom(other) + snapDistance && other.y < bottom(frame) + snapDistance) {
      xs.push(right(other), other.x - frame.width);
      ys.push(other.y, bottom(other) - frame.height);
    }
    if (frame.x < right(other) + snapDistance && other.x < right(frame) + snapDistance) {
      ys.push(bottom(other), other.y - frame.height);
      xs.push(other.x, right(other) - frame.width);
    }
  }
  return inside({ ...frame, x: nearest(frame.x, xs), y: nearest(frame.y, ys) }, area);
}

/** A new widget's place (P6): the main display's top right, 16 in; below the widgets there (12 apart), then a column further left. */
export function newPlace(width: number, height: number, screen: WidgetScreen, others: readonly Box[]): WidgetPlace {
  const area = screen.area, margin = 16, gap = 12;
  for (let x = right(area) - margin - width; x >= area.x; x -= width + gap) {
    let y = area.y + margin;
    while (y + height <= bottom(area)) {
      const room: Box = { x: x - gap / 2, y: y - gap / 2, width: width + gap, height: height + gap };
      const blocking = others.filter((other) => overlaps(other, room)).sort((a, b) => bottom(b) - bottom(a))[0];
      if (!blocking) return placeOf({ x, y, width, height }, [screen])!;
      y = bottom(blocking) + gap;
    }
  }
  return placeOf({ x: right(area) - margin - width, y: area.y + margin, width, height }, [screen])!;
}

// ─── Drawing again (#234 T1–T4) ───────────────────────────────────────────────

/** When a widget must draw again with no change of data: the next midnight; 오늘 · 이번 주 · 오늘 목록 also when what is to come changes. */
export function nextRedraw(kind: WidgetKind, now: Date, lines: readonly WidgetLine[]): Date {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  if (kind === "month") return midnight;
  const moments = lines.flatMap((line) => [line.at, line.end]).filter((at): at is Date => at !== undefined && at > now && at < midnight);
  return moments.length ? new Date(Math.min(...moments.map((at) => at.getTime()))) : midnight;
}

/** After ‹ › nobody touched it for 2 minutes: back to this week · this month (T3). */
export const backAfterMs = 120_000;
export const pageOffset = (offset: number, touched: Date, now: Date): number => (now.getTime() - touched.getTime() >= backAfterMs ? 0 : offset);

/** The day a widget's page is for: today's calendar day at `now` (worked out again on waking, T4). */
export const widgetToday = (now: Date): string => dateKey(now);

// ─── Words ────────────────────────────────────────────────────────────────────

const kindNames: Record<WidgetKind, readonly string[]> = {
  today: ["오늘", "Today", "Vandaag"], week: ["이번 주", "This week", "Deze week"],
  month: ["이번 달", "This month", "Deze maand"], agenda: ["오늘 목록", "Today list", "Lijst van vandaag"],
};
export const styleName = (style: WidgetStyle, lang: Lang = "ko"): string =>
  ({ simple: ["간단히", "Simple", "Eenvoudig"], detail: ["자세히", "Detailed", "Uitgebreid"], wall: ["벽 달력", "Wall calendar", "Wandkalender"] })[style][langIndex(lang)];
/** "오늘", "이번 주 · 간단히", "이번 달 · 자세히", "오늘 목록". */
export function widgetName(kind: WidgetKind, style: WidgetStyle, lang: Lang = "ko"): string {
  const name = kindNames[kind][langIndex(lang)];
  return hasStyles(kind) ? `${name} · ${styleName(style, lang)}` : name;
}
