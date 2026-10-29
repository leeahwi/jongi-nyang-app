import { logicalDayStart } from "./archive";
import { daysText, nextFire, timeText, type Alarm } from "./alarm";
import { dateKey, nextSlot } from "./calendar";
import { durationText, parseDuration } from "./duration";
import { clock, dayMonth, dayWord, shortDate, timeRange, weekdayShort, type Lang } from "./lang";
import { parseQuick } from "./quickParse";
import { rangeWhenText } from "./timeRange";
import { describe, isValidRule, nextOccurrence, type RepeatRule } from "./repeat";

/**
 * 입력 줄: what a line typed anywhere (the note's input line, 빠른 입력) means — a to-do, an event,
 * a timer, an alarm or a note — as candidates, best first. The same rules and test cases as the
 * macOS app (PaperCore Intent.swift); the shared cases are in intent-cases.md.
 *
 * 1. A slash kind first (`/할일 /일정 /메모 /타이머 /알람`, en `/todo /event /note /timer /alarm`,
 *    nl `/taak /afspraak /notitie /timer /wekker`; the Korean ones in every language): only that
 *    kind, or nothing when it can't be read (the line then says why, see `intentProblem`).
 * 2. Several lines: a note, then a to-do from the first line.
 * 3. A timer (`타이머 40`, `40분 집중`, `focus 25`, `보고서 25분 집중`): the timer, then a to-do of the whole line.
 * 4. An alarm (`알람 7시 평일`, `alarm 7am`, `wekker 7 uur doordeweeks`): the alarm, then a to-do of the whole line.
 * 5. Otherwise the quick-add reading: a time → a to-do with that reminder and an hour-long event
 *    (the event first when the title has an event word), a day → a to-do due then and an all-day
 *    event, nothing → a to-do, then a note.
 * 6. A learned preference (the title's first word → a kind) moves that kind to the front.
 *
 * 편의 기능 (1.23): a line that starts with a repeat (`매일 물 마시기`, `매주 월 9시 주간 회의`, `every Monday
 * 9am …`, `elke dag …`, or `/반복 …`) reads as a repeating to-do — and, when a time was given or the title
 * names an event, as a repeating event too (rule 4½, after alarms; shared rows 201– in intent-cases.md).
 */

export type IntentKind = "todo" | "event" | "timer" | "alarm" | "memo" | "repeat";
export const intentKinds: readonly IntentKind[] = ["todo", "event", "timer", "alarm", "memo", "repeat"];

/** The repeats an event can keep (events.json): every day, every week on one weekday, every month on a date. */
export type EventRepeatKind = "daily" | "weekly" | "monthly";

export type Candidate =
  /** `range`: 시간 정하기 read from the line ("3시부터 5시까지"): the day ("yyyy-MM-dd") and its minutes. */
  | { kind: "todo"; title: string; reminderAt?: Date; dueDate?: string; range?: { day: string; start: number; end: number } }
  /** `day` "yyyy-MM-dd"; `start` and `end` minutes of the day (an end at or before the start is the next day); all day: 540 and 600, unused. */
  | { kind: "event"; title: string; day: string; start: number; end: number; allDay: boolean; /** A repeating event (from a repeat line). */ repeat?: EventRepeatKind }
  /** `title`: what to focus on ("보고서 25분 집중"): putting it in starts 집중 on that task (stage 4). */
  | { kind: "timer"; minutes: number; title?: string }
  /** `time` "HH:mm"; `days` 0 = Sunday … 6 = Saturday, none = once. */
  | { kind: "alarm"; time: string; days: number[]; label: string }
  | { kind: "memo"; text: string }
  /** A repeating to-do (repeats.json): `time` "HH:mm" is its daily alert. */
  | { kind: "repeat"; title: string; rule: RepeatRule; time?: string };

/** The learned kinds: the title's first word → the kind it goes first as. */
export type IntentPrefer = Record<string, IntentKind>;

// ─── Slash kinds ──────────────────────────────────────────────────────────────

const slashWords: Record<Lang, Record<string, IntentKind>> = {
  ko: { "할일": "todo", "일정": "event", "메모": "memo", "타이머": "timer", "알람": "alarm", "반복": "repeat" }, // i18n-ok
  en: { todo: "todo", event: "event", note: "memo", timer: "timer", alarm: "alarm", repeat: "repeat" },
  nl: { taak: "todo", afspraak: "event", notitie: "memo", timer: "timer", wekker: "alarm", herhaal: "repeat" },
};

/** The slash words of a language, as the hint lists them: "/할일 /일정 /메모 /타이머 /알람". */
export function slashHint(lang: Lang = "ko"): string {
  return Object.keys(slashWords[lang]).map((word) => `/${word}`).join(" ");
}

/** A line that starts with a slash kind: the kind and what follows it (trimmed). */
export function slashOf(text: string, lang: Lang = "ko"): { kind: IntentKind; rest: string } | undefined {
  const match = /^\s*\/(\S+)(?:\s+([\s\S]*))?$/u.exec(text);
  if (!match) return undefined;
  const word = match[1].toLowerCase();
  const kind = slashWords[lang][word] ?? slashWords.ko[word];
  return kind ? { kind, rest: (match[2] ?? "").trim() } : undefined;
}

const problems: Record<"alarm" | "timer" | "repeat", Record<Lang, string>> = {
  // What it couldn't read, then one example that works (#37); the same words as the Mac's.
  alarm: { ko: "알람 시간을 알아듣지 못했어요. ‘/알람 7시’처럼 적어 보세요.", en: "Couldn’t read the alarm time. Try ‘/alarm 7am’.", nl: "De wektijd is niet duidelijk. Probeer ‘/wekker 7:00’." },
  timer: { ko: "타이머 길이를 알아듣지 못했어요. ‘/타이머 40’처럼 적어 보세요.", en: "Couldn’t read the timer length. Try ‘/timer 40’.", nl: "De timerduur is niet duidelijk. Probeer ‘/timer 40’." },
  repeat: { ko: "반복을 알아듣지 못했어요. ‘/반복 매일 물 마시기’처럼 적어 보세요.", en: "Couldn’t read the repeat. Try ‘/repeat every day drink water’.", nl: "De herhaling is niet duidelijk. Probeer ‘/herhaal elke dag water drinken’." },
};

/** Why a slashed line gives nothing (`/알람 abc`, `/타이머 0`): the clay hint under the line; undefined otherwise. */
export function intentProblem(text: string, lang: Lang = "ko", now = new Date()): string | undefined {
  const slash = slashOf(text.trim(), lang);
  if (!slash || (slash.kind !== "alarm" && slash.kind !== "timer" && slash.kind !== "repeat") || !slash.rest) return undefined;
  return readIntent(text, now, lang).length === 0 ? problems[slash.kind][lang] : undefined;
}

// ─── Timers ───────────────────────────────────────────────────────────────────

const timerWords = (lang: Lang) => (lang === "ko" ? ["타이머", "집중"] : ["타이머", "집중", "timer", "focus"]); // i18n-ok
const focusWords = (lang: Lang) => (lang === "ko" ? ["집중"] : ["집중", "focus"]); // i18n-ok

/**
 * "타이머 40", "40분 타이머", "집중 1:30", "focus 25", "25 min focus" — and a focus on something
 * (집중 · focus with a title, stage 4): "보고서 25분 집중" (a focus word last: the last four, three, two or
 * one words before it as the length, the rest as the title), "focus 25 report" (a focus word first:
 * the next four, three, two or one words as the length, the rest as the title) and "25 min focus report"
 * (the words before a focus word in the middle as the length, the words after it as the title).
 */
export function readTimer(text: string, lang: Lang = "ko"): { minutes: number; title?: string } | undefined {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return undefined;
  const keyword = (word: string) => timerWords(lang).includes(word.toLowerCase());
  const focusWord = (word: string) => focusWords(lang).includes(word.toLowerCase());
  if (keyword(words[0])) {
    const minutes = parseDuration(words.slice(1).join(" "), lang);
    if (minutes !== undefined) return { minutes };
  }
  const last = words[words.length - 1];
  if (keyword(last)) {
    const before = words.slice(0, -1);
    const whole = parseDuration(before.join(" "), lang);
    if (whole !== undefined) return { minutes: whole };
    if (focusWord(last)) {
      for (const count of [4, 3, 2, 1]) {
        if (before.length - count < 1) continue;
        const minutes = parseDuration(before.slice(-count).join(" "), lang);
        if (minutes !== undefined) return { minutes, title: before.slice(0, -count).join(" ") };
      }
    }
  }
  // A focus word first: "focus 25 report", "집중 25분 보고서".
  if (focusWord(words[0])) {
    for (const count of [4, 3, 2, 1]) {
      if (words.length - 1 - count < 1) continue;
      const minutes = parseDuration(words.slice(1, 1 + count).join(" "), lang);
      if (minutes !== undefined) return { minutes, title: words.slice(1 + count).join(" ") };
    }
  }
  // A focus word in the middle: "25 min focus report", "25분 집중 보고서".
  for (let at = 1; at < words.length - 1; at += 1) {
    if (!focusWord(words[at])) continue;
    const minutes = parseDuration(words.slice(0, at).join(" "), lang);
    if (minutes !== undefined) return { minutes, title: words.slice(at + 1).join(" ") };
  }
  return undefined;
}

// ─── Alarms ───────────────────────────────────────────────────────────────────

const alarmWords = (lang: Lang) => (lang === "ko" ? ["알람"] : lang === "en" ? ["알람", "alarm"] : ["알람", "wekker"]); // i18n-ok

const edge = String.raw`(?<![\p{L}\p{N}:/])`;
const edgeAfter = String.raw`(?![\p{L}\p{N}:/])`;
const weekdays = [1, 2, 3, 4, 5];
const weekend = [0, 6];
const everyDay = [0, 1, 2, 3, 4, 5, 6];
const englishNames: [string, number][] = [
  ["mondays", 1], ["monday", 1], ["mon", 1], ["tuesdays", 2], ["tuesday", 2], ["tues", 2], ["tue", 2], ["wednesdays", 3], ["wednesday", 3], ["wed", 3],
  ["thursdays", 4], ["thursday", 4], ["thurs", 4], ["thur", 4], ["thu", 4], ["fridays", 5], ["friday", 5], ["fri", 5],
  ["saturdays", 6], ["saturday", 6], ["sat", 6], ["sundays", 0], ["sunday", 0], ["sun", 0],
];
const dutchNames: [string, number][] = [
  ["maandag", 1], ["ma", 1], ["dinsdag", 2], ["di", 2], ["woensdag", 3], ["wo", 3], ["donderdag", 4], ["do", 4],
  ["vrijdag", 5], ["vr", 5], ["zaterdag", 6], ["za", 6], ["zondag", 0], ["zo", 0],
];
const koreanDays = "일월화수목금토"; // i18n-ok

/** The day phrases of a language (Korean ones in every language), each a pattern and how it reads. */
function dayRules(lang: Lang): { pattern: RegExp; days: (match: string) => number[] }[] {
  const rules: { pattern: RegExp; days: (match: string) => number[] }[] = [
    { pattern: new RegExp(`${edge}매일${edgeAfter}`, "iu"), days: () => everyDay }, // i18n-ok
    { pattern: new RegExp(`${edge}평일${edgeAfter}`, "iu"), days: () => weekdays }, // i18n-ok
    { pattern: new RegExp(`${edge}주말${edgeAfter}`, "iu"), days: () => weekend }, // i18n-ok
    {
      pattern: new RegExp(`${edge}[${koreanDays}](?:[·,/]?[${koreanDays}])*(?:요일)?${edgeAfter}`, "iu"), // i18n-ok
      days: (match) => [...match.replace(/요일$/u, "")].filter((letter) => koreanDays.includes(letter)).map((letter) => koreanDays.indexOf(letter)), // i18n-ok
    },
  ];
  const names = (list: [string, number][], join: string) => {
    const name = list.map(([word]) => word).join("|");
    return {
      pattern: new RegExp(`${edge}(?:${name})(?:\\s*(?:,|${join}|&)?\\s*(?:${name}))*${edgeAfter}`, "iu"),
      days: (match: string) => match.toLowerCase().split(new RegExp(`\\s*(?:,|${join}|&)\\s*|\\s+`)).filter(Boolean).map((word) => list.find(([entry]) => entry === word)?.[1]).filter((day): day is number => day !== undefined),
    };
  };
  if (lang === "en") {
    rules.push(
      { pattern: new RegExp(`${edge}(?:every\\s*day|everyday|daily)${edgeAfter}`, "iu"), days: () => everyDay },
      { pattern: new RegExp(`${edge}(?:weekdays|weekday)${edgeAfter}`, "iu"), days: () => weekdays },
      { pattern: new RegExp(`${edge}(?:weekends|weekend)${edgeAfter}`, "iu"), days: () => weekend },
      names(englishNames, "and"),
    );
  }
  if (lang === "nl") {
    rules.push(
      { pattern: new RegExp(`${edge}(?:elke\\s+dag|dagelijks)${edgeAfter}`, "iu"), days: () => everyDay },
      { pattern: new RegExp(`${edge}(?:doordeweeks|werkdagen)${edgeAfter}`, "iu"), days: () => weekdays },
      { pattern: new RegExp(`${edge}(?:in\\s+het\\s+weekend|weekenden|weekend)${edgeAfter}`, "iu"), days: () => weekend },
      names(dutchNames, "en"),
    );
  }
  return rules;
}

type TimeRule = { pattern: RegExp; read: (groups: Record<string, string | undefined>) => { hour: number; minute: number } | undefined };

/** The hour as an alarm reads it: p.m. words add 12 (12 stays), a.m. words make 12 midnight, otherwise as written (1–6 stay morning). */
function alarmClock(hour: number, minute: number, pm: boolean | undefined): { hour: number; minute: number } | undefined {
  let value = hour;
  if (pm === true && value < 12) value += 12;
  else if (pm === false && value === 12) value = 0;
  else if (pm === undefined && value === 24) value = 0;
  return value > 23 || minute > 59 ? undefined : { hour: value, minute };
}

const koreanPeriod = "오전|오후|아침|점심|저녁|밤|새벽"; // i18n-ok
const koreanPM = (period?: string) => period !== undefined && /^(?:오후|점심|저녁|밤)$/u.test(period); // i18n-ok
const koreanAM = (period?: string) => period !== undefined && /^(?:오전|아침|새벽)$/u.test(period); // i18n-ok
const periodOf = (period?: string): boolean | undefined => (koreanPM(period) ? true : koreanAM(period) ? false : undefined);

/** The time patterns, tried in order (the first that matches decides). */
function timeRules(lang: Lang): TimeRule[] {
  const rules: TimeRule[] = [];
  if (lang === "en") {
    rules.push(
      {
        pattern: new RegExp(`${edge}(?:at\\s+)?(?<h>\\d{1,2})(?::(?<m>\\d{2}))?\\s*(?<ap>[ap])\\.?m\\.?${edgeAfter}`, "iu"),
        read: (g) => (Number(g.h) >= 1 && Number(g.h) <= 12 ? alarmClock(Number(g.h), Number(g.m ?? 0), g.ap!.toLowerCase() === "p") : undefined),
      },
      { pattern: new RegExp(`${edge}at\\s+(?<h>\\d{1,2})(?::(?<m>\\d{2}))?(?:\\s*o['’]clock)?${edgeAfter}`, "iu"), read: (g) => alarmClock(Number(g.h), Number(g.m ?? 0), undefined) },
    );
  }
  if (lang === "nl") {
    rules.push({
      pattern: new RegExp(`${edge}(?:om\\s+)?(?<h>\\d{1,2})(?::(?<m>\\d{2})|u(?<u>\\d{2})?|\\s+uur)(?:\\s+(?<p>['’]s\\s*(?:ochtends|morgens|middags|avonds|nachts)))?${edgeAfter}`, "iu"),
      read: (g) => alarmClock(Number(g.h), Number(g.m ?? g.u ?? 0), g.p && /(?:middags|avonds)$/i.test(g.p) ? true : undefined),
    });
  }
  rules.push(
    {
      pattern: new RegExp(`${edge}(?:(?<p>${koreanPeriod})\\s?)?(?<h>\\d{1,2})시(?:\\s?(?<half>반)|\\s?(?<m>\\d{1,2})분)?${edgeAfter}`, "u"), // i18n-ok
      read: (g) => alarmClock(Number(g.h), g.half ? 30 : Number(g.m ?? 0), periodOf(g.p)),
    },
    { pattern: new RegExp(`${edge}(?:(?<p>${koreanPeriod})\\s?)?(?<h>\\d{1,2}):(?<m>\\d{2})${edgeAfter}`, "u"), read: (g) => alarmClock(Number(g.h), Number(g.m), periodOf(g.p)) },
    { pattern: new RegExp(`${edge}${lang === "nl" ? "(?:om\\s+)?" : ""}(?<h>\\d{1,2})${edgeAfter}`, "iu"), read: (g) => alarmClock(Number(g.h), 0, undefined) },
  );
  return rules;
}

/** "7시 평일 기상", "7:30 weekdays", "7 uur doordeweeks": the days, the time and what is left as the label. */
export function readAlarmBody(body: string, lang: Lang = "ko"): { time: string; days: number[]; label: string } | undefined {
  let rest = body.trim().replace(/\s+/g, " ");
  const days = new Set<number>();
  for (let found = true; found;) {
    found = false;
    for (const rule of dayRules(lang)) {
      const match = rule.pattern.exec(rest);
      if (!match) continue;
      for (const day of rule.days(match[0])) days.add(day);
      rest = `${rest.slice(0, match.index)} ${rest.slice(match.index + match[0].length)}`.replace(/\s+/g, " ").trim();
      found = true;
    }
  }
  for (const rule of timeRules(lang)) {
    const match = rule.pattern.exec(rest);
    if (!match) continue;
    const time = rule.read(match.groups ?? {});
    if (!time) return undefined;
    const label = `${rest.slice(0, match.index)} ${rest.slice(match.index + match[0].length)}`.replace(/\s+/g, " ").trim();
    return { time: `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`, days: [...days].sort((a, b) => a - b), label };
  }
  return undefined;
}

/** "알람 7시 평일" (every language), "alarm 7am" (English), "wekker 7 uur" (Dutch). */
export function readAlarm(text: string, lang: Lang = "ko"): { time: string; days: number[]; label: string } | undefined {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2 || !alarmWords(lang).includes(words[0].toLowerCase())) return undefined;
  return readAlarmBody(words.slice(1).join(" "), lang);
}

// ─── Repeats ──────────────────────────────────────────────────────────────────

const repeatEdge = String.raw`(?![\p{L}\p{N}:/])`;

/** The repeat phrases a line may start with (Korean ones in every language), and the rule each makes. */
function repeatPhrases(lang: Lang): { pattern: RegExp; rule: (match: RegExpExecArray) => RepeatRule | undefined }[] {
  const daysOf = (text: string) => [...new Set([...text.replace(/요일/gu, "")].filter((letter) => koreanDays.includes(letter)).map((letter) => koreanDays.indexOf(letter)))].sort((a, b) => a - b); // i18n-ok
  const names = (list: [string, number][], join: string) => list.map(([word]) => word).join("|") + `|${join}`;
  const weekly = (days: number[]): RepeatRule | undefined => {
    if (days.length === 0) return undefined;
    if (days.length === 7) return { kind: "daily" };
    if (days.join() === "1,2,3,4,5") return { kind: "weekdays" };
    return { kind: "weekly", weekdays: days };
  };
  const monthly = (day: string): RepeatRule | undefined => {
    const value = Number(day);
    return value >= 1 && value <= 31 ? { kind: "monthly", monthDay: value } : undefined;
  };
  const listDays = (text: string, list: [string, number][]) => [...new Set(text.toLowerCase().split(/[\s,&]+|\band\b|\ben\b/).map((word) => list.find(([entry]) => entry === word.trim())?.[1]).filter((day): day is number => day !== undefined))].sort((a, b) => a - b);
  const phrases: { pattern: RegExp; rule: (match: RegExpExecArray) => RepeatRule | undefined }[] = [
    { pattern: new RegExp(`^매일${repeatEdge}`, "u"), rule: () => ({ kind: "daily" }) }, // i18n-ok
    { pattern: new RegExp(`^평일(?:마다)?${repeatEdge}`, "u"), rule: () => ({ kind: "weekdays" }) }, // i18n-ok
    { pattern: new RegExp(`^주말(?:마다)?${repeatEdge}`, "u"), rule: () => ({ kind: "weekly", weekdays: [0, 6] }) }, // i18n-ok
    { pattern: new RegExp(`^매주\\s*([${koreanDays}](?:[·,/]?[${koreanDays}])*)(?:요일)?(?:마다)?${repeatEdge}`, "u"), rule: (match) => weekly(daysOf(match[1])) }, // i18n-ok
    { pattern: new RegExp(`^(?:매월|매달)\\s*(\\d{1,2})일${repeatEdge}`, "u"), rule: (match) => monthly(match[1]) }, // i18n-ok
  ];
  if (lang === "en") {
    const day = names(englishNames, "and");
    phrases.push(
      { pattern: new RegExp(`^(?:every\\s*day|everyday|daily)${repeatEdge}`, "iu"), rule: () => ({ kind: "daily" }) },
      { pattern: new RegExp(`^(?:every\\s+weekday|(?:on\\s+)?weekdays)${repeatEdge}`, "iu"), rule: () => ({ kind: "weekdays" }) },
      { pattern: new RegExp(`^(?:every\\s+weekend|(?:on\\s+)?weekends)${repeatEdge}`, "iu"), rule: () => ({ kind: "weekly", weekdays: [0, 6] }) },
      { pattern: new RegExp(`^every\\s+((?:${day})(?:\\s*(?:,|&)?\\s*(?:${day}))*)${repeatEdge}`, "iu"), rule: (match) => weekly(listDays(match[1], englishNames)) },
      { pattern: new RegExp(`^(?:every\\s+month|monthly)\\s+on\\s+the\\s+(\\d{1,2})(?:st|nd|rd|th)?${repeatEdge}`, "iu"), rule: (match) => monthly(match[1]) },
    );
  }
  if (lang === "nl") {
    const day = names(dutchNames, "en");
    phrases.push(
      { pattern: new RegExp(`^(?:elke\\s+dag|dagelijks)${repeatEdge}`, "iu"), rule: () => ({ kind: "daily" }) },
      { pattern: new RegExp(`^(?:doordeweeks|elke\\s+werkdag|werkdagen)${repeatEdge}`, "iu"), rule: () => ({ kind: "weekdays" }) },
      { pattern: new RegExp(`^(?:elk\\s+weekend|in\\s+het\\s+weekend)${repeatEdge}`, "iu"), rule: () => ({ kind: "weekly", weekdays: [0, 6] }) },
      { pattern: new RegExp(`^elke\\s+((?:${day})(?:\\s*(?:,|&)?\\s*(?:${day}))*)${repeatEdge}`, "iu"), rule: (match) => weekly(listDays(match[1], dutchNames)) },
      { pattern: new RegExp(`^elke\\s+maand\\s+op\\s+de\\s+(\\d{1,2})e?${repeatEdge}`, "iu"), rule: (match) => monthly(match[1]) },
    );
  }
  return phrases;
}

/**
 * A repeat's time, as a to-do's alert reads it: an hour said without a part of the day (`3시`, `at 3`,
 * `om 3 uur`, `3 uur`) from 1 to 6 is the afternoon (the quick-add rule); `오전/오후`, am/pm and 's ochtends…
 * decide when given; `9:00` is as written. A bare number is no time.
 */
function readRepeatTime(text: string, lang: Lang): { time: string; start: number; end: number } | undefined {
  const spokenHour = (hour: number, pm: boolean | undefined) => {
    if (pm === true) return hour < 12 ? hour + 12 : hour;
    if (pm === false) return hour === 12 ? 0 : hour;
    if (hour === 24) return 0;
    return hour >= 1 && hour <= 6 ? hour + 12 : hour;
  };
  const rules: { pattern: RegExp; read: (g: Record<string, string | undefined>) => { hour: number; minute: number } | undefined }[] = [];
  if (lang === "en") {
    rules.push(
      { pattern: new RegExp(`${edge}(?:at\\s+)?(?<h>\\d{1,2})(?::(?<m>\\d{2}))?\\s*(?<ap>[ap])\\.?m\\.?${edgeAfter}`, "iu"), read: (g) => (Number(g.h) >= 1 && Number(g.h) <= 12 ? { hour: spokenHour(Number(g.h), g.ap!.toLowerCase() === "p"), minute: Number(g.m ?? 0) } : undefined) },
      { pattern: new RegExp(`${edge}at\\s+(?<h>\\d{1,2})(?::(?<m>\\d{2}))?(?:\\s*o['’]clock)?${edgeAfter}`, "iu"), read: (g) => ({ hour: g.m === undefined ? spokenHour(Number(g.h), undefined) : Number(g.h), minute: Number(g.m ?? 0) }) },
    );
  }
  if (lang === "nl") {
    rules.push({
      pattern: new RegExp(`${edge}(?<om>om\\s+)?(?<h>\\d{1,2})(?:(?<colon>:)(?<m>\\d{2})|u(?<u>\\d{2})?|\\s+uur)(?:\\s+(?<p>['’]s\\s*(?:ochtends|morgens|middags|avonds|nachts)))?${edgeAfter}`, "iu"),
      read: (g) => {
        const pm = g.p ? /(?:middags|avonds)$/i.test(g.p) || (/nachts$/i.test(g.p) && Number(g.h) >= 7 && Number(g.h) <= 11) : undefined;
        const asWritten = g.colon !== undefined && !g.om && pm === undefined;
        return { hour: asWritten ? Number(g.h) : spokenHour(Number(g.h), g.p ? pm : undefined), minute: Number(g.m ?? g.u ?? 0) };
      },
    });
  }
  rules.push(
    {
      pattern: new RegExp(`${edge}(?:(?<p>${koreanPeriod})\\s?)?(?<h>\\d{1,2})시(?:\\s?(?<half>반)|\\s?(?<m>\\d{1,2})분)?${edgeAfter}`, "u"), // i18n-ok
      read: (g) => ({ hour: spokenHour(Number(g.h), periodOf(g.p)), minute: g.half ? 30 : Number(g.m ?? 0) }),
    },
    { pattern: new RegExp(`${edge}(?:(?<p>${koreanPeriod})\\s?)?(?<h>\\d{1,2}):(?<m>\\d{2})${edgeAfter}`, "u"), read: (g) => ({ hour: g.p ? spokenHour(Number(g.h), periodOf(g.p)) : Number(g.h), minute: Number(g.m) }) },
  );
  for (const rule of rules) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const time = rule.read(match.groups ?? {});
    if (!time || time.hour < 0 || time.hour > 23 || time.minute > 59) continue;
    return { time: `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`, start: match.index, end: match.index + match[0].length };
  }
  return undefined;
}

/** "매주 월 9시 주간 회의" → every Monday, 09:00, "주간 회의"; undefined when the line doesn't start with a repeat or nothing is left as the title. */
export function readRepeat(text: string, lang: Lang = "ko"): { rule: RepeatRule; time?: string; title: string } | undefined {
  const line = text.trim().replace(/\s+/g, " ");
  for (const phrase of repeatPhrases(lang)) {
    const match = phrase.pattern.exec(line);
    if (!match) continue;
    const rule = phrase.rule(match);
    if (!rule || !isValidRule(rule)) return undefined;
    let rest = line.slice(match[0].length).trim();
    const time = readRepeatTime(rest, lang);
    if (time) rest = `${rest.slice(0, time.start)} ${rest.slice(time.end)}`;
    const title = rest.replace(/\s+/g, " ").trim();
    return title ? { rule, ...(time ? { time: time.time } : {}), title } : undefined;
  }
  return undefined;
}

/** A repeat an event can keep: every day, every week on one day, every month on a date; else undefined. */
export function eventRepeatOf(rule: RepeatRule): EventRepeatKind | undefined {
  if (rule.kind === "daily") return "daily";
  if (rule.kind === "weekly" && rule.weekdays?.length === 1) return "weekly";
  if (rule.kind === "monthly") return "monthly";
  return undefined;
}

/** The repeating event of a repeat reading (its first day on or after today), when an event can keep the rule. */
function repeatEvent(read: { rule: RepeatRule; time?: string; title: string }, now: Date): Candidate | undefined {
  const repeat = eventRepeatOf(read.rule);
  const first = repeat ? nextOccurrence(read.rule, now) : undefined;
  if (!repeat || !first) return undefined;
  const day = dateKey(first);
  if (!read.time) return { kind: "event", title: read.title, day, start: 540, end: 600, allDay: true, repeat };
  const [hour, minute] = read.time.split(":").map(Number);
  const start = hour * 60 + minute;
  return { kind: "event", title: read.title, day, start, end: (start + 60) % 1440, allDay: false, repeat };
}

/** The candidates of a repeat line: the repeating to-do, the line as a to-do, and the repeating event (first when the title names an event). */
function repeatCandidates(read: { rule: RepeatRule; time?: string; title: string }, text: string, now: Date, lang: Lang): Candidate[] {
  const repeat: Candidate = { kind: "repeat", title: read.title, rule: read.rule, ...(read.time ? { time: read.time } : {}) };
  const named = hasEventWord(read.title, lang);
  const event = read.time || named ? repeatEvent(read, now) : undefined;
  const todo = quickRead(text, now, lang).todo;
  if (event && named) return [event, repeat, todo];
  return event ? [repeat, todo, event] : [repeat, todo];
}

// ─── Reading a line ───────────────────────────────────────────────────────────

const eventWords: Record<Lang, string[]> = {
  ko: ["회의", "미팅", "약속", "진료", "병원", "치과", "점심", "저녁", "식사", "면접", "수업", "강의", "상담", "예약", "모임", "생일", "결혼식", "여행", "콘서트", "영화"], // i18n-ok
  en: ["meeting", "call", "appointment", "lunch", "dinner", "interview", "class", "lecture", "doctor", "dentist", "party", "birthday", "wedding", "trip", "concert", "movie"],
  nl: ["afspraak", "vergadering", "meeting", "overleg", "lunch", "diner", "etentje", "sollicitatie", "les", "college", "dokter", "tandarts", "feest", "verjaardag", "bruiloft", "reis", "concert", "film"],
};

/** The title names an event (회의, meeting, tandarts…): a Korean word anywhere in it (every language), an English or Dutch one as a whole word. */
export function hasEventWord(title: string, lang: Lang = "ko"): boolean {
  const lower = title.toLowerCase();
  if (eventWords.ko.some((word) => lower.includes(word))) return true;
  if (lang === "ko") return false;
  const words = new Set(lower.split(/[^\p{L}]+/u).filter(Boolean));
  return eventWords[lang].some((word) => words.has(word));
}

const minutesOf = (date: Date) => date.getHours() * 60 + date.getMinutes();

/** The to-do of the quick-add reading of `text`, and the event that goes with it (a time: an hour; a day: all day). */
function quickRead(text: string, now: Date, lang: Lang): { todo: Candidate; event?: Candidate; timed: boolean; title: string } {
  const parse = parseQuick(text, now, lang);
  const title = parse.title.trim();
  if (parse.range) {
    // A range: the to-do keeps it (and its reminder and day); the event takes the same hours.
    const { day, start, end } = parse.range;
    return {
      todo: { kind: "todo", title, ...(parse.reminderAt ? { reminderAt: parse.reminderAt } : {}), ...(parse.dueDate ? { dueDate: parse.dueDate } : {}), range: { day, start, end } },
      event: { kind: "event", title, day, start, end, allDay: false },
      timed: true, title,
    };
  }
  if (parse.reminderAt) {
    const start = minutesOf(parse.reminderAt);
    return {
      todo: { kind: "todo", title, reminderAt: parse.reminderAt },
      event: { kind: "event", title, day: dateKey(parse.reminderAt), start, end: (start + 60) % 1440, allDay: false },
      timed: true, title,
    };
  }
  if (parse.dueDate) return { todo: { kind: "todo", title, dueDate: parse.dueDate }, event: { kind: "event", title, day: parse.dueDate, start: 540, end: 600, allDay: true }, timed: false, title };
  return { todo: { kind: "todo", title }, timed: false, title };
}

/** The key a learned preference is kept under: the first word of the first line's quick-add title, lowercased, without punctuation or symbols around it. */
export function preferenceKey(text: string, now = new Date(), lang: Lang = "ko"): string | undefined {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  if (!line) return undefined;
  const word = parseQuick(line, now, lang).title.trim().split(/\s+/)[0] ?? "";
  const key = word.toLowerCase().replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, "");
  return key || undefined;
}

/** A slashed line: only that kind, or nothing when it can't be read. */
function slashCandidates(kind: IntentKind, rest: string, now: Date, lang: Lang): Candidate[] {
  if (!rest) return [];
  switch (kind) {
    case "memo": return [{ kind: "memo", text: rest }];
    case "todo": return [quickRead(rest, now, lang).todo];
    case "event": {
      const read = quickRead(rest, now, lang);
      if (read.event) return [read.event];
      const slot = nextSlot(now);
      return [{ kind: "event", title: read.title, day: slot.date, start: slot.minutes, end: (slot.minutes + 60) % 1440, allDay: false }];
    }
    case "timer": {
      const minutes = parseDuration(rest, lang);
      return minutes !== undefined ? [{ kind: "timer", minutes }] : [];
    }
    case "alarm": {
      const alarm = readAlarmBody(rest, lang);
      return alarm ? [{ kind: "alarm", ...alarm }] : [];
    }
    case "repeat": {
      const read = readRepeat(rest, lang);
      return read ? [{ kind: "repeat", title: read.title, rule: read.rule, ...(read.time ? { time: read.time } : {}) }] : [];
    }
  }
}

/**
 * What a typed line means, best first: at least one candidate for any text that isn't blank,
 * except a slashed line that can't be read (then none, and `intentProblem` says why).
 */
export function readIntent(text: string, now = new Date(), lang: Lang = "ko", prefer: IntentPrefer = {}): Candidate[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const slash = slashOf(trimmed, lang);
  if (slash) return slashCandidates(slash.kind, slash.rest, now, lang);
  let candidates: Candidate[];
  if (trimmed.includes("\n")) {
    candidates = [{ kind: "memo", text: trimmed }, quickRead(trimmed.split("\n")[0].trim(), now, lang).todo];
  } else {
    const timer = readTimer(trimmed, lang);
    const alarm = timer ? undefined : readAlarm(trimmed, lang);
    const repeat = timer || alarm ? undefined : readRepeat(trimmed, lang);
    if (timer) candidates = [{ kind: "timer", ...timer }, quickRead(trimmed, now, lang).todo];
    else if (alarm) candidates = [{ kind: "alarm", ...alarm }, quickRead(trimmed, now, lang).todo];
    else if (repeat) candidates = repeatCandidates(repeat, trimmed, now, lang);
    else {
      const read = quickRead(trimmed, now, lang);
      if (read.event) candidates = read.timed && hasEventWord(read.title, lang) ? [read.event, read.todo] : [read.todo, read.event];
      else candidates = [read.todo, { kind: "memo", text: trimmed }];
    }
  }
  const key = preferenceKey(trimmed, now, lang);
  const wanted = key ? prefer[key] : undefined;
  const index = wanted ? candidates.findIndex((candidate) => candidate.kind === wanted) : -1;
  if (index > 0) candidates = [candidates[index], ...candidates.slice(0, index), ...candidates.slice(index + 1)];
  return candidates;
}

// ─── Learning ─────────────────────────────────────────────────────────────────

/**
 * What the line has learned: `prefer` the kinds that go first, `streak` a switch to a kind not yet
 * made twice, `order` the keys oldest first (at most 200; the oldest key goes with its preference and streak).
 */
export interface IntentMemory { prefer: IntentPrefer; streak: Record<string, { kind: IntentKind; count: number }>; order: string[] }

export const emptyIntentMemory: IntentMemory = { prefer: {}, streak: {}, order: [] };

/** At most this many keys are kept. */
export const intentMemoryLimit = 200;

/**
 * 바꾸기 (the toast's switch) from `from` to `to` for `key`: the second switch in a row to the same
 * kind makes it the preference; switching away from a learned kind forgets it at once.
 */
export function learnSwitch(memory: IntentMemory, key: string | undefined, from: IntentKind, to: IntentKind): IntentMemory {
  if (!key || from === to) return memory;
  const prefer: IntentPrefer = { ...memory.prefer };
  const streak = { ...memory.streak };
  if (prefer[key] === from) {
    delete prefer[key];
    delete streak[key];
  } else if (streak[key]?.kind === to) {
    const count = streak[key].count + 1;
    if (count >= 2) {
      prefer[key] = to;
      delete streak[key];
    } else streak[key] = { kind: to, count };
  } else streak[key] = { kind: to, count: 1 };
  let order = [...memory.order.filter((entry) => entry !== key), key].filter((entry) => entry in prefer || entry in streak);
  while (order.length > intentMemoryLimit) {
    const [oldest, ...others] = order;
    delete prefer[oldest];
    delete streak[oldest];
    order = others;
  }
  return { prefer, streak, order };
}

// ─── Words ────────────────────────────────────────────────────────────────────

const index = (lang: Lang) => ["ko", "en", "nl"].indexOf(lang);

/** 0 for the logical (4 a.m.) today, 1 for tomorrow, else undefined. */
function dayOffset(date: Date, now: Date): number | undefined {
  const today = logicalDayStart(now);
  const base = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = Math.round((day.getTime() - base.getTime()) / 86_400_000);
  return offset === 0 || offset === 1 ? offset : undefined;
}

const fromKey = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** "오늘" · "today" · "vandaag" (1: "내일" · "tomorrow" · "morgen"), lowercased in English and Dutch. */
const relativeWord = (offset: number, lang: Lang) => (lang === "ko" ? dayWord(offset, lang)! : dayWord(offset, lang)!.toLowerCase());

/** A reminder's time: "15:00" on today's day, "내일 15:00" · "tomorrow 3:00 PM" · "morgen 15:00", else "10월 12일 (월) 15:00" · "Mon, Oct 12 3:00 PM" · "ma 12 okt 15:00". */
function whenText(at: Date, now: Date, lang: Lang): string {
  const time = clock(at.getHours(), at.getMinutes(), lang);
  const offset = dayOffset(at, now);
  if (offset === 0) return time;
  return `${offset === 1 ? relativeWord(1, lang) : shortDate(at, lang)} ${time}`;
}

/** A to-do's range with its day: "오늘 14:00–15:30" · "today 2:00–3:30 PM" · "vandaag 14:00–15:30"; "내일 …"; else "10월 12일 (월) 14:00–15:30". */
const rangeWhen = (range: { day: string; start: number; end: number }, now: Date, lang: Lang): string => rangeWhenText(range.day, range, now, lang);

/** An event's day: "오늘(목)" · "내일(금)" · "10월 12일 (월)"; en "today (Thu)" · "tomorrow (Fri)" · "Mon, Oct 12"; nl "vandaag (do)" · "morgen (vr)" · "ma 12 okt". */
function eventDay(date: Date, now: Date, lang: Lang): string {
  const offset = dayOffset(date, now);
  if (offset === undefined) return shortDate(date, lang);
  const weekday = weekdayShort(date.getDay(), lang);
  return lang === "ko" ? `${relativeWord(offset, lang)}(${weekday})` : `${relativeWord(offset, lang)} (${weekday})`;
}

const kindWords: Record<Lang, Record<IntentKind, string>> = {
  ko: { todo: "할 일", event: "일정", timer: "타이머", alarm: "알람", memo: "메모", repeat: "반복 할 일" },
  en: { todo: "To-do", event: "Event", timer: "Timer", alarm: "Alarm", memo: "Note", repeat: "Repeating to-do" },
  nl: { todo: "Taak", event: "Afspraak", timer: "Timer", alarm: "Wekker", memo: "Notitie", repeat: "Herhalende taak" },
};

/** A repeat's rule as the chip says it: "매주 월", "매일", "평일"; en/nl in lower case mid-sentence ("every Mon", "werkdagen"). */
export function ruleText(rule: RepeatRule, lang: Lang = "ko"): string {
  const text = describe(rule, undefined, lang);
  return lang === "ko" ? text : text[0].toLowerCase() + text.slice(1);
}

/** "매주 월 09:00", "every day", "elke ma 09:00": the rule and, when given, the time. */
function repeatWhen(rule: RepeatRule, time: string | undefined, lang: Lang): string {
  if (!time) return ruleText(rule, lang);
  const [hour, minute] = time.split(":").map(Number);
  return `${ruleText(rule, lang)} ${clock(hour, minute, lang)}`;
}

/** The rule a repeating event keeps, for its chip: the event's own day decides the weekday or the date. */
function eventRule(repeat: EventRepeatKind, day: string): RepeatRule {
  const date = fromKey(day);
  if (repeat === "weekly") return { kind: "weekly", weekdays: [date.getDay()] };
  if (repeat === "monthly") return { kind: "monthly", monthDay: date.getDate() };
  return { kind: "daily" };
}
/** A kind's name: "할 일", "To-do", "Taak"… */
export const kindName = (kind: IntentKind, lang: Lang = "ko"): string => kindWords[lang][kind];

/** The alarm's days and time: "평일 오전 7:00" · "weekdays 7:00 AM" · "doordeweeks 07:00"; once: its next ring's day, "내일 오전 7:00". */
export function alarmWhen(alarm: Pick<Alarm, "time" | "days">, now: Date, lang: Lang = "ko"): string {
  const time = timeText(alarm, lang);
  if (alarm.days.length === 0) {
    const stamp = new Date(now.getTime() - 60_000).toISOString();
    const next = nextFire({ id: "x", label: "", enabled: true, sound: "bell", snooze: 10, createdAt: stamp, updatedAt: stamp, time: alarm.time, days: [] }, now);
    const offset = next ? dayOffset(next, now) : undefined;
    return offset !== undefined ? `${relativeWord(offset, lang)} ${time}` : time;
  }
  const days = daysText(alarm.days, lang);
  // "Every day", "Weekdays" read mid-sentence; weekday lists stay as daysText writes them.
  const generic = lang !== "ko" && (alarm.days.length === 7 || days === daysText([1, 2, 3, 4, 5], lang) || days === daysText([0, 6], lang));
  return `${generic ? days[0].toLowerCase() + days.slice(1) : days} ${time}`;
}

/** The all-day words: "10월 9일 종일" · "Oct 9 all day" · "9 okt hele dag". */
function allDayText(day: Date, lang: Lang): string {
  return `${dayMonth(day.getMonth() + 1, day.getDate(), undefined, lang)} ${["종일", "all day", "hele dag"][index(lang)]}`;
}

/**
 * A candidate as its chip says it: "할 일 · 알림 15:00", "할 일 · 마감 10월 9일", "일정 · 내일(금) 15:00–16:00",
 * "일정 · 10월 9일 종일", "40분 타이머 시작", "알람 · 평일 오전 7:00", "메모로 남기기" (and in English and Dutch).
 */
export function chipText(candidate: Candidate, now = new Date(), lang: Lang = "ko"): string {
  const name = kindName(candidate.kind, lang);
  switch (candidate.kind) {
    case "todo": {
      if (candidate.range) return `${name} · ${rangeWhen(candidate.range, now, lang)}`;
      if (candidate.reminderAt) return `${name} · ${["알림", "reminder", "herinnering"][index(lang)]} ${whenText(candidate.reminderAt, now, lang)}`;
      if (candidate.dueDate) {
        const due = fromKey(candidate.dueDate);
        return `${name} · ${["마감", "due", "deadline"][index(lang)]} ${dayMonth(due.getMonth() + 1, due.getDate(), undefined, lang)}`;
      }
      return name;
    }
    case "event": {
      const day = fromKey(candidate.day);
      if (candidate.repeat) {
        const head = ["반복 일정", "Repeating event", "Herhalende afspraak"][index(lang)];
        const rule = ruleText(eventRule(candidate.repeat, candidate.day), lang);
        if (candidate.allDay) return `${head} · ${rule} ${["종일", "all day", "hele dag"][index(lang)]}`;
        return `${head} · ${rule} ${timeRange({ hour: Math.floor(candidate.start / 60), minute: candidate.start % 60 }, { hour: Math.floor(candidate.end / 60), minute: candidate.end % 60 }, lang)}`;
      }
      if (candidate.allDay) return `${name} · ${allDayText(day, lang)}`;
      const range = timeRange({ hour: Math.floor(candidate.start / 60), minute: candidate.start % 60 }, { hour: Math.floor(candidate.end / 60), minute: candidate.end % 60 }, lang);
      return `${name} · ${eventDay(day, now, lang)} ${range}`;
    }
    case "timer": {
      const length = durationText(candidate.minutes, lang);
      // With a title it is a focus on that task (stage 4): "25분 집중 · 보고서".
      if (candidate.title) return [`${length} 집중 · ${candidate.title}`, `Focus ${length} · ${candidate.title}`, `${length} focussen · ${candidate.title}`][index(lang)];
      return [`${length} 타이머 시작`, `Start a ${length} timer`, `Timer van ${length} starten`][index(lang)];
    }
    case "alarm": return `${name} · ${alarmWhen(candidate, now, lang)}`;
    case "memo": return ["메모로 남기기", "Save as a note", "Bewaren als notitie"][index(lang)];
    case "repeat": return `${name} · ${repeatWhen(candidate.rule, candidate.time, lang)}`;
  }
}

/** "오늘 15:00" · "내일 15:00" · "10월 12일 (월) 15:00" (en "today 3:00 PM"…): when a made to-do or event comes. */
function madeWhen(at: Date, now: Date, lang: Lang): string {
  return dayOffset(at, now) === 0 ? `${relativeWord(0, lang)} ${clock(at.getHours(), at.getMinutes(), lang)}` : whenText(at, now, lang);
}

/**
 * The toast after a candidate was put in: "일정으로 넣었어요 · 내일 15:00", "할 일로 넣었어요", "40분 타이머를 시작했어요",
 * "알람을 맞췄어요 · 평일 오전 7:00", "메모 서랍에 넣었어요"; en "Added as an event · tomorrow 3:00 PM"…; nl "Toegevoegd als afspraak · morgen 15:00"….
 */
export function addedText(candidate: Candidate, now = new Date(), lang: Lang = "ko"): string {
  const i = index(lang);
  switch (candidate.kind) {
    case "todo": {
      const head = ["할 일로 넣었어요", "Added as a to-do", "Toegevoegd als taak"][i];
      if (candidate.range) return `${head} · ${rangeWhen(candidate.range, now, lang)}`;
      if (candidate.reminderAt) return `${head} · ${madeWhen(candidate.reminderAt, now, lang)}`;
      if (candidate.dueDate) {
        const due = fromKey(candidate.dueDate);
        return `${head} · ${["마감", "due", "deadline"][i]} ${dayMonth(due.getMonth() + 1, due.getDate(), undefined, lang)}`;
      }
      return head;
    }
    case "event": {
      if (candidate.repeat) {
        const head = ["반복 일정으로 넣었어요", "Added as a repeating event", "Toegevoegd als herhalende afspraak"][i];
        const rule = ruleText(eventRule(candidate.repeat, candidate.day), lang);
        return candidate.allDay ? `${head} · ${rule} ${["종일", "all day", "hele dag"][i]}` : `${head} · ${rule} ${clock(Math.floor(candidate.start / 60), candidate.start % 60, lang)}`;
      }
      const head = ["일정으로 넣었어요", "Added as an event", "Toegevoegd als afspraak"][i];
      const day = fromKey(candidate.day);
      if (candidate.allDay) return `${head} · ${allDayText(day, lang)}`;
      return `${head} · ${madeWhen(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, candidate.start), now, lang)}`;
    }
    case "timer": {
      const length = durationText(candidate.minutes, lang);
      if (candidate.title) return [`${length} 집중을 시작했어요 · ${candidate.title}`, `Focusing for ${length} · ${candidate.title}`, `${length} focus gestart · ${candidate.title}`][i];
      return [`${length} 타이머를 시작했어요`, `Started a ${length} timer`, `Timer van ${length} gestart`][i];
    }
    case "alarm": return `${["알람을 맞췄어요", "Alarm set", "Wekker gezet"][i]} · ${alarmWhen(candidate, now, lang)}`;
    // 1.28: memos live in the 메모 서랍 (the note's memo tab is gone).
    case "memo": return ["메모 서랍에 넣었어요", "Added to the notes drawer", "In de notitielade gezet"][i];
    case "repeat": return `${["반복 할 일로 넣었어요", "Added as a repeating to-do", "Toegevoegd als herhalende taak"][i]} · ${repeatWhen(candidate.rule, candidate.time, lang)}`;
  }
}

const switchWords: Record<Lang, Record<IntentKind, string>> = {
  ko: { todo: "할 일로 바꾸기", event: "일정으로 바꾸기", timer: "타이머로 바꾸기", alarm: "알람으로 바꾸기", memo: "메모로 바꾸기", repeat: "반복 할 일로 바꾸기" },
  en: { todo: "Make it a to-do", event: "Make it an event", timer: "Make it a timer", alarm: "Make it an alarm", memo: "Make it a note", repeat: "Make it a repeating to-do" },
  nl: { todo: "Maak er een taak van", event: "Maak er een afspraak van", timer: "Maak er een timer van", alarm: "Maak er een wekker van", memo: "Maak er een notitie van", repeat: "Maak er een herhalende taak van" },
};
/** The toast's switch: "할 일로 바꾸기", "Make it a to-do", "Maak er een taak van". */
export const switchText = (kind: IntentKind, lang: Lang = "ko"): string => switchWords[lang][kind];
