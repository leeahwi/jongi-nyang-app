import Foundation

/// Where a task lives. Stored as `TodoItem.shelf`: nil means "decide from the deadline".
public enum ShelfPin: String, Codable, Sendable {
    /// Saved for some day — not today.
    case later
    /// Put on today's sheet by hand, even though its deadline is further off.
    case today
}

public enum TaskPage: Sendable, Equatable {
    /// 오늘 할 일
    case today
    /// 마감 tab
    case deadline
    /// 나중에 tab
    case later
}

public enum Shelf {
    /// Today's sheet holds undated tasks, anything pinned to today, and deadlines that have
    /// arrived (due today or overdue). Deadlines still ahead wait on the 마감 shelf; tasks
    /// saved for later wait on the 나중에 shelf.
    public static func page(of item: TodoItem, now: Date, calendar: Calendar = .paper) -> TaskPage {
        if item.shelf == .today { return .today }
        if let due = item.dueDate {
            let days = Deadline.daysLeft(due, now: now, calendar: calendar) ?? 0
            return days <= 0 ? .today : .deadline
        }
        return item.shelf == .later ? .later : .today
    }

    public enum Group: Int, CaseIterable, Sendable {
        case thisWeek, thisMonth, afterwards

        public var title: String { title(.ko) }

        /// "이번 주", "이번 달", "그 뒤" — en "This week", "This month", "After that"; nl "Deze week", "Deze maand", "Daarna".
        public func title(_ language: AppLanguage) -> String {
            let titles: [String] = switch language {
            case .ko: ["이번 주", "이번 달", "그 뒤"]
            case .en: ["This week", "This month", "After that"]
            case .nl: ["Deze week", "Deze maand", "Daarna"]
            }
            return titles[rawValue]
        }
    }

    /// Which heading a waiting deadline falls under.
    public static func group(of dueDate: String, now: Date, calendar: Calendar = .paper) -> Group {
        if dueDate <= Deadline.day(for: .thisWeek, now: now, calendar: calendar) { return .thisWeek }
        if dueDate <= Deadline.day(for: .thisMonth, now: now, calendar: calendar) { return .thisMonth }
        return .afterwards
    }
}
