import { BrowserWindow, ipcMain, screen, type BrowserWindowConstructorOptions } from "electron";
import path from "node:path";
import { offscreenEnabled } from "./env";
import { draggedSlip, placedSlip, readSlipPlace, slipHead, slipPlace, type SlipPlace } from "../core/slipMove";
import type { Store } from "./store";

/**
 * The windows that hold one 쪽지 (slip): frameless, transparent around the paper so its tape and
 * shadow are never cut, and as big as the slip's stage — the page reports its size ("slip:size")
 * and the window follows, keeping its top edge and its middle where they were.
 */

const resizers = new Map<number, (size: { width: number; height: number }) => void>();
let listening = false;

export function slipWindowOptions(size: { width: number; height: number }, title: string, extra: Partial<BrowserWindowConstructorOptions> = {}): BrowserWindowConstructorOptions {
  return {
    ...size, show: false, frame: false, transparent: true, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, backgroundColor: "#00000000", title,
    // Off-screen runs (snapshots, tests): macOS pulls a window placed off every display back onto one unless it may be
    // larger than the screen (only macOS reads this).
    enableLargerThanScreen: offscreenEnabled,
    ...extra,
    webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, backgroundThrottling: false, ...extra.webPreferences },
  };
}

/** Keeps `window` the size its slip asks for; `onSize` hears every new size (the windows keep their own last size). */
export function followSlip(window: BrowserWindow, onSize?: (size: { width: number; height: number }) => void): void {
  if (!listening) {
    listening = true;
    ipcMain.on("slip:size", (event, size: unknown) => {
      const value = size as { width?: unknown; height?: unknown };
      if (typeof value?.width !== "number" || typeof value?.height !== "number") return;
      resizers.get(event.sender.id)?.({ width: Math.ceil(value.width), height: Math.ceil(value.height) });
    });
  }
  const id = window.webContents.id;
  resizers.set(id, (size) => {
    if (window.isDestroyed()) return;
    const width = Math.min(Math.max(size.width, 120), 900);
    const height = Math.min(Math.max(size.height, 80), 1000);
    const bounds = window.getBounds();
    if (bounds.width === width && bounds.height === height) return;
    const x = Math.round(bounds.x + (bounds.width - width) / 2);
    // Kept on its display (it grows downwards).
    const area = screen.getDisplayMatching(bounds).workArea;
    const y = !offscreenEnabled && window.isVisible() && bounds.y + height > area.y + area.height && area.height > 0 ? Math.max(area.y, area.y + area.height - height) : bounds.y;
    window.setBounds({ x, y, width, height });
    onSize?.({ width, height });
  });
  window.on("closed", () => resizers.delete(id));
}

/**
 * #246: 빠른 입력 · 빠른 메모 drag by their paper and title row (renderer/slip.ts dragByPaper, as the question slips of #228)
 * and keep where they were put, per display (core/slipMove.ts slipPlace · placedSlip, docs/plans/slip-move-cases.json
 * `place`), in the settings file's window memory. A display whose work area changed size since opens the slip at its
 * usual spot again, and a double-click on the paper puts it back there (forgetting the place). The Mac's SlipPlaces.
 */
export class KeptSlip {
  /** The window's stage around the paper (slip.css `.slip-stage`): 16 above, 24 at the sides, 30 below. */
  private static readonly stage = { top: 16, side: 24, bottom: 30 };
  private drag?: { x: number; y: number; bounds: Electron.Rectangle; moved: boolean };

  constructor(private readonly store: Store, private readonly which: "quick" | "quickMemo", private readonly slipWidth: number) {}

  private kept(): Record<string, SlipPlace> { return this.store.memory.slipPlaces?.[this.which] ?? {}; }

  private keep(places: Record<string, SlipPlace>): void {
    this.store.remember({ slipPlaces: { ...this.store.memory.slipPlaces, [this.which]: places } });
  }

  private static slipOf(bounds: Electron.Rectangle): { x: number; y: number; width: number; height: number } {
    const { top, side, bottom } = KeptSlip.stage;
    return { x: bounds.x + side, y: bounds.y + top, width: bounds.width - 2 * side, height: bounds.height - top - bottom };
  }

  /** Where the window goes on `display`: the slip at its kept place, else `usual` (the window's own top left). */
  origin(display: Electron.Display, usual: { x: number; y: number }): { x: number; y: number } {
    const at = placedSlip(readSlipPlace(this.kept()[String(display.id)]), { width: this.slipWidth, height: slipHead }, display.workArea);
    return at ? { x: Math.round(at.x - KeptSlip.stage.side), y: Math.round(at.y - KeptSlip.stage.top) } : usual;
  }

  /** The paper dragged (`reset`: double-clicked) in `window`; `usual` puts it back where it opens on a display. */
  dragged(window: BrowserWindow, phase: "start" | "move" | "end" | "reset", x: number, y: number, usual: (display: Electron.Display) => { x: number; y: number }): void {
    if (phase === "reset") {
      this.drag = undefined;
      const display = screen.getDisplayMatching(window.getBounds());
      const places = { ...this.kept() };
      delete places[String(display.id)];
      this.keep(places);
      if (!offscreenEnabled) { const to = usual(display); window.setPosition(to.x, to.y); }
      return;
    }
    if (phase === "start") { this.drag = { x, y, bounds: window.getBounds(), moved: false }; return; }
    const drag = this.drag;
    if (!drag) return;
    if (phase === "end") {
      this.drag = undefined;
      if (!drag.moved || offscreenEnabled) return;
      const slip = KeptSlip.slipOf(window.getBounds());
      const display = screen.getDisplayMatching(window.getBounds());
      this.keep({ ...this.kept(), [String(display.id)]: slipPlace(slip, display.workArea) });
      return;
    }
    if (!drag.moved && Math.hypot(x - drag.x, y - drag.y) < 3) return;
    drag.moved = true;
    // (An off-screen run's slip lives away from every display: nothing to keep it on.)
    const display = offscreenEnabled ? undefined : screen.getAllDisplays().find(({ bounds: area }) => x >= area.x && x < area.x + area.width && y >= area.y && y < area.y + area.height);
    const to = draggedSlip(KeptSlip.slipOf(drag.bounds), x - drag.x, y - drag.y, display?.workArea);
    // #316: the whole bounds, not setPosition (it re-reads the size, which 125 % · 150 % can round up a pixel a move).
    window.setBounds({ x: Math.round(to.x - KeptSlip.stage.side), y: Math.round(to.y - KeptSlip.stage.top), width: drag.bounds.width, height: drag.bounds.height });
  }
}
