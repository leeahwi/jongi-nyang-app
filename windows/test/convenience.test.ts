import assert from "node:assert/strict";
import { test } from "node:test";
import { carriedDays, carriedText, moveChoices, shiftedDue, todaySinceUpdates, tomorrowKey } from "../src/core/carry";
import { eveningDue, morningItems, sweepItems, sweepTimes } from "../src/core/sweep";
import { eventSnoozeAt, snoozeChoices } from "../src/core/snooze";
import { matchText, search } from "../src/core/search";
import { parseQuick } from "../src/core/quickParse";
import { UndoableNotebook, parseNotebook, serializeNotebook, type TodoItem } from "../src/core/notebook";
import type { Lang } from "../src/core/lang";

/**
 * 편의 기능 (1.23): the shared cases of convenience-cases.md (written by Windows; the Mac
 * passes the same rows) — todaySince and its tag, date moves and shifts, snooze choices, the evening
 * sweep, search with 초성, Korean relative times.
 */

// Thursday 8 October 2026, 14:50.
const now = new Date(2026, 9, 8, 14, 50);
const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute);
const pad = (value: number) => String(value).padStart(2, "0");
const stamp = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
const task = (extra: Partial<TodoItem> = {}): TodoItem => ({ id: extra.id ?? "T", title: "t", isCompleted: false, createdAt: "2026-10-01T00:00:00Z", ...extra });

// ─── §1 todaySince ────────────────────────────────────────────────────────────

test("carry §1: todaySince is set, kept, removed, and its tag in three languages", () => {
  const rows: [string, Date, Partial<TodoItem>, string | undefined, string | undefined, [string, string, string] | undefined][] = [
    ["C1", now, {}, undefined, "2026-10-08", undefined],
    ["C2", now, {}, "2026-10-07", "2026-10-07", ["어제부터", "since yesterday", "sinds gisteren"]],
    ["C3", now, {}, "2026-10-06", "2026-10-06", ["3일째", "3 days", "3 dagen"]],
    ["C4", now, {}, "2026-10-01", "2026-10-01", ["8일째", "8 days", "8 dagen"]],
    ["C5", now, { isCompleted: true }, "2026-10-06", undefined, undefined],
    ["C6", now, { dueDate: "2026-10-08" }, "2026-10-07", undefined, undefined],
    ["C7", now, { shelf: "later" }, "2026-10-07", undefined, undefined],
    ["C8", now, { seriesID: "S" }, undefined, undefined, undefined],
    ["C9", now, {}, "2026-10-09", "2026-10-08", undefined],
    ["C10", at(9, 2), {}, "2026-10-08", "2026-10-08", undefined],
    ["C11", at(9, 4, 30), {}, "2026-10-08", "2026-10-08", ["어제부터", "since yesterday", "sinds gisteren"]],
    ["C12", now, {}, "yesterday", "2026-10-08", undefined],
    ["C13", now, { shelf: "today" }, undefined, "2026-10-08", undefined],
    ["C14", now, { dueDate: "2026-10-12" }, undefined, undefined, undefined],
  ];
  for (const [name, when, extra, before, after, labels] of rows) {
    const item = task({ ...extra, ...(before !== undefined ? { todaySince: before } : {}) });
    const change = todaySinceUpdates([item], when)[0];
    const updated: TodoItem = change ? { ...item, todaySince: change.todaySince } : item;
    if (change && change.todaySince === undefined) delete updated.todaySince;
    assert.equal(updated.todaySince, after, `${name} todaySince`);
    (["ko", "en", "nl"] as Lang[]).forEach((lang, index) => assert.equal(carriedText(carriedDays(updated, when), lang), labels?.[index], `${name} ${lang}`));
  }
});

test("carry §1: todaySince is read and written in todos.json (sorted keys), and kept through undo", () => {
  const json = serializeNotebook({ items: [task({ id: "A", todaySince: "2026-10-07" })] });
  assert.match(json, /"title": "t",\n {6}"todaySince": "2026-10-07"/);
  assert.equal(parseNotebook(json).items[0].todaySince, "2026-10-07");
  const notebook = new UndoableNotebook(parseNotebook(serializeNotebook({ items: [task({ id: "A" })] })));
  notebook.trackToday(todaySinceUpdates(notebook.items, now));
  assert.equal(notebook.canUndo, false, "bookkeeping is no undo step");
  notebook.edit("A", "renamed");
  notebook.undo();
  assert.equal(notebook.items[0].todaySince, "2026-10-08", "undo keeps the day");
});

// ─── §2 moves ─────────────────────────────────────────────────────────────────

test("carry §2: the date choices", () => {
  const rows: [string, Date, string][] = [
    ["M1", now, "tomorrow 2026-10-09 · friday 2026-10-09 · nextMonday 2026-10-12 · someday · pick"],
    ["M2", at(9, 10), "tomorrow 2026-10-10 · nextMonday 2026-10-12 · someday · pick"],
    ["M3", at(11, 10), "tomorrow 2026-10-12 · someday · pick"],
    ["M4", at(12, 10), "tomorrow 2026-10-13 · friday 2026-10-16 · nextMonday 2026-10-19 · someday · pick"],
    ["M5", at(9, 1, 30), "tomorrow 2026-10-09 · friday 2026-10-09 · nextMonday 2026-10-12 · someday · pick"],
    ["M6", at(10, 10), "tomorrow 2026-10-11 · nextMonday 2026-10-12 · someday · pick"],
  ];
  for (const [name, when, expected] of rows) assert.equal(moveChoices(when).map((choice) => (choice.day ? `${choice.kind} ${choice.day}` : choice.kind)).join(" · "), expected, name);
  assert.deepEqual(moveChoices(now, "en").map((choice) => choice.title), ["Tomorrow", "This Friday", "Next Monday", "Someday", "Pick a date…"]);
  assert.deepEqual(moveChoices(now, "nl").map((choice) => choice.title), ["Morgen", "Deze vrijdag", "Volgende maandag", "Ooit", "Datum kiezen…"]);
  assert.deepEqual(moveChoices(now, "ko").map((choice) => choice.title), ["내일", "이번 주 금요일", "다음 주 월요일", "언젠가", "날짜 고르기…"]);
  assert.equal(tomorrowKey(at(9, 2)), "2026-10-09");
});

test("carry §2: a day later and earlier", () => {
  const rows: [string, Partial<TodoItem>, string | undefined, string | undefined][] = [
    ["S1", {}, "2026-10-09", undefined],
    ["S2", { dueDate: "2026-10-12" }, "2026-10-13", "2026-10-11"],
    ["S3", { dueDate: "2026-10-09" }, "2026-10-10", "2026-10-08"],
    ["S4", { dueDate: "2026-10-08" }, "2026-10-09", undefined],
    ["S5", { dueDate: "2026-10-05" }, "2026-10-09", undefined],
    ["S6", { shelf: "later" }, "2026-10-09", undefined],
    ["S7", { dueDate: "2026-10-08", shelf: "today" }, "2026-10-09", undefined],
  ];
  for (const [name, extra, later, earlier] of rows) {
    assert.equal(shiftedDue(task(extra), 1, now), later, `${name} +1`);
    assert.equal(shiftedDue(task(extra), -1, now), earlier, `${name} −1`);
  }
  // Applying a day takes the task off any shelf, as one undo step.
  const notebook = new UndoableNotebook({ items: [task({ id: "A", shelf: "today", dueDate: "2026-10-08" }), task({ id: "B", shelf: "later" })] });
  notebook.moveAll(["A", "B"], { kind: "day", day: "2026-10-09" });
  assert.deepEqual(notebook.items.map((item) => [item.dueDate, item.shelf]), [["2026-10-09", undefined], ["2026-10-09", undefined]]);
  notebook.undo();
  assert.deepEqual(notebook.items.map((item) => [item.dueDate, item.shelf]), [["2026-10-08", "today"], [undefined, "later"]]);
});

// ─── §3 snooze ────────────────────────────────────────────────────────────────

test("snooze §3: the choices and their times", () => {
  const show = (choices: ReturnType<typeof snoozeChoices>) => choices.map((choice) => `${choice.id}${choice.at ? ` ${stamp(choice.at)}` : ""}`).join(" · ");
  assert.equal(show(snoozeChoices(new Date(2026, 9, 8, 14, 50, 40), "task")), "5 2026-10-08 14:55 · 10 2026-10-08 15:00 · 30 2026-10-08 15:20 · 60 2026-10-08 15:50 · evening 2026-10-08 19:00 · morning 2026-10-09 09:00 · tomorrow");
  assert.equal(show(snoozeChoices(at(8, 17, 59), "periodic")), "5 2026-10-08 18:04 · 10 2026-10-08 18:09 · 30 2026-10-08 18:29 · 60 2026-10-08 18:59 · evening 2026-10-08 19:00 · morning 2026-10-09 09:00");
  assert.equal(show(snoozeChoices(at(8, 18), "task")), "5 2026-10-08 18:05 · 10 2026-10-08 18:10 · 30 2026-10-08 18:30 · 60 2026-10-08 19:00 · morning 2026-10-09 09:00 · tomorrow");
  assert.equal(show(snoozeChoices(at(9, 1), "task")), "5 2026-10-09 01:05 · 10 2026-10-09 01:10 · 30 2026-10-09 01:30 · 60 2026-10-09 02:00 · morning 2026-10-09 09:00 · tomorrow");
  assert.deepEqual(snoozeChoices(now, "task", "ko").map((choice) => choice.title), ["5분 뒤", "10분 뒤", "30분 뒤", "1시간 뒤", "오늘 저녁 7시", "내일 아침 9시", "내일로 미루기"]);
  assert.deepEqual(snoozeChoices(now, "task", "en").map((choice) => choice.title), ["In 5 min", "In 10 min", "In 30 min", "In 1 hour", "Tonight at 7 PM", "Tomorrow at 9 AM", "Move to tomorrow"]);
  assert.deepEqual(snoozeChoices(now, "task", "nl").map((choice) => choice.title), ["Over 5 min", "Over 10 min", "Over 30 min", "Over 1 uur", "Vanavond om 19:00", "Morgen om 09:00", "Naar morgen"]);
  assert.equal(stamp(eventSnoozeAt(at(8, 15, 10), now)!), "2026-10-08 15:05");
  assert.equal(eventSnoozeAt(at(8, 14, 54), now), undefined);
});

// ─── §4 evening sweep ─────────────────────────────────────────────────────────

test("sweep §4: which tasks, and when", () => {
  const evening = at(8, 20);
  const items = [
    task({ id: "A", todaySince: "2026-10-08" }),
    task({ id: "B", reminderAt: at(8, 21).toISOString() }),
    task({ id: "C", reminderAt: at(8, 9).toISOString() }),
    task({ id: "D", isCompleted: true }),
    task({ id: "E", seriesID: "S" }),
    task({ id: "F", dueDate: "2026-10-08" }),
    task({ id: "G", dueDate: "2026-10-12" }),
    task({ id: "H", shelf: "later" }),
  ];
  assert.deepEqual(sweepItems(items, evening).map((item) => item.id), ["A", "C", "F"]);
  const settings = { enabled: true, time: "20:00", shown: "" };
  assert.equal(eveningDue(items, at(8, 19, 59), settings), false);
  assert.equal(eveningDue(items, evening, settings), true);
  assert.equal(eveningDue(items, evening, { ...settings, shown: "2026-10-08" }), false);
  assert.equal(eveningDue(items, at(9, 2), settings), true);
  // At 02:00 B's 21:00 reminder is past too (Mac 17:55).
  assert.deepEqual(sweepItems(items, at(9, 2)).map((item) => item.id), ["A", "B", "C", "F"]);
  assert.equal(eveningDue([items[3]], evening, settings), false);
  assert.equal(eveningDue(items, evening, { ...settings, enabled: false }), false);
  // The morning version: tasks carried from yesterday, when yesterday's evening never came.
  const morning = at(9, 9);
  const carried = [task({ id: "A", todaySince: "2026-10-08" }), task({ id: "N", todaySince: "2026-10-09" })];
  assert.deepEqual(morningItems(carried, morning, { ...settings, shown: "2026-10-07" }).map((item) => item.id), ["A"]);
  assert.deepEqual(morningItems(carried, morning, { ...settings, shown: "" }).map((item) => item.id), ["A"]);
  assert.deepEqual(morningItems(carried, morning, { ...settings, shown: "2026-10-08" }), []);
  assert.deepEqual(sweepTimes, ["18:00", "18:30", "19:00", "19:30", "20:00", "20:30", "21:00", "21:30", "22:00"]);
});

// ─── §5 search ────────────────────────────────────────────────────────────────

test("search §5: syllables, first consonants, case and accents", () => {
  const rows: [string, string, string, string | undefined][] = [
    ["Q1", "분기 보고서 초안", "보고서", "보고서"],
    ["Q2", "분기 보고서 초안", "ㅂㄱㅅ", "보고서"],
    ["Q3", "분기 보고서 초안", "ㅂㄱ", "분기"],
    ["Q4", "분기 보고서 초안", "보고ㅅ", "보고서"],
    ["Q5", "Coffee with Anna", "COFFEE", "Coffee"],
    ["Q6", "Café Noir", "cafe", "Café"],
    ["Q7", "nieuwe ideeën", "ideeen", "ideeën"],
    ["Q8", "ideeen lijst", "ideeën", "ideeen"],
    ["Q9", "까치 보기", "ㄲ", "까"],
    ["Q10", "가치 보기", "ㄲ", undefined],
    ["Q11", "회의 준비", "ㅎ", "회"],
    ["Q12", "보고서", "ㅂ ㄱ", undefined],
    ["Q13", "anything", "   ", undefined],
    ["Q14", "주간 회의록", "회의록", "회의록"],
  ];
  for (const [name, text, query, match] of rows) assert.equal(matchText(text, query), match, name);
});

test("search §5: the groups and their order", () => {
  const items = [
    task({ id: "a", title: "분기 보고서 초안" }),
    task({ id: "b", title: "보고서 보내기", dueDate: "2026-10-12" }),
    task({ id: "c", title: "보고서 읽기", shelf: "later" }),
    task({ id: "d", title: "장보기" }),
  ];
  const memos = [{ id: "m", text: "회의 메모\n보고서 시안 2개", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-07T03:00:00Z" }];
  const archive = [
    { id: "x1", title: "보고서 초안", createdAt: "2026-09-01T00:00:00Z", completedAt: new Date(2026, 8, 3, 10).toISOString() },
    { id: "x2", title: "보고서 검토", createdAt: "2026-09-01T00:00:00Z", completedAt: new Date(2026, 9, 7, 10).toISOString() },
  ];
  const events = [{ id: "e", title: "보고서 회의", date: "2026-10-10", allDay: false, days: 1, start: 600, end: 660, repeat: "none" as const, skip: [], color: "blue" as const, createdAt: "", updatedAt: "" }];
  const groups = search({ items, memos, archive, events }, "ㅂㄱㅅ", now, "ko");
  assert.deepEqual(groups.map((group) => `${group.title} ${group.rows.map((row) => `${row.text}[${row.text.slice(...row.range)}]${row.meta ? ` ${row.meta}` : ""}`).join(", ")}`), [
    "오늘 분기 보고서 초안[보고서]",
    "앞으로 보고서 보내기[보고서] D-4, 보고서 읽기[보고서]",
    "메모 보고서 시안 2개[보고서] 10월 7일",
    "완료 기록 보고서 검토[보고서] 10월 7일, 보고서 초안[보고서] 9월 3일",
    "일정 보고서 회의[보고서] 10월 10일 10:00",
  ]);
  assert.equal(groups.find((group) => group.kind === "history")!.rows[0].day, "2026-10-07");
  assert.deepEqual(search({ items, memos, archive, events }, " ", now), []);
  assert.deepEqual(search({ items, memos, archive, events }, "cafe", now, "en").map((group) => group.title), []);
  assert.deepEqual(search({ items, memos, archive, events }, "보고서", now, "en").map((group) => group.title), ["Today", "Ahead", "Notes", "History", "Events"]);
  assert.deepEqual(search({ items, memos, archive, events }, "보고서", now, "nl").map((group) => group.title), ["Vandaag", "Vooruit", "Notities", "Geschiedenis", "Afspraken"]);
});

// ─── §6 relative times ────────────────────────────────────────────────────────

test("quick add §6: Korean relative times, and en / nl", () => {
  const rows: [string, Lang, string, string, string | undefined, Date?][] = [
    ["T1", "ko", "30분 뒤 빨래 꺼내기", "빨래 꺼내기", "2026-10-08 15:20"],
    ["T2", "ko", "2시간 뒤 회의 준비", "회의 준비", "2026-10-08 16:50"],
    ["T3", "ko", "1시간 30분 후 약 먹기", "약 먹기", "2026-10-08 16:20"],
    ["T4", "ko", "1시간 반 뒤 산책", "산책", "2026-10-08 16:20"],
    ["T5", "ko", "빨래 꺼내기 10분 후", "빨래 꺼내기", "2026-10-08 15:00"],
    ["T6", "ko", "30분뒤 물 마시기", "물 마시기", "2026-10-08 15:20"],
    ["T7", "en", "take out laundry in 2 hours", "take out laundry", "2026-10-08 16:50"],
    ["T8", "nl", "over een kwartier was ophalen", "was ophalen", "2026-10-08 15:05"],
    ["T9", "ko", "30분 뒤 불 끄기", "불 끄기", "2026-10-09 00:20", at(8, 23, 50)],
    ["T10", "ko", "3분기 보고서", "3분기 보고서", undefined],
    ["T11", "en", "30분 뒤 빨래", "빨래", "2026-10-08 15:20"],
  ];
  for (const [name, lang, text, title, reminder, when] of rows) {
    const parsed = parseQuick(text, when ?? now, lang);
    assert.equal(parsed.title, title, `${name} title`);
    assert.equal(parsed.reminderAt ? stamp(parsed.reminderAt) : undefined, reminder, `${name} reminder`);
  }
});

// ─── Windows: the taskbar, the Jump List, notifications, docking (decision logic only) ───

import { badgeText, jumpTasks, launchCommand, shouldAskLogin, startedAtLogin, taskbarProgress, thumbButtons } from "../src/core/taskbar";
import { readNotifyLink, notifyLink, toastXml, wantsSystemNotice } from "../src/core/notify";
import { dockFrame, stillDocked } from "../src/core/dock";
import { clipboardPrefill } from "../src/core/memo";
import { ribbonMoment, todayGroups as splitToday } from "../src/core/ribbon";

test("taskbar: progress, the thumbnail buttons and the badge", () => {
  assert.deepEqual(taskbarProgress(undefined), { value: -1, mode: "none" });
  assert.deepEqual(taskbarProgress({ remainingMs: 15 * 60_000, durationMs: 25 * 60_000, paused: false }), { value: 0.4, mode: "normal" });
  assert.deepEqual(taskbarProgress({ remainingMs: 25 * 60_000, durationMs: 25 * 60_000, paused: false }), { value: 0.01, mode: "normal" });
  assert.deepEqual(taskbarProgress({ remainingMs: 5 * 60_000, durationMs: 25 * 60_000, paused: true }), { value: 0.8, mode: "paused" });
  assert.deepEqual(thumbButtons(undefined), []);
  assert.deepEqual(thumbButtons({ remainingMs: 1, durationMs: 2, paused: false }, "ko").map((button) => `${button.id} ${button.tooltip}`), ["pause 일시정지", "stop 그만", "more 5분 더"]);
  assert.deepEqual(thumbButtons({ remainingMs: 1, durationMs: 2, paused: true }, "en").map((button) => `${button.id} ${button.tooltip}`), ["resume Resume", "stop Stop", "more 5 more min"]);
  assert.deepEqual([0, 1, 9, 10, 42, -3].map(badgeText), [undefined, "1", "9", "9+", "9+", undefined]);
});

test("taskbar: the Jump List's tasks and how a launch is read", () => {
  assert.deepEqual(jumpTasks("ko").map((task) => `${task.args} ${task.title}`), ["--quick-entry 빠른 입력", "--quick-memo 빠른 메모", "--desk 책상", "--focus-25 25분 집중", "--timer-5 5분 타이머"]);
  assert.deepEqual(jumpTasks("en").map((task) => task.title), ["Quick add", "Quick note", "Desk", "Focus 25 min", "5 min timer"]);
  assert.deepEqual(jumpTasks("nl").map((task) => task.title), ["Snel toevoegen", "Snelle notitie", "Bureau", "25 min focussen", "Timer van 5 min"]);
  assert.equal(launchCommand(["C:\\종이냥.exe", "--quick-memo"]), "quick-memo");
  assert.equal(launchCommand(["electron.exe", "C:\\app", "--desk", "--timer-5"]), "timer-5");
  assert.equal(launchCommand(["C:\\종이냥.exe"]), undefined);
  assert.equal(startedAtLogin(["x.exe", "--at-login"]), true);
  assert.equal(startedAtLogin(["x.exe"]), false);
  assert.equal(shouldAskLogin({ openAtLogin: false, asked: false, manualLaunches: 3 }), true);
  assert.equal(shouldAskLogin({ openAtLogin: false, asked: false, manualLaunches: 2 }), false);
  assert.equal(shouldAskLogin({ openAtLogin: true, asked: false, manualLaunches: 9 }), false);
  assert.equal(shouldAskLogin({ openAtLogin: false, asked: true, manualLaunches: 9 }), false);
});

test("system notices: when they go, the toast and its links", () => {
  const seen = { petShown: true, noteShown: false, locked: false };
  assert.equal(wantsSystemNotice("missed", seen), false);
  assert.equal(wantsSystemNotice("missed", { petShown: false, noteShown: false, locked: false }), true);
  assert.equal(wantsSystemNotice("missed", { ...seen, locked: true }), true);
  assert.equal(wantsSystemNotice("always", seen), true);
  assert.equal(wantsSystemNotice("off", { petShown: false, noteShown: false, locked: true }), false);
  const ids = ["6F1C2A1B-0000-4000-8000-000000000001", "6F1C2A1B-0000-4000-8000-000000000002"];
  assert.deepEqual(readNotifyLink(["x.exe", notifyLink({ kind: "done", ids })]), { kind: "done", ids });
  assert.deepEqual(readNotifyLink(["x.exe", "--flag", notifyLink({ kind: "snooze", ids, minutes: 10 })]), { kind: "snooze", ids, minutes: 10 });
  assert.deepEqual(readNotifyLink(["jongi-nyang:open/"]), { kind: "open" });
  assert.deepEqual(readNotifyLink(["jongi-nyang://alarm-stop"]), { kind: "alarmStop" });
  assert.equal(readNotifyLink(["jongi-nyang:snooze?ids=A&minutes=9999"]), undefined);
  assert.equal(readNotifyLink(["jongi-nyang:done?ids=<script>"]), undefined);
  assert.equal(readNotifyLink(["https://example.com"]), undefined);
  const xml = toastXml({ kind: "tasks", ids: ["A"], title: "할 일 알림", lines: ["우유 & 빵 <사기>"] }, "ko");
  assert.match(xml, /<text>우유 &amp; 빵 &lt;사기&gt;<\/text>/);
  assert.match(xml, /<action content="끝냄" activationType="protocol" arguments="jongi-nyang:done\?ids=A"\/>/);
  assert.match(xml, /<action content="10분 뒤" activationType="protocol" arguments="jongi-nyang:snooze\?ids=A&amp;minutes=10"\/>/);
  assert.match(toastXml({ kind: "alarm", title: "Alarm · 7:00 AM", lines: [] }, "en"), /scenario="alarm".*content="Stop".*content="Snooze"/);
});

test("dock to the edge, clipboard to the quick note, a click on the ribbon", () => {
  const area = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(dockFrame(area, { x: 300, y: 200, width: 420, height: 560 }, "right"), { x: 1500, y: 0, width: 420, height: 1040 });
  assert.deepEqual(dockFrame(area, { x: 300, y: 200, width: 900, height: 560 }, "left"), { x: 0, y: 0, width: 720, height: 1040 });
  assert.deepEqual(dockFrame({ x: 1920, y: 0, width: 2560, height: 1400 }, { x: 2000, y: 100, width: 300, height: 400 }, "right"), { x: 4130, y: 0, width: 350, height: 1200 });
  assert.equal(stillDocked({ x: 1501, y: 0, width: 420, height: 1040 }, { x: 1500, y: 0, width: 420, height: 1040 }), true);
  assert.equal(stillDocked({ x: 1400, y: 0, width: 420, height: 1040 }, { x: 1500, y: 0, width: 420, height: 1040 }), false);
  assert.equal(clipboardPrefill("", "copied text", "before"), "copied text");
  assert.equal(clipboardPrefill("", "same", "same"), undefined);
  assert.equal(clipboardPrefill("draft", "copied", "before"), undefined);
  assert.equal(clipboardPrefill("", "   ", "before"), undefined);
  assert.equal(clipboardPrefill("", "line\r\nline", undefined), undefined);
  assert.equal(clipboardPrefill("", "a\r\nb", ""), "a\nb");
  // Shared cases R1–R5 (Mac 17:55).
  assert.deepEqual(ribbonMoment(0.5, 8, 24, now), { day: "2026-10-08", minutes: 16 * 60 });
  assert.deepEqual(ribbonMoment(0.51, 8, 24, now), { day: "2026-10-08", minutes: 16 * 60 + 15 });
  assert.deepEqual(ribbonMoment(0, 8, 24, now), { day: "2026-10-08", minutes: 8 * 60 });
  assert.deepEqual(ribbonMoment(1, 8, 24, now), { day: "2026-10-08", minutes: 23 * 60 });
  assert.deepEqual(ribbonMoment(0.95, 8, 28, now), { day: "2026-10-09", minutes: 3 * 60 });
  assert.deepEqual(ribbonMoment(0.5, 8, 24, at(9, 1)), { day: "2026-10-08", minutes: 16 * 60 });
});

test("오늘 꼭 하나 §9: the pick heads 다음 (P1–P4)", () => {
  const A = task({ id: "A" }), B = task({ id: "B", reminderAt: at(8, 16).toISOString() }), C = task({ id: "C" }), D = task({ id: "D", isCompleted: true });
  const show = (result: { next: TodoItem[]; rest: TodoItem[] }) => `${result.next.map((item) => item.id).join(",")} | ${result.rest.map((item) => item.id).join(",")}`;
  assert.equal(show(splitToday([A, B, C, D], now)), "B | A,C,D");
  assert.equal(show(splitToday([A, B, C, D], now, "C")), "C,B | A,D");
  assert.equal(show(splitToday([A, B, C], now, "B")), "B | A,C");
  assert.equal(show(splitToday([A, B, D], now, "D")), "B | A,D");
});
