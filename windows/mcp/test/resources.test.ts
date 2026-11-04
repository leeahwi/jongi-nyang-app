// The time zone first, before any Date: the server runs under the same one.
process.env.TZ = "Asia/Seoul";

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { aiOffText, serializeAiLink } from "../../src/core/ai";
import { serializeEvents } from "../../src/core/events";
import { serializeMemos, type Memo } from "../../src/core/memo";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { assertNoPath, call, connect, event, setup, task, writeTodos } from "./helpers";

/**
 * C2 (docs/plans/mcp-plan.md ‘2c에서 정한 것’), M37: today, this week and a week by its day, and one memo, as resources —
 * resources/list has only today and this week, memos come by their template and the links get_memo and list_memos give,
 * and with AI 연결 off nothing is opened. Fictional data only, in temporary folders.
 */

const readText = async (client: Client, uri: string) => {
  const result = await client.readResource({ uri });
  return { text: (result.contents[0] as { text: string }).text, mimeType: result.contents[0].mimeType };
};

test("M37: the list has today and this week only; the templates are a week and a memo", async () => {
  const { env } = setup();
  const client = await connect(env);
  const list = await client.listResources();
  assert.deepEqual(list.resources.map((entry) => entry.uri), ["jongi-nyang://today", "jongi-nyang://week"]);
  const templates = await client.listResourceTemplates();
  assert.deepEqual(templates.resourceTemplates.map((entry) => entry.uriTemplate).sort(), ["jongi-nyang://memo/{id}", "jongi-nyang://week/{date}"]);
  assert.equal(templates.resourceTemplates.find((entry) => entry.uriTemplate.includes("memo"))?.mimeType, "text/markdown");
});

test("M37: today is get_today's text; a week goes day by day with events, open tasks and what was finished", async () => {
  const { env, data } = setup();
  writeTodos(data, [task({ title: "보고서 쓰기" }), task({ title: "견적서 보내기", dueDate: "2026-10-29" }), task({ title: "회의록", isCompleted: true, completedAt: "2026-10-26T03:00:00Z" }), task({ title: "책 읽기", shelf: "later" })]);
  fs.writeFileSync(path.join(data, "events.json"), serializeEvents([event({ title: "팀 회의", date: "2026-10-28", start: 600, end: 660 })]));
  const client = await connect(env);
  const today = await readText(client, "jongi-nyang://today");
  assert.equal(today.text, (await call(client, "get_today")).text);
  const week = await readText(client, "jongi-nyang://week");
  // ko: the week from Sunday (10월 25일) as the 앞으로 tab counts it; today is Tuesday 10월 27일.
  assert.match(week.text, /^한 주 · /);
  assert.match(week.text, /10월 26일 \(월\)\n- \[x\] 회의록/);
  assert.match(week.text, /10월 27일 \(화\) · 오늘\n- \[ \] 보고서 쓰기/);
  assert.match(week.text, /10월 28일 \(수\)\n- 10:00–11:00 팀 회의 · id /);
  assert.match(week.text, /10월 29일 \(목\)\n- \[ \] 견적서 보내기/);
  assert.match(week.text, /날짜 없는 할 일\(언젠가\) 1개$/);
  const later = await readText(client, "jongi-nyang://week/2026-11-04");
  assert.match(later.text, /11월 1일 \(일\)\n- 없음/);
  const wrong = await readText(client, "jongi-nyang://week/next-week");
  assert.match(wrong.text, /날짜를 읽지 못했어요/);
});

test("M37 · C2-2: a memo by its template, whole and as written; get_memo and list_memos link to it", async () => {
  const { env, data } = setup();
  const long = `장보기\n${"- [ ] 우유\n".repeat(600)}끝`;
  const memo: Memo = { id: crypto.randomUUID().toUpperCase(), text: long, createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z" };
  fs.writeFileSync(path.join(data, "memos.json"), serializeMemos([memo]));
  const client = await connect(env);
  const short = memo.id.slice(0, 8);
  const read = await readText(client, `jongi-nyang://memo/${short}`);
  assert.equal(read.mimeType, "text/markdown");
  assert.equal(read.text, long, "not cut at 4,000 characters, markdown as written");
  const got = await client.callTool({ name: "get_memo", arguments: { id: short } }) as { content: { type: string; uri?: string; name?: string }[] };
  assert.deepEqual(got.content.filter((part) => part.type === "resource_link").map((part) => [part.uri, part.name]), [[`jongi-nyang://memo/${short}`, "장보기"]]);
  const listed = await client.callTool({ name: "list_memos", arguments: {} }) as { content: { type: string; uri?: string }[] };
  assert.equal(listed.content.filter((part) => part.type === "resource_link").length, 1);
  const missing = await readText(client, "jongi-nyang://memo/ZZZZZZZZ");
  assert.match(missing.text, /이 id의 메모가 없어요/);
  assertNoPath(missing.text, "a missing memo", data);
});

test("M37: off, every resource only says to turn it on, and no data file is opened", async () => {
  const { env, data, home } = setup();
  // A broken todos.json: had it been opened, the answer would say it couldn't read it.
  fs.writeFileSync(path.join(data, "todos.json"), "{ broken");
  fs.writeFileSync(path.join(home, "ai-link.json"), serializeAiLink({ v: 1, enabled: false, dataFolder: data, lang: "en", app: "", updatedAt: "" }));
  const client = await connect(env);
  for (const uri of ["jongi-nyang://today", "jongi-nyang://week", "jongi-nyang://week/2026-10-27", "jongi-nyang://memo/ABCDEFGH"]) {
    const read = await readText(client, uri);
    assert.equal(read.text, aiOffText("en"), uri);
    assert.equal(read.mimeType, "text/plain", uri);
  }
});
