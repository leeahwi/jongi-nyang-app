import Foundation

private struct Failure: Error { let message: String }
private func require(_ value: Bool, _ message: String) throws {
    if !value { throw Failure(message: message) }
}

@main
private enum ReminderTimeTextTests {
    static func main() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
        func date(_ year: Int, _ month: Int, _ day: Int, _ hour: Int = 10, _ minute: Int = 21) -> Date {
            calendar.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
        }
        let now = date(2026, 9, 28, 9, 0)
        let scheduled = date(2026, 9, 28)
        let today = ReminderTimeText.scheduled(scheduled, relativeTo: now, calendar: calendar)
        try require(today == "오늘 오전 10:21", "Today must show exact local time")
        let tomorrow = ReminderTimeText.scheduled(date(2026, 9, 29, 15, 30), relativeTo: now, calendar: calendar)
        try require(tomorrow == "내일 오후 3:30", "Tomorrow must show exact local time")
        let other = ReminderTimeText.scheduled(date(2026, 10, 2, 9, 0), relativeTo: now, calendar: calendar)
        try require(other == "10월 2일 오전 9:00", "Other dates must remain identifiable")
        let nextYear = ReminderTimeText.scheduled(date(2027, 1, 2), relativeTo: now, calendar: calendar)
        try require(nextYear.hasPrefix("2027년 1월 2일"), "Different years need an explicit year")
        var item = TodoItem(title: "task", reminderAt: scheduled)
        try require(ReminderTimeText.rowLabel(for: item, now: now, calendar: calendar) == today, "Future reminder label incorrect")
        let late = date(2026, 9, 28, 11, 0)
        try require(ReminderTimeText.rowLabel(for: item, now: late, calendar: calendar)?.hasSuffix("알림 대기") == true, "Overdue must not imply already sent")
        item.reminderLastDeliveredAt = late
        try require(ReminderTimeText.rowLabel(for: item, now: late, calendar: calendar)?.hasPrefix("알림 보냄") == true, "Delivered must not imply another future alert")
        item.isCompleted = true
        try require(ReminderTimeText.rowLabel(for: item, now: late, calendar: calendar)?.hasPrefix("알림 중지") == true, "Completed reminders are suppressed")
        item.reminderAt = nil
        try require(ReminderTimeText.rowLabel(for: item, now: late, calendar: calendar) == nil, "No schedule must have no label")
        try require(ReminderTimeText.compact(scheduled, relativeTo: now, calendar: calendar) == "오늘 10:21", "Compact today must preserve exact time")
        try require(ReminderTimeText.compact(date(2026, 9, 29, 15, 30), relativeTo: now, calendar: calendar) == "내일 15:30", "Compact tomorrow uses unambiguous 24-hour time")
        try require(ReminderTimeText.compact(date(2026, 10, 2, 9, 0), relativeTo: now, calendar: calendar) == "10/2 09:00", "Compact future date must preserve day")
        try require(ReminderTimeText.compact(date(2027, 1, 2), relativeTo: now, calendar: calendar) == "2027/1/2 10:21", "Compact other year must retain year")
        // English and Dutch (the same cases as i18n.test.ts on Windows).
        let times = [scheduled, date(2026, 9, 29, 15, 30), date(2026, 10, 2, 9, 0), date(2027, 1, 2)]
        func each(_ make: (Date) -> String) -> [String] { times.map(make) }
        try require(each { ReminderTimeText.scheduled($0, relativeTo: now, calendar: calendar, language: .en) }
                    == ["Today 10:21 AM", "Tomorrow 3:30 PM", "Oct 2, 9:00 AM", "Jan 2, 2027, 10:21 AM"], "English scheduled times")
        try require(each { ReminderTimeText.scheduled($0, relativeTo: now, calendar: calendar, language: .nl) }
                    == ["Vandaag 10:21", "Morgen 15:30", "2 okt 09:00", "2 jan 2027 10:21"], "Dutch scheduled times")
        try require(each { ReminderTimeText.compact($0, relativeTo: now, calendar: calendar, language: .en) }
                    == ["Today 10:21 AM", "Tomorrow 3:30 PM", "10/2 9:00 AM", "1/2/2027 10:21 AM"], "English compact times")
        try require(each { ReminderTimeText.compact($0, relativeTo: now, calendar: calendar, language: .nl) }
                    == ["Vandaag 10:21", "Morgen 15:30", "2-10 09:00", "2-1-2027 10:21"], "Dutch compact times")
        var labelled = TodoItem(title: "task", reminderAt: scheduled)
        try require(ReminderTimeText.rowLabel(for: labelled, now: now, calendar: calendar, language: .en) == "Today 10:21 AM", "English future label")
        try require(ReminderTimeText.rowLabel(for: labelled, now: late, calendar: calendar, language: .en) == "Today 10:21 AM · reminder pending"
                    && ReminderTimeText.rowLabel(for: labelled, now: late, calendar: calendar, language: .nl) == "Vandaag 10:21 · herinnering wacht", "Overdue labels")
        labelled.reminderLastDeliveredAt = late
        try require(ReminderTimeText.rowLabel(for: labelled, now: late, calendar: calendar, language: .en) == "Reminder sent · Today 10:21 AM"
                    && ReminderTimeText.rowLabel(for: labelled, now: late, calendar: calendar, language: .nl) == "Herinnering verstuurd · Vandaag 10:21", "Delivered labels")
        labelled.isCompleted = true
        try require(ReminderTimeText.rowLabel(for: labelled, now: late, calendar: calendar, language: .en) == "Reminder off · Today 10:21 AM"
                    && ReminderTimeText.rowLabel(for: labelled, now: late, calendar: calendar, language: .nl) == "Herinnering uit · Vandaag 10:21", "Completed labels")
        print("21 reminder label checks passed.")
    }
}
