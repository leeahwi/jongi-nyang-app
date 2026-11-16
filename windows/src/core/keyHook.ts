import { tapThrottle, typingCounts } from "./typingCat";

/**
 * 모든 앱에서 on Windows (#288, docs/plans/typing-cat.md): the typing cat hears keys typed in any app through Windows'
 * low-level keyboard hook (SetWindowsHookExW with WH_KEYBOARD_LL, main/keyHook.ts through Koffi). Windows calls the
 * hook on the main thread for every key of every app and waits for it, so it must answer at once: the native side hands
 * over only the message and the key's virtual-key code, always passes the key on (CallNextHookEx), and this file turns
 * the pair into "a key went down" or nothing.
 *
 * The key's code is used for two things only, and only while the key is down: to tell a held key's repeats (Windows
 * sends them as more key-downs, with nothing to mark them) and to leave out a modifier pressed on its own. It is never
 * kept after the key goes up, never compared with anything else, never written, logged or sent: `onKey` takes nothing.
 *
 * The native calls are handed in, so this runs anywhere and the tests use a stand-in.
 */

export const WH_KEYBOARD_LL = 13;
export const HC_ACTION = 0;
export const WM_KEYDOWN = 0x0100;
export const WM_KEYUP = 0x0101;
export const WM_SYSKEYDOWN = 0x0104;
export const WM_SYSKEYUP = 0x0105;

/** Shift, Ctrl, Alt (each side too), the Windows keys, the menu key and the lock keys: pressed alone, they type nothing. */
const modifierKeys = new Set([0x10, 0x11, 0x12, 0x14, 0x5b, 0x5c, 0x5d, 0x90, 0x91, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5]);

/** Which modifiers are held now (GetAsyncKeyState). */
export interface HeldModifiers { ctrl: boolean; alt: boolean; win: boolean }

/**
 * One key event from the hook, decided at once. A key-down counts unless it is a modifier alone, the same key again
 * without having gone up (a repeat), or a shortcut: Ctrl or a Windows key held. AltGr comes as Ctrl + Alt and types
 * letters, so Ctrl with Alt counts (as `keydownCounts` reads a page's keys).
 */
export class KeyFilter {
  /** The key down now, only to know its repeats; forgotten when it goes up. */
  private held?: number;

  counts(message: number, vk: number, modifiers: () => HeldModifiers): boolean {
    if (message === WM_KEYUP || message === WM_SYSKEYUP) {
      if (vk === this.held) this.held = undefined;
      return false;
    }
    if (message !== WM_KEYDOWN && message !== WM_SYSKEYDOWN) return false;
    if (modifierKeys.has(vk)) return false;
    if (vk === this.held) return false;
    this.held = vk;
    const held = modifiers();
    return typingCounts(false, held.win, held.ctrl && !held.alt);
  }

  /** Unhooked: nothing is remembered. */
  forget(): void { this.held = undefined; }

  /** Tests: whether a key is remembered now. */
  get remembers(): boolean { return this.held !== undefined; }
}

/** The hook is set only while 모든 앱에서 is chosen and the screen isn't locked; off, another choice or locked: off at once. */
export const hookWanted = (scope: "off" | "app" | "everywhere", locked: boolean): boolean => scope === "everywhere" && !locked;

/** #410 (GlobalKeys.watch): how often the hook is looked at while 모든 앱에서 listens. */
export const hookCheckMs = 5_000;
/** Seconds of system idle time that still count as someone at the computer. */
export const hookActiveIdleS = 2;
/** No key event for this long while someone is at the computer: the hook may have been taken off. */
export const hookSilenceMs = 30_000;
/** At most one setting again in this long. */
export const hookRearmGapMs = 60_000;

/** What GlobalKeys needs of Windows (main/keyHook.ts; a stand-in in the tests). */
export interface KeyHookNative {
  /**
   * Sets the low-level keyboard hook. `proc` gets each event's message and virtual-key code (nCode HC_ACTION only); the
   * native side passes every key on whatever `proc` does or throws. False when Windows wouldn't set it.
   */
  install(proc: (message: number, vk: number) => void): boolean;
  /** Takes the hook off (nothing if it isn't set). */
  uninstall(): void;
  modifiers(): HeldModifiers;
}

/**
 * The hook while 모든 앱에서 wants it: set on `listen(true)`, taken off on `listen(false)` (off, locked, quitting). Keys
 * that count reach `onKey` at most once every 50 ms (`tapThrottle`, as the pages' taps); `onKey` takes nothing.
 */
export class GlobalKeys {
  private readonly filter = new KeyFilter();
  private readonly ok = tapThrottle();
  private set = false;
  /** #410: when the hook last heard anything (any key event, up or down), and when it was last set. */
  private lastHeard = 0;
  private lastSet = 0;
  /** #410: how many times `watch` set the hook again (tests, and the report). */
  rearmed = 0;

  constructor(private readonly native: KeyHookNative | undefined, private readonly onKey: () => void,
    private readonly now: () => number = () => performance.now()) {}

  /** Whether keys can be heard from every app here (Windows, the hook loaded). */
  get available(): boolean { return this.native !== undefined; }
  get listening(): boolean { return this.set; }

  /** Listens (`true`) or stops; the answer is whether the hook is set now. */
  listen(want: boolean): boolean {
    if (!this.native) return false;
    if (want === this.set) return this.set;
    if (!want) {
      this.native.uninstall();
      this.set = false;
      this.filter.forget();
      return false;
    }
    return this.install();
  }

  private install(): boolean {
    try {
      this.set = this.native!.install((message, vk) => this.event(message, vk));
    } catch {
      this.set = false;
    }
    this.lastSet = this.lastHeard = this.now();
    return this.set;
  }

  /**
   * #410: Windows takes a low-level hook off without a word when it doesn't answer in time (the main thread held up by a
   * write lock or a slow cloud file), and the cat stops hearing other apps. Asked every `hookCheckMs` while listening,
   * with the system's idle time (powerMonitor, seconds since the last key or mouse input anywhere): someone is at the
   * computer (`hookActiveIdleS` or less) yet the hook has heard nothing for `hookSilenceMs` — then the hook is set
   * again, at most once every `hookRearmGapMs` (a mouse moved while nobody types looks the same, and setting it again
   * costs nothing). The answer is whether it was set again; `listening` says whether that worked.
   */
  watch(idleSeconds: number): boolean {
    if (!this.native || !this.set || idleSeconds > hookActiveIdleS) return false;
    const now = this.now();
    if (now - this.lastHeard < hookSilenceMs || now - this.lastSet < hookRearmGapMs) return false;
    this.native.uninstall();
    this.filter.forget();
    this.rearmed += 1;
    this.install();
    return true;
  }

  /** Called by the hook: as little as possible, and nothing of the key goes further than the filter. */
  private event(message: number, vk: number): void {
    const now = this.now();
    this.lastHeard = now;
    if (this.filter.counts(message, vk, () => this.native!.modifiers()) && this.ok(now)) this.onKey();
  }

  /** Tests: the filter remembers no key. */
  get remembersAKey(): boolean { return this.filter.remembers; }
}
