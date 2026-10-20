import { logicalDayStart } from "./archive";
import { allDayText, dateKey, localDate } from "./calendar";
import { expand, type LocalEvent } from "./events";
import { clock, dayMonth, dayWord, langIndex, monthName, monthTitle, plural, shortDate, weekdayShort, weekStartsMonday, weekTitle, type Lang } from "./lang";
import type { TodoItem } from "./notebook";
import { pageOf } from "./shelf";

/**
 * 앞으로: what is ahead, on one page — the tasks not on today's sheet (deadlines still to come and
 * the 나중에 shelf) beside the events of the coming days. This week's days from tomorrow, next
 * week's, then later deadlines by month, then 언젠가 (the undated shelf). A day is the logical
 * (4 a.m.) day; a week starts on Sunday in Korean and English, on Monday in Dutch. Same rules and
 * shared cases as the macOS app (Ahead.swift, ahead-cases.md).
 */

export type AheadSectionKind = "thisWeek" | "nextWeek" | "laterOn" | "someday";

/** One event line of a day: its colour, "종일" or the start, and the title. */
export interface AheadEvent { key: string; eventId: string; title: string; color: string; allDay: boolean; time: string }

/** A day with something on it. */
export interface AheadDay {
  /** "yyyy-MM-dd" */
  day: string;
  /** "금", "Fri", "vr" */
  weekday: string;
  /** The day of the month. */
  date: number;
  /** "내일" / "Tomorrow" / "Morgen" for tomorrow. */
  relative?: string;
  /** All-day events first (by title), then by start (then title). */
  events: AheadEvent[];
  /** Open tasks due that day, in the list's order. */
  tasks: TodoItem[];
}

/** 그 뒤: one month of later deadlines, each with its short date ("11월 3일 (화)", with the year when it isn't this year). */
export interface AheadMonth { month: string; title: string; tasks: { item: TodoItem; date: string }[] }

export interface AheadSection {
  kind: AheadSectionKind;
  /** "이번 주", "다음 주", "그 뒤", "언젠가" */
  title: string;
  /** Open tasks in the section (events are not counted). */
  count: number;
  /** 이번 주 · 다음 주 */
  days?: AheadDay[];
  /** 그 뒤 */
  months?: AheadMonth[];
  /** 언젠가 */
  tasks?: TodoItem[];
}

const sectionTitles: Record<AheadSectionKind, readonly [string, string, string]> = {
  thisWeek: ["이번 주", "This week", "Deze week"],
  nextWeek: ["다음 주", "Next week", "Volgende week"],
  laterOn: ["그 뒤", "Later on", "Daarna"],
  someday: ["언젠가", "Someday", "Ooit"],
};
/** A section's name: "이번 주" · "This week" · "Deze week", … "언젠가" · "Someday" · "Ooit". */
export const aheadSectionTitle = (kind: AheadSectionKind, lang: Lang = "ko"): string => sectionTitles[kind][langIndex(lang)];

const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

/** This week (the one holding the logical today): its first and last day, local midnights. */
export function aheadWeek(now: Date, lang: Lang = "ko"): { first: Date; last: Date } {
  const start = logicalDayStart(now);
  const today = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const offset = (today.getDay() - (weekStartsMonday(lang) ? 1 : 0) + 7) % 7;
  const first = addDays(today, -offset);
  return { first, last: addDays(first, 6) };
}

/** The page's eyebrow: "이번 주 · 10월 4일 – 10일", "This week · Oct 4 – 10", "Deze week · 5 – 11 okt". */
export function aheadEyebrow(now: Date, lang: Lang = "ko"): string {
  const { first, last } = aheadWeek(now, lang);
  return `${aheadSectionTitle("thisWeek", lang)} · ${weekTitle(first, last, lang)}`;
}

/** The logical day an event belongs to: an all-day one its date, a timed one the 4 a.m. day it starts in. */
const startDay = (start: Date) => dateKey(logicalDayStart(start));

/**
 * The sections, empty ones left out. `items` are every task (open ones not on today's sheet are
 * used); `events` every kept event (their occurrences from tomorrow to the end of next week are used).
 */
export function aheadSections(items: readonly TodoItem[], events: readonly LocalEvent[], now: Date, lang: Lang = "ko"): AheadSection[] {
  const start = logicalDayStart(now);
  const today = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const tomorrow = dateKey(addDays(today, 1));
  const { last } = aheadWeek(now, lang);
  const weekEnd = dateKey(last);
  const nextWeekEnd = dateKey(addDays(last, 7));
  const open = items.filter((item) => !item.isCompleted && pageOf(item, now) !== "today");

  // The days of this week and next week: events, then the tasks due that day.
  const days = new Map<string, AheadDay>();
  const dayOf = (key: string): AheadDay => {
    let entry = days.get(key);
    if (!entry) {
      const date = localDate(key)!;
      entry = { day: key, weekday: weekdayShort(date.getDay(), lang), date: date.getDate(), ...(key === tomorrow ? { relative: dayWord(1, lang)! } : {}), events: [], tasks: [] };
      days.set(key, entry);
    }
    return entry;
  };
  const occurrences = expand(events, addDays(today, 1), addDays(last, 9), lang);
  const timedOrder: { day: string; start: number; event: AheadEvent }[] = [];
  for (const occurrence of occurrences) {
    const line = (allDay: boolean): AheadEvent => ({
      key: occurrence.key, eventId: occurrence.eventId, title: occurrence.title, color: occurrence.color, allDay,
      time: allDay ? allDayText(lang) : clock(occurrence.start.getHours(), occurrence.start.getMinutes(), lang),
    });
    if (occurrence.allDay) {
      for (let day = occurrence.start; day < occurrence.end; day = addDays(day, 1)) {
        const key = dateKey(day);
        if (key >= tomorrow && key <= nextWeekEnd) dayOf(key).events.push(line(true));
      }
    } else {
      const key = startDay(occurrence.start);
      if (key >= tomorrow && key <= nextWeekEnd) timedOrder.push({ day: key, start: occurrence.start.getTime(), event: line(false) });
    }
  }
  const byTitle = (a: AheadEvent, b: AheadEvent) => (a.title < b.title ? -1 : a.title > b.title ? 1 : 0);
  for (const entry of days.values()) entry.events.sort(byTitle);
  timedOrder.sort((a, b) => a.start - b.start || byTitle(a.event, b.event));
  for (const { day, event } of timedOrder) dayOf(day).events.push(event);

  const later: TodoItem[] = [];
  const someday: TodoItem[] = [];
  for (const item of open) {
    if (!item.dueDate) { someday.push(item); continue; }
    if (item.dueDate <= nextWeekEnd) dayOf(item.dueDate).tasks.push(item);
    else later.push(item);
  }

  const sections: AheadSection[] = [];
  const ordered = [...days.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  const week = (kind: "thisWeek" | "nextWeek", from: string, to: string) => {
    const list = ordered.filter((entry) => entry.day >= from && entry.day <= to);
    if (list.length) sections.push({ kind, title: aheadSectionTitle(kind, lang), count: list.reduce((sum, entry) => sum + entry.tasks.length, 0), days: list });
  };
  week("thisWeek", tomorrow, weekEnd);
  week("nextWeek", dateKey(addDays(last, 1)), nextWeekEnd);

  if (later.length) {
    const sorted = later.map((item, index) => ({ item, index })).sort((a, b) => (a.item.dueDate! < b.item.dueDate! ? -1 : a.item.dueDate! > b.item.dueDate! ? 1 : a.index - b.index));
    const months: AheadMonth[] = [];
    for (const { item } of sorted) {
      const date = localDate(item.dueDate!) ?? today;
      const month = item.dueDate!.slice(0, 7);
      let entry = months[months.length - 1];
      if (!entry || entry.month !== month) {
        const title = date.getFullYear() === today.getFullYear() ? monthName(date.getMonth() + 1, lang) : monthTitle(date.getFullYear(), date.getMonth() + 1, lang);
        entry = { month, title, tasks: [] };
        months.push(entry);
      }
      entry.tasks.push({ item, date: shortDate(date, lang, date.getFullYear() !== today.getFullYear()) });
    }
    sections.push({ kind: "laterOn", title: aheadSectionTitle("laterOn", lang), count: later.length, months });
  }
  if (someday.length) sections.push({ kind: "someday", title: aheadSectionTitle("someday", lang), count: someday.length, tasks: someday });
  return sections;
}

/** Open tasks on the page (the tab's count). */
export const aheadCount = (sections: readonly AheadSection[]): number => sections.reduce((sum, section) => sum + section.count, 0);

/** Events listed on the page (an event over several days once). */
export function aheadEventCount(sections: readonly AheadSection[]): number {
  const keys = new Set<string>();
  for (const section of sections) for (const day of section.days ?? []) for (const event of day.events) keys.add(event.key);
  return keys.size;
}

/** Under the title: "할 일 6 · 일정 3", "6 to-dos · 3 events", "6 taken · 3 afspraken" (a part that is 0 left out). */
export function aheadSummary(sections: readonly AheadSection[], lang: Lang = "ko"): string {
  const tasks = aheadCount(sections);
  const events = aheadEventCount(sections);
  const parts: string[] = [];
  if (tasks) parts.push(lang === "ko" ? `할 일 ${tasks}` : lang === "en" ? plural(tasks, "to-do", "to-dos") : plural(tasks, "taak", "taken"));
  if (events) parts.push(lang === "ko" ? `일정 ${events}` : lang === "en" ? plural(events, "event", "events") : plural(events, "afspraak", "afspraken"));
  return parts.join(" · ");
}

/** Where a task is dropped on the page: a day (its new due date), 언젠가, or the 오늘 tab. */
export type AheadTarget = { kind: "day"; day: string } | { kind: "someday" } | { kind: "today" };

/** The toast after a move: "10월 9일로 옮겼어요", "Moved to Oct 9", "Verplaatst naar 9 okt"; "언젠가로 …", "오늘로 …". */
export function movedText(target: AheadTarget, now: Date, lang: Lang = "ko"): string {
  let place: string;
  if (target.kind === "day") {
    const date = localDate(target.day);
    const year = date && date.getFullYear() !== logicalDayStart(now).getFullYear() ? date.getFullYear() : undefined;
    place = date ? dayMonth(date.getMonth() + 1, date.getDate(), year, lang) : target.day;
  } else place = target.kind === "someday" ? aheadSectionTitle("someday", lang) : dayWord(0, lang)!;
  // Every place ends in a vowel or ㄹ (…일, 언젠가, 오늘): 로.
  return lang === "ko" ? `${place}로 옮겼어요` : lang === "en" ? `Moved to ${place}` : `Verplaatst naar ${place}`;
}
