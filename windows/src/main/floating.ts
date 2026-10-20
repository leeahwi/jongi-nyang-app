import { BrowserWindow, Menu, ipcMain, screen, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import { iconOrigin, type Point } from "../core/placement";
import { t } from "../i18n";
import { offscreen } from "./env";
import type { Store } from "./store";

const size = { width: 110, height: 130 };
const padding = 12;

/** The folded note: a small post-it the cat peeks over, showing what is left. Click to unfold, drag to move. */
export class FloatingNote {
  private window?: BrowserWindow;
  private dragStart?: { cursor: Point; origin: Point };

  constructor(private readonly store: Store, private readonly rendererDirectory: string, private readonly onRestore: () => void, private readonly onQuit: () => void) {
    const fromIcon = (event: Electron.IpcMainEvent) => event.sender === this.window?.webContents;
    ipcMain.on("floating:drag-start", (event) => {
      if (!fromIcon(event) || !this.window) return;
      const [x, y] = this.window.getPosition();
      this.dragStart = { cursor: screen.getCursorScreenPoint(), origin: { x, y } };
    });
    ipcMain.on("floating:drag", (event) => {
      if (!fromIcon(event) || !this.window || !this.dragStart) return;
      const cursor = screen.getCursorScreenPoint();
      this.window.setPosition(Math.round(this.dragStart.origin.x + cursor.x - this.dragStart.cursor.x),
        Math.round(this.dragStart.origin.y + cursor.y - this.dragStart.cursor.y));
    });
    ipcMain.on("floating:drag-end", (event) => {
      if (!fromIcon(event) || !this.window) return;
      this.dragStart = undefined;
      const [x, y] = this.window.getPosition();
      const center = { x: x + size.width / 2, y: y + size.height / 2 };
      const origin = iconOrigin(center, size, screen.getAllDisplays().map((display) => display.workArea), padding);
      this.window.setPosition(Math.round(origin.x), Math.round(origin.y));
      store.remember({ floatingOrigin: origin });
    });
    ipcMain.on("floating:click", (event) => { if (fromIcon(event)) this.onRestore(); });
    ipcMain.on("floating:menu", (event) => {
      if (!fromIcon(event) || !this.window) return;
      Menu.buildFromTemplate(this.menuTemplate()).popup({ window: this.window });
    });
    store.on("change", () => this.sendSummary());
  }

  /** The folded icon's right-click menu (also listed by the snapshots). */
  menuTemplate(): MenuItemConstructorOptions[] {
    return [
      { label: t("노트 열기"), click: () => this.onRestore() },
      { label: t("아이콘 숨기기"), click: () => this.hide() },
      { type: "separator" },
      { label: t("종이냥 종료"), click: () => this.onQuit() },
    ];
  }

  get isVisible(): boolean { return this.window?.isVisible() === true; }

  /** Current centre in screen coordinates, including after the person dragged it. */
  get center(): Point | undefined {
    if (!this.window || !this.window.isVisible()) return undefined;
    const [x, y] = this.window.getPosition();
    return { x: x - offscreen.x + size.width / 2, y: y - offscreen.y + size.height / 2 };
  }

  show(anchor: Point): void {
    const window = this.ensureWindow();
    const origin = iconOrigin(anchor, size, screen.getAllDisplays().map((display) => display.workArea), padding);
    window.setBounds({ x: Math.round(origin.x + offscreen.x), y: Math.round(origin.y + offscreen.y), ...size });
    this.sendSummary();
    window.showInactive();
    window.setAlwaysOnTop(true, "floating");
  }

  hide(): void {
    this.window?.hide();
  }

  capture(): Promise<Electron.NativeImage> | undefined {
    return this.window?.webContents.capturePage();
  }

  private sendSummary(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const today = this.store.todayItems;
    const open = today.filter((item) => !item.isCompleted);
    this.window.webContents.send("floating:summary", {
      titles: open.map((item) => item.title),
      remaining: open.length,
      total: today.length,
    });
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow({
      ...size, show: false, frame: false, transparent: true, resizable: false, maximizable: false,
      minimizable: false, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      backgroundColor: "#00000000",
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true },
    });
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.loadFile(path.join(this.rendererDirectory, "floating.html"));
    window.webContents.on("did-finish-load", () => this.sendSummary());
    this.window = window;
    return window;
  }
}
