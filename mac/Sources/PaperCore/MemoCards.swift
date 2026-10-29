import Foundation

/// 메모 서랍's list (1.44, design ③ 날짜 묶음 + 카드): what a card says — its title, one preview line, the kind found in
/// its text (checklist, link, phone; the text never changes) — the date groups the list falls into, and the short
/// times. Same rules and cases (D21–D27) as the Windows app.
public enum MemoCards {
    // MARK: Kinds (D25, D26)

    public enum Kind: Equatable, Sendable {
        /// The checklist's ticked and all lines (the chip says `2/4`, a bar beside it).
        case checklist(done: Int, total: Int)
        /// The URL as written (opened on click) and the chip's `host/path`.
        case link(url: String, label: String)
        /// `010-1234-5678` (shown and copied).
        case phone(String)
    }

    /// The first kind found, checklist before link before phone; nil for plain text.
    public static func kind(_ text: String) -> Kind? {
        if let progress = Checklist.progress(text) { return .checklist(done: progress.done, total: progress.total) }
        if let link = link(in: text) { return .link(url: link.url, label: link.label) }
        if let phone = phone(in: text) { return .phone(phone) }
        return nil
    }

    private static let urlPattern = try! NSRegularExpression(pattern: "https?://\\S+", options: [.caseInsensitive])
    private static let trailing: Set<Character> = [".", ",", ";", ":", "!", "?", ")", "]", "}", ">", "'", "\"", "’", "”"]

    /// The first link with a host: trailing punctuation taken off; the chip's label is the host (lower-case, no
    /// `www.`) and the path (no trailing `/`), without its query or fragment.
    public static func link(in text: String) -> (url: String, label: String)? {
        let range = NSRange(text.startIndex..., in: text)
        for match in urlPattern.matches(in: text, range: range) {
            guard let found = Range(match.range, in: text) else { continue }
            var url = String(text[found])
            while let last = url.last, trailing.contains(last) { url.removeLast() }
            if let label = label(url) { return (url, label) }
        }
        return nil
    }

    /// `youtube.com/watch` for `https://www.youtube.com/watch?v=…`; nil without a host.
    static func label(_ url: String) -> String? {
        guard let scheme = url.range(of: "://") else { return nil }
        let rest = url[scheme.upperBound...]
        let end = rest.firstIndex { $0 == "/" || $0 == "?" || $0 == "#" } ?? rest.endIndex
        var host = String(rest[..<end])
        if let at = host.lastIndex(of: "@") { host = String(host[host.index(after: at)...]) }
        if let colon = host.lastIndex(of: ":") { host = String(host[..<colon]) }
        host = host.lowercased()
        if host.hasPrefix("www.") { host = String(host.dropFirst(4)) }
        guard !host.isEmpty else { return nil }
        var path = ""
        if end < rest.endIndex, rest[end] == "/" {
            let tail = rest[end...]
            let stop = tail.firstIndex { $0 == "?" || $0 == "#" } ?? tail.endIndex
            path = String(tail[..<stop])
            while path.hasSuffix("/") { path.removeLast() }
        }
        return host + path
    }

    private static let phonePattern = try! NSRegularExpression(pattern: "(?<!\\d)0\\d{1,2}[ .-]?\\d{3,4}[ .-]?\\d{4}(?!\\d)")

    /// A Korean phone number (9–11 digits starting with 0) as `010-1234-5678` / `02-123-4567`.
    public static func phone(in text: String) -> String? {
        let range = NSRange(text.startIndex..., in: text)
        for match in phonePattern.matches(in: text, range: range) {
            guard let found = Range(match.range, in: text) else { continue }
            let digits = text[found].filter(\.isASCII).filter(\.isNumber)
            guard (9...11).contains(digits.count) else { continue }
            let area = digits.hasPrefix("02") ? 2 : 3
            guard area == 2 || digits.count >= 10 else { continue }
            let head = digits.prefix(area), last = digits.suffix(4)
            let middle = digits.dropFirst(area).dropLast(4)
            return "\(head)-\(middle)-\(last)"
        }
        return nil
    }

    // MARK: What a card says

    /// The card's title: the memo's first line (a checklist's box taken off), or `youtube.com 링크` when that line is
    /// only a link (D25b).
    public static func title(_ text: String, language: AppLanguage = .ko) -> String {
        let title = Checklist.summary(text, language: language).title
        if titleIsLink(title), let label = label(stripped(title)) {
            let host = label.split(separator: "/", maxSplits: 1).first.map(String.init) ?? label
            return ["\(host) 링크", "\(host) link", "\(host)-link"][language.index]
        }
        return title
    }

    static func titleIsLink(_ line: String) -> Bool {
        let lower = line.lowercased()
        return (lower.hasPrefix("http://") || lower.hasPrefix("https://")) && !line.contains(where: \.isWhitespace)
    }

    private static func stripped(_ url: String) -> String {
        var url = url
        while let last = url.last, trailing.contains(last) { url.removeLast() }
        return url
    }

    /// One line under the title: the first non-empty line after it that isn't a checklist line; nil when there's none.
    public static func preview(_ text: String) -> String? {
        let lines = Checklist.split(text)
        guard let start = lines.firstIndex(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else { return nil }
        for line in lines[(start + 1)...] {
            let body = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if body.isEmpty || Checklist.parse(line) != nil { continue }
            return body
        }
        return nil
    }

    // MARK: Groups (D22–D24)

    public enum Group: Hashable, Sendable {
        /// The folder's pinned memos, first.
        case pinned
        case today, yesterday, thisWeek, lastWeek
        case month(year: Int, month: Int)
        /// 제목 순: the memos after the 고정 group (one header `메모`).
        case rest
    }

    /// Weeks start on Monday in every language; a time on a later day than today (another device's clock) is 오늘.
    public static func group(_ date: Date, now: Date, calendar: Calendar = .current) -> Group {
        let today = calendar.startOfDay(for: now), day = calendar.startOfDay(for: date)
        if day >= today { return .today }
        if calendar.date(byAdding: .day, value: -1, to: today) == day { return .yesterday }
        let sinceMonday = (calendar.component(.weekday, from: today) + 5) % 7
        let monday = calendar.date(byAdding: .day, value: -sinceMonday, to: today)!
        if day >= monday { return .thisWeek }
        if day >= calendar.date(byAdding: .day, value: -7, to: monday)! { return .lastWeek }
        let p = calendar.dateComponents([.year, .month], from: date)
        return .month(year: p.year!, month: p.month!)
    }

    /// `고정` · `오늘` · `어제` · `이번 주` · `지난주` · `10월` · `2025년 9월` (en Pinned · Today · Yesterday · This week ·
    /// Last week · October · September 2025; nl Vastgezet · Vandaag · Gisteren · Deze week · Vorige week · oktober ·
    /// september 2025).
    public static func header(_ group: Group, now: Date, calendar: Calendar = .current, language: AppLanguage = .ko) -> String {
        switch group {
        case .pinned: return ["고정", "Pinned", "Vastgezet"][language.index]
        case .today: return ["오늘", "Today", "Vandaag"][language.index]
        case .yesterday: return ["어제", "Yesterday", "Gisteren"][language.index]
        case .thisWeek: return ["이번 주", "This week", "Deze week"][language.index]
        case .lastWeek: return ["지난주", "Last week", "Vorige week"][language.index]
        case .rest: return MemoFolders.inboxNames[language.index]
        case .month(let year, let month):
            return year == calendar.component(.year, from: now) ? language.monthName(month) : language.monthTitle(year: year, month: month)
        }
    }

    /// The card's time under a date header: 오늘/어제 the clock (`오후 6:02` · `6:02 PM` · `18:02`), this or last week the
    /// weekday (`화요일`), a month this year the day (`13일` · `Oct 13` · `13 okt`), earlier years `9월 13일`. In the
    /// 고정 group and without headers it says the day (`dayTime`).
    public static func shortTime(_ date: Date, in group: Group, now: Date, calendar: Calendar = .current, language: AppLanguage = .ko) -> String {
        let p = calendar.dateComponents([.year, .month, .day, .hour, .minute, .weekday], from: date)
        switch group {
        case .today, .yesterday: return language.spokenTime(hour: p.hour!, minute: p.minute!)
        case .thisWeek, .lastWeek: return language.weekdayName(p.weekday! - 1)
        case .month(let year, _):
            if year != calendar.component(.year, from: now) { return language.dayMonth(month: p.month!, day: p.day!) }
            return language == .ko ? "\(p.day!)일" : language.dayMonth(month: p.month!, day: p.day!)
        case .pinned, .rest: return dayTime(date, now: now, calendar: calendar, language: language)
        }
    }

    /// A time that says its day: today the clock, `어제`, `10월 13일`, `2025년 10월 13일`.
    public static func dayTime(_ date: Date, now: Date, calendar: Calendar = .current, language: AppLanguage = .ko) -> String {
        let p = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        switch group(date, now: now, calendar: calendar) {
        case .today: return language.spokenTime(hour: p.hour!, minute: p.minute!)
        case .yesterday: return ["어제", "Yesterday", "Gisteren"][language.index]
        default:
            let thisYear = p.year == calendar.component(.year, from: now)
            return language.dayMonth(month: p.month!, day: p.day!, year: thisYear ? nil : p.year)
        }
    }

    /// The open memo's bar: `오후 5:38 고침` · `Edited 5:38 PM` · `Bewerkt 17:38`; `어제 고침`; `화요일 고침`;
    /// `10월 13일 고침`; `2025년 10월 13일 고침`.
    public static func edited(_ date: Date, now: Date, calendar: Calendar = .current, language: AppLanguage = .ko) -> String {
        let p = calendar.dateComponents([.year, .month, .day, .hour, .minute, .weekday], from: date)
        let when: String
        var leadsInDutch = false
        switch group(date, now: now, calendar: calendar) {
        case .today: when = language.spokenTime(hour: p.hour!, minute: p.minute!)
        case .yesterday:
            when = ["어제", "yesterday", "Gisteren"][language.index]
            leadsInDutch = true
        case .thisWeek, .lastWeek:
            let name = language.weekdayName(p.weekday! - 1)
            when = language == .nl ? name.prefix(1).uppercased() + name.dropFirst() : name
            leadsInDutch = true
        default:
            let thisYear = p.year == calendar.component(.year, from: now)
            when = language.dayMonth(month: p.month!, day: p.day!, year: thisYear ? nil : p.year)
        }
        switch language {
        case .ko: return "\(when) 고침"
        case .en: return "Edited \(when)"
        case .nl: return leadsInDutch ? "\(when) bewerkt" : "Bewerkt \(when)"
        }
    }

    // MARK: The list (D23, D24)

    /// One memo as the list sorts it (the app passes the times it froze while a memo is open).
    public struct Entry: Equatable, Sendable {
        public var id: String
        /// The time the list is sorted by: `updatedAt` (고친 순) or `createdAt` (만든 순).
        public var date: Date
        public var updatedAt: Date
        public var title: String
        public var pinned: Bool

        public init(id: String, date: Date, updatedAt: Date, title: String, pinned: Bool) {
            self.id = id
            self.date = date
            self.updatedAt = updatedAt
            self.title = title
            self.pinned = pinned
        }
    }

    public struct Section: Equatable, Sendable {
        public var group: Group
        public var ids: [String]
    }

    /// The list in its groups: 고정 first (when `pinnedGroup`, i.e. not the 고정 bookmark's own view), then by date
    /// (newest first) — or for 제목 순 by title, after 고정 one `rest` group (no header when nothing is pinned).
    public static func sections(_ entries: [Entry], sort: MemoFolders.Sort, pinnedGroup: Bool, now: Date, calendar: Calendar = .current) -> [Section] {
        let ordered = sorted(entries, sort: sort)
        var out: [Section] = []
        func add(_ group: Group, _ id: String) {
            if out.last?.group == group { out[out.count - 1].ids.append(id) } else { out.append(Section(group: group, ids: [id])) }
        }
        if pinnedGroup { for entry in ordered where entry.pinned { add(.pinned, entry.id) } }
        for entry in ordered where !(pinnedGroup && entry.pinned) {
            add(sort == .title ? .rest : group(entry.date, now: now, calendar: calendar), entry.id)
        }
        return out
    }

    /// 고친 순 / 만든 순: newest first. 제목 순: the title, case-insensitive, numbers by value (Unicode order otherwise:
    /// digits, Latin, Hangul); a tie, the newer edit first.
    public static func sorted(_ entries: [Entry], sort: MemoFolders.Sort) -> [Entry] {
        entries.enumerated().sorted { a, b in
            let x = a.element, y = b.element
            if sort == .title {
                let order = x.title.compare(y.title, options: [.caseInsensitive, .numeric])
                if order != .orderedSame { return order == .orderedAscending }
                if x.updatedAt != y.updatedAt { return x.updatedAt > y.updatedAt }
            } else if x.date != y.date {
                return x.date > y.date
            }
            return a.offset < b.offset
        }.map(\.element)
    }
}
