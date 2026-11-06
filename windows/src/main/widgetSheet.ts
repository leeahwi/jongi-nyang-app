import { BrowserWindow, ipcMain, screen, type IpcMainEvent, type Rectangle } from "electron";
import path from "node:path";
import { askLevels, type AskedUp } from "../core/slipMove";
import { t } from "../i18n";
import { offscreen, offscreenEnabled } from "./env";

/**
 * 바탕화면 위젯의 날짜 쪽지 (#234): a click on a widget's day (or its +N, or 오늘's +) opens this slip beside the widget —
 * the day's title, every event and to-do of that day with its time (scrolling when there are many), and the input line
 * that reads like the note's (renderer/widgetSheet.ts). It takes the keyboard (the widget never does); Esc, a click
 * elsewhere or putting something in closes it, and the widget shows the toast. It is always solid paper, and floats above
 * other windows even while its widget is under them. Off-screen runs keep it far off every display; snapshots never
 * show it (a hidden window painting). #253: a question waiting doesn't hold it up; it is told what is up as it opens
 * (renderer/widgetAsk.ts), and the question floats over it (askLevels).
 */
const width = 340;

export interface SheetHooks {
  /** What was put in: the widget's toast (되돌리기) and its ears' twitch. */
  made(widgetId: string, payload: unknown): void;
  /** #253: what is up as it opens (a question, one that replaces the whole list). */
  asked(): AskedUp;
  /** #253: it went away (a waiting question floats again only over what is still on top). */
  hidden(): void;
}

export class WidgetSheet {
  private window?: BrowserWindow;
  private loaded = false;
  private waiting?: { widget: string; day: string; text?: string; up?: AskedUp };
  private size = { width: width + 48, height: 260 };
  private beside?: Rectangle;
  private widgetId = "";

  constructor(private readonly rendererDirectory: string, private readonly live: boolean, private readonly snapshots: boolean, private readonly hooks: SheetHooks) {
    const fromSheet = (event: IpcMainEvent) => Boolean(this.window && !this.window.isDestroyed() && event.sender === this.window.webContents);
    ipcMain.on("widgetSheet:close", (event) => { if (fromSheet(event)) this.hide(); });
    ipcMain.on("widgetSheet:size", (event, value: unknown) => {
      if (!fromSheet(event)) return;
      const size = value as { width?: unknown; height?: unknown };
      if (typeof size?.width !== "number" || typeof size?.height !== "number") return;
      this.size = { width: Math.min(Math.max(Math.ceil(size.width), 240), 480), height: Math.min(Math.max(Math.ceil(size.height), 160), 720) };
      this.place();
    });
    ipcMain.on("widgetSheet:made", (event, payload: unknown) => {
      if (!fromSheet(event)) return;
      this.hooks.made(this.widgetId, payload);
      this.hide();
    });
  }

  get isVisible(): boolean { return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible()); }

  /** Beside the widget's window (`beside`, its bounds), on the side with more room on its display; takes the keyboard. */
  open(widgetId: string, day: string, beside: Rectangle): void {
    this.widgetId = widgetId;
    this.beside = beside;
    const window = this.ensureWindow();
    this.send({ widget: widgetId, day, up: this.hooks.asked() });
    this.place();
    if (this.snapshots) return;
    window.show();
    window.setAlwaysOnTop(true, askLevels.sheet.level, askLevels.sheet.relative);
    window.moveTop();
    window.focus();
    window.webContents.focus();
  }

  hide(): void {
    if (!this.isVisible) return;
    this.window!.hide();
    this.hooks.hidden();
  }

  /** Snapshots: the sheet for that day, off-screen and never shown, with `text` typed in. */
  async showForSnapshot(widgetId: string, day: string, text = ""): Promise<BrowserWindow> {
    this.widgetId = widgetId;
    const window = this.ensureWindow();
    if (!this.loaded) await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));
    this.beside = undefined;
    this.send({ widget: widgetId, day, text, up: this.hooks.asked() });
    this.place();
    return window;
  }

  private send(payload: { widget: string; day: string; text?: string; up?: AskedUp }): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (this.loaded) window.webContents.send("widgetSheet:open", payload);
    else this.waiting = payload;
  }

  private place(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (offscreenEnabled || !this.beside) {
      window.setBounds({ x: offscreen.x + 600, y: offscreen.y + 300, ...this.size });
      return;
    }
    const beside = this.beside;
    const area = screen.getDisplayMatching(beside).workArea;
    const roomRight = area.x + area.width - (beside.x + beside.width);
    const roomLeft = beside.x - area.x;
    // The widget's window has room for its shadow around the paper: the sheet stands just beyond the paper's edge.
    const x = roomRight >= this.size.width - 8 || roomRight >= roomLeft ? beside.x + beside.width - 8 : beside.x - this.size.width + 8;
    const y = Math.min(Math.max(beside.y, area.y), area.y + area.height - this.size.height);
    window.setBounds({ x: Math.round(Math.min(Math.max(x, area.x), area.x + area.width - this.size.width)), y: Math.round(y), ...this.size });
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow({
      ...this.size, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, backgroundColor: "#00000000", title: t("날짜 쪽지"),
      enableLargerThanScreen: offscreenEnabled || this.snapshots,
      paintWhenInitiallyHidden: this.snapshots,
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, backgroundThrottling: !offscreenEnabled },
    });
    window.setVisibleOnAllWorkspaces(true);
    this.loaded = false;
    window.webContents.once("did-finish-load", () => {
      this.loaded = true;
      const payload = this.waiting;
      this.waiting = undefined;
      if (payload && !window.isDestroyed()) window.webContents.send("widgetSheet:open", payload);
    });
    window.loadFile(path.join(this.rendererDirectory, "widgetSheet.html"));
    // A click anywhere else puts it away, like a menu.
    window.on("blur", () => { if (this.live) this.hide(); });
    window.on("closed", () => { if (this.window === window) this.window = undefined; });
    this.window = window;
    return window;
  }
}
