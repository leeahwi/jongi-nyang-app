import type { AiItem } from "../../src/core/ai";
import { dateKey } from "../../src/core/calendar";
import type { Lang } from "../../src/core/lang";
import { memoPreview, memoTitle, newMemo, type Memo } from "../../src/core/memo";
import { folderName, inboxID, placeNew, placementOf, visibleFolders, type MemoFolder, type MemoFolders } from "../../src/core/memoDrawer";
import { Ids } from "./ids";
import { page, pageNote, type PageArgs } from "./pages";
import { Problem } from "./problem";
import { logged, lower, pick, type Ctx, type Reply } from "./tools";
import { count, dayText, localStamp, say } from "./words";
import { memoUri } from "./resources";

/**
 * 메모 서랍 for Claude (N2, docs/plans/mcp-plan.md): memos with their folder and 고정, one memo's whole text
 * (as written: the app's markdown, no 4,000-character cut — a very long one in parts), the folders, and a new
 * memo put into a folder. memo-folders.json is the apps' own file (memoDrawer.ts); a memo put into a folder
 * goes into memos.json and its place into memo-folders.json in one write (#110). The log keeps the memo
 * only, as before, so undo in either app takes the memo out; its place is left pointing at nothing, which
 * no drawer shows, and the apps drop it at their next save of the folders (D6).
 */

/** A memo's text is read in parts of this many characters (get_memo's offset goes on). */
export const memoPart = 5000;
const maxMemo = 4000;
const memoPages = [20, 100] as const;
/** The apps that write memo-folders.json alongside the extension (ai-link.json's ext, I1). */
const foldersFromExt = 2;

const preview = (memo: Memo): string => { const text = memoPreview(memo); return text.length > 120 ? `${text.slice(0, 120)}…` : text; };

/** The folder a name or id names: the exact name (any case; 메모 in any of the app's languages) or the id. */
function findFolder(data: MemoFolders, given: string, lang: Lang): MemoFolder {
  const folders = visibleFolders(data);
  const key = lower(given);
  const named = folders.filter((folder) => lower(folderName(folder, lang)) === key || lower(folder.name) === key || (folder.id === inboxID && key === inboxID));
  if (named.length === 1) return named[0];
  const ids = new Ids(folders.map((folder) => folder.id));
  const list = (some: MemoFolder[]) => some.map((folder) => `‘${folderName(folder, lang)}’ (id ${ids.short(folder.id)})`).join(", ");
  if (named.length > 1) throw new Problem(say(lang, `이름이 ‘${given}’인 폴더가 여럿이에요: ${list(named)}. id로 골라 주세요.`, `More than one folder is called ‘${given}’: ${list(named)}. Pick one by its id.`, `Meer dan één map heet ‘${given}’: ${list(named)}. Kies er een met de id.`));
  const found = ids.find(given);
  if (found && "id" in found) return folders.find((folder) => folder.id === found.id)!;
  throw new Problem(say(lang,
    `‘${given}’ 폴더가 없어요. 있는 폴더: ${list(folders)}. 폴더는 종이냥에서 만들어 주세요.`,
    `There is no folder ‘${given}’. Folders: ${list(folders)}. Make new folders in 종이냥 itself.`,
    `Er is geen map ‘${given}’. Mappen: ${list(folders)}. Maak nieuwe mappen in 종이냥 zelf.`));
}

/** A memo as list_memos and get_memo give it (memoOut in schemas.ts). */
function memoData(memo: Memo, data: MemoFolders, ids: Ids, lang: Lang): Record<string, unknown> {
  const place = placementOf(data, memo.id);
  const folder = data.folders.find((entry) => entry.id === place.folder);
  return {
    id: ids.short(memo.id), title: memoTitle(memo, lang), chars: memo.text.length,
    folder: folder ? folderName(folder, lang) : folderName({ id: inboxID, name: "", color: "", order: 0, updatedAt: "" }, lang), pinned: place.pinned,
    createdAt: localStamp(new Date(memo.createdAt)), updatedAt: localStamp(new Date(memo.updatedAt)),
  };
}

const charsText = (chars: number, lang: Lang) => say(lang, `${count(chars, lang)}자`, `${count(chars, lang)} characters`, `${count(chars, lang)} tekens`);
const pinnedText = (lang: Lang) => say(lang, "고정", "pinned", "vastgezet");
const folderText = (name: string, lang: Lang) => say(lang, `${name} 폴더`, `folder ${name}`, `map ${name}`);

export function listMemos(ctx: Ctx, args: { query?: string; folder?: string; pinned?: boolean } & PageArgs = {}): Reply {
  const { folder: files, lang } = ctx;
  const memos = files.load("memos.json");
  const data = files.loadLoose("memo-folders.json");
  const only = args.folder?.trim() ? findFolder(data, args.folder, lang) : undefined;
  const query = lower(args.query ?? "");
  const found = memos.filter((memo) => {
    if (!memo.text.trim() || (query && !memo.text.toLowerCase().includes(query))) return false;
    const place = placementOf(data, memo.id);
    if (only && place.folder !== only.id) return false;
    return args.pinned === undefined || place.pinned === args.pinned;
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const shown = page(found, args, memoPages[0], memoPages[1], lang);
  const ids = new Ids(memos.map((memo) => memo.id));
  const line = (memo: Memo) => {
    const place = placementOf(data, memo.id);
    const text = preview(memo);
    const where = place.folder !== inboxID && !only ? folderText(folderName(data.folders.find((entry) => entry.id === place.folder)!, lang), lang) : undefined;
    return [`- ${memoTitle(memo, lang)}${text ? ` — ${text}` : ""}`, ...(place.pinned ? [pinnedText(lang)] : []), ...(where ? [where] : []),
      dayText(dateKey(new Date(memo.updatedAt)), lang), ...(memo.text.length > 600 ? [charsText(memo.text.length, lang)] : []), `id ${ids.short(memo.id)}`].join(" · ");
  };
  const heading = say(lang, `메모 ${found.length}개`, `${found.length} ${found.length === 1 ? "memo" : "memos"}`, `${found.length} ${found.length === 1 ? "notitie" : "notities"}`);
  const note = pageNote(shown, lang);
  return {
    text: [only ? `${heading} (${folderText(folderName(only, lang), lang)})` : heading, ...shown.shown.map(line), ...(note ? [note] : [])].join("\n"),
    data: {
      count: found.length, ...(only ? { folder: folderName(only, lang) } : {}),
      memos: shown.shown.map((memo) => ({ ...memoData(memo, data, ids, lang), preview: preview(memo) })),
      ...(shown.next ? { nextCursor: shown.next } : {}),
    },
    // C2-2: each memo shown as a link the client can attach whole.
    links: shown.shown.map((memo) => ({ uri: memoUri(ids.short(memo.id)), name: memoTitle(memo, lang), mimeType: "text/markdown" })),
  };
}

/** Where a part of `text` from `offset` ends: `memoPart` on, at a line's end when there is one in its last fifth, never inside a surrogate pair. */
function partEnd(text: string, offset: number): number {
  if (text.length - offset <= memoPart) return text.length;
  let end = offset + memoPart;
  const lineEnd = text.lastIndexOf("\n", end - 1);
  if (lineEnd >= offset + memoPart * 0.8) end = lineEnd + 1;
  const code = text.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) end -= 1;
  return end;
}

export function getMemo(ctx: Ctx, args: { id: string; offset?: number }): Reply {
  const { folder: files, lang } = ctx;
  const memos = files.load("memos.json");
  const data = files.loadLoose("memo-folders.json");
  const ids = new Ids(memos.map((memo) => memo.id));
  const byId = new Map(memos.map((memo) => [memo.id, memo]));
  const memo = byId.get(pick(ids, args.id, lang, "memo", (id) => memoTitle(byId.get(id)!, lang)))!;
  const offset = Math.max(0, Math.floor(args.offset ?? 0));
  if (offset > memo.text.length) throw new Problem(say(lang, `이 메모는 ${count(memo.text.length, lang)}자예요. offset을 그보다 작게 주세요.`, `This memo has ${count(memo.text.length, lang)} characters. Give a smaller offset.`, `Deze notitie heeft ${count(memo.text.length, lang)} tekens. Geef een kleinere offset.`));
  const end = partEnd(memo.text, offset);
  const part = memo.text.slice(offset, end);
  const place = placementOf(data, memo.id);
  const summary = memoData(memo, data, ids, lang);
  const head = [say(lang, "메모", "Memo", "Notitie"), memoTitle(memo, lang), folderText(String(summary.folder), lang), ...(place.pinned ? [pinnedText(lang)] : []),
    dayText(dateKey(new Date(memo.updatedAt)), lang), charsText(memo.text.length, lang), `id ${ids.short(memo.id)}`].join(" · ");
  const partLine = offset > 0 || end < memo.text.length
    ? say(lang, `${count(offset + 1, lang)}–${count(end, lang)}자째`, `characters ${count(offset + 1, lang)}–${count(end, lang)}`, `tekens ${count(offset + 1, lang)}–${count(end, lang)}`)
    : undefined;
  const more = end < memo.text.length
    ? say(lang, `… 이어 읽으려면 get_memo offset ${end}`, `… read on with get_memo offset ${end}`, `… lees verder met get_memo offset ${end}`)
    : undefined;
  return {
    text: [partLine ? `${head} · ${partLine}` : head, "", part, ...(more ? ["", more] : [])].join("\n"),
    data: { ...summary, offset, text: part, ...(end < memo.text.length ? { nextOffset: end } : {}) },
    links: [{ uri: memoUri(ids.short(memo.id)), name: memoTitle(memo, lang), mimeType: "text/markdown" }],
  };
}

export function listMemoFolders(ctx: Ctx): Reply {
  const { folder: files, lang } = ctx;
  const memos = files.load("memos.json").filter((memo) => memo.text.trim());
  const data = files.loadLoose("memo-folders.json");
  const folders = visibleFolders(data);
  const ids = new Ids(folders.map((folder) => folder.id));
  const counts = new Map<string, { memos: number; pinned: number }>();
  for (const memo of memos) {
    const place = placementOf(data, memo.id);
    const entry = counts.get(place.folder) ?? { memos: 0, pinned: 0 };
    entry.memos += 1;
    if (place.pinned) entry.pinned += 1;
    counts.set(place.folder, entry);
  }
  const rows = folders.map((folder) => ({ folder, ...(counts.get(folder.id) ?? { memos: 0, pinned: 0 }) }));
  const pinned = rows.reduce((sum, row) => sum + row.pinned, 0);
  const lines = [say(lang, `메모 폴더 ${rows.length}개 · 고정 ${pinned}장`, `${rows.length} memo ${rows.length === 1 ? "folder" : "folders"} · ${pinned} pinned`, `${rows.length} ${rows.length === 1 ? "notitiemap" : "notitiemappen"} · ${pinned} vastgezet`),
    ...rows.map((row) => [`- ${folderName(row.folder, lang)}`, say(lang, `${row.memos}장`, `${row.memos} ${row.memos === 1 ? "memo" : "memos"}`, `${row.memos} ${row.memos === 1 ? "notitie" : "notities"}`),
      ...(row.pinned ? [`${pinnedText(lang)} ${row.pinned}`] : []), `id ${ids.short(row.folder.id)}`].join(" · "))];
  return {
    text: lines.join("\n"),
    data: { pinned, folders: rows.map((row) => ({ id: ids.short(row.folder.id), name: folderName(row.folder, lang), color: row.folder.color, memos: row.memos, pinned: row.pinned })) },
  };
}

export function addMemo(ctx: Ctx, args: { text: string; folder?: string }): Reply {
  const { folder: files, now, lang } = ctx;
  const text = (args.text ?? "").replace(/\r\n/g, "\n").trim();
  if (!text) throw new Problem(say(lang, "메모가 비어 있어요.", "The memo is empty.", "De notitie is leeg."));
  if (text.length > maxMemo) throw new Problem(say(lang, "메모는 4,000자까지예요.", "A memo can be at most 4,000 characters.", "Een notitie mag hoogstens 4.000 tekens zijn."));
  const asked = args.folder?.trim();
  // The folder is checked before anything is written: on the file as it is, and again inside the write.
  const target = asked ? findFolder(files.loadLoose("memo-folders.json"), asked, lang) : undefined;
  const placed = target && target.id !== inboxID;
  // M41: an app from before the extension version that writes memo-folders.json isn't sent one.
  if (placed && ctx.appExt < foldersFromExt) {
    throw new Problem(say(lang,
      "종이냥 앱이 이 확장보다 옛 판이라 폴더에 넣지 않았어요. 앱을 새 판으로 올리거나, 폴더 없이 넣어 주세요.",
      "종이냥 is older than this extension, so the memo wasn’t put into a folder. Update the app, or add it without a folder.",
      "종이냥 is ouder dan deze extensie, dus de notitie is niet in een map gezet. Werk de app bij, of voeg hem toe zonder map."));
  }
  const memo: Memo = { ...newMemo(now), text };
  const files_ = placed ? ["memos.json", "memo-folders.json"] as const : ["memos.json"] as const;
  type Result = { added?: Memo; existing?: Memo; all: Memo[]; data?: MemoFolders };
  const { added, existing, all, data } = files.updateAll([...files_], (lists): { changed: boolean; result: Result } => {
    const list = lists["memos.json"]!;
    const folders = lists["memo-folders.json"];
    const existing = list.find((entry) => entry.text.trim() === text);
    if (existing) return { changed: false, result: { added: undefined, existing, all: list, data: folders } };
    if (placed) {
      // Deleted in an app meanwhile: refused as any unknown folder.
      const current = findFolder(folders!, target.id, lang);
      lists["memo-folders.json"] = placeNew(folders!, memo.id, { folder: current.id, pinned: false }, now);
    }
    list.unshift({ ...memo });
    return { changed: true, result: { added: memo, existing: undefined, all: [...list], data: lists["memo-folders.json"] } };
  });
  const ids = new Ids(all.map((entry) => entry.id));
  const shownData = data ?? files.loadLoose("memo-folders.json");
  if (existing) {
    return { text: `${say(lang, "같은 메모가 이미 있어요.", "The same memo is already there.", "Dezelfde notitie staat er al.")} id ${ids.short(existing.id)}`, data: { added: null, skipped: { reason: "duplicate", id: ids.short(existing.id) } } };
  }
  logged(ctx, "add_memo", "add", "memos", [{ file: "memos.json", id: added!.id, before: null, after: added as unknown as AiItem }]);
  const summary = memoData(added!, shownData, ids, lang);
  return {
    text: `${say(lang, "메모를 남겼어요:", "Left a memo:", "Notitie achtergelaten:")} ${memoTitle(added!, lang)}${placed ? ` · ${folderText(String(summary.folder), lang)}` : ""} · id ${ids.short(added!.id)}`,
    data: { added: summary },
  };
}
