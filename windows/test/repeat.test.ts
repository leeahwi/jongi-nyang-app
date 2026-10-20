import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { UndoableNotebook } from "../src/core/notebook";
import { alertOn, describe, isValidRule, nextOccurrence, occursOn, planToday, type Series } from "../src/core/repeat";
import { Store } from "../src/main/store";

const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);
const day = (y: number, m: number, d: number) => local(y, m, d, 4);

test("rules: daily, weekdays, chosen weekdays and monthly (clamped to short months)", () => {
  assert.ok(occursOn({ kind: "daily" }, day(2026, 9, 27)));
  assert.ok(!occursOn({ kind: "weekdays" }, day(2026, 9, 27))); // Sunday
  assert.ok(occursOn({ kind: "weekdays" }, day(2026, 9, 28)));
  assert.ok(occursOn({ kind: "weekly", weekdays: [1, 3] }, day(2026, 9, 30))); // Wednesday
  assert.ok(!occursOn({ kind: "weekly", weekdays: [1, 3] }, day(2026, 10, 1)));
  assert.ok(occursOn({ kind: "monthly", monthDay: 31 }, day(2026, 9, 30)), "31st falls back to the last day");
  assert.ok(occursOn({ kind: "monthly", monthDay: 31 }, day(2026, 10, 31)));
  assert.ok(!occursOn({ kind: "monthly", monthDay: 31 }, day(2026, 10, 30)));
  assert.ok(!isValidRule({ kind: "weekly", weekdays: [] }));
});

test("summaries and next occurrence", () => {
  assert.equal(describe({ kind: "weekly", weekdays: [0, 3, 1] }, "09:05"), "매주 월·수·일 · 오전 9:05 알림");
  assert.equal(describe({ kind: "monthly", monthDay: 15 }), "매월 15일");
  assert.equal(describe({ kind: "weekly", weekdays: [0, 1, 2, 3, 4, 5, 6] }), "매일");
  assert.deepEqual(nextOccurrence({ kind: "weekly", weekdays: [1] }, local(2026, 9, 29, 9)), day(2026, 10, 5));
  assert.deepEqual(nextOccurrence({ kind: "daily" }, local(2026, 9, 29, 2)), day(2026, 9, 28), "before 4 a.m. is still yesterday");
});

test("alerts before 4 a.m. belong to that night", () => {
  assert.deepEqual(alertOn(day(2026, 9, 28), "09:00"), local(2026, 9, 28, 9));
  assert.deepEqual(alertOn(day(2026, 9, 28), "01:30"), local(2026, 9, 29, 1, 30));
});

const series = (id: string, extra: Partial<Series> = {}): Series => ({ id, title: id, rule: { kind: "daily" }, createdAt: "2026-09-01T00:00:00Z", ...extra });

test("today's plan: create once, never stack, carry unfinished copies forward", () => {
  const now = local(2026, 9, 29, 8);
  const plan = planToday([series("물", { remindAt: "09:00" }), series("주말", { rule: { kind: "weekly", weekdays: [0, 6] } })], [], now);
  assert.equal(plan.create.length, 1);
  assert.equal(plan.create[0].seriesID, "물");
  assert.equal(plan.create[0].reminderAt, local(2026, 9, 29, 9).toISOString().replace(/\.\d{3}Z$/, "Z"));
  assert.deepEqual(plan.placed, ["물"]);
  assert.equal(planToday([series("물", { lastPlaced: "2026-09-29" })], [], now).placed.length, 0, "already placed today");
  const open = { id: "old", title: "물", isCompleted: false, createdAt: "2026-09-28T00:00:00Z", seriesID: "물" };
  const carried = planToday([series("물", { lastPlaced: "2026-09-28" })], [open], now);
  assert.equal(carried.create.length, 0);
  assert.deepEqual(carried.roll, [{ id: "old", reminderAt: undefined }]);
  const done = { ...open, isCompleted: true };
  assert.equal(planToday([series("물", { lastPlaced: "2026-09-28" })], [done], now).create.length, 1, "a finished copy doesn't block today's");
});

test("placed copies survive undo of unrelated edits", () => {
  const notebook = new UndoableNotebook();
  notebook.add("다른 일");
  const plan = planToday([series("운동")], notebook.items, local(2026, 9, 29, 8));
  notebook.placeRecurring(plan.create, plan.roll);
  notebook.undo();
  assert.deepEqual(notebook.items.map((item) => item.title), ["운동"]);
});

test("store: making a row recur links it, places today's copy once, and deleting keeps the task", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paper-repeat-"));
  try {
    const store = new Store(directory);
    const task = store.history.add("스트레칭")!;
    const morning = local(2026, 9, 29, 8);
    store.saveSeries({ taskID: task.id, rule: { kind: "daily" }, remindAt: "09:00" }, morning);
    assert.equal(store.series.length, 1);
    assert.equal(store.items.length, 1, "the row itself is today's copy");
    assert.equal(store.items[0].seriesID, store.series[0].id);
    assert.equal(store.items[0].reminderAt, local(2026, 9, 29, 9).toISOString().replace(/\.\d{3}Z$/, "Z"));
    store.placeRecurring(local(2026, 9, 29, 20));
    assert.equal(store.items.length, 1, "no duplicate later the same day");
    store.placeRecurring(local(2026, 9, 30, 8));
    assert.equal(store.items.length, 1, "unfinished copy carried, not stacked");
    store.complete(store.items[0].id);
    store.placeRecurring(local(2026, 10, 1, 8));
    assert.equal(store.items.filter((item) => !item.isCompleted).length, 1, "a new copy after finishing");
    const reopened = new Store(directory);
    assert.equal(reopened.series.length, 1, "series persist in repeats.json");
    store.deleteSeries(store.series[0].id);
    assert.equal(store.series.length, 0);
    assert.ok(store.items.every((item) => item.isCompleted || !item.seriesID), "open copies become ordinary tasks");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("store: a shelved copy comes back on its next day; linking is one undo step", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paper-repeat-"));
  try {
    const store = new Store(directory);
    const task = store.history.addTo("운동", "later")!;
    const morning = local(2026, 9, 29, 8);
    store.saveSeries({ taskID: task.id, rule: { kind: "daily" }, remindAt: "09:00" }, morning);
    assert.equal(store.items[0].shelf, undefined, "today's copy leaves the shelf");
    store.mutate((history) => history.undo());
    assert.equal(store.items[0].seriesID, undefined, "one undo unlinks it");
    store.mutate((history) => history.redo());
    store.mutate((history) => history.setShelf(task.id, "later"));
    store.placeRecurring(local(2026, 9, 30, 8));
    assert.equal(store.items[0].shelf, undefined, "rolled to today's sheet");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("store: editing a series in Settings updates today's copy, never with a past alert", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paper-repeat-"));
  try {
    const store = new Store(directory);
    const morning = local(2026, 9, 29, 10);
    store.saveSeries({ title: "물 마시기", rule: { kind: "daily" }, remindAt: "09:00" }, morning);
    assert.equal(store.items.length, 1);
    assert.equal(store.items[0].reminderAt, undefined, "09:00 already passed: no instant alert");
    store.saveSeries({ seriesID: store.series[0].id, title: "물 두 잔", rule: { kind: "daily" }, remindAt: "11:00" }, morning);
    assert.equal(store.items[0].title, "물 두 잔");
    assert.equal(store.items[0].reminderAt, local(2026, 9, 29, 11).toISOString().replace(/\.\d{3}Z$/, "Z"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("store: an unreadable memos.json is kept aside, not overwritten", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paper-memo-"));
  try {
    fs.writeFileSync(path.join(directory, "memos.json"), "{ broken");
    const store = new Store(directory);
    assert.ok(store.storageError?.includes("메모를"));
    assert.ok(fs.readdirSync(directory).some((name) => name.startsWith("memos.unreadable-")));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
