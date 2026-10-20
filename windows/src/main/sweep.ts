import { dayKey } from "../core/archive";
import { tomorrowKey } from "../core/carry";
import { eveningDue, morningItems, sweepItems, yesterdayKey } from "../core/sweep";
import type { TodoItem } from "../core/notebook";
import { t } from "../i18n";
import type { ReminderPopup } from "./popup";
import type { Store } from "./store";

export interface SweepHooks {
  /** 집중 on, an alarm ringing or another bubble up: the sweep waits. */
  isBusy(): boolean;
  /** The tasks moved: the note's toast (with 되돌리기). */
  moved(ids: string[], target: { kind: "day"; day: string } | { kind: "someday" }, text: string): void;
  openNote(): void;
}

/**
 * 저녁 정리: at the chosen time (20:00 unless changed), once a day, the cat's bubble says how many tasks
 * are left on 오늘 and offers 내일로 · 언젠가로 · 그대로 두기, with the tasks listed (each can be left
 * out). The first time the note opens on a new day after an evening that never came, the morning
 * version asks about yesterday's leftovers. It waits while 집중 is on or another bubble is up.
 */
export class EveningSweep {
  private timer?: NodeJS.Timeout;

  constructor(private readonly store: Store, private readonly popup: ReminderPopup, private readonly hooks: SweepHooks) {
    store.on("prefs", (key: string) => { if (key === "eveningSweep" || key === "eveningSweepTime") this.check(); });
    this.timer = setInterval(() => this.check(), 60_000);
  }

  private get settings() {
    const prefs = this.store.prefs;
    return { enabled: prefs.eveningSweep, time: prefs.eveningSweepTime, shown: prefs.sweepShown };
  }

  /** Every minute: the evening's time come (and nothing in the way)? */
  check(now = new Date()): void {
    if (!eveningDue(this.store.items, now, this.settings) || this.hooks.isBusy() || this.popup.isVisible) return;
    this.show("evening", sweepItems(this.store.items, now), now);
  }

  /** The note opened (or the day turned with it open): the morning version, when yesterday's evening never came. */
  noteOpened(now = new Date()): void {
    const items = morningItems(this.store.items, now, this.settings);
    if (items.length === 0 || this.hooks.isBusy() || this.popup.isVisible) return;
    this.store.setPref("sweepShown", yesterdayKey(now));
    this.show("morning", items, now);
  }

  /** Snapshots and the demo: the bubble as it comes, without the clock. */
  preview(variant: "evening" | "morning", now = new Date()): void {
    const items = variant === "evening" ? sweepItems(this.store.items, now) : this.store.todayItems.filter((item) => !item.isCompleted && !item.seriesID);
    this.show(variant, items, now, true);
  }

  private show(variant: "evening" | "morning", items: TodoItem[], now: Date, preview = false): void {
    if (items.length === 0) return;
    if (!preview && variant === "evening") this.store.setPref("sweepShown", dayKey(now));
    const prefs = this.store.prefs;
    const n = items.length;
    this.popup.show({
      tasks: items.map((item) => ({ id: item.id, title: item.title })),
      scheduled: false, preview, canComplete: false, style: prefs.reminderStyle, font: prefs.font,
      durationMs: 0, snoozeEnabled: false, reduceMotion: false,
      sweep: {
        variant,
        message: variant === "evening" ? t("오늘 {n}개 남았어요. 내일로 넘길까요?", { n }) : t("어제 남은 일이 {n}개 있어요. 오늘 할까요?", { n }),
      },
    }, {
      onComplete: () => undefined, onSnooze: () => undefined, onOpen: () => this.hooks.openNote(),
      onSweep: (choice, ids) => {
        if (preview) return;
        const chosen = ids.filter((id) => items.some((item) => item.id === id));
        if (chosen.length === 0 || choice === "keep") return;
        if (choice === "tomorrow") this.hooks.moved(chosen, { kind: "day", day: tomorrowKey(new Date()) }, t("{n}개를 내일로 옮겼어요", { n: chosen.length }));
        else this.hooks.moved(chosen, { kind: "someday" }, t("{n}개를 언젠가로 옮겼어요", { n: chosen.length }));
      },
    });
  }

  dispose(): void {
    clearInterval(this.timer);
  }
}
