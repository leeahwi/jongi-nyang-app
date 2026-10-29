import { dayKey } from "../core/archive";
import type { CalendarEvent } from "../core/calendar";
import {
  awayText, clockText, columns, dayEndMinutes, dayMinutes, draggedSpan, edgeBand, followedSpan, hourHeight, isSoon, kicker, leftText, minutesUntil, newCandidates,
  nothingLeftText, nudged, rangeText, ringText, rowLimit, scrollTop, slot, stretched, stripItems, stripSentence, stripSpans, stripState, wholeDayLink,
  stripMarks, type DragEdge, type Span, type StripItem, type StripState } from "../core/dayStrip";
import { draftFromEvent } from "../core/events";
import { timerLeftText } from "../core/glance";
import { hasEventWord } from "../core/intent";
import { dayRibbon, hourLabel, type Ribbon } from "../core/ribbon";
import { focusMinutes, rangeOf, rangeText as taskRangeText } from "../core/timeRange";
import type { AppState } from "../core/types";
import { edgeFade, h, icon, lang, paper, reduceMotion, t } from "./api";
import { commitReading, type FlowHost } from "./intentFlow";

/**
 * 하루 띠 (1.25): a region on the paper under the 오늘 sheet's header, ruled above and below — no card. The top line
 * has the all-day events and `하루 전체 ›`; under it a thin bar of the whole day (events in their colours, to-dos with a
 * time in sage, the past a shade darker, now a short clay mark) with its hours; then what's on now in large with a ring
 * of the time left (or, with nothing on, the next thing and the time until it), and the next few as rows. Clicking
 * `하루 전체 ›`, the bar or the strip's empty space opens it in place into the day's timetable (하루 일정표): an hour
 * grid where to-dos and one-off events follow the pointer when dragged and land on the nearest quarter hour (1.26: a
 * dashed outline where it will land and the new time on the block; the top and bottom edges change the start or the
 * end), a click on empty space asks what to put there, and ↑ ↓ · Enter · Space · Alt+↑ ↓ · Shift+Alt+↑ ↓ · Esc work
 * the blocks. Drawn again only when what it shows changes — the note asks once a minute, on the minute, and on every
 * change of the data; nothing in it moves in between (the now mark is still), and nothing is drawn again while a
 * block is dragged. Same rules as the macOS app (DayStripView · DayTimetable).
 */

const api = paper();

export interface StripHost {
  state: () => AppState;
  /** Today's events (around the logical day) as occurrences. */
  occurrences: (now: Date) => CalendarEvent[];
  /** A task's row on its page, selected and flashed. */
  showTask: (id: string) => void;
  flow: FlowHost;
  /** The strip was opened or closed (the sheet's layout changes). */
  changed: () => void;
  /** The scrolling sheet's height: the open day fits in it whole. */
  room: () => number;
  /** Draw the note again (a drag has landed: what came in meanwhile shows now). */
  redraw: () => void;
}

const pct = (value: number) => `${(value * 100).toFixed(3)}%`;
const labelColumn = 36;
const pad = 8;
const gap = 4;
/** Room right of the last column, for a picked block's ring. */
const edge = 3;

export class DayStripView {
  readonly element = h("div", { class: "strip", role: "group" });
  private drawnKey = "";
  /** A block being dragged, or settling where it landed (nothing is drawn again until then). */
  private dragging = false;
  /** The timetable's picked block. */
  private selected?: string;
  /** A to-do being ticked from the strip: its box fills, then it's done. */
  private ticking?: string;
  /** The day was opened by a click here: its keys work at once. */
  private openedHere = false;
  private scroller?: HTMLElement;
  private popover?: { element: HTMLElement; close: () => void };
  private clickTimer?: number;
  private items: StripItem[] = [];
  /** The last move made here, while its toast is up: Ctrl+Z takes it back (an event's move isn't in the list's undo). */
  private lastMove?: () => void;
  private now = new Date();

  constructor(private readonly host: StripHost) {
    // The strip's empty space opens the whole day.
    this.element.addEventListener("click", (event) => {
      if (this.isOpen() || (event.target as HTMLElement).closest("button, .strip-hours")) return;
      this.setOpen(true);
    });
  }

  /** Snapshots set another moment (`window.ribbonNow`). */
  private moment(): Date {
    const forced = (window as { ribbonNow?: string }).ribbonNow;
    return forced ? new Date(forced) : new Date();
  }

  isOpen(now = this.now): boolean {
    return this.host.state().prefs.dayOpen === dayKey(now);
  }

  setOpen(open: boolean): void {
    this.openedHere = open;
    this.closePopover();
    const before = this.element.offsetHeight;
    void api.act({ type: "setPref", key: "dayOpen", value: open ? dayKey(this.now) : "" });
    // The height follows in the next state; it grows from where it was (instant under reduced motion).
    if (!reduceMotion() && this.element.isConnected) this.pendingHeight = before;
  }
  private pendingHeight?: number;

  /** #31: the to-dos the 지금 · 다음 block shows (stripMarks), for the list rows' small mark; none while closed or open. */
  marks = new Map<string, "now" | "next">();

  /** Fills the strip; false when it isn't shown (the setting is off, or nothing has a time today). */
  render(): boolean {
    const state = this.host.state();
    if (!state.prefs.calendarStrip) { this.drawnKey = ""; this.marks = new Map(); return false; }
    if (this.dragging && this.element.childElementCount > 0) return true;
    const now = this.moment();
    this.now = now;
    const events = this.host.occurrences(now);
    const ribbon = dayRibbon(events, state.items, now, lang());
    if (!ribbon) { this.drawnKey = ""; this.marks = new Map(); this.closePopover(); return false; }
    const items = stripItems(events, state.items, now);
    this.items = items;
    const narrow = window.innerWidth <= 400;
    const compact = window.innerHeight < 470;
    const open = this.isOpen(now);
    const strip = stripState(items, now, rowLimit(window.innerWidth, window.innerHeight));
    this.marks = open ? new Map() : stripMarks(strip);
    const focusing = state.focus?.taskId && state.timer ? state.focus.taskId : undefined;
    const key = JSON.stringify([lang(), open, narrow, compact, open ? window.innerHeight : 0, ribbon.startHour, ribbon.endHour, ribbon.now, ribbon.hours, ribbon.bars, ribbon.blocks, ribbon.allDay, ribbon.more,
      strip.mode, strip.minutes, strip.lead && [strip.lead.id, strip.lead.title, strip.lead.start, strip.lead.end, strip.lead.event?.location], strip.rows.map((row) => [row.id, row.title, row.start, minutesUntil(now, row.start)]),
      open ? items.map((item) => [item.id, item.title, item.start, item.end, item.done, item.event?.location, item.event?.color]) : 0, focusing, this.ticking, state.prefs.font, state.ai?.marks]);
    if (key === this.drawnKey && this.element.childElementCount > 0) return true;
    this.drawnKey = key;
    const keepScroll = open && this.scroller?.isConnected ? this.scroller.scrollTop : undefined;
    // Drawn again while it has the keys (a change of the data): the new timetable takes them back.
    const hadKeys = open && this.scroller !== undefined && document.activeElement === this.scroller;
    if (hadKeys) this.openedHere = true;
    this.element.classList.toggle("open", open);
    if (open) {
      this.element.setAttribute("aria-label", t("오늘 하루"));
      this.element.replaceChildren(this.top(ribbon, narrow, true), this.timetable(ribbon, items, now, keepScroll));
      // Drawn again in place (after a drag, a change of the data): where it was scrolled, before anything is painted.
      if (keepScroll !== undefined && this.scroller?.isConnected) this.scroller.scrollTop = keepScroll;
    } else {
      this.scroller = undefined;
      this.selected = undefined;
      this.closePopover();
      this.element.setAttribute("aria-label", stripSentence(strip, lang()));
      // No all-day event (1.30): 하루 전체 › sits at the bar's right end instead of taking a line of its own; the bar and
      // its hours stop short of it (the Mac's DayStripView too).
      const head = ribbon.allDay.length === 0
        ? [h("div", { class: "strip-barline" }, h("div", { class: "strip-barcol" }, this.bar(ribbon), compact ? null : this.hours(ribbon)), this.wholeDayLink(narrow))]
        : [this.top(ribbon, narrow, false), this.bar(ribbon), compact ? null : this.hours(ribbon)];
      this.element.replaceChildren(...[
        ...head, this.lead(strip, now), strip.rows.length ? this.rows(strip.rows, now) : null,
      ].filter((child): child is HTMLElement => Boolean(child)));
    }
    this.animateHeight();
    return true;
  }

  /** Grows or shrinks from the height it had before it opened or closed. */
  private animateHeight(): void {
    const from = this.pendingHeight;
    this.pendingHeight = undefined;
    if (from === undefined || !this.element.isConnected) return;
    requestAnimationFrame(() => {
      const to = this.element.offsetHeight;
      if (Math.abs(to - from) < 2) return;
      this.element.style.height = `${from}px`;
      this.element.style.overflow = "hidden";
      void this.element.offsetHeight;
      this.element.classList.add("growing");
      this.element.style.height = `${to}px`;
      const done = () => {
        this.element.classList.remove("growing");
        this.element.style.height = "";
        this.element.style.overflow = "";
        this.host.changed();
      };
      this.element.addEventListener("transitionend", done, { once: true });
      setTimeout(done, 320);
    });
  }

  // ─── The top line ────────────────────────────────────────────────────────

  private top(ribbon: Ribbon, narrow: boolean, open: boolean): HTMLElement {
    const limit = narrow ? 1 : 2;
    const shown = ribbon.allDay.slice(0, limit);
    const more = ribbon.more + ribbon.allDay.length - shown.length;
    const pills = h("div", { class: "strip-allday" }, ...shown.map((pill) => {
      const element = h("button", { class: "ad-pill", title: `${t("종일")} · ${pill.title}` }, h("i", { class: "evc", "aria-hidden": "true" }), h("span", {}, `${t("종일")} · ${pill.title}`));
      (element.firstChild as HTMLElement).style.background = pill.color;
      element.addEventListener("click", (event) => { event.stopPropagation(); void api.act({ type: "calendarEditEvent", key: pill.key }); });
      return element;
    }), more > 0 ? h("span", { class: "ad-more" }, `+${more}`) : null);
    // Two pills only when both fit whole; else the first and "+N" (as on the Mac — Dutch "Hele dag · …" titles are long).
    if (shown.length > 1) requestAnimationFrame(() => {
      const elements = [...pills.querySelectorAll<HTMLElement>(".ad-pill span")];
      if (!pills.isConnected || !elements.some((span) => span.scrollWidth > span.clientWidth + 0.5)) return;
      pills.querySelectorAll(".ad-pill")[1]?.remove();
      let counter = pills.querySelector<HTMLElement>(".ad-more");
      if (!counter) { counter = h("span", { class: "ad-more" }); pills.append(counter); }
      counter.textContent = `+${more + 1}`;
    });
    if (!open) return h("div", { class: "strip-top" }, pills, h("span", { class: "spacer" }), this.wholeDayLink(narrow));
    const title = h("button", { class: "tt-title", title: t("접기 (Esc)") }, t("오늘 하루"));
    title.addEventListener("click", (event) => { event.stopPropagation(); this.setOpen(false); });
    const fold = h("button", { class: "strip-link fold", title: t("접기 (Esc)"), "aria-label": t("하루 일정표 접기"), "aria-expanded": "true" }, t("접기", undefined, "strip"), icon("chevron", 10, 2.2));
    fold.addEventListener("click", (event) => { event.stopPropagation(); this.setOpen(false); });
    return h("div", { class: "strip-top" }, title, pills, h("span", { class: "spacer" }), fold);
  }

  /** 하루 전체 › (narrow: 전체 ›). */
  private wholeDayLink(narrow: boolean): HTMLElement {
    const link = h("button", { class: "strip-link", title: t("하루 전체 보기"), "aria-label": t("하루 전체 보기") }, wholeDayLink(narrow, lang()));
    link.addEventListener("click", (event) => { event.stopPropagation(); this.setOpen(true); });
    return link;
  }

  // ─── The day bar ──────────────────────────────────────────────────────────

  private bar(ribbon: Ribbon): HTMLElement {
    const track = h("span", { class: "sb-track" }, h("span", { class: "sb-past" }));
    (track.firstChild as HTMLElement).style.width = pct(ribbon.now);
    const segment = (from: number, to: number) => {
      const element = h("i", {});
      element.style.left = pct(from);
      element.style.width = `max(3px, ${pct(Math.max(0, to - from))})`;
      return element;
    };
    for (const bar of ribbon.bars) {
      const element = segment(bar.from, bar.to);
      element.className = `evc${bar.past ? " past" : ""}`;
      element.style.background = bar.color;
      track.append(element);
    }
    for (const block of ribbon.blocks) {
      const element = segment(block.from, block.to);
      element.className = `task${block.done ? " done" : ""}`;
      track.append(element);
    }
    const mark = h("span", { class: "sb-now" });
    mark.style.left = `clamp(0px, calc(${pct(ribbon.now)} - 1px), calc(100% - 2px))`;
    const button = h("button", { class: "strip-bar", title: t("하루 전체 보기"), "aria-label": t("하루 전체 보기") }, track, mark);
    button.addEventListener("click", (event) => { event.stopPropagation(); this.setOpen(true); });
    return button;
  }

  private hours(ribbon: Ribbon): HTMLElement {
    return h("div", { class: "strip-hours", "aria-hidden": "true" }, ...ribbon.hours.map((hour, index) => {
      const label = h("span", { class: index === 0 ? "first" : index === ribbon.hours.length - 1 ? "last" : "mid" }, hour.text);
      label.style.left = pct(hour.at);
      return label;
    }));
  }

  // ─── Now (or next) ───────────────────────────────────────────────────────

  private lead(strip: StripState, now: Date): HTMLElement {
    const item = strip.lead;
    if (!item) return h("div", { class: "strip-nothing" }, nothingLeftText(lang()));
    const text = ringText(strip.minutes, strip.mode, lang());
    const soon = strip.mode === "next" && isSoon(strip.minutes);
    const focusable = strip.mode === "now" && item.kind === "task";
    const said = strip.mode === "now" ? leftText(strip.minutes, lang()) : awayText(strip.minutes, lang());
    // The ring: its arc on a track around a paper centre, the number and its small word inside.
    const radius = 23.5, length = 2 * Math.PI * radius;
    const ring = h("button", { class: `strip-ring ${strip.mode}${soon ? " soon" : ""}`, title: focusable ? t("눌러서 집중 시작") : this.tooltip(item), "aria-label": `${item.title}, ${said}` });
    ring.innerHTML = `<svg viewBox="0 0 52 52" aria-hidden="true"><circle class="rc-face" cx="26" cy="26" r="24"/><circle class="rc-track" cx="26" cy="26" r="${radius}"/>${strip.progress > 0
      ? `<circle class="rc-arc" cx="26" cy="26" r="${radius}" stroke-dasharray="${(length * Math.min(1, strip.progress)).toFixed(2)} ${length.toFixed(2)}" transform="rotate(-90 26 26)"/>` : ""}</svg>`;
    const caption = h("small", {}, text.caption);
    const value = h("b", {}, text.value);
    ring.append(h("span", { class: "rc-text", "aria-hidden": "true" }, value, caption));
    ring.addEventListener("click", (event) => {
      event.stopPropagation();
      if (focusable && item.taskId) this.focus(item.taskId);
      else this.open(item);
    });
    ring.addEventListener("contextmenu", (event) => this.menu(event, item));
    const kick = h("div", { class: "lead-kicker" }, kicker(strip.mode, item, lang()));
    const title = h("button", { class: "lead-title", title: this.tooltip(item), "aria-label": item.title }, item.title);
    title.addEventListener("click", (event) => { event.stopPropagation(); this.open(item); });
    title.addEventListener("contextmenu", (event) => this.menu(event, item));
    // The box only for a to-do going on now (tick it and the strip moves on).
    const titleRow = h("div", { class: "lead-row" }, strip.mode === "now" && item.kind === "task" && item.taskId ? this.checkbox(item.taskId) : null, title, this.stamp(item));
    const column = h("div", { class: "lead-text" }, kick, titleRow, this.subLine(item, now));
    // The full kicker when it fits, else the short one ("지금 · ~14:00"); the caption a little smaller when it's long.
    requestAnimationFrame(() => {
      if (kick.isConnected && kick.scrollWidth > kick.clientWidth + 0.5) kick.textContent = kicker(strip.mode, item, lang(), true);
      // As on the Mac (StripRing.captionFit): 8.5 px on one line, else 7.5 px, else two short lines at 8 px ("20 min te gaan").
      // "1시간" · "12 h" fit at 13 px; "23시간" a little smaller (the Mac's minimumScaleFactor 0.8).
      if (value.isConnected && value.getBoundingClientRect().width > 40) value.style.fontSize = "10.5px";
      const over = () => caption.scrollWidth > caption.clientWidth + 0.5;
      if (caption.isConnected && over()) caption.style.fontSize = "7.5px";
      if (caption.isConnected && over()) { caption.style.fontSize = ""; caption.classList.add("two"); }
    });
    return h("div", { class: "strip-lead" }, ring, column);
  }

  private subLine(item: StripItem, now: Date): HTMLElement | null {
    const state = this.host.state();
    const focusing = item.taskId && state.focus?.taskId === item.taskId && state.timer;
    if (item.kind === "event") return item.event?.location ? h("div", { class: "lead-sub" }, item.event.location) : null;
    if (focusing && state.timer) {
      const left = state.timer.endsAt !== undefined ? state.timer.endsAt - now.getTime() : state.timer.pausedRemainingMs ?? 0;
      // #46: "집중 중 · 21분 남음", a length (not "12:30" under the kicker's clock times).
      return h("div", { class: "lead-sub" }, `${t("집중 중")} · ${timerLeftText(left, lang())}`);
    }
    return h("div", { class: "lead-sub" }, t("할 일", undefined, "strip"), item.hasReminder ? icon("bell", 10, 2) : null);
  }

  /** The current to-do's box: ticked, it fills, and a moment later the to-do is done (the strip moves on). */
  private checkbox(id: string): HTMLElement {
    const box = h("button", { class: `lead-check${this.ticking === id ? " ticked" : ""}`, title: t("완료 표시"), "aria-label": t("완료 표시") }, h("span", { class: "lc-box" }, icon("check", 10, 3)));
    box.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.ticking) return;
      this.ticking = id;
      box.classList.add("ticked");
      setTimeout(() => { void api.act({ type: "toggle", id }); this.ticking = undefined; }, reduceMotion() ? 0 : 450);
    });
    return box;
  }

  // ─── Next rows ───────────────────────────────────────────────────────────

  private rows(rows: StripItem[], now: Date): HTMLElement {
    return h("div", { class: "strip-rows" }, ...rows.map((item) => {
      const minutes = minutesUntil(now, item.start);
      const time = clockText(item.start, lang());
      const away = awayText(minutes, lang());
      const row = h("button", { class: `strip-row ${item.kind}`, title: this.tooltip(item), "aria-label": `${time} ${item.title}, ${away}` },
        h("span", { class: "sr-time" }, time), this.mark(item), h("span", { class: "sr-title" }, item.title), this.stamp(item), h("span", { class: `sr-away${isSoon(minutes) ? " soon" : ""}` }, away));
      row.addEventListener("click", (event) => { event.stopPropagation(); this.open(item); });
      row.addEventListener("contextmenu", (event) => this.menu(event, item));
      return row;
    }));
  }

  /** AI 연결: "Claude" after the title of an event or a to-do Claude added or changed today. */
  private stamp(item: StripItem): HTMLElement | null {
    const id = item.event?.eventId ?? item.taskId?.toUpperCase();
    if (!id || !this.host.state().ai?.marks.includes(id)) return null;
    return h("span", { class: "ai-stamp", title: t("Claude가 오늘 넣거나 고쳤어요"), role: "img", "aria-label": t("Claude가 오늘 넣거나 고쳤어요") }, "Claude");
  }

  /** A row's kind: an event's dot in its colour, a to-do's sage square, a reminder's ink3 ring. */
  private mark(item: StripItem): HTMLElement {
    const mark = h("i", { class: `sr-mark ${item.kind}${item.kind === "event" ? " evc" : ""}`, "aria-hidden": "true" });
    if (item.event) mark.style.background = item.event.color;
    return mark;
  }

  // ─── Actions ─────────────────────────────────────────────────────────────

  private open(item: StripItem): void {
    if (item.event) void api.act({ type: "calendarEditEvent", key: item.event.key });
    else if (item.taskId) this.host.showTask(item.taskId);
  }

  private menu(event: MouseEvent, item: StripItem): void {
    event.preventDefault();
    event.stopPropagation();
    if (item.event) void api.act({ type: "showEventMenu", key: item.event.key, x: event.clientX, y: event.clientY });
    else if (item.taskId) void api.act({ type: "showRowMenu", id: item.taskId, x: event.clientX, y: event.clientY });
  }

  private focus(id: string): void {
    const task = this.host.state().items.find((entry) => entry.id === id);
    if (!task) return;
    const minutes = focusMinutes(task, new Date());
    void api.act({ type: "focus", command: { kind: "start", taskId: id, ...(minutes ? { minutes } : {}) } });
  }

  private tooltip(item: StripItem): string {
    if (item.event) {
      return [item.title, item.end ? rangeText(item.start, item.end, lang()) : clockText(item.start, lang()), item.event.location].filter(Boolean).join(" · ");
    }
    return `${item.title} · ${item.end ? rangeText(item.start, item.end, lang()) : clockText(item.start, lang())}`;
  }

  // ─── The whole day (하루 일정표) ───────────────────────────────────────────

  private timetable(ribbon: Ribbon, items: StripItem[], now: Date, keepScroll?: number): HTMLElement {
    const first = ribbon.startHour * 60;
    const y = (minutes: number) => pad + ((minutes - first) / 60) * hourHeight;
    const content = (ribbon.endHour - ribbon.startHour) * hourHeight + pad * 2;
    // 55% of the note (at least 260), but never taller than the sheet has room for: the day's top line and its last
    // hour stay in view together, so a short note never scrolls the strip itself away (Windows; the Mac's list sits below).
    const viewport = Math.max(140, Math.min(content, Math.max(260, window.innerHeight * 0.55), this.host.room() - 58));
    const spans = stripSpans(items, now);
    const { placed, more } = columns(spans);
    // A crowded group's blocks leave room on the right for its "+N".
    const crowded = new Set(more.map((group) => group.group));
    const byId = new Map(items.map((item) => [item.id, item]));
    const spanById = new Map(spans.map((entry) => [entry.id, entry]));
    const grid = h("div", { class: "tt-grid", title: t("빈 곳을 누르면 그 시간에 새 할 일 · 일정") });
    grid.style.height = `${content}px`;
    for (let hour = ribbon.startHour; hour <= ribbon.endHour; hour += 1) {
      const line = h("div", { class: "tt-hour", "aria-hidden": "true" }, h("span", {}, hourLabel(hour, lang())));
      line.style.top = `${y(hour * 60)}px`;
      grid.append(line);
    }
    // The empty space: a click asks what to put there, a double click opens a new event.
    grid.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest(".tt-block, .tt-more")) return;
      event.stopPropagation();
      const minutes = this.slotAt(event, grid, ribbon);
      clearTimeout(this.clickTimer);
      this.clickTimer = window.setTimeout(() => this.newItem(minutes, grid, y(minutes)), 240);
    });
    grid.addEventListener("dblclick", (event) => {
      if ((event.target as HTMLElement).closest(".tt-block, .tt-more")) return;
      event.stopPropagation();
      clearTimeout(this.clickTimer);
      this.closePopover();
      const minutes = this.slotAt(event, grid, ribbon);
      const start = this.dateAt(minutes);
      void api.act({ type: "calendarNewEvent", at: { day: dateKey(start), minutes: minutes % 1440 } });
    });
    const order: { id: string; start: number; column: number }[] = [];
    for (const place of placed) {
      if (place.hidden) continue;
      const item = byId.get(place.id), entry = spanById.get(place.id);
      if (!item || !entry) continue;
      order.push({ id: item.id, start: entry.start, column: place.column });
      grid.append(this.block(item, entry, place.column, place.columns, y, ribbon, crowded.has(place.group) ? 30 : 0));
    }
    for (const group of more) {
      const chip = h("button", { class: "tt-more", title: t("겹친 일 {n}개 더", { n: group.ids.length }) }, `+${group.ids.length}`);
      chip.style.top = `${y(group.start) + 1}px`;
      chip.addEventListener("click", (event) => { event.stopPropagation(); this.moreList(chip, group.ids.map((id) => byId.get(id)).filter((entry): entry is StripItem => Boolean(entry))); });
      grid.append(chip);
    }
    const nowMinutes = dayMinutes(now, now);
    if (nowMinutes >= first && nowMinutes <= ribbon.endHour * 60) {
      const line = h("div", { class: "tt-now", "aria-hidden": "true" });
      line.style.top = `${y(nowMinutes) - 1}px`;
      grid.append(line);
    }
    order.sort((a, b) => a.start - b.start || a.column - b.column);
    const scroller = h("div", { class: "tt-scroll", tabindex: "0", role: "list", "aria-label": t("오늘 하루") }, grid);
    scroller.style.height = `${viewport}px`;
    scroller.addEventListener("keydown", (event) => this.key(event, order.map((entry) => entry.id), spans, ribbon));
    // The little line and the +N list belong to where they were opened: scrolling the day closes them.
    scroller.addEventListener("scroll", () => this.closePopover(), { passive: true });
    this.scroller = scroller;
    requestAnimationFrame(() => {
      scroller.scrollTop = keepScroll ?? scrollTop(now, ribbon.startHour);
      edgeFade(scroller);
      if (this.openedHere) { this.openedHere = false; scroller.focus({ preventScroll: true }); }
      this.paintSelection();
    });
    return scroller;
  }

  private slotAt(event: MouseEvent, grid: HTMLElement, ribbon: Ribbon): number {
    return slot(event.clientY - grid.getBoundingClientRect().top - pad, ribbon.startHour, ribbon.endHour);
  }

  /** The moment of a logical minute of today. */
  private dateAt(minutes: number): Date {
    const start = new Date(this.now);
    const midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    // (now's calendar day may be the night after: go back to the logical day's midnight.)
    const logical = dayMinutes(this.now, this.now);
    const base = new Date(midnight.getTime() - (logical >= 1440 ? 86_400_000 : 0));
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), Math.floor(minutes / 60), minutes % 60);
  }

  private block(item: StripItem, entry: Span, column: number, count: number, y: (minutes: number) => number, ribbon: Ribbon, reserve = 0): HTMLElement {
    const element = h("div", { class: `tt-block ${item.kind}`, role: "listitem", "data-id": item.id });
    const place = (start: number, end: number, target: HTMLElement = element) => {
      target.style.top = `${y(start) + 1}px`;
      target.style.height = `${item.kind === "reminder" ? 20 : Math.max(18, y(end) - y(start) - 2)}px`;
    };
    // Columns: a share of the width right of the hours, with a small gap between (and room on the right for a picked one's ring).
    const share = `(100% - ${labelColumn + edge + reserve}px - ${gap * (count - 1)}px) / ${count}`;
    element.style.left = `calc(${labelColumn}px + ${share} * ${column} + ${gap * column}px)`;
    // A reminder is a small pill as wide as its words (at most its column).
    if (item.kind === "reminder") { element.style.maxWidth = `calc(${share})`; element.style.width = "fit-content"; } else element.style.width = `calc(${share})`;
    place(entry.start, entry.end);
    const height = item.kind === "reminder" ? 20 : Math.max(18, y(entry.end) - y(entry.start) - 2);
    const over = item.end ? item.end.getTime() <= this.now.getTime() : false;
    if (item.kind === "event" && item.event) {
      const event = item.event;
      const tall = height >= 32;
      // Tall: the range and the place under the title; short: the range beside it.
      const said = (range: string) => (tall ? [range, event.location].filter(Boolean).join(" · ") : range);
      const detail = [rangeText(item.start, item.end ?? item.start, lang()), event.location].filter(Boolean).join(" · ");
      const time = h("span", { class: "tb-time" }, said(rangeText(item.start, item.end ?? item.start, lang())));
      if (over) element.classList.add("over");
      element.style.setProperty("--ev", event.color);
      element.classList.toggle("tall", tall);
      element.append(h("span", { class: "tb-title" }, item.title), time);
      time.dataset.place = tall ? event.location ?? "" : "";
      element.title = this.tooltip(item);
      element.setAttribute("aria-label", `${item.title}, ${detail}`);
      const movable = this.movable(item);
      if (movable) {
        element.classList.add("movable");
        this.edges(element, height);
        element.setAttribute("aria-keyshortcuts", "Shift+Alt+ArrowDown Shift+Alt+ArrowUp");
        element.setAttribute("aria-description", `${t("끝 15분 늘리기")} (Shift+Alt+↓) · ${t("끝 15분 줄이기")} (Shift+Alt+↑)`);
      }
      this.press(element, item, entry, ribbon, movable, place);
      element.addEventListener("contextmenu", (contextEvent) => this.menu(contextEvent, item));
    } else if (item.kind === "task") {
      const overdue = !item.done && over;
      element.classList.toggle("done", item.done);
      element.classList.toggle("late", overdue);
      element.classList.toggle("tall", height >= 40);
      const range = rangeOf(this.host.state().items.find((entry) => entry.id === item.taskId) ?? { timeStart: undefined });
      const timeText = (start: number, end: number) => taskRangeText({ start: start % 1440, end: end % 1440 }, lang());
      const time = h("span", { class: "tb-time" }, timeText(entry.start, entry.end));
      const box = h("button", { class: "tb-check", title: item.done ? t("완료 취소") : t("완료 표시"), "aria-label": item.done ? t("완료 취소") : t("완료 표시") }, h("span", { class: "tbc" }, item.done ? icon("check", 8, 3) : null));
      box.addEventListener("click", (clickEvent) => { clickEvent.stopPropagation(); if (item.taskId) void api.act({ type: "toggle", id: item.taskId }); });
      box.addEventListener("pointerdown", (pointerEvent) => pointerEvent.stopPropagation());
      const title = h("span", { class: "tb-hand" }, item.title);
      element.append(box, height >= 40 ? h("span", { class: "tb-col" }, title, time) : title);
      if (height < 40) element.append(time);
      // A one-line block shows its time only when there's room (wider than 150 px).
      if (height < 40) requestAnimationFrame(() => time.classList.toggle("hidden", element.clientWidth <= 150));
      element.title = `${item.title} · ${time.textContent}`;
      element.setAttribute("aria-label", `${item.title}, ${time.textContent}${item.done ? `, ${t("완료됨")}` : overdue ? `, ${t("시간 지남")}` : ""}`);
      if (!item.done) {
        this.edges(element, height);
        // What the keys do with the picked block (the timetable has the keys).
        element.setAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown Shift+Alt+ArrowDown Shift+Alt+ArrowUp");
        element.setAttribute("aria-description", `${t("15분 옮기기")} (Alt+↑ ↓) · ${t("끝 15분 늘리기")} (Shift+Alt+↓) · ${t("끝 15분 줄이기")} (Shift+Alt+↑)`);
      }
      this.press(element, item, entry, ribbon, !item.done, place, range?.end === undefined);
      element.addEventListener("contextmenu", (contextEvent) => this.menu(contextEvent, item));
    } else {
      element.append(h("i", { class: "tb-ring", "aria-hidden": "true" }), h("span", { class: "tb-title" }, item.title), h("span", { class: "tb-time" }, clockText(item.start, lang())));
      element.title = this.tooltip(item);
      element.setAttribute("aria-label", `${t("알림", undefined, "row")}: ${item.title}, ${clockText(item.start, lang())}`);
      this.press(element, item, entry, ribbon, false, place);
      element.addEventListener("contextmenu", (contextEvent) => this.menu(contextEvent, item));
    }
    return element;
  }

  /** A one-off event of the app's own calendar, not all day: it can be moved and stretched here. */
  private movable(item: StripItem): boolean {
    const event = item.event;
    if (!event || !event.canEdit || event.recurring) return false;
    const local = this.host.state().events?.find((entry) => entry.id === event.eventId);
    return Boolean(local && local.repeat === "none" && !local.allDay);
  }

  /**
   * The bands at a block's top and bottom (6 px, less on a short one; none under 20 px): hovered, the resize pointer
   * and a small grab bar; pressed and dragged, the start or the end follows (see `press`).
   */
  private edges(element: HTMLElement, height: number): void {
    const band = edgeBand(height);
    if (band <= 0) return;
    for (const edge of ["start", "end"] as const) {
      const handle = h("span", { class: `tb-edge ${edge}`, "data-edge": edge, "aria-hidden": "true", title: edge === "start" ? t("끌어서 시작 시간 바꾸기") : t("끌어서 끝 시간 바꾸기") });
      handle.style.height = `${band}px`;
      element.append(handle);
    }
  }

  /**
   * A press on a block: a click picks it and opens it; on a movable one a drag (3 px or more) moves it, or — pressed
   * on its top or bottom band — its start or its end. While the button is down the block follows the pointer exactly:
   * measured in the grid's own space (so the block's movement never feeds back into it), its column and width kept,
   * nothing else in the timetable drawn again, the model untouched. A dashed outline shows where it will land and a
   * small label the new time, a quarter hour at a time; near the timetable's top or bottom it scrolls. Let go, it
   * settles onto the outline (120 ms, at once under reduced motion) and the change is written; Esc puts it back.
   * `startOnly`: a to-do with a start alone stays one when moved whole (an edge gives it its drawn end).
   */
  private press(element: HTMLElement, item: StripItem, entry: Span, ribbon: Ribbon, movable: boolean,
    place: (start: number, end: number, target?: HTMLElement) => void, startOnly = false): void {
    element.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.stopPropagation();
      this.closePopover();
      const grid = element.parentElement, scroller = this.scroller;
      const handle = (event.target as HTMLElement).closest<HTMLElement>(".tb-edge");
      const edge: DragEdge | undefined = movable ? (handle?.dataset.edge as DragEdge | undefined) ?? "whole" : undefined;
      const gridY = (clientY: number) => clientY - (grid?.getBoundingClientRect().top ?? 0);
      const from = gridY(event.clientY);
      let pointerY = event.clientY;
      let drag: { ghost: HTMLElement; label: HTMLElement; landing: { start: number; end: number }; frame?: number } | undefined;
      try { element.setPointerCapture(event.pointerId); } catch { /* not a live pointer */ }
      const label = (to: { start: number; end: number }) => item.kind === "event"
        ? rangeText(this.dateAt(to.start), this.dateAt(to.end), lang())
        : taskRangeText({ start: to.start % 1440, end: to.end % 1440 }, lang());
      const follow = () => {
        if (!drag || !edge) return;
        const pixels = gridY(pointerY) - from;
        const shown = followedSpan(entry.start, entry.end, edge, pixels, ribbon.startHour, ribbon.endHour, item.kind);
        place(shown.start, shown.end);
        const landing = draggedSpan(entry.start, entry.end, edge, pixels, ribbon.startHour, ribbon.endHour, item.kind);
        if (landing.start === drag.landing.start && landing.end === drag.landing.end) return;
        drag.landing = landing;
        place(landing.start, landing.end, drag.ghost);
        drag.label.textContent = label(landing);
      };
      // Near the timetable's top or bottom edge (24 px) or past it, it scrolls, faster the deeper; it stops where it can't go on.
      const speed = () => {
        if (!scroller) return 0;
        const box = scroller.getBoundingClientRect(), zone = 24;
        if (pointerY < box.top + zone) return -Math.min(1, (box.top + zone - pointerY) / zone);
        if (pointerY > box.bottom - zone) return Math.min(1, (pointerY - box.bottom + zone) / zone);
        return 0;
      };
      const scroll = () => {
        if (!drag || !scroller) return;
        drag.frame = undefined;
        const step = speed();
        if (step === 0) return;
        const before = scroller.scrollTop;
        scroller.scrollTop = before + step * 10;
        if (scroller.scrollTop === before) return;
        follow();
        drag.frame = requestAnimationFrame(scroll);
      };
      const begin = () => {
        this.dragging = true;
        element.classList.add("dragging", edge === "whole" ? "moving" : "resizing");
        handle?.classList.add("active");
        const ghost = h("div", { class: `tt-ghost ${item.kind}`, "aria-hidden": "true" });
        ghost.style.left = element.style.left;
        ghost.style.width = element.style.width;
        if (item.event) ghost.style.setProperty("--ev", item.event.color);
        const tag = h("span", { class: `tb-drag${edge === "end" ? " low" : ""}`, "aria-hidden": "true" });
        element.append(tag);
        element.before(ghost);
        drag = { ghost, label: tag, landing: { start: Number.NaN, end: Number.NaN } };
      };
      const move = (moveEvent: PointerEvent) => {
        pointerY = moveEvent.clientY;
        if (!edge) return;
        if (!drag) {
          if (Math.abs(gridY(pointerY) - from) < 3) return;
          begin();
        }
        follow();
        if (drag && drag.frame === undefined && speed() !== 0) drag.frame = requestAnimationFrame(scroll);
      };
      const finish = (commit: boolean) => {
        element.removeEventListener("pointermove", move);
        element.removeEventListener("pointerup", up);
        element.removeEventListener("pointercancel", cancel);
        element.removeEventListener("lostpointercapture", cancel);
        window.removeEventListener("keydown", escape, true);
        const was = drag;
        drag = undefined;
        if (!was) {
          if (commit) { this.pick(item.id); this.open(item); }
          return;
        }
        if (was.frame !== undefined) cancelAnimationFrame(was.frame);
        was.ghost.remove();
        was.label.remove();
        handle?.classList.remove("active");
        element.classList.remove("moving", "resizing");
        const to = commit ? was.landing : { start: entry.start, end: entry.end };
        const changed = to.start !== entry.start || to.end !== entry.end;
        if (changed && edge) {
          if (item.kind === "event") this.moveEvent(item, to, edge !== "whole");
          else this.moveTask(item, to, edge === "whole" && startOnly, edge !== "whole");
        }
        // Settled: what came in meanwhile (the change itself among it) is drawn now.
        const land = () => {
          element.classList.remove("dragging", "settling");
          this.dragging = false;
          if (changed) this.drawnKey = "";
          this.host.redraw();
        };
        if (reduceMotion()) { place(to.start, to.end); land(); return; }
        element.classList.add("settling");
        place(to.start, to.end);
        setTimeout(land, 130);
      };
      const up = (upEvent: PointerEvent) => {
        // Where it was let go (a release away from the last move lands there).
        pointerY = upEvent.clientY;
        follow();
        finish(true);
      };
      const cancel = () => finish(false);
      const escape = (keyEvent: KeyboardEvent) => { if (keyEvent.key === "Escape" && drag) { keyEvent.preventDefault(); keyEvent.stopPropagation(); finish(false); } };
      element.addEventListener("pointermove", move);
      element.addEventListener("pointerup", up);
      element.addEventListener("pointercancel", cancel);
      // The capture taken away without a pointerup (the window lost the mouse): put it back.
      element.addEventListener("lostpointercapture", cancel);
      window.addEventListener("keydown", escape, true);
    });
    element.addEventListener("click", (event) => event.stopPropagation());
  }

  /** One undo step (the toast's 되돌리기); a start alone stays a start alone when moved whole. `resized`: an edge was dragged (시간을 바꿨어요). */
  private moveTask(item: StripItem, to: { start: number; end: number }, startOnly: boolean, resized = false): void {
    const id = item.taskId;
    const task = id ? this.host.state().items.find((entry) => entry.id === id) : undefined;
    const old = task ? rangeOf(task) : undefined;
    if (!id || !old) return;
    const next = { start: to.start % 1440, ...(startOnly ? {} : { end: to.end % 1440 }) };
    if (next.start === old.start && next.end === old.end) return;
    void api.act({ type: "setRange", id, start: next.start, ...(next.end !== undefined ? { end: next.end } : {}) });
    const undo = () => void api.act({ type: "setRange", id, start: old.start, ...(old.end !== undefined ? { end: old.end } : {}) });
    this.lastMove = undo;
    const range = taskRangeText(next, lang());
    this.host.flow.toast.show({ icon: "clock", text: resized ? t("시간을 바꿨어요 · {range}", { range }) : t("시간을 옮겼어요 · {range}", { range }), action: { label: t("되돌리기"), run: undo },
      onHide: () => { if (this.lastMove === undo) this.lastMove = undefined; } });
  }

  /** A one-off event moves to the new time (same length), or (`resized`) gets a new start or end; the toast takes it back. */
  private moveEvent(item: StripItem, to: { start: number; end: number }, resized = false): void {
    const local = item.event && this.host.state().events?.find((entry) => entry.id === item.event!.eventId);
    if (!local || local.repeat !== "none" || local.allDay) return;
    const old = draftFromEvent(local);
    const start = this.dateAt(to.start);
    const draft = { ...old, date: dateKey(start), startMinutes: to.start % 1440, endMinutes: to.end % 1440 };
    void api.calendarWrite({ kind: "update", id: local.id, draft }).then((result) => {
      if (!result.ok) return;
      const undo = () => void api.calendarWrite({ kind: "update", id: local.id, draft: old });
      this.lastMove = undo;
      const range = rangeText(start, this.dateAt(to.end), lang());
      this.host.flow.toast.show({ icon: "calendar", text: resized ? t("시간을 바꿨어요 · {range}", { range }) : t("일정을 옮겼어요 · {range}", { range }), action: { label: t("되돌리기"), run: undo },
        onHide: () => { if (this.lastMove === undo) this.lastMove = undefined; } });
    });
  }

  private pick(id: string | undefined): void {
    this.selected = id;
    this.paintSelection();
    this.scroller?.focus({ preventScroll: true });
  }

  private paintSelection(): void {
    if (!this.scroller) return;
    for (const block of this.scroller.querySelectorAll<HTMLElement>(".tt-block")) {
      const on = block.dataset.id === this.selected;
      block.classList.toggle("picked", on);
      if (on) block.setAttribute("aria-selected", "true"); else block.removeAttribute("aria-selected");
    }
    const picked = this.scroller.querySelector<HTMLElement>(".tt-block.picked");
    if (picked) {
      const top = picked.offsetTop, bottom = top + picked.offsetHeight;
      if (top < this.scroller.scrollTop) this.scroller.scrollTop = top - 6;
      else if (bottom > this.scroller.scrollTop + this.scroller.clientHeight) this.scroller.scrollTop = bottom - this.scroller.clientHeight + 6;
    }
  }

  /** ↑ ↓ pick a block, Enter opens it, Space ticks a to-do, Alt+↑ ↓ move a to-do by 15 minutes, Shift+Alt+↑ ↓ a to-do's or a one-off event's end, Esc folds the day. */
  private key(event: KeyboardEvent, order: string[], spans: Span[], ribbon: Ribbon): void {
    if (event.target !== this.scroller) return;
    const index = this.selected ? order.indexOf(this.selected) : -1;
    const current = index >= 0 ? this.items.find((item) => item.id === order[index]) : undefined;
    const handled = () => { event.preventDefault(); event.stopPropagation(); };
    if (event.key === "Escape") { handled(); this.setOpen(false); return; }
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      handled();
      const down = event.key === "ArrowDown";
      if (event.altKey) {
        const entry = current && spans.find((span) => span.id === current.id);
        if (!current || !entry) return;
        const steps = down ? 1 : -1;
        // Shift+Alt: the end only, of a to-do (a start alone gets its drawn end ± 15 minutes) or a one-off event.
        if (event.shiftKey) {
          const to = stretched(entry.start, entry.end, steps, ribbon.startHour, ribbon.endHour, current.kind);
          if (to.end === entry.end) return;
          if (current.kind === "task" && !current.done) this.moveTask(current, to, false, true);
          else if (current.kind === "event" && this.movable(current)) this.moveEvent(current, to, true);
          return;
        }
        if (current.kind !== "task" || current.done) return;
        const task = this.host.state().items.find((item) => item.id === current.taskId);
        this.moveTask(current, nudged(entry.start, entry.end, steps, ribbon.startHour, ribbon.endHour, "task"), Boolean(task && rangeOf(task)?.end === undefined));
        return;
      }
      if (order.length === 0) return;
      if (index >= 0) this.selected = order[Math.min(order.length - 1, Math.max(0, index + (down ? 1 : -1)))];
      else {
        // The first one not over yet.
        const ahead = order.find((id) => { const item = this.items.find((entry) => entry.id === id); return item && (item.end ?? item.start).getTime() > this.now.getTime(); });
        this.selected = ahead ?? order[0];
      }
      this.paintSelection();
      return;
    }
    if (event.key === "Enter" && current) { handled(); this.open(current); return; }
    if (event.key === " " && current && current.kind !== "event" && current.taskId) { handled(); void api.act({ type: "toggle", id: current.taskId }); }
  }

  /** The hidden ones of a crowded hour ("+N"), in a small list. */
  private moreList(anchor: HTMLElement, hidden: StripItem[]): void {
    this.closePopover();
    const card = h("div", { class: "sheet-pop tt-pop tt-more-list", role: "menu" }, ...hidden.map((item) => {
      const row = h("button", { role: "menuitem" }, this.mark(item), h("span", { class: "tml-time" }, clockText(item.start, lang())), h("span", { class: "tml-title" }, item.title));
      row.addEventListener("click", () => { this.closePopover(); this.open(item); });
      return row;
    }));
    this.showPopover(card, anchor.getBoundingClientRect(), true);
  }

  /** The little line a click on the timetable opens: `무엇을 할까요?`, 할 일 · 일정 (할 일 first, 일정 when the words say so), Enter puts it in. */
  private newItem(minutes: number, grid: HTMLElement, top: number): void {
    this.closePopover();
    let chosen: "todo" | "event" | undefined;
    const end = Math.min(dayEndMinutes, minutes + 60);
    const field = h("input", { class: "ttn-field", type: "text", placeholder: t("무엇을 할까요?"), "aria-label": t("무엇을 할까요?") });
    const chip = (kind: "todo" | "event", label: string) => {
      const element = h("button", { class: "ttn-chip", "data-kind": kind }, label);
      element.addEventListener("click", () => { chosen = kind; paint(); field.focus(); });
      return element;
    };
    const chips = [chip("todo", t("할 일", undefined, "chip")), chip("event", t("일정", undefined, "chip"))];
    const hint = h("span", { class: "ttn-hint kbd" }, `↩ ${t("넣기")}`);
    const paint = () => {
      const auto = hasEventWord(field.value, lang()) ? "event" : "todo";
      for (const element of chips) {
        const on = element.dataset.kind === (chosen ?? auto);
        element.classList.toggle("on", on);
        element.setAttribute("aria-pressed", String(on));
      }
      hint.classList.toggle("dim", !field.value.trim());
    };
    field.addEventListener("input", paint);
    field.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Escape") { event.preventDefault(); this.closePopover(); this.scroller?.focus({ preventScroll: true }); }
      if (event.key === "Enter" && !event.isComposing) {
        event.preventDefault();
        const title = field.value.trim();
        if (!title) return;
        this.closePopover();
        const candidates = newCandidates(title, minutes, new Date(), lang(), chosen);
        void commitReading(this.host.flow, candidates[0], candidates, title, "note");
      }
    });
    const card = h("div", { class: "sheet-pop tt-pop ttn", role: "dialog", "aria-label": t("무엇을 할까요?") },
      h("div", { class: "ttn-when" }, taskRangeText({ start: minutes % 1440, end: end % 1440 }, lang())), field,
      h("div", { class: "ttn-foot" }, ...chips, h("span", { class: "spacer" }), hint));
    paint();
    const rect = grid.getBoundingClientRect();
    this.showPopover(card, new DOMRect(rect.left + labelColumn, rect.top + top, Math.max(1, rect.width - labelColumn), 1), false);
    field.focus({ preventScroll: true });
  }

  private showPopover(card: HTMLElement, anchor: DOMRect, beside: boolean): void {
    const scrim = h("div", { class: "pop-scrim tt-scrim" });
    const close = () => { scrim.remove(); card.remove(); if (this.popover?.element === card) this.popover = undefined; };
    scrim.addEventListener("pointerdown", (event) => { event.preventDefault(); close(); });
    document.body.append(scrim, card);
    const width = card.offsetWidth, height = card.offsetHeight;
    let left = beside ? anchor.right - width : anchor.left + Math.min(12, anchor.width / 4);
    let top = beside ? anchor.bottom + 4 : anchor.top + 6;
    if (top + height > window.innerHeight - 6) top = Math.max(6, (beside ? anchor.top : anchor.top) - height - 6);
    left = Math.max(6, Math.min(left, window.innerWidth - width - 6));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
    this.popover = { element: card, close };
  }

  /** Ctrl+Z while a move's toast is up: that move goes back (true), else the list's own undo runs. */
  undoMove(): boolean {
    const undo = this.lastMove;
    if (!undo || !this.host.flow.toast.visible) return false;
    this.lastMove = undefined;
    this.host.flow.toast.hide();
    undo();
    return true;
  }

  closePopover(): void {
    this.popover?.close();
    this.popover = undefined;
  }
}

const two = (value: number) => String(value).padStart(2, "0");
const dateKey = (date: Date) => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;
