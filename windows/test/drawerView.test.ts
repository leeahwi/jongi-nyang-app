import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { duplicateFolder, mergeMemoFolders, parseMemoFolders, serializeMemoFolders, setFolderView, viewOf, type FolderView } from "../src/core/memoDrawer";

// #115: a folder's 보기 in memo-folders.json — the shared cases V1… of docs/plans/drawer-view-cases.json (the Mac's
// MemoDrawerTests.swift reads the same file).

interface ViewCase {
  id: string; about: string; input: string[]; expect: string[]; views: Record<string, FolderView>;
  op: null | { setView?: [string, FolderView]; merge?: string[]; duplicate?: [string, string] };
}
const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "drawer-view-cases.json"), "utf8")) as { now: string; cases: ViewCase[] };
const now = new Date(file.now);
const text = (lines: string[]) => `${lines.join("\n")}\n`;

for (const entry of file.cases) {
  test(`${entry.id} ${entry.about}`, () => {
    let data = parseMemoFolders(text(entry.input));
    if (entry.op?.setView) data = setFolderView(data, entry.op.setView[0], entry.op.setView[1], now);
    if (entry.op?.merge) data = mergeMemoFolders(data, parseMemoFolders(text(entry.op.merge)));
    if (entry.op?.duplicate) data = duplicateFolder(data, entry.op.duplicate[0], entry.op.duplicate[1], [], "ko", now);
    assert.equal(serializeMemoFolders(data), text(entry.expect));
    for (const [id, view] of Object.entries(entry.views)) assert.equal(viewOf(data.folders.find((folder) => folder.id === id && !folder.deleted)), view, `view of ${id}`);
  });
}
