import { BrowserWindow, app, ipcMain, powerMonitor, screen } from "electron";
import path from "node:path";
import { alarmKey, due, lastFire, nextAlarm, nextFire, pruneHandled, snoozeChoices, type Alarm } from "../core/alarm";
import { followSlip, slipWindowOptions } from "./slipWindow";
import { isoDate } from "../core/notebook";
import type { Rect } from "../core/pet";
import { t } from "../i18n";
import { offscreen } from "./env";
import type { Store } from "./store";

export interface AlarmHooks {
  /** The desktop pet's cat, when it is out: the ring window then stands just above it. */
  petAnchor(): Rect | undefined;
  /** An alarm rang, was answered or changed: the tray's 다음 알람 needs rebuilding. */
  changed(): void;
  /** An alarm began to ring (시스템 알림으로도 보내기 may send Windows' notification too). */
  rang?(alarm: Alarm): void;
}

/** A ring that hasn't been answered for 10 minutes stops by itself (and snoozes once). */
const ringLimitMs = 10 * 60_000;
/** Looks again at least this often, so a changed clock or a wake from sleep is noticed. */
const checkEveryMs = 30_000;
const shadowRoom = 16;
/** The 340-wide slip and room for its tape and shadow; the height follows the slip. */
let size = { width: 340 + 48, height: 520 };

/** One ring of one alarm: `key` is its handled key; `autoSnoozed` once it has snoozed by itself. */
interface Ring { alarmID: string; key: string; autoSnoozed: boolean; startedAt?: number }

/**
 * 시계 알람: each running device rings its own alarms (alarms.json may be shared; which rings this
 * device handled is kept in its prefs `alarmHandled`, three days). A ring is a paper card centred
 * on the screen with the pointer (or just above the pet), over everything and on every desktop,
 * with a sound that loops until it is answered: 끄기 (Return) or N분 뒤 다시 (S, Space). Ten
 * minutes without an answer snooze it once by itself; the next time it gives up. A once-alarm
 * turns off after it rang. Rings due together come one after another.
 */
export class AlarmClock {
  private window?: BrowserWindow;
  private loaded = false;
  private ringing?: Ring;
  private readonly queue: Ring[] = [];
  private readonly snoozed = new Map<string, NodeJS.Timeout>();
  private timer?: NodeJS.Timeout;
  private limitTimer?: NodeJS.Timeout;
  private quitting = false;

  constructor(private readonly store: Store, private readonly rendererDirectory: string, private readonly hooks: AlarmHooks, private readonly live: boolean) {
    const fromRing = (event: Electron.IpcMainEvent) => this.window !== undefined && !this.window.isDestroyed() && event.sender === this.window.webContents;
    ipcMain.on("ring:ready", (event) => {
      if (!fromRing(event)) return;
      this.loaded = true;
      this.sendRing();
    });
    ipcMain.on("ring:stop", (event) => { if (fromRing(event)) this.stop(); });
    ipcMain.on("ring:snooze", (event, minutes: unknown) => {
      if (fromRing(event)) this.snooze(false, snoozeChoices.includes(minutes as number) ? minutes as number : undefined);
    });
    store.on("alarms", () => {
      // Turned off or deleted while ringing (here, or on another device): it stops.
      const ringing = this.ringing && this.alarmOf(this.ringing);
      if (this.ringing && (!ringing || !ringing.enabled)) this.quit();
      this.arm();
      this.hooks.changed();
    });
    app.on("before-quit", () => { this.quitting = true; });
    powerMonitor.on("resume", () => this.check());
    powerMonitor.on("unlock-screen", () => this.check());
    if (live) this.check();
  }

  /** The soonest ring of the alarms that are on (the tray's 다음 알람). */
  next(now = new Date()): { alarm: Alarm; at: Date } | undefined {
    return nextAlarm(this.store.alarms, now, this.handled);
  }

  get isRinging(): boolean { return this.ringing !== undefined; }

  private get handled(): Set<string> {
    return new Set(this.store.prefs.alarmHandled ?? []);
  }

  private alarmOf(ring: Ring): Alarm | undefined {
    return this.store.alarms.find((alarm) => alarm.id === ring.alarmID);
  }

  /** Rings what is due now (each ring once: its key is noted as handled first), then waits for the next. */
  check(now = new Date()): void {
    if (!this.live) return;
    const ready = due(this.store.alarms, now, this.handled);
    if (ready.length > 0) {
      const rings = ready.map((alarm) => ({ alarm, key: this.keyOf(alarm, now) }));
      this.store.setPref("alarmHandled", pruneHandled([...(this.store.prefs.alarmHandled ?? []), ...rings.map((ring) => ring.key)], now));
      for (const { alarm, key } of rings) this.queue.push({ alarmID: alarm.id, key, autoSnoozed: false });
      this.ringNext();
      this.hooks.changed();
    }
    this.arm(now);
  }

  /** The ring just found due: the alarm's latest time at or before now (see core due()). */
  private keyOf(alarm: Alarm, now: Date): string {
    return alarmKey(alarm, lastFire(alarm, now) ?? now);
  }

  /** A wake-up at the next ring (or in 30 seconds, whichever is sooner). */
  private arm(now = new Date()): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (!this.live || !this.store.alarms.some((alarm) => alarm.enabled)) return;
    const next = this.next(now);
    const delay = next ? Math.min(checkEveryMs, Math.max(250, next.at.getTime() - Date.now() + 50)) : checkEveryMs;
    this.timer = setTimeout(() => this.check(), delay);
  }

  private ringNext(): void {
    while (!this.ringing && this.queue.length > 0) {
      const ring = this.queue.shift()!;
      const alarm = this.alarmOf(ring);
      if (alarm?.enabled) this.show(ring);
    }
  }

  private show(ring: Ring): void {
    this.ringing = { ...ring, startedAt: Date.now() };
    const window = this.ensureWindow();
    this.place(window);
    this.sendRing();
    window.show();
    window.setAlwaysOnTop(true, "pop-up-menu");
    window.moveTop();
    window.focus();
    clearTimeout(this.limitTimer);
    this.limitTimer = setTimeout(() => this.unanswered(), ringLimitMs);
    const alarm = this.alarmOf(ring);
    if (alarm) this.hooks.rang?.(alarm);
  }

  private sendRing(muted = false): void {
    const window = this.window;
    const alarm = this.ringing && this.alarmOf(this.ringing);
    if (!window || window.isDestroyed() || !alarm || !this.loaded) return;
    window.webContents.send("ring:show", { alarm, muted, startedAt: this.ringing!.startedAt, next: this.nextAfterRing(alarm)?.toISOString() });
  }

  /** Ten minutes unanswered: the first time it snoozes by itself; the second time (or with no snooze) it gives up (like 끄기). */
  private unanswered(): void {
    if (!this.ringing) return;
    // 다시 울림 없음: no second ring; it stops as 끄기 does.
    if (this.ringing.autoSnoozed || this.alarmOf(this.ringing)?.snooze === 0) this.stop();
    else this.snooze(true);
  }

  /** 끄기: the sound and the card go; a once-alarm turns off. */
  stop(): void {
    const ring = this.ringing;
    if (!ring) return;
    this.putAway();
    const alarm = this.alarmOf(ring);
    if (alarm && alarm.days.length === 0 && alarm.enabled) this.store.putAlarm({ ...alarm, enabled: false, updatedAt: isoDate(new Date()) });
    this.hooks.changed();
    this.ringNext();
  }

  /** After this ring, when it rings next (a repeating alarm). */
  private nextAfterRing(alarm: Alarm, now = new Date()): Date | undefined {
    return alarm.days.length ? nextFire(alarm, new Date(now.getTime() + 60_000)) : undefined;
  }

  /** 다시 울림: rings again after `minutes` (5 · 10 · 15, else the alarm's own), in the same window. */
  snooze(auto: boolean, chosen?: number): void {
    const ring = this.ringing;
    if (!ring || this.alarmOf(ring)?.snooze === 0) return; // 다시 울림 없음: only 끄기
    this.putAway();
    const minutes = chosen ?? this.alarmOf(ring)?.snooze ?? 10;
    const again: Ring = { ...ring, autoSnoozed: ring.autoSnoozed || auto };
    clearTimeout(this.snoozed.get(ring.key));
    this.snoozed.set(ring.key, setTimeout(() => {
      this.snoozed.delete(ring.key);
      this.queue.push(again);
      this.ringNext();
    }, minutes * 60_000));
    this.ringNext();
  }

  /** The ringing alarm was turned off or deleted: it goes without a word. */
  private quit(): void {
    this.putAway();
    this.ringNext();
  }

  private putAway(): void {
    clearTimeout(this.limitTimer);
    this.limitTimer = undefined;
    this.ringing = undefined;
    const window = this.window;
    if (window && !window.isDestroyed()) {
      window.webContents.send("ring:hush");
      window.hide();
    }
  }

  /** Centred on the screen with the pointer, or standing just above the pet when it is out. */
  private place(window: BrowserWindow): void {
    const anchor = this.hooks.petAnchor();
    const point = anchor ? { x: Math.round(anchor.x + anchor.width / 2), y: Math.round(anchor.y) } : screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(point).workArea;
    const x = anchor ? anchor.x + anchor.width / 2 - size.width / 2 : area.x + (area.width - size.width) / 2;
    const y = anchor ? anchor.y - size.height + shadowRoom : area.y + (area.height - size.height) / 2;
    const clampedX = Math.min(Math.max(x, area.x), area.x + area.width - size.width);
    const clampedY = Math.min(Math.max(y, area.y), area.y + area.height - size.height);
    window.setBounds({ x: Math.round(clampedX + offscreen.x), y: Math.round(clampedY + offscreen.y), ...size });
  }

  // ─── Snapshots ──────────────────────────────────────────────────────────────

  /** The ring window off-screen and silent, ringing `alarm` (for `minutes` already). */
  async showForSnapshot(alarm: Alarm, minutes = 0): Promise<void> {
    const window = this.ensureWindow();
    window.setBounds({ x: offscreen.x + 300, y: offscreen.y + 300, ...size });
    window.showInactive();
    if (!this.loaded) await new Promise<void>((resolve) => { const wait = () => (this.loaded ? resolve() : setTimeout(wait, 50)); wait(); });
    window.webContents.send("ring:show", { alarm, muted: true, still: true, startedAt: Date.now() - minutes * 60_000, next: this.nextAfterRing(alarm)?.toISOString() });
  }

  hideSnapshot(): void {
    if (this.window && !this.window.isDestroyed()) this.window.hide();
  }

  capture(): Promise<Electron.NativeImage> | undefined {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) return undefined;
    return this.window.webContents.capturePage();
  }

  /** Snapshots: the window, to check its layout. */
  get snapshotWindow(): BrowserWindow | undefined {
    return this.window && !this.window.isDestroyed() ? this.window : undefined;
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window;
    // The ring starts without a click.
    const window = new BrowserWindow(slipWindowOptions(size, t("알람"), { webPreferences: { autoplayPolicy: "no-user-gesture-required" } }));
    followSlip(window, (next) => { size = next; });
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    this.loaded = false;
    window.loadFile(path.join(this.rendererDirectory, "ring.html"));
    // Closed some other way (Alt+F4): treated as 끄기.
    window.on("close", (event) => {
      if (!this.ringing || this.quitting) return;
      event.preventDefault();
      this.stop();
    });
    window.on("closed", () => { if (this.window === window) { this.window = undefined; this.loaded = false; } });
    this.window = window;
    return window;
  }
}
