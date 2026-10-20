import assert from "node:assert/strict";
import { test } from "node:test";
import { nextReminderTime, readyItems, reminderKey } from "../src/core/due";
import { leaveMs, mascotPose, walkInMs } from "../src/core/motion";
import { iconOrigin, noteOrigin } from "../src/core/placement";
import { ReminderSchedule, busyDeferralMs } from "../src/core/schedule";
import { compactTime, rowLabel } from "../src/core/timeText";
import type { TodoItem } from "../src/core/notebook";

const minute = 60_000;

test("periodic schedule: first due after a full interval, busy defers, no catch-up bursts", () => {
  const schedule = new ReminderSchedule(true, 30, 0);
  assert.equal(schedule.nextDue, 30 * minute);
  assert.equal(schedule.consumeIfDue(29 * minute, true, false), false);
  assert.equal(schedule.consumeIfDue(30 * minute, true, true), false);
  assert.equal(schedule.nextDue, 30 * minute + busyDeferralMs);
  assert.equal(schedule.consumeIfDue(10 * 60 * minute, true, false), true);
  assert.equal(schedule.nextDue, 10 * 60 * minute + 30 * minute);
  assert.equal(schedule.consumeIfDue(11 * 60 * minute, false, false), false);
});

test("periodic schedule clamps intervals and keeps a snooze when settings are reapplied", () => {
  const schedule = new ReminderSchedule(true, 999, 0);
  assert.equal(schedule.intervalMinutes, 240);
  schedule.snooze(5 * minute);
  schedule.configure(true, 240, 1);
  assert.equal(schedule.nextDue, 5 * minute);
  schedule.configure(false, 240, 1);
  assert.equal(schedule.nextDue, undefined);
});

const item = (id: string, reminderAt?: string, extra: Partial<TodoItem> = {}): TodoItem => ({ id, title: id, isCompleted: false, createdAt: "2026-09-28T00:00:00Z", reminderAt, ...extra });

test("due tasks are batched, oldest first, and never repeat once delivered", () => {
  const items = [
    item("later", "2026-09-28T10:00:00Z"),
    item("first", "2026-09-28T09:00:00Z"),
    item("done", "2026-09-28T08:00:00Z", { isCompleted: true }),
    item("sent", "2026-09-28T08:30:00Z", { reminderLastDeliveredAt: "2026-09-28T08:30:02Z" }),
    item("snoozed", "2026-09-28T09:30:00Z", { reminderLastDeliveredAt: "2026-09-28T09:00:02Z" }),
  ];
  const now = Date.parse("2026-09-28T09:45:00Z");
  assert.deepEqual(readyItems(items, now).map((entry) => entry.id), ["first", "snoozed"]);
  assert.equal(nextReminderTime(items, now), Date.parse("2026-09-28T09:00:00Z"));
});

test("two computers on one folder both show an alert; an old one shown elsewhere stays quiet (same as macOS)", () => {
  const at = "2026-09-28T09:00:00Z";
  // The other computer showed it a moment ago and marked it delivered in the shared file.
  const shared = item("task", at, { reminderLastDeliveredAt: "2026-09-28T09:00:01Z" });
  const soon = Date.parse("2026-09-28T09:00:03Z");
  assert.deepEqual(readyItems([shared], soon).map((entry) => entry.id), ["task"]);
  assert.equal(nextReminderTime([shared], soon), Date.parse(at));
  const shown = new Set([reminderKey(shared)!]);
  assert.deepEqual(readyItems([shared], soon + 2000, shown), []);
  assert.equal(nextReminderTime([shared], soon + 2000, shown), undefined);
  // Turned on an hour later: what the other computer already showed isn't brought up again.
  assert.deepEqual(readyItems([shared], Date.parse("2026-09-28T10:00:00Z")), []);
  // Missed by every computer: still shown when this one starts.
  assert.deepEqual(readyItems([item("missed", at)], Date.parse("2026-09-28T10:00:00Z")).map((entry) => entry.id), ["missed"]);
});

test("time labels", () => {
  const now = new Date(2026, 8, 28, 12, 0);
  assert.equal(compactTime(new Date(2026, 8, 28, 9, 5), now), "오늘 09:05");
  assert.equal(compactTime(new Date(2026, 8, 29, 18, 0), now), "내일 18:00");
  assert.equal(compactTime(new Date(2026, 9, 3, 7, 5), now), "10/3 07:05");
  assert.equal(compactTime(new Date(2027, 0, 2, 7, 5), now), "2027/1/2 07:05");
  const at = new Date(2026, 8, 28, 16, 49);
  assert.equal(rowLabel(item("a", at.toISOString()), now), "오늘 오후 4:49");
  assert.equal(rowLabel(item("a", at.toISOString(), { isCompleted: true }), now), "알림 중지 · 오늘 오후 4:49");
});

test("cat walk starts off-screen, lands without a jump and leaves past the edge", () => {
  const travel = 460;
  assert.ok(mascotPose({ kind: "walkingIn", start: 0 }, 0, travel).x >= travel);
  const landed = mascotPose({ kind: "walkingIn", start: 0 }, walkInMs, travel);
  const arrived = mascotPose({ kind: "arrived", start: 0 }, 0, travel);
  assert.ok(Math.abs(landed.x) < 0.01 && Math.abs(landed.rotation) < 0.01);
  assert.ok(Math.abs(landed.scaleY - arrived.scaleY) < 0.002 && Math.abs(landed.scaleX - arrived.scaleX) < 0.002);
  let previous = Infinity;
  for (let frame = 0; frame <= 120; frame += 1) {
    const pose = mascotPose({ kind: "walkingIn", start: 0 }, (frame / 60) * 1000, travel);
    assert.ok(pose.x <= previous + 0.001, "never slides backwards");
    assert.ok(Math.abs(pose.rotation) <= 7.01 && pose.lift <= 3.01);
    previous = pose.x;
  }
  assert.ok(mascotPose({ kind: "leaving", start: 0 }, leaveMs, travel).x >= travel);
});

test("folded icon and unfolded note placement", () => {
  const primary = { x: 0, y: 0, width: 1440, height: 900 };
  const left = { x: -1280, y: 0, width: 1280, height: 800 };
  assert.deepEqual(iconOrigin({ x: 400, y: 500 }, { width: 110, height: 130 }, [primary], 12), { x: 345, y: 435 });
  assert.deepEqual(iconOrigin({ x: 1438, y: 2 }, { width: 110, height: 130 }, [primary], 12), { x: 1318, y: 12 });
  const note = { width: 420, height: 560 };
  const anchor = { x: 210, y: 42 };
  assert.deepEqual(noteOrigin({ x: 510, y: 142 }, anchor, note, [primary]), { x: 300, y: 100 });
  assert.deepEqual(noteOrigin({ x: 1420, y: 880 }, anchor, note, [primary, left]), { x: 1020, y: 340 });
  assert.deepEqual(noteOrigin({ x: -1270, y: 10 }, anchor, note, [primary, left]), { x: -1280, y: 0 });
});
