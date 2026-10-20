import Foundation

/// Pure value-type schedule for periodic in-app reminders.
public struct ReminderSchedule: Equatable, Sendable {
    public private(set) var nextDue: Date?
    public private(set) var enabled: Bool
    public private(set) var intervalMinutes: Int

    /// Creates a schedule that first becomes due one full interval after `now`.
    /// Intervals are clamped to 1...240 minutes. Disabled schedules have no due date.
    public init(enabled: Bool, intervalMinutes: Int, now: Date) {
        self.enabled = enabled
        self.intervalMinutes = Self.clampedInterval(intervalMinutes)
        nextDue = enabled ? Self.dueDate(after: now, intervalMinutes: self.intervalMinutes) : nil
    }

    /// Applies user settings. Changing enabled state or interval restarts the full interval.
    /// Reapplying the same settings preserves any existing due date or snooze.
    public mutating func configure(enabled: Bool, intervalMinutes: Int, now: Date) {
        let clampedInterval = Self.clampedInterval(intervalMinutes)
        guard enabled != self.enabled || clampedInterval != self.intervalMinutes else {
            return
        }

        self.enabled = enabled
        self.intervalMinutes = clampedInterval
        nextDue = enabled ? Self.dueDate(after: now, intervalMinutes: clampedInterval) : nil
    }

    /// Returns true at most once per due date when reminders are enabled, tasks exist, and the app is not busy.
    /// Every due outcome is rescheduled from `now`, so missed intervals do not create catchup bursts.
    @discardableResult
    public mutating func consumeIfDue(now: Date, hasTasks: Bool, isBusy: Bool) -> Bool {
        guard enabled else { return false }

        guard let due = nextDue else {
            nextDue = Self.dueDate(after: now, intervalMinutes: intervalMinutes)
            return false
        }

        guard now >= due else { return false }

        if !hasTasks {
            nextDue = Self.dueDate(after: now, intervalMinutes: intervalMinutes)
            return false
        }

        if isBusy {
            nextDue = now.addingTimeInterval(Self.busyDeferralSeconds)
            return false
        }

        nextDue = Self.dueDate(after: now, intervalMinutes: intervalMinutes)
        return true
    }

    /// Moves the next reminder to an explicit date while enabled.
    public mutating func snooze(until date: Date) {
        guard enabled else { return }
        nextDue = date
    }

    /// Restarts the full interval after the app wakes or becomes newly available.
    public mutating func resetAfterWake(now: Date) {
        guard enabled else { return }
        nextDue = Self.dueDate(after: now, intervalMinutes: intervalMinutes)
    }

    private static let minimumIntervalMinutes = 1
    private static let maximumIntervalMinutes = 240
    private static let busyDeferralSeconds: TimeInterval = 60

    private static func clampedInterval(_ minutes: Int) -> Int {
        min(max(minutes, minimumIntervalMinutes), maximumIntervalMinutes)
    }

    private static func dueDate(after date: Date, intervalMinutes: Int) -> Date {
        date.addingTimeInterval(TimeInterval(intervalMinutes * 60))
    }
}
