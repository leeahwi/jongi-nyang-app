import Foundation

/// 음력과 공휴일 (#234): the Korean lunar date of a day and Korea's public holidays, worked out on the device with no
/// network. The lunar calendar is ICU's Korean one (`dangi`, Korea's own months — the Chinese calendar differs on a few
/// days, e.g. it puts 설날 2027 a day late); the Windows app asks the same ICU calendar through `Intl.DateTimeFormat`
/// (core/koreanCalendar.ts), and the two agree on every day of 2020–2035. Holidays follow 관공서의 공휴일에 관한 규정
/// (substitute days for 설날 · 추석 since 2014, 어린이날 since 2014, 삼일절 · 광복절 · 개천절 · 한글날 since 2021,
/// 부처님오신날 · 성탄절 since 2023); one-off days (elections, temporary holidays) can't be worked out, so the ones known
/// are listed here and new ones come with app updates. Shared cases: docs/plans/calendar-korean-cases.json.
public enum KoreanCalendar {
    // MARK: Lunar dates

    public struct Lunar: Equatable, Sendable {
        public var month: Int
        public var day: Int
        /// 윤달.
        public var leap: Bool

        public init(month: Int, day: Int, leap: Bool = false) {
            self.month = month; self.day = day; self.leap = leap
        }
    }

    /// The lunar date of a calendar day ("yyyy-MM-dd"), as Korea counts it (Korea's time), whatever the device's zone.
    public static func lunar(_ day: String) -> Lunar? {
        let p = day.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3, let date = seoulGregorian.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12)) else { return nil }
        let c = dangi.dateComponents([.month, .day, .isLeapMonth], from: date)
        guard let month = c.month, let day = c.day else { return nil }
        return Lunar(month: month, day: day, leap: c.isLeapMonth ?? false)
    }

    /// The small label in a day's cell: "9.18"; the 1st of a lunar month marked — "음 9.1", "윤 4.1" (a leap month);
    /// en · nl "☾ 9.1". #295 `short`: without the mark ("10.1"), where the head is short of room (+N beside it).
    public static func lunarLabel(_ lunar: Lunar, language: AppLanguage = .ko, short: Bool = false) -> String {
        guard lunar.day == 1, !short else { return "\(lunar.month).\(lunar.day)" }
        switch language {
        case .ko: return (lunar.leap ? "윤 " : "음 ") + "\(lunar.month).1"
        case .en, .nl: return "☾ \(lunar.month).1"
        }
    }

    /// Its spoken form and tooltip: "음력 9월 18일", "음력 윤4월 1일" — en "Lunar 9/18", "Lunar leap 4/1"; nl "Maankalender
    /// 18-9", "Maankalender schrikkel 1-4".
    public static func lunarSpoken(_ lunar: Lunar, language: AppLanguage = .ko) -> String {
        switch language {
        case .ko: return "음력 " + (lunar.leap ? "윤" : "") + "\(lunar.month)월 \(lunar.day)일"
        case .en: return "Lunar " + (lunar.leap ? "leap " : "") + "\(lunar.month)/\(lunar.day)"
        case .nl: return "Maankalender " + (lunar.leap ? "schrikkel " : "") + "\(lunar.day)-\(lunar.month)"
        }
    }

    // MARK: Holidays

    public enum Name: String, CaseIterable, Sendable {
        case newYear, seollal, independence, children, buddha, memorial, liberation, chuseok, foundation, hangul, christmas
        case substitute, election, temporary

        /// "삼일절", "Independence Movement Day", "Onafhankelijkheidsdag".
        public func text(_ language: AppLanguage = .ko) -> String {
            let words: [Name: [String]] = [
                .newYear: ["신정", "New Year’s Day", "Nieuwjaarsdag"],
                .seollal: ["설날", "Seollal", "Seollal"],
                .independence: ["삼일절", "Independence Movement Day", "Onafhankelijkheidsdag"],
                .children: ["어린이날", "Children’s Day", "Kinderdag"],
                .buddha: ["부처님오신날", "Buddha’s Birthday", "Boeddha’s verjaardag"],
                .memorial: ["현충일", "Memorial Day", "Herdenkingsdag"],
                .liberation: ["광복절", "Liberation Day", "Bevrijdingsdag"],
                .chuseok: ["추석", "Chuseok", "Chuseok"],
                .foundation: ["개천절", "National Foundation Day", "Stichtingsdag"],
                .hangul: ["한글날", "Hangul Day", "Hangeuldag"],
                .christmas: ["성탄절", "Christmas Day", "Eerste kerstdag"],
                .substitute: ["대체공휴일", "Substitute holiday", "Vervangende vrije dag"],
                .election: ["선거일", "Election Day", "Verkiezingsdag"],
                .temporary: ["임시공휴일", "Extra holiday", "Extra vrije dag"],
            ]
            return words[self]![language.index]
        }

        /// #260: `text` as a month cell draws it — English and Dutch with soft hyphens (U+00AD) where the name may break
        /// onto a second line ("Han-/geuldag"), the same places as on Windows (docs/plans/calendar-flows-cases.json); Korean
        /// as it is.
        public func shown(_ language: AppLanguage = .ko) -> String {
            guard language != .ko else { return text(language) }
            let marked: [Name: [String]] = [
                .newYear: ["New Year’s Day", "Nieuw|jaars|dag"],
                .seollal: ["Seol|lal", "Seol|lal"],
                .independence: ["In|de|pen|dence Move|ment Day", "On|af|han|ke|lijk|heids|dag"],
                .children: ["Chil|dren’s Day", "Kin|der|dag"],
                .buddha: ["Bud|dha’s Birth|day", "Boed|dha’s ver|jaar|dag"],
                .memorial: ["Me|mo|ri|al Day", "Her|den|kings|dag"],
                .liberation: ["Lib|er|a|tion Day", "Be|vrij|dings|dag"],
                .chuseok: ["Chu|seok", "Chu|seok"],
                .foundation: ["Na|tion|al Foun|da|tion Day", "Stich|tings|dag"],
                .hangul: ["Han|gul Day", "Han|geul|dag"],
                .christmas: ["Christ|mas Day", "Eer|ste kerst|dag"],
                .substitute: ["Sub|sti|tute hol|i|day", "Ver|van|gen|de vrije dag"],
                .election: ["Elec|tion Day", "Ver|kie|zings|dag"],
                .temporary: ["Ex|tra hol|i|day", "Ex|tra vrije dag"],
            ]
            return marked[self]![language.index - 1].replacingOccurrences(of: "|", with: "\u{00AD}")
        }
    }

    /// Days off that no rule gives: elections and temporary holidays, 2020–2026. New ones come with app updates.
    public static let oneOff: [String: Name] = [
        "2020-04-15": .election, "2020-08-17": .temporary, "2022-03-09": .election, "2022-06-01": .election,
        "2023-10-02": .temporary, "2024-04-10": .election, "2024-10-01": .temporary, "2025-01-27": .temporary,
        "2025-06-03": .election, "2026-06-03": .election,
    ]

    /// Every holiday of a year, by day ("yyyy-MM-dd") — a day may have two (어린이날 and 부처님오신날 in 2025).
    public static func holidays(year: Int) -> [String: [Name]] {
        if let known = cache.value(year) { return known }
        var days: [String: [Name]] = [:]
        func add(_ day: String, _ name: Name) { days[day, default: []].append(name) }
        func key(_ month: Int, _ day: Int) -> String { String(format: "%04d-%02d-%02d", year, month, day) }
        // Fixed days.
        let fixed: [(Int, Int, Name)] = [(1, 1, .newYear), (3, 1, .independence), (5, 5, .children), (6, 6, .memorial), (8, 15, .liberation),
                                         (10, 3, .foundation), (10, 9, .hangul), (12, 25, .christmas)]
        for (month, day, name) in fixed { add(key(month, day), name) }
        // Lunar days: 설날 (the day before, the day, the day after), 부처님오신날, 추석 (the 14th to the 16th).
        let seollal = solar(lunarMonth: 1, day: 1, year: year)
        let buddha = solar(lunarMonth: 4, day: 8, year: year)
        let chuseok = solar(lunarMonth: 8, day: 15, year: year)
        let seollalDays = seollal.map { [shift($0, -1), $0, shift($0, 1)] } ?? []
        let chuseokDays = chuseok.map { [shift($0, -1), $0, shift($0, 1)] } ?? []
        for day in seollalDays { add(day, .seollal) }
        if let buddha { add(buddha, .buddha) }
        for day in chuseokDays { add(day, .chuseok) }
        for (day, name) in oneOff where day.hasPrefix("\(year)-") { add(day, name) }

        // 대체공휴일: each occasion that falls on a day off gives the first weekday after it that is no holiday.
        var taken = Set(days.keys)
        func next(after day: String) -> String {
            var candidate = shift(day, 1)
            while weekday(candidate) == 0 || weekday(candidate) == 6 || taken.contains(candidate) { candidate = shift(candidate, 1) }
            return candidate
        }
        func others(_ day: String, _ name: Name) -> Bool { (days[day] ?? []).contains { $0 != name } }
        // Each day off a holiday falls on gives one substitute, after the holiday (after the three days of 설날 · 추석);
        // a day two holidays share counts once (2017 추석 · 개천절, 2025 어린이날 · 부처님오신날: one day each).
        var overlaps: [String: String] = [:]
        for (block, name) in [(seollalDays, Name.seollal), (chuseokDays, Name.chuseok)] where year >= 2014 {
            // A Sunday or another holiday in the three days (not a Saturday).
            for day in block where weekday(day) == 0 || others(day, name) { overlaps[day] = max(overlaps[day] ?? "", block.last!) }
        }
        var weekend: [(String, Name, Int)] = [(key(5, 5), .children, 2014)]
        weekend += [(key(3, 1), .independence, 2021), (key(8, 15), .liberation, 2021), (key(10, 3), .foundation, 2021), (key(10, 9), .hangul, 2021),
                    (key(12, 25), .christmas, 2023)]
        if let buddha { weekend.append((buddha, .buddha, 2023)) }
        for (day, name, since) in weekend {
            if year < since { continue }
            // 부처님오신날 · 성탄절: from 4 May 2023 (부처님오신날 2023 is the first).
            if (name == .buddha || name == .christmas) && day < "2023-05-04" { continue }
            // A Saturday, a Sunday or another holiday on the day.
            if weekday(day) == 0 || weekday(day) == 6 || others(day, name) { overlaps[day] = max(overlaps[day] ?? "", day) }
        }
        for after in overlaps.values.sorted() {
            let day = next(after: after)
            add(day, .substitute)
            taken.insert(day)
        }
        cache.store(year, days)
        return days
    }

    /// The holidays on a day, in the order the year lists them.
    public static func names(on day: String) -> [Name] {
        guard let year = Int(day.prefix(4)) else { return [] }
        return holidays(year: year)[day] ?? []
    }

    /// "어린이날 · 부처님오신날", nil for a day that is no holiday.
    /// `shown` (#260): the names as a month cell draws them (`Name.shown`).
    public static func label(on day: String, language: AppLanguage = .ko, shown: Bool = false) -> String? {
        let names = names(on: day)
        return names.isEmpty ? nil : names.map { shown ? $0.shown(language) : $0.text(language) }.joined(separator: " · ")
    }

    // MARK: Helpers

    /// The day of the year whose lunar date is that day of that month (not a leap month).
    static func solar(lunarMonth: Int, day: Int, year: Int) -> String? {
        var date = seoulGregorian.date(from: DateComponents(year: year, month: 1, day: 1, hour: 12))!
        for _ in 0..<366 {
            let c = dangi.dateComponents([.month, .day, .isLeapMonth], from: date)
            if c.month == lunarMonth, c.day == day, c.isLeapMonth != true {
                let g = seoulGregorian.dateComponents([.year, .month, .day], from: date)
                if g.year == year { return String(format: "%04d-%02d-%02d", g.year!, g.month!, g.day!) }
            }
            date = seoulGregorian.date(byAdding: .day, value: 1, to: date)!
        }
        return nil
    }

    static func shift(_ day: String, _ count: Int) -> String {
        let p = day.split(separator: "-").compactMap { Int($0) }
        let date = seoulGregorian.date(from: DateComponents(year: p[0], month: p[1], day: p[2] + count, hour: 12))!
        let g = seoulGregorian.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", g.year!, g.month!, g.day!)
    }

    /// 0 = Sunday … 6 = Saturday.
    static func weekday(_ day: String) -> Int {
        let p = day.split(separator: "-").compactMap { Int($0) }
        let date = seoulGregorian.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12))!
        return seoulGregorian.component(.weekday, from: date) - 1
    }

    private static let seoul = TimeZone(identifier: "Asia/Seoul")!
    private static let seoulGregorian: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = seoul
        return calendar
    }()
    /// ICU's Korean lunar calendar (Foundation names only the Chinese one; NSCalendar takes ICU's `dangi`).
    private static let dangi: Calendar = {
        var calendar = (NSCalendar(identifier: NSCalendar.Identifier("dangi")) as Calendar?) ?? Calendar(identifier: .chinese)
        calendar.timeZone = seoul
        return calendar
    }()

    private final class YearCache: @unchecked Sendable {
        private var years: [Int: [String: [Name]]] = [:]
        private let lock = NSLock()
        func value(_ year: Int) -> [String: [Name]]? { lock.lock(); defer { lock.unlock() }; return years[year] }
        func store(_ year: Int, _ days: [String: [Name]]) { lock.lock(); years[year] = days; lock.unlock() }
    }
    private static let cache = YearCache()
}
