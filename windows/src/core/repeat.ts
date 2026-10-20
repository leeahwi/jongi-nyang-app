import { dayBoundaryHour, dayKey, logicalDayStart } from "./archive";
import { spokenTime, weekdayShort as weekdayIn, type Lang } from "./lang";
import { isoDate, newID, type TodoItem } from "./notebook";

export type RepeatKind = "daily" | "weekdays" | "weekly" | "monthly";

export interface RepeatRule {
  kind: RepeatKind;
  /** weekly: 0 (Sunday) … 6 (Saturday) */
  weekdays?: number[];
  /** monthly: 1…31; short months use their last day */
  monthDay?: number;
}

/** A recurring task. Each day it applies, one copy appears on the list. Kept in repeats.json. */
export interface Series {
  id: string;
  title: string;
  rule: RepeatRule;
  /** "HH:mm" — the copy's alert time, or none */
  remindAt?: string;
  createdAt: string;
  /** dayKey of the last day a copy was placed on the list */
  lastPlaced?: string;
}

export const weekdayShort = ["일", "월", "화", "수", "목", "금", "토"];
export const repeatKindTitles: Record<Lang, Record<RepeatKind, string>> = {
  ko: { daily: "매일", weekdays: "평일", weekly: "매주", monthly: "매월" },
  en: { daily: "Every day", weekdays: "Weekdays", weekly: "Every week", monthly: "Every month" },
  nl: { daily: "Elke dag", weekdays: "Werkdagen", weekly: "Elke week", monthly: "Elke maand" },
};
export const repeatKindTitle: Record<RepeatKind, string> = repeatKindTitles.ko;

/** Whether the rule applies on the day that starts at `dayStart` (a logical, 4 a.m. day). */
export function occursOn(rule: RepeatRule, dayStart: Date): boolean {
  const weekday = dayStart.getDay();
  switch (rule.kind) {
    case "daily": return true;
    case "weekdays": return weekday >= 1 && weekday <= 5;
    case "weekly": return (rule.weekdays ?? []).includes(weekday);
    case "monthly": {
      const lastDay = new Date(dayStart.getFullYear(), dayStart.getMonth() + 1, 0).getDate();
      return dayStart.getDate() === Math.min(rule.monthDay ?? 1, lastDay);
    }
  }
}

/** A weekly rule with no days, or a monthly rule without a date, never occurs. */
export function isValidRule(rule: RepeatRule): boolean {
  if (rule.kind === "weekly") return (rule.weekdays ?? []).length > 0;
  if (rule.kind === "monthly") return Number.isInteger(rule.monthDay) && rule.monthDay! >= 1 && rule.monthDay! <= 31;
  return true;
}

/** The alert moment for the logical day: times before 4 a.m. belong to that night, i.e. the next calendar date. */
export function alertOn(dayStart: Date, remindAt: string): Date {
  const [hour, minute] = remindAt.split(":").map(Number);
  const date = new Date(dayStart.getFullYear(), dayStart.getMonth(), dayStart.getDate(), hour, minute);
  if (hour < dayBoundaryHour) date.setDate(date.getDate() + 1);
  return date;
}

/** First day on or after `from` (a moment) that the rule applies, within two years. */
export function nextOccurrence(rule: RepeatRule, from: Date): Date | undefined {
  if (!isValidRule(rule)) return undefined;
  const day = logicalDayStart(from);
  for (let index = 0; index < 750; index += 1) {
    if (occursOn(rule, day)) return new Date(day);
    day.setDate(day.getDate() + 1);
  }
  return undefined;
}

/** "1st", "2nd", "3rd", "4th", "11th", "21st". */
export function ordinal(number: number): string {
  const tens = number % 100;
  if (tens >= 11 && tens <= 13) return `${number}th`;
  return `${number}${["th", "st", "nd", "rd"][number % 10] ?? "th"}`;
}

/**
 * "매일", "평일", "매주 월·수", "매월 15일" — plus " · 오전 9:00 알림" when an alert is set.
 * en "Every Mon, Wed", "Every month on the 15th", " · reminder at 9:00 AM";
 * nl "Elke ma, wo", "Elke maand op de 15e", " · herinnering om 09:00".
 */
export function describe(rule: RepeatRule, remindAt?: string, lang: Lang = "ko"): string {
  let text: string = repeatKindTitles[lang][rule.kind];
  if (rule.kind === "weekly") {
    const days = [...(rule.weekdays ?? [])].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)); // Monday first
    const names = days.map((day) => weekdayIn(day, lang));
    if (days.length === 7) text = repeatKindTitles[lang].daily;
    else text = lang === "ko" ? `매주 ${names.join("·")}` : `${lang === "en" ? "Every" : "Elke"} ${names.join(", ")}`;
  }
  if (rule.kind === "monthly") {
    const day = rule.monthDay ?? 1;
    text = lang === "ko" ? `매월 ${day}일` : lang === "en" ? `Every month on the ${ordinal(day)}` : `Elke maand op de ${day}e`;
  }
  if (!remindAt) return text;
  const [hour, minute] = remindAt.split(":").map(Number);
  const time = spokenTime(hour, minute, lang);
  return lang === "ko" ? `${text} · ${time} 알림` : lang === "en" ? `${text} · reminder at ${time}` : `${text} · herinnering om ${time}`;
}

export interface RepeatPlan {
  /** New copies to put on the list. */
  create: TodoItem[];
  /** Unfinished copies from an earlier day, moved to today instead of piling up. */
  roll: { id: string; reminderAt?: string }[];
  /** Series that now have today's copy. */
  placed: string[];
}

/**
 * What the list needs today. One unfinished copy per series at most: if yesterday's is still
 * open it is carried to today (with today's alert), otherwise a fresh copy is created.
 */
export function planToday(series: readonly Series[], items: readonly TodoItem[], now: Date): RepeatPlan {
  const today = logicalDayStart(now);
  const key = dayKey(now);
  const plan: RepeatPlan = { create: [], roll: [], placed: [] };
  for (const entry of series) {
    if (entry.lastPlaced === key || !isValidRule(entry.rule) || !occursOn(entry.rule, today)) continue;
    const reminderAt = entry.remindAt ? isoDate(alertOn(today, entry.remindAt)) : undefined;
    const open = items.find((item) => item.seriesID === entry.id && !item.isCompleted);
    if (open) plan.roll.push({ id: open.id, reminderAt });
    else plan.create.push({ id: newID(), title: entry.title, isCompleted: false, createdAt: isoDate(now), seriesID: entry.id, ...(reminderAt ? { reminderAt } : {}) });
    plan.placed.push(entry.id);
  }
  return plan;
}

/** repeats.json (the same shape as macOS); entries that aren't a valid series are left out. */
export function parseSeries(text: string): Series[] {
  const saved = JSON.parse(text) as { series?: Series[] };
  return (saved.series ?? []).filter((entry) => typeof entry.id === "string" && typeof entry.title === "string" && entry.rule && isValidRule(entry.rule));
}

export function serializeSeries(series: readonly Series[]): string {
  return JSON.stringify({ series }, null, 2);
}
