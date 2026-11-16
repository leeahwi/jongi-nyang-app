import type { Point } from "./placement";
import type { Rect } from "./slipMove";

/**
 * #408: every window the person drags by its page (달력 위젯 · 타이머 · 접은 노트 · 타닥냥 · 질문 쪽지 · 빠른 입력 ·
 * 빠른 메모) moves the same way. The press keeps where the pointer was and the window's bounds with the size it should
 * have; each move puts the whole bounds — that size, never one read again from the window (#316: at 125 % · 150 %
 * Windows can round it up a pixel a move, and setPosition re-reads it) — where the pointer has taken it. `keep` may
 * move that place (a slip keeps its head on the screen).
 */
export interface DragStart { cursor: Point; bounds: Rect }

export function dragStart(cursor: Point, bounds: Rect): DragStart {
  return { cursor: { x: cursor.x, y: cursor.y }, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
}

export function dragBounds(start: DragStart, cursor: Point, keep?: (moved: Rect) => Point): Rect {
  const { width, height } = start.bounds;
  const moved = { x: start.bounds.x + cursor.x - start.cursor.x, y: start.bounds.y + cursor.y - start.cursor.y, width, height };
  const at = keep ? keep(moved) : moved;
  return { x: Math.round(at.x), y: Math.round(at.y), width, height };
}
