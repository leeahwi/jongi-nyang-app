import assert from "node:assert/strict";
import { test } from "node:test";
import {
  alarmKey, daysText, due, lastFire, newAlarm, nextAlarm, nextFire, parseAlarms, pruneHandled, readAlarm, serializeAlarms, snoozeSettings, timeText, untilText, type Alarm,
} from "../src/core/alarm";
import { langs } from "../src/core/lang";

// 시계 알람: the same cases as the macOS tests (AlarmTests.swift). Local times in October 2026
// (4 Sun · 5 Mon · 8 Thu · 9 Fri · 10 Sat · 11 Sun · 12 Mon), so any time zone gives the same answers.

const at = (day: number, hour: number, minute = 0, second = 0) => new Date(2026, 9, day, hour, minute, second);
const alarm = (time: string, days: number[], changes: Partial<Alarm> = {}): Alarm => ({
  id: "A1", time, label: "", days, enabled: true, sound: "bell", snooze: 10,
  createdAt: "2026-09-01T00:00:00Z", updatedAt: "2026-09-01T00:00:00Z", ...changes,
});
const weekdays = [1, 2, 3, 4, 5];

test("nextFire: once, daily and weekdays, across midnight and the week end", () => {
  const once = alarm("07:00", []);
  assert.deepEqual(nextFire(once, at(8, 6, 30)), at(8, 7), "once: today while still ahead");
  assert.deepEqual(nextFire(once, at(8, 7)), at(8, 7), "at its very minute it is still today");
  assert.deepEqual(nextFire(once, at(8, 7, 0, 1)), at(9, 7), "once: else tomorrow");
  assert.deepEqual(nextFire(once, at(8, 23, 30)), at(9, 7), "across midnight");
  const daily = alarm("00:15", [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(nextFire(daily, at(8, 23, 50)), at(9, 0, 15));
  assert.deepEqual(nextFire(daily, at(9, 0, 10)), at(9, 0, 15));
  const work = alarm("07:30", weekdays);
  assert.deepEqual(nextFire(work, at(8, 8)), at(9, 7, 30), "Thursday after the time: Friday");
  assert.deepEqual(nextFire(work, at(9, 8)), at(12, 7, 30), "Friday after the time: Monday");
  assert.deepEqual(nextFire(work, at(10, 6)), at(12, 7, 30), "Saturday morning: Monday");
  assert.deepEqual(nextFire(alarm("09:00", [0, 6]), at(9, 9, 1)), at(10, 9), "weekends from Friday");
  assert.deepEqual(nextFire(alarm("09:00", [4]), at(8, 9, 1)), at(15, 9), "the same weekday a week on");
  assert.deepEqual(nextFire(alarm("07:00", []), new Date(2026, 8, 30, 22)), at(1, 7), "across a month end");
  assert.equal(nextFire(alarm("07:00", weekdays, { enabled: false }), at(8, 6)), undefined, "off: never");
  const handled = new Set([alarmKey(once, at(8, 7))]);
  assert.deepEqual(nextFire(once, at(8, 7), handled), at(9, 7), "a ring at this very minute already handled: the next one");
});

test("due: within 15 minutes of the time, once per ring, not before the alarm was set", () => {
  const work = alarm("07:30", weekdays);
  assert.deepEqual(due([work], at(8, 7, 29), new Set()), [], "not yet");
  assert.deepEqual(due([work], at(8, 7, 30), new Set()).map((entry) => entry.id), ["A1"], "on the minute");
  assert.deepEqual(due([work], at(8, 7, 44, 59), new Set()).map((entry) => entry.id), ["A1"], "late but within 15 minutes");
  assert.deepEqual(due([work], at(8, 7, 45), new Set()), [], "15 minutes late: skipped");
  assert.deepEqual(due([work], at(10, 7, 31), new Set()), [], "not on Saturday");
  assert.deepEqual(due([work], at(8, 7, 31), new Set([alarmKey(work, at(8, 7, 30))])), [], "handled here already");
  assert.deepEqual(due([work], at(9, 7, 31), new Set([alarmKey(work, at(8, 7, 30))])).length, 1, "yesterday's key doesn't cover today");
  assert.deepEqual(due([alarm("07:30", weekdays, { enabled: false })], at(8, 7, 31), new Set()), [], "off");
  const once = alarm("23:55", []);
  assert.deepEqual(due([once], at(9, 0, 5), new Set()).length, 1, "once, across midnight");
  assert.equal(alarmKey(once, lastFire(once, at(9, 0, 5))!), "A1@2026-10-08T23:55");
  const setLate = alarm("07:00", [], { updatedAt: new Date(at(8, 7, 5)).toISOString().replace(/\.\d{3}Z$/, "Z") });
  assert.deepEqual(due([setLate], at(8, 7, 6), new Set()), [], "set at 7:05 for 7:00: waits for tomorrow");
  assert.deepEqual(nextFire(setLate, at(8, 7, 6)), at(9, 7));
});

test("the handled keys and the next alarm", () => {
  assert.equal(alarmKey(alarm("07:05", []), at(8, 7, 5)), "A1@2026-10-08T07:05");
  const keys = ["A1@2026-10-04T07:00", "A1@2026-10-05T07:00", "A1@2026-10-08T07:00", "broken"];
  assert.deepEqual(pruneHandled(keys, at(8, 12)), ["A1@2026-10-05T07:00", "A1@2026-10-08T07:00"], "three days kept");
  const soon = alarm("09:00", [], { id: "B" });
  const later = alarm("07:00", weekdays, { id: "C" });
  assert.equal(nextAlarm([later, soon, alarm("08:00", [], { id: "D", enabled: false })], at(8, 8))?.alarm.id, "B");
  assert.deepEqual(nextAlarm([later, soon], at(8, 8))?.at, at(8, 9));
  assert.equal(nextAlarm([], at(8, 8)), undefined);
});

test("days, time and until in three languages (Dutch weeks start on Monday)", () => {
  const cases: [number[], string[]][] = [
    [[], ["한 번", "Once", "Eenmalig"]],
    [[0, 1, 2, 3, 4, 5, 6], ["매일", "Every day", "Elke dag"]],
    [[1, 2, 3, 4, 5], ["평일", "Weekdays", "Doordeweeks"]],
    [[6, 0], ["주말", "Weekends", "Weekend"]],
    [[1, 3, 5], ["월·수·금", "Mon, Wed, Fri", "ma, wo, vr"]],
    [[0, 1, 6], ["일·월·토", "Sun, Mon, Sat", "ma, za, zo"]],
  ];
  for (const [days, words] of cases) assert.deepEqual(langs.map((lang) => daysText(days, lang)), words, JSON.stringify(days));
  assert.deepEqual(langs.map((lang) => timeText(alarm("07:00", []), lang)), ["오전 7:00", "7:00 AM", "07:00"]);
  assert.deepEqual(langs.map((lang) => timeText(alarm("19:30", []), lang)), ["오후 7:30", "7:30 PM", "19:30"]);
  assert.deepEqual(langs.map((lang) => untilText(at(9, 7), at(8, 23, 30), lang)), ["7시간 30분 뒤에 울려요", "Rings in 7 h 30 min", "Gaat over 7 u 30 min"]);
  assert.deepEqual(langs.map((lang) => untilText(at(8, 7, 25), at(8, 7), lang)), ["25분 뒤에 울려요", "Rings in 25 min", "Gaat over 25 min"]);
  assert.deepEqual(langs.map((lang) => untilText(at(8, 9), at(8, 7), lang)), ["2시간 뒤에 울려요", "Rings in 2 h", "Gaat over 2 u"]);
  assert.deepEqual(langs.map((lang) => untilText(at(8, 7, 0, 30), at(8, 7), lang)), ["1분 뒤에 울려요", "Rings in 1 min", "Gaat over 1 min"]);
  assert.deepEqual(langs.map((lang) => untilText(at(9, 7, 30), at(8, 7), lang)), ["내일 오전 7:30에 울려요", "Rings tomorrow at 7:30 AM", "Gaat morgen om 07:30"]);
  assert.deepEqual(langs.map((lang) => untilText(at(12, 7), at(9, 8), lang)), ["월요일 오전 7:00에 울려요", "Rings Mon at 7:00 AM", "Gaat ma om 07:00"]);
});

test("alarms.json: defaults for missing keys, broken entries skipped, written in key order", () => {
  const text = JSON.stringify({ alarms: [
    { id: "A", time: "7:05" },
    { id: "B", time: "06:30", label: "약", days: [5, 1, 1, 9, "x"], enabled: false, sound: "trumpet", snooze: 7, createdAt: "2026-10-01T08:00:00Z" },
    { id: "C", time: "21:15", sound: "soft", snooze: 15, createdAt: "2026-10-01T08:00:00.123Z", updatedAt: "2026-10-02T09:00:00Z" },
    { id: "D", time: "25:00" }, { time: "07:00" }, { id: "A", time: "08:00" }, "nonsense",
  ] });
  const alarms = parseAlarms(text);
  assert.deepEqual(alarms.map((entry) => entry.id), ["A", "B", "C"]);
  assert.deepEqual(alarms[0], { id: "A", time: "07:05", label: "", days: [], enabled: true, sound: "bell", snooze: 10, createdAt: "1970-01-01T00:00:00Z", updatedAt: "1970-01-01T00:00:00Z" });
  assert.deepEqual([alarms[1].days, alarms[1].enabled, alarms[1].sound, alarms[1].snooze, alarms[1].label, alarms[1].updatedAt], [[1, 5], false, "bell", 10, "약", "2026-10-01T08:00:00Z"]);
  assert.deepEqual([alarms[2].sound, alarms[2].snooze, alarms[2].createdAt, alarms[2].updatedAt], ["soft", 15, "2026-10-01T08:00:00Z", "2026-10-02T09:00:00Z"]);
  assert.throws(() => parseAlarms("{ not json"));
  assert.throws(() => parseAlarms('{"items":[]}'));
  const written = serializeAlarms(alarms);
  assert.deepEqual(parseAlarms(written), alarms, "round-trips");
  assert.deepEqual(Object.keys((JSON.parse(written) as { alarms: object[] }).alarms[0]), ["createdAt", "days", "enabled", "id", "label", "snooze", "sound", "time", "updatedAt"]);
  assert.ok(written.endsWith("}\n"));
  const fresh = newAlarm(at(8, 12), "N");
  assert.deepEqual([fresh.time, fresh.days, fresh.enabled, fresh.sound, fresh.snooze, fresh.label], ["07:00", [1, 2, 3, 4, 5], true, "bell", 10, ""]);
  assert.match(fresh.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test("alarm snooze 없음 (1.24, timeblock-cases.md §7 A1–A2): 0 is kept, anything else unknown is 10", () => {
  const base = { id: "a", time: "07:00", label: "", days: [1], enabled: true, sound: "bell", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };
  assert.equal(readAlarm({ ...base, snooze: 0 })?.snooze, 0);
  assert.equal(readAlarm({ ...base, snooze: 15 })?.snooze, 15);
  assert.equal(readAlarm({ ...base, snooze: 7 })?.snooze, 10);
  assert.equal(readAlarm({ ...base })?.snooze, 10);
  assert.deepEqual(snoozeSettings, [0, 5, 10, 15]);
  // Written as it is (older builds read 0 as 10).
  assert.match(serializeAlarms([readAlarm({ ...base, snooze: 0 })!]), /"snooze": 0/);
});
