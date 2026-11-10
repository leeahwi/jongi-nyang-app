import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { catSizes } from "../src/core/catSize";
import {
  clampFloorX, clipMs, floorMargin, petSizeFor, petStripHeight, petWindowBounds, placePetWindow, walkStepX, type PetAction, type Rect,
} from "../src/core/pet";

// #313: on Windows the cat sank below the taskbar until only its ears showed. A model of how a window's bounds go
// through Windows at a display scale (Chromium's ScreenWin, as Electron uses it), so the fault and the fix run here.
//
// - setBounds(DIP): the place is scaled and rounded, the size scaled and rounded up (physical pixels are whole).
// - getBounds(): the physical rect scaled back and taken whole outward (the enclosing rect) — up to a pixel more.
// - setPosition(x, y): Electron's own definition, setBounds(the new place, getBounds()'s size).
class WindowsWindow {
  private physical = { x: 0, y: 0, width: 0, height: 0 };
  setBounds = 0;
  constructor(private readonly scale: number, bounds: Rect) { this.set(bounds); }

  set(bounds: Rect): void {
    this.setBounds += 1;
    const s = this.scale;
    this.physical = { x: Math.round(bounds.x * s), y: Math.round(bounds.y * s), width: Math.ceil(bounds.width * s - 1e-9), height: Math.ceil(bounds.height * s - 1e-9) };
  }

  getBounds(): Rect {
    const s = this.scale, p = this.physical;
    const x = Math.floor(p.x / s + 1e-9), y = Math.floor(p.y / s + 1e-9);
    return { x, y, width: Math.ceil((p.x + p.width) / s - 1e-9) - x, height: Math.ceil((p.y + p.height) / s - 1e-9) - y };
  }

  /** Where it really is, in DIP (not rounded): what shows on the screen. */
  real(): Rect {
    const s = this.scale, p = this.physical;
    return { x: p.x / s, y: p.y / s, width: p.width / s, height: p.height / s };
  }

  setPosition(x: number, y: number): void {
    const { width, height } = this.getBounds();
    this.set({ x, y, width, height });
  }

  /** What the app's own code is given (placePetWindow only sets whole bounds). */
  get placed(): { setBounds(bounds: Rect): void } { return { setBounds: (bounds) => this.set(bounds) }; }
}

/** Displays as Electron gives them (DIP): 100 · 125 · 150 %, the taskbar on each edge (48 physical px thick). */
const scales = [1, 1.25, 1.5] as const;
const edges = ["bottom", "top", "left", "right"] as const;
function workArea(scale: number, edge: (typeof edges)[number]): Rect {
  const width = Math.round(1920 / scale), height = Math.round(1080 / scale), bar = Math.round(48 / scale);
  switch (edge) {
    case "bottom": return { x: 0, y: 0, width, height: height - bar };
    case "top": return { x: 0, y: bar, width, height: height - bar };
    case "left": return { x: bar, y: 0, width: width - bar, height };
    case "right": return { x: 0, y: 0, width: width - bar, height };
  }
}

/** main/pet.ts's floor: the strip along the bottom of the work area. */
function floorOf(area: Rect, px: number): Rect {
  const height = petStripHeight(px);
  return { x: area.x, y: area.y + area.height - height, width: area.width, height };
}

/** A wander to the other side (as main/pet.ts walks it: the window looked at 30 times a second). */
function walkTicks(floor: Rect, px: number): number[] {
  const from = clampFloorX(floor.width * 0.78, floor.width, floorMargin(px));
  const walk: Extract<PetAction, { kind: "walk" }> = { kind: "walk", from, to: clampFloorX(from - 170, floor.width, floorMargin(px)) };
  const xs: number[] = [];
  for (let at = 0; at <= clipMs(walk) + 33; at += 33) xs.push(walkStepX(walk, 0, at, px));
  return xs;
}

/** How far the cat's feet are below the work area's bottom (0: on the floor) — with the page as it was (cat at the window's bottom). */
const sankOld = (window: WindowsWindow, area: Rect) => { const b = window.real(); return b.y + b.height - (area.y + area.height); };
/** …and as it is now (#313: the floor is the strip's height below the window's top). */
const sankNow = (window: WindowsWindow, area: Rect, px: number) => window.real().y + petStripHeight(px) - (area.y + area.height);

test("pet floor (#313): moving the window with setPosition, as 1.33–1.34 did, sinks the cat at 125 % · 150 % (the report)", () => {
  let worst = { sank: 0, at: "" };
  for (const scale of scales) {
    for (const size of catSizes) {
      const px = petSizeFor(size), area = workArea(scale, "bottom"), floor = floorOf(area, px);
      const window = new WindowsWindow(scale, petWindowBounds(floor, walkTicks(floor, px)[0]));
      let placedAt: { x: number; y: number } | undefined;
      // Three wanders.
      for (let walk = 0; walk < 3; walk += 1) {
        for (const x of walkTicks(floor, px)) {
          const at = petWindowBounds(floor, x);
          if (placedAt?.x === at.x && placedAt.y === at.y) continue;
          window.setPosition(at.x, at.y);
          placedAt = at;
        }
      }
      const sank = sankOld(window, area);
      if (scale === 1) assert.equal(sank, 0, "at 100 % nothing rounds");
      if (sank > worst.sank) worst = { sank, at: `${scale * 100}% ${size}` };
    }
  }
  // The window grew at its bottom by about a DIP a step whenever its top fell between two physical pixels (here 크게 and
  // 아주 크게, whose strips are 273 and 296 high); the cat drawn there went down with it, 160–250 DIP in three wanders.
  assert.ok(worst.sank >= 40, `the old way sank ${worst.sank} DIP at worst (${worst.at})`);
});

test("pet floor (#313): the cat's feet stay on the work area's bottom at every size, scale and taskbar edge — shown, walking, resized, display changed", () => {
  for (const scale of scales) {
    for (const edge of edges) {
      for (const size of catSizes) {
        const label = `${scale * 100}% taskbar ${edge} ${size}`;
        let px = petSizeFor(size), area = workArea(scale, edge), floor = floorOf(area, px);
        let x = clampFloorX(floor.width * 0.78, floor.width, floorMargin(px));
        // Made with its bounds (#307), then placed anew when shown.
        const window = new WindowsWindow(scale, petWindowBounds(floor, x));
        let placed = placePetWindow(window.placed, petWindowBounds(floor, x));
        const check = (when: string) => {
          // Less than a physical pixel off (the rounding to whole pixels); never more, never adding up.
          const real = window.real();
          assert.ok(Math.abs(sankNow(window, area, px)) < 1, `${label} ${when}: ${sankNow(window, area, px)} DIP off the floor`);
          assert.ok(Math.abs(real.height - floor.height) < 1, `${label} ${when}: window ${real.height} high, strip ${floor.height}`);
          assert.ok(Math.abs(real.y - floor.y) < 1, `${label} ${when}: window top ${real.y}, floor ${floor.y}`);
        };
        check("shown");
        for (let walk = 0; walk < 5; walk += 1) {
          for (const step of walkTicks(floor, px)) placed = placePetWindow(window.placed, petWindowBounds(floor, step), placed);
          check(`after walk ${walk + 1}`);
        }
        // 크기 changed (#304): placed anew at the new strip's height.
        px = petSizeFor(size === "extraLarge" ? "small" : "extraLarge");
        floor = floorOf(area, px);
        x = clampFloorX(x, floor.width, floorMargin(px));
        placed = placePetWindow(window.placed, petWindowBounds(floor, x));
        check("resized");
        // The taskbar hid or moved (display-metrics-changed): laid out anew on the new work area.
        area = { ...area, height: area.height - 20 };
        floor = floorOf(area, px);
        placed = placePetWindow(window.placed, petWindowBounds(floor, x));
        check("work area changed");
      }
    }
  }
});

test("pet floor (#313): a step that doesn't move the window sends nothing; one that does sends the whole bounds", () => {
  const sent: Rect[] = [];
  const window = { setBounds: (bounds: Rect) => { sent.push(bounds); } };
  const floor = { x: 0, y: 576, width: 1536, height: 250 };
  let placed = placePetWindow(window, petWindowBounds(floor, 800));
  placed = placePetWindow(window, petWindowBounds(floor, 800), placed);
  assert.equal(sent.length, 1);
  placed = placePetWindow(window, petWindowBounds(floor, 802), placed);
  assert.deepEqual(sent[1], { x: 622, y: 576, width: 360, height: 250 });
  // Another strip at the same place (another 크기) is a change too.
  placePetWindow(window, petWindowBounds({ ...floor, height: 296 }, 802), placed);
  assert.equal(sent.length, 3);
});

test("pet floor (#313): the pet's window never moves with setPosition, and the page stands the cat on the strip, not the window's bottom", () => {
  const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
  const main = source("src/main/pet.ts");
  assert.doesNotMatch(main, /\.setPosition\(/);
  assert.match(main, /placePetWindow\(this\.window, petWindowBounds\(/);
  // No resize frame of Windows' own on the cats' windows (#312 found it on the note's ears).
  for (const file of ["src/main/pet.ts", "src/main/typingCat.ts"]) assert.match(source(file), /new BrowserWindow\(\{[^}]*thickFrame: false/, file);
  const page = source("src/renderer/pet.ts");
  assert.match(page, /stage\.style\.height = `\$\{petStripHeight\(size\)\}px`/);
});

test("drag drift (#316): windows dragged by the person keep their size — the post-it, the timer and both kinds of slips move with whole bounds", () => {
  const source = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");
  for (const file of ["src/main/floating.ts", "src/main/timer.ts", "src/main/confirm.ts"]) {
    assert.doesNotMatch(source(file), /\.setPosition\(/, file);
  }
  // A kept slip's one setPosition puts it at its usual place once when shown; its drag moves with whole bounds.
  assert.deepEqual(source("src/main/slipWindow.ts").match(/\.setPosition\([^)]*\)/g), [".setPosition(to.x, to.y)"]);
  // The model above: moving a window with setBounds and its own size never grows it, at any scale.
  for (const scale of scales) {
    const window = new WindowsWindow(scale, { x: 100.4, y: 200.6, width: 110, height: 130 });
    for (let step = 0; step < 200; step++) window.placed.setBounds({ x: 100 + step * 1.7, y: 200 + step * 0.9, width: 110, height: 130 });
    const { width, height } = window.getBounds();
    assert.ok(width <= 111 && height <= 131, `${scale}: ${width}×${height}`);
  }
});
