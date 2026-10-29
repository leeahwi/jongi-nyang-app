// `npm run perf`: starts a --demo run on a heavy, realistic data set (tools/perf-data.mjs) and prints
// the key numbers — start time, idle CPU (Electron total, via app.getAppMetrics), memory, input and tab
// latency, the desk and month, search, file I/O while idle and the save after an edit — over the
// DevTools protocol (renderers) and the Node inspector (main process). Nothing global is pressed.
//   node tools/perf.mjs [--quick] [--long] [--out=file.json] [--dir=folder] [--trace]
// --quick: shorter idle windows (20 s) and use loop (1 min); --long: the full 10-minute use loop.
// --todos=2000 --spaces=9 (1.30): today's sheet that full and that many spaces; the `spaces` step times the lens.
// --app=<folder>: another build (a 1.29 checkout) on the same data, to alternate with.
// Perf audit 2: --history=6000 --history-days=1095 --events=200 (the record and events that big); the steps `ipc`
// (state messages and bytes, idle and per check), `depth` (a check at undo depth 0 and 200: round trip and the main
// process's CPU), `panes` (the desk's month, week and 완료 기록 opened, then the busy time per check with the desk open)
// and `windows` (memory per renderer with every window made once). Run it with PAPERTODO_OFFSCREEN=1 so no window
// comes on screen.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { writePerfData } from "./perf-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const electronBinary = createRequire(import.meta.url)("electron");

// The protocol needs a WebSocket: Node 22+ has one; older Node runs this script in Electron's own Node.
if (typeof globalThis.WebSocket !== "function") {
  const result = spawnSync(electronBinary, [fileURLToPath(import.meta.url), ...args], { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  process.exit(result.status ?? 1);
}

const quick = flag("quick");
const only = option("only")?.split(",");
/** `--only=cold,idle,io,typing,tabs,check,search,desk,hidden,drawer,pet,timer,alarm,use` runs just those steps. */
const want = (name) => !only || only.includes(name);
const idleSeconds = quick ? 20 : 60;
const useMinutes = flag("long") ? 10 : quick ? 1 : 3;
const dataOptions = { ...(option("todos") ? { todos: Number(option("todos")) } : {}), ...(option("spaces") ? { spaces: Number(option("spaces")) } : {}),
  ...(option("history") ? { history: Number(option("history")) } : {}), ...(option("history-days") ? { historyDays: Number(option("history-days")) } : {}),
  ...(option("events") ? { events: Number(option("events")) } : {}) };
const base = option("dir") ?? fs.mkdtempSync(path.join(os.tmpdir(), "paper-perf-"));
fs.mkdirSync(base, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.floor(sorted.length / 2)] : NaN; };
const p95 = (values) => { const sorted = [...values].sort((a, b) => a - b); return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : NaN; };
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

// ─── A tiny DevTools protocol client ─────────────────────────────────────────

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const waiting = new Map();
  const listeners = new Map();
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id !== undefined) {
      const entry = waiting.get(data.id);
      waiting.delete(data.id);
      if (data.error) entry?.reject(new Error(`${data.error.message} (${entry.method})`)); else entry?.resolve(data.result);
    } else for (const listener of listeners.get(data.method) ?? []) listener(data.params);
  };
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; waiting.set(id, { resolve, reject, method }); socket.send(JSON.stringify({ id, method, params })); }),
    on: (method, listener) => listeners.set(method, [...(listeners.get(method) ?? []), listener]),
    close: () => socket.close(),
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, includeCommandLineAPI: true });
  if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}\n in: ${expression.slice(0, 200)}`);
  return result.result.value;
}

const json = async (port, what) => { try { return await (await fetch(`http://127.0.0.1:${port}/json/${what}`)).json(); } catch { return undefined; } };

// ─── One run of the app ───────────────────────────────────────────────────────

const children = new Set();
process.on("exit", () => { for (const child of children) try { child.kill("SIGKILL"); } catch { /* gone */ } });
let portBase = 9400 + Math.floor(Math.random() * 400);

async function launch(name, extraData = {}) {
  const folder = path.join(base, name);
  fs.rmSync(folder, { recursive: true, force: true });
  const data = path.join(folder, "data");
  const tmp = path.join(folder, "tmp");
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  writePerfData(data, new Date(), { ...dataOptions, ...extraData });
  const debugPort = portBase++;
  const inspectPort = portBase++;
  const started = Date.now();
  const child = spawn(electronBinary, [option("app") ?? root, "--demo", `--remote-debugging-port=${debugPort}`, `--inspect=${inspectPort}`, `--user-data-dir=${path.join(folder, "user-data")}`,
    // Measured as if on top: a note under other windows would stop drawing (macOS occlusion) and look idle.
    "--disable-backgrounding-occluded-windows"], {
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE")), PAPERTODO_NO_SHORTCUTS: "1", PAPERTODO_DEMO_DATA: data, PAPERTODO_LANG: process.env.PAPERTODO_LANG ?? "ko", TMPDIR: tmp },
    stdio: ["ignore", "ignore", "pipe"],
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  // The main process (Node inspector).
  let mainTarget;
  for (let tries = 0; tries < 400 && !mainTarget; tries += 1) { mainTarget = (await json(inspectPort, "list"))?.[0]; if (!mainTarget) await sleep(25); }
  if (!mainTarget) throw new Error(`no main inspector\n${stderr}`);
  const main = await connect(mainTarget.webSocketDebuggerUrl);
  while (!(await evaluate(main, `Boolean(process.mainModule)`))) await sleep(10);
  await evaluate(main, `globalThis.__e = process.mainModule.require("electron"); globalThis.__fs = process.mainModule.require("fs"); true`);
  // PAPERTODO_OFFSCREEN=1 (perf audit 2): the windows that have no off-screen place of their own (the desk) are moved
  // off every screen before they show, so a measured run never puts a window in front of the person at the Mac.
  if (process.env.PAPERTODO_OFFSCREEN === "1") await evaluate(main, `(() => {
    const proto = __e.BrowserWindow.prototype;
    const away = (window) => { const [x, y] = window.getPosition(); if (x > -20000) window.setPosition(-40000 + 100, -40000 + 100); };
    for (const name of ["show", "showInactive"]) { const original = proto[name]; proto[name] = function (...args) { away(this); return original.apply(this, args); }; }
    return true;
  })()`);
  // The note's page.
  let noteTarget;
  for (let tries = 0; tries < 600 && !noteTarget; tries += 1) { noteTarget = (await json(debugPort, "list"))?.find((target) => target.url.endsWith("note.html")); if (!noteTarget) await sleep(20); }
  if (!noteTarget) throw new Error(`no note page\n${stderr}`);
  const note = await connect(noteTarget.webSocketDebuggerUrl);
  for (let tries = 0; ; tries += 1) {
    try { await evaluate(note, `new Promise((resolve) => { const look = () => performance.getEntriesByName("paper:first-render").length && document.visibilityState === "visible" ? resolve() : setTimeout(look, 10); look(); })`); break; }
    catch (error) { if (tries > 50) throw error; await sleep(20); } // the page was still loading
  }
  const marks = await evaluate(note, `({ origin: performance.timeOrigin, render: performance.getEntriesByName("paper:first-render")[0].startTime,
    paint: performance.getEntriesByType("paint").find((entry) => entry.name === "first-contentful-paint")?.startTime ?? null,
    visible: performance.getEntriesByType("visibility-state").find((entry) => entry.name === "visible")?.startTime ?? null })`);
  const run = {
    name, child, main, note, debugPort, started, folder,
    cold: { render: marks.origin + marks.render - started, visible: marks.visible === null ? null : marks.origin + marks.visible - started },
    async page(match) {
      for (let tries = 0; tries < 500; tries += 1) {
        const target = (await json(debugPort, "list"))?.find((entry) => entry.type === "page" && match(entry.url));
        if (target) return connect(target.webSocketDebuggerUrl);
        await sleep(10);
      }
      throw new Error("page not found");
    },
    async quit() {
      try { await evaluate(main, `setTimeout(() => __e.app.exit(0), 50), true`); } catch { /* gone */ }
      main.close(); note.close();
      await new Promise((resolve) => { const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5000); child.on("exit", () => { clearTimeout(timer); resolve(); }); });
    },
  };
  return run;
}

// ─── Measurements ─────────────────────────────────────────────────────────────

const metricsExpression = `(() => {
  const contents = __e.webContents.getAllWebContents().map((w) => ({ pid: w.getOSProcessId(), url: w.getURL().split("/").pop() }));
  return __e.app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, name: m.name ?? m.serviceName ?? "", cpu: m.cpu.cumulativeCPUUsage ?? null, percent: m.cpu.percentCPUUsage,
    memory: m.memory.workingSetSize, pages: contents.filter((c) => c.pid === m.pid).map((c) => c.url) }));
})()`;

/** CPU % (of one core) over `seconds`, for all of Electron and by process kind. */
async function cpuOver(run, seconds) {
  const before = await evaluate(run.main, metricsExpression);
  await sleep(seconds * 1000);
  const after = await evaluate(run.main, metricsExpression);
  const byKind = {};
  let total = 0;
  for (const entry of after) {
    const earlier = before.find((other) => other.pid === entry.pid);
    const used = entry.cpu !== null && earlier?.cpu != null ? entry.cpu - earlier.cpu : (entry.percent / 100) * seconds;
    const share = (used / seconds) * 100;
    total += share;
    const kind = entry.type === "Tab" ? `renderer ${entry.pages.join("+") || "?"}` : entry.type === "Utility" ? `utility ${entry.name}` : entry.type;
    byKind[kind] = round((byKind[kind] ?? 0) + share, 2);
  }
  return { total: round(total, 2), byKind };
}

async function memory(run) {
  const metrics = await evaluate(run.main, metricsExpression);
  return { totalMB: round(metrics.reduce((sum, entry) => sum + entry.memory, 0) / 1024, 0), processes: metrics.length, windows: await evaluate(run.main, `__e.BrowserWindow.getAllWindows().length`) };
}

/** Waits (in the page) until `condition` holds; false after `ms`. */
const until = (client, condition, ms = 8000) => evaluate(client, `new Promise((resolve) => { const end = performance.now() + ${ms}; const look = () => (${condition}) ? resolve(true) : performance.now() > end ? resolve(false) : setTimeout(look, 4); look(); })`);
const settle = (client) => evaluate(client, `new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))`);
const act = (client, action) => evaluate(client, `window.paper.act(${JSON.stringify(action)})`);

async function click(client, selector) {
  const box = await evaluate(client, `(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return null; element.scrollIntoView({ block: "nearest" }); const rect = element.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })()`);
  if (!box) throw new Error(`nothing at ${selector}`);
  for (const type of ["mousePressed", "mouseReleased"]) await client.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
}

/** Keystroke → the character on screen (input event → the frame after it), and the handler's own time. */
async function typing(run) {
  const { note } = run;
  await evaluate(note, `(() => {
    window.__typed = [];
    window.addEventListener("input", (event) => {
      const handled = performance.now() - event.timeStamp;
      const start = event.timeStamp;
      requestAnimationFrame(() => setTimeout(() => window.__typed.push({ handled, shown: performance.now() - start }), 0));
    });
    document.querySelector("textarea.typed").focus();
    return true;
  })()`);
  const text = "buy milk tomorrow 9am report";
  for (const character of text) {
    await note.send("Input.dispatchKeyEvent", { type: "keyDown", key: character, text: character, unmodifiedText: character });
    await note.send("Input.dispatchKeyEvent", { type: "keyUp", key: character });
    await sleep(60);
  }
  await sleep(200);
  const typed = await evaluate(note, `window.__typed`);
  const chips = await evaluate(note, `document.querySelectorAll(".reads .chip").length`);
  await evaluate(note, `(() => { const field = document.querySelector("textarea.typed"); field.value = ""; field.dispatchEvent(new Event("input")); field.blur(); return true; })()`);
  // The same in a memo (every keystroke is saved through the main process) — while the note had a memo tab (≤ 1.27).
  const memoTab = await evaluate(note, `!!document.querySelector(".index-tab.tab-memos")`);
  if (!memoTab) return { keystrokes: typed.length, perKey: typed.map((entry) => Math.round(entry.shown)).join(" "), shownMedian: round(median(typed.map((entry) => entry.shown))), shownP95: round(p95(typed.map((entry) => entry.shown))), handlerMedian: round(median(typed.map((entry) => entry.handled)), 2), chips };
  await click(note, ".index-tab.tab-memos");
  await sleep(300);
  await click(note, ".memo-row");
  await sleep(400);
  await evaluate(note, `(window.__typed = [], document.querySelector("textarea.memo-text").focus(), true)`);
  for (const character of "a quick memo line") {
    await note.send("Input.dispatchKeyEvent", { type: "keyDown", key: character, text: character, unmodifiedText: character });
    await note.send("Input.dispatchKeyEvent", { type: "keyUp", key: character });
    await sleep(60);
  }
  await sleep(300);
  const memo = await evaluate(note, `window.__typed`);
  await note.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await note.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await sleep(300);
  await click(note, ".index-tab.tab-today");
  await sleep(300);
  return {
    keystrokes: typed.length, shownMedian: round(median(typed.map((entry) => entry.shown))), shownP95: round(p95(typed.map((entry) => entry.shown))), handlerMedian: round(median(typed.map((entry) => entry.handled)), 2), chips,
    memoShownMedian: round(median(memo.map((entry) => entry.shown))), memoShownP95: round(p95(memo.map((entry) => entry.shown))),
  };
}

/** Clicking a tab → the frame with the new page. */
async function tabSwitch(run) {
  const { note } = run;
  const tabs = (await evaluate(note, `[...document.querySelectorAll(".index-tab")].map((tab) => [...tab.classList].find((name) => name.startsWith("tab-")).slice(4))`));
  const times = Object.fromEntries(tabs.map((tab) => [tab, []]));
  for (let round_ = 0; round_ < 5; round_ += 1) {
    for (const tab of [...tabs.slice(1), tabs[0]]) {
      await evaluate(note, `(() => { window.__tab = undefined; document.addEventListener("click", (event) => { const start = event.timeStamp; requestAnimationFrame(() => setTimeout(() => { window.__tab = performance.now() - start; }, 0)); }, { once: true, capture: true }); return true; })()`);
      await click(note, `.index-tab.tab-${tab}`);
      if (!(await until(note, "window.__tab !== undefined"))) continue;
      times[tab].push(await evaluate(note, `window.__tab`));
      await sleep(150);
    }
  }
  return Object.fromEntries(Object.entries(times).map(([tab, list]) => [tab, round(median(list))]));
}

/**
 * 1.30: 오늘 drawn again (a state from the main process → the frame after: here a pref that changes nothing drawn), and
 * 한 스페이스만 보기 switched on and off (the act → the frame with the band, then without). Without spaces (a 1.29
 * build) only the redraw.
 */
async function spacesStep(run) {
  const { note } = run;
  const frame = (expression, condition) => evaluate(note, `new Promise((resolve) => { const start = performance.now(); ${expression}; const look = () => (${condition}) ? requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - start), 0)) : performance.now() - start > 4000 ? resolve(NaN) : setTimeout(look, 1); look(); })`);
  const redraw = [], script = [];
  // The note's own listener runs first (it was there before this one): the time to this one is the IPC and the draw's script.
  await evaluate(note, `(window.paper.on("state", () => { window.__drawn += 1; window.__drawnAt = performance.now(); }), true)`);
  for (let index = 0; index < 12; index += 1) {
    await evaluate(note, `(window.__drawn = 0, window.__actAt = performance.now(), true)`);
    redraw.push(await frame(`window.__actAt = performance.now(); window.paper.act({ type: "setPref", key: "timerRecent", value: [${40 + index}] })`, "window.__drawn > 0"));
    script.push(await evaluate(note, `window.__drawnAt - window.__actAt`));
    await sleep(300);
  }
  const rows = await evaluate(note, `document.querySelectorAll(".lines .row").length`);
  const spaces = await evaluate(note, `document.querySelector(".space-pick") ? !document.querySelector(".space-pick").hidden : false`);
  const on = [], off = [];
  if (spaces) {
    for (let index = 0; index < 6; index += 1) {
      on.push(await frame(`window.paper.act({ type: "spaceLens", space: "s-100000" })`, `!!document.querySelector(".lens-band")?.isConnected`));
      await sleep(300);
      off.push(await frame(`window.paper.act({ type: "spaceLens" })`, `!document.querySelector(".lens-band")?.isConnected`));
      await sleep(300);
    }
  }
  return { rows, redrawMedian: round(median(redraw)), redrawP95: round(p95(redraw)), scriptMedian: round(median(script)), ...(spaces ? { lensOnMedian: round(median(on)), lensOffMedian: round(median(off)) } : {}) };
}

/** Checking a task → its row starts the check animation (after the round trip through the main process). */
async function checkTask(run) {
  const { note } = run;
  const times = [];
  for (let index = 0; index < 6; index += 1) {
    await evaluate(note, `(() => {
      window.__checked = undefined;
      document.querySelector(".sheet").scrollTop = 0;
      const row = [...document.querySelectorAll(".lines .row:not(.done)")].find((candidate) => { const box = candidate.querySelector(".check").getBoundingClientRect(); const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2); return hit && candidate.querySelector(".check").contains(hit); });
      row.dataset.perf = "1";
      document.addEventListener("click", (event) => {
        const start = event.timeStamp;
        const observer = new MutationObserver(() => { if (row.classList.contains("animate") || row.classList.contains("done")) { observer.disconnect(); window.__checked = performance.now() - start; } });
        observer.observe(row, { attributes: true, attributeFilter: ["class"] });
      }, { once: true, capture: true });
      return true;
    })()`);
    await click(note, `.row[data-perf="1"] .check`);
    if (await until(note, "window.__checked !== undefined")) times.push(await evaluate(note, `window.__checked`));
    await evaluate(note, `(() => { document.querySelector('.row[data-perf="1"]')?.removeAttribute("data-perf"); return true; })()`);
    await sleep(700);
  }
  return { median: round(median(times)), max: round(Math.max(...times)) };
}

/**
 * The desk (책상 → 달력) from the note's button: until the month is drawn (the calendar page's own
 * "paper:first-render" mark, read afterwards, so the waiting doesn't load the run). First open, then again.
 */
async function desk(run) {
  const result = {};
  for (const which of ["first", "again"]) {
    const started = Date.now();
    await act(run.note, { type: "openCalendar" });
    let drawn;
    for (let tries = 0; tries < 120 && drawn === undefined; tries += 1) {
      await sleep(250);
      drawn = await evaluate(run.main, `(() => { const w = __e.BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("desk.html") || w.webContents.getURL().includes("desk.html?")); if (!w) return undefined;
        return Promise.all(w.webContents.mainFrame.framesInSubtree.map((frame) => frame.executeJavaScript('(() => { const mark = performance.getEntriesByName("paper:first-render")[0]; return mark && document.querySelectorAll(".month .cell, .week").length ? performance.timeOrigin + mark.startTime : null; })()').catch(() => null)))
          .then((list) => list.find((value) => value) ?? undefined); })()`);
    }
    result[which] = drawn === undefined ? NaN : round(drawn - started, 0);
    await evaluate(run.main, `(() => { __e.BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("desk.html"))?.destroy(); return true; })()`);
    await sleep(800);
  }
  return result;
}

/** Ctrl+F in the note, a 3-character query: the last keystroke → the results drawn. */
async function searchTime(run) {
  const { note } = run;
  const times = [];
  for (const query of ["보고서", "회의 ", "메모 "]) {
    await evaluate(note, `(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true, bubbles: true })); return true; })()`);
    await sleep(300);
    await evaluate(note, `(() => { const field = document.querySelector(".search-field"); field.focus(); return !!field; })()`);
    for (const character of query.trim().slice(0, -1)) await note.send("Input.insertText", { text: character }), await sleep(80);
    await sleep(300);
    await evaluate(note, `(() => { window.__found = undefined; const results = document.querySelector(".search-results"); const field = document.querySelector(".search-field");
      field.addEventListener("input", (event) => { const start = event.timeStamp; const observer = new MutationObserver(() => { observer.disconnect(); requestAnimationFrame(() => setTimeout(() => { window.__found = performance.now() - start; }, 0)); }); observer.observe(results, { childList: true }); }, { once: true });
      return true; })()`);
    await note.send("Input.insertText", { text: query.trim().slice(-1) });
    if (await until(note, "window.__found !== undefined")) times.push(await evaluate(note, `window.__found`));
    await note.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await note.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(300);
  }
  return { median: round(median(times)), max: round(Math.max(...times)) };
}

/** File calls in the main process while idle (per minute), and an edit → todos.json written. */
async function fileIO(run, seconds) {
  await evaluate(run.main, `(() => {
    if (globalThis.__io) return true;
    globalThis.__io = { counts: {}, writes: [] };
    for (const name of ["readFileSync", "writeFileSync", "renameSync", "statSync", "existsSync", "readdirSync", "appendFileSync", "openSync", "readSync", "copyFileSync", "mkdirSync"]) {
      const original = __fs[name];
      __fs[name] = function (...args) {
        const file = typeof args[0] === "string" ? args[0].split("/").pop() : "";
        const key = name + " " + file.replace(/\\d{4}-\\d{2}/, "YYYY-MM").replace(/\\.tmp$/, "");
        __io.counts[key] = (__io.counts[key] ?? 0) + 1;
        if (name === "renameSync" && file.endsWith(".tmp")) __io.writes.push({ file: args[1].split("/").pop(), at: Date.now() });
        return original.apply(this, args);
      };
    }
    return true;
  })()`);
  await evaluate(run.main, `(__io.counts = {}, true)`);
  await sleep(seconds * 1000);
  const counts = await evaluate(run.main, `__io.counts`);
  const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const perMinute = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, round(value * 60 / seconds, 1)]).sort((a, b) => b[1] - a[1]));
  // An edit: rename a task from the note, then wait for the list file to be written.
  const saves = [];
  for (let index = 0; index < 5; index += 1) {
    await evaluate(run.main, `(__io.writes = [], true)`);
    const started = await evaluate(run.note, `(() => { const id = document.querySelector(".lines .row").dataset.id; const at = Date.now(); window.paper.act({ type: "rename", id, title: "이름 바꿈 " + Math.random().toString(36).slice(2, 6) }); return at; })()`);
    let written;
    for (let tries = 0; tries < 400 && !written; tries += 1) { written = (await evaluate(run.main, `__io.writes`)).find((entry) => entry.file === "todos.json"); if (!written) await sleep(2); }
    saves.push(written ? written.at - started : NaN);
    await sleep(300);
  }
  return { callsPerMinute: round(total * 60 / seconds, 1), byCall: perMinute, saveMs: round(median(saves)) };
}

/** A DevTools trace of the whole app while idle with the note open: busy time by process and the top tasks. */
async function trace(run, seconds) {
  const version = await json(run.debugPort, "version");
  const browser = await connect(version.webSocketDebuggerUrl);
  const events = [];
  browser.on("Tracing.dataCollected", (params) => events.push(...params.value));
  const done = new Promise((resolve) => browser.on("Tracing.tracingComplete", resolve));
  await browser.send("Tracing.start", { traceConfig: { includedCategories: ["devtools.timeline", "toplevel", "v8.execute", "blink", "cc", "gpu", "disabled-by-default-devtools.timeline"], recordMode: "recordAsMuchAsPossible" }, transferMode: "ReportEvents" });
  await sleep(seconds * 1000);
  await browser.send("Tracing.end");
  await done;
  browser.close();
  fs.writeFileSync(path.join(run.folder, `trace-${seconds}s.json`), JSON.stringify(events));
  const processNames = new Map(events.filter((event) => event.name === "process_name").map((event) => [event.pid, event.args.name]));
  const threadNames = new Map(events.filter((event) => event.name === "thread_name").map((event) => [`${event.pid}:${event.tid}`, event.args.name]));
  const busy = {};
  const names = {};
  for (const event of events) {
    if (event.ph !== "X" || !event.dur) continue;
    const where = `${processNames.get(event.pid) ?? event.pid}/${threadNames.get(`${event.pid}:${event.tid}`) ?? event.tid}`;
    if (event.name === "ThreadControllerImpl::RunTask" || event.name === "RunTask") busy[where] = (busy[where] ?? 0) + event.dur / 1000;
    if (["FunctionCall", "TimerFire", "FireAnimationFrame", "UpdateLayoutTree", "Layout", "Paint", "PrePaint", "Layerize", "EventDispatch", "ParseHTML", "v8.callFunction", "ProxyMain::BeginMainFrame", "Commit", "RasterTask", "Animation"].includes(event.name))
      names[event.name] = (names[event.name] ?? 0) + event.dur / 1000;
  }
  const top = (record) => Object.fromEntries(Object.entries(record).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([key, value]) => [key, round(value / seconds, 2)]));
  return { msPerSecondByThread: top(busy), msPerSecondByEvent: top(names) };
}

/** A few minutes of ordinary use (writing, checking, switching, searching, the desk), then the memory. */
async function use(run, minutes) {
  const end = Date.now() + minutes * 60_000;
  let step = 0;
  while (Date.now() < end) {
    step += 1;
    try {
      if (step % 5 === 1) { await evaluate(run.note, `(() => { const field = document.querySelector("textarea.typed"); field.focus(); return true; })()`); await run.note.send("Input.insertText", { text: `perf ${step} 내일 3시` }); await run.note.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); await run.note.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }); }
      else if (step % 5 === 2) await click(run.note, ".lines .row:not(.done) .check");
      else if (step % 5 === 3) { await click(run.note, ".index-tab.tab-ahead"); await sleep(500); await click(run.note, ".index-tab.tab-today"); }
      else if (step % 5 === 4) { await act(run.note, { type: "openCalendar" }); await sleep(1200); await evaluate(run.main, `(() => { __e.BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("desk.html"))?.hide(); return true; })()`); }
      else { await click(run.note, ".index-tab.tab-memos"); await sleep(400); await click(run.note, ".index-tab.tab-today"); }
    } catch (error) { /* a step that found nothing to click: go on */ }
    await sleep(2500);
  }
  return memory(run);
}

async function setPref(run, key, value) { await act(run.note, { type: "setPref", key, value }); await sleep(500); }


// ─── Perf audit 2 ─────────────────────────────────────────────────────────────

/** Counts every message the main process sends to a page or frame (by channel, with its JSON size). */
async function countMessages(run) {
  await evaluate(run.main, `(() => {
    if (globalThis.__sent) return true;
    globalThis.__sent = {};
    const frame = __e.webContents.getAllWebContents()[0].mainFrame;
    const proto = Object.getPrototypeOf(frame);
    const original = proto.send;
    proto.send = function (channel, ...args) {
      let bytes = 0; try { bytes = JSON.stringify(args).length; } catch { /* not JSON */ }
      const entry = (__sent[channel] ??= { count: 0, bytes: 0 });
      entry.count += 1; entry.bytes += bytes;
      return original.call(this, channel, ...args);
    };
    const contents = Object.getPrototypeOf(__e.webContents.getAllWebContents()[0]);
    const originalContents = contents.send;
    contents.send = function (channel, ...args) {
      let bytes = 0; try { bytes = JSON.stringify(args).length; } catch { /* not JSON */ }
      const entry = (__sent["wc:" + channel] ??= { count: 0, bytes: 0 });
      entry.count += 1; entry.bytes += bytes;
      return originalContents.call(this, channel, ...args);
    };
    return true;
  })()`);
}
const takeMessages = async (run) => { const sent = await evaluate(run.main, `(() => { const out = __sent; globalThis.__sent = {}; return out; })()`); return Object.fromEntries(Object.entries(sent).map(([key, value]) => [key, { count: value.count, kB: round(value.bytes / 1024, 1) }])); };

/** One check from the note through the main process: act → the note's next state; the main process's CPU for it. */
const toggleRow = (run, which) => evaluate(run.note, `(async () => {
  if (window.__seen === undefined) { window.__seen = 0; window.paper.on("state", () => { window.__seen += 1; }); }
  const row = ${which === "done" ? `[...document.querySelectorAll(".lines .row.done")].pop()` : `[...document.querySelectorAll(".lines .row:not(.done)")][3]`};
  const seen = window.__seen, start = performance.now();
  window.paper.act({ type: "toggle", id: row.dataset.id });
  while (window.__seen === seen && performance.now() - start < 5000) await new Promise((resolve) => setTimeout(resolve, 0));
  return performance.now() - start;
})()`);
async function checkRoundTrip(run, times) {
  const out = [], cpu = [];
  for (let index = 0; index < times; index += 1) {
    const before = await evaluate(run.main, `(() => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; })()`);
    out.push(await toggleRow(run, "open"));
    await sleep(150);
    const after = await evaluate(run.main, `(() => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; })()`);
    cpu.push(after - before);
    await toggleRow(run, "done");
    await sleep(150);
  }
  return { roundTripMedian: round(median(out)), roundTripP95: round(p95(out)), mainCpuMedian: round(median(cpu)) };
}

async function ipcStep(run) {
  await countMessages(run);
  await takeMessages(run);
  await sleep(idleSeconds * 1000);
  const idle = await takeMessages(run);
  await toggleRow(run, "open"); await sleep(600);
  const oneCheck = await takeMessages(run);
  await toggleRow(run, "done"); await sleep(600);
  await takeMessages(run);
  return { idleSeconds, idle, oneCheck };
}

async function depthStep(run) {
  const fresh = await checkRoundTrip(run, 8);
  // 200 steps of undo behind: 100 checks and unchecks of one row.
  await evaluate(run.note, `(async () => { const id = [...document.querySelectorAll(".lines .row:not(.done)")][8].dataset.id; for (let i = 0; i < 200; i += 1) { await window.paper.act({ type: "toggle", id }); } return true; })()`);
  // (an even number of toggles: the row is back as it was)
  await sleep(1500);
  const deep = await checkRoundTrip(run, 8);
  return { depth0: fresh, depth200: deep };
}

/** Busy time per process (ms) while `work` runs, from a DevTools trace. */
async function busyDuring(run, work, label) {
  const version = await json(run.debugPort, "version");
  const browser = await connect(version.webSocketDebuggerUrl);
  const events = [];
  browser.on("Tracing.dataCollected", (params) => events.push(...params.value));
  const done = new Promise((resolve) => browser.on("Tracing.tracingComplete", resolve));
  await browser.send("Tracing.start", { traceConfig: { includedCategories: ["toplevel", "devtools.timeline", "v8.execute", "blink"], recordMode: "recordAsMuchAsPossible" }, transferMode: "ReportEvents" });
  await sleep(300);
  await work();
  await sleep(1200);
  await browser.send("Tracing.end");
  await done;
  browser.close();
  const urls = await evaluate(run.main, `__e.webContents.getAllWebContents().map((w) => ({ pid: w.getOSProcessId(), url: w.getURL().split("/").pop().split("?")[0] }))`);
  const kinds = await evaluate(run.main, `__e.app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type }))`);
  const nameOf = (pid) => urls.filter((entry) => entry.pid === pid).map((entry) => entry.url).join("+") || kinds.find((entry) => entry.pid === pid)?.type || String(pid);
  const busy = {}, longest = {};
  for (const event of events) {
    if (event.ph !== "X" || !event.dur || !["ThreadControllerImpl::RunTask", "RunTask"].includes(event.name)) continue;
    const where = nameOf(event.pid);
    busy[where] = (busy[where] ?? 0) + event.dur / 1000;
    longest[where] = Math.max(longest[where] ?? 0, event.dur / 1000);
  }
  const top = Object.entries(busy).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([where, ms]) => [where, { busyMs: round(ms), longestTaskMs: round(longest[where]) }]);
  return { [label]: Object.fromEntries(top) };
}

const deskWindow = `__e.BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes("desk.html"))`;
/** A desk frame's first contentful paint (absolute ms), or undefined. */
const framePaint = (page) => evaluate(run.main, `(() => { const w = ${deskWindow}; if (!w) return undefined;
  return Promise.all(w.webContents.mainFrame.framesInSubtree.filter((f) => f.url.includes(${JSON.stringify(page)})).map((frame) => frame.executeJavaScript('(() => { const p = performance.getEntriesByName("first-contentful-paint")[0]; return p ? performance.timeOrigin + p.startTime : null; })()').catch(() => null)))
    .then((list) => list.find((value) => value) ?? undefined); })()`);

async function panesStep(run) {
  const result = {};
  const started = Date.now();
  await act(run.note, { type: "openCalendar" });
  let month;
  for (let tries = 0; tries < 120 && month === undefined; tries += 1) { await sleep(100); month = await framePaint("calendarWindow.html"); }
  for (let tries = 0; tries < 50 && !(await evaluate(run.main, `!!${deskWindow}`)); tries += 1) await sleep(100);
  result.monthFirstPaintMs = month === undefined ? NaN : round(month - started, 0);
  await sleep(1500);
  // The week view: the calendar's own button (→ the frame after).
  result.weekMs = await evaluate(run.main, `(() => { const w = ${deskWindow}; const frame = w?.webContents.mainFrame.framesInSubtree.find((f) => f.url.includes("calendarWindow.html")); if (!frame) return null;
    return frame.executeJavaScript('new Promise((resolve) => { const button = [...document.querySelectorAll("button")].find((b) => /주|week/i.test(b.textContent) && !/월|month/i.test(b.textContent)); if (!button) return resolve(null); const start = performance.now(); button.click(); requestAnimationFrame(() => setTimeout(() => resolve(performance.now() - start), 0)); })'); })()`);
  result.weekMs = result.weekMs === null ? NaN : round(result.weekMs);
  await sleep(800);
  const historyStart = Date.now();
  await act(run.note, { type: "deskPane", pane: "history" });
  let history;
  for (let tries = 0; tries < 120 && history === undefined; tries += 1) { await sleep(50); history = await framePaint("history.html"); }
  result.historyFirstPaintMs = history === undefined ? NaN : round(history - historyStart, 0);
  result.historyNodes = await evaluate(run.main, `(() => { const w = ${deskWindow}; const frame = w?.webContents.mainFrame.framesInSubtree.find((f) => f.url.includes("history.html")); return frame ? frame.executeJavaScript("document.querySelectorAll('*').length") : null; })()`);
  await sleep(1500);
  // A check in the note while the desk shows 완료 기록 (the calendar frame kept behind it).
  Object.assign(result, await busyDuring(run, () => toggleRow(run, "open"), "checkWithDeskOpen"));
  await toggleRow(run, "done"); await sleep(600);
  result.idleDeskOpen = await cpuOver(run, Math.min(idleSeconds, 30));
  await evaluate(run.main, `(() => { ${deskWindow}?.destroy(); return true; })()`);
  await sleep(800);
  Object.assign(result, await busyDuring(run, () => toggleRow(run, "open"), "checkNoteOnly"));
  await toggleRow(run, "done"); await sleep(600);
  return result;
}

/** Memory by renderer after the windows a session makes (desk, drawer, quick entry, quick memo, timer sheet). */
async function windowsStep(run) {
  await act(run.note, { type: "openCalendar" }); await sleep(2500);
  await act(run.note, { type: "drawer", command: "open" }); await sleep(2500);
  await act(run.note, { type: "drawer", command: "close" }); await sleep(800);
  await evaluate(run.main, `(() => { ${deskWindow}?.hide(); return true; })()`);
  await sleep(2000);
  const metrics = await evaluate(run.main, metricsExpression);
  const byPage = {};
  for (const entry of metrics) {
    const kind = entry.type === "Tab" ? (entry.pages.join("+") || "?") : entry.type;
    byPage[kind] = round((byPage[kind] ?? 0) + entry.memory / 1024, 0);
  }
  return { processes: metrics.length, windows: await evaluate(run.main, `__e.BrowserWindow.getAllWindows().length`), mbByProcess: byPage };
}

/** The note's JavaScript by function (self time, ms) while `work` runs: a CPU profile from the page. */
async function profileNote(run, work, seconds = 0) {
  const { note } = run;
  await note.send("Profiler.enable");
  await note.send("Profiler.setSamplingInterval", { interval: 200 });
  await note.send("Profiler.start");
  await work();
  if (seconds) await sleep(seconds * 1000);
  const { profile } = await note.send("Profiler.stop");
  const self = new Map();
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const counts = new Map();
  for (const sample of profile.samples) counts.set(sample, (counts.get(sample) ?? 0) + 1);
  const span = (profile.endTime - profile.startTime) / 1000 / Math.max(1, profile.samples.length);
  for (const [id, count] of counts) {
    const frame = byId.get(id).callFrame;
    const where = `${frame.functionName || "(anonymous)"} ${frame.url.split("/").pop()}:${frame.lineNumber + 1}`;
    self.set(where, (self.get(where) ?? 0) + count * span);
  }
  return Object.fromEntries([...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([key, value]) => [key, round(value)]));
}

async function profileStep(run) {
  const check = await profileNote(run, async () => { for (let index = 0; index < 4; index += 1) { await toggleRow(run, "open"); await sleep(300); await toggleRow(run, "done"); await sleep(300); } });
  const idle = await profileNote(run, async () => undefined, idleSeconds);
  return { checkTimes8: check, idle };
}

// ─── The run ──────────────────────────────────────────────────────────────────

const results = { load: os.loadavg().map((value) => round(value, 1)), when: new Date().toISOString(), platform: `${process.platform} ${os.release()} · ${os.cpus()[0]?.model}`, idleSeconds, useMinutes };
const log = (label, value) => { console.log(`${label.padEnd(28)} ${typeof value === "object" ? JSON.stringify(value) : value}`); };

// Cold start: three launches, the median.
const colds = [];
for (let index = 0; index < (want("cold") ? 3 : 0); index += 1) {
  const run = await launch(`cold-${index}`);
  colds.push(run.cold);
  await run.quit();
}
if (colds.length) results.coldStart = { renderMs: median(colds.map((cold) => cold.render)), visibleMs: median(colds.map((cold) => cold.visible ?? NaN)), runs: colds };
if (colds.length) log("cold start (ms)", results.coldStart);

const run = await launch("main");
process.on("unhandledRejection", (error) => { console.error(error); process.exit(1); });
const step = async (name, label, work) => { if (!want(name)) return; results[label.key] = await work(); log(label.text, results[label.key]); };
const showNote = (visible) => evaluate(run.main, `(() => { const w = __e.BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("note.html")); ${visible ? "w.show()" : "w.hide()"}; return true; })()`);
try {
  await sleep(4000);
  results.memoryAfterStart = await memory(run);
  log("memory after start", results.memoryAfterStart);

  // Warm reopen: hide the note, show it again → the first frame after.
  await step("cold", { key: "warmReopenMs", text: "warm reopen (ms)" }, async () => {
    const reopen = [];
    for (let index = 0; index < 3; index += 1) {
      await showNote(false);
      await sleep(2000);
      await evaluate(run.note, `(window.__shown = undefined, document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") requestAnimationFrame(() => setTimeout(() => { window.__shown = performance.timeOrigin + performance.now(); }, 0)); }, { once: true }), true)`);
      const started = await evaluate(run.main, `(() => { const at = Date.now(); const w = __e.BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith("note.html")); w.show(); w.focus(); return at; })()`);
      if (await until(run.note, "window.__shown !== undefined")) reopen.push((await evaluate(run.note, `window.__shown`)) - started);
      await sleep(500);
    }
    return round(median(reopen));
  });

  await settle(run.note);
  results.ribbonShown = await evaluate(run.note, `!!document.querySelector(".ribbon .track")`);
  await step("idle", { key: "idleNoteOpen", text: "idle CPU note open (%)" }, () => cpuOver(run, idleSeconds));
  await step("io", { key: "fileIO", text: "file I/O" }, () => fileIO(run, idleSeconds));
  if (flag("trace")) await step("idle", { key: "traceIdle", text: "trace idle" }, () => trace(run, 10));
  await step("typing", { key: "typing", text: "typing (ms)" }, () => typing(run));
  await step("tabs", { key: "tabSwitch", text: "tab switch (ms)" }, () => tabSwitch(run));
  await step("spaces", { key: "spaces", text: "오늘 redraw · lens (ms)" }, () => spacesStep(run));
  await step("check", { key: "check", text: "check → animation (ms)" }, () => checkTask(run));
  await step("search", { key: "search", text: "search 3 chars (ms)" }, () => searchTime(run));
  await step("desk", { key: "desk", text: "desk → month (ms)" }, () => desk(run));
  await step("ipc", { key: "ipc", text: "IPC (messages · kB)" }, () => ipcStep(run));
  await step("depth", { key: "depth", text: "check at undo depth" }, () => depthStep(run));
  await step("panes", { key: "panes", text: "desk panes" }, () => panesStep(run));
  await step("windows", { key: "windows", text: "memory by window" }, () => windowsStep(run));
  await step("profile", { key: "profile", text: "note JS profile (self ms)" }, () => profileStep(run));

  await showNote(false);
  await sleep(1500);
  await step("hidden", { key: "idleNoteHidden", text: "idle CPU note hidden (%)" }, () => cpuOver(run, idleSeconds));
  // 메모 서랍 (1.28): open (the note hidden), its reopen time (second open on: show → the page's first frame), then
  // closed with only the edge handle out.
  await step("drawer", { key: "idleDrawerOpen", text: "idle CPU drawer open (%)" }, async () => {
    const opened = await evaluate(run.main, `Date.now()`);
    await act(run.note, { type: "drawer", command: "open" });
    const page = await run.page((url) => url.endsWith("drawer.html"));
    // First open (the window made, the page loaded and drawn): to the page's first contentful paint.
    if (await until(page, `performance.getEntriesByName("first-contentful-paint").length > 0`)) {
      results.drawerFirstOpenMs = round((await evaluate(page, `performance.timeOrigin + performance.getEntriesByName("first-contentful-paint")[0].startTime`)) - opened);
      log("drawer first open (ms)", results.drawerFirstOpenMs);
    }
    await sleep(2500);
    const reopen = [];
    for (let index = 0; index < 3; index += 1) {
      await act(run.note, { type: "drawer", command: "close" });
      await sleep(1200);
      await evaluate(page, `(window.__shown = undefined, document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") requestAnimationFrame(() => setTimeout(() => { window.__shown = performance.timeOrigin + performance.now(); }, 0)); }, { once: true }), true)`);
      const started = await evaluate(run.main, `Date.now()`);
      await act(run.note, { type: "drawer", command: "open" });
      if (await until(page, "window.__shown !== undefined")) reopen.push((await evaluate(page, `window.__shown`)) - started);
      await sleep(600);
    }
    await sleep(1500);
    const cpu = await cpuOver(run, idleSeconds);
    page.close();
    results.drawerReopenMs = round(median(reopen));
    log("drawer reopen (ms)", results.drawerReopenMs);
    return cpu;
  });
  // 1.29: 반투명 (the paper at 82 % over a blur) open and idle — the blur must not make idle CPU climb.
  await step("drawer", { key: "idleDrawerFrost", text: "idle CPU drawer open, 반투명 (%)" }, async () => {
    await setPref(run, "drawerBackdrop", "frost");
    await sleep(2500);
    const cpu = await cpuOver(run, idleSeconds);
    await setPref(run, "drawerBackdrop", "solid");
    return cpu;
  });
  await step("drawer", { key: "idleDrawerClosed", text: "idle CPU drawer closed, handle out (%)" }, async () => {
    await act(run.note, { type: "drawer", command: "close" });
    await sleep(2000);
    return cpuOver(run, idleSeconds);
  });
  await step("pet", { key: "idlePet", text: "idle CPU pet out (%)" }, async () => {
    await setPref(run, "petVisible", true);
    await sleep(2000);
    const cpu = await cpuOver(run, idleSeconds);
    await setPref(run, "petVisible", false);
    return cpu;
  });
  await step("timer", { key: "idleTimer", text: "CPU timer running (%)" }, async () => {
    await act(run.note, { type: "timerCommand", command: { kind: "countdown", minutes: 25 } });
    await sleep(2000);
    const cpu = await cpuOver(run, idleSeconds);
    await act(run.note, { type: "timerCommand", command: { kind: "stop" } });
    return cpu;
  });
  // After an alarm rang and was stopped (silent sound): the ring window stays, hidden, for the next one.
  await step("alarm", { key: "idleAfterAlarm", text: "idle CPU after an alarm (%)" }, async () => {
    const soon = new Date(Date.now() + 60_000);
    const time = `${String(soon.getHours()).padStart(2, "0")}:${String(soon.getMinutes()).padStart(2, "0")}`;
    const stamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
    await act(run.note, { type: "alarmSave", alarm: { id: "PERF-ALARM", time, label: "perf", days: [], enabled: true, sound: "silent", snooze: 10, createdAt: stamp, updatedAt: stamp } });
    let ring;
    for (let tries = 0; tries < 240 && !ring; tries += 1) { await sleep(500); ring = (await json(run.debugPort, "list"))?.find((target) => target.url.endsWith("ring.html")); }
    if (!ring) return { error: "no ring" };
    await sleep(3000);
    const page = await connect(ring.webSocketDebuggerUrl);
    await evaluate(page, `(window.paper.send("ring:stop"), true)`).catch(() => undefined);
    page.close();
    await sleep(2000);
    return cpuOver(run, idleSeconds);
  });
  await showNote(true);
  await sleep(1000);
  await step("use", { key: "memoryAfterUse", text: `memory after ${useMinutes} min use` }, async () => ({ ...(await use(run, useMinutes)), minutes: useMinutes }));
} finally {
  await run.quit();
}
results.loadAfter = os.loadavg().map((value) => round(value, 1));
const out = option("out") ?? path.join(base, "perf.json");
fs.writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`\n→ ${out}`);
