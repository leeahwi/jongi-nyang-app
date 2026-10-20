import Foundation

/// One dated event as the note shows it (an occurrence of a LocalEvent). All-day events run from
/// the local midnight of their first day to the midnight after their last (exclusive).
public struct CalendarEvent: Equatable, Sendable {
    /// "local/<event id>@<day>"
    public var key: String
    public var calendarId: String
    public var title: String
    public var allDay: Bool
    public var start: Date
    public var end: Date
    public var location: String?
    public var link: String?
    /// "#RRGGBB"
    public var color: String
    /// The LocalEvent it comes from.
    public var eventId: String
    public var canEdit: Bool
    /// One day of a repeating event.
    public var recurring: Bool
    /// Put on the calendar from this to-do.
    public var taskId: String?

    public init(key: String, calendarId: String, title: String, allDay: Bool, start: Date, end: Date,
                location: String? = nil, link: String? = nil, color: String,
                eventId: String? = nil, canEdit: Bool = true, recurring: Bool = false, taskId: String? = nil) {
        self.key = key; self.calendarId = calendarId; self.title = title; self.allDay = allDay
        self.start = start; self.end = end; self.location = location; self.link = link; self.color = color
        self.eventId = eventId ?? key
        self.canEdit = canEdit; self.recurring = recurring; self.taskId = taskId
    }
}

/// 오늘 일정: which events belong to today's sheet, and how each reads in the strip. The day turns
/// at 4 a.m. like the rest of the app. Same rules and test cases as the Windows app (calendar.ts).
public enum CalendarDay {
    public enum State: String, Sendable { case upcoming, soon, now, past, allDay }

    // MARK: Today

    public static func today(_ events: [CalendarEvent], now: Date, calendar: Calendar = .paper) -> [CalendarEvent] {
        let (dayStart, dayEnd) = window(now, calendar: calendar)
        let midnight = calendar.startOfDay(for: dayStart)
        return events
            .filter { event in
                if event.allDay { return event.start <= midnight && midnight < event.end }
                if event.start == event.end { return event.start >= dayStart && event.start < dayEnd }
                return event.start < dayEnd && event.end > dayStart
            }
            .sorted { a, b in
                if a.allDay != b.allDay { return a.allDay }
                if a.allDay { return a.title < b.title }
                if a.start != b.start { return a.start < b.start }
                return a.title < b.title
            }
    }

    /// "종일", "All day", "Hele dag"
    public static func allDayText(_ language: AppLanguage = .ko) -> String {
        ["종일", "All day", "Hele dag"][language.index]
    }

    /// The time column: "종일", "10:00", "~05:00" (began before today), "23:00~" (runs past today).
    /// English on a 12-hour clock: "All day", "10:00 AM", "~5:00 AM", "11:00 PM~"; Dutch "Hele dag", "10:00".
    public static func timeLabel(_ event: CalendarEvent, now: Date, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String {
        if event.allDay { return allDayText(language) }
        let (dayStart, dayEnd) = window(now, calendar: calendar)
        if event.start < dayStart { return "~" + clock(event.end, calendar: calendar, language: language) }
        if event.end > dayEnd { return clock(event.start, calendar: calendar, language: language) + "~" }
        return clock(event.start, calendar: calendar, language: language)
    }

    /// The right-hand note: "40분 뒤" within the hour, "진행 중", "끝남" — en "in 40 min", "Now", "Over"; nl "over 40 min", "Nu", "Voorbij".
    public static func status(_ event: CalendarEvent, now: Date, language: AppLanguage = .ko) -> (text: String, state: State) {
        if event.allDay { return ("", .allDay) }
        if now < event.start {
            let minutes = Int((event.start.timeIntervalSince(now) / 60).rounded(.up))
            return minutes <= 60 ? (language.minutesAway(minutes), .soon) : ("", .upcoming)
        }
        let index = language.index
        if now < event.end { return (["진행 중", "Now", "Nu"][index], .now) }
        return (["끝남", "Over", "Voorbij"][index], .past)
    }

    /// The next of today's timed events that hasn't started yet.
    public static func nextEvent(_ events: [CalendarEvent], now: Date, calendar: Calendar = .paper) -> CalendarEvent? {
        today(events, now: now, calendar: calendar).filter { !$0.allDay && $0.start > now }.min { $0.start < $1.start }
    }

    // MARK: 종이냥 한마디

    /// What the cat knows about today's calendar: the next timed event and the minutes to it
    /// (rounded up), the one going on (earliest start), one that ended in the last 20 minutes
    /// (latest end), and how many timed events are still to come. All-day events don't count.
    public struct Chatter: Equatable, Sendable {
        public var next: String?
        public var nextIn: Int
        public var now: String?
        public var ended: String?
        public var left: Int
    }

    public static func chatter(_ events: [CalendarEvent], now: Date, calendar: Calendar = .paper) -> Chatter {
        let timed = today(events, now: now, calendar: calendar).filter { !$0.allDay }
        let coming = timed.filter { $0.start > now }.sorted { $0.start < $1.start }
        let next = coming.first
        let going = timed.filter { $0.start <= now && now < $0.end }.min { $0.start < $1.start }
        let ended = timed.filter { $0.end <= now && $0.end >= now.addingTimeInterval(-20 * 60) && $0.start < $0.end }.max { $0.end < $1.end }
        return Chatter(next: next?.title, nextIn: next.map { Int(($0.start.timeIntervalSince(now) / 60).rounded(.up)) } ?? 0,
                       now: going?.title, ended: ended?.title, left: coming.count)
    }

    // MARK: Alerts

    /// What this device records once it has alerted an event: the event and its start time.
    public static func alertKey(_ event: CalendarEvent) -> String {
        "\(event.key)@\(Int(event.start.timeIntervalSince1970))"
    }

    public static func dueAlerts(_ events: [CalendarEvent], now: Date, leadMinutes: Int, shownHere: Set<String>) -> [CalendarEvent] {
        guard leadMinutes > 0 else { return [] }
        let lead = TimeInterval(leadMinutes * 60)
        return events
            .filter { !$0.allDay && $0.start.addingTimeInterval(-lead) <= now && now < $0.start && !shownHere.contains(alertKey($0)) }
            .sorted { $0.start < $1.start }
    }

    /// When the next alert is due (already past when one is waiting), or nil.
    public static func nextAlertTime(_ events: [CalendarEvent], now: Date, leadMinutes: Int, shownHere: Set<String>) -> Date? {
        guard leadMinutes > 0 else { return nil }
        let lead = TimeInterval(leadMinutes * 60)
        return events
            .filter { !$0.allDay && now < $0.start && !shownHere.contains(alertKey($0)) }
            .map { $0.start.addingTimeInterval(-lead) }
            .min()
    }

    // MARK: Helpers

    /// Today's sheet: 04:00 to 04:00.
    public static func window(_ now: Date, calendar: Calendar = .paper) -> (start: Date, end: Date) {
        let start = Archive.logicalDayStart(now, calendar: calendar)
        return (start, calendar.date(byAdding: .day, value: 1, to: start)!)
    }

    private static func clock(_ date: Date, calendar: Calendar, language: AppLanguage) -> String {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return language.clock(hour: parts.hour!, minute: parts.minute!)
    }
}
