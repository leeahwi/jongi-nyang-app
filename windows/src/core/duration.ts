import type { Lang } from "./lang";

/**
 * 타이머 시간 직접 정하기: a length typed by hand, and the recent custom lengths the timer menus
 * offer. Same rules and test cases as the macOS app (Duration.swift).
 */

/** The longest timer that can be typed, in minutes (3 hours). */
export const maxTimerMinutes = 180;

/** The timer menus' own lengths; a custom length is never one of these. */
export const timerPresets: readonly number[] = [5, 15, 25, 50];

const hourWords = "시간|hours|hour|hrs|hr|h|uur|u";
const minuteWords = "분|minutes|minute|minuten|minuut|mins|min|m";

/**
 * A timer length typed by hand, in minutes (1…180), or undefined. Every language's words are
 * understood whatever the app speaks: `40`, `1:30` (h:mm, two-digit minutes), `40분`, `1시간 30분`,
 * `1시간 반`, `40m`, `40 min`, `90 minutes`, `1h`, `1h 30m`, `1.5h`, `1u`, `1 uur`, `1u 30m`,
 * `anderhalf uur`, `half uur`, `half an hour`. Case and spaces don't matter. Dutch also takes a
 * decimal comma (`1,5 uur`).
 */
export function parseDuration(text: string, lang: Lang = "ko"): number | undefined {
  const value = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!value) return undefined;
  const number = (raw: string) => Number(lang === "nl" ? raw.replace(",", ".") : raw);
  const decimal = lang === "nl" ? "\\d+(?:[.,]\\d+)?" : "\\d+(?:\\.\\d+)?";
  let minutes: number | undefined;
  let match: RegExpMatchArray | null;
  if (/^\d+$/.test(value)) minutes = Number(value);
  else if ((match = value.match(/^(\d+):(\d{2})$/))) minutes = Number(match[2]) < 60 ? Number(match[1]) * 60 + Number(match[2]) : undefined;
  else if ((match = value.match(new RegExp(`^(${decimal}) ?(?:${hourWords})$`)))) minutes = number(match[1]) * 60;
  else if ((match = value.match(new RegExp(`^(\\d+) ?(?:${hourWords}) ?(\\d+) ?(?:${minuteWords})?$`)))) minutes = Number(match[1]) * 60 + Number(match[2]);
  else if ((match = value.match(/^(\d+) ?시간 ?반$/))) minutes = Number(match[1]) * 60 + 30; // i18n-ok: Korean words
  else if ((match = value.match(new RegExp(`^(\\d+) ?(?:${minuteWords})$`)))) minutes = Number(match[1]);
  else minutes = ({ "anderhalf uur": 90, "half uur": 30, "een half uur": 30, "een uur": 60, "één uur": 60, "half an hour": 30, "an hour": 60, "반시간": 30 } as Record<string, number>)[value]; // i18n-ok
  if (minutes === undefined || !Number.isFinite(minutes)) return undefined;
  const rounded = Math.round(minutes);
  return rounded >= 1 && rounded <= maxTimerMinutes ? rounded : undefined;
}

/** A length as the hint under the field says it: "40분" · "1시간 30분" · "2시간"; en "40 min" · "1 h 30 min"; nl "40 min" · "1 u 30 min". */
export function durationText(minutes: number, lang: Lang = "ko"): string {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  const [h, m] = lang === "ko" ? ["시간", "분"] : lang === "en" ? [" h", " min"] : [" u", " min"];
  if (hours === 0) return `${rest}${m}`;
  return rest === 0 ? `${hours}${h}` : `${hours}${h} ${rest}${m}`;
}

/**
 * The recent custom lengths after starting `minutes`: newest first, at most three, never a preset
 * (5 · 15 · 25 · 50) and never out of range. A preset leaves the list as it was.
 */
export function rememberTimer(recent: readonly number[], minutes: number): number[] {
  const valid = (value: number) => Number.isInteger(value) && value >= 1 && value <= maxTimerMinutes && !timerPresets.includes(value);
  if (!valid(minutes)) return recent.filter(valid).slice(0, 3);
  return [minutes, ...recent.filter((value) => value !== minutes && valid(value))].slice(0, 3);
}
