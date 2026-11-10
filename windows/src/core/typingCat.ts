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
/**
 * 자리: the corner it sits in (`typingCorner`, a device setting), or #331's 옮긴 자리 (`moved`): where it was dragged to
 * (`typingPlace`). The four corners are `typingCorners`; Settings lists 옮긴 자리 after them once there is a place.
 */
export type TypingCorner = "topLeft" | "topRight" | "bottomLeft" | "bottomRight" | "moved";
export const typingCorners: readonly TypingCorner[] = ["topLeft", "topRight", "bottomLeft", "bottomRight"];
/** Every value 자리 may hold. */
export const typingCornerValues: readonly TypingCorner[] = [...typingCorners, "moved"];

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

/**
 * Whether the cat is in its corner now: heard in all apps (always), or in this app within `typingLingerMs` of the last key.
 * #331: held by a drag it stays (종이냥에서만 waits); let go (`dropped`, the time) it stays `typingLingerMs` from then.
 */
export function typingShows(source: TypingSource, lastKey: number | undefined, now: number, dragging = false, dropped?: number): boolean {
  if (source === "everywhere") return true;
  if (source !== "app") return false;
  if (dragging) return true;
  const last = lastTouch(lastKey, dropped);
  return last !== undefined && now - last < typingLingerMs;
}

/** The last key or drop, whichever was later. */
export function lastTouch(lastKey: number | undefined, dropped: number | undefined): number | undefined {
  return lastKey === undefined ? dropped : dropped === undefined ? lastKey : Math.max(lastKey, dropped);
}

const readScope = (value: unknown): TypingScope | undefined => typingScopes.find((scope) => scope === value);

/** The setting as saved (`typingCat`), or else as the pet's ‘글자 칠 때 두드리기’ (`petTyping`, before #289) left it. */
export function readTypingScope(saved: unknown, before?: unknown): TypingScope {
  return (saved === undefined ? readScope(before) : readScope(saved)) ?? "app";
}

/** 자리 as saved; bottom right unless changed. */
export function readTypingCorner(saved: unknown, before?: unknown): TypingCorner {
  const value = saved === undefined ? before : saved;
  return typingCornerValues.find((corner) => corner === value) ?? "bottomRight";
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

// ─── 옮긴 자리 (#331, docs/plans/typing-cat-place-cases.json) ──────────────────

/**
 * The cat's drawn area — the cat and its cushion — as 16 bands from the top of its picture, each the part across it
 * (fractions of the side) with paint in any of the three poses; null where there is none. Anywhere else the window is
 * clear and a click goes to the window behind. The same table as the Mac's `TypingCorner.drawn`.
 */
export const typingCatDrawn: readonly (readonly [number, number] | null)[] = [
  null, [0.296875, 0.796875], [0.265625, 0.828125], [0.25, 0.859375], [0.21875, 0.90625], [0.203125, 0.90625],
  [0.171875, 0.90625], [0.171875, 0.890625], [0.171875, 0.890625], [0.125, 0.875], [0.125, 0.828125], [0.125, 0.828125],
  [0.078125, 0.859375], [0.078125, 0.875], [0.09375, 0.875], null,
];

/** Whether a point `across` · `down` the window (fractions of its side, from its top left) is on the drawn cat. */
export function onTypingCat(across: number, down: number): boolean {
  if (!(across >= 0 && across <= 1 && down >= 0 && down <= 1)) return false;
  const band = typingCatDrawn[Math.min(typingCatDrawn.length - 1, Math.floor(down * typingCatDrawn.length))];
  return band !== null && across >= band[0] && across <= band[1];
}

/** The box around the drawn area (fractions of the side, from the top left). */
export function typingCatBox(): { across: [number, number]; down: [number, number] } {
  const rows = typingCatDrawn.flatMap((band, index) => (band ? [{ band, index }] : []));
  return {
    across: [Math.min(...rows.map(({ band }) => band[0])), Math.max(...rows.map(({ band }) => band[1]))],
    down: [rows[0].index / typingCatDrawn.length, (rows[rows.length - 1].index + 1) / typingCatDrawn.length],
  };
}

/** A display as the cat's place sees it: its id (Electron's display id), all of it and its work area (above the taskbar). */
export interface TypingScreen { id: string; frame: CornerRect; visible: CornerRect }

/**
 * Where the cat was dragged to, kept across launches and display changes (`typingPlace`; the Mac's `typing.place`): the
 * display it was let go on, its centre as a fraction of that display's work area, and the centre itself (to find the
 * nearest display once that one is gone).
 */
export interface TypingPlace { screen: string; x: number; y: number; centerX: number; centerY: number }

const overlapArea = (a: CornerRect, b: CornerRect): number =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

const gap = (a: CornerRect, b: CornerRect): number => {
  const dx = Math.max(0, b.x - (a.x + a.width), a.x - (b.x + b.width));
  const dy = Math.max(0, b.y - (a.y + a.height), a.y - (b.y + b.height));
  return dx * dx + dy * dy;
};

/** The display `rect` is mostly on (the first of equals), or — on none — the nearest. The Mac's `ScreenFit.index(of:)`. */
function screenOf(rect: CornerRect, screens: readonly TypingScreen[]): number | undefined {
  let best: { index: number; overlap: number } | undefined;
  screens.forEach((screen, index) => {
    const overlap = overlapArea(rect, screen.frame);
    if (overlap > 0 && overlap > (best?.overlap ?? 0)) best = { index, overlap };
  });
  if (best) return best.index;
  let nearest: number | undefined;
  screens.forEach((screen, index) => { if (nearest === undefined || gap(rect, screen.frame) < gap(rect, screens[nearest].frame)) nearest = index; });
  return nearest;
}

/** `rect` moved wholly inside `area` (one bigger than it keeps its top left on the area's). */
function insideArea(rect: CornerRect, area: CornerRect): CornerRect {
  const highX = area.x + area.width - rect.width, highY = area.y + area.height - rect.height;
  return { ...rect, x: highX < area.x ? area.x : Math.min(Math.max(rect.x, area.x), highX), y: highY < area.y ? area.y : Math.min(Math.max(rect.y, area.y), highY) };
}

/** The place kept for a cat at `frame`: on the display it is mostly on (or the nearest), its centre as fractions there. */
export function typingPlaceOf(frame: CornerRect, screens: readonly TypingScreen[]): TypingPlace | undefined {
  const index = screenOf(frame, screens);
  if (index === undefined) return undefined;
  const area = screens[index].visible;
  if (area.width <= 0 || area.height <= 0) return undefined;
  const centerX = frame.x + frame.width / 2, centerY = frame.y + frame.height / 2;
  return { screen: screens[index].id, x: (centerX - area.x) / area.width, y: (centerY - area.y) / area.height, centerX, centerY };
}

/** Let go at `frame` (as the drag left it): wholly inside the work area of the display it is mostly on, and its place there. */
export function typingDropped(frame: CornerRect, screens: readonly TypingScreen[]): { frame: CornerRect; place: TypingPlace } | undefined {
  const index = screenOf(frame, screens);
  if (index === undefined) return undefined;
  const kept = insideArea(frame, screens[index].visible);
  const place = typingPlaceOf(kept, screens);
  return place && { frame: kept, place };
}

/**
 * The cat's frame at `size` from a kept place: its centre where it was on that display (a size change keeps the centre,
 * another resolution keeps it as far across), wholly inside the work area. That display gone: on the display nearest its
 * old centre, inside it. No displays: undefined.
 */
export function typingPlaceFrame(place: TypingPlace, size: number, screens: readonly TypingScreen[]): CornerRect | undefined {
  const found = screens.findIndex((screen) => screen.id === place.screen);
  let index: number | undefined = found, center: { x: number; y: number };
  if (found >= 0) {
    const area = screens[found].visible;
    center = { x: area.x + area.width * place.x, y: area.y + area.height * place.y };
  } else {
    center = { x: place.centerX, y: place.centerY };
    index = screenOf({ x: center.x - size / 2, y: center.y - size / 2, width: size, height: size }, screens);
  }
  if (index === undefined || index < 0) return undefined;
  const area = screens[index].visible;
  const side = Math.max(0, Math.min(size, area.width, area.height));
  return insideArea({ x: center.x - side / 2, y: center.y - side / 2, width: side, height: side }, area);
}

/** Where it sits as 자리 says: 옮긴 자리 with a place kept there; otherwise the corner of `area` (moved with nothing kept: bottom right). */
export function typingCatFrameFor(corner: TypingCorner, place: TypingPlace | undefined, area: CornerRect, topInset: number, size: number,
  screens: readonly TypingScreen[]): CornerRect {
  const placed = corner === "moved" && place ? typingPlaceFrame(place, size, screens) : undefined;
  return placed ?? typingCatFrame(corner, area, topInset, size);
}

/** A kept place read back from the settings file: a display id and four finite numbers (fractions within 0…1), or nothing. */
export function readTypingPlace(value: unknown): TypingPlace | undefined {
  if (!value || typeof value !== "object") return undefined;
  const { screen, x, y, centerX, centerY } = value as Record<string, unknown>;
  if (typeof screen !== "string" || screen === "" || ![x, y, centerX, centerY].every((part) => typeof part === "number" && Number.isFinite(part))) return undefined;
  const share = (part: number) => Math.min(1, Math.max(0, part));
  return { screen, x: share(x as number), y: share(y as number), centerX: centerX as number, centerY: centerY as number };
}

/** 자리 and the kept place as saved: 옮긴 자리 only with a place (else the corner unless changed). */
export function readTypingSpot(corner: unknown, place: unknown): { typingCorner: TypingCorner; typingPlace?: TypingPlace } {
  const typingPlace = readTypingPlace(place), typingCorner = readTypingCorner(corner);
  return { typingCorner: typingCorner === "moved" && !typingPlace ? "bottomRight" : typingCorner, ...(typingPlace ? { typingPlace } : {}) };
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
