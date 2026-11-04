// The time zone first, before any Date: the server runs under the same one.
process.env.TZ = "Asia/Seoul";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { undoTodoEntry } from "../../src/core/ai";
import { toEntry } from "../../src/core/archive";
import { moveTodo, parseTodoSpaces, serializeTodoSpaces, spaceOf, type TodoSpaces } from "../../src/core/todoSpaces";
import { call, connect, logOf, setup, task, todos, writeTodos } from "./helpers";

/**
 * 할 일 스페이스 for Claude (N3, docs/plans/mcp-plan.md ‘2c에서 정한 것’): M24 (reading and filtering, 일반 renamed), M25
 * (a space that isn't there), M26 (a move: preview → apply → the log → the apps' undo, with the shared cases S57 of
 * docs/plans/spaces-cases.json), M27 (moved in the app meanwhile) and N3-8 (an older app). Fictional data only.
 */

const fixture = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "spaces-cases.json"), "utf8"));
const spacesFile = (folder: string) => path.join(folder, "todo-spaces.json");
const readSpaces = (folder: string): TodoSpaces => parseTodoSpaces(fs.readFileSync(spacesFile(folder), "utf8"));
/** The shared file (회사 s-a · 집 s-b · 공부 s-c) with `places` and, optionally, 일반 renamed. */
function writeSpaces(folder: string, places: Record<string, string | { space: string; at: string }>, general?: string): void {
  const items = Object.fromEntries(Object.entries(places).map(([id, place]) => [id, typeof place === "string" ? { space: place, at: "2026-10-20T00:00:00Z" } : place]));
  fs.writeFileSync(spacesFile(folder), serializeTodoSpaces(parseTodoSpaces(JSON.stringify({ ...fixture.file, items, ...(general ? { general: { name: general, updatedAt: "2026-10-20T00:00:00Z" } } : {}) }))));
}

test("M24: tasks show and filter by space — by exact name, id or general, 일반 by its new name; list_spaces", async () => {
  const { env, data } = setup();
  const work = task({ title: "보고서 쓰기" }), home = task({ title: "장보기" }), none = task({ title: "물 마시기" }), ahead = task({ title: "견적서", dueDate: "2026-10-30" });
  writeTodos(data, [work, home, none, ahead]);
  writeSpaces(data, { [work.id]: "s-a", [home.id]: "s-b", [ahead.id]: "s-a" }, "기타");
  const client = await connect(env);
  const all = await call(client, "list_todos", { where: "all" });
  assert.match(all.text, /- \[ \] 보고서 쓰기 · 오늘 · 스페이스 회사 · id /);
  assert.match(all.text, /- \[ \] 물 마시기 · 오늘 · id /, "일반 isn't named on the line");
  const byTitle = Object.fromEntries((all.data.tasks as { title: string; space: string; spaceId: string }[]).map((entry) => [entry.title, [entry.space, entry.spaceId]]));
  assert.deepEqual(byTitle["물 마시기"], ["기타", "general"], "the data always has the space, 일반 by its name now");
  assert.deepEqual(byTitle["장보기"], ["집", "s-b"]);
  const titles = (result: { data: Record<string, unknown> }) => (result.data.tasks as { title: string }[]).map((entry) => entry.title);
  assert.deepEqual(titles(await call(client, "list_todos", { where: "all", space: "회사" })), ["보고서 쓰기", "견적서"]);
  assert.deepEqual(titles(await call(client, "list_todos", { where: "all", space: "S-A" })), ["보고서 쓰기", "견적서"], "an id, any case");
  for (const general of ["general", "기타"]) assert.deepEqual(titles(await call(client, "list_todos", { space: general })), ["물 마시기"], general);
  const today = await call(client, "get_today", { space: "집" });
  assert.deepEqual(titles(today), ["장보기"]);
  assert.equal(today.data.open, 1, "the counts are the space's");
  assert.equal(today.data.space, "s-b");
  // No start of a name, no first consonants (N3-1); 일반's old name is gone once renamed.
  for (const wrong of ["회", "ㅎㅅ", "일반"]) {
    const refused = await call(client, "list_todos", { space: wrong });
    assert.equal(refused.error, true, wrong);
    assert.match(refused.text, /있는 스페이스: 회사, 집, 공부, 기타/, wrong);
  }
  const spaces = await call(client, "list_spaces");
  assert.equal(spaces.error, false, spaces.text);
  assert.match(spaces.text, /^스페이스 3개 \(책상의 순서, 맨 끝은 일반\)\n- 회사 · 남은 할 일 2개 \(오늘 1개\) · id s-a\n- 집 · 남은 할 일 1개 \(오늘 1개\) · id s-b\n- 공부 · 남은 할 일 0개 \(오늘 0개\) · id s-c\n- 기타 · 남은 할 일 1개 \(오늘 1개\) · id general$/);
  assert.deepEqual((spaces.data.spaces as { id: string; color?: string }[]).map((entry) => [entry.id, entry.color]), [["s-a", "pink"], ["s-b", "mint"], ["s-c", "yellow"], ["general", undefined]]);
});

test("M24: search_history by space — the line's own space, else the task's place, else 일반 (C5)", async () => {
  const { env, data } = setup();
  const done = (title: string, completedAt: string) => task({ title, isCompleted: true, completedAt });
  const a = done("월간 보고서", "2026-10-20T02:00:00Z"), b = done("보고서 초안", "2026-10-21T02:00:00Z"), c = done("옛 보고서", "2026-10-22T02:00:00Z");
  fs.mkdirSync(path.join(data, "archive"));
  fs.writeFileSync(path.join(data, "archive", "2026-10.jsonl"), [toEntry(a, "s-a"), toEntry(b), toEntry(c, "s-x")].map((entry) => JSON.stringify(entry)).join("\n") + "\n");
  writeSpaces(data, { [b.id]: "s-b" });
  const client = await connect(env);
  const titles = async (space?: string) => ((await call(client, "search_history", space ? { space } : {})).data.items as { title: string }[]).map((entry) => entry.title);
  assert.deepEqual(await titles("회사"), ["월간 보고서"]);
  assert.deepEqual(await titles("집"), ["보고서 초안"]);
  assert.deepEqual(await titles("general"), ["옛 보고서"], "a space deleted since: 일반");
  assert.equal((await titles()).length, 3);
  const all = await call(client, "search_history");
  assert.match(all.text, /- 월간 보고서 · 스페이스 회사/);
});

test("M25: add_todos into a space — one that isn't there adds nothing and names the spaces; a good one writes its place", async () => {
  const { env, data, home } = setup();
  writeTodos(data, []);
  writeSpaces(data, {});
  const client = await connect(env);
  const refused = await call(client, "add_todos", { items: [{ title: "보고서 쓰기", space: "회사" }, { title: "비행기 표", space: "휴가" }] });
  assert.equal(refused.error, true);
  assert.match(refused.text, /^아무것도 넣지 않았어요\.\n2\. ‘비행기 표’: 스페이스 ‘휴가’가 없어요\. 있는 스페이스: 회사, 집, 공부, 일반\. 스페이스는 종이냥에서 만들어요\.$/);
  assert.equal(todos(data).length, 0);
  const before = fs.readFileSync(spacesFile(data), "utf8");
  const added = await call(client, "add_todos", { items: [{ title: "보고서 쓰기", space: "회사" }, { title: "물 마시기" }] });
  assert.equal(added.error, false, added.text);
  const [report, water] = todos(data);
  assert.equal(spaceOf(readSpaces(data), report.id), "s-a");
  assert.equal(readSpaces(data).items[water.id], undefined, "without a space: 일반, no entry");
  assert.match(added.text, /- \[ \] 보고서 쓰기 · 오늘 · 스페이스 회사 · id /);
  const [entry] = logOf(home);
  assert.equal(entry.count, 2, "counted by task");
  assert.deepEqual(entry.changes.map((change) => change.file), ["todos.json", "todo-spaces.json", "todos.json"]);
  assert.deepEqual(entry.changes[1].before, { id: report.id, space: null });
  assert.equal(entry.changes[1].after?.space, "s-a");
  // Without any space nothing touches todo-spaces.json.
  fs.writeFileSync(spacesFile(data), before);
  await call(client, "add_todos", { items: [{ title: "빨래" }] });
  assert.equal(fs.readFileSync(spacesFile(data), "utf8"), before);
});

test("M26 · S57: a move is previewed, applied after a yes, logged as the shared cases say, and undone by the apps' rule", async () => {
  const { env, data, home } = setup();
  const section = fixture.ai;
  writeTodos(data, section.todos);
  writeSpaces(data, section.places);
  const client = await connect(env);
  const preview = await call(client, "preview_changes", { changes: section.changes });
  assert.equal(preview.error, false, preview.text);
  assert.match(preview.text, /1\. 견적서 보내기 · id E0000000-0000-4000-8000-000000000001\n {3}스페이스: 회사 → 집\n2\. 장보기 · id E0000000-0000-4000-8000-000000000002\n {3}제목: 장보기 → 장보기 목록\n {3}스페이스: 일반 → 회사/);
  assert.equal(fs.existsSync(path.join(home, "ai-log.jsonl")), false, "nothing written before the yes");
  const before = fs.readFileSync(path.join(data, "todos.json"), "utf8");
  const applied = await call(client, "apply_changes", { token: preview.data.token });
  assert.equal(applied.error, false, applied.text);
  assert.deepEqual(applied.data.changed, [
    { kind: "todo", id: "E0000000-0000-4000-8000-000000000001", title: "견적서 보내기", space: "집" },
    { kind: "todo", id: "E0000000-0000-4000-8000-000000000002", title: "장보기 목록", space: "회사" },
  ]);
  const [entry] = logOf(home);
  const expected = section.entry;
  assert.deepEqual([entry.tool, entry.kind, entry.target, entry.count, entry.title, entry.ext], [expected.tool, expected.kind, expected.target, expected.count, expected.title, expected.ext]);
  // The places' `at` is when it was applied; 어제부터's todaySince is bookkeeping the app adds on any change (it differs by day).
  const timeless = (value: unknown) => JSON.parse(JSON.stringify(value), (key, item) => (key === "todaySince" ? undefined : key === "at" && typeof item === "string" && item.startsWith("2026-10-27") ? "applied" : item));
  const want = timeless(expected.changes.map((change: { after: { at?: string } }) => ({ ...change, after: change.after.at === "2026-10-28T01:00:00Z" ? { ...change.after, at: "applied" } : change.after })));
  assert.deepEqual(timeless(entry.changes), want);
  assert.equal(spaceOf(readSpaces(data), "E0000000-0000-4000-8000-000000000001"), "s-b");
  assert.notEqual(fs.readFileSync(path.join(data, "todos.json"), "utf8"), before);
  // What either app does with 되돌리기: both to-dos back, places and title.
  const undone = undoTodoEntry(todos(data), readSpaces(data), entry);
  const places = undone.moves.reduce((spaces, move) => moveTodo(spaces, move.id, move.space), readSpaces(data));
  assert.deepEqual([undone.undone, undone.left], [2, 0]);
  assert.equal(spaceOf(places, "E0000000-0000-4000-8000-000000000001"), "s-a");
  assert.equal(spaceOf(places, "E0000000-0000-4000-8000-000000000002"), undefined);
  assert.equal(undone.items.find((item) => item.id.endsWith("2"))?.title, "장보기");
});

test("M26: a move alone writes only todo-spaces.json; to 일반 by null; the same space changes nothing", async () => {
  const { env, data } = setup();
  const item = task({ title: "견적서 보내기" });
  writeTodos(data, [item]);
  writeSpaces(data, { [item.id]: "s-a" });
  const client = await connect(env);
  const same = await call(client, "preview_changes", { changes: [{ kind: "todo", id: item.id, set: { space: "회사" } }] });
  assert.equal(same.error, true);
  assert.match(same.text, /바뀌는 게 없어요: ‘견적서 보내기’/);
  const todoBytes = fs.readFileSync(path.join(data, "todos.json"), "utf8");
  const preview = await call(client, "preview_changes", { changes: [{ kind: "todo", id: item.id.slice(0, 8), set: { space: null } }] });
  assert.match(preview.text, /스페이스: 회사 → 일반/);
  const applied = await call(client, "apply_changes", { token: preview.data.token });
  assert.equal(applied.error, false, applied.text);
  assert.equal(fs.readFileSync(path.join(data, "todos.json"), "utf8"), todoBytes, "todos.json not written");
  assert.equal(readSpaces(data).items[item.id].space, null, "a move to 일반 is kept as an entry");
});

test("M27: moved in the app after the preview — nothing is applied, preview again", async () => {
  const { env, data, home } = setup();
  const item = task({ title: "견적서 보내기" });
  writeTodos(data, [item]);
  writeSpaces(data, { [item.id]: "s-a" });
  const client = await connect(env);
  const preview = await call(client, "preview_changes", { changes: [{ kind: "todo", id: item.id, set: { space: "집" } }] });
  writeSpaces(data, { [item.id]: { space: "s-c", at: "2026-10-27T00:30:00Z" } });
  const applied = await call(client, "apply_changes", { token: preview.data.token });
  assert.equal(applied.error, true);
  assert.equal(applied.data.error, "ITEM_CHANGED");
  assert.equal(spaceOf(readSpaces(data), item.id), "s-c");
  assert.equal(fs.existsSync(path.join(home, "ai-log.jsonl")), false);
});

test("N3-8: an app before ext 3 can't undo a move — the move is refused, other changes and spaces on adding still work", async () => {
  const { env, data } = setup({ link: { ext: 2 } });
  const item = task({ title: "견적서 보내기" });
  writeTodos(data, [item]);
  writeSpaces(data, { [item.id]: "s-a" });
  const client = await connect(env);
  const move = await call(client, "preview_changes", { changes: [{ kind: "todo", id: item.id, set: { space: "집" } }] });
  assert.equal(move.error, true);
  assert.match(move.text, /종이냥 앱이 이 확장보다 옛 판이라 할 일을 다른 스페이스로 옮길 수 없어요/);
  assert.equal((await call(client, "preview_changes", { changes: [{ kind: "todo", id: item.id, set: { title: "견적서 보내기 (A사)" } }] })).error, false);
  assert.equal((await call(client, "add_todos", { items: [{ title: "장보기", space: "집" }] })).error, false);
});
