import { greetingMs, leaveMs, mascotPose, walkInMs, type MascotPhase } from "../core/motion";
import type { PopupPayload, PopupTask, ReminderStyle } from "../core/types";
import { clock, minutesAway, timeRange } from "../core/lang";
import { h, icon, lang, paper, reduceMotion, t } from "./api";
import { slipButton, slipHead, tape } from "./slip";

const api = paper();
const stage = document.getElementById("stage")!;
const visibleLimit = 3;
/** The window's width per style: the 400-wide slip, its tail, and the cat's room (paper, character). */
const widths: Record<ReminderStyle, number> = { compact: 416, paper: 497, character: 521 };
const gutters: Record<ReminderStyle, number> = { compact: 0, paper: 72, character: 96 };
const catSizes: Record<ReminderStyle, number> = { compact: 0, paper: 63, character: 86 };
const popupFontSize = { pen: 23, brush: 22, clean: 17 } as const;

/** Everything about the reminder on screen; a new show() or reset() replaces it wholesale. */
interface Session {
  payload: PopupPayload;
  tasks: PopupTask[];
  completed: Set<string>;
  phase: MascotPhase;
  travel: number;
  bubble: HTMLDivElement;
  cat?: { track: HTMLDivElement; lift: HTMLDivElement; image: HTMLImageElement; shadow: HTMLDivElement; size: number };
  timers: number[];
  /** The window's size as placed (it grows upward when the ⌄ menu needs room). */
  size: { width: number; height: number };
  frame?: number;
  remainingMs?: number;
  deadline?: number;
  dismissTimer?: number;
  hovering: boolean;
  /** The pointer is over the bubble or the cat, remembered even while the bubble is still opening. */
  pointerInside: boolean;
  menuOpen: boolean;
  finishing: boolean;
}

let session: Session | undefined;
/** The bubble's footer check (내일로 · 5분 전에 다시 down to their icons when it doesn't fit), run again when sizes change. */
let fitFoot: (() => void) | undefined;
const footWatch = new ResizeObserver(() => fitFoot?.());
document.fonts.addEventListener("loadingdone", () => fitFoot?.());

function later(current: Session, ms: number, action: () => void): void {
  current.timers.push(window.setTimeout(() => { if (session === current) action(); }, ms));
}

function reset(): void {
  if (!session) return;
  for (const timer of session.timers) clearTimeout(timer);
  if (session.dismissTimer) clearTimeout(session.dismissTimer);
  if (session.frame) cancelAnimationFrame(session.frame);
  session = undefined;
  stage.replaceChildren();
}

// ─── Showing ──────────────────────────────────────────────────────────────────

async function show(payload: PopupPayload): Promise<void> {
  reset();
  const walks = payload.style !== "compact" && !reduceMotion();
  const current: Session = {
    payload, tasks: payload.tasks, completed: new Set(), phase: { kind: "still" }, travel: 0,
    bubble: h("div"), timers: [], size: { width: 0, height: 0 }, hovering: false, pointerInside: false, menuOpen: false, finishing: false,
  };
  session = current;
  document.documentElement.dataset.font = payload.font;
  document.documentElement.style.setProperty("--popup-size", `${popupFontSize[payload.font]}px`);

  const width = widths[payload.style];
  stage.style.width = `${width}px`;
  current.bubble = buildBubble(current);
  stage.append(current.bubble);
  // A long language or a wide font: the optional buttons (내일로, 5분 전에 다시) keep only their icons.
  // (Measured again whenever the text changes size: a font arriving later, a different face.)
  const foot = current.bubble.querySelector<HTMLElement>(".slip-foot");
  if (foot) {
    const fit = () => {
      foot.classList.remove("tight");
      if (foot.scrollWidth > foot.clientWidth + 1) foot.classList.add("tight");
    };
    fit();
    fitFoot = fit;
    footWatch.disconnect();
    footWatch.observe(foot.querySelector(".split") ?? foot.firstElementChild ?? foot);
  }
  if (payload.style !== "compact") current.cat = buildCat(current);

  // Room above the slip for its tape and below it for the shadow.
  const height = Math.max(payload.style === "character" ? 186 : 180, Math.ceil(current.bubble.offsetHeight + 50));
  current.size = { width, height };
  const { travel } = await api.placePopup({ width, height });
  if (session !== current) return;
  stage.style.width = "";
  current.travel = travel;

  if (!walks) {
    requestAnimationFrame(() => { current.bubble.classList.add("open"); void hoverIfInside(current); });
    return beginReading(current);
  }
  current.phase = { kind: "walkingIn", start: performance.now() };
  animate(current);
  later(current, walkInMs, () => {
    current.phase = { kind: "arrived", start: performance.now() };
    current.bubble.classList.add("open");
    void hoverIfInside(current);
    later(current, 300, () => beginReading(current));
    // Once the greeting is over the cat holds still and nothing redraws.
    later(current, greetingMs, () => { if (current.phase.kind === "arrived") current.phase = { kind: "still" }; });
  });
}

function buildBubble(current: Session): HTMLDivElement {
  const { payload } = current;
  const hasTail = payload.style !== "compact";
  const tailInset = payload.style === "character" ? 46 : 37;
  const bubble = h("div", { class: `bubble${hasTail ? " tail" : " compact"}`, role: "alertdialog" });
  bubble.style.left = `${gutters[payload.style] + 8 + (hasTail ? 9 : 0)}px`;
  bubble.style.width = `${widths[payload.style] - gutters[payload.style] - 16 - (hasTail ? 9 : 0)}px`;
  bubble.style.setProperty("--tail", `${tailInset}px`);
  if (payload.sweep) return buildSweep(current, bubble);
  const events = Boolean(payload.calendarEvents);
  const head = slipHead({
    icon: events ? "calendar" : "bell", tint: events ? "event" : "clay", title: events ? t("일정", undefined, "alert") : payload.scheduled ? t("할 일 알림") : t("남은 할 일"),
    onClose: () => api.send("popup:closed"), closeLabel: t("알림 닫기"),
  });
  const body = h("div", { class: "slip-body" });
  const foot = h("div", { class: "slip-foot" });
  bubble.append(tape(events ? "event" : "alarm"), head.element, body, foot);
  watchPointer(current, bubble);
  if (events) {
    buildEvents(current, head.context, body, foot);
    return bubble;
  }
  const rows = h("div", { class: "rows" });
  const visible = current.tasks.slice(0, visibleLimit);
  for (const task of visible) rows.append(taskRow(current, task, payload.scheduled));
  body.append(rows);
  const hidden = current.tasks.length - visible.length;
  if (hidden > 0) {
    const more = h("button", { class: "more", title: t("노트 열기") }, t("외 {n}개 · 노트에서 보기", { n: hidden }));
    more.addEventListener("click", () => api.send("popup:open"));
    body.append(more);
  }
  // A due reminder: 모두 끝냄 (or 끝냄 with one row), every row shown done at once. The periodic nudge
  // isn't a due list, so one click mustn't finish a handful (as on the Mac): its rows keep their own
  // boxes and the primary opens the note.
  // 모두 끝냄: the rows all checked at once, sent together (one undo step and the note's "3개 끝냈어요").
  const finishAll = payload.scheduled
    ? slipButton(visible.length > 1 ? t("모두 끝내기") : t("끝내기"), "primary", () => completeAll(current, visible))
    : slipButton(t("노트 열기"), "primary", () => api.send("popup:open"));
  if (payload.scheduled) finishAll.disabled = !payload.canComplete;
  if (payload.preview && payload.scheduled) finishAll.title = t("미리보기: 목록은 바뀌지 않아요");
  // 내일로: a task's alert moves its tasks to tomorrow.
  const tomorrow = payload.tomorrow ? slipButton(t("내일로", undefined, "bubble"), "ghost", () => api.send("popup:tomorrow")) : null;
  if (tomorrow) { tomorrow.title = t("할 일을 내일로 옮겨요"); tomorrow.setAttribute("aria-label", t("내일로")); tomorrow.prepend(icon("arrowRight", 14, 2)); tomorrow.classList.add("optional", "to-tomorrow"); }
  foot.append(buildSnooze(current), h("span", { class: "spacer" }), ...(tomorrow ? [tomorrow] : []), finishAll);

  const refreshMeta = () => {
    const open = current.tasks.length - current.completed.size;
    // "남은 할 일 · 12개" (not "· 12개 남았어요" under a title that already says it).
    const count = payload.scheduled ? t("{n}개 남았어요", { n: open }) : t("{n}개", { n: open }, "count");
    head.context.textContent = payload.preview ? `· ${t("미리보기")}` : open === 0 ? `· ${t("다 끝냈어요, 수고했어요!")}` : `· ${count}`;
    if (payload.scheduled) finishAll.disabled = !payload.canComplete || visible.every((task) => current.completed.has(task.id));
  };
  refreshMeta();
  bubble.addEventListener("refresh", refreshMeta);
  return bubble;
}

/** 모두 끝냄: every row shown done at once; the main process checks them together. */
function completeAll(current: Session, tasks: PopupTask[]): void {
  const open = tasks.filter((task) => !current.completed.has(task.id));
  if (open.length === 0) return;
  for (const task of open) {
    current.completed.add(task.id);
    const row = current.bubble.querySelector<HTMLElement>(`.task[data-id="${CSS.escape(task.id)}"]`);
    row?.classList.add("done");
    row?.querySelector<HTMLButtonElement>(".check")?.setAttribute("disabled", "");
  }
  current.bubble.dispatchEvent(new Event("refresh"));
  if (!current.payload.preview) api.send("popup:complete-all", open.map((task) => task.id));
  if (current.tasks.slice(0, visibleLimit).every((entry) => current.completed.has(entry.id))) finish(current);
}

/**
 * 저녁 정리: "오늘도 수고했어요. 남은 3개는 내일로 넘길까요?", the tasks (each ticked; untick one to leave it), and
 * 내일로 · 언젠가로 · 그대로 두기 (the morning version: 오늘 할게요 keeps them). It stays until answered.
 */
function buildSweep(current: Session, bubble: HTMLDivElement): HTMLDivElement {
  const { payload } = current;
  const sweep = payload.sweep!;
  const evening = sweep.variant === "evening";
  const chosen = new Set(current.tasks.map((task) => task.id));
  const head = slipHead({ icon: evening ? "moon" : "sun", tint: "sage", title: evening ? t("저녁 정리") : t("아침 정리"), context: `· ${t("{n}개", { n: current.tasks.length }, "count")}`, onClose: () => api.send("popup:sweep", "keep", []), closeLabel: t("닫기") });
  const body = h("div", { class: "slip-body sweep" });
  body.append(h("div", { class: "sweep-msg" }, sweep.message));
  const rows = h("div", { class: "rows sweep-rows", role: "group", "aria-label": t("넘길 할 일") });
  const buttons: HTMLButtonElement[] = [];
  const refresh = () => { for (const button of buttons) button.disabled = chosen.size === 0; };
  for (const task of current.tasks) {
    const title = task.title || t("제목 없는 할 일");
    // #32: a round pick (filled lavender with →: 넘겨요), not the square sage ✓ that means 끝냈어요.
    const box = h("button", { class: "check carry-pick", role: "checkbox", "aria-checked": "true", "aria-label": title }, h("span", {}, icon("arrowRight", 11, 2.8)));
    const row = h("div", { class: "task picked", "data-id": task.id }, box, h("span", { class: "open-task sweep-title", title }, title), h("span", { class: "when" }));
    const flip = () => {
      if (chosen.has(task.id)) chosen.delete(task.id); else chosen.add(task.id);
      row.classList.toggle("picked", chosen.has(task.id));
      box.setAttribute("aria-checked", String(chosen.has(task.id)));
      refresh();
    };
    box.addEventListener("click", flip);
    row.querySelector(".sweep-title")!.addEventListener("click", flip);
    rows.append(row);
  }
  body.append(rows);
  const answer = (choice: "tomorrow" | "someday" | "keep") => api.send("popup:sweep", choice, [...chosen]);
  const foot = h("div", { class: "slip-foot" });
  const tomorrow = slipButton(t("내일로"), evening ? "primary" : "ghost", () => answer("tomorrow"));
  const someday = slipButton(t("언젠가로"), "ghost", () => answer("someday"));
  buttons.push(tomorrow, someday);
  if (evening) foot.append(slipButton(t("그대로 두기"), "ghost", () => answer("keep")), h("span", { class: "spacer" }), someday, tomorrow);
  else foot.append(tomorrow, someday, h("span", { class: "spacer" }), slipButton(t("오늘 할게요"), "primary", () => answer("keep")));
  bubble.append(tape("todo"), head.element, body, foot);
  bubble.classList.add("sweep-bubble");
  watchPointer(current, bubble);
  return bubble;
}

function completeTask(current: Session, task: PopupTask): void {
  if (current.completed.has(task.id)) return;
  current.completed.add(task.id);
  const row = current.bubble.querySelector<HTMLElement>(`.task[data-id="${CSS.escape(task.id)}"]`);
  row?.classList.add("done");
  row?.querySelector<HTMLButtonElement>(".check")?.setAttribute("disabled", "");
  current.bubble.dispatchEvent(new Event("refresh"));
  if (!current.payload.preview) api.send("popup:complete", task.id);
  const visible = current.tasks.slice(0, visibleLimit);
  if (visible.every((entry) => current.completed.has(entry.id))) finish(current);
}

function taskRow(current: Session, task: PopupTask, scheduled: boolean): HTMLDivElement {
  const title = task.title || t("제목 없는 할 일");
  const check = h("button", { class: "check", title: current.payload.preview ? t("미리보기: 목록은 바뀌지 않아요") : t("완료 표시"), "aria-label": t("{title} 완료", { title }) }, h("span", {}, icon("check", 12, 2.6)));
  check.disabled = !current.payload.canComplete;
  const open = h("button", { class: "open-task", title: t("{title} · 노트에서 보기", { title }) }, title);
  open.addEventListener("click", () => api.send("popup:open"));
  const at = scheduled && task.scheduledAt ? new Date(task.scheduledAt) : undefined;
  const row = h("div", { class: "task", "data-id": task.id }, check, open, h("span", { class: "when" }, at ? clock(at.getHours(), at.getMinutes(), lang()) : ""));
  check.addEventListener("click", () => completeTask(current, task));
  return row;
}

/** An event's alert: "일정 · 10분 뒤 17:15" (or 지금), its title in the hand, where and when; 닫기 · 달력에서 열기. */
function buildEvents(current: Session, context: HTMLElement, body: HTMLElement, foot: HTMLElement): void {
  const first = current.tasks[0];
  const start = first?.scheduledAt ? new Date(first.scheduledAt) : undefined;
  const end = first?.endsAt ? new Date(first.endsAt) : undefined;
  const refresh = () => {
    if (!start) { context.textContent = ""; return; }
    const minutes = Math.ceil((start.getTime() - Date.now()) / 60_000);
    const time = clock(start.getHours(), start.getMinutes(), lang());
    context.textContent = minutes <= 0 ? `· ${t("지금")}` : `· ${minutesAway(minutes, lang())} ${time}`;
  };
  refresh();
  current.timers.push(window.setInterval(refresh, 30_000));
  const title = h("button", { class: "event-title", title: t("{title} · 달력에서 보기", { title: first?.title ?? "" }) }, first?.title ?? "");
  title.addEventListener("click", () => api.send("popup:open-event", first.id));
  const when = start && end ? timeRange({ hour: start.getHours(), minute: start.getMinutes() }, { hour: end.getHours(), minute: end.getMinutes() }, lang()) : "";
  const place = h("div", { class: "event-place" }, icon(first?.location ? "place" : "clock", 13), h("span", {}, [first?.location, when].filter(Boolean).join(" · ")));
  body.append(title, place);
  if (current.tasks.length > 1) body.append(h("div", { class: "more" }, t("외 {n}개", { n: current.tasks.length - 1 })));
  const open = slipButton(t("달력에서 열기"), "primary", () => api.send("popup:open-event", first.id));
  open.prepend(icon("open", 14));
  // 5분 전에 다시: the alert comes again five minutes before the start.
  const again = current.payload.eventAgain ? slipButton(t("5분 전에 다시"), "ghost", () => api.send("popup:event-again")) : null;
  again?.prepend(icon("snooze", 14));
  if (again) { again.title = t("5분 전에 다시"); again.setAttribute("aria-label", t("5분 전에 다시")); again.classList.add("optional"); }
  foot.append(...(again ? [again] : []), h("span", { class: "spacer" }), slipButton(t("닫기"), "ghost", () => api.send("popup:closed")), open);
}

/** ↻ 10분 뒤 다시 | ⌄ — the arrow opens 5 · 10 · 30분. */
function buildSnooze(current: Session): HTMLElement {
  const main = h("button", {}, icon("snooze", 14), t("{time} 다시", { time: minutesAway(10, lang()) }));
  const pick = h("button", { title: t("다시 알림 시간 선택"), "aria-label": t("다시 알림 시간 선택"), "aria-haspopup": "menu" }, icon("chevron", 13, 2));
  const split = h("div", { class: "split" }, main, pick);
  if (!current.payload.snoozeEnabled) { main.disabled = true; pick.disabled = true; split.style.opacity = "0.45"; }
  main.addEventListener("click", () => api.send("popup:snooze", 10));
  pick.addEventListener("click", () => {
    const existing = split.querySelector(".pop-menu");
    if (existing) { existing.remove(); current.menuOpen = false; return resumeIfIdle(current); }
    const menu = h("div", { class: "pop-menu", role: "menu" });
    // 5분 · 10분 · 30분 · 1시간 뒤 · 오늘 저녁 7시 · 내일 아침 9시 · (a task's alert) 내일로 미루기.
    const choices = current.payload.snoozeChoices ?? [5, 10, 30].map((minutes) => ({ id: String(minutes), title: t("{time} 다시 알림", { time: minutesAway(minutes, lang()) }), at: undefined as string | undefined }));
    for (const entry of choices) {
      if (entry.id === "tomorrow") menu.append(h("div", { class: "pop-sep", role: "separator" }));
      const choice = h("button", { role: "menuitem" }, entry.id === "tomorrow" ? icon("arrowRight", 13, 2) : icon(entry.id === "evening" || entry.id === "morning" ? "clock" : "snooze", 13), h("span", {}, entry.title));
      choice.addEventListener("click", () => {
        if (entry.id === "tomorrow") api.send("popup:tomorrow");
        else if (entry.at) api.send("popup:snooze-until", entry.at);
        else api.send("popup:snooze", Number(entry.id));
      });
      menu.append(choice);
    }
    split.append(menu);
    current.menuOpen = true;
    pause(current);
    // The menu opens upward; the window grows upward to give it room (the bubble stays where it is).
    const over = 6 - menu.getBoundingClientRect().top;
    if (over > 0) {
      current.size = { width: current.size.width, height: Math.ceil(current.size.height + over) };
      void api.placePopup(current.size).then(() => { if (session === current && current.hovering) api.send("popup:interactive", true); });
    }
  });
  return split;
}

function buildCat(current: Session): NonNullable<Session["cat"]> {
  const size = catSizes[current.payload.style];
  const image = h("img", { class: "cat-img", src: "../../assets/cat.png", alt: t("종이냥, 노트 열기"), title: t("노트 열기"), draggable: "false" });
  image.style.width = image.style.height = `${size}px`;
  image.style.transformOrigin = "50% 93%";
  const shadow = h("div", { class: "cat-shadow" });
  const lift = h("div", { class: "cat-lift" }, image);
  const track = h("div", { class: "cat-track" }, shadow, lift);
  track.style.width = `${size + 10}px`;
  track.style.height = `${size + 12}px`;
  lift.style.position = "absolute";
  lift.style.left = "5px";
  lift.style.bottom = "0";
  shadow.style.width = `${size * 0.6}px`;
  shadow.style.height = `${size * 0.07}px`;
  shadow.style.bottom = `${size * 0.035}px`;
  image.addEventListener("click", () => api.send("popup:open"));
  watchPointer(current, image);
  stage.append(track);
  const cat = { track, lift, image, shadow, size };
  applyPose(current, cat, performance.now());
  return cat;
}

// ─── Motion ───────────────────────────────────────────────────────────────────

function applyPose(current: Session, cat: NonNullable<Session["cat"]>, now: number): void {
  const pose = mascotPose(current.phase, now, current.travel);
  cat.track.style.transform = `translateX(${pose.x}px)`;
  cat.lift.style.transform = `translateY(${-pose.lift}px)`;
  cat.image.style.transformOrigin = `${pose.pivotX * 100}% ${pose.pivotY * 100}%`;
  cat.image.style.transform = `rotate(${pose.rotation}deg) scale(${pose.scaleX}, ${pose.scaleY})`;
  cat.shadow.style.opacity = String(1 - 0.08 * pose.lift);
  cat.shadow.style.width = `${cat.size * 0.6 * (1 - 0.03 * pose.lift)}px`;
}

function animate(current: Session): void {
  const tick = (now: number) => {
    if (session !== current || !current.cat) return;
    applyPose(current, current.cat, now);
    current.frame = current.phase.kind === "still" ? undefined : requestAnimationFrame(tick);
  };
  current.frame = requestAnimationFrame(tick);
}

// ─── Reading time, hover and leaving ──────────────────────────────────────────

function beginReading(current: Session): void {
  if (current.payload.durationMs <= 0) return;
  current.remainingMs = current.payload.durationMs;
  resumeIfIdle(current);
}

/**
 * The window lets clicks through to whatever is behind it until the pointer is over the bubble or the cat
 * (popup:interactive), and through it the page hears only the pointer's moves. So the pointer is remembered
 * while the bubble is still opening (the cat walking in), any move decides whether it is over the bubble or
 * the cat, and when the bubble opens a pointer that has not moved at all is looked up on the screen.
 */
function watchPointer(current: Session, element: HTMLElement): void {
  element.addEventListener("mouseenter", () => setHover(current, true));
  element.addEventListener("mouseleave", () => setHover(current, false));
}

function overSlip(current: Session, target: EventTarget | null): boolean {
  return target instanceof Node && (current.bubble.contains(target) || Boolean(current.cat?.image.contains(target)));
}

// Any move over the window (as the pet and the timer do it): over the bubble or the cat, or not.
document.addEventListener("mousemove", (event) => {
  const current = session;
  if (!current) return;
  const over = overSlip(current, event.target);
  if (over !== current.pointerInside || over !== current.hovering) setHover(current, over);
});

async function hoverIfInside(current: Session): Promise<void> {
  if (current.hovering) return;
  if (!current.pointerInside && !current.bubble.matches(":hover") && !current.cat?.image.matches(":hover")) {
    const at = await api.popupPointer();
    if (session !== current || !at || current.hovering) return;
    if (!overSlip(current, document.elementFromPoint(at.x, at.y))) return;
  }
  setHover(current, true);
}

function setHover(current: Session, hovering: boolean): void {
  current.pointerInside = hovering;
  if (!current.bubble.classList.contains("open")) return;
  current.hovering = hovering;
  api.send("popup:interactive", hovering);
  if (hovering) pause(current); else resumeIfIdle(current);
}

function pause(current: Session): void {
  if (current.finishing || current.dismissTimer === undefined || current.deadline === undefined) return;
  clearTimeout(current.dismissTimer);
  current.dismissTimer = undefined;
  current.remainingMs = Math.max(300, current.deadline - performance.now());
}

function resumeIfIdle(current: Session): void {
  if (current.finishing || current.hovering || current.menuOpen || current.remainingMs === undefined || current.dismissTimer !== undefined) return;
  current.deadline = performance.now() + current.remainingMs;
  current.dismissTimer = window.setTimeout(() => { if (session === current) leave(current); }, current.remainingMs);
}

/** Lets the last check mark land before the bubble folds and the cat heads off. */
function finish(current: Session): void {
  current.finishing = true;
  if (current.dismissTimer) clearTimeout(current.dismissTimer);
  later(current, 700, () => leave(current));
}

function leave(current: Session): void {
  current.finishing = true;
  api.send("popup:interactive", false);
  current.bubble.classList.remove("open");
  current.bubble.querySelector(".pop-menu")?.remove();
  const walksAway = current.cat && !reduceMotion();
  later(current, 160, () => {
    if (!walksAway) return api.send("popup:closed");
    current.phase = { kind: "leaving", start: performance.now() };
    animate(current);
    later(current, leaveMs, () => api.send("popup:closed"));
  });
}

// ─── Wiring ───────────────────────────────────────────────────────────────────

api.on("popup:show", (payload) => void show(payload as PopupPayload));
api.on("popup:reset", reset);
api.on("popup:retain", (ids) => {
  const current = session;
  if (!current || current.payload.preview) return;
  const open = new Set(ids as string[]);
  const kept = current.tasks.filter((task) => open.has(task.id) || current.completed.has(task.id));
  if (kept.length === current.tasks.length) return;
  if (kept.length === 0) return api.send("popup:closed");
  for (const task of current.tasks) {
    if (!kept.includes(task)) current.bubble.querySelector(`[data-id="${CSS.escape(task.id)}"]`)?.remove();
  }
  current.tasks = kept;
  current.bubble.dispatchEvent(new Event("refresh"));
  if (kept.slice(0, visibleLimit).every((task) => current.completed.has(task.id))) finish(current);
});
