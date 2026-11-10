import { BrowserWindow, ipcMain, screen, type IpcMainEvent } from "electron";
import path from "node:path";
import { EarsSizeCheck, earsBounds, earsShow, workAreaUnder } from "../core/noteEars";
import { t } from "../i18n";
import { offscreenEnabled } from "./env";

/**
 * 노트 창 위의 고양이 귀 (#151): the drawer's two ears standing on the note's top edge (core/noteEars.ts). The note is
 * a window and can't draw above its own frame, so the ears are a small frameless, clear window owned by it (its parent):
 * Windows keeps it above the note, takes it along to other desktops and hides it while the note is minimised. On every
 * move, resize, show, hide, minimise, restore, full screen, 항상 위에 두기 and display change its place, its level and
 * whether it shows are worked out again — hidden while the note is hidden (in the tray), folded into the post-it,
 * minimised, in full screen, or against the top of its screen with no room above. It never takes the keyboard (not
 * focusable, never in the taskbar) and lets the mouse through except over an ear.
 *
 * #312: after each placing its size is read back. On a Windows PC it was seen opaque and nearly three times as tall, a
 * grey box over the note's buttons; so it shows only at the size asked for (core/noteEars.ts `EarsSizeCheck`), is
 * placed again whenever Windows itself resizes it, and after three wrong sizes in a row the ears stay off until the
 * displays change.
 *
 * On a Mac (development and check runs only) Electron put the ears' window on the screen when it showed it as a child of
 * the off-screen note — twice, at the same spot, until the #92 watch stopped the run (2026-10-30). So there it has no
 * owner (it follows the note by the events above), and off-screen runs (perf; snapshots never show it) leave it out.
 */
const mac = process.platform === "darwin";

export class NoteEars {
  private window: BrowserWindow | undefined;
  private interactive = false;
  private readonly sizes = new EarsSizeCheck();
  private pending = false;
  private retryTimer: NodeJS.Timeout | undefined;

  constructor(private readonly note: BrowserWindow, private readonly rendererDirectory: string, private readonly snapshots: boolean) {
    const sync = () => this.sync();
    for (const name of ["move", "moved", "resize", "resized", "show", "hide", "minimize", "restore", "maximize", "unmaximize",
      "enter-full-screen", "leave-full-screen", "always-on-top-changed"] as const) {
      note.on(name as "move", sync);
    }
    note.on("closed", () => { clearTimeout(this.retryTimer); this.window?.destroy(); });
    // Another display or scale: the ears may try again even if Windows kept them the wrong size before (#312).
    const displays = () => { this.sizes.reset(); this.sync(); };
    screen.on("display-metrics-changed", displays);
    screen.on("display-added", displays);
    screen.on("display-removed", displays);
    const fromEars = (event: IpcMainEvent) => Boolean(this.window && !this.window.isDestroyed() && event.sender === this.window.webContents);
    ipcMain.on("ears:interactive", (event, value: boolean) => { if (fromEars(event)) this.setInteractive(Boolean(value)); });
    // A to-do finished on the note: the left ear twitches (the ears' page keeps it to once a second, none with
    // reduced motion).
    ipcMain.on("ears:twitch", (event) => {
      if (event.sender !== note.webContents || !this.window || this.window.isDestroyed() || !this.window.isVisible()) return;
      this.window.webContents.send("ears:twitch");
    });
  }

  /** Shows, hides or moves the ears to match the note now. */
  sync(): void {
    if (this.note.isDestroyed()) return;
    const note = this.note.getBounds();
    const area = workAreaUnder(note, screen.getAllDisplays());
    const shows = !this.snapshots && !(offscreenEnabled && mac) && !this.sizes.off && earsShow(note, area, {
      visible: this.note.isVisible(), minimized: this.note.isMinimized(), fullScreen: this.note.isFullScreen(), offscreen: offscreenEnabled,
    });
    if (!shows) {
      if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide();
      return;
    }
    const bounds = earsBounds(note);
    const window = this.ensureWindow(bounds);
    const now = window.getBounds();
    if (now.x !== bounds.x || now.y !== bounds.y || now.width !== bounds.width || now.height !== bounds.height) window.setBounds(bounds);
    // #312: only at the size asked for; otherwise hidden and placed again shortly, or left off.
    const actual = window.getBounds();
    const verdict = this.sizes.check(bounds, actual);
    if (verdict !== "show") {
      if (verdict === "off") {
        console.warn(`noteEars: Windows keeps the ears' window ${actual.width}×${actual.height} (asked ${bounds.width}×${bounds.height}); no ears until the displays change`);
        window.destroy();
      } else {
        if (window.isVisible()) window.hide();
        clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => this.sync(), 300);
      }
      return;
    }
    const onTop = this.note.isAlwaysOnTop();
    if (window.isAlwaysOnTop() !== onTop) window.setAlwaysOnTop(onTop, "floating");
    if (!window.isVisible()) window.showInactive();
  }

  private syncSoon(): void {
    if (this.pending) return;
    this.pending = true;
    setImmediate(() => { this.pending = false; this.sync(); });
  }

  private setInteractive(interactive: boolean): void {
    if (this.interactive === interactive || !this.window || this.window.isDestroyed()) return;
    this.interactive = interactive;
    this.window.setIgnoreMouseEvents(!interactive, { forward: true });
  }

  /** Made where it goes (`bounds`), and given its owner while it is still hidden. */
  private ensureWindow(bounds: Electron.Rectangle): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow({
      ...bounds, show: false, frame: false, transparent: true, hasShadow: false,
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false, focusable: false, skipTaskbar: true,
      // #312: no WS_THICKFRAME. A frameless Electron window keeps Windows' resize frame unless told otherwise, and Windows
      // then holds it to the minimum track height (about 38 px at 100 %, 56 at 150 %): the 20-high ears grew into a
      // grey box over the note's tools.
      thickFrame: false,
      backgroundColor: "#00000000", title: t("종이냥 캐릭터"),
      // Off-screen runs (#92): a window placed off every display may stay there (only macOS reads this).
      enableLargerThanScreen: offscreenEnabled || this.snapshots,
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true },
    });
    if (!mac) window.setParentWindow(this.note);
    window.setIgnoreMouseEvents(true, { forward: true });
    window.loadFile(path.join(this.rendererDirectory, "ears.html"));
    window.on("closed", () => { if (this.window === window) this.window = undefined; });
    // Windows may resize it on its own (#312): placed again after this event, not inside it.
    window.on("resize", () => this.syncSoon());
    this.window = window;
    this.interactive = false;
    return window;
  }
}

/**
 * Snapshots: a hidden window (off-screen, never shown) drawing the note's picture with its ears, or the ears alone on a
 * row of desktops (ears.html#preview).
 */
export async function earsPreview(rendererDirectory: string, payload: { image?: string; width: number; height: number; held?: boolean; strip?: string[] },
  bounds: { width: number; height: number; x: number; y: number }): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    ...bounds, show: false, frame: false, enableLargerThanScreen: true, paintWhenInitiallyHidden: true,
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  await window.loadFile(path.join(rendererDirectory, "ears.html"), { hash: "preview" });
  window.webContents.send("ears:preview", payload);
  return window;
}
