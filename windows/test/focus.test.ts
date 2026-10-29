import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { isBackupName, mergeFiles, parseBackup, makeBackup, readable, replaceFiles, summary, summaryText } from "../src/core/backup";
import {
  appendFocus, focusByTask, focusLine, focusNextLine, focusRecord, focusSummary, focusTotal, focusTotals, mergeFocus, parseFocus, type FocusRecord,
} from "../src/core/focus";
import { glanceCards, glanceText, type GlanceTimer } from "../src/core/glance";
import { isoDate } from "../src/core/notebook";
import type { Lang } from "../src/core/lang";
import { copyData, mergeArchive, readDataFiles } from "../src/main/storageFolder";

/**
 * 집중 기록 (focus.jsonl): the shared cases of focus-cases.md (written by the
 * Windows side; the macOS app passes the same rows), then the backup, storage and glance rows.
 */

const local = (text: string) => { const [day, time] = text.split(" "); const [y, m, d] = day.split("-").map(Number); const [hh, mm] = time.split(":").map(Number); return new Date(y, m - 1, d, hh, mm); };
const rec = (id: string, title: string, taskId: string | undefined, start: string, end: string, minutes: number, kind: "focus" | "timer", done = false): FocusRecord =>
  ({ id, ...(taskId ? { taskId } : {}), title, start: isoDate(local(start)), end: isoDate(local(end)), minutes, kind, done });

const R: FocusRecord[] = [
  rec("r1", "보고서 마무리", "T1", "2026-10-08 09:00", "2026-10-08 09:25", 25, "focus", true),
  rec("r2", "보고서 마무리", "T1", "2026-10-08 10:00", "2026-10-08 10:50", 50, "focus"),
  rec("r3", "", undefined, "2026-10-08 13:00", "2026-10-08 13:40", 40, "timer"),
  rec("r4", "책 읽기", "T2", "2026-10-08 23:50", "2026-10-09 00:20", 30, "focus"),
  rec("r5", "책 읽기", "T2", "2026-10-09 03:30", "2026-10-09 04:10", 40, "focus"),
  rec("r6", "산책", undefined, "2026-10-09 07:00", "2026-10-09 07:15", 15, "focus"),
  rec("r7", "운동", "T3", "2026-10-01 18:00", "2026-10-01 18:30", 30, "focus", true),
  rec("r8", "Book", "T2", "2026-10-09 20:00", "2026-10-09 20:30", 30, "focus"),
];
const day = (text: string) => local(`${text} 12:00`);
const totals = (from: string, to: string) => [...focusTotals(R, day(from), day(to))].map(([key, minutes]) => `${key} ${minutes}`).join(" · ");
const byTask = (from: string, to: string, limit?: number, records = R) =>
  focusByTask(records, day(from), day(to), limit).map((task) => `${task.title} ${task.minutes} (${task.sessions}${task.taskId ? `, ${task.taskId}` : ""})`).join(" · ");
const langs: Lang[] = ["ko", "en", "nl"];

test("F1–F3 focus totals: minutes per logical day, a session on the day it started", () => {
  assert.equal(totals("2026-10-08", "2026-10-09"), "2026-10-08 185 · 2026-10-09 45");
  assert.equal(totals("2026-10-01", "2026-10-31"), "2026-10-01 30 · 2026-10-08 185 · 2026-10-09 45");
  assert.equal(totals("2026-09-01", "2026-09-30"), "");
  assert.deepEqual(focusTotal(R, day("2026-10-08"), day("2026-10-08")), { minutes: 185, sessions: 5 });
});

test("F4–F7 focus summary in three languages, with plurals", () => {
  const summaries = (from: string, to: string) => langs.map((lang) => focusSummary(R, day(from), day(to), lang));
  assert.deepEqual(summaries("2026-10-08", "2026-10-08"), ["집중 3시간 5분 · 5번", "Focus 3 h 5 min · 5 sessions", "Focus 3 u 5 min · 5 sessies"]);
  assert.deepEqual(summaries("2026-10-09", "2026-10-09"), ["집중 45분 · 2번", "Focus 45 min · 2 sessions", "Focus 45 min · 2 sessies"]);
  assert.deepEqual(summaries("2026-10-01", "2026-10-01"), ["집중 30분 · 1번", "Focus 30 min · 1 session", "Focus 30 min · 1 sessie"]);
  assert.deepEqual(summaries("2026-09-01", "2026-09-30"), ["집중 0분 · 0번", "Focus 0 min · 0 sessions", "Focus 0 min · 0 sessies"]);
});

test("F8–F11 focus by task: the most minutes first, the newest title, plain timers left out", () => {
  assert.equal(byTask("2026-10-01", "2026-10-09"), "Book 100 (3, T2) · 보고서 마무리 75 (2, T1) · 운동 30 (1, T3)");
  assert.equal(byTask("2026-10-01", "2026-10-09", 5), "Book 100 (3, T2) · 보고서 마무리 75 (2, T1) · 운동 30 (1, T3) · 산책 15 (1)");
  assert.equal(byTask("2026-10-08", "2026-10-08"), "보고서 마무리 75 (2, T1) · 책 읽기 70 (2, T2)");
  const ties = [
    rec("a", "가", undefined, "2026-10-08 09:00", "2026-10-08 09:20", 20, "focus"),
    rec("b", "나", undefined, "2026-10-08 10:00", "2026-10-08 10:20", 20, "focus"),
    rec("c", " 가 ", undefined, "2026-10-08 08:00", "2026-10-08 08:05", 5, "focus"),
  ];
  assert.equal(byTask("2026-10-08", "2026-10-08", 3, ties), "가 25 (2) · 나 20 (1)");
});

test("F12 focus parse: tolerant of bad, torn and repeated lines", () => {
  const lines = [
    '{"id":"A","taskId":"T","title":"가","start":"2026-10-08T00:00:00Z","end":"2026-10-08T00:25:00Z","minutes":25,"kind":"focus","done":true}',
    "",
    "not json",
    '{"id":"B","title":"","start":"2026-10-08T01:00:00.500Z","end":"2026-10-08T01:40:00.250Z","minutes":40,"kind":"timer","done":false}',
    '{"id":"A","title":"dup","start":"2026-10-08T02:00:00Z","end":"2026-10-08T02:10:00Z","minutes":10,"kind":"timer","done":false}',
    '{"id":"C","title":"no minutes","start":"2026-10-08T02:00:00Z","end":"2026-10-08T02:10:00Z"}',
    '{"id":"D","title":"bad start","start":"yesterday","end":"2026-10-08T02:10:00Z","minutes":5}',
    '{"id":"E","taskId":"T9","title":"no kind","start":"2026-10-08T03:00:00Z","end":"2026-10-08T03:12:00Z","minutes":12.4}',
    '{"id":"F","title":"odd kind","start":"2026-10-08T03:00:00Z","end":"2026-10-08T03:12:00Z","minutes":7,"kind":"nap"}',
    "[1,2]",
    '{"id":"G","title":"negative","start":"2026-10-08T03:00:00Z","end":"2026-10-08T03:12:00Z","minutes":-3}',
    '{"id":"","title":"empty id","start":"2026-10-08T03:00:00Z","end":"2026-10-08T03:12:00Z","minutes":3}',
    '{"id":"H","title":"torn',
  ];
  const records = parseFocus(lines.join("\r\n"));
  assert.deepEqual(records.map((record) => `${record.id} ${record.minutes} ${record.kind}${record.taskId ? ` ${record.taskId}` : ""}${record.done ? " done" : ""}`), ["A 25 focus T done", "B 40 timer", "E 12 focus T9", "F 7 timer"]);
  assert.equal(records[1].start, "2026-10-08T01:00:00.500Z"); // kept as written
  assert.deepEqual(parseFocus(""), []);
});

test("F13–F15 focus record: whole minutes, whole seconds, never under a minute", () => {
  const start = new Date(2026, 9, 8, 14, 0, 0, 700), end = new Date(2026, 9, 8, 14, 25, 0, 300);
  const made = focusRecord({ id: "X", taskId: "T", title: "  보고서  ", start, end, kind: "focus", done: true })!;
  assert.equal(made.minutes, 24);
  assert.equal(made.title, "보고서");
  assert.equal(made.start, isoDate(new Date(2026, 9, 8, 14, 0, 0)));
  assert.match(made.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.equal(made.end, isoDate(new Date(2026, 9, 8, 14, 25, 0)));
  const minutes = (activeMs: number) => focusRecord({ id: "Y", title: "", start, end, activeMs, kind: "timer" })?.minutes;
  assert.deepEqual([minutes(59_999), minutes(60_000), minutes(25 * 60_000)], [undefined, 1, 25]);
  // The line: the keys in order, a task only when there is one; it reads back the same.
  assert.equal(focusLine(made), `{"id":"X","taskId":"T","title":"보고서","start":"${made.start}","end":"${made.end}","minutes":24,"kind":"focus","done":true}`);
  const plain = focusRecord({ id: "Z", title: "", start, end, activeMs: 300_000, kind: "timer" })!;
  assert.equal(focusLine(plain), `{"id":"Z","title":"","start":"${plain.start}","end":"${plain.end}","minutes":5,"kind":"timer","done":false}`);
  const text = appendFocus(appendFocus('{"id":"torn"', made), plain);
  assert.deepEqual(parseFocus(text), [made, plain]);
  assert.ok(text.endsWith("\n"));
});

test("F16–F17 focus merge: by id, this side first", () => {
  const line = (id: string, title = id) => JSON.stringify({ id, title, start: "2026-10-08T00:00:00Z", end: "2026-10-08T00:25:00Z", minutes: 25, kind: "focus", done: false });
  const merged = mergeFocus(`${line("A")}\n${line("B")}\n`, `${line("B", "other")}\n${line("C")}\n${line("C")}\n\n`);
  assert.deepEqual(parseFocus(merged).map((record) => `${record.id} ${record.title}`), ["A A", "B B", "C C"]);
  const one = `${line("A")}\n`;
  assert.equal(mergeFocus(one, one), one);
});

// ─── Backup and storage ──────────────────────────────────────────────────────────

const focusText = (count: number) => Array.from({ length: count }, (_, index) => JSON.stringify({ id: `f${index}`, title: "가", start: "2026-10-08T00:00:00Z", end: "2026-10-08T00:25:00Z", minutes: 25, kind: "focus", done: false })).join("\n") + "\n";

test("FB1–FB2 backup: focus.jsonl travels, is never refused, and is counted last", () => {
  assert.ok(isBackupName("focus.jsonl"));
  assert.ok(!isBackupName("focus.json"));
  assert.ok(readable("focus.jsonl", "not json at all"));
  const parsed = parseBackup(makeBackup({ "focus.jsonl": "{torn\n" + focusText(2) }, "Windows 1.22.0", new Date()));
  assert.ok("backup" in parsed && parsed.backup.files["focus.jsonl"].includes('"f1"'));
  const counts = summary({ "focus.jsonl": focusText(18), "archive/2026-10.jsonl": "a\n".repeat(140) });
  assert.equal(counts.focus, 18);
  const texts = langs.map((lang) => summaryText({ ...counts, todos: 12 }, lang));
  assert.deepEqual(texts, ["할 일 12 · 완료 기록 140 · 집중 기록 18", "12 to-dos · 140 in history · 18 focus sessions", "12 taken · 140 in geschiedenis · 18 focussessies"]);
  const one = summary({ "focus.jsonl": focusText(1) });
  assert.deepEqual(langs.map((lang) => summaryText(one, lang)), ["집중 기록 1", "1 focus session", "1 focussessie"]);
});

test("FB3–FB4 backup: 합치기 merges focus by id, 바꾸기 takes the backup's (or empties)", () => {
  const merged = mergeFiles({ "focus.jsonl": focusText(2) }, { "focus.jsonl": focusText(3) });
  assert.deepEqual(parseFocus(merged["focus.jsonl"]).map((record) => record.id), ["f0", "f1", "f2"]);
  assert.equal(mergeFiles({}, { "focus.jsonl": focusText(1) })["focus.jsonl"], focusText(1));
  assert.equal(replaceFiles({ "focus.jsonl": focusText(2) }, { "focus.jsonl": focusText(1) })["focus.jsonl"], focusText(1));
  assert.equal(replaceFiles({ "focus.jsonl": focusText(2) }, { "todos.json": '{"items":[]}' })["focus.jsonl"], "");
  assert.equal(replaceFiles({}, { "todos.json": '{"items":[]}' })["focus.jsonl"], undefined);
});

test("FB5 storage: a move to another folder adds the sessions it lacks, by id", () => {
  const temporary = () => fs.mkdtempSync(path.join(os.tmpdir(), "paper-todo-focus-"));
  const source = temporary(), target = temporary();
  fs.writeFileSync(path.join(source, "focus.jsonl"), focusText(3));
  fs.writeFileSync(path.join(target, "focus.jsonl"), focusText(1));
  mergeArchive(source, target);
  assert.deepEqual(parseFocus(fs.readFileSync(path.join(target, "focus.jsonl"), "utf8")).map((record) => record.id), ["f0", "f1", "f2"]);
  const empty = temporary();
  copyData(source, empty);
  assert.equal(fs.readFileSync(path.join(empty, "focus.jsonl"), "utf8"), focusText(3));
  assert.equal(readDataFiles(source)["focus.jsonl"], focusText(3));
});

// ─── The tray's words and the 오늘 창's card ─────────────────────────────────────

test("focus in the tray's words and the timer card", () => {
  const now = new Date(2026, 9, 8, 14, 50);
  const focusing: GlanceTimer = { remainingMs: 12 * 60_000 + 30_000, paused: false, caption: "집중", countdown: true, focus: "보고서 마무리" };
  assert.equal(glanceText([], [], focusing, now, "ko"), "● 13분 남음");
  assert.equal(glanceText([], [], { ...focusing, focus: undefined }, now, "ko"), "13분 남음");
  assert.equal(glanceText([], [], { ...focusing, paused: true }, now, "ko"), undefined);
  const card = (timer: GlanceTimer, lang: Lang) => glanceCards([], timer, [], new Set(), now, lang)[1];
  assert.equal(card(focusing, "ko").small, "보고서 마무리");
  assert.equal(card(focusing, "ko").big, "13분");
  assert.equal(card({ ...focusing, paused: true }, "ko").small, "멈춤 · 보고서 마무리");
  assert.equal(card({ ...focusing, paused: true }, "en").small, "Paused · 보고서 마무리");
  assert.equal(card({ ...focusing, paused: true }, "nl").small, "Gepauzeerd · 보고서 마무리");
});

test("the focus card's next line: how long first, the clock time last (#46)", () => {
  assert.deepEqual((["ko", "en", "nl"] as const).map((lang, index) => focusNextLine(["치과", "Dentist", "Tandarts"][index], ["15:30", "3:30 PM", "15:30"][index], 40, lang)),
    ["40분 뒤 치과 · 15:30", "Dentist in 40 min · 3:30 PM", "Tandarts over 40 min · 15:30"]);
  assert.deepEqual((["ko", "en", "nl"] as const).map((lang) => focusNextLine("x", "16:10", 80, lang)),
    ["1시간 20분 뒤 x · 16:10", "x in 1 h 20 min · 16:10", "x over 1 u 20 min · 16:10"]);
});
