import Foundation

/// 오늘 창 and the menu bar item: what's coming within the hour, the words next to the cat face,
/// and the three cards (next event · timer · next alarm). Pure: the app draws what this says.
public enum TodayGlance {
    /// The next thing starting within the hour: a timed event of today, or an open task's reminder.
    public struct Soon: Equatable, Sendable {
        public var title: String
        public var at: Date
        public var minutes: Int
        public var isEvent: Bool
        public init(title: String, at: Date, minutes: Int, isEvent: Bool) {
            self.title = title; self.at = at; self.minutes = minutes; self.isEvent = isEvent
        }
    }

    /// How near "soon" is.
    public static let window = 60

    /// The earliest event start or reminder after now and within the hour; at the same time the event first.
    public static func soon(events: [CalendarEvent], reminders: [DayRibbon.Reminder], now: Date) -> Soon? {
        let limit = now.addingTimeInterval(TimeInterval(window * 60))
        let found = events.filter { !$0.allDay && $0.start > now && $0.start <= limit }
            .map { Soon(title: $0.title, at: $0.start, minutes: minutes(from: now, to: $0.start), isEvent: true) }
            + reminders.filter { $0.at > now && $0.at <= limit }
            .map { Soon(title: $0.title, at: $0.at, minutes: minutes(from: now, to: $0.at), isEvent: false) }
        return found.min { ($0.at, $0.isEvent ? 0 : 1) < ($1.at, $1.isEvent ? 0 : 1) }
    }

    /// The menu bar's words next to the cat: a running timer's remaining time ("12:30"), else what
    /// starts within the hour ("치과 40분"), else nothing ("").
    public static func menuBarText(timerRemaining: TimeInterval?, soon: Soon?, language: AppLanguage) -> String {
        if let timerRemaining { return FocusTimer.clock(max(0, timerRemaining)) }
        guard let soon else { return "" }
        return soonText(title: soon.title, minutes: soon.minutes, language: language)
    }

    /// "치과 40분" · "Dentist 40 min" · "Tandarts 40 min"; the title cut at 12 characters with "…".
    public static func soonText(title: String, minutes: Int, language: AppLanguage) -> String {
        let name = shortTitle(title)
        switch language {
        case .ko: return "\(name) \(minutes)분"
        case .en, .nl: return "\(name) \(minutes) min"
        }
    }

    /// At most 12 characters, else 12 and "…".
    public static func shortTitle(_ title: String, limit: Int = 12) -> String {
        let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.count > limit ? String(trimmed.prefix(limit)).trimmingCharacters(in: .whitespaces) + "…" : trimmed
    }

    /// The full state for VoiceOver and the tooltip: "종이냥 · 타이머 12:30 남음 · 오늘 할 일 3개 남음" ("남은 할 일 없음").
    /// en "Jongi-nyang · Timer: 12:30 left · 3 to-dos left"; nl "Jongi-nyang · Timer: nog 12:30 · nog 3 taken".
    public static func accessibilityText(appName: String, timerRemaining: TimeInterval?, soon: Soon?, openTasks: Int, language: AppLanguage) -> String {
        var parts = [appName]
        if let timerRemaining {
            let clock = FocusTimer.clock(max(0, timerRemaining))
            parts.append(["타이머 \(clock) 남음", "Timer: \(clock) left", "Timer: nog \(clock)"][language.index])
        }
        if let soon {
            parts.append("\(soon.title) \(DayRibbon.away(soon.minutes, language: language))")
        }
        switch language {
        case .ko: parts.append(openTasks == 0 ? "남은 할 일 없음" : "오늘 할 일 \(openTasks)개 남음")
        case .en: parts.append(openTasks == 0 ? "Nothing left today" : AppLanguage.plural(openTasks, "to-do", "to-dos") + " left today")
        case .nl: parts.append(openTasks == 0 ? "Niets meer voor vandaag" : "nog " + AppLanguage.plural(openTasks, "taak", "taken") + " vandaag")
        }
        return parts.joined(separator: " · ")
    }

    // MARK: Cards

    /// The 다음 일정 card's line under the time: "40분 뒤 · 치과" · "in 40 min · Dentist" · "over 40 min · Tandarts".
    /// The time away comes first, so a long title gives way to the ellipsis instead of it (as on Windows).
    public static func eventLine(title: String, minutes: Int, language: AppLanguage) -> String {
        // Non-breaking spaces keep "in 40 min" whole when the card wraps.
        DayRibbon.away(minutes, language: language).replacingOccurrences(of: " ", with: "\u{00A0}") + "\u{00A0}· " + shortTitle(title, limit: 14)
    }

    /// The 다음 알람 card's line: "내일 · 평일" · "Tomorrow · Weekdays" · "Morgen · Doordeweeks";
    /// a day further off by its weekday ("월 · 한 번").
    public static func alarmLine(fire: Date, days: [Int], now: Date, calendar: Calendar = .paper, language: AppLanguage) -> String {
        let offset = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: fire)).day ?? 0
        let day = (offset >= 0 ? language.dayWord(offset) : nil)
            ?? language.weekdayShort(calendar.component(.weekday, from: fire) - 1)
        return day + "\u{00A0}· " + Alarm.daysText(days, language: language)
    }

    /// Hints on an empty card: what to type in the line below.
    /// Timer `“타이머 25”` · `“timer 25”` · `‘timer 25’`; alarm `“알람 7시”` · `“alarm 7am”` · `‘wekker 7:00’`.
    public static func timerHint(_ language: AppLanguage) -> String { ["“타이머 25”", "“timer 25”", "‘timer 25’"][language.index] }
    public static func alarmHint(_ language: AppLanguage) -> String { ["“알람 7시”", "“alarm 7am”", "‘wekker 7:00’"][language.index] }

    /// What an empty card puts into the line (1.38): "타이머 25" · "timer 25"; "알람 7시" · "alarm 7am" · "wekker 7:00".
    public static func timerWords(_ language: AppLanguage) -> String { language == .ko ? "타이머 25" : "timer 25" }
    public static func alarmWords(_ language: AppLanguage) -> String { ["알람 7시", "alarm 7am", "wekker 7:00"][language.index] }

    /// No timed event left today: "오늘은 없어요" · "None today" · "Niets vandaag".
    public static func noEvent(_ language: AppLanguage) -> String { ["오늘은 없어요", "None today", "Niets vandaag"][language.index] }

    static func minutes(from now: Date, to date: Date) -> Int {
        max(1, Int((date.timeIntervalSince(now) / 60).rounded(.up)))
    }
}
