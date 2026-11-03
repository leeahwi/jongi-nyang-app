import assert from "node:assert/strict";
import fs from "node:fs";
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
