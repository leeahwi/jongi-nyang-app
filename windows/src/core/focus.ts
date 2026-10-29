import { dayKey } from "./archive";
import { durationText } from "./duration";
import { isoDate } from "./notebook";
import { plural, type Lang } from "./lang";
import { awayText } from "./ribbon";

/**
 * 집중 기록 (focus.jsonl in the storage folder, beside archive/): one JSON line per focus session on a
 * task or per plain timer, appended when it ends (finished, stopped early after at least a minute, or
 * 다 했어요). A Pomodoro writes one line per focus round; breaks are not written. The completion
 * archive is untouched. Same rules and test cases as the macOS app (PaperCore Focus.swift,
 * focus-cases.md).
 *
 *   {"id":"…","taskId":"…","title":"보고서 마무리","start":"2026-10-08T05:00:00Z","end":"2026-10-08T05:25:00Z","minutes":25,"kind":"focus","done":true}
 */

export const focusFileName = "focus.jsonl";

export type FocusKind = "focus" | "timer";

export interface FocusRecord {
  id: string;
  /** The task focused on (absent for a plain timer, or a task since deleted is still named by its id). */
  taskId?: string;
  /** The task's title then ("" for a plain timer). */
  title: string;
  /** Whole-second ISO "Z" (parsed records may carry fractional seconds). */
  start: string;
  end: string;
  /** Minutes actually counted (paused time left out), whole. */
  minutes: number;
  kind: FocusKind;
  /** 다 했어요: the task was checked when the session ended. */
  done: boolean;
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const validTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

/**
 * The records in a focus.jsonl text, in file order. Tolerant: blank and unreadable lines, lines
 * without an id, title, start, end or minutes, and a repeated id are skipped (the first one stays);
 * fractional seconds are fine; an unknown `kind` is "focus" when the line names a task, else "timer";
 * a missing `done` is false; minutes are rounded to whole ones.
 */
export function parseFocus(text: string): FocusRecord[] {
  const records: FocusRecord[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    if (!isObject(value)) continue;
    const { id, taskId, title, start, end, minutes, kind, done } = value;
    if (typeof id !== "string" || !id || seen.has(id) || typeof title !== "string" || !validTime(start) || !validTime(end)) continue;
    if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) continue;
    seen.add(id);
    const task = typeof taskId === "string" && taskId ? taskId : undefined;
    records.push({
      id, ...(task ? { taskId: task } : {}), title, start, end, minutes: Math.round(minutes),
      kind: kind === "focus" || kind === "timer" ? kind : task ? "focus" : "timer",
      done: done === true,
    });
  }
  return records;
}

/** One line of the file (no newline), keys in the order above. */
export function focusLine(record: FocusRecord): string {
  const { id, taskId, title, start, end, minutes, kind, done } = record;
  return JSON.stringify({ id, ...(taskId ? { taskId } : {}), title, start, end, minutes, kind, done });
}

/**
 * A record for a session that ran from `start` to `end`, counting `activeMs` (the time actually run,
 * pauses left out; the whole span when not given) as whole minutes — or undefined under a minute.
 */
export function focusRecord(fields: { id: string; taskId?: string; title: string; start: Date; end: Date; activeMs?: number; kind: FocusKind; done?: boolean }): FocusRecord | undefined {
  const active = fields.activeMs ?? fields.end.getTime() - fields.start.getTime();
  const minutes = Math.floor(Math.max(0, active) / 60_000);
  if (minutes < 1) return undefined;
  return {
    id: fields.id, ...(fields.taskId ? { taskId: fields.taskId } : {}), title: fields.title.trim(),
    start: isoDate(fields.start), end: isoDate(fields.end), minutes, kind: fields.kind, done: Boolean(fields.done),
  };
}

/** The file's text with `record` added as its last line (a torn last line gets its own line first). */
export function appendFocus(text: string, record: FocusRecord): string {
  const lead = text.length > 0 && !text.endsWith("\n") ? "\n" : "";
  return `${text}${lead}${focusLine(record)}\n`;
}

/** The logical (4 a.m.) day a record counts on: the day it started. */
export const focusDay = (record: FocusRecord): string => dayKey(new Date(record.start));

/** Records that started on a day from `from`'s to `to`'s (both logical days, inclusive). */
export function inRange(records: readonly FocusRecord[], from: Date, to: Date): FocusRecord[] {
  const first = dayKey(from), last = dayKey(to);
  return records.filter((record) => { const day = focusDay(record); return day >= first && day <= last; });
}

/** Minutes per day ("2026-10-08" → 85) in the range, days with time only, in day order. */
export function focusTotals(records: readonly FocusRecord[], from: Date, to: Date): Map<string, number> {
  const totals = new Map<string, number>();
  for (const record of inRange(records, from, to)) {
    if (record.minutes <= 0) continue;
    const day = focusDay(record);
    totals.set(day, (totals.get(day) ?? 0) + record.minutes);
  }
  return new Map([...totals].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The range's minutes and how many sessions (focus and plain timers alike). */
export function focusTotal(records: readonly FocusRecord[], from: Date, to: Date): { minutes: number; sessions: number } {
  const shown = inRange(records, from, to);
  return { minutes: shown.reduce((sum, record) => sum + record.minutes, 0), sessions: shown.length };
}

/** "1시간 40분" · "1 h 40 min" · "1 u 40 min" (durationText; "0분" · "0 min" for none). */
export const focusTime = (minutes: number, lang: Lang = "ko"): string => durationText(Math.max(0, minutes), lang);

/** "4번" · "4 sessions" · "4 sessies" (1 session · 1 sessie). */
export function sessionsText(count: number, lang: Lang = "ko"): string {
  return lang === "ko" ? `${count}번` : lang === "en" ? plural(count, "session", "sessions") : plural(count, "sessie", "sessies");
}

/** "집중 1시간 40분 · 4번" · "Focus 1 h 40 min · 4 sessions" · "Focus 1 u 40 min · 4 sessies" over the range. */
export function focusSummary(records: readonly FocusRecord[], from: Date, to: Date, lang: Lang = "ko"): string {
  const { minutes, sessions } = focusTotal(records, from, to);
  return `${lang === "ko" ? "집중" : "Focus"} ${focusTime(minutes, lang)} · ${sessionsText(sessions, lang)}`;
}

export interface FocusTask { taskId?: string; title: string; minutes: number; sessions: number }

/**
 * 가장 오래 집중한 일: focus sessions (not plain timers) in the range by task — its id, or for a line
 * without one its title (trimmed, case ignored) — most minutes first, equal minutes by title, at most
 * `limit`. The title shown is the newest session's.
 */
export function focusByTask(records: readonly FocusRecord[], from: Date, to: Date, limit = 3): FocusTask[] {
  const groups = new Map<string, FocusTask & { latest: string }>();
  for (const record of inRange(records, from, to)) {
    if (record.kind !== "focus" || record.minutes <= 0) continue;
    const key = record.taskId ? `id:${record.taskId}` : `title:${record.title.trim().toLowerCase()}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, { ...(record.taskId ? { taskId: record.taskId } : {}), title: record.title, minutes: record.minutes, sessions: 1, latest: record.start });
      continue;
    }
    group.minutes += record.minutes;
    group.sessions += 1;
    if (Date.parse(record.start) >= Date.parse(group.latest)) { group.title = record.title; group.latest = record.start; }
  }
  return [...groups.values()]
    .sort((a, b) => b.minutes - a.minutes || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0))
    .slice(0, Math.max(0, limit))
    .map(({ latest: _latest, ...task }) => task);
}

/** Lines of both files by id: those here first, then the imported ones this side lacks (backup 합치기, a storage move). */
export function mergeFocus(current: string, imported: string): string {
  const mine = current.split(/\r?\n/).filter((line) => line.trim());
  const idOf = (line: string): string | undefined => {
    try { const value = JSON.parse(line) as unknown; return isObject(value) && typeof value.id === "string" ? value.id : undefined; } catch { return undefined; }
  };
  const ids = new Set(mine.map(idOf).filter((id): id is string => id !== undefined));
  const texts = new Set(mine.map((line) => line.trim()));
  const added: string[] = [];
  for (const line of imported.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const id = idOf(line);
    if (id !== undefined ? ids.has(id) : texts.has(line.trim())) continue;
    if (id !== undefined) ids.add(id); else texts.add(line.trim());
    added.push(line);
  }
  if (added.length === 0) return current;
  return [...mine, ...added].join("\n") + "\n";
}

/**
 * The focus card's line under the title: how long until it first, the clock time last, so the time left in the
 * ring above isn't read beside a clock (#46): "40분 뒤 치과 · 15:30" · "Dentist in 40 min · 3:30 PM" ·
 * "Tandarts over 40 min · 15:30". Same as the Mac's `Focus.nextLine`.
 */
export function focusNextLine(title: string, time: string, minutes: number, lang: Lang = "ko"): string {
  const away = awayText(Math.max(1, minutes), lang);
  return `${lang === "ko" ? `${away} ${title}` : `${title} ${away}`} · ${time}`;
}
