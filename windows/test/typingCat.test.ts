import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  keydownCounts, newTypingCat, readTypingCorner, readTypingScope, tapThrottle, toggledTypingScope, typedWithin, typingCatFrame, typingCatSize,
  typingChatterQuietMs, typingCorners, typingCounts, typingHoldMs, typingKey, typingLingerMs, typingShows, typingSource, typingStop, typingWake,
  type TypingCat, type TypingCorner, type TypingScope, type TypingSource,
} from "../src/core/typingCat";

// 치면 두드리는 고양이 (#230 · #289): the shared cases from docs/plans/typing-cat-cases.json (the Mac's
// test-typing-cat.sh reads the same file), Windows' own key filter and throttle, and that nothing of a key is kept or sent.
const root = process.cwd();
type Step = { at: number; key?: boolean; reduceMotion?: boolean; stop?: string; pose?: string; next?: string; timer?: boolean };
const file = JSON.parse(fs.readFileSync(path.resolve(root, "..", "docs", "plans", "typing-cat-cases.json"), "utf8")) as {
  holdMs: number; lingerMs: number; chatterQuietMs: number;
  paws: { case: string; burst?: { from: number; every: number; count: number }; steps: Step[] }[];
  counts: { case: string; repeat: boolean; command: boolean; control: boolean; counts: boolean }[];
  chatter: { case: string; lastKey: number; now: number; quiet: boolean }[];
  sources: { case: string; scope: TypingScope; granted: boolean; locked: boolean; petShown: boolean; source: TypingSource }[];
  shows: { case: string; source: TypingSource; lastKey?: number; now: number; shows: boolean }[];
  moving: { scope: { case: string; now?: string; before?: string; scope: TypingScope }[]; corner: { case: string; now?: string; before?: string; corner: TypingCorner }[] };
  toggle: { case: string; scope: TypingScope; last?: TypingScope; scopeAfter: TypingScope; lastAfter?: TypingScope }[];
  frames: { case: string; corner: TypingCorner; screen: number[]; topInset: number; frame: number[] }[];
};

/** The app's way of using the rules: one timer at most, woken at its deadline and set again when a newer key moved it. */
class Clock {
  cat: TypingCat = newTypingCat();
  timer?: number;
  wakes = 0;
  advance(now: number): void {
    while (this.timer !== undefined && this.timer <= now) {
      const due = this.timer;
      this.timer = undefined;
      this.wakes += 1;
      this.timer = typingWake(this.cat, due);
    }
  }
  key(now: number, reduceMotion: boolean): void {
    this.advance(now);
    const due = typingKey(this.cat, now, reduceMotion);
    if (due !== undefined && this.timer === undefined) this.timer = due;
  }
  stop(): void {
    typingStop(this.cat);
    this.timer = undefined;
  }
}

test("typing cat: the numbers", () => {
  assert.equal(typingHoldMs, file.holdMs);
  assert.equal(typingLingerMs, file.lingerMs);
  assert.equal(typingChatterQuietMs, file.chatterQuietMs);
});

for (const entry of file.paws) {
  test(`typing cat: ${entry.case}`, () => {
    let steps = entry.steps;
    if (entry.burst) {
      const { from, every, count } = entry.burst;
      const keys: Step[] = Array.from({ length: count }, (_, index) => ({ at: from + index * every, key: true }));
      // Keys first at the same time, then the checks, each in its own order.
      steps = [...keys.map((step, index) => ({ step, rank: 0, index })), ...steps.map((step, index) => ({ step, rank: 1, index }))]
        .sort((a, b) => a.step.at - b.step.at || a.rank - b.rank || a.index - b.index).map(({ step }) => step);
    }
    const clock = new Clock();
    for (const step of steps) {
      if (step.key) clock.key(step.at, step.reduceMotion ?? false);
      else if (step.stop) { clock.advance(step.at); clock.stop(); }
      else {
        clock.advance(step.at);
        const when = `at ${step.at} ms`;
        if (step.pose !== undefined) assert.equal(clock.cat.pose, step.pose, `${when} pose`);
        if (step.next !== undefined) assert.equal(clock.cat.nextPaw, step.next, `${when} next paw`);
        if (step.timer !== undefined) {
          assert.equal(clock.timer !== undefined, step.timer, `${when} a timer waits`);
          assert.equal(clock.cat.returnAt !== undefined, step.timer, `${when} a return waits`);
        }
      }
    }
  });
}

test("typing cat: T5 a burst wakes the one timer only a few times (no clip per key)", () => {
  const clock = new Clock();
  for (let index = 0; index < 40; index += 1) clock.key(index * 10, false);
  clock.advance(10_000);
  assert.ok(clock.wakes <= 5, `wakes: ${clock.wakes}`);
  assert.equal(clock.timer, undefined);
});

test("typing cat: what counts as typing", () => {
  for (const entry of file.counts) assert.equal(typingCounts(entry.repeat, entry.command, entry.control), entry.counts, entry.case);
  const key = (fields: Partial<Parameters<typeof keydownCounts>[0]>) => keydownCounts({ repeat: false, ctrlKey: false, altKey: false, metaKey: false, key: "a", ...fields });
  assert.equal(key({}), true, "a letter");
  assert.equal(key({ key: "Process" }), true, "a key while composing Hangul (each press counts)");
  assert.equal(key({ key: "Shift" }), false, "Shift alone");
  assert.equal(key({ key: "Control", ctrlKey: true }), false, "Ctrl alone");
  assert.equal(key({ key: "Alt", altKey: true }), false, "Alt alone");
  assert.equal(key({ key: "Meta", metaKey: true }), false, "the Windows key alone");
  assert.equal(key({ ctrlKey: true }), false, "Ctrl+C");
  assert.equal(key({ metaKey: true }), false, "a Windows-key shortcut");
  assert.equal(key({ ctrlKey: true, altKey: true }), true, "AltGr (Ctrl + Alt) types a letter");
  assert.equal(key({ repeat: true }), false, "a key held down");
});

test("typing cat: the pet's 종이냥 한마디 waiting", () => {
  for (const entry of file.chatter) {
    const cat = newTypingCat();
    typingKey(cat, entry.lastKey, false);
    assert.equal(typedWithin(cat, typingChatterQuietMs, entry.now), entry.quiet, entry.case);
  }
});

// #289: the pet plays no part — `petShown` is in the cases to say so, and isn't asked.
for (const entry of file.sources) {
  test(`typing cat: ${entry.case}`, () => assert.equal(typingSource(entry.scope, entry.granted, entry.locked), entry.source));
}
for (const entry of file.shows) {
  test(`typing cat: ${entry.case}`, () => assert.equal(typingShows(entry.source, entry.lastKey, entry.now), entry.shows));
}
test("typing cat: the settings moved from the pet's", () => {
  for (const entry of file.moving.scope) assert.equal(readTypingScope(entry.now, entry.before), entry.scope, entry.case);
  for (const entry of file.moving.corner) assert.equal(readTypingCorner(entry.now, entry.before), entry.corner, entry.case);
});
for (const entry of file.toggle) {
  test(`typing cat: ${entry.case}`, () => {
    const toggled = toggledTypingScope(entry.scope, entry.last);
    assert.equal(toggled.scope, entry.scopeAfter);
    if (entry.lastAfter !== undefined) assert.equal(toggled.last, entry.lastAfter);
  });
}
// The Mac's frames are bottom-up; Windows' screen is top-down: the same rule, mirrored (y ↦ −(y + height)).
for (const entry of file.frames) {
  test(`typing cat corner: ${entry.case}`, () => {
    const [x, y, width, height] = entry.screen;
    const area = { x, y: -(y + height), width, height };
    const [fx, fy, fw, fh] = entry.frame;
    assert.deepEqual(typingCatFrame(entry.corner, area, entry.topInset), { x: fx, y: -(fy + fh), width: fw, height: fh });
  });
}
test("typing cat corner: every corner of a work area stays inside it, 112 DIP", () => {
  assert.equal(typingCatSize, 112);
  for (const area of [{ x: 0, y: 0, width: 1920, height: 1040 }, { x: -1280, y: 200, width: 1280, height: 984 }, { x: 0, y: 0, width: 90, height: 70 }]) {
    for (const corner of typingCorners) {
      const frame = typingCatFrame(corner, area);
      assert.ok(frame.x >= area.x && frame.y >= area.y && frame.x + frame.width <= area.x + area.width && frame.y + frame.height <= area.y + area.height, `${corner} in ${JSON.stringify(area)}`);
    }
  }
  assert.deepEqual(typingCatFrame("bottomRight", { x: 0, y: 0, width: 1920, height: 1040 }), { x: 1788, y: 908, width: 112, height: 112 });
});

test("typing cat: a page sends one tap per 50 ms at most, the first of a burst at once", () => {
  const ok = tapThrottle();
  const sent = [0, 10, 49, 50, 51, 99, 100, 300].filter((now) => ok(now));
  assert.deepEqual(sent, [0, 50, 100, 300]);
});

test("typing cat privacy: the rules keep only poses and times", () => {
  const cat = newTypingCat();
  for (let index = 0; index < 30; index += 1) typingKey(cat, index * 50, false);
  assert.deepEqual(Object.keys(cat).sort(), ["lastKey", "nextPaw", "pose", "returnAt"]);
  for (const value of Object.values(cat)) assert.ok(typeof value === "number" || ["idle", "left", "right"].includes(value as string), String(value));
});

test("typing cat privacy: pages send an empty tap, and the main process reads nothing from it", () => {
  // The pages' listener: the event is turned into a yes/no right away; the message has no fields.
  const listener = fs.readFileSync(path.join(root, "src/renderer/typingTap.ts"), "utf8");
  const code = listener.split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  assert.match(code, /act\(\{ type: "typingTap" \}\)/);
  assert.match(code, /keydownCounts\(event\)/);
  for (const name of ["event.code", "keyCode", "event.which", "charCode", "clipboard", "console.", "localStorage", "isComposing", "data", "timeStamp"]) {
    assert.ok(!code.includes(name), `typingTap.ts uses ${name}`);
  }
  const checks = fs.readFileSync(path.join(root, "src/core/ipcCheck.ts"), "utf8");
  assert.match(checks, /typingTap: \{\}/, "the tap's reader takes no fields");
  const types = fs.readFileSync(path.join(root, "src/core/types.ts"), "utf8");
  assert.match(types, /\| \{ type: "typingTap" \}/);
  // The core's key filter reads `key` only to leave out a modifier pressed alone.
  const core = fs.readFileSync(path.join(root, "src/core/typingCat.ts"), "utf8");
  assert.equal([...core.matchAll(/event\.key\b/g)].length, 1);
});

test("typing cat privacy: the typing cat's page and window hear only that a key went down", () => {
  const page = fs.readFileSync(path.join(root, "src/renderer/typingCat.ts"), "utf8").split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  assert.match(page, /api\.on\("typingCat:key", \(\) =>/, "the key message carries nothing");
  const main = fs.readFileSync(path.join(root, "src/main/typingCat.ts"), "utf8").split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  assert.match(main, /send\("typingCat:key"\)/, "sent with nothing in it");
  for (const code of [page, main]) {
    for (const name of ["keyCode", "event.key", "event.code", "clipboard", "console.", "localStorage", "writeFile"]) assert.ok(!code.includes(name), name);
  }
});
