import { BrowserWindow, ipcMain, screen, type BrowserWindowConstructorOptions } from "electron";
import path from "node:path";
import { offscreenEnabled } from "./env";

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
