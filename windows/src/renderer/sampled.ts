import { reduceMotion } from "./api";

/**
 * #67: the cat's resting breath and sway (the desktop cat, the timer's cat). They are CSS animations held paused, and
 * this moves them on about 8 times a second: `--t` is the ms since each one started, and the CSS turns it into a
 * negative animation-delay (pet.css, timer.css). At 60 frames a second they kept these always-on-top windows drawing
 * all the time, and their motion is under 2 px. A breath can also be one spell (`forMs`): it plays that long, then
 * rests at its first frame (the cat as drawn) and nothing is drawn until the next one.
 */
const stepMs = 125;
const running = new Map<HTMLElement, { kind: string; key: unknown; start: number; until: number }>();
let timer: number | undefined;

function tick(): void {
  const now = performance.now();
  for (const [element, { start, until }] of running) {
    if (now >= until) {
      // The spell is over: back to the first frame (no breath, no sway) and still.
      element.style.setProperty("--t", "0");
      running.delete(element);
    } else element.style.setProperty("--t", String(Math.round(now - start)));
  }
  // Nothing left to move: no more ticks until the next one starts.
  if (running.size === 0 && timer !== undefined) { clearInterval(timer); timer = undefined; }
}

function arm(): void {
  const on = running.size > 0 && !document.hidden && !reduceMotion();
  if (on && timer === undefined) timer = window.setInterval(tick, stepMs);
  else if (!on && timer !== undefined) { clearInterval(timer); timer = undefined; }
}
document.addEventListener("visibilitychange", arm);
window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", arm);

/**
 * `element`'s sampled animation is `kind` now (its class: "awake", "asleep"), or none. A new kind, or a new `key`
 * (a new spell: the cat settled again), starts from its beginning, as a CSS animation does when its name changes;
 * the same kind and key go on where they are (or stay at rest once the spell is over).
 */
export function sampled(element: HTMLElement, kind: string | undefined, spell?: { forMs: number; key: unknown }): void {
  const current = running.get(element);
  const key = spell?.key;
  if (kind === undefined) {
    if (!current) return;
    running.delete(element);
  } else {
    if (current && kind === current.kind && key === current.key) return;
    const last = spells.get(element);
    // A spell already played for this kind and key: it stays at rest.
    if (!current && last && last.kind === kind && last.key === key && spell) return;
    const start = performance.now();
    running.set(element, { kind, key, start, until: spell ? start + spell.forMs : Infinity });
    spells.set(element, { kind, key });
    element.style.setProperty("--t", "0");
  }
  arm();
}
/** The last spell each element played, so a redraw that changes nothing doesn't breathe again. */
const spells = new WeakMap<HTMLElement, { kind: string; key: unknown }>();
