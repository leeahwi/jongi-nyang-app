import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { aiLinkFileName, aiLockFileName, aiLogFileName, aiLogLine, parseAiLink, type AiLink, type AiLogEntry } from "../../src/core/ai";
import { parseArchiveLines, type ArchiveEntry } from "../../src/core/archive";
import { parseAlarms, type Alarm } from "../../src/core/alarm";
import { parseEvents, serializeEvents, type LocalEvent } from "../../src/core/events";
import { parseFocus, focusFileName, type FocusRecord } from "../../src/core/focus";
import { resolveLang, type Lang } from "../../src/core/lang";
import { parseMemos, serializeMemos, type Memo } from "../../src/core/memo";
import { emptyMemoFolders, parseMemoFolders, serializeMemoFolders, type MemoFolders } from "../../src/core/memoDrawer";
import { parseNotebook, serializeNotebook, type TodoItem } from "../../src/core/notebook";
import { parseSeries, serializeSeries, type Series } from "../../src/core/repeat";
import { takeLock } from "../../src/main/aiLock";
import { appendSafely, entryAt, readBytesSafely, readTextIfSafe, RefusedFile, temporaryPath, writeNew } from "../../src/main/safeFiles";

/**
 * Where the extension finds things and how it writes them. The settings folder (ai-link.json, ai-log.jsonl)
 * is the app's own on this device; the data folder is whatever ai-link.json names (the default folder or a
 * shared one, M16). Every write takes the lock, reads the files, changes them, reads each again just before
 * its swap and starts over on the new text when it changed meanwhile (at most three times), then writes a
 * temporary file beside it and renames it over — the same files, byte for byte, the apps write. Changes to
 * several files go in all together or not at all (#110). Errors keep the file's name and the system's code
 * only, never a path (#109).
 */

/**
 * #174 (review L-07): the tests' switches (PAPERTODO_AI_HOME · _CLOCK · _RACE · _BREAK) exist only in the test build
 * (mcp/dist/server-test, `__TEST_HOOKS__` true). The server that ships (mcp/dist/server, in the .mcpb and both apps)
 * has none: an environment variable can't point it at another folder or bend its writes.
 */
declare const __TEST_HOOKS__: boolean;

/** The settings folder: PAPERTODO_AI_HOME (tests), else the app's folder on this system. */
export function settingsHome(): string {
  const forced = __TEST_HOOKS__ ? process.env.PAPERTODO_AI_HOME : undefined;
  if (forced) return forced;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "com.noa.PaperTodo");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "PaperTodo");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "PaperTodo");
}

/** ai-link.json as it is now (read on every call, so turning it off applies at once), or undefined. */
export function readLink(home: string): AiLink | undefined {
  try { return parseAiLink(readBytesSafely(path.join(home, aiLinkFileName)).toString("utf8")); } catch { return undefined; }
}

/** The system's language, for the "turn it on" words when there is no ai-link.json to say. */
export function systemLang(): Lang {
  const locale = (() => { try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return ""; } })();
  return resolveLang(undefined, [process.env.LANG ?? "", locale].filter(Boolean));
}

/** The time now; PAPERTODO_AI_CLOCK names a file with an ISO time instead (tests: 02:30, ten minutes later). */
export function clock(): Date {
  const file = __TEST_HOOKS__ ? process.env.PAPERTODO_AI_CLOCK : undefined;
  if (file) {
    try {
      const at = new Date(fs.readFileSync(file, "utf8").trim());
      if (!Number.isNaN(at.getTime())) return at;
    } catch { /* no clock file: the real time */ }
  }
  return new Date();
}

/** A data file that is there but doesn't read: nothing is written over it (M17). */
export class Unreadable extends Error {
  constructor(readonly file: string) { super(`${file} unreadable`); }
}
/** A file that kept changing under three tries. */
export class Busy extends Error {
  constructor(readonly file: string) { super(`${file} busy`); }
}
/**
 * The system refused a data file (a folder in its place, no permission, a full disk…). It keeps only the
 * file's own name and the system's code (EISDIR, EACCES…), never the system's text: that names the whole
 * path and so the user's name (#109). `rolledBack` is false only when a write stopped halfway and a file
 * already swapped in couldn't be put back.
 */
export class FileFailed extends Error {
  constructor(readonly file: string, readonly errno: string, readonly rolledBack = true) { super(`${file} ${errno}`); }
}

/** The system's code of an error ("EISDIR"), or "" when it isn't one of the system's. */
export const errnoOf = (error: unknown): string => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === "string" && /^E[A-Z0-9]+$/.test(code) ? code : "";
};

/** Runs `work`; a system error on the way comes out as FileFailed for `file` (no path in it). */
function guarded<T>(file: string, work: () => T): T {
  try { return work(); } catch (error) {
    const errno = errnoOf(error);
    if (errno) throw new FileFailed(file, errno);
    throw error;
  }
}

type Kinds = {
  "todos.json": TodoItem[]; "events.json": LocalEvent[]; "memos.json": Memo[];
  /** 메모 서랍: folders and each memo's place (written only when a memo goes into a folder, N2). */
  "memo-folders.json": MemoFolders;
  /** Repeating tasks: only read (N1). */
  "repeats.json": Series[];
};
export type DataFile = keyof Kinds;
/** The lists updateAll hands over, by file. */
export type Lists = { [K in DataFile]?: Kinds[K] };

/** Each file's text ↔ value, the same bytes the apps write; `empty` is a file not there yet. */
const formats: { [K in DataFile]: { empty: (lang: Lang) => Kinds[K]; parse: (text: string, lang: Lang) => Kinds[K]; serialize: (value: Kinds[K]) => string } } = {
  "todos.json": { empty: () => [], parse: (text) => parseNotebook(text).items, serialize: (items) => serializeNotebook({ items }) },
  "events.json": { empty: () => [], parse: parseEvents, serialize: serializeEvents },
  "memos.json": { empty: () => [], parse: parseMemos, serialize: serializeMemos },
  "memo-folders.json": { empty: (lang) => emptyMemoFolders(lang), parse: (text, lang) => parseMemoFolders(text, lang), serialize: serializeMemoFolders },
  "repeats.json": { empty: () => [], parse: parseSeries, serialize: (series) => serializeSeries(series) },
};

/**
 * A data file's bytes, undefined when there is none yet. Anything else (a folder in its place, no
 * permission) throws: read as "none" it would be written over with a list missing everything. #173: a link, or a
 * file past the size limit (32MB), throws RefusedFile — never read, never written over (FILE_IS_LINK · FILE_TOO_LARGE).
 */
const readBytes = (file: string): Buffer | undefined => {
  try { return readBytesSafely(file); } catch (error) {
    if (errnoOf(error) === "ENOENT") return undefined;
    throw error;
  }
};
const sameBytes = (a: Buffer | undefined, b: Buffer | undefined): boolean => (a === undefined || b === undefined ? a === b : a.equals(b));

/** For what is only shown (alarms, focus, the record): anything that doesn't read reads as nothing. */
const readLoose = (file: string): string | undefined => readTextIfSafe(file);

/** Puts `bytes` back as `file` through a temporary file beside it (undefined: there was no file). */
function putBack(file: string, bytes: Buffer | undefined): void {
  if (bytes === undefined) {
    try { fs.unlinkSync(file); } catch (error) { if (errnoOf(error) !== "ENOENT") throw error; }
    return;
  }
  const temporary = temporaryPath(file, "ai-undo.tmp");
  writeNew(temporary, bytes);
  fs.renameSync(temporary, file);
}

export class Folder {
  /** `lang` names the 메모 inbox when memo-folders.json lacks it (as the apps do). */
  constructor(readonly home: string, readonly data: string, readonly lang: Lang = "ko") {}

  private at(name: string): string { return path.join(this.data, name); }

  /** A data file's list (none yet: empty); throws Unreadable when it is there but broken, FileFailed when the system refuses it. */
  load<K extends DataFile>(name: K): Kinds[K] {
    const bytes = guarded(name, () => readBytes(this.at(name)));
    if (bytes === undefined) return formats[name].empty(this.lang);
    try { return formats[name].parse(bytes.toString("utf8"), this.lang); } catch { throw new Unreadable(name); }
  }

  /**
   * For what is only shown beside another file (memo folders beside the memos, a task's repeat): one that
   * doesn't read reads as none — every memo in 메모, no repeats — rather than hiding the list.
   */
  loadLoose<K extends DataFile>(name: K): Kinds[K] {
    try { return this.load(name); } catch { return formats[name].empty(this.lang); }
  }

  /** The archive files whose month can hold a day from..to (a month either side, for the 4 a.m. day); every file without one. */
  archiveMonths(from?: string, to?: string): (name: string) => boolean {
    if (!from || !to) return () => true;
    const month = (day: string, step: number) => { const [y, m] = day.split("-").map(Number); const date = new Date(y, m - 1 + step, 1); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`; };
    const [first, last] = [month(from, -1), month(to, 1)];
    return (name) => { const key = /^(\d{4}-\d{2})\.jsonl$/.exec(name)?.[1]; return !key || (key >= first && key <= last); };
  }

  /** alarms.json; an unreadable one reads as none (alarms are only shown). */
  alarms(): Alarm[] {
    const text = readLoose(this.at("alarms.json"));
    try { return text === undefined ? [] : parseAlarms(text); } catch { return []; }
  }

  focus(): FocusRecord[] { return parseFocus(readLoose(this.at(focusFileName)) ?? ""); }

  /** Every line of archive/*.jsonl, oldest month first (only the months `wanted` keeps). */
  archive(wanted: (name: string) => boolean = () => true): ArchiveEntry[] {
    const directory = this.at("archive");
    let names: string[] = [];
    if (!entryAt(directory)?.isDirectory()) return [];
    try { names = fs.readdirSync(directory).filter((name) => name.endsWith(".jsonl") && wanted(name)).sort(); } catch { return []; }
    return names.flatMap((name) => parseArchiveLines(readLoose(path.join(directory, name)) ?? ""));
  }

  /**
   * Changes one data file: `change` gets the list as it is on disk and changes it in place, returning its
   * result and whether anything changed. It may run up to three times (on the newer text each time), so it
   * must work from the list it is given.
   */
  update<K extends DataFile, R>(name: K, change: (list: Kinds[K]) => { changed: boolean; result: R }): R {
    return this.updateAll([name], (lists) => change(lists[name] as Kinds[K]));
  }

  /**
   * Changes several data files all or nothing (#110), under one hold of the lock: every file is read, and
   * `change` checks and changes all the lists at once (throwing leaves every file as it was). Each new text
   * goes to a temporary file; then every file is read again, and only when none changed meanwhile are they
   * swapped in one after another, each one after the first read once more just before its swap. If one
   * changed meanwhile (a sync, the app without the lock), the files already in get their previous bytes
   * back and it all starts over on the newer texts (at most three times, so `change` must work from the
   * lists it is given). If a swap fails, the files already in get their previous bytes back too and
   * FileFailed goes on (WRITE_HALF_DONE only if putting one back fails as well).
   */
  updateAll<R>(names: DataFile[], change: (lists: Lists) => { changed: boolean; result: R }): R {
    const release = takeLock(path.join(this.home, aiLockFileName));
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const firsts = names.map((name) => guarded(name, () => readBytes(this.at(name))));
        const lists: Record<string, unknown> = {};
        names.forEach((name, index) => {
          const bytes = firsts[index];
          try { lists[name] = bytes === undefined ? formats[name].empty(this.lang) : formats[name].parse(bytes.toString("utf8"), this.lang); } catch { throw new Unreadable(name); }
        });
        const { changed, result } = change(lists as Lists);
        if (!changed) return result;
        const texts = names.map((name) => (formats[name].serialize as (value: unknown) => string)(lists[name]));
        for (const name of names) raceForTests(this.at(name));
        if (this.swap(names, firsts, texts)) return result;
      }
      throw new Busy(names[names.length - 1]);
    } finally {
      release?.();
    }
  }

  /** updateAll's writing: true when every file is in, false when one changed meanwhile (nothing left changed). */
  private swap(names: DataFile[], firsts: (Buffer | undefined)[], texts: string[]): boolean {
    const files = names.map((name) => this.at(name));
    // #173: random names, each made new (never an existing file or a link someone put there).
    const temporaries = files.map((file) => temporaryPath(file, "ai.tmp"));
    let made = 0;
    const written: Buffer[] = [];
    let done = 0;
    let current = 0;
    const tidy = () => { for (const temporary of temporaries.slice(0, made)) try { fs.unlinkSync(temporary); } catch { /* gone */ } };
    /** The files already swapped in get their previous bytes back (only while they still hold ours). */
    const undo = (): boolean => {
      let all = true;
      for (let index = done - 1; index >= 0; index -= 1) {
        try { if (sameBytes(readBytes(files[index]), written[index])) putBack(files[index], firsts[index]); } catch { all = false; }
      }
      done = 0;
      return all;
    };
    const unchanged = (index: number) => sameBytes(readBytes(files[index]), firsts[index]);
    try {
      for (let index = 0; index < files.length; index += 1) {
        current = index;
        written[index] = Buffer.from(texts[index], "utf8");
        try { writeNew(temporaries[index], written[index]); } catch (error) {
          if (errnoOf(error) !== "EEXIST") made = index + 1; // half written: ours to remove
          throw error;
        }
        made = index + 1;
      }
      // Last to first, so the first file's check comes right before its swap (one file: one read, as ever).
      for (let index = files.length - 1; index >= 0; index -= 1) {
        current = index;
        if (!unchanged(index)) { tidy(); return false; }
      }
      for (let index = 0; index < files.length; index += 1) {
        current = index;
        if (index > 0) breakForTests(names[index], temporaries[index]);
        // Someone wrote in the meantime after all: put back what is in and do it again on their text.
        if (index > 0 && !unchanged(index)) {
          const back = undo();
          tidy();
          if (!back) throw new FileFailed(names[index], "ECHANGED", false);
          return false;
        }
        fs.renameSync(temporaries[index], files[index]);
        done = index + 1;
      }
      return true;
    } catch (error) {
      if (error instanceof FileFailed) throw error;
      const back = undo();
      tidy();
      if (error instanceof RefusedFile && back) throw error;
      throw new FileFailed(names[current], errnoOf(error) || "EIO", back);
    }
  }

  /**
   * One line onto ai-log.jsonl in the settings folder, in a single write. The change it tells of is already
   * made, so a log that can't be written neither undoes it nor turns it into an error: only the system's code
   * goes to stderr (no path), and false comes back.
   */
  log(entry: AiLogEntry): boolean {
    const file = path.join(this.home, aiLogFileName);
    let lead = "";
    try {
      const size = fs.statSync(file).size;
      if (size > 0) {
        const handle = fs.openSync(file, "r");
        const last = Buffer.alloc(1);
        fs.readSync(handle, last, 0, 1, size - 1);
        fs.closeSync(handle);
        if (last.toString() !== "\n") lead = "\n"; // a torn last line keeps to itself
      }
    } catch { /* no log yet */ }
    try {
      appendSafely(file, `${lead}${aiLogLine(entry)}\n`);
      return true;
    } catch (error) {
      process.stderr.write(`jongi-nyang: ${aiLogFileName} not written (${errnoOf(error) || "error"})\n`);
      return false;
    }
  }
}

/**
 * Tests only (PAPERTODO_AI_RACE names a prepared todos.json.race or events.json.race): once, between reading
 * and writing, that file is moved over the data file — another writer coming in at the worst moment (M9 · M33).
 */
function raceForTests(file: string): void {
  const race = __TEST_HOOKS__ ? process.env.PAPERTODO_AI_RACE : undefined;
  if (!race || path.basename(race) !== `${path.basename(file)}.race`) return;
  try { fs.renameSync(race, file); } catch { /* used already */ }
}

/**
 * Tests only (PAPERTODO_AI_BREAK names a data file, "events.json"): when that file's turn to be swapped in
 * comes after another one is already in, its temporary file is taken away, so the swap fails halfway (M33).
 */
function breakForTests(name: string, temporary: string): void {
  if (!__TEST_HOOKS__ || process.env.PAPERTODO_AI_BREAK !== name) return;
  try { fs.unlinkSync(temporary); } catch { /* gone */ }
}
