import type { PaperAPI } from "../preload";
import { lang, t } from "../i18n";

export { lang, t };

declare global {
  interface Window { paper: PaperAPI }
}

export const paper = (): PaperAPI => window.paper;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<Record<string, string>> = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (key === "class") element.className = value; else element.setAttribute(key, value);
  }
  for (const child of children) if (child) element.append(child);
  return element;
}

/**
 * Long Korean help text, ready to wrap: a particle stays on the line of the quote or bracket it
 * follows (‘쉴래요’를, (⌫)로, ↑를), which the browser would otherwise treat as a place to break. Adds an
 * invisible word joiner only; the words are unchanged.
 */
export const wrapText = (text: string) => text.replace(/([’”)\]↑↓←→])(?=[가-힣])/g, "$1\u2060"); // i18n-ok

const hangul = /[\uac00-\ud7a3]/;

/**
 * The page's own words (the HTML's title, text and labels, written in Korean) in the app's
 * language, and `<html lang>` for the fonts (English and Dutch put Caveat and Kalam first).
 */
function localizeDocument(): void {
  document.documentElement.lang = lang();
  if (lang() === "ko") return;
  document.title = t(document.title);
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent ?? "";
    const trimmed = text.trim();
    if (hangul.test(trimmed)) node.textContent = text.replace(trimmed, t(trimmed));
  }
  for (const element of document.body.querySelectorAll("[title], [aria-label], [placeholder], [alt]")) {
    for (const name of ["title", "aria-label", "placeholder", "alt"]) {
      const value = element.getAttribute(name);
      if (value && hangul.test(value)) element.setAttribute(name, t(value));
    }
  }
}
localizeDocument();

export const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Soft 12px fades at the top and bottom of a scrolling box while there is more beyond (base.css
 * `.scroll-fade`): followed on scroll, on resize and when its content changes.
 */
export function scrollFade(element: HTMLElement): void {
  let queued = false;
  const update = () => { queued = false; fadeNow(element); };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(update); } };
  element.addEventListener("scroll", update, { passive: true });
  new ResizeObserver(later).observe(element);
  new MutationObserver(later).observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class"] });
  later();
}

function fadeNow(element: HTMLElement): void {
  // Only real changes touch the class: classList.add of a class already there still counts as a change
  // to a MutationObserver, and scrollFade's own observer would then draw again on every frame.
  const top = element.scrollTop > 2;
  const bottom = element.scrollTop + element.clientHeight < element.scrollHeight - 2;
  if (!element.classList.contains("scroll-fade")) element.classList.add("scroll-fade");
  if (element.classList.contains("fade-top") !== top) element.classList.toggle("fade-top", top);
  if (element.classList.contains("fade-bottom") !== bottom) element.classList.toggle("fade-bottom", bottom);
}

/**
 * The same fades for a page's scrolling column that is drawn anew on each change (a desk pane's
 * content): followed on scroll and window resizes, without observers left behind.
 */
export function edgeFade(element: HTMLElement): void {
  element.addEventListener("scroll", () => fadeNow(element), { passive: true });
  fadeNow(element);
  requestAnimationFrame(() => fadeNow(element));
}
window.addEventListener("resize", () => { for (const element of document.querySelectorAll<HTMLElement>(".scroll-fade")) fadeNow(element); });

export { icon, iconPaths } from "./icons";
