import { agendaTime, allDayText, bandKey, bands, cellTwoLines, lineFit, taskTooltip, type Band, type CellItem, type DayTask, type LineFit } from "../core/calendar";
import { showsLunar } from "../core/calendarWidget";
import { key as dayKey } from "../core/deadline";
import type { TodoItem } from "../core/notebook";
import { deviceKey, hiddenSpaces, readDeviceRules } from "../core/spaceDevice";
import { spaceIndexOf } from "../core/todoSpaces";
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

/**
 * #234: what a day carries besides its things — the lunar date ("8.21", "음 9.1") and its spoken form, and Korea's holiday
 * name ("한글날", "어린이날 · 부처님오신날") — each only while its switch is on (책상 → 일정 → 달력, this PC).
 */
export function dayMarks(day: string, prefs: Pick<Prefs, "calendarLunar" | "calendarHolidays">): { lunar?: string; lunarSpoken?: string; lunarDay?: number; holiday?: string; holidayShown?: string } {
  const lunar = prefs.calendarLunar !== false ? lunarOf(day) : undefined;
  const holiday = prefs.calendarHolidays !== false ? holidayLabel(day, lang()) : undefined;
  return {
    ...(lunar ? { lunar: lunarLabel(lunar, lang()), lunarSpoken: lunarSpoken(lunar, lang()), lunarDay: lunar.day } : {}),
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
    const reminder = item.task.kind === "reminder";
    const line = h("div", { class: reminder ? "item reminder" : `item deadline${lateOn(day) ? " late" : ""}`, title: taskTooltip(item.task, lang()) },
      icon(reminder ? "bell" : "flag", 10, 2), h("span", { class: "t" }, item.task.title));
    if (lane !== undefined) line.dataset.lane = String(lane);
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
      if (end) title.style.width = `${Math.max(0, end.getBoundingClientRect().right - title.getBoundingClientRect().left - 3)}px`;
    }
    // A title breaks onto a second line between words (a space or a hyphen); in English and Dutch a long word also breaks
    // at a hyphenation point (`hyphens: auto` with the page's language). Korean: one long word keeps its "…".
    const fitOf = (text: HTMLElement | null): LineFit => text
      ? lineFit(overflows(text), /[\s-]/.test(text.textContent?.trim() ?? ""), true, lang())
      : "fit";
    const fits: LineFit[] = items.map((item) => (item.dataset.joined ? "band" : fitOf(item.querySelector<HTMLElement>(".t"))));
    // calendar-flows 11: the lunar date only where the head has room (a narrow cell: the number only; with +N beside it:
    // a lunar month's first day only). Hidden after layout: the head keeps its height, nothing moves.
    const lunar = cell.querySelector<HTMLElement>("[data-lunar-day]");
    if (lunar) lunar.hidden = !showsLunar(Number(lunar.dataset.lunarDay), cell.clientWidth, Boolean(cell.querySelector(".more")));
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

/**
 * #260: a line's text is wider than its box — also by less than a pixel, where `scrollWidth` (whole pixels) still matches
 * but the line already ends with "…" ("Hangeuld…" was 0.6px too wide).
 */
function overflows(text: HTMLElement): boolean {
  if (text.scrollWidth > text.clientWidth + 1) return true;
  const range = document.createRange();
  range.selectNodeContents(text);
  const style = getComputedStyle(text);
  const room = text.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return range.getBoundingClientRect().width > room + 0.25;
}

/** A very narrow cell: each item a dot of its colour (a deadline a small flag, a reminder a small bell), the title in the tooltip. */
export function cellDot(item: CellItem, day: string): HTMLElement {
  if (item.kind === "task") {
    if (item.task.kind === "reminder") return h("span", { class: "dot reminder", title: taskTooltip(item.task, lang()) }, icon("bell", 9, 2));
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
  return h("div", { class: `line task ${task.kind}${late ? " late" : ""}`, title: taskTooltip(task, lang()) },
    h("span", { class: "time" }, icon(task.kind === "reminder" ? "bell" : "flag", 11, 2), task.kind === "reminder" ? task.time ?? "" : t("마감")),
    h("span", { class: "t" }, task.title));
}

