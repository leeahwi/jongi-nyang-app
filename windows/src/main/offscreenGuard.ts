import { app, screen, type BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { guardWindow } from "../core/offscreen";
import { offscreen, testHooks } from "./env";

/**
 * Off-screen runs (#92: snapshots, perf, the drag probe): every window's place and size go through one door
 * (core/offscreen.ts guardWindow). A resize or a move is one native setBounds that carries the off-screen x and y with
 * the size, so no step leaves a window at a place the system picked; the result is checked, and before every show and
 * focus too. A window that is anywhere near a display is put straight back at the run's home and the run says so. On
 * a Mac no window has an owner there, and none shows in Mission Control or App Exposé (#250). The #92 watch (tools/offscreen-watch.swift) stays as the backstop that
 * stops the run.
 *
 * Why (2026-11-03): a snapshot run on a Mac had a window titled 저장과 백업 come up partly on the screen's top-left
 * (-279, -295, 437 × 321) just after the desk was resized 820 → 920 and the note was resized; the watch stopped it.
 * Until then the app's windows and the snapshot steps each resized and placed windows their own way (setSize,
 * setContentSize, setPosition, and the desk is made without an off-screen place in a snapshot run), and every one of
 * those relied on the system leaving the window where it was.
 */
export function guardOffscreen(): void {
  app.on("browser-window-created", (_event, window) => keepAway(window));
}

const home = { x: offscreen.x + 100, y: offscreen.y + 100 };
const displays = () => screen.getAllDisplays().map((display) => display.bounds);

/**
 * #250: the run's window log (test builds, PAPERTODO_WINDOW_LOG, set by tools/offscreen-watch.mjs): each window as it is
 * made — the system's number for it (the one the watch prints), its title, place, and the page it loads — and each one
 * put back. A window the watch catches is then named, or found to be none of the app's (a menu or popup of the system's).
 */
const windowLog = testHooks ? process.env.PAPERTODO_WINDOW_LOG : undefined;
function note(line: string): void {
  if (!windowLog) return;
  try { fs.appendFileSync(windowLog, `${line}\n`); } catch { /* the log is a help, never a reason to stop */ }
}
/** The window server's number for `window` (macOS: "window:<CGWindowID>:0"). */
function number(window: BrowserWindow): string {
  try { return window.getMediaSourceId().split(":")[1] ?? "?"; } catch { return "?"; }
}
const place = (bounds: { x: number; y: number; width: number; height: number }) => `${bounds.x} ${bounds.y} ${bounds.width}×${bounds.height}`;

function keepAway(window: BrowserWindow): void {
  const made = window.getBounds();
  guardWindow(window, {
    displays, home, noOwners: process.platform === "darwin", hideFromOverviews: process.platform === "darwin",
    putBack: (now, why) => {
      console.log(`offscreen guard: "${window.getTitle()}" was at ${place(now)} (${why}), put back`);
      note(`put back ${number(window)} "${window.getTitle()}" ${place(now)} (${why})`);
    },
  });
  note(`made ${number(window)} "${window.getTitle()}" at ${place(made)} → ${place(window.getBounds())}`);
  window.webContents.on("did-finish-load", () => {
    if (!window.isDestroyed()) note(`page ${number(window)} "${window.getTitle()}" ${path.basename(window.webContents.getURL().split(/[?#]/)[0])}`);
  });
}
