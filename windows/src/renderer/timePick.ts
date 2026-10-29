import { clock } from "../core/lang";
import { parseClockText } from "../core/ribbon";
import { h, lang, t } from "./api";

/**
 * The event sheet's small pickers, shared with the task editor's 시간 (1.24): a floating card under a chip
 * (one at a time, gone on a click elsewhere or Esc), and the 15-minute list with a field for a typed time
 * ("17:20", "5:20pm", "오후 5시 20분").
 */

/** "15:00" · "3:00 PM" · "15:00" for minutes after midnight. */
export const timeOf = (minutes: number): string => clock(Math.floor(minutes / 60) % 24, minutes % 60, lang());

/** A small floating list or month under a chip; one at a time, gone on a click elsewhere or Esc. */
export function popover(anchor: HTMLElement, content: HTMLElement, onClose: () => void): { close(): void; element: HTMLElement } {
  const element = h("div", { class: "sheet-pop", role: "dialog" }, content);
  const scrim = h("div", { class: "pop-scrim" });
  document.body.append(scrim, element);
  const place = () => {
    const rect = anchor.getBoundingClientRect();
    const width = element.offsetWidth, height = element.offsetHeight;
    const below = rect.bottom + 6 + height <= window.innerHeight - 6;
    const top = below ? rect.bottom + 6 : Math.max(6, rect.top - 6 - height);
    element.style.top = `${Math.min(top, window.innerHeight - height - 6)}px`;
    element.style.left = `${Math.max(6, Math.min(rect.left, window.innerWidth - width - 6))}px`;
  };
  place();
  const resized = new ResizeObserver(place);
  resized.observe(element);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    resized.disconnect();
    element.remove();
    scrim.remove();
    onClose();
  };
  scrim.addEventListener("click", close);
  element.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
    anchor.focus();
  });
  return { close, element };
}

/**
 * The 15-minute list from 0:00 under `chip`, scrolled to `current`, with a field that takes a typed time.
 * `none`: a first choice for no time at all (the task editor's end: 끝 없음); it picks undefined.
 */
export function timeList(chip: HTMLElement, current: number | undefined, pick: (minutes: number | undefined) => void, onClose: () => void, options: { none?: string } = {}): { close(): void } {
  const field = h("input", { type: "text", class: "pop-field", placeholder: t("예: 17:20"), "aria-label": t("시각 적기"), spellcheck: "false" });
  const hint = h("div", { class: "pop-hint" });
  const list = h("div", { class: "pop-list", role: "listbox" });
  let open: { close(): void } | undefined;
  const choose = (minutes: number | undefined) => { pick(minutes); open?.close(); chip.focus(); };
  if (options.none) {
    const option = h("button", { role: "option", class: "pop-none", "aria-selected": String(current === undefined) }, options.none);
    option.addEventListener("click", () => choose(undefined));
    list.append(option);
  }
  for (let minutes = 0; minutes < 1440; minutes += 15) {
    const option = h("button", { role: "option", "aria-selected": String(minutes === current), "data-minutes": String(minutes) }, timeOf(minutes));
    option.addEventListener("click", () => choose(minutes));
    list.append(option);
  }
  field.addEventListener("input", () => {
    const typed = parseClockText(field.value);
    hint.textContent = field.value.trim() ? (typed === undefined ? t("시각을 알아듣지 못했어요. ‘17:20’처럼 적어 보세요.") : timeOf(typed)) : "";
    hint.classList.toggle("bad", Boolean(field.value.trim()) && typed === undefined);
  });
  field.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    const typed = parseClockText(field.value);
    if (typed === undefined) return;
    choose(typed);
  });
  open = popover(chip, h("div", { class: "pop-times" }, field, hint, list), () => { chip.classList.remove("on"); onClose(); });
  chip.classList.add("on");
  const chosen = current === undefined ? undefined : list.querySelector<HTMLElement>(`[data-minutes="${Math.floor(current / 15) * 15}"]`);
  if (chosen) list.scrollTop = chosen.offsetTop - list.clientHeight / 2 + chosen.offsetHeight / 2;
  field.focus();
  return open;
}
