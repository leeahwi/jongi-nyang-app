import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { reportText, styleText, taskbarText, type ReportInput } from "../src/core/reportInfo";
import { readAction, mayAct } from "../src/core/ipcCheck";

// #409: 문제 보고용 정보 복사 — the displays, the cats' windows, the GPU; never a to-do, memo or path.
const root = process.cwd();

const sample: ReportInput = {
  app: "종이냥 1.34.1", electron: "44.4.5", chrome: "140.0.0.0", os: "win32 10.0.26100 x64", lang: "ko",
  displays: [
    { id: 1, bounds: { x: 0, y: 0, width: 1536, height: 864 }, workArea: { x: 0, y: 0, width: 1536, height: 824 }, scaleFactor: 1.25, rotation: 0, internal: true, primary: true },
    { id: 2, bounds: { x: 1536, y: 0, width: 1920, height: 1080 }, workArea: { x: 1536, y: 0, width: 1920, height: 1080 }, scaleFactor: 1, rotation: 0, internal: false, primary: false },
  ],
  windows: [
    { name: "pet", state: "shown", bounds: { x: 0, y: 700, width: 900, height: 124 }, contentBounds: { x: 0, y: 700, width: 900, height: 124 }, alwaysOnTop: true, style: 0x96000000, exStyle: 0x080800a8 },
    { name: "typing cat", state: "none" },
  ],
  gpu: { gpu_compositing: "enabled", webgl: "enabled_on" },
  settings: { noteLayer: "normal", sharedFolder: true },
};

test("report info: displays with their taskbar side, windows with their style bits, the GPU and a few settings", () => {
  const text = reportText(sample, new Date("2026-11-11T05:00:00Z"));
  assert.match(text, /^Jongi-nyang report info \(no to-dos, memos or paths\)\n/);
  assert.match(text, /app: 종이냥 1\.34\.1 · Electron 44\.4\.5 · Chrome 140\.0\.0\.0/);
  assert.match(text, /- #1 primary internal: bounds 0,0 1536×864 · work area 0,0 1536×824 · scale 1\.25\n  taskbar: bottom 40\n/);
  assert.match(text, /- #2: bounds 1536,0 1920×1080 · work area 1536,0 1920×1080 · scale 1\n  taskbar: none \(auto-hide, or none on this display\)\n/);
  assert.match(text, /- pet: shown · bounds 0,700 900×124 · content 0,700 900×124 · on top yes\n  style 0x96000000 WS_POPUP\|WS_VISIBLE\n  ex style 0x080800a8 WS_EX_TOPMOST/);
  assert.match(text, /- typing cat: not open/);
  assert.match(text, /- gpu_compositing: enabled/);
  assert.match(text, /- sharedFolder: true/);
});

test("report info: Windows' style bits are named (WS_THICKFRAME is what #312 looks for)", () => {
  assert.equal(styleText(0x94000000), "0x94000000 WS_POPUP|WS_VISIBLE");
  assert.equal(styleText(0x94040000), "0x94040000 WS_POPUP|WS_VISIBLE|WS_THICKFRAME");
  assert.equal(styleText(0x080800a8, true), "0x080800a8 WS_EX_TOPMOST|WS_EX_TRANSPARENT|WS_EX_TOOLWINDOW|WS_EX_LAYERED|WS_EX_NOACTIVATE");
  assert.equal(styleText(-1811939328), "0x94000000 WS_POPUP|WS_VISIBLE", "a negative LONG reads the same");
  assert.equal(styleText(0), "0x00000000");
  assert.equal(taskbarText({ bounds: { x: 0, y: 0, width: 100, height: 100 }, workArea: { x: 10, y: 0, width: 90, height: 100 } }), "left 10");
});

test("report info: nothing of the person's data — the text and its sources never read to-dos, memos, events or paths", () => {
  const text = reportText(sample);
  assert.doesNotMatch(text, /[A-Z]:\\|\/Users\/|AppData|\.json/);
  const core = fs.readFileSync(path.join(root, "src/core/reportInfo.ts"), "utf8");
  const main = fs.readFileSync(path.join(root, "src/main/reportInfo.ts"), "utf8");
  for (const [name, source] of [["core", core], ["main", main]] as const) {
    for (const word of ["store", "items", "memos", "events", "archive", "dataDirectory", "getPath", "homedir", "execPath", "__dirname"]) {
      assert.doesNotMatch(source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "").replace(/"(?:[^"\\\n]|\\.)*"/g, '""'), new RegExp(`\\b${word}\\b`), `${name}/reportInfo.ts reads ${word}`);
    }
  }
  // The caller hands over windows and the app's own settings, the folder only as shared or not.
  const app = fs.readFileSync(path.join(root, "src/main/main.ts"), "utf8");
  const call = app.slice(app.indexOf("function copyReportInfo("), app.indexOf("\n}\n", app.indexOf("function copyReportInfo(")));
  assert.match(call, /clipboard\.writeText\(reportInfo\(\[\["note", note\], \["ears", noteEars\?\.reportWindow\], \["pet", pet\?\.reportWindow\], \["typing cat", typingCat\?\.reportWindow\]\]/);
  assert.match(call, /sharedFolder: store\.dataDirectory !== settingsDirectory/);
  assert.doesNotMatch(call, /\b(items|memos|events|dataDirectory\b(?! !==))/);
  // Style bits through the shared Koffi loader (#408).
  assert.match(main, /windowsNative\(\)/);
  assert.match(main, /GetWindowLongPtrW\(intptr hWnd, int nIndex\)/);
});

test("report info: 책상 → 도움 → 도움말 asks for it (the end of every topic), and only that page may", () => {
  const action = readAction({ type: "copyReportInfo" });
  assert.deepEqual(action, { type: "copyReportInfo" });
  assert.equal(mayAct("help", action!), true);
  assert.equal(mayAct("note", action!), false);
  assert.equal(mayAct("desk", action!), false);
  const help = fs.readFileSync(path.join(root, "src/renderer/help.ts"), "utf8");
  assert.match(help, /paper\(\)\.act\(\{ type: "copyReportInfo" \}\)/);
  assert.match(help, /neighbours\(topic\),\n    reportButton\(\),\n    h\("p", \{ class: "copyright" \}, COPYRIGHT\),/);
  // Not in the desk's sidebar: at 760 × 520 it would push 사용 안내's neighbour out of view (the size sweep).
  assert.doesNotMatch(fs.readFileSync(path.join(root, "src/renderer/desk.ts"), "utf8"), /copyReportInfo/);
  for (const lang of ["en", "nl"]) assert.match(fs.readFileSync(path.join(root, `src/i18n/${lang}.ts`), "utf8"), /^  "문제 보고용 정보 복사": "/m, lang);
});
