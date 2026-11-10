import { app, screen, type BrowserWindow } from "electron";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import {
  CaptionDoubleClick, HC_ACTION, HTCAPTION, SM_CXDOUBLECLK, SM_CYDOUBLECLK, WH_MOUSE, WM_NCLBUTTONDBLCLK,
  captionMessage, fallbackLimits, isButtonPress, limitsFrom, pointFromLParam, type DoubleClickLimits,
} from "../core/captionClicks";
import { hwndOf } from "../core/stayBehind";
import { offscreenEnabled } from "./env";
import { koffiPath } from "./stayBehind";

/**
 * 노트 위쪽을 두 번 눌러 접기 on Windows (#323; why the old hookWindowMessage alone never heard it: core/captionClicks.ts).
 *
 * A WH_MOUSE hook on the main thread only (SetWindowsHookExW with this thread's id and no module: nothing is injected
 * into other apps, and only this app's mouse messages pass through it), reached through Koffi like main/keyHook.ts.
 * Windows calls it as the main thread takes a mouse message out of its queue, before the message goes to any window,
 * so it hears the presses that Chromium's child window takes. It doesn't wrap the message's handling (a drag's move
 * loop runs after it returns, not inside it), changes nothing and always passes the message on with CallNextHookEx.
 * For a button press it reads the message's window, hit-test code and point (MOUSEHOOKSTRUCT); moves and releases
 * return at once. Dragging the note, Aero Snap and the right-click menu stay Windows' own.
 *
 * Not on macOS, in an off-screen run or a test, or where Koffi won't load: then only the old hook is left.
 */

interface Koffi {
  load(name: string): { func(prototype: string): (...args: unknown[]) => unknown };
  proto?(prototype: string): unknown;
  callback?(prototype: string): unknown;
  struct(name: string, members: Record<string, string>): unknown;
  pointer(type: unknown): unknown;
  register(callback: (...args: never[]) => unknown, type: unknown): unknown;
  unregister(callback: unknown): void;
  decode(pointer: unknown, type: unknown): unknown;
}

const GA_ROOT = 2;

interface MouseHookStruct { x: number; y: number; hwnd: number | bigint; wHitTestCode: number }

/** What NoteCaptionClicks needs of Windows (nothing of it outside Windows). */
interface CaptionHookNative {
  /** Sets the hook; `proc` gets each button press: message, hit-test code, point (screen px), its top-level window. */
  install(proc: (message: number, hitTest: number, x: number, y: number, root: number) => void): boolean;
  uninstall(): void;
  limits(): DoubleClickLimits;
}

let native: CaptionHookNative | undefined;
let loaded = false;

/** Koffi's types have one name each, so the native side is made once. */
function loadNative(): CaptionHookNative | undefined {
  if (loaded) return native;
  loaded = true;
  if (process.platform !== "win32" || offscreenEnabled) return undefined;
  try {
    const koffi = createRequire(__filename)(koffiPath(app.isPackaged, process.resourcesPath, app.getAppPath())) as Koffi;
    const user32 = koffi.load("user32.dll");
    const kernel32 = koffi.load("kernel32.dll");
    const proto = (koffi.proto ?? koffi.callback)!.bind(koffi);
    const hookProc = proto("intptr __stdcall CaptionMouseProc(int nCode, uintptr wParam, void *lParam)");
    // MOUSEHOOKSTRUCT: POINT pt (two 32-bit LONGs), HWND hwnd, UINT wHitTestCode, ULONG_PTR dwExtraInfo.
    const mouseHookStruct = koffi.struct("CAPTION_MOUSEHOOKSTRUCT", { x: "int32", y: "int32", hwnd: "intptr", wHitTestCode: "uint32", dwExtraInfo: "uintptr" });
    const setWindowsHookEx = user32.func("intptr __stdcall SetWindowsHookExW(int idHook, CaptionMouseProc *lpfn, intptr hmod, uint32 dwThreadId)");
    const unhookWindowsHookEx = user32.func("int __stdcall UnhookWindowsHookEx(intptr hhk)");
    const callNextHookEx = user32.func("intptr __stdcall CallNextHookEx(intptr hhk, int nCode, uintptr wParam, void *lParam)");
    const getAncestor = user32.func("intptr __stdcall GetAncestor(intptr hwnd, uint32 gaFlags)");
    const getDoubleClickTime = user32.func("uint32 __stdcall GetDoubleClickTime()");
    const getSystemMetrics = user32.func("int __stdcall GetSystemMetrics(int nIndex)");
    const getCurrentThreadId = kernel32.func("uint32 __stdcall GetCurrentThreadId()");
    let hook = 0;
    let registered: unknown;
    const release = () => {
      if (registered !== undefined) koffi.unregister(registered);
      registered = undefined;
    };
    native = {
      install(proc) {
        if (hook) return true;
        registered = koffi.register((nCode: number, wParam: number | bigint, lParam: unknown) => {
          if (nCode === HC_ACTION) {
            try {
              const message = Number(wParam);
              if (isButtonPress(message)) {
                const info = koffi.decode(lParam, mouseHookStruct) as MouseHookStruct;
                proc(message, Number(info.wHitTestCode), Number(info.x), Number(info.y), Number(getAncestor(info.hwnd, GA_ROOT)));
              }
            } catch {
              // The message goes on whatever happened here.
            }
          }
          return callNextHookEx(0, nCode, wParam, lParam);
        }, koffi.pointer(hookProc));
        // This thread only (its id, no module): not a system-wide hook.
        hook = Number(setWindowsHookEx(WH_MOUSE, registered, 0, getCurrentThreadId()));
        if (!hook) release();
        return hook !== 0;
      },
      uninstall() {
        if (hook) unhookWindowsHookEx(hook);
        hook = 0;
        release();
      },
      limits: () => limitsFrom(Number(getDoubleClickTime()), Number(getSystemMetrics(SM_CXDOUBLECLK)), Number(getSystemMetrics(SM_CYDOUBLECLK))),
    };
    return native;
  } catch (error) {
    console.warn(`captionClicks: the mouse hook isn't available (${error instanceof Error ? error.message : String(error)}); only WM_NCLBUTTONDBLCLK on the note is heard`); // i18n-ok: a log line
    return undefined;
  }
}

/**
 * Double-clicking the note's title-bar area (the empty tab row and title row) folds the note, once per double-click.
 * Heard two ways, decided in one place (core/captionClicks.ts): the thread's mouse hook, and the note's own
 * WM_NCLBUTTONDBLCLK (kept in case a Chromium ever sends it there).
 */
export class NoteCaptionClicks {
  private readonly hook = loadNative();
  private readonly decider = new CaptionDoubleClick(() => this.hook?.limits() ?? fallbackLimits);
  private readonly hwnd: number;

  constructor(private readonly note: BrowserWindow, private readonly fold: (point: Electron.Point) => void) {
    this.hwnd = hwndOf(note.getNativeWindowHandle());
    note.hookWindowMessage(WM_NCLBUTTONDBLCLK, (wParam: Buffer, lParam: Buffer) => {
      if (hwndOf(wParam) !== HTCAPTION) return;
      const { x, y } = pointFromLParam(hwndOf(lParam));
      this.heard("double", x, y);
    });
    const installed = this.hook?.install((message, hitTest, x, y, root) => {
      const kind = captionMessage(message, hitTest);
      if (kind === "other" || (kind && root !== this.hwnd)) this.decider.forget();
      else if (kind) this.heard(kind, x, y);
    });
    if (this.hook && !installed) console.warn("captionClicks: Windows didn't set the mouse hook; only WM_NCLBUTTONDBLCLK on the note is heard"); // i18n-ok: a log line
    note.once("closed", () => this.dispose());
  }

  /** Takes the hook off (quitting, or the note gone). */
  dispose(): void {
    this.hook?.uninstall();
  }

  private heard(kind: "press" | "double", x: number, y: number): void {
    if (this.note.isDestroyed() || !this.note.isVisible()) return;
    const [windowX, windowY] = this.note.getPosition();
    if (!this.decider.press({ kind, time: performance.now(), x, y, windowX, windowY })) return;
    // Folded after the message is handled, not inside the hook or the window procedure; where the pointer is then.
    setImmediate(() => { if (!this.note.isDestroyed()) this.fold(screen.getCursorScreenPoint()); });
  }
}
