import type { Lang } from "./lang";
import { isBlank, type Memo } from "./memo";
import { compactJSON, inboxID, jsonString, sheetCount } from "./memoDrawer";
import { isoDate } from "./notebook";

/**
 * 지운 메모 (#120, docs/plans/drawer-ux-plan.md B3): a deleted memo is kept 30 days in memo-trash.json next to memos.json
 * — out of memos.json, so an older app (or another device's) never shows it again — with the folder, pin and paper it
 * had, to go back there. The same file, rules and shared cases (docs/plans/drawer-trash-cases.json) as the Mac
 * (PaperCore MemoTrash.swift):
 *
 *   { "v": 1,
 *     "memos": [{ "id": "…", "text": "…", "createdAt": "…", "updatedAt": "…", "deletedAt": "…", "folder": "work",
 *                 "pinned": false, "paper": "night" }, …],          newest deleted first, then by id
 *     "emptiedAt": "…",                                               when 모두 비우기 was last pressed (else no key)
 *     "updatedAt": "…" }
 *
 * Two devices sharing the folder (T-cases): the copies join by memo id, the later `deletedAt` winning (a tie keeps this
 * device's); 모두 비우기 is `emptiedAt`, the later of the two, and takes every entry deleted at or before it, so emptied
 * memos don't come back from the other copy while one deleted after it, elsewhere, stays. A memo that is in memos.json is
 * alive: its entry goes (restored elsewhere, or written to again by another device after it was deleted here — an edit
 * is never hidden). Entries 30 days old go when the file is saved, `emptiedAt` too. Keys this version doesn't know are
 * kept (D18). The file is the drawer's alone: the AI connection reads memos.json only.
 */

export const memoTrashFileName = "memo-trash.json";
/** How long a deleted memo is kept (as Apple Notes' 최근 삭제된 항목). */
export const trashKeepDays = 30;

type Extra = Record<string, unknown>;
export interface TrashEntry {
  memo: Memo; deletedAt: string;
  /** Where it was: its folder (a deleted folder's id stays; restoring puts it in 메모 then), pin and paper. */
  folder: string; pinned: boolean; paper?: string; extra?: Extra;
}
export interface MemoTrash { entries: TrashEntry[]; emptiedAt?: string; updatedAt: string; extra?: Extra }

const epoch = "1970-01-01T00:00:00Z";
/** A time as both apps write it: whole-second UTC; anything unreadable is the epoch. */
const stamp = (value: unknown): string => {
  const time = typeof value === "string" ? Date.parse(value) : Number.NaN;
  return Number.isNaN(time) ? epoch : isoDate(new Date(Math.floor(time / 1000) * 1000));
};
const later = (a: string, b: string) => (a > b ? a : b);

export const emptyTrash = (): MemoTrash => ({ entries: [], updatedAt: epoch });

/** Newest deleted first, then by id. */
function sorted(entries: TrashEntry[]): TrashEntry[] {
  return [...entries].sort((a, b) => (a.deletedAt !== b.deletedAt ? (a.deletedAt < b.deletedAt ? 1 : -1) : a.memo.id < b.memo.id ? -1 : a.memo.id > b.memo.id ? 1 : 0));
}
const touched = (trash: MemoTrash, now: Date): MemoTrash => ({ ...trash, updatedAt: later(trash.updatedAt, isoDate(now)) });

/** T1: a memo deleted — kept with where it was (a blank memo isn't kept). Deleted again, its entry is the new one. */
export function trashMemo(trash: MemoTrash, memo: Memo, place: { folder: string; pinned: boolean; paper?: string }, now = new Date()): MemoTrash {
  if (isBlank(memo)) return trash;
  const entry: TrashEntry = {
    memo: { id: memo.id, text: memo.text, createdAt: stamp(memo.createdAt), updatedAt: stamp(memo.updatedAt) },
    deletedAt: isoDate(now), folder: place.folder || inboxID, pinned: place.pinned, ...(place.paper !== undefined ? { paper: place.paper } : {}),
  };
  return touched({ ...trash, entries: sorted([...trash.entries.filter((kept) => kept.memo.id !== memo.id), entry]) }, now);
}

/** T2: 되돌리기 — the entry out of the trash (the caller puts the memo back in memos.json and in its folder). */
export function untrash(trash: MemoTrash, id: string, now = new Date()): { trash: MemoTrash; entry?: TrashEntry } {
  const entry = trash.entries.find((kept) => kept.memo.id === id);
  if (!entry) return { trash };
  return { trash: touched({ ...trash, entries: trash.entries.filter((kept) => kept !== entry) }, now), entry };
}

/** T3: 지금 모두 비우기 — every entry gone for good; the time is kept so the other device's copy doesn't bring them back. */
export function emptyAll(trash: MemoTrash, now = new Date()): MemoTrash {
  return touched({ ...trash, entries: [], emptiedAt: isoDate(now) }, now);
}

/**
 * T4, T6: before a write — entries deleted 30 days ago or more go, and those whose memo is alive in memos.json (`alive`;
 * never pruned against a list that couldn't be read: pass none then); an `emptiedAt` that old too. The same value back
 * when nothing goes.
 */
export function pruneTrash(trash: MemoTrash, alive: ReadonlySet<string>, now = new Date()): MemoTrash {
  const limit = isoDate(new Date(Math.floor(now.getTime() / 1000) * 1000 - trashKeepDays * 86_400_000));
  const entries = trash.entries.filter((entry) => entry.deletedAt > limit && !alive.has(entry.memo.id));
  const emptiedGone = trash.emptiedAt !== undefined && trash.emptiedAt <= limit;
  if (entries.length === trash.entries.length && !emptiedGone) return trash;
  const next: MemoTrash = { ...trash, entries };
  if (emptiedGone) delete next.emptiedAt;
  return next;
}

/**
 * T5: another device's copy joined with this one's (`mine`): by memo id, the later `deletedAt` winning (a tie keeps
 * this one's); the later `emptiedAt`, which takes every entry deleted at or before it; unknown top-level keys from both,
 * a key on both from the newer file.
 */
export function mergeTrash(mine: MemoTrash, theirs: MemoTrash): MemoTrash {
  const byID = new Map(mine.entries.map((entry) => [entry.memo.id, entry]));
  for (const entry of theirs.entries) {
    const kept = byID.get(entry.memo.id);
    if (!kept || entry.deletedAt > kept.deletedAt) byID.set(entry.memo.id, entry);
  }
  const emptiedAt = mine.emptiedAt !== undefined && theirs.emptiedAt !== undefined ? later(mine.emptiedAt, theirs.emptiedAt) : mine.emptiedAt ?? theirs.emptiedAt;
  const entries = sorted([...byID.values()].filter((entry) => emptiedAt === undefined || entry.deletedAt > emptiedAt));
  const extra = mine.extra || theirs.extra ? (theirs.updatedAt > mine.updatedAt ? { ...mine.extra, ...theirs.extra } : { ...theirs.extra, ...mine.extra }) : undefined;
  return { entries, ...(emptiedAt !== undefined ? { emptiedAt } : {}), updatedAt: later(mine.updatedAt, theirs.updatedAt), ...(extra ? { extra } : {}) };
}

// ─── The file ─────────────────────────────────────────────────────────────────

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const fileKeys = ["v", "memos", "emptiedAt", "updatedAt"];
const entryKeys = ["id", "text", "createdAt", "updatedAt", "deletedAt", "folder", "pinned", "paper"];
function extraOf(entry: Json, known: readonly string[]): Extra | undefined {
  const extra = Object.fromEntries(Object.entries(entry).filter(([key]) => !known.includes(key)));
  return Object.keys(extra).length ? extra : undefined;
}
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const extraText = (extra: Extra | undefined): string =>
  extra ? Object.keys(extra).sort(byKey).map((key) => `, ${jsonString(key)}: ${compactJSON(extra[key])}`).join("") : "";

/** Throws when it isn't the trash file at all (kept aside, as memo-folders.json); single bad entries are skipped. */
export function parseMemoTrash(text: string): MemoTrash {
  const value = JSON.parse(text) as unknown;
  if (!isObject(value) || !Array.isArray(value.memos)) throw new Error("not a memo-trash file");
  const seen = new Set<string>();
  const entries: TrashEntry[] = [];
  for (const item of value.memos) {
    if (!isObject(item) || typeof item.id !== "string" || !item.id || typeof item.text !== "string" || seen.has(item.id)) continue;
    seen.add(item.id);
    const extra = extraOf(item, entryKeys);
    entries.push({
      memo: { id: item.id, text: item.text, createdAt: stamp(item.createdAt), updatedAt: stamp(item.updatedAt) },
      deletedAt: stamp(item.deletedAt), folder: typeof item.folder === "string" && item.folder ? item.folder : inboxID, pinned: item.pinned === true,
      ...(typeof item.paper === "string" ? { paper: item.paper } : {}), ...(extra ? { extra } : {}),
    });
  }
  const extra = extraOf(value, fileKeys);
  return { entries: sorted(entries), ...(value.emptiedAt !== undefined ? { emptiedAt: stamp(value.emptiedAt) } : {}), updatedAt: stamp(value.updatedAt), ...(extra ? { extra } : {}) };
}

/**
 * The file's text, the same bytes as the Mac's: two-space indent, each memo on one line in the keys' order (`paper` only
 * when set, unknown keys after, by key), `emptiedAt` only when set, whole-second UTC times, a newline at the end.
 */
export function serializeMemoTrash(trash: MemoTrash): string {
  const memos = trash.entries.map((entry) =>
    `    { "id": ${jsonString(entry.memo.id)}, "text": ${jsonString(entry.memo.text)}, "createdAt": ${jsonString(entry.memo.createdAt)}, "updatedAt": ${jsonString(entry.memo.updatedAt)}, ` +
    `"deletedAt": ${jsonString(entry.deletedAt)}, "folder": ${jsonString(entry.folder)}, "pinned": ${entry.pinned ? "true" : "false"}` +
    `${entry.paper !== undefined ? `, "paper": ${jsonString(entry.paper)}` : ""}${extraText(entry.extra)} }`);
  const extra = trash.extra ? Object.keys(trash.extra).sort(byKey).map((key) => `,\n  ${jsonString(key)}: ${compactJSON(trash.extra![key])}`).join("") : "";
  return [
    "{",
    '  "v": 1,',
    memos.length ? `  "memos": [\n${memos.join(",\n")}\n  ],` : '  "memos": [],',
    ...(trash.emptiedAt !== undefined ? [`  "emptiedAt": ${jsonString(trash.emptiedAt)},`] : []),
    `  "updatedAt": ${jsonString(trash.updatedAt)}${extra}`,
    "}",
  ].join("\n") + "\n";
}

// ─── Words ────────────────────────────────────────────────────────────────────

/** The folder menu's row (#120): "지운 메모 세 장" · "3 deleted notes" · "3 verwijderde notities". */
export function trashMenuLabel(count: number, lang: Lang = "ko"): string {
  if (lang === "en") return `${count} deleted ${count === 1 ? "note" : "notes"}`;
  if (lang === "nl") return `${count} ${count === 1 ? "verwijderde notitie" : "verwijderde notities"}`;
  return `지운 메모 ${sheetCount(count, lang)}`;
}

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
/** When it was deleted, by calendar days: "오늘" · "어제" · "3일 전" (en "today" · "yesterday" · "3 days ago", nl "vandaag" · "gisteren" · "3 dagen geleden"). */
export function trashAgo(deletedAt: string, now: Date, lang: Lang = "ko"): string {
  const at = new Date(deletedAt);
  const days = Number.isNaN(at.getTime()) ? 0 : Math.max(0, Math.round((startOfDay(now).getTime() - startOfDay(at).getTime()) / 86_400_000));
  if (days === 0) return { ko: "오늘", en: "today", nl: "vandaag" }[lang];
  if (days === 1) return { ko: "어제", en: "yesterday", nl: "gisteren" }[lang];
  return { ko: `${days}일 전`, en: `${days} days ago`, nl: `${days} dagen geleden` }[lang];
}

/** 지금 모두 비우기's question: "지운 메모 세 장을 완전히 지울까요?" · "Delete 3 notes for good?" · "3 notities definitief verwijderen?". */
export function emptyQuestion(count: number, lang: Lang = "ko"): string {
  if (lang === "en") return `Delete ${sheetCount(count, lang)} for good?`;
  if (lang === "nl") return `${sheetCount(count, lang)} definitief verwijderen?`;
  return `지운 메모 ${sheetCount(count, lang)}을 완전히 지울까요?`;
}

/** After 되돌리기: "‘회사’ 폴더로 되돌렸어요" · "Restored to ‘Work’" · "Teruggezet in ‘Werk’". */
export function restoredWords(folder: string, lang: Lang = "ko"): string {
  return { ko: `‘${folder}’ 폴더로 되돌렸어요`, en: `Restored to ‘${folder}’`, nl: `Teruggezet in ‘${folder}’` }[lang];
}
