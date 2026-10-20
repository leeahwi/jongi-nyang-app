import Foundation

private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private func encode(_ notebook: Notebook) throws -> Data {
    let encoder = JSONEncoder()
    encoder.dateEncodingStrategy = .iso8601
    encoder.outputFormatting = [.sortedKeys]
    return try encoder.encode(notebook)
}

private func decode(_ data: Data) throws -> Notebook {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .iso8601
    return try decoder.decode(Notebook.self, from: data)
}

/// As on one device: every alert delivered here is one this device showed.
private func ready(_ items: [TodoItem], now: Date) -> [TodoItem] {
    let shown = items.filter { item in
        item.reminderAt.map { at in item.reminderLastDeliveredAt.map { $0 >= at } ?? false } ?? false
    }
    return TaskReminderDue.readyItems(in: items, now: now, shownHere: Set(shown.compactMap(TaskReminderDue.key)))
}

@main
private enum TaskReminderTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }

        let base = Date(timeIntervalSince1970: 1_800_000_000)
        let later = base.addingTimeInterval(600)

        try test("old JSON schema decodes reminders as nil") {
            let id = UUID()
            let json = """
            {"items":[{"id":"\(id.uuidString)","title":"old","isCompleted":false,"createdAt":"2026-09-22T00:00:00Z"}]}
            """
            let book = try decode(Data(json.utf8))
            try expect(book.items.count == 1, "Old item did not decode")
            try expect(book.items[0].reminderAt == nil, "Missing reminderAt was not nil")
            try expect(book.items[0].reminderLastDeliveredAt == nil, "Missing delivery marker was not nil")
        }

        try test("Unicode and new reminder dates roundtrip through JSON") {
            let id = UUID()
            let item = TodoItem(
                id: id,
                title: "한글 📝 café",
                createdAt: base,
                reminderAt: later,
                reminderLastDeliveredAt: later.addingTimeInterval(30)
            )
            let book = Notebook(items: [item])
            let roundtripped = try decode(try encode(book))
            try expect(roundtripped == book, "Reminder roundtrip changed notebook")
            try expect(roundtripped.items[0].title == "한글 📝 café", "Unicode title changed")
        }

        try test("set and remove reminder resets delivery marker") {
            var book = Notebook()
            let id = book.add("task", now: base)!
                .id
            try expect(book.setReminder(id: id, at: later), "Setting reminder failed")
            try expect(book.items[0].reminderAt == later, "Reminder date not set")
            try expect(book.markReminderDelivered(id: id, at: later.addingTimeInterval(1)), "Delivery marker failed")
            try expect(book.setReminder(id: id, at: nil), "Removing reminder failed")
            try expect(book.items[0].reminderAt == nil, "Reminder date not removed")
            try expect(book.items[0].reminderLastDeliveredAt == nil, "Delivery marker not reset")
            try expect(!book.setReminder(id: UUID(), at: later), "Unknown reminder set accepted")
        }

        try test("undo and redo restore user reminder settings") {
            var history = UndoableNotebook()
            let id = history.add("task", now: base)!.id
            try expect(history.setReminder(id: id, at: later), "Undoable reminder set failed")
            try expect(history.notebook.items[0].reminderAt == later, "Reminder not visible")
            try expect(history.undo(), "Undo failed")
            try expect(history.notebook.items[0].reminderAt == nil, "Undo did not remove reminder")
            try expect(history.redo(), "Redo failed")
            try expect(history.notebook.items[0].reminderAt == later, "Redo did not restore reminder")
        }

        try test("delivered marker does not pollute user undo history") {
            var history = UndoableNotebook()
            let id = history.add("task", now: base)!.id
            try expect(history.setReminder(id: id, at: later), "Reminder set failed")
            try expect(history.markReminderDelivered(id: id, at: later.addingTimeInterval(1)), "Delivery marker failed")
            try expect(history.undo(), "Undo after delivery failed")
            try expect(history.notebook.items[0].reminderAt == nil, "Undo did not target reminder set")
            try expect(history.notebook.items[0].reminderLastDeliveredAt == nil, "Undo retained delivery marker")
            try expect(history.undo(), "Original add action should still be undoable")
            try expect(history.notebook.items.isEmpty, "Second undo did not remove original task")
        }

        try test("setting same reminder date preserves delivery marker") {
            var book = Notebook()
            let id = book.add("task", now: base)!.id
            try expect(book.setReminder(id: id, at: later), "Reminder set failed")
            try expect(book.markReminderDelivered(id: id, at: later.addingTimeInterval(1)), "Delivery marker failed")
            try expect(book.setReminder(id: id, at: later), "Same reminder date was rejected")
            try expect(book.items[0].reminderLastDeliveredAt == later.addingTimeInterval(1), "Same-date set cleared delivery marker")
            try expect(ready(book.items, now: later.addingTimeInterval(2)).isEmpty, "Same-date set rearmed reminder")
        }

        try test("unrelated edit undo and redo after delivery do not repeat reminder") {
            var history = UndoableNotebook()
            let id = history.add("task", now: base)!.id
            try expect(history.setReminder(id: id, at: later), "Reminder set failed")
            try expect(history.edit(id: id, title: "edited before delivery"), "Edit before delivery failed")
            try expect(history.markReminderDelivered(id: id, at: later.addingTimeInterval(1)), "Delivery marker failed")
            try expect(history.undo(), "Undo unrelated edit failed")
            try expect(history.notebook.items[0].title == "task", "Undo did not restore title")
            try expect(ready(history.notebook.items, now: later.addingTimeInterval(2)).isEmpty, "Undo restored undelivered snapshot")
            try expect(history.redo(), "Redo unrelated edit failed")
            try expect(history.notebook.items[0].title == "edited before delivery", "Redo did not restore title")
            try expect(ready(history.notebook.items, now: later.addingTimeInterval(2)).isEmpty, "Redo restored undelivered snapshot")
        }

        try test("deleted item restored with same schedule does not repeat reminder") {
            var history = UndoableNotebook()
            let id = history.add("task", now: base)!.id
            try expect(history.setReminder(id: id, at: later), "Reminder set failed")
            try expect(history.delete(id: id), "Delete before delivery failed")
            try expect(history.undo(), "Undo delete failed")
            try expect(history.notebook.items.count == 1, "Undo delete did not restore item")
            try expect(history.markReminderDelivered(id: id, at: later.addingTimeInterval(1)), "Delivery marker failed")
            try expect(history.redo(), "Redo delete failed")
            try expect(history.notebook.items.isEmpty, "Redo delete did not remove item")
            try expect(history.undo(), "Undo delete after delivery failed")
            try expect(history.notebook.items.count == 1, "Undo did not restore deleted item")
            try expect(ready(history.notebook.items, now: later.addingTimeInterval(2)).isEmpty, "Restored deleted item repeated reminder")
        }

        try test("different old reminder date snapshots stay undelivered") {
            var history = UndoableNotebook()
            let oldDate = base.addingTimeInterval(300)
            let newDate = base.addingTimeInterval(900)
            let id = history.add("task", now: base)!.id
            try expect(history.setReminder(id: id, at: oldDate), "Old reminder set failed")
            try expect(history.setReminder(id: id, at: newDate), "New reminder set failed")
            try expect(history.markReminderDelivered(id: id, at: newDate.addingTimeInterval(1)), "Delivery marker failed")
            try expect(history.undo(), "Undo new date failed")
            try expect(history.notebook.items[0].reminderAt == oldDate, "Undo did not restore old date")
            try expect(history.notebook.items[0].reminderLastDeliveredAt == nil, "Delivery marker leaked into different old date")
            try expect(ready(history.notebook.items, now: newDate.addingTimeInterval(2)).map(\.id) == [id], "Old reminder date was incorrectly suppressed")
        }

        try test("completed tasks keep schedule but are suppressed while complete") {
            var book = Notebook()
            let id = book.add("task", now: base)!.id
            book.setReminder(id: id, at: base)
            book.toggle(id: id)
            try expect(book.items[0].reminderAt == base, "Toggle lost reminder date")
            try expect(ready(book.items, now: later).isEmpty, "Completed task was due")
            book.toggle(id: id)
            try expect(ready(book.items, now: later).map(\.id) == [id], "Uncompleted task was not due")
        }

        try test("due helper orders by schedule and returns no duplicates") {
            let early = base.addingTimeInterval(10)
            let middle = base.addingTimeInterval(20)
            let future = base.addingTimeInterval(120)
            let a = TodoItem(id: UUID(), title: "middle", createdAt: base.addingTimeInterval(2), reminderAt: middle)
            let b = TodoItem(id: UUID(), title: "early", createdAt: base.addingTimeInterval(1), reminderAt: early)
            let c = TodoItem(id: UUID(), title: "future", createdAt: base.addingTimeInterval(3), reminderAt: future)
            let d = TodoItem(id: UUID(), title: "none", createdAt: base.addingTimeInterval(4))
            let ready = TaskReminderDue.readyItems(in: [a, b, c, d], now: middle)
            try expect(ready.map(\.title) == ["early", "middle"], "Due order was not soonest first")
            try expect(Set(ready.map(\.id)).count == ready.count, "Due helper duplicated items")
        }

        try test("delivered due item is skipped until rescheduled") {
            var book = Notebook()
            let id = book.add("task", now: base)!.id
            book.setReminder(id: id, at: base)
            try expect(ready(book.items, now: later).map(\.id) == [id], "Initial overdue item missing")
            book.markReminderDelivered(id: id, at: later)
            try expect(ready(book.items, now: later.addingTimeInterval(1)).isEmpty, "Delivered reminder repeated")
            let rearmed = later.addingTimeInterval(60)
            book.setReminder(id: id, at: rearmed)
            try expect(ready(book.items, now: rearmed).map(\.id) == [id], "New schedule did not rearm reminder")
        }

        try test("two computers on one folder both show an alert; an old one shown elsewhere stays quiet") {
            var book = Notebook()
            let id = book.add("task", now: base)!.id
            book.setReminder(id: id, at: later)
            // The other computer showed it a moment ago and marked it delivered in the shared file.
            book.markReminderDelivered(id: id, at: later.addingTimeInterval(1))
            let item = book.items[0]
            try expect(TaskReminderDue.readyItems(in: book.items, now: later.addingTimeInterval(3)).map(\.id) == [id], "This computer must still show it")
            try expect(TaskReminderDue.nextTime(in: book.items, now: later.addingTimeInterval(3)) == later, "and keep it scheduled")
            let shown: Set<String> = [TaskReminderDue.key(item)!]
            try expect(TaskReminderDue.readyItems(in: book.items, now: later.addingTimeInterval(5), shownHere: shown).isEmpty, "Once shown here, never again")
            try expect(TaskReminderDue.nextTime(in: book.items, now: later.addingTimeInterval(5), shownHere: shown) == nil, "Nothing left to schedule")
            // Turned on an hour later: what the other computer already showed isn't brought up again.
            try expect(TaskReminderDue.readyItems(in: book.items, now: later.addingTimeInterval(3600)).isEmpty, "Old alert shown elsewhere stays quiet")
            // Missed by every computer: still shown when this one starts.
            let missed = book.add("missed", now: base)!.id
            book.setReminder(id: missed, at: later)
            try expect(TaskReminderDue.readyItems(in: book.items, now: later.addingTimeInterval(3600)).map(\.id) == [missed], "Missed alert still comes")
        }

        try test("duplicate IDs and title validation semantics stay unchanged") {
            let id = UUID()
            let item = TodoItem(id: id, title: "valid", createdAt: base, reminderAt: later)
            try expect(Notebook(items: [item, item]).items.count == 1, "Initializer duplicate filtering changed")
            let duplicateJSON = """
            {"items":[
              {"id":"\(id.uuidString)","title":"valid","isCompleted":false,"createdAt":"2026-09-22T00:00:00Z","reminderAt":"2027-01-15T08:10:00Z"},
              {"id":"\(id.uuidString)","title":"valid","isCompleted":false,"createdAt":"2026-09-22T00:00:00Z","reminderAt":"2027-01-15T08:10:00Z"}
            ]}
            """
            do {
                _ = try decode(Data(duplicateJSON.utf8))
                throw TestFailure(description: "Duplicate persisted IDs decoded")
            } catch DecodingError.dataCorrupted {
            }
            let blankJSON = """
            {"items":[{"id":"\(UUID().uuidString)","title":"   ","isCompleted":false,"createdAt":"2026-09-22T00:00:00Z","reminderAt":"2027-01-15T08:10:00Z"}]}
            """
            do {
                _ = try decode(Data(blankJSON.utf8))
                throw TestFailure(description: "Blank persisted title decoded")
            } catch DecodingError.dataCorrupted {
            }
        }

        print("\n\(count) task reminder checks passed.")
    }
}
