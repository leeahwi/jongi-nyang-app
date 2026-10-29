import { BrowserWindow, Menu, ipcMain, powerMonitor, screen, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import {
  adjustTimer, isFinished, isPaused, isRestPhase, nextPhase, parseTimer, pauseTimer, remainingMs, resumeTimer, startCountdown, startPomodoro, timerCaption,
  type FocusTimer, type TimerCommand,
} from "../core/focusTimer";
import type { Point } from "../core/placement";
import { clampTimer, defaultTimerOrigin, resizedTimerOrigin, timerScale, timerSizes, timerSizeTitles, timerWindowSizeFor, type TimerPayload } from "../core/timerWidget";
import { pomodoroSettings, type FocusCommand, type FocusStage, type FocusView, type TimerView } from "../core/types";
import { maxTimerMinutes, rememberTimer, timerPresets } from "../core/duration";
import { focusRecord, type FocusRecord } from "../core/focus";
import { newID } from "../core/notebook";
import { lang, t } from "../i18n";
import { offscreen } from "./env";
import type { Store, TimerMemory } from "./store";

export interface TimerHooks {
  /** A timer started, changed or ended: menus that show it need rebuilding. */
  changed(): void;
  /** A phase or countdown ended: the pet (when it is out) cheers along. */
  cheer(): void;
  /** 직접 정하기…: the small sheet to type a length in (`start` given: what its length starts instead of a timer). */
  custom(start?: (minutes: number) => void): void;
  /** A session or a timer ended with at least a minute: its line for focus.jsonl. */
  record(record: FocusRecord): void;
  /** 다 했어요: the task is checked. */
  complete(taskId: string): void;
  /** The note comes up (it turns into the focus card). */
  showNote(): void;
  /** Whether the note is on screen: while it is, the focus card stands in for the board. */
  noteVisible(): boolean;
  /** 할 일 골라 집중…: the note's pick state. */
  pick(): void;
  /** A focus session ended: reminders held back meanwhile may come now. */
  focusEnded(): void;
  /** The task's title now (renamed meanwhile), undefined when it is gone. */
  taskTitle(taskId: string): string | undefined;
  /** Time's up with the board away (the note shows the card): the chime from the note. */
  chime(): void;
  /** 집중 그만두기 from a menu: the confirm slip, then like 다음에. */
  askStop(): void;
}

/** 집중: a session on a task, around the timer. */
interface FocusSession { taskId?: string; title: string; stage: FocusStage; startedAt: number }
/** The focus phase (a countdown, a Pomodoro round) now running: its line's id and when it began. */
interface Round { id: string; start: number }

const stages: FocusStage[] = ["running", "timeUp", "break", "breakOver"];
function parseSession(value: unknown): FocusSession | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  if (typeof raw.title !== "string" || !stages.includes(raw.stage as FocusStage) || typeof raw.startedAt !== "number") return undefined;
  return { ...(typeof raw.taskId === "string" ? { taskId: raw.taskId } : {}), title: raw.title, stage: raw.stage as FocusStage, startedAt: raw.startedAt };
}
function parseRound(value: unknown): Round | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  return typeof raw.id === "string" && typeof raw.start === "number" ? { id: raw.id, start: raw.start } : undefined;
}

const validPoint = (value: unknown): value is Point =>
  typeof value === "object" && value !== null && Number.isFinite((value as Point).x) && Number.isFinite((value as Point).y);

/**
 * The focus timer and its board (ported from the timer the macOS pet used to hold). The board is
 * a small transparent window of its own that floats above other windows, never takes focus and
 * lets clicks through everywhere but the board. It exists only while a timer runs (and for a
 * moment after a countdown ends, to say so). The pet has nothing to do with it.
 */
export class FocusTimerWidget {
  /** A countdown or pomodoro is on (running or paused): 종이냥 한마디 keeps quiet. */
  get isRunning(): boolean { return this.timer !== undefined; }
  /** 집중 on a task is on (in any stage). */
  get focusing(): boolean { return this.session !== undefined; }
  /** The task being focused on. */
  get focusTaskId(): string | undefined { return this.session?.taskId; }
  private window?: BrowserWindow;
  private timer?: FocusTimer;
  private session?: FocusSession;
  private round?: Round;
  private message?: string;
  /** A countdown just ended: the window stays a moment showing only its message. */
  private finished = false;
  private interactive = false;
  private messageTimer?: NodeJS.Timeout;
  private finishTimer?: NodeJS.Timeout;
  private drag?: { cursor: Point; origin: Point };

  constructor(private readonly store: Store, private readonly rendererDirectory: string, private readonly hooks: TimerHooks) {
    const { pet, timer } = store.memory;
    this.timer = parseTimer(timer?.current ?? pet?.timer);
    this.session = this.timer ? parseSession(timer?.focus) : undefined;
    this.round = this.timer ? parseRound(timer?.round) : undefined;
    // Earlier versions kept the timer with the pet: move it over so a running one survives the update.
    if (pet && ("timer" in pet || "freeOrigin" in pet)) {
      const { timer: _timer, freeOrigin: _freeOrigin, ...rest } = pet;
      store.remember({ pet: rest });
      this.remember({ current: this.timer });
    }
    this.registerIPC();
    const replace = () => { if (!this.drag) this.place(); };
    screen.on("display-added", replace);
    screen.on("display-removed", replace);
    screen.on("display-metrics-changed", replace);
    powerMonitor.on("resume", () => this.tick());
    this.armFinish();
    this.update();
    store.on("prefs", (key: string) => { if (key === "timerSize") this.resize(); });
  }

  /** The timer as the windows draw it (the 오늘 창's card), or undefined when none is on. */
  view(): TimerView | undefined {
    const timer = this.timer;
    if (!timer) return undefined;
    return {
      ...(timer.endsAt !== undefined ? { endsAt: timer.endsAt } : { pausedRemainingMs: timer.pausedRemainingMs ?? 0 }),
      caption: timerCaption(timer, lang()), countdown: timer.phase === "timer", durationMs: timer.durationMs,
    };
  }

  /** The title of the task focused on, as it reads now. */
  private get focusTitle(): string {
    const session = this.session;
    if (!session) return "";
    return (session.taskId ? this.hooks.taskTitle(session.taskId) : undefined) ?? session.title;
  }

  /** 집중 as the note draws it, or undefined when no session is on. */
  focusView(): FocusView | undefined {
    const session = this.session, timer = this.timer;
    if (!session || !timer) return undefined;
    const settings = timer.pomodoro;
    let pomodoro: FocusView["pomodoro"];
    if (settings) {
      const total = Math.max(1, settings.roundsBeforeLongRest);
      const resting = isRestPhase(timer);
      // In a break the round just finished is counted; when time is up, the round that ran is done too.
      const done = resting ? ((Math.max(1, timer.completedRounds) - 1) % total) + 1 : (timer.completedRounds % total) + (session.stage === "timeUp" ? 1 : 0);
      const long = (timer.completedRounds + 1) % total === 0;
      pomodoro = { done, total, breakMinutes: long ? settings.longRestMinutes : settings.restMinutes };
    }
    return {
      ...(session.taskId ? { taskId: session.taskId } : {}), title: this.focusTitle, stage: session.stage,
      minutes: Math.round((isRestPhase(timer) && settings ? settings.focusMinutes * 60_000 : timer.durationMs) / 60_000),
      ...(pomodoro ? { pomodoro } : {}), startedAt: session.startedAt,
    };
  }

  // ─── 집중 ─────────────────────────────────────────────────────────────────

  /** The focus card's buttons, the row menu's 이거 집중, the line's "보고서 25분 집중". */
  focus(command: FocusCommand): void {
    const now = Date.now();
    const session = this.session, timer = this.timer;
    switch (command.kind) {
      case "start": {
        if (!command.title && !command.taskId) return;
        // Whatever ran before ends (and is written, when it ran a minute).
        if (timer) this.writeRound(now, false);
        const settings = pomodoroSettings(this.store.prefs);
        const minutes = Math.min(maxTimerMinutes, Math.max(1, Math.round(command.minutes ?? settings.focusMinutes)));
        if (!command.pomodoro && !timerPresets.includes(minutes) && minutes !== settings.focusMinutes) {
          this.store.setPref("timerRecent", rememberTimer(this.store.prefs.timerRecent ?? [], minutes));
        }
        this.session = { ...(command.taskId ? { taskId: command.taskId } : {}), title: (command.title ?? "").trim(), stage: "running", startedAt: now };
        if (command.taskId && !this.session.title) this.session.title = this.hooks.taskTitle(command.taskId) ?? "";
        this.round = { id: newID(), start: now };
        clearTimeout(this.messageTimer);
        this.message = undefined;
        this.setTimer(command.pomodoro ? startPomodoro(settings, now) : startCountdown(minutes, now));
        this.hooks.showNote();
        return;
      }
      case "done": {
        if (!session) return;
        if (session.stage === "running" || session.stage === "timeUp") this.writeRound(now, true);
        if (session.taskId) this.hooks.complete(session.taskId);
        return this.endFocus();
      }
      case "more": {
        if (!session || !timer || isRestPhase(timer)) return;
        if (session.stage === "running") return this.setTimer(adjustTimer(timer, 5, now));
        if (session.stage === "timeUp") {
          session.stage = "running";
          this.setTimer(resumeTimer(adjustTimer(timer, 5, now), now));
        }
        return;
      }
      case "later": {
        if (!session) return;
        if (session.stage === "running" || session.stage === "timeUp") this.writeRound(now, false);
        return this.endFocus();
      }
      case "rest": {
        if (!session || !timer || session.stage !== "timeUp" || !timer.pomodoro || timer.phase !== "focus") return;
        this.writeRound(now, false);
        session.stage = "break";
        this.setTimer(nextPhase(timer, now));
        return;
      }
      case "nextRound": {
        if (!session || !timer || (session.stage !== "break" && session.stage !== "breakOver")) return;
        const next = isRestPhase(timer) ? nextPhase(timer, now) : timer;
        session.stage = "running";
        this.round = { id: newID(), start: now };
        this.setTimer(next);
        return;
      }
      case "askStop":
      case "custom":
        return; // asked by main (the confirm slip, the timer sheet)
    }
  }

  /** Ends the session without a line (the line's 멈추기 / Ctrl+Z right after starting it). */
  discardFocus(): void {
    if (!this.session) return;
    this.round = undefined;
    this.endFocus();
  }

  private endFocus(): void {
    this.session = undefined;
    this.round = undefined;
    clearTimeout(this.messageTimer);
    this.message = undefined;
    this.finished = false;
    this.setTimer(undefined);
    this.hooks.focusEnded();
  }

  /**
   * The focus phase now running (or just run) is over: its line — a session on the task, or a plain
   * timer — with the minutes it ran (pauses left out). Breaks and anything under a minute leave none.
   */
  private writeRound(now: number, done: boolean): void {
    const timer = this.timer, round = this.round;
    this.round = undefined;
    if (!timer || !round || isRestPhase(timer)) return;
    const session = this.session;
    const record = focusRecord({
      id: round.id, ...(session?.taskId ? { taskId: session.taskId } : {}), title: session ? this.focusTitle : "",
      start: new Date(round.start), end: new Date(now), activeMs: timer.durationMs - remainingMs(timer, now), kind: session ? "focus" : "timer", done,
    });
    if (record) this.hooks.record(record);
  }

  /** The note came up or went away: the board steps in for the card (or out). */
  noteShown(): void {
    if (this.session) this.update();
  }

  // ─── Commands ───────────────────────────────────────────────────────────────

  command(command: TimerCommand): void {
    const now = Date.now();
    // A focus session: 중지 is 다음에; a new timer ends it first (written like 다음에).
    if (this.session) {
      if (command.kind === "stop") return this.focus({ kind: "later" });
      if (command.kind === "countdown" || command.kind === "pomodoro") { this.writeRound(now, false); this.session = undefined; this.hooks.focusEnded(); }
    }
    switch (command.kind) {
      case "countdown":
        // A length of its own (not 5 · 15 · 25 · 50) goes to the top of the menus' recent ones.
        if (!timerPresets.includes(command.minutes)) this.store.setPref("timerRecent", rememberTimer(this.store.prefs.timerRecent ?? [], command.minutes));
        if (this.timer) this.writeRound(now, false);
        this.round = { id: newID(), start: now };
        this.setTimer(startCountdown(command.minutes, now));
        this.say(t("{minutes}분 재 볼게요!", { minutes: command.minutes }), 3);
        break;
      case "pomodoro": {
        const settings = pomodoroSettings(this.store.prefs);
        if (this.timer) this.writeRound(now, false);
        this.round = { id: newID(), start: now };
        this.setTimer(startPomodoro(settings, now));
        this.say(t("{minutes}분 집중해요. 응원할게요!", { minutes: settings.focusMinutes }), 3);
        break;
      }
      case "togglePause":
        if (!this.timer) return;
        this.setTimer(isPaused(this.timer) ? resumeTimer(this.timer, now) : pauseTimer(this.timer, now));
        break;
      case "addMinutes":
        if (this.timer) this.setTimer(adjustTimer(this.timer, command.minutes, now));
        break;
      case "stop":
        this.writeRound(now, false);
        clearTimeout(this.messageTimer);
        this.message = undefined;
        this.finished = false;
        this.setTimer(undefined);
        break;
    }
  }

  /** Shared by the board, the pet, the tray and the note's ⋯ menu: presets, the recent custom lengths, 직접 정하기…, 뽀모도로. */
  timerMenu(): MenuItemConstructorOptions[] {
    const items: MenuItemConstructorOptions[] = [];
    // 집중 on: the card, and a way out (asked first, like Esc on the card).
    if (this.session) {
      items.push(
        { label: t("집중 화면 보기"), click: () => this.hooks.showNote() },
        { label: t("집중 그만두기"), click: () => this.hooks.askStop() },
        { type: "separator" },
      );
    }
    if (this.timer) {
      items.push(
        { label: isPaused(this.timer) ? t("계속") : t("일시정지"), click: () => this.command({ kind: "togglePause" }) },
        { label: t("5분 더"), click: () => this.command({ kind: "addMinutes", minutes: 5 }) },
        { label: t("중지"), click: () => this.command({ kind: "stop" }) },
        { type: "separator" },
      );
    }
    for (const minutes of timerPresets) items.push({ label: t("{minutes}분 타이머", { minutes }), click: () => this.command({ kind: "countdown", minutes }) });
    // The custom lengths started last (newest first), then 직접 정하기….
    for (const minutes of rememberTimer(this.store.prefs.timerRecent ?? [], 0)) items.push({ label: t("{minutes}분 타이머", { minutes }), click: () => this.command({ kind: "countdown", minutes }) });
    items.push({ label: t("직접 정하기…"), click: () => this.hooks.custom() });
    const settings = pomodoroSettings(this.store.prefs);
    items.push({ label: t("뽀모도로 시작 ({focus}분 집중 · {rest}분 휴식)", { focus: settings.focusMinutes, rest: settings.restMinutes }), click: () => this.command({ kind: "pomodoro" }) });
    // 집중: a task picked on the note, then the focus card.
    items.push({ label: t("할 일 골라 집중…"), click: () => this.hooks.pick() });
    items.push({ type: "separator" }, {
      label: t("크기"),
      submenu: timerSizes.map((size) => ({ label: timerSizeTitles[lang()][size], type: "radio" as const, checked: this.store.prefs.timerSize === size, click: () => this.store.setPref("timerSize", size) })),
    });
    return items;
  }

  private setTimer(timer: FocusTimer | undefined): void {
    this.timer = timer;
    if (timer) this.finished = false;
    this.persist();
    this.armFinish();
    this.update();
  }

  /** The timer, the session and the round, kept across a restart. */
  private persist(): void {
    this.remember({ current: this.timer, focus: this.timer ? this.session : undefined, round: this.timer ? this.round : undefined });
  }

  private remember(memory: Partial<TimerMemory>): void {
    this.store.remember({ timer: { ...this.store.memory.timer, ...memory } });
  }

  /** One wake-up at the end of the running phase; the board redraws itself once a second. */
  private armFinish(): void {
    clearTimeout(this.finishTimer);
    this.finishTimer = undefined;
    if (!this.timer || isPaused(this.timer)) return;
    this.finishTimer = setTimeout(() => this.tick(), remainingMs(this.timer, Date.now()) + 50);
  }

  private tick(): void {
    const timer = this.timer;
    const now = Date.now();
    if (!timer) return;
    if (!isFinished(timer, now)) return this.armFinish();
    if (this.store.prefs.timerSound) this.chime();
    // 집중: time's up (or the break is over) and the card waits for the person — never runs on by itself.
    const session = this.session;
    if (session) {
      session.stage = isRestPhase(timer) ? "breakOver" : "timeUp";
      this.setTimer(pauseTimer(timer, now));
      if (session.stage === "timeUp") this.say(t("{minutes}분 다 됐어요", { minutes: Math.round(timer.durationMs / 60_000) }), 10);
      else this.say(t("쉬는 시간 끝! 다음 라운드를 시작할까요?"), 10);
      this.hooks.cheer();
      return;
    }
    // A plain timer's focus phase ran out: its line (breaks leave none).
    this.writeRound(now, false);
    const next = nextPhase(timer, now);
    if (next?.phase === "focus") this.round = { id: newID(), start: now };
    if (next) {
      const auto = this.store.prefs.pomodoroAutoContinue;
      this.setTimer(auto ? next : pauseTimer(next, now));
      const settings = next.pomodoro!;
      const start = auto ? "" : `\n${t("팻말을 누르면 시작해요")}`;
      if (next.phase === "rest") this.say(t("집중 끝! {minutes}분 쉬어요", { minutes: settings.restMinutes }) + start, 6);
      else if (next.phase === "longRest") this.say(t("{rounds}번 해냈어요! {minutes}분 푹 쉬어요", { rounds: settings.roundsBeforeLongRest, minutes: settings.longRestMinutes }), 6);
      else this.say(t("다시 집중해 볼까요?") + start, 6);
    } else {
      // The board goes; its message stays where it was for a moment, then the window closes.
      this.finished = true;
      this.setTimer(undefined);
      this.say(t("{minutes}분 끝났어요!", { minutes: Math.floor(timer.durationMs / 60_000) }), 10);
    }
    this.hooks.cheer();
  }

  // ─── Speech ─────────────────────────────────────────────────────────────────

  private say(text: string, seconds: number): void {
    clearTimeout(this.messageTimer);
    this.message = text;
    this.send();
    this.messageTimer = setTimeout(() => this.dismiss(), seconds * 1000);
  }

  private dismiss(): void {
    clearTimeout(this.messageTimer);
    this.messageTimer = undefined;
    this.message = undefined;
    if (this.finished) {
      this.finished = false;
      this.update();
    } else this.send();
  }

  private chime(): void {
    const window = this.window;
    // The note shows the focus card (no board): the note chimes.
    if (!window || window.isDestroyed()) { if (this.session) this.hooks.chime(); return; }
    // Launched after a timer ran out: the page may still be loading.
    if (window.webContents.isLoading()) window.webContents.once("did-finish-load", () => window.webContents.send("timer:chime"));
    else window.webContents.send("timer:chime");
  }

  // ─── Window ─────────────────────────────────────────────────────────────────

  /**
   * Shown while a timer runs (or a finished one's message lingers); closed otherwise, so an idle app
   * keeps no page around. During 집중 the note's focus card stands in for it — unless the note is away.
   */
  private update(): void {
    if ((!this.timer && !this.finished) || (this.session && this.hooks.noteVisible())) {
      this.close();
      this.hooks.changed();
      return;
    }
    const window = this.ensureWindow();
    if (!window.isVisible()) {
      this.place();
      window.showInactive();
      window.setAlwaysOnTop(true, "floating");
    }
    this.send();
    this.hooks.changed();
  }

  private close(): void {
    clearTimeout(this.messageTimer);
    this.messageTimer = undefined;
    this.message = undefined;
    this.drag = undefined;
    const window = this.window;
    this.window = undefined;
    if (window && !window.isDestroyed()) window.destroy();
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow({
      ...this.size, show: false, frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false,
      fullscreenable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      backgroundColor: "#00000000", title: t("집중 타이머"),
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    // Every desktop, but not over full-screen apps (videos, presentations).
    window.setVisibleOnAllWorkspaces(true);
    window.setIgnoreMouseEvents(true, { forward: true });
    window.loadFile(path.join(this.rendererDirectory, "timer.html"));
    window.on("closed", () => { if (this.window === window) this.window = undefined; });
    this.window = window;
    this.interactive = false;
    return window;
  }

  /** Where the person last put the board, or the default corner, kept on a display. */
  private place(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const saved = this.store.memory.timer?.origin;
    const origin = validPoint(saved)
      ? clampTimer(saved, screen.getAllDisplays().map((display) => display.workArea))
      : defaultTimerOrigin(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea, this.size);
    this.setBounds(origin);
  }

  /** The window at the chosen TimerSize. */
  private get size(): { width: number; height: number } {
    return timerWindowSizeFor(this.store.prefs.timerSize ?? "regular");
  }

  private setBounds(origin: Point): void {
    this.window?.setBounds({ x: Math.round(origin.x + offscreen.x), y: Math.round(origin.y + offscreen.y), ...this.size });
  }

  /** A new size: around the middle of the bottom edge, so it stays where it was put. */
  private resize(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const bounds = this.window.getBounds();
    const origin = clampTimer(resizedTimerOrigin({ x: bounds.x - offscreen.x, y: bounds.y - offscreen.y }, bounds, this.size),
      screen.getAllDisplays().map((display) => display.workArea), this.size);
    this.setBounds(origin);
    if (this.store.memory.timer?.origin) this.remember({ origin });
    this.send();
  }

  private setInteractive(interactive: boolean): void {
    if (this.interactive === interactive || !this.window || this.window.isDestroyed()) return;
    this.interactive = interactive;
    this.window.setIgnoreMouseEvents(!interactive, { forward: true });
  }

  private send(): void {
    if (!this.window || this.window.isDestroyed()) return;
    const payload: TimerPayload = {
      timer: this.timer, message: this.message, scale: timerScale[this.store.prefs.timerSize ?? "regular"] ?? 1,
      ...(this.session ? { focus: this.focusTitle } : {}),
    };
    this.window.webContents.send("timer:state", payload);
  }

  // ─── Mouse ──────────────────────────────────────────────────────────────────

  private registerIPC(): void {
    const fromBoard = (event: Electron.IpcMainEvent) => this.window !== undefined && !this.window.isDestroyed() && event.sender === this.window.webContents;
    ipcMain.on("timer:ready", (event) => { if (fromBoard(event)) this.send(); });
    // Click-through everywhere except over the board and its bubble.
    ipcMain.on("timer:interactive", (event, interactive: boolean) => { if (fromBoard(event)) this.setInteractive(Boolean(interactive)); });
    // During 집중 a click on the board brings the note (and its card) back.
    ipcMain.on("timer:toggle", (event) => { if (fromBoard(event)) { if (this.session) this.hooks.showNote(); else this.command({ kind: "togglePause" }); } });
    ipcMain.on("timer:pause", (event) => { if (fromBoard(event)) this.command({ kind: "togglePause" }); });
    ipcMain.on("timer:stop", (event) => { if (fromBoard(event)) this.command({ kind: "stop" }); });
    ipcMain.on("timer:dismiss", (event) => { if (fromBoard(event)) this.dismiss(); });
    ipcMain.on("timer:menu", (event) => {
      if (fromBoard(event)) Menu.buildFromTemplate(this.timerMenu()).popup({ window: this.window });
    });
    ipcMain.on("timer:drag-start", (event) => {
      if (!fromBoard(event) || !this.window) return;
      const bounds = this.window.getBounds();
      this.drag = { cursor: screen.getCursorScreenPoint(), origin: { x: bounds.x, y: bounds.y } };
    });
    ipcMain.on("timer:drag", (event) => {
      if (!fromBoard(event) || !this.window || !this.drag) return;
      const cursor = screen.getCursorScreenPoint();
      this.window.setPosition(Math.round(this.drag.origin.x + cursor.x - this.drag.cursor.x),
        Math.round(this.drag.origin.y + cursor.y - this.drag.cursor.y));
    });
    ipcMain.on("timer:drag-end", (event) => {
      if (!fromBoard(event) || !this.window || !this.drag) return;
      this.drag = undefined;
      const bounds = this.window.getBounds();
      const origin = clampTimer({ x: bounds.x - offscreen.x, y: bounds.y - offscreen.y }, screen.getAllDisplays().map((display) => display.workArea), this.size);
      // Always the same size, so a DPI change mid-drag can't make a drifted size stick.
      this.setBounds(origin);
      this.remember({ origin });
    });
  }

  // ─── Snapshots ──────────────────────────────────────────────────────────────

  /** Snapshots: the board's window (to measure it). */
  get snapshotWindow(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  capture(): Promise<Electron.NativeImage> | undefined {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) return undefined;
    return this.window.webContents.capturePage();
  }

  /** Snapshots only: as if `minutes` of the running phase (and the session) had already gone by. */
  elapseForSnapshot(minutes: number): void {
    const timer = this.timer;
    if (!timer || timer.endsAt === undefined) return;
    const ms = minutes * 60_000;
    this.timer = { ...timer, endsAt: timer.endsAt - ms };
    if (this.round) this.round = { ...this.round, start: this.round.start - ms };
    if (this.session) this.session = { ...this.session, startedAt: this.session.startedAt - ms };
    this.persist();
    this.armFinish();
    this.hooks.changed();
  }

  /** Snapshots only: ends the running phase now, as if its time had run out. */
  finishNow(): void {
    if (!this.timer) return;
    const { pausedRemainingMs: _paused, ...rest } = this.timer;
    this.timer = { ...rest, endsAt: Date.now() };
    this.tick();
  }
}
