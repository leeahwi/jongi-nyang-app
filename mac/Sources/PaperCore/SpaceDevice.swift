import Foundation

// MARK: - 기기마다 보일 스페이스 (#196, docs/plans/spaces-device.md)

/// Which spaces this device shows: 보이기 (no entry), 숨기기, or 시간 정하기 — shown only inside one of its time ranges.
/// A device setting (`spaces.device`), never in the shared todo-spaces.json; keyed by space id, `none` for 일반.
/// Pure: the app asks what is hidden now and filters with it. The same rules as Windows `core/spaceDevice.ts`,
/// checked against the shared cases S60–S72 (`spaces-cases.json` → `device`).
public enum SpaceDevice {
    /// 일반's key (the lens's word for it too).
    public static let none = SpaceLens.none
    /// D3: at most this many time ranges are read per space.
    public static let maxTimes = 12
    /// D14: the desk row and the menu hint use the short form when the long one has more characters than this.
    public static let fitLength = 24

    /// One time range: days 1 Monday … 7 Sunday, from–to in minutes of the day. `to` before `from` runs past midnight
    /// (it belongs to the day it starts on); `to == from` is the whole day from `from` (D2).
    public struct Times: Equatable, Hashable, Sendable {
        public var days: [Int]
        public var from: Int
        public var to: Int

        public init(days: [Int], from: Int, to: Int) {
            self.days = Array(Set(days.filter { (1...7).contains($0) })).sorted()
            self.from = from
            self.to = to
        }

        /// Ends the next day (`22:00–06:00`).
        public var crossesMidnight: Bool { to < from }
        /// The whole day from `from` (`00:00–00:00`).
        public var wholeDay: Bool { to == from }

        /// D2: whether this range holds `minute` (0–1439) on `day` (1–7).
        public func holds(day: Int, minute: Int) -> Bool {
            let yesterday = day == 1 ? 7 : day - 1
            if from < to { return days.contains(day) && minute >= from && minute < to }
            // Past midnight or the whole day: from `from` on its day, and before `to` (or `from`) the day after.
            return (days.contains(day) && minute >= from) || (days.contains(yesterday) && minute < (wholeDay ? from : to))
        }
    }

    public enum Rule: Equatable, Sendable {
        case hide
        case times([Times])

        /// D1 · D3: whether a space with this rule (nil: 보이기) shows at `minute` on `day`.
        public func shows(day: Int, minute: Int) -> Bool {
            switch self {
            case .hide: false
            case .times(let ranges): ranges.contains { $0.holds(day: day, minute: minute) }
            }
        }
    }

    public typealias Rules = [String: Rule]

    /// The setting's key for a to-do's space (nil: 일반).
    public static func key(_ spaceID: String?) -> String { spaceID ?? none }

    // MARK: Reading and writing the setting (D5)

    /// "09:00" → 540; nil unless it is `HH:mm` from 00:00 to 23:59.
    public static func minutes(_ value: Any?) -> Int? {
        guard let text = value as? String, text.count == 5, text.utf8.dropFirst(2).first == UInt8(ascii: ":") else { return nil }
        let digits = Array(text.utf8)
        func digit(_ index: Int) -> Int? {
            let byte = digits[index]
            return (48...57).contains(byte) ? Int(byte) - 48 : nil
        }
        guard let h1 = digit(0), let h2 = digit(1), let m1 = digit(3), let m2 = digit(4) else { return nil }
        let hour = h1 * 10 + h2, minute = m1 * 10 + m2
        guard hour < 24, minute < 60 else { return nil }
        return hour * 60 + minute
    }

    /// 540 → "09:00".
    public static func clockText(_ minutes: Int) -> String {
        let hour = minutes / 60, minute = minutes % 60
        return (hour < 10 ? "0" : "") + "\(hour):" + (minute < 10 ? "0" : "") + "\(minute)"
    }

    /// One range as stored, or nil when it isn't one (no days, a day outside 1–7, a time not `HH:mm`).
    static func readTimes(_ value: Any?) -> Times? {
        guard let entry = value as? [String: Any], let days = entry["days"] as? [Any], !days.isEmpty,
              let from = minutes(entry["from"]), let to = minutes(entry["to"]) else { return nil }
        var read: [Int] = []
        for day in days {
            // JSON numbers come as NSNumber; a Bool is one too, and is not a day.
            guard let number = day as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                  number.doubleValue == number.doubleValue.rounded(), (1...7).contains(number.intValue) else { return nil }
            read.append(number.intValue)
        }
        return Times(days: read, from: from, to: to)
    }

    /// The setting as stored (a JSON object) → the rules; anything that doesn't read is left out (shown) (S65).
    public static func read(_ value: Any?) -> Rules {
        guard let object = value as? [String: Any] else { return [:] }
        var rules: Rules = [:]
        for (key, entry) in object where !key.isEmpty && key.count <= 64 {
            guard let entry = entry as? [String: Any], let show = entry["show"] as? String else { continue }
            switch show {
            case "hide": rules[key] = .hide
            case "time":
                guard let list = entry["times"] as? [Any] else { continue }
                rules[key] = .times(Array(list.compactMap(readTimes).prefix(maxTimes)))
            default: continue
            }
        }
        return rules
    }

    /// The rules as stored (D5's shape).
    public static func plain(_ rules: Rules) -> [String: Any] {
        rules.mapValues { rule -> Any in
            switch rule {
            case .hide: ["show": "hide"]
            case .times(let ranges):
                ["show": "time", "times": ranges.map { ["days": $0.days, "from": clockText($0.from), "to": clockText($0.to)] as [String: Any] }]
            }
        }
    }

    public static func decode(_ data: Data?) -> Rules {
        read(data.flatMap { try? JSONSerialization.jsonObject(with: $0) })
    }

    public static func encode(_ rules: Rules) -> Data {
        (try? JSONSerialization.data(withJSONObject: plain(rules), options: [.sortedKeys])) ?? Data("{}".utf8)
    }

    /// S72: entries for spaces the file no longer has at all go; a tombstone's stays (it can be put back), and 일반's.
    public static func cleaned(_ rules: Rules, spaces: TodoSpaces) -> Rules {
        let known = Set(spaces.spaces.map(\.id))
        return rules.filter { $0.key == none || known.contains($0.key) }
    }

    // MARK: What is hidden now (D1, D4)

    /// D4: a moment on this device's wall clock — the day (1 Monday … 7 Sunday) and the minute of the day.
    public static func moment(_ date: Date, calendar: Calendar = .paper) -> (day: Int, minute: Int) {
        let parts = calendar.dateComponents([.weekday, .hour, .minute], from: date)
        let weekday = parts.weekday ?? 1 // 1 Sunday … 7 Saturday
        return ((weekday + 5) % 7 + 1, (parts.hour ?? 0) * 60 + (parts.minute ?? 0))
    }

    /// Whether a space with `rule` (nil: 보이기) shows at `date`.
    public static func shows(_ rule: Rule?, at date: Date, calendar: Calendar = .paper) -> Bool {
        guard let rule else { return true }
        let now = moment(date, calendar: calendar)
        return rule.shows(day: now.day, minute: now.minute)
    }

    /// The keys hidden at `date`: live spaces' ids and `none` (S66). Nothing when there are no live spaces (D1).
    public static func hidden(_ rules: Rules, spaces: TodoSpaces, at date: Date, calendar: Calendar = .paper) -> Set<String> {
        guard !rules.isEmpty, !spaces.isEmpty else { return [] }
        let now = moment(date, calendar: calendar)
        var out: Set<String> = []
        for (key, rule) in rules where (key == none || spaces.space(key) != nil) && !rule.shows(day: now.day, minute: now.minute) {
            out.insert(key)
        }
        return out
    }

    /// Whether a to-do in `space` (a live space's id; nil, a gone or deleted one: 일반) is hidden (S66).
    public static func isHidden(_ space: String?, in hidden: Set<String>, spaces: TodoSpaces) -> Bool {
        guard !hidden.isEmpty else { return false }
        return hidden.contains(key(spaces.space(space)?.id))
    }

    // MARK: The lens (D7, S68)

    /// The lens as it shows with `hidden` (what the note hides: hidden less the spaces peeked at): a hidden space's
    /// lens lets go.
    public static func lens(_ shown: SpaceLens.Shown, hidden: Set<String>) -> SpaceLens.Shown {
        guard let id = shown.lensID, hidden.contains(id) else { return shown }
        return .all
    }

    /// ⌥⌘1–9 keep the spaces' order; a hidden space's digit does nothing (nil), as a missing one's.
    public static func forDigit(_ digit: Int, spaces: TodoSpaces, hidden: Set<String>) -> SpaceLens.Shown? {
        guard let shown = SpaceLens.forDigit(digit, spaces: spaces) else { return nil }
        if let id = shown.lensID, hidden.contains(id) { return nil }
        return shown
    }

    // MARK: The line at the end of the list (D9, S67)

    /// The spaces the end line names: hidden (or peeked at) ones with an open to-do on that tab, in the spaces' order,
    /// 일반 last. `open` are the tab's open to-dos' keys (`key(_:)` of their live space).
    public static func lineKeys(open: [String], among keys: Set<String>, spaces: TodoSpaces) -> [String] {
        let present = Set(open).intersection(keys)
        guard !present.isEmpty else { return [] }
        return spaces.visible.map(\.id).filter(present.contains) + (present.contains(none) ? [none] : [])
    }

    // MARK: Reminders (D10, S69)

    /// Whether a to-do's reminder rings here: its space shows now and showed at the reminder's time (by the rule now),
    /// and the reminder isn't from before the space was last made visible here (`shownSince`).
    public static func rings(_ rule: Rule?, alert: Date, now: Date, shownSince: Date? = nil, calendar: Calendar = .paper) -> Bool {
        if let shownSince, alert < shownSince { return false }
        return shows(rule, at: now, calendar: calendar) && shows(rule, at: alert, calendar: calendar)
    }

    // MARK: 바로 고르기 (the slip's presets)

    public enum Preset: String, CaseIterable, Sendable {
        case workday, evening, weekend

        public var times: [Times] {
            switch self {
            case .workday: [Times(days: [1, 2, 3, 4, 5], from: 540, to: 1080)]
            case .evening: [Times(days: [1, 2, 3, 4, 5], from: 1140, to: 1380)]
            case .weekend: [Times(days: [6, 7], from: 0, to: 0)]
            }
        }

        public func title(_ language: AppLanguage) -> String {
            switch self {
            case .workday: ["평일 근무 9–18", "Workdays 9–6", "Werkdagen 9–18"][language.index]
            case .evening: ["평일 저녁 19–23", "Weekday evenings 7–11", "Doordeweekse avonden 19–23"][language.index]
            case .weekend: ["주말", "Weekends", "Weekend"][language.index]
            }
        }
    }

    // MARK: Words (D14, §5)

    static let dayNames = [
        ["월", "화", "수", "목", "금", "토", "일"],
        ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        ["ma", "di", "wo", "do", "vr", "za", "zo"],
    ]

    /// A day's short name (1 Monday … 7 Sunday): 월 · Mon · ma.
    public static func dayName(_ day: Int, _ language: AppLanguage) -> String { dayNames[language.index][(day - 1) % 7] }

    /// D14: 매일 · 평일 · 주말, three or more days in a row `월–목`, else joined with `/` (`월/수/금`, `월–수/금`).
    public static func dayWords(_ days: [Int], _ language: AppLanguage) -> String {
        let set = Array(Set(days)).sorted()
        if set == [1, 2, 3, 4, 5, 6, 7] { return ["매일", "every day", "elke dag"][language.index] }
        if set == [1, 2, 3, 4, 5] { return ["평일", "weekdays", "doordeweeks"][language.index] }
        if set == [6, 7] { return ["주말", "weekends", "weekend"][language.index] }
        var parts: [String] = []
        var index = 0
        while index < set.count {
            var end = index
            while end + 1 < set.count, set[end + 1] == set[end] + 1 { end += 1 }
            if end - index >= 2 {
                parts.append(dayName(set[index], language) + "–" + dayName(set[end], language))
            } else {
                parts.append(contentsOf: set[index...end].map { dayName($0, language) })
            }
            index = end + 1
        }
        return parts.joined(separator: "/")
    }

    /// One range's time in the app's clock: "09:00–18:00", "9:00 AM–6:00 PM"; nothing for `00:00–00:00` (the whole day).
    static func timeWords(_ range: Times, _ language: AppLanguage) -> String? {
        if range.wholeDay && range.from == 0 { return nil }
        return language.timeRange(from: (range.from / 60, range.from % 60), to: (range.to / 60, range.to % 60))
    }

    /// The day groups of D14: rows with the same days together, by first day then earliest start; equal rows once.
    static func groups(_ times: [Times]) -> [(days: [Int], ranges: [Times])] {
        var out: [(days: [Int], ranges: [Times])] = []
        for range in times {
            if let index = out.firstIndex(where: { $0.days == range.days }) {
                if !out[index].ranges.contains(range) { out[index].ranges.append(range) }
            } else {
                out.append((range.days, [range]))
            }
        }
        out = out.map { ($0.days, $0.ranges.sorted { $0.from != $1.from ? $0.from < $1.from : $0.to < $1.to }) }
        return out.sorted { a, b in
            let fa = a.days.first ?? 8, fb = b.days.first ?? 8
            return fa != fb ? fa < fb : (a.ranges.first?.from ?? 0) < (b.ranges.first?.from ?? 0)
        }
    }

    /// D14's long form "평일 09:00–12:00, 13:00–18:00 · 토 10:00–14:00", or the short one "평일 2개 시간대 · 토".
    public static func summary(_ times: [Times], _ language: AppLanguage, short: Bool = false) -> String {
        groups(times).map { group in
            let days = dayWords(group.days, language)
            if short {
                guard group.ranges.count > 1 else { return days }
                let n = group.ranges.count
                return [days + " \(n)개 시간대", days + ", \(n) times", days + ", \(n) tijden"][language.index]
            }
            let words = group.ranges.compactMap { timeWords($0, language) }
            return words.isEmpty ? days : days + " " + words.joined(separator: ", ")
        }.joined(separator: " · ")
    }

    /// The form the desk row and the menu hint use: the long one, or the short one past `fitLength` characters.
    public static func fitting(_ times: [Times], _ language: AppLanguage) -> String {
        let long = summary(times, language)
        return long.count <= fitLength ? long : summary(times, language, short: true)
    }

    private static func capitalized(_ text: String) -> String { text.prefix(1).uppercased() + text.dropFirst() }

    /// The slip's sentence: "평일 09:00–18:00에만 보여요" · "Shown only weekdays …" · "Alleen zichtbaar doordeweeks …".
    public static func sentence(_ times: [Times], _ language: AppLanguage) -> String {
        let words = summary(times, language)
        return ["\(words)에만 보여요", "Shown only \(words)", "Alleen zichtbaar \(words)"][language.index]
    }

    /// The menu's hint under a time-ruled space: "지금은 숨김 · 평일 09:00–18:00에 보여요" while hidden, else
    /// "평일 09:00–18:00에만 보여요".
    public static func hint(_ times: [Times], hiddenNow: Bool, _ language: AppLanguage) -> String {
        let words = fitting(times, language)
        if hiddenNow { return ["지금은 숨김 · \(words)에 보여요", "Hidden now · shows \(words)", "Nu verborgen · zichtbaar \(words)"][language.index] }
        return ["\(words)에만 보여요", "Shown only \(words)", "Alleen zichtbaar \(words)"][language.index]
    }

    /// The desk row's line under the name: none for 보이기, "이 기기에서 숨겨 뒀어요", or "평일 09:00–18:00에만 · 지금 보여요".
    public static func status(_ rule: Rule?, hiddenNow: Bool, _ language: AppLanguage) -> String? {
        switch rule {
        case nil: return nil
        case .hide: return ["이 기기에서 숨겨 뒀어요", "Hidden on this device", "Verborgen op dit apparaat"][language.index]
        case .times(let times):
            let words = fitting(times, language)
            switch language {
            case .ko: return "\(words)에만 · " + (hiddenNow ? "지금 숨어 있어요" : "지금 보여요")
            case .en: return capitalized(words) + " only · " + (hiddenNow ? "hidden now" : "showing now")
            case .nl: return "Alleen \(words) · " + (hiddenNow ? "nu verborgen" : "nu zichtbaar")
            }
        }
    }

    /// The slip's second line: "지금(화 20:10)은 숨어 있어요" · "지금(화 20:10) 보여요".
    public static func nowLine(showing: Bool, at date: Date, _ language: AppLanguage, calendar: Calendar = .paper) -> String {
        let now = moment(date, calendar: calendar)
        let at = dayName(now.day, language) + " " + language.clock(hour: now.minute / 60, minute: now.minute % 60)
        switch language {
        case .ko: return showing ? "지금(\(at)) 보여요" : "지금(\(at))은 숨어 있어요"
        case .en: return showing ? "Showing now (\(at))" : "Hidden now (\(at))"
        case .nl: return showing ? "Nu zichtbaar (\(at))" : "Nu verborgen (\(at))"
        }
    }

    /// Names as the end line says them: one or two by name, three or more as a count.
    private static func named(_ names: [String], _ language: AppLanguage) -> (words: String, many: Bool, last: String) {
        if names.count >= 3 {
            let n = names.count
            return (["스페이스 \(n)개", "\(n) spaces", "\(n) ruimtes"][language.index], true, "개")
        }
        return (names.joined(separator: " · "), names.count > 1, names.last ?? "")
    }

    /// D9: "회사는 이 기기에서 숨겨 뒀어요" · "Work is hidden on this device" (then 잠깐 보기).
    public static func line(_ names: [String], _ language: AppLanguage) -> String {
        let said = named(names, language)
        switch language {
        case .ko: return said.words + (SpaceWords.final(said.last) == 0 ? "는" : "은") + " 이 기기에서 숨겨 뒀어요"
        case .en: return said.words + (said.many ? " are" : " is") + " hidden on this device"
        case .nl: return said.words + (said.many ? " zijn" : " is") + " verborgen op dit apparaat"
        }
    }

    /// D6: "회사를 잠깐 보는 중" · "Peeking at Work" · "Werk even zichtbaar" (then 다시 숨기기).
    public static func peeking(_ names: [String], _ language: AppLanguage) -> String {
        let said = named(names, language)
        switch language {
        case .ko: return said.words + SpaceWords.eul(said.last) + " 잠깐 보는 중"
        case .en: return "Peeking at " + said.words
        case .nl: return said.words + " even zichtbaar"
        }
    }

    public static func peekWord(_ language: AppLanguage) -> String { ["잠깐 보기", "Peek", "Even kijken"][language.index] }
    public static func hideAgainWord(_ language: AppLanguage) -> String { ["다시 숨기기", "Hide again", "Weer verbergen"][language.index] }

    /// §5: the words of the desk's popup, the menu and the slip (kept here, with Windows' spaceDevice.ts, so the two
    /// apps say the same).
    public enum Words: String, CaseIterable, Sendable {
        case onThisDevice, show, hide, setTimes, hideHere, hiddenSection, alwaysShow, addTime, nextDay, wholeDay, slipNote
        case noDays, removeTime, start, end, hiddenTag, statusHidden

        public func text(_ language: AppLanguage) -> String {
            switch self {
            case .onThisDevice: ["이 기기에서", "On this device", "Op dit apparaat"][language.index]
            case .show: ["보이기", "Show", "Tonen"][language.index]
            case .hide: ["숨기기", "Hide", "Verbergen"][language.index]
            case .setTimes: ["시간 정하기…", "Set times…", "Tijden instellen…"][language.index]
            case .hideHere: ["이 기기에서 숨기기", "Hide on this device", "Verbergen op dit apparaat"][language.index]
            case .hiddenSection: ["이 기기에서 숨김", "Hidden on this device", "Verborgen op dit apparaat"][language.index]
            case .alwaysShow: ["늘 보이기", "Always show", "Altijd tonen"][language.index]
            case .addTime: ["시간 더하기", "Add a time", "Tijd toevoegen"][language.index]
            case .nextDay: ["다음 날", "next day", "volgende dag"][language.index]
            case .wholeDay: ["하루 전체", "all day", "hele dag"][language.index]
            case .slipNote: ["정한 시간에만 보이고, 다른 때는 숨어요.", "Shown only at these times, hidden the rest of the time.",
                             "Alleen zichtbaar op deze tijden, de rest van de tijd verborgen."][language.index]
            case .noDays: ["요일을 고르지 않은 줄이 있어요.", "A row has no days picked.", "Bij een rij zijn geen dagen gekozen."][language.index]
            case .removeTime: ["이 시간 빼기", "Remove this time", "Deze tijd weghalen"][language.index]
            case .start: ["시작", "Start", "Begin"][language.index]
            case .end: ["끝", "End", "Eind"][language.index]
            case .hiddenTag: ["숨김", "Hidden", "Verborgen"][language.index]
            case .statusHidden: ["이 기기에서 숨겨 뒀어요", "Hidden on this device", "Verborgen op dit apparaat"][language.index]
            }
        }
    }

    /// The slip's title: "회사를 이 기기에서 보일 시간" · "When Work shows on this device".
    public static func slipTitle(_ name: String, _ language: AppLanguage) -> String {
        ["\(name)\(SpaceWords.eul(name)) 이 기기에서 보일 시간", "When \(name) shows on this device", "Wanneer \(name) zichtbaar is op dit apparaat"][language.index]
    }

    /// The desk's footer: "‘이 기기에서’는 이 Mac에만 저장해요. 다른 기기에서는 그대로 보여요." (`device`: Mac or PC).
    public static func deskFooter(_ language: AppLanguage, device: String) -> String {
        switch language {
        case .ko: "‘이 기기에서’는 이 \(device)에만 저장해요. 다른 기기에서는 그대로 보여요."
        case .en: "‘On this device’ is kept on this \(device) only. Other devices still show everything."
        case .nl: "‘Op dit apparaat’ blijft alleen op deze \(device). Andere apparaten tonen alles nog."
        }
    }

    /// The popup's spoken name: "회사, 이 기기에서: 숨기기".
    public static func popupLabel(_ name: String, rule: Rule?, _ language: AppLanguage) -> String {
        let picked: Words = switch rule { case nil: .show; case .hide: .hide; case .times: .setTimes }
        return "\(name), \(Words.onThisDevice.text(language)): " + picked.text(language).replacingOccurrences(of: "…", with: "")
    }

    /// D12: "회사에 넣었어요 · 이 기기에서는 숨겨져 있어요" (the toast's 되돌리기 follows).
    public static func added(to name: String, _ language: AppLanguage) -> String {
        ["\(name)에 넣었어요 · 이 기기에서는 숨겨져 있어요", "Added to \(name) · hidden on this device",
         "Toegevoegd aan \(name) · verborgen op dit apparaat"][language.index]
    }
}
