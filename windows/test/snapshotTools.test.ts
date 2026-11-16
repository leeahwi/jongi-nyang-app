import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// #408: the snapshot tools live in src/main/snapshots, and main.ts reaches them only under `__TEST_HOOKS__`, so a
// release build (tools/build.mjs --production, which also checks out/app.js) leaves them out.
const root = process.cwd();
const main = fs.readFileSync(path.join(root, "src/main/main.ts"), "utf8");

test("snapshot tools: main.ts holds no scene, and calls the tools only under __TEST_HOOKS__", () => {
  assert.doesNotMatch(main, /^(export )?(async )?function \w+Shots\(/m, "a scene left in main.ts");
  assert.doesNotMatch(main, /^(export )?async function (runSnapshots|sizeSweep)\(/m);
  assert.match(main, /^const snapshotDirectory = __TEST_HOOKS__ \? process\.env\.PAPERTODO_SNAPSHOT : undefined;$/m);
  const calls = main.split("\n").filter((line) => !line.startsWith("import ") && /\b(runSnapshots|sampleHistory|sampleFocus|seedSampleBackups)\(/.test(line));
  assert.equal(calls.length, 4);
  for (const line of calls) assert.match(line, /if \(__TEST_HOOKS__ && snapshotDirectory\)/, line.trim());
});

test("snapshot tools: every module in src/main/snapshots says what it is, and the release build checks it left them out", () => {
  const folder = path.join(root, "src/main/snapshots");
  const files = fs.readdirSync(folder).filter((name) => name.endsWith(".ts"));
  assert.ok(files.includes("index.ts") && files.length >= 8, files.join(", "));
  for (const name of files) assert.match(fs.readFileSync(path.join(folder, name), "utf8"), /#408/, name);
  const build = fs.readFileSync(path.join(root, "tools/build.mjs"), "utf8");
  assert.match(build, /if \(production && \(await readFile\(path\.join\(out, "app\.js"\), "utf8"\)\)\.includes\("PAPERTODO_SNAPSHOT_ONLY"\)\)/);
});
