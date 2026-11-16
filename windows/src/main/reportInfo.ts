import { app, screen, type BrowserWindow } from "electron";
import os from "node:os";
import { reportText, type ReportWindow } from "../core/reportInfo";
import { hwndOf } from "../core/stayBehind";
import { lang } from "../i18n";
import { windowsNative } from "./native/user32";

/**
 * #409: 문제 보고용 정보 복사 — gathers what core/reportInfo.ts writes out: Electron's displays, the given windows'
 * bounds and, on Windows, their style bits (GetWindowLongPtrW through the shared Koffi loader, main/native/user32.ts),
 * and the GPU's feature status. Reads nothing of the person's data and no path.
 */

const GWL_STYLE = -16;
const GWL_EXSTYLE = -20;

let getWindowLong: ((hwnd: number, index: number) => number) | null | undefined;

/** GetWindowLongPtrW, declared the first time it's asked for; null where there is none (not Windows, off-screen, no Koffi). */
function windowLong(): ((hwnd: number, index: number) => number) | null {
  if (getWindowLong !== undefined) return getWindowLong;
  try {
    const native = windowsNative();
    if (!native) return (getWindowLong = null);
    const call = native.user32.func("intptr __stdcall GetWindowLongPtrW(intptr hWnd, int nIndex)");
    getWindowLong = (hwnd, index) => Number(BigInt.asUintN(32, BigInt(call(hwnd, index) as number | bigint)));
  } catch (error) {
    console.warn(`reportInfo: GetWindowLongPtrW not loaded (${error instanceof Error ? error.message : String(error)}); no style bits`); // i18n-ok: a log line
    getWindowLong = null;
  }
  return getWindowLong;
}

function reportWindow(name: string, window: BrowserWindow | undefined): ReportWindow {
  if (!window || window.isDestroyed()) return { name, state: "none" };
  const entry: ReportWindow = { name, state: window.isVisible() ? "shown" : "hidden", bounds: window.getBounds(), contentBounds: window.getContentBounds(), alwaysOnTop: window.isAlwaysOnTop() };
  const read = windowLong();
  if (read) {
    try {
      const hwnd = hwndOf(window.getNativeWindowHandle());
      entry.style = read(hwnd, GWL_STYLE);
      entry.exStyle = read(hwnd, GWL_EXSTYLE);
    } catch {
      // No style bits for this one.
    }
  }
  return entry;
}

/** The text for the clipboard. `windows`: the windows to describe, by a name of the app's own; `settings`: the app's choices. */
export function reportInfo(windows: [string, BrowserWindow | undefined][], settings: Record<string, string | number | boolean>): string {
  const primary = screen.getPrimaryDisplay().id;
  const gpu = Object.fromEntries(Object.entries(app.getGPUFeatureStatus()).map(([key, value]) => [key, String(value)]));
  return reportText({
    app: `${app.getName()} ${app.getVersion()}${app.isPackaged ? "" : " (not packaged)"}`,
    electron: process.versions.electron ?? "",
    chrome: process.versions.chrome ?? "",
    os: `${process.platform} ${os.release()} ${process.arch}`,
    lang: lang(),
    displays: screen.getAllDisplays().map((display) => ({
      id: display.id, bounds: display.bounds, workArea: display.workArea, scaleFactor: display.scaleFactor, rotation: display.rotation,
      internal: display.internal, primary: display.id === primary,
    })),
    windows: windows.map(([name, window]) => reportWindow(name, window)),
    gpu,
    settings,
  });
}
