import { app } from "electron";
import { createRequire } from "node:module";
import { HC_ACTION, WH_KEYBOARD_LL, type KeyHookNative } from "../core/keyHook";
import { offscreenEnabled } from "./env";
import { koffiPath } from "./stayBehind";

/**
 * 모든 앱에서 on Windows (#288): user32's low-level keyboard hook, reached through Koffi (the binary main/stayBehind.ts
 * already loads, #272). Loaded only the first time 모든 앱에서 is chosen, never in an off-screen run, a test or the
 * `--mcp-stdio` mode (entry.ts loads none of the app there), and nowhere but Windows.
 *
 * The hook runs on the main thread, which pumps Windows' messages; every key of every app waits for it, so it does as
 * little as it can: for HC_ACTION it reads the message and the first field of KBDLLHOOKSTRUCT (the virtual-key code —
 * nothing else of the struct: no scan code, no flags, no time), hands both to core/keyHook.ts, and passes the key on
 * with CallNextHookEx whatever happened. Modifiers are read with GetAsyncKeyState when a key may count.
 */

interface Koffi {
  load(name: string): { func(prototype: string): (...args: unknown[]) => unknown };
  proto?(prototype: string): unknown;
  callback?(prototype: string): unknown;
  pointer(type: unknown): unknown;
  register(callback: (...args: never[]) => unknown, type: unknown): unknown;
  unregister(callback: unknown): void;
  decode(pointer: unknown, type: string): unknown;
}

const VK_CONTROL = 0x11;
const VK_MENU = 0x12;
const VK_LWIN = 0x5b;
const VK_RWIN = 0x5c;

/** The hook's native side, or undefined where there is none (then 모든 앱에서 hears this app only and Settings says so). */
export function loadKeyHook(): KeyHookNative | undefined {
  if (process.platform !== "win32" || offscreenEnabled) return undefined;
  try {
    const koffi = createRequire(__filename)(koffiPath(app.isPackaged, process.resourcesPath, app.getAppPath())) as Koffi;
    const user32 = koffi.load("user32.dll");
    const kernel32 = koffi.load("kernel32.dll");
    const proto = (koffi.proto ?? koffi.callback)!.bind(koffi);
    const hookProc = proto("intptr __stdcall LowLevelKeyboardProc(int nCode, uintptr wParam, void *lParam)");
    const setWindowsHookEx = user32.func("intptr __stdcall SetWindowsHookExW(int idHook, LowLevelKeyboardProc *lpfn, intptr hmod, uint32 dwThreadId)");
    const unhookWindowsHookEx = user32.func("int __stdcall UnhookWindowsHookEx(intptr hhk)");
    const callNextHookEx = user32.func("intptr __stdcall CallNextHookEx(intptr hhk, int nCode, uintptr wParam, void *lParam)");
    const getAsyncKeyState = user32.func("int16 __stdcall GetAsyncKeyState(int vKey)");
    const getModuleHandle = kernel32.func("intptr __stdcall GetModuleHandleW(const char16_t *lpModuleName)");
    const down = (vk: number) => (Number(getAsyncKeyState(vk)) & 0x8000) !== 0;
    let hook = 0;
    let registered: unknown;
    const release = () => {
      if (registered !== undefined) koffi.unregister(registered);
      registered = undefined;
    };
    return {
      install(proc) {
        if (hook) return true;
        registered = koffi.register((nCode: number, wParam: number, lParam: unknown) => {
          if (nCode === HC_ACTION) {
            try {
              proc(Number(wParam), Number(koffi.decode(lParam, "uint32")));
            } catch {
              // The key goes on to the next hook whatever happened here.
            }
          }
          return callNextHookEx(0, nCode, wParam, lParam);
        }, koffi.pointer(hookProc));
        hook = Number(setWindowsHookEx(WH_KEYBOARD_LL, registered, getModuleHandle(null), 0));
        if (!hook) release();
        return hook !== 0;
      },
      uninstall() {
        if (hook) unhookWindowsHookEx(hook);
        hook = 0;
        release();
      },
      modifiers: () => ({ ctrl: down(VK_CONTROL), alt: down(VK_MENU), win: down(VK_LWIN) || down(VK_RWIN) }),
    };
  } catch (error) {
    console.warn(`keyHook: the keyboard hook isn't available (${error instanceof Error ? error.message : String(error)}); 모든 앱에서 hears this app only`); // i18n-ok: a log line
    return undefined;
  }
}
