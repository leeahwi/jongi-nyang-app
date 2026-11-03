import { isCodeLine } from "./memoDrawer";
import { isFenceLine, lineSpans, readLine, type LineRead, type MarkSpan } from "./memoMarkdown";

/**
 * 메모 서식 (#84, docs/plans/memo-markdown.md ‘사이드노트에서 가져온 것’): what a formatting key, the Aa bar, a paste or a
 * ticked box does to a memo's words — pure text in, text out, with the selection (UTF-16 offsets, `from` ≤ `to`). The
 * editors only apply the result (one change, so one undo). The same rules and the same cases as the Mac
 * (MemoEdits.swift; the `edits` of docs/plans/memo-markdown-cases.json). undefined: nothing to do here (the editor does
 * its own thing — a plain new line, a plain paste).
 */
export interface Edit { text: string; from: number; to: number }

interface Line { start: number; end: number; text: string }

function lineAt(text: string, at: number): Line {
  const start = text.lastIndexOf("\n", at - 1) + 1;
  let end = text.indexOf("\n", at);
  if (end < 0) end = text.length;
  return { start, end, text: text.slice(start, end) };
}

/** The lines `from`–`to` touch (a selection ending at a line's very start leaves that line out). */
function linesOf(text: string, from: number, to: number): Line[] {
  const out = [lineAt(text, from)];
  const stop = to > from && text[to - 1] === "\n" ? to - 1 : to;
  while (out[out.length - 1].end < stop) out.push(lineAt(text, out[out.length - 1].end + 1));
  return out;
}

/** Whether a ``` block is open where the line starting at `start` starts. */
function inBlockAt(text: string, start: number): boolean {
  let open = false;
  for (let at = 0; at < start;) {
    let end = text.indexOf("\n", at);
    if (end < 0 || end >= start) end = Math.min(end < 0 ? text.length : end, start);
    if (isFenceLine(text.slice(at, end))) open = !open;
    at = end + 1;
  }
  return open;
}

const read = (text: string, line: Line): LineRead => readLine(line.text, inBlockAt(text, line.start));

/** Lines replaced one by one (`change` gives each line's new words and how far its words moved); the selection follows. */
function eachLine(text: string, from: number, to: number, change: (line: Line, read: LineRead) => { text: string; words: number; newWords: number }): Edit {
  const lines = linesOf(text, from, to);
  let out = text.slice(0, lines[0].start);
  let newFrom = from, newTo = to, shift = 0;
  lines.forEach((line, index) => {
    const changed = change(line, read(text, line));
    // A place at the line's start stays there (a whole line chosen); elsewhere it keeps to the words.
    const place = (at: number) => line.start + shift + (at === line.start ? 0 : Math.max(changed.newWords, at - line.start - changed.words + changed.newWords));
    if (from >= line.start && from <= line.end) newFrom = place(from);
    if (to >= line.start && to <= line.end) newTo = place(to);
    out += changed.text + (index < lines.length - 1 ? "\n" : "");
    shift += changed.text.length - line.text.length;
  });
  out += text.slice(lines[lines.length - 1].end);
  return { text: out, from: Math.min(newFrom, newTo), to: Math.max(newFrom, newTo) };
}

/** The line's block mark and the indent before it (a list's `- `, a number, a box, a quote's `> `). */
function blockMark(line: string, kind: LineRead): { indent: string; mark: string; words: number } {
  if (kind.kind === "list" || kind.kind === "olist" || kind.kind === "check" || kind.kind === "quote") {
    return { indent: line.slice(0, kind.markFrom), mark: line.slice(kind.markFrom, kind.words), words: kind.words };
  }
  return { indent: "", mark: "", words: 0 };
}

// ─── ↩ ─────────────────────────────────────────────────────────────────────────

/**
 * ↩ on a list, checklist, numbered or quote line: the next line starts with the same mark (a number one more, a box
 * empty), the words after the caret going with it. On an item with no words the mark goes instead (the list ends).
 */
export function enter(text: string, from: number, to: number): Edit | undefined {
  if (from !== to) return undefined;
  const line = lineAt(text, from);
  const kind = read(text, line);
  if (kind.kind !== "list" && kind.kind !== "olist" && kind.kind !== "check" && kind.kind !== "quote") return undefined;
  if (from - line.start < kind.words) return undefined;
  if (!line.text.slice(kind.words).trim()) {
    return { text: text.slice(0, line.start) + text.slice(line.end), from: line.start, to: line.start };
  }
  const { indent, mark } = blockMark(line.text, kind);
  let next = mark;
  if (kind.kind === "olist") next = `${Number(kind.marker.slice(0, -1)) + 1}${kind.marker.slice(-1)} `;
  else if (kind.kind === "check") next = `${mark.slice(0, 1)} [ ] `;
  const insert = `\n${indent}${next}`;
  return { text: text.slice(0, from) + insert + text.slice(from), from: from + insert.length, to: from + insert.length };
}

// ─── Lines ─────────────────────────────────────────────────────────────────────

/** ⌥⌘1–3 · ⌥⌘0 (`level`), or the Aa bar's 제목 (`"cycle"`: none → # → ## → ### → none) on each line touched. */
export function heading(text: string, from: number, to: number, level: number | "cycle"): Edit {
  const first = read(text, linesOf(text, from, to)[0]);
  const target = level === "cycle" ? (first.kind === "heading" ? (first.level + 1) % 4 : 1) : level;
  return eachLine(text, from, to, (line, kind) => {
    const words = kind.kind === "heading" ? kind.words : 0;
    const mark = target > 0 ? `${"#".repeat(target)} ` : "";
    return { text: mark + line.text.slice(words), words, newWords: mark.length };
  });
}

export type LineKind = "list" | "olist" | "check" | "quote";

/**
 * 목록 · 번호 · 체크(⇧⌘L) · 인용 on each line touched: on when any line isn't that already (another list's mark is
 * swapped, the indent kept; numbers count from 1), off when all of them are. Blank lines in a selection stay blank.
 */
export function toggleLines(text: string, from: number, to: number, want: LineKind): Edit {
  const lines = linesOf(text, from, to);
  const filled = lines.filter((line) => line.text.trim());
  const all = filled.length > 0 && filled.every((line) => read(text, line).kind === want);
  let number = 0;
  return eachLine(text, from, to, (line, kind) => {
    const { indent, mark, words } = blockMark(line.text, kind);
    if (!line.text.trim() && lines.length > 1) return { text: line.text, words: 0, newWords: 0 };
    const rest = line.text.slice(words);
    const lead = mark ? indent : "";
    let next = "";
    if (!all) {
      number += 1;
      next = want === "list" ? "- " : want === "olist" ? `${number}. ` : want === "check" ? "- [ ] " : "> ";
    }
    return { text: lead + next + rest, words, newWords: lead.length + next.length };
  });
}

/** 가로줄: a `---` line under the caret's line (on an empty line, that line), the caret on the line after it. */
export function rule(text: string, _from: number, to: number): Edit {
  const line = lineAt(text, to);
  if (!line.text.trim()) {
    const insert = "---\n";
    return { text: text.slice(0, line.start) + insert + text.slice(line.end), from: line.start + insert.length, to: line.start + insert.length };
  }
  const insert = "\n---\n";
  return { text: text.slice(0, line.end) + insert + text.slice(line.end), from: line.end + insert.length, to: line.end + insert.length };
}

/** Tab · ⇧Tab: a list, numbered or checklist line a step in (three at most) or out; elsewhere Tab puts two spaces. */
export function indent(text: string, from: number, to: number, out: boolean): Edit | undefined {
  const lines = linesOf(text, from, to);
  const listy = lines.every((line) => { const kind = read(text, line).kind; return kind === "list" || kind === "olist" || kind === "check"; });
  if (!listy) {
    if (out || from !== to) return undefined;
    return { text: `${text.slice(0, from)}  ${text.slice(from)}`, from: from + 2, to: from + 2 };
  }
  return eachLine(text, from, to, (line, kind) => {
    if (!out) {
      const level = kind.kind === "check" ? Math.min(3, 1 + Math.floor(kind.markFrom / 2)) : kind.level;
      if (level >= 3) return { text: line.text, words: 0, newWords: 0 };
      return { text: `  ${line.text}`, words: 0, newWords: 2 };
    }
    const lead = line.text.startsWith("\t") ? 1 : line.text.startsWith("  ") ? 2 : line.text.startsWith(" ") ? 1 : 0;
    return { text: line.text.slice(lead), words: lead, newWords: 0 };
  });
}

/** ⌥↑ · ⌥↓: the lines touched trade places with the line above or below; the selection goes with them. */
export function moveLines(text: string, from: number, to: number, up: boolean): Edit | undefined {
  const lines = linesOf(text, from, to);
  const first = lines[0], last = lines[lines.length - 1];
  if (up ? first.start === 0 : last.end >= text.length) return undefined;
  const block = text.slice(first.start, last.end);
  if (up) {
    const above = lineAt(text, first.start - 1);
    const moved = `${block}\n${above.text}`;
    const by = above.text.length + 1;
    return { text: text.slice(0, above.start) + moved + text.slice(last.end), from: from - by, to: to - by };
  }
  const below = lineAt(text, last.end + 1);
  const moved = `${below.text}\n${block}`;
  const by = below.text.length + 1;
  return { text: text.slice(0, first.start) + moved + text.slice(below.end), from: from + by, to: to + by };
}

// ─── In a line ─────────────────────────────────────────────────────────────────

/**
 * ⌘B `**` · ⌘I `*` · ⇧⌘X `~~` · code `` ` ``: the selection wrapped in the mark, or let out of it when it already is
 * (the marks just outside it, or at its own ends); with no selection a pair with the caret between (a pair with
 * nothing in it goes again).
 */
export function wrap(text: string, from: number, to: number, mark: string): Edit {
  const size = mark.length;
  const single = mark === "*" || mark === "_";
  // `*` is italic only where it isn't half of `**`.
  const isMark = (at: number) => text.slice(at, at + size) === mark && (!single || (text[at - 1] !== mark && text[at + size] !== mark));
  if (from === to) {
    if (from >= size && isMark(from - size) && isMark(from)) return { text: text.slice(0, from - size) + text.slice(from + size), from: from - size, to: from - size };
    return { text: text.slice(0, from) + mark + mark + text.slice(from), from: from + size, to: from + size };
  }
  if (from >= size && isMark(from - size) && isMark(to)) {
    return { text: text.slice(0, from - size) + text.slice(from, to) + text.slice(to + size), from: from - size, to: to - size };
  }
  const inside = text.slice(from, to);
  if (inside.length >= size * 2 + 1 && isMark(from) && isMark(to - size)) {
    return { text: text.slice(0, from) + inside.slice(size, -size) + text.slice(to), from, to: to - size * 2 };
  }
  return { text: text.slice(0, from) + mark + inside + mark + text.slice(to), from: from + size, to: to + size };
}

/** ⌘K: the selection becomes a link's words — `[words](url)`, the caret in the empty address (or after a given one). */
export function link(text: string, from: number, to: number, url = ""): Edit {
  const words = text.slice(from, to);
  const made = `[${words}](${url})`;
  const caret = url ? from + made.length : from + words.length + 3;
  return { text: text.slice(0, from) + made + text.slice(to), from: words || url ? caret : from + 1, to: words || url ? caret : from + 1 };
}

/** A `[words](address)` link: the whole of it, its words and its address (UTF-16 offsets in the memo). */
export interface LinkAt { from: number; to: number; wordsFrom: number; wordsTo: number; url: string }

/** #135: the link the selection is in (both ends inside one `[words](address)`, its marks included). undefined: none there. */
export function linkAt(text: string, from: number, to: number): LinkAt | undefined {
  const line = lineAt(text, Math.min(from, text.length));
  if (to > line.end) return undefined;
  const lineRead = read(text, line);
  if (lineRead.kind === "code" || lineRead.kind === "fence") return undefined;
  const spans: MarkSpan[] = [];
  lineSpans(line.text, lineRead, line.start, spans);
  for (let index = 0; index < spans.length; index += 1) {
    const span = spans[index];
    if (span.kind !== "link") continue;
    const address = spans.slice(index).find((entry) => entry.kind === "linkurl");
    if (!address) continue;
    const start = span.from - 1, end = address.to;
    if (start > from || to > end) continue;
    return { from: start, to: end, wordsFrom: span.from, wordsTo: span.to, url: text.slice(address.from + 1, Math.max(address.from + 1, address.to - 1)) };
  }
  return undefined;
}

/**
 * The address as typed in the link field, made one a link can open: trimmed, spaces as `%20`, `https://` before one
 * with no scheme (`example.com/map`).
 */
export function cleanURL(typed: string): string {
  const trimmed = typed.trim().replace(/ /g, "%20");
  if (!trimmed) return "";
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * #135 (SideNotes' way): the link field's Return. In a link: its address changed (an empty one takes the link out, its
 * words left chosen). On chosen words: they become the link's words. With nothing chosen: the address itself. The caret
 * after the link. undefined: nothing to do (an empty address outside a link).
 */
export function setLink(text: string, from: number, to: number, typed: string): Edit | undefined {
  const url = cleanURL(typed);
  const found = linkAt(text, from, to);
  if (found) {
    const words = text.slice(found.wordsFrom, found.wordsTo);
    if (!url) return { text: text.slice(0, found.from) + words + text.slice(found.to), from: found.from, to: found.from + words.length };
    const made = `[${words}](${url})`;
    const caret = found.from + made.length;
    return { text: text.slice(0, found.from) + made + text.slice(found.to), from: caret, to: caret };
  }
  const words = text.slice(from, to);
  if (!url || words.includes("\n")) return undefined;
  const made = words ? `[${words}](${url})` : url;
  const caret = from + made.length;
  return { text: text.slice(0, from) + made + text.slice(to), from: caret, to: caret };
}

// ─── Paste ─────────────────────────────────────────────────────────────────────

const looksLikeCode = (line: string): boolean => isCodeLine(line) || /^\s/.test(line) || /[{};]\s*$/.test(line) || /^\s*[)}\]]/.test(line);

/**
 * A paste (⌥⇧⌘V / Ctrl+Shift+V never comes here): a bare address over a selection makes a link of it; several lines
 * of code onto an empty line (not in a code block) come in ``` fences. Anything else: as it is.
 */
export function paste(text: string, from: number, to: number, pasted: string): Edit | undefined {
  const clip = pasted.replace(/\r\n?/g, "\n");
  const trimmed = clip.trim();
  if (from < to && /^https?:\/\/\S+$/i.test(trimmed) && !text.slice(from, to).includes("\n")) {
    const made = `[${text.slice(from, to)}](${trimmed})`;
    return { text: text.slice(0, from) + made + text.slice(to), from: from + made.length, to: from + made.length };
  }
  const lines = trimmed.split("\n").filter((line) => line.trim());
  if (from !== to || lines.length < 2) return undefined;
  const line = lineAt(text, from);
  if (line.text.trim() || inBlockAt(text, line.start)) return undefined;
  const code = clip.replace(/^\n+|\s+$/g, "").split("\n");
  if (code.filter((entry) => entry.trim() && looksLikeCode(entry)).length * 2 < lines.length || code.some((entry) => isFenceLine(entry))) return undefined;
  const block = `\`\`\`\n${code.join("\n")}\n\`\`\``;
  const after = line.end < text.length ? "" : "\n";
  return { text: text.slice(0, line.start) + block + after + text.slice(line.end), from: line.start + block.length + 1, to: line.start + block.length + 1 };
}

// ─── Ticking a box ───────────────────────────────────────────────────────────

const checkLine = /^([ \t]*)([-*]) \[( |x|X)\] /;

/**
 * A box ticked or unticked on line `index` (0-based); with `moveDone`, a finished item goes to the bottom of its
 * checklist (the checklist lines next to it, no line between), an unfinished one back just above the finished ones.
 * One change of the words, so one undo brings back both the box and the place.
 */
export function toggleDone(text: string, index: number, moveDone: boolean): string {
  return tickedLines(text, index, moveDone)?.lines.join("\n") ?? text;
}

/**
 * A box clicked in the editor (#133): the words as toggleDone makes them, and the selection kept on its own words — on
 * the ticked line it goes along with it, elsewhere it stays on the line it was on. undefined: not a checklist line.
 */
export function tick(text: string, index: number, from: number, to: number, moveDone: boolean): Edit | undefined {
  const made = tickedLines(text, index, moveDone);
  if (!made) return undefined;
  const old = text.split("\n");
  const starts: number[] = [];
  let at = 0;
  for (const line of old) { starts.push(at); at += line.length + 1; }
  const newStart: number[] = new Array<number>(old.length).fill(0);
  at = 0;
  made.order.forEach((was, place) => { newStart[was] = at; at += made.lines[place].length + 1; });
  const follow = (offset: number) => {
    let line = 0;
    while (line + 1 < starts.length && starts[line + 1] <= offset) line += 1;
    return newStart[line] + offset - starts[line];
  };
  const a = follow(from), b = follow(to);
  return { text: made.lines.join("\n"), from: Math.min(a, b), to: Math.max(a, b) };
}

/** The lines after a box on line `index` is ticked, and which old line each one was. undefined: not a checklist line. */
function tickedLines(text: string, index: number, moveDone: boolean): { lines: string[]; order: number[] } | undefined {
  const lines = text.split("\n");
  const line = lines[index];
  const found = line === undefined ? null : checkLine.exec(line.replace(/\r$/, ""));
  if (!found) return undefined;
  const at = line.indexOf("[");
  const done = line[at + 1] === " ";
  const changed = `${line.slice(0, at + 1)}${done ? "x" : " "}${line.slice(at + 2)}`;
  lines[index] = changed;
  const order = lines.map((_, place) => place);
  if (!moveDone) return { lines, order };
  const isCheck = (entry: string | undefined) => entry !== undefined && checkLine.test(entry.replace(/\r$/, ""));
  let first = index, last = index;
  while (isCheck(lines[first - 1])) first -= 1;
  while (isCheck(lines[last + 1])) last += 1;
  const ticked = (entry: string) => /\[(x|X)\]/.test(checkLine.exec(entry.replace(/\r$/, ""))?.[0] ?? "");
  lines.splice(index, 1);
  order.splice(index, 1);
  last -= 1;
  let place: number;
  if (done) place = last + 1;
  else {
    place = first;
    while (place <= last && !ticked(lines[place])) place += 1;
  }
  lines.splice(place, 0, changed);
  order.splice(place, 0, index);
  return { lines, order };
}

/**
 * Ctrl+Shift+U (Apple Notes' Mark as Checked): the box on the caret's line (the line `from` is on) ticked or unticked,
 * as a click on it would. undefined: not a checklist line.
 */
export function tickAtCaret(text: string, from: number, to: number, moveDone: boolean): Edit | undefined {
  let line = 0;
  for (let at = text.indexOf("\n"); at >= 0 && at < from; at = text.indexOf("\n", at + 1)) line += 1;
  return tick(text, line, from, to, moveDone);
}
