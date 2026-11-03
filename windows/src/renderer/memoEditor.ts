import { history, historyKeymap, insertNewline, standardKeymap, undo } from "@codemirror/commands";
import { Annotation, EditorState, StateEffect, StateField, Transaction, type Extension, type Range, type Text } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, WidgetType, keymap, placeholder, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { isCodeLine } from "../core/memoDrawer";
import { enter, heading, indent, link, linkAt, moveLines, paste, rule, setLink, tick, tickAtCaret, toggleLines, wrap, type Edit } from "../core/memoEdits";
import { inlineSpans, isFenceLine, lineSpans, readLine, type LineRead, type MarkSpan } from "../core/memoMarkdown";
import { endsParagraph } from "../core/textSteps";
import { h, motion, reduceMotion } from "./api";
import { icon } from "./icons";

/**
 * 메모 마크다운 (#84, docs/plans/memo-markdown.md): the open memo's words under its title, in CodeMirror 6 — styled as
 * written, the marks kept but faint (40 % of the ink), with our own reading of the marks (core/memoMarkdown.ts, the
 * Mac's rules and cases) instead of a language package. A <textarea> with a styled layer over it can't do this: a bold
 * word or a heading is wider than the plain one under it, and the caret would stand apart from the words.
 *
 * Only the lines on screen are styled (a 1 MB memo costs no more than a short one per key); whether a line is inside a
 * ``` block comes from the code fences' places, kept as the text changes. Korean composition, undo, the screen
 * reader's label and the keys of the textarea it replaces (arrows, Home/End, Ctrl+A/Z/Y, Ctrl+Backspace …; Enter a
 * plain new line; Tab leaves the text) are CodeMirror's own.
 */

/** A change made from outside (another device, the note, a menu): it isn't typed, so it isn't sent back or undone. */
const fromOutside = Annotation.define<boolean>();

/** Where the ``` lines start, in order: a line is in a code block when an odd number of them come before it. */
const fences = StateField.define<number[]>({
  create: (state) => scanFences(state.doc, 1, state.doc.lines),
  update(value, transaction) {
    if (!transaction.docChanged) return value;
    const doc = transaction.newDoc;
    let kept = value.map((position) => transaction.changes.mapPos(position, 1));
    const found: number[] = [];
    transaction.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      const first = doc.lineAt(fromB), last = doc.lineAt(toB);
      kept = kept.filter((position) => position < first.from || position > last.to);
      found.push(...scanFences(doc, first.number, last.number));
    });
    return [...new Set([...kept, ...found])].sort((a, b) => a - b);
  },
});

function scanFences(doc: Text, from: number, to: number): number[] {
  const out: number[] = [];
  for (let number = from; number <= to; number += 1) {
    const line = doc.line(number);
    if (line.length >= 3 && isFenceLine(line.text)) out.push(line.from);
  }
  return out;
}

/** #134: the title line (its own editor) is a ``` fence: a code block is open where the words under it start. */
const setOpenAbove = StateEffect.define<boolean>();
const openAbove = StateField.define<boolean>({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setOpenAbove)) value = effect.value;
    return value;
  },
});

/** Whether a code block is open where a line starting at `position` starts (the title's fence counted first). */
function inBlockAt(list: readonly number[], position: number, above = false): boolean {
  let low = 0, high = list.length;
  while (low < high) { const middle = (low + high) >> 1; if (list[middle] < position) low = middle + 1; else high = middle; }
  return (low % 2 === 1) !== above;
}
const inBlockOf = (state: EditorState, position: number) => inBlockAt(state.field(fences), position, state.field(openAbove));

const mark = (name: string) => Decoration.mark({ class: name });
const marks: Partial<Record<MarkSpan["kind"], Decoration>> = {
  mark: mark("md-mark"), bold: mark("md-bold"), italic: mark("md-italic"), strike: mark("md-strike"), code: mark("md-code"),
  link: mark("md-link"), url: mark("md-link"),
};
const lineClass = (name: string) => Decoration.line({ class: name });
const paragraphEnd = lineClass("md-para");
const lines = {
  heading: [lineClass("md-h1"), lineClass("md-h2"), lineClass("md-h3")],
  code: lineClass("md-codeline"), fence: lineClass("md-codeline md-fence"), quote: lineClass("md-quote"), rule: lineClass("md-rule"),
  oldCode: lineClass("md-oldcode"),
};

/** A list item's words hang after its mark: the mark's width, measured in the editor's own face. */
const measured = new Map<string, number>();
let measure: CanvasRenderingContext2D | null | undefined;
function widthOf(prefix: string, font: string): number {
  const key = `${font}\u0000${prefix}`;
  let width = measured.get(key);
  if (width === undefined) {
    measure ??= document.createElement("canvas").getContext("2d");
    if (!measure) return 0;
    measure.font = font;
    width = Math.ceil(measure.measureText(prefix.replace(/\t/g, "    ")).width);
    if (measured.size > 400) measured.clear();
    measured.set(key, width);
  }
  return width;
}

/** A list's hidden `- ` drawn as • (2026-10-30). */
class Bullet extends WidgetType {
  toDOM(): HTMLElement { const dot = document.createElement("span"); dot.className = "md-dot"; dot.textContent = "• "; return dot; }
  eq(): boolean { return true; }
}
const bullet = Decoration.replace({ widget: new Bullet() });
const hidden = Decoration.replace({});

/**
 * #163: the box just clicked — where it is and when — so it is drawn ticking (filling, its mark drawn in, then its words
 * fading to done; drawer.css `.pop`) or unticking (`.unpop`, quicker). Drawing only: the words changed at the click.
 */
let ticked: { pos: number; at: number; on: boolean } | undefined;
const tickMotion = (pos: number): "" | " pop" | " unpop" =>
  ticked && ticked.pos === pos && performance.now() - ticked.at < 400 ? (ticked.on ? " pop" : " unpop") : "";
const reducedMotion = reduceMotion;

/** A checklist's hidden `- [ ] ` drawn as the card's box (#133); a click on it — or near it (#163) — ticks it. */
class Box extends WidgetType {
  constructor(readonly checked: boolean, readonly motion: "" | " pop" | " unpop" = "") { super(); }
  toDOM(): HTMLElement {
    const box = h("span", { class: `bx md-box${this.checked ? " on" : ""}${this.motion}`, "aria-hidden": "true" }, icon("check", 10, 3));
    return box;
  }
  /** The motion isn't part of the look: a redraw while a box ticks keeps its element (and its animation). */
  eq(other: Box): boolean { return other.checked === this.checked; }
  /** The editor lets the click through to boxClicks (it would otherwise ignore what happens inside a widget). */
  ignoreEvent(): boolean { return false; }
}
const boxes = [Decoration.replace({ widget: new Box(false) }), Decoration.replace({ widget: new Box(true) })];
/** The box (15 px since #163, as the note's own boxes read beside the words) and the gap after it (.ck's 7 px). */
const boxWidth = 15 + 7;
const done = mark("md-done");
const doneFading = mark("md-done md-done-pop");

/**
 * One line's look: its block as a line decoration, its marks as marks. `reveal`: the caret's or the selection's line
 * (or 기호 늘 보이기) — its marks shown faint; elsewhere they are hidden (#84, 2026-10-30): no width, a list's `- `
 * drawn as •, a number shown.
 */
function decorate(text: string, from: number, read: LineRead, font: () => string, reveal: boolean, out: Range<Decoration>[]): void {
  switch (read.kind) {
    case "heading": out.push(lines.heading[Math.max(0, Math.min(2, read.level - 1))].range(from)); break;
    case "code": out.push(lines.code.range(from)); return;
    case "fence": out.push(lines.fence.range(from)); break;
    case "quote": out.push(lines.quote.range(from)); break;
    case "rule": out.push(lines.rule.range(from)); break;
    case "check": {
      // The words hang after the box (#133), or after the marks on the caret's line.
      const face = font();
      const hang = face ? (reveal ? widthOf(text.slice(0, read.words), face) : widthOf(text.slice(0, read.markFrom), face) + boxWidth) : 0;
      out.push(Decoration.line({ class: "md-check", attributes: { style: `padding-left: ${hang}px; text-indent: -${hang}px` } }).range(from));
      const motion = reveal ? "" : tickMotion(from + read.markFrom);
      out.push((reveal ? marks.mark! : motion ? Decoration.replace({ widget: new Box(Boolean(read.checked), motion) }) : boxes[read.checked ? 1 : 0]).range(from + read.markFrom, from + read.words));
      if (read.checked && read.end > read.words) out.push((motion === " pop" ? doneFading : done).range(from + read.words, from + read.end));
      break;
    }
    case "list": case "olist": {
      const face = font();
      const prefix = !reveal && read.kind === "list" ? `${text.slice(0, read.markFrom)}• ` : text.slice(0, read.words);
      const hang = face ? widthOf(prefix, face) : 0;
      out.push(Decoration.line({ attributes: { style: `padding-left: ${hang}px; text-indent: -${hang}px` } }).range(from));
      break;
    }
    case "blank": return;
  }
  const spans: MarkSpan[] = [];
  lineSpans(text, read, from, spans);
  if (read.kind === "text" && !spans.some((span) => span.kind === "code") && isCodeLine(text)) out.push(lines.oldCode.range(from));
  for (const span of spans) {
    if (span.to <= span.from) continue;
    if (span.kind === "mark" && !reveal) {
      const block = span.from === from + read.markFrom;
      if (block && read.kind === "olist") out.push(marks.mark!.range(span.from, span.to));
      else out.push((block && read.kind === "list" ? bullet : hidden).range(span.from, span.to));
      continue;
    }
    const decoration = marks[span.kind];
    if (decoration) out.push(decoration.range(span.from, span.to));
  }
}

/** 기호 늘 보이기: every line's marks shown (the drawer sets it; one memo is typed at a time). */
let showAllMarks = false;

/** The lines the selection touches, as "first-last" line numbers (the plugin draws again when they change). */
function touched(view: EditorView): { key: string; ranges: [number, number][] } {
  const ranges = view.state.selection.ranges.map((range): [number, number] => [view.state.doc.lineAt(range.from).number, view.state.doc.lineAt(range.to).number]);
  return { key: ranges.map(([a, b]) => `${a}-${b}`).join(","), ranges };
}

/** The marks of the lines on screen, drawn again when the words, the lines shown, the caret's lines or the face change. */
const markdownLook = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  private font = "";
  private stale = false;
  private caret = "";
  constructor(view: EditorView) { this.decorations = this.build(view); }
  update(update: ViewUpdate) {
    const moved = update.selectionSet && !showAllMarks && touched(update.view).key !== this.caret;
    const above = update.transactions.some((transaction) => transaction.effects.some((effect) => effect.is(setOpenAbove)));
    if (update.docChanged || update.viewportChanged || update.geometryChanged || moved || above || this.stale) { this.stale = false; this.decorations = this.build(update.view); }
  }
  build(view: EditorView): DecorationSet {
    const list = view.state.field(fences), above = view.state.field(openAbove);
    const out: Range<Decoration>[] = [];
    // The face is read from the page only when a list item needs its hanging width, once (a style read on every key
    // would make the page work out its styles again each time).
    const font = () => {
      if (!this.font && view.contentDOM.isConnected) { const style = getComputedStyle(view.contentDOM); this.font = style.font || `${style.fontSize} ${style.fontFamily}`; }
      return this.font;
    };
    const caret = touched(view);
    this.caret = caret.key;
    for (const { from, to } of view.visibleRanges) {
      for (let position = from; position <= to;) {
        const line = view.state.doc.lineAt(position);
        const reveal = showAllMarks || caret.ranges.some(([a, b]) => line.number >= a && line.number <= b);
        const read = readLine(line.text, inBlockAt(list, line.from, above));
        decorate(line.text, line.from, read, font, reveal, out);
        // 문단 간격 (#141): the room under a paragraph's last line (--m-para; a list's lines stay together).
        const next = line.number < view.state.doc.lines ? view.state.doc.line(line.number + 1) : undefined;
        if (next && endsParagraph(read.kind, readLine(next.text, inBlockAt(list, next.from, above)).kind)) out.push(paragraphEnd.range(line.from));
        position = line.to + 1;
      }
    }
    return Decoration.set(out, true);
  }
  /** The face or 기호 늘 보이기 changed: measured and drawn again on the next update. */
  refont() { this.font = ""; this.stale = true; }
}, { decorations: (plugin) => plugin.decorations });

/** ⌘/Ctrl+click on a link's words or a bare address: the drawer opens it. */
function linkClicks(open: (url: string) => void): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (position === null) return false;
      const line = view.state.doc.lineAt(position);
      const read = readLine(line.text, inBlockOf(view.state, line.from));
      if (read.kind === "code" || read.kind === "fence") return false;
      const spans: MarkSpan[] = [];
      inlineSpans(line.text, read.words, read.end, line.from, spans);
      const at = spans.findIndex((span) => (span.kind === "link" || span.kind === "url") && span.from <= position && position <= span.to);
      if (at < 0) return false;
      const span = spans[at];
      const address = span.kind === "url" ? line.text.slice(span.from - line.from, span.to - line.from)
        : (() => { const url = spans.slice(at).find((entry) => entry.kind === "linkurl"); return url ? line.text.slice(url.from - line.from + 1, url.to - line.from - 1) : ""; })();
      if (!/^(https?:|mailto:)/i.test(address)) return false;
      event.preventDefault();
      open(address);
      return true;
    },
  });
}

/**
 * A click on a checklist's box ticks it (#133): the caret kept on its own words. #163: the box's target reaches round it
 * (drawer.css `.md-box::before`), and the tick is drawn — the box fills and its mark draws in, then the words fade to
 * done. The words change at once; with 끝낸 항목 아래로 the line goes down only once that is drawn (0.36 s; unticked, back
 * up after 0.14 s), the tick taken back and made again with the move, so the two are one undo. Reduce motion: at once.
 */
/** #163: the box a click is on or near — within about 25 × 25 round its middle, as the note's boxes take clicks. */
export function nearBox(root: Element, x: number, y: number, selector: string): HTMLElement | null {
  const reach = 12.5;
  for (const box of root.querySelectorAll<HTMLElement>(selector)) {
    const r = box.getBoundingClientRect();
    if (Math.abs(x - (r.left + r.width / 2)) <= reach && Math.abs(y - (r.top + r.height / 2)) <= reach) return box;
  }
  return null;
}

function boxClicks(doneToBottom: () => boolean): Extension {
  return EditorView.domEventHandlers({
    mousedown(event, view) {
      const hitBox = event.target instanceof Element ? event.target.closest(".md-box") : null;
      // Near a box (not on it): only from the margin round it, not from inside the words (where a click places the caret).
      const target = hitBox ?? (event.target instanceof Element && (event.target === view.contentDOM || event.target.classList.contains("cm-line") || event.target.closest(".md-box"))
        ? nearBox(view.contentDOM, event.clientX, event.clientY, ".md-box") : null);
      if (!target || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || view.composing) return false;
      const lineAt = view.state.doc.lineAt(view.posAtDOM(target));
      const line = lineAt.number - 1;
      const { from, to } = view.state.selection.main;
      const before = view.state.doc.toString();
      event.preventDefault();
      const move = doneToBottom();
      if (reducedMotion()) return apply(view, tick(before, line, from, to, move));
      const read = readLine(lineAt.text, inBlockOf(view.state, lineAt.from));
      const on = !read.checked;
      ticked = { pos: lineAt.from + read.markFrom, at: performance.now(), on };
      if (!apply(view, tick(before, line, from, to, false))) { ticked = undefined; return false; }
      if (move) {
        const after = view.state.doc;
        setTimeout(() => {
          // Only if nothing was typed meanwhile (an undo then would take that too).
          if (view.state.doc !== after || view.composing) return;
          ticked = undefined;
          undo(view);
          apply(view, tick(before, line, from, to, true));
        }, (on ? motion.enter + motion.change : motion.quick) + 20);
      }
      return true;
    },
  });
}

/** What the Aa bar's buttons and the formatting keys do. */
export type MemoFormat = "bold" | "italic" | "strike" | "code" | "heading" | "list" | "olist" | "check" | "quote" | "rule" | "link";

export interface BodyEditor {
  view: EditorView;
  /** The editor's element (placed in the card or 크게 보기). */
  dom: HTMLElement;
  text(): string;
  /** Words from outside, the caret kept at `caret` (not typed: not sent back, not in undo). */
  replace(text: string, caret?: number): void;
  /** Takes the keyboard with the caret at `at` (the end when not given). */
  focus(at?: number): void;
  readonly composing: boolean;
  /** The drawer's face or size, or 기호 늘 보이기, changed: list items hang again, the marks drawn again. */
  refont(showMarks: boolean): void;
  /** The Aa bar: a format on the selection or at the caret. */
  format(format: MemoFormat): void;
  /** Ctrl+Shift+V: the next paste comes in as it is. */
  pastePlain(): void;
  /** #135: the link field's Return — the words made a link, its address changed or the link taken out (one undo). */
  setLink(request: LinkRequest, url: string): void;
  /** #134: the title line is (or no longer is) a ``` fence: the words under it start in a code block, or don't. */
  setOpenAbove(open: boolean): void;
}

export interface BodyOptions {
  text: string;
  label: string;
  placeholder: string;
  /** A key changed the words (not a change from outside). */
  typed: () => void;
  /** Backspace with the caret at the very start (the title takes the first line back); true: done. */
  backspaceAtStart: () => boolean;
  /** ↑ at the very start (to the title). */
  upAtStart: () => boolean;
  blur: () => void;
  composed: () => void;
  openLink: (url: string) => void;
  /** Ctrl+Shift+R: 기호 늘 보이기 on or off. */
  toggleMarks: () => void;
  /** Ctrl+Shift+V: the page's own paste (the clipboard is the main process's). */
  paste: () => void;
  /** 끝낸 항목 아래로 보내기, read when a box is clicked (#133). */
  doneToBottom: () => boolean;
  /** #135: Ctrl+K on chosen words or in a link — the drawer shows the link field. */
  askLink?: (request: LinkRequest) => void;
  /** #134: the title line is a ``` fence (the words start in a code block). */
  openAbove?: boolean;
}

/**
 * In a card, the editor is exactly as tall as its lines, set here and contained (drawer.css): a key that doesn't add or
 * take away a line is laid out inside it alone, not with the 2,000 cards of the list around it (as the textarea's own
 * height did). 크게 보기 sizes it by the sheet instead.
 */
function fitHeight(view: EditorView): void {
  const dom = view.dom;
  if (!dom.isConnected || dom.closest(".big")) { if (dom.style.height) dom.style.height = ""; return; }
  const height = `${Math.max(52, Math.ceil(view.contentHeight))}px`;
  if (dom.style.height !== height) dom.style.height = height;
}

/**
 * The words made what `edit` says (core/memoEdits.ts): only the part that differs is replaced (a 1 MB memo isn't put
 * back whole), as one typed change (one undo); then the selection.
 */
function apply(view: EditorView, edit: Edit | undefined): boolean {
  if (!edit || view.composing) return false;
  const old = view.state.doc.toString(), next = edit.text;
  let start = 0;
  const limit = Math.min(old.length, next.length);
  while (start < limit && old.charCodeAt(start) === next.charCodeAt(start)) start += 1;
  let tail = 0;
  while (tail < limit - start && old.charCodeAt(old.length - 1 - tail) === next.charCodeAt(next.length - 1 - tail)) tail += 1;
  view.dispatch({
    changes: { from: start, to: old.length - tail, insert: next.slice(start, next.length - tail) },
    selection: { anchor: edit.from, head: edit.to },
    userEvent: "input",
    scrollIntoView: true,
  });
  return true;
}

/** #135: the link field asked for — the chosen words (or the link the caret is in) and the address it starts with. */
export interface LinkRequest { from: number; to: number; url: string; existing: boolean }

/**
 * Ctrl+K (and the Aa bar's link): the link field on chosen words or with the caret in a link (SideNotes' way); with
 * nothing chosen, `[]()` as before. True: the field was asked for.
 */
function askLink(view: EditorView, ask: ((request: LinkRequest) => void) | undefined): boolean {
  if (!ask || view.composing) return false;
  const text = view.state.doc.toString();
  const { from, to } = view.state.selection.main;
  const found = linkAt(text, from, to);
  if (found) { ask({ from, to, url: found.url, existing: true }); return true; }
  if (to <= from || text.slice(from, to).includes("\n")) return false;
  ask({ from, to, url: "", existing: false });
  return true;
}

/** A format on the editor's selection (one range: the main one). */
function formatIn(view: EditorView, format: MemoFormat): boolean {
  const text = view.state.doc.toString();
  const { from, to } = view.state.selection.main;
  const edit = format === "bold" ? wrap(text, from, to, "**") : format === "italic" ? wrap(text, from, to, "*") : format === "strike" ? wrap(text, from, to, "~~")
    : format === "code" ? wrap(text, from, to, "`") : format === "heading" ? heading(text, from, to, "cycle") : format === "rule" ? rule(text, from, to)
      : format === "link" ? link(text, from, to) : toggleLines(text, from, to, format);
  return apply(view, edit);
}

/** The open memo's words after its title line, in CodeMirror (see above). */
export function memoBodyEditor(options: BodyOptions): BodyEditor {
  const atStart = (view: EditorView) => { const range = view.state.selection.main; return range.empty && range.head === 0; };
  const sel = (view: EditorView) => view.state.selection.main;
  const run = (make: (text: string, from: number, to: number) => Edit | undefined) => (view: EditorView) => apply(view, make(view.state.doc.toString(), sel(view).from, sel(view).to));
  const format = (name: MemoFormat) => (view: EditorView) => formatIn(view, name);
  let plainNext = false;
  const view = new EditorView({
    parent: h("div", { class: "editor-host" }),
    state: EditorState.create({
      doc: options.text,
      extensions: [
        history(),
        keymap.of([
          { key: "Backspace", run: (editor) => atStart(editor) && options.backspaceAtStart() },
          { key: "ArrowUp", run: (editor) => atStart(editor) && options.upAtStart() },
          // ↩ continues a list, a checklist, a number or a quote (an empty item ends it); elsewhere a plain new line.
          // Shift+Enter: a plain new line in the same item.
          { key: "Enter", run: (editor) => run(enter)(editor) || insertNewline(editor), shift: insertNewline },
          // 메모 서식 (#84): Ctrl+B · I · Shift+X · E · K, Ctrl+Shift+L · U · R, Tab · Shift+Tab, Alt+↑ · ↓, Ctrl+Shift+V.
          { key: "Mod-b", run: format("bold") },
          { key: "Mod-i", run: format("italic") },
          { key: "Mod-Shift-x", run: format("strike") },
          { key: "Mod-e", run: format("code") },
          { key: "Mod-k", run: (editor) => askLink(editor, options.askLink) || formatIn(editor, "link") },
          { key: "Mod-Shift-l", run: format("check") },
          // The caret's box ticked or unticked (#133; Apple Notes' Mark as Checked), as a click on it: one undo. Before
          // the history keys, whose Ctrl+Shift+U (redo the selection) it takes; off a checklist line it does nothing.
          { key: "Mod-Shift-u", run: (editor) => { run((text, from, to) => tickAtCaret(text, from, to, options.doneToBottom()))(editor); return true; } },
          { key: "Mod-Shift-r", run: () => { options.toggleMarks(); return true; } },
          { key: "Mod-Shift-v", run: () => { plainNext = true; options.paste(); return true; } },
          { key: "Tab", run: run((text, from, to) => indent(text, from, to, false)) },
          { key: "Shift-Tab", run: run((text, from, to) => indent(text, from, to, true)) },
          { key: "Alt-ArrowUp", run: run((text, from, to) => moveLines(text, from, to, true)) },
          { key: "Alt-ArrowDown", run: run((text, from, to) => moveLines(text, from, to, false)) },
          ...standardKeymap,
          ...historyKeymap,
        ]),
        EditorView.lineWrapping,
        EditorView.contentAttributes.of({ "aria-label": options.label, spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
        placeholder(options.placeholder),
        fences,
        openAbove.init(() => options.openAbove ?? false),
        markdownLook,
        linkClicks(options.openLink),
        boxClicks(options.doneToBottom),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(fromOutside))) options.typed();
          if (update.heightChanged || update.geometryChanged) fitHeight(update.view);
        }),
        EditorView.domEventHandlers({
          blur: () => { options.blur(); return false; },
          compositionend: () => { options.composed(); return false; },
          // Ctrl+Alt+1–3 · 0: a heading or none (by the key's place; AltGr, which also reads as Ctrl+Alt, types as it does).
          keydown: (event, editor) => {
            if (!event.ctrlKey || !event.altKey || event.shiftKey || event.metaKey || event.getModifierState("AltGraph")) return false;
            const digit = /^Digit([0-3])$/.exec(event.code);
            if (!digit) return false;
            event.preventDefault();
            return run((text, from, to) => heading(text, from, to, Number(digit[1])))(editor);
          },
          // A bare address over a selection makes a link; lines of code onto an empty line come in ``` fences.
          paste: (event, editor) => {
            if (plainNext) { plainNext = false; return false; }
            const pasted = event.clipboardData?.getData("text/plain");
            if (!pasted) return false;
            const { from, to } = sel(editor);
            if (!apply(editor, paste(editor.state.doc.toString(), from, to, pasted))) return false;
            event.preventDefault();
            return true;
          },
        }),
      ],
    }),
  });
  const dom = view.dom;
  dom.classList.add("editor");
  return {
    view,
    dom,
    text: () => view.state.doc.toString(),
    replace(text, caret) {
      const length = text.length;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: caret === undefined ? undefined : { anchor: Math.min(caret, length) },
        annotations: [fromOutside.of(true), Transaction.addToHistory.of(false)],
      });
    },
    focus(at) {
      const anchor = Math.min(at ?? view.state.doc.length, view.state.doc.length);
      view.dispatch({ selection: { anchor }, scrollIntoView: true });
      view.focus();
    },
    get composing() { return view.composing; },
    refont(showMarks) { showAllMarks = showMarks; view.plugin(markdownLook)?.refont(); view.requestMeasure(); view.dispatch({}); },
    format(name) { if (!(name === "link" && askLink(view, options.askLink))) { formatIn(view, name); view.focus(); } },
    pastePlain() { plainNext = true; },
    setLink(request, url) {
      if (request.to <= view.state.doc.length) apply(view, setLink(view.state.doc.toString(), request.from, request.to, url));
      view.focus();
    },
    setOpenAbove(open) { if (view.state.field(openAbove) !== open) view.dispatch({ effects: setOpenAbove.of(open) }); },
  };
}

/**
 * #134: the open memo's title line in CodeMirror too (one line, the handwriting face), so its marks are drawn as the
 * Mac draws them: hidden, faint while the title has the caret (or 기호 늘 보이기); a list's `- ` as •. The title's look
 * wins over the marks' (no bold, no heading size), as on the Mac. A line break typed or pasted into it is a space;
 * Enter and ↓ are the drawer's (the rest of the line starts the words under it, ↓ goes to them).
 */
export interface TitleEditor {
  view: EditorView;
  dom: HTMLElement;
  value(): string;
  /** Words from outside (not typed: not sent back, not in undo), the caret at `caret` when given. */
  setValue(text: string, caret?: number): void;
  /** Where the caret is. */
  caret(): number;
  /** Takes the keyboard with the caret at `at` (the end when not given). */
  focus(at?: number): void;
  readonly composing: boolean;
  /** 기호 늘 보이기 changed. */
  refont(showMarks: boolean): void;
}

export interface TitleOptions {
  text: string;
  label: string;
  placeholder: string;
  /** A key changed the words. */
  typed: () => void;
  composed: () => void;
  blur: () => void;
  /** Enter with the caret at `at`: the rest of the line starts the words. */
  enter: (at: number) => boolean;
  /** ↓: to the words. */
  down: () => boolean;
}

/** Snapshots: the title drawn as if it had the caret (an off-screen window never has the keyboard). */
let titleCaretShown = false;
export function showTitleCaret(on: boolean): void { titleCaretShown = on; }

function titleMarks(view: EditorView): DecorationSet {
  const text = view.state.doc.toString();
  if (!text) return Decoration.none;
  const read = readLine(text, false);
  if (read.kind === "code" || read.kind === "blank") return Decoration.none;
  const reveal = showAllMarks || titleCaretShown || view.hasFocus;
  const spans: MarkSpan[] = [];
  lineSpans(text, read, 0, spans);
  const out: Range<Decoration>[] = [];
  for (const span of spans) {
    if (span.kind !== "mark" || span.to <= span.from) continue;
    const block = span.from === read.markFrom;
    if (reveal || (block && read.kind === "olist")) out.push(marks.mark!.range(span.from, span.to));
    else out.push((block && read.kind === "list" ? bullet : hidden).range(span.from, span.to));
  }
  return Decoration.set(out, true);
}

const titleLook = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  private stale = false;
  constructor(view: EditorView) { this.decorations = titleMarks(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.focusChanged || this.stale) { this.stale = false; this.decorations = titleMarks(update.view); }
  }
  restyle() { this.stale = true; }
}, { decorations: (plugin) => plugin.decorations });

/** A line break in the title: a space; a lone carriage return (a Windows line end) dropped, as the <input> did. */
const oneLine = (text: string) => text.replace(/\r(?!\n)/g, "").replace(/\r?\n/g, " ");

/** The open memo's title line (see TitleEditor). */
export function memoTitleEditor(options: TitleOptions): TitleEditor {
  const view = new EditorView({
    parent: h("div", { class: "title-host" }),
    state: EditorState.create({
      doc: oneLine(options.text),
      extensions: [
        history(),
        // One line: a break typed or pasted in becomes a space (as the <input> it replaces did).
        EditorState.transactionFilter.of((transaction) => {
          if (!transaction.docChanged || transaction.newDoc.lines === 1) return transaction;
          const flat = transaction.newDoc.toString().replace(/\r?\n/g, " ");
          return [transaction, { changes: { from: 0, to: transaction.newDoc.length, insert: flat }, sequential: true }];
        }),
        keymap.of([
          { key: "Enter", run: (editor) => options.enter(editor.state.selection.main.head) },
          { key: "ArrowDown", run: () => options.down() },
          ...standardKeymap,
          ...historyKeymap,
        ]),
        EditorView.contentAttributes.of({ "aria-label": options.label, "aria-multiline": "false", spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
        placeholder(options.placeholder),
        titleLook,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !update.transactions.some((transaction) => transaction.annotation(fromOutside))) options.typed();
        }),
        EditorView.domEventHandlers({
          blur: () => { options.blur(); return false; },
          compositionend: () => { options.composed(); return false; },
        }),
      ],
    }),
  });
  view.dom.classList.add("hw-field");
  return {
    view,
    dom: view.dom,
    value: () => view.state.doc.toString(),
    setValue(text, caret) {
      const flat = oneLine(text);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: flat },
        selection: caret === undefined ? undefined : { anchor: Math.min(caret, flat.length) },
        annotations: [fromOutside.of(true), Transaction.addToHistory.of(false)],
      });
    },
    caret: () => view.state.selection.main.head,
    focus(at) {
      view.dispatch({ selection: { anchor: Math.min(at ?? view.state.doc.length, view.state.doc.length) }, scrollIntoView: true });
      view.focus();
    },
    get composing() { return view.composing; },
    refont(showMarks) { showAllMarks = showMarks; view.plugin(titleLook)?.restyle(); view.dispatch({}); },
  };
}

/**
 * A line of an open memo as it reads (not typed): its words with the marks drawn as the editor draws them (marks
 * faint, bold, italic, struck, code, links), as nodes to put in the line's element.
 */
export function markdownNodes(text: string, read: LineRead, from = 0): Node[] {
  if (read.kind === "code" || read.kind === "fence" || read.kind === "blank") return [document.createTextNode(text)];
  const spans: MarkSpan[] = [];
  lineSpans(text, read, 0, spans);
  const inline = spans.filter((span) => marks[span.kind] && span.to > span.from && span.from >= from);
  if (inline.length === 0) return [document.createTextNode(text.slice(from))];
  // Each boundary a span opens or closes at; each piece between two boundaries takes the classes of the spans over it.
  const cuts = [...new Set([from, text.length, ...inline.flatMap((span) => [span.from, span.to])])].filter((at) => at >= from).sort((a, b) => a - b);
  const nodes: Node[] = [];
  for (let index = 0; index < cuts.length - 1; index += 1) {
    const start = cuts[index], end = cuts[index + 1];
    const piece = text.slice(start, end);
    const classes = inline.filter((span) => span.from <= start && span.to >= end)
      .map((span) => (span.kind === "mark" && read.kind === "olist" && span.from === read.markFrom ? "md-mark md-num" : `md-${span.kind === "url" ? "link" : span.kind}`));
    nodes.push(classes.length ? h("span", { class: [...new Set(classes)].join(" ") }, piece) : document.createTextNode(piece));
  }
  return nodes;
}
