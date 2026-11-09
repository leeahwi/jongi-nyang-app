import { app } from "electron";
import { createRequire } from "node:module";
import path from "node:path";
import { StayBehind, HWND_BOTTOM, bottomFlags, type PushDown } from "../core/stayBehind";
import { offscreenEnabled } from "./env";

/**
 * The one call Windows needs to keep a window under the others (core/stayBehind.ts): user32's SetWindowPos, reached
 * through Koffi's prebuilt Windows binary (MIT, about 1 MB; package.json `optionalDependencies`, shipped as
 * resources/native/koffi.node and fetched for a build on another system by tools/native.mjs). Nothing else of it is used.
 * Anywhere else — macOS, an off-screen run, a binary that won't load — there is no call and the windows stay ordinary.
 */

interface Koffi {
  load(name: string): { func(prototype: string): (...args: number[]) => number };
}

/** Where the binary is: beside the app in a release (extraResources), in node_modules while developing. */
export function koffiPath(packaged: boolean, resources: string, appPath: string): string {
  return packaged
    ? path.join(resources, "native", "koffi.node")
    : path.join(appPath, "node_modules", "@koromix", "koffi-win32-x64", "win32_x64", "koffi.node");
}

function loadPushDown(): PushDown | undefined {
  if (process.platform !== "win32" || offscreenEnabled) return undefined;
  try {
    const koffi = createRequire(__filename)(koffiPath(app.isPackaged, process.resourcesPath, app.getAppPath())) as Koffi;
    const setWindowPos = koffi.load("user32.dll").func("int __stdcall SetWindowPos(intptr hWnd, intptr hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)");
    return (hwnd) => { setWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0, bottomFlags); };
  } catch (error) {
    console.warn(`stayBehind: SetWindowPos not loaded (${error instanceof Error ? error.message : String(error)}); windows meant to stay behind stay ordinary`);
    return undefined;
  }
}

let shared: StayBehind | undefined;

/** The app's one keeper (loaded the first time it's asked for). */
export function stayBehind(): StayBehind {
  shared ??= new StayBehind(loadPushDown());
  return shared;
}
