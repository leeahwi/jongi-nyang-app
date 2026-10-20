import Foundation

/// 시계 알람: a clock time that rings on chosen weekdays (or once), kept in alarms.json next to
/// todos.json (so a shared folder shares it). Each device rings its own; what this device has
/// rung is kept per device (`handled`). Same file format, rules and test cases as the Windows
/// app (alarms.ts).
public struct Alarm: Codable, Equatable, Identifiable, Sendable {
    public enum Sound: String, Codable, CaseIterable, Sendable {
        case bell, soft, silent

        /// "종소리", "부드럽게", "소리 없음" — en "Bell", "Soft", "Silent"; nl "Bel", "Zacht", "Stil".
        public func title(_ language: AppLanguage = .ko) -> String {
            let titles: [String] = switch language {
            case .ko: ["종소리", "부드럽게", "소리 없음"]
            case .en: ["Bell", "Soft", "Silent"]
            case .nl: ["Bel", "Zacht", "Stil"]
            }
            return titles[Self.allCases.firstIndex(of: self)!]
        }
    }

    /// Minutes until a snoozed alarm rings again (the ring's chips).
    public static let snoozeChoices = [5, 10, 15]
    /// What the editor offers (1.39): 0 = no snooze (없음 · Off · Uit), then the lengths.
    public static let snoozeOptions = [0] + snoozeChoices
    /// It can be snoozed (`snooze` isn't 0).
    public var snoozes: Bool { snooze > 0 }
    /// A ring missed by longer than this (the Mac was asleep, the app wasn't running) is skipped.
    public static let lateLimit: TimeInterval = 15 * 60

    public var id: String
    /// "HH:mm", local time.
    public var time: String
    public var label: String
    /// 0 = Sunday … 6 = Saturday; empty = once.
    public var days: [Int]
    public var enabled: Bool
    public var sound: Sound
    /// 5, 10 or 15.
    public var snooze: Int
    public var createdAt: Date
    public var updatedAt: Date

    public init(id: String = UUID().uuidString, time: String = "07:00", label: String = "", days: [Int] = [1, 2, 3, 4, 5],
                enabled: Bool = true, sound: Sound = .bell, snooze: Int = 10, createdAt: Date = Date(), updatedAt: Date? = nil) {
        self.id = id
        self.time = Self.normalTime(time) ?? time
        self.label = label
        self.days = Self.cleanDays(days)
        self.enabled = enabled
        self.sound = sound
        self.snooze = Self.snoozeOptions.contains(snooze) ? snooze : 10
        self.createdAt = Self.wholeSeconds(createdAt)
        self.updatedAt = Self.wholeSeconds(updatedAt ?? createdAt)
    }

    /// `+ 알람 추가`: 07:00 on weekdays, on.
    public static func new(now: Date) -> Alarm { Alarm(createdAt: now) }

    private enum CodingKeys: String, CodingKey {
        case id, time, label, days, enabled, sound, snooze, createdAt, updatedAt
    }

    /// Missing or unreadable keys get their defaults: label "", days none (once), on, the bell
    /// (also for an unknown sound), a 10-minute snooze (also for one other than 0 · 5 · 10 · 15; 0 = none, 1.39),
    /// createdAt from updatedAt (else 1970-01-01), updatedAt from createdAt; fractional seconds
    /// are dropped. Without an id or a readable time ("7:05" reads as "07:05") it isn't an alarm.
    /// Same rules as the Windows app (alarm.ts: readAlarm).
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        guard let id = try? c.decode(String.self, forKey: .id), !id.isEmpty,
              let time = (try? c.decode(String.self, forKey: .time)).flatMap(Self.normalTime) else {
            throw DecodingError.dataCorrupted(.init(codingPath: c.codingPath, debugDescription: "An alarm needs an id and a time"))
        }
        self.id = id
        self.time = time
        label = (try? c.decode(String.self, forKey: .label)) ?? ""
        days = Self.cleanDays(((try? c.decode([Lenient].self, forKey: .days)) ?? []).compactMap(\.int))
        enabled = (try? c.decode(Bool.self, forKey: .enabled)) ?? true
        sound = (try? c.decode(String.self, forKey: .sound)).flatMap(Sound.init(rawValue:)) ?? .bell
        let snooze = (try? c.decode(Int.self, forKey: .snooze)) ?? 10
        self.snooze = Self.snoozeOptions.contains(snooze) ? snooze : 10
        let created = (try? c.decode(String.self, forKey: .createdAt)).flatMap(Self.stamp)
        let updated = (try? c.decode(String.self, forKey: .updatedAt)).flatMap(Self.stamp)
        createdAt = created ?? updated ?? Date(timeIntervalSince1970: 0)
        updatedAt = updated ?? createdAt
    }

    /// A value in `days` that may not be a number.
    private struct Lenient: Decodable {
        let int: Int?
        init(from decoder: Decoder) throws {
            let c = try decoder.singleValueContainer()
            int = try? c.decode(Int.self)
        }
    }

    /// "7:5" no, "7:05" and "07:05" → "07:05".
    public static func normalTime(_ value: String) -> String? {
        let parts = value.trimmingCharacters(in: .whitespaces).split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, (1...2).contains(parts[0].count), parts[1].count == 2,
              parts.allSatisfy({ $0.allSatisfy { ("0"..."9").contains($0) } }),
              let hour = Int(parts[0]), let minute = Int(parts[1]), hour < 24, minute < 60 else { return nil }
        return time(hour: hour, minute: minute)
    }

    /// "2026-10-08T05:00:00Z" or "…00.123Z" → the whole second; anything else nil.
    static func stamp(_ text: String) -> Date? {
        guard text.range(of: #"^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?Z$"#, options: .regularExpression) != nil else { return nil }
        let whole = text.replacingOccurrences(of: #"\.[0-9]+Z$"#, with: "Z", options: .regularExpression)
        return ISO8601DateFormatter().date(from: whole)
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(id, forKey: .id)
        try c.encode(time, forKey: .time)
        try c.encode(label, forKey: .label)
        try c.encode(days, forKey: .days)
        try c.encode(enabled, forKey: .enabled)
        try c.encode(sound.rawValue, forKey: .sound)
        try c.encode(snooze, forKey: .snooze)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(updatedAt, forKey: .updatedAt)
    }

    /// alarms.json: `{ "alarms": [ … ] }`.
    public struct File: Codable, Equatable, Sendable {
        public var alarms: [Alarm]
        public init(alarms: [Alarm]) { self.alarms = alarms }

        /// Pretty, sorted keys, whole-second ISO 8601 dates ("2026-10-08T05:00:00Z"), a newline at the end.
        public func encoded() throws -> Data {
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            return try encoder.encode(self) + Data("\n".utf8)
        }

        /// alarms.json read: throws when it isn't `{ "alarms": [...] }` (the app keeps such a file
        /// aside); broken entries and repeated ids are skipped (alarm.ts: parseAlarms).
        public static func decode(_ data: Data) throws -> File {
            let entries = try JSONDecoder().decode(Entries.self, from: data).alarms
            var seen = Set<String>()
            return File(alarms: entries.compactMap { $0.alarm }.filter { seen.insert($0.id).inserted })
        }

        private struct Entries: Decodable { var alarms: [Entry] }

        private struct Entry: Decodable {
            let alarm: Alarm?
            init(from decoder: Decoder) throws { alarm = try? Alarm(from: decoder) }
        }
    }

    // MARK: The time

    /// (hour, minute) from "HH:mm", or nil when it isn't a clock time.
    public var clock: (hour: Int, minute: Int)? {
        guard let normal = Self.normalTime(time) else { return nil }
        return (Int(normal.prefix(2))!, Int(normal.suffix(2))!)
    }

    /// "07:05" from an hour and a minute.
    public static func time(hour: Int, minute: Int) -> String { String(format: "%02d:%02d", hour, minute) }

    public var isOnce: Bool { days.isEmpty }

    // MARK: When it rings

    /// "<id>@yyyy-MM-ddTHH:mm" (local time): one ring of one alarm, for the handled set.
    public static func key(_ alarm: Alarm, _ fire: Date, calendar: Calendar = .paper) -> String {
        let p = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: fire)
        return "\(alarm.id)@" + String(format: "%04d-%02d-%02dT%02d:%02d", p.year!, p.month!, p.day!, p.hour!, p.minute!)
    }

    /// The next time it rings: the first allowed day's time at or after `now` (strictly after, when
    /// `now` is exactly a ring this device already handled). Once-alarms: today if still ahead,
    /// else tomorrow. Off (or an unreadable time) → nil.
    public static func nextFire(_ alarm: Alarm, now: Date, handled: Set<String> = [], calendar: Calendar = .paper) -> Date? {
        guard alarm.enabled, let clock = alarm.clock else { return nil }
        let today = calendar.startOfDay(for: now)
        for offset in 0...7 {
            guard let day = calendar.date(byAdding: .day, value: offset, to: today),
                  let fire = calendar.date(bySettingHour: clock.hour, minute: clock.minute, second: 0, of: day) else { continue }
            if !alarm.isOnce, !alarm.days.contains(calendar.component(.weekday, from: day) - 1) { continue }
            if fire < now || (fire == now && handled.contains(key(alarm, fire, calendar: calendar))) { continue }
            return fire
        }
        return nil
    }

    /// The latest time at or before `now` that it was meant to ring (once-alarms: any day).
    public static func lastFire(_ alarm: Alarm, now: Date, calendar: Calendar = .paper) -> Date? {
        guard let clock = alarm.clock else { return nil }
        let today = calendar.startOfDay(for: now)
        for offset in 0...7 {
            guard let day = calendar.date(byAdding: .day, value: -offset, to: today),
                  let fire = calendar.date(bySettingHour: clock.hour, minute: clock.minute, second: 0, of: day) else { continue }
            if !alarm.isOnce, !alarm.days.contains(calendar.component(.weekday, from: day) - 1) { continue }
            if fire <= now { return fire }
        }
        return nil
    }

    /// The alarms to ring now: on, their latest ring f with `now - 15 min < f ≤ now`, not before
    /// the alarm was last changed (one set at 7:05 for 7:00 waits for tomorrow), and `key(alarm, f)`
    /// not handled here yet. Rings missed by more (the Mac asleep) are skipped.
    public static func due(_ alarms: [Alarm], now: Date, handled: Set<String>, calendar: Calendar = .paper) -> [Alarm] {
        alarms.filter { alarm in
            guard alarm.enabled, let fire = lastFire(alarm, now: now, calendar: calendar) else { return false }
            return now.timeIntervalSince(fire) < lateLimit && fire >= alarm.updatedAt
                && !handled.contains(key(alarm, fire, calendar: calendar))
        }
    }

    /// The handled keys worth keeping: rings since the start of the day three days ago.
    public static func recentHandled(_ handled: Set<String>, now: Date, calendar: Calendar = .paper) -> Set<String> {
        let cutoff = calendar.date(byAdding: .day, value: -3, to: calendar.startOfDay(for: now))!
        return handled.filter { key in
            guard let stamp = key.split(separator: "@").last else { return false }
            let parts = stamp.split(whereSeparator: { "-T:".contains($0) }).compactMap { Int($0) }
            guard parts.count == 5, let date = calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: parts[3], minute: parts[4])) else { return false }
            return date >= cutoff
        }
    }

    /// The soonest ring of all the alarms that are on.
    public static func next(_ alarms: [Alarm], now: Date, handled: Set<String> = [], calendar: Calendar = .paper) -> (alarm: Alarm, fire: Date)? {
        alarms.compactMap { alarm in nextFire(alarm, now: now, handled: handled, calendar: calendar).map { (alarm, $0) } }
            .min { $0.1 < $1.1 }
    }

    // MARK: Text

    /// ko `한 번` · `매일` · `평일` · `주말` · `월·수·금`; en `Once` · `Every day` · `Weekdays` ·
    /// `Weekends` · `Mon, Wed, Fri`; nl `Eenmalig` · `Elke dag` · `Doordeweeks` · `Weekend` ·
    /// `ma, wo, vr` (Dutch weeks from Monday, so Sunday comes last).
    public static func daysText(_ days: [Int], language: AppLanguage = .ko) -> String {
        let set = Set(cleanDays(days))
        let words: [String] = switch language {
        case .ko: ["한 번", "매일", "평일", "주말"]
        case .en: ["Once", "Every day", "Weekdays", "Weekends"]
        case .nl: ["Eenmalig", "Elke dag", "Doordeweeks", "Weekend"]
        }
        if set.isEmpty { return words[0] }
        if set.count == 7 { return words[1] }
        if set == [1, 2, 3, 4, 5] { return words[2] }
        if set == [0, 6] { return words[3] }
        let names = language.weekdayOrder.filter(set.contains).map(language.weekdayShort)
        return names.joined(separator: language == .ko ? "·" : ", ")
    }

    /// ko `오전 7:00` · `오후 7:30`, en `7:00 AM`, nl `07:00`.
    public static func timeText(_ alarm: Alarm, language: AppLanguage = .ko) -> String {
        guard let clock = alarm.clock else { return alarm.time }
        return language.spokenTime(hour: clock.hour, minute: clock.minute)
    }

    /// The big time on the ring window and the list: ko and nl `07:00`, en `7:00 AM`.
    public static func clockText(_ alarm: Alarm, language: AppLanguage = .ko) -> String {
        guard let clock = alarm.clock else { return alarm.time }
        return language.clock(hour: clock.hour, minute: clock.minute)
    }

    /// When it rings, from now: ko `7시간 30분 뒤에 울려요` · `25분 뒤에 울려요`, en `Rings in 7 h 30 min` ·
    /// `Rings in 25 min`, nl `Gaat over 7 u 30 min` · `Gaat over 25 min`; a day or more away with
    /// the day: ko `내일 오전 7:00에 울려요` · `월요일 오전 7:00에 울려요`, en `Rings tomorrow at 7:00 AM` ·
    /// `Rings Mon at 7:00 AM`, nl `Gaat morgen om 07:00` · `Gaat ma om 07:00`.
    public static func untilText(_ next: Date, now: Date, language: AppLanguage = .ko, calendar: Calendar = .paper) -> String {
        let minutes = max(1, Int((next.timeIntervalSince(now) / 60).rounded(.up)))
        if minutes >= 24 * 60 {
            let p = calendar.dateComponents([.hour, .minute, .weekday], from: next)
            let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: next)).day ?? 0
            let at = language.spokenTime(hour: p.hour!, minute: p.minute!)
            let weekday = p.weekday! - 1
            switch language {
            case .ko: return "\(days == 1 ? "내일" : language.weekdayName(weekday)) \(at)에 울려요"
            case .en: return "Rings \(days == 1 ? "tomorrow" : language.weekdayShort(weekday)) at \(at)"
            case .nl: return "Gaat \(days == 1 ? "morgen" : language.weekdayShort(weekday)) om \(at)"
            }
        }
        let hours = minutes / 60, rest = minutes % 60
        let span: String
        switch language {
        case .ko: span = [hours > 0 ? "\(hours)시간" : nil, rest > 0 ? "\(rest)분" : nil].compactMap { $0 }.joined(separator: " ")
        case .en: span = [hours > 0 ? "\(hours) h" : nil, rest > 0 ? "\(rest) min" : nil].compactMap { $0 }.joined(separator: " ")
        case .nl: span = [hours > 0 ? "\(hours) u" : nil, rest > 0 ? "\(rest) min" : nil].compactMap { $0 }.joined(separator: " ")
        }
        switch language {
        case .ko: return "\(span) 뒤에 울려요"
        case .en: return "Rings in \(span)"
        case .nl: return "Gaat over \(span)"
        }
    }

    /// The name on the ring window when it has no label: "알람", "Alarm", "Wekker".
    public static func untitled(_ language: AppLanguage = .ko) -> String {
        ["알람", "Alarm", "Wekker"][language.index]
    }

    // MARK: Helpers

    static func cleanDays(_ days: [Int]) -> [Int] { Array(Set(days.filter { (0...6).contains($0) })).sorted() }

    static func wholeSeconds(_ date: Date) -> Date { Date(timeIntervalSince1970: date.timeIntervalSince1970.rounded(.down)) }
}
