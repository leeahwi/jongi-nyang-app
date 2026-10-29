import Foundation

/// 앞으로: everything that isn't for today, by date — this week's days from tomorrow, next week's
/// days, later deadlines under their month, then 언젠가 (saved for later, no date). Each day holds
/// its events (from tomorrow to the end of next week) and the tasks due that day. Weeks start on
/// Sunday (Korean, English) or Monday (Dutch); days turn at 4 a.m. Pure: the note draws what this
/// lays out. Same rules and cases as the Windows app (ahead.ts, ahead-cases.md).
public enum Ahead {
    public enum Kind: String, CaseIterable, Sendable {
        case thisWeek, nextWeek, later, someday

        /// "이번 주" · "This week" · "Deze week", "다음 주" · "Next week" · "Volgende week",
        /// "그 뒤" · "Later on" · "Daarna", "언젠가" · "Someday" · "Ooit".
        public func title(_ language: AppLanguage) -> String {
            let titles: [[String]] = [
                ["이번 주", "This week", "Deze week"],
                ["다음 주", "Next week", "Volgende week"],
                ["그 뒤", "Later on", "Daarna"],
                ["언젠가", "Someday", "Ooit"],
            ]
            return titles[Self.allCases.firstIndex(of: self)!][language.index]
        }
    }

    /// One date with something on it.
    public struct Day: Equatable, Sendable {
        /// "yyyy-MM-dd"
        public var date: String
        /// 0 = Sunday … 6 = Saturday
        public var weekday: Int
        public var day: Int
        /// "내일" · "Tomorrow" · "Morgen" for tomorrow, else nil.
        public var relative: String?
        /// All-day first (by title), then by start (then title).
        public var events: [CalendarEvent]
        /// Tasks due that day, in the list's order.
        public var tasks: [UUID]

        public init(date: String, weekday: Int, day: Int, relative: String?, events: [CalendarEvent], tasks: [UUID]) {
            self.date = date; self.weekday = weekday; self.day = day; self.relative = relative; self.events = events; self.tasks = tasks
        }
    }

    /// 그 뒤: one month's deadlines.
    public struct Month: Equatable, Sendable {
        public var year: Int
        public var month: Int
        /// "11월" · "November" · "november"; with the year when it isn't this year: "2027년 1월" · "January 2027" · "januari 2027".
        public var title: String
        /// By date, then the list's order.
        public var tasks: [UUID]

        public init(year: Int, month: Int, title: String, tasks: [UUID]) {
            self.year = year; self.month = month; self.title = title; self.tasks = tasks
        }
    }

    public struct Section: Equatable, Sendable {
        public var kind: Kind
        public var title: String
        /// 이번 주 · 다음 주
        public var days: [Day]
        /// 그 뒤
        public var months: [Month]
        /// 언젠가, in the list's order.
        public var tasks: [UUID]
        /// Open tasks in the section (events don't count).
        public var count: Int

        public init(kind: Kind, title: String, days: [Day], months: [Month], tasks: [UUID], count: Int) {
            self.kind = kind; self.title = title; self.days = days; self.months = months; self.tasks = tasks; self.count = count
        }
    }

    /// The tasks that belong here: open ones that aren't on today's sheet.
    public static func isAhead(_ item: TodoItem, now: Date, calendar: Calendar = .paper) -> Bool {
        !item.isCompleted && Shelf.page(of: item, now: now, calendar: calendar) != .today
    }

    /// `events`: occurrences around tomorrow … the end of next week (more is fine; the rest is left out).
    public static func sections(items: [TodoItem], events: [CalendarEvent], now: Date, calendar: Calendar = .paper,
                                language: AppLanguage = .ko) -> [Section] {
        let today = Archive.logicalDayStart(now, calendar: calendar)
        let todayKey = Deadline.key(today, calendar: calendar)
        let tomorrowKey = key(todayKey, plus: 1, calendar: calendar)
        let (_, thisWeekEnd) = week(of: now, calendar: calendar, language: language)
        let nextWeekEnd = key(thisWeekEnd, plus: 7, calendar: calendar)
        let thisYear = calendar.component(.year, from: today)

        // Tasks, by where they go.
        var dayTasks: [String: [UUID]] = [:]
        var laterTasks: [(due: String, order: Int, id: UUID)] = []
        var someday: [UUID] = []
        for (order, item) in items.enumerated() where isAhead(item, now: now, calendar: calendar) {
            if let due = item.dueDate {
                if due <= nextWeekEnd { dayTasks[due, default: []].append(item.id) } else { laterTasks.append((due, order, item.id)) }
            } else {
                someday.append(item.id)
            }
        }

        // Events, on each day of tomorrow … the end of next week they belong to.
        var dayEvents: [String: [CalendarEvent]] = [:]
        for event in events {
            for day in eventDays(event, calendar: calendar) where day >= tomorrowKey && day <= nextWeekEnd {
                dayEvents[day, default: []].append(event)
            }
        }

        func makeDay(_ date: String) -> Day {
            let parts = parts(date, calendar: calendar)
            let ordered = (dayEvents[date] ?? []).sorted { a, b in
                if a.allDay != b.allDay { return a.allDay }
                if !a.allDay && a.start != b.start { return a.start < b.start }
                return a.title < b.title
            }
            return Day(date: date, weekday: parts.weekday, day: parts.day,
                       relative: date == tomorrowKey ? language.dayWord(1) : nil,
                       events: ordered, tasks: dayTasks[date] ?? [])
        }
        let dates = Set(dayTasks.keys).union(dayEvents.keys).sorted()
        let thisWeek = dates.filter { $0 <= thisWeekEnd }.map(makeDay)
        let nextWeek = dates.filter { $0 > thisWeekEnd }.map(makeDay)

        var months: [Month] = []
        for task in laterTasks.sorted(by: { ($0.due, $0.order) < ($1.due, $1.order) }) {
            let p = parts(task.due, calendar: calendar)
            if let last = months.last, last.year == p.year, last.month == p.month {
                months[months.count - 1].tasks.append(task.id)
            } else {
                let title = p.year == thisYear ? language.monthName(p.month) : language.monthTitle(year: p.year, month: p.month)
                months.append(Month(year: p.year, month: p.month, title: title, tasks: [task.id]))
            }
        }

        var sections: [Section] = []
        if !thisWeek.isEmpty {
            sections.append(Section(kind: .thisWeek, title: Kind.thisWeek.title(language), days: thisWeek, months: [], tasks: [],
                                    count: thisWeek.map(\.tasks.count).reduce(0, +)))
        }
        if !nextWeek.isEmpty {
            sections.append(Section(kind: .nextWeek, title: Kind.nextWeek.title(language), days: nextWeek, months: [], tasks: [],
                                    count: nextWeek.map(\.tasks.count).reduce(0, +)))
        }
        if !months.isEmpty {
            sections.append(Section(kind: .later, title: Kind.later.title(language), days: [], months: months, tasks: [],
                                    count: laterTasks.count))
        }
        if !someday.isEmpty {
            sections.append(Section(kind: .someday, title: Kind.someday.title(language), days: [], months: [], tasks: someday,
                                    count: someday.count))
        }
        return sections
    }

    /// The tab's badge: open tasks in every section.
    public static func count(_ sections: [Section]) -> Int { sections.map(\.count).reduce(0, +) }

    /// Events listed (one that spans several days counts once).
    public static func eventCount(_ sections: [Section]) -> Int {
        Set(sections.flatMap(\.days).flatMap(\.events).map(\.key)).count
    }

    // MARK: Words

    /// A day's label: "금 9" · "Fri 9" · "vr 9".
    public static func dayLabel(_ day: Day, language: AppLanguage) -> String {
        "\(language.weekdayShort(day.weekday)) \(day.day)"
    }

    /// An event's time in a day: "종일" · "All day" · "Hele dag", or its start "10:00" · "10:00 AM".
    public static func eventTime(_ event: CalendarEvent, calendar: Calendar = .paper, language: AppLanguage) -> String {
        if event.allDay { return CalendarDay.allDayText(language) }
        let p = calendar.dateComponents([.hour, .minute], from: event.start)
        return language.clock(hour: p.hour!, minute: p.minute!)
    }

    /// A 그 뒤 task's date at the right: "11월 3일 (화)" · "Tue, Nov 3" · "di 3 nov" (with the year when it isn't this year).
    public static func dateText(_ dueDate: String, now: Date, calendar: Calendar = .paper, language: AppLanguage) -> String {
        guard let date = Deadline.date(from: dueDate, calendar: calendar) else { return dueDate }
        let thisYear = calendar.component(.year, from: Archive.logicalDayStart(now, calendar: calendar))
        return language.shortDate(date, calendar: calendar, withYear: calendar.component(.year, from: date) != thisYear)
    }

    /// The header's eyebrow: "이번 주 · 10월 4일 – 10일" · "This week · Oct 4 – 10" · "Deze week · 5 – 11 okt".
    public static func weekTitle(now: Date, calendar: Calendar = .paper, language: AppLanguage) -> String {
        let (first, last) = week(of: now, calendar: calendar, language: language)
        let a = parts(first, calendar: calendar), b = parts(last, calendar: calendar)
        return Kind.thisWeek.title(language) + " · "
            + language.weekTitle(first: (a.year, a.month, a.day), last: (b.year, b.month, b.day))
    }

    /// Under the title: "할 일 6 · 일정 3" · "6 to-dos · 3 events" · "6 taken · 3 afspraken"; a part
    /// that is zero is left out ("" when both are).
    public static func summary(todos: Int, events: Int, language: AppLanguage) -> String {
        var parts: [String] = []
        switch language {
        case .ko:
            if todos > 0 { parts.append("할 일 \(todos)") }
            if events > 0 { parts.append("일정 \(events)") }
        case .en:
            if todos > 0 { parts.append(AppLanguage.plural(todos, "to-do", "to-dos")) }
            if events > 0 { parts.append(AppLanguage.plural(events, "event", "events")) }
        case .nl:
            if todos > 0 { parts.append(AppLanguage.plural(todos, "taak", "taken")) }
            if events > 0 { parts.append(AppLanguage.plural(events, "afspraak", "afspraken")) }
        }
        return parts.joined(separator: " · ")
    }

    /// Where a dragged task went.
    public enum Destination: Equatable, Sendable {
        case day(String), someday, today
    }

    /// The toast after a drop: "10월 9일로 옮겼어요" · "Moved to Oct 9" · "Verplaatst naar 9 okt"
    /// (with the year when it isn't this year), "언젠가로 옮겼어요" · "Moved to Someday" · "Verplaatst naar Ooit",
    /// "오늘로 옮겼어요" · "Moved to Today" · "Verplaatst naar Vandaag".
    public static func movedText(_ destination: Destination, now: Date, calendar: Calendar = .paper, language: AppLanguage) -> String {
        let place: String
        switch destination {
        case .day(let key):
            let p = parts(key, calendar: calendar)
            let thisYear = calendar.component(.year, from: Archive.logicalDayStart(now, calendar: calendar))
            place = language.dayMonth(month: p.month, day: p.day, year: p.year == thisYear ? nil : p.year)
        case .someday: place = Kind.someday.title(language)
        case .today: place = language.dayWord(0)!
        }
        switch language {
        case .ko: return "\(place)로 옮겼어요"
        case .en: return "Moved to \(place)"
        case .nl: return "Verplaatst naar \(place)"
        }
    }

    /// The empty sheet: "앞으로 할 일이 없어요. 아래에 ‘금요일까지 보고서’처럼 적어 보세요."
    public static func emptyText(_ language: AppLanguage) -> String {
        [
            "앞으로 할 일이 없어요. 아래에 ‘금요일까지 보고서’처럼 적어 보세요.",
            "Nothing ahead. Try typing ‘report by Friday’ below.",
            "Niets vooruit. Typ hieronder bijv. ‘verslag voor vrijdag’.",
        ][language.index]
    }

    // MARK: Dates

    /// The first and last day ("yyyy-MM-dd") of the week holding today (by the 4 a.m. rule).
    public static func week(of now: Date, calendar: Calendar = .paper, language: AppLanguage) -> (first: String, last: String) {
        Deadline.week(of: now, calendar: calendar, language: language)
    }

    /// The days an event is on: a timed one on the (4 a.m.) day it starts; an all-day one on every date it covers.
    static func eventDays(_ event: CalendarEvent, calendar: Calendar) -> [String] {
        guard event.allDay else { return [Archive.dayKey(event.start, calendar: calendar)] }
        var days: [String] = []
        var day = calendar.startOfDay(for: event.start)
        while day < event.end && days.count < 400 {
            days.append(Deadline.key(day, calendar: calendar))
            day = calendar.date(byAdding: .day, value: 1, to: day)!
        }
        return days.isEmpty ? [Deadline.key(event.start, calendar: calendar)] : days
    }

    static func key(_ key: String, plus days: Int, calendar: Calendar) -> String {
        guard let date = Deadline.date(from: key, calendar: calendar) else { return key }
        return Deadline.key(calendar.date(byAdding: .day, value: days, to: date)!, calendar: calendar)
    }

    static func parts(_ key: String, calendar: Calendar) -> (year: Int, month: Int, day: Int, weekday: Int) {
        let date = Deadline.date(from: key, calendar: calendar) ?? Date(timeIntervalSince1970: 0)
        let p = calendar.dateComponents([.year, .month, .day, .weekday], from: date)
        return (p.year!, p.month!, p.day!, p.weekday! - 1)
    }
}
