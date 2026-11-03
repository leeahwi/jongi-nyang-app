import type { Lang } from "./lang";
import { groupedCount, roParticle } from "./todoSpaces";

/**
 * #168: the rows picked on 오늘 — one (the keyboard's row, as before) or several. A click picks one; Ctrl-click adds or
 * takes away one; Shift-click picks the range from the anchor to it; Shift+↑↓ grows or shrinks that range from the
 * anchor; Esc lets them all go. `order` is the rows as shown, top to bottom. The same rules and cases (S46,
 * spaces-cases.json `multi`) as the macOS app (ListSelection.swift).
 */
export interface ListSelection {
  /** Where a range starts (the last row clicked or Ctrl-clicked). */
  anchor?: string;
  /** The keyboard's row (↑↓ go on from it; the one that's tinted and scrolled to). */
  focus?: string;
  /** Every picked row (the focus too). */
  ids: Set<string>;
}

export const noSelection = (): ListSelection => ({ ids: new Set() });
/** One row picked (or none). */
export const oneSelected = (id: string | undefined): ListSelection => (id ? { anchor: id, focus: id, ids: new Set([id]) } : noSelection());
/** The picked rows in `order`. */
export const orderedSelection = (selection: ListSelection, order: readonly string[]): string[] => order.filter((id) => selection.ids.has(id));

/** Ctrl-click: in or out; the clicked row becomes the anchor, and the focus when it went in (else the first left). */
export function toggleSelection(selection: ListSelection, id: string, order: readonly string[]): ListSelection {
  const ids = new Set(selection.ids);
  if (ids.has(id)) {
    ids.delete(id);
    return { anchor: id, focus: order.find((entry) => ids.has(entry)), ids };
  }
  ids.add(id);
  return { anchor: id, focus: id, ids };
}

/** Shift-click: the rows from the anchor to `id` (a plain click with no anchor). */
export function rangeSelection(selection: ListSelection, id: string, order: readonly string[]): ListSelection {
  const from = selection.anchor ? order.indexOf(selection.anchor) : -1;
  const to = order.indexOf(id);
  if (from < 0 || to < 0) return oneSelected(id);
  return { anchor: selection.anchor, focus: id, ids: new Set(order.slice(Math.min(from, to), Math.max(from, to) + 1)) };
}

/** Shift+↑ (−1) · Shift+↓ (+1): the focus a row further, the rows from the anchor to it. Nothing picked: first or last. */
export function extendSelection(selection: ListSelection, step: number, order: readonly string[]): ListSelection {
  if (order.length === 0) return selection;
  const index = selection.focus ? order.indexOf(selection.focus) : -1;
  if (index < 0) return oneSelected(step > 0 ? order[0] : order[order.length - 1]);
  const next = order[Math.max(0, Math.min(order.length - 1, index + step))];
  const anchor = selection.anchor && order.includes(selection.anchor) ? selection.anchor : selection.focus;
  return rangeSelection({ ...selection, anchor }, next, order);
}

/** Rows no longer shown let go (a fold, the lens, a delete). */
export function keptSelection(selection: ListSelection, order: readonly string[]): ListSelection {
  const shown = new Set(order);
  const ids = new Set([...selection.ids].filter((id) => shown.has(id)));
  const focus = selection.focus && shown.has(selection.focus) ? selection.focus : order.find((id) => ids.has(id));
  const anchor = selection.anchor && shown.has(selection.anchor) ? selection.anchor : focus;
  return { ...(anchor ? { anchor } : {}), ...(focus ? { focus } : {}), ids };
}

/** S47: `ids` put together before (or after) `target`, in the list's order — a drag of several rows. */
export function movedBlock(order: readonly string[], ids: readonly string[], target: string, after: boolean): string[] {
  const moving = new Set(ids);
  if (moving.has(target)) return [...order];
  const block = order.filter((id) => moving.has(id));
  const out = order.filter((id) => !moving.has(id));
  const at = out.indexOf(target);
  if (at < 0) return [...order];
  out.splice(at + (after ? 1 : 0), 0, ...block);
  return out;
}

/** S47: 되돌리기 of a block move — each of `ids` back after the row it followed in `previous`. */
export function restoredOrder(order: readonly string[], ids: readonly string[], previous: readonly string[]): string[] {
  const present = new Set(order);
  const moving = new Set(ids.filter((id) => present.has(id)));
  const out = order.filter((id) => !moving.has(id));
  const placed = new Set(out);
  previous.forEach((id, index) => {
    if (!moving.has(id)) return;
    let anchor: string | undefined;
    for (let back = index - 1; back >= 0; back -= 1) if (placed.has(previous[back])) { anchor = previous[back]; break; }
    out.splice(anchor === undefined ? 0 : out.indexOf(anchor) + 1, 0, id);
    placed.add(id);
  });
  return out;
}

/** "3개를 집으로 옮겼어요" · "Moved 3 to Home" · "3 verplaatst naar Thuis" (`name` in the app's language). */
export function movedManyWords(count: number, name: string, lang: Lang = "ko"): string {
  const n = groupedCount(count, lang);
  return { ko: `${n}개를 ${name}${roParticle(name)} 옮겼어요`, en: `Moved ${n} to ${name}`, nl: `${n} verplaatst naar ${name}` }[lang];
}

/** The badge on a drag of several rows: "3개" · "3" · "3". */
export const badgeWords = (count: number, lang: Lang = "ko"): string => (lang === "ko" ? `${groupedCount(count, lang)}개` : groupedCount(count, lang));
