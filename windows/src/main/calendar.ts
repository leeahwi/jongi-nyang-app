import { powerMonitor } from "electron";
import { logicalDayStart } from "../core/archive";
import {
  calendarRows, chatterEvents, dateKey, draftColor, untitledIn, draftForNew, draftForTask, dueEventAlerts, eventAlertKey, nextEventAlertTime, validate,
  type CalendarDraft, type CalendarEvent, type CalendarSheetRequest, type CalendarView, type CalendarWriteRequest, type CalendarWriteResult, type ChatterEvents,
} from "../core/calendar";
import { draftFromEvent, eventFromDraft, expand, parseOccurrenceKey, skipDay, type EventColor, type EventRepeat, type LocalEvent } from "../core/events";
import { isoDate, newID } from "../core/notebook";
import type { ReminderPopup } from "./popup";
import type { Store } from "./store";
import { lang, t } from "../i18n";
import { eventSnoozeAt } from "../core/snooze";

/**
 * 일정 in the main process: the app's own events (events.json in the storage folder, kept by the
 * store like the tasks, so a shared folder shares them), today's strip worked out every minute, the
 * alerts before an event, and the sheet that makes, changes and deletes events (from the note, the
 * 달력 window and the quick entry). Nothing leaves this device except through the storage folder.
 */

const minute = 60_000;
const day = 24 * 60 * minute;

export interface CalendarHooks {
  /** The task-alert bubble, shared: event alerts never interrupt one that is up. */
  popup: ReminderPopup;
  beforeShow(): void;
  durationMs(): number;
  /** The note, shown, with the event sheet open. */
  openSheet(request: CalendarSheetRequest): void;
  /** The 달력 window on that day (an alert's title). */
  showCalendar(day: string): void;
}

export class CalendarService {
  private lastRows = "";
  /** 5분 전에 다시: the alerts waiting to come again. */
  private readonly again = new Set<NodeJS.Timeout>();
  private alertTimer?: NodeJS.Timeout;
  private sleeping = false;

  constructor(private readonly store: Store, private readonly hooks: CalendarHooks, options: { alerts: boolean }) {
    store.calendarView = () => this.view();
    // The strip's "N분 뒤" and 진행 중 / 끝남 move on every minute, on the minute.
    const everyMinute = () => {
      if (JSON.stringify(this.view().today) !== this.lastRows) this.store.changed();
    };
    setTimeout(() => { everyMinute(); setInterval(everyMinute, minute); }, minute - (Date.now() % minute) + 250);
    if (!options.alerts) return;
    store.on("events", () => this.armAlerts());
    store.on("prefs", (key: string) => { if (key === "calendarAlertMinutes") this.armAlerts(); });
    powerMonitor.on("suspend", () => { this.sleeping = true; clearTimeout(this.alertTimer); });
    powerMonitor.on("resume", () => {
      this.sleeping = false;
      this.store.changed();
      this.armAlerts(15_000);
    });
    this.armAlerts();
  }

  private spread?: { version: number; start: number; events: CalendarEvent[] };

  /**
   * The occurrences around the logical day of `now` (the day before to the day after). Kept until the events
   * or the day change: the tray asks every few seconds and every state sent asks too.
   */
  around(now: Date): CalendarEvent[] {
    const start = logicalDayStart(now).getTime();
    if (this.spread?.version === this.store.eventsVersion && this.spread.start === start) return this.spread.events;
    const events = expand(this.store.events, new Date(start - day), new Date(start + 2 * day), lang());
    this.spread = { version: this.store.eventsVersion, start, events };
    return events;
  }

  view(now = new Date()): CalendarView {
    const today = calendarRows(this.around(now), now, lang());
    this.lastRows = JSON.stringify(today);
    return {
      today,
      hasEvents: this.store.events.length > 0,
      withEvents: [...new Set(this.store.events.map((event) => event.taskId).filter((id): id is string => Boolean(id)))],
    };
  }

  /** Today's events for 종이냥 한마디; nothing while no event is kept. */
  chatter(now = new Date()): ChatterEvents | undefined {
    return this.store.events.length > 0 ? chatterEvents(this.around(now), now) : undefined;
  }

  /** The event behind an occurrence's key ("local/<id>@<day>"), and that day. */
  find(key: string): { event: LocalEvent; day: string } | undefined {
    const parsed = parseOccurrenceKey(key);
    const event = parsed && this.store.events.find((entry) => entry.id === parsed.id);
    return event && parsed ? { event, day: parsed.day } : undefined;
  }

  private get lastColor(): string | undefined {
    return this.store.prefs.calendarLastColor || undefined;
  }

  /** 캘린더에 넣기…: the task at its alert, else on its deadline, else at the next free half hour. */
  sendTask(taskId: string): void {
    const item = this.store.items.find((entry) => entry.id === taskId);
    if (!item) return;
    const reminder = item.reminderAt ? new Date(item.reminderAt) : undefined;
    this.hooks.openSheet({ mode: "send", taskId, draft: draftForTask(item.title, reminder, item.dueDate, new Date(), this.lastColor, item.id) });
  }

  /** The strip's + and ⋯ → 새 일정…. */
  newEvent(at?: { day: string; minutes: number }): void {
    const valid = at && /^\d{4}-\d{2}-\d{2}$/.test(at.day) && Number.isInteger(at.minutes) && at.minutes >= 0 && at.minutes < 1440 ? at : undefined;
    this.hooks.openSheet({ mode: "new", draft: draftForNew(new Date(), this.lastColor, valid) });
  }

  /** The sheet for an occurrence: 고치기 (the whole series), or opened at its delete question. */
  editRequest(key: string, confirmDelete = false): CalendarSheetRequest | undefined {
    const found = this.find(key);
    if (!found) return undefined;
    return { mode: "edit", key, id: found.event.id, day: found.day, recurring: found.event.repeat !== "none", confirmDelete, draft: draftFromEvent(found.event) };
  }

  /** 고치기… (or 지우기…) on a strip row; the 달력 window opens it itself (`open`). */
  editEvent(key: string, confirmDelete = false, open: (request: CalendarSheetRequest) => void = this.hooks.openSheet): void {
    const request = this.editRequest(key, confirmDelete);
    if (request) open(request);
  }

  /** 할 일로 추가 on an event: a task with its title on today's page (no alert). */
  addAsTask(key: string): void {
    const found = this.find(key);
    if (found) this.store.mutate((history) => history.addTo(found.event.title.trim() || untitledIn(lang()), undefined, new Date()));
  }

  /**
   * 빠른 입력 with Ctrl+Enter: the line as an event, made at once (the strip shows it). When the
   * line can't be one (no title left), the note opens with the new-event sheet and why.
   */
  quickEvent(title: string, reminderAt?: string, dueDate?: string): void {
    const reminder = reminderAt ? new Date(reminderAt) : undefined;
    const draft = draftForTask(title, reminder, dueDate, new Date(), this.lastColor);
    const result = this.write({ kind: "create", draft });
    if (!result.ok) this.hooks.openSheet({ mode: "new", draft, error: result.error });
  }

  /** 입력 줄: an event made at once from a reading (the last colour used); its id, to take it back, or why it couldn't be. */
  createFromLine(title: string, day: string, allDay: boolean, start: number, end: number, now = new Date(), repeat: EventRepeat = "none"): { id: string } | { error: string } {
    const draft: CalendarDraft = { title, color: draftColor(this.lastColor), date: day, allDay, days: 1, startMinutes: start, endMinutes: end, repeat };
    const problem = validate(draft, lang());
    if (problem) {
      this.hooks.openSheet({ mode: "new", draft, error: problem });
      return { error: problem };
    }
    const id = newID();
    this.store.putEvent(eventFromDraft(draft, id, now));
    return { id };
  }

  /** Takes back an event just made from the 입력 줄. */
  removeFromLine(id: string): void {
    if (this.store.events.some((event) => event.id === id)) this.store.removeEvent(id);
  }

  /** The sheet's 넣기 · 만들기 · 저장 · 지우기 · 이 날만: done at once, in events.json. */
  write(request: CalendarWriteRequest, now = new Date()): CalendarWriteResult {
    const existing = request.id ? this.store.events.find((event) => event.id === request.id) : undefined;
    if (request.kind !== "create" && !existing) return { ok: false, error: t("이미 지워진 일정이에요.") };
    if (request.kind === "delete") {
      this.store.removeEvent(existing!.id);
      return { ok: true };
    }
    if (request.kind === "skip") {
      if (!request.day) return { ok: false, error: t("어느 날을 지울지 알 수 없어요. 달력에서 그날을 고른 뒤 다시 지워 주세요.") };
      this.store.putEvent(skipDay(existing!, request.day, now));
      return { ok: true };
    }
    const draft = request.draft;
    if (!draft) return { ok: false, error: t("제목을 적어 주세요") };
    const problem = validate(draft, lang());
    if (problem) return { ok: false, error: problem };
    this.store.putEvent(eventFromDraft(draft, existing?.id ?? newID(), now, existing));
    if (request.kind === "create" && this.store.prefs.calendarLastColor !== draft.color) this.store.setPref("calendarLastColor", draft.color);
    return { ok: true };
  }

  // ─── Alerts ───────────────────────────────────────────────────────────────

  private get shownHere(): ReadonlySet<string> {
    return new Set(this.store.prefs.calendarAlertsShown ?? []);
  }

  private noteShown(events: readonly CalendarEvent[], now: number): void {
    const cutoff = now - 2 * day;
    const kept = (this.store.prefs.calendarAlertsShown ?? []).filter((key) => Number(key.split("@").pop()) * 1000 >= cutoff);
    for (const event of events) { const key = eventAlertKey(event); if (!kept.includes(key)) kept.push(key); }
    this.store.setPref("calendarAlertsShown", kept);
  }

  /** The next alert's timer; at most an hour ahead, then it looks again (later days come into view). */
  private armAlerts(minimumDelay = 1000): void {
    clearTimeout(this.alertTimer);
    if (this.sleeping) return;
    const now = new Date();
    const next = nextEventAlertTime(this.around(now), now, this.store.prefs.calendarAlertMinutes, this.shownHere);
    const due = next ?? now.getTime() + 60 * minute;
    const delay = Math.max(minimumDelay, this.hooks.popup.isVisible ? this.hooks.durationMs() + 500 : 1000, due - Date.now());
    this.alertTimer = setTimeout(() => this.tick(), Math.min(delay, 60 * minute));
  }

  private tick(): void {
    if (this.sleeping) return;
    // A task alert is up: this one waits until it has gone.
    if (this.hooks.popup.isVisible) return this.armAlerts(15_000);
    const now = new Date();
    const due = dueEventAlerts(this.around(now), now, this.store.prefs.calendarAlertMinutes, this.shownHere);
    if (due.length === 0) return this.armAlerts();
    this.show(due);
    this.noteShown(due, now.getTime());
    this.armAlerts();
  }

  /**
   * The task-alert bubble (above the cat when it is out): a calendar mark instead of the check
   * circle, no 다시 알림, and the title opens the 달력 window on the event's day.
   */
  private show(events: readonly CalendarEvent[]): void {
    this.hooks.beforeShow();
    const prefs = this.store.prefs;
    this.hooks.popup.show({
      tasks: events.map((event) => ({ id: `calendar:${event.key}`, title: event.title, scheduledAt: event.start.toISOString(), endsAt: event.end.toISOString(), ...(event.location ? { location: event.location } : {}) })),
      scheduled: true,
      preview: false,
      canComplete: false,
      style: prefs.reminderStyle,
      font: prefs.font,
      durationMs: this.hooks.durationMs(),
      snoozeEnabled: false,
      reduceMotion: false,
      calendarEvents: true,
      eventAgain: Boolean(events[0] && eventSnoozeAt(events[0].start, new Date())),
    }, {
      // 5분 전에 다시: the same alert again five minutes before the start (this run of the app only).
      onEventAgain: () => {
        const first = events[0];
        const at = first ? eventSnoozeAt(first.start, new Date()) : undefined;
        if (!at) return;
        const fire = (delay: number) => {
          const timer = setTimeout(() => {
            this.again.delete(timer);
            // A bubble is up: this one waits for it instead of stacking on it.
            if (this.hooks.popup.isVisible) return fire(15_000);
            this.show(events);
          }, delay);
          this.again.add(timer);
        };
        fire(at.getTime() - Date.now());
      },
      onComplete: () => undefined,
      onSnooze: () => undefined,
      onOpen: () => undefined,
      onOpenEvent: (id) => {
        const parsed = parseOccurrenceKey(id.replace(/^calendar:/, ""));
        this.hooks.showCalendar(parsed?.day ?? dateKey(new Date()));
      },
    });
  }

  /** The alert bubble for one event, as it would come up (snapshots only). */
  previewAlert(event: CalendarEvent): void {
    this.show([event]);
  }

  // ─── Snapshots ────────────────────────────────────────────────────────────

  /** A believable month of events around today, written to the (throwaway) storage folder. Returns today's occurrences. */
  showSample(now = new Date()): CalendarEvent[] {
    this.store.replaceEvents(sampleEvents(now));
    return this.around(now);
  }

  /** Snapshots: events on other days only (the strip is its heading), or none at all (no strip). */
  sampleWithoutToday(now = new Date()): void {
    const today = new Set(this.around(now).filter((event) => event.start < new Date(logicalDayStart(now).getTime() + day) && event.end > logicalDayStart(now)).map((event) => event.eventId));
    this.store.replaceEvents(sampleEvents(now).filter((event) => !today.has(event.id)));
  }

  clearSample(): void {
    this.store.replaceEvents([]);
  }
}

/** Snapshots: meetings, a repeating stand-up and yoga, a trip, a birthday, a late walk (never real data). */
function sampleEvents(now: Date): LocalEvent[] {
  const base = new Date(now);
  base.setSeconds(0, 0);
  base.setMinutes(base.getMinutes() - (base.getMinutes() % 5));
  const at = (minutes: number) => new Date(base.getTime() + minutes * minute);
  const today = logicalDayStart(base);
  const on = (days: number, hour = 0, minuteOf = 0) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days, hour, minuteOf);
  const stamp = isoDate(now);
  let count = 0;
  const event = (title: string, start: Date, end: Date, color: EventColor, extra: Partial<LocalEvent> = {}): LocalEvent => ({
    id: `SAMPLE-${String(++count).padStart(4, "0")}`, title, date: dateKey(start), allDay: false, days: 1,
    start: start.getHours() * 60 + start.getMinutes(), end: end.getHours() * 60 + end.getMinutes(),
    repeat: "none", skip: [], color, createdAt: stamp, updatedAt: stamp, ...extra,
  });
  const allDay = (title: string, first: Date, days: number, color: EventColor, repeat: EventRepeat = "none"): LocalEvent =>
    event(title, first, first, color, { allDay: true, days, start: 540, end: 600, repeat });
  const standupStart = at(-120);
  const standup = new Date(standupStart.getFullYear(), standupStart.getMonth(), standupStart.getDate() - 14, standupStart.getHours(), standupStart.getMinutes());
  return [
    allDay(t("엄마 생신"), on(0), 1, "yellow", "yearly"),
    event(t("아침 스탠드업"), standup, new Date(standup.getTime() + 15 * minute), "sage", { repeat: "weekly", location: t("회의실 B") }),
    event(t("디자인 리뷰"), at(-20), at(40), "sage", { location: t("온라인") }),
    event(t("점심 약속"), at(45), at(105), "blue", { location: t("김밥천국") }),
    event(t("치과 정기 검진"), at(240), at(300), "coral", { location: t("연세치과") }),
    // Other days, for the 달력 window (never inside today's 4 a.m. day, so the strip stays as it is).
    event(t("주간 회의"), on(-6, 10), on(-6, 11), "sage", { repeat: "weekly", location: t("회의실 A"), skip: [dateKey(on(8))] }),
    event(t("요가"), on(-5, 19), on(-5, 20), "purple", { repeat: "weekly" }),
    allDay(t("부산 출장"), on(3), 3, "purple"),
    event(t("새 버전 출시"), on(4, 14), on(4, 15, 30), "sage", { location: t("온라인") }),
    event(t("영화 보기"), on(4, 20), on(4, 22, 30), "blue", { location: "CGV" }),
    event(t("가족 저녁"), on(-2, 18, 30), on(-2, 20), "coral"),
    event(t("미용실"), on(-9, 11), on(-9, 12), "blue"),
    allDay(t("팀 워크숍"), on(12), 2, "sage"),
    event(t("공연"), on(15, 19, 30), on(15, 22), "blue"),
    event(t("밤 산책"), on(10, 23), on(11, 0, 30), "gray"),
    event(t("분기 리뷰"), on(17, 15), on(17, 16), "sage"),
    allDay(t("친구 생일"), on(20), 1, "yellow"),
    event(t("화분 분갈이"), on(-12, 9), on(-12, 9, 30), "gray"),
    event(t("회고"), on(-13, 16), on(-13, 17), "sage"),
  ];
}
