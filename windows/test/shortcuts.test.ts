import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultDrawerShortcut, readShortcut, type KeyPress } from "../src/core/memoDrawer";
import { defaultNoteShortcut, hasModifier, keyCaps, noteToggle, quickEntryShortcut, quickMemoShortcut, readNoteShortcut, refusedFor, takenBy } from "../src/core/shortcuts";

// Keys from any app (core/shortcuts.ts, #85): the cases S1–S14 shared with the Mac (Tests/PaperCoreTests/ShortcutTests.swift).

const standard = { note: defaultNoteShortcut, drawer: defaultDrawerShortcut };
const press = (code: string, mods: Partial<KeyPress> = {}): KeyPress => ({ key: code.replace(/^Key/, ""), code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test("S1–S3: the defaults and their caps", () => {
  assert.equal(defaultNoteShortcut, "Control+Alt+J");
  assert.equal(defaultDrawerShortcut, "Control+Shift+D");
  assert.deepEqual(keyCaps(defaultNoteShortcut), ["Ctrl", "Alt", "J"]);
  assert.deepEqual(keyCaps("Control+Alt+Shift+Super+Left"), ["Ctrl", "Alt", "Shift", "Win", "←"]);
  assert.deepEqual(keyCaps(""), []);
});

test("S4: the note can't take 빠른 입력, 빠른 메모 or the drawer's key", () => {
  assert.equal(takenBy(quickEntryShortcut, "note", standard), "quickEntry");
  assert.equal(takenBy(quickMemoShortcut, "note", standard), "quickMemo");
  assert.equal(takenBy(defaultDrawerShortcut, "note", standard), "drawer");
  assert.equal(takenBy("Control+Shift+E", "note", { note: defaultNoteShortcut, drawer: "Control+Shift+E" }), "drawer");
});

test("S5: the drawer's default stays refused while the drawer has another key or is off", () => {
  assert.equal(takenBy(defaultDrawerShortcut, "note", { note: defaultNoteShortcut, drawer: "Control+Shift+E" }), "drawer");
  assert.equal(takenBy(defaultDrawerShortcut, "note", { note: defaultNoteShortcut, drawer: "" }), "drawer");
});

test("S6: a free key, and the note's own key, are fine for the note", () => {
  assert.equal(takenBy("Control+Alt+K", "note", standard), undefined);
  assert.equal(takenBy(defaultNoteShortcut, "note", { note: "Control+Alt+K", drawer: defaultDrawerShortcut }), undefined);
  assert.equal(takenBy("Control+Alt+K", "note", { note: "Control+Alt+K", drawer: defaultDrawerShortcut }), undefined);
});

test("S7: the drawer can't take the note's key, chosen or default", () => {
  const moved = { note: "Control+Alt+K", drawer: "" };
  assert.equal(takenBy(defaultNoteShortcut, "drawer", moved), "note");
  assert.equal(takenBy("Control+Alt+K", "drawer", moved), "note");
  assert.equal(takenBy(quickMemoShortcut, "drawer", moved), "quickMemo");
  assert.equal(takenBy("Control+Shift+E", "drawer", { note: "Control+Alt+K", drawer: defaultDrawerShortcut }), undefined);
});

test("S8: the recorders refuse what takenBy refuses (and the drawer's three stay refused as before)", () => {
  const moved = { note: "Control+Alt+K", drawer: defaultDrawerShortcut };
  assert.deepEqual(readShortcut(press("KeyK", { ctrlKey: true, altKey: true }), refusedFor("drawer", moved)), { problem: "reserved" });
  assert.deepEqual(readShortcut(press("KeyJ", { ctrlKey: true, altKey: true }), refusedFor("drawer", moved)), { problem: "reserved" });
  assert.deepEqual(readShortcut(press("KeyD", { ctrlKey: true, shiftKey: true }), refusedFor("note", moved)), { problem: "reserved" });
  assert.deepEqual(readShortcut(press("KeyK", { ctrlKey: true, altKey: true }), refusedFor("note", moved)), { accelerator: "Control+Alt+K" });
  for (const key of ["KeyM", "KeyJ", "KeyN"]) assert.deepEqual(readShortcut(press(key, { ctrlKey: true, altKey: true })), { problem: "reserved" });
});

test("S9: a key needs Ctrl, Alt or Win (F-keys aside)", () => {
  assert.equal(hasModifier("Shift+J"), false);
  assert.equal(hasModifier("J"), false);
  assert.equal(hasModifier("Control+Shift+E"), true);
  assert.equal(hasModifier("Super+5"), true);
  assert.equal(hasModifier("F8"), true);
  assert.deepEqual(readShortcut(press("KeyJ", { shiftKey: true }), refusedFor("note", standard)), { problem: "modifier" });
});

test("S10: nothing saved (before 1.30.1) is Ctrl+Alt+J", () => {
  assert.equal(readNoteShortcut(undefined, defaultDrawerShortcut), defaultNoteShortcut);
  assert.equal(readNoteShortcut("", defaultDrawerShortcut), defaultNoteShortcut);
  assert.equal(readNoteShortcut(42, defaultDrawerShortcut), defaultNoteShortcut);
  assert.equal(readNoteShortcut("Control+Alt+<script>", defaultDrawerShortcut), defaultNoteShortcut);
});

test("S11: a saved key comes back, and a taken one falls back to Ctrl+Alt+J", () => {
  assert.equal(readNoteShortcut("Control+Alt+K", defaultDrawerShortcut), "Control+Alt+K");
  assert.equal(readNoteShortcut("Control+Shift+E", "Control+Shift+E"), defaultNoteShortcut);
  assert.equal(readNoteShortcut(quickEntryShortcut, ""), defaultNoteShortcut);
  assert.equal(readNoteShortcut("Shift+K", ""), defaultNoteShortcut);
});

test("S12: the drawer's saved key reads as before", () => {
  // (The Mac's JSON case: here the drawer's accelerator, as 1.28 saved it.)
  assert.deepEqual(refusedFor("drawer", standard).sort(), ["Control+Alt+J", "Control+Alt+M", "Control+Alt+N"]);
  assert.deepEqual(refusedFor("note", { note: defaultNoteShortcut, drawer: "" }).sort(), ["Control+Alt+M", "Control+Alt+N", "Control+Shift+D"]);
});

test("S13: on screen hides, otherwise it comes forward", () => {
  assert.equal(noteToggle({ visible: true, minimized: false, folded: false }), "hide");
  assert.equal(noteToggle({ visible: false, minimized: false, folded: false }), "show");
  assert.equal(noteToggle({ visible: false, minimized: false, folded: true }), "show");
  assert.equal(noteToggle({ visible: true, minimized: true, folded: false }), "show");
});

test("S14: covered (where it can be told) comes forward; Windows can't tell, so it hides", () => {
  assert.equal(noteToggle({ visible: true, minimized: false, folded: false, uncovered: false }), "show");
  assert.equal(noteToggle({ visible: true, minimized: false, folded: true, uncovered: true }), "show");
  assert.equal(noteToggle({ visible: true, minimized: false, folded: false, uncovered: undefined }), "hide");
});
