import type { Lang } from "./lang";

/**
 * The focus timer shown on its own small board (ported from macOS `FocusTimer`). A plain value: every
 * question is answered for a given `now` (epoch ms), so it survives sleep, relaunch (it is
 * JSON) and is easy to test. Functions return new values instead of mutating.
 */

/** Classic Pomodoro: 25 minutes of focus, 5 of rest, a longer 15-minute rest after every 4 rounds. */
export interface PomodoroSettings {
  focusMinutes: number;
  restMinutes: number;
  longRestMinutes: number;
  roundsBeforeLongRest: number;
}

export const defaultPomodoro: PomodoroSettings = { focusMinutes: 25, restMinutes: 5, longRestMinutes: 15, roundsBeforeLongRest: 4 };

/** `timer` is a one-off countdown. */
export type FocusPhase = "timer" | "focus" | "rest" | "longRest";

export interface FocusTimer {
  phase: FocusPhase;
  durationMs: number;
  /** Set while running; absent while paused. */
  endsAt?: number;
  /** Set while paused. */
  pausedRemainingMs?: number;
  /** Finished focus rounds in this Pomodoro session. */
  completedRounds: number;
  pomodoro?: PomodoroSettings;
}

/** What the tray, the note's ⋯ menu, the pet's menu, settings and the board ask the timer to do. */
export type TimerCommand =
  | { kind: "countdown"; minutes: number }
  | { kind: "pomodoro" }
  | { kind: "togglePause" }
  | { kind: "addMinutes"; minutes: number }
  | { kind: "stop" };

const minute = 60_000;

export function startCountdown(minutes: number, now: number): FocusTimer {
  const durationMs = Math.max(1, minutes) * minute;
  return { phase: "timer", durationMs, endsAt: now + durationMs, completedRounds: 0 };
}

export function startPomodoro(settings: PomodoroSettings, now: number): FocusTimer {
  const durationMs = Math.max(1, settings.focusMinutes) * minute;
  return { phase: "focus", durationMs, endsAt: now + durationMs, completedRounds: 0, pomodoro: { ...settings } };
}

export const isPaused = (timer: FocusTimer): boolean => timer.endsAt === undefined;

export function remainingMs(timer: FocusTimer, now: number): number {
  if (timer.endsAt === undefined) return timer.pausedRemainingMs ?? 0;
  return Math.max(0, timer.endsAt - now);
}

/** 1 when a phase starts, 0 when it ends — the size of the shrinking disc. */
export function timerFraction(timer: FocusTimer, now: number): number {
  return timer.durationMs > 0 ? remainingMs(timer, now) / timer.durationMs : 0;
}

export const isFinished = (timer: FocusTimer, now: number): boolean => !isPaused(timer) && remainingMs(timer, now) <= 0;

export function pauseTimer(timer: FocusTimer, now: number): FocusTimer {
  if (isPaused(timer)) return timer;
  const { endsAt: _endsAt, ...rest } = timer;
  return { ...rest, pausedRemainingMs: remainingMs(timer, now) };
}

export function resumeTimer(timer: FocusTimer, now: number): FocusTimer {
  if (timer.pausedRemainingMs === undefined) return timer;
  const { pausedRemainingMs, ...rest } = timer;
  return { ...rest, endsAt: now + pausedRemainingMs };
}

/** Adds (or with a negative value, removes) minutes to the current phase. */
export function adjustTimer(timer: FocusTimer, minutes: number, now: number): FocusTimer {
  const change = minutes * minute;
  const durationMs = Math.max(minute, timer.durationMs + change);
  const next: FocusTimer = { ...timer, durationMs };
  if (timer.pausedRemainingMs !== undefined) next.pausedRemainingMs = Math.min(durationMs, Math.max(0, timer.pausedRemainingMs + change));
  if (timer.endsAt !== undefined) next.endsAt = Math.max(now, timer.endsAt + change);
  return next;
}

/** The next Pomodoro phase after this one ends (starting at `now`), or undefined for a one-off timer. */
export function nextPhase(timer: FocusTimer, now: number): FocusTimer | undefined {
  const settings = timer.pomodoro;
  if (!settings) return undefined;
  let { phase, completedRounds } = timer;
  let durationMs: number;
  if (phase === "focus") {
    completedRounds += 1;
    const long = completedRounds % Math.max(1, settings.roundsBeforeLongRest) === 0;
    phase = long ? "longRest" : "rest";
    durationMs = Math.max(1, long ? settings.longRestMinutes : settings.restMinutes) * minute;
  } else {
    phase = "focus";
    durationMs = Math.max(1, settings.focusMinutes) * minute;
  }
  return { phase, durationMs, endsAt: now + durationMs, completedRounds, pomodoro: settings };
}

/** The widest text of a clock's form: every digit an 8 — or the face's widest digit — ("12:30" → "88:88", "1:02:05" → "8:88:88"), to size it by. */
export const clockTemplate = (text: string, digit = "8"): string => text.replace(/[0-9]/g, digit);

/** "24:13", or "1:02:05" past an hour; rounds up so a running timer never shows 00:00. */
export function clock(ms: number): string {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const hours = Math.floor(total / 3600), minutes = Math.floor((total % 3600) / 60), seconds = total % 60;
  const two = (value: number) => String(value).padStart(2, "0");
  return hours > 0 ? `${hours}:${two(minutes)}:${two(seconds)}` : `${two(minutes)}:${two(seconds)}`;
}

/** Board caption: "집중 2/4", "휴식", "긴 휴식", "타이머" — en "Focus 2/4", "Break", "Long break", "Timer"; nl "Focus 2/4", "Pauze", "Lange pauze", "Timer". */
export function timerCaption(timer: FocusTimer, lang: Lang = "ko"): string {
  if (timer.phase !== "focus") return phaseName(timer, lang);
  const rounds = Math.max(1, timer.pomodoro?.roundsBeforeLongRest ?? 4);
  return `${phaseName(timer, lang)} ${(timer.completedRounds % rounds) + 1}/${rounds}`;
}

const phaseNames: Record<Lang, Record<FocusPhase, string>> = {
  ko: { timer: "타이머", focus: "집중", rest: "휴식", longRest: "긴 휴식" },
  en: { timer: "Timer", focus: "Focus", rest: "Break", longRest: "Long break" },
  nl: { timer: "Timer", focus: "Focus", rest: "Pauze", longRest: "Lange pauze" },
};

/** The phase pill on the board: "집중", "휴식", "긴 휴식", "타이머". */
export function phaseName(timer: FocusTimer, lang: Lang = "ko"): string {
  return phaseNames[lang][timer.phase];
}

/**
 * The pomodoro round dots: how many of this cycle's rounds are done, out of how many, and whether
 * the next one is being focused on right now. Undefined for a one-off timer.
 */
export function pomodoroRounds(timer: FocusTimer): { done: number; total: number; focusing: boolean } | undefined {
  if (!timer.pomodoro) return undefined;
  const total = Math.max(1, timer.pomodoro.roundsBeforeLongRest);
  return { done: timer.completedRounds % total, total, focusing: timer.phase === "focus" };
}

export const isRestPhase = (timer: FocusTimer): boolean => timer.phase === "rest" || timer.phase === "longRest";

const phases: FocusPhase[] = ["timer", "focus", "rest", "longRest"];
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

/** Reads a saved timer back, dropping anything malformed (a hand-edited or older settings file). */
export function parseTimer(value: unknown): FocusTimer | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (!phases.includes(raw.phase as FocusPhase) || !finite(raw.durationMs) || raw.durationMs <= 0) return undefined;
  const running = finite(raw.endsAt), paused = finite(raw.pausedRemainingMs);
  if (running === paused) return undefined;
  const timer: FocusTimer = {
    phase: raw.phase as FocusPhase,
    durationMs: raw.durationMs,
    completedRounds: finite(raw.completedRounds) ? Math.max(0, Math.floor(raw.completedRounds)) : 0,
  };
  if (running) timer.endsAt = raw.endsAt as number; else timer.pausedRemainingMs = Math.max(0, raw.pausedRemainingMs as number);
  const settings = raw.pomodoro as Record<string, unknown> | undefined;
  if (settings && typeof settings === "object") {
    const keys = ["focusMinutes", "restMinutes", "longRestMinutes", "roundsBeforeLongRest"] as const;
    if (keys.every((key) => finite(settings[key]))) timer.pomodoro = Object.fromEntries(keys.map((key) => [key, settings[key]])) as unknown as PomodoroSettings;
  }
  if (timer.phase !== "timer" && !timer.pomodoro) return undefined;
  return timer;
}
