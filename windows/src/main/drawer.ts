import { BrowserWindow, globalShortcut, ipcMain, nativeTheme, screen, type Rectangle } from "electron";
import os from "node:os";
import path from "node:path";
import { changedToday, clampDrawerWidth, drawerLook, shortcutLabel, type DrawerBackdrop } from "../core/memoDrawer";
import { t } from "../i18n";
import { offscreen, offscreenEnabled, shortcutsDisabled } from "./env";
import type { Store } from "./store";

/** Room left of the paper (right side; mirrored on the left) for the bookmarks, and above it for the cat. */
export const drawerChrome = { tabs: 34, top: 52 };
/** The edge handle: a paw bookmark 24 × 46 that peeks 6 more on hover; the window holds the peek and the number under it. */
const handleSize = { width: 30, height: 50 };
/** Snapshots draw the drawer this tall (a laptop's work area). */
const snapshotHeight = 780;

export interface DrawerHooks {
  /** Night paper now (자동 follows it). */
  night: () => boolean;
  /** Whether the system asks for less motion (the slide is then skipped). */
  reduceMotion: () => boolean;
}

/**
 * 메모 서랍 (1.28): a frameless, transparent window at the screen's edge, as tall as the work area of the
 * display under the mouse, on the chosen side. Made the first time it opens and only hidden afterwards.
 * It stays open until its shortcut, Esc (twice) or ×: clicking another app never closes it; with 위에 고정
 * on (the default) it floats above other windows, off it goes behind them like any window. Only the paper,
 * the bookmarks and the cat catch the mouse; the rest of the window lets clicks through.
 *
 * The edge handle is a window of its own: a paw bookmark, the number of memos changed today under it,
 * dragged up and down (remembered), a click opens the drawer. It draws once and then does nothing.
 */
export class MemoDrawer {
  private window?: BrowserWindow;
  private handle?: BrowserWindow;
  private loaded = false;
  private handleLoaded = false;
  private open = false;
  private hideTimer?: NodeJS.Timeout;
  private registered = "";
  private interactive = true;
  private area?: Rectangle;
  private handleKey = "";
  /** Snapshots: where the drawer is drawn instead of the screen's edge. */
  private snapshotArea?: Rectangle;

  constructor(private readonly store: Store, private readonly rendererDirectory: string, private readonly live: boolean, private readonly hooks: DrawerHooks) {
    const fromDrawer = (event: Electron.IpcMainEvent) => this.window !== undefined && !this.window.isDestroyed() && event.sender === this.window.webContents;
    const fromHandle = (event: Electron.IpcMainEvent) => this.handle !== undefined && !this.handle.isDestroyed() && event.sender === this.handle.webContents;
    ipcMain.on("drawer:close", (event) => { if (fromDrawer(event)) this.close(); });
    ipcMain.on("drawer:hidden", (event) => { if (fromDrawer(event) && !this.open) this.hideNow(); });
    ipcMain.on("drawer:interactive", (event, value: unknown) => { if (fromDrawer(event)) this.setInteractive(value === true); });
    ipcMain.on("drawer:resize", (event, screenX: unknown, done: unknown) => { if (fromDrawer(event) && typeof screenX === "number") this.resizeTo(screenX, done === true); });
    ipcMain.on("drawer:shape", (event, rects: unknown) => { if (fromDrawer(event)) this.setShape(rects); });
    ipcMain.on("handle:open", (event) => { if (fromHandle(event)) this.show(); });
    ipcMain.on("handle:drag", (event, screenY: unknown, done: unknown) => { if (fromHandle(event) && typeof screenY === "number") this.dragHandle(screenY, done === true); });
    store.on("prefs", (key: string) => {
      if (key === "drawerShortcut") this.updateShortcut();
      if (key === "drawerPinned") this.applyPinned();
      if (key === "drawerSide" || key === "drawerWidth") { if (this.open) this.place(); this.placeHandle(); }
      if (key === "drawerSide" && this.open && this.loaded && this.window && !this.window.isDestroyed()) this.window.webContents.send("drawer:open", { slide: false, side: this.store.prefs.drawerSide, look: this.look() });
      if (key === "drawerHandle" || key === "drawerSide" || key === "drawerTheme") this.updateHandle();
      if (key === "drawerTheme") this.sendLook();
      if (key === "drawerBackdrop") this.applyBackdrop();
    });
    // Windows' "transparency effects" switched: 반투명 · 강하게 follow.
    nativeTheme.on("updated", () => this.applyBackdrop());
    this.noteBackdrop();
    store.on("change", () => this.sendHandle());
    screen.on("display-metrics-changed", () => { if (this.open) this.place(); this.placeHandle(); });
    screen.on("display-removed", () => { if (this.open) this.place(); this.placeHandle(); });
    this.updateShortcut();
  }

  get isOpen(): boolean { return this.open; }

  /**
   * The shortcut: opens, or closes when it is open — except when 위에 고정 is off and it sits behind
   * another app's window without the focus: then it comes forward first.
   */
  toggle(): void {
    const window = this.window;
    const behind = this.open && !this.store.prefs.drawerPinned && window !== undefined && !window.isDestroyed() && !window.isFocused();
    if (this.open && !behind) this.close(); else this.show();
  }

  /**
   * Slides in on the display under the mouse and takes the focus (typing goes to the slip at once);
   * on a memo (its folder, the memo open: the note's search, 열기 on a toast), or at the quick-write slip.
   */
  show(target: { memo?: string; write?: boolean } = {}): void {
    clearTimeout(this.hideTimer);
    const window = this.ensureWindow();
    const wasOpen = this.open;
    this.open = true;
    this.place();
    this.applyPinned();
    const reveal = () => {
      if (window.isDestroyed()) return;
      this.applyBackdrop();
      window.webContents.send("drawer:open", { slide: !wasOpen && !this.hooks.reduceMotion() && !offscreenEnabled, side: this.store.prefs.drawerSide, look: this.look(), backdrop: this.backdrop(), ...target });
      if (offscreenEnabled) window.showInactive(); else { window.show(); window.focus(); window.webContents.focus(); }
      this.updateHandle();
    };
    if (this.loaded) reveal(); else window.webContents.once("did-finish-load", reveal);
  }

  /** Slides out (180 ms; the page says when it is done), then hides. Nothing is closed for good. */
  close(): void {
    if (!this.open) return;
    this.open = false;
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    window.webContents.send("drawer:shut", { slide: !this.hooks.reduceMotion() && !offscreenEnabled });
    clearTimeout(this.hideTimer);
    this.hideTimer = setTimeout(() => this.hideNow(), 400); // in case the page never answers
  }

  private hideNow(): void {
    clearTimeout(this.hideTimer);
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide();
    this.updateHandle();
  }

  // ─── The shortcut ──────────────────────────────────────────────────────────

  /**
   * Takes the shortcut from the settings (Ctrl+Shift+D unless changed; "" = off) and gives back the old
   * one. When another app holds it, 설정 › 메모 서랍 says so. Tests, snapshots and `npm run perf` take none.
   */
  private updateShortcut(): void {
    if (!this.live || shortcutsDisabled) return;
    const wanted = this.store.prefs.drawerShortcut;
    if (this.registered && this.registered !== wanted) {
      globalShortcut.unregister(this.registered);
      this.registered = "";
    }
    let ok = true;
    if (wanted && !this.registered) {
      try { ok = globalShortcut.register(wanted, () => this.toggle()); } catch { ok = false; }
      if (ok) this.registered = wanted;
    }
    const problem = wanted && !ok ? t("다른 앱이 {key}를 쓰고 있어 켜지 못했어요. 다른 키를 골라 보세요.", { key: shortcutLabel(wanted) }) : undefined;
    if (problem !== this.store.drawerShortcutProblem) {
      this.store.drawerShortcutProblem = problem;
      this.store.changed();
    }
  }

  dispose(): void {
    if (this.registered) globalShortcut.unregister(this.registered);
    this.registered = "";
  }

  // ─── Where it goes ─────────────────────────────────────────────────────────

  private look() { return drawerLook(this.store.prefs.drawerTheme, this.hooks.night()); }

  /** 자동 follows the note's paper: the page hears the look again when the paper changes. */
  sendLook(): void {
    const look = this.look();
    if (this.window && !this.window.isDestroyed() && this.loaded) this.window.webContents.send("drawer:look", look);
    this.sendHandle(true);
  }

  // ─── 바탕 (1.29) ────────────────────────────────────────────────────────────

  /**
   * Why 반투명 · 강하게 can't be drawn here (Windows 10 has no acrylic; Windows' transparency effects off), or
   * undefined when they can. Away from Windows (snapshots, perf on a Mac) the page draws them itself.
   */
  private backdropProblem(): string | undefined {
    if (process.platform !== "win32") return undefined;
    const build = Number(os.release().split(".")[2] ?? 0);
    if (build < 22621) return t("이 Windows에서는 반투명 · 강하게가 불투명으로 보여요(Windows 11에서 돼요).");
    if (nativeTheme.prefersReducedTransparency) return t("Windows의 투명 효과가 꺼져 있어 반투명 · 강하게가 불투명으로 보여요.");
    return undefined;
  }

  /** 바탕 as drawn: the setting, with 반투명 · 강하게 as 불투명 where they can't be drawn. */
  backdrop(): DrawerBackdrop {
    const wanted = this.store.prefs.drawerBackdrop;
    return (wanted === "frost" || wanted === "strong") && this.backdropProblem() ? "solid" : wanted;
  }

  /** 설정 › 메모 서랍 says why 반투명 · 강하게 look solid here. */
  private noteBackdrop(): void {
    const note = this.backdropProblem();
    if (note !== this.store.drawerBackdropNote) {
      this.store.drawerBackdropNote = note;
      this.store.changed();
    }
  }

  private acrylic = false;
  /**
   * Windows 11's acrylic under 반투명 · 강하게 (the page tints it with the paper at 82 % / 62 %). The window is cut to
   * the paper, the bookmarks and the ears (`drawer:shape`), so the blur doesn't show around them.
   */
  private applyBackdrop(): void {
    this.noteBackdrop();
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const backdrop = this.backdrop();
    if (this.loaded) window.webContents.send("drawer:backdrop", backdrop);
    const acrylic = process.platform === "win32" && (backdrop === "frost" || backdrop === "strong");
    if (acrylic === this.acrylic) return;
    this.acrylic = acrylic;
    try {
      window.setBackgroundMaterial(acrylic ? "acrylic" : "none");
      // Back to the whole window (a region bigger than any screen; an empty list would hide it all).
      if (!acrylic) window.setShape([{ x: 0, y: 0, width: 20000, height: 20000 }]);
    } catch { /* an older Windows: drawn as the page has it */ }
  }

  /** The page's shapes (the paper, each bookmark, the ears in steps): the window's region while acrylic is on. */
  private setShape(rects: unknown): void {
    const window = this.window;
    if (!this.acrylic || !window || window.isDestroyed() || !Array.isArray(rects)) return;
    const shape = rects.filter((rect): rect is Rectangle => typeof rect === "object" && rect !== null && ["x", "y", "width", "height"].every((key) => typeof (rect as Record<string, unknown>)[key] === "number"))
      .slice(0, 64).map((rect) => ({ x: Math.floor(rect.x), y: Math.floor(rect.y), width: Math.ceil(rect.width), height: Math.ceil(rect.height) }));
    if (shape.length) try { window.setShape(shape); } catch { /* not on this system */ }
  }

  private workArea(): Rectangle {
    if (this.snapshotArea) return this.snapshotArea;
    if (offscreenEnabled) return { x: offscreen.x + 200, y: offscreen.y + 60, width: 1200, height: snapshotHeight };
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  }

  /** Against the chosen edge of the work area, its whole height. */
  private place(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    const area = this.workArea();
    this.area = area;
    const width = clampDrawerWidth(this.store.prefs.drawerWidth) + drawerChrome.tabs;
    const x = this.store.prefs.drawerSide === "left" ? area.x : area.x + area.width - width;
    window.setBounds({ x: Math.round(x), y: Math.round(area.y), width, height: Math.round(area.height) });
  }

  /** The inner edge dragged to `screenX`: the paper's width follows (260–480), kept when the drag ends. */
  private resizeTo(screenX: number, done: boolean): void {
    const area = this.area ?? this.workArea();
    const raw = this.store.prefs.drawerSide === "left" ? screenX - area.x - drawerChrome.tabs : area.x + area.width - screenX;
    const width = clampDrawerWidth(raw);
    const window = this.window;
    if (window && !window.isDestroyed()) {
      const total = width + drawerChrome.tabs;
      const x = this.store.prefs.drawerSide === "left" ? area.x : area.x + area.width - total;
      window.setBounds({ x: Math.round(x), y: Math.round(area.y), width: total, height: Math.round(area.height) });
    }
    if (done) this.store.setPref("drawerWidth", width);
  }

  /** 위에 고정: above other windows (the default), or an ordinary window that goes behind when another app is clicked. */
  private applyPinned(): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    window.setAlwaysOnTop(this.store.prefs.drawerPinned, "floating");
  }

  private setInteractive(value: boolean): void {
    if (this.interactive === value || !this.window || this.window.isDestroyed()) return;
    this.interactive = value;
    this.window.setIgnoreMouseEvents(!value, { forward: true });
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const area = this.workArea();
    const window = new BrowserWindow({
      width: clampDrawerWidth(this.store.prefs.drawerWidth) + drawerChrome.tabs, height: area.height, show: false, frame: false, transparent: true, resizable: false,
      movable: false, minimizable: false, maximizable: false, fullscreenable: false, skipTaskbar: true, hasShadow: false, backgroundColor: "#00000000",
      title: t("메모 서랍"),
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, backgroundThrottling: !offscreenEnabled },
    });
    window.setVisibleOnAllWorkspaces(true);
    this.loaded = false;
    this.interactive = true;
    this.acrylic = false;
    window.webContents.once("did-finish-load", () => { this.loaded = true; });
    window.loadFile(path.join(this.rendererDirectory, "drawer.html"));
    window.on("closed", () => { if (this.window === window) { this.window = undefined; this.open = false; } });
    this.window = window;
    return window;
  }

  // ─── The handle ────────────────────────────────────────────────────────────

  /** Shown while the drawer is closed and the setting is on (snapshots ask for it themselves). */
  private updateHandle(): void {
    const wanted = this.store.prefs.drawerHandle && !this.open && (this.live || Boolean(this.snapshotArea));
    if (!wanted) {
      if (this.handle && !this.handle.isDestroyed() && this.handle.isVisible()) this.handle.hide();
      return;
    }
    const handle = this.ensureHandle();
    this.placeHandle();
    this.sendHandle(true);
    if (!handle.isVisible()) {
      handle.showInactive();
      handle.setAlwaysOnTop(true, "floating");
    }
  }

  /** The handle's display: the primary one (the drawer itself opens where the mouse is). */
  private handleArea(): Rectangle {
    if (this.snapshotArea) return this.snapshotArea;
    return screen.getPrimaryDisplay().workArea;
  }

  private placeHandle(): void {
    const handle = this.handle;
    if (!handle || handle.isDestroyed()) return;
    const area = this.handleArea();
    const y = area.y + Math.round((area.height - handleSize.height) * this.store.prefs.drawerHandleY);
    const x = this.store.prefs.drawerSide === "left" ? area.x : area.x + area.width - handleSize.width;
    handle.setBounds({ x, y, ...handleSize });
  }

  /** The handle dragged along the edge: it follows the mouse, and its place is kept when let go. */
  private dragHandle(screenY: number, done: boolean): void {
    const area = this.handleArea();
    const fraction = Math.min(1, Math.max(0, (screenY - area.y - handleSize.height / 2) / Math.max(1, area.height - handleSize.height)));
    const handle = this.handle;
    if (handle && !handle.isDestroyed()) {
      const bounds = handle.getBounds();
      handle.setBounds({ ...bounds, y: area.y + Math.round((area.height - handleSize.height) * fraction) });
    }
    if (done) this.store.setPref("drawerHandleY", Math.round(fraction * 1000) / 1000);
  }

  /** The handle hears only what it draws (the side, the look, today's number), and only when it changes. */
  private sendHandle(force = false): void {
    const handle = this.handle;
    if (!handle || handle.isDestroyed() || !this.handleLoaded) return;
    const payload = { count: changedToday(this.store.memos, new Date()), side: this.store.prefs.drawerSide, look: this.look(), label: t("메모 서랍 열기") };
    const key = JSON.stringify(payload);
    if (!force && key === this.handleKey) return;
    this.handleKey = key;
    handle.webContents.send("handle:state", payload);
  }

  private ensureHandle(): BrowserWindow {
    if (this.handle && !this.handle.isDestroyed()) return this.handle;
    const handle = new BrowserWindow({
      ...handleSize, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, backgroundColor: "#00000000", title: t("메모 서랍 열기"),
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, backgroundThrottling: true },
    });
    // Every desktop, but not over full-screen apps.
    handle.setVisibleOnAllWorkspaces(true);
    this.handleLoaded = false;
    handle.webContents.once("did-finish-load", () => { this.handleLoaded = true; this.handleKey = ""; this.sendHandle(true); });
    handle.loadFile(path.join(this.rendererDirectory, "handle.html"));
    handle.on("closed", () => { if (this.handle === handle) this.handle = undefined; });
    this.handle = handle;
    return handle;
  }

  /** At launch: the handle, when it is on. */
  start(): void { this.updateHandle(); }

  // ─── Snapshots ─────────────────────────────────────────────────────────────

  /** Snapshots: drawn off-screen in a work area `height` tall, opened at once (no slide). */
  async showForSnapshot(height = snapshotHeight): Promise<BrowserWindow> {
    this.snapshotArea = { x: offscreen.x + 200, y: offscreen.y + 60, width: 1200, height };
    const window = this.ensureWindow();
    if (!this.loaded) await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));
    this.show();
    return window;
  }

  /** Snapshots: the handle alone (the drawer closed). */
  async handleForSnapshot(): Promise<BrowserWindow | undefined> {
    this.snapshotArea = { x: offscreen.x + 200, y: offscreen.y + 60, width: 1200, height: snapshotHeight };
    if (this.open) { this.open = false; this.hideNow(); }
    this.updateHandle();
    const handle = this.handle;
    if (handle && !this.handleLoaded) await new Promise<void>((resolve) => handle.webContents.once("did-finish-load", () => resolve()));
    this.sendHandle(true);
    return handle;
  }

  get snapshotWindow(): BrowserWindow | undefined { return this.window && !this.window.isDestroyed() ? this.window : undefined; }
  get snapshotHandle(): BrowserWindow | undefined { return this.handle && !this.handle.isDestroyed() ? this.handle : undefined; }

  /** Snapshots: everything put away again. */
  hideForSnapshot(): void {
    this.open = false;
    this.hideNow();
    if (this.handle && !this.handle.isDestroyed()) this.handle.hide();
  }
}
