import { hasStyles, readOpacity, styleName, stylesOf, widgetLimit, widgetName, type WidgetKind, type WidgetSettings, type WidgetStyle } from "../core/calendarWidget";
import type { WidgetChanges } from "../core/types";
import { h, lang, t } from "./api";
import { appear, keyCap, slipButton, slipHead, tape } from "./slip";

/**
 * 책상 → 일정 → 바탕화면 위젯 (#234): the rows of this PC's widgets, the slip that adds one (six kinds, pictured) and each
 * widget's settings slip — 모양, 불투명도 (shown on the widget at once, 취소 puts it back), 마우스를 올리면 선명하게,
 * 클릭 통과, 위치 고정, 항상 위에 두기 and 위젯 제거. ‘모든 데스크톱에’ isn't offered on Windows (Electron has no way to
 * do it there; it waits until it can be checked on a real PC — the plan's cut order 3).
 */

/** The six in the gallery, in the plan's order, and 벽 달력 (the month at a wall calendar's size). */
export const galleryKinds: { kind: WidgetKind; style: WidgetStyle }[] = [
  { kind: "today", style: "simple" }, { kind: "week", style: "simple" }, { kind: "week", style: "detail" },
  { kind: "month", style: "simple" }, { kind: "month", style: "detail" }, { kind: "month", style: "wall" }, { kind: "agenda", style: "simple" },
];

/** A small picture of a kind (its paper, its ears and a few strokes of what it shows). */
export function widgetThumb(kind: WidgetKind, style: WidgetStyle): HTMLElement {
  const parts: HTMLElement[] = [];
  if (kind === "today") parts.push(h("b", { class: "big" }, "6"), h("i", { class: "l" }), h("i", { class: "l short" }), h("i", { class: "l" }));
  else if (kind === "agenda") for (let index = 0; index < 6; index += 1) parts.push(h("i", { class: `l${index % 3 === 2 ? " short" : ""}` }));
  else {
    const cells = kind === "week" ? (style === "detail" ? 0 : 7) : 35;
    if (kind === "week" && style === "detail") for (let index = 0; index < 7; index += 1) parts.push(h("i", { class: "l thin" }));
    else parts.push(h("span", { class: "grid" }, ...Array.from({ length: cells }, (_, index) => h("i", { class: index === 12 || (kind === "week" && index === 5) ? "on" : "" }))));
    if (kind === "month" && style !== "simple") parts.push(h("span", { class: "detail-mark" }));
  }
  return h("span", { class: `wthumb k-${kind} s-${style}`, "aria-hidden": "true" }, h("span", { class: "ears" }), ...parts);
}

interface SlipHandle { close(): void }

function modal(slip: HTMLElement, onClose: () => void, onEnter?: () => void): SlipHandle {
  const scrim = h("div", { class: "device-scrim" });
  const keys = (event: KeyboardEvent) => {
    if (event.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
    if (event.key === "Enter" && onEnter && (event.target as HTMLElement).tagName !== "BUTTON") { event.preventDefault(); onEnter(); }
  };
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", keys, true);
    scrim.remove();
    slip.remove();
    onClose();
  };
  scrim.addEventListener("click", close);
  document.addEventListener("keydown", keys, true);
  document.body.append(scrim, slip);
  appear(slip);
  return { close };
}

/** + 위젯 더하기: the six kinds; 더하기 puts the picked one at the top right of the main display. */
export function openWidgetGallery(options: { add: (kind: WidgetKind, style: WidgetStyle) => void; closed?: () => void }): SlipHandle {
  let picked = 3;
  const slip = h("div", { class: "slip l device-slip widget-slip", role: "dialog", "aria-modal": "true", "aria-label": t("위젯 더하기") });
  const tiles = h("div", { class: "widget-gallery", role: "radiogroup", "aria-label": t("위젯 더하기") });
  const draw = () => {
    tiles.replaceChildren(...galleryKinds.map((entry, index) => {
      const tile = h("button", { class: `widget-tile${index === picked ? " on" : ""}`, role: "radio", "aria-checked": String(index === picked) },
        widgetThumb(entry.kind, entry.style), h("span", { class: "name" }, widgetName(entry.kind, entry.style, lang())));
      tile.addEventListener("click", () => { picked = index; draw(); tiles.querySelectorAll<HTMLElement>(".widget-tile")[index]?.focus(); });
      tile.addEventListener("dblclick", () => add.click());
      return tile;
    }));
  };
  const add = slipButton(t("더하기"), "primary", () => { const entry = galleryKinds[picked]; options.add(entry.kind, entry.style); handle.close(); }, "Enter");
  const cancel = slipButton(t("취소"), "ghost", () => handle.close());
  const head = slipHead({ icon: "calendar", tint: "event", title: t("위젯 더하기"), onClose: () => handle.close(), closeLabel: t("취소") });
  slip.append(tape("event"), head.element,
    h("div", { class: "slip-body" }, h("p", { class: "device-lead" }, t("고른 위젯이 화면 오른쪽 위에 나타나요.")), tiles),
    h("div", { class: "slip-foot" }, h("span", { class: "keys" }, h("span", {}, keyCap("Esc"), t("취소"))), h("span", { class: "spacer" }), cancel, add));
  draw();
  const handle = modal(slip, () => options.closed?.(), () => add.click());
  requestAnimationFrame(() => tiles.querySelector<HTMLElement>(".widget-tile.on")?.focus());
  return handle;
}

/**
 * A widget's settings slip: every change shows on the widget at once (`change`); 취소 puts back what it was, 완료 keeps
 * it, 위젯 제거 removes it (the desk's toast has 되돌리기).
 */
export function openWidgetSettings(options: {
  widget: WidgetSettings; change: (changes: WidgetChanges) => void; remove: () => void; closed?: () => void;
}): SlipHandle {
  const original: WidgetChanges = {
    style: options.widget.style, opacity: options.widget.opacity, solidOnHover: options.widget.solidOnHover, clickThrough: options.widget.clickThrough,
    locked: options.widget.locked, level: options.widget.level,
  };
  let now: WidgetChanges = { ...original };
  let kept = false;
  const reduced = window.matchMedia("(prefers-reduced-transparency: reduce)").matches;
  const kindTitle = widgetName(options.widget.kind, "simple", lang()).split(" · ")[0];
  const slip = h("div", { class: "slip l device-slip widget-slip", role: "dialog", "aria-modal": "true", "aria-label": t("{name} 위젯", { name: kindTitle }) });
  const body = h("div", { class: "slip-body widget-settings" });
  const set = (changes: WidgetChanges) => { now = { ...now, ...changes }; options.change(changes); draw(); };
  const toggleRow = (label: string, value: boolean, onChange: (value: boolean) => void, note?: string, disabled = false) => {
    const control = h("button", { class: "switch", role: "switch", "aria-checked": String(value), "aria-label": label });
    if (disabled) control.setAttribute("disabled", "");
    control.addEventListener("click", () => onChange(!value));
    return h("div", { class: `row${disabled ? " off" : ""}` }, h("span", { class: "grow two" }, label, note ? h("small", {}, note) : null), control);
  };
  const draw = () => {
    const rows: HTMLElement[] = [];
    if (hasStyles(options.widget.kind)) {
      const seg = h("div", { class: "segmented", role: "radiogroup", "aria-label": t("모양", undefined, "widget") }, ...stylesOf(options.widget.kind).map((style) => {
        const button = h("button", { role: "radio", "aria-checked": String(now.style === style) }, styleName(style, lang()));
        button.addEventListener("click", () => set({ style }));
        return button;
      }));
      rows.push(h("div", { class: "row" }, h("span", { class: "grow" }, t("모양", undefined, "widget")), seg));
    }
    const opacity = reduced ? 100 : now.opacity ?? 85;
    const slider = h("input", { type: "range", min: "20", max: "100", step: "5", value: String(opacity), "aria-label": t("불투명도") }) as HTMLInputElement;
    slider.disabled = reduced;
    const shown = h("span", { class: "num widget-pct" }, `${opacity}%`);
    slider.addEventListener("input", () => { shown.textContent = `${readOpacity(Number(slider.value))}%`; now = { ...now, opacity: readOpacity(Number(slider.value)) }; options.change({ opacity: now.opacity }); });
    rows.push(h("div", { class: `row${reduced ? " off" : ""}` }, h("span", { class: "grow" }, t("불투명도")), slider, shown));
    if (reduced) rows.push(h("div", { class: "widget-note" }, t("투명도 줄이기가 켜져 있어서 위젯이 늘 선명하게 보여요.")));
    rows.push(toggleRow(t("마우스를 올리면 선명하게"), now.solidOnHover ?? true, (value) => set({ solidOnHover: value }), undefined, reduced));
    rows.push(toggleRow(t("클릭 통과"), now.clickThrough ?? false, (value) => set({ clickThrough: value }), t("켜면 귀만 마우스를 받아요.")));
    rows.push(toggleRow(t("위치 고정"), now.locked ?? false, (value) => set({ locked: value })));
    rows.push(toggleRow(t("항상 위에 두기"), now.level === "top", (value) => set({ level: value ? "top" : "desktop" }), t("끄면 다른 창 아래, 바탕화면에 있어요.")));
    body.replaceChildren(h("p", { class: "device-lead" }, t("이 PC에만 저장해요.")), h("div", { class: "card" }, ...rows));
  };
  const remove = slipButton(t("위젯 제거"), "danger", () => { kept = true; options.remove(); handle.close(); });
  const cancel = slipButton(t("취소"), "ghost", () => handle.close());
  const done = slipButton(t("완료", undefined, "widget"), "primary", () => { kept = true; handle.close(); }, "Enter");
  const head = slipHead({ icon: "calendar", tint: "event", title: t("{name} 위젯", { name: kindTitle }), onClose: () => handle.close(), closeLabel: t("취소") });
  slip.append(tape("event"), head.element, body, h("div", { class: "slip-foot" }, remove, h("span", { class: "spacer" }), cancel, done));
  draw();
  const handle = modal(slip, () => {
    // 취소 (Esc, ×, the scrim): what it was before the slip.
    if (!kept && JSON.stringify(now) !== JSON.stringify(original)) options.change(original);
    options.closed?.();
  }, () => done.click());
  requestAnimationFrame(() => slip.querySelector<HTMLElement>(".seg button[aria-checked=true], input[type=range]")?.focus());
  return handle;
}

/** The desk's row under a widget's name: ‘불투명도 85% · 바탕화면에 두기’ (and ‘클릭 통과’ when on). */
export function widgetSummary(widget: WidgetSettings): string {
  const parts = [t("불투명도 {n}%", { n: widget.opacity }), widget.level === "top" ? t("항상 위") : t("바탕화면에 두기")];
  if (widget.clickThrough) parts.push(t("클릭 통과"));
  return parts.join(" · ");
}

export const widgetsFull = (count: number): boolean => count >= widgetLimit;
