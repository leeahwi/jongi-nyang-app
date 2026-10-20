import type { Lang } from "./lang";

/**
 * The Windows taskbar (편의 기능 14–15), worked out without Electron so it can be tested on any system:
 * the button's progress while a timer or 집중 runs (paused: the paused state), the thumbnail toolbar
 * (⏸/▶ · ⏹ · +5분), the small badge with the tasks left, the Jump List's tasks and how a launch from
 * one is read, and the tray icon's dot (something within the hour). main.ts applies them on Windows only.
 */

/** A timer as the taskbar sees it (see TimerView): remaining and whole length, paused or not. */
export interface TaskbarTimer { remainingMs: number; durationMs: number; paused: boolean }

/** The button's progress: 0…1 done with "normal" or "paused", or nothing (-1, "none"). */
export function taskbarProgress(timer: TaskbarTimer | undefined): { value: number; mode: "normal" | "paused" | "none" } {
  if (!timer || timer.durationMs <= 0) return { value: -1, mode: "none" };
  const done = Math.min(1, Math.max(0, 1 - timer.remainingMs / timer.durationMs));
  // Never quite empty, so a timer that just started still shows on the button.
  return { value: Math.max(0.01, Math.round(done * 1000) / 1000), mode: timer.paused ? "paused" : "normal" };
}

export type ThumbButton = "pause" | "resume" | "stop" | "more";
const thumbTips: Record<Lang, Record<ThumbButton, string>> = {
  ko: { pause: "일시정지", resume: "계속", stop: "그만", more: "5분 더" },
  en: { pause: "Pause", resume: "Resume", stop: "Stop", more: "5 more min" },
  nl: { pause: "Pauzeren", resume: "Doorgaan", stop: "Stoppen", more: "5 min erbij" },
};

/** The thumbnail toolbar while a timer is on: ⏸ (▶ when paused) · ⏹ · +5분; none otherwise. */
export function thumbButtons(timer: TaskbarTimer | undefined, lang: Lang = "ko"): { id: ThumbButton; tooltip: string }[] {
  if (!timer) return [];
  const first: ThumbButton = timer.paused ? "resume" : "pause";
  return ([first, "stop", "more"] as ThumbButton[]).map((id) => ({ id, tooltip: thumbTips[lang][id] }));
}

/** The badge's words for `count` tasks left: none for 0, "1"…"9", "9+" (the picture's name: badge-9plus). */
export function badgeText(count: number): string | undefined {
  if (!Number.isFinite(count) || count <= 0) return undefined;
  return count > 9 ? "9+" : String(Math.floor(count));
}

export type LaunchCommand = "quick-entry" | "quick-memo" | "desk" | "focus-25" | "timer-5" | "search";
const launchFlags: Record<LaunchCommand, string> = {
  "quick-entry": "--quick-entry", "quick-memo": "--quick-memo", desk: "--desk", "focus-25": "--focus-25", "timer-5": "--timer-5", search: "--search",
};
const taskTitles: Record<Lang, Record<Exclude<LaunchCommand, "search">, [string, string]>> = {
  ko: {
    "quick-entry": ["빠른 입력", "어디서든 한 줄로 할 일 · 일정 · 타이머를 적어요"], "quick-memo": ["빠른 메모", "몇 줄을 바로 메모 탭에 넣어요"],
    desk: ["책상", "달력 · 완료 기록 · 설정"], "focus-25": ["25분 집중", "할 일을 하나 골라 25분 집중해요"], "timer-5": ["5분 타이머", "5분을 재요"],
  },
  en: {
    "quick-entry": ["Quick add", "Write a to-do, an event or a timer from anywhere"], "quick-memo": ["Quick note", "Put a few lines straight into Notes"],
    desk: ["Desk", "Calendar · History · Settings"], "focus-25": ["Focus 25 min", "Pick a to-do and focus for 25 minutes"], "timer-5": ["5 min timer", "Time 5 minutes"],
  },
  nl: {
    "quick-entry": ["Snel toevoegen", "Schrijf overal een taak, afspraak of timer"], "quick-memo": ["Snelle notitie", "Zet een paar regels meteen in Notities"],
    desk: ["Bureau", "Kalender · Geschiedenis · Instellingen"], "focus-25": ["25 min focussen", "Kies een taak en focus 25 minuten"], "timer-5": ["Timer van 5 min", "5 minuten timen"],
  },
};

/** The Jump List's tasks (right-click on the taskbar button): 빠른 입력 · 빠른 메모 · 책상 · 25분 집중 · 5분 타이머. */
export function jumpTasks(lang: Lang = "ko"): { command: LaunchCommand; args: string; title: string; description: string }[] {
  return (["quick-entry", "quick-memo", "desk", "focus-25", "timer-5"] as const).map((command) => ({
    command, args: launchFlags[command], title: taskTitles[lang][command][0], description: taskTitles[lang][command][1],
  }));
}

/** What a launch (or a second launch, from the Jump List) asks for, read from its arguments; the last flag wins. */
export function launchCommand(argv: readonly string[]): LaunchCommand | undefined {
  let found: LaunchCommand | undefined;
  for (const arg of argv) {
    const command = (Object.keys(launchFlags) as LaunchCommand[]).find((key) => launchFlags[key] === arg);
    if (command) found = command;
  }
  return found;
}

/** Started by Windows at sign-in (the login item's argument), not by hand. */
export const loginFlag = "--at-login";
export const startedAtLogin = (argv: readonly string[]): boolean => argv.includes(loginFlag);

/**
 * The cat asks once whether to open with the computer: not when it already does, not asked before,
 * and only after the third launch by hand.
 */
export function shouldAskLogin(state: { openAtLogin: boolean; asked: boolean; manualLaunches: number }): boolean {
  return !state.openAtLogin && !state.asked && state.manualLaunches >= 3;
}
