import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  drawerFaceMetrics, drawerLegacy, drawerLegacyName, drawerMetrics, drawerPoint, noteLegacy, noteLegacyName, noteScales, noteStep, paragraphEnds,
  type LineSpacing, type ParagraphSpacing,
} from "../src/core/textSteps";
import { bodyFontSize, type DrawerFont } from "../src/core/types";
import { drawerLook, drawerPaper, drawerThemeValue, readDrawerTheme } from "../src/core/memoDrawer";

// 글꼴 · 종이 설정 (#141 · #142): the shared cases from docs/plans/settings-cases.json (the Mac's test-settings.sh reads
// the same file) — the note's seven steps and the drawer's nine read from 1.30's names and written back as the nearest of
// them, the drawer's line, paragraph and preview sizes, where a paragraph ends.
const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "settings-cases.json"), "utf8")) as {
  noteScales: number[];
  noteSteps: { case: string; saved?: number; legacy?: string; step: number }[];
  noteLegacyNames: string[];
  drawerPoints: { case: string; saved?: number; legacy?: string; points: number }[];
  drawerLegacyNames: Record<string, string>;
  drawerMetrics: { case: string; points: number; line?: LineSpacing; paragraph?: ParagraphSpacing; expect: Record<string, number> }[];
  paragraphs: { case: string; text: string; ends: boolean[] }[];
  drawerFaces: { case: string; points: number; face: DrawerFont; latin: boolean; expect: Record<string, number> }[];
  drawerPapers: { case: string; theme?: string; saved?: boolean; paper: string; nightPaper: boolean; writes: string; shown: string[] }[];
};

test("F1 the note's seven scales, and 1.30's four sizes unchanged on them", () => {
  assert.deepEqual(noteScales, file.noteScales);
  for (const font of ["pen", "brush", "clean"] as const) {
    for (const [name, step] of Object.entries(noteLegacy)) assert.equal(bodyFontSize(font, step), bodyFontSize(font, name as keyof typeof noteLegacy), `${font} ${name}`);
    const sizes = noteScales.map((_, step) => bodyFontSize(font, step));
    assert.ok(sizes.every((size, index) => index === 0 || size > sizes[index - 1]), `${font}: each step larger`);
  }
});
for (const entry of file.noteSteps) test(entry.case, () => assert.equal(noteStep(entry.saved, entry.legacy), entry.step));
test("F1 a step written back as the nearest of 1.30's four", () => {
  assert.deepEqual(noteScales.map((_, step) => noteLegacyName(step)), file.noteLegacyNames);
});
for (const entry of file.drawerPoints) test(`${entry.case} (drawer)`, () => assert.equal(drawerPoint(entry.saved, entry.legacy), entry.points));
test("F1 the drawer's points written back as the nearest of 1.30's four", () => {
  for (const [points, name] of Object.entries(file.drawerLegacyNames)) assert.equal(drawerLegacyName(Number(points)), name, points);
  for (const [name, points] of Object.entries(drawerLegacy)) assert.equal(drawerLegacyName(points), name);
});
for (const entry of file.drawerMetrics) {
  test(`${entry.case} (metrics)`, () => assert.deepEqual(drawerMetrics(entry.points, entry.line ?? "regular", entry.paragraph ?? "regular"), entry.expect));
}
// #198: a face's body and preview sizes and the preview's lines (the card's preview follows the body's face).
for (const entry of file.drawerFaces) test(`${entry.case} (face)`, () => assert.deepEqual(drawerFaceMetrics(entry.points, entry.face, entry.latin), entry.expect));
for (const entry of file.paragraphs) test(entry.case, () => assert.deepEqual(paragraphEnds(entry.text), entry.ends));
for (const entry of file.drawerPapers) {
  test(entry.case, () => {
    const theme = readDrawerTheme(entry.theme);
    const picked = drawerPaper(theme, entry.saved);
    assert.deepEqual(picked, { paper: entry.paper, nightPaper: entry.nightPaper });
    assert.equal(drawerThemeValue(picked.paper, picked.nightPaper), entry.writes);
    assert.deepEqual([drawerLook(theme, false, entry.saved), drawerLook(theme, true, entry.saved)], entry.shown);
  });
}
