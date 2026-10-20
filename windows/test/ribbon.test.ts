import assert from "node:assert/strict";
import { test } from "node:test";
import type { CalendarEvent } from "../src/core/calendar";
import type { TodoItem } from "../src/core/notebook";
import { awayText, dayRibbon, hourLabel, parseClockText, upNext } from "../src/core/ribbon";

// Thursday 8 October 2026, 14:50.
const now = new Date(2026, 9, 8, 14, 50);
const at = (hour: number, minute = 0, day = 8) => new Date(2026, 9, day, hour, minute);
const event = (title: string, start: Date, end: Date, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  key: `local/${title}@2026-10-08`, calendarId: "local", title, allDay: false, start, end, color: "#5b8bd0", eventId: title, canEdit: true, recurring: false, ...extra,
});
const task = (id: string, reminder?: Date, done = false): TodoItem => ({
  id, title: id, isCompleted: done, createdAt: "2026-10-08T00:00:00Z", ...(reminder ? { reminderAt: reminder.toISOString() } : {}),
});

test("ribbon: nothing today, no ribbon", () => {
  assert.equal(dayRibbon([], [task("a")], now), undefined);
  assert.equal(dayRibbon([event("어제", at(10, 0, 7), at(11, 0, 7))], [task("a", at(9), true)], now), undefined);
});

test("ribbon: 8 to 24, now, bars, rings and the next thing", () => {
  const ribbon = dayRibbon([
    event("팀 회의", at(14), at(15)), event("치과", at(15, 30), at(16, 30)), event("스탠드업", at(9), at(9, 15)),
    event("엄마 생신", at(0), at(0, 0, 9), { allDay: true }),
  ], [task("보고서", at(16)), task("끝낸 일", at(17), true)], now, "ko")!;
  assert.equal(ribbon.startHour, 8);
  assert.equal(ribbon.endHour, 24);
  assert.deepEqual(ribbon.hours.map((hour) => hour.text), ["8", "12", "16", "20", "24"]);
  assert.ok(Math.abs(ribbon.now - (14 + 50 / 60 - 8) / 16) < 1e-9);
  assert.deepEqual(ribbon.bars.map((bar) => [bar.title, bar.past]), [["스탠드업", true], ["팀 회의", false], ["치과", false]]);
  assert.deepEqual(ribbon.rings.map((ring) => ring.title), ["보고서"]);
  assert.deepEqual(ribbon.allDay.map((pill) => pill.title), ["엄마 생신"]);
  assert.equal(ribbon.current, "팀 회의");
  assert.deepEqual(ribbon.next, { title: "치과", time: "15:30", away: "40분 뒤" });
  assert.equal(ribbon.sentence, "지금 팀 회의 · 다음 15:30 치과, 40분 뒤");
});

test("ribbon: an early event and a late walk stretch the track; nothing ahead", () => {
  const ribbon = dayRibbon([event("요가", at(6, 30), at(7, 30)), event("밤 산책", at(23), at(0, 30, 9))], [], at(23, 40), "en")!;
  assert.equal(ribbon.startHour, 6);
  assert.equal(ribbon.endHour, 28);
  assert.deepEqual(ribbon.hours.map((hour) => hour.text), ["6 AM", "12 PM", "6 PM", "12 AM", "4 AM"]);
  assert.equal(ribbon.current, "밤 산책");
  assert.equal(ribbon.next, undefined);
  assert.equal(ribbon.sentence, "Now: 밤 산책 · Nothing else today");
  const dutch = dayRibbon([event("Lunch", at(12), at(13))], [task("Bellen", at(18, 5))], now, "nl")!;
  assert.equal(dutch.sentence, "Volgende 18:05 Bellen");
});

test("ribbon: all-day pills, two and +N", () => {
  const allDay = (title: string) => event(title, at(0), at(0, 0, 9), { allDay: true, key: `local/${title}@2026-10-08` });
  const ribbon = dayRibbon([allDay("가"), allDay("나"), allDay("다")], [], now)!;
  assert.deepEqual(ribbon.allDay.map((pill) => pill.title), ["가", "나"]);
  assert.equal(ribbon.more, 1);
  assert.equal(ribbon.sentence, "오늘 남은 일정이 없어요");
});

test("다음: open reminders later today, soonest first, at most three", () => {
  const items = [task("e", at(20)), task("a", at(15)), task("late", at(9)), task("done", at(16), true), task("b", at(16)), task("c", at(17)), task("tomorrow", at(9, 0, 9)), task("none")];
  assert.deepEqual(upNext(items, now).map((item) => item.id), ["a", "b", "c"]);
});

test("words: away, hour labels, typed clock times", () => {
  assert.equal(awayText(40), "40분 뒤");
  assert.equal(awayText(70), "1시간 10분 뒤");
  assert.equal(awayText(120, "en"), "in 2 h");
  assert.equal(awayText(75, "nl"), "over 1 u 15 min");
  assert.equal(hourLabel(24, "en"), "12 AM");
  assert.equal(hourLabel(12, "en"), "12 PM");
  assert.equal(hourLabel(26, "ko"), "2");
  assert.equal(parseClockText("17:20"), 17 * 60 + 20);
  assert.equal(parseClockText("1720"), 17 * 60 + 20);
  assert.equal(parseClockText("5:20pm"), 17 * 60 + 20);
  assert.equal(parseClockText("5 PM"), 17 * 60);
  assert.equal(parseClockText("12am"), 0);
  assert.equal(parseClockText("오후 5:20"), 17 * 60 + 20);
  assert.equal(parseClockText("오전 9시 30분"), 9 * 60 + 30);
  assert.equal(parseClockText("9"), 9 * 60);
  assert.equal(parseClockText("25:00"), undefined);
  assert.equal(parseClockText("13pm"), undefined);
  assert.equal(parseClockText("abc"), undefined);
});

test("ribbon: hour labels on other spans keep the ends and sit on multiples of 6 (as on the Mac)", () => {
  const late = dayRibbon([event("밤 산책", at(23), at(0, 30, 9))], [], at(10), "ko")!;
  assert.deepEqual([late.startHour, late.endHour], [8, 28]);
  assert.deepEqual(late.hours.map((hour) => hour.text), ["8", "12", "18", "24", "4"]);
  const early = dayRibbon([event("요가", at(6, 30), at(7, 30))], [], at(10), "ko")!;
  assert.deepEqual(early.hours.map((hour) => hour.text), ["6", "12", "18", "24"]);
  // A next thing more than three hours off: just its clock, no countdown pill.
  const far = dayRibbon([event("저녁", at(19), at(20))], [], at(10), "ko")!;
  assert.equal(far.next?.away, undefined);
});

// ─── 1.24 시간 정하기: task blocks (timeblock-cases.md §5, rows RB1–RB6) ───────────────

const ranged = (id: string, start: string, end?: string, extra: Partial<TodoItem> = {}): TodoItem => ({
  id, title: id, isCompleted: false, createdAt: "2026-10-08T00:00:00Z", timeStart: start, ...(end ? { timeEnd: end } : {}), ...extra,
});

test("ribbon blocks: RB1 a block with events — its own lane, now and next", () => {
  const ribbon = dayRibbon([event("치과", at(15, 30), at(16, 30))], [ranged("보고서", "14:00", "15:30", { reminderAt: at(14).toISOString() })], now, "ko")!;
  assert.deepEqual(ribbon.blocks.map((block) => [block.title, block.lane, block.done, block.overdue, block.tooltip]), [["보고서", 0, false, false, "보고서 · 14:00–15:30"]]);
  assert.ok(Math.abs(ribbon.blocks[0].from - 6 / 16) < 1e-9 && Math.abs(ribbon.blocks[0].to - 7.5 / 16) < 1e-9);
  assert.equal(ribbon.taskLanes, 1);
  // Its reminder at the start is the block's: no ring.
  assert.deepEqual(ribbon.rings, []);
  assert.equal(ribbon.current, "보고서");
  assert.equal(ribbon.sentence, "지금 보고서 · 다음 15:30 치과, 40분 뒤");
});

test("ribbon blocks: RB2 overlapping tasks take two lanes; a third shares the second", () => {
  const ribbon = dayRibbon([], [ranged("a", "10:00", "12:00"), ranged("b", "11:00", "13:00"), ranged("c", "11:30", "12:30"), ranged("d", "12:00", "12:30")], now, "ko")!;
  assert.deepEqual(ribbon.blocks.map((block) => [block.title, block.lane]), [["a", 0], ["b", 1], ["c", 1], ["d", 0]]);
  assert.equal(ribbon.taskLanes, 2);
});

test("ribbon blocks: RB3 done faded, overdue in clay, a start alone is 30 minutes", () => {
  const ribbon = dayRibbon([], [ranged("끝", "09:00", "10:00", { isCompleted: true }), ranged("늦음", "13:00", "14:00"), ranged("혼자", "16:00")], now, "en")!;
  assert.deepEqual(ribbon.blocks.map((block) => [block.title, block.done, block.overdue]), [["끝", true, false], ["늦음", false, true], ["혼자", false, false]]);
  assert.equal(ribbon.blocks[2].tooltip, "혼자 · 4:00–4:30 PM");
  assert.ok(Math.abs(ribbon.blocks[2].to - ribbon.blocks[2].from - 0.5 / 16) < 1e-9);
  // Done and over blocks are neither now nor next.
  assert.equal(ribbon.current, undefined);
  assert.deepEqual(ribbon.next, { title: "혼자", time: "4:00 PM", away: "in 1 h 10 min" });
});

test("ribbon blocks: RB4 only on its day; 언젠가 and other days draw nothing", () => {
  assert.equal(dayRibbon([], [ranged("내일", "10:00", "11:00", { dueDate: "2026-10-09" }), ranged("언젠가", "10:00", "11:00", { shelf: "later" })], now), undefined);
  const due = dayRibbon([], [ranged("오늘 마감", "17:00", "18:00", { dueDate: "2026-10-08" })], now)!;
  assert.deepEqual(due.blocks.map((block) => block.title), ["오늘 마감"]);
});

test("ribbon blocks: RB5 an early block stretches the track; a reminder elsewhere keeps its ring", () => {
  const ribbon = dayRibbon([], [ranged("요가", "06:30", "07:30", { reminderAt: at(6).toISOString(), isCompleted: false })], at(5, 50), "ko")!;
  assert.equal(ribbon.startHour, 5);
  assert.deepEqual(ribbon.rings.map((ring) => ring.title), ["요가"]);
  assert.deepEqual(ribbon.next, { title: "요가", time: "06:00", away: "10분 뒤" });
});

test("ribbon blocks: RB6 다음 orders ranged tasks by their start, with reminders", () => {
  const items = [task("알림", at(16)), ranged("범위", "15:00", "16:00"), ranged("지난 범위", "13:00", "14:00"), ranged("진행 중", "14:30", "15:10")];
  assert.deepEqual(upNext(items, now).map((item) => item.id), ["진행 중", "범위", "알림"]);
});
