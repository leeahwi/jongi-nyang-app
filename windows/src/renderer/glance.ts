import { logicalDayStart } from "../core/archive";
import { expand } from "../core/events";
import { alarmHint, glanceCards, glanceTasks, timerHint, type GlanceCard, type GlanceTimer } from "../core/glance";
import { clock } from "../core/lang";
import type { TodoItem } from "../core/notebook";
import { pageOf } from "../core/shelf";
import { rangeText, rangeToday } from "../core/timeRange";
import { bodyFontSize, type AppState } from "../core/types";
import { h, icon, lang, paper, reduceMotion, t } from "./api";
import { InputLine } from "./inputLine";
import { commitReading, type FlowHost } from "./intentFlow";
import { appear, toaster } from "./slip";

/**
 * 오늘 창 (the tray's window; the Mac's menu bar popover): the next event, the timer and the next
 * alarm as three cards (the urgent one clay), today's tasks with 다음 first and working checkboxes,
 * the input line (its toast shows here), and 노트 열기 · 책상 · 종이냥 숨기기/보이기. Esc or a click
 * elsewhere closes it.
 */
const api = paper();
const stage = document.getElementById("stage")!;
const card = document.getElementById("card")!;
let state: AppState | undefined;
/** Tasks just checked here: they stay a moment, done, so the check is seen before they go. */
const finishing = new Set<string>();

const close = () => api.send("glance:close");

const cards = h("div", { class: "cards3", role: "group", "aria-label": t("오늘 창") });
const tasks = h("div", { class: "g-tasks", role: "list" });
const more = h("button", { class: "g-more" });
more.addEventListener("click", () => { void api.act({ type: "openNote" }); close(); });
const toastHost = h("div", { class: "g-toast" });
const toast = toaster(toastHost);
const flow: FlowHost = { toast, page: () => "today", restore: (text) => { line.set(text); line.focus(); } };
const line = new InputLine({
  variant: "note",
  placeholder: () => ({ long: t("무엇이든 적어요"), short: t("무엇이든 적어요") }),
  prefer: () => state?.prefs.intentPrefer ?? {},
  commit: async (candidate, candidates, text) => Boolean((await commitReading(flow, candidate, candidates, text, "glance")).made),
  onEscape: (event) => { event.preventDefault(); if (line.value) line.clear(); else close(); },
});
const links = h("div", { class: "g-links" });
card.append(cards, tasks, h("div", { class: "g-line" }, toastHost, line.element), links);

// Esc anywhere (the toast takes it first while it is up) closes the window.
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close(); }
});

/** The window's size follows the slip (with its shadow and the room around it). */
const report = () => {
  const rect = stage.getBoundingClientRect();
  api.send("glance:size", { width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
};
new ResizeObserver(report).observe(stage);

/** The timer as the cards take it, now. */
function timerNow(): GlanceTimer | undefined {
  const view = state?.timer;
  if (!view) return undefined;
  return {
    remainingMs: view.endsAt !== undefined ? Math.max(0, view.endsAt - Date.now()) : view.pausedRemainingMs ?? 0, paused: view.endsAt === undefined, caption: view.caption, countdown: view.countdown,
    // 집중: the card says the task.
    ...(state?.focus ? { focus: state.focus.title } : {}),
  };
}

function cardElement(entry: GlanceCard): HTMLElement {
  const element = h("div", { class: `c3 ${entry.kind}${entry.hot ? " hot" : ""}${entry.empty ? " empty" : ""}` },
    h("small", {}, entry.label), h("b", {}, entry.big), h("span", { class: "c3-small", title: entry.small }, entry.small));
  if (entry.kind === "timer" && !entry.empty) {
    // Pause (or go on) and stop, over the card's corner.
    const paused = Boolean(state?.timer && state.timer.endsAt === undefined);
    const toggle = h("button", { class: "c3-tool", title: paused ? t("계속") : t("일시정지"), "aria-label": paused ? t("계속") : t("일시정지") }, icon(paused ? "play" : "pause", 12, 2));
    const stop = h("button", { class: "c3-tool", title: t("멈추기"), "aria-label": t("멈추기") }, icon("stop", 12, 2));
    toggle.addEventListener("click", () => api.act({ type: "timerCommand", command: { kind: "togglePause" } }));
    stop.addEventListener("click", () => api.act({ type: "timerCommand", command: { kind: "stop" } }));
    element.append(h("span", { class: "c3-tools" }, toggle, stop));
  }
  // Every card leads somewhere: the event opens (none today: a new one), an empty timer or alarm puts what it
  // suggests into the line below (“타이머 25”, “알람 7시”), an alarm opens 시계.
  const action = entry.kind === "event" && entry.key ? () => { void api.act({ type: "calendarEditEvent", key: entry.key! }); close(); }
    : entry.kind === "event" && entry.empty ? () => { void api.act({ type: "calendarNewEvent" }); close(); }
    : entry.kind === "timer" && entry.empty ? () => { line.set(timerHint(lang())); line.focus(); }
    : entry.kind === "alarm" && entry.empty ? () => { line.set(alarmHint(lang())); line.focus(); }
    : entry.kind === "alarm" ? () => { void api.act({ type: "openSettings", tab: "clock" }); close(); }
    : undefined;
  if (action) {
    element.classList.add("link");
    element.tabIndex = 0;
    element.setAttribute("role", "button");
    element.setAttribute("aria-label", `${entry.label}: ${entry.big === "—" ? "" : `${entry.big} `}${entry.small}`);
    element.addEventListener("click", (event) => { if (!(event.target as HTMLElement).closest(".c3-tool")) action(); });
    element.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); action(); } });
  }
  return element;
}

const STRIKE_PATH = "M0 0.56 C0.12 0.5 0.22 0.6 0.34 0.54 S0.58 0.5 0.7 0.57 S0.9 0.52 1 0.55";

/** The rows on screen: a row playing its check is kept as it is while the state catches up. */
const rowCache = new Map<string, HTMLElement>();

function taskRow(item: TodoItem, next: boolean): HTMLElement {
  const kept = rowCache.get(item.id);
  if (kept && finishing.has(item.id)) return kept;
  const done = item.isCompleted;
  const box = h("span", { class: "box" }, icon("check", 12, 2.6));
  const check = h("button", { class: "check", "aria-label": done ? t("{title} 완료 취소", { title: item.title }) : t("{title} 완료", { title: item.title }) }, box);
  const label = h("span", { class: "label", title: item.title }, item.title);
  const strike = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  strike.setAttribute("class", "strike");
  strike.setAttribute("viewBox", "0 0 1 1");
  strike.setAttribute("preserveAspectRatio", "none");
  strike.innerHTML = `<path vector-effect="non-scaling-stroke" d="${STRIKE_PATH}"/>`;
  label.append(strike);
  // 시간 정하기: a task with hours today says them (clock), wherever it is listed; else 다음's reminder time.
  const ranged = rangeToday(item, new Date());
  const meta = ranged ? h("span", { class: "meta" }, icon("clock", 12), rangeText(ranged.range, lang()))
    : next && item.reminderAt ? h("span", { class: "meta" }, icon("bell", 12), clock(new Date(item.reminderAt).getHours(), new Date(item.reminderAt).getMinutes(), lang())) : null;
  const row = h("div", { class: `g-row${done ? " done" : ""}`, role: "listitem", "data-id": item.id }, check, label, meta);
  check.addEventListener("click", () => {
    if (item.isCompleted) return;
    finishing.add(item.id);
    row.classList.add("done");
    if (!reduceMotion()) row.classList.add("pop");
    void api.act({ type: "toggle", id: item.id });
    setTimeout(() => { finishing.delete(item.id); render(); }, reduceMotion() ? 300 : 700);
  });
  rowCache.set(item.id, row);
  return row;
}

function render(): void {
  if (!state) return;
  const now = new Date();
  const root = document.documentElement;
  root.dataset.font = state.prefs.font;
  root.style.setProperty("--body-size", `${bodyFontSize(state.prefs.font, "regular")}px`);
  // Events from today on (the next one may be days away).
  const start = logicalDayStart(now);
  const events = expand(state.events ?? [], start, new Date(start.getTime() + 8 * 86_400_000), lang());
  cards.replaceChildren(...glanceCards(events, timerNow(), state.alarms ?? [], new Set(state.prefs.alarmHandled ?? []), now, lang()).map(cardElement));

  // Today's tasks: just-checked ones keep their place for a moment.
  const today = state.items.filter((item) => pageOf(item, now) === "today");
  const shown = today.map((item) => (finishing.has(item.id) ? { ...item, isCompleted: false } : item));
  const { next, rest, hidden } = glanceTasks(shown, now);
  const real = (item: TodoItem) => today.find((entry) => entry.id === item.id) ?? item;
  const rows: HTMLElement[] = [];
  if (next.length && rest.length) rows.push(h("div", { class: "g-head", role: "heading", "aria-level": "3" }, t("다음")));
  rows.push(...next.map((item) => taskRow(real(item), true)));
  if (next.length && rest.length) rows.push(h("div", { class: "g-head", role: "heading", "aria-level": "3" }, t("그 밖에")));
  rows.push(...rest.map((item) => taskRow(real(item), false)));
  if (!next.length && !rest.length) rows.push(h("div", { class: "g-empty" }, today.length ? t("오늘 한 장 끝! 수고했어요") : t("오늘 할 일을 한 줄 적어 볼까요?")));
  more.textContent = t("외 {n}개 · 노트에서 보기", { n: hidden });
  more.hidden = hidden === 0;
  for (const id of [...rowCache.keys()]) if (!rows.some((row) => row.dataset.id === id)) rowCache.delete(id);
  tasks.replaceChildren(...rows, more);

  // Each with its small icon (as on the Mac), so they read as buttons.
  const link = (label: string, symbol: string, run: () => void) => {
    const element = h("button", { class: "g-link", title: label }, icon(symbol, 12), h("span", {}, label));
    element.addEventListener("click", run);
    return element;
  };
  links.replaceChildren(
    link(t("노트 열기"), "note", () => { void api.act({ type: "openNote" }); close(); }),
    link(t("책상"), "desk", () => { void api.act({ type: "openCalendar" }); close(); }),
    link(state.prefs.petVisible ? t("종이냥 숨기기") : t("종이냥 보이기"), "paw", () => api.act({ type: "setPref", key: "petVisible", value: !state!.prefs.petVisible })),
  );
}

/** The cards count down while the window is up. */
setInterval(() => {
  if (document.visibilityState !== "visible" || !state) return;
  const timer = timerNow();
  const shownTimer = cards.querySelector(".c3.timer b");
  if (timer && shownTimer) {
    const next = glanceCards([], timer, [], new Set(), new Date(), lang())[1].big;
    if (shownTimer.textContent !== next) shownTimer.textContent = next;
  }
}, 1000);
setInterval(() => { if (document.visibilityState === "visible") render(); }, 30_000);

api.on("state", (next) => { state = next as AppState; render(); });
api.on("glance:open", () => {
  void api.getState().then((initial) => {
    state = initial;
    toast.hide();
    render();
    appear(card);
    line.refresh();
    line.focus();
  });
});
void api.getState().then((initial) => { state = initial; render(); report(); });
