import Foundation

// MARK: - 어제부터

/// How long an open task has sat on today's sheet: `todaySince` is the logical day (4 a.m. rule) it
/// was first seen there without a deadline; the row then reads 어제부터 · 3일째.
public enum Carry {
    /// Whether the mark is kept for a task: open, on today's sheet, no deadline (a deadline has its
    /// own D+1), and not a repeat's copy (it comes back every day by design).
    public static func tracks(_ item: TodoItem, now: Date, calendar: Calendar = .paper) -> Bool {
        !item.isCompleted && item.dueDate == nil && item.seriesID == nil && Shelf.page(of: item, now: now, calendar: calendar) == .today
    }

    /// The stamps to change: a tracked task without a valid one (missing, not a `yyyy-MM-dd`, or later
    /// than today) gets today; a task that isn't tracked (finished, moved off today, given a deadline,
    /// linked to a repeat) loses its stamp. `.some(nil)` clears.
    public static func stamps(_ items: [TodoItem], now: Date, calendar: Calendar = .paper) -> [UUID: String?] {
        let today = Archive.dayKey(now, calendar: calendar)
        var changes: [UUID: String?] = [:]
        for item in items {
            if tracks(item, now: now, calendar: calendar) {
                if !valid(item.todaySince, today: today) { changes[item.id] = .some(today) }
            } else if item.todaySince != nil {
                changes[item.id] = .some(nil)
            }
        }
        return changes
    }

    static func valid(_ since: String?, today: String) -> Bool {
        guard let since, since.count == 10, since <= today else { return false }
        return since.range(of: #"^\d{4}-\d{2}-\d{2}$"#, options: .regularExpression) != nil
    }

    /// Whole logical days since the stamp (0 for today, a later day, or none).
    public static func days(since: String?, now: Date, calendar: Calendar = .paper) -> Int {
        guard let since, let first = Deadline.date(from: since, calendar: calendar),
              let today = Deadline.date(from: Archive.dayKey(now, calendar: calendar), calendar: calendar) else { return 0 }
        return max(0, calendar.dateComponents([.day], from: first, to: today).day ?? 0)
    }

    /// "어제부터" · "since yesterday" · "sinds gisteren" after one day; "3일째" · "3 days" · "3 dagen" from
    /// the third day on (the count includes today); nil while it's new today or not tracked.
    public static func label(_ item: TodoItem, now: Date, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String? {
        guard tracks(item, now: now, calendar: calendar) else { return nil }
        let days = days(since: item.todaySince, now: now, calendar: calendar)
        guard days >= 1 else { return nil }
        if days == 1 { return ["어제부터", "since yesterday", "sinds gisteren"][language.index] }
        switch language {
        case .ko: return "\(days + 1)일째"
        case .en, .nl: return language.days(days + 1)
        }
    }
}
