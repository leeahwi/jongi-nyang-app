import { BrowserWindow, ipcMain, screen } from "electron";
import path from "node:path";
import { bubbleAbove, type Rect } from "../core/pet";
import type { PopupPayload, PopupTask } from "../core/types";
import { offscreen } from "./env";

const edgePadding = 22;
const bottomPadding = 34;

export interface PopupHandlers {
  onComplete(id: string): void;
  /** 모두 끝냄: these together (one undo step, and the note's toast). */
  onCompleteAll?(ids: string[]): void;
  onSnooze(minutes: number): void;
  /** A choice of the ⌄ menu: again at that moment. */
  onSnoozeUntil?(at: Date): void;
  /** 내일로 · 내일로 미루기: the tasks shown move to tomorrow. */
  onTomorrow?(): void;
  /** An event's 5분 전에 다시. */
  onEventAgain?(): void;
  /** 저녁 정리: 내일로 · 언젠가로 · 그대로 두기 (morning: 오늘 하기 = keep), for the tasks left ticked. */
  onSweep?(choice: "tomorrow" | "someday" | "keep", ids: string[]): void;
  onOpen(): void;
  /** An event alert's title: the 달력 window on its day (the row id is "calendar:<key>"). */
  onOpenEvent?(id: string): void;
}

/**
 * One transparent, non-activating window in the bottom-right corner. It reaches the screen
 * edge so the cat can walk in from behind it; clicks pass through everywhere except the cat
 * and the bubble, and it never takes keyboard focus from the app being used.
 */
export class ReminderPopup {
  private window?: BrowserWindow;
  private handlers?: PopupHandlers;
  private shownTasks: PopupTask[] = [];
  private visible = false;

  private static readonly instances = new Set<ReminderPopup>();

  constructor(private readonly rendererDirectory: string) {
    if (ReminderPopup.instances.size === 0) ReminderPopup.registerIPC();
    ReminderPopup.instances.add(this);
  }

  /** Both popups (periodic and per-task) share channels; each message goes to the window that sent it. */
  private static registerIPC(): void {
    const owner = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) =>
      [...ReminderPopup.instances].find((popup) => popup.window && !popup.window.isDestroyed() && popup.window.webContents === event.sender);
    ipcMain.handle("popup:place", (event, size: { width: number; height: number }) => owner(event)?.place(size));
    ipcMain.handle("popup:pointer", (event) => owner(event)?.pointer());
    ipcMain.on("popup:interactive", (event, interactive: boolean) => {
      owner(event)?.window?.setIgnoreMouseEvents(!interactive, { forward: true });
    });
    ipcMain.on("popup:complete", (event, id: string) => owner(event)?.handlers?.onComplete(id));
    ipcMain.on("popup:complete-all", (event, ids: unknown) => {
      const handlers = owner(event)?.handlers;
      if (!Array.isArray(ids)) return;
      const list = ids.filter((id): id is string => typeof id === "string");
      if (handlers?.onCompleteAll) handlers.onCompleteAll(list); else for (const id of list) handlers?.onComplete(id);
    });
    // The ⌄ menu's later moments, 내일로, and an event's 5분 전에 다시: the bubble goes, then the handler runs.
    const closing = (event: Electron.IpcMainEvent, run: (handlers: PopupHandlers) => void) => {
      const popup = owner(event);
      const handlers = popup?.handlers;
      popup?.hide();
      if (handlers) run(handlers);
    };
    ipcMain.on("popup:snooze-until", (event, at: unknown) => {
      const date = typeof at === "string" ? new Date(at) : undefined;
      if (date && !Number.isNaN(date.getTime())) closing(event, (handlers) => handlers.onSnoozeUntil?.(date));
    });
    ipcMain.on("popup:tomorrow", (event) => closing(event, (handlers) => handlers.onTomorrow?.()));
    ipcMain.on("popup:event-again", (event) => closing(event, (handlers) => handlers.onEventAgain?.()));
    ipcMain.on("popup:sweep", (event, choice: unknown, ids: unknown) => {
      if (choice !== "tomorrow" && choice !== "someday" && choice !== "keep") return;
      const list = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string") : [];
      closing(event, (handlers) => handlers.onSweep?.(choice, list));
    });
    ipcMain.on("popup:snooze", (event, minutes: number) => {
      const popup = owner(event);
      const handlers = popup?.handlers;
      popup?.hide();
      handlers?.onSnooze(minutes);
    });
    ipcMain.on("popup:open", (event) => {
      const popup = owner(event);
      const handlers = popup?.handlers;
      popup?.hide();
      handlers?.onOpen();
    });
    ipcMain.on("popup:open-event", (event, id: string) => {
      const popup = owner(event);
      const handlers = popup?.handlers;
      popup?.hide();
      handlers?.onOpenEvent?.(id);
    });
    ipcMain.on("popup:closed", (event) => owner(event)?.hide());
  }

  get isVisible(): boolean { return this.visible; }
  get taskIDs(): string[] { return this.shownTasks.map((task) => task.id); }

  /** The desktop pet's cat, when it is on screen: reminders then appear above it. */
  static petAnchor?: () => Rect | undefined;
  static onPetAlert?: () => void;
  private anchor?: Rect;

  show(payload: Omit<PopupPayload, "travel">, handlers: PopupHandlers): void {
    this.handlers = handlers;
    this.shownTasks = payload.tasks;
    this.visible = true;
    // With the pet out, no second cat walks in: a small bubble pops up above it and it hops.
    this.anchor = ReminderPopup.petAnchor?.();
    if (this.anchor) ReminderPopup.onPetAlert?.();
    const style = this.anchor ? "compact" : payload.style;
    const window = this.ensureWindow();
    const send = () => window.webContents.send("popup:show", { ...payload, style, travel: 0 });
    if (window.webContents.isLoading()) window.webContents.once("did-finish-load", send); else send();
  }

  /** Drops rows finished or deleted elsewhere; rows checked in the bubble stay struck through. */
  retain(openIDs: Set<string>): void {
    if (!this.visible) return;
    this.window?.webContents.send("popup:retain", [...openIDs]);
  }

  hide(): void {
    this.visible = false;
    this.handlers = undefined;
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send("popup:reset");
      this.window.hide();
    }
  }

  capture(): Promise<Electron.NativeImage> | undefined {
    return this.window?.webContents.capturePage();
  }

  /** Snapshots: the bubble's window, to check its layout and open its menu. */
  get snapshotWindow(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  private place(size: { width: number; height: number }): { travel: number } {
    const window = this.ensureWindow();
    const anchor = this.anchor;
    const area = anchor
      ? screen.getDisplayNearestPoint({ x: Math.round(anchor.x + anchor.width / 2), y: Math.round(anchor.y) }).workArea
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const width = Math.ceil(size.width + edgePadding);
    const height = Math.ceil(size.height);
    // Centred on the bubble itself; the window's extra right-hand room stays empty.
    const spot = anchor ? bubbleAbove(anchor, { width: Math.ceil(size.width), height }, area) : { x: area.x + area.width - width, y: area.y + area.height - height - bottomPadding };
    const x = spot.x + offscreen.x;
    const y = spot.y + offscreen.y;
    window.setBounds({ x, y, width, height });
    window.setIgnoreMouseEvents(true, { forward: true });
    window.showInactive();
    window.setAlwaysOnTop(true, "floating");
    return { travel: width + 4 };
  }

  /**
   * Where the pointer is over this window (page pixels), or nothing. A click-through window hears only the
   * pointer's moves, so a pointer that has rested on the slip since before it came is found this way.
   */
  private pointer(): { x: number; y: number } | undefined {
    const window = this.window;
    if (!window || window.isDestroyed() || !window.isVisible()) return undefined;
    const cursor = screen.getCursorScreenPoint();
    const bounds = window.getContentBounds();
    const x = cursor.x - bounds.x;
    const y = cursor.y - bounds.y;
    return x >= 0 && y >= 0 && x < bounds.width && y < bounds.height ? { x, y } : undefined;
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow({
      width: 440, height: 160, show: false, frame: false, transparent: true, resizable: false,
      movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      backgroundColor: "#00000000",
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.loadFile(path.join(this.rendererDirectory, "popup.html"));
    this.window = window;
    return window;
  }
}
