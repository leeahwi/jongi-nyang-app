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
  ]),
  { fg: "sage-text", bg: "sage-2", need: "text", where: "selected chip, now pill, pick bar" },
  { fg: "ink", bg: "sage-2", need: "text", where: "text on a selected row" },
  { fg: "clay-text", bg: "clay-2", need: "text", where: "soon pill, ringing pill" },
  { fg: "on-sage", bg: "sage", need: "text", where: "primary button, today's date" },
  { fg: "paper", bg: "ink", need: "text", where: "toast, tooltips" },
  { fg: "toast-action", bg: "ink", need: "text", where: "toast action" },
  { fg: "toast-strong", bg: "ink", need: "text", where: "toast's strong words, icon" },
  { fg: "event-blue", bg: "event-blue-2", need: "ui", where: "event badge's icon" },
  { fg: "memo-ink", bg: "memo-2", need: "ui", where: "memo badge's icon" },
  ...["tab-1", "tab-2", "tab-3"].flatMap((bg) => [
    { fg: "ink", bg, need: "text" as Need, where: "the open tab's name" },
    { fg: "tab-ink", bg, need: "text" as Need, where: "the other tabs' names" },
  ]),
];

function resolve(tokens: Record<string, string>, name: string): string {
  if (tokens[name]) return tokens[name];
  if (name === "tab-ink") return tokens.ink; // var(--ink), day and night
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
