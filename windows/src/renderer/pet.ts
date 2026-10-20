import { bubblePointer, bubbleShift, clampFloorX, clipMs, isResting, petFrame, petSize, walkCycleFrames, type PetFrame, type PetImage, type PetPayload } from "../core/pet";
import { wrapBubble } from "../core/bubbleText";
import { lang, paper, reduceMotion, t } from "./api";

const api = paper();
const pet = document.getElementById("pet")!;
const shadow = pet.querySelector<HTMLElement>(".shadow")!;
const cat = pet.querySelector<HTMLElement>(".cat")!;
const art = pet.querySelector<HTMLImageElement>(".art")!;
const fx = pet.querySelector<HTMLElement>(".fx")!;
const zs = pet.querySelector<HTMLElement>(".zs")!;
const bubble = pet.querySelector<HTMLElement>(".bubble")!;

const size = petSize;
const petWidth = 252;

// ─── Art ──────────────────────────────────────────────────────────────────────

const imageURL = (image: PetImage) => image === "idle" ? "../../assets/cat.png" : `../../assets/pet/256/${image}.png`;
const walkURL = (index: number) => `../../assets/pet/256/walk-cycle-0${index + 1}.png`;
// Decoded up front so switching poses mid-clip never flickers.
const preloaded: HTMLImageElement[] = [];
for (const url of [...(["idle", "blink", "happy", "sleep", "yawn", "stretch", "cheer", "curious", "groom", "tea"] as PetImage[]).map(imageURL),
  ...Array.from({ length: walkCycleFrames }, (_, index) => walkURL(index))]) {
  const image = new Image();
  image.src = url;
  preloaded.push(image);
}

// ─── State ────────────────────────────────────────────────────────────────────

let state: PetPayload | undefined;
let activityID = -1;
let activityStart = 0;
let frameRequest: number | undefined;
/** While dragging along the floor the renderer moves the cat itself; main hears where it landed. */
let dragX: number | undefined;
let press: { pointerId: number; x: number; y: number; originX: number; dragging: boolean } | undefined;
let suppressClick = false;
/** What main was last told; unknown after each state so the next mouse move re-reports. */
let interactive: boolean | undefined;
/** What the bubble shows now, so a state that changes nothing there leaves it (and its animation) alone. */
let bubbleKey = "";

/** A line, or 종이냥 한마디 asking something with answer buttons. */
function showBubble(next: PetPayload): void {
  const key = next.question ? `q\n${next.question.text}\n${next.question.answers.join("\n")}` : `m\n${next.message ?? ""}`;
  if (key === bubbleKey) return;
  bubbleKey = key;
  const question = next.question;
  bubble.classList.toggle("asking", Boolean(question));
  if (!question) {
    bubble.setAttribute("role", "status");
    bubble.removeAttribute("aria-label");
    bubble.textContent = wrapBubble(next.message ?? "", lang());
    bubble.hidden = !next.message;
    return;
  }
  const text = document.createElement("div");
  text.className = "bubble-text";
  text.textContent = wrapBubble(question.text, lang());
  const answers = document.createElement("div");
  answers.className = "answers";
  question.answers.forEach((label, index) => {
    const button = document.createElement("button");
    button.className = index === 0 ? "answer first" : "answer";
    button.textContent = label;
    button.addEventListener("click", () => api.send("pet:answer", index));
    answers.append(button);
  });
  bubble.setAttribute("role", "group");
  bubble.setAttribute("aria-label", t("종이냥의 질문: {question}", { question: question.text }));
  bubble.replaceChildren(text, answers);
  bubble.hidden = false;
}

function receive(next: PetPayload): void {
  state = next;
  showBubble(next);
  if (next.activity.id !== activityID) {
    activityID = next.activity.id;
    activityStart = performance.now();
  }
  if (!press?.dragging) dragX = undefined;
  interactive = undefined;
  draw(performance.now());
  if (clipRunning(performance.now())) startLoop();
}

// ─── Drawing ──────────────────────────────────────────────────────────────────

const clipRunning = (now: number) => state !== undefined && !isResting(state.activity.action) && !reduceMotion()
  && now - activityStart < clipMs(state.activity.action) + 50;

/** Frames are drawn only while a clip plays; resting poses draw once and breathe in CSS. */
function startLoop(): void {
  if (frameRequest !== undefined) return;
  const tick = (now: number) => {
    frameRequest = undefined;
    draw(now);
    if (clipRunning(now)) frameRequest = requestAnimationFrame(tick);
  };
  frameRequest = requestAnimationFrame(tick);
}

function draw(now: number): void {
  if (!state) return;
  const action = state.activity.action;
  const frame = petFrame(action, activityStart, dragX ?? state.homeX, reduceMotion() ? activityStart : now);
  pet.style.left = `${frame.x - petWidth / 2}px`;
  if (!bubble.hidden) {
    // Near the screen's edges the bubble slides inward; its pointer still finds the cat.
    const width = bubble.offsetWidth;
    const shift = bubbleShift(frame.x, width, window.innerWidth);
    bubble.style.setProperty("--shift", `${shift}px`);
    bubble.style.setProperty("--pointer", `${bubblePointer(shift, width)}px`);
  }
  zs.hidden = !frame.sleepy;
  const url = frame.walkFrame !== undefined ? walkURL(frame.walkFrame) : imageURL(frame.image);
  if (art.getAttribute("src") !== url) art.setAttribute("src", url);
  const { pose } = frame;
  const flip = frame.facingRight && frame.walkFrame !== undefined ? " scaleX(-1)" : "";
  cat.style.transformOrigin = `${pose.pivotX * 100}% ${pose.pivotY * 100}%`;
  cat.style.transform = `translateY(${-pose.lift}px) rotate(${pose.rotation}deg) scale(${pose.scaleX}, ${pose.scaleY})${flip}`;
  // Breathing and swaying only while resting (walking frames and clips carry their own motion).
  const breathing = frame.walkFrame !== undefined || !isResting(action) ? "" : frame.sleepy ? "asleep" : "awake";
  art.classList.toggle("awake", breathing === "awake");
  art.classList.toggle("asleep", breathing === "asleep");
  shadow.style.width = `${size * 0.58 * (1 - 0.02 * pose.lift)}px`;
  shadow.style.background = `rgba(0, 0, 0, ${Math.max(0, 0.1 - 0.006 * pose.lift)})`;
  drawEffects(frame);
}

const heartPath = "M12 21s-7.5-4.6-9.6-9.1C.8 8.5 2.7 4.5 6.4 4.5c2.3 0 3.9 1.4 5.6 3.5 1.7-2.1 3.3-3.5 5.6-3.5 3.7 0 5.6 4 4 7.4C19.5 16.4 12 21 12 21z";
const sparklePath = "M12 1.5c.7 5.4 5.1 9.8 10.5 10.5-5.4.7-9.8 5.1-10.5 10.5C11.3 17.1 6.9 12.7 1.5 12 6.9 11.3 11.3 6.9 12 1.5z";

function glyph(path: string, px: number, color: string, left: number, bottom: number, opacity: number): SVGSVGElement {
  const wrapper = document.createElement("span");
  wrapper.innerHTML = `<svg viewBox="0 0 24 24" width="${px}" height="${px}"><path d="${path}" fill="${color}"/></svg>`;
  const svg = wrapper.firstElementChild as SVGSVGElement;
  svg.style.left = `${left - px / 2}px`;
  svg.style.bottom = `${bottom}px`;
  svg.style.opacity = String(opacity);
  return svg;
}

/** Hearts rise when petted; sparkles burst on a cheer. */
function drawEffects(frame: PetFrame): void {
  const glyphs: SVGSVGElement[] = [];
  const centre = (size + 40) / 2;
  if (frame.hearts !== undefined) {
    for (let index = 0; index < 3; index += 1) {
      const u = Math.max(0, Math.min(1, (frame.hearts - index * 0.18) / 0.7));
      if (u <= 0) continue;
      glyphs.push(glyph(heartPath, 11 + index * 2, "rgb(237, 140, 140)", centre + (index - 1) * size * 0.22, size * 0.75 + u * 28, 1 - u));
    }
  }
  if (frame.sparkles !== undefined) {
    const u = frame.sparkles;
    for (let index = 0; index < 4; index += 1) {
      const angle = (index * Math.PI) / 2 + Math.PI / 4;
      const radius = size * (0.35 + 0.25 * u);
      glyphs.push(glyph(sparklePath, 10, "rgb(219, 173, 64)", centre + Math.cos(angle) * radius, size * 0.5 - Math.sin(angle) * radius, Math.sin(Math.PI * u)));
    }
  }
  if (glyphs.length > 0 || fx.childElementCount > 0) fx.replaceChildren(...glyphs);
}

// ─── Mouse ────────────────────────────────────────────────────────────────────

function setInteractive(value: boolean): void {
  if (interactive === value) return;
  interactive = value;
  api.send("pet:interactive", value);
}

/** Only the cat (and a question's buttons) catch the mouse; everywhere else clicks fall through to the desktop. */
function overPet(x: number, y: number): boolean {
  const rect = cat.getBoundingClientRect();
  if (x >= rect.left - 8 && x <= rect.right + 8 && y >= rect.top && y <= rect.bottom) return true;
  if (!state?.question || bubble.hidden) return false;
  const box = bubble.getBoundingClientRect();
  return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom + 6;
}

window.addEventListener("mousemove", (event) => { if (!press) setInteractive(overPet(event.clientX, event.clientY)); });
document.documentElement.addEventListener("mouseleave", () => { if (!press) setInteractive(false); });

function beginPress(event: PointerEvent): void {
  suppressClick = false;
  if (event.button !== 0 || !state) return;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  press = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, originX: dragX ?? state.homeX, dragging: false };
}

function movePress(event: PointerEvent): void {
  if (!press || event.pointerId !== press.pointerId || !state) return;
  if (!press.dragging && Math.hypot(event.screenX - press.x, event.screenY - press.y) >= 4) {
    press.dragging = true;
    api.send("pet:drag-start");
  }
  if (!press.dragging) return;
  dragX = clampFloorX(press.originX + event.screenX - press.x, window.innerWidth);
  draw(performance.now());
}

function endPress(event: PointerEvent): void {
  if (!press || event.pointerId !== press.pointerId) return;
  if (press.dragging) {
    suppressClick = true;
    api.send("pet:drag-end", dragX);
  }
  press = undefined;
  interactive = undefined;
}

cat.addEventListener("pointerdown", beginPress);
cat.addEventListener("pointermove", movePress);
cat.addEventListener("pointerup", endPress);
cat.addEventListener("pointercancel", endPress);
cat.addEventListener("contextmenu", (event) => { event.preventDefault(); api.send("pet:menu"); });

// Click to pet (hearts), double-click to open the note.
cat.addEventListener("click", (event) => {
  if (suppressClick) { suppressClick = false; return; }
  if (event.detail === 2) api.send("pet:open-note");
  else if (event.detail === 1) api.send("pet:click");
});

// ─── Wiring ───────────────────────────────────────────────────────────────────

api.on("pet:state", (payload) => receive(payload as PetPayload));
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
motionQuery.addEventListener("change", () => api.send("pet:ready", motionQuery.matches));
api.send("pet:ready", motionQuery.matches);
