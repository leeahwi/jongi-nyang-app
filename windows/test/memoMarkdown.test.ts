import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { cardTitle, memoKind, previewRows } from "../src/core/memoCards";
import { drawerSearch, emptyMemoFolders } from "../src/core/memoDrawer";
import { markdownLines, markdownPlain, markdownSpans, markdownTitle, type MarkSpan } from "../src/core/memoMarkdown";

// 메모 마크다운 (#84): the shared cases from docs/plans/memo-markdown-cases.json (the Mac's test-markdown.sh reads the
// same file) — every case's spans, its words without marks, and its card title, preview rows and kind when given.

interface Case {
  id: string; about: string; text: string; spans: MarkSpan[]; plain: string; title?: string; preview?: string[];
  kind?: { label?: string; link?: string; phone?: string; checklist?: string } | null;
}
const fixturePath = path.resolve(process.cwd(), "..", "docs", "plans", "memo-markdown-cases.json");
const cases = (JSON.parse(fs.readFileSync(fixturePath, "utf8")) as { cases: Case[] }).cases;
const memo = (text: string) => ({ id: "m", text, createdAt: "2026-10-30T00:00:00Z", updatedAt: "2026-10-30T00:00:00Z" });

for (const entry of cases) {
  test(`${entry.id} ${entry.about}`, () => {
    const spans = markdownSpans(entry.text).map((span) => (span.level === undefined ? span : { ...span }));
    assert.deepEqual(spans, entry.spans.map((span) => ({ kind: span.kind, from: span.from, to: span.to, ...(span.level !== undefined ? { level: span.level } : {}) })));
    assert.equal(markdownPlain(entry.text), entry.plain);
    if (entry.title !== undefined) assert.equal(cardTitle(memo(entry.text)), entry.title);
    if (entry.preview !== undefined) assert.deepEqual(previewRows(entry.text).map((row) => row.text), entry.preview);
    if (entry.kind !== undefined) {
      const kind = memoKind(entry.text);
      if (entry.kind === null) assert.equal(kind, undefined);
      else if (entry.kind.link !== undefined) assert.deepEqual(kind?.kind === "link" ? { label: kind.label, link: kind.url } : kind, { label: entry.kind.label, link: entry.kind.link });
      else if (entry.kind.phone !== undefined) assert.deepEqual(kind, { kind: "phone", number: entry.kind.phone });
      else if (entry.kind.checklist !== undefined) assert.equal(kind?.kind === "checklist" ? `${kind.done}/${kind.total}` : kind, entry.kind.checklist);
    }
  });
}

test("every span lies in the text, and the marks never cover the words they mark", () => {
  for (const entry of cases) {
    for (const span of markdownSpans(entry.text)) {
      assert.ok(span.from >= 0 && span.from <= span.to && span.to <= entry.text.length, `${entry.id} ${span.kind} ${span.from}-${span.to}`);
    }
  }
});

test("search finds a word inside marks, and shows the line without them", () => {
  const memos = [memo("회의\n**보고서** 내기")];
  const hits = drawerSearch(emptyMemoFolders(), memos, "보고서");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].text, "보고서 내기");
  assert.deepEqual(hits[0].range, [0, 3]);
});

test("lines read one at a time carry the code block (the editors restyle only the lines they touch)", () => {
  const kinds = [...markdownLines("a\n```\n# b\n```\n# c")].map((line) => line.read.kind);
  assert.deepEqual(kinds, ["text", "fence", "code", "fence", "heading"]);
});

test("a title with only marks falls to the next line with words; none: the empty memo's name", () => {
  assert.equal(markdownTitle("---\n\n**제목**"), "제목");
  assert.equal(markdownTitle("```\n```", "en"), "Empty note");
});
