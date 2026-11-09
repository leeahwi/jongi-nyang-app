import { agendaTime, allDayText, bandKey, bands, cellTwoLines, foldedTooltip, lineFit, mayWrap, repeatItems, repeatWord, taskSpoken, taskTooltip, type Band, type CellItem, type DayTask, type LineFit } from "../core/calendar";
import { headFit, showsLunar } from "../core/calendarWidget";
import { key as dayKey } from "../core/deadline";
import type { TodoItem } from "../core/notebook";
import { deviceKey, hiddenSpaces, readDeviceRules } from "../core/spaceDevice";
import { seriesSpaceOf, spaceIndexOf } from "../core/todoSpaces";
import type { Series } from "../core/repeat";
import type { TodosState } from "../core/types";
import { holidayLabel, lunarLabel, lunarOf, lunarSpoken } from "../core/koreanCalendar";
import { eventMark } from "../core/events";
import type { Prefs } from "../core/types";
import { h, icon, lang, t } from "./api";

/**
 * 달력의 칸 (#234): the month cells' and week rows' lines, drawn the same in the desk's 달력 (calendarWindow.ts) and the
 * desktop calendar widgets (widget.ts) — an event's colour bar and title, a deadline's flag, a reminder's bell, a cell's
 * dots when it is very narrow — and the to-dos both show (without the spaces this PC hides now).
 */

/**
 * The to-dos the calendar shows: #227, without the ones this PC hides now (as the 오늘 창 — a peek on the note doesn't
 * reach here).
 */
export function hereTasks(state: Pick<TodosState, "items" | "prefs" | "todoSpaces" | "spaceOf">, now = new Date()): readonly TodoItem[] {
  const hidden = hiddenSpaces(readDeviceRules(state.prefs.spaceDevice), state.todoSpaces, now);
  const spaces = hidden.size ? spaceIndexOf(state.todoSpaces.spaces, state.spaceOf) : undefined;
  return spaces ? state.items.filter((item) => !hidden.has(deviceKey(spaces.get(item.id)?.id))) : state.items;
}

/** #274: the repeating to-dos the calendar draws ahead, without the ones whose rule's space this PC hides now. */
export function hereSeries(state: Pick<TodosState, "series" | "prefs" | "todoSpaces">, now = new Date()): readonly Series[] {
  const hidden = hiddenSpaces(readDeviceRules(state.prefs.spaceDevice), state.todoSpaces, now);
  return hidden.size ? state.series.filter((entry) => !hidden.has(deviceKey(seriesSpaceOf(state.todoSpaces, entry.id)))) : state.series;
}

/**
 * #274: the to-dos the calendar shows on `days` (`hereTasks`), with the days the repeating ones come back on (`repeatItems`:
 * stand-ins the cells and the day lists draw as faded repeats).
 */
export function calendarTasks(state: Pick<TodosState, "items" | "series" | "prefs" | "todoSpaces" | "spaceOf">, days: Iterable<string>, now = new Date()): readonly TodoItem[] {
  return repeatItems(hereTasks(state, now), hereSeries(state, now), days, now, lang()) as readonly TodoItem[];
}

/** #274: a to-do line's icon: a deadline's flag, a reminder's bell, a repeat's arrows. */
const taskIcon = (task: DayTask) => (task.kind === "repeat" ? "repeat" : task.kind === "reminder" ? "bell" : task.kind === "range" ? "clock" : "flag");

/**
 * #234: what a day carries besides its things — the lunar date ("8.21", "음 9.1") and its spoken form, and Korea's holiday
 * name ("한글날", "어린이날 · 부처님오신날") — each only while its switch is on (책상 → 일정 → 달력, this PC).
 */
export function dayMarks(day: string, prefs: Pick<Prefs, "calendarLunar" | "calendarHolidays">): { lunar?: string; lunarShort?: string; lunarSpoken?: string; lunarDay?: number; holiday?: string; holidayShown?: string } {
  const lunar = prefs.calendarLunar !== false ? lunarOf(day) : undefined;
  const holiday = prefs.calendarHolidays !== false ? holidayLabel(day, lang()) : undefined;
  return {
    // #295 `lunarShort`: the 1st without its mark ("10.1"), where the head is short of room.
    ...(lunar ? { lunar: lunarLabel(lunar, lang()), lunarShort: lunarLabel(lunar, lang(), true), lunarSpoken: lunarSpoken(lunar, lang()), lunarDay: lunar.day } : {}),
    // #260: `holidayShown` — the name as a month cell draws it, with the places it may break.
    ...(holiday ? { holiday, holidayShown: holidayLabel(day, lang(), true) } : {}),
  };
}

/** A deadline on this day or before it is due or late (clay); a later one is a quiet ink flag. */
export const lateOn = (day: string): boolean => day <= dayKey(new Date());

/**
 * One line in a month cell: an event (its colour bar and its title; the time is in the tooltip and the
 * day panel, so the title keeps the room), a deadline (a flag and the title) or a reminder (#227: a bell and the title).
 * calendar-flows D1: a band (`band`, from `weekBands`) joined to the day before has no bar of its own and squared
 * corners there; where an earlier day's title runs over it (run 0) it is the tint only; where its title runs on over
 * the next days (run > 1) the title is laid over them (`fitTitles`).
 */
export function cellLine(item: CellItem, day: string, band?: Band, lane?: number): HTMLElement {
  if (item.kind === "task") {
    const task = item.task;
    // #274: a repeat's arrows, faded after the next one (its spoken name says so).
    const kind = task.kind === "repeat" ? `item repeat${task.ahead ? " ahead" : ""}` : task.kind === "reminder" ? "item reminder" : `item deadline${lateOn(day) ? " late" : ""}`;
    const line = h("div", { class: kind, title: taskTooltip(task, lang()), ...(task.kind === "repeat" ? { "aria-label": taskSpoken(task, lang()) } : {}) },
      icon(taskIcon(task), 10, 2), h("span", { class: "t" }, task.title));
    if (lane !== undefined) line.dataset.lane = String(lane);
    // #296: a faded repeat keeps one line (the spare lines go to the events and to-dos).
    if (!mayWrap(item)) line.dataset.nowrap = "true";
    return line;
  }
  const event = item.event;
  const when = agendaTime(event, day, lang());
  // All day (or across the whole day): a tint of its colour.
  const spansDay = when === allDayText(lang());
  const classes = ["item", spansDay ? "all-day" : "", band?.fromLeft ? "joins-left" : "", band?.toRight ? "joins-right" : "",
    band && band.run === 0 ? "cont" : "", band && band.run > 1 ? "runs" : ""].filter(Boolean).join(" ");
  const line = h("div", { class: classes, title: `${when} · ${event.title}` },
    band?.fromLeft ? null : h("span", { class: "bar evc", "aria-hidden": "true" }),
    h("span", { class: "t", ...(band && band.run === 0 ? { "aria-hidden": "true" } : {}) }, event.title));
  line.style.setProperty("--color", eventMark(event.color));
  if (lane !== undefined) line.dataset.lane = String(lane);
  if (band && band.run > 1) line.dataset.run = String(band.run);
  if (band && (band.fromLeft || band.toRight || band.run > 1)) line.dataset.joined = "true";
  return line;
}

/**
 * calendar-flows D1: a week row's bands from the lines each day draws — a holiday's name first (it takes the first
 * line, so a band below it is not beside the next day's), then the cell's items, each its band key or none.
 */
export function weekBands(cells: readonly { day: string; holiday: boolean; items: readonly CellItem[] }[]): Band[][] {
  const rows = cells.map((cell) => [
    ...(cell.holiday ? [null] : []),
    ...cell.items.map((item) => (item.kind === "event" ? bandKey(item.event, cell.day) ?? null : null)),
  ]);
  return bands(rows).map((row, index) => (cells[index].holiday ? row.slice(1) : row));
}

/**
 * After the month is laid out (calendar-flows D1 · D2, audit 3 · 28, #260): a title that runs on is laid over the days its
 * band covers in the row (as wide as up to the end of the last one), and the cell's spare lines go to its cut titles — its
 * holiday's name (`holiday`, the selector of its line) first — which then take two lines (`cellTwoLines`). `room` is the
 * lines a cell's height fits, the holiday's name's included. Again on a resize.
 */
export function fitTitles(root: ParentNode, cells: string, room: (cell: HTMLElement) => number, holiday: string): void {
  for (const cell of root.querySelectorAll<HTMLElement>(cells)) {
    const items = [...cell.querySelectorAll<HTMLElement>(".item")];
    const name = cell.querySelector<HTMLElement>(holiday);
    cell.classList.toggle("runner", items.some((item) => item.dataset.run));
    for (const item of items) item.classList.remove("two");
    name?.classList.remove("two");
    for (const item of items) {
      const run = Number(item.dataset.run ?? 0);
      const title = item.querySelector<HTMLElement>(".t");
      if (!title) continue;
      title.style.width = "";
      if (run < 2) continue;
      // The band's last day in the row: `run - 1` cells on, its line in the same place.
      let last: Element | null = cell;
      for (let step = 1; step < run && last; step += 1) last = last.nextElementSibling;
      const end = last?.querySelector<HTMLElement>(`.item[data-lane="${item.dataset.lane}"]`);
      // (On screen; a widget drawn bigger or smaller (#271) is scaled, so back to the cell's own pixels.)
      if (end) title.style.width = `${Math.max(0, (end.getBoundingClientRect().right - title.getBoundingClientRect().left) / drawnScale(cell) - 3)}px`;
    }
    // A title breaks onto a second line between words (a space or a hyphen); in English and Dutch a long word also breaks
    // at a hyphenation point (`hyphens: auto` with the page's language). Korean: one long word keeps its "…".
    const fitOf = (text: HTMLElement | null): LineFit => text
      ? lineFit(overflows(text), /[\s-]/.test(text.textContent?.trim() ?? ""), true, lang())
      : "fit";
    const fits: LineFit[] = items.map((item) => (item.dataset.joined ? "band" : item.dataset.nowrap ? "fit" : fitOf(item.querySelector<HTMLElement>(".t"))));
    fitHead(cell);
    const two = cellTwoLines(room(cell), name ? fitOf(name) : undefined, fits);
    // Still wider than the line on two (a word that doesn't break): back to one line, its whole name in the tooltip.
    if (name && two.holiday) {
      name.classList.add("two");
      if (name.scrollWidth > name.clientWidth + 1) name.classList.remove("two");
    }
    two.lines.forEach((wraps, index) => {
      if (!wraps) return;
      items[index].classList.add("two");
      const title = items[index].querySelector<HTMLElement>(".t");
      if (title && title.scrollWidth > title.clientWidth + 1) items[index].classList.remove("two");
    });
  }
}

/** #296: a month cell's folded repeats in its head — the repeat arrows and how many (from two on); their names in the tooltip. */
export function repeatMark(folded: readonly DayTask[]): HTMLElement | null {
  if (folded.length === 0) return null;
  return h("span", { class: "rmark", title: foldedTooltip(folded, lang()) ?? "", "aria-hidden": "true" },
    icon("repeat", 9, 2.2), folded.length > 1 ? h("span", { class: "rn" }, String(folded.length)) : null);
}

/**
 * #295 · #296: what a month cell's head shows (`headFit`, as on the Mac): its parts measured as drawn — the number, the repeat
 * mark and its count, +N, the lunar date and its short form ("10.1") — and then the first that fits: all; the lunar date
 * short; the mark without its count; no lunar date; the number and +N only. calendar-flows 11 first (`showsLunar`: a narrow
 * cell has no lunar date; with +N beside it, only a lunar month's 1st). `lunarOff`: no lunar date (the dots' cells). After
 * layout: the head keeps its height, nothing moves.
 */
export function fitHead(cell: HTMLElement, lunarOff = false): void {
  const head = cell.querySelector<HTMLElement>(".cell-head, .head");
  if (!head) return;
  const lunar = head.querySelector<HTMLElement>("[data-lunar-day]");
  const mark = head.querySelector<HTMLElement>(".rmark");
  const count = mark?.querySelector<HTMLElement>(".rn") ?? null;
  const more = head.querySelector<HTMLElement>(".more");
  // Each part as a direct child of the head (the widget wraps them in a backing).
  const box = (element: HTMLElement | null): HTMLElement | null => {
    let child: HTMLElement | null = element;
    while (child && child.parentElement !== head) child = child.parentElement;
    return child;
  };
  const outer = (element: HTMLElement | null): number => box(element)?.offsetWidth ?? 0;
  const markBox = box(mark);
  // Everything back in, to measure.
  if (lunar) { lunar.hidden = false; lunar.textContent = lunar.dataset.full ?? lunar.textContent; }
  if (markBox) markBox.hidden = false;
  if (count) count.hidden = false;
  const allowed = Boolean(lunar) && !lunarOff && showsLunar(Number(lunar!.dataset.lunarDay), cell.clientWidth, Boolean(more));
  // The desk's lunar date keeps 4px from a +N beside it (calendarWindow.css).
  const extra = more && head.classList.contains("cell-head") ? 4 : 0;
  const full = allowed ? outer(lunar) + extra : 0;
  let short = full;
  if (allowed && lunar!.dataset.short && lunar!.dataset.short !== lunar!.textContent) {
    lunar!.textContent = lunar!.dataset.short;
    short = outer(lunar) + extra;
    lunar!.textContent = lunar!.dataset.full ?? "";
  }
  const countWidth = count ? count.offsetWidth + 1 : 0;
  const fit = headFit({
    room: head.clientWidth, number: outer(head.firstElementChild as HTMLElement | null), mark: mark ? outer(mark) - countWidth : 0, count: countWidth,
    more: outer(more), lunar: full, short, gap: parseFloat(getComputedStyle(head).columnGap) || 0,
  });
  if (lunar) {
    lunar.hidden = fit.lunar === "none";
    if (fit.lunar === "short") lunar.textContent = lunar.dataset.short ?? lunar.textContent;
  }
  if (markBox) markBox.hidden = !fit.mark;
  if (count) count.hidden = !fit.count;
}

/**
 * #260: a line's text is wider than its box — also by less than a pixel, where `scrollWidth` (whole pixels) still matches
 * but the line already ends with "…" ("Hangeuld…" was 0.6px too wide).
 */
function overflows(text: HTMLElement): boolean {
  if (text.scrollWidth > text.clientWidth + 1) return true;
  const range = document.createRange();
  range.selectNodeContents(text);
  const style = getComputedStyle(text);
  const k = drawnScale(text);
  const room = text.getBoundingClientRect().width / k - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return range.getBoundingClientRect().width / k > room + 0.25;
}

/** How many times as big an element is drawn as laid out: a widget's 크기 (#271, its `data-scale`); 1 everywhere else. */
function drawnScale(element: HTMLElement): number {
  return Number(element.closest<HTMLElement>("[data-scale]")?.dataset.scale) || 1;
}

/** A very narrow cell: each item a dot of its colour (a deadline a small flag, a reminder a small bell), the title in the tooltip. */
export function cellDot(item: CellItem, day: string): HTMLElement {
  if (item.kind === "task") {
    if (item.task.kind === "reminder") return h("span", { class: "dot reminder", title: taskTooltip(item.task, lang()) }, icon("bell", 9, 2));
    if (item.task.kind === "repeat") return h("span", { class: `dot repeat${item.task.ahead ? " ahead" : ""}`, title: taskTooltip(item.task, lang()) }, icon("repeat", 9, 2));
    return h("span", { class: `dot deadline${lateOn(day) ? " late" : ""}`, title: taskTooltip(item.task, lang()) }, icon("flag", 9, 2));
  }
  const dot = h("span", { class: "dot evc", title: `${agendaTime(item.event, day, lang())} · ${item.event.title}` });
  dot.style.setProperty("--color", eventMark(item.event.color));
  return dot;
}
/** A task in a week row: the alert's bell and time, or ⚑ 마감, in the time column (clay when it is due or late). */
export function taskLine(task: DayTask, day: string): HTMLElement {
  const late = task.kind === "deadline" && lateOn(day);
  // 시간 정하기: a task's hours as an outlined line (a card with a sage edge, like its block on the ribbon).
  if (task.kind === "range") {
    return h("div", { class: "line task range", title: taskTooltip(task, lang()) },
      h("span", { class: "time" }, icon("clock", 11, 2), task.start ?? ""), h("span", { class: "t" }, task.title));
  }
  // #274: a repeat says its time, or 반복; faded after the next one.
  const when = task.kind === "reminder" ? task.time ?? "" : task.kind === "repeat" ? task.time ?? repeatWord(false, lang()) : t("마감");
  return h("div", { class: `line task ${task.kind}${late ? " late" : ""}${task.ahead ? " ahead" : ""}`, title: taskTooltip(task, lang()),
    ...(task.kind === "repeat" ? { "aria-label": taskSpoken(task, lang()) } : {}) },
    h("span", { class: "time" }, icon(taskIcon(task), 11, 2), when),
    h("span", { class: "t" }, task.title));
}

