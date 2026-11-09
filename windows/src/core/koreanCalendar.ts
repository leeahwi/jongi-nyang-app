import { langIndex, type Lang } from "./lang";

/**
 * 음력과 공휴일 (#234): the Korean lunar date of a day and Korea's public holidays, worked out on the PC with no network.
 * The lunar calendar is ICU's Korean one (`dangi`, Korea's own months — the Chinese calendar differs on a few days, e.g. it
 * puts 설날 2027 a day late), asked through `Intl.DateTimeFormat`; the Mac asks the same ICU calendar through NSCalendar
 * (PaperCore/KoreanCalendar.swift), and the two agree on every day of 2020–2035 (the cases' FNV-1a). Holidays follow
 * 관공서의 공휴일에 관한 규정 (substitute days for 설날 · 추석 since 2014, 어린이날 since 2014, 삼일절 · 광복절 · 개천절 ·
 * 한글날 since 2021, 부처님오신날 · 성탄절 since 4 May 2023); one-off days (elections, temporary holidays) can't be worked
 * out, so the known ones are listed and new ones come with app updates. Shared cases: docs/plans/calendar-korean-cases.json.
 */

export interface Lunar { month: number; day: number; leap: boolean }

const lunarFormat = new Intl.DateTimeFormat("en-u-ca-dangi", { timeZone: "Asia/Seoul", month: "numeric", day: "numeric" });
const lunarCache = new Map<string, Lunar | undefined>();

/** The noon of a calendar day ("yyyy-MM-dd") in Korea. */
const seoulNoon = (day: string): Date => new Date(`${day}T12:00:00+09:00`);

/** The lunar date of a calendar day, as Korea counts it (Korea's time), whatever the PC's zone. */
export function lunarOf(day: string): Lunar | undefined {
  if (lunarCache.has(day)) return lunarCache.get(day);
  let found: Lunar | undefined;
  const date = seoulNoon(day);
  if (!Number.isNaN(date.getTime())) {
    const parts = Object.fromEntries(lunarFormat.formatToParts(date).map((part) => [part.type, part.value]));
    const month = parseInt(parts.month ?? "", 10), dayOf = parseInt(parts.day ?? "", 10);
    if (Number.isFinite(month) && Number.isFinite(dayOf)) found = { month, day: dayOf, leap: (parts.month ?? "").endsWith("bis") };
  }
  if (lunarCache.size > 4000) lunarCache.clear();
  lunarCache.set(day, found);
  return found;
}

/**
 * The small label in a day's cell: "9.18"; the 1st of a lunar month marked — "음 9.1", "윤 4.1" (a leap month); en · nl "☾ 9.1".
 * #295 `short`: without the mark ("10.1"), where the head is short of room (+N beside it).
 */
export function lunarLabel(lunar: Lunar, lang: Lang = "ko", short = false): string {
  if (lunar.day !== 1 || short) return `${lunar.month}.${lunar.day}`;
  return lang === "ko" ? `${lunar.leap ? "윤" : "음"} ${lunar.month}.1` : `☾ ${lunar.month}.1`;
}

/** Its spoken form and tooltip: "음력 9월 18일", "음력 윤4월 1일" — en "Lunar 9/18", nl "Maankalender 18-9". */
export function lunarSpoken(lunar: Lunar, lang: Lang = "ko"): string {
  if (lang === "en") return `Lunar ${lunar.leap ? "leap " : ""}${lunar.month}/${lunar.day}`;
  if (lang === "nl") return `Maankalender ${lunar.leap ? "schrikkel " : ""}${lunar.day}-${lunar.month}`;
  return `음력 ${lunar.leap ? "윤" : ""}${lunar.month}월 ${lunar.day}일`;
}

// ─── Holidays ─────────────────────────────────────────────────────────────────

export type HolidayName =
  | "newYear" | "seollal" | "independence" | "children" | "buddha" | "memorial" | "liberation" | "chuseok" | "foundation" | "hangul"
  | "christmas" | "substitute" | "election" | "temporary";

const holidayWords: Record<HolidayName, [string, string, string]> = {
  newYear: ["신정", "New Year’s Day", "Nieuwjaarsdag"],
  seollal: ["설날", "Seollal", "Seollal"],
  independence: ["삼일절", "Independence Movement Day", "Onafhankelijkheidsdag"],
  children: ["어린이날", "Children’s Day", "Kinderdag"],
  buddha: ["부처님오신날", "Buddha’s Birthday", "Boeddha’s verjaardag"],
  memorial: ["현충일", "Memorial Day", "Herdenkingsdag"],
  liberation: ["광복절", "Liberation Day", "Bevrijdingsdag"],
  chuseok: ["추석", "Chuseok", "Chuseok"],
  foundation: ["개천절", "National Foundation Day", "Stichtingsdag"],
  hangul: ["한글날", "Hangul Day", "Hangeuldag"],
  christmas: ["성탄절", "Christmas Day", "Eerste kerstdag"],
  substitute: ["대체공휴일", "Substitute holiday", "Vervangende vrije dag"],
  election: ["선거일", "Election Day", "Verkiezingsdag"],
  temporary: ["임시공휴일", "Extra holiday", "Extra vrije dag"],
};

/** "삼일절", "Independence Movement Day", "Onafhankelijkheidsdag". */
export const holidayName = (name: HolidayName, lang: Lang = "ko"): string => holidayWords[name][langIndex(lang)];

/**
 * #260: the names as a month cell draws them — English and Dutch with soft hyphens (U+00AD) where a name may break onto
 * a second line ("Han-/geuldag"), the same places as on the Mac (docs/plans/calendar-flows-cases.json); Korean as it is.
 */
const holidayBreaks: Record<HolidayName, [string, string]> = {
  newYear: ["New Year’s Day", "Nieuw|jaars|dag"],
  seollal: ["Seol|lal", "Seol|lal"],
  independence: ["In|de|pen|dence Move|ment Day", "On|af|han|ke|lijk|heids|dag"],
  children: ["Chil|dren’s Day", "Kin|der|dag"],
  buddha: ["Bud|dha’s Birth|day", "Boed|dha’s ver|jaar|dag"],
  memorial: ["Me|mo|ri|al Day", "Her|den|kings|dag"],
  liberation: ["Lib|er|a|tion Day", "Be|vrij|dings|dag"],
  chuseok: ["Chu|seok", "Chu|seok"],
  foundation: ["Na|tion|al Foun|da|tion Day", "Stich|tings|dag"],
  hangul: ["Han|gul Day", "Han|geul|dag"],
  christmas: ["Christ|mas Day", "Eer|ste kerst|dag"],
  substitute: ["Sub|sti|tute hol|i|day", "Ver|van|gen|de vrije dag"],
  election: ["Elec|tion Day", "Ver|kie|zings|dag"],
  temporary: ["Ex|tra hol|i|day", "Ex|tra vrije dag"],
};

/** #260: `holidayName` with the places it may break (`holidayBreaks`). */
export const holidayShown = (name: HolidayName, lang: Lang = "ko"): string =>
  lang === "ko" ? holidayName(name, lang) : holidayBreaks[name][lang === "en" ? 0 : 1].replace(/\|/g, "\u00ad");

/** Days off that no rule gives: elections and temporary holidays, 2020–2026. New ones come with app updates. */
export const oneOffHolidays: Readonly<Record<string, HolidayName>> = {
  "2020-04-15": "election", "2020-08-17": "temporary", "2022-03-09": "election", "2022-06-01": "election",
  "2023-10-02": "temporary", "2024-04-10": "election", "2024-10-01": "temporary", "2025-01-27": "temporary",
  "2025-06-03": "election", "2026-06-03": "election",
};

const pad = (n: number) => String(n).padStart(2, "0");
/** The day `count` days after (or before), on the plain Gregorian calendar (no time zone involved). */
export function shiftDay(day: string, count: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + count));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
/** 0 = Sunday … 6 = Saturday. */
function weekdayOf(day: string): number {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The day of the year whose lunar date is that day of that month (not a leap month). */
function solarOf(lunarMonth: number, lunarDay: number, year: number): string | undefined {
  let day = `${year}-01-01`;
  for (let i = 0; i < 366 && day.startsWith(`${year}-`); i++) {
    const lunar = lunarOf(day);
    if (lunar && lunar.month === lunarMonth && lunar.day === lunarDay && !lunar.leap) return day;
    day = shiftDay(day, 1);
  }
  return undefined;
}

const yearCache = new Map<number, Map<string, HolidayName[]>>();

/** Every holiday of a year, by day ("yyyy-MM-dd") — a day may have two (어린이날 and 부처님오신날 in 2025). */
export function holidaysOf(year: number): ReadonlyMap<string, HolidayName[]> {
  const known = yearCache.get(year);
  if (known) return known;
  const days = new Map<string, HolidayName[]>();
  const add = (day: string, name: HolidayName) => days.set(day, [...(days.get(day) ?? []), name]);
  const key = (month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
  // Fixed days.
  const fixed: [number, number, HolidayName][] = [[1, 1, "newYear"], [3, 1, "independence"], [5, 5, "children"], [6, 6, "memorial"],
    [8, 15, "liberation"], [10, 3, "foundation"], [10, 9, "hangul"], [12, 25, "christmas"]];
  for (const [month, day, name] of fixed) add(key(month, day), name);
  // Lunar days: 설날 (the day before, the day, the day after), 부처님오신날, 추석 (the 14th to the 16th).
  const seollal = solarOf(1, 1, year), buddha = solarOf(4, 8, year), chuseok = solarOf(8, 15, year);
  const seollalDays = seollal ? [shiftDay(seollal, -1), seollal, shiftDay(seollal, 1)] : [];
  const chuseokDays = chuseok ? [shiftDay(chuseok, -1), chuseok, shiftDay(chuseok, 1)] : [];
  for (const day of seollalDays) add(day, "seollal");
  if (buddha) add(buddha, "buddha");
  for (const day of chuseokDays) add(day, "chuseok");
  for (const [day, name] of Object.entries(oneOffHolidays)) if (day.startsWith(`${year}-`)) add(day, name);

  // 대체공휴일: each day off a holiday falls on gives one substitute, the first weekday after the holiday (after the three
  // days of 설날 · 추석) that is no holiday; a day two holidays share counts once (2017 추석 · 개천절, 2025 어린이날 ·
  // 부처님오신날: one day each).
  const taken = new Set(days.keys());
  const next = (after: string) => {
    let candidate = shiftDay(after, 1);
    while (weekdayOf(candidate) === 0 || weekdayOf(candidate) === 6 || taken.has(candidate)) candidate = shiftDay(candidate, 1);
    return candidate;
  };
  const others = (day: string, name: HolidayName) => (days.get(day) ?? []).some((other) => other !== name);
  const overlaps = new Map<string, string>();
  const note = (day: string, after: string) => overlaps.set(day, [overlaps.get(day) ?? "", after].sort()[1]);
  if (year >= 2014) {
    for (const [block, name] of [[seollalDays, "seollal"], [chuseokDays, "chuseok"]] as [string[], HolidayName][]) {
      // A Sunday or another holiday in the three days (not a Saturday).
      for (const day of block) if (weekdayOf(day) === 0 || others(day, name)) note(day, block[block.length - 1]);
    }
  }
  const weekend: [string, HolidayName, number][] = [[key(5, 5), "children", 2014], [key(3, 1), "independence", 2021], [key(8, 15), "liberation", 2021],
    [key(10, 3), "foundation", 2021], [key(10, 9), "hangul", 2021], [key(12, 25), "christmas", 2023]];
  if (buddha) weekend.push([buddha, "buddha", 2023]);
  for (const [day, name, since] of weekend) {
    if (year < since) continue;
    // 부처님오신날 · 성탄절: from 4 May 2023 (부처님오신날 2023 is the first).
    if ((name === "buddha" || name === "christmas") && day < "2023-05-04") continue;
    // A Saturday, a Sunday or another holiday on the day.
    if (weekdayOf(day) === 0 || weekdayOf(day) === 6 || others(day, name)) note(day, day);
  }
  for (const after of [...overlaps.values()].sort()) {
    const day = next(after);
    add(day, "substitute");
    taken.add(day);
  }
  yearCache.set(year, days);
  return days;
}

/** The holidays on a day, in the order the year lists them. */
export function holidaysOn(day: string): HolidayName[] {
  const year = parseInt(day.slice(0, 4), 10);
  return Number.isFinite(year) ? holidaysOf(year).get(day) ?? [] : [];
}

/** "어린이날 · 부처님오신날", undefined for a day that is no holiday; `shown` (#260): as a month cell draws it (`holidayShown`). */
export function holidayLabel(day: string, lang: Lang = "ko", shown = false): string | undefined {
  const names = holidaysOn(day);
  return names.length ? names.map((name) => (shown ? holidayShown : holidayName)(name, lang)).join(" · ") : undefined;
}
