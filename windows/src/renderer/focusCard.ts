import { clock as timerClock } from "../core/focusTimer";
import { TabularClock } from "./tabularClock";
import type { TodoItem } from "../core/notebook";
import type { AppState, FocusCommand, FocusView } from "../core/types";
import { h, icon, paper, reduceMotion, t } from "./api";

/**
 * 집중: the note as one card — the task and the time left (the design's "할 일 하나와 남은 시간만").
 * At the top 집중 (· 2 / 4 and the round dots for a Pomodoro) and × ; a ring (clay as the time goes,
 * sage when it is up or on a break) with the time left; the task in the hand; what comes next today;
 * the buttons for the stage; the rest of today's tasks, folded (still checkable); the cat at the
 * bottom left, nodding every five minutes. The tabs, the header, the line and the footer step aside.
 */

const api = paper();
const ringRadius = 46;
const ringLength = 2 * Math.PI * ringRadius;

export interface FocusCardHost {
  /** Today's tasks (the 오늘 sheet's), for the folded list. */
  todayItems(): TodoItem[];
  /** "40분 뒤 치과 · 15:30": the day ribbon's next thing (`focusNextLine`), or undefined. */
  next(): string | undefined;
  /** The note's other cards and editors close when the card comes. */
  closeOthers(): void;
  /** The note's toast: it shows on the card while the card is up (the line's "25분 집중을 시작했어요 · 멈추기"). */
  toastHost: HTMLElement;
  /** Where the toast lives otherwise (the dock). */
  toastHome: HTMLElement;
  /** The note is back (the tabs measure themselves again). */
  shown?(): void;
}

export class FocusCard {
  readonly element: HTMLElement;
  private readonly kicker = h("span", { class: "fc-kicker" });
  private readonly dots = h("span", { class: "fc-dots", "aria-hidden": "true" });
  private readonly progress: SVGCircleElement;
  private readonly ring: HTMLElement;
  /** The time, as wide as its form's widest text: it doesn't shift in the ring as it ticks. */
  private readonly clock = new TabularClock("fc-time");
  private readonly time = this.clock.element;
  private readonly under = h("small", { class: "fc-under" });
  /** ⏸ / ▶ under the time (Space). */
  private readonly play = h("button", { class: "fc-play" });
  private readonly task = h("div", { class: "fc-task" });
  private readonly nextLine = h("div", { class: "fc-next" });
  private readonly buttons = h("div", { class: "fc-btns" });
  private readonly restToggle = h("button", { class: "fc-rest", "aria-expanded": "false" });
  private readonly list = h("div", { class: "fc-list", role: "list", hidden: "" });
  private readonly cat = h("img", { class: "fc-cat", src: "../../assets/pet/256/cheer.png", alt: "", draggable: "false" });
  private readonly body: HTMLElement;
  private view?: FocusView;
  private state?: AppState;
  private ticker?: number;
  private expanded = false;
  /** Tasks checked in the folded list while it was open: they stay, struck through. */
  private readonly checkedHere = new Set<string>();
  private shownStage?: string;
  private leaving = false;

  constructor(private readonly host: FocusCardHost) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("class", "fc-svg");
    svg.setAttribute("aria-hidden", "true");
    svg.innerHTML = `<circle class="fc-track" cx="50" cy="50" r="${ringRadius}"/><circle class="fc-progress" cx="50" cy="50" r="${ringRadius}" stroke-dasharray="${ringLength.toFixed(3)}"/>`;
    this.progress = svg.querySelector(".fc-progress")!;
    this.ring = h("div", { class: "fc-ring", role: "timer" }, svg, h("div", { class: "fc-in" }, this.time, this.under, this.play));
    this.play.addEventListener("click", () => this.togglePause());
    const close = h("button", { class: "quiet fc-close", title: t("집중 그만두기 (Esc)"), "aria-label": t("집중 그만두기") }, icon("close", 15));
    close.addEventListener("click", () => this.send({ kind: "askStop" }));
    this.restToggle.addEventListener("click", () => { this.expanded = !this.expanded; this.render(); });
    this.body = h("div", { class: "fc-body" }, this.ring, this.task, this.nextLine, this.buttons);
    this.element = h("div", { class: "focus-card", role: "region", "aria-label": t("집중") },
      // The round dots at the right of the top line, before × (as the mock and the Mac).
      h("div", { class: "fc-top" }, this.kicker, h("span", { class: "spacer" }), this.dots, close),
      this.body,
      // The rest of today: the line, and the list opening below it.
      h("div", { class: "fc-foot" }, this.cat, this.restToggle, h("span", { class: "fc-foot-end" })),
      this.list);
    this.element.hidden = true;
    window.addEventListener("resize", () => this.fit());
    document.fonts.addEventListener("loadingdone", () => this.fit());
  }

  get visible(): boolean { return !this.element.hidden; }

  /** A new state: the card shows while a session is on. */
  update(state: AppState): void {
    this.state = state;
    const view = state.focus;
    const was = this.view;
    this.view = view;
    if (!view) {
      if (!this.element.hidden) this.hide();
      return;
    }
    if (this.element.hidden || was?.startedAt !== view.startedAt) {
      this.host.closeOthers();
      this.expanded = false;
      this.checkedHere.clear();
      this.leaving = false;
      this.element.hidden = false;
      document.documentElement.dataset.focus = "on";
      this.element.append(this.host.toastHost);
    }
    this.render();
  }

  private hide(): void {
    this.element.hidden = true;
    this.host.toastHome.prepend(this.host.toastHost);
    this.host.shown?.();
    delete document.documentElement.dataset.focus;
    clearTimeout(this.ticker);
    this.ticker = undefined;
    this.shownStage = undefined;
  }

  private send(command: FocusCommand): void {
    void api.act({ type: "focus", command });
  }

  /** Esc on the note while the card is up: the question first. */
  escape(): void {
    if (this.visible) this.send({ kind: "askStop" });
  }

  /** ⏸ / ▶ (and Space): the time stops or goes on, while it runs (a focus or a break). */
  togglePause(): void {
    const stage = this.view?.stage;
    if (!this.visible || !this.state?.timer || (stage !== "running" && stage !== "break")) return;
    void api.act({ type: "timerCommand", command: { kind: "togglePause" } });
  }

  /**
   * The card's keys: Space ⏸/▶, Ctrl+Enter 다 했어요, Ctrl+= 5분 더 (Esc is the note's: it asks first).
   * True when the key was the card's.
   */
  key(event: KeyboardEvent): boolean {
    if (!this.visible) return false;
    const stage = this.view?.stage;
    const command = event.ctrlKey || event.metaKey;
    const onButton = event.target instanceof HTMLButtonElement;
    if (event.key === " " && !command && !onButton) { event.preventDefault(); this.togglePause(); return true; }
    if (command && event.key === "Enter" && (stage === "running" || stage === "timeUp")) { event.preventDefault(); this.finish(); return true; }
    if (command && (event.key === "=" || event.key === "+") && (stage === "running" || stage === "timeUp")) { event.preventDefault(); this.send({ kind: "more" }); return true; }
    return false;
  }

  /** Time's up: the soft chime is played by the note (no board while the card is up). */
  private remaining(now = Date.now()): number {
    const timer = this.state?.timer;
    if (!timer) return 0;
    return timer.endsAt !== undefined ? Math.max(0, timer.endsAt - now) : timer.pausedRemainingMs ?? 0;
  }

  private render(): void {
    const view = this.view, state = this.state;
    if (!view || !state) return;
    const stage = view.stage;
    const rest = stage === "break" || stage === "breakOver";
    const up = stage === "timeUp";
    this.element.dataset.stage = stage;

    // 집중 · 2 / 4 with the round dots; "25분 다 됐어요" when the time is up.
    const pomodoro = view.pomodoro;
    const round = pomodoro ? (up || rest ? pomodoro.done : pomodoro.done + 1) : 0;
    this.kicker.textContent = up ? t("{minutes}분 다 됐어요", { minutes: view.minutes })
      : pomodoro ? `${t("집중")} · ${round} / ${pomodoro.total}` : t("집중");
    this.kicker.classList.toggle("up", up);
    // As many dots filled as the round's number (round 2 of 4: ●●○○).
    const dotsKey = pomodoro ? `${round}/${pomodoro.total}` : "";
    if (this.dots.dataset.key !== dotsKey) {
      this.dots.dataset.key = dotsKey;
      this.dots.replaceChildren(...(pomodoro ? Array.from({ length: pomodoro.total }, (_, index) => h("i", { class: index < round ? "d" : "" })) : []));
    }

    // The title: the task in the hand.
    if (this.task.textContent !== view.title) this.task.textContent = view.title;
    this.task.title = view.title;
    const next = this.host.next();
    this.nextLine.textContent = next ?? "";
    this.nextLine.hidden = !next;

    // The buttons for the stage (rebuilt only when it changes, so the focus stays on a button).
    if (this.shownStage !== `${stage}|${pomodoro ? "p" : ""}|${pomodoro?.breakMinutes ?? ""}`) {
      const previous = this.shownStage;
      this.shownStage = `${stage}|${pomodoro ? "p" : ""}|${pomodoro?.breakMinutes ?? ""}`;
      const button = (label: string, kind: "pri" | "", command: FocusCommand | (() => void), key?: string) => {
        const element = h("button", { class: `fc-btn${kind ? " pri" : ""}` }, h("span", {}, label), key ? h("kbd", { class: "keycap" }, key) : null);
        element.addEventListener("click", () => (typeof command === "function" ? command() : this.send(command)));
        return element;
      };
      // Keycaps as on the slips: Ctrl+↩ 다 했어요, Ctrl+= 5분 더, Esc 다음에 (it asks first).
      const finish = button(t("다 했어요", undefined, "focus"), "pri", () => this.finish(), "Ctrl+↩");
      const more = () => button(t("5분 더"), "", { kind: "more" }, "Ctrl+=");
      const later = () => button(t("다음에"), "", { kind: "later" }, "Esc");
      const list: HTMLButtonElement[] = [];
      if (stage === "running") list.push(finish, more(), later());
      else if (up && pomodoro) {
        finish.classList.remove("pri");
        list.push(button(t("{minutes}분 쉬기", { minutes: pomodoro.breakMinutes }), "pri", { kind: "rest" }), finish, more(), later());
      } else if (up) list.push(finish, more(), later());
      else list.push(button(t("다음 라운드"), "pri", { kind: "nextRound" }), button(t("그만하기"), "", { kind: "later" }, "Esc"));
      this.buttons.replaceChildren(...list);
      // Time's up: the primary button pulses once.
      if (up && previous && !previous.startsWith("timeUp") && !reduceMotion()) list[0].classList.add("pulse");
    }

    this.renderList();
    this.tick();
    this.fit();
  }

  /** 다 했어요: the title is struck through (220 ms), then the task is checked and the session ends. */
  private finish(): void {
    if (this.leaving) return;
    this.leaving = true;
    if (reduceMotion()) { this.send({ kind: "done" }); return; }
    this.task.classList.add("struck");
    setTimeout(() => this.send({ kind: "done" }), 420);
  }

  /**
   * A short note (or a long title in English or Dutch): the column must fit without scrolling. First the
   * ring shrinks (to 96), then the title goes to one line (cut with …), the ring to 84, then the 다음 line goes.
   */
  fit(): void {
    if (this.element.hidden) return;
    const body = this.body;
    const over = () => body.scrollHeight > body.clientHeight + 1;
    this.ring.style.removeProperty("--size");
    this.task.classList.remove("one-line");
    this.element.classList.remove("tight");
    if (!over()) return;
    // As the Mac: the ring gives way first (the whole title stays), then the title, then 다음.
    let size = this.ring.getBoundingClientRect().width;
    while (over() && size > 96) {
      size = Math.max(96, size - 6);
      this.ring.style.setProperty("--size", `${size}px`);
    }
    if (over()) this.task.classList.add("one-line");
    while (over() && size > 84) {
      size = Math.max(84, size - 6);
      this.ring.style.setProperty("--size", `${size}px`);
    }
    if (over()) this.element.classList.add("tight");
  }

  /** The ring and the time, once a second while the time runs. */
  private tick(): void {
    clearTimeout(this.ticker);
    this.ticker = undefined;
    const view = this.view, timer = this.state?.timer;
    if (!view || !timer || this.element.hidden) return;
    const now = Date.now();
    const left = this.remaining(now);
    const stage = view.stage;
    const full = stage === "timeUp" || stage === "breakOver";
    const fraction = full ? 1 : timer.durationMs > 0 ? Math.min(1, Math.max(0, 1 - left / timer.durationMs)) : 0;
    this.progress.style.strokeDashoffset = String(ringLength * (1 - fraction));
    // Time up: the minutes run and 집중했어요; a break: 쉬는 중; its end: the next round's length and 쉬는 시간 끝; paused: 멈춤.
    if (stage === "timeUp") {
      // The minutes run, as a clock (25:00), as on the Mac.
      this.clock.text = timerClock(view.minutes * 60_000);
      this.under.textContent = t("집중했어요");
    } else if (stage === "breakOver") { this.clock.text = timerClock(view.minutes * 60_000); this.under.textContent = t("쉬는 시간 끝"); }
    else { this.clock.text = timerClock(left); this.under.textContent = timer.endsAt === undefined ? t("멈춤") : stage === "break" ? t("쉬는 중") : t("남았어요"); }
    this.ring.setAttribute("aria-label", stage === "timeUp" ? this.kicker.textContent ?? "" : `${this.clock.text} ${this.under.textContent}`);
    // ⏸ while it runs, ▶ while it's stopped; none when the time is up or a break is over.
    const runs = stage === "running" || stage === "break";
    this.play.hidden = !runs;
    if (runs) {
      const paused = timer.endsAt === undefined;
      const label = paused ? t("계속 (Space)") : t("일시정지 (Space)");
      if (this.play.dataset.paused !== String(paused)) {
        this.play.dataset.paused = String(paused);
        this.play.replaceChildren(icon(paused ? "play" : "pause", 13, 2));
      }
      this.play.title = label;
      this.play.setAttribute("aria-label", label);
    }
    // The cat nods every five minutes of the session.
    const minutes = Math.floor((now - view.startedAt) / 60_000);
    if (minutes > 0 && minutes % 5 === 0 && (now - view.startedAt) % 60_000 < 1000 && !reduceMotion()) {
      this.cat.classList.remove("nod");
      void this.cat.offsetWidth;
      this.cat.classList.add("nod");
    }
    if (timer.endsAt !== undefined && left > 0) this.ticker = window.setTimeout(() => this.tick(), (left % 1000 || 1000) + 5);
  }

  /** 그 밖의 오늘 할 일 N개 · 펼치기, and the list itself (checkable). */
  private renderList(): void {
    const focusId = this.view?.taskId;
    const others = this.host.todayItems().filter((item) => item.id !== focusId && (!item.isCompleted || this.checkedHere.has(item.id)));
    const open = others.filter((item) => !item.isCompleted).length;
    this.restToggle.hidden = others.length === 0;
    this.restToggle.textContent = this.expanded ? t("그 밖의 오늘 할 일 {n}개 · 접기", { n: open }) : t("그 밖의 오늘 할 일 {n}개 · 펼치기", { n: open });
    this.restToggle.setAttribute("aria-expanded", String(this.expanded));
    this.list.hidden = !this.expanded || others.length === 0;
    this.element.classList.toggle("expanded", this.expanded && others.length > 0);
    if (this.list.hidden) return;
    this.list.replaceChildren(...others.map((item) => {
      const box = h("span", { class: "box" }, icon("check", 12, 2.6));
      const check = h("button", { class: "check", "aria-label": item.isCompleted ? t("{title} 완료 취소", { title: item.title }) : t("{title} 완료", { title: item.title }) }, box);
      check.addEventListener("click", () => {
        if (!item.isCompleted) this.checkedHere.add(item.id);
        void api.act({ type: "toggle", id: item.id });
      });
      return h("div", { class: `fc-row${item.isCompleted ? " done" : ""}`, role: "listitem" }, check, h("span", { class: "fc-row-title", title: item.title }, item.title));
    }));
  }
}
