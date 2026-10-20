import assert from "node:assert/strict";
import { test } from "node:test";
import {
  draftForNew, draftForTask, dueEventAlerts, eventAlertKey, eventStatus, eventTimeLabel, eventTooltip, chatterEvents, lengthText, nextEvent, nextEventAlertTime,
  nextSlot, span, todayEvents, validate, type CalendarDraft, type CalendarEvent,
  agendaTime, cellItems, dayTasks, dayTitle, draftForDay, eventsOn, fetchRange, monthGrid, monthTitle, weekDays, weekTitle,
} from "../src/core/calendar";
import { occurrences, type LocalEvent } from "../src/core/events";

// Same cases as the macOS app. Every time is a local time, so the results don't depend on this
// machine's time zone (the suite also runs under TZ=America/Los_Angeles and Pacific/Chatham).

const at = (day: number, hour: number, minute = 0, second = 0) => new Date(2026, 9, day, hour, minute, second);
const midnight = (day: number) => new Date(2026, 9, day);
const day = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
/** An event as the strip and the 달력 get it (an occurrence of a local event). */
function ev(id: string, title: string, start: Date, end: Date, allDay = false, location?: string): CalendarEvent {
  return { key: `local/${id}@${day(start)}`, calendarId: "local", title, allDay, start, end, ...(location ? { location } : {}), color: "#5b8bd0", eventId: id, canEdit: true, recurring: false };
}
const now = at(7, 9);

const events = {
  a: ev("a", "팀 회의", at(7, 10), at(7, 11)),
  b: ev("b", "치과", at(7, 15), at(7, 16)),
  c: ev("c", "생일", midnight(7), midnight(8), true),
  d: ev("d", "출장", midnight(5), midnight(9), true),
  e: ev("e", "어제 저녁", at(6, 20), at(6, 21)),
  f: ev("f", "새벽 작업", at(8, 2), at(8, 3)),
  g: ev("g", "밤샘", at(7, 3), at(7, 5)),
  i: ev("i", "(제목 없음)", at(7, 12), at(7, 12, 30)),
};
const event = (id: keyof typeof events) => events[id];
const all = Object.values(events);
const ids = (list: CalendarEvent[]) => list.map((entry) => entry.eventId);

test("1. a timed event: 10:00, 60분 뒤", () => {
  const a = event("a");
  assert.equal(eventTimeLabel(a, now), "10:00");
  assert.deepEqual(eventStatus(a, now), { text: "60분 뒤", state: "soon" });
});

test("2. more than an hour ahead: no status text", () => {
  const b = event("b");
  assert.equal(eventTimeLabel(b, now), "15:00");
  assert.deepEqual(eventStatus(b, now), { text: "", state: "upcoming" });
});

test("3. an all-day event today", () => {
  const c = event("c");
  assert.equal(eventTimeLabel(c, now), "종일");
  assert.deepEqual(eventStatus(c, now), { text: "", state: "allDay" });
  assert.ok(ids(todayEvents([c], now)).includes("c"));
});

test("4. an all-day event over several days includes today", () => {
  assert.deepEqual(ids(todayEvents([event("d")], now)), ["d"]);
});

test("5. yesterday evening is not today", () => {
  assert.deepEqual(todayEvents([event("e")], now), []);
});

test("6. 2 a.m. tomorrow still belongs to today (the day ends at 4)", () => {
  assert.deepEqual(ids(todayEvents([event("f")], now)), ["f"]);
});

test("7. began before 4 a.m. and runs on: included, ~05:00", () => {
  const g = event("g");
  assert.deepEqual(ids(todayEvents([g], now)), ["g"]);
  assert.equal(eventTimeLabel(g, now), "~05:00");
});

test("9. an empty title reads (제목 없음), the title trimmed", () => {
  const stored = (title: string): LocalEvent => ({ id: "E", title, date: "2026-10-07", allDay: false, days: 1, start: 720, end: 750, repeat: "none", skip: [], color: "blue", createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" });
  assert.equal(occurrences(stored("  "), midnight(7), midnight(8))[0].title, "(제목 없음)");
  assert.equal(occurrences(stored(" 팀 회의 "), midnight(7), midnight(8))[0].title, "팀 회의");
});

test("10. today's order: all-day by title, then by start time", () => {
  assert.deepEqual(todayEvents(all, now).map((entry) => entry.title), ["생일", "출장", "밤샘", "팀 회의", "(제목 없음)", "치과", "새벽 작업"]);
});

test("11. status during and after, and the minutes rounded up", () => {
  const a = event("a");
  assert.deepEqual(eventStatus(a, at(7, 10, 30)), { text: "진행 중", state: "now" });
  assert.deepEqual(eventStatus(a, at(7, 11)), { text: "끝남", state: "past" });
  assert.deepEqual(eventStatus(a, at(7, 9, 59, 30)), { text: "1분 뒤", state: "soon" });
});

test("12. alerts: lead minutes before the start, once, never after it began", () => {
  const a = event("a");
  assert.deepEqual(ids(dueEventAlerts(all, at(7, 9, 50), 10)), ["a"]);
  assert.deepEqual(dueEventAlerts(all, at(7, 9, 49), 10), []);
  assert.deepEqual(ids(dueEventAlerts(all, at(7, 10), 10)), []);
  assert.deepEqual(dueEventAlerts(all, at(7, 9, 50), 10, new Set([eventAlertKey(a)])), []);
  assert.equal(eventAlertKey(a), `${a.key}@${Math.floor(at(7, 10).getTime() / 1000)}`);
  assert.equal(nextEventAlertTime(all, at(7, 9), 10), at(7, 9, 50).getTime());
  assert.deepEqual(dueEventAlerts(all, at(7, 9, 50), 0), []);
  assert.equal(nextEventAlertTime(all, at(7, 9), 0), undefined);
});

test("13. runs past the end of the day: 23:00~", () => {
  assert.equal(eventTimeLabel(ev("late", "야간 근무", at(7, 23), at(8, 6)), now), "23:00~");
});

test("the next event and the tooltip", () => {
  assert.equal(nextEvent(all, now)?.title, "팀 회의");
  assert.equal(nextEvent(all, at(7, 10, 30))?.title, "(제목 없음)");
  assert.equal(eventTooltip(ev("a", "팀 회의", at(7, 10), at(7, 11), false, "3층 회의실")), "팀 회의 · 10:00–11:00 · 3층 회의실");
  assert.equal(eventTooltip(event("c")), "생일 · 종일");
});

// ─── The sheet's draft (2단계 rules, without choosing a calendar; now = 2026-10-07 (수) 14:05) ───

const writeNow = at(7, 14, 5);
const draft = (fields: Partial<CalendarDraft>): CalendarDraft => ({ title: "회의", color: "blue", date: "2026-10-07", allDay: false, days: 1, startMinutes: 600, endMinutes: 660, repeat: "none", ...fields });

test("w2. the next slot: up to :00 or :30, at least 10 minutes away", () => {
  assert.deepEqual(nextSlot(writeNow), { date: "2026-10-07", minutes: 870 });
  assert.deepEqual(nextSlot(at(7, 14, 25)), { date: "2026-10-07", minutes: 900 });
  assert.deepEqual(nextSlot(at(7, 14, 0)), { date: "2026-10-07", minutes: 870 });
  assert.deepEqual(nextSlot(at(7, 14, 20)), { date: "2026-10-07", minutes: 870 });
  assert.deepEqual(nextSlot(at(7, 23, 55)), { date: "2026-10-08", minutes: 30 });
});

test("w3. a task with an alert: that time, an hour, the title trimmed", () => {
  assert.deepEqual(draftForTask("  보고서 쓰기 ", at(8, 15), undefined, writeNow, undefined, "T1"),
    { title: "보고서 쓰기", color: "blue", date: "2026-10-08", allDay: false, days: 1, startMinutes: 900, endMinutes: 960, repeat: "none", taskId: "T1" });
});

test("w4. a task with only a deadline: all day on it", () => {
  const sent = draftForTask("보고서", undefined, "2026-10-09", writeNow);
  assert.deepEqual([sent.allDay, sent.date, sent.days, sent.repeat, sent.color], [true, "2026-10-09", 1, "none", "blue"]);
});

test("w5. a task with neither: the next slot, an hour; a new event takes the last colour", () => {
  const sent = draftForTask("보고서", undefined, undefined, writeNow);
  assert.deepEqual([sent.allDay, sent.date, sent.startMinutes, sent.endMinutes], [false, "2026-10-07", 870, 930]);
  assert.deepEqual(draftForNew(writeNow, "purple"), { title: "", color: "purple", date: "2026-10-07", allDay: false, days: 1, startMinutes: 870, endMinutes: 930, repeat: "none" });
  assert.equal(draftForNew(writeNow, "").color, "blue");
  assert.equal(draftForNew(writeNow, "pink").color, "blue");
});

test("w6. an hour from 23:30 ends tomorrow", () => {
  const late = draftForTask("야간", at(7, 23, 30), undefined, writeNow);
  assert.deepEqual([late.date, late.startMinutes, late.endMinutes], ["2026-10-07", 1410, 30]);
  assert.equal(lengthText(late), "1시간 · 다음 날");
  assert.equal(span(late).start.getTime(), at(7, 23, 30).getTime());
  assert.equal(span(late).end.getTime(), at(8, 0, 30).getTime());
});

test("w7. what stops saving, in order", () => {
  assert.equal(validate(draft({ title: "" })), "제목을 적어 주세요");
  assert.equal(validate(draft({ title: " ", startMinutes: 600, endMinutes: 600 })), "제목을 적어 주세요");
  assert.equal(validate(draft({ startMinutes: 600, endMinutes: 600 })), "끝나는 시간이 시작과 같아요");
  assert.equal(validate(draft({ startMinutes: 600, endMinutes: 630 })), undefined);
  assert.equal(validate(draft({ allDay: true, startMinutes: 600, endMinutes: 600 })), undefined);
});

test("w8. the length beside the times", () => {
  assert.equal(lengthText(draft({ startMinutes: 600, endMinutes: 630 })), "30분");
  assert.equal(lengthText(draft({ startMinutes: 600, endMinutes: 690 })), "1시간 30분");
  assert.equal(lengthText(draft({ startMinutes: 600, endMinutes: 720 })), "2시간");
  assert.equal(lengthText(draft({ allDay: true, days: 1 })), "하루");
  assert.equal(lengthText(draft({ allDay: true, days: 3 })), "3일");
});

// ─── 3단계: the calendar window (spec §1, same cases as the Mac; days from midnight) ───

const monthNow = at(7, 14, 5);
const days3 = {
  birthday: ev("birthday", "생일", midnight(7), midnight(8), true),
  trip: ev("trip", "출장", midnight(5), midnight(9), true),
  meeting: ev("meeting", "회의", at(7, 10), at(7, 11)),
  night: ev("night", "야간", at(6, 23), at(7, 1)),
  late: ev("late", "늦은", at(7, 23, 30), at(8, 0, 30)),
  tomorrow: ev("tomorrow", "내일", at(8, 0), at(8, 1)),
};
const tasks5 = [
  { id: "A", title: "A", isCompleted: false, dueDate: "2026-10-07" },
  { id: "B", title: "B", isCompleted: false, reminderAt: at(7, 15).toISOString() },
  { id: "C", title: "C", isCompleted: false, reminderAt: at(7, 9, 30).toISOString() },
  { id: "D", title: "D", isCompleted: false, dueDate: "2026-10-07", reminderAt: at(7, 8).toISOString() },
  { id: "E", title: "E", isCompleted: true, dueDate: "2026-10-07" },
  { id: "F", title: "F", isCompleted: false, dueDate: "2026-10-08" },
];
const titles = (list: CalendarEvent[]) => list.map((entry) => entry.title);

test("c1. the month grid: six weeks from the Sunday before the 1st", () => {
  const october = monthGrid(2026, 10);
  assert.equal(october.length, 42);
  assert.equal(october[0], "2026-09-27");
  assert.equal(october[41], "2026-11-07");
  const february = monthGrid(2026, 2);
  assert.equal(february.length, 42);
  assert.equal(february[0], "2026-02-01");
  assert.equal(february[41], "2026-03-14");
  // Every day once, in order (no day lost or doubled where the clocks change).
  for (const month of [3, 4, 10, 11]) {
    const grid = monthGrid(2026, month);
    for (let index = 1; index < grid.length; index += 1) {
      const [a, b] = [grid[index - 1], grid[index]].map((day) => new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8))));
      assert.equal(Math.round((b.getTime() - a.getTime()) / 86_400_000), 1, `${grid[index - 1]} → ${grid[index]}`);
    }
  }
});

test("c2. the week of a day: Sunday to Saturday", () => {
  assert.deepEqual(weekDays("2026-10-07"), ["2026-10-04", "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10"]);
  assert.deepEqual(weekDays("2026-10-04"), weekDays("2026-10-07"));
  assert.deepEqual(weekDays("2027-01-01"), ["2026-12-27", "2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
});

test("c3. a day's events: all-day by title, then by start; midnight tomorrow is not today", () => {
  assert.deepEqual(titles(eventsOn("2026-10-07", Object.values(days3))), ["생일", "출장", "야간", "회의", "늦은"]);
  assert.deepEqual(titles(eventsOn("2026-10-08", Object.values(days3))), ["출장", "늦은", "내일"]);
});

test("c4. the day panel's times", () => {
  const day = "2026-10-07";
  assert.equal(agendaTime(days3.birthday, day), "종일");
  assert.equal(agendaTime(days3.meeting, day), "10:00–11:00");
  assert.equal(agendaTime(days3.night, day), "~01:00");
  assert.equal(agendaTime(days3.late, day), "23:30~");
  assert.equal(agendaTime(ev("long", "긴 일", at(6, 20), at(8, 9)), day), "종일");
  assert.equal(agendaTime(ev("zero", "순간", at(7, 12), at(7, 12)), day), "12:00");
});

test("c5. a day's tasks: alerts by time, then deadlines by title; finished ones and other days left out", () => {
  assert.deepEqual(dayTasks("2026-10-07", tasks5), [
    { title: "C", kind: "reminder", time: "09:30", taskId: "C" },
    { title: "B", kind: "reminder", time: "15:00", taskId: "B" },
    { title: "A", kind: "deadline", taskId: "A" },
    { title: "D", kind: "deadline", taskId: "D" },
  ]);
  assert.deepEqual(dayTasks("2026-10-08", tasks5), [{ title: "F", kind: "deadline", taskId: "F" }]);
});

test("c6. a month cell: the first three of events then deadlines, and how many more", () => {
  const { items, more } = cellItems("2026-10-07", Object.values(days3), tasks5);
  assert.deepEqual(items.map((item) => (item.kind === "event" ? item.event.title : item.task.title)), ["생일", "출장", "야간"]);
  assert.equal(more, 4);
  const roomy = cellItems("2026-10-07", Object.values(days3), tasks5, 10);
  assert.deepEqual(roomy.items.map((item) => (item.kind === "event" ? item.event.title : `⚑ ${item.task.title}`)), ["생일", "출장", "야간", "회의", "늦은", "⚑ A", "⚑ D"]);
  assert.equal(roomy.more, 0);
});

test("c7. the titles", () => {
  assert.equal(monthTitle(2026, 10), "2026년 10월");
  assert.equal(weekTitle(weekDays("2026-10-07")), "10월 4일 – 10일");
  assert.equal(weekTitle(weekDays("2026-10-01")), "9월 27일 – 10월 3일");
  assert.equal(weekTitle(weekDays("2027-01-01")), "2026년 12월 27일 – 2027년 1월 2일");
  assert.equal(dayTitle("2026-10-07"), "10월 7일 수요일");
});

test("c8. a new event on a day: today's next half hour (21:00 when that is tomorrow), else 09:00", () => {
  assert.deepEqual(draftForDay("2026-10-07", monthNow), { title: "", color: "blue", date: "2026-10-07", allDay: false, days: 1, startMinutes: 870, endMinutes: 930, repeat: "none" });
  assert.deepEqual(draftForDay("2026-10-09", monthNow, "coral"), { title: "", color: "coral", date: "2026-10-09", allDay: false, days: 1, startMinutes: 540, endMinutes: 600, repeat: "none" });
  const late = draftForDay("2026-10-07", at(7, 23, 55));
  assert.deepEqual([late.date, late.startMinutes, late.endMinutes, late.allDay, late.title], ["2026-10-07", 1260, 1320, false, ""]);
});

test("c9. the month's fetch: midnight of its first day to midnight after its last", () => {
  const { start, end } = fetchRange(monthGrid(2026, 10));
  assert.equal(start.getTime(), new Date(2026, 8, 27).getTime());
  assert.equal(end.getTime(), new Date(2026, 10, 8).getTime());
  const week = fetchRange(weekDays("2026-10-07"));
  assert.equal(week.start.getTime(), new Date(2026, 9, 4).getTime());
  assert.equal(week.end.getTime(), new Date(2026, 9, 11).getTime());
});

test("종이냥 한마디 knows today's calendar (same cases as macOS)", () => {
  const at = (hour: number, minute = 0, second = 0) => new Date(2026, 9, 7, hour, minute, second);
  const event = (title: string, start: Date, end: Date, allDay = false): CalendarEvent =>
    ({ key: `local/${title}@2026-10-07`, calendarId: "local", title, allDay, start, end, color: "#5b8bd0", eventId: title, canEdit: true, recurring: false });
  const events = [event("A", at(10), at(11)), event("B", at(13, 30), at(14, 30)), event("C", at(14), at(14, 3)),
    event("D", at(14, 20), at(15)), event("E", at(18), at(19)), event("F", at(0), at(24), true)];
  assert.deepEqual(chatterEvents(events, at(14, 5)), { next: "D", nextIn: 15, now: "B", ended: "C", left: 2 });
  assert.equal(chatterEvents(events, at(14, 5, 30)).nextIn, 15);
  assert.deepEqual(chatterEvents(events, at(14, 24)), { next: "E", nextIn: 216, now: "B", left: 1 });
  const at1120 = chatterEvents(events, at(11, 20));
  assert.equal(at1120.ended, "A");
  assert.equal(at1120.now, undefined);
  assert.equal(chatterEvents(events, at(11, 21)).ended, undefined);
  assert.deepEqual(chatterEvents([], at(14, 5)), { nextIn: 0, left: 0 });
});
