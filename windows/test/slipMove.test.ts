import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { pageNames, type PageName } from "../src/core/ipcCheck";
import {
  SlipShelf, askLevels, draggedSlip, placedSlip, readSlipPlace, slipPlace, heldPages, nudgeBlink, nudgeMotion, nudgeShake, pressWhileUp, slipHead, slipKeep,
  widgetPressWhileUp, type AskedUp, type WidgetOutcome, type WidgetPress,
} from "../src/core/slipMove";

// 질문 쪽지 옮기기 · 막힌 클릭 (#228 · #229): the shared cases from docs/plans/slip-move-cases.json (the Mac's
// test-slip-move.sh and test-presentation.sh read the same file).
type Box = [number, number, number, number];
const file = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "slip-move-cases.json"), "utf8")) as {
  head: number; keep: number;
  drag: { case: string; slip: Box; area: Box | null; by: [number, number]; to: [number, number] }[];
  clicks: { case: string; up: "question" | "settings"; click: string; then: "nudge" | "works" }[];
  open: { case: string; keys: string[]; slips: number }[];
  nudge: { shake: number[]; motion: string; blink: number[]; blinkStep: string; beeps: number };
  place: {
    keep: { case: string; slip: Box; area: Box; saved: { dx: number; dy: number; areaWidth: number; areaHeight: number } }[];
    open: { case: string; saved: { dx: number; dy: number; areaWidth: number; areaHeight: number } | null; size: [number, number]; area: Box; to: [number, number] | null }[];
  };
};
const rect = ([x, y, width, height]: Box) => ({ x, y, width, height });
/** The cases' windows as this app's pages (the times slip is drawn in the desk's 스페이스 pane). */
const pageOfClick: Record<string, PageName> = {
  note: "note", drawer: "drawer", desk: "desk", today: "glance", reminder: "popup", pet: "pet", times: "settings", alarm: "ring", question: "confirm",
};

test("slip move: the head and the part kept sideways", () => {
  assert.equal(slipHead, file.head);
  assert.equal(slipKeep, file.keep);
});

for (const entry of file.drag) {
  test(`slip move: ${entry.case}`, () => {
    const to = draggedSlip(rect(entry.slip), entry.by[0], entry.by[1], entry.area ? rect(entry.area) : undefined);
    assert.deepEqual([to.x, to.y], entry.to);
  });
}

for (const entry of file.clicks) {
  test(`held clicks: ${entry.case}`, () => {
    const page = pageOfClick[entry.click];
    assert.ok(page, entry.click);
    assert.equal(pressWhileUp(page, entry.up), entry.then);
  });
}

for (const entry of file.open) {
  test(`times slips: ${entry.case}`, () => {
    const shelf = new SlipShelf<{ key: string }>();
    const made: string[] = [];
    const seen = new Set<string>();
    for (const key of entry.keys) {
      const { slip, isNew } = shelf.take(key, () => { made.push(key); return { key }; });
      assert.equal(slip.key, key);
      assert.equal(isNew, !seen.has(key), `${key}: a new slip only the first time`);
      seen.add(key);
    }
    assert.equal(shelf.size, entry.slips);
    assert.equal(made.length, entry.slips);
    for (const key of new Set(entry.keys)) shelf.drop(key);
    assert.equal(shelf.size, 0);
  });
}

test("the nudge: a shake over 톡, or the tape's blink, 살짝 a step; one beep", () => {
  assert.deepEqual([...nudgeShake], file.nudge.shake);
  assert.deepEqual([...nudgeBlink], file.nudge.blink);
  assert.deepEqual([nudgeMotion.shake, nudgeMotion.blinkStep], [file.nudge.motion, file.nudge.blinkStep]);
  assert.equal(file.nudge.beeps, 1);
  const confirm = fs.readFileSync(path.join(process.cwd(), "src/main/confirm.ts"), "utf8");
  assert.equal(confirm.match(/shell\.beep\(\)/g)?.length, 1, "one beep a nudge");
});

/** A renderer page's own modules (relative imports), from its entry file. */
function modulesOf(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file);
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"(\.[^"]+)"/gm)) visit(path.resolve(path.dirname(file), `${match[1]}.ts`));
    for (const match of source.matchAll(/^import\s+"(\.[^"]+)"/gm)) visit(path.resolve(path.dirname(file), `${match[1]}.ts`));
  };
  visit(path.join(process.cwd(), "src/renderer", `${entry}.ts`));
  return [...seen];
}

test("held clicks: the pages a question holds up are the ones that bring in the guard", () => {
  for (const page of pageNames) {
    const guarded = modulesOf(page).some((file) => file.endsWith(path.join("renderer", "askGuard.ts")));
    assert.equal(guarded, heldPages.has(page), `${page}: ${guarded ? "has" : "lacks"} the guard`);
  }
  assert.equal(heldPages.has("confirm"), false);
  assert.equal(heldPages.has("ring"), false);
});

// #246: 빠른 입력 · 빠른 메모 keep where they were dragged, per display (the same cases as the Mac's SlipMoveTests).
test("slip place: kept per display, opened there again unless the display changed (shared cases)", () => {
  for (const entry of file.place.keep) assert.deepEqual(slipPlace(rect(entry.slip), rect(entry.area)), entry.saved, entry.case);
  for (const entry of file.place.open) {
    const to = placedSlip(entry.saved ?? undefined, { width: entry.size[0], height: entry.size[1] }, rect(entry.area));
    assert.deepEqual(to ? [to.x, to.y] : null, entry.to, entry.case);
  }
  assert.deepEqual(readSlipPlace({ dx: 1, dy: 2, areaWidth: 3, areaHeight: 4 }), { dx: 1, dy: 2, areaWidth: 3, areaHeight: 4 });
  assert.equal(readSlipPlace({ dx: "1", dy: 2, areaWidth: 3, areaHeight: 4 }), undefined);
  assert.equal(readSlipPlace(null), undefined);
});

// #253: what works on the desktop calendar widgets and their day sheet while a question waits — the shared cases from
// docs/plans/widget-ask-cases.json (the Mac's test-slip-move.sh and test-presentation.sh read the same file).
const asked = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "widget-ask-cases.json"), "utf8")) as {
  questions: { case: string; question: string; message: string | { mac: string; windows: string }; replacesList: boolean; apps?: string[] }[];
  presses: { case: string; up: AskedUp; press: WidgetPress; over?: boolean; then: WidgetOutcome }[];
  levels: { case: string; top: string[] };
  typing: { case: string; typing: string; then: string }[];
};

for (const entry of asked.presses) {
  test(`widget while asked: ${entry.case}`, () => {
    assert.equal(widgetPressWhileUp(entry.press, entry.up, entry.over ?? false), entry.then);
  });
}

test("widget while asked: the widgets and their day sheet aren't held, and listen for what is up", () => {
  assert.equal(heldPages.has("widget"), false);
  assert.equal(heldPages.has("widgetSheet"), false);
  for (const page of ["widget", "widgetSheet"]) {
    assert.ok(modulesOf(page).some((file) => file.endsWith(path.join("renderer", "widgetAsk.ts"))), `${page} listens for the question`);
  }
});

// Each question's message in main.ts, and whether its line carries `replacesList: true`.
test("widget while asked: the questions that replace the whole list say so where they are made (shared cases)", () => {
  const lines = fs.readFileSync(path.join(process.cwd(), "src/main/main.ts"), "utf8").split("\n");
  const flagged = (line: string) => /replacesList: true/.test(line);
  let tagged = 0;
  for (const entry of asked.questions) {
    if (entry.apps && !entry.apps.includes("windows")) continue;
    const message = typeof entry.message === "string" ? entry.message : entry.message.windows;
    const found = lines.filter((line) => line.includes(`${message}"`) && /message: /.test(line));
    assert.ok(found.length > 0, `${entry.case}: the question “${message}” is in main.ts`);
    for (const line of found) assert.equal(flagged(line), entry.replacesList, `${entry.case}: ${line.trim().slice(0, 80)}`);
    if (entry.replacesList) tagged += found.length;
  }
  // No other question is tagged.
  assert.equal(lines.filter(flagged).length, tagged, "every replacesList: true is a question of the shared list");
});

test("widget while asked: the question floats over the day sheet and a widget kept on top (shared levels)", () => {
  // Electron's levels, lowest first (macOS reads them; on Windows the question is raised last).
  const order = ["normal", "floating", "torn-off-menu", "modal-panel", "main-menu", "status", "pop-up-menu", "screen-saver"];
  const rank = (name: string) => {
    if (name === "window") return 0;
    const level = askLevels[name as keyof typeof askLevels];
    assert.ok(level, name);
    return order.indexOf(level.level) * 10 + level.relative;
  };
  const top = asked.levels.top.map(rank);
  for (let index = 1; index < top.length; index += 1) assert.ok(top[index - 1] > top[index], `${asked.levels.top[index - 1]} over ${asked.levels.top[index]}`);
  const sheet = fs.readFileSync(path.join(process.cwd(), "src/main/widgetSheet.ts"), "utf8");
  const widgets = fs.readFileSync(path.join(process.cwd(), "src/main/calendarWidget.ts"), "utf8");
  assert.match(sheet, /setAlwaysOnTop\(true, askLevels\.sheet\.level, askLevels\.sheet\.relative\)/);
  assert.match(widgets, /setAlwaysOnTop\(top, askLevels\.widgetOnTop\.level, askLevels\.widgetOnTop\.relative\)/);
});

// T1–T3: a widget never takes the keyboard, so typing in the memo drawer, the quick entry or the quick memo keeps its text
// and caret when the widget is pressed (the snapshot run's widgets check presses one while each has text in it).
test("widget while asked: pressing a widget leaves what is being typed elsewhere alone (shared cases T1–T3)", () => {
  assert.deepEqual(asked.typing.map((entry) => entry.typing).sort(), ["drawer", "quick", "quickMemo"]);
  for (const entry of asked.typing) assert.equal(entry.then, "kept");
  const widgets = fs.readFileSync(path.join(process.cwd(), "src/main/calendarWidget.ts"), "utf8");
  assert.match(widgets, /focusable: false/, "the widget's window takes no keyboard");
  assert.doesNotMatch(widgets, /\.focus\(\)/, "nothing focuses a widget's window");
  const own = modulesOf("widget").filter((one) => /renderer[\\/](widget|widgetAsk)\.ts$/.test(one));
  assert.equal(own.length, 2, "the widget's page and widgetAsk.ts");
  for (const file of own) {
    assert.doesNotMatch(fs.readFileSync(file, "utf8"), /\.focus\(/, `${path.basename(file)} focuses nothing`);
  }
});

