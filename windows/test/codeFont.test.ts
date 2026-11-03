import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { readCodeFont } from "../src/core/textSteps";

/**
 * 코드 글꼴 D2Coding (#143): the bundled regular face (NAVER's 1.4.0 standard build, unchanged, so it keeps its name) is a TrueType
 * font, its SIL OFL text sits beside it, base.css loads it, drawer.css puts it first in --d-mono when picked, and the
 * system's face stays the default.
 */
const root = process.cwd();

test("D2Coding is bundled with its licence and loaded only when picked", () => {
  const font = fs.readFileSync(path.join(root, "assets/fonts/D2Coding-Regular.ttf"));
  assert.deepEqual([...font.subarray(0, 4)], [0, 1, 0, 0], "a TrueType file");
  assert.ok(font.length < 4_500_000, `one regular weight (${font.length} bytes)`);
  const licence = fs.readFileSync(path.join(root, "assets/fonts/D2Coding-OFL.txt"), "utf8");
  assert.match(licence, /Reserved Font Name D2Coding/);
  assert.match(licence, /SIL OPEN FONT LICENSE Version 1\.1/);
  const base = fs.readFileSync(path.join(root, "src/renderer/base.css"), "utf8");
  assert.match(base, /font-family: "D2Coding"; src: url\("\.\.\/\.\.\/assets\/fonts\/D2Coding-Regular\.ttf"\)/);
  const drawer = fs.readFileSync(path.join(root, "src/renderer/drawer.css"), "utf8");
  assert.match(drawer, /:root\[data-code-font="d2coding"\] \{ --d-mono: "D2Coding",/);
  assert.equal(readCodeFont(undefined), "system");
  assert.equal(readCodeFont("d2coding"), "d2coding");
  assert.equal(readCodeFont("comic"), "system");
  const notice = fs.readFileSync(path.join(root, "..", "NOTICE"), "utf8");
  assert.match(notice, /D2Coding/, "listed in NOTICE");
});
