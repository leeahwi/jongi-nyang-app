import {
  agendaTime, cellItems, dayTasks, dayTitle, draftForDay, eventsOn, fetchRange, monthGrid, monthTitle, weekDays, weekOrder, weekTitle,
  type CalendarEvent, type CalendarSheetRequest,
} from "../core/calendar";
import { draftFromEvent, eventMark, expand, parseOccurrenceKey } from "../core/events";
import { fromKey, key as dayKey } from "../core/deadline";
import type { TodoItem } from "../core/notebook";
import type { TodosState } from "../core/types";
import { weekdayLetter, weekdayOrder, weekdayShort } from "../core/lang";
import { h, icon, lang, paper, t } from "./api";
import { listenForTyping } from "./typingTap";
import { holdWhileAsked } from "./askGuard";
import { openEventSheet, type EventSheet } from "./eventSheet";
import { cellDot, cellLine, dayMarks, fitTitles, hereTasks, lateOn, taskLine, weekBands } from "./calendarCells";
import { paneSight } from "./paneSight";

// #229: a question waiting holds this page up (askGuard.ts).
holdWhileAsked();

/**
 * 달력: a month of six weeks, or a week of seven rows, with the events (events.json, spread over the
 * days on screen) and the tasks' deadlines and alerts, beside a panel for the chosen day. New events
 * and changes use the note's event sheet, here as a card in this window. Days count from midnight
 * here (the note's "today" turns at 4 a.m.).
 */

const api = paper();
const app = document.getElementById("app")!;
/**
 * Lines a month cell and a week row have room for at the window's size (3 and 4 at 820 × 640);
 * more become "+N" / "+N개 더". Measured after drawing, and again when the window is resized.
 */
let room = { cell: 3, week: 4, dots: 0 };
/** Below this width a month cell's titles would be two or three letters: its items become coloured dots. */
const DOT_CELL = 56;

let state: TodosState | undefined;
let view: "month" | "week" = "month";
/** Opened on a day (an alert's title: ?day=2026-10-08), else today. */
const requestedDay = new URLSearchParams(location.search).get("day");
/** calendar-flows D3: an event pressed on a widget (?event=local/…@2026-10-08): its sheet opens with the first month. */
let requestedEvent = new URLSearchParams(location.search).get("event") ?? undefined;
let selected = requestedDay && fromKey(requestedDay) ? requestedDay : dayKey(new Date());
/** The month on screen in the month view (1–12); the week view shows the selected day's week. */
let shown = { year: new Date().getFullYear(), month: new Date().getMonth() + 1 };
let sheet: EventSheet | undefined;

const today = () => dayKey(new Date());
const shift = (day: string, days: number) => {
  const date = fromKey(day) ?? new Date();
  date.setDate(date.getDate() + days);
  return dayKey(date);
};
const monthOf = (day: string) => ({ year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)) });
const shownDays = () => (view === "month" ? monthGrid(shown.year, shown.month, lang()) : weekDays(selected, lang()));
/** The events of the days on screen: every event spread over them (repeats too). */
let events: CalendarEvent[] = [];
function spreadEvents(): void {
  const { start, end } = fetchRange(shownDays());
  events = expand(state?.events ?? [], start, end, lang());
}

// ─── Moving around ────────────────────────────────────────────────────────────

/** Chooses a day; the month on screen follows it when `follow` (the keyboard, 오늘, ‹ ›). */
function choose(day: string, follow = true): void {
  const changed = follow && view === "month" && (monthOf(day).year !== shown.year || monthOf(day).month !== shown.month);
  const weekChanged = view === "week" && weekDays(day, lang())[0] !== weekDays(selected, lang())[0];
  selected = day;
  if (changed) shown = monthOf(day);
  if (changed || weekChanged) spreadEvents();
  render();
}

/** ‹ ›: a month (the same date, or the month's last) or a week; the chosen day goes along. */
function page(direction: 1 | -1): void {
  if (view === "week") return choose(shift(selected, 7 * direction));
  const target = new Date(shown.year, shown.month - 1 + direction, 1, 12);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0, 12).getDate();
  target.setDate(Math.min(Number(selected.slice(8, 10)), last));
  choose(dayKey(target));
}

function setView(next: "month" | "week"): void {
  if (next === view) return;
  view = next;
  shown = monthOf(selected);
  void api.act({ type: "setPref", key: "calendarView", value: next });
  spreadEvents();
  render();
}

/** 새 일정 on the chosen day. */
function newEvent(day = selected, anchor?: () => HTMLElement | undefined): void {
  if (!state) return;
  const draft = draftForDay(day, new Date(), state.prefs.calendarLastColor || undefined);
  showSheet({ mode: "new", draft }, anchor ?? (() => app.querySelector<HTMLElement>(".cell.selected, .day-row.selected") ?? undefined));
}

/** A day panel row: the event to change (a repeating one as a whole; deleting asks about that day). */
function openEvent(event: CalendarEvent, row: HTMLElement): void {
  openEventKey(event.key, () => (row.isConnected ? row : undefined));
}

/**
 * The sheet of an event by its occurrence's key ("local/<id>@<day>"), beside its row in the day panel (calendar-flows D3:
 * also when a widget or its day sheet asked for it). False when there is no such event any more.
 */
function openEventKey(key: string, anchor?: () => HTMLElement | undefined): boolean {
  const parsed = parseOccurrenceKey(key);
  const stored = parsed && state?.events.find((entry) => entry.id === parsed.id);
  if (!parsed || !stored) return false;
  const row = () => [...app.querySelectorAll<HTMLElement>(".panel .ev")].find((element) => element.dataset.key === key) ?? app.querySelector<HTMLElement>(".panel") ?? undefined;
  showSheet({ mode: "edit", key, id: stored.id, day: parsed.day, recurring: stored.repeat !== "none", draft: draftFromEvent(stored) }, anchor ?? row);
  return true;
}

function showSheet(request: CalendarSheetRequest, anchor: () => HTMLElement | undefined = () => undefined): void {
  if (!state) return;
  sheet?.close();
  const opened = openEventSheet(request, anchor, () => { if (sheet === opened) sheet = undefined; }, { besideAnchor: true });
  sheet = opened;
}

/** Two clicks on the same day within this long are a double click, even when the grid was drawn again between them. */
let lastClick = { day: "", at: 0 };
function clickDay(day: string, element: HTMLElement): void {
  const now = Date.now();
  const double = lastClick.day === day && now - lastClick.at < 450;
  lastClick = double ? { day: "", at: 0 } : { day, at: now };
  choose(day, false);
  if (double) newEvent(day, () => app.querySelector<HTMLElement>(`[data-day="${day}"]`) ?? (element.isConnected ? element : undefined));
}

// ─── The top bar ──────────────────────────────────────────────────────────────

function topBar(): HTMLElement {
  const previousLabel = view === "month" ? t("이전 달") : t("이전 주");
  const nextLabel = view === "month" ? t("다음 달") : t("다음 주");
  const previous = h("button", { class: "quiet", title: previousLabel, "aria-label": previousLabel }, icon("chevronLeft", 15, 2));
  const next = h("button", { class: "quiet", title: nextLabel, "aria-label": nextLabel }, icon("chevronRight", 15, 2));
  previous.addEventListener("click", () => page(-1));
  next.addEventListener("click", () => page(1));
  const title = h("h1", { class: "title" }, view === "month" ? monthTitle(shown.year, shown.month, lang()) : weekTitle(weekDays(selected, lang()), lang()));
  const todayButton = h("button", { class: "today", title: t("오늘 (T)") }, t("오늘"));
  todayButton.addEventListener("click", () => choose(today()));
  const segment = h("div", { class: "seg view-seg", role: "radiogroup", "aria-label": t("보기") }, ...(["week", "month"] as const).map((option) => {
    const choice = h("button", { role: "radio", "aria-checked": String(view === option) }, option === "week" ? t("주") : t("월"));
    choice.addEventListener("click", () => setView(option));
    return choice;
  }));
  const add = h("button", { class: "top-new", title: t("새 일정 (Enter)") }, icon("plus", 13, 2.2), t("새 일정"));
  add.addEventListener("click", () => newEvent(selected, () => (add.isConnected ? add : undefined)));
  // As on the Mac: the title on the left, then ‹ 오늘 › together, the week · month switch and 새 일정.
  return h("header", { class: "top" }, title, h("span", { class: "spacer" }), h("div", { class: "nav" }, previous, todayButton, next), segment, add);
}

// ─── The month ────────────────────────────────────────────────────────────────

/**
 * The to-dos the calendar shows: #227, without the ones this PC hides now (as the 오늘 창 — a peek on the note doesn't
 * reach here). Worked out again only when the state changes or the minute turns (a time rule).
 */
let shownItems: { from?: TodosState; minute: number; items: readonly TodoItem[] } = { minute: -1, items: [] };
function items(): readonly TodoItem[] {
  if (!state) return [];
  const now = new Date();
  const minute = Math.floor(now.getTime() / 60_000);
  if (shownItems.from === state && shownItems.minute === minute) return shownItems.items;
  const list = hereTasks(state, now);
  shownItems = { from: state, minute, items: list };
  return list;
}

function monthView(): HTMLElement {
  const days = monthGrid(shown.year, shown.month, lang());
  const now = today();
  // The week's days in order (Monday first in Dutch), Sunday and Saturday tinted.
  const head = h("div", { class: "weekdays", "aria-hidden": "true" }, ...weekdayOrder(lang()).map((day) => h("span", { class: day === 0 ? "sun" : day === 6 ? "sat" : "" }, lang() === "en" ? weekdayShort(day, lang()) : weekdayLetter(day, lang()))));
  const grid = h("div", { class: `month${room.dots ? " dotted" : ""}`, role: "grid", "aria-label": monthTitle(shown.year, shown.month, lang()) }, head);
  for (let week = 0; week < 6; week += 1) {
    const row = h("div", { class: "grid-row", role: "row" });
    // #234: the lunar date beside the number, and a holiday's name as the cell's first line (it takes a line's room).
    const cells = days.slice(week * 7, week * 7 + 7).map((day) => {
      const marks = dayMarks(day, state!.prefs);
      return { day, marks, holiday: Boolean(marks.holiday) && !room.dots, ...cellItems(day, events, items(), room.dots || Math.max(1, room.cell - (marks.holiday ? 1 : 0)), lang()) };
    });
    // calendar-flows D1: a trip's band joins along the row, its title once.
    const rowBands = room.dots ? [] : weekBands(cells);
    cells.forEach(({ day, marks, items: lines, more }, column) => {
      const date = fromKey(day)!;
      const lead = marks.holiday ? 1 : 0;
      const cell = h("div", {
        class: ["cell", date.getDay() === 0 ? "sun" : date.getDay() === 6 ? "sat" : "", marks.holiday ? "holiday" : "", date.getMonth() + 1 !== shown.month ? "outside" : "", day === now ? "today" : "", day === selected ? "selected" : ""].filter(Boolean).join(" "),
        role: "gridcell", "data-day": day, "aria-selected": String(day === selected),
        "aria-label": [dayTitle(day, lang()), marks.holiday, marks.lunarSpoken, lines.length + more ? t("{n}개", { n: lines.length + more }) : ""].filter(Boolean).join(", "),
      },
      h("div", { class: "cell-head" }, h("span", { class: "num" }, String(date.getDate())), more > 0 ? h("span", { class: "more" }, `+${more}`) : null,
        marks.lunar ? h("span", { class: "lunar", title: marks.lunarSpoken, "data-lunar-day": String(marks.lunarDay ?? 0) }, marks.lunar) : null),
      ...(marks.holiday && !room.dots ? [h("div", { class: "holiday-name", title: marks.holiday, "aria-hidden": "true" }, marks.holidayShown ?? marks.holiday)] : []),
      ...(room.dots ? [h("div", { class: "dots" }, ...lines.map((item) => cellDot(item, day)))] : lines.map((item, index) => cellLine(item, day, rowBands[column]?.[index], index + lead))));
      if (marks.holiday && room.dots) cell.title = marks.holiday;
      cell.addEventListener("click", () => clickDay(day, cell));
      row.append(cell);
    });
    grid.append(row);
  }
  return grid;
}

// ─── The week ─────────────────────────────────────────────────────────────────

function weekView(): HTMLElement {
  const now = today();
  const list = h("div", { class: "week", role: "grid", "aria-label": weekTitle(weekDays(selected, lang()), lang()) });
  for (const day of weekDays(selected, lang())) {
    const date = fromKey(day)!;
    const dayEvents = eventsOn(day, events);
    // #227: as the month cells — events, deadlines, then reminders (with their time here: the row has the column).
    const tasks = weekOrder(dayTasks(day, items(), lang(), now));
    const lines: HTMLElement[] = [
      ...dayEvents.map((event) => {
        const bar = h("span", { class: "bar evc", "aria-hidden": "true" });
        bar.style.background = eventMark(event.color);
        return h("div", { class: "line", title: `${agendaTime(event, day, lang())} · ${event.title}` }, h("span", { class: "time" }, agendaTime(event, day, lang())), bar, h("span", { class: "t" }, event.title));
      }),
      ...tasks.map((task) => taskLine(task, day)),
    ];
    // #234: a holiday's name first (it takes a line's room); the lunar date under the weekday.
    const marks = dayMarks(day, state!.prefs);
    if (marks.holiday) lines.unshift(h("div", { class: "line holiday", title: marks.holiday }, h("span", { class: "time" }), h("span", { class: "t" }, marks.holiday)));
    const fit = lines.length > room.week ? room.week - 1 : room.week;
    const shownLines = lines.slice(0, fit);
    const hidden = lines.length - shownLines.length;
    const more = hidden > 0 ? h("button", { class: "line more-line" }, t("+{n}개 더", { n: hidden })) : null;
    const row = h("div", {
      class: ["day-row", date.getDay() === 0 ? "sun" : date.getDay() === 6 ? "sat" : "", marks.holiday ? "holiday" : "", day === now ? "today" : "", day === selected ? "selected" : ""].filter(Boolean).join(" "),
      role: "row", "data-day": day, "aria-selected": String(day === selected), "aria-label": dayTitle(day, lang()),
    },
    h("div", { class: "label" }, h("span", { class: "n" }, String(date.getDate())), h("span", { class: "w" }, weekdayShort(date.getDay(), lang())),
      marks.lunar ? h("span", { class: "lunar", title: marks.lunarSpoken }, marks.lunar) : null),
    h("div", { class: "lines" }, ...shownLines, more, lines.length === 0 ? h("div", { class: "line none" }, "") : null));
    row.addEventListener("click", () => clickDay(day, row));
    list.append(row);
  }
  return list;
}

// ─── The day panel ────────────────────────────────────────────────────────────

function dayPanel(): HTMLElement {
  const isToday = selected === today();
  const head = h("div", { class: "panel-head" }, h("span", { class: "date" }, dayTitle(selected, lang())), isToday ? h("span", { class: "badge" }, t("오늘")) : null);
  // calendar-flows: the holiday's name under the date.
  const marks = dayMarks(selected, state!.prefs);
  const holiday = marks.holiday;
  const scroll = h("div", { class: "panel-scroll" });
  const dayEvents = eventsOn(selected, events);
  scroll.append(h("div", { class: "section" }, t("일정")));
  if (dayEvents.length === 0) scroll.append(h("div", { class: "nothing" }, t("일정 없음")));
  for (const event of dayEvents) {
    const bar = h("span", { class: "bar evc", "aria-hidden": "true" });
    bar.style.background = eventMark(event.color);
    const row = h("button", { class: "ev", "data-key": event.key, title: t("고치기") },
      bar,
      h("span", { class: "main" },
        h("span", { class: "first" }, h("span", { class: "time" }, agendaTime(event, selected, lang())), h("span", { class: "t" }, event.title)),
        event.location ? h("span", { class: "sub" }, event.location) : null));
    row.addEventListener("click", () => openEvent(event, row));
    // Right-click: 고치기… · 할 일로 추가 · 지우기… (the strip's menu, from the main process).
    row.addEventListener("contextmenu", (contextEvent) => {
      contextEvent.preventDefault();
      void api.act({ type: "showEventMenu", key: event.key });
    });
    scroll.append(row);
  }
  const add = h("button", { class: "new-event" }, icon("plus", 12, 2.2), t("새 일정"));
  add.addEventListener("click", () => newEvent(selected, () => (add.isConnected ? add : undefined)));
  scroll.append(add);
  const tasks = dayTasks(selected, items(), lang(), today());
  if (tasks.length > 0) {
    scroll.append(h("div", { class: "section" }, t("할 일")));
    for (const task of tasks) {
      const row = h("button", { class: `task-row ${task.kind}${task.kind === "deadline" && lateOn(selected) ? " late" : ""}`, title: t("노트에서 보기") },
        task.kind === "reminder" ? icon("bell", 12, 2) : task.kind === "range" ? icon("clock", 12, 2) : icon("flag", 12, 2),
        task.kind !== "deadline" ? h("span", { class: "time" }, task.time ?? "") : null,
        h("span", { class: "t" }, task.title));
      row.addEventListener("click", () => api.act({ type: "calendarShowTask", id: task.taskId }));
      scroll.append(row);
    }
  }
  // …and the lunar date's spoken form beside it (holiday first), one line.
  const note = holiday || marks.lunarSpoken
    ? h("div", { class: "panel-holiday" }, holiday ?? null, holiday && marks.lunarSpoken ? " · " : null, marks.lunarSpoken ? h("span", { class: "panel-lunar" }, marks.lunarSpoken) : null)
    : null;
  return h("aside", { class: "panel", "aria-label": [dayTitle(selected, lang()), holiday, marks.lunarSpoken].filter(Boolean).join(", ") }, head, note, scroll);
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

function render(): void {
  if (!state) return;
  const scrollTop = app.querySelector(".panel-scroll")?.scrollTop ?? 0;
  app.replaceChildren(topBar(), h("main", { class: "calendar-body" }, view === "month" ? monthView() : weekView(), dayPanel()));
  const scroll = app.querySelector(".panel-scroll");
  if (scroll) scroll.scrollTop = scrollTop;
  if (measureRoom()) render();
  else fitMonth();
}

/** calendar-flows D1 · D2: titles laid over their bands, and cut ones on two lines where a cell has a line to spare. */
function fitMonth(): void {
  if (view !== "month") return;
  // Dots in very narrow cells: no lunar date in the head (narrower than 72 anyway).
  if (room.dots) { for (const lunar of app.querySelectorAll<HTMLElement>(".month [data-lunar-day]")) lunar.hidden = true; return; }
  fitTitles(app, ".month .cell", () => room.cell, ".holiday-name");
}

/** How many lines the drawn cells (or week rows) hold; true when that changed. */
function measureRoom(): boolean {
  const cell = app.querySelector<HTMLElement>(".month .cell");
  const row = app.querySelector<HTMLElement>(".week .day-row");
  // A cell: 5px padding, the date (21px) and a 1px gap, then 16px lines 1px apart. A week row: 10px padding, 17px lines 1px apart.
  // A cell narrower than DOT_CELL: rows of 7px dots, 4px apart.
  const narrow = cell !== null && cell.clientWidth < DOT_CELL;
  const next = {
    cell: cell ? Math.max(1, Math.floor((cell.clientHeight - 25) / 17)) : room.cell,
    week: row ? Math.max(2, Math.floor((row.clientHeight - 8) / 18)) : room.week,
    // At most four dots (as on the Mac); the rest are the head's +N.
    dots: narrow ? Math.min(4, Math.max(1, Math.floor((cell.clientWidth - 6 + 4) / 11)) * Math.max(1, Math.floor((cell.clientHeight - 25 + 4) / 11))) : 0,
  };
  const changed = next.cell !== room.cell || next.week !== room.week || next.dots !== room.dots;
  room = next;
  return changed;
}
window.addEventListener("resize", () => { if (!state) return; if (measureRoom()) render(); else fitMonth(); });

// ─── Keyboard ─────────────────────────────────────────────────────────────────

window.addEventListener("keydown", (event) => {
  // The sheet keeps its own keys (Return · Esc, and typing).
  if (sheet || event.isComposing || event.altKey) return;
  const target = event.target as HTMLElement;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
  const command = event.ctrlKey || event.metaKey;
  const handled = (action: () => void) => { event.preventDefault(); action(); };
  if (command) {
    // Ctrl+[ · Ctrl+]: the previous or next month (week); by the key's place, so any keyboard layout works.
    if (event.code === "BracketLeft") return handled(() => page(-1));
    if (event.code === "BracketRight") return handled(() => page(1));
    return;
  }
  if (event.shiftKey) return;
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: view === "month" ? -7 : -1, ArrowDown: view === "month" ? 7 : 1 }[event.key];
  if (step) return handled(() => choose(shift(selected, step)));
  // T for 오늘 (also with the Korean layout on, where the key types ㅅ).
  if (event.code === "KeyT") return handled(() => choose(today()));
  if (event.key === "Enter" && !(target instanceof HTMLButtonElement)) return handled(() => newEvent());
});

// ─── Wiring ───────────────────────────────────────────────────────────────────

function apply(next: TodosState): void {
  const first = !state;
  state = next;
  document.documentElement.dataset.font = next.prefs.font;
  if (first) {
    view = next.prefs.calendarView === "week" ? "week" : "month";
    shown = monthOf(selected);
    redraw();
    if (requestedEvent) openEventKey(requestedEvent);
    requestedEvent = undefined;
    // `npm run perf` reads when the first month was drawn.
    performance.mark("paper:first-render");
  }
  // Out of sight (the desk hidden, another pane in front): drawn once when it shows again (#79).
  else sight.draw(redraw);
}

/** Every change may bring events (one written here or in the note, a shared folder read again). */
function redraw(): void {
  spreadEvents();
  render();
  sheet?.refresh();
}
const sight = paneSight("calendar", redraw);

api.on("state", (next) => apply(next as TodosState));
// An alert's title (or 달력에서 열기), with the desk already open: that day.
api.on("desk:pane", (payload) => {
  const { pane, day, event } = (payload ?? {}) as { pane?: unknown; day?: unknown; event?: unknown };
  if (pane !== "calendar" || typeof day !== "string" || !fromKey(day)) return;
  sheet?.close();
  // Before the first state (the pane still loading): the sheet opens with the first month.
  if (!state) { selected = day; if (typeof event === "string") requestedEvent = event; return; }
  sight.flush();
  choose(day);
  // calendar-flows D3: an event pressed on a widget — its sheet, beside its row.
  if (typeof event === "string") openEventKey(event);
});
api.on("calendar:event-sheet", (payload) => {
  sight.flush();
  const request = payload as CalendarSheetRequest;
  const key = request.key;
  showSheet(request, () => (key ? [...app.querySelectorAll<HTMLElement>(".panel .ev")].find((row) => row.dataset.key === key) : undefined) ?? app.querySelector<HTMLElement>(".panel") ?? undefined);
});
// The day turns over at midnight: the today ring and badge move.
let drawnToday = today();
setInterval(() => {
  if (today() === drawnToday) return;
  drawnToday = today();
  render();
}, 60_000);
void api.getState().then(apply);

// #230: keys typed here make the desktop cat tap along (only that a key went down).
listenForTyping();
