import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseBackup } from "../src/core/backup";
import { AutoBackup, isInside, readBackupState } from "../src/main/autoBackup";
import { temporaryFolder } from "./temporaryFolder";

// 자동 백업 (#139): the daily copy, the copy before an update, the backup folder — in fictional temporary folders only.

const temporary = () => temporaryFolder("paper-todo-autobackup-");
const todos = (...titles: string[]) => JSON.stringify({ items: titles.map((title, index) => ({ id: `00000000-0000-4000-8000-00000000000${index}`, title, isCompleted: false, createdAt: "2026-10-01T09:00:00Z" })) }, null, 2) + "\n";

function setUp(): { settings: string; data: string; backups: AutoBackup } {
  const settings = temporary();
  const data = temporary();
  fs.writeFileSync(path.join(data, "todos.json"), todos("보고서 쓰기", "장보기"));
  return { settings, data, backups: new AutoBackup(settings, () => data, () => "Windows 1.31.0") };
}

const copies = (folder: string) => (fs.existsSync(folder) ? fs.readdirSync(folder).sort() : []);

test("the daily copy: once in the app's day, none when nothing changed, a new one the next day after a change", () => {
  const { settings, data, backups } = setUp();
  const folder = path.join(settings, "backups");
  assert.equal(path.basename(backups.daily(new Date(2026, 9, 30, 9, 12)) ?? ""), "매일-20261030-091200.jongi");
  // The same day: none, changed or not.
  fs.writeFileSync(path.join(data, "todos.json"), todos("보고서 쓰기"));
  assert.equal(backups.daily(new Date(2026, 9, 30, 15, 0)), undefined);
  // Past 4 a.m. the next day with a change: one; again with nothing changed since: none.
  assert.equal(path.basename(backups.daily(new Date(2026, 9, 31, 4, 0)) ?? ""), "매일-20261031-040000.jongi");
  assert.equal(backups.daily(new Date(2026, 10, 1, 9, 0)), undefined);
  assert.deepEqual(copies(folder), ["매일-20261030-091200.jongi", "매일-20261031-040000.jongi"]);
  const saved = parseBackup(fs.readFileSync(path.join(folder, "매일-20261031-040000.jongi"), "utf8"));
  assert.ok("backup" in saved);
  assert.equal(saved.backup.reason, "daily");
  assert.deepEqual(saved.backup.counts, { todos: 1, memos: 0, events: 0, archive: 0 });
  // The switch off: none, even after a change.
  fs.writeFileSync(path.join(data, "todos.json"), todos("회의 자료 정리"));
  backups.setAuto(false);
  assert.equal(backups.daily(new Date(2026, 10, 2, 9, 0)), undefined);
  assert.equal(readBackupState(settings).auto, false);
  // …but a copy before an overwrite (or by hand) is made either way.
  assert.equal(path.basename(backups.copy("manual", new Date(2026, 10, 2, 9, 1))), "직접-20261102-090100.jongi");
});

test("a manual copy remembers its fingerprint: the daily check after it, with nothing changed, makes none", () => {
  const { settings, backups } = setUp();
  backups.copy("manual", new Date(2026, 9, 30, 8, 0));
  assert.equal(backups.daily(new Date(2026, 9, 30, 9, 0)), undefined);
  assert.deepEqual(copies(path.join(settings, "backups")), ["직접-20261030-080000.jongi"]);
});

test("an empty storage folder, or an import going on: no daily copy", () => {
  const settings = temporary();
  const empty = new AutoBackup(settings, () => temporary(), () => "Windows 1.31.0");
  assert.equal(empty.daily(new Date(2026, 9, 30, 9, 0)), undefined);
  const { backups } = setUp();
  backups.busy = true;
  assert.equal(backups.daily(new Date(2026, 9, 30, 9, 0)), undefined);
});

test("the first launch of a new version copies the folder first, once; a fresh install copies nothing", () => {
  const { settings, backups } = setUp();
  assert.equal(path.basename(backups.beforeUpdate("1.31.0", new Date(2026, 9, 30, 9, 0)) ?? ""), "업데이트-전-20261030-090000.jongi");
  assert.equal(backups.beforeUpdate("1.31.0", new Date(2026, 9, 30, 9, 5)), undefined);
  assert.equal(readBackupState(settings).version, "1.31.0");
  assert.equal(path.basename(backups.beforeUpdate("1.31.1", new Date(2026, 9, 31, 9, 0)) ?? ""), "업데이트-전-20261031-090000.jongi");
  const fresh = new AutoBackup(temporary(), () => temporary(), () => "Windows 1.31.0");
  assert.equal(fresh.beforeUpdate("1.31.0"), undefined);
  assert.equal(fresh.state.version, "1.31.0");
});

test("the backup folder: a chosen one, never the storage folder or inside it; a missing one falls back to the default", () => {
  const { settings, data, backups } = setUp();
  assert.equal(backups.setFolder(data), false);
  assert.equal(backups.setFolder(path.join(data, "backups")), false);
  assert.equal(backups.folder, path.join(settings, "backups"));
  const chosen = temporary();
  assert.equal(backups.setFolder(chosen), true);
  assert.deepEqual(backups.place, { folder: chosen, custom: true, missing: false });
  backups.copy("manual", new Date(2026, 9, 30, 9, 0));
  assert.deepEqual(copies(chosen), ["직접-20261030-090000.jongi"]);
  // The disk is gone: copies go to the default, and the view says so.
  fs.rmSync(chosen, { recursive: true, force: true });
  assert.deepEqual(backups.place, { folder: path.join(settings, "backups"), custom: false, missing: true });
  backups.copy("manual", new Date(2026, 9, 30, 9, 30));
  assert.deepEqual(copies(path.join(settings, "backups")), ["직접-20261030-093000.jongi"]);
  assert.equal(fs.existsSync(chosen), false);
  const view = backups.view(false);
  assert.equal(view.missing, true);
  assert.deepEqual(view.entries.map((entry) => entry.name), ["직접-20261030-093000.jongi"]);
  // 기본으로.
  backups.setFolder(undefined);
  assert.equal(readBackupState(settings).folder, undefined);
  assert.equal(backups.view(false).missing, false);
});

test("a copy that can't be written is remembered (the status line says so) until one works", () => {
  const { settings, backups } = setUp();
  const blocked = path.join(temporary(), "here");
  fs.writeFileSync(blocked, "a file where the folder should be");
  backups.state.folder = blocked;
  // (A file isn't a folder: the default is used, so block the default too.)
  fs.writeFileSync(path.join(settings, "backups"), "a file where the folder should be");
  assert.throws(() => backups.copy("manual", new Date(2026, 9, 30, 9, 0)));
  assert.equal(backups.view(false).failed, true);
  fs.rmSync(path.join(settings, "backups"));
  backups.copy("manual", new Date(2026, 9, 30, 9, 1));
  assert.equal(backups.view(false).failed, false);
});

test("the list: newest first, with sizes, and the counts read from each copy", async () => {
  const { settings, backups } = setUp();
  backups.copy("daily", new Date(2026, 9, 29, 9, 0));
  backups.copy("beforeImport", new Date(2026, 9, 30, 21, 40));
  backups.copy("manual", new Date(2026, 9, 30, 8, 0));
  fs.writeFileSync(path.join(settings, "backups", "notes.txt"), "not a copy");
  const first = backups.view(false);
  assert.deepEqual(first.entries.map((entry) => entry.reason), ["beforeImport", "manual", "daily"]);
  assert.equal(first.total, first.entries.reduce((sum, entry) => sum + entry.size, 0));
  assert.ok(first.entries.every((entry) => entry.size > 0));
  // The counts come in the background, then the next view has them (waited for, not timed: a busy machine is slow).
  const counted = () => backups.view(false).entries.every((entry) => entry.counts !== undefined);
  for (const deadline = Date.now() + 10_000; !counted() && Date.now() < deadline;) {
    await new Promise((resolve) => setTimeout(resolve, 25));
    backups.refresh();
  }
  assert.deepEqual(backups.view(false).entries.map((entry) => entry.counts), Array(3).fill({ todos: 2, memos: 0, events: 0, archive: 0 }));
  assert.equal(backups.fileOf("../settings.json"), undefined);
  assert.equal(backups.fileOf("notes.txt"), undefined);
  assert.equal(path.basename(backups.fileOf("직접-20261030-080000.jongi") ?? ""), "직접-20261030-080000.jongi");
});

test("a folder inside another (Windows paths compare without case)", () => {
  assert.equal(isInside("C:\\Users\\sample\\OneDrive\\종이냥\\backups", "c:\\users\\sample\\onedrive\\종이냥", true), true);
  assert.equal(isInside("C:\\Users\\sample\\OneDrive\\종이냥", "C:\\Users\\sample\\OneDrive\\종이냥", true), true);
  assert.equal(isInside("C:\\Users\\sample\\Backups", "C:\\Users\\sample\\OneDrive", true), false);
  assert.equal(isInside("C:\\Users\\sample\\OneDrive2", "C:\\Users\\sample\\OneDrive", true), false);
  assert.equal(isInside("/tmp/a/b", "/tmp/a", false), true);
  assert.equal(isInside("/tmp/ab", "/tmp/a", false), false);
});
