import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import type { CalendarEvent } from "../src/core/calendar";
import {
  agenda, backing, bolder, floorOf, rgbOf, tile, weekendTint, candidateDay, chipParts, dayLines, dots, drawnOpacity, earOpacity, earScale, edgeStrength, emptyText, frameFor, halo, hitTarget,
  inkOnly, inside, monthCell, moreLabel, newPlace, nextRedraw, pageDays, pageOffset, placeOf, quickCandidates, readOpacity, readWidgets, sheetLines,
  sheetTitle, snap, stepDay, upcoming, weekRow, widgetAddedText, widgetName, widgetSize, widgetToday, windowSize, writeWidgets,
  readScale, scaleFits, scaleName, shownScale, widgetScales,
  type Box, type WidgetKind, type WidgetLine, type WidgetScreen, type WidgetStyle,
} from "../src/core/calendarWidget";
import { colorHex, eventColors, type EventColor } from "../src/core/events";
import type { Candidate } from "../src/core/intent";
import type { Lang } from "../src/core/lang";
import type { TodoItem } from "../src/core/notebook";
import { addedHidden, hiddenSpaces, isHiddenSpace, readDeviceRules } from "../src/core/spaceDevice";
import { parseTodoSpaces, readSpaceLine } from "../src/core/todoSpaces";

// 바탕화면 달력 위젯 (#234): the shared cases from docs/plans/calendar-widget-cases.json (the Mac's
// scripts/test-calendar-widget.sh reads the same file) — what each kind shows, the day sheet, the opacity rules, places on
// displays, the quick entry's reading, the stored settings and when a widget draws again.
type Json = Record<string, unknown>;
const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "calendar-widget-cases.json"), "utf8")) as Json;
const langs: Lang[] = ["ko", "en", "nl"];

/** "2026-11-06T15:00:00" on this PC's wall clock. */
const moment = (text: string) => {
  const [y, m, d, hh, mm, ss] = text.split(/[-T:]/).map(Number);
  return new Date(y, m - 1, d, hh, mm, ss || 0);
};
const pad = (n: number) => String(n).padStart(2, "0");
const stamp = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;

type Todo = { id: string; title: string; dueDate?: string; reminderAt?: string; time?: [string, string]; space?: string; done?: boolean };
const pool = file.todos as Record<string, Todo>;
const todo = (name: string): TodoItem => {
  const entry = pool[name];
  return {
    id: entry.id, title: entry.title, isCompleted: entry.done ?? false, createdAt: "2026-11-01T00:00:00.000Z",
    ...(entry.dueDate ? { dueDate: entry.dueDate } : {}),
    ...(entry.reminderAt ? { reminderAt: moment(entry.reminderAt).toISOString() } : {}),
    ...(entry.time ? { timeStart: entry.time[0], timeEnd: entry.time[1] } : {}),
  } as TodoItem;
};
const eventPool = file.events as Record<string, { title: string; allDay?: boolean; start: string; end: string; color: EventColor }>;
const colorName = new Map(eventColors.map((entry) => [entry.hex, entry.value]));
const event = (name: string): CalendarEvent => {
  const entry = eventPool[name];
  return { key: `local/${name}`, calendarId: "local", title: entry.title, allDay: entry.allDay ?? false, start: moment(entry.start), end: moment(entry.end), color: colorHex(entry.color), eventId: name, canEdit: true, recurring: false };
};
const spaces = parseTodoSpaces(JSON.stringify({
  ...(file.spaces as Json),
  items: Object.fromEntries(Object.values(pool).filter((entry) => entry.space).map((entry) => [entry.id, { space: entry.space, at: "2026-11-01T00:00:00Z" }])),
}));
const baseNow = moment(file.now as string);
const hidden = hiddenSpaces(readDeviceRules(file.rules), spaces, baseNow);
/** The to-dos as a widget gets them: without the ones this PC hides. */
const here = (names: string[]) => names.map(todo).filter((item) => !isHiddenSpace(spaces.items[item.id]?.space, hidden, spaces));
function set(entry: Json): { events: CalendarEvent[]; todos: TodoItem[] } {
  const use = file[(entry.use as string | undefined) ?? "base"] as { events: string[]; todos: string[] };
  return { events: use.events.map(event), todos: here(use.todos) };
}
const text = (line: WidgetLine) => (line.time ? `${line.kind} ${line.time} ${line.title}` : `${line.kind} ${line.title}`);
const dot = (color: string) => colorName.get(color) ?? color;

for (const entry of file.kinds as Json[]) {
  test(entry.case as string, () => {
    const now = entry.now ? moment(entry.now as string) : baseNow;
    const today = widgetToday(now);
    const data = set(entry);
    if (entry.sizes) {
      for (const [kind, style, width, height, scale] of entry.sizes as [WidgetKind, WidgetStyle, number, number, number][]) {
        assert.deepEqual(widgetSize(kind, style), { width, height }, `${kind} ${style}`);
        assert.equal(earScale(kind, style), scale);
        assert.equal(windowSize(kind, style).height, height + 16 * scale);
      }
      return;
    }
    if (entry.names) {
      for (const [kind, style, ...words] of entry.names as string[][]) {
        langs.forEach((lang, index) => assert.equal(widgetName(kind as WidgetKind, style as WidgetStyle, lang), words[index]));
      }
      return;
    }
    const kind = entry.kind as WidgetKind;
    const days = pageDays(kind, today);
    if (entry.lines) {
      const up = upcoming(today, data.events, data.todos, now, kind === "week" ? 2 : 3);
      assert.deepEqual(up.lines.map(text), entry.lines);
      if (entry.more !== undefined) assert.equal(up.more, entry.more);
    }
    if (entry.dots) {
      const plus = new Set(entry.plus as string[]);
      for (const [day, want] of Object.entries(entry.dots as Record<string, string[]>)) {
        const found = dots(day, data.events, data.todos);
        assert.deepEqual(found.colors.map(dot), want, `dots ${day}`);
        assert.equal(found.plus, plus.has(day), `plus ${day}`);
      }
      assert.equal(days.length, kind === "week" ? 7 : 42);
    }
    if (entry.rows) {
      for (const [day, want] of Object.entries(entry.rows as Record<string, [string, number] | null>)) {
        const row = weekRow(day, data.events, data.todos);
        if (want) { assert.equal(row.first ? text(row.first) : "-", want[0], `row ${day}`); assert.equal(row.more, want[1]); } else assert.equal(row.first, undefined);
      }
    }
    if (entry.cells) {
      for (const [day, want] of Object.entries(entry.cells as Record<string, [string[], number]>)) {
        const cell = monthCell(day, data.events, data.todos, "ko", (entry.style as WidgetStyle | undefined) ?? "detail");
        assert.deepEqual(cell.lines.map(text), want[0], `cell ${day}`);
        assert.equal(cell.more, want[1]);
      }
    }
    if (entry.days) {
      const found = agenda(today, data.events, data.todos, now);
      assert.deepEqual(found.map((part) => part.day), (entry.days as [string, string[]][]).map((part) => part[0]));
      found.forEach((part, index) => assert.deepEqual(part.lines.map(text), (entry.days as [string, string[]][])[index][1]));
    }
    if (entry.absent) {
      const ids = new Set((entry.absent as string[]).map((name) => pool[name].id));
      for (const each of ["today", "week", "month", "agenda"] as const) {
        const lines: WidgetLine[] = [];
        for (const day of pageDays(each, today)) {
          lines.push(...dayLines(day, data.events, data.todos, now), ...monthCell(day, data.events, data.todos).lines);
          const first = weekRow(day, data.events, data.todos).first;
          if (first) lines.push(first);
        }
        assert.equal(lines.some((line) => line.taskId !== undefined && ids.has(line.taskId)), false, `absent in ${each}`);
      }
    }
    if (entry.empty) {
      assert.equal(upcoming(today, data.events, data.todos, now).lines.length, 0);
      const words = entry.text as Record<Lang, string>;
      for (const lang of langs) assert.equal(emptyText(lang), words[lang]);
    }
  });
}

for (const entry of file.sheet as Json[]) {
  test(entry.case as string, () => {
    const data = set(entry);
    if (entry.steps) {
      for (const [from, by, want] of entry.steps as [string, number, string][]) assert.equal(stepDay(from, by), want);
      return;
    }
    if (entry.labels) {
      assert.ok(hitTarget >= (entry.target as number));
      for (const lang of langs) assert.equal(moreLabel(entry.count as number, lang), (entry.labels as Record<Lang, string>)[lang]);
      return;
    }
    const day = entry.day as string;
    if (entry.titles) {
      for (const lang of langs) assert.equal(sheetTitle(day, lang), (entry.titles as Record<Lang, string>)[lang]);
      return;
    }
    const sheet = sheetLines(day, data.events, data.todos, baseNow);
    if (entry.lines) assert.deepEqual(sheet.map(text), entry.lines);
    if (entry.shown !== undefined) {
      const cell = monthCell(day, data.events, data.todos);
      assert.equal(cell.lines.length, entry.shown);
      assert.equal(cell.more, entry.more);
      assert.equal(sheet.length, entry.sheetCount);
      assert.equal(cell.lines.length + cell.more, sheet.length, "+N opens all");
    }
    if (entry.first) {
      const row = weekRow(day, data.events, data.todos);
      assert.equal(row.first ? text(row.first) : "-", entry.first);
      assert.equal(row.more, entry.more);
    }
    if (entry.absent) {
      const ids = new Set((entry.absent as string[]).map((name) => pool[name].id));
      assert.equal(sheet.some((line) => line.taskId !== undefined && ids.has(line.taskId)), false);
    }
  });
}

// The papers of #244 (docs/plans/paper-themes/tokens.json): each paper's floor from its own paper and ink.
type Paper = { key: string; scheme: string; note: Record<string, string> };
const papers = (JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "paper-themes", "tokens.json"), "utf8")) as { papers: Paper[] }).papers;
const floorFor = (key: string) => {
  const paper = papers.find((entry) => entry.key === key)!;
  return floorOf(rgbOf(paper.note.paper), rgbOf(paper.note.ink), paper.scheme === "dark");
};

for (const entry of file.opacity as Json[]) {
  test(entry.case as string, () => {
    if (entry.tintedFloors) {
      for (const [key, want] of Object.entries(entry.tintedFloors as Record<string, number>)) {
        const paper = papers.find((item) => item.key === key)!;
        const tint = weekendTint(rgbOf(paper.note.clay2), rgbOf(paper.note.paper));
        assert.equal(floorOf(tint, rgbOf(paper.note.ink), paper.scheme === "dark"), want, `tinted ${key}`);
      }
      return;
    }
    if (entry.todayRing) {
      assert.deepEqual((entry.opacity as number[]).map(halo), entry.todayRing);
      return;
    }
    if (entry.floors) {
      for (const [key, want] of Object.entries(entry.floors as Record<string, number>)) assert.equal(floorFor(key), want, `floor ${key}`);
      assert.deepEqual(Object.keys(entry.floors as Json).sort(), papers.map((paper) => paper.key).sort());
      return;
    }
    if (entry.read) assert.deepEqual((entry.read as number[]).map(readOpacity), entry.want);
    if (Array.isArray(entry.opacity)) {
      const values = entry.opacity as number[];
      const floor = floorFor((entry.paper as string | undefined) ?? "day");
      if (entry.backing) assert.deepEqual(values.map((value) => backing(value, floor)), entry.backing);
      if (entry.tile) assert.deepEqual(values.map(tile), entry.tile);
      if (entry.inkOnly) assert.deepEqual(values.map(inkOnly), entry.inkOnly);
      if (entry.ear) assert.deepEqual(values.map(earOpacity), entry.ear);
      if (entry.bolder) assert.deepEqual(values.map(bolder), entry.bolder);
      if (entry.halo) assert.deepEqual(values.map(halo), entry.halo);
      if (entry.edge) assert.deepEqual(values.map(edgeStrength), entry.edge);
    } else if (typeof entry.opacity === "number") {
      const value = entry.opacity;
      if (entry.reduceTransparency) assert.equal(drawnOpacity(value, true, false, false), entry.drawn);
      if (entry.solidOnHover) {
        assert.deepEqual((entry.solidOnHover as boolean[]).map((solid) => drawnOpacity(value, false, true, solid)), entry.drawn);
        assert.equal(drawnOpacity(value, false, false, true), value);
      }
    }
  });
}

const placeFile = file.place as { screens: Record<string, { id: string; area: number[] }>; size: [number, number]; cases: Json[] };
const box = (a: number[]): Box => ({ x: a[0], y: a[1], width: a[2], height: a[3] });
const screens = Object.fromEntries(Object.entries(placeFile.screens).map(([name, entry]) => [name, { id: entry.id, area: box(entry.area) } satisfies WidgetScreen]));
const place = (a: [string, number, number]) => ({ display: a[0], x: a[1], y: a[2] });
const [width, height] = placeFile.size;
for (const entry of placeFile.cases) {
  test(entry.case as string, () => {
    const list = ((entry.screens as string[] | undefined) ?? ["main"]).map((name) => screens[name]);
    if (entry.of) assert.deepEqual(placeOf(box(entry.of as number[]), list), place(entry.place as [string, number, number]));
    else if (entry.place && entry.frame) assert.deepEqual(frameFor(place(entry.place as [string, number, number]), width, height, list), box(entry.frame as number[]));
    for (const key of ["inside", "inside2"]) {
      const pair = entry[key] as number[][] | undefined;
      if (pair) assert.deepEqual(inside(box(pair[0]), screens.main.area), box(pair[1]));
    }
    for (const one of (entry.snaps as Json[] | undefined) ?? []) {
      assert.deepEqual(snap(box(one.frame as number[]), screens.main.area, (one.others as number[][]).map(box)), box(one.want as number[]));
    }
    for (const one of (entry.news as Json[] | undefined) ?? []) {
      assert.deepEqual(newPlace(width, height, screens.main, (one.others as number[][]).map(box)), place(one.place as [string, number, number]));
    }
  });
}

// 크기 (#271)
const scaleFile = file.scale as { steps: number[]; cases: Json[] };
const near = (got: number, want: number, name: string) => assert.ok(Math.abs(got - want) <= 0.005, `${name}: expected ${want}, got ${got}`);
test("Z0 네 단계", () => assert.deepEqual([...widgetScales], scaleFile.steps));
for (const entry of scaleFile.cases) {
  test(entry.case as string, () => {
    if (entry.read) assert.deepEqual((entry.read as number[]).map(readScale), entry.want);
    for (const [scale, ...words] of (entry.names as [number, ...string[]][] | undefined) ?? []) {
      langs.forEach((lang, index) => assert.equal(scaleName(scale, lang), words[index]));
    }
    for (const [kind, style, scale, w, h] of (entry.windows as [WidgetKind, WidgetStyle, number, number, number][] | undefined) ?? []) {
      const window = windowSize(kind, style, scale);
      near(window.width, w, `width ${kind} ${style} ${scale}`);
      near(window.height, h, `height ${kind} ${style} ${scale}`);
    }
    if (entry.areas && entry.fits) {
      for (const [name, area] of Object.entries(entry.areas as Record<string, number[]>)) {
        for (const [key, want] of Object.entries(entry.fits as Record<string, boolean[]>)) {
          const [kind, style] = key.split("-") as [WidgetKind, WidgetStyle];
          assert.deepEqual(widgetScales.map((scale) => scaleFits(kind, style, scale, box(area))), want, `fits ${key} ${name}`);
        }
      }
    }
    for (const [kind, style, scale, want] of (entry.shown as [WidgetKind, WidgetStyle, number, number][] | undefined) ?? []) {
      assert.equal(shownScale(scale, kind, style, box(entry.area as number[])), want, `shown ${kind} ${style} ${scale}`);
    }
    for (const [scale, want] of (entry.frames as [number, number[]][] | undefined) ?? []) {
      const window = windowSize(entry.kind as WidgetKind, entry.style as WidgetStyle, scale);
      const frame = frameFor(place(entry.place as [string, number, number]), window.width, window.height, [{ id: "1", area: box(entry.area as number[]) }]);
      [frame.x, frame.y, frame.width, frame.height].forEach((got, index) => near(got, want[index], `frame ${scale}`));
    }
  });
}

const chipLine = (candidate: Candidate, now: Date, lang: Lang = "ko") => {
  const parts = chipParts(candidate, now, lang);
  return parts.when ? `${candidate.kind} ${parts.when}` : candidate.kind;
};
for (const entry of file.quickAdd as Json[]) {
  test(entry.case as string, () => {
    const now = baseNow;
    if (entry.reads) {
      for (const [line, lens, want, rest] of entry.reads as [string, string | null, string | null, string][]) {
        const reading = readSpaceLine(line, spaces, lens ?? undefined);
        const first = reading.choices[0];
        assert.equal(first?.kind === "space" ? first.id : null, want);
        assert.equal(reading.text.trim(), rest);
      }
      return;
    }
    if (entry.toasts) {
      for (const [day, kind, ...words] of entry.toasts as string[][]) {
        langs.forEach((lang, index) => assert.equal(widgetAddedText(day, kind === "event", now, lang), words[index]));
      }
      return;
    }
    if (entry.toast) {
      const reading = readSpaceLine(entry.text as string, spaces, undefined);
      const first = reading.choices[0];
      assert.ok(first?.kind === "space");
      assert.equal(first.id, entry.space);
      assert.equal(isHiddenSpace(first.id, hidden, spaces), true);
      assert.equal(addedHidden(spaces.spaces.find((space) => space.id === first.id)!.name, "ko"), entry.toast);
      return;
    }
    if (entry.langs) {
      for (const [lang, line, chips] of entry.langs as [Lang, string, string[]][]) {
        assert.deepEqual(quickCandidates(line, entry.day as string, now, lang).map((candidate) => chipLine(candidate, now, lang)), chips, lang);
      }
      return;
    }
    const day = entry.day as string;
    if (entry.texts) {
      for (const [line, chips] of entry.texts as [string, string[]][]) assert.deepEqual(quickCandidates(line, day, now).map((candidate) => chipLine(candidate, now)), chips, line);
      return;
    }
    const found = quickCandidates(entry.text as string, day, now);
    if (entry.chips) assert.deepEqual(found.map((candidate) => chipLine(candidate, now)), entry.chips);
    if (entry.first) assert.equal(found[0]?.kind, entry.first);
    if (entry.want && found[0]?.kind === "event") {
      const first = found[0];
      const [y, m, d] = first.day.split("-").map(Number);
      assert.equal(stamp(new Date(y, m - 1, d, 0, first.start)), entry.want);
    }
    if (entry.made && found[0]?.kind === "todo") {
      const made = entry.made as Record<string, string>;
      assert.equal(found[0].title, made.title);
      assert.equal(found[0].dueDate, made.dueDate);
      assert.equal(found[0].reminderAt ? stamp(found[0].reminderAt) : undefined, made.reminderAt);
      assert.equal(candidateDay(found[0], now), made.dueDate ?? made.reminderAt?.slice(0, 10));
    }
  });
}

for (const entry of file.settings as Json[]) {
  test(entry.case as string, () => {
    const read = readWidgets(entry.read);
    if (entry.ids) assert.deepEqual(read.map((widget) => widget.id), entry.ids);
    if (entry.styles) assert.deepEqual(read.map((widget) => widget.style), entry.styles);
    if (entry.scales) assert.deepEqual(read.map((widget) => widget.scale), entry.scales);
    if (entry.want) {
      const written = writeWidgets(read);
      assert.deepEqual(JSON.parse(JSON.stringify(written)), entry.want);
      assert.deepEqual(readWidgets(JSON.parse(JSON.stringify(written))), read);
    }
  });
}

for (const entry of file.redraw as Json[]) {
  test(entry.case as string, () => {
    if (entry.offsets) {
      const touched = moment(entry.touched as string);
      for (const [at, offset, want] of entry.offsets as [string, number, number][]) assert.equal(pageOffset(offset, touched, moment(at)), want);
      return;
    }
    if (entry.today) {
      assert.equal(widgetToday(moment(entry.now as string)), entry.today);
      const month = entry.month as Record<string, string>;
      assert.equal(stamp(nextRedraw("month", moment(month.now), [])), month.next);
      return;
    }
    const now = entry.now ? moment(entry.now as string) : baseNow;
    const data = set(entry);
    const lines = dayLines(widgetToday(now), data.events, data.todos, now);
    assert.equal(stamp(nextRedraw(entry.kind as WidgetKind, now, lines)), entry.next);
  });
}
