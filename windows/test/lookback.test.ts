import assert from "node:assert/strict";
import { test } from "node:test";
import { finishedThisWeek, weekOf, weeklyLookback } from "../src/core/lookback";

const done = (id: string, at: Date) => ({ id, completedAt: at.toISOString() });
// Sunday 4 October 2026; the week is Monday 28 September – Sunday 4 October.
const sunday = (hour: number, minute = 0) => new Date(2026, 9, 4, hour, minute);
const entries = [
  done("a", new Date(2026, 8, 28, 9)),     // Monday
  done("b", new Date(2026, 9, 2, 15)),     // Friday
  done("b", new Date(2026, 9, 2, 15)),     // the same task in the record and on the list
  done("c", new Date(2026, 9, 5, 2)),      // Monday 02:00 — still Sunday by the 4 a.m. day
  done("d", new Date(2026, 8, 28, 3)),     // Monday 03:00 — the Sunday before
  done("e", new Date(2026, 8, 20, 12)),    // an earlier week
  { id: "f" },                             // no time recorded
];

test("the week runs Monday to Sunday by the 4 a.m. day", () => {
  assert.deepEqual(weekOf(sunday(20)), { week: "2026-09-28", monday: "2026-09-28", sunday: "2026-10-04" });
  assert.equal(weekOf(new Date(2026, 9, 5, 3)).week, "2026-09-28"); // Monday 03:00 is still Sunday
  assert.equal(weekOf(new Date(2026, 9, 5, 5)).week, "2026-10-05");
  assert.equal(finishedThisWeek(entries, sunday(20)), 3);
});

test("Sunday from 18:00, once a week, only when something was finished", () => {
  assert.equal(weeklyLookback(sunday(17, 59), entries, ""), undefined);
  assert.deepEqual(weeklyLookback(sunday(18), entries, ""), { week: "2026-09-28", count: 3, message: "이번 주 3개 끝냈어요. 수고했어요!" });
  assert.equal(weeklyLookback(new Date(2026, 9, 5, 1), entries, "")?.count, 3); // after midnight, still Sunday night
  assert.equal(weeklyLookback(sunday(21), entries, "2026-09-28"), undefined);
  assert.equal(weeklyLookback(new Date(2026, 9, 3, 20), entries, ""), undefined); // Saturday
  assert.equal(weeklyLookback(sunday(20), [], ""), undefined);
});
