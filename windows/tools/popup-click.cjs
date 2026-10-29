// The reminder slip's click-through, end to end: the real ReminderPopup (main), preload and popup page,
// bundled fresh from src/ into a temp folder and run in Electron. The window lets clicks through
// (setIgnoreMouseEvents(true, { forward: true })) until the page says the pointer is over the slip or the
// cat; this probe records every setIgnoreMouseEvents call, moves a pointer with CDP Input events (only moves,
// as Windows forwards WM_MOUSEMOVE to a click-through window), and clicks the first check box.
// From windows/:
//   npx electron tools/popup-click.cjs                      the current src/renderer/popup.ts
//   npx electron tools/popup-click.cjs --renderer=<file>    another popup.ts in its place (an older one)
//   npx electron tools/popup-click.cjs --only=compact       the cases whose name has that text
//
// A case passes when, at the moment of the click, the app has asked for a window that takes clicks (so the OS
// hands the click to the page rather than the window behind) and the click reached the check (the row is
// done; a due reminder's onComplete ran). Exit code 1 when a case fails. CDP events skip the OS, so this
// can't prove Windows' own forwarding; that needs a real PC.
const { app, BrowserWindow, ipcMain } = require("electron");
// A failure ends the run with its message, never with Electron's error dialog on the screen.
process.on("uncaughtException", (error) => { console.error(error); app.exit(1); });
process.on("unhandledRejection", (error) => { console.error(error); app.exit(1); });
const fs = require("node:fs");
const path = require("node:path");
const { buildSync } = require("esbuild");

const root = path.join(__dirname, "..");
const rendererArg = process.argv.find((arg) => arg.startsWith("--renderer="))?.slice("--renderer=".length);
const only = process.argv.find((arg) => arg.startsWith("--only="))?.slice("--only=".length);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── Build into a folder shaped like out/ (the page loads ../../assets) ───

// In out/ (the build clears it; Chromium writes its profile again while quitting, so each run starts it afresh).
const tmp = path.join(root, "out", "popup-click");
fs.rmSync(tmp, { recursive: true, force: true });
fs.mkdirSync(tmp, { recursive: true });
const out = path.join(tmp, "out");
const rendererOut = path.join(out, "renderer");
fs.mkdirSync(rendererOut, { recursive: true });
fs.symlinkSync(path.join(root, "assets"), path.join(tmp, "assets"));
const node = { bundle: true, platform: "node", format: "cjs", target: "node22", external: ["electron"], logLevel: "warning" };
// The popup's own electron import gets windows that may sit wherever they are put (macOS otherwise pulls a
// frameless window back under the menu bar, where the real pointer could reach it), and a screen whose cursor
// the probe sets (globalThis.__probeCursor) for a pointer that rests without sending any move.
const shim = path.join(tmp, "electron-shim.js");
fs.writeFileSync(shim, `const electron = globalThis.__probeElectron;
class BrowserWindow extends electron.BrowserWindow { constructor(options) { super({ ...options, enableLargerThanScreen: true }); } }
const screen = new Proxy({}, { get: (target, key) => key === "getCursorScreenPoint" && globalThis.__probeCursor ? () => globalThis.__probeCursor : electron.screen[key].bind(electron.screen) });
module.exports = new Proxy(electron, { get: (target, key) => (key === "BrowserWindow" ? BrowserWindow : key === "screen" ? screen : target[key]) });
`);
globalThis.__probeElectron = require("electron");
buildSync({ ...node, external: [], alias: { electron: shim }, entryPoints: [path.join(root, "src/main/popup.ts")], outfile: path.join(out, "popup-main.js") });
buildSync({ ...node, entryPoints: [path.join(root, "src/preload.ts")], outfile: path.join(out, "preload.js") });
const page = { bundle: true, platform: "browser", format: "iife", target: "chrome130", logLevel: "warning", outfile: path.join(rendererOut, "popup.js") };
if (rendererArg) buildSync({ ...page, stdin: { contents: fs.readFileSync(rendererArg, "utf8"), resolveDir: path.join(root, "src/renderer"), sourcefile: "popup.ts", loader: "ts" } });
else buildSync({ ...page, entryPoints: [path.join(root, "src/renderer/popup.ts")] });
for (const name of ["popup.html", "base.css", "slip.css", "popup.css"]) fs.copyFileSync(path.join(root, "src/renderer", name), path.join(rendererOut, name));

// Far off every display (and see-through, below).
process.env.PAPERTODO_OFFSCREEN = "1";
app.setPath("userData", path.join(tmp, "user-data"));
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
app.commandLine.appendSwitch("disable-renderer-backgrounding");

// ─── The window's click-through, as the app asks the OS for it ───
// Recorded, while the real window always lets the real pointer through and is drawn fully transparent:
// the probe's own pointer comes over CDP, and nothing on the screen shows or takes a click.

let ignoreLog = [];
const original = BrowserWindow.prototype.setIgnoreMouseEvents;
BrowserWindow.prototype.setIgnoreMouseEvents = function (ignore) {
  ignoreLog.push({ at: Date.now(), ignore });
  return original.call(this, true);
};
const showInactive = BrowserWindow.prototype.showInactive;
BrowserWindow.prototype.showInactive = function () {
  this.setOpacity(0);
  return showInactive.call(this);
};
const takesClicks = () => ignoreLog.length > 0 && !ignoreLog[ignoreLog.length - 1].ignore;

ipcMain.on("lang:get", (event) => { event.returnValue = "ko"; });
ipcMain.on("paper:get", (event) => { event.returnValue = false; });

const tasks = [{ id: "a", title: "책 10쪽 읽기", scheduledAt: new Date().toISOString() }, { id: "b", title: "물 마시기", scheduledAt: new Date().toISOString() }];
const base = { tasks, preview: false, canComplete: true, font: "pen", durationMs: 30_000, snoozeEnabled: true, reduceMotion: false };
const kinds = {
  due: { ...base, scheduled: true, tomorrow: true },
  periodic: { ...base, scheduled: false },
  sweep: { ...base, scheduled: false, canComplete: false, durationMs: 0, snoozeEnabled: false, sweep: { variant: "evening", message: "오늘 2개 남았어요. 내일로 넘길까요?" } },
};

/**
 * Each case: the slip's kind and style, when the pointer comes over the first check box (ms after the
 * window is placed; "placed" = at once), whether it then keeps moving over the slip, and when it clicks.
 */
const cases = [
  { name: "paper · due · pointer comes in during the walk-in, rests", kind: "due", style: "paper", enterAt: 700, clickAt: 2900 },
  { name: "paper · due · pointer comes in during the walk-in, keeps moving over the slip", kind: "due", style: "paper", enterAt: 700, wiggle: true, clickAt: 2900 },
  { name: "paper · due · pointer comes in after the slip opened", kind: "due", style: "paper", enterAt: 2600, clickAt: 2900 },
  { name: "character · due · pointer comes in during the walk-in, rests", kind: "due", style: "character", enterAt: 700, clickAt: 2900 },
  { name: "compact · due · pointer already there as the window is placed", kind: "due", style: "compact", enterAt: "placed", clickAt: 600 },
  { name: "compact · due · pointer comes in after the slip opened", kind: "due", style: "compact", enterAt: 400, clickAt: 700 },
  { name: "paper · 남은 할 일 · pointer comes in during the walk-in, rests", kind: "periodic", style: "paper", enterAt: 700, clickAt: 2900 },
  { name: "paper · 남은 할 일 · pointer comes in after the slip opened", kind: "periodic", style: "paper", enterAt: 2600, clickAt: 2900 },
  { name: "paper · 저녁 정리 · pointer comes in during the walk-in, rests", kind: "sweep", style: "paper", enterAt: 700, clickAt: 2900 },
  // The pointer already rests on the check box as the slip appears and never moves: the OS forwards no move
  // at all, so only the pointer's place on the screen can tell. Then it moves off the slip: clicks pass again.
  { name: "paper · due · pointer resting on the check before the slip came, never moves", kind: "due", style: "paper", still: true, clickAt: 2900, thenLeave: true },
  { name: "compact · due · pointer resting on the check before the slip came, never moves", kind: "due", style: "compact", still: true, clickAt: 600, thenLeave: true },
];

async function runCase(ReminderPopup, entry) {
  const popup = new ReminderPopup(rendererOut);
  const completed = [];
  ignoreLog = [];
  globalThis.__probeCursor = undefined;
  const handlers = { onComplete: (id) => completed.push(id), onCompleteAll: (ids) => completed.push(...ids), onSnooze() {}, onOpen() {}, onSweep() {} };
  popup.show({ ...kinds[entry.kind], style: entry.style }, handlers);
  const window = popup.snapshotWindow;
  const contents = window.webContents;
  const run = (label, script) => contents.executeJavaScript(script).catch((error) => { throw new Error(`${label}: ${error.message}`); });
  contents.on("console-message", (event) => { if (event.level === "error" || event.level === "warning") console.log(`      page ${event.level}: ${event.message}`); });
  if (!contents.debugger.isAttached()) contents.debugger.attach("1.3");
  const input = (params) => contents.debugger.sendCommand("Input.dispatchMouseEvent", params);
  // The window is placed (the first setIgnoreMouseEvents) once the page has measured the slip.
  for (let tries = 0; tries < 400 && ignoreLog.length === 0; tries += 1) await sleep(10);
  const placed = Date.now();
  const bounds = window.getBounds();
  const reduce = await run("motion", `matchMedia("(prefers-reduced-motion: reduce)").matches`);
  const target = await run("target", `(() => {
    const check = document.querySelector(".check");
    const r = check.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  })()`);
  const until = async (ms) => { const wait = placed + ms - Date.now(); if (wait > 0) await sleep(wait); };
  let atEnter = false;
  if (entry.still) {
    const content = window.getContentBounds();
    globalThis.__probeCursor = { x: content.x + target.x, y: content.y + target.y };
  } else {
    await until(entry.enterAt === "placed" ? 0 : entry.enterAt);
    // Coming in from the window's empty left edge, in a few steps, then resting on the check box.
    for (const x of [2, Math.round(target.x / 2), target.x]) await input({ type: "mouseMoved", x, y: target.y });
    atEnter = await run("enter", `document.querySelector(".bubble").classList.contains("open")`);
  }
  if (entry.wiggle) {
    for (let step = 1; step < 20; step += 1) {
      await sleep(80);
      await input({ type: "mouseMoved", x: target.x + 40 + (step % 5) * 12, y: target.y + (step % 3) });
    }
    await input({ type: "mouseMoved", x: target.x, y: target.y });
  }
  await until(entry.clickAt);
  const facts = await run("facts", `(() => {
    const check = document.querySelector(".check");
    const hit = document.elementFromPoint(${target.x}, ${target.y});
    const chain = [];
    for (let node = check; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      chain.push({ tag: node.tagName + (node.className ? "." + String(node.className).split(" ").join(".") : ""), region: style.getPropertyValue("-webkit-app-region") || style.webkitAppRegion || "", pointer: style.pointerEvents });
    }
    return { open: document.querySelector(".bubble").classList.contains("open"), hitIsCheck: Boolean(hit && check.contains(hit)), hit: hit ? hit.tagName + "." + hit.className : null, disabled: check.disabled, chain };
  })()`);
  const clickable = takesClicks();
  await input({ type: "mousePressed", x: target.x, y: target.y, button: "left", buttons: 1, clickCount: 1 });
  await input({ type: "mouseReleased", x: target.x, y: target.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(150);
  const row = await run("row", `(() => { const row = document.querySelector(".task"); return { gone: !row, done: Boolean(row?.classList.contains("done")), picked: Boolean(row?.classList.contains("picked")) }; })()`);
  // The sweep's boxes start ticked and the click unticks them; the others are done by the click.
  const reached = entry.kind === "sweep" ? !row.picked : row.done && completed.includes("a");
  let leftOK = true;
  if (entry.thenLeave) {
    globalThis.__probeCursor = undefined;
    await input({ type: "mouseMoved", x: 2, y: target.y });
    await sleep(100);
    leftOK = !takesClicks();
  }
  const pass = clickable && reached && leftOK;
  const log = ignoreLog.map((step) => `${step.at - placed}ms:${step.ignore ? "ignore" : "clicks"}`).join(" ");
  console.log(`${pass ? "PASS" : "FAIL"}  ${entry.name}`);
  console.log(`      window at ${bounds.x},${bounds.y}, opacity ${window.getOpacity()}; reduced motion ${reduce}; slip open when the pointer came in: ${atEnter}; open at the click: ${facts.open}`);
  console.log(`      window at the click: ${clickable ? "takes clicks" : "CLICK-THROUGH (the OS gives the click to the window behind)"}; click reached the check: ${reached}${entry.kind === "sweep" ? "" : ` (onComplete: ${completed.join(",") || "none"})`}`);
  if (entry.thenLeave) console.log(`      after the pointer moved off the slip: ${leftOK ? "click-through again" : "STILL TAKES CLICKS over the empty window"}`);
  console.log(`      topmost under the pointer: ${facts.hit} (the check: ${facts.hitIsCheck}); disabled: ${facts.disabled}`);
  const regions = [...new Set(facts.chain.map((link) => link.region))].join("/");
  const pointers = [...new Set(facts.chain.map((link) => link.pointer))].join("/");
  console.log(`      check → html: -webkit-app-region ${regions}; pointer-events ${pointers}`);
  console.log(`      setIgnoreMouseEvents: ${log}`);
  popup.hide();
  window.destroy();
  await sleep(100);
  return pass;
}

// Never left running: a hung case ends the run.
setTimeout(() => { console.log("timed out"); app.exit(2); }, 120_000).unref();

// Each case closes its window; the run goes on.
app.on("window-all-closed", () => undefined);

app.whenReady().then(async () => {
  app.dock?.hide();
  const { ReminderPopup } = require(path.join(out, "popup-main.js"));
  console.log(`renderer: ${rendererArg ? path.basename(rendererArg) : "src/renderer/popup.ts"} · Electron ${process.versions.electron}`);
  let failed = 0;
  for (const entry of cases) {
    if (only && !entry.name.includes(only)) continue;
    try {
      if (!(await runCase(ReminderPopup, entry))) failed += 1;
    } catch (error) {
      failed += 1;
      console.log(`FAIL  ${entry.name}: ${error.message}`);
    }
  }
  console.log(failed ? `${failed} case(s) failed` : "all cases passed");
  app.exit(failed ? 1 : 0);
});
