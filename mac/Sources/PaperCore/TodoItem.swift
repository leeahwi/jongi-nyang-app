import Foundation

public struct TodoItem: Codable, Equatable, Identifiable, Sendable {
    public var id: UUID
    public var title: String
    public var isCompleted: Bool
    public var createdAt: Date
    /// When it was last checked off; cleared when unchecked. Drives archiving and the history calendar.
    public var completedAt: Date?
    public var reminderAt: Date?
    public var reminderLastDeliveredAt: Date?
    /// Set on copies of a recurring task (see Repeat.swift).
    public var seriesID: String?
    /// The last day to get it done, "yyyy-MM-dd" (see Deadline.swift).
    public var dueDate: String?
    /// Saved for later, or pinned to today (see Shelf.swift); nil follows the deadline.
    public var shelf: ShelfPin?
    /// The logical day ("yyyy-MM-dd", 4 a.m. rule) it was first seen open on today's sheet without a
    /// deadline — the 어제부터 / 3일째 mark (see Carry in Convenience.swift). Optional: older files
    /// (and the Windows app before 1.23) don't have it; the app stamps today on first load.
    public var todaySince: String?
    /// 할 일 시간 정하기 (1.39): the time on its day, "HH:mm" (see TimeBlock.swift). Optional, omitted when nil;
    /// older files (and builds) don't have them.
    public var timeStart: String?
    public var timeEnd: String?

    public init(
        id: UUID = UUID(),
        title: String,
        isCompleted: Bool = false,
        createdAt: Date = Date(),
        completedAt: Date? = nil,
        reminderAt: Date? = nil,
        reminderLastDeliveredAt: Date? = nil,
        seriesID: String? = nil
    ) {
        self.id = id
        self.title = title
        self.isCompleted = isCompleted
        self.createdAt = createdAt
        self.completedAt = completedAt
        self.reminderAt = reminderAt
        self.reminderLastDeliveredAt = reminderLastDeliveredAt
        self.seriesID = seriesID
    }
}
