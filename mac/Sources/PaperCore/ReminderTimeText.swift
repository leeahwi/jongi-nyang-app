import Foundation

public enum ReminderTimeText {
    /// "오늘 09:30", "내일 18:00", "10/3 07:05", "2027/1/2 07:05" — en "Today 9:30 AM", "10/3 7:05 AM",
    /// "1/2/2027 7:05 AM"; nl "Vandaag 09:30", "3-10 07:05", "2-1-2027 07:05". Same as the Windows app (timeText.ts).
    public static func compact(_ date: Date, relativeTo now: Date = .now, calendar: Calendar = .current, language: AppLanguage = .ko) -> String {
        let p = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let time = language.clock(hour: p.hour!, minute: p.minute!)
        let offset = dayOffset(date, from: now, calendar: calendar)
        if offset == 0 || offset == 1, let word = language.dayWord(offset) { return "\(word) \(time)" }
        let sameYear = p.year == calendar.component(.year, from: now)
        let day: String
        switch language {
        case .ko: day = sameYear ? "\(p.month!)/\(p.day!)" : "\(p.year!)/\(p.month!)/\(p.day!)"
        case .en: day = sameYear ? "\(p.month!)/\(p.day!)" : "\(p.month!)/\(p.day!)/\(p.year!)"
        case .nl: day = sameYear ? "\(p.day!)-\(p.month!)" : "\(p.day!)-\(p.month!)-\(p.year!)"
        }
        return "\(day) \(time)"
    }

    /// "오늘 오후 4:49", "내일 오전 9:00", "10월 3일 오전 7:05", "2027년 1월 2일 오전 10:21" — en "Today 4:49 PM",
    /// "Oct 3, 7:05 AM", "Jan 2, 2027, 10:21 AM"; nl "Vandaag 16:49", "3 okt 07:05", "2 jan 2027 10:21".
    public static func scheduled(_ date: Date, relativeTo now: Date = .now, calendar: Calendar = .current, language: AppLanguage = .ko) -> String {
        let p = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let time = language.spokenTime(hour: p.hour!, minute: p.minute!)
        let offset = dayOffset(date, from: now, calendar: calendar)
        if offset == 0 || offset == 1, let word = language.dayWord(offset) { return "\(word) \(time)" }
        let day = language.dayMonth(month: p.month!, day: p.day!, year: p.year == calendar.component(.year, from: now) ? nil : p.year)
        return language == .en ? "\(day), \(time)" : "\(day) \(time)"
    }

    /// The row's reminder note: the time, and whether it was stopped, sent or is still waiting.
    public static func rowLabel(for item: TodoItem, now: Date = .now, calendar: Calendar = .current, language: AppLanguage = .ko) -> String? {
        guard let date = item.reminderAt else { return nil }
        let time = scheduled(date, relativeTo: now, calendar: calendar, language: language)
        let (stopped, sent, waiting): (String, String, String) = switch language {
        case .ko: ("알림 중지", "알림 보냄", "알림 대기")
        case .en: ("Reminder off", "Reminder sent", "reminder pending")
        case .nl: ("Herinnering uit", "Herinnering verstuurd", "herinnering wacht")
        }
        if item.isCompleted { return "\(stopped) · \(time)" }
        if let delivered = item.reminderLastDeliveredAt, delivered >= date { return "\(sent) · \(time)" }
        if date < now { return "\(time) · \(waiting)" }
        return time
    }

    /// Calendar days from `now`'s date to `date`'s (midnight to midnight, like the Korean 오늘 · 내일).
    private static func dayOffset(_ date: Date, from now: Date, calendar: Calendar) -> Int {
        calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: date)).day ?? 99
    }
}
