import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { bigDrawerWidth, characterCount, characterWords } from "../src/core/memoCards";

// #113: 크게 보기's width and letter count — the shared cases W1… C1… N1… of docs/plans/drawer-big-cases.json (the Mac's
// MemoDrawerTests.swift reads the same file).

interface WidthCase { id: string; about: string; user: number; screen: number; chrome: number; expect: number }
interface CountCase { id: string; about: string; text: string; expect: number }
interface WordsCase { id: string; count: number; ko: string; en: string; nl: string }
const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "drawer-big-cases.json"), "utf8")) as { width: WidthCase[]; count: CountCase[]; words: WordsCase[] };

for (const entry of file.width) test(`${entry.id} ${entry.about}`, () => assert.equal(bigDrawerWidth(entry.user, entry.screen, entry.chrome), entry.expect));
for (const entry of file.count) test(`${entry.id} ${entry.about}`, () => assert.equal(characterCount(entry.text), entry.expect));
for (const entry of file.words) {
  test(`${entry.id} ${entry.count}`, () => {
    for (const lang of ["ko", "en", "nl"] as const) assert.equal(characterWords(entry.count, lang), entry[lang]);
  });
}
