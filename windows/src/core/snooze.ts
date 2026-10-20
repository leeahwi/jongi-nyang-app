import { logicalDayStart } from "./archive";
import type { Lang } from "./lang";

/**
 * 다시 알림 choices (편의 기능 6): the reminder bubble's ⌄ menu — 5분 · 10분 · 30분 · 1시간 뒤, 오늘 저녁 7시 (only
 * before 18:00 of the logical day), 내일 아침 9시, and for a task's own alert 내일로 미루기 (the task moves to
 * tomorrow). Shared cases: convenience-cases.md §3.
 */

export type SnoozeId = "5" | "10" | "30" | "60" | "evening" | "morning" | "tomorrow";
export interface SnoozeChoice { id: SnoozeId; title: string; /** When it comes again (none for 내일로 미루기). */ at?: Date }

const titles: Record<Lang, Record<SnoozeId, string>> = {
  ko: { "5": "5분 뒤", "10": "10분 뒤", "30": "30분 뒤", "60": "1시간 뒤", evening: "오늘 저녁 7시", morning: "내일 아침 9시", tomorrow: "내일로 미루기" },
  en: { "5": "In 5 min", "10": "In 10 min", "30": "In 30 min", "60": "In 1 hour", evening: "Tonight at 7 PM", morning: "Tomorrow at 9 AM", tomorrow: "Move to tomorrow" },
  nl: { "5": "Over 5 min", "10": "Over 10 min", "30": "Over 30 min", "60": "Over 1 uur", evening: "Vanavond om 19:00", morning: "Morgen om 09:00", tomorrow: "Naar morgen" },
};
export const snoozeTitle = (id: SnoozeId, lang: Lang = "ko"): string => titles[lang][id];

/** `now` plus `minutes`, the seconds dropped first (14:50:40 + 10 → 15:00). */
export function inMinutes(now: Date, minutes: number): Date {
  const at = new Date(now);
  at.setSeconds(0, 0);
  return new Date(at.getTime() + minutes * 60_000);
}

/** The choices for a task's alert (`task`) or for the periodic 남은 할 일 nudge (no 내일로 미루기). */
export function snoozeChoices(now: Date, kind: "task" | "periodic", lang: Lang = "ko"): SnoozeChoice[] {
  const start = logicalDayStart(now);
  const day = (offset: number, hour: number) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + offset, hour, 0);
  const choices: SnoozeChoice[] = ([5, 10, 30, 60] as const).map((minutes) => ({ id: String(minutes) as SnoozeId, title: titles[lang][String(minutes) as SnoozeId], at: inMinutes(now, minutes) }));
  if (now.getTime() < day(0, 18).getTime()) choices.push({ id: "evening", title: titles[lang].evening, at: day(0, 19) });
  choices.push({ id: "morning", title: titles[lang].morning, at: day(1, 9) });
  if (kind === "task") choices.push({ id: "tomorrow", title: titles[lang].tomorrow });
  return choices;
}

/** An event's alert: "5분 전에 다시" while that moment is still ahead; when it comes. */
export function eventSnoozeAt(start: Date, now: Date): Date | undefined {
  const at = new Date(start.getTime() - 5 * 60_000);
  return at.getTime() > now.getTime() ? at : undefined;
}
