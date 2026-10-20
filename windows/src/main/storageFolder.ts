import fs from "node:fs";
import path from "node:path";
import { parseArchiveLines } from "../core/archive";
import { dataFiles, isArchiveName, isBackupName, makeBackup, mergeFiles, preImportName, replaceFiles, type BackupFiles } from "../core/backup";
import { parseStorageFile, serializeStorageFile, sharedFiles, storageFileName } from "../core/storage";
import { focusFileName, mergeFocus } from "../core/focus";

/** The shared folder chosen in Settings, kept in storage.json beside settings.json; undefined means the default. */
export function readDataFolder(settingsDirectory: string): string | undefined {
  try {
    return parseStorageFile(fs.readFileSync(path.join(settingsDirectory, storageFileName), "utf8"));
  } catch {
    return undefined;
  }
}

export function writeDataFolder(settingsDirectory: string, folder: string | undefined): void {
  fs.mkdirSync(settingsDirectory, { recursive: true });
  const file = path.join(settingsDirectory, storageFileName);
  fs.writeFileSync(`${file}.tmp`, serializeStorageFile(folder), "utf8");
  fs.renameSync(`${file}.tmp`, file);
}

/** A folder that can be written to now (a cloud or USB folder may be missing at launch). */
export function usableFolder(folder: string): boolean {
  try {
    fs.mkdirSync(folder, { recursive: true });
    fs.accessSync(folder, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function hasList(folder: string): boolean {
  return fs.existsSync(path.join(folder, "todos.json"));
}

/**
 * Copies this device's list into `target`: todos, memos and repeats replace the ones there; the
 * finished-task record is merged month by month (lines another device already filed stay).
 */
export function copyData(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const file of sharedFiles) {
    const from = path.join(source, file);
    if (!fs.existsSync(from)) continue;
    const to = path.join(target, file);
    fs.copyFileSync(from, `${to}.tmp`);
    fs.renameSync(`${to}.tmp`, to);
  }
  mergeArchive(source, target);
}

/**
 * Adds this device's finished-task record to `target`'s, month by month. Done whichever list is
 * kept: the record only ever grows, so nothing this device filed goes missing.
 */
export function mergeArchive(source: string, target: string): void {
  mergeFocusFile(source, target);
  const archive = path.join(source, "archive");
  if (!fs.existsSync(archive)) return;
  const targetArchive = path.join(target, "archive");
  fs.mkdirSync(targetArchive, { recursive: true });
  for (const name of fs.readdirSync(archive).filter((file) => file.endsWith(".jsonl"))) {
    const from = path.join(archive, name);
    const to = path.join(targetArchive, name);
    if (!fs.existsSync(to)) {
      fs.copyFileSync(from, to);
      continue;
    }
    const there = new Set(parseArchiveLines(fs.readFileSync(to, "utf8")).map((entry) => entry.id));
    const missing = parseArchiveLines(fs.readFileSync(from, "utf8")).filter((entry) => !there.has(entry.id));
    if (missing.length === 0) continue;
    const existing = fs.readFileSync(to, "utf8");
    const lead = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(to, lead + missing.map((entry) => JSON.stringify(entry)).join("\n") + "\n", "utf8");
  }
}

/** 집중 기록 (focus.jsonl) goes along the same way: the sessions `target` lacks are added by id. */
export function mergeFocusFile(source: string, target: string): void {
  let mine: string;
  try { mine = fs.readFileSync(path.join(source, focusFileName), "utf8"); } catch { return; }
  const to = path.join(target, focusFileName);
  let there = "";
  try { there = fs.readFileSync(to, "utf8"); } catch { /* none there yet */ }
  const merged = mergeFocus(there, mine);
  if (merged !== there) writeFileAtomically(to, merged);
}

// ─── 백업 · 옮기기 ────────────────────────────────────────────────────────────

/** The data files the storage folder has now, as they are (todos, memos, repeats, events, alarms, the record's months, the focus record). */
export function readDataFiles(folder: string): BackupFiles {
  const files: BackupFiles = {};
  for (const name of [...dataFiles, focusFileName]) {
    try { files[name] = fs.readFileSync(path.join(folder, name), "utf8"); } catch { /* not there */ }
  }
  let months: string[] = [];
  try { months = fs.readdirSync(path.join(folder, "archive")); } catch { /* no record yet */ }
  for (const month of months.sort()) {
    const name = `archive/${month}`;
    if (!isArchiveName(name)) continue;
    try { files[name] = fs.readFileSync(path.join(folder, "archive", month), "utf8"); } catch { /* gone meanwhile */ }
  }
  return files;
}

/** Written beside the target and then renamed over it, so nobody ever sees half a file. */
export function writeFileAtomically(file: string, contents: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, contents, "utf8");
  fs.renameSync(temporary, file);
}

/**
 * Makes the folder hold exactly `next` (as far as data files go), starting from `current`. Every
 * changed file is first written in full beside its target; only when all of them are written are
 * they renamed into place, and the record's months that `next` lacks removed. A failed write
 * leaves the folder as it was.
 */
export function writeDataFiles(folder: string, current: BackupFiles, next: BackupFiles): void {
  const changed = Object.keys(next).filter((name) => isBackupName(name) && next[name] !== current[name]);
  const staged: { temporary: string; target: string }[] = [];
  try {
    for (const name of changed) {
      const target = path.join(folder, ...name.split("/"));
      const temporary = `${target}.import-tmp`;
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(temporary, next[name], "utf8");
      staged.push({ temporary, target });
    }
  } catch (error) {
    for (const { temporary } of staged) fs.rmSync(temporary, { force: true });
    throw error;
  }
  for (const { temporary, target } of staged) fs.renameSync(temporary, target);
  for (const name of Object.keys(current)) {
    if (isArchiveName(name) && next[name] === undefined) fs.rmSync(path.join(folder, ...name.split("/")), { force: true });
  }
}

export const backupsFolder = (settingsDirectory: string) => path.join(settingsDirectory, "backups");

/** Before an import: the folder as it is now, in `backups/` on this device (the ten newest are kept). Returns the file. */
export function saveBeforeImport(settingsDirectory: string, contents: string, now: Date): string {
  const folder = backupsFolder(settingsDirectory);
  const file = path.join(folder, preImportName(now));
  writeFileAtomically(file, contents);
  const kept = fs.readdirSync(folder).filter((name) => name.startsWith("가져오기-전-") && name.endsWith(".jongi")).sort().reverse(); // i18n-ok: preImportName's file names
  for (const name of kept.slice(10)) fs.rmSync(path.join(folder, name), { force: true });
  return file;
}

/**
 * Google 캘린더 and Google Tasks are gone (1.16.0): the files they kept on this device — the
 * encrypted sign-in, the copy of the events, the Tasks sync record — are removed at launch, so no
 * token stays behind.
 */
export const leftoverFiles = ["google.json", "calendar-cache.json", "tasks-sync.json"];

export function removeLeftovers(settingsDirectory: string): string[] {
  const removed: string[] = [];
  for (const name of leftoverFiles.flatMap((file) => [file, `${file}.tmp`])) {
    const file = path.join(settingsDirectory, name);
    try {
      if (!fs.existsSync(file)) continue;
      fs.rmSync(file, { force: true });
      removed.push(name);
    } catch {
      // Tried again at the next launch.
    }
  }
  return removed;
}

/**
 * 가져오기 into the storage folder, after the backup was read and checked (parseBackup): the folder
 * as it is now goes to backups/ first (a failure there stops everything), then 합치기 (`merge`) or
 * 바꾸기 (`replace`) is written. Returns what the folder now holds and where the copy went.
 */
export function importInto(dataDirectory: string, settingsDirectory: string, imported: BackupFiles, mode: "merge" | "replace", from: string, now: Date): { files: BackupFiles; saved: string } {
  const current = readDataFiles(dataDirectory);
  const saved = saveBeforeImport(settingsDirectory, makeBackup(current, from, now), now);
  const next = mode === "replace" ? replaceFiles(current, imported) : mergeFiles(current, imported);
  writeDataFiles(dataDirectory, current, next);
  return { files: next, saved };
}
