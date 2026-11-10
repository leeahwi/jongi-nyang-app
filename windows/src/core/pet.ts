import { scaledSize, type CatSize } from "./catSize";
import { restPose, type MascotPose } from "./motion";

/**
 * The desktop pet (종이냥), ported from macOS `PetMotion` / `DesktopPet`. Actions are short
 * clips; `sit` and `sleep` are resting states that need no redraw, so an idle pet
 * costs nothing. Every frame is a pure function of time.
 */
export type PetAction =
  | { kind: "sit" | "sleep" | "blink" | "tilt" | "hop" | "stretch" | "groom" | "yawn" | "happy" | "cheer" | "tea" }
  | { kind: "walk"; from: number; to: number };

export type PetImage = "idle" | "blink" | "happy" | "sleep" | "yawn" | "stretch" | "cheer" | "curious" | "groom" | "tea";

/** Everything the pet window draws; sent from the main process on every change. */
export interface PetPayload {
  homeX: number;
  /** A new id starts the clip over. */
  activity: { id: number; action: PetAction };
  /** A short speech bubble above the cat (the weekly look-back, 종이냥 한마디). */
  message?: string;
  /** 종이냥 한마디 asking something: the bubble shows these answer buttons. */
  question?: { text: string; answers: string[] };
  /** #67: the floor's width (the window is only the cat's box now; its bubble still keeps to the screen). */
  floorWidth: number;
  /** #304: the cat's drawn size (DIP) at the chosen 크기; `petSize` at 보통. */
  size: number;
}

/** What to draw for one moment of an activity. */
export interface PetFrame {
  pose: MascotPose;
  image: PetImage;
  /** 0…7 into the eight-frame walk cycle while walking. */
  walkFrame?: number;
  facingRight: boolean;
  /** Centre of the pet along the floor. */
  x: number;
  sleepy: boolean;
  hearts?: number;
  sparkles?: number;
}

/** Drawn size of the cat, in CSS pixels (보통; #304: `petSizeFor` at the chosen 크기). */
export const petSize = 92;
export const walkSpeed = 24; // px per second
export const walkCycleFrames = 8;
/** 120px of planted-paw travel over 62.5% of a cycle, drawn at 92/1024 scale. */
export const walkStride = (192 * petSize) / 1024;
/** The floor strip above the taskbar (보통; #304: `petStripHeight` at the chosen 크기). */
export const stripHeight = 250;

// ─── #304: 크기 (docs/plans/cat-size-cases.json) ─────────────────────────────

/** The cat's size (DIP) at a step: 74 · 92 · 115 · 138. */
export const petSizeFor = (size: CatSize): number => scaledSize(petSize, size);
/** How much bigger than 보통 (1 at 보통, exactly). */
export const petScaleOf = (px: number): number => px / petSize;
/** The paws' stride follows the size (the walk's pace, 24 DIP a second, stays), so the planted paws never slide. */
export const walkStrideFor = (px: number): number => (192 * px) / 1024;
/** The window grows by what the cat grew, so a question's bubble and buttons still fit above it. */
export const petStripHeight = (px: number): number => stripHeight + Math.max(0, px - petSize);
/** How far the cat's centre keeps from the floor's ends (70 at 보통). */
export const floorMargin = (px: number): number => Math.round((70 * px) / petSize);
/** Seconds of no input before the pet dozes off, and before it notices the person is back. */
export const sleepAfterSeconds = 300;
export const wakeWithinSeconds = 5;

export const isResting = (action: PetAction): boolean => action.kind === "sit" || action.kind === "sleep";

// ─── #67: a window the cat's size, and frames only as often as they show ─────

/**
 * The window: the cat's 252px box with room on both sides for its bubble (240px at most), which slides up to 56px
 * inward near a screen edge (`bubbleShift`). The cat stays in its middle; the window moves along the floor with it.
 */
export const petWindowWidth = 360;

/** Where the window's left edge goes (floor coordinates) for the cat's centre at `x`; near an edge it hangs past the floor. */
export const petWindowLeft = (x: number): number => Math.round(x - petWindowWidth / 2);

/**
 * #307: the window over the cat whose centre is at `x` along `floor` (screen coordinates), moved by `shift` (off-screen
 * runs). The window is made with these bounds and placed with them (Electron's default is the display's centre).
 */
export const petWindowBounds = (floor: Rect, x: number, shift: { x: number; y: number } = { x: 0, y: 0 }): Rect =>
  ({ x: floor.x + petWindowLeft(x) + shift.x, y: floor.y + shift.y, width: petWindowWidth, height: floor.height });

/** What placing the pet uses of its window (a BrowserWindow; a fake Windows window in the tests). */
export interface PetPlacedWindow { setBounds(bounds: Rect): void }

/**
 * #313: puts the pet's window at `bounds` with its whole size, every time — never `setPosition`. Electron's
 * setPosition is setBounds(the new place, the size read back from the system), and on Windows at 125 % · 150 % the size
 * read back can be rounded up (whole physical pixels): each step of a walk (about 11 a second) could make the window a
 * DIP taller (test/petFloor.test.ts models it). Its top stays put, so the cat drawn at its bottom sank below the taskbar
 * until only its ears showed. Returns where it is now; nothing is sent when it is there already (`placed`).
 */
export function placePetWindow(window: PetPlacedWindow, bounds: Rect, placed?: Rect): Rect {
  if (placed && placed.x === bounds.x && placed.y === bounds.y && placed.width === bounds.width && placed.height === bounds.height) return placed;
  window.setBounds(bounds);
  return { ...bounds };
}

/**
 * Where a walking cat's window is: the walk's place held for each of its eight pictures, so the window moves once a
 * step with the picture (about 11 times a second, 2 px a time) and the paws drawn on the ground stay put between.
 */
export function walkStepX(action: Extract<PetAction, { kind: "walk" }>, start: number, now: number, px = petSize): number {
  const u = Math.min(1, Math.max(0, now - start) / clipMs(action));
  if (u >= 1) return action.to;
  const distance = Math.abs(action.to - action.from);
  const step = walkStrideFor(px) / walkCycleFrames;
  const travelled = Math.floor((distance * (0.5 - 0.5 * Math.cos(Math.PI * u))) / step) * step;
  return action.from + Math.sign(action.to - action.from) * travelled;
}

/**
 * How often a clip is drawn (ms between frames). Every frame of an always-on-top window costs the GPU, so a clip is
 * drawn only as often as it visibly changes: a walk's steps (about 11 pictures a second; the window itself moves with
 * the cat) and a groom at 30, slow tilts, sips and yawns at 15, the short bouncy hops at every frame; a blink and a stretch
 * only swap the picture.
 */
export function clipFrameMs(action: PetAction): number {
  switch (action.kind) {
    case "sit": case "sleep": case "blink": return Infinity;
    case "stretch": return 100;
    case "tilt": case "tea": case "yawn": return 66;
    case "walk": case "groom": return 33;
    case "hop": case "happy": case "cheer": return 0;
  }
}

/**
 * #67: the resting cat takes one breath (and a little sway) when it settles, then sits still until its next moment
 * (5–14 s later). Breathing all the time kept the window drawing 8 times a second: 1–2 % CPU, mostly the GPU's.
 */
export const restBreathMs = { awake: 2600, asleep: 3400 } as const;

export function clipMs(action: PetAction): number {
  switch (action.kind) {
    case "sit": case "sleep": return 0;
    case "blink": return 200;
    case "tilt": return 1500;
    case "hop": return 550;
    case "stretch": return 2400;
    case "groom": return 2600;
    case "yawn": return 1700;
    case "happy": return 1500;
    case "cheer": return 1700;
    case "tea": return 4000;
    case "walk": return Math.max(600, (Math.abs(action.to - action.from) / walkSpeed) * 1000);
  }
}

export function petFrame(action: PetAction, start: number, homeX: number, now: number, px = petSize): PetFrame {
  const duration = clipMs(action);
  const t = Math.max(0, now - start) / 1000;
  const u = duration > 0 ? Math.min(1, (t * 1000) / duration) : 1;
  const frame: PetFrame = { pose: { ...restPose }, image: "idle", facingRight: false, x: homeX, sleepy: false };
  switch (action.kind) {
    case "sit":
      break;
    case "sleep":
      frame.image = "sleep";
      frame.sleepy = true;
      break;
    case "blink":
      frame.image = "blink";
      break;
    case "tilt":
      frame.image = "curious";
      frame.pose.rotation = -2 * Math.sin(Math.PI * u) ** 2;
      break;
    case "hop":
      frame.pose = hop(u, 10);
      break;
    case "stretch":
      frame.image = u > 0.12 && u < 0.88 ? "stretch" : "idle";
      break;
    case "groom":
      frame.image = "groom";
      frame.pose.rotation = 2 * Math.sin(t * 9) * Math.sin(Math.PI * u);
      break;
    case "yawn":
      frame.image = u > 0.1 && u < 0.9 ? "yawn" : "idle";
      frame.pose.scaleY = 1 + 0.04 * Math.sin(Math.PI * u);
      break;
    case "happy":
      frame.image = "happy";
      frame.pose = hop(Math.min(1, u * 2.2), 6, frame.pose);
      frame.hearts = u;
      break;
    case "tea":
      // A quiet sip: the cup comes up, a small tip of the head, then back to sitting.
      frame.image = u > 0.08 && u < 0.92 ? "tea" : "idle";
      frame.pose.rotation = -1.5 * Math.sin(Math.PI * Math.min(1, u * 1.6)) ** 2;
      break;
    case "cheer": {
      frame.image = "cheer";
      const bounce = u < 0.5 ? u * 2 : (u - 0.5) * 2;
      frame.pose = hop(bounce, 12, frame.pose);
      frame.sparkles = u;
      break;
    }
    case "walk": {
      const eased = 0.5 - 0.5 * Math.cos(Math.PI * u); // gentle start and stop
      const travelled = Math.abs(action.to - action.from) * eased;
      frame.x = action.from + (action.to - action.from) * eased;
      frame.facingRight = action.to > action.from;
      // Paw lifts are drawn into each frame; a global bounce would lift planted paws too.
      frame.walkFrame = Math.floor((travelled / walkStrideFor(px)) * walkCycleFrames) % walkCycleFrames;
      break;
    }
  }
  return frame;
}

function hop(u: number, height: number, base: MascotPose = restPose): MascotPose {
  const air = Math.sin(Math.PI * u);
  const squash = u < 0.15 ? 0.05 * (u / 0.15) : u > 0.85 ? 0.05 * ((1 - u) / 0.15) : -0.04 * air;
  return { ...base, lift: air * height, scaleY: 1 - squash, scaleX: 1 + squash * 0.75 };
}

// ─── Behaviour ────────────────────────────────────────────────────────────────

export interface IdleContext {
  reduceMotion: boolean;
  wanders: boolean;
  homeX: number;
  /** Where wandering would head (already clamped to the floor). */
  walkTarget: number;
}

/** Weighted choices for the next idle moment, as on macOS. */
export function idleChoices(context: IdleContext): [PetAction, number][] {
  const choices: [PetAction, number][] = [[{ kind: "blink" }, 34], [{ kind: "tilt" }, 14], [{ kind: "sit" }, 12]];
  if (!context.reduceMotion) choices.push([{ kind: "hop" }, 5]);
  choices.push([{ kind: "stretch" }, 7], [{ kind: "yawn" }, 3], [{ kind: "groom" }, 7], [{ kind: "tea" }, 5]);
  if (context.wanders && !context.reduceMotion && Math.abs(context.walkTarget - context.homeX) > 40) {
    choices.push([{ kind: "walk", from: context.homeX, to: context.walkTarget }, 22]);
  }
  return choices;
}

/** `random` is in [0, 1). */
export function pickWeighted<T>(choices: [T, number][], random: number): T {
  const total = choices.reduce((sum, [, weight]) => sum + weight, 0);
  let pick = Math.floor(random * total);
  for (const [value, weight] of choices) {
    if (pick < weight) return value;
    pick -= weight;
  }
  return choices[choices.length - 1][0];
}

/** Keeps the pet's centre on the floor strip, clear of both ends (`margin`: `floorMargin` of its size, 70 at 보통). */
export const clampFloorX = (x: number, width: number, margin = 70): number => Math.min(Math.max(x, margin), Math.max(margin, width - margin));

export interface Rect { x: number; y: number; width: number; height: number }

/** A reminder bubble just above the cat, centred on it but kept inside the work area. */
export function bubbleAbove(cat: Rect, size: { width: number; height: number }, area: Rect): { x: number; y: number } {
  return {
    x: Math.min(Math.max(cat.x + cat.width / 2 - size.width / 2, area.x + 8), area.x + area.width - size.width - 8),
    y: Math.max(area.y, cat.y - size.height - 4),
  };
}

/**
 * Keeps the cat's bubble on screen: near an edge it slides inward (the shift), and its little
 * pointer slides back the other way so it still points at the cat. Same as the Mac's PetBubble.
 */
export const bubbleMargin = 6;

export function bubbleShift(centerX: number, width: number, stripWidth: number): number {
  if (width <= 0 || stripWidth <= width + 2 * bubbleMargin) return 0;
  const half = width / 2;
  if (centerX - half < bubbleMargin) return bubbleMargin - (centerX - half);
  if (centerX + half > stripWidth - bubbleMargin) return stripWidth - bubbleMargin - (centerX + half);
  return 0;
}

/** The pointer's offset from the bubble's middle, kept clear of the rounded corners. */
export function bubblePointer(shift: number, width: number): number {
  const limit = Math.max(0, width / 2 - 18);
  return Math.min(Math.max(-shift, -limit), limit);
}
