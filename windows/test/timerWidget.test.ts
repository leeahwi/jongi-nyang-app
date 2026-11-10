import assert from "node:assert/strict";
import { test } from "node:test";
import { clampTimer, defaultTimerOrigin, reminderReserve, timerEmptyTop, timerWindowSize, timerWindowSizeFor } from "../src/core/timerWidget";

const { width, height } = timerWindowSize;
const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const right = { x: 1920, y: 0, width: 1280, height: 1000 };

test("default spot: bottom-right above the taskbar, clear of the reminders' corner", () => {
  const origin = defaultTimerOrigin(primary);
  assert.ok(origin.x + width <= primary.width - reminderReserve, "left of where reminders appear");
  assert.ok(origin.x >= primary.x + primary.width / 2, "still in the right half");
  assert.ok(origin.y + height <= primary.height, "above the taskbar");
  assert.ok(origin.y + height >= primary.height - 40, "close to it");
  const second = defaultTimerOrigin(right);
  assert.equal(right.x + right.width - second.x, primary.x + primary.width - origin.x, "same corner on another display");
  assert.equal(second.y, right.height - (primary.height - origin.y));
});

test("default spot on a display too narrow for the reminders' corner stays on it", () => {
  const small = { x: 100, y: 50, width: 500, height: 400 };
  const origin = defaultTimerOrigin(small);
  assert.ok(origin.x >= small.x - 40 && origin.x + width <= small.x + small.width + 40);
  assert.ok(origin.y + height <= small.y + small.height);
});

test("clamping keeps the board on the display under the window's centre", () => {
  const areas = [primary, right];
  assert.deepEqual(clampTimer({ x: 500, y: 300 }, areas), { x: 500, y: 300 }, "inside: untouched");
  assert.deepEqual(clampTimer({ x: -300, y: 2000 }, areas), { x: -40, y: primary.height - height }, "off the bottom-left corner");
  assert.deepEqual(clampTimer({ x: 2400, y: -300 }, areas), { x: 2400, y: -timerEmptyTop }, "the empty top hangs over the top: the cat reaches it");
  assert.deepEqual(clampTimer({ x: 3300, y: 900 }, areas), { x: 1920 + 1280 - width + 40, y: 1000 - height }, "the right display's own bottom");
  assert.deepEqual(clampTimer({ x: 1, y: 2 }, []), { x: 1, y: 2 }, "no displays: left alone");
});

// #327: a display above, shifted left, and one to the right, 300px lower; dragged to the top of each, the cat's ears go
// right up to it (they stopped about 80px below), and across the line between two it goes onto the one it is mostly on.
test("dragged to the top of another display, the cat goes right up to it", () => {
  const laptop = { x: 0, y: 0, width: 1536, height: 816 };
  const above = { x: -400, y: -1440, width: 2560, height: 1400 };
  const lower = { x: 1536, y: 300, width: 1920, height: 1040 };
  const areas = [laptop, above, lower];
  const ears = (origin: { y: number }, size = timerWindowSize) => origin.y + Math.round(timerEmptyTop * size.height / timerWindowSize.height);
  const top = clampTimer({ x: 300, y: -1600 }, areas);
  assert.deepEqual(top, { x: 300, y: -1440 - timerEmptyTop }, "the display above");
  assert.equal(ears(top), above.y, "its ears at that display's top");
  assert.equal(ears(clampTimer({ x: 2000, y: 100 }, areas)), lower.y, "the display to the right, lower down");
  assert.deepEqual(clampTimer({ x: 600, y: -250 }, areas), { x: 600, y: -40 - height }, "across the line, mostly above: its board onto the display above");
  assert.deepEqual(clampTimer({ x: 600, y: -200 }, areas), { x: 600, y: -timerEmptyTop }, "between the two, nearer the laptop: up to the laptop's top");
  const large = timerWindowSizeFor("extraLarge");
  assert.equal(ears(clampTimer({ x: 300, y: -1700 }, areas, large), large), above.y, "아주 크게 too");
  assert.deepEqual(clampTimer({ x: 300, y: 700 }, areas, large), { x: 300, y: laptop.height - large.height }, "아주 크게 keeps its board above the taskbar");
});
