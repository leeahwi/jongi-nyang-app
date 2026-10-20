import { clock, dayMonth, dayWord, spokenTime, type Lang } from "./lang";
import type { TodoItem } from "./notebook";

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
/** 0 for today, 1 for tomorrow (calendar days), else undefined. */
const offset = (date: Date, now: Date) => (sameDay(date, now) ? 0 : sameDay(date, addDays(now, 1)) ? 1 : undefined);

/**
 * "오늘 09:30", "내일 18:00", "10/3 07:05", "2027/1/2 07:05" — en "Today 9:30 AM", "10/3 7:05 AM",
 * "1/2/2027 7:05 AM"; nl "Vandaag 09:30", "3-10 07:05", "2-1-2027 07:05". Same as macOS (ReminderTimeText).
 */
export function compactTime(date: Date, now = new Date(), lang: Lang = "ko"): string {
  const time = clock(date.getHours(), date.getMinutes(), lang);
  const days = offset(date, now);
  if (days !== undefined) return `${dayWord(days, lang)} ${time}`;
  const [year, month, day] = [date.getFullYear(), date.getMonth() + 1, date.getDate()];
  const sameYear = year === now.getFullYear();
  const text = lang === "ko" ? (sameYear ? `${month}/${day}` : `${year}/${month}/${day}`)
    : lang === "en" ? (sameYear ? `${month}/${day}` : `${month}/${day}/${year}`)
    : (sameYear ? `${day}-${month}` : `${day}-${month}-${year}`);
  return `${text} ${time}`;
}

/**
 * "오늘 오후 4:49", "내일 오전 9:00", "10월 3일 오전 7:05" — en "Today 4:49 PM", "Oct 3, 7:05 AM",
 * "Jan 2, 2027, 10:21 AM"; nl "Vandaag 16:49", "3 okt 07:05", "2 jan 2027 10:21".
 */
export function scheduledTime(date: Date, now = new Date(), lang: Lang = "ko"): string {
  const time = spokenTime(date.getHours(), date.getMinutes(), lang);
  const days = offset(date, now);
  if (days !== undefined) return `${dayWord(days, lang)} ${time}`;
  const day = dayMonth(date.getMonth() + 1, date.getDate(), date.getFullYear() === now.getFullYear() ? undefined : date.getFullYear(), lang);
  return lang === "en" ? `${day}, ${time}` : `${day} ${time}`;
}

const rowWords: Record<Lang, [string, string, string]> = {
  ko: ["알림 중지", "알림 보냄", "알림 대기"],
  en: ["Reminder off", "Reminder sent", "reminder pending"],
  nl: ["Herinnering uit", "Herinnering verstuurd", "herinnering wacht"],
};

/** The row's reminder note: the time, and whether it was stopped, sent or is still waiting. */
export function rowLabel(item: TodoItem, now = new Date(), lang: Lang = "ko"): string | undefined {
  if (!item.reminderAt) return undefined;
  const at = new Date(item.reminderAt);
  const time = scheduledTime(at, now, lang);
  const [stopped, sent, waiting] = rowWords[lang];
  if (item.isCompleted) return `${stopped} · ${time}`;
  if (item.reminderLastDeliveredAt && Date.parse(item.reminderLastDeliveredAt) >= at.getTime()) return `${sent} · ${time}`;
  if (at.getTime() < now.getTime()) return `${time} · ${waiting}`;
  return time;
}
