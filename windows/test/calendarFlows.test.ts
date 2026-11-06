import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { bandKey, bands, cellTwoLines, eventsOn, hyphenates, lineFit, monthGrid, twoLineTitles, weekDays, weekdayLabels, type Band, type CalendarEvent, type LineFit } from "../src/core/calendar";
import { holidayWord, lineOver, sheetLines, showsLunar } from "../src/core/calendarWidget";
import { dayFor } from "../src/core/deadline";
import { colorHex, type EventColor } from "../src/core/events";
import { holidayLabel, holidayName, holidayShown, type HolidayName } from "../src/core/koreanCalendar";
import { firstDayFromIntl, firstDayFromRegistry, setWeekStart, weekStartFrom, weekStartsMonday, type Lang } from "../src/core/lang";
import type { TodoItem } from "../src/core/notebook";

// 달력을 실제로 쓰는 흐름 (docs/plans/calendar-flows.md): the shared cases from docs/plans/calendar-flows-cases.json (the
// Mac's scripts/test-calendar-flows.sh reads the same file) — the all-day order that keeps a trip's band in place, which
// days draw an event as a band and how bands join along a week row, which cut titles take a second line, the week's
// first day from the system, and the day sheet's holiday line and faded lines.
type Json = Record<string, any>;
const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "calendar-flows-cases.json"), "utf8")) as Json;
const langs: Lang[] = ["ko", "en", "nl"];

/** "2026-11-06T15:00:00" on this PC's wall clock. */
const moment = (text: string) => {
  const [y, m, d, hh, mm, ss] = text.split(/[-T:]/).map(Number);
  return new Date(y, m - 1, d, hh, mm, ss || 0);
};
type EventEntry = { title: string; allDay?: boolean; start: string; end: string; color: EventColor };
const eventOf = (name: string, entry: EventEntry): CalendarEvent => ({
  key: `local/${name}`, calendarId: "local", title: entry.title, allDay: entry.allDay ?? false, start: moment(entry.start), end: moment(entry.end),
  color: colorHex(entry.color), eventId: name, canEdit: true, recurring: false,
});
const pool = file.events as Record<string, EventEntry>;
const now = moment(file.now);
const written = (band: Band) => `${band.run}${band.fromLeft ? "<" : ""}${band.toRight ? ">" : ""}`;

for (const entry of file.order.cases) {
  test(entry.case, () => {
    const events = (entry.events as string[]).map((name) => eventOf(name, pool[name]));
    assert.deepEqual(eventsOn(entry.day, events).map((event) => event.title), entry.titles);
  });
}

for (const entry of file.bands.cases) {
  test(entry.case, () => {
    const found = eventOf(entry.event, pool[entry.event]);
    for (const [day, band] of Object.entries(entry.days as Record<string, boolean>)) assert.equal(bandKey(found, day) !== undefined, band, day);
  });
}

for (const entry of file.runs.cases) {
  test(entry.case, () => {
    assert.deepEqual(bands(entry.rows).map((row) => row.map(written)), entry.runs);
    if (entry.next) assert.deepEqual(bands(entry.next.rows).map((row) => row.map(written)), entry.next.runs, "next row");
  });
}

for (const entry of file.twoLines.cases) {
  test(entry.case, () => assert.deepEqual(twoLineTitles(entry.room, entry.lines as LineFit[]), entry.two));
}

// #260: a holiday's name by the same rule, and where English and Dutch break a long word.
for (const entry of file.twoLines.holiday.cases) {
  test(entry.case, () => assert.deepEqual(cellTwoLines(entry.room, entry.holiday ?? undefined, entry.lines as LineFit[]), entry.two));
}
test("K0 하이픈으로 나누는 언어", () => {
  for (const [code, value] of Object.entries(file.twoLines.breaks.hyphenates as Record<Lang, boolean>)) assert.equal(hyphenates(code as Lang), value, code);
});
for (const entry of file.twoLines.breaks.cases) {
  test(entry.case, () => assert.equal(lineFit(entry.overflows, entry.betweenWords, entry.inWord, entry.lang), entry.fit));
}
test("K9 공휴일 이름은 정해 둔 자리에서 나눠요", () => {
  for (const [key, marked] of Object.entries(file.twoLines.breaks.holidays as Record<string, [string, string] | string>)) {
    if (key === "about") continue;
    const name = key as HolidayName;
    const [en, nl] = marked as [string, string];
    assert.equal(holidayShown(name, "en").replace(/\u00ad/g, "|"), en, `en ${key}`);
    assert.equal(holidayShown(name, "nl").replace(/\u00ad/g, "|"), nl, `nl ${key}`);
    assert.deepEqual([en, nl].map((text) => text.replace(/\|/g, "")), [holidayName(name, "en"), holidayName(name, "nl")], `same name ${key}`);
    assert.equal(holidayShown(name, "ko"), holidayName(name, "ko"), `ko ${key}`);
  }
  assert.equal(holidayLabel("2026-10-09", "nl", true), "Han\u00adgeul\u00addag");
});

for (const entry of file.weekStart.cases) {
  test(entry.case, () => {
    assert.equal(weekStartFrom(entry.system, entry.lang), entry.monday);
    setWeekStart(entry.system ?? undefined);
    try {
      assert.equal(weekStartsMonday(entry.lang), entry.monday, "as set");
    } finally {
      setWeekStart(undefined);
    }
  });
}

for (const entry of file.weekStart.grid) {
  test(entry.case, () => {
    setWeekStart(entry.monday ? "monday" : "sunday");
    try {
      if (entry.year) {
        assert.equal(monthGrid(entry.year, entry.month, entry.lang)[0], entry.first);
        assert.deepEqual(weekdayLabels(entry.lang), entry.labels);
      }
      if (entry.week) {
        const days = weekDays(entry.week, entry.lang);
        assert.deepEqual([days[0], days[6]], entry.days, "week view");
        assert.equal(dayFor({ kind: "thisWeek" }, moment(`${entry.week}T12:00:00`), entry.lang), entry.days[1], "이번 주 안");
      }
    } finally {
      setWeekStart(undefined);
    }
  });
}

test("F9 Windows: 레지스트리의 iFirstDayOfWeek와 Intl의 firstDay를 요일 이름으로 읽어요", () => {
  for (const entry of file.weekStart.readers.registry) assert.equal(firstDayFromRegistry(entry.value) ?? null, entry.day, `registry ${entry.value}`);
  for (const entry of file.weekStart.readers.intl) assert.equal(firstDayFromIntl(entry.value) ?? null, entry.day, `intl ${entry.value}`);
  assert.equal(firstDayFromRegistry(undefined), undefined);
  assert.equal(firstDayFromIntl(0), undefined);
});

for (const entry of file.sheet.holiday) {
  test(entry.case, () => {
    langs.forEach((lang, index) => {
      assert.equal(holidayWord(lang), entry.word[index], `word ${lang}`);
      assert.equal(holidayLabel(entry.day, lang) ?? null, entry.name[index], `name ${lang}`);
    });
  });
}

test(file.sheet.over.case, () => {
  const over = file.sheet.over;
  const events = Object.entries(over.events as Record<string, EventEntry>).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, entry]) => eventOf(name, entry));
  const tasks = Object.entries(over.todos as Record<string, { id: string; title: string; reminderAt?: string; dueDate?: string }>).sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, entry]) => ({
      id: entry.id, title: entry.title, isCompleted: false, createdAt: "2026-11-01T00:00:00.000Z",
      ...(entry.dueDate ? { dueDate: entry.dueDate } : {}), ...(entry.reminderAt ? { reminderAt: moment(entry.reminderAt).toISOString() } : {}),
    }) as TodoItem);
  const lines = sheetLines(over.day, events, tasks, now);
  assert.deepEqual(lines.map((line) => line.title), over.lines);
  assert.deepEqual(lines.map((line) => lineOver(line, now)), over.over);
});

for (const entry of file.lunar.cases) {
  test(entry.case, () => assert.equal(showsLunar(entry.lunarDay, entry.width, entry.moreInHead), entry.shows));
}
