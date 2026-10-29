import assert from "node:assert/strict";
import { test } from "node:test";
import {
  advanceSeen, aiCatLine, aiChangeKind, aiLogLine, aiMarks, aiShortTitle, aiToastText, aiAwayText, aiUndoText, awayCount, parseAiLink, parseAiLog,
  recentAi, sameSaved, serializeAiLink, trimAiLog, undoEntry, undoneIds, unseenAi, type AiChange, type AiItem, type AiLogEntry,
} from "../src/core/ai";

/** 종이냥 for Claude: the shared files and the app's side of them (the shared AI connection spec §2–3, §7; M13–M15). */

const local = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
const iso = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
const item = (fields: Record<string, unknown> & { id: string }): AiItem => ({ title: "보고서 쓰기", isCompleted: false, createdAt: "2026-10-20T00:00:00Z", ...fields });
const entry = (fields: Partial<AiLogEntry> & { changes: AiChange[] }): AiLogEntry => ({
  v: 1, id: `E${Math.random()}`, at: iso(local(27, 10)), client: "Claude", tool: "add_todos", kind: "add", target: "todos", count: fields.changes.length, title: "보고서 쓰기", ...fields,
});
const added = (after: AiItem): AiChange => ({ file: "todos.json", id: after.id, before: null, after });
const changed = (before: AiItem, after: AiItem): AiChange => ({ file: "todos.json", id: after.id, before, after });

test("ai-link.json: read leniently, written with fixed keys", () => {
  const text = serializeAiLink({ v: 1, enabled: true, dataFolder: "C:\\Users\\noa\\AppData\\Roaming\\PaperTodo", lang: "nl", app: "windows 1.27.0", updatedAt: "2026-10-27T05:00:00Z" });
  assert.equal(text, '{\n  "v": 1,\n  "enabled": true,\n  "dataFolder": "C:\\\\Users\\\\noa\\\\AppData\\\\Roaming\\\\PaperTodo",\n  "lang": "nl",\n  "app": "windows 1.27.0",\n  "updatedAt": "2026-10-27T05:00:00Z"\n}\n');
  assert.equal(parseAiLink(text)?.lang, "nl");
  assert.equal(parseAiLink('{"enabled":"yes"}')?.enabled, false);
  assert.equal(parseAiLink("{ broken"), undefined);
  // The Mac writes its keys sorted; the same values read.
  assert.deepEqual(parseAiLink('{"app":"mac 1.42.0","dataFolder":"/x","enabled":true,"lang":"en","updatedAt":"","v":1}'), { v: 1, enabled: true, dataFolder: "/x", lang: "en", app: "mac 1.42.0", updatedAt: "" });
});

test("ai-log.jsonl: lines read back, a torn line and unknown kinds left out", () => {
  const one = entry({ changes: [added(item({ id: "A" }))] });
  const text = `${aiLogLine(one)}\n{"v":1,"id":"x","at":"2026-10-27T01:00:00Z","kind":"rename","target":"todos","changes":[]}\n{"v":1,"id":"torn","at":"2026`;
  const read = parseAiLog(text);
  assert.equal(read.length, 1);
  assert.deepEqual(read[0], one);
  assert.match(aiLogLine(one), /^\{"v":1,"id":"E[^"]+","at":"2026-10-27T01:00:00Z","client":"Claude","tool":"add_todos","kind":"add","target":"todos","count":1,"title":"보고서 쓰기","changes":\[/);
});

test("toasts, as on the Mac (AIText.toast)", () => {
  const a = item({ id: "A" });
  assert.equal(aiToastText(entry({ changes: [added(a), added(item({ id: "B" }))] }), "ko"), "Claude가 할 일 2개를 넣었어요");
  assert.equal(aiToastText(entry({ changes: [added(a), added(item({ id: "B" }))] }), "en"), "Claude added 2 tasks");
  assert.equal(aiToastText(entry({ changes: [added(a)] }), "nl"), "Claude heeft 1 taak toegevoegd");
  assert.equal(aiToastText(entry({ target: "memos", changes: [{ file: "memos.json", id: "M", before: null, after: { id: "M", text: "x" } }] }), "en"), "Claude added 1 note");
  assert.equal(aiToastText(entry({ target: "events", changes: [{ file: "events.json", id: "V", before: null, after: { id: "V", title: "회의" } }, { file: "events.json", id: "W", before: null, after: { id: "W", title: "점심" } }] }), "nl"), "Claude heeft 2 afspraken toegevoegd");
  const time = entry({ kind: "change", changes: [changed(item({ id: "A", timeStart: "15:00", reminderAt: "2026-10-27T06:00:00Z" }), item({ id: "A", timeStart: "16:00", reminderAt: "2026-10-27T07:00:00Z" }))] });
  assert.equal(aiToastText(time, "ko"), "Claude가 ‘보고서 쓰기’ 시간을 바꿨어요");
  assert.equal(aiToastText(time, "en"), "Claude changed the time of ‘보고서 쓰기’");
  assert.equal(aiToastText(time, "nl"), "Claude heeft de tijd van ‘보고서 쓰기’ gewijzigd");
  const date = entry({ kind: "change", changes: [changed(item({ id: "A" }), item({ id: "A", dueDate: "2026-10-29" }))] });
  assert.equal(aiToastText(date, "ko"), "Claude가 ‘보고서 쓰기’ 날짜를 바꿨어요");
  const done = entry({ kind: "change", changes: [changed(item({ id: "A" }), item({ id: "A", isCompleted: true, completedAt: "2026-10-27T01:00:00Z" }))] });
  assert.equal(aiToastText(done, "en"), "Claude checked off ‘보고서 쓰기’");
  const other = entry({ kind: "change", title: "아주 긴 제목이 들어간 할 일, 스물네 글자를 넘어가요", changes: [changed(item({ id: "A" }), item({ id: "A", title: "아주 긴 제목이 들어간 할 일, 스물네 글자를 넘어가요" }))] });
  assert.equal(aiToastText(other, "ko"), "Claude가 ‘아주 긴 제목이 들어간 할 일, 스물네 글…’ 할 일을 바꿨어요");
  assert.equal(aiToastText(entry({ kind: "change", target: "events", title: "회의", changes: [{ file: "events.json", id: "V", before: { id: "V", title: "회의", location: "1층" }, after: { id: "V", title: "회의", location: "2층" } }] }), "nl"), "Claude heeft de afspraak ‘회의’ gewijzigd");
  assert.equal(aiToastText(entry({ kind: "change", changes: [changed(item({ id: "A" }), item({ id: "A", title: "x" })), changed(item({ id: "B" }), item({ id: "B", title: "y" }))] }), "ko"), "Claude가 할 일 2개를 바꿨어요");
  assert.equal(aiChangeKind(changed(item({ id: "A" }), item({ id: "A", reminderAt: "2026-10-27T07:00:00Z" }))), "time");
  assert.equal(aiShortTitle("첫 줄\n둘째 줄"), "첫 줄");
  assert.equal(aiAwayText(3, "ko"), "자리 비운 사이 Claude가 3가지를 했어요");
  assert.equal(aiAwayText(1, "en"), "While you were away, Claude made 1 change");
  assert.equal(aiAwayText(3, "nl"), "Terwijl je weg was, heeft Claude 3 dingen gedaan");
  assert.equal(aiUndoText(2, 0, "ko"), "되돌렸어요");
  assert.equal(aiUndoText(0, 1, "en"), "It changed since, so it can’t be undone");
  assert.equal(aiUndoText(1, 1, "ko"), "1개는 되돌리고, 그새 바뀐 1개는 그대로 뒀어요");
  assert.equal(aiUndoText(1, 2, "nl"), "1 ongedaan gemaakt; 2 intussen gewijzigd, die blijven staan");
});

test("M13–M14: undo puts back what is still as Claude left it, and leaves what changed since", () => {
  const before = item({ id: "A", timeStart: "15:00" });
  const after = item({ id: "A", timeStart: "16:00" });
  const extra = item({ id: "b" });
  const log = entry({ kind: "change", changes: [changed(before, after)] });
  // Untouched (bookkeeping aside: the 어제부터 day, a reminder that came, ".000Z"): back to before.
  const back = undoEntry([{ ...after, todaySince: "2026-10-27", reminderLastDeliveredAt: "x" } as AiItem], log);
  assert.deepEqual([back.undone, back.left, back.items[0].timeStart], [1, 0, "15:00"]);
  assert.deepEqual(back.written, [{ file: "todos.json", id: "A", before: { ...after, todaySince: "2026-10-27", reminderLastDeliveredAt: "x" }, after: before }]);
  // Changed here since: left alone.
  const kept = undoEntry([{ ...after, title: "고친 제목" }], log);
  assert.deepEqual([kept.undone, kept.left, kept.written.length, kept.items[0].title], [0, 1, 0, "고친 제목"]);
  // An add: the item goes (ids upper- or lower-case); already gone counts as undone without writing.
  const add = entry({ changes: [added(item({ id: "B" })), added(item({ id: "C" }))] });
  const removed = undoEntry([extra, item({ id: "C", title: "고침" })], add);
  assert.deepEqual([removed.undone, removed.left, removed.items.map((entry) => entry.id)], [1, 1, ["C"]]);
  assert.deepEqual(removed.written, [{ file: "todos.json", id: "B", before: extra, after: null }]);
  // Times compared as instants; a missing flag reads false.
  assert.equal(sameSaved("todos", { id: "A", reminderAt: "2026-10-27T06:00:00.000Z" }, { id: "A", reminderAt: "2026-10-27T06:00:00Z", isCompleted: false }), true);
  assert.equal(sameSaved("events", { id: "V", allDay: false, title: "x" }, { id: "V", title: "x", updatedAt: "later" }), true);
});

test("M15: seen until, the away count and the recent list", () => {
  const first = entry({ id: "1", at: iso(local(26, 22)), changes: [added(item({ id: "A" }))] });
  const second = entry({ id: "2", at: iso(local(27, 9)), changes: [added(item({ id: "B" })), added(item({ id: "C" }))] });
  const third = entry({ id: "3", at: iso(local(27, 9, 5)), kind: "change", changes: [changed(item({ id: "A" }), item({ id: "A", title: "x" }))] });
  const undo = entry({ id: "4", at: iso(local(27, 9, 6)), client: "app", tool: "undo", kind: "undo", undoes: "3", changes: [] });
  const all = [first, second, third, undo];
  assert.deepEqual(unseenAi(all, { id: "1", at: first.at }).map((entry) => entry.id), ["2", "3", "4"]);
  assert.deepEqual(unseenAi(all.slice(1), { id: "gone", at: first.at }).map((entry) => entry.id), ["2", "3", "4"], "trimmed: by time");
  assert.equal(awayCount(unseenAi(all, { id: "1", at: first.at }), undoneIds(all)), 2);
  assert.equal(awayCount(all, new Set()), 4);
  assert.deepEqual(advanceSeen(undefined, all), { id: "4", at: undo.at });
  assert.deepEqual(advanceSeen({ id: "4", at: undo.at }, []), { id: "4", at: undo.at });
  assert.deepEqual(recentAi(all, local(27, 12)).map((entry) => entry.id), ["3", "2", "1"]);
  assert.deepEqual(recentAi(all, local(29, 12)), []);
});

test("marks: today's, not undone, still as Claude left them", () => {
  const a = item({ id: "a1" }), b = item({ id: "B2" }), c = item({ id: "C3" });
  const today = entry({ id: "t", at: iso(local(27, 3)), changes: [added(a), added(b)] }); // 03:00 still belongs to the 26th
  const later = entry({ id: "u", at: iso(local(27, 9)), changes: [added(c)] });
  const yesterday = entry({ id: "y", at: iso(local(26, 3, 59)), changes: [added(item({ id: "D" }))] });
  const list = new Map([["A1", a], ["B2", { ...b, title: "고침" }], ["C3", c], ["D", item({ id: "D" })]]);
  const current = (_target: string, id: string) => list.get(id.toUpperCase());
  assert.deepEqual([...aiMarks([today, later, yesterday], local(27, 3, 30), current)].sort(), ["A1"]);
  assert.deepEqual([...aiMarks([today, later, yesterday], local(27, 10), current)], ["C3"]);
  assert.deepEqual([...aiMarks([later, entry({ kind: "undo", client: "app", undoes: "u", changes: [] })], local(27, 10), current)], []);
});

test("the log trimmed past its size to 30 days", () => {
  const old = aiLogLine(entry({ id: "old", at: "2026-08-01T00:00:00Z", changes: [] }));
  const recent = aiLogLine(entry({ id: "new", at: "2026-10-26T00:00:00Z", changes: [] }));
  assert.equal(trimAiLog(`${old}\n${recent}\n`, local(27, 10)), undefined, "small enough");
  assert.equal(trimAiLog(`${old}\n${recent}\nbroken\n`, local(27, 10), 10), `${recent}\n`);
  assert.equal(trimAiLog(`${recent}\n`, local(27, 10), 10), undefined, "nothing would go");
});

test("the cat now and then, in its own words", () => {
  const two = entry({ changes: [added(item({ id: "A" })), added(item({ id: "B" }))] });
  const now = local(27, 10);
  assert.equal(aiCatLine(two, undefined, now, () => 0.1, "ko"), "Claude가 할 일 두 개 놓고 갔어요.");
  assert.equal(aiCatLine(two, undefined, now, () => 0.1, "en"), "Claude left two tasks for you.");
  assert.equal(aiCatLine(entry({ changes: [added(item({ id: "A" }))] }), undefined, now, () => 0.1, "nl"), "Claude heeft één taak voor je klaargezet.");
  assert.equal(aiCatLine(two, undefined, now, () => 0.9, "ko"), undefined);
  assert.equal(aiCatLine(two, now.getTime() - 3_600_000, now, () => 0.1, "ko"), undefined);
  assert.equal(aiCatLine(entry({ kind: "change", changes: [] }), undefined, now, () => 0.1, "ko"), "Claude랑 계획 세웠어요? 저도 볼게요.");
});
