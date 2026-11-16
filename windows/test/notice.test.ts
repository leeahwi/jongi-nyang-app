import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// #406: ../NOTICE ships inside both apps (mac/scripts/build.sh → Contents/Resources/NOTICE, electron-builder →
// resources/NOTICE.txt) and is the same file as the public repository's NOTICE. It names what the builds carry,
// as `node tools/bundled-packages.mjs` lists it, and nothing from the dev repository.

const notice = fs.readFileSync(path.resolve(process.cwd(), "..", "NOTICE"), "utf8");
const flat = notice.replace(/\s+/g, " ");
const names = (text: string, name: string, version: string) => new RegExp(`(?:^|[\\s(])${name.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")} ${version.replace(/\./g, "\\.")}(?![\\d.])`).test(text);

test("no dev issue number, date stamp or local path in NOTICE", () => {
  assert.deepEqual(notice.match(/#\d+/g) ?? [], []);
  assert.doesNotMatch(notice, /brought up to date|\/Users\/|[A-Z]:\\Users\\/);
});

test("NOTICE states the licence in LICENSE", () => {
  const license = fs.readFileSync(path.resolve(process.cwd(), "..", "LICENSE"), "utf8");
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(flat, /licensed under the Apache License, Version 2\.0 \(see LICENSE\)/);
});

test("every package the builds carry is in NOTICE at its version", () => {
  const listed = execFileSync(process.execPath, ["tools/bundled-packages.mjs"], { cwd: process.cwd(), encoding: "utf8" });
  const packages = [...listed.matchAll(/^ {2}(\S+)@(\d[^\s]*) {2}/gm)].map(([, name, version]) => ({ name: name!, version: version! }));
  assert.ok(packages.length >= 10, `${packages.length} packages listed`);
  const missing = packages.filter(({ name, version }) => !names(flat, name === "electron" ? "Electron" : name, version)).map(({ name, version }) => `${name} ${version}`);
  assert.deepEqual(missing, []);
});

test("the Koffi binary in NOTICE is the one package.json ships", () => {
  const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf8"));
  const koffi = pkg.optionalDependencies["@koromix/koffi-win32-x64"] as string;
  assert.ok(names(flat, "Koffi", koffi), `Koffi ${koffi}`);
  assert.ok(pkg.build.extraResources.some((entry: { from: string; to: string }) => entry.from === "../NOTICE" && entry.to === "NOTICE.txt"));
});
