import type { TodoItem } from "./notebook";
import type { Lang } from "./lang";

/** A finished task as kept in the record: one JSON line per task, one file per month. */
export interface ArchiveEntry {
  id: string;
  title: string;
  createdAt: string;
  completedAt?: string;
  /** 시간 정하기: the task's range, kept as it was ("HH:mm"). */
  timeStart?: string;
  timeEnd?: string;
}

export type ArchiveAfterDays = 0 | 1 | 3 | 7;
export const archiveChoices: { days: ArchiveAfterDays; title: string }[] = [
  { days: 1, title: "다음 날" },
  { days: 3, title: "3일 뒤" },
  { days: 7, title: "7일 뒤" },
  { days: 0, title: "보관 안 함" },
];

const archiveTitles: Record<Lang, readonly string[]> = {
  ko: archiveChoices.map((choice) => choice.title),
  en: ["Next day", "After 3 days", "After 7 days", "Never"],
  nl: ["Volgende dag", "Na 3 dagen", "Na 7 dagen", "Nooit"],
};

/** The choices in a language: en "Next day", "After 3 days", "After 7 days", "Never"; nl "Volgende dag", "Na 3 dagen", "Na 7 dagen", "Nooit". */
export const archiveChoicesIn = (lang: Lang = "ko"): { days: ArchiveAfterDays; title: string }[] =>
  archiveChoices.map((choice, index) => ({ days: choice.days, title: archiveTitles[lang][index] }));

/** A "day" ends at 4 a.m., so something finished just after midnight still counts as tonight's work. */
export const dayBoundaryHour = 4;

export function logicalDayStart(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), dayBoundaryHour);
  if (date < start) start.setDate(start.getDate() - 1);
  return start;
}

/**
 * Completed tasks whose day ended at least `days` days ago. With 1 ("다음 날"), today's
 * finished work stays visible until the next 4 a.m. Tasks finished before completion times
 * were recorded have no date, so they are archived at the first opportunity.
 */
export function dueForArchive(items: readonly TodoItem[], now: Date, days: ArchiveAfterDays): TodoItem[] {
  if (days === 0) return [];
  const cutoff = logicalDayStart(now);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  return items.filter((item) => item.isCompleted && (!item.completedAt || new Date(item.completedAt) < cutoff));
}

export function toEntry(item: TodoItem): ArchiveEntry {
  const entry: ArchiveEntry = { id: item.id, title: item.title, createdAt: item.createdAt };
  if (item.completedAt) entry.completedAt = item.completedAt;
  if (item.timeStart) entry.timeStart = item.timeStart;
  if (item.timeEnd) entry.timeEnd = item.timeEnd;
  return entry;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** "2026-09" for the file an entry belongs to; undated entries share one file. */
export function monthKey(entry: ArchiveEntry): string {
  if (!entry.completedAt) return "undated";
  const date = new Date(entry.completedAt);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

/** Local calendar day key, using the same 4 a.m. boundary as archiving. */
export function dayKey(date: Date): string {
  const day = logicalDayStart(date);
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

export function parseArchiveLines(text: string): ArchiveEntry[] {
  const entries: ArchiveEntry[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value = JSON.parse(line) as Partial<ArchiveEntry>;
      if (typeof value.id === "string" && typeof value.title === "string" && typeof value.createdAt === "string") {
        entries.push({
          id: value.id, title: value.title, createdAt: value.createdAt, ...(typeof value.completedAt === "string" ? { completedAt: value.completedAt } : {}),
          ...(typeof value.timeStart === "string" ? { timeStart: value.timeStart } : {}), ...(typeof value.timeEnd === "string" ? { timeEnd: value.timeEnd } : {}),
        });
      }
    } catch {
      // A torn last line (power loss mid-append) only loses that one line.
    }
  }
  return entries;
}

// ─── Statistics for the history calendar ──────────────────────────────────────

export interface DayRecord { key: string; entries: ArchiveEntry[] }

/** Completions grouped by day; the same task id is counted once even if it appears twice. */
export function groupByDay(entries: readonly ArchiveEntry[]): Map<string, ArchiveEntry[]> {
  const seen = new Set<string>();
  const days = new Map<string, ArchiveEntry[]>();
  for (const entry of entries) {
    if (!entry.completedAt || seen.has(entry.id)) continue;
    seen.add(entry.id);
    const key = dayKey(new Date(entry.completedAt));
    const list = days.get(key) ?? [];
    list.push(entry);
    days.set(key, list);
  }
  for (const list of days.values()) list.sort((a, b) => Date.parse(a.completedAt!) - Date.parse(b.completedAt!));
  return days;
}

/** Fixed thresholds read the same every month: 1 · 2–3 · 4–5 · 6+. */
export function heatLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 5) return 3;
  return 4;
}

export const heatLevelTitles = ["없음", "1개", "2–3개", "4–5개", "6개 이상"];
/** The history calendar's legend in a language: en "None", "1", "2–3", "4–5", "6 or more"; nl "Geen", "1", "2–3", "4–5", "6 of meer". */
export const heatLevelTitlesIn: Record<Lang, readonly string[]> = {
  ko: heatLevelTitles,
  en: ["None", "1", "2–3", "4–5", "6 or more"],
  nl: ["Geen", "1", "2–3", "4–5", "6 of meer"],
};

/** Consecutive days with at least one completion, ending today — or yesterday, so a streak isn't "lost" before today's first check. */
export function currentStreak(days: ReadonlyMap<string, unknown[]>, today: Date): number {
  const cursor = logicalDayStart(today);
  if (!days.has(dayKey(cursor))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function longestStreak(days: ReadonlyMap<string, unknown[]>): number {
  const keys = [...days.keys()].sort();
  let best = 0;
  let run = 0;
  let previous: Date | undefined;
  for (const key of keys) {
    const [year, month, day] = key.split("-").map(Number);
    const date = new Date(year, month - 1, day, 12);
    run = previous && Math.round((date.getTime() - previous.getTime()) / 86_400_000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = date;
  }
  return best;
}
