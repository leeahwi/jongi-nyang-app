import { dateKey, localDate } from "../../src/core/calendar";
import { clock as clockText, shortDate, type Lang } from "../../src/core/lang";
import { pageOf } from "../../src/core/shelf";
import { rangeDay, rangeDayText, rangeOf, rangeText } from "../../src/core/timeRange";
import { dayKey } from "../../src/core/archive";
import type { TodoItem } from "../../src/core/notebook";

/**
 * What the tools say back, in the app's language (ko · en · nl). Short and plain; ids go along so Claude can
 * name an item in preview_changes. Dates and times through the core's helpers, so they read as in the app.
 */

export const say = (lang: Lang, ko: string, en: string, nl: string): string => (lang === "ko" ? ko : lang === "en" ? en : nl);

const pad = (value: number) => String(value).padStart(2, "0");
/** "2026-10-27T14:50" in local time (how reminders go out to Claude). */
export const localStamp = (date: Date): string => `${dateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** The task's place: today's sheet, a day ahead (앞으로), or 언젠가. */
export type Where = "today" | "ahead" | "someday";
export const whereOf = (item: TodoItem, now: Date): Where => ({ today: "today", deadline: "ahead", later: "someday" } as const)[pageOf(item, now)];

/** "오늘 15:00–16:00" · "tomorrow 3:00–4:00 PM" · "언젠가" — the task's day and time as the note shows them. */
export function taskWhen(item: TodoItem, now: Date, lang: Lang): string {
  const day = rangeDay(item, now);
  if (!day) return say(lang, "언젠가", "someday", "ooit");
  const range = rangeOf(item);
  const text = rangeDayText(day, now, lang);
  return range ? `${text} ${rangeText(range, lang)}` : text;
}

/** "알림 14:50" · "reminder 10/30 9:00 AM": the day only when it isn't the task's. */
export function reminderText(at: Date, day: string | undefined, lang: Lang): string {
  const time = clockText(at.getHours(), at.getMinutes(), lang);
  const when = day && dayKey(at) === day ? time : `${shortDate(at, lang)} ${time}`;
  return `${say(lang, "알림", "reminder", "herinnering")} ${when}`;
}

/** One task as a line: "- [ ] 보고서 쓰기 · 오늘 15:00–16:00 · 알림 14:50 · id …". */
export function taskLine(item: TodoItem, now: Date, lang: Lang): string {
  const parts = [`- [${item.isCompleted ? "x" : " "}] ${item.title}`, taskWhen(item, now, lang)];
  if (item.reminderAt && !item.isCompleted) parts.push(reminderText(new Date(item.reminderAt), rangeDay(item, now), lang));
  parts.push(`id ${item.id}`);
  return parts.join(" · ");
}

/** A task as the structured result gives it. */
export function taskData(item: TodoItem, now: Date): Record<string, unknown> {
  const day = rangeDay(item, now);
  return {
    id: item.id, title: item.title, done: item.isCompleted, where: whereOf(item, now),
    ...(day ? { date: day } : {}), ...(item.dueDate ? { dueDate: item.dueDate } : {}),
    ...(item.timeStart ? { timeStart: item.timeStart } : {}), ...(item.timeEnd ? { timeEnd: item.timeEnd } : {}),
    ...(item.reminderAt ? { remindAt: localStamp(new Date(item.reminderAt)) } : {}),
    ...(item.completedAt ? { completedAt: localStamp(new Date(item.completedAt)) } : {}),
  };
}

/** "10월 27일 (화)" · "Tue, Oct 27" · "di 27 okt" for a "yyyy-MM-dd" (with the year when it isn't this year's). */
export const dayText = (day: string, lang: Lang): string => {
  const date = localDate(day);
  return date ? shortDate(date, lang, date.getFullYear() !== new Date().getFullYear()) : day;
};

/** Messages shared by several tools. */
export const words = {
  unreadable: (file: string, lang: Lang) =>
    say(lang, `${file}을 읽지 못해서 손대지 않았어요. 종이냥 앱에서 먼저 열어 주세요.`, `${file} couldn’t be read, so nothing was changed. Open 종이냥 first.`, `${file} kon niet worden gelezen, dus er is niets gewijzigd. Open eerst 종이냥.`),
  busy: (file: string, lang: Lang) =>
    say(lang, `${file}이 계속 바뀌고 있어서 쓰지 못했어요. 잠시 뒤에 다시 해 주세요.`, `${file} kept changing, so it wasn’t written. Try again in a moment.`, `${file} bleef veranderen, dus er is niets geschreven. Probeer het zo nog eens.`),
  badDate: (value: string, lang: Lang) => say(lang, `날짜를 읽지 못했어요: ‘${value}’ (yyyy-MM-dd).`, `Couldn’t read the date ‘${value}’ (yyyy-MM-dd).`, `De datum ‘${value}’ is onleesbaar (yyyy-MM-dd).`),
  badTime: (value: string, lang: Lang) => say(lang, `시간을 읽지 못했어요: ‘${value}’ (HH:mm).`, `Couldn’t read the time ‘${value}’ (HH:mm).`, `De tijd ‘${value}’ is onleesbaar (HH:mm).`),
  tooLong: (days: number, lang: Lang) => say(lang, `기간은 ${days}일까지예요.`, `The period can be at most ${days} days.`, `De periode mag hoogstens ${days} dagen zijn.`),
  backwards: (lang: Lang) => say(lang, "끝 날짜가 시작 날짜보다 앞이에요.", "The end date is before the start date.", "De einddatum ligt vóór de begindatum."),
};
