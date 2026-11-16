import { sharedFiles } from "./storage";

// #385 · #478: what two devices writing the same shared folder leave behind, and how their lists are joined — the Mac's
// rules (mac/Sources/PaperCore/SyncConflict.swift); the shared cases are shared/cases/sync-conflict-cases.json.

type Item = Record<string, unknown>;

/**
 * The data file `name` is a cloud's conflict copy of, undefined when it is none:
 * iCloud Drive `todos 2.json`, Google Drive `todos (1).json`, Dropbox `todos (… conflicted copy …).json` or
 * `(… 충돌 사본 …)`, OneDrive `todos-MINJI-PC.json` (the device's name after a hyphen).
 */
export function copyOf(name: string, files: readonly string[] = sharedFiles): string | undefined {
  const lower = name.toLowerCase();
  // A data file itself is never a copy ("memo-folders.json" isn't OneDrive's copy of a "memo.json").
  if (!lower.endsWith(".json") || files.some((file) => file.toLowerCase() === lower)) return undefined;
  const stem = name.slice(0, -5);
  for (const file of files) {
    const base = file.slice(0, -5);
    if (stem.length <= base.length || !stem.toLowerCase().startsWith(base.toLowerCase())) continue;
    const rest = stem.slice(base.length);
    if (/^ [0-9]{1,3}$/.test(rest) || /^ \([0-9]{1,3}\)$/.test(rest)) return file;
    if (/^ \(.*(conflicted copy|충돌).*\)$/i.test(rest) || /^-[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(rest)) return file;
  }
  return undefined;
}

/** The conflict copies among a folder's names, with the file each is a copy of. */
export function conflictCopies(names: readonly string[]): { name: string; of: string }[] {
  return [...names].sort().flatMap((name) => {
    const of = copyOf(name);
    return of ? [{ name, of }] : [];
  });
}

/** JSON values as equal (keys in any order; a missing field and null are the same). */
export function sameJSON(a: unknown, b: unknown): boolean {
  if (a === null) a = undefined;
  if (b === null) b = undefined;
  if (a === undefined || b === undefined) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => sameJSON(value, b[index]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const x = a as Item, y = b as Item;
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].every((key) => sameJSON(x[key], y[key]));
  }
  return a === b;
}

const idOf = (item: Item) => (typeof item.id === "string" ? item.id : undefined);

/**
 * Three lists of items (objects with an "id"): `base` as this device last read or wrote the file, `here` as it is now,
 * `theirs` as another device left it. Field by field, the side that changed a field from `base` wins; when both changed
 * it, this device's. An item one side changed and the other deleted stays (an edit is never lost to a delete); one side
 * deleted and the other left as it was goes. Items new on either side stay. The order is theirs, and an item only here
 * goes right after the item it followed here.
 */
export function mergeItems(base: readonly Item[], here: readonly Item[], theirs: readonly Item[]): Item[] {
  const byID = (list: readonly Item[]) => {
    const out = new Map<string, Item>();
    for (const item of list) { const id = idOf(item); if (id !== undefined && !out.has(id)) out.set(id, item); }
    return out;
  };
  const start = byID(base), mine = byID(here), other = byID(theirs);
  const result: Item[] = [];
  const placed = new Set<string>();
  for (const item of theirs) {
    const id = idOf(item);
    if (id === undefined || placed.has(id)) continue;
    const own = mine.get(id), was = start.get(id);
    if (own) result.push(fields(was, own, item));
    else if (was && sameJSON(was, item)) continue; // deleted here, untouched there
    else result.push(item); // new there, or changed there and deleted here
    placed.add(id);
  }
  // What is only here: new here, or changed here and deleted there (deleted there and untouched here goes).
  let after: string | undefined;
  for (const item of here) {
    const id = idOf(item);
    if (id === undefined) continue;
    const was = start.get(id);
    if (!placed.has(id) && !other.has(id) && !(was && sameJSON(was, item))) {
      const index = after === undefined ? 0 : result.findIndex((entry) => idOf(entry) === after) + 1;
      result.splice(index, 0, item);
      placed.add(id);
    }
    if (placed.has(id)) after = id;
  }
  return result;
}

/** One item both sides have: each field from the side that changed it. */
function fields(base: Item | undefined, here: Item, theirs: Item): Item {
  const out: Item = {};
  for (const key of new Set([...Object.keys(here), ...Object.keys(theirs), ...Object.keys(base ?? {})])) {
    const pick = base !== undefined && sameJSON(here[key], base[key]) ? theirs[key] : here[key];
    if (pick !== undefined && pick !== null) out[key] = pick;
  }
  return out;
}

/**
 * `mergeItems` for a file `{ "<key>": [items], … }` (`base`: as this device last read or wrote it; `here`: what it holds
 * now, as it would write it). The other fields are theirs. `theirs`: their file as it is — nothing was changed here since
 * `base` (as before #385), or the join is theirs anyway; `joined`: theirs with this device's changes in, to take in and
 * write back. Undefined when `here` or `theirs` doesn't read.
 */
export function joinFiles(base: string | undefined, here: string, theirs: string, key: string): { theirs: true } | { joined: string } | undefined {
  const read = (text: string | undefined): Item | undefined => {
    try {
      const value: unknown = text === undefined ? undefined : JSON.parse(text);
      return value && typeof value === "object" && !Array.isArray(value) ? (value as Item) : undefined;
    } catch { return undefined; }
  };
  const list = (file: Item | undefined) => (Array.isArray(file?.[key]) && (file[key] as unknown[]).every((item) => item && typeof item === "object") ? (file[key] as Item[]) : undefined);
  const mine = read(here), other = read(theirs);
  const hereItems = list(mine), theirItems = list(other);
  if (!hereItems || !theirItems) return undefined;
  const baseItems = list(read(base));
  if (baseItems && sameJSON(baseItems, hereItems)) return { theirs: true };
  const merged = mergeItems(baseItems ?? [], hereItems, theirItems);
  if (sameJSON(merged, theirItems)) return { theirs: true };
  return { joined: JSON.stringify({ ...other, [key]: merged }) };
}
