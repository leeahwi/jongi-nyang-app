import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { contrast, mix, parseHex, toHex, tokensIn } from "../src/core/contrast";

/**
 * Every text colour on every surface it is drawn on, in 종이 (day) and 밤 종이 (night), against WCAG
 * AA: 4.5:1 for text, 3:1 for UI marks (a checkbox's edge, the focus ring, a badge's icon). Both must
 * pass every pair (stage 4 split ink-3 into ink-3 for text and --faint for marks, and gave sage and
 * clay text colours of their own). Prints both tables (the same as night-tokens.md).
 */

const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/base.css"), "utf8");
const dayBlock = css.slice(css.indexOf(":root {"), css.indexOf("}", css.indexOf(":root {")));
const nightStart = css.indexOf(':root[data-paper="night"] {');
const nightBlock = css.slice(nightStart, css.indexOf("}", nightStart));
const day = tokensIn(dayBlock);
const night = { ...day, ...tokensIn(nightBlock) };

type Need = "text" | "ui";
interface Pair { fg: string; bg: string; need: Need; where: string }

/** The surfaces a colour sits on; "a 20% tint" = color-mix of the colour over the paper. */
const pairs: Pair[] = [
  ...["paper", "paper-2", "card"].flatMap((bg) => [
    { fg: "ink", bg, need: "text" as Need, where: "titles, rows, labels" },
    { fg: "ink-2", bg, need: "text" as Need, where: "secondary text, row meta" },
    { fg: "ink-3", bg, need: "text" as Need, where: "hints, placeholders, hour labels" },
    { fg: "sage-text", bg, need: "text" as Need, where: "eyebrow date, times, links" },
    { fg: "clay-text", bg, need: "text" as Need, where: "late, soon, warnings" },
    { fg: "check-border", bg, need: "ui" as Need, where: "empty checkbox edge" },
    { fg: "sage", bg, need: "ui" as Need, where: "focus ring, rings, switch on" },
    { fg: "clay", bg, need: "ui" as Need, where: "now line, the focus card's ring" },
    { fg: "stamp", bg, need: "text" as Need, where: "AI 연결's stamp on a row" },
  ]),
  { fg: "sage-text", bg: "sage-2", need: "text", where: "selected chip, now pill, pick bar, the list's 지금 · 다음 mark (#31)" },
  { fg: "ink", bg: "sage-2", need: "text", where: "text on a selected row" },
  { fg: "clay-text", bg: "clay-2", need: "text", where: "soon pill, ringing pill" },
  { fg: "on-sage", bg: "sage", need: "text", where: "primary button, today's date" },
  { fg: "on-sage", bg: "band-lavender", need: "ui", where: "저녁 정리: the → in a picked round pick (#32; the pick itself is the lavender band on paper and card)" },
  { fg: "paper", bg: "ink", need: "text", where: "toast, tooltips" },
  { fg: "toast-action", bg: "ink", need: "text", where: "toast action" },
  { fg: "toast-strong", bg: "ink", need: "text", where: "toast's strong words, icon" },
  { fg: "event-blue", bg: "event-blue-2", need: "ui", where: "event badge's icon" },
  { fg: "memo-ink", bg: "memo-2", need: "ui", where: "memo badge's icon" },
  // 1.30: the tabs are solid and, at night, lighter than the paper, so a tab's name and count are --tab-ink (a dark
  // ink at night too), picked or not. The old tab colours live on as --tint-1 / --tint-2 under ink.
  ...["tab-1", "tab-2"].map((bg) => ({ fg: "tab-ink", bg, need: "text" as Need, where: "a tab's name and count, picked or not" })),
  ...["tint-1", "tint-2", "tab-3"].map((bg) => ({ fg: "ink", bg, need: "text" as Need, where: "settings panes' icon tiles, the help's group badges" })),
];

function resolve(tokens: Record<string, string>, name: string): string {
  if (tokens[name]) return tokens[name];
  throw new Error(`no token --${name}`);
}

function table(label: string, tokens: Record<string, string>): { lines: string[]; failures: string[] } {
  const lines = [`${label}: fg on bg = ratio (needs) · where`];
  const failures: string[] = [];
  for (const pair of pairs) {
    const ratio = contrast(resolve(tokens, pair.fg), resolve(tokens, pair.bg));
    const needed = pair.need === "text" ? 4.5 : 3;
    const ok = ratio >= needed;
    lines.push(`  ${ok ? "ok  " : "FAIL"} --${pair.fg} on --${pair.bg} = ${ratio.toFixed(2)} (${needed}) · ${pair.where}`);
    if (!ok) failures.push(`${pair.fg} on ${pair.bg} ${ratio.toFixed(2)}`);
  }
  return { lines, failures };
}

test("contrast: every text and mark in 밤 종이 passes WCAG AA (table printed)", () => {
  const { lines, failures } = table("밤 종이 (night)", night); // i18n-ok
  console.log(lines.join("\n"));
  assert.deepEqual(failures, []);
});

test("contrast: every text and mark in 종이 (day) passes WCAG AA too (stage 4, table printed)", () => {
  const { lines, failures } = table("종이 (day)", day); // i18n-ok
  console.log(lines.join("\n"));
  assert.deepEqual(failures, []);
});

test("contrast: the stage-4 day tokens are the shared table's (Mac 1.37.0 = Windows 1.22.0)", () => {
  assert.deepEqual([day["ink-3"], day.faint, day["clay-text"], day["sage-text"], day["check-border"], day["event-blue"]], ["#726e64", "#a5a195", "#955842", "#546f52", "#908a7b", "#5585cc"]);
  assert.deepEqual([night["ink-3"], night.faint, night["clay-text"], night["sage-text"], night["check-border"]], ["#9f9989", "#8a8577", "#e29a7c", "#a3c49c", "#837e69"]);
});

test("contrast (1.30): the solid tabs' colours, edges and ink are option B (the same as the Mac's PaperTheme)", () => {
  assert.deepEqual([day["tab-1"], day["tab-1-edge"], day["tab-2"], day["tab-2-edge"], day["tab-ink"]], ["#f6dc7c", "#dcc062", "#d6ccf6", "#bdb0ea", "#2f2e2a"]);
  assert.deepEqual([night["tab-1"], night["tab-1-edge"], night["tab-2"], night["tab-2-edge"], night["tab-ink"]], ["#c4a245", "#d6b65a", "#9d92dc", "#b2a8ea", "#1f1d18"]);
  assert.ok(contrast(night["tab-ink"], night["tab-1"]) >= 6.85 && contrast(night["tab-ink"], night["tab-2"]) >= 6);
  // No stripes over the tabs any more.
  const note = fs.readFileSync(path.join(process.cwd(), "src/renderer/note.css"), "utf8");
  assert.ok(!/\.index-tab::after/.test(note), "no stripes over the index tabs");
});

test("contrast (1.30): the slips' tape is solid with a 1 px edge, no stripes (the Mac's PaperTheme tape tokens)", () => {
  const kinds = ["todo", "memo", "event", "timer", "alarm", "confirm"];
  assert.deepEqual(kinds.map((kind) => [day[`tape-${kind}`], day[`tape-${kind}-edge`]]),
    [["#e9cf7a", "#c8b269"], ["#cfc6ea", "#b2aac9"], ["#bcd0ea", "#a2b3c9"], ["#c9dcc4", "#adbda9"], ["#ecc4bc", "#cba9a2"], ["#d9d3c4", "#bbb5a9"]]);
  assert.deepEqual(kinds.map((kind) => [night[`tape-${kind}`], night[`tape-${kind}-edge`]]),
    [["#8a7a3f", "#a19565"], ["#5d5578", "#7d7793"], ["#4d5f7a", "#717f95"], ["#4f6650", "#728573"], ["#7a4f4a", "#95726e"], ["#55524a", "#77756e"]]);
  // At night the tape is lighter than the paper, and its edge lighter still (so it shows).
  for (const kind of kinds) assert.ok(contrast(night[`tape-${kind}-edge`], night.paper) > contrast(night[`tape-${kind}`], night.paper), kind);
  const slip = fs.readFileSync(path.join(process.cwd(), "src/renderer/slip.css"), "utf8");
  assert.ok(!/repeating-linear-gradient|--tape-stripe/.test(slip), "no stripes on the tape");
});

test("contrast: event colours at night are the day's at 85 % brightness, still apart from the paper", () => {
  for (const hex of ["#5b8bd0", "#6b8f71", "#d9765f", "#8e7cc3", "#d4a72c", "#8a8a8a"]) {
    const dimmed = toHex(mix(parseHex(hex), [0, 0, 0], 0.85));
    assert.ok(contrast(dimmed, night.paper) >= 2, `${hex} → ${dimmed} on night paper`);
  }
});

test("contrast: the maths (black on white is 21:1, a colour on itself 1:1)", () => {
  assert.equal(Math.round(contrast("#000", "#fff")), 21);
  assert.equal(contrast("#2a2924", "#2a2924"), 1);
  assert.deepEqual(parseHex("#abc"), [170, 187, 204]);
});

test("contrast (1.25): the open day's event blocks — ink titles and ink-2 times on each colour's tint pass AA, day and night", () => {
  // .tt-block.event: color-mix(the event colour 14 % (night 24 %), the paper); the bar beside it is a mark (3:1 on the tint not needed).
  const failures: string[] = [];
  for (const hex of ["#5b8bd0", "#6b8f71", "#d9765f", "#8e7cc3", "#d4a72c", "#8a8a8a"]) {
    for (const [label, tokens, share] of [["day", day, 0.14], ["night", night, 0.24]] as const) {
      const tint = toHex(mix(parseHex(hex), parseHex(tokens.paper), share));
      for (const fg of ["ink", "ink-2"]) {
        const ratio = contrast(tokens[fg], tint);
        if (ratio < 4.5) failures.push(`${label} --${fg} on ${hex} tint ${tint} = ${ratio.toFixed(2)}`);
      }
    }
  }
  assert.deepEqual(failures, []);
});

test("contrast (1.30): 할 일 스페이스's eight bands are marks at 3:1 or more on paper, paper-2 and card, day and night (table printed)", () => {
  const colors = ["lavender", "pink", "mint", "yellow", "sky", "peach", "sand", "gray"];
  const failures: string[] = [];
  const lines: string[] = [];
  for (const [label, tokens] of [["day", day], ["night", night]] as const) {
    for (const color of colors) {
      const band = tokens[`band-${color}`];
      assert.ok(band, `no --band-${color} (${label})`);
      const ratios = ["paper", "paper-2", "card"].map((bg) => contrast(band, tokens[bg]));
      lines.push(`  ${label} --band-${color} ${band}: ${ratios.map((ratio) => ratio.toFixed(2)).join(" / ")} (paper / paper-2 / card, needs 3)`);
      ratios.forEach((ratio, index) => { if (ratio < 3) failures.push(`${label} ${color} on ${["paper", "paper-2", "card"][index]} ${ratio.toFixed(2)}`); });
    }
  }
  console.log(lines.join("\n"));
  assert.deepEqual(failures, []);
});
