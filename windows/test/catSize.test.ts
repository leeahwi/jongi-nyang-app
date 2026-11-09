import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { catScale, catSizes, catSizeTitles, readCatSize, scaledSize, type CatSize } from "../src/core/catSize";
import {
  clampFloorX, floorMargin, petFrame, petScaleOf, petSize, petSizeFor, petStripHeight, stripHeight, walkStepX, walkStride, walkStrideFor,
} from "../src/core/pet";
import { typingCatFrame, typingCatMargin, typingCatSize, type TypingCorner } from "../src/core/typingCat";
import { timerScale, timerSizes, timerSizeTitles } from "../src/core/timerWidget";
import { defaultPrefs } from "../src/core/types";
import { pagePrefs } from "../src/core/ipcCheck";

// 종이냥 펫과 타닥냥의 크기 (#304): the shared cases from docs/plans/cat-size-cases.json (the Mac's
// scripts/test-cat-size.sh reads the same file).
const root = process.cwd();
const file = JSON.parse(fs.readFileSync(path.resolve(root, "..", "docs", "plans", "cat-size-cases.json"), "utf8")) as {
  steps: { id: CatSize; scale: number; names: string[] }[];
  default: CatSize;
  prefs: { windows: { pet: string; typing: string } };
  read: { case: string; saved: unknown; want: CatSize }[];
  pet: {
    base: number; strideBase: number; stripBase: number; marginBase: number;
    sizes: { case: string; step: CatSize; size: number; stride: number; strip: number; margin: number }[];
    clamp: { case: string; step: CatSize; x: number; width: number; want: number }[];
    anchor: { case: string; step: CatSize; homeX: number; rect: number[] }[];
    lift: { case: string; step: CatSize; lift: number; want: number }[];
  };
  typing: {
    base: number; margin: number;
    sizes: { step: CatSize; size: number }[];
    frames: { case: string; step: CatSize; corner: TypingCorner; screen: number[]; topInset: number; frame: number[] }[];
  };
};

test("cat size: the steps, their scales and names (the timer's)", () => {
  assert.deepEqual([...catSizes], file.steps.map((step) => step.id));
  for (const step of file.steps) {
    assert.equal(catScale[step.id], step.scale, step.id);
    assert.deepEqual([catSizeTitles.ko[step.id], catSizeTitles.en[step.id], catSizeTitles.nl[step.id]], step.names, step.id);
  }
  assert.deepEqual([...timerSizes], [...catSizes]);
  for (const size of catSizes) {
    assert.equal(timerScale[size], catScale[size]);
    assert.equal(timerSizeTitles.en[size], catSizeTitles.en[size]);
  }
});

test("cat size: saved as petSize · typingSize, 보통 unless changed", () => {
  const prefs = defaultPrefs as unknown as Record<string, unknown>;
  assert.equal(prefs[file.prefs.windows.pet], file.default);
  assert.equal(prefs[file.prefs.windows.typing], file.default);
  assert.ok(pagePrefs.settings?.has("petSize") && pagePrefs.settings?.has("typingSize"), "the settings page may write both");
});

for (const entry of file.read) {
  test(`cat size: ${entry.case}`, () => assert.equal(readCatSize(entry.saved), entry.want));
}

test("cat size: the pet's numbers at 보통 are the ones before #304", () => {
  assert.equal(petSize, file.pet.base);
  assert.equal(walkStride, file.pet.strideBase);
  assert.equal(stripHeight, file.pet.stripBase);
  assert.equal(floorMargin(petSize), file.pet.marginBase);
  assert.equal(petScaleOf(petSize), 1);
});

for (const entry of file.pet.sizes) {
  test(`cat size: pet ${entry.case}`, () => {
    const px = petSizeFor(entry.step);
    assert.equal(px, entry.size);
    assert.equal(walkStrideFor(px), entry.stride);
    assert.equal(petStripHeight(px), entry.strip);
    assert.equal(floorMargin(px), entry.margin);
    // A question's bubble with its buttons (the cat + 150) still fits in the window.
    assert.ok(px + 150 <= petStripHeight(px));
  });
}

for (const entry of file.pet.clamp) {
  test(`cat size: ${entry.case}`, () => assert.equal(clampFloorX(entry.x, entry.width, floorMargin(petSizeFor(entry.step))), entry.want));
}

test("cat size: the floor's ends at 보통 are as before (70)", () => {
  assert.equal(clampFloorX(10, 1440), 70);
  assert.equal(clampFloorX(10, 1440, floorMargin(petSize)), clampFloorX(10, 1440));
});

for (const entry of file.pet.anchor) {
  test(`cat size: ${entry.case}`, () => {
    const px = petSizeFor(entry.step);
    const [x, , width, height] = entry.rect;
    assert.deepEqual([entry.homeX - px / 2, px, px], [x, width, height]);
  });
}

for (const entry of file.pet.lift) {
  test(`cat size: ${entry.case}`, () => assert.equal(entry.lift * petScaleOf(petSizeFor(entry.step)), entry.want));
}

test("cat size: a bigger cat's walk keeps its pace and takes longer strides (the paws don't slide)", () => {
  const walk = { kind: "walk" as const, from: 100, to: 400 };
  for (const size of catSizes) {
    const px = petSizeFor(size);
    // Same place along the floor at the same moment, whatever the size.
    assert.equal(petFrame(walk, 0, 100, 6000, px).x, petFrame(walk, 0, 100, 6000).x);
    // The window moves once a step: the step is an eighth of this size's stride.
    const x = walkStepX(walk, 0, 3000, px);
    assert.ok(Math.abs(((x - 100) / (walkStrideFor(px) / 8)) - Math.round((x - 100) / (walkStrideFor(px) / 8))) < 1e-9, size);
  }
  // At 보통, the frames are the ones before #304.
  assert.equal(petFrame(walk, 0, 100, 2500, petSize).walkFrame, petFrame(walk, 0, 100, 2500).walkFrame);
  assert.notEqual(petFrame(walk, 0, 100, 2500, petSizeFor("extraLarge")).walkFrame, undefined);
});

test("cat size: 타닥냥's side at each step", () => {
  assert.equal(typingCatSize, file.typing.base);
  assert.equal(typingCatMargin, file.typing.margin);
  for (const entry of file.typing.sizes) assert.equal(scaledSize(typingCatSize, entry.step), entry.size, entry.step);
});

// The Mac's frames are bottom-up; Windows' screen is top-down: the same rule, mirrored (y ↦ −(y + height)).
for (const entry of file.typing.frames) {
  test(`cat size: 타닥냥 ${entry.case}`, () => {
    const [x, y, width, height] = entry.screen;
    const area = { x, y: -(y + height), width, height };
    const [fx, fy, fw, fh] = entry.frame;
    const frame = typingCatFrame(entry.corner, area, entry.topInset, scaledSize(typingCatSize, entry.step));
    assert.deepEqual(frame, { x: fx, y: -(fy + fh), width: fw, height: fh });
    assert.ok(frame.x >= area.x && frame.y >= area.y && frame.x + frame.width <= area.x + area.width && frame.y + frame.height <= area.y + area.height);
  });
}

test("cat size: every corner of every work area holds 타닥냥 at every size, flush by the margin", () => {
  for (const area of [{ x: 0, y: 0, width: 1920, height: 1032 }, { x: -1280, y: 200, width: 1280, height: 984 }, { x: 0, y: 0, width: 1366, height: 728 }, { x: 0, y: 0, width: 150, height: 120 }]) {
    for (const size of catSizes) {
      for (const corner of ["topLeft", "topRight", "bottomLeft", "bottomRight"] as TypingCorner[]) {
        const frame = typingCatFrame(corner, area, 0, scaledSize(typingCatSize, size));
        assert.ok(frame.x >= area.x && frame.y >= area.y && frame.x + frame.width <= area.x + area.width && frame.y + frame.height <= area.y + area.height, `${size} ${corner}`);
        const left = corner.endsWith("Left"), top = corner.startsWith("top");
        assert.equal(left ? frame.x - area.x : area.x + area.width - frame.x - frame.width, typingCatMargin, `${size} ${corner} x`);
        assert.equal(top ? frame.y - area.y : area.y + area.height - frame.y - frame.height, typingCatMargin, `${size} ${corner} y`);
      }
    }
  }
});
