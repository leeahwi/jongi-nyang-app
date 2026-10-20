import Foundation

/// An event kept by the app itself, in events.json next to todos.json (so a shared folder shares it).
/// It may repeat; `occurrences` turns it into the dated CalendarEvents the strip, alerts and the
/// 달력 window show. Same file format, rules and test cases as the Windows app (events.ts).
public struct LocalEvent: Codable, Equatable, Identifiable, Sendable {
    public enum Repeat: String, Codable, CaseIterable, Sendable {
        case none, daily, weekly, monthly, yearly

        public var title: String { title(.ko) }

        /// en "Never", "Every day", "Every week", "Every month", "Every year"; nl "Nooit", "Elke dag", "Elke week", "Elke maand", "Elk jaar".
        public func title(_ language: AppLanguage) -> String {
            let titles: [String] = switch language {
            case .ko: ["안 함", "매일", "매주", "매월", "매년"]
            case .en: ["Never", "Every day", "Every week", "Every month", "Every year"]
            case .nl: ["Nooit", "Elke dag", "Elke week", "Elke maand", "Elk jaar"]
            }
            return titles[Self.allCases.firstIndex(of: self)!]
        }
    }

    public enum Color: String, Codable, CaseIterable, Sendable {
        case blue, sage, coral, purple, yellow, gray

        public var hex: String {
            switch self {
            case .blue: "#5b8bd0"
            case .sage: "#6b8f71"
            case .coral: "#d9765f"
            case .purple: "#8e7cc3"
            case .yellow: "#d4a72c"
            case .gray: "#8a8a8a"
            }
        }

        public var title: String { title(.ko) }

        /// en "Blue", "Green", "Orange", "Purple", "Yellow", "Gray"; nl "Blauw", "Groen", "Oranje", "Paars", "Geel", "Grijs".
        public func title(_ language: AppLanguage) -> String {
            let titles: [String] = switch language {
            case .ko: ["파랑", "초록", "주황", "보라", "노랑", "회색"]
            case .en: ["Blue", "Green", "Orange", "Purple", "Yellow", "Gray"]
            case .nl: ["Blauw", "Groen", "Oranje", "Paars", "Geel", "Grijs"]
            }
            return titles[Self.allCases.firstIndex(of: self)!]
        }
    }

    public var id: String
    public var title: String
    /// The first day, "yyyy-MM-dd".
    public var date: String
    public var allDay: Bool
    /// All-day: how many days (at least 1).
    public var days: Int
    /// Timed: minutes after midnight; an end at or before the start is on the next day.
    public var start: Int
    public var end: Int
    public var repeatRule: Repeat
    /// Days taken out of a repeating event (‘이 날만 지우기’).
    public var skip: [String]
    public var color: Color
    public var location: String?
    /// Put on the calendar from this to-do.
    public var taskId: String?
    public var createdAt: Date
    public var updatedAt: Date

    public init(id: String, title: String, date: String, allDay: Bool = false, days: Int = 1, start: Int = 0, end: Int = 60,
                repeatRule: Repeat = .none, skip: [String] = [], color: Color = .blue, location: String? = nil, taskId: String? = nil,
                createdAt: Date = Date(), updatedAt: Date = Date()) {
        self.id = id; self.title = title; self.date = date; self.allDay = allDay; self.days = days; self.start = start; self.end = end
        self.repeatRule = repeatRule; self.skip = skip; self.color = color; self.location = location; self.taskId = taskId
        self.createdAt = createdAt; self.updatedAt = updatedAt
    }

    private enum CodingKeys: String, CodingKey {
        case id, title, date, allDay, days, start, end, skip, color, location, taskId, createdAt, updatedAt
        case repeatRule = "repeat"
    }

    /// Unknown repeat or colour values read as none and blue.
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        title = try c.decode(String.self, forKey: .title)
        date = try c.decode(String.self, forKey: .date)
        allDay = try c.decodeIfPresent(Bool.self, forKey: .allDay) ?? false
        days = max(1, try c.decodeIfPresent(Int.self, forKey: .days) ?? 1)
        start = try c.decodeIfPresent(Int.self, forKey: .start) ?? 0
        end = try c.decodeIfPresent(Int.self, forKey: .end) ?? 60
        repeatRule = (try c.decodeIfPresent(String.self, forKey: .repeatRule)).flatMap(Repeat.init(rawValue:)) ?? .none
        skip = try c.decodeIfPresent([String].self, forKey: .skip) ?? []
        color = (try c.decodeIfPresent(String.self, forKey: .color)).flatMap(Color.init(rawValue:)) ?? .blue
        location = try c.decodeIfPresent(String.self, forKey: .location)
        taskId = try c.decodeIfPresent(String.self, forKey: .taskId)
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt) ?? Date()
        updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt) ?? createdAt
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(title, forKey: .title)
        try c.encode(date, forKey: .date)
        try c.encode(allDay, forKey: .allDay)
        try c.encode(days, forKey: .days)
        try c.encode(start, forKey: .start)
        try c.encode(end, forKey: .end)
        try c.encode(repeatRule.rawValue, forKey: .repeatRule)
        try c.encode(skip, forKey: .skip)
        try c.encode(color.rawValue, forKey: .color)
        try c.encodeIfPresent(location, forKey: .location)
        try c.encodeIfPresent(taskId, forKey: .taskId)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(updatedAt, forKey: .updatedAt)
    }

    /// events.json
    public struct File: Codable, Equatable, Sendable {
        public var events: [LocalEvent]
        public init(events: [LocalEvent]) { self.events = events }
    }

    // MARK: Occurrences

    /// What an event without a title is called: "(제목 없음)", "(No title)", "(Geen titel)".
    public static func untitled(_ language: AppLanguage = .ko) -> String {
        ["(제목 없음)", "(No title)", "(Geen titel)"][language.index]
    }

    /// The dated events of this one that overlap [from, to): each repeat (minus skipped days),
    /// including ones that began earlier and run into the range.
    public func occurrences(from: Date, to: Date, calendar: Calendar = .paper, language: AppLanguage = .ko) -> [CalendarEvent] {
        guard let first = CalendarDraft.localDay(date, calendar: calendar) else { return [] }
        // Long enough back for an overnight or several-day event that began before the range.
        let reach = allDay ? max(1, days) : 1
        let earliest = calendar.date(byAdding: .day, value: -reach, to: calendar.startOfDay(for: from))!
        var found: [CalendarEvent] = []
        for day in days(from: first, earliest: earliest, before: to, calendar: calendar) {
            let key = CalendarDraft.day(day, calendar: calendar)
            guard !skip.contains(key) else { continue }
            let (begin, finish) = span(on: day, calendar: calendar)
            guard begin < to && (finish > from || (begin == finish && begin >= from)) else { continue }
            let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
            found.append(CalendarEvent(key: "local/\(id)@\(key)", calendarId: "local", title: name.isEmpty ? Self.untitled(language) : name,
                                       allDay: allDay, start: begin, end: finish, location: location, link: nil, color: color.hex,
                                       eventId: id, canEdit: true, recurring: repeatRule != .none, taskId: taskId))
        }
        return found
    }

    /// Every event's occurrences in [from, to), by start (then title).
    public static func expand(_ events: [LocalEvent], from: Date, to: Date, calendar: Calendar = .paper, language: AppLanguage = .ko) -> [CalendarEvent] {
        events.flatMap { $0.occurrences(from: from, to: to, calendar: calendar, language: language) }
            .sorted { $0.start != $1.start ? $0.start < $1.start : $0.title < $1.title }
    }

    /// The day an occurrence belongs to, from its key ("local/<id>@yyyy-MM-dd").
    public static func occurrenceDay(_ event: CalendarEvent) -> String? {
        event.key.split(separator: "@").last.map(String.init)
    }

    private func span(on day: Date, calendar: Calendar) -> (Date, Date) {
        if allDay { return (day, calendar.date(byAdding: .day, value: max(1, days), to: day)!) }
        let begin = calendar.date(byAdding: .minute, value: start, to: day)!
        let endDay = end <= start ? calendar.date(byAdding: .day, value: 1, to: day)! : day
        return (begin, calendar.date(byAdding: .minute, value: end, to: endDay)!)
    }

    /// The repeat's days from `earliest` (never before the first) up to `before`.
    private func days(from first: Date, earliest: Date, before end: Date, calendar: Calendar) -> [Date] {
        guard first < end else { return [] }
        if repeatRule == .none { return first >= earliest ? [first] : [] }
        let parts = calendar.dateComponents([.year, .month, .day], from: first)
        var result: [Date] = []
        var index = 0
        // Jump close to `earliest` instead of walking from the first day.
        if earliest > first {
            let gap = calendar.dateComponents([.month, .year], from: first, to: earliest)
            switch repeatRule {
            case .daily: index = max(0, Int((earliest.timeIntervalSince(first) / 86_400).rounded(.down)) - 1)
            case .weekly: index = max(0, Int((earliest.timeIntervalSince(first) / 86_400 / 7).rounded(.down)) - 1)
            case .monthly: index = max(0, (gap.year ?? 0) * 12 + (gap.month ?? 0) - 1)
            case .yearly: index = max(0, (gap.year ?? 0) - 1)
            case .none: break
            }
        }
        while result.count < 400 {
            let day: Date?
            switch repeatRule {
            case .daily: day = calendar.date(byAdding: .day, value: index, to: first)
            case .weekly: day = calendar.date(byAdding: .day, value: 7 * index, to: first)
            case .monthly:
                var p = parts
                p.month = parts.month! + index
                day = Self.exact(p, calendar: calendar)
            case .yearly:
                var p = parts
                p.year = parts.year! + index
                day = Self.exact(p, calendar: calendar)
            case .none: day = nil
            }
            index += 1
            guard index < 100_000 else { break }
            guard let day else { continue }
            if day >= end { break }
            if day >= earliest { result.append(day) }
        }
        return result
    }

    /// The date only if that day exists (no 31 April, no 29 February outside leap years).
    private static func exact(_ parts: DateComponents, calendar: Calendar) -> Date? {
        guard let date = calendar.date(from: parts) else { return nil }
        let check = calendar.dateComponents([.month, .day], from: date)
        let month = ((parts.month! - 1) % 12 + 12) % 12 + 1
        return check.day == parts.day && check.month == month ? date : nil
    }
}
