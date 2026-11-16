import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, mock, test } from "node:test";
import { parseEvents, serializeEvents, type LocalEvent } from "../src/core/events";
import { parseNotebook, serializeNotebook } from "../src/core/notebook";
import { renameRetry } from "../src/main/safeFiles";
import { Store } from "../src/main/store";
import { temporaryFolder } from "./temporaryFolder";

// #478 (#385): a cloud's conflict copies go to the backup folder and are told; what changed here since this PC last read
// or wrote a file joins another device's file, item by item, and is written back. Made-up data only.

const original = { ...renameRetry, waits: [...renameRetry.waits] };
afterEach(() => { mock.restoreAll(); Object.assign(renameRetry, { ...original, waits: [...original.waits] }); });

const at = "2026-11-11T09:00:00Z";
const todo = (id: string, title: string) => ({ id, title, isCompleted: false, createdAt: at });
const event = (id: string, title: string): LocalEvent => ({
  id, title, date: "2026-11-12", allDay: false, days: 1, start: 600, end: 660, repeat: "none", skip: [], color: "blue", createdAt: at, updatedAt: at,
});

test("conflict copies move to the backup folder's sync-conflicts and are told by name; 저장 폴더 확인 shows them once", () => {
  const folder = temporaryFolder("paper-todo-copies-");
  const settings = temporaryFolder("paper-todo-copies-settings-");
  const names = ["todos 2.json", "memos (Minji's MacBook Pro's conflicted copy 2026-11-11).json", "todos-MINJI-PC.json", "notes 2.json"];
  for (const name of names) fs.writeFileSync(path.join(folder, name), "{}");
  const store = new Store(folder, false, settings);
  store.moveConflictCopies(new Date(2026, 10, 11, 15, 0, 0));
  const moved = fs.readdirSync(path.join(settings, "backups", "sync-conflicts")).sort();
  assert.deepEqual(moved, ["2026-11-11 150000 memos (Minji's MacBook Pro's conflicted copy 2026-11-11).json", "2026-11-11 150000 todos 2.json", "2026-11-11 150000 todos-MINJI-PC.json"]);
  assert.deepEqual(fs.readdirSync(folder).filter((name) => names.includes(name)), ["notes 2.json"], "a file that isn't a copy stays");
  assert.match(store.storageError ?? "", /^다른 기기와 동시에 고친 파일이 있어요\. 클라우드가 남긴 사본을 백업 폴더로 옮겨 뒀어요: .*‘todos 2\.json’/);
  assert.equal(store.movedCopies.length, 3);
  store.copiesShown();
  assert.equal(store.storageError, undefined);
  assert.deepEqual(store.movedCopies, []);
});

test("a to-do whose save failed here and another device's rename: both kept, and written", () => {
  Object.assign(renameRetry, { waits: [] });
  const folder = temporaryFolder("paper-todo-join-");
  const file = path.join(folder, "todos.json");
  fs.writeFileSync(file, serializeNotebook({ items: [todo("a", "장보기"), todo("b", "빨래")] }));
  const store = new Store(folder);
  mock.method(fs, "renameSync", () => { throw Object.assign(new Error("EPERM: rename"), { code: "EPERM" }); });
  store.mutate((history) => history.toggle("a"));
  mock.restoreAll();
  assert.equal(parseNotebook(fs.readFileSync(file, "utf8")).items[0].isCompleted, false, "the tick didn't reach the file");
  // Another device renames the other to-do and adds one (a different size, so it is read).
  fs.writeFileSync(file, serializeNotebook({ items: [todo("a", "장보기"), todo("b", "빨래 개기"), todo("c", "공부")] }));
  store.catchUp(["todos.json"], true);
  const saved = parseNotebook(fs.readFileSync(file, "utf8")).items;
  assert.deepEqual(saved.map((item) => [item.title, item.isCompleted]), [["장보기", true], ["빨래 개기", false], ["공부", false]]);
  assert.deepEqual(store.items.map((item) => item.title), ["장보기", "빨래 개기", "공부"]);
});

test("events.json unreadable at launch: an event added here meanwhile joins the other device's file once it reads", () => {
  const folder = temporaryFolder("paper-todo-join-");
  const file = path.join(folder, "events.json");
  fs.writeFileSync(file, serializeEvents([event("e1", "회의")]));
  const open = fs.openSync;
  mock.method(fs, "openSync", (target: fs.PathLike, ...rest: unknown[]) => {
    if (String(target) === file) throw Object.assign(new Error("EACCES: open"), { code: "EACCES" });
    return (open as (...args: unknown[]) => number)(target, ...rest);
  });
  const store = new Store(folder);
  store.putEvent(event("e2", "점심"));
  mock.restoreAll();
  fs.writeFileSync(file, serializeEvents([event("e1", "회의 (3층)")]));
  store.catchUp(["events.json"], true);
  assert.deepEqual(store.events.map((entry) => entry.title).sort(), ["점심", "회의 (3층)"]);
  assert.deepEqual(parseEvents(fs.readFileSync(file, "utf8")).map((entry) => entry.title).sort(), ["점심", "회의 (3층)"], "…and on disk");
  assert.equal(store.storageError, undefined);
});

test("nothing changed here: theirs as it is, also when the file was gone for a moment (a deletion there stays)", () => {
  const folder = temporaryFolder("paper-todo-join-");
  const file = path.join(folder, "todos.json");
  fs.writeFileSync(file, serializeNotebook({ items: [todo("a", "장보기"), todo("b", "빨래")] }));
  const store = new Store(folder);
  fs.unlinkSync(file); // another device's sync client replacing the file
  store.catchUp(["todos.json"], true);
  fs.writeFileSync(file, serializeNotebook({ items: [todo("b", "빨래 개기")] }));
  store.catchUp(["todos.json"], true);
  assert.deepEqual(store.items.map((item) => item.title), ["빨래 개기"]);
});
