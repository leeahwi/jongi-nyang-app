import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { bubbleAbove, bubbleShift, clampFloorX, clipFrameMs, clipMs, idleChoices, isResting, petFrame, petWindowBounds, petWindowLeft, petWindowWidth, pickWeighted, restBreathMs, walkCycleFrames, walkStepX, walkSpeed, walkStride } from "../src/core/pet";

const windows = process.cwd();

test("clip lengths match macOS; resting states have none", () => {
  assert.equal(clipMs({ kind: "sit" }), 0);
  assert.equal(clipMs({ kind: "hop" }), 550);
  assert.equal(clipMs({ kind: "cheer" }), 1700);
  assert.equal(clipMs({ kind: "walk", from: 100, to: 340 }), (240 / walkSpeed) * 1000);
  assert.equal(clipMs({ kind: "walk", from: 100, to: 101 }), 600, "short walks still take a moment");
  assert.ok(isResting({ kind: "sit" }) && isResting({ kind: "sleep" }) && !isResting({ kind: "blink" }));
});

test("hop lifts at the middle and lands squashed back to rest", () => {
  const hop = { kind: "hop" } as const;
  const mid = petFrame(hop, 0, 200, 275);
  assert.ok(Math.abs(mid.pose.lift - 10) < 1e-9);
  assert.ok(mid.pose.scaleY > 1, "stretched in the air");
  const end = petFrame(hop, 0, 200, 550);
  assert.ok(Math.abs(end.pose.lift) < 1e-9);
  assert.ok(Math.abs(end.pose.scaleY - 1) < 1e-9);
});

test("walk eases between points, faces its heading and cycles eight frames", () => {
  const walk = { kind: "walk", from: 100, to: 300 } as const;
  const duration = clipMs(walk);
  const start = petFrame(walk, 0, 100, 0);
  assert.equal(start.x, 100);
  assert.equal(start.walkFrame, 0);
  assert.equal(start.facingRight, true);
  const middle = petFrame(walk, 0, 100, duration / 2);
  assert.ok(Math.abs(middle.x - 200) < 1e-9);
  assert.equal(middle.walkFrame, Math.floor((100 / walkStride) * walkCycleFrames) % walkCycleFrames);
  assert.equal(petFrame(walk, 0, 100, duration * 2).x, 300);
  assert.equal(petFrame({ kind: "walk", from: 300, to: 100 }, 0, 300, 10).facingRight, false);
});

test("effects and poses per clip", () => {
  assert.equal(petFrame({ kind: "sleep" }, 0, 0, 0).sleepy, true);
  assert.equal(petFrame({ kind: "happy" }, 0, 0, 750).hearts, 0.5);
  assert.equal(petFrame({ kind: "cheer" }, 0, 0, 850).sparkles, 0.5);
  assert.equal(petFrame({ kind: "stretch" }, 0, 0, 100).image, "idle");
  assert.equal(petFrame({ kind: "stretch" }, 0, 0, 1200).image, "stretch");
  assert.ok(Math.abs(petFrame({ kind: "tilt" }, 0, 0, 750).pose.rotation + 2) < 1e-9);
  assert.equal(clipMs({ kind: "tea" }), 4000);
  assert.equal(petFrame({ kind: "tea" }, 0, 0, 200).image, "idle");
  assert.equal(petFrame({ kind: "tea" }, 0, 0, 2000).image, "tea");
  assert.ok(Math.abs(petFrame({ kind: "tea" }, 0, 0, 1250).pose.rotation + 1.5) < 1e-9, "head fully tipped at u·1.6 = ½");
});

test("idle choices: the full idle life (a running timer changes nothing), none of the motion with reduced motion", () => {
  const base = { reduceMotion: false, wanders: true, homeX: 200, walkTarget: 330 };
  const kinds = (context: typeof base) => idleChoices(context).map(([action]) => action.kind);
  assert.deepEqual(kinds(base), ["blink", "tilt", "sit", "hop", "stretch", "yawn", "groom", "tea", "walk"]);
  assert.deepEqual(kinds({ ...base, reduceMotion: true }), ["blink", "tilt", "sit", "stretch", "yawn", "groom", "tea"]);
  assert.ok(!kinds({ ...base, walkTarget: 230 }).includes("walk"), "too short to bother walking");
  assert.ok(!kinds({ ...base, wanders: false }).includes("walk"));
  assert.equal(pickWeighted([["a", 1], ["b", 3]], 0), "a");
  assert.equal(pickWeighted([["a", 1], ["b", 3]], 0.3), "b");
  assert.equal(pickWeighted([["a", 1], ["b", 3]], 0.999), "b");
});

test("floor clamping", () => {
  assert.equal(clampFloorX(10, 1000), 70);
  assert.equal(clampFloorX(990, 1000), 930);
  assert.equal(clampFloorX(50, 100), 70, "a floor narrower than the margins keeps the cat at the first margin");
});

test("a reminder bubble sits just above the cat, inside the work area", () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  const size = { width: 360, height: 200 };
  assert.deepEqual(bubbleAbove({ x: 1452, y: 948, width: 92, height: 92 }, size, area), { x: 1318, y: 744 });
  assert.equal(bubbleAbove({ x: 1850, y: 948, width: 92, height: 92 }, size, area).x, 1920 - 360 - 8, "kept inside on the right");
  assert.equal(bubbleAbove({ x: 10, y: 948, width: 92, height: 92 }, size, area).x, 8, "and on the left");
  assert.equal(bubbleAbove({ x: 900, y: 100, width: 92, height: 92 }, size, area).y, 0, "never above the top");
});

test("#67: the window is the cat's box with room for its bubble, the cat in its middle", () => {
  const floor = 1440;
  assert.equal(petWindowLeft(700), 700 - petWindowWidth / 2);
  // The cat's 252px box, the 260px the snapshots capture, and the bubble (240px, slid inward near an edge) all fit.
  for (const x of [70, 71.4, 200, 700, floor - 70]) {
    const left = petWindowLeft(x);
    assert.ok(x - 126 >= left && x + 126 <= left + petWindowWidth, `the cat's box at ${x}`);
    assert.ok(petWindowWidth / 2 - 130 >= 0 && petWindowWidth / 2 + 130 <= petWindowWidth, "the snapshot");
    const shift = bubbleShift(x, 240, floor);
    assert.ok(x - 120 + shift >= left && x + 120 + shift <= left + petWindowWidth, `the bubble at ${x}`);
  }
});

test("#67: clips are drawn only as often as they change; resting poses take one breath", () => {
  assert.equal(clipFrameMs({ kind: "sit" }), Infinity);
  assert.equal(clipFrameMs({ kind: "blink" }), Infinity, "a blink is one picture");
  assert.equal(clipFrameMs({ kind: "walk", from: 0, to: 200 }), 33);
  assert.equal(clipFrameMs({ kind: "hop" }), 0, "hops bounce at every frame");
  // A stretch only swaps its picture: the pose is the same all through.
  const stretch = { kind: "stretch" } as const;
  const poses = new Set([0, 600, 1200, 1800, 2400].map((at) => JSON.stringify(petFrame(stretch, 0, 0, at).pose)));
  assert.equal(poses.size, 1);
  // One breath is one cycle of the CSS breath, so it ends where it began (the cat as drawn).
  for (const file of ["pet.css", "timer.css"]) {
    const css = fs.readFileSync(path.join(windows, "src", "renderer", file), "utf8");
    for (const kind of ["awake", "asleep"] as const) assert.match(css, new RegExp(`breathe-${kind} ${restBreathMs[kind] / 1000}s`), `${file} ${kind}`);
  }
});

test("#67: a walking cat's window moves once a step, with its picture", () => {
  const walk = { kind: "walk", from: 100, to: 300 } as const;
  const duration = clipMs(walk);
  let last: number = walk.from;
  for (let at = 0; at <= duration; at += 5) {
    const x = walkStepX(walk, 0, at);
    assert.ok(x >= last && x - last <= walkStride / walkCycleFrames + 1e-9, "forward, a step at most");
    // The same picture, the same place.
    const frame = petFrame(walk, 0, 100, at);
    if (at < duration) assert.equal(Math.round((x - walk.from) / (walkStride / walkCycleFrames)) % walkCycleFrames, frame.walkFrame);
    last = x;
  }
  assert.equal(walkStepX(walk, 0, duration), 300);
  assert.ok(walkStepX({ kind: "walk", from: 300, to: 100 }, 0, duration / 2) < 300, "the other way too");
});

test("pet window: made and placed with its whole bounds on the floor, never at the system's default spot (#307)", () => {
  const floor = { x: 0, y: 858, width: 1710, height: 250 };
  assert.deepEqual(petWindowBounds(floor, 1334), { x: 1154, y: 858, width: petWindowWidth, height: 250 });
  // Off-screen runs: the same place moved far off every display.
  assert.deepEqual(petWindowBounds(floor, 1334, { x: -40_000, y: -40_000 }), { x: -38_846, y: -39_142, width: petWindowWidth, height: 250 });
  // 아주 크게: the strip's height, whatever it is.
  assert.equal(petWindowBounds({ ...floor, height: 318 }, 70).height, 318);
  // Made with them (not centred first, then moved), and placed with them.
  const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
  assert.match(source("src/main/pet.ts"), /new BrowserWindow\(\{\s*\.\.\.petWindowBounds\(/);
  assert.match(source("src/main/pet.ts"), /setBounds\(bounds\)/);
  assert.match(source("src/main/typingCat.ts"), /new BrowserWindow\(\{\s*\.\.\.this\.frame\(\)/);
});
