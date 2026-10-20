import { clock, isPaused, isRestPhase, phaseName, pomodoroRounds, remainingMs, timerCaption, timerFraction } from "../core/focusTimer";
import type { TimerPayload } from "../core/timerWidget";
import { h, lang, paper, t } from "./api";
import { chime } from "./chime";
import { TabularClock } from "./tabularClock";

const api = paper();
const bubbleSlot = document.querySelector<HTMLElement>(".bubble-slot")!;
const board = document.querySelector<HTMLElement>(".board")!;
const stage = document.querySelector<HTMLElement>(".stage")!;
const cat = document.querySelector<HTMLImageElement>(".cat")!;
const wedge = board.querySelector<SVGPathElement>(".wedge")!;
// The time left, as wide as its form's widest text ("88:88"): the board never changes width as the seconds tick.
const clockView = new TabularClock("clock", "div");
board.querySelector<HTMLElement>(".clock")!.replaceWith(clockView.element);
const phasePill = board.querySelector<HTMLElement>(".phase")!;
const roundDots = board.querySelector<HTMLElement>(".rounds")!;
const pauseButton = board.querySelector<HTMLButtonElement>(".pause")!;
const stopButton = board.querySelector<HTMLButtonElement>(".stop")!;


let state: TimerPayload | undefined;
/** The next once-a-second redraw; only armed while time is running. */
let ticker: number | undefined;
let press: { pointerId: number; x: number; y: number; dragging: boolean } | undefined;
let suppressClick = false;
/** What main was last told; unknown after each state so the next mouse move re-reports. */
let interactive: boolean | undefined;

function receive(next: TimerPayload): void {
  const previous = state;
  state = next;
  interactive = undefined;
  // TimerSize: the page is laid out at 보통 and drawn larger or smaller as a whole.
  const zoom = String(next.scale ?? 1);
  if (document.documentElement.style.zoom !== zoom) document.documentElement.style.zoom = zoom;
  document.body.classList.toggle("done", !next.timer);
  if (next.message !== previous?.message) renderBubble(next.message);
  renderBoard();
}

// ─── Board ────────────────────────────────────────────────────────────────────

const ticks = board.querySelector(".ticks")!;
// Like a Time Timer face: twelve ticks, the ones every three hours longer and darker.
for (let tick = 0; tick < 12; tick += 1) {
  const angle = (tick / 12) * 2 * Math.PI;
  const inner = tick % 3 === 0 ? 0.36 : 0.42;
  const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
  line.setAttribute("x1", String(20 + Math.cos(angle) * 37 * inner));
  line.setAttribute("y1", String(20 + Math.sin(angle) * 37 * inner));
  line.setAttribute("x2", String(20 + Math.cos(angle) * 37 * 0.47));
  line.setAttribute("y2", String(20 + Math.sin(angle) * 37 * 0.47));
  if (tick % 3 === 0) line.setAttribute("class", "major");
  ticks.append(line);
}

/** The remaining time as a wedge that starts at 12 o'clock and shrinks toward it (Time Timer style). */
function wedgePath(fraction: number): string {
  const r = 15.5;
  if (fraction <= 0) return "";
  if (fraction >= 1) return `M20 ${20 - r}a${r} ${r} 0 1 0 0.001 0z`;
  const angle = -Math.PI / 2 - 2 * Math.PI * fraction;
  const x = 20 + r * Math.cos(angle), y = 20 + r * Math.sin(angle);
  return `M20 20L20 ${20 - r}A${r} ${r} 0 ${fraction > 0.5 ? 1 : 0} 0 ${x.toFixed(3)} ${y.toFixed(3)}Z`;
}

const pausePath = '<svg viewBox="0 0 8 8" aria-hidden="true"><rect x="1" y="0.5" width="2.2" height="7" rx="0.6"/><rect x="4.8" y="0.5" width="2.2" height="7" rx="0.6"/></svg>';
const playPath = '<svg viewBox="0 0 8 8" aria-hidden="true"><path d="M1.5 0.6v6.8L7.4 4z"/></svg>';

/** The timer's own cat: breathing while time runs, eyes closed while paused, cheering when done. */
function renderCat(): void {
  const timer = state?.timer;
  const paused = timer !== undefined && isPaused(timer);
  cat.hidden = !timer && !state?.message;
  const source = !timer ? "../../assets/pet/256/cheer.png" : paused ? "../../assets/pet/256/blink.png" : "../../assets/cat.png";
  if (!cat.src.endsWith(source.replace("../..", ""))) cat.src = source;
  cat.classList.toggle("awake", !paused);
  cat.classList.toggle("asleep", paused);
}

function renderBoard(): void {
  clearTimeout(ticker);
  ticker = undefined;
  renderCat();
  const timer = state?.timer;
  board.hidden = !timer;
  if (!timer) return;
  const now = Date.now();
  const paused = isPaused(timer);
  const remaining = remainingMs(timer, now);
  const left = clock(remaining);
  wedge.setAttribute("d", wedgePath(Math.min(1, timerFraction(timer, now))));
  wedge.style.fill = "var(--phase)"; // focus red or rest sage, per paper (timer.css)
  clockView.text = left;
  // 집중 with the note away: the task's title on the pill (a click on the board brings the note back).
  const focus = state?.focus;
  phasePill.textContent = focus ? focus : paused ? t("일시정지") : phaseName(timer, lang());
  phasePill.classList.toggle("task", Boolean(focus));
  phasePill.title = focus ?? "";
  board.classList.toggle("rest", isRestPhase(timer));
  board.classList.toggle("paused", paused);
  renderRounds(pomodoroRounds(timer));
  const pauseLabel = paused ? t("계속") : t("일시정지");
  if (pauseButton.title !== pauseLabel || !pauseButton.firstChild) {
    pauseButton.innerHTML = paused ? playPath : pausePath;
    pauseButton.title = pauseLabel;
    pauseButton.setAttribute("aria-label", pauseLabel);
  }
  board.title = focus ? t("누르면 노트에서 집중 카드를 보여 줘요 · 끌어서 옮기기") : t("누르면 일시정지 · 계속 · 끌어서 옮기기");
  board.setAttribute("aria-label", t("{caption} 타이머, {left} 남음", { caption: timerCaption(timer, lang()), left }));
  // Once a second while running, on the second the clock changes; nothing at all while paused.
  if (!paused && remaining > 0) ticker = window.setTimeout(renderBoard, (remaining % 1000 || 1000) + 5);
}

/** Pomodoro rounds: filled for the ones done, a ring for the one being focused on. */
function renderRounds(rounds: ReturnType<typeof pomodoroRounds>): void {
  const key = rounds ? `${rounds.done}/${rounds.total}/${rounds.focusing}` : "";
  if (roundDots.dataset.key === key) return;
  roundDots.dataset.key = key;
  roundDots.replaceChildren(...(rounds ? Array.from({ length: rounds.total }, (_, index) =>
    h("i", { class: index < rounds.done ? "done" : rounds.focusing && index === rounds.done ? "now" : "" })) : []));
}

function renderBubble(message: string | undefined): void {
  bubbleSlot.replaceChildren(...(message ? [h("div", { class: "bubble", role: "status", title: t("누르면 닫혀요") }, message)] : []));
}

// ─── Mouse ────────────────────────────────────────────────────────────────────

function setInteractive(value: boolean): void {
  if (interactive === value) return;
  interactive = value;
  api.send("timer:interactive", value);
}

/** Only the cat, its board and the bubble catch the mouse; everywhere else clicks fall through. */
function overWidget(x: number, y: number): boolean {
  return [board, cat, bubbleSlot.firstElementChild as HTMLElement | null].some((element) => {
    if (!element || element.hidden) return false;
    const rect = element.getBoundingClientRect();
    return x >= rect.left - 4 && x <= rect.right + 4 && y >= rect.top - 4 && y <= rect.bottom + 4;
  });
}

window.addEventListener("mousemove", (event) => { if (!press) setInteractive(overWidget(event.clientX, event.clientY)); });
document.documentElement.addEventListener("mouseleave", () => { if (!press) setInteractive(false); });

// The cat and the board both drag the window; a click on the board toggles pause.
stage.addEventListener("pointerdown", (event) => {
  suppressClick = false;
  if (event.button !== 0) return;
  stage.setPointerCapture(event.pointerId);
  press = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, dragging: false };
});
stage.addEventListener("pointermove", (event) => {
  if (!press || event.pointerId !== press.pointerId) return;
  if (!press.dragging && Math.hypot(event.screenX - press.x, event.screenY - press.y) >= 4) {
    press.dragging = true;
    api.send("timer:drag-start");
  }
  if (press.dragging) api.send("timer:drag");
});
const endPress = (event: PointerEvent) => {
  if (!press || event.pointerId !== press.pointerId) return;
  if (press.dragging) {
    suppressClick = true;
    api.send("timer:drag-end");
  }
  press = undefined;
  interactive = undefined;
};
stage.addEventListener("pointerup", endPress);
stage.addEventListener("pointercancel", endPress);
board.addEventListener("click", () => {
  if (suppressClick) { suppressClick = false; return; }
  api.send("timer:toggle");
});
for (const [button, channel] of [[pauseButton, "timer:pause"], [stopButton, "timer:stop"]] as const) {
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("click", (event) => { event.stopPropagation(); api.send(channel); });
}
bubbleSlot.addEventListener("click", () => api.send("timer:dismiss"));
document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
  if (overWidget(event.clientX, event.clientY)) api.send("timer:menu");
});

// ─── Sound ────────────────────────────────────────────────────────────────────

/** Snapshots: the board's width with each of `texts` shown (the same within a form: "10:00" · "09:59" · "00:08"). */
(window as { boardWidths?: (texts: string[]) => number[] }).boardWidths = (texts) => {
  const kept = clockView.text;
  const widths = texts.map((text) => { clockView.text = text; return board.getBoundingClientRect().width / (Number(document.documentElement.style.zoom) || 1); });
  clockView.text = kept;
  return widths;
};

// ─── Wiring ───────────────────────────────────────────────────────────────────

api.on("timer:state", (payload) => receive(payload as TimerPayload));
api.on("timer:chime", chime);
api.send("timer:ready");
