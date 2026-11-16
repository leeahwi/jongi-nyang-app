import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { dragBounds, dragStart } from "../src/core/dragBounds";
import { draggedSlip, type Rect } from "../src/core/slipMove";

// #408: one way to drag a window by its page — the six copies (달력 위젯 · 타이머 · 접은 노트 · 타닥냥 · 질문 쪽지 ·
// 빠른 입력 · 빠른 메모) now share core/dragBounds.ts.
const source = (file: string) => fs.readFileSync(path.join(process.cwd(), "src", file), "utf8");

/** A window at a display scale, as test/petFloor.test.ts models it: getBounds() can come back a pixel larger. */
class ScaledWindow {
  private physical: Rect = { x: 0, y: 0, width: 0, height: 0 };
  constructor(private readonly scale: number, bounds: Rect) { this.setBounds(bounds); }
  setBounds(bounds: Rect): void {
    const s = this.scale;
    this.physical = { x: Math.round(bounds.x * s), y: Math.round(bounds.y * s), width: Math.ceil(bounds.width * s - 1e-9), height: Math.ceil(bounds.height * s - 1e-9) };
  }
  getBounds(): Rect {
    const s = this.scale, p = this.physical;
    const x = Math.floor(p.x / s + 1e-9), y = Math.floor(p.y / s + 1e-9);
    return { x, y, width: Math.ceil((p.x + p.width) / s - 1e-9) - x, height: Math.ceil((p.y + p.height) / s - 1e-9) - y };
  }
}

test("drag bounds: the window follows the pointer from where it was pressed, at the size it started with", () => {
  const start = dragStart({ x: 500, y: 300 }, { x: 100, y: 80, width: 236, height: 180 });
  assert.deepEqual(dragBounds(start, { x: 500, y: 300 }), { x: 100, y: 80, width: 236, height: 180 });
  assert.deepEqual(dragBounds(start, { x: 540.6, y: 270.2 }), { x: 141, y: 50, width: 236, height: 180 });
  assert.deepEqual(dragBounds(start, { x: -20, y: 1300 }), { x: -420, y: 1080, width: 236, height: 180 });
});

test("drag bounds: the press is copied, so a window moved meanwhile doesn't move the start", () => {
  const bounds = { x: 10, y: 20, width: 30, height: 40 }, cursor = { x: 1, y: 2 };
  const start = dragStart(cursor, bounds);
  bounds.width = 99; cursor.x = 50;
  assert.deepEqual(dragBounds(start, { x: 1, y: 2 }), { x: 10, y: 20, width: 30, height: 40 });
});

test("drag bounds: `keep` places the moved bounds (a slip's head kept in the work area), still the start's size, rounded", () => {
  const area = { x: 0, y: 0, width: 1536, height: 824 };
  const stage = { top: 16, side: 24, bottom: 30 };
  const start = dragStart({ x: 400, y: 300 }, { x: 300, y: 200, width: 388, height: 246 });
  const keep = (moved: Rect) => {
    const slip = { x: moved.x + stage.side, y: moved.y + stage.top, width: moved.width - 2 * stage.side, height: moved.height - stage.top - stage.bottom };
    const to = draggedSlip(slip, 0, 0, area);
    return { x: to.x - stage.side, y: to.y - stage.top };
  };
  // Up past the top: the head stops at the work area's top.
  assert.deepEqual(dragBounds(start, { x: 400.4, y: -500 }, keep), { x: 300, y: -16, width: 388, height: 246 });
  // The same as the slips' old sum: draggedSlip of the start's slip, moved by the pointer.
  const old = draggedSlip({ x: 324, y: 216, width: 340, height: 200 }, 900, 50, area);
  assert.deepEqual(dragBounds(start, { x: 1300, y: 350 }, keep), { x: Math.round(old.x - 24), y: Math.round(old.y - 16), width: 388, height: 246 });
});

test("drag bounds (#316 · #408): at 125 % · 150 % the widget's old drag — the size read again each move — grew; the stored size doesn't", () => {
  for (const scale of [1.25, 1.5]) {
    const size = { width: 263, height: 205 };
    const old = new ScaledWindow(scale, { x: 100.4, y: 200.6, ...size });
    const now = new ScaledWindow(scale, { x: 100.4, y: 200.6, ...size });
    const start = dragStart({ x: 0, y: 0 }, { ...now.getBounds(), ...size });
    const oldStart = { cursor: { x: 0, y: 0 }, origin: { x: old.getBounds().x, y: old.getBounds().y } };
    for (let step = 1; step <= 200; step++) {
      const cursor = { x: step * 1.7, y: step * 0.9 };
      old.setBounds({ ...old.getBounds(), x: Math.round(oldStart.origin.x + cursor.x), y: Math.round(oldStart.origin.y + cursor.y) });
      now.setBounds(dragBounds(start, cursor));
    }
    assert.ok(old.getBounds().width > size.width + 1, `${scale}: the old way grew to ${old.getBounds().width}`);
    const { width, height } = now.getBounds();
    assert.ok(width <= size.width + 1 && height <= size.height + 1, `${scale}: ${width}×${height}`);
  }
});

test("drag bounds: the six windows dragged by their page all move through dragBounds, none with its own sum", () => {
  for (const file of ["main/calendarWidget.ts", "main/timer.ts", "main/floating.ts", "main/typingCat.ts", "main/confirm.ts", "main/slipWindow.ts"]) {
    const text = source(file);
    assert.match(text, /\.setBounds\(dragBounds\(/, file);
    assert.doesNotMatch(text, /cursor\.x - [\w.]*drag[\w.]*\.cursor\.x|x - drag\.x/, `${file} works the place out itself`);
  }
  // The widget's press keeps the size of its kind, style and scale; a move never asks the window for it again.
  const widget = source("main/calendarWidget.ts");
  assert.match(widget, /entry\.drag = dragStart\(screen\.getCursorScreenPoint\(\), \{ x, y, width, height \}\);/);
  const move = widget.slice(widget.indexOf('ipcMain.on("widget:drag",'), widget.indexOf('ipcMain.on("widget:drag-end",'));
  assert.doesNotMatch(move, /getBounds\(\)/);
});
