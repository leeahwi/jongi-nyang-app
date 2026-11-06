// The time zone first, before any Date: the server runs under the same one.
process.env.TZ = "Asia/Seoul";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { parseTodoSpaces, serializeTodoSpaces, spaceOf } from "../../src/core/todoSpaces";
import { call, connect, setup, task, todos, writeTodos, type Setup } from "./helpers";

/**
 * 기기마다 보일 스페이스 for Claude (N3-9, docs/plans/mcp-plan.md; #196): the app puts this device's 이 기기에서 into
 * ai-link.json and the extension leaves out what the note leaves out — the shared cases S73–S76 of
 * docs/plans/spaces-cases.json → `aiDevice` (the Mac's test-space-device.sh and the Windows app's ai.test.ts read the
 * same block for what the app writes). M42: left out of today, the lists and the resources, with an end line. M43:
 * shown, marked hidden, when its space is picked or a word searched; the record shows all. M44: list_spaces says what
 * this device does, and adding or moving into a hidden space says it won't show here. M45: an app that doesn't say
 * (before ext 4) hides nothing. Fictional data only.
 */

const fixture = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "spaces-cases.json"), "utf8"));
const cases = fixture.aiDevice;
type Row = { title: string; hidden?: boolean; id: string };

/** The settings and data folders for the cases: 회사 hidden, 집 only on weekday evenings, the to-dos in their places. */
function prepare(link: Parameters<typeof setup>[0] = {}): Setup {
  const made = setup({ now: fixture.now, link: { spaceDevice: cases.link.spaceDevice, ...(link.link ?? {}) }, ...(link.lang ? { lang: link.lang } : {}) });
  const items = (cases.todos as { id: string; title: string; space?: string; dueDate?: string; isCompleted?: boolean; completedAt?: string }[]);
  writeTodos(made.data, items.map(({ space: _space, ...fields }) => task(fields)));
  const places = Object.fromEntries(items.filter((item) => item.space).map((item) => [item.id, { space: item.space!, at: "2026-10-20T00:00:00Z" }]));
  fs.writeFileSync(path.join(made.data, "todo-spaces.json"), serializeTodoSpaces(parseTodoSpaces(JSON.stringify({ ...fixture.file, items: places }))));
  return made;
}

const rows = (data: Record<string, unknown>): Row[] => ((data.tasks ?? data.items) as Row[]) ?? [];
const hiddenOf = (data: Record<string, unknown>) => Object.fromEntries(((data.hiddenHere ?? []) as { spaceId: string; open: number }[]).map((entry) => [entry.spaceId, entry.open]));

async function read(client: Client, made: Setup, entry: { tool: string; args: Record<string, unknown>; at?: string }) {
  fs.writeFileSync(made.clockFile, entry.at ?? fixture.now);
  return call(client, entry.tool, entry.args);
}

test("M42 · M43 · S74–S76: the reads leave out what this device hides as the note does, and show it when asked", async () => {
  const made = prepare();
  const client = await connect(made.env);
  for (const entry of cases.reads) {
    const label = `${entry.case} ${entry.tool} ${JSON.stringify(entry.args)}${entry.at ? ` at ${entry.at}` : ""}: ${entry.note}`;
    const result = await read(client, made, entry);
    assert.equal(result.error, false, `${label}: ${result.text}`);
    assert.deepEqual(rows(result.data).map((row) => row.title), entry.titles, label);
    assert.deepEqual(rows(result.data).filter((row) => row.hidden).map((row) => row.title), entry.marked, `${label}: marked`);
    if (entry.open !== undefined) assert.equal(result.data.open, entry.open, `${label}: the count leaves them out too`);
    assert.deepEqual(hiddenOf(result.data), entry.hidden, `${label}: hiddenHere`);
    if (entry.line) assert.ok(result.text.includes(entry.line), `${label}: the end line in ${JSON.stringify(result.text)}`);
    else assert.doesNotMatch(result.text, /이 기기에서 숨겨 뒀어요/, `${label}: no end line`);
    for (const row of rows(result.data).filter((row) => row.hidden)) assert.match(result.text, new RegExp(`- \\[[ x]\\] ${row.title} · .* · 숨김 · id `), `${label}: the line says 숨김`);
  }
});

test("M42 · S74: today's sheet and the week as resources leave them out too; what was finished stays", async () => {
  const made = prepare();
  const client = await connect(made.env);
  for (const entry of cases.resources) {
    const result = await client.readResource({ uri: entry.uri });
    const text = (result.contents[0] as { text: string }).text;
    for (const title of entry.present) assert.ok(text.includes(title), `${entry.uri}: ${title} in ${text}`);
    for (const title of entry.absent) assert.ok(!text.includes(title), `${entry.uri}: no ${title} in ${text}`);
    assert.ok(text.includes(entry.line), `${entry.uri}: the end line in ${text}`);
  }
});

test("M42: the week's end line counts only what that week would have shown", async () => {
  const made = prepare();
  const later = task({ title: "다음 달 회의", dueDate: "2026-11-20" });
  writeTodos(made.data, [...todos(made.data), later]);
  const places = parseTodoSpaces(fs.readFileSync(path.join(made.data, "todo-spaces.json"), "utf8"));
  places.items[later.id] = { space: "s-a", at: "2026-10-20T00:00:00Z" };
  fs.writeFileSync(path.join(made.data, "todo-spaces.json"), serializeTodoSpaces(places));
  const client = await connect(made.env);
  const week = ((await client.readResource({ uri: "jongi-nyang://week" })).contents[0] as { text: string }).text;
  assert.ok(week.includes(cases.resources[1].line), week);
  assert.ok((await call(client, "list_todos", { where: "all" })).text.includes("회사 · 집은 이 기기에서 숨겨 뒀어요 (할 일 4개)"), "the list counts it");
});

test("M42: the end line in en and nl", async () => {
  for (const [lang, line] of [["en", /회사 · 집 are hidden on this device \(2 tasks\)\. To see them, pick that space with space, or search with query\./], ["nl", /회사 · 집 zijn verborgen op dit apparaat \(2 taken\)\. Kies die ruimte met space/]] as const) {
    const made = prepare({ link: { lang } });
    const client = await connect(made.env);
    const today = await call(client, "get_today");
    assert.match(today.text, line, lang);
    const found = await call(client, "list_todos", { query: "보고서" });
    assert.match(found.text, lang === "en" ? / · hidden · id / : / · verborgen · id /, `${lang}: the mark`);
  }
});

test("M44 · S76: list_spaces says what this device does with each space; adding and moving into a hidden one say so", async () => {
  const made = prepare();
  const client = await connect(made.env);
  const spaces = await call(client, "list_spaces");
  assert.equal(spaces.error, false, spaces.text);
  const got = (spaces.data.spaces as Record<string, unknown>[]).map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => ["id", "device", "hiddenNow", "status", "open", "today"].includes(key))));
  assert.deepEqual(got, cases.spaces, "the counts are every to-do (D13)");
  assert.match(spaces.text, /^- 회사 · 남은 할 일 2개 \(오늘 1개\) · 이 기기에서 숨겨 뒀어요 · id s-a$/m);
  assert.match(spaces.text, /^- 집 · 남은 할 일 1개 \(오늘 1개\) · 평일 18:00–23:00에만 · 지금 숨어 있어요 · id s-b$/m);
  assert.match(spaces.text, /^- 공부 · 남은 할 일 1개 \(오늘 1개\) · id s-c$/m);
  assert.match(spaces.text, /보이기 · 숨기기는 종이냥에서만 바꿔요/);

  const added = await call(client, "add_todos", { items: cases.add.items });
  assert.equal(added.error, false, added.text);
  assert.ok(added.text.includes(cases.add.line), `${cases.add.note}: ${added.text}`);
  assert.equal((added.data.added as Row[])[0].hidden, true);
  const made1 = todos(made.data).find((item) => item.title === cases.add.items[0].title)!;
  assert.equal(spaceOf(parseTodoSpaces(fs.readFileSync(path.join(made.data, "todo-spaces.json"), "utf8")), made1.id), "s-a", "it went in");
  assert.ok(!rows((await call(client, "get_today")).data).some((row) => row.title === made1.title), "and doesn't show on today's sheet here");

  const preview = await call(client, "preview_changes", { changes: [{ kind: "todo", id: cases.move.id, set: { space: cases.move.space } }] });
  assert.equal(preview.error, false, preview.text);
  assert.ok(preview.text.includes(cases.move.line), `${cases.move.note}: ${preview.text}`);
  const applied = await call(client, "apply_changes", { token: preview.data.token });
  assert.equal(applied.error, false, applied.text);
  assert.match(applied.text, /단어 외우기 · 오늘 · 스페이스 회사 · 숨김 · id /, "after the move it is hidden here");
});

test("M45 · S76: an app that doesn't say (before ext 4) hides nothing; with no spaces nothing is hidden either (D1)", async () => {
  const older = prepare({ link: { ext: cases.older.ext, spaceDevice: undefined } });
  const client = await connect(older.env);
  const today = await call(client, "get_today");
  assert.deepEqual(rows(today.data).map((row) => row.title), cases.older.titles, cases.older.note);
  assert.equal(today.data.hiddenHere, undefined);
  assert.doesNotMatch((await call(client, "list_spaces")).text, /숨겨/);

  const none = setup({ now: fixture.now, link: { spaceDevice: { none: { show: "hide" } } } });
  writeTodos(none.data, [task({ title: "물 마시기" })]);
  const alone = await connect(none.env);
  assert.deepEqual(rows((await call(alone, "get_today")).data).map((row) => row.title), ["물 마시기"], "일반 hidden but no space: all shows");
});
