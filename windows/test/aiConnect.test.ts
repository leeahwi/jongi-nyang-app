import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { aiEntry, aiLogLine, parseAiLink, parseAiLog, type AiItem, type AiLogEntry } from "../src/core/ai";
import { parseNotebook, serializeNotebook, type TodoItem } from "../src/core/notebook";
import { serializeEvents, type LocalEvent } from "../src/core/events";
import type { NoteNotice } from "../src/core/types";
import { AiConnection } from "../src/main/aiConnect";
import { Store } from "../src/main/store";

/**
 * AI 연결, the app's side (M13–M15 of the shared AI connection spec): the link it writes, the toast and the
 * away notice it makes from the log, undo with and without changes in between, Ctrl+Z, and the undo
 * history kept when Claude's write comes in. The real Store on temporary folders; the extension's writes
 * are made here the way it makes them (the file, then a line in the log).
 */

const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "paper-todo-ai-app-"));
const files = { server: "C:\\Program Files\\종이냥\\resources\\mcp\\server\\index.js", mcpb: "x.mcpb", exe: "C:\\Program Files\\종이냥\\종이냥.exe" };

function setup(visible = true) {
  const folder = temporary();
  const store = new Store(folder, false, folder);
  const toasts: NoteNotice[] = [];
  const said: string[] = [];
  const ai = new AiConnection(store, folder, {
    toast: (notice) => { if (!visible) return false; toasts.push(notice); return true; },
    noteVisible: () => visible,
    say: (line) => said.push(line),
    changed: () => undefined,
  }, files, "windows 1.27.0");
  return { folder, store, ai, toasts, said };
}

/** What the extension does for add_todos: the task into todos.json, then its line in the log. */
function claudeAdds(folder: string, titles: string[], at = new Date()): { entry: AiLogEntry; items: TodoItem[] } {
  const file = path.join(folder, "todos.json");
  const list = fs.existsSync(file) ? parseNotebook(fs.readFileSync(file, "utf8")).items : [];
  const items = titles.map((title) => ({ id: crypto.randomUUID().toUpperCase(), title, isCompleted: false, createdAt: "2026-10-27T01:00:00Z" }));
  fs.writeFileSync(file, serializeNotebook({ items: [...list, ...items] }));
  const entry = aiEntry({ client: "Claude", tool: "add_todos", kind: "add", target: "todos", title: titles[0], changes: items.map((item) => ({ file: "todos.json", id: item.id, before: null, after: item as unknown as AiItem })) }, at);
  fs.appendFileSync(path.join(folder, "ai-log.jsonl"), `${aiLogLine(entry)}\n`);
  return { entry, items };
}

const logChanged = (ai: AiConnection) => (ai as unknown as { logChanged(): void }).logChanged();

test("ai-link.json: written at launch, off by default; on, with the data folder and the language", () => {
  const { folder, ai } = setup();
  ai.start();
  const off = parseAiLink(fs.readFileSync(path.join(folder, "ai-link.json"), "utf8"))!;
  assert.deepEqual([off.enabled, off.dataFolder, off.lang, off.app], [false, folder, "ko", "windows 1.27.0"]);
  ai.setEnabled(true);
  assert.equal(parseAiLink(fs.readFileSync(path.join(folder, "ai-link.json"), "utf8"))!.enabled, true);
  ai.setEnabled(false);
  assert.equal(parseAiLink(fs.readFileSync(path.join(folder, "ai-link.json"), "utf8"))!.enabled, false, "turned off: written false, not deleted");
  assert.equal(ai.command, 'claude mcp add jongi-nyang -e ELECTRON_RUN_AS_NODE=1 -- "C:\\Program Files\\종이냥\\종이냥.exe" "C:\\Program Files\\종이냥\\resources\\mcp\\server\\index.js"');
  ai.stop();
});

test("M15: what Claude did while the app was closed: one notice at launch with the count, then nothing again", () => {
  const { folder, store, ai, toasts } = setup();
  ai.setEnabled(true);
  ai.stop();
  store.flush(); // the app quits (its settings are written)
  claudeAdds(folder, ["보고서 쓰기", "운동"]);
  claudeAdds(folder, ["장보기"]);
  // The app starts again.
  const again = new Store(folder, false, folder);
  const shown: NoteNotice[] = [];
  const next = new AiConnection(again, folder, { toast: (notice) => { shown.push(notice); return true; }, noteVisible: () => true, say: () => undefined, changed: () => undefined }, files, "windows 1.27.0");
  next.start();
  assert.deepEqual(shown.map((notice) => [notice.text, notice.show]), [["자리를 비운 사이 Claude가 3개를 넣거나 고쳤어요", "ai"]]);
  assert.equal(again.items.length, 3);
  next.start();
  assert.equal(shown.length, 1, "seen: not said twice");
  // The stamps: today's three, as Claude left them.
  assert.equal(next.view().marks.length, 3);
  assert.deepEqual(next.view().recent.map((entry) => entry.text), ["Claude가 할 일 1개를 넣었어요", "Claude가 할 일 2개를 넣었어요"]);
  next.stop();
  void toasts;
});

test("live: a toast with 되돌리기, the cat now and then; undo puts it back (M13), Ctrl+Z too", () => {
  const { folder, store, ai, toasts } = setup();
  ai.start();
  ai.setEnabled(true);
  store.mutate((history) => history.add("내가 쓴 일"));
  const { entry } = claudeAdds(folder, ["보고서 쓰기", "운동"]);
  logChanged(ai);
  assert.deepEqual(toasts.map((notice) => [notice.text, notice.undo, notice.entry]), [["Claude가 할 일 2개를 넣었어요", "ai", entry.id]]);
  assert.deepEqual(store.items.map((item) => item.title), ["내가 쓴 일", "보고서 쓰기", "운동"]);
  // Claude's write didn't wipe the undo history here.
  assert.equal(store.history.canUndo, true);
  // Ctrl+Z right away takes Claude's entry back, not the person's own step.
  assert.equal(ai.undoLatest(), true);
  assert.deepEqual(store.items.map((item) => item.title), ["내가 쓴 일"]);
  assert.equal(toasts[toasts.length - 1].text, "되돌렸어요");
  const log = parseAiLog(fs.readFileSync(path.join(folder, "ai-log.jsonl"), "utf8"));
  const undo = log[log.length - 1];
  assert.deepEqual([undo.kind, undo.client, undo.tool, undo.undoes, undo.count, undo.target], ["undo", "app", "undo", entry.id, 2, "todos"]);
  assert.deepEqual(undo.changes.map((change) => change.after), [null, null]);
  assert.equal(ai.view().recent[0].undone, true);
  assert.equal(ai.view().marks.length, 0);
  // A second undo of the same entry does nothing; Ctrl+Z now is the person's own undo.
  ai.undo(entry.id);
  assert.equal(ai.undoLatest(), false);
  ai.stop();
});

test("M14: changed here since: left as it is, and said so; a partial undo says how many", () => {
  const { folder, store, ai, toasts } = setup();
  ai.start();
  ai.setEnabled(true);
  const { entry, items } = claudeAdds(folder, ["보고서 쓰기", "운동"]);
  logChanged(ai);
  store.mutate((history) => history.edit(items[0].id, "보고서 다듬기"));
  assert.equal(ai.undoLatest(), false, "Ctrl+Z after an edit here is the edit's");
  ai.undo(entry.id);
  assert.equal(toasts[toasts.length - 1].text, "1개를 되돌렸어요. 그사이 고친 1개는 그대로 뒀어요");
  assert.deepEqual(store.items.map((item) => item.title), ["보고서 다듬기"]);
  const { entry: second, items: [only] } = claudeAdds(folder, ["장보기"]);
  logChanged(ai);
  store.mutate((history) => history.toggle(only.id));
  ai.undo(second.id);
  assert.equal(toasts[toasts.length - 1].text, "그사이 직접 고친 항목이라 그대로 뒀어요");
  assert.equal(store.items.some((item) => item.id === only.id), true);
  assert.equal(ai.view().marks.includes(only.id), false, "an edit takes the stamp away");
  ai.stop();
});

test("an event Claude moved goes back; the note hidden meanwhile gets the away notice when it comes up", () => {
  const folder = temporary();
  const store = new Store(folder, false, folder);
  let visible = false;
  const shown: NoteNotice[] = [];
  const ai = new AiConnection(store, folder, { toast: (notice) => { if (!visible) return false; shown.push(notice); return true; }, noteVisible: () => visible, say: () => undefined, changed: () => undefined }, files, "windows 1.27.0");
  ai.start();
  ai.setEnabled(true);
  const event: LocalEvent = { id: "EV1", title: "팀 회의", date: "2026-10-28", allDay: false, days: 1, start: 600, end: 660, repeat: "none", skip: [], color: "blue", createdAt: "2026-10-20T00:00:00Z", updatedAt: "2026-10-20T00:00:00Z" };
  store.replaceEvents([event]);
  const moved = { ...event, start: 660, end: 720, updatedAt: "2026-10-27T01:00:00Z" };
  fs.writeFileSync(path.join(folder, "events.json"), serializeEvents([moved]));
  const entry = aiEntry({ client: "Claude", tool: "apply_changes", kind: "change", target: "events", title: "팀 회의", changes: [{ file: "events.json", id: "EV1", before: event as unknown as AiItem, after: moved as unknown as AiItem }] });
  fs.appendFileSync(path.join(folder, "ai-log.jsonl"), `${aiLogLine(entry)}\n`);
  logChanged(ai);
  assert.equal(shown.length, 0, "hidden: kept for later");
  visible = true;
  ai.noteShown();
  assert.deepEqual(shown.map((notice) => notice.text), ["자리를 비운 사이 Claude가 1개를 넣거나 고쳤어요"]);
  assert.equal(store.events[0].start, 660);
  ai.undo(entry.id);
  assert.equal(store.events[0].start, 600);
  assert.equal(shown[shown.length - 1].text, "되돌렸어요");
  ai.stop();
});
