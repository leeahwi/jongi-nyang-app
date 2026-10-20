import { logicalDayStart } from "./archive";
import { key } from "./deadline";
import { dayWord, shortDate, spokenTime, type Lang } from "./lang";
import { logicalMinutes } from "./timeRange";

/**
 * Dates and times written in plain Korean inside a task ("내일 3시 회의", "금요일까지 보고서"),
 * the same rules as the macOS QuickParse. The words that were understood leave the title. In
 * English and Dutch the language's own words are understood first ("tomorrow 3pm", "morgen om 3
 * uur", see the end of this file), and Korean always.
 */
export interface QuickParse {
  title: string;
  /** A time was given: the alert, on the given day (or today, or tomorrow once today's has passed). */
  reminderAt?: Date;
  /** A day without a time, "yyyy-MM-dd" (never today, unless it came with 까지). */
  dueDate?: string;
  /** "내일 오후 3:00 알림" · "10월 2일 (금)까지" — the preview line under the input. */
  summary?: string;
  /** 시간 정하기: a time range was written ("3시부터 5시까지", "2-4pm", "van 2 tot 4 uur"): its day and minutes. */
  range?: { day: string; start: number; end: number };
}

const weekdayNames = "일월화수목금토";

/** Nothing letter- or digit-like right before or after, so "1시간" or "3권" never read as times. */
const before = String.raw`(?<![\p{L}\p{N}/:])`;
const after = String.raw`(?![\p{L}\p{N}/:])`;
const space = String.raw`[ \t]*`;

const datePattern = new RegExp(before + "(?:" + [
  String.raw`(?:(?<week>이번|다음)${space}주${space})?(?<weekday>[월화수목금토일])(?:요일|욜)`,
  String.raw`(?<until>(?:이번|다음)${space}주|이번${space}달)(?=까지)`,
  String.raw`(?<relative>오늘|내일|모레|글피)`,
  String.raw`(?<month>\d{1,2})월${space}(?<day>\d{1,2})일`,
  String.raw`(?<slashMonth>\d{1,2})/(?<slashDay>\d{1,2})`,
].join("|") + ")" + String.raw`(?<by>까지)?` + after, "gu");

const periods = "오전|아침|새벽|오후|점심|저녁|밤";
const timePattern = new RegExp(before + "(?:" + [
  String.raw`(?:(?<period>${periods})${space})?(?<hour>\d{1,2})시(?:${space}(?<minute>[0-5]?\d)분|${space}(?<half>반))?`,
  String.raw`(?:(?<clockPeriod>${periods})${space})?(?<clockHour>[01]?\d|2[0-3]):(?<clockMinute>[0-5]\d)`,
].join("|") + ")" + after, "gu");

/** "30분 뒤", "2시간 후", "1시간 30분 뒤", "1시간 반 뒤에" — a reminder that long from now (every language). */
const relativePattern = new RegExp(before + String.raw`(?:(?<hours>\d{1,3})${space}시간(?:${space}(?<minutes>\d{1,3})${space}분|${space}(?<half>반))?|(?<only>\d{1,3})${space}분)${space}(?:뒤|후)(?:에)?` + after, "gu");

function findRelative(text: string): (Found & { minutes: number }) | undefined {
  for (const match of text.matchAll(relativePattern)) {
    const groups = match.groups ?? {};
    const minutes = groups.only !== undefined ? Number(groups.only) : Number(groups.hours) * 60 + (groups.half ? 30 : Number(groups.minutes ?? 0));
    if (minutes > 0) return { start: match.index, end: match.index + match[0].length, minutes };
  }
  return undefined;
}

const isPM = (period?: string) => period === "오후" || period === "점심" || period === "저녁" || period === "밤";
const isAM = (period?: string) => period === "오전" || period === "아침" || period === "새벽";

const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const daysIn = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

/** 24-hour clock for "H시" with or without 오전/오후 (see the spec's table); undefined when out of range. */
function hourOf(hour: number, period: string | undefined, spoken: boolean): number | undefined {
  if (spoken ? hour < 1 || hour > 24 : hour > 23) return undefined;
  if (hour === 24) return 0;
  if (isPM(period)) return hour < 12 ? hour + 12 : hour;
  if (isAM(period)) return hour === 12 ? 0 : hour;
  if (!spoken) return hour;
  if (hour <= 6) return hour + 12;
  return hour;
}

interface Found { start: number; end: number }

function findDate(text: string, today: Date, lang: Lang = "ko"): (Found & { date: Date; by: boolean }) | undefined {
  for (const match of text.matchAll(datePattern)) {
    const groups = match.groups ?? {};
    // "10/5" is month/day in Korean and English; in Dutch the day/month rule has it.
    if (lang === "nl" && groups.slashMonth !== undefined) continue;
    const by = Boolean(groups.by);
    let date: Date | undefined;
    if (groups.weekday) {
      const target = weekdayNames.indexOf(groups.weekday);
      if (groups.week) {
        const monday = addDays(today, -((today.getDay() + 6) % 7));
        date = addDays(monday, (target + 6) % 7 + (groups.week === "다음" ? 7 : 0));
      } else date = addDays(today, (target - today.getDay() + 7) % 7);
    } else if (groups.until) {
      if (!by) continue;
      const sunday = addDays(today, (7 - today.getDay()) % 7);
      if (groups.until.endsWith("달")) date = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      else date = groups.until.startsWith("다음") ? addDays(sunday, 7) : sunday;
    } else if (groups.relative) {
      date = addDays(today, ["오늘", "내일", "모레", "글피"].indexOf(groups.relative));
    } else {
      const month = Number(groups.month ?? groups.slashMonth);
      const day = Number(groups.day ?? groups.slashDay);
      if (month < 1 || month > 12 || day < 1) continue;
      let year = today.getFullYear();
      if (new Date(year, month - 1, day) < today) year += 1;
      if (day > daysIn(year, month - 1)) continue;
      date = new Date(year, month - 1, day);
    }
    return { start: match.index, end: match.index + match[0].length, date, by };
  }
  return undefined;
}

function findTime(text: string, skip?: Found): (Found & { hour: number; minute: number; explicit: boolean }) | undefined {
  for (const match of text.matchAll(timePattern)) {
    const start = match.index;
    const end = start + match[0].length;
    if (skip && start < skip.end && end > skip.start) continue;
    const groups = match.groups ?? {};
    const spoken = groups.hour !== undefined;
    const hour = hourOf(Number(spoken ? groups.hour : groups.clockHour), spoken ? groups.period : groups.clockPeriod, spoken);
    if (hour === undefined) continue;
    const minute = spoken ? (groups.half ? 30 : Number(groups.minute ?? 0)) : Number(groups.clockMinute);
    return { start, end, hour, minute, explicit: Boolean(spoken ? groups.period : groups.clockPeriod) };
  }
  return undefined;
}

/** "10월 2일 (금)", "Fri, Oct 2", "vr 2 okt" */
export function dayTitle(date: Date, lang: Lang = "ko"): string {
  return shortDate(date, lang);
}

/**
 * "내일 오후 3:00 알림" · "Reminder tomorrow at 3:00 PM" · "Herinnering morgen om 15:00" — today / tomorrow
 * by the 4 a.m. day, otherwise the date.
 */
export function reminderSummary(at: Date, now: Date, lang: Lang = "ko"): string {
  const today = logicalDayStart(now);
  const day = logicalDayStart(at);
  const offset = Math.round((new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / 86_400_000);
  const word = offset === 0 || offset === 1 ? dayWord(offset, lang)! : undefined;
  const time = spokenTime(at.getHours(), at.getMinutes(), lang);
  if (lang === "ko") return `${word ?? dayTitle(at, lang)} ${time} 알림`;
  const when = word?.toLowerCase() ?? dayTitle(at, lang);
  return lang === "en" ? `Reminder ${when} at ${time}` : `Herinnering ${when} om ${time}`;
}

/** `lang`: the app's language — its own words are understood first, and Korean always; the summary is written in it. */
export function parseQuick(text: string, now = new Date(), lang: Lang = "ko"): QuickParse {
  const start = logicalDayStart(now);
  const today = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const rules = lang === "ko" ? undefined : wordRules[lang];
  const range = findRange(text, lang);
  if (range) {
    const ranged = rangeParse(text, range, today, now, lang);
    if (ranged) return ranged;
  }
  const words = rules ? findWordDate(rules, text, today) : undefined;
  const date: (Found & { date: Date; by: boolean; evening?: boolean }) | undefined = words ?? findDate(text, today, lang);
  const wordTime = rules ? findWordTime(rules, text, date) : undefined;
  const relative = wordTime ? undefined : findRelative(text);
  const korean = wordTime || relative ? undefined : findTime(text, date);
  const timeSpan: Found | undefined = wordTime ?? relative ?? korean;
  if (!date && !timeSpan) return { title: text };

  const spans: Found[] = [];
  if (date) spans.push(date);
  if (timeSpan) spans.push(timeSpan);
  spans.sort((a, b) => b.start - a.start);
  let rest = text;
  for (const span of spans) rest = `${rest.slice(0, span.start)} ${rest.slice(span.end)}`;
  const title = rest.replace(/\s+/g, " ").trim();
  if (!title) return { title: text };

  let time = wordTime?.hit.kind === "clock" ? { hour: wordTime.hit.hour, minute: wordTime.hit.minute, explicit: wordTime.hit.explicit }
    : korean ? { hour: korean.hour, minute: korean.minute, explicit: korean.explicit } : undefined;
  const after = wordTime?.hit.kind === "after" ? wordTime.hit.minutes : relative?.minutes;
  // "tonight" / "vanavond": 20:00, or the time given read as evening ("tonight at 9" is 21:00).
  if (date?.evening) {
    if (time && !time.explicit && time.hour < 12) time = { ...time, hour: time.hour + 12 };
    if (!time && after === undefined) time = { hour: 20, minute: 0, explicit: false };
  }

  if (after !== undefined) {
    const at = new Date(now);
    at.setSeconds(0, 0);
    at.setTime(at.getTime() + after * 60_000);
    return { title, reminderAt: at, summary: reminderSummary(at, now, lang) };
  }
  if (time) {
    const day = date?.date ?? today;
    let at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), time.hour, time.minute);
    if (!date && at <= now) at = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1, time.hour, time.minute);
    return { title, reminderAt: at, summary: reminderSummary(at, now, lang) };
  }
  const due = date!;
  if (!due.by && key(due.date) === key(today)) return { title };
  const day = dayTitle(due.date, lang);
  return { title, dueDate: key(due.date), summary: lang === "ko" ? `${day}까지` : lang === "en" ? `Due ${day}` : `Deadline ${day}` };
}

// ─── English and Dutch ────────────────────────────────────────────────────────
//
// The words understood in English and Dutch, mirroring the Korean ones: days (today, tomorrow,
// weekdays, "oct 12", "10/12" — Dutch "12/10" is day/month), deadlines ("by friday", "tot vrijdag",
// "this week", "eind van de maand"), times ("3pm", "at 3", "om 3 uur", "15u", "noon") and "in 30 min"
// / "over 2 uur". The same patterns and rules as the macOS app (QuickParse.swift, WordRules); a phrase
// is matched whole, ignoring case. Rules are tried in order; the first that understands a match wins.

type Groups = Record<string, string | undefined>;
type TimeHit = { kind: "clock"; hour: number; minute: number; explicit: boolean } | { kind: "after"; minutes: number };
interface WordRules {
  by: string;
  dates: { pattern: string; resolve: (g: Groups, today: Date) => { date: Date; evening: boolean } | undefined }[];
  times: { pattern: string; resolve: (g: Groups) => TimeHit | undefined }[];
}

/** Nothing letter- or digit-like right before or after, so "3 apples" or "1/2/3" never read as dates. */
const wordBefore = String.raw`(?<![\p{L}\p{N}/:])`;
const wordAfter = String.raw`(?![\p{L}\p{N}/:])`;

function* wordMatches(pattern: string, text: string): Generator<Found & { groups: Groups }> {
  for (const match of text.matchAll(new RegExp(pattern, "giu"))) {
    const groups: Groups = {};
    for (const [name, value] of Object.entries(match.groups ?? {})) if (value !== undefined) groups[name] = value.toLowerCase();
    yield { start: match.index, end: match.index + match[0].length, groups };
  }
}

function findWordDate(rules: WordRules, text: string, today: Date): (Found & { date: Date; by: boolean; evening: boolean }) | undefined {
  for (const rule of rules.dates) {
    for (const match of wordMatches(String.raw`${wordBefore}(?:(?<by>${rules.by})\s+)?(?:${rule.pattern})${wordAfter}`, text)) {
      const found = rule.resolve(match.groups, today);
      if (found) return { start: match.start, end: match.end, date: found.date, by: Boolean(match.groups.by), evening: found.evening };
    }
  }
  return undefined;
}

function findWordTime(rules: WordRules, text: string, skip?: Found): (Found & { hit: TimeHit }) | undefined {
  for (const rule of rules.times) {
    for (const match of wordMatches(String.raw`${wordBefore}(?:${rule.pattern})${wordAfter}`, text)) {
      if (skip && match.start < skip.end && match.end > skip.start) continue;
      const hit = rule.resolve(match.groups);
      if (hit) return { start: match.start, end: match.end, hit };
    }
  }
  return undefined;
}

const mondayOf = (day: Date) => addDays(day, -((day.getDay() + 6) % 7));

/** A weekday: the coming one (today counts) — or with "next" / "volgende", that day in next week (Monday to Sunday, like 다음 주). */
const weekdayFrom = (target: number, next: boolean, today: Date) =>
  next ? addDays(mondayOf(today), ((target + 6) % 7) + 7) : addDays(today, (target - today.getDay() + 7) % 7);

/** The end of this or next week (Sunday) or month. */
const spanEnd = (month: boolean, next: boolean, today: Date) =>
  month ? new Date(today.getFullYear(), today.getMonth() + (next ? 2 : 1), 0) : addDays(mondayOf(today), 6 + (next ? 7 : 0));

/** The next such day (this year, or next once it has passed); undefined when the day doesn't exist. */
function monthDay(month: number, day: number, today: Date): Date | undefined {
  if (!(month >= 1 && month <= 12) || day < 1) return undefined;
  for (const year of [today.getFullYear(), today.getFullYear() + 1]) {
    if (day > daysIn(year, month - 1)) return undefined;
    const date = new Date(year, month - 1, day);
    if (date >= today) return date;
  }
  return undefined;
}

/**
 * A 24-hour hour from what was written. `spoken` ("at 3", "om 3 uur", "15u") follows the Korean 3시
 * rule — 1 to 6 o'clock is the afternoon — unless a part of the day says otherwise.
 */
function wordHour(value: number, pm: boolean | undefined, spoken: boolean): number | undefined {
  if (pm !== undefined) {
    if (value > 12) return value <= 23 ? value : undefined;
    return pm ? (value < 12 ? value + 12 : 12) : (value === 12 ? 0 : value);
  }
  if (value > (spoken ? 24 : 23)) return undefined;
  if (value === 24) return 0;
  return spoken && value >= 1 && value <= 6 ? value + 12 : value;
}

const num = (text: string | undefined) => (text !== undefined && /^\d+$/.test(text) ? Number(text) : undefined);
const asDate = (date: Date | undefined) => (date ? { date, evening: false } : undefined);

const englishWeekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const englishMonths = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const englishWeekdayWords = "sunday|monday|tuesday|wednesday|thursday|friday|saturday";
const englishMonthWords = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec";

const dutchWeekdays = ["zo", "ma", "di", "wo", "do", "vr", "za"];
const dutchMonths = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const dutchWeekdayWords = "zondag|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag";
const dutchMonthWords = "januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|jan|feb|mrt|maa|apr|jun|jul|aug|sept|sep|okt|nov|dec";
const dutchPeriod = String.raw`['’]s\s*(?:middags|avonds|ochtends|morgens|nachts)`;

const wordRules: Record<"en" | "nl", WordRules> = {
  en: {
    by: String.raw`by|due(?:\s+(?:by|on))?|before|until|till`,
    dates: [
      { pattern: "(?<tonight>tonight)", resolve: (_g, today) => ({ date: today, evening: true }) },
      {
        pattern: String.raw`(?<rel>(?:the\s+)?day\s+after\s+tomorrow|today|tomorrow)`,
        resolve: (g, today) => asDate(addDays(today, g.rel!.includes("after") ? 2 : g.rel === "tomorrow" ? 1 : 0)),
      },
      {
        pattern: String.raw`(?<span>(?:this|next)\s+(?:week|month)|end\s+of\s+(?:the\s+)?(?:week|month))`,
        resolve: (g, today) => asDate(spanEnd(g.span!.endsWith("month"), g.span!.startsWith("next"), today)),
      },
      {
        pattern: String.raw`(?:(?<which>this|next|on)\s+(?<wd>${englishWeekdayWords}|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)|(?<bare>${englishWeekdayWords}|mon|tues|tue|wed|thurs|thur|thu|fri))`,
        resolve: (g, today) => {
          const target = englishWeekdays.indexOf((g.wd ?? g.bare ?? "").slice(0, 3));
          return target < 0 ? undefined : asDate(weekdayFrom(target, g.which === "next", today));
        },
      },
      {
        pattern: String.raw`(?:(?<mname>${englishMonthWords})\.?\s+(?<mday>\d{1,2})(?:st|nd|rd|th)?|(?<dday>\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?<dname>${englishMonthWords})\.?)`,
        resolve: (g, today) => {
          const month = englishMonths.indexOf((g.mname ?? g.dname ?? "").slice(0, 3));
          const day = num(g.mday ?? g.dday);
          return month < 0 || day === undefined ? undefined : asDate(monthDay(month + 1, day, today));
        },
      },
      {
        pattern: String.raw`(?<sa>\d{1,2})/(?<sb>\d{1,2})`,
        resolve: (g, today) => asDate(monthDay(num(g.sa)!, num(g.sb)!, today)),
      },
    ],
    times: [
      {
        pattern: String.raw`in\s+(?:(?<n>\d{1,3})\s*(?<unit>minutes|minute|mins|min|m|hours|hour|hrs|hr|h)|(?<an>an|one)\s+hour|(?<half>half\s+an\s+hour))`,
        resolve: (g) => {
          if (g.half !== undefined) return { kind: "after", minutes: 30 };
          if (g.an !== undefined) return { kind: "after", minutes: 60 };
          const n = num(g.n);
          if (n === undefined || n <= 0 || g.unit === undefined) return undefined;
          return { kind: "after", minutes: g.unit.startsWith("h") ? n * 60 : n };
        },
      },
      {
        pattern: String.raw`(?:at\s+)?(?<h>\d{1,2})(?::(?<m>[0-5]\d))?\s*(?<ap>[ap])\.?m\.?`,
        resolve: (g) => {
          const value = num(g.h);
          if (value === undefined || value < 1 || value > 12) return undefined;
          const hour = wordHour(value, g.ap === "p", false);
          return hour === undefined ? undefined : { kind: "clock", hour, minute: num(g.m) ?? 0, explicit: true };
        },
      },
      { pattern: String.raw`(?:at\s+)?(?<noon>noon|midday)`, resolve: () => ({ kind: "clock", hour: 12, minute: 0, explicit: true }) },
      {
        pattern: String.raw`at\s+(?<h>\d{1,2})(?::(?<m>[0-5]\d))?(?:\s*o['’]clock)?`,
        resolve: (g) => {
          const hour = wordHour(num(g.h) ?? 99, undefined, true);
          return hour === undefined ? undefined : { kind: "clock", hour, minute: num(g.m) ?? 0, explicit: false };
        },
      },
    ],
  },
  nl: {
    by: String.raw`tot\s+en\s+met|t/m|tot|uiterlijk|vóór|voor`,
    dates: [
      { pattern: "(?<tonight>vanavond)", resolve: (_g, today) => ({ date: today, evening: true }) },
      { pattern: "(?<rel>overmorgen|vandaag|morgen)", resolve: (g, today) => asDate(addDays(today, Math.max(0, ["vandaag", "morgen", "overmorgen"].indexOf(g.rel ?? "")))) },
      {
        pattern: String.raw`(?<span>(?:deze|volgende)\s+(?:week|maand)|einde?\s+van\s+de\s+(?:week|maand)|einde?\s+(?:week|maand))`,
        resolve: (g, today) => asDate(spanEnd(g.span!.endsWith("maand"), g.span!.startsWith("volgende"), today)),
      },
      {
        pattern: String.raw`(?:(?<which>deze|volgende|komende|op)\s+(?<wd>${dutchWeekdayWords}|ma|di|wo|do|vr|za|zo)|(?<bare>${dutchWeekdayWords}|di|wo|do|vr|za))`,
        resolve: (g, today) => {
          const target = dutchWeekdays.indexOf((g.wd ?? g.bare ?? "").slice(0, 2));
          return target < 0 ? undefined : asDate(weekdayFrom(target, g.which === "volgende", today));
        },
      },
      {
        pattern: String.raw`(?<dday>\d{1,2})e?\s+(?<dname>${dutchMonthWords})\.?`,
        resolve: (g, today) => {
          const name = g.dname ?? "";
          const month = name.startsWith("maa") ? 2 : dutchMonths.indexOf(name.slice(0, 3));
          const day = num(g.dday);
          return month < 0 || day === undefined ? undefined : asDate(monthDay(month + 1, day, today));
        },
      },
      {
        pattern: String.raw`(?<sa>\d{1,2})/(?<sb>\d{1,2})`,
        resolve: (g, today) => asDate(monthDay(num(g.sb)!, num(g.sa)!, today)),
      },
    ],
    times: [
      {
        pattern: String.raw`over\s+(?:(?<n>\d{1,3})\s*(?<unit>minuten|minuut|min|m|uur|u)|een\s+(?<word>kwartier|half\s+uur|uur))`,
        resolve: (g) => {
          if (g.word !== undefined) return { kind: "after", minutes: g.word === "kwartier" ? 15 : g.word === "uur" ? 60 : 30 };
          const n = num(g.n);
          if (n === undefined || n <= 0 || g.unit === undefined) return undefined;
          return { kind: "after", minutes: g.unit.startsWith("u") ? n * 60 : n };
        },
      },
      {
        pattern: String.raw`(?:(?<pa>${dutchPeriod})\s+)?(?:(?<om>om)\s+)?(?<h>\d{1,2})(?<mark>:[0-5]\d|u(?:[0-5]\d)?|\s*uur)?(?:\s+(?<pb>${dutchPeriod}))?`,
        resolve: (g) => {
          const mark = g.mark ?? "";
          const period = g.pa ?? g.pb;
          const om = g.om !== undefined;
          // A bare number, or "3 uur" (also "3 hours"), is no time without om or a part of the day.
          if (!(om || period !== undefined || mark.startsWith(":") || mark.startsWith("u"))) return undefined;
          const value = num(g.h);
          if (value === undefined) return undefined;
          // 's middags and 's avonds are p.m.; 's nachts is p.m. from 7 to 11 ("'s nachts 11 uur" is 23:00).
          const pm = period === undefined ? undefined
            : period.endsWith("middags") || period.endsWith("avonds") || (period.endsWith("nachts") && value >= 7 && value <= 11);
          const minute = num(mark.replace(/^\D+/, "")) ?? 0;
          const hour = wordHour(value, pm, om || !mark.startsWith(":"));
          return hour === undefined ? undefined : { kind: "clock", hour, minute, explicit: period !== undefined };
        },
      },
    ],
  },
};

// ─── Time ranges (시간 정하기) ────────────────────────────────────────────────────
//
// "3시부터 5시까지 보고서", "14:00-15:30 보고서", "보고서 2시~4시", "오후 2시부터 1시간 보고서"; en "report 2-4pm",
// "report from 2 to 4", "2pm–3:30pm report"; nl "verslag 14:00-15:30", "verslag van 2 tot 4 uur". The rules are in
// timeblock-cases.md §4 (shared with the Mac): Korean in every language, English and Dutch in their own.

/** Where the phrase is in the text, and the range it says (minutes after midnight). */
interface RangeFound extends Found { from: number; to: number }

const dash = "(?:~|-|–|—)";
const koreanRange = [
  // 3시부터 5시까지 · 3시~5시 · 3~5시 · 오후 7시 반부터 9시
  String.raw`(?:(?<p1>${periods})${space})?(?<h1>\d{1,2})(?:시(?:${space}(?<m1>[0-5]?\d)분|${space}(?<f1>반))?${space}(?:부터|${dash})|${space}${dash})${space}(?:(?<p2>${periods})${space})?(?<h2>\d{1,2})시(?:${space}(?<m2>[0-5]?\d)분|${space}(?<f2>반))?(?:${space}까지)?`,
  // 14:00-15:30 · 14:00부터 15:30까지
  String.raw`(?:(?<cp1>${periods})${space})?(?<ch1>[01]?\d|2[0-3]):(?<cm1>[0-5]\d)${space}(?:부터|${dash})${space}(?:(?<cp2>${periods})${space})?(?<ch2>[01]?\d|2[0-3]):(?<cm2>[0-5]\d)(?:${space}까지)?`,
  // 오후 2시부터 1시간 (동안) · 14:00부터 90분
  String.raw`(?:(?<dp>${periods})${space})?(?:(?<dh>\d{1,2})시(?:${space}(?<dm>[0-5]?\d)분|${space}(?<df>반))?|(?<dch>[01]?\d|2[0-3]):(?<dcm>[0-5]\d))${space}부터${space}(?:(?<lh>\d{1,2})${space}시간(?:${space}(?<lm>[0-5]?\d)${space}분|${space}(?<lf>반))?|(?<lmin>\d{1,3})${space}분)(?:${space}동안)?`,
].map((pattern) => new RegExp(before + "(?:" + pattern + ")" + after, "gu"));

/** The end of a range: its own part of the day decides; else, when it isn't after the start, 12 hours later if that is. */
function rangeEnd(from: number, hour: number, minute: number, own: boolean): number | undefined {
  let to = hour * 60 + minute;
  if (!own && to <= from && to + 720 > from && to + 720 < 1440) to += 720;
  // On the 4 a.m. day: 23:00–01:00 is a range, 03:00–05:00 is not.
  return to < 1440 && logicalMinutes(to) > logicalMinutes(from) ? to : undefined;
}

function koreanRangeIn(text: string): RangeFound | undefined {
  for (const pattern of koreanRange) {
    for (const match of text.matchAll(pattern)) {
      const g = match.groups ?? {};
      const where = { start: match.index, end: match.index + match[0].length };
      let from: number | undefined, to: number | undefined;
      if (g.h1 !== undefined) {
        // "3~5시": the first hour borrows 시 (and is read like it).
        const startHour = hourOf(Number(g.h1), g.p1, true);
        const endHour = hourOf(Number(g.h2), g.p2, true);
        if (startHour === undefined || endHour === undefined) continue;
        from = startHour * 60 + (g.f1 ? 30 : Number(g.m1 ?? 0));
        to = rangeEnd(from, endHour, g.f2 ? 30 : Number(g.m2 ?? 0), g.p2 !== undefined);
      } else if (g.ch1 !== undefined) {
        // Written clocks are as written ("14:00-15:30"); a part of the day still turns 2:00 into 14:00.
        const startHour = hourOf(Number(g.ch1), g.cp1, false);
        const endHour = hourOf(Number(g.ch2), g.cp2 ?? g.cp1, false);
        if (startHour === undefined || endHour === undefined) continue;
        from = startHour * 60 + Number(g.cm1);
        to = rangeEnd(from, endHour, Number(g.cm2), true);
      } else {
        const spoken = g.dh !== undefined;
        const startHour = hourOf(Number(spoken ? g.dh : g.dch), g.dp, spoken);
        if (startHour === undefined) continue;
        from = startHour * 60 + (spoken ? (g.df ? 30 : Number(g.dm ?? 0)) : Number(g.dcm));
        const length = g.lmin !== undefined ? Number(g.lmin) : Number(g.lh) * 60 + (g.lf ? 30 : Number(g.lm ?? 0));
        const end = (from + length) % 1440;
        to = length > 0 && logicalMinutes(from) + length <= 1680 && logicalMinutes(end) > logicalMinutes(from) ? end : undefined;
      }
      if (to !== undefined) return { ...where, from, to };
    }
  }
  return undefined;
}

/** English: "2-4pm", "2pm–3:30pm", "from 2 to 4", "14:00-15:30" — only with an am/pm, a "from", or two clocks. */
function englishRangeIn(text: string): RangeFound | undefined {
  const side = (n: string) => String.raw`(?<h${n}>\d{1,2})(?::(?<m${n}>[0-5]\d))?(?:\s*(?<ap${n}>[ap])\.?m\.?)?`;
  const pattern = String.raw`${wordBefore}(?<from>from\s+)?${side("1")}\s*(?:-|–|—|to|until|till)\s*${side("2")}${wordAfter}`;
  for (const match of wordMatches(pattern, text)) {
    const g = match.groups;
    const [h1, h2] = [num(g.h1)!, num(g.h2)!];
    const clocks = g.m1 !== undefined && g.m2 !== undefined;
    if (!(g.ap1 || g.ap2 || g.from || clocks)) continue;
    const [m1, m2] = [num(g.m1) ?? 0, num(g.m2) ?? 0];
    const twelve = (hour: number, ap: string) => (hour >= 1 && hour <= 12 ? wordHour(hour, ap === "p", false) : undefined);
    // Written as it is: a clock without am/pm keeps its hour; a bare "from 2" is the afternoon (the 3시 rule).
    const plain = (hour: number) => (clocks && !g.from ? (hour <= 23 ? hour : undefined) : wordHour(hour, undefined, true));
    const endHour = g.ap2 ? twelve(h2, g.ap2) : g.ap1 ? (h2 <= 23 ? h2 : undefined) : plain(h2);
    let startHour: number | undefined;
    if (g.ap1) startHour = twelve(h1, g.ap1);
    else if (g.ap2 && endHour !== undefined) {
      // "2-4pm": the start takes the end's part of the day when that keeps it first ("11-1pm" stays 11 a.m.).
      const same = twelve(h1, g.ap2);
      startHour = same !== undefined && same * 60 + m1 < endHour * 60 + m2 ? same : h1 <= 12 ? h1 : undefined;
    } else startHour = plain(h1);
    if (startHour === undefined || endHour === undefined) continue;
    const from = startHour * 60 + m1;
    const to = rangeEnd(from, endHour, m2, Boolean(g.ap2));
    if (to !== undefined) return { start: match.start, end: match.end, from, to };
  }
  return undefined;
}

/** Dutch: "van 2 tot 4 uur", "van 14:00 tot 15:30", "14:00-15:30" — only with "van … tot" or two clocks. */
function dutchRangeIn(text: string): RangeFound | undefined {
  const side = (n: string) => String.raw`(?<h${n}>\d{1,2})(?:(?<sep${n}>:|u)(?<m${n}>[0-5]\d))?`;
  const pattern = String.raw`${wordBefore}(?<van>van\s+)?${side("1")}\s*(?<to>-|–|—|tot(?:\s+en\s+met)?)\s*${side("2")}(?:\s*uur)?${wordAfter}`;
  for (const match of wordMatches(pattern, text)) {
    const g = match.groups;
    const clocks = g.sep1 === ":" && g.sep2 === ":";
    if (!((g.van && g.to?.startsWith("tot")) || clocks)) continue;
    const startHour = wordHour(num(g.h1)!, undefined, !clocks);
    const endHour = wordHour(num(g.h2)!, undefined, !clocks);
    if (startHour === undefined || endHour === undefined) continue;
    const from = startHour * 60 + (num(g.m1) ?? 0);
    const to = rangeEnd(from, endHour, num(g.m2) ?? 0, clocks);
    if (to !== undefined) return { start: match.start, end: match.end, from, to };
  }
  return undefined;
}

/** The first range phrase: the language's own words first, Korean always. */
function findRange(text: string, lang: Lang): RangeFound | undefined {
  return (lang === "en" ? englishRangeIn(text) : lang === "nl" ? dutchRangeIn(text) : undefined) ?? koreanRangeIn(text);
}

/**
 * A line with a range: the day written (its deadline) or, without one, today while the range's end is still
 * ahead, else tomorrow (then due tomorrow); a reminder at the start when that is still ahead.
 */
function rangeParse(text: string, range: RangeFound, today: Date, now: Date, lang: Lang): QuickParse | undefined {
  const rules = lang === "ko" ? undefined : wordRules[lang];
  const outside = <T extends Found>(found?: T): T | undefined => (found && (found.end <= range.start || found.start >= range.end) ? found : undefined);
  const date: (Found & { date: Date }) | undefined = outside(rules ? findWordDate(rules, text, today) : undefined) ?? outside(findDate(text, today, lang));
  const spans: Found[] = [range, ...(date ? [date] : [])].sort((a, b) => b.start - a.start);
  let rest = text;
  for (const span of spans) rest = `${rest.slice(0, span.start)} ${rest.slice(span.end)}`;
  const title = rest.replace(/\s+/g, " ").trim();
  if (!title) return undefined;
  // Logical minutes: a time before 04:00 is that night's (the next calendar day).
  const at = (day: Date, minutes: number) => new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, logicalMinutes(minutes));
  let day = date?.date ?? today;
  if (!date && at(today, range.to) <= now) day = addDays(today, 1);
  const startAt = at(day, range.from);
  return {
    title,
    ...(startAt > now ? { reminderAt: startAt } : {}),
    ...(key(day) !== key(today) ? { dueDate: key(day) } : {}),
    range: { day: key(day), start: range.from, end: range.to },
  };
}
