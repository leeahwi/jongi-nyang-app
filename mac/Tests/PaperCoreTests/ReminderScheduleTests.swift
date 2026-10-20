import Foundation

private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private func expectDate(_ actual: Date?, _ expected: Date, _ message: String) throws {
    guard let actual else {
        throw TestFailure(description: "\(message): missing date")
    }
    try expect(actual == expected, "\(message): expected \(expected), got \(actual)")
}

@main
private enum ReminderScheduleTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }

        let base = Date(timeIntervalSince1970: 1_800_000_000)

        try test("enabled init starts one interval from now") {
            let schedule = ReminderSchedule(enabled: true, intervalMinutes: 15, now: base)
            try expect(schedule.enabled, "Schedule was not enabled")
            try expect(schedule.intervalMinutes == 15, "Interval changed")
            try expectDate(schedule.nextDue, base.addingTimeInterval(15 * 60), "Initial due date")
        }

        try test("disabled init has no due date") {
            let schedule = ReminderSchedule(enabled: false, intervalMinutes: 15, now: base)
            try expect(!schedule.enabled, "Schedule was enabled")
            try expect(schedule.nextDue == nil, "Disabled schedule kept a due date")
        }

        try test("interval clamps to supported range") {
            let short = ReminderSchedule(enabled: true, intervalMinutes: -10, now: base)
            let long = ReminderSchedule(enabled: true, intervalMinutes: 999, now: base)
            try expect(short.intervalMinutes == 1, "Minimum interval was not clamped")
            try expectDate(short.nextDue, base.addingTimeInterval(60), "Minimum due date")
            try expect(long.intervalMinutes == 240, "Maximum interval was not clamped")
            try expectDate(long.nextDue, base.addingTimeInterval(240 * 60), "Maximum due date")
        }

        try test("consume fires once at due time and reschedules from now") {
            var schedule = ReminderSchedule(enabled: true, intervalMinutes: 10, now: base)
            let due = base.addingTimeInterval(10 * 60)
            try expect(!schedule.consumeIfDue(now: due.addingTimeInterval(-1), hasTasks: true, isBusy: false), "Fired before due time")
            try expect(schedule.consumeIfDue(now: due, hasTasks: true, isBusy: false), "Did not fire at due time")
            try expectDate(schedule.nextDue, due.addingTimeInterval(10 * 60), "Post-consume due date")
            try expect(!schedule.consumeIfDue(now: due, hasTasks: true, isBusy: false), "Fired twice for the same due time")
        }

        try test("disabled configure clears schedule and consume stays silent") {
            var schedule = ReminderSchedule(enabled: true, intervalMinutes: 10, now: base)
            schedule.configure(enabled: false, intervalMinutes: 10, now: base.addingTimeInterval(30))
            try expect(!schedule.enabled, "Schedule stayed enabled")
            try expect(schedule.nextDue == nil, "Disabled schedule retained due date")
            try expect(!schedule.consumeIfDue(now: base.addingTimeInterval(10 * 60), hasTasks: true, isBusy: false), "Disabled schedule fired")
        }

        try test("enabling or changing interval resets due date") {
            var schedule = ReminderSchedule(enabled: false, intervalMinutes: 10, now: base)
            let enabledAt = base.addingTimeInterval(20)
            schedule.configure(enabled: true, intervalMinutes: 20, now: enabledAt)
            try expect(schedule.enabled, "Schedule did not enable")
            try expectDate(schedule.nextDue, enabledAt.addingTimeInterval(20 * 60), "Enable due date")

            let changedAt = base.addingTimeInterval(40)
            schedule.configure(enabled: true, intervalMinutes: 5, now: changedAt)
            try expect(schedule.intervalMinutes == 5, "Interval did not change")
            try expectDate(schedule.nextDue, changedAt.addingTimeInterval(5 * 60), "Changed interval due date")
        }

        try test("snooze controls next due and unchanged config preserves it") {
            var schedule = ReminderSchedule(enabled: true, intervalMinutes: 10, now: base)
            let snoozed = base.addingTimeInterval(123)
            schedule.snooze(until: snoozed)
            schedule.configure(enabled: true, intervalMinutes: 10, now: base.addingTimeInterval(999))
            try expectDate(schedule.nextDue, snoozed, "Snoozed date")
        }

        try test("snooze on disabled schedule remains nil") {
            var schedule = ReminderSchedule(enabled: false, intervalMinutes: 10, now: base)
            schedule.snooze(until: base.addingTimeInterval(60))
            try expect(schedule.nextDue == nil, "Disabled schedule accepted snooze")
        }

        try test("no tasks at due time skips reminder and starts a fresh interval") {
            var schedule = ReminderSchedule(enabled: true, intervalMinutes: 10, now: base)
            let late = base.addingTimeInterval(45 * 60)
            try expect(!schedule.consumeIfDue(now: late, hasTasks: false, isBusy: false), "Empty task list fired")
            try expectDate(schedule.nextDue, late.addingTimeInterval(10 * 60), "Empty task due date")
        }

        try test("busy due time defers by about sixty seconds") {
            var schedule = ReminderSchedule(enabled: true, intervalMinutes: 10, now: base)
            let due = base.addingTimeInterval(10 * 60)
            try expect(!schedule.consumeIfDue(now: due, hasTasks: true, isBusy: true), "Busy schedule fired")
            try expectDate(schedule.nextDue, due.addingTimeInterval(60), "Busy deferral")
            try expect(!schedule.consumeIfDue(now: due.addingTimeInterval(30), hasTasks: true, isBusy: false), "Fired during busy deferral")
            try expect(schedule.consumeIfDue(now: due.addingTimeInterval(60), hasTasks: true, isBusy: false), "Did not fire after busy deferral")
        }

        try test("long sleep produces one reminder and no catchup burst") {
            var schedule = ReminderSchedule(enabled: true, intervalMinutes: 10, now: base)
            let wake = base.addingTimeInterval(8 * 60 * 60)
            try expect(schedule.consumeIfDue(now: wake, hasTasks: true, isBusy: false), "Wake did not fire")
            try expectDate(schedule.nextDue, wake.addingTimeInterval(10 * 60), "Wake reschedule")
            try expect(!schedule.consumeIfDue(now: wake, hasTasks: true, isBusy: false), "Wake fired twice")
        }

        try test("reset after wake starts a full interval") {
            var schedule = ReminderSchedule(enabled: true, intervalMinutes: 10, now: base)
            let wake = base.addingTimeInterval(8 * 60 * 60)
            schedule.resetAfterWake(now: wake)
            try expectDate(schedule.nextDue, wake.addingTimeInterval(10 * 60), "Wake reset due date")
        }

        try test("empty to tasks does not cause an immediate reminder") {
            var schedule = ReminderSchedule(enabled: true, intervalMinutes: 10, now: base)
            let emptyAt = base.addingTimeInterval(10 * 60)
            let tasksReturnAt = emptyAt.addingTimeInterval(30)
            try expect(!schedule.consumeIfDue(now: emptyAt, hasTasks: false, isBusy: false), "Empty task list fired")
            try expect(!schedule.consumeIfDue(now: tasksReturnAt, hasTasks: true, isBusy: false), "Tasks returned with immediate reminder")
            try expectDate(schedule.nextDue, emptyAt.addingTimeInterval(10 * 60), "Empty-to-tasks due date")
        }

        print("\n\(count) reminder checks passed.")
    }
}
