import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { parseArchiveLines, toEntry, type ArchiveEntry } from "../src/core/archive";
import { focusLine, focusRecord, parseFocus, type FocusRecord } from "../src/core/focus";
import type { Memo } from "../src/core/memo";
import type { TodoItem } from "../src/core/notebook";
import { search, searchHint } from "../src/core/search";
import { aiMarks, aiPlacesFile, parseAiLog, placeNow, undoTodoEntry } from "../src/core/ai";
import { emptyTodoSpaces, entrySpace, historySpaces, inHistory, moveTodo, parseTodoSpaces, searchSpace, spaceOf, type TodoSpaces } from "../src/core/todoSpaces";

// 할 일 스페이스 2c (docs/plans/spaces-phase2.md C1–C5 · H1–H5, mcp-plan.md N3): the shared cases S49–S56 of docs/plans/spaces-cases.json
// and S57–S59 (Claude moving to-dos between spaces, undone here) — the Mac (test-spaces.sh, test-ai.sh) and the extension read the same file.

const fixture = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "spaces-cases.json"), "utf8"));
const now = new Date(fixture.now);

/** The shared file with the `search` section's places. */
function spacesOf(places: Record<string, string>): TodoSpaces {
  const items = Object.fromEntries(Object.entries(places).map(([id, space]) => [id, { space, at: "2026-10-27T00:00:00Z" }]));
  return parseTodoSpaces(JSON.stringify({ ...fixture.file, items }));
}

test("shared fixture: the search's #space (S49–S54)", () => {
  const section = fixture.search;
  const items = section.todos as TodoItem[];
  const archive = section.archive as ArchiveEntry[];
  const memos = section.memos as Memo[];
  for (const entry of section.cases) {
    const label = `${entry.case} ${entry.query}`;
    const spaces = entry.noSpaces ? emptyTodoSpaces() : spacesOf(section.spaces);
    const read = searchSpace(entry.query, spaces);
    assert.equal(read.space ?? null, entry.expect.space, `${label}: space`);
    assert.equal(read.words, entry.expect.words, `${label}: words`);
    const groups = search({ items, memos, archive, events: [], spaces }, entry.query, now, "ko");
    const rows = (kind: string) => groups.find((group) => group.kind === kind)?.rows ?? [];
    for (const kind of ["today", "ahead", "history"]) assert.deepEqual(rows(kind).map((row) => row.text), entry.expect[kind], `${label}: ${kind}`);
    assert.deepEqual(rows("memos").map((row) => row.id), entry.expect.memos, `${label}: memos`);
    // #회사 alone: everything in it, nothing marked.
    if (!entry.expect.words) for (const row of [...rows("today"), ...rows("history")]) assert.deepEqual(row.range, [0, 0], label);
  }
});

test("C5: a record line keeps the to-do's space; an old line reads its place, a gone space reads as 일반", () => {
  const item: TodoItem = { id: "T1", title: "보고서", isCompleted: true, createdAt: "2026-10-27T00:00:00Z", completedAt: "2026-10-27T05:00:00Z" };
  const line = JSON.stringify(toEntry(item, "s-a"));
  assert.match(line, /"space":"s-a"/);
  assert.equal(JSON.stringify(toEntry(item)).includes("space"), false, "일반 writes no space");
  const [read] = parseArchiveLines(`${line}\n{"id":"T2","title":"x","createdAt":"2026-10-27T00:00:00Z","space":7}\n`);
  assert.equal(read.space, "s-a");
  assert.equal(parseArchiveLines(`{"id":"T2","title":"x","createdAt":"2026-10-27T00:00:00Z","space":7}`)[0].space, undefined, "a space that isn't a string is left out");
  const spaces = spacesOf({ T2: "s-b" });
  assert.equal(entrySpace(spaces, "T1", "s-a"), "s-a");
  assert.equal(entrySpace(spaces, "T2"), "s-b", "no space on the line: its place");
  assert.equal(entrySpace(spaces, "T3", "s-x"), undefined, "a gone space, no place: 일반");
});

test("shared fixture: 완료 기록 and 집중 기록 by space (S55, S56)", () => {
  const spaces = spacesOf(fixture.search.spaces);
  const lines = historySpaces(spaces, fixture.search.archive as ArchiveEntry[], fixture.history.focus as FocusRecord[]);
  for (const entry of fixture.history.cases) {
    const filter = entry.filter ?? undefined;
    const label = `${entry.case} ${entry.filter}`;
    assert.deepEqual(lines.entries.filter((line) => inHistory(filter, line)).map((line) => line.id), entry.expect.archive, `${label}: archive`);
    assert.deepEqual(lines.focus.filter((line) => inHistory(filter, line, true)).map((line) => line.id), entry.expect.focus, `${label}: focus`);
  }
});

test("H3: a focus line keeps its to-do's space; a timer never has one", () => {
  const start = new Date("2026-10-27T01:00:00Z"), end = new Date("2026-10-27T01:25:00Z");
  const record = { ...focusRecord({ id: "F1", taskId: "T1", title: "보고서", start, end, kind: "focus" })!, space: "s-a" };
  assert.match(focusLine(record), /"done":false,"space":"s-a"\}$/);
  assert.equal(parseFocus(focusLine(record))[0].space, "s-a");
  const timer = { ...focusRecord({ id: "F2", title: "", start, end, kind: "timer" })!, space: "s-a" };
  assert.equal(focusLine(timer).includes("space"), false, "a plain timer writes no space");
  assert.equal(parseFocus('{"id":"F3","title":"","start":"2026-10-27T01:00:00Z","end":"2026-10-27T01:25:00Z","minutes":25,"kind":"timer","space":"s-a"}')[0].space, undefined);
});

test("shared fixture: undoing Claude's move between spaces, each to-do whole or not at all (S57–S59, M28)", () => {
  const section = fixture.ai;
  const entry = parseAiLog(JSON.stringify(section.entry))[0];
  assert.equal(entry.changes.length, 3);
  for (const step of section.undo) {
    const label = `${step.case} ${step.note ?? ""}`;
    const titled = (section.todos as TodoItem[]).map((item) => ({ ...item, ...(step.titles[item.id] ? { title: step.titles[item.id] } : {}) }));
    const items = titled.filter((item) => !(step.gone ?? []).includes(item.id));
    const spaces = spacesOf(step.places);
    // M28: a line with a change of a file this version doesn't know still reads, without that change.
    const line = step.extraChange ? parseAiLog(JSON.stringify({ ...section.entry, changes: [...section.entry.changes, step.extraChange] }))[0] : entry;
    assert.equal(line.changes.length, 3, `${label}: the unknown file's change is not read`);
    const result = undoTodoEntry(items, spaces, line);
    const after = result.moves.reduce((data, move) => moveTodo(data, move.id, move.space, now), spaces);
    for (const [id, space] of Object.entries(step.expect.places)) assert.equal(spaceOf(after, id) ?? null, space, `${label}: ${id}'s place`);
    for (const [id, title] of Object.entries(step.expect.titles)) assert.equal(result.items.find((item) => item.id === id)?.title, title, `${label}: ${id}'s title`);
    assert.deepEqual([result.undone, result.left], [step.expect.undone, step.expect.left], `${label}: counts`);
  }
});

test("N3-7: the stamp stays only while every change of a to-do is as Claude left it", () => {
  const entry = { ...parseAiLog(JSON.stringify(fixture.ai.entry))[0], at: now.toISOString() };
  const todos = new Map((fixture.ai.todos as TodoItem[]).map((item) => [item.id, item]));
  const stamped = (places: Record<string, string>, title: string) => {
    const spaces = spacesOf(places);
    return [...aiMarks([entry], now, (_target, id, file) => {
      const item = todos.get(id);
      if (!item) return undefined;
      return file === aiPlacesFile ? placeNow(spaces, id) : { ...item, ...(item.id.endsWith("2") ? { title } : {}) } as unknown as Record<string, unknown>;
    })].sort();
  };
  const [first, second] = fixture.ai.todos.map((item: TodoItem) => item.id);
  assert.deepEqual(stamped({ [first]: "s-b", [second]: "s-a" }, "장보기 목록"), [first, second]);
  assert.deepEqual(stamped({ [first]: "s-c", [second]: "s-a" }, "장보기 목록"), [second], "moved since in the app");
  assert.deepEqual(stamped({ [first]: "s-b", [second]: "s-a" }, "장보기 (우유)"), [first], "its title edited since");
});

test("C4: the empty slip's hint names the first space, blanks left out", () => {
  assert.equal(searchHint("회사"), "#회사처럼 적으면 그 스페이스에서만 찾아요");
  assert.equal(searchHint("Side project", "en"), "Type #Sideproject to look in that space only");
  assert.equal(searchHint("Werk", "nl"), "Typ #Werk om alleen in die ruimte te zoeken");
});
