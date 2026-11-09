import assert from "node:assert/strict";
import { test } from "node:test";
import { StayBehind, WM_WINDOWPOSCHANGED, bottomFlags, hwndOf, readNoteLayer, type BehindWindow } from "../src/core/stayBehind";
import { noteToggle } from "../src/core/shortcuts";
import { mayAct, readAction } from "../src/core/ipcCheck";

// 바탕화면에 두기 on Windows (#272 · #273): the decisions around the one SetWindowPos call, with a fake window and a fake
// call (the call itself needs a real Windows PC).

class FakeWindow implements BehindWindow {
  hooks = new Map<number, () => void>();
  listeners = new Map<string, Set<() => void>>();
  destroyed = false;
  visible = true;
  enabled = true;
  focused = false;
  onTop = false;
  constructor(readonly hwnd = 0x1234) {}
  getNativeWindowHandle(): Uint8Array { const buffer = Buffer.alloc(8); buffer.writeBigUInt64LE(BigInt(this.hwnd)); return buffer; }
  hookWindowMessage(message: number, callback: () => void): void { this.hooks.set(message, callback); }
  unhookWindowMessage(message: number): void { this.hooks.delete(message); }
  on(event: "focus" | "blur", listener: () => void): this { if (!this.listeners.has(event)) this.listeners.set(event, new Set()); this.listeners.get(event)!.add(listener); return this; }
  removeListener(event: "focus" | "blur", listener: () => void): this { this.listeners.get(event)?.delete(listener); return this; }
  isDestroyed(): boolean { return this.destroyed; }
  isVisible(): boolean { return this.visible; }
  isEnabled(): boolean { return this.enabled; }
  isFocused(): boolean { return this.focused; }
  isAlwaysOnTop(): boolean { return this.onTop; }
  /** Windows moved it (a click, a drag, shown). */
  moved(): void { this.hooks.get(WM_WINDOWPOSCHANGED)?.(); }
  emit(event: "focus" | "blur"): void { if (event === "focus") this.focused = true; else this.focused = false; for (const listener of this.listeners.get(event) ?? []) listener(); }
}

/** A keeper whose pushes run at once (or wait in `queue`), recording each HWND sent to the bottom. */
function keeper(options: { queued?: boolean; fails?: boolean } = {}) {
  const pushed: number[] = [];
  const queue: (() => void)[] = [];
  const warnings: string[] = [];
  let reenter: (() => void) | undefined;
  const behind = new StayBehind((hwnd) => {
    if (options.fails) throw new Error("no user32");
    pushed.push(hwnd);
    reenter?.();
  }, (run) => (options.queued ? queue.push(run) : run()), (message) => warnings.push(message));
  return { behind, pushed, queue, warnings, setReenter: (run: () => void) => { reenter = run; } };
}

test("B1 a kept widget goes to the bottom at once and again whenever Windows moves it forward", () => {
  const { behind, pushed } = keeper();
  const widget = new FakeWindow(0x51);
  behind.keep(widget);
  assert.deepEqual(pushed, [0x51]);
  widget.moved();
  widget.moved();
  assert.deepEqual(pushed, [0x51, 0x51, 0x51]);
});

test("B2 the call's own move doesn't ask again (no loop)", () => {
  const { behind, pushed, setReenter } = keeper();
  const widget = new FakeWindow(0x52);
  setReenter(() => widget.moved());
  behind.keep(widget);
  widget.moved();
  assert.equal(pushed.length, 2);
});

test("B3 several moves before the push runs make one push (a drag)", () => {
  const { behind, pushed, queue } = keeper({ queued: true });
  const widget = new FakeWindow();
  behind.keep(widget);
  for (let step = 0; step < 5; step += 1) widget.moved();
  assert.equal(queue.length, 1);
  queue.shift()!();
  assert.equal(pushed.length, 1);
  widget.moved();
  assert.equal(queue.length, 1);
});

test("B4 released (항상 위에 두기, 보통, closed): no hook, no listeners, no more pushes", () => {
  const { behind, pushed } = keeper();
  const widget = new FakeWindow();
  behind.keep(widget);
  behind.release(widget);
  assert.equal(widget.hooks.size, 0);
  assert.equal([...widget.listeners.values()].reduce((sum, set) => sum + set.size, 0), 0);
  widget.moved();
  assert.equal(pushed.length, 1);
  assert.equal(behind.isKept(widget), false);
});

test("B5 hidden, destroyed, floating or disabled (a file dialog over it): left alone", () => {
  const { behind, pushed } = keeper();
  const widget = new FakeWindow();
  widget.visible = false;
  behind.keep(widget);
  widget.visible = true;
  widget.onTop = true;
  widget.moved();
  widget.onTop = false;
  widget.enabled = false;
  widget.moved();
  assert.deepEqual(pushed, []);
  widget.enabled = true;
  widget.moved();
  assert.equal(pushed.length, 1);
});

test("B6 the note clicked: it takes the keyboard but goes back under the others", () => {
  const { behind, pushed } = keeper();
  const note = new FakeWindow(0x77);
  let pointerInside = true;
  behind.keep(note, { summonable: true, pointerInside: () => pointerInside });
  pushed.length = 0;
  note.emit("focus");
  note.moved();
  assert.deepEqual(pushed, [0x77]);
  assert.equal(behind.inFront(note), false);
  pointerInside = false;
});

test("B7 the note summoned (its key, the tray): in front until another window is clicked, then back", () => {
  const { behind, pushed } = keeper();
  const note = new FakeWindow();
  behind.keep(note, { summonable: true, pointerInside: () => false });
  pushed.length = 0;
  behind.summon(note);
  note.emit("focus");
  note.moved();
  assert.deepEqual(pushed, []);
  assert.equal(behind.inFront(note), true);
  note.emit("blur");
  assert.equal(pushed.length, 1);
  assert.equal(behind.inFront(note), false);
});

test("B8 Alt+Tab or the taskbar (focused with the mouse elsewhere) counts as summoned, even when the move comes first", () => {
  const { behind, pushed, queue } = keeper({ queued: true });
  const note = new FakeWindow();
  behind.keep(note, { summonable: true, pointerInside: () => false });
  queue.shift()!();
  pushed.length = 0;
  note.moved();
  note.focused = true; // focused by the time the push runs, its focus event not heard yet
  queue.shift()!();
  assert.deepEqual(pushed, []);
  assert.equal(behind.inFront(note), true);
});

test("B9 a widget can't be summoned (it never takes the keyboard)", () => {
  const { behind, pushed } = keeper();
  const widget = new FakeWindow();
  behind.keep(widget);
  behind.summon(widget);
  widget.moved();
  assert.equal(pushed.length, 2);
});

test("B10 a question over the note holds it up (Windows would take the question down with it)", () => {
  const { behind, pushed } = keeper();
  const note = new FakeWindow();
  let asking = true;
  behind.keep(note, { summonable: true, pointerInside: () => true, holds: () => asking });
  note.moved();
  assert.deepEqual(pushed, []);
  asking = false;
  note.moved();
  assert.equal(pushed.length, 1);
});

test("B11 no call (macOS, an off-screen run) or a call that fails: the windows stay ordinary, one warning", () => {
  const none = new StayBehind(undefined);
  const window = new FakeWindow();
  none.keep(window);
  assert.equal(none.works, false);
  assert.equal(window.hooks.size, 0);
  assert.equal(none.inFront(window), true);
  const { behind, warnings } = keeper({ fails: true });
  behind.keep(window);
  window.moved();
  assert.equal(behind.works, false);
  assert.equal(warnings.length, 1);
});

test("B12 the HWND from Electron's handle, and the flags that never take the keyboard", () => {
  const eight = Buffer.alloc(8);
  eight.writeBigUInt64LE(0x0004_05a2n);
  assert.equal(hwndOf(eight), 0x405a2);
  const four = Buffer.alloc(4);
  four.writeUInt32LE(0x00c0_ffee);
  assert.equal(hwndOf(four), 0xc0ffee);
  assert.equal(hwndOf(Buffer.alloc(0)), 0);
  // SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOOWNERZORDER
  assert.equal(bottomFlags, 0x0213);
});

test("L1 노트 위치 as saved: the choice, else the pin's old switch (on: 항상 위에 두기), else 보통", () => {
  assert.equal(readNoteLayer("desktop", true), "desktop");
  assert.equal(readNoteLayer("normal", true), "normal");
  assert.equal(readNoteLayer(undefined, true), "top");
  assert.equal(readNoteLayer(undefined, false), "normal");
  assert.equal(readNoteLayer("floating", undefined), "normal");
});

test("L2 the note's key: a note kept behind and not summoned comes forward instead of going away", () => {
  assert.equal(noteToggle({ visible: true, minimized: false, folded: false, uncovered: false }), "show");
  assert.equal(noteToggle({ visible: true, minimized: false, folded: false, uncovered: true }), "hide");
});

test("L3 the note may send 노트 위치 only as one of the three, and no longer the old switch", () => {
  const desktop = readAction({ type: "setPref", key: "noteLayer", value: "desktop" });
  assert.deepEqual(desktop, { type: "setPref", key: "noteLayer", value: "desktop" });
  assert.equal(mayAct("note", desktop!), true);
  assert.equal(readAction({ type: "setPref", key: "noteLayer", value: "bottom" }), undefined);
  const old = readAction({ type: "setPref", key: "alwaysOnTop", value: true });
  assert.equal(old !== undefined && mayAct("note", old), false);
});
