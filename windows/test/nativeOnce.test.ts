import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// #408: Koffi is loaded in one place, and Windows' region settings are read once at launch.
const root = process.cwd();
const source = (file: string) => fs.readFileSync(path.join(root, "src", file), "utf8");

test("Koffi comes through main/native/user32.ts only, which loads it once and never off Windows or off-screen", () => {
  const loader = source("main/native/user32.ts");
  assert.match(loader, /process\.platform !== "win32" \|\| offscreenEnabled\) return undefined;/);
  assert.match(loader, /if \(failed !== undefined\) throw failed;\n  if \(loaded\) return loaded;/, "once, and a failure isn't tried again");
  assert.equal([...loader.matchAll(/koffi\.load\(/g)].length, 2, "user32 and kernel32, opened once each");
  for (const file of ["main/stayBehind.ts", "main/keyHook.ts", "main/captionClicks.ts"]) {
    const text = source(file);
    assert.match(text, /windowsNative\(\)/, `${file} asks the shared loader`);
    for (const word of ["createRequire", "koffiPath", "koffi.load(", "interface Koffi"]) assert.ok(!text.includes(word), `${file} has its own ${word}`);
  }
  const others = fs.readdirSync(path.join(root, "src/main"), { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".ts") && name !== path.join("native", "user32.ts"))
    .filter((name) => source(path.join("main", name)).includes("koffi.node"));
  assert.deepEqual(others, [], "no other file finds the binary");
});

test("the region settings (clock, first day of the week) come from one reg.exe run", () => {
  const main = source("main/main.ts");
  assert.equal([...main.matchAll(/execFileSync\("reg"/g)].length, 1);
  assert.match(main, /if \(!regionRead\) \{/);
  for (const name of ["systemHourCycle", "systemWeekStart"]) {
    const start = main.indexOf(`function ${name}(`);
    const body = main.slice(start, main.indexOf("\n}\n", start));
    assert.match(body, /const output = regionSettings\(\);/, `${name} reads the shared answer`);
  }
});
