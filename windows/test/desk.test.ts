import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import {
  deskFrame, deskPanes, deskSections, isNight, isSettingsTab, pageOfPane, paneForShortcut, paperColor, readPaper, readPane,
  settingsTabs, shortcutForPane, stepPane, themeSource,
} from "../src/core/desk";
import { setLang } from "../src/i18n";
import { paneTitle, sectionTitle } from "../src/renderer/deskPanes";

// 책상 목록의 묶음 (#240, D4 B): the shared cases from docs/plans/desk-sidebar-cases.json (the Mac's test-localization.sh
// reads the same file).
const sidebarCases = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), "..", "docs", "plans", "desk-sidebar-cases.json"), "utf8")) as {
  maxRows: number; sections: { section: string; panes: string[] }[]; shortcuts: string[]; titles: Record<string, [string, string, string]>;
};

test("desk: the sidebar's groups — 보기 · 설정 · 메모와 데이터 · 도움, each six rows or fewer (shared cases)", () => {
  assert.deepEqual(deskSections, sidebarCases.sections);
  for (const { panes } of deskSections) assert.ok(panes.length <= sidebarCases.maxRows, `${panes.join(", ")}: more than ${sidebarCases.maxRows} rows`);
  assert.deepEqual(deskPanes, ["calendar", "history", "appearance", "notifications", "clock", "repeat", "events", "pet", "drawer", "spaces", "storage", "ai", "help"]);
  assert.equal(new Set(deskPanes).size, 13);
});

test("desk: Ctrl+1…9 go down the sidebar, 달력 to 메모 서랍; the rest and 도움말 have none (F1)", () => {
  sidebarCases.shortcuts.forEach((pane, index) => assert.equal(paneForShortcut(index + 1), pane));
  assert.equal(paneForShortcut(0), undefined);
  assert.equal(paneForShortcut(10), undefined);
  assert.equal(shortcutForPane("clock"), 5);
  assert.equal(shortcutForPane("storage"), undefined);
  assert.equal(shortcutForPane("spaces"), undefined);
  assert.equal(shortcutForPane("help"), undefined);
  assert.equal(shortcutForPane("ai"), undefined);
  for (let digit = 1; digit <= 9; digit += 1) assert.equal(shortcutForPane(paneForShortcut(digit)!), digit);
});

test("desk: 알람 · 타이머 and 메모와 데이터 in ko · en · nl (shared cases)", () => {
  const [clockKo, clockEn, clockNl] = sidebarCases.titles.clock;
  const [dataKo, dataEn, dataNl] = sidebarCases.titles.data;
  for (const [language, clock, data] of [["ko", clockKo, dataKo], ["en", clockEn, dataEn], ["nl", clockNl, dataNl]] as const) {
    setLang(language);
    assert.equal(paneTitle("clock"), clock);
    assert.equal(sectionTitle("data"), data);
  }
  setLang("ko");
});

test("desk: ↑ ↓ step through the panes and stop at the ends", () => {
  assert.equal(stepPane("calendar", 1), "history");
  assert.equal(stepPane("history", 1), "appearance");
  assert.equal(stepPane("notifications", 1), "clock");
  assert.equal(stepPane("calendar", -1), "calendar");
  assert.equal(stepPane("help", 1), "help");
  assert.equal(stepPane("help", -1), "ai");
  assert.equal(stepPane("pet", 1), "drawer");
  assert.equal(stepPane("spaces", 1), "storage");
  assert.equal(stepPane("storage", 1), "ai");
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
