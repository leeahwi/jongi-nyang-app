/**
 * 노트 창 위의 고양이 귀 (#151, the user's pick 2026-10-30): the peeking cat left the note's header; the note window
 * has 메모 서랍's two ears standing on its top edge toward the right, in the note's own paper. The note can't draw
 * above its own frame, so the ears are a small clear window over its top edge that follows it (main/noteEars.ts).
 * Here: where that window goes, when it shows and the ears' shape — the same numbers as the Mac app's
 * NoteEarsPlacement and CatEars (the drawer's ears: 16 px tall, bases 16–48 and 62–92 px in from the right edge).
 */
export interface Rect { x: number; y: number; width: number; height: number }

/** How far the tips stand above the edge. */
export const earHeight = 16;
/** Each ear's base, in from the right edge: the left (far) ear first. */
export const earBases: readonly (readonly [near: number, far: number])[] = [[62, 92], [16, 48]];
/** The window: the ears' 92 px and room beside the far ear for it to twitch. */
export const earsWidth = 100;
/** Room above the tips (a twitching tip and its edge line). */
export const earsRoom = 3;
/** The ears' feet run this far down over the note's top edge, so no seam shows. */
export const earsOverlap = 1;
export const earsHeight = earsRoom + earHeight + earsOverlap;
/** The note's top edge, from the window's top. */
export const earsEdge = earsRoom + earHeight;

/** The ears' window for the note's bounds (screen pixels, y down): flush with its right edge, its foot over the top. */
export function earsBounds(note: Rect): Rect {
  return { x: note.x + note.width - earsWidth, y: note.y - earsEdge, width: earsWidth, height: earsHeight };
}

export interface NoteEarsState {
  /** On screen: not hidden (closed to the tray), not folded into the post-it. */
  visible: boolean;
  minimized: boolean;
  fullScreen: boolean;
  /** Off-screen runs (snapshots, perf): the ears stay off-screen with the note. */
  offscreen: boolean;
}

/**
 * The ears show while the note does and there's room above it in its display's work area (not against the top of the
 * screen, not docked full height). `workArea` undefined: the note is off every display — ears only in off-screen runs.
 */
export function earsShow(note: Rect, workArea: Rect | undefined, state: NoteEarsState): boolean {
  if (!state.visible || state.minimized || state.fullScreen) return false;
  if (!workArea) return state.offscreen;
  return note.y - earHeight >= workArea.y - 0.5;
}

/** The work area of the display the note's top edge is on, or undefined when it is on none. */
export function workAreaUnder(note: Rect, displays: readonly { bounds: Rect; workArea: Rect }[]): Rect | undefined {
  const top: Rect = { x: note.x, y: note.y, width: note.width, height: 1 };
  let best: { area: Rect; overlap: number } | undefined;
  for (const display of displays) {
    const overlap = Math.max(0, Math.min(top.x + top.width, display.bounds.x + display.bounds.width) - Math.max(top.x, display.bounds.x))
      * (top.y >= display.bounds.y && top.y < display.bounds.y + display.bounds.height ? 1 : 0);
    if (overlap > 0 && (!best || overlap > best.overlap)) best = { area: display.workArea, overlap };
  }
  return best?.area;
}

/**
 * #312: on a Windows PC the ears' window was seen opaque grey and about 56 px tall instead of 20 — a box over the
 * note's top right that covered its buttons. Why Windows gave it another size isn't known yet (no Windows PC here), but
 * the size can be read back. The window is 100 × 20 and is never resized on purpose, so any other size is Windows' doing
 * and the window can't be trusted to be the clear strip it should be: placed again, it may show only once it is the
 * size asked for, give or take `earsSizeSlack` (a pixel of rounding at 125 % or 150 % scale).
 */
export const earsSizeSlack = 1;
/** Placings in a row that may come out the wrong size before the ears are left off. */
export const earsSizeTries = 3;

export function earsWindowFits(asked: Rect, actual: Rect): boolean {
  return Math.abs(actual.width - asked.width) <= earsSizeSlack && Math.abs(actual.height - asked.height) <= earsSizeSlack;
}

/**
 * What to do after placing the ears' window and reading its size back: `show` it (the size asked for), `retry` (wrong
 * this time: stay hidden, place it again next time), or leave the ears `off` — Windows kept it the wrong size
 * `earsSizeTries` times in a row. Off lasts until `reset` (a display change: another scale may let it be small again).
 */
export class EarsSizeCheck {
  private misses = 0;
  private gaveUp = false;

  get off(): boolean { return this.gaveUp; }

  check(asked: Rect, actual: Rect): "show" | "retry" | "off" {
    if (this.gaveUp) return "off";
    if (earsWindowFits(asked, actual)) { this.misses = 0; return "show"; }
    this.misses += 1;
    if (this.misses < earsSizeTries) return "retry";
    this.gaveUp = true;
    return "off";
  }

  reset(): void { this.misses = 0; this.gaveUp = false; }
}

export interface EarPaths { a: number; b: number; ear: string; sides: string; inner: string }

/**
 * The two ears in a `width`-wide box whose note edge is `edge` px from the top (y down), left ear first: the paper
 * (its foot `below` px further down), the two sides and the tip (for the hairline edge), the pink inside. The sides go
 * straight up to just under the tip and over a little curve, as the drawer's (MemoDrawerLook.swift `DrawerCat`).
 */
export function earPaths(width = earsWidth, edge = earsEdge, below = earsOverlap): EarPaths[] {
  const tip = edge - earHeight;
  const n = (value: number) => Number(value.toFixed(2));
  return earBases.map(([near, far]) => {
    const a = width - far, b = width - near, peak = (a + b) / 2;
    const sides = `M${n(a)} ${n(edge)} L${n(peak - 1.6)} ${n(tip + 1.8)} Q${n(peak)} ${n(tip)} ${n(peak + 1.6)} ${n(tip + 1.8)} L${n(b)} ${n(edge)}`;
    return {
      a, b,
      ear: `M${n(a)} ${n(edge + below)} L${sides.slice(1)} L${n(b)} ${n(edge + below)} Z`,
      sides,
      inner: `M${n(peak - 5.5)} ${n(tip + 13)} L${n(peak)} ${n(tip + 5)} L${n(peak + 5.5)} ${n(tip + 13)} Z`,
    };
  });
}

/** At most one twitch a second (a finished to-do, a press on an ear). */
export const twitchGap = 1000;
export function mayTwitch(last: number | undefined, now: number): boolean {
  return last === undefined || now - last >= twitchGap;
}
