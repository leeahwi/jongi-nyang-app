import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  addedHidden, checkedDeviceRules, cleanedDeviceRules, dayWords, deviceFitting, deviceHint, deviceKey, deviceLens, deviceLensForDigit, deviceLine,
  deviceMinutes, deviceMoment, deviceNowLine, devicePeeking, devicePresets, deviceRings, deviceSentence, deviceStatus, deviceSummary, fitLength,
  hiddenSpaces, hideAgainWord, isHiddenSpace, lineKeys, peekWord, readDeviceRules, ruleShows, showsAt, storedDeviceRules, type DevicePreset,
  type DeviceRule, type DeviceRules,
} from "../src/core/spaceDevice";
import { dayKey } from "../src/core/archive";
import { mayAct, readAction } from "../src/core/ipcCheck";
import { emptyTodoSpaces, findSpace, inLens, lensNone, parseTodoSpaces } from "../src/core/todoSpaces";
import type { Lang } from "../src/core/lang";

// 기기마다 보일 스페이스 (#196): the shared cases S60–S72 from docs/plans/spaces-cases.json → `device` (the Mac's
// test-space-device.sh reads the same), then Windows' own. Run with TZ=Asia/Seoul (the file's time zone).

const fixture = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "spaces-cases.json"), "utf8"));
const cases = fixture.device;
const rule = (name: string | null | undefined): DeviceRule | undefined => (name ? readDeviceRules({ x: cases.rules[name] }).x : undefined);
const spaces = parseTodoSpaces(JSON.stringify({ version: 1, items: {}, spaces: cases.spaces }));
const hideRules = (keys: string[] | undefined): DeviceRules => Object.fromEntries((keys ?? []).map((key) => [key, { show: "hide" } as DeviceRule]));
const someday = new Date("2026-11-03T01:00:00Z");
const todos: { space: string | null; done: boolean }[] = cases.todos;

test("the shared cases run in the file's time zone", () => {
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, fixture.timeZone);
  assert.equal(cases.fitLength, fitLength);
});

test("S60–S63: a day and a minute", () => {
  for (const entry of cases.visible) {
    assert.equal(ruleShows(rule(entry.rule), entry.day, deviceMinutes(entry.time)!), entry.visible, `${entry.case} ${entry.rule} ${entry.day} ${entry.time}`);
  }
});

test("S64: the wall clock, apart from the 4 a.m. day", () => {
  for (const entry of cases.instants) {
    const date = new Date(entry.at);
    const moment = deviceMoment(date);
    assert.equal(moment.day, entry.day, entry.at);
    assert.equal(`${String(Math.floor(moment.minute / 60)).padStart(2, "0")}:${String(moment.minute % 60).padStart(2, "0")}`, entry.time, entry.at);
    assert.equal(dayKey(date), entry.logicalDay, entry.at);
    for (const [name, expected] of Object.entries(entry.visible)) assert.equal(showsAt(rule(name), date), expected, `${entry.at} ${name}`);
  }
});

test("S65: reading the setting", () => {
  for (const entry of cases.read) {
    const read = readDeviceRules(entry.value);
    assert.deepEqual(storedDeviceRules(read), entry.expect, entry.note);
    assert.deepEqual(readDeviceRules(storedDeviceRules(read)), read, `${entry.note}: round trip`);
    // The page's value goes through the same reading (ipcCheck).
    if (entry.value && typeof entry.value === "object" && !Array.isArray(entry.value)) assert.deepEqual(checkedDeviceRules(entry.value), entry.expect, entry.note);
  }
  assert.equal(checkedDeviceRules(["s-a"]), undefined);
});

test("S66: what is hidden now", () => {
  for (const entry of cases.hidden) {
    const rules = Object.fromEntries(Object.entries(entry.rules as Record<string, string>).map(([key, name]) => [key, rule(name)!]));
    const hidden = hiddenSpaces(rules, entry.noSpaces ? emptyTodoSpaces() : spaces, new Date(entry.at));
    assert.deepEqual([...hidden].sort(), entry.expect, entry.note);
  }
  for (const entry of cases.places) {
    const rules = Object.fromEntries(Object.entries(entry.rules as Record<string, string>).map(([key, name]) => [key, rule(name)!]));
    assert.equal(isHiddenSpace(entry.space, hiddenSpaces(rules, spaces, someday), spaces), entry.hidden, entry.note ?? entry.space);
  }
});

test("S67: the sheet, every space hidden, peeking", () => {
  for (const entry of cases.sheet) {
    const hidden = hiddenSpaces(hideRules(entry.hide), spaces, someday);
    const peek = new Set<string>((entry.peek ?? []).filter((key: string) => hidden.has(key)));
    const onNote = new Set([...hidden].filter((key) => !peek.has(key)));
    assert.equal(todos.filter((todo) => !isHiddenSpace(todo.space, onNote, spaces)).length, entry.shown, entry.note);
    const open = todos.filter((todo) => !todo.done).map((todo) => deviceKey(findSpace(spaces, todo.space)?.id));
    assert.deepEqual(lineKeys(open, onNote, spaces), entry.line, entry.note);
    assert.deepEqual(lineKeys(open, peek, spaces), entry.peeking ?? [], entry.note);
  }
});

test("S68: the lens and the digits", () => {
  for (const entry of cases.lens) {
    const hidden = hiddenSpaces(hideRules(entry.hide), spaces, someday);
    const onNote = new Set([...hidden].filter((key) => !(entry.peek ?? []).includes(key)));
    const shown = deviceLens(entry.lens, onNote);
    assert.equal(shown ?? null, entry.expect, entry.note);
    const more = shown === undefined ? 0
      : todos.filter((todo) => !todo.done && !isHiddenSpace(todo.space, onNote, spaces) && !inLens(shown, findSpace(spaces, todo.space)?.id)).length;
    assert.equal(more, entry.more, entry.note);
  }
  for (const entry of cases.digits) {
    const shown = deviceLensForDigit(spaces, entry.digit, hiddenSpaces(hideRules(entry.hide), spaces, someday));
    assert.equal(shown === null ? "nothing" : shown === undefined ? "all" : shown, entry.expect, `digit ${entry.digit}`);
  }
  assert.equal(lensNone, "none");
});

test("S69: reminders", () => {
  for (const entry of cases.reminders) {
    const rings = deviceRings(rule(entry.rule), new Date(entry.alert), new Date(entry.now), entry.shownSince ? new Date(entry.shownSince) : undefined);
    assert.equal(rings, entry.rings, entry.note ?? entry.rule);
  }
});

test("S70: the summary's words", () => {
  for (const entry of cases.summary) {
    const lang = entry.lang as Lang;
    const found = rule(entry.rule);
    assert.ok(found && found.show === "time");
    const times = found.times;
    const name = `${entry.rule} ${lang}`;
    assert.equal(deviceSummary(times, lang), entry.full, name);
    assert.equal(deviceSummary(times, lang, true), entry.short, name);
    assert.equal(deviceFitting(times, lang), entry.fits, name);
    assert.equal(deviceSentence(times, lang), entry.sentence, name);
    assert.equal(deviceHint(times, true, lang), entry.hintHidden, name);
    assert.equal(deviceHint(times, false, lang), entry.hintShown, name);
    assert.equal(deviceStatus(found, false, lang), entry.statusShown, name);
    assert.equal(deviceStatus(found, true, lang), entry.statusHidden, name);
  }
  for (const entry of cases.days) for (const lang of ["ko", "en", "nl"] as Lang[]) assert.equal(dayWords(entry.days, lang), entry[lang], `${entry.days} ${lang}`);
  for (const entry of cases.groupsOrder) {
    const read = readDeviceRules({ x: { show: "time", times: entry.times } }).x;
    assert.ok(read.show === "time");
    assert.equal(deviceSummary(read.times, "ko"), entry.ko, entry.note);
  }
});

test("S71: the end line and the toast", () => {
  for (const entry of cases.words) {
    const lang = entry.lang as Lang;
    assert.equal(deviceLine(entry.names, lang), entry.line);
    assert.equal(peekWord(lang), entry.peek);
    assert.equal(devicePeeking(entry.names, lang), entry.peeking);
    assert.equal(hideAgainWord(lang), entry.hideAgain);
  }
  for (const entry of cases.toasts) assert.equal(addedHidden(entry.name, entry.lang as Lang), entry.toast);
});

test("S72 and the presets", () => {
  const rules = Object.fromEntries(Object.entries(cases.clean.rules as Record<string, string>).map(([key, name]) => [key, rule(name)!]));
  assert.deepEqual(Object.keys(cleanedDeviceRules(rules, spaces)).sort(), cases.clean.expect);
  for (const entry of cases.presets) {
    const preset = devicePresets[entry.id as DevicePreset];
    const read = readDeviceRules({ x: { show: "time", times: entry.times } }).x;
    assert.ok(read.show === "time");
    assert.deepEqual(preset.times, read.times, entry.id);
    for (const lang of ["ko", "en", "nl"] as Lang[]) assert.equal(preset.title[lang], entry[lang]);
  }
});

// ─── Windows' own ───────────────────────────────────────────────────────────

test("a page's 이 기기에서 goes through ipcCheck with the same reading; 잠깐 보기 only from the note", () => {
  const sent = readAction({ type: "setPref", key: "spaceDevice", value: { "s-a": { show: "time", times: [{ days: [5, 1, 1], from: "09:00", to: "18:00", extra: 1 }] }, bad: "hide" } });
  assert.deepEqual(sent, { type: "setPref", key: "spaceDevice", value: { "s-a": { show: "time", times: [{ days: [1, 5], from: "09:00", to: "18:00" }] } } });
  assert.ok(sent && mayAct("settings", sent) && mayAct("note", sent));
  assert.equal(sent && mayAct("glance", sent), false);
  assert.equal(readAction({ type: "setPref", key: "spaceDevice", value: "hide" }), undefined);
  assert.equal(readAction({ type: "setPref", key: "spaceDeviceShown", value: {} }), undefined);
  const peek = readAction({ type: "spacePeek", spaces: ["s-a", "none"] });
  assert.deepEqual(peek, { type: "spacePeek", spaces: ["s-a", "none"] });
  assert.ok(peek && mayAct("note", peek));
  assert.equal(peek && mayAct("settings", peek), false);
  assert.equal(readAction({ type: "spacePeek", spaces: "s-a" }), undefined);
});

test("the slip's now line and the desk's lines", () => {
  assert.equal(deviceNowLine(false, new Date("2026-11-03T11:10:00Z"), "ko"), "지금(화 20:10)은 숨어 있어요");
  assert.equal(deviceNowLine(true, new Date("2026-11-03T11:10:00Z"), "ko"), "지금(화 20:10) 보여요");
  assert.equal(deviceNowLine(true, new Date("2026-11-03T11:10:00Z"), "en"), "Showing now (Tue 8:10 PM)");
  assert.equal(deviceStatus({ show: "hide" }, true, "ko"), "이 기기에서 숨겨 뒀어요");
  assert.equal(deviceStatus(undefined, false, "ko"), undefined);
  assert.equal(deviceLens("s-a", new Set()), "s-a");
  assert.equal(isHiddenSpace("s-a", new Set(), spaces), false);
});
