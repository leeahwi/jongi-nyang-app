import { app, screen, type BrowserWindow, type Rectangle } from "electron";
import { awayBounds, nearDisplay } from "../core/offscreen";
import { offscreen } from "./env";

/**
 * Off-screen runs (#92: snapshots, perf, the drag probe): every window's place and size go through one door. A resize
 * or a move is one native setBounds that carries the off-screen x and y with the size, so no step leaves a window at
 * a place the system picked; the result is checked, and before every show too. A window that is anywhere near a
 * display (core/offscreen.ts) is put straight back at the run's home and the run says so. The #92 watch
 * (tools/offscreen-watch.swift) stays as the backstop that stops the run.
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

function keepAway(window: BrowserWindow): void {
  const native = { setBounds: window.setBounds.bind(window), show: window.show.bind(window), showInactive: window.showInactive.bind(window) };
  const check = (why: string) => {
    if (window.isDestroyed()) return;
    const now = window.getBounds();
    if (!nearDisplay(now, displays())) return;
    console.log(`offscreen guard: "${window.getTitle()}" was at ${now.x} ${now.y} ${now.width}×${now.height} (${why}), put back`);
    native.setBounds({ ...home, width: now.width, height: now.height });
  };
  const place = (bounds: Partial<Rectangle>, why: string) => {
    if (window.isDestroyed()) return;
    native.setBounds(awayBounds({ ...window.getBounds(), ...bounds }, displays(), home));
    check(why);
  };
  window.setBounds = (bounds: Partial<Rectangle>) => place(bounds, "setBounds");
  window.setPosition = (x: number, y: number) => place({ x, y }, "setPosition");
  window.setSize = (width: number, height: number) => place({ width, height }, "setSize");
  window.setContentSize = (width: number, height: number) => {
    // The frame around the content (none for the frameless windows) stays as it is.
    const [contentWidth, contentHeight] = window.getContentSize();
    const now = window.getBounds();
    place({ width: now.width + width - contentWidth, height: now.height + height - contentHeight }, "setContentSize");
  };
  window.center = () => place({}, "center");
  window.show = () => { place({}, "show"); native.show(); check("show"); };
  window.showInactive = () => { place({}, "showInactive"); native.showInactive(); check("showInactive"); };
  // Moved or resized by the system (a display change, macOS pulling a window back): back at once.
  window.on("move", () => check("moved"));
  window.on("resize", () => check("resized"));
  // Made where the system put it (a window made without a place is centred on a display): away before anything else.
  place({}, "made");
}
