import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileLimits } from "../../src/core/fileLimits";
import { call, connect, setup, task, temporary, todos, writeTodos } from "./helpers";

/**
 * M42 (#173, security review L-04 · L-05): the extension's reads and writes follow the shared cases of
 * docs/plans/file-safety-cases.json — a data file that is a link is neither read nor written through (FILE_IS_LINK), one
 * past 32MB is not read (FILE_TOO_LARGE), what is only shown (the record's months) skips a link, and its temporary
 * files have random names and are never left behind. Fictional temporary folders only.
 */

const cases = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "file-safety-cases.json"), "utf8")) as { limits: { dataFileBytes: number } };

test("M42: the extension's limit is the shared one", () => {
  assert.equal(fileLimits.dataFileBytes, cases.limits.dataFileBytes);
});

test("M42: a linked todos.json is not read or written through; an oversized memos.json is not read; a linked month is skipped", async () => {
  const { env, data } = setup({ shared: true });
  const outside = temporary();
  const secret = path.join(outside, "elsewhere.json");
  writeTodos(outside, [task({ title: "남의 목록" })]);
  fs.renameSync(path.join(outside, "todos.json"), secret);
  fs.symlinkSync(secret, path.join(data, "todos.json"));
  fs.writeFileSync(path.join(data, "memos.json"), "");
  fs.truncateSync(path.join(data, "memos.json"), fileLimits.dataFileBytes + 1);
  const client = await connect(env);

  for (const [name, args] of [["get_today", {}], ["add_todos", { items: [{ title: "x" }] }]] as const) {
    const result = await call(client, name, args);
    assert.equal(result.data.error, "FILE_IS_LINK", `${name}: ${result.text}`);
    assert.match(result.text, /^todos\.json 자리에 링크가 있어서 읽거나 쓰지 않았어요\. 아무것도 바뀌지 않았어요\./);
  }
  assert.ok(fs.lstatSync(path.join(data, "todos.json")).isSymbolicLink());
  assert.match(fs.readFileSync(secret, "utf8"), /남의 목록/);
  assert.doesNotMatch(fs.readFileSync(secret, "utf8"), /"x"/);

  const memo = await call(client, "add_memo", { text: "x" });
  assert.equal(memo.data.error, "FILE_TOO_LARGE", memo.text);
  assert.match(memo.text, /^memos\.json이 32MB보다 커서 읽지 않았어요\./);
  assert.equal(fs.statSync(path.join(data, "memos.json")).size, fileLimits.dataFileBytes + 1, "untouched");

  // Normal files again: a linked month of the record is skipped (only shown), the rest works, no temporary file stays.
  fs.unlinkSync(path.join(data, "todos.json"));
  fs.rmSync(path.join(data, "memos.json"));
  writeTodos(data, [task({ title: "내 할 일" })]);
  fs.mkdirSync(path.join(data, "archive"));
  fs.writeFileSync(path.join(outside, "month.jsonl"), `{"id":"s","title":"남의 기록","createdAt":"2026-10-01T09:00:00Z","completedAt":"2026-10-20T10:00:00Z"}\n`);
  fs.symlinkSync(path.join(outside, "month.jsonl"), path.join(data, "archive", "2026-10.jsonl"));
  const history = await call(client, "search_history", {});
  assert.equal(history.error, false, history.text);
  assert.doesNotMatch(history.text, /남의 기록/);
  const added = await call(client, "add_todos", { items: [{ title: "새 할 일" }] });
  assert.equal(added.error, false, added.text);
  assert.deepEqual(todos(data).map((item) => item.title).sort(), ["내 할 일", "새 할 일"].sort());
  assert.deepEqual(fs.readdirSync(data).filter((name) => name.endsWith(".tmp")), []);
});
