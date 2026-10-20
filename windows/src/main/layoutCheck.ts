/**
 * The size sweep's layout check, run inside a window's page (snapshots only). It looks for what
 * a stretched or shrunk window gets wrong: the page or a box scrolling sideways, content spilling
 * out of its box or clipped without an ellipsis, text cut off at the bottom, things poking out of
 * the window, controls that must stay in view leaving it, and neighbours in a row running into
 * each other. Truncated (ellipsis) text is listed separately: it is fine in a narrow window and a
 * hint that something has room it doesn't use in a wide one. Handwriting whose glyphs reach past
 * the box that clips them ("ink cut") is a problem too.
 */
export interface LayoutCheckOptions {
  /** Elements (and their insides) the generic checks skip: drawn art, deliberate clipping. */
  ignore?: string;
  /** Elements that must sit wholly inside the window when they are shown. */
  inside?: string[];
  /** Flex rows whose shown children must not overlap. */
  rows?: string[];
  /** Boxes that must not need a scrollbar at this size. */
  noScroll?: string[];
  /** Labels and buttons that must stay on one line. */
  oneLine?: string[];
  /** Text fields whose placeholder must show (tall enough for a line) while they are empty. */
  placeholders?: string[];
}

export interface LayoutReport { problems: string[]; truncated: string[] }

/** Runs in the page: no closures over this module, only its argument. */
function check(options: LayoutCheckOptions): LayoutReport {
  const problems: string[] = [];
  const truncated: string[] = [];
  const width = window.innerWidth;
  const height = window.innerHeight;
  const ignore = options.ignore ? `${options.ignore}, svg, img, input, textarea, select, option` : "svg, img, input, textarea, select, option";
  const shown = (element: Element): boolean => {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const ownText = (element: Element) => [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== "");
  const name = (element: Element): string => {
    const classes = element.classList.length ? `.${[...element.classList].slice(0, 3).join(".")}` : "";
    const text = (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 18);
    return `${element.tagName.toLowerCase()}${classes}${text ? ` "${text}"` : ""}`;
  };
  // Something between the element and the page that clips it (so it can't poke out of the window).
  const clipped = (element: Element): boolean => {
    for (let parent = element.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.overflowX !== "visible" || style.overflowY !== "visible") return true;
      if (style.position === "fixed") return false;
    }
    return false;
  };

  const inkContext = document.createElement("canvas").getContext("2d")!;
  const root = document.documentElement;
  if (root.scrollWidth > width + 1 || document.body.scrollWidth > width + 1) problems.push(`page scrolls sideways (${document.body.scrollWidth} > ${width})`);
  if (root.scrollHeight > height + 1 || document.body.scrollHeight > height + 1) problems.push(`page scrolls (${document.body.scrollHeight} > ${height})`);

  for (const element of document.body.querySelectorAll("*")) {
    if (element.closest(ignore) || !shown(element)) continue;
    const html = element as HTMLElement;
    const style = getComputedStyle(html);
    if (html.scrollWidth > html.clientWidth + 1 && html.clientWidth > 0) {
      if (style.overflowX === "auto" || style.overflowX === "scroll") problems.push(`scrolls sideways: ${name(element)}`);
      else if (style.textOverflow === "ellipsis") truncated.push(name(element));
      else if (style.display !== "inline") problems.push(`spills ${html.scrollWidth - html.clientWidth}px: ${name(element)}`);
    }
    if (style.overflowY === "hidden" && ownText(element) && html.scrollHeight > html.clientHeight + 1) {
      // A line clamp ends its last line in an ellipsis: truncated, like text-overflow.
      const clamp = (style as CSSStyleDeclaration & { webkitLineClamp?: string }).webkitLineClamp;
      if (clamp && clamp !== "none") truncated.push(name(element));
      else problems.push(`text cut at the bottom: ${name(element)}`);
    }
    // Wrapped text must break between words: a word split over two lines reads badly.
    const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3;
    if (ownText(element) && style.whiteSpace !== "nowrap" && html.getBoundingClientRect().height > lineHeight * 1.6) {
      for (const node of element.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || node.textContent!.length > 600) continue;
        const text = node.textContent!;
        const range = document.createRange();
        let lastTop: number | undefined;
        for (let index = 0; index < text.length; index += 1) {
          range.setStart(node, index);
          range.setEnd(node, index + 1);
          const box = range.getClientRects()[0];
          if (!box) continue;
          const before = text[index - 1] === "\u2060" ? text[index - 2] : text[index - 1];
          // Korean next to anything word-like, or two Latin letters (English and Dutch break only at spaces and hyphens).
          const korean = /[가-힣A-Za-z0-9]/.test(text[index]) && /[가-힣A-Za-z0-9)’”'"~↑↓←→]/.test(before ?? " ") && /[가-힣]/.test(text[index] + (before ?? "")); // i18n-ok
          const latin = /[A-Za-zÀ-ÿ]/.test(text[index]) && /[A-Za-zÀ-ÿ]/.test(before ?? " ");
          if (lastTop !== undefined && box.top > lastTop + 2 && (korean || latin)) {
            problems.push(`breaks a word: ${name(element)} at "${text.slice(Math.max(0, index - 4), index)}|${text.slice(index, index + 3)}"`);
            break;
          }
          lastTop = box.top;
        }
      }
    }
    // Ink cut by the box's own clipping: a whole (not ellipsized) line whose drawn glyphs reach past the
    // padding box — Caveat's and Kalam's d, e, f, k overhang their advance width ("Ahead" read "Aheaa").
    if (style.overflowX !== "visible" && style.whiteSpace === "nowrap" && ownText(element) && html.scrollWidth <= html.clientWidth + 1) {
      const box = html.getBoundingClientRect();
      const left = box.left + (parseFloat(style.borderLeftWidth) || 0);
      const right = left + html.clientWidth;
      inkContext.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      inkContext.letterSpacing = style.letterSpacing === "normal" ? "0px" : style.letterSpacing;
      for (const node of element.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE || !node.textContent!.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const at = range.getBoundingClientRect();
        if (!at.width) continue;
        const ink = inkContext.measureText(node.textContent!);
        const inkRight = at.left + ink.actualBoundingBoxRight;
        const inkLeft = at.left - ink.actualBoundingBoxLeft;
        if (inkRight > right + 0.5) problems.push(`ink cut at the end (${(inkRight - right).toFixed(1)}px): ${name(element)}`);
        if (inkLeft < left - 0.5) problems.push(`ink cut at the start (${(left - inkLeft).toFixed(1)}px): ${name(element)}`);
      }
    }
    const rect = html.getBoundingClientRect();
    if ((rect.right > width + 1 || rect.left < -1) && style.position !== "fixed" && !clipped(element)) problems.push(`out of the window: ${name(element)} (${Math.round(rect.left)}–${Math.round(rect.right)})`);
  }

  for (const selector of options.inside ?? []) {
    for (const element of document.querySelectorAll(selector)) {
      if (!shown(element)) continue;
      const rect = element.getBoundingClientRect();
      if (rect.left < -0.5 || rect.top < -0.5 || rect.right > width + 0.5 || rect.bottom > height + 0.5) problems.push(`not in view: ${name(element)} (${Math.round(rect.left)},${Math.round(rect.top)}–${Math.round(rect.right)},${Math.round(rect.bottom)})`);
    }
  }

  for (const selector of options.rows ?? []) {
    for (const row of document.querySelectorAll(selector)) {
      if (!shown(row)) continue;
      const children = [...row.children].filter(shown).map((child) => ({ child, rect: child.getBoundingClientRect() }));
      for (let a = 0; a < children.length; a += 1) {
        for (let b = a + 1; b < children.length; b += 1) {
          const one = children[a].rect, two = children[b].rect;
          const across = Math.min(one.right, two.right) - Math.max(one.left, two.left);
          const down = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
          if (across > 1 && down > 1) problems.push(`overlap in ${selector}: ${name(children[a].child)} / ${name(children[b].child)}`);
        }
      }
    }
  }

  for (const selector of options.noScroll ?? []) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (shown(element) && element.scrollHeight > element.clientHeight + 1) problems.push(`needs a scrollbar: ${name(element)} (${element.scrollHeight} > ${element.clientHeight})`);
    }
  }
  for (const selector of options.oneLine ?? []) {
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      if (!shown(element)) continue;
      // The text's line boxes: more than a line apart means it wrapped.
      const tops: number[] = [];
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent!.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const box of range.getClientRects()) if (box.width > 0) tops.push(box.top);
      }
      if (tops.length && Math.max(...tops) - Math.min(...tops) > parseFloat(getComputedStyle(element).fontSize) * 0.9) problems.push(`wraps: ${name(element)}`);
    }
  }
  for (const selector of options.placeholders ?? []) {
    for (const field of document.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>(selector)) {
      // Laid out (a 0px-tall field counts: that is the fault looked for), not hidden, and empty.
      if (!field.getClientRects().length || getComputedStyle(field).visibility === "hidden" || field.value) continue;
      const style = getComputedStyle(field);
      if (!field.placeholder.trim()) problems.push(`no placeholder: ${name(field)}`);
      else if (field.clientHeight < parseFloat(style.fontSize)) problems.push(`placeholder hidden (field ${field.clientHeight}px tall): ${name(field)}`);
    }
  }
  return { problems: [...new Set(problems)], truncated: [...new Set(truncated)] };
}

/** The script to run in a window for `executeJavaScript`. */
export function layoutCheckScript(options: LayoutCheckOptions): string {
  return `(${check.toString()})(${JSON.stringify(options)})`;
}
