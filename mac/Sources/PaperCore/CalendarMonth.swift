import Foundation

/// 달력: the month and week pages of the calendar window. Days are local calendar days
/// ("yyyy-MM-dd", midnight to midnight — not the note's 4 a.m. day) and weeks start on the system's first day
/// (Monday or Sunday; else Sunday, Monday in Dutch: AppLanguage.weekStartsMonday).
/// Same rules and test cases as the Windows app (calendar.ts).
public enum CalendarMonth {
    /// A to-do on a day: its alert time, or its deadline.
    public struct DayTask: Equatable, Sendable {
        /// `range` (1.39): a to-do's time on that day, drawn as an outlined block; `time` is its range.
        /// `repeating` (#274): a day a repeating to-do comes back on (`repeats`).
        public enum Kind: String, Sendable { case reminder, deadline, range, repeating = "repeat" }
        public var title: String
        public var kind: Kind
        /// "HH:mm" for an alert.
        public var time: String?
        /// The to-do; for a repeat, its open copy (nil while today's is done: the line opens the rule).
        public var taskId: UUID?
        /// #274: a repeat's rule.
        public var seriesId: String? = nil
        /// #274: a repeat after the next one, drawn faded.
        public var ahead = false
        /// #274: a repeat's alert time as written in its rule, "HH:mm" (the widgets' lines go by it).
        public var remindAt: String? = nil
        /// #296: a repeat's kind of rule (매일 · 평일 · 매주 · 매달).
        public var rule: RepeatKind? = nil

        /// #296: a faded repeat that comes back every day or every weekday — a month cell doesn't write its name but counts it
        /// in its head (`folded`). The next one (solid) and weekly · monthly ones keep their line.
        public var folds: Bool { kind == .repeating && ahead && (rule == .daily || rule == .weekdays) }
    }

    /// One line in a month cell.
    public enum CellItem: Equatable, Sendable {
        case event(CalendarEvent)
        case task(DayTask)
    }

    // MARK: Pages

    /// Always six weeks, from the Sunday (Dutch: the Monday) on or before the 1st.
    public static func monthGrid(year: Int, month: Int, calendar: Calendar = .paper, language: AppLanguage = .ko) -> [String] {
        let first = calendar.date(from: DateComponents(year: year, month: month, day: 1))!
        return days(from: weekStart(of: first, calendar: calendar, language: language), count: 42, calendar: calendar)
    }

    /// Sunday to Saturday (Dutch: Monday to Sunday) around `day`.
    public static func weekDays(_ day: String, calendar: Calendar = .paper, language: AppLanguage = .ko) -> [String] {
        days(from: weekStart(of: date(day, calendar: calendar), calendar: calendar, language: language), count: 7, calendar: calendar)
    }

    /// The headings over a week's columns, in the week's order: "일"…"토", "S M T W T F S", "ma"…"zo".
    public static func weekdayLabels(_ language: AppLanguage = .ko) -> [String] {
        language.weekdayOrder.map { language.weekdayLetter($0) }
    }

    /// The first day's midnight to the midnight after the last.
    public static func fetchRange(_ days: [String], calendar: Calendar = .paper) -> (start: Date, end: Date) {
        let start = date(days.first!, calendar: calendar)
        return (start, calendar.date(byAdding: .day, value: 1, to: date(days.last!, calendar: calendar))!)
    }

    // MARK: A day

    public static func eventsOn(_ day: String, _ events: [CalendarEvent], calendar: Calendar = .paper) -> [CalendarEvent] {
        let midnight = date(day, calendar: calendar)
        let next = calendar.date(byAdding: .day, value: 1, to: midnight)!
        return events
            .filter { event in
                if event.allDay { return event.start <= midnight && midnight < event.end }
                if event.start == event.end { return event.start >= midnight && event.start < next }
                return event.start < next && event.end > midnight
            }
            .sorted { a, b in
                if a.allDay != b.allDay { return a.allDay }
                // calendar-flows D1: the all-day one begun first (then the longer) on top, so a trip keeps its place
                // day after day and its band joins; one-day ones by title, as before.
                if a.allDay {
                    if a.start != b.start { return a.start < b.start }
                    if a.end != b.end { return a.end > b.end }
                    return a.title < b.title
                }
                if a.start != b.start { return a.start < b.start }
                return a.title < b.title
            }
    }

    // MARK: 여러 날 일정과 긴 이름 (calendar-flows D1 · D2)

    /// The event's key when it is drawn as a band on `day` (all day, or running through the whole day: begun the day
    /// before and ending the day after), else nil. A band with the same key on the next day in the same place joins it.
    public static func bandKey(_ event: CalendarEvent, on day: String, calendar: Calendar = .paper) -> String? {
        let midnight = date(day, calendar: calendar)
        let next = calendar.date(byAdding: .day, value: 1, to: midnight)!
        if event.allDay { return event.start <= midnight && midnight < event.end ? event.key : nil }
        return event.start < midnight && event.end > next ? event.key : nil
    }

    /// A line of a week row's cell as drawn: `run` ≥ 1 where its title is drawn — over how many days, its own and the
    /// following ones where the same band sits in the same place; 0 where an earlier day's title runs over it (the band
    /// only). `fromLeft` · `toRight`: it joins the day before · after in the row.
    public struct Band: Equatable, Sendable {
        public var run: Int
        public var fromLeft: Bool
        public var toRight: Bool
        public init(run: Int, fromLeft: Bool, toRight: Bool) { self.run = run; self.fromLeft = fromLeft; self.toRight = toRight }
        /// It lines up with another day (a title running on, or a band joined): it keeps one line.
        public var joined: Bool { fromLeft || toRight || run > 1 }
    }

    /// A week row's bands: `rows[d]` are day d's lines as drawn, each its band key (`bandKey`) or nil. The title is
    /// drawn once per run — on the band's first day in the row (a new row draws it again) — and runs over the days the
    /// same band keeps the same place; a band that moves to another place starts again.
    public static func bands(_ rows: [[String?]]) -> [[Band]] {
        func key(_ day: Int, _ index: Int) -> String? {
            guard rows.indices.contains(day), rows[day].indices.contains(index) else { return nil }
            return rows[day][index]
        }
        return rows.enumerated().map { day, lines in
            lines.enumerated().map { index, band in
                guard let band else { return Band(run: 1, fromLeft: false, toRight: false) }
                let fromLeft = key(day - 1, index) == band
                let toRight = key(day + 1, index) == band
                guard !fromLeft else { return Band(run: 0, fromLeft: true, toRight: toRight) }
                var run = 1
                while key(day + run, index) == band { run += 1 }
                return Band(run: run, fromLeft: false, toRight: toRight)
            }
        }
    }

    /// How a month cell's line fits on one line: whole, cut (it may take a second line), or a band joined to another day.
    public enum LineFit: String, Sendable { case fit, cut, band }

    /// Audit 3 · 28 (D2): the lines that take a second line for a cut title. The cell's spare lines (`room` less the
    /// lines drawn) go to the cut titles from the top, one each — never to a band joined to another day, nor to a line
    /// above one (the band would leave its place beside the next day).
    public static func twoLineTitles(room: Int, lines: [LineFit]) -> [Bool] {
        var spare = room - lines.count
        let lastBand = lines.lastIndex(of: .band) ?? -1
        return lines.enumerated().map { index, fit in
            guard spare > 0, fit == .cut, index > lastBand else { return false }
            spare -= 1
            return true
        }
    }

    /// #260: as `twoLineTitles`, with the day's holiday name as the cell's first line (`holiday`, nil on other days) and
    /// `room` counting it. The spare lines go from the top, so the name comes first; it takes two lines only when no band
    /// passes through that day (a band below it would leave its place beside the next day).
    public static func twoLineTitles(room: Int, holiday: LineFit?, lines: [LineFit]) -> (holiday: Bool, lines: [Bool]) {
        guard let holiday else { return (false, twoLineTitles(room: room, lines: lines)) }
        let two = twoLineTitles(room: room, lines: [holiday] + lines)
        return (two[0], Array(two.dropFirst()))
    }

    /// #260: English and Dutch also break a long word onto the second line, by the language's hyphenation
    /// ("Avond-/wandeling"); Korean breaks between words only.
    public static func hyphenates(_ language: AppLanguage) -> Bool { language != .ko }

    /// #260: how a title that may not fit sits on one line. `overflows`: wider than the line; `betweenWords`: it has a
    /// space and its first word fits; `inWord`: its first word's first hyphenated piece fits.
    public static func lineFit(overflows: Bool, betweenWords: Bool, inWord: Bool, language: AppLanguage) -> LineFit {
        guard overflows else { return .fit }
        return betweenWords || (inWord && hyphenates(language)) ? .cut : .fit
    }

    /// #260: `text` with soft hyphens (U+00AD) where the language may break its words (the system's hyphenation, as
    /// `hyphens: auto` on Windows): drawn only where a line breaks there. Korean, and text without such places, as it is.
    /// The system's dictionary decides the places, so they may differ from Windows' for an event's title.
    public static func hyphenated(_ text: String, language: AppLanguage) -> String {
        // Korean as it is; a text that already has its places (a holiday's name) too.
        guard hyphenates(language), !text.contains("\u{00AD}") else { return text }
        let locale = CFLocaleCreate(nil, CFLocaleIdentifier(rawValue: language.rawValue as CFString))
        guard CFStringIsHyphenationAvailableForLocale(locale) else { return text }
        return text.split(separator: " ", omittingEmptySubsequences: false).map { word -> String in
            let piece = String(word) as CFString
            let length = CFStringGetLength(piece)
            guard length >= 5 else { return String(word) }
            var cuts: [Int] = [], before = length
            while before > 1 {
                let at = CFStringGetHyphenationLocationBeforeIndex(piece, before, CFRange(location: 0, length: length), 0, locale, nil)
                guard at != kCFNotFound, at > 0, at < before else { break }
                cuts.append(at)
                before = at
            }
            var units = Array(String(word).utf16)
            for cut in cuts { units.insert(0xAD, at: cut) }
            return String(utf16CodeUnits: units, count: units.count)
        }.joined(separator: " ")
    }

    /// #260: the first piece of `text`'s first word that a hyphenated break leaves on the first line ("Avond" of
    /// "Avondwandeling"), or nil where it has none.
    public static func firstPiece(_ text: String, language: AppLanguage) -> String? {
        let first = String(hyphenated(text, language: language).split(separator: " ").first ?? "")
        guard let soft = first.firstIndex(of: "\u{00AD}") else { return nil }
        return String(first[..<soft])
    }

    /// "종일", "10:00–11:00", "~01:00" (began the day before), "23:30~" (runs into the next), "12:00".
    /// English: "All day", "10:00–11:00 AM", "11:30 AM–12:30 PM", "~1:00 AM", "11:30 PM~", "12:00 PM".
    public static func agendaTime(_ event: CalendarEvent, on day: String, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String {
        if event.allDay { return CalendarDay.allDayText(language) }
        let midnight = date(day, calendar: calendar)
        let next = calendar.date(byAdding: .day, value: 1, to: midnight)!
        let before = event.start < midnight, after = event.end > next
        if before && after { return CalendarDay.allDayText(language) }
        if before { return "~" + clock(event.end, calendar: calendar, language: language) }
        if after { return clock(event.start, calendar: calendar, language: language) + "~" }
        if event.start == event.end { return clock(event.start, calendar: calendar, language: language) }
        let a = calendar.dateComponents([.hour, .minute], from: event.start), b = calendar.dateComponents([.hour, .minute], from: event.end)
        return language.timeRange(from: (a.hour!, a.minute!), to: (b.hour!, b.minute!))
    }

    /// Unfinished to-dos due or alerting that day: alerts by time, then deadlines by title. A to-do
    /// with both shows once, as its deadline. An alert's time is on the language's clock ("09:30", "9:30 AM").
    /// 1.39: a to-do with a time range on that day shows once, as its range, among the alerts by its start
    /// (`ranges: false` leaves them as before — the month cells).
    public static func dayTasks(_ day: String, _ tasks: [TodoItem], now: Date = Date(), ranges: Bool = true, calendar: Calendar = .paper,
                                language: AppLanguage = .ko) -> [DayTask] {
        dayTasks(on: [day], tasks, now: now, ranges: ranges, calendar: calendar, language: language)[day] ?? []
    }

    /// `dayTasks` for several days from one pass over the to-dos (#68: the month asked once per cell, two or three
    /// times): a to-do goes to the day of its range, of its deadline and of its alert, each day taking it once and
    /// in the same way as `dayTasks` of that day alone.
    public static func dayTasks(on days: Set<String>, _ tasks: [TodoItem], now: Date = Date(), ranges: Bool = true,
                                calendar: Calendar = .paper, language: AppLanguage = .ko) -> [String: [DayTask]] {
        var reminders: [String: [(Date, DayTask)]] = [:]
        var deadlines: [String: [DayTask]] = [:]
        for task in tasks where !task.isCompleted {
            // The day its range is on (that day shows it as its range, and only so).
            var rangeDay: String?
            if ranges, let range = task.timeRange, let start = TimeBlock.interval(of: task, now: now, calendar: calendar)?.start,
               let day = TimeBlock.day(of: task, now: now, calendar: calendar) {
                rangeDay = day
                if days.contains(day) {
                    reminders[day, default: []].append((start, DayTask(title: task.title, kind: .range, time: range.text(language), taskId: task.id)))
                }
            }
            if let due = task.dueDate, due != rangeDay, days.contains(due) {
                deadlines[due, default: []].append(DayTask(title: task.title, kind: .deadline, time: nil, taskId: task.id))
            }
            if let at = task.reminderAt {
                let day = CalendarDraft.day(at, calendar: calendar)
                if day != rangeDay, day != task.dueDate, days.contains(day) {
                    reminders[day, default: []].append((at, DayTask(title: task.title, kind: .reminder,
                                                                    time: clock(at, calendar: calendar, language: language), taskId: task.id)))
                }
            }
        }
        var found: [String: [DayTask]] = [:]
        for day in Set(reminders.keys).union(deadlines.keys) {
            found[day] = (reminders[day] ?? []).sorted { $0.0 < $1.0 }.map(\.1) + (deadlines[day] ?? []).sorted { $0.title < $1.title }
        }
        return found
    }

    /// #274: the days a repeating to-do comes back on among `days`, from the note's today (4 a.m.) on — each a `repeating`
    /// line with the rule's title and alert time. The next one is drawn as usual and the ones after it faded (`ahead`);
    /// where the open copy already shows on today or later (its alert, deadline or time), the copy is the next one and
    /// every repeat is faded. A day the copy shows on has no repeat (it isn't drawn twice), and once today's copy is done
    /// (placed today, none open) the repeats start tomorrow. A line opens the open copy (`taskId`), or the rule when there
    /// is none. Each day's repeats go by their time, then title (no time last). Same rule and shared cases as Windows
    /// (calendar.ts `repeatsOn`, docs/plans/calendar-flows-cases.json `repeats`).
    public static func repeats(on days: Set<String>, series: [Series], tasks: [TodoItem], now: Date, ranges: Bool = true,
                               calendar: Calendar = .paper, language: AppLanguage = .ko) -> [String: [DayTask]] {
        guard !series.isEmpty else { return [:] }
        let today = Archive.dayKey(now, calendar: calendar)
        let wanted = days.filter { $0 >= today }
        guard !wanted.isEmpty, let last = wanted.max() else { return [:] }
        var open: [String: TodoItem] = [:]
        for task in tasks where !task.isCompleted {
            if let id = task.seriesID, open[id] == nil { open[id] = task }
        }
        // The days from today to the last one asked about, worked out once for every rule: weekday (0 = Sunday), day of the
        // month and the month's last day (Repeat.occurs, without a calendar call per rule and day).
        var span: [(key: String, weekday: Int, day: Int, lastDay: Int)] = []
        var moment = date(today, calendar: calendar), month = -1, lastDay = 31
        while true {
            let key = CalendarDraft.day(moment, calendar: calendar)
            guard key <= last, span.count < 750 else { break }
            let parts = calendar.dateComponents([.weekday, .day, .month], from: moment)
            if parts.month! != month {
                month = parts.month!
                lastDay = calendar.range(of: .day, in: .month, for: moment)?.count ?? 31
            }
            span.append((key, parts.weekday! - 1, parts.day!, lastDay))
            moment = calendar.date(byAdding: .day, value: 1, to: moment)!
        }
        var found: [String: [(minutes: Int, task: DayTask)]] = [:]
        for entry in series where Repeat.isValid(entry.rule) {
            let copy = open[entry.id]
            // The days the open copy is drawn on already.
            var shown: Set<String> = []
            if let copy {
                if let due = copy.dueDate { shown.insert(due) }
                if let at = copy.reminderAt { shown.insert(CalendarDraft.day(at, calendar: calendar)) }
                if ranges, copy.timeRange != nil, let day = TimeBlock.day(of: copy, now: now, calendar: calendar) { shown.insert(day) }
            }
            let copyAhead = shown.contains { $0 >= today }
            let rule = entry.rule
            func occurs(_ day: (key: String, weekday: Int, day: Int, lastDay: Int)) -> Bool {
                switch rule.kind {
                case .daily: true
                case .weekdays: (1...5).contains(day.weekday)
                case .weekly: (rule.weekdays ?? []).contains(day.weekday)
                case .monthly: day.day == min(rule.monthDay ?? 1, day.lastDay)
                }
            }
            let parts = entry.remindAt?.split(separator: ":").compactMap { Int($0) }
            let clock = parts.flatMap { $0.count == 2 ? language.clock(hour: $0[0], minute: $0[1]) : nil }
            let minutes = parts.flatMap { $0.count == 2 ? $0[0] * 60 + $0[1] : nil } ?? Int.max
            // From today, or tomorrow once today's is done. The first day it occurs is the next one; when that is past the
            // last day asked about, none of them is drawn anyway.
            var next: String?
            for day in span.dropFirst(entry.lastPlaced == today && copy == nil ? 1 : 0) where occurs(day) {
                if next == nil { next = day.key }
                guard wanted.contains(day.key), !shown.contains(day.key) else { continue }
                found[day.key, default: []].append((minutes, DayTask(title: entry.title, kind: .repeating, time: clock, taskId: copy?.id,
                                                                     seriesId: entry.id, ahead: copyAhead || day.key != next,
                                                                     remindAt: clock == nil ? nil : entry.remindAt, rule: rule.kind)))
            }
        }
        return found.mapValues { list in
            list.sorted { $0.minutes != $1.minutes ? $0.minutes < $1.minutes : $0.task.title < $1.task.title }.map(\.task)
        }
    }

    /// What a month cell shows: the day's events, then its deadlines, then its reminders (#227); the first `limit` and how
    /// many more.
    public static func cellItems(_ day: String, events: [CalendarEvent], tasks: [TodoItem], series: [Series] = [], now: Date = Date(),
                                 limit: Int = 3, folding: Bool = false, calendar: Calendar = .paper, language: AppLanguage = .ko) -> (items: [CellItem], more: Int) {
        Page(days: [day], events: events, tasks: tasks, series: series, now: now, ranges: false, calendar: calendar, language: language)
            .cell(day, limit: limit, folding: folding)
    }

    /// A week row's to-dos (#227, as the month cell's order): the deadlines first, then the alerts and time ranges by time —
    /// when the row is full, "+N개 더" takes the reminders first. The day panel keeps `dayTasks`' order.
    public static func weekOrder(_ tasks: [DayTask]) -> [DayTask] {
        tasks.filter { $0.kind == .deadline } + tasks.filter { $0.kind != .deadline }
    }

    /// A to-do line's tooltip in a month cell or a week row (#227): "알림 15:00 · 치과 예약", "마감 · 보고서 쓰기",
    /// "14:00–15:30 · 운동" — en "Reminder 3:00 PM · …", "Due · …"; nl "Herinnering 15:00 · …", "Deadline · …".
    /// #274: "반복 예정 09:00 · 분리수거" (the next one "반복 09:00 · …") — en "Upcoming repeat …", "Repeat …";
    /// nl "Komende herhaling …", "Herhaling …".
    public static func tooltip(_ task: DayTask, language: AppLanguage = .ko) -> String {
        switch task.kind {
        case .reminder: ["알림", "Reminder", "Herinnering"][language.index] + " \(task.time ?? "") · \(task.title)"
        case .deadline: ["마감", "Due", "Deadline"][language.index] + " · \(task.title)"
        case .range: "\(task.time ?? "") · \(task.title)"
        case .repeating: repeatWord(ahead: task.ahead, language: language) + (task.time.map { " " + $0 } ?? "") + " · \(task.title)"
        }
    }

    /// #274: what a repeat's line is: "반복 예정" (faded) or "반복" (the next one) — en "Upcoming repeat" · "Repeat";
    /// nl "Komende herhaling" · "Herhaling".
    public static func repeatWord(ahead: Bool, language: AppLanguage = .ko) -> String {
        ahead ? ["반복 예정", "Upcoming repeat", "Komende herhaling"][language.index] : ["반복", "Repeat", "Herhaling"][language.index]
    }

    /// #274: a repeat's spoken name: "분리수거, 오전 9:00, 반복 예정" — en "Recycling, 9:00 AM, upcoming repeat".
    public static func spoken(_ task: DayTask, language: AppLanguage = .ko) -> String {
        guard task.kind == .repeating else { return tooltip(task, language: language) }
        let word = repeatWord(ahead: task.ahead, language: language)
        return ([task.title] + (task.time.map { [$0] } ?? []) + [language == .ko ? word : word.lowercased()]).joined(separator: ", ")
    }

    /// #296: what a month cell's head says for the repeats it folds — "매일 반복 2개", "평일 반복 1개", "매일 · 평일 반복 3개";
    /// en "2 daily repeats", "1 weekday repeat", "3 daily and weekday repeats"; nl "2 dagelijkse herhalingen",
    /// "1 doordeweekse herhaling", "3 dagelijkse en doordeweekse herhalingen". The screen reader reads it; nil for none.
    public static func foldedLabel(_ tasks: [DayTask], language: AppLanguage = .ko) -> String? {
        guard !tasks.isEmpty else { return nil }
        let daily = tasks.contains { $0.rule == .daily }, weekdays = tasks.contains { $0.rule == .weekdays }
        let n = tasks.count, one = n == 1
        switch language {
        case .ko: return (daily && weekdays ? "매일 · 평일" : daily ? "매일" : "평일") + " 반복 \(n)개"
        case .en: return "\(n) " + (daily && weekdays ? "daily and weekday" : daily ? "daily" : "weekday") + (one ? " repeat" : " repeats")
        case .nl: return "\(n) " + (daily && weekdays ? "dagelijkse en doordeweekse" : daily ? "dagelijkse" : "doordeweekse") + (one ? " herhaling" : " herhalingen")
        }
    }

    /// #296: the folded repeats' tooltip — the label, then each one's time and name a line: "매일 반복 2개\n08:00 약 먹기\n물 마시기".
    public static func foldedTooltip(_ tasks: [DayTask], language: AppLanguage = .ko) -> String? {
        guard let label = foldedLabel(tasks, language: language) else { return nil }
        return ([label] + tasks.map { task in task.time.map { "\($0) \(task.title)" } ?? task.title }).joined(separator: "\n")
    }

    /// #296: whether a month cell's line may take a spare line (`twoLineTitles`): not a faded repeat — the spare lines go to
    /// the events and to-dos first.
    public static func mayWrap(_ item: CellItem) -> Bool {
        if case .task(let task) = item, task.kind == .repeating, task.ahead { return false }
        return true
    }

    /// A page of the calendar worked out once (#68): each day's events (`eventsOn`), to-dos (`dayTasks`) and month
    /// cell (`cellItems`). The month window used to expand every repeating event and read every to-do two or three
    /// times per cell, on every change of the model.
    public struct Page: Sendable {
        private var events: [String: [CalendarEvent]] = [:]
        private var tasks: [String: [DayTask]] = [:]
        /// The cells' to-dos: unfinished ones due that day, by title (`dayTasks(ranges: false)`'s deadlines).
        private var deadlines: [String: [DayTask]] = [:]
        /// #227: and the ones whose reminder is that day, by time (a to-do due the same day shows once, as its deadline).
        private var reminders: [String: [DayTask]] = [:]
        /// #274: the days the repeating to-dos come back on (`repeats`), after the day's other to-dos.
        private var repeats: [String: [DayTask]] = [:]

        /// `days`: every day asked about later (the page's, and the chosen one); another day has nothing.
        /// `ranges: false`: the cells only (no day's own to-dos). `series`: the repeating to-dos (#274).
        public init(days: [String], events: [CalendarEvent], tasks: [TodoItem], series: [Series] = [], now: Date = Date(), ranges: Bool = true,
                    calendar: Calendar = .paper, language: AppLanguage = .ko) {
            let wanted = Set(days)
            for day in wanted { self.events[day] = CalendarMonth.eventsOn(day, events, calendar: calendar) }
            if ranges { self.tasks = CalendarMonth.dayTasks(on: wanted, tasks, now: now, calendar: calendar, language: language) }
            repeats = CalendarMonth.repeats(on: wanted, series: series, tasks: tasks, now: now, ranges: ranges, calendar: calendar, language: language)
            // One pass for the cells, as for the day's own to-dos (#68).
            var alerts: [String: [(Date, DayTask)]] = [:]
            for task in tasks where !task.isCompleted {
                if let due = task.dueDate, wanted.contains(due) {
                    deadlines[due, default: []].append(DayTask(title: task.title, kind: .deadline, time: nil, taskId: task.id))
                }
                if let at = task.reminderAt {
                    let day = CalendarDraft.day(at, calendar: calendar)
                    if day != task.dueDate, wanted.contains(day) {
                        alerts[day, default: []].append((at, DayTask(title: task.title, kind: .reminder,
                                                                     time: CalendarMonth.clock(at, calendar: calendar, language: language),
                                                                     taskId: task.id)))
                    }
                }
            }
            deadlines = deadlines.mapValues { $0.sorted { $0.title < $1.title } }
            reminders = alerts.mapValues { $0.sorted { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1.title < $1.1.title }.map(\.1) }
        }

        public func events(on day: String) -> [CalendarEvent] { events[day] ?? [] }
        /// The day's to-dos (`dayTasks`), then its repeats (#274).
        public func tasks(on day: String) -> [DayTask] { (tasks[day] ?? []) + (repeats[day] ?? []) }

        /// A week row's to-dos: `weekOrder` of the day's.
        public func weekTasks(on day: String) -> [DayTask] { CalendarMonth.weekOrder(tasks(on: day)) }

        /// What a month cell shows: the day's events, then its deadlines, then its reminders (#227: the title only, the
        /// time is in the tooltip), then its repeats (#274: the first to go into +N); the first `limit` and how many more.
        /// `folding` (#296, the month's cells): without the faded daily · weekday repeats, which the head counts (`folded`).
        public func cell(_ day: String, limit: Int = 3, folding: Bool = false) -> (items: [CellItem], more: Int) {
            let all = events(on: day).map(CellItem.event) + (deadlines[day] ?? []).map(CellItem.task) + (reminders[day] ?? []).map(CellItem.task)
                + (repeats[day] ?? []).filter { !folding || !$0.folds }.map(CellItem.task)
            return (Array(all.prefix(limit)), max(0, all.count - limit))
        }

        /// #296: the day's faded daily · weekday repeats, which a month cell folds into its head (a mark and how many).
        public func folded(_ day: String) -> [DayTask] { (repeats[day] ?? []).filter(\.folds) }
    }

    // MARK: 날 목록을 키보드로 (#275)

    /// A key in the desk calendar while the day or its list has the keys.
    public enum ListKey: String, Sendable { case tab, backTab, up, down, enter, escape, other }

    /// What a key does (#275): `picked` is the day list's event the keys are on (nil: the days have them), `count` the
    /// day's events. From the days, Tab goes to the first event (with none it passes on). In the list, ↑ ↓ move (they stop
    /// at the ends), Tab · ⇧Tab go to the next · previous and past the ends back to the days, Return opens the event
    /// (`open`), Esc goes back to the days. Another key goes back to the days and is theirs (`handled: false`: ← → T move
    /// the day as before). Same keys and shared cases as Windows (calendar.ts `listKey`).
    public static func listKey(_ key: ListKey, picked: Int?, count: Int) -> (picked: Int?, open: Int?, handled: Bool) {
        guard let current = picked.map({ min($0, count - 1) }), current >= 0 else {
            return key == .tab && count > 0 ? (0, nil, true) : (nil, nil, false)
        }
        switch key {
        case .down: return (min(current + 1, count - 1), nil, true)
        case .up: return (max(current - 1, 0), nil, true)
        case .tab: return (current + 1 < count ? current + 1 : nil, nil, true)
        case .backTab: return (current > 0 ? current - 1 : nil, nil, true)
        case .enter: return (current, current, true)
        case .escape: return (nil, nil, true)
        case .other: return (nil, nil, false)
        }
    }

    /// #275: an event row's spoken name — "디자인 리뷰, 14:00–15:00, 일정 3개 중 1번째"; en "Design review, 2:00–3:00 PM,
    /// event 1 of 3"; nl "Ontwerpbespreking, 14:00–15:00, afspraak 1 van 3".
    public static func eventLabel(title: String, time: String, index: Int, count: Int, language: AppLanguage = .ko) -> String {
        let place = switch language {
        case .ko: "일정 \(count)개 중 \(index + 1)번째"
        case .en: "event \(index + 1) of \(count)"
        case .nl: "afspraak \(index + 1) van \(count)"
        }
        return "\(title), \(time), \(place)"
    }

    /// 새 일정 on a day: the next half hour if it's today (21:00 once that runs into tomorrow), else 09:00.
    public static func draftForDay(_ day: String, now: Date, color: LocalEvent.Color = .blue,
                                   calendar: Calendar = .paper) -> CalendarDraft {
        var draft = CalendarDraft.new(now: now, color: color, calendar: calendar)
        if day == CalendarDraft.day(now, calendar: calendar) && draft.date == day { return draft }
        let start = day == CalendarDraft.day(now, calendar: calendar) ? 21 * 60 : 9 * 60
        draft.date = day
        draft.startMinutes = start
        draft.endMinutes = start + 60
        return draft
    }

    // MARK: Titles

    /// "2026년 10월", "October 2026", "oktober 2026"
    public static func monthTitle(year: Int, month: Int, language: AppLanguage = .ko) -> String {
        language.monthTitle(year: year, month: month)
    }

    /// "10월 4일 – 10일", "9월 27일 – 10월 3일", "2026년 12월 27일 – 2027년 1월 2일" — en "Oct 4 – 10", "Sep 27 – Oct 3",
    /// "Dec 27, 2026 – Jan 2, 2027"; nl "4 – 10 okt", "27 sep – 3 okt", "27 dec 2026 – 2 jan 2027".
    public static func weekTitle(_ days: [String], language: AppLanguage = .ko) -> String {
        language.weekTitle(first: parts(days.first!), last: parts(days.last!))
    }

    /// "10월 7일 수요일", "Wednesday, October 7", "woensdag 7 oktober"
    public static func dayTitle(_ day: String, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String {
        language.longDate(date(day, calendar: calendar), calendar: calendar)
    }

    // MARK: Helpers

    public static func date(_ day: String, calendar: Calendar = .paper) -> Date {
        CalendarDraft.localDay(day, calendar: calendar) ?? calendar.startOfDay(for: Date())
    }

    public static func parts(_ day: String) -> (year: Int, month: Int, day: Int) {
        let p = day.split(separator: "-").compactMap { Int($0) }
        return (p[0], p[1], p[2])
    }

    /// The day `count` days after (or before).
    public static func adding(_ count: Int, to day: String, calendar: Calendar = .paper) -> String {
        CalendarDraft.day(calendar.date(byAdding: .day, value: count, to: date(day, calendar: calendar))!, calendar: calendar)
    }

    /// The week's first day (AppLanguage.weekStartsMonday) on or before `date`.
    private static func weekStart(of date: Date, calendar: Calendar, language: AppLanguage) -> Date {
        let start = calendar.startOfDay(for: date)
        let weekday = calendar.component(.weekday, from: start) - 1 // 0 = Sunday
        let back = language.weekStartsMonday ? (weekday + 6) % 7 : weekday
        return calendar.date(byAdding: .day, value: -back, to: start)!
    }

    private static func days(from start: Date, count: Int, calendar: Calendar) -> [String] {
        (0..<count).map { CalendarDraft.day(calendar.date(byAdding: .day, value: $0, to: start)!, calendar: calendar) }
    }

    fileprivate static func clock(_ date: Date, calendar: Calendar, language: AppLanguage) -> String {
        let p = calendar.dateComponents([.hour, .minute], from: date)
        return language.clock(hour: p.hour!, minute: p.minute!)
    }
}
