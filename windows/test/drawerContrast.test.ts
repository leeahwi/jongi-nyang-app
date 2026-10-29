import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { contrast, tokensIn } from "../src/core/contrast";
import { folderColors } from "../src/core/memoDrawer";

/**
 * 메모 서랍's four papers (src/renderer/drawer.css, 1.29 colours): every text colour on what it sits on at 4.5:1,
 * every mark (an icon, a checkbox's edge, a tick, the selection ring, the progress bar, the paw, the open memo's
 * 3 px line in each folder's colour) at 3:1 — and each folder colour's bookmark name on its colour (solid since 1.30), the
 * 고정 bookmark's paw on its own colour, and the screen-edge handle's paw on its cream (one colour on every paper). The
 * paper's edges (a sheet's 1 px edge on the drawer, a bookmark's edge) are drawn to tell things apart, with a
 * shadow under the sheet as well; they're measured and kept at least where the mock had them (edges 1.4:1, a sheet on
 * the drawer 1.25:1). Each paper's
 * block is also what a memo with its own paper (이 메모의 종이) draws with. Prints one table per paper.
 */

const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/drawer.css"), "utf8");
const block = (look: string) => {
  const start = css.indexOf(`:root[data-look="${look}"]`);
  assert.ok(start >= 0, `no block for ${look}`);
  const open = css.indexOf("{", start);
  assert.ok(css.slice(start, open).includes(`.it[data-sheet="${look}"]`), `${look}: a memo's own paper uses the same block`);
  return tokensIn(css.slice(open, css.indexOf("}", open)));
};

type Need = "text" | "ui" | "line" | "edge" | "sheet";
// The open memo's line: a mark (3:1), kept at 3.2:1 or more as the spec measured it.
const needs: Record<Need, number> = { text: 4.5, ui: 3, line: 3.2, edge: 1.4, sheet: 1.25 };
const pairs: [string, string, Need, string][] = [
  ["d-ink", "d-card", "text", "a memo's words"],
  ["d-ink", "d-qk", "text", "the quick-write slip's words"],
  ["d-ink", "d-menu", "text", "menu rows, a bookmark's label"],
  ["d-title", "d-paper", "text", "the folder's name"],
  ["d-sub", "d-paper", "text", "메모 서랍 over the name"],
  ["d-meta", "d-card", "text", "a card's time, `오후 5:38 고침`, 2/4"],
  ["d-meta", "d-qk", "text", "the slip's placeholder and hint"],
  ["d-meta", "d-menu", "text", "a menu's small heading, shortcuts, counts"],
  ["d-peek", "d-card", "text", "a card's preview lines, 13px (#14)"],
  ["d-preview", "d-card", "text", "a search result's folder line, a hint on a sheet"],
  ["d-preview", "d-chip", "text", "a chip's words (link, phone, 2/4)"],
  ["d-preview", "d-menu", "text", "a swatch's name in a menu"],
  ["d-done", "d-card", "text", "a ticked checklist line"],
  ["d-grp", "d-paper", "text", "a date group's header"],
  ["d-meta", "d-paper", "text", "a date group's count"],
  ["d-foot", "d-paper", "text", "the footer, an empty folder's words, the search field's placeholder"],
  ["d-danger", "d-menu", "text", "지우기 · 폴더 지우기… in a menu"],
  ["d-icon", "d-paper", "ui", "the header's icons"],
  ["d-icon", "d-card", "ui", "the hover pill's icons"],
  ["d-icon", "d-pill", "ui", "the open memo's pill icons, the ⚙ button"],
  ["d-icon", "d-menu", "ui", "a menu row's icon"],
  ["d-danger", "d-pill", "ui", "지우기 in the pill"],
  ["d-box", "d-card", "ui", "an empty checkbox"],
  ["d-check", "d-card", "ui", "a ticked checkbox"],
  ["d-on-check", "d-check", "ui", "the tick inside it"],
  ["d-select", "d-card", "ui", "the keyboard's focus ring on a sheet"],
  ["d-select", "d-paper", "ui", "the focus ring on the paper"],
  ["d-select", "d-menu", "ui", "the chosen swatch's ring"],
  ["d-bar", "d-bar-track", "ui", "a checklist's progress"],
  ["d-pin", "d-card", "ui", "the paw on a pinned card"],
  ["d-pin", "d-paper", "ui", "the paw on the 고정 header"],
  ["d-open", "d-card", "ui", "the default open line"],
  ["d-card", "d-paper", "sheet", "a sheet on the drawer (a step darker, as the mock: day 1.35 · night 1.53 · kraft 1.90 · grid 1.26)"],
  ["d-card-edge", "d-card", "edge", "a sheet's 1 px edge"],
];

for (const look of ["day", "night", "kraft", "grid"]) {
  test(`drawer contrast: ${look} paper — text 4.5:1, marks 3:1, every bookmark's name, edge and open line`, () => {
    const tokens = block(look);
    const lines = [`${look}: fg on bg = ratio (needs) · where`];
    const failures: string[] = [];
    const check = (fg: string, bg: string, need: Need, where: string) => {
      assert.ok(tokens[fg] && tokens[bg], `${look}: --${fg} or --${bg} missing`);
      const ratio = contrast(tokens[fg], tokens[bg]);
      const needed = needs[need];
      lines.push(`  ${ratio >= needed ? "ok  " : "FAIL"} --${fg} on --${bg} = ${ratio.toFixed(2)} (${needed}) · ${where}`);
      if (ratio < needed) failures.push(`${fg} on ${bg} ${ratio.toFixed(2)}`);
    };
    for (const [fg, bg, need, where] of pairs) check(fg, bg, need, where);
    check("d-pintab-ink", "d-pintab", "ui", "the paw on the 고정 bookmark (1.30)");
    for (const color of folderColors) {
      check(`c-${color}-ink`, `c-${color}-a`, "text", `the ${color} bookmark's name`);
      check(`c-${color}-line`, "d-card", "line", `the open or picked ${color} memo's 3 px line and ring`);
      check(`c-${color}-edge`, "d-paper", "edge", `the ${color} bookmark's 1 px edge on the drawer`);
    }
    console.log(lines.join("\n"));
    assert.deepEqual(failures, []);
  });
}

test("drawer contrast (1.30): no stripes on the bookmarks or the handle; the handle is one pale cream, its paw 3:1 on it", () => {
  assert.ok(!/repeating-linear-gradient\(135deg/.test(css), "no diagonal stripes left in drawer.css");
  const start = css.indexOf(".handle {");
  const handle = tokensIn(css.slice(start, css.indexOf("}", start)));
  assert.deepEqual([handle["handle-fill"], handle["handle-edge"], handle["handle-paw"]], ["#f6e7b0", "#e2cf86", "#5e4a12"]);
  const ratio = contrast(handle["handle-paw"], handle["handle-fill"]);
  console.log(`handle: --handle-paw on --handle-fill = ${ratio.toFixed(2)} (3) · the paw on the cream, every paper`);
  assert.ok(ratio >= 3);
  // 고정 follows the note's 오늘 tab on day and night paper.
  assert.deepEqual([block("day")["d-pintab"], block("day")["d-pintab-edge"]], ["#f6dc7c", "#dcc062"]);
  assert.deepEqual([block("night")["d-pintab"], block("night")["d-pintab-edge"], block("night")["d-pintab-ink"]], ["#c4a245", "#d6b65a", "#1f1d18"]);
});

// #14 (option B): a card's preview is the ink one step lighter over its sheet — day 78 %, night 86 % (the mock), kraft 84 %
// and grid 80 % — written as the colour that makes, the same as the Mac's DrawerPalette.preview; and on every paper it
// reads better than the grey (--d-preview) it replaced.
const peekStrength: Record<string, number> = { day: 0.78, night: 0.86, kraft: 0.84, grid: 0.8 };
const blend = (fg: string, alpha: number, bg: string) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0")).join("");
for (const look of ["day", "night", "kraft", "grid"]) {
  test(`drawer contrast (#14): ${look} preview is the ink at ${peekStrength[look] * 100} % and reads better than before`, () => {
    const tokens = block(look);
    assert.equal(tokens["d-peek"], blend(tokens["d-ink"], peekStrength[look], tokens["d-card"]));
    const now = contrast(tokens["d-peek"], tokens["d-card"]), before = contrast(tokens["d-preview"], tokens["d-card"]);
    console.log(`${look}: preview --d-peek on --d-card = ${now.toFixed(2)} (was --d-preview ${before.toFixed(2)})`);
    assert.ok(now >= 4.5 && now > before);
  });
}
