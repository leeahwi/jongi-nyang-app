import { dayKey, logicalDayStart } from "./archive";
import { todos, type Lang } from "./lang";

/**
 * The weekly look-back: on Sunday (by the 4 a.m. day) from 18:00, once a week, the pet tells how
 * many tasks were finished Monday–Sunday. `week` is that Monday's day key, remembered in prefs.
 */
export const lookbackHour = 18;

export function weekOf(now: Date): { week: string; monday: string; sunday: string } {
  const today = logicalDayStart(now);
  const monday = new Date(today);
  monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return { week: dayKey(monday), monday: dayKey(monday), sunday: dayKey(sunday) };
}

/** Tasks finished this Monday–Sunday, each id once (the record and the list may both hold one). */
export function finishedThisWeek(entries: readonly { id: string; completedAt?: string }[], now: Date): number {
  const { monday, sunday } = weekOf(now);
  const ids = new Set<string>();
  for (const entry of entries) {
    if (!entry.completedAt) continue;
    const day = dayKey(new Date(entry.completedAt));
    if (day >= monday && day <= sunday) ids.add(entry.id);
  }
  return ids.size;
}

/** The message to say now, or undefined (not Sunday evening yet, already said this week, or nothing finished). */
export function weeklyLookback(now: Date, entries: readonly { id: string; completedAt?: string }[], lastWeek: string, lang: Lang = "ko"): { week: string; count: number; message: string } | undefined {
  const today = logicalDayStart(now);
  if (today.getDay() !== 0) return undefined;
  const evening = new Date(today.getFullYear(), today.getMonth(), today.getDate(), lookbackHour);
  if (now < evening) return undefined;
  const { week } = weekOf(now);
  if (week === lastWeek) return undefined;
  const count = finishedThisWeek(entries, now);
  if (count === 0) return undefined;
  return { week, count, message: lookbackMessage(count, lang) };
}

/**
 * "이번 주 5개 끝냈어요. 수고했어요!" — en "You finished 5 to-dos this week. Nice work!";
 * nl "Je hebt deze week 5 taken afgerond. Goed gedaan!" (macOS: Archive.lookBackMessage).
 */
export function lookbackMessage(count: number, lang: Lang = "ko"): string {
  if (lang === "en") return `You finished ${todos(count, lang)} this week. Nice work!`;
  if (lang === "nl") return `Je hebt deze week ${todos(count, lang)} afgerond. Goed gedaan!`;
  return `이번 주 ${count}개 끝냈어요. 수고했어요!`;
}
