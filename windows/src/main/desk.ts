import { BrowserWindow, screen, type WebFrameMain } from "electron";
import path from "node:path";
import { deskFrame, deskSize, deskTitleBar, pageOfPane, paneForShortcut, readPane, type DeskPage, type DeskPane } from "../core/desk";
import { deskTitle } from "../renderer/deskPanes";
import type { Store } from "./store";

/** What may come with a pane: the day to show on 달력, the topic or search on 도움말. */
export interface DeskExtra { day?: string; topic?: string; query?: string }

/** The pages' file names, as the desk's frames load them. */
const pageFile: Record<DeskPage, string> = { calendar: "calendarWindow.html", history: "history.html", settings: "settings.html", help: "help.html" };

/**
 * 책상: one window for 달력 · 완료 기록 · 시계 · the settings panes · 도움말, with a sidebar (desk.html).
 * Each pane is the old window's page in a frame of its own, so it keeps its behaviour and its
 * styles; the main process decides which pane shows (sidebar clicks, Ctrl+1…9, the menus, the
 * tray) and tells every frame ("desk:pane"). Only one desk at a time; it remembers its frame.
 */
export class Desk {
  private window?: BrowserWindow;
  private current: DeskPane = "calendar";
  private loaded?: Promise<void>;

  constructor(
    private readonly store: Store,
    private readonly rendererDirectory: string,
    private readonly options: {
      webPreferences: () => Electron.WebPreferences; icon: string; background: () => string; snapshots: boolean;
      /**
       * The title strip: "overlay" on Windows (the page draws a paper strip, Windows its − □ × over it),
       * "preview" in snapshots (the same strip with drawn − □ ×, to see the layout), or the system's frame.
       */
      chrome?: "overlay" | "preview";
      /** The − □ × symbols' colour (with "overlay"). */
      symbols: () => string;
      /** 사용 안내 in the sidebar, and F1's neighbours the note handles itself. */
      guide: () => void;
      /** Ctrl+F (outside 도움말, which searches its topics): the note's search slip. */
      search?: () => void;
    },
  ) {}

  get pane(): DeskPane { return this.current; }
  get browserWindow(): BrowserWindow | undefined { return this.window && !this.window.isDestroyed() ? this.window : undefined; }
  get isOpen(): boolean { return Boolean(this.browserWindow); }
  get isVisible(): boolean { return Boolean(this.browserWindow?.isVisible()); }
  isFocused(): boolean { return Boolean(this.browserWindow?.isFocused()); }

  /** Opens (or brings forward) the desk on `pane`; `extra` goes along to the pane's page. */
  open(pane: DeskPane = this.current, extra: DeskExtra = {}, show = !this.options.snapshots): BrowserWindow {
    this.current = pane;
    const existing = this.browserWindow;
    if (existing) {
      this.sendAll("desk:pane", { pane, ...extra });
      existing.setTitle(deskTitle(pane));
      this.store.remember({ desk: { ...this.frame(existing), pane } });
      if (show) {
        if (existing.isMinimized()) existing.restore();
        existing.show();
        existing.focus();
      }
      return existing;
    }
    const saved = this.store.memory.desk ?? (this.store.memory.calendar ? { ...this.store.memory.calendar, width: this.store.memory.calendar.width ?? 0, height: this.store.memory.calendar.height ?? 0 } : undefined);
    const strip = this.options.chrome ? deskTitleBar : 0;
    const frame = deskFrame(saved ?? { width: deskSize.width, height: deskSize.height + strip });
    const fits = frame.x !== undefined && screen.getAllDisplays().some((display) => {
      const area = display.workArea;
      return frame.x! < area.x + area.width && area.x < frame.x! + frame.width && frame.y! < area.y + area.height && area.y < frame.y! + frame.height;
    });
    const window = new BrowserWindow({
      width: frame.width, height: frame.height, useContentSize: true, ...(fits ? { x: frame.x, y: frame.y } : {}),
      minWidth: deskSize.minWidth, minHeight: deskSize.minHeight + strip, fullscreenable: false,
      ...(this.options.chrome === "overlay" ? { titleBarStyle: "hidden" as const, titleBarOverlay: { color: this.options.background(), symbolColor: this.options.symbols(), height: deskTitleBar } } : {}),
      title: deskTitle(pane), show: false, autoHideMenuBar: true, backgroundColor: this.options.background(),
      icon: this.options.icon, enableLargerThanScreen: this.options.snapshots,
      // Every pane's frame gets the preload (window.paper), like a window of its own.
      webPreferences: { ...this.options.webPreferences(), nodeIntegrationInSubFrames: true },
    });
    this.window = window;
    window.setMenu(null);
    const query: Record<string, string> = { pane };
    if (this.options.chrome) query.chrome = this.options.chrome;
    if (extra.day) query.day = extra.day;
    if (extra.topic) query.topic = extra.topic;
    if (extra.query) query.q = extra.query;
    this.loaded = new Promise((resolve) => window.webContents.once("did-finish-load", () => resolve()));
    void window.loadFile(path.join(this.rendererDirectory, "desk.html"), { query });
    window.once("ready-to-show", () => { if (show) window.show(); });
    const remember = () => {
      if (this.options.snapshots || window.isDestroyed() || window.isMinimized() || window.isMaximized()) return;
      this.store.remember({ desk: { ...this.frame(window), pane: this.current } });
    };
    window.on("moved", remember);
    window.on("resized", remember);
    window.on("closed", () => { if (this.window === window) { this.window = undefined; this.loaded = undefined; } });
    // The desk's own keys, wherever the focus is (the sidebar or inside a pane's frame).
    window.webContents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const pick = this.shortcut(input);
      if (!pick) return;
      event.preventDefault();
      if (pick === "guide") this.options.guide();
      else if (pick === "search") this.options.search?.();
      else this.open(pick);
    });
    return window;
  }

  /** The pane a key opens: Ctrl+1…9 down the sidebar, Ctrl+D 달력, Ctrl+, 꾸미기, Ctrl+H 완료 기록, F1 도움말. */
  private shortcut(input: Electron.Input): DeskPane | "guide" | "search" | undefined {
    if (input.key === "F1" && !input.control && !input.alt) return "help";
    if (!input.control || input.alt || input.meta) return undefined;
    const digit = /^Digit([1-9])$/.exec(input.code)?.[1];
    if (digit && !input.shift) return paneForShortcut(Number(digit));
    if (input.shift) return undefined;
    const key = input.key.toLowerCase();
    if (input.code === "KeyD" || key === "d") return "calendar";
    if (input.code === "KeyH" || key === "h") return "history";
    if (input.code === "Comma" || key === ",") return "appearance";
    if ((input.code === "KeyF" || key === "f") && this.current !== "help" && this.options.search) return "search";
    return undefined;
  }

  /** The window's place and content size. */
  private frame(window: BrowserWindow): { x: number; y: number; width: number; height: number } {
    const [x, y] = window.getPosition();
    const [width, height] = window.getContentSize();
    return { x, y, width, height };
  }

  /** The sidebar asked for a pane (a click, ↑ ↓). */
  choose(value: unknown): void {
    const pane = readPane(value);
    if (pane && this.isOpen) this.open(pane, {}, false);
  }

  /** Sends to the sidebar and to every pane's frame (each page listens for what concerns it). */
  sendAll(channel: string, ...args: unknown[]): void {
    const window = this.browserWindow;
    if (!window) return;
    for (const frame of window.webContents.mainFrame.framesInSubtree) {
      try { frame.send(channel, ...args); } catch { /* a frame going away */ }
    }
  }

  /** Resolves once the desk's page (the sidebar) has loaded. */
  ready(): Promise<void> { return this.loaded ?? Promise.resolve(); }

  /** A page's frame, once loaded (snapshots run their checks inside it). */
  frameOf(page: DeskPage): WebFrameMain | undefined {
    const window = this.browserWindow;
    if (!window) return undefined;
    return window.webContents.mainFrame.frames.find((frame) => frame.url.includes(`/${pageFile[page]}`));
  }

  /** The frame showing the pane now. */
  paneFrame(): WebFrameMain | undefined { return this.frameOf(pageOfPane(this.current)); }

  /** Whether `frame` is one of the desk's (for the menus a pane opens: they pop up over the desk). */
  owns(frame: WebFrameMain | null | undefined): boolean {
    const window = this.browserWindow;
    return Boolean(frame && window && !window.isDestroyed() && window.webContents.mainFrame.framesInSubtree.includes(frame));
  }

  /** Whether `frame` is the 달력 pane's. */
  isCalendarFrame(frame: WebFrameMain | null | undefined): boolean {
    return Boolean(frame && this.owns(frame) && frame.url.includes(`/${pageFile.calendar}`));
  }

  setBackground(color: string): void {
    const window = this.browserWindow;
    if (!window) return;
    window.setBackgroundColor(color);
    if (this.options.chrome === "overlay") window.setTitleBarOverlay({ color, symbolColor: this.options.symbols(), height: deskTitleBar });
  }

  destroy(): void { this.browserWindow?.destroy(); this.window = undefined; this.loaded = undefined; }
}
