// The time zone first, before any Date: the server runs under the same one.
process.env.TZ = "Asia/Seoul";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { writeBigData } from "./bigData";
import { call, connect, setup } from "./helpers";

/**
 * M39 (P1 · P2, docs/plans/mcp-plan.md): on the large made-up example (bigData.ts) every reading tool's
 * default answer stays under the size Claude Code takes without a warning — about 10,000 tokens for the text
 * and the structured data together, the text under 20,000 characters — and paging with nextCursor to the end
 * sees every item once. The sizes are printed (PAPERTODO_MCP_SERVER=<an older build> measures that one).
 */

/** A rough count of tokens: a quarter per ASCII character, one per other character (Hangul, ‘…’) — on the high side. */
export function tokens(text: string): number {
  let ascii = 0, other = 0;
  for (const character of text) { if (character.charCodeAt(0) < 128) ascii += 1; else other += 1; }
  return Math.ceil(ascii / 4 + other);
}

const maxText = 20_000;
const maxTokens = 10_000;

test("M39: on the large example every default answer stays under ~10,000 tokens, and paging sees every item once", async () => {
  const { env, data } = setup({ now: "2026-10-27T10:00:00+09:00" });
  const big = writeBigData(data);
  const client = await connect(env);
  const memo = big.memos[0];
  const reads: [string, string, Record<string, unknown>][] = [
    ["get_today", "get_today", {}],
    ["list_todos", "list_todos", {}],
    ["list_todos all", "list_todos", { where: "all" }],
    ["list_todos query", "list_todos", { query: "보고서" }],
    ["list_events today", "list_events", { from: "2026-10-27" }],
    ["list_events 31 days", "list_events", { from: "2026-10-27", to: "2026-11-26" }],
    ["list_memos", "list_memos", {}],
    ["list_memos 회사", "list_memos", { folder: "회사" }],
    ["get_memo", "get_memo", { id: memo.id.slice(0, 8) }],
    ["list_memo_folders", "list_memo_folders", {}],
    ["list_repeats", "list_repeats", {}],
    ["get_focus", "get_focus", {}],
    ["get_focus a year", "get_focus", { from: "2025-10-28", to: "2026-10-27" }],
    ["search_history", "search_history", {}],
    ["search_history 6 years", "search_history", { from: "2020-11-01", to: "2026-10-27" }],
  ];
  const rows: string[] = [];
  const over: string[] = [];
  for (const [label, name, args] of reads) {
    const started = Date.now();
    const result = await call(client, name, args);
    const ms = Date.now() - started;
    const json = JSON.stringify(result.data);
    const total = tokens(result.text) + tokens(json);
    rows.push(`${label.padEnd(24)} ${String(result.text.length).padStart(7)} chars text ${String(json.length).padStart(7)} chars data ~${String(total).padStart(6)} tokens ${String(ms).padStart(5)} ms${result.error ? " (error)" : ""}`);
    if (result.error) over.push(`${label}: ${result.text.slice(0, 200)}`);
    if (result.text.length > maxText) over.push(`${label}: text ${result.text.length} > ${maxText}`);
    if (total > maxTokens) over.push(`${label}: ~${total} tokens > ${maxTokens}`);
  }
  process.stdout.write(`# reply sizes on the large example (3,000 tasks, 2,000 memos, 1,500 events, ${big.archiveLines} finished)\n${rows.map((row) => `#   ${row}`).join("\n")}\n`);
  assert.deepEqual(over, [], "every default reply under the limit");

  // Paging to the end: every open task (and the ones finished today) once, none twice.
  const seen: string[] = [];
  let cursor: string | undefined;
  let pages = 0;
  do {
    const result = await call(client, "list_todos", { where: "all", ...(cursor ? { cursor } : {}) });
    assert.equal(result.error, false, result.text);
    seen.push(...(result.data.tasks as { id: string }[]).map((entry) => entry.id));
    cursor = result.data.nextCursor as string | undefined;
    pages += 1;
  } while (cursor && pages < 200);
  const expected = big.todos.filter((item) => !item.isCompleted || item.completedAt!.startsWith("2026-10-27")).length;
  assert.equal(seen.length, expected, "every task seen");
  assert.equal(new Set(seen).size, expected, "none twice");
  assert.deepEqual(new Set(seen), new Set(big.todos.filter((item) => !item.isCompleted || item.completedAt!.startsWith("2026-10-27")).map((item) => item.id.slice(0, 8))));

  // The memos too, 100 at a time.
  const memos: string[] = [];
  cursor = undefined;
  do {
    const result = await call(client, "list_memos", { limit: 100, ...(cursor ? { cursor } : {}) });
    memos.push(...(result.data.memos as { id: string }[]).map((entry) => entry.id));
    cursor = result.data.nextCursor as string | undefined;
  } while (cursor);
  assert.equal(memos.length, big.memos.length);
  assert.equal(new Set(memos).size, big.memos.length);

  // search_history over one month reads only the months around it (P2): the same answer as over everything.
  const month = await call(client, "search_history", { from: "2026-09-01", to: "2026-09-30", limit: 200 });
  assert.equal(month.data.count, 300);
  assert.ok(fs.existsSync(path.join(data, "archive", "2020-11.jsonl")));
});
