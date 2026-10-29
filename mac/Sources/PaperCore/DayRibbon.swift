import Foundation

/// 하루 띠: today on one line under the 오늘 sheet's header — the timed events as bars, task
/// reminders as rings, a clay line for now, and a sentence of what's on now and what's next.
/// The day runs 08:00–24:00 unless something is earlier (from the 4 a.m. day start) or after
/// midnight (until 4 a.m.). Pure: the note draws what this lays out.
public enum DayRibbon {
    /// A to-do's reminder today (not done).
    public struct Reminder: Equatable, Sendable {
        public var id: String
        public var title: String
        public var at: Date
        public init(id: String, title: String, at: Date) { self.id = id; self.title = title; self.at = at }
    }

    public struct Bar: Equatable, Sendable {
        public var event: CalendarEvent
        /// 0…1 along the track.
        public var from: Double
        public var to: Double
        public var past: Bool
    }

    /// Reminders on their own lane under the bars. Those closer than 12 minutes on the track share
    /// one ring (with their count); `reminder` is the first (a click goes to it).
    public struct Ring: Equatable, Sendable {
        public var reminder: Reminder
        public var at: Double
        public var members: [Reminder]
        public var count: Int { members.count }
    }

    /// The next thing ahead: a timed event's start, a task block's start or a reminder.
    public struct Next: Equatable, Sendable {
        public var title: String
        public var at: Date
        public var minutes: Int
        public var isEvent: Bool
        /// A task block's to-do (1.39).
        public var taskID: String? = nil
    }

    /// 할 일 시간 정하기 (1.39): a to-do's range on today's track, as the core reads it from the task.
    public struct BlockInput: Equatable, Sendable {
        public var id: String
        public var title: String
        /// Minutes after the day's midnight; `end` as drawn (a start alone lasts 30 minutes).
        public var start: Int
        public var end: Int
        public var done: Bool
        public init(id: String, title: String, start: Int, end: Int, done: Bool) {
            self.id = id; self.title = title; self.start = start; self.end = end; self.done = done
        }
    }

    /// A task block on the track: on the task lanes under the events' (0, or 1 when it overlaps a block on 0).
    public struct Block: Equatable, Sendable {
        public var id: String
        public var title: String
        public var start: Int
        public var end: Int
        public var from: Double
        public var to: Double
        public var lane: Int
        public var done: Bool
        /// The end has passed and it isn't done (clay outline).
        public var overdue: Bool
        public var past: Bool
    }

    /// What's going on now: a timed event, or an open task block.
    public struct Current: Equatable, Sendable {
        public var title: String
        public var event: CalendarEvent?
        public var taskID: String?
    }

    public struct Layout: Equatable, Sendable {
        /// Hours after the day's midnight: 8 and 24 by default, 4…28 at the widest.
        public var startHour: Int
        public var endHour: Int
        /// Whole hours for the labels under the track, start and end included.
        public var labels: [Int]
        public var bars: [Bar]
        public var rings: [Ring]
        /// Today's task blocks (1.39), in order of start.
        public var blocks: [Block] = []
        /// Today's all-day events (pills above the track).
        public var allDay: [CalendarEvent]
        /// Where now is along the track, or nil outside it.
        public var now: Double?
        /// The timed event or open task block going on (the latest start; an event first at the same start).
        public var current: Current?
        public var next: Next?

        /// How many task lanes the track has under the events: 0, 1 or 2.
        public var taskLanes: Int { blocks.isEmpty ? 0 : blocks.contains { $0.lane == 1 } ? 2 : 1 }
        public var isEmpty: Bool { bars.isEmpty && rings.isEmpty && allDay.isEmpty && blocks.isEmpty }
    }

    /// Today's task blocks: every to-do (open or done) whose range is on today (TimeBlock.day).
    public static func blocks(_ items: [TodoItem], now: Date, calendar: Calendar = .paper) -> [BlockInput] {
        let today = Archive.dayKey(now, calendar: calendar)
        return items.compactMap { item in
            guard let range = item.timeRange, TimeBlock.day(of: item, now: now, calendar: calendar) == today else { return nil }
            return BlockInput(id: item.id.uuidString, title: item.title, start: range.start, end: range.drawnEnd, done: item.isCompleted)
        }
    }

    /// Today's open reminders for the rings — except a ranged task's reminder at its block's start (the block
    /// stands for it).
    public static func reminders(_ items: [TodoItem], now: Date, calendar: Calendar = .paper) -> [Reminder] {
        items.compactMap { item in
            guard !item.isCompleted, let at = item.reminderAt else { return nil }
            if let start = TimeBlock.interval(of: item, now: now, calendar: calendar)?.start, start == at { return nil }
            return Reminder(id: item.id.uuidString, title: item.title, at: at)
        }
    }

    /// `events`: today's occurrences (CalendarDay.today); `reminders`: today's open reminders; `blocks`: today's
    /// task blocks (`blocks(_:now:)`).
    public static func layout(events: [CalendarEvent], reminders: [Reminder], blocks inputs: [BlockInput] = [], now: Date,
                              calendar: Calendar = .paper) -> Layout {
        let (dayStart, dayEnd) = CalendarDay.window(now, calendar: calendar)
        let midnight = calendar.startOfDay(for: dayStart)
        func hours(_ date: Date) -> Double { date.timeIntervalSince(midnight) / 3600 }
        let timed = events.filter { !$0.allDay }
        let todays = reminders.filter { $0.at >= dayStart && $0.at < dayEnd }
        let tasks = inputs.sorted { ($0.start, $0.end) < ($1.start, $1.end) }

        var start = 8.0, end = 24.0
        let firsts = timed.map { max(hours($0.start), 4) } + todays.map { hours($0.at) } + tasks.map { Double($0.start) / 60 }
        if let earliest = firsts.min(), earliest < start { start = max(4, floor(earliest)) }
        let lasts = timed.map { min(hours($0.end), 28) } + todays.map { hours($0.at) } + tasks.map { Double($0.end) / 60 }
        if let latest = lasts.max(), latest > 24 { end = 28 }
        let span = end - start
        func position(_ value: Double) -> Double { min(1, max(0, (value - start) / span)) }

        let bars = timed.map { event in
            Bar(event: event, from: position(hours(event.start)), to: position(hours(event.end)), past: event.end <= now)
        }
        var rings: [Ring] = []
        for reminder in todays.sorted(by: { $0.at < $1.at }) {
            let place = position(hours(reminder.at))
            if let last = rings.last, place - last.at < 12.0 / 60 / span {
                rings[rings.count - 1].members.append(reminder)
            } else {
                rings.append(Ring(reminder: reminder, at: place, members: [reminder]))
            }
        }
        let nowHours = hours(now)
        func date(_ minutes: Int) -> Date { calendar.date(byAdding: .minute, value: minutes, to: midnight)! }
        // Task lanes under the events: a block goes on the first unless it overlaps a block already there (by start).
        var first: [(Int, Int)] = []
        var blocks: [Block] = []
        for task in tasks {
            let overlaps = first.contains { $0.0 < task.end && task.start < $0.1 }
            if !overlaps { first.append((task.start, task.end)) }
            let ended = date(task.end) <= now
            blocks.append(Block(id: task.id, title: task.title, start: task.start, end: task.end,
                                from: position(Double(task.start) / 60), to: position(Double(task.end) / 60), lane: overlaps ? 1 : 0,
                                done: task.done, overdue: ended && !task.done, past: ended))
        }
        let open = tasks.filter { !$0.done }
        // 지금: the latest-started of the events and open blocks going on (an event first at the same start).
        let going = timed.filter { $0.start <= now && now < $0.end }.map { (Current(title: $0.title, event: $0), $0.start, 0) }
            + open.filter { date($0.start) <= now && now < date($0.end) }.map { (Current(title: $0.title, taskID: $0.id), date($0.start), 1) }
        let current = going.max { ($0.1, -$0.2) < ($1.1, -$1.2) }?.0
        let ahead = timed.filter { $0.start > now }.map { (Next(title: $0.title, at: $0.start, minutes: minutes(from: now, to: $0.start), isEvent: true), 0) }
            + open.filter { date($0.start) > now }.map { (Next(title: $0.title, at: date($0.start), minutes: minutes(from: now, to: date($0.start)), isEvent: false, taskID: $0.id), 1) }
            + todays.filter { $0.at > now }.map { (Next(title: $0.title, at: $0.at, minutes: minutes(from: now, to: $0.at), isEvent: false), 2) }
        let next = ahead.min { ($0.0.at, $0.1) < ($1.0.at, $1.1) }?.0
        return Layout(startHour: Int(start), endHour: Int(end), labels: labels(Int(start), Int(end)),
                      bars: bars, rings: rings, blocks: blocks, allDay: events.filter(\.allDay),
                      now: nowHours >= start && nowHours <= end ? position(nowHours) : nil,
                      current: current, next: next)
    }

    /// The hours under the track: 8 12 16 20 24 for the usual day; a longer or shorter one keeps its
    /// ends and puts the hours between on the clock's sixes (6 · 12 · 18 · 24 · 4, not 6 · 12 · 17 · 23 · 4),
    /// at least 3 hours from either end.
    static func labels(_ start: Int, _ end: Int) -> [Int] {
        if end - start == 16 && start % 4 == 0 { return stride(from: start, through: end, by: 4).map { $0 } }
        let inner = stride(from: (start + 3 + 5) / 6 * 6, through: end - 3, by: 6).map { $0 }
        return [start] + inner + [end]
    }

    /// A label under the track: "8", "12", "24" (28 is "4"); English "8 AM", "12 PM", "12 AM".
    public static func hourLabel(_ hour: Int, language: AppLanguage) -> String {
        let h = hour % 24
        switch language.cycle {
        case .h12:
            let digits = "\(AppLanguage.twelve(h))"
            return language.periodFirst ? language.period(hour: h) + " " + digits : digits + " " + language.period(hour: h)
        case .h24: return hour == 24 ? "24" : "\(h)"
        }
    }

    /// The pill before the next thing: "40분 뒤", "2시간 뒤", "1시간 5분 뒤"; en "in 40 min", "in 2 h",
    /// "in 1 h 5 min"; nl "over 40 min", "over 2 u", "over 1 u 5 min".
    public static func away(_ minutes: Int, language: AppLanguage) -> String {
        guard minutes >= 60 else { return language.minutesAway(max(1, minutes)) }
        let h = minutes / 60, m = minutes % 60
        switch language {
        case .ko: return m == 0 ? "\(h)시간 뒤" : "\(h)시간 \(m)분 뒤"
        case .en: return m == 0 ? "in \(h) h" : "in \(h) h \(m) min"
        case .nl: return m == 0 ? "over \(h) u" : "over \(h) u \(m) min"
        }
    }

    /// "지금" · "Now" · "Nu"
    public static func nowWord(_ language: AppLanguage) -> String { ["지금", "Now", "Nu"][language.index] }

    /// "오늘 남은 일정이 없어요" · "Nothing else today" · "Verder niets vandaag"
    public static func nothingAhead(_ language: AppLanguage) -> String {
        ["오늘 남은 일정이 없어요", "Nothing else today", "Verder niets vandaag"][language.index]
    }

    /// Minutes until, rounded up (an event at 15:30 is "40분 뒤" at 14:50:00 and 14:50:30).
    static func minutes(from now: Date, to date: Date) -> Int {
        max(1, Int((date.timeIntervalSince(now) / 60).rounded(.up)))
    }
}

/// The 오늘 sheet's two groups: 다음 — open tasks with a reminder (or a repeat's time) later
/// today, by time, at most three — and the rest, in the list's order. Overdue reminders stay in
/// the rest. Headers only when both groups have something open.
public enum TodayGroups {
    public struct Split: Equatable, Sendable {
        /// The 다음 rows, by time.
        public var next: [UUID]
        /// Everything else, in the list's order.
        public var rest: [UUID]
        /// When the rows are due, for the row's meta (a repeat's time when it has no reminder).
        public var times: [UUID: Date]
        /// Both groups shown with their small headers (다음 · 오늘 할 일).
        public var showsHeaders: Bool
    }

    public static let limit = 3

    /// `first` (1.38 오늘 꼭 하나): today's one thing, at the top of 다음 when it's open (besides the three by time).
    public static func split(_ items: [TodoItem], series: [Series], now: Date, first: UUID? = nil, calendar: Calendar = .paper) -> Split {
        let (_, dayEnd) = CalendarDay.window(now, calendar: calendar)
        let today = Archive.logicalDayStart(now, calendar: calendar)
        var times: [UUID: Date] = [:]
        for item in items where !item.isCompleted {
            // 1.39: a range today that hasn't ended goes by its start.
            if let block = TimeBlock.interval(of: item, now: now, calendar: calendar), block.end > now, block.start < dayEnd,
               block.start >= Archive.logicalDayStart(now, calendar: calendar) {
                times[item.id] = block.start
            } else if let at = item.reminderAt, at > now, at < dayEnd {
                times[item.id] = at
            } else if item.reminderAt == nil, let id = item.seriesID, let entry = series.first(where: { $0.id == id }),
                      let remindAt = entry.remindAt, Repeat.occurs(entry.rule, on: today, calendar: calendar),
                      let at = Repeat.alert(on: today, at: remindAt, calendar: calendar), at > now, at < dayEnd {
                times[item.id] = at
            }
        }
        let order = Dictionary(uniqueKeysWithValues: items.enumerated().map { ($1.id, $0) })
        let pick = first.flatMap { id in items.first { $0.id == id && !$0.isCompleted }?.id }
        let next = (pick.map { [$0] } ?? []) + times.keys.filter { $0 != pick }.sorted { (times[$0]!, order[$0]!) < (times[$1]!, order[$1]!) }.prefix(limit)
        let chosen = Set(next)
        let rest = items.map(\.id).filter { !chosen.contains($0) }
        let openRest = items.filter { !$0.isCompleted && !chosen.contains($0.id) }.count
        return Split(next: Array(next), rest: rest, times: times.filter { chosen.contains($0.key) },
                     showsHeaders: !next.isEmpty && openRest > 0)
    }
}
