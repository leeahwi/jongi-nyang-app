import Foundation

/// 하루 띠 (1.40): the strip under the 오늘 sheet's header — what's on now (or next) in large with a ring of the
/// time left, the next few things as rows, a thin bar of the whole day — and, opened, the day as a timetable
/// (하루 일정표). Pure: the note draws what this decides. Same rules and cases as the Windows app (dayStrip.ts),
/// listed in ribbon-cases.md.
public enum DayStrip {
    /// Events first, then to-dos with a time, then reminders, wherever two start in the same minute.
    public enum Kind: Int, Comparable, Sendable {
        case event, task, reminder
        public static func < (a: Kind, b: Kind) -> Bool { a.rawValue < b.rawValue }
    }

    /// One thing on today's sheet with a time: a timed event, a to-do's time (its block) or a to-do's reminder.
    public struct Item: Equatable, Sendable {
        /// The event's key ("local/<id>@<day>") or the to-do's id.
        public var id: String
        public var kind: Kind
        public var title: String
        public var start: Date
        /// A reminder has none.
        public var end: Date?
        public var event: CalendarEvent?
        public var taskID: String?
        public var done: Bool
        /// A to-do with a time that also has a reminder (the bell in the sub line).
        public var hasReminder: Bool
        /// Where it came in (events in the calendar's order, then the to-dos in the list's).
        public var order: Int

        public init(id: String, kind: Kind, title: String, start: Date, end: Date?, event: CalendarEvent? = nil, taskID: String? = nil,
                    done: Bool = false, hasReminder: Bool = false, order: Int = 0) {
            self.id = id; self.kind = kind; self.title = title; self.start = start; self.end = end; self.event = event
            self.taskID = taskID; self.done = done; self.hasReminder = hasReminder; self.order = order
        }
    }

    /// Today's items: the timed events (all-day ones are the top line's), every to-do whose time is on today
    /// (TimeBlock.day; done ones too — they're drawn faded and never current or next), and the open to-dos
    /// without a time today whose reminder is on today's sheet. A to-do with a time is one item: its reminder,
    /// at whatever time, isn't a second one.
    public static func items(events: [CalendarEvent], tasks: [TodoItem], now: Date, calendar: Calendar = .paper) -> [Item] {
        let (dayStart, dayEnd) = CalendarDay.window(now, calendar: calendar)
        let today = Archive.dayKey(now, calendar: calendar)
        var items: [Item] = []
        for event in events where !event.allDay {
            items.append(Item(id: event.key, kind: .event, title: event.title, start: event.start, end: event.end, event: event, order: items.count))
        }
        for task in tasks {
            if task.timeRange != nil, TimeBlock.day(of: task, now: now, calendar: calendar) == today,
               let interval = TimeBlock.interval(of: task, now: now, calendar: calendar) {
                items.append(Item(id: task.id.uuidString, kind: .task, title: task.title, start: interval.start, end: interval.end,
                                  taskID: task.id.uuidString, done: task.isCompleted, hasReminder: task.reminderAt != nil, order: items.count))
            } else if !task.isCompleted, let at = task.reminderAt, at >= dayStart, at < dayEnd {
                items.append(Item(id: task.id.uuidString, kind: .reminder, title: task.title, start: at, end: nil,
                                  taskID: task.id.uuidString, hasReminder: true, order: items.count))
            }
        }
        return items
    }

    // MARK: Now and next

    public enum Mode: Equatable, Sendable {
        /// Something is going on: the ring shows its time left.
        case now
        /// Nothing is: the ring shows the time until the next thing.
        case next
        /// Nothing more today.
        case nothing
    }

    public struct State: Equatable, Sendable {
        public var mode: Mode
        /// The large one: what's on now, or (`.next`) the next thing.
        public var lead: Item?
        /// Minutes left (`.now`) or until it starts (`.next`), rounded up, at least 1.
        public var minutes: Int
        /// How far through it is (`.now`, 0…1); `.next`: how much of the last hour before it has gone (0 when it's
        /// more than an hour away).
        public var progress: Double
        /// The rows under it: what starts after now, in order (after the lead when the lead is the next thing).
        public var rows: [Item]
    }

    /// What's going on now: of the open events and to-dos with a time that have started and not ended, the one
    /// that started last (an event before a to-do at the same start, then the one ending first, then the order).
    public static func current(_ items: [Item], now: Date) -> Item? {
        items.filter { $0.kind != .reminder && !$0.done && $0.start <= now && ($0.end ?? $0.start) > now }
            .sorted { a, b in
                if a.start != b.start { return a.start > b.start }
                if a.kind != b.kind { return a.kind < b.kind }
                if a.end != b.end { return (a.end ?? a.start) < (b.end ?? b.start) }
                return a.order < b.order
            }
            .first
    }

    /// What starts after now, open, in order: by start, then events · to-dos · reminders, then the one ending
    /// first, then the order.
    public static func upcoming(_ items: [Item], now: Date) -> [Item] {
        items.filter { !$0.done && $0.start > now }.sorted(by: ahead)
    }

    static func ahead(_ a: Item, _ b: Item) -> Bool {
        if a.start != b.start { return a.start < b.start }
        if a.kind != b.kind { return a.kind < b.kind }
        let (ea, eb) = (a.end ?? a.start, b.end ?? b.start)
        if ea != eb { return ea < eb }
        return a.order < b.order
    }

    /// The strip's state with at most `limit` rows.
    public static func state(_ items: [Item], now: Date, rows limit: Int) -> State {
        let later = upcoming(items, now: now)
        if let current = current(items, now: now), let end = current.end {
            let length = end.timeIntervalSince(current.start)
            let progress = length > 0 ? min(1, max(0, now.timeIntervalSince(current.start) / length)) : 1
            return State(mode: .now, lead: current, minutes: minutes(from: now, to: end), progress: progress, rows: Array(later.prefix(limit)))
        }
        guard let next = later.first else { return State(mode: .nothing, lead: nil, minutes: 0, progress: 0, rows: []) }
        let away = minutes(from: now, to: next.start)
        return State(mode: .next, lead: next, minutes: away, progress: away <= 60 ? Double(60 - away) / 60 : 0,
                     rows: Array(later.dropFirst().prefix(limit)))
    }

    /// Rows under the lead: one in a narrow note (≤ 400 pt wide), three in a tall one (≥ 720 pt high), else two.
    public static func rowLimit(width: Double, height: Double) -> Int {
        width <= 400 ? 1 : height >= 720 ? 3 : 2
    }

    /// The top line's link: "하루 전체 ›" · "Whole day ›" · "Hele dag ›"; narrow (≤ 400 pt) "전체 ›" · "Day ›" · "Dag ›".
    public static func wholeDayLink(narrow: Bool, language: AppLanguage) -> String {
        narrow ? ["전체 ›", "Day ›", "Dag ›"][language.index] : ["하루 전체 ›", "Whole day ›", "Hele dag ›"][language.index]
    }

    /// Minutes until, rounded up, at least 1 (an end at 14:00 is 40 at 13:20:00 and at 13:20:30).
    public static func minutes(from now: Date, to date: Date) -> Int {
        max(1, Int((date.timeIntervalSince(now) / 60).rounded(.up)))
    }

    // MARK: Words

    /// The ring's centre: the number and the small word under it. Under an hour "40" + "분 남음" · "min left" ·
    /// "min over" (`.next`: "분 뒤" · "min away" · "min te gaan"); an hour or more "1:20" + "남음" · "left" · "over"
    /// (`.next`: "뒤" · "away" · "te gaan").
    public static func ringText(minutes: Int, mode: Mode, language: AppLanguage) -> (value: String, caption: String) {
        let left = mode != .next
        if minutes < 60 {
            let caption = left ? ["분 남음", "min left", "min over"][language.index] : ["분 뒤", "min away", "min te gaan"][language.index]
            return ("\(minutes)", caption)
        }
        let caption = left ? ["남음", "left", "over"][language.index] : ["뒤", "away", "te gaan"][language.index]
        return ("\(minutes / 60):" + String(format: "%02d", minutes % 60), caption)
    }

    /// A row's "when": "40분 뒤" · "in 40 min" · "over 40 min"; under two hours with its minutes ("1시간 5분 뒤",
    /// "1시간 뒤"); from two hours, the nearest whole hour ("2시간 뒤" for 2 h 10 min, "3시간 뒤" for 2 h 30 min).
    public static func awayText(_ minutes: Int, language: AppLanguage) -> String {
        if minutes < 120 { return DayRibbon.away(minutes, language: language) }
        let hours = Int((Double(minutes) / 60).rounded(.toNearestOrAwayFromZero))
        return DayRibbon.away(hours * 60, language: language)
    }

    /// Within the hour: the row's "when" and the ring (`.next`) in clay.
    public static func isSoon(_ minutes: Int) -> Bool { minutes <= 60 }

    /// The small line over the title: "지금 · 13:00–14:00" · "Now · 1:00–2:00 PM" · "Nu · 13:00–14:00", or
    /// "다음 · 14:00–15:30" · "Next · …" · "Volgende · …" (a reminder: its time alone). `short` (when the full one
    /// doesn't fit): "지금 · ~14:00" · "Now · until 2:00 PM" · "Nu · tot 14:00"; "다음 · 14:00".
    public static func kicker(mode: Mode, item: Item, language: AppLanguage, short: Bool = false, calendar: Calendar = .paper) -> String {
        let word = mode == .now ? DayRibbon.nowWord(language) : ["다음", "Next", "Volgende"][language.index]
        let start = clockText(item.start, language: language, calendar: calendar)
        guard let end = item.end, end > item.start else { return word + " · " + start }
        let endText = clockText(end, language: language, calendar: calendar)
        if short {
            guard mode == .now else { return word + " · " + start }
            return word + " · " + ["~" + endText, "until " + endText, "tot " + endText][language.index]
        }
        return word + " · " + rangeText(item.start, end, language: language, calendar: calendar)
    }

    /// "13:00–14:00", "1:00–2:00 PM".
    public static func rangeText(_ start: Date, _ end: Date, language: AppLanguage, calendar: Calendar = .paper) -> String {
        let a = calendar.dateComponents([.hour, .minute], from: start), b = calendar.dateComponents([.hour, .minute], from: end)
        return language.timeRange(from: (a.hour!, a.minute!), to: (b.hour!, b.minute!))
    }

    public static func clockText(_ date: Date, language: AppLanguage, calendar: Calendar = .paper) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return language.clock(hour: parts.hour!, minute: parts.minute!)
    }

    /// Time left, said in full: "40분 남음", "1시간 20분 남음", "1시간 남음"; en "40 min left", "1 h 20 min left";
    /// nl "nog 40 min", "nog 1 u 20 min".
    public static func leftText(_ minutes: Int, language: AppLanguage) -> String {
        let h = minutes / 60, m = minutes % 60
        switch language {
        case .ko: return (h == 0 ? "\(m)분" : m == 0 ? "\(h)시간" : "\(h)시간 \(m)분") + " 남음"
        case .en: return (h == 0 ? "\(m) min" : m == 0 ? "\(h) h" : "\(h) h \(m) min") + " left"
        case .nl: return "nog " + (h == 0 ? "\(m) min" : m == 0 ? "\(h) u" : "\(h) u \(m) min")
        }
    }

    /// For VoiceOver, the whole strip in one sentence: "지금 팀 회의, 40분 남음. 다음 14:00 보고서 마무리, 15:30 치과";
    /// nothing on: "다음 14:00 보고서 마무리, 40분 뒤. 그다음 15:30 치과"; nothing left: "오늘 남은 일정이 없어요".
    /// en "Now Team meeting, 40 min left. Next 2:00 PM Finish the report, 3:30 PM Dentist" · "Next 2:00 PM …, in 40 min.
    /// Then 3:30 PM Dentist"; nl "Nu Teamoverleg, nog 40 min. Volgende 14:00 Rapport afmaken, 15:30 Tandarts" ·
    /// "Volgende 14:00 …, over 40 min. Daarna 15:30 Tandarts".
    public static func sentence(_ state: State, language: AppLanguage, calendar: Calendar = .paper) -> String {
        guard let lead = state.lead else { return DayRibbon.nothingAhead(language) }
        let index = language.index
        let rows = state.rows.map { clockText($0.start, language: language, calendar: calendar) + " " + $0.title }.joined(separator: ", ")
        switch state.mode {
        case .now:
            let first = DayRibbon.nowWord(language) + " " + lead.title + ", " + leftText(state.minutes, language: language)
            return rows.isEmpty ? first : first + ". " + ["다음", "Next", "Volgende"][index] + " " + rows
        case .next:
            let first = ["다음", "Next", "Volgende"][index] + " " + clockText(lead.start, language: language, calendar: calendar) + " " + lead.title
                + ", " + awayText(state.minutes, language: language)
            return rows.isEmpty ? first : first + ". " + ["그다음", "Then", "Daarna"][index] + " " + rows
        case .nothing:
            return DayRibbon.nothingAhead(language)
        }
    }

    // MARK: The whole day (하루 일정표)

    /// 50 pt for an hour.
    public static let hourHeight = 50.0

    /// Something in the timetable, in minutes after the day's midnight (logical: 01:00 that night is 1500).
    public struct Span: Equatable, Sendable {
        public var id: String
        public var kind: Kind
        public var start: Int
        public var end: Int
        public var order: Int
        public init(id: String, kind: Kind, start: Int, end: Int, order: Int = 0) {
            self.id = id; self.kind = kind; self.start = start; self.end = end; self.order = order
        }
    }

    /// A reminder takes this long in the timetable (its 20 pt pill is 24 minutes tall).
    public static let reminderLength = 30

    /// The items as spans on the day's minutes (a reminder `reminderLength` long; an end past the 4 a.m. day is cut).
    public static func spans(_ items: [Item], now: Date, calendar: Calendar = .paper) -> [Span] {
        let (dayStart, _) = CalendarDay.window(now, calendar: calendar)
        let midnight = calendar.startOfDay(for: dayStart)
        func minutes(_ date: Date) -> Int { Int((date.timeIntervalSince(midnight) / 60).rounded()) }
        return items.map { item in
            let start = max(TimeBlock.dayStart, min(TimeBlock.dayEnd - 15, minutes(item.start)))
            let end = item.end.map { min(TimeBlock.dayEnd, max(start + 1, minutes($0))) } ?? min(TimeBlock.dayEnd, start + reminderLength)
            return Span(id: item.id, kind: item.kind, start: start, end: end, order: item.order)
        }
    }

    /// Where a span sits: its column and how many columns its group of overlapping spans has (at most 3 drawn).
    public struct Placed: Equatable, Sendable {
        public var id: String
        public var column: Int
        /// The group's columns as drawn: 1…3.
        public var columns: Int
        /// In a fourth column or further: not drawn; counted in the group's "+N".
        public var hidden: Bool
        /// Which group of overlapping spans (0, 1, … from the top).
        public var group: Int
    }

    /// A group's "+N": the hidden spans, placed at the first hidden one's start.
    public struct More: Equatable, Sendable {
        public var ids: [String]
        public var start: Int
        public var group: Int
    }

    public static let maxColumns = 3

    /// Side by side where they overlap. In order of start (then the longer first, then events · to-dos ·
    /// reminders, then the order), each span takes the first column whose last span has ended by its start
    /// (touching isn't overlapping). A group is a run of spans that overlap one another, directly or through
    /// others; all of a group's spans share its column count. Columns 4 and on aren't drawn: the group gets a
    /// "+N" chip instead.
    public static func columns(_ spans: [Span]) -> (placed: [Placed], more: [More]) {
        let sorted = spans.sorted { a, b in
            if a.start != b.start { return a.start < b.start }
            if a.end != b.end { return a.end > b.end }
            if a.kind != b.kind { return a.kind < b.kind }
            return a.order < b.order
        }
        var placed: [Placed] = []
        var more: [More] = []
        var group: [(Span, Int)] = []
        var groups = 0
        var groupEnd = Int.min
        func close() {
            guard !group.isEmpty else { return }
            let used = (group.map(\.1).max() ?? 0) + 1
            let drawn = min(used, maxColumns)
            for (span, column) in group {
                placed.append(Placed(id: span.id, column: column, columns: drawn, hidden: column >= maxColumns, group: groups))
            }
            let hidden = group.filter { $0.1 >= maxColumns }.map(\.0)
            if let first = hidden.first { more.append(More(ids: hidden.map(\.id), start: first.start, group: groups)) }
            group = []
            groups += 1
        }
        var columnEnds: [Int] = []
        for span in sorted {
            if span.start >= groupEnd { close(); columnEnds = [] }
            if let free = columnEnds.firstIndex(where: { $0 <= span.start }) {
                columnEnds[free] = span.end
                group.append((span, free))
            } else {
                columnEnds.append(span.end)
                group.append((span, columnEnds.count - 1))
            }
            groupEnd = group.count == 1 ? span.end : max(groupEnd, span.end)
        }
        close()
        return (placed, more)
    }

    /// A click on the timetable's empty space at `y` points from the top of the first hour: the quarter hour it's
    /// in (rounded down), kept from the first hour to an hour before the last.
    public static func slot(y: Double, startHour: Int, endHour: Int) -> Int {
        let minutes = Double(startHour * 60) + max(0, y) / hourHeight * 60
        let quarter = Int(minutes / 15) * 15
        return min(max(quarter, startHour * 60), endHour * 60 - 60)
    }

    /// Where the timetable opens: the whole hour an hour before now at the top (13:20 → 12:00, so its line and label
    /// show), in points from the first hour, never below 0.
    public static func scrollTop(now: Date, startHour: Int, calendar: Calendar = .paper) -> Double {
        let (dayStart, _) = CalendarDay.window(now, calendar: calendar)
        let minutes = Int(now.timeIntervalSince(calendar.startOfDay(for: dayStart)) / 60)
        let hour = (minutes - 60) / 60
        return max(0, Double(hour - startHour) * hourHeight)
    }

    /// A block dragged `points` down (up when negative) in the timetable: whole quarter hours (the nearest), the
    /// length kept, inside the day's hours. `edge` `.end` moves the end only (at least 15 minutes after the start).
    public static func dragged(start: Int, end: Int, edge: TimeBlock.Edge, points: Double, startHour: Int, endHour: Int) -> (start: Int, end: Int) {
        dragged(start: start, end: end, edge: edge, points: points, bounds: startHour * 60...endHour * 60)
    }

    /// The same inside `bounds` (a to-do moved whole stays inside `stretchBounds`, W3).
    public static func dragged(start: Int, end: Int, edge: TimeBlock.Edge, points: Double, bounds: ClosedRange<Int>) -> (start: Int, end: Int) {
        let range = TimeBlock.dragged(TimeRange(start: start, end: end), edge: edge, by: points / hourHeight * 60, bounds: bounds)
        return (range.start, range.drawnEnd)
    }

    /// A click on the timetable's empty space at `minutes` (logical) and a title typed in its little line: a to-do
    /// with that hour (`minutes`…+60, never past 04:00; a reminder at its start when that's still ahead) and an event
    /// at the same time, an hour long. The to-do comes first unless `kind` says otherwise or (no `kind`) the title has
    /// an event word (Intent.hasEventWord, as the input line reads it).
    public static func newCandidates(title: String, at minutes: Int, kind: Intent.Kind? = nil, now: Date, language: AppLanguage,
                                     calendar: Calendar = .paper) -> [Intent.Candidate] {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let start = max(TimeBlock.dayStart, min(TimeBlock.dayEnd - 15, minutes))
        let end = min(TimeBlock.dayEnd, start + 60)
        let midnight = calendar.startOfDay(for: CalendarDay.window(now, calendar: calendar).start)
        let at = calendar.date(byAdding: .minute, value: start, to: midnight)!
        let todo = Intent.Candidate.todo(QuickParse(title: name, reminderAt: at > now ? at : nil, range: TimeRange(start: start, end: end)))
        let event = Intent.Candidate.event(Intent.EventGuess(title: name, date: CalendarDraft.day(at, calendar: calendar),
                                                             start: start % 1440, end: end % 1440))
        let eventFirst = kind.map { $0 == .event } ?? Intent.hasEventWord(name, language: language)
        return eventFirst ? [event, todo] : [todo, event]
    }

    /// ⌥↑ / ⌥↓: a block 15 minutes earlier or later, inside the day's hours.
    public static func nudged(start: Int, end: Int, by steps: Int, startHour: Int, endHour: Int) -> (start: Int, end: Int) {
        dragged(start: start, end: end, edge: .whole, points: Double(steps) * hourHeight / 4, startHour: startHour, endHour: endHour)
    }

    // MARK: Stretching and following (1.41)

    /// The minutes a block can be stretched within (ribbon-cases.md R6) — and a to-do moved whole (W3): the day's hours;
    /// a to-do's end stops at 03:45 when the day runs to 04:00, since an end at 04:00 isn't kept on a to-do (W2).
    public static func stretchBounds(startHour: Int, endHour: Int, kind: Kind) -> ClosedRange<Int> {
        let high = min(TimeBlock.dayEnd, endHour * 60)
        return max(TimeBlock.dayStart, startHour * 60)...(kind == .task ? min(high, TimeBlock.dayEnd - 15) : high)
    }

    /// The band at a block's top and bottom that stretches it instead of moving it (R1): 6 pt, less on a short block so
    /// its middle (at least 10 pt) still moves it; none on a block under 20 pt.
    public static func stretchBand(height: Double) -> Double {
        height < 20 ? 0 : min(6, ((height - 10) / 2).rounded(.down))
    }

    /// A block's top (`.start`) or bottom (`.end`) dragged `points` down (up when negative): TimeBlock.resized in the
    /// timetable's points (R3–R5).
    public static func resized(start: Int, end: Int, edge: TimeBlock.Edge, points: Double, bounds: ClosedRange<Int>) -> (start: Int, end: Int) {
        let range = TimeBlock.resized(TimeRange(start: start, end: end), edge: edge, by: points / hourHeight * 60, bounds: bounds)
        return (range.start, range.drawnEnd)
    }

    /// ⇧⌥↑ / ⇧⌥↓: the end 15 minutes earlier or later (R7).
    public static func stretched(start: Int, end: Int, by steps: Int, bounds: ClosedRange<Int>) -> (start: Int, end: Int) {
        resized(start: start, end: end, edge: .end, points: Double(steps) * hourHeight / 4, bounds: bounds)
    }

    /// Where a block is drawn while it's dragged (R2): exactly where the pointer took it (no quarter hours), in minutes
    /// with fractions — moved whole inside the day's hours, or an edge kept at least 15 minutes from the other. Where it
    /// lands is `dragged` (moved) or `resized` (stretched).
    public static func following(start: Int, end: Int, edge: TimeBlock.Edge, points: Double, bounds: ClosedRange<Int>) -> (start: Double, end: Double) {
        let delta = points / hourHeight * 60
        let low = Double(max(TimeBlock.dayStart, bounds.lowerBound)), high = Double(min(TimeBlock.dayEnd, bounds.upperBound))
        let from = Double(start), to = Double(end)
        switch edge {
        case .whole:
            let top = min(max(low, from + delta), high - (to - from))
            return (top, top + to - from)
        case .start:
            return (min(max(low, from + delta), max(to - 15, from)), to)
        case .end:
            return (from, max(min(high, to + delta), min(from + 15, to)))
        }
    }
}
