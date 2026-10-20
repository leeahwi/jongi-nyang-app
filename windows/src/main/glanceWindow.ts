import { BrowserWindow, ipcMain, screen, type Rectangle } from "electron";
import path from "node:path";
import { glanceOrigin } from "../core/glance";
import { t } from "../i18n";
import { offscreen, offscreenEnabled } from "./env";

/**
 * 오늘 창: a click on the tray icon opens today at a glance — the next event, the timer and the next
 * alarm, today's tasks with checkboxes, the input line and a few links — in a frameless paper window
 * against the taskbar, lined up with the icon (see glanceOrigin). It goes away when it loses the
 * focus or on Esc; the tray's right-click menu is unchanged. The page reports its size
 * ("glance:size"), the window follows it and stays against the taskbar.
 */
export class GlanceWindow {
  private window?: BrowserWindow;
  private loaded = false;
  private anchor?: Rectangle;
  /** The window's size as the page last asked for it (the slip, its shadow and the room around it). */
  private size = { width: 368, height: 420 };
  /** When it was last hidden: a click on the icon that took the focus away shouldn't open it again at once. */
  private hiddenAt = 0;

  constructor(private readonly rendererDirectory: string, private readonly live: boolean) {
    const fromPage = (event: Electron.IpcMainEvent) => this.window !== undefined && !this.window.isDestroyed() && event.sender === this.window.webContents;
    ipcMain.on("glance:close", (event) => { if (fromPage(event)) this.hide(); });
    ipcMain.on("glance:size", (event, size: unknown) => {
      if (!fromPage(event)) return;
      const value = size as { width?: unknown; height?: unknown };
      if (typeof value?.width !== "number" || typeof value?.height !== "number") return;
      this.size = { width: Math.min(Math.max(Math.ceil(value.width), 200), 600), height: Math.min(Math.max(Math.ceil(value.height), 120), 1000) };
      this.place();
    });
  }

  get isVisible(): boolean { return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible()); }

  /** The icon was clicked: open (next to `anchor`, the icon's place on the screen), or close when it is up. */
  toggle(anchor?: Rectangle): void {
    if (this.isVisible) return this.hide();
    if (Date.now() - this.hiddenAt < 250) return; // the same click took the focus from it
    this.open(anchor);
  }

  open(anchor?: Rectangle): void {
    this.anchor = anchor && anchor.width > 0 ? anchor : undefined;
    const window = this.ensureWindow();
    this.place();
    const show = () => {
      window.webContents.send("glance:open");
      window.show();
      window.setAlwaysOnTop(true, "pop-up-menu");
      window.focus();
      window.webContents.focus();
    };
    if (this.loaded) show(); else window.webContents.once("did-finish-load", show);
  }

  hide(): void {
    if (!this.isVisible) return;
    this.hiddenAt = Date.now();
    this.window!.hide();
  }

  /** Snapshots: shown off-screen, without the focus, against a bottom-right taskbar. */
  async showForSnapshot(): Promise<BrowserWindow> {
    const window = this.ensureWindow();
    this.anchor = undefined;
    if (!this.loaded) await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));
    window.webContents.send("glance:open");
    this.place();
    window.showInactive();
    return window;
  }

  get snapshotWindow(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  /** Against the taskbar on the icon's display (the cursor's when the icon's place isn't known). */
  private place(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (offscreenEnabled) {
      window.setBounds({ x: offscreen.x + 300, y: offscreen.y + 300, ...this.size });
      return;
    }
    const point = this.anchor ? { x: this.anchor.x + this.anchor.width / 2, y: this.anchor.y + this.anchor.height / 2 } : screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const origin = glanceOrigin(this.anchor, display.bounds, display.workArea, this.size);
    window.setBounds({ ...origin, ...this.size });
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow({
      ...this.size, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, backgroundColor: "#00000000", title: t("오늘 창"),
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, backgroundThrottling: !offscreenEnabled },
    });
    window.setVisibleOnAllWorkspaces(true);
    this.loaded = false;
    window.webContents.once("did-finish-load", () => { this.loaded = true; });
    window.loadFile(path.join(this.rendererDirectory, "glance.html"));
    window.on("blur", () => { if (this.live) this.hide(); });
    window.on("closed", () => { if (this.window === window) this.window = undefined; });
    this.window = window;
    return window;
  }
}
