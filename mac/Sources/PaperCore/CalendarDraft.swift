import Foundation

/// An event being written: put on the calendar from a to-do, made new, or changed. Kept in plain
/// parts — a day and minutes — so the sheet edits them directly. Same rules and test cases as the
/// Windows app (calendar.ts).
public struct CalendarDraft: Equatable, Sendable {
    public var title: String
    /// The first day, "yyyy-MM-dd" (local).
    public var date: String
    public var allDay: Bool
    /// How many days an all-day event spans (at least 1).
    public var days: Int
    /// Start and end of a timed event, minutes after midnight. An end at or before the start
    /// ends on the next day (equal is an error).
    public var startMinutes: Int
    public var endMinutes: Int
    public var repeatRule: LocalEvent.Repeat
    public var color: LocalEvent.Color
    public var location: String
    /// Put on the calendar from this to-do.
    public var taskId: String?

    public init(title: String, date: String, allDay: Bool = false, days: Int = 1, startMinutes: Int = 0, endMinutes: Int = 60,
                repeatRule: LocalEvent.Repeat = .none, color: LocalEvent.Color = .blue, location: String = "", taskId: String? = nil) {
        self.title = title; self.date = date; self.allDay = allDay; self.days = days
        self.startMinutes = startMinutes; self.endMinutes = endMinutes
        self.repeatRule = repeatRule; self.color = color; self.location = location; self.taskId = taskId
    }

    public var endsNextDay: Bool { !allDay && endMinutes <= startMinutes }

    // MARK: Starting points

    /// The next half hour, at least ten minutes away.
    public static func nextSlot(_ now: Date, calendar: Calendar = .paper) -> (date: String, minutes: Int) {
        let minute = calendar.dateInterval(of: .minute, for: now)!.start
        let parts = calendar.dateComponents([.minute, .second], from: now)
        var slot = minute
        let over = parts.minute! % 30
        if over != 0 || parts.second! != 0 || now > minute {
            slot = calendar.date(byAdding: .minute, value: 30 - over, to: minute)!
        }
        if slot < now.addingTimeInterval(600) { slot = calendar.date(byAdding: .minute, value: 30, to: slot)! }
        return (day(slot, calendar: calendar), minutes(slot, calendar: calendar))
    }

    /// 캘린더에 넣기: the to-do's alert time, else its deadline as an all-day event, else the next slot.
    public static func forTask(title: String, reminderAt: Date?, dueDate: String?, now: Date, color: LocalEvent.Color = .blue,
                               taskId: String?, calendar: Calendar = .paper) -> CalendarDraft {
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        if let reminderAt {
            let start = minutes(reminderAt, calendar: calendar)
            return CalendarDraft(title: name, date: day(reminderAt, calendar: calendar), startMinutes: start,
                                 endMinutes: (start + 60) % 1440, color: color, taskId: taskId)
        }
        if let dueDate {
            return CalendarDraft(title: name, date: dueDate, allDay: true, color: color, taskId: taskId)
        }
        let slot = nextSlot(now, calendar: calendar)
        return CalendarDraft(title: name, date: slot.date, startMinutes: slot.minutes, endMinutes: (slot.minutes + 60) % 1440,
                             color: color, taskId: taskId)
    }

    /// 새 일정.
    public static func new(now: Date, color: LocalEvent.Color = .blue, calendar: Calendar = .paper) -> CalendarDraft {
        forTask(title: "", reminderAt: nil, dueDate: nil, now: now, color: color, taskId: nil, calendar: calendar)
    }

    /// 일정 고치기: the whole event (a repeating one from its first day).
    public static func forEvent(_ event: LocalEvent) -> CalendarDraft {
        CalendarDraft(title: event.title, date: event.date, allDay: event.allDay, days: max(1, event.days),
                      startMinutes: event.start, endMinutes: event.end, repeatRule: event.repeatRule, color: event.color,
                      location: event.location ?? "", taskId: event.taskId)
    }

    // MARK: Checking and reading

    /// What's wrong, in the sheet's words, or nil.
    public var problem: String? { problem(.ko) }

    /// en "Give it a title" · "It ends when it starts"; nl "Geef het een titel" · "Het eindigt wanneer het begint".
    public func problem(_ language: AppLanguage) -> String? {
        let index = language.index
        if title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return ["제목을 적어 주세요", "Give it a title", "Geef het een titel"][index] }
        if !allDay && startMinutes == endMinutes { return ["끝나는 시간이 시작과 같아요", "It ends when it starts", "Het eindigt wanneer het begint"][index] }
        return nil
    }

    public func span(calendar: Calendar = .paper) -> (start: Date, end: Date) {
        let first = Self.localDay(date, calendar: calendar) ?? calendar.startOfDay(for: Date())
        if allDay { return (first, calendar.date(byAdding: .day, value: max(1, days), to: first)!) }
        let start = calendar.date(byAdding: .minute, value: startMinutes, to: first)!
        let endDay = endsNextDay ? calendar.date(byAdding: .day, value: 1, to: first)! : first
        return (start, calendar.date(byAdding: .minute, value: endMinutes, to: endDay)!)
    }

    /// "1시간", "1시간 30분", "45분" (+ " · 다음 날"); all-day "하루" or "N일".
    public var lengthText: String { lengthText(.ko) }

    /// en "1 hour", "2 hours 30 min", "45 min" (+ " · next day"), "1 day", "3 days";
    /// nl "1 uur", "2 uur 30 min", "45 min" (+ " · volgende dag"), "1 dag", "3 dagen".
    public func lengthText(_ language: AppLanguage) -> String {
        if allDay { return language == .ko && days <= 1 ? "하루" : language.days(max(1, days)) }
        let length = endsNextDay ? endMinutes + 1440 - startMinutes : endMinutes - startMinutes
        let hours = length / 60, rest = length % 60
        let hourText: String = switch language {
        case .ko: "\(hours)시간"
        case .en: AppLanguage.plural(hours, "hour", "hours")
        case .nl: "\(hours) uur"
        }
        let minuteText = language == .ko ? "\(rest)분" : "\(rest) min"
        let text = hours == 0 ? minuteText : rest == 0 ? hourText : "\(hourText) \(minuteText)"
        guard endsNextDay else { return text }
        return text + " · " + ["다음 날", "next day", "volgende dag"][language.index]
    }

    /// The event this draft makes, or changes (keeping when it was made, its skipped days and its to-do).
    public func event(id: String, now: Date, existing: LocalEvent? = nil) -> LocalEvent {
        let place = location.trimmingCharacters(in: .whitespacesAndNewlines)
        return LocalEvent(id: id, title: title.trimmingCharacters(in: .whitespacesAndNewlines), date: date, allDay: allDay,
                          days: allDay ? max(1, days) : 1, start: startMinutes, end: endMinutes,
                          repeatRule: repeatRule, skip: existing?.skip ?? [], color: color, location: place.isEmpty ? nil : place,
                          taskId: existing?.taskId ?? taskId, createdAt: existing?.createdAt ?? now, updatedAt: now)
    }

    // MARK: Helpers

    public static func day(_ date: Date, calendar: Calendar = .paper) -> String {
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", parts.year!, parts.month!, parts.day!)
    }

    public static func minutes(_ date: Date, calendar: Calendar = .paper) -> Int {
        let parts = calendar.dateComponents([.hour, .minute], from: date)
        return parts.hour! * 60 + parts.minute!
    }

    public static func localDay(_ text: String, calendar: Calendar = .paper) -> Date? {
        let parts = text.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }
}
