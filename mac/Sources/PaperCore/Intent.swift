import Foundation

/// 입력 줄: what a line typed into the note (or the quick-entry slip) could mean — a to-do, an
/// event, a timer, an alarm or a memo — best guess first. The line shows the guesses as chips,
/// Tab picks another, Return makes the picked one. Same rules and test cases as the Windows app
/// (intent.ts; the shared cases are in intent-cases.md).
public enum Intent {
    public enum Kind: String, Codable, CaseIterable, Sendable {
        case todo, event, timer, alarm, memo
        /// 반복 할 일 (1.38): "매일 물 마시기", "every Monday 9am meeting".
        case repeating = "repeat"
    }

    /// A repeating to-do as the line reads it: the rule, the time ("HH:mm", or none) and the title.
    public struct RepeatGuess: Equatable, Sendable {
        public var title: String
        public var rule: RepeatRule
        public var time: String?

        public init(title: String, rule: RepeatRule, time: String? = nil) {
            self.title = title; self.rule = rule; self.time = time
        }
    }

    /// An event as the line reads it: a day and minutes, like CalendarDraft.
    public struct EventGuess: Equatable, Sendable {
        public var title: String
        /// "yyyy-MM-dd"
        public var date: String
        public var allDay: Bool
        /// Minutes after midnight; the end at or before the start is on the next day.
        public var start: Int
        public var end: Int
        /// A repeating event (1.38, "매주 월 9시 주간 회의"): the line's rule — every day, one weekday
        /// a week or one day a month (`LocalEvent.Repeat` can't hold more). nil = once.
        public var rule: RepeatRule?

        public init(title: String, date: String, allDay: Bool = false, start: Int = 0, end: Int = 60, rule: RepeatRule? = nil) {
            self.title = title; self.date = date; self.allDay = allDay; self.start = start; self.end = end; self.rule = rule
        }

        /// The event's own repeat for the rule.
        public var eventRepeat: LocalEvent.Repeat {
            switch rule?.kind {
            case .daily: .daily
            case .weekly: .weekly
            case .monthly: .monthly
            default: .none
            }
        }
    }

    public enum Candidate: Equatable, Sendable {
        case todo(QuickParse)
        case event(EventGuess)
        /// With a title it is 집중 (1.37): focus on that to-do (made on today's sheet if it isn't there).
        case timer(minutes: Int, title: String?)
        /// "HH:mm", 0 = Sunday … 6 = Saturday (empty = once), the label (may be "").
        case alarm(time: String, days: [Int], label: String)
        case memo(String)
        case repeating(RepeatGuess)

        public var kind: Kind {
            switch self {
            case .todo: .todo
            case .event: .event
            case .timer: .timer
            case .alarm: .alarm
            case .memo: .memo
            case .repeating: .repeating
            }
        }

        /// The chip over the line: `할 일 · 알림 15:00`, `일정 · 내일(금) 15:00–16:00`, `40분 타이머 시작`,
        /// `알람 · 평일 오전 7:00`, `메모로 남기기` (see intent-cases.md for every form).
        public func chip(_ language: AppLanguage = .ko, now: Date, calendar: Calendar = .paper) -> String {
            let today = calendar.startOfDay(for: Archive.logicalDayStart(now, calendar: calendar))
            func offset(_ date: Date) -> Int {
                calendar.dateComponents([.day], from: today, to: calendar.startOfDay(for: date)).day ?? 99
            }
            func clock(_ date: Date) -> String {
                let p = calendar.dateComponents([.hour, .minute], from: date)
                return language.clock(hour: p.hour!, minute: p.minute!)
            }
            func lower(_ word: String) -> String { language == .ko ? word : word.lowercased() }
            let i = language.index
            switch self {
            case .todo(let parsed):
                let head = ["할 일", "To-do", "Taak"][i]
                if let range = parsed.range {
                    // 1.39: `할 일 · 오늘 14:00–15:30` — the range's day, then the range.
                    return head + " · " + rangeDay(parsed, today: today, language: language, calendar: calendar) + " " + range.text(language)
                }
                if let at = parsed.reminderAt {
                    let days = offset(at)
                    let when = days == 0 ? clock(at)
                        : days == 1 ? lower(language.dayWord(1)!) + " " + clock(at)
                        : language.shortDate(at, calendar: calendar) + " " + clock(at)
                    return head + " · " + ["알림", "reminder", "herinnering"][i] + " " + when
                }
                if let due = parsed.dueDate, let day = Deadline.date(from: due, calendar: calendar) {
                    let p = calendar.dateComponents([.month, .day], from: day)
                    return head + " · " + ["마감", "due", "deadline"][i] + " " + language.dayMonth(month: p.month!, day: p.day!)
                }
                return head
            case .event(let event):
                let head = ["일정", "Event", "Afspraak"][i]
                if let rule = event.rule {
                    let when = event.allDay ? lower(CalendarDay.allDayText(language))
                        : language.timeRange(from: (event.start / 60, event.start % 60), to: ((event.end / 60) % 24, event.end % 60))
                    return ["반복 일정", "Repeating event", "Herhalende afspraak"][i] + " · " + ruleText(rule, language: language) + " " + when
                }
                guard let day = CalendarDraft.localDay(event.date, calendar: calendar) else { return head }
                let p = calendar.dateComponents([.month, .day, .weekday], from: day)
                if event.allDay {
                    return head + " · " + language.dayMonth(month: p.month!, day: p.day!) + " " + lower(CalendarDay.allDayText(language))
                }
                let days = offset(day)
                let weekday = language.weekdayShort(p.weekday! - 1)
                let when: String
                if days == 0 || days == 1 {
                    let word = lower(language.dayWord(days)!)
                    when = language == .ko ? "\(word)(\(weekday))" : "\(word) (\(weekday))"
                } else {
                    when = language.shortDate(day, calendar: calendar)
                }
                let range = language.timeRange(from: (event.start / 60, event.start % 60), to: ((event.end / 60) % 24, event.end % 60))
                return head + " · " + when + " " + range
            case .timer(let minutes, let title):
                let length = TimerLength.text(minutes, language: language)
                // 집중 (1.37): a timer with a title is a focus session on that to-do.
                if let title, !title.isEmpty {
                    return ["\(length) 집중 · \(title)", "Focus \(length) · \(title)", "\(length) focussen · \(title)"][i]
                }
                return ["\(length) 타이머 시작", "Start a \(length) timer", "Timer van \(length) starten"][i]
            case .alarm(let time, let days, _):
                let alarm = Alarm(id: "intent", time: time, label: "", days: days, createdAt: now)
                let at = Alarm.timeText(alarm, language: language)
                let when: String
                if days.isEmpty {
                    let fire = Alarm.nextFire(alarm, now: now, calendar: calendar) ?? now
                    let ahead = calendar.dateComponents([.day], from: calendar.startOfDay(for: now), to: calendar.startOfDay(for: fire)).day ?? 0
                    when = lower(language.dayWord(min(1, max(0, ahead)))!)
                } else {
                    let words = Alarm.daysText(days, language: language)
                    let set = Set(days)
                    let plain = set.count == 7 || set == [1, 2, 3, 4, 5] || set == [0, 6]
                    when = plain ? lower(words) : words
                }
                return ["알람", "Alarm", "Wekker"][i] + " · " + when + " " + at
            case .memo:
                return ["메모로 남기기", "Save as a note", "Bewaren als notitie"][i]
            case .repeating(let guess):
                return kindName(.repeating, language: language) + " · " + guess.when(language)
            }
        }
    }

    /// The toast once a candidate was made: "일정으로 넣었어요 · 내일 15:00", "할 일로 넣었어요", "40분 타이머를
    /// 시작했어요", "알람을 맞췄어요 · 평일 오전 7:00", "메모로 남겼어요"; en "Added as an event · tomorrow 3:00 PM"…;
    /// nl "Toegevoegd als afspraak · morgen 15:00"…. Same as the Windows app (intent.ts: addedText).
    public static func addedText(_ candidate: Candidate, language: AppLanguage = .ko, now: Date, calendar: Calendar = .paper) -> String {
        let i = language.index
        let today = calendar.startOfDay(for: Archive.logicalDayStart(now, calendar: calendar))
        func made(_ at: Date) -> String {
            let p = calendar.dateComponents([.hour, .minute], from: at)
            let clock = language.clock(hour: p.hour!, minute: p.minute!)
            let days = calendar.dateComponents([.day], from: today, to: calendar.startOfDay(for: at)).day ?? 99
            if days == 0 || days == 1 { return (language == .ko ? language.dayWord(days)! : language.dayWord(days)!.lowercased()) + " " + clock }
            return language.shortDate(at, calendar: calendar) + " " + clock
        }
        func dayMonth(_ key: String) -> String {
            guard let day = CalendarDraft.localDay(key, calendar: calendar) else { return key }
            let p = calendar.dateComponents([.month, .day], from: day)
            return language.dayMonth(month: p.month!, day: p.day!)
        }
        switch candidate {
        case .todo(let parsed):
            let head = ["할 일로 넣었어요", "Added as a to-do", "Toegevoegd als taak"][i]
            if let range = parsed.range {
                return head + " · " + rangeDay(parsed, today: today, language: language, calendar: calendar) + " " + range.text(language)
            }
            if let at = parsed.reminderAt { return head + " · " + made(at) }
            if let due = parsed.dueDate { return head + " · " + ["마감", "due", "deadline"][i] + " " + dayMonth(due) }
            return head
        case .event(let event):
            let head = ["일정으로 넣었어요", "Added as an event", "Toegevoegd als afspraak"][i]
            if let rule = event.rule {
                let word = CalendarDay.allDayText(language)
                let when = event.allDay ? (language == .ko ? word : word.lowercased()) : language.clock(hour: event.start / 60, minute: event.start % 60)
                return ["반복 일정으로 넣었어요", "Added as a repeating event", "Toegevoegd als herhalende afspraak"][i] + " · " + ruleText(rule, language: language) + " " + when
            }
            if event.allDay {
                let word = CalendarDay.allDayText(language)
                return head + " · " + dayMonth(event.date) + " " + (language == .ko ? word : word.lowercased())
            }
            guard let day = CalendarDraft.localDay(event.date, calendar: calendar),
                  let start = calendar.date(byAdding: .minute, value: event.start, to: day) else { return head }
            return head + " · " + made(start)
        case .timer(let minutes, let title):
            let length = TimerLength.text(minutes, language: language)
            if let title, !title.isEmpty {
                return ["\(length) 집중을 시작했어요", "Focusing for \(length)", "\(length) focus gestart"][i] + " · " + title
            }
            return ["\(length) 타이머를 시작했어요", "Started a \(length) timer", "Timer van \(length) gestart"][i]
        case .alarm:
            let chip = candidate.chip(language, now: now, calendar: calendar)
            let when = chip.components(separatedBy: " · ").dropFirst().joined(separator: " · ")
            return ["알람을 맞췄어요", "Alarm set", "Wekker gezet"][i] + " · " + when
        case .memo:
            return ["메모로 남겼어요", "Saved as a note", "Bewaard als notitie"][i]
        case .repeating(let guess):
            return ["반복 할 일로 넣었어요", "Added as a repeating to-do", "Toegevoegd als herhalende taak"][i] + " · " + guess.when(language)
        }
    }

    /// A kind's own name: "할 일", "일정", "타이머", "알람", "메모" — en "To-do", "Event", "Timer", "Alarm",
    /// "Note"; nl "Taak", "Afspraak", "Timer", "Wekker", "Notitie".
    public static func kindName(_ kind: Kind, language: AppLanguage = .ko) -> String {
        let names: [Kind: [String]] = [
            .todo: ["할 일", "To-do", "Taak"], .event: ["일정", "Event", "Afspraak"], .timer: ["타이머", "Timer", "Timer"],
            .alarm: ["알람", "Alarm", "Wekker"], .memo: ["메모", "Note", "Notitie"],
            .repeating: ["반복 할 일", "Repeating to-do", "Herhalende taak"],
        ]
        return names[kind]![language.index]
    }

    /// The toast's switch to another kind: "할 일로 바꾸기", "Make it a to-do", "Maak er een taak van".
    public static func switchText(_ kind: Kind, language: AppLanguage = .ko) -> String {
        let words: [Kind: [String]] = [
            .todo: ["할 일로 바꾸기", "Make it a to-do", "Maak er een taak van"],
            .event: ["일정으로 바꾸기", "Make it an event", "Maak er een afspraak van"],
            .timer: ["타이머로 바꾸기", "Make it a timer", "Maak er een timer van"],
            .alarm: ["알람으로 바꾸기", "Make it an alarm", "Maak er een wekker van"],
            .memo: ["메모로 바꾸기", "Make it a note", "Maak er een notitie van"],
            .repeating: ["반복 할 일로 바꾸기", "Make it a repeating to-do", "Maak er een herhalende taak van"],
        ]
        return words[kind]![language.index]
    }

    /// The kind's own word in the toast, drawn a little brighter: "일정", "event", "afspraak" (the
    /// timer's length; nil for none).
    public static func addedEmphasis(_ candidate: Candidate, language: AppLanguage = .ko) -> String? {
        if case .timer(let minutes, _) = candidate { return TimerLength.text(minutes, language: language) }
        let words: [Kind: [String]] = [
            .todo: ["할 일", "to-do", "taak"], .event: ["일정", "event", "afspraak"],
            .alarm: ["알람", "Alarm", "Wekker"], .memo: ["메모", "note", "notitie"],
            .repeating: ["반복 할 일", "repeating to-do", "herhalende taak"],
        ]
        return words[candidate.kind]?[language.index]
    }

    /// Why a slash line can't be made (`/알람 abc`, `/타이머 0`): the clay hint under the line.
    public enum Problem: Equatable, Sendable {
        case alarmTime, timerLength
        /// `/반복 약 먹기` (no repeat words) or `/반복 매일` (no title).
        case repeating

        /// `알람 시간을 알아듣지 못했어요` · `Couldn’t read the alarm time` · `Kon de wektijd niet lezen`;
        /// `타이머 길이를 알아듣지 못했어요` · `Couldn’t read the timer length` · `Kon de timerduur niet lezen`.
        public func text(_ language: AppLanguage = .ko) -> String {
            switch self {
            case .alarmTime: ["알람 시간을 알아듣지 못했어요", "Couldn’t read the alarm time", "Kon de wektijd niet lezen"][language.index]
            case .timerLength: ["타이머 길이를 알아듣지 못했어요", "Couldn’t read the timer length", "Kon de timerduur niet lezen"][language.index]
            case .repeating: ["반복을 알아듣지 못했어요", "Couldn’t read the repeat", "Kon de herhaling niet lezen"][language.index]
            }
        }
    }

    // MARK: Reading

    /// Every way the text could be meant, best first; at least one for any non-blank text, none for
    /// blank text or a slash kind that can't be read. `prefer` (learned from 바꾸기, see Memory) puts
    /// its kind first for lines whose key (`key(_:)`) it holds.
    public static func read(_ text: String, now: Date, calendar: Calendar = .paper, language: AppLanguage = .ko,
                            prefer: [String: Kind] = [:]) -> [Candidate] {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        if let (kind, rest) = slash(trimmed, language: language) {
            return slashed(kind, rest, now: now, calendar: calendar, language: language)
        }
        var found = guesses(trimmed, now: now, calendar: calendar, language: language)
        if let key = key(trimmed, now: now, calendar: calendar, language: language), let kind = prefer[key],
           let index = found.firstIndex(where: { $0.kind == kind }), index > 0 {
            found.insert(found.remove(at: index), at: 0)
        }
        return found
    }

    /// The clay hint for a slash line that can't be read (nothing while only the slash word is typed).
    public static func problem(_ text: String, now: Date = Date(), calendar: Calendar = .paper, language: AppLanguage = .ko) -> Problem? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let (kind, rest) = slash(trimmed, language: language), !rest.isEmpty else { return nil }
        switch kind {
        case .timer: return TimerLength.parseDuration(rest, language: language) == nil ? .timerLength : nil
        case .alarm: return alarm(rest, language: language) == nil ? .alarmTime : nil
        case .repeating: return repeating(rest, language: language) == nil ? .repeating : nil
        default: return nil
        }
    }

    /// The slash kind the line starts with (`/메모`, `/todo`, `/wekker` …), if any.
    public static func slashKind(_ text: String, language: AppLanguage = .ko) -> Kind? {
        slash(text.trimmingCharacters(in: .whitespacesAndNewlines), language: language)?.kind
    }

    /// What 바꾸기 learns by: the first word of the line's title (as QuickParse reads it), lowercased,
    /// without punctuation. "내일 3시 장보기" → "장보기".
    public static func key(_ text: String, now: Date, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String? {
        let firstLine = text.trimmingCharacters(in: .whitespacesAndNewlines).split(whereSeparator: \.isNewline).first.map(String.init) ?? ""
        let title = QuickParse.parse(firstLine, now: now, calendar: calendar, language: language).title
        guard let word = title.split(whereSeparator: \.isWhitespace).first else { return nil }
        let cleaned = String(word).lowercased().trimmingCharacters(in: CharacterSet.punctuationCharacters.union(.symbols))
        return cleaned.isEmpty ? nil : cleaned
    }

    // MARK: Slash kinds

    private static let slashWords: [(Kind, [String], [String], [String])] = [
        // kind, Korean (every language), English, Dutch
        (.todo, ["/할일"], ["/todo"], ["/taak"]),
        (.event, ["/일정"], ["/event"], ["/afspraak"]),
        (.memo, ["/메모"], ["/note"], ["/notitie"]),
        (.timer, ["/타이머"], ["/timer"], ["/timer"]),
        (.alarm, ["/알람"], ["/alarm"], ["/wekker"]),
        (.repeating, ["/반복"], ["/repeat"], ["/herhaal"]),
    ]

    private static func slash(_ trimmed: String, language: AppLanguage) -> (kind: Kind, rest: String)? {
        guard trimmed.hasPrefix("/") else { return nil }
        let end = trimmed.firstIndex(where: { $0.isWhitespace }) ?? trimmed.endIndex
        let word = trimmed[..<end].lowercased()
        let rest = String(trimmed[end...]).trimmingCharacters(in: .whitespacesAndNewlines)
        for (kind, korean, english, dutch) in slashWords {
            let words = korean + (language == .en ? english : language == .nl ? dutch : [])
            if words.contains(word) { return (kind, rest) }
        }
        return nil
    }

    private static func slashed(_ kind: Kind, _ rest: String, now: Date, calendar: Calendar, language: AppLanguage) -> [Candidate] {
        guard !rest.isEmpty else { return [] }
        switch kind {
        case .todo:
            return [.todo(QuickParse.parse(rest, now: now, calendar: calendar, language: language))]
        case .event:
            let parsed = QuickParse.parse(rest, now: now, calendar: calendar, language: language)
            if let event = event(parsed, now: now, calendar: calendar) { return [.event(event)] }
            let slot = CalendarDraft.nextSlot(now, calendar: calendar)
            return [.event(EventGuess(title: parsed.title, date: slot.date, start: slot.minutes, end: (slot.minutes + 60) % 1440))]
        case .memo:
            return [.memo(rest)]
        case .timer:
            return TimerLength.parseDuration(rest, language: language).map { [.timer(minutes: $0, title: nil)] } ?? []
        case .alarm:
            return alarm(rest, language: language).map { [.alarm(time: $0.time, days: $0.days, label: $0.label)] } ?? []
        case .repeating:
            return repeating(rest, language: language).map { [.repeating($0)] } ?? []
        }
    }

    // MARK: Guesses

    private static func guesses(_ text: String, now: Date, calendar: Calendar, language: AppLanguage) -> [Candidate] {
        let whole = { QuickParse.parse(text, now: now, calendar: calendar, language: language) }
        // A note of several lines: a memo, or a to-do of its first line.
        if text.contains(where: \.isNewline) {
            let first = text.split(whereSeparator: \.isNewline).first.map(String.init) ?? text
            return [.memo(text), .todo(QuickParse.parse(first, now: now, calendar: calendar, language: language))]
        }
        if let timer = timer(text, language: language) {
            return [.timer(minutes: timer.minutes, title: timer.title), .todo(whole())]
        }
        if let alarm = keywordAlarm(text, language: language) {
            return [.alarm(time: alarm.time, days: alarm.days, label: alarm.label), .todo(whole())]
        }
        // 반복 할 일 (1.38, rule 4½): "매일 물 마시기", "매주 월 9시 주간 회의" — an event first for event words.
        if let guess = repeating(text, language: language) {
            let event = repeatEvent(guess, now: now, calendar: calendar, language: language)
            if let event, hasEventWord(guess.title, language: language) {
                return [.event(event), .repeating(guess), .todo(whole())]
            }
            return [.repeating(guess), .todo(whole())] + (event.map { [Candidate.event($0)] } ?? [])
        }
        let parsed = whole()
        // 1.39: a time range — the event takes the same range (an event word puts it first, as with a time).
        if parsed.range != nil, let event = event(parsed, now: now, calendar: calendar) {
            return hasEventWord(parsed.title, language: language) ? [.event(event), .todo(parsed)] : [.todo(parsed), .event(event)]
        }
        if parsed.reminderAt != nil, let event = event(parsed, now: now, calendar: calendar) {
            return hasEventWord(parsed.title, language: language) ? [.event(event), .todo(parsed)] : [.todo(parsed), .event(event)]
        }
        if parsed.dueDate != nil, let event = event(parsed, now: now, calendar: calendar) {
            return [.todo(parsed), .event(event)]
        }
        return [.todo(parsed), .memo(text)]
    }

    /// The range's day in a chip or toast: "오늘", "내일" (en/nl lowercased), else the short date.
    static func rangeDay(_ parsed: QuickParse, today: Date, language: AppLanguage, calendar: Calendar) -> String {
        guard let key = parsed.dueDate, let day = CalendarDraft.localDay(key, calendar: calendar) else {
            return language == .ko ? language.dayWord(0)! : language.dayWord(0)!.lowercased()
        }
        let offset = calendar.dateComponents([.day], from: today, to: calendar.startOfDay(for: day)).day ?? 99
        if offset == 0 || offset == 1 { return language == .ko ? language.dayWord(offset)! : language.dayWord(offset)!.lowercased() }
        return language.shortDate(day, calendar: calendar)
    }

    /// A timed event at the reminder (an hour long), or an all-day one on the deadline.
    private static func event(_ parsed: QuickParse, now: Date, calendar: Calendar) -> EventGuess? {
        if let range = parsed.range {
            var day = parsed.dueDate ?? Archive.dayKey(now, calendar: calendar)
            // A range after midnight (the 4 a.m. day) is on the next calendar day.
            if range.start >= 1440, let date = Deadline.date(from: day, calendar: calendar) {
                day = Deadline.key(calendar.date(byAdding: .day, value: 1, to: date)!, calendar: calendar)
            }
            return EventGuess(title: parsed.title, date: day, start: range.start % 1440, end: range.drawnEnd % 1440)
        }
        if let at = parsed.reminderAt {
            let start = CalendarDraft.minutes(at, calendar: calendar)
            return EventGuess(title: parsed.title, date: CalendarDraft.day(at, calendar: calendar), start: start, end: (start + 60) % 1440)
        }
        if let due = parsed.dueDate { return EventGuess(title: parsed.title, date: due, allDay: true) }
        return nil
    }

    /// Words that make a timed line an event first ("회의", "dentist", "verjaardag" …): Korean ones
    /// anywhere in the title, English and Dutch ones as whole words.
    static let eventWords: [AppLanguage: [String]] = [
        .ko: ["회의", "미팅", "약속", "진료", "병원", "치과", "점심", "저녁", "식사", "면접", "수업", "강의", "상담", "예약", "모임", "생일", "결혼식", "여행", "콘서트", "영화"],
        .en: ["meeting", "call", "appointment", "lunch", "dinner", "interview", "class", "lecture", "doctor", "dentist", "party", "birthday", "wedding", "trip", "concert", "movie"],
        .nl: ["afspraak", "vergadering", "meeting", "overleg", "lunch", "diner", "etentje", "sollicitatie", "les", "college", "dokter", "tandarts", "feest", "verjaardag", "bruiloft", "reis", "concert", "film"],
    ]

    public static func hasEventWord(_ title: String, language: AppLanguage) -> Bool {
        let lower = title.lowercased()
        if eventWords[.ko]!.contains(where: lower.contains) { return true }
        guard language != .ko else { return false }
        let words = Set(lower.split(whereSeparator: { !$0.isLetter }).map(String.init))
        return eventWords[language]!.contains(where: words.contains)
    }

    // MARK: Timers

    /// `타이머 40`, `40분 타이머`, `40분 집중`, `집중 1:30`, `보고서 25분 집중`; en `timer 40`, `40 min timer`,
    /// `focus 25`, `25 min focus`; nl `timer 40`, `40 min timer`, `focus 25`. The keyword is a word of its
    /// own; the length is anything TimerLength.parseDuration reads. A focus word with a title
    /// (`보고서 25분 집중`, `focus 25 report`, `25 min focus report`) is a focus session on that to-do.
    static func timer(_ text: String, language: AppLanguage) -> (minutes: Int, title: String?)? {
        let tokens = text.split(whereSeparator: \.isWhitespace).map(String.init)
        guard tokens.count >= 2 else { return nil }
        let keywords: Set<String> = language == .ko ? ["타이머", "집중"] : ["타이머", "집중", "timer", "focus"]
        let focusWords = keywords.intersection(["집중", "focus"])
        let first = tokens[0].lowercased(), last = tokens[tokens.count - 1].lowercased()
        func length(_ parts: ArraySlice<String>) -> Int? { TimerLength.parseDuration(parts.joined(separator: " "), language: language) }
        if keywords.contains(first), let minutes = length(tokens[1...]) { return (minutes, nil) }
        if keywords.contains(last) {
            let before = tokens[..<(tokens.count - 1)]
            if let minutes = length(before) { return (minutes, nil) }
            if focusWords.contains(last) {
                for size in [4, 3, 2, 1] where before.count - size >= 1 {
                    let split = before.count - size
                    if let minutes = length(before[split...]) { return (minutes, before[..<split].joined(separator: " ")) }
                }
            }
        }
        // 집중 (1.37): the title after the length — `focus 25 report`, `focus 25 min report`, `집중 25분 보고서`.
        if focusWords.contains(first) {
            for size in [4, 3, 2, 1] where tokens.count - 1 - size >= 1 {
                if let minutes = length(tokens[1...size]) { return (minutes, tokens[(size + 1)...].joined(separator: " ")) }
            }
        }
        // …or the focus word between the length and the title: `25 min focus report`, `25분 집중 보고서`.
        if let index = tokens.indices.dropFirst().dropLast().first(where: { focusWords.contains(tokens[$0].lowercased()) }),
           let minutes = length(tokens[..<index]) {
            return (minutes, tokens[(index + 1)...].joined(separator: " "))
        }
        return nil
    }

    // MARK: Alarms

    /// `알람 7시`, `알람 오전 7:30 평일`, `알람 7시 매일`; en `alarm 7am`, `alarm 7:30 weekdays`; nl `wekker 7:00`,
    /// `wekker 7 uur doordeweeks` — the keyword first (Korean in every language).
    static func keywordAlarm(_ text: String, language: AppLanguage) -> (time: String, days: [Int], label: String)? {
        let tokens = text.split(whereSeparator: \.isWhitespace).map(String.init)
        guard tokens.count >= 2 else { return nil }
        let keywords = Set<String>(["알람"]).union(language == .en ? ["alarm"] : language == .nl ? ["wekker"] : [])
        guard keywords.contains(tokens[0].lowercased()) else { return nil }
        return alarm(tokens.dropFirst().joined(separator: " "), language: language)
    }

    /// An alarm from the words after the keyword: one clock time, the days (none = once) and what's
    /// left as its label. Hours 1–6 without 오전/오후 · am/pm are the morning (it's an alarm).
    static func alarm(_ text: String, language: AppLanguage) -> (time: String, days: [Int], label: String)? {
        var working = " " + text.split(whereSeparator: \.isWhitespace).joined(separator: " ") + " "
        var days: Set<Int> = []
        for rule in dayRules(language) {
            while let match = AlarmWords.first(rule.pattern, in: working) {
                guard let found = rule.read(match.groups) else { break }
                days.formUnion(found)
                working = AlarmWords.cut(match.range, in: working)
            }
        }
        var clock: (hour: Int, minute: Int)?
        for rule in timeRules(language) {
            guard let match = AlarmWords.first(rule.pattern, in: working) else { continue }
            guard let found = rule.read(match.groups), (0...23).contains(found.hour), (0...59).contains(found.minute) else { return nil }
            clock = found
            working = AlarmWords.cut(match.range, in: working)
            break
        }
        guard let clock else { return nil }
        let label = working.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        return (Alarm.time(hour: clock.hour, minute: clock.minute), days.sorted(), label)
    }

    private struct DayRule { let pattern: String; let read: ([String: String]) -> Set<Int>? }
    private struct TimeRule { let pattern: String; let read: ([String: String]) -> (hour: Int, minute: Int)? }

    private static let everyDay: Set<Int> = Set(0...6)
    private static let weekdays: Set<Int> = [1, 2, 3, 4, 5]
    private static let weekends: Set<Int> = [0, 6]

    private static func dayRules(_ language: AppLanguage) -> [DayRule] {
        var rules = [
            DayRule(pattern: "(?<w>매일|평일|주말)") { g in
                ["매일": everyDay, "평일": weekdays, "주말": weekends][g["w"] ?? ""]
            },
            DayRule(pattern: "(?<run>[일월화수목금토](?:[·,/]?[일월화수목금토])*)(?:요일)?") { g in
                Set((g["run"] ?? "").compactMap { ["일", "월", "화", "수", "목", "금", "토"].firstIndex(of: String($0)) })
            },
        ]
        func names(_ table: [(String, Int)], joiner: String) -> DayRule {
            let alternatives = table.map(\.0).joined(separator: "|")
            return DayRule(pattern: "(?<run>(?:\(alternatives))(?:(?:\(joiner))(?:\(alternatives)))*)") { g in
                let words = (g["run"] ?? "").split(whereSeparator: { !$0.isLetter }).map { String($0) }
                return Set(words.compactMap { word in table.first { $0.0 == word }?.1 })
            }
        }
        switch language {
        case .ko: break
        case .en:
            rules.append(DayRule(pattern: #"(?<w>every\s+day|everyday|daily|weekdays|weekday|weekends|weekend)"#) { g in
                let w = g["w"] ?? ""
                return w.hasPrefix("weekday") ? weekdays : w.hasPrefix("weekend") ? weekends : everyDay
            })
            let table: [(String, Int)] = [
                ("mondays", 1), ("monday", 1), ("mon", 1), ("tuesdays", 2), ("tuesday", 2), ("tues", 2), ("tue", 2),
                ("wednesdays", 3), ("wednesday", 3), ("wed", 3), ("thursdays", 4), ("thursday", 4), ("thurs", 4), ("thur", 4), ("thu", 4),
                ("fridays", 5), ("friday", 5), ("fri", 5), ("saturdays", 6), ("saturday", 6), ("sat", 6), ("sundays", 0), ("sunday", 0), ("sun", 0),
            ]
            rules.append(names(table, joiner: #"\s*,\s*|\s+and\s+|\s*&\s*|\s+"#))
        case .nl:
            rules.append(DayRule(pattern: #"(?<w>elke\s+dag|dagelijks|doordeweeks|werkdagen|in\s+het\s+weekend|weekenden|weekend)"#) { g in
                let w = g["w"] ?? ""
                return w == "doordeweeks" || w == "werkdagen" ? weekdays : w.contains("weekend") ? weekends : everyDay
            })
            let table: [(String, Int)] = [
                ("maandag", 1), ("ma", 1), ("dinsdag", 2), ("di", 2), ("woensdag", 3), ("wo", 3), ("donderdag", 4), ("do", 4),
                ("vrijdag", 5), ("vr", 5), ("zaterdag", 6), ("za", 6), ("zondag", 0), ("zo", 0),
            ]
            rules.append(names(table, joiner: #"\s*,\s*|\s+en\s+|\s*&\s*|\s+"#))
        }
        return rules
    }

    /// 24-hour hour from what was written: `pm` true/false when said (오후 · pm · 's avonds), else as written.
    private static func hour(_ value: Int, pm: Bool?) -> Int {
        guard let pm else { return value == 24 ? 0 : value }
        if value > 12 { return value }
        return pm ? (value == 12 ? 12 : value + 12) : (value == 12 ? 0 : value)
    }

    private static func koreanPeriod(_ word: String?) -> Bool? {
        guard let word, !word.isEmpty else { return nil }
        return ["오후", "점심", "저녁", "밤"].contains(word)
    }

    private static func timeRules(_ language: AppLanguage) -> [TimeRule] {
        let period = "(?:(?<p>오전|오후|아침|점심|저녁|밤|새벽)\\s?)?"
        var rules: [TimeRule] = []
        switch language {
        case .ko: break
        case .en:
            rules.append(TimeRule(pattern: #"(?:at\s+)?(?<h>\d{1,2})(?::(?<m>\d{2}))?\s*(?<ap>[ap])\.?m\.?"#) { g in
                guard let h = Int(g["h"] ?? ""), (1...12).contains(h) else { return nil }
                return (hour(h, pm: g["ap"] == "p"), Int(g["m"] ?? "") ?? 0)
            })
            rules.append(TimeRule(pattern: #"at\s+(?<h>\d{1,2})(?::(?<m>\d{2}))?(?:\s*o['’]clock)?"#) { g in
                Int(g["h"] ?? "").map { (hour($0, pm: nil), Int(g["m"] ?? "") ?? 0) }
            })
        case .nl:
            let dutchPeriod = #"(?:\s+(?<dp>['’]s\s*(?:ochtends|morgens|middags|avonds|nachts)))?"#
            rules.append(TimeRule(pattern: #"(?:om\s+)?(?<h>\d{1,2})(?::(?<m>\d{2})|u(?<um>\d{2})?|\s*uur)"# + dutchPeriod) { g in
                guard let h = Int(g["h"] ?? "") else { return nil }
                let dp = g["dp"] ?? ""
                let pm: Bool? = dp.isEmpty ? nil : dp.hasSuffix("middags") || dp.hasSuffix("avonds")
                return (hour(h, pm: pm), Int(g["m"] ?? g["um"] ?? "") ?? 0)
            })
        }
        // Korean, in every language: 7시, 오전 7시 반, 7시 30분, 오후 7:30.
        rules.append(TimeRule(pattern: period + #"(?<h>\d{1,2})시(?:\s?(?<half>반)|\s?(?<m>\d{1,2})분)?"#) { g in
            guard let h = Int(g["h"] ?? "") else { return nil }
            return (hour(h, pm: koreanPeriod(g["p"])), g["half"] != nil ? 30 : Int(g["m"] ?? "") ?? 0)
        })
        rules.append(TimeRule(pattern: period + #"(?<h>\d{1,2}):(?<m>\d{2})"#) { g in
            guard let h = Int(g["h"] ?? "") else { return nil }
            return (hour(h, pm: koreanPeriod(g["p"])), Int(g["m"] ?? "") ?? 0)
        })
        // A bare hour: `alarm 7 every day`, `wekker om 7`.
        rules.append(TimeRule(pattern: language == .nl ? #"(?:om\s+)?(?<h>\d{1,2})"# : #"(?<h>\d{1,2})"#) { g in
            Int(g["h"] ?? "").map { (hour($0, pm: nil), 0) }
        })
        return rules
    }

    // MARK: Repeats (1.38) — intent-cases.md rule 4½

    /// A repeating to-do: the line starts with a repeat phrase — `매일`, `평일(마다)`, `주말(마다)`, `매주 월(요일)(마다)`,
    /// `매주 월수금`, `매월 15일` / `매달 15일` (Korean in every language); en `every day`, `daily`, `every weekday`,
    /// `(on) weekdays`, `every weekend`, `every Monday`, `every mon and thu`, `every month on the 15th`; nl `elke dag`,
    /// `dagelijks`, `doordeweeks`, `werkdagen`, `elk weekend`, `in het weekend`, `elke maandag`, `elke di en do`,
    /// `elke maand op de 15e` — then anywhere after it maybe a time (`9시`, `오후 7:30`, `9am`, `at 3`, `om 7 uur`),
    /// and what's left is the title (not empty).
    public static func repeating(_ text: String, language: AppLanguage) -> RepeatGuess? {
        var rest = text.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        var found: RepeatRule?
        for day in repeatDayRules(language) {
            guard let lead = RepeatWords.lead(day.pattern, in: rest), let read = day.read(lead.groups) else { continue }
            found = read
            rest = lead.rest
            break
        }
        guard let rule = found.map(normalized), Repeat.isValid(rule) else { return nil }
        var working = " " + rest + " "
        var time: String?
        for clock in repeatTimeRules(language) {
            guard let match = AlarmWords.first(clock.pattern, in: working) else { continue }
            guard let read = clock.read(match.groups), (0...23).contains(read.hour), (0...59).contains(read.minute) else { break }
            time = Alarm.time(hour: read.hour, minute: read.minute)
            working = AlarmWords.cut(match.range, in: working)
            break
        }
        let title = working.split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !title.isEmpty else { return nil }
        return RepeatGuess(title: title, rule: rule, time: time)
    }

    /// Every day of the week is every day; Monday to Friday is 평일.
    static func normalized(_ rule: RepeatRule) -> RepeatRule {
        guard rule.kind == .weekly else { return rule }
        let days = Set(rule.weekdays ?? [])
        if days == everyDay { return RepeatRule(kind: .daily) }
        if days == weekdays { return RepeatRule(kind: .weekdays) }
        return RepeatRule(kind: .weekly, weekdays: days.sorted())
    }

    /// The repeating event for a repeat `LocalEvent` can hold (every day, one weekday, one day a month), when
    /// a time was given or the title has an event word: on the rule's first day from today, an hour at the
    /// time, else all day.
    static func repeatEvent(_ guess: RepeatGuess, now: Date, calendar: Calendar, language: AppLanguage) -> EventGuess? {
        switch guess.rule.kind {
        case .daily, .monthly: break
        case .weekly where (guess.rule.weekdays ?? []).count == 1: break
        default: return nil
        }
        guard guess.time != nil || hasEventWord(guess.title, language: language),
              let first = Repeat.nextOccurrence(guess.rule, from: now, calendar: calendar) else { return nil }
        let date = Deadline.key(first, calendar: calendar)
        guard let time = guess.time else { return EventGuess(title: guess.title, date: date, allDay: true, start: 540, end: 600, rule: guess.rule) }
        let parts = time.split(separator: ":").compactMap { Int($0) }
        let start = parts[0] * 60 + parts[1]
        return EventGuess(title: guess.title, date: date, start: start, end: (start + 60) % 1440, rule: guess.rule)
    }

    /// A rule in a chip or toast: Korean as `Repeat.describe` writes it (`매일`, `매주 월·수·금`); English and Dutch
    /// with the first letter lowered (`every day`, `every Mon, Thu`, `werkdagen`).
    public static func ruleText(_ rule: RepeatRule, language: AppLanguage) -> String {
        let text = Repeat.describe(rule, language: language)
        guard language != .ko, let first = text.first else { return text }
        return first.lowercased() + text.dropFirst()
    }

    private struct RepeatDayRule { let pattern: String; let read: ([String: String]) -> RepeatRule? }

    private static func repeatDayRules(_ language: AppLanguage) -> [RepeatDayRule] {
        func weekly(_ days: Set<Int>) -> RepeatRule? { days.isEmpty ? nil : RepeatRule(kind: .weekly, weekdays: days.sorted()) }
        func monthly(_ g: [String: String]) -> RepeatRule? { Int(g["md"] ?? "").map { RepeatRule(kind: .monthly, monthDay: $0) } }
        func names(_ table: [(String, Int)], every: String, joiner: String) -> RepeatDayRule {
            let alternatives = table.map(\.0).joined(separator: "|")
            return RepeatDayRule(pattern: "\(every)\\s+(?<run>(?:\(alternatives))(?:(?:\(joiner))(?:\(alternatives)))*)") { g in
                let words = (g["run"] ?? "").split(whereSeparator: { !$0.isLetter }).map { String($0) }
                return weekly(Set(words.compactMap { word in table.first { $0.0 == word }?.1 }))
            }
        }
        var rules: [RepeatDayRule] = []
        switch language {
        case .ko: break
        case .en:
            rules.append(RepeatDayRule(pattern: #"(?:every\s+month|monthly)\s+on\s+the\s+(?<md>\d{1,2})(?:st|nd|rd|th)?"#, read: monthly))
            rules.append(RepeatDayRule(pattern: #"(?<w>every\s+day|everyday|daily|every\s+weekday|(?:on\s+)?weekdays|every\s+weekend|(?:on\s+)?weekends)"#) { g in
                let w = g["w"] ?? ""
                return w.contains("weekday") ? RepeatRule(kind: .weekdays) : w.contains("weekend") ? weekly(weekends) : RepeatRule(kind: .daily)
            })
            rules.append(names([
                ("mondays", 1), ("monday", 1), ("mon", 1), ("tuesdays", 2), ("tuesday", 2), ("tues", 2), ("tue", 2),
                ("wednesdays", 3), ("wednesday", 3), ("wed", 3), ("thursdays", 4), ("thursday", 4), ("thurs", 4), ("thur", 4), ("thu", 4),
                ("fridays", 5), ("friday", 5), ("fri", 5), ("saturdays", 6), ("saturday", 6), ("sat", 6), ("sundays", 0), ("sunday", 0), ("sun", 0),
            ], every: "every", joiner: #"\s*,\s*|\s+and\s+|\s*&\s*|\s+"#))
        case .nl:
            rules.append(RepeatDayRule(pattern: #"elke\s+maand\s+op\s+de\s+(?<md>\d{1,2})e?"#, read: monthly))
            rules.append(RepeatDayRule(pattern: #"(?<w>elke\s+dag|dagelijks|doordeweeks|elke\s+werkdag|werkdagen|elk\s+weekend|in\s+het\s+weekend)"#) { g in
                let w = g["w"] ?? ""
                return w.contains("werk") || w == "doordeweeks" ? RepeatRule(kind: .weekdays) : w.contains("weekend") ? weekly(weekends) : RepeatRule(kind: .daily)
            })
            rules.append(names([
                ("maandag", 1), ("ma", 1), ("dinsdag", 2), ("di", 2), ("woensdag", 3), ("wo", 3), ("donderdag", 4), ("do", 4),
                ("vrijdag", 5), ("vr", 5), ("zaterdag", 6), ("za", 6), ("zondag", 0), ("zo", 0),
            ], every: "elke", joiner: #"\s*,\s*|\s+en\s+|\s*&\s*|\s+"#))
        }
        // Korean, in every language.
        rules.append(RepeatDayRule(pattern: "(?:매월|매달)\\s*(?<md>\\d{1,2})일", read: monthly))
        rules.append(RepeatDayRule(pattern: "(?<w>매일|평일(?:마다)?|주말(?:마다)?)") { g in
            let w = g["w"] ?? ""
            return w == "매일" ? RepeatRule(kind: .daily) : w.hasPrefix("주말") ? weekly(weekends) : RepeatRule(kind: .weekdays)
        })
        rules.append(RepeatDayRule(pattern: "매주\\s*(?<run>[일월화수목금토](?:\\s*[·,/]?\\s*[일월화수목금토])*)(?:요일)?(?:마다)?") { g in
            weekly(Set((g["run"] ?? "").compactMap { ["일", "월", "화", "수", "목", "금", "토"].firstIndex(of: String($0)) }))
        })
        return rules
    }

    private struct RepeatTimeRule { let pattern: String; let read: ([String: String]) -> (hour: Int, minute: Int)? }

    /// The first time in what follows the repeat phrase. A part of the day said decides (오후 · pm · 's avonds);
    /// otherwise `3시`, `at 3`, `(om) 3 uur` from 1 to 6 are the afternoon (like a to-do's reminder) and `7:30`
    /// (in Dutch without `om`) is as written. A bare number is never a time.
    private static func repeatTimeRules(_ language: AppLanguage) -> [RepeatTimeRule] {
        func spoken(_ value: Int) -> Int { value == 24 ? 0 : (1...6).contains(value) ? value + 12 : value }
        var rules: [RepeatTimeRule] = []
        switch language {
        case .ko: break
        case .en:
            rules.append(RepeatTimeRule(pattern: #"(?:at\s+)?(?<h>\d{1,2})(?::(?<m>\d{2}))?\s*(?<ap>[ap])\.?m\.?"#) { g in
                guard let h = Int(g["h"] ?? ""), (1...12).contains(h) else { return nil }
                return (hour(h, pm: g["ap"] == "p"), Int(g["m"] ?? "") ?? 0)
            })
            rules.append(RepeatTimeRule(pattern: #"at\s+(?<h>\d{1,2})(?::(?<m>\d{2}))?(?:\s*o['’]clock)?"#) { g in
                Int(g["h"] ?? "").map { (spoken($0), Int(g["m"] ?? "") ?? 0) }
            })
        case .nl:
            let dutchPeriod = #"(?:\s+(?<dp>['’]s\s*(?:ochtends|morgens|middags|avonds|nachts)))?"#
            rules.append(RepeatTimeRule(pattern: #"(?:(?<om>om)\s+)?(?<h>\d{1,2})(?::(?<m>\d{2})|u(?<um>\d{2})?|\s*uur)"# + dutchPeriod) { g in
                guard let h = Int(g["h"] ?? "") else { return nil }
                let minute = Int(g["m"] ?? g["um"] ?? "") ?? 0
                if let dp = g["dp"] {
                    let pm = dp.hasSuffix("middags") || dp.hasSuffix("avonds") || (dp.hasSuffix("nachts") && (7...11).contains(h))
                    return (hour(h, pm: pm), minute)
                }
                let asWritten = g["m"] != nil && g["om"] == nil
                return (asWritten ? (h == 24 ? 0 : h) : spoken(h), minute)
            })
        }
        let period = "(?:(?<p>오전|오후|아침|점심|저녁|밤|새벽)\\s?)?"
        rules.append(RepeatTimeRule(pattern: period + #"(?<h>\d{1,2})시(?:\s?(?<half>반)|\s?(?<m>\d{1,2})분)?"#) { g in
            guard let h = Int(g["h"] ?? "") else { return nil }
            let pm = koreanPeriod(g["p"])
            return (pm == nil ? spoken(h) : hour(h, pm: pm), g["half"] != nil ? 30 : Int(g["m"] ?? "") ?? 0)
        })
        rules.append(RepeatTimeRule(pattern: period + #"(?<h>\d{1,2}):(?<m>\d{2})"#) { g in
            guard let h = Int(g["h"] ?? "") else { return nil }
            return (hour(h, pm: koreanPeriod(g["p"])), Int(g["m"] ?? "") ?? 0)
        })
        return rules
    }

    // MARK: Learning from 바꾸기

    /// What the line learned from 바꾸기: switching the same key to the same kind twice makes that
    /// kind go first for it; switching away from a learned kind once forgets it. At most 200 keys
    /// (the oldest go). Kept by the app as JSON (Mac pref `intent.prefer`).
    public struct Memory: Codable, Equatable, Sendable {
        public static let limit = 200

        /// key → the kind that goes first.
        public private(set) var prefer: [String: Kind] = [:]
        /// key → the kind it was last switched to, and how many times in a row.
        public private(set) var pending: [String: Pending] = [:]
        /// Keys from oldest to newest use.
        public private(set) var order: [String] = []

        public struct Pending: Codable, Equatable, Sendable {
            public var kind: Kind
            public var count: Int
        }

        public init() {}

        /// 바꾸기 on a line with this key, from the kind that was made to the next one.
        public mutating func switched(key: String, from: Kind, to: Kind) {
            if prefer[key] == from {
                prefer[key] = nil
                pending[key] = nil
            } else if let streak = pending[key], streak.kind == to {
                if streak.count + 1 >= 2 {
                    prefer[key] = to
                    pending[key] = nil
                } else {
                    pending[key] = Pending(kind: to, count: streak.count + 1)
                }
            } else {
                pending[key] = Pending(kind: to, count: 1)
            }
            order.removeAll { $0 == key }
            if prefer[key] != nil || pending[key] != nil { order.append(key) }
            while order.count > Self.limit {
                let oldest = order.removeFirst()
                prefer[oldest] = nil
                pending[oldest] = nil
            }
        }
    }
}

/// Matching helpers for the alarm words: case-insensitive, a phrase matched whole (nothing
/// letter- or digit-like right before or after).
private enum AlarmWords {
    static func first(_ pattern: String, in text: String) -> (range: Range<String.Index>, groups: [String: String])? {
        let full = #"(?<![\p{L}\p{N}:/])(?:"# + pattern + #")(?![\p{L}\p{N}:/])"#
        guard let regex = RegexCache.regex(full, [.caseInsensitive]) else { return nil }
        let ns = text as NSString
        guard let result = regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)),
              let range = Range(result.range, in: text) else { return nil }
        var groups: [String: String] = [:]
        for name in ["w", "run", "h", "m", "um", "half", "p", "ap", "dp", "om"] where pattern.contains("(?<\(name)>") {
            let part = result.range(withName: name)
            if part.location != NSNotFound { groups[name] = ns.substring(with: part).lowercased() }
        }
        return (range, groups)
    }

    static func cut(_ range: Range<String.Index>, in text: String) -> String {
        var copy = text
        copy.replaceSubrange(range, with: " ")
        return copy
    }
}

/// The repeat words: a phrase at the very start of the text, case-insensitive, ending where a word
/// ends; returns the named groups (lowercased) and what follows, trimmed.
private enum RepeatWords {
    static func lead(_ pattern: String, in text: String) -> (groups: [String: String], rest: String)? {
        let full = #"^(?:"# + pattern + #")(?=\s|$)"#
        guard let regex = RegexCache.regex(full, [.caseInsensitive]) else { return nil }
        let ns = text as NSString
        guard let result = regex.firstMatch(in: text, range: NSRange(location: 0, length: ns.length)) else { return nil }
        var groups: [String: String] = [:]
        for name in ["w", "run", "md", "h", "m", "um", "half", "p", "ap", "mark"] where pattern.contains("(?<\(name)>") {
            let part = result.range(withName: name)
            if part.location != NSNotFound { groups[name] = ns.substring(with: part).lowercased() }
        }
        let rest = ns.substring(from: result.range.location + result.range.length).trimmingCharacters(in: .whitespaces)
        return (groups, rest)
    }
}

extension Intent.RepeatGuess {
    /// "매주 월 09:00", "매일" · "Every Mon 9:00 AM" · "Elke ma 09:00".
    public func when(_ language: AppLanguage) -> String {
        let text = Intent.ruleText(rule, language: language)
        guard let time else { return text }
        let parts = time.split(separator: ":").compactMap { Int($0) }
        return text + " " + language.clock(hour: parts[0], minute: parts[1])
    }
}
