import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  keydownCounts, newTypingCat, tapThrottle, typedWithin, typingChatterQuietMs, typingCounts, typingHoldMs, typingKey, typingLingerMs, typingReply,
  typingStop, typingWake, type TypingCat, type TypingDoing,
} from "../src/core/typingCat";

// 치면 두드리는 고양이 (#230): the shared cases from docs/plans/typing-cat-cases.json (the Mac's test-typing-cat.sh reads
// the same file), Windows' own key filter and throttle, and that nothing of a key is kept or sent.
const root = process.cwd();
type Step = { at: number; key?: boolean; reduceMotion?: boolean; stop?: string; pose?: string; next?: string; timer?: boolean };
const file = JSON.parse(fs.readFileSync(path.resolve(root, "..", "docs", "plans", "typing-cat-cases.json"), "utf8")) as {
  holdMs: number; lingerMs: number; chatterQuietMs: number;
  paws: { case: string; burst?: { from: number; every: number; count: number }; steps: Step[] }[];
  counts: { case: string; repeat: boolean; command: boolean; control: boolean; counts: boolean }[];
  priorities: { case: string; doing: TypingDoing; reply: string }[];
  linger: { case: string; lastKey?: number; now: number; within: boolean }[];
  chatter: { case: string; lastKey: number; now: number; quiet: boolean }[];
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

for (const entry of file.priorities) {
  test(`typing cat: ${entry.case}`, () => assert.equal(typingReply(entry.doing), entry.reply));
}

test("typing cat: lingering and 종이냥 한마디 waiting", () => {
  for (const entry of file.linger) {
    const cat = newTypingCat();
    if (entry.lastKey !== undefined) typingKey(cat, entry.lastKey, false);
    assert.equal(typedWithin(cat, typingLingerMs, entry.now), entry.within, entry.case);
  }
  for (const entry of file.chatter) {
    const cat = newTypingCat();
    typingKey(cat, entry.lastKey, false);
    assert.equal(typedWithin(cat, typingChatterQuietMs, entry.now), entry.quiet, entry.case);
  }
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
  assert.match(code, /act\(\{ type: "petTap" \}\)/);
  assert.match(code, /keydownCounts\(event\)/);
  for (const name of ["event.code", "keyCode", "event.which", "charCode", "clipboard", "console.", "localStorage", "isComposing", "data", "timeStamp"]) {
    assert.ok(!code.includes(name), `typingTap.ts uses ${name}`);
  }
  const checks = fs.readFileSync(path.join(root, "src/core/ipcCheck.ts"), "utf8");
  assert.match(checks, /petTap: \{\}/, "the tap's reader takes no fields");
  const types = fs.readFileSync(path.join(root, "src/core/types.ts"), "utf8");
  assert.match(types, /\| \{ type: "petTap" \}/);
  // The core's key filter reads `key` only to leave out a modifier pressed alone.
  const core = fs.readFileSync(path.join(root, "src/core/typingCat.ts"), "utf8");
  assert.equal([...core.matchAll(/event\.key\b/g)].length, 1);
});
