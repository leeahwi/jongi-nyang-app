import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseAlarms, serializeAlarms, type Alarm } from "../src/core/alarm";
import { parseEvents, serializeEvents, type LocalEvent } from "../src/core/events";
import { UndoableNotebook, parseNotebook, serializeNotebook } from "../src/core/notebook";
import { conflictCopies, copyOf, joinFiles, mergeItems, sameJSON } from "../src/core/syncConflict";

// #385 · #478: the shared cases (shared/cases/sync-conflict-cases.json; the Mac's scripts/test-sync-conflicts.sh reads
// the same file) — which names are a cloud's conflict copies, and joining two lists by item — plus the three files as
// this app writes them. Made-up data only.
type Item = Record<string, unknown>;
const cases = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "shared", "cases", "sync-conflict-cases.json"), "utf8")) as {
  copies: { name: string; copyOf: string | null; why: string }[];
  merge: { name: string; base: Item[]; here: Item[]; theirs: Item[]; expected: Item[] }[];
};

test("copies: iCloud Drive, Google Drive, Dropbox, OneDrive, and what isn't a copy", () => {
  assert.equal(cases.copies.length, 23);
  for (const entry of cases.copies) assert.equal(copyOf(entry.name), entry.copyOf ?? undefined, `${entry.name} (${entry.why})`);
  assert.deepEqual(conflictCopies(["todos.json", "todos 2.json", "notes 2.json", "alarms (1).json"]),
    [{ name: "alarms (1).json", of: "alarms.json" }, { name: "todos 2.json", of: "todos.json" }]);
});

for (const entry of cases.merge) {
  test(`merge ${entry.name}`, () => {
    const got = mergeItems(entry.base, entry.here, entry.theirs);
    assert.ok(sameJSON(got, entry.expected), JSON.stringify(got));
    assert.deepEqual(got.map((item) => item.id), entry.expected.map((item) => item.id), "in this order");
  });
}

const joined = (result: ReturnType<typeof joinFiles>) => {
  assert.ok(result && "joined" in result, JSON.stringify(result));
  return result.joined;
};

test("todos.json as this app writes it: ticked here, renamed and added there", () => {
  const list = new UndoableNotebook();
  const shopping = list.add("장보기")!.id;
  const laundry = list.add("빨래")!.id;
  const base = serializeNotebook(list.notebook);
  const mine = new UndoableNotebook(parseNotebook(base));
  mine.toggle(shopping);
  const theirs = new UndoableNotebook(parseNotebook(base));
  theirs.edit(laundry, "빨래 개기");
  theirs.add("공부");
  const items = parseNotebook(joined(joinFiles(base, serializeNotebook(mine.notebook), serializeNotebook(theirs.notebook), "items"))).items;
  assert.deepEqual(items.map((item) => item.title).sort(), ["공부", "빨래 개기", "장보기"]);
  assert.equal(items.find((item) => item.id === shopping)?.isCompleted, true);
});

test("events.json and alarms.json: added here and renamed there; changed here and deleted there (kept)", () => {
  const event: LocalEvent = {
    id: "e1", title: "회의", date: "2026-11-12", allDay: false, days: 1, start: 600, end: 660, repeat: "none", skip: [], color: "blue",
    createdAt: "2026-11-11T00:00:00Z", updatedAt: "2026-11-11T00:00:00Z",
  };
  const lunch = { ...event, id: "e2", title: "점심", start: 720, end: 780 };
  const events = joined(joinFiles(serializeEvents([event]), serializeEvents([event, lunch]), serializeEvents([{ ...event, title: "회의 (3층)" }]), "events"));
  assert.deepEqual((JSON.parse(events).events as Item[]).map((entry) => entry.title), ["회의 (3층)", "점심"]);
  const alarm: Alarm = { id: "w1", time: "07:00", label: "일어나기", days: [1, 2, 3, 4, 5], enabled: true, sound: "bell", snooze: 10, createdAt: "2026-11-11T00:00:00.000Z", updatedAt: "2026-11-11T00:00:00.000Z" };
  const alarms = parseAlarms(joined(joinFiles(serializeAlarms([alarm]), serializeAlarms([{ ...alarm, time: "07:30" }]), serializeAlarms([]), "alarms")));
  assert.deepEqual(alarms.map((entry) => entry.time), ["07:30"]);
  assert.ok(Array.isArray(parseEvents(events)));
});

test("theirs as it is: unchanged here (formatting aside), theirs already has the change; nothing when a file doesn't read", () => {
  const base = serializeNotebook({ items: [{ id: "a", title: "장보기", isCompleted: false, createdAt: "2026-11-11T00:00:00.000Z" }] });
  const theirs = serializeNotebook({ items: [{ id: "a", title: "장보기, 우유", isCompleted: false, createdAt: "2026-11-11T00:00:00.000Z" }] });
  assert.deepEqual(joinFiles(base.replace(/\n\s*/g, ""), base, theirs, "items"), { theirs: true });
  assert.deepEqual(joinFiles(base, theirs, theirs, "items"), { theirs: true });
  assert.equal(joinFiles(undefined, "{", theirs, "items"), undefined);
  assert.equal(joinFiles(base, base, '{"items":3}', "items"), undefined);
});
