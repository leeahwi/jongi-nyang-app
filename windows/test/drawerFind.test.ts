import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { drawerFind, hitSnippet, searchFooterWords, type SearchFilter } from "../src/core/drawerFind";
import { foundTime } from "../src/core/memoCards";
import { parseMemoFolders, pinnedView } from "../src/core/memoDrawer";
import { matchRange } from "../src/core/search";

// #114: 메모 찾기's results by folder, scope and filters; the found line; the times; the footer — the shared cases F1… P1…
// T1… R1… of docs/plans/drawer-search-cases.json (the Mac's MemoDrawerTests.swift reads the same file).

interface FindCase { id: string; about: string; query: string; scope: null | "pinned" | { folder: string }; filters: SearchFilter[]; expect: { folder: string; ids: string[] }[] }
interface SnippetCase { id: string; about: string; line: string; query: string; expect: string; mark: string }
interface TimeCase { id: string; about: string; at: string; ko: string; en: string; nl: string }
interface FooterCase { id: string; count: number; folders: number; ko: string; en: string; nl: string }
const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "drawer-search-cases.json"), "utf8")) as {
  folders: unknown; memos: { id: string; text: string; updatedAt: string }[]; cases: FindCase[]; snippets: SnippetCase[]; now: string; times: TimeCase[]; footer: FooterCase[];
};
const folders = parseMemoFolders(JSON.stringify(file.folders));
const memos = file.memos.map((memo) => ({ ...memo, createdAt: memo.updatedAt }));

for (const entry of file.cases) {
  test(`${entry.id} ${entry.about}`, () => {
    const scope = entry.scope === null ? undefined : entry.scope === "pinned" ? pinnedView : entry.scope.folder;
    // Twice: the second search reads what the first kept.
    for (let round = 0; round < 2; round += 1) {
      const groups = drawerFind(folders, memos, entry.query, scope, entry.filters, "ko");
      assert.deepEqual(groups.map((group) => ({ folder: group.folder, ids: group.hits.map((hit) => hit.memo.id) })), entry.expect);
    }
  });
}

for (const entry of file.snippets) {
  test(`${entry.id} ${entry.about}`, () => {
    const shown = hitSnippet(entry.line, matchRange(entry.line, entry.query));
    assert.equal(shown.text, entry.expect);
    assert.equal(shown.range ? shown.text.slice(shown.range[0], shown.range[1]) : undefined, entry.mark);
  });
}

for (const entry of file.times) {
  test(`${entry.id} ${entry.about}`, () => {
    for (const lang of ["ko", "en", "nl"] as const) assert.equal(foundTime(new Date(entry.at), new Date(file.now), lang), entry[lang]);
  });
}

for (const entry of file.footer) {
  test(`${entry.id} ${entry.count} · ${entry.folders}`, () => {
    for (const lang of ["ko", "en", "nl"] as const) assert.equal(searchFooterWords(entry.count, entry.folders, lang), entry[lang]);
  });
}
