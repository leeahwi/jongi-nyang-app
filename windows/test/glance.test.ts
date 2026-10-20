import assert from "node:assert/strict";
import { test } from "node:test";
import type { Alarm } from "../src/core/alarm";
import type { CalendarEvent } from "../src/core/calendar";
import { glanceCards, glanceOrigin, glanceTasks, glanceText, shortTitle, taskbarEdge, type GlanceTimer } from "../src/core/glance";
import type { TodoItem } from "../src/core/notebook";

// Thursday 8 October 2026, 14:50.
const now = new Date(2026, 9, 8, 14, 50);
const at = (hour: number, minute = 0, day = 8) => new Date(2026, 9, day, hour, minute);
const event = (title: string, start: Date, end: Date, extra: Partial<CalendarEvent> = {}): CalendarEvent => ({
  key: `local/${title}@x`, calendarId: "local", title, allDay: false, start, end, color: "#5b8bd0", eventId: title, canEdit: true, recurring: false, ...extra,
});
const task = (title: string, reminder?: Date, done = false): TodoItem => ({
  id: title, title, isCompleted: done, createdAt: "2026-10-08T00:00:00Z", ...(reminder ? { reminderAt: reminder.toISOString() } : {}),
});
const alarm = (time: string, days: number[], enabled = true): Alarm => ({
  id: `A${time}`, time, label: "", days, enabled, sound: "bell", snooze: 10, createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z",
});
const running: GlanceTimer = { remainingMs: 12 * 60_000 + 30_000, paused: false, caption: "Timer", countdown: true };

test("glance words: the timer first, then the next thing within the hour, else nothing", () => {
  const dentist = event("치과", at(15, 30), at(16, 30));
  assert.equal(glanceText([dentist], [], running, now, "ko"), "12:30");
  assert.equal(glanceText([dentist], [], undefined, now, "ko"), "치과 40분");
  assert.equal(glanceText([event("Dentist", at(15, 30), at(16, 30))], [], undefined, now, "en"), "Dentist 40 min");
  assert.equal(glanceText([event("Tandarts", at(15, 30), at(16, 30))], [], undefined, now, "nl"), "Tandarts 40 min");
  // A paused timer gives the words back to what's coming.
  assert.equal(glanceText([dentist], [], { ...running, paused: true }, now, "ko"), "치과 40분");
  // A task reminder sooner than the event wins; done ones, all-day events and things over an hour away don't count.
  assert.equal(glanceText([dentist], [task("보고서", at(15, 10))], undefined, now, "ko"), "보고서 20분");
  assert.equal(glanceText([dentist], [task("보고서", at(15, 10), true)], undefined, now, "ko"), "치과 40분");
  assert.equal(glanceText([event("생일", at(0), at(0, 0, 9), { allDay: true })], [task("저녁", at(16, 0))], undefined, now, "ko"), undefined);
  assert.equal(glanceText([event("지난 회의", at(14), at(15))], [], undefined, now, "ko"), undefined);
  assert.equal(glanceText([event("곧", at(14, 50), at(15, 50))], [], undefined, new Date(2026, 9, 8, 14, 49, 30), "ko"), "곧 1분");
  // Exactly an hour still counts.
  assert.equal(glanceText([event("한 시간", at(15, 50), at(16, 50))], [], undefined, now, "ko"), "한 시간 60분");
});

test("glance words: long titles are cut to 12 characters", () => {
  assert.equal(shortTitle("분기 보고서 초안 정리하고 공유하기"), "분기 보고서 초안 정리…");
  assert.equal(shortTitle("Quarterly report draft"), "Quarterly re…");
  assert.equal(shortTitle("치과"), "치과");
  assert.equal(shortTitle("오늘 꼭 해야 할 일 정리하기"), "오늘 꼭 해야 할 일…", "no space before the …");
  assert.equal(glanceText([event("Quarterly report draft", at(15), at(16))], [], undefined, now, "en"), "Quarterly re… 10 min");
});

test("glance cards: next event, timer, next alarm — the urgent one hot", () => {
  const alarms = [alarm("07:00", [1, 2, 3, 4, 5]), alarm("06:00", [], false)];
  const cards = glanceCards([event("치과", at(15, 30), at(16, 30)), event("회의", at(10), at(11))], undefined, alarms, new Set(), now, "ko");
  assert.deepEqual(cards.map((card) => [card.label, card.big, card.small, card.hot, card.empty]), [
    ["다음 일정", "15:30", "40분 뒤 · 치과", true, false],
    ["타이머", "—", "“타이머 25”", false, true],
    ["다음 알람", "07:00", "내일 · 평일", false, false],
  ]);
  const en = glanceCards([event("Meeting", at(10, 0, 9), at(11, 0, 9))], running, alarms, new Set(), now, "en");
  assert.deepEqual(en.map((card) => [card.label, card.big, card.small, card.hot]), [
    ["Next event", "10:00 AM", "Tomorrow · Meeting", false],
    ["Timer", "12:30", "Ends at 3:03 PM", true],
    ["Next alarm", "7:00 AM", "Tomorrow · Weekdays", false],
  ]);
  const nl = glanceCards([event("Overleg", at(9, 0, 12), at(10, 0, 12))], { ...running, paused: true, caption: "Focus 1/4", countdown: false }, [], new Set(), now, "nl");
  assert.deepEqual(nl.map((card) => [card.label, card.big, card.small, card.hot, card.empty]), [
    ["Afspraak", "09:00", "ma · Overleg", false, false],
    ["Timer", "12:30", "Focus 1/4 · Gepauzeerd", false, false],
    ["Wekker", "—", "‘wekker 7:00’", false, true],
  ]);
  // An alarm within the hour is hot; an event later today says how long until it.
  const soon = glanceCards([event("저녁", at(18, 20), at(19))], undefined, [alarm("15:30", [])], new Set(), now, "ko");
  assert.deepEqual(soon.map((card) => [card.big, card.small, card.hot]), [["18:20", "3시간 30분 뒤 · 저녁", false], ["—", "“타이머 25”", false], ["15:30", "오늘 · 한 번", true]]);
  assert.deepEqual(glanceCards([], undefined, [], new Set(), now, "en").map((card) => card.small), ["None today", "“timer 25”", "“alarm 7am”"]);
  // The empty cards say what the Mac's say: none today, or what to type (stage 4 parity).
  assert.deepEqual(glanceCards([], undefined, [], new Set(), now, "ko").map((card) => card.small), ["오늘은 없어요", "“타이머 25”", "“알람 7시”"]);
  // A countdown says when it ends (to the minute), or that it's paused; a pomodoro its phase.
  assert.equal(glanceCards([], running, [], new Set(), now, "ko")[1].small, "15:03에 끝나요");
  assert.equal(glanceCards([], { ...running, paused: true }, [], new Set(), now, "ko")[1].small, "멈춤");
  assert.equal(glanceCards([], { ...running, caption: "Focus 2/4", countdown: false }, [], new Set(), now, "nl")[1].small, "Focus 2/4");
});

test("glance tasks: 다음 first (at most three), then three more, and how many are left out", () => {
  const today = [task("a"), task("b", at(16)), task("c", at(15)), task("d"), task("e", undefined, true), task("f"), task("g"), task("h", at(13))];
  const { next, rest, hidden } = glanceTasks(today, now);
  assert.deepEqual(next.map((item) => item.id), ["c", "b"]);
  assert.deepEqual(rest.map((item) => item.id), ["a", "d", "f"]);
  assert.equal(hidden, 2);
  assert.deepEqual(glanceTasks([], now), { next: [], rest: [], hidden: 0 });
});

test("glance window: against the taskbar, lined up with the tray icon, inside the work area", () => {
  const display = { x: 0, y: 0, width: 1920, height: 1080 };
  const size = { width: 360, height: 420 };
  // Taskbar at the bottom: above the icon, kept inside on the right.
  const bottom = { x: 0, y: 0, width: 1920, height: 1040 };
  assert.equal(taskbarEdge(display, bottom), "bottom");
  assert.deepEqual(glanceOrigin({ x: 1700, y: 1045, width: 24, height: 30 }, display, bottom, size), { x: 1532, y: 620 });
  assert.deepEqual(glanceOrigin({ x: 1890, y: 1045, width: 24, height: 30 }, display, bottom, size), { x: 1560, y: 620 });
  assert.deepEqual(glanceOrigin(undefined, display, bottom, size), { x: 1560, y: 620 });
  // At the top (and the Mac's menu bar): under it.
  const top = { x: 0, y: 40, width: 1920, height: 1040 };
  assert.equal(taskbarEdge(display, top), "top");
  assert.deepEqual(glanceOrigin({ x: 1700, y: 5, width: 24, height: 30 }, display, top, size), { x: 1532, y: 40 });
  // On the left or the right: beside it, level with the icon.
  const left = { x: 60, y: 0, width: 1860, height: 1080 };
  assert.equal(taskbarEdge(display, left), "left");
  assert.deepEqual(glanceOrigin({ x: 18, y: 900, width: 24, height: 24 }, display, left, size), { x: 60, y: 660 });
  const right = { x: 0, y: 0, width: 1860, height: 1080 };
  assert.equal(taskbarEdge(display, right), "right");
  assert.deepEqual(glanceOrigin({ x: 1878, y: 300, width: 24, height: 24 }, display, right, size), { x: 1500, y: 102 });
  // A second display to the right, taskbar at the bottom.
  const second = { x: 1920, y: 0, width: 2560, height: 1440 };
  assert.deepEqual(glanceOrigin(undefined, second, { x: 1920, y: 0, width: 2560, height: 1392 }, size, 8), { x: 4112, y: 964 });
});
