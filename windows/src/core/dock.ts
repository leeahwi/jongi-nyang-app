/**
 * 화면 오른쪽에 붙이기 / 왼쪽에 붙이기 (편의 기능 16): the note against that edge of its screen's work
 * area at full height (its width kept within the note's limits); the same choice again puts it back
 * where it was. Rectangles in screen points.
 */
export interface Box { x: number; y: number; width: number; height: number }

export function dockFrame(area: Box, bounds: Box, side: "left" | "right", limits = { minWidth: 350, maxWidth: 720, maxHeight: 1200 }): Box {
  const width = Math.min(Math.max(bounds.width, limits.minWidth), limits.maxWidth, area.width);
  const height = Math.min(area.height, limits.maxHeight);
  return { x: side === "right" ? area.x + area.width - width : area.x, y: area.y, width, height };
}

/** The note is still where it was docked (not moved or resized since): a second click restores. */
export function stillDocked(bounds: Box, frame: Box, slack = 2): boolean {
  return Math.abs(bounds.x - frame.x) <= slack && Math.abs(bounds.y - frame.y) <= slack
    && Math.abs(bounds.width - frame.width) <= slack && Math.abs(bounds.height - frame.height) <= slack;
}
