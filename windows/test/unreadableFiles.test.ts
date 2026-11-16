import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, mock, test } from "node:test";
import { parseAlarms, serializeAlarms, type Alarm } from "../src/core/alarm";
import { parseEvents, serializeEvents, type LocalEvent } from "../src/core/events";
import { parseMemos, serializeMemos } from "../src/core/memo";
import { emptyMemoFolders, inboxID, parseMemoFolders, placeNew, serializeMemoFolders } from "../src/core/memoDrawer";
import { parseSeries, serializeSeries } from "../src/core/repeat";
import { Store } from "../src/main/store";
import { temporaryFolder } from "./temporaryFolder";

// #382: a memos · events · alarms · repeats file that is there but can't be read — or can't be copied aside when it
// doesn't parse — is never written over (as the list's canSave); a good read, the copy or 다시 읽기 opens it again.

afterEach(() => mock.restoreAll());

const at = "2026-10-01T09:00:00Z";
const memo = { id: "00000000-0000-4000-8000-000000000101", text: "장보기: 우유", createdAt: at, updatedAt: at };
const event: LocalEvent = { id: "00000000-0000-4000-8000-000000000201", title: "팀 회의", date: "2026-10-08", allDay: false, days: 1, start: 600, end: 660, repeat: "none", skip: [], color: "blue", createdAt: at, updatedAt: at };
const alarm = (id: string, time: string): Alarm => ({ id, time, label: "", days: [1, 2, 3, 4, 5], enabled: true, sound: "bell", snooze: 10, createdAt: at, updatedAt: at });
const rule = { id: "00000000-0000-4000-8000-000000000301", title: "물 마시기", rule: { kind: "daily" as const }, createdAt: at };

const files = {
  "memos.json": serializeMemos([memo]),
  "events.json": serializeEvents([event]),
  "alarms.json": serializeAlarms([alarm("00000000-0000-4000-8000-000000000401", "07:00")]),
  "repeats.json": serializeSeries([rule]),
};
type Name = keyof typeof files;

/** A change that saves each file at once. */
const change: Record<Name, (store: Store) => void> = {
  "memos.json": (store) => { store.addMemoText("회사: 회의록"); },
  "events.json": (store) => store.putEvent({ ...event, id: "00000000-0000-4000-8000-000000000202", title: "출장" }),
  "alarms.json": (store) => store.putAlarm(alarm("00000000-0000-4000-8000-000000000402", "08:00")),
  "repeats.json": (store) => { store.saveSeries({ title: "공부", rule: { kind: "daily" } }); },
};
/** What the store holds of each file, by title (or time). */
const held: Record<Name, (store: Store) => string[]> = {
  "memos.json": (store) => store.memos.map((entry) => entry.text).sort(),
  "events.json": (store) => store.events.map((entry) => entry.title).sort(),
  "alarms.json": (store) => store.alarms.map((entry) => entry.time).sort(),
  "repeats.json": (store) => store.series.map((entry) => entry.title).sort(),
};
const onDisk: Record<Name, (text: string) => string[]> = {
  "memos.json": (text) => parseMemos(text).map((entry) => entry.text).sort(),
  "events.json": (text) => parseEvents(text).map((entry) => entry.title).sort(),
  "alarms.json": (text) => parseAlarms(text).map((entry) => entry.time).sort(),
  "repeats.json": (text) => parseSeries(text).map((entry) => entry.title).sort(),
};

function folderWith(name: Name, text = files[name]): string {
  const folder = temporaryFolder("paper-todo-unread-");
  fs.writeFileSync(path.join(folder, name), text);
  return folder;
}

/** Opening `file` fails with `code` (no permission, a cloud file not downloaded, held) until the mock is restored. */
function unreadable(file: string, code = "EACCES") {
  const open = fs.openSync;
  mock.method(fs, "openSync", (target: fs.PathLike, ...rest: unknown[]) => {
    if (String(target) === file) throw Object.assign(new Error(`${code}: open`), { code });
    return (open as (...args: unknown[]) => number)(target, ...rest);
  });
}

for (const name of Object.keys(files) as Name[]) {
  test(`${name} there but unreadable at launch: not written over by a change; 다시 읽기 takes it and saving opens`, () => {
    const folder = folderWith(name);
    const file = path.join(folder, name);
    unreadable(file);
    const store = new Store(folder);
    try {
      assert.match(store.storageError ?? "", /읽지 못했어요\. 원래 파일은 덮어쓰지 않고 그대로 둬요\./);
      assert.equal(store.unreadFiles, 1);
      change[name](store);
      store.flush();
      assert.equal(fs.readFileSync(file, "utf8"), files[name], "the file is as it was");
      mock.restoreAll(); // readable again (the permission back, the cloud file downloaded)
      store.reread();
      assert.equal(store.unreadFiles, 0);
      assert.equal(store.storageError, undefined);
      assert.ok(held[name](store).includes(onDisk[name](files[name])[0]), "the file's entries are here");
      change[name](store);
      store.flush();
      const saved = onDisk[name](fs.readFileSync(file, "utf8"));
      assert.ok(saved.includes(onDisk[name](files[name])[0]), "written again, the file's entries kept");
      assert.ok(saved.length >= 2, "and the change with them");
    } finally {
      store.unwatch();
    }
  });
}

test("memos.json readable again by itself: the next change takes the file in and keeps the memo typed meanwhile", () => {
  const folder = folderWith("memos.json");
  const file = path.join(folder, "memos.json");
  unreadable(file, "EBUSY");
  const store = new Store(folder);
  try {
    store.addMemoText("회사: 회의록");
    assert.deepEqual(parseMemos(fs.readFileSync(file, "utf8")).map((entry) => entry.text), ["장보기: 우유"]);
    mock.restoreAll();
    store.addMemoText("집: 화분 물 주기");
    assert.deepEqual(parseMemos(fs.readFileSync(file, "utf8")).map((entry) => entry.text).sort(), ["장보기: 우유", "집: 화분 물 주기", "회사: 회의록"]);
    assert.equal(store.storageError, undefined);
  } finally {
    store.unwatch();
  }
});

test("a file not there at all still starts empty and is written (a missing file isn't a read error)", () => {
  const folder = temporaryFolder("paper-todo-unread-");
  const store = new Store(folder);
  try {
    assert.equal(store.unreadFiles, 0);
    store.putEvent(event);
    assert.deepEqual(onDisk["events.json"](fs.readFileSync(path.join(folder, "events.json"), "utf8")), ["팀 회의"]);
  } finally {
    store.unwatch();
  }
});

for (const name of Object.keys(files) as Name[]) {
  test(`${name} doesn't parse and can't be copied aside: not written over; 다시 읽기 copies it, then saving opens`, () => {
    const folder = folderWith(name, "{ not json");
    const file = path.join(folder, name);
    mock.method(fs, "copyFileSync", () => { throw Object.assign(new Error("ENOSPC: copyfile"), { code: "ENOSPC" }); });
    const store = new Store(folder);
    try {
      assert.match(store.storageError ?? "", /원래 파일은 덮어쓰지 않고 그대로 둬요\./);
      change[name](store);
      store.flush();
      assert.equal(fs.readFileSync(file, "utf8"), "{ not json", "the file is as it was");
      // 다시 읽기 while the disk is still full: still not written.
      store.reread();
      change[name](store);
      assert.equal(fs.readFileSync(file, "utf8"), "{ not json");
      mock.restoreAll(); // room on the disk again
      store.reread();
      assert.equal(store.unreadFiles, 0);
      const aside = fs.readdirSync(folder).filter((entry) => entry.includes(".unreadable-"));
      assert.equal(aside.length, 1);
      assert.equal(fs.readFileSync(path.join(folder, aside[0]), "utf8"), "{ not json", "the copy is the original");
      change[name](store);
      store.flush();
      assert.notEqual(fs.readFileSync(file, "utf8"), "{ not json", "saved again once the original is kept");
    } finally {
      store.unwatch();
    }
  });
}

test("memos.json unreadable: the drawer's places of its memos aren't dropped when the folders are saved", () => {
  const folder = folderWith("memos.json");
  const old = new Date("2026-09-01T09:00:00Z");
  fs.writeFileSync(path.join(folder, "memo-folders.json"), serializeMemoFolders(placeNew(emptyMemoFolders(), memo.id, { folder: inboxID, pinned: true }, old)));
  unreadable(path.join(folder, "memos.json"));
  const store = new Store(folder);
  try {
    store.addMemoText("회사: 회의록"); // places the new memo: memo-folders.json is written
    const saved = parseMemoFolders(fs.readFileSync(path.join(folder, "memo-folders.json"), "utf8"));
    assert.ok(saved.placement[memo.id], "the unread memo's place is kept");
  } finally {
    store.unwatch();
  }
});
