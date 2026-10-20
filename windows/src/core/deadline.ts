import { dayKey, logicalDayStart } from "./archive";
import { dayMonth, dayWord, days as dayCount, shortDate, weekdayShort, weekStartsMonday, type Lang } from "./lang";

/** How a deadline reads on a row: "D-3" or "~금". */
export type DueStyle = "dday" | "date";
export type DeadlineChoice = { kind: "today" } | { kind: "thisWeek" } | { kind: "thisMonth" } | { kind: "date"; date: Date };
export type DeadlineUrgency = "overdue" | "today" | "soon" | "later";

/** The row style's name: "D-day" / "날짜", en "Countdown" / "Date", nl "Aftellen" / "Datum". */
export const dueStyleTitles: Record<Lang, Record<DueStyle, string>> = {
  ko: { dday: "D-day", date: "날짜" },
  en: { dday: "Countdown", date: "Date" },
  nl: { dday: "Aftellen", date: "Datum" },
};

/** The deadline picker: "오늘까지", "이번 주 안", "이번 달 안", "날짜 지정" and the same in English and Dutch. */
export const deadlineChoiceTitles: Record<Lang, Record<DeadlineChoice["kind"], string>> = {
  ko: { today: "오늘까지", thisWeek: "이번 주 안", thisMonth: "이번 달 안", date: "날짜 지정" },
  en: { today: "Today", thisWeek: "This week", thisMonth: "This month", date: "Pick a date" },
  nl: { today: "Vandaag", thisWeek: "Deze week", thisMonth: "Deze maand", date: "Datum kiezen" },
};

const pad = (value: number) => String(value).padStart(2, "0");

export function key(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function fromKey(value: string): Date | undefined {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return undefined;
  return new Date(year, month - 1, day, 12);
}

/** The last day for a choice (same rules as macOS): a week ends Sunday, a month on its last day; 4 a.m. boundary. */
/**
 * The day a choice means. 이번 주 안 ends on the last day of 앞으로's week — Saturday in Korean and
 * English (weeks from Sunday), Sunday in Dutch (weeks from Monday) — so the task stays under 이번 주.
 */
export function dayFor(choice: DeadlineChoice, now: Date, lang: Lang = "ko"): string {
  const today = logicalDayStart(now);
  switch (choice.kind) {
    case "today": return key(today);
    case "thisWeek": {
      const last = weekStartsMonday(lang) ? 0 : 6;
      const end = new Date(today);
      end.setDate(end.getDate() + ((last - today.getDay() + 7) % 7));
      return key(end);
    }
    case "thisMonth": return key(new Date(today.getFullYear(), today.getMonth() + 1, 0));
    case "date": return key(choice.date);
  }
}

export function daysLeft(due: string, now: Date): number | undefined {
  const target = fromKey(due);
  const today = fromKey(dayKey(now));
  if (!target || !today) return undefined;
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function urgency(due: string, now: Date): DeadlineUrgency {
  const days = daysLeft(due, now);
  if (days === undefined) return "later";
  return days < 0 ? "overdue" : days === 0 ? "today" : days <= 2 ? "soon" : "later";
}

/**
 * "D-3", "D-day", "D+2" — or "~오늘", "~내일", "~금", "~10/31", "~2027/1/2".
 * en "3 days left", "due today", "2 days late" — or "by today", "by tomorrow", "by Fri", "by Oct 31", "by Jan 2, 2027";
 * nl "nog 3 dagen", "vandaag", "2 dagen te laat" — or "tot vandaag", "tot morgen", "tot vr", "tot 31 okt", "tot 2 jan 2027".
 */
export function label(due: string, style: DueStyle, now: Date, lang: Lang = "ko"): string {
  const days = daysLeft(due, now);
  const date = fromKey(due);
  if (days === undefined || !date) return "";
  if (style === "dday") {
    if (lang === "ko") return days === 0 ? "D-day" : days > 0 ? `D-${days}` : `D+${-days}`;
    if (lang === "en") return days === 0 ? "due today" : days > 0 ? `${dayCount(days, lang)} left` : `${dayCount(-days, lang)} late`;
    return days === 0 ? "vandaag" : days > 0 ? `nog ${dayCount(days, lang)}` : `${dayCount(-days, lang)} te laat`;
  }
  const sameYear = date.getFullYear() === now.getFullYear();
  if (lang === "ko") {
    if (days === 0) return "~오늘";
    if (days === 1) return "~내일";
    if (days > 1 && days < 7) return `~${weekdayShort(date.getDay(), lang)}`;
    const short = `${date.getMonth() + 1}/${date.getDate()}`;
    return sameYear ? `~${short}` : `~${date.getFullYear()}/${short}`;
  }
  const by = lang === "en" ? "by " : "tot ";
  if (days === 0 || days === 1) return by + dayWord(days, lang)!.toLowerCase();
  if (days > 1 && days < 7) return by + weekdayShort(date.getDay(), lang);
  return by + dayMonth(date.getMonth() + 1, date.getDate(), sameYear ? undefined : date.getFullYear(), lang);
}

/**
 * "10월 4일 (일)까지 · 5일 남음" — en "Due Sun, Oct 4 · 5 days left" ("today", "2 days late");
 * nl "Deadline zo 4 okt · nog 5 dagen" ("vandaag", "2 dagen te laat").
 */
export function sentence(due: string, now: Date, lang: Lang = "ko"): string {
  const days = daysLeft(due, now);
  const date = fromKey(due);
  if (days === undefined || !date) return "";
  const day = shortDate(date, lang);
  if (lang === "ko") return `${day}까지 · ${days === 0 ? "오늘 마감" : days > 0 ? `${days}일 남음` : `${-days}일 지남`}`;
  if (lang === "en") return `Due ${day} · ${days === 0 ? "today" : days > 0 ? `${dayCount(days, lang)} left` : `${dayCount(-days, lang)} late`}`;
  return `Deadline ${day} · ${days === 0 ? "vandaag" : days > 0 ? `nog ${dayCount(days, lang)}` : `${dayCount(-days, lang)} te laat`}`;
}
