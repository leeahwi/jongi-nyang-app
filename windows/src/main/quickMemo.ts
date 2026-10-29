import { BrowserWindow, clipboard, globalShortcut, ipcMain, screen } from "electron";
import { clipboardPrefill } from "../core/memo";
import path from "node:path";
import { followSlip, slipWindowOptions } from "./slipWindow";
import { t } from "../i18n";
import { offscreen, shortcutsDisabled } from "./env";
import type { Store } from "./store";

export const quickMemoAccelerator = "Control+Alt+M";
/** The M slip (420 wide) and the room around it for the tape and the shadow; the height follows the slip. */
const shadowRoom = 16;
const size = { width: 420 + 48, height: 300 };

/**
 * 빠른 메모: Ctrl+Alt+M anywhere (or the tray, the pet, the note's ⋯) opens a small paper card with
 * a few lines to write in. Ctrl+Enter puts the text in the 메모 서랍 (its last folder) and closes; Esc or clicking
 * elsewhere closes and keeps the text for next time (prefs `quickMemoDraft`, so it survives a
 * restart). `live` is false in tests and snapshots, so no real shortcut is taken there.
 */
export class QuickMemo {
  private window?: BrowserWindow;
  private registered = false;
  private loaded = false;
  private waiting?: { text: string; copied?: boolean };
  /** 복사한 글 넣기: the clipboard's text when the memo last opened (or the setting was turned on); only kept in memory. */
  private lastSeen?: string;

  /** `saved`: a memo was put in (the note says so, with 열기 for the 메모 서랍). */
  constructor(private readonly store: Store, private readonly rendererDirectory: string, private readonly live: boolean, private readonly saved: (id: string) => void = () => undefined) {
    const fromCard = (event: Electron.IpcMainEvent) => this.window !== undefined && !this.window.isDestroyed() && event.sender === this.window.webContents;
    ipcMain.on("quickMemo:draft", (event, text: unknown) => { if (fromCard(event) && typeof text === "string") this.keepDraft(text); });
    ipcMain.on("quickMemo:close", (event, text: unknown) => {
      if (!fromCard(event)) return;
      if (typeof text === "string") this.keepDraft(text);
      this.hide();
    });
    ipcMain.on("quickMemo:save", (event, text: unknown) => {
      if (!fromCard(event) || typeof text !== "string") return;
      if (text.trim()) {
        const id = store.addMemoText(text.replace(/\s+$/, ""));
        this.keepDraft("");
        if (id) this.saved(id);
      }
      this.hide();
    });
    store.on("prefs", (key: string) => {
      if (key === "quickMemo") this.updateShortcut();
      if (key === "quickMemoClipboard") this.markClipboard();
    });
    // What was on the clipboard before the app started isn't "just copied".
    this.markClipboard();
    this.updateShortcut();
  }

  private keepDraft(text: string): void {
    if (this.store.prefs.quickMemoDraft !== text) this.store.setPref("quickMemoDraft", text);
  }

  /** Takes or gives back Ctrl+Alt+M; when another app already holds it, Settings says so. */
  private updateShortcut(): void {
    if (!this.live || shortcutsDisabled) return;
    const wanted = this.store.prefs.quickMemo;
    if (wanted && !this.registered) {
      try {
        this.registered = globalShortcut.register(quickMemoAccelerator, () => this.open());
      } catch {
        this.registered = false;
      }
    } else if (!wanted && this.registered) {
      globalShortcut.unregister(quickMemoAccelerator);
      this.registered = false;
    }
    const problem = wanted && !this.registered ? t("다른 앱이 Ctrl+Alt+M을 쓰고 있어요. 그 앱의 단축키를 바꾼 뒤 다시 켜 주세요.") : undefined;
    if (problem !== this.store.memoShortcutProblem) {
      this.store.memoShortcutProblem = problem;
      this.store.changed();
    }
  }

  /** 복사한 글 넣기 turned on (or the app started): what is on the clipboard now isn't new. */
  private markClipboard(): void {
    this.lastSeen = undefined;
    if (!this.store.prefs.quickMemoClipboard || !this.live) return;
    void clipboard.readText().then((text) => { this.lastSeen = text; }, () => undefined);
  }

  /** Centred on the screen with the mouse, a quarter of the way down, taking focus. */
  open(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) return this.hide();
    void this.openWith();
  }

  private async openWith(): Promise<void> {
    const window = this.ensureWindow();
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    const [width, height] = window.getSize();
    window.setBounds({
      x: Math.round(area.x + (area.width - width) / 2 + offscreen.x),
      y: Math.round(area.y + area.height / 4 - shadowRoom + offscreen.y),
      width, height,
    });
    // 복사한 글 넣기: an empty draft takes what was copied since the last time (selected, so typing replaces it).
    let text = this.store.prefs.quickMemoDraft;
    let copied = false;
    if (this.store.prefs.quickMemoClipboard) {
      const now = await clipboard.readText().catch(() => "");
      const prefill = clipboardPrefill(text, now, this.lastSeen);
      this.lastSeen = now;
      if (prefill) { text = prefill; copied = true; }
    }
    this.send({ text, copied });
    window.show();
    window.setAlwaysOnTop(true, "pop-up-menu");
    window.moveTop();
    window.focus();
    window.webContents.focus();
  }

  hide(): void {
    if (this.window && !this.window.isDestroyed() && this.window.isVisible()) this.window.hide();
  }

  /** Snapshots: the card off-screen, not focused, with `text` written in it. */
  async showForSnapshot(text: string, copied = false): Promise<void> {
    const window = this.ensureWindow();
    const [width, height] = window.getSize();
    window.setBounds({ x: offscreen.x + 200, y: offscreen.y + 200, width, height });
    window.showInactive();
    if (!this.loaded) await new Promise<void>((resolve) => window.webContents.once("did-finish-load", () => resolve()));
    this.send({ text, copied });
  }

  capture(): Promise<Electron.NativeImage> | undefined {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) return undefined;
    return this.window.webContents.capturePage();
  }

  /** Snapshots: the window, to check its layout. */
  get snapshotWindow(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  dispose(): void {
    if (this.registered) globalShortcut.unregister(quickMemoAccelerator);
    this.registered = false;
  }

  private send(payload: { text: string; copied?: boolean }): void {
    const window = this.window;
    if (!window || window.isDestroyed()) return;
    if (this.loaded) window.webContents.send("quickMemo:open", payload);
    else this.waiting = payload;
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow(slipWindowOptions(size, t("종이냥 빠른 메모")));
    followSlip(window);
    window.setVisibleOnAllWorkspaces(true);
    this.loaded = false;
    window.webContents.once("did-finish-load", () => {
      this.loaded = true;
      const payload = this.waiting;
      this.waiting = undefined;
      if (payload && !window.isDestroyed()) window.webContents.send("quickMemo:open", payload);
    });
    window.loadFile(path.join(this.rendererDirectory, "quickMemo.html"));
    // Clicking anywhere else puts it away (the page sends its text along when it loses focus).
    window.on("blur", () => {
      if (!this.live || window.isDestroyed()) return;
      window.webContents.send("quickMemo:blur");
    });
    window.on("closed", () => { if (this.window === window) this.window = undefined; });
    this.window = window;
    return window;
  }
}
