import { widgetPressWhileUp, type AskedUp, type WidgetPress } from "../core/slipMove";
import { paper } from "./api";

/**
 * #253 (docs/plans/widget-ask-cases.json): the desktop calendar widgets and their day sheet aren't held up by a question
 * (they don't bring in askGuard.ts): they listen for what is up (main/confirm.ts sends "slip:asking" with whether the
 * question replaces the whole list) and wait only where core/slipMove.ts `widgetPressWhileUp` says so. A press that waits
 * brings the question forward and shakes it once (`slipBlocked`); main checks the same rule again for what is put in.
 */
let up: AskedUp = "none";
const listeners: ((up: AskedUp) => void)[] = [];

function set(next: AskedUp): void {
  if (next === up) return;
  up = next;
  for (const listener of listeners) listener(up);
}

paper().on("slip:asking", (on, replacesList) => set(on === true ? (replacesList === true ? "replacesList" : "question") : "none"));

/** What is up now. */
export function askedUp(): AskedUp { return up; }

/** Told again when the page opens (the day sheet, made while a question was already up). */
export function tellAsked(value: unknown): void {
  if (value === "none" || value === "question" || value === "replacesList") set(value);
}

/** Called whenever what is up changes. */
export function onAsked(listener: (up: AskedUp) => void): void { listeners.push(listener); }

/** `press` has to wait for the answer now: the question is brought forward and shakes once (true), or it goes on (false). */
export function waitsForAnswer(press: WidgetPress): boolean {
  if (widgetPressWhileUp(press, up) !== "waits") return false;
  void paper().act({ type: "slipBlocked" });
  return true;
}
