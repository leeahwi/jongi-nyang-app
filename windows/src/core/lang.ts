/**
 * The app's languages: Korean (the source), English and Dutch. Every text the core makes takes one
 * (default Korean). Dates and times are written by hand here, never through the OS locale, so the
 * Windows and macOS apps say exactly the same thing. Same helpers and test cases as the macOS app
 * (AppLanguage.swift). Weekdays are 0 = Sunday … 6 = Saturday, months 1…12.
 */
export type Lang = "ko" | "en" | "nl";
export const langs: readonly Lang[] = ["ko", "en", "nl"];
/** The language setting (prefs `language`): automatic, or one language. */
export type LanguageSetting = "auto" | Lang;

/** 0, 1, 2 — for tables written ko, en, nl. */
export const langIndex = (lang: Lang): number => langs.indexOf(lang);

/**
 * The language setting ("auto", "ko", "en", "nl") as a language. Automatic: the first of the
 * system's preferred languages ("nl-NL", "en_GB", "ko"…) that the app speaks, else English.
 */
export function resolveLang(setting: string | undefined, preferred: readonly string[]): Lang {
  if (setting && (langs as readonly string[]).includes(setting)) return setting as Lang;
  for (const code of preferred) {
    const prefix = code.toLowerCase().split(/[-_]/)[0];
    if ((langs as readonly string[]).includes(prefix)) return prefix as Lang;
  }
  return "en";
}

/** The language's own name, for the setting: "한국어", "English", "Nederlands". */
export const nativeName: Record<Lang, string> = { ko: "한국어", en: "English", nl: "Nederlands" };

/** Korean and English weeks start on Sunday, Dutch weeks on Monday (the month grid, the week view). */
export const weekStartsMonday = (lang: Lang): boolean => lang === "nl";

/** The days of a week row in order, 0 = Sunday … 6 = Saturday. */
export const weekdayOrder = (lang: Lang): number[] => (weekStartsMonday(lang) ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6]);

const weekdayShorts: Record<Lang, readonly string[]> = {
  ko: ["일", "월", "화", "수", "목", "금", "토"],
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  nl: ["zo", "ma", "di", "wo", "do", "vr", "za"],
};
const weekdayNames: Record<Lang, readonly string[]> = {
  ko: ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"],
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  nl: ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"],
};
const koreanMonths = Array.from({ length: 12 }, (_, index) => `${index + 1}월`);
const monthShorts: Record<Lang, readonly string[]> = {
  ko: koreanMonths,
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  nl: ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"],
};
const monthNames: Record<Lang, readonly string[]> = {
  ko: koreanMonths,
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  nl: ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"],
};

const wrap7 = (weekday: number) => ((weekday % 7) + 7) % 7;
const pad = (value: number) => String(value).padStart(2, "0");
const twelve = (hour: number) => hour % 12 || 12;

/** "일", "Sun", "zo" */
export const weekdayShort = (weekday: number, lang: Lang = "ko"): string => weekdayShorts[lang][wrap7(weekday)];
/** "일요일", "Sunday", "zondag" */
export const weekdayName = (weekday: number, lang: Lang = "ko"): string => weekdayNames[lang][wrap7(weekday)];
/** For a grid's narrow heading: "일", "S", "zo". */
export const weekdayLetter = (weekday: number, lang: Lang = "ko"): string =>
  lang === "en" ? ["S", "M", "T", "W", "T", "F", "S"][wrap7(weekday)] : weekdayShort(weekday, lang);
/** "10월", "Oct", "okt" */
export const monthShort = (month: number, lang: Lang = "ko"): string => monthShorts[lang][(month - 1 + 12) % 12];
/** "10월", "October", "oktober" */
export const monthName = (month: number, lang: Lang = "ko"): string => monthNames[lang][(month - 1 + 12) % 12];

// ─── Times ───────────────────────────────────────────────────────────────────

/** 24-hour or 12-hour: the app follows the system's setting (Windows' short time, the Mac's "24-hour time"). */
export type HourCycle = "h24" | "h12";

/**
 * The clock every time in the app is written with, set by the main process at launch from the system (main.ts
 * `systemHourCycle`) and handed to each window by the preload (`paper.hourCycle`). Unset: each language's fixed
 * format from before — ko and nl 24-hour, en 12-hour, a time in a Korean sentence "오후 3:00" — which the shared
 * test cases are written in (tests that check another clock set it, and set it back). Same as AppLanguage.hourCycle.
 */
let hourCycleSetting: HourCycle | undefined = fromPreload();

function fromPreload(): HourCycle | undefined {
  const value = (globalThis as { paper?: { hourCycle?: unknown } }).paper?.hourCycle;
  return value === "h24" || value === "h12" ? value : undefined;
}

export function setHourCycle(cycle: HourCycle | undefined): void {
  hourCycleSetting = cycle;
}

/** The app's clock as set (undefined: each language's own). */
export const hourCycleSet = (): HourCycle | undefined => hourCycleSetting;

/** A language's clock now: the app's cycle, else the language's own (en 12-hour, ko and nl 24-hour). */
export const hourCycle = (lang: Lang = "ko"): HourCycle => hourCycleSetting ?? (lang === "en" ? "h12" : "h24");

/** The 12-hour clock's word for the half of the day: "오전" · "오후", "AM" · "PM", "a.m." · "p.m.". */
export function period(hour: number, lang: Lang = "ko"): string {
  const am = hour < 12;
  return lang === "ko" ? (am ? "오전" : "오후") : lang === "en" ? (am ? "AM" : "PM") : am ? "a.m." : "p.m.";
}

/** Korean says the half first ("오후 3:00"), English and Dutch after ("3:00 PM", "3:00 p.m."). */
export const periodFirst = (lang: Lang = "ko"): boolean => lang === "ko";

const twelveDigits = (hour: number, minute: number) => `${twelve(hour)}:${pad(minute)}`;
const withPeriod = (digits: string, hour: number, lang: Lang) => (periodFirst(lang) ? `${period(hour, lang)} ${digits}` : `${digits} ${period(hour, lang)}`);

/** The clock: "09:30" (24-hour), or "오전 9:30" · "9:30 AM" · "9:30 a.m." (12-hour). Unset: ko and nl "09:30", en "9:30 AM". */
export function clock(hour: number, minute: number, lang: Lang = "ko"): string {
  return hourCycle(lang) === "h12" ? withPeriod(twelveDigits(hour, minute), hour, lang) : `${pad(hour)}:${pad(minute)}`;
}

/** A time as said in a sentence: the clock ("15:00", "오후 3:00", "3:00 PM"). Unset, Korean says "오후 3:00" as before. */
export function spokenTime(hour: number, minute: number, lang: Lang = "ko"): string {
  if (hourCycleSetting === undefined && lang === "ko") return withPeriod(twelveDigits(hour, minute), hour, lang);
  return clock(hour, minute, lang);
}

/**
 * From–to: "10:00–11:00"; on the 12-hour clock one half-of-day word when both share it: "3:00–4:00 PM",
 * "오후 3:00–4:00", "11:30 AM–12:30 PM".
 */
export function timeRange(start: { hour: number; minute: number }, end: { hour: number; minute: number }, lang: Lang = "ko"): string {
  if (hourCycle(lang) === "h12" && (start.hour < 12) === (end.hour < 12)) return withPeriod(`${twelveDigits(start.hour, start.minute)}–${twelveDigits(end.hour, end.minute)}`, start.hour, lang);
  return `${clock(start.hour, start.minute, lang)}–${clock(end.hour, end.minute, lang)}`;
}

/** "40분 뒤", "in 40 min", "over 40 min" */
export function minutesAway(minutes: number, lang: Lang = "ko"): string {
  return lang === "ko" ? `${minutes}분 뒤` : lang === "en" ? `in ${minutes} min` : `over ${minutes} min`;
}

const dayWords: Record<Lang, Record<string, string>> = {
  ko: { "0": "오늘", "1": "내일", "-1": "어제" },
  en: { "0": "Today", "1": "Tomorrow", "-1": "Yesterday" },
  nl: { "0": "Vandaag", "1": "Morgen", "-1": "Gisteren" },
};

/** Today, tomorrow, yesterday (offset 0, 1, -1) as a word starting a label: "오늘", "Today", "Vandaag"; undefined for other days. */
export const dayWord = (offset: number, lang: Lang = "ko"): string | undefined => dayWords[lang][String(offset)];

// ─── Dates ───────────────────────────────────────────────────────────────────

/** "10월 8일", "Oct 8", "8 okt" — with the year when given: "2027년 1월 2일", "Jan 2, 2027", "2 jan 2027". */
export function dayMonth(month: number, day: number, year?: number, lang: Lang = "ko"): string {
  if (lang === "ko") return `${year !== undefined ? `${year}년 ` : ""}${month}월 ${day}일`;
  if (lang === "en") return `${monthShort(month, lang)} ${day}${year !== undefined ? `, ${year}` : ""}`;
  return `${day} ${monthShort(month, lang)}${year !== undefined ? ` ${year}` : ""}`;
}

/** The short date: "10월 8일 (목)", "Thu, Oct 8", "do 8 okt" (with the year: "Sat, Jan 2, 2027"). */
export function shortDate(date: Date, lang: Lang = "ko", withYear = false): string {
  const day = dayMonth(date.getMonth() + 1, date.getDate(), withYear ? date.getFullYear() : undefined, lang);
  const weekday = weekdayShort(date.getDay(), lang);
  return lang === "ko" ? `${day} (${weekday})` : lang === "en" ? `${weekday}, ${day}` : `${weekday} ${day}`;
}

/** The long date (a note's header, the day panel): "10월 8일 목요일", "Thursday, October 8", "donderdag 8 oktober". */
export function longDate(date: Date, lang: Lang = "ko"): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const weekday = weekdayName(date.getDay(), lang);
  if (lang === "ko") return `${month}월 ${day}일 ${weekday}`;
  if (lang === "en") return `${weekday}, ${monthName(month, lang)} ${day}`;
  return `${weekday} ${day} ${monthName(month, lang)}`;
}

/** "2026년 10월", "October 2026", "oktober 2026" (`month` 1–12). */
export function monthTitle(year: number, month: number, lang: Lang = "ko"): string {
  return lang === "ko" ? `${year}년 ${month}월` : `${monthName(month, lang)} ${year}`;
}

/**
 * A week: "10월 4일 – 10일" · "Oct 4 – 10" · "4 – 10 okt"; across months "Sep 27 – Oct 3" · "27 sep – 3 okt";
 * across years with both years: "Dec 27, 2026 – Jan 2, 2027" · "27 dec 2026 – 2 jan 2027".
 */
export function weekTitle(first: Date, last: Date, lang: Lang = "ko"): string {
  const [ay, am, ad] = [first.getFullYear(), first.getMonth() + 1, first.getDate()];
  const [by, bm, bd] = [last.getFullYear(), last.getMonth() + 1, last.getDate()];
  if (ay !== by) return `${dayMonth(am, ad, ay, lang)} – ${dayMonth(bm, bd, by, lang)}`;
  if (am !== bm) return `${dayMonth(am, ad, undefined, lang)} – ${dayMonth(bm, bd, undefined, lang)}`;
  if (lang === "ko") return `${am}월 ${ad}일 – ${bd}일`;
  if (lang === "en") return `${monthShort(am, lang)} ${ad} – ${bd}`;
  return `${ad} – ${bd} ${monthShort(am, lang)}`;
}

// ─── Counts ──────────────────────────────────────────────────────────────────

/** "3 days" — the count and the singular or plural noun (English and Dutch). */
export const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** "3일", "1 day" / "3 days", "1 dag" / "3 dagen" */
export function days(count: number, lang: Lang = "ko"): string {
  return lang === "ko" ? `${count}일` : lang === "en" ? plural(count, "day", "days") : plural(count, "dag", "dagen");
}

/** "할 일 3개", "1 to-do" / "3 to-dos", "1 taak" / "3 taken" */
export function todos(count: number, lang: Lang = "ko"): string {
  return lang === "ko" ? `할 일 ${count}개` : lang === "en" ? plural(count, "to-do", "to-dos") : plural(count, "taak", "taken");
}
