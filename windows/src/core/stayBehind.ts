/**
 * 바탕화면에 두기 on Windows (#272 · #273): a window kept under every other window, as the Mac's desktop level does.
 * Electron has no level under the others, so each time a kept window may have come forward (Windows tells it with
 * WM_WINDOWPOSCHANGED: a click, a drag, being shown) it is sent back to the bottom of the order without taking the
 * keyboard (SetWindowPos with HWND_BOTTOM and SWP_NOACTIVATE, main/stayBehind.ts). The call itself is handed in, so
 * this file runs anywhere and the tests use a fake.
 *
 * - 달력 위젯 with ‘항상 위에 두기’ off: always at the bottom (they never take the keyboard).
 * - The note on 바탕화면에 두기: at the bottom too, and a click or typing on it doesn't bring it forward. Summoned — the
 *   note's key, the tray, a notice, Alt+Tab or its taskbar button — it comes forward until it loses the keyboard
 *   (another window clicked), then goes back.
 * - Nothing is pushed while the window is disabled (a file dialog over it) or `holds` says so (a question asked over
 *   it, which Windows keeps just above its owner and would take down with it).
 */

/** 노트 위치 (#273): 보통 · 항상 위에 두기 · 바탕화면에 두기. */
export type NoteLayer = "normal" | "top" | "desktop";
export const noteLayers: readonly NoteLayer[] = ["normal", "top", "desktop"];

/**
 * The note's place as saved: `noteLayer` since #273; before it, the pin's switch `alwaysOnTop` (on: 항상 위에 두기).
 * The switch is still written beside the choice, so an older version keeps 항상 위에 두기 (and reads 바탕화면 as 보통).
 */
export function readNoteLayer(saved: unknown, legacyOnTop: unknown): NoteLayer {
  if (saved === "normal" || saved === "top" || saved === "desktop") return saved;
  return legacyOnTop === true ? "top" : "normal";
}

export const WM_WINDOWPOSCHANGED = 0x0047;
export const HWND_BOTTOM = 1;
/** SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER: only the order changes, nothing takes the keyboard. */
export const bottomFlags = 0x0001 | 0x0002 | 0x0010 | 0x0200;

/** A window's HWND from Electron's getNativeWindowHandle() (8 bytes on 64-bit Windows, 4 on 32-bit). */
export function hwndOf(handle: Uint8Array): number {
  const view = new DataView(handle.buffer, handle.byteOffset, handle.byteLength);
  if (handle.byteLength >= 8) return Number(view.getBigUint64(0, true));
  if (handle.byteLength >= 4) return view.getUint32(0, true);
  return 0;
}

/** Sends the window (its HWND) to the bottom of the order; throws if it can't. */
export type PushDown = (hwnd: number) => void;

/** What StayBehind uses of a window (a BrowserWindow; a fake in the tests). */
export interface BehindWindow {
  getNativeWindowHandle(): Uint8Array;
  hookWindowMessage(message: number, callback: () => void): void;
  unhookWindowMessage(message: number): void;
  on(event: "focus" | "blur", listener: () => void): unknown;
  removeListener(event: "focus" | "blur", listener: () => void): unknown;
  isDestroyed(): boolean;
  isVisible(): boolean;
  isEnabled(): boolean;
  isFocused(): boolean;
  isAlwaysOnTop(): boolean;
}

export interface KeepOptions {
  /** The note: it can be summoned forward (a widget never takes the keyboard, so it never is). */
  summonable?: boolean;
  /** The mouse is over the window now: a click on it, not a summons (Alt+Tab, the taskbar). */
  pointerInside?: () => boolean;
  /** Not now (a question asked over it). */
  holds?: () => boolean;
}

interface Kept {
  options: KeepOptions;
  /** Summoned: in front until it loses the keyboard. */
  front: boolean;
  pending: boolean;
  focus: () => void;
  blur: () => void;
}

export class StayBehind {
  private readonly kept = new Map<BehindWindow, Kept>();
  /** Inside our own call: the messages it causes are ours. */
  private pushing = false;
  private broken = false;

  /**
   * `push` undefined (not Windows, an off-screen run, the call couldn't be loaded): nothing is ever pushed and the
   * windows stay ordinary. `later` runs a push after the message that asked for it (tests: at once).
   */
  constructor(private readonly push: PushDown | undefined, private readonly later: (run: () => void) => void = (run) => { setImmediate(run); },
    private readonly warn: (message: string) => void = (message) => console.warn(message)) {}

  /** Whether windows can be kept behind here. */
  get works(): boolean { return Boolean(this.push) && !this.broken; }

  /** Keeps `window` under the others from now on (again: new options). */
  keep(window: BehindWindow, options: KeepOptions = {}): void {
    if (!this.works || window.isDestroyed()) return;
    const existing = this.kept.get(window);
    if (existing) { existing.options = options; this.request(window); return; }
    const entry: Kept = {
      options, front: false, pending: false,
      // Alt+Tab or the taskbar brought it forward: it stays until another window is clicked.
      focus: () => { if (entry.options.summonable && !entry.options.pointerInside?.()) entry.front = true; },
      blur: () => { entry.front = false; this.request(window); },
    };
    this.kept.set(window, entry);
    window.on("focus", entry.focus);
    window.on("blur", entry.blur);
    window.hookWindowMessage(WM_WINDOWPOSCHANGED, () => { if (!this.pushing) this.request(window); });
    this.request(window);
  }

  /** An ordinary window again (항상 위에 두기, 보통, or it closes). */
  release(window: BehindWindow): void {
    const entry = this.kept.get(window);
    if (!entry) return;
    this.kept.delete(window);
    if (window.isDestroyed()) return;
    window.removeListener("focus", entry.focus);
    window.removeListener("blur", entry.blur);
    window.unhookWindowMessage(WM_WINDOWPOSCHANGED);
  }

  isKept(window: BehindWindow): boolean { return this.kept.has(window); }

  /** Summoned forward (the note's key, the tray, a notice): call before showing and focusing it. */
  summon(window: BehindWindow): void {
    const entry = this.kept.get(window);
    if (entry?.options.summonable) entry.front = true;
  }

  /** In front for now (summoned, not yet left); a window not kept counts as in front. */
  inFront(window: BehindWindow): boolean {
    const entry = this.kept.get(window);
    return !entry || entry.front;
  }

  private request(window: BehindWindow): void {
    const entry = this.kept.get(window);
    if (!entry || entry.pending) return;
    entry.pending = true;
    this.later(() => {
      entry.pending = false;
      if (this.kept.get(window) === entry) this.pushNow(window, entry);
    });
  }

  private pushNow(window: BehindWindow, entry: Kept): void {
    if (!this.push || this.broken || window.isDestroyed() || !window.isVisible() || window.isAlwaysOnTop()) return;
    // Focused with the mouse elsewhere: summoned by the keyboard or the taskbar (the focus event may come after).
    if (entry.options.summonable && !entry.front && window.isFocused() && !entry.options.pointerInside?.()) entry.front = true;
    if (entry.front || !window.isEnabled() || entry.options.holds?.()) return;
    const hwnd = hwndOf(window.getNativeWindowHandle());
    if (!hwnd) return;
    this.pushing = true;
    try {
      this.push(hwnd);
    } catch (error) {
      // Once: the windows stay ordinary from here on.
      this.broken = true;
      this.warn(`stayBehind: windows can't be kept behind (${error instanceof Error ? error.message : String(error)})`);
    } finally {
      this.pushing = false;
    }
  }
}
