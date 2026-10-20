import { BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import type { ConfirmQuestion } from "../renderer/confirm";
import { offscreen } from "./env";
import { followSlip, slipWindowOptions } from "./slipWindow";

export type { ConfirmQuestion };

/**
 * The app's questions on a slip (the 쪽지 family's confirm), in a small window over the window that
 * asked (or the middle of the screen), modal to it. Resolves with the index of the answer; closing
 * the window some other way is the cancel answer. File pickers stay the system's.
 */
export class SlipConfirm {
  private window?: BrowserWindow;
  private loaded = false;
  private pending?: { question: ConfirmQuestion; resolve: (index: number) => void };

  constructor(private readonly rendererDirectory: string) {
    const fromSlip = (event: Electron.IpcMainEvent) => this.window !== undefined && !this.window.isDestroyed() && event.sender === this.window.webContents;
    ipcMain.on("confirm:ready", (event) => {
      if (!fromSlip(event)) return;
      this.loaded = true;
      if (this.pending) this.window!.webContents.send("confirm:show", this.pending.question);
    });
    ipcMain.on("confirm:answer", (event, index: unknown) => {
      if (!fromSlip(event)) return;
      this.finish(typeof index === "number" ? index : this.pending?.question.cancelId ?? 0);
    });
  }

  /** Asks `question` over `parent`; a question already up is answered with its cancel first. */
  ask(parent: BrowserWindow | undefined, question: ConfirmQuestion): Promise<number> {
    if (this.pending) this.finish(this.pending.question.cancelId);
    return new Promise((resolve) => {
      this.pending = { question, resolve };
      const window = this.ensureWindow(parent);
      this.place(window, parent);
      if (this.loaded) window.webContents.send("confirm:show", question);
      window.show();
      window.focus();
    });
  }

  /** Snapshots: the question off-screen, not answered (`answer` puts it away). */
  async showForSnapshot(question: ConfirmQuestion): Promise<void> {
    const window = this.ensureWindow(undefined);
    this.pending = { question, resolve: () => undefined };
    const [width, height] = window.getSize();
    window.setBounds({ x: offscreen.x + 200, y: offscreen.y + 200, width, height });
    window.showInactive();
    if (!this.loaded) await new Promise<void>((resolve) => { const wait = () => (this.loaded ? resolve() : setTimeout(wait, 50)); wait(); });
    window.webContents.send("confirm:show", question);
  }

  get snapshotWindow(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  capture(): Promise<Electron.NativeImage> | undefined {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) return undefined;
    return this.window.webContents.capturePage();
  }

  hide(): void {
    this.pending = undefined;
    if (this.window && !this.window.isDestroyed()) this.window.hide();
  }

  private finish(index: number): void {
    const pending = this.pending;
    this.pending = undefined;
    if (this.window && !this.window.isDestroyed()) this.window.hide();
    pending?.resolve(index);
  }

  private place(window: BrowserWindow, parent: BrowserWindow | undefined): void {
    const [width, height] = window.getSize();
    const over = parent && !parent.isDestroyed() && parent.isVisible() ? parent.getBounds() : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const area = screen.getDisplayMatching(over).workArea;
    const x = Math.min(Math.max(over.x + (over.width - width) / 2, area.x), area.x + area.width - width);
    const y = Math.min(Math.max(over.y + Math.min(120, (over.height - height) / 2), area.y), area.y + area.height - height);
    window.setBounds({ x: Math.round(x + offscreen.x), y: Math.round(y + offscreen.y), width, height });
  }

  private ensureWindow(parent: BrowserWindow | undefined): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      if (parent && !parent.isDestroyed() && this.window.getParentWindow() !== parent) this.window.setParentWindow(parent);
      return this.window;
    }
    const window = new BrowserWindow(slipWindowOptions({ width: 420 + 48, height: 260 }, "", { alwaysOnTop: false, ...(parent && !parent.isDestroyed() ? { parent } : {}) }));
    followSlip(window);
    this.loaded = false;
    window.loadFile(path.join(this.rendererDirectory, "confirm.html"));
    window.on("close", (event) => {
      // Alt+F4: the cancel answer, and the window stays for the next question.
      if (!this.pending) return;
      event.preventDefault();
      this.finish(this.pending.question.cancelId);
    });
    window.on("closed", () => { if (this.window === window) { this.window = undefined; this.loaded = false; } });
    this.window = window;
    return window;
  }
}
