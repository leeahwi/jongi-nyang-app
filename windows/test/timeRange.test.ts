import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNotebook, serializeNotebook, UndoableNotebook, type TodoItem } from "../src/core/notebook";
import { parseArchiveLines, toEntry } from "../src/core/archive";
import {
  blockTooltip, clockMinutes, dragged, drawnEnd, exportRange, focusMinutes, rangeDay, rangeOf, rangeOverdue, rangeText, rangeTimes, validRange, withRange,
} from "../src/core/timeRange";

/** 시간 정하기: the shared rules and cases of timeblock-cases.md §1–3 and §6. */

const task = (extra: Partial<TodoItem> = {}): TodoItem => ({ id: "A", title: "보고서", isCompleted: false, createdAt: "2026-10-01T00:00:00Z", ...extra });
const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");

test("time range: reading the keys (§1)", () => {
  assert.equal(clockMinutes("9:05"), 545);
  assert.equal(clockMinutes("24:00"), undefined);
  assert.equal(clockMinutes("12:60"), undefined);
  assert.deepEqual(rangeOf({ timeStart: "14:00", timeEnd: "15:30" }), { start: 840, end: 930 });
  assert.deepEqual(rangeOf({ timeStart: "14:00", timeEnd: "13:00" }), { start: 840 });
  assert.deepEqual(rangeOf({ timeStart: "14:00", timeEnd: "nope" }), { start: 840 });
  assert.equal(rangeOf({ timeStart: "x", timeEnd: "15:00" }), undefined);
  // The file: an unreadable start drops both; "9:05" is written back as "09:05"; a bad end goes alone.
  const read = parseNotebook(JSON.stringify({ items: [
    { ...task(), id: "1", timeStart: "9:05", timeEnd: "10:00" },
    { ...task(), id: "2", timeStart: "late", timeEnd: "10:00" },
    { ...task(), id: "3", timeStart: "23:00", timeEnd: "01:00" },
    { ...task(), id: "4", timeStart: "03:00", timeEnd: "05:00" },
  ] })).items;
  assert.deepEqual([read[0].timeStart, read[0].timeEnd], ["09:05", "10:00"]);
  assert.deepEqual([read[1].timeStart, read[1].timeEnd], [undefined, undefined]);
  assert.deepEqual([read[2].timeStart, read[2].timeEnd], ["23:00", "01:00"]); // the 4 a.m. day: 01:00 is that night
  // Written only when set, in the sorted key order.
  const text = serializeNotebook({ items: [task({ timeStart: "14:00", timeEnd: "15:30" }), task({ id: "B" })] });
  assert.match(text, /"title": "보고서"\n {4}\}/);
  assert.ok(text.indexOf('"timeEnd"') < text.indexOf('"timeStart"') && text.indexOf('"timeStart"') < text.indexOf('"title"'));
  assert.equal((text.match(/timeStart/g) ?? []).length, 1);
});

test("time range: text, length and day (§1–2)", () => {
  assert.equal(rangeText({ start: 840, end: 930 }, "ko"), "14:00–15:30");
  assert.equal(rangeText({ start: 840, end: 930 }, "en"), "2:00–3:30 PM");
  assert.equal(rangeText({ start: 690, end: 780 }, "en"), "11:30 AM–1:00 PM");
  assert.equal(rangeText({ start: 840, end: 930 }, "nl"), "14:00–15:30");
  assert.equal(rangeText({ start: 840 }, "ko"), "14:00");
  assert.equal(rangeText({ start: 840 }, "en"), "2:00 PM");
  assert.equal(drawnEnd({ start: 840 }), 870);
  assert.equal(drawnEnd({ start: 1425 }), 1455); // past midnight, on the same 4 a.m. day
  assert.equal(drawnEnd({ start: 225 }), 1680); // never past 04:00
  assert.equal(validRange({ start: 840, end: 840 }), false);
  assert.equal(validRange({ start: 840, end: 1440 }), false);
  assert.equal(validRange({ start: 1380, end: 60 }), true);
  assert.equal(validRange({ start: 180, end: 300 }), false);
  assert.equal(validRange({ start: 840 }), true);
  assert.equal(rangeText({ start: 1380, end: 60 }, "en"), "11:00 PM–1:00 AM");
  const late = rangeTimes(task({ timeStart: "23:00", timeEnd: "01:00" }), local(8, 14, 50))!;
  assert.deepEqual([late.start.getTime(), late.end.getTime()], [local(8, 23).getTime(), local(9, 1).getTime()]);
  const now = local(8, 14, 50);
  assert.equal(rangeDay(task(), now), "2026-10-08");
  assert.equal(rangeDay(task({ dueDate: "2026-10-12" }), now), "2026-10-12");
  assert.equal(rangeDay(task({ shelf: "later" }), now), undefined);
  assert.equal(rangeDay(task(), local(9, 2)), "2026-10-08"); // 2 a.m. is still yesterday's sheet
  const times = rangeTimes(task({ timeStart: "14:00" }), now)!;
  assert.deepEqual([times.start.getTime(), times.end.getTime()], [local(8, 14).getTime(), local(8, 14, 30).getTime()]);
  assert.equal(blockTooltip(task({ timeStart: "14:00", timeEnd: "15:30" }), "ko"), "보고서 · 14:00–15:30");
  assert.equal(blockTooltip(task({ timeStart: "14:00" }), "en"), "보고서 · 2:00–2:30 PM");
  assert.equal(exportRange(task({ timeStart: "14:00", timeEnd: "15:30" }), "ko"), " (14:00–15:30)");
  assert.equal(exportRange(task({ timeStart: "14:00" }), "en"), " (2:00 PM)");
  assert.equal(rangeOverdue(task({ timeStart: "14:00", timeEnd: "14:30" }), now), true);
  assert.equal(rangeOverdue(task({ timeStart: "14:00", timeEnd: "14:30", isCompleted: true }), now), false);
  assert.equal(rangeOverdue(task({ timeStart: "14:00", timeEnd: "15:30" }), now), false);
});

test("time range: setting it and the reminder (§3 C1–C9)", () => {
  const range = { start: 840, end: 930 };
  // C1: no reminder → one at the start, today.
  assert.equal(withRange(task(), range, local(8, 10)).reminderAt, iso(local(8, 14)));
  // C2: the start has passed → none.
  assert.equal(withRange(task(), range, local(8, 14, 50)).reminderAt, undefined);
  // C3: another reminder stays.
  assert.equal(withRange(task({ reminderAt: iso(local(8, 13)) }), range, local(8, 10)).reminderAt, iso(local(8, 13)));
  // C4: a reminder at the old start moves with it.
  const set = task({ timeStart: "14:00", timeEnd: "15:30", reminderAt: iso(local(8, 14)), reminderLastDeliveredAt: iso(local(7, 14)) });
  const moved = withRange(set, { start: 960, end: 1020 }, local(8, 10));
  assert.deepEqual([moved.timeStart, moved.timeEnd, moved.reminderAt, moved.reminderLastDeliveredAt], ["16:00", "17:00", iso(local(8, 16)), undefined]);
  // C4b: moved to a start already past: the reminder follows but counts as rung (no bubble at once).
  const back = withRange(set, { start: 600, end: 690 }, local(8, 14, 50));
  assert.deepEqual([back.reminderAt, back.reminderLastDeliveredAt], [iso(local(8, 10)), iso(local(8, 14, 50))]);
  // C5: clearing keeps the reminder.
  const cleared = withRange(set, undefined, local(8, 10));
  assert.deepEqual([cleared.timeStart, cleared.timeEnd, cleared.reminderAt], [undefined, undefined, iso(local(8, 14))]);
  // C6: a start alone on a later deadline.
  const later = withRange(task({ dueDate: "2026-10-12" }), { start: 540 }, local(8, 10));
  assert.deepEqual([later.timeStart, later.timeEnd, later.reminderAt], ["09:00", undefined, iso(local(12, 9))]);
  // C7: the same start keeps the reminder where it is.
  assert.equal(withRange(set, { start: 840, end: 960 }, local(8, 10)).reminderAt, iso(local(8, 14)));
  // As one undo step on the notebook.
  const notebook = new UndoableNotebook({ items: [task()] });
  assert.ok(notebook.setRange("A", range, local(8, 10)));
  assert.equal(notebook.items[0].timeStart, "14:00");
  notebook.undo();
  assert.equal(notebook.items[0].timeStart, undefined);
  // A range read from the line goes in with the task.
  const added = new UndoableNotebook().addTo("보고서", undefined, local(8, 10), undefined, iso(local(8, 15)), { start: 900, end: 1020 })!;
  assert.deepEqual([added.timeStart, added.timeEnd], ["15:00", "17:00"]);
});

test("time range: the archive keeps it", () => {
  const entry = toEntry(task({ isCompleted: true, completedAt: "2026-10-08T06:00:00Z", timeStart: "14:00", timeEnd: "15:30" }));
  assert.deepEqual([entry.timeStart, entry.timeEnd], ["14:00", "15:30"]);
  const back = parseArchiveLines(JSON.stringify(entry))[0];
  assert.deepEqual([back.timeStart, back.timeEnd], ["14:00", "15:30"]);
  assert.equal(parseArchiveLines(JSON.stringify(toEntry(task())))[0].timeStart, undefined);
});

test("time range: focus offers what is left, rounded up to 5 (§6)", () => {
  const item = task({ timeStart: "14:00", timeEnd: "15:30" });
  assert.equal(focusMinutes(item, local(8, 14, 50)), 40);
  assert.equal(focusMinutes(item, new Date(2026, 9, 8, 14, 52, 30)), 38);
  assert.equal(focusMinutes(item, local(8, 15, 28)), 2);
  assert.equal(focusMinutes(item, local(8, 13)), 90);
  // M6: more than three hours left is no offer; a start alone is its 30 minutes.
  assert.equal(focusMinutes(task({ timeStart: "14:00", timeEnd: "18:00" }), local(8, 13)), undefined);
  assert.equal(focusMinutes(task({ timeStart: "14:00" }), local(8, 13)), 30);
  // Begun in its first 5 minutes: the whole range (30, not 27); later, what is left.
  assert.equal(focusMinutes(task({ timeStart: "14:00", timeEnd: "14:30" }), local(8, 14, 3)), 30);
  assert.equal(focusMinutes(task({ timeStart: "14:00", timeEnd: "14:30" }), local(8, 14, 5)), 30);
  assert.equal(focusMinutes(task({ timeStart: "14:00", timeEnd: "14:30" }), local(8, 14, 6)), 24);
  assert.equal(focusMinutes(item, local(8, 15, 30)), undefined);
  assert.equal(focusMinutes(task({ timeStart: "14:00", dueDate: "2026-10-09" }), local(8, 13)), undefined);
});

test("time range: dragging on the ribbon (15-minute steps)", () => {
  const bounds = { low: 480, high: 1440 };
  assert.deepEqual(dragged({ start: 840, end: 930 }, "end", 22, bounds), { start: 840, end: 945 });
  assert.deepEqual(dragged({ start: 840, end: 930 }, "start", -37, bounds), { start: 810, end: 930 });
  assert.deepEqual(dragged({ start: 840, end: 930 }, "start", 200, bounds), { start: 915, end: 930 });
  assert.deepEqual(dragged({ start: 840, end: 930 }, "whole", 61, bounds), { start: 900, end: 990 });
  assert.deepEqual(dragged({ start: 840 }, "whole", -400, bounds), { start: 480 });
  assert.deepEqual(dragged({ start: 840, end: 930 }, "whole", 900, bounds), { start: 1350, end: 0 });
  // Past midnight on the 4 a.m. day, never past 04:00.
  assert.deepEqual(dragged({ start: 1380, end: 1440 % 1440 }, "end", 600, { low: 480, high: 1680 }), { start: 1380, end: 240 });
});
