import { dayLabel, lengthText, validate, type CalendarDraft, type CalendarSheetRequest, type CalendarWriteRequest } from "../core/calendar";
import { fromKey, key as dayKey } from "../core/deadline";
import { eventColorTitle, eventColors, eventRepeatTitle, eventRepeats } from "../core/events";
import { h, icon, lang, paper, scrollFade, t } from "./api";
import { paperCalendar } from "./calendar";
import { slipButton, slipHead, tape } from "./slip";
import { popover, timeList as timePopover, timeOf } from "./timePick";

/**
 * 일정 시트: an L slip (sky tape) for 캘린더에 넣기 (from a task) · 새 일정 · 일정 고치기, in the note
 * and in the 달력 window. No label column: the title in the hand on a sage line, then rows led by
 * an icon — the day as a chip (a small month opens) with 종일 at the right, the times as chips (a
 * 15-minute list with a field for "17:20" or "5:20pm") and the length, 반복 as a chip, the six
 * colours, and the place as plain text. It asks the main process to write events.json; done, it
 * closes. A repeating event changes as a whole; deleting one asks whether only that day goes.
 */

const api = paper();

const words = {
  send: { title: t("달력에 넣기"), action: t("넣기") },
  new: { title: t("새 일정"), action: t("만들기") },
  edit: { title: t("일정 고치기"), action: t("저장") },
} as const;


export interface EventSheet {
  close(): void;
  /** The window moved or changed under the card: it finds its place again. */
  refresh(): void;
}

/**
 * Opens the card over the window, near `anchor` (a task row, the ribbon, a day) or in the middle.
 * The 달력 window, wider than the card, puts it under its anchor (`besideAnchor`) rather than in the middle.
 */
export function openEventSheet(request: CalendarSheetRequest, anchor: () => HTMLElement | undefined, onClose: () => void, options: { besideAnchor?: boolean } = {}): EventSheet {
  const mode = request.mode;
  const text = words[mode];
  const draft: CalendarDraft = { ...request.draft };
  let stage: "form" | "confirm" = request.confirmDelete ? "confirm" : "form";
  let error = request.error;
  let busy = false;
  let closed = false;
  let open: { close(): void } | undefined;
  const closePop = () => { open?.close(); open = undefined; };
  const today = new Date();

  // ── The title, in the hand
  const titleInput = h("input", { type: "text", class: "sheet-title", "aria-label": t("제목"), spellcheck: "false", placeholder: t("일정 제목") });
  titleInput.value = draft.title;
  titleInput.addEventListener("input", () => { draft.title = titleInput.value; clearError(); dimPrimary(); });
  /** 만들기 · 저장 look not ready until there is a title (as on the Mac); a click still says why. */
  const dimPrimary = () => actions.querySelector(".sbtn.primary:not(.clay)")?.classList.toggle("waiting", stage === "form" && !draft.title.trim());
  const titleField = h("div", { class: "hand-field on" }, titleInput);

  // ── 날짜 · 종일
  const dateChip = h("button", { class: "chip sheet-chip", "aria-haspopup": "dialog" });
  dateChip.addEventListener("click", () => {
    closePop();
    const first = fromKey(draft.date) ?? today;
    const minimum = new Date(Math.min(new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime(), new Date(first.getFullYear(), first.getMonth(), first.getDate()).getTime()));
    const month = paperCalendar({ selected: first, minimum, onPick: (date) => { draft.date = dayKey(date); closePop(); refresh(); dateChip.focus(); } });
    open = popover(dateChip, h("div", { class: "pop-month" }, month), () => { open = undefined; dateChip.classList.remove("on"); });
    dateChip.classList.add("on");
    (month.querySelector<HTMLElement>(".cal-day.selected") ?? month.querySelector<HTMLElement>("button"))?.focus();
  });
  const allDaySwitch = h("button", { class: "switch small", role: "switch", "aria-label": t("종일") });
  allDaySwitch.addEventListener("click", () => { draft.allDay = !draft.allDay; clearError(); refresh(); });
  const allDayToggle = h("label", { class: "sheet-toggle" }, h("span", {}, t("종일")), allDaySwitch);
  allDayToggle.addEventListener("click", (event) => { if (event.target !== allDaySwitch) { event.preventDefault(); allDaySwitch.click(); } });

  // ── 시간: start → end and the length; all day: one chip for the days
  const startChip = h("button", { class: "chip sheet-chip", "aria-haspopup": "listbox", "aria-label": t("시작 시각") });
  const endChip = h("button", { class: "chip sheet-chip", "aria-haspopup": "listbox", "aria-label": t("끝 시각") });
  const length = h("span", { class: "sheet-dim" });
  const daysChip = h("button", { class: "chip sheet-chip", "aria-haspopup": "listbox", "aria-label": t("기간") });
  const timeLine = h("div", { class: "sheet-line" }, startChip, h("span", { class: "sheet-dim", "aria-hidden": "true" }, "→"), endChip, length);
  const daysLine = h("div", { class: "sheet-line" }, daysChip);

  /** The 15-minute list from 0:00, scrolled to `current`, with a field that takes a typed time. */
  function timeList(chipElement: HTMLElement, current: number, pick: (minutes: number) => void): void {
    closePop();
    open = timePopover(chipElement, current, (minutes) => { if (minutes !== undefined) pick(minutes); }, () => { open = undefined; });
  }
  // Moving the start keeps the length, as calendars do.
  startChip.addEventListener("click", () => timeList(startChip, draft.startMinutes, (start) => {
    const span = (draft.endMinutes - draft.startMinutes + 1440) % 1440 || 60;
    draft.startMinutes = start;
    draft.endMinutes = (start + span) % 1440;
    clearError();
    refresh();
  }));
  endChip.addEventListener("click", () => timeList(endChip, draft.endMinutes, (end) => { draft.endMinutes = end; clearError(); refresh(); }));

  function choiceList<T>(chipElement: HTMLElement, choices: { value: T; label: string }[], current: T, pick: (value: T) => void): void {
    closePop();
    const list = h("div", { class: "pop-list short", role: "listbox" }, ...choices.map((choice) => {
      const option = h("button", { role: "option", "aria-selected": String(choice.value === current) }, choice.label);
      option.addEventListener("click", () => { pick(choice.value); closePop(); refresh(); chipElement.focus(); });
      return option;
    }));
    open = popover(chipElement, list, () => { open = undefined; chipElement.classList.remove("on"); });
    chipElement.classList.add("on");
    (list.querySelector<HTMLElement>('[aria-selected="true"]') ?? list.querySelector<HTMLElement>("button"))?.focus();
  }
  const daysLabel = (days: number) => (days <= 1 ? t("하루 종일") : t("{n}일 종일", { n: days }));
  daysChip.addEventListener("click", () => choiceList(daysChip, Array.from({ length: Math.max(7, draft.days) }, (_, index) => ({ value: index + 1, label: daysLabel(index + 1) })), draft.days, (days) => { draft.days = days; }));

  // ── 반복
  const repeatChip = h("button", { class: "chip sheet-chip", "aria-haspopup": "listbox", "aria-label": t("반복") });
  const repeatLabel = (value: CalendarDraft["repeat"]) => (value === "none" ? t("반복 안 함") : eventRepeatTitle(value, lang()));
  repeatChip.addEventListener("click", () => choiceList(repeatChip, eventRepeats.map((choice) => ({ value: choice.value, label: repeatLabel(choice.value) })), draft.repeat, (value) => { draft.repeat = value; }));

  // ── 색: six dots, the chosen one ringed.
  const colorDots = eventColors.map((color) => {
    const dot = h("button", { class: "sheet-color", role: "radio", title: eventColorTitle(color.value, lang()), "aria-label": eventColorTitle(color.value, lang()), "data-color": color.value });
    dot.style.setProperty("--dot", color.hex);
    dot.addEventListener("click", () => { draft.color = color.value; refresh(); });
    return dot;
  });

  // ── 장소: plain text, no box.
  const placeInput = h("input", { type: "text", class: "sheet-place", "aria-label": t("장소"), spellcheck: "false", placeholder: t("장소 (선택)") });
  placeInput.value = draft.location ?? "";
  placeInput.addEventListener("input", () => { if (placeInput.value.trim()) draft.location = placeInput.value; else delete draft.location; });

  const recurringNote = h("div", { class: "sheet-note" }, icon("repeat", 13), t("반복 일정은 모든 날이 함께 바뀌어요."));
  const errorNote = h("div", { class: "sheet-note error", role: "alert" });
  const row = (symbol: string, ...content: (Node | null)[]) => h("div", { class: "sheet-row" }, icon(symbol, 16), h("div", { class: "sheet-line" }, ...content.filter(Boolean) as Node[]));
  const dateRow = row("calendar", dateChip, h("span", { class: "spacer" }), allDayToggle);
  const timeRow = h("div", { class: "sheet-row" }, icon("clock", 16), timeLine, daysLine);
  const rows = h("div", { class: "sheet-rows" },
    dateRow, timeRow, errorNote, row("repeat", repeatChip),
    row("palette", h("div", { class: "sheet-colors", role: "radiogroup", "aria-label": t("색") }, ...colorDots)),
    row("place", placeInput));

  // ── The card
  const head = slipHead({ icon: "calendar", tint: "event", title: text.title, onClose: () => close() });
  const body = h("div", { class: "slip-body sheet-body" });
  scrollFade(body);
  const actions = h("div", { class: "slip-foot" });
  const card = h("div", { class: "slip l event-sheet", role: "dialog", "aria-label": text.title, tabindex: "-1" }, tape("event"), head.element, body, actions);
  const scrim = h("div", { class: "scrim" });
  document.body.append(scrim, card);

  function clearError(): void {
    if (!error) return;
    error = undefined;
    errorNote.hidden = true;
  }

  let primary: (() => void) | undefined;
  /** What the card was last drawn as: its buttons are made again only when that changes (focus stays put). */
  let drawn = "";

  /** Puts exactly `children` in `parent`, leaving it alone when they are already there (moving a node drops focus). */
  function setChildren(parent: HTMLElement, children: readonly Element[]): void {
    if (children.length === parent.children.length && children.every((child, index) => parent.children[index] === child)) return;
    parent.replaceChildren(...children);
  }

  function refresh(): void {
    if (closed) return;
    const fresh = stage !== drawn;
    drawn = stage;
    errorNote.textContent = error ?? "";
    errorNote.hidden = !error;
    if (stage === "confirm") {
      if (fresh) {
        head.title.textContent = t("일정 지우기");
        body.replaceChildren(h("div", { class: "sheet-question" }, t("‘{title}’ 일정을 지울까요?", { title: draft.title.trim() || t("제목 없는 일정") })), errorNote);
        const cancel = slipButton(t("취소"), "ghost", () => (request.confirmDelete ? close() : (stage = "form", error = undefined, refresh())));
        // A repeating event: only the day chosen, or every day.
        actions.replaceChildren(h("span", { class: "spacer" }), cancel, ...(request.recurring
          ? [slipButton(t("이 날만"), "ghost", () => void write({ kind: "skip", id: request.id, day: request.day })), slipButton(t("모두 지우기"), "primary", remove)]
          : [slipButton(t("지우기"), "primary", remove, "↩")]));
        actions.querySelector<HTMLElement>(".sbtn.primary")?.classList.add("clay");
      }
      primary = request.recurring ? undefined : remove;
      place();
      return;
    }
    dateChip.replaceChildren(h("span", {}, dayLabel(fromKey(draft.date) ?? today, lang())));
    allDaySwitch.setAttribute("aria-checked", String(draft.allDay));
    timeLine.hidden = draft.allDay;
    daysLine.hidden = !draft.allDay;
    startChip.textContent = timeOf(draft.startMinutes);
    endChip.textContent = timeOf(draft.endMinutes);
    length.textContent = lengthText(draft, lang());
    daysChip.textContent = daysLabel(draft.days);
    repeatChip.textContent = repeatLabel(draft.repeat);
    for (const dot of colorDots) dot.setAttribute("aria-checked", String(dot.dataset.color === draft.color));
    recurringNote.hidden = !(mode === "edit" && request.recurring);
    if (fresh) head.title.textContent = text.title;
    setChildren(body, [titleField, rows, recurringNote]);
    if (fresh) {
      const parts: HTMLElement[] = [];
      if (mode === "edit") parts.push(slipButton(t("지우기"), "danger", () => { stage = "confirm"; error = undefined; refresh(); card.focus(); }));
      parts.push(h("span", { class: "spacer" }), slipButton(t("취소"), "ghost", close), slipButton(text.action, "primary", submit, "↩"));
      actions.replaceChildren(...parts);
    }
    dimPrimary();
    primary = submit;
    place();
  }

  /** Written at once (a local file): the card closes, or says what went wrong. */
  async function write(change: CalendarWriteRequest): Promise<void> {
    if (busy) return;
    busy = true;
    const result = await api.calendarWrite(change);
    busy = false;
    if (closed) return;
    if (result.ok) return close();
    error = result.error;
    refresh();
  }

  function submit(): void {
    const problem = validate(draft, lang());
    if (problem) {
      error = problem;
      refresh();
      if (!draft.title.trim()) titleInput.focus();
      return;
    }
    const clean: CalendarDraft = { ...draft, title: draft.title.trim() };
    if (clean.location !== undefined && !clean.location.trim()) delete clean.location;
    void write({ kind: mode === "edit" ? "update" : "create", draft: clean, ...(request.id ? { id: request.id } : {}) });
  }

  function remove(): void {
    void write({ kind: "delete", id: request.id });
  }

  // Under its row (or the ribbon), above it when there isn't room, else in the middle; room above for the tape.
  function place(): void {
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const rect = anchor()?.getBoundingClientRect();
    let top = (window.innerHeight - height) / 2;
    if (rect && rect.height > 0) top = rect.bottom + 16 + height < window.innerHeight ? rect.bottom + 16 : rect.top - height - 8;
    card.style.top = `${Math.max(16, Math.min(top, window.innerHeight - height - 10))}px`;
    const left = options.besideAnchor && rect && rect.width > 0 ? rect.left + rect.width / 2 - width / 2 : (window.innerWidth - width) / 2;
    card.style.left = `${Math.max(8, Math.min(left, window.innerWidth - width - 8))}px`;
  }
  const resized = new ResizeObserver(() => place());
  resized.observe(card);
  window.addEventListener("resize", place);

  function close(): void {
    if (closed) return;
    closed = true;
    closePop();
    resized.disconnect();
    window.removeEventListener("resize", place);
    card.remove();
    scrim.remove();
    onClose();
  }

  scrim.addEventListener("click", close);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (stage === "confirm" && !request.confirmDelete) { stage = "form"; error = undefined; refresh(); } else close();
      return;
    }
    if (event.key !== "Enter" || event.isComposing) return;
    const target = event.target as HTMLElement;
    // A focused button answers Enter itself.
    if (target instanceof HTMLButtonElement) return;
    event.preventDefault();
    event.stopPropagation();
    primary?.();
  });

  refresh();
  if (stage === "confirm") card.focus();
  else {
    titleInput.focus();
    titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length);
  }
  return { close, refresh: () => { if (!closed) place(); } };
}
