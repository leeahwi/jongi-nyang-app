import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { cellItems, dayTasks, taskTooltip, weekOrder, type CalendarEvent, type CellItem, type DayTask } from "../src/core/calendar";
import type { Lang } from "../src/core/lang";
import { hiddenSpaces, isHiddenSpace, readDeviceRules } from "../src/core/spaceDevice";
import { parseTodoSpaces } from "../src/core/todoSpaces";

// 달력의 알림 할 일 (#227): the shared cases from docs/plans/calendar-reminders-cases.json (the Mac's
// test-calendar-reminders.sh reads the same file) — a month cell's lines (events, deadlines, then reminders by time, the
// title only) and its "+N", a week row's tasks, the day panel's (unchanged), the tooltips, and what a space this PC hides
// leaves out.
type Todo = { id: string; title: string; due?: string; reminder?: string; time?: [string, string]; space?: string; done?: boolean };
type Case = { case: string; day: string; events?: string[]; todos: string[]; limit?: number; hidden?: string; at?: string; lines: string[]; more?: number };
const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "calendar-reminders-cases.json"), "utf8")) as {
  spaces: Record<string, unknown>;
  rules: Record<string, unknown>;
  events: Record<string, { title: string; allDay?: boolean; start: string; end: string }>;
  todos: Record<string, Todo>;
  now: string;
  cells: Case[];
  week: Case[];
  day: Case[];
  tooltips: ({ case: string; day: string; todo: string; kind: DayTask["kind"] } & Record<Lang, string>)[];
};

/** "2026-11-10 15:00" on this PC's wall clock. */
const moment = (text: string) => {
  const [y, m, d, hh, mm] = text.split(/[- :]/).map(Number);
  return new Date(y, m - 1, d, hh, mm);
};
const pad = (n: number) => String(n).padStart(2, "0");
const dayOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const todo = (name: string) => {
  const entry = file.todos[name];
  return {
    id: entry.id, title: entry.title, isCompleted: entry.done ?? false,
    ...(entry.due ? { dueDate: entry.due } : {}),
    ...(entry.reminder ? { reminderAt: moment(entry.reminder).toISOString() } : {}),
    ...(entry.time ? { timeStart: entry.time[0], timeEnd: entry.time[1] } : {}),
  };
};
const event = (name: string): CalendarEvent => {
  const entry = file.events[name];
  return { key: `local/${name}`, calendarId: "local", title: entry.title, allDay: entry.allDay ?? false, start: moment(entry.start), end: moment(entry.end), color: "#5b8def", eventId: name, canEdit: true, recurring: false };
};
// The spaces file, each to-do placed in its space (none: 일반).
const spaces = parseTodoSpaces(JSON.stringify({
  ...file.spaces,
  items: Object.fromEntries(Object.values(file.todos).filter((entry) => entry.space).map((entry) => [entry.id, { space: entry.space, at: "2026-11-01T00:00:00Z" }])),
}));
const now = moment(file.now);
/** The case's to-dos as the calendar gets them: without the ones its rule hides at its time (as calendarWindow.ts's items). */
function todos(entry: Case) {
  const all = entry.todos.map(todo);
  if (!entry.hidden) return all;
  const hidden = hiddenSpaces(readDeviceRules(file.rules[entry.hidden]), spaces, entry.at ? moment(entry.at) : now);
  return all.filter((item) => !isHiddenSpace(spaces.items[item.id]?.space, hidden, spaces));
}
const line = (item: CellItem) => (item.kind === "event" ? `event ${item.event.title}` : `${item.task.kind} ${item.task.title}`);
const timed = (task: DayTask) => `${task.kind} ${task.kind === "deadline" ? "-" : task.time} ${task.title}`;

for (const entry of file.cells) {
  test(entry.case, () => {
    const cell = cellItems(entry.day, (entry.events ?? []).map(event), todos(entry), entry.limit);
    assert.deepEqual(cell.items.map(line), entry.lines);
    assert.equal(cell.more, entry.more);
  });
}
for (const entry of file.week) {
  test(entry.case, () => assert.deepEqual(weekOrder(dayTasks(entry.day, todos(entry), "ko", dayOf(now))).map(timed), entry.lines));
}
for (const entry of file.day) {
  test(entry.case, () => assert.deepEqual(dayTasks(entry.day, todos(entry), "ko", dayOf(now)).map(timed), entry.lines));
}
for (const entry of file.tooltips) {
  test(entry.case, () => {
    for (const lang of ["ko", "en", "nl"] as const) {
      const id = file.todos[entry.todo].id;
      const tasks = [...weekOrder(dayTasks(entry.day, [todo(entry.todo)], lang, dayOf(now))),
        ...cellItems(entry.day, [], [todo(entry.todo)], 99, lang).items.flatMap((item) => (item.kind === "task" ? [item.task] : []))];
      const task = tasks.find((candidate) => candidate.taskId === id && candidate.kind === entry.kind);
      assert.ok(task, `${lang}: no ${entry.kind}`);
      assert.equal(taskTooltip(task, lang), entry[lang], lang);
    }
  });
}
