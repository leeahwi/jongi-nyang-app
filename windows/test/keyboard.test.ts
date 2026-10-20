import assert from "node:assert/strict";
import { test } from "node:test";
import { afterRemoval, fromInput, reorder, step } from "../src/core/keyboard";
import { tabAt } from "../src/core/shelf";

const ids = ["a", "b", "c"];

test("↑↓ with nothing selected start at the first or the last row", () => {
  assert.deepEqual(step(ids, undefined, 1, "end"), { id: "a" });
  assert.deepEqual(step(ids, undefined, -1, "end"), { id: "c" });
  assert.deepEqual(step(ids, "gone", 1, "end"), { id: "a" });
  assert.deepEqual(step([], undefined, -1, "end"), { input: true });
});

test("↓ on 오늘's last row goes to the new-task input; ↑ on the first stays", () => {
  assert.deepEqual(step(ids, "a", 1, "end"), { id: "b" });
  assert.deepEqual(step(ids, "c", 1, "end"), { input: true });
  assert.deepEqual(step(ids, "b", -1, "end"), { id: "a" });
  assert.deepEqual(step(ids, "a", -1, "end"), { id: "a" });
});

test("on a shelf the input is above the rows", () => {
  assert.deepEqual(step(ids, "a", -1, "start"), { input: true });
  assert.deepEqual(step(ids, "c", 1, "start"), { id: "c" });
  assert.equal(fromInput(ids, 1, "start"), "a");
  assert.equal(fromInput(ids, -1, "start"), undefined);
});

test("↑ in the empty input under 오늘 selects the last row", () => {
  assert.equal(fromInput(ids, -1, "end"), "c");
  assert.equal(fromInput(ids, 1, "end"), undefined);
  assert.equal(fromInput([], -1, "end"), undefined);
});

test("after a delete the next row (or the one above) is selected", () => {
  assert.equal(afterRemoval(ids, "b"), "c");
  assert.equal(afterRemoval(ids, "c"), "b");
  assert.equal(afterRemoval(["a"], "a"), undefined);
  assert.equal(afterRemoval(ids, "x"), undefined);
});

test("Ctrl+↑↓ move before the row above or after the row below", () => {
  assert.deepEqual(reorder(ids, "b", -1), { targetID: "a", after: false });
  assert.deepEqual(reorder(ids, "b", 1), { targetID: "c", after: true });
  assert.equal(reorder(ids, "a", -1), undefined);
  assert.equal(reorder(ids, "c", 1), undefined);
});

test("the tab under the pointer, with a little slack", () => {
  const tabs = [
    { tab: "today" as const, left: 16, top: 8, right: 70, bottom: 38 },
    { tab: "ahead" as const, left: 64, top: 13, right: 118, bottom: 38 },
  ];
  assert.equal(tabAt(tabs, 90, 20), "ahead");
  assert.equal(tabAt(tabs, 30, 10), "today");
  assert.equal(tabAt(tabs, 90, 41), "ahead");
  assert.equal(tabAt(tabs, 90, 60), undefined);
});
