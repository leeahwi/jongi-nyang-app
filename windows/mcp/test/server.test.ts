// The time zone first, before any Date: the server runs under the same one.
process.env.TZ = "Asia/Seoul";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { aiLockFileName, parseAiLog, serializeAiLink, type AiLink } from "../../src/core/ai";
import { parseEvents, serializeEvents, type LocalEvent } from "../../src/core/events";
import { parseMemos } from "../../src/core/memo";
import { parseNotebook, serializeNotebook, type TodoItem } from "../../src/core/notebook";
import { Store } from "../../src/main/store";

/**
 * 종이냥 for Claude: the real bundled server (mcp/dist/server/index.js) over stdio with the SDK's client,
 * on temporary folders only (PAPERTODO_AI_HOME). Cases M1–M12 and M16–M18 of the shared AI connection spec,
 * and the app's Store writing todos.json while the extension adds to it.
 */

const server = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "../mcp/dist/server/index.js");
const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "paper-todo-ai-"));
const clients: Client[] = [];
after(async () => { for (const client of clients) await client.close(); });

interface Setup { home: string; data: string; clockFile: string; env: Record<string, string> }

/** A settings folder (and a data folder: the same one, or a separate "shared" one) with ai-link.json. */
function setup(options: { link?: Partial<AiLink> | null; shared?: boolean; now?: string; lang?: string } = {}): Setup {
  const home = temporary();
  const data = options.shared ? temporary() : home;
  const clockFile = path.join(home, "clock.txt");
  fs.writeFileSync(clockFile, options.now ?? "2026-10-27T10:00:00+09:00");
  if (options.link !== null) {
    const link: AiLink = { v: 1, enabled: true, dataFolder: data, lang: "ko", app: "windows 1.27.0", updatedAt: "2026-10-27T00:00:00Z", ...options.link };
    fs.writeFileSync(path.join(home, "ai-link.json"), serializeAiLink(link));
  }
  return { home, data, clockFile, env: { PAPERTODO_AI_HOME: home, PAPERTODO_AI_CLOCK: clockFile, TZ: "Asia/Seoul", LANG: options.lang ?? "ko_KR.UTF-8" } };
}

async function connect(env: Record<string, string>, command = process.execPath, name = "paper-todo-test"): Promise<Client> {
  const client = new Client({ name, version: "1.0.0" });
  const base = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && !key.startsWith("PAPERTODO_"))) as Record<string, string>;
  await client.connect(new StdioClientTransport({ command, args: [server], env: { ...base, ...env }, stderr: "pipe" }));
  clients.push(client);
  return client;
}

type Result = { text: string; data: Record<string, unknown>; error: boolean };
async function call(client: Client, name: string, args: Record<string, unknown> = {}): Promise<Result> {
  const result = await client.callTool({ name, arguments: args }) as { content: { type: string; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };
  return { text: result.content.map((part) => part.text).join("\n"), data: result.structuredContent ?? {}, error: Boolean(result.isError) };
}

const todos = (folder: string): TodoItem[] => parseNotebook(fs.readFileSync(path.join(folder, "todos.json"), "utf8")).items;
const logOf = (home: string) => parseAiLog(fs.existsSync(path.join(home, "ai-log.jsonl")) ? fs.readFileSync(path.join(home, "ai-log.jsonl"), "utf8") : "");
const task = (fields: Partial<TodoItem> & { title: string }): TodoItem => ({ id: crypto.randomUUID().toUpperCase(), isCompleted: false, createdAt: "2026-10-20T00:00:00Z", ...fields });
const writeTodos = (folder: string, items: TodoItem[]) => fs.writeFileSync(path.join(folder, "todos.json"), serializeNotebook({ items }));
const event = (fields: Partial<LocalEvent> & { title: string; date: string }): LocalEvent => ({
  id: crypto.randomUUID().toUpperCase(), allDay: false, days: 1, start: 600, end: 660, repeat: "none", skip: [], color: "blue",
  createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z", ...fields,
});

const allTools: [string, Record<string, unknown>][] = [
  ["get_today", {}], ["list_todos", {}], ["list_events", { from: "2026-10-27" }], ["list_memos", {}], ["get_focus", {}], ["search_history", {}],
  ["add_todos", { items: [{ title: "x" }] }], ["add_event", { title: "x", date: "2026-10-28", start: "10:00" }], ["add_memo", { text: "x" }],
  ["preview_changes", { changes: [{ kind: "todo", id: "A", set: { title: "y" } }] }], ["apply_changes", { token: "ABCDEF" }],
];

test("M1: without ai-link.json every tool only says to turn it on", async () => {
  const { env, home } = setup({ link: null });
  const client = await connect(env);
  const listed = await client.listTools();
  assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), allTools.map(([name]) => name).sort());
  const annotations = Object.fromEntries(listed.tools.map((tool) => [tool.name, tool.annotations]));
  assert.equal(annotations.get_today?.readOnlyHint, true);
  assert.equal(annotations.add_todos?.destructiveHint, false);
  assert.equal(annotations.apply_changes?.destructiveHint, true);
  assert.match(listed.tools.find((tool) => tool.name === "apply_changes")!.description!, /ONLY after showing the preview to the user and getting a clear yes/);
  for (const [name, args] of allTools) {
    const result = await call(client, name, args);
    assert.equal(result.text, "종이냥 설정 › AI 연결에서 켜 주세요.", name);
    assert.equal(result.error, false);
    assert.deepEqual(result.data, { enabled: false });
  }
  assert.equal(fs.existsSync(path.join(home, "todos.json")), false);
  assert.equal(fs.existsSync(path.join(home, "ai-log.jsonl")), false);
});

test("M2: turned off, nothing is opened (a broken list stays untouched and unread)", async () => {
  const { env, home, data } = setup({ link: { enabled: false, lang: "en" } });
  fs.writeFileSync(path.join(data, "todos.json"), "{ broken");
  const client = await connect(env);
  for (const [name, args] of allTools) {
    const result = await call(client, name, args);
    assert.equal(result.text, "Turn it on in 종이냥 Settings › AI connection.", name);
    assert.equal(result.error, false);
  }
  assert.equal(fs.readFileSync(path.join(data, "todos.json"), "utf8"), "{ broken");
  assert.equal(fs.existsSync(path.join(home, "ai-log.jsonl")), false);
  // Turned on again: the next call reads the link afresh.
  fs.writeFileSync(path.join(home, "ai-link.json"), serializeAiLink({ v: 1, enabled: true, dataFolder: data, lang: "nl", app: "", updatedAt: "" }));
  writeTodos(data, []);
  assert.match((await call(client, "get_today")).text, /^Vandaag/);
});

test("M3: at 02:30 get_today is still the day before (4 a.m. rule)", async () => {
  const { env, data } = setup({ now: "2026-10-28T02:30:00+09:00" });
  writeTodos(data, [
    task({ title: "어제 마감", dueDate: "2026-10-27" }),
    task({ title: "내일 마감", dueDate: "2026-10-28" }),
    task({ title: "날짜 없음", timeStart: "23:00", timeEnd: "01:00" }),
  ]);
  fs.writeFileSync(path.join(data, "events.json"), serializeEvents([event({ title: "밤 회의", date: "2026-10-27", start: 1380, end: 60 }), event({ title: "28일 회의", date: "2026-10-28", start: 600, end: 660 })]));
  fs.writeFileSync(path.join(data, "focus.jsonl"), `${JSON.stringify({ id: "f1", title: "보고서", start: "2026-10-27T05:00:00Z", end: "2026-10-27T05:25:00Z", minutes: 25, kind: "focus", done: false })}\n`);
  const client = await connect(env);
  const today = await call(client, "get_today");
  assert.equal(today.error, false);
  assert.equal(today.data.date, "2026-10-27");
  const titles = (today.data.tasks as { title: string }[]).map((entry) => entry.title);
  assert.deepEqual(titles.sort(), ["날짜 없음", "어제 마감"].sort());
  assert.deepEqual((today.data.events as { title: string }[]).map((entry) => entry.title), ["밤 회의"]);
  assert.deepEqual(today.data.focus, { minutes: 25, sessions: 1 });
  assert.match(today.text, /^오늘 · 10월 27일 \(화\)/);
  assert.match(today.text, /날짜 없음 · 오늘 23:00–01:00/);
});

test("M4–M6: times on a task, an end alone refused, an end past 03:45 refused", async () => {
  const { env, data, home } = setup({ now: "2026-10-27T10:00:00+09:00" });
  writeTodos(data, []);
  const client = await connect(env);
  const added = await call(client, "add_todos", { items: [{ title: "보고서 쓰기", timeStart: "14:00", timeEnd: "15:30" }, { title: "밤 정리", date: "2026-10-28", timeStart: "23:00", timeEnd: "03:45" }] });
  assert.equal(added.error, false, added.text);
  const [report, night] = todos(data);
  assert.deepEqual([report.timeStart, report.timeEnd, report.dueDate, report.reminderAt, report.todaySince], ["14:00", "15:30", undefined, "2026-10-27T05:00:00Z", "2026-10-27"]);
  assert.deepEqual([night.timeStart, night.timeEnd, night.dueDate, night.todaySince], ["23:00", "03:45", "2026-10-28", undefined]);
  // The file is what the app would write: read back and written again, the same bytes.
  const text = fs.readFileSync(path.join(data, "todos.json"), "utf8");
  assert.equal(serializeNotebook(parseNotebook(text)), text);
  const before = text;
  const endOnly = await call(client, "add_todos", { items: [{ title: "끝만", timeEnd: "15:00" }] });
  assert.equal(endOnly.error, true);
  assert.match(endOnly.text, /끝 시간만 있어요/);
  for (const [start, end] of [["23:00", "04:00"], ["23:00", "03:50"], ["14:00", "13:00"], ["02:00", "05:00"]]) {
    const late = await call(client, "add_todos", { items: [{ title: "늦게", timeStart: start, timeEnd: end }] });
    assert.equal(late.error, true, `${start}–${end}`);
    assert.match(late.text, /03:45/);
  }
  assert.equal(fs.readFileSync(path.join(data, "todos.json"), "utf8"), before, "nothing written by a refused call");
  const log = logOf(home);
  assert.equal(log.length, 1);
  assert.deepEqual([log[0].kind, log[0].target, log[0].count, log[0].title, log[0].tool, log[0].client], ["add", "todos", 2, "보고서 쓰기", "add_todos", "Claude"]);
  assert.equal(log[0].changes[0].before, null);
  assert.deepEqual(log[0].changes[0].after, report as unknown as Record<string, unknown>);
  assert.match(log[0].at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
});

test("M7–M8: the same title on the same day isn't added twice; 21 at once is refused", async () => {
  const { env, data } = setup();
  const existing = task({ title: "운동" });
  writeTodos(data, [existing, task({ title: "장보기", dueDate: "2026-10-29" })]);
  const client = await connect(env);
  const result = await call(client, "add_todos", { items: [{ title: " 운동 " }, { title: "장보기", date: "2026-10-29" }, { title: "장보기", date: "2026-10-30" }, { title: "새 일" }, { title: "새 일" }] });
  assert.equal(result.error, false);
  assert.deepEqual((result.data.added as { title: string }[]).map((entry) => entry.title), ["장보기", "새 일"]);
  const skipped = result.data.skipped as { title: string; id: string }[];
  assert.equal(skipped.length, 3);
  assert.equal(skipped[0].id, existing.id);
  assert.match(result.text, /이미 있어서 넣지 않았어요/);
  assert.match(result.text, new RegExp(`id ${existing.id}`));
  const many = await call(client, "add_todos", { items: Array.from({ length: 21 }, (_, index) => ({ title: `할 일 ${index}` })) });
  assert.equal(many.error, true);
  assert.match(many.text, /20개까지/);
  assert.equal(todos(data).length, 4);
});

test("M9: the app writes in between: the extension adds on top of the newer list", async () => {
  const { env, data } = setup();
  writeTodos(data, [task({ title: "원래 있던 일" })]);
  const race = path.join(data, "todos.json.race");
  writeTodos(data, [task({ title: "원래 있던 일" })]);
  const appVersion = [...todos(data), task({ title: "앱에서 방금 넣은 일" })];
  fs.writeFileSync(race, serializeNotebook({ items: appVersion }));
  const client = await connect({ ...env, PAPERTODO_AI_RACE: race });
  const result = await call(client, "add_todos", { items: [{ title: "Claude가 넣은 일" }] });
  assert.equal(result.error, false, result.text);
  assert.equal(fs.existsSync(race), false, "the race happened");
  assert.deepEqual(todos(data).map((item) => item.title), ["원래 있던 일", "앱에서 방금 넣은 일", "Claude가 넣은 일"]);
});

test("preview, then apply after a yes: the change and its log", async () => {
  const { env, data, home, clockFile } = setup({ now: "2026-10-27T10:00:00+09:00" });
  const report = task({ title: "보고서 쓰기", timeStart: "15:00", timeEnd: "16:00", reminderAt: "2026-10-27T06:00:00Z", todaySince: "2026-10-27" });
  const meeting = event({ title: "팀 회의", date: "2026-10-28", start: 600, end: 660, location: "3층" });
  writeTodos(data, [report]);
  fs.writeFileSync(path.join(data, "events.json"), serializeEvents([meeting]));
  const client = await connect(env);
  const preview = await call(client, "preview_changes", { changes: [
    { kind: "todo", id: report.id, set: { timeStart: "16:00", timeEnd: "17:00" } },
    { kind: "event", id: `local/${meeting.id}@2026-10-28`, set: { start: "11:00" } },
  ] });
  assert.equal(preview.error, false, preview.text);
  assert.match(preview.text, /시간: 15:00–16:00 → 16:00–17:00/);
  assert.match(preview.text, /알림: 15:00 → 16:00/);
  assert.match(preview.text, /시간: 10:00–11:00 → 11:00–12:00/);
  assert.match(preview.text, /아직 아무것도 바뀌지 않았어요/);
  assert.deepEqual(todos(data), [report], "a preview writes nothing");
  fs.writeFileSync(clockFile, "2026-10-27T10:05:00+09:00");
  const applied = await call(client, "apply_changes", { token: (preview.data.token as string).toLowerCase() });
  assert.equal(applied.error, false, applied.text);
  const [after] = todos(data);
  assert.deepEqual([after.timeStart, after.timeEnd, after.reminderAt], ["16:00", "17:00", "2026-10-27T07:00:00Z"]);
  const [moved] = parseEvents(fs.readFileSync(path.join(data, "events.json"), "utf8"));
  assert.deepEqual([moved.start, moved.end, moved.location, moved.createdAt, moved.updatedAt], [660, 720, "3층", meeting.createdAt, "2026-10-27T01:05:00Z"]);
  const log = logOf(home);
  assert.deepEqual(log.map((entry) => [entry.kind, entry.target, entry.count, entry.tool]), [["change", "todos", 1, "apply_changes"], ["change", "events", 1, "apply_changes"]]);
  assert.deepEqual(log[0].changes[0].before, report as unknown as Record<string, unknown>);
  // A token is used once.
  assert.equal((await call(client, "apply_changes", { token: preview.data.token as string })).error, true);
});

test("M10: changed in the app after the preview: nothing applied, preview again", async () => {
  const { env, data, home } = setup();
  const item = task({ title: "보고서 쓰기" });
  writeTodos(data, [item]);
  const client = await connect(env);
  const preview = await call(client, "preview_changes", { changes: [{ kind: "todo", id: item.id, set: { title: "보고서 마무리" } }] });
  writeTodos(data, [{ ...item, timeStart: "09:00" }]);
  const applied = await call(client, "apply_changes", { token: preview.data.token as string });
  assert.equal(applied.error, true);
  assert.match(applied.text, /미리보기 뒤에 바뀐 항목이 있어서 적용하지 않았어요: ‘보고서 쓰기’/);
  assert.equal(todos(data)[0].title, "보고서 쓰기");
  assert.equal(logOf(home).length, 0);
  // Bookkeeping the app does by itself (the 어제부터 day, a reminder that came) isn't a change.
  const again = await call(client, "preview_changes", { changes: [{ kind: "todo", id: item.id, set: { title: "보고서 마무리" } }] });
  writeTodos(data, [{ ...item, timeStart: "09:00", todaySince: "2026-10-27" }]);
  assert.equal((await call(client, "apply_changes", { token: again.data.token as string })).error, false);
  assert.equal(todos(data)[0].title, "보고서 마무리");
});

test("M11: a confirmation older than 10 minutes is refused", async () => {
  const { env, data, clockFile } = setup({ now: "2026-10-27T10:00:00+09:00" });
  const item = task({ title: "보고서 쓰기" });
  writeTodos(data, [item]);
  const client = await connect(env);
  const preview = await call(client, "preview_changes", { changes: [{ kind: "todo", id: item.id, set: { done: true } }] });
  assert.match(preview.text, /상태: 남음 → 끝냄/);
  fs.writeFileSync(clockFile, "2026-10-27T10:10:01+09:00");
  const applied = await call(client, "apply_changes", { token: preview.data.token as string });
  assert.equal(applied.error, true);
  assert.match(applied.text, /10분이 지나서/);
  assert.equal(todos(data)[0].isCompleted, false);
});

test("M12: repeating events, deleting and unknown fields are refused at the preview", async () => {
  const { env, data } = setup();
  const weekly = event({ title: "주간 회의", date: "2026-10-20", repeat: "weekly" });
  const item = task({ title: "보고서" });
  writeTodos(data, [item]);
  fs.writeFileSync(path.join(data, "events.json"), serializeEvents([weekly]));
  const client = await connect(env);
  const repeat = await call(client, "preview_changes", { changes: [{ kind: "event", id: weekly.id, set: { title: "회의" } }] });
  assert.equal(repeat.error, true);
  assert.match(repeat.text, /반복 일정은 고칠 수 없어요/);
  const remove = await call(client, "preview_changes", { changes: [{ kind: "todo", id: item.id, set: { delete: true } }] });
  assert.match(remove.text, /지우기는 할 수 없어요/);
  const unknown = await call(client, "preview_changes", { changes: [{ kind: "todo", id: "NOPE", set: { title: "x" } }] });
  assert.match(unknown.text, /이 id의 할 일이 없어요: NOPE/);
  assert.equal(repeat.data.token, undefined);
});

test("M16: a shared data folder: the files there, the log in this device's settings folder", async () => {
  const { env, data, home } = setup({ shared: true });
  const client = await connect(env);
  assert.equal((await call(client, "add_todos", { items: [{ title: "공유 폴더 일" }] })).error, false);
  assert.equal((await call(client, "add_memo", { text: "첫 줄\n둘째 줄" })).error, false);
  assert.equal((await call(client, "add_event", { title: "점심", date: "2026-10-28", start: "12:00", end: "13:00", location: "식당" })).error, false);
  assert.deepEqual(todos(data).map((item) => item.title), ["공유 폴더 일"]);
  assert.equal(parseMemos(fs.readFileSync(path.join(data, "memos.json"), "utf8"))[0].text, "첫 줄\n둘째 줄");
  assert.equal(parseEvents(fs.readFileSync(path.join(data, "events.json"), "utf8"))[0].location, "식당");
  for (const name of ["todos.json", "memos.json", "events.json"]) assert.equal(fs.existsSync(path.join(home, name)), false, name);
  assert.equal(fs.existsSync(path.join(data, "ai-log.jsonl")), false);
  assert.deepEqual(logOf(home).map((entry) => [entry.target, entry.title]), [["todos", "공유 폴더 일"], ["memos", "첫 줄"], ["events", "점심"]]);
  assert.equal(fs.existsSync(path.join(home, aiLockFileName)), false, "the lock is let go");
  // The same event twice and the same memo twice go in once.
  assert.match((await call(client, "add_event", { title: "점심", date: "2026-10-28", start: "12:30" })).text, /이미 있어서/);
  assert.match((await call(client, "add_memo", { text: "첫 줄\n둘째 줄" })).text, /같은 메모가 이미 있어요/);
});

test("M17: a broken todos.json is never written over", async () => {
  const { env, data, home } = setup();
  fs.writeFileSync(path.join(data, "todos.json"), "{ \"items\": [ broken");
  const client = await connect(env);
  for (const [name, args] of [["add_todos", { items: [{ title: "x" }] }], ["get_today", {}], ["list_todos", {}]] as const) {
    const result = await call(client, name, args);
    assert.equal(result.error, true, name);
    assert.match(result.text, /todos\.json을 읽지 못해서 손대지 않았어요. 종이냥 앱에서 먼저 열어 주세요/);
  }
  assert.equal(fs.readFileSync(path.join(data, "todos.json"), "utf8"), "{ \"items\": [ broken");
  assert.equal(logOf(home).length, 0);
});

test("M18: in Dutch the words and dates are Dutch", async () => {
  const { env, data } = setup({ link: { lang: "nl" }, now: "2026-10-27T10:00:00+09:00" });
  writeTodos(data, [task({ title: "Verslag", timeStart: "14:00", timeEnd: "15:30" })]);
  fs.writeFileSync(path.join(data, "events.json"), serializeEvents([event({ title: "Overleg", date: "2026-10-27", start: 600, end: 660 })]));
  const client = await connect(env);
  const today = await call(client, "get_today");
  assert.match(today.text, /^Vandaag · di 27 okt/);
  assert.match(today.text, /Verslag · vandaag 14:00–15:30/);
  assert.match(today.text, /- 10:00–11:00 Overleg/);
  assert.match(today.text, /Focus 0 min · 0 sessies/);
  const added = await call(client, "add_todos", { items: [{ title: "Boodschappen", date: "2026-10-28" }] });
  assert.match(added.text, /^1 taak toegevoegd\./);
  assert.match(added.text, /Boodschappen · morgen/);
  const late = await call(client, "add_todos", { items: [{ title: "Laat", timeEnd: "15:00" }] });
  assert.match(late.text, /Er is een eindtijd maar geen begintijd/);
  const events = await call(client, "list_events", { from: "2026-10-27", to: "2026-10-28" });
  assert.match(events.text, /^1 afspraak\n\ndi 27 okt/);
});

test("reading: events spread over their days, memos, focus and the record", async () => {
  const { env, data } = setup({ now: "2026-10-27T10:00:00+09:00" });
  fs.writeFileSync(path.join(data, "events.json"), serializeEvents([event({ title: "매일 산책", date: "2026-10-01", repeat: "daily", start: 420, end: 450 })]));
  writeTodos(data, [task({ title: "끝낸 일", isCompleted: true, completedAt: "2026-10-27T00:30:00Z" }), task({ title: "언젠가", shelf: "later" }), task({ title: "다음 주", dueDate: "2026-11-03" })]);
  fs.mkdirSync(path.join(data, "archive"));
  fs.writeFileSync(path.join(data, "archive", "2026-10.jsonl"), `${JSON.stringify({ id: "old", title: "지난주 보고서", createdAt: "2026-10-19T00:00:00Z", completedAt: "2026-10-20T08:00:00Z" })}\n`);
  fs.writeFileSync(path.join(data, "memos.json"), JSON.stringify({ memos: [{ id: "m1", text: "장보기\n우유, 달걀", createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z" }] }));
  const client = await connect(env);
  const events = await call(client, "list_events", { from: "2026-10-27", to: "2026-10-29" });
  assert.equal((events.data.events as unknown[]).length, 3);
  assert.equal((events.data.events as { canChange: boolean }[])[0].canChange, false);
  assert.equal((await call(client, "list_events", { from: "2026-10-01", to: "2026-11-15" })).error, true);
  const later = await call(client, "list_todos", { where: "later" });
  assert.deepEqual((later.data.tasks as { title: string; where: string }[]).map((entry) => [entry.title, entry.where]), [["다음 주", "ahead"], ["언젠가", "someday"]]);
  const all = await call(client, "list_todos", { where: "all" });
  assert.equal((all.data.tasks as unknown[]).length, 3);
  const memos = await call(client, "list_memos", { query: "우유" });
  assert.match(memos.text, /- 장보기 — 우유, 달걀/);
  const history = await call(client, "search_history", { from: "2026-10-19", to: "2026-10-27" });
  assert.deepEqual((history.data.items as { title: string }[]).map((entry) => entry.title), ["끝낸 일", "지난주 보고서"]);
  assert.equal((await call(client, "search_history", { query: "보고서" })).data.count, 1);
  const focus = await call(client, "get_focus", { from: "2026-10-21", to: "2026-10-27" });
  assert.equal(focus.data.minutes, 0);
});

test("the app's Store and the extension write todos.json at the same time, 100 rounds: nothing lost", async () => {
  const { env, data, home } = setup();
  const store = new Store(data, false, home);
  store.aiLock = path.join(home, aiLockFileName);
  store.mutate((history) => history.add("시작"));
  const client = await connect(env);
  const rounds = 100;
  const pause = () => new Promise((resolve) => setTimeout(resolve, Math.random() * 6));
  const app = (async () => {
    for (let index = 0; index < rounds; index += 1) {
      await pause();
      store.mutate((history) => history.add(`앱 ${index}`));
      // Now and then an edit of something there, as a person would.
      if (index % 10 === 0) store.mutate((history) => history.toggle(history.items[0].id));
    }
  })();
  const claude = (async () => {
    for (let index = 0; index < rounds; index += 1) {
      const result = await call(client, "add_todos", { items: [{ title: `Claude ${index}` }] });
      assert.equal(result.error, false, result.text);
    }
  })();
  await Promise.all([app, claude]);
  store.catchUp(["todos.json"], true);
  const onDisk = todos(data).map((item) => item.title);
  const inApp = store.items.map((item) => item.title);
  for (let index = 0; index < rounds; index += 1) {
    assert.ok(onDisk.includes(`앱 ${index}`), `앱 ${index} on disk`);
    assert.ok(onDisk.includes(`Claude ${index}`), `Claude ${index} on disk`);
  }
  assert.equal(onDisk.length, rounds * 2 + 1);
  assert.deepEqual(inApp, onDisk);
  assert.equal(logOf(home).length, rounds);
  store.unwatch();
});

test("the Claude Code command: the app's own Electron runs the server as Node", async () => {
  const electron = createRequire(import.meta.url)("electron") as unknown as string;
  const { env, home } = setup();
  const client = await connect({ ...env, ELECTRON_RUN_AS_NODE: "1" }, electron, "claude-code");
  assert.equal(client.getServerVersion()?.name, "jongi-nyang");
  assert.equal((await call(client, "add_todos", { items: [{ title: "Electron으로" }] })).error, false);
  assert.equal(logOf(home)[0].client, "Claude Code");
});
