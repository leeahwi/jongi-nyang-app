/**
 * Off-screen runs (#92: snapshots, tests, perf): where a window may be. Every display grown by `margin` is out of
 * bounds; a window that would touch that is put back at `home` (its size kept). Electron's own types aren't used so
 * the rule is tested on its own (test/offscreen.test.ts); main/offscreenGuard.ts applies it to every window.
 */
export interface Box { x: number; y: number; width: number; height: number }

/** Room kept between an off-screen window and any display, so a move by a window's width still lands nowhere. */
export const offscreenMargin = 4000;

export function nearDisplay(bounds: Box, displays: readonly Box[], margin = offscreenMargin): boolean {
  return displays.some((area) => bounds.x < area.x + area.width + margin && area.x - margin < bounds.x + bounds.width
    && bounds.y < area.y + area.height + margin && area.y - margin < bounds.y + bounds.height);
}

/** `wanted` where it is when that is far off every display, else at `home` with the same size. */
export function awayBounds(wanted: Box, displays: readonly Box[], home: { x: number; y: number }): Box {
  return nearDisplay(wanted, displays) ? { x: home.x, y: home.y, width: wanted.width, height: wanted.height } : wanted;
}
