import Foundation

/// A finished task as kept in the record: one JSON line per task, one file per month.
/// Same format as the Windows app, so the `archive` folder can move between them.
public struct ArchiveEntry: Codable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var createdAt: Date
    public var completedAt: Date?
    /// The task's time range (1.39), kept as it was: "HH:mm", omitted when there was none.
    public var timeStart: String?
    public var timeEnd: String?

    public init(id: String, title: String, createdAt: Date, completedAt: Date?, timeStart: String? = nil, timeEnd: String? = nil) {
        self.id = id
        self.title = title
        self.createdAt = createdAt
        self.completedAt = completedAt
        self.timeStart = timeStart
        self.timeEnd = timeEnd
    }

    public init(_ item: TodoItem) {
        self.init(id: item.id.uuidString, title: item.title, createdAt: item.createdAt, completedAt: item.completedAt,
                  timeStart: item.timeStart, timeEnd: item.timeEnd)
    }
}

public enum ArchiveAfterDays: Int, CaseIterable, Identifiable, Sendable {
    case nextDay = 1, threeDays = 3, week = 7, never = 0

    public var id: Int { rawValue }
    public var title: String { title(.ko) }

    /// "다음 날", "3일 뒤", "7일 뒤", "보관 안 함" — en "Next day", "After 3 days", "After 7 days", "Never";
    /// nl "Volgende dag", "Na 3 dagen", "Na 7 dagen", "Nooit".
    public func title(_ language: AppLanguage) -> String {
        let titles: [String] = switch language {
        case .ko: ["다음 날", "3일 뒤", "7일 뒤", "보관 안 함"]
        case .en: ["Next day", "After 3 days", "After 7 days", "Never"]
        case .nl: ["Volgende dag", "Na 3 dagen", "Na 7 dagen", "Nooit"]
        }
        return titles[Self.allCases.firstIndex(of: self)!]
    }
}

extension Calendar {
    /// Day keys ("2026-09-29") are shared with the Windows app, so they are always Gregorian,
    /// whatever calendar the Mac is set to, in the Mac's own time zone.
    public static var paper: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar
    }
}

public enum Archive {
    /// A "day" ends at 4 a.m., so something finished just after midnight still counts as tonight's work.
    public static let dayBoundaryHour = 4

    public static func logicalDayStart(_ date: Date, calendar: Calendar = .paper) -> Date {
        let midnight = calendar.startOfDay(for: date)
        let start = calendar.date(byAdding: .hour, value: dayBoundaryHour, to: midnight)!
        return date < start ? calendar.date(byAdding: .day, value: -1, to: start)! : start
    }

    /// Completed tasks whose day ended at least `days` days ago. With "다음 날", today's finished
    /// work stays visible until the next 4 a.m. Tasks finished before completion times were
    /// recorded have no date, so they are archived at the first opportunity.
    public static func due(_ items: [TodoItem], now: Date, after days: ArchiveAfterDays, calendar: Calendar = .paper) -> [TodoItem] {
        guard days != .never else { return [] }
        let cutoff = calendar.date(byAdding: .day, value: -(days.rawValue - 1), to: logicalDayStart(now, calendar: calendar))!
        return items.filter { $0.isCompleted && ($0.completedAt.map { $0 < cutoff } ?? true) }
    }

    /// "2026-09-28", using the same 4 a.m. boundary as archiving.
    public static func dayKey(_ date: Date, calendar: Calendar = .paper) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: logicalDayStart(date, calendar: calendar))
        let year = parts.year!, month = parts.month!, day = parts.day!
        guard (0...9999).contains(year) else { return String(format: "%04d-%02d-%02d", year, month, day) }
        // "%04d-%02d-%02d" by hand (#62: String(format:) was half of a key, and 완료 기록 makes thousands).
        var bytes: [UInt8] = [48, 48, 48, 48, 45, 48, 48, 45, 48, 48]
        func put(_ value: Int, at end: Int, digits: Int) {
            var value = value
            for index in stride(from: end, to: end - digits, by: -1) {
                bytes[index] = UInt8(48 + value % 10)
                value /= 10
            }
        }
        put(year, at: 3, digits: 4)
        put(month, at: 6, digits: 2)
        put(day, at: 9, digits: 2)
        return String(decoding: bytes, as: UTF8.self)
    }

    /// The monthly file an entry belongs to; undated entries share one file.
    public static func monthKey(_ entry: ArchiveEntry, calendar: Calendar = .paper) -> String {
        guard let completedAt = entry.completedAt else { return "undated" }
        let parts = calendar.dateComponents([.year, .month], from: completedAt)
        return String(format: "%04d-%02d", parts.year!, parts.month!)
    }

    public static func encodeLine(_ entry: ArchiveEntry) -> String {
        String(decoding: try! lineEncoder.encode(entry), as: UTF8.self)
    }

    /// Unreadable lines (a torn last line after power loss) are skipped, not fatal.
    public static func parseLines(_ text: String) -> [ArchiveEntry] {
        text.split(whereSeparator: \.isNewline).compactMap { line in
            try? lineDecoder.decode(ArchiveEntry.self, from: Data(line.utf8))
        }
    }

    // MARK: Statistics for the history calendar

    /// Completions grouped by day; the same task is counted once even if it appears twice.
    public static func groupByDay(_ entries: [ArchiveEntry], calendar: Calendar = .paper) -> [String: [ArchiveEntry]] {
        var seen = Set<String>()
        var days: [String: [ArchiveEntry]] = [:]
        for entry in entries {
            guard let completedAt = entry.completedAt, seen.insert(entry.id).inserted else { continue }
            days[dayKey(completedAt, calendar: calendar), default: []].append(entry)
        }
        for key in days.keys { days[key]!.sort { $0.completedAt! < $1.completedAt! } }
        return days
    }

    /// Fixed thresholds read the same every month: 1 · 2–3 · 4–5 · 6+.
    public static func heatLevel(_ count: Int) -> Int {
        switch count {
        case ...0: 0
        case 1: 1
        case 2...3: 2
        case 4...5: 3
        default: 4
        }
    }

    public static let heatLevelTitles = ["없음", "1개", "2–3개", "4–5개", "6개 이상"]

    /// The history calendar's legend: en "None", "1", "2–3", "4–5", "6 or more"; nl "Geen", "1", "2–3", "4–5", "6 of meer".
    public static func heatLevelTitles(_ language: AppLanguage) -> [String] {
        switch language {
        case .ko: heatLevelTitles
        case .en: ["None", "1", "2–3", "4–5", "6 or more"]
        case .nl: ["Geen", "1", "2–3", "4–5", "6 of meer"]
        }
    }

    /// What the pet says for the Sunday look-back: "이번 주 5개 끝냈어요. 수고했어요!" — en "You finished 5 to-dos
    /// this week. Nice work!"; nl "Je hebt deze week 5 taken afgerond. Goed gedaan!" (Windows: lookbackMessage).
    public static func lookBackMessage(_ count: Int, language: AppLanguage = .ko) -> String {
        switch language {
        case .ko: "이번 주 \(count)개 끝냈어요. 수고했어요!"
        case .en: "You finished \(language.todos(count)) this week. Nice work!"
        case .nl: "Je hebt deze week \(language.todos(count)) afgerond. Goed gedaan!"
        }
    }

    /// Consecutive days with a completion ending today — or yesterday, so a streak isn't "lost" before today's first check.
    /// The Monday (logical day) that starts the week `now` is in, as a day key.
    public static func weekKey(_ now: Date, calendar: Calendar = .paper) -> String {
        let today = logicalDayStart(now, calendar: calendar)
        let weekday = calendar.component(.weekday, from: today) // 1 = Sunday
        return dayKey(calendar.date(byAdding: .day, value: -((weekday + 5) % 7), to: today)!, calendar: calendar)
    }

    /// Sunday from 18:00 (the logical day), and not yet shown this week: the look-back's time, before the record is read.
    public static func isLookBackTime(now: Date, lastShownWeek: String?, calendar: Calendar = .paper) -> Bool {
        let today = logicalDayStart(now, calendar: calendar)
        return calendar.component(.weekday, from: today) == 1
            && (calendar.component(.hour, from: now) >= 18 || now >= calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: today))!)
            && weekKey(now, calendar: calendar) != lastShownWeek
    }

    /// The Sunday-evening look-back: is it time (Sunday from 18:00, not yet shown this week), and
    /// how many tasks were finished Monday–Sunday. nil when there's nothing to say.
    public static func weeklyLookBack(_ entries: [ArchiveEntry], now: Date, lastShownWeek: String?, calendar: Calendar = .paper) -> Int? {
        guard isLookBackTime(now: now, lastShownWeek: lastShownWeek, calendar: calendar) else { return nil }
        let week = weekKey(now, calendar: calendar)
        let count = entries.filter { entry in
            guard let completed = entry.completedAt, completed <= now else { return false }
            let key = dayKey(completed, calendar: calendar)
            return key >= week && key <= dayKey(now, calendar: calendar)
        }.count
        return count > 0 ? count : nil
    }

    public static func currentStreak(_ days: Set<String>, today: Date, calendar: Calendar = .paper) -> Int {
        var cursor = logicalDayStart(today, calendar: calendar)
        if !days.contains(dayKey(cursor, calendar: calendar)) { cursor = calendar.date(byAdding: .day, value: -1, to: cursor)! }
        var streak = 0
        while days.contains(dayKey(cursor, calendar: calendar)) {
            streak += 1
            cursor = calendar.date(byAdding: .day, value: -1, to: cursor)!
        }
        return streak
    }

    /// The day a streak reaches 7, 30 or 100 days (#42): that count, for the cat's one cheer — nil before today's first
    /// completion, for any other count, or once it was said today (`saidOn`, the day key it was said on). A streak that
    /// breaks says nothing.
    public static func streakMilestone(_ days: Set<String>, today: Date, saidOn: String?, calendar: Calendar = .paper) -> Int? {
        let key = dayKey(logicalDayStart(today, calendar: calendar), calendar: calendar)
        guard days.contains(key), saidOn != key else { return nil }
        let streak = currentStreak(days, today: today, calendar: calendar)
        return [7, 30, 100].contains(streak) ? streak : nil // PetChatter.milestoneDays (Archive is built without it in some checks)
    }

    public static func longestStreak(_ days: Set<String>) -> Int {
        // Day numbers from the keys themselves (#62: a DateFormatter read each key, 30–60 ms for three years); a key
        // that isn't "yyyy-MM-dd" in digits still goes through the formatter.
        var formatter: DateFormatter?
        let numbers = days.compactMap { key -> Int? in
            if let number = dayNumber(key) { return number }
            if formatter == nil {
                let made = DateFormatter()
                made.calendar = Calendar(identifier: .gregorian)
                made.timeZone = TimeZone(identifier: "UTC")
                made.dateFormat = "yyyy-MM-dd"
                formatter = made
            }
            return formatter!.date(from: key).map { Int(($0.timeIntervalSince1970 / 86_400).rounded(.down)) }
        }
        var best = 0, run = 0
        var previous: Int?
        for number in numbers.sorted() {
            run = previous.map { number - $0 == 1 } == true ? run + 1 : 1
            best = max(best, run)
            previous = number
        }
        return best
    }

    /// Days since 1970-01-01 for "yyyy-MM-dd" (proleptic Gregorian, as the formatter reads it); nil for anything else.
    static func dayNumber(_ key: String) -> Int? {
        let b = Array(key.utf8)
        guard b.count == 10, b[4] == 45, b[7] == 45 else { return nil }
        func number(_ from: Int, _ count: Int) -> Int? {
            var value = 0
            for byte in b[from..<(from + count)] {
                guard (48...57).contains(byte) else { return nil }
                value = value * 10 + Int(byte - 48)
            }
            return value
        }
        // From 1600 on: before the Gregorian calendar's start the formatter counts days its own way.
        guard let year = number(0, 4), year >= 1600, let month = number(5, 2), let day = number(8, 2),
              (1...12).contains(month), day >= 1, day <= daysIn(month: month, year: year) else { return nil }
        // Howard Hinnant's days_from_civil.
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146_097 + doe - 719_468
    }

    private static func daysIn(month: Int, year: Int) -> Int {
        switch month {
        case 2: (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 ? 29 : 28
        case 4, 6, 9, 11: 30
        default: 31
        }
    }

    // Dates are whole-second ISO 8601; fractional seconds (from other writers) are still read.
    private static let lineEncoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }()

    private static let lineDecoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            guard let date = isoDate(text) else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date \(text)"))
            }
            return date
        }
        return decoder
    }()

    /// A record line's date: "2026-10-08T05:00:00Z" (what both apps write) read directly, anything else ISO 8601
    /// (an offset, fractions of a second) through the formatters — made once (1.39: making two formatters for
    /// every date took over a second for 2,000 lines, the first time 검색 or 완료 기록 opened).
    static func isoDate(_ text: String) -> Date? {
        let b = Array(text.utf8)
        func number(_ from: Int, _ count: Int) -> Int? {
            var value = 0
            for i in from..<(from + count) {
                let c = b[i]
                guard c >= 48 && c <= 57 else { return nil }
                value = value * 10 + Int(c - 48)
            }
            return value
        }
        if b.count == 20, b[4] == 45, b[7] == 45, b[10] == 84, b[13] == 58, b[16] == 58, b[19] == 90,
           let year = number(0, 4), let month = number(5, 2), let day = number(8, 2),
           let hour = number(11, 2), let minute = number(14, 2), let second = number(17, 2),
           (1...12).contains(month), (1...31).contains(day), hour < 24, minute < 60, second < 61 {
            var parts = tm()
            parts.tm_year = Int32(year - 1900); parts.tm_mon = Int32(month - 1); parts.tm_mday = Int32(day)
            parts.tm_hour = Int32(hour); parts.tm_min = Int32(minute); parts.tm_sec = Int32(second)
            // An impossible day (02-31) rolls over, as the formatter reads it.
            return Date(timeIntervalSince1970: TimeInterval(timegm(&parts)))
        }
        formatterLock.lock()
        defer { formatterLock.unlock() }
        return plainFormatter.date(from: text) ?? fractionalFormatter.date(from: text)
    }

    private static let formatterLock = NSLock()
    nonisolated(unsafe) private static let plainFormatter = ISO8601DateFormatter()
    nonisolated(unsafe) private static let fractionalFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
