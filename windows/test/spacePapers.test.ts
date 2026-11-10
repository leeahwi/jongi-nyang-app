import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// #332: by space, the ruled papers draw inside the columns and cards (as the Mac's #328), never under the whole list.
const css = (file: string) => fs.readFileSync(path.join(process.cwd(), "src/renderer", file), "utf8");

test("space papers (#332): the whole-list grid and 원고지 skip a list by space, whose rows and columns carry the pattern", () => {
  const papers = css("papers.css");
  for (const paper of ["grid", "manuscript"]) {
    assert.match(papers, new RegExp(`:root\\[data-paper="${paper}"\\] \\.lines:not\\(\\.grouped\\):not\\(\\.spaced\\), :root\\[data-paper="${paper}"\\] \\.lines-fill \\{`), paper);
    assert.match(papers, new RegExp(`:root\\[data-paper="${paper}"\\] \\.lines\\.spaced:not\\(\\.board\\) \\.sgroup-rows > \\.row:not\\(\\.selected\\)`), `${paper} rows`);
    assert.match(papers, new RegExp(`:root\\[data-paper="${paper}"\\] \\.lines\\.cards > \\.lines-fill`), `${paper}: nothing around the cards`);
  }
  // 칸 보기: the grid lies under the column below its head; 원고지 goes on in the column's empty part.
  assert.match(papers, /:root\[data-paper="grid"\] \.lines\.board > \.sgroup \{[^}]*background-position: 16px 38px/);
  assert.match(papers, /:root\[data-paper="manuscript"\] \.lines\.board > \.sgroup::after \{[^}]*height='36'/);
});

test("space papers (#332): a column's rules go on to its bottom, every line ending on one", () => {
  const note = css("note.css");
  assert.match(note, /\.lines\.board > \.sgroup::after \{ content: ""; flex: 1 1 0;[^}]*repeating-linear-gradient\(to bottom, transparent 0, transparent 35px, var\(--rule\) 35px, var\(--rule\) 36px\)/);
  assert.match(note, /\.lines\.board \.sgroup-done, \.lines\.board \.sgroup-add \{ height: 36px;/);
  assert.doesNotMatch(note, /\.lines\.board \.sgroup-rows > \.row:last-child \{ background-image: none; \}/);
});
