import { BrowserWindow, ipcMain, screen, shell } from "electron";
import path from "node:path";
import { askLevels, draggedSlip, widgetPressWhileUp, type AskedUp } from "../core/slipMove";
import type { ConfirmQuestion } from "../renderer/confirm";
import { offscreen, offscreenEnabled } from "./env";
import { followSlip, slipWindowOptions } from "./slipWindow";

export type { ConfirmQuestion };

/**
 * The app's questions on a slip (the 쪽지 family's confirm), in a small window over the window that
 * asked (or the middle of the screen). Resolves with the index of the answer; closing the window some
 * other way is the cancel answer. File pickers stay the system's.
 *
 * #229: while a question waits, the app's other pages take no clicks or keys (renderer/askGuard.ts, told by `asking`); a
 * press on one brings the question forward, shakes it once (its tape blinks under Reduce Motion) and beeps once.
 * #228: its paper drags the window, the slip's head kept on the display with the pointer (core/slipMove.ts).
 * #253: the desktop calendar widgets and their day sheet aren't held (core/slipMove.ts `widgetPressWhileUp`): every page is
 * told what is up (`asking`: on, and whether the question replaces the whole list); while a widget floats on top or the
 * day sheet is up, the question floats over them (`floats`, askLevels).
 */
export class SlipConfirm {
  private window?: BrowserWindow;
  private loaded = false;
  private pending?: { question: ConfirmQuestion; resolve: (index: number) => void };
  private drag?: { x: number; y: number; bounds: Electron.Rectangle };
  /** How many presses a question held up (the snapshot run's check). */
  nudges = 0;
  /** #253: the waiting question floats over a widget kept on top or the day sheet (askLevels). */
  floating = false;

  /**
   * `asking`: tells every page whether a question waits now and whether it replaces the whole list. `floats`: a window of
   * the app's is always on top now (a widget kept on top, the day sheet) — the question goes over it.
   */
  constructor(private readonly rendererDirectory: string, private readonly asking: (on: boolean, replacesList: boolean) => void = () => undefined,
    private readonly floats: () => boolean = () => false) {
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
      this.asking(true, question.replacesList === true);
      this.bringForward(window);
    });
  }

  /** #253: what is up now (widget-ask-cases.json `up`). */
  get up(): AskedUp {
    return this.pending ? (this.pending.question.replacesList ? "replacesList" : "question") : "none";
  }

  /** #253: the window the waiting question was asked over (a press that opens it nudges the question). */
  get over(): BrowserWindow | undefined {
    const parent = this.pending && this.window && !this.window.isDestroyed() ? this.window.getParentWindow() : null;
    return parent && !parent.isDestroyed() ? parent : undefined;
  }

  /**
   * #229: a press a waiting question held up — the question comes forward, shakes once and the system beeps once.
   * #253: `focus` false (a press on the day sheet, which goes away when it loses the keys): it comes forward without them.
   */
  nudge(focus = true): void {
    const window = this.window;
    if (!this.pending || !window || window.isDestroyed()) return;
    this.nudges += 1;
    if (focus) this.bringForward(window); else this.raise();
    window.webContents.send("confirm:nudge");
    // (Off-screen check runs count it and stay quiet.)
    if (!offscreenEnabled) shell.beep();
  }

  /**
   * #253: the question stays over everything of the app's while it waits — over a widget kept on top and the day sheet
   * too (askLevels), without taking the keys; with nothing floating it is an ordinary window over the one it asked over.
   */
  raise(): void {
    const window = this.window;
    if (!this.pending || !window || window.isDestroyed()) return;
    this.floating = this.floats();
    if (!window.isVisible()) window.showInactive();
    // An off-screen run keeps only the word (the snapshot run's check reads it) and never re-levels or orders the
    // question about: the person's app stays in front.
    if (offscreenEnabled) return;
    if (this.floating) window.setAlwaysOnTop(true, askLevels.question.level, askLevels.question.relative);
    else if (window.isAlwaysOnTop()) window.setAlwaysOnTop(false);
    if (this.floating) window.moveTop();
  }

  /**
   * #253: a widget's line opened `opened` (the note, the desk) while the question waits: the window came forward and the
   * question stays over it — or, when it is the window the question was asked over, the question nudges (as #229).
   */
  cameForward(opened: BrowserWindow | undefined): void {
    const outcome = widgetPressWhileUp("open", this.up, opened !== undefined && opened === this.over);
    if (outcome === "nudge") this.nudge();
    else if (outcome === "front") this.raise();
  }

  /**
   * #228: the paper dragged from the question's own page: from where the pointer was at the start, the window follows it,
   * the slip's head kept inside the work area of the display with the pointer (none off every display: as dragged).
   */
  dragSlip(sender: Electron.WebContents, phase: "start" | "move" | "end", x: number, y: number): void {
    const window = this.window;
    if (!window || window.isDestroyed() || sender !== window.webContents) return;
    if (phase === "start") { this.drag = { x, y, bounds: window.getBounds() }; return; }
    const drag = this.drag;
    // (The last move put it where it is.)
    if (phase === "end") { this.drag = undefined; return; }
    if (!drag) return;
    const { bounds } = drag;
    // The slip is the window less its stage (slip.css `.slip-stage`: 16 above, 24 at the sides, 30 below).
    const slip = { x: bounds.x + 24, y: bounds.y + 16, width: bounds.width - 48, height: bounds.height - 46 };
    // (An off-screen run's slip lives away from every display: nothing to keep it on.)
    const display = offscreenEnabled ? undefined : screen.getAllDisplays().find(({ bounds: area }) => x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height);
    const to = draggedSlip(slip, x - drag.x, y - drag.y, display?.workArea);
    window.setPosition(Math.round(to.x - 24), Math.round(to.y - 16));
  }

  /** Shown and given the keys — but never brought to the front in an off-screen run (the person's app stays in front). */
  private bringForward(window: BrowserWindow): void {
    if (offscreenEnabled) { window.showInactive(); this.raise(); return; }
    window.show();
    window.focus();
    this.raise();
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
    if (this.pending) this.asking(false, false);
    this.pending = undefined;
    this.drag = undefined;
    this.putAway();
  }

  private finish(index: number): void {
    const pending = this.pending;
    this.pending = undefined;
    this.drag = undefined;
    if (pending) this.asking(false, false);
    this.putAway();
    pending?.resolve(index);
  }

  /** Hidden, and no longer floating (the next question floats only if something is on top then). */
  private putAway(): void {
    this.floating = false;
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (!offscreenEnabled && window.isAlwaysOnTop()) window.setAlwaysOnTop(false);
    window.hide();
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
