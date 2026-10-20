import { daysText, nextAlarm, timeParts, type Alarm } from "./alarm";
import type { CalendarEvent } from "./calendar";
import { clock as timerClock } from "./focusTimer";
import { clock, dayWord, langIndex, weekdayShort, type Lang } from "./lang";
import type { TodoItem } from "./notebook";
import { awayText, upNext } from "./ribbon";

/**
 * 오늘 창: today at a glance from the tray (the Mac's menu bar item and popover) — the words beside
 * the icon (here the tray's tooltip), the three cards (next event · timer · next alarm), today's
 * tasks with 다음 first, and where the window goes next to the tray. Same rules as the macOS app.
 */

/** A running or paused timer as the glance shows it: a one-off countdown, or a pomodoro phase ("집중 1/4"). */
export interface GlanceTimer {
  remainingMs: number; paused: boolean; caption: string; countdown?: boolean;
  /** 집중: the task being focused on (the words get a focus mark, the card says the task). */
  focus?: string;
}

const soonMs = 3_600_000;

/** "보고서 마무리하고 공유하…" — at most 12 characters, then "…". */
export function shortTitle(title: string, limit = 12): string {
  const characters = [...title.trim()];
  return characters.length > limit ? `${characters.slice(0, limit).join("").trimEnd()}…` : characters.join("");
}

/** "40분", "40 min", "40 min" */
const minutesWord = (minutes: number, lang: Lang) => (lang === "ko" ? `${minutes}분` : `${minutes} min`);

/** The soonest timed event or open task reminder starting within the hour (after now). */
export function soonest(events: readonly CalendarEvent[], items: readonly TodoItem[], now: Date): { title: string; at: Date } | undefined {
  const at = now.getTime();
  const candidates = [
    ...events.filter((event) => !event.allDay).map((event) => ({ title: event.title, time: event.start.getTime() })),
    ...items.filter((item) => !item.isCompleted && item.reminderAt).map((item) => ({ title: item.title, time: Date.parse(item.reminderAt!) })),
  ].filter(({ time }) => time > at && time - at <= soonMs).sort((a, b) => a.time - b.time);
  return candidates[0] ? { title: candidates[0].title, at: new Date(candidates[0].time) } : undefined;
}

/**
 * The words beside the icon: a running timer's remaining time ("12:30"; "● 12:30" while focusing on a
 * task); else the next event or
 * reminder within the hour ("치과 40분", "Dentist 40 min", "Tandarts 40 min", the title cut to 12
 * characters); else nothing.
 */
export function glanceText(events: readonly CalendarEvent[], items: readonly TodoItem[], timer: GlanceTimer | undefined, now: Date, lang: Lang = "ko"): string | undefined {
  if (timer && !timer.paused) return `${timer.focus !== undefined ? "● " : ""}${timerClock(timer.remainingMs)}`;
  const next = soonest(events, items, now);
  if (!next) return undefined;
  return `${shortTitle(next.title)} ${minutesWord(Math.max(1, Math.ceil((next.at.getTime() - now.getTime()) / 60_000)), lang)}`;
}

export type GlanceCardKind = "event" | "timer" | "alarm";
export interface GlanceCard {
  kind: GlanceCardKind;
  /** "다음 일정", "타이머", "다음 알람" */
  label: string;
  /** The time ("15:30", "12:30") or "—". */
  big: string;
  /** "40분 뒤 · 치과", "내일 · 평일", "집중 1/4" — or what to type when there is nothing (“타이머 25”). */
  small: string;
  /** Within the hour, or a timer running: clay. */
  hot: boolean;
  /** Nothing to show (the small line is a hint). */
  empty: boolean;
  /** The event (its occurrence key), to open it. */
  key?: string;
}

/** The cards' names; Dutch keeps them to one word ("Volgende afspraak" doesn't fit a third of the window). */
const cardLabels: Record<GlanceCardKind, readonly [string, string, string]> = {
  event: ["다음 일정", "Next event", "Afspraak"],
  timer: ["타이머", "Timer", "Timer"],
  alarm: ["다음 알람", "Next alarm", "Wekker"],
};
/** An empty card's line: none today, or what to type in the line below (the same words as the Mac's). */
const emptyLines: Record<GlanceCardKind, readonly [string, string, string]> = {
  event: ["오늘은 없어요", "None today", "Niets vandaag"],
  timer: ["“타이머 25”", "“timer 25”", "‘timer 25’"],
  alarm: ["“알람 7시”", "“alarm 7am”", "‘wekker 7:00’"],
};
/** What the empty timer card suggests typing: "타이머 25", "timer 25", "timer 25". */
export const timerHint = (lang: Lang = "ko"): string => (lang === "ko" ? "타이머 25" : "timer 25");
/** What the empty alarm card suggests typing: "알람 7시", "alarm 7am", "wekker 7:00". */
export const alarmHint = (lang: Lang = "ko"): string => (lang === "ko" ? "알람 7시" : lang === "en" ? "alarm 7am" : "wekker 7:00");
const pausedWord = ["멈춤", "Paused", "Gepauzeerd"] as const;

/** When a running countdown ends: "20:56에 끝나요", "Ends at 8:56 PM", "Klaar om 20:56" (as on the Mac). */
function untilText(end: Date, lang: Lang): string {
  const time = clock(end.getHours(), end.getMinutes(), lang);
  return lang === "ko" ? `${time}에 끝나요` : lang === "en" ? `Ends at ${time}` : `Klaar om ${time}`;
}

/** Whole calendar days from `now` to `date` (0 today, 1 tomorrow). */
const daysFrom = (now: Date, date: Date) => Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())) / 86_400_000);

/** "오늘", "내일" (en/nl as words: "Today", "Tomorrow"), or the weekday ("금", "Fri", "vr"). */
function dayText(now: Date, date: Date, lang: Lang): string {
  return dayWord(daysFrom(now, date), lang) ?? weekdayShort(date.getDay(), lang);
}

/**
 * The three cards: the next timed event (from `events`, occurrences from now on), the timer, the
 * next alarm that is on. A card whose thing is within the hour, and a running timer, is hot.
 */
export function glanceCards(events: readonly CalendarEvent[], timer: GlanceTimer | undefined, alarms: readonly Alarm[], handled: ReadonlySet<string>, now: Date, lang: Lang = "ko"): GlanceCard[] {
  const index = langIndex(lang);
  const at = now.getTime();
  const card = (kind: GlanceCardKind, fields: Omit<GlanceCard, "kind" | "label">): GlanceCard => ({ kind, label: cardLabels[kind][index], ...fields });
  const empty = (kind: GlanceCardKind) => card(kind, { big: "—", small: emptyLines[kind][index], hot: false, empty: true });

  const next = events.filter((event) => !event.allDay && event.start.getTime() > at).sort((a, b) => a.start.getTime() - b.start.getTime())[0];
  const eventCard = next ? card("event", {
    big: clock(next.start.getHours(), next.start.getMinutes(), lang),
    small: daysFrom(now, next.start) === 0
      // The time away first: a long title gives way to the ellipsis, not the "40분 뒤".
      ? `${awayText(Math.max(1, Math.ceil((next.start.getTime() - at) / 60_000)), lang)} · ${next.title}`
      : `${dayText(now, next.start, lang)} · ${next.title}`,
    hot: next.start.getTime() - at <= soonMs, empty: false, key: next.key,
  }) : empty("event");

  // A countdown says when it ends (its card is already called 타이머); a pomodoro its phase.
  const timerSmall = (value: GlanceTimer) => {
    // 집중: the task (the card cuts a long one off), "멈춤 · " in front while paused.
    if (value.focus !== undefined) return value.paused ? `${pausedWord[index]} · ${value.focus}` : value.focus;
    if (value.countdown) return value.paused ? pausedWord[index] : untilText(new Date(at + Math.ceil(value.remainingMs / 60_000) * 60_000), lang);
    return value.paused ? `${value.caption} · ${pausedWord[index]}` : value.caption;
  };
  const timerCard = timer ? card("timer", { big: timerClock(timer.remainingMs), small: timerSmall(timer), hot: !timer.paused, empty: false }) : empty("timer");

  const ring = nextAlarm(alarms, now, handled);
  const alarmCard = ring ? card("alarm", {
    big: clock(timeParts(ring.alarm).hour, timeParts(ring.alarm).minute, lang),
    small: `${dayText(now, ring.at, lang)} · ${daysText(ring.alarm.days, lang)}`,
    hot: ring.at.getTime() - at <= soonMs, empty: false,
  }) : empty("alarm");
  return [eventCard, timerCard, alarmCard];
}

/**
 * Today's tasks for the window: 다음 (open reminders later today, by time, at most three), then up
 * to `more` other open tasks in the list's order, and how many open ones are left out (외 N개).
 */
export function glanceTasks(today: readonly TodoItem[], now: Date, more = 3): { next: TodoItem[]; rest: TodoItem[]; hidden: number } {
  const open = today.filter((item) => !item.isCompleted);
  const next = upNext(open, now);
  const ids = new Set(next.map((item) => item.id));
  const others = open.filter((item) => !ids.has(item.id));
  const rest = others.slice(0, more);
  return { next, rest, hidden: others.length - rest.length };
}

// ─── Where the window goes ──────────────────────────────────────────────────────

export interface Rect { x: number; y: number; width: number; height: number }
export type TaskbarEdge = "bottom" | "top" | "left" | "right";

/** Which edge of the display the taskbar (or the menu bar) takes: the side the work area gives up. */
export function taskbarEdge(display: Rect, workArea: Rect): TaskbarEdge {
  if (workArea.y > display.y) return "top";
  if (workArea.x > display.x) return "left";
  if (workArea.x + workArea.width < display.x + display.width) return "right";
  return "bottom";
}

/**
 * Where the 오늘 창 goes: against the taskbar's edge of the work area, lined up with the tray icon
 * (`tray`, when its place is known) and kept `gap` inside the work area; without the icon's place,
 * the work area's corner on the taskbar's side (bottom-right by default).
 */
export function glanceOrigin(tray: Rect | undefined, display: Rect, workArea: Rect, size: { width: number; height: number }, gap = 0): { x: number; y: number } {
  const edge = taskbarEdge(display, workArea);
  const left = workArea.x + gap, top = workArea.y + gap;
  const right = workArea.x + workArea.width - size.width - gap, bottom = workArea.y + workArea.height - size.height - gap;
  const clamp = (value: number, low: number, high: number) => Math.round(Math.max(low, Math.min(value, Math.max(low, high))));
  const cx = tray ? tray.x + tray.width / 2 : undefined;
  const cy = tray ? tray.y + tray.height / 2 : undefined;
  switch (edge) {
    case "top": return { x: cx === undefined ? right : clamp(cx - size.width / 2, left, right), y: top };
    case "left": return { x: left, y: cy === undefined ? bottom : clamp(cy - size.height / 2, top, bottom) };
    case "right": return { x: right, y: cy === undefined ? bottom : clamp(cy - size.height / 2, top, bottom) };
    default: return { x: cx === undefined ? right : clamp(cx - size.width / 2, left, right), y: bottom };
  }
}
