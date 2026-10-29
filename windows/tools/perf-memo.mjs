// `npm run build && node tools/perf-memo.mjs [tier …]`: 메모 서랍 under load (docs/perf-memo-stress.md). Each tier is a
// --demo run (its own throwaway folder) on tools/perf-data.mjs's set with memos.json and memo-folders.json from
// tools/memo-stress-data.mjs; measured over the DevTools protocol like tools/perf.mjs. Tiers: 50 500 2000 5000 long
// (default: all). `long` adds memos of 10 KB, 100 KB and 1 MB and a 2,000-line checklist to 500 memos.
//   node tools/perf-memo.mjs [tier …] [--out=file.json]
// Per tier: the drawer's first open and reopen, idle CPU with it open, scrolling the list (frame times), opening the top
// memo, typing in it (each key to its frame) and the redraw when the keys pause (long tasks), memory.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { writePerfData } from "./perf-data.mjs";
import { writeMemoStressData } from "./memo-stress-data.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const option = (name) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const electronBinary = createRequire(import.meta.url)("electron");
if (typeof globalThis.WebSocket !== "function") {
  const result = spawnSync(electronBinary, [fileURLToPath(import.meta.url), ...args], { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  process.exit(result.status ?? 1);
}
const tiers = args.filter((arg) => !arg.startsWith("--"));
if (tiers.length === 0) tiers.push("50", "500", "2000", "5000", "long");
const base = fs.mkdtempSync(path.join(os.tmpdir(), "paper-memo-perf-"));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const sorted = (values) => [...values].sort((a, b) => a - b);
const median = (values) => (values.length ? sorted(values)[Math.floor(values.length / 2)] : NaN);
const p95 = (values) => (values.length ? sorted(values)[Math.min(values.length - 1, Math.floor(values.length * 0.95))] : NaN);
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const stats = (values) => ({ median: round(median(values)), p95: round(p95(values)), max: round(Math.max(...values)), n: values.length });

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const waiting = new Map();
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id === undefined) return;
    const entry = waiting.get(data.id);
    waiting.delete(data.id);
    if (data.error) entry?.reject(new Error(`${data.error.message} (${entry.method})`)); else entry?.resolve(data.result);
  };
  return {
    send: (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; waiting.set(id, { resolve, reject, method }); socket.send(JSON.stringify({ id, method, params })); }),
    close: () => socket.close(),
  };
}
async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}\n in: ${expression.slice(0, 200)}`);
  return result.result.value;
}
const json = async (port, what) => { try { return await (await fetch(`http://127.0.0.1:${port}/json/${what}`)).json(); } catch { return undefined; } };
const until = (client, condition, ms = 20000) => evaluate(client, `new Promise((resolve) => { const end = performance.now() + ${ms}; const look = () => (${condition}) ? resolve(true) : performance.now() > end ? resolve(false) : setTimeout(look, 4); look(); })`);
const act = (client, action) => evaluate(client, `window.paper.act(${JSON.stringify(action)})`);

const children = new Set();
process.on("exit", () => { for (const child of children) try { child.kill("SIGKILL"); } catch { /* gone */ } });
let portBase = 9800 + Math.floor(Math.random() * 150);

async function launch(name, memoOptions) {
  const folder = path.join(base, name);
  const data = path.join(folder, "data");
  const tmp = path.join(folder, "tmp");
  fs.mkdirSync(tmp, { recursive: true });
  writePerfData(data, new Date());
  const summary = writeMemoStressData(data, { ...memoOptions, marker: true });
  const debugPort = portBase++;
  const inspectPort = portBase++;
  const started = Date.now();
  const child = spawn(electronBinary, [root, "--demo", `--remote-debugging-port=${debugPort}`, `--inspect=${inspectPort}`, `--user-data-dir=${path.join(folder, "user-data")}`, "--disable-backgrounding-occluded-windows"], {
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE")), PAPERTODO_NO_SHORTCUTS: "1", PAPERTODO_DEMO_DATA: data, PAPERTODO_LANG: "ko", TMPDIR: tmp },
    stdio: ["ignore", "ignore", "pipe"],
  });
  children.add(child);
  child.on("exit", () => children.delete(child));
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  let mainTarget;
  for (let tries = 0; tries < 400 && !mainTarget; tries += 1) { mainTarget = (await json(inspectPort, "list"))?.[0]; if (!mainTarget) await sleep(25); }
  if (!mainTarget) throw new Error(`no main inspector\n${stderr}`);
  const main = await connect(mainTarget.webSocketDebuggerUrl);
  while (!(await evaluate(main, `Boolean(process.mainModule)`))) await sleep(10);
  await evaluate(main, `globalThis.__e = process.mainModule.require("electron"); true`);
  let noteTarget;
  for (let tries = 0; tries < 800 && !noteTarget; tries += 1) { noteTarget = (await json(debugPort, "list"))?.find((target) => target.url.endsWith("note.html")); if (!noteTarget) await sleep(20); }
  if (!noteTarget) throw new Error(`no note page\n${stderr}`);
  const note = await connect(noteTarget.webSocketDebuggerUrl);
  for (let tries = 0; ; tries += 1) {
    try { await evaluate(note, `new Promise((resolve) => { const look = () => performance.getEntriesByName("paper:first-render").length ? resolve() : setTimeout(look, 10); look(); })`); break; }
    catch (error) { if (tries > 100) throw error; await sleep(20); }
  }
  const ready = Date.now() - started;
  return {
    child, main, note, debugPort, summary, ready,
    async page(match) {
      for (let tries = 0; tries < 800; tries += 1) {
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
}

const metricsExpression = `__e.app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, cpu: m.cpu.cumulativeCPUUsage ?? null, percent: m.cpu.percentCPUUsage, memory: m.memory.workingSetSize }))`;
async function cpuOver(run, seconds) {
  const before = await evaluate(run.main, metricsExpression);
  await sleep(seconds * 1000);
  const after = await evaluate(run.main, metricsExpression);
  let total = 0;
  for (const entry of after) {
    const earlier = before.find((other) => other.pid === entry.pid);
    total += ((entry.cpu !== null && earlier?.cpu != null ? entry.cpu - earlier.cpu : (entry.percent / 100) * seconds) / seconds) * 100;
  }
  return round(total, 2);
}
const memoryMB = async (run) => round((await evaluate(run.main, metricsExpression)).reduce((sum, entry) => sum + entry.memory, 0) / 1024, 0);

/** Long tasks (≥ 50 ms) on the page from now on, collected in window.__long. */
const watchLong = (page) => evaluate(page, `(window.__long = [], window.__longObserver?.disconnect(), window.__longObserver = new PerformanceObserver((list) => { for (const entry of list.getEntries()) window.__long.push(entry.duration); }), window.__longObserver.observe({ type: "longtask" }), true)`);

/** Types into the focused field: each key's input event → the frame after it. */
async function type(page, text) {
  await evaluate(page, `(() => {
    window.__typed = [];
    window.__typer?.remove?.();
    const listener = (event) => { const start = event.timeStamp; requestAnimationFrame(() => setTimeout(() => window.__typed.push(performance.now() - start), 0)); };
    document.addEventListener("input", listener, true);
    window.__typer = { remove: () => document.removeEventListener("input", listener, true) };
    return true;
  })()`);
  for (const character of text) {
    await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: character, text: character, unmodifiedText: character });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: character });
    await sleep(120);
  }
  await sleep(800); // the main process hears the text 150 ms after the last key and the windows redraw; the save at 400 ms
  return evaluate(page, `window.__typed`);
}

/** A click on the card's element: the click's own work (the redraw runs in it), then to the next frame (at most 60 s). */
async function clickTimed(page, selector) {
  return evaluate(page, `new Promise((resolve) => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return resolve(null);
    element.scrollIntoView({ block: "nearest" });
    const start = performance.now();
    element.click();
    const sync = performance.now() - start;
    const done = () => resolve({ sync, frame: performance.now() - start, visible: document.visibilityState });
    const timer = setTimeout(done, 60000);
    requestAnimationFrame(() => setTimeout(() => { clearTimeout(timer); done(); }, 0));
  })`);
}

/** The drawer back on screen if a key closed it. */
async function ensureOpen(run, page) {
  if ((await evaluate(page, `document.visibilityState`)) === "visible") return;
  await act(run.note, { type: "drawer", command: "open" });
  await until(page, `document.visibilityState === "visible"`, 5000);
  await sleep(500);
}

/** Scrolls the list 200 px a frame to the end and back: the frame intervals. */
const scrollFrames = (page) => evaluate(page, `new Promise((resolve) => {
  const list = document.querySelector(".list") ?? document.querySelector("[role=list]");
  if (!list) return resolve([]);
  const gaps = [];
  let last = performance.now(), down = true, frames = 0;
  const step = () => {
    const now = performance.now(); gaps.push(now - last); last = now; frames += 1;
    if (down) { list.scrollTop += 200; if (list.scrollTop + list.clientHeight >= list.scrollHeight - 2) down = false; } else list.scrollTop -= 400;
    if ((!down && list.scrollTop <= 0) || frames > 600) return resolve(gaps.slice(1));
    requestAnimationFrame(step);
  };
  list.scrollTop = 0;
  requestAnimationFrame(step);
  // Frames stop when the window is covered on a busy Mac: what was measured by then, after 20 s.
  setTimeout(() => resolve(gaps.slice(1)), 20000);
})`);

const results = { when: new Date().toISOString(), machine: `${os.cpus()[0]?.model} · ${os.platform()} ${os.release()}`, load: os.loadavg().map((value) => round(value, 1)), tiers: {} };
const log = (tier, text, value) => console.log(`  ${text}: ${typeof value === "object" ? JSON.stringify(value) : value}`);

for (const tier of tiers) {
  const options = tier === "long" ? { memos: 500, long: [10, 100, 1024], checklist: 2000 } : { memos: Number(tier) };
  const run = await launch(`tier-${tier}`, options);
  const out = (results.tiers[tier] = { memos: run.summary.memos, inbox: run.summary.inbox, memosKB: round(run.summary.bytes / 1024, 0), startMs: run.ready });
  console.log(`-- tier ${tier}: ${run.summary.memos} memos (${run.summary.inbox} in the inbox), memos.json ${out.memosKB} KB · start → note ${run.ready} ms`);
  try {
    await sleep(1500);
    const opened = await evaluate(run.main, `Date.now()`);
    await act(run.note, { type: "drawer", command: "open" });
    const page = await run.page((url) => url.endsWith("drawer.html"));
    // First open (the window made, the page loaded): to its first contentful paint, as tools/perf.mjs measures it.
    if (await until(page, `performance.getEntriesByName("first-contentful-paint").length > 0`)) {
      out.firstOpenMs = round((await evaluate(page, `performance.timeOrigin + performance.getEntriesByName("first-contentful-paint")[0].startTime`)) - opened);
      log(tier, "drawer first open, first paint (ms)", out.firstOpenMs);
    }
    await until(page, `document.querySelectorAll(".it").length > 0`);
    out.cards = await evaluate(page, `document.querySelectorAll(".it").length`);
    out.domNodes = await evaluate(page, `document.getElementsByTagName("*").length`);
    log(tier, "cards in the DOM · all nodes", `${out.cards} · ${out.domNodes}`);
    await sleep(2000);
    const reopen = [];
    for (let index = 0; index < 3; index += 1) {
      await act(run.note, { type: "drawer", command: "close" });
      await sleep(400);
      // Something changed while it was closed (a memo edited elsewhere): the reopen redraws the whole list.
      await act(run.note, { type: "memoUpdate", id: "STRESS-TOP", text: `맨 위 메모\n여기에 적어 봐요 ${index}` });
      await sleep(800);
      await watchLong(page);
      // Something changed while it was closed (a memo from another window): the reopen redraws the list.
      await evaluate(page, `(window.__shown = undefined, document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") requestAnimationFrame(() => setTimeout(() => { window.__shown = performance.timeOrigin + performance.now(); }, 0)); }, { once: true }), true)`);
      const started = await evaluate(run.main, `Date.now()`);
      await act(run.note, { type: "drawer", command: "open" });
      if (await until(page, "window.__shown !== undefined")) reopen.push((await evaluate(page, `window.__shown`)) - started);
      await sleep(600);
    }
    out.reopenMs = round(median(reopen));
    out.reopenLongestTaskMs = round(Math.max(0, ...(await evaluate(page, `window.__long`))));
    log(tier, "drawer reopen after a change (ms) · its longest task", `${out.reopenMs} · ${out.reopenLongestTaskMs}`);
    await sleep(1500);
    out.idleCpu = await cpuOver(run, 20);
    log(tier, "idle CPU, drawer open, 20 s (%)", out.idleCpu);
    out.scroll = stats(await scrollFrames(page));
    log(tier, "scroll frame interval (ms)", out.scroll);
    await evaluate(page, `(document.querySelector(".list").scrollTop = 0, true)`);
    await sleep(300);

    const memosToType = tier === "long" ? ["STRESS-TOP", "STRESS-LONG-100K", "STRESS-LONG-1024K"] : ["STRESS-TOP"];
    out.typing = {};
    for (const id of memosToType) {
      await ensureOpen(run, page);
      await watchLong(page);
      const opened = await clickTimed(page, `.it[data-id="${id}"]`);
      await until(page, `document.querySelector('.it.open textarea.editor') !== null`, 60000);
      await sleep(600);
      const focused = await evaluate(page, `(() => { const field = document.querySelector('.it.open textarea.editor'); if (!field) return false; field.focus(); field.setSelectionRange(field.value.length, field.value.length); return document.activeElement === field; })()`);
      const keys = focused ? await type(page, "가나다라마바사아자차abcdefghij") : [];
      const long = await evaluate(page, `window.__long`);
      out.typing[id] = { openSyncMs: round(opened?.sync ?? NaN), openFrameMs: round(opened?.frame ?? NaN), visible: opened?.visible, focused, keys: keys.length ? stats(keys) : null, longTasks: long.length, longestTaskMs: round(Math.max(0, ...long)) };
      log(tier, `open + type in ${id}`, out.typing[id]);
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(1000);
    }
    if (tier === "long") {
      await ensureOpen(run, page);
      await watchLong(page);
      const checklist = await clickTimed(page, `.it[data-id="STRESS-CHECK-2000"]`);
      out.checklistOpenMs = round(checklist?.sync ?? NaN);
      await sleep(800);
      out.checklistLongTasks = await evaluate(page, `window.__long.length`);
      log(tier, "open the 2,000-line checklist (ms)", out.checklistOpenMs);
      await page.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(800);
    }
    out.memoryMB = await memoryMB(run);
    log(tier, "memory, all processes (MB)", out.memoryMB);
    page.close();
  } catch (error) {
    out.error = String(error.message ?? error);
    console.log(`  error: ${out.error}`);
  } finally {
    await run.quit();
  }
}
const file = option("out") ?? path.join(os.tmpdir(), `perf-memo-${Date.now()}.json`);
fs.writeFileSync(file, JSON.stringify(results, null, 2));
console.log(`\n→ ${file}`);
fs.rmSync(base, { recursive: true, force: true, maxRetries: 3 });
