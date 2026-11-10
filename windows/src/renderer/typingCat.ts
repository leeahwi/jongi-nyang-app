import { newTypingCat, onTypingCat, typingKey, typingStop, typingWake, type TypingPose } from "../core/typingCat";
import { paper, reduceMotion } from "./api";

/**
 * 치면 두드리는 고양이 (#230 · #289): the typing cat's own page. The main process says only that a key went down
 * (`typingCat:key`, nothing else); the paws follow core/typingCat.ts here — a paw at once, rest 120 ms after the last
 * key, one timer at most. The three pictures are all loaded and one is shown, so a key never decodes a picture. At rest
 * nothing runs.
 */
const api = paper();
const box = document.getElementById("cat")!;
const pictures = new Map([...box.querySelectorAll<HTMLImageElement>("img")].map((image) => [image.dataset.pose as TypingPose, image]));
const cat = newTypingCat();
let shown: TypingPose = "idle";
let timer: number | undefined;

function draw(): void {
  if (cat.pose === shown) return;
  shown = cat.pose;
  for (const [pose, image] of pictures) image.hidden = pose !== shown;
}

/** The one timer: woken at the paw's time, it puts it back, or waits on when a newer key moved the time. */
function arm(due: number | undefined): void {
  if (due === undefined || timer !== undefined) return;
  timer = window.setTimeout(() => {
    timer = undefined;
    const next = typingWake(cat, performance.now());
    if (next !== undefined) arm(next);
    else draw();
  }, Math.max(0, due - performance.now()));
}

function rest(): void {
  window.clearTimeout(timer);
  timer = undefined;
  typingStop(cat);
  draw();
}

api.on("typingCat:key", () => {
  arm(typingKey(cat, performance.now(), reduceMotion()));
  draw();
});
api.on("typingCat:rest", rest);
api.on("typingCat:away", (away) => {
  box.classList.toggle("away", away === true);
  if (away === true) rest();
});
// ─── Moving it (#331) ─────────────────────────────────────────────────────────

/** What main was last told (unknown after a drag, so the next move says it again). */
let interactive: boolean | undefined;
let press: { pointerId: number; x: number; y: number; dragging: boolean } | undefined;

function setInteractive(value: boolean): void {
  if (interactive === value) return;
  interactive = value;
  api.send("typingCat:interactive", value);
}

/** Only the drawn cat takes the mouse (the picture fills the square window); a click anywhere clear falls through. */
const overCat = (x: number, y: number): boolean => !box.classList.contains("away") && onTypingCat(x / window.innerWidth, y / window.innerHeight);

// Away (or back): main lets clicks through while it is hidden, so the next move says it again.
api.on("typingCat:away", () => { interactive = undefined; press = undefined; });
window.addEventListener("mousemove", (event) => { if (!press) setInteractive(overCat(event.clientX, event.clientY)); });
document.documentElement.addEventListener("mouseleave", () => { if (!press) setInteractive(false); });
// Pressed on the cat and moved 4 px: the window follows the cursor (main moves it); a click without moving does nothing.
window.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 || !overCat(event.clientX, event.clientY)) return;
  document.documentElement.setPointerCapture(event.pointerId);
  press = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, dragging: false };
});
window.addEventListener("pointermove", (event) => {
  if (!press || event.pointerId !== press.pointerId) return;
  if (!press.dragging && Math.hypot(event.screenX - press.x, event.screenY - press.y) >= 4) {
    press.dragging = true;
    api.send("typingCat:drag-start");
  }
  if (press.dragging) api.send("typingCat:drag");
});
const endPress = (event: PointerEvent) => {
  if (!press || event.pointerId !== press.pointerId) return;
  if (press.dragging) api.send("typingCat:drag-end");
  press = undefined;
  interactive = undefined;
};
window.addEventListener("pointerup", endPress);
window.addEventListener("pointercancel", endPress);
// No menu of its own (the tray's 타닥냥 and Settings have its switch).
document.addEventListener("contextmenu", (event) => event.preventDefault());

// Snapshots: a pose as it is drawn mid-typing.
api.on("typingCat:pose", (pose) => {
  rest();
  if (pose === "left" || pose === "right") cat.pose = pose;
  draw();
});
