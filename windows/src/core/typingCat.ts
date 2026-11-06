/**
 * 치면 두드리는 고양이 (#230, docs/plans/typing-cat.md): the cat on its cushion puts a paw down for each key — the
 * viewer's left paw first, then the other, back to rest 120 ms after the last key. The same rules as the Mac's
 * `PaperCore/TypingCat.swift`; both run the cases in docs/plans/typing-cat-cases.json.
 *
 * It is told only that a key went down and when (a monotonic clock, in milliseconds). It never sees which key, and it
 * keeps nothing of one: two poses, a time and a deadline. On Windows it hears keys typed in the app's own windows only.
 */

/** The three pictures (left · right as the viewer sees them). */
export type TypingPose = "idle" | "left" | "right";
/** 책상 → 종이냥 → 글자 칠 때 두드리기 (`petTyping`, a device setting). Windows has no ‘in all apps’. */
export type TypingScope = "off" | "app";

/** How long a paw stays down after its key (the first value to try on real typing). */
export const typingHoldMs = 120;
/** The cat stays on its cushion this long after the last key before the pet's usual moments come back. */
export const typingLingerMs = 3000;
/** 종이냥 한마디 waits this long after the last key. */
export const typingChatterQuietMs = 5000;
/** A page sends at most one tap this often (`petTap`; a faster burst is merged, never queued). */
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

/** Hidden, turned off, quitting: nothing waits and the paws rest. The next paw is kept. */
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

// ─── Beside the pet's other moments ───────────────────────────────────────────

export type TypingDoing = "resting" | "sleeping" | "walking" | "moment" | "answering" | "dragging" | "hidden";
export type TypingReply = "ignore" | "type" | "stopAndType" | "wakeAndType";

/**
 * What a key does to the pet: sitting or a small moment (blink, look, stretch, grooming, yawn, tea) — a paw; walking —
 * it stops where it is; dozing — it wakes (the person is back); cheering, hearts or a hop, being dragged, hidden —
 * nothing, and nothing is caught up later.
 */
export function typingReply(doing: TypingDoing): TypingReply {
  switch (doing) {
    case "resting": case "moment": return "type";
    case "walking": return "stopAndType";
    case "sleeping": return "wakeAndType";
    case "answering": case "dragging": case "hidden": return "ignore";
  }
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
