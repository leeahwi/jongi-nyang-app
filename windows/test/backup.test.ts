import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { backupStatus, countsText, isDue, makeBackup, mergeFiles, notBackup, parseBackup, parseSavedName, pruneSaved, replaceFiles, savedName, savedWhen, sizeText, summary, summaryText, tooNew, unreadable, type BackupFiles } from "../src/core/backup";
import { serializeAlarms, type Alarm } from "../src/core/alarm";
import { serializeEvents, type LocalEvent } from "../src/core/events";
import { serializeMemos } from "../src/core/memo";
import { serializeNotebook, type TodoItem } from "../src/core/notebook";
import { serializeSeries } from "../src/core/repeat";
import { importInto, leftoverFiles, moveData, readDataFiles, removeLeftovers, saveBeforeImport, writeDataFiles } from "../src/main/storageFolder";
import { Store } from "../src/main/store";
import { temporaryFolder } from "./temporaryFolder";

// 백업 · 옮기기 (spec §2): the same cases as the macOS app, then whole folders exported and imported.

const temporary = () => temporaryFolder("paper-todo-backup-");
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
  const { saved } = importInto(target, path.join(settings, "backups"), parsed.backup.files, "replace", "Windows 1.16.0", exportedAt);
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
  const { files } = importInto(target, path.join(settings, "backups"), backup, "merge", "Windows 1.16.0", exportedAt);
  assert.deepEqual(summary(files), { todos: 4, memos: 1, repeats: 1, events: 2, alarms: 1, archive: 4, focus: 0 });
  assert.equal(summaryText(summary(files)), "할 일 4 · 메모 1 · 반복 1 · 일정 2 · 알람 1 · 완료 기록 4");
  // The same id on both sides: this PC's copy stays.
  store.reloadAll();
  assert.deepEqual(store.events.map((entry) => entry.title), ["팀 회의 (이 PC)", "출장"]);
  assert.deepEqual(store.items.map((item) => item.title), ["이 PC의 할 일", "보고서 쓰기", "장보기", "물 마시기"]);
  assert.equal(store.history.canUndo, false);
  const again = importInto(target, path.join(settings, "backups"), backup, "merge", "Windows 1.16.0", new Date(exportedAt.getTime() + 1000));
  assert.deepEqual(summary(again.files), summary(files));
  assert.equal(fs.readdirSync(path.join(settings, "backups")).length, 2);
});

test("a write that fails half-way leaves the folder as it was", () => {
  const folder = filledFolder();
  const before = readDataFiles(folder);
  // One of the new files can't be written (#173: temporary names are random now, so the archive folder is made read-only
  // instead of planting something at a known name).
  fs.chmodSync(path.join(folder, "archive"), 0o555);
  const next = { ...replaceFiles(before, { "todos.json": todos(task(7, "새 할 일")), "archive/2026-11.jsonl": line("n", "n") + "\n" }) };
  try {
    assert.throws(() => writeDataFiles(folder, before, next));
  } finally {
    fs.chmodSync(path.join(folder, "archive"), 0o755);
  }
  assert.deepEqual(readDataFiles(folder), before);
  assert.deepEqual([...fs.readdirSync(folder), ...fs.readdirSync(path.join(folder, "archive"))].filter((name) => name.endsWith(".import-tmp")), []);
});

test("the copies before an import: the ten newest are kept", () => {
  const settings = temporary();
  for (let second = 0; second < 13; second += 1) saveBeforeImport(settings, "{}", new Date(2026, 9, 8, 14, 30, second));
  const kept = fs.readdirSync(path.join(settings, "backups")).sort();
  assert.equal(kept.length, 10);
  assert.equal(kept[0], "가져오기-전-20261008-143003.jongi");
  assert.equal(kept[9], "가져오기-전-20261008-143012.jongi");
});

test("#137: overwriting a folder's list with this one backs that list up first (the same place and format as before an import)", () => {
  const source = temporary();
  fs.writeFileSync(path.join(source, "todos.json"), todos(task(1, "이 PC의 할 일")));
  fs.writeFileSync(path.join(source, "memos.json"), memos([1, "이 PC 메모"]));
  const target = temporary();
  fs.writeFileSync(path.join(target, "todos.json"), todos(task(2, "폴더의 할 일"), task(3, "회의 자료 정리")));
  fs.mkdirSync(path.join(target, "archive"));
  fs.writeFileSync(path.join(target, "archive", "2026-10.jsonl"), line("a", "끝낸 일") + "\n");
  const backups = path.join(temporary(), "backups");
  const now = new Date(2026, 9, 30, 9, 12, 0);
  moveData(source, target, true, backups, "Windows 1.31.0", now);
  assert.deepEqual(fs.readdirSync(backups), ["폴더-바꾸기-전-20261030-091200.jongi"]);
  const saved = parseBackup(fs.readFileSync(path.join(backups, "폴더-바꾸기-전-20261030-091200.jongi"), "utf8"));
  assert.ok("backup" in saved);
  assert.deepEqual(titlesOf(saved.backup.files["todos.json"], "items"), ["폴더의 할 일", "회의 자료 정리"]);
  assert.equal(saved.backup.files["archive/2026-10.jsonl"], line("a", "끝낸 일") + "\n");
  // …and then this list is in the folder; the folder's record stays.
  assert.deepEqual(titlesOf(fs.readFileSync(path.join(target, "todos.json"), "utf8"), "items"), ["이 PC의 할 일"]);
  assert.ok(fs.existsSync(path.join(target, "archive", "2026-10.jsonl")));
});

test("#137: no backup when nothing is overwritten (an empty folder, or the folder's list kept)", () => {
  const source = temporary();
  fs.writeFileSync(path.join(source, "todos.json"), todos(task(1, "이 PC의 할 일")));
  const backups = path.join(temporary(), "backups");
  moveData(source, temporary(), true, backups, "Windows 1.31.0", new Date(2026, 9, 30, 9, 12, 0));
  const kept = temporary();
  fs.writeFileSync(path.join(kept, "todos.json"), todos(task(2, "폴더의 할 일")));
  moveData(source, kept, false, backups, "Windows 1.31.0", new Date(2026, 9, 30, 9, 13, 0));
  assert.equal(fs.existsSync(backups), false);
  assert.deepEqual(titlesOf(fs.readFileSync(path.join(kept, "todos.json"), "utf8"), "items"), ["폴더의 할 일"]);
});

test("#137: a backup that can't be written stops the move", () => {
  const source = temporary();
  fs.writeFileSync(path.join(source, "todos.json"), todos(task(1, "이 PC의 할 일")));
  const target = temporary();
  fs.writeFileSync(path.join(target, "todos.json"), todos(task(2, "폴더의 할 일")));
  const blocked = path.join(temporary(), "backups");
  fs.writeFileSync(blocked, "a file where the folder should be");
  assert.throws(() => moveData(source, target, true, blocked, "Windows 1.31.0", new Date(2026, 9, 30, 9, 12, 0)));
  assert.deepEqual(titlesOf(fs.readFileSync(path.join(target, "todos.json"), "utf8"), "items"), ["폴더의 할 일"]);
});

test("copies in backups/: names, and how many of each kind stay (the same cases as the Mac's)", () => {
  const at = new Date(2026, 9, 30, 9, 12, 5);
  assert.equal(savedName("daily", at), "매일-20261030-091205.jongi");
  assert.equal(savedName("beforeFolderSwitch", at), "폴더-바꾸기-전-20261030-091205.jongi");
  assert.equal(savedName("beforeRestore", at), "되돌리기-전-20261030-091205.jongi");
  assert.equal(savedName("beforeUpdate", at), "업데이트-전-20261030-091205.jongi");
  assert.equal(savedName("manual", at), "직접-20261030-091205.jongi");
  assert.deepEqual(parseSavedName("가져오기-전-20261008-143005.jongi"), { name: "가져오기-전-20261008-143005.jongi", reason: "beforeImport", date: new Date(2026, 9, 8, 14, 30, 5) });
  for (const other of ["종이냥-백업-2026-10-08.jongi", "매일-20261340-091205.jongi", "매일-20261030-0912.jongi", "매일-20261030-091205.json", "notes.txt"]) assert.equal(parseSavedName(other), undefined, other);
  const names = [
    ...Array.from({ length: 16 }, (_, day) => savedName("daily", new Date(2026, 9, day + 1, 9, 0, 0))),
    ...Array.from({ length: 12 }, (_, minute) => savedName("beforeImport", new Date(2026, 9, 30, 10, minute, 0))),
    ...Array.from({ length: 3 }, (_, minute) => savedName("beforeFolderSwitch", new Date(2026, 9, 30, 11, minute, 0))),
    ...Array.from({ length: 20 }, (_, day) => savedName("manual", new Date(2026, 8, day + 1, 9, 0, 0))),
    "종이냥-백업-2026-10-08.jongi",
  ];
  assert.deepEqual(pruneSaved(names), [
    "가져오기-전-20261030-100000.jongi", "가져오기-전-20261030-100100.jongi", "매일-20261001-090000.jongi", "매일-20261002-090000.jongi",
  ]);
});

test("what Google left on this device is removed at launch; nothing else", () => {
  const settings = temporary();
  for (const name of [...leftoverFiles, "google.json.tmp", "settings.json", "storage.json"]) fs.writeFileSync(path.join(settings, name), "{}");
  assert.deepEqual(removeLeftovers(settings).sort(), ["calendar-cache.json", "google.json", "google.json.tmp", "tasks-sync.json"]);
  assert.deepEqual(fs.readdirSync(settings).sort(), ["settings.json", "storage.json"]);
  assert.deepEqual(removeLeftovers(settings), []);
});

// ─── #139 · #140: B4 `reason` · `counts`, the list's words, the daily rule (the same cases as the Mac's CoreTests) ───

test("B4: a copy says why it was made and what it holds; without a reason the file is as before", () => {
  const files = { "todos.json": todos(task(1, "보고서 쓰기"), task(2, "장보기")), "memos.json": memos([1, "회의 메모"]), "archive/2026-10.jsonl": `${line("a", "a")}\n${line("b", "b")}\n` };
  const plain = JSON.parse(makeBackup(files, "Windows 1.31.0", exportedAt)) as Record<string, unknown>;
  assert.deepEqual(Object.keys(plain), ["format", "version", "exportedAt", "from", "files"]);
  const told = JSON.parse(makeBackup(files, "Windows 1.31.0", exportedAt, "daily")) as Record<string, unknown>;
  assert.equal(told.version, 1);
  assert.equal(told.reason, "daily");
  assert.deepEqual(told.counts, { todos: 2, memos: 1, events: 0, archive: 2 });
  const back = parseBackup(makeBackup(files, "Windows 1.31.0", exportedAt, "beforeRestore"));
  assert.ok("backup" in back);
  assert.equal(back.backup.reason, "beforeRestore");
  assert.deepEqual(back.backup.counts, { todos: 2, memos: 1, events: 0, archive: 2 });
  assert.deepEqual(back.backup.files, files);
});

test("B4: older versions read past the new keys (and anything else unknown); odd values are left out", () => {
  const file = (extra: string) => `{"format":"jongi-nyang-backup","version":1,"exportedAt":"2026-10-30T00:12:00Z","from":"macOS 1.46.0",${extra}"files":{"todos.json":${JSON.stringify(todos(task(1, "보고서 쓰기")))}}}`;
  const known = parseBackup(file(`"reason":"manual","counts":{"todos":1,"memos":0,"events":0,"archive":0},"future":{"x":1},`));
  assert.ok("backup" in known);
  assert.equal(known.backup.reason, "manual");
  assert.deepEqual(known.backup.counts, { todos: 1, memos: 0, events: 0, archive: 0 });
  assert.deepEqual(Object.keys(known.backup.files), ["todos.json"]);
  const someday = parseBackup(file(`"reason":"someday","counts":"lots",`));
  assert.ok("backup" in someday);
  assert.equal(someday.backup.reason, undefined);
  assert.equal(someday.backup.counts, undefined);
  const partial = parseBackup(file(`"counts":{"todos":3},`));
  assert.ok("backup" in partial);
  assert.deepEqual(partial.backup.counts, { todos: 3, memos: 0, events: 0, archive: 0 });
  const negative = parseBackup(file(`"counts":{"todos":-1},`));
  assert.ok("backup" in negative);
  assert.equal(negative.backup.counts, undefined);
});

test("the list's words: what a copy holds, when it was made, how big it is (ko · en · nl)", () => {
  const many = { todos: 24, memos: 12, events: 6, archive: 310 };
  assert.equal(countsText(many), "할 일 24개 · 메모 12장 · 일정 6개 · 기록 310개");
  assert.equal(countsText(many, "en"), "24 to-dos · 12 notes · 6 events · 310 in history");
  assert.equal(countsText(many, "nl"), "24 taken · 12 notities · 6 afspraken · 310 in geschiedenis");
  const one = { todos: 1, memos: 1, events: 1, archive: 1 };
  assert.equal(countsText(one, "en"), "1 to-do · 1 note · 1 event · 1 in history");
  assert.equal(countsText(one, "nl"), "1 taak · 1 notitie · 1 afspraak · 1 in geschiedenis");
  assert.equal(countsText({ todos: 0, memos: 3, events: 0, archive: 0 }), "메모 3장");
  assert.equal(countsText({ todos: 0, memos: 0, events: 0, archive: 0 }), "비어 있어요");
  assert.equal(countsText({ todos: 0, memos: 0, events: 0, archive: 0 }, "en"), "Empty");
  assert.equal(countsText({ todos: 0, memos: 0, events: 0, archive: 0 }, "nl"), "Leeg");

  const now = new Date(2026, 9, 30, 10, 0);
  const today = new Date(2026, 9, 30, 9, 12), yesterday = new Date(2026, 9, 29, 21, 40), earlier = new Date(2026, 9, 28, 8, 55), lastYear = new Date(2025, 11, 30, 8, 55);
  assert.deepEqual([today, yesterday, earlier, lastYear].map((date) => savedWhen(date, now)), ["오늘 09:12", "어제 21:40", "10월 28일 08:55", "2025년 12월 30일 08:55"]);
  assert.deepEqual([today, yesterday, earlier, lastYear].map((date) => savedWhen(date, now, "en")), ["Today 9:12 AM", "Yesterday 9:40 PM", "Oct 28, 8:55 AM", "Dec 30, 2025, 8:55 AM"]);
  assert.deepEqual([today, yesterday, earlier, lastYear].map((date) => savedWhen(date, now, "nl")), ["Vandaag 09:12", "Gisteren 21:40", "28 okt 08:55", "30 dec 2025 08:55"]);
  assert.deepEqual([today, yesterday].map((date) => savedWhen(date, now, "en", true)), ["today 9:12 AM", "yesterday 9:40 PM"]);
  assert.deepEqual([today, yesterday].map((date) => savedWhen(date, now, "nl", true)), ["vandaag 09:12", "gisteren 21:40"]);
  assert.equal(savedWhen(today, now, "ko", true), "오늘 09:12");

  assert.equal(sizeText(0), "1KB");
  assert.deepEqual(["ko", "en", "nl"].map((lang) => sizeText(225280, lang as "ko")), ["220KB", "220 KB", "220 kB"]);
  assert.deepEqual(["ko", "en", "nl"].map((lang) => sizeText(3040870, lang as "ko")), ["2.9MB", "2.9 MB", "2,9 MB"]);
  assert.equal(sizeText(150 * 1048576), "150MB");
});

test("the daily copy: once a day from 4 a.m., only when something changed (TZ=Asia/Seoul)", () => {
  const last = new Date(2026, 9, 30, 9, 0);
  assert.equal(isDue(new Date(2026, 9, 31, 3, 59), last, true), false);
  assert.equal(isDue(new Date(2026, 9, 31, 4, 0), last, true), true);
  assert.equal(isDue(new Date(2026, 9, 31, 4, 0), last, false), false);
  assert.equal(isDue(new Date(2026, 9, 31, 4, 0), undefined, true), true);
  assert.equal(isDue(new Date(2026, 9, 31, 4, 0), undefined, false), false);
  assert.equal(isDue(new Date(2026, 9, 30, 5, 0), new Date(2026, 9, 30, 2, 0), true), true);
});

// 저장과 백업의 백업 한 줄 (#240, D2 C): the shared cases from docs/plans/storage-summary-cases.json (the Mac's
// test-backups.sh reads the same file).
test("backup summary: when the last copy was, or what is wrong, in ko · en · nl (shared cases)", () => {
  const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "storage-summary-cases.json"), "utf8")) as {
    now: number[];
    cases: { case: string; auto: boolean; failed: boolean; missing: boolean; newest: number[] | null; tone: string; ko: string[]; en: string[]; nl: string[] }[];
  };
  const at = (parts: number[]) => new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4]);
  for (const entry of file.cases) {
    for (const language of ["ko", "en", "nl"] as const) {
      const got = backupStatus({ auto: entry.auto, failed: entry.failed, missing: entry.missing, newest: entry.newest ? at(entry.newest) : undefined }, at(file.now), language);
      assert.deepEqual([got.title, got.detail], entry[language], `${entry.case} ${language}`);
      assert.equal(got.tone, entry.tone, entry.case);
    }
  }
});
