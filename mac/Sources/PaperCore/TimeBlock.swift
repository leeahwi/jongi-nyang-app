import Foundation

/// 할 일 시간 정하기 (1.39): a to-do's time on its day — a start and an end ("14:00–15:30"), or a start
/// alone (drawn as 30 minutes). Kept on the task as `timeStart` / `timeEnd` ("HH:mm"), omitted when there is
/// none. The day is the task's deadline, or today while it sits on today's sheet. Same rules and cases as the
/// Windows app (timeblock.ts; the shared cases are in timeblock-cases.md).
public struct TimeRange: Equatable, Hashable, Sendable {
    /// Minutes after the day's midnight in the app's 4 a.m. day ("logical" minutes, 240…1679): 01:00 that night
    /// is 1500. Written as a clock ("HH:mm").
    public var start: Int
    /// After `start` in the same 4 a.m. day (at most 04:00 the next morning, 1680); nil = a start alone.
    public var end: Int?

    public init(start: Int, end: Int? = nil) {
        self.start = start
        self.end = end
    }

    /// A start alone lasts this long on the ribbon and in the lists' order.
    public static let defaultLength = 30

    /// The end as drawn: the end, or 30 minutes after a start alone (never past 04:00).
    public var drawnEnd: Int { end ?? min(TimeBlock.dayEnd, start + Self.defaultLength) }

    /// "14:00–15:30", "2:00–3:30 PM", "14:00–15:30"; a start alone is just its clock ("14:00"); past midnight as
    /// clocks ("23:00–01:00").
    public func text(_ language: AppLanguage) -> String {
        let from = (start % 1440 / 60, start % 60)
        guard let end else { return language.clock(hour: from.0, minute: from.1) }
        return language.timeRange(from: from, to: (end % 1440 / 60, end % 60))
    }
}

extension TodoItem {
    /// The task's time range, when it has a readable one.
    public var timeRange: TimeRange? {
        get {
            guard let start = timeStart.flatMap(TimeBlock.minutes).map(TimeBlock.logical) else { return nil }
            let end = timeEnd.flatMap(TimeBlock.minutes).map(TimeBlock.logical).flatMap { $0 > start ? $0 : nil }
            return TimeRange(start: start, end: end)
        }
        set {
            timeStart = newValue.map { TimeBlock.text($0.start % 1440) }
            timeEnd = newValue?.end.map { TimeBlock.text($0 % 1440) }
        }
    }

    /// Keeps only what reads: a start that isn't a time drops both; an end that isn't one, or isn't after
    /// the start, is dropped; "9:05" becomes "09:05".
    mutating func normalizeTimeRange() {
        let range = timeRange
        if timeStart != nil || timeEnd != nil { timeRange = range }
    }
}

public enum TimeBlock {
    /// The 4 a.m. day in logical minutes: 04:00 … 04:00 the next morning.
    public static let dayStart = 240
    public static let dayEnd = 1680

    /// A clock's minutes in the 4 a.m. day: before 04:00 it belongs to the night after (01:00 → 1500).
    public static func logical(_ clock: Int) -> Int { clock < dayStart ? clock + 1440 : clock }

    /// "HH:mm" (or "H:mm") → minutes after midnight.
    public static func minutes(_ text: String) -> Int? {
        let parts = text.trimmingCharacters(in: .whitespaces).split(separator: ":", omittingEmptySubsequences: false)
        guard parts.count == 2, (1...2).contains(parts[0].count), parts[1].count == 2,
              parts.allSatisfy({ $0.allSatisfy { ("0"..."9").contains($0) } }),
              let hour = Int(parts[0]), let minute = Int(parts[1]), hour < 24, minute < 60 else { return nil }
        return hour * 60 + minute
    }

    /// Minutes after midnight → "HH:mm".
    public static func text(_ minutes: Int) -> String {
        String(format: "%02d:%02d", minutes / 60, minutes % 60)
    }

    /// The day ("yyyy-MM-dd") the range is on: the deadline, or today (4 a.m. rule) while the task is on
    /// today's sheet and not saved for 언젠가; nil otherwise.
    public static func day(of item: TodoItem, now: Date, calendar: Calendar = .paper) -> String? {
        if let due = item.dueDate { return due }
        guard item.shelf != .later else { return nil }
        return Archive.dayKey(now, calendar: calendar)
    }

    /// The range as dates on its day (the end as drawn).
    public static func interval(of item: TodoItem, now: Date, calendar: Calendar = .paper) -> (start: Date, end: Date)? {
        guard let range = item.timeRange, let key = day(of: item, now: now, calendar: calendar),
              let noon = Deadline.date(from: key, calendar: calendar) else { return nil }
        let midnight = calendar.startOfDay(for: noon)
        return (calendar.date(byAdding: .minute, value: range.start, to: midnight)!,
                calendar.date(byAdding: .minute, value: range.drawnEnd, to: midnight)!)
    }

    /// The reminder after the range changes from `old` to `new` (nil = cleared): a task without a reminder
    /// gets one at the new start when that is still ahead; a reminder at the old start moves with it; any
    /// other reminder stays. Clearing the range leaves the reminder as it is.
    public static func reminder(for item: TodoItem, from old: TimeRange?, to new: TimeRange?, now: Date, calendar: Calendar = .paper) -> Date? {
        guard let new else { return item.reminderAt }
        var moved = item
        moved.timeRange = new
        guard let start = interval(of: moved, now: now, calendar: calendar)?.start else { return item.reminderAt }
        if let reminder = item.reminderAt {
            var before = item
            before.timeRange = old
            guard old != nil, let oldStart = interval(of: before, now: now, calendar: calendar)?.start, oldStart == reminder else { return reminder }
            return start
        }
        return start > now ? start : nil
    }

    /// Whether the range is over and the task still open (the ribbon's clay outline).
    public static func isOverdue(_ item: TodoItem, now: Date, calendar: Calendar = .paper) -> Bool {
        guard !item.isCompleted, let interval = interval(of: item, now: now, calendar: calendar) else { return false }
        return interval.end <= now
    }

    /// The first length 집중 offers for a ranged task (1…180; nil when the range isn't today or is over): the whole
    /// range when it starts within its first 5 minutes (or before it) — a 30-minute task begun at 14:01 is a 30-minute
    /// focus, not 29 — otherwise the minutes left until its end, `ceil((end − now) / 1 min)`.
    public static let focusGrace: TimeInterval = 5 * 60

    public static func focusMinutes(_ item: TodoItem, now: Date, calendar: Calendar = .paper) -> Int? {
        guard let interval = interval(of: item, now: now, calendar: calendar), interval.end > now,
              day(of: item, now: now, calendar: calendar) == Archive.dayKey(now, calendar: calendar) else { return nil }
        let from = now.timeIntervalSince(interval.start) <= focusGrace ? interval.start : now
        let minutes = Int((interval.end.timeIntervalSince(from) / 60).rounded(.up))
        return (1...180).contains(minutes) ? minutes : nil
    }

    /// The copy and export text's part: " (14:00–15:30)" (before a deadline's "(~yyyy-MM-dd)").
    public static func exportText(_ item: TodoItem, language: AppLanguage) -> String {
        item.timeRange.map { " (\($0.text(language)))" } ?? ""
    }

    /// The ribbon's tooltip: "보고서 · 14:00–15:30".
    public static func tooltip(_ item: TodoItem, language: AppLanguage) -> String {
        guard let range = item.timeRange else { return item.title }
        return item.title + " · " + TimeRange(start: range.start, end: range.drawnEnd).text(language)
    }

    /// The 15-minute steps a drag moves by: `minutes` rounded to the nearest quarter hour.
    public static func snap(_ minutes: Double) -> Int {
        Int((minutes / 15).rounded()) * 15
    }

    /// A stretch or a move on the ribbon: the new range for dragging `edge` by `delta` minutes (15-minute
    /// steps), kept inside `bounds` (the track's hours) with at least 15 minutes between start and end.
    public enum Edge: Sendable { case start, end, whole }

    public static func dragged(_ range: TimeRange, edge: Edge, by delta: Double, bounds: ClosedRange<Int>) -> TimeRange {
        let step = snap(delta)
        let end = range.drawnEnd
        let low = max(dayStart, bounds.lowerBound), high = min(dayEnd, bounds.upperBound)
        switch edge {
        case .start:
            let start = min(max(low, range.start + step), end - 15)
            return TimeRange(start: start, end: end)
        case .end:
            let newEnd = max(range.start + 15, min(high, end + step))
            return TimeRange(start: range.start, end: newEnd)
        case .whole:
            let length = end - range.start
            let start = min(max(low, range.start + step), high - length)
            return TimeRange(start: start, end: range.end.map { _ in start + length })
        }
    }
}

// MARK: Reading a range in the input line

/// "3시부터 5시까지", "14:00-15:30", "보고서 2시~4시", "오후 2시부터 1시간"; en "2-4pm", "from 2 to 4", "2pm–3:30pm",
/// nl "van 2 tot 4 uur", "14:00-15:30". Korean forms and `HH:MM-HH:MM` in every language,
/// English and Dutch forms in their own language (the rules are in timeblock-cases.md §2).
enum TimeRangeReader {
    struct Found { let range: Range<String.Index>; let start: Int; let end: Int }

    static func find(in text: String, language: AppLanguage) -> Found? {
        var rules = korean
        switch language {
        case .ko: break
        case .en: rules = english + rules
        case .nl: rules = dutch + rules
        }
        for rule in rules {
            for match in matches(rule.pattern, in: text) {
                if let (start, end) = rule.read(match.groups), let fixed = settle(start, end) {
                    return Found(range: match.range, start: fixed.start, end: fixed.end)
                }
            }
        }
        return nil
    }

    /// Clock minutes in, logical minutes out (TimeBlock.logical). An end not after the start gets 12 hours when
    /// that makes it after the start and before 24:00 (11시~1시 → 11:00–13:00); then the end must come after the
    /// start in the 4 a.m. day (23:00–01:00 is a range, 03:00–05:00 isn't).
    static func settle(_ start: Int, _ end: Int) -> (start: Int, end: Int)? {
        guard (0..<1440).contains(start), (0..<1440).contains(end) else { return nil }
        var end = end
        if end <= start, end + 720 > start, end + 720 < 1440 { end += 720 }
        let from = TimeBlock.logical(start), to = TimeBlock.logical(end)
        guard to > from else { return nil }
        return (from, to)
    }

    typealias Groups = [String: String]
    struct Rule: Sendable { let pattern: String; let read: @Sendable (Groups) -> (Int, Int)? }

    static let before = #"(?<![\p{L}\p{N}/:.])"#
    static let after = #"(?![\p{L}\p{N}/:])"#

    static func matches(_ pattern: String, in text: String) -> [(range: Range<String.Index>, groups: Groups)] {
        let full = before + pattern + after
        guard let regex = RegexCache.regex(full, [.caseInsensitive]) else { return [] }
        let names = RegexCache.names(full)
        let ns = text as NSString
        return regex.matches(in: text, range: NSRange(location: 0, length: ns.length)).compactMap { result in
            guard let range = Range(result.range, in: text) else { return nil }
            var groups: Groups = [:]
            for name in names {
                let part = result.range(withName: name)
                if part.location != NSNotFound { groups[name] = ns.substring(with: part).lowercased() }
            }
            return (range, groups)
        }
    }

    static func number(_ text: String?) -> Int? { text.flatMap { Int($0) } }

    // MARK: Korean (every language)

    static let periodWords = "오전|오후|아침|점심|저녁|밤|새벽"

    /// A Korean time with named groups: `(오후 )2시( 반| 30분)` or `(오후 )14:30`.
    static func koreanTime(_ p: String) -> String {
        "(?:(?<\(p)per>\(periodWords))\\s?)?(?:(?<\(p)hh>\\d{1,2}):(?<\(p)mm>[0-5]\\d)|(?<\(p)h>\\d{1,2})시(?:\\s?(?<\(p)half>반)|\\s?(?<\(p)min>\\d{1,2})분)?)"
    }

    /// Minutes after midnight for a Korean time; `inherit` is the start's part of the day for an end without one.
    static func koreanMinutes(_ g: Groups, _ p: String, inherit: String? = nil) -> (minutes: Int, period: String?)? {
        let period = g["\(p)per"] ?? inherit
        let pm = period.map { ["오후", "점심", "저녁", "밤"].contains($0) }
        let am = period.map { ["오전", "아침", "새벽"].contains($0) } ?? false
        if let hh = number(g["\(p)hh"]), let mm = number(g["\(p)mm"]) {
            guard hh <= 23 else { return nil }
            var hour = hh
            if pm == true && hour < 12 { hour += 12 }
            if am && hour == 12 { hour = 0 }
            return (hour * 60 + mm, period)
        }
        guard let raw = number(g["\(p)h"]), (1...24).contains(raw) else { return nil }
        var minute = 0
        if g["\(p)half"] != nil { minute = 30 } else if let value = number(g["\(p)min"]) { guard value <= 59 else { return nil }; minute = value }
        var hour = raw
        if pm == true { if hour < 12 { hour += 12 } } else if am { if hour == 12 { hour = 0 } } else if hour <= 6 { hour += 12 } else if hour == 24 { hour = 0 }
        if hour == 24 { hour = 0 }
        return (hour * 60 + minute, period)
    }

    static func koreanPair(_ g: Groups) -> (Int, Int)? {
        guard let start = koreanMinutes(g, "a") else { return nil }
        // The end without a part of the day takes the start's (오후 2시~4시 → 16:00).
        guard let end = koreanMinutes(g, "b", inherit: g["bper"] == nil ? start.period : nil) else { return nil }
        return (start.minutes, end.minutes)
    }

    static let korean: [Rule] = [
        Rule(pattern: koreanTime("a") + #"\s?부터\s?"# + koreanTime("b") + #"(?:\s?까지)?"#) { koreanPair($0) },
        Rule(pattern: koreanTime("a") + #"\s?[~\-–]\s?"# + koreanTime("b") + #"(?:\s?까지)?"#) { koreanPair($0) },
        // "3~5시": the start's hour alone takes the end's 시 (and its part of the day).
        Rule(pattern: #"(?<ah>\d{1,2})\s?[~\-–]\s?"# + koreanTime("b") + #"(?:\s?까지)?"#) { g in
            guard g["bh"] != nil, let end = koreanMinutes(g, "b"), let start = koreanMinutes(g, "a", inherit: end.period) else { return nil }
            return (start.minutes, end.minutes)
        },
        Rule(pattern: koreanTime("a") + #"\s?부터\s?(?:(?<dh>\d{1,2})\s?시간(?:\s?(?<dhalf>반)|\s?(?<dm>\d{1,2})\s?분)?|(?<dmin>\d{1,3})\s?분)(?:\s?동안)?"#) { g in
            guard let start = koreanMinutes(g, "a") else { return nil }
            let length = (number(g["dh"]) ?? 0) * 60 + (g["dhalf"] != nil ? 30 : number(g["dm"]) ?? 0) + (number(g["dmin"]) ?? 0)
            guard length > 0, length < 1440 else { return nil }
            return (start.minutes, (start.minutes + length) % 1440)
        },
    ]

    // MARK: English

    static func englishTime(_ p: String) -> String {
        "(?<\(p)h>\\d{1,2})(?::(?<\(p)m>[0-5]\\d))?\\s*(?:(?<\(p)ap>[ap])\\.?m\\.?)?"
    }

    /// 24-hour minutes from an English time with `ap` ("a" / "p", or nil for none).
    static func englishMinutes(_ hour: Int, _ minute: Int, ap: String?) -> Int? {
        if let ap {
            guard (1...12).contains(hour) else { return nil }
            return ((ap == "p" ? (hour % 12) + 12 : hour % 12) * 60) + minute
        }
        guard hour <= 23 else { return nil }
        return hour * 60 + minute
    }

    /// A spoken hour without am/pm ("from 2 to 4", "van 2 tot 4 uur"): 1–6 o'clock is the afternoon.
    static func spoken(_ hour: Int, _ minute: Int) -> Int? {
        guard hour <= 23 else { return nil }
        return ((1...6).contains(hour) ? hour + 12 : hour) * 60 + minute
    }

    static func englishPair(_ g: Groups, from: Bool) -> (Int, Int)? {
        guard let ah = number(g["ah"]), let bh = number(g["bh"]) else { return nil }
        let am = number(g["am"]) ?? 0, bm = number(g["bm"]) ?? 0
        let aap = g["aap"], bap = g["bap"]
        if aap == nil && bap == nil {
            // "from 2 to 4": spoken hours (a colon reads as written).
            guard from else { return nil }
            let start = g["am"] != nil ? englishMinutes(ah, am, ap: nil) : spoken(ah, am)
            let end = g["bm"] != nil ? englishMinutes(bh, bm, ap: nil) : spoken(bh, bm)
            guard let start, let end else { return nil }
            return (start, end)
        }
        guard let end = englishMinutes(bh, bm, ap: bap ?? aap) else { return nil }
        if let aap { return englishMinutes(ah, am, ap: aap).map { ($0, end) } }
        // The start takes the end's am/pm unless that puts it after the end (11-1pm → 11 AM).
        if let same = englishMinutes(ah, am, ap: bap), same < end { return (same, end) }
        return englishMinutes(ah, am, ap: bap == "p" ? "a" : "p").map { ($0, end) }
    }

    static let english: [Rule] = [
        Rule(pattern: #"(?<from>from\s+)?"# + englishTime("a") + #"\s*(?:-|–|~|\bto\b|\btill\b|\buntil\b)\s*"# + englishTime("b")) { g in
            englishPair(g, from: g["from"] != nil)
        },
    ]

    // MARK: Dutch

    static func dutchTime(_ p: String) -> String {
        "(?<\(p)h>\\d{1,2})(?:(?<\(p)sep>[:u])(?<\(p)m>[0-5]\\d))?"
    }

    static func dutchMinutes(_ g: Groups, _ p: String) -> Int? {
        guard let hour = number(g["\(p)h"]) else { return nil }
        if let minute = number(g["\(p)m"]) { return hour <= 23 ? hour * 60 + minute : nil }
        return spoken(hour, 0)
    }

    static let dutch: [Rule] = [
        Rule(pattern: #"van\s+"# + dutchTime("a") + #"(?:\s*uur)?\s+tot\s+"# + dutchTime("b") + #"(?:\s*uur)?"#) { g in
            guard let start = dutchMinutes(g, "a"), let end = dutchMinutes(g, "b") else { return nil }
            return (start, end)
        },
    ]
}
