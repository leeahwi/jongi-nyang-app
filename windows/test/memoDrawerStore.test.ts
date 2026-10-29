import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { makeBackup, mergeFiles, parseBackup, replaceFiles, summary, summaryText } from "../src/core/backup";
import { serializeMemos } from "../src/core/memo";
import { inboxID, moveMemo, parseMemoFolders, pinnedView, placementOf, removeCheckedLines, serializeMemoFolders, setMemoPaper, visibleFolders } from "../src/core/memoDrawer";
import { copyData } from "../src/main/storageFolder";
import { Store } from "../src/main/store";

// 메모 서랍 in the store: memo-folders.json beside memos.json, read, merged, kept aside, backed up (D5, D6, D13, D15).

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "paper-todo-drawer-"));
const read = (directory: string) => fs.readFileSync(path.join(directory, "memo-folders.json"), "utf8");
const stamp = (offset = 0) => new Date(Date.now() + offset).toISOString().replace(/\.\d{3}Z$/, "Z");

test("drawer store: no folders file means everything in 메모; a folder and a move are written at once", () => {
  const directory = temporary();
  const store = new Store(directory);
  const id = store.addMemoText("회의 메모")!;
  assert.equal(fs.existsSync(path.join(directory, "memo-folders.json")), false); // the inbox needs no entry
  store.changeFolders((data) => ({ ...data, folders: [...data.folders, { id: "work", name: "회사", color: "pink", order: 1, updatedAt: stamp() }] }));
  store.changeFolders((data) => moveMemo(data, id, "work"));
  const saved = parseMemoFolders(read(directory));
  assert.deepEqual(visibleFolders(saved).map((folder) => folder.id), [inboxID, "work"]);
  assert.equal(placementOf(saved, id).folder, "work");
  // memos.json keeps its own shape: no new keys.
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(directory, "memos.json"), "utf8")).memos[0]).sort(), ["createdAt", "id", "text", "updatedAt"]);
});

test("D5: an older version saves memos.json only — the folders stay, its new memo is in 메모", () => {
  const directory = temporary();
  const store = new Store(directory);
  const id = store.addMemoText("회의 메모")!;
  store.changeFolders((data) => ({ ...data, folders: [...data.folders, { id: "work", name: "회사", color: "pink", order: 1, updatedAt: stamp() }] }));
  store.changeFolders((data) => moveMemo(data, id, "work"));
  const before = read(directory);
  // The older app adds a memo and saves memos.json (it knows nothing of the other file).
  const memos = JSON.parse(fs.readFileSync(path.join(directory, "memos.json"), "utf8")).memos;
  fs.writeFileSync(path.join(directory, "memos.json"), serializeMemos([{ id: "OLD", text: "옛 버전에서 적음", createdAt: stamp(), updatedAt: stamp() }, ...memos]), "utf8");
  const again = new Store(directory);
  assert.equal(read(directory), before);
  assert.equal(placementOf(again.memoFolders, id).folder, "work");
  assert.equal(placementOf(again.memoFolders, "OLD").folder, inboxID);
});

test("quick memo and /메모 go to the last folder (고정 isn't one); the slip in 고정 pins in 메모 (D11)", () => {
  const directory = temporary();
  const store = new Store(directory);
  store.changeFolders((data) => ({ ...data, folders: [...data.folders, { id: "home", name: "집", color: "mint", order: 1, updatedAt: stamp() }] }));
  const where = (id: string | undefined) => placementOf(store.memoFolders, id!).folder;
  assert.equal(where(store.addMemoText("처음")), inboxID);
  store.setPref("drawerLastFolder", "home");
  assert.equal(where(store.addMemoText("빠른 메모")), "home");
  store.setPref("drawerLastFolder", pinnedView);
  assert.equal(where(store.addMemoText("또")), inboxID);
  const pinned = store.addMemoText("고정에서", { folder: inboxID, pinned: true })!;
  assert.deepEqual(placementOf(store.memoFolders, pinned), { folder: inboxID, pinned: true });
});

test("a deleted memo's place comes back with 되돌리기; places of memos gone an hour are dropped (D6)", () => {
  const directory = temporary();
  const store = new Store(directory);
  store.changeFolders((data) => ({ ...data, folders: [...data.folders, { id: "home", name: "집", color: "mint", order: 1, updatedAt: stamp() }] }));
  store.setPref("drawerLastFolder", "home");
  const id = store.addMemoText("되돌릴 메모")!;
  store.deleteMemo(id);
  store.restoreMemo();
  assert.equal(placementOf(store.memoFolders, id).folder, "home");
  // A place two hours old whose memo is gone, and one a minute old (its memo may still be coming).
  store.changeFolders((data) => ({ ...data, placement: { ...data.placement, OLD: { folder: "home", pinned: false, at: stamp(-7_200_000) }, NEW: { folder: "home", pinned: false, at: stamp(-60_000) } } }));
  const saved = parseMemoFolders(read(directory));
  assert.equal(saved.placement.OLD, undefined);
  assert.ok(saved.placement.NEW);
  assert.ok(saved.placement[id]);
});

test("D13 in the store: another device's file is merged entry by entry before a change here", () => {
  const directory = temporary();
  const store = new Store(directory);
  const a = store.addMemoText("가")!;
  const b = store.addMemoText("나")!;
  store.changeFolders((data) => ({ ...data, folders: [...data.folders, { id: "work", name: "회사", color: "pink", order: 1, updatedAt: stamp(-120_000) }, { id: "home", name: "집", color: "mint", order: 2, updatedAt: stamp(-120_000) }] }));
  // Elsewhere: memo a to home, a minute ago, and a new folder.
  const theirs = parseMemoFolders(read(directory));
  const elsewhere = { ...moveMemo(theirs, a, "home", new Date(Date.now() - 60_000)), folders: [...theirs.folders, { id: "far", name: "공부", color: "sky", order: 3, updatedAt: stamp(-60_000) }] };
  fs.writeFileSync(path.join(directory, "memo-folders.json"), serializeMemoFolders(elsewhere), "utf8");
  // Here, now: memo b to work.
  store.changeFolders((data) => moveMemo(data, b, "work"));
  const saved = parseMemoFolders(read(directory));
  assert.equal(placementOf(saved, a).folder, "home");
  assert.equal(placementOf(saved, b).folder, "work");
  assert.deepEqual(visibleFolders(saved).map((folder) => folder.id), [inboxID, "work", "home", "far"]);
});

test("D15: an unreadable folders file is moved aside, the drawer starts afresh, said once", () => {
  const directory = temporary();
  fs.writeFileSync(path.join(directory, "memo-folders.json"), "{ not json", "utf8");
  const store = new Store(directory);
  assert.deepEqual(visibleFolders(store.memoFolders).map((folder) => folder.id), [inboxID]);
  const aside = fs.readdirSync(directory).filter((name) => /^memo-folders\.unreadable-\d{8}-\d{6}\.json$/.test(name));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(directory, aside[0]), "utf8"), "{ not json");
  assert.equal(fs.existsSync(path.join(directory, "memo-folders.json")), false);
  assert.match(store.storageError ?? "", /메모 서랍의 폴더 정보를 읽지 못해/);
});

test("backup: memo-folders.json travels, is checked, merged (D13/D14) and not counted", () => {
  const sample = (folder: string, at: string) => serializeMemoFolders({ v: 1, folders: [{ id: inboxID, name: "메모", color: "lavender", order: 0, updatedAt: "1970-01-01T00:00:00Z" }, { id: folder, name: folder, color: "pink", order: 1, updatedAt: at }], placement: { m1: { folder, pinned: false, at } }, updatedAt: at });
  const mine = sample("work", "2026-10-27T05:00:00Z");
  const theirs = sample("home", "2026-10-27T05:01:00Z");
  const backup = makeBackup({ "memo-folders.json": theirs, "memos.json": '{"memos":[]}\n' }, "Windows 1.28.0", new Date("2026-10-27T06:00:00Z"));
  const parsed = parseBackup(backup);
  assert.ok("backup" in parsed);
  if (!("backup" in parsed)) return;
  assert.equal(parsed.backup.files["memo-folders.json"], theirs);
  assert.deepEqual(parseBackup(makeBackup({ "memo-folders.json": "[]" }, "x", new Date())), { error: "백업 파일 안의 ‘memo-folders.json’을 읽지 못했어요." });
  const merged = parseMemoFolders(mergeFiles({ "memo-folders.json": mine }, parsed.backup.files)["memo-folders.json"]);
  assert.deepEqual(visibleFolders(merged).map((folder) => folder.id), [inboxID, "home", "work"].sort((x, y) => (x === inboxID ? -1 : y === inboxID ? 1 : x < y ? -1 : 1)));
  assert.equal(placementOf(merged, "m1").folder, "home");
  assert.equal(mergeFiles({}, { "memo-folders.json": theirs })["memo-folders.json"], theirs);
  assert.equal(mergeFiles({ "memo-folders.json": "broken" }, { "memo-folders.json": theirs })["memo-folders.json"], theirs);
  assert.equal(mergeFiles({ "memo-folders.json": mine }, { "memo-folders.json": mine })["memo-folders.json"], mine);
  assert.match(replaceFiles({ "memo-folders.json": mine }, {})["memo-folders.json"], /"placement": \{\}/);
  assert.equal(summaryText(summary({ "memo-folders.json": mine })), "비어 있는 백업이에요.");
});

test("a shared folder chosen: memo-folders.json goes along", () => {
  const source = temporary();
  const target = temporary();
  fs.writeFileSync(path.join(source, "memo-folders.json"), "x", "utf8");
  copyData(source, target);
  assert.equal(fs.readFileSync(path.join(target, "memo-folders.json"), "utf8"), "x");
});

test("M4 in the store: /메모 goes to the last folder (the note's input line uses the default target)", () => {
  const directory = temporary();
  const store = new Store(directory);
  store.changeFolders((data) => ({ ...data, folders: [...data.folders, { id: "home", name: "집", color: "mint", order: 1, updatedAt: stamp() }] }));
  store.setPref("drawerLastFolder", "home");
  const id = store.addMemoText("우유")!;
  assert.equal(placementOf(store.memoFolders, id).folder, "home");
  assert.equal(store.memos[0].text, "우유");
});

test("1.29 in the store: 복제 of a folder copies its memos (same words and times), 복제 of a memo, a memo's paper, the whole text at once", () => {
  const directory = temporary();
  const store = new Store(directory);
  store.changeFolders((data) => ({ ...data, folders: [...data.folders, { id: "work", name: "회사", color: "pink", order: 1, updatedAt: stamp() }, { id: "home", name: "집", color: "mint", order: 2, updatedAt: stamp() }] }));
  const first = store.addMemoText("회의 메모\n- [x] 우유\n- [ ] 빵", { folder: "work", pinned: true })!;
  const second = store.addMemoText("인사", { folder: "work", pinned: false })!;
  store.changeFolders((data) => setMemoPaper(data, second, "night"));
  store.duplicateFolder("work", "W2");
  const saved = parseMemoFolders(read(directory));
  assert.deepEqual(visibleFolders(saved).map((folder) => [folder.id, folder.name, folder.order]), [[inboxID, "메모", 0], ["work", "회사", 1], ["W2", "회사 사본", 2], ["home", "집", 3]]);
  const copies = store.memos.filter((memo) => placementOf(saved, memo.id).folder === "W2");
  assert.equal(copies.length, 2);
  for (const copy of copies) {
    const original = store.memos.find((memo) => memo.text === copy.text && memo.id !== copy.id)!;
    assert.deepEqual([copy.createdAt, copy.updatedAt], [original.createdAt, original.updatedAt]);
    assert.equal(placementOf(saved, copy.id).pinned, placementOf(saved, original.id).pinned);
    assert.equal(saved.placement[copy.id].paper, saved.placement[original.id].paper);
  }
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "memos.json"), "utf8")).memos.length, 4);
  const twin = store.duplicateMemo(first)!;
  assert.equal(store.memos[0].id, twin);
  assert.deepEqual(placementOf(store.memoFolders, twin), { folder: "work", pinned: true });
  store.setMemoText(first, removeCheckedLines(store.memos.find((memo) => memo.id === first)!.text));
  assert.equal(store.memos[0].text, "회의 메모\n- [ ] 빵");
  assert.equal(JSON.parse(fs.readFileSync(path.join(directory, "memos.json"), "utf8")).memos[0].text, "회의 메모\n- [ ] 빵");
});
