import assert from "node:assert/strict";
import { test } from "node:test";
import { currentStreak, dayKey, dueForArchive, groupByDay, heatLevel, logicalDayStart, longestStreak, monthKey, parseArchiveLines, type ArchiveEntry } from "../src/core/archive";
import { UndoableNotebook } from "../src/core/notebook";

const local = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min);

test("checking a task stamps completedAt; unchecking clears it", () => {
  const notebook = new UndoableNotebook();
  const item = notebook.add("산책")!;
  notebook.toggle(item.id, new Date("2026-09-28T09:30:00Z"));
  assert.equal(notebook.items[0].completedAt, "2026-09-28T09:30:00Z");
  notebook.toggle(item.id);
  assert.equal(notebook.items[0].completedAt, undefined);
});

test("the day turns over at 4 a.m.", () => {
  assert.equal(dayKey(local(2026, 9, 29, 1, 30)), "2026-09-28");
  assert.equal(dayKey(local(2026, 9, 29, 4, 0)), "2026-09-29");
  assert.deepEqual(logicalDayStart(local(2026, 9, 29, 3, 59)), local(2026, 9, 28, 4));
});

test("archive waits for the chosen number of days, and never when turned off", () => {
  const notebook = new UndoableNotebook();
  const done = (title: string, at: Date) => { const item = notebook.add(title)!; notebook.toggle(item.id, at); return item.id; };
  const tonight = done("오늘 밤", local(2026, 9, 29, 1, 0));   // still Sept 28's work
  const yesterday = done("어제", local(2026, 9, 28, 15, 0));
  const threeDays = done("사흘 전", local(2026, 9, 26, 10, 0));
  notebook.add("안 끝남");
  const beforeDawn = local(2026, 9, 29, 3, 0); // still Sept 28: today's and last night's work stay
  assert.deepEqual(dueForArchive(notebook.items, beforeDawn, 1).map((item) => item.id), [threeDays]);
  const morning = local(2026, 9, 29, 9, 0);
  assert.deepEqual(new Set(dueForArchive(notebook.items, morning, 1).map((item) => item.id)), new Set([tonight, yesterday, threeDays]));
  assert.deepEqual(dueForArchive(notebook.items, morning, 3).map((item) => item.id), [threeDays]);
  assert.deepEqual(dueForArchive(notebook.items, morning, 0), []);
});

test("tasks finished before completion times existed are archived at the first check", () => {
  const legacy = { id: "old", title: "옛날 일", isCompleted: true, createdAt: "2026-01-01T00:00:00Z" };
  assert.equal(dueForArchive([legacy], new Date(), 7).length, 1);
});

test("archiving removes tasks from undo history so undo can't bring them back", () => {
  const notebook = new UndoableNotebook();
  const item = notebook.add("끝난 일")!;
  notebook.toggle(item.id);
  notebook.add("다른 일");
  const removed = notebook.archive(new Set([item.id]));
  assert.equal(removed.length, 1);
  assert.deepEqual(notebook.items.map((entry) => entry.title), ["다른 일"]);
  while (notebook.undo()) {
    assert.ok(!notebook.items.some((entry) => entry.id === item.id));
  }
});

test("record files: monthly keys and tolerant line parsing", () => {
  const entry: ArchiveEntry = { id: "a", title: "메일", createdAt: "2026-09-01T00:00:00Z", completedAt: local(2026, 9, 3).toISOString() };
  assert.equal(monthKey(entry), "2026-09");
  assert.equal(monthKey({ ...entry, completedAt: undefined }), "undated");
  const text = `${JSON.stringify(entry)}\n{"id":"b","title":"깨진 줄"\n\n`;
  assert.deepEqual(parseArchiveLines(text), [entry]);
});

test("calendar statistics: grouping, levels and streaks", () => {
  const at = (d: number, h = 10) => local(2026, 9, d, h).toISOString();
  const entries: ArchiveEntry[] = [
    { id: "1", title: "a", createdAt: at(20), completedAt: at(20) },
    { id: "1", title: "a", createdAt: at(20), completedAt: at(20) }, // duplicate line
    { id: "2", title: "b", createdAt: at(21), completedAt: at(21) },
    { id: "3", title: "c", createdAt: at(22), completedAt: at(22) },
    { id: "4", title: "d", createdAt: at(22), completedAt: at(23, 2) }, // 2 a.m. counts for the 22nd
    { id: "5", title: "e", createdAt: at(27), completedAt: at(27) },
    { id: "6", title: "f", createdAt: at(28), completedAt: at(28) },
  ];
  const days = groupByDay(entries);
  assert.equal(days.get("2026-09-20")?.length, 1);
  assert.equal(days.get("2026-09-22")?.length, 2);
  assert.equal(longestStreak(days), 3);
  assert.equal(currentStreak(days, local(2026, 9, 28, 20)), 2);
  assert.equal(currentStreak(days, local(2026, 9, 29, 20)), 2, "today still empty keeps yesterday's streak");
  assert.equal(currentStreak(days, local(2026, 9, 30, 20)), 0);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 40].map(heatLevel), [0, 1, 2, 2, 3, 3, 4, 4]);
});
