import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { serialize } from "node:v8";
import { test } from "node:test";
import { groupByDay } from "../src/core/archive";
import { makeBackup, mergeFiles, parseBackup } from "../src/core/backup";
import { search } from "../src/core/search";
import { readIntent } from "../src/core/intent";
import { ArchiveStore } from "../src/main/archiveStore";
import { readDataFiles } from "../src/main/storageFolder";
import { Store } from "../src/main/store";
// @ts-expect-error: a plain ES module of the tools (no types)
import { writePerfData } from "../tools/perf-data.mjs";

// Perf audit 2 (docs/perf-audit-2.md): the main process's own work on a perf data set, without Electron. As a test:
// 2,000 to-dos, each step under a generous ceiling. `AUDIT_BENCH=1 node --test out-test/auditBench.test.js` prints the
// timings of every size instead (500 · 2,000 · 5,000, and 2,000 with three years of record and 200 events).

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function time(runs: number, work: () => void): number {
  const all: number[] = [];
  for (let run = 0; run < runs; run += 1) { const start = performance.now(); work(); all.push(performance.now() - start); }
  return Math.round(median(all) * 100) / 100;
}

function measure(options: Record<string, number>, runs: number): Map<string, number> {
  const out = new Map<string, number>();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paper-audit-"));
  try {
    writePerfData(directory, new Date(), options);
    const store = new Store(directory);
    const archive = new ArchiveStore(store, directory);
    const open = store.items.filter((item) => !item.isCompleted).map((item) => item.id);
    // One check (and back) through the store as an act does it: undo snapshot, today's stamps, two serializations,
    // the atomic write. With nothing behind, then with 200 steps of undo behind.
    out.set("check + uncheck, undo depth ~0", time(runs, () => { store.mutate((h) => h.toggle(open[0])); store.mutate((h) => h.toggle(open[0])); }) / 2);
    for (let step = 0; step < 100; step += 1) { store.mutate((h) => h.toggle(open[1])); store.mutate((h) => h.toggle(open[1])); }
    out.set("check + uncheck, undo depth 200", time(runs, () => { store.mutate((h) => h.toggle(open[2])); store.mutate((h) => h.toggle(open[2])); }) / 2);
    // The state every listening page gets on each change: built once, then cloned once per page.
    let state = store.state();
    out.set("state() build", time(runs, () => { state = store.state(); }));
    out.set("state clone (v8 serialize)", time(runs, () => { serialize(state); }));
    out.set("state kB", Math.round(serialize(state).length / 1024));
    out.set("catchUp deep (the 150 s look)", time(runs, () => { store.catchUp(undefined, true); }));
    // 검색 over everything: what each keystroke runs in the main process (no debounce).
    for (const query of ["보", "보고서", "ㅂㄱㅅ", "없는말"]) {
      out.set(`search ‘${query}’`, time(runs, () => {
        search({ items: store.items, memos: store.memos, archive: archive.all(), events: store.events, dueStyle: store.prefs.dueStyle, memoFolder: () => undefined }, query, new Date(), "ko");
      }));
    }
    out.set("archive.all() copy", time(runs, () => { archive.all(); }));
    out.set("history:get payload kB", Math.round(serialize({ entries: archive.all() }).length / 1024));
    out.set("groupByDay (history pane)", time(runs, () => { groupByDay(archive.all()); }));
    // The input line: one reading per keystroke.
    const line = "내일 오후 3시 회의 자료 준비하기 매주 #회사";
    out.set("readIntent per key (ko, 24 keys)", time(runs, () => { for (let end = 1; end <= line.length; end += 1) readIntent(line.slice(0, end), new Date(), "ko"); }) / line.length);
    const english = "meeting prep tomorrow 3pm every week #work";
    out.set("readIntent per key (en)", time(runs, () => { for (let end = 1; end <= english.length; end += 1) readIntent(english.slice(0, end), new Date(), "en"); }) / english.length);
    // Backup at this size.
    const files = readDataFiles(directory);
    let text = "";
    out.set("backup make", time(runs, () => { text = makeBackup(files, "Windows", new Date()); }));
    out.set("backup kB", Math.round(text.length / 1024));
    out.set("backup parse", time(runs, () => { parseBackup(text); }));
    out.set("backup merge (same data)", time(runs, () => { mergeFiles(files, files); }));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
  return out;
}

test("perf audit 2: the main process's steps at 2,000 to-dos stay well under a frame budget's ceiling", () => {
  if (process.env.AUDIT_BENCH) {
    const sizes: [string, Record<string, number>][] = [
      ["500", { todos: 500, spaces: 9 }], ["2000", { todos: 2000, spaces: 9 }], ["5000", { todos: 5000, spaces: 9 }],
      ["2000 · 3y · 200 events", { todos: 2000, spaces: 9, history: 6000, historyDays: 1095, events: 200 }],
    ];
    for (const [name, options] of sizes) {
      console.log(`== ${name}`);
      for (const [step, ms] of measure(options, 5)) console.log(`${step.padEnd(40)} ${ms}`);
    }
    return;
  }
  const result = measure({ todos: 2000, spaces: 9 }, 3);
  assert.ok(result.get("check + uncheck, undo depth 200")! < 2000);
  assert.ok(result.get("search ‘보’")! < 2000);
});
