import { dayKey, logicalDayStart } from "./archive";
import { key as dueKey, fromKey } from "./deadline";
import type { Lang } from "./lang";
import type { TodoItem } from "./notebook";
import { pageOf } from "./shelf";

/**
 * Carrying work forward (편의 기능 A): the 어제부터 / 3일째 tag on tasks that stayed on 오늘 past a day,
 * the date moves (내일 · 이번 주 금요일 · 다음 주 월요일 · 언젠가) and the one-day shifts. The same rules and
 * cases as the macOS app (convenience-cases.md §1–2).
 */

const validKey = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && fromKey(value) !== undefined;

/** The logical (4 a.m.) day `now` falls on, as a calendar date at noon. */
function today(now: Date): Date {
  const start = logicalDayStart(now);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 12);
}

const plusDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, 12);

/** A task the 어제부터 tag can be on: open, not a repeating copy, without a deadline, on 오늘. */
export function tracked(item: TodoItem, now: Date): boolean {
  return !item.isCompleted && !item.seriesID && !item.dueDate && pageOf(item, now) === "today";
}

/**
 * The bookkeeping on `todaySince`: a tracked task without a (valid, not future) day gets today's; an
 * untracked one loses its day. Only the tasks that change are returned.
 */
export function todaySinceUpdates(items: readonly TodoItem[], now: Date): { id: string; todaySince?: string }[] {
  const day = dayKey(now);
  const changes: { id: string; todaySince?: string }[] = [];
  for (const item of items) {
    if (tracked(item, now)) {
      if (!validKey(item.todaySince) || item.todaySince > day) changes.push({ id: item.id, todaySince: day });
    } else if (item.todaySince !== undefined) changes.push({ id: item.id });
  }
  return changes;
}

/** How many days ago a tracked task came onto 오늘 (0: today), or undefined when it isn't tracked. */
export function carriedDays(item: TodoItem, now: Date): number | undefined {
  if (!tracked(item, now) || !validKey(item.todaySince)) return undefined;
  const since = fromKey(item.todaySince)!;
  const days = Math.round((today(now).getTime() - since.getTime()) / 86_400_000);
  return days > 0 ? days : 0;
}

/** "어제부터" · "since yesterday" · "sinds gisteren"; "3일째" · "3 days" · "3 dagen"; nothing on its first day. */
export function carriedText(days: number | undefined, lang: Lang = "ko"): string | undefined {
  if (!days || days < 1) return undefined;
  if (days === 1) return lang === "ko" ? "어제부터" : lang === "en" ? "since yesterday" : "sinds gisteren";
  const count = days + 1;
  return lang === "ko" ? `${count}일째` : lang === "en" ? `${count} days` : `${count} dagen`;
}

// ─── Moving a date ────────────────────────────────────────────────────────────

export type MoveKind = "tomorrow" | "friday" | "nextMonday" | "someday" | "pick";
export interface MoveChoice { kind: MoveKind; /** The new due date ("yyyy-MM-dd"); none for 언젠가 and 날짜 고르기…. */ day?: string; title: string }

const moveTitles: Record<Lang, Record<MoveKind, string>> = {
  ko: { tomorrow: "내일", friday: "이번 주 금요일", nextMonday: "다음 주 월요일", someday: "언젠가", pick: "날짜 고르기…" },
  en: { tomorrow: "Tomorrow", friday: "This Friday", nextMonday: "Next Monday", someday: "Someday", pick: "Pick a date…" },
  nl: { tomorrow: "Morgen", friday: "Deze vrijdag", nextMonday: "Volgende maandag", someday: "Ooit", pick: "Datum kiezen…" },
};
export const moveTitle = (kind: MoveKind, lang: Lang = "ko"): string => moveTitles[lang][kind];

/** The logical day after `now`'s, "yyyy-MM-dd". */
export const tomorrowKey = (now: Date): string => dueKey(plusDays(today(now), 1));

/**
 * 날짜 바꾸기 ▸: 내일 · 이번 주 금요일 (Monday to Thursday only) · 다음 주 월요일 (the first Monday after
 * today, left out when that is tomorrow) · 언젠가 · 날짜 고르기….
 */
export function moveChoices(now: Date, lang: Lang = "ko"): MoveChoice[] {
  const day = today(now);
  const weekday = day.getDay();
  const tomorrow = dueKey(plusDays(day, 1));
  const choices: MoveChoice[] = [{ kind: "tomorrow", day: tomorrow, title: moveTitle("tomorrow", lang) }];
  if (weekday >= 1 && weekday <= 4) choices.push({ kind: "friday", day: dueKey(plusDays(day, 5 - weekday)), title: moveTitle("friday", lang) });
  const monday = dueKey(plusDays(day, ((8 - weekday) % 7) || 7));
  if (monday !== tomorrow) choices.push({ kind: "nextMonday", day: monday, title: moveTitle("nextMonday", lang) });
  choices.push({ kind: "someday", title: moveTitle("someday", lang) }, { kind: "pick", title: moveTitle("pick", lang) });
  return choices;
}

/**
 * Alt+→ / Alt+← on a selected task: its due date a day later or earlier. It starts from the due date
 * when that is after today, else from today; it never goes before today (undefined: no change).
 */
export function shiftedDue(item: TodoItem, delta: 1 | -1, now: Date): string | undefined {
  const day = today(now);
  const todayKey = dueKey(day);
  const start = item.dueDate && validKey(item.dueDate) && item.dueDate > todayKey ? fromKey(item.dueDate)! : day;
  if (delta < 0 && dueKey(start) <= todayKey) return undefined;
  return dueKey(plusDays(start, delta));
}

/** The toast after a move: "내일로 옮겼어요" for tomorrow; another day as 앞으로 says it (see ahead.ts movedText). */
export function movedTomorrowText(lang: Lang = "ko"): string {
  return lang === "ko" ? "내일로 옮겼어요" : lang === "en" ? "Moved to tomorrow" : "Verplaatst naar morgen";
}
