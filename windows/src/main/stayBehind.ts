import { StayBehind, HWND_BOTTOM, bottomFlags, type PushDown } from "../core/stayBehind";
import { windowsNative } from "./native/user32";

/**
 * The one call Windows needs to keep a window under the others (core/stayBehind.ts): user32's SetWindowPos, reached
 * through Koffi (main/native/user32.ts). Anywhere else — macOS, an off-screen run, a binary that won't load — there is
 * no call and the windows stay ordinary.
 */

function loadPushDown(): PushDown | undefined {
  try {
    const native = windowsNative();
    if (!native) return undefined;
    const setWindowPos = native.user32.func("int __stdcall SetWindowPos(intptr hWnd, intptr hWndInsertAfter, int X, int Y, int cx, int cy, uint32 uFlags)");
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
