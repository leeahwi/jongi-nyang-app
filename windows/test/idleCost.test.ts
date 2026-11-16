import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { deepLookEvery } from "../src/core/storage";

// #67 (idle CPU on Windows): the cheap fixes — no GPU layer for a cat at rest, every unthrottled window says why, and
// the whole shared files are read less often once the folder's watch is known to work.
const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, "src", file), "utf8");

test("idle cost: the cats' breath has will-change only while a breath plays (sampled.ts's .sampling)", () => {
  for (const [file, selector] of [["renderer/pet.css", ".art"], ["renderer/timer.css", ".cat"]] as const) {
    const css = source(file);
    for (const kind of ["awake", "asleep"]) {
      const rest = new RegExp(`^\\${selector}\\.${kind} \\{([^}]*)\\}`, "m").exec(css)?.[1] ?? "";
      assert.ok(rest.includes("animation:"), `${file} ${kind}`);
      assert.ok(!rest.includes("will-change"), `${file}: ${selector}.${kind} keeps a layer at rest`);
      assert.match(css, new RegExp(`^\\${selector}\\.${kind}\\.sampling \\{ will-change: `, "m"), `${file} ${kind} while sampling`);
    }
  }
  const sampled = source("renderer/sampled.ts");
  assert.equal([...sampled.matchAll(/classList\.add\("sampling"\)/g)].length, 1, "on when a breath starts");
  assert.equal([...sampled.matchAll(/classList\.remove\("sampling"\)/g)].length, 2, "off when it ends or stops");
});

test("idle cost: every window that isn't throttled in the background says why (#67, checked)", () => {
  const folder = path.join(root, "src/main");
  const unexplained: string[] = [];
  for (const name of fs.readdirSync(folder, { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith(".ts"))) {
    const lines = fs.readFileSync(path.join(folder, name), "utf8").split("\n");
    lines.forEach((line, index) => {
      if (!line.includes("backgroundThrottling: false")) return;
      const before = lines.slice(Math.max(0, index - 3), index).join(" ");
      // The ears' preview is a snapshot tool's hidden window; the others are the app's own.
      if (!/#67 \(checked|earsPreview|paintWhenInitiallyHidden: true/.test(before + line)) unexplained.push(`${name}:${index + 1}`);
    });
  }
  assert.deepEqual(unexplained, []);
});

test("idle cost: the whole shared files every 2.5 minutes, every 10 once the folder's watch has reported a change", () => {
  assert.equal(deepLookEvery(false), 5);
  assert.equal(deepLookEvery(true), 20);
  const store = source("main/store.ts");
  assert.match(store, /else if \(\(sharedFiles as readonly string\[\]\)\.includes\(name\)\) \{ this\.watchHeard = true; this\.syncSoon\(name as SharedFile\); \}/);
  assert.match(store, /this\.watcher\.on\("error", \(\) => \{ this\.watcher\?\.close\(\); this\.watcher = undefined; this\.watchHeard = false; \}\);/);
  assert.match(store, /const deep = \+\+looks >= deepLookEvery\(this\.watchHeard && this\.watcher !== undefined\);/);
});
