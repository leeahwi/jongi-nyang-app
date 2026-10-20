import Foundation

/// How a deadline reads on a row: "D-3" or "~금".
public enum DueStyle: String, CaseIterable, Identifiable, Sendable {
    case dday, date

    public var id: String { rawValue }
    public var title: String { title(.ko) }

    public func title(_ language: AppLanguage) -> String {
        switch (self, language) {
        case (.dday, .ko): "D-day"
        case (.date, .ko): "날짜"
        case (.dday, .en): "Countdown"
        case (.date, .en): "Date"
        case (.dday, .nl): "Aftellen"
        case (.date, .nl): "Datum"
        }
    }
}

/// How the deadline was picked; the stored value is always a plain date.
public enum DeadlineChoice: Hashable, Sendable {
    case today, thisWeek, thisMonth, date(Date)

    public var title: String { title(.ko) }

    public func title(_ language: AppLanguage) -> String {
        let titles: [String] = switch language {
        case .ko: ["오늘까지", "이번 주 안", "이번 달 안", "날짜 지정"]
        case .en: ["Today", "This week", "This month", "Pick a date"]
        case .nl: ["Vandaag", "Deze week", "Deze maand", "Datum kiezen"]
        }
        switch self {
        case .today: return titles[0]
        case .thisWeek: return titles[1]
        case .thisMonth: return titles[2]
        case .date: return titles[3]
        }
    }
}

public enum DeadlineUrgency: Sendable, Equatable {
    case overdue, today, soon, later
}

/// Deadlines are whole days ("yyyy-MM-dd", no time zone surprises) and follow the app's
/// 4 a.m. day boundary, so "오늘까지" still means tonight at 1 a.m.
public enum Deadline {
    /// The end of this week, or of next week when today is its last day — always a later day.
    public static func upcomingWeekEnd(now: Date, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String {
        let weekEnd = day(for: .thisWeek, now: now, calendar: calendar, language: language)
        guard weekEnd == day(for: .today, now: now, calendar: calendar) else { return weekEnd }
        let today = Archive.logicalDayStart(now, calendar: calendar)
        return key(calendar.date(byAdding: .day, value: 7, to: today)!, calendar: calendar)
    }

    /// The last day for a choice. A week ends on the last day of the 앞으로 week — Saturday in Korean and
    /// English (weeks start on Sunday), Sunday in Dutch — so "이번 주 안" always lands under 이번 주; a month
    /// ends on its last day.
    public static func day(for choice: DeadlineChoice, now: Date, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String {
        let today = Archive.logicalDayStart(now, calendar: calendar)
        switch choice {
        case .today:
            return key(today, calendar: calendar)
        case .thisWeek:
            return week(of: now, calendar: calendar, language: language).last
        case .thisMonth:
            let interval = calendar.dateInterval(of: .month, for: today)!
            return key(calendar.date(byAdding: .day, value: -1, to: interval.end)!, calendar: calendar)
        case .date(let date):
            return key(date, calendar: calendar)
        }
    }

    /// The first and last day ("yyyy-MM-dd") of the week holding today (by the 4 a.m. rule): Sunday to
    /// Saturday in Korean and English, Monday to Sunday in Dutch — the weeks 앞으로 shows.
    public static func week(of now: Date, calendar: Calendar = .paper, language: AppLanguage) -> (first: String, last: String) {
        let today = Archive.logicalDayStart(now, calendar: calendar)
        let weekday = calendar.component(.weekday, from: today) - 1 // 0 = Sunday
        let back = language.weekStartsMonday ? (weekday + 6) % 7 : weekday
        let first = calendar.date(byAdding: .day, value: -back, to: today)!
        let last = calendar.date(byAdding: .day, value: 6 - back, to: today)!
        return (key(first, calendar: calendar), key(last, calendar: calendar))
    }

    public static func key(_ date: Date, calendar: Calendar = .paper) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }

    public static func date(from key: String, calendar: Calendar = .paper) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12))
    }

    /// Whole days from today (logical) to the deadline; negative when overdue.
    public static func daysLeft(_ key: String, now: Date, calendar: Calendar = .paper) -> Int? {
        guard let due = date(from: key, calendar: calendar),
              let today = date(from: Archive.dayKey(now, calendar: calendar), calendar: calendar) else { return nil }
        return calendar.dateComponents([.day], from: today, to: due).day
    }

    public static func urgency(_ key: String, now: Date, calendar: Calendar = .paper) -> DeadlineUrgency {
        guard let days = daysLeft(key, now: now, calendar: calendar) else { return .later }
        return days < 0 ? .overdue : days == 0 ? .today : days <= 2 ? .soon : .later
    }

    /// "D-3", "D-day", "D+2" — or "~오늘", "~내일", "~금", "~10/31", "~2027/1/2".
    /// en "3 days left", "due today", "2 days late" — or "by today", "by tomorrow", "by Fri", "by Oct 31", "by Jan 2, 2027";
    /// nl "nog 3 dagen", "vandaag", "2 dagen te laat" — or "tot vandaag", "tot morgen", "tot vr", "tot 31 okt", "tot 2 jan 2027".
    public static func label(_ key: String, style: DueStyle, now: Date, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String {
        guard let days = daysLeft(key, now: now, calendar: calendar), let due = date(from: key, calendar: calendar) else { return "" }
        switch style {
        case .dday:
            switch language {
            case .ko: return days == 0 ? "D-day" : days > 0 ? "D-\(days)" : "D+\(-days)"
            case .en: return days == 0 ? "due today" : days > 0 ? language.days(days) + " left" : language.days(-days) + " late"
            case .nl: return days == 0 ? "vandaag" : days > 0 ? "nog " + language.days(days) : language.days(-days) + " te laat"
            }
        case .date:
            let parts = calendar.dateComponents([.year, .month, .day, .weekday], from: due)
            let sameYear = parts.year == calendar.component(.year, from: now)
            if language == .ko {
                if days == 0 { return "~오늘" }
                if days == 1 { return "~내일" }
                if days > 1 && days < 7 { return "~" + language.weekdayShort(parts.weekday! - 1) }
                return sameYear ? "~\(parts.month!)/\(parts.day!)" : "~\(parts.year!)/\(parts.month!)/\(parts.day!)"
            }
            let by = language == .en ? "by " : "tot "
            if days == 0 || days == 1 { return by + language.dayWord(days)!.lowercased() }
            if days > 1 && days < 7 { return by + language.weekdayShort(parts.weekday! - 1) }
            return by + language.dayMonth(month: parts.month!, day: parts.day!, year: sameYear ? nil : parts.year)
        }
    }

    /// "10월 4일 (일)까지 · 5일 남음" — the full sentence for help text and the editor.
    /// en "Due Sun, Oct 4 · 5 days left" ("today", "2 days late"); nl "Deadline zo 4 okt · nog 5 dagen" ("vandaag", "2 dagen te laat").
    public static func sentence(_ key: String, now: Date, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String {
        guard let days = daysLeft(key, now: now, calendar: calendar), let due = date(from: key, calendar: calendar) else { return "" }
        let day = language.shortDate(due, calendar: calendar)
        switch language {
        case .ko:
            let tail = days == 0 ? "오늘 마감" : days > 0 ? "\(days)일 남음" : "\(-days)일 지남"
            return "\(day)까지 · \(tail)"
        case .en:
            let tail = days == 0 ? "today" : days > 0 ? language.days(days) + " left" : language.days(-days) + " late"
            return "Due \(day) · \(tail)"
        case .nl:
            let tail = days == 0 ? "vandaag" : days > 0 ? "nog " + language.days(days) : language.days(-days) + " te laat"
            return "Deadline \(day) · \(tail)"
        }
    }
}
