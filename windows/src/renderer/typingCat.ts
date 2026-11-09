import { newTypingCat, typingKey, typingStop, typingWake, type TypingPose } from "../core/typingCat";
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
// Snapshots: a pose as it is drawn mid-typing.
api.on("typingCat:pose", (pose) => {
  rest();
  if (pose === "left" || pose === "right") cat.pose = pose;
  draw();
});
