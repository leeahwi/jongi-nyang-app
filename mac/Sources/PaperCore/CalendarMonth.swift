import Foundation

/// 달력: the month and week pages of the calendar window. Days are local calendar days
/// ("yyyy-MM-dd", midnight to midnight — not the note's 4 a.m. day) and weeks start on Sunday
/// (Monday in Dutch: AppLanguage.weekStartsMonday).
/// Same rules and test cases as the Windows app (calendar.ts).
public enum CalendarMonth {
    /// A to-do on a day: its alert time, or its deadline.
    public struct DayTask: Equatable, Sendable {
        /// `range` (1.39): a to-do's time on that day, drawn as an outlined block; `time` is its range.
        public enum Kind: String, Sendable { case reminder, deadline, range }
        public var title: String
        public var kind: Kind
        /// "HH:mm" for an alert.
        public var time: String?
        public var taskId: UUID
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
                if a.allDay { return a.title < b.title }
                if a.start != b.start { return a.start < b.start }
                return a.title < b.title
            }
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
        var reminders: [(Date, DayTask)] = []
        var deadlines: [DayTask] = []
        for task in tasks where !task.isCompleted {
            if ranges, let range = task.timeRange, let start = TimeBlock.interval(of: task, now: now, calendar: calendar)?.start,
               TimeBlock.day(of: task, now: now, calendar: calendar) == day {
                reminders.append((start, DayTask(title: task.title, kind: .range, time: range.text(language), taskId: task.id)))
            } else if task.dueDate == day {
                deadlines.append(DayTask(title: task.title, kind: .deadline, time: nil, taskId: task.id))
            } else if let at = task.reminderAt, CalendarDraft.day(at, calendar: calendar) == day {
                reminders.append((at, DayTask(title: task.title, kind: .reminder, time: clock(at, calendar: calendar, language: language), taskId: task.id)))
            }
        }
        return reminders.sorted { $0.0 < $1.0 }.map(\.1) + deadlines.sorted { $0.title < $1.title }
    }

    /// What a month cell shows: the day's events, then its deadlines; the first `limit` and how many more.
    public static func cellItems(_ day: String, events: [CalendarEvent], tasks: [TodoItem], limit: Int = 3,
                                 calendar: Calendar = .paper) -> (items: [CellItem], more: Int) {
        let all = eventsOn(day, events, calendar: calendar).map(CellItem.event)
            + dayTasks(day, tasks, ranges: false, calendar: calendar).filter { $0.kind == .deadline }.map(CellItem.task)
        return (Array(all.prefix(limit)), max(0, all.count - limit))
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

    /// The Sunday (Dutch: Monday) on or before `date`.
    private static func weekStart(of date: Date, calendar: Calendar, language: AppLanguage) -> Date {
        let start = calendar.startOfDay(for: date)
        let weekday = calendar.component(.weekday, from: start) - 1 // 0 = Sunday
        let back = language.weekStartsMonday ? (weekday + 6) % 7 : weekday
        return calendar.date(byAdding: .day, value: -back, to: start)!
    }

    private static func days(from start: Date, count: Int, calendar: Calendar) -> [String] {
        (0..<count).map { CalendarDraft.day(calendar.date(byAdding: .day, value: $0, to: start)!, calendar: calendar) }
    }

    private static func clock(_ date: Date, calendar: Calendar, language: AppLanguage) -> String {
        let p = calendar.dateComponents([.hour, .minute], from: date)
        return language.clock(hour: p.hour!, minute: p.minute!)
    }
}
