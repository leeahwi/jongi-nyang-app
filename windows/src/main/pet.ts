import { BrowserWindow, Menu, ipcMain, powerMonitor, screen, type MenuItemConstructorOptions } from "electron";
import path from "node:path";
import {
  clampFloorX, clipMs, idleChoices, petFrame, petSize, pickWeighted, sleepAfterSeconds, stripHeight, wakeWithinSeconds,
  type PetAction, type PetPayload, type Rect,
} from "../core/pet";
import { dayKey, groupByDay, logicalDayStart, streakMilestone, type ArchiveEntry } from "../core/archive";
import type { ChatterEvents } from "../core/calendar";
import { isQuietHour, nextChatterDelay, pettedChatter, pickChatter, type ChatterContext, type ChatterLine, type ChatterPose } from "../core/chatter";
import { key as dueKey } from "../core/deadline";
import { lang, t } from "../i18n";
import { offscreen } from "./env";
import type { PetMemory, Store } from "./store";

export interface PetHooks {
  openNote(): void;
  /** Visibility changed: menus that show it need rebuilding. */
  changed(): void;
  /** The focus timer's menu (the timer lives in its own window; the pet only offers its controls). */
  timerMenu(): MenuItemConstructorOptions[];
  /** 종이냥 한마디 waits while the focus timer runs or a reminder is up. */
  isBusy(): boolean;
  /** ‘쉴래요’ on the rest question: a five-minute timer. */
  rest(): void;
  /** ‘해 볼게요’ on 다음 일정까지 25분 집중: a 25-minute timer. */
  focus(): void;
  /** Today's events, when any are kept (events.json). */
  calendar(): ChatterEvents | undefined;
  /** 빠른 메모 from the cat's menu. */
  quickMemo(): void;
  /** 메모 서랍 from the cat's menu. */
  drawer(): void;
  /** 알람…: Settings → 시계. */
  alarms(): void;
  /** Everything finished (the record and the list), for the streak's cheer (#42). */
  finished(): readonly ArchiveEntry[];
}

const defaultHomeFraction = 0.78;

/**
 * 종이냥 living just above the taskbar (ported from macOS `DesktopPetController`). It sits,
 * blinks, looks around, wanders a little, dozes off when the PC is left alone and cheers when a
 * task is finished or a focus timer ends.
 *
 * The window is a transparent strip along the bottom of the work area that ignores the mouse
 * everywhere except over the cat. The focus timer is a separate window (`FocusTimerWidget`):
 * the pet never moves or changes its pose because of it.
 */
export class DesktopPet {
  private window?: BrowserWindow;
  private shown = false;
  private action: PetAction = { kind: "sit" };
  /** When the current clip started (Date.now()), to know where a walking cat is. */
  private actionStart = Date.now();
  private activityID = 0;
  /** Where the cat rests along the floor (centre x, in the window's coordinates). */
  private homeX = 200;
  /** The spot the person chose by dragging; wandering stays near it. */
  private anchorX = 200;
  private asleep = false;
  private reduceMotion = false;
  private interactive = false;
  private lastCompleted: number;
  private clipTimer?: NodeJS.Timeout;
  private idleTimer?: NodeJS.Timeout;
  private dragging = false;
  private message?: string;
  private messageTimer?: NodeJS.Timeout;
  private question?: ChatterLine;
  private questionTimer?: NodeJS.Timeout;
  /** A question of the app's own (not 한마디): what each answer does. */
  private customAnswers?: (() => void)[];
  private nextChatter = Date.now() + (5 + Math.random() * 5) * 60_000;

  constructor(private readonly store: Store, private readonly rendererDirectory: string, private readonly hooks: PetHooks) {
    this.lastCompleted = store.history.completedCount;
    this.registerIPC();
    store.on("prefs", (key: string) => { if (key === "petVisible") this.update(); });
    // A task checked off anywhere gets a little cheer.
    store.on("change", () => this.checkForCompletion());
    screen.on("display-added", () => this.layout());
    screen.on("display-removed", () => this.layout());
    screen.on("display-metrics-changed", () => this.layout());
    setInterval(() => this.checkChatter(), 30_000);
    this.update();
  }

  private get catShown(): boolean { return this.shown && this.window?.isVisible() === true; }
  /** The pet is out on the floor (the weekly look-back only talks then). */
  get isShown(): boolean { return this.catShown; }

  // ─── Showing ────────────────────────────────────────────────────────────────

  private update(): void {
    const show = this.store.prefs.petVisible;
    if (show === this.shown) return;
    this.shown = show;
    this.dragging = false;
    this.stopBehaviour();
    if (!show) {
      this.dropQuestion(false);
      this.message = undefined;
      clearTimeout(this.messageTimer);
      // Put away, not just hidden: a hidden page would keep breathing (its animations run unthrottled).
      const window = this.window;
      this.window = undefined;
      if (window && !window.isDestroyed()) window.destroy();
      this.hooks.changed();
      return;
    }
    const window = this.ensureWindow();
    this.layout();
    window.showInactive();
    window.setAlwaysOnTop(true, "floating");
    this.settle();
    this.send();
    this.scheduleIdle();
    this.hooks.changed();
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    const window = new BrowserWindow({
      width: 400, height: stripHeight, show: false, frame: false, transparent: true, resizable: false, minimizable: false, maximizable: false,
      fullscreenable: false, focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false,
      backgroundColor: "#00000000", title: t("종이냥"),
      webPreferences: { preload: path.join(__dirname, "preload.js"), sandbox: true, contextIsolation: true, backgroundThrottling: false },
    });
    // Every desktop, but not over full-screen apps (videos, presentations).
    window.setVisibleOnAllWorkspaces(true);
    window.setIgnoreMouseEvents(true, { forward: true });
    window.loadFile(path.join(this.rendererDirectory, "pet.html"));
    window.on("closed", () => { if (this.window === window) this.window = undefined; });
    this.window = window;
    this.interactive = false;
    return window;
  }

  private rememberPet(memory: Partial<PetMemory>): void {
    this.store.remember({ pet: { ...this.store.memory.pet, ...memory } });
  }

  private display(): Electron.Display {
    const id = this.store.memory.pet?.displayID;
    return screen.getAllDisplays().find((display) => display.id === id) ?? screen.getPrimaryDisplay();
  }

  private get homeFraction(): number {
    const saved = this.store.memory.pet?.homeFraction;
    return typeof saved === "number" && saved >= 0 && saved <= 1 ? saved : defaultHomeFraction;
  }

  /** Window bounds without the off-screen shift used by tests and snapshots. */
  private bounds(): Rect | undefined {
    if (!this.window || this.window.isDestroyed()) return undefined;
    const bounds = this.window.getBounds();
    return { ...bounds, x: bounds.x - offscreen.x, y: bounds.y - offscreen.y };
  }

  /** A strip along the bottom of the pet's display. */
  private layout(): void {
    if (!this.window || this.window.isDestroyed() || !this.shown) return;
    const area = this.display().workArea;
    this.window.setBounds({ x: area.x + offscreen.x, y: area.y + area.height - stripHeight + offscreen.y, width: area.width, height: stripHeight });
    this.anchorX = clampFloorX(area.width * this.homeFraction, area.width);
    this.homeX = this.anchorX;
    if (!this.dragging) this.setInteractive(false);
    this.send();
  }

  private setInteractive(interactive: boolean): void {
    if (this.interactive === interactive || !this.window || this.window.isDestroyed()) return;
    this.interactive = interactive;
    this.window.setIgnoreMouseEvents(!interactive, { forward: true });
  }

  private send(): void {
    if (!this.window || this.window.isDestroyed() || !this.shown) return;
    const question = this.question ? { text: this.question.text, answers: this.question.answers.map((answer) => answer.label) } : undefined;
    const payload: PetPayload = { homeX: this.homeX, activity: { id: this.activityID, action: this.action }, message: this.message, question };
    this.window.webContents.send("pet:state", payload);
  }

  // ─── Behaviour ──────────────────────────────────────────────────────────────

  /** Plays a short clip, then returns to resting and plans the next thing to do. */
  private play(action: PetAction): void {
    if (!this.catShown) return;
    clearTimeout(this.clipTimer);
    this.action = action;
    this.actionStart = Date.now();
    this.activityID += 1;
    this.send();
    this.clipTimer = setTimeout(() => {
      this.clipTimer = undefined;
      if (action.kind === "walk") this.homeX = action.to;
      this.settle();
      this.send();
      this.scheduleIdle();
    }, clipMs(action));
  }

  private settle(): void {
    this.action = { kind: this.asleep ? "sleep" : "sit" };
    this.actionStart = Date.now();
    this.activityID += 1;
  }

  /** Where the cat is on screen, so a reminder can appear above it instead of walking in a second cat. */
  anchor(): Rect | undefined {
    const bounds = this.catShown ? this.bounds() : undefined;
    if (!bounds) return undefined;
    const x = petFrame(this.action, this.actionStart, this.homeX, Date.now()).x;
    return { x: bounds.x + x - petSize / 2, y: bounds.y + bounds.height - petSize, width: petSize, height: petSize };
  }

  /** A small hop to say "look up here" when a reminder appears above the cat. */
  greet(): void {
    this.asleep = false;
    this.play({ kind: "hop" });
  }

  /** A focus phase or countdown ended: a cheer from wherever the cat is (the timer's board says what happened). */
  cheer(): void {
    if (this.dragging) return;
    this.asleep = false;
    this.play({ kind: "cheer" });
  }

  /** A speech bubble above the cat for a while; clicking the cat puts it away sooner. */
  say(text: string, seconds: number): void {
    if (!this.catShown) return;
    clearTimeout(this.messageTimer);
    this.dropQuestion(false);
    this.message = text;
    this.asleep = false;
    this.send();
    this.messageTimer = setTimeout(() => this.hush(), seconds * 1000);
  }

  private hush(): void {
    clearTimeout(this.messageTimer);
    this.messageTimer = undefined;
    if (this.message === undefined) return;
    this.message = undefined;
    this.send();
  }

  private stopBehaviour(): void {
    clearTimeout(this.clipTimer);
    clearTimeout(this.idleTimer);
    this.clipTimer = this.idleTimer = undefined;
  }

  private scheduleIdle(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      this.idle();
    }, 5000 + Math.random() * 9000);
  }

  /** Picks what to do next. Resting between clips means no redraws most of the time. */
  private idle(): void {
    if (!this.catShown) return;
    const away = powerMonitor.getSystemIdleTime();
    if (this.asleep) {
      if (away < wakeWithinSeconds) {
        this.asleep = false;
        this.play({ kind: "stretch" });
      } else this.scheduleIdle();
      return;
    }
    if (away > sleepAfterSeconds) {
      this.asleep = true;
      this.play({ kind: "yawn" });
      return;
    }
    const width = this.bounds()?.width ?? 800;
    const walkTarget = clampFloorX(this.anchorX + (Math.random() * 2 - 1) * 170, width);
    const choice = pickWeighted(idleChoices({
      reduceMotion: this.reduceMotion, wanders: this.store.prefs.petWanders, homeX: this.homeX, walkTarget,
    }), Math.random());
    if (choice.kind === "sit") {
      this.settle();
      this.send();
      this.scheduleIdle();
    } else this.play(choice);
  }

  private petted(): void {
    this.hush();
    if (this.asleep) {
      this.asleep = false;
      this.play({ kind: "stretch" });
      return;
    }
    this.play({ kind: "happy" });
    // Now and then a word back.
    if (this.store.prefs.chatter && !this.question && Math.random() < 0.5) this.say(pettedChatter(Math.random, lang()).text, 3);
  }

  // ─── 종이냥 한마디 ──────────────────────────────────────────────────────────────

  /**
   * Every half minute: time for a line, if the cat is out, awake, the person is here, and
   * nothing else is going on. Otherwise it tries again a little later.
   */
  private checkChatter(): void {
    const prefs = this.store.prefs;
    if (!prefs.chatter || !this.catShown || Date.now() < this.nextChatter) return;
    if (this.asleep || this.dragging || this.hooks.isBusy() || this.message !== undefined || this.question
      || isQuietHour(new Date().getHours()) || powerMonitor.getSystemIdleTime() >= 120) {
      this.nextChatter = Date.now() + 120_000;
      return;
    }
    this.speakUp();
  }

  /** Says a line or asks a question now (also Settings → 지금 한마디 듣기; snapshots pass fixed numbers). */
  speakUp(random: () => number = Math.random): void {
    if (!this.catShown) return;
    this.asleep = false;
    const prefs = this.store.prefs;
    const line = pickChatter(this.chatterContext(), prefs.chatterQuestions, prefs.chatterRecent ?? [], random, lang());
    this.store.setPref("chatterRecent", [line.id, ...(prefs.chatterRecent ?? []).filter((id) => id !== line.id)].slice(0, 12));
    // A streak's cheer is said once, that day (#42).
    if (line.id.startsWith("m.")) this.store.setPref("chatterMilestoneDay", dayKey(logicalDayStart(new Date())));
    this.nextChatter = Date.now() + nextChatterDelay(prefs.chatterFrequency, Math.random);
    if (line.answers.length > 0) {
      this.hush();
      this.question = line;
      this.send();
      this.play({ kind: this.reduceMotion ? "tilt" : "hop" });
      clearTimeout(this.questionTimer);
      // Unanswered, it quietly goes away.
      this.questionTimer = setTimeout(() => this.dropQuestion(true), 25_000);
    } else {
      this.say(line.text, 8);
      this.play({ kind: "tilt" });
    }
  }

  /** What the cat knows when it speaks up: today's sheet and the deadlines. */
  private chatterContext(): ChatterContext {
    const now = new Date();
    const today = this.store.todayItems;
    const open = today.filter((item) => !item.isCompleted);
    const start = logicalDayStart(now);
    const todayKey = dueKey(start);
    const tomorrowKey = dueKey(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1));
    const waiting = this.store.items.filter((item) => !item.isCompleted && item.dueDate).map((item) => item.dueDate!);
    return {
      hour: now.getHours(), open: open.length, done: today.length - open.length,
      overdue: waiting.filter((day) => day < todayKey).length,
      dueSoon: waiting.filter((day) => day === todayKey || day === tomorrowKey).length,
      firstOpen: open[0]?.title, weekday: now.getDay(),
      ...this.eventContext(),
      ...this.milestoneContext(now),
    };
  }

  /** A streak that reached 7, 30 or 100 days today, not yet cheered. */
  private milestoneContext(now: Date): Partial<ChatterContext> {
    const milestone = streakMilestone(groupByDay(this.hooks.finished()), now, this.store.prefs.chatterMilestoneDay || undefined);
    return milestone === undefined ? {} : { milestone };
  }

  /** Today's events, when any are kept: the next one, the one going on, one that just ended. */
  private eventContext(): Partial<ChatterContext> {
    const events = this.hooks.calendar();
    if (!events) return {};
    const context: Partial<ChatterContext> = { nextIn: events.nextIn, eventsLeft: events.left };
    if (events.next !== undefined) context.nextEvent = events.next;
    if (events.now !== undefined) context.nowEvent = events.now;
    if (events.ended !== undefined) context.endedEvent = events.ended;
    return context;
  }

  /**
   * A question of the app's own (컴퓨터 켤 때 같이 열까요?): asked once, its answers each do something;
   * unanswered it goes away after `seconds`. False when the cat isn't out (or is busy with another).
   */
  ask(text: string, answers: { label: string; reply: string; run?: () => void }[], seconds = 45): boolean {
    if (!this.catShown || this.dragging || this.question) return false;
    this.hush();
    this.asleep = false;
    this.question = { id: "app", text, answers: answers.map((answer) => ({ label: answer.label, reply: answer.reply, pose: "happy" as const })) };
    this.customAnswers = answers.map((answer) => answer.run ?? (() => undefined));
    this.send();
    this.play({ kind: this.reduceMotion ? "tilt" : "hop" });
    clearTimeout(this.questionTimer);
    this.questionTimer = setTimeout(() => this.dropQuestion(true), seconds * 1000);
    return true;
  }

  private answer(index: number): void {
    const answer = this.question?.answers[index];
    if (!answer) return;
    const custom = this.customAnswers?.[index];
    if (custom) {
      this.customAnswers = undefined;
      this.say(answer.reply, 5);
      this.play({ kind: "happy" });
      custom();
      return;
    }
    this.say(answer.reply, 5);
    this.play(this.chatterAction(answer.pose));
    if (answer.action === "rest5") this.hooks.rest();
    if (answer.action === "focus25") this.hooks.focus();
  }

  private dropQuestion(redraw: boolean): void {
    clearTimeout(this.questionTimer);
    this.questionTimer = undefined;
    this.customAnswers = undefined;
    if (!this.question) return;
    this.question = undefined;
    if (redraw) this.send();
  }

  private chatterAction(pose: ChatterPose): PetAction {
    if (pose === "hop" && this.reduceMotion) return { kind: "happy" };
    return { kind: pose };
  }

  private checkForCompletion(): void {
    const completed = this.store.history.completedCount;
    const more = completed > this.lastCompleted;
    this.lastCompleted = completed;
    if (more && this.catShown && !this.asleep) this.play({ kind: "cheer" });
  }

  // ─── Menu ───────────────────────────────────────────────────────────────────

  private menu(): Menu {
    return Menu.buildFromTemplate(this.menuTemplate());
  }

  /** The cat's right-click menu (also listed by the snapshots). */
  menuTemplate(): MenuItemConstructorOptions[] {
    const prefs = this.store.prefs;
    return [
      { label: t("타이머"), submenu: this.hooks.timerMenu() },
      { label: t("빠른 메모"), click: () => this.hooks.quickMemo() },
      { label: t("메모 서랍"), click: () => this.hooks.drawer() },
      { label: t("알람…"), click: () => this.hooks.alarms() },
      { type: "separator" },
      { label: t("노트 열기"), click: () => this.hooks.openNote() },
      { label: t("돌아다니기"), type: "checkbox", checked: prefs.petWanders, click: () => this.store.setPref("petWanders", !prefs.petWanders) },
      { label: t("펫 숨기기"), click: () => this.store.setPref("petVisible", false) },
    ];
  }

  // ─── Mouse ──────────────────────────────────────────────────────────────────

  private registerIPC(): void {
    const fromPet = (event: Electron.IpcMainEvent) => this.window !== undefined && !this.window.isDestroyed() && event.sender === this.window.webContents;
    ipcMain.on("pet:ready", (event, reduceMotion: boolean) => {
      if (!fromPet(event)) return;
      this.reduceMotion = Boolean(reduceMotion);
      this.send();
    });
    // Click-through everywhere except over the cat.
    ipcMain.on("pet:interactive", (event, interactive: boolean) => { if (fromPet(event)) this.setInteractive(Boolean(interactive)); });
    ipcMain.on("pet:click", (event) => { if (fromPet(event)) this.petted(); });
    ipcMain.on("pet:answer", (event, index: number) => { if (fromPet(event)) this.answer(Number(index)); });
    ipcMain.on("pet:open-note", (event) => { if (fromPet(event)) this.hooks.openNote(); });
    ipcMain.on("pet:menu", (event) => { if (fromPet(event)) this.menu().popup({ window: this.window }); });
    // While dragging along the floor the renderer moves the cat itself; main hears where it landed.
    ipcMain.on("pet:drag-start", (event) => {
      if (!fromPet(event)) return;
      this.stopBehaviour();
      this.asleep = false;
      this.dragging = true;
      this.settle();
      this.send();
    });
    ipcMain.on("pet:drag-end", (event, homeX?: number) => {
      if (fromPet(event) && this.dragging) this.dragEnded(Number(homeX));
    });
  }

  private dragEnded(homeX: number): void {
    this.dragging = false;
    const width = this.bounds()?.width ?? 800;
    if (Number.isFinite(homeX)) this.homeX = clampFloorX(homeX, width);
    // Dropped over another display: move there.
    const cursor = screen.getCursorScreenPoint();
    const target = screen.getAllDisplays().find(({ bounds }) =>
      cursor.x >= bounds.x && cursor.x < bounds.x + bounds.width && cursor.y >= bounds.y && cursor.y < bounds.y + bounds.height);
    if (target && target.id !== this.display().id) {
      this.rememberPet({ displayID: target.id, homeFraction: Math.min(1, Math.max(0, (cursor.x - target.workArea.x) / target.workArea.width)) });
      this.layout();
    } else {
      this.anchorX = this.homeX;
      this.rememberPet({ displayID: this.display().id, homeFraction: width > 0 ? this.anchorX / width : defaultHomeFraction });
    }
    this.play({ kind: "hop" });
  }

  // ─── Snapshots ──────────────────────────────────────────────────────────────

  capture(): Promise<Electron.NativeImage> | undefined {
    if (!this.catShown || !this.window) return undefined;
    const x = Math.max(0, Math.round(this.homeX - 130));
    return this.window.webContents.capturePage({ x, y: 0, width: 260, height: stripHeight });
  }
}
