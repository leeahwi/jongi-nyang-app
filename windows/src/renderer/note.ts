import { logicalDayStart } from "../core/archive";
import { dayFor, deadlineChoiceTitles, key as dueKey, fromKey, label as dueLabel, sentence as dueSentence, urgency, type DeadlineChoice } from "../core/deadline";
import { clock, dayMonth, dayWord, longDate, minutesAway, spokenTime, weekdayShort } from "../core/lang";
import { memoPreview, memoTitle, type Memo } from "../core/memo";
import type { TodoItem } from "../core/notebook";
import { describe } from "../core/repeat";
import { afterRemoval, fromInput, reorder, step } from "../core/keyboard";
import { dropTabs, pageOf, tabAt, tabDrop, type NoteTab } from "../core/shelf";
import { aheadCount, aheadEyebrow, aheadSectionTitle, aheadSections, aheadSummary, aheadWeek, movedText, type AheadSection, type AheadTarget } from "../core/ahead";
import { compactTime, rowLabel, scheduledTime } from "../core/timeText";
import { bodyFontSize, textSizes, type AppState, type IntentPage, type IntentToast, type NoteNotice } from "../core/types";
import { expand } from "../core/events";
import { dayRibbon, todayGroups as splitToday } from "../core/ribbon";
import { DayStripView } from "./dayStrip";
import { h, icon, lang, paper, reduceMotion, scrollFade, t } from "./api";
import { paperCalendar } from "./calendar";
import { openEventSheet, type EventSheet } from "./eventSheet";
import type { CalendarSheetRequest } from "../core/calendar";
import { repeatFields } from "./repeatFields";
import { movedCaret } from "../core/textMerge";
import { InputLine } from "./inputLine";
import { commitReading, fromWire, showMade, undoLast, type FlowHost } from "./intentFlow";
import { toaster } from "./slip";
import { FocusCard } from "./focusCard";
import { chime } from "./chime";
import { openSearch, type SearchSlip } from "./search";
import { carriedDays, carriedText, movedTomorrowText, shiftedDue, tomorrowKey } from "../core/carry";
import { dayKey } from "../core/archive";
import { clockKey, logicalMinutes, rangeDay, rangeOf, rangeText, rangeTimes, rangeWhenText, reminderFor, validRange } from "../core/timeRange";
import { durationText } from "../core/duration";
import { timeList, timeOf } from "./timePick";

type Page = NoteTab;
const pages: Page[] = ["today", "ahead", "memos"];

const api = paper();
let state: AppState;
const finishing = new Set<string>();
const todayRows = new Map<string, Row>();
const aheadRows = new Map<string, Row>();
let editingID: string | undefined;
const savedPage = localStorage.getItem("page");
// The 마감 and 나중에 pages (and the older 마감 "shelf") are 앞으로 now.
let page: Page = savedPage === "shelf" || savedPage === "deadlines" || savedPage === "later" ? "ahead" : pages.includes(savedPage as Page) ? savedPage as Page : "today";
let openMemoID: string | undefined;

const pageTitle: Record<Page, string> = { today: t("오늘 할 일"), ahead: t("앞으로"), memos: t("메모") };
const tabLabel: Record<Page, string> = { today: t("오늘"), ahead: t("앞으로"), memos: t("메모") };

// ─── Frame: washi index tabs and the tools, then the header with the peeking cat ─

const pinButton = h("button", { class: "quiet pin", title: t("항상 위에 두기"), "aria-label": t("항상 위에 두기") }, icon("pin", 16));
const tabs = h("div", { class: "index-tabs", role: "tablist" });
const tools = h("div", { class: "tools" },
  pinButton,
  optional(button("desk", t("책상 (Ctrl+D)"), () => api.act({ type: "openCalendar" }), 16)),
  button("more", t("더 보기"), (event) => {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    void api.act({ type: "showMenu", menu: "more", x: rect.left, y: rect.bottom + 2 });
  }, 18),
  h("button", { class: "quiet close", title: t("닫기 (알림 영역에서 계속 실행)"), "aria-label": t("닫기") }, icon("close", 15)),
);
tools.querySelector(".close")!.addEventListener("click", () => api.act({ type: "window", command: "close" }));
pinButton.addEventListener("click", () => api.act({ type: "setPref", key: "alwaysOnTop", value: !state.prefs.alwaysOnTop }));
const tabsRow = h("div", { class: "tabs-row" }, tabs, h("span", { class: "spacer" }), tools);

const dateLine = h("div", { class: "date-line" });
const title = h("div", { class: "title" });
const donut = h("span", { class: "donut", "aria-hidden": "true" });
const progressText = h("span", { class: "prog-text" });
const progress = h("div", { class: "prog" }, donut, progressText);
const paw = '<svg class="paw" viewBox="0 0 14 13"><path d="M3.2 12C.6 10 0 5.6 1.3 3.5 2.5.4 5.2-.1 7.1.9c3-.8 5.3 1 5.8 3.4.9 2.6.6 5.9-1.4 7.6-2.8 1-5.4 1-8.3.1z"/><path class="toe" d="M5.2 7.6v3M8.7 7.6v3"/></svg>';
const cat = h("div", { class: "peek", title: t("노트 위의 작은 친구, 종이냥"), role: "img", "aria-label": t("종이냥 캐릭터") });
cat.innerHTML = `<div class="peek-window"><img src="../../assets/cat.png" alt="" draggable="false"></div><div class="peek-edge"></div><div class="peek-paws">${paw}${paw}</div>`;
const catImage = cat.querySelector("img")!;
// The progress sits beside the title when there's room, else under it (as on the Mac).
const titleRow = h("div", { class: "title-row" }, h("div", { class: "title-text" }, dateLine, h("div", { class: "title-line" }, title, progress)), cat);

const sheet = h("div", { class: "sheet" });
const toastHost = h("div", { class: "toast-host" });
const dock = h("div", { class: "dock" }, toastHost);
const footer = h("div", { class: "footer" });
document.getElementById("app")!.append(tabsRow, titleRow, sheet, dock, footer);

// ─── 집중 ─────────────────────────────────────────────────────────────────────

/** The focus card: while a session is on, the note is this one card (see focusCard.ts). */
const focusCard = new FocusCard({
  todayItems: () => (state ? todayItems() : []),
  next: () => {
    if (!state) return undefined;
    const next = dayRibbon(todayOccurrences(), state.items, new Date(), lang())?.next;
    return next ? `${next.time} ${next.title}${next.away ? ` (${next.away})` : ""}` : undefined;
  },
  closeOthers: () => {
    guide?.close();
    editor?.close();
    eventSheet?.close();
    toast.hide();
    commitEditing();
    setPicking(false);
    line.field.blur();
  },
  toastHost,
  toastHome: dock,
  shown: () => fitTabs(true),
});
document.getElementById("app")!.append(focusCard.element);

/** 할 일 골라 집중…: 오늘 with a small 집중 on each open row (on hover); Esc or 취소 leaves. */
let picking = false;
const pickCancel = h("button", { class: "pick-cancel" }, t("취소"));
const pickBar = h("div", { class: "pick-bar", role: "status", hidden: "" },
  icon("timer", 15), h("span", { class: "pick-text" }, t("집중할 할 일을 골라요")), h("span", { class: "spacer" }), h("kbd", { class: "keycap" }, "Esc"), pickCancel);
pickCancel.addEventListener("click", () => setPicking(false));

function setPicking(on: boolean): void {
  if (picking === on) return;
  picking = on;
  if (on) document.documentElement.dataset.pick = "on"; else delete document.documentElement.dataset.pick;
  pickBar.hidden = !on;
  line.element.hidden = on;
  if (on) { setPage("today"); line.field.blur(); }
}

/** A row's 집중 (the pick state): the task, for the Pomodoro's focus length. */
function pickTask(id: string): void {
  setPicking(false);
  void api.act({ type: "focus", command: { kind: "start", taskId: id } });
}

/** A tool that narrow windows may hide (it is also in the ⋯ menu). */
function optional(element: HTMLButtonElement): HTMLButtonElement {
  element.classList.add("optional");
  return element;
}

function button(name: string, label: string, action: (event: MouseEvent) => void, size = 16): HTMLButtonElement {
  const element = h("button", { class: "quiet", title: label, "aria-label": label }, icon(name, size));
  element.addEventListener("click", action);
  return element;
}

function setPage(next: Page): void {
  if (next === page) return;
  commitEditing();
  editor?.close();
  if (page === "memos" && openMemoID) closeMemo();
  // The rows stay made (updated on the next draw): switching back doesn't build a long list again.
  selectedID = undefined;
  page = next;
  localStorage.setItem("page", page);
  // The line first (it measures itself while the page is still laid out), then the new page: one layout, not two.
  line.refresh();
  render();
}

function renderHeader(): void {
  const now = new Date();
  const ahead = aheadNow(now);
  const counts: Record<Page, number> = {
    today: todayItems().filter((item) => !item.isCompleted).length,
    ahead: aheadCount(ahead),
    memos: state.memos.length,
  };
  // The three tabs are made once; a redraw only changes what they say.
  if (tabs.childElementCount === 0) {
    tabs.append(...pages.map((value) => {
      const tab = h("button", { class: `index-tab tab-${value}`, role: "tab" }, h("span", { class: "tab-label" }, tabLabel[value]), h("span", { class: "tab-count" }));
      tab.title = `${tabLabel[value]} (Ctrl+${pages.indexOf(value) + 1})`;
      tab.addEventListener("click", () => setPage(value));
      return tab;
    }));
  }
  pages.forEach((value, index) => {
    const tab = tabs.children[index] as HTMLElement;
    tab.setAttribute("aria-selected", String(page === value));
    const count = tab.querySelector<HTMLElement>(".tab-count")!;
    const text = counts[value] > 0 ? String(counts[value]) : "";
    if (count.textContent !== text) count.textContent = text;
    count.hidden = !text;
  });
  document.documentElement.dataset.page = page;
  fitTabs();
  // 앞으로: "이번 주 · 10월 4일 – 10일" over the title, "할 일 6 · 일정 3" under it.
  dateLine.textContent = page === "ahead" ? aheadEyebrow(now, lang()) : longDate(now, lang());
  title.textContent = pageTitle[page];
  // 2 / 5 끝냈어요 with a small donut, on 오늘 when it has tasks.
  const today = todayItems();
  const done = today.filter((item) => item.isCompleted).length;
  const summary = page === "ahead" ? aheadSummary(ahead, lang()) : "";
  progress.hidden = page === "ahead" ? !summary : page !== "today" || today.length === 0;
  donut.hidden = page !== "today";
  progress.classList.toggle("ahead-sum", page === "ahead");
  if (page === "ahead") {
    progressText.textContent = summary;
    progress.removeAttribute("role");
    progress.removeAttribute("aria-label");
  } else if (!progress.hidden) {
    const share = Math.round((done / today.length) * 100);
    donut.style.setProperty("--done", `${share}%`);
    donut.classList.toggle("full", done === today.length);
    progressText.textContent = t("{completed} / {total} 끝냈어요", { completed: done, total: today.length });
    progress.setAttribute("role", "img");
    progress.setAttribute("aria-label", t("{total}개 중 {completed}개 완료, {remaining}개 남음", { total: today.length, completed: done, remaining: today.length - done }));
  }
  // The cat sleeps from 11 p.m. to 5 a.m.
  const hour = now.getHours();
  // (Snapshots draw the sleeping cat at any hour: `window.catSleeps`.)
  const sleeping = (window as { catSleeps?: boolean }).catSleeps ?? (hour >= 23 || hour < 5);
  const art = sleeping ? "../../assets/pet/256/sleep.png" : "../../assets/cat.png";
  if (!catImage.src.endsWith(art.replace("../..", ""))) catImage.src = art;
  cat.classList.toggle("sleeping", sleeping);
}

/**
 * Tabs and tools keep a clear gap. Narrow windows first tighten the tabs, then drop their
 * counts, then write the names smaller, then tuck the desk into ⋯ (달력 is also there, and Ctrl+D), before anything is pushed off.
 */
let fittedFor = "";
function fitTabs(force = false): void {
  // Measuring forces a layout, so only when the width or the tab texts changed.
  const key = `${window.innerWidth}|${tabs.textContent}|${document.documentElement.dataset.font}`;
  if (key === fittedFor && !force) return;
  // Hidden (the focus card is up): nothing can be measured now; measure when it shows again.
  if (tabsRow.clientWidth === 0) { fittedFor = ""; return; }
  fittedFor = key;
  tabs.classList.remove("compact", "tight", "narrow", "narrower");
  tools.classList.remove("compact");
  const crowded = () => tabsRow.scrollWidth > tabsRow.clientWidth;
  if (crowded()) tabs.classList.add("tight");
  if (crowded()) tabs.classList.add("compact");
  if (crowded()) tabs.classList.add("narrow");
  if (crowded()) tools.classList.add("compact");
  if (crowded()) tabs.classList.add("narrower");
}
window.addEventListener("resize", () => {
  if (!state) return;
  fitTabs();
  // The 하루 띠 follows the note's size (one row when narrow, three when tall; the open day's height): once a frame at most.
  if (page === "today" && strip.element.isConnected && !resizePending) {
    resizePending = true;
    requestAnimationFrame(() => { resizePending = false; render(); });
  }
});
let resizePending = false;
void document.fonts.ready.then(() => { if (state) fitTabs(true); });
// A face first used later (switching to 붓, Caveat or Kalam) loads after the tabs were measured: measure again.
document.fonts.addEventListener("loadingdone", () => { if (state) fitTabs(true); });

// The minute moves the 하루 띠, "어제부터" and the D-days — on the minute, so the strip's "40분 남음" turns with the clock;
// a note out of sight catches up when it shows again. Nothing is drawn between minutes.
let missedMinute = false;
function onTheMinute(): void {
  setTimeout(() => {
    if (state) { if (document.hidden) missedMinute = true; else render(); }
    onTheMinute();
  }, 60_000 - (Date.now() % 60_000) + 40);
}
onTheMinute();
document.addEventListener("visibilitychange", () => { if (!document.hidden && missedMinute && state) { missedMinute = false; render(); } });

// ─── Which tasks go where ───────────────────────────────────────────────────

const todayItems = () => state.items.filter((item) => pageOf(item, new Date()) === "today");

function visibleToday(): TodoItem[] {
  return todayItems().filter((item) => !state.prefs.hideCompleted || !item.isCompleted || finishing.has(item.id));
}

/** 다음: today's reminders still ahead (at most three, by time), shown above the rest; and the rest. */
function todayGroups(): { next: TodoItem[]; rest: TodoItem[] } {
  const visible = visibleToday();
  // 오늘 꼭 하나 heads 다음 (with its star) for the day.
  return splitToday(visible, new Date(), visible.find((item) => isStarred(item))?.id);
}

// ─── The input line ─────────────────────────────────────────────────────────

const toast = toaster(toastHost);
/** 오늘 꼭 하나: the first time the note opens on a new day, the empty line asks for the day's one thing. */
let askingPick = false;
const flow: FlowHost = {
  toast,
  page: () => page as IntentPage,
  restore: (text) => { line.set(text); line.focus(); },
};
const line = new InputLine({
  variant: "note",
  placeholder: () => page === "memos"
    ? { long: t("한 줄 메모를 적어요"), short: t("한 줄 메모를 적어요") }
    : askingPick ? { long: t("오늘 꼭 하나만 고른다면?"), short: t("오늘 꼭 하나만?") }
    : { long: t("무엇이든 적어요 — 할 일, 일정, 타이머 40…"), short: t("무엇이든 적어요") },
  mode: () => (page === "memos" ? "memo" : "intent"),
  prefer: () => state?.prefs.intentPrefer ?? {},
  // Ctrl+Alt+N reads any kind; on 메모 the line only makes memos, so no chip there (as on the Mac).
  shortcut: () => (state?.prefs.quickEntry && page !== "memos" ? "Ctrl+Alt+N" : undefined),
  commit: async (candidate, candidates, text) => {
    const result = await commitReading(flow, candidate, candidates, text, "note");
    // 오늘 꼭 하나: the first to-do written after the question gets the day's star.
    if (askingPick && result.made?.kind === "todo" && result.made.id) {
      askingPick = false;
      void api.act({ type: "setPref", key: "starredTask", value: result.made.id });
      line.refresh();
    }
    if (result.made?.kind === "todo" || result.made?.kind === "memo") requestAnimationFrame(() => sheet.scrollTo({ top: candidate.kind === "memo" && page === "memos" ? 0 : sheet.scrollHeight, behavior: reduceMotion() ? "auto" : "smooth" }));
    return Boolean(result.made);
  },
  onArrowUp: (event) => enterList(event, -1),
  onEscape: (event) => { if (line.value) { event.preventDefault(); line.clear(); } else line.field.blur(); },
});
line.field.addEventListener("keydown", (event) => {
  // Ctrl+Z right after putting a line in takes it back (the field's own undo otherwise).
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z" && toast.visible && !line.value) {
    event.preventDefault();
    void undoLast(flow);
  }
});
// The pick state's bar takes the line's place while picking.
dock.append(line.element, pickBar);

const allDone = h("div", { class: "all-done", role: "status" }, icon("sprout", 15), t("오늘 한 장 끝! 수고했어요"));

/** What an empty page shows: one of the cat's poses, faint, and a short line of what goes here. */
function emptyNote(pose: string, text: string): HTMLElement {
  return h("div", { class: "empty-note" }, h("img", { src: `../../assets/pet/256/${pose}.png`, alt: "", draggable: "false" }), h("div", {}, text));
}
const emptyToday = emptyNote("happy", t("오늘 할 일을 한 줄 적어 볼까요?"));

function focusNew(): void {
  if (page === "memos") setPage("today");
  line.focus();
}

/**
 * Makes `container` hold exactly `children`, in order, touching only what differs. Moving a
 * node that is already in place (replaceChildren, after) drops keyboard focus, IME
 * composition and pointer capture, so nodes that are where they belong are never moved.
 */
function reconcile(container: Element, children: readonly Element[]): void {
  children.forEach((child, index) => {
    const current = container.children[index];
    if (current !== child) container.insertBefore(child, current ?? null);
  });
  while (container.children.length > children.length) container.lastElementChild!.remove();
}

// One lasting heading per group (new nodes would shift the rows after them).
const nextHead = h("div", { class: "group-head", role: "heading", "aria-level": "3" }, h("span", { class: "group-name" }, t("다음")), h("span", { class: "group-count" }));
const restHead = h("div", { class: "group-mark", role: "heading", "aria-level": "3" }, h("span", { class: "group-name" }, t("그 밖에")), h("span", { class: "group-count" }));
const lines = h("div", { class: "lines", role: "list" });
/** With the groups, the ruled paper below the last row (each row draws its own line then, so a heading can sit between them). */
const linesFill = h("div", { class: "lines-fill", "aria-hidden": "true" });

function renderToday(): void {
  const today = todayItems();
  const remaining = today.filter((item) => !item.isCompleted).length;
  const allFinished = remaining === 0 && today.length > 0;
  const { next, rest } = todayGroups();
  // No headings when 다음 would hold every open task (or there is nothing up next).
  const grouped = next.length > 0 && rest.some((item) => !item.isCompleted);
  const listed = new Set([...next, ...rest].map((item) => item.id));
  for (const id of [...todayRows.keys()]) if (!listed.has(id)) todayRows.delete(id);
  const nextRows = next.map((item) => todayRows.get(item.id)?.updated(item, true) ?? newRow(item, true));
  const restRows = rest.map((item) => todayRows.get(item.id)?.updated(item, false) ?? newRow(item, false));
  nextHead.querySelector(".group-count")!.textContent = String(next.length);
  restHead.querySelector(".group-count")!.textContent = String(rest.length);
  lines.classList.toggle("grouped", grouped);
  reconcile(lines, [
    ...(grouped ? [nextHead] : []), ...nextRows, ...(grouped ? [restHead] : []), ...restRows,
    ...(allFinished ? [allDone] : []), ...(today.length === 0 ? [emptyToday] : []), ...(grouped ? [linesFill] : []),
  ]);
  const shown = strip.render();
  reconcile(sheet, shown ? [strip.element, lines] : [lines]);
  sheet.classList.toggle("with-strip", shown);
  renderTodayFooter(today.length - remaining);
}

function newRow(item: TodoItem, next: boolean): HTMLElement {
  const row = new Row(item, false, next);
  todayRows.set(item.id, row);
  return row.element;
}

// ─── 하루 띠 ─────────────────────────────────────────────────────────────────

/** Today's events (a day either side of the logical day) as occurrences, for the strip. */
let occurrencesKept: { events: unknown; start: number; list: ReturnType<typeof expand> } | undefined;
function todayOccurrences(now = new Date()) {
  const start = logicalDayStart(now).getTime();
  if (occurrencesKept && occurrencesKept.events === state.events && occurrencesKept.start === start) return occurrencesKept.list;
  const list = expand(state.events ?? [], new Date(start - 86_400_000), new Date(start + 2 * 86_400_000), lang());
  occurrencesKept = { events: state.events, start, list };
  return list;
}

/** 하루 띠 (1.25): now and next on the paper, opened into the whole day (dayStrip.ts). */
const strip = new DayStripView({
  state: () => state,
  occurrences: (now) => todayOccurrences(now),
  showTask: (id) => showTask(id, true),
  flow,
  changed: () => fadeEdges(),
  room: () => sheet.clientHeight || window.innerHeight - 170,
});
window.addEventListener("ribbon-now", () => { if (state) render(); });

// ─── 일정 시트 ────────────────────────────────────────────────────────────────

let eventSheet: EventSheet | undefined;

/** 캘린더에 넣기 · 새 일정 · 고치기, opened by the main process (menus, the ribbon, 빠른 입력). */
function showEventSheet(request: CalendarSheetRequest): void {
  guide?.close(); // the first-launch guide would take Enter and Esc from the card
  editor?.close();
  eventSheet?.close();
  toast.hide(); // a card over the note: the toast would float over it
  commitEditing();
  // Under its task row, the event's block in the open day, or the 하루 띠 itself (새 일정) — the top of the note when it is hidden.
  const anchor = () => {
    if (request.taskId) return rowFor(request.taskId)?.element;
    // 앞으로: under the event's line on its day.
    const line = request.key && page === "ahead" ? [...aheadList.querySelectorAll<HTMLElement>(".aev")].find((element) => element.dataset.key === request.key) : undefined;
    if (line) return line;
    if (!strip.element.isConnected) return titleRow;
    const block = request.key ? [...strip.element.querySelectorAll<HTMLElement>(".tt-block")].find((element) => element.dataset.id === request.key) : undefined;
    return block ?? strip.element;
  };
  const sheetCard = openEventSheet(request, anchor, () => { if (eventSheet === sheetCard) eventSheet = undefined; });
  eventSheet = sheetCard;
}

function renderTodayFooter(completed: number): void {
  const parts: (Node | string)[] = [];
  if (state.storageError) {
    const warning = h("button", { class: "warning", title: state.storageError }, icon("warning", 13), t("저장 확인 필요"));
    warning.addEventListener("click", () => api.act({ type: "showStorageProblem" }));
    parts.push(warning);
  } else {
    const history = h("button", { class: "history", title: t("완료 기록 (Ctrl+H)"), "aria-label": t("완료 기록 보기") }, icon("sprout", 14), t("완료 기록"));
    history.addEventListener("click", () => api.act({ type: "openHistory" }));
    parts.push(history);
  }
  const toggle = h("button", { class: "toggle-done", title: t("완료한 할 일 표시 전환") }, state.prefs.hideCompleted ? t("완료 보기") : t("완료 숨기기"));
  toggle.disabled = completed === 0;
  toggle.addEventListener("click", () => api.act({ type: "setPref", key: "hideCompleted", value: !state.prefs.hideCompleted }));
  footer.replaceChildren(...parts.map((part) => typeof part === "string" ? h("span", {}, part) : part), h("span", { class: "spacer" }), toggle);
}

// ─── 앞으로 ─────────────────────────────────────────────────────────────────

/**
 * The sections for now (see ahead.ts). A task just checked stays a moment as it was (its row
 * plays the check and goes), the way 완료 숨기기 lets one finish on 오늘.
 */
let aheadKept: { state: AppState; minute: number; finishing: string; sections: AheadSection[] } | undefined;
function aheadNow(now = new Date()): AheadSection[] {
  // The header and the page both ask during one redraw: worked out once per state and minute.
  const minute = Math.floor(now.getTime() / 60_000);
  const holding = [...finishing].join(",");
  if (aheadKept && aheadKept.state === state && aheadKept.minute === minute && aheadKept.finishing === holding) return aheadKept.sections;
  const items = finishing.size ? state.items.map((item) => (finishing.has(item.id) && item.isCompleted ? { ...item, isCompleted: false } : item)) : state.items;
  const sections = aheadSections(items, state.events ?? [], now, lang());
  aheadKept = { state, minute, finishing: holding, sections };
  return sections;
}

const aheadList = h("div", { class: "ahead", role: "list" });
// Two sentences, two lines (one long line would leave a word on its own).
const emptyAhead = emptyNote("curious", t("앞으로 할 일이 없어요. 아래에 “금요일까지 보고서”처럼 적어 보세요.").replace(/([.!?]) /, "$1\n"));
emptyAhead.classList.add("ahead-empty");
/** Lasting section headings (new nodes would move the rows after them and drop the focus). */
const sectionHeads = new Map<string, HTMLElement>();
function sectionHead(section: AheadSection): HTMLElement {
  let head = sectionHeads.get(section.kind);
  if (!head) {
    head = h("div", { class: `ahead-head head-${section.kind}`, role: "heading", "aria-level": "3" }, h("span", { class: "group-name" }), h("span", { class: "group-count" }));
    sectionHeads.set(section.kind, head);
  }
  head.querySelector(".group-name")!.textContent = section.title;
  head.querySelector(".group-count")!.textContent = section.count ? String(section.count) : "";
  return head;
}

/** A task's row on this page, reused while it stays, with what its right end says. */
function aheadRow(item: TodoItem, meta: RowMeta): HTMLElement {
  const real = state.items.find((entry) => entry.id === item.id) ?? item;
  let row = aheadRows.get(item.id);
  if (row) { row.meta = meta; row.update(real); } else { row = new Row(real, true, false, meta); aheadRows.set(item.id, row); }
  return row.element;
}

/** An event line of a day: its colour, 종일 or the start, the title; a click opens it, right-click its menu. */
const eventLines = new Map<string, HTMLElement>();
function eventLine(day: string, event: { key: string; title: string; color: string; time: string; allDay: boolean }): HTMLElement {
  // Per day: an event over several days has a line on each.
  const id = `${day}|${event.key}|${event.time}|${event.title}|${event.color}`;
  const kept = eventLines.get(id);
  if (kept) return kept;
  const bar = h("i", { class: "evc", "aria-hidden": "true" });
  bar.style.background = event.color;
  const line = h("button", { class: `aev${event.allDay ? " all-day" : ""}`, "data-key": event.key, title: `${event.time} · ${event.title}`, "aria-label": `${event.time} ${event.title}` },
    bar, h("span", { class: "aev-time" }, event.time), h("span", { class: "aev-title" }, event.title));
  line.addEventListener("click", () => api.act({ type: "calendarEditEvent", key: event.key }));
  line.addEventListener("contextmenu", (contextEvent) => { contextEvent.preventDefault(); void api.act({ type: "showEventMenu", key: event.key }); });
  eventLines.set(id, line);
  return line;
}

/**
 * The blocks of the page (a day, a month of 그 뒤, 언젠가), kept across redraws like the rows: a
 * redraw that moved a row being edited (or dragged) would take its focus (or the pointer) away.
 */
const blocks = new Map<string, { element: HTMLElement; key?: HTMLElement; items: HTMLElement }>();
function block(id: string, make: () => { element: HTMLElement; key?: HTMLElement; items: HTMLElement }): { element: HTMLElement; key?: HTMLElement; items: HTMLElement } {
  let entry = blocks.get(id);
  if (!entry) { entry = make(); blocks.set(id, entry); }
  return entry;
}

function renderAhead(): void {
  // A drag in progress keeps the page as it is (its rows, its drop zones) until the drop.
  if (dragging) return;
  const now = new Date();
  const sections = aheadNow(now);
  const shown = new Set<string>();
  const usedBlocks = new Set<string>();
  const usedLines = new Set<HTMLElement>();
  const children: Element[] = [];
  for (const section of sections) {
    children.push(sectionHead(section));
    for (const day of section.days ?? []) {
      const entry = block(`day:${day.day}`, () => {
        const key = h("div", { class: "aday-key", "aria-hidden": "true" });
        const items = h("div", { class: "aday-items" });
        return { element: h("div", { class: "aday drop-zone", role: "group", "data-day": day.day }, key, items), key, items };
      });
      usedBlocks.add(`day:${day.day}`);
      const label = `${day.relative ?? day.weekday} ${day.date}`;
      entry.element.setAttribute("aria-label", label);
      entry.key!.classList.toggle("tomorrow", Boolean(day.relative));
      if (entry.key!.textContent !== `${day.relative ?? day.weekday}${day.date}`) entry.key!.replaceChildren(h("span", {}, day.relative ?? day.weekday), h("b", {}, String(day.date)));
      const lines = day.events.map((event) => eventLine(day.day, event));
      lines.forEach((line) => usedLines.add(line));
      const rows = day.tasks.map((item) => { shown.add(item.id); return aheadRow(item, { kind: "day" }); });
      reconcile(entry.items, [...lines, ...rows]);
      children.push(entry.element);
    }
    for (const month of section.months ?? []) {
      const entry = block(`month:${month.month}`, () => {
        const key = h("div", { class: "amonth-title" });
        const items = h("div", { class: "aday-items" });
        return { element: h("div", { class: "amonth", role: "group" }, key, items), key, items };
      });
      usedBlocks.add(`month:${month.month}`);
      entry.key!.textContent = month.title;
      entry.element.setAttribute("aria-label", month.title);
      reconcile(entry.items, month.tasks.map(({ item, date }) => { shown.add(item.id); return aheadRow(item, { kind: "date", text: date }); }));
      children.push(entry.element);
    }
    if (section.tasks) {
      const entry = someday();
      usedBlocks.add("someday");
      entry.element.classList.remove("empty");
      reconcile(entry.items, section.tasks.map((item) => { shown.add(item.id); return aheadRow(item, { kind: "none" }); }));
      children.push(entry.element);
    }
  }
  for (const id of [...aheadRows.keys()]) if (!shown.has(id)) aheadRows.delete(id);
  for (const id of [...blocks.keys()]) if (!usedBlocks.has(id)) blocks.delete(id);
  for (const [id, line] of [...eventLines]) if (!usedLines.has(line)) eventLines.delete(id);
  if (sections.length === 0) children.push(emptyAhead);
  reconcile(aheadList, children);
  // What a drag (or a snapshot of one) left marked.
  for (const element of aheadList.querySelectorAll(".drop-target, .drop-before, .drop-after, .dragging")) element.classList.remove("drop-target", "drop-before", "drop-after", "dragging");
  sheet.classList.remove("with-strip");
  reconcile(sheet, [aheadList]);
  const calendarButton = h("button", { class: "history", title: t("달력 (Ctrl+D)") }, icon("calendar", 14), t("달력"));
  calendarButton.addEventListener("click", () => api.act({ type: "openCalendar" }));
  // As on the Mac: the hint at the left (it goes first when the note is narrow), 달력 at the right.
  footer.replaceChildren(h("span", { class: "footer-hint" }, icon("move", 13), h("span", {}, sections.length ? t("다른 날로 끌면 마감이 바뀌어요") : t("날이 되면 오늘로 올라와요"))), h("span", { class: "spacer" }), calendarButton);
}

/** 언젠가's block; while a drag is on and 언젠가 is empty, it shows (with its heading) as a place to drop. */
function someday(): { element: HTMLElement; items: HTMLElement } {
  return block("someday", () => {
    const items = h("div", { class: "aday-items" });
    return { element: h("div", { class: "someday drop-zone", "data-day": "someday", role: "group", "aria-label": t("언젠가") }, items), items };
  });
}

/**
 * For a drag: every day of this week and next week (from tomorrow) shows, the empty ones as bare
 * rows to drop on. Inserted around the blocks already there — never moving them, which would take
 * the pointer from the grip being dragged. The next redraw puts the page back.
 */
function showAllDays(): void {
  const now = new Date();
  const start = logicalDayStart(now);
  const today = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const { last } = aheadWeek(now, lang());
  const weekEnd = dueKey(last);
  const days: string[] = [];
  for (let offset = 1; offset <= 14; offset += 1) {
    const key = dueKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset));
    if (key > dueKey(new Date(last.getFullYear(), last.getMonth(), last.getDate() + 7))) break;
    days.push(key);
  }
  emptyAhead.remove();
  const later = () => aheadList.querySelector(".head-laterOn, .amonth, .head-someday, .someday") ?? null;
  for (const kind of ["thisWeek", "nextWeek"] as const) {
    const keys = days.filter((key) => (kind === "thisWeek" ? key <= weekEnd : key > weekEnd));
    if (!keys.length) continue;
    let head = aheadList.querySelector<HTMLElement>(`.head-${kind}`);
    for (const key of keys) {
      if (aheadList.querySelector(`.aday[data-day="${key}"]`)) continue;
      const date = fromKey(key)!;
      const tomorrow = key === days[0];
      const block = h("div", { class: "aday drop-zone placeholder", role: "group", "data-day": key },
        h("div", { class: `aday-key${tomorrow ? " tomorrow" : ""}`, "aria-hidden": "true" }, h("span", {}, tomorrow ? dayWord(1, lang())! : weekdayShort(date.getDay(), lang())), h("b", {}, String(date.getDate()))),
        h("div", { class: "aday-items" }));
      const next = [...aheadList.querySelectorAll<HTMLElement>(".aday")].find((element) => element.dataset.day! > key)
        ?? (kind === "thisWeek" ? aheadList.querySelector(".head-nextWeek") : null) ?? later();
      aheadList.insertBefore(block, next);
    }
    if (!head) {
      head = sectionHead({ kind, title: aheadSectionTitle(kind, lang()), count: 0 });
      aheadList.insertBefore(head, aheadList.querySelector(`.aday[data-day="${keys[0]}"]`));
    }
  }
}

/** For a drag from a day: an empty 언젠가 at the end of the page to drop on. */
function showEmptySomeday(): void {
  if (aheadList.querySelector(".someday.drop-zone")) return;
  const entry = someday();
  entry.element.classList.add("empty");
  entry.items.replaceChildren(h("span", { class: "zone-hint" }, t("여기에 놓으면 날짜 없이 언젠가로 가요")));
  emptyAhead.remove();
  aheadList.append(sectionHead({ kind: "someday", title: t("언젠가"), count: 0 }), entry.element);
}

// Snapshots draw a drag: the empty days and 언젠가 shown to drop on.
window.addEventListener("snapshot-drag", () => { showAllDays(); showEmptySomeday(); });
// Snapshots move a task from the main process and ask for its toast.
window.addEventListener("snapshot-moved", (event) => movedToast((event as CustomEvent<AheadTarget>).detail));

/** The toast after a task was moved by dragging (or ↓ 언젠가, → 내일): where it went, with 되돌리기. */
function movedToast(target: AheadTarget): void {
  const text = target.kind === "day" && target.day === tomorrowKey(new Date()) ? movedTomorrowText(lang()) : movedText(target, new Date(), lang());
  toast.show({ icon: target.kind === "someday" ? "box" : target.kind === "today" ? "sun" : "calendar", text, action: { label: t("되돌리기"), run: () => void api.act({ type: "undo" }) } });
}

/** → 내일 · Alt+→ / Alt+←: the task due on `day` (off any shelf), with the toast. */
function moveToDay(id: string, day: string): void {
  void api.act({ type: "moveTasks", ids: [id], target: { kind: "day", day } });
  movedToast({ kind: "day", day });
}

/** The trash (or Delete): gone, with 지웠어요 · 되돌리기 (Ctrl+Z still works). */
function deleteTask(id: string): void {
  void api.act({ type: "delete", id });
  toast.show({ icon: "trash", text: t("지웠어요"), action: { label: t("되돌리기"), run: () => void api.act({ type: "undo" }) } });
}

/** 집중 from a row (its button, F): a focus of the Pomodoro's length on that task. */
function startFocus(id: string): void {
  const item = state.items.find((entry) => entry.id === id);
  if (!item || item.isCompleted) return;
  // (A task with hours today runs for what is left of them: the main process decides, as for every start.)
  void api.act({ type: "focus", command: { kind: "start", taskId: id } });
}

/** 오늘 꼭 하나: the task picked today (the star goes at the day's end). */
function isStarred(item: TodoItem): boolean {
  return Boolean(state?.prefs.starredTask) && state.prefs.starredTask === item.id && state.prefs.morningPickDay === dayKey(new Date()) && !item.isCompleted;
}

// ─── Memo page ──────────────────────────────────────────────────────────────

let memoText: HTMLTextAreaElement | undefined;
/** Texts this editor sent (the store echoes them back, sometimes a step behind) since it last took one from elsewhere. */
let memoSent = new Set<string>();
/** Korean input mid-syllable: the text isn't touched until the syllable is done. */
let memoComposing = false;
/** The editor's text as last sent or shown, sent along as `from` with the next change. */
let memoValue = "";

async function newMemo(): Promise<void> {
  closeMemo(); // Ctrl+Shift+N inside a memo: put the old one away first
  setPage("memos");
  openMemoID = await api.newMemo();
  render();
}

/** A memo's trash: gone, with 메모를 지웠어요 · 되돌리기 (the footer's 지운 메모 되돌리기 stays too). */
function deleteMemo(id: string): void {
  const memo = state.memos.find((entry) => entry.id === id);
  void api.act({ type: "memoDelete", id });
  // A blank memo just goes (there is nothing to bring back).
  if (memo?.text.trim()) toast.show({ icon: "trash", text: t("메모를 지웠어요"), action: { label: t("되돌리기"), run: () => void api.act({ type: "memoRestore" }) } });
}

function closeMemo(): void {
  if (!openMemoID) return;
  void api.act({ type: "memoClose", id: openMemoID });
  openMemoID = undefined;
  memoText = undefined;
}

function shortDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return spokenTime(date.getHours(), date.getMinutes(), lang());
  return dayMonth(date.getMonth() + 1, date.getDate(), undefined, lang());
}

function renderMemos(): void {
  const memo = openMemoID ? state.memos.find((entry) => entry.id === openMemoID) : undefined;
  if (memo) return renderMemoEditor(memo);
  openMemoID = undefined;
  const list = h("div", { class: "lines", role: "list" });
  const add = h("button", { class: "new memo-new" }, h("span", { class: "plus" }, icon("plus", 14)), h("span", { class: "memo-new-label" }, state.memos.length === 0 ? t("첫 메모를 적어 보세요") : t("새 메모")));
  add.title = t("새 메모 (Ctrl+Shift+N)");
  add.addEventListener("click", () => void newMemo());
  list.append(add);
  for (const entry of state.memos) list.append(memoRow(entry));
  if (state.memos.length === 0) list.append(emptyNote("tea", t("떠오른 생각을 가볍게 적어 두세요")));
  sheet.classList.remove("with-strip");
  reconcile(sheet, [list]);
  const restore = state.lastDeletedMemo ? h("button", { class: "restore" }, t("지운 메모 되돌리기")) : null;
  restore?.addEventListener("click", () => api.act({ type: "memoRestore" }));
  footer.replaceChildren(h("span", {}, icon("note", 13)), h("span", {}, state.memos.length === 0 ? t("생각나는 걸 가볍게 적어 두세요") : t("메모 {n}개", { n: state.memos.length })), h("span", { class: "spacer" }), ...(restore ? [restore] : []));
}

function memoRow(memo: Memo): HTMLElement {
  const trash = h("button", { class: "row-icon trash", title: t("메모 지우기 (아래에서 되돌릴 수 있어요)"), "aria-label": t("{title} 지우기", { title: memoTitle(memo, lang()) }) }, icon("trash", 15));
  const row = h("div", { class: "row memo-row", role: "listitem", tabindex: "0" },
    h("span", { class: "memo-icon" }, icon("note", 14)),
    h("div", { class: "text" }, h("span", { class: "label" }, memoTitle(memo, lang())), memoPreview(memo) ? h("span", { class: "memo-preview" }, memoPreview(memo)) : null),
    h("span", { class: "memo-date" }, shortDate(memo.updatedAt)), trash, h("span", { class: "end" }));
  row.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).closest(".trash")) return;
    openMemoID = memo.id;
    render();
  });
  row.addEventListener("keydown", (event) => { if (event.key === "Enter") { openMemoID = memo.id; render(); } });
  trash.addEventListener("click", () => deleteMemo(memo.id));
  return row;
}

function renderMemoEditor(memo: Memo): void {
  if (memoText && sheet.contains(memoText)) {
    // Another device's edit, joined into this memo: show it, keeping the caret where it was.
    if (!memoComposing && memo.text !== memoText.value && !memoSent.has(memo.text)) replaceKeepingCaret(memoText, memo.text);
    return;
  }
  const back = h("button", { class: "memo-back" }, icon("chevron", 13, 2), t("메모 목록"));
  back.addEventListener("click", () => { closeMemo(); render(); });
  const remove = h("button", { class: "quiet", title: t("메모 지우기"), "aria-label": t("메모 지우기") }, icon("trash", 15));
  remove.addEventListener("click", () => { deleteMemo(memo.id); openMemoID = undefined; memoText = undefined; });
  const text = h("textarea", { class: "memo-text", placeholder: t("생각나는 걸 적어 보세요"), "aria-label": t("메모 내용"), spellcheck: "false" });
  text.value = memo.text;
  text.addEventListener("input", () => {
    if (memoSent.size > 200) memoSent = new Set([text.value]);
    memoSent.add(text.value);
    const from = memoValue;
    memoValue = text.value;
    void api.act({ type: "memoUpdate", id: memo.id, text: text.value, from });
  });
  text.addEventListener("compositionstart", () => { memoComposing = true; });
  text.addEventListener("compositionend", () => { memoComposing = false; });
  text.addEventListener("keydown", (event) => { if (event.key === "Escape") { closeMemo(); render(); } });
  memoText = text;
  memoSent = new Set([memo.text]);
  memoComposing = false;
  memoValue = memo.text;
  sheet.classList.remove("with-strip");
  sheet.replaceChildren(h("div", { class: "memo-editor" }, h("div", { class: "memo-bar" }, back, h("span", { class: "spacer" }), h("span", { class: "memo-date" }, shortDate(memo.updatedAt)), remove), text));
  footer.replaceChildren(h("span", {}, icon("note", 13)), h("span", {}, t("자동으로 저장돼요 · Esc로 목록")));
  requestAnimationFrame(() => text.focus());
}

/** New text in the editor; the caret keeps its place relative to the text around it. */
function replaceKeepingCaret(area: HTMLTextAreaElement, next: string): void {
  const moved = movedCaret(area.selectionStart, area.value, next);
  area.value = next;
  memoSent = new Set([next]);
  memoValue = next;
  area.setSelectionRange(moved, moved);
}

// ─── Rows ─────────────────────────────────────────────────────────────────────

const STRIKE_PATH = "M0 0.56 C0.12 0.5 0.22 0.6 0.34 0.54 S0.58 0.5 0.7 0.57 S0.9 0.52 1 0.55";

/** What an 앞으로 row says at its right end: "마감" on a day, its date under 그 뒤, nothing on 언젠가. */
type RowMeta = { kind: "day" } | { kind: "date"; text: string } | { kind: "none" };

class Row {
  readonly element: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private readonly textCell: HTMLDivElement;
  private readonly due: HTMLButtonElement;
  private readonly time: HTMLButtonElement;
  private readonly sent: HTMLSpanElement;
  private readonly bell: HTMLButtonElement;
  private readonly flag: HTMLButtonElement;
  private readonly sun: HTMLButtonElement;
  private readonly later: HTMLButtonElement;
  private readonly tomorrow: HTMLButtonElement;
  private readonly focusButton: HTMLButtonElement;
  private readonly carry: HTMLSpanElement;
  private readonly star: HTMLSpanElement;
  private item: TodoItem;

  /** `onShelf`: a row of 앞으로 (with `meta`), else of 오늘. */
  constructor(item: TodoItem, private readonly onShelf: boolean, private next = false, public meta: RowMeta = { kind: "none" }) {
    this.item = item;
    const grip = h("div", { class: "grip", title: onShelf ? t("잡아서 다른 날이나 언젠가로 끌어 옮기기") : t("잡아서 위아래로 끌어 순서 변경"), "aria-hidden": "true" });
    grip.innerHTML = '<svg width="8" height="14" viewBox="0 0 8 14" fill="currentColor"><circle cx="2" cy="2" r="1.1"/><circle cx="6" cy="2" r="1.1"/><circle cx="2" cy="7" r="1.1"/><circle cx="6" cy="7" r="1.1"/><circle cx="2" cy="12" r="1.1"/><circle cx="6" cy="12" r="1.1"/></svg>';
    grip.addEventListener("pointerdown", (event) => (onShelf ? startAheadDrag : startDrag)(event, this.item.id, grip));
    const box = h("span", { class: "box" }, icon("check", 13, 2.6));
    const check = h("button", { class: "check" }, box);
    this.label = h("span", { class: "label" });
    const strike = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    strike.setAttribute("class", "strike");
    strike.setAttribute("viewBox", "0 0 1 1");
    strike.setAttribute("preserveAspectRatio", "none");
    strike.innerHTML = `<path vector-effect="non-scaling-stroke" d="${STRIKE_PATH}"/>`;
    this.label.append(strike);
    // 오늘 꼭 하나: the day's one thing, starred.
    this.star = h("span", { class: "star", title: t("오늘 꼭 하나"), role: "img", "aria-label": t("오늘 꼭 하나") }, icon("star", 12, 1.6));
    this.textCell = h("div", { class: "text" }, this.star, this.label);
    this.due = h("button", { class: "due" });
    this.time = h("button", { class: "time" });
    // Put in the calendar (a copy: changing the task later doesn't change the event).
    this.sent = h("span", { class: "sent-mark", title: t("달력에 넣음"), "aria-label": t("달력에 넣음"), role: "img" }, icon("calendar", 13));
    this.bell = h("button", { class: "row-icon bell", title: t("알림 · 반복 · 마감 설정") }, icon("bell", 15));
    this.flag = h("button", { class: "row-icon", title: t("마감 날짜") }, icon("flag", 15));
    // Moving between tabs is said in words: ↑ 오늘로 / ↓ 언젠가.
    this.sun = h("button", { class: "move", title: t("오늘 할 일로 옮겨요") }, icon("arrowUp", 11, 2.4), t("오늘로"));
    this.later = h("button", { class: "move", title: t("앞으로 탭의 언젠가로 옮겨요 (Ctrl+Z로 되돌리기)") }, icon("arrowDown", 11, 2.4), h("span", { class: "move-label" }, t("언젠가")));
    // 내일 하기: due tomorrow (Alt+→ on a selected row).
    this.tomorrow = h("button", { class: "move", title: t("내일 할 일로 옮겨요 (Alt+→)") }, icon("arrowRight", 11, 2.4), h("span", { class: "move-label" }, t("내일")));
    // 집중 from the row (F on a selected row).
    this.focusButton = h("button", { class: "row-icon focus-row", title: t("이거 집중 (F)") }, icon("timer", 15));
    const trash = h("button", { class: "row-icon trash", title: t("지우기 (Ctrl+Z로 되돌리기)") }, icon("trash", 15));
    // The end of the row: the deadline and alert as quiet text; on hover that spot turns into the
    // row's buttons. Nothing covers the title, and at rest it keeps the full width.
    const actions = h("div", { class: "actions" }, this.sun, this.tomorrow, this.later, this.focusButton, this.bell, this.flag, trash);
    // 어제부터 · 3일째: how long an undated task has stayed on 오늘.
    this.carry = h("span", { class: "carry" });
    // 할 일 골라 집중…: on hover, a small 집중 in place of the row's buttons.
    const pick = h("button", { class: "focus-pick", title: t("이 할 일에 집중") }, icon("timer", 13), t("집중"));
    pick.addEventListener("click", () => pickTask(this.item.id));
    this.element = h("div", { class: "row", role: "listitem", "data-id": item.id }, grip, check, this.textCell, this.carry, this.due, this.time, this.sent, actions, pick, h("span", { class: "end" }));

    check.addEventListener("click", () => {
      commitEditing();
      // 앞으로 lists open tasks only: a checked one plays its check, then goes.
      if (!this.item.isCompleted && (state.prefs.hideCompleted || this.onShelf)) holdWhileFinishing(this.item.id);
      void api.act({ type: "toggle", id: this.item.id });
    });
    this.label.addEventListener("click", () => this.beginEdit());
    this.due.addEventListener("click", () => openEditor(this.item.id, "deadline"));
    this.time.addEventListener("click", () => openEditor(this.item.id, rangeOf(this.item) ? "time" : undefined));
    this.bell.addEventListener("click", () => openEditor(this.item.id));
    this.flag.addEventListener("click", () => openEditor(this.item.id, "deadline"));
    this.sun.addEventListener("click", () => { void api.act({ type: "dropAhead", id: this.item.id, target: { kind: "today" } }); movedToast({ kind: "today" }); });
    this.later.addEventListener("click", () => { void api.act({ type: "moveToLater", id: this.item.id }); movedToast({ kind: "someday" }); });
    this.tomorrow.addEventListener("click", () => moveToDay(this.item.id, tomorrowKey(new Date())));
    this.focusButton.addEventListener("click", () => startFocus(this.item.id));
    trash.addEventListener("click", () => deleteTask(this.item.id));
    // A click on the row's empty space selects it for the keyboard (↑↓ · Space · Enter · Delete).
    this.element.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button, input, .label, .grip")) return;
      select(this.item.id, false);
    });
    this.element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      commitEditing();
      void api.act({ type: "showRowMenu", id: this.item.id });
    });
    this.render(item, false);
  }

  update(item: TodoItem): void {
    const completedNow = item.isCompleted && !this.item.isCompleted;
    this.item = item;
    // Every state push redraws the page: a row whose task and surroundings didn't change is left alone.
    if (!completedNow && this.drawnKey === this.key(item)) return;
    this.render(item, completedNow);
  }

  /** Everything the row's look depends on (the minute too: "어제부터", D-3 and 내일 09:00 move with the clock). */
  private drawnKey = "";
  private key(item: TodoItem): string {
    const series = item.seriesID ? state.series.find((entry) => entry.id === item.seriesID) : undefined;
    return JSON.stringify([item, this.next, this.onShelf, this.meta, state.prefs.dueStyle, editingID === item.id, series?.rule, series?.remindAt,
      isStarred(item), Boolean(state.calendar?.withEvents?.includes(item.id)), Math.floor(Date.now() / 60_000)]);
  }

  /** Updated, and moved in or out of 다음 (its rows don't drag: their order is the time's). */
  updated(item: TodoItem, next: boolean): HTMLElement {
    this.next = next;
    this.update(item);
    return this.element;
  }

  private render(item: TodoItem, animate: boolean): void {
    this.drawnKey = this.key(item);
    this.element.classList.toggle("done", item.isCompleted);
    this.element.classList.toggle("up-next", this.next);
    if (animate && !reduceMotion()) {
      this.element.classList.add("animate", "pop");
      setTimeout(() => this.element.classList.remove("animate", "pop"), 520);
      nod();
    }
    if (editingID !== item.id) {
      const text = this.label.firstChild;
      if (text?.nodeType === Node.TEXT_NODE) text.textContent = item.title; else this.label.prepend(item.title);
    }
    this.label.title = t("{title} — 눌러서 고치기", { title: item.title });
    const check = this.element.querySelector(".check")!;
    check.setAttribute("aria-label", item.isCompleted ? t("{title} 완료 취소", { title: item.title }) : t("{title} 완료", { title: item.title }));
    check.setAttribute("title", item.isCompleted ? t("완료 취소") : t("완료 표시"));

    // Deadline: "D-3" / "~금"; overdue in the accent colour, due soon in sage.
    const now = new Date();
    this.due.hidden = !item.dueDate || item.isCompleted;
    if (item.dueDate && !item.isCompleted) {
      const level = urgency(item.dueDate, now);
      // 앞으로: the day already says when — the row has a quiet ink flag (clay only when late, as on the
      // Mac; the word is for screen readers), or its date under 그 뒤.
      this.due.removeAttribute("aria-label");
      if (this.onShelf && this.meta.kind === "day") {
        this.due.className = `due ahead-day${level === "overdue" ? " late" : ""}`;
        this.due.replaceChildren(icon("flag", 13));
        this.due.setAttribute("aria-label", t("마감"));
      } else if (this.onShelf && this.meta.kind === "date") {
        this.due.className = "due later";
        this.due.replaceChildren(icon("flag", 13), this.meta.text);
      } else {
        this.due.className = `due ${level}`;
        this.due.replaceChildren(icon("flag", 13, level === "overdue" ? 2.2 : 1.7), dueLabel(item.dueDate, state.prefs.dueStyle, now, lang()));
      }
      this.due.title = `${dueSentence(item.dueDate, now, lang())} · ${t("눌러서 고치기")}`;
    }

    this.sent.hidden = item.isCompleted || !state.calendar?.withEvents?.includes(item.id);

    const series = item.seriesID ? state.series.find((entry) => entry.id === item.seriesID) : undefined;
    const hasReminder = Boolean(item.reminderAt);
    // 시간 정하기: a task with hours on its day says them (clock) in place of the bell's time.
    const ranged = rangeTimes(item, now);
    const showPill = Boolean(ranged) || hasReminder || Boolean(series && !item.isCompleted);
    this.time.hidden = !showPill;
    this.bell.hidden = this.onShelf || item.isCompleted;
    this.later.hidden = this.onShelf || item.isCompleted || Boolean(item.dueDate);
    this.later.setAttribute("aria-label", t("{title} 언젠가로 옮기기", { title: item.title }));
    this.tomorrow.hidden = this.onShelf || item.isCompleted;
    this.tomorrow.setAttribute("aria-label", t("{title} 내일 하기", { title: item.title }));
    this.focusButton.hidden = item.isCompleted;
    this.focusButton.setAttribute("aria-label", t("{title} 집중", { title: item.title }));
    const carried = this.onShelf || this.next || item.isCompleted ? undefined : carriedText(carriedDays(item, now), lang());
    this.carry.hidden = !carried;
    this.carry.textContent = carried ?? "";
    this.carry.title = carried ? t("{text} 오늘 할 일에 있어요", { text: carried }) : "";
    this.star.hidden = !isStarred(item);
    this.bell.setAttribute("aria-label", t("{title} 알림·반복·마감 설정", { title: item.title }));
    this.flag.hidden = !this.onShelf || item.isCompleted;
    this.flag.title = item.dueDate ? t("마감 날짜 바꾸기") : t("마감 정하기");
    this.sun.hidden = !this.onShelf || item.isCompleted;
    this.flag.setAttribute("aria-label", t("{title} 마감 날짜", { title: item.title }));
    this.sun.setAttribute("aria-label", t("{title} 오늘 하기", { title: item.title }));
    this.time.classList.toggle("ranged", Boolean(ranged));
    if (ranged) {
      const text = rangeText(ranged.range, lang());
      const labels = [text, ...(hasReminder && Date.parse(item.reminderAt!) !== ranged.start.getTime() ? [rowLabel(item, new Date(), lang()) ?? ""] : [])].filter(Boolean);
      this.time.replaceChildren(icon("clock", 13), text);
      this.time.classList.toggle("quiet-time", item.isCompleted);
      this.time.title = `${labels.join(" · ")} · ${t("눌러서 고치기")}`;
      this.time.setAttribute("aria-label", t("시간 {range}", { range: text }));
    } else if (showPill) {
      this.time.removeAttribute("aria-label");
      const parts: (Node | string)[] = [];
      const labels: string[] = [];
      if (series) {
        parts.push(icon("repeat", 13));
        labels.push(describe(series.rule, series.remindAt, lang()));
      }
      if (hasReminder) {
        const at = new Date(item.reminderAt!);
        const sent = Boolean(item.reminderLastDeliveredAt && Date.parse(item.reminderLastDeliveredAt) >= at.getTime());
        if (!series) parts.push(icon(sent && !item.isCompleted ? "check" : "bell", 13));
        // Today's reminders say just the time (tabular): bell 16:00; other days "내일 09:00".
        const today = logicalDayStart(new Date());
        const onToday = at.getTime() >= today.getTime() && at.getTime() < today.getTime() + 86_400_000;
        parts.push(onToday ? clock(at.getHours(), at.getMinutes(), lang()) : compactTime(at, new Date(), lang()));
        this.time.classList.toggle("quiet-time", item.isCompleted || sent);
        labels.push(rowLabel(item, new Date(), lang()) ?? "");
      } else {
        parts.push(series!.rule.kind === "weekly" ? describe(series!.rule, undefined, lang()).replace(`${t("매주")} `, "") : describe(series!.rule, undefined, lang()));
        this.time.classList.remove("quiet-time");
      }
      this.time.replaceChildren(...parts);
      this.time.title = `${labels.join(" · ")} · ${t("눌러서 고치기")}`;
    }
  }

  beginEdit(): void {
    if (editingID) commitEditing();
    editingID = this.item.id;
    this.element.classList.add("editing");
    const input = h("input", { class: "edit", type: "text", "aria-label": t("할 일 고치기"), spellcheck: "false" });
    input.value = this.item.title;
    this.label.hidden = true;
    this.textCell.append(input);
    input.focus();
    input.select();
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing) { event.preventDefault(); commitEditing(); }
      if (event.key === "Escape") { event.preventDefault(); this.endEdit(); }
    });
    input.addEventListener("blur", () => commitEditing());
  }

  commitEdit(): void {
    const input = this.textCell.querySelector<HTMLInputElement>(".edit");
    const value = input?.value ?? "";
    this.endEdit();
    if (value.trim() && value.trim() !== this.item.title) void api.act({ type: "rename", id: this.item.id, title: value });
  }

  endEdit(): void {
    if (editingID === this.item.id) editingID = undefined;
    this.textCell.querySelector(".edit")?.remove();
    this.label.hidden = false;
    this.element.classList.remove("editing");
    this.render(this.item, false);
  }
}

function rowFor(id: string): Row | undefined {
  return (page === "ahead" ? aheadRows : todayRows).get(id);
}

function commitEditing(): void {
  if (editingID) rowFor(editingID)?.commitEdit();
}

function holdWhileFinishing(id: string): void {
  finishing.add(id);
  setTimeout(() => { finishing.delete(id); render(); }, 650);
}

/** The cat nods when a task is checked (still under reduced motion). */
function nod(): void {
  if (reduceMotion()) return;
  cat.classList.remove("nod");
  void cat.offsetWidth;
  cat.classList.add("nod");
  setTimeout(() => cat.classList.remove("nod"), 420);
}

// ─── Drag to reorder (today) ────────────────────────────────────────────────

function startDrag(event: PointerEvent, id: string, grip: HTMLElement): void {
  if (event.button !== 0) return;
  event.preventDefault();
  commitEditing();
  grip.setPointerCapture(event.pointerId);
  const source = todayRows.get(id)!.element;
  source.classList.add("dragging");
  let drop: { targetID: string; after: boolean } | undefined;
  /** Over the 앞으로 tab: dropping there moves the task to that page. */
  let tabTarget: NoteTab | undefined;
  // Looked up each time: a redraw during the drag replaces the tabs.
  const tabElements = () => [...tabs.querySelectorAll<HTMLElement>(".index-tab")];
  const clear = () => {
    for (const row of todayRows.values()) row.element.classList.remove("drop-before", "drop-after");
    for (const tab of tabElements()) tab.classList.remove("drop-target");
    source.classList.remove("to-tab");
  };
  const move = (moveEvent: PointerEvent) => {
    // Inside its group: 다음 keeps the time's order, so rows move among the rest only.
    const visible = todayGroups().rest;
    clear();
    drop = undefined;
    const rects = tabElements().map((element, index) => {
      const rect = element.getBoundingClientRect();
      return { tab: pages[index] as NoteTab, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
    const over = tabAt(rects, moveEvent.clientX, moveEvent.clientY);
    tabTarget = over && dropTabs.includes(over) ? over : undefined;
    if (tabTarget) {
      tabElements()[pages.indexOf(tabTarget)]?.classList.add("drop-target");
      source.classList.add("to-tab");
    }
    if (over) return;
    for (const [index, item] of visible.entries()) {
      const rect = todayRows.get(item.id)?.element.getBoundingClientRect();
      if (!rect) continue;
      if (moveEvent.clientY < rect.bottom || index === visible.length - 1) {
        const after = moveEvent.clientY >= rect.top + rect.height / 2;
        if (item.id !== id) {
          drop = { targetID: item.id, after };
          todayRows.get(item.id)?.element.classList.add(after ? "drop-after" : "drop-before");
        }
        break;
      }
    }
  };
  const end = () => {
    grip.removeEventListener("pointermove", move);
    source.classList.remove("dragging");
    clear();
    if (tabTarget) {
      // Said where it went: its day (a deadline still ahead) or 언젠가.
      const item = state.items.find((entry) => entry.id === id);
      const result = item ? tabDrop(item, tabTarget, new Date()) : undefined;
      void api.act({ type: "dropOnTab", id, tab: tabTarget });
      if (result) movedToast(result.kind === "deadline" ? { kind: "day", day: result.dueDate } : { kind: "someday" });
    } else if (drop) void api.act({ type: "move", id, targetID: drop.targetID, after: drop.after });
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", end, { once: true });
  grip.addEventListener("pointercancel", () => { drop = undefined; tabTarget = undefined; end(); }, { once: true });
}

// ─── Drag on 앞으로 ──────────────────────────────────────────────────────────

/** A drag is on (the page holds still until the drop). */
let dragging = false;

/** The task ids of the block (a day, 언젠가, a month of 그 뒤) holding `id`, top to bottom. */
function zoneSiblings(id: string): string[] {
  const zone = aheadRows.get(id)?.element.closest(".aday-items");
  return zone ? [...zone.querySelectorAll<HTMLElement>(":scope > .row")].map((element) => element.dataset.id!) : [];
}

/**
 * A task dragged by its grip: onto another day (its due date becomes that day), onto 언젠가 (no
 * date, on the shelf), onto the 오늘 tab (today), or up and down inside its own day or 언젠가 (its
 * place). The day under the pointer lights up in sage, a line shows where it lands; near the top or
 * the bottom the page scrolls. After a move, a toast says where it went (되돌리기 = Ctrl+Z).
 */
function startAheadDrag(event: PointerEvent, id: string, grip: HTMLElement): void {
  if (event.button !== 0) return;
  event.preventDefault();
  commitEditing();
  grip.setPointerCapture(event.pointerId);
  const source = aheadRows.get(id)?.element;
  if (!source) return;
  dragging = true;
  source.classList.add("dragging");
  const home = source.closest<HTMLElement>(".drop-zone, .amonth");
  // A task with a date can go to 언젠가 even when 언젠가 is empty.
  if (home?.dataset.day !== "someday") showEmptySomeday();
  // Any day of this week and next week, empty ones too.
  showAllDays();
  let zone: HTMLElement | undefined;
  let near: { id: string; after: boolean } | undefined;
  let toToday = false;
  let pointerY = event.clientY;
  const tabElements = () => [...tabs.querySelectorAll<HTMLElement>(".index-tab")];
  const clear = () => {
    for (const element of aheadList.querySelectorAll(".drop-target, .drop-before, .drop-after")) element.classList.remove("drop-target", "drop-before", "drop-after");
    for (const tab of tabElements()) tab.classList.remove("drop-target");
    source.classList.remove("to-tab");
  };
  const locate = (x: number, y: number) => {
    clear();
    zone = undefined;
    near = undefined;
    toToday = false;
    const rects = tabElements().map((element, index) => {
      const rect = element.getBoundingClientRect();
      return { tab: pages[index], left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
    const over = tabAt(rects, x, y);
    if (over === "today") {
      toToday = true;
      tabElements()[0]?.classList.add("drop-target");
      source.classList.add("to-tab");
      return;
    }
    if (over) return;
    const sheetRect = sheet.getBoundingClientRect();
    if (y < sheetRect.top || y > sheetRect.bottom) return;
    // The zone under the pointer, or the one whose band (its top to the next one's) holds it.
    const zones = [...aheadList.querySelectorAll<HTMLElement>(".drop-zone")];
    zone = zones.find((element) => { const rect = element.getBoundingClientRect(); return y >= rect.top && y <= rect.bottom; });
    // 언젠가's heading takes a drop for 언젠가 too.
    const head = aheadList.querySelector(".head-someday")?.getBoundingClientRect();
    if (!zone && head && y >= head.top - 4 && y <= head.bottom) zone = aheadList.querySelector<HTMLElement>(".someday.drop-zone") ?? undefined;
    if (!zone) return;
    if (zone !== home) zone.classList.add("drop-target");
    const rows = [...zone.querySelectorAll<HTMLElement>(".aday-items > .row")].filter((element) => element !== source);
    for (const [index, row] of rows.entries()) {
      const rect = row.getBoundingClientRect();
      if (y < rect.bottom || index === rows.length - 1) {
        const after = y >= rect.top + rect.height / 2;
        near = { id: row.dataset.id!, after };
        row.classList.add(after ? "drop-after" : "drop-before");
        break;
      }
    }
  };
  // Near the sheet's top or bottom edge, the page scrolls while the pointer waits there.
  const scroller = window.setInterval(() => {
    const rect = sheet.getBoundingClientRect();
    const edge = 28;
    const step = pointerY < rect.top + edge ? -8 : pointerY > rect.bottom - edge ? 8 : 0;
    if (step) sheet.scrollBy({ top: step });
  }, 16);
  const move = (moveEvent: PointerEvent) => {
    pointerY = moveEvent.clientY;
    locate(moveEvent.clientX, moveEvent.clientY);
  };
  const end = (cancelled: boolean) => {
    grip.removeEventListener("pointermove", move);
    window.clearInterval(scroller);
    source.classList.remove("dragging");
    clear();
    dragging = false;
    const target: AheadTarget | undefined = cancelled ? undefined : toToday ? { kind: "today" } : zone ? (zone.dataset.day === "someday" ? { kind: "someday" } : { kind: "day", day: zone.dataset.day! }) : undefined;
    if (target && zone === home && home && target.kind !== "today") {
      // Inside its own day or 언젠가: only its place changes.
      if (near) void api.act({ type: "move", id, targetID: near.id, after: near.after });
    } else if (target) {
      void api.act({ type: "dropAhead", id, target, ...(near ? { near } : {}) });
      movedToast(target);
    }
    // The empty days and 언젠가 shown for the drag go (the state's redraw follows).
    render();
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", () => end(false), { once: true });
  grip.addEventListener("pointercancel", () => end(true), { once: true });
}

// ─── Editor: 한 번 알림 · 반복 · 마감 ─────────────────────────────────────────

let editor: { close(): void } | undefined;
type EditorMode = "once" | "repeat" | "deadline" | "time";

function quickChoices(now = new Date()): { label: string; date: Date }[] {
  return [
    { label: minutesAway(10, lang()), date: new Date(now.getTime() + 10 * 60_000) },
    { label: minutesAway(30, lang()), date: new Date(now.getTime() + 30 * 60_000) },
    { label: t("1시간 뒤"), date: new Date(now.getTime() + 60 * 60_000) },
    { label: t("내일 오전 9시"), date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0) },
  ];
}

const pad = (value: number) => String(value).padStart(2, "0");

/** A day in few characters, under a deadline choice: "10/8 (목)", "Thu 10/8", "do 8/10". */
function numericDay(day: Date): string {
  const [month, date, weekday] = [day.getMonth() + 1, day.getDate(), weekdayShort(day.getDay(), lang())];
  if (lang() === "ko") return `${month}/${date} (${weekday})`;
  return lang() === "en" ? `${weekday} ${month}/${date}` : `${weekday} ${date}/${month}`;
}

function openEditor(id: string, startOn?: EditorMode): void {
  editor?.close();
  toast.hide();
  eventSheet?.close();
  commitEditing();
  const item = state.items.find((entry) => entry.id === id);
  const row = rowFor(id);
  if (!item || !row) return;
  void api.act({ type: "editingReminder", id });
  const series = state.series.find((entry) => entry.id === item.seriesID);
  let mode: EditorMode = startOn ?? (series ? "repeat" : "once");
  const now = new Date();

  // ── 한 번 알림: quick choices, or a day on the paper calendar plus a time
  const existing = item.reminderAt ? new Date(item.reminderAt) : undefined;
  let chosen: Date | undefined = existing && existing.getTime() > Date.now() ? existing : undefined;
  let quickIndex: number | undefined;
  const summaryWhen = h("div", { class: "when" });
  const summary = h("div", { class: "summary" }, icon("clock", 16), h("div", {}, h("div", { class: "hint" }, t("알림 시간")), summaryWhen, h("div", { class: "hint" }, t("앱이 켜져 있을 때 종이냥이 알려드려요."))));
  const quick = h("div", { class: "quick" });
  quickChoices(now).forEach((choice, index) => {
    const choiceButton = h("button", {}, choice.label);
    choiceButton.addEventListener("click", () => { quickIndex = index; chosen = choice.date; timeInput.value = `${pad(choice.date.getHours())}:${pad(choice.date.getMinutes())}`; refresh(); });
    quick.append(choiceButton);
  });
  const base = chosen ?? new Date(now.getTime() + 60 * 60_000);
  const timeInput = h("input", { type: "time", "aria-label": t("알림 시각") });
  timeInput.value = `${pad(base.getHours())}:${pad(base.getMinutes())}`;
  let customDay = base;
  const onceCalendar = paperCalendar({ selected: base, minimum: now, onPick: (date) => { customDay = date; applyCustom(); } });
  const applyCustom = () => {
    const [hour, minute] = timeInput.value.split(":").map(Number);
    quickIndex = undefined;
    chosen = new Date(customDay.getFullYear(), customDay.getMonth(), customDay.getDate(), hour || 0, minute || 0);
    refresh();
  };
  timeInput.addEventListener("input", applyCustom);
  // The calendar folds away behind one row (as on the Mac), so the editor fits a small note.
  const otherDay = h("div", { class: "panel other-day" }, onceCalendar,
    h("div", { class: "alert-row" }, icon("clock", 14), h("span", { class: "grow" }, t("시간")), timeInput));
  const otherToggle = h("button", { class: "other-toggle", "aria-expanded": "false" }, icon("calendar", 14), h("span", { class: "grow" }, t("다른 날짜·시간")), icon("chevronRight", 12, 2));
  const showOtherDay = (open: boolean) => {
    otherDay.hidden = !open;
    otherToggle.setAttribute("aria-expanded", String(open));
    otherToggle.classList.toggle("open", open);
  };
  otherToggle.addEventListener("click", () => { showOtherDay(!otherToggle.classList.contains("open")); place(); });
  showOtherDay(false);
  const oncePanel = h("div", { class: "panel" },
    h("div", { class: "caption" }, t("빠른 선택")), quick, otherToggle, otherDay);

  // ── 반복
  const repeat = repeatFields(series ? { rule: series.rule, remindAt: series.remindAt } : undefined, () => refresh());
  const repeatPanel = h("div", { class: "panel" }, repeat.element);

  // ── 마감
  const choices: DeadlineChoice[] = [{ kind: "today" }, { kind: "thisWeek" }, { kind: "thisMonth" }];
  const existingDue = item.dueDate;
  let deadline: DeadlineChoice = choices.find((choice) => dayFor(choice, now, lang()) === existingDue)
    ?? (existingDue ? { kind: "date", date: fromKey(existingDue)! } : { kind: "thisWeek" });
  const logicalToday = logicalDayStart(now);
  let deadlineDate = existingDue ? fromKey(existingDue)! : logicalToday;
  let keepOnToday = item.shelf === "today";
  const deadlineKey = () => deadline.kind === "date" ? dueKey(deadlineDate) : dayFor(deadline, now, lang());
  const deadlineChoices = h("div", { class: "quick" });
  const deadlineCalendar = paperCalendar({ selected: deadlineDate, minimum: logicalToday, span: true, today: () => logicalDayStart(new Date()), onPick: (date) => { deadlineDate = date; deadline = { kind: "date", date }; refresh(); } });
  const deadlineSummaryWhen = h("div", { class: "when" });
  const deadlineSummaryHint = h("div", { class: "hint" });
  const keepToggle = h("button", { class: "switch small", role: "switch", "aria-label": t("오늘 할 일에도 두기") });
  keepToggle.addEventListener("click", () => { keepOnToday = !keepOnToday; refresh(); });
  const deadlineSummary = h("div", { class: "summary" }, icon("flag", 16), h("div", {}, h("div", { class: "hint" }, t("마감")), deadlineSummaryWhen, deadlineSummaryHint));
  const deadlinePanel = h("div", { class: "panel" }, deadlineChoices, deadlineCalendar,
    h("div", { class: "alert-row", title: t("마감 전이라도 오늘 할 일에 계속 둬요") }, icon("pin", 14), h("span", { class: "grow" }, t("오늘 할 일에도 두기")), keepToggle));

  // ── 시간 (1.24): start → end on the task's day, the length, quick lengths; the reminder follows (timeRange.ts).
  const rangeDayKey = rangeDay(item, now);
  const existingRange = rangeOf(item);
  const nextHour = Math.min(23, now.getHours() + 1) * 60;
  let rangeStart: number = existingRange?.start ?? (rangeDayKey === dayKey(now) ? nextHour : 540);
  // A clock `minutes` after the start, if that is still on the start's day (before 04:00).
  const after = (minutes: number): number | undefined => { const end = (rangeStart + minutes) % 1440; return validRange({ start: rangeStart, end }) ? end : undefined; };
  let rangeEnd: number | undefined = existingRange ? existingRange.end : after(60);
  let timePop: { close(): void } | undefined;
  const startChip = h("button", { class: "chip sheet-chip", "aria-haspopup": "listbox", "aria-label": t("시작 시각") });
  const endChip = h("button", { class: "chip sheet-chip", "aria-haspopup": "listbox", "aria-label": t("끝 시각") });
  const rangeLength = h("span", { class: "sheet-dim range-length" });
  // "1시간 30분" · "1 h 30 min" · "1 u 30 min" (the timer's lengths, as on the Mac).
  const lengthOf = (minutes: number) => durationText(minutes, lang());
  const lengthNow = () => (rangeEnd === undefined ? undefined : logicalMinutes(rangeEnd) - logicalMinutes(rangeStart));
  startChip.addEventListener("click", () => {
    timePop?.close();
    timePop = timeList(startChip, rangeStart, (minutes) => {
      if (minutes === undefined) return;
      // Moving the start keeps the length, as the event sheet does.
      const length = lengthNow();
      rangeStart = minutes;
      if (length !== undefined) rangeEnd = after(length);
      refresh();
    }, () => { timePop = undefined; });
  });
  endChip.addEventListener("click", () => {
    timePop?.close();
    timePop = timeList(endChip, rangeEnd, (minutes) => { rangeEnd = minutes; refresh(); }, () => { timePop = undefined; }, { none: t("끝 없음") });
  });
  const lengthChoices = h("div", { class: "quick lengths" }, ...[30, 60, 120].map((minutes) => {
    const choice = h("button", { "data-minutes": String(minutes) }, lengthOf(minutes));
    choice.addEventListener("click", () => { rangeEnd = after(minutes) ?? rangeEnd; refresh(); });
    return choice;
  }));
  const timeSummaryWhen = h("div", { class: "when" });
  const timeSummaryHint = h("div", { class: "hint" });
  const timeSummary = h("div", { class: "summary" }, icon("clock", 16), h("div", {}, h("div", { class: "hint" }, t("할 일 시간")), timeSummaryWhen, timeSummaryHint));
  const timePanel = h("div", { class: "panel time-panel" },
    h("div", { class: "time-line" }, startChip, h("span", { class: "sheet-dim", "aria-hidden": "true" }, "→"), endChip, rangeLength),
    h("div", { class: "caption" }, t("길이")), lengthChoices);
  const chosenRange = (): { start: number; end?: number } => ({ start: rangeStart, ...(rangeEnd !== undefined ? { end: rangeEnd } : {}) });

  const tabBar = h("div", { class: "seg tabs", role: "tablist" });
  const save = h("button", { class: "action primary" });
  const cancel = h("button", { class: "action" }, t("취소"));
  const remove = h("button", { class: "action" });
  const body = h("div", { class: "body" },
    h("div", { class: "kicker" }, icon("bell", 12), rangeDayKey ? t("알림 · 반복 · 마감 · 시간") : t("알림 · 반복 · 마감")),
    h("div", { class: "task" }, item.title),
    tabBar, oncePanel, repeatPanel, deadlinePanel, timePanel,
  );
  scrollFade(body);
  // The chosen time or deadline sits under the scrolling part, above the buttons, so it always shows.
  const pinned = h("div", { class: "pinned" });
  const card = h("div", { class: `editor${rangeDayKey ? " four" : ""}`, role: "dialog", "aria-label": rangeDayKey ? t("할 일 알림·반복·마감·시간") : t("할 일 알림·반복·마감") },
    body, pinned,
    h("div", { class: "actions" }, remove, h("span", { class: "spacer" }), cancel, save),
  );
  const scrim = h("div", { class: "scrim" });
  document.body.append(scrim, card);

  function refresh(): void {
    const modes: [EditorMode, string, string][] = [["once", t("한 번 알림"), "bell"], ["repeat", t("반복"), "repeat"], ["deadline", t("마감"), "flag"], ...(rangeDayKey ? [["time", t("시간"), "clock"] as [EditorMode, string, string]] : [])];
    tabBar.replaceChildren(...modes.map(([value, label, symbol]) => {
      const tab = h("button", { role: "tab", "aria-checked": String(mode === value), "aria-selected": String(mode === value) }, icon(symbol, 12), label);
      tab.addEventListener("click", () => { mode = value; refresh(); place(); });
      return tab;
    }));
    oncePanel.hidden = mode !== "once";
    repeatPanel.hidden = mode !== "repeat";
    deadlinePanel.hidden = mode !== "deadline";
    timePanel.hidden = mode !== "time";
    const shown = mode === "once" ? summary : mode === "deadline" ? deadlineSummary : mode === "time" ? timeSummary : undefined;
    if (shown && pinned.firstChild !== shown) pinned.replaceChildren(shown);
    pinned.hidden = !shown;
    [...quick.children].forEach((child, index) => child.classList.toggle("selected", index === quickIndex));
    const valid = chosen !== undefined && !Number.isNaN(chosen.getTime()) && chosen.getTime() > Date.now();
    summary.classList.toggle("invalid", chosen !== undefined && !valid);
    summaryWhen.textContent = chosen === undefined ? t("시간을 골라 주세요") : valid ? scheduledTime(chosen, new Date(), lang()) : t("지난 시간은 고를 수 없어요");

    deadlineChoices.replaceChildren(...[...choices, { kind: "date", date: deadlineDate } as DeadlineChoice].map((choice) => {
      const names = deadlineChoiceTitles[lang()];
      // Two lines: the name, then the day it means — so 이번 달 안 never wraps.
      const day = choice.kind === "date" && deadline.kind !== "date" ? undefined : fromKey(choice.kind === "date" ? dueKey(deadlineDate) : dayFor(choice, now, lang()));
      const sub = day ? numericDay(day) : t("달력에서 고르기");
      const choiceButton = h("button", { class: `two-line${choice.kind === deadline.kind ? " selected" : ""}` },
        h("span", { class: "choice-text" }, h("span", { class: "choice-title" }, names[choice.kind]), h("span", { class: "choice-sub" }, sub)));
      choiceButton.addEventListener("click", () => { deadline = choice; refresh(); });
      return choiceButton;
    }));
    deadlineCalendar.hidden = deadline.kind !== "date";
    const keyNow = deadlineKey();
    deadlineSummaryWhen.textContent = dueSentence(keyNow, now, lang());
    const waits = !keepOnToday && urgency(keyNow, now) !== "overdue" && urgency(keyNow, now) !== "today";
    deadlineSummaryHint.textContent = waits
      ? t("마감 날까지 ‘앞으로’ 탭에서 {label}로 기다려요", { label: dueLabel(keyNow, state.prefs.dueStyle, now, lang()) })
      : t("오늘 할 일에 {label}로 보여요", { label: dueLabel(keyNow, state.prefs.dueStyle, now, lang()) });
    keepToggle.setAttribute("aria-checked", String(keepOnToday));

    // 시간: the chips, the length, and what happens to the reminder.
    const rangeOk = validRange(chosenRange());
    startChip.textContent = timeOf(rangeStart);
    endChip.textContent = rangeEnd === undefined ? t("끝 없음") : timeOf(rangeEnd);
    rangeLength.textContent = rangeEnd !== undefined && rangeOk ? lengthOf(lengthNow()!) : rangeEnd === undefined ? t("30분으로 보여요") : "";
    [...lengthChoices.children].forEach((child) => child.classList.toggle("selected", lengthNow() === Number((child as HTMLElement).dataset.minutes)));
    timeSummary.classList.toggle("invalid", !rangeOk);
    if (rangeDayKey) {
      timeSummaryWhen.textContent = rangeOk ? rangeWhenText(rangeDayKey, chosenRange(), now, lang()) : t("끝은 시작보다 뒤여야 해요.");
      const reminder = rangeOk ? reminderFor(item!, chosenRange(), new Date()) : undefined;
      const startAt = rangeTimes({ ...item!, timeStart: clockKey(rangeStart), timeEnd: undefined }, now)?.start;
      timeSummaryHint.textContent = !rangeOk ? "" : reminder && startAt && reminder.getTime() === startAt.getTime()
        ? t("시작할 때 알려 드려요.")
        : reminder ? t("알림은 그대로예요 · {time}", { time: scheduledTime(reminder, new Date(), lang()) }) : t("이미 지난 시간이라 알림은 없어요.");
    }

    if (mode === "time") {
      save.replaceChildren(icon("clock", 14), t("시간 정하기"));
      save.disabled = !rangeOk;
      remove.textContent = t("시간 지우기");
      remove.hidden = !existingRange;
    } else if (mode === "once") {
      save.replaceChildren(icon("bell", 14), t("이 시간에 알림"));
      save.disabled = !valid;
      remove.textContent = t("알림 해제");
      remove.hidden = !existing;
    } else if (mode === "repeat") {
      save.replaceChildren(icon("repeat", 14), series ? t("반복 저장") : t("반복 만들기"));
      save.disabled = !repeat.value();
      remove.textContent = t("반복 해제");
      remove.hidden = !series;
    } else {
      save.replaceChildren(icon("flag", 14), t("마감 정하기", undefined, "button"));
      save.disabled = false;
      remove.textContent = t("마감 없애기");
      remove.hidden = !existingDue;
    }
    place();
  }
  refresh();

  // Sit just below the row, or above it when there isn't room.
  function place(): void {
    const rect = row!.element.getBoundingClientRect();
    const height = card.offsetHeight;
    const top = rect.bottom + 4 + height < window.innerHeight ? rect.bottom + 4 : Math.max(8, Math.min(rect.top - height - 4, window.innerHeight - height - 8));
    card.style.top = `${top}px`;
    card.style.left = `${Math.max(8, (window.innerWidth - card.offsetWidth) / 2)}px`;
  }
  place();
  // Its height changes (calendar opened, tab or month switched) or the window does: it moves to stay in the window.
  const resized = new ResizeObserver(() => place());
  resized.observe(card);
  window.addEventListener("resize", place);

  const close = () => {
    timePop?.close();
    resized.disconnect();
    window.removeEventListener("resize", place);
    card.remove();
    scrim.remove();
    editor = undefined;
    void api.act({ type: "editingReminder", id: undefined });
  };
  scrim.addEventListener("click", close);
  cancel.addEventListener("click", close);
  remove.addEventListener("click", () => {
    if (mode === "once") void api.act({ type: "setReminder", id });
    else if (mode === "repeat" && series) void api.act({ type: "deleteSeries", id: series.id });
    else if (mode === "deadline") void api.act({ type: "setDeadline", id });
    else if (mode === "time") void api.act({ type: "setRange", id });
    close();
  });
  save.addEventListener("click", () => {
    if (mode === "once" && chosen) void api.act({ type: "setReminder", id, at: chosen.toISOString() });
    const value = repeat.value();
    if (mode === "repeat" && value) void api.act({ type: "saveSeries", taskID: id, rule: value.rule, remindAt: value.remindAt });
    if (mode === "deadline") void api.act({ type: "setDeadline", id, dueDate: deadlineKey(), keepOnToday });
    if (mode === "time" && validRange(chosenRange())) void api.act({ type: "setRange", id, ...chosenRange() });
    close();
  });
  card.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });
  (tabBar.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
  editor = { close };
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(): void {
  if (!state) return; // a command can arrive before the first state (it just picks the page)
  const root = document.documentElement;
  root.dataset.font = state.prefs.font;
  root.style.setProperty("--body-size", `${bodyFontSize(state.prefs.font, state.prefs.textSize)}px`);
  pinButton.classList.toggle("on", state.prefs.alwaysOnTop);
  pinButton.title = state.prefs.alwaysOnTop ? t("항상 위에 두기 해제") : t("항상 위에 두기");
  renderHeader();
  if (page === "today") renderToday();
  else if (page === "ahead") renderAhead();
  else renderMemos();
  dock.hidden = page === "memos" && openMemoID !== undefined;
  focusCard.update(state);
  paintSelection();
  eventSheet?.refresh();
  // Measured in the next frame, when the page is laid out anyway (measuring now would force a second layout).
  if (!fadePending) { fadePending = true; requestAnimationFrame(() => { fadePending = false; fadeEdges(); }); }
  // `npm run perf` reads when the first list was drawn.
  if (!performance.getEntriesByName("paper:first-render").length) performance.mark("paper:first-render");
}

let fadePending = false;
/** Soft fades at the top and bottom of the scrolling sheet while there is more beyond. */
function fadeEdges(): void {
  sheet.classList.toggle("fade-top", sheet.scrollTop > 2);
  sheet.classList.toggle("fade-bottom", sheet.scrollTop + sheet.clientHeight < sheet.scrollHeight - 2);
}
sheet.addEventListener("scroll", fadeEdges, { passive: true });
new ResizeObserver(fadeEdges).observe(sheet);

// ─── First-launch guide ─────────────────────────────────────────────────────

/** Five paper cards the cat walks you through; shown once, and again from ⋯ → 사용 안내. */
const guideCards: { pose: string; title: string; body: string; keys: [string, string][]; login?: boolean }[] = [
  { pose: "happy", title: t("종이냥에 오신 걸 환영해요"), body: t("하루에 한 장, 오늘 할 일만 가볍게 적는\n종이 노트예요. 적고, 체크하고, 끝!"), keys: [[t("입력 줄"), "Ctrl+N"], [t("완료"), t("네모 칸 누르기")], [t("어디서든 빠른 입력"), "Ctrl+Alt+N"]] },
  { pose: "curious", title: t("탭으로 나눠 두어요"), body: t("마감이 있는 일은 ‘앞으로’에서 날짜별로 기다리다\n그날이 되면 오늘로 올라와요.\n날짜 없는 일은 맨 아래 ‘언젠가’, 생각은 ‘메모’에."), keys: [[t("오늘 · 앞으로 · 메모"), "Ctrl+1–3"], [t("내일로 미루기"), "Alt+→"]] },
  { pose: "stretch", title: t("아래 입력 줄에 무엇이든"), body: t("‘내일 3시 회의’, ‘30분 뒤 빨래’, ‘매일 물 마시기’처럼\n적으면 칩으로 알아들은 뜻을 보여 줘요.\n‘3시부터 5시까지 보고서’면 할 일에 시간도 붙어요.\nTab으로 다른 뜻, Enter로 넣기."), keys: [[t("다른 뜻"), "Tab"], [t("되돌리기"), "Ctrl+Z"], [t("검색"), "Ctrl+F"]] },
  { pose: "tea", title: t("종이냥과 집중"), body: t("할 일에서 F를 누르면 바로 집중을 시작해요.\n화면 아래의 종이냥은 저녁이 되면\n남은 일을 내일로 넘길지 물어봐요."), keys: [[t("이거 집중"), "F"], [t("설정"), "Ctrl+,"]] },
  { pose: "cheer", title: t("준비 끝!"), body: t("필요 없을 땐 작은 포스트잇으로 접어 두세요.\n어디서든 Ctrl+Alt+J로 다시 불러요."), keys: [[t("작게 접기"), "Ctrl+M"], [t("노트 보이기 · 숨기기"), "Ctrl+Alt+J"]], login: true },
];
let guide: { close(): void } | undefined;

function openGuide(): void {
  guide?.close();
  editor?.close();
  eventSheet?.close();
  let step = 0;
  const art = h("img", { class: "guide-art", alt: "", draggable: "false" });
  const heading = h("div", { class: "guide-title", role: "heading", "aria-level": "2" });
  const text = h("div", { class: "guide-body" });
  const keys = h("div", { class: "guide-keys" });
  // The last card: 컴퓨터를 켤 때 같이 열기 (on the first time through; afterwards as it is set).
  let loginChoice: boolean | undefined;
  const loginSwitch = h("button", { class: "switch small", role: "switch", "aria-label": t("컴퓨터를 켤 때 같이 열기") });
  const loginRow = h("div", { class: "guide-login" }, h("span", {}, t("컴퓨터를 켤 때 같이 열기")), loginSwitch);
  loginSwitch.addEventListener("click", () => { loginChoice = !loginChoice; loginSwitch.setAttribute("aria-checked", String(loginChoice)); });
  const dots = h("div", { class: "guide-dots", role: "img" });
  const skip = h("button", { class: "guide-skip" }, t("건너뛰기"));
  const back = h("button", { class: "action" }, t("이전"));
  const next = h("button", { class: "action primary next" });
  const card = h("div", { class: "guide-card", role: "dialog", "aria-modal": "true", "aria-label": t("사용 안내") },
    art, heading, text, keys, loginRow, dots, h("div", { class: "guide-actions" }, skip, h("span", { class: "spacer" }), back, next));
  const root = h("div", { class: "guide" }, h("div", { class: "guide-scrim" }), card);
  const show = () => {
    const current = guideCards[step];
    const last = step === guideCards.length - 1;
    art.src = `../../assets/pet/256/${current.pose}.png`;
    heading.textContent = current.title;
    text.textContent = current.body;
    keys.replaceChildren(...current.keys.map(([label, key]) => h("div", { class: "guide-key" }, h("span", {}, label), h("kbd", {}, key))));
    loginRow.hidden = !current.login;
    if (current.login && loginChoice === undefined) loginChoice = state.prefs.guideSeen ? state.prefs.openAtLogin : true;
    loginSwitch.setAttribute("aria-checked", String(Boolean(loginChoice)));
    dots.replaceChildren(...guideCards.map((_, index) => h("span", { class: index === step ? "on" : "" })));
    dots.setAttribute("aria-label", t("{total}장 중 {n}장", { total: guideCards.length, n: step + 1 }));
    skip.hidden = last;
    back.hidden = step === 0;
    next.textContent = last ? t("시작하기") : t("다음");
    card.classList.remove("turn");
    void card.offsetWidth; // restart the little page-turn animation
    card.classList.add("turn");
    next.focus();
  };
  const go = (delta: number) => { step = Math.min(Math.max(step + delta, 0), guideCards.length - 1); show(); };
  const close = () => {
    root.remove();
    window.removeEventListener("keydown", onKey, true);
    guide = undefined;
    // The last card was reached: its switch is the answer.
    if (loginChoice !== undefined && loginChoice !== state.prefs.openAtLogin) void api.act({ type: "setPref", key: "openAtLogin", value: loginChoice });
    if (!state.prefs.guideSeen) void api.act({ type: "setPref", key: "guideSeen", value: true });
  };
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
    else if (event.key === "ArrowRight" || event.key === "Enter") step === guideCards.length - 1 ? close() : go(1);
    else if (event.key === "ArrowLeft") go(-1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  skip.addEventListener("click", close);
  back.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => (step === guideCards.length - 1 ? close() : go(1)));
  window.addEventListener("keydown", onKey, true);
  document.body.append(root);
  show();
  guide = { close };
}

// ─── 검색 ─────────────────────────────────────────────────────────────────────

let searchSlip: SearchSlip | undefined;

/** Ctrl+F (and ⋯ → 검색…, the desk's 검색): the search slip over the note; a result opens where it lives. */
function showSearch(query = ""): SearchSlip | undefined {
  if (focusCard.visible) return undefined;
  if (searchSlip) { searchSlip.element.querySelector<HTMLInputElement>(".search-field")?.focus(); return searchSlip; }
  guide?.close();
  editor?.close();
  eventSheet?.close();
  toast.hide();
  commitEditing();
  searchSlip = openSearch({
    closed: () => { searchSlip = undefined; },
    open: (row) => {
      if (row.kind === "today" || row.kind === "ahead") showTask(row.id, true);
      else if (row.kind === "memos") { setPage("memos"); openMemoID = row.id; render(); }
      else if (row.kind === "history") void api.act({ type: "openHistory", day: row.day });
      else if (row.kind === "events" && row.key) void api.act({ type: "calendarEditEvent", key: row.key });
    },
  }, query);
  return searchSlip;
}
// Snapshots type into it.
(window as { showSearch?: typeof showSearch }).showSearch = showSearch;

// ─── Keyboard ─────────────────────────────────────────────────────────────────

let selectedID: string | undefined;

/** The rows of the open page, top to bottom, as the keyboard walks them. */
function selectable(): string[] {
  if (!state) return [];
  if (page === "today") { const { next, rest } = todayGroups(); return [...next, ...rest].map((item) => item.id); }
  if (page === "ahead") return [...aheadList.querySelectorAll<HTMLElement>(".row")].map((element) => element.dataset.id!).filter((id) => aheadRows.has(id));
  return [];
}


function select(id: string | undefined, scroll = true): void {
  selectedID = id;
  // A row's button keeps focus after a click; Space and Enter now belong to the selection.
  if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
  paintSelection();
  if (id && scroll) rowFor(id)?.element.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
}

/** Soft sage tint and a bar on the margin line for the selected row; a row that left the page drops it. */
function paintSelection(): void {
  const rows = page === "today" ? todayRows : page === "ahead" ? aheadRows : undefined;
  if (selectedID && !rows?.has(selectedID)) selectedID = undefined;
  for (const map of [todayRows, aheadRows]) for (const [id, row] of map) row.element.classList.toggle("selected", map === rows && id === selectedID);
}

/** ↑ in the empty line under 오늘, or ↓ in the empty line above a shelf, steps into the rows. */
function enterList(event: KeyboardEvent, direction: 1 | -1): void {
  const id = fromInput(selectable(), direction, "end");
  if (!id) return;
  event.preventDefault();
  (event.target as HTMLElement).blur();
  select(id);
}

function focusInput(): void {
  line.focus();
}

/** ↑↓ · Space · Enter · Delete · Esc · Ctrl+↑↓ on the task pages; never while typing or with a card open. */
function listKey(event: KeyboardEvent): boolean {
  if (!state || page === "memos" || guide || editor || eventSheet || searchSlip || event.isComposing) return false;
  if (event.altKey) return dateKey(event);
  if (event.key === "Escape" && toast.visible) return false;
  const target = event.target as HTMLElement;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return false;
  const command = event.ctrlKey || event.metaKey;
  const ids = selectable();
  const handled = () => { event.preventDefault(); return true; };
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const direction = event.key === "ArrowDown" ? 1 : -1;
    if (command) {
      if (!selectedID) return false;
      // 앞으로: within its day (or 언젠가); 오늘: within the lower group.
      const rest = page === "ahead" ? zoneSiblings(selectedID) : page === "today" ? todayGroups().rest.map((item) => item.id) : [];
      const target = rest.includes(selectedID) ? reorder(rest, selectedID, direction) : undefined;
      if (target) void api.act({ type: "move", id: selectedID, targetID: target.targetID, after: target.after });
      return handled();
    }
    if (event.shiftKey) return false;
    const next = step(ids, selectedID, direction, "end");
    if (next && "input" in next) { select(undefined); focusInput(); } else if (next) select(next.id);
    return handled();
  }
  if (command || event.shiftKey || !selectedID || target instanceof HTMLButtonElement && (event.key === " " || event.key === "Enter")) return false;
  const id = selectedID;
  const item = state.items.find((entry) => entry.id === id);
  if (event.key === " ") {
    if (item && !item.isCompleted && state.prefs.hideCompleted) holdWhileFinishing(id);
    void api.act({ type: "toggle", id });
    return handled();
  }
  if (event.key === "Enter") { rowFor(id)?.beginEdit(); return handled(); }
  if (event.key === "Backspace" || event.key === "Delete") {
    select(afterRemoval(ids, id));
    deleteTask(id);
    return handled();
  }
  // F: 집중 on the selected task.
  if (event.key.toLowerCase() === "f" && item && !item.isCompleted) { startFocus(id); return handled(); }
  if (event.key === "Escape") { select(undefined); return handled(); }
  return false;
}

/**
 * Alt+→ / Alt+← on a selected task: its due date a day later or earlier (on 오늘, → is tomorrow);
 * Alt+↓: 언젠가. The toast says where it went (되돌리기 = Ctrl+Z).
 */
function dateKey(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement;
  if (!selectedID || event.ctrlKey || event.metaKey || event.shiftKey || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return false;
  const item = state.items.find((entry) => entry.id === selectedID);
  if (!item || item.isCompleted) return false;
  if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
    event.preventDefault();
    const day = shiftedDue(item, event.key === "ArrowRight" ? 1 : -1, new Date());
    if (day) moveToDay(item.id, day);
    return true;
  }
  if (event.key === "ArrowDown") {
    event.preventDefault();
    if (item.shelf === "later" && !item.dueDate) return true;
    void api.act({ type: "moveTasks", ids: [item.id], target: { kind: "someday" } });
    movedToast({ kind: "someday" });
    return true;
  }
  return false;
}

// Typing in a field (other than a row's own title) leaves the selection.
document.addEventListener("focusin", (event) => {
  const target = event.target as HTMLElement;
  if (selectedID && (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && !target.classList.contains("edit")) select(undefined, false);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "F1") { event.preventDefault(); void api.act({ type: "openHelp" }); return; }
  // 집중: the card takes Esc (it asks first); the note's other keys wait until it ends.
  if (focusCard.visible) {
    // Space ⏸/▶, Ctrl+Enter 다 했어요, Ctrl+= 5분 더.
    if (focusCard.key(event)) return;
    // (A toast on the card takes Esc first: it goes, then the next Esc asks.)
    if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); focusCard.escape(); }
    // Ctrl+Z right after "보고서 25분 집중": the toast's 멈추기.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z" && toast.visible) { event.preventDefault(); void undoLast(flow); }
    return;
  }
  if (picking && event.key === "Escape") { event.preventDefault(); setPicking(false); return; }
  if (picking && event.key === "Enter" && selectedID && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); pickTask(selectedID); return; }
  if (listKey(event)) return;
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  const act = (handled: () => unknown) => { event.preventDefault(); handled(); };
  if (key === "f" && !event.shiftKey && !event.altKey) return act(() => showSearch());
  if (key === "1") return act(() => setPage("today"));
  if (key === "2") return act(() => setPage("ahead"));
  if (key === "3") return act(() => setPage("memos"));
  if (key === "n" && event.shiftKey) return act(() => void newMemo());
  if (key === "n") return act(focusNew);
  if (key === "m") return act(() => api.act({ type: "collapse" }));
  if (key === ",") return act(() => api.act({ type: "openSettings" }));
  if (key === "h") return act(() => api.act({ type: "openHistory" }));
  if (key === "d" && !event.shiftKey) return act(() => api.act({ type: "openCalendar" }));
  if (key === "e") return act(() => api.act({ type: "exportList" }));
  if (key === "c" && event.shiftKey) return act(() => api.act({ type: "copyList" }));
  if (key === "=" || key === "+" || key === "-") {
    const index = textSizes.indexOf(state.prefs.textSize) + (key === "-" ? -1 : 1);
    if (index >= 0 && index < textSizes.length) act(() => api.act({ type: "setPref", key: "textSize", value: textSizes[index] }));
    return;
  }
  if (typing) return; // text fields keep their own undo
  if (key === "z" && !event.shiftKey) return act(() => { if (!strip.undoMove()) void api.act({ type: "undo" }); });
  if (key === "y" || (key === "z" && event.shiftKey)) return act(() => api.act({ type: "redo" }));
});

// ─── Wiring ───────────────────────────────────────────────────────────────────

api.on("state", (next) => { state = next as AppState; render(); });
api.on("note:focus-new", focusNew);
api.on("note:event-sheet", (payload) => {
  if (state) showEventSheet(payload as CalendarSheetRequest);
  else void api.getState().then((initial) => { state = initial; render(); showEventSheet(payload as CalendarSheetRequest); });
});
api.on("note:commit-editing", () => {
  commitEditing();
  // A line still being typed is put in as read (no toast: the note is going away).
  if (line.value.trim()) void line.submit();
  if (openMemoID) closeMemo();
});
// 빠른 입력 while the note is up: its toast (with the switch) shows here.
api.on("note:toast", (payload) => {
  const { made, candidates, index, text } = payload as IntentToast;
  const readings = candidates.map(fromWire);
  if (readings[index]) showMade(flow, made, readings[index], readings, text);
});
api.on("note:row-command", (payload) => {
  const { id, command } = payload as { id: string; command: string };
  if (command === "edit") rowFor(id)?.beginEdit();
  if (command === "reminder") openEditor(id);
  if (command === "repeat") openEditor(id, "repeat");
  if (command === "deadline") openEditor(id, "deadline");
  if (command === "time") openEditor(id, "time");
  if (command === "close-editor") { editor?.close(); eventSheet?.close(); }
  // 마감 · 나중에 (older menus, snapshots) are 앞으로.
  if (command === "page-ahead" || command === "page-deadlines" || command === "page-shelf" || command === "page-later") setPage("ahead");
  if (command === "page-memos") setPage("memos");
  if (command === "page-today") setPage("today");
  if (command === "guide") openGuide();
  if (command === "select-task") showTask(id);
  if (command === "pick-focus") { if (!focusCard.visible) setPicking(true); }
  if (command === "pick-cancel") setPicking(false);
  if (command === "morning-pick") { askingPick = true; setPage("today"); line.refresh(); }
  if (command === "morning-pick-off") { askingPick = false; line.refresh(); }
  if (command === "search") showSearch();
});
api.on("focus:chime", () => { if (state?.prefs.timerSound) chime(); });
// Something done from a menu, the reminder bubble or the cat: its toast here, with 되돌리기.
api.on("note:notice", (payload) => {
  const notice = payload as NoteNotice;
  const undo = notice.undo === "history" ? () => api.act({ type: "undo" }) : notice.undo === "memo" ? () => api.act({ type: "memoRestore" }) : notice.undo === "unfile" ? () => api.act({ type: "unfileCompleted" }) : undefined;
  toast.show({ icon: notice.icon, text: notice.text, ...(undo ? { action: { label: t("되돌리기"), run: () => void undo() } } : {}) });
});

/** A task chosen in the 달력 window (or a ring on the ribbon): its page, with the row selected (and flashed). */
function showTask(id: string, flash = false): void {
  const item = state?.items.find((entry) => entry.id === id);
  if (!item) return;
  guide?.close();
  editor?.close();
  eventSheet?.close();
  const where = pageOf(item, new Date());
  setPage(where === "today" ? "today" : "ahead");
  select(id);
  if (flash) {
    const row = rowFor(id)?.element;
    row?.classList.remove("flash");
    void row?.offsetWidth;
    row?.classList.add("flash");
    setTimeout(() => row?.classList.remove("flash"), 1200);
  }
}

void api.getState().then((initial) => {
  state = initial;
  render();
  if (!state.prefs.guideSeen) openGuide();
  line.refresh();
  if (page === "today" && todayItems().length === 0) focusNew();
});
