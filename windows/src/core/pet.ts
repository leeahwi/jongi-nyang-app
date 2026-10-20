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

/** Drawn size of the cat, in CSS pixels. */
export const petSize = 92;
export const walkSpeed = 24; // px per second
export const walkCycleFrames = 8;
/** 120px of planted-paw travel over 62.5% of a cycle, drawn at 92/1024 scale. */
export const walkStride = (192 * petSize) / 1024;
/** The floor strip above the taskbar. */
export const stripHeight = 250;
/** Seconds of no input before the pet dozes off, and before it notices the person is back. */
export const sleepAfterSeconds = 300;
export const wakeWithinSeconds = 5;

export const isResting = (action: PetAction): boolean => action.kind === "sit" || action.kind === "sleep";

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

export function petFrame(action: PetAction, start: number, homeX: number, now: number): PetFrame {
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
      frame.walkFrame = Math.floor((travelled / walkStride) * walkCycleFrames) % walkCycleFrames;
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

/** Keeps the pet's centre on the floor strip, clear of both ends. */
export const clampFloorX = (x: number, width: number): number => Math.min(Math.max(x, 70), Math.max(70, width - 70));

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
