// The time zone first, before any Date: the server runs under the same one.
process.env.TZ = "Asia/Seoul";

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { test } from "node:test";
import { aiLockFileName, serializeAiLink } from "../../src/core/ai";
import { parseEvents, serializeEvents } from "../../src/core/events";
import { parseMemos } from "../../src/core/memo";
import { parseNotebook, serializeNotebook } from "../../src/core/notebook";
import { Store } from "../../src/main/store";
import { assertNoPath, call, connect, event, logOf, setup, stderrOf, task, temporary, todos, writeTodos } from "./helpers";

/**
 * 종이냥 for Claude: the real bundled server (mcp/dist/server/index.js) over stdio with the SDK's client (helpers.ts),
 * on temporary folders only (PAPERTODO_AI_HOME). Cases M1–M12 and M16–M18 of the shared AI connection spec,
 * M32–M34 (tool marks, all or nothing, no paths in errors), and the app's Store writing todos.json while the
 * extension adds to it. The newer cases (M19–M41) are in cases.test.ts and size.test.ts.
 */

const allTools: [string, Record<string, unknown>][] = [
  ["get_today", {}], ["list_todos", {}], ["list_events", { from: "2026-10-27" }], ["list_memos", {}], ["get_focus", {}], ["search_history", {}],
  ["get_memo", { id: "ABCDEFGH" }], ["list_memo_folders", {}], ["list_repeats", {}],
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
  // Short ids (P1): the first 8 characters.
  assert.equal(skipped[0].id, existing.id.slice(0, 8));
  assert.match(result.text, /이미 있어서 넣지 않았어요/);
  assert.match(result.text, new RegExp(`id ${existing.id.slice(0, 8)}$`, "m"));
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
  // A key that isn't a task's field (delete) is refused by the schema itself now (C3, M38), before the tool runs.
  const remove = await call(client, "preview_changes", { changes: [{ kind: "todo", id: item.id, set: { delete: true } }] });
  assert.equal(remove.error, true);
  assert.match(remove.text, /Unrecognized key: "delete"/);
  assert.equal(todos(data)[0].title, "보고서");
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

test("M32: tools/list marks reading, adding and changing; apply_changes asks a person on every call in Claude Code", async () => {
  const { env } = setup();
  const client = await connect(env);
  const tools = Object.fromEntries((await client.listTools()).tools.map((tool) => [tool.name, tool]));
  for (const name of ["get_today", "list_todos", "list_events", "list_memos", "get_memo", "list_memo_folders", "list_repeats", "get_focus", "search_history", "preview_changes"]) {
    assert.equal(tools[name].annotations?.readOnlyHint, true, name);
    assert.equal(tools[name].annotations?.openWorldHint, false, name);
    assert.equal(tools[name]._meta?.["anthropic/requiresUserInteraction"], undefined, name);
  }
  for (const name of ["add_todos", "add_event", "add_memo"]) {
    const marks = tools[name].annotations;
    assert.deepEqual([marks?.readOnlyHint, marks?.destructiveHint, marks?.idempotentHint, marks?.openWorldHint], [false, false, true, false], name);
    assert.equal(tools[name]._meta?.["anthropic/requiresUserInteraction"], undefined, name);
  }
  const apply = tools.apply_changes;
  assert.deepEqual([apply.annotations?.readOnlyHint, apply.annotations?.destructiveHint, apply.annotations?.idempotentHint, apply.annotations?.openWorldHint], [false, true, false, false]);
  // The JSON Boolean true exactly: Claude Code ignores any other value.
  assert.equal(apply._meta?.["anthropic/requiresUserInteraction"], true);
  for (const tool of Object.values(tools)) assert.ok(tool.title && tool.annotations?.title, `${tool.name} has a title`);
});

/**
 * A to-do and an event, both previewed for a change. todos.json is written as another program might (not
 * the app's bytes), so putting it back has to be byte for byte. `extra` gives the server's test hooks.
 */
async function previewBoth(extra: (data: string) => Record<string, string> = () => ({})) {
  const prepared = setup({ now: "2026-10-27T10:00:00+09:00" });
  const { env, data } = prepared;
  const report = task({ title: "보고서 쓰기", timeStart: "15:00", timeEnd: "16:00" });
  const meeting = event({ title: "팀 회의", date: "2026-10-28", start: 600, end: 660 });
  fs.writeFileSync(path.join(data, "todos.json"), `${JSON.stringify({ items: [report] }, null, 4)}\n\n`);
  fs.writeFileSync(path.join(data, "events.json"), serializeEvents([meeting]));
  const before = { todos: fs.readFileSync(path.join(data, "todos.json")), events: fs.readFileSync(path.join(data, "events.json")) };
  const client = await connect({ ...env, ...extra(data) });
  const preview = await call(client, "preview_changes", { changes: [
    { kind: "todo", id: report.id, set: { title: "보고서 마무리" } },
    { kind: "event", id: meeting.id, set: { start: "11:00" } },
  ] });
  assert.equal(preview.error, false, preview.text);
  return { ...prepared, client, meeting, before, token: preview.data.token as string };
}
const leftovers = (folder: string) => fs.readdirSync(folder).filter((name) => name.endsWith(".tmp"));

test("M33: the event changes between the check and the write: nothing is applied, not the to-do either, nothing logged (#110)", async () => {
  // The race file lands on events.json after both files were read and checked, just before the write.
  const { data, home, client, meeting, before, token } = await previewBoth((data) => ({ PAPERTODO_AI_RACE: path.join(data, "events.json.race") }));
  const moved = { ...meeting, title: "팀 회의 (앱에서 옮김)", start: 720, end: 780, updatedAt: "2026-10-27T01:01:00Z" };
  fs.writeFileSync(path.join(data, "events.json.race"), serializeEvents([moved]));
  const applied = await call(client, "apply_changes", { token });
  assert.equal(applied.error, true, applied.text);
  assert.equal(applied.data.error, "ITEM_CHANGED");
  assert.match(applied.text, /미리보기 뒤에 바뀐 항목이 있어서 적용하지 않았어요: ‘팀 회의’\. .*\(코드 ITEM_CHANGED\)$/);
  assert.equal(fs.existsSync(path.join(data, "events.json.race")), false, "the race happened");
  assert.ok(fs.readFileSync(path.join(data, "todos.json")).equals(before.todos), "the to-do is as it was, byte for byte");
  assert.equal(parseEvents(fs.readFileSync(path.join(data, "events.json"), "utf8"))[0].title, "팀 회의 (앱에서 옮김)", "the app's change stays");
  assert.equal(logOf(home).length, 0, "nothing logged");
  assert.deepEqual(leftovers(data), []);
});

test("M33: a write that fails halfway puts the first file's previous bytes back and logs nothing (#110)", async () => {
  const { data, home, client, before, token } = await previewBoth(() => ({ PAPERTODO_AI_BREAK: "events.json" }));
  const applied = await call(client, "apply_changes", { token });
  assert.equal(applied.error, true, applied.text);
  assert.equal(applied.data.error, "FILE_NOT_FOUND");
  assert.match(applied.text, /^events\.json을 쓸 자리를 찾지 못했어요\. .*아무것도 바뀌지 않았어요\. \(코드 FILE_NOT_FOUND\)$/);
  assertNoPath(applied.text, "apply_changes", home, data);
  assert.ok(fs.readFileSync(path.join(data, "todos.json")).equals(before.todos), "todos.json has its previous bytes back");
  assert.ok(fs.readFileSync(path.join(data, "events.json")).equals(before.events), "events.json untouched");
  assert.equal(logOf(home).length, 0, "nothing logged as applied");
  assert.deepEqual(leftovers(data), []);
  assert.equal(fs.existsSync(path.join(home, aiLockFileName)), false, "the lock is let go");
});

test("M34: every failure is a fixed code and sentence — no path, home folder or user name, in the answer, stderr or the log (#109)", async () => {
  const { env, home } = setup();
  // A storage folder whose path holds the user's name (fictional data only).
  const data = path.join(temporary(), os.userInfo().username, "종이냥 저장");
  fs.mkdirSync(data, { recursive: true });
  const relink = (folder: string, lang: "ko" | "en" | "nl" = "ko") =>
    fs.writeFileSync(path.join(home, "ai-link.json"), serializeAiLink({ v: 1, enabled: true, dataFolder: folder, lang, app: "windows 1.30.1", updatedAt: "2026-10-27T00:00:00Z" }));
  relink(data);
  const client = await connect(env);
  const failing = async (name: string, args: Record<string, unknown>, code: string, sentence?: RegExp) => {
    const result = await call(client, name, args);
    const label = `${name} → ${code}`;
    assert.equal(result.error, true, `${label}: ${result.text}`);
    assert.equal(result.data.error, code, `${label}: ${result.text}`);
    assert.match(result.text, new RegExp(`\\((코드|code) ${code}\\)$`), label);
    if (sentence) assert.match(result.text, sentence, label);
    assertNoPath(result.text, label, home, data);
    return result;
  };
  const folderInstead = (name: string) => { fs.mkdirSync(path.join(data, name)); fs.writeFileSync(path.join(data, name, "안.txt"), "x"); };
  const clear = (name: string) => fs.rmSync(path.join(data, name), { recursive: true, force: true });

  // A folder where a data file should be (EISDIR), for every tool that opens one.
  for (const name of ["todos.json", "events.json", "memos.json"]) folderInstead(name);
  const isFolder = (file: string) => new RegExp(`^${file.replace(".", "\\.")} 자리에 파일이 아닌 것이 있어서 읽거나 쓰지 못했어요\\. 아무것도 바뀌지 않았어요\\.`);
  const todoTools: [string, Record<string, unknown>][] = [["get_today", {}], ["list_todos", {}], ["search_history", {}], ["add_todos", { items: [{ title: "x" }] }],
    ["preview_changes", { changes: [{ kind: "todo", id: "A", set: { title: "y" } }] }]];
  for (const [name, args] of todoTools) await failing(name, args, "FILE_IS_FOLDER", isFolder("todos.json"));
  for (const [name, args] of [["list_events", { from: "2026-10-27" }], ["add_event", { title: "x", date: "2026-10-28", start: "10:00" }]] as const) await failing(name, args, "FILE_IS_FOLDER", isFolder("events.json"));
  for (const [name, args] of [["list_memos", {}], ["add_memo", { text: "x" }]] as const) await failing(name, args, "FILE_IS_FOLDER", isFolder("memos.json"));
  // The same in English and Dutch.
  relink(data, "en");
  await failing("get_today", {}, "FILE_IS_FOLDER", /^todos\.json isn’t a file, so it couldn’t be read or written\. Nothing was changed\./);
  relink(data, "nl");
  await failing("add_memo", { text: "x" }, "FILE_IS_FOLDER", /^memos\.json is geen bestand, dus het kon niet worden gelezen of geschreven\. Er is niets gewijzigd\./);
  relink(data);
  for (const name of ["todos.json", "events.json", "memos.json"]) clear(name);

  // No permission (EACCES): reading and writing refused, the file untouched. (Not as root, not on Windows.)
  if (process.platform !== "win32" && process.getuid?.() !== 0) {
    writeTodos(data, [task({ title: "잠긴 할 일" })]);
    const locked = fs.readFileSync(path.join(data, "todos.json"));
    fs.chmodSync(path.join(data, "todos.json"), 0o000);
    try {
      await failing("get_today", {}, "FILE_NO_ACCESS", /^todos\.json을 열 권한이 없어서/);
      await failing("add_todos", { items: [{ title: "x" }] }, "FILE_NO_ACCESS");
    } finally { fs.chmodSync(path.join(data, "todos.json"), 0o644); }
    assert.ok(fs.readFileSync(path.join(data, "todos.json")).equals(locked));
    clear("todos.json");
  }

  // Broken JSON (with the folder's path inside it): the parser's text never goes out.
  fs.writeFileSync(path.join(data, "events.json"), `{ "events": [ ${data} `);
  await failing("list_events", { from: "2026-10-27" }, "FILE_UNREADABLE", /^events\.json을 읽지 못해서 손대지 않았어요/);
  await failing("add_event", { title: "x", date: "2026-10-28", start: "10:00" }, "FILE_UNREADABLE");
  clear("events.json");

  // The storage folder is gone (ENOENT on the write).
  relink(path.join(data, "없는 폴더"));
  await failing("add_todos", { items: [{ title: "x" }] }, "FILE_NOT_FOUND", /^todos\.json을 쓸 자리를 찾지 못했어요/);
  await failing("add_memo", { text: "x" }, "FILE_NOT_FOUND");
  relink(data);

  // A conflict: changed in the app after the preview.
  const item = task({ title: "보고서" });
  writeTodos(data, [item]);
  const preview = await call(client, "preview_changes", { changes: [{ kind: "todo", id: item.id, set: { title: "보고서 끝" } }] });
  writeTodos(data, [{ ...item, title: "보고서 (앱)" }]);
  await failing("apply_changes", { token: preview.data.token as string }, "ITEM_CHANGED");

  // What works still works, and its log line has no path either.
  assert.equal((await call(client, "add_todos", { items: [{ title: "다시 됨" }] })).error, false);
  assert.equal(logOf(home).length, 1);
  assertNoPath(fs.readFileSync(path.join(home, "ai-log.jsonl"), "utf8"), "ai-log.jsonl", home, data);
  // stderr (Claude's MCP log on this device) gets the codes for finding the cause — still no path.
  const stderr = stderrOf.get(client)!();
  assert.match(stderr, /jongi-nyang: FILE_IS_FOLDER EISDIR todos\.json/);
  assertNoPath(stderr, "stderr", home, data);
});
