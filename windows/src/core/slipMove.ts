import type { PageName } from "./ipcCheck";

/**
 * 질문 쪽지 옮기기 · 막힌 클릭 (#228 · #229, docs/plans/slip-move-cases.json; the Mac's SlipMove · SlipModal). Kept out of
 * Electron so the rules are tested on their own (test/slipMove.test.ts).
 */
export interface Rect { x: number; y: number; width: number; height: number }

/** The slip's head (its badge and title) stays on the screen: the top this much of the paper. */
export const slipHead = 44;
/** Sideways, at least this much of the slip stays on the screen. */
export const slipKeep = 80;

/**
 * Where the slip's paper `slip` goes dragged by (dx, dy), its head kept inside `area` (the work area of the display with
 * the pointer, or the page for a slip drawn in one); no `area` (the pointer on no display) follows the drag as it is.
 */
export function draggedSlip(slip: Rect, dx: number, dy: number, area?: Rect): { x: number; y: number } {
  let x = slip.x + dx, y = slip.y + dy;
  if (!area) return { x, y };
  y = Math.min(Math.max(y, area.y), area.y + area.height - slipHead);
  x = Math.min(Math.max(x, area.x + slipKeep - slip.width), area.x + area.width - slipKeep);
  return { x, y };
}

/**
 * #246: where a slip that hangs nowhere (빠른 입력 · 빠른 메모) was dragged, kept per display for the next time it opens: its
 * top-left from the top-left of the display's work area, and that area's size then. The Mac's SlipMove.Place.
 */
export interface SlipPlace { dx: number; dy: number; areaWidth: number; areaHeight: number }

/** The place to keep for `slip` dropped in `area`. */
export function slipPlace(slip: Rect, area: Rect): SlipPlace {
  return { dx: slip.x - area.x, dy: slip.y - area.y, areaWidth: area.width, areaHeight: area.height };
}

/**
 * Where a slip of `size` opens on `area` from its kept `place` (its top-left, its head kept on the screen as a drag keeps
 * it); undefined — the default spot — when nothing is kept, or the display's work area changed size since (another
 * resolution, a taskbar moved): a display change brings it back to where it usually opens.
 */
export function placedSlip(place: SlipPlace | undefined, size: { width: number; height: number }, area: Rect): { x: number; y: number } | undefined {
  if (!place || Math.abs(place.areaWidth - area.width) >= 1 || Math.abs(place.areaHeight - area.height) >= 1) return undefined;
  return draggedSlip({ x: area.x + place.dx, y: area.y + place.dy, ...size }, 0, 0, area);
}

/** A kept place read back from the settings file: four finite numbers, or nothing. */
export function readSlipPlace(value: unknown): SlipPlace | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { dx, dy, areaWidth, areaHeight } = value as Record<string, unknown>;
  return [dx, dy, areaWidth, areaHeight].every((part) => typeof part === "number" && Number.isFinite(part))
    ? { dx: dx as number, dy: dy as number, areaWidth: areaWidth as number, areaHeight: areaHeight as number } : undefined;
}

/**
 * #229: the pages a question holds up while it waits (their clicks and keys don't go through; a press brings the question
 * forward, shakes it and beeps — renderer/askGuard.ts, imported by each of these). Not the question itself, and not a
 * ringing alarm, which can always be stopped. The desk's panes are frames of their own, each held up.
 */
export const heldPages: ReadonlySet<PageName> = new Set<PageName>([
  "note", "popup", "floating", "settings", "history", "calendarWindow", "pet", "timer", "help", "quick", "quickMemo", "timerSheet",
  "glance", "desk", "drawer", "handle", "ears",
  // (#253: not the desktop calendar widgets and their day sheet — `widgetPressWhileUp` says what works there.)
]);

/** What a press on `page` does while `up` is showing: a question holds the held pages; a settings slip holds nothing. */
export function pressWhileUp(page: PageName, up: "question" | "settings"): "nudge" | "works" {
  return up === "question" && heldPages.has(page) ? "nudge" : "works";
}

/**
 * #253 (docs/plans/widget-ask-cases.json): what is up — no question, a question, or one that replaces the whole list (its
 * answer swaps the list for a backup or a shared folder's, `ConfirmQuestion.replacesList`).
 */
export type AskedUp = "none" | "question" | "replacesList";
/** What was done on a widget or its day sheet: ‹ › paging, hovering, a day opened, the sheet's day before or after, a line
 * put in, one taken back, or a line opening the note or the desk's calendar. */
export type WidgetPress = "page" | "hover" | "openSheet" | "sheetDay" | "add" | "undo" | "open";
/** works: as ever. waits: held for the answer (the sheet's ↩ 넣기 dims; a press nudges the question, the text stays).
 * front: the window comes forward and the question stays over it. nudge: the question's own window — as #229. */
export type WidgetOutcome = "works" | "waits" | "front" | "nudge";

/**
 * #253: the widgets and their day sheet aren't held up by a question (answering one often means looking at the calendar).
 * Looking always works; putting in and taking back wait only while the question replaces the whole list (what went in
 * would be lost with the list); a line that opens the note or the desk brings it forward under the question — `over`, the
 * window the question was asked over, nudges as a press there would.
 */
export function widgetPressWhileUp(press: WidgetPress, up: AskedUp, over = false): WidgetOutcome {
  if (up === "none") return "works";
  if (press === "open") return over ? "nudge" : "front";
  if (press === "add" || press === "undo") return up === "replacesList" ? "waits" : "works";
  return "works";
}

/** The window levels, top first (widget-ask-cases.json `levels`): Electron's, with a relative level over the one named
 * (macOS reads it; on Windows the last raised of the always-on-top windows is on top, so the question is raised last). */
export const askLevels = {
  question: { level: "pop-up-menu", relative: 1 },
  sheet: { level: "pop-up-menu", relative: 0 },
  widgetOnTop: { level: "floating", relative: 0 },
} as const;

/** The nudge (slip-move-cases.json `nudge`): the shake's swings (px) over 톡 (`motion.bounce`), split evenly; under Reduce
 * Motion the tape's opacities instead, 살짝 (`motion.quick`) each. */
export const nudgeShake: readonly number[] = [-7, 6, -4, 2, 0];
export const nudgeBlink: readonly number[] = [0.25, 1, 0.25, 1];
export const nudgeMotion = { shake: "bounce", blinkStep: "quick" } as const;

/** #229: the open settings slips, one per key (a space's times): asked again, the one open comes forward. */
export class SlipShelf<T> {
  private readonly open = new Map<string, T>();

  /** The slip open for `key`, or a new one from `make`; `isNew` tells which. */
  take(key: string, make: () => T): { slip: T; isNew: boolean } {
    const found = this.open.get(key);
    if (found !== undefined) return { slip: found, isNew: false };
    const slip = make();
    this.open.set(key, slip);
    return { slip, isNew: true };
  }

  /** The slip for `key` went away. */
  drop(key: string): void { this.open.delete(key); }

  get size(): number { return this.open.size; }
}
