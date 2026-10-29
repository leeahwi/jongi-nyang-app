import { h, icon } from "./api";

/**
 * 메모 서랍's menus (1.29): one HTML menu for the ⚙ menu, a memo's ⋯ and right-click, the folder list, a bookmark's
 * right-click and the text menu — icons on every row, a shortcut where one exists, a header naming what the menu
 * is about, rows of swatches, and submenus (▸) that open beside their row (or over the menu when the paper is
 * too narrow). The keyboard works as in Windows' own menus: ↑ ↓ Home End, → opens a submenu, ← and Esc close it,
 * Enter or Space picks.
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
  stack[level - 1]?.querySelector<HTMLElement>(".mi.open")?.classList.remove("open");
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
        row.style.setProperty("--n", String(entry.options.length));
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
        const open = (focus: boolean) => {
          if (stack[level + 1] && button.classList.contains("open")) { if (focus) rows(stack[level + 1])[0]?.focus(); return; }
          closeFrom(level + 1);
          button.classList.add("open");
          button.setAttribute("aria-expanded", "true");
          const sub = build(entry.entries(), level + 1, entry.label);
          place(sub, button.getBoundingClientRect(), "beside", menu.getBoundingClientRect());
          stack.push(sub);
          if (focus) rows(sub)[0]?.focus();
        };
        button.addEventListener("click", () => open(false));
        button.addEventListener("mouseenter", () => { window.clearTimeout(hoverTimer); hoverTimer = window.setTimeout(() => open(false), 140); });
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
      if (level > 0) { event.preventDefault(); const parent = stack[level - 1]; closeFrom(level); parent?.querySelector<HTMLElement>(".mi[aria-expanded='true']")?.focus(); }
      break;
    case "ArrowRight": {
      // In a row of swatches → moves along it.
      const chips = (document.activeElement as HTMLElement | null)?.closest(".swrow");
      if (chips) { event.preventDefault(); go(at + 1); }
      break;
    }
    case "Escape":
      event.preventDefault(); event.stopPropagation();
      if (level > 0) { const parent = stack[level - 1]; closeFrom(level); parent?.querySelector<HTMLElement>(".mi[aria-expanded='true']")?.focus(); } else closeMenus();
      break;
    case "Tab": event.preventDefault(); go(at + (event.shiftKey ? -1 : 1)); break;
  }
}

/**
 * Puts a menu by its anchor inside the paper: below it (or above when there's no room), or beside a row for a
 * submenu (right of the menu, else left, else over the menu's lower right), or at a point.
 */
function place(menu: HTMLElement, anchor: DOMRect, how: "below" | "beside" | "point", parent?: DOMRect): void {
  const container = host!.container;
  container.append(menu);
  const box = container.getBoundingClientRect();
  const size = menu.getBoundingClientRect();
  const margin = 6;
  let left: number, top: number;
  if (how === "beside" && parent) {
    left = parent.right - box.left - 4;
    if (left + size.width > box.width - margin) left = parent.left - box.left - size.width + 4;
    if (left < margin) left = Math.min(parent.left - box.left + 36, box.width - size.width - margin);
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
