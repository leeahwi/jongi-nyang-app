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
