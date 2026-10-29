import { dayKey } from "./archive";
import { readIntent, type Candidate, type IntentPrefer } from "./intent";
import type { Lang } from "./lang";
import { folderColors, shownColor, type FolderColor } from "./memoDrawer";
import { isoDate } from "./notebook";

/**
 * 할 일 스페이스 (1.30): to-dos split into a few spaces (회사 · 집 · 공부) without splitting the day — 오늘 still
 * shows them all, each with a small colour band, and the header can show one space for the rest of the day.
 * Which space a to-do is in lives beside todos.json in todo-spaces.json (an older version that saves
 * todos.json drops keys it doesn't know, so the place can't live on the to-do). The same file, rules and
 * cases (S1–S22, docs/plans/spaces-phase1.md) as the macOS app:
 *
 *   { "items": { "<todo id>": { "at": "…", "space": "s-7f3a9c" | null } },
 *     "spaces": [{ "color": "pink", "id": "s-7f3a9c", "name": "회사", "order": 0, "updatedAt": "…" }, …],
 *     "version": 1 }
 *
 * A to-do without an entry has no space; `space: null` is a move to 스페이스 없음 (kept so it wins a merge).
 * A deleted space stays as a tombstone for 30 days. Keys this version doesn't know are kept where they were.
 */

export const todoSpacesFileName = "todo-spaces.json";
export const spaceColors = folderColors;
export type SpaceColor = FolderColor;
/** A colour as drawn: a key the app doesn't know is kept in the file and drawn lavender. */
export const spaceColor = (color: string): SpaceColor => shownColor(color);

export type Extra = Record<string, unknown>;
export interface TodoSpace {
  id: string; name: string; /** A SpaceColor; an unknown key is kept as written. */ color: string; order: number; updatedAt: string; deleted?: boolean;
  extra?: Extra;
}
export interface SpacePlace { space: string | null; at: string; extra?: Extra }
export interface TodoSpaces { version: number; spaces: TodoSpace[]; items: Record<string, SpacePlace>; extra?: Extra }

const epoch = "1970-01-01T00:00:00Z";
const keepDays = 30;
const day = 86_400_000;

export const emptyTodoSpaces = (): TodoSpaces => ({ version: 1, spaces: [], items: {} });

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);
/** A time as both apps write it: UTC to the second; one that doesn't read is the epoch. */
function readTime(value: unknown): string {
  if (typeof value !== "string") return epoch;
  const time = Date.parse(value);
  return Number.isNaN(time) ? epoch : isoDate(new Date(Math.floor(time / 1000) * 1000));
}
function extraOf(entry: Json, known: readonly string[]): Extra | undefined {
  const extra = Object.fromEntries(Object.entries(entry).filter(([key]) => !known.includes(key)));
  return Object.keys(extra).length ? extra : undefined;
}
const fileKeys = ["version", "spaces", "items"];
const spaceKeys = ["id", "name", "color", "order", "updatedAt", "deleted"];
const placeKeys = ["space", "at"];

/** A space's name as kept: one line, trimmed, at most 40 characters (as a memo folder's). */
export function cleanSpaceName(name: string): string {
  return [...name.replace(/[\r\n]+/g, " ").trim()].slice(0, 40).join("").trim();
}

/**
 * The file read: throws when it isn't the spaces file at all (S21: kept aside, started afresh). Entries it
 * can't use are left out; everything else, unknown keys too, is kept as read.
 */
export function parseTodoSpaces(text: string): TodoSpaces {
  const value = JSON.parse(text) as unknown;
  if (!isObject(value) || (value.spaces !== undefined && !Array.isArray(value.spaces)) || (value.items !== undefined && !isObject(value.items))) throw new Error("not a todo-spaces file");
  const spaces: TodoSpace[] = [];
  const seen = new Set<string>();
  ((value.spaces as unknown[] | undefined) ?? []).forEach((entry, index) => {
    if (!isObject(entry) || typeof entry.id !== "string" || !entry.id || seen.has(entry.id) || typeof entry.name !== "string") return;
    seen.add(entry.id);
    const extra = extraOf(entry, spaceKeys);
    spaces.push({
      id: entry.id, name: entry.name, color: typeof entry.color === "string" ? entry.color : "lavender",
      order: typeof entry.order === "number" && Number.isFinite(entry.order) ? entry.order : index,
      updatedAt: readTime(entry.updatedAt),
      ...(entry.deleted === true ? { deleted: true } : {}),
      ...(extra ? { extra } : {}),
    });
  });
  const items: Record<string, SpacePlace> = {};
  for (const [id, entry] of Object.entries((value.items as Json | undefined) ?? {})) {
    if (!isObject(entry) || !(entry.space === null || (typeof entry.space === "string" && entry.space))) continue;
    const extra = extraOf(entry, placeKeys);
    items[id] = { space: entry.space as string | null, at: readTime(entry.at), ...(extra ? { extra } : {}) };
  }
  const extra = extraOf(value, fileKeys);
  const version = typeof value.version === "number" && Number.isFinite(value.version) ? value.version : 1;
  return { version, spaces, items, ...(extra ? { extra } : {}) };
}

// ─── Writing: the same bytes as the Mac (spec W2) ────────────────────────────

/** UTF-8 byte order, which is code point order (not UTF-16's: "\u{1F600}" sorts after "\uFFFD"). */
function utf8Order(a: string, b: string): number {
  if (a === b) return 0;
  const x = [...a], y = [...b];
  for (let index = 0; index < Math.min(x.length, y.length); index += 1) {
    const difference = x[index].codePointAt(0)! - y[index].codePointAt(0)!;
    if (difference) return difference;
  }
  return x.length - y.length;
}
const byOrder = (a: TodoSpace, b: TodoSpace) => a.order - b.order || utf8Order(a.id, b.id);

/** A JSON string: only `"`, `\` and control characters escaped (`\n` `\r` `\t` by name, others `\u00xx`). */
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

/** Any value, fully spread out: two-space indent, `"key": value`, keys sorted at every depth, `[]` / `{}` when empty. */
function pretty(value: unknown, indent: string): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "string") return jsonString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  const inner = `${indent}  `;
  if (Array.isArray(value)) return value.length ? `[\n${value.map((entry) => inner + pretty(entry, inner)).join(",\n")}\n${indent}]` : "[]";
  if (isObject(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort(utf8Order);
    return keys.length ? `{\n${keys.map((key) => `${inner}${jsonString(key)}: ${pretty(value[key], inner)}`).join(",\n")}\n${indent}}` : "{}";
  }
  return "null";
}

/** The file's text: every key sorted, spaces by order then id, to-dos by id, a newline at the end. */
export function serializeTodoSpaces(data: TodoSpaces): string {
  const spaces = [...data.spaces].sort(byOrder).map((space) => ({
    ...space.extra, id: space.id, name: space.name, color: space.color, order: space.order, updatedAt: space.updatedAt, ...(space.deleted ? { deleted: true } : {}),
  }));
  const items: Json = {};
  for (const [id, place] of Object.entries(data.items)) items[id] = { ...place.extra, space: place.space, at: place.at };
  return `${pretty({ ...data.extra, version: data.version, spaces, items }, "")}\n`;
}

// ─── Reading where things are ────────────────────────────────────────────────

/** The spaces shown, in order (deleted ones left out). */
export function liveSpaces(data: TodoSpaces): TodoSpace[] {
  return data.spaces.filter((space) => !space.deleted).sort(byOrder);
}
export const findSpace = (data: TodoSpaces, id: string | null | undefined): TodoSpace | undefined =>
  id ? data.spaces.find((space) => space.id === id && !space.deleted) : undefined;

/** A to-do's space: its entry's, when that space is live; else none (S12: the file keeps the entry). */
export function spaceOf(data: TodoSpaces, todoID: string): string | undefined {
  const place = data.items[todoID]?.space;
  return place && findSpace(data, place) ? place : undefined;
}

/**
 * Each to-do's live space, as the windows get it (AppState.spaceOf): one string of `<todo id>\t<space id>` lines, so a
 * state with 2,000 placed to-dos crosses to the windows as one copy, and a window reads it again only when it changed.
 * The file's entries themselves stay in the main process.
 */
export function packSpaceOf(data: TodoSpaces): string {
  const live = new Set(liveSpaces(data).map((space) => space.id));
  const lines: string[] = [];
  for (const [id, place] of Object.entries(data.items)) if (place.space && live.has(place.space)) lines.push(`${id}\t${place.space}`);
  return lines.join("\n");
}

/** The windows' index: to-do id → its space (from AppState's spaces and spaceOf). */
export function spaceIndexOf(spaces: readonly TodoSpace[], packed: string): Map<string, TodoSpace> {
  const live = new Map(spaces.filter((space) => !space.deleted).map((space) => [space.id, space]));
  const index = new Map<string, TodoSpace>();
  if (!packed) return index;
  for (const line of packed.split("\n")) {
    const tab = line.indexOf("\t");
    const space = live.get(line.slice(tab + 1));
    if (space) index.set(line.slice(0, tab), space);
  }
  return index;
}

/** Every to-do's live space at once (drawing 2,000 rows looks each up once). */
export function spaceIndex(data: TodoSpaces): Map<string, TodoSpace> {
  const live = new Map(liveSpaces(data).map((space) => [space.id, space]));
  const index = new Map<string, TodoSpace>();
  for (const [id, place] of Object.entries(data.items)) {
    const space = place.space ? live.get(place.space) : undefined;
    if (space) index.set(id, space);
  }
  return index;
}

// ─── Changes (each returns a new value, or the same one for nothing) ─────────

/** `s-` and six lowercase hex digits, not one the file already has. */
export function newSpaceID(data: TodoSpaces, random: () => number = Math.random): string {
  for (;;) {
    const id = `s-${Math.floor(random() * 0x1000000).toString(16).padStart(6, "0")}`;
    if (!data.spaces.some((space) => space.id === id)) return id;
  }
}

/** W6: the first of the eight colours no live space has; all taken, the one at (live count % 8). */
export function nextSpaceColor(data: TodoSpaces): SpaceColor {
  const live = liveSpaces(data);
  return spaceColors.find((color) => !live.some((space) => space.color === color)) ?? spaceColors[live.length % spaceColors.length];
}

export function addSpace(data: TodoSpaces, name: string, id: string, color: string = nextSpaceColor(data), now = new Date()): TodoSpaces {
  const clean = cleanSpaceName(name);
  if (!clean || data.spaces.some((space) => space.id === id)) return data;
  const order = Math.max(-1, ...liveSpaces(data).map((space) => space.order)) + 1;
  return { ...data, spaces: [...data.spaces, { id, name: clean, color, order, updatedAt: isoDate(now) }] };
}

const changeSpace = (data: TodoSpaces, id: string, change: (space: TodoSpace) => TodoSpace): TodoSpaces =>
  ({ ...data, spaces: data.spaces.map((space) => (space.id === id ? change(space) : space)) });

export function renameSpace(data: TodoSpaces, id: string, name: string, now = new Date()): TodoSpaces {
  const clean = cleanSpaceName(name);
  const space = findSpace(data, id);
  if (!clean || !space || space.name === clean) return data;
  return changeSpace(data, id, (entry) => ({ ...entry, name: clean, updatedAt: isoDate(now) }));
}

export function recolorSpace(data: TodoSpaces, id: string, color: string, now = new Date()): TodoSpaces {
  const space = findSpace(data, id);
  if (!space || space.color === color) return data;
  return changeSpace(data, id, (entry) => ({ ...entry, color, updatedAt: isoDate(now) }));
}

/**
 * A space deleted: a tombstone (its to-dos read as 스페이스 없음 from now on, their entries stay — S12). Returns
 * the to-dos that were in it, for 되돌리기.
 */
export function deleteSpace(data: TodoSpaces, id: string, now = new Date()): { data: TodoSpaces; todoIDs: string[] } {
  if (!findSpace(data, id)) return { data, todoIDs: [] };
  const todoIDs = Object.keys(data.items).filter((todo) => data.items[todo].space === id).sort(utf8Order);
  return { data: changeSpace(data, id, (entry) => ({ ...entry, deleted: true, updatedAt: isoDate(now) })), todoIDs };
}

/** 되돌리기 after a delete: the space live again (a new time), its to-dos in it as they were. */
export function restoreSpace(data: TodoSpaces, id: string, todoIDs: readonly string[], now = new Date()): TodoSpaces {
  if (!data.spaces.some((space) => space.id === id)) return data;
  const at = isoDate(now);
  const items = { ...data.items };
  for (const todo of todoIDs) items[todo] = { ...items[todo], space: id, at };
  return { ...changeSpace(data, id, ({ deleted: _deleted, ...rest }) => ({ ...rest, updatedAt: at })), items };
}

/** The spaces in a new order (ids top to bottom); each one whose place changed gets a new time. */
export function reorderSpaces(data: TodoSpaces, ids: readonly string[], now = new Date()): TodoSpaces {
  const shown = liveSpaces(data).map((space) => space.id);
  const order = [...ids.filter((id) => shown.includes(id)), ...shown.filter((id) => !ids.includes(id))];
  let changed = false;
  const spaces = data.spaces.map((space) => {
    const index = order.indexOf(space.id);
    if (index < 0 || space.order === index) return space;
    changed = true;
    return { ...space, order: index, updatedAt: isoDate(now) };
  });
  return changed ? { ...data, spaces } : data;
}

/** A to-do moved to a space, or to 스페이스 없음 (null: an entry, so the move wins a merge — S14). */
export function moveTodo(data: TodoSpaces, todoID: string, space: string | null, now = new Date()): TodoSpaces {
  if (space !== null && !findSpace(data, space)) return data;
  const current = data.items[todoID];
  if (current && current.space === space) return data;
  if (!current && space === null) return data; // never had one: nothing to say
  return { ...data, items: { ...data.items, [todoID]: { ...current, space, at: isoDate(now) } } };
}

/** S17, S22: entries of to-dos that are gone and tombstones, each more than 30 days old, dropped before a write. */
export function pruneTodoSpaces(data: TodoSpaces, todoIDs: ReadonlySet<string>, now = new Date()): TodoSpaces {
  const cutoff = now.getTime() - keepDays * day;
  const old = (time: string) => Date.parse(time) < cutoff;
  const gone = Object.keys(data.items).filter((id) => !todoIDs.has(id) && old(data.items[id].at));
  const tombstones = data.spaces.filter((space) => space.deleted && old(space.updatedAt));
  if (gone.length === 0 && tombstones.length === 0) return data;
  const items = { ...data.items };
  for (const id of gone) delete items[id];
  return { ...data, spaces: data.spaces.filter((space) => !tombstones.includes(space)), items };
}

/**
 * Two copies as one (S13–S15, W3): spaces by id and entries by to-do id; `incoming` wins only when strictly
 * newer, so on the same second the copy already in the file (`existing`) stays.
 */
export function mergeTodoSpaces(existing: TodoSpaces, incoming: TodoSpaces): TodoSpaces {
  const spaces = new Map(existing.spaces.map((space) => [space.id, space]));
  for (const space of incoming.spaces) {
    const other = spaces.get(space.id);
    if (!other || space.updatedAt > other.updatedAt) spaces.set(space.id, space);
  }
  const items = { ...existing.items };
  for (const [id, place] of Object.entries(incoming.items)) {
    const other = items[id];
    if (!other || place.at > other.at) items[id] = place;
  }
  const extra = existing.extra || incoming.extra ? { ...incoming.extra, ...existing.extra } : undefined;
  return { version: Math.max(existing.version, incoming.version), spaces: [...spaces.values()], items, ...(extra ? { extra } : {}) };
}

// ─── The `#` in the input line ───────────────────────────────────────────────

export interface SpaceToken { /** The words after `#`. */ name: string; start: number; end: number }

/**
 * W5: the first `#name` that starts the line or follows a space — not digits only (`#12`), not `##`; `C#`
 * and `a#b` aren't tokens. Several lines (a memo): only the first is looked at.
 */
export function findSpaceToken(text: string): SpaceToken | undefined {
  const firstLine = text.split("\n")[0];
  const pattern = /(^|[ \t])#([^\s]+)/g;
  for (let match = pattern.exec(firstLine); match; match = pattern.exec(firstLine)) {
    const name = match[2];
    if (/^[0-9]+$/.test(name) || name.startsWith("#")) continue;
    const start = match.index + match[1].length;
    return { name, start, end: start + 1 + name.length };
  }
  return undefined;
}

/** The text without the token and the one space before it. */
export function withoutToken(text: string, token: SpaceToken): string {
  const start = token.start > 0 && /[ \t]/.test(text[token.start - 1]) ? token.start - 1 : token.start;
  return text.slice(0, start) + text.slice(token.end);
}

const normal = (text: string) => text.normalize("NFC").toLowerCase().replace(/\s+/gu, "");
const initials = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"];
/** 회사 → ㅎㅅ: each syllable's first consonant, other characters as they are. */
function initialsOf(text: string): string {
  return [...text].map((character) => {
    const code = character.codePointAt(0)!;
    return code >= 0xac00 && code <= 0xd7a3 ? initials[Math.floor((code - 0xac00) / 588)] : character;
  }).join("");
}
const onlyInitials = (text: string) => /^[ㄱ-ㅎ]+$/u.test(text);

export type SpaceChoice = { kind: "space"; id: string } | { kind: "new"; name: string } | { kind: "none" };

/**
 * S1–S4, S20: the spaces a token could mean, best first — the whole name, then names it starts (space order),
 * then names whose first consonants it starts (`#ㅎㅅ`); none of these: a new space by that name. 스페이스 없음
 * always comes last (⇧Tab reaches it).
 */
export function spaceChoices(data: TodoSpaces, token: string): SpaceChoice[] {
  const typed = normal(token);
  const spaces = liveSpaces(data);
  const found: string[] = [];
  const add = (space: TodoSpace) => { if (!found.includes(space.id)) found.push(space.id); };
  for (const space of spaces) if (normal(space.name) === typed) add(space);
  for (const space of spaces) if (normal(space.name).startsWith(typed)) add(space);
  if (onlyInitials(typed)) for (const space of spaces) if (initialsOf(normal(space.name)).startsWith(typed)) add(space);
  const choices: SpaceChoice[] = found.length ? found.map((id) => ({ kind: "space", id })) : [{ kind: "new", name: cleanSpaceName(token) }];
  return [...choices, { kind: "none" }];
}

/**
 * A line read for its space: the text to read for meaning (the token taken out), the choices (⇧Tab cycles them)
 * and the token. No token: the lens's space (S7) — none while showing everything or 스페이스 없음. With no spaces
 * at all the line is read as before (S19, W13): no token, no chip.
 */
export function readSpaceLine(text: string, data: TodoSpaces, lens: string | undefined): { text: string; token?: SpaceToken; choices: SpaceChoice[] } {
  if (liveSpaces(data).length === 0) return { text, choices: [] };
  const token = findSpaceToken(text);
  if (token) return { text: withoutToken(text, token), token, choices: spaceChoices(data, token.name) };
  const space = lens && lens !== lensNone ? findSpace(data, lens) : undefined;
  return { text, choices: space ? [{ kind: "space", id: space.id }] : [] };
}

/** The whole input line (S1–S10): its readings with the token taken out, and the space choices. */
export function readLine(text: string, data: TodoSpaces, lens: string | undefined, now = new Date(), lang: Lang = "ko", prefer: IntentPrefer = {}):
  { candidates: Candidate[]; choices: SpaceChoice[]; token?: SpaceToken; text: string } {
  const line = readSpaceLine(text, data, lens);
  return { ...line, candidates: readIntent(line.text, now, lang, prefer) };
}

/** S5: a line that is only a token (`#회사`) puts nothing in; the line says why. */
export function spaceLineProblem(text: string, data: TodoSpaces, lang: Lang = "ko"): string | undefined {
  const line = readSpaceLine(text, data, undefined);
  if (!line.token || line.text.trim()) return undefined;
  return { ko: "할 일 내용을 적어 주세요", en: "Write what the to-do is", nl: "Schrijf wat de taak is" }[lang];
}

/** Only a to-do takes a space (S9): an event, timer, alarm, memo or repeat loses the token and gets none. */
export const takesSpace = (candidate: Candidate): boolean => candidate.kind === "todo";

// ─── 한 스페이스만 보기 (a device setting) ────────────────────────────────────

/** ‘스페이스 없음’만 보기 (W9). */
export const lensNone = "none";
export interface SpaceLens { spaceId: string; day: string }

export function readLens(value: unknown): SpaceLens | undefined {
  if (!isObject(value) || typeof value.spaceId !== "string" || !value.spaceId || typeof value.day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) return undefined;
  return { spaceId: value.spaceId, day: value.day };
}

/** A lens picked now: for the rest of the logical (4 a.m.) day. */
export const lensFor = (spaceId: string, now = new Date()): SpaceLens => ({ spaceId, day: dayKey(now) });

/**
 * S11, S12: the space shown — none once the 4 a.m. day has turned, when the space is gone, or when there are
 * no spaces at all (S19); "none" is 스페이스 없음.
 */
export function activeLens(lens: SpaceLens | undefined, data: TodoSpaces, now = new Date()): string | undefined {
  if (!lens || lens.day !== dayKey(now) || liveSpaces(data).length === 0) return undefined;
  if (lens.spaceId === lensNone) return lensNone;
  return findSpace(data, lens.spaceId) ? lens.spaceId : undefined;
}

/** Whether a to-do shows under the lens. */
export const inLens = (lens: string | undefined, space: string | undefined): boolean =>
  lens === undefined || (lens === lensNone ? space === undefined : space === lens);

/** W8: Ctrl+Shift+1–9 → the spaces in order, 0 → all (undefined); a digit with no space → nothing to do (null). */
export function lensForDigit(data: TodoSpaces, digit: number): string | undefined | null {
  if (digit === 0) return undefined;
  if (!Number.isInteger(digit) || digit < 1 || digit > 9) return null;
  return liveSpaces(data)[digit - 1]?.id ?? null;
}

// ─── Words ───────────────────────────────────────────────────────────────────

/** The final consonant of a word's last sound: 0 none, 8 ㄹ, else another (digits and Latin letters as read). */
function finalOf(word: string): number {
  const last = [...word.trim()].pop() ?? "";
  const code = last.codePointAt(0) ?? 0;
  if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28;
  // As both apps read them (Mac M10): 일 칠 팔 엘 알 → ㄹ; 영 삼 육 엠 엔 → another final; the rest none.
  if (/[178lr]/i.test(last)) return 8;
  if (/[036mn]/i.test(last)) return 1;
  return 0;
}
/** 회사로 · 집으로 · 서울로 (ㄹ takes 로). */
export const roParticle = (word: string): "로" | "으로" => { const final = finalOf(word); return final === 0 || final === 8 ? "로" : "으로"; };
/** 회사를 · 집을. */
export const objectParticle = (word: string): "를" | "을" => (finalOf(word) === 0 ? "를" : "을");

/** A name with 로/으로 in Korean (회사로 · 집으로), as it is in English and Dutch ("Moved to Work"). */
export const toSpaceWords = (name: string, lang: Lang = "ko"): string => (lang === "ko" ? `${name}${roParticle(name)}` : name);
/** ‘회사’를 · ‘집’을 in Korean, ‘Work’ in English and Dutch. */
export const spaceObjectWords = (name: string, lang: Lang = "ko"): string => (lang === "ko" ? `‘${name}’${objectParticle(name)}` : `‘${name}’`);
