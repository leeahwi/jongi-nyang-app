import { isoDate, newID } from "./notebook";
import { dayWord, spokenTime, weekdayName, weekdayOrder, weekdayShort, type Lang } from "./lang";

/**
 * 시계 알람: alarms.json in the storage folder (a shared folder shares it), `{ "alarms": [Alarm…] }`.
 * Every running device rings its own and keeps which rings it handled (per device, three days).
 * Times are local wall-clock times; days are 0 = Sunday … 6 = Saturday, none = once. Same rules
 * and test cases as the macOS app (Alarm.swift).
 */

export type AlarmSound = "bell" | "soft" | "silent";
export const alarmSounds: readonly AlarmSound[] = ["bell", "soft", "silent"];
export const snoozeChoices: readonly number[] = [5, 10, 15];
/** The editor's 다시 울림: 없음 (0, no snooze: the ring has only 끄기) or 5 · 10 · 15 minutes. */
export const snoozeSettings: readonly number[] = [0, ...snoozeChoices];

export interface Alarm {
  id: string;
  /** "HH:mm", 24-hour. */
  time: string;
  /** May be "". */
  label: string;
  /** 0 = Sunday … 6 = Saturday, sorted; empty = once (then `enabled` goes off after it rang). */
  days: number[];
  enabled: boolean;
  sound: AlarmSound;
  /** Minutes: 5, 10 or 15; 0 = no snooze (older builds read 0 as 10). */
  snooze: number;
  /** ISO 8601, whole seconds, "Z". */
  createdAt: string;
  updatedAt: string;
}

/** How long after its time a ring still comes (the computer was asleep): 15 minutes. */
export const lateWindowMs = 15 * 60_000;
/** Handled rings are kept this long. */
export const handledDays = 3;

const pad = (value: number) => String(value).padStart(2, "0");
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/** "7:5", "07:05" → "07:05"; anything else undefined. */
export function normalTime(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return undefined;
  const hour = Number(match[1]), minute = Number(match[2]);
  return hour < 24 && minute < 60 ? `${pad(hour)}:${pad(minute)}` : undefined;
}

/** The hour and minute of "HH:mm". */
export function timeParts(alarm: Pick<Alarm, "time">): { hour: number; minute: number } {
  const [hour, minute] = (normalTime(alarm.time) ?? "07:00").split(":").map(Number);
  return { hour, minute };
}

/** Days as kept: whole numbers 0…6, each once, in order. */
export function normalDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((day): day is number => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
}

/** One alarm from the file, with defaults for what is missing; undefined without an id or a readable time. */
export function readAlarm(raw: unknown): Alarm | undefined {
  if (!isObject(raw) || typeof raw.id !== "string" || !raw.id) return undefined;
  const time = normalTime(raw.time);
  if (!time) return undefined;
  const stamp = (value: unknown) => (typeof value === "string" && isoPattern.test(value) ? value.replace(/\.\d+Z$/, "Z") : undefined);
  const createdAt = stamp(raw.createdAt) ?? stamp(raw.updatedAt) ?? "1970-01-01T00:00:00Z";
  return {
    id: raw.id,
    time,
    label: typeof raw.label === "string" ? raw.label : "",
    days: normalDays(raw.days),
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : true,
    sound: alarmSounds.includes(raw.sound as AlarmSound) ? raw.sound as AlarmSound : "bell",
    snooze: snoozeSettings.includes(raw.snooze as number) ? raw.snooze as number : 10,
    createdAt,
    updatedAt: stamp(raw.updatedAt) ?? createdAt,
  };
}

/** alarms.json read; throws when the file isn't `{ "alarms": [...] }` (the app then keeps it aside). Broken entries are skipped. */
export function parseAlarms(text: string): Alarm[] {
  const value = JSON.parse(text) as unknown;
  if (!isObject(value) || !Array.isArray(value.alarms)) throw new Error("alarms missing");
  const seen = new Set<string>();
  const alarms: Alarm[] = [];
  for (const raw of value.alarms) {
    const alarm = readAlarm(raw);
    if (!alarm || seen.has(alarm.id)) continue;
    seen.add(alarm.id);
    alarms.push(alarm);
  }
  return alarms;
}

/** Keys in order, two-space indent, a newline at the end (like events.json). */
export function serializeAlarms(alarms: readonly Alarm[]): string {
  const entries = alarms.map((alarm) => ({
    createdAt: alarm.createdAt, days: [...alarm.days], enabled: alarm.enabled, id: alarm.id, label: alarm.label,
    snooze: alarm.snooze, sound: alarm.sound, time: alarm.time, updatedAt: alarm.updatedAt,
  }));
  return JSON.stringify({ alarms: entries }, null, 2) + "\n";
}

/** `+ 알람 추가`: 07:00 on weekdays, on, the bell, 10-minute snooze. */
export function newAlarm(now = new Date(), id = newID()): Alarm {
  const stamp = isoDate(now);
  return { id, time: "07:00", label: "", days: [1, 2, 3, 4, 5], enabled: true, sound: "bell", snooze: 10, createdAt: stamp, updatedAt: stamp };
}

// ─── When it rings ────────────────────────────────────────────────────────────

/** The alarm's time on the day of `day` (local; a time skipped by a change of clocks moves on with it). */
function onDay(alarm: Alarm, day: Date): Date {
  const { hour, minute } = timeParts(alarm);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
}

const allowed = (alarm: Alarm, date: Date) => alarm.days.length === 0 || alarm.days.includes(date.getDay());

/** A ring's key in the handled set: "<id>@<yyyy-MM-ddTHH:mm>" (local). */
export function alarmKey(alarm: Pick<Alarm, "id">, fire: Date): string {
  return `${alarm.id}@${fire.getFullYear()}-${pad(fire.getMonth() + 1)}-${pad(fire.getDate())}T${pad(fire.getHours())}:${pad(fire.getMinutes())}`;
}

/**
 * The next time it rings, at or after `now` (a ring at exactly `now` that is already handled
 * doesn't count): on the next allowed day; a once-alarm today if its time is still ahead, else
 * tomorrow. Undefined when it is off.
 */
export function nextFire(alarm: Alarm, now: Date, handled: ReadonlySet<string> = new Set()): Date | undefined {
  if (!alarm.enabled) return undefined;
  for (let offset = 0; offset <= 8; offset += 1) {
    const fire = onDay(alarm, new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset));
    if (!allowed(alarm, fire) || fire.getTime() < now.getTime()) continue;
    if (fire.getTime() === now.getTime() && handled.has(alarmKey(alarm, fire))) continue;
    return fire;
  }
  return undefined;
}

/** The latest time it was set to ring at or before `now` (any day for a once-alarm), whether or not it is on. */
export function lastFire(alarm: Alarm, now: Date): Date | undefined {
  for (let offset = 0; offset <= 8; offset += 1) {
    const fire = onDay(alarm, new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset));
    if (allowed(alarm, fire) && fire.getTime() <= now.getTime()) return fire;
  }
  return undefined;
}

/**
 * The alarms to ring now: on, with their latest ring time f in `now − 15 min < f ≤ now`, not yet
 * handled here, and not before the alarm was last changed (an alarm set at 7:05 for 7:00 waits
 * for tomorrow). One missed by more than 15 minutes (the computer asleep) is skipped.
 */
export function due(alarms: readonly Alarm[], now: Date, handled: ReadonlySet<string>): Alarm[] {
  return alarms.filter((alarm) => {
    if (!alarm.enabled) return false;
    const fire = lastFire(alarm, now);
    if (!fire || fire.getTime() <= now.getTime() - lateWindowMs) return false;
    const changed = Date.parse(alarm.updatedAt);
    if (Number.isFinite(changed) && fire.getTime() < changed) return false;
    return !handled.has(alarmKey(alarm, fire));
  });
}

/** The soonest ring of all the alarms that are on, and which. */
export function nextAlarm(alarms: readonly Alarm[], now: Date, handled: ReadonlySet<string> = new Set()): { alarm: Alarm; at: Date } | undefined {
  let best: { alarm: Alarm; at: Date } | undefined;
  for (const alarm of alarms) {
    const at = nextFire(alarm, now, handled);
    if (at && (!best || at.getTime() < best.at.getTime())) best = { alarm, at };
  }
  return best;
}

/** The handled keys still worth keeping: rings of the last three days. */
export function pruneHandled(keys: readonly string[], now: Date): string[] {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - handledDays).getTime();
  return keys.filter((key) => {
    const match = key.match(/@(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
    return match !== null && new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5])).getTime() >= cutoff;
  });
}

// ─── Words ────────────────────────────────────────────────────────────────────

const dayWords: Record<Lang, { once: string; daily: string; weekdays: string; weekends: string; join: string }> = {
  ko: { once: "한 번", daily: "매일", weekdays: "평일", weekends: "주말", join: "·" },
  en: { once: "Once", daily: "Every day", weekdays: "Weekdays", weekends: "Weekends", join: ", " },
  nl: { once: "Eenmalig", daily: "Elke dag", weekdays: "Doordeweeks", weekends: "Weekend", join: ", " },
};

/**
 * The days in words: "한 번" · "매일" · "평일" · "주말" · "월·수·금"; en "Once" · "Every day" ·
 * "Weekdays" · "Weekends" · "Mon, Wed, Fri"; nl "Eenmalig" · "Elke dag" · "Doordeweeks" ·
 * "Weekend" · "ma, wo, vr" (Dutch weeks start on Monday: "ma, za, zo").
 */
export function daysText(days: readonly number[], lang: Lang = "ko"): string {
  const words = dayWords[lang];
  const set = new Set(normalDays([...days]));
  const is = (list: number[]) => set.size === list.length && list.every((day) => set.has(day));
  if (set.size === 0) return words.once;
  if (set.size === 7) return words.daily;
  if (is([1, 2, 3, 4, 5])) return words.weekdays;
  if (is([0, 6])) return words.weekends;
  return weekdayOrder(lang).filter((day) => set.has(day)).map((day) => weekdayShort(day, lang)).join(words.join);
}

/** "오전 7:00" · "오후 7:30"; en "7:00 AM"; nl "07:00". */
export function timeText(alarm: Pick<Alarm, "time">, lang: Lang = "ko"): string {
  const { hour, minute } = timeParts(alarm);
  return spokenTime(hour, minute, lang);
}

/**
 * When it rings, from `now`: "7시간 30분 뒤에 울려요" · "Rings in 7 h 30 min" · "Gaat over 7 u 30 min";
 * under an hour "25분 뒤에 울려요" · "Rings in 25 min" · "Gaat over 25 min"; a day or more ahead the
 * day and the time: "내일 오전 7:00에 울려요" · "Rings tomorrow at 7:00 AM" · "Gaat morgen om 07:00",
 * "금요일 오전 7:00에 울려요" · "Rings Fri at 7:00 AM" · "Gaat vr om 07:00".
 */
export function untilText(next: Date, now: Date, lang: Lang = "ko"): string {
  const ms = next.getTime() - now.getTime();
  if (ms >= 24 * 3_600_000) {
    const days = Math.round((Date.UTC(next.getFullYear(), next.getMonth(), next.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);
    const time = spokenTime(next.getHours(), next.getMinutes(), lang);
    const word = dayWord(days, lang);
    if (lang === "ko") return `${word ?? weekdayName(next.getDay(), lang)} ${time}에 울려요`;
    const day = word ? word.toLowerCase() : weekdayShort(next.getDay(), lang);
    return lang === "en" ? `Rings ${day} at ${time}` : `Gaat ${day} om ${time}`;
  }
  const total = Math.max(1, Math.ceil(ms / 60_000));
  const hours = Math.floor(total / 60), minutes = total % 60;
  const [h, m] = lang === "ko" ? ["시간", "분"] : lang === "en" ? [" h", " min"] : [" u", " min"];
  const span = hours === 0 ? `${minutes}${m}` : minutes === 0 ? `${hours}${h}` : `${hours}${h} ${minutes}${m}`;
  return lang === "ko" ? `${span} 뒤에 울려요` : lang === "en" ? `Rings in ${span}` : `Gaat over ${span}`;
}
