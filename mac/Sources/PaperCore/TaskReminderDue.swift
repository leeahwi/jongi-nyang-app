import Foundation

/// Which task alerts are due. Each device remembers what it has shown itself (`shownHere`), so in
/// a folder shared with another computer both show an alert when it comes due — the other
/// one's "delivered" mark doesn't silence this one. An alert another device already showed is
/// left alone once it is older than `freshness` (this device was off or asleep then).
/// Same rule as the Windows app (due.ts).
public enum TaskReminderDue {
    public static let freshness: TimeInterval = 10 * 60

    /// What this device records once it has shown an alert: the task and the alert's time.
    public static func key(_ item: TodoItem) -> String? {
        item.reminderAt.map { "\(item.id.uuidString)@\(Int($0.timeIntervalSince1970))" }
    }

    public static func readyItems(in items: [TodoItem], now: Date, shownHere: Set<String> = []) -> [TodoItem] {
        pending(items, now: now, shownHere: shownHere)
            .filter { $0.reminderAt! <= now }
            .sorted { lhs, rhs in
                if lhs.reminderAt! != rhs.reminderAt! { return lhs.reminderAt! < rhs.reminderAt! }
                return lhs.createdAt < rhs.createdAt
            }
    }

    /// When the next alert is due (already past when one is waiting), or nil.
    public static func nextTime(in items: [TodoItem], now: Date, shownHere: Set<String> = []) -> Date? {
        pending(items, now: now, shownHere: shownHere).compactMap(\.reminderAt).min()
    }

    private static func pending(_ items: [TodoItem], now: Date, shownHere: Set<String>) -> [TodoItem] {
        items.filter { item in
            guard !item.isCompleted, let reminderAt = item.reminderAt else { return false }
            if let key = key(item), shownHere.contains(key) { return false }
            guard let deliveredAt = item.reminderLastDeliveredAt, deliveredAt >= reminderAt else { return true }
            // Shown for this time already, elsewhere (or here before this device kept a record).
            return now.timeIntervalSince(reminderAt) < freshness
        }
    }
}
