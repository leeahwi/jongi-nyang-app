import type { Lang } from "./lang";

/**
 * Line breaks for the cat's speech bubbles: between sentences rather than wherever the width runs
 * out ("첫 번째 체크가 제일 어려워요." / "할 수 있어요!"), and a sentence too long for one line is
 * cut after a comma, or else at the space nearest its middle so the two lines come out even — never
 * inside ‘quotes’ (a task's name). Breaks written into a line (\n) are kept. Same steps as the macOS
 * app (BubbleText.swift); characters are counted as code points, like Swift's characters here.
 */
export const bubbleLineLimit = 18;
const sentenceEnds = new Set([".", "!", "?", "…", "~"]);

/** About how many characters fit on one line in English and Dutch (Latin letters are about half as wide). */
export const latinBubbleLineLimit = 28;

/**
 * Korean by default (or with a line limit); with a language, English and Dutch break only at spaces:
 * between sentences when they fit, else after a comma, else at the space that evens the lines out —
 * never inside a word or a quote (‘…’, “…”; an apostrophe as in I’m doesn't close one). Long
 * sentences take as many lines as they need. Same steps as macOS (BubbleText.wrap(_:language:)).
 */
export function wrapBubble(text: string, limit?: number): string;
export function wrapBubble(text: string, lang: Lang): string;
export function wrapBubble(text: string, limitOrLang: number | Lang = bubbleLineLimit): string {
  if (typeof limitOrLang === "string" && limitOrLang !== "ko") return text.split("\n").map((part) => latinPart(part, latinBubbleLineLimit)).join("\n");
  const limit = typeof limitOrLang === "number" ? limitOrLang : bubbleLineLimit;
  return text.split("\n").map((part) => wrapPart(part, limit)).join("\n");
}

const latinEnds = new Set([".", "!", "?", "…"]);

function latinPart(text: string, limit: number): string {
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  const sentences: string[][] = [];
  let current: string[] = [];
  for (let index = 0; index < characters.length; index += 1) {
    current.push(characters[index]);
    if (latinEnds.has(characters[index]) && characters[index + 1] === " ") {
      sentences.push(current);
      current = [];
      index += 1;
    }
  }
  if (current.length > 0) sentences.push(current);
  // Sentences share a line when they fit; a long one is spread over lines, and its last piece may
  // still take the next sentence.
  const lines: string[][] = [];
  let line: string[] = [];
  for (const sentence of sentences) {
    if (line.length > 0 && line.length + 1 + sentence.length <= limit) {
      line = [...line, " ", ...sentence];
      continue;
    }
    if (line.length > 0) lines.push(line);
    const pieces = latinBreak(sentence, limit);
    lines.push(...pieces.slice(0, -1));
    line = pieces[pieces.length - 1] ?? [];
  }
  if (line.length > 0) lines.push(line);
  return lines.map((entry) => entry.join("")).join("\n");
}

const isLetter = (character: string | undefined) => character !== undefined && /\p{L}/u.test(character);

/**
 * One sentence over as few lines as it needs, each break at a space outside quotes: after a comma
 * when the first line then fits and the rest still fits in the lines left, otherwise at the space
 * nearest an even share (the earlier one on a tie) that keeps the first line short enough.
 */
function latinBreak(line: string[], limit: number): string[][] {
  if (line.length <= limit) return [line];
  const spaces: number[] = [];
  let quoted = false;
  line.forEach((character, index) => {
    if (character === "‘" || character === "“") quoted = true;
    else if (character === "”" || (character === "’" && !isLetter(line[index + 1]))) quoted = false;
    else if (character === " " && !quoted) spaces.push(index);
  });
  const count = Math.floor((line.length + limit) / (limit + 1));
  const target = line.length / Math.max(2, count);
  const fitting = spaces.filter((index) => index <= limit && index > 0);
  const commas = fitting.filter((index) => line[index - 1] === "," && line.length - index - 1 <= limit * (Math.max(2, count) - 1));
  const nearest = (candidates: number[]) => candidates.reduce<number | undefined>((best, index) => (best === undefined || Math.abs(index - target) < Math.abs(best - target) ? index : best), undefined);
  const split = nearest(commas) ?? nearest(fitting) ?? spaces[0];
  if (split === undefined) return [line];
  return [line.slice(0, split), ...latinBreak(line.slice(split + 1), limit)];
}

function wrapPart(text: string, limit: number): string {
  const characters = Array.from(text);
  if (characters.length <= limit) return text;
  const sentences: string[] = [];
  let current = "";
  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    current += character;
    if (sentenceEnds.has(character) && characters[index + 1] === " ") {
      sentences.push(current);
      current = "";
      index += 1; // the space between sentences
    }
  }
  if (current.length > 0) sentences.push(current);

  const length = (value: string) => Array.from(value).length;
  const lines: string[] = [];
  let line = "";
  for (const sentence of sentences) {
    if (line.length === 0) line = sentence;
    else if (length(line) + 1 + length(sentence) <= limit) line += ` ${sentence}`;
    else {
      lines.push(line);
      line = sentence;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines.flatMap((entry) => (length(entry) > limit ? halves(entry) : [entry])).join("\n");
}

/**
 * One long sentence in two: after the comma nearest the middle when both halves then fit, otherwise
 * at the space nearest the middle (the earlier one on a tie). Spaces inside ‘…’ don't count.
 */
function halves(line: string): string[] {
  const characters = Array.from(line);
  const middle = characters.length / 2;
  const spaces: number[] = [];
  let quoted = false;
  characters.forEach((character, index) => {
    if (character === "‘") quoted = true;
    else if (character === "’") quoted = false;
    else if (character === " " && !quoted) spaces.push(index);
  });
  const nearest = (candidates: number[]) => candidates.reduce<number | undefined>((best, index) => (best === undefined || Math.abs(index - middle) < Math.abs(best - middle) ? index : best), undefined);
  const commas = spaces.filter((index) => index > 0 && characters[index - 1] === "," && index <= bubbleLineLimit && characters.length - index - 1 <= bubbleLineLimit);
  const split = nearest(commas) ?? nearest(spaces);
  if (split === undefined) return [line];
  return [characters.slice(0, split).join(""), characters.slice(split + 1).join("")];
}
