import assert from "node:assert/strict";
import { test } from "node:test";
import { clampTimer, defaultTimerOrigin, reminderReserve, timerWindowSize } from "../src/core/timerWidget";

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
  assert.deepEqual(clampTimer({ x: 2400, y: -300 }, areas), { x: 2400, y: -40 }, "the empty top may hang over the top a little");
  assert.deepEqual(clampTimer({ x: 3300, y: 900 }, areas), { x: 1920 + 1280 - width + 40, y: 1000 - height }, "the right display's own bottom");
  assert.deepEqual(clampTimer({ x: 1, y: 2 }, []), { x: 1, y: 2 }, "no displays: left alone");
});
