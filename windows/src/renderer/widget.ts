import { allDayText, cellItems, dayTitle, fetchRange, foldedLabel, foldedRepeats, monthGrid, monthTitle, repeatWord, weekDays, weekTitle, type CalendarEvent, type DayTask } from "../core/calendar";
import {
  agenda, backing, bolder, dayLines, dots, drawnOpacity, earHeightOf, earOpacity, earScale, edgeStrength, emptyText, floorOf, halo, inkOnly, lineSpoken, linesOf,
  moreLabel, nextRedraw, pageDays, pageOffset, rgbOf, shiftedMonth, stepDay, tile, upcoming, weekendTint, weekRow, widgetAddedText, widgetSize, widgetToday,
  type WidgetLine, type WidgetSettings,
} from "../core/calendarWidget";
import { eventMark, expand } from "../core/events";
import { fromKey } from "../core/deadline";
import { earPaths, earsOverlap, earsRoom, mayTwitch } from "../core/noteEars";
import type { TodoItem } from "../core/notebook";
import type { IntentMade, TodosState } from "../core/types";
import { dayWord, monthName, weekdayLetter, weekdayName, weekdayOrder, weekdayShort } from "../core/lang";
import { h, icon, lang, paper, reduceMotion, t } from "./api";
import { calendarTasks, cellLine, dayMarks, fitTitles, repeatMark, weekBands } from "./calendarCells";
import { listenForTyping } from "./typingTap";
import { waitsForAnswer } from "./widgetAsk";

/**
 * 바탕화면 달력 위젯 (#234): one widget's page — 오늘 · 이번 주 (간단히 · 자세히) · 이번 달 (간단히 · 자세히) · 오늘 목록,
 * drawn from the app's state with the desk calendar's core (core/calendarWidget.ts, calendarCells.ts). Only the paper fades;
 * the classes on the widget say how the text stays readable (ink, rings, bolder numbers). Each day of the week and the month
 * is a paper tile that never fades below the paper's floor (ink keeps 4.5:1 on it over any wallpaper; #234 4-6), weekends
 * and holidays tinted with the paper's clay; the text off the tiles gets a backing at the floor below it. The lunar date and
 * Korea's holidays show while their switches are on (책상 → 일정 → 달력). Hovering makes it solid
 * (마우스를 올리면 선명하게). The page tells the main process where it takes the mouse: the paper (unless 클릭 통과, or with
 * Ctrl held) and the ears; the clicks go through everywhere else. A day, a +N or the + opens the day sheet; an event's
 * title opens the desk's calendar on its day, a to-do's the note on its row (no ticking here). Nothing runs while it
 * waits: one timer for the next moment what it shows changes (midnight, the next event's start or end), and one to come
 * back to this week · month two minutes after ‹ ›. It draws again only when what it shows changed.
 * #253: a question waiting doesn't hold it up (widgetAsk.ts): ‹ ›, hovering and the day sheet work; the toast's 되돌리기
 * waits only while the question replaces the whole list.
 */
const api = paper();
const stage = document.getElementById("stage")!;
const svgNS = "http://www.w3.org/2000/svg";

let settings: WidgetSettings | undefined;
let room = 14;
/** 크기 (#271) as drawn (the main process says: the size picked, or a smaller one where its display has no room). */
let scale = 1;
let preview = false;
let state: TodosState | undefined;
/** ‹ ›: weeks or months away from now, and when they were last pressed (2 minutes later it comes back). */
let offset = 0;
let touched = 0;
let backTimer: number | undefined;
let redrawTimer: number | undefined;
/** The pointer is over the paper (or an ear) and it is solid; `unlocked`: 클릭 통과 let up by an ear or Ctrl. */
let hovering = false;
let unlocked = false;
let leaveTimer: number | undefined;
let drawnKey = "";
let removed: { widget: WidgetSettings; index: number } | undefined;
const reduceTransparency = window.matchMedia("(prefers-reduced-transparency: reduce)");

const root = h("div", { class: "wg" });
const paperBox = h("div", { class: "paper" });
const content = h("div", { class: "in" });
const earsSvg = document.createElementNS(svgNS, "svg");
earsSvg.setAttribute("class", "note-ears");
root.append(earsSvg, paperBox, content);
stage.append(root);

// ─── Drawing ──────────────────────────────────────────────────────────────────

const B = (...children: (Node | string | null | undefined | false)[]) => h("span", { class: "bk" }, ...children);
const today = () => widgetToday(new Date());
/** The day's lunar date and holiday (each only with its switch on). */
const marksOf = (day: string) => (state ? dayMarks(day, state.prefs) : {});
/** A holiday's name line: clay at 100 %, ink with a clay ⚑ below (the text rule); `shown` (#260): drawn with the places it may break. */
const holidayLine = (name: string, shown = name) => h("div", { class: "hol", title: name }, h("span", { class: "hflag", "aria-hidden": "true" }, "⚑"), shown);
const lunarOfDay = (marks: ReturnType<typeof marksOf>) => (marks.lunar ? h("span", { class: "lu", title: marks.lunarSpoken ?? "", "data-lunar-day": String(marks.lunarDay ?? 0), "data-full": marks.lunar, "data-short": marks.lunarShort ?? marks.lunar }, marks.lunar) : null);
/** Sunday · Saturday and holidays: the tinted tiles. */
const weekendOf = (day: string, holiday?: string) => { const weekday = fromKey(day)!.getDay(); return weekday === 0 || weekday === 6 || Boolean(holiday); };

/** The paper's floor (#234): from the paper and ink the page draws with now (a theme of #244 too). */
let floor = 60;
/** The tinted tiles' own floor (weekends and holidays). */
let weekendFloor = 65;
function hexOf(value: string): string | undefined {
  const text = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text;
  if (/^#[0-9a-f]{3}$/i.test(text)) return `#${[...text.slice(1)].map((c) => c + c).join("")}`;
  const rgb = text.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i);
  return rgb ? `#${rgb.slice(1, 4).map((n) => Number(n).toString(16).padStart(2, "0")).join("")}` : undefined;
}
function readFloor(): void {
  const style = getComputedStyle(document.documentElement);
  const paperHex = hexOf(style.getPropertyValue("--w-paper")), inkHex = hexOf(style.getPropertyValue("--w-ink"));
  const clayHex = hexOf(style.getPropertyValue("--w-clay-2"));
  if (!paperHex || !inkHex) return;
  const paperRgb = rgbOf(paperHex), inkRgb = rgbOf(inkHex);
  const light = 0.2126 * paperRgb[0] + 0.7152 * paperRgb[1] + 0.0722 * paperRgb[2] > 0.4;
  floor = floorOf(paperRgb, inkRgb, !light);
  weekendFloor = clayHex ? Math.max(floor, floorOf(weekendTint(rgbOf(clayHex), paperRgb), inkRgb, !light)) : floor;
}

function markOf(line: WidgetLine): HTMLElement {
  const mark = h("span", { class: `mark ${line.kind === "event" ? "" : line.kind}`.trim(), "aria-hidden": "true" });
  if (line.kind === "event") mark.style.setProperty("--color", eventMark(line.color));
  return mark;
}

/** A line of 오늘 · 이번 주 · 오늘 목록: its mark, its time (종일 · 마감 · #274 반복) and its title; a click opens it. */
function lineOf(line: WidgetLine, day: string): HTMLElement {
  const time = line.time ?? (line.kind === "deadline" ? t("마감") : line.kind === "repeat" ? repeatWord(false, lang()) : allDayText(lang()));
  const inner = B(markOf(line), h("span", { class: "tm" }, time), h("span", { class: "tt" }, line.title));
  inner.title = `${time} · ${line.title}`;
  const spoken = lineSpoken(line, lang());
  if (spoken) inner.setAttribute("aria-label", spoken);
  inner.addEventListener("click", (event) => { event.stopPropagation(); openLine(line, day); });
  // #274: a repeat after the next one, faded.
  return h("div", { class: `ln${line.ahead ? " ahead" : ""}` }, inner);
}

/**
 * A line pressed: a to-do's row in the note; #274 a repeat without an open copy its rule (책상 → 반복); an event's sheet in
 * the desk's calendar, on its day (calendar-flows D3).
 */
function openLine(line: Pick<WidgetLine, "kind" | "taskId" | "eventKey">, day: string): void {
  if (line.taskId) void api.act({ type: "calendarShowTask", id: line.taskId });
  else if (line.kind === "repeat") void api.act({ type: "openSettings", tab: "repeat" });
  else void api.act({ type: "openCalendar", day, ...(line.eventKey ? { event: line.eventKey } : {}) });
}
const openTask = (task: DayTask, day: string) => openLine({ kind: task.kind, ...(task.taskId ? { taskId: task.taskId } : {}) }, day);
/** The dots' colours: an event's own, clay, sage, and #274 a repeat after the next one fainter. */
const dotColor = (color: string) => (color === "clay" ? "var(--clay)" : color === "sage" ? "var(--sage)" : color === "faint" ? "color-mix(in srgb, var(--sage) 45%, transparent)" : eventMark(color));

const openDay = (day: string) => api.send("widget:day", day);

function moreButton(count: number, day: string): HTMLElement {
  const button = h("button", { class: "more", "aria-label": moreLabel(count, lang()), title: moreLabel(count, lang()) }, `+${count}`);
  button.addEventListener("click", (event) => { event.stopPropagation(); openDay(day); });
  return button;
}

function numberOf(day: string, sunday: boolean, size = ""): HTMLElement {
  const date = fromKey(day)!;
  return h("span", { class: `n num ${day === today() ? "todaydot" : sunday ? "sun" : ""} ${size}`.trim() }, String(date.getDate()));
}

function nav(kind: "week" | "month"): HTMLElement {
  const previous = h("button", { "aria-label": kind === "week" ? t("이전 주") : t("이전 달"), title: kind === "week" ? t("이전 주") : t("이전 달") }, icon("chevronLeft", 12, 2.2));
  const now = h("button", { class: "td" }, t("오늘"));
  const next = h("button", { "aria-label": kind === "week" ? t("다음 주") : t("다음 달"), title: kind === "week" ? t("다음 주") : t("다음 달") }, icon("chevronRight", 12, 2.2));
  previous.addEventListener("click", (event) => { event.stopPropagation(); page(-1); });
  next.addEventListener("click", (event) => { event.stopPropagation(); page(1); });
  now.addEventListener("click", (event) => { event.stopPropagation(); page(0); });
  return h("span", { class: "nav" }, B(previous), B(now), B(next));
}

function header(title: string, kind?: "week" | "month"): HTMLElement {
  const label = h("span", { class: "t" }, title);
  label.addEventListener("click", (event) => { event.stopPropagation(); void api.act({ type: "openCalendar", day: today() }); });
  return h("div", { class: "hd" }, B(label), kind ? nav(kind) : null);
}

/** The data of the page now, and its own key (drawn again only when that changes). */
function model(): { days: string[]; events: CalendarEvent[]; tasks: readonly TodoItem[] } | undefined {
  if (!state || !settings) return undefined;
  const days = pageDays(settings.kind, today(), offset, lang());
  const { start, end } = fetchRange(days);
  return { days, events: expand(state.events, start, end, lang()), tasks: calendarTasks(state, days) };
}

function draw(): void {
  window.clearTimeout(redrawTimer);
  if (!settings) return;
  const data = model();
  if (!data) return;
  const now = new Date();
  const day = today();
  const kind = settings.kind;
  const body = kind === "today" ? todayBody(data, now) : kind === "agenda" ? agendaBody(data, now) : kind === "week" ? weekBody(data, now) : monthBody(data);
  const key = `${lang()}|${day}|${offset}|${settings.kind}|${settings.style}|${body.key}`;
  if (key !== drawnKey) {
    drawnKey = key;
    content.replaceChildren(...body.nodes);
    fitMonth();
  }
  // One timer: the next moment what it shows changes (T1, T2).
  const lines = dayLines(day, data.events, data.tasks, now, lang());
  const next = nextRedraw(kind === "month" && offset === 0 ? "month" : kind, now, lines).getTime() - now.getTime();
  redrawTimer = window.setTimeout(draw, Math.max(1_000, next + 500));
}

/**
 * calendar-flows D1 · D2: in 이번 달 자세히 · 벽 달력, titles laid over their bands, and cut ones on two lines where a cell has
 * a line to spare (the old 벽 달력 rule — two lines when a cell had two or fewer — is this rule now).
 */
function fitMonth(): void {
  if (settings?.kind !== "month" || settings.style === "simple") return;
  const lines = linesOf(settings.style);
  fitTitles(content, ".mgrid .cl", () => lines, ".hol");
}
// The hand's font may come in after the first drawing: the widths again.
void document.fonts?.ready.then(() => fitMonth());

/** 오늘 (170 × 170): the big date and weekday, what is still to come today (three lines and +N), and +. */
function todayBody(data: NonNullable<ReturnType<typeof model>>, now: Date): { key: string; nodes: Node[] } {
  const date = new Date();
  const up = upcoming(today(), data.events, data.tasks, now, 3, lang());
  const month = monthName(date.getMonth() + 1, lang());
  const marks = marksOf(today());
  const big = h("div", { class: "big" }, B(h("span", { class: "d num" }, String(date.getDate())),
    h("span", { class: "m" }, marks.holiday ? h("span", { class: "hol-in", title: marks.holiday }, marks.holiday) : month, h("br"), weekdayName(date.getDay(), lang()),
      marks.lunar ? h("span", { class: "lu-in", title: marks.lunarSpoken ?? "" }, ` · ${marks.lunar}`) : null)));
  const lines = up.lines.length ? up.lines.map((line) => lineOf(line, today())) : [h("div", { class: "empty" }, B(emptyText(lang())))];
  const more = up.more > 0 ? h("div", { class: "ln" }, B(moreButton(up.more, today()))) : null;
  const plus = h("button", { class: "plusbtn", "aria-label": t("+ 넣기"), title: t("+ 넣기") }, "+");
  plus.addEventListener("click", (event) => { event.stopPropagation(); openDay(today()); });
  return { key: JSON.stringify([up, date.getMonth(), marks]), nodes: [big, ...lines, ...(more ? [more] : []), plus] };
}

/** 이번 주: 간단히 — seven day columns (dots) and today's next two; 자세히 — a row a day, its first thing and +N. */
function weekBody(data: NonNullable<ReturnType<typeof model>>, now: Date): { key: string; nodes: Node[] } {
  const days = weekDays(stepDay(today(), 7 * offset), lang());
  const title = header(weekTitle(days, lang()), "week");
  if (settings!.style === "detail") {
    const rows = days.map((day) => {
      const date = fromKey(day)!;
      const sunday = date.getDay() === 0;
      const row = weekRow(day, data.events, data.tasks, lang());
      const cell = cellItems(day, data.events, data.tasks, 1, lang());
      const first = cell.items[0] ? cellLine(cell.items[0], day) : null;
      if (first) first.addEventListener("click", (event) => { event.stopPropagation(); if (row.first) openLine(row.first, day); });
      const marks = marksOf(day);
      const red = sunday || Boolean(marks.holiday);
      const element = h("div", { class: `r${day === today() ? " today" : ""}${weekendOf(day, marks.holiday) ? " we" : ""}`, "data-day": day, title: marks.holiday ?? "" },
        B(h("span", { class: `w ${red ? "sun" : ""}`.trim() }, weekdayShort(date.getDay(), lang()))),
        B(h("span", { class: `n num ${red ? "sun" : ""}`.trim() }, String(date.getDate()))),
        h("span", { class: "x" }, marks.holiday ? h("span", { class: "hol-in" }, h("span", { class: "hflag", "aria-hidden": "true" }, "⚑"), marks.holiday) : null,
          first ? B(row.first?.time ? h("span", { class: "tm" }, row.first.time) : null, first) : null),
        row.more > 0 ? B(moreButton(row.more, day)) : h("span"), lunarOfDay(marks) ?? h("span"));
      element.addEventListener("click", () => openDay(day));
      return { element, key: [day, row, marks] };
    });
    return { key: JSON.stringify(rows.map((row) => row.key)), nodes: [title, h("div", { class: "wkrows" }, ...rows.map((row) => row.element))] };
  }
  const columns = days.map((day) => {
    const date = fromKey(day)!;
    const sunday = date.getDay() === 0;
    const found = dots(day, data.events, data.tasks);
    const marks = found.colors.map((color) => { const dot = h("i"); dot.style.setProperty("--color", dotColor(color)); return dot; });
    const holiday = marksOf(day).holiday;
    const column = h("div", { class: `c bk${day === today() ? " today" : ""}${weekendOf(day, holiday) ? " we" : ""}`, "data-day": day, title: holiday ?? "",
      "aria-label": [`${weekdayName(date.getDay(), lang())} ${date.getDate()}`, holiday].filter(Boolean).join(", ") },
      h("span", { class: `w ${sunday || holiday ? "sun" : ""}`.trim() }, weekdayLetter(date.getDay(), lang())), numberOf(day, sunday || Boolean(holiday)),
      h("span", { class: "dots" }, ...marks, found.plus ? h("em", {}, "+") : null));
    column.addEventListener("click", () => openDay(day));
    return { column, key: [day, found, holiday] };
  });
  const up = upcoming(today(), data.events, data.tasks, now, 2, lang());
  const lines = up.lines.length ? up.lines.map((line) => lineOf(line, today())) : [h("div", { class: "empty" }, B(emptyText(lang())))];
  return { key: JSON.stringify([columns.map((column) => column.key), up]), nodes: [title, h("div", { class: "wkcols" }, ...columns.map((column) => column.column)), ...lines] };
}

/** 이번 달: 간단히 — six weeks, a number and three dots a day; 자세히 — two titles a day and +N. */
function monthBody(data: NonNullable<ReturnType<typeof model>>): { key: string; nodes: Node[] } {
  const { year, month } = shiftedMonth(today(), offset);
  const days = monthGrid(year, month, lang());
  const style = settings!.style;
  const detail = style === "detail" || style === "wall";
  const grid = h("div", { class: "mgrid" }, ...weekdayOrder(lang()).map((weekday) => h("div", { class: "wd" }, B(h("span", { class: weekday === 0 ? "sun" : "" }, weekdayLetter(weekday, lang()))))));
  const keys: unknown[] = [];
  // A holiday's name takes a line's room; 벽 달력 four lines. calendar-flows D1: a trip's band joins along each week row.
  const found = days.map((day) => {
    const marks = marksOf(day);
    // #296: the faded daily · weekday repeats are counted in the head (`folded`), not written as lines (nor dots).
    return { day, marks, holiday: Boolean(marks.holiday), folded: foldedRepeats(day, data.tasks, lang()),
      ...(detail ? cellItems(day, data.events, data.tasks, Math.max(1, linesOf(style) - (marks.holiday ? 1 : 0)), lang(), true) : { items: [], more: 0 }) };
  });
  const rowBands = detail ? Array.from({ length: 6 }, (_, week) => weekBands(found.slice(week * 7, week * 7 + 7))).flat() : [];
  found.forEach(({ day, marks, items, more, folded }, index) => {
    const date = fromKey(day)!;
    const outside = date.getMonth() + 1 !== month;
    const sunday = date.getDay() === 0 || Boolean(marks.holiday);
    const repeats = foldedLabel(folded, lang());
    const cell = h("div", { class: `cl${outside ? " dim" : ""}${day === today() ? " today" : ""}${weekendOf(day, marks.holiday) ? " we" : ""}`, "data-day": day,
      ...(marks.holiday ? { title: marks.holiday } : {}), ...(repeats ? { "aria-label": [dayTitle(day, lang()), marks.holiday, repeats].filter(Boolean).join(", ") } : {}) });
    if (detail) {
      keys.push([day, marks, items.map((item) => (item.kind === "event" ? item.event.key + item.event.color : item.task.taskId + item.task.kind + (item.task.ahead ? "~" : "") + (item.task.kind === "repeat" ? item.task.title : ""))), more,
        folded.map((task) => (task.time ?? "") + task.title)]);
      const lead = marks.holiday ? 1 : 0;
      const lines = items.map((item, line) => {
        const element = cellLine(item, day, rowBands[index]?.[line], line + lead);
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          if (item.kind === "task") openTask(item.task, day);
          else void api.act({ type: "openCalendar", day, event: item.event.key });
        });
        return B(element);
      });
      // #296: the repeat mark beside the number; #295: what the head has room for is worked out after layout (fitHead).
      cell.append(h("div", { class: "head" }, B(numberOf(day, sunday)), folded.length ? B(repeatMark(folded)) : null, more > 0 ? B(moreButton(more, day)) : null, lunarOfDay(marks)),
        ...(marks.holiday ? [holidayLine(marks.holiday, marks.holidayShown)] : []), h("div", { class: "lines" }, ...lines));
    } else {
      const spots = dots(day, data.events, data.tasks, true);
      keys.push([day, spots, marks.holiday, repeats]);
      const marksOfDay = spots.colors.map((color) => { const dot = h("i"); dot.style.setProperty("--color", dotColor(color)); return dot; });
      cell.append(B(numberOf(day, sunday), h("span", { class: "dots" }, ...marksOfDay, spots.plus ? h("em", {}, "+") : null)));
    }
    cell.addEventListener("click", () => openDay(day));
    grid.append(cell);
  });
  return { key: JSON.stringify(keys), nodes: [header(monthTitle(year, month, lang()), "month"), grid] };
}

/** 오늘 목록 (200 × 360): today and tomorrow in time order, as many lines as fit (the rest +N), and + 넣기. */
function agendaBody(data: NonNullable<ReturnType<typeof model>>, now: Date): { key: string; nodes: Node[] } {
  const parts = agenda(today(), data.events, data.tasks, now, lang());
  let budget = 11;
  const nodes: Node[] = [header(dayTitle(today(), lang()))];
  parts.forEach((part, index) => {
    const date = fromKey(part.day)!;
    const marks = marksOf(part.day);
    const name = index === 0 ? dayWord(0, lang())! : `${dayWord(1, lang())} · ${weekdayName(date.getDay(), lang())}`;
    nodes.push(h("div", { class: "sh" }, B(name, marks.holiday ? h("span", { class: "hol-in" }, ` · ${marks.holiday}`) : null), lunarOfDay(marks)));
    if (part.lines.length === 0) { nodes.push(h("div", { class: "empty" }, B(index === 0 ? emptyText(lang()) : t("아직 아무것도 없어요")))); budget -= 1; return; }
    // Today leaves tomorrow its first line (and its +N).
    const room = index === 0 && parts[1].lines.length > 0 ? budget - Math.min(2, parts[1].lines.length) : budget;
    const fit = part.lines.length > room ? Math.max(0, room - 1) : part.lines.length;
    for (const line of part.lines.slice(0, fit)) nodes.push(lineOf(line, part.day));
    if (fit < part.lines.length) nodes.push(h("div", { class: "ln" }, B(moreButton(part.lines.length - fit, part.day))));
    budget -= fit + (fit < part.lines.length ? 1 : 0);
  });
  const add = h("button", { class: "addbtn" }, t("+ 넣기"));
  add.addEventListener("click", (event) => { event.stopPropagation(); openDay(today()); });
  nodes.push(add);
  return { key: JSON.stringify([parts, parts.map((part) => marksOf(part.day))]), nodes };
}


// ─── The look: size, ears, how solid ──────────────────────────────────────────

function layout(): void {
  if (!settings) return;
  const { width, height } = widgetSize(settings.kind, settings.style);
  const earHeight = earHeightOf(settings.kind, settings.style);
  const k = earScale(settings.kind, settings.style);
  root.className = `wg k-${settings.kind} s-${settings.style}${settings.locked ? " locked" : ""}`;
  // 크기 (#271): laid out at 보통 and drawn `scale` times as big from the paper's top left (the ears above it too), so
  // every cell keeps its lines; the window is that much bigger (main/calendarWidget.ts).
  Object.assign(root.style, {
    left: `${room}px`, top: `${room + earHeight * scale}px`, width: `${width}px`, height: `${height}px`,
    transform: scale === 1 ? "" : `scale(${scale})`, transformOrigin: "0 0",
  });
  root.dataset.scale = String(scale);
  // The note's ears, scaled: drawn in the note's own numbers in a box `1/k` as wide, standing on the paper's top edge.
  const boxWidth = width / k;
  const edge = earsRoom + 16;
  earsSvg.setAttribute("viewBox", `0 0 ${boxWidth} ${edge + earsOverlap}`);
  earsSvg.setAttribute("width", String(width));
  earsSvg.setAttribute("height", String((edge + earsOverlap) * k));
  earsSvg.style.top = `${-edge * k}px`;
  earsSvg.setAttribute("role", "button");
  earsSvg.setAttribute("aria-label", t("위젯 메뉴"));
  earsSvg.replaceChildren(...earPaths(boxWidth, edge, earsOverlap).map((ear, index) => {
    const group = document.createElementNS(svgNS, "g");
    group.setAttribute("class", `one ${index === 0 ? "left" : "right"}`);
    group.style.transformOrigin = `${(ear.a + ear.b) / 2}px ${edge}px`;
    group.innerHTML = `<path class="ear" d="${ear.ear}"/><path class="ear-edge" d="${ear.sides}"/><path class="ear-in" d="${ear.inner}"/>`;
    return group;
  }));
  const title = document.createElementNS(svgNS, "title");
  title.textContent = t("위젯 메뉴");
  earsSvg.prepend(title);
  look();
}

/** How solid the paper is now, and the classes that keep the text readable at that (O1–O8). */
function look(): void {
  if (!settings) return;
  const drawn = drawnOpacity(settings.opacity, reduceTransparency.matches, hovering, settings.solidOnHover);
  root.style.setProperty("--op", String(drawn / 100));
  root.style.setProperty("--edge", String(edgeStrength(drawn)));
  root.style.setProperty("--tile", String(tile(drawn, floor) / 100));
  root.style.setProperty("--tile-we", String(tile(drawn, weekendFloor) / 100));
  root.style.setProperty("--floor", String(floor / 100));
  root.classList.toggle("fd", inkOnly(drawn));
  root.classList.toggle("pl", backing(drawn, floor));
  root.classList.toggle("ha", halo(drawn));
  root.classList.toggle("bo", bolder(drawn));
  root.classList.toggle("hover", hovering);
  root.classList.toggle("paged", offset !== 0);
  earsSvg.style.opacity = String(earOpacity(drawn) / 100);
}

// ─── The mouse ────────────────────────────────────────────────────────────────

let interactive = false;
function setInteractive(value: boolean): void {
  if (interactive === value) return;
  interactive = value;
  api.send("widget:interactive", value);
}

function setHover(value: boolean): void {
  window.clearTimeout(leaveTimer);
  if (value === hovering) return;
  if (value || reduceMotion()) { hovering = value; look(); return; }
  // Back to its own opacity a moment after the pointer left (none with reduced motion).
  leaveTimer = window.setTimeout(() => { hovering = false; look(); }, 600);
}

const insidePaper = (x: number, y: number) => {
  const rect = paperBox.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
};

window.addEventListener("mousemove", (event) => {
  // Snapshots: a still picture (the hover state is set from the main process).
  if (!settings || preview || press?.dragging) return;
  if (removed) { setInteractive(Boolean((event.target as Element).closest(".wtoast"))); return; }
  const overEar = Boolean((event.target as Element).closest?.(".ear"));
  const overPaper = insidePaper(event.clientX, event.clientY);
  if (overEar || event.ctrlKey) unlocked = true;
  if (!overPaper && !overEar) unlocked = false;
  const takes = overEar || (overPaper && (!settings.clickThrough || unlocked));
  setInteractive(takes);
  setHover(takes);
});
document.addEventListener("mouseleave", () => { unlocked = false; setInteractive(false); setHover(false); });

/** The ears (and the header): a press and a drag moves the widget (unless 위치 고정), a click opens its menu. */
let press: { x: number; y: number; dragging: boolean; ear: boolean } | undefined;
window.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || removed) return;
  const ear = Boolean((event.target as Element).closest(".ear"));
  const head = Boolean((event.target as Element).closest(".hd")) && !(event.target as Element).closest("button, .t");
  if (!ear && !head) return;
  press = { x: event.screenX, y: event.screenY, dragging: false, ear };
  (event.target as Element).setPointerCapture?.(event.pointerId);
});
window.addEventListener("pointermove", (event) => {
  if (!press || !settings) return;
  if (!press.dragging && !settings.locked && Math.hypot(event.screenX - press.x, event.screenY - press.y) >= 4) {
    press.dragging = true;
    api.send("widget:drag-start");
  }
  if (press.dragging) api.send("widget:drag");
});
window.addEventListener("pointerup", () => {
  if (!press) return;
  const { dragging, ear } = press;
  press = undefined;
  if (dragging) api.send("widget:drag-end");
  else if (ear) { twitch(1); api.send("widget:menu"); }
});
window.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (!removed && interactive) api.send("widget:menu");
});

let lastTwitch: number | undefined;
function twitch(index: number): void {
  if (reduceMotion() || !mayTwitch(lastTwitch, Date.now())) return;
  lastTwitch = Date.now();
  const ear = earsSvg.querySelectorAll<SVGGElement>(".one")[index];
  if (!ear) return;
  ear.classList.remove("twitch");
  void ear.getBoundingClientRect();
  ear.classList.add("twitch");
}

// ─── ‹ › and the way back ─────────────────────────────────────────────────────

function page(direction: -1 | 0 | 1): void {
  offset = direction === 0 ? 0 : offset + direction;
  touched = Date.now();
  window.clearTimeout(backTimer);
  if (offset !== 0) backTimer = window.setTimeout(() => { offset = pageOffset(offset, new Date(touched), new Date()); look(); draw(); }, 120_000 + 50);
  look();
  draw();
}

// ─── The toast ────────────────────────────────────────────────────────────────

let toastTimer: number | undefined;
/** `fromList`: its 되돌리기 takes back something put in — it waits while a question replaces the whole list (#253). */
function toast(text: string, undo: () => void, ms = 4000, fromList = false): void {
  root.querySelector(".wtoast")?.remove();
  window.clearTimeout(toastTimer);
  const action = h("button", {}, t("되돌리기"));
  const element = h("div", { class: "wtoast", role: "status" }, h("span", { class: "tx" }, text), action);
  action.addEventListener("click", (event) => {
    event.stopPropagation();
    if (fromList && waitsForAnswer("undo")) return;
    element.remove();
    undo();
  });
  root.append(element);
  toastTimer = window.setTimeout(() => element.remove(), ms);
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

api.on("widget:settings", (payload) => {
  const value = payload as { widget: WidgetSettings; room: number; preview?: boolean; scale?: number; wall?: string; hover?: boolean; offset?: number };
  const changedShape = !settings || settings.kind !== value.widget.kind || settings.style !== value.widget.style || scale !== (value.scale ?? 1);
  settings = value.widget;
  room = value.room;
  scale = value.scale ?? 1;
  preview = Boolean(value.preview);
  if (value.wall !== undefined) document.body.className = `widget-window${value.wall ? ` wall-${value.wall}` : ""}`;
  if (value.hover !== undefined) hovering = value.hover;
  // Snapshots: a page with holidays on it (‹ › away), held still.
  if (value.preview && value.offset !== undefined) { offset = value.offset; window.clearTimeout(backTimer); }
  if (removed && !value.preview) { removed = undefined; root.classList.remove("removed"); root.querySelector(".wtoast")?.remove(); }
  if (changedShape) drawnKey = "";
  readFloor();
  layout();
  draw();
});
api.on("state", (next) => { state = next as TodosState; draw(); });
api.on("paper", () => { requestAnimationFrame(() => { readFloor(); look(); }); });
reduceTransparency.addEventListener("change", () => look());
/** Put in from the day sheet: the toast (되돌리기) and a twitch of the ears. */
api.on("widget:made", (payload) => {
  const value = payload as { made: IntentMade; day: string; event: boolean; text: string; hiddenIn?: string; hiddenText?: string };
  twitch(0);
  const text = value.hiddenText ?? widgetAddedText(value.day, value.event, new Date(), lang());
  toast(text, () => void api.intent({ op: "undo", made: value.made }), 4000, true);
});
/** 위젯 제거 from its menu: only the toast, a moment, with 되돌리기. */
api.on("widget:removed", (payload) => {
  removed = payload as { widget: WidgetSettings; index: number };
  root.classList.add("removed");
  setHover(false);
  const back = removed;
  toast(t("위젯을 제거했어요"), () => void api.act({ type: "widgetRestore", widget: back.widget, index: back.index }), 4_300);
});
void api.getState().then((initial) => { state = initial as unknown as TodosState; draw(); });
api.send("widget:ready");

listenForTyping();
