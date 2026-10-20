import Foundation

/// Understands dates and times written into a task, so "내일 3시 회의" gets an alert and
/// "금요일까지 보고서" a deadline. Same rules as the Windows app (quickParse.ts).
public struct QuickParse: Equatable, Sendable {
    public var title: String
    public var reminderAt: Date?
    public var dueDate: String?
    /// What was understood, for the preview under the input ("내일 오후 3:00 알림").
    public var summary: String?
    /// 할 일 시간 정하기 (1.39): "3시부터 5시까지", "14:00-15:30", "2-4pm", "van 2 tot 4 uur" — the range on its day
    /// (`dueDate` when that isn't today).
    public var range: TimeRange?

    public init(title: String, reminderAt: Date? = nil, dueDate: String? = nil, summary: String? = nil, range: TimeRange? = nil) {
        self.title = title
        self.reminderAt = reminderAt
        self.dueDate = dueDate
        self.summary = summary
        self.range = range
    }

    /// `language`: the app's language — its own words are understood first, and Korean always
    /// (Hangul and Latin words don't clash); the summary is written in it.
    public static func parse(_ text: String, now: Date = Date(), calendar: Calendar = .paper, language: AppLanguage = .ko) -> QuickParse {
        let original = QuickParse(title: text.trimmingCharacters(in: .whitespacesAndNewlines))
        var working = " " + text + " "
        let today = Archive.logicalDayStart(now, calendar: calendar)
        let todayStart = calendar.startOfDay(for: today)
        let words = WordRules.of(language)

        // A time range first ("3시부터 5시까지", "14:00-15:30", "2-4pm"): it takes the place of the time.
        let range = TimeRangeReader.find(in: working, language: language)
        if let range { working = replace(range.range, in: working) }

        // Dates: the language's own words, then Korean.
        var date: Date?
        var isDeadline = false
        var evening = false
        if let words, let found = words.date(in: working, today: todayStart, calendar: calendar) {
            date = found.date
            isDeadline = found.by
            evening = found.evening
            working = replace(found.range, in: working)
        }
        for rule in dateRules where date == nil && !(rule.slash && language == .nl) {
            guard let match = firstMatch(rule.pattern, in: working) else { continue }
            guard let found = rule.resolve(match.groups, todayStart, calendar) else { continue }
            if rule.needsUntil && !match.until { continue }
            date = found
            isDeadline = match.until
            working = replace(match.range, in: working)
            break
        }

        // Times: the language's own words, then Korean (and 15:30).
        var time: (hour: Int, minute: Int)?
        var after: Int?
        var explicit = false
        if range != nil {
            // The range's start is the time (handled below).
        } else if let words, let found = words.time(in: working) {
            switch found.hit {
            case .clock(let hour, let minute, let said): time = (hour, minute); explicit = said
            case .after(let minutes): after = minutes
            }
            working = replace(found.range, in: working)
        } else if let match = firstMatch(koreanAfter, in: working) {
            // "30분 뒤", "2시간 후", "1시간 반 뒤에", "1시간 20분 뒤" (1.38) — in every language, like 3시.
            let minutes = Int(match.groups[0]) ?? 0
            let hours = Int(match.groups[1]) ?? 0
            let extra = match.groups[2] == "반" ? 30 : Int(match.groups[3]) ?? 0
            let total = hours * 60 + extra + minutes
            if total > 0 {
                after = total
                working = replace(match.range, in: working)
            }
        } else if let match = firstMatch(timeHM, in: working), var hour = Int(match.groups[1]), let minute = Int(match.groups[2]),
           hour <= 23, minute <= 59 {
            // "오후 3:30" — a part of the day in front of the clock counts, like with 3시.
            let period = match.groups[0]
            if ["오후", "점심", "저녁", "밤"].contains(period) && hour < 12 { hour += 12 }
            if ["오전", "아침", "새벽"].contains(period) && hour == 12 { hour = 0 }
            time = (hour, minute)
            explicit = !period.isEmpty
            working = replace(match.range, in: working)
        } else if let match = firstMatch(timeKorean, in: working), let rawHour = Int(match.groups[1]), (1...24).contains(rawHour) {
            let period = match.groups[0]
            var minute = 0
            if match.groups[2] == "반" { minute = 30 } else if let value = Int(match.groups[3]), value <= 59 { minute = value }
            var hour = rawHour
            if ["오후", "점심", "저녁", "밤"].contains(period) {
                if hour < 12 { hour += 12 }
            } else if ["오전", "아침", "새벽"].contains(period) {
                if hour == 12 { hour = 0 }
            } else if hour <= 6 {
                hour += 12
            } else if hour == 24 {
                hour = 0
            }
            if hour == 24 { hour = 0 }
            time = (hour, minute)
            explicit = !period.isEmpty
            working = replace(match.range, in: working)
        }
        // "tonight" / "vanavond": 20:00, or the time given read as evening ("tonight at 9" is 21:00).
        if evening {
            if let given = time, !explicit, given.hour < 12 { time = (given.hour + 12, given.minute) }
            if time == nil && after == nil { time = (20, 0) }
        }

        let title = working.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !title.isEmpty, date != nil || time != nil || after != nil || range != nil else { return original }

        var result = QuickParse(title: title)
        if let range {
            // The day said, else today — or tomorrow when the whole range is already over today.
            let found = TimeRange(start: range.start, end: range.end)
            var day = date.map { calendar.startOfDay(for: $0) } ?? todayStart
            if date == nil, calendar.date(byAdding: .minute, value: found.drawnEnd, to: todayStart)! <= now {
                day = calendar.date(byAdding: .day, value: 1, to: todayStart)!
            }
            result.range = found
            if !calendar.isDate(day, inSameDayAs: todayStart) { result.dueDate = Deadline.key(day, calendar: calendar) }
            let start = calendar.date(byAdding: .minute, value: found.start, to: day)!
            if start > now {
                result.reminderAt = start
                result.summary = reminderSummary(start, todayStart: todayStart, calendar: calendar, language: language)
            }
        } else if let after {
            let minute = calendar.dateInterval(of: .minute, for: now)!.start
            let alert = minute.addingTimeInterval(TimeInterval(after * 60))
            result.reminderAt = alert
            result.summary = reminderSummary(alert, todayStart: todayStart, calendar: calendar, language: language)
        } else if let time {
            let day = date ?? todayStart
            var alert = calendar.date(bySettingHour: time.hour, minute: time.minute, second: 0, of: day)!
            if date == nil && alert <= now { alert = calendar.date(byAdding: .day, value: 1, to: alert)! }
            result.reminderAt = alert
            result.summary = reminderSummary(alert, todayStart: todayStart, calendar: calendar, language: language)
        } else if let date {
            if !isDeadline && calendar.isDate(date, inSameDayAs: todayStart) { return QuickParse(title: title) }
            result.dueDate = Deadline.key(date, calendar: calendar)
            let day = language.shortDate(date, calendar: calendar)
            result.summary = switch language {
            case .ko: "\(day)까지"
            case .en: "Due \(day)"
            case .nl: "Deadline \(day)"
            }
        }
        return result
    }

    /// "내일 오후 3:00 알림" · "Reminder tomorrow at 3:00 PM" · "Herinnering morgen om 15:00" (today, tomorrow, else the date).
    private static func reminderSummary(_ alert: Date, todayStart: Date, calendar: Calendar, language: AppLanguage) -> String {
        let days = calendar.dateComponents([.day], from: todayStart, to: calendar.startOfDay(for: alert)).day ?? 0
        let when = days == 0 || days == 1 ? language.dayWord(days)! : language.shortDate(alert, calendar: calendar)
        let parts = calendar.dateComponents([.hour, .minute], from: alert)
        let time = language.spokenTime(hour: parts.hour!, minute: parts.minute!)
        switch language {
        case .ko: return "\(when) \(time) 알림"
        case .en: return "Reminder \(days <= 1 ? when.lowercased() : when) at \(time)"
        case .nl: return "Herinnering \(days <= 1 ? when.lowercased() : when) om \(time)"
        }
    }

    // MARK: Rules

    private struct DateRule: Sendable {
        let pattern: String
        var needsUntil = false
        /// "10/5": month/day in Korean and English, left to the Dutch day/month rule in Dutch.
        var slash = false
        let resolve: @Sendable (_ groups: [String], _ today: Date, _ calendar: Calendar) -> Date?
    }

    private static let weekdays = ["일", "월", "화", "수", "목", "금", "토"]
    private static let weekdayPattern = "(월|화|수|목|금|토|일)(?:요일|욜)"
    /// A phrase ends at a space, the end, or 까지 (captured).
    private static let until = "(까지)?(?=\\s)"

    private static let dateRules: [DateRule] = [
        DateRule(pattern: "(이번\\s?주|다음\\s?주)\\s?" + weekdayPattern + until) { groups, today, calendar in
            let monday = mondayOf(today, calendar: calendar)
            let offset = (weekdays.firstIndex(of: groups[1])! + 6) % 7 // Monday = 0
            let next = groups[0].hasPrefix("다음") ? 7 : 0
            return calendar.date(byAdding: .day, value: offset + next, to: monday)
        },
        DateRule(pattern: "(이번\\s?주|다음\\s?주|이번\\s?달)" + until, needsUntil: true) { groups, today, calendar in
            if groups[0].hasSuffix("달") {
                guard let interval = calendar.dateInterval(of: .month, for: today) else { return nil }
                return calendar.date(byAdding: .day, value: -1, to: interval.end).map { calendar.startOfDay(for: $0) }
            }
            let sunday = calendar.date(byAdding: .day, value: 6, to: mondayOf(today, calendar: calendar))!
            return groups[0].hasPrefix("다음") ? calendar.date(byAdding: .day, value: 7, to: sunday) : sunday
        },
        DateRule(pattern: "(오늘|내일|모레|글피)" + until) { groups, today, calendar in
            calendar.date(byAdding: .day, value: ["오늘", "내일", "모레", "글피"].firstIndex(of: groups[0])!, to: today)
        },
        DateRule(pattern: "(\\d{1,2})월\\s?(\\d{1,2})일" + until) { groups, today, calendar in
            monthDay(Int(groups[0])!, Int(groups[1])!, today: today, calendar: calendar)
        },
        DateRule(pattern: "(\\d{1,2})/(\\d{1,2})" + until, slash: true) { groups, today, calendar in
            monthDay(Int(groups[0])!, Int(groups[1])!, today: today, calendar: calendar)
        },
        DateRule(pattern: weekdayPattern + until) { groups, today, calendar in
            let target = weekdays.firstIndex(of: groups[0])! + 1
            let current = calendar.component(.weekday, from: today)
            return calendar.date(byAdding: .day, value: (target - current + 7) % 7, to: today)
        },
    ]

    private static let koreanAfter = "(?<=\\s)(?:(\\d{1,3})\\s?분|(\\d{1,2})\\s?시간(?:\\s?(반)|\\s?(\\d{1,2})\\s?분)?)\\s?(?:뒤|후)(?:에)?(?=\\s)"
    private static let timeHM = "(?<=\\s)(?:(오전|아침|새벽|오후|점심|저녁|밤)\\s?)?(\\d{1,2}):(\\d{2})(?=\\s)"
    private static let timeKorean = "(?<=\\s)(오전|오후|아침|점심|저녁|밤|새벽)?\\s?(\\d{1,2})시(?:\\s?(반)|\\s?(\\d{1,2})분)?(?=\\s)"

    // MARK: Helpers

    private struct Match {
        let range: Range<String.Index>
        let groups: [String]
        let until: Bool
    }

    /// The first match whose start follows a space (so words are matched whole). Unmatched
    /// optional groups come back as "". A trailing (까지) group, if present, is reported as `until`.
    private static func firstMatch(_ pattern: String, in text: String) -> Match? {
        guard let regex = RegexCache.regex((pattern.hasPrefix("(?<=") ? "" : "(?<=\\s)") + pattern) else { return nil }
        let ns = text as NSString
        guard let result = regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)),
              let range = Range(result.range, in: text) else { return nil }
        var groups: [String] = []
        for index in 1..<result.numberOfRanges {
            let part = result.range(at: index)
            groups.append(part.location == NSNotFound ? "" : ns.substring(with: part))
        }
        let until = groups.last == "까지"
        if pattern.hasSuffix(Self.until) { groups.removeLast() }
        return Match(range: range, groups: groups, until: until)
    }

    private static func replace(_ range: Range<String.Index>, in text: String) -> String {
        var copy = text
        copy.replaceSubrange(range, with: " ")
        return copy
    }

    private static func mondayOf(_ day: Date, calendar: Calendar) -> Date {
        let weekday = calendar.component(.weekday, from: day) // 1 = Sunday
        return calendar.date(byAdding: .day, value: -((weekday + 5) % 7), to: calendar.startOfDay(for: day))!
    }

    private static func monthDay(_ month: Int, _ day: Int, today: Date, calendar: Calendar) -> Date? {
        guard (1...12).contains(month) else { return nil }
        let year = calendar.component(.year, from: today)
        for candidate in [year, year + 1] {
            var parts = DateComponents(year: candidate, month: month, day: 1)
            guard let first = calendar.date(from: parts),
                  let days = calendar.range(of: .day, in: .month, for: first), days.contains(day) else { return nil }
            parts.day = day
            if let date = calendar.date(from: parts), date >= today { return date }
        }
        return nil
    }
}

// MARK: English and Dutch

/// The words QuickParse understands in English and Dutch, mirroring the Korean ones: days (today,
/// tomorrow, weekdays, "oct 12", "10/12" — Dutch "12/10" is day/month), deadlines ("by friday",
/// "tot vrijdag", "this week", "eind van de maand"), times ("3pm", "at 3", "om 3 uur", "15u",
/// "noon") and "in 30 min" / "over 2 uur". The same patterns and rules as the Windows app
/// (quickParse.ts); a phrase is matched whole, ignoring case.
private struct WordRules: Sendable {
    struct DateFound { let range: Range<String.Index>; let date: Date; let by: Bool; let evening: Bool }
    enum TimeHit { case clock(hour: Int, minute: Int, explicit: Bool), after(minutes: Int) }
    struct TimeFound { let range: Range<String.Index>; let hit: TimeHit }

    typealias Groups = [String: String]
    struct DateRule: Sendable {
        let pattern: String
        let resolve: @Sendable (_ g: Groups, _ today: Date, _ calendar: Calendar) -> (date: Date, evening: Bool)?
    }
    struct TimeRule: Sendable {
        let pattern: String
        let resolve: @Sendable (_ g: Groups) -> TimeHit?
    }

    let by: String
    let dates: [DateRule]
    let times: [TimeRule]

    static func of(_ language: AppLanguage) -> WordRules? {
        switch language {
        case .ko: nil
        case .en: english
        case .nl: dutch
        }
    }

    func date(in text: String, today: Date, calendar: Calendar) -> DateFound? {
        for rule in dates {
            for match in Self.matches(Self.before + "(?:(?<by>" + by + #")\s+)?(?:"# + rule.pattern + ")" + Self.after, in: text) {
                if let found = rule.resolve(match.groups, today, calendar) {
                    return DateFound(range: match.range, date: found.date, by: !(match.groups["by"] ?? "").isEmpty, evening: found.evening)
                }
            }
        }
        return nil
    }

    func time(in text: String) -> TimeFound? {
        for rule in times {
            for match in Self.matches(Self.before + "(?:" + rule.pattern + ")" + Self.after, in: text) {
                if let hit = rule.resolve(match.groups) { return TimeFound(range: match.range, hit: hit) }
            }
        }
        return nil
    }

    // MARK: Shared steps

    /// Nothing letter- or digit-like right before or after, so "3 apples" or "1/2/3" never read as dates.
    static let before = #"(?<![\p{L}\p{N}/:])"#
    static let after = #"(?![\p{L}\p{N}/:])"#

    static func matches(_ pattern: String, in text: String) -> [(range: Range<String.Index>, groups: Groups)] {
        guard let regex = RegexCache.regex(pattern, [.caseInsensitive]) else { return [] }
        let names = RegexCache.names(pattern)
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

    static func addDays(_ days: Int, _ day: Date, _ calendar: Calendar) -> Date {
        calendar.date(byAdding: .day, value: days, to: day)!
    }

    static func monday(of day: Date, _ calendar: Calendar) -> Date {
        addDays(-((calendar.component(.weekday, from: day) + 5) % 7), calendar.startOfDay(for: day), calendar)
    }

    /// A weekday: the coming one (today counts) — or with "next" / "volgende", that day in next
    /// week (weeks run Monday to Sunday, like the Korean 다음 주).
    static func weekday(_ target: Int, next: Bool, today: Date, calendar: Calendar) -> Date {
        if next { return addDays((target + 6) % 7 + 7, monday(of: today, calendar), calendar) }
        return addDays((target - (calendar.component(.weekday, from: today) - 1) + 7) % 7, today, calendar)
    }

    /// The end of this or next week (Sunday) or month.
    static func spanEnd(month: Bool, next: Bool, today: Date, calendar: Calendar) -> Date {
        if month {
            let parts = calendar.dateComponents([.year, .month], from: today)
            let first = calendar.date(from: DateComponents(year: parts.year, month: parts.month! + (next ? 2 : 1), day: 1))!
            return addDays(-1, first, calendar)
        }
        return addDays(6 + (next ? 7 : 0), monday(of: today, calendar), calendar)
    }

    /// The next such day (this year, or next once it has passed); nil when the day doesn't exist.
    static func monthDay(_ month: Int, _ day: Int, today: Date, calendar: Calendar) -> Date? {
        guard (1...12).contains(month), day >= 1 else { return nil }
        let year = calendar.component(.year, from: today)
        for candidate in [year, year + 1] {
            var parts = DateComponents(year: candidate, month: month, day: 1)
            guard let first = calendar.date(from: parts),
                  let days = calendar.range(of: .day, in: .month, for: first), days.contains(day) else { return nil }
            parts.day = day
            if let date = calendar.date(from: parts), date >= today { return date }
        }
        return nil
    }

    /// A 24-hour hour from what was written. `spoken` ("at 3", "om 3 uur", "15u") follows the Korean
    /// 3시 rule — 1 to 6 o'clock is the afternoon — unless a part of the day says otherwise.
    static func hour(_ value: Int, pm: Bool?, spoken: Bool) -> Int? {
        if let pm {
            if value > 12 { return value <= 23 ? value : nil }
            return pm ? (value < 12 ? value + 12 : 12) : (value == 12 ? 0 : value)
        }
        guard value <= (spoken ? 24 : 23) else { return nil }
        if value == 24 { return 0 }
        return spoken && (1...6).contains(value) ? value + 12 : value
    }

    static func number(_ text: String?) -> Int? { text.flatMap { Int($0) } }

    // MARK: English

    static let englishWeekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]
    static let englishMonths = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
    static let englishWeekdayWords = "sunday|monday|tuesday|wednesday|thursday|friday|saturday"
    static let englishMonthWords = "january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept|sep|oct|nov|dec"

    static let english = WordRules(
        by: #"by|due(?:\s+(?:by|on))?|before|until|till"#,
        dates: [
            DateRule(pattern: "(?<tonight>tonight)") { _, today, _ in (today, true) },
            DateRule(pattern: #"(?<rel>(?:the\s+)?day\s+after\s+tomorrow|today|tomorrow)"#) { g, today, calendar in
                let word = g["rel"] ?? ""
                return (addDays(word.contains("after") ? 2 : word == "tomorrow" ? 1 : 0, today, calendar), false)
            },
            DateRule(pattern: #"(?<span>(?:this|next)\s+(?:week|month)|end\s+of\s+(?:the\s+)?(?:week|month))"#) { g, today, calendar in
                let span = g["span"] ?? ""
                return (spanEnd(month: span.hasSuffix("month"), next: span.hasPrefix("next"), today: today, calendar: calendar), false)
            },
            DateRule(pattern: #"(?:(?<which>this|next|on)\s+(?<wd>"# + englishWeekdayWords + #"|sun|mon|tues|tue|wed|thurs|thur|thu|fri|sat)|(?<bare>"#
                     + englishWeekdayWords + #"|mon|tues|tue|wed|thurs|thur|thu|fri))"#) { g, today, calendar in
                let word = g["wd"] ?? g["bare"] ?? ""
                guard let target = englishWeekdays.firstIndex(of: String(word.prefix(3))) else { return nil }
                return (weekday(target, next: g["which"] == "next", today: today, calendar: calendar), false)
            },
            DateRule(pattern: #"(?:(?<mname>"# + englishMonthWords + #")\.?\s+(?<mday>\d{1,2})(?:st|nd|rd|th)?|(?<dday>\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(?<dname>"#
                     + englishMonthWords + #")\.?)"#) { g, today, calendar in
                guard let name = g["mname"] ?? g["dname"], let day = number(g["mday"] ?? g["dday"]),
                      let month = englishMonths.firstIndex(of: String(name.prefix(3))) else { return nil }
                return monthDay(month + 1, day, today: today, calendar: calendar).map { ($0, false) }
            },
            DateRule(pattern: #"(?<sa>\d{1,2})/(?<sb>\d{1,2})"#) { g, today, calendar in
                guard let month = number(g["sa"]), let day = number(g["sb"]) else { return nil }
                return monthDay(month, day, today: today, calendar: calendar).map { ($0, false) }
            },
        ],
        times: [
            TimeRule(pattern: #"in\s+(?:(?<n>\d{1,3})\s*(?<unit>minutes|minute|mins|min|m|hours|hour|hrs|hr|h)|(?<an>an|one)\s+hour|(?<half>half\s+an\s+hour))"#) { g in
                if g["half"] != nil { return .after(minutes: 30) }
                if g["an"] != nil { return .after(minutes: 60) }
                guard let n = number(g["n"]), n > 0, let unit = g["unit"] else { return nil }
                return .after(minutes: unit.hasPrefix("h") ? n * 60 : n)
            },
            TimeRule(pattern: #"(?:at\s+)?(?<h>\d{1,2})(?::(?<m>[0-5]\d))?\s*(?<ap>[ap])\.?m\.?"#) { g in
                guard let value = number(g["h"]), (1...12).contains(value), let hour = hour(value, pm: g["ap"] == "p", spoken: false) else { return nil }
                return .clock(hour: hour, minute: number(g["m"]) ?? 0, explicit: true)
            },
            TimeRule(pattern: #"(?:at\s+)?(?<noon>noon|midday)"#) { _ in .clock(hour: 12, minute: 0, explicit: true) },
            TimeRule(pattern: #"at\s+(?<h>\d{1,2})(?::(?<m>[0-5]\d))?(?:\s*o['’]clock)?"#) { g in
                guard let value = number(g["h"]), let hour = hour(value, pm: nil, spoken: true) else { return nil }
                return .clock(hour: hour, minute: number(g["m"]) ?? 0, explicit: false)
            },
        ])

    // MARK: Dutch

    static let dutchWeekdays = ["zo", "ma", "di", "wo", "do", "vr", "za"]
    static let dutchMonths = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]
    static let dutchWeekdayWords = "zondag|maandag|dinsdag|woensdag|donderdag|vrijdag|zaterdag"
    static let dutchMonthWords = "januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|jan|feb|mrt|maa|apr|jun|jul|aug|sept|sep|okt|nov|dec"
    static let dutchPeriod = #"['’]s\s*(?:middags|avonds|ochtends|morgens|nachts)"#

    static let dutch = WordRules(
        by: #"tot\s+en\s+met|t/m|tot|uiterlijk|vóór|voor"#,
        dates: [
            DateRule(pattern: "(?<tonight>vanavond)") { _, today, _ in (today, true) },
            DateRule(pattern: "(?<rel>overmorgen|vandaag|morgen)") { g, today, calendar in
                (addDays(["vandaag", "morgen", "overmorgen"].firstIndex(of: g["rel"] ?? "") ?? 0, today, calendar), false)
            },
            DateRule(pattern: #"(?<span>(?:deze|volgende)\s+(?:week|maand)|einde?\s+van\s+de\s+(?:week|maand)|einde?\s+(?:week|maand))"#) { g, today, calendar in
                let span = g["span"] ?? ""
                return (spanEnd(month: span.hasSuffix("maand"), next: span.hasPrefix("volgende"), today: today, calendar: calendar), false)
            },
            DateRule(pattern: #"(?:(?<which>deze|volgende|komende|op)\s+(?<wd>"# + dutchWeekdayWords + #"|ma|di|wo|do|vr|za|zo)|(?<bare>"#
                     + dutchWeekdayWords + #"|di|wo|do|vr|za))"#) { g, today, calendar in
                let word = g["wd"] ?? g["bare"] ?? ""
                guard let target = dutchWeekdays.firstIndex(of: String(word.prefix(2))) else { return nil }
                return (weekday(target, next: g["which"] == "volgende", today: today, calendar: calendar), false)
            },
            DateRule(pattern: #"(?<dday>\d{1,2})e?\s+(?<dname>"# + dutchMonthWords + #")\.?"#) { g, today, calendar in
                guard let name = g["dname"], let day = number(g["dday"]) else { return nil }
                let month = name.hasPrefix("maa") ? 2 : dutchMonths.firstIndex(of: String(name.prefix(3)))
                return month.flatMap { monthDay($0 + 1, day, today: today, calendar: calendar) }.map { ($0, false) }
            },
            DateRule(pattern: #"(?<sa>\d{1,2})/(?<sb>\d{1,2})"#) { g, today, calendar in
                guard let day = number(g["sa"]), let month = number(g["sb"]) else { return nil }
                return monthDay(month, day, today: today, calendar: calendar).map { ($0, false) }
            },
        ],
        times: [
            TimeRule(pattern: #"over\s+(?:(?<n>\d{1,3})\s*(?<unit>minuten|minuut|min|m|uur|u)|een\s+(?<word>kwartier|half\s+uur|uur))"#) { g in
                if let word = g["word"] { return .after(minutes: word == "kwartier" ? 15 : word == "uur" ? 60 : 30) }
                guard let n = number(g["n"]), n > 0, let unit = g["unit"] else { return nil }
                return .after(minutes: unit.hasPrefix("u") ? n * 60 : n)
            },
            TimeRule(pattern: "(?:(?<pa>" + dutchPeriod + #")\s+)?(?:(?<om>om)\s+)?(?<h>\d{1,2})(?<mark>:[0-5]\d|u(?:[0-5]\d)?|\s*uur)?(?:\s+(?<pb>"#
                     + dutchPeriod + "))?") { g in
                let mark = g["mark"] ?? ""
                let period = g["pa"] ?? g["pb"]
                let om = g["om"] != nil
                // A bare number, or "3 uur" (also "3 hours"), is no time without om or a part of the day.
                guard om || period != nil || mark.hasPrefix(":") || mark.hasPrefix("u") else { return nil }
                guard let value = number(g["h"]) else { return nil }
                // 's middags and 's avonds are p.m.; 's nachts is p.m. from 7 to 11 ("'s nachts 11 uur" is 23:00).
                let pm: Bool? = period.map { $0.hasSuffix("middags") || $0.hasSuffix("avonds") || ($0.hasSuffix("nachts") && (7...11).contains(value)) }
                let minute = number(String(mark.drop { !$0.isNumber })) ?? 0
                guard let hour = hour(value, pm: pm, spoken: om || !mark.hasPrefix(":")) else { return nil }
                return .clock(hour: hour, minute: minute, explicit: period != nil)
            },
        ])
}
