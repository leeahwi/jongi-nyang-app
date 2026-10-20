import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { makeBackup, mergeFiles, notBackup, parseBackup, replaceFiles, summary, summaryText, tooNew, unreadable, type BackupFiles } from "../src/core/backup";
import { serializeAlarms, type Alarm } from "../src/core/alarm";
import { serializeEvents, type LocalEvent } from "../src/core/events";
import { serializeMemos } from "../src/core/memo";
import { serializeNotebook, type TodoItem } from "../src/core/notebook";
import { serializeSeries } from "../src/core/repeat";
import { importInto, leftoverFiles, readDataFiles, removeLeftovers, saveBeforeImport, writeDataFiles } from "../src/main/storageFolder";
import { Store } from "../src/main/store";

// 백업 · 옮기기 (spec §2): the same cases as the macOS app, then whole folders exported and imported.

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "paper-todo-backup-"));
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const task = (n: number, title: string): TodoItem => ({ id: uuid(n), title, isCompleted: false, createdAt: "2026-10-01T09:00:00Z" });
const todos = (...items: TodoItem[]) => serializeNotebook({ items });
const memos = (...list: [number, string][]) => serializeMemos(list.map(([n, text]) => ({ id: uuid(100 + n), text, createdAt: "2026-10-01T09:00:00Z", updatedAt: "2026-10-02T09:00:00Z" })));
const event = (n: number, title: string): LocalEvent => ({ id: uuid(200 + n), title, date: "2026-10-08", allDay: false, days: 1, start: 600, end: 660, repeat: "none", skip: [], color: "blue", createdAt: "2026-10-01T09:00:00Z", updatedAt: "2026-10-01T09:00:00Z" });
const events = (...list: LocalEvent[]) => serializeEvents(list);
const series = (...list: [number, string][]) => serializeSeries(list.map(([n, title]) => ({ id: uuid(300 + n), title, rule: { kind: "daily" as const }, createdAt: "2026-10-01T09:00:00Z" })));
const alarm = (n: number, time = "07:00"): Alarm => ({ id: uuid(400 + n), time, label: "", days: [1, 2, 3, 4, 5], enabled: true, sound: "bell", snooze: 10, createdAt: "2026-10-01T09:00:00Z", updatedAt: "2026-10-01T09:00:00Z" });
const alarms = (...list: number[]) => serializeAlarms(list.map((n) => alarm(n)));
const line = (id: string, title: string) => JSON.stringify({ id, title, createdAt: "2026-10-01T09:00:00Z", completedAt: "2026-10-01T10:00:00Z" });
const titlesOf = (text: string, key: string) => (JSON.parse(text) as Record<string, { title?: string; text?: string }[]>)[key].map((entry) => entry.title ?? entry.text);

const exportedAt = new Date(Date.UTC(2026, 9, 8, 5, 30, 0));

test("B1. make → parse keeps the files, where and when; anything else is refused", () => {
  const files: BackupFiles = { "todos.json": todos(task(1, "가")), "events.json": events(event(1, "회의")), "archive/2026-10.jsonl": line("x", "x") + "\n" };
  const text = makeBackup(files, "Windows 1.16.0", exportedAt);
  const parsed = parseBackup(text);
  assert.ok("backup" in parsed);
  assert.deepEqual(parsed.backup, { exportedAt: "2026-10-08T05:30:00Z", from: "Windows 1.16.0", files });
  assert.deepEqual(Object.keys((JSON.parse(text) as { files: object }).files), ["archive/2026-10.jsonl", "events.json", "todos.json"]);
  for (const bad of ['{"format":"x"}', '"hello"', '{"format":"jongi-nyang-backup","version":1,"files":[]}', "{", '{"format":"jongi-nyang-backup","files":{}}', '{"format":"jongi-nyang-backup","version":1,"files":{"todos.json":5}}']) {
    assert.deepEqual(parseBackup(bad), { error: notBackup }, bad);
  }
  assert.deepEqual(parseBackup('{"format":"jongi-nyang-backup","version":2,"files":{}}'), { error: tooNew });
  assert.equal(notBackup, "종이냥 백업 파일이 아니에요.");
  assert.equal(tooNew, "더 새 버전의 종이냥에서 만든 파일이에요. 종이냥을 업데이트해 주세요.");
});

test("B1. every file is read with the app's own parser before anything is taken", () => {
  const backup = (files: BackupFiles) => makeBackup(files, "macOS 1.31.0", exportedAt);
  assert.deepEqual(parseBackup(backup({ "todos.json": '{"items":[{"id":"x","title":"  ","isCompleted":false,"createdAt":"z"}]}' })), { error: unreadable("todos.json") });
  assert.deepEqual(parseBackup(backup({ "todos.json": todos(task(1, "가")), "memos.json": "[]" })), { error: "백업 파일 안의 ‘memos.json’을 읽지 못했어요." });
  assert.deepEqual(parseBackup(backup({ "repeats.json": "{" })), { error: unreadable("repeats.json") });
  assert.deepEqual(parseBackup(backup({ "events.json": '{"items":[]}' })), { error: unreadable("events.json") });
  // Names this version doesn't know (or that would reach outside the folder) are left out.
  const odd = parseBackup(backup({ "todos.json": todos(), "settings.json": "{}", "archive/../../evil.jsonl": "x", "archive/2026-10.jsonl": "" }));
  assert.ok("backup" in odd);
  assert.deepEqual(Object.keys(odd.backup.files).sort(), ["archive/2026-10.jsonl", "todos.json"]);
});

test("B5. alarms travel: merged by id, emptied by 바꾸기, damaged ones refused", () => {
  const merged = mergeFiles({ "alarms.json": alarms(1, 2) }, { "alarms.json": alarms(2, 3) });
  assert.deepEqual((JSON.parse(merged["alarms.json"]) as { alarms: { id: string }[] }).alarms.map((entry) => entry.id), [alarm(1).id, alarm(2).id, alarm(3).id]);
  const replaced = replaceFiles({ "alarms.json": alarms(1) }, { "todos.json": todos() });
  assert.equal(replaced["alarms.json"], JSON.stringify({ alarms: [] }, null, 2) + "\n");
  const backup = (files: BackupFiles) => makeBackup(files, "Mac 1.33.0", exportedAt);
  assert.deepEqual(parseBackup(backup({ "alarms.json": '{"items":[]}' })), { error: unreadable("alarms.json") });
  const parsed = parseBackup(backup({ "alarms.json": alarms(1) }));
  assert.ok("backup" in parsed && parsed.backup.files["alarms.json"] === alarms(1));
});

test("B2. what a backup holds, in words", () => {
  const files: BackupFiles = {
    "todos.json": todos(task(1, "가"), task(2, "나")), "memos.json": memos([1, "메모"]), "events.json": events(event(1, "a"), event(2, "b"), event(3, "c")),
    "archive/2026-09.jsonl": `${line("w", "w")}\n\n${line("v", "v")}\n`, "archive/2026-10.jsonl": `${line("x", "x")}\n`,
  };
  assert.deepEqual(summary(files), { todos: 2, memos: 1, repeats: 0, events: 3, alarms: 0, archive: 3, focus: 0 });
  assert.equal(summaryText(summary(files)), "할 일 2 · 메모 1 · 일정 3 · 완료 기록 3");
  assert.equal(summaryText(summary({ "todos.json": todos(), "repeats.json": series([1, "물"]) })), "반복 1");
  assert.equal(summaryText(summary({})), "비어 있는 백업이에요.");
  assert.equal(summaryText({ todos: 12, memos: 3, repeats: 2, events: 8, alarms: 0, archive: 140 }), "할 일 12 · 메모 3 · 반복 2 · 일정 8 · 완료 기록 140");
  assert.equal(summaryText(summary({ "alarms.json": alarms(1, 2) })), "알람 2");
  assert.equal(summaryText({ todos: 12, memos: 3, repeats: 2, events: 8, alarms: 2, archive: 140 }), "할 일 12 · 메모 3 · 반복 2 · 일정 8 · 알람 2 · 완료 기록 140");
});

test("B3. 합치기: what is here stays; what only the backup has is added, in its order", () => {
  const current: BackupFiles = {
    "todos.json": todos(task(1, "가"), task(2, "나")), "memos.json": memos([1, "가"], [2, "나"]), "events.json": events(event(1, "가"), event(2, "나")),
    "repeats.json": series([1, "가"]), "archive/2026-10.jsonl": `${line("x", "x")}\n${line("y", "y")}\n`,
  };
  const imported: BackupFiles = {
    "todos.json": todos(task(2, "나2"), task(3, "다")), "memos.json": memos([2, "나2"], [3, "다"]), "events.json": events(event(2, "나2"), event(3, "다")),
    "archive/2026-10.jsonl": `${line("y", "y'")}\n${line("z", "z")}\n`, "archive/2026-09.jsonl": `${line("w", "w")}\n`,
  };
  const merged = mergeFiles(current, imported);
  assert.deepEqual(titlesOf(merged["todos.json"], "items"), ["가", "나", "다"]);
  assert.deepEqual(titlesOf(merged["memos.json"], "memos"), ["가", "나", "다"]);
  assert.deepEqual(titlesOf(merged["events.json"], "events"), ["가", "나", "다"]);
  assert.equal(merged["repeats.json"], current["repeats.json"]);
  const ids = (text: string) => text.trim().split("\n").map((entry) => (JSON.parse(entry) as { id: string; title: string }).title);
  assert.deepEqual(ids(merged["archive/2026-10.jsonl"]), ["x", "y", "z"]);
  assert.deepEqual(ids(merged["archive/2026-09.jsonl"]), ["w"]);
  // Values are copied as they are: the added task is the backup's, field for field.
  const added = (JSON.parse(merged["todos.json"]) as { items: TodoItem[] }).items[2];
  assert.deepEqual(added, task(3, "다"));
  // Lines without an id are compared whole.
  assert.equal(mergeFiles({ "archive/x.jsonl": "garbage\n" }, { "archive/x.jsonl": "garbage\nother\n" })["archive/x.jsonl"], "garbage\nother\n");
});

test("B4. a kind only one side has is taken whole", () => {
  const merged = mergeFiles({ "todos.json": todos(task(1, "가")) }, { "events.json": events(event(1, "회의")) });
  assert.equal(merged["todos.json"], todos(task(1, "가")));
  assert.equal(merged["events.json"], events(event(1, "회의")));
  assert.deepEqual(Object.keys(merged).sort(), ["events.json", "todos.json"]);
});

test("바꾸기: the backup's files; kinds it lacks emptied, this side's months of the record gone", () => {
  const current: BackupFiles = { "todos.json": todos(task(1, "가")), "memos.json": memos([1, "가"]), "archive/2026-08.jsonl": line("q", "q") + "\n" };
  const imported: BackupFiles = { "todos.json": todos(task(3, "다")), "events.json": events(event(1, "회의")), "archive/2026-10.jsonl": line("x", "x") + "\n" };
  const replaced = replaceFiles(current, imported);
  assert.deepEqual(Object.keys(replaced).sort(), ["archive/2026-10.jsonl", "events.json", "memos.json", "todos.json"]);
  assert.equal(replaced["todos.json"], imported["todos.json"]);
  assert.deepEqual(titlesOf(replaced["memos.json"], "memos"), []);
});

// ─── Whole folders ────────────────────────────────────────────────────────────

/** A storage folder with a bit of everything, written by the app's own Store. */
function filledFolder(): string {
  const folder = temporary();
  const store = new Store(folder);
  store.mutate((history) => { history.add("보고서 쓰기"); history.add("장보기"); });
  store.updateMemo(store.addMemo(), "회의 메모\n시안 2개");
  store.saveSeries({ title: "물 마시기", rule: { kind: "daily" }, remindAt: "10:00" });
  store.putEvent(event(1, "팀 회의"));
  store.putEvent({ ...event(2, "출장"), allDay: true, days: 3, repeat: "yearly", color: "purple", location: "부산" });
  store.putAlarm({ ...alarm(1, "06:30"), label: "약 먹기" });
  store.flush();
  fs.mkdirSync(path.join(folder, "archive"), { recursive: true });
  fs.writeFileSync(path.join(folder, "archive", "2026-09.jsonl"), `${line(uuid(900), "산책")}\n${line(uuid(901), "빨래")}\n`);
  fs.writeFileSync(path.join(folder, "archive", "2026-10.jsonl"), `${line(uuid(902), "운동")}\n`);
  store.unwatch();
  return folder;
}

test("내보내기 → 바꾸기 into an empty folder gives the very same files", () => {
  const source = filledFolder();
  const files = readDataFiles(source);
  assert.deepEqual(Object.keys(files).sort(), ["alarms.json", "archive/2026-09.jsonl", "archive/2026-10.jsonl", "events.json", "memos.json", "repeats.json", "todos.json"]);
  const parsed = parseBackup(makeBackup(files, "Windows 1.16.0", exportedAt));
  assert.ok("backup" in parsed);
  const target = temporary();
  const settings = temporary();
  const { saved } = importInto(target, settings, parsed.backup.files, "replace", "Windows 1.16.0", exportedAt);
  for (const name of Object.keys(files)) assert.equal(fs.readFileSync(path.join(target, ...name.split("/")), "utf8"), files[name], name);
  assert.deepEqual(readDataFiles(target), files);
  assert.deepEqual(fs.readdirSync(target).sort(), ["alarms.json", "archive", "events.json", "memos.json", "repeats.json", "todos.json"]);
  // The empty folder as it was went to backups/ first.
  assert.equal(path.dirname(saved), path.join(settings, "backups"));
  const before = parseBackup(fs.readFileSync(saved, "utf8"));
  assert.ok("backup" in before);
  assert.deepEqual(before.backup.files, {});
  // A Store opened on it reads everything back.
  const store = new Store(target);
  // (The daily repeat put today's copy on the list too.)
  assert.deepEqual(store.items.map((item) => item.title), ["보고서 쓰기", "장보기", "물 마시기"]);
  assert.deepEqual(store.events.map((entry) => [entry.title, entry.location ?? ""]), [["팀 회의", ""], ["출장", "부산"]]);
  assert.equal(store.memos.length, 1);
  assert.equal(store.series.length, 1);
  assert.deepEqual(store.alarms.map((entry) => [entry.time, entry.label]), [["06:30", "약 먹기"]]);
});

test("합치기 into a folder with its own list: the counts add up, and nothing doubles when done twice", () => {
  const source = filledFolder();
  const target = temporary();
  const settings = temporary();
  const store = new Store(target);
  store.mutate((history) => history.add("이 PC의 할 일"));
  store.putEvent(event(1, "팀 회의 (이 PC)"));
  store.flush();
  fs.mkdirSync(path.join(target, "archive"));
  fs.writeFileSync(path.join(target, "archive", "2026-10.jsonl"), `${line(uuid(902), "운동")}\n${line(uuid(950), "독서")}\n`);
  const backup = readDataFiles(source);
  const { files } = importInto(target, settings, backup, "merge", "Windows 1.16.0", exportedAt);
  assert.deepEqual(summary(files), { todos: 4, memos: 1, repeats: 1, events: 2, alarms: 1, archive: 4, focus: 0 });
  assert.equal(summaryText(summary(files)), "할 일 4 · 메모 1 · 반복 1 · 일정 2 · 알람 1 · 완료 기록 4");
  // The same id on both sides: this PC's copy stays.
  store.reloadAll();
  assert.deepEqual(store.events.map((entry) => entry.title), ["팀 회의 (이 PC)", "출장"]);
  assert.deepEqual(store.items.map((item) => item.title), ["이 PC의 할 일", "보고서 쓰기", "장보기", "물 마시기"]);
  assert.equal(store.history.canUndo, false);
  const again = importInto(target, settings, backup, "merge", "Windows 1.16.0", new Date(exportedAt.getTime() + 1000));
  assert.deepEqual(summary(again.files), summary(files));
  assert.equal(fs.readdirSync(path.join(settings, "backups")).length, 2);
});

test("a write that fails half-way leaves the folder as it was", () => {
  const folder = filledFolder();
  const before = readDataFiles(folder);
  // Something in the way of one of the new files.
  fs.mkdirSync(path.join(folder, "archive", "2026-11.jsonl.import-tmp"));
  const next = { ...replaceFiles(before, { "todos.json": todos(task(7, "새 할 일")), "archive/2026-11.jsonl": line("n", "n") + "\n" }) };
  assert.throws(() => writeDataFiles(folder, before, next));
  assert.deepEqual(readDataFiles(folder), before);
  assert.deepEqual(fs.readdirSync(folder).filter((name) => name.endsWith(".import-tmp")), []);
});

test("the copies before an import: the ten newest are kept", () => {
  const settings = temporary();
  for (let second = 0; second < 13; second += 1) saveBeforeImport(settings, "{}", new Date(2026, 9, 8, 14, 30, second));
  const kept = fs.readdirSync(path.join(settings, "backups")).sort();
  assert.equal(kept.length, 10);
  assert.equal(kept[0], "가져오기-전-20261008-143003.jongi");
  assert.equal(kept[9], "가져오기-전-20261008-143012.jongi");
});

test("what Google left on this device is removed at launch; nothing else", () => {
  const settings = temporary();
  for (const name of [...leftoverFiles, "google.json.tmp", "settings.json", "storage.json"]) fs.writeFileSync(path.join(settings, name), "{}");
  assert.deepEqual(removeLeftovers(settings).sort(), ["calendar-cache.json", "google.json", "google.json.tmp", "tasks-sync.json"]);
  assert.deepEqual(fs.readdirSync(settings).sort(), ["settings.json", "storage.json"]);
  assert.deepEqual(removeLeftovers(settings), []);
});
