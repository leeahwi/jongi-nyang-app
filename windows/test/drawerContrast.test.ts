import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { contrast, tokensIn } from "../src/core/contrast";
import { backdropClashes, darkPapers, folderColors, memoPapers, type MemoPaper } from "../src/core/memoDrawer";

/** #244: the seven new papers' drawer colours as docs/plans/paper-themes/tokens.json gives them (`drawer.palette`). */
const tokensJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), "../docs/plans/paper-themes/tokens.json"), "utf8")) as { papers: { key: string; drawer: { existing?: boolean; palette?: Record<string, string | number> } }[] };
const newPalettes = Object.fromEntries(tokensJson.papers.filter((paper) => paper.drawer.palette).map((paper) => [paper.key, paper.drawer.palette!]));

/**
 * 메모 서랍's eight papers (src/renderer/drawer.css, 1.29 colours; #142 한지 · 쑥색 · 벚꽃 · 먹색): every text colour on what it sits on at 4.5:1,
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

/** The papers (#142: 한지 · 쑥색 · 벚꽃 · 먹색 too, the Mac's colours; #244: all fifteen). */
const looks: string[] = memoPapers;

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
  // #240: the progress sits inside the checklist's chip; all done, the chip reads ‘✓ 4/4’ in the check colour.
  ["d-bar", "d-chip", "ui", "a checklist's progress fill inside its chip (#240)"],
  ["d-check", "d-chip", "ui", "a finished checklist's ✓ in its chip (#240)"],
  ["d-ink", "d-chip", "text", "a finished checklist's ‘4/4’ (#240)"],
  ["d-pin", "d-card", "ui", "the paw on a pinned card"],
  ["d-pin", "d-paper", "ui", "the paw on the 고정 header"],
  ["d-open", "d-card", "ui", "the default open line"],
  ["d-card", "d-paper", "sheet", "a sheet on the drawer (a step darker, as the mock: day 1.35 · night 1.53 · kraft 1.90 · grid 1.26)"],
  ["d-card-edge", "d-card", "edge", "a sheet's 1 px edge"],
  // #82: 새 폴더 is an empty bookmark — the sheet's paper, a dashed edge in the open checkbox's colour, a + in the secondary ink.
  ["d-preview", "d-card", "ui", "the empty bookmark's + (#82)"],
  ["d-box", "d-card", "ui", "the empty bookmark's dashed edge on its paper (#82)"],
  // #83: the close bar on the inner edge, at rest and under the pointer; under 바탕 없음 on a pill of sheet paper.
  ["d-closebar", "d-paper", "ui", "the close bar at rest, a short line (#83, #111)"],
  ["d-closebar", "d-card", "ui", "the close bar on its pill, 바탕 없음 (#83)"],
  // #135: the link field on its pill (heading, keys, 링크 빼기); #117: the quick-write slip's hint, where it goes.
  ["d-meta", "d-pill", "text", "the link field's heading and keys (#135)"],
  ["d-preview", "d-pill", "text", "the link field's 링크 빼기 (#135)"],
  ["d-preview", "d-qk", "text", "the quick-write hint: where it goes (#117)"],
];

for (const look of looks) {
  test(`drawer contrast: ${look} paper — text 4.5:1, marks 3:1, every bookmark's name, edge and open line`, () => {
    const tokens = block(look);
    const lines = [`${look}: fg on bg = ratio (needs) · where`];
    const failures: string[] = [];
    const check = (fg: string, bg: string, need: Need, where: string) => {
      assert.ok(tokens[fg] && tokens[bg], `${look}: --${fg} or --${bg} missing`);
      const ratio = contrast(tokens[fg], tokens[bg]);
      // #244: the seven new papers are measured as tokens.json's check (the Mac's DRAWER_PAIRS) measures them: the open
      // line a mark at 3:1 (WCAG), a sheet on the drawer told apart at 1.15:1 (밤하늘's slip on its night-blue paper is 1.20).
      const needed = look in newPalettes && need === "line" ? 3 : look in newPalettes && need === "sheet" ? 1.15 : needs[need];
      lines.push(`  ${ratio >= needed ? "ok  " : "FAIL"} --${fg} on --${bg} = ${ratio.toFixed(2)} (${needed}) · ${where}`);
      if (ratio < needed) failures.push(`${fg} on ${bg} ${ratio.toFixed(2)}`);
    };
    for (const [fg, bg, need, where] of pairs) check(fg, bg, need, where);
    check("d-pintab-ink", "d-pintab", "ui", "the paw on the 고정 bookmark (1.30)");
    for (const color of folderColors) {
      check(`c-${color}-ink`, `c-${color}-a`, "text", `the ${color} bookmark's name`);
      check(`c-${color}-line`, "d-card", "line", `the open ${color} memo's 3 px line and the picked one's 2 px edge (#118)`);
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
  // #111 · #164: the close tab is the same cream as the handle; its › 4.5:1 on it.
  const barAt = css.indexOf(".closebar {");
  const bar = tokensIn(css.slice(barAt, css.indexOf("}", barAt)));
  assert.deepEqual([bar["handle-fill"], bar["handle-edge"], bar["handle-paw"]], ["#f6e7b0", "#e2cf86", "#5e4a12"]);
  const arrow = contrast(bar["handle-paw"], bar["handle-fill"]);
  console.log(`close tab: › on its cream = ${arrow.toFixed(2)} (4.5)`);
  assert.ok(arrow >= 4.5);
  // 고정 follows the note's 오늘 tab on day and night paper.
  assert.deepEqual([block("day")["d-pintab"], block("day")["d-pintab-edge"]], ["#f6dc7c", "#dcc062"]);
  assert.deepEqual([block("night")["d-pintab"], block("night")["d-pintab-edge"], block("night")["d-pintab-ink"]], ["#c4a245", "#d6b65a", "#1f1d18"]);
});

// #14 (option B): a card's preview is the ink one step lighter over its sheet — day 78 %, night 86 % (the mock), kraft 84 %
// and grid 80 % — written as the colour that makes, the same as the Mac's DrawerPalette.preview; and on every paper it
// reads better than the grey (--d-preview) it replaced.
const peekStrength: Record<string, number> = {
  day: 0.78, night: 0.86, kraft: 0.84, grid: 0.8, hanji: 0.8, sage: 0.84, blossom: 0.82, ink: 0.86,
  ...Object.fromEntries(Object.entries(newPalettes).map(([key, palette]) => [key, palette.previewInk as number])),
};
const blend = (fg: string, alpha: number, bg: string) => "#" + [1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * alpha + parseInt(bg.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0")).join("");
for (const look of looks) {
  test(`drawer contrast (#14): ${look} preview is the ink at ${peekStrength[look] * 100} % and reads better than before`, () => {
    const tokens = block(look);
    assert.equal(tokens["d-peek"], blend(tokens["d-ink"], peekStrength[look], tokens["d-card"]));
    const now = contrast(tokens["d-peek"], tokens["d-card"]), before = contrast(tokens["d-preview"], tokens["d-card"]);
    console.log(`${look}: preview --d-peek on --d-card = ${now.toFixed(2)} (was --d-preview ${before.toFixed(2)})`);
    assert.ok(now >= 4.5 && now > before);
  });
}

// #82 · #83: the + under the pointer (ink on the sheet with 6 % ink over it), and the close bar on the see-through
// paper (반투명 82 %, 강하게 62 % over the window's material, taken as #ececec — #2a2a2a under night paper — as the
// Mac's check does): 3:1 on every paper. The bar's colour is the Mac's DrawerPalette.closeBar.
const macCloseBar: Record<string, string> = {
  day: "#7b766a", night: "#8e897d", kraft: "#6a583f", grid: "#74808b", hanji: "#847f74", sage: "#768170", blossom: "#8c767b", ink: "#757c8c",
  ...Object.fromEntries(Object.entries(newPalettes).map(([key, palette]) => [key, palette.closeBar as string])),
};
for (const look of looks) {
  test(`drawer contrast (#82, #83): ${look} — the + under the pointer, the close bar on the see-through paper`, () => {
    const tokens = block(look);
    assert.equal(tokens["d-closebar"], macCloseBar[look], "the same colour as the Mac's closeBar");
    const material = darkPapers.includes(look as MemoPaper) ? "#2a2a2a" : "#ececec";
    const rows: [string, number][] = [
      ["the + under the pointer: --d-ink on the 6 % tint", contrast(tokens["d-ink"], blend(tokens["d-ink"], 0.06, tokens["d-card"]))],
      ["the close bar on the 반투명 paper (82 %)", contrast(tokens["d-closebar"], blend(tokens["d-paper"], 0.82, material))],
      ["the close bar on the 강하게 paper (62 %)", contrast(tokens["d-closebar"], blend(tokens["d-paper"], 0.62, material))],
    ];
    for (const [where, ratio] of rows) console.log(`${look}: ${ratio >= 3 ? "ok  " : "FAIL"} ${ratio.toFixed(2)} (3) · ${where}`);
    assert.deepEqual(rows.filter(([, ratio]) => ratio < 3).map(([where]) => where), []);
  });
}

// #184: on Windows 11 the acrylic under 반투명 · 강하게 is light or dark with the whole app (nativeTheme), not with the
// drawer paper. Every paper under a light and a dark app, at 82 % and 62 %: what sits on the paper (the folder's name,
// the words 반투명 · 강하게 draw in the ink, the icons, the rings, the paw, the close bar) against the paper as drawn. A
// paper of the other kind than the app (`backdropClashes`) is drawn on 불투명, so it is measured on the solid paper; a
// matching one over its acrylic (#ececec light, #2a2a2a dark, as above). The clashing pairs' numbers over the acrylic
// are printed as well (what #184 measured).
const onPaper: [string, Need, string][] = [
  ["d-title", "text", "the folder's name"],
  ["d-ink", "text", "메모 서랍 over the name, a date group and its count, the footer (the ink under 반투명 · 강하게)"],
  ["d-icon", "ui", "the header's icons"],
  ["d-select", "ui", "the focus ring on the paper"],
  ["d-pin", "ui", "the paw on the 고정 header"],
  ["d-closebar", "ui", "the close bar at rest"],
];
for (const darkApp of [false, true]) {
  test(`drawer contrast (#184): every paper under a ${darkApp ? "dark" : "light"} app, 반투명 and 강하게 — a clashing paper is drawn on 불투명`, () => {
    const material = darkApp ? "#2a2a2a" : "#ececec";
    const failures: string[] = [];
    let missed = 0;
    for (const look of looks) {
      const tokens = block(look);
      const clash = backdropClashes(look as MemoPaper, darkApp);
      assert.equal(clash, darkPapers.includes(look as MemoPaper) !== darkApp, `${look}: clashes only when its light or dark differs from the app's`);
      for (const [backdrop, alpha] of [["반투명", 0.82], ["강하게", 0.62]] as const) {
        const seeThrough = blend(tokens["d-paper"], alpha, material);
        const drawn = clash ? tokens["d-paper"] : seeThrough;
        for (const [fg, need, where] of onPaper) {
          const ratio = contrast(tokens[fg], drawn), needed = needs[need];
          const over = contrast(tokens[fg], seeThrough);
          if (clash && over < needed) missed += 1;
          console.log(`${darkApp ? "dark" : "light"} app · ${look} · ${backdrop}${clash ? " → 불투명" : ""}: ${ratio >= needed ? "ok  " : "FAIL"} --${fg} ${ratio.toFixed(2)} (${needed})${clash ? ` · over the acrylic ${over.toFixed(2)}` : ""} · ${where}`);
          if (ratio < needed) failures.push(`${look} ${backdrop} --${fg} ${ratio.toFixed(2)}`);
        }
      }
    }
    console.log(`${darkApp ? "dark" : "light"} app: ${missed} pairs would miss over the acrylic of the other kind; drawn on 불투명, none do`);
    assert.deepEqual(failures, []);
  });
}
