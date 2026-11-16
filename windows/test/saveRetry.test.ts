import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, mock, test } from "node:test";
import { parseAlarms } from "../src/core/alarm";
import { parseEvents, type LocalEvent } from "../src/core/events";
import { parseNotebook } from "../src/core/notebook";
import { parseSeries } from "../src/core/repeat";
import { renameRetry, writeFileAtomically } from "../src/main/safeFiles";
import { Store } from "../src/main/store";
import { temporaryFolder } from "./temporaryFolder";

// #384: a file held for a moment on Windows (OneDrive, Defender, the indexer) is renamed over again after a short wait,
// and flush() writes again what failed to save — the to-dos, repeats, events and alarms too, not only memos.

const realRename = fs.renameSync;
const original = { ...renameRetry, waits: [...renameRetry.waits] };
afterEach(() => { mock.restoreAll(); Object.assign(renameRetry, { ...original, waits: [...original.waits] }); });

const failure = (code: string) => Object.assign(new Error(`${code}: operation not permitted, rename`), { code });

/** renameSync failing with `code` the first `times` calls (every call when Infinity), then the real one; counts calls. */
function failingRename(code: string, times: number) {
  let calls = 0;
  mock.method(fs, "renameSync", (from: fs.PathLike, to: fs.PathLike) => {
    calls += 1;
    if (calls <= times) throw failure(code);
    return realRename(from, to);
  });
  return () => calls;
}

const leftovers = (folder: string) => fs.readdirSync(folder).filter((name) => name.endsWith(".tmp"));

test("win32: a rename refused twice with EPERM is tried again and the third goes through", () => {
  Object.assign(renameRetry, { platform: "win32", waits: [1, 1, 1, 1] });
  const folder = temporaryFolder("paper-todo-retry-");
  const file = path.join(folder, "todos.json");
  fs.writeFileSync(file, "old");
  const calls = failingRename("EPERM", 2);
  writeFileAtomically(file, "new");
  assert.equal(calls(), 3);
  assert.equal(fs.readFileSync(file, "utf8"), "new");
  assert.deepEqual(leftovers(folder), []);
});

test("win32: EBUSY and EACCES are tried again too; a file held all along fails after the last wait, the old file kept", () => {
  Object.assign(renameRetry, { platform: "win32", waits: [1, 1, 1, 1] });
  const folder = temporaryFolder("paper-todo-retry-");
  const file = path.join(folder, "todos.json");
  for (const code of ["EBUSY", "EACCES"]) {
    mock.restoreAll();
    const calls = failingRename(code, 1);
    writeFileAtomically(file, code);
    assert.equal(calls(), 2, code);
  }
  mock.restoreAll();
  const calls = failingRename("EPERM", Infinity);
  assert.throws(() => writeFileAtomically(file, "never"), { code: "EPERM" });
  assert.equal(calls(), 5, "the first try and one after each of the four waits");
  assert.equal(fs.readFileSync(file, "utf8"), "EACCES");
  assert.deepEqual(leftovers(folder), [], "the temporary file goes");
});

test("the waits stay short (0.5 s in all at most), and nothing is tried again elsewhere or for other errors", () => {
  assert.ok(original.waits.length >= 3 && original.waits.length <= 5);
  assert.ok(original.waits.every((wait) => wait >= 50 && wait <= 200));
  assert.ok(original.waits.reduce((sum, wait) => sum + wait, 0) <= 500);
  const folder = temporaryFolder("paper-todo-retry-");
  const file = path.join(folder, "todos.json");
  Object.assign(renameRetry, { platform: "darwin", waits: [1, 1, 1, 1] });
  let calls = failingRename("EPERM", 1);
  assert.throws(() => writeFileAtomically(file, "x"), { code: "EPERM" });
  assert.equal(calls(), 1, "not Windows: no second try");
  mock.restoreAll();
  Object.assign(renameRetry, { platform: "win32" });
  calls = failingRename("EXDEV", 1);
  assert.throws(() => writeFileAtomically(file, "x"), { code: "EXDEV" });
  assert.equal(calls(), 1, "not a held file: no second try");
});

const event: LocalEvent = {
  id: "00000000-0000-4000-8000-000000000201", title: "팀 회의", date: "2026-10-08", allDay: false, days: 1, start: 600, end: 660,
  repeat: "none", skip: [], color: "blue", createdAt: "2026-10-01T09:00:00Z", updatedAt: "2026-10-01T09:00:00Z",
};

test("flush: the to-dos, repeats, events and alarms that failed to save are written again", () => {
  Object.assign(renameRetry, { platform: "win32", waits: [1, 1, 1, 1] });
  const folder = temporaryFolder("paper-todo-retry-");
  const store = new Store(folder);
  try {
    failingRename("EPERM", Infinity); // held the whole time
    store.mutate((history) => { history.add("장보기"); });
    store.saveSeries({ title: "물 마시기", rule: { kind: "daily" } });
    store.putEvent(event);
    store.putAlarm({ id: "00000000-0000-4000-8000-000000000401", time: "07:00", label: "", days: [1, 2, 3, 4, 5], enabled: true, sound: "bell", snooze: 10, createdAt: "2026-10-01T09:00:00Z", updatedAt: "2026-10-01T09:00:00Z" });
    for (const name of ["todos.json", "repeats.json", "events.json", "alarms.json"]) assert.equal(fs.existsSync(path.join(folder, name)), false, name);
    assert.match(store.storageError ?? "", /저장하지 못했어요/);
    mock.restoreAll(); // let go
    store.flush(); // quitting: nothing changed since, and still everything is written
    const read = (name: string) => fs.readFileSync(path.join(folder, name), "utf8");
    assert.deepEqual(parseNotebook(read("todos.json")).items.map((item) => item.title).sort(), ["물 마시기", "장보기"]);
    assert.deepEqual(parseSeries(read("repeats.json")).map((entry) => entry.title), ["물 마시기"]);
    assert.deepEqual(parseEvents(read("events.json")).map((entry) => entry.title), ["팀 회의"]);
    assert.deepEqual(parseAlarms(read("alarms.json")).map((entry) => entry.time), ["07:00"]);
    assert.equal(store.storageError, undefined);
    // Nothing left to write again: a second flush renames nothing.
    const calls = failingRename("EPERM", 0);
    store.flush();
    assert.equal(calls(), 0);
  } finally {
    store.unwatch();
  }
});
