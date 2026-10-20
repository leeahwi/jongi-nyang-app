import assert from "node:assert/strict";
import { test } from "node:test";
import { bubbleAbove, clampFloorX, clipMs, idleChoices, isResting, petFrame, pickWeighted, walkCycleFrames, walkSpeed, walkStride } from "../src/core/pet";

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
