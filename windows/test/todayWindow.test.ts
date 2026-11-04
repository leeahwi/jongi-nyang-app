import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { glanceChip, glanceDate, glanceLayout, glanceProgress, glanceRowCap, glanceSlots, type GlanceCardKind } from "../src/core/glance";
import type { Lang } from "../src/core/lang";

// 오늘 창 (#200): the shared cases from docs/plans/today-window-cases.json (the Mac's test-today-window.sh reads the same
// file) — which cards stay full size and which become chips, how many to-do rows fit, 그 밖에's rows and 외 N개, the
// header's progress words and date, and the chips' words.
type Words = Record<Lang, string | null>;
const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "today-window-cases.json"), "utf8")) as {
  layout: { case: string; filled: GlanceCardKind[]; cards: GlanceCardKind[]; chips: GlanceCardKind[]; wide: boolean }[];
  rowCap: { case: string; room: number | null; cap: number }[];
  slots: { case: string; next: number; others: number; cap: number; rest: number; hidden: number }[];
  progress: ({ case: string; total: number; done: number } & Words)[];
  dates: ({ case: string; at: number[] } & Record<Lang, string>)[];
  chips: Record<GlanceCardKind, Record<Lang, string>>;
};
const langs: Lang[] = ["ko", "en", "nl"];

for (const entry of file.layout) test(entry.case, () => assert.deepEqual(glanceLayout(entry.filled), { cards: entry.cards, chips: entry.chips, wide: entry.wide }));
for (const entry of file.rowCap) test(entry.case, () => assert.equal(glanceRowCap(entry.room), entry.cap));
for (const entry of file.slots) test(entry.case, () => assert.deepEqual(glanceSlots(entry.next, entry.others, entry.cap), { rest: entry.rest, hidden: entry.hidden }));
for (const entry of file.progress) {
  test(entry.case, () => { for (const lang of langs) assert.equal(glanceProgress(entry.total, entry.done, lang) ?? null, entry[lang], lang); });
}
for (const entry of file.dates) {
  test(entry.case, () => {
    const [year, month, day, hour, minute] = entry.at;
    for (const lang of langs) assert.equal(glanceDate(new Date(year, month - 1, day, hour, minute), lang), entry[lang], lang);
  });
}
test("chips' words", () => {
  for (const kind of ["event", "timer", "alarm"] as const) for (const lang of langs) assert.equal(glanceChip(kind, lang), file.chips[kind][lang], `${kind} ${lang}`);
});
