import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { makeBackup, mergeFiles, parseBackup, replaceFiles } from "../src/core/backup";
import { parseNotebook, serializeNotebook } from "../src/core/notebook";
import {
  activeLens, addSpace, deleteSpace, emptyTodoSpaces, findSpaceToken, inLens, lensFor, lensForDigit, lensNone, liveSpaces, mergeTodoSpaces, moveTodo,
  newSpaceID, nextSpaceColor, objectParticle, parseTodoSpaces, pruneTodoSpaces, readLens, readLine, recolorSpace, renameSpace, reorderSpaces, restoreSpace,
  roParticle, serializeTodoSpaces, spaceChoices, spaceIndex, spaceIndexOf, spaceLineProblem, spaceOf, takesSpace, type SpaceChoice, type TodoSpaces,
} from "../src/core/todoSpaces";
import { Store } from "../src/main/store";

// 할 일 스페이스: the shared cases S1–S22, verbatim from docs/plans/spaces-phase1.md §6 (the Mac's TodoSpacesTests.swift).
// 준비: 회사(s-a) · 집(s-b) · 공부(s-c) in that order; A업무(s-d) is made later.

const at = (text: string) => new Date(text);
const SAMPLE = `{
  "items": {
    "T1": {
      "at": "2026-10-28T09:01:00Z",
      "space": "s-a"
    }
  },
  "spaces": [
    {
      "color": "pink",
      "id": "s-a",
      "name": "회사",
      "order": 0,
      "updatedAt": "2026-10-28T09:00:00Z"
    },
    {
      "color": "mint",
      "id": "s-b",
      "name": "집",
      "order": 1,
      "updatedAt": "2026-10-28T09:00:00Z"
    },
    {
      "color": "sky",
      "id": "s-c",
      "name": "공부",
      "order": 2,
      "updatedAt": "2026-10-28T09:00:00Z"
    }
  ],
  "version": 1
}
`;
const prepared = (): TodoSpaces => parseTodoSpaces(SAMPLE);
const choice = (data: TodoSpaces, text: string, lens?: string) => readLine(text, data, lens, at("2026-10-28T01:00:00Z"));
const first = (choices: SpaceChoice[]) => choices[0];
const space = (id: string): SpaceChoice => ({ kind: "space", id });

test("the file round-trips byte for byte, sorted and fully spread out (W2)", () => {
  assert.equal(serializeTodoSpaces(prepared()), SAMPLE);
  assert.equal(serializeTodoSpaces(emptyTodoSpaces()), '{\n  "items": {},\n  "spaces": [],\n  "version": 1\n}\n');
  // Keys of a file written in another order come out sorted; times to the second, UTC.
  const loose = parseTodoSpaces('{"version":1,"spaces":[{"updatedAt":"2026-10-28T18:00:00.500+09:00","order":0,"name":"a/b \\"q\\"\\n","id":"s-1","color":"pink"}],"items":{"B":{"space":null,"at":"2026-10-28T09:00:00Z"},"A":{"space":"s-1","at":"bad"}}}');
  assert.equal(serializeTodoSpaces(loose), `{
  "items": {
    "A": {
      "at": "1970-01-01T00:00:00Z",
      "space": "s-1"
    },
    "B": {
      "at": "2026-10-28T09:00:00Z",
      "space": null
    }
  },
  "spaces": [
    {
      "color": "pink",
      "id": "s-1",
      "name": "a/b \\"q\\"\\n",
      "order": 0,
      "updatedAt": "2026-10-28T09:00:00Z"
    }
  ],
  "version": 1
}
`);
});

test("W1: todos.json drops unknown keys — why the spaces live in their own file", () => {
  const text = '{"items":[{"id":"X","title":"보고서","isCompleted":false,"createdAt":"2026-10-28T00:00:00Z","space":"s-a"}]}';
  assert.equal(serializeNotebook(parseNotebook(text)).includes("space"), false);
});

test("S1: 견적서 보내기 #회사 → the to-do ‘견적서 보내기’ in 회사", () => {
  const line = choice(prepared(), "견적서 보내기 #회사");
  assert.equal(line.candidates[0].kind, "todo");
  assert.equal((line.candidates[0] as { title: string }).title, "견적서 보내기");
  assert.deepEqual(first(line.choices), space("s-a"));
});

test("S2: 견적서 #회 → 회사 (the start of the name)", () => {
  assert.deepEqual(first(choice(prepared(), "견적서 #회").choices), space("s-a"));
});

test("S3: 견적서 #ㅎㅅ → 회사 (first consonants)", () => {
  assert.deepEqual(first(choice(prepared(), "견적서 #ㅎㅅ").choices), space("s-a"));
  assert.deepEqual(first(choice(prepared(), "견적서 #ㄱㅂ").choices), space("s-c"));
});

test("S4: 빨래 #세탁 (none) → a new space ‘세탁’ in the next colour, the to-do ‘빨래’", () => {
  const data = prepared();
  const line = choice(data, "빨래 #세탁");
  assert.deepEqual(line.choices, [{ kind: "new", name: "세탁" }, { kind: "none" }]);
  assert.equal((line.candidates[0] as { title: string }).title, "빨래");
  // 회사 pink · 집 mint · 공부 sky: the first colour none of them has.
  assert.equal(nextSpaceColor(data), "lavender");
  const made = addSpace(data, "세탁", "s-new", undefined, at("2026-10-28T09:05:00Z"));
  assert.deepEqual(liveSpaces(made).map((entry) => [entry.name, entry.color, entry.order]), [["회사", "pink", 0], ["집", "mint", 1], ["공부", "sky", 2], ["세탁", "lavender", 3]]);
});

test("S5: #회사 alone → nothing is put in (no title)", () => {
  assert.deepEqual(choice(prepared(), "#회사").candidates, []);
});

test("S6: C# 공부, 이슈 #12 확인, a#b → no token, the title as typed, no space", () => {
  for (const text of ["C# 공부", "이슈 #12 확인", "a#b"]) {
    const line = choice(prepared(), text);
    assert.equal(findSpaceToken(text), undefined, text);
    assert.deepEqual(line.choices, [], text);
    assert.equal((line.candidates[0] as { title: string }).title, text);
  }
  assert.equal(findSpaceToken("#2024 정리"), undefined);
  assert.equal(findSpaceToken("##제목"), undefined);
  // A non-token is skipped: the next token counts.
  assert.equal(findSpaceToken("이슈 #12 확인 #회사")?.name, "회사");
});

test("S7: showing 회사 only, 보고서 → 회사", () => {
  assert.deepEqual(choice(prepared(), "보고서", "s-a").choices, [space("s-a")]);
  // 스페이스 없음 only, or everything: no space.
  assert.deepEqual(choice(prepared(), "보고서", lensNone).choices, []);
  assert.deepEqual(choice(prepared(), "보고서").choices, []);
});

test("S8: showing 회사 only, 빨래 #집 → 집 (the # wins)", () => {
  assert.deepEqual(first(choice(prepared(), "빨래 #집", "s-a").choices), space("s-b"));
});

test("S9: 내일 3시 회의 #회사 → an event ‘회의’, no space, the token gone", () => {
  const line = choice(prepared(), "내일 3시 회의 #회사");
  assert.equal(line.candidates[0].kind, "event");
  assert.equal((line.candidates[0] as { title: string }).title, "회의");
  assert.equal(takesSpace(line.candidates[0]), false);
  assert.equal(line.text.includes("#"), false);
});

test("S10: 보고서 #회사 #집 → 회사, the title ‘보고서 #집’", () => {
  const line = choice(prepared(), "보고서 #회사 #집");
  assert.deepEqual(first(line.choices), space("s-a"));
  assert.equal((line.candidates[0] as { title: string }).title, "보고서 #집");
});

test("S11: a lens of 10-27 holds at 10-28 03:59 and lets go at 04:00 (the 4 a.m. day)", () => {
  const data = prepared();
  const lens = { spaceId: "s-a", day: "2026-10-27" };
  assert.equal(activeLens(lens, data, new Date(2026, 9, 28, 3, 59)), "s-a");
  assert.equal(activeLens(lens, data, new Date(2026, 9, 28, 4, 0)), undefined);
  assert.deepEqual(lensFor("s-b", new Date(2026, 9, 28, 3, 59)), { spaceId: "s-b", day: "2026-10-27" });
  assert.equal(readLens({ spaceId: "s-a", day: "2026-10-27", extra: 1 })?.spaceId, "s-a");
  assert.equal(readLens({ spaceId: "s-a", day: "27 oct" }), undefined);
});

test("S12: 회사 deleted → its to-dos have no space, the lens lets go, the file keeps their entries", () => {
  const data = prepared();
  const { data: gone, todoIDs } = deleteSpace(data, "s-a", at("2026-10-28T10:00:00Z"));
  assert.deepEqual(todoIDs, ["T1"]);
  assert.equal(spaceOf(gone, "T1"), undefined);
  assert.equal(spaceIndex(gone).has("T1"), false);
  assert.equal(activeLens({ spaceId: "s-a", day: "2026-10-28" }, gone, new Date(2026, 9, 28, 12)), undefined);
  assert.deepEqual(gone.items.T1, data.items.T1);
  const saved = parseTodoSpaces(serializeTodoSpaces(gone));
  assert.equal(saved.items.T1.space, "s-a");
  assert.equal(saved.spaces.find((entry) => entry.id === "s-a")?.deleted, true);
  // 되돌리기: back, with its to-dos.
  const back = restoreSpace(gone, "s-a", todoIDs, at("2026-10-28T10:00:05Z"));
  assert.equal(spaceOf(back, "T1"), "s-a");
});

test("S13: device A puts X in 회사 at 10:00, device B in 집 at 10:05 → 집", () => {
  const a = moveTodo(prepared(), "X", "s-a", at("2026-10-28T10:00:00Z"));
  const b = moveTodo(prepared(), "X", "s-b", at("2026-10-28T10:05:00Z"));
  assert.equal(spaceOf(mergeTodoSpaces(a, b), "X"), "s-b");
  assert.equal(spaceOf(mergeTodoSpaces(b, a), "X"), "s-b");
});

test("S14: A moves X to none (null) at 10:05, B to 회사 at 10:00 → none", () => {
  const a = moveTodo(moveTodo(prepared(), "X", "s-b", at("2026-10-28T09:00:00Z")), "X", null, at("2026-10-28T10:05:00Z"));
  const b = moveTodo(prepared(), "X", "s-a", at("2026-10-28T10:00:00Z"));
  assert.equal(a.items.X.space, null);
  for (const merged of [mergeTodoSpaces(a, b), mergeTodoSpaces(b, a)]) {
    assert.equal(spaceOf(merged, "X"), undefined);
    assert.equal(merged.items.X.space, null);
  }
});

test("S15: A renames 회사 ‘업무’ at 10:00, B ‘직장’ at 10:02 → ‘직장’; the same second keeps the file's", () => {
  const a = renameSpace(prepared(), "s-a", "업무", at("2026-10-28T10:00:00Z"));
  const b = renameSpace(prepared(), "s-a", "직장", at("2026-10-28T10:02:00Z"));
  assert.equal(liveSpaces(mergeTodoSpaces(a, b))[0].name, "직장");
  assert.equal(liveSpaces(mergeTodoSpaces(b, a))[0].name, "직장");
  const tie = renameSpace(prepared(), "s-a", "업무", at("2026-10-28T10:02:00Z"));
  assert.equal(liveSpaces(mergeTodoSpaces(b, tie))[0].name, "직장");
  assert.equal(liveSpaces(mergeTodoSpaces(tie, b))[0].name, "업무");
});

test("S16: unknown keys (top series, a space's icon, an entry's pin) — read and written, the same bytes", () => {
  const text = `{
  "items": {
    "T1": {
      "at": "2026-10-28T09:01:00Z",
      "pin": true,
      "space": "s-a"
    }
  },
  "series": {
    "R1": {
      "at": "2026-10-28T09:01:00Z",
      "space": "s-b"
    }
  },
  "spaces": [
    {
      "color": "pink",
      "icon": "briefcase",
      "id": "s-a",
      "name": "회사",
      "order": 0,
      "updatedAt": "2026-10-28T09:00:00Z"
    },
    {
      "color": "teal",
      "id": "s-b",
      "name": "집",
      "order": 1,
      "updatedAt": "2026-10-28T09:00:00Z"
    }
  ],
  "version": 1
}
`;
  const data = parseTodoSpaces(text);
  assert.equal(serializeTodoSpaces(data), text);
  // A change elsewhere keeps them too.
  const moved = moveTodo(data, "T2", "s-a", at("2026-10-28T09:02:00Z"));
  const again = serializeTodoSpaces(moved);
  assert.ok(again.includes('"pin": true') && again.includes('"icon": "briefcase"') && again.includes('"series": {'));
  // A colour this version doesn't know is kept as written.
  assert.equal(data.spaces[1].color, "teal");
});

test("S17: an entry of a to-do not in todos.json — 31 days old is dropped on save, 29 days old stays", () => {
  const now = at("2026-10-28T09:00:00Z");
  const old = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z");
  const data: TodoSpaces = { ...prepared(), items: { OLD: { space: "s-a", at: old(31) }, NEW: { space: "s-a", at: old(29) }, LIVE: { space: "s-a", at: old(40) } } };
  const pruned = pruneTodoSpaces(data, new Set(["LIVE"]), now);
  assert.deepEqual(Object.keys(pruned.items).sort(), ["LIVE", "NEW"]);
});

test("S18: export → import (merge) follows S13 · S14", () => {
  const here = moveTodo(moveTodo(moveTodo(prepared(), "X", "s-a", at("2026-10-28T10:00:00Z")), "Y", "s-c", at("2026-10-28T09:00:00Z")), "Y", null, at("2026-10-28T10:05:00Z"));
  const there = moveTodo(moveTodo(prepared(), "X", "s-b", at("2026-10-28T10:05:00Z")), "Y", "s-a", at("2026-10-28T10:00:00Z"));
  const backup = makeBackup({ "todos.json": '{\n  "items": []\n}\n', "todo-spaces.json": serializeTodoSpaces(there) }, "Windows 1.30.0", at("2026-10-28T11:00:00Z"));
  const read = parseBackup(backup);
  assert.ok("backup" in read);
  const merged = mergeFiles({ "todo-spaces.json": serializeTodoSpaces(here) }, read.backup.files);
  const result = parseTodoSpaces(merged["todo-spaces.json"]);
  assert.equal(spaceOf(result, "X"), "s-b");
  assert.equal(result.items.Y.space, null);
  // 바꾸기 takes the backup's whole; a backup without the file empties it.
  assert.equal(replaceFiles({ "todo-spaces.json": serializeTodoSpaces(here) }, read.backup.files)["todo-spaces.json"], serializeTodoSpaces(there));
  assert.equal(replaceFiles({ "todo-spaces.json": serializeTodoSpaces(here) }, { "todos.json": '{"items":[]}' })["todo-spaces.json"], serializeTodoSpaces(emptyTodoSpaces()));
  // A damaged spaces file in a backup is refused before anything changes.
  assert.ok("error" in parseBackup(makeBackup({ "todo-spaces.json": "[1, 2" }, "x", new Date())));
});

test("S19: no spaces — no lens, no chip; a # reads as before", () => {
  const none = emptyTodoSpaces();
  assert.equal(activeLens({ spaceId: lensNone, day: "2026-10-28" }, none, new Date(2026, 9, 28, 12)), undefined);
  const line = choice(none, "견적서 보내기 #회사");
  assert.deepEqual(line.choices, []);
  assert.equal((line.candidates[0] as { title: string }).title, "견적서 보내기 #회사");
});

test("S20: the name ‘A 업무’, typed #A업무 or #a → A 업무 (spaces and case ignored)", () => {
  const data = addSpace(prepared(), "A 업무", "s-d", "peach", at("2026-10-28T09:10:00Z"));
  assert.deepEqual(first(choice(data, "보고 #A업무").choices), space("s-d"));
  assert.deepEqual(first(choice(data, "보고 #a").choices), space("s-d"));
  const plain = addSpace(prepared(), "A업무", "s-d", "peach", at("2026-10-28T09:10:00Z"));
  assert.deepEqual(first(choice(plain, "보고 #a업무").choices), space("s-d"));
});

test("S21: a file that can't be read is kept aside as .unreadable-* and the spaces start empty", () => {
  assert.throws(() => parseTodoSpaces("{ broken"));
  assert.throws(() => parseTodoSpaces('{"spaces": {}}'));
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paper-todo-spaces-"));
  fs.writeFileSync(path.join(directory, "todo-spaces.json"), "{ broken", "utf8");
  const store = new Store(directory);
  assert.equal(liveSpaces(store.todoSpaces).length, 0);
  const aside = fs.readdirSync(directory).filter((name) => name.startsWith("todo-spaces.json.unreadable-"));
  assert.equal(aside.length, 1);
  assert.equal(fs.readFileSync(path.join(directory, aside[0]), "utf8"), "{ broken");
  assert.ok(store.storageError);
});

test("S22: a space deleted 31 days ago is dropped on save", () => {
  const now = at("2026-10-28T09:00:00Z");
  const old = deleteSpace(prepared(), "s-b", at("2026-09-27T08:00:00Z")).data;
  const recent = deleteSpace(old, "s-c", at("2026-09-29T09:00:00Z")).data;
  const pruned = pruneTodoSpaces(recent, new Set(["T1"]), now);
  assert.deepEqual(pruned.spaces.map((entry) => entry.id), ["s-a", "s-c"]);
});

// ─── Beyond the shared cases ─────────────────────────────────────────────────

test("choices: every match in order, then 스페이스 없음; deleted spaces are never found", () => {
  const data = addSpace(addSpace(prepared(), "회계", "s-e", "sand", at("2026-10-28T09:10:00Z")), "회사 밖", "s-f", "gray", at("2026-10-28T09:11:00Z"));
  assert.deepEqual(spaceChoices(data, "회사"), [space("s-a"), space("s-f"), { kind: "none" }]);
  assert.deepEqual(spaceChoices(data, "회"), [space("s-a"), space("s-e"), space("s-f"), { kind: "none" }]);
  assert.deepEqual(spaceChoices(data, "ㅎ"), [space("s-a"), space("s-e"), space("s-f"), { kind: "none" }]);
  const gone = deleteSpace(data, "s-a").data;
  assert.deepEqual(spaceChoices(gone, "회사"), [space("s-f"), { kind: "none" }]);
});

test("changes: rename, recolor, reorder and moves give the same value back when nothing changes", () => {
  const data = prepared();
  assert.equal(renameSpace(data, "s-a", "  회사 "), data);
  assert.equal(renameSpace(data, "s-a", "   "), data);
  assert.equal(recolorSpace(data, "s-a", "pink"), data);
  assert.equal(reorderSpaces(data, ["s-a", "s-b", "s-c"]), data);
  assert.equal(moveTodo(data, "T1", "s-a"), data);
  assert.equal(moveTodo(data, "NEW", null), data);
  assert.equal(moveTodo(data, "T1", "s-zz"), data);
  const reordered = reorderSpaces(data, ["s-b", "s-a"], at("2026-10-28T11:00:00Z"));
  assert.deepEqual(liveSpaces(reordered).map((entry) => entry.id), ["s-b", "s-a", "s-c"]);
  assert.equal(reordered.spaces.find((entry) => entry.id === "s-a")?.updatedAt, "2026-10-28T11:00:00Z");
  assert.equal(reordered.spaces.find((entry) => entry.id === "s-c")?.updatedAt, "2026-10-28T09:00:00Z"); // its place didn't change
});

test("ids, colours, digits, lens filter and particles", () => {
  const data = prepared();
  let n = 0;
  const id = newSpaceID(data, () => [0.0, 0.0, 0.5][n++]);
  assert.match(id, /^s-[0-9a-f]{6}$/);
  // Eight live spaces in every colour: the ninth by count.
  let full = emptyTodoSpaces();
  for (let index = 0; index < 8; index += 1) full = addSpace(full, `s${index}`, `s-${index}`);
  assert.deepEqual(liveSpaces(full).map((entry) => entry.color), ["lavender", "pink", "mint", "yellow", "sky", "peach", "sand", "gray"]);
  assert.equal(nextSpaceColor(full), "lavender");
  assert.equal(lensForDigit(data, 1), "s-a");
  assert.equal(lensForDigit(data, 3), "s-c");
  assert.equal(lensForDigit(data, 4), null);
  assert.equal(lensForDigit(data, 0), undefined);
  assert.equal(inLens(undefined, "s-a"), true);
  assert.equal(inLens("s-a", "s-a"), true);
  assert.equal(inLens("s-a", undefined), false);
  assert.equal(inLens(lensNone, undefined), true);
  assert.equal(inLens(lensNone, "s-a"), false);
  assert.deepEqual(["회사", "집", "서울", "공부2", "Lab", "A", "2030", "R", "Team"].map(roParticle), ["로", "으로", "로", "로", "로", "로", "으로", "로", "으로"]);
  assert.deepEqual(["회사", "집", "공부3"].map(objectParticle), ["를", "을", "을"]);
});

test("store: todo-spaces.json beside todos.json; todos.json keeps its shape; another device's file merges", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "paper-todo-spaces-"));
  const store = new Store(directory);
  let todoID = "";
  store.mutate((history) => { todoID = history.add("견적서 보내기")!.id; });
  assert.equal(fs.existsSync(path.join(directory, "todo-spaces.json")), false); // nothing until a space is made
  store.changeSpaces((data) => addSpace(data, "회사", "s-a", "pink"));
  store.changeSpaces((data) => moveTodo(data, todoID, "s-a"));
  const saved = parseTodoSpaces(fs.readFileSync(path.join(directory, "todo-spaces.json"), "utf8"));
  assert.equal(spaceOf(saved, todoID), "s-a");
  assert.equal(fs.readFileSync(path.join(directory, "todos.json"), "utf8").includes("space"), false);
  // Another device adds 집 and moves the to-do there later: merged on the next change here.
  const theirs = moveTodo(addSpace(saved, "집", "s-b", "mint"), todoID, "s-b", new Date(Date.now() + 5000));
  fs.writeFileSync(path.join(directory, "todo-spaces.json"), serializeTodoSpaces(theirs), "utf8");
  store.changeSpaces((data) => addSpace(data, "공부", "s-c", "sky"));
  assert.deepEqual(liveSpaces(store.todoSpaces).map((entry) => entry.id), ["s-a", "s-b", "s-c"]);
  assert.equal(spaceOf(store.todoSpaces, todoID), "s-b");
  // The state carries it to the windows.
  assert.equal(liveSpaces(store.state().todoSpaces).length, 3);
  assert.equal(store.state().spaceOf, `${todoID}\ts-b`);
  assert.equal(spaceIndexOf(store.state().todoSpaces.spaces, store.state().spaceOf).get(todoID)?.name, "집");
});

// ─── The shared fixture (docs/plans/spaces-cases.json, read by the Mac's test-spaces.sh too) ──

const fixturePath = path.resolve(process.cwd(), "..", "docs", "plans", "spaces-cases.json");
const fixture = fs.existsSync(fixturePath) ? JSON.parse(fs.readFileSync(fixturePath, "utf8")) : undefined;
const fileOf = (value: unknown) => parseTodoSpaces(JSON.stringify(value));
const choiceText = (entry: SpaceChoice) => (entry.kind === "space" ? entry.id : entry.kind === "new" ? `new:${entry.name}` : "none");

test("shared fixture: the input lines (S1–S10, S19, S20, W5)", { skip: !fixture }, () => {
  for (const line of fixture.lines) {
    let data = line.noSpaces ? emptyTodoSpaces() : fileOf(fixture.file);
    if (line.addSpace) data = { ...data, spaces: [...data.spaces, line.addSpace] };
    const read = readLine(line.text, data, line.lens ?? undefined, new Date(fixture.now));
    const label = `${line.case} ${line.text}`;
    const expect = line.expect;
    if (!expect.added) {
      assert.equal(read.candidates.length, 0, label);
      assert.equal(spaceLineProblem(line.text, data), expect.hint, label);
      continue;
    }
    const candidate = read.candidates[0] as { kind: string; title: string };
    assert.equal(candidate.kind, expect.kind, label);
    assert.equal(candidate.title, expect.title, label);
    assert.deepEqual(read.choices.map(choiceText), expect.choices, label);
    const picked = read.choices[0];
    const takes = takesSpace(read.candidates[0]);
    assert.equal(takes && picked?.kind === "space" ? picked.id : null, expect.space, label);
    if (expect.newSpace) {
      assert.ok(takes && picked?.kind === "new", label);
      assert.deepEqual({ name: picked.kind === "new" ? picked.name : "", color: nextSpaceColor(data) }, expect.newSpace, label);
    }
  }
});

test("shared fixture: the lens (S11, S12, S19, W8, W9)", { skip: !fixture }, () => {
  for (const entry of fixture.lens) {
    let data = entry.noSpaces ? emptyTodoSpaces() : fileOf(fixture.file);
    if (entry.deleteSpace) data = deleteSpace(data, entry.deleteSpace, new Date(fixture.now)).data;
    assert.equal(activeLens(entry.lens, data, new Date(entry.now)) ?? null, entry.expect, `${entry.case} ${entry.now}`);
  }
});

test("shared fixture: merges (S13–S15, W3), S16 bytes, the cleanup (S17, S22), unreadable files (S21)", { skip: !fixture }, () => {
  for (const merge of fixture.merges) {
    const existing = fileOf({ ...fixture.file, items: merge.existing });
    const incoming = fileOf({ ...fixture.file, items: merge.incoming });
    const merged = mergeTodoSpaces(existing, incoming);
    for (const [id, space] of Object.entries(merge.expect)) assert.equal(merged.items[id].space, space, merge.case);
  }
  for (const rename of fixture.renames) {
    const named = (side: { name: string; updatedAt: string }) => fileOf({ ...fixture.file, spaces: fixture.file.spaces.map((entry: { id: string }) => (entry.id === "s-a" ? { ...entry, ...side } : entry)) });
    assert.equal(liveSpaces(mergeTodoSpaces(named(rename.existing), named(rename.incoming)))[0].name, rename.expect, rename.case);
  }
  assert.equal(serializeTodoSpaces(parseTodoSpaces(fixture.S16)), fixture.S16);
  const prune = fixture.prune;
  const tombstones = Object.entries(prune.tombstones as Record<string, string>).map(([id, updatedAt], index) => ({ id, name: id, color: "gray", order: 10 + index, updatedAt, deleted: true }));
  const data = fileOf({ ...fixture.file, items: prune.items, spaces: [fixture.file.spaces[0], ...tombstones] });
  const pruned = pruneTodoSpaces(data, new Set(prune.todos), new Date(prune.now));
  assert.deepEqual(Object.keys(pruned.items).sort(), prune.expectItems);
  assert.deepEqual(pruned.spaces.map((entry) => entry.id).sort(), [...prune.expectSpaces].sort());
  for (const text of fixture.unreadable) assert.throws(() => parseTodoSpaces(text), JSON.stringify(text));
  for (const text of fixture.readable) assert.doesNotThrow(() => parseTodoSpaces(text), text);
});
