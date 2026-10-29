import { parseAlarms } from "./alarm";
import { parseEvents } from "./events";
import { parseMemos } from "./memo";
import { emptyMemoFolders, mergeMemoFolders, parseMemoFolders, serializeMemoFolders } from "./memoDrawer";
import { isoDate, parseNotebook } from "./notebook";
import { parseSeries } from "./repeat";
import { emptyTodoSpaces, mergeTodoSpaces, parseTodoSpaces, serializeTodoSpaces } from "./todoSpaces";
import { clock, dayMonth, langIndex, plural, type Lang } from "./lang";
import { focusFileName } from "./focus";

/**
 * 백업 · 옮기기: everything in the storage folder in one file, to move it to another computer (Mac
 * or Windows). A `.jongi` file is JSON:
 *
 *   { "format": "jongi-nyang-backup", "version": 1, "exportedAt": ISO, "from": "Windows 1.16.0",
 *     "files": { "todos.json": "<the file as it is>", "memos.json": …, "archive/2026-10.jsonl": …, "focus.jsonl": … } }
 *
 * Each file travels as its exact text; settings don't travel (they belong to each device). The same
 * rules and test cases as the macOS app (PaperCore Backup.swift).
 */

export const backupFormat = "jongi-nyang-backup";
export const backupVersion = 1;
export const backupExtension = "jongi";

/** The storage folder's files, by their path inside it ("todos.json", "archive/2026-10.jsonl"). */
export type BackupFiles = Record<string, string>;

export interface Backup { exportedAt?: string; from?: string; files: BackupFiles }

/** The data files (메모 서랍's folders since 1.28, 할 일 스페이스 since 1.30); the record is archive/<month>.jsonl beside them, and the focus record focus.jsonl. */
export const dataFiles = ["todos.json", "memos.json", "repeats.json", "events.json", "alarms.json", "memo-folders.json", "todo-spaces.json"] as const;
export type DataFile = typeof dataFiles[number];
/** A month of the record ("2026-10", "undated"): nothing that could reach outside the archive folder. */
export const isArchiveName = (name: string) => /^archive\/[0-9A-Za-z_-]+\.jsonl$/.test(name);
/** 집중 기록 (stage 4): one line per session, merged by id like the record's months. */
export const isFocusName = (name: string) => name === focusFileName;
/** Files of lines (the record's months and the focus record): read tolerantly, merged line by line. */
const isLinesName = (name: string) => isArchiveName(name) || isFocusName(name);
export const isBackupName = (name: string) => (dataFiles as readonly string[]).includes(name) || isLinesName(name);

export const notBackup = "종이냥 백업 파일이 아니에요.";
export const tooNew = "더 새 버전의 종이냥에서 만든 파일이에요. 종이냥을 업데이트해 주세요.";
export const unreadable = (name: string) => `백업 파일 안의 ‘${name}’을 읽지 못했어요.`;

/** The three refusals in a language (the same as the macOS Backup.Problem messages). */
export const backupMessages: Record<Lang, { notBackup: string; tooNew: string; unreadable: (name: string) => string }> = {
  ko: { notBackup, tooNew, unreadable },
  en: {
    notBackup: "This isn’t a Jongi-nyang backup file.",
    tooNew: "This file comes from a newer version of Jongi-nyang. Please update Jongi-nyang.",
    unreadable: (name) => `Couldn’t read ‘${name}’ in the backup file.`,
  },
  nl: {
    notBackup: "Dit is geen back-upbestand van Jongi-nyang.",
    tooNew: "Dit bestand komt uit een nieuwere versie van Jongi-nyang. Werk Jongi-nyang bij.",
    unreadable: (name) => `Kon ‘${name}’ in het back-upbestand niet lezen.`,
  },
};

/** "종이냥-백업-2026-10-08.jongi" — en "Jongi-nyang-backup-2026-10-08.jongi", nl "Jongi-nyang-back-up-2026-10-08.jongi". */
export function backupFileName(now: Date, lang: Lang = "ko"): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const name = ["종이냥-백업", "Jongi-nyang-backup", "Jongi-nyang-back-up"][langIndex(lang)];
  return `${name}-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.${backupExtension}`;
}

/** The automatic copy before an import: "가져오기-전-20261008-143005.jongi". */
export function preImportName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `가져오기-전-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.${backupExtension}`;
}

/** The backup file's text: only the files given (those the folder has), keys in order. */
export function makeBackup(files: BackupFiles, from: string, exportedAt: Date): string {
  const sorted: BackupFiles = {};
  for (const name of Object.keys(files).sort()) sorted[name] = files[name];
  return JSON.stringify({ format: backupFormat, version: backupVersion, exportedAt: isoDate(exportedAt), from, files: sorted }, null, 2) + "\n";
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** Whether the app could read this file as it is: each with its own parser, before anything is written. */
export function readable(name: string, text: string): boolean {
  if (isLinesName(name)) return true; // a torn line is skipped by the app, as it always has been
  try {
    const value = JSON.parse(text) as unknown;
    if (name === "todos.json") parseNotebook(text);
    else if (name === "memos.json") { if (!isObject(value) || !Array.isArray(value.memos)) return false; parseMemos(text); }
    else if (name === "repeats.json") { if (!isObject(value) || !Array.isArray(value.series)) return false; parseSeries(text); }
    else if (name === "events.json") parseEvents(text);
    else if (name === "alarms.json") parseAlarms(text);
    else if (name === "memo-folders.json") parseMemoFolders(text);
    else if (name === "todo-spaces.json") parseTodoSpaces(text);
    else return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * A backup file read and checked through: every file it carries must be readable, so a damaged
 * one is refused before anything changes here. Names this version doesn't know are left out.
 */
export function parseBackup(text: string, lang: Lang = "ko"): { backup: Backup } | { error: string } {
  const { notBackup, tooNew, unreadable } = backupMessages[lang];
  let value: unknown;
  try { value = JSON.parse(text); } catch { return { error: notBackup }; }
  if (!isObject(value) || value.format !== backupFormat || !isObject(value.files)) return { error: notBackup };
  if (typeof value.version !== "number" || !Number.isFinite(value.version) || value.version < 1) return { error: notBackup };
  if (value.version > backupVersion) return { error: tooNew };
  const files: BackupFiles = {};
  for (const [name, contents] of Object.entries(value.files)) {
    if (!isBackupName(name)) continue;
    if (typeof contents !== "string") return { error: notBackup };
    files[name] = contents;
  }
  for (const name of Object.keys(files).sort((a, b) => order(a) - order(b) || (a < b ? -1 : 1))) {
    if (!readable(name, files[name])) return { error: unreadable(name) };
  }
  return {
    backup: {
      ...(typeof value.exportedAt === "string" ? { exportedAt: value.exportedAt } : {}),
      ...(typeof value.from === "string" ? { from: value.from } : {}),
      files,
    },
  };
}

const order = (name: string) => { const index = (dataFiles as readonly string[]).indexOf(name); return index < 0 ? dataFiles.length : index; };

// ─── What is in it ────────────────────────────────────────────────────────────

export interface BackupSummary { todos: number; memos: number; repeats: number; events: number; alarms: number; archive: number; /** 집중 기록 lines (focus.jsonl). */ focus?: number }

function count(text: string | undefined, key: string): number {
  if (text === undefined) return 0;
  try {
    const value = JSON.parse(text) as unknown;
    return isObject(value) && Array.isArray(value[key]) ? (value[key] as unknown[]).length : 0;
  } catch {
    return 0;
  }
}

const lineCount = (text: string | undefined) => (text ?? "").split(/\r?\n/).filter((line) => line.trim()).length;

export function summary(files: BackupFiles): BackupSummary {
  return {
    todos: count(files["todos.json"], "items"),
    memos: count(files["memos.json"], "memos"),
    repeats: count(files["repeats.json"], "series"),
    events: count(files["events.json"], "events"),
    alarms: count(files["alarms.json"], "alarms"),
    archive: Object.keys(files).filter(isArchiveName).reduce((total, name) => total + lineCount(files[name]), 0),
    focus: lineCount(files[focusFileName]),
  };
}

const summaryNouns: Record<"en" | "nl", [string, string][]> = {
  en: [["to-do", "to-dos"], ["note", "notes"], ["repeating to-do", "repeating to-dos"], ["event", "events"], ["alarm", "alarms"], ["in history", "in history"], ["focus session", "focus sessions"]],
  nl: [["taak", "taken"], ["notitie", "notities"], ["herhalende taak", "herhalende taken"], ["afspraak", "afspraken"], ["wekker", "wekkers"], ["in geschiedenis", "in geschiedenis"], ["focussessie", "focussessies"]],
};

/**
 * "할 일 12 · 메모 3 · 반복 2 · 일정 8 · 알람 2 · 완료 기록 140 · 집중 기록 18" (nothing for 0), or "비어 있는 백업이에요." —
 * en "12 to-dos · 3 notes · 2 repeating to-dos · 8 events · 2 alarms · 140 in history · 18 focus sessions" ("This backup is empty.");
 * nl "12 taken · 3 notities · 2 herhalende taken · 8 afspraken · 2 wekkers · 140 in geschiedenis · 18 focussessies" ("Deze back-up is leeg.").
 */
export function summaryText(counts: BackupSummary, lang: Lang = "ko"): string {
  const values = [counts.todos, counts.memos, counts.repeats, counts.events, counts.alarms, counts.archive, counts.focus ?? 0];
  const parts = lang === "ko"
    ? values.map((value, index) => [value, `${["할 일", "메모", "반복", "일정", "알람", "완료 기록", "집중 기록"][index]} ${value}`] as const)
    : values.map((value, index) => [value, plural(value, ...summaryNouns[lang][index])] as const);
  const shown = parts.filter(([value]) => value > 0).map(([, text]) => text);
  return shown.length > 0 ? shown.join(" · ") : ["비어 있는 백업이에요.", "This backup is empty.", "Deze back-up is leeg."][langIndex(lang)];
}

/** "10월 8일 14:30" (local) for the confirmation — en "Oct 8, 2:30 PM", nl "8 okt 14:30" — or undefined when the time can't be read. */
export function exportedText(exportedAt: string | undefined, lang: Lang = "ko"): string | undefined {
  const time = exportedAt ? Date.parse(exportedAt) : NaN;
  if (Number.isNaN(time)) return undefined;
  const date = new Date(time);
  const day = dayMonth(date.getMonth() + 1, date.getDate(), undefined, lang);
  return `${day}${lang === "en" ? ", " : " "}${clock(date.getHours(), date.getMinutes(), lang)}`;
}

// ─── 합치기 · 바꾸기 ──────────────────────────────────────────────────────────

type ListFile = Exclude<DataFile, "memo-folders.json" | "todo-spaces.json">;
const arrayKey: Record<ListFile, string> = { "todos.json": "items", "memos.json": "memos", "repeats.json": "series", "events.json": "events", "alarms.json": "alarms" };

/** Entries of both by id: every one here as it is, then the imported ones this side lacks (in their order). */
function mergeList(current: string, imported: string, key: string): string {
  const here = JSON.parse(current) as Json;
  const there = JSON.parse(imported) as Json;
  const mine = Array.isArray(here[key]) ? here[key] as unknown[] : [];
  const theirs = Array.isArray(there[key]) ? there[key] as unknown[] : [];
  const ids = new Set(mine.map((entry) => (isObject(entry) ? entry.id : undefined)).filter((id) => typeof id === "string"));
  const added = theirs.filter((entry) => {
    const id = isObject(entry) ? entry.id : undefined;
    if (typeof id !== "string" || ids.has(id)) return false;
    ids.add(id);
    return true;
  });
  if (added.length === 0) return current;
  return JSON.stringify({ ...here, [key]: [...mine, ...added] }, null, 2) + "\n";
}

/** Lines of one month by id (a line without one by its whole text): those here first, then the new ones. */
function mergeLines(current: string, imported: string): string {
  const lines = current.split(/\r?\n/).filter((line) => line.trim());
  const idOf = (line: string): string | undefined => {
    try { const value = JSON.parse(line) as unknown; return isObject(value) && typeof value.id === "string" ? value.id : undefined; } catch { return undefined; }
  };
  const ids = new Set(lines.map(idOf).filter((id): id is string => id !== undefined));
  const texts = new Set(lines.map((line) => line.trim()));
  const added: string[] = [];
  for (const line of imported.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const id = idOf(line);
    if (id !== undefined ? ids.has(id) : texts.has(line.trim())) continue;
    if (id !== undefined) ids.add(id); else texts.add(line.trim());
    added.push(line);
  }
  if (added.length === 0) return current;
  return [...lines, ...added].join("\n") + "\n";
}

/**
 * 합치기: everything here stays as it is; what the backup has and this side doesn't is added.
 * Values are copied as they are (nothing reformatted); a kind only one side has is taken whole.
 */
export function mergeFiles(current: BackupFiles, imported: BackupFiles): BackupFiles {
  const result: BackupFiles = { ...current };
  for (const [name, text] of Object.entries(imported)) {
    const mine = current[name];
    if (mine === undefined) result[name] = text;
    else if (isLinesName(name)) result[name] = mergeLines(mine, text);
    else if (name === "memo-folders.json") {
      // 메모 서랍's folders: merged entry by entry (D13, D14), this side's on a tie; this side's unreadable: the backup's.
      try {
        const merged = serializeMemoFolders(mergeMemoFolders(parseMemoFolders(mine), parseMemoFolders(text)));
        result[name] = merged === serializeMemoFolders(parseMemoFolders(mine)) ? mine : merged;
      } catch { result[name] = text; }
    } else if (name === "todo-spaces.json") {
      // 할 일 스페이스: entry by entry (S18), the backup's winning only where newer; this side's unreadable: the backup's.
      try {
        const kept = parseTodoSpaces(mine);
        const merged = serializeTodoSpaces(mergeTodoSpaces(kept, parseTodoSpaces(text)));
        result[name] = merged === serializeTodoSpaces(kept) ? mine : merged;
      } catch { result[name] = text; }
    } else if ((dataFiles as readonly string[]).includes(name)) {
      // This side's file can't be read (the app has already kept it aside): the backup's is taken.
      try { result[name] = mergeList(mine, text, arrayKey[name as ListFile]); } catch { result[name] = text; }
    }
  }
  return result;
}

/** What an empty file of each kind holds (바꾸기 with a backup that lacks it). */
export const emptyFile: Record<DataFile, string> = {
  "todos.json": JSON.stringify({ items: [] }, null, 2) + "\n",
  "memos.json": JSON.stringify({ memos: [] }, null, 2) + "\n",
  "repeats.json": JSON.stringify({ series: [] }, null, 2),
  "events.json": JSON.stringify({ events: [] }, null, 2) + "\n",
  "alarms.json": JSON.stringify({ alarms: [] }, null, 2) + "\n",
  "memo-folders.json": serializeMemoFolders(emptyMemoFolders("ko")),
  "todo-spaces.json": serializeTodoSpaces(emptyTodoSpaces()),
};

/**
 * 바꾸기: the folder becomes the backup. A kind the backup lacks is emptied (when this side has
 * it); this side's months of the record go, and only the backup's stay; the focus record is the
 * backup's (emptied when the backup has none).
 */
export function replaceFiles(current: BackupFiles, imported: BackupFiles): BackupFiles {
  const result: BackupFiles = {};
  for (const name of dataFiles) {
    if (imported[name] !== undefined) result[name] = imported[name];
    else if (current[name] !== undefined) result[name] = emptyFile[name];
  }
  for (const name of Object.keys(imported).filter(isArchiveName)) result[name] = imported[name];
  if (imported[focusFileName] !== undefined) result[focusFileName] = imported[focusFileName];
  else if (current[focusFileName] !== undefined) result[focusFileName] = "";
  return result;
}
