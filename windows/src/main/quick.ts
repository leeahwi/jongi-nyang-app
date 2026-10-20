import { BrowserWindow, globalShortcut, ipcMain, screen } from "electron";
import path from "node:path";
import { followSlip, slipWindowOptions } from "./slipWindow";
import { t } from "../i18n";
import { offscreen, shortcutsDisabled } from "./env";
import type { Store } from "./store";

export const quickAccelerator = "Control+Alt+N";
/** The M slip (420 wide) and the room around it for the tape and the shadow; the height follows the slip. */
const shadowRoom = 16;
const size = { width: 420 + 48, height: 190 };

/**
 * 빠른 입력: Ctrl+Alt+N anywhere opens a small paper card over everything, takes the keyboard,
 * adds one task (dates and times understood) and goes away again — the note stays where it is.
 * Esc or clicking elsewhere closes it. `live` is false in tests and snapshots, so no real
 * system-wide shortcut is taken there.
 */
export class QuickEntry {
  private window?: BrowserWindow;
  private registered = false;
  /** The page has loaded; until then the latest "open" waits (a message sent earlier would be lost). */
  private loaded = false;
  private waiting?: { text?: string };

  constructor(private readonly store: Store, private readonly rendererDirectory: string, private readonly live: boolean) {
    const fromCard = (event: Electron.IpcMainEvent) => this.window !== undefined && !this.window.isDestroyed() && event.sender === this.window.webContents;
    ipcMain.on("quick:close", (event) => { if (fromCard(event)) this.hide(); });
    store.on("prefs", (key: string) => { if (key === "quickEntry") this.updateShortcut(); });
    this.updateShortcut();
  }

  /** Takes or gives back Ctrl+Alt+N; when another app already holds it, Settings says so. */
  private updateShortcut(): void {
    if (!this.live || shortcutsDisabled) return;
    const wanted = this.store.prefs.quickEntry;
    if (wanted && !this.registered) {
      try {
        this.registered = globalShortcut.register(quickAccelerator, () => this.open());
      } catch {
        this.registered = false;
      }
    } else if (!wanted && this.registered) {
      globalShortcut.unregister(quickAccelerator);
      this.registered = false;
    }
    const problem = wanted && !this.registered ? t("다른 앱이 Ctrl+Alt+N을 쓰고 있어 켜지 못했어요. 그 앱의 단축키를 바꾸고 다시 켜 보세요.") : undefined;
    if (problem !== this.store.shortcutProblem) {
      this.store.shortcutProblem = problem;
      this.store.changed();
    }
  }

  /** Centred on the screen with the mouse, a quarter of the way down, taking focus. */
  open(): void {
    // Pressed again while it is up: put it away, like a toggle.
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) return this.hide();
    const window = this.ensureWindow();
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const [width, height] = window.getSize();
    window.setBounds({
      x: Math.round(area.x + (area.width - width) / 2 + offscreen.x),
      y: Math.round(area.y + area.height / 4 - shadowRoom + offscreen.y),
      width, height,
    });
    this.send({});
    window.show();
    window.setAlwaysOnTop(true, "pop-up-menu");
    window.moveTop();
    window.focus();
    window.webContents.focus();
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide();
  }

  /** Snapshots: the card off-screen, not focused, with `text` typed in. */
  async showForSnapshot(text: string): Promise<void> {
    const window = this.ensureWindow();
    const [width, height] = window.getSize();
    window.setBounds({ x: offscreen.x + 200, y: offscreen.y + 200, width, height });
    window.showInactive();
    if (!this.loaded) await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));
    this.send({ text });
  }

  /** Snapshots: the window, to check its layout and type into it. */
  get snapshotWindow(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  capture(): Promise<Electron.NativeImage> | undefined {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) return undefined;
    return this.window.webContents.capturePage();
  }

  dispose(): void {
    if (this.registered) globalShortcut.unregister(quickAccelerator);
    this.registered = false;
  }

  private send(payload: { text?: string }): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (this.loaded) window.webContents.send("quick:open", payload);
    else this.waiting = payload;
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow(slipWindowOptions(size, t("종이냥 빠른 입력")));
    followSlip(window);
    window.setVisibleOnAllWorkspaces(true);
    this.loaded = false;
    window.webContents.once("did-finish-load", () => {
      this.loaded = true;
      const payload = this.waiting;
      this.waiting = undefined;
      if (payload && !window.isDestroyed()) window.webContents.send("quick:open", payload);
    });
    window.loadFile(path.join(this.rendererDirectory, "quick.html"));
    // Clicking anywhere else puts it away, like a menu.
    window.on("blur", () => { if (this.live) this.hide(); });
    window.on("closed", () => { if (this.window === window) this.window = undefined; });
    this.window = window;
    return window;
  }
}
