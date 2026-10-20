import Foundation

/// The app's languages: Korean (the source), English and Dutch. Every text the core makes takes
/// one (default Korean). Dates and times are written by hand here, never through the OS locale,
/// so the Mac and Windows apps say exactly the same thing. Same helpers and test cases as the
/// Windows app (lang.ts).
public enum AppLanguage: String, CaseIterable, Sendable {
    case ko, en, nl

    /// The language setting ("auto", "ko", "en", "nl") as a language. Automatic: the first of the
    /// system's preferred languages ("nl-NL", "en_GB", "ko"…) that the app speaks, else English.
    public static func resolve(setting: String?, preferred: [String]) -> AppLanguage {
        if let setting, let language = AppLanguage(rawValue: setting) { return language }
        for code in preferred {
            let prefix = code.lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first.map(String.init) ?? ""
            if let language = AppLanguage(rawValue: prefix) { return language }
        }
        return .en
    }

    /// The language's own name, for the setting: "한국어", "English", "Nederlands".
    public var nativeName: String {
        switch self {
        case .ko: "한국어"
        case .en: "English"
        case .nl: "Nederlands"
        }
    }

    /// Korean and English weeks start on Sunday, Dutch weeks on Monday (the month grid, the week view).
    public var weekStartsMonday: Bool { self == .nl }

    /// The days of a week row in order, 0 = Sunday … 6 = Saturday.
    public var weekdayOrder: [Int] { weekStartsMonday ? [1, 2, 3, 4, 5, 6, 0] : [0, 1, 2, 3, 4, 5, 6] }

    // MARK: Names (weekday: 0 = Sunday … 6 = Saturday; month: 1…12)

    /// "일", "Sun", "zo"
    public func weekdayShort(_ weekday: Int) -> String {
        Self.weekdayShorts[self]![((weekday % 7) + 7) % 7]
    }

    /// "일요일", "Sunday", "zondag"
    public func weekdayName(_ weekday: Int) -> String {
        Self.weekdayNames[self]![((weekday % 7) + 7) % 7]
    }

    /// For a grid's narrow heading: "일", "S", "zo".
    public func weekdayLetter(_ weekday: Int) -> String {
        self == .en ? ["S", "M", "T", "W", "T", "F", "S"][((weekday % 7) + 7) % 7] : weekdayShort(weekday)
    }

    /// "10월", "Oct", "okt"
    public func monthShort(_ month: Int) -> String {
        Self.monthShorts[self]![(month - 1 + 12) % 12]
    }

    /// "10월", "October", "oktober"
    public func monthName(_ month: Int) -> String {
        Self.monthNames[self]![(month - 1 + 12) % 12]
    }

    // MARK: Times

    /// The clock: "09:30" (Korean, Dutch — 24-hour) or "9:30 AM" (English).
    public func clock(hour: Int, minute: Int) -> String {
        switch self {
        case .ko, .nl: return String(format: "%02d:%02d", hour, minute)
        case .en: return "\(Self.twelve(hour)):\(String(format: "%02d", minute)) \(hour < 12 ? "AM" : "PM")"
        }
    }

    /// A time as said in a sentence: "오후 3:00", "3:00 PM", "15:00".
    public func spokenTime(hour: Int, minute: Int) -> String {
        switch self {
        case .ko: return "\(hour < 12 ? "오전" : "오후") \(Self.twelve(hour)):\(String(format: "%02d", minute))"
        case .en, .nl: return clock(hour: hour, minute: minute)
        }
    }

    /// From–to: "10:00–11:00"; English keeps one AM/PM when both share it: "3:00–4:00 PM", "11:30 AM–12:30 PM".
    public func timeRange(from start: (hour: Int, minute: Int), to end: (hour: Int, minute: Int)) -> String {
        guard self == .en else { return clock(hour: start.hour, minute: start.minute) + "–" + clock(hour: end.hour, minute: end.minute) }
        if (start.hour < 12) == (end.hour < 12) {
            return "\(Self.twelve(start.hour)):\(String(format: "%02d", start.minute))–" + clock(hour: end.hour, minute: end.minute)
        }
        return clock(hour: start.hour, minute: start.minute) + "–" + clock(hour: end.hour, minute: end.minute)
    }

    /// "40분 뒤", "in 40 min", "over 40 min"
    public func minutesAway(_ minutes: Int) -> String {
        switch self {
        case .ko: "\(minutes)분 뒤"
        case .en: "in \(minutes) min"
        case .nl: "over \(minutes) min"
        }
    }

    /// Today, tomorrow, yesterday (offset 0, 1, -1) as a word starting a label: "오늘", "Today", "Vandaag"; nil for other days.
    public func dayWord(_ offset: Int) -> String? {
        switch (self, offset) {
        case (.ko, 0): "오늘"
        case (.ko, 1): "내일"
        case (.ko, -1): "어제"
        case (.en, 0): "Today"
        case (.en, 1): "Tomorrow"
        case (.en, -1): "Yesterday"
        case (.nl, 0): "Vandaag"
        case (.nl, 1): "Morgen"
        case (.nl, -1): "Gisteren"
        default: nil
        }
    }

    // MARK: Dates

    /// "10월 8일", "Oct 8", "8 okt" — with the year when given: "2027년 1월 2일", "Jan 2, 2027", "2 jan 2027".
    public func dayMonth(month: Int, day: Int, year: Int? = nil) -> String {
        switch self {
        case .ko: return (year.map { "\($0)년 " } ?? "") + "\(month)월 \(day)일"
        case .en: return "\(monthShort(month)) \(day)" + (year.map { ", \($0)" } ?? "")
        case .nl: return "\(day) \(monthShort(month))" + (year.map { " \($0)" } ?? "")
        }
    }

    /// The short date: "10월 8일 (목)", "Thu, Oct 8", "do 8 okt".
    public func shortDate(month: Int, day: Int, weekday: Int, year: Int? = nil) -> String {
        switch self {
        case .ko: return dayMonth(month: month, day: day, year: year) + " (\(weekdayShort(weekday)))"
        case .en: return "\(weekdayShort(weekday)), " + dayMonth(month: month, day: day, year: year)
        case .nl: return "\(weekdayShort(weekday)) " + dayMonth(month: month, day: day, year: year)
        }
    }

    /// The long date (a note's header, the day panel): "10월 8일 목요일", "Thursday, October 8", "donderdag 8 oktober".
    public func longDate(month: Int, day: Int, weekday: Int) -> String {
        switch self {
        case .ko: "\(month)월 \(day)일 \(weekdayName(weekday))"
        case .en: "\(weekdayName(weekday)), \(monthName(month)) \(day)"
        case .nl: "\(weekdayName(weekday)) \(day) \(monthName(month))"
        }
    }

    public func shortDate(_ date: Date, calendar: Calendar = .paper, withYear: Bool = false) -> String {
        let p = calendar.dateComponents([.year, .month, .day, .weekday], from: date)
        return shortDate(month: p.month!, day: p.day!, weekday: p.weekday! - 1, year: withYear ? p.year : nil)
    }

    public func longDate(_ date: Date, calendar: Calendar = .paper) -> String {
        let p = calendar.dateComponents([.month, .day, .weekday], from: date)
        return longDate(month: p.month!, day: p.day!, weekday: p.weekday! - 1)
    }

    /// "2026년 10월", "October 2026", "oktober 2026"
    public func monthTitle(year: Int, month: Int) -> String {
        switch self {
        case .ko: "\(year)년 \(month)월"
        case .en: "\(monthName(month)) \(year)"
        case .nl: "\(monthName(month)) \(year)"
        }
    }

    /// A week: "10월 4일 – 10일" · "Oct 4 – 10" · "4 – 10 okt"; across months "Sep 27 – Oct 3" · "27 sep – 3 okt";
    /// across years with both years: "Dec 27, 2026 – Jan 2, 2027" · "27 dec 2026 – 2 jan 2027".
    public func weekTitle(first a: (year: Int, month: Int, day: Int), last b: (year: Int, month: Int, day: Int)) -> String {
        if a.year != b.year {
            return dayMonth(month: a.month, day: a.day, year: a.year) + " – " + dayMonth(month: b.month, day: b.day, year: b.year)
        }
        if a.month != b.month { return dayMonth(month: a.month, day: a.day) + " – " + dayMonth(month: b.month, day: b.day) }
        switch self {
        case .ko: return "\(a.month)월 \(a.day)일 – \(b.day)일"
        case .en: return "\(monthShort(a.month)) \(a.day) – \(b.day)"
        case .nl: return "\(a.day) – \(b.day) \(monthShort(a.month))"
        }
    }

    // MARK: Counts

    /// "3 days" — the count and the singular or plural noun (English and Dutch).
    public static func plural(_ count: Int, _ one: String, _ many: String) -> String {
        "\(count) \(count == 1 ? one : many)"
    }

    /// "3일", "1 day" / "3 days", "1 dag" / "3 dagen"
    public func days(_ count: Int) -> String {
        switch self {
        case .ko: "\(count)일"
        case .en: Self.plural(count, "day", "days")
        case .nl: Self.plural(count, "dag", "dagen")
        }
    }

    /// "할 일 3개", "1 to-do" / "3 to-dos", "1 taak" / "3 taken"
    public func todos(_ count: Int) -> String {
        switch self {
        case .ko: "할 일 \(count)개"
        case .en: Self.plural(count, "to-do", "to-dos")
        case .nl: Self.plural(count, "taak", "taken")
        }
    }

    // MARK: Tables

    /// 0, 1, 2 — for tables written ko, en, nl.
    var index: Int {
        switch self {
        case .ko: 0
        case .en: 1
        case .nl: 2
        }
    }

    static func twelve(_ hour: Int) -> Int { hour % 12 == 0 ? 12 : hour % 12 }

    private static let weekdayShorts: [AppLanguage: [String]] = [
        .ko: ["일", "월", "화", "수", "목", "금", "토"],
        .en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
        .nl: ["zo", "ma", "di", "wo", "do", "vr", "za"],
    ]
    private static let weekdayNames: [AppLanguage: [String]] = [
        .ko: ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"],
        .en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
        .nl: ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"],
    ]
    private static let monthShorts: [AppLanguage: [String]] = [
        .ko: (1...12).map { "\($0)월" },
        .en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
        .nl: ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"],
    ]
    private static let monthNames: [AppLanguage: [String]] = [
        .ko: (1...12).map { "\($0)월" },
        .en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
        .nl: ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"],
    ]
}

// MARK: Compiled patterns

/// The reading rules' regular expressions, compiled once (1.39): the input line reads what's typed on every
/// key press, and compiling the same few dozen patterns each time was most of that work. Lives here because
/// every part of the core (and every test build) includes this file.
enum RegexCache {
    private static let lock = NSLock()
    nonisolated(unsafe) private static var compiled: [String: NSRegularExpression] = [:]
    nonisolated(unsafe) private static var groupNames: [String: [String]] = [:]

    /// `pattern` compiled with `options` (nil when it doesn't compile).
    static func regex(_ pattern: String, _ options: NSRegularExpression.Options = []) -> NSRegularExpression? {
        let key = "\(options.rawValue)|" + pattern
        lock.lock()
        defer { lock.unlock() }
        if let found = compiled[key] { return found }
        guard let made = try? NSRegularExpression(pattern: pattern, options: options) else { return nil }
        compiled[key] = made
        return made
    }

    /// The named groups `(?<name>…)` in a pattern, in order.
    static func names(_ pattern: String) -> [String] {
        lock.lock()
        if let found = groupNames[pattern] { lock.unlock(); return found }
        lock.unlock()
        let finder = regex(#"\(\?<([A-Za-z][A-Za-z0-9]*)>"#)
        let names = finder.map { $0.matches(in: pattern, range: NSRange(pattern.startIndex..., in: pattern)).compactMap { Range($0.range(at: 1), in: pattern).map { String(pattern[$0]) } } } ?? []
        lock.lock()
        groupNames[pattern] = names
        lock.unlock()
        return names
    }
}
