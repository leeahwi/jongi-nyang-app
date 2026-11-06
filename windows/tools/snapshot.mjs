// Renders every window with sample data into snapshots/, off-screen, then quits; the size sweep
// goes to snapshots/sweep/ and fails the run on layout problems. `npm run snapshot -- sweep` runs only the sweep.
// `-- lang=en` or `-- lang=nl` runs in English or Dutch, into snapshots/en/ or snapshots/nl/ (Korean: snapshots/).
// On a Mac (#92), tools/offscreen-watch.swift watches Electron's windows the whole run and stops it at the first window
// on a screen: nothing of a snapshot run may show. A window the app's own guard had to put back fails the run too (#250).
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";
import { putBacks, watchWindows, windowLog } from "./offscreen-watch.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const lang = args.find((arg) => arg.startsWith("lang="))?.slice(5) ?? "ko";
if (!["ko", "en", "nl"].includes(lang)) {
  console.error(`snapshot: unknown language ${lang} (ko, en, nl)`);
  process.exit(2);
}
const only = args.find((arg) => !arg.startsWith("lang=")) ?? "";
const directory = lang === "ko" ? path.join(root, "snapshots") : path.join(root, "snapshots", lang);
const log = windowLog(`snapshot-${lang}`);
const env = { ...process.env, PAPERTODO_SNAPSHOT: directory, PAPERTODO_OFFSCREEN: "1", PAPERTODO_SNAPSHOT_ONLY: only, PAPERTODO_LANG: lang, PAPERTODO_WINDOW_LOG: log };
const timeout = 5_400_000; // a full run (every shot, then the day and night sweeps) on a busy machine

const child = spawn(electron, [root], { stdio: "inherit", env });
const stopped = watchWindows(child, (why) => console.error(`snapshot: ${why}`), log);
const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
child.on("exit", (code, signal) => {
  clearTimeout(timer);
  // The watch reports a window it saw in the last moments before it is let go.
  setTimeout(() => {
    // #250: a window the guard had to put back was near a display for a moment: the run fails too.
    const back = putBacks(log);
    if (back.length) console.error(`snapshot: the off-screen guard put ${back.length} window(s) back (#250):\n${back.join("\n")}`);
    process.exitCode = stopped() || back.length ? 1 : code ?? (signal ? 1 : 0);
  }, 150);
});
