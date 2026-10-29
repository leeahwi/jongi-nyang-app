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
import { parseNotebook, serializeNotebook, type TodoItem } from "../../src/core/notebook";
import { takeLock } from "../../src/main/aiLock";

/**
 * Where the extension finds things and how it writes them. The settings folder (ai-link.json, ai-log.jsonl)
 * is the app's own on this device; the data folder is whatever ai-link.json names (the default folder or a
 * shared one, M16). Every write takes the lock, reads the file, changes it, reads it again just before the
 * swap and starts over on the new text when it changed meanwhile (at most three times), then writes a
 * temporary file beside it and renames it over — the same files, byte for byte, the apps write.
 */

/** The settings folder: PAPERTODO_AI_HOME (tests), else the app's folder on this system. */
export function settingsHome(): string {
  const forced = process.env.PAPERTODO_AI_HOME;
  if (forced) return forced;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "com.noa.PaperTodo");
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "PaperTodo");
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "PaperTodo");
}

/** ai-link.json as it is now (read on every call, so turning it off applies at once), or undefined. */
export function readLink(home: string): AiLink | undefined {
  try { return parseAiLink(fs.readFileSync(path.join(home, aiLinkFileName), "utf8")); } catch { return undefined; }
}

/** The system's language, for the "turn it on" words when there is no ai-link.json to say. */
export function systemLang(): Lang {
  const locale = (() => { try { return Intl.DateTimeFormat().resolvedOptions().locale; } catch { return ""; } })();
  return resolveLang(undefined, [process.env.LANG ?? "", locale].filter(Boolean));
}

/** The time now; PAPERTODO_AI_CLOCK names a file with an ISO time instead (tests: 02:30, ten minutes later). */
export function clock(): Date {
  const file = process.env.PAPERTODO_AI_CLOCK;
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

type Kinds = { "todos.json": TodoItem[]; "events.json": LocalEvent[]; "memos.json": Memo[] };
export type DataFile = keyof Kinds;

const formats: { [K in DataFile]: { parse: (text: string) => Kinds[K]; serialize: (value: Kinds[K]) => string } } = {
  "todos.json": { parse: (text) => parseNotebook(text).items, serialize: (items) => serializeNotebook({ items }) },
  "events.json": { parse: parseEvents, serialize: serializeEvents },
  "memos.json": { parse: parseMemos, serialize: serializeMemos },
};

const readText = (file: string): string | undefined => {
  try { return fs.readFileSync(file, "utf8"); } catch { return undefined; }
};

export class Folder {
  constructor(readonly home: string, readonly data: string) {}

  private at(name: string): string { return path.join(this.data, name); }

  /** A data file's list (none yet: empty); throws Unreadable when it is there but broken. */
  load<K extends DataFile>(name: K): Kinds[K] {
    const text = readText(this.at(name));
    if (text === undefined) return [] as unknown as Kinds[K];
    try { return formats[name].parse(text); } catch { throw new Unreadable(name); }
  }

  /** alarms.json; an unreadable one reads as none (alarms are only shown). */
  alarms(): Alarm[] {
    const text = readText(this.at("alarms.json"));
    try { return text === undefined ? [] : parseAlarms(text); } catch { return []; }
  }

  focus(): FocusRecord[] { return parseFocus(readText(this.at(focusFileName)) ?? ""); }

  /** Every line of archive/*.jsonl, oldest month first. */
  archive(): ArchiveEntry[] {
    const directory = this.at("archive");
    let names: string[] = [];
    try { names = fs.readdirSync(directory).filter((name) => name.endsWith(".jsonl")).sort(); } catch { return []; }
    return names.flatMap((name) => parseArchiveLines(readText(path.join(directory, name)) ?? ""));
  }

  /**
   * Changes one data file: `change` gets the list as it is on disk and changes it in place, returning its
   * result and whether anything changed. It may run up to three times (on the newer text each time), so it
   * must work from the list it is given.
   */
  update<K extends DataFile, R>(name: K, change: (list: Kinds[K]) => { changed: boolean; result: R }): R {
    const file = this.at(name);
    const release = takeLock(path.join(this.home, aiLockFileName));
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const first = readText(file);
        let list: Kinds[K];
        try { list = first === undefined ? [] as unknown as Kinds[K] : formats[name].parse(first); } catch { throw new Unreadable(name); }
        const { changed, result } = change(list);
        if (!changed) return result;
        const text = formats[name].serialize(list);
        raceForTests(file);
        const temporary = `${file}.ai-${process.pid}.tmp`;
        fs.writeFileSync(temporary, text, "utf8");
        // Someone wrote in the meantime (a sync, the app without the lock): do it again on their text.
        if (readText(file) !== first) { try { fs.unlinkSync(temporary); } catch { /* gone */ } continue; }
        fs.renameSync(temporary, file);
        return result;
      }
      throw new Busy(name);
    } finally {
      release?.();
    }
  }

  /** One line onto ai-log.jsonl in the settings folder, in a single write. */
  log(entry: AiLogEntry): void {
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
    fs.appendFileSync(file, `${lead}${aiLogLine(entry)}\n`, "utf8");
  }
}

/**
 * Tests only (PAPERTODO_AI_RACE names a prepared todos.json): once, between reading and writing, that file
 * is moved over the data file — another writer coming in at the worst moment (M9).
 */
function raceForTests(file: string): void {
  const race = process.env.PAPERTODO_AI_RACE;
  if (!race || path.basename(race) !== `${path.basename(file)}.race`) return;
  try { fs.renameSync(race, file); } catch { /* used already */ }
}
