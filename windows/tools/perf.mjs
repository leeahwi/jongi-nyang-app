// `npm run perf`: starts a --demo run on a heavy, realistic data set (tools/perf-data.mjs) and prints
// the key numbers — start time, idle CPU (Electron total, via app.getAppMetrics), memory, input and tab
// latency, the desk and month, search, file I/O while idle and the save after an edit — over the
// DevTools protocol (renderers) and the Node inspector (main process). Nothing global is pressed.
//   node tools/perf.mjs [--quick] [--long] [--out=file.json] [--dir=folder] [--trace]
// --quick: shorter idle windows (20 s) and use loop (1 min); --long: the full 10-minute use loop.
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
/** `--only=cold,idle,io,typing,tabs,check,search,desk,hidden,pet,timer,alarm,use` runs just those steps. */
const want = (name) => !only || only.includes(name);
const idleSeconds = quick ? 20 : 60;
const useMinutes = flag("long") ? 10 : quick ? 1 : 3;
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

async function launch(name, dataOptions = {}) {
  const folder = path.join(base, name);
  fs.rmSync(folder, { recursive: true, force: true });
  const data = path.join(folder, "data");
  const tmp = path.join(folder, "tmp");
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  writePerfData(data, new Date(), dataOptions);
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
  // The same in a memo (every keystroke is saved through the main process).
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
  const times = { ahead: [], memos: [], today: [] };
  for (let round_ = 0; round_ < 5; round_ += 1) {
    for (const tab of ["ahead", "memos", "today"]) {
      await evaluate(note, `(() => { window.__tab = undefined; document.addEventListener("click", (event) => { const start = event.timeStamp; requestAnimationFrame(() => setTimeout(() => { window.__tab = performance.now() - start; }, 0)); }, { once: true, capture: true }); return true; })()`);
      await click(note, `.index-tab.tab-${tab}`);
      if (!(await until(note, "window.__tab !== undefined"))) continue;
      times[tab].push(await evaluate(note, `window.__tab`));
      await sleep(150);
    }
  }
  return Object.fromEntries(Object.entries(times).map(([tab, list]) => [tab, round(median(list))]));
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
  await step("check", { key: "check", text: "check → animation (ms)" }, () => checkTask(run));
  await step("search", { key: "search", text: "search 3 chars (ms)" }, () => searchTime(run));
  await step("desk", { key: "desk", text: "desk → month (ms)" }, () => desk(run));

  await showNote(false);
  await sleep(1500);
  await step("hidden", { key: "idleNoteHidden", text: "idle CPU note hidden (%)" }, () => cpuOver(run, idleSeconds));
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
