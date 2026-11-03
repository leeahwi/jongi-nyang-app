import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { mayAct, pageActions, pageNames, pagePrefs, readAction, readCalendarRequest, readIntentRequest, senderPageOf, type PageName } from "../src/core/ipcCheck";
import { acceptNotifyAction, makeNonce, readNotifyLink } from "../src/core/notify";
import type { Action } from "../src/core/types";

/** #172 (security review L-02 · L-03): the messages pages send, who may send them, and the alarm links' nonce. */

const root = process.cwd();
const renderer = "file:///Applications/Sample.app/Contents/Resources/app.asar/out/renderer";

test("actions: a well-formed message comes back fresh, with only its own fields", () => {
  const sent = { type: "rename", id: "6F1C2A1B-0000-4000-8000-000000000001", title: "우유 사기", extra: "dropped", __proto__: { polluted: true } };
  const read = readAction(sent);
  assert.deepEqual(read, { type: "rename", id: "6F1C2A1B-0000-4000-8000-000000000001", title: "우유 사기" });
  assert.notEqual(read, sent);
  assert.deepEqual(readAction({ type: "moveTasks", ids: ["a", "b"], target: { kind: "day", day: "2026-11-04", x: 1 } }), { type: "moveTasks", ids: ["a", "b"], target: { kind: "day", day: "2026-11-04" } });
  assert.deepEqual(readAction({ type: "focus", command: { kind: "start", taskId: "a", minutes: 25 } }), { type: "focus", command: { kind: "start", taskId: "a", minutes: 25 } });
  assert.deepEqual(readAction({ type: "todoSpace", ids: ["a"], space: null }), { type: "todoSpace", ids: ["a"], space: null });
  assert.deepEqual(readAction({ type: "editingReminder", id: undefined }), { type: "editingReminder" });
  assert.deepEqual(readAction({ type: "setPref", key: "drawerSide", value: "left" }), { type: "setPref", key: "drawerSide", value: "left" });
  assert.deepEqual(readAction({ type: "setPref", key: "drawerNightPaper", value: false }), { type: "setPref", key: "drawerNightPaper", value: false });
  // 2A (#115 · #120): 보기 · 이 폴더, 지운 메모.
  assert.deepEqual(readAction({ type: "folderView", id: "pinned", view: "titles" }), { type: "folderView", id: "pinned", view: "titles" });
  assert.deepEqual(readAction({ type: "memoUntrash", id: "m1", junk: 1 }), { type: "memoUntrash", id: "m1" });
  assert.deepEqual(readAction({ type: "memoTrashEmpty" }), { type: "memoTrashEmpty" });
  // #168: several picked rows moved together, and put back.
  assert.deepEqual(readAction({ type: "groupDrop", id: "a", ids: ["a", "b"], space: "s1", targetID: "c", after: true }), { type: "groupDrop", id: "a", ids: ["a", "b"], space: "s1", targetID: "c", after: true });
  assert.deepEqual(readAction({ type: "groupDrop", id: "a", space: null }), { type: "groupDrop", id: "a", space: null });
  assert.deepEqual(readAction({ type: "moveMany", ids: ["a", "b"], targetID: "c", after: false, x: 1 }), { type: "moveMany", ids: ["a", "b"], targetID: "c", after: false });
  assert.deepEqual(readAction({ type: "restoreOrder", ids: ["a"], previous: ["b", "a", "c"] }), { type: "restoreOrder", ids: ["a"], previous: ["b", "a", "c"] });
  const alarm = readAction({ type: "alarmSave", alarm: { id: "x", time: "7:05", days: [1, 9], enabled: true, sound: "bell", snooze: 5 } });
  assert.equal(alarm?.type === "alarmSave" && alarm.alarm.time, "07:05");
});

test("actions: bad shapes are refused", () => {
  const bad: unknown[] = [
    undefined, null, 42, "rename", [], [{ type: "toggle", id: "a" }], {}, { type: "nope" }, { type: "toString" }, { type: "__proto__" },
    { type: "rename", id: "a" }, { type: "rename", id: 7, title: "x" }, { type: "rename", id: "a", title: "x".repeat(10_001) },
    { type: "toggle", id: "a".repeat(201) }, { type: "toggle" }, { type: "move", id: "a", targetID: "b", after: "yes" },
    { type: "moveTasks", ids: "a", target: { kind: "someday" } }, { type: "moveTasks", ids: ["a"], target: { kind: "elsewhere" } },
    { type: "moveTasks", ids: ["a"], target: { kind: "day", day: "tomorrow" } }, { type: "moveTasks", ids: [1], target: { kind: "someday" } },
    { type: "groupDrop", id: "a", ids: "a", space: null }, { type: "groupDrop", id: "a", ids: ["a", 2], space: null },
    { type: "groupDrop", id: "a", ids: Array(5_001).fill("a"), space: null }, { type: "moveMany", ids: ["a"], targetID: "b" },
    { type: "moveMany", ids: [{}], targetID: "b", after: true }, { type: "moveMany", ids: Array(5_001).fill("a"), targetID: "b", after: true },
    { type: "restoreOrder", ids: ["a"] }, { type: "restoreOrder", ids: ["a"], previous: [null] },
    { type: "aiEnable", on: "true" }, { type: "aiEnable" }, { type: "deleteBackup", name: "" }, { type: "deleteBackup", name: { length: 1 } },
    { type: "window", command: "destroy" }, { type: "openLink", url: 5 }, { type: "snoozePeriodic", minutes: 0 },
    { type: "snoozePeriodic", minutes: 1.5 }, { type: "showMenu", menu: "more", x: Number.NaN, y: 0 }, { type: "showMenu", menu: "more", x: Infinity, y: 0 },
    { type: "focus", command: { kind: "start", minutes: -1 } }, { type: "focus", command: "start" }, { type: "timerCommand", command: { kind: "explode" } },
    { type: "alarmSave", alarm: { id: "x", time: "25:99" } }, { type: "deskPane", pane: "secret" }, { type: "editCommand", command: "delete" },
    { type: "restoreSeries", series: { id: "s", title: "t", rule: { kind: "hourly" }, createdAt: "x" }, todos: [] },
    { type: "memoUpdate", id: "m", text: "x".repeat(2_000_001) },
    { type: "folderView", id: "f", view: "list" }, { type: "folderView", view: "cards" }, { type: "memoUntrash", id: 3 },
    { type: "setPref", key: "drawerPinnedView", value: "list" },
    // setPref: a key the app doesn't have, a value of the wrong kind, a value the setting can't hold, one no page writes.
    { type: "setPref", key: "notAPref", value: true }, { type: "setPref", key: "__proto__", value: {} }, { type: "setPref", key: "hideCompleted", value: "yes" },
    { type: "setPref", key: "drawerSide", value: "up" }, { type: "setPref", key: "textStep", value: 99 }, { type: "setPref", key: "eveningSweepTime", value: "8pm" },
    { type: "setPref", key: "intentLearning", value: { streak: {}, order: [] } }, { type: "setPref", key: "spaceGroupsFolded", value: [1, 2] },
    { type: "setPref", key: "drawerShortcut", value: "Control+Shift+D; rm -rf" },
  ];
  for (const message of bad) assert.equal(readAction(message), undefined, JSON.stringify(message)?.slice(0, 80));
});

test("actions: each page asks only for its own", () => {
  const ask = (page: PageName, action: unknown) => { const read = readAction(action); return Boolean(read && mayAct(page, read)); };
  // The sensitive ones only from the settings pane (review L-02: aiEnable, the backups, the storage folder, settings).
  for (const action of [{ type: "aiEnable", on: true }, { type: "deleteBackup", name: "직접-20261030-080000.jongi" }, { type: "restoreBackup", name: "x.jongi" }, { type: "chooseStorage" }, { type: "importBackup" }]) {
    assert.equal(ask("settings", action), true, JSON.stringify(action));
    for (const page of pageNames.filter((name) => name !== "settings")) assert.equal(ask(page, action), false, `${page} ${JSON.stringify(action)}`);
  }
  // Pages without buttons for the main process ask for nothing.
  for (const page of ["help", "popup", "floating", "pet", "timer", "quickMemo", "timerSheet", "ring", "confirm", "handle", "ears"] as const) {
    assert.equal(ask(page, { type: "toggle", id: "a" }), false, page);
  }
  assert.equal(ask("note", { type: "toggle", id: "a" }), true);
  assert.equal(ask("drawer", { type: "openLink", url: "https://example.com" }), true);
  assert.equal(ask("note", { type: "openLink", url: "https://example.com" }), false);
  assert.equal(ask("drawer", { type: "memoTrashEmpty" }), true);
  assert.equal(ask("note", { type: "memoTrashEmpty" }), false);
  assert.equal(ask("settings", { type: "memoUntrash", id: "m1" }), false);
  assert.equal(ask("desk", { type: "deskPane", pane: "ai" }), true);
  assert.equal(ask("history", { type: "deskPane", pane: "ai" }), false);
  // setPref: only the page's own settings.
  assert.equal(ask("drawer", { type: "setPref", key: "drawerSide", value: "left" }), true);
  assert.equal(ask("drawer", { type: "setPref", key: "openAtLogin", value: true }), false);
  assert.equal(ask("glance", { type: "setPref", key: "petVisible", value: false }), true);
  assert.equal(ask("glance", { type: "setPref", key: "language", value: "en" }), false);
  assert.equal(ask("settings", { type: "setPref", key: "language", value: "en" }), true);
  assert.equal(ask("settings", { type: "setPref", key: "aiEnabled", value: true }), false);
  for (const page of pageNames) assert.equal(ask(page, { type: "setPref", key: "aiEnabled", value: true }), false, page);
});

test("the other channels: input-line and event-sheet requests", () => {
  assert.deepEqual(readIntentRequest({ op: "learn", from: "todo", to: "event", junk: 1 }), { op: "learn", from: "todo", to: "event" });
  assert.ok(readIntentRequest({ op: "commit", candidate: { kind: "todo", title: "우유" }, page: "today", from: "note", space: { kind: "none" } }));
  for (const bad of [{ op: "commit", candidate: { kind: "todo" }, page: "today", from: "note" }, { op: "commit", candidate: { kind: "todo", title: "x" }, page: "today", from: "web" }, { op: "rm" }, null]) {
    assert.equal(readIntentRequest(bad), undefined, JSON.stringify(bad));
  }
  const draft = { title: "치과", color: "blue", date: "2026-11-04", allDay: false, days: 1, startMinutes: 600, endMinutes: 660, repeat: "none" };
  assert.ok(readCalendarRequest({ kind: "create", draft }));
  assert.ok(readCalendarRequest({ kind: "skip", id: "e", day: "2026-11-04" }));
  for (const bad of [{ kind: "drop" }, { kind: "create", draft: { ...draft, startMinutes: "10" } }, { kind: "skip", id: "e", day: "x" }]) assert.equal(readCalendarRequest(bad), undefined);
});

test("senders: our page in our window, in its own frame (the desk's panes in the desk's frames)", () => {
  const facts = (frameUrl: string, more: Partial<Parameters<typeof senderPageOf>[0]> = {}) => ({ frameUrl, isMainFrame: true, parentIsMain: false, topUrl: frameUrl, ourWindow: true, ...more });
  assert.equal(senderPageOf(facts(`${renderer}/note.html`), renderer), "note");
  assert.equal(senderPageOf(facts(`${renderer}/settings.html?pane=ai`, { isMainFrame: false, parentIsMain: true, topUrl: `${renderer}/desk.html?pane=ai` }), renderer), "settings");
  // Wrong senders.
  assert.equal(senderPageOf(facts(`${renderer}/note.html`, { ourWindow: false }), renderer), undefined, "not one of our windows");
  assert.equal(senderPageOf(facts(`${renderer}/note.html`, { isMainFrame: false, parentIsMain: true }), renderer), undefined, "a frame inside the note");
  assert.equal(senderPageOf(facts(`${renderer}/settings.html`), renderer), undefined, "a desk pane as a window of its own");
  assert.equal(senderPageOf(facts(`${renderer}/settings.html`, { isMainFrame: false, parentIsMain: true, topUrl: `${renderer}/note.html` }), renderer), undefined, "a pane inside another page");
  assert.equal(senderPageOf(facts(`${renderer}/settings.html`, { isMainFrame: false, parentIsMain: false, topUrl: `${renderer}/desk.html` }), renderer), undefined, "a frame deeper in the desk");
  assert.equal(senderPageOf(facts("https://example.com/note.html"), renderer), undefined);
  assert.equal(senderPageOf(facts("file:///tmp/note.html"), renderer), undefined);
  assert.equal(senderPageOf(facts(`${renderer}/evil.html`), renderer), undefined);
  assert.equal(senderPageOf(facts("about:blank"), renderer), undefined);
});

test("jongi-nyang: links — an alarm's 끄기 · 다시 알림 need this notification's nonce", () => {
  const nonce = makeNonce();
  assert.match(nonce, /^[0-9a-f]{32}$/);
  assert.notEqual(makeNonce(), nonce);
  const link = (text: string) => readNotifyLink(["x.exe", text])!;
  assert.deepEqual(acceptNotifyAction(link(`jongi-nyang:alarm-stop?n=${nonce}`), nonce), { kind: "alarmStop", nonce });
  assert.deepEqual(acceptNotifyAction(link(`jongi-nyang:alarm-snooze?n=${nonce}`), nonce), { kind: "alarmSnooze", nonce });
  // Missing, wrong or stale (no alarm ringing): only the note opens.
  assert.deepEqual(acceptNotifyAction(link("jongi-nyang:alarm-stop"), nonce), { kind: "open" });
  assert.deepEqual(acceptNotifyAction(link(`jongi-nyang:alarm-stop?n=${makeNonce()}`), nonce), { kind: "open" });
  assert.deepEqual(acceptNotifyAction(link(`jongi-nyang:alarm-snooze?n=${nonce}`), undefined), { kind: "open" });
  assert.deepEqual(acceptNotifyAction(link("jongi-nyang:alarm-stop?n="), nonce), { kind: "open" });
  // Tasks' links are unchanged (they need the tasks' ids).
  assert.deepEqual(acceptNotifyAction(link("jongi-nyang:done?ids=A"), undefined), { kind: "done", ids: ["A"] });
  assert.deepEqual(acceptNotifyAction(link("jongi-nyang:open"), undefined), { kind: "open" });
});

/** A renderer page's own modules (relative imports, not `import type`), from its entry file. */
function modulesOf(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"(\.[^"]+)"/gm)) visit(path.resolve(path.dirname(file), `${match[1]}.ts`));
    for (const match of source.matchAll(/^export\s+(?!type\b)[^;]*?from\s+"(\.[^"]+)"/gm)) visit(path.resolve(path.dirname(file), `${match[1]}.ts`));
  };
  visit(path.join(root, "src/renderer", `${entry}.ts`));
  return [...seen].filter((file) => !file.endsWith(path.join("core", "types.ts")));
}

test("the allowlists match what each page's code sends (a new button needs its action allowed, and only that)", () => {
  const typesSource = fs.readFileSync(path.join(root, "src/core/types.ts"), "utf8");
  const block = typesSource.slice(typesSource.indexOf("export type Action ="), typesSource.indexOf("\n\n", typesSource.indexOf("export type Action =")));
  const actionTypes = new Set([...block.matchAll(/type: "(\w+)"/g)].map((match) => match[1]));
  assert.ok(actionTypes.size > 90);
  for (const page of pageNames) {
    const sent = new Set<string>();
    const keys = new Set<string>();
    for (const file of modulesOf(page)) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/type:\s*"(\w+)"/g)) if (actionTypes.has(match[1])) sent.add(match[1]);
      for (const match of source.matchAll(/"setPref", key: "(\w+)"/g)) keys.add(match[1]);
      if (file.endsWith("settings.ts")) for (const match of source.matchAll(/\bset\("(\w+)"/g)) keys.add(match[1]);
      if (file.endsWith("note.ts") && source.includes('toggleGroupKey(pref: "spaceGroupsFolded" | "spaceGroupsDoneOpen"')) { keys.add("spaceGroupsFolded"); keys.add("spaceGroupsDoneOpen"); }
    }
    const allowed = [...(pageActions[page] ?? [])].sort();
    assert.deepEqual(allowed, [...sent].sort(), `${page}: pageActions`);
    assert.deepEqual([...(pagePrefs[page] ?? [])].sort(), [...keys].sort(), `${page}: pagePrefs`);
  }
});

test("main.ts reads every message before using it", () => {
  const source = fs.readFileSync(path.join(root, "src/main/main.ts"), "utf8");
  const register = source.slice(source.indexOf("function registerIPC()"), source.indexOf("\n}\n", source.indexOf("function registerIPC()")));
  assert.match(register, /readAction\(value\)/);
  assert.match(register, /mayAct\(page, action\)/);
  assert.match(register, /readIntentRequest\(value\)/);
  assert.match(register, /readCalendarRequest\(value\)/);
  assert.doesNotMatch(register, /\(_event/, "every handler looks at its sender");
  const sample: Action = { type: "toggle", id: "a" };
  assert.ok(readAction(sample));
});
