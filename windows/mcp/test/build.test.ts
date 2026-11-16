import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

/**
 * #174 (review L-07): the server that ships has no test switches. Checked on the built files only — the shipped
 * server is never run here: without PAPERTODO_AI_HOME it would look in this computer's real settings folder.
 */
const dist = path.join(process.cwd(), "mcp", "dist");

test("the shipped server reads no PAPERTODO_AI_* switch; the test build does", () => {
  const shipped = fs.readFileSync(path.join(dist, "server", "index.js"), "utf8");
  const testBuild = fs.readFileSync(path.join(dist, "server-test", "index.js"), "utf8");
  for (const name of ["PAPERTODO_AI_HOME", "PAPERTODO_AI_CLOCK", "PAPERTODO_AI_RACE", "PAPERTODO_AI_BREAK"]) {
    assert.ok(!shipped.includes(name), `shipped server mentions ${name}`);
    assert.ok(testBuild.includes(name), `test build lacks ${name}`);
  }
  assert.ok(!shipped.includes("never ship"));
  assert.match(testBuild.split("\n", 1)[0], /test build: never ship/);
});

/**
 * #493: one commit packs the same jongi-nyang.mcpb on every build. mcpb stamps each entry with the time it runs, so
 * build.mjs rewrites the stamps to the commit's time (mcp/zipTime.mjs). Here a copy stamped with another time (a build
 * a minute later) differs, and stamping it with the commit's time gives back the shipped bytes.
 */
test("the .mcpb carries the commit's time, not the time it was packed", () => {
  const zipTime = path.join(process.cwd(), "mcp", "zipTime.mjs");
  const shipped = fs.readFileSync(path.join(dist, "jongi-nyang.mcpb"));
  const epoch = execFileSync(process.execPath, [zipTime, "--epoch"], { encoding: "utf8" }).trim();
  assert.match(epoch, /^\d+$/);
  const copy = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "mcpb-time-")), "later.mcpb");
  try {
    fs.writeFileSync(copy, shipped);
    execFileSync(process.execPath, [zipTime, copy, String(Number(epoch) + 61)]);
    assert.notDeepEqual(fs.readFileSync(copy), shipped, "a different stamp changed no byte");
    execFileSync(process.execPath, [zipTime, copy, epoch]);
    assert.deepEqual(fs.readFileSync(copy), shipped);
  } finally {
    fs.rmSync(path.dirname(copy), { recursive: true, force: true });
  }
});
