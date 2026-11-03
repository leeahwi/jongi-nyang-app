import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { enter, heading, indent, link, moveLines, paste, rule, setLink, tick, tickAtCaret, toggleDone, toggleLines, wrap, type Edit, type LineKind } from "../src/core/memoEdits";

// 메모 서식 (#84): the shared `edits` and `done` cases of docs/plans/memo-markdown-cases.json (the Mac's
// scripts/test-markdown.sh reads the same file). In the texts ‸ is the caret and « » a selection.

interface EditCase { id: string; about: string; op: string; text: string; expect: string | null; level?: number | "cycle"; mark?: string; kind?: LineKind; pasted?: string; line?: number; move?: boolean; url?: string }
interface DoneCase { id: string; about: string; text: string; line: number; move: boolean; expect: string }
const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "memo-markdown-cases.json"), "utf8")) as { edits: EditCase[]; done: DoneCase[] };

/** The text without its markers, and where they were. */
function parse(marked: string): Edit {
  const caret = marked.indexOf("‸");
  if (caret >= 0) return { text: marked.replace("‸", ""), from: caret, to: caret };
  const from = marked.indexOf("«"), to = marked.indexOf("»") - 1;
  return { text: marked.replace("«", "").replace("»", ""), from, to };
}
const show = (edit: Edit) => (edit.from === edit.to ? `${edit.text.slice(0, edit.from)}‸${edit.text.slice(edit.from)}`
  : `${edit.text.slice(0, edit.from)}«${edit.text.slice(edit.from, edit.to)}»${edit.text.slice(edit.to)}`);

function run(entry: EditCase): Edit | undefined {
  const { text, from, to } = parse(entry.text);
  switch (entry.op) {
    case "enter": return enter(text, from, to);
    case "heading": return heading(text, from, to, entry.level!);
    case "wrap": return wrap(text, from, to, entry.mark!);
    case "line": return toggleLines(text, from, to, entry.kind!);
    case "rule": return rule(text, from, to);
    case "link": return link(text, from, to);
    case "indent": return indent(text, from, to, false);
    case "outdent": return indent(text, from, to, true);
    case "moveUp": return moveLines(text, from, to, true);
    case "moveDown": return moveLines(text, from, to, false);
    case "paste": return paste(text, from, to, entry.pasted!);
    case "tick": return tick(text, entry.line!, from, to, entry.move!);
    case "tickKey": return tickAtCaret(text, from, to, entry.move!);
    case "linkSet": return setLink(text, from, to, entry.url!);
    default: throw new Error(`unknown op ${entry.op}`);
  }
}

for (const entry of file.edits) {
  test(`${entry.id} ${entry.about}`, () => {
    const result = run(entry);
    if (entry.expect === null) assert.equal(result, undefined);
    else assert.equal(result && show(result), entry.expect);
  });
}

for (const entry of file.done) {
  test(`${entry.id} ${entry.about}`, () => assert.equal(toggleDone(entry.text, entry.line, entry.move), entry.expect));
}
