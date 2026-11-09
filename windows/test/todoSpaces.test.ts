import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { makeBackup, mergeFiles, parseBackup, replaceFiles } from "../src/core/backup";
import { parseNotebook, serializeNotebook } from "../src/core/notebook";
import {
  activeLens, addSpace, deleteSpace, emptyTodoSpaces, findSpaceToken, generalName, groupedCount, inLens, lensFor, lensForDigit, lensNone, liveSpaces, mergeTodoSpaces, moveTodo,
  newSpaceID, nextSpaceColor, objectParticle, parseTodoSpaces, pruneTodoSpaces, readLens, readLine, recolorSpace, renameGeneral, renameSpace, reorderSpaces, restoreSpace,
  roParticle, serializeTodoSpaces, spaceChoices, spaceIndex, spaceIndexOf, spaceLineProblem, spaceOf, takesSpace, type SpaceChoice, type TodoSpaces,
  findSpace, lensTasks, placeSeriesCopies, seriesSpaceOf, setSeriesSpace,
} from "../src/core/todoSpaces";
import { aheadLens, aheadSections } from "../src/core/ahead";
import { badgeWords, extendSelection, movedBlock, movedManyWords, noSelection, oneSelected, orderedSelection, rangeSelection, restoredOrder, toggleSelection } from "../src/core/selection";
import { boardFits, groupItems, groupOpen, groupSpace, movedOrder, narrowNote, neighborGroup, returnPoint, spaceGroups, wideNote, type SpaceGroup } from "../src/core/spaceGroups";
import type { CalendarEvent } from "../src/core/calendar";
import { stripItems, stripState } from "../src/core/dayStrip";
import { Store } from "../src/main/store";
import { temporaryFolder } from "./temporaryFolder";

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

test("S16: unknown keys (a rule's at, a space's icon, an entry's pin) — read and written, the same bytes", () => {
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
      "space": "s-b",
      "updatedAt": "2026-10-28T09:01:00Z"
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
  assert.equal(data.series?.R1.space, "s-b");
  assert.equal(data.series?.R1.extra?.at, "2026-10-28T09:01:00Z");
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
  const directory = temporaryFolder("paper-todo-spaces-");
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
  const directory = temporaryFolder("paper-todo-spaces-");
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

test("shared fixture: the input lines (S1–S10, S19, S20, S27, S28, W5)", { skip: !fixture }, () => {
  for (const line of fixture.lines) {
    let data = line.noSpaces ? emptyTodoSpaces() : fileOf(fixture.file);
    if (line.addSpace) data = { ...data, spaces: [...data.spaces, line.addSpace] };
    if (line.general) data = { ...data, general: fileOf({ general: line.general }).general };
    const read = readLine(line.text, data, line.lens ?? undefined, new Date(fixture.now));
    const label = `${line.case} ${line.text}`;
    const expect = line.expect;
    if (!expect.added) {
      assert.equal(read.candidates.length, 0, label);
      assert.equal(spaceLineProblem(line.text, data), expect.hint, label);
      continue;
    }
    // S29: a repeat whose title reads as an event (`주간 회의`) is the line's second reading — Tab picks it.
    const reading = (expect.kind === "repeat" ? read.candidates.find((entry) => entry.kind === "repeat") : undefined) ?? read.candidates[0];
    const candidate = reading as { kind: string; title: string };
    assert.equal(candidate.kind, expect.kind, label);
    assert.equal(candidate.title, expect.title, label);
    assert.deepEqual(read.choices.map(choiceText), expect.choices, label);
    const picked = read.choices[0];
    const takes = takesSpace(reading);
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

// ─── 일반: the to-dos in no space, and its name (#89, S23–S28) ─────────────────

const generalOf = (value: unknown) => (value ? fileOf({ general: value }).general : undefined);
const shownNames = (data: TodoSpaces) => ({ ko: generalName(data, "ko"), en: generalName(data, "en"), nl: generalName(data, "nl") });

test("shared fixture: 일반 renamed, back to the default, merged, and in the file (S23–S26)", { skip: !fixture }, () => {
  const general = fixture.general;
  assert.deepEqual(shownNames(fileOf(fixture.file)), general.names);
  for (const entry of general.renames) {
    const data = { ...fileOf(fixture.file), ...(entry.general ? { general: generalOf(entry.general) } : {}) };
    const renamed = renameGeneral(data, entry.to, new Date(entry.now));
    const label = `${entry.case} ‘${entry.to}’`;
    assert.deepEqual(renamed.general, generalOf(entry.expect), label);
    assert.deepEqual(shownNames(renamed), entry.shown, label);
  }
  for (const entry of general.merges) {
    const side = (value: unknown) => ({ ...fileOf(fixture.file), ...(value ? { general: generalOf(value) } : {}) });
    assert.deepEqual(mergeTodoSpaces(side(entry.existing), side(entry.incoming)).general, generalOf(entry.expect), `${entry.case} ${entry.note ?? ""}`);
  }
  const read = parseTodoSpaces(general.S26);
  assert.equal(serializeTodoSpaces(read), general.S26);
  assert.deepEqual(shownNames(read), general.S26names);
  assert.equal(read.general?.extra?.icon, "tray");
  const again = parseTodoSpaces(serializeTodoSpaces(renameGeneral(read, "개인", new Date(fixture.now))));
  assert.equal(again.general?.name, "개인");
  assert.equal(again.general?.extra?.icon, "tray");
  // A `general` this version can't read stays as it was, and reads as the default.
  const odd = parseTodoSpaces(general.S26odd);
  assert.equal(serializeTodoSpaces(odd), general.S26odd);
  assert.equal(generalName(odd, "en"), "General");
  // Not renamed: no key in the file.
  assert.equal(serializeTodoSpaces(fileOf(fixture.file)).includes('"general"'), false);
});

// ─── 2a: repeat rules' spaces (S32–S36), the 앞으로 tab (S37) and the day strip (S38) ─────────

const seriesOf = (value: unknown) => (value ? fileOf({ series: value }).series : undefined);
const seriesSpaces = (data: TodoSpaces) => (data.series ? Object.fromEntries(Object.entries(data.series).map(([id, place]) => [id, place.space])) : null);
const placesOf = (data: TodoSpaces) => Object.fromEntries(Object.entries(data.items).map(([id, place]) => [id, { space: place.space, at: place.at }]));

test("shared fixture: repeat rules' spaces — merged, in the file, set, given to new to-dos, cleaned up (S32–S36)", { skip: !fixture }, () => {
  const series = fixture.series;
  const base = fileOf(fixture.file);
  for (const entry of series.merges) {
    const side = (value: unknown) => ({ ...base, ...(value ? { series: seriesOf(value) } : {}) });
    const merged = mergeTodoSpaces(side(entry.existing), side(entry.incoming));
    assert.deepEqual(seriesSpaces(merged), entry.expect, `${entry.case} ${entry.note ?? ""}`);
  }
  // S16 (the phase-1 fixture) reads its `series` now.
  assert.equal(parseTodoSpaces(fixture.S16).series?.["daily-water"]?.space, "s-b");
  assert.deepEqual(parseTodoSpaces(fixture.general.S26).series, {});
  // S33: bytes, an unknown key in a rule, an odd `series`, entries it can't read.
  const read = parseTodoSpaces(series.S33);
  assert.equal(serializeTodoSpaces(read), series.S33);
  assert.equal(read.series?.["4C2B7A10-0D3E-4F5A-8B6C-7D8E9F0A1B2C"]?.extra?.pin, true);
  const changed = setSeriesSpace(read, "4C2B7A10-0D3E-4F5A-8B6C-7D8E9F0A1B2C", null, [], new Date(fixture.now));
  assert.equal(parseTodoSpaces(serializeTodoSpaces(changed)).series?.["4C2B7A10-0D3E-4F5A-8B6C-7D8E9F0A1B2C"]?.extra?.pin, true);
  const odd = parseTodoSpaces(series.S33odd);
  assert.equal(serializeTodoSpaces(odd), series.S33odd);
  assert.equal(odd.series, undefined);
  const oddSet = setSeriesSpace({ ...odd, spaces: base.spaces }, "R", "s-a", [], new Date(fixture.now));
  assert.equal(oddSet.extra?.series, undefined);
  assert.equal(oddSet.series?.R.space, "s-a");
  assert.deepEqual(seriesSpaces(parseTodoSpaces(series.S33dropped)), series.S33droppedExpect);
  // S34: a rule's space set (its open to-dos move with it).
  for (const entry of series.sets) {
    const data = { ...base, items: fileOf({ items: entry.items }).items, ...(entry.series ? { series: seriesOf(entry.series) } : {}) };
    const after = setSeriesSpace(data, entry.seriesID, entry.to, entry.copies, new Date(entry.now));
    const label = `${entry.case} ${entry.note ?? ""}`;
    assert.deepEqual(after.series ? Object.fromEntries(Object.entries(after.series).map(([id, place]) => [id, { space: place.space, updatedAt: place.updatedAt }])) : null, entry.expect, label);
    assert.deepEqual(placesOf(after), entry.expectItems, label);
  }
  // S35: to-dos made from rules take the rule's space; moving one moves only it.
  const copies = series.copies;
  const ready = deleteSpace({ ...base, series: seriesOf(copies.series) }, copies.deleteSpace, new Date(copies.now)).data;
  const placed = placeSeriesCopies(ready, copies.made, new Date(copies.now));
  assert.deepEqual(placesOf(placed), copies.expectItems);
  const moved = moveTodo(placed, copies.thenMove.todo, copies.thenMove.to, new Date(copies.thenMove.now));
  assert.deepEqual(placesOf(moved), copies.expectAfterMove.items);
  assert.deepEqual(seriesSpaces(moved), copies.expectAfterMove.series);
  assert.equal(seriesSpaceOf(moved, "old-rule"), undefined);
  // S36: rules gone from repeats.json for more than 30 days are dropped on save; not when repeats.json couldn't be read.
  const prune = series.prune;
  const withRules = { ...base, series: seriesOf(prune.series) };
  assert.deepEqual(Object.keys(pruneTodoSpaces(withRules, new Set(), new Date(prune.now), new Set(prune.seriesIDs)).series ?? {}).sort(), prune.expect);
  assert.deepEqual(Object.keys(pruneTodoSpaces(withRules, new Set(), new Date(prune.now)).series ?? {}).sort(), prune.expectWithoutRepeats);
});

const lensOf = (value: string | null) => value ?? undefined;
const spaceLookup = (spaces: Record<string, string>) => (id: string) => spaces[id];

test("shared fixture: the lens on the 앞으로 tab — to-dos only, counts after the lens, the hidden ones (S37)", { skip: !fixture }, () => {
  const ahead = fixture.ahead;
  const now = new Date(fixture.now);
  const items = parseNotebook(JSON.stringify({ items: ahead.todos })).items;
  for (const entry of ahead.cases) {
    const lensed = aheadLens(items, spaceLookup(ahead.spaces), lensOf(entry.lens), now);
    const sections = aheadSections(lensed.items, [], now, "ko");
    const label = `${entry.case} ${entry.lens}`;
    assert.deepEqual(Object.fromEntries(sections.map((section) => [section.kind === "laterOn" ? "later" : section.kind, section.count])), entry.expect.counts, label);
    assert.deepEqual(Object.fromEntries(sections.flatMap((section) => section.days ?? []).map((day) => [day.day, day.tasks.map((task) => task.id)])), entry.expect.days, label);
    assert.equal(lensed.hidden, entry.expect.hidden, label);
  }
});

test("shared fixture: the lens on the day strip — now and next from the lens's to-dos and every event (S38)", { skip: !fixture }, () => {
  const strip = fixture.strip;
  const now = new Date(fixture.now);
  const items = parseNotebook(JSON.stringify({ items: strip.todos })).items;
  const events: CalendarEvent[] = strip.events.map((event: { title: string; start: string; end: string }, index: number) => ({
    key: `local/e${index}@2026-10-28`, calendarId: "local", title: event.title, allDay: false, start: new Date(event.start), end: new Date(event.end),
    color: "#888888", eventId: `e${index}`, canEdit: true, recurring: false,
  }));
  const data = fileOf(fixture.file);
  const index = new Map(Object.entries(strip.spaces as Record<string, string>).map(([todo, id]) => [todo, findSpace(data, id)!]));
  for (const entry of strip.cases) {
    const state = stripState(stripItems(events, lensTasks(items, index, lensOf(entry.lens)), now), now, 3);
    const label = `${entry.case} ${entry.lens}`;
    assert.equal(state.mode, entry.expect.mode, label);
    assert.equal(state.lead?.title, entry.expect.lead, label);
    assert.deepEqual(state.rows.map((row) => row.title), entry.expect.rows, label);
  }
});

// ─── 2b: 스페이스별로 묶기 (S39–S44) ─────────────────────────────────────────

test("shared fixture: the groups — order, inside a group, empty ones hidden, the lens, drops and 되돌리기, the keys (S39–S44)", { skip: !fixture }, () => {
  const grouping = fixture.groups;
  const now = new Date(fixture.now);
  const data = fileOf(fixture.file);
  const items = parseNotebook(JSON.stringify({ items: grouping.todos })).items;
  const byID = new Map(items.map((item) => [item.id, item]));
  const kst = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: fixture.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms));
  type Want = { space: string | null; titles: string[]; open: number; done: number; next: string | null };
  const shape = (groups: SpaceGroup[]): Want[] => groups.map((group) => ({
    space: group.space ?? null, titles: groupItems(group).map((item) => item.title), open: groupOpen(group), done: group.done.length,
    next: group.next === undefined ? null : kst(group.next),
  }));
  const groupsOf = (order: readonly string[], spaces: Record<string, string | undefined>, lens: string | undefined) =>
    spaceGroups(order.map((id) => byID.get(id)!), data, (id) => spaces[id], lens, now);
  const order = items.map((item) => item.id);
  for (const entry of grouping.cases) {
    assert.deepEqual(shape(groupsOf(order, grouping.spaces, lensOf(entry.lens))), entry.expect, `${entry.case} ${entry.lens}`);
  }
  for (const entry of grouping.drops) {
    const label = `${entry.case} ${entry.note}`;
    const back = returnPoint(entry.id, order);
    const after = entry.relativeTo ? movedOrder(order, entry.id, entry.relativeTo, entry.after) : order;
    const spaces = { ...grouping.spaces, [entry.id]: groupSpace(entry.to) ?? undefined };
    assert.deepEqual(shape(groupsOf(after, spaces, undefined)), entry.expect, label);
    // 되돌리기: its space and its place in the list as they were.
    const undone = back ? movedOrder(after, entry.id, back.targetID, back.after) : after;
    assert.deepEqual(undone, order, label);
    assert.deepEqual(shape(groupsOf(undone, grouping.spaces, undefined)), grouping.cases[0].expect, label);
  }
  for (const entry of grouping.keys) {
    const groups = groupsOf(order, grouping.spaces, lensOf(entry.lens));
    assert.equal(neighborGroup(entry.id, entry.direction === "up" ? -1 : 1, groups) ?? null, entry.to, `${entry.case} ${entry.direction} ${entry.note ?? ""}`);
  }
  // S46–S48 (#168): several picked, moved at once, and 되돌리기.
  const multi = fixture.multi;
  const rows: string[] = multi.rows;
  for (const entry of multi.selection) {
    let selection = noSelection();
    for (const [kind, value] of entry.steps as [string, string | number][]) {
      if (kind === "click") selection = oneSelected(value as string);
      else if (kind === "toggle") selection = toggleSelection(selection, value as string, rows);
      else if (kind === "range") selection = rangeSelection(selection, value as string, rows);
      else if (kind === "extend") selection = extendSelection(selection, value as number, rows);
      else selection = noSelection();
    }
    const label = `S46 ${entry.note ?? JSON.stringify(entry.steps)}`;
    assert.deepEqual(orderedSelection(selection, rows), entry.expect.ids, label);
    assert.equal(selection.focus ?? null, entry.expect.focus, label);
    assert.equal(selection.anchor ?? null, entry.expect.anchor, label);
  }
  for (const entry of multi.moves) {
    const label = `S47 ${entry.note}`;
    const after = entry.relativeTo ? movedBlock(order, entry.ids, entry.relativeTo, entry.after) : order;
    const spaces: Record<string, string | undefined> = { ...grouping.spaces };
    let moved = 0;
    for (const id of entry.ids as string[]) { const to = groupSpace(entry.to) ?? undefined; if (spaces[id] !== to) { spaces[id] = to; moved += 1; } }
    assert.equal(moved, entry.moved, label);
    assert.deepEqual(shape(groupsOf(after, spaces, undefined)), entry.expect, label);
    const undone = restoredOrder(after, entry.ids, order);
    assert.deepEqual(undone, order, label);
    assert.deepEqual(shape(groupsOf(undone, grouping.spaces, undefined)), grouping.cases[0].expect, label);
  }
  for (const entry of multi.keys) {
    const groups = groupsOf(order, grouping.spaces, undefined);
    const target = neighborGroup(entry.focus, entry.direction === "up" ? -1 : 1, groups);
    assert.equal(target ?? null, entry.to, `S48 ${entry.note ?? ""}`);
    const moved = target === undefined ? 0 : (entry.ids as string[]).filter((id) => grouping.spaces[id] !== (groupSpace(target) ?? undefined)).length;
    assert.equal(moved, entry.moved, `S48 moved ${entry.note ?? ""}`);
  }
  assert.equal(movedManyWords(3, "집", "ko"), "3개를 집으로 옮겼어요");
  assert.equal(movedManyWords(3, "Home", "en"), "Moved 3 to Home");
  assert.equal(movedManyWords(3, "Thuis", "nl"), "3 verplaatst naar Thuis");
  assert.equal(badgeWords(3, "ko"), "3개");
  // S45: columns only when every one gets 220; the note's widest grouped and not.
  assert.equal(wideNote, grouping.board.maxWidth.grouped);
  assert.equal(narrowNote, grouping.board.maxWidth.plain);
  for (const entry of grouping.board.cases) assert.equal(boardFits(entry.width, entry.count), entry.columns, `S45 ${entry.count} at ${entry.width}`);
});

test("rules' spaces in the store: a line's repeat, its new to-do, the rule's editor, a rule deleted", () => {
  const directory = temporaryFolder("paper-todo-series-");
  const store = new Store(directory);
  store.changeSpaces((data) => addSpace(addSpace(data, "회사", "s-a", "pink"), "집", "s-b", "mint"));
  const now = new Date();
  // A rule with a space: today's new copy goes there (S35).
  const id = store.saveSeries({ title: "물 마시기", rule: { kind: "daily" }, space: "s-a" }, now)!;
  const copy = store.items.find((item) => item.seriesID === id)!;
  assert.equal(seriesSpaceOf(store.todoSpaces, id), "s-a");
  assert.equal(spaceOf(store.todoSpaces, copy.id), "s-a");
  // The rule's editor moves it, and its open copy with it (S34).
  store.saveSeries({ seriesID: id, rule: { kind: "daily" }, space: "s-b" }, now);
  assert.equal(seriesSpaceOf(store.todoSpaces, id), "s-b");
  assert.equal(spaceOf(store.todoSpaces, copy.id), "s-b");
  // Moving the copy moves only it.
  store.changeSpaces((data) => moveTodo(data, copy.id, "s-a"));
  assert.equal(seriesSpaceOf(store.todoSpaces, id), "s-b");
  // From a to-do's editor, the rule takes the to-do's space.
  store.mutate((history) => history.addTo("보고서", undefined));
  const task = store.items.find((item) => item.title === "보고서")!;
  store.changeSpaces((data) => moveTodo(data, task.id, "s-a"));
  const fromTask = store.saveSeries({ taskID: task.id, rule: { kind: "weekly", weekdays: [1] } }, now)!;
  assert.equal(seriesSpaceOf(store.todoSpaces, fromTask), "s-a");
  // Stopping a rule keeps its entry (되돌리기 brings the space back with it).
  store.deleteSeries(id);
  assert.equal(seriesSpaceOf(parseTodoSpaces(fs.readFileSync(path.join(directory, "todo-spaces.json"), "utf8")), id), "s-b");
});

test("일반 in the store: renamed through the shared folder, the later name wins (S25)", () => {
  const directory = temporaryFolder("paper-todo-spaces-");
  const store = new Store(directory);
  store.changeSpaces((data) => addSpace(data, "회사", "s-a", "pink"));
  store.changeSpaces((data) => renameGeneral(data, "기타", at("2026-10-28T10:00:00Z")));
  const saved = parseTodoSpaces(fs.readFileSync(path.join(directory, "todo-spaces.json"), "utf8"));
  assert.equal(saved.general?.name, "기타");
  // Another device renames it later: merged on the next change here.
  fs.writeFileSync(path.join(directory, "todo-spaces.json"), serializeTodoSpaces(renameGeneral(saved, "개인", at("2026-10-28T10:05:00Z"))), "utf8");
  store.changeSpaces((data) => addSpace(data, "집", "s-b", "mint"));
  assert.equal(generalName(store.todoSpaces), "개인");
  assert.equal(generalName(store.state().todoSpaces, "en"), "개인");
});

test("#87: counts grouped as the Mac writes them", () => {
  assert.equal(groupedCount(4), "4");
  assert.equal(groupedCount(1466), "1,466");
  assert.equal(groupedCount(1466, "nl"), "1.466");
  assert.equal(groupedCount(1234567, "en"), "1,234,567");
});
