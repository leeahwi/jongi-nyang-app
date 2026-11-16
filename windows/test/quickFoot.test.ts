import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { actionText } from "../src/core/intent";

/**
 * #387: the quick entry's button keeps all its words; when they leave no room, the key hints keep only their keycaps
 * (as the Mac's QuickEntry.swift does with ViewThatFits). The footer is measured in the window, so this reads the
 * sources the way i18nStrings.test.ts does; the snapshots `quick-entry-repeat` (ko · en · nl) show the result.
 */
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), "src", "renderer", file), "utf8");

test("the longest button words are the repeating to-do's (the snapshot quick-entry-repeat draws them)", () => {
  const kinds = ["todo", "event", "timer", "alarm", "memo", "repeat"] as const;
  for (const language of ["ko", "en", "nl"] as const) {
    const words = kinds.map((kind) => actionText({ kind } as Parameters<typeof actionText>[0], language));
    const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
    assert.equal(longest, actionText({ kind: "repeat" } as Parameters<typeof actionText>[0], language));
  }
});

test("a tight quick entry footer hides the hints' words, never the button's (#387)", () => {
  const css = read("quick.css");
  assert.match(css, /\.slip-foot\.tight \.keys \.word \{ display: none; \}/);
  const keys = read("inputLine.ts");
  assert.match(keys, /h\("span", \{ class: "word" \}, word\)/);
  const quick = read("quick.ts");
  assert.match(quick, /classList\.toggle\("tight", keys\.scrollWidth > keys\.clientWidth\)/);
  // The button stays whole: .sbtn is flex: none and nowrap (slip.css).
  assert.match(read("slip.css"), /\.sbtn \{[^}]*white-space: nowrap;[^}]*flex: none;/);
});
