import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// #399: test/setup-tz.mjs gives each test file its zone before it runs.
const zones: Record<string, string[]> = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "test", "time-zones.json"), "utf8"));

test("every file pinned to a zone exists, and is pinned once", () => {
  const names = Object.values(zones).flat();
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.ok(fs.existsSync(path.resolve(process.cwd(), "test", `${name}.test.ts`)), name);
});

test("a file left out runs in a set zone (the caller's TZ or UTC), not the machine's by accident", () => {
  assert.ok(process.env.TZ, "setup-tz.mjs ran");
  const zone = new Intl.DateTimeFormat("en", { timeZone: process.env.TZ }).resolvedOptions().timeZone;
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, zone, "the clock reads in that zone");
});
