import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { GlobalKeys, KeyFilter, hookWanted, WM_KEYDOWN, WM_KEYUP, WM_SYSKEYDOWN, WM_SYSKEYUP, type HeldModifiers, type KeyHookNative } from "../src/core/keyHook";

// 모든 앱에서 on Windows (#288): the low-level hook's logic with a stand-in for Windows — what counts, the throttle,
// that nothing of a key goes past the filter, and that the hook is set and taken off as asked.
const root = process.cwd();
const A = 0x41, B = 0x42, SHIFT = 0x10, LSHIFT = 0xa0, CTRL = 0x11, LCTRL = 0xa2, RALT = 0xa5, LWIN = 0x5b, CAPS = 0x14;
const none: HeldModifiers = { ctrl: false, alt: false, win: false };

/** Windows, as far as the hook goes: one hook at most, and a keyboard whose modifiers the test holds. */
class StandIn implements KeyHookNative {
  proc?: (message: number, vk: number) => void;
  installs = 0;
  uninstalls = 0;
  refuse = false;
  held: HeldModifiers = { ...none };
  modifierReads = 0;
  install(proc: (message: number, vk: number) => void): boolean {
    this.installs += 1;
    if (this.refuse) return false;
    this.proc = proc;
    return true;
  }
  uninstall(): void {
    this.uninstalls += 1;
    this.proc = undefined;
  }
  modifiers(): HeldModifiers {
    this.modifierReads += 1;
    return this.held;
  }
  /** A key pressed and let go, `every` ms apart from the last. */
  press(vk: number, system = false): void {
    this.proc?.(system ? WM_SYSKEYDOWN : WM_KEYDOWN, vk);
    this.proc?.(system ? WM_SYSKEYUP : WM_KEYUP, vk);
  }
}

function setUp(): { native: StandIn; keys: GlobalKeys; heard: unknown[][]; clock: { now: number } } {
  const native = new StandIn();
  const heard: unknown[][] = [];
  const clock = { now: 0 };
  const keys = new GlobalKeys(native, (...args: unknown[]) => { heard.push(args); }, () => clock.now);
  return { native, keys, heard, clock };
}

test("key hook: a letter counts, once per press, and onKey gets nothing of it", () => {
  const { native, keys, heard, clock } = setUp();
  assert.equal(keys.listen(true), true);
  native.press(A);
  clock.now = 100;
  native.press(B);
  assert.equal(heard.length, 2);
  assert.ok(heard.every((args) => args.length === 0), "no key code, no message, nothing");
  assert.equal(keys.remembersAKey, false, "nothing remembered once the keys are up");
});

test("key hook: a key held down (Windows sends its repeats as more key-downs) counts once", () => {
  const { native, keys, heard, clock } = setUp();
  keys.listen(true);
  native.proc!(WM_KEYDOWN, A);
  for (let index = 1; index <= 20; index += 1) { clock.now = index * 33; native.proc!(WM_KEYDOWN, A); }
  assert.equal(heard.length, 1);
  assert.equal(keys.remembersAKey, true, "only while it is down");
  native.proc!(WM_KEYUP, A);
  assert.equal(keys.remembersAKey, false);
  clock.now = 1000;
  native.press(A);
  assert.equal(heard.length, 2, "pressed again after letting go: it counts");
});

test("key hook: rolling over from one key to the next counts both", () => {
  const { native, keys, heard, clock } = setUp();
  keys.listen(true);
  native.proc!(WM_KEYDOWN, A);
  clock.now = 60;
  native.proc!(WM_KEYDOWN, B);
  native.proc!(WM_KEYUP, A);
  clock.now = 90;
  native.proc!(WM_KEYDOWN, B);
  native.proc!(WM_KEYUP, B);
  assert.equal(heard.length, 2);
});

test("key hook: Ctrl and Windows-key shortcuts don't count; Shift, Alt and AltGr letters do", () => {
  const { native, keys, heard, clock } = setUp();
  keys.listen(true);
  const tap = (held: Partial<HeldModifiers>, vk = A, system = false) => {
    clock.now += 100;
    native.held = { ...none, ...held };
    native.press(vk, system);
  };
  tap({ ctrl: true });
  tap({ win: true });
  tap({ ctrl: true, win: true });
  assert.equal(heard.length, 0, "Ctrl+A, Win+A");
  tap({});
  tap({ alt: true }, A, true);
  tap({ ctrl: true, alt: true });
  assert.equal(heard.length, 3, "a letter, Alt+letter (WM_SYSKEYDOWN), AltGr+letter (Ctrl + Alt)");
});

test("key hook: a modifier or lock key pressed alone isn't typing, and costs no modifier read", () => {
  const { native, keys, heard, clock } = setUp();
  keys.listen(true);
  for (const vk of [SHIFT, LSHIFT, CTRL, LCTRL, RALT, LWIN, CAPS]) { clock.now += 100; native.press(vk); }
  assert.equal(heard.length, 0);
  assert.equal(native.modifierReads, 0);
});

test("key hook: at most one a 50 ms, the first of a burst at once", () => {
  const { native, keys, heard, clock } = setUp();
  keys.listen(true);
  for (const [at, vk] of [[0, A], [10, B], [49, A], [50, B], [51, A], [99, B], [100, A], [300, B]] as const) {
    clock.now = at;
    native.press(vk);
  }
  assert.equal(heard.length, 4);
});

test("key hook: a hook event that throws inside never stops the next key", () => {
  const native = new StandIn();
  let calls = 0;
  const keys = new GlobalKeys(native, () => { calls += 1; if (calls === 1) throw new Error("drawing failed"); }, () => calls * 100);
  keys.listen(true);
  assert.throws(() => native.press(A), /drawing failed/, "the error reaches the native side, which passes the key on anyway");
  native.press(B);
  assert.equal(calls, 2);
});

test("key hook: set once, taken off on off · lock · quit, set again on unlock", () => {
  const { native, keys } = setUp();
  assert.equal(keys.listen(true), true);
  assert.equal(keys.listen(true), true);
  assert.equal(native.installs, 1, "not set twice");
  native.proc!(WM_KEYDOWN, A);
  assert.equal(keys.listen(false), false, "turned off, or the screen locked");
  assert.equal(native.uninstalls, 1);
  assert.equal(native.proc, undefined);
  assert.equal(keys.remembersAKey, false, "a key down when it was taken off is forgotten");
  assert.equal(keys.listen(false), false);
  assert.equal(native.uninstalls, 1, "not taken off twice");
  assert.equal(keys.listen(true), true, "unlocked");
  assert.equal(native.installs, 2);
});

test("key hook: Windows won't set it (or no Koffi): not listening, in this app only", () => {
  const { native, keys } = setUp();
  native.refuse = true;
  assert.equal(keys.listen(true), false);
  assert.equal(keys.listening, false);
  const nothing = new GlobalKeys(undefined, () => undefined);
  assert.equal(nothing.available, false);
  assert.equal(nothing.listen(true), false);
});

test("key hook: the filter alone, every message", () => {
  const filter = new KeyFilter();
  const mods = () => none;
  assert.equal(filter.counts(WM_KEYUP, A, mods), false);
  assert.equal(filter.counts(0x0200, A, mods), false, "not a key message");
  assert.equal(filter.counts(WM_SYSKEYDOWN, A, mods), true);
  assert.equal(filter.counts(WM_SYSKEYDOWN, A, mods), false);
  assert.equal(filter.counts(WM_SYSKEYUP, A, mods), false);
  assert.equal(filter.remembers, false);
});

test("key hook privacy: the native side reads the virtual-key code only, passes every key on, writes and sends nothing", () => {
  // The comments may say what isn't read; the code may not touch it.
  const strip = (file: string) => fs.readFileSync(path.join(root, file), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map((line) => line.replace(/\/\/.*$/, "")).join("\n");
  const native = strip("src/main/keyHook.ts");
  assert.equal([...native.matchAll(/koffi\.decode\(/g)].length, 1, "one read of the struct");
  assert.match(native, /koffi\.decode\(lParam, "uint32"\)/, "its first field (vkCode) only");
  assert.match(native, /return callNextHookEx\(0, nCode, wParam, lParam\);/, "every key goes on");
  for (const name of ["scanCode", "KBDLLHOOKSTRUCT", "console.log", "writeFile", "appendFile", "webContents", "ToUnicode", "MapVirtualKey", "GetKeyNameText", "clipboard"]) {
    assert.ok(!native.includes(name), `keyHook.ts uses ${name}`);
  }
  const core = strip("src/core/keyHook.ts");
  assert.match(core, /private readonly onKey: \(\) => void/, "onKey takes nothing");
  for (const name of ["console.", "push(", "localStorage", "JSON.stringify"]) assert.ok(!core.includes(name), `core/keyHook.ts uses ${name}`);
});

test("key hook: --mcp-stdio and off-screen runs never load it", () => {
  const entry = fs.readFileSync(path.join(root, "src/main/entry.ts"), "utf8");
  assert.ok(!entry.includes("keyHook"), "entry.ts doesn't import it");
  const native = fs.readFileSync(path.join(root, "src/main/keyHook.ts"), "utf8");
  assert.match(native, /process\.platform !== "win32" \|\| offscreenEnabled\) return undefined/);
});

test("key hook: wanted only for 모든 앱에서 with the screen unlocked; the typing cat follows that, and unhooks on quit", () => {
  assert.equal(hookWanted("everywhere", false), true);
  assert.equal(hookWanted("everywhere", true), false, "locked");
  assert.equal(hookWanted("app", false), false);
  assert.equal(hookWanted("off", false), false);
  const window = fs.readFileSync(path.join(root, "src/main/typingCat.ts"), "utf8");
  assert.match(window, /const wantsHook = hookWanted\(scope, this\.locked\);/);
  assert.match(window, /this\.keys\?\.listen\(wantsHook\)/, "set or taken off on every refresh (setting, lock, unlock)");
  assert.match(window, /powerMonitor\.on\("lock-screen", \(\) => this\.setLocked\(true\)\)/);
  assert.match(window, /powerMonitor\.on\("unlock-screen", \(\) => this\.setLocked\(false\)\)/);
  assert.match(window, /dispose\(\): void \{\n    this\.keys\?\.listen\(false\);/, "quitting takes it off first");
  assert.match(window, /tap\(\): void \{\n    if \(this\.source === "app"\) this\.key\(\);/, "the pages' taps are left while the hook hears every key");
  const main = fs.readFileSync(path.join(root, "src/main/main.ts"), "utf8");
  assert.match(main, /app\.on\("will-quit", \(\) => \{ typingCat\?\.dispose\(\);/);
});
