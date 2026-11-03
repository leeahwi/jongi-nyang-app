import { h, icon, t } from "./api";

/**
 * 메모 서랍's menus (1.29): one HTML menu for the ⚙ menu, a memo's ⋯ and right-click, the folder list, a bookmark's
 * right-click and the text menu — icons on every row, a shortcut where one exists, a header naming what the menu
 * is about, rows of swatches, and submenus (▸) that open beside their row. When the paper is too narrow for that
 * (#49: the note at its usual width), the submenu takes the menu's place instead, under a ‘‹ 스페이스로 옮기기’ row
 * that goes back — it never covers the menu's words. The keyboard works as in Windows' own menus: ↑ ↓ Home End,
 * → opens a submenu, ← and Esc close it (back to the menu), Enter or Space picks.
 */

export type MenuEntry =
  | { kind: "item"; label: string; icon?: string | null; key?: string; run: () => void; danger?: boolean; checked?: boolean; extra?: Node[]; /** A count before the shortcut (1.30). */ count?: string; disabled?: boolean }
  | { kind: "sub"; label: string; icon?: string | null; entries: () => MenuEntry[]; extra?: Node[] }
  | { kind: "sep" }
  | { kind: "label"; text: string }
  | { kind: "head"; nodes: Node[] }
  | { kind: "chips"; label?: string; options: { value: string; label: string; swatch: string; checked: boolean }[]; pick: (value: string) => void }
  | { kind: "node"; node: HTMLElement };

export interface MenuHost {
  /** Where menus are drawn (the paper) and kept inside. */
  container: HTMLElement;
  /** The menu went away (focus goes back where it was). */
  closed?: () => void;
}

let host: MenuHost | undefined;
let stack: HTMLElement[] = [];
let returnFocus: HTMLElement | null = null;
let hoverTimer: number | undefined;

export const menuOpen = (): boolean => stack.length > 0;
export const menuContains = (node: Node | null): boolean => stack.some((menu) => node !== null && menu.contains(node));

/** Every menu put away; true when one was open. */
export function closeMenus(): boolean {
  if (stack.length === 0) return false;
  for (const menu of stack) menu.remove();
  stack = [];
  window.clearTimeout(hoverTimer);
  const back = returnFocus;
  returnFocus = null;
  if (back?.isConnected) back.focus({ preventScroll: true });
  host?.closed?.();
  return true;
}

function closeFrom(level: number): void {
  for (const menu of stack.splice(level)) menu.remove();
  const parent = stack[level - 1];
  // A submenu that stood in the menu's place (#49): the menu comes back.
  if (parent) parent.style.visibility = "";
  parent?.querySelector<HTMLElement>(".mi.open")?.classList.remove("open");
  parent?.querySelector<HTMLElement>(".mi[aria-expanded='true']")?.setAttribute("aria-expanded", "false");
}

/** Back from a submenu (← · Esc · its ‹ row): the menu again, its row that opened it focused. */
function back(level: number): void {
  const parent = stack[level - 1];
  const opener = parent?.querySelector<HTMLElement>(".mi[aria-expanded='true']");
  closeFrom(level);
  opener?.focus();
}

const rows = (menu: HTMLElement) => [...menu.querySelectorAll<HTMLElement>(":scope > button.mi:not(:disabled), :scope > .swrow > button")];

function build(entries: MenuEntry[], level: number, label: string): HTMLElement {
  const menu = h("div", { class: `menu${level ? " submenu" : ""}`, role: "menu", "aria-label": label, tabindex: "-1" });
  for (const entry of entries) {
    switch (entry.kind) {
      case "sep": menu.append(h("div", { class: "sep", role: "separator" })); break;
      case "label": menu.append(h("div", { class: "label" }, entry.text)); break;
      case "head": menu.append(h("div", { class: "mh" }, ...entry.nodes)); break;
      case "node": menu.append(entry.node); break;
      case "chips": {
        if (entry.label) menu.append(h("div", { class: "label" }, entry.label));
        const row = h("div", { class: "swrow", role: "group", ...(entry.label ? { "aria-label": entry.label } : {}) });
        // At most five a line (#142: eight papers, nine with ‘서랍과 같게’, wrap onto a second line).
        row.style.setProperty("--n", String(Math.min(5, entry.options.length)));
        for (const option of entry.options) {
          const chip = h("button", { role: "menuitemradio", "aria-checked": String(option.checked), title: option.label }, h("i", { class: option.swatch }), h("span", {}, option.label));
          chip.addEventListener("click", () => { closeMenus(); entry.pick(option.value); });
          row.append(chip);
        }
        menu.append(row);
        break;
      }
      case "item": {
        const button = h("button", { class: `mi${entry.danger ? " danger" : ""}`, role: entry.checked !== undefined ? "menuitemcheckbox" : "menuitem", ...(entry.checked !== undefined ? { "aria-checked": String(entry.checked) } : {}) },
          h("span", { class: "ico" }, entry.icon ? icon(entry.icon, 15) : null), ...(entry.extra ?? []), h("span", { class: "t" }, entry.label),
          entry.count !== undefined ? h("span", { class: "cnt" }, entry.count) : null,
          entry.key ? h("span", { class: "k" }, entry.key) : null,
          entry.checked ? h("span", { class: "tick" }, icon("check", 13, 2)) : null);
        if (entry.disabled) button.disabled = true;
        button.addEventListener("click", () => { closeMenus(); entry.run(); });
        button.addEventListener("mouseenter", () => { window.clearTimeout(hoverTimer); hoverTimer = window.setTimeout(() => closeFrom(level + 1), 160); });
        menu.append(button);
        break;
      }
      case "sub": {
        const button = h("button", { class: "mi", role: "menuitem", "aria-haspopup": "menu", "aria-expanded": "false" },
          h("span", { class: "ico" }, entry.icon ? icon(entry.icon, 15) : null), ...(entry.extra ?? []), h("span", { class: "t" }, entry.label), h("span", { class: "k" }, icon("chevronRight", 12)));
        /** `hover`: only beside the menu — a submenu that would take the menu's place waits for a click or →. */
        const open = (focus: boolean, hover = false) => {
          const first = (sub: HTMLElement) => rows(sub).find((row) => !row.classList.contains("back"));
          if (stack[level + 1] && button.classList.contains("open")) { if (focus) first(stack[level + 1])?.focus(); return; }
          closeFrom(level + 1);
          const sub = build(entry.entries(), level + 1, entry.label);
          if (!place(sub, button.getBoundingClientRect(), "beside", menu.getBoundingClientRect())) {
            if (hover) { sub.remove(); return; }
            swapIn(sub, menu, level + 1, entry.label);
          }
          button.classList.add("open");
          button.setAttribute("aria-expanded", "true");
          stack.push(sub);
          // In the menu's place the submenu takes the focus (the menu under it is hidden), so ↑↓ · ← · Esc go on.
          if (focus) first(sub)?.focus({ preventScroll: true });
          else if (sub.classList.contains("swapped")) sub.focus({ preventScroll: true });
        };
        button.addEventListener("click", () => open(false));
        button.addEventListener("mouseenter", () => { window.clearTimeout(hoverTimer); hoverTimer = window.setTimeout(() => open(false, true), 140); });
        button.addEventListener("keydown", (event) => { if (event.key === "ArrowRight" || event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); open(true); } });
        menu.append(button);
        break;
      }
    }
  }
  menu.addEventListener("keydown", (event) => keys(event, menu, level));
  return menu;
}

function keys(event: KeyboardEvent, menu: HTMLElement, level: number): void {
  if (event.defaultPrevented || event.isComposing) return;
  if ((event.target as HTMLElement).tagName === "INPUT") return; // a name field inside a menu types
  const list = rows(menu);
  const at = list.indexOf(document.activeElement as HTMLElement);
  const go = (index: number) => { list[(index + list.length) % list.length]?.focus(); };
  switch (event.key) {
    case "ArrowDown": event.preventDefault(); go(at < 0 ? 0 : at + 1); break;
    case "ArrowUp": event.preventDefault(); go(at < 0 ? list.length - 1 : at - 1); break;
    case "Home": event.preventDefault(); go(0); break;
    case "End": event.preventDefault(); go(list.length - 1); break;
    case "ArrowLeft":
      if (level > 0) { event.preventDefault(); back(level); }
      break;
    case "ArrowRight": {
      // In a row of swatches → moves along it.
      const chips = (document.activeElement as HTMLElement | null)?.closest(".swrow");
      if (chips) { event.preventDefault(); go(at + 1); }
      break;
    }
    case "Escape":
      event.preventDefault(); event.stopPropagation();
      if (level > 0) back(level); else closeMenus();
      break;
    case "Tab": event.preventDefault(); go(at + (event.shiftKey ? -1 : 1)); break;
  }
}

/**
 * A submenu with no room beside its menu (#49) stands in the menu's place: the same top-left, at least as wide, a
 * ‘‹ name’ row on top that goes back, and the menu hidden under it until then.
 */
function swapIn(sub: HTMLElement, menu: HTMLElement, level: number, label: string): void {
  const backRow = h("button", { class: "mi back", role: "menuitem", "aria-label": `${t("이전")}: ${label}`, title: t("이전") },
    h("span", { class: "ico" }, icon("chevronLeft", 14)), h("span", { class: "t" }, label));
  backRow.addEventListener("click", () => back(level));
  backRow.addEventListener("mouseenter", () => window.clearTimeout(hoverTimer));
  sub.prepend(backRow, h("div", { class: "sep", role: "separator" }));
  sub.classList.add("swapped");
  const container = host!.container;
  const box = container.getBoundingClientRect();
  const parent = menu.getBoundingClientRect();
  sub.style.minWidth = `${Math.round(parent.width)}px`;
  const size = sub.getBoundingClientRect();
  const margin = 6;
  const left = Math.max(margin, Math.min(parent.left - box.left, box.width - size.width - margin));
  const top = Math.max(margin, Math.min(parent.top - box.top, box.height - size.height - margin));
  sub.style.left = `${Math.round(left)}px`;
  sub.style.top = `${Math.round(top)}px`;
  menu.style.visibility = "hidden";
}

/**
 * Puts a menu by its anchor inside the paper: below it (or above when there's no room), or beside a row for a
 * submenu (right of the menu, else left), or at a point. False when a submenu has no room on either side (it is
 * in the paper, unplaced: swapIn puts it in the menu's place).
 */
function place(menu: HTMLElement, anchor: DOMRect, how: "below" | "beside" | "point", parent?: DOMRect): boolean {
  const container = host!.container;
  container.append(menu);
  const box = container.getBoundingClientRect();
  const size = menu.getBoundingClientRect();
  const margin = 6;
  let left: number, top: number;
  if (how === "beside" && parent) {
    left = parent.right - box.left - 4;
    if (left + size.width > box.width - margin) left = parent.left - box.left - size.width + 4;
    if (left < margin) return false;
    top = anchor.top - box.top - 5;
  } else if (how === "point") {
    left = anchor.left - box.left;
    top = anchor.top - box.top;
    if (left + size.width > box.width - margin) left = anchor.left - box.left - size.width;
  } else {
    left = anchor.left - box.left;
    top = anchor.bottom - box.top + 4;
    if (top + size.height > box.height - margin) top = anchor.top - box.top - size.height - 4;
  }
  left = Math.max(margin, Math.min(left, box.width - size.width - margin));
  top = Math.max(margin, Math.min(top, box.height - size.height - margin));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  return true;
}

/**
 * Opens a menu (closing any other). `at` is the row or button it belongs to (below it) or a point (a
 * right-click). `keyboard`: opened by a key, so its first row takes the focus.
 */
export function openMenu(menuHost: MenuHost, entries: MenuEntry[], label: string, at: DOMRect | { x: number; y: number }, keyboard = false): HTMLElement {
  closeMenus();
  host = menuHost;
  returnFocus = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
  const menu = build(entries, 0, label);
  if ("width" in at) place(menu, at, "below"); else place(menu, new DOMRect(at.x, at.y, 0, 0), "point");
  stack = [menu];
  const first = menu.querySelector<HTMLElement>("input") ?? (keyboard ? rows(menu)[0] : null);
  (first ?? menu).focus({ preventScroll: true });
  return menu;
}

/** A click anywhere outside the menus puts them away. */
document.addEventListener("mousedown", (event) => {
  // The button that opened it closes it on its own click (it toggles).
  if (stack.length && !menuContains(event.target as Node) && !(event.target as Element | null)?.closest?.('[aria-expanded="true"]')) closeMenus();
}, true);
