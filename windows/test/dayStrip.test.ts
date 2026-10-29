import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEvent } from "../src/core/calendar";
import type { Candidate } from "../src/core/intent";
import { langs } from "../src/core/lang";
import type { TodoItem } from "../src/core/notebook";
import {
  awayText, columns, dragBounds, draggedSpan, edgeBand, followedSpan, isSoon, kicker, leftText, markWord, minutesUntil, newCandidates, nudged, ringText, rowLimit, scrollTop, slot, stripMarks,
  stretched, stripItems, stripSentence, stripSpans, stripState, wholeDayLink, type DragEdge, type Span, type StripItem, type StripKind,
} from "../src/core/dayStrip";
import { clockKey } from "../src/core/timeRange";

// 하루 띠 · 하루 일정표 (1.25): the shared cases with the macOS app (DayStripTests.swift), listed in ribbon-cases.md.
// The day of the mock: Thursday 2026-10-08.
const at = (hour: number, minute = 0, second = 0, day = 8) => new Date(2026, 9, day, hour, minute, second);
const event = (title: string, from: [number, number], to: [number, number], extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  key: `local/${title}@2026-10-08`, calendarId: "local", title, allDay: false, start: at(from[0], from[1]), end: at(to[0], to[1]), color: "#5b8bd0",
  eventId: title, canEdit: true, recurring: false, ...extra,
});
let made = 0;
const task = (title: string, start?: string, end?: string, extra: Partial<TodoItem> = {}): TodoItem => ({
  id: `t${++made}-${title}`, title, isCompleted: false, createdAt: "2026-10-08T00:00:00Z",
  ...(start ? { timeStart: start } : {}), ...(end ? { timeEnd: end } : {}), ...extra,
});
const reminder = (date: Date) => ({ reminderAt: date.toISOString() });
const day = [event("아침 스터디", [9, 0], [10, 0]), event("팀 회의", [13, 0], [14, 0], { location: "3층 회의실" }), event("치과", [15, 30], [16, 30]), event("요가", [19, 0], [20, 0])];
const tasks = [task("보고서 마무리", "14:00", "15:30"), task("물 마시기", undefined, undefined, reminder(at(16))), task("장보기", "17:00")];
const state = (now: Date, rows = 2, events = day, todo = tasks) => stripState(stripItems(events, todo, now), now, rows);
const titles = (items: StripItem[]) => items.map((item) => item.title);

// ─── Now and next ────────────────────────────────────────────────────────────

test("R1 something on now", () => {
  const s = state(at(13, 20));
  assert.equal(s.mode, "now");
  assert.equal(s.lead?.title, "팀 회의");
  assert.equal(s.minutes, 40);
  assert.ok(Math.abs(s.progress - 1 / 3) < 1e-4);
  assert.deepEqual(titles(s.rows), ["보고서 마무리", "치과"]);
  assert.deepEqual(langs.map((lang) => ringText(s.minutes, s.mode, lang).value), ["40", "40", "40"]);
  assert.deepEqual(langs.map((lang) => ringText(s.minutes, s.mode, lang).caption), ["분 남음", "min left", "min te gaan"]);
  assert.deepEqual(langs.map((lang) => kicker(s.mode, s.lead!, lang)), ["지금 · 13:00–14:00", "Now · 1:00–2:00 PM", "Nu · 13:00–14:00"]);
  assert.deepEqual(langs.map((lang) => kicker(s.mode, s.lead!, lang, true)), ["지금 · ~14:00", "Now · until 2:00 PM", "Nu · tot 14:00"]);
  assert.deepEqual(s.rows.map((row) => awayText(minutesUntil(at(13, 20), row.start))), ["40분 뒤", "2시간 뒤"]);
  assert.deepEqual(s.rows.map((row) => isSoon(minutesUntil(at(13, 20), row.start))), [true, false]);
  assert.deepEqual(langs.map((lang) => stripSentence(s, lang)), [
    "지금 팀 회의, 40분 남음. 다음 14:00 보고서 마무리, 15:30 치과",
    "Now 팀 회의, 40 min left. Next 2:00 PM 보고서 마무리, 3:30 PM 치과",
    "Nu 팀 회의, nog 40 min. Volgende 14:00 보고서 마무리, 15:30 치과",
  ]);
});

test("R8 the list's marks (#31): the to-dos the strip shows", () => {
  const marked = (now: Date, list = tasks) => {
    const marks = stripMarks(state(now, 2, day, list));
    return Object.fromEntries(list.filter((item) => marks.has(item.id)).map((item) => [item.title, marks.get(item.id)]));
  };
  // #47: only 지금 — the to-dos up next sit under the list's own 다음 heading.
  assert.deepEqual(marked(at(14, 20)), { "보고서 마무리": "now" });
  assert.deepEqual(marked(at(13, 20)), {});
  assert.deepEqual(marked(at(12, 40)), {}, "nothing on: the lead up next gets none");
  const done = tasks.map((item, index) => (index === 0 ? { ...item, isCompleted: true } : item));
  assert.deepEqual(marked(at(14, 20), done), {});
  assert.deepEqual(langs.map((lang) => markWord("now", lang)), ["지금", "Now", "Nu"]);
  assert.deepEqual(langs.map((lang) => markWord("next", lang)), ["다음", "Next", "Volgende"]);
});

test("R2 three rows: a reminder counts as an item", () => {
  const s = state(at(13, 20), 3);
  assert.deepEqual(titles(s.rows), ["보고서 마무리", "치과", "물 마시기"]);
  assert.deepEqual(s.rows.map((row) => row.kind), ["task", "event", "reminder"]);
  assert.deepEqual(titles(state(at(13, 20), 1).rows), ["보고서 마무리"]);
});

test("R3 nothing on, the next soon", () => {
  const s = state(at(12, 40));
  assert.equal(s.mode, "next");
  assert.equal(s.lead?.title, "팀 회의");
  assert.equal(s.minutes, 20);
  assert.ok(Math.abs(s.progress - 40 / 60) < 1e-4);
  assert.deepEqual(titles(s.rows), ["보고서 마무리", "치과"], "rows start after the lead");
  assert.deepEqual(langs.map((lang) => ringText(20, "next", lang).caption), ["분 뒤", "min away", "min te gaan"]);
  assert.equal(isSoon(s.minutes), true);
  assert.deepEqual(langs.map((lang) => kicker(s.mode, s.lead!, lang)), ["다음 · 13:00–14:00", "Next · 1:00–2:00 PM", "Volgende · 13:00–14:00"]);
  assert.deepEqual(langs.map((lang) => stripSentence(s, lang)), [
    "다음 13:00 팀 회의, 20분 뒤. 그다음 14:00 보고서 마무리, 15:30 치과",
    "Next 1:00 PM 팀 회의, in 20 min. Then 2:00 PM 보고서 마무리, 3:30 PM 치과",
    "Volgende 13:00 팀 회의, over 20 min. Daarna 14:00 보고서 마무리, 15:30 치과",
  ]);
});

test("R4 nothing on, the next far; nothing left", () => {
  let s = state(at(10, 30));
  assert.equal(s.mode, "next");
  assert.equal(s.minutes, 150);
  assert.equal(s.progress, 0, "no arc over an hour away");
  assert.equal(isSoon(s.minutes), false);
  // 1.30: never a clock-like "2:30" — the rows' rule, the nearest whole hour from two hours away ("3시간 뒤").
  assert.deepEqual(langs.map((lang) => ringText(150, "next", lang).value), ["3시간", "3 h", "3 u"]);
  assert.deepEqual(langs.map((lang) => ringText(150, "next", lang).caption), ["뒤", "away", "te gaan"]);
  assert.equal(awayText(150, "ko"), "3시간 뒤", "the same as a row's when");
  assert.deepEqual(langs.map((lang) => ringText(61, "next", lang).value), ["1시간", "1 h", "1 u"]);
  assert.deepEqual(langs.map((lang) => ringText(61, "next", lang).caption), ["1분 뒤", "1 min away", "en 1 min"]);
  assert.equal(awayText(61, "ko"), "1시간 1분 뒤", "61 as a row");
  assert.deepEqual(langs.map((lang) => ringText(120, "next", lang).caption), ["뒤", "away", "te gaan"]);
  for (const minutes of [60, 61, 99, 150, 600, 1439]) for (const lang of langs) {
    const text = ringText(minutes, "next", lang);
    assert.ok(!text.value.includes(":") && !text.caption.includes(":"), `no h:mm at ${minutes} (${lang})`);
  }
  s = state(at(20, 30));
  assert.equal(s.mode, "nothing");
  assert.equal(s.lead, undefined);
  assert.deepEqual(s.rows, []);
  assert.deepEqual(langs.map((lang) => stripSentence(s, lang)), ["오늘 남은 일정이 없어요", "Nothing else today", "Verder niets vandaag"]);
});

test("R5 the latest start is current; an event first at the same start", () => {
  let s = state(at(13, 40), 2, [event("A", [13, 0], [15, 0])], [task("B", "13:30", "14:00")]);
  assert.equal(s.lead?.title, "B");
  assert.equal(s.minutes, 20);
  assert.deepEqual(s.rows, [], "A has started: not a row");
  s = state(at(13, 10), 2, [event("E", [13, 0], [14, 0])], [task("T", "13:00", "13:30")]);
  assert.equal(s.lead?.title, "E");
  s = state(at(13, 10), 2, [event("long", [13, 0], [15, 0]), event("short", [13, 0], [13, 30])], []);
  assert.equal(s.lead?.title, "short", "then the one ending first");
});

test("R6 done to-dos are never current or next", () => {
  const s = state(at(14, 10), 2, [event("치과", [15, 30], [16, 30])], [task("보고서", "14:00", "15:30", { isCompleted: true })]);
  assert.equal(s.mode, "next");
  assert.equal(s.lead?.title, "치과");
  const items = stripItems([], [task("보고서", "14:00", "15:30", { isCompleted: true }), task("끝난 알림", undefined, undefined, { isCompleted: true, ...reminder(at(16)) })], at(9));
  assert.deepEqual(items.map((item) => item.kind), ["task"], "a done to-do's time stays (drawn faded); its reminder doesn't");
});

test("R7 same minute: event, to-do, reminder", () => {
  const s = state(at(13), 3, [event("E", [14, 0], [15, 0])], [task("R", undefined, undefined, reminder(at(14))), task("T", "14:00", "14:30")]);
  assert.equal(s.mode, "next");
  assert.equal(s.lead?.title, "E");
  assert.deepEqual(titles(s.rows), ["T", "R"]);
});

test("R8 a start alone lasts 30 minutes; a to-do with a time is one item", () => {
  let s = state(at(17, 10), 2, [], [task("장보기", "17:00")]);
  assert.equal(s.mode, "now");
  assert.equal(s.minutes, 20, "until 17:30");
  assert.equal(kicker("now", s.lead!, "ko"), "지금 · 17:00–17:30");
  const both = task("보고서", "14:00", "15:30", reminder(at(13)));
  const items = stripItems([], [both], at(9));
  assert.deepEqual(items.map((item) => item.kind), ["task"], "no second item for its reminder");
  assert.equal(items[0].hasReminder, true);
  s = state(at(9), 2, [], [both]);
  assert.equal(s.lead?.title, "보고서");
  assert.equal(s.minutes, 300);
});

test("R9 what isn't today", () => {
  const items = stripItems(
    [{ key: "b", calendarId: "local", title: "생일", allDay: true, start: at(0), end: at(0, 0, 0, 9), color: "#d4a72c", eventId: "b", canEdit: true, recurring: false }],
    [task("내일", "10:00", "11:00", { dueDate: "2026-10-09" }), task("어제 알림", undefined, undefined, reminder(at(10, 0, 0, 7))), task("언젠가", "10:00", "11:00", { shelf: "later" })],
    at(9));
  assert.deepEqual(items, [], "all-day, another day's time, yesterday's reminder, an undated 언젠가 range: none");
});

test("R10 an hour or more", () => {
  const s = state(at(12, 40), 2, [event("긴 회의", [12, 0], [14, 0])], []);
  assert.equal(s.minutes, 80);
  assert.deepEqual(langs.map((lang) => ringText(80, "now", lang).value), ["1시간", "1 h", "1 u"]);
  assert.deepEqual(langs.map((lang) => ringText(80, "now", lang).caption), ["20분 남음", "20 min left", "en 20 min"]);
  assert.deepEqual(langs.map((lang) => ringText(60, "now", lang).value), ["1시간", "1 h", "1 u"]);
  assert.deepEqual(langs.map((lang) => ringText(60, "now", lang).caption), ["남음", "left", "te gaan"]);
  assert.equal(ringText(150, "now", "ko").caption, "30분 남음", "time left stays exact");
  assert.deepEqual(langs.map((lang) => ringText(59, "now", lang).value), ["59", "59", "59"]);
  assert.deepEqual(langs.map((lang) => leftText(80, lang)), ["1시간 20분 남음", "1 h 20 min left", "nog 1 u 20 min"]);
  assert.deepEqual(langs.map((lang) => leftText(60, lang)), ["1시간 남음", "1 h left", "nog 1 u"]);
  assert.deepEqual(langs.map((lang) => leftText(5, lang)), ["5분 남음", "5 min left", "nog 5 min"]);
});

test("R11 a row's when", () => {
  const cases: [number, string[]][] = [
    [1, ["1분 뒤", "in 1 min", "over 1 min"]], [40, ["40분 뒤", "in 40 min", "over 40 min"]],
    [60, ["1시간 뒤", "in 1 h", "over 1 u"]], [65, ["1시간 5분 뒤", "in 1 h 5 min", "over 1 u 5 min"]],
    [119, ["1시간 59분 뒤", "in 1 h 59 min", "over 1 u 59 min"]], [120, ["2시간 뒤", "in 2 h", "over 2 u"]],
    [130, ["2시간 뒤", "in 2 h", "over 2 u"]], [149, ["2시간 뒤", "in 2 h", "over 2 u"]], [150, ["3시간 뒤", "in 3 h", "over 3 u"]],
    [400, ["7시간 뒤", "in 7 h", "over 7 u"]],
  ];
  for (const [minutes, expected] of cases) assert.deepEqual(langs.map((lang) => awayText(minutes, lang)), expected, String(minutes));
  assert.deepEqual([1, 60, 61].map(isSoon), [true, true, false]);
});

test("R12 rounding up, rows by size, the link", () => {
  assert.equal(minutesUntil(at(13, 20, 30), at(14)), 40);
  assert.equal(minutesUntil(at(13, 59, 1), at(14)), 1);
  assert.equal(minutesUntil(at(14), at(14)), 1, "at least 1");
  for (const [width, height, rows] of [[350, 560, 1], [400, 800, 1], [420, 560, 2], [420, 719, 2], [420, 720, 3], [720, 1200, 3]]) {
    assert.equal(rowLimit(width, height), rows, `${width}×${height}`);
  }
  assert.deepEqual(langs.map((lang) => wholeDayLink(false, lang)), ["하루 전체 ›", "Whole day ›", "Hele dag ›"]);
  assert.deepEqual(langs.map((lang) => wholeDayLink(true, lang)), ["전체 ›", "Day ›", "Dag ›"]);
});

test("R13 a reminder as the lead", () => {
  const s = state(at(15, 50), 2, [], [task("물 마시기", undefined, undefined, reminder(at(16)))]);
  assert.equal(s.mode, "next");
  assert.equal(s.minutes, 10);
  assert.deepEqual(langs.map((lang) => kicker(s.mode, s.lead!, lang)), ["다음 · 16:00", "Next · 4:00 PM", "Volgende · 16:00"]);
  assert.equal(kicker(s.mode, s.lead!, "ko", true), "다음 · 16:00");
});

test("R14 past midnight", () => {
  const late = { ...event("야간 상영", [23, 0], [23, 0]), end: at(1, 0, 0, 9) };
  const s = state(at(0, 30, 0, 9), 2, [late], [task("정리", "23:30", "01:30")]);
  assert.equal(s.mode, "now");
  assert.equal(s.lead?.title, "정리");
  assert.equal(s.minutes, 60);
});

// ─── The whole day ───────────────────────────────────────────────────────────

const minutesOf = (text: string) => { const [h, m] = text.split(":").map(Number); return h * 60 + m; };
const sp = (id: string, from: string, to: string, kind: StripKind = "event", order = 0): Span => ({ id, kind, start: minutesOf(from), end: minutesOf(to), order });
const placed = (spans: Span[]) => columns(spans).placed.sort((a, b) => (a.id < b.id ? -1 : 1)).map((entry) => `${entry.id}${entry.column}/${entry.columns}${entry.hidden ? "h" : ""}`);

test("K1–K7 columns", () => {
  assert.deepEqual(placed([sp("A", "13:00", "14:00"), sp("B", "14:00", "15:30")]), ["A0/1", "B0/1"], "K1 touching");
  assert.deepEqual(placed([sp("T", "14:00", "15:30", "task"), sp("R", "14:30", "15:00", "reminder")]), ["R1/2", "T0/2"], "K2 the mock");
  assert.deepEqual(placed([sp("A", "10:00", "12:00"), sp("B", "11:00", "13:00"), sp("C", "11:30", "12:30"), sp("D", "12:00", "12:30")]), ["A0/3", "B1/3", "C2/3", "D0/3"], "K3");
  const crowd = [sp("A", "09:00", "11:00"), sp("B", "09:30", "11:00"), sp("C", "10:00", "11:00"), sp("D", "10:15", "10:45"), sp("E", "10:30", "11:00")];
  assert.deepEqual(placed(crowd), ["A0/3", "B1/3", "C2/3", "D3/3h", "E4/3h"], "K4 four and more");
  assert.deepEqual(columns(crowd).more, [{ ids: ["D", "E"], start: 615, group: 0 }], "K4 +2 at 10:15");
  assert.deepEqual(placed([sp("A", "09:00", "10:00"), sp("B", "09:00", "11:00")]), ["A1/2", "B0/2"], "K5 the longer first");
  assert.deepEqual(placed([sp("A", "09:00", "10:00"), sp("B", "09:30", "10:30"), sp("C", "11:00", "12:00")]), ["A0/2", "B1/2", "C0/1"], "K6 groups");
  assert.deepEqual(columns([sp("A", "09:00", "10:00"), sp("B", "09:30", "10:30"), sp("C", "11:00", "12:00")]).placed.map((entry) => entry.group), [0, 0, 1], "K6 group numbers");
  assert.deepEqual(placed([sp("E", "14:00", "15:00"), sp("T", "14:00", "15:00", "task")]), ["E0/2", "T1/2"], "K7 same span: the event first");
});

test("K8 spans from items", () => {
  const items = stripItems([event("치과", [15, 30], [16, 30])], [task("물", undefined, undefined, reminder(at(14, 30))), task("장보기", "17:00")], at(9));
  assert.deepEqual(stripSpans(items, at(9)).map((entry) => `${entry.start}-${entry.end}`), ["930-990", "870-900", "1020-1050"]);
  const late = stripItems([], [task("정리", "23:30", "01:30")], at(9));
  assert.deepEqual(stripSpans(late, at(9)).map((entry) => `${entry.start}-${entry.end}`), ["1410-1530"], "logical minutes");
});

test("G1–G4 slot, scroll, drag, nudge", () => {
  for (const [y, minutes] of [[0, 480], [49, 525], [50, 540], [-10, 480], [312.5, 855], [800, 1380], [2000, 1380]]) assert.equal(slot(y, 8, 24), minutes, `slot ${y}`);
  // The whole hour at or before now − 1 h at the top.
  for (const [now, top] of [[at(13, 20), 200], [at(13, 0), 200], [at(12, 59), 150], [at(9, 10), 0], [at(0, 30, 0, 9), 750]] as const) assert.equal(scrollTop(now, 8), top, `scroll ${now.toTimeString().slice(0, 5)}`);
  const drags: ["end" | "whole", number, number, number][] = [["whole", 30, 870, 960], ["whole", 20, 870, 960], ["whole", 10, 855, 945], ["whole", 6, 840, 930],
    ["end", -50, 840, 870], ["end", -100, 840, 855], ["whole", -1000, 480, 570], ["whole", 1000, 1350, 1440]];
  for (const [edge, pixels, start, end] of drags) assert.deepEqual(draggedSpan(840, 930, edge, pixels, 8, 24), { start, end }, `drag ${edge} ${pixels}`);
  assert.deepEqual(nudged(840, 930, 1, 8, 24), { start: 855, end: 945 }, "Alt+↓");
  assert.deepEqual(nudged(840, 930, -1, 8, 24), { start: 825, end: 915 }, "Alt+↑");
  assert.deepEqual(nudged(480, 540, -1, 8, 24), { start: 480, end: 540 }, "not before the day");
  // [Win] a block ending at 04:00 keeps its end as 1680 (not 04:00 of the day's start).
  assert.deepEqual(draggedSpan(1620, 1680, "whole", -50, 8, 28), { start: 1560, end: 1620 }, "W1 the night's last hour");
});

// ─── 1.26: following the pointer, stretching from the edges (ribbon-cases "R — stretching", shared with the Mac) ──

const near = (actual: { start: number; end: number }, start: number, end: number, label: string) => {
  assert.ok(Math.abs(actual.start - start) < 1e-6 && Math.abs(actual.end - end) < 1e-6, `${label}: ${actual.start}–${actual.end}, wanted ${start}–${end}`);
};

test("1.26 R1 the edge bands", () => {
  for (const [height, band] of [[18, 0], [19.5, 0], [20, 5], [22, 6], [48, 6], [300, 6]]) assert.equal(edgeBand(height), band, `h ${height}`);
});

test("1.26 R2 following the pointer", () => {
  const cases: [DragEdge, number, number, number, number, number][] = [
    ["whole", 10, 840, 930, 852, 942], ["whole", 3.5, 840, 930, 844.2, 934.2], ["whole", -1000, 840, 930, 480, 570], ["whole", 1000, 840, 930, 1350, 1440],
    ["start", -20, 840, 930, 816, 930], ["start", 200, 840, 930, 915, 930], ["end", 7, 840, 930, 840, 938.4], ["end", -200, 840, 930, 840, 855],
    ["start", 5, 850, 860, 850, 860],
  ];
  for (const [edge, pixels, start, end, toStart, toEnd] of cases) near(followedSpan(start, end, edge, pixels, 8, 24), toStart, toEnd, `${edge} ${pixels} from ${start}–${end}`);
});

test("1.26 R3–R4 where a stretched edge lands", () => {
  const cases: [DragEdge, number, number, number, number, number][] = [
    ["end", 30, 840, 930, 840, 960], ["end", 20, 840, 930, 840, 960], ["end", 6, 840, 930, 840, 930], ["end", 0, 840, 930, 840, 930],
    ["start", -25, 840, 930, 810, 930], ["start", 200, 840, 930, 915, 930], ["end", -200, 840, 930, 840, 855], ["start", -1000, 840, 930, 480, 930], ["end", 1000, 840, 930, 840, 1440],
    // R4: edges off the quarter hours (14:10–15:00).
    ["end", 3, 850, 900, 850, 900], ["end", 10, 850, 900, 850, 915], ["start", -10, 850, 900, 840, 900],
  ];
  for (const [edge, pixels, start, end, toStart, toEnd] of cases) assert.deepEqual(draggedSpan(start, end, edge, pixels, 8, 24, "task"), { start: toStart, end: toEnd }, `${edge} ${pixels} from ${start}–${end}`);
});

test("1.26 R5 a start alone is stretched from its drawn 30 minutes", () => {
  const [span] = stripSpans(stripItems([], [task("보고서", "14:00")], at(9)), at(9));
  assert.deepEqual([span.start, span.end], [840, 870]);
  assert.deepEqual(draggedSpan(span.start, span.end, "start", -12.5, 8, 24, "task"), { start: 825, end: 870 }, "top −15 min: the end is kept");
  assert.deepEqual(draggedSpan(span.start, span.end, "end", 25, 8, 24, "task"), { start: 840, end: 900 }, "bottom +30 min");
  assert.deepEqual(draggedSpan(span.start, span.end, "end", 0, 8, 24, "task"), { start: 840, end: 870 }, "bottom by 0");
});

test("1.26 R6 bounds: a to-do's end stops at 03:45", () => {
  assert.deepEqual(dragBounds(8, 24, "task"), { low: 480, high: 1440 });
  assert.deepEqual(dragBounds(8, 28, "task"), { low: 480, high: 1665 });
  assert.deepEqual(dragBounds(8, 28, "event"), { low: 480, high: 1680 });
  assert.deepEqual(draggedSpan(1560, 1620, "end", 200, 8, 28, "task"), { start: 1560, end: 1665 });
  assert.deepEqual(followedSpan(1560, 1620, "end", 200, 8, 28, "task"), { start: 1560, end: 1665 });
  // [Win] W3: the same bound when a to-do is moved whole (a drag or Alt+↓): an end at 04:00 wouldn't be kept.
  assert.deepEqual(draggedSpan(1560, 1620, "whole", 100, 8, 28, "task"), { start: 1605, end: 1665 }, "W3 dragged");
  assert.deepEqual(nudged(1605, 1665, 1, 8, 28, "task"), { start: 1605, end: 1665 }, "W3 Alt+↓");
  assert.deepEqual(draggedSpan(1560, 1620, "whole", 100, 8, 28, "event"), { start: 1620, end: 1680 }, "an event runs to 04:00");
});

test("1.26 R7 Shift+Alt+↑ ↓: the end by 15 minutes", () => {
  assert.deepEqual(stretched(840, 930, 1, 8, 24, "task"), { start: 840, end: 945 });
  assert.deepEqual(stretched(840, 930, -1, 8, 24, "task"), { start: 840, end: 915 });
  assert.deepEqual(stretched(840, 855, -1, 8, 24, "task"), { start: 840, end: 855 }, "15 minutes at least");
  assert.deepEqual(stretched(1380, 1440, 1, 8, 24, "event"), { start: 1380, end: 1440 }, "inside the day");
});

test("1.26 R8 moving whole: the follow and the landing agree at whole steps", () => {
  for (let pixels = -62.5; pixels <= 62.5; pixels += 12.5) {
    assert.deepEqual(followedSpan(840, 930, "whole", pixels, 8, 24), draggedSpan(840, 930, "whole", pixels, 8, 24), `${pixels}`);
  }
  assert.deepEqual(draggedSpan(840, 930, "whole", 12.5, 8, 24), { start: 855, end: 945 });
});

test("N1–N5 a new item from the timetable", () => {
  const now = at(13, 20);
  const describe = (candidates: Candidate[]) => candidates.map((candidate) => {
    if (candidate.kind === "todo") {
      const range = candidate.range ? ` ${clockKey(candidate.range.start)}–${clockKey(candidate.range.end)}` : "";
      const alert = candidate.reminderAt ? ` reminder ${clockKey(candidate.reminderAt.getHours() * 60 + candidate.reminderAt.getMinutes())}` : "";
      return `todo ${candidate.title}${range}${alert}`;
    }
    if (candidate.kind === "event") return `event ${candidate.title} ${candidate.day} ${clockKey(candidate.start)}–${clockKey(candidate.end)}`;
    return candidate.kind;
  });
  const make = (title: string, minutes: number, kind?: "todo" | "event", lang: "ko" | "en" | "nl" = "ko") => describe(newCandidates(title, minutes, now, lang, kind));
  assert.deepEqual(make("보고서", 840), ["todo 보고서 14:00–15:00 reminder 14:00", "event 보고서 2026-10-08 14:00–15:00"], "N1");
  assert.deepEqual(make("팀 회의", 840), ["event 팀 회의 2026-10-08 14:00–15:00", "todo 팀 회의 14:00–15:00 reminder 14:00"], "N2 event word");
  assert.ok(make("dentist", 840, undefined, "en")[0].startsWith("event"), "N2 en");
  assert.ok(make("팀 회의", 840, "todo")[0].startsWith("todo"), "N3 the chip decides");
  assert.ok(make("보고서", 840, "event")[0].startsWith("event"), "N3 event chip");
  assert.deepEqual(make("정리", 1410), ["todo 정리 23:30–00:30 reminder 23:30", "event 정리 2026-10-08 23:30–00:30"], "N4 past midnight");
  assert.deepEqual(make("정리", 1650), ["todo 정리 03:30–04:00 reminder 03:30", "event 정리 2026-10-09 03:30–04:00"], "N4 not past 04:00");
  assert.deepEqual(make("보고서", 780), ["todo 보고서 13:00–14:00", "event 보고서 2026-10-08 13:00–14:00"], "N5 started: no reminder");
});
