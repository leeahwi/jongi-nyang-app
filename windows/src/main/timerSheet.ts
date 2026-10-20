import { BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { followSlip, slipWindowOptions } from "./slipWindow";
import { maxTimerMinutes } from "../core/duration";
import { t } from "../i18n";
import { offscreen } from "./env";

/** The S slip (320 wide) and the room around it for the tape and the shadow; the height follows the slip. */
const shadowRoom = 16;
const size = { width: 320 + 48, height: 250 };

/**
 * 직접 정하기…: a small paper sheet near the pointer with one field for the timer's length ("40",
 * "1:30", "1시간 30분"…), what it understood under it, and 취소 · 시작. Return starts, Esc or
 * clicking elsewhere closes. Opened from every timer menu.
 */
export class TimerSheet {
  private window?: BrowserWindow;
  private loaded = false;
  private waiting?: { text: string };
  /** What this opening's length starts (집중 on a task), instead of a timer. */
  private starting?: (minutes: number) => void;

  constructor(private readonly rendererDirectory: string, private readonly live: boolean, private readonly start: (minutes: number) => void) {
    const fromSheet = (event: Electron.IpcMainEvent) => this.window !== undefined && !this.window.isDestroyed() && event.sender === this.window.webContents;
    ipcMain.on("timerSheet:close", (event) => { if (fromSheet(event)) this.hide(); });
    ipcMain.on("timerSheet:start", (event, minutes: unknown) => {
      if (!fromSheet(event)) return;
      const value = Number(minutes);
      const start = this.starting ?? this.start;
      this.hide();
      if (Number.isInteger(value) && value >= 1 && value <= maxTimerMinutes) start(value);
    });
  }

  /**
   * Just below and beside the pointer (where the menu was), kept on its display, taking focus.
   * `start`: what its length starts this time (집중 on a task); a timer otherwise.
   */
  open(start?: (minutes: number) => void): void {
    this.starting = start;
    const window = this.ensureWindow();
    const [width, height] = window.getSize();
    const size = { width, height };
    const cursor = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(cursor).workArea;
    const x = Math.min(Math.max(cursor.x - size.width / 2, area.x), area.x + area.width - size.width);
    const y = Math.min(Math.max(cursor.y - shadowRoom - 12, area.y), area.y + area.height - size.height);
    window.setBounds({ x: Math.round(x + offscreen.x), y: Math.round(y + offscreen.y), ...size });
    this.send({ text: "" });
    window.show();
    window.setAlwaysOnTop(true, "pop-up-menu");
    window.moveTop();
    window.focus();
    window.webContents.focus();
  }

  hide(): void {
    this.starting = undefined;
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide();
  }

  /** Snapshots: the sheet off-screen, not focused, with `text` typed in. */
  async showForSnapshot(text: string): Promise<void> {
    const window = this.ensureWindow();
    const [width, height] = window.getSize();
    window.setBounds({ x: offscreen.x + 200, y: offscreen.y + 200, width, height });
    window.showInactive();
    if (!this.loaded) await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));
    this.send({ text });
  }

  capture(): Promise<Electron.NativeImage> | undefined {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) return undefined;
    return this.window.webContents.capturePage();
  }

  /** Snapshots: the window, to check its layout. */
  get snapshotWindow(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  private send(payload: { text: string }): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (this.loaded) window.webContents.send("timerSheet:open", payload);
    else this.waiting = payload;
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow(slipWindowOptions(size, t("타이머 직접 정하기")));
    followSlip(window);
    window.setVisibleOnAllWorkspaces(true);
    this.loaded = false;
    window.webContents.once("did-finish-load", () => {
      this.loaded = true;
      const payload = this.waiting;
      this.waiting = undefined;
      if (payload && !window.isDestroyed()) window.webContents.send("timerSheet:open", payload);
    });
    window.loadFile(path.join(this.rendererDirectory, "timerSheet.html"));
    window.on("blur", () => { if (this.live) this.hide(); });
    window.on("closed", () => { if (this.window === window) this.window = undefined; });
    this.window = window;
    return window;
  }
}
