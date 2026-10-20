/**
 * The cat artwork faces the viewer, so it walks the way flat mascots do: it rocks onto one
 * front paw, which lifts the other. Every pose is a pure function of time (ported from macOS).
 */
export type MascotPhase =
  | { kind: "still" }
  | { kind: "walkingIn"; start: number }
  | { kind: "arrived"; start: number }
  | { kind: "leaving"; start: number };

export interface MascotPose {
  x: number;
  lift: number;
  rotation: number;
  pivotX: number;
  pivotY: number;
  scaleX: number;
  scaleY: number;
}

export const walkInMs = 2000;
export const leaveMs = 1200;
export const greetingMs = 2350;
const walkInSteps = 8;
const leaveSteps = 5;
const leftPaw = 0.39;
const rightPaw = 0.56;
const pawY = 0.93;

export const restPose: MascotPose = { x: 0, lift: 0, rotation: 0, pivotX: 0.5, pivotY: pawY, scaleX: 1, scaleY: 1 };

export function mascotPose(phase: MascotPhase, now: number, travel: number): MascotPose {
  switch (phase.kind) {
    case "still":
      return restPose;
    case "walkingIn": {
      const u = clamp01((now - phase.start) / walkInMs);
      const distance = 1.15 * u - 0.15 * u ** 4; // even pace, slowing to half speed at the end
      return { ...step(distance * walkInSteps, 1), x: travel * (1 - distance) };
    }
    case "arrived":
      return arrival(Math.max(0, now - phase.start) / 1000);
    case "leaving": {
      const u = clamp01((now - phase.start) / leaveMs);
      const distance = u ** 1.6;
      return { ...step(distance * leaveSteps, Math.min(1, u * 5)), x: travel * distance };
    }
  }
}

function step(progress: number, strength: number): MascotPose {
  const fraction = progress - Math.floor(progress);
  const swing = Math.sin(Math.PI * fraction) * strength;
  const contact = Math.cos(Math.PI * fraction) ** 2 * strength;
  const leftPlanted = Math.floor(progress) % 2 === 0;
  return {
    x: 0,
    lift: swing * 3,
    rotation: (leftPlanted ? -7 : 7) * swing,
    pivotX: leftPlanted ? leftPaw : rightPaw,
    pivotY: pawY,
    scaleX: 1 + 0.03 * contact,
    scaleY: 1 - 0.04 * contact,
  };
}

/** Lands from the last step, gives a small hello hop, tilts its head, then rests. */
function arrival(t: number): MascotPose {
  const pose = { ...restPose };
  let squash = 0.04 * Math.exp(-t * 9) * Math.cos(t * 20);
  const hopStart = 0.4, hopLength = 0.36;
  if (t > hopStart && t < hopStart + hopLength) {
    const height = Math.sin((Math.PI * (t - hopStart)) / hopLength);
    pose.lift = height * 7;
    squash -= 0.05 * height;
  }
  const landed = t - hopStart - hopLength;
  if (landed > 0) squash += 0.05 * Math.exp(-landed * 8) * Math.sin(landed * 22);
  const tiltStart = 1.0, tiltLength = 1.3;
  if (t > tiltStart && t < tiltStart + tiltLength) {
    pose.rotation = -6 * Math.sin((Math.PI * (t - tiltStart)) / tiltLength) ** 2;
  }
  pose.scaleY = 1 - squash;
  pose.scaleX = 1 + squash * 0.75;
  return pose;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
