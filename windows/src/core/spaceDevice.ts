import { clock, timeRange, type Lang } from "./lang";
import { findSpace, finalOf, lensForDigit, lensNone, liveSpaces, objectParticle, type TodoSpaces } from "./todoSpaces";

/**
 * 기기마다 보일 스페이스 (#196, docs/plans/spaces-device.md): which spaces this PC shows — 보이기 (no entry), 숨기기,
 * or 시간 정하기 (shown only inside one of its time ranges). A device setting (`prefs.spaceDevice`), never in the shared
 * todo-spaces.json; keyed by space id, `none` for 일반. Pure; the same rules as the Mac's PaperCore/SpaceDevice.swift,
 * checked against the shared cases S60–S72 (`spaces-cases.json` → `device`).
 */

/** 일반's key (the lens's word for it too). */
export const deviceNone = lensNone;
/** D3: at most this many time ranges are read per space. */
export const maxTimes = 12;
/** D14: the desk row and the menu hint use the short form past this many characters. */
export const fitLength = 24;

/**
 * One time range: days 1 Monday … 7 Sunday, from–to in minutes of the day. `to` before `from` runs past midnight (it
 * belongs to the day it starts on); `to === from` is the whole day from `from` (D2).
 */
export interface DeviceTimes { days: number[]; from: number; to: number }
export type DeviceRule = { show: "hide" } | { show: "time"; times: DeviceTimes[] };
export type DeviceRules = Record<string, DeviceRule>;
/** As stored (D5): times as `HH:mm`. */
export type StoredRule = { show: "hide" } | { show: "time"; times: { days: number[]; from: string; to: string }[] };
export type StoredRules = Record<string, StoredRule>;

/** The setting's key for a to-do's space (undefined: 일반). */
export const deviceKey = (space: string | null | undefined): string => space ?? deviceNone;

// ─── Reading and writing the setting (D5) ────────────────────────────────────

/** "09:00" → 540; undefined unless it is `HH:mm` from 00:00 to 23:59. */
export function deviceMinutes(value: unknown): number | undefined {
  if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return undefined;
  const hour = Number(value.slice(0, 2)), minute = Number(value.slice(3));
  return hour < 24 && minute < 60 ? hour * 60 + minute : undefined;
}

/** 540 → "09:00". */
export const clockText = (minutes: number): string => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Days cleaned: 1–7 only, sorted, each once. */
export const cleanDays = (days: readonly number[]): number[] =>
  [...new Set(days.filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort((a, b) => a - b);

/** One range as stored, or undefined when it isn't one (no days, a day outside 1–7, a time not `HH:mm`). */
function readTimes(value: unknown): DeviceTimes | undefined {
  if (!isObject(value) || !Array.isArray(value.days) || value.days.length === 0) return undefined;
  const from = deviceMinutes(value.from), to = deviceMinutes(value.to);
  if (from === undefined || to === undefined) return undefined;
  if (!value.days.every((day) => typeof day === "number" && Number.isInteger(day) && day >= 1 && day <= 7)) return undefined;
  return { days: cleanDays(value.days as number[]), from, to };
}

/** The setting as stored → the rules; anything that doesn't read is left out (shown) (S65). */
export function readDeviceRules(value: unknown): DeviceRules {
  const rules: DeviceRules = {};
  if (!isObject(value)) return rules;
  for (const [key, entry] of Object.entries(value)) {
    if (!key || key.length > 64 || !isObject(entry)) continue;
    if (entry.show === "hide") rules[key] = { show: "hide" };
    else if (entry.show === "time" && Array.isArray(entry.times)) {
      rules[key] = { show: "time", times: entry.times.map(readTimes).filter((times): times is DeviceTimes => times !== undefined).slice(0, maxTimes) };
    }
  }
  return rules;
}

/** The rules as stored (D5's shape), keys sorted. */
export function storedDeviceRules(rules: DeviceRules): StoredRules {
  const out: StoredRules = {};
  for (const key of Object.keys(rules).sort()) {
    const rule = rules[key];
    out[key] = rule.show === "hide" ? { show: "hide" }
      : { show: "time", times: rule.times.map((times) => ({ days: [...times.days], from: clockText(times.from), to: clockText(times.to) })) };
  }
  return out;
}

/** The value a page may send for `prefs.spaceDevice` (ipcCheck): read, then stored again — undefined when it isn't an object. */
export function checkedDeviceRules(value: unknown): StoredRules | undefined {
  return isObject(value) ? storedDeviceRules(readDeviceRules(value)) : undefined;
}

/** S72: entries for spaces the file no longer has at all go; a tombstone's stays (it can be put back), and 일반's. */
export function cleanedDeviceRules(rules: DeviceRules, data: TodoSpaces): DeviceRules {
  const known = new Set(data.spaces.map((space) => space.id));
  return Object.fromEntries(Object.entries(rules).filter(([key]) => key === deviceNone || known.has(key)));
}

// ─── What is hidden now (D1–D4) ──────────────────────────────────────────────

/** D2: whether a range holds `minute` (0–1439) on `day` (1–7). */
export function timesHold(times: DeviceTimes, day: number, minute: number): boolean {
  const yesterday = day === 1 ? 7 : day - 1;
  if (times.from < times.to) return times.days.includes(day) && minute >= times.from && minute < times.to;
  // Past midnight or the whole day: from `from` on its day, and before `to` (or `from`) the day after.
  const until = times.to === times.from ? times.from : times.to;
  return (times.days.includes(day) && minute >= times.from) || (times.days.includes(yesterday) && minute < until);
}

/** D1 · D3: whether a space with `rule` (undefined: 보이기) shows at `minute` on `day`. */
export function ruleShows(rule: DeviceRule | undefined, day: number, minute: number): boolean {
  if (!rule) return true;
  if (rule.show === "hide") return false;
  return rule.times.some((times) => timesHold(times, day, minute));
}

/** D4: a moment on this PC's wall clock — the day (1 Monday … 7 Sunday) and the minute of the day. */
export function deviceMoment(date: Date): { day: number; minute: number } {
  return { day: ((date.getDay() + 6) % 7) + 1, minute: date.getHours() * 60 + date.getMinutes() };
}

/** Whether a space with `rule` shows at `date`. */
export function showsAt(rule: DeviceRule | undefined, date: Date): boolean {
  const { day, minute } = deviceMoment(date);
  return ruleShows(rule, day, minute);
}

/** The keys hidden at `date`: live spaces' ids and `none` (S66). Nothing when there are no live spaces (D1). */
export function hiddenSpaces(rules: DeviceRules, data: TodoSpaces, date = new Date()): Set<string> {
  const out = new Set<string>();
  const keys = Object.keys(rules);
  if (keys.length === 0 || liveSpaces(data).length === 0) return out;
  const { day, minute } = deviceMoment(date);
  for (const key of keys) {
    if ((key === deviceNone || findSpace(data, key)) && !ruleShows(rules[key], day, minute)) out.add(key);
  }
  return out;
}

/** Whether a to-do in `space` (a live space's id; undefined, a gone or deleted one: 일반) is hidden (S66). */
export function isHiddenSpace(space: string | null | undefined, hidden: ReadonlySet<string>, data: TodoSpaces): boolean {
  if (hidden.size === 0) return false;
  return hidden.has(deviceKey(findSpace(data, space)?.id));
}

// ─── The lens (D7, S68) ──────────────────────────────────────────────────────

/** The lens as it shows with `hidden` (what the note hides: hidden less the spaces peeked at): a hidden space's lens lets go. */
export const deviceLens = (lens: string | undefined, hidden: ReadonlySet<string>): string | undefined =>
  (lens !== undefined && hidden.has(lens) ? undefined : lens);

/** Ctrl+Shift+1–9 keep the spaces' order; a hidden space's digit does nothing (null), as a missing one's. */
export function deviceLensForDigit(data: TodoSpaces, digit: number, hidden: ReadonlySet<string>): string | undefined | null {
  const lens = lensForDigit(data, digit);
  return typeof lens === "string" && hidden.has(lens) ? null : lens;
}

// ─── The line at the end of the list (D9, S67) ───────────────────────────────

/**
 * The spaces the end line names: hidden (or peeked at) ones with an open to-do on that tab, in the spaces' order, 일반
 * last. `open` are the tab's open to-dos' keys (`deviceKey` of their live space).
 */
export function lineKeys(open: readonly string[], among: ReadonlySet<string>, data: TodoSpaces): string[] {
  const present = new Set(open.filter((key) => among.has(key)));
  if (present.size === 0) return [];
  return [...liveSpaces(data).map((space) => space.id).filter((id) => present.has(id)), ...(present.has(deviceNone) ? [deviceNone] : [])];
}

// ─── Reminders (D10, S69) ────────────────────────────────────────────────────

/**
 * Whether a to-do's reminder rings here: its space shows now and showed at the reminder's time (by the rule now), and
 * the reminder isn't from before the space was last made visible here (`shownSince`).
 */
export function deviceRings(rule: DeviceRule | undefined, alert: Date, now: Date, shownSince?: Date): boolean {
  if (shownSince && alert.getTime() < shownSince.getTime()) return false;
  return showsAt(rule, now) && showsAt(rule, alert);
}

// ─── 바로 고르기 (the slip's presets) ─────────────────────────────────────────

export type DevicePreset = "workday" | "evening" | "weekend";
export const devicePresets: Record<DevicePreset, { times: DeviceTimes[]; title: Record<Lang, string> }> = {
  workday: { times: [{ days: [1, 2, 3, 4, 5], from: 540, to: 1080 }], title: { ko: "평일 근무 9–18", en: "Workdays 9–6", nl: "Werkdagen 9–18" } },
  evening: { times: [{ days: [1, 2, 3, 4, 5], from: 1140, to: 1380 }], title: { ko: "평일 저녁 19–23", en: "Weekday evenings 7–11", nl: "Doordeweekse avonden 19–23" } },
  weekend: { times: [{ days: [6, 7], from: 0, to: 0 }], title: { ko: "주말", en: "Weekends", nl: "Weekend" } },
};

// ─── Words (D14, §5) ─────────────────────────────────────────────────────────

const dayNames: Record<Lang, string[]> = {
  ko: ["월", "화", "수", "목", "금", "토", "일"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  nl: ["ma", "di", "wo", "do", "vr", "za", "zo"],
};
/** A day's short name (1 Monday … 7 Sunday): 월 · Mon · ma. */
export const dayName = (day: number, lang: Lang = "ko"): string => dayNames[lang][(day - 1) % 7];

const same = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every((value, index) => value === b[index]);

/** D14: 매일 · 평일 · 주말, three or more days in a row `월–목`, else joined with `/` (`월/수/금`, `월–수/금`). */
export function dayWords(days: readonly number[], lang: Lang = "ko"): string {
  const set = cleanDays(days);
  if (same(set, [1, 2, 3, 4, 5, 6, 7])) return { ko: "매일", en: "every day", nl: "elke dag" }[lang];
  if (same(set, [1, 2, 3, 4, 5])) return { ko: "평일", en: "weekdays", nl: "doordeweeks" }[lang];
  if (same(set, [6, 7])) return { ko: "주말", en: "weekends", nl: "weekend" }[lang];
  const parts: string[] = [];
  for (let index = 0; index < set.length;) {
    let end = index;
    while (end + 1 < set.length && set[end + 1] === set[end] + 1) end += 1;
    if (end - index >= 2) parts.push(`${dayName(set[index], lang)}–${dayName(set[end], lang)}`);
    else for (let at = index; at <= end; at += 1) parts.push(dayName(set[at], lang));
    index = end + 1;
  }
  return parts.join("/");
}

/** One range's time in the app's clock: "09:00–18:00", "9:00 AM–6:00 PM"; nothing for `00:00–00:00` (the whole day). */
function timeWords(times: DeviceTimes, lang: Lang): string | undefined {
  if (times.from === times.to && times.from === 0) return undefined;
  return timeRange({ hour: Math.floor(times.from / 60), minute: times.from % 60 }, { hour: Math.floor(times.to / 60), minute: times.to % 60 }, lang);
}

/** The day groups of D14: rows with the same days together, by first day then earliest start; equal rows once. */
function dayGroups(times: readonly DeviceTimes[]): { days: number[]; ranges: DeviceTimes[] }[] {
  const out: { days: number[]; ranges: DeviceTimes[] }[] = [];
  for (const range of times) {
    const group = out.find((entry) => same(entry.days, range.days));
    if (!group) out.push({ days: range.days, ranges: [range] });
    else if (!group.ranges.some((other) => other.from === range.from && other.to === range.to)) group.ranges.push(range);
  }
  for (const group of out) group.ranges.sort((a, b) => a.from - b.from || a.to - b.to);
  return out.sort((a, b) => (a.days[0] ?? 8) - (b.days[0] ?? 8) || (a.ranges[0]?.from ?? 0) - (b.ranges[0]?.from ?? 0));
}

/** D14's long form "평일 09:00–12:00, 13:00–18:00 · 토 10:00–14:00", or the short one "평일 2개 시간대 · 토". */
export function deviceSummary(times: readonly DeviceTimes[], lang: Lang = "ko", short = false): string {
  return dayGroups(times).map((group) => {
    const days = dayWords(group.days, lang);
    const n = group.ranges.length;
    if (short) return n > 1 ? { ko: `${days} ${n}개 시간대`, en: `${days}, ${n} times`, nl: `${days}, ${n} tijden` }[lang] : days;
    const words = group.ranges.map((range) => timeWords(range, lang)).filter((word): word is string => word !== undefined);
    return words.length ? `${days} ${words.join(", ")}` : days;
  }).join(" · ");
}

/** The form the desk row and the menu hint use: the long one, or the short one past `fitLength` characters. */
export function deviceFitting(times: readonly DeviceTimes[], lang: Lang = "ko"): string {
  const long = deviceSummary(times, lang);
  return [...long].length <= fitLength ? long : deviceSummary(times, lang, true);
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The slip's sentence: "평일 09:00–18:00에만 보여요" · "Shown only weekdays …" · "Alleen zichtbaar doordeweeks …". */
export function deviceSentence(times: readonly DeviceTimes[], lang: Lang = "ko"): string {
  const words = deviceSummary(times, lang);
  return { ko: `${words}에만 보여요`, en: `Shown only ${words}`, nl: `Alleen zichtbaar ${words}` }[lang];
}

/** The menu's hint under a time-ruled space: "지금은 숨김 · 평일 09:00–18:00에 보여요" while hidden, else "…에만 보여요". */
export function deviceHint(times: readonly DeviceTimes[], hiddenNow: boolean, lang: Lang = "ko"): string {
  const words = deviceFitting(times, lang);
  if (hiddenNow) return { ko: `지금은 숨김 · ${words}에 보여요`, en: `Hidden now · shows ${words}`, nl: `Nu verborgen · zichtbaar ${words}` }[lang];
  return { ko: `${words}에만 보여요`, en: `Shown only ${words}`, nl: `Alleen zichtbaar ${words}` }[lang];
}

/** The desk row's line under the name: none for 보이기, "이 기기에서 숨겨 뒀어요", or "평일 09:00–18:00에만 · 지금 보여요". */
export function deviceStatus(rule: DeviceRule | undefined, hiddenNow: boolean, lang: Lang = "ko"): string | undefined {
  if (!rule) return undefined;
  if (rule.show === "hide") return { ko: "이 기기에서 숨겨 뒀어요", en: "Hidden on this device", nl: "Verborgen op dit apparaat" }[lang];
  const words = deviceFitting(rule.times, lang);
  if (lang === "ko") return `${words}에만 · ${hiddenNow ? "지금 숨어 있어요" : "지금 보여요"}`;
  if (lang === "en") return `${capitalized(words)} only · ${hiddenNow ? "hidden now" : "showing now"}`;
  return `Alleen ${words} · ${hiddenNow ? "nu verborgen" : "nu zichtbaar"}`;
}

/** The slip's second line: "지금(화 20:10)은 숨어 있어요" · "지금(화 20:10) 보여요". */
export function deviceNowLine(showing: boolean, date: Date, lang: Lang = "ko"): string {
  const { day, minute } = deviceMoment(date);
  const at = `${dayName(day, lang)} ${clock(Math.floor(minute / 60), minute % 60, lang)}`;
  if (lang === "ko") return showing ? `지금(${at}) 보여요` : `지금(${at})은 숨어 있어요`;
  if (lang === "en") return showing ? `Showing now (${at})` : `Hidden now (${at})`;
  return showing ? `Nu zichtbaar (${at})` : `Nu verborgen (${at})`;
}

/** Names as the end line says them: one or two by name, three or more as a count. */
function named(names: readonly string[], lang: Lang): { words: string; many: boolean; last: string } {
  if (names.length >= 3) return { words: { ko: `스페이스 ${names.length}개`, en: `${names.length} spaces`, nl: `${names.length} ruimtes` }[lang], many: true, last: "개" };
  return { words: names.join(" · "), many: names.length > 1, last: names[names.length - 1] ?? "" };
}

/** D9: "회사는 이 기기에서 숨겨 뒀어요" · "Work is hidden on this device" (then 잠깐 보기). */
export function deviceLine(names: readonly string[], lang: Lang = "ko"): string {
  const said = named(names, lang);
  if (lang === "ko") return `${said.words}${finalOf(said.last) === 0 ? "는" : "은"} 이 기기에서 숨겨 뒀어요`;
  if (lang === "en") return `${said.words} ${said.many ? "are" : "is"} hidden on this device`;
  return `${said.words} ${said.many ? "zijn" : "is"} verborgen op dit apparaat`;
}

/** D6: "회사를 잠깐 보는 중" · "Peeking at Work" · "Werk even zichtbaar" (then 다시 숨기기). */
export function devicePeeking(names: readonly string[], lang: Lang = "ko"): string {
  const said = named(names, lang);
  if (lang === "ko") return `${said.words}${objectParticle(said.last)} 잠깐 보는 중`;
  if (lang === "en") return `Peeking at ${said.words}`;
  return `${said.words} even zichtbaar`;
}

export const peekWord = (lang: Lang = "ko"): string => ({ ko: "잠깐 보기", en: "Peek", nl: "Even kijken" })[lang];
export const hideAgainWord = (lang: Lang = "ko"): string => ({ ko: "다시 숨기기", en: "Hide again", nl: "Weer verbergen" })[lang];

/** §5: the words of the desk's popup, the menu and the slip (kept here, with the Mac's SpaceDevice.Words, so the two apps say the same). */
export const deviceWords = {
  onThisDevice: { ko: "이 기기에서", en: "On this device", nl: "Op dit apparaat" },
  show: { ko: "보이기", en: "Show", nl: "Tonen" },
  hide: { ko: "숨기기", en: "Hide", nl: "Verbergen" },
  setTimes: { ko: "시간 정하기…", en: "Set times…", nl: "Tijden instellen…" },
  hideHere: { ko: "이 기기에서 숨기기", en: "Hide on this device", nl: "Verbergen op dit apparaat" },
  hiddenSection: { ko: "이 기기에서 숨김", en: "Hidden on this device", nl: "Verborgen op dit apparaat" },
  alwaysShow: { ko: "늘 보이기", en: "Always show", nl: "Altijd tonen" },
  addTime: { ko: "시간 더하기", en: "Add a time", nl: "Tijd toevoegen" },
  nextDay: { ko: "다음 날", en: "next day", nl: "volgende dag" },
  wholeDay: { ko: "하루 전체", en: "all day", nl: "hele dag" },
  slipNote: { ko: "정한 시간에만 보이고, 다른 때는 숨어요.", en: "Shown only at these times, hidden the rest of the time.", nl: "Alleen zichtbaar op deze tijden, de rest van de tijd verborgen." },
  noDays: { ko: "요일을 고르지 않은 줄이 있어요.", en: "A row has no days picked.", nl: "Bij een rij zijn geen dagen gekozen." },
  removeTime: { ko: "이 시간 빼기", en: "Remove this time", nl: "Deze tijd weghalen" },
  start: { ko: "시작", en: "Start", nl: "Begin" },
  end: { ko: "끝", en: "End", nl: "Eind" },
  hiddenTag: { ko: "숨김", en: "Hidden", nl: "Verborgen" },
} satisfies Record<string, Record<Lang, string>>;

/** The slip's title: "회사를 이 기기에서 보일 시간" · "When Work shows on this device". */
export const deviceSlipTitle = (name: string, lang: Lang = "ko"): string =>
  ({ ko: `${name}${objectParticle(name)} 이 기기에서 보일 시간`, en: `When ${name} shows on this device`, nl: `Wanneer ${name} zichtbaar is op dit apparaat` })[lang];

/** The desk's footer: "‘이 기기에서’는 이 PC에만 저장해요. 다른 기기에서는 그대로 보여요." (`device`: Mac or PC). */
export const deviceDeskFooter = (lang: Lang = "ko", device = "PC"): string =>
  ({
    ko: `‘이 기기에서’는 이 ${device}에만 저장해요. 다른 기기에서는 그대로 보여요.`,
    en: `‘On this device’ is kept on this ${device} only. Other devices still show everything.`,
    nl: `‘Op dit apparaat’ blijft alleen op deze ${device}. Andere apparaten tonen alles nog.`,
  })[lang];

/** The popup's spoken name: "회사, 이 기기에서: 숨기기". */
export function devicePopupLabel(name: string, rule: DeviceRule | undefined, lang: Lang = "ko"): string {
  const picked = !rule ? deviceWords.show : rule.show === "hide" ? deviceWords.hide : deviceWords.setTimes;
  return `${name}, ${deviceWords.onThisDevice[lang]}: ${picked[lang].replace("…", "")}`;
}

/** D12: "회사에 넣었어요 · 이 기기에서는 숨겨져 있어요" (the toast's 되돌리기 follows). */
export const addedHidden = (name: string, lang: Lang = "ko"): string =>
  ({ ko: `${name}에 넣었어요 · 이 기기에서는 숨겨져 있어요`, en: `Added to ${name} · hidden on this device`, nl: `Toegevoegd aan ${name} · verborgen op dit apparaat` })[lang];
