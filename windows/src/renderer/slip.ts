import { nudgeBlink, nudgeShake } from "../core/slipMove";
import { h, icon, motion, paper, reduceMotion, t } from "./api";

/**
 * Building blocks of the 쪽지 family (see slip.css): the tape, the header, keycaps, buttons, chips,
 * the toast, and a window that fits its slip (the main process sizes the transparent window to it).
 */

export type TapeKind = "todo" | "memo" | "event" | "timer" | "alarm" | "confirm";
export type BadgeTint = "sage" | "clay" | "event" | "memo" | "plain";

export function tape(kind: TapeKind, left?: string): HTMLElement {
  const element = h("span", { class: `tape ${kind}`, "aria-hidden": "true" });
  if (left) element.style.left = left;
  return element;
}

/** 28 round badge with the kind's icon, the title, an optional quiet context, and × when the slip can be dismissed. */
export function slipHead(options: { icon: string; tint?: BadgeTint; title: string; context?: string; onClose?: () => void; closeLabel?: string }): { element: HTMLElement; title: HTMLElement; context: HTMLElement } {
  const title = h("span", { class: "slip-title" }, options.title);
  const context = h("span", { class: "slip-ctx" }, options.context ?? "");
  const parts: HTMLElement[] = [
    h("span", { class: `slip-badge ${options.tint ?? "plain"}`, "aria-hidden": "true" }, icon(options.icon, 15)),
    h("span", { class: "slip-heading" }, title, context),
  ];
  if (options.onClose) {
    const label = options.closeLabel ?? t("닫기");
    const close = h("button", { class: "slip-x", title: label, "aria-label": label }, icon("close", 14));
    close.addEventListener("click", options.onClose);
    parts.push(close);
  }
  return { element: h("div", { class: "slip-head" }, ...parts), title, context };
}

export const keyCap = (text: string): HTMLElement => h("kbd", { class: "keycap" }, text);

/** "esc 닫기" in the footer's left side. */
export const keyHint = (key: string, label: string): HTMLElement => h("span", {}, keyCap(key), label);

export function slipButton(label: string, kind: "primary" | "ghost" | "danger", action: () => void, key?: string): HTMLButtonElement {
  const button = h("button", { class: `sbtn ${kind === "ghost" ? "" : kind}`.trim() }, h("span", {}, label), key ? keyCap(key) : null);
  button.addEventListener("click", action);
  return button;
}

export function chip(label: string, options: { icon?: string; on?: boolean; action?: () => void; title?: string } = {}): HTMLButtonElement {
  const element = h("button", { class: `chip${options.on ? " on" : ""}`, ...(options.title ? { title: options.title } : {}), ...(options.on !== undefined ? { "aria-pressed": String(options.on) } : {}) },
    options.icon ? icon(options.icon, 13) : null, h("span", {}, label));
  if (options.action) element.addEventListener("click", options.action);
  return element;
}

/** Plays the slip's arrival (rise, fade, a small tilt straightening), unless motion is reduced. */
export function appear(element: HTMLElement): void {
  element.classList.remove("appear");
  if (reduceMotion()) return;
  void element.offsetWidth;
  element.classList.add("appear");
}

/** #228: a press on the slip that moves it: on its paper or its title row, not on a button, chip, field, link, the
 * selectable detail line or a scroll bar. */
export function startsSlipDrag(event: PointerEvent): boolean {
  if (event.button !== 0 || !(event.target instanceof Element)) return false;
  if (event.target.closest("button, input, select, textarea, a, [contenteditable], [role=button], [role=listbox], [role=option], .chip, .confirm-sub, .sheet-pop")) return false;
  return !(event.target instanceof HTMLElement && event.target.clientWidth > 0 && event.offsetX > event.target.clientWidth);
}

/** #228: drags `slip` by its paper — `move` hears how far the pointer went (px) and where it is on the screen. */
export function dragByPaper(slip: HTMLElement, handlers: { start?(x: number, y: number): void; move(dx: number, dy: number, x: number, y: number): void; end?(x: number, y: number): void }): void {
  slip.addEventListener("pointerdown", (event) => {
    if (!startsSlipDrag(event)) return;
    event.preventDefault();
    const fromX = event.screenX, fromY = event.screenY;
    handlers.start?.(fromX, fromY);
    try { slip.setPointerCapture(event.pointerId); } catch { /* a press that isn't a real pointer's */ }
    const move = (next: PointerEvent) => handlers.move(next.screenX - fromX, next.screenY - fromY, next.screenX, next.screenY);
    const end = (last: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      handlers.end?.(last.screenX, last.screenY);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  });
}

/** #229: a press a waiting question held up — the slip shakes once over 톡, or under Reduce Motion its tape blinks (dim,
 * back, dim, back, 살짝 each). (The animations API: base.css's Reduce Motion rule shortens CSS animations only.) */
export function nudge(slip: HTMLElement): void {
  if (reduceMotion()) {
    const steps = nudgeBlink.length;
    slip.querySelector<HTMLElement>(".tape")?.animate(nudgeBlink.flatMap((opacity, index) => [{ opacity, offset: index / steps }, { opacity, offset: (index + 1) / steps }]),
      { duration: motion.quick * steps });
    return;
  }
  slip.animate([0, ...nudgeShake].map((x) => ({ translate: `${x}px 0` })), { duration: motion.bounce, easing: "linear" });
}

/**
 * A window around one slip: the main process keeps the transparent window the size of `.slip-stage`
 * (the slip, its tape and its shadow), so nothing around the paper takes clicks.
 */
export function fitWindow(stage: HTMLElement): void {
  const api = paper();
  let last = "";
  const report = () => {
    const rect = stage.getBoundingClientRect();
    const size = { width: Math.ceil(rect.width), height: Math.ceil(rect.height) };
    const key = `${size.width}x${size.height}`;
    if (key === last || size.width === 0) return;
    last = key;
    api.send("slip:size", size);
  };
  new ResizeObserver(report).observe(stage);
  report();
}

// ─── Toast ────────────────────────────────────────────────────────────────────

export interface ToastOptions {
  icon?: string;
  text: string;
  /** The words that stand out at the start ("일정"). */
  action?: { label: string; run: () => void };
  /** Shown this long (4 s), paused while the pointer is on it. */
  ms?: number;
  /** Up to two lines before "…" (AI 연결's sentences are longer than the others' few words). */
  twoLines?: boolean;
  onHide?: () => void;
}

/**
 * One toast at a time in `host`: an ink pill with an optional action, gone after 4 s (paused on
 * hover), Esc dismisses it. Returns whether one is up, and hides it.
 */
export function toaster(host: HTMLElement): { show(options: ToastOptions): void; hide(): void; get visible(): boolean } {
  // #119: the host is the live region, there before any toast (a region added with its words is often not read).
  host.setAttribute("role", "status");
  host.setAttribute("aria-live", "polite");
  let current: { element: HTMLElement; timer?: number; left: number; started: number; options: ToastOptions } | undefined;
  // N10: the one going away fades out (살짝, ease-in) and takes no clicks meanwhile; a new toast removes it at once.
  let leaving: { element: HTMLElement; timer: number } | undefined;
  const dropLeaving = () => {
    if (!leaving) return;
    window.clearTimeout(leaving.timer);
    leaving.element.remove();
    leaving = undefined;
  };
  const close = (fade: boolean) => {
    if (!current) return;
    const { element, timer, options } = current;
    window.clearTimeout(timer);
    current = undefined;
    dropLeaving();
    if (fade && !reduceMotion() && element.isConnected) {
      element.classList.remove("appear");
      element.classList.add("leaving");
      leaving = { element, timer: window.setTimeout(dropLeaving, motion.quick) };
    } else {
      element.remove();
    }
    options.onHide?.();
  };
  const hide = () => close(true);
  const arm = () => {
    if (!current) return;
    current.started = performance.now();
    current.timer = window.setTimeout(hide, current.left);
  };
  const pause = () => {
    if (!current || current.timer === undefined) return;
    window.clearTimeout(current.timer);
    current.timer = undefined;
    current.left = Math.max(800, current.left - (performance.now() - current.started));
  };
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && current) { event.preventDefault(); event.stopPropagation(); hide(); }
  }, true);
  return {
    show(options: ToastOptions): void {
      close(false);
      dropLeaving();
      const text = h("span", { class: `toast-text${options.twoLines ? " two-lines" : ""}` }, options.text);
      text.title = options.text;
      const action = options.action ? h("button", { class: "toast-act" }, options.action.label) : null;
      action?.addEventListener("click", () => { const run = options.action!.run; hide(); run(); });
      const element = h("div", { class: "toast" }, icon(options.icon ?? "check", 14), text, action);
      element.addEventListener("mouseenter", pause);
      element.addEventListener("mouseleave", arm);
      host.append(element);
      appear(element);
      current = { element, left: options.ms ?? 4000, started: 0, options };
      arm();
    },
    hide,
    get visible() { return current !== undefined; },
  };
}
