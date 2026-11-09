/**
 * 치면 두드리는 고양이 (#230 · #289, docs/plans/typing-cat.md): a cat of its own, apart from the desktop pet, on its
 * cushion in a corner of the screen. It puts a paw down for each key — the viewer's left paw first, then the other, back
 * to rest 120 ms after the last key. The same rules as the Mac's `PaperCore/TypingCat.swift`; both run the cases in
 * docs/plans/typing-cat-cases.json.
 *
 * It is told only that a key went down and when (a monotonic clock, in milliseconds). It never sees which key, and it
 * keeps nothing of one: two poses, a time and a deadline.
 */

/** The three pictures (left · right as the viewer sees them). */
export type TypingPose = "idle" | "left" | "right";
/** 책상 → 종이냥 → 타닥냥 → 두드리기 (`typingCat`, a device setting): `app` unless changed. */
export type TypingScope = "off" | "app" | "everywhere";
export const typingScopes: readonly TypingScope[] = ["off", "app", "everywhere"];
/** 자리: the corner it sits in (`typingCorner`, a device setting). */
export type TypingCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight";
export const typingCorners: readonly TypingCorner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];

/** How long a paw stays down after its key (the first value to try on real typing). */
export const typingHoldMs = 120;
/** 종이냥에서만: the cat stays in its corner this long after the last key, then quietly goes. */
export const typingLingerMs = 3000;
/** 종이냥 한마디 (the pet's) waits this long after the last key. */
export const typingChatterQuietMs = 5000;
/** A page sends at most one tap this often (`typingTap`; a faster burst is merged, never queued). */
export const typingTapEveryMs = 50;

export interface TypingCat {
  pose: TypingPose;
  /** The paw for the next key: kept across rests, so slow typing alternates too. */
  nextPaw: "left" | "right";
  /** When the paw goes back to rest; undefined when nothing waits (then no timer runs). */
  returnAt?: number;
  /** When the last key that counted went down. */
  lastKey?: number;
}

export const newTypingCat = (): TypingCat => ({ pose: "idle", nextPaw: "left" });

/**
 * A key went down at `now`. The pose changes at once (no clips queued); the answer is when to wake to put the paw back,
 * undefined when there's nothing to wait for. Reduced motion: the cat stays still in its resting pose.
 */
export function typingKey(cat: TypingCat, now: number, reduceMotion: boolean): number | undefined {
  cat.lastKey = now;
  if (reduceMotion) {
    cat.pose = "idle";
    cat.returnAt = undefined;
    return undefined;
  }
  cat.pose = cat.nextPaw;
  cat.nextPaw = cat.nextPaw === "left" ? "right" : "left";
  cat.returnAt = now + typingHoldMs;
  return cat.returnAt;
}

/** The timer woke at `now`: the paw goes back once its time has come; otherwise when to wake again (a newer key moved it). */
export function typingWake(cat: TypingCat, now: number): number | undefined {
  const due = cat.returnAt;
  if (due === undefined) return undefined;
  if (now < due) return due;
  cat.pose = "idle";
  cat.returnAt = undefined;
  return undefined;
}

/** Put away (turned off, locked, quitting): nothing waits and the paws rest. The next paw is kept. */
export function typingStop(cat: TypingCat): void {
  cat.pose = "idle";
  cat.returnAt = undefined;
}

export const typedWithin = (cat: TypingCat, ms: number, now: number): boolean => cat.lastKey !== undefined && now - cat.lastKey < ms;

/**
 * Whether a key-down counts as typing: not a key held down (its repeats), not a command (Ctrl or the Windows key held).
 * Shift and Alt type letters, and AltGr (which Windows reports as Ctrl + Alt) types them too, so those count.
 */
export const typingCounts = (isRepeat: boolean, command: boolean, control: boolean): boolean => !isRepeat && !command && !control;

/** The names a browser gives a modifier pressed on its own (only to leave those out: a key's name is looked at for nothing else). */
const modifierNames = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "OS", "CapsLock", "Fn", "FnLock", "NumLock", "ScrollLock", "Hyper", "Super"]);

/** A page's keydown, turned at once into whether it counts. Nothing of the key leaves this function. */
export function keydownCounts(event: { repeat: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean; key: string }): boolean {
  if (modifierNames.has(event.key)) return false;
  return typingCounts(event.repeat, event.metaKey, event.ctrlKey && !event.altKey);
}

// ─── Where keys are heard from, and the corner (#289) ─────────────────────────

/** Where typing is heard from: nothing, the app's own windows, or every app (the key hook, #288). */
export type TypingSource = "none" | "app" | "everywhere";

/**
 * In this app: the pages' keys. In all apps: the low-level key hook, once it could be set (`granted`); otherwise this app
 * only, never pretended. Nothing while the screen is locked. The desktop pet plays no part: hiding it leaves the typing
 * cat as it is.
 */
export function typingSource(scope: TypingScope, granted: boolean, locked: boolean): TypingSource {
  if (locked || scope === "off") return "none";
  return scope === "everywhere" && granted ? "everywhere" : "app";
}

/** Whether the cat is in its corner now: heard in all apps (always), or in this app within `typingLingerMs` of the last key. */
export function typingShows(source: TypingSource, lastKey: number | undefined, now: number): boolean {
  if (source === "everywhere") return true;
  return source === "app" && lastKey !== undefined && now - lastKey < typingLingerMs;
}

const readScope = (value: unknown): TypingScope | undefined => typingScopes.find((scope) => scope === value);

/** The setting as saved (`typingCat`), or else as the pet's ‘글자 칠 때 두드리기’ (`petTyping`, before #289) left it. */
export function readTypingScope(saved: unknown, before?: unknown): TypingScope {
  return (saved === undefined ? readScope(before) : readScope(saved)) ?? "app";
}

/** 자리 as saved; bottom right unless changed. */
export function readTypingCorner(saved: unknown, before?: unknown): TypingCorner {
  const value = saved === undefined ? before : saved;
  return typingCorners.find((corner) => corner === value) ?? "bottomRight";
}

/**
 * The tray's 타닥냥: on, it is turned off and the choice remembered (`last`); off, the remembered choice comes
 * back (종이냥에서만 if none). Settings shows the same 끄기, so there is one switch, not two.
 */
export function toggledTypingScope(scope: TypingScope, last: TypingScope | undefined): { scope: TypingScope; last?: TypingScope } {
  if (scope === "off") return { scope: last !== undefined && last !== "off" ? last : "app", last };
  return { scope: "off", last: scope };
}

/** The window's size and its distance from the screen's edges (DIP). */
export const typingCatSize = 112;
export const typingCatMargin = 20;

export interface CornerRect { x: number; y: number; width: number; height: number }

/**
 * Its frame in a corner of an area, kept inside it (`topInset`: room kept at the top). The Mac's frames are bottom-up;
 * this one is top-down (Windows' screen coordinates), so `top` is the y-up rule mirrored.
 */
export function typingCatFrame(corner: TypingCorner, area: CornerRect, topInset = 0, size = typingCatSize): CornerRect {
  const side = Math.min(size, Math.max(0, area.width - 2 * typingCatMargin), Math.max(0, area.height - 2 * typingCatMargin - topInset));
  const left = area.x + typingCatMargin;
  const right = area.x + area.width - typingCatMargin - side;
  const top = area.y + typingCatMargin + topInset;
  const bottom = area.y + area.height - typingCatMargin - side;
  const x = corner === "topLeft" || corner === "bottomLeft" ? left : right;
  const y = corner === "topLeft" || corner === "topRight" ? top : bottom;
  return { x, y, width: side, height: side };
}

/** A page's taps, at most one every `typingTapEveryMs` (the first of a burst goes at once). */
export function tapThrottle(every = typingTapEveryMs): (now: number) => boolean {
  let last = -Infinity;
  return (now) => {
    if (now - last < every) return false;
    last = now;
    return true;
  };
}
