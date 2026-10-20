const MINUTE = 60_000;
export const busyDeferralMs = 60_000;

export function clampInterval(minutes: number): number {
  return Math.min(240, Math.max(1, Math.round(minutes)));
}

/** Periodic reminder timing. Missed intervals never pile up: every outcome reschedules from now. */
export class ReminderSchedule {
  nextDue: number | undefined;
  enabled: boolean;
  intervalMinutes: number;

  constructor(enabled: boolean, intervalMinutes: number, now: number) {
    this.enabled = enabled;
    this.intervalMinutes = clampInterval(intervalMinutes);
    this.nextDue = enabled ? now + this.intervalMinutes * MINUTE : undefined;
  }

  configure(enabled: boolean, intervalMinutes: number, now: number): void {
    const interval = clampInterval(intervalMinutes);
    if (enabled === this.enabled && interval === this.intervalMinutes) return;
    this.enabled = enabled;
    this.intervalMinutes = interval;
    this.nextDue = enabled ? now + interval * MINUTE : undefined;
  }

  consumeIfDue(now: number, hasTasks: boolean, isBusy: boolean): boolean {
    if (!this.enabled) return false;
    if (this.nextDue === undefined) {
      this.nextDue = now + this.intervalMinutes * MINUTE;
      return false;
    }
    if (now < this.nextDue) return false;
    if (!hasTasks) {
      this.nextDue = now + this.intervalMinutes * MINUTE;
      return false;
    }
    if (isBusy) {
      this.nextDue = now + busyDeferralMs;
      return false;
    }
    this.nextDue = now + this.intervalMinutes * MINUTE;
    return true;
  }

  snooze(until: number): void {
    if (this.enabled) this.nextDue = until;
  }

  resetAfterWake(now: number): void {
    if (this.enabled) this.nextDue = now + this.intervalMinutes * MINUTE;
  }
}
