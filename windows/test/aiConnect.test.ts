import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { aiEntry, aiExtVersion, aiLogLine, parseAiLink, parseAiLog, type AiItem, type AiLogEntry } from "../src/core/ai";
import { parseNotebook, serializeNotebook, type TodoItem } from "../src/core/notebook";
import { serializeEvents, type LocalEvent } from "../src/core/events";
import { serializeMemos } from "../src/core/memo";
import { addFolder, memosIn, placeNew, serializeMemoFolders } from "../src/core/memoDrawer";
import type { NoteNotice } from "../src/core/types";
import { AiConnection } from "../src/main/aiConnect";
import { Store } from "../src/main/store";
import { temporaryFolder } from "./temporaryFolder";

/**
 * AI 연결, the app's side (M13–M15 of the shared AI connection spec): the link it writes, the toast and the
 * away notice it makes from the log, undo with and without changes in between, Ctrl+Z, and the undo
 * history kept when Claude's write comes in. The real Store on temporary folders; the extension's writes
 * are made here the way it makes them (the file, then a line in the log).
 */

const temporary = () => temporaryFolder("paper-todo-ai-app-");
const files = { mcpb: "x.mcpb", exe: "C:\\Program Files\\종이냥\\종이냥.exe" };

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
  // #175: the app's own program in its MCP mode; no ELECTRON_RUN_AS_NODE, no script path.
  assert.equal(ai.command, 'claude mcp add jongi-nyang -- "C:\\Program Files\\종이냥\\종이냥.exe" --mcp-stdio');
  ai.stop();
});

test("N3-9: 이 기기에서 goes into ai-link.json as it changes, and leaves it when every space shows again", () => {
  const { folder, store, ai } = setup();
  ai.start();
  const link = () => parseAiLink(fs.readFileSync(path.join(folder, "ai-link.json"), "utf8"))!;
  assert.equal(link().ext, aiExtVersion);
  assert.equal(link().spaceDevice, undefined, "nothing set: no key");
  store.setDeviceRules({ none: { show: "hide" } });
  assert.deepEqual(link().spaceDevice, { none: { show: "hide" } });
  store.setDeviceRules({ none: { show: "time", times: [{ days: [6, 7], from: "00:00", to: "00:00" }] } });
  assert.deepEqual(link().spaceDevice, { none: { show: "time", times: [{ days: [6, 7], from: "00:00", to: "00:00" }] } });
  store.setDeviceRules({});
  assert.equal(link().spaceDevice, undefined, "every space shows again");
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

test("M23: a memo Claude put into a folder shows in that folder; 되돌리기 takes it out and its place shows nothing", () => {
  const { folder, store, ai } = setup();
  ai.start();
  ai.setEnabled(true);
  store.changeFolders((data) => addFolder(data, "회사", "mint", "C0FFEE01-0000-4000-8000-000000000001", new Date("2026-10-26T00:00:00Z")));
  // What add_memo with a folder writes: the memo, its place, then the log line (memos.json only, as ever).
  const memo = { id: crypto.randomUUID().toUpperCase(), text: "회의록\n- [ ] 정리하기", createdAt: "2026-10-27T01:00:00Z", updatedAt: "2026-10-27T01:00:00Z" };
  fs.writeFileSync(path.join(folder, "memos.json"), serializeMemos([memo, ...store.memos]));
  fs.writeFileSync(path.join(folder, "memo-folders.json"), serializeMemoFolders(placeNew(store.memoFolders, memo.id, { folder: "C0FFEE01-0000-4000-8000-000000000001", pinned: false }, new Date("2026-10-27T01:00:00Z"))));
  const entry = { ...aiEntry({ client: "Claude", tool: "add_memo", kind: "add", target: "memos", title: "회의록", changes: [{ file: "memos.json", id: memo.id, before: null, after: memo as unknown as AiItem }] }), ext: aiExtVersion };
  fs.appendFileSync(path.join(folder, "ai-log.jsonl"), `${aiLogLine(entry)}\n`);
  logChanged(ai);
  assert.deepEqual(memosIn(store.memoFolders, store.memos, "C0FFEE01-0000-4000-8000-000000000001").map((item) => item.id), [memo.id], "the drawer shows it in 회사");
  ai.undo(entry.id);
  assert.equal(store.memos.some((item) => item.id === memo.id), false);
  assert.deepEqual(memosIn(store.memoFolders, store.memos, "C0FFEE01-0000-4000-8000-000000000001"), []);
  ai.stop();
});

test("M41: ai-link.json carries the extension's version; an older Claude Desktop extension is said in AI 연결 until a new one writes", () => {
  const { folder, ai } = setup();
  ai.start();
  ai.setEnabled(true);
  assert.equal(parseAiLink(fs.readFileSync(path.join(folder, "ai-link.json"), "utf8"))!.ext, aiExtVersion);
  assert.equal(ai.view().outdated, undefined, "nothing from Claude Desktop yet");
  // A line from Claude Desktop's old extension (no version in it).
  claudeAdds(folder, ["옛 확장이 넣은 일"]);
  logChanged(ai);
  assert.equal(ai.view().outdated, true);
  // Claude Code runs the app's own copy: its lines don't count.
  const code = { ...aiEntry({ client: "Claude Code", tool: "add_todos", kind: "add", target: "todos", title: "x", changes: [] }), ext: aiExtVersion };
  fs.appendFileSync(path.join(folder, "ai-log.jsonl"), `${aiLogLine(code)}\n`);
  logChanged(ai);
  assert.equal(ai.view().outdated, true);
  // The reinstalled extension writes its version: the line goes.
  const fresh = { ...claudeAdds(folder, ["새 확장이 넣은 일"]).entry, ext: aiExtVersion };
  fs.appendFileSync(path.join(folder, "ai-log.jsonl"), `${aiLogLine(fresh)}\n`);
  logChanged(ai);
  assert.equal(ai.view().outdated, undefined);
  ai.stop();
});

test("#174: old lines go at launch (on or off), and 기록 지우기 empties the log", () => {
  const { folder, ai } = setup();
  const log = path.join(folder, "ai-log.jsonl");
  const old = aiEntry({ client: "Claude", tool: "add_todos", kind: "add", target: "todos", title: "옛일", changes: [] }, new Date(Date.now() - 40 * 86_400_000));
  fs.writeFileSync(log, `${aiLogLine(old)}\n`);
  ai.start();
  assert.equal(fs.readFileSync(log, "utf8"), "", "off, and still trimmed");
  assert.equal(ai.view().hasLog, false);
  ai.setEnabled(true);
  claudeAdds(folder, ["장보기"]);
  logChanged(ai);
  assert.equal(ai.view().recent.length, 1);
  assert.equal(ai.view().hasLog, true);
  ai.clearLog();
  assert.equal(fs.readFileSync(log, "utf8"), "");
  assert.deepEqual([ai.view().recent.length, ai.view().marks.length, ai.view().hasLog], [0, 0, false]);
  assert.equal(ai.undoLatest(), false, "nothing left to undo");
  ai.stop();
});
