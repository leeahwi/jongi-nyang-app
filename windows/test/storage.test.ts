import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseNotebook, serializeNotebook, UndoableNotebook } from "../src/core/notebook";
import { parseMemos, serializeMemos, type Memo } from "../src/core/memo";
import { folderPlace, parseStorageFile, placeText, sameFolder, serializeStorageFile, storageLabel } from "../src/core/storage";
import { copyData, hasList, mergeArchive, readDataFolder, writeDataFolder } from "../src/main/storageFolder";
import { Store } from "../src/main/store";
import { parseEvents, serializeEvents, type LocalEvent } from "../src/core/events";
import { parseAlarms, serializeAlarms, type Alarm } from "../src/core/alarm";

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "paper-todo-test-"));
const titles = (store: Store) => store.items.map((item) => item.title);

/** What another computer would write: the same file with one more task. */
function writeElsewhere(directory: string, extra: string): void {
  const file = path.join(directory, "todos.json");
  const notebook = new UndoableNotebook(parseNotebook(fs.readFileSync(file, "utf8")));
  notebook.add(extra);
  fs.writeFileSync(file, serializeNotebook(notebook.notebook), "utf8");
}

test("the storage file and the folder label", () => {
  assert.equal(parseStorageFile(serializeStorageFile("D:\\OneDrive\\종이냥")), "D:\\OneDrive\\종이냥");
  assert.equal(parseStorageFile(serializeStorageFile(undefined)), undefined);
  assert.equal(parseStorageFile("not json"), undefined);
  assert.equal(storageLabel(undefined, "C:\\Users\\me"), "이 PC (기본)");
  assert.equal(storageLabel(undefined, "/Users/me", false), "이 Mac (기본)");
  assert.equal(storageLabel("C:\\Users\\me\\OneDrive\\종이냥", "C:\\Users\\me"), "~\\OneDrive\\종이냥");
  assert.equal(storageLabel("c:\\users\\ME\\Dropbox", "C:\\Users\\me\\"), "~\\Dropbox");
  assert.equal(storageLabel("D:\\Sync", "C:\\Users\\me"), "D:\\Sync");
  assert.equal(storageLabel("C:\\Users\\meg\\x", "C:\\Users\\me"), "C:\\Users\\meg\\x");
  assert.equal(sameFolder("C:\\Data\\", "c:/data"), true);
  assert.equal(sameFolder("/a/B", "/a/b", false), false);
});

test("folderPlace (1.30): a folder said as a path bar says it — ~, a cloud drive by name, the folder's own name last (the Mac's FolderPlace too)", () => {
  const home = "C:\\Users\\sample";
  const base = folderPlace(`${home}\\AppData\\Roaming\\PaperTodo`, home);
  assert.deepEqual(base, { lead: ["~", "AppData", "Roaming"], name: "PaperTodo" });
  assert.equal(placeText(base), "~ › AppData › Roaming › PaperTodo");
  assert.equal(folderPlace(`${home}\\AppData\\Roaming\\PaperTodo\\archive`, home).name, "archive");
  assert.deepEqual(folderPlace(`${home}\\OneDrive\\종이냥`, home), { lead: ["OneDrive"], name: "종이냥", cloud: "OneDrive" });
  assert.equal(placeText(folderPlace(`${home}\\OneDrive - 회사\\종이냥`, home)), "OneDrive › 종이냥");
  assert.equal(placeText(folderPlace(`c:/users/SAMPLE/Dropbox/종이냥`, home)), "Dropbox › 종이냥", "case and slashes don't matter");
  assert.equal(placeText(folderPlace(`${home}\\iCloudDrive\\종이냥`, home)), "iCloud Drive › 종이냥");
  assert.deepEqual(folderPlace(`${home}\\OneDrive`, home), { lead: [], name: "OneDrive", cloud: "OneDrive" }, "the drive itself");
  assert.equal(placeText(folderPlace("G:\\My Drive\\종이냥", home)), "Google Drive › My Drive › 종이냥");
  assert.equal(placeText(folderPlace("D:\\Sync\\종이냥", home)), "D: › Sync › 종이냥", "outside home");
  assert.equal(placeText(folderPlace(home, home)), "~");
  assert.equal(folderPlace("C:\\Users\\sampler\\x", home).lead[0], "C:", "a name that only starts like home's");
  // The Mac's paths (the same function, as the Mac app's tests say them).
  const mac = "/Users/sample";
  assert.equal(placeText(folderPlace(`${mac}/Library/Mobile Documents/com~apple~CloudDocs/종이냥`, mac, false)), "iCloud Drive › 종이냥");
  assert.equal(placeText(folderPlace(`${mac}/Library/CloudStorage/OneDrive-Personal/종이냥`, mac, false)), "OneDrive › 종이냥");
  assert.equal(placeText(folderPlace(`${mac}/Library/Application Support/com.noa.PaperTodo`, mac, false)), "~ › Library › Application Support › com.noa.PaperTodo");
});

test("the chosen folder is kept beside the settings", () => {
  const settings = temporary();
  assert.equal(readDataFolder(settings), undefined);
  writeDataFolder(settings, "E:\\공유");
  assert.equal(readDataFolder(settings), "E:\\공유");
  writeDataFolder(settings, undefined);
  assert.equal(readDataFolder(settings), undefined);
});

test("settings stay in their own folder when the data lives elsewhere", () => {
  const data = temporary();
  const settings = temporary();
  const store = new Store(data, false, settings);
  store.mutate((history) => history.add("공유 할 일"));
  store.setPref("font", "brush");
  store.flush();
  assert.equal(hasList(data), true);
  assert.equal(fs.existsSync(path.join(data, "settings.json")), false);
  assert.equal(fs.existsSync(path.join(settings, "todos.json")), false);
});

test("a list changed on another computer is read back, and undo starts over", () => {
  const directory = temporary();
  const store = new Store(directory);
  store.mutate((history) => history.add("여기서 적은 일"));
  assert.equal(store.history.canUndo, true);
  writeElsewhere(directory, "다른 PC에서 적은 일");
  let reloaded = 0;
  store.on("reloaded", () => { reloaded += 1; });
  assert.equal(store.catchUp(), true);
  assert.deepEqual(titles(store), ["여기서 적은 일", "다른 PC에서 적은 일"]);
  assert.equal(store.history.canUndo, false);
  assert.equal(reloaded, 1);
  assert.equal(store.catchUp(), false); // its own write is not "a change"
});

test("a change here first catches up, so a newer file is never overwritten", () => {
  const directory = temporary();
  const store = new Store(directory);
  store.mutate((history) => history.add("하나"));
  writeElsewhere(directory, "둘 (다른 PC)");
  store.mutate((history) => history.add("셋"));
  const onDisk = parseNotebook(fs.readFileSync(path.join(directory, "todos.json"), "utf8")).items.map((item) => item.title);
  assert.deepEqual(onDisk, ["하나", "둘 (다른 PC)", "셋"]);
  assert.deepEqual(titles(store), onDisk);
});

test("a file that can't be read yet is not overwritten", () => {
  const directory = temporary();
  const store = new Store(directory);
  store.mutate((history) => history.add("하나"));
  fs.writeFileSync(path.join(directory, "todos.json"), '{"items": [', "utf8"); // still arriving
  store.mutate((history) => history.add("둘"));
  assert.equal(fs.readFileSync(path.join(directory, "todos.json"), "utf8"), '{"items": [');
  store.unwatch();
});

test("memos: another device's file comes in, keeping a memo being written here", () => {
  const directory = temporary();
  const store = new Store(directory);
  const mine = store.addMemo();
  store.updateMemo(mine, "여기서 쓰는 중");
  const theirs = { id: "THEIRS", text: "다른 PC 메모", createdAt: "2026-10-01T01:00:00Z", updatedAt: "2026-10-01T01:00:00Z" };
  fs.writeFileSync(path.join(directory, "memos.json"), JSON.stringify({ memos: [theirs] }), "utf8");
  store.catchUp();
  assert.deepEqual(store.memos.map((memo) => memo.text).sort(), ["다른 PC 메모", "여기서 쓰는 중"]);
  store.flush();
  const saved = JSON.parse(fs.readFileSync(path.join(directory, "memos.json"), "utf8")) as { memos: { text: string }[] };
  assert.deepEqual(saved.memos.map((memo) => memo.text).sort(), ["다른 PC 메모", "여기서 쓰는 중"]);
});

test("memos: changes from another device and from here both survive, like on the Mac", () => {
  const directory = temporary();
  const store = new Store(directory);
  const ids: Record<string, string> = {};
  for (const name of ["keep", "theirs", "gone-here", "gone-there"]) {
    ids[name] = store.addMemo();
    store.updateMemo(ids[name], name);
    store.closeMemo(ids[name]);
  }
  const file = path.join(directory, "memos.json");
  const later = "2099-01-01T00:00:00Z";
  const edit = (change: (memos: Memo[]) => Memo[]) => fs.writeFileSync(file, serializeMemos(change(parseMemos(fs.readFileSync(file, "utf8")))), "utf8");
  // The other PC, a moment ago: edits one, deletes one, adds one, and edits the one deleted here next.
  edit((memos) => [
    ...memos.filter((memo) => memo.id !== ids["gone-there"]).map((memo) =>
      memo.id === ids.theirs || memo.id === ids["gone-here"] ? { ...memo, text: `${memo.text} (edited there)`, updatedAt: later } : memo),
    { id: "NEW", text: "new there", createdAt: later, updatedAt: later },
  ]);
  store.updateMemo(ids.keep, "keep (edited here)");
  store.deleteMemo(ids["gone-here"]);
  const texts = () => parseMemos(fs.readFileSync(file, "utf8")).map((memo) => memo.text).sort();
  assert.deepEqual(texts(), ["keep (edited here)", "new there", "theirs (edited there)"]);
  assert.deepEqual(store.memos.map((memo) => memo.text).sort(), texts());

  // Typed in and still open, nothing new typed since the save: the other PC's edit is taken.
  const open = ids.theirs;
  const textOf = () => store.memos.find((memo) => memo.id === open)?.text;
  const setThere = (change: (text: string) => string) => edit((memos) => memos.map((memo) => (memo.id === open ? { ...memo, text: change(memo.text) } : memo)));
  store.updateMemo(open, "typed here");
  store.saveMemos();
  setThere(() => "edited there again");
  store.catchUp();
  assert.equal(textOf(), "edited there again");
  store.updateMemo(open, "edited there again"); // the editor shows it

  // Both edit the same memo at once: the two edits are joined, also while typing goes on.
  store.updateMemo(open, "장보기\n우유");
  store.saveMemos();
  setThere(() => "장보기\n우유 2개\n달걀");
  store.updateMemo(open, "장보기 목록\n우유", "장보기\n우유"); // typed here before the check
  store.catchUp();
  assert.equal(textOf(), "장보기 목록\n우유 2개\n달걀");
  store.updateMemo(open, "장보기 목록!\n우유", "장보기 목록\n우유"); // the editor hadn't shown the join yet
  assert.equal(textOf(), "장보기 목록!\n우유 2개\n달걀");
  // The editor shows the join, then types on: each addition counts once.
  store.updateMemo(open, "장보기 목록!\n우유 2개\n달걀", "장보기 목록!\n우유");
  store.updateMemo(open, "장보기 목록!\n우유 2개\n달걀 6개", "장보기 목록!\n우유 2개\n달걀");
  assert.equal(textOf(), "장보기 목록!\n우유 2개\n달걀 6개");
  store.updateMemo(open, "장보기 목록!\n우유 2개\n달걀", "장보기 목록!\n우유 2개\n달걀 6개");
  setThere((text) => `${text}\n빵`); // arrives just before closing
  store.closeMemo(open);
  assert.equal(parseMemos(fs.readFileSync(file, "utf8")).find((memo) => memo.id === open)?.text, "장보기 목록!\n우유 2개\n달걀\n빵");
  // Closed: the next change from the other PC comes in as usual.
  edit((memos) => memos.map((memo) => (memo.id === ids.theirs ? { ...memo, text: "edited there after" } : memo)));
  store.catchUp();
  assert.equal(store.memos.find((memo) => memo.id === ids.theirs)?.text, "edited there after");
});

test("watching the folder reloads a changed file on its own", async () => {
  const directory = temporary();
  const store = new Store(directory);
  store.mutate((history) => history.add("하나"));
  store.watch();
  try {
    writeElsewhere(directory, "둘");
    const deadline = Date.now() + 15_000; // fs.watch can lag while the machine is busy
    while (store.items.length < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(titles(store), ["하나", "둘"]);
  } finally {
    store.unwatch();
  }
});

test("copying a list into a shared folder replaces its files and merges the record", () => {
  const source = temporary();
  const target = temporary();
  fs.writeFileSync(path.join(source, "todos.json"), serializeNotebook({ items: [] }), "utf8");
  fs.writeFileSync(path.join(source, "memos.json"), '{"memos":[]}', "utf8");
  fs.mkdirSync(path.join(source, "archive"));
  fs.mkdirSync(path.join(target, "archive"));
  const line = (id: string) => JSON.stringify({ id, title: id, createdAt: "2026-09-01T00:00:00Z", completedAt: "2026-09-02T00:00:00Z" });
  fs.writeFileSync(path.join(source, "archive", "2026-09.jsonl"), `${line("a")}\n${line("b")}\n`, "utf8");
  fs.writeFileSync(path.join(source, "archive", "2026-08.jsonl"), `${line("old")}\n`, "utf8");
  fs.writeFileSync(path.join(target, "archive", "2026-09.jsonl"), `${line("b")}\n${line("c")}`, "utf8");
  fs.writeFileSync(path.join(target, "todos.json"), "old list", "utf8");
  fs.writeFileSync(path.join(target, "repeats.json"), "theirs", "utf8");
  copyData(source, target);
  assert.equal(fs.readFileSync(path.join(target, "todos.json"), "utf8"), serializeNotebook({ items: [] }));
  assert.equal(fs.readFileSync(path.join(target, "repeats.json"), "utf8"), "theirs"); // none here to copy
  const september = fs.readFileSync(path.join(target, "archive", "2026-09.jsonl"), "utf8").trim().split("\n").map((text) => (JSON.parse(text) as { id: string }).id);
  assert.deepEqual(september, ["b", "c", "a"]);
  assert.equal(fs.existsSync(path.join(target, "archive", "2026-08.jsonl")), true);
});

test("keeping the folder's list still adds this PC's record to it", () => {
  const source = temporary();
  const target = temporary();
  fs.mkdirSync(path.join(source, "archive"));
  fs.mkdirSync(path.join(target, "archive"));
  fs.writeFileSync(path.join(target, "todos.json"), "their list", "utf8");
  // The Mac writes the same entry with its keys in another order: still one entry.
  fs.writeFileSync(path.join(source, "archive", "2026-09.jsonl"), '{"id":"mine","title":"내 것","createdAt":"2026-09-01T00:00:00Z","completedAt":"2026-09-02T00:00:00Z"}\n{"id":"both","title":"둘 다","createdAt":"2026-09-01T00:00:00Z","completedAt":"2026-09-02T00:00:00Z"}\n', "utf8");
  fs.writeFileSync(path.join(target, "archive", "2026-09.jsonl"), '{"completedAt":"2026-09-02T00:00:00Z","createdAt":"2026-09-01T00:00:00Z","id":"both","title":"둘 다"}\n', "utf8");
  mergeArchive(source, target);
  assert.equal(fs.readFileSync(path.join(target, "todos.json"), "utf8"), "their list");
  const ids = fs.readFileSync(path.join(target, "archive", "2026-09.jsonl"), "utf8").trim().split("\n").map((text) => (JSON.parse(text) as { id: string }).id);
  assert.deepEqual(ids, ["both", "mine"]);
});

// ─── 일정 (events.json) beside the tasks ──────────────────────────────────────

const sampleEvent = (id: string, title: string): LocalEvent => ({
  id, title, date: "2026-10-08", allDay: false, days: 1, start: 600, end: 660, repeat: "none", skip: [], color: "sage",
  createdAt: "2026-10-01T09:00:00Z", updatedAt: "2026-10-01T09:00:00Z",
});

test("events are written to events.json beside the tasks and read back", () => {
  const directory = temporary();
  const store = new Store(directory);
  let told = 0;
  store.on("events", () => { told += 1; });
  store.putEvent(sampleEvent("E1", "팀 회의"));
  store.putEvent({ ...sampleEvent("E1", "팀 회의 (바뀜)"), location: "3층" });
  store.putEvent(sampleEvent("E2", "치과"));
  store.removeEvent("E2");
  assert.equal(told, 4);
  const again = new Store(directory);
  assert.deepEqual(again.events, [{ ...sampleEvent("E1", "팀 회의 (바뀜)"), location: "3층" }]);
  assert.deepEqual(again.state().events, again.events);
});

test("events changed on another computer are read back, and a newer file is never overwritten", () => {
  const directory = temporary();
  const store = new Store(directory);
  store.putEvent(sampleEvent("E1", "여기서"));
  const file = path.join(directory, "events.json");
  fs.writeFileSync(file, serializeEvents([sampleEvent("E1", "여기서"), sampleEvent("E9", "저기서")]), "utf8");
  assert.equal(store.catchUp(), true);
  assert.deepEqual(store.events.map((entry) => entry.title), ["여기서", "저기서"]);
  fs.writeFileSync(file, serializeEvents([sampleEvent("E9", "저기서만")]), "utf8");
  store.putEvent(sampleEvent("E3", "새로"));
  assert.deepEqual(parseEvents(fs.readFileSync(file, "utf8")).map((entry) => entry.title), ["저기서만", "새로"]);
});

test("a damaged events.json is kept aside, not trimmed", () => {
  const directory = temporary();
  fs.writeFileSync(path.join(directory, "events.json"), "{ not json", "utf8");
  const store = new Store(directory);
  assert.deepEqual(store.events, []);
  assert.match(store.storageError ?? "", /일정 파일을 읽지 못해서 일정 없이 시작했어요/);
  assert.ok(fs.readdirSync(directory).some((name) => name.startsWith("events.unreadable-")));
});

// ─── 알람 (alarms.json) and 빠른 메모 ────────────────────────────────────────────

const sampleAlarm = (id: string, time: string, label = ""): Alarm => ({
  id, time, label, days: [1, 2, 3, 4, 5], enabled: true, sound: "bell", snooze: 10, createdAt: "2026-10-01T09:00:00Z", updatedAt: "2026-10-01T09:00:00Z",
});

test("alarms are written to alarms.json beside the tasks, shared like the rest, and a damaged file is kept aside", () => {
  const directory = temporary();
  const store = new Store(directory);
  let told = 0;
  store.on("alarms", () => { told += 1; });
  store.putAlarm(sampleAlarm("A1", "07:00", "기상"));
  store.putAlarm({ ...sampleAlarm("A1", "07:30", "기상"), enabled: false });
  store.putAlarm(sampleAlarm("A2", "21:00", "약"));
  store.removeAlarm("A2");
  assert.equal(told, 4);
  const again = new Store(directory);
  assert.deepEqual(again.alarms, [{ ...sampleAlarm("A1", "07:30", "기상"), enabled: false }]);
  assert.deepEqual(again.state().alarms, again.alarms);
  // Another device's file comes in; a newer file is never overwritten.
  const file = path.join(directory, "alarms.json");
  fs.writeFileSync(file, serializeAlarms([sampleAlarm("A9", "06:00", "저기서")]), "utf8");
  assert.equal(again.catchUp(), true);
  assert.deepEqual(again.alarms.map((alarm) => alarm.label), ["저기서"]);
  fs.writeFileSync(file, serializeAlarms([sampleAlarm("A8", "05:00", "저기서만")]), "utf8");
  again.putAlarm(sampleAlarm("A3", "08:00", "새로"));
  assert.deepEqual(parseAlarms(fs.readFileSync(file, "utf8")).map((alarm) => alarm.label), ["저기서만", "새로"]);
  // Copied with the list into a shared folder.
  const shared = temporary();
  copyData(directory, shared);
  assert.ok(fs.existsSync(path.join(shared, "alarms.json")));
  const damaged = temporary();
  fs.writeFileSync(path.join(damaged, "alarms.json"), "{ not json", "utf8");
  const broken = new Store(damaged);
  assert.deepEqual(broken.alarms, []);
  assert.match(broken.storageError ?? "", /알람 파일을 읽지 못해서 알람 없이 시작했어요/);
  assert.ok(fs.readdirSync(damaged).some((name) => name.startsWith("alarms.unreadable-")));
});

test("빠른 메모: the text becomes a new memo at the top, saved at once; blank text adds nothing", () => {
  const directory = temporary();
  const store = new Store(directory);
  store.updateMemo(store.addMemo(), "먼저 쓴 메모");
  store.flush();
  assert.equal(store.addMemoText("   \n "), undefined);
  const id = store.addMemoText("빠른 메모\n둘째 줄");
  assert.equal(store.memos[0].id, id);
  assert.deepEqual(new Store(directory).memos.map((memo) => memo.text), ["빠른 메모\n둘째 줄", "먼저 쓴 메모"]);
});

test("Google's leftovers: the settings drop its keys, and to-dos drop googleTaskId on the next save", () => {
  const directory = temporary();
  fs.writeFileSync(path.join(directory, "settings.json"), JSON.stringify({ prefs: { font: "brush", calendarHidden: ["x"], calendarTasks: true, calendarSent: {}, calendarLastCalendar: "me", calendarTasksList: "l", calendarAlertMinutes: 15 } }), "utf8");
  fs.writeFileSync(path.join(directory, "todos.json"), '{"items":[{"id":"A","title":"보고서","isCompleted":false,"createdAt":"2026-10-01T00:00:00Z","googleTaskId":"t1"}]}', "utf8");
  const store = new Store(directory);
  assert.equal(store.prefs.font, "brush");
  assert.equal(store.prefs.calendarAlertMinutes, 15);
  for (const key of ["calendarHidden", "calendarTasks", "calendarSent", "calendarLastCalendar", "calendarTasksList"]) assert.equal(key in store.prefs, false, key);
  assert.equal("googleTaskId" in store.items[0], false);
  store.mutate((history) => history.edit("A", "보고서 쓰기"));
  assert.doesNotMatch(fs.readFileSync(path.join(directory, "todos.json"), "utf8"), /googleTaskId/);
});
