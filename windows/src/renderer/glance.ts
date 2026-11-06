import { logicalDayStart } from "../core/archive";
import { expand } from "../core/events";
import { alarmHint, glanceCards, glanceChip, glanceDate, glanceLayout, glanceProgress, glanceRowCap, glanceTasks, timerHint, type GlanceCard, type GlanceTimer } from "../core/glance";
import { clock } from "../core/lang";
import type { TodoItem } from "../core/notebook";
import { pageOf } from "../core/shelf";
import { rangeText, rangeToday } from "../core/timeRange";
import { bodyFontSize, type TodosState } from "../core/types";
import { activeLens, findSpace, generalName, groupedCount, inLens, lensNone, lensTasks, spaceColor, spaceIndexOf, type TodoSpace } from "../core/todoSpaces";
import { deviceKey, deviceLens, hiddenSpaces, readDeviceRules } from "../core/spaceDevice";
import { h, holdMs, icon, lang, motion, paper, reduceMotion, t } from "./api";
import { listenForTyping } from "./typingTap";
import { holdWhileAsked } from "./askGuard";
import { InputLine } from "./inputLine";
import { commitReading, type FlowHost } from "./intentFlow";
import { appear, toaster } from "./slip";

// #229: a question waiting holds this page up (askGuard.ts).
holdWhileAsked();

/**
 * 오늘 창 (the tray's window; the Mac's menu bar popover): the date and today's progress; the next event, the timer
 * and the next alarm — the ones with something in them as cards (the urgent one clay), the empty ones as a row of
 * chips (#200); today's tasks with 다음 first, seven rows at most, working checkboxes and titles that open the note on
 * their row; the input line (its toast shows here), and 노트 열기 · 책상 · 종이냥 숨기기/보이기. Esc or a click
 * elsewhere closes it.
 */
const api = paper();
const stage = document.getElementById("stage")!;
const card = document.getElementById("card")!;
let state: TodosState | undefined;
/** Tasks just checked here: they stay a moment, done, so the check is seen before they go. */
const finishing = new Set<string>();

const close = () => api.send("glance:close");

const top = h("div", { class: "g-top", role: "heading", "aria-level": "2" });
const barFill = h("i");
const bar = h("div", { class: "g-bar", "aria-hidden": "true" }, barFill);
const cards = h("div", { class: "g-cards", role: "group", "aria-label": t("오늘 창") });
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
  // 할 일 스페이스: `#회사` puts the to-do there (W15: the lens isn't this line's — only the note's line follows it).
  spaces: () => (state ? { data: state.todoSpaces } : undefined),
  commit: async (candidate, candidates, text, space) => Boolean((await commitReading(flow, candidate, candidates, text, "glance", space)).made),
  onEscape: (event) => { event.preventDefault(); if (line.value) line.clear(); else close(); },
});
const links = h("div", { class: "g-links" });
card.append(top, cards, tasks, h("div", { class: "g-line" }, toastHost, line.element), links);

// Esc anywhere (the toast takes it first while it is up) closes the window.
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close(); }
});

/**
 * The window's size follows the slip (with its shadow and the room around it). Measured after every
 * redraw too: a hidden window gets no ResizeObserver callbacks, so a slip that grew while it was hidden (a
 * timer started, a card's line wrapping to two) would otherwise first show cut off in the old size.
 */
let reported = "";
const report = () => {
  const rect = stage.getBoundingClientRect();
  const size = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
  const key = `${size.width}x${size.height}`;
  if (key === reported || size.width === 0) return;
  reported = key;
  api.send("glance:size", size);
};
new ResizeObserver(report).observe(stage);

/**
 * #200: the work area's height, for how many to-do rows fit (`glanceRowCap`). The snapshots stand a short screen in
 * with `data-room` on the page (then the "glance-room" event redraws).
 */
function rowRoom(): number | undefined {
  const asked = Number(document.documentElement.dataset.room);
  if (Number.isFinite(asked) && asked > 0) return asked;
  return window.screen.availHeight > 0 ? window.screen.availHeight : undefined;
}
window.addEventListener("glance-room", () => render());

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

/**
 * #136: a card's second line keeps its first part whole — "3시간 40분 뒤", "in 3 h 40 min" never break between a number and
 * its unit — and only what follows the " · " (the event's name) goes to the next line. No-break spaces inside it, a word
 * joiner after each number (the CSS keeps Korean words whole too).
 */
function keepTogether(text: string): string {
  const at = text.indexOf(" · ");
  // A line with no " · " (a timer's ‘Ends at 12:46 PM’) is not one part to keep whole: only a time stays with its AM · PM
  // and a number with its unit, and it breaks at its other spaces (#240, 점검 3의 34 — it broke as ‘P’ / ‘M’).
  if (at < 0) return text.replace(/(\d) (?=\p{L})/gu, "$1\u00a0").replace(/(\d)(?=\p{L})/gu, "$1\u2060");
  const head = text.slice(0, at);
  return head.replace(/ /g, "\u00a0").replace(/(\d)(?=\p{L})/gu, "$1\u2060") + " · " + keepTail(text.slice(at + 3));
}

/** The name's last word stays with the one before it when it is short, so "점심 약속" goes down whole, not "점심" / "약속". */
function keepTail(name: string): string {
  const k = name.lastIndexOf(" ");
  return k > 0 && name.length - k - 1 <= 6 ? `${name.slice(0, k)}\u00a0${name.slice(k + 1)}` : name;
}

/**
 * #200: an empty card as a quiet chip in one row under the cards — none today → a new event (1.38); ‘타이머 25’ ·
 * ‘알람 7시’ into the line below. Read as the card was (‘타이머: ‘타이머 25’’).
 */
function chipElement(entry: GlanceCard): HTMLElement {
  const text = glanceChip(entry.kind, lang());
  const chip = h("button", { class: "chip g-chip", title: text, "aria-label": `${entry.label}: ${entry.small}` },
    icon(entry.kind === "event" ? "calendar" : entry.kind, 13), h("span", {}, text));
  chip.addEventListener("click", () => {
    if (entry.kind === "event") { void api.act({ type: "calendarNewEvent" }); close(); return; }
    line.set(entry.kind === "timer" ? timerHint(lang()) : alarmHint(lang()));
    line.focus();
  });
  return chip;
}

/** A card with something in it; one alone (`wide`, #200) lies flat across the window, its line beside the time. */
function cardElement(entry: GlanceCard, wide = false): HTMLElement {
  const element = h("div", { class: `c3 ${entry.kind}${entry.hot ? " hot" : ""}${entry.empty ? " empty" : ""}${wide ? " wide" : ""}` },
    h("small", {}, entry.label),
    // The timer's length with a small "남음" after it (#46).
    h("b", {}, entry.unit && entry.unitFirst ? h("span", { class: "c3-unit" }, `${entry.unit} `) : null, h("span", { class: "c3-big" }, entry.big),
      entry.unit && !entry.unitFirst ? h("span", { class: "c3-unit" }, ` ${entry.unit}`) : null),
    h("span", { class: "c3-small", title: entry.small }, keepTogether(entry.small)));
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
  // suggests into the line below (‘타이머 25’, ‘알람 7시’), an alarm opens 시계.
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
    const value = entry.unit ? (entry.unitFirst ? `${entry.unit} ${entry.big}` : `${entry.big} ${entry.unit}`) : entry.big;
    element.setAttribute("aria-label", `${entry.label}: ${entry.big === "—" ? "" : `${value} `}${entry.small}`);
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
  // #200: the title opens the note with this row picked (as a task on the calendar window does).
  const label = h("button", { class: "label", title: `${item.title}\n${t("노트에서 보기")}`, "aria-label": item.title, "aria-description": t("노트에서 보기") }, item.title);
  label.addEventListener("click", () => { void api.act({ type: "calendarShowTask", id: item.id }); close(); });
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
  // 2a (A5): a to-do in a space has its band at the row's left end (as on the note).
  const space = bandOf(item.id);
  const band = space ? h("span", { class: "g-band", title: space.name, role: "img", "aria-label": t("스페이스 {name}", { name: space.name }) }) : null;
  band?.style.setProperty("--band", `var(--band-${spaceColor(space!.color)})`);
  const row = h("div", { class: `g-row${done ? " done" : ""}`, role: "listitem", "data-id": item.id }, band, check, label, meta);
  check.addEventListener("click", () => {
    if (item.isCompleted) return;
    finishing.add(item.id);
    row.classList.add("done");
    if (!reduceMotion()) row.classList.add("pop");
    void api.act({ type: "toggle", id: item.id });
    // 체크 한 번 (T2): the note's 0.65 s hold (0.3 under Reduce Motion), then the row goes — folding away over 0.18 s
    // first (T3, as the note's and the Mac's), held in `finishing` meanwhile and taking no clicks.
    setTimeout(() => {
      if (reduceMotion() || document.hidden || !row.isConnected) { finishing.delete(item.id); render(); return; }
      row.style.height = `${row.offsetHeight}px`;
      row.classList.add("leaving");
      setTimeout(() => { row.classList.remove("leaving"); row.style.height = ""; finishing.delete(item.id); render(); }, motion.enter);
    }, holdMs());
  });
  rowCache.set(item.id, row);
  return row;
}

/** 2a (A5): each row's live space (its band), as of the last draw. */
let bandOf: (id: string) => TodoSpace | undefined = () => undefined;

/**
 * 2a (A5): the note's lens shows here too — under the to-dos, one small line: `● 회사만`, and when it hides open
 * to-dos ` · 다른 스페이스에 N개 더 · 모두 보기` (모두 보기 lets the lens go, everywhere).
 */
function lensLine(lens: string, hidden: number): HTMLElement {
  const data = state!.todoSpaces;
  const space = lens === lensNone ? undefined : findSpace(data, lens);
  const name = space?.name ?? generalName(data, lang());
  const dot = h("i", { class: `g-lens-dot${space ? "" : " none"}`, "aria-hidden": "true" });
  if (space) dot.style.setProperty("--band", `var(--band-${spaceColor(space.color)})`);
  const parts: HTMLElement[] = [dot, h("span", { class: "g-lens-name" }, t("{name}만", { name }))];
  if (hidden > 0) {
    const all = h("button", { class: "g-lens-all" }, t("모두 보기"));
    all.addEventListener("click", () => void api.act({ type: "spaceLens" }));
    const dotSep = () => h("span", { class: "g-lens-sep", "aria-hidden": "true" }, "·");
    // A16: never cut — when it doesn't fit on one line, this part goes to a second line under the name.
    parts.push(h("span", { class: "g-lens-tail" }, dotSep(), h("span", { class: "g-lens-more" }, t("다른 스페이스에 {n}개 더", { n: groupedCount(hidden, lang()) })), dotSep(), all));
  }
  return h("div", { class: "g-lens", role: "note" }, ...parts);
}

/** A16: the lens line on two lines (the name, then the rest) when one doesn't hold it whole. */
function fitLensLine(): void {
  const line = tasks.querySelector<HTMLElement>(".g-lens");
  if (!line) return;
  line.classList.remove("two");
  if (line.scrollWidth > line.clientWidth + 1) line.classList.add("two");
}

function render(): void {
  if (!state) return;
  const now = new Date();
  const root = document.documentElement;
  root.dataset.font = state.prefs.font;
  root.style.setProperty("--body-size", `${bodyFontSize(state.prefs.font, "regular")}px`);
  // #200: today's events only (the card says the next one left today, as on the Mac).
  const start = logicalDayStart(now);
  const events = expand(state.events ?? [], start, new Date(start.getTime() + 86_400_000), lang());
  const all3 = glanceCards(events, timerNow(), state.alarms ?? [], new Set(state.prefs.alarmHandled ?? []), now, lang());
  // Only the cards with something in them take full size; the empty ones are chips in one row under them.
  const layout = glanceLayout(all3.filter((entry) => !entry.empty).map((entry) => entry.kind));
  const pick = (kind: GlanceCard["kind"]) => all3.find((entry) => entry.kind === kind)!;
  const row3 = h("div", { class: "cards3" }, ...layout.cards.map((kind) => cardElement(pick(kind), layout.wide)));
  row3.style.setProperty("--n", String(layout.cards.length));
  cards.replaceChildren(...(layout.cards.length ? [row3] : []), ...(layout.chips.length ? [h("div", { class: "g-chips" }, ...layout.chips.map((kind) => chipElement(pick(kind))))] : []));
  fitTimerWord();

  // The to-dos this window lists and counts: today's sheet. #196: without what this PC hides — here, in this one place,
  // so the rows and the progress agree (even while the note peeks at it, D6).
  const spaces = spaceIndexOf(state.todoSpaces.spaces, state.spaceOf);
  const hiddenHere = hiddenSpaces(readDeviceRules(state.prefs.spaceDevice), state.todoSpaces, now);
  const all = state.items.filter((item) => pageOf(item, now) === "today" && !(hiddenHere.size > 0 && hiddenHere.has(deviceKey(spaces.get(item.id)?.id))));
  // #200: the date and today's progress (every space's to-dos, whatever the lens shows — A5), a thin bar under them.
  const doneCount = all.filter((item) => item.isCompleted).length;
  const date = glanceDate(now, lang());
  const progress = glanceProgress(all.length, doneCount, lang());
  // The same bar each time, so its length eases (--motion-change) when a check lands.
  barFill.style.width = `${all.length ? (doneCount / all.length) * 100 : 0}%`;
  top.setAttribute("aria-label", progress ? `${date}, ${progress}` : date);
  top.replaceChildren(h("div", { class: "g-top-line", "aria-hidden": "true" }, h("span", { class: "g-date" }, date), progress ? h("span", { class: "g-progress" }, progress) : null),
    ...(all.length ? [bar] : []));

  // Today's tasks: just-checked ones keep their place for a moment. 2a (A5): under the note's lens.
  // D7: a lens on a space this PC hides lets go.
  const lens = deviceLens(activeLens(state.prefs.spaceLens ?? undefined, state.todoSpaces, now), hiddenHere);
  const today = lensTasks(all, spaces, lens);
  const hiddenByLens = lens === undefined ? 0 : all.filter((item) => !item.isCompleted && !inLens(lens, spaces.get(item.id)?.id)).length;
  bandOf = (id) => spaces.get(id);
  const shown = today.map((item) => (finishing.has(item.id) ? { ...item, isCompleted: false } : item));
  // Seven rows at most, fewer when the work area is short (never under three).
  const { next, rest, hidden } = glanceTasks(shown, now, glanceRowCap(rowRoom()));
  const real = (item: TodoItem) => today.find((entry) => entry.id === item.id) ?? item;
  const rows: HTMLElement[] = [];
  if (next.length && rest.length) rows.push(h("div", { class: "g-head", role: "heading", "aria-level": "3" }, t("다음")));
  rows.push(...next.map((item) => taskRow(real(item), true)));
  if (next.length && rest.length) rows.push(h("div", { class: "g-head", role: "heading", "aria-level": "3" }, t("그 밖에")));
  rows.push(...rest.map((item) => taskRow(real(item), false)));
  // A16: the lens hides every open to-do left — no cat words (there are to-dos left); the lens line says it.
  // #200: the small cat beside the words, as on the Mac (and every other empty sheet).
  if (!next.length && !rest.length && !hiddenByLens) {
    rows.push(h("div", { class: "g-empty" }, h("img", { src: `../../assets/pet/256/${all.length ? "cheer" : "happy"}.png`, alt: "", draggable: "false" }),
      h("span", {}, all.length ? t("오늘 한 장 끝! 수고했어요") : t("오늘 할 일을 한 줄 적어 볼까요?"))));
  }
  more.textContent = t("외 {n}개 · 노트에서 보기", { n: hidden });
  more.hidden = hidden === 0;
  for (const id of [...rowCache.keys()]) if (!rows.some((row) => row.dataset.id === id)) rowCache.delete(id);
  tasks.replaceChildren(...rows, more, ...(lens !== undefined ? [lensLine(lens, hiddenByLens)] : []));
  fitLensLine();

  // Each with its small icon (as on the Mac), so they read as buttons.
  const link = (label: string, symbol: string, run: () => void) => {
    const element = h("button", { class: "g-link", title: label }, icon(symbol, 12), h("span", {}, label));
    element.addEventListener("click", run);
    return element;
  };
  links.replaceChildren(
    link(t("노트 열기"), "note", () => { void api.act({ type: "openNote" }); close(); }),
    link(t("책상"), "desk", () => { void api.act({ type: "openCalendar" }); close(); }),
    link(state.prefs.petVisible ? t("종이냥 숨기기") : t("종이냥 보이기"), "cat", () => api.act({ type: "setPref", key: "petVisible", value: !state!.prefs.petVisible })),
  );
  report();
}

/** The timer's small word ("남음", "nog") steps aside when the card is too narrow for it: the time never gets "…". */
function fitTimerWord(): void {
  const value = cards.querySelector<HTMLElement>(".c3.timer b");
  const word = value?.querySelector<HTMLElement>(".c3-unit");
  if (!value || !word) return;
  word.hidden = false;
  if (value.scrollWidth > value.clientWidth + 1) word.hidden = true;
}

/** The cards count down while the window is up. */
setInterval(() => {
  if (document.visibilityState !== "visible" || !state) return;
  const timer = timerNow();
  const shownTimer = cards.querySelector(".c3.timer .c3-big");
  if (timer && shownTimer) {
    const next = glanceCards([], timer, [], new Set(), new Date(), lang())[1].big;
    if (shownTimer.textContent !== next) { shownTimer.textContent = next; fitTimerWord(); }
  }
}, 1000);
setInterval(() => { if (document.visibilityState === "visible") render(); }, 30_000);

api.on("state", (next) => { state = next as TodosState; render(); });
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

// #230: keys typed here make the desktop cat tap along (only that a key went down).
listenForTyping();
