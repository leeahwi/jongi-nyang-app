export interface Point { x: number; y: number }
export interface Size { width: number; height: number }
export interface Rect { x: number; y: number; width: number; height: number }

// Screen coordinates here are Electron's: origin at the top-left, y grows downward.

/** The work area containing `point`, or the closest one. */
export function nearestArea(point: Point, areas: Rect[]): Rect | undefined {
  const inside = areas.find((a) => point.x >= a.x && point.x < a.x + a.width && point.y >= a.y && point.y < a.y + a.height);
  if (inside) return inside;
  const distance = (a: Rect) => {
    const dx = point.x < a.x ? a.x - point.x : point.x > a.x + a.width ? point.x - a.x - a.width : 0;
    const dy = point.y < a.y ? a.y - point.y : point.y > a.y + a.height ? point.y - a.y - a.height : 0;
    return dx * dx + dy * dy;
  };
  return [...areas].sort((a, b) => distance(a) - distance(b))[0];
}

const clamp = (value: number, min: number, max: number) => (min > max ? (min + max) / 2 : Math.min(Math.max(value, min), max));

/** Top-left for an icon centred on `anchor`, kept inside the nearest work area. */
export function iconOrigin(anchor: Point, size: Size, workAreas: Rect[], padding: number): Point {
  const proposed = { x: anchor.x - size.width / 2, y: anchor.y - size.height / 2 };
  const area = nearestArea(anchor, workAreas);
  if (!area) return proposed;
  return {
    x: clamp(proposed.x, area.x + padding, area.x + area.width - size.width - padding),
    y: clamp(proposed.y, area.y + padding, area.y + area.height - size.height - padding),
  };
}

/** Unfolds the note so the spot it was folded from follows the (possibly moved) icon, fully on that display. */
export function noteOrigin(iconCenter: Point, anchorInNote: Point, noteSize: Size, workAreas: Rect[]): Point {
  const proposed = { x: iconCenter.x - anchorInNote.x, y: iconCenter.y - anchorInNote.y };
  const area = nearestArea(iconCenter, workAreas);
  if (!area) return proposed;
  return {
    x: noteSize.width >= area.width ? area.x : clamp(proposed.x, area.x, area.x + area.width - noteSize.width),
    // A note taller than the display keeps its header (and window controls) reachable.
    y: noteSize.height >= area.height ? area.y : clamp(proposed.y, area.y, area.y + area.height - noteSize.height),
  };
}
