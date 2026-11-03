import fs from "node:fs";
import path from "node:path";
import { parseArchiveLines } from "../core/archive";
import { backupMessages, dataFiles, isArchiveName, isBackupName, makeBackup, mergeFiles, parseSavedName, pruneSaved, replaceFiles, savedName, type BackupFiles, type BackupReason } from "../core/backup";
import { fileLimits } from "../core/fileLimits";
import type { Lang } from "../core/lang";
import { movedFileName, parseMoved, parseStorageFile, serializeMoved, serializeStorageFile, sharedFiles, storageFileName, type StorageMoved } from "../core/storage";
import { focusFileName, mergeFocus } from "../core/focus";
import { entryAt, isRefused, readBytesSafely, readChosenText, readTextIfSafe, readTextSafely, RefusedFile, temporaryPath, writeFileAtomically, writeNew } from "./safeFiles";

export { writeFileAtomically } from "./safeFiles";

/** The shared folder chosen in Settings, kept in storage.json beside settings.json; undefined means the default. */
export function readDataFolder(settingsDirectory: string): string | undefined {
  try {
    return parseStorageFile(readBytesSafely(path.join(settingsDirectory, storageFileName)).toString("utf8"));
  } catch {
    return undefined;
  }
}

export function writeDataFolder(settingsDirectory: string, folder: string | undefined): void {
  writeFileAtomically(path.join(settingsDirectory, storageFileName), serializeStorageFile(folder));
}

/** #195: the move's note for the restarted app (storage-moved.json beside settings.json). */
export function writeMoved(settingsDirectory: string, moved: StorageMoved): void {
  writeFileAtomically(path.join(settingsDirectory, movedFileName), serializeMoved(moved));
}

/** The move's note, once: read and removed (a broken or missing one says nothing). */
export function takeMoved(settingsDirectory: string): StorageMoved | undefined {
  const file = path.join(settingsDirectory, movedFileName);
  const text = readTextIfSafe(file, 4096);
  if (text === undefined) return undefined;
  try { fs.rmSync(file, { force: true }); } catch { /* said again next time at worst */ }
  return parseMoved(text);
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
 * finished-task record is merged month by month (lines another device already filed stay). A link (or a file past the
 * size limit) on either side is left alone (#173).
 */
export function copyData(source: string, target: string): void {
  fs.mkdirSync(target, { recursive: true });
  for (const file of sharedFiles) {
    const from = path.join(source, file);
    const to = path.join(target, file);
    let bytes: Buffer;
    try { bytes = readBytesSafely(from); } catch (error) {
      if (error instanceof RefusedFile || (error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (isRefused(to)) continue;
    writeFileAtomically(to, bytes);
  }
  mergeArchive(source, target);
}

/** A folder that is a real folder (not a link to one), or false. */
const isFolder = (folder: string): boolean => entryAt(folder)?.isDirectory() ?? false;

/**
 * Adds this device's finished-task record to `target`'s, month by month. Done whichever list is
 * kept: the record only ever grows, so nothing this device filed goes missing.
 */
export function mergeArchive(source: string, target: string): void {
  mergeFocusFile(source, target);
  const archive = path.join(source, "archive");
  if (!isFolder(archive)) return;
  const targetArchive = path.join(target, "archive");
  if (entryAt(targetArchive)?.isSymbolicLink()) return;
  fs.mkdirSync(targetArchive, { recursive: true });
  for (const name of fs.readdirSync(archive).filter((file) => file.endsWith(".jsonl"))) {
    const from = path.join(archive, name);
    const to = path.join(targetArchive, name);
    // #173: a link or an oversized month on either side is skipped, never read into the other folder or written through.
    const incoming = readTextIfSafe(from);
    if (incoming === undefined || isRefused(to)) continue;
    if (!entryAt(to)) {
      writeFileAtomically(to, incoming);
      continue;
    }
    const existing = fs.readFileSync(to, "utf8");
    const there = new Set(parseArchiveLines(existing).map((entry) => entry.id));
    const missing = parseArchiveLines(incoming).filter((entry) => !there.has(entry.id));
    if (missing.length === 0) continue;
    const lead = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    writeFileAtomically(to, existing + lead + missing.map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  }
}

/** 집중 기록 (focus.jsonl) goes along the same way: the sessions `target` lacks are added by id. */
export function mergeFocusFile(source: string, target: string): void {
  const mine = readTextIfSafe(path.join(source, focusFileName));
  if (mine === undefined) return;
  const to = path.join(target, focusFileName);
  if (isRefused(to)) return;
  const there = readTextIfSafe(to) ?? "";
  const merged = mergeFocus(there, mine);
  if (merged !== there) writeFileAtomically(to, merged);
}

// ─── 백업 · 옮기기 ────────────────────────────────────────────────────────────

/**
 * The data files the storage folder has now, as they are (todos, memos, repeats, events, alarms, the record's months, the
 * focus record). #173: a link, or a file past the size limit, is skipped — its name goes to `skipped` when given.
 */
export function readDataFiles(folder: string, skipped?: string[]): BackupFiles {
  const files: BackupFiles = {};
  const read = (name: string) => {
    try { files[name] = readBytesSafely(path.join(folder, ...name.split("/"))).toString("utf8"); } catch (error) {
      if (error instanceof RefusedFile) skipped?.push(name);
      /* else not there, or gone meanwhile */
    }
  };
  for (const name of [...dataFiles, focusFileName]) read(name);
  let months: string[] = [];
  if (isFolder(path.join(folder, "archive"))) {
    try { months = fs.readdirSync(path.join(folder, "archive")); } catch { /* no record yet */ }
  }
  for (const month of months.sort()) {
    const name = `archive/${month}`;
    if (isArchiveName(name)) read(name);
  }
  return files;
}

/**
 * Makes the folder hold exactly `next` (as far as data files go), starting from `current`. Every
 * changed file is first written in full beside its target; only when all of them are written are
 * they renamed into place, and the record's months that `next` lacks removed. A failed write
 * leaves the folder as it was. #173: each temporary file has a random name and is made new; a target that is a link or
 * past the size limit (left out of `current` by readDataFiles) is left as it is.
 */
export function writeDataFiles(folder: string, current: BackupFiles, next: BackupFiles): void {
  const changed = Object.keys(next).filter((name) => isBackupName(name) && next[name] !== current[name]);
  const staged: { temporary: string; target: string }[] = [];
  try {
    for (const name of changed) {
      const target = path.join(folder, ...name.split("/"));
      if (isRefused(target)) continue;
      const temporary = temporaryPath(target, "import-tmp");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      try { writeNew(temporary, next[name]); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") fs.rmSync(temporary, { force: true });
        throw error;
      }
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

/**
 * A .jongi's text for 가져오기 (`chosen`: the file the person picked, a link of theirs followed) or 되돌리기 (a copy in the
 * backup folder: no link). Past fileLimits.backupBytes (64MB) it is not read: RefusedFile (#173, review L-05).
 */
export function readBackupText(file: string, chosen = false): string {
  return chosen ? readChosenText(file, fileLimits.backupBytes) : readTextSafely(file, fileLimits.backupBytes);
}

/** The words for a refused .jongi (too big; a link in the backup folder is not a backup), or undefined for other errors. */
export function backupRefusal(error: unknown, lang: Lang): string | undefined {
  if (!(error instanceof RefusedFile)) return undefined;
  return error.why === "tooLarge" ? backupMessages[lang].tooLarge : backupMessages[lang].notBackup;
}

/**
 * A copy in `folder` (backups/ on this device): 가져오기-전-…, 폴더-바꾸기-전-… (#137) — then the oldest of that kind
 * past what it keeps (pruneSaved: ten of each ‘before’ kind) removed. Returns the file.
 */
export function saveCopy(folder: string, reason: BackupReason, contents: string, now: Date): string {
  const file = path.join(folder, savedName(reason, now));
  writeFileAtomically(file, contents);
  for (const name of pruneSaved(fs.readdirSync(folder))) {
    if (parseSavedName(name)?.reason === reason) fs.rmSync(path.join(folder, name), { force: true });
  }
  return file;
}

/** Before an import: the folder as it is now, in `backups/` on this device (the ten newest are kept). Returns the file. */
export function saveBeforeImport(settingsDirectory: string, contents: string, now: Date): string {
  return saveCopy(backupsFolder(settingsDirectory), "beforeImport", contents, now);
}

/**
 * Moving the list to `target` (저장 위치), without the questions. `copy`: this device's list goes over whatever `target`
 * holds — and what it holds goes to `backups` first (폴더-바꾸기-전-…, the same place and format as before an import,
 * #137); a failed backup stops the move. Otherwise only the record is merged.
 */
export function moveData(source: string, target: string, copy: boolean, backups: string, from: string, now: Date): void {
  if (copy) {
    const overwritten = readDataFiles(target);
    if (Object.keys(overwritten).length > 0) saveCopy(backups, "beforeFolderSwitch", makeBackup(overwritten, from, now, "beforeFolderSwitch"), now);
    copyData(source, target);
  } else {
    mergeArchive(source, target);
  }
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
 * 가져오기 (or 되돌리기, #140) into the storage folder, after the backup was read and checked (parseBackup): the folder
 * as it is now goes to `backups` first (가져오기-전-… / 되돌리기-전-…; a failure there stops everything), then 합치기
 * (`merge`) or 바꾸기 (`replace`) is written. Returns what the folder now holds and where the copy went.
 */
export function importInto(dataDirectory: string, backups: string, imported: BackupFiles, mode: "merge" | "replace", from: string, now: Date,
  reason: "beforeImport" | "beforeRestore" = "beforeImport"): { files: BackupFiles; saved: string } {
  const current = readDataFiles(dataDirectory);
  const saved = saveCopy(backups, reason, makeBackup(current, from, now, reason), now);
  const next = mode === "replace" ? replaceFiles(current, imported) : mergeFiles(current, imported);
  writeDataFiles(dataDirectory, current, next);
  return { files: next, saved };
}
