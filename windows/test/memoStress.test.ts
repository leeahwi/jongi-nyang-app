import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeMemos, parseMemos, serializeMemos, type Memo } from "../src/core/memo";
import { cardTitle, groupMemos, memoKind, previewRows } from "../src/core/memoCards";
import { checklistProgress, drawerSearch, forgetSearchLines, memosIn, parseMemoFolders, placementOf, serializeMemoFolders, slipSummary, toggleChecklist, type MemoFolders } from "../src/core/memoDrawer";
import { mergeText } from "../src/core/textMerge";
// @ts-expect-error: a plain ES module of the tools (no types)
import { memoStressData } from "../tools/memo-stress-data.mjs";

// 메모 서랍 under load (docs/perf-memo-stress.md). As a test: 2,000 memos, a 100 KB memo and a 2,000-line checklist,
// each core step under a generous ceiling (about 5–10× what a Mac measures). `MEMO_BENCH=1 node --test
// out-test/memoStress.test.js` prints the timings of every tier instead (50 · 500 · 2,000 · 5,000 and long).

type Stress = { memos: Memo[]; folders: unknown };
const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function time(runs: number, work: () => void): number {
  const all: number[] = [];
  for (let run = 0; run < runs; run += 1) { const start = performance.now(); work(); all.push(performance.now() - start); }
  return median(all);
}

function measure(data: Stress, runs: number): Map<string, number> {
  const out = new Map<string, number>();
  const record = (name: string, value: number) => out.set(name, value);
  const memosText = JSON.stringify({ memos: data.memos }, null, 2);
  const foldersText = JSON.stringify(data.folders, null, 2);
  let memos: Memo[] = [];
  let folders: MemoFolders = parseMemoFolders(foldersText);
  record("load memos.json", time(runs, () => { memos = parseMemos(memosText); }));
  record("load memo-folders.json", time(runs, () => { folders = parseMemoFolders(foldersText); }));
  record("save memos.json (text)", time(runs, () => { serializeMemos(memos); }));
  record("save memo-folders.json (text)", time(runs, () => { serializeMemoFolders(folders); }));
  // What one redraw of the list does before the DOM: the inbox, its groups, each card's words (no cache in the renderer).
  const now = new Date();
  const inbox = memosIn(folders, memos, "inbox");
  record(`date groups, inbox (${inbox.length})`, time(runs, () => {
    groupMemos(inbox, { pinned: (id) => placementOf(folders, id).pinned, pinnedView: false, sort: "edited", now });
  }));
  record("title sort, inbox", time(runs, () => {
    groupMemos(inbox, { pinned: (id) => placementOf(folders, id).pinned, pinnedView: false, sort: "title", now });
  }));
  record("card words, inbox (every redraw)", time(runs, () => {
    for (const memo of inbox) { cardTitle(memo); previewRows(memo.text); memoKind(memo.text); checklistProgress(memo.text); }
  }));
  // A first search (each memo read and folded), then the next key of a query (the memos' lines kept).
  for (const query of ["보고서", "ㅂㄱㅅ", "zzqq없음"]) record(`search "${query}"`, time(runs, () => { forgetSearchLines(); drawerSearch(folders, memos, query); }));
  drawerSearch(folders, memos, "보");
  for (const query of ["보고서", "ㅂㄱㅅ", "zzqq없음"]) record(`search again "${query}"`, time(runs, () => { drawerSearch(folders, memos, query); }));
  if (memos.length > 1) {
    const here = memos.map((memo, index) => (index === 0 ? { ...memo, text: `${memo.text}\n여기서 더한 줄` } : memo));
    const theirs = memos.map((memo, index) => (index === 0 ? { ...memo, text: `저쪽 첫 줄\n${memo.text}` } : index === 1 ? { ...memo, text: `${memo.text}\n저쪽` } : memo));
    record("merge files (one memo both sides)", time(runs, () => { mergeMemos(memos, here, theirs, new Set([memos[0].id]), new Set()); }));
  }
  for (const memo of memos.filter((entry) => entry.id.startsWith("STRESS-LONG-"))) {
    const kb = Math.round(Buffer.byteLength(memo.text) / 1024);
    const lines = memo.text.split("\n");
    const middle = Math.floor(lines.length / 2);
    const edit = (index: number, change: (line: string) => string) => lines.map((line, at) => (at === index ? change(line) : line)).join("\n");
    const slow = Math.max(1, Math.floor(runs / 2));
    const apartOurs = edit(1, (line) => `${line} 여기`), apartTheirs = edit(lines.length - 2, (line) => `${line} 저기`);
    record(`merge ${kb}KB, lines apart`, time(slow, () => { mergeText(memo.text, apartOurs, apartTheirs); }));
    const sameOurs = edit(middle, (line) => `가${line}`), sameTheirs = edit(middle, (line) => `${line}나`);
    record(`merge ${kb}KB, same line`, time(slow, () => { mergeText(memo.text, sameOurs, sameTheirs); }));
    const typed = edit(middle, (line) => `${line}x`);
    // A keystroke's text crosses to the main process whole (memoUpdate), which compares and stores it.
    record(`per-key copy+compare ${kb}KB`, time(runs, () => { const sent = structuredClone({ text: typed, from: memo.text }); if (sent.text !== sent.from) memos[0] = { ...memo, text: sent.text }; }));
    record(`card words ${kb}KB`, time(runs, () => { cardTitle(memo); previewRows(memo.text); memoKind(memo.text); checklistProgress(memo.text); }));
  }
  for (const memo of memos.filter((entry) => entry.id.startsWith("STRESS-CHECK-"))) {
    const total = memo.text.split("\n").length - 1;
    record(`checklist toggle (${total} lines)`, time(runs, () => { toggleChecklist(memo.text, Math.floor(total / 2)); }));
    record("checklist progress", time(runs, () => { checklistProgress(memo.text); }));
    record("checklist summary (card)", time(runs, () => { slipSummary(memo); }));
  }
  return out;
}

const tiers: [string, Record<string, unknown>][] = [
  ["50", { memos: 50 }], ["500", { memos: 500 }], ["2000", { memos: 2000 }], ["5000", { memos: 5000 }],
  ["long", { memos: 500, long: [10, 100, 1024], checklist: 2000 }],
];

if (process.env.MEMO_BENCH) {
  test("memo stress timings (MEMO_BENCH)", () => {
    for (const [name, options] of tiers) {
      const data = memoStressData(options) as Stress;
      console.log(`\n== tier ${name}: ${data.memos.length} memos, memos.json ${Math.round(Buffer.byteLength(JSON.stringify({ memos: data.memos }, null, 2)) / 1024)} KB`);
      for (const [step, value] of measure(data, Number(process.env.MEMO_BENCH_RUNS ?? 5))) console.log(`${step.padEnd(36)} ${value.toFixed(2).padStart(10)} ms`);
    }
  });
} else {
  test("메모 서랍 under load: 2,000 memos, 100 KB, 2,000 checklist lines stay quick", () => {
    const results = measure(memoStressData({ memos: 2000, long: [100], checklist: 2000 }) as Stress, 3);
    const ceilings: [string, number][] = [
      ["load memos.json", 400], ["load memo-folders.json", 400], ["save memos.json", 400], ["card words, inbox", 500],
      // Search (1.30): a first search 10–45 ms on a busy Mac, the next key's (lines kept) 3–11 ms.
      ["search \"보고서\"", 150], ["search \"zzqq없음\"", 150], ["search again", 60], ["merge 100KB, lines apart", 500], ["merge 100KB, same line", 1500], ["checklist toggle", 50],
    ];
    const slow = [...results].filter(([name, value]) => ceilings.some(([prefix, ceiling]) => name.startsWith(prefix) && value > ceiling));
    assert.deepEqual(slow.map(([name, value]) => `${name} ${value.toFixed(1)} ms`), []);
  });
}
