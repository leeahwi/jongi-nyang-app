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
 * Watches `child`'s windows until it exits: the first one on a screen kills it at once and calls `stopped` with the
 * window's title and bounds. Returns a function that tells whether it stopped the run.
 */
export function watchWindows(child, stopped) {
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
    stopped(`a window was on a screen, stopped (#92). ${seen.trim() || `the watch exited ${code}`}`);
  });
  child.on("exit", () => setTimeout(() => { if (watch.exitCode === null) watch.kill(); }, 100));
  return () => fired;
}
