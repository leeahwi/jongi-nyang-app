import Foundation

public struct Notebook: Codable, Equatable, Sendable {
    public private(set) var items: [TodoItem]

    public init(items: [TodoItem] = []) {
        var seenIDs = Set<TodoItem.ID>()
        self.items = items.compactMap { item in
            guard let title = Self.cleanedTitle(item.title),
                  seenIDs.insert(item.id).inserted else {
                return nil
            }
            var cleaned = item
            cleaned.title = title
            return cleaned
        }
    }

    enum CodingKeys: String, CodingKey {
        case items
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        let decodedItems = try container.decode([TodoItem].self, forKey: .items)
        var seenIDs = Set<TodoItem.ID>()
        var validItems: [TodoItem] = []
        validItems.reserveCapacity(decodedItems.count)

        for item in decodedItems {
            guard let title = Self.cleanedTitle(item.title) else {
                throw DecodingError.dataCorruptedError(
                    forKey: .items,
                    in: container,
                    debugDescription: "Todo titles must not be blank."
                )
            }
            guard seenIDs.insert(item.id).inserted else {
                throw DecodingError.dataCorruptedError(
                    forKey: .items,
                    in: container,
                    debugDescription: "Todo IDs must be unique."
                )
            }
            var cleaned = item
            cleaned.title = title
            cleaned.normalizeTimeRange()
            validItems.append(cleaned)
        }

        items = validItems
    }

    @discardableResult
    public mutating func add(_ rawTitle: String, now: Date = Date(), id: UUID = UUID()) -> TodoItem? {
        guard let title = Self.cleanedTitle(rawTitle),
              !items.contains(where: { $0.id == id }) else { return nil }
        let item = TodoItem(id: id, title: title, createdAt: now)
        items.append(item)
        return item
    }

    @discardableResult
    public mutating func edit(id: TodoItem.ID, title rawTitle: String) -> Bool {
        guard let title = Self.cleanedTitle(rawTitle),
              let index = items.firstIndex(where: { $0.id == id }) else {
            return false
        }
        items[index].title = title
        return true
    }

    @discardableResult
    public mutating func toggle(id: TodoItem.ID, now: Date = Date()) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return false }
        items[index].isCompleted.toggle()
        // Whole seconds, matching the ISO 8601 file format (and the Windows app).
        items[index].completedAt = items[index].isCompleted ? Date(timeIntervalSince1970: now.timeIntervalSince1970.rounded(.down)) : nil
        return true
    }

    @discardableResult
    public mutating func setSeries(id: TodoItem.ID, seriesID: String?) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return false }
        items[index].seriesID = seriesID
        return true
    }

    @discardableResult
    public mutating func setDue(id: TodoItem.ID, dueDate: String?) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return false }
        items[index].dueDate = dueDate
        return true
    }

    @discardableResult
    public mutating func setShelf(id: TodoItem.ID, shelf: ShelfPin?) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return false }
        items[index].shelf = shelf
        return true
    }

    /// A deadline plus whether the task also stays on today's sheet.
    @discardableResult
    public mutating func setDeadline(id: TodoItem.ID, dueDate: String, keepOnToday: Bool) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return false }
        items[index].dueDate = dueDate
        if keepOnToday { items[index].shelf = .today } else if items[index].shelf == .today { items[index].shelf = nil }
        return true
    }

    /// Off to 나중에, without a deadline.
    @discardableResult
    public mutating func saveForLater(id: TodoItem.ID) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return false }
        items[index].dueDate = nil
        items[index].shelf = .later
        return true
    }

    /// 앞으로: dropped on a day — due that day, off the later shelf and today's pin.
    @discardableResult
    public mutating func schedule(id: TodoItem.ID, dueDate: String) -> Bool {
        restorePlace(id: id, dueDate: dueDate, shelf: nil)
    }

    /// Puts a task's date and shelf back as they were (the toast's 되돌리기).
    @discardableResult
    public mutating func restorePlace(id: TodoItem.ID, dueDate: String?, shelf: ShelfPin?) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return false }
        items[index].dueDate = dueDate
        items[index].shelf = shelf
        return true
    }

    /// Links a task to a series. When the series has today's copy (`placeToday`), the task
    /// leaves the "나중에" shelf and takes today's alert if one is given.
    @discardableResult
    public mutating func linkSeries(id: TodoItem.ID, seriesID: String, placeToday: Bool, reminder: Date?) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return false }
        items[index].seriesID = seriesID
        guard placeToday else { return true }
        if items[index].shelf == .later { items[index].shelf = nil }
        if let reminder { setReminder(id: id, at: reminder) }
        return true
    }

    /// Open copies of a series take its new title and, when given, today's alert (or none).
    fileprivate mutating func applySeries(_ seriesID: String, title: String, reminder: Date??) {
        for index in items.indices where items[index].seriesID == seriesID && !items[index].isCompleted {
            items[index].title = title
            guard let reminder, items[index].reminderAt != reminder else { continue }
            items[index].reminderAt = reminder
            items[index].reminderLastDeliveredAt = nil
        }
    }

    fileprivate mutating func placeRecurring(create: [TodoItem], roll: [RepeatRoll]) {
        for change in roll {
            guard let index = items.firstIndex(where: { $0.id == change.id }) else { continue }
            items[index].reminderAt = change.reminderAt
            items[index].reminderLastDeliveredAt = nil
            // Today's occurrence belongs on today's sheet, even if the copy was shelved or has a later deadline.
            if items[index].shelf == .later { items[index].shelf = nil }
            if items[index].dueDate != nil { items[index].shelf = .today }
        }
        for item in create where !items.contains(where: { $0.id == item.id }) { items.append(item) }
    }

    /// 할 일 시간 정하기: the range (nil clears it), and the reminder that goes with it (TimeBlock.reminder).
    @discardableResult
    public mutating func setTimeRange(id: TodoItem.ID, to range: TimeRange?, now: Date = Date()) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return false }
        let old = items[index].timeRange
        let reminder = TimeBlock.reminder(for: items[index], from: old, to: range, now: now)
        items[index].timeRange = range
        if reminder != items[index].reminderAt {
            items[index].reminderAt = reminder
            // C4b (timeblock-cases.md): a reminder moved back to a time already gone counts as delivered now, so
            // dragging a block earlier doesn't pop its reminder up at once.
            items[index].reminderLastDeliveredAt = reminder.map { $0 <= now ? now : nil } ?? nil
        }
        return true
    }

    /// 어제부터: stamps (or clears) `todaySince` as Carry.stamps says.
    fileprivate mutating func stamp(_ changes: [UUID: String?]) {
        for index in items.indices {
            if let change = changes[items[index].id] { items[index].todaySince = change }
        }
    }

    fileprivate mutating func replace(_ item: TodoItem) {
        guard let index = items.firstIndex(where: { $0.id == item.id }) else { return }
        items[index] = item
    }

    fileprivate mutating func remove(ids: Set<TodoItem.ID>) {
        items.removeAll { ids.contains($0.id) }
    }

    /// Another writer's changes laid over this copy (1.42, see UndoableNotebook.adopt): `changed` items replace
    /// theirs here; `added` ones come in after the item before them in `order` (first when there's none);
    /// `removed` ones go.
    public mutating func merge(changed: [TodoItem], added: [TodoItem], removed: Set<TodoItem.ID>, order: [TodoItem.ID]) {
        items.removeAll { removed.contains($0.id) }
        for item in changed {
            if let index = items.firstIndex(where: { $0.id == item.id }) { items[index] = item }
        }
        for item in added where !items.contains(where: { $0.id == item.id }) {
            let position = order.firstIndex(of: item.id) ?? order.count
            var index = 0
            for id in order[..<position].reversed() {
                if let found = items.firstIndex(where: { $0.id == id }) { index = found + 1; break }
            }
            items.insert(item, at: index)
        }
    }

    @discardableResult
    public mutating func setReminder(id: TodoItem.ID, at date: Date?) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return false }
        guard items[index].reminderAt != date else { return true }
        items[index].reminderAt = date
        items[index].reminderLastDeliveredAt = nil
        return true
    }

    @discardableResult
    public mutating func markReminderDelivered(id: TodoItem.ID, at date: Date) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == id }),
              items[index].reminderAt != nil else {
            return false
        }
        items[index].reminderLastDeliveredAt = date
        return true
    }

    @discardableResult
    fileprivate mutating func markReminderDelivered(id: TodoItem.ID, scheduledAt: Date, deliveredAt: Date) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == id }),
              items[index].reminderAt == scheduledAt else {
            return false
        }
        items[index].reminderLastDeliveredAt = deliveredAt
        return true
    }

    @discardableResult
    public mutating func delete(id: TodoItem.ID) -> Bool {
        guard let index = items.firstIndex(where: { $0.id == id }) else { return false }
        items.remove(at: index)
        return true
    }

    @discardableResult
    public mutating func move(id: TodoItem.ID, to targetIndex: Int) -> Bool {
        guard let sourceIndex = items.firstIndex(where: { $0.id == id }),
              items.indices.contains(targetIndex) || targetIndex == items.count else {
            return false
        }
        let item = items.remove(at: sourceIndex)
        let adjustedIndex = targetIndex > sourceIndex ? targetIndex - 1 : targetIndex
        items.insert(item, at: max(0, min(adjustedIndex, items.count)))
        return true
    }

    /// Puts deleted tasks back, each before the task that followed it in `order` (or at the end).
    @discardableResult
    public mutating func restore(_ restored: [TodoItem], order: [UUID]) -> Bool {
        var changed = false
        for item in restored where !items.contains(where: { $0.id == item.id }) {
            let after = order.firstIndex(of: item.id).map { Array(order[($0 + 1)...]) } ?? []
            var index = items.count
            for id in after {
                if let found = items.firstIndex(where: { $0.id == id }) { index = found; break }
            }
            items.insert(item, at: index)
            changed = true
        }
        return changed
    }

    @discardableResult
    public mutating func clearCompleted() -> Int {
        let originalCount = items.count
        items.removeAll { $0.isCompleted }
        return originalCount - items.count
    }

    public var activeCount: Int {
        items.filter { !$0.isCompleted }.count
    }

    public var completedCount: Int {
        items.filter(\.isCompleted).count
    }

    private static func cleanedTitle(_ rawTitle: String) -> String? {
        let title = rawTitle
            .replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return title.isEmpty ? nil : title
    }
}

public struct UndoableNotebook: Equatable, Sendable {
    public private(set) var notebook: Notebook
    private var undoStack: [Notebook]
    /// Each step keeps a full copy of the list, so a long session must not grow without bound.
    static let undoLimit = 200
    private var redoStack: [Notebook]

    public init(notebook: Notebook = Notebook()) {
        self.notebook = notebook
        undoStack = []
        redoStack = []
    }

    public var canUndo: Bool { !undoStack.isEmpty }
    public var canRedo: Bool { !redoStack.isEmpty }

    @discardableResult
    public mutating func add(_ title: String, now: Date = Date(), id: UUID = UUID()) -> TodoItem? {
        perform { $0.add(title, now: now, id: id) }
    }

    @discardableResult
    public mutating func edit(id: TodoItem.ID, title: String) -> Bool {
        perform { $0.edit(id: id, title: title) }
    }

    @discardableResult
    public mutating func toggle(id: TodoItem.ID, now: Date = Date()) -> Bool {
        perform { $0.toggle(id: id, now: now) }
    }

    /// Links a task to a recurring series (or unlinks it). A normal, undoable edit.
    @discardableResult
    public mutating func setSeries(id: TodoItem.ID, seriesID: String?) -> Bool {
        perform { $0.setSeries(id: id, seriesID: seriesID) }
    }

    @discardableResult
    public mutating func setDue(id: TodoItem.ID, dueDate: String?) -> Bool {
        perform { $0.setDue(id: id, dueDate: dueDate) }
    }

    @discardableResult
    public mutating func setShelf(id: TodoItem.ID, shelf: ShelfPin?) -> Bool {
        perform { $0.setShelf(id: id, shelf: shelf) }
    }

    /// Off to 나중에 without a deadline, as one undo step.
    @discardableResult
    public mutating func saveForLater(id: TodoItem.ID) -> Bool {
        perform { $0.saveForLater(id: id) }
    }
    @discardableResult
    public mutating func schedule(id: TodoItem.ID, dueDate: String) -> Bool {
        perform { $0.schedule(id: id, dueDate: dueDate) }
    }
    @discardableResult
    public mutating func restorePlace(id: TodoItem.ID, dueDate: String?, shelf: ShelfPin?) -> Bool {
        perform { $0.restorePlace(id: id, dueDate: dueDate, shelf: shelf) }
    }

    /// A deadline and its shelf as one undo step.
    @discardableResult
    public mutating func setDeadline(id: TodoItem.ID, dueDate: String, keepOnToday: Bool) -> Bool {
        perform { $0.setDeadline(id: id, dueDate: dueDate, keepOnToday: keepOnToday) }
    }

    /// Links a task to a series (and places it today) as one undo step.
    @discardableResult
    public mutating func linkSeries(id: TodoItem.ID, seriesID: String, placeToday: Bool, reminder: Date?) -> Bool {
        perform { $0.linkSeries(id: id, seriesID: seriesID, placeToday: placeToday, reminder: reminder) }
    }

    /// A series edited in Settings: open copies take the new title and, when `reminder` is
    /// non-nil, today's alert (`.some(nil)` removes it). Bookkeeping, applied to every snapshot.
    public mutating func applySeries(_ seriesID: String, title: String, reminder: Date??) {
        notebook.applySeries(seriesID, title: title, reminder: reminder)
        for index in undoStack.indices { undoStack[index].applySeries(seriesID, title: title, reminder: reminder) }
        for index in redoStack.indices { redoStack[index].applySeries(seriesID, title: title, reminder: reminder) }
    }

    /// Adds a task straight onto a shelf (or with a deadline, an alert or a time range) as one undo step.
    @discardableResult
    public mutating func add(_ title: String, shelf: ShelfPin?, dueDate: String? = nil, reminder: Date? = nil, range: TimeRange? = nil,
                             now: Date = Date()) -> TodoItem? {
        perform { notebook in
            guard var item = notebook.add(title, now: now) else { return nil }
            notebook.setShelf(id: item.id, shelf: shelf)
            notebook.setDue(id: item.id, dueDate: dueDate)
            if let reminder { notebook.setReminder(id: item.id, at: reminder) }
            if let range, let index = notebook.items.firstIndex(where: { $0.id == item.id }) {
                // The line already worked out the reminder: the range goes on as it is.
                var placed = notebook.items[index]
                placed.timeRange = range
                notebook.replace(placed)
            }
            item.shelf = shelf
            item.dueDate = dueDate
            item.reminderAt = reminder
            item.timeRange = range
            return item
        }
    }

    /// 시간 정하기 (editor, row menu, the ribbon's drag) as one undo step.
    @discardableResult
    public mutating func setTimeRange(id: TodoItem.ID, to range: TimeRange?, now: Date = Date()) -> Bool {
        perform { $0.setTimeRange(id: id, to: range, now: now) }
    }

    /// Places today's copies of recurring tasks. Like delivery, this is bookkeeping: the copies
    /// enter every undo/redo snapshot, so undoing an unrelated edit never removes them.
    public mutating func placeRecurring(create: [TodoItem], roll: [RepeatRoll]) {
        notebook.placeRecurring(create: create, roll: roll)
        for index in undoStack.indices { undoStack[index].placeRecurring(create: create, roll: roll) }
        for index in redoStack.indices { redoStack[index].placeRecurring(create: create, roll: roll) }
    }

    /// 어제부터 (1.38): the day each open task on today's sheet was first seen there. Bookkeeping like
    /// delivery: applied to every undo/redo snapshot, never an undo step of its own.
    public mutating func stampToday(now: Date, calendar: Calendar = .paper) {
        let changes = Carry.stamps(notebook.items, now: now, calendar: calendar)
        guard !changes.isEmpty else { return }
        notebook.stamp(changes)
        for index in undoStack.indices { undoStack[index].stamp(Carry.stamps(undoStack[index].items, now: now, calendar: calendar)) }
        for index in redoStack.indices { redoStack[index].stamp(Carry.stamps(redoStack[index].items, now: now, calendar: calendar)) }
    }

    /// Several changes as one undo step (모두 끝냄, 저녁 정리, a deleted row's 되돌리기 …).
    @discardableResult
    public mutating func batch(_ body: (inout Notebook) -> Void) -> Bool {
        perform { notebook -> Bool in
            let before = notebook
            body(&notebook)
            return notebook != before
        }
    }

    /// Puts tasks back as they were (a deleted row's 되돌리기 when other steps came after it):
    /// each one where it was in `order`, or at the end.
    @discardableResult
    public mutating func restore(_ restored: [TodoItem], order: [UUID]) -> Bool {
        perform { notebook -> Bool in notebook.restore(restored, order: order) }
    }

    /// Moves finished tasks out of the list. Like delivery, this is bookkeeping rather than an
    /// edit: the tasks leave every undo/redo snapshot too, so undo can't bring back (and later
    /// re-archive) a task that already lives in the record.
    @discardableResult
    public mutating func archive(ids: Set<TodoItem.ID>) -> [TodoItem] {
        let removed = notebook.items.filter { ids.contains($0.id) }
        guard !removed.isEmpty else { return [] }
        notebook.remove(ids: ids)
        for index in undoStack.indices { undoStack[index].remove(ids: ids) }
        for index in redoStack.indices { redoStack[index].remove(ids: ids) }
        return removed
    }

    @discardableResult
    public mutating func setReminder(id: TodoItem.ID, at date: Date?) -> Bool {
        perform { $0.setReminder(id: id, at: date) }
    }

    @discardableResult
    public mutating func markReminderDelivered(id: TodoItem.ID, at date: Date) -> Bool {
        guard let item = notebook.items.first(where: { $0.id == id }),
              let scheduledAt = item.reminderAt,
              notebook.markReminderDelivered(id: id, at: date) else {
            return false
        }
        for index in undoStack.indices {
            undoStack[index].markReminderDelivered(id: id, scheduledAt: scheduledAt, deliveredAt: date)
        }
        for index in redoStack.indices {
            redoStack[index].markReminderDelivered(id: id, scheduledAt: scheduledAt, deliveredAt: date)
        }
        return true
    }

    @discardableResult
    public mutating func delete(id: TodoItem.ID) -> Bool {
        perform { $0.delete(id: id) }
    }

    @discardableResult
    public mutating func move(id: TodoItem.ID, to targetIndex: Int) -> Bool {
        perform { $0.move(id: id, to: targetIndex) }
    }

    @discardableResult
    public mutating func clearCompleted() -> Int {
        perform { $0.clearCompleted() }
    }

    @discardableResult
    public mutating func undo() -> Bool {
        guard let previous = undoStack.popLast() else { return false }
        redoStack.append(notebook)
        notebook = previous
        return true
    }

    @discardableResult
    public mutating func redo() -> Bool {
        guard let next = redoStack.popLast() else { return false }
        undoStack.append(notebook)
        notebook = next
        return true
    }

    public mutating func replaceNotebook(_ notebook: Notebook) {
        self.notebook = notebook
        undoStack = []
        redoStack = []
    }

    /// Another writer changed the file — Claude through the extension (1.42), or another device: its version
    /// becomes the list, and its changes go into every undo/redo copy too, so ⌘Z takes back this Mac's own
    /// steps without taking the other writer's work with them. Not an undo step itself.
    public mutating func adopt(_ incoming: Notebook) {
        guard incoming != notebook else { return }
        let old = Dictionary(notebook.items.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let removed = Set(old.keys).subtracting(incoming.items.map(\.id))
        let added = incoming.items.filter { old[$0.id] == nil }
        let changed = incoming.items.filter { old[$0.id] != nil && old[$0.id] != $0 }
        let order = incoming.items.map(\.id)
        notebook = incoming
        for index in undoStack.indices { undoStack[index].merge(changed: changed, added: added, removed: removed, order: order) }
        for index in redoStack.indices { redoStack[index].merge(changed: changed, added: added, removed: removed, order: order) }
    }

    private mutating func perform<T: Equatable>(_ mutation: (inout Notebook) -> T) -> T {
        let before = notebook
        let result = mutation(&notebook)
        if notebook != before {
            undoStack.append(before)
            if undoStack.count > Self.undoLimit { undoStack.removeFirst(undoStack.count - Self.undoLimit) }
            redoStack.removeAll()
        }
        return result
    }
}
