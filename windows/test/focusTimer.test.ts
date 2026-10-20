import assert from "node:assert/strict";
import { test } from "node:test";
import {
  adjustTimer, clock, clockTemplate, defaultPomodoro, isFinished, isPaused, nextPhase, parseTimer, pauseTimer, remainingMs,
  phaseName, pomodoroRounds, resumeTimer, startCountdown, startPomodoro, timerCaption, timerFraction,
} from "../src/core/focusTimer";

const minute = 60_000;
const t0 = 1_700_000_000_000;

test("countdown runs down, finishes, and never goes below zero", () => {
  const timer = startCountdown(25, t0);
  assert.equal(timer.phase, "timer");
  assert.equal(remainingMs(timer, t0 + 5 * minute), 20 * minute);
  assert.equal(timerFraction(timer, t0 + 5 * minute), 0.8);
  assert.equal(isFinished(timer, t0 + 25 * minute - 1), false);
  assert.equal(isFinished(timer, t0 + 25 * minute), true);
  assert.equal(remainingMs(timer, t0 + 40 * minute), 0);
  assert.equal(nextPhase(timer, t0 + 25 * minute), undefined);
  assert.equal(timerCaption(timer), "타이머");
  assert.equal(startCountdown(0, t0).durationMs, minute);
});

test("pause freezes the time left; resume continues from there", () => {
  let timer = startCountdown(10, t0);
  timer = pauseTimer(timer, t0 + 3 * minute);
  assert.equal(isPaused(timer), true);
  assert.equal(timer.endsAt, undefined);
  assert.equal(remainingMs(timer, t0 + 60 * minute), 7 * minute);
  assert.equal(isFinished(timer, t0 + 60 * minute), false);
  assert.equal(pauseTimer(timer, t0 + 61 * minute), timer, "pausing twice changes nothing");
  timer = resumeTimer(timer, t0 + 60 * minute);
  assert.equal(isPaused(timer), false);
  assert.equal(timer.pausedRemainingMs, undefined);
  assert.equal(remainingMs(timer, t0 + 61 * minute), 6 * minute);
  assert.equal(resumeTimer(timer, t0), timer, "resuming a running timer changes nothing");
});

test("adjust adds minutes to a running or paused phase, with sane floors", () => {
  const running = adjustTimer(startCountdown(5, t0), 5, t0 + minute);
  assert.equal(running.durationMs, 10 * minute);
  assert.equal(remainingMs(running, t0 + minute), 9 * minute);
  const paused = adjustTimer(pauseTimer(startCountdown(5, t0), t0 + 4 * minute), 5, t0 + 4 * minute);
  assert.equal(remainingMs(paused, t0 + 30 * minute), 6 * minute);
  const shortened = adjustTimer(startCountdown(5, t0), -10, t0 + minute);
  assert.equal(shortened.durationMs, minute);
  assert.equal(shortened.endsAt, t0 + minute, "never ends in the past");
  const pausedShort = adjustTimer(pauseTimer(startCountdown(5, t0), t0), -10, t0);
  assert.equal(pausedShort.pausedRemainingMs, 0);
});

test("pomodoro cycles focus → rest, with a long rest every N rounds", () => {
  const settings = { ...defaultPomodoro, roundsBeforeLongRest: 2 };
  let timer = startPomodoro(settings, t0);
  assert.equal(timerCaption(timer), "집중 1/2");
  let now = t0;
  const seen: string[] = [];
  for (let step = 0; step < 6; step += 1) {
    now += timer.durationMs;
    timer = nextPhase(timer, now)!;
    seen.push(`${timer.phase}:${timer.durationMs / minute}`);
    assert.equal(timer.endsAt, now + timer.durationMs);
  }
  assert.deepEqual(seen, ["rest:5", "focus:25", "longRest:15", "focus:25", "rest:5", "focus:25"]);
  assert.equal(timer.completedRounds, 3);
  assert.equal(timerCaption(timer), "집중 2/2");
  assert.equal(timerCaption(nextPhase(timer, now)!), "긴 휴식");
});

test("default pomodoro: long rest after the 4th focus round", () => {
  let timer = startPomodoro(defaultPomodoro, t0);
  const phases: string[] = [];
  for (let step = 0; step < 8; step += 1) {
    timer = nextPhase(timer, t0)!;
    phases.push(timer.phase);
  }
  assert.deepEqual(phases, ["rest", "focus", "rest", "focus", "rest", "focus", "longRest", "focus"]);
  assert.equal(timerCaption(startPomodoro(defaultPomodoro, t0)), "집중 1/4");
});

test("next phase after a paused finish starts running fresh", () => {
  const paused = pauseTimer(startPomodoro(defaultPomodoro, t0), t0 + minute);
  const next = nextPhase(paused, t0 + 2 * minute)!;
  assert.equal(isPaused(next), false);
  assert.equal(next.pausedRemainingMs, undefined);
});

test("clock rounds up and switches to hours past an hour", () => {
  assert.equal(clock(25 * minute), "25:00");
  assert.equal(clock(24 * minute + 12_001), "24:13");
  assert.equal(clock(1), "00:01");
  assert.equal(clock(0), "00:00");
  assert.equal(clock(62 * minute + 5000), "1:02:05");
});

test("timers survive a JSON round trip; malformed ones are dropped", () => {
  const running = startPomodoro(defaultPomodoro, t0);
  const paused = pauseTimer(startCountdown(15, t0), t0 + minute);
  assert.deepEqual(parseTimer(JSON.parse(JSON.stringify(running))), running);
  assert.deepEqual(parseTimer(JSON.parse(JSON.stringify(paused))), paused);
  assert.equal(parseTimer(undefined), undefined);
  assert.equal(parseTimer({ phase: "nap", durationMs: 1000, endsAt: t0 }), undefined);
  assert.equal(parseTimer({ phase: "timer", durationMs: 1000 }), undefined, "neither running nor paused");
  assert.equal(parseTimer({ phase: "timer", durationMs: 1000, endsAt: t0, pausedRemainingMs: 5 }), undefined, "both running and paused");
  assert.equal(parseTimer({ phase: "focus", durationMs: 1000, endsAt: t0 }), undefined, "pomodoro phase without settings");
});

test("board pill and round dots", () => {
  const now = 1_000_000;
  const countdown = startCountdown(5, now);
  assert.equal(phaseName(countdown), "타이머");
  assert.equal(pomodoroRounds(countdown), undefined, "no dots for a one-off timer");
  const settings = { ...defaultPomodoro, roundsBeforeLongRest: 4 };
  let timer = startPomodoro(settings, now);
  assert.equal(phaseName(timer), "집중");
  assert.deepEqual(pomodoroRounds(timer), { done: 0, total: 4, focusing: true });
  timer = nextPhase(timer, now)!;
  assert.equal(phaseName(timer), "휴식");
  assert.deepEqual(pomodoroRounds(timer), { done: 1, total: 4, focusing: false });
  for (let step = 0; step < 6; step += 1) timer = nextPhase(timer, now)!;
  assert.equal(phaseName(timer), "긴 휴식");
  assert.deepEqual(pomodoroRounds(timer), { done: 0, total: 4, focusing: false }, "a new cycle after the long rest");
});

test("1.25: a running time is sized by its form's widest text (the board never changes width as it ticks)", () => {
  const texts = ["10:00", "09:59", "01:11", "00:08", "59:59"].map((text) => clockTemplate(text));
  assert.deepEqual([...new Set(texts)], ["88:88"]);
  assert.equal(clockTemplate("1:00:00"), "8:88:88");
  assert.equal(clockTemplate(clock(3_599_000)), "88:88");
  assert.equal(clockTemplate(clock(3_600_000)), "8:88:88", "an hour on the dot is 1:00:00");
});
