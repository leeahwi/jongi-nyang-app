import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { awayBounds, nearDisplay, offscreenMargin } from "../src/core/offscreen";

// #92 (2026-11-03): off-screen runs keep every window far off every display (main/offscreenGuard.ts).
const displays = [{ x: 0, y: 0, width: 1512, height: 982 }, { x: 1512, y: -200, width: 2560, height: 1440 }];
const home = { x: -39_900, y: -39_900 };

test("offscreen: a window far off every display stays where it is; near or on one, it goes home with its size", () => {
  const away = { x: -39_900, y: -39_900, width: 920, height: 680 };
  assert.equal(nearDisplay(away, displays), false);
  assert.deepEqual(awayBounds(away, displays, home), away);
  // The 2026-11-03 window: partly on the main display's top-left.
  assert.deepEqual(awayBounds({ x: -279, y: -295, width: 437, height: 321 }, displays, home), { ...home, width: 437, height: 321 });
  // A window made without a place (centred on a display), and one just inside the margin.
  assert.deepEqual(awayBounds({ x: 296, y: 151, width: 920, height: 680 }, displays, home), { ...home, width: 920, height: 680 });
  const close = { x: -920 - offscreenMargin + 10, y: 0, width: 920, height: 680 };
  assert.equal(nearDisplay(close, displays), true);
  assert.equal(nearDisplay({ ...close, x: close.x - 20 }, displays), false);
  // The second display counts as much as the first.
  assert.equal(nearDisplay({ x: 5000, y: 100, width: 300, height: 300 }, displays), true);
});

test("offscreen: every window the app makes may stand off every display (enableLargerThanScreen in an off-screen run)", () => {
  const folder = path.join(process.cwd(), "src/main");
  const missing: string[] = [];
  for (const name of fs.readdirSync(folder).filter((file) => file.endsWith(".ts"))) {
    const text = fs.readFileSync(path.join(folder, name), "utf8");
    let at = text.indexOf("new BrowserWindow(");
    while (at >= 0) {
      // The constructor's options: up to the next window, at most the 1,500 characters after it (or the slips' shared options).
      const next = text.indexOf("new BrowserWindow(", at + 1);
      const options = text.slice(at, Math.min(at + 1500, next >= 0 ? next : text.length));
      if (!/enableLargerThanScreen|slipWindowOptions\(/.test(options)) missing.push(`${name}:${text.slice(0, at).split("\n").length}`);
      at = next;
    }
  }
  assert.deepEqual(missing, []);
  assert.match(fs.readFileSync(path.join(folder, "slipWindow.ts"), "utf8"), /enableLargerThanScreen: offscreenEnabled/);
});
