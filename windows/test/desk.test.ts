import assert from "node:assert/strict";
import { test } from "node:test";
import {
  deskFrame, deskPanes, deskSections, isNight, isSettingsTab, pageOfPane, paneForShortcut, paperColor, readPaper, readPane,
  settingsTabs, shortcutForPane, stepPane, themeSource,
} from "../src/core/desk";

test("desk: the sidebar's order — 보기 · 설정 · 도움, twelve panes (AI 연결 since 1.27, 메모 서랍 since 1.28)", () => {
  assert.deepEqual(deskSections.map((entry) => entry.section), ["view", "settings", "help"]);
  assert.deepEqual(deskPanes, ["calendar", "history", "clock", "appearance", "notifications", "repeat", "pet", "events", "storage", "drawer", "ai", "help"]);
});

test("desk: Ctrl+1…9 go down the sidebar; 도움말 has none (F1)", () => {
  assert.equal(paneForShortcut(1), "calendar");
  assert.equal(paneForShortcut(2), "history");
  assert.equal(paneForShortcut(4), "appearance");
  assert.equal(paneForShortcut(9), "storage");
  assert.equal(paneForShortcut(0), undefined);
  assert.equal(paneForShortcut(10), undefined);
  assert.equal(shortcutForPane("clock"), 3);
  assert.equal(shortcutForPane("help"), undefined);
  assert.equal(shortcutForPane("ai"), undefined);
  assert.equal(shortcutForPane("drawer"), undefined);
  for (let digit = 1; digit <= 9; digit += 1) assert.equal(shortcutForPane(paneForShortcut(digit)!), digit);
});

test("desk: ↑ ↓ step through the panes and stop at the ends", () => {
  assert.equal(stepPane("calendar", 1), "history");
  assert.equal(stepPane("clock", 1), "appearance");
  assert.equal(stepPane("calendar", -1), "calendar");
  assert.equal(stepPane("help", 1), "help");
  assert.equal(stepPane("help", -1), "ai");
  assert.equal(stepPane("storage", 1), "drawer");
  assert.equal(stepPane("drawer", 1), "ai");
});

test("desk: the settings panes share one page; the old tab names still open the right pane", () => {
  assert.deepEqual(settingsTabs.filter(isSettingsTab), settingsTabs);
  assert.equal(pageOfPane("events"), "settings");
  assert.equal(pageOfPane("clock"), "settings");
  assert.equal(pageOfPane("calendar"), "calendar");
  assert.equal(pageOfPane("help"), "help");
  assert.equal(readPane("calendar"), "calendar");
  assert.equal(readPane("calendar", true), "events"); // Settings' old 캘린더 tab
  assert.equal(readPane("clock", true), "clock");
  assert.equal(readPane("nonsense"), undefined);
  assert.equal(readPane(3), undefined);
});

test("desk: its frame is remembered, never under the minimum", () => {
  assert.deepEqual(deskFrame(undefined), { width: 920, height: 640 });
  assert.deepEqual(deskFrame({ x: 10, y: 20, width: 500, height: 300 }), { width: 760, height: 520, x: 10, y: 20 });
  assert.deepEqual(deskFrame({ x: 1, y: 2, width: 1200.4, height: 800 }), { width: 1200, height: 800, x: 1, y: 2 });
  assert.deepEqual(deskFrame({ width: 1000, height: 700 }), { width: 1000, height: 700 });
});

test("night paper: 자동 follows the system, 낮 · 밤 hold; the window background matches the paper", () => {
  assert.equal(isNight("auto", true), true);
  assert.equal(isNight("auto", false), false);
  assert.equal(isNight("day", true), false);
  assert.equal(isNight("night", false), true);
  assert.equal(readPaper("night"), "night");
  assert.equal(readPaper("dark"), "auto");
  assert.equal(readPaper(undefined), "auto");
  assert.equal(themeSource("auto"), "system");
  assert.equal(themeSource("day"), "light");
  assert.equal(themeSource("night"), "dark");
  assert.equal(paperColor(true), "#2a2924");
  assert.equal(paperColor(false), "#fbf9f3");
});
