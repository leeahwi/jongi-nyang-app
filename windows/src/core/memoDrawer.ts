import type { Lang } from "./lang";
import { clock, dayMonth } from "./lang";
import type { Memo } from "./memo";
import { memoTitle } from "./memo";
import { isoDate } from "./notebook";
import { matchRange } from "./search";

/**
 * 메모 서랍 (1.28): memos from the screen's edge, one folder at a time. The memos stay in memos.json as
 * they are; which folder each one is in, and whether it is pinned (고정), lives beside it in
 * memo-folders.json, so an older version that saves memos.json never loses the folders. The same file,
 * rules and cases (D1–D16, the shared memo drawer cases) as the macOS app (PaperCore MemoFolders.swift):
 *
 *   { "v": 1,
 *     "folders": [{ "id": "inbox", "name": "메모", "color": "lavender", "order": 0, "updatedAt": "…" }, …],
 *     "placement": { "<memo id>": { "folder": "<folder id>", "pinned": false, "at": "…" } },
 *     "updatedAt": "…" }
 *
 * A memo without a placement is in the inbox (메모), not pinned. A deleted folder stays as a tombstone
 * (`deleted: true`) for 30 days so another device's copy can't bring it back. Two copies merge entry by
 * entry: folders by id and placements by memo id, the newer time wins (a tie keeps this device's).
 */

export const memoFoldersFileName = "memo-folders.json";
export const inboxID = "inbox";
/** The 고정 bookmark: pinned memos from every folder (not a folder of its own). */
export const pinnedView = "pinned";
export type DrawerView = string; // a folder id, or pinnedView

export const folderColors = ["lavender", "pink", "mint", "yellow", "sky", "peach", "sand", "gray"] as const;
export type FolderColor = typeof folderColors[number];
/** A colour key as drawn: one the app doesn't know (a newer version's) is kept in the file and drawn lavender. */
export const shownColor = (color: string): FolderColor => ((folderColors as readonly string[]).includes(color) ? color as FolderColor : "lavender");

/** Keys a newer version wrote that this one doesn't know: kept as read and written back after the known ones (D18). */
export type Extra = Record<string, unknown>;
export interface MemoFolder {
  id: string; name: string; /** A FolderColor; an unknown key is kept as written. */ color: string; order: number; updatedAt: string; deleted?: boolean;
  /** 정렬 (1.29): "created" · "title" · a newer version's value (kept, read as 고친 순); absent = "edited". */
  sort?: string;
  extra?: Extra;
}
export interface MemoPlacement {
  folder: string; pinned: boolean; at: string;
  /** 이 메모의 종이 (1.29): "day" · "night" · "kraft" · "grid" · a newer version's value (kept, read as 서랍 따라); absent = 서랍 따라. */
  paper?: string;
  extra?: Extra;
}
export interface MemoFolders { v: 1; folders: MemoFolder[]; placement: Record<string, MemoPlacement>; updatedAt: string; extra?: Extra }

/** 정렬: 고친 순 (the default; date groups by the edit time) · 만든 순 (by creation) · 제목 순 (no date groups). */
export type FolderSort = "edited" | "created" | "title";
export const folderSorts: FolderSort[] = ["edited", "created", "title"];
export const readSort = (value: unknown): FolderSort => (value === "created" || value === "title" ? value : "edited");
export const sortOf = (folder: MemoFolder | undefined): FolderSort => readSort(folder?.sort);
/** A memo's own paper (이 메모의 종이); undefined = 서랍 따라 (the drawer's). */
export type MemoPaper = "day" | "night" | "kraft" | "grid";
export const memoPapers: MemoPaper[] = ["day", "night", "kraft", "grid"];
export const readMemoPaper = (value: unknown): MemoPaper | undefined => ((memoPapers as unknown[]).includes(value) ? value as MemoPaper : undefined);

const epoch = "1970-01-01T00:00:00Z";
/** The inbox's name when it was made, by language; any of them, untouched, shows in the app's language. */
const inboxNames: Record<Lang, string> = { ko: "메모", en: "Notes", nl: "Notities" };
export const defaultInboxName = (lang: Lang = "ko"): string => inboxNames[lang];
const tombstoneDays = 30;

/** D1: no file yet — the inbox alone, every memo in it. */
export function emptyMemoFolders(lang: Lang = "ko"): MemoFolders {
  return { v: 1, folders: [{ id: inboxID, name: defaultInboxName(lang), color: "lavender", order: 0, updatedAt: epoch }], placement: {}, updatedAt: epoch };
}

/** A folder's name as kept: one line (line breaks become spaces), trimmed, at most 40 characters. */
export function cleanFolderName(name: string): string {
  return [...name.replace(/[\r\n]+/g, " ").trim()].slice(0, 40).join("").trim();
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
const isTime = (value: unknown): value is string => typeof value === "string" && !Number.isNaN(Date.parse(value));

/**
 * The file read: throws when it isn't the folders file at all (D15: kept aside, started afresh). Entries
 * it can't use are left out; the inbox is added when missing (and can't be deleted).
 */
export function parseMemoFolders(text: string, lang: Lang = "ko"): MemoFolders {
  const value = JSON.parse(text) as unknown;
  if (!isObject(value) || !Array.isArray(value.folders)) throw new Error("not a memo-folders file");
  const folders: MemoFolder[] = [];
  const seen = new Set<string>();
  value.folders.forEach((entry, index) => {
    if (!isObject(entry) || typeof entry.id !== "string" || !entry.id || seen.has(entry.id) || typeof entry.name !== "string") return;
    seen.add(entry.id);
    const extra = extraOf(entry, folderKeys);
    folders.push({
      id: entry.id, name: entry.name, color: typeof entry.color === "string" ? entry.color : "lavender",
      order: typeof entry.order === "number" && Number.isFinite(entry.order) ? entry.order : index,
      updatedAt: isTime(entry.updatedAt) ? entry.updatedAt : epoch,
      ...(entry.deleted === true && entry.id !== inboxID ? { deleted: true } : {}),
      ...(typeof entry.sort === "string" && entry.sort !== "edited" ? { sort: entry.sort } : {}),
      ...(extra ? { extra } : {}),
    });
  });
  // The inbox, when the file lacks it: first (order 0 in an empty list, else just before the first).
  if (!seen.has(inboxID)) folders.unshift({ id: inboxID, name: defaultInboxName(lang), color: "lavender", order: folders.length ? Math.min(0, Math.min(...folders.map((folder) => folder.order)) - 1) : 0, updatedAt: epoch });
  const placement: Record<string, MemoPlacement> = {};
  for (const [id, entry] of Object.entries(isObject(value.placement) ? value.placement : {})) {
    if (!isObject(entry) || typeof entry.folder !== "string" || !entry.folder) continue;
    const extra = extraOf(entry, placementKeys);
    placement[id] = {
      folder: entry.folder, pinned: entry.pinned === true, at: isTime(entry.at) ? entry.at : epoch,
      ...(typeof entry.paper === "string" ? { paper: entry.paper } : {}),
      ...(extra ? { extra } : {}),
    };
  }
  const extra = extraOf(value, fileKeys);
  return { v: 1, folders, placement, updatedAt: isTime(value.updatedAt) ? value.updatedAt : epoch, ...(extra ? { extra } : {}) };
}

const fileKeys = ["v", "folders", "placement", "updatedAt"];
const folderKeys = ["id", "name", "color", "order", "updatedAt", "deleted", "sort"];
const placementKeys = ["folder", "pinned", "at", "paper"];
/** The keys this version doesn't know, as read (none: undefined). */
function extraOf(entry: Json, known: readonly string[]): Extra | undefined {
  const extra = Object.fromEntries(Object.entries(entry).filter(([key]) => !known.includes(key)));
  return Object.keys(extra).length ? extra : undefined;
}

const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** A kept value on one line (D18): objects `{ "a": 1 }` with sorted keys, arrays `[1, "x"]`, numbers in their shortest form. */
function compactJSON(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return jsonString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (Array.isArray(value)) return value.length ? `[${value.map(compactJSON).join(", ")}]` : "[]";
  if (isObject(value)) {
    const keys = Object.keys(value).sort(byKey);
    return keys.length ? `{ ${keys.map((key) => `${jsonString(key)}: ${compactJSON(value[key])}`).join(", ")} }` : "{}";
  }
  return "null";
}
/** `, "key": value` for each kept key, sorted by key. */
const extraText = (extra: Extra | undefined): string =>
  extra ? Object.keys(extra).sort(byKey).map((key) => `, ${jsonString(key)}: ${compactJSON(extra[key])}`).join("") : "";

/** A JSON string as both apps write it: only `"`, `\` and control characters escaped (non-ASCII and `/` as they are). */
function jsonString(value: string): string {
  return `"${value.replace(/["\\\u0000-\u001f]/g, (character) => {
    if (character === '"') return '\\"';
    if (character === "\\") return "\\\\";
    if (character === "\n") return "\\n";
    if (character === "\r") return "\\r";
    if (character === "\t") return "\\t";
    return `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`;
  })}"`;
}

/**
 * The file's text, the same bytes as the Mac's: two-space indent, each folder on one line (sorted by order,
 * then id; `"deleted": true` only on a tombstone), each placement on one line (sorted by memo id), empty
 * ones as `[]` / `{}`, a newline at the end.
 */
export function serializeMemoFolders(data: MemoFolders): string {
  const folders = [...data.folders].sort(byOrder).map((folder) =>
    `    { "id": ${jsonString(folder.id)}, "name": ${jsonString(folder.name)}, "color": ${jsonString(folder.color)}, "order": ${JSON.stringify(folder.order)}, "updatedAt": ${jsonString(folder.updatedAt)}` +
    `${folder.sort !== undefined && folder.sort !== "edited" ? `, "sort": ${jsonString(folder.sort)}` : ""}${folder.deleted ? ', "deleted": true' : ""}${extraText(folder.extra)} }`);
  const ids = Object.keys(data.placement).sort(byKey);
  const placement = ids.map((id) => {
    const entry = data.placement[id];
    return `    ${jsonString(id)}: { "folder": ${jsonString(entry.folder)}, "pinned": ${entry.pinned ? "true" : "false"}, "at": ${jsonString(entry.at)}${entry.paper !== undefined ? `, "paper": ${jsonString(entry.paper)}` : ""}${extraText(entry.extra)} }`;
  });
  const extra = data.extra ? Object.keys(data.extra).sort(byKey).map((key) => `,\n  ${jsonString(key)}: ${compactJSON(data.extra![key])}`).join("") : "";
  return [
    "{",
    '  "v": 1,',
    folders.length ? `  "folders": [\n${folders.join(",\n")}\n  ],` : '  "folders": [],',
    placement.length ? `  "placement": {\n${placement.join(",\n")}\n  },` : '  "placement": {},',
    `  "updatedAt": ${jsonString(data.updatedAt)}${extra}`,
    "}",
  ].join("\n") + "\n";
}

const byOrder = (a: MemoFolder, b: MemoFolder) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Folders shown as bookmarks, in order (deleted ones left out); the inbox is always among them. */
export function visibleFolders(data: MemoFolders): MemoFolder[] {
  return data.folders.filter((folder) => !folder.deleted).sort(byOrder);
}

/** The name shown: the inbox's untouched default reads in the app's language. */
export function folderName(folder: MemoFolder, lang: Lang = "ko"): string {
  if (folder.id === inboxID && (Object.values(inboxNames) as string[]).includes(folder.name)) return defaultInboxName(lang);
  return folder.name;
}

const live = (data: MemoFolders, id: string) => data.folders.some((folder) => folder.id === id && !folder.deleted);

/** Where a memo is: its placement, or the inbox (D2, D5); a folder that is gone means the inbox too. */
export function placementOf(data: MemoFolders, memoID: string): { folder: string; pinned: boolean } {
  const entry = data.placement[memoID];
  if (!entry) return { folder: inboxID, pinned: false };
  return { folder: live(data, entry.folder) ? entry.folder : inboxID, pinned: entry.pinned };
}

/** The memos a bookmark shows, in the memos' order (newest first): a folder's, or 고정 (pinned ones from every folder). */
export function memosIn(data: MemoFolders, memos: readonly Memo[], view: DrawerView): Memo[] {
  return memos.filter((memo) => {
    const place = placementOf(data, memo.id);
    return view === pinnedView ? place.pinned : place.folder === view;
  });
}

/** A view that exists now: the folder (or 고정) asked for, else the inbox (a folder deleted elsewhere). */
export function resolveView(data: MemoFolders, view: string | undefined): DrawerView {
  if (view === pinnedView) return pinnedView;
  return view && live(data, view) ? view : inboxID;
}

/** The last folder (a device setting; 빠른 메모 and /메모 put memos there): missing or deleted → the inbox. Never 고정. */
export const lastFolderOf = (data: MemoFolders, saved: string | undefined): string => (saved && saved !== pinnedView && live(data, saved) ? saved : inboxID);

/** D11: where the quick-write slip puts a memo — 고정 means the inbox, pinned; a folder that is gone, the inbox. */
export function targetOf(data: MemoFolders, view: string | undefined): { folder: string; pinned: boolean } {
  if (view === pinnedView) return { folder: inboxID, pinned: true };
  return { folder: resolveView(data, view), pinned: false };
}

/** D10: the quick-write slip's text as saved — trimmed at both ends (inside kept); blank → nothing. */
export function quickWriteText(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed ? trimmed : undefined;
}

// ─── Changes (each returns a new value; `now` is the change's time) ──────────

const touched = (data: MemoFolders, now: Date): MemoFolders => ({ ...data, updatedAt: isoDate(now) });

/** A new folder after the others (order = the largest live order + 1); a blank name makes nothing. */
export function addFolder(data: MemoFolders, name: string, color: string, id: string, now = new Date()): MemoFolders {
  const clean = cleanFolderName(name);
  if (!clean) return data;
  const order = Math.max(-1, ...data.folders.filter((folder) => !folder.deleted).map((folder) => folder.order)) + 1;
  return touched({ ...data, folders: [...data.folders, { id, name: clean, color, order, updatedAt: isoDate(now) }] }, now);
}

/** A blank name is ignored. */
export function renameFolder(data: MemoFolders, id: string, name: string, now = new Date()): MemoFolders {
  const trimmed = cleanFolderName(name);
  if (!trimmed) return data;
  return touched({ ...data, folders: data.folders.map((folder) => (folder.id === id ? { ...folder, name: trimmed, updatedAt: isoDate(now) } : folder)) }, now);
}

export function recolorFolder(data: MemoFolders, id: string, color: string, now = new Date()): MemoFolders {
  return touched({ ...data, folders: data.folders.map((folder) => (folder.id === id ? { ...folder, color, updatedAt: isoDate(now) } : folder)) }, now);
}

/**
 * D3, D4: a folder deleted — a tombstone, and its memos back in the inbox (a new `at`, so another
 * device's older placement doesn't put them back), pinned ones still pinned. The inbox can't be deleted
 * (D4: the same value back).
 */
export function deleteFolder(data: MemoFolders, id: string, now = new Date()): MemoFolders {
  if (id === inboxID || !live(data, id)) return data;
  const at = isoDate(now);
  const placement: Record<string, MemoPlacement> = {};
  for (const [memo, entry] of Object.entries(data.placement)) placement[memo] = entry.folder === id ? { ...entry, folder: inboxID, at } : entry;
  return touched({ ...data, folders: data.folders.map((folder) => (folder.id === id ? { ...folder, deleted: true, updatedAt: at } : folder)), placement }, now);
}

/**
 * 되돌리기 after a folder was deleted: the folder back (live, a new time) and these memos in it again, pins
 * as they are now.
 */
export function restoreFolder(data: MemoFolders, id: string, memoIDs: readonly string[], now = new Date()): MemoFolders {
  if (!data.folders.some((folder) => folder.id === id)) return data;
  const at = isoDate(now);
  const placement = { ...data.placement };
  for (const memo of memoIDs) placement[memo] = { ...data.placement[memo], folder: id, pinned: placementOf(data, memo).pinned, at };
  const live = (folder: MemoFolder): MemoFolder => { const { deleted: _deleted, ...rest } = folder; return { ...rest, updatedAt: at }; };
  return touched({ ...data, folders: data.folders.map((folder) => (folder.id === id ? live(folder) : folder)), placement }, now);
}

/** The bookmarks in a new order (ids top to bottom); every folder whose place changed gets a new time. */
export function reorderFolders(data: MemoFolders, ids: readonly string[], now = new Date()): MemoFolders {
  const at = isoDate(now);
  const shown = visibleFolders(data).map((folder) => folder.id);
  const order = [...ids.filter((id) => shown.includes(id)), ...shown.filter((id) => !ids.includes(id))];
  return touched({
    ...data,
    folders: data.folders.map((folder) => {
      const index = order.indexOf(folder.id);
      return index < 0 || folder.order === index ? folder : { ...folder, order: index, updatedAt: at };
    }),
  }, now);
}

export function moveMemo(data: MemoFolders, memoID: string, folder: string, now = new Date()): MemoFolders {
  if (!live(data, folder)) return data;
  const current = placementOf(data, memoID);
  if (current.folder === folder && data.placement[memoID]) return data;
  return touched({ ...data, placement: { ...data.placement, [memoID]: { ...data.placement[memoID], folder, pinned: current.pinned, at: isoDate(now) } } }, now);
}

export function setPinned(data: MemoFolders, memoID: string, pinned: boolean, now = new Date()): MemoFolders {
  const current = placementOf(data, memoID);
  if (current.pinned === pinned) return data;
  return touched({ ...data, placement: { ...data.placement, [memoID]: { ...data.placement[memoID], folder: current.folder, pinned, at: isoDate(now) } } }, now);
}

/**
 * D17: 정렬 — "edited" (고친 순) is written as no key; changing it is a change of the folder (its `updatedAt`), so
 * the newer copy of the folder wins a merge with it (D20).
 */
export function setFolderSort(data: MemoFolders, id: string, sort: FolderSort, now = new Date()): MemoFolders {
  const folder = data.folders.find((entry) => entry.id === id);
  if (!folder || sortOf(folder) === sort && (sort !== "edited" || folder.sort === undefined)) return data;
  const at = isoDate(now);
  return touched({
    ...data,
    folders: data.folders.map((entry) => {
      if (entry.id !== id) return entry;
      const { sort: _old, ...rest } = entry;
      return sort === "edited" ? { ...rest, updatedAt: at } : { ...rest, sort, updatedAt: at };
    }),
  }, now);
}

/** D17: 이 메모의 종이 — a paper, or undefined (서랍 따라: no key); a change of the placement (its `at`), like 고정. */
export function setMemoPaper(data: MemoFolders, memoID: string, paper: MemoPaper | undefined, now = new Date()): MemoFolders {
  const entry = data.placement[memoID];
  if (entry?.paper === paper) return data;
  const current = placementOf(data, memoID);
  const base: MemoPlacement = entry ? { ...entry } : { folder: current.folder, pinned: current.pinned, at: "" };
  delete base.paper;
  return touched({ ...data, placement: { ...data.placement, [memoID]: { ...base, at: isoDate(now), ...(paper ? { paper } : {}) } } }, now);
}

/** A memo's own paper as drawn (a value this version doesn't know is 서랍 따라). */
export const paperOf = (data: MemoFolders, memoID: string): MemoPaper | undefined => readMemoPaper(data.placement[memoID]?.paper);

/** D28: 고정 모두 풀기 — every pinned memo unpinned (a new `at` each); the ids it unpinned, for 되돌리기. */
export function unpinAll(data: MemoFolders, now = new Date()): { data: MemoFolders; ids: string[] } {
  const ids = Object.keys(data.placement).filter((id) => data.placement[id].pinned).sort(byKey);
  let next = data;
  for (const id of ids) next = setPinned(next, id, false, now);
  return { data: next, ids };
}

/** 되돌리기 after 고정 모두 풀기: these memos pinned again. */
export function pinAll(data: MemoFolders, ids: readonly string[], now = new Date()): MemoFolders {
  let next = data;
  for (const id of ids) next = setPinned(next, id, true, now);
  return next;
}

const copyWords: Record<Lang, string> = { ko: "사본", en: "copy", nl: "kopie" };
/** D21: a copy's name — `회사 사본`, then `회사 사본 2`, `3`… while a live folder has it (the name cut so it fits 40 characters). */
export function copyName(data: MemoFolders, folder: MemoFolder, lang: Lang = "ko"): string {
  const taken = new Set(visibleFolders(data).map((entry) => folderName(entry, lang)));
  // The folder's name gives way so the ending always fits in 40 characters.
  const named = (ending: string) => `${[...folderName(folder, lang)].slice(0, Math.max(1, 40 - [...ending].length)).join("").trim()}${ending}`;
  let name = named(` ${copyWords[lang]}`);
  for (let number = 2; taken.has(name) && number < 1000; number += 1) name = named(` ${copyWords[lang]} ${number}`);
  return name;
}

/**
 * D21: 복제 — a new folder right after `id` (the ones after it move down one, with a new time), the same colour
 * and 정렬, holding `copies` ([original memo id, copy's id]): each copy pinned as its original, with its paper.
 * The memos themselves are copied by the caller (memos.json: new ids, same text and times).
 */
export function duplicateFolder(data: MemoFolders, id: string, newID: string, copies: readonly (readonly [string, string])[], lang: Lang = "ko", now = new Date()): MemoFolders {
  const source = visibleFolders(data).find((folder) => folder.id === id);
  if (!source) return data;
  const at = isoDate(now);
  const order = source.order + 1;
  const folders = data.folders.map((folder) => (!folder.deleted && folder.id !== id && folder.order >= order ? { ...folder, order: folder.order + 1, updatedAt: at } : folder));
  folders.push({ id: newID, name: copyName(data, source, lang), color: source.color, order, updatedAt: at, ...(source.sort !== undefined ? { sort: source.sort } : {}) });
  const placement = { ...data.placement };
  for (const [original, copy] of copies) {
    const place = placementOf(data, original);
    const paper = data.placement[original]?.paper;
    placement[copy] = { folder: newID, pinned: place.pinned, at, ...(paper !== undefined ? { paper } : {}) };
  }
  return touched({ ...data, folders, placement }, now);
}

/** A new memo's place: written only when it isn't plainly in the inbox (no entry means the inbox). */
export function placeNew(data: MemoFolders, memoID: string, target: { folder: string; pinned: boolean }, now = new Date()): MemoFolders {
  if (target.folder === inboxID && !target.pinned) return data;
  return touched({ ...data, placement: { ...data.placement, [memoID]: { folder: live(data, target.folder) ? target.folder : inboxID, pinned: target.pinned, at: isoDate(now) } } }, now);
}

/**
 * Before a write (D6): placements of memos that no longer exist are dropped, and tombstones older than
 * 30 days. Returns the same value when nothing goes.
 */
export function pruneMemoFolders(data: MemoFolders, memoIDs: ReadonlySet<string>, now = new Date()): MemoFolders {
  const gone = Object.keys(data.placement).filter((id) => !memoIDs.has(id));
  const cutoff = now.getTime() - tombstoneDays * 86_400_000;
  const old = data.folders.filter((folder) => folder.deleted && Date.parse(folder.updatedAt) <= cutoff);
  if (gone.length === 0 && old.length === 0) return data;
  const placement = { ...data.placement };
  for (const id of gone) delete placement[id];
  return { ...data, folders: data.folders.filter((folder) => !old.includes(folder)), placement };
}

/**
 * Two copies of the file (this device's and the one on disk) as one (D13, D14): folders by id and
 * placements by memo id, the newer time winning; on a tie this device's (`mine`) stays. Folders made on
 * two devices with the same name have different ids, so both stay.
 */
export function mergeMemoFolders(mine: MemoFolders, theirs: MemoFolders): MemoFolders {
  const folders = new Map<string, MemoFolder>();
  for (const folder of theirs.folders) folders.set(folder.id, folder);
  for (const folder of mine.folders) {
    const other = folders.get(folder.id);
    if (!other || folder.updatedAt >= other.updatedAt) folders.set(folder.id, folder);
  }
  // Theirs first in their order, then folders only this side has.
  const ids = [...theirs.folders.map((folder) => folder.id), ...mine.folders.map((folder) => folder.id).filter((id) => !theirs.folders.some((folder) => folder.id === id))];
  const placement: Record<string, MemoPlacement> = { ...theirs.placement };
  for (const [id, entry] of Object.entries(mine.placement)) {
    const other = placement[id];
    if (!other || entry.at >= other.at) placement[id] = entry;
  }
  const extra = mine.extra || theirs.extra ? { ...theirs.extra, ...mine.extra } : undefined;
  return { v: 1, folders: ids.map((id) => folders.get(id)!), placement, updatedAt: mine.updatedAt > theirs.updatedAt ? mine.updatedAt : theirs.updatedAt, ...(extra ? { extra } : {}) };
}

/** D16: Ctrl+1–9 → the bookmarks in order, Ctrl+0 → 고정; a number with no bookmark → nothing. */
export function viewForDigit(data: MemoFolders, digit: number): DrawerView | undefined {
  if (digit === 0) return pinnedView;
  if (!Number.isInteger(digit) || digit < 1 || digit > 9) return undefined;
  return visibleFolders(data)[digit - 1]?.id;
}

// ─── Checklist lines ──────────────────────────────────────────────────────────

const checklistPattern = /^(\s*)([-*]) \[( |x|X)\] (.*)$/;

export interface ChecklistLine { indent: string; checked: boolean; text: string }

/** A `- [ ] 우유` / `- [x] 우유` line (also `*`, `[X]`), or undefined. */
export function checklistLine(line: string): ChecklistLine | undefined {
  const match = checklistPattern.exec(line.replace(/\r$/, ""));
  return match ? { indent: match[1], checked: match[3] !== " ", text: match[4] } : undefined;
}

/**
 * D7, D8: the checkbox on line `index` (0-based, counting "\n") turned over — only `[ ]` ↔ `[x]` changes,
 * every other character stays as it was. A line that isn't a checklist line: the text unchanged.
 */
export function toggleChecklist(text: string, index: number): string {
  const lines = text.split("\n");
  const line = lines[index];
  if (line === undefined || !checklistLine(line)) return text;
  const at = line.indexOf("[");
  const mark = line[at + 1];
  lines[index] = `${line.slice(0, at + 1)}${mark === " " ? "x" : " "}${line.slice(at + 2)}`;
  return lines.join("\n");
}

/** D27: 체크한 줄 지우기 — the ticked checklist lines go, every other line (and its `\r`) stays; none ticked: the same text. */
export function removeCheckedLines(text: string): string {
  const lines = text.split("\n");
  const kept = lines.filter((line) => !checklistLine(line)?.checked);
  return kept.length === lines.length ? text : kept.join("\n");
}
export const hasCheckedLines = (text: string): boolean => text.split("\n").some((line) => checklistLine(line)?.checked === true);

/** D9: checked lines / checklist lines; undefined when the memo has none (no bar). */
export function checklistProgress(text: string): { done: number; total: number } | undefined {
  let done = 0, total = 0;
  for (const line of text.split("\n")) {
    const entry = checklistLine(line);
    if (!entry) continue;
    total += 1;
    if (entry.checked) done += 1;
  }
  return total ? { done, total } : undefined;
}

/** A checklist line as a collapsed slip shows it: ☐ / ☑ and its words. */
const glyphLine = (line: string): string => {
  const entry = checklistLine(line);
  return entry ? `${entry.checked ? "☑" : "☐"} ${entry.text.trim()}` : line.trim();
};

/**
 * A collapsed slip: the title (the first line with words, a checklist marker taken off) and the next two
 * lines with words (checklist lines as ☐ / ☑). An empty memo is "빈 메모" (memoTitle).
 */
export function slipSummary(memo: Memo, lang: Lang = "ko"): { title: string; preview: string[] } {
  const lines = memo.text.split("\n").filter((line) => line.trim());
  if (lines.length === 0) return { title: memoTitle(memo, lang), preview: [] };
  const first = checklistLine(lines[0]);
  return { title: first ? first.text.trim() || memoTitle(memo, lang) : lines[0].trim(), preview: lines.slice(1, 3).map(glyphLine) };
}

const commands = new Set(["git", "npm", "npx", "yarn", "pnpm", "cd", "ls", "ssh", "scp", "docker", "kubectl", "brew", "curl", "wget", "python", "python3", "node", "sudo", "cat", "grep", "make", "cargo", "pip", "pip3", "winget", "choco", "gh", "rm", "mv", "cp", "mkdir", "chmod", "tar", "deno", "bun"]);

/**
 * A line set in a typewriter face: wrapped in backticks, starting with `$ ` or four spaces / a tab, or a
 * command line — no Hangul, a known command and at least one word after it (`git log --oneline -5`).
 */
export function isCodeLine(line: string): boolean {
  if (/^(\t| {4})\S/.test(line) || /^\$ \S/.test(line) || /^`[^`]+`$/.test(line.trim())) return true;
  const words = line.trim().split(/\s+/);
  // A command, or a script by its path (`./scripts/qa.sh all`), with something after it.
  return !/[ㄱ-ㆎ가-힣]/.test(line) && words.length >= 2 && (commands.has(words[0]) || /^\.{1,2}\/\S/.test(words[0]));
}

// ─── Words ────────────────────────────────────────────────────────────────────

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** A slip's time, by calendar day: today "10:12", yesterday "어제", this year "10월 21일", else with the year. */
export function slipTime(updatedAt: string, now: Date, lang: Lang = "ko"): string {
  const at = new Date(updatedAt);
  if (Number.isNaN(at.getTime())) return "";
  if (sameDay(at, now)) return clock(at.getHours(), at.getMinutes(), lang);
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(at, yesterday)) return { ko: "어제", en: "Yesterday", nl: "Gisteren" }[lang];
  return dayMonth(at.getMonth() + 1, at.getDate(), at.getFullYear() !== now.getFullYear() ? at.getFullYear() : undefined, lang);
}

/** The handle's small number: memos changed today (calendar day); 0 shows nothing. */
export function changedToday(memos: readonly Memo[], now: Date): number {
  return memos.filter((memo) => { const at = new Date(memo.updatedAt); return !Number.isNaN(at.getTime()) && sameDay(at, now); }).length;
}

const koCounts = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"];
/** "다섯 장" (한 … 열 in words, then "11장"); en "5 notes", nl "5 notities". */
export function sheetCount(count: number, lang: Lang = "ko"): string {
  if (lang === "en") return `${count} ${count === 1 ? "note" : "notes"}`;
  if (lang === "nl") return `${count} ${count === 1 ? "notitie" : "notities"}`;
  return count >= 1 && count <= 10 ? `${koCounts[count]} 장` : `${count}장`;
}

/** 은 or 는 after a word: by its last syllable's final consonant (digits and Latin letters as they are read). */
export function topicParticle(word: string): "은" | "는" {
  const last = [...word.trim()].pop() ?? "";
  const code = last.codePointAt(0) ?? 0;
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 ? "은" : "는";
  if (/[013678]/.test(last)) return "은"; // 영 일 삼 육 칠 팔
  if (/[lmnr]/i.test(last)) return "은"; // 엘 엠 엔 알
  return "는";
}

/**
 * The drawer's footer (the shared words, memo-drawer-cases.md): "회사에 다섯 장" · "회사는 비어 있어요" · "고정한 메모
 * 세 장" · "고정한 메모가 없어요" · "모든 폴더에서 두 장" · "찾은 메모가 없어요" — en "5 notes in Work" · "Work is empty" ·
 * "3 pinned notes" · "No pinned notes" · "2 notes in all folders" · "No notes found"; nl "5 notities in Werk" · "Werk is
 * leeg" · "3 vastgezette notities" · "Geen vastgezette notities" · "2 notities in alle mappen" · "Geen notities gevonden".
 */
export function drawerFooter(kind: "folder" | "pinned" | "search", count: number, folder = "", lang: Lang = "ko"): string {
  if (kind === "search") {
    if (count === 0) return { ko: "찾은 메모가 없어요", en: "No notes found", nl: "Geen notities gevonden" }[lang];
    return lang === "ko" ? `모든 폴더에서 ${sheetCount(count, lang)}` : lang === "en" ? `${sheetCount(count, lang)} in all folders` : `${sheetCount(count, lang)} in alle mappen`;
  }
  if (kind === "pinned") {
    if (count === 0) return { ko: "고정한 메모가 없어요", en: "No pinned notes", nl: "Geen vastgezette notities" }[lang];
    return lang === "ko" ? `고정한 메모 ${sheetCount(count, lang)}` : lang === "en" ? `${count} pinned ${count === 1 ? "note" : "notes"}` : `${count} vastgezette ${count === 1 ? "notitie" : "notities"}`;
  }
  if (count === 0) return { ko: `${folder}${topicParticle(folder)} 비어 있어요`, en: `${folder} is empty`, nl: `${folder} is leeg` }[lang];
  return lang === "ko" ? `${folder}에 ${sheetCount(count, lang)}` : `${sheetCount(count, lang)} in ${folder}`;
}

// ─── Search (D12) ─────────────────────────────────────────────────────────────

/** A search hit: the memo, where it is, the line shown and the matched part (none when only its folder's name matched). */
export interface DrawerHit { memo: Memo; folder: string; pinned: boolean; text: string; range?: [number, number] }

/**
 * D12: every folder's memos that match, in the memos' order — the same matching as the note's memo search
 * (whole syllables or first consonants, case and accents ignored): the title, else the first line that
 * matches (trimmed, as written); else a memo whose folder's name matches, with its title and nothing marked.
 */
export function drawerSearch(data: MemoFolders, memos: readonly Memo[], query: string, lang: Lang = "ko"): DrawerHit[] {
  if (!query.trim()) return [];
  const namesMatch = new Set(folderHits(data, query, lang).map((folder) => folder.id));
  const hits: DrawerHit[] = [];
  for (const memo of memos) {
    const place = placementOf(data, memo.id);
    const title = slipSummary(memo, lang).title;
    const titleRange = matchRange(title, query);
    if (titleRange) { hits.push({ memo, ...place, text: title, range: titleRange }); continue; }
    const line = memo.text.split("\n").map((entry) => entry.trim()).find((entry) => matchRange(entry, query));
    if (line !== undefined) hits.push({ memo, ...place, text: line, range: matchRange(line, query) });
    else if (namesMatch.has(place.folder)) hits.push({ memo, ...place, text: title });
  }
  return hits;
}

/** Folder names that match (the note's search lists them too). */
export function folderHits(data: MemoFolders, query: string, lang: Lang = "ko"): MemoFolder[] {
  if (!query.trim()) return [];
  return visibleFolders(data).filter((folder) => matchRange(folderName(folder, lang), query));
}

// ─── The shortcut ─────────────────────────────────────────────────────────────

export const defaultDrawerShortcut = "Control+Shift+D";
/** Ctrl+Alt+M (빠른 메모), Ctrl+Alt+J (노트), Ctrl+Alt+N (빠른 입력): the app's own, never the drawer's. */
export const reservedShortcuts = ["Control+Alt+M", "Control+Alt+J", "Control+Alt+N"];

export interface KeyPress { key: string; code: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }
export type ShortcutReading = { accelerator: string } | { problem: "waiting" | "modifier" | "reserved" | "key" };

const keyOfCode = (code: string): string | undefined => {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  const named: Record<string, string> = {
    Space: "Space", Backquote: "`", Minus: "-", Equal: "=", BracketLeft: "[", BracketRight: "]", Backslash: "\\", Semicolon: ";", Quote: "'",
    Comma: ",", Period: ".", Slash: "/", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right", Home: "Home", End: "End",
    PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert", Delete: "Delete",
  };
  return named[code];
};

/**
 * A key pressed while recording, as an Electron accelerator ("Control+Shift+D", modifiers in that order).
 * Only modifiers so far: waiting. A key needs Ctrl, Alt or Win with it (Shift alone isn't enough, F-keys
 * aside); the app's own three are refused.
 */
export function readShortcut(press: KeyPress): ShortcutReading {
  if (["Control", "Shift", "Alt", "Meta", "OS", "AltGraph"].includes(press.key)) return { problem: "waiting" };
  const key = keyOfCode(press.code);
  if (!key) return { problem: "key" };
  const fkey = /^F\d+$/.test(key);
  if (!press.ctrlKey && !press.altKey && !press.metaKey && !fkey) return { problem: "modifier" };
  const accelerator = [press.ctrlKey && "Control", press.altKey && "Alt", press.shiftKey && "Shift", press.metaKey && "Super", key].filter(Boolean).join("+");
  return reservedShortcuts.includes(accelerator) ? { problem: "reserved" } : { accelerator };
}

/** "Control+Shift+D" as people read it: "Ctrl+Shift+D" ("Super" is the Windows key: "Win"). */
export function shortcutLabel(accelerator: string): string {
  return accelerator.split("+").map((part) => (part === "Control" ? "Ctrl" : part === "Super" ? "Win" : part)).join("+");
}

/** A saved shortcut: an accelerator that isn't one of the app's own, else the default; "" means off. */
export function readDrawerShortcut(value: unknown): string {
  if (value === "") return "";
  if (typeof value !== "string" || !/^[A-Za-z0-9+`\-=[\]\\;',./]+$/.test(value) || reservedShortcuts.includes(value)) return defaultDrawerShortcut;
  return value;
}

// ─── Device settings ──────────────────────────────────────────────────────────

export type DrawerSide = "right" | "left";
/** 바탕 (1.29): 불투명 (the default) · 반투명 (82 % and a blur) · 강하게 (62 %) · 바탕 없음 (the memos float on the desktop). */
export type DrawerBackdrop = "solid" | "frost" | "strong" | "none";
export const drawerBackdrops: DrawerBackdrop[] = ["solid", "frost", "strong", "none"];
export const readDrawerBackdrop = (value: unknown): DrawerBackdrop => ((drawerBackdrops as unknown[]).includes(value) ? value as DrawerBackdrop : "solid");
export type DrawerTheme = "auto" | "day" | "night" | "kraft" | "grid";
export const drawerThemes: DrawerTheme[] = ["auto", "day", "night", "kraft", "grid"];
export const drawerWidth = { min: 260, max: 480, default: 300 };
export const clampDrawerWidth = (value: unknown): number => (typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(drawerWidth.max, Math.max(drawerWidth.min, value))) : drawerWidth.default);
/** 자동 follows the note's paper (낮 / 밤). */
export const drawerLook = (theme: DrawerTheme, night: boolean): Exclude<DrawerTheme, "auto"> => (theme === "auto" ? (night ? "night" : "day") : theme);
export const readDrawerTheme = (value: unknown): DrawerTheme => ((drawerThemes as unknown[]).includes(value) ? value as DrawerTheme : "auto");

// ─── The memo tab gone (1.28): the one-time move notice (M1–M3) ──────────────

/**
 * The first launch of 1.28 on a device (`shown` false): with memos, the slip that says where they went
 * (M1); without, nothing (M2) — either way the flag is set and it never comes again (M3). `shortcut`: the
 * drawer's (an accelerator, "" when off).
 */
export function moveNotice(memoCount: number, shown: boolean, shortcut: string, lang: Lang = "ko"): { title: string; message: string; open: string; later: string } | undefined {
  if (shown || memoCount === 0) return undefined;
  const key = shortcut ? shortcutLabel(shortcut) : "";
  if (lang === "en") {
    const where = memoCount === 1 ? "The note from the Notes tab is in the drawer’s ‘Notes’ folder." : `All ${memoCount} notes from the Notes tab are in the drawer’s ‘Notes’ folder.`;
    return { title: "Your notes moved to the drawer", message: `${where} Open it with ${key ? `${key} or ` : ""}the drawer button above the notepad.`, open: "Open the drawer", later: "Later" };
  }
  if (lang === "nl") {
    const where = memoCount === 1 ? "De notitie van het tabblad Notities staat in de map ‘Notities’ van de lade." : `Alle ${memoCount} notities van het tabblad Notities staan in de map ‘Notities’ van de lade.`;
    return { title: "Je notities staan nu in de lade", message: `${where} Open haar met ${key ? `${key} of ` : ""}de ladeknop boven het notitieblok.`, open: "Lade openen", later: "Later" };
  }
  return {
    title: "메모가 서랍으로 옮겨 갔어요",
    message: `메모 탭에 있던 메모 ${sheetCount(memoCount, lang)}은 서랍의 ‘메모’ 폴더에 그대로 있어요. ${key ? `${key} 키나 ` : ""}노트 위의 서랍 버튼으로 열어요.`,
    open: "서랍 열기", later: "나중에",
  };
}
