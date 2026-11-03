import type { Lang } from "./lang";

/**
 * 메모 마크다운 (#84, docs/plans/memo-markdown.md): a memo's words stay as written (memos.json keeps the marks); this
 * reads where they are — the spans the editor and the open memo draw (bold, a heading, a list …; `mark` = a mark drawn
 * faint at 40 % of the ink) and the words without the marks (the card's title and preview, search, a memo's kind).
 * Positions are UTF-16 offsets, `to` not included. The same rules and the same cases as the Mac (MemoMarkdown.swift;
 * docs/plans/memo-markdown-cases.json).
 *
 * Lines: `# ` · `## ` · `### ` headings, `- ` · `* ` · `+ ` lists (two spaces or a tab a step in, three at most),
 * `1. ` · `1) ` numbered, `> ` quotes, a line of ``` opening or closing a code block (unclosed: to the memo's end), a
 * line that is only `---` or `***` a rule; a checklist line (`- [ ] `) stays the checklist it was. In a line: `**` ·
 * `__` bold, `*` · `_` italic (`_` not inside a word), `~~` struck, `` ` `` code, `[words](url)`; marks that don't pair
 * stay words. Inside code nothing else; inside bold or italic only code; a link's words as they are.
 */

export type MarkKind = "mark" | "bold" | "italic" | "strike" | "code" | "codeblock" | "heading" | "list" | "olist" | "quote" | "rule" | "link" | "linkurl" | "url";
export interface MarkSpan { kind: MarkKind; from: number; to: number; level?: number }

export type LineKind = "blank" | "text" | "heading" | "list" | "olist" | "quote" | "rule" | "fence" | "code" | "check";
/** A line as the blocks read it (no marks inside it yet). */
export interface LineRead {
  kind: LineKind;
  /** Heading 1–3, list and numbered list 1–3; else 0. */
  level: number;
  /** Where the line ends without a "\r". */
  end: number;
  /** Where the block's mark starts (after the indent) and where the words start (after the mark). */
  markFrom: number;
  words: number;
  /** A numbered line's number and its `.` / `)`. */
  marker: string;
  /** A checklist line: ticked. */
  checked?: boolean;
}

const space = (code: number) => code === 0x20 || code === 0x09 || code === 0x0d || code === 0x0a || code === 0xa0 || code === 0x3000;
const wordLike = /[\p{L}\p{M}\p{N}]/u;
const isWordChar = (text: string, at: number) => at >= 0 && at < text.length && wordLike.test(text[at]);

/** A line that opens or closes a code block: up to three spaces, then ```. */
export function isFenceLine(line: string): boolean {
  let at = 0;
  while (at < 3 && line.charCodeAt(at) === 0x20) at += 1;
  return line.startsWith("```", at);
}

const checklistPattern = /^([ \t]*)([-*]) \[( |x|X)\] /;

/** What block a line is (inside a code block: `code`, or the `fence` that closes it). */
export function readLine(line: string, inBlock: boolean): LineRead {
  const end = line.endsWith("\r") ? line.length - 1 : line.length;
  const body = end === line.length ? line : line.slice(0, end);
  const read = (kind: LineKind, level = 0, markFrom = 0, words = 0, marker = ""): LineRead => ({ kind, level, end, markFrom, words, marker });
  if (isFenceLine(body)) return read("fence", 0, body.indexOf("`"), end);
  if (inBlock) return read("code");
  let filled = false;
  for (let at = 0; at < end && !filled; at += 1) filled = !space(body.charCodeAt(at));
  if (!filled) return read("blank");
  let indent = 0;
  while (indent < end && (body.charCodeAt(indent) === 0x20 || body.charCodeAt(indent) === 0x09)) indent += 1;
  const first = body[indent];
  if (/^[ \t]*(-{3,}|\*{3,})[ \t]*$/.test(body)) return read("rule", 0, indent, end);
  const check = checklistPattern.exec(body);
  if (check) return { ...read("check", 0, check[1].length, check[0].length), checked: check[3] !== " " };
  if (indent === 0 && first === "#") {
    const heading = /^(#{1,3}) +/.exec(body);
    if (heading) return read("heading", heading[1].length, 0, heading[0].length);
  }
  const level = () => {
    let width = 0;
    for (let at = 0; at < indent; at += 1) width += body.charCodeAt(at) === 0x09 ? 2 : 1;
    return Math.min(3, 1 + Math.floor(width / 2));
  };
  if ((first === "-" || first === "*" || first === "+") && body[indent + 1] === " ") {
    let words = indent + 1;
    while (body[words] === " ") words += 1;
    return read("list", level(), indent, words);
  }
  if (first >= "0" && first <= "9") {
    const number = /^(\d{1,9})([.)]) +/.exec(body.slice(indent));
    if (number) return read("olist", level(), indent, indent + number[0].length, number[1] + number[2]);
  }
  if (first === ">") {
    const words = body[indent + 1] === " " ? indent + 2 : indent + 1;
    return read("quote", 0, indent, words);
  }
  return read("text");
}

const runOf = (text: string, at: number, end: number): number => {
  let next = at;
  while (next < end && text[next] === text[at]) next += 1;
  return next - at;
};

/** Where a code span that opens at `at` (a run of backticks) closes: its closing run's start, or -1. */
function codeClose(text: string, at: number, run: number, end: number): number {
  for (let next = at + run; next < end;) {
    if (text[next] !== "`") { next += 1; continue; }
    const length = runOf(text, next, end);
    if (length === run) return next > at + run ? next : -1;
    next += length;
  }
  return -1;
}

/** What ends a sentence after an address, not the address (the cards' link chip leaves it out too). */
const trailingMarks = ".,;:!?)]}>'\"’”";

/** A bare `http(s)://` address at `at` (not in a word): its end. */
function urlEnd(text: string, at: number, end: number): number {
  if (at > 0 && isWordChar(text, at - 1)) return -1;
  const head = text.slice(at, at + 8).toLowerCase();
  if (!head.startsWith("http://") && !head.startsWith("https://")) return -1;
  let next = at + (head.startsWith("https://") ? 8 : 7);
  if (next >= end || space(text.charCodeAt(next))) return -1;
  while (next < end && !space(text.charCodeAt(next))) next += 1;
  return next;
}

/** Only the code spans in [from, to) (inside bold and italic). */
function codeSpans(text: string, from: number, to: number, base: number, out: MarkSpan[]): void {
  for (let at = from; at < to;) {
    if (text[at] !== "`") { at += 1; continue; }
    const run = runOf(text, at, to);
    const close = codeClose(text, at, run, to);
    if (close < 0) { at += run; continue; }
    out.push({ kind: "mark", from: base + at, to: base + at + run }, { kind: "code", from: base + at + run, to: base + close }, { kind: "mark", from: base + close, to: base + close + run });
    at = close + run;
  }
}

/** The marks in a line's words [from, to): spans at `base` + their place in `text`. */
export function inlineSpans(text: string, from: number, to: number, base: number, out: MarkSpan[]): void {
  for (let at = from; at < to;) {
    const char = text[at];
    if (char === "`") {
      const run = runOf(text, at, to);
      const close = codeClose(text, at, run, to);
      if (close >= 0) {
        out.push({ kind: "mark", from: base + at, to: base + at + run }, { kind: "code", from: base + at + run, to: base + close }, { kind: "mark", from: base + close, to: base + close + run });
        at = close + run;
      } else at += run;
      continue;
    }
    if (char === "h" || char === "H") {
      const url = urlEnd(text, at, to);
      if (url > 0) {
        // A bare address: underlined (⌘/Ctrl+click opens it), nothing inside it read as marks; trailing punctuation left out.
        let stop = url;
        while (stop > at && trailingMarks.includes(text[stop - 1])) stop -= 1;
        out.push({ kind: "url", from: base + at, to: base + stop });
        at = url;
        continue;
      }
    }
    if (char === "[") {
      const link = linkAt(text, at, to);
      if (link) {
        out.push({ kind: "mark", from: base + at, to: base + at + 1 }, { kind: "link", from: base + at + 1, to: base + link.close },
          { kind: "mark", from: base + link.close, to: base + link.close + 1 }, { kind: "linkurl", from: base + link.close + 1, to: base + link.end },
          { kind: "mark", from: base + link.close + 1, to: base + link.end });
        at = link.end;
        continue;
      }
    }
    if (char === "*" || char === "_" || char === "~") {
      const run = runOf(text, at, to);
      const close = emphasisClose(text, at, run, to);
      if (close < 0) { at += run; continue; }
      const inside = { from: base + at + run, to: base + close };
      out.push({ kind: "mark", from: base + at, to: base + at + run });
      if (char === "~") out.push({ kind: "strike", ...inside });
      else {
        if (run >= 2) out.push({ kind: "bold", ...inside });
        if (run !== 2) out.push({ kind: "italic", ...inside });
        codeSpans(text, at + run, close, base, out);
      }
      out.push({ kind: "mark", from: base + close, to: base + close + run });
      at = close + run;
      continue;
    }
    at += 1;
  }
}

/** `[words](url)` at `at`: the `]` and the end after `)`. */
function linkAt(text: string, at: number, end: number): { close: number; end: number } | undefined {
  const close = text.indexOf("]", at + 1);
  if (close < 0 || close >= end || close === at + 1 || text[close + 1] !== "(") return undefined;
  if (text.slice(at + 1, close).includes("[")) return undefined;
  const shut = text.indexOf(")", close + 2);
  if (shut < 0 || shut >= end || shut === close + 2) return undefined;
  for (let next = close + 2; next < shut; next += 1) if (space(text.charCodeAt(next))) return undefined;
  return { close, end: shut + 1 };
}

/**
 * Where the emphasis opened by the run of `run` marks at `at` closes (-1: it stays words): a run of exactly as many
 * of the same mark, the words between not starting or ending with a space; `_` neither opens nor closes inside a word;
 * `~` only in twos; bold and italic step over their code.
 */
function emphasisClose(text: string, at: number, run: number, end: number): number {
  const char = text[at];
  if (run > 3 || (char === "~" && run !== 2)) return -1;
  const first = at + run;
  if (first >= end || space(text.charCodeAt(first))) return -1;
  if (char === "_" && isWordChar(text, at - 1)) return -1;
  for (let next = first; next < end;) {
    const here = text[next];
    if (here === "`" && char !== "~") {
      const length = runOf(text, next, end);
      const close = codeClose(text, next, length, end);
      next = close >= 0 ? close + length : next + length;
      continue;
    }
    if (here !== char) { next += 1; continue; }
    const length = runOf(text, next, end);
    if (length === run && next > first && !space(text.charCodeAt(next - 1)) && !(char === "_" && isWordChar(text, next + length))) return next;
    next += length;
  }
  return -1;
}

/** One line's spans at `base` (its block and its marks; not the code block round it). */
export function lineSpans(line: string, read: LineRead, base: number, out: MarkSpan[]): void {
  const { end, markFrom, words } = read;
  switch (read.kind) {
    case "heading":
      out.push({ kind: "heading", from: base, to: base + end, level: read.level }, { kind: "mark", from: base, to: base + words });
      break;
    case "list": case "olist":
      out.push({ kind: read.kind, from: base, to: base + end, level: read.level }, { kind: "mark", from: base + markFrom, to: base + words });
      break;
    case "quote":
      out.push({ kind: "quote", from: base, to: base + end }, { kind: "mark", from: base + markFrom, to: base + words });
      break;
    case "rule": {
      let stop = end;
      while (stop > markFrom && space(line.charCodeAt(stop - 1))) stop -= 1;
      out.push({ kind: "mark", from: base + markFrom, to: base + stop }, { kind: "rule", from: base + markFrom, to: base + stop });
      return;
    }
    case "fence":
      out.push({ kind: "mark", from: base + markFrom, to: base + end });
      return;
    case "code": case "blank":
      return;
  }
  inlineSpans(line, words, end, base, out);
}

const order = (a: MarkSpan, b: MarkSpan) => a.from - b.from || b.to - a.to || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);

/** Every line of a text with its offset, read in order (the code blocks carried along). */
export function* markdownLines(text: string): Generator<{ line: string; from: number; read: LineRead }> {
  let inBlock = false;
  for (let from = 0; from <= text.length;) {
    let stop = text.indexOf("\n", from);
    if (stop < 0) stop = text.length;
    const line = text.slice(from, stop);
    const read = readLine(line, inBlock);
    if (read.kind === "fence") inBlock = !inBlock;
    yield { line, from, read };
    from = stop + 1;
  }
}

/** Every span of a memo, in order: by start, the longer first, then by kind's name. */
export function markdownSpans(text: string): MarkSpan[] {
  const out: MarkSpan[] = [];
  let open = -1;
  let last = 0;
  for (const { line, from, read } of markdownLines(text)) {
    lineSpans(line, read, from, out);
    if (read.kind === "fence") {
      if (open < 0) open = from;
      else { out.push({ kind: "codeblock", from: open, to: from + read.end }); open = -1; }
    }
    last = from + line.length;
  }
  if (open >= 0) out.push({ kind: "codeblock", from: open, to: last });
  return out.sort(order);
}

/** A line's words without its marks (a checklist line keeps its box; a rule or a fence has none). */
export function linePlain(line: string, read: LineRead): string | undefined {
  if (read.kind === "rule" || read.kind === "fence") return undefined;
  if (read.kind === "code" || read.kind === "blank") return line.slice(0, read.end);
  const spans: MarkSpan[] = [];
  inlineSpans(line, read.words, read.end, 0, spans);
  const start = read.kind === "check" || read.kind === "text" ? 0 : read.words;
  if (spans.length === 0) return line.slice(start, read.end);
  let plain = "";
  let at = start;
  for (const span of spans.filter((entry) => entry.kind === "mark").sort(order)) {
    if (span.from > at) plain += line.slice(at, span.from);
    at = Math.max(at, span.to);
  }
  return plain + line.slice(at, read.end);
}

/** Anything a mark could start with; a text without any is its own words. */
const markdownish = /[*_~`[#>\r]|^[ \t]*(?:[-+] |\d{1,9}[.)] |---)/m;

/** The memo's words without marks, line by line (rules and code fences left out): what search and the cards read. */
export function markdownPlain(text: string): string {
  // Most memos have no mark at all: their words are the text (a search's first pass reads every memo).
  if (!markdownish.test(text)) return text;
  const lines: string[] = [];
  for (const { line, read } of markdownLines(text)) {
    const plain = linePlain(line, read);
    if (plain !== undefined) lines.push(plain);
  }
  return lines.join("\n");
}

/** A checklist line's words (after its box), without marks. */
const itemWords = (line: string, read: LineRead): string => (linePlain(line, read) ?? "").slice(read.words).trim();

/** The memo's title: its first line with words, without marks (a checklist line's item words); an empty memo's words. */
export function markdownTitle(text: string, lang: Lang = "ko"): string {
  for (const { line, read } of markdownLines(text)) {
    if (read.kind === "blank" || read.kind === "rule" || read.kind === "fence") continue;
    const words = read.kind === "check" ? itemWords(line, read) : (linePlain(line, read) ?? "").trim();
    if (words) return words;
  }
  return { ko: "빈 메모", en: "Empty note", nl: "Lege notitie" }[lang];
}

/** A row of a card's preview: a line's words, or a checklist item (`checked` set); `code` a code block's line. */
export interface MarkdownRow { checked?: boolean; text: string; code?: boolean }

/**
 * What a card shows under its title (D30, #14, #84): a checklist memo its first `limit` items; any other memo its first
 * `limit` lines with words after the title, without marks — a list item `• `, a numbered one its number, a quote its
 * words, a code block its first line (fixed-width); rules and fences none. Each row cut at 300 characters. `withItems`
 * false: the lines only (a checklist's items skipped; the one preview line under a title found in search).
 */
export function markdownRows(text: string, limit = 3, withItems = true): MarkdownRow[] {
  const items: MarkdownRow[] = [];
  const rows: MarkdownRow[] = [];
  if (limit <= 0) return items;
  const cut = (words: string) => (words.length > 300 ? words.slice(0, 300) : words);
  let titled = false;
  let blockShown = false;
  for (const { line, read } of markdownLines(text)) {
    if (read.kind === "blank" || read.kind === "rule") continue;
    if (read.kind === "fence") { blockShown = false; continue; }
    if (read.kind === "check") {
      const words = itemWords(line, read);
      if (!words) continue;
      if (!titled) { titled = true; continue; }
      if (!withItems) continue;
      items.push({ checked: read.checked === true, text: cut(words) });
      if (items.length === limit) return items;
      continue;
    }
    if (titled && rows.length >= limit) { if (!withItems) break; continue; }
    if (read.kind === "code" && titled && blockShown) continue;
    const words = (linePlain(line, read) ?? "").trim();
    if (!words) continue;
    if (!titled) { titled = true; if (read.kind === "code") blockShown = true; continue; }
    if (read.kind === "code") { blockShown = true; rows.push({ text: cut(words), code: true }); continue; }
    const head = read.kind === "list" ? "• " : read.kind === "olist" ? `${read.marker} ` : "";
    rows.push({ text: cut(head + words) });
  }
  return items.length ? items : rows;
}

/** The memo's `[words](url)` links in order (not in code): their words and URLs. */
export function markdownLinks(text: string): { label: string; url: string }[] {
  const found: { label: string; url: string }[] = [];
  for (const { line, read } of markdownLines(text)) {
    if (read.kind === "code" || read.kind === "fence" || read.kind === "rule" || read.kind === "blank" || !line.includes("](")) continue;
    const spans: MarkSpan[] = [];
    inlineSpans(line, read.words, read.end, 0, spans);
    for (const span of spans) {
      if (span.kind === "link") found.push({ label: line.slice(span.from, span.to), url: "" });
      else if (span.kind === "linkurl") found[found.length - 1].url = line.slice(span.from + 1, span.to - 1);
    }
  }
  return found;
}
