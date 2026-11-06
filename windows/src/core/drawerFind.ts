import type { Lang } from "./lang";
import type { Memo } from "./memo";
import { hasLink } from "./memoCards";
import { markdownTitle } from "./memoMarkdown";
import { checklistLine, drawerFooter, drawerSearch, placementOf, pinnedView, type DrawerHit, type MemoFolders } from "./memoDrawer";

/**
 * 메모 찾기's results (#114, docs/plans/drawer-ux-plan.md B1): where to look (모든 폴더 · this folder or 고정 only), what
 * kind of memo to keep to (안 한 체크 · 링크 · 고정), the results in groups by folder, the found line brought near the start,
 * the results' dates and the footer. The same rules and shared cases (docs/plans/drawer-search-cases.json) as the Mac
 * (PaperCore MemoFolderSearch.swift `find` · `snippet`, MemoCards.foundTime, MemoFolders.searchFooter).
 */

/** 안 한 체크 (a checklist line not ticked yet) · 링크 (a web address) · 고정. */
export type SearchFilter = "open" | "link" | "pinned";
export const searchFilters: SearchFilter[] = ["open", "link", "pinned"];

/** One folder's results, its hits in the memos' order. */
export interface HitGroup { folder: string; hits: DrawerHit[] }

/** 안 한 체크: a checklist line not ticked yet. */
export const hasOpenBox = (text: string): boolean => text.split("\n").some((line) => checklistLine(line)?.checked === false);

/** What the filters read of a memo, worked out once per text (a search runs on every pause of the keys). */
const kinds = new Map<string, { text: string; open?: boolean; link?: boolean }>();
function kindOf(memo: Memo): { text: string; open?: boolean; link?: boolean } {
  let known = kinds.get(memo.id);
  if (!known || known.text !== memo.text) {
    if (kinds.size > 5000) kinds.clear();
    known = { text: memo.text };
    kinds.set(memo.id, known);
  }
  return known;
}

/**
 * 메모 찾기 (#114): `scope` undefined looks in every folder, a folder's id only there, `pinnedView` only the pinned memos.
 * The memos are kept to `filters` (all of them), then searched as drawerSearch does; with no query the filters alone pick
 * them (each with its title, nothing marked), and with neither there is nothing. The hits come in groups, one per
 * folder, the folders in the order their first hit comes (the newest first), each group's hits in the memos' order.
 */
export function drawerFind(data: MemoFolders, memos: readonly Memo[], query: string, scope: string | undefined, filters: readonly SearchFilter[], lang: Lang = "ko"): HitGroup[] {
  const typed = query.trim() !== "";
  if (!typed && filters.length === 0) return [];
  const allowed = (memo: Memo): boolean => {
    const place = placementOf(data, memo.id);
    if (scope === pinnedView ? !place.pinned : scope !== undefined && place.folder !== scope) return false;
    if (filters.includes("pinned") && !place.pinned) return false;
    if (filters.includes("open")) { const kind = kindOf(memo); kind.open ??= hasOpenBox(memo.text); if (!kind.open) return false; }
    if (filters.includes("link")) { const kind = kindOf(memo); kind.link ??= hasLink(memo.text); if (!kind.link) return false; }
    return true;
  };
  const everywhere = scope === undefined && filters.length === 0;
  const hits: DrawerHit[] = typed
    ? drawerSearch(data, memos, query, lang, everywhere ? undefined : allowed)
    : memos.filter(allowed).map((memo) => ({ memo, ...placementOf(data, memo.id), text: markdownTitle(memo.text, lang) }));
  const groups: HitGroup[] = [];
  const at = new Map<string, HitGroup>();
  for (const hit of hits) {
    const group = at.get(hit.folder);
    if (group) group.hits.push(hit);
    else { const made = { folder: hit.folder, hits: [hit] }; at.set(hit.folder, made); groups.push(made); }
  }
  return groups;
}

/**
 * The found line as a result shows it (#114): a match far into a long line is brought near the start — cut 8 letters
 * before it (at the first space there, so a word isn't halved) with "…" in front, its range moved with it; a match within
 * the first 16 letters leaves the line as it is. The end is cut by the result's own lines. Letters are counted as code
 * points (the Mac's Unicode scalars); the range is in UTF-16 units, as matchRange gives it.
 */
export function hitSnippet(text: string, range?: [number, number]): { text: string; range?: [number, number] } {
  if (!range) return { text };
  const letters = [...text];
  let units = 0, start = -1, end = -1;
  letters.forEach((letter, index) => {
    if (units === range[0]) start = index;
    if (units === range[1]) end = index;
    units += letter.length;
  });
  if (units === range[1]) end = letters.length;
  if (start <= 16 || end < start) return { text, range };
  let cut = start - 8;
  const space = letters.slice(cut, start).indexOf(" ");
  if (space >= 0) cut += space + 1;
  const before = letters.slice(cut, start).join("").length + 1;
  return { text: `…${letters.slice(cut).join("")}`, range: [before, before + letters.slice(start, end).join("").length] };
}

/**
 * Search with its results in folders (#114): "찾은 메모 네 장 · 폴더 3개" · "4 notes found · 3 folders" · "4 notities
 * gevonden · 3 mappen"; one folder (or none) just the count.
 */
export function searchFooterWords(count: number, folders: number, lang: Lang = "ko"): string {
  const found = drawerFooter("search", count, "", lang);
  if (folders <= 1) return found;
  if (lang === "en") return `${found} · ${folders} ${folders === 1 ? "folder" : "folders"}`;
  if (lang === "nl") return `${found} · ${folders} ${folders === 1 ? "map" : "mappen"}`;
  return `${found} · 폴더 ${folders}개`;
}
