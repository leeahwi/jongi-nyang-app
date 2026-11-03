import assert from "node:assert/strict";
import { test } from "node:test";
import { readStateKind, stateChannels, stateSlice, type AppState } from "../src/core/types";

// #71: each page hears its part of the state; a made-up state with every key the parts are cut from.
const state = {
  items: [{ id: "A" }], canUndo: true, canRedo: false, prefs: { font: "pen" }, series: [], memos: [{ id: "M", text: "장보기 목록" }],
  memoFolders: { folders: [], placement: {} }, memoTrash: { entries: [], updatedAt: "" }, todoSpaces: { spaces: [{ id: "s-1", name: "집" }], items: {} }, spaceOf: "", storage: {},
  calendar: {}, events: [], alarms: [], ai: {},
} as unknown as AppState;

test("state parts: the note's has everything but the memos, their folders and 지운 메모 (#120)", () => {
  const part = stateSlice(state, "todos") as Record<string, unknown>;
  assert.equal(part.memos, undefined);
  assert.equal(part.memoFolders, undefined);
  assert.equal(part.memoTrash, undefined);
  assert.deepEqual(Object.keys(part).sort(), Object.keys(state).filter((key) => key !== "memos" && key !== "memoFolders" && key !== "memoTrash").sort());
  assert.equal(part.items, state.items);
});

test("state parts: the 메모 서랍's is the memos, the folders, 지운 메모 and the settings; the font pages' the settings and the spaces", () => {
  assert.deepEqual(Object.keys(stateSlice(state, "memos")).sort(), ["memoFolders", "memoTrash", "memos", "prefs"]);
  assert.deepEqual(Object.keys(stateSlice(state, "prefs")).sort(), ["prefs", "todoSpaces"]);
});

test("state parts: a page that names no part (or an unknown one) hears the note's, on \"state\"", () => {
  assert.equal(readStateKind(undefined), "todos");
  assert.equal(readStateKind("everything"), "todos");
  assert.equal(readStateKind("memos"), "memos");
  assert.deepEqual(stateChannels, { todos: "state", memos: "state:memos", prefs: "state:prefs" });
});
