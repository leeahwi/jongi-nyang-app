import { allDayText, fetchRange, repeatWord } from "../core/calendar";
import { candidateDay, holidayWord, lineOver, lineSpoken, quickCandidates, sheetLines, sheetTitle, stepDay, widgetChip, type WidgetLine } from "../core/calendarWidget";
import { expand } from "../core/events";
import type { Candidate } from "../core/intent";
import { addedHidden, deviceLens, hiddenSpaces, readDeviceRules } from "../core/spaceDevice";
import { activeLens } from "../core/todoSpaces";
import { bodyFontSize, type IntentMade, type TodosState } from "../core/types";
import { h, icon, lang, paper, t } from "./api";
import { calendarTasks, dayMarks } from "./calendarCells";
import { InputLine } from "./inputLine";
import { toWire } from "./intentFlow";
import { appear, keyCap, slipHead, tape } from "./slip";
import { listenForTyping } from "./typingTap";
import { askedUp, onAsked, tellAsked, waitsForAnswer } from "./widgetAsk";

/**
 * 바탕화면 위젯의 날짜 쪽지 (#234): the day a widget's day (or +N, or +) was clicked for — every event and to-do of it
 * with its time, also what is over (a busy day can always be read in full), and the input line read on that day: no day
 * written → that day; a day written (‘내일 3시’) → that day, read from today; an alarm → a to-do with a reminder. Tab
 * switches to-do and event, Enter puts the picked one in, Shift+Enter as a to-do, Ctrl+Enter as an event, Alt+← · Alt+→
 * the day before or after, Esc closes. What was put in shows as the widget's toast (되돌리기); Ctrl+Z here takes the
 * last one back while it is fresh. A line opens what it is (the desk's calendar on the day, or the note on the row).
 * #253: a question doesn't hold it up (widgetAsk.ts): it reads and turns the days as ever; while the question replaces the
 * whole list, ↩ 넣기 dims and says why, and Enter or Ctrl+Z bring the question forward instead (the text stays).
 */
const api = paper();
const stage = document.getElementById("stage")!;
const card = document.getElementById("card")!;
let state: TodosState | undefined;
let day = "";
let last: { made: IntentMade; text: string; at: number } | undefined;

const close = () => api.send("widgetSheet:close");
const lens = () => (state ? deviceLens(activeLens(state.prefs.spaceLens ?? undefined, state.todoSpaces, new Date()), hiddenSpaces(readDeviceRules(state.prefs.spaceDevice), state.todoSpaces, new Date())) : undefined);

const line = new InputLine({
  variant: "slip",
  placeholder: () => ({ long: t("할 일이나 일정을 적어요"), short: t("할 일이나 일정을 적어요") }),
  spaces: () => (state ? { data: state.todoSpaces, lens: lens() } : undefined),
  read: (text) => (day ? quickCandidates(text, day, new Date(), lang()) : []),
  chip: (candidate) => widgetChip(candidate, new Date(), lang()),
  onShiftEnter: () => {
    const index = line.readings.findIndex((candidate) => candidate.kind === "todo");
    if (index < 0) return;
    line.pick(index);
    void line.submit();
  },
  commit: async (candidate: Candidate, candidates: Candidate[], text, space) => {
    if (waitsForAnswer("add")) return false;
    const result = await api.intent({ op: "commit", candidate: toWire(candidate), page: "today", from: "widget", candidates: candidates.map(toWire), text, ...(space ? { space } : {}) });
    if (!result.made) return false;
    last = { made: result.made, text, at: Date.now() };
    api.send("widgetSheet:made", {
      made: result.made, day: candidateDay(candidate, new Date()), event: candidate.kind === "event", text,
      ...(result.hiddenIn !== undefined ? { hiddenText: addedHidden(result.hiddenIn, lang()) } : {}),
    });
    return true;
  },
  onEscape: (event) => { event.preventDefault(); close(); },
  onChange: () => fit(),
});
line.field.setAttribute("aria-label", t("날짜 쪽지"));

const head = slipHead({ icon: "calendar", tint: "event", title: "", onClose: close, closeLabel: t("닫기") });
const previous = h("button", { "aria-label": t("이전 날"), title: t("이전 날") }, icon("chevronLeft", 13, 2.2));
const next = h("button", { "aria-label": t("다음 날"), title: t("다음 날") }, icon("chevronRight", 13, 2.2));
previous.addEventListener("click", () => go(-1));
next.addEventListener("click", () => go(1));
head.element.insertBefore(h("div", { class: "day-nav" }, previous, next), head.element.lastElementChild);
const list = h("div", { class: "dlist", role: "list" });
const put = h("span", {}, keyCap("↩"), t("넣기"));
const keys = h("span", { class: "keys" },
  put, h("span", {}, keyCap("Tab"), t("할 일 ↔ 일정")), h("span", {}, keyCap("Alt+←→"), t("다른 날")), h("span", {}, keyCap("Esc"), t("닫기")));
card.append(tape("event"), head.element, h("div", { class: "slip-body" }, list, line.element), h("div", { class: "slip-foot" }, keys));

/** #253: while a question replaces the whole list, ↩ 넣기 dims and the line says why (its tooltip, and what Narrator reads). */
function drawAsked(): void {
  const waiting = askedUp() === "replacesList";
  put.classList.toggle("waiting", waiting);
  const why = t("질문에 답하면 넣을 수 있어요");
  if (waiting) { put.title = why; line.field.setAttribute("aria-description", why); }
  else { put.removeAttribute("title"); line.field.removeAttribute("aria-description"); }
}
onAsked(drawAsked);
drawAsked();

/** The day's things, all of them, each opening what it is. */
function drawList(): void {
  head.title.textContent = day ? sheetTitle(day, lang()) : "";
  if (!state || !day) { list.replaceChildren(); return; }
  const { start, end } = fetchRange([day]);
  const now = new Date();
  const lines = sheetLines(day, expand(state.events, start, end, lang()), calendarTasks(state, [day], now), now, lang());
  // calendar-flows: the holiday's name first (‘공휴일 · 한글날’), as a month cell's first line.
  const holiday = dayMarks(day, state.prefs).holiday;
  const first = holiday ? [h("div", { class: "dl holiday", role: "listitem" }, h("span", { class: "hflag", "aria-hidden": "true" }, "⚑"), h("span", { class: "tm" }, holidayWord(lang())), h("span", { class: "tt" }, holiday))] : [];
  if (lines.length === 0) { list.replaceChildren(...first, h("div", { class: "none" }, t("아직 아무것도 없어요"))); return; }
  list.replaceChildren(...first, ...lines.map((entry) => row(entry, now)));
}

/**
 * A line of the day; what is over by now quieter (calendar-flows), and #274 a repeat after the next one. An event opens its
 * sheet in the desk's calendar (D3); a repeat without an open copy its rule (책상 → 반복).
 */
function row(entry: WidgetLine, now: Date): HTMLElement {
  const repeatRule = entry.kind === "repeat" && !entry.taskId;
  const time = entry.time ?? (entry.kind === "deadline" ? t("마감") : entry.kind === "repeat" ? repeatWord(false, lang()) : allDayText(lang()));
  const mark = h("span", { class: `mark ${entry.kind === "event" ? "" : entry.kind}`.trim(), "aria-hidden": "true" });
  if (entry.kind === "event") mark.style.setProperty("--color", entry.color);
  const spoken = lineSpoken(entry, lang());
  const element = h("button", {
    class: `dl${lineOver(entry, now) || entry.ahead ? " over" : ""}`, role: "listitem",
    title: entry.taskId ? t("노트에서 보기") : repeatRule ? t("반복 할 일 보기") : t("달력에서 열기"), ...(spoken ? { "aria-label": spoken } : {}),
  }, mark, h("span", { class: "tm" }, time), h("span", { class: "tt" }, entry.title));
  element.addEventListener("click", () => {
    if (entry.taskId) void api.act({ type: "calendarShowTask", id: entry.taskId });
    else if (repeatRule) void api.act({ type: "openSettings", tab: "repeat" });
    else void api.act({ type: "openCalendar", day, ...(entry.eventKey ? { event: entry.eventKey } : {}) });
    close();
  });
  return element;
}

function go(days: number): void {
  if (!day) return;
  day = stepDay(day, days);
  drawList();
  line.refresh();
  line.focus();
}

/** The window follows the slip (its tape and shadow around it). */
let lastSize = "";
function fit(): void {
  const rect = stage.getBoundingClientRect();
  const size = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  const key = `${size.width}x${size.height}`;
  if (key === lastSize || size.width === 0) return;
  lastSize = key;
  api.send("widgetSheet:size", size);
}
new ResizeObserver(fit).observe(stage);

window.addEventListener("keydown", (event) => {
  if (event.isComposing) return;
  if (event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) { event.preventDefault(); go(event.key === "ArrowLeft" ? -1 : 1); return; }
  // Ctrl+Z with nothing typed: the last thing put in from here goes (while its toast could still be up), its text back.
  if (event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "z" && !line.value && last && Date.now() - last.at < 8_000) {
    event.preventDefault();
    if (waitsForAnswer("undo")) return;
    const { made, text } = last;
    last = undefined;
    void api.intent({ op: "undo", made });
    line.set(text);
    return;
  }
  if (event.key === "Escape") { event.preventDefault(); close(); }
}, true);

function applyState(next: TodosState): void {
  state = next;
  document.documentElement.dataset.font = next.prefs.font;
  document.documentElement.style.setProperty("--body-size", `${bodyFontSize(next.prefs.font, "regular")}px`);
  drawList();
}
api.on("state", (next) => applyState(next as TodosState));
api.on("widgetSheet:open", (payload) => {
  const value = (payload ?? {}) as { day?: string; text?: string; up?: unknown };
  if (!value.day) return;
  tellAsked(value.up);
  day = value.day;
  drawList();
  if (value.text !== undefined) line.set(value.text); else line.refresh();
  appear(card);
  line.focus();
});
void api.getState().then((initial) => applyState(initial as unknown as TodosState));

listenForTyping();
