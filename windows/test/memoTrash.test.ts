import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { emptyAll, emptyQuestion, emptyTrash, mergeTrash, parseMemoTrash, pruneTrash, restoredWords, serializeMemoTrash, trashAgo, trashMemo, trashMenuLabel, untrash } from "../src/core/memoTrash";

// #120: 지운 메모 in memo-trash.json — the shared cases T1… N1… A1… R1… of docs/plans/drawer-trash-cases.json (the Mac's
// MemoDrawerTests.swift reads the same file).

type Lang3 = { ko: string; en: string; nl: string };
interface TrashOp {
  delete?: { memo: { id: string; text: string; createdAt: string; updatedAt: string }; folder: string; pinned: boolean; paper?: string };
  restore?: string; returns?: { folder: string; pinned: boolean; paper?: string; text: string; updatedAt: string };
  empty?: boolean; prune?: string[]; merge?: string[];
}
interface TrashCase { id: string; about: string; input: string[] | null; ops: TrashOp[]; expect: string[] }
const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "drawer-trash-cases.json"), "utf8")) as {
  now: string; cases: TrashCase[]; words: { id: string; count: number; menu: Lang3; question: Lang3 }[];
  ago: ({ id: string; at: string } & Lang3)[]; restored: ({ id: string; folder: string } & Lang3)[];
};
const now = new Date(file.now);
const text = (lines: string[]) => `${lines.join("\n")}\n`;

for (const entry of file.cases) {
  test(`${entry.id} ${entry.about}`, () => {
    let trash = entry.input ? parseMemoTrash(text(entry.input)) : emptyTrash();
    for (const op of entry.ops) {
      if (op.delete) trash = trashMemo(trash, op.delete.memo, { folder: op.delete.folder, pinned: op.delete.pinned, paper: op.delete.paper }, now);
      if (op.restore) {
        const back = untrash(trash, op.restore, now);
        trash = back.trash;
        assert.deepEqual({ folder: back.entry?.folder, pinned: back.entry?.pinned, paper: back.entry?.paper, text: back.entry?.memo.text, updatedAt: back.entry?.memo.updatedAt }, op.returns);
      }
      if (op.empty) trash = emptyAll(trash, now);
      if (op.prune) trash = pruneTrash(trash, new Set(op.prune), now);
      if (op.merge) trash = mergeTrash(trash, parseMemoTrash(text(op.merge)));
    }
    assert.equal(serializeMemoTrash(trash), text(entry.expect));
    assert.equal(serializeMemoTrash(parseMemoTrash(serializeMemoTrash(trash))), serializeMemoTrash(trash), "read back");
  });
}

for (const entry of file.words) {
  test(`${entry.id} ${entry.count}`, () => {
    for (const lang of ["ko", "en", "nl"] as const) {
      assert.equal(trashMenuLabel(entry.count, lang), entry.menu[lang]);
      assert.equal(emptyQuestion(entry.count, lang), entry.question[lang]);
    }
  });
}
for (const entry of file.ago) test(`${entry.id} ${entry.at}`, () => { for (const lang of ["ko", "en", "nl"] as const) assert.equal(trashAgo(entry.at, now, lang), entry[lang]); });
for (const entry of file.restored) test(`${entry.id} ${entry.folder}`, () => { for (const lang of ["ko", "en", "nl"] as const) assert.equal(restoredWords(entry.folder, lang), entry[lang]); });
