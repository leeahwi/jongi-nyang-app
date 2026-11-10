import { BrowserWindow, ipcMain, powerMonitor, screen } from "electron";
import path from "node:path";
import { t } from "../i18n";
import { scaledSize } from "../core/catSize";
import {
  lastTouch, toggledTypingScope, typingCatFrameFor, typingCatSize, typingDropped, typingLingerMs, typingShows, typingSource, typedWithin,
  type TypingCat, type TypingPose, type TypingScreen, type TypingSource,
} from "../core/typingCat";
import { GlobalKeys, hookWanted, type KeyHookNative } from "../core/keyHook";
import { offscreen, offscreenEnabled } from "./env";
import type { Store } from "./store";

/** How long the page fades out before the window is hidden (none with reduced motion). */
const fadeMs = 250;

/**
 * 치면 두드리는 고양이 (#230 · #289, docs/plans/typing-cat.md): a cat of its own, apart from the desktop pet, on its
 * cushion in a corner of the display in use. Its window is small (112 DIP), click-through, never takes the keyboard and
 * stays over full-screen apps. The page runs the paws (core/typingCat.ts); this side only says that a key went down
 * (`typingCat:key`, nothing else) and whether the cat is out.
 *
 * - 종이냥에서만: keys typed in the app's windows (`typingTap`); the cat comes with a key and quietly goes 3 s after
 *   the last one.
 * - 모든 앱에서 (#288): Windows' low-level keyboard hook (core/keyHook.ts, main/keyHook.ts), set only while this is
 *   chosen and the screen isn't locked; the cat stays in its corner. The pages' taps are left then (the hook hears those
 *   keys too). If the hook can't be set, it hears this app only and Settings says so.
 * - Off: no window at all, no hook. Hiding the pet changes nothing here; the pet never comes to the cushion.
 *
 * - #331: pressed on the drawn cat and dragged, the window follows (setBounds, its size kept); let go, it stays there (옮긴
 *   자리, `typingPlace`), wholly on that display. Clicks anywhere clear still go to the window behind: the page hears the
 *   pointer through the click-through window (`forward`) and says when it is over the cat.
 *
 * At rest nothing runs: no timer, no animation, one still picture (or no window).
 */
export class TypingCatWindow {
  private window?: BrowserWindow;
  private ready = false;
  private locked = false;
  /** When the last key went down (performance.now()); the pet's 한마디 waits by it too. */
  private lastKey?: number;
  /** 종이냥에서만: the one wait until the cat goes (moved on by each key). */
  private goTimer?: NodeJS.Timeout;
  /** The fade before the window is hidden. */
  private hideTimer?: NodeJS.Timeout;
  private source: TypingSource = "none";
  /** 모든 앱에서: the hook, loaded the first time it is wanted. */
  private keys?: GlobalKeys;
  /** #331: a drag going on — where the cursor and the window were when it started. */
  private drag?: { cursor: Electron.Point; bounds: Electron.Rectangle };
  /** When it was last let go: 종이냥에서만 keeps it `typingLingerMs` from then, as after a key. */
  private droppedAt?: number;
  /** Whether the window takes the mouse now (over the drawn cat). */
  private interactive = false;

  /** `loadHook` gives the hook's native side (main/keyHook.ts), asked only when 모든 앱에서 is chosen. */
  constructor(private readonly store: Store, private readonly rendererDirectory: string, hooks: { changed(): void },
    private readonly loadHook: () => KeyHookNative | undefined = () => undefined) {
    store.on("prefs", (key: string) => {
      if (key === "typingCat") { this.refresh(); hooks.changed(); }
      // #304: 크기 too: the window takes its new side at once, flush in the same corner.
      if (key === "typingCorner" || key === "typingSize") this.place();
    });
    powerMonitor.on("lock-screen", () => this.setLocked(true));
    powerMonitor.on("unlock-screen", () => this.setLocked(false));
    screen.on("display-removed", () => this.place());
    screen.on("display-metrics-changed", () => this.place());
    screen.on("display-added", () => this.place());
    this.registerIPC();
    this.refresh();
  }

  /** Where keys are heard from now. */
  get heard(): TypingSource { return this.source; }
  get isShown(): boolean { return this.window?.isVisible() === true && this.hideTimer === undefined; }

  setLocked(locked: boolean): void {
    if (locked === this.locked) return;
    this.locked = locked;
    this.refresh();
  }

  /** Brings everything in line with the setting and the lock: what is heard, and whether the cat is out. */
  refresh(): void {
    const before = this.source;
    const scope = this.store.prefs.typingCat;
    const wantsHook = hookWanted(scope, this.locked);
    if (wantsHook) this.keys ??= new GlobalKeys(this.loadHook(), () => this.key());
    // Off, another choice, locked or quitting: the hook comes off at once.
    const hooked = this.keys?.listen(wantsHook) ?? false;
    this.source = typingSource(scope, hooked, this.locked);
    const note = wantsHook && !hooked ? t("다른 앱의 키를 받지 못해서 종이냥 안에서만 두드려요.") : undefined;
    if (note !== this.store.typingCatNote) {
      this.store.typingCatNote = note;
      this.store.changed();
    }
    if (this.source === "none") {
      this.clearGo();
      // Put away, not just hidden: nothing of it is left running.
      this.destroy();
      return;
    }
    // Heard from elsewhere now: the paws rest.
    if (before !== this.source && this.ready) this.window?.webContents.send("typingCat:rest");
    this.update();
  }

  /** A key went down in one of the app's windows (`typingTap`). */
  tap(): void {
    if (this.source === "app") this.key();
  }

  private key(): void {
    this.lastKey = performance.now();
    this.show();
    if (this.ready) this.window?.webContents.send("typingCat:key");
    if (this.source === "app") this.armGo();
  }

  /** Typed within `ms` (the pet's 한마디 waits 5 s). */
  typedWithin(ms: number): boolean {
    return typedWithin({ pose: "idle", nextPaw: "left", lastKey: this.lastKey } satisfies TypingCat, ms, performance.now());
  }

  /** The tray's 타닥냥: off, or back to what it was. */
  toggle(): void {
    const next = toggledTypingScope(this.store.prefs.typingCat, this.store.prefs.typingCatLast);
    if (next.last !== undefined) this.store.setPref("typingCatLast", next.last);
    this.store.setPref("typingCat", next.scope);
  }

  private update(): void {
    if (typingShows(this.source, this.lastKey, performance.now(), this.drag !== undefined, this.droppedAt)) this.show();
    else this.hide();
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    // #307: made with its corner's bounds (off-screen in a test run), not the default centre.
    const window = new BrowserWindow({
      ...this.frame(), show: false, frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false,
      fullscreenable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      // #313 · #312: no WS_THICKFRAME (Electron drops it for a transparent window; said outright, as for the note's ears), so
      // Windows keeps no resize frame or minimum size of its own on this window.
      thickFrame: false,
      backgroundColor: "#00000000", title: t("타닥냥"),
      enableLargerThanScreen: offscreenEnabled,
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    // Over full-screen apps too (the pet stays off those), and clicks pass through to the window behind.
    window.setAlwaysOnTop(true, "screen-saver");
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    // #331: clicks pass through, but the page still hears the pointer move (`forward`) and says when it is over the cat.
    window.setIgnoreMouseEvents(true, { forward: true });
    this.interactive = false;
    this.ready = false;
    window.webContents.once("did-finish-load", () => {
      this.ready = true;
      // A key that brought it out before the page was there.
      if (this.lastKey !== undefined && performance.now() - this.lastKey < 200) window.webContents.send("typingCat:key");
    });
    void window.loadFile(path.join(this.rendererDirectory, "typingCat.html"));
    window.on("closed", () => { if (this.window === window) { this.window = undefined; this.ready = false; } });
    this.window = window;
    return window;
  }

  /** #304: the window's side at the chosen 크기 (112 DIP at 보통). */
  private get side(): number { return scaledSize(typingCatSize, this.store.prefs.typingSize ?? "regular"); }

  /** The displays as the kept place sees them (their work areas: above the taskbar). */
  private screens(): TypingScreen[] {
    return screen.getAllDisplays().map((display) => ({ id: String(display.id), frame: display.bounds, visible: display.workArea }));
  }

  /** 옮긴 자리 when chosen and kept; otherwise the corner of the display the cursor is on (its work area). */
  private frame(): Electron.Rectangle {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const { typingCorner, typingPlace } = this.store.prefs;
    const frame = typingCatFrameFor(typingCorner, typingPlace, display.workArea, 0, this.side, this.screens());
    return { x: Math.round(frame.x + offscreen.x), y: Math.round(frame.y + offscreen.y), width: Math.round(frame.width), height: Math.round(frame.height) };
  }

  /** Put in its place — never while it is held (a key or a display change mid-drag leaves it in the hand). */
  private place(): void {
    const window = this.window;
    if (!window || window.isDestroyed() || this.drag) return;
    const frame = this.frame();
    const now = window.getBounds();
    if (now.x !== frame.x || now.y !== frame.y || now.width !== frame.width || now.height !== frame.height) window.setBounds(frame);
  }

  private show(): void {
    const window = this.ensureWindow();
    this.place();
    if (this.hideTimer !== undefined) {
      clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
      window.webContents.send("typingCat:away", false);
    }
    if (!window.isVisible()) window.showInactive();
  }

  /** Quietly away: the page fades, then the window hides (kept for the next key). */
  private hide(): void {
    this.clearGo();
    this.drag = undefined;
    this.setInteractive(false);
    const window = this.window;
    if (!window || window.isDestroyed() || !window.isVisible() || this.hideTimer !== undefined) return;
    window.webContents.send("typingCat:away", true);
    this.hideTimer = setTimeout(() => {
      this.hideTimer = undefined;
      if (!window.isDestroyed()) window.hide();
    }, offscreenEnabled ? 0 : fadeMs);
  }

  /** 종이냥에서만: one wait until `typingLingerMs` after the last key or drop. Held by a drag it waits; letting go starts it again. */
  private armGo(): void {
    if (this.goTimer !== undefined) return;
    const wake = () => {
      const last = lastTouch(this.lastKey, this.droppedAt) ?? 0;
      this.goTimer = setTimeout(() => {
        this.goTimer = undefined;
        if (this.drag) return;
        const touched = lastTouch(this.lastKey, this.droppedAt);
        if (this.source === "app" && touched !== undefined && performance.now() - touched < typingLingerMs) { wake(); return; }
        this.update();
      }, Math.max(0, last + typingLingerMs - performance.now()));
    };
    wake();
  }

  // ─── Moving it (#331) ───────────────────────────────────────────────────────

  private setInteractive(interactive: boolean): void {
    const window = this.window;
    if (this.interactive === interactive || !window || window.isDestroyed()) return;
    this.interactive = interactive;
    window.setIgnoreMouseEvents(!interactive, { forward: true });
  }

  private registerIPC(): void {
    const fromCat = (event: Electron.IpcMainEvent) => this.window !== undefined && !this.window.isDestroyed() && event.sender === this.window.webContents;
    // Only the drawn cat takes the mouse; everywhere else clicks fall through.
    ipcMain.on("typingCat:interactive", (event, interactive: unknown) => { if (fromCat(event) && !this.drag) this.setInteractive(interactive === true); });
    ipcMain.on("typingCat:drag-start", (event) => {
      if (!fromCat(event) || !this.window || !this.isShown) return;
      this.drag = { cursor: screen.getCursorScreenPoint(), bounds: this.window.getBounds() };
    });
    ipcMain.on("typingCat:drag", (event) => {
      if (!fromCat(event) || !this.window || !this.drag) return;
      const cursor = screen.getCursorScreenPoint(), { bounds } = this.drag;
      // #316: the whole bounds, never setPosition (it re-reads the size, which 125 % · 150 % can round up a pixel a move).
      this.window.setBounds({ x: Math.round(bounds.x + cursor.x - this.drag.cursor.x), y: Math.round(bounds.y + cursor.y - this.drag.cursor.y),
        width: bounds.width, height: bounds.height });
    });
    ipcMain.on("typingCat:drag-end", (event) => { if (fromCat(event)) this.dragEnded(); });
  }

  /** Let go: kept wholly on the display it is mostly on, and that place kept as 옮긴 자리 (chosen in Settings now). */
  private dragEnded(): void {
    const window = this.window, drag = this.drag;
    if (!window || window.isDestroyed() || !drag) return;
    this.drag = undefined;
    this.droppedAt = performance.now();
    const now = window.getBounds();
    // Always the size it had, so a DPI change mid-drag can't make a drifted size stick.
    const size = { width: drag.bounds.width, height: drag.bounds.height };
    const dropped = typingDropped({ x: now.x - offscreen.x, y: now.y - offscreen.y, ...size }, this.screens());
    if (dropped) {
      this.store.setPref("typingPlace", dropped.place);
      if (this.store.prefs.typingCorner !== "moved") this.store.setPref("typingCorner", "moved");
      window.setBounds({ x: Math.round(dropped.frame.x + offscreen.x), y: Math.round(dropped.frame.y + offscreen.y), ...size });
    }
    // 종이냥에서만: it stays `typingLingerMs` from now, then goes.
    this.update();
  }

  /** Snapshots and tests: a drag as the page makes one — pressed, the window moved by `dx` · `dy`, let go. */
  dragBy(dx: number, dy: number): void {
    const window = this.window;
    if (!window || window.isDestroyed() || !this.isShown) return;
    const bounds = window.getBounds();
    this.drag = { cursor: { x: 0, y: 0 }, bounds };
    window.setBounds({ ...bounds, x: bounds.x + dx, y: bounds.y + dy });
    this.dragEnded();
  }

  private clearGo(): void {
    clearTimeout(this.goTimer);
    this.goTimer = undefined;
  }

  private destroy(): void {
    clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    const window = this.window;
    this.window = undefined;
    this.ready = false;
    if (window && !window.isDestroyed()) window.destroy();
  }

  /** Quitting: the hook comes off first. */
  dispose(): void {
    this.keys?.listen(false);
    this.clearGo();
    this.destroy();
  }

  /** Whether the keyboard hook is set now. */
  get hooked(): boolean { return this.keys?.listening === true; }

  /** Snapshots: where the window is now (off-screen in a test run). */
  get bounds(): Electron.Rectangle | undefined {
    return this.window && !this.window.isDestroyed() ? this.window.getBounds() : undefined;
  }

  /** Tests: nothing waits or runs (the page's paw timer is the page's). */
  get quiet(): boolean { return this.goTimer === undefined && this.hideTimer === undefined; }

  // ─── Snapshots ──────────────────────────────────────────────────────────────

  /** The cat in its corner with this paw down (snapshots: nothing heard, the window shown as a key would). */
  async preview(pose: TypingPose): Promise<Electron.NativeImage> {
    const window = this.ensureWindow();
    this.place();
    if (!window.isVisible()) window.showInactive();
    if (!this.ready) await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));
    // A refresh between previews faded the page away (its window hidden): back, or the picture is empty.
    window.webContents.send("typingCat:away", false);
    window.webContents.send("typingCat:pose", pose);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return window.webContents.capturePage();
  }
}
