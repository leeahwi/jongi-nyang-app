import { h, icon, paper, reduceMotion, t } from "./api";

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
  onHide?: () => void;
}

/**
 * One toast at a time in `host`: an ink pill with an optional action, gone after 4 s (paused on
 * hover), Esc dismisses it. Returns whether one is up, and hides it.
 */
export function toaster(host: HTMLElement): { show(options: ToastOptions): void; hide(): void; get visible(): boolean } {
  let current: { element: HTMLElement; timer?: number; left: number; started: number; options: ToastOptions } | undefined;
  const hide = () => {
    if (!current) return;
    const { element, timer, options } = current;
    window.clearTimeout(timer);
    current = undefined;
    element.remove();
    options.onHide?.();
  };
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
      hide();
      const text = h("span", { class: "toast-text" }, options.text);
      text.title = options.text;
      const action = options.action ? h("button", { class: "toast-act" }, options.action.label) : null;
      action?.addEventListener("click", () => { const run = options.action!.run; hide(); run(); });
      const element = h("div", { class: "toast", role: "status", "aria-live": "polite" }, icon(options.icon ?? "check", 14), text, action);
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
