import Foundation

// 편의 기능 (1.38): the pure rules behind carrying work forward, snoozing, the evening tidy-up and
// search. Same rules and test cases as the Windows app (convenience.ts; the shared cases are in
// convenience-cases.md).

// MARK: - 내일 하기 · 날짜 바꾸기

public enum DateMove {
    /// Tomorrow by the 4 a.m. rule.
    public static func tomorrow(now: Date, calendar: Calendar = .paper) -> String {
        Deadline.key(calendar.date(byAdding: .day, value: 1, to: Archive.logicalDayStart(now, calendar: calendar))!, calendar: calendar)
    }

    /// This week's Friday — nil on Friday, Saturday and Sunday (the menu hides it).
    public static func thisFriday(now: Date, calendar: Calendar = .paper) -> String? {
        let today = Archive.logicalDayStart(now, calendar: calendar)
        let weekday = calendar.component(.weekday, from: today) - 1 // 0 = Sunday
        guard (1...4).contains(weekday) else { return nil }
        return Deadline.key(calendar.date(byAdding: .day, value: 5 - weekday, to: today)!, calendar: calendar)
    }

    /// The first Monday after today (the menu leaves it out when that's tomorrow).
    public static func nextMonday(now: Date, calendar: Calendar = .paper) -> String {
        let today = Archive.logicalDayStart(now, calendar: calendar)
        let weekday = calendar.component(.weekday, from: today) - 1
        let ahead = (8 - weekday) % 7
        return Deadline.key(calendar.date(byAdding: .day, value: ahead == 0 ? 7 : ahead, to: today)!, calendar: calendar)
    }

    public enum Choice: Equatable, Sendable {
        case tomorrow(String), friday(String), nextMonday(String), someday, pick

        /// `내일` · `이번 주 금요일` · `다음 주 월요일` · `언젠가` · `날짜 고르기…`.
        public func title(_ language: AppLanguage = .ko) -> String {
            let titles: [[String]] = [
                ["내일", "이번 주 금요일", "다음 주 월요일", "언젠가", "날짜 고르기…"],
                ["Tomorrow", "This Friday", "Next Monday", "Someday", "Pick a date…"],
                ["Morgen", "Deze vrijdag", "Volgende maandag", "Ooit", "Datum kiezen…"],
            ]
            let index = switch self {
            case .tomorrow: 0
            case .friday: 1
            case .nextMonday: 2
            case .someday: 3
            case .pick: 4
            }
            return titles[language.index][index]
        }
    }

    /// 날짜 바꾸기 ▸: tomorrow · this Friday (Monday to Thursday) · next Monday (unless it's tomorrow) · 언젠가 · 날짜 고르기….
    public static func choices(now: Date, calendar: Calendar = .paper) -> [Choice] {
        let next = tomorrow(now: now, calendar: calendar)
        var choices: [Choice] = [.tomorrow(next)]
        if let friday = thisFriday(now: now, calendar: calendar) { choices.append(.friday(friday)) }
        let monday = nextMonday(now: now, calendar: calendar)
        if monday != next { choices.append(.nextMonday(monday)) }
        return choices + [.someday, .pick]
    }

    /// ⌥→ / ⌥←: from the deadline when it's after today, else from today, a day later — or a day earlier
    /// when that start is after today (else nil: nothing to do).
    public static func shift(_ due: String?, by delta: Int, now: Date, calendar: Calendar = .paper) -> String? {
        let todayKey = Archive.dayKey(now, calendar: calendar)
        guard let today = Deadline.date(from: todayKey, calendar: calendar) else { return nil }
        if delta > 0 {
            let base = due.flatMap { $0 > todayKey ? Deadline.date(from: $0, calendar: calendar) : nil } ?? today
            return Deadline.key(calendar.date(byAdding: .day, value: delta, to: base)!, calendar: calendar)
        }
        guard let due, due > todayKey, let day = Deadline.date(from: due, calendar: calendar) else { return nil }
        let moved = Deadline.key(calendar.date(byAdding: .day, value: delta, to: day)!, calendar: calendar)
        return max(moved, todayKey)
    }

    /// The toast: "내일로 옮겼어요" · "Moved to tomorrow" · "Naar morgen verplaatst" for tomorrow, else
    /// the 앞으로 words ("10월 13일로 옮겼어요").
    public static func movedText(_ key: String, now: Date, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String {
        if key == tomorrow(now: now, calendar: calendar) {
            return ["내일로 옮겼어요", "Moved to tomorrow", "Verplaatst naar morgen"][language.index]
        }
        return Ahead.movedText(.day(key), now: now, calendar: calendar, language: language)
    }
}

// MARK: - 다시 알림

/// The reminder bubble's snooze menu.
public enum Snooze: Equatable, Hashable, Sendable {
    case minutes(Int)
    /// 오늘 저녁 7시 (only before 18:00).
    case evening
    /// 내일 아침 9시.
    case tomorrowMorning
    /// 내일로 미루기: the task moves to tomorrow (see DateMove) instead of ringing again.
    case tomorrow

    /// 5분 · 10분 · 30분 · 1시간 · 오늘 저녁 7시 (hidden from 18:00, and after midnight) · 내일 아침 9시 · 내일로 미루기
    /// (task alerts only; the periodic nudge leaves it out: `moves: false`).
    public static func options(now: Date, moves: Bool = true, calendar: Calendar = .paper) -> [Snooze] {
        var options: [Snooze] = [.minutes(5), .minutes(10), .minutes(30), .minutes(60)]
        let midnight = calendar.startOfDay(for: Archive.logicalDayStart(now, calendar: calendar))
        if now < calendar.date(byAdding: .hour, value: 18, to: midnight)! { options.append(.evening) }
        options.append(.tomorrowMorning)
        if moves { options.append(.tomorrow) }
        return options
    }

    /// When it rings again; nil for 내일로 미루기.
    public func date(now: Date, calendar: Calendar = .paper) -> Date? {
        let midnight = calendar.startOfDay(for: Archive.logicalDayStart(now, calendar: calendar))
        switch self {
        case .minutes(let minutes):
            // From the minute (seconds zeroed): 14:50:40 + 10 → 15:00.
            return calendar.dateInterval(of: .minute, for: now)!.start.addingTimeInterval(TimeInterval(minutes * 60))
        case .evening: return calendar.date(byAdding: .hour, value: 19, to: midnight)
        case .tomorrowMorning: return calendar.date(byAdding: .hour, value: 9, to: calendar.date(byAdding: .day, value: 1, to: midnight)!)
        case .tomorrow: return nil
        }
    }

    /// "5분 뒤", "1시간 뒤", "오늘 저녁 7시", "내일 아침 9시", "내일로 미루기"; en "In 5 min", "In 1 hour", "Tonight at 7 PM",
    /// "Tomorrow at 9 AM", "Move to tomorrow"; nl "Over 5 min", "Over 1 uur", "Vanavond om 19:00", "Morgen om 09:00", "Naar morgen".
    public func title(_ language: AppLanguage = .ko) -> String {
        switch self {
        case .minutes(let minutes):
            if minutes % 60 == 0 {
                let hours = minutes / 60
                return ["\(hours)시간 뒤", hours == 1 ? "In 1 hour" : "In \(hours) hours", "Over \(hours) uur"][language.index]
            }
            return ["\(minutes)분 뒤", "In \(minutes) min", "Over \(minutes) min"][language.index]
        case .evening: return ["오늘 저녁 7시", "Tonight at 7 PM", "Vanavond om 19:00"][language.index]
        case .tomorrowMorning: return ["내일 아침 9시", "Tomorrow at 9 AM", "Morgen om 09:00"][language.index]
        case .tomorrow: return ["내일로 미루기", "Move to tomorrow", "Naar morgen"][language.index]
        }
    }

    /// Event alerts: `5분 전에 다시` · `5 min before` · `5 min ervoor`, while the start is more
    /// than five minutes away.
    public static func eventAgainTitle(_ language: AppLanguage = .ko) -> String {
        ["5분 전에 다시", "5 min before", "5 min ervoor"][language.index]
    }

    /// When the event alert comes again: five minutes before the start, if that's still ahead.
    public static func eventAgain(start: Date, now: Date) -> Date? {
        let at = start.addingTimeInterval(-300)
        return at > now ? at : nil
    }
}

// MARK: - 저녁 정리

public enum Sweep {
    public enum Moment: String, Sendable { case evening, morning }

    /// What the tidy-up offers: open tasks on today's sheet that aren't a repeat's copy and have no
    /// reminder still to come.
    public static func candidates(_ items: [TodoItem], now: Date, calendar: Calendar = .paper) -> [TodoItem] {
        items.filter { item in
            !item.isCompleted && item.seriesID == nil && Shelf.page(of: item, now: now, calendar: calendar) == .today
                && !(item.reminderAt.map { $0 > now } ?? false)
        }
    }

    /// Of those, the ones carried over from an earlier day (stamped before today).
    public static func carried(_ items: [TodoItem], now: Date, calendar: Calendar = .paper) -> [TodoItem] {
        let today = Archive.dayKey(now, calendar: calendar)
        return candidates(items, now: now, calendar: calendar).filter { item in item.todaySince.map { $0 < today } ?? false }
    }

    /// Whether to ask now; `shown` is the day key the sweep last came for (a device's own setting).
    /// Evening: from `minutes` after the logical day's midnight (20:00 = 1200) until it ends at 4 a.m., once a day,
    /// with candidates. Morning (only as the note is opened or shown on a new day): yesterday's evening never
    /// came (`shown` before yesterday) and something was carried over. Showing the morning one sets `shown` to
    /// yesterday (`mark`), so the evening still comes; the evening sets it to today.
    public static func due(_ items: [TodoItem], now: Date, minutes: Int, shown: String?, opening: Bool,
                           calendar: Calendar = .paper) -> (moment: Moment, items: [TodoItem], mark: String)? {
        let today = Archive.logicalDayStart(now, calendar: calendar)
        let todayKey = Archive.dayKey(now, calendar: calendar)
        let midnight = calendar.startOfDay(for: today)
        if now >= calendar.date(byAdding: .minute, value: minutes, to: midnight)! {
            guard shown != todayKey else { return nil }
            let left = candidates(items, now: now, calendar: calendar)
            return left.isEmpty ? nil : (.evening, left, todayKey)
        }
        let yesterday = Deadline.key(calendar.date(byAdding: .day, value: -1, to: today)!, calendar: calendar)
        guard opening, (shown ?? "") < yesterday else { return nil }
        let left = carried(items, now: now, calendar: calendar)
        return left.isEmpty ? nil : (.morning, left, yesterday)
    }

    /// The times the setting offers: 18:00 to 22:00 by half hours (as minutes after midnight).
    public static let times: [Int] = Array(stride(from: 18 * 60, through: 22 * 60, by: 30))
    public static let defaultTime = 20 * 60

    /// Evening: "오늘 3개 남았어요. 내일로 넘길까요?" · "3 to-dos left today. Move them to tomorrow?" ·
    /// "Nog 3 taken voor vandaag. Naar morgen schuiven?". Morning: "어제 남은 일이 3개 있어요. 오늘 할까요?" ·
    /// "3 to-dos left from yesterday. Do them today?" · "Nog 3 taken van gisteren. Vandaag doen?".
    public static func question(_ moment: Moment, count: Int, language: AppLanguage = .ko) -> String {
        let one = count == 1
        switch (moment, language) {
        case (.evening, .ko): return "오늘 \(count)개 남았어요. 내일로 넘길까요?"
        case (.evening, .en): return "\(language.todos(count)) left today. Move \(one ? "it" : "them") to tomorrow?"
        case (.evening, .nl): return "Nog \(language.todos(count)) voor vandaag. Naar morgen schuiven?"
        case (.morning, .ko): return "어제 남은 일이 \(count)개 있어요. 오늘 할까요?"
        case (.morning, .en): return "\(language.todos(count)) left from yesterday. Do \(one ? "it" : "them") today?"
        case (.morning, .nl): return "Nog \(language.todos(count)) van gisteren. Vandaag doen?"
        }
    }

    /// The toast once moved: "3개를 내일로 옮겼어요" · "Moved 3 to tomorrow" · "3 verplaatst naar morgen";
    /// "3개를 언젠가로 옮겼어요" · "Moved 3 to Someday" · "3 verplaatst naar Ooit".
    public static func movedText(count: Int, someday: Bool, language: AppLanguage = .ko) -> String {
        switch language {
        case .ko: return "\(count)개를 \(someday ? "언젠가로" : "내일로") 옮겼어요"
        case .en: return "Moved \(count) to \(someday ? "Someday" : "tomorrow")"
        case .nl: return "\(count) verplaatst naar \(someday ? "Ooit" : "morgen")"
        }
    }
}

// MARK: - 검색

public enum Search {
    public enum Group: Int, CaseIterable, Sendable {
        case today, ahead, memos, history, events

        /// "오늘" · "앞으로" · "메모" · "완료 기록" · "일정"; en "Today" · "Ahead" · "Notes" · "History" · "Events";
        /// nl "Vandaag" · "Vooruit" · "Notities" · "Geschiedenis" · "Afspraken".
        public func title(_ language: AppLanguage = .ko) -> String {
            let titles: [[String]] = [
                ["오늘", "앞으로", "메모", "완료 기록", "일정"],
                ["Today", "Ahead", "Notes", "History", "Events"],
                ["Vandaag", "Vooruit", "Notities", "Geschiedenis", "Afspraken"],
            ]
            return titles[language.index][rawValue]
        }
    }

    public struct Hit: Equatable, Sendable {
        public var group: Group
        /// The task's UUID string, the memo's or event's id, the record entry's id.
        public var id: String
        /// The line shown (a memo's matching line).
        public var text: String
        /// Where the query is in `text`, in Unicode scalars of its NFC form.
        public var range: Range<Int>
        /// At the right: a date, a time or 언젠가.
        public var detail: String
        public var done: Bool
        /// The day it belongs to ("yyyy-MM-dd"): a record entry's day, an event's date.
        public var day: String?
    }

    /// An event for searching: its title, and the day to show (the next one, else the last).
    public struct EventEntry: Equatable, Sendable {
        public var id: String
        public var title: String
        public var date: String
        /// Where it is (matched like the title; the row still shows the title).
        public var location: String?
        public init(id: String, title: String, date: String, location: String? = nil) { self.id = id; self.title = title; self.date = date; self.location = location }
    }

    public static let limit = 20
    /// 완료 기록 shows a few more.
    public static let historyLimit = 30

    // MARK: Matching

    /// Where `query` first appears in `text` (scalar offsets of the NFC text), or nil. Latin letters
    /// (anything below U+1100) match without case or accents; a lone Korean consonant (ㄱ…ㅎ) matches
    /// a syllable starting with it, so "ㅂㄱㅅ" finds 보고서 and "보고ㅅ" too; spaces of any kind are
    /// one space; the query is trimmed and its inner spaces collapsed.
    public static func match(_ query: String, in text: String) -> Range<Int>? {
        let wanted = cleanQuery(query)
        guard !wanted.isEmpty else { return nil }
        let line = scalars(text)
        guard line.count >= wanted.count else { return nil }
        let folded = line.map(fold)
        let foldedQuery = wanted.map(fold)
        outer: for start in 0...(line.count - wanted.count) {
            for offset in wanted.indices {
                let t = line[start + offset], q = wanted[offset]
                if foldedQuery[offset] == folded[start + offset] { continue }
                if let initial = choseong(of: t), consonants.firstIndex(of: q.value) == initial { continue }
                continue outer
            }
            return start..<(start + wanted.count)
        }
        return nil
    }

    static func cleanQuery(_ query: String) -> [Unicode.Scalar] {
        let words = query.precomposedStringWithCanonicalMapping.split(whereSeparator: { $0.isWhitespace })
        return Array(words.joined(separator: " ").unicodeScalars)
    }

    static func scalars(_ text: String) -> [Unicode.Scalar] { Array(text.precomposedStringWithCanonicalMapping.unicodeScalars) }

    /// The compatibility jamo consonants that start syllables, in the order of the syllable table.
    static let consonants: [UInt32] = [0x3131, 0x3132, 0x3134, 0x3137, 0x3138, 0x3139, 0x3141, 0x3142, 0x3143, 0x3145,
                                       0x3146, 0x3147, 0x3148, 0x3149, 0x314A, 0x314B, 0x314C, 0x314D, 0x314E]

    static func choseong(of scalar: Unicode.Scalar) -> Int? {
        let value = scalar.value
        guard (0xAC00...0xD7A3).contains(value) else { return nil }
        return Int((value - 0xAC00) / 588)
    }

    static func fold(_ scalar: Unicode.Scalar) -> String {
        if scalar.properties.isWhitespace { return " " }
        guard scalar.value < 0x1100 else { return String(scalar) }
        let base = String(scalar).decomposedStringWithCanonicalMapping.unicodeScalars.filter { !(0x300...0x36F).contains($0.value) }
        return String(String.UnicodeScalarView(base)).lowercased()
    }

    // MARK: Finding

    /// Every group with something, in order: 오늘 (the sheet's order, open first), 앞으로 (dated by
    /// date, then 언젠가 in the list's order), 메모 (newest first; the first matching line), 완료 기록
    /// (newest first), 일정 (coming ones soonest first, then past ones latest first). At most `limit` each.
    /// `memoFolders` (1.43, 메모 서랍): memo id → its folder's name (memos in 메모 left out). A memo whose words don't match
    /// but whose folder's name does comes too (its title, nothing marked), and every memo hit names its folder.
    public static func find(_ query: String, items: [TodoItem], memos: [Memo], history: [ArchiveEntry], events: [EventEntry],
                            now: Date, calendar: Calendar = .paper, language: AppLanguage = .ko, limit: Int = Search.limit,
                            memoFolders: [String: String] = [:]) -> [(group: Group, hits: [Hit])] {
        guard !cleanQuery(query).isEmpty else { return [] }
        let todayKey = Archive.dayKey(now, calendar: calendar)
        let thisYear = calendar.component(.year, from: Archive.logicalDayStart(now, calendar: calendar))
        func dayText(_ date: Date) -> String {
            let p = calendar.dateComponents([.year, .month, .day], from: date)
            return language.dayMonth(month: p.month!, day: p.day!, year: p.year == thisYear ? nil : p.year)
        }
        func taskDetail(_ item: TodoItem) -> String {
            // 1.39: the time range after the day ("10월 12일 · 14:00–15:30"), in place of the reminder's clock.
            if let range = item.timeRange {
                let day = item.dueDate.map { Deadline.label($0, style: .date, now: now, calendar: calendar, language: language) }
                return (day.map { $0 + " · " } ?? "") + range.text(language)
            }
            if let due = item.dueDate { return Deadline.label(due, style: .date, now: now, calendar: calendar, language: language) }
            if let at = item.reminderAt {
                let p = calendar.dateComponents([.hour, .minute], from: at)
                let clock = language.clock(hour: p.hour!, minute: p.minute!)
                return Archive.dayKey(at, calendar: calendar) == todayKey ? clock : language.shortDate(at, calendar: calendar) + " " + clock
            }
            return ""
        }
        func taskHit(_ item: TodoItem, _ group: Group) -> Hit? {
            match(query, in: item.title).map {
                Hit(group: group, id: item.id.uuidString, text: item.title, range: $0, detail: taskDetail(item), done: item.isCompleted, day: item.dueDate)
            }
        }

        var groups: [(group: Group, hits: [Hit])] = []
        func add(_ group: Group, _ hits: [Hit]) {
            if !hits.isEmpty { groups.append((group, Array(hits.prefix(group == .history ? max(limit, historyLimit) : limit)))) }
        }

        let onToday = items.filter { Shelf.page(of: $0, now: now, calendar: calendar) == .today }
        add(.today, (onToday.filter { !$0.isCompleted } + onToday.filter(\.isCompleted)).compactMap { taskHit($0, .today) })

        let ahead = items.enumerated().filter { Shelf.page(of: $0.element, now: now, calendar: calendar) != .today }
        let dated = ahead.filter { $0.element.dueDate != nil }.sorted { ($0.element.dueDate!, $0.offset) < ($1.element.dueDate!, $1.offset) }
        let someday = ahead.filter { $0.element.dueDate == nil }
        add(.ahead, (dated + someday).compactMap { taskHit($0.element, .ahead) })

        add(.memos, memos.sorted { $0.updatedAt > $1.updatedAt }.compactMap { memo in
            let folder = memoFolders[memo.id]
            let detail = folder.map { $0 + " · " + dayText(memo.updatedAt) } ?? dayText(memo.updatedAt)
            // The title line if it matches, else the first line that does.
            for line in memo.text.split(whereSeparator: \.isNewline) {
                let text = line.trimmingCharacters(in: .whitespaces)
                if let range = match(query, in: text) {
                    return Hit(group: .memos, id: memo.id, text: text, range: range, detail: detail, done: false, day: nil)
                }
            }
            if let folder, match(query, in: folder) != nil {
                return Hit(group: .memos, id: memo.id, text: memo.title(language), range: 0..<0, detail: detail, done: false, day: nil)
            }
            return nil
        })

        add(.history, history.sorted { ($0.completedAt ?? .distantPast) > ($1.completedAt ?? .distantPast) }.compactMap { entry in
            match(query, in: entry.title).map {
                Hit(group: .history, id: entry.id, text: entry.title, range: $0, detail: entry.completedAt.map(dayText) ?? "",
                    done: true, day: entry.completedAt.map { Archive.dayKey($0, calendar: calendar) })
            }
        })

        let coming = events.filter { $0.date >= todayKey }.sorted { $0.date < $1.date }
        let past = events.filter { $0.date < todayKey }.sorted { $0.date > $1.date }
        add(.events, (coming + past).compactMap { event in
            let range = match(query, in: event.title) ?? event.location.flatMap { match(query, in: $0) }.map { _ in 0..<0 }
            return range.map { range in
                let detail = Deadline.date(from: event.date, calendar: calendar).map { language.shortDate($0, calendar: calendar) } ?? event.date
                return Hit(group: .events, id: event.id, text: event.title, range: range, detail: detail, done: false, day: event.date)
            }
        })
        return groups
    }

    /// "‘보고서’에 맞는 게 없어요" · "Nothing matches ‘report’" · "Niets gevonden voor ‘rapport’".
    public static func emptyText(_ query: String, language: AppLanguage = .ko) -> String {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return ["‘\(q)’에 맞는 게 없어요", "Nothing matches ‘\(q)’", "Niets gevonden voor ‘\(q)’"][language.index]
    }
}

// MARK: - 하루 띠: a click on the empty track

extension DayRibbon {
    /// Where a click on the track (0…1) lands as a new event's start: rounded to 15 minutes, never
    /// before the track's start nor later than an hour before its end. The day is today's (by the
    /// 4 a.m. rule); past midnight it's the next calendar day.
    public static func slot(at fraction: Double, startHour: Int, endHour: Int, now: Date, calendar: Calendar = .paper) -> (date: String, minutes: Int) {
        let span = Double(endHour - startHour) * 60
        var total = Int((Double(startHour * 60) + min(1, max(0, fraction)) * span) / 15 + 0.5) * 15
        total = min(max(total, startHour * 60), endHour * 60 - 60)
        let midnight = calendar.startOfDay(for: Archive.logicalDayStart(now, calendar: calendar))
        let day = calendar.date(byAdding: .day, value: total / 1440, to: midnight)!
        return (Deadline.key(day, calendar: calendar), total % 1440)
    }
}
