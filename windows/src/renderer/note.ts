import { shortcutLabel } from "../core/memoDrawer";
import { defaultNoteShortcut } from "../core/shortcuts";
import { logicalDayStart } from "../core/archive";
import { dayFor, deadlineChoiceTitles, key as dueKey, fromKey, label as dueLabel, sentence as dueSentence, urgency, type DeadlineChoice } from "../core/deadline";
import { clock, dayWord, longDate, minutesAway, weekdayShort } from "../core/lang";
import type { TodoItem } from "../core/notebook";
import { describe } from "../core/repeat";
import { afterRemoval, fromInput, reorder, step } from "../core/keyboard";
import { dropTabs, pageOf, tabAt, tabDrop, type NoteTab } from "../core/shelf";
import { aheadCount, aheadEyebrow, aheadLens, aheadSectionTitle, aheadSections, aheadSummary, aheadWeek, movedText, type AheadSection, type AheadTarget } from "../core/ahead";
import { compactTime, rowLabel, scheduledTime } from "../core/timeText";
import { bodyFontSize, type TodosState, type IntentPage, type IntentToast, type NoteNotice } from "../core/types";
import { noteScales } from "../core/textSteps";
import { expand } from "../core/events";
import { dayRibbon, todayGroups as splitToday } from "../core/ribbon";
import { DayStripView } from "./dayStrip";
import { markWord } from "../core/dayStrip";
import { h, holdMs, icon, lang, motion, paper, reduceMotion, scrollFade, t } from "./api";
import { paperCalendar } from "./calendar";
import { openEventSheet, type EventSheet } from "./eventSheet";
import type { CalendarSheetRequest } from "../core/calendar";
import { repeatFields } from "./repeatFields";
import { InputLine } from "./inputLine";
import { commitReading, fromWire, showMade, undoLast, type FlowHost } from "./intentFlow";
import { keyCap, toaster } from "./slip";
import { FocusCard } from "./focusCard";
import { focusNextLine } from "../core/focus";
import { chime } from "./chime";
import { openSearch, type SearchSlip } from "./search";
import { searchHint } from "../core/search";
import { carriedDays, carriedText, movedTomorrowText, shiftedDue, tomorrowKey } from "../core/carry";
import { dayKey } from "../core/archive";
import { clockKey, logicalMinutes, rangeDay, rangeOf, rangeText, rangeTimes, rangeWhenText, reminderFor, validRange } from "../core/timeRange";
import { durationText } from "../core/duration";
import { timeList, timeOf } from "./timePick";
import { activeLens, findSpace, generalName, groupedCount, inLens, lensTasks, lensNone, liveSpaces, spaceColor, spaceIndexOf, type TodoSpace } from "../core/todoSpaces";
import {
  deviceHint, deviceKey, deviceLens, deviceLensForDigit, deviceLine, deviceNone, devicePeeking, deviceWords, hiddenSpaces, hideAgainWord, lineKeys,
  peekWord, readDeviceRules, storedDeviceRules, type DeviceRule,
} from "../core/spaceDevice";
import { closeMenus, menuOpen, openMenu, type MenuEntry, type MenuHost } from "./drawerMenu";
import { badgeWords, extendSelection, oneSelected, rangeSelection, toggleSelection, type ListSelection } from "../core/selection";
import { addToWords, boardFits, doneWords, dropHereWords, groupItems, groupOpen, groupSpace, leftWords, neighborGroup, nextWords, spaceGroups, type SpaceGroup } from "../core/spaceGroups";
import { snoozeTitle } from "../core/snooze";

/** 오늘 · 앞으로 (1.28: the memo tab became the 메모 서랍). */
type Page = Exclude<NoteTab, "memos">;
const pages: Page[] = ["today", "ahead"];

const api = paper();
let state: TodosState;
/** 2b (I): a column's `+ 회사에 넣기` — the line writes into that group (`none`: 일반) until it's written or left empty. */
let lineSpace: string | undefined;
const finishing = new Set<string>();
const todayRows = new Map<string, Row>();
const aheadRows = new Map<string, Row>();
let editingID: string | undefined;
const savedPage = localStorage.getItem("page");
// The 마감 and 나중에 pages (and the older 마감 "shelf") are 앞으로 now.
let page: Page = savedPage === "shelf" || savedPage === "deadlines" || savedPage === "later" ? "ahead" : pages.includes(savedPage as Page) ? savedPage as Page : "today";

const pageTitle: Record<Page, string> = { today: t("오늘 할 일"), ahead: t("앞으로") };
const tabLabel: Record<Page, string> = { today: t("오늘"), ahead: t("앞으로") };

/** 메모 서랍: opened (on a memo, or at its quick-write slip). */
const openDrawer = (extra: { memo?: string; write?: boolean } = {}) => void api.act({ type: "drawer", command: "open", ...extra });

// ─── Frame: washi index tabs and the tools, then the header (#151: the cat's ears stand on the window, ears.ts) ─

const pinButton = h("button", { class: "quiet pin", title: t("항상 위에 두기"), "aria-label": t("항상 위에 두기") }, icon("pin", 16));
const tabs = h("div", { class: "index-tabs", role: "tablist" });
// 메모 서랍 (1.28): where the memos live now, a button beside the pin (its shortcut in the tooltip).
const drawerButton = h("button", { class: "quiet drawer-open", "aria-label": t("메모 서랍") }, icon("pawPrint", 16));
drawerButton.addEventListener("click", () => openDrawer());
const tools = h("div", { class: "tools" },
  pinButton,
  drawerButton,
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
// The progress sits beside the title when there's room, else under it (as on the Mac).
// 할 일 스페이스 (1.30): 모든 스페이스 ▾ at the end of the date line, over the title (hidden until there is a space), so
// the header keeps its height and the title its room.
const spaceButton = h("button", { class: "space-pick", "aria-haspopup": "menu", "aria-expanded": "false", hidden: "" },
  h("span", { class: "space-dot" }), h("span", { class: "space-pick-label" }), icon("chevron", 11, 2));
spaceButton.addEventListener("click", () => openSpacePicker());
const titleRow = h("div", { class: "title-row" }, h("div", { class: "title-text" }, h("div", { class: "date-row" }, dateLine, spaceButton), h("div", { class: "title-line" }, title, progress)));

/** 2b (H): the shortcut chips under the title while grouped — `● 회사 2 · ● 집 2 · 일반 1` (open to-dos); one line that scrolls sideways. */
const chipsRow = h("div", { class: "schips", role: "toolbar", "aria-label": t("스페이스 바로 가기"), hidden: "" });
chipsRow.addEventListener("wheel", (event) => { if (event.deltaY && !event.deltaX) { chipsRow.scrollLeft += event.deltaY; event.preventDefault(); } }, { passive: false });
const sheet = h("div", { class: "sheet" });
/** The paper menus (the row menu, 모든 스페이스 ▾, the editor's 스페이스): drawn over everything, inside the note. */
const menuLayer = h("div", { class: "menu-layer" });
const menuHost: MenuHost = { container: menuLayer };
const toastHost = h("div", { class: "toast-host" });
const dock = h("div", { class: "dock" }, toastHost);
const footer = h("div", { class: "footer" });
document.getElementById("app")!.append(tabsRow, titleRow, chipsRow, sheet, dock, footer);
document.body.append(menuLayer);

// ─── 집중 ─────────────────────────────────────────────────────────────────────

/** The focus card: while a session is on, the note is this one card (see focusCard.ts). */
const focusCard = new FocusCard({
  // #196: the card's picks leave out what this PC hides, peeked at or not.
  todayItems: () => (state ? todayItems().filter((item) => !hidesHere(item)) : []),
  spaceOf: (id) => (state ? spacesOf().get(id) : undefined),
  next: () => {
    if (!state) return undefined;
    const next = dayRibbon(todayOccurrences(), noteItems(), new Date(), lang())?.next;
    return next ? focusNextLine(next.title, next.time, next.minutes, lang()) : undefined;
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
    // 2a (A2): every to-do ahead, as 오늘's count is (the lens hides some from the page, not from the count).
    ahead: aheadLensed(now).all,
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
    liveAfterFirstDraw(donut);
    progressText.textContent = t("{completed} / {total} 끝냈어요", { completed: done, total: today.length });
    progress.setAttribute("role", "img");
    progress.setAttribute("aria-label", t("{total}개 중 {completed}개 끝냈어요, {remaining}개 남았어요", { total: today.length, completed: done, remaining: today.length - done }));
  }
  renderSpaceButton();
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
  // 2b (I): the board comes and goes at 720 px.
  const boardChanged = page === "today" && groupsOn() && boardFits(sheet.clientWidth, todaySpaceGroups().length) !== lines.classList.contains("board");
  if (page === "today" && (strip.element.isConnected || boardChanged) && !resizePending) {
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
function onTheMinute(): void {
  setTimeout(() => {
    if (state) drawWhenSeen();
    onTheMinute();
  }, 60_000 - (Date.now() % 60_000) + 40);
}
onTheMinute();

// #65: a hidden note (in the tray, folded to the post-it, minimized) keeps the latest state and draws once when it
// shows again — with 2,000 to-dos a draw is tens of ms, and every change in any window sends a state.
let unseen = false;
/** The catch-up draw: rows finished meanwhile show as done, without playing the check. */
let quietDraw = false;
function drawWhenSeen(): void {
  if (document.hidden) unseen = true; else render();
}
/** Draws what came while hidden (when it shows, or before a command that needs the rows as they are now). */
function catchUp(): void {
  if (!unseen || !state) return;
  quietDraw = true;
  try { render(); } finally { quietDraw = false; }
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) catchUp(); });

// ─── Which tasks go where ───────────────────────────────────────────────────

/** 오늘's to-dos, worked out once per state and minute (a draw asks four or five times); #196: without what the note hides. */
let todayKept: { state: TodosState; minute: number; list: TodoItem[] } | undefined;
const todayItems = (): TodoItem[] => {
  const now = new Date();
  const minute = Math.floor(now.getTime() / 60_000);
  if (todayKept?.state === state && todayKept.minute === minute) return todayKept.list;
  todayKept = { state, minute, list: noteItems(now).filter((item) => pageOf(item, now) === "today") };
  return todayKept.list;
};

// ─── 기기마다 보일 스페이스 (#196, docs/plans/spaces-device.md) ──────────────────

/** What this PC hides now, and what the note hides (less 잠깐 보기), once per state and minute. */
let deviceKept: { state: TodosState; minute: number; hidden: Set<string>; onNote: Set<string>; items: TodoItem[] } | undefined;
function deviceNow(now = new Date()): { hidden: Set<string>; onNote: Set<string>; items: TodoItem[] } {
  const minute = Math.floor(now.getTime() / 60_000);
  if (deviceKept?.state === state && deviceKept.minute === minute) return deviceKept;
  const hidden = hiddenSpaces(readDeviceRules(state.prefs.spaceDevice), state.todoSpaces, now);
  const peek = new Set(state.devicePeek ?? []);
  const onNote = new Set([...hidden].filter((key) => !peek.has(key)));
  const items = onNote.size === 0 ? state.items : state.items.filter((item) => !onNote.has(keyOf(item.id)));
  deviceKept = { state, minute, hidden, onNote, items };
  return deviceKept;
}
/** A to-do's key for 이 기기에서: its live space's id, or `none`. */
const keyOf = (id: string): string => deviceKey(spacesOf().get(id)?.id);
/** Every to-do the note shows (its tabs, counts, groups, day strip and timetable). */
const noteItems = (now = new Date()): TodoItem[] => deviceNow(now).items;
/** Whether this PC hides a to-do, peeked at or not (the focus card's picks). */
const hidesHere = (item: TodoItem): boolean => { const { hidden } = deviceNow(); return hidden.size > 0 && hidden.has(keyOf(item.id)); };
/** 이 기기에서 for a space (`none`: 일반), set from the menu (the main process keeps it cleaned, D10). */
function setDevice(key: string, rule: DeviceRule | undefined): void {
  const rules = readDeviceRules(state.prefs.spaceDevice);
  if (rule) rules[key] = rule;
  else delete rules[key];
  void api.act({ type: "setPref", key: "spaceDevice", value: storedDeviceRules(rules) });
}
/** The names the end line says (일반 by its name). */
const deviceNames = (keys: string[]): string[] => keys.map((key) => (key === deviceNone ? generalNow() : findSpace(state.todoSpaces, key)?.name ?? generalNow()));

/**
 * D9 · D6: at the end of a list, ‘회사는 이 기기에서 숨겨 뒀어요 · 잠깐 보기’ and ‘회사를 잠깐 보는 중 · 다시 숨기기’ — the lens
 * line's look. Only while no lens is on (with one, its own line is the only one). `open`: that tab's to-dos, hidden ones too.
 */
const deviceHiddenText = h("span", { class: "lens-more-text" });
const devicePeekButton = h("button", { class: "lens-all" });
const deviceHiddenLine = h("div", { class: "lens-more device-more" }, h("span", { class: "device-more-icon", "aria-hidden": "true" }, icon("eyeOff", 12)), deviceHiddenText,
  h("span", { class: "lens-more-dot", "aria-hidden": "true" }, "·"), devicePeekButton);
const devicePeekingText = h("span", { class: "lens-more-text" });
const deviceHideButton = h("button", { class: "lens-all" });
const devicePeekingLine = h("div", { class: "lens-more device-more" }, h("span", { class: "device-more-icon", "aria-hidden": "true" }, icon("eye", 12)), devicePeekingText,
  h("span", { class: "lens-more-dot", "aria-hidden": "true" }, "·"), deviceHideButton);
let deviceLineKeys: string[] = [];
devicePeekButton.addEventListener("click", () => void api.act({ type: "spacePeek", spaces: [...new Set([...(state.devicePeek ?? []), ...deviceLineKeys])] }));
deviceHideButton.addEventListener("click", () => void api.act({ type: "spacePeek", spaces: [] }));
function deviceLines(open: readonly TodoItem[]): HTMLElement[] {
  const { hidden, onNote } = deviceNow();
  if (hidden.size === 0 || lensNow() !== undefined) return [];
  const keys = open.filter((item) => !item.isCompleted).map((item) => keyOf(item.id));
  const shown = lineKeys(keys, onNote, state.todoSpaces);
  const peeking = lineKeys(keys, new Set((state.devicePeek ?? []).filter((key) => hidden.has(key))), state.todoSpaces);
  const language = lang();
  deviceLineKeys = shown;
  const out: HTMLElement[] = [];
  if (shown.length) {
    deviceHiddenText.textContent = deviceLine(deviceNames(shown), language);
    devicePeekButton.textContent = peekWord(language);
    out.push(deviceHiddenLine);
  }
  if (peeking.length) {
    devicePeekingText.textContent = devicePeeking(deviceNames(peeking), language);
    deviceHideButton.textContent = hideAgainWord(language);
    out.push(devicePeekingLine);
  }
  return out;
}
/** 오늘's to-dos, hidden ones too (the end line names what this PC hides there). */
const todayAll = (): TodoItem[] => { const now = new Date(); return state.items.filter((item) => pageOf(item, now) === "today"); };
/** Each to-do by id, and the ids put in the calendar, once per state (rows look them up). */
let lookupKept: { state: TodosState; items: Map<string, TodoItem>; withEvents: Set<string> } | undefined;
function lookup(): { items: Map<string, TodoItem>; withEvents: Set<string> } {
  if (lookupKept?.state !== state) lookupKept = { state, items: new Map(state.items.map((item) => [item.id, item])), withEvents: new Set(state.calendar?.withEvents ?? []) };
  return lookupKept;
}

function visibleToday(): TodoItem[] {
  const lens = lensNow();
  const spaces = spacesOf();
  return todayItems().filter((item) => (!state.prefs.hideCompleted || !item.isCompleted || finishing.has(item.id)) && inLens(lens, spaces.get(item.id)?.id));
}

// ─── 할 일 스페이스 (1.30) ────────────────────────────────────────────────────

/** Each to-do's live space, worked out once per state (2,000 rows look it up on every draw). */
let spacesKept: { state: TodosState; data: string; spaces: string; index: Map<string, TodoSpace> } | undefined;
/** Counts each new reading of the spaces (a row with a space draws again when its name or colour may have changed). */
let spacesVersion = 0;
function spacesOf(): Map<string, TodoSpace> {
  if (spacesKept?.state === state) return spacesKept.index;
  // Read again only when a to-do moved or a space changed (the same text arrives with every other state).
  const spaces = JSON.stringify(state.todoSpaces.spaces);
  if (spacesKept?.data !== state.spaceOf || spacesKept.spaces !== spaces) {
    spacesKept = { state, data: state.spaceOf, spaces, index: spaceIndexOf(state.todoSpaces.spaces, state.spaceOf) };
    spacesVersion += 1;
  }
  else spacesKept.state = state;
  return spacesKept.index;
}
const hasSpaces = () => liveSpaces(state.todoSpaces).length > 0;
/** The space 오늘 shows alone, or none — the 4 a.m. day and a deleted space let it go (S11, S12). */
const lensNow = (now = new Date()) => deviceLens(activeLens(state.prefs.spaceLens ?? undefined, state.todoSpaces, now), deviceNow(now).onNote);
const bandStyle = (space: TodoSpace | undefined) => (space ? `var(--band-${spaceColor(space.color)})` : "");
const setLens = (space: string | undefined) => {
  if (space && page !== "today") setPage("today");
  void api.act({ type: "spaceLens", ...(space ? { space } : {}) });
};
/** "Ctrl+Shift+1" for the nth space (W8). */
const lensKey = (index: number) => (index < 9 ? `Ctrl+Shift+${index + 1}` : undefined);

/** 일반 — the to-dos in no space — as it's called now: renamed, or 일반 · General · Algemeen (#89). */
const generalNow = () => generalName(state.todoSpaces, lang());
/** While one space shows: the open to-dos on 오늘 it hides (#87: the line at the end of the list, the button's label). */
const hiddenOpen = (lens: string | undefined): number => {
  if (lens === undefined) return 0;
  const spaces = spacesOf();
  return todayItems().filter((item) => !item.isCompleted && !inLens(lens, spaces.get(item.id)?.id)).length;
};

let spaceButtonDrawn = "";
function renderSpaceButton(): void {
  const show = page === "today" && hasSpaces();
  spaceButton.hidden = !show;
  if (!show) return;
  const lens = lensNow();
  const space = lens && lens !== lensNone ? findSpace(state.todoSpaces, lens) : undefined;
  const colors = liveSpaces(state.todoSpaces).slice(0, 3).map((entry) => bandStyle(entry));
  const name = space ? space.name : lens === lensNone ? generalNow() : undefined;
  const hidden = hiddenOpen(lens);
  // Drawn again only when what it shows changed (a redraw of 2,000 rows touches nothing here).
  const drawnKey = `${lens ?? ""}|${name ?? ""}|${space?.color ?? ""}|${colors.join()}|${hidden}`;
  if (drawnKey === spaceButtonDrawn) return;
  spaceButtonDrawn = drawnKey;
  const label = name !== undefined ? t("{name}만", { name }) : t("모든 스페이스");
  spaceButton.querySelector(".space-pick-label")!.textContent = label;
  spaceButton.classList.toggle("on", lens !== undefined);
  spaceButton.style.setProperty("--band", space ? bandStyle(space) : "var(--ink-3)");
  const dot = spaceButton.querySelector<HTMLElement>(".space-dot")!;
  dot.classList.toggle("all", !space);
  dot.style.setProperty("--band", space ? bandStyle(space) : "var(--faint)");
  if (!space && lens !== lensNone) dot.style.setProperty("background", colors.length > 1 ? `conic-gradient(${colors.map((color, index) => `${color} ${(index * 100) / colors.length}% ${((index + 1) * 100) / colors.length}%`).join(", ")})` : colors[0] ?? "");
  else dot.style.removeProperty("background");
  // #87: a screen reader hears what the list hides too — "회사만 보는 중, 다른 스페이스에 4개 더".
  const spoken = name === undefined ? label
    : hidden ? t("{name}만 보는 중, 다른 스페이스에 {n}개 더", { name, n: groupedCount(hidden, lang()) }) : t("{name}만 보는 중", { name });
  spaceButton.setAttribute("aria-label", t("스페이스: {name}", { name: spoken }));
  spaceButton.title = t("한 스페이스만 보기 (Ctrl+Shift+1–9, 모두 보기 Ctrl+Shift+0)");
}

/** 모든 스페이스 ▾: 모든 스페이스 (N), the spaces with their open to-dos and keys, 일반 (N), 스페이스 관리…. */
function openSpacePicker(keyboard = false): void {
  if (menuOpen() && spaceButton.getAttribute("aria-expanded") === "true") { closeMenus(); return; }
  const lens = lensNow();
  const spaces = spacesOf();
  const open = todayItems().filter((item) => !item.isCompleted);
  const count = (space: string | undefined) => String(open.filter((item) => spaces.get(item.id)?.id === space).length);
  const dot = (band: string) => { const element = h("span", { class: "dot" }); element.style.setProperty("--band", band); return element; };
  const all = h("span", { class: "dot all" });
  const colors = liveSpaces(state.todoSpaces).slice(0, 3).map((entry) => bandStyle(entry));
  all.style.background = colors.length > 1 ? `conic-gradient(${colors.map((color, index) => `${color} ${(index * 100) / colors.length}% ${((index + 1) * 100) / colors.length}%`).join(", ")})` : colors[0] ?? "";
  // #196: what this PC hides (not peeked at) gathers under 이 기기에서 숨김 with 보이기; a time-ruled space has its hint; the
  // digits keep the spaces' order.
  const { hidden: hiddenHere, onNote } = deviceNow();
  const rules = readDeviceRules(state.prefs.spaceDevice);
  const language = lang();
  const hint = (key: string): MenuEntry[] => {
    const rule = rules[key];
    // A quiet line in the UI face under the row (the menu's labels are handwriting, for section names).
    return rule?.show === "time" ? [{ kind: "node", node: h("div", { class: "menu-hint", role: "note" }, deviceHint(rule.times, hiddenHere.has(key), language)) }] : [];
  };
  const hiddenRows: MenuEntry[] = [];
  const hideRows: MenuEntry[] = [];
  const shownRows: MenuEntry[] = [];
  liveSpaces(state.todoSpaces).forEach((space, index) => {
    if (onNote.has(space.id)) {
      hiddenRows.push({ kind: "item", label: space.name, extra: [dot(bandStyle(space))], count: deviceWords.show[language], run: () => setDevice(space.id, undefined) }, ...hint(space.id));
      return;
    }
    // #202: the digit keys stay with the spaces' order (a hidden space keeps its number, unused).
    shownRows.push({ kind: "item", label: space.name, extra: [dot(bandStyle(space))], count: count(space.id), key: lensKey(index), ...(index < 9 ? { digit: String(index + 1) } : {}), checked: lens === space.id, run: () => setLens(space.id) }, ...hint(space.id));
    hideRows.push({ kind: "item", label: space.name, extra: [dot(bandStyle(space))], run: () => setDevice(space.id, { show: "hide" }) });
  });
  if (onNote.has(deviceNone)) {
    hiddenRows.push({ kind: "item", label: generalNow(), extra: [dot("var(--rule-strong)")], count: deviceWords.show[language], run: () => setDevice(deviceNone, undefined) }, ...hint(deviceNone));
  } else {
    shownRows.push({ kind: "item", label: generalNow(), extra: [dot("var(--rule-strong)")], count: count(undefined), checked: lens === lensNone, run: () => setLens(lensNone) }, ...hint(deviceNone));
    hideRows.push({ kind: "item", label: generalNow(), extra: [dot("var(--rule-strong)")], run: () => setDevice(deviceNone, { show: "hide" }) });
  }
  const entries: MenuEntry[] = [
    // #185: while it's open a plain 1–9 · 0 picks too (Ctrl+Shift+digits may be Windows' input-language keys).
    { kind: "item", label: t("모든 스페이스"), extra: [all], count: String(open.length), key: "Ctrl+Shift+0", digit: "0", checked: lens === undefined, run: () => setLens(undefined) },
    { kind: "sep" },
    ...shownRows,
    ...(hiddenRows.length ? [{ kind: "sep" } as MenuEntry, { kind: "label", text: deviceWords.hiddenSection[language] } as MenuEntry, ...hiddenRows] : []),
    { kind: "sep" },
    // A submenu, not a button that shows on hover: → reaches it too.
    ...(hideRows.length ? [{ kind: "sub", label: deviceWords.hideHere[language], icon: "eyeOff", entries: () => [
      ...hideRows, { kind: "sep" } as MenuEntry, { kind: "item", label: deviceWords.setTimes[language], icon: "clock", run: () => void api.act({ type: "openSpaces" }) } as MenuEntry,
    ] } as MenuEntry] : []),
    // 2b: 스페이스별로 묶기 (Ctrl+Shift+G), this device's.
    { kind: "item", label: t("스페이스별로 묶기"), key: "Ctrl+Shift+G", checked: state.prefs.spaceGroups, run: toggleSpaceGroups },
    { kind: "item", label: t("스페이스 관리…"), icon: "gear", run: () => void api.act({ type: "openSpaces" }) },
  ];
  spaceButton.setAttribute("aria-expanded", "true");
  openMenu({ ...menuHost, closed: () => spaceButton.setAttribute("aria-expanded", "false") }, entries, t("모든 스페이스"), spaceButton.getBoundingClientRect(), keyboard);
}

/** 스페이스로 옮기기 ▸: the spaces (✓ where it is), 일반, 새 스페이스…. */
function moveEntries(id: string, rows: string[] = [id]): MenuEntry[] {
  // #168: the row's menu moves every picked row when it's one of them (`rows`); the editor's field, its one to-do.
  const current = spacesOf().get(id)?.id;
  const dot = (band: string) => { const element = h("span", { class: "dot" }); element.style.setProperty("--band", band); return element; };
  return [
    ...liveSpaces(state.todoSpaces).map((space): MenuEntry => ({
      kind: "item", label: space.name, extra: [dot(bandStyle(space))], checked: current === space.id, run: () => void api.act({ type: "todoSpace", ids: rows, space: space.id }),
    })),
    { kind: "sep" },
    { kind: "item", label: generalNow(), extra: [dot("var(--rule-strong)")], checked: current === undefined, run: () => { if (rows.some((row) => spacesOf().get(row))) void api.act({ type: "todoSpace", ids: rows, space: null }); } },
    { kind: "item", label: t("새 스페이스…"), icon: "plus", run: () => newSpaceSlip(id) },
  ];
}

/** 새 스페이스…: a small slip that takes a name, makes the space and moves the to-do into it. */
function newSpaceSlip(todo: string): void {
  const row = rowFor(todo)?.element;
  const field = h("input", { type: "text", maxlength: "40", spellcheck: "false", placeholder: t("이름"), "aria-label": t("새 스페이스 이름") });
  const make = h("button", { class: "mi", disabled: "" }, h("span", { class: "ico" }, icon("plus", 15)), h("span", { class: "t" }, t("만들고 옮기기")));
  const slip = h("div", { class: "space-new" }, h("div", { class: "label" }, t("새 스페이스")), field, make);
  const go = () => {
    const name = field.value.trim();
    if (!name) return;
    closeMenus();
    void api.act({ type: "spaceAdd", id: `s-${Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, "0")}`, name, todo });
  };
  field.addEventListener("input", () => { make.disabled = !field.value.trim(); });
  field.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Enter") { event.preventDefault(); go(); }
  });
  make.addEventListener("click", go);
  const at = row?.getBoundingClientRect() ?? titleRow.getBoundingClientRect();
  openMenu(menuHost, [{ kind: "node", node: slip }], t("새 스페이스"), new DOMRect(at.left + 40, at.top, Math.min(220, at.width - 60), at.height));
}

/** The paper row menu the main process laid out (rowMenuTemplate), drawn here at the point or under the row. */
interface PaperEntry { kind: "item" | "sub" | "sep" | "spaces"; label?: string; pick?: number; checked?: boolean; disabled?: boolean; danger?: boolean; icon?: string; key?: string; todo?: string; entries?: PaperEntry[] }
function paperMenu(entries: PaperEntry[]): MenuEntry[] {
  return entries.map((entry): MenuEntry => {
    if (entry.kind === "sep") return { kind: "sep" };
    if (entry.kind === "spaces") return { kind: "sub", label: entry.label!, icon: entry.icon, entries: () => moveEntries(entry.todo!, pickedRows(entry.todo!)) };
    if (entry.kind === "sub") return { kind: "sub", label: entry.label!, icon: entry.icon, entries: () => paperMenu(entry.entries ?? []) };
    return { kind: "item", label: entry.label!, icon: entry.icon ?? null, key: entry.key, danger: entry.danger, checked: entry.checked, disabled: entry.disabled, run: () => void api.act({ type: "rowMenuPick", pick: entry.pick! }) };
  });
}
api.on("note:row-menu", (payload) => {
  const { id, entries, x, y, keyboard } = payload as { id: string; entries: PaperEntry[]; x?: number; y?: number; keyboard?: boolean };
  catchUp();
  const row = rowFor(id)?.element;
  const item = state?.items.find((entry) => entry.id === id);
  const at = x !== undefined && y !== undefined ? { x, y } : row ? row.getBoundingClientRect() : titleRow.getBoundingClientRect();
  openMenu(menuHost, paperMenu(entries), item?.title ?? "", "width" in at ? new DOMRect(at.left + 48, at.top + at.height - 6, 0, 0) : at, keyboard);
});

/**
 * #87: at the end of 오늘's list while one space shows, one small faint line — 다른 스페이스에 4개 더 · 모두 보기 (the
 * open to-dos the lens hides; no line for none). It replaced the band over the list, which said again, larger, what
 * the header's 회사만 ▾ says.
 */
const lensMoreText = h("span", { class: "lens-more-text" });
const lensAll = h("button", { class: "lens-all", title: `${t("모두 보기")} (Ctrl+Shift+0)` }, t("모두 보기"));
lensAll.addEventListener("click", () => setLens(undefined));
const lensMore = h("div", { class: "lens-more" }, lensMoreText, h("span", { class: "lens-more-dot", "aria-hidden": "true" }, "·"), lensAll);
function renderLensMore(hidden = hiddenOpen(lensNow())): boolean {
  if (!hidden) return false;
  const text = t("다른 스페이스에 {n}개 더", { n: groupedCount(hidden, lang()) });
  if (lensMoreText.textContent !== text) lensMoreText.textContent = text;
  return true;
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
  placeholder: () => {
    if (askingPick) return { long: t("오늘 꼭 하나만 고른다면?"), short: t("오늘 꼭 하나만?") };
    // 한 스페이스만 보기: what is written goes into that space (S7).
    const lens = state && page === "today" ? lineSpace ?? lensNow() : undefined;
    const space = lens && lens !== lensNone ? findSpace(state.todoSpaces, lens) : undefined;
    if (space) return { long: t("{name} 스페이스에 넣어요: 할 일, 일정", { name: space.name }), short: t("{name} 스페이스에 넣어요", { name: space.name }) };
    return { long: t("무엇이든 적어요: 할 일, 일정, ‘타이머 40’"), short: t("무엇이든 적어요") };
  },
  mode: () => "intent",
  // 2b (I): a column's `+ 회사에 넣기` writes the next line into that group, before the lens.
  spaces: () => (state ? { data: state.todoSpaces, lens: page === "today" ? lineSpace ?? lensNow() : undefined } : undefined),
  prefer: () => state?.prefs.intentPrefer ?? {},
  // #55 D-4: the key that brings you to this line (the guide teaches 입력 줄 Ctrl+N), not the quick entry's
  // Ctrl+Alt+N — that one is on the quick entry slip's own head. Same as the Mac (⌘N).
  shortcut: () => "Ctrl+N",
  commit: async (candidate, candidates, text, space) => {
    const result = await commitReading(flow, candidate, candidates, text, "note", space);
    // 2b (I): `+ 회사에 넣기` was for this one line.
    if (result.made && lineSpace !== undefined) { lineSpace = undefined; line.refresh(); }
    // 오늘 꼭 하나: the first to-do written after the question gets the day's star.
    if (askingPick && result.made?.kind === "todo" && result.made.id) {
      askingPick = false;
      void api.act({ type: "setPref", key: "starredTask", value: result.made.id });
      line.refresh();
    }
    if (result.made?.kind === "todo") requestAnimationFrame(() => sheet.scrollTo({ top: sheet.scrollHeight, behavior: reduceMotion() ? "auto" : "smooth" }));
    return Boolean(result.made);
  },
  onArrowUp: (event) => enterList(event, -1),
  onEscape: (event) => { if (line.value) { event.preventDefault(); line.clear(); } else line.field.blur(); },
});
// 2b (I): `+ 회사에 넣기` lasts while the line has the keyboard (or holds words).
line.field.addEventListener("blur", () => {
  if (lineSpace === undefined || line.value) return;
  lineSpace = undefined;
  line.refresh();
});
line.field.addEventListener("keydown", (event) => {
  // Ctrl+Z right after putting a line in takes it back (the field's own undo otherwise).
  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "z" && toast.visible && !line.value) {
    event.preventDefault();
    // Claude's toast up: Ctrl+Z is for Claude's entry (the main process decides), not the last line put in.
    if (aiToastUp) void api.act({ type: "undo" }); else void undoLast(flow);
  }
});
// The pick state's bar takes the line's place while picking.
dock.append(line.element, pickBar);

const allDone = h("div", { class: "all-done", role: "status" }, icon("leaf", 15), t("오늘 한 장 끝! 수고했어요"));

/** What an empty page shows: one of the cat's poses, faint, and a short line of what goes here. */
function emptyNote(pose: string, text: string): HTMLElement {
  return h("div", { class: "empty-note" }, h("img", { src: `../../assets/pet/256/${pose}.png`, alt: "", draggable: "false" }), h("div", {}, text));
}
const emptyToday = emptyNote("happy", t("오늘 할 일을 한 줄 적어 볼까요?"));

function focusNew(): void {
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
  // Rows of to-dos still on 오늘 are kept, shown or not (a space shown alone hides the others for a moment: they come back as they were).
  const listed = new Set(today.map((item) => item.id));
  for (const id of [...todayRows.keys()]) if (!listed.has(id)) todayRows.delete(id);
  // A kept row coming back into view (the lens let go, 완료 보기) is drawn as it is now, without playing a check.
  const row = (item: TodoItem, up: boolean) => {
    const kept = todayRows.get(item.id);
    if (!kept) return newRow(item, up);
    return shownToday.has(item.id) ? kept.updated(item, up) : kept.revived(item, up);
  };
  // The strip first: its 지금 · 다음 marks the rows below (#31).
  const shown = strip.render();
  // 2b: one group per space instead of 다음 · 그 밖에 (the 하루 띠 already shows what's next).
  if (groupsOn()) {
    // I (S45): a wide note shows the groups side by side when each gets 220 (the strip above them; they don't fold there).
    const groups = todaySpaceGroups();
    const board = boardFits(sheet.clientWidth || window.innerWidth, groups.length) && today.length > 0;
    lines.classList.toggle("board", board);
    sheet.classList.toggle("board-mode", board);
    const elements = groups.map((group) => drawGroup(group, row));
    shownToday = new Set(groups.flatMap((group) => shownRows(group).map((item) => item.id)));
    for (const key of [...groupViews.keys()]) if (!groups.some((group) => group.key === key)) groupViews.delete(key);
    lines.classList.remove("grouped");
    lines.classList.add("spaced");
    lines.classList.toggle("cards", !board && state.prefs.spaceGroupStyle !== "bookmark");
    lines.classList.toggle("bookmarks", !board && state.prefs.spaceGroupStyle === "bookmark");
    const more = renderLensMore();
    const device = deviceLines(todayAll());
    reconcile(lines, board ? elements : [...elements, ...(allFinished ? [allDone] : []), ...(today.length === 0 && !device.length ? [emptyToday] : []), ...(more ? [lensMore] : []), ...device, linesFill]);
    // #196 (D9): under the columns too.
    reconcile(sheet, [...(shown ? [strip.element] : []), lines, ...(board ? device : [])]);
    sheet.classList.toggle("with-strip", shown);
    if (board) chipsRow.hidden = true; else renderChips(groups);
    if (revealing) requestAnimationFrame(revealNow);
    renderTodayFooter(today.length - remaining);
    return;
  }
  chipsRow.hidden = true;
  lines.classList.remove("spaced", "cards", "bookmarks", "board");
  sheet.classList.remove("board-mode");
  const nextRows = next.map((item) => row(item, true));
  const restRows = rest.map((item) => row(item, false));
  shownToday = new Set([...next, ...rest].map((item) => item.id));
  nextHead.querySelector(".group-count")!.textContent = String(next.length);
  restHead.querySelector(".group-count")!.textContent = String(rest.length);
  lines.classList.toggle("grouped", grouped);
  const more = renderLensMore();
  // #196 (D9): everything hidden here — the end line says so, not the empty sheet's cat.
  const device = deviceLines(todayAll());
  reconcile(lines, [
    ...(grouped ? [nextHead] : []), ...nextRows, ...(grouped ? [restHead] : []), ...restRows,
    ...(allFinished ? [allDone] : []), ...(today.length === 0 && !device.length ? [emptyToday] : []), ...(more ? [lensMore] : []), ...device, ...(grouped ? [linesFill] : []),
  ]);
  reconcile(sheet, [...(shown ? [strip.element] : []), lines]);
  sheet.classList.toggle("with-strip", shown);
  renderTodayFooter(today.length - remaining);
}

/** The rows 오늘 showed last time it was drawn. */
let shownToday = new Set<string>();

// ─── 2b: 스페이스별로 묶기 (docs/plans/spaces-phase2.md, core/spaceGroups.ts) ─────

/** 오늘 in groups: turned on here, with a space to group by (none: as before, nothing added). */
const groupsOn = () => Boolean(state?.prefs.spaceGroups) && hasSpaces();
/** Now — or the moment snapshots set for the 하루 띠 (`window.ribbonNow`), so a group's 다음 matches it. */
const groupsNow = (): Date => { const forced = (window as { ribbonNow?: string }).ribbonNow; return forced ? new Date(forced) : new Date(); };
/** The groups of the rows shown now (S39–S42). */
function todaySpaceGroups(now = groupsNow()): SpaceGroup[] {
  const spaces = spacesOf();
  return spaceGroups(visibleToday(), state.todoSpaces, (id) => spaces.get(id)?.id, lensNow(now), now);
}
const isFolded = (key: string) => state.prefs.spaceGroupsFolded.includes(key);
/** The rows a group shows: none while folded; F keeps the finished ones under 끝낸 N until opened. */
function shownRows(group: SpaceGroup): TodoItem[] {
  // I: a column shows every row, its finished ones at the foot (columns don't fold).
  if (lines.classList.contains("board")) return groupItems(group);
  if (isFolded(group.key)) return [];
  if (state.prefs.spaceGroupStyle !== "bookmark" && !state.prefs.spaceGroupsDoneOpen.includes(group.key)) return [...group.timed, ...group.rest];
  return groupItems(group);
}
/** A device list of group keys with `key` in or out. */
function toggleGroupKey(pref: "spaceGroupsFolded" | "spaceGroupsDoneOpen", key: string): void {
  const list = state.prefs[pref];
  void api.act({ type: "setPref", key: pref, value: list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key] });
}
/** ‘스페이스별로 묶기’ on or off (the header's menu, ⋯ → 보기, Ctrl+Shift+G, 설정 → 스페이스). */
function toggleSpaceGroups(): void {
  if (!hasSpaces()) return;
  void api.act({ type: "setPref", key: "spaceGroups", value: !state.prefs.spaceGroups });
}
/** The rows shown in `id`'s group that keep a place of their own (the timed ones go by their time). */
function reorderableInGroup(id: string): string[] {
  const group = todaySpaceGroups().find((entry) => groupItems(entry).some((item) => item.id === id));
  return group ? shownRows(group).filter((item) => !group.times.has(item.id)).map((item) => item.id) : [];
}
/** A group's head clicked: that space alone (as Ctrl+Shift+1–9); clicked again while it's alone, everything. */
function showGroupAlone(key: string): void {
  setLens(lensNow() === key ? undefined : key);
}

/** One group's lasting elements (kept so a redraw moves no row that stays put). */
interface GroupView { element: HTMLElement; head: HTMLElement; rows: HTMLElement; fold: HTMLButtonElement; add: HTMLButtonElement; ring: HTMLElement; drawn: string; folded?: boolean; doneOpen?: boolean }
const groupViews = new Map<string, GroupView>();

function makeGroupView(key: string): GroupView {
  const head = h("div", { class: "sgroup-head", role: "heading", "aria-level": "3" });
  const rows = h("div", { class: "sgroup-rows", role: "list" });
  const fold = h("button", { class: "sgroup-done", hidden: "" });
  fold.addEventListener("click", () => toggleGroupKey("spaceGroupsDoneOpen", key));
  // I: a column's foot — the input line, writing into this group.
  const add = h("button", { class: "sgroup-add" });
  add.addEventListener("click", () => {
    lineSpace = key;
    line.refresh();
    line.focus();
  });
  const element = h("div", { class: "sgroup", "data-group": key }, head, rows, fold, add);
  // F's ring stays the same element across redraws of the head, so it can fill (N17).
  const ring = h("span", { class: "sgroup-ring", "aria-hidden": "true" });
  return { element, head, rows, fold, add, ring, drawn: "" };
}

/** H: the shortcut chips (chipsRow, under the title). */
let chipsDrawn = "";
/** A chip clicked: its group opened (when folded), then scrolled to once drawn. */
let revealing: string | undefined;
function renderChips(groups: readonly SpaceGroup[]): void {
  chipsRow.hidden = groups.length < 2;
  const drawn = JSON.stringify(groups.map((group) => [group.key, groupOpen(group), group.space ? findSpace(state.todoSpaces, group.space)?.name : generalNow(), group.space && findSpace(state.todoSpaces, group.space)?.color]));
  if (drawn === chipsDrawn) return;
  chipsDrawn = drawn;
  chipsRow.replaceChildren(...groups.map((group) => {
    const space = group.space ? findSpace(state.todoSpaces, group.space) : undefined;
    const name = space?.name ?? generalNow();
    const dot = h("span", { class: `schip-dot${space ? "" : " general"}`, "aria-hidden": "true" });
    if (space) dot.style.setProperty("--band", bandStyle(space));
    const chip = h("button", { class: "schip", "aria-label": `${name}, ${leftWords(groupOpen(group), lang())}` }, dot, h("span", { class: "schip-name" }, name), h("span", { class: "schip-count" }, groupedCount(groupOpen(group), lang())));
    chip.addEventListener("click", () => {
      revealing = group.key;
      if (isFolded(group.key)) toggleGroupKey("spaceGroupsFolded", group.key); else revealNow();
    });
    return chip;
  }));
}
function revealNow(): void {
  if (!revealing) return;
  const element = groupViews.get(revealing)?.element;
  revealing = undefined;
  element?.scrollIntoView({ block: "start", inline: "start", behavior: reduceMotion() ? "auto" : "smooth" });
}

/** A group drawn: F's card (tape, ring, name, N개 남음, 끝낸 N) or E's bookmark (name and count, 다음 13:43). */
function drawGroup(group: SpaceGroup, row: (item: TodoItem, up: boolean) => HTMLElement): HTMLElement {
  let view = groupViews.get(group.key);
  if (!view) groupViews.set(group.key, (view = makeGroupView(group.key)));
  const space = group.space ? findSpace(state.todoSpaces, group.space) : undefined;
  const name = space?.name ?? generalNow();
  const card = state.prefs.spaceGroupStyle !== "bookmark";
  const folded = isFolded(group.key);
  const open = groupOpen(group);
  const doneOpen = state.prefs.spaceGroupsDoneOpen.includes(group.key);
  const next = group.next === undefined ? "" : nextWords(clock(new Date(group.next).getHours(), new Date(group.next).getMinutes(), lang()), lang());
  const board = lines.classList.contains("board");
  // N12: what turned since the last draw — ⌄ turns (바뀜) and the rows that come into view fade in; folding is at once.
  const turned = view.folded !== undefined && view.folded !== folded;
  const doneTurned = view.doneOpen !== undefined && view.doneOpen !== doneOpen;
  const opening = !reduceMotion() && ((turned && !folded) || (doneTurned && doneOpen));
  view.folded = folded;
  view.doneOpen = doneOpen;
  const drawn = JSON.stringify([card, board, name, space?.color, open, group.done.length, next, folded, doneOpen, lensNow() === group.key]);
  if (view.drawn !== drawn) {
    view.drawn = drawn;
    view.element.classList.toggle("general", !space);
    view.element.classList.toggle("folded", folded);
    view.element.style.setProperty("--band", space ? bandStyle(space) : "var(--faint)");
    const pick = h("button", { class: "sgroup-pick", title: t("{name}만 보기", { name }) });
    pick.setAttribute("aria-label", `${name}, ${leftWords(open, lang())}`);
    pick.addEventListener("click", () => showGroupAlone(group.key));
    // ⌄: folded to the head and its count, or open (this device remembers, per space).
    const unfoldWord = t("펼치기", undefined, "group");
    const foldWord = folded ? unfoldWord : t("접기", undefined, "group");
    const foldButton = h("button", { class: "sgroup-fold", title: foldWord, "aria-expanded": String(!folded), "aria-label": `${name} ${foldWord}` }, icon("chevron", 12, 2.2));
    foldButton.addEventListener("click", () => toggleGroupKey("spaceGroupsFolded", group.key));
    // J: the words on this group while a row from another is dragged over it.
    const hint = h("span", { class: "sgroup-drop" }, dropHereWords(name, lang()));
    view.add.textContent = addToWords(name, lang());
    view.add.title = addToWords(name, lang());
    if (board) {
      // I: a column's head — the name and the open count (no ⌄: columns don't fold).
      pick.append(h("span", { class: "sgroup-name" }, name));
      view.head.replaceChildren(pick, h("span", { class: "sgroup-count" }, groupedCount(open, lang())), hint);
    } else if (card) {
      const total = group.done.length + open;
      const ring = view.ring;
      const share = `${total ? Math.round((group.done.length / total) * 360) : 0}deg`;
      // The head is made again, so the ring comes back into the page: a keyframe fills it from where it was (a
      // transition wouldn't run on an element just put back), and `--ring-from` catches up once it's done.
      ring.style.setProperty("--ring-from", ring.style.getPropertyValue("--ring-done") || share);
      ring.style.setProperty("--ring-done", share);
      window.clearTimeout(Number(ring.dataset.settle));
      ring.dataset.settle = String(window.setTimeout(() => ring.style.setProperty("--ring-from", share), motion.draw + 40));
      pick.append(ring, h("span", { class: "sgroup-name" }, name), h("span", { class: "sgroup-left" }, leftWords(open, lang())), hint);
      view.head.replaceChildren(pick, foldButton);
    } else {
      pick.append(h("span", { class: "sgroup-tag" }, h("span", { class: "sgroup-name" }, name), h("span", { class: "sgroup-count" }, groupedCount(open, lang()))));
      view.head.replaceChildren(pick, h("span", { class: "sgroup-next" }, next), hint, foldButton);
    }
    view.fold.replaceChildren(doneWords(group.done.length, lang()), icon("chevron", 10, 2.2));
    view.fold.classList.toggle("open", doneOpen);
    view.fold.setAttribute("aria-expanded", String(doneOpen));
    // The head and the chevron are made again on a change, so a keyframe turns ⌄ from where it was.
    if (turned) turnChevron(foldButton, folded ? "0deg" : "-90deg");
    if (doneTurned) turnChevron(view.fold, doneOpen ? "0deg" : "180deg");
  }
  view.fold.hidden = board || !(card && !folded && group.done.length > 0);
  view.add.hidden = !board;
  const before = opening ? new Set(view.rows.children) : undefined;
  reconcile(view.rows, shownRows(group).map((item) => row(item, group.times.has(item.id))));
  if (before) {
    // Only the rows the group just showed (one class each, on this draw only; no height moves).
    for (const element of view.rows.children) {
      if (before.has(element)) continue;
      element.classList.add("unfold-in");
      setTimeout(() => element.classList.remove("unfold-in"), motion.change + 60);
    }
  }
  return view.element;
}

/** N12: a group's ⌄ (made again with its head) turns from `from` to where it now points, with 바뀜. */
function turnChevron(button: HTMLElement, from: string): void {
  if (reduceMotion()) return;
  button.style.setProperty("--turn-from", from);
  button.classList.add("turning");
  setTimeout(() => button.classList.remove("turning"), motion.change + 60);
}

/**
 * N17: the donut fills with 그리기 (0.22 s) as tasks get done — from the draw after its first, so it doesn't fill up
 * from empty when the note opens (the Mac's doesn't either).
 */
function liveAfterFirstDraw(element: HTMLElement): void {
  if (element.classList.contains("live") || element.dataset.live) return;
  element.dataset.live = "soon";
  requestAnimationFrame(() => requestAnimationFrame(() => element.classList.add("live")));
}

function newRow(item: TodoItem, next: boolean): HTMLElement {
  const row = new Row(item, false, next);
  todayRows.set(item.id, row);
  madeRows.push({ id: item.id, element: row.element });
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
  redraw: () => { if (state) render(); },
  // 2a (A3, A4): the lens is the strip's and the timetable's too.
  tasks: () => lensTasks(noteItems(), spacesOf(), lensNow()),
  spaceOf: (id) => spacesOf().get(id),
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
    const warning = h("button", { class: "warning", title: state.storageError }, icon("warning", 13), t("저장 폴더 확인"));
    warning.addEventListener("click", () => api.act({ type: "showStorageProblem" }));
    parts.push(warning);
  } else {
    const history = h("button", { class: "history", title: t("완료 기록 (Ctrl+H)"), "aria-label": t("완료 기록 보기") }, icon("leaf", 14), t("완료 기록"));
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
let aheadKept: { state: TodosState; minute: number; finishing: string; lens?: string; sections: AheadSection[]; all: number; hidden: number } | undefined;
/** 2a (A2, S37): the page under the lens — its to-dos only; events stay. `all`: the tab's count (every to-do), `hidden`: the end line's N. */
function aheadLensed(now = new Date()): { sections: AheadSection[]; all: number; hidden: number } {
  // The header and the page both ask during one redraw: worked out once per state and minute.
  const minute = Math.floor(now.getTime() / 60_000);
  const holding = [...finishing].join(",");
  const lens = lensNow(now);
  if (aheadKept && aheadKept.state === state && aheadKept.minute === minute && aheadKept.finishing === holding && aheadKept.lens === lens) return aheadKept;
  const listed = noteItems(now);
  const items = finishing.size ? listed.map((item) => (finishing.has(item.id) && item.isCompleted ? { ...item, isCompleted: false } : item)) : listed;
  const spaces = spacesOf();
  const lensed = aheadLens(items, (id) => spaces.get(id)?.id, lens, now);
  const sections = aheadSections(lensed.items, state.events ?? [], now, lang());
  const all = lens === undefined ? aheadCount(sections) : aheadCount(sections) + lensed.hidden;
  aheadKept = { state, minute, finishing: holding, lens, sections, all, hidden: lensed.hidden };
  return aheadKept;
}
const aheadNow = (now = new Date()): AheadSection[] => aheadLensed(now).sections;

const aheadList = h("div", { class: "ahead", role: "list" });
// Two sentences, two lines (one long line would leave a word on its own).
const emptyAhead = emptyNote("curious", t("앞으로 할 일이 없어요. 아래에 ‘금요일까지 보고서’처럼 적어 보세요.").replace(/([.!?]) /, "$1\n"));
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
  const real = lookup().items.get(item.id) ?? item;
  let row = aheadRows.get(item.id);
  if (row) { row.meta = meta; row.update(real); } else { row = new Row(real, true, false, meta); aheadRows.set(item.id, row); madeRows.push({ id: item.id, element: row.element }); }
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
  line.addEventListener("contextmenu", (contextEvent) => { contextEvent.preventDefault(); void api.act({ type: "showEventMenu", key: event.key, x: contextEvent.clientX, y: contextEvent.clientY }); });
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
  // 2a (A1, A2): one space showing — the open to-dos ahead it hides, on the last line (as 오늘's, #87).
  if (renderLensMore(aheadLensed(now).hidden)) children.push(lensMore);
  // #196 (D9): what this PC hides ahead.
  children.push(...deviceLines(state.items.filter((item) => pageOf(item, now) !== "today" && !item.isCompleted)));
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
  // 2a (A17): the end line steps aside while the empty days show as places to drop on.
  lensMore.remove();
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
  lensMore.remove();
  aheadList.append(sectionHead({ kind: "someday", title: t("언젠가"), count: 0 }), entry.element);
}

// Snapshots draw a drag: the empty days and 언젠가 shown to drop on.
window.addEventListener("snapshot-drag", () => { showAllDays(); showEmptySomeday(); });
// Snapshots move a task from the main process and ask for its toast.
window.addEventListener("snapshot-moved", (event) => movedToast((event as CustomEvent<AheadTarget>).detail));

/** The toast after a task was moved by dragging (or ↓ 언젠가, → 내일): where it went, with 되돌리기. */
function movedToast(target: AheadTarget): void {
  const text = target.kind === "day" && target.day === tomorrowKey(new Date()) ? movedTomorrowText(lang()) : movedText(target, new Date(), lang());
  toast.show({ icon: target.kind === "someday" ? "later" : target.kind === "today" ? "sun" : "calendar", text, action: { label: t("되돌리기"), run: () => void api.act({ type: "undo" }) } });
}

/** → 내일 · Alt+→ / Alt+←: the task due on `day` (off any shelf), with the toast. */
function moveToDay(id: string, day: string): void {
  void api.act({ type: "moveTasks", ids: [id], target: { kind: "day", day } });
  movedToast({ kind: "day", day });
}

/** The trash (or Delete): gone, with 지웠어요 · 되돌리기 (Ctrl+Z still works). */
function deleteTask(id: string): void {
  void api.act({ type: "delete", id });
  toast.show({ icon: "trash", text: t("할 일을 지웠어요"), action: { label: t("되돌리기"), run: () => void api.act({ type: "undo" }) } });
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
  private readonly tomorrow: HTMLButtonElement;
  private readonly carry: HTMLSpanElement;
  private readonly mark: HTMLSpanElement;
  private readonly star: HTMLSpanElement;
  /** AI 연결: "Claude" stamped after the title, the day Claude added or changed it. */
  private readonly stamp: HTMLSpanElement;
  private readonly band: HTMLSpanElement;
  /** 2b (I): in a narrow board column, the time and deadline on a small line under the title. */
  private readonly subline: HTMLSpanElement;
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
    this.stamp = h("span", { class: "ai-stamp", title: t("Claude가 오늘 넣거나 고쳤어요"), role: "img", "aria-label": t("Claude가 오늘 넣거나 고쳤어요") }, "Claude");
    this.subline = h("span", { class: "subline", hidden: "", "aria-hidden": "true" });
    this.textCell = h("div", { class: "text" }, this.star, this.label, this.stamp, this.subline);
    this.due = h("button", { class: "due" });
    this.time = h("button", { class: "time" });
    // Put in the calendar (a copy: changing the task later doesn't change the event).
    this.sent = h("span", { class: "sent-mark", title: t("달력에 넣음"), "aria-label": t("달력에 넣음"), role: "img" }, icon("calendar", 13));
    this.bell = h("button", { class: "row-icon bell", title: t("알림 · 반복 · 마감 설정") }, icon("bell", 15));
    this.flag = h("button", { class: "row-icon", title: t("마감 날짜") }, icon("flag", 15));
    // Moving is said in words: ↑ 오늘로 / → 내일.
    this.sun = h("button", { class: "move", title: t("오늘 할 일로 옮겨요") }, icon("arrowUp", 11, 2.4), t("오늘로"));
    // 내일 하기: due tomorrow (Alt+→ on a selected row).
    this.tomorrow = h("button", { class: "move", title: t("내일 할 일로 옮겨요 (Alt+→)") }, icon("arrowRight", 11, 2.4), h("span", { class: "move-label" }, t("내일")));
    // ⋯: the right-click menu (#17), under the button — 언젠가로 (Alt+↓), 이거 집중 (F), 지우기 (Del) and the rest.
    const more = h("button", { class: "row-icon more", title: t("더 보기"), "aria-label": t("더 보기"), "aria-haspopup": "menu" }, icon("more", 15));
    // The end of the row: the deadline and alert as quiet text; on hover that spot turns into the row's buttons —
    // three at most (#55 D-3): 오늘 → 내일 · 알림 · ⋯, 앞으로 ↑ 오늘로 · 마감 · ⋯, done ⋯. Nothing covers the
    // title, and at rest it keeps the full width. Same as the Mac.
    const actions = h("div", { class: "actions" }, this.sun, this.tomorrow, this.bell, this.flag, more);
    // 어제부터 · 3일째: how long an undated task has stayed on 오늘.
    this.carry = h("span", { class: "carry" });
    // #31: 지금 · 다음 on a row the 하루 띠 shows too.
    this.mark = h("span", { class: "strip-mark", hidden: "" });
    // 할 일 골라 집중…: on hover, a small 집중 in place of the row's buttons.
    const pick = h("button", { class: "focus-pick", title: t("이 할 일에 집중") }, icon("timer", 13), t("집중"));
    pick.addEventListener("click", () => pickTask(this.item.id));
    // 할 일 스페이스: the space's band at the left edge (오늘 only), its name in the tooltip.
    this.band = h("span", { class: "sband", hidden: "" });
    // 앞으로 (#48): the deadline's flag is the row's last column, so the flags line up; a time comes before it.
    const ends = onShelf ? [this.sent, this.time, this.due] : [this.due, this.time, this.sent];
    this.element = h("div", { class: "row", role: "listitem", "data-id": item.id }, this.band, grip, check, this.textCell, this.mark, this.carry, ...ends, actions, pick, h("span", { class: "end" }));

    check.addEventListener("click", () => {
      commitEditing();
      // 앞으로 lists open tasks only: a checked one plays its check, then goes.
      if (!this.item.isCompleted && (state.prefs.hideCompleted || this.onShelf)) holdWhileFinishing(this.item.id);
      void api.act({ type: "toggle", id: this.item.id });
    });
    // #168: with Ctrl or Shift the title picks the row (more rows), as the row's empty space does; else it edits.
    this.label.addEventListener("click", (event) => { if (event.ctrlKey || event.metaKey || event.shiftKey) clickRow(this.item.id, event); else this.beginEdit(); });
    this.due.addEventListener("click", () => openEditor(this.item.id, "deadline"));
    this.time.addEventListener("click", () => openEditor(this.item.id, rangeOf(this.item) ? "time" : undefined));
    this.bell.addEventListener("click", () => openEditor(this.item.id));
    this.flag.addEventListener("click", () => openEditor(this.item.id, "deadline"));
    this.sun.addEventListener("click", () => { void api.act({ type: "dropAhead", id: this.item.id, target: { kind: "today" } }); movedToast({ kind: "today" }); });
    this.tomorrow.addEventListener("click", () => moveToDay(this.item.id, tomorrowKey(new Date())));
    more.addEventListener("click", () => {
      commitEditing();
      const rect = more.getBoundingClientRect();
      void api.act({ type: "showRowMenu", id: this.item.id, x: Math.round(rect.left), y: Math.round(rect.bottom + 2) });
    });
    // A click on the row's empty space selects it for the keyboard (↑↓ · Space · Enter · Delete).
    this.element.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button, input, .label, .grip")) return;
      clickRow(this.item.id, event);
    });
    this.element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      commitEditing();
      void api.act({ type: "showRowMenu", id: this.item.id, x: event.clientX, y: event.clientY });
    });
    this.render(item, false);
  }

  update(item: TodoItem): void {
    const completedNow = !quietDraw && item.isCompleted && !this.item.isCompleted;
    this.item = item;
    // Every state push redraws the page: a row whose task and surroundings didn't change is left alone.
    if (!completedNow && this.drawnKey === this.key(item)) return;
    this.render(item, completedNow);
  }

  /** Everything the row's look depends on (the clock too: "어제부터", D-3 and 내일 09:00 move with the day). */
  private drawnKey = "";
  private key(item: TodoItem): string {
    const series = item.seriesID ? state.series.find((entry) => entry.id === item.seriesID) : undefined;
    // The space by id; its name and colour by the spaces' own version (one string per state, not one per row).
    const space = spacesOf().get(item.id)?.id;
    return JSON.stringify([item, this.next, this.onShelf, this.meta, state.prefs.dueStyle, editingID === item.id, series?.rule, series?.remindAt, space, space && spacesVersion,
      isStarred(item), lookup().withEvents.has(item.id), aiMarked(item.id), this.stripMark(item), rowClock(item)]);
  }

  /** Shown in the 하루 띠's 지금 · 다음 block too (오늘's open rows only). */
  private stripMark(item: TodoItem): "now" | "next" | undefined {
    return this.onShelf || item.isCompleted ? undefined : strip.marks.get(item.id);
  }

  /** Back in view after being hidden: drawn as the task is now (no check animation for one finished meanwhile). */
  revived(item: TodoItem, next: boolean): HTMLElement {
    this.next = next;
    this.item = item;
    if (this.drawnKey !== this.key(item)) this.render(item, false);
    return this.element;
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

    this.sent.hidden = item.isCompleted || !lookup().withEvents.has(item.id);

    const series = item.seriesID ? state.series.find((entry) => entry.id === item.seriesID) : undefined;
    const hasReminder = Boolean(item.reminderAt);
    // 시간 정하기: a task with hours on its day says them (clock) in place of the bell's time.
    const ranged = rangeTimes(item, now);
    const showPill = Boolean(ranged) || hasReminder || Boolean(series && !item.isCompleted);
    this.time.hidden = !showPill;
    this.bell.hidden = this.onShelf || item.isCompleted;
    this.tomorrow.hidden = this.onShelf || item.isCompleted;
    this.tomorrow.setAttribute("aria-label", t("{title} 내일 하기", { title: item.title }));
    const mark = this.stripMark(item);
    this.mark.hidden = !mark;
    this.mark.textContent = mark ? markWord(mark, lang()) : "";
    this.mark.title = mark === "now" ? t("하루 띠의 ‘지금’에도 있어요") : mark ? t("하루 띠의 ‘다음’에도 있어요") : "";
    const carried = this.onShelf || this.next || item.isCompleted ? undefined : carriedText(carriedDays(item, now), lang());
    this.carry.hidden = !carried;
    this.carry.textContent = carried ?? "";
    this.carry.title = carried ? t("{text} 오늘 할 일에 있어요", { text: carried }) : "";
    this.star.hidden = !isStarred(item);
    const space = spacesOf().get(item.id);
    this.band.hidden = !space;
    if (space) {
      this.band.style.setProperty("--band", bandStyle(space));
      this.band.title = space.name;
      this.band.setAttribute("aria-label", t("스페이스 {name}", { name: space.name }));
    }
    this.stamp.hidden = !aiMarked(item.id);
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
    // 2b (I): the same time and deadline, for a column's line under the title (shown only on the board).
    const below = [this.time.hidden ? "" : this.time.textContent ?? "", this.due.hidden ? "" : this.due.textContent ?? ""].filter(Boolean);
    this.subline.textContent = below.join(" · ");
    this.subline.hidden = below.length === 0;
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

/**
 * #66: what the clock changes on a row — the day (the calendar's and the 4 a.m. one: D-3, 어제부터, 내일 09:00), and for
 * a reminder whether its time has passed (알림 대기). The minute's redraw draws only the rows these changed for, not
 * all 1,900 every minute.
 */
let clockKept: { minute: number; day: string } | undefined;
function rowClock(item: TodoItem): string {
  const now = Date.now();
  const minute = Math.floor(now / 60_000);
  if (clockKept?.minute !== minute) { const date = new Date(now); clockKept = { minute, day: `${date.toDateString()}|${dayKey(date)}` }; }
  return item.reminderAt ? `${clockKept.day}|${Date.parse(item.reminderAt) < now}` : clockKept.day;
}

/** AI 연결: Claude added or changed this to-do today (and nobody changed it since). */
function aiMarked(id: string): boolean {
  return Boolean(state.ai?.marks.includes(id.toUpperCase()));
}

function rowFor(id: string): Row | undefined {
  return (page === "ahead" ? aheadRows : todayRows).get(id);
}

function commitEditing(): void {
  if (editingID) rowFor(editingID)?.commitEdit();
}

function holdWhileFinishing(id: string): void {
  finishing.add(id);
  setTimeout(() => {
    // N4 (as on the Mac): the row folds away (등장's 0.18 s, ease-in) before the list closes up; it stays in `finishing`
    // meanwhile, so a redraw keeps it, and it takes no clicks. One row, and only one that is on the page now.
    const leaving = leavingRow(id);
    if (!leaving) { finishing.delete(id); drawWhenSeen(); return; }
    leaving.classList.add("leaving");
    setTimeout(() => { leaving.classList.remove("leaving"); finishing.delete(id); drawWhenSeen(); }, motion.enter);
  }, holdMs()); // 0.65 s, 0.3 under Reduce Motion
}

/** The row of a just-finished to-do that goes once its hold ends (still done, still drawn), or none. */
function leavingRow(id: string): HTMLElement | undefined {
  if (reduceMotion() || document.hidden || !state) return undefined;
  if (!lookup().items.get(id)?.isCompleted) return undefined;
  if (page === "today" && !state.prefs.hideCompleted) return undefined;
  const element = rowFor(id)?.element;
  // A row being dragged (#167 · #168) goes at the drop, not folding under the pointer.
  return element?.isConnected && !element.classList.contains("dragging") ? element : undefined;
}

/**
 * N3: a to-do just added comes in with 등장 (rising 6 px as it fades in) — only its row, and only rows made in this
 * draw for ids the last drawn state didn't have (not the first draw, not a catch-up, not a day's worth at once).
 */
let drawnItems: readonly TodoItem[] | undefined;
const madeRows: { id: string; element: HTMLElement }[] = [];
function playAdded(): void {
  const made = madeRows.splice(0);
  const before = drawnItems;
  drawnItems = state.items;
  if (!before || quietDraw || made.length === 0 || made.length > 3 || reduceMotion()) return;
  for (const { id, element } of made) {
    if (before.some((item) => item.id === id) || !element.isConnected) continue;
    element.classList.add("appear");
    // Off after it ran, so a row moved later (reconcile) doesn't play it again.
    setTimeout(() => element.classList.remove("appear"), motion.enter + 60);
  }
}

/** A task checked: the left ear on top of the note twitches (#151; not with reduced motion — the ears' page checks too). */
function nod(): void {
  if (reduceMotion()) return;
  api.send("ears:twitch");
}

// ─── Drag to reorder (today) ────────────────────────────────────────────────

function startDrag(event: PointerEvent, id: string, grip: HTMLElement): void {
  if (event.button !== 0) return;
  event.preventDefault();
  commitEditing();
  grip.setPointerCapture(event.pointerId);
  const source = todayRows.get(id)!.element;
  // #168: a picked row takes every picked row with it (faded too while they go).
  const moving = pickedRows(id);
  const faded = moving.flatMap((entry) => { const row = todayRows.get(entry); return row ? [row.element as HTMLElement] : []; });
  for (const element of faded) element.classList.add("dragging");
  let drop: { targetID: string; after: boolean } | undefined;
  /** Over the 앞으로 tab: dropping there moves the task to that page. */
  let tabTarget: NoteTab | undefined;
  // Looked up each time: a redraw during the drag replaces the tabs.
  const tabElements = () => [...tabs.querySelectorAll<HTMLElement>(".index-tab")];
  /** 2b (J): another group under the pointer (grouped by space). */
  let groupTarget: string | undefined;
  // #167: what the drag moves among is worked out once, at the press (it was the whole sheet's groups on every move);
  // inside its group 다음 keeps the time's order, so rows move among the rest only.
  const grouped = groupsOn();
  const visible = grouped ? [] : todayGroups().rest.map((item) => item.id);
  // Only what changed is marked or cleared (every row of the sheet was cleared on every move; a group's class changed
  // twice a move, and the browser worked out the styles of all its rows again).
  let marked = new Map<HTMLElement, string>();
  const show = (next: Map<HTMLElement, string>) => {
    for (const [element, name] of marked) if (next.get(element) !== name) element.classList.remove(name);
    for (const [element, name] of next) if (marked.get(element) !== name) element.classList.add(name);
    marked = next;
  };
  const clear = () => {
    show(new Map());
    source.classList.remove("to-tab");
  };
  const ghost = dragGhost(source, moving.length > 1 ? badgeWords(moving.length, lang()) : undefined);
  const startX = event.clientX, startY = event.clientY;
  let pointer = { x: event.clientX, y: event.clientY };
  const place = () => {
    // Read first (the tabs, the row under the pointer), then mark: no layout forced between the two.
    const rects = tabElements().map((element, index) => {
      const rect = element.getBoundingClientRect();
      return { tab: pages[index] as NoteTab, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
    });
    const over = tabAt(rects, pointer.x, pointer.y);
    let next: { targetID: string; after: boolean } | undefined;
    let nextGroup: string | undefined;
    if (!over) {
      if (grouped) ({ group: nextGroup, drop: next } = groupDragOver(id, pointer.x, pointer.y));
      else next = plainDrop(id, visible, pointer.y) ?? undefined;
    }
    drop = next;
    groupTarget = nextGroup;
    tabTarget = over && dropTabs.includes(over) ? over : undefined;
    const marks = new Map<HTMLElement, string>();
    const tab = tabTarget ? tabElements()[pages.indexOf(tabTarget as Page)] : undefined;
    if (tab) marks.set(tab, "drop-target");
    const group = groupTarget ? groupViews.get(groupTarget)?.element : undefined;
    if (group) marks.set(group, "drop-target");
    const row = drop && drop.targetID !== id ? todayRows.get(drop.targetID)?.element : undefined;
    if (row && drop) marks.set(row, drop.after ? "drop-after" : "drop-before");
    show(marks);
    source.classList.toggle("to-tab", Boolean(tabTarget));
  };
  const move = (moveEvent: PointerEvent) => {
    pointer = { x: moveEvent.clientX, y: moveEvent.clientY };
    ghost.follow(pointer.x - startX, pointer.y - startY);
    place();
  };
  // Near the list's top or bottom edge (or a column's), it scrolls while the pointer waits there; then the place again.
  const scroller = edgeScroller(() => pointer, () => listUnder(pointer.x, pointer.y), place);
  const end = () => {
    grip.removeEventListener("pointermove", move);
    scroller.stop();
    ghost.remove();
    for (const element of faded) element.classList.remove("dragging");
    clear();
    if (tabTarget) {
      // Said where it went: its day (a deadline still ahead) or 언젠가.
      const item = state.items.find((entry) => entry.id === id);
      const result = item ? tabDrop(item, tabTarget, new Date()) : undefined;
      void api.act({ type: "dropOnTab", id, tab: tabTarget });
      if (result) movedToast(result.kind === "deadline" ? { kind: "day", day: result.dueDate } : { kind: "someday" });
    } else if (groupTarget) {
      // J (S43): into another group — its head, or between its rows; the toast's 되돌리기 puts back the space and the place.
      void api.act({ type: "groupDrop", id, ...(moving.length > 1 ? { ids: moving } : {}), space: groupSpace(groupTarget), ...(drop ? { targetID: drop.targetID, after: drop.after } : {}) });
    } else if (drop && moving.length > 1) void api.act({ type: "moveMany", ids: moving, targetID: drop.targetID, after: drop.after });
    else if (drop) void api.act({ type: "move", id, targetID: drop.targetID, after: drop.after });
  };
  grip.addEventListener("pointermove", move);
  grip.addEventListener("pointerup", end, { once: true });
  grip.addEventListener("pointercancel", () => { drop = undefined; tabTarget = undefined; groupTarget = undefined; end(); }, { once: true });
}

// Snapshots: a row drawn as if dragged over another group (`detail`: { id, group }; none: as before).
// #168: with `lift` (px down), the dragged row's copy too, over the target — and its badge when several rows are picked.
let snapshotGhost: { remove(): void } | undefined;
window.addEventListener("snapshot-group-drag", (event) => {
  const { id, group, lift } = ((event as CustomEvent).detail ?? {}) as { id?: string; group?: string; lift?: number };
  for (const view of groupViews.values()) view.element.classList.remove("drop-target");
  for (const row of todayRows.values()) row.element.classList.remove("dragging");
  snapshotGhost?.remove();
  snapshotGhost = undefined;
  if (id && lift !== undefined) {
    const moving = pickedRows(id);
    const row = todayRows.get(id)?.element;
    if (row) {
      const ghost = dragGhost(row, moving.length > 1 ? badgeWords(moving.length, lang()) : undefined);
      ghost.follow(6, lift);
      snapshotGhost = ghost;
    }
    for (const entry of moving) todayRows.get(entry)?.element.classList.add("dragging");
  } else if (id) todayRows.get(id)?.element.classList.add("dragging");
  if (group) groupViews.get(group)?.element.classList.add("drop-target");
});

/**
 * J: the group under a row dragged by its grip, grouped by space — another group (`group`, lit by the caller in its
 * colour with where it goes); over a row, the place before or after it (`drop`). The row's own group: places only.
 * #167: the groups' boxes (a handful), then the row by halving its group's rows (they stand in order), not every row's
 * box from the top.
 */
function groupDragOver(id: string, x: number, y: number): { group?: string; drop?: { targetID: string; after: boolean } } {
  const sourceRow = todayRows.get(id)?.element;
  for (const [key, view] of groupViews) {
    if (!view.element.isConnected) continue;
    const box = view.element.getBoundingClientRect();
    if (x < box.left || x > box.right || y < box.top || y > box.bottom) continue;
    const own = Boolean(sourceRow && view.rows.contains(sourceRow));
    const rows = view.rows.children as HTMLCollectionOf<HTMLElement>;
    let low = 0, high = rows.length - 1;
    let drop: { targetID: string; after: boolean } | undefined;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const rect = rows[middle].getBoundingClientRect();
      if (y < rect.top) high = middle - 1;
      else if (y >= rect.bottom) low = middle + 1;
      else {
        const target = rows[middle].dataset.id;
        if (target && target !== id) drop = { targetID: target, after: y >= rect.top + rect.height / 2 };
        break;
      }
    }
    return { ...(own ? {} : { group: key }), ...(drop ? { drop } : {}) };
  }
  return {};
}

/**
 * The plain list: among `visible` (the rows that keep a place of their own, in order), the first row whose bottom is
 * below the pointer — the last one past them all — before or after it. Found by halving (#167: every row's box from the
 * top was read on every move). Null over the dragged row itself (no move).
 */
function plainDrop(id: string, visible: readonly string[], y: number): { targetID: string; after: boolean } | null {
  let low = 0, high = visible.length - 1, found = visible.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const rect = todayRows.get(visible[middle])?.element.getBoundingClientRect();
    if (!rect) return null;
    if (y < rect.bottom) { found = middle; high = middle - 1; } else low = middle + 1;
  }
  const target = visible[found];
  const rect = target ? todayRows.get(target)?.element.getBoundingClientRect() : undefined;
  if (!target || target === id || !rect) return null;
  return { targetID: target, after: y >= rect.top + rect.height / 2 };
}

/** #167: the list a dragged row scrolls — the board's column under the pointer, else the sheet. */
function listUnder(x: number, y: number): HTMLElement {
  const column = lines.classList.contains("board") ? document.elementFromPoint(x, y)?.closest<HTMLElement>(".sgroup")?.querySelector<HTMLElement>(".sgroup-rows") : undefined;
  return column ?? sheet;
}

/**
 * #167: while a row is dragged, the list under it scrolls when the pointer is within 40 px of its top or bottom edge
 * (or past it) — faster the nearer the edge, up to 24 px a frame — and sideways near its left or right edge when it
 * scrolls that way. `moved` runs after each step (the drop place under the still pointer has changed).
 */
function edgeScroller(pointer: () => { x: number; y: number }, list: () => HTMLElement, moved: () => void): { stop(): void } {
  const edge = 40, fastest = 24;
  const step = (distance: number) => Math.round(4 + (fastest - 4) * (1 - Math.max(0, Math.min(distance, edge)) / edge));
  let frame = 0;
  const tick = () => {
    const { x, y } = pointer();
    const box = list();
    const rect = box.getBoundingClientRect();
    let dy = 0, dx = 0;
    if (box.scrollHeight > box.clientHeight + 1) dy = y < rect.top + edge ? -step(y - rect.top) : y > rect.bottom - edge ? step(rect.bottom - y) : 0;
    if (box.scrollWidth > box.clientWidth + 1 && y >= rect.top && y <= rect.bottom) dx = x < rect.left + edge ? -step(x - rect.left) : x > rect.right - edge ? step(rect.right - x) : 0;
    if (dy || dx) {
      const before = box.scrollTop + box.scrollLeft;
      box.scrollBy({ top: dy, left: dx, behavior: "instant" });
      if (box.scrollTop + box.scrollLeft !== before) moved();
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return { stop: () => cancelAnimationFrame(frame) };
}

/**
 * #167: a copy of the dragged row that follows the pointer (lifted a little, with a shadow), moved by a transform only;
 * the row itself stays where it was, faded, until the drop.
 */
function dragGhost(row: HTMLElement, badge?: string): { follow(dx: number, dy: number): void; remove(): void } {
  const rect = row.getBoundingClientRect();
  const ghost = row.cloneNode(true) as HTMLElement;
  // Nor the row animations (#181): a copy of a row still rising in, folding away or popping its box stays still.
  ghost.classList.remove("dragging", "selected", "drop-before", "drop-after", "appear", "leaving", "unfold-in", "pop", "animate", "flash");
  ghost.classList.add("drag-ghost");
  // As the row looks where it is: no band on a card's or a column's rows.
  if (lines.classList.contains("cards") || lines.classList.contains("board")) ghost.classList.add("no-band");
  ghost.removeAttribute("data-id");
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  // #168: how many rows go ("3개"), on the copy's top right corner.
  if (badge) ghost.append(h("span", { class: "drag-badge" }, badge));
  document.body.append(ghost);
  return {
    follow: (dx, dy) => { ghost.style.transform = `translate(${dx}px, ${dy}px) rotate(-1deg)`; },
    remove: () => ghost.remove(),
  };
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

let editor: { close(): void; refreshSpace?(): void } | undefined;
type EditorMode = "once" | "repeat" | "deadline" | "time";

function quickChoices(now = new Date()): { label: string; date: Date }[] {
  return [
    { label: minutesAway(10, lang()), date: new Date(now.getTime() + 10 * 60_000) },
    { label: minutesAway(30, lang()), date: new Date(now.getTime() + 30 * 60_000) },
    { label: t("1시간 뒤"), date: new Date(now.getTime() + 60 * 60_000) },
    // The same name as the reminder slip's 다시 알림 menu (#52): ‘내일 아침 9시’.
    { label: snoozeTitle("morning", lang()), date:new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0) },
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
  const summary = h("div", { class: "summary" }, icon("clock", 16), h("div", {}, h("div", { class: "hint" }, t("알림 시간")), summaryWhen, h("div", { class: "hint" }, t("앱이 켜져 있을 때 종이냥이 알려 줘요."))));
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
  // 할 일 스페이스 (1.30): the to-do's space, picked from a small menu (it moves at once, with its toast).
  const spaceField = hasSpaces() ? h("button", { class: "space-field", "aria-haspopup": "menu" }) : undefined;
  const drawSpaceField = () => {
    if (!spaceField) return;
    const space = spacesOf().get(id);
    const dot = h("span", { class: "space-dot" });
    dot.style.setProperty("--band", space ? bandStyle(space) : "var(--rule-strong)");
    spaceField.replaceChildren(h("span", { class: "space-field-name" }, t("스페이스", undefined, "field")), dot, h("span", { class: "space-field-value" }, space?.name ?? generalNow()), icon("chevron", 11, 2));
    spaceField.setAttribute("aria-label", t("스페이스: {name}", { name: space?.name ?? generalNow() }));
  };
  drawSpaceField();
  spaceField?.addEventListener("click", () => openMenu(menuHost, moveEntries(id).filter((entry) => !(entry.kind === "item" && entry.icon === "plus")), t("스페이스"), spaceField.getBoundingClientRect()));
  const body = h("div", { class: "body" },
    h("div", { class: "kicker" }, icon("bell", 12), rangeDayKey ? t("알림 · 반복 · 마감 · 시간") : t("알림 · 반복 · 마감")),
    h("div", { class: "task" }, item.title),
    spaceField,
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
        ? t("시작할 때 알려 줘요.")
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
  card.addEventListener("keydown", (event) => { if (event.key === "Escape" && !menuOpen()) close(); });
  (tabBar.querySelector('[aria-checked="true"]') as HTMLElement | null)?.focus();
  editor = { close, refreshSpace: drawSpaceField };
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render(): void {
  if (!state) return; // a command can arrive before the first state (it just picks the page)
  unseen = false;
  const root = document.documentElement;
  root.dataset.font = state.prefs.font;
  root.style.setProperty("--body-size", `${bodyFontSize(state.prefs.font, state.prefs.textStep)}px`);
  pinButton.classList.toggle("on", state.prefs.alwaysOnTop);
  pinButton.title = state.prefs.alwaysOnTop ? t("항상 위에 두기 해제") : t("항상 위에 두기");
  drawerButton.title = state.prefs.drawerShortcut ? `${t("메모 서랍")} (${shortcutLabel(state.prefs.drawerShortcut)})` : t("메모 서랍");
  renderHeader();
  editor?.refreshSpace?.();
  // The line's placeholder says where a to-do goes (회사에 적어요…), and its chips read `#` against the spaces now.
  // (A new page refreshes the line itself first, in setPage: one layout, not two.)
  const lineKey = `${lensNow() ?? ""}|${JSON.stringify(liveSpaces(state.todoSpaces).map((space) => [space.id, space.name, space.color]))}`;
  if (lineKey !== lineKeyDrawn) { lineKeyDrawn = lineKey; line.refresh(); }
  // 2b: the chips and the board are 오늘's (renderToday shows them while grouped).
  if (page !== "today") { chipsRow.hidden = true; sheet.classList.remove("board-mode"); }
  // `+ 회사에 넣기` belongs to the board: it goes with it.
  if (lineSpace !== undefined && (page !== "today" || !groupsOn())) { lineSpace = undefined; line.refresh(); }
  if (page === "today") renderToday();
  else renderAhead();
  focusCard.update(state);
  paintSelection();
  eventSheet?.refresh();
  playAdded();
  // Measured in the next frame, when the page is laid out anyway (measuring now would force a second layout).
  if (!fadePending) { fadePending = true; requestAnimationFrame(() => { fadePending = false; fadeEdges(); }); }
  // `npm run perf` reads when the first list was drawn.
  if (!performance.getEntriesByName("paper:first-render").length) performance.mark("paper:first-render");
}

let lineKeyDrawn = "";
let fadePending = false;
/** Soft fades at the top and bottom of the scrolling sheet while there is more beyond. */
function fadeEdges(): void {
  sheet.classList.toggle("fade-top", sheet.scrollTop > 2);
  sheet.classList.toggle("fade-bottom", sheet.scrollTop + sheet.clientHeight < sheet.scrollHeight - 2);
}
sheet.addEventListener("scroll", fadeEdges, { passive: true });
new ResizeObserver(fadeEdges).observe(sheet);

// ─── First-launch guide ─────────────────────────────────────────────────────

/** Five paper cards the cat walks you through; shown once, and again from ⋯ → 사용 안내. The last names the note's key as chosen (#85). */
const guideCards = (noteKey = shortcutLabel(state?.prefs.noteShortcut ?? defaultNoteShortcut)): { pose: string; title: string; body: string; keys: [string, string][]; login?: boolean }[] => [
  { pose: "happy", title: t("종이냥에 오신 걸 환영해요"), body: t("할 일과 일정을 종이 한 장에 적는\n노트예요. 적고, 체크하고, 끝!"), keys: [[t("입력 줄"), "Ctrl+N"], [t("완료"), t("네모 칸 누르기")], [t("어디서든 빠른 입력"), "Ctrl+Alt+N"]] },
  { pose: "curious", title: t("날짜에 맞춰 알아서 옮겨 가요"), body: t("마감이 있는 일은 ‘앞으로’에서 날짜별로 기다리다\n그날이 되면 오늘로 올라와요.\n날짜 없는 일은 맨 아래 ‘언젠가’, 생각은 ‘메모 서랍’에."), keys: [[t("오늘 · 앞으로"), "Ctrl+1–2"], [t("메모 서랍"), "Ctrl+Shift+D"], [t("내일 하기"), "Alt+→"]] },
  { pose: "stretch", title: t("아래 입력 줄에 무엇이든"), body: t("‘내일 3시 회의’, ‘30분 뒤 빨래’, ‘매일 물 마시기’처럼\n적으면 칩으로 알아들은 뜻을 보여 줘요.\nTab으로 다른 뜻, Enter로 넣기."), keys: [[t("다른 뜻"), "Tab"], [t("되돌리기"), "Ctrl+Z"], [t("검색"), "Ctrl+F"]] },
  { pose: "tea", title: t("종이냥과 집중"), body: t("할 일에서 F를 누르면 바로 집중을 시작해요.\n화면 아래의 종이냥은 저녁이 되면\n남은 일을 내일로 넘길지 물어봐요."), keys: [[t("이거 집중"), "F"], [t("설정"), "Ctrl+,"]] },
  { pose: "cheer", title: t("준비 끝!"), body: t("필요 없을 땐 작은 포스트잇으로 접어 둬요.\n어디서든 {key} 키로 다시 불러요.\n아래 스위치를 끄면 컴퓨터를 켤 때 열리지 않아요.", { key: noteKey }), keys: [[t("작게 접기"), "Ctrl+M"], [t("노트 보이기 · 숨기기"), noteKey]], login: true },
];
let guide: { close(): void } | undefined;

function openGuide(): void {
  const cards = guideCards();
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
    const current = cards[step];
    const last = step === cards.length - 1;
    art.src = `../../assets/pet/256/${current.pose}.png`;
    heading.textContent = current.title;
    text.textContent = current.body;
    keys.replaceChildren(...current.keys.map(([label, key]) => h("div", { class: "guide-key" }, h("span", {}, label), h("kbd", {}, key))));
    loginRow.hidden = !current.login;
    if (current.login && loginChoice === undefined) loginChoice = state.prefs.guideSeen ? state.prefs.openAtLogin : true;
    loginSwitch.setAttribute("aria-checked", String(Boolean(loginChoice)));
    dots.replaceChildren(...cards.map((_, index) => h("span", { class: index === step ? "on" : "" })));
    dots.setAttribute("aria-label", t("{total}장 중 {n}장", { total: cards.length, n: step + 1 }));
    skip.hidden = last;
    back.hidden = step === 0;
    // Enter presses it (onKey below): its keycap inside, like every slip's primary (the Mac's guide too).
    next.replaceChildren(h("span", {}, last ? t("시작하기") : t("다음")), keyCap("↩"));
    card.classList.remove("turn");
    void card.offsetWidth; // restart the little page-turn animation
    card.classList.add("turn");
    next.focus();
  };
  const go = (delta: number) => { step = Math.min(Math.max(step + delta, 0), cards.length - 1); show(); };
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
    else if (event.key === "ArrowRight" || event.key === "Enter") step === cards.length - 1 ? close() : go(1);
    else if (event.key === "ArrowLeft") go(-1);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };
  skip.addEventListener("click", close);
  back.addEventListener("click", () => go(-1));
  next.addEventListener("click", () => (step === cards.length - 1 ? close() : go(1)));
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
    hidden: (row) => {
      if (row.kind !== "today" && row.kind !== "ahead") return undefined;
      const { hidden } = deviceNow();
      return hidden.size && hidden.has(keyOf(row.id)) ? deviceWords.hiddenTag[lang()] : undefined;
    },
    spaceHint: hasSpaces() ? searchHint(liveSpaces(state.todoSpaces)[0].name, lang()) : undefined,
    open: (row) => {
      // #196: a to-do this PC hides opens 잠깐 보기 for its space.
      if ((row.kind === "today" || row.kind === "ahead") && deviceNow().onNote.has(keyOf(row.id))) {
        void api.act({ type: "spacePeek", spaces: [...new Set([...(state.devicePeek ?? []), keyOf(row.id)])] });
      }
      if (row.kind === "today" || row.kind === "ahead") showTask(row.id, true);
      // A memo: the 메모 서랍, on its folder with the memo open (M5).
      else if (row.kind === "memos") { searchSlip?.close(); openDrawer({ memo: row.id }); }
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
/**
 * #168: the note already had one picked row — `selectedID`, the keyboard's row (↑↓ · Space · Enter · Delete · Ctrl+↑↓ ·
 * Alt+→ act on it, a click picks it, Esc lets it go). This adds to that same pick rather than a second one: Ctrl-click
 * and Shift-click pick more, Shift+↑↓ grows the range, and `multi` holds them all while there are several. Picking a
 * row the plain way (select) leaves only that one.
 */
let multi = new Set<string>();
let anchorID: string | undefined;
function currentSelection(): ListSelection {
  const anchor = anchorID ?? selectedID;
  return { ...(anchor ? { anchor } : {}), ...(selectedID ? { focus: selectedID } : {}), ids: multi.size ? new Set(multi) : new Set(selectedID ? [selectedID] : []) };
}
function applySelection(selection: ListSelection, scroll = false): void {
  anchorID = selection.anchor;
  multi = selection.ids.size > 1 ? new Set(selection.ids) : new Set();
  selectedID = selection.ids.size ? selection.focus : undefined;
  if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
  paintSelection();
  if (selectedID && scroll) rowFor(selectedID)?.element.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
}
/** A click on a row: Ctrl adds or takes it away, Shift picks the range from the anchor, else that row alone. */
function clickRow(id: string, event: MouseEvent): void {
  const order = selectable();
  const selection = currentSelection();
  applySelection(event.ctrlKey || event.metaKey ? toggleSelection(selection, id, order) : event.shiftKey ? rangeSelection(selection, id, order) : oneSelected(id));
}
/** What a row's action moves: every picked row when it's one of them, else the row alone — in the list's order. */
function pickedRows(id: string): string[] {
  return multi.has(id) ? selectable().filter((entry) => multi.has(entry)) : [id];
}

/** The rows of the open page, top to bottom, as the keyboard walks them. */
function selectable(): string[] {
  if (!state) return [];
  if (page === "today" && groupsOn()) return todaySpaceGroups().flatMap(shownRows).map((item) => item.id);
  if (page === "today") { const { next, rest } = todayGroups(); return [...next, ...rest].map((item) => item.id); }
  if (page === "ahead") return [...aheadList.querySelectorAll<HTMLElement>(".row")].map((element) => element.dataset.id!).filter((id) => aheadRows.has(id));
  return [];
}


function select(id: string | undefined, scroll = true): void {
  selectedID = id;
  multi = new Set();
  anchorID = id;
  // A row's button keeps focus after a click; Space and Enter now belong to the selection.
  if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur();
  paintSelection();
  if (id && scroll) rowFor(id)?.element.scrollIntoView({ block: "nearest", behavior: reduceMotion() ? "auto" : "smooth" });
}

/** Soft sage tint and a bar on the margin line for the selected row; a row that left the page drops it. */
function paintSelection(): void {
  const rows = page === "today" ? todayRows : page === "ahead" ? aheadRows : undefined;
  if (selectedID && !rows?.has(selectedID)) selectedID = undefined;
  for (const id of multi) if (!rows?.has(id)) multi.delete(id);
  if (multi.size < 2) multi = new Set();
  for (const map of [todayRows, aheadRows]) for (const [id, row] of map) row.element.classList.toggle("selected", map === rows && (id === selectedID || multi.has(id)));
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
  if (!state || guide || editor || eventSheet || searchSlip || event.isComposing) return false;
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
      const rest = page === "ahead" ? zoneSiblings(selectedID) : page === "today" ? (groupsOn() ? reorderableInGroup(selectedID) : todayGroups().rest.map((item) => item.id)) : [];
      const target = rest.includes(selectedID) ? reorder(rest, selectedID, direction) : undefined;
      if (target) void api.act({ type: "move", id: selectedID, targetID: target.targetID, after: target.after });
      return handled();
    }
    // #168: Shift+↑↓ picks more rows (or fewer), from the anchor.
    if (event.shiftKey) { applySelection(extendSelection(currentSelection(), direction, ids), true); return handled(); }
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
  // A paper menu up: its own keys (drawerMenu.ts).
  if (menuOpen()) return;
  // Shift+F10 or the Menu key: the selected to-do's menu, under its row (as a right-click).
  if (((event.key === "F10" && event.shiftKey) || event.key === "ContextMenu") && selectedID && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
    event.preventDefault();
    void api.act({ type: "showRowMenu", id: selectedID, keyboard: true });
    return;
  }
  // W8: Ctrl+Shift+1–9 shows one space (in order), Ctrl+Shift+0 all of them (by the key's place, whatever the layout).
  if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && /^Digit[0-9]$/.test(event.code) && state && hasSpaces()) {
    // #196 (D7): the digits keep the spaces' order; a hidden space's does nothing.
    const lens = deviceLensForDigit(state.todoSpaces, Number(event.code.slice(5)), deviceNow().onNote);
    event.preventDefault();
    if (lens !== null) setLens(lens);
    return;
  }
  // 2b (S44): Ctrl+Alt+↑ · ↓ moves the selected to-do to the group above or below (nothing at the ends).
  if (event.ctrlKey && event.altKey && !event.shiftKey && !event.metaKey && (event.key === "ArrowUp" || event.key === "ArrowDown") && page === "today" && state && groupsOn() && selectedID
    && !(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)) {
    event.preventDefault();
    const key = neighborGroup(selectedID, event.key === "ArrowUp" ? -1 : 1, todaySpaceGroups());
    // #168 (S48): every picked row goes (to the group above or below the keyboard's row).
    if (key) void api.act({ type: "todoSpace", ids: pickedRows(selectedID), space: groupSpace(key) });
    return;
  }
  // 2b: Ctrl+Shift+G groups 오늘 by space (or not), by the key's place.
  if (event.ctrlKey && event.shiftKey && !event.altKey && !event.metaKey && event.code === "KeyG" && state && hasSpaces()) {
    event.preventDefault();
    toggleSpaceGroups();
    return;
  }
  if (picking && event.key === "Enter" && selectedID && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); pickTask(selectedID); return; }
  if (listKey(event)) return;
  const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
  if (!(event.ctrlKey || event.metaKey)) return;
  const key = event.key.toLowerCase();
  const act = (handled: () => unknown) => { event.preventDefault(); handled(); };
  if (key === "f" && !event.shiftKey && !event.altKey) return act(() => showSearch());
  if (key === "1") return act(() => setPage("today"));
  if (key === "2") return act(() => setPage("ahead"));
  // The memo tab's keys open the 메모 서랍 now (Ctrl+Shift+N at its quick-write slip).
  if (key === "3") return act(() => openDrawer());
  if (key === "n" && event.shiftKey) return act(() => openDrawer({ write: true }));
  if (key === "n") return act(focusNew);
  if (key === "m") return act(() => api.act({ type: "collapse" }));
  if (key === ",") return act(() => api.act({ type: "openSettings" }));
  if (key === "h") return act(() => api.act({ type: "openHistory" }));
  if (key === "d" && !event.shiftKey) return act(() => api.act({ type: "openCalendar" }));
  if (key === "e") return act(() => api.act({ type: "exportList" }));
  if (key === "c" && event.shiftKey) return act(() => api.act({ type: "copyList" }));
  if (key === "=" || key === "+" || key === "-") {
    // #141: one of the seven steps at a time.
    const step = state.prefs.textStep + (key === "-" ? -1 : 1);
    if (step >= 0 && step < noteScales.length) act(() => api.act({ type: "setPref", key: "textStep", value: step }));
    return;
  }
  if (typing) return; // text fields keep their own undo
  if (key === "z" && !event.shiftKey) return act(() => { if (!strip.undoMove()) void api.act({ type: "undo" }); });
  if (key === "y" || (key === "z" && event.shiftKey)) return act(() => api.act({ type: "redo" }));
});

// ─── Wiring ───────────────────────────────────────────────────────────────────

api.on("state", (next) => { state = next as TodosState; drawWhenSeen(); });
api.on("note:focus-new", focusNew);
api.on("note:event-sheet", (payload) => {
  catchUp();
  if (state) showEventSheet(payload as CalendarSheetRequest);
  else void api.getState().then((initial) => { state = initial; render(); showEventSheet(payload as CalendarSheetRequest); });
});
api.on("note:commit-editing", () => {
  commitEditing();
  // A line still being typed is put in as read (no toast: the note is going away).
  if (line.value.trim()) void line.submit();
});
// 빠른 입력 while the note is up: its toast (with the switch) shows here.
api.on("note:toast", (payload) => {
  const { made, candidates, index, text, space, hiddenIn } = payload as IntentToast;
  const readings = candidates.map(fromWire);
  if (readings[index]) showMade(flow, made, readings[index], readings, text, space, hiddenIn);
});
api.on("note:row-command", (payload) => {
  const { id, command } = payload as { id: string; command: string };
  catchUp();
  if (command === "edit") rowFor(id)?.beginEdit();
  if (command === "reminder") openEditor(id);
  if (command === "repeat") openEditor(id, "repeat");
  if (command === "deadline") openEditor(id, "deadline");
  if (command === "time") openEditor(id, "time");
  if (command === "close-editor") { editor?.close(); eventSheet?.close(); }
  // 마감 · 나중에 (older menus, snapshots) are 앞으로.
  if (command === "page-ahead" || command === "page-deadlines" || command === "page-shelf" || command === "page-later") setPage("ahead");
  // The memo tab is the 메모 서랍 now (older menus and commands).
  if (command === "page-memos") openDrawer();
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
/** Claude's toast (AI 연결) is the one up: Ctrl+Z goes to the main process, which takes Claude's entry back. */
let aiToastUp = false;
// Something done from a menu, the reminder bubble or the cat: its toast here, with 되돌리기.
api.on("note:notice", (payload) => {
  const notice = payload as NoteNotice;
  const undo = notice.undo === "history" ? () => api.act({ type: "undo" }) : notice.undo === "memo" ? () => api.act({ type: "memoRestore" }) : notice.undo === "unfile" ? () => api.act({ type: "unfileCompleted" })
    : notice.undo === "ai" && notice.entry ? () => api.act({ type: "aiUndo", id: notice.entry! })
    : notice.undo === "spaces" && notice.entry ? () => undoSpaceMove(notice.entry!) : undefined;
  // AI 연결's 자리 비운 사이: 보기 opens 설정 › AI 연결 (the recent list), and it stays a little longer.
  // 빠른 메모's: 열기 opens the 메모 서랍 on the memo just put in.
  const show = notice.show === "ai" ? () => api.act({ type: "openSettings", tab: "ai" }) : notice.show === "drawer" ? () => openDrawer(notice.entry ? { memo: notice.entry } : {}) : undefined;
  const action = undo ? { label: t("되돌리기"), run: () => void undo() } : show ? { label: notice.show === "drawer" ? t("열기", undefined, "drawer") : t("보기", undefined, "ai"), run: () => void show() } : undefined;
  toast.show({ icon: notice.icon, text: notice.text, ...(action ? { action } : {}), ...(notice.long ? { ms: 7000, twoLines: true } : {}), onHide: () => { aiToastUp = false; } });
  aiToastUp = notice.undo === "ai"; // after show: the toast it replaced has said its onHide
});

/** 되돌리기 after 스페이스로 옮기기: each to-do back in the space it was in (`entry`: [id, space | null][]). */
function undoSpaceMove(entry: string): void {
  let moves: [string, string | null][] = [];
  // 2b (J): a drop between another group's rows also puts the row back in its place in the list (`back`); #168: several
  // rows, each back after the row it followed (`previous`, the list's order before).
  let back: { id: string; targetID: string; after: boolean } | undefined;
  let previous: string[] | undefined;
  try {
    const read = JSON.parse(entry) as [string, string | null][] | { moves: [string, string | null][]; back?: typeof back; previous?: string[] };
    if (Array.isArray(read)) moves = read; else ({ moves, back, previous } = read);
  } catch { return; }
  if (back) void api.act({ type: "move", id: back.id, targetID: back.targetID, after: back.after });
  if (previous) void api.act({ type: "restoreOrder", ids: moves.map(([id]) => id), previous });
  const bySpace = new Map<string | null, string[]>();
  for (const [id, space] of moves) bySpace.set(space, [...(bySpace.get(space) ?? []), id]);
  for (const [space, ids] of bySpace) void api.act({ type: "todoSpace", ids, space });
}

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
