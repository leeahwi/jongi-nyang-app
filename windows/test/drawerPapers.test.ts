import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { tokensIn } from "../src/core/contrast";
import { paperSamples } from "../src/core/drawerPapers";

/**
 * 설정 draws each drawer paper (the sample memo under 메모 글꼴, the paper tiles, #141 · #142) from core/drawerPapers.ts:
 * those colours must be drawer.css's own, so the picture in 설정 is the paper the drawer shows.
 */
const css = fs.readFileSync(path.join(process.cwd(), "src/renderer/drawer.css"), "utf8");
const block = (look: string) => {
  const start = css.indexOf(`:root[data-look="${look}"]`);
  assert.ok(start >= 0, `no block for ${look}`);
  const open = css.indexOf("{", start);
  return tokensIn(css.slice(open, css.indexOf("}", open)));
};

for (const [look, sample] of Object.entries(paperSamples)) {
  test(`설정's ${look} paper is drawer.css's`, () => {
    const tokens = block(look);
    const pairs: [string, string][] = [
      ["paper", "d-paper"], ["edge", "d-edge"], ["card", "d-card"], ["cardEdge", "d-card-edge"], ["ink", "d-ink"], ["sub", "d-sub"], ["meta", "d-meta"],
      ["box", "d-box"], ["check", "d-check"], ["onCheck", "d-on-check"],
    ];
    for (const [key, token] of pairs) assert.equal(sample[key as keyof typeof sample], tokens[token], `${look} ${key} = --${token}`);
    const colours = ["lavender", "pink", "mint", "yellow", "sky", "peach"].map((name) => tokens[`c-${name}-a`]);
    assert.deepEqual(sample.tabs, colours, `${look}: the tile's bookmarks`);
  });
}
