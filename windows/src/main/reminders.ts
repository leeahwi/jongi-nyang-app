import { powerMonitor } from "electron";
import { nextReminderTime, readyItems, reminderKey } from "../core/due";
import { ReminderSchedule } from "../core/schedule";
import type { TodoItem } from "../core/notebook";
import type { PopupTask } from "../core/types";
import type { ReminderPopup } from "./popup";
import type { Store } from "./store";
import { lang, t } from "../i18n";
import { snoozeChoices } from "../core/snooze";

/** The bubble's ⌄ menu for a task alert or the periodic nudge, as it crosses to the window. */
const menuChoices = (kind: "task" | "periodic") => snoozeChoices(new Date(), kind, lang()).map((choice) => ({ id: choice.id, title: choice.title, ...(choice.at ? { at: choice.at.toISOString() } : {}) }));

const toTask = (item: { id: string; title: string; reminderAt?: string }): PopupTask => ({ id: item.id, title: item.title, scheduledAt: item.reminderAt });

interface Hooks {
  isBusy(): boolean;
  openNote(): void;
  /** 집중 on (with the task focused on): other tasks' alerts wait until it ends. Undefined when not focusing. */
  focusing?(): { taskId?: string } | undefined;
  /** 내일로 (and 내일로 미루기) on a task alert: these tasks due tomorrow, their alert gone; the note says so. */
  moveToTomorrow?(ids: string[]): void;
  /** 모두 끝냄: these checked together (one undo step); the note says so. */
  completeAll?(ids: string[]): void;
  /**
   * 시스템 알림으로도 보내기: a task alert came (`locked`: while the screen is locked, when the bubble can't
   * be seen); the main process decides whether Windows' own notification goes too. True when it went.
   */
  systemNotice?(items: readonly TodoItem[], locked: boolean): boolean;
  /** Whether alerts keep coming while the screen is locked (to go to Windows' notifications). */
  notifyWhileLocked?(): boolean;
}

/** Sleep, screen lock and wake are shared by both kinds of reminder. */
function onPowerChange(pause: () => void, resume: () => void): void {
  powerMonitor.on("suspend", pause);
  powerMonitor.on("lock-screen", pause);
  powerMonitor.on("resume", resume);
  powerMonitor.on("unlock-screen", resume);
}

/** "Still N left" every interval, only while something is open and the person isn't writing in the note. */
export class PeriodicReminders {
  private schedule: ReminderSchedule;
  private timer?: NodeJS.Timeout;
  private sleeping = false;
  private hadTasks: boolean;
  private previewing = false;

  constructor(private readonly store: Store, private readonly popup: ReminderPopup, private readonly other: ReminderPopup, private readonly hooks: Hooks) {
    this.schedule = new ReminderSchedule(store.prefs.reminderEnabled, store.prefs.intervalMinutes, Date.now());
    this.hadTasks = store.remainingCount > 0;
    store.on("prefs", (key: string) => {
      if (key !== "reminderEnabled" && key !== "intervalMinutes") return;
      this.schedule.configure(store.prefs.reminderEnabled, store.prefs.intervalMinutes, Date.now());
      if (!store.prefs.reminderEnabled && !this.previewing) popup.hide();
      this.arm();
    });
    store.on("change", () => this.modelChanged());
    onPowerChange(() => {
      this.sleeping = true;
      clearTimeout(this.timer);
      popup.hide();
    }, () => {
      this.sleeping = false;
      this.schedule.resetAfterWake(Date.now());
      this.arm();
    });
    this.arm();
  }

  preview(): void {
    this.show(true);
  }

  snooze(minutes: number): void {
    this.snoozeUntil(Date.now() + minutes * 60_000);
  }

  /** The nudge waits until then (오늘 저녁 7시, 내일 아침 9시 from the ⌄ menu). */
  snoozeUntil(at: number): void {
    this.popup.hide();
    this.schedule.snooze(at);
    this.arm();
  }

  private modelChanged(): void {
    const hasTasks = this.store.remainingCount > 0;
    if (hasTasks !== this.hadTasks) {
      this.hadTasks = hasTasks;
      this.schedule.resetAfterWake(Date.now());
      this.arm();
    }
    this.popup.retain(new Set(this.store.items.filter((item) => !item.isCompleted).map((item) => item.id)));
  }

  private arm(): void {
    clearTimeout(this.timer);
    if (this.store.nextPeriodicDue !== this.schedule.nextDue) {
      this.store.nextPeriodicDue = this.schedule.nextDue;
      this.store.changed();
    }
    const due = this.schedule.nextDue;
    if (this.sleeping || due === undefined) return;
    this.timer = setTimeout(() => this.tick(), Math.max(1000, due - Date.now()));
  }

  private tick(): void {
    if (this.sleeping) return;
    const busy = this.hooks.isBusy() || this.popup.isVisible || this.other.isVisible;
    if (this.schedule.consumeIfDue(Date.now(), this.store.remainingCount > 0, busy)) this.show(false);
    this.arm();
  }

  private show(preview: boolean): void {
    const open = this.store.todayItems.filter((item) => !item.isCompleted);
    if (!preview && open.length === 0) return;
    this.previewing = preview;
    const prefs = this.store.prefs;
    this.popup.show({
      tasks: open.length > 0 ? open.map(toTask) : [{ id: "preview", title: t("예: 책 10쪽 읽기") }],
      scheduled: false,
      preview,
      canComplete: true,
      style: prefs.reminderStyle,
      font: prefs.font,
      durationMs: prefs.displaySeconds * 1000,
      snoozeEnabled: prefs.reminderEnabled,
      reduceMotion: false,
      snoozeChoices: menuChoices("periodic"),
    }, {
      onComplete: (id) => { if (!preview) this.store.complete(id); },
      onSnooze: (minutes) => { if (!preview) this.snooze(minutes); },
      onSnoozeUntil: (at) => { if (!preview) this.snoozeUntil(at.getTime()); },
      onOpen: () => this.hooks.openNote(),
    });
  }
}

/** Per-task alerts. Everything due at the same moment arrives together in one bubble. */
export class TaskReminders {
  private timer?: NodeJS.Timeout;
  private sleeping = false;

  constructor(private readonly store: Store, private readonly popup: ReminderPopup, private readonly beforeShow: () => void, private readonly hooks: Hooks, private readonly durationMs: () => number) {
    store.on("change", () => {
      // Calendar alerts share this bubble (main/calendar.ts); they aren't tasks and stay.
      const calendarRows = popup.taskIDs.filter((id) => id.startsWith("calendar:"));
      popup.retain(new Set([...store.items.filter((item) => !item.isCompleted && item.reminderAt).map((item) => item.id), ...calendarRows]));
      this.arm();
    });
    // Asleep: nothing comes. Locked: the alerts wait for the screen — unless they go to Windows'
    // notifications (시스템 알림), which show on the lock screen and in the notification centre.
    powerMonitor.on("suspend", () => { this.sleeping = true; clearTimeout(this.timer); popup.hide(); });
    powerMonitor.on("resume", () => { this.sleeping = false; this.arm(15_000); });
    powerMonitor.on("lock-screen", () => {
      this.locked = true;
      popup.hide();
      if (this.hooks.notifyWhileLocked?.()) return this.arm();
      this.pausedByLock = true;
      clearTimeout(this.timer);
    });
    powerMonitor.on("unlock-screen", () => {
      this.locked = false;
      if (this.pausedByLock) { this.pausedByLock = false; this.arm(15_000); }
    });
    this.arm();
  }

  private locked = false;
  private pausedByLock = false;

  /** Alerts this PC has shown; another computer's "delivered" mark doesn't stand in for these. */
  private get shownHere(): ReadonlySet<string> {
    return new Set(this.store.prefs.shownReminders ?? []);
  }

  private noteShown(items: readonly TodoItem[], now: number): void {
    const cutoff = now - 2 * 86_400_000;
    const kept = (this.store.prefs.shownReminders ?? []).filter((key) => Number(key.split("@").pop()) * 1000 >= cutoff);
    for (const item of items) { const key = reminderKey(item); if (key && !kept.includes(key)) kept.push(key); }
    this.store.setPref("shownReminders", kept);
  }

  private get schedulable() {
    return this.store.items.filter((item) => item.id !== this.store.editingReminderID);
  }

  private arm(minimumDelay = 1000): void {
    clearTimeout(this.timer);
    const next = nextReminderTime(this.schedulable, Date.now(), this.shownHere);
    if (this.sleeping || this.pausedByLock || next === undefined) return;
    const delay = Math.max(minimumDelay, this.popup.isVisible ? this.durationMs() + 500 : 1000, next - Date.now());
    this.timer = setTimeout(() => this.tick(), Math.min(delay, 2_147_000_000));
  }

  /** 다시 알림: the tasks shown (still open) come again at `at`. */
  private snoozeShown(due: readonly TodoItem[], at: Date): void {
    const shown = new Set(due.map((item) => item.id));
    this.store.mutate((history) => {
      for (const item of history.items) if (shown.has(item.id) && !item.isCompleted) history.setReminder(item.id, at);
    });
  }

  /** 집중 ended: what waited meanwhile comes now, together in one bubble. */
  poke(): void {
    this.arm();
  }

  private tick(): void {
    if (this.sleeping || this.pausedByLock) return;
    if (this.popup.isVisible) return this.arm(15_000);
    let due = readyItems(this.schedulable, Date.now(), this.shownHere);
    // The screen locked: Windows' notification only (the bubble would come where no one sees it).
    if (this.locked && due.length) {
      this.hooks.systemNotice?.(due, true);
      const now = new Date();
      this.noteShown(due, now.getTime());
      this.store.mutate((history) => { for (const item of due) history.markReminderDelivered(item.id, now); });
      return this.arm();
    }
    // 집중: only the focused task's own alert comes; the others wait (looked at again every half minute, and when it ends).
    const focus = this.hooks.focusing?.();
    if (focus) {
      const waiting = due.filter((item) => item.id !== focus.taskId);
      due = due.filter((item) => item.id === focus.taskId);
      if (due.length === 0) return waiting.length ? this.arm(30_000) : this.arm();
    }
    if (due.length === 0) return this.arm();
    this.beforeShow();
    const prefs = this.store.prefs;
    this.popup.show({
      tasks: due.map(toTask),
      scheduled: true,
      preview: false,
      canComplete: true,
      style: prefs.reminderStyle,
      font: prefs.font,
      durationMs: this.durationMs(),
      snoozeEnabled: true,
      reduceMotion: false,
      snoozeChoices: menuChoices("task"),
      tomorrow: Boolean(this.hooks.moveToTomorrow),
    }, {
      onComplete: (id) => this.store.complete(id),
      onCompleteAll: (ids) => (this.hooks.completeAll ? this.hooks.completeAll(ids) : ids.forEach((id) => this.store.complete(id))),
      onSnooze: (minutes) => this.snoozeShown(due, new Date(Date.now() + minutes * 60_000)),
      onSnoozeUntil: (at) => this.snoozeShown(due, at),
      onTomorrow: () => this.hooks.moveToTomorrow?.(due.filter((item) => !item.isCompleted).map((item) => item.id)),
      onOpen: () => this.hooks.openNote(),
    });
    this.hooks.systemNotice?.(due, false);
    const now = new Date();
    this.noteShown(due, now.getTime());
    this.store.mutate((history) => { for (const item of due) history.markReminderDelivered(item.id, now); });
    this.arm();
  }
}
