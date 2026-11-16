import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { saveOnSessionEnd } from "../src/main/sessionEnd";
import { Store } from "../src/main/store";
import { temporaryFolder } from "./temporaryFolder";

// #383: Windows shutting down or logging off sends no before-quit; the note's session-end writes what still waits.

const memosOf = (folder: string) => fs.readFileSync(path.join(folder, "memos.json"), "utf8");
const settingsOf = (folder: string) => JSON.parse(fs.readFileSync(path.join(folder, "settings.json"), "utf8"));

function waitingStore() {
  const folder = temporaryFolder("paper-todo-session-");
  const store = new Store(folder);
  const id = store.addMemo();
  store.updateMemo(id, "장보기: 우유");
  store.setPref("textStep", store.prefs.textStep + 1);
  // Both saves still wait (memos 400 ms, settings 300 ms): nothing is on disk yet.
  assert.equal(fs.existsSync(path.join(folder, "memos.json")), false);
  assert.equal(fs.existsSync(path.join(folder, "settings.json")), false);
  return { folder, store };
}

test("session-end: the memo and the settings still waiting are written at once", () => {
  const { folder, store } = waitingStore();
  const note = new EventEmitter();
  saveOnSessionEnd(note, { commitTyping: () => undefined, flush: () => store.flush() });
  note.emit("session-end");
  assert.match(memosOf(folder), /장보기: 우유/);
  assert.equal(settingsOf(folder).prefs.textStep, store.prefs.textStep);
});

test("query-session-end: the pages are asked for what is typed first, then everything waiting is written", () => {
  const { folder, store } = waitingStore();
  const note = new EventEmitter();
  const order: string[] = [];
  saveOnSessionEnd(note, {
    commitTyping: () => {
      order.push("typing");
      // The page answers with the memo it was typing (as 메모 서랍's memo:flush does).
      store.updateMemo(store.memos[0].id, "장보기: 우유, 달걀");
    },
    flush: () => { order.push("flush"); store.flush(); },
  });
  note.emit("query-session-end");
  assert.deepEqual(order, ["typing", "flush"]);
  assert.match(memosOf(folder), /장보기: 우유, 달걀/);
  assert.equal(settingsOf(folder).prefs.textStep, store.prefs.textStep);
});

test("query-session-end: a page already gone doesn't stop the save", () => {
  const { folder, store } = waitingStore();
  const note = new EventEmitter();
  saveOnSessionEnd(note, { commitTyping: () => { throw new Error("Object has been destroyed"); }, flush: () => store.flush() });
  note.emit("query-session-end");
  assert.match(memosOf(folder), /장보기: 우유/);
});
