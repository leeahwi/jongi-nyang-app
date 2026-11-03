import { reduceMotion } from "./api";

/**
 * #67: the cat's resting breath and sway (the desktop cat, the timer's cat) and the sleeping Z's. They are CSS
 * animations held paused, and this moves them on about 8 times a second: `--t` is the ms since each one started, and
 * the CSS turns it into a negative animation-delay (pet.css, timer.css). At 60 frames a second they kept these
 * always-on-top windows drawing all the time, and their motion is under 2 px.
 */
const stepMs = 125;
const running = new Map<HTMLElement, { kind: string; start: number }>();
let timer: number | undefined;

function tick(): void {
  const now = performance.now();
  for (const [element, { start }] of running) element.style.setProperty("--t", String(Math.round(now - start)));
}

function arm(): void {
  const on = running.size > 0 && !document.hidden && !reduceMotion();
  if (on && timer === undefined) { tick(); timer = window.setInterval(tick, stepMs); }
  else if (!on && timer !== undefined) { clearInterval(timer); timer = undefined; }
}
document.addEventListener("visibilitychange", arm);
window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", arm);

/**
 * `element`'s sampled animation is `kind` now (its class: "awake", "asleep", "zs"), or none. A new kind starts from
 * its beginning, as a CSS animation does when its name changes; the same kind again goes on where it is.
 */
export function sampled(element: HTMLElement, kind: string | undefined): void {
  const current = running.get(element);
  if (kind === current?.kind) return;
  if (kind === undefined) running.delete(element);
  else {
    running.set(element, { kind, start: performance.now() });
    element.style.setProperty("--t", "0");
  }
  arm();
}
