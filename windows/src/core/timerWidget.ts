import type { FocusTimer } from "./focusTimer";
import { nearestArea, type Point, type Rect } from "./placement";
import type { Lang } from "./lang";

/**
 * The focus timer's own small window: a paper board with room above it for a speech bubble.
 * It has nothing to do with the pet; it floats wherever the person drags it.
 */

/** Everything the timer window draws; sent from the main process on every change. */
export interface TimerPayload {
  /** Absent once a countdown has finished: only its message is left, for a moment. */
  timer?: FocusTimer;
  message?: string;
  /** TimerSize: the whole page drawn larger or smaller. */
  scale?: number;
  /** 집중 with the note away: the task's title on the board (a click brings the note back). */
  focus?: string;
}

/** The transparent window at 보통: the cat holding the board at the bottom centre, the bubble above. */
export const timerWindowSize = { width: 250, height: 250 };

/**
 * How big the timer is drawn: Settings → 타이머, or 크기 in its right-click menu. Same steps as the
 * macOS app (TimerSize.swift).
 */
export type TimerSize = "small" | "regular" | "large" | "extraLarge";
export const timerSizes: readonly TimerSize[] = ["small", "regular", "large", "extraLarge"];
export const timerScale: Record<TimerSize, number> = { small: 0.8, regular: 1, large: 1.25, extraLarge: 1.5 };
export const timerSizeTitles: Record<Lang, Record<TimerSize, string>> = {
  ko: { small: "작게", regular: "보통", large: "크게", extraLarge: "아주 크게" },
  en: { small: "Small", regular: "Regular", large: "Large", extraLarge: "Extra large" },
  nl: { small: "Klein", regular: "Normaal", large: "Groot", extraLarge: "Extra groot" },
};
export const timerSizeTitle: Record<TimerSize, string> = timerSizeTitles.ko;

export function timerWindowSizeFor(size: TimerSize): { width: number; height: number } {
  const scale = timerScale[size] ?? 1;
  return { width: Math.round(timerWindowSize.width * scale), height: Math.round(timerWindowSize.height * scale) };
}

/** A new size grows or shrinks around the middle of the bottom edge (where the board is). */
export function resizedTimerOrigin(origin: Point, from: { width: number; height: number }, to: { width: number; height: number }): Point {
  return { x: Math.round(origin.x + from.width / 2 - to.width / 2), y: origin.y + from.height - to.height };
}
/** How far the window may hang past a side, and above the top: that part of it is empty. */
const sideSlack = 40;
const topSlack = 40;
/** The reminder bubbles' corner (the widest style plus its gutter) that the default spot keeps clear of. */
export const reminderReserve = 470;
const gap = 8;
/** Lines the board up with the bottom of the reminder bubbles. */
const bottomMargin = 26;

/** Keeps the window on the display under its centre (or the nearest one), the board fully on screen. */
export function clampTimer(origin: Point, areas: Rect[], size = timerWindowSize): Point {
  const { width, height } = size;
  const area = nearestArea({ x: origin.x + width / 2, y: origin.y + height / 2 }, areas);
  if (!area) return origin;
  return {
    x: clamp(origin.x, area.x - sideSlack, area.x + area.width - width + sideSlack),
    y: clamp(origin.y, area.y - topSlack, area.y + area.height - height),
  };
}

/** Bottom-right, just above the taskbar and left of where reminders pop up. */
export function defaultTimerOrigin(area: Rect, size = timerWindowSize): Point {
  const { width, height } = size;
  return clampTimer({
    x: area.x + area.width - reminderReserve - gap - width,
    y: area.y + area.height - height - bottomMargin,
  }, [area], size);
}

const clamp = (value: number, min: number, max: number) => (min > max ? (min + max) / 2 : Math.min(Math.max(value, min), max));
