import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  CaptionDoubleClick, HTCAPTION, WM_LBUTTONDOWN, WM_NCLBUTTONDBLCLK, WM_NCLBUTTONDOWN, captionMessage, fallbackLimits,
  isButtonPress, limitsFrom, pointFromLParam, type CaptionPress,
} from "../src/core/captionClicks";

// 노트 위쪽을 두 번 눌러 접기 on Windows (#323): the presses Windows posts for the note's title-bar area, decided without
// Windows. Default limits: 500 ms, a 4 × 4 px rectangle around the first press.
const root = process.cwd();
const at = (time: number, x = 100, y = 20, more: Partial<CaptionPress> = {}): CaptionPress => ({ kind: "press", time, x, y, windowX: 300, windowY: 200, ...more });
const double = (time: number, more: Partial<CaptionPress> = {}): CaptionPress => at(time, 100, 20, { kind: "double", ...more });

test("two quick presses on the same spot fold once", () => {
  const clicks = new CaptionDoubleClick();
  assert.equal(clicks.press(at(1000)), false);
  assert.equal(clicks.waiting, true);
  assert.equal(clicks.press(at(1300, 101, 21)), true);
  // A third press right after is the same click again, not a new double-click.
  assert.equal(clicks.press(at(1450)), false);
  assert.equal(clicks.press(at(1600)), false);
});

test("a press then Windows' double-click message folds once, however many ways the message is heard", () => {
  const clicks = new CaptionDoubleClick();
  assert.equal(clicks.press(at(1000)), false);
  assert.equal(clicks.press(double(1200)), true);
  // The same WM_NCLBUTTONDBLCLK through the note's hookWindowMessage too.
  assert.equal(clicks.press(double(1201)), false);
  // A new double-click later folds again (the note was shown again).
  assert.equal(clicks.press(at(5000)), false);
  assert.equal(clicks.press(double(5200)), true);
});

test("Windows' double-click alone folds (the old hook, no mouse hook)", () => {
  const clicks = new CaptionDoubleClick();
  assert.equal(clicks.press(double(1000)), true);
  assert.equal(clicks.press(double(1100)), false);
});

test("slow presses don't fold", () => {
  const clicks = new CaptionDoubleClick();
  assert.equal(clicks.press(at(1000)), false);
  assert.equal(clicks.press(at(1501)), false);
  // The second one may start a double-click of its own.
  assert.equal(clicks.press(at(1800)), true);
});

test("presses further apart than Windows' rectangle don't fold", () => {
  const clicks = new CaptionDoubleClick();
  assert.equal(clicks.press(at(1000, 100, 20)), false);
  assert.equal(clicks.press(at(1200, 103, 20)), false);
  assert.equal(clicks.press(at(1300, 103, 23)), false);
  assert.equal(clicks.press(at(1400, 106, 23)), false);
  // 1 px across and 1 px down from the last press is within the rectangle.
  assert.equal(clicks.press(at(1500, 107, 24)), true);
});

test("Windows' own limits are used when it gives them", () => {
  const clicks = new CaptionDoubleClick(() => ({ time: 900, width: 10, height: 10 }));
  assert.equal(clicks.press(at(1000)), false);
  assert.equal(clicks.press(at(1800, 104, 24)), true);
});

test("a drag between the presses doesn't fold", () => {
  const clicks = new CaptionDoubleClick();
  assert.equal(clicks.press(at(1000)), false);
  // The first press dragged the note 40 px; the pointer came back to the same spot.
  assert.equal(clicks.press(at(1300, 100, 20, { windowX: 340 })), false);
  assert.equal(clicks.press(double(1350, { windowX: 340, windowY: 230 })), false);
});

test("a press, a drag and a release don't fold, and the next press starts afresh", () => {
  const clicks = new CaptionDoubleClick();
  assert.equal(clicks.press(at(1000)), false);
  // Dragged: the note is now elsewhere, the pointer with it.
  assert.equal(clicks.press(at(1400, 180, 60, { windowX: 380, windowY: 240 })), false);
  assert.equal(clicks.press(at(1600, 180, 60, { windowX: 380, windowY: 240 })), true);
});

test("a press that moves the note a pixel or two (a shaky hand) still folds", () => {
  const clicks = new CaptionDoubleClick();
  assert.equal(clicks.press(at(1000)), false);
  assert.equal(clicks.press(at(1250, 101, 20, { windowX: 301, windowY: 201 })), true);
});

test("a press on a tab or a button in between ends the double-click", () => {
  const clicks = new CaptionDoubleClick();
  assert.equal(clicks.press(at(1000)), false);
  clicks.forget();
  assert.equal(clicks.waiting, false);
  assert.equal(clicks.press(at(1200)), false);
});

test("only left presses and double-clicks on the title-bar area count; tabs, buttons and borders are other presses", () => {
  assert.equal(captionMessage(WM_NCLBUTTONDOWN, HTCAPTION), "press");
  assert.equal(captionMessage(WM_NCLBUTTONDBLCLK, HTCAPTION), "double");
  assert.equal(captionMessage(WM_LBUTTONDOWN, 1 /* HTCLIENT: a tab, a button */), "other");
  assert.equal(captionMessage(0x0203 /* WM_LBUTTONDBLCLK */, 1), "other");
  assert.equal(captionMessage(WM_NCLBUTTONDOWN, 10 /* HTLEFT: the resize border */), "other");
  assert.equal(captionMessage(0x00a4 /* WM_NCRBUTTONDOWN */, HTCAPTION), "other");
  assert.equal(captionMessage(0x00a2 /* WM_NCLBUTTONUP */, HTCAPTION), undefined);
  assert.equal(captionMessage(0x00a0 /* WM_NCMOUSEMOVE */, HTCAPTION), undefined);
  assert.equal(captionMessage(0x0200 /* WM_MOUSEMOVE */, 1), undefined);
  assert.equal(isButtonPress(0x020a /* WM_MOUSEWHEEL */), false);
});

test("a message's point reads screens left of and above the main display", () => {
  assert.deepEqual(pointFromLParam(0x00140064), { x: 100, y: 20 });
  assert.deepEqual(pointFromLParam(0xfff6fffb), { x: -5, y: -10 });
  assert.deepEqual(pointFromLParam(-589829n /* the same, sign-extended to 64 bits */), { x: -5, y: -10 });
});

test("Windows' limits fall back to its defaults when they can't be right", () => {
  assert.deepEqual(limitsFrom(400, 6, 6), { time: 400, width: 6, height: 6 });
  assert.deepEqual(limitsFrom(0, 0, Number.NaN), fallbackLimits);
});

test("the mouse hook is this thread's only, never a system-wide one, and passes every message on", () => {
  const source = fs.readFileSync(path.join(root, "src/main/captionClicks.ts"), "utf8");
  assert.match(source, /setWindowsHookEx\(WH_MOUSE, registered, 0, getCurrentThreadId\(\)\)/);
  assert.match(source, /return callNextHookEx\(0, nCode, wParam, lParam\);/);
  const main = fs.readFileSync(path.join(root, "src/main/main.ts"), "utf8");
  assert.match(main, /new NoteCaptionClicks\(window, \(point\) => collapse\(point\)\)/);
  assert.match(main, /app\.on\("will-quit", \(\) => \{ typingCat\?\.dispose\(\); noteCaptionClicks\?\.dispose\(\);/);
  // The header stays Windows' own title bar (drag, Aero Snap).
  const css = fs.readFileSync(path.join(root, "src/renderer/note.css"), "utf8");
  assert.match(css, /\.tabs-row \{[^}]*-webkit-app-region: drag;/);
  assert.match(css, /\.title-row \{[^}]*-webkit-app-region: drag;/);
});
