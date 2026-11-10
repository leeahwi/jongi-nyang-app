/**
 * 노트 위쪽을 두 번 눌러 접기 on Windows (#323). The note's tab row and title row are `-webkit-app-region: drag`, so
 * Windows treats them as a title bar (HTCAPTION): the page never hears the clicks there, and Windows posts them as
 * non-client messages (WM_NCLBUTTONDOWN, then WM_NCLBUTTONDBLCLK for the second press).
 *
 * Those messages don't reach `BrowserWindow.hookWindowMessage`. Chromium covers the web page with a child window
 * (LegacyRenderWidgetHostHWND, class Chrome_RenderWidgetHostHWND) whose hit test answers with the note's own (HTCAPTION),
 * so Windows posts the clicks to that child. The child hands them to the note's handler directly
 * (HWNDMessageHandler::HandleMouseMessage, then ::DefWindowProc on the note), never through the note's window procedure,
 * where Electron's hook listens (NativeWindowViews::PreHandleMSG). With `maximizable: false` the note has no
 * WS_MAXIMIZEBOX either, so DefWindowProc sends no WM_SYSCOMMAND that could have been heard instead.
 *
 * So main/captionClicks.ts listens one step earlier, as the main thread takes each mouse message out of its queue
 * (a WH_MOUSE hook on that thread only, through Koffi), and this file decides: two presses on the note's title-bar area
 * within Windows' double-click time and rectangle fold the note once. A drag between them (the note moved), a press on
 * anything else (a tab, a button, a border), a slow or a far second press doesn't. Windows' own double-click message
 * folds too (it has already checked time and distance), unless the note moved since the first press; whichever way the
 * double-click is heard — this hook, the old hookWindowMessage, or both — it folds once.
 *
 * Nothing here calls Windows: the clicks and the limits are handed in, so the tests run anywhere.
 */

export const WH_MOUSE = 7;
export const HC_ACTION = 0;
export const HTCAPTION = 2;
export const WM_NCLBUTTONDOWN = 0x00a1;
export const WM_NCLBUTTONDBLCLK = 0x00a3;
export const WM_LBUTTONDOWN = 0x0201;
export const SM_CXDOUBLECLK = 36;
export const SM_CYDOUBLECLK = 37;

/** Every button press, in the window and on its frame: left · right · middle · X, down and double (not up, not moves). */
const buttonPresses = new Set([
  0x0201, 0x0203, 0x0204, 0x0206, 0x0207, 0x0209, 0x020b, 0x020d, // WM_LBUTTONDOWN … WM_XBUTTONDBLCLK
  0x00a1, 0x00a3, 0x00a4, 0x00a6, 0x00a7, 0x00a9, 0x00ab, 0x00ad, // WM_NCLBUTTONDOWN … WM_NCXBUTTONDBLCLK
]);

/** Whether a mouse message is a button press (the hook reads a message's details only then). */
export const isButtonPress = (message: number): boolean => buttonPresses.has(message);

/**
 * What a mouse message means here: a left press or Windows' double-click on the title-bar area (`hitTest` HTCAPTION),
 * any other press (a tab, a button, a resize border, the right button: it ends a double-click in progress), or nothing
 * (moves, releases, the wheel).
 */
export function captionMessage(message: number, hitTest: number): "press" | "double" | "other" | undefined {
  if (!isButtonPress(message)) return undefined;
  if (hitTest === HTCAPTION && message === WM_NCLBUTTONDOWN) return "press";
  if (hitTest === HTCAPTION && message === WM_NCLBUTTONDBLCLK) return "double";
  return "other";
}

/** A non-client mouse message's point (screen pixels, each half signed 16-bit: left or above the main display is < 0). */
export function pointFromLParam(lParam: number | bigint): { x: number; y: number } {
  const value = Number(BigInt.asUintN(32, BigInt(lParam)));
  return { x: ((value & 0xffff) << 16) >> 16, y: (((value >>> 16) & 0xffff) << 16) >> 16 };
}

/** Windows' double-click limits: the time between the presses (ms) and the rectangle's size around the first (px). */
export interface DoubleClickLimits { time: number; width: number; height: number }

/** Windows' defaults (500 ms, 4 × 4 px), for when they can't be read. */
export const fallbackLimits: DoubleClickLimits = { time: 500, width: 4, height: 4 };

/** The limits from GetDoubleClickTime and GetSystemMetrics(SM_C?DOUBLECLK); a value that can't be right falls back. */
export function limitsFrom(time: number, width: number, height: number): DoubleClickLimits {
  const usable = (value: number, low: number, high: number) => Number.isFinite(value) && value >= low && value <= high;
  return {
    time: usable(time, 50, 5000) ? time : fallbackLimits.time,
    width: usable(width, 1, 200) ? width : fallbackLimits.width,
    height: usable(height, 1, 200) ? height : fallbackLimits.height,
  };
}

/**
 * One press on the title-bar area: a left press, or Windows' double-click message. `time` is a monotonic clock (ms);
 * `x`, `y` the pointer on the screen (px); `windowX`, `windowY` where the note is at that moment (only compared with
 * each other, to tell a drag).
 */
export interface CaptionPress { kind: "press" | "double"; time: number; x: number; y: number; windowX: number; windowY: number }

/** Decides when presses on the note's title-bar area fold it (one fold per double-click). */
export class CaptionDoubleClick {
  /** The last press that may start a double-click. */
  private last?: CaptionPress;
  /** When it last folded: the same double-click heard again, or a third press, doesn't fold again. */
  private foldedAt?: number;

  constructor(private readonly limits: () => DoubleClickLimits = () => fallbackLimits) {}

  /** True when this press completes a double-click and the note should fold now. */
  press(press: CaptionPress): boolean {
    const limits = this.limits();
    if (this.foldedAt !== undefined && press.time - this.foldedAt >= 0 && press.time - this.foldedAt <= limits.time) {
      this.last = undefined;
      return false;
    }
    const first = this.last;
    this.last = press;
    // Within Windows' rectangle: centred on the first press, `width` × `height` px.
    const near = (dx: number, dy: number) => Math.abs(dx) <= limits.width / 2 && Math.abs(dy) <= limits.height / 2;
    const dragged = first !== undefined && !near(press.windowX - first.windowX, press.windowY - first.windowY);
    if (press.kind === "double") {
      // Windows has checked time and distance; it only doesn't know whether the note was dragged in between.
      return dragged ? false : this.fold(press.time);
    }
    if (!first || dragged) return false;
    const elapsed = press.time - first.time;
    if (elapsed < 0 || elapsed > limits.time) return false;
    if (!near(press.x - first.x, press.y - first.y)) return false;
    return this.fold(press.time);
  }

  /** Any other press (a tab, a button, another window): a double-click in progress ends. */
  forget(): void {
    this.last = undefined;
  }

  /** Tests: whether a first press is waiting for its second. */
  get waiting(): boolean {
    return this.last !== undefined;
  }

  private fold(time: number): true {
    this.foldedAt = time;
    this.last = undefined;
    return true;
  }
}
