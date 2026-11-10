import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EarsSizeCheck, earPaths, earsBounds, earsHeight, earsShow, earsSizeTries, earsWidth, earsWindowFits, mayTwitch, workAreaUnder,
} from "../src/core/noteEars";

// 노트 창 위의 고양이 귀 (#151): the same cases as the Mac app's (mac/Tests/PaperTodoTests/NoteEarsTests.swift).
const work = { x: 0, y: 40, width: 1920, height: 1000 };
const display = { bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: work };
const note = { x: 300, y: 200, width: 420, height: 560 };
const on = { visible: true, minimized: false, fullScreen: false, offscreen: false };

test("E1 the ears' window stands flush with the note's right edge, its foot 1 px over the top edge", () => {
  const bounds = earsBounds(note);
  assert.equal(bounds.x + bounds.width, note.x + note.width);
  assert.equal(bounds.y + bounds.height, note.y + 1);
  assert.deepEqual([bounds.width, bounds.height, earsWidth, earsHeight], [100, 20, 100, 20]);
});

test("E2 the drawer's ears: bases 16–48 and 62–92 px from the right edge, the left one first", () => {
  const [left, right] = earPaths();
  assert.deepEqual([left.a, left.b, right.a, right.b], [8, 38, 52, 84]);
});

test("E3 an ear's shape: the tip 16 px above the edge, the foot running down over the paper, the pink inside", () => {
  const [left] = earPaths();
  assert.equal(left.sides, "M8 19 L21.4 4.8 Q23 3 24.6 4.8 L38 19");
  assert.equal(left.ear, "M8 20 L8 19 L21.4 4.8 Q23 3 24.6 4.8 L38 19 L38 20 Z");
  assert.equal(left.inner, "M17.5 16 L23 8 L28.5 16 Z");
});

test("E4 the ears show on a visible note with room above it", () => {
  assert.equal(earsShow(note, work, on), true);
});

test("E5 hidden (in the tray), folded into the post-it: no ears", () => {
  assert.equal(earsShow(note, work, { ...on, visible: false }), false);
});

test("E6 minimised or in full screen: no ears", () => {
  assert.equal(earsShow(note, work, { ...on, minimized: true }), false);
  assert.equal(earsShow(note, work, { ...on, fullScreen: true }), false);
});

test("E7 the note against the top of the work area: no room above, no ears", () => {
  assert.equal(earsShow({ ...note, y: 40 }, work, on), false);
  assert.equal(earsShow({ ...note, y: 55 }, work, on), false);
  assert.equal(earsShow({ ...note, y: 56 }, work, on), true);
});

test("E8 off every display: ears only in off-screen runs, where they stay off-screen with the note", () => {
  const away = { ...note, x: -40_000, y: -40_000 };
  assert.equal(workAreaUnder(away, [display]), undefined);
  assert.equal(earsShow(away, undefined, on), false);
  assert.equal(earsShow(away, undefined, { ...on, offscreen: true }), true);
  assert.ok(earsBounds(away).x < -39_000);
});

test("the work area is the one of the display the note's top edge is on", () => {
  const right = { bounds: { x: 1920, y: 0, width: 1280, height: 1024 }, workArea: { x: 1920, y: 0, width: 1280, height: 984 } };
  assert.deepEqual(workAreaUnder(note, [display, right]), work);
  assert.deepEqual(workAreaUnder({ ...note, x: 1800 }, [display, right]), right.workArea, "more of its top on the right display");
});

test("one twitch a second at most", () => {
  assert.equal(mayTwitch(undefined, 5000), true);
  assert.equal(mayTwitch(5000, 5999), false);
  assert.equal(mayTwitch(5000, 6000), true);
});

// #312: on a Windows PC the ears' window came out opaque and about 100 × 56 — a grey box over the note's buttons.
const asked = earsBounds(note);
const seen = { ...asked, height: 56 };

test("E9 the ears' window fits only at the size asked for, give or take a pixel of rounding", () => {
  assert.equal(earsWindowFits(asked, asked), true);
  assert.equal(earsWindowFits(asked, { ...asked, x: asked.x + 30, y: asked.y - 7 }), true, "the place is set again, not the size");
  assert.equal(earsWindowFits(asked, { ...asked, width: 101, height: 19 }), true, "125 % / 150 % rounding");
  assert.equal(earsWindowFits(asked, seen), false, "the grey box of #312");
  assert.equal(earsWindowFits(asked, { ...asked, height: 22 }), false);
  assert.equal(earsWindowFits(asked, { ...asked, width: 136 }), false);
});

test("E10 a wrong size hides the ears and places them again; three in a row leave them off", () => {
  const sizes = new EarsSizeCheck();
  assert.equal(earsSizeTries, 3);
  assert.equal(sizes.check(asked, asked), "show");
  assert.equal(sizes.check(asked, seen), "retry");
  assert.equal(sizes.check(asked, seen), "retry");
  assert.equal(sizes.off, false);
  assert.equal(sizes.check(asked, seen), "off");
  assert.equal(sizes.off, true);
  assert.equal(sizes.check(asked, asked), "off", "off stays off, even at the right size");
});

test("E11 a right size in between starts the count again", () => {
  const sizes = new EarsSizeCheck();
  assert.equal(sizes.check(asked, seen), "retry");
  assert.equal(sizes.check(asked, seen), "retry");
  assert.equal(sizes.check(asked, asked), "show");
  assert.equal(sizes.check(asked, seen), "retry");
  assert.equal(sizes.check(asked, seen), "retry");
  assert.equal(sizes.off, false);
});

test("E12 a display change lets the ears try again", () => {
  const sizes = new EarsSizeCheck();
  for (let i = 0; i < earsSizeTries; i++) sizes.check(asked, seen);
  assert.equal(sizes.off, true);
  sizes.reset();
  assert.equal(sizes.off, false);
  assert.equal(sizes.check(asked, asked), "show");
});
