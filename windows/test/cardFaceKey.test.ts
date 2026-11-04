import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { cardFaceKey, type CardFaceSettings } from "../src/core/textSteps";
import type { DrawerFont } from "../src/core/types";

// #4 · #198: the drawer keeps its closed cards from one redraw to the next; since #198 their previews are drawn in the
// words' face, size and lines, so a change of any of those must make every card again.
const base: CardFaceSettings = { drawerFont: "clean", drawerTextPt: 14, drawerLineHeight: "regular", drawerParagraph: "regular", drawerCodeFont: "system" };

test("#4 · #198: a change of the face, its size, its lines or the code face changes the cards' key", () => {
  const key = cardFaceKey(base, false);
  const changes: Partial<CardFaceSettings>[] = [
    ...(["pen", "brush", "mono"] as DrawerFont[]).map((drawerFont) => ({ drawerFont })),
    { drawerTextPt: 12 }, { drawerTextPt: 16 }, { drawerTextPt: 20 },
    { drawerLineHeight: "tight" }, { drawerLineHeight: "loose" },
    { drawerParagraph: "wide" }, { drawerParagraph: "wider" },
    { drawerCodeFont: "d2coding" },
  ];
  for (const change of changes) assert.notEqual(cardFaceKey({ ...base, ...change }, false), key, JSON.stringify(change));
  assert.equal(cardFaceKey({ ...base }, false), key, "the same settings, the same key");
});

test("#198: the Latin pen's taller preview lines change the key; the plain face reads the same in every language", () => {
  const pen = { ...base, drawerFont: "pen" as DrawerFont };
  assert.notEqual(cardFaceKey(pen, true), cardFaceKey(pen, false));
  assert.equal(cardFaceKey(base, true), cardFaceKey(base, false));
});

test("#4: the drawer's card cache is keyed by the cards' face as well as the view", () => {
  const drawer = fs.readFileSync(path.join(process.cwd(), "src/renderer/drawer.ts"), "utf8");
  const look = drawer.split("\n").find((line) => line.includes("const look = "));
  assert.ok(look?.includes("cardFaceKey(state.prefs"), `the cache's key reads the face settings: ${look?.trim()}`);
  assert.match(drawer, /if \(look !== slipLook\) \{ slipLook = look; slips\.clear\(\); headers\.clear\(\); \}/);
});
