import assert from "node:assert/strict";
import { test } from "node:test";
import { UndoableNotebook, isoDate, parseNotebook, serializeNotebook } from "../src/core/notebook";

test("blank input is rejected; newlines are folded and whitespace trimmed", () => {
  const notebook = new UndoableNotebook();
  assert.equal(notebook.add("   \n "), undefined);
  assert.equal(notebook.add("  첫째\n줄  ")?.title, "첫째 줄");
  assert.equal(notebook.items.length, 1);
});

test("toggle, edit, delete and counts", () => {
  const notebook = new UndoableNotebook();
  const a = notebook.add("a")!;
  notebook.add("b");
  notebook.toggle(a.id);
  assert.equal(notebook.completedCount, 1);
  assert.equal(notebook.activeCount, 1);
  assert.equal(notebook.edit(a.id, "  "), false);
  notebook.edit(a.id, "A");
  assert.equal(notebook.items[0].title, "A");
  notebook.delete(a.id);
  assert.deepEqual(notebook.items.map((item) => item.title), ["b"]);
});

test("move uses insertion offsets in both directions", () => {
  const notebook = new UndoableNotebook();
  const [a, , c] = ["a", "b", "c"].map((title) => notebook.add(title)!);
  notebook.move(a.id, 3);
  assert.deepEqual(notebook.items.map((item) => item.title), ["b", "c", "a"]);
  notebook.move(c.id, 0);
  assert.deepEqual(notebook.items.map((item) => item.title), ["c", "b", "a"]);
  assert.equal(notebook.move(a.id, 9), false);
});

test("undo and redo restore exact states; history is bounded", () => {
  const notebook = new UndoableNotebook();
  for (let index = 0; index < UndoableNotebook.undoLimit + 20; index += 1) notebook.add(`task ${index}`);
  let steps = 0;
  while (notebook.undo()) steps += 1;
  assert.equal(steps, UndoableNotebook.undoLimit);
  assert.equal(notebook.items.length, 20);
  assert.equal(notebook.redo(), true);
  assert.equal(notebook.items.length, 21);
});

test("delivered alerts stay delivered through undo", () => {
  const notebook = new UndoableNotebook();
  const item = notebook.add("약")!;
  const at = new Date("2026-09-28T09:00:00Z");
  notebook.setReminder(item.id, at);
  notebook.add("다른 일");
  notebook.markReminderDelivered(item.id, new Date("2026-09-28T09:00:05Z"));
  notebook.undo();
  assert.equal(notebook.items[0].reminderLastDeliveredAt, "2026-09-28T09:00:05Z");
});

test("files round-trip in the macOS format and damaged files are rejected", () => {
  const notebook = new UndoableNotebook();
  const item = notebook.add("한글과 emoji 🐾", new Date("2026-09-28T01:02:03.456Z"), "A-1")!;
  notebook.setReminder(item.id, new Date("2026-09-28T10:00:00.999Z"));
  const json = serializeNotebook(notebook.notebook);
  assert.match(json, /"createdAt": "2026-09-28T01:02:03Z"/);
  assert.deepEqual(parseNotebook(json), notebook.notebook);
  assert.throws(() => parseNotebook('{"items":[{"id":"x","title":"  ","isCompleted":false,"createdAt":"2026-09-28T00:00:00Z"}]}'));
  assert.throws(() => parseNotebook('{"items":[{"id":"x","title":"a","isCompleted":false,"createdAt":"z"},{"id":"x","title":"b","isCompleted":false,"createdAt":"z"}]}'));
  assert.equal(isoDate(new Date("2026-01-02T03:04:05.678Z")), "2026-01-02T03:04:05Z");
});

test("reads a list written by the macOS app", () => {
  const mac = `{
  "items" : [
    { "createdAt" : "2026-09-22T01:51:20Z", "id" : "902D539B-1015-4A31-9038-F9D55D27BE3D", "isCompleted" : false, "title" : "뭐지" },
    { "createdAt" : "2026-09-22T02:09:20Z", "id" : "3BD467FC-F93B-43E1-9362-AC36382C6479", "isCompleted" : true, "reminderAt" : "2026-09-22T03:00:00Z", "title" : "산책" }
  ]
}`;
  const notebook = parseNotebook(mac);
  assert.equal(notebook.items.length, 2);
  assert.equal(notebook.items[1].reminderAt, "2026-09-22T03:00:00Z");
});

test("retract: a task just added from the input line goes without a trace (no undo step, nothing to redo)", () => {
  const notebook = new UndoableNotebook();
  notebook.add("장보기");
  const made = notebook.addTo("회의", undefined, new Date(), undefined, "2026-10-09T06:00:00Z")!;
  assert.equal(notebook.retract(made.id), true);
  assert.deepEqual(notebook.items.map((item) => item.title), ["장보기"]);
  assert.equal(notebook.canRedo, false);
  assert.equal(notebook.undo(), true); // the earlier add is still the one to undo
  assert.equal(notebook.items.length, 0);
  assert.equal(notebook.canUndo, false);
  assert.equal(notebook.retract("missing"), false);
});
