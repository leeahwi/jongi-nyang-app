import { readLine, type LineKind } from "./memoMarkdown";

/**
 * 글꼴 설정 (#141, docs/plans/settings-plan.md F1 · F2): the size steps of the note and the drawer, how a 1.30 setting
 * reads into them, and the drawer's line and paragraph spacing — the same numbers as the Mac app (TextSteps.swift; the
 * shared cases in docs/plans/settings-cases.json). This device's settings only, never in the shared folder or a backup.
 */

export type LegacyTextSize = "small" | "regular" | "large" | "extraLarge";

// ─── The note (노트 글꼴) ───────────────────────────────────────────────────────

/** Seven steps that all still fit the 44 px ruled line; 1.30's four are the 1st, 3rd, 5th and 7th. */
export const noteScales = [0.87, 0.93, 1, 1.07, 1.13, 1.2, 1.26];
export const noteDefault = 2;
export const noteLegacy: Record<LegacyTextSize, number> = { small: 0, regular: 2, large: 4, extraLarge: 6 };
export const clampNote = (step: number): number => Math.min(noteScales.length - 1, Math.max(0, Math.round(step)));

/** The step a saved setting means: `textStep` if this version wrote it, else 1.30's `textSize`, else 보통. */
export function noteStep(saved: unknown, legacy: unknown): number {
  if (typeof saved === "number" && Number.isInteger(saved) && saved >= 0 && saved < noteScales.length) return saved;
  return typeof legacy === "string" && legacy in noteLegacy ? noteLegacy[legacy as LegacyTextSize] : noteDefault;
}

/** What 1.30's `textSize` gets beside `textStep` (an older version reads it): the nearest of its four sizes. */
export const noteLegacyName = (step: number): LegacyTextSize =>
  nearest(noteScales[clampNote(step)], Object.entries(noteLegacy).map(([name, at]) => [name as LegacyTextSize, noteScales[at]]));

// ─── The drawer (메모 글꼴) ────────────────────────────────────────────────────

/** Nine steps of a pixel each, 12–20 (14: 보통). */
export const drawerPoints = [12, 13, 14, 15, 16, 17, 18, 19, 20];
export const drawerDefault = 14;
export const drawerLegacy: Record<LegacyTextSize, number> = { small: 13, regular: 14, large: 16, extraLarge: 18 };

export function drawerPoint(saved: unknown, legacy: unknown): number {
  if (typeof saved === "number" && drawerPoints.includes(saved)) return saved;
  return typeof legacy === "string" && legacy in drawerLegacy ? drawerLegacy[legacy as LegacyTextSize] : drawerDefault;
}

export const drawerLegacyName = (points: number): LegacyTextSize =>
  nearest(points, Object.entries(drawerLegacy).map(([name, at]) => [name as LegacyTextSize, at]));

/** A card's preview at each step: 11 · 12 · 13 · 13 · 14 · 14 · 15 · 15 · 16 (1.30's 13 → 12 · 14 → 13 · 16 → 14 · 18 → 15). */
export const drawerPreview = (points: number): number => [11, 12, 13, 13, 14, 14, 15, 15, 16][Math.min(20, Math.max(12, points)) - 12];

/** 줄 간격 (F2): the words' line as a share of their size. */
export type LineSpacing = "tight" | "regular" | "loose";
export const lineSpacings: LineSpacing[] = ["tight", "regular", "loose"];
export const lineFactor: Record<LineSpacing, number> = { tight: 1.6, regular: 1.85, loose: 2.1 };
export const readLineSpacing = (value: unknown): LineSpacing => (lineSpacings.includes(value as LineSpacing) ? value as LineSpacing : "regular");

/** 문단 간격 (F2): the room after a paragraph (a block of the memo's markdown), as a share of a line. */
export type ParagraphSpacing = "regular" | "wide" | "wider";
export const paragraphSpacings: ParagraphSpacing[] = ["regular", "wide", "wider"];
export const paragraphLines: Record<ParagraphSpacing, number> = { regular: 0, wide: 0.35, wider: 0.7 };
export const readParagraphSpacing = (value: unknown): ParagraphSpacing => (paragraphSpacings.includes(value as ParagraphSpacing) ? value as ParagraphSpacing : "regular");

/** 코드 글꼴 (#143): the system's fixed-width face (Cascadia Mono · Consolas) or the bundled D2Coding. */
export type CodeFont = "system" | "d2coding";
export const codeFonts: CodeFont[] = ["system", "d2coding"];
export const readCodeFont = (value: unknown): CodeFont => (value === "d2coding" ? "d2coding" : "system");

export interface DrawerMetrics { body: number; line: number; paragraph: number; preview: number; previewLine: number }

/** The numbers one setting draws with (px; the Mac's pt are the same numbers). */
export function drawerMetrics(points: number, line: LineSpacing = "regular", paragraph: ParagraphSpacing = "regular"): DrawerMetrics {
  const body = Math.min(20, Math.max(12, points));
  const height = Math.round(body * lineFactor[line]);
  const preview = drawerPreview(body);
  return { body, line: height, paragraph: Math.round(height * paragraphLines[paragraph]), preview, previewLine: Math.round((preview * 20) / 13) };
}

// ─── Paragraphs ──────────────────────────────────────────────────────────────

/** The block a line belongs to (undefined: a blank line). A heading and a rule are each a block of their own. */
function block(kind: LineKind): string | undefined {
  switch (kind) {
    case "blank": return undefined;
    case "list": case "olist": case "check": return "list";
    case "fence": case "code": return "code";
    default: return kind;
  }
}

/** Whether the room after a paragraph goes under this line: it ends its block and something follows it. */
export function endsParagraph(kind: LineKind, next: LineKind | undefined): boolean {
  const here = block(kind);
  if (next === undefined || here === undefined) return false;
  const there = block(next);
  return there === undefined || here !== there || here === "heading" || here === "rule";
}

/** The same for every line of a text (its first line, the title, included as a line). */
export function paragraphEnds(text: string): boolean[] {
  let inBlock = false;
  const kinds = text.split("\n").map((line) => {
    const read = readLine(line, inBlock);
    if (read.kind === "fence") inBlock = !inBlock;
    return read.kind;
  });
  return kinds.map((kind, index) => endsParagraph(kind, kinds[index + 1]));
}

function nearest<T>(value: number, table: [T, number][]): T {
  // Ties go to the smaller.
  return [...table].sort((a, b) => a[1] - b[1]).reduce((best, row) => (Math.abs(row[1] - value) < Math.abs(best[1] - value) - 1e-9 ? row : best))[0];
}
