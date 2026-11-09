import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { awayBounds, guardWindow, nearDisplay, offscreenMargin, type Box, type GuardedWindow } from "../src/core/offscreen";

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

// #250: the guard itself (core/offscreen.ts guardWindow), on a window that records what reaches the system.
function fakeWindow(start: Box) {
  let bounds = { ...start };
  const listeners: Record<string, (() => void)[]> = {};
  const reached: { call: string; bounds: Box }[] = [];
  const parents: unknown[] = [];
  const overviews: boolean[] = [];
  const spaces: boolean[] = [];
  const window: GuardedWindow = {
    getBounds: () => ({ ...bounds }),
    setBounds: (next) => { bounds = { ...bounds, ...next }; reached.push({ call: "setBounds", bounds: { ...bounds } }); },
    getContentSize: () => [bounds.width, bounds.height],
    setPosition: () => { throw new Error("the system's setPosition was called"); },
    setSize: () => { throw new Error("the system's setSize was called"); },
    setContentSize: () => { throw new Error("the system's setContentSize was called"); },
    center: () => { throw new Error("the system's center was called"); },
    show: () => reached.push({ call: "show", bounds: { ...bounds } }),
    showInactive: () => reached.push({ call: "showInactive", bounds: { ...bounds } }),
    focus: () => reached.push({ call: "focus", bounds: { ...bounds } }),
    setParentWindow: (parent) => { parents.push(parent); },
    setHiddenInMissionControl: (hidden) => { overviews.push(hidden); },
    setVisibleOnAllWorkspaces: (visible) => { spaces.push(visible); },
    isDestroyed: () => false,
    getTitle: () => "Jongi-nyang",
    on: (event, listener) => { (listeners[event] ??= []).push(listener); },
  };
  return {
    window, reached, parents, overviews, spaces,
    /** The system moves it (a display change, macOS pulling it back) and says so. */
    systemMoves: (to: Partial<Box>, event = "move") => { bounds = { ...bounds, ...to }; for (const listener of listeners[event] ?? []) listener(); },
    get bounds() { return bounds; },
  };
}

test("offscreen guard: every place, size, show and focus the app asks for stays far off every display", () => {
  const putBack: string[] = [];
  // Made where the system put it: centred on the main display.
  const fake = fakeWindow({ x: 645, y: 210, width: 420, height: 560 });
  guardWindow(fake.window, { displays: () => displays, home, noOwners: false, hideFromOverviews: false, oneSpace: false, putBack: (_bounds, why) => putBack.push(why) });
  assert.equal(nearDisplay(fake.bounds, displays), false, "made: away before anything else");
  const asks: [string, () => void][] = [
    ["setBounds on the screen", () => fake.window.setBounds({ x: 1200, y: 900, width: 781, height: 114 })],
    ["setPosition on the screen", () => fake.window.setPosition(51, 191)],
    ["setPosition on the second display", () => fake.window.setPosition(2000, 300)],
    ["setSize", () => fake.window.setSize(820, 640)],
    ["setContentSize", () => fake.window.setContentSize(920, 676)],
    ["center", () => fake.window.center()],
    ["a width only", () => fake.window.setBounds({ width: 156 })],
    ["show", () => fake.window.show()],
    ["showInactive", () => fake.window.showInactive()],
    ["focus", () => fake.window.focus()],
  ];
  for (const [name, ask] of asks) {
    ask();
    assert.equal(nearDisplay(fake.bounds, displays), false, name);
  }
  // Nothing the system was handed was near a display: not a place, not a window shown or focused where it stood.
  for (const step of fake.reached) assert.equal(nearDisplay(step.bounds, displays), false, `${step.call} at ${JSON.stringify(step.bounds)}`);
  assert.equal(fake.bounds.width, 156);
  // None of those needed putting back afterwards: each was stopped before it reached the system.
  assert.deepEqual(putBack, []);
});

test("offscreen guard: a window the system moves, resizes or shows near a display goes back at once, and says so", () => {
  const putBack: string[] = [];
  const fake = fakeWindow({ x: -39_900, y: -39_900, width: 420, height: 560 });
  guardWindow(fake.window, { displays: () => displays, home, noOwners: false, hideFromOverviews: false, oneSpace: false, putBack: (_bounds, why) => putBack.push(why) });
  fake.systemMoves({ x: 1200, y: 900 });
  assert.deepEqual({ x: fake.bounds.x, y: fake.bounds.y }, home);
  fake.systemMoves({ x: 51, y: 191, width: 156, height: 365 }, "resize");
  assert.deepEqual(fake.bounds, { ...home, width: 156, height: 365 });
  fake.systemMoves({ x: 300, y: 300 }, "show");
  assert.equal(nearDisplay(fake.bounds, displays), false);
  assert.deepEqual(putBack, ["moved", "resized", "shown"]);
});

test("offscreen guard: on a Mac no window keeps an owner, so none is shown as another's child", () => {
  const fake = fakeWindow({ x: -39_900, y: -39_900, width: 468, height: 260 });
  guardWindow(fake.window, { displays: () => displays, home, noOwners: true, hideFromOverviews: false, oneSpace: false });
  assert.deepEqual(fake.parents, [null], "made with an owner: let go of it");
  fake.window.setParentWindow(null);
  assert.deepEqual(fake.parents, [null], "a later owner never reaches the system");
  const elsewhere = fakeWindow({ x: -39_900, y: -39_900, width: 468, height: 260 });
  guardWindow(elsewhere.window, { displays: () => displays, home, noOwners: false, hideFromOverviews: false, oneSpace: false });
  assert.deepEqual(elsewhere.parents, []);
});

test("offscreen: no window is placed, sized or shown by a call the guard doesn't take over", () => {
  // The guard (core/offscreen.ts guardWindow) takes over setBounds, setPosition, setSize, setContentSize, center, show,
  // showInactive, focus and the owner. These would let the system pick a place, so the app never calls them.
  const folder = path.join(process.cwd(), "src/main");
  const found: string[] = [];
  for (const name of fs.readdirSync(folder).filter((file) => file.endsWith(".ts"))) {
    const lines = fs.readFileSync(path.join(folder, name), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (/\.(setContentBounds|maximize|setFullScreen|setSimpleFullScreen|setKiosk|showDefinitionForSelection|previewFile)\(/.test(line)) found.push(`${name}:${index + 1}`);
      // setBounds' second argument (animate, macOS): the system moves the window in steps the guard doesn't see.
      if (/\.setBounds\([^;]*,\s*true\s*\)/.test(line)) found.push(`${name}:${index + 1} (animated)`);
    });
  }
  assert.deepEqual(found, []);
  const guard = fs.readFileSync(path.join(process.cwd(), "src/core/offscreen.ts"), "utf8");
  for (const method of ["setBounds", "setPosition", "setSize", "setContentSize", "center", "show", "showInactive", "focus", "setParentWindow"]) {
    assert.match(guard, new RegExp(`window\\.${method} = `), `the guard takes over ${method}`);
  }
});

test("offscreen guard: on a Mac every window stays out of Mission Control and App Exposé", () => {
  // They draw a Space's windows shrunk onto the screen, the off-screen ones too (#250: the cat at 791×116, 0.46 of 1710×250).
  const fake = fakeWindow({ x: -39_900, y: -39_900, width: 1710, height: 250 });
  guardWindow(fake.window, { displays: () => displays, home, noOwners: true, hideFromOverviews: true, oneSpace: false });
  assert.deepEqual(fake.overviews, [true]);
  fake.window.setHiddenInMissionControl(false);
  assert.deepEqual(fake.overviews, [true], "never shown there again");
  const windows = fakeWindow({ x: -39_900, y: -39_900, width: 334, height: 780 });
  guardWindow(windows.window, { displays: () => displays, home, noOwners: false, hideFromOverviews: false, oneSpace: false });
  assert.deepEqual(windows.overviews, []);
  assert.match(fs.readFileSync(path.join(process.cwd(), "src/main/offscreenGuard.ts"), "utf8"), /hideFromOverviews: process\.platform === "darwin"/);
});

test("offscreen guard: on a Mac every window stays on one Space", () => {
  // #307: the system moves a window that is on every Space on its own: a perf run's cat, kept at -38846 by the app, was
  // caught on the screen shrunk to 3×2 at (773, 454).
  const fake = fakeWindow({ x: -38_846, y: -39_143, width: 360, height: 250 });
  guardWindow(fake.window, { displays: () => displays, home, noOwners: true, hideFromOverviews: true, oneSpace: true });
  fake.window.setVisibleOnAllWorkspaces(true);
  fake.window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  assert.deepEqual(fake.spaces, [], "never on every Space");
  const elsewhere = fakeWindow({ x: -38_846, y: -39_143, width: 360, height: 250 });
  guardWindow(elsewhere.window, { displays: () => displays, home, noOwners: false, hideFromOverviews: false, oneSpace: false });
  elsewhere.window.setVisibleOnAllWorkspaces(true);
  assert.deepEqual(elsewhere.spaces, [true]);
  assert.match(fs.readFileSync(path.join(process.cwd(), "src/main/offscreenGuard.ts"), "utf8"), /oneSpace: process\.platform === "darwin"/);
});

test("offscreen: a snapshot run fails when the guard had to put a window back", () => {
  // #250: such a window was near a display for a moment (the question slip, an owned window, at 320 802 before owners
  // went on a Mac). The watch may miss a frame; the run counts the guard's `put back` lines and fails on any.
  const runner = fs.readFileSync(path.join(process.cwd(), "tools/snapshot.mjs"), "utf8");
  assert.match(runner, /putBacks\(log\)/);
  assert.match(runner, /stopped\(\) \|\| back\.length \? 1/);
  const watch = fs.readFileSync(path.join(process.cwd(), "tools/offscreen-watch.mjs"), "utf8");
  assert.match(watch, /line\.startsWith\("put back "\)/);
  assert.match(fs.readFileSync(path.join(process.cwd(), "src/main/offscreenGuard.ts"), "utf8"), /note\(`put back /);
});
