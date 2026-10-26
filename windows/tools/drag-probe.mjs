// Drag probe for the 하루 일정표: a --demo run of the Windows app, real mouse events over CDP (Input.dispatchMouseEvent),
// the dragged block's top logged once per animation frame. Usage (from anywhere):
//   node dragprobe.mjs <appRoot> <outJson> [mode=move|top|bottom] [dy=150] [step=1]
// Runs itself in Electron's Node when Node has no WebSocket.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const [appRoot, outFile, mode = "move", dyText = "150", stepText = "1"] = process.argv.slice(2);
const electron = createRequire(path.join(appRoot, "package.json"))("electron");
if (typeof globalThis.WebSocket !== "function") {
  const result = spawnSync(electron, [fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } });
  process.exit(result.status ?? 1);
}
const here = path.dirname(fileURLToPath(import.meta.url));
const run = path.join(here, `run-${Date.now()}`);
fs.mkdirSync(path.join(run, "tmp"), { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const port = 9800 + Math.floor(Math.random() * 150);
const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "ELECTRON_RUN_AS_NODE")), PAPERTODO_NO_SHORTCUTS: "1", PAPERTODO_LANG: process.env.PAPERTODO_LANG ?? "ko", TMPDIR: path.join(run, "tmp") };
const inspectPort = port + 200;
const child = spawn(electron, [appRoot, "--demo", `--remote-debugging-port=${port}`, `--inspect=${inspectPort}`, `--user-data-dir=${path.join(run, "user-data")}`, "--disable-backgrounding-occluded-windows"], { env, stdio: ["ignore", "ignore", "pipe"] });
let stderr = "";
child.stderr.on("data", (chunk) => { stderr += chunk; });
process.on("exit", () => { try { child.kill("SIGKILL"); } catch { /* gone */ } });

async function connect(url) {
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let next = 0;
  const waiting = new Map();
  socket.onmessage = (message) => {
    const data = JSON.parse(message.data);
    if (data.id === undefined) return;
    const entry = waiting.get(data.id); waiting.delete(data.id);
    if (data.error) entry?.reject(new Error(data.error.message)); else entry?.resolve(data.result);
  };
  return { send: (method, params = {}) => new Promise((resolve, reject) => { const id = ++next; waiting.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); }), close: () => socket.close() };
}
const json = async (what) => { try { return await (await fetch(`http://127.0.0.1:${port}/json/${what}`)).json(); } catch { return undefined; } };
async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  return result.result.value;
}

// Off the screen (the real mouse can't wander into the drag), drawn as if on top.
let mainTarget;
for (let tries = 0; tries < 400 && !mainTarget; tries += 1) { try { mainTarget = (await (await fetch(`http://127.0.0.1:${inspectPort}/json/list`)).json())[0]; } catch { await sleep(25); } }
const main = await connect(mainTarget.webSocketDebuggerUrl);
while (!(await evaluate(main, `Boolean(process.mainModule)`))) await sleep(10);
await evaluate(main, `globalThis.__e = process.mainModule.require("electron"); true`);
let target;
for (let tries = 0; tries < 600 && !target; tries += 1) { target = (await json("list"))?.find((entry) => entry.url.endsWith("note.html")); if (!target) await sleep(25); }
if (!target) { console.error("no note page", stderr); process.exit(1); }
const note = await connect(target.webSocketDebuggerUrl);
for (let tries = 0; ; tries += 1) {
  try { await evaluate(note, `new Promise((resolve) => { const look = () => window.paper && document.querySelector(".sheet") ? resolve(true) : setTimeout(look, 20); look(); })`); break; }
  catch (error) { if (tries > 100) throw error; await sleep(30); }
}
await sleep(800);
console.error("windows:", await evaluate(main, `(() => { const ws = __e.BrowserWindow.getAllWindows().filter((w) => w.webContents.getURL().endsWith("note.html")); for (const w of ws) { w.setPosition(-30000, -30000); w.webContents.setBackgroundThrottling(false); } return ws.map((w) => w.getBounds()); })()`));
// Today's day: two to-dos with hours, an hour before now at the top; now 13:20 (window.ribbonNow).
await evaluate(note, `(async () => {
  document.querySelector(".guide-skip")?.click();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const pad = (v) => String(v).padStart(2, "0");
  const now = new Date(); if (now.getHours() < 4) now.setDate(now.getDate() - 1);
  const day = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate());
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 13, 20);
  window.ribbonNow = at.toISOString();
  for (const title of ["보고서 마무리", "장보기", "메일 답장"]) await window.paper.act({ type: "add", title });
  const state = await window.paper.getState();
  const id = (title) => state.items.find((item) => item.title === title).id;
  await window.paper.act({ type: "setRange", id: id("보고서 마무리"), start: 840, end: 930 });
  await window.paper.act({ type: "setRange", id: id("장보기"), start: 1020 });
  await window.paper.act({ type: "setRange", id: id("메일 답장"), start: 870, end: 900 });
  await window.paper.calendarWrite({ kind: "create", draft: { title: "치과", date: day, allDay: false, startMinutes: 1110, endMinutes: 1170, repeat: "none", color: "blue", days: 1 } }).catch((error) => console.log(error));
  await window.paper.act({ type: "setPref", key: "calendarStrip", value: true });
  await window.paper.act({ type: "setPref", key: "dayOpen", value: day });
  window.dispatchEvent(new Event("ribbon-now"));
  return true;
})()`);
await sleep(1200);
const setup = await evaluate(note, `(() => {
  const block = [...document.querySelectorAll(".tt-block")].find((element) => element.textContent.includes(${JSON.stringify(process.env.PROBE_TITLE ?? "보고서 마무리")}));
  if (!block) return null;
  const grid = document.querySelector(".tt-grid"), scroller = document.querySelector(".tt-scroll");
  scroller.scrollTop = ${process.env.PROBE_SCROLL ?? 250};
  const r = block.getBoundingClientRect();
  window.__probe = { frames: [], pointer: null, mutations: 0, rebuilt: 0, id: block.dataset.id };
  window.addEventListener("pointermove", (event) => { window.__probe.pointer = event.clientY; window.__probe.buttons = event.buttons; }, true);
  window.addEventListener("pointerdown", (event) => { window.__probe.down = (event.target.className || event.target.tagName) + " @" + event.clientY; }, true);
  window.__probe.touched = {};
  new MutationObserver((list) => { for (const m of list) { window.__probe.mutations += 1; if (window.__probe.down) { const name = (m.target.className || m.target.nodeName || "text").toString().split(" ").slice(0, 2).join("."); window.__probe.touched[name] = (window.__probe.touched[name] ?? 0) + 1; } if (m.type === "childList" && m.target === grid) window.__probe.rebuilt += 1; } })
    .observe(document.querySelector(".strip"), { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "class"] });
  return { x: r.left + r.width / 2, top: r.top, bottom: r.bottom, height: r.height, scrollTop: scroller.scrollTop, gridTop: grid.getBoundingClientRect().top };
})()`);
if (!setup) { console.error("no block"); process.exit(1); }
await sleep(300);
const startY = mode === "top" ? setup.top + 2 : mode === "bottom" ? setup.bottom - 2 : setup.top + setup.height / 2;
const x = mode === "move" ? setup.x : setup.x;
// Start recording (per frame: the block's top and bottom in the grid, the last pointer y, the scroll).
await evaluate(note, `(() => {
  const p = window.__probe;
  const loop = () => {
    const block = document.querySelector('.tt-block[data-id="' + p.id + '"]');
    const grid = document.querySelector(".tt-grid"), scroller = document.querySelector(".tt-scroll");
    if (block && grid) { const r = block.getBoundingClientRect(), g = grid.getBoundingClientRect(); p.frames.push({ t: performance.now(), down: Boolean(p.down), top: r.top - g.top, bottom: r.bottom - g.top, pointer: p.pointer === null ? null : p.pointer - g.top, scroll: scroller.scrollTop, label: block.querySelector(".tb-drag, .tb-time")?.textContent ?? "" }); }
    if (!p.stop) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  return true;
})()`);
await note.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y: startY, buttons: 0 });
await sleep(50);
if (mode === "keys") {
  const keys = (process.env.PROBE_KEYS ?? "ArrowDown").split(" ");
  await evaluate(note, `document.querySelector(".tt-scroll").focus()`);
  for (const key of keys) {
    const [name, ...mods] = key.split("+").reverse();
    const modifiers = (mods.includes("Alt") ? 1 : 0) | (mods.includes("Shift") ? 8 : 0);
    await note.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: name, code: name, windowsVirtualKeyCode: name === "ArrowDown" ? 40 : 38, modifiers });
    await note.send("Input.dispatchKeyEvent", { type: "keyUp", key: name, code: name, windowsVirtualKeyCode: name === "ArrowDown" ? 40 : 38, modifiers });
    await sleep(250);
  }
  await sleep(600);
  console.log(JSON.stringify(await evaluate(note, `(async () => { const state = await window.paper.getState(); return { picked: document.querySelector(".tt-block.picked")?.textContent, toast: document.querySelector(".toast")?.textContent ?? null,
    items: state.items.filter((item) => item.timeStart).map((item) => item.title + " " + item.timeStart + "-" + (item.timeEnd ?? "")), events: (state.events ?? []).map((event) => event.title + " " + event.start + "-" + event.end) }; })()`)));
  child.kill("SIGKILL"); process.exit(0);
}
// The path: segments of pointer travel in px ("60,-60,30"), 1 px a move, a move every 4 ms (a few per frame);
// "hold=600" waits with the button down at the end; "esc" presses Esc before letting go.
const segments = dyText.split(",").filter((part) => /^-?\d+$/.test(part)).map(Number);
const hold = Number(/hold=(\d+)/.exec(dyText)?.[1] ?? 0);
const escape = dyText.includes("esc");
const step = Number(stepText);
await evaluate(note, `(() => { const p = window.__probe; window.addEventListener("pointerdown", () => { p.down = true; }, true); window.addEventListener("pointerup", () => { p.down = false; }, true); return true; })()`);
await note.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y: startY, button: "left", buttons: 1, clickCount: 1 });
let y = startY;
for (const segment of segments) {
  const direction = Math.sign(segment);
  for (let moved = step; moved <= Math.abs(segment); moved += step) {
    y += direction * step;
    await note.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
    await sleep(4);
  }
}
await sleep(300 + hold);
const before = await evaluate(note, `(() => { const p = window.__probe; return { touched: p.touched, mutations: p.mutations, gridChildChanges: p.rebuilt, ghost: Boolean(document.querySelector(".tt-ghost")), label: document.querySelector(".tb-drag")?.textContent ?? null }; })()`);
if (escape) { await note.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await note.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(50); }
await note.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
await sleep(900);
const stored = await evaluate(note, `(async () => { const state = await window.paper.getState(); return { items: state.items.filter((item) => item.timeStart).map((item) => item.title + " " + item.timeStart + "-" + (item.timeEnd ?? "")), events: (state.events ?? []).map((event) => event.title + " " + event.start + "-" + event.end) }; })()`);
console.error("stored:", JSON.stringify(stored));
const result = await evaluate(note, `(() => { const p = window.__probe; p.stop = true; const block = document.querySelector('.tt-block[data-id="' + p.id + '"]'); return { frames: p.frames, duringDrag: ${JSON.stringify(before)}, after: block?.querySelector(".tb-time")?.textContent ?? null, toast: document.querySelector(".toast")?.textContent ?? null }; })()`);
result.setup = { ...setup, startY, path: dyText, step, mode };
fs.writeFileSync(outFile, JSON.stringify(result, null, 1));

// Analysis, over the frames while the button was down and the drag had begun (3 px): the block's edge against
// where the pointer says it should be (its grab offset kept, the scroll counted), and any frame where it went
// the other way from the pointer.
const edgeKey = mode === "bottom" ? "bottom" : "top";
const pressedEdge = (mode === "bottom" ? setup.bottom : setup.top) - setup.gridTop;
const startGrid = startY - setup.gridTop;
const frames = result.frames.filter((frame) => frame.down && frame.pointer !== null && Math.abs(frame.pointer - startGrid) >= 3);
let backward = 0, maxJump = 0, maxLag = 0, within1 = 0, prev;
const lags = [];
for (const frame of frames) {
  const expected = pressedEdge + (frame.pointer - startGrid);
  const lag = Math.abs(frame[edgeKey] - expected);
  lags.push(lag);
  maxLag = Math.max(maxLag, lag);
  if (lag <= 1) within1 += 1;
  if (prev) {
    const pointerMove = frame.pointer - prev.pointer, blockMove = frame[edgeKey] - prev[edgeKey];
    if (Math.abs(blockMove) > 0.5 && Math.sign(blockMove) !== Math.sign(pointerMove) && frame.scroll === prev.scroll) backward += 1;
    maxJump = Math.max(maxJump, Math.abs(blockMove));
  }
  prev = frame;
}
const gaps = frames.slice(1).map((frame, index) => frame.t - frames[index].t).sort((a, b) => a - b);
const scrolled = frames.length ? frames.at(-1).scroll - frames[0].scroll : 0;
console.log(JSON.stringify({ mode, path: dyText, dragFrames: frames.length, frameMs: gaps.length ? { median: +gaps[Math.floor(gaps.length / 2)].toFixed(1), max: +gaps.at(-1).toFixed(1) } : null,
  backward, maxStepPx: +maxJump.toFixed(2), maxLagPx: +maxLag.toFixed(2), framesWithin1px: `${within1}/${frames.length}`, scrolled,
  duringDrag: result.duringDrag, after: result.after, toast: result.toast }));
note.close();
child.kill("SIGKILL");
process.exit(0);
