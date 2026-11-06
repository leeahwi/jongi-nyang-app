import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// #166's done criteria, read from both apps' source: the five motion words and the holds are the same numbers in the
// Mac's `Motion` (PaperTheme.swift), base.css's `--motion-*` and api.ts's `motion`; the drawer and the settings draw no
// motion that repeats; and the Mac's drawer and settings take their motion from `Motion`, which is nil under Reduce
// Motion and in snapshots (docs/plans/motion-audit.md §2, §7).
const windows = process.cwd();
const repo = path.resolve(windows, "..");
const read = (...parts: string[]) => fs.readFileSync(path.join(...parts), "utf8");
const macSources = path.join(repo, "mac", "Sources", "PaperTodo");
const words = ["quick", "change", "enter", "draw", "bounce"] as const;

function macMotion(): Record<string, number> {
  const source = read(macSources, "PaperTheme.swift");
  const body = source.slice(source.indexOf("enum Motion {"), source.indexOf("extension View {", source.indexOf("enum Motion {")));
  const values: Record<string, number> = {};
  for (const match of body.matchAll(/case \.(\w+): ([\d.]+)/g)) values[match[1]] = Number(match[2]);
  for (const match of body.matchAll(/static let (\w+) = ([\d.]+)\n/g)) values[match[1]] = Number(match[2]);
  return values;
}

test("the five motion words and the holds are the same in both apps", () => {
  const mac = macMotion();
  const css = read(windows, "src", "renderer", "base.css");
  const api = read(windows, "src", "renderer", "api.ts");
  const js = Object.fromEntries([...(api.match(/export const motion = \{([^}]*)\}/)?.[1] ?? "").matchAll(/(\w+): (\d+)/g)].map((match) => [match[1], Number(match[2])]));
  for (const word of words) {
    const seconds = Number(css.match(new RegExp(`--motion-${word}: ([\\d.]+)s;`))?.[1]);
    assert.equal(mac[word], seconds, `${word}: Mac ${mac[word]} s, base.css ${seconds} s`);
    assert.equal(js[word], Math.round(seconds * 1000), `${word}: api.ts ${js[word]} ms`);
  }
  for (const hold of ["hold", "dayStripHold", "reducedHold", "strikeDelay"]) {
    assert.equal(js[hold], Math.round(mac[hold] * 1000), `${hold}: Mac ${mac[hold]} s, api.ts ${js[hold]} ms`);
  }
  const rise = Number(read(macSources, "PaperTheme.swift").match(/static let rise: CGFloat = (\d+)/)?.[1]);
  assert.equal(Number(css.match(/--motion-rise: (\d+)px;/)?.[1]), rise, "등장 rises as far in both apps");
  // ease-out is SwiftUI's .easeOut; ease-in its .easeIn.
  assert.match(css, /--ease-out: cubic-bezier\(0, 0, 0\.58, 1\);/);
  assert.match(css, /--ease-in: cubic-bezier\(0\.42, 0, 1, 1\);/);
});

test("the drawer and the settings draw nothing that repeats", () => {
  for (const file of ["drawer.css", "settings.css", "menu.css", "base.css"]) {
    const css = read(windows, "src", "renderer", file).replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(css, /\binfinite\b/, `${file} has an animation that never ends`);
  }
  for (const file of ["drawer.ts", "drawerMenu.ts", "settings.ts"]) {
    assert.doesNotMatch(read(windows, "src", "renderer", file), /iterations:\s*Infinity/, `${file} animates without end`);
  }
  for (const file of fs.readdirSync(macSources).filter((name) => /^(MemoDrawer.*|ReminderController|FontSettings)\.swift$/.test(name))) {
    assert.doesNotMatch(read(macSources, file), /repeatForever/, `${file} animates without end`);
  }
});

test("the settings' number fields change at once, in both apps (D8)", () => {
  const css = read(windows, "src", "renderer", "settings.css").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of css.matchAll(/^\.stepper[^{]*\{([^}]*)\}/gm)) assert.doesNotMatch(rule[1], /transition|animation/, `settings.css: ${rule[0]}`);
  const mac = read(macSources, "ReminderController.swift");
  const stepper = mac.slice(mac.indexOf("private struct PaperStepper"), mac.indexOf("private struct LoginItemGroup"));
  assert.ok(stepper.length > 0, "PaperStepper is in ReminderController.swift");
  assert.doesNotMatch(stepper, /withAnimation|\.animation\(/, "the Mac's −/+ change the number without motion");
});

test("the Mac's drawer and settings take their motion from Motion (so Reduce Motion makes it instant)", () => {
  // A raw curve here would run under Reduce Motion and in snapshots; Motion.animation / Motion.exit are nil there.
  const raw = /\.(easeOut|easeIn|easeInOut|linear)\(duration:|\.(snappy|bouncy|smooth|spring)\(|withAnimation \{|withAnimation\(\)/;
  for (const file of fs.readdirSync(macSources).filter((name) => /^(MemoDrawer.*|ReminderController|FontSettings)\.swift$/.test(name))) {
    read(macSources, file).split("\n").forEach((line, index) => {
      if (/^\s*\/\//.test(line)) return;
      assert.doesNotMatch(line, raw, `${file}:${index + 1}: ${line.trim()}`);
    });
  }
});
