import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { bookmarkLetters } from "../src/core/memoDrawer";

// #116: the bookmarks' letters — the shared cases B1… of docs/plans/drawer-bookmark-cases.json (the Mac's
// MemoDrawerTests.swift reads the same file).

interface LettersCase { id: string; about: string; names: string[]; picked: number | null; expect: string[] }
const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "drawer-bookmark-cases.json"), "utf8")) as { cases: LettersCase[] };

for (const entry of file.cases) {
  test(`${entry.id} ${entry.about}`, () => assert.deepEqual(bookmarkLetters(entry.names, entry.picked), entry.expect));
}
