// Runs on a Mac (#92): tools/offscreen-watch.swift watches an Electron run's windows and stops the run at the first
// window on a screen. Used by tools/snapshot.mjs and tools/perf-memo.mjs; elsewhere it does nothing.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** tools/offscreen-watch.swift, built into node_modules/.cache (again when the source is newer); exits when it can't be. */
function buildWatcher() {
  const source = path.join(root, "tools", "offscreen-watch.swift");
  const binary = path.join(root, "node_modules", ".cache", "offscreen-watch");
  const fresh = fs.existsSync(binary) && fs.statSync(binary).mtimeMs >= fs.statSync(source).mtimeMs;
  if (!fresh) {
    fs.mkdirSync(path.dirname(binary), { recursive: true });
    const built = spawnSync("swiftc", ["-O", source, "-o", binary], { stdio: "inherit" });
    if (built.status !== 0) {
      console.error("could not build tools/offscreen-watch.swift; no run without the window watch (#92)");
      process.exit(1);
    }
  }
  return binary;
}

/** Built before Electron starts, so the watch is there from its first window. */
export const watcher = process.platform === "darwin" ? buildWatcher() : undefined;

/**
 * #250: a fresh window log for one run (node_modules/.cache), to pass to Electron as PAPERTODO_WINDOW_LOG: the app
 * (main/offscreenGuard.ts) notes each window it makes with the system's number for it.
 */
export function windowLog(name) {
  const file = path.join(root, "node_modules", ".cache", `offscreen-windows-${name}-${process.pid}.log`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  return file;
}

/** What the window log says about the window the watch caught (its number is in the watch's line). */
export function whose(seen, log) {
  const number = /· window (\d+) /.exec(seen)?.[1];
  if (!number || !log) return "";
  let lines = [];
  try { lines = fs.readFileSync(log, "utf8").split("\n").filter((line) => line.split(" ")[1] === number || line.startsWith(`put back ${number} `)); } catch { /* no log */ }
  return lines.length ? `\nthe app's window log for window ${number}:\n${lines.join("\n")}`
    : `\nwindow ${number} is not in the app's window log: not a window the app made (a menu, a popup or a panel of the system's)`;
}

/**
 * The windows the app's guard had to put back during the run (`put back …` lines of the window log). A window the guard
 * finds near a display was already there for a moment, so a run passes only with none (#250).
 */
export function putBacks(log) {
  try { return fs.readFileSync(log, "utf8").split("\n").filter((line) => line.startsWith("put back ")); } catch { return []; }
}

/**
 * Watches `child`'s windows until it exits: the first one on a screen kills it at once and calls `stopped` with the
 * window's title and bounds, its owner (pid, program, working folder: which run it was, #250), every window the pid had
 * then, and what the window log (`log`, from windowLog) says about it. Returns a function that tells whether it
 * stopped the run.
 */
export function watchWindows(child, stopped, log) {
  if (!watcher) return () => false;
  const watch = spawn(watcher, [String(child.pid)], { stdio: ["ignore", "inherit", "pipe"] });
  let seen = "";
  let fired = false;
  watch.stderr.on("data", (chunk) => { seen += chunk; });
  watch.on("exit", (code, signal) => {
    // 0: Electron is gone; a signal: let go after it (the watch exits on its own within 15 ms of it).
    if (code === 0 || signal) return;
    fired = true;
    try { child.kill("SIGKILL"); } catch { /* gone */ }
    stopped(`a window was on a screen, stopped (#92). ${seen.trim() || `the watch exited ${code}`}${whose(seen, log)}`);
  });
  child.on("exit", () => setTimeout(() => { if (watch.exitCode === null) watch.kill(); }, 100));
  return () => fired;
}
