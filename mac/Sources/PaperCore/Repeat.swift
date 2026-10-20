import Foundation

public enum RepeatKind: String, Codable, CaseIterable, Identifiable, Sendable {
    case daily, weekdays, weekly, monthly

    public var id: String { rawValue }
    public var title: String { title(.ko) }

    /// "매일", "평일", "매주", "매월" — en "Every day", "Weekdays", "Every week", "Every month";
    /// nl "Elke dag", "Werkdagen", "Elke week", "Elke maand".
    public func title(_ language: AppLanguage) -> String {
        let titles: [String] = switch language {
        case .ko: ["매일", "평일", "매주", "매월"]
        case .en: ["Every day", "Weekdays", "Every week", "Every month"]
        case .nl: ["Elke dag", "Werkdagen", "Elke week", "Elke maand"]
        }
        return titles[Self.allCases.firstIndex(of: self)!]
    }
}

public struct RepeatRule: Codable, Equatable, Hashable, Sendable {
    public var kind: RepeatKind
    /// weekly: 0 (Sunday) … 6 (Saturday), matching the Windows app's repeats.json
    public var weekdays: [Int]?
    /// monthly: 1…31; short months use their last day
    public var monthDay: Int?

    public init(kind: RepeatKind, weekdays: [Int]? = nil, monthDay: Int? = nil) {
        self.kind = kind
        self.weekdays = weekdays
        self.monthDay = monthDay
    }
}

/// A recurring task. Each day it applies, one copy appears on the list. Kept in repeats.json
/// (same format as the Windows app).
public struct Series: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var title: String
    public var rule: RepeatRule
    /// "HH:mm" — the copy's alert time, or none
    public var remindAt: String?
    public var createdAt: Date
    /// dayKey of the last day a copy was placed on the list
    public var lastPlaced: String?

    public init(id: String = UUID().uuidString, title: String, rule: RepeatRule, remindAt: String? = nil, createdAt: Date = Date(), lastPlaced: String? = nil) {
        self.id = id
        self.title = title
        self.rule = rule
        self.remindAt = remindAt
        self.createdAt = createdAt
        self.lastPlaced = lastPlaced
    }
}

public struct RepeatPlan: Equatable, Sendable {
    /// New copies to put on the list.
    public var create: [TodoItem] = []
    /// Unfinished copies from an earlier day, moved to today instead of piling up.
    public var roll: [RepeatRoll] = []
    /// Series that now have today's copy.
    public var placed: [String] = []
}

public struct RepeatRoll: Equatable, Sendable {
    public var id: UUID
    public var reminderAt: Date?
}

public enum Repeat {
    public static let weekdayShort = ["일", "월", "화", "수", "목", "금", "토"]

    /// Whether the rule applies on the logical (4 a.m.) day starting at `dayStart`.
    public static func occurs(_ rule: RepeatRule, on dayStart: Date, calendar: Calendar = .paper) -> Bool {
        let weekday = calendar.component(.weekday, from: dayStart) - 1
        switch rule.kind {
        case .daily: return true
        case .weekdays: return (1...5).contains(weekday)
        case .weekly: return (rule.weekdays ?? []).contains(weekday)
        case .monthly:
            let lastDay = calendar.range(of: .day, in: .month, for: dayStart)?.count ?? 31
            return calendar.component(.day, from: dayStart) == min(rule.monthDay ?? 1, lastDay)
        }
    }

    /// A weekly rule with no days, or a monthly rule without a date, never occurs.
    public static func isValid(_ rule: RepeatRule) -> Bool {
        switch rule.kind {
        case .weekly: return !(rule.weekdays ?? []).isEmpty
        case .monthly: return (1...31).contains(rule.monthDay ?? 0)
        default: return true
        }
    }

    /// The alert moment for the logical day: times before 4 a.m. belong to that night (the next calendar date).
    public static func alert(on dayStart: Date, at remindAt: String, calendar: Calendar = .paper) -> Date? {
        let parts = remindAt.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return nil }
        var components = calendar.dateComponents([.year, .month, .day], from: dayStart)
        components.hour = parts[0]
        components.minute = parts[1]
        guard let date = calendar.date(from: components) else { return nil }
        return parts[0] < Archive.dayBoundaryHour ? calendar.date(byAdding: .day, value: 1, to: date) : date
    }

    /// First logical day on or after `from` that the rule applies, within two years.
    public static func nextOccurrence(_ rule: RepeatRule, from: Date, calendar: Calendar = .paper) -> Date? {
        guard isValid(rule) else { return nil }
        var day = Archive.logicalDayStart(from, calendar: calendar)
        for _ in 0..<750 {
            if occurs(rule, on: day, calendar: calendar) { return day }
            day = calendar.date(byAdding: .day, value: 1, to: day)!
        }
        return nil
    }

    /// "매일", "평일", "매주 월·수", "매월 15일" — plus " · 오전 9:00 알림" when an alert is set.
    /// en "Every Mon, Wed", "Every month on the 15th", " · reminder at 9:00 AM";
    /// nl "Elke ma, wo", "Elke maand op de 15e", " · herinnering om 09:00".
    public static func describe(_ rule: RepeatRule, remindAt: String? = nil, language: AppLanguage = .ko) -> String {
        var text = rule.kind.title(language)
        if rule.kind == .weekly {
            let days = (rule.weekdays ?? []).sorted { ($0 + 6) % 7 < ($1 + 6) % 7 } // Monday first
            let names = days.map { language.weekdayShort($0) }
            switch language {
            case .ko: text = days.count == 7 ? "매일" : "매주 " + names.joined(separator: "·")
            case .en: text = days.count == 7 ? "Every day" : "Every " + names.joined(separator: ", ")
            case .nl: text = days.count == 7 ? "Elke dag" : "Elke " + names.joined(separator: ", ")
            }
        }
        if rule.kind == .monthly {
            let day = rule.monthDay ?? 1
            switch language {
            case .ko: text = "매월 \(day)일"
            case .en: text = "Every month on the \(ordinal(day))"
            case .nl: text = "Elke maand op de \(day)e"
            }
        }
        guard let remindAt else { return text }
        let parts = remindAt.split(separator: ":").compactMap { Int($0) }
        guard parts.count == 2 else { return text }
        let time = language.spokenTime(hour: parts[0], minute: parts[1])
        switch language {
        case .ko: return text + " · \(time) 알림"
        case .en: return text + " · reminder at \(time)"
        case .nl: return text + " · herinnering om \(time)"
        }
    }

    /// "1st", "2nd", "3rd", "4th", "11th", "21st".
    public static func ordinal(_ number: Int) -> String {
        let tens = number % 100
        if (11...13).contains(tens) { return "\(number)th" }
        switch number % 10 {
        case 1: return "\(number)st"
        case 2: return "\(number)nd"
        case 3: return "\(number)rd"
        default: return "\(number)th"
        }
    }

    /// What the list needs today. One unfinished copy per series at most: if an earlier one is
    /// still open it is carried to today (with today's alert), otherwise a fresh copy is created.
    public static func planToday(_ series: [Series], items: [TodoItem], now: Date, calendar: Calendar = .paper) -> RepeatPlan {
        let today = Archive.logicalDayStart(now, calendar: calendar)
        let key = Archive.dayKey(now, calendar: calendar)
        var plan = RepeatPlan()
        for entry in series where entry.lastPlaced != key && isValid(entry.rule) && occurs(entry.rule, on: today, calendar: calendar) {
            let reminderAt = entry.remindAt.flatMap { alert(on: today, at: $0, calendar: calendar) }
            if let open = items.first(where: { $0.seriesID == entry.id && !$0.isCompleted }) {
                plan.roll.append(RepeatRoll(id: open.id, reminderAt: reminderAt))
            } else {
                let stamp = Date(timeIntervalSince1970: now.timeIntervalSince1970.rounded(.down))
                plan.create.append(TodoItem(title: entry.title, createdAt: stamp, reminderAt: reminderAt, seriesID: entry.id))
            }
            plan.placed.append(entry.id)
        }
        return plan
    }
}
