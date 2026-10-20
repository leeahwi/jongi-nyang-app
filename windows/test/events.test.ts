import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarDraft } from "../src/core/calendar";
import { draftFromEvent, eventFromDraft, expand, occurrences, parseEvents, parseOccurrenceKey, serializeEvents, skipDay, type LocalEvent } from "../src/core/events";

// 자체 일정 (spec §1): the same cases and values as the macOS app. Every time is local, so the
// suite gives the same answers under any TZ.

const at = (month: number, day: number, hour = 0, minute = 0) => new Date(2026, month - 1, day, hour, minute);
const event = (fields: Partial<LocalEvent>): LocalEvent => ({
  id: "E1", title: "회의", date: "2026-10-07", allDay: false, days: 1, start: 600, end: 660, repeat: "none", skip: [], color: "blue",
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", ...fields,
});
const days = (list: { key: string }[]) => list.map((entry) => entry.key.slice(entry.key.lastIndexOf("@") + 1));

test("1. weekly from Wednesday 10:00–11:00: three Wednesdays in three weeks", () => {
  const found = occurrences(event({ repeat: "weekly" }), at(10, 1), at(10, 22));
  assert.deepEqual(days(found), ["2026-10-07", "2026-10-14", "2026-10-21"]);
  assert.equal(found[1].key, "local/E1@2026-10-14");
  assert.deepEqual(found.map((entry) => entry.start.getTime()), [at(10, 7, 10), at(10, 14, 10), at(10, 21, 10)].map((date) => date.getTime()));
  assert.equal(found[0].end.getTime(), at(10, 7, 11).getTime());
  for (const entry of found) {
    assert.equal(entry.recurring, true);
    assert.equal(entry.color, "#5b8bd0");
    assert.equal(entry.calendarId, "local");
    assert.equal(entry.eventId, "E1");
    assert.equal(entry.canEdit, true);
  }
});

test("2. monthly all day on the 31st: only months that have one", () => {
  const found = occurrences(event({ allDay: true, date: "2026-08-31", repeat: "monthly" }), at(9, 1), at(12, 1));
  assert.deepEqual(days(found), ["2026-10-31"]);
  assert.equal(found[0].start.getTime(), at(10, 31).getTime());
  assert.equal(found[0].end.getTime(), at(11, 1).getTime());
});

test("3. yearly on 29 February: leap years only", () => {
  const found = occurrences(event({ allDay: true, date: "2024-02-29", repeat: "yearly" }), new Date(2025, 0, 1), new Date(2029, 0, 1));
  assert.deepEqual(days(found), ["2028-02-29"]);
});

test("4. daily with a day left out", () => {
  const found = occurrences(event({ date: "2026-10-08", start: 540, end: 570, repeat: "daily", skip: ["2026-10-09"] }), at(10, 8), at(10, 11));
  assert.deepEqual(days(found), ["2026-10-08", "2026-10-10"]);
});

test("5. overnight 23:00–01:00: in the next day's range too", () => {
  const found = occurrences(event({ start: 1380, end: 60 }), at(10, 8), at(10, 9));
  assert.equal(found.length, 1);
  assert.equal(found[0].start.getTime(), at(10, 7, 23).getTime());
  assert.equal(found[0].end.getTime(), at(10, 8, 1).getTime());
  assert.equal(found[0].recurring, false);
});

test("6. weekly two days all day from Saturday: Sunday's range has Saturday's occurrence", () => {
  const found = occurrences(event({ allDay: true, days: 2, date: "2026-10-10", repeat: "weekly" }), at(10, 11), at(10, 12));
  assert.deepEqual(days(found), ["2026-10-10"]);
  assert.equal(found[0].end.getTime(), at(10, 12).getTime());
});

test("7. a one-off on another day: nothing", () => {
  assert.deepEqual(occurrences(event({ date: "2026-10-01" }), at(10, 2), at(10, 3)), []);
});

test("8. draft → event → draft, and unknown values", () => {
  const now = new Date(Date.UTC(2026, 9, 7, 5, 6, 7, 890));
  const draft: CalendarDraft = { title: "보고서", color: "coral", date: "2026-10-09", allDay: false, days: 1, startMinutes: 900, endMinutes: 960, repeat: "weekly", location: "3층", taskId: "T1" };
  const made = eventFromDraft(draft, "E9", now);
  assert.deepEqual(draftFromEvent(made), draft);
  assert.equal(made.createdAt, "2026-10-07T05:06:07Z");
  assert.equal(made.updatedAt, "2026-10-07T05:06:07Z");
  const allDay: CalendarDraft = { title: "출장", color: "blue", date: "2026-10-09", allDay: true, days: 3, startMinutes: 540, endMinutes: 600, repeat: "none" };
  assert.deepEqual(draftFromEvent(eventFromDraft(allDay, "E10", now)), allDay);
  const odd = parseEvents(JSON.stringify({ events: [{ ...event({}), color: "pink", repeat: "hourly" }] }))[0];
  assert.equal(odd.color, "blue");
  assert.equal(odd.repeat, "none");
});

// ─── Beyond the shared cases ──────────────────────────────────────────────────

test("changing an event keeps when it was made, its skipped days and its task", () => {
  const before = event({ skip: ["2026-10-14"], taskId: "T1", repeat: "weekly" });
  const later = new Date(Date.UTC(2026, 9, 8, 0, 0, 0));
  const changed = eventFromDraft({ ...draftFromEvent(before), title: " 회의 2 ", taskId: undefined }, before.id, later, before);
  assert.deepEqual([changed.title, changed.skip, changed.taskId, changed.createdAt, changed.updatedAt], ["회의 2", ["2026-10-14"], "T1", before.createdAt, "2026-10-08T00:00:00Z"]);
  const once = skipDay(changed, "2026-10-21", later);
  assert.deepEqual(once.skip, ["2026-10-14", "2026-10-21"]);
  assert.equal(skipDay(once, "2026-10-21", later), once);
});

test("events.json round-trips with the keys the Mac reads; damaged files are refused", () => {
  const list = [
    event({}),
    eventFromDraft({ title: "생일", color: "yellow", date: "2026-10-09", allDay: true, days: 1, startMinutes: 540, endMinutes: 600, repeat: "yearly", location: "집" }, "E2", new Date(Date.UTC(2026, 9, 7, 1, 2, 3, 456))),
  ];
  const text = serializeEvents(list);
  assert.deepEqual(parseEvents(text), list);
  const stored = JSON.parse(text) as { events: Record<string, unknown>[] };
  assert.deepEqual(Object.keys(stored.events[0]), ["allDay", "color", "createdAt", "date", "days", "end", "id", "repeat", "skip", "start", "title", "updatedAt"]);
  assert.deepEqual(stored.events[1].skip, []);
  assert.equal(stored.events[1].location, "집");
  assert.match(String(stored.events[1].createdAt), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.throws(() => parseEvents("not json"));
  assert.throws(() => parseEvents('{"items":[]}'));
  assert.deepEqual(parseEvents('{"events":[{"id":"x"},{"id":"y","date":"2026-02-30"},{"id":"z","date":"2026-10-07","title":"ok"},{"id":"z","date":"2026-10-08"}]}').map((entry) => [entry.id, entry.date]), [["z", "2026-10-07"]]);
});

test("all the occurrences of several events, by start; keys back to their event and day", () => {
  const list = [event({ id: "B", title: "나중", start: 900, end: 960 }), event({ id: "A", title: "먼저", repeat: "daily" })];
  assert.deepEqual(expand(list, at(10, 7), at(10, 9)).map((entry) => entry.key), ["local/A@2026-10-07", "local/B@2026-10-07", "local/A@2026-10-08"]);
  assert.deepEqual(parseOccurrenceKey("local/A-B@2026-10-08"), { id: "A-B", day: "2026-10-08" });
  assert.equal(parseOccurrenceKey("c1/abc"), undefined);
});

test("nothing before the first day, and the days stay whole across a change of clocks", () => {
  assert.deepEqual(occurrences(event({ date: "2026-10-10", repeat: "daily" }), at(10, 1), at(10, 10)), []);
  const spring = occurrences(event({ date: "2026-03-01", repeat: "daily", start: 120, end: 180 }), new Date(2026, 2, 1), new Date(2026, 3, 1));
  assert.equal(spring.length, 31);
  const fall = occurrences(event({ date: "2026-10-25", repeat: "weekly", allDay: true }), new Date(2026, 9, 1), new Date(2026, 11, 1));
  assert.deepEqual(days(fall), ["2026-10-25", "2026-11-01", "2026-11-08", "2026-11-15", "2026-11-22", "2026-11-29"]);
});
