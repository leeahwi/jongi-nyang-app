import Foundation

// Deliberately framework-free: works with Apple's Command Line Tools as well as Xcode.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private func expectError(_ expected: NotebookFileError, _ action: () throws -> Void) throws {
    do {
        try action()
        throw TestFailure(description: "Expected \(expected)")
    } catch let error as NotebookFileError {
        try expect(error == expected, "Unexpected error: \(error)")
    }
}

@main
private enum CoreTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }

        try test("blank input rejected; whitespace trimmed; Unicode retained") {
            var book = Notebook()
            try expect(book.add("  \n \t") == nil, "Blank task accepted")
            let item = book.add("  한글 📝 café  ")!
            try expect(item.title == "한글 📝 café", "Unicode or trimming changed")
        }
        try test("newlines normalized into a single task line") {
            var book = Notebook()
            try expect(book.add("one\ntwo")?.title == "one two", "Multiline title not normalized")
        }
        try test("edit preserves identity and rejects empty replacement") {
            var book = Notebook()
            let id = book.add("original")!.id
            try expect(book.edit(id: id, title: " changed "), "Edit failed")
            try expect(!book.edit(id: id, title: "\n"), "Blank edit accepted")
            try expect(book.items.first?.title == "changed" && book.items.first?.id == id, "Identity or title changed")
        }
        try test("toggle updates completion and counts") {
            var book = Notebook()
            let id = book.add("task")!.id
            book.toggle(id: id)
            try expect(book.completedCount == 1 && book.activeCount == 0, "Completed count incorrect")
            book.toggle(id: id)
            try expect(book.completedCount == 0 && book.activeCount == 1, "Toggle back failed")
        }
        try test("unknown IDs and invalid offsets are safe no-ops") {
            var book = Notebook()
            let id = book.add("task")!.id
            let before = book
            try expect(!book.toggle(id: UUID()), "Unknown toggle accepted")
            try expect(!book.delete(id: UUID()), "Unknown deletion accepted")
            try expect(!book.edit(id: UUID(), title: "other"), "Unknown edit accepted")
            try expect(!book.move(id: id, to: -1), "Negative index accepted")
            try expect(!book.move(id: id, to: 99), "Out-of-bounds index accepted")
            try expect(book == before, "Invalid operations mutated notebook")
        }
        try test("move uses insertion offsets in both directions") {
            var book = Notebook()
            let a = book.add("A")!.id
            let b = book.add("B")!.id
            book.add("C")
            book.move(id: a, to: 3)
            try expect(book.items.map(\.title) == ["B", "C", "A"], "Forward move failed")
            book.move(id: a, to: 0)
            try expect(book.items.map(\.title) == ["A", "B", "C"], "Backward move failed")
            book.move(id: b, to: 2)
            try expect(book.items.map(\.title) == ["A", "B", "C"], "Adjacent insertion should be no-op")
        }
        try test("clear completed retains unfinished order") {
            var book = Notebook()
            book.add("A")
            let b = book.add("B")!.id
            book.add("C")
            book.toggle(id: b)
            try expect(book.clearCompleted() == 1, "Clear count incorrect")
            try expect(book.items.map(\.title) == ["A", "C"], "Unfinished tasks changed")
        }
        try test("undo and redo restore content, order, and completion") {
            var history = UndoableNotebook()
            let a = history.add("A")!.id
            history.add("B")
            let original = history.notebook
            history.toggle(id: a)
            history.edit(id: a, title: "edited")
            history.move(id: a, to: 2)
            let changed = history.notebook
            for _ in 0..<3 { history.undo() }
            try expect(history.notebook == original, "Undo did not restore original")
            for _ in 0..<3 { history.redo() }
            try expect(history.notebook == changed, "Redo did not restore changes")
        }
        try test("delete and clear are undoable") {
            var history = UndoableNotebook()
            let id = history.add("task")!.id
            history.toggle(id: id)
            let before = history.notebook
            history.clearCompleted()
            history.undo()
            try expect(history.notebook == before, "Clear undo failed")
            history.delete(id: id)
            history.undo()
            try expect(history.notebook == before, "Delete undo failed")
        }
        try test("no-ops preserve redo; new mutation invalidates it") {
            var history = UndoableNotebook()
            history.add("A")
            history.add("B")
            history.undo()
            history.add("   ")
            try expect(history.canRedo, "No-op erased redo")
            history.add("C")
            try expect(!history.canRedo, "New mutation retained stale redo")
        }
        try test("empty undo/redo and replacement reset") {
            var history = UndoableNotebook()
            try expect(!history.undo() && !history.redo(), "Empty history changed")
            history.add("A")
            history.replaceNotebook(Notebook())
            try expect(!history.canUndo && !history.canRedo && history.notebook.items.isEmpty, "Replacement retained history")
        }

        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("PaperCore-tests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: folder) }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let file = NotebookFile(url: folder.appendingPathComponent("nested/todos.json"))
        try test("missing file distinguished from corrupt data") {
            try expectError(.missing(file.url)) { _ = try file.load() }
        }
        try test("atomic Unicode roundtrip creates directories and retains order") {
            var book = Notebook()
            let id = book.add("한글 📝 café", now: Date(timeIntervalSince1970: 1_750_000_000))!.id
            book.add("二番目", now: Date(timeIntervalSince1970: 1_750_000_001))
            book.toggle(id: id)
            try file.save(book)
            try expect(try file.load() == book, "Roundtrip lost data")
            try file.save(Notebook())
            try expect(try file.load().items.isEmpty, "Replacement did not persist")
        }
        try test("corrupt data is reported without altering original bytes") {
            let bytes = Data("{not-json".utf8)
            try bytes.write(to: file.url)
            try expectError(.corrupt(file.url)) { _ = try file.load() }
            try expect(try Data(contentsOf: file.url) == bytes, "Load overwrote corrupt file")
        }
        try test("invalid schema rejected") {
            try Data("{\"other\": []}".utf8).write(to: file.url)
            try expectError(.corrupt(file.url)) { _ = try file.load() }
        }
        try test("duplicate IDs and blank persisted titles rejected") {
            let id = UUID().uuidString
            let item = "{\"id\":\"\(id)\",\"title\":\"valid\",\"isCompleted\":false,\"createdAt\":\"2026-09-22T00:00:00Z\"}"
            try Data("{\"items\":[\(item),\(item)]}".utf8).write(to: file.url)
            try expectError(.corrupt(file.url)) { _ = try file.load() }
            try Data("{\"items\":[\(item.replacingOccurrences(of: "valid", with: "   "))]}".utf8).write(to: file.url)
            try expectError(.corrupt(file.url)) { _ = try file.load() }
        }
        try test("write failure reported with original obstruction untouched") {
            let obstruction = folder.appendingPathComponent("not-a-folder")
            let bytes = Data("keep me".utf8)
            try bytes.write(to: obstruction)
            let blocked = NotebookFile(url: obstruction.appendingPathComponent("todos.json"))
            try expectError(.writeFailed(blocked.url)) { try blocked.save(Notebook()) }
            try expect(try Data(contentsOf: obstruction) == bytes, "Write damaged obstruction")
        }
        try test("undo history is bounded for long sessions") {
            var history = UndoableNotebook()
            for index in 0..<(UndoableNotebook.undoLimit + 50) { history.add("task \(index)") }
            var steps = 0
            while history.undo() { steps += 1 }
            try expect(steps == UndoableNotebook.undoLimit, "Undo depth must stop at the limit, got \(steps)")
            try expect(history.notebook.items.count == 50, "Oldest steps beyond the limit stay applied")
        }
        var seoul = Calendar(identifier: .gregorian)
        seoul.timeZone = TimeZone(identifier: "Asia/Seoul")!
        func local(_ month: Int, _ day: Int, _ hour: Int = 12, _ minute: Int = 0) -> Date {
            seoul.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute))!
        }

        try test("checking stamps completedAt in whole seconds; unchecking clears it") {
            var history = UndoableNotebook()
            let item = history.add("산책")!
            history.toggle(id: item.id, now: Date(timeIntervalSince1970: 1_000.75))
            try expect(history.notebook.items[0].completedAt == Date(timeIntervalSince1970: 1_000), "Completion time missing")
            history.toggle(id: item.id)
            try expect(history.notebook.items[0].completedAt == nil, "Unchecking must clear the time")
        }

        try test("archive waits for the chosen days with a 4 a.m. day boundary") {
            var history = UndoableNotebook()
            func done(_ title: String, _ at: Date) -> UUID { let id = history.add(title)!.id; history.toggle(id: id, now: at); return id }
            _ = done("오늘 밤", local(9, 29, 1))
            _ = done("어제", local(9, 28, 15))
            let old = done("사흘 전", local(9, 26, 10))
            _ = history.add("안 끝남")
            let items = history.notebook.items
            try expect(Archive.dayKey(local(9, 29, 1, 30), calendar: seoul) == "2026-09-28", "1:30 a.m. belongs to the previous day")
            try expect(Archive.due(items, now: local(9, 29, 3), after: .nextDay, calendar: seoul).map(\.id) == [old], "Before dawn only older work moves")
            try expect(Archive.due(items, now: local(9, 29, 9), after: .nextDay, calendar: seoul).count == 3, "After dawn all finished work moves")
            try expect(Archive.due(items, now: local(9, 29, 9), after: .threeDays, calendar: seoul).map(\.id) == [old], "3-day setting keeps recent work")
            try expect(Archive.due(items, now: local(9, 29, 9), after: .never, calendar: seoul).isEmpty, "Off keeps everything")
            let legacy = TodoItem(title: "옛날 일", isCompleted: true, createdAt: local(1, 1))
            try expect(Archive.due([legacy], now: Date(), after: .week).count == 1, "Undated finished work moves at the first check")
        }

        try test("archiving leaves undo history so undo can't bring tasks back") {
            var history = UndoableNotebook()
            let item = history.add("끝난 일")!
            history.toggle(id: item.id)
            _ = history.add("다른 일")
            try expect(history.archive(ids: [item.id]).count == 1, "Archive must return the moved task")
            try expect(history.notebook.items.map(\.title) == ["다른 일"], "Archived task must leave the list")
            while history.undo() {
                try expect(!history.notebook.items.contains { $0.id == item.id }, "Undo resurrected an archived task")
            }
        }

        try test("record lines round-trip, read the Windows format and skip torn lines") {
            let entry = ArchiveEntry(id: "A-1", title: "메일 \"정리\"", createdAt: Date(timeIntervalSince1970: 1_790_000_000), completedAt: Date(timeIntervalSince1970: 1_790_003_600))
            let line = Archive.encodeLine(entry)
            try expect(!line.contains("\n") && Archive.parseLines(line) == [entry], "Line must round-trip")
            let windows = #"{"id":"AAAAAAAA-0000-0000-0000-00000000000B","title":"산책","createdAt":"2026-09-28T01:02:03.456Z","completedAt":"2026-09-28T02:00:00Z"}"#
            let parsed = Archive.parseLines(line + "\n" + windows + "\n{\"id\":\"torn\"\n")
            try expect(parsed.count == 2 && parsed[1].title == "산책", "Windows lines must be readable; torn lines skipped")
            try expect(Archive.monthKey(entry, calendar: seoul) == "2026-09" && Archive.monthKey(ArchiveEntry(id: "x", title: "x", createdAt: Date(), completedAt: nil)) == "undated", "Month file keys")
        }

        try test("calendar statistics: grouping, levels and streaks") {
            func entry(_ id: String, _ at: Date) -> ArchiveEntry { ArchiveEntry(id: id, title: id, createdAt: at, completedAt: at) }
            let entries = [entry("1", local(9, 20)), entry("1", local(9, 20)), entry("2", local(9, 21)), entry("3", local(9, 22)),
                           entry("4", local(9, 23, 2)), entry("5", local(9, 27)), entry("6", local(9, 28))]
            let days = Archive.groupByDay(entries, calendar: seoul)
            try expect(days["2026-09-20"]?.count == 1 && days["2026-09-22"]?.count == 2, "Duplicates collapse; 2 a.m. counts for the day before")
            let keys = Set(days.keys)
            try expect(Archive.longestStreak(keys) == 3, "Longest streak")
            try expect(Archive.currentStreak(keys, today: local(9, 28, 20), calendar: seoul) == 2, "Current streak")
            try expect(Archive.currentStreak(keys, today: local(9, 29, 20), calendar: seoul) == 2, "Empty today keeps yesterday's streak")
            try expect(Archive.currentStreak(keys, today: local(9, 30, 20), calendar: seoul) == 0, "A missed day ends the streak")
            try expect([0, 1, 2, 3, 4, 5, 6, 40].map(Archive.heatLevel) == [0, 1, 2, 2, 3, 3, 4, 4], "Heat levels")
        }

        func dayStart(_ month: Int, _ day: Int) -> Date { local(month, day, 4) }

        try test("repeat rules: daily, weekdays, chosen days, monthly clamped to short months") {
            try expect(Repeat.occurs(RepeatRule(kind: .daily), on: dayStart(9, 27), calendar: seoul), "Daily")
            try expect(!Repeat.occurs(RepeatRule(kind: .weekdays), on: dayStart(9, 27), calendar: seoul), "Sunday is not a weekday")
            try expect(Repeat.occurs(RepeatRule(kind: .weekly, weekdays: [1, 3]), on: dayStart(9, 30), calendar: seoul), "Wednesday chosen")
            try expect(!Repeat.occurs(RepeatRule(kind: .weekly, weekdays: [1, 3]), on: dayStart(10, 1), calendar: seoul), "Thursday not chosen")
            try expect(Repeat.occurs(RepeatRule(kind: .monthly, monthDay: 31), on: dayStart(9, 30), calendar: seoul), "31st falls back to the last day")
            try expect(!Repeat.occurs(RepeatRule(kind: .monthly, monthDay: 31), on: dayStart(10, 30), calendar: seoul), "Not before the 31st in long months")
            try expect(!Repeat.isValid(RepeatRule(kind: .weekly, weekdays: [])), "A weekly rule needs a day")
        }

        try test("repeat summaries, next occurrence and late-night alerts") {
            try expect(Repeat.describe(RepeatRule(kind: .weekly, weekdays: [0, 3, 1]), remindAt: "09:05") == "매주 월·수·일 · 오전 9:05 알림", "Weekly summary")
            try expect(Repeat.describe(RepeatRule(kind: .monthly, monthDay: 15)) == "매월 15일", "Monthly summary")
            try expect(Repeat.nextOccurrence(RepeatRule(kind: .weekly, weekdays: [1]), from: local(9, 29, 9), calendar: seoul) == dayStart(10, 5), "Next Monday")
            try expect(Repeat.alert(on: dayStart(9, 28), at: "09:00", calendar: seoul) == local(9, 28, 9), "Morning alert")
            try expect(Repeat.alert(on: dayStart(9, 28), at: "01:30", calendar: seoul) == local(9, 29, 1, 30), "01:30 belongs to that night")
        }

        try test("today's plan creates once, never stacks, carries unfinished copies forward") {
            let now = local(9, 29, 8)
            let water = Series(id: "물", title: "물", rule: RepeatRule(kind: .daily), remindAt: "09:00")
            let weekend = Series(id: "주말", title: "주말", rule: RepeatRule(kind: .weekly, weekdays: [0, 6]))
            let plan = Repeat.planToday([water, weekend], items: [], now: now, calendar: seoul)
            try expect(plan.create.count == 1 && plan.create[0].seriesID == "물" && plan.create[0].reminderAt == local(9, 29, 9), "One copy with today's alert")
            var placed = water
            placed.lastPlaced = "2026-09-29"
            try expect(Repeat.planToday([placed], items: [], now: now, calendar: seoul).placed.isEmpty, "Already placed today")
            placed.lastPlaced = "2026-09-28"
            let open = TodoItem(title: "물", seriesID: "물")
            let carried = Repeat.planToday([placed], items: [open], now: now, calendar: seoul)
            try expect(carried.create.isEmpty && carried.roll.map(\.id) == [open.id], "Unfinished copy is carried, not stacked")
            var done = open
            done.isCompleted = true
            try expect(Repeat.planToday([placed], items: [done], now: now, calendar: seoul).create.count == 1, "A finished copy doesn't block today's")
        }

        try test("placed copies survive undo of unrelated edits; repeats.json matches the Windows format") {
            var history = UndoableNotebook()
            _ = history.add("다른 일")
            let plan = Repeat.planToday([Series(id: "운동", title: "운동", rule: RepeatRule(kind: .daily))], items: history.notebook.items, now: local(9, 29, 8), calendar: seoul)
            history.placeRecurring(create: plan.create, roll: plan.roll)
            _ = history.undo()
            try expect(history.notebook.items.map(\.title) == ["운동"], "Undo removed a placed copy")
            let windows = #"{"id":"S1","title":"물","rule":{"kind":"weekly","weekdays":[1,3]},"remindAt":"09:00","createdAt":"2026-09-29T00:00:00Z","lastPlaced":"2026-09-29"}"#
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let series = try decoder.decode(Series.self, from: Data(windows.utf8))
            try expect(series.rule == RepeatRule(kind: .weekly, weekdays: [1, 3]) && series.remindAt == "09:00", "Windows series must decode")
        }

        try test("countdown timer: remaining, pause, resume, adjust and clock text") {
            let start = Date(timeIntervalSince1970: 1_000_000)
            var timer = FocusTimer.countdown(minutes: 25, now: start)
            try expect(timer.remaining(at: start.addingTimeInterval(60)) == 24 * 60, "Remaining after a minute")
            try expect(abs(timer.fraction(at: start.addingTimeInterval(750)) - 0.5) < 0.0001, "Half the disc at half time")
            timer.pause(at: start.addingTimeInterval(600))
            try expect(timer.remaining(at: start.addingTimeInterval(5000)) == 900, "Paused time doesn't run")
            timer.resume(at: start.addingTimeInterval(5000))
            try expect(!timer.isFinished(at: start.addingTimeInterval(5899)) && timer.isFinished(at: start.addingTimeInterval(5900)), "Resumes where it left off")
            timer.adjust(minutes: 5, at: start.addingTimeInterval(5000))
            try expect(timer.remaining(at: start.addingTimeInterval(5000)) == 1200, "Five more minutes")
            try expect(timer.next(at: start) == nil, "A one-off timer has no next phase")
            try expect(FocusTimer.clock(59.2) == "01:00" && FocusTimer.clock(3725) == "1:02:05", "Clock text")
        }

        try test("pomodoro cycles focus → rest, with a long rest every 4 rounds") {
            let start = Date(timeIntervalSince1970: 1_000_000)
            var timer = FocusTimer.pomodoro(PomodoroSettings(), now: start)
            try expect(timer.phase == .focus && timer.caption == "집중 1/4", "Starts focused")
            var phases: [FocusPhase] = []
            var now = start
            for _ in 0..<8 {
                now = now.addingTimeInterval(timer.duration)
                timer = timer.next(at: now)!
                phases.append(timer.phase)
            }
            try expect(phases == [.rest, .focus, .rest, .focus, .rest, .focus, .longRest, .focus], "Cycle order")
            try expect(timer.caption == "집중 1/4" && timer.duration == 25 * 60, "A new set after the long rest")
            let decoded = try JSONDecoder().decode(FocusTimer.self, from: JSONEncoder().encode(timer))
            try expect(decoded == timer, "Survives relaunch")
        }

        try test("deadlines: today, this week (to the end of the 앞으로 week), this month, and 4 a.m. boundary") {
            let tuesday = local(9, 29, 10)
            try expect(Deadline.day(for: .today, now: tuesday, calendar: seoul) == "2026-09-29", "Today")
            try expect(Deadline.day(for: .thisWeek, now: tuesday, calendar: seoul) == "2026-10-03", "This week ends Saturday (ko)")
            try expect(Deadline.day(for: .thisWeek, now: tuesday, calendar: seoul, language: .en) == "2026-10-03", "… and in English")
            try expect(Deadline.day(for: .thisWeek, now: tuesday, calendar: seoul, language: .nl) == "2026-10-04", "Dutch weeks end on Sunday")
            try expect(Deadline.day(for: .thisWeek, now: local(10, 3, 10), calendar: seoul) == "2026-10-03", "On Saturday it is today")
            try expect(Deadline.day(for: .thisWeek, now: local(10, 4, 10), calendar: seoul) == "2026-10-10", "Sunday starts a new week (ko)")
            try expect(Deadline.day(for: .thisWeek, now: local(10, 4, 10), calendar: seoul, language: .nl) == "2026-10-04", "… but ends one in Dutch")
            try expect(Deadline.day(for: .thisWeek, now: local(10, 4, 1), calendar: seoul) == "2026-10-03", "Sunday 1 a.m. is still Saturday")
            for language in AppLanguage.allCases {
                for day in 27...33 {
                    let now = day <= 30 ? local(9, day, 15) : local(10, day - 30, 15)
                    let week = Deadline.week(of: now, calendar: seoul, language: language)
                    try expect(Deadline.day(for: .thisWeek, now: now, calendar: seoul, language: language) == week.last,
                               "‘이번 주 안’ is the last day of 앞으로’s 이번 주 (\(language), \(day))")
                }
            }
            try expect(Deadline.day(for: .thisMonth, now: tuesday, calendar: seoul) == "2026-09-30", "This month")
            try expect(Deadline.day(for: .today, now: local(9, 30, 1), calendar: seoul) == "2026-09-29", "1 a.m. still counts as yesterday")
        }

        try test("deadline labels in D-day and date styles, with urgency") {
            let now = local(9, 29, 10)
            let cases: [(String, String, String)] = [("2026-09-29", "D-day", "~오늘"), ("2026-09-30", "D-1", "~내일"),
                ("2026-10-02", "D-3", "~금"), ("2026-10-31", "D-32", "~10/31"), ("2027-01-02", "D-95", "~2027/1/2"), ("2026-09-27", "D+2", "~9/27")]
            for (key, dday, date) in cases {
                try expect(Deadline.label(key, style: .dday, now: now, calendar: seoul) == dday, "D-day label for \(key)")
                try expect(Deadline.label(key, style: .date, now: now, calendar: seoul) == date, "Date label for \(key)")
            }
            try expect(Deadline.urgency("2026-09-27", now: now, calendar: seoul) == .overdue && Deadline.urgency("2026-09-29", now: now, calendar: seoul) == .today
                       && Deadline.urgency("2026-10-01", now: now, calendar: seoul) == .soon && Deadline.urgency("2026-10-31", now: now, calendar: seoul) == .later, "Urgency")
            try expect(Deadline.sentence("2026-10-04", now: now, calendar: seoul) == "10월 4일 (일)까지 · 5일 남음", "Sentence")
            var history = UndoableNotebook()
            let item = history.add("보고서")!
            history.setDue(id: item.id, dueDate: "2026-10-04")
            try expect(history.notebook.items[0].dueDate == "2026-10-04", "Due date stored")
            history.undo()
            try expect(history.notebook.items[0].dueDate == nil, "Setting a deadline is undoable")
        }

        try test("shelves: undated today, deadlines wait until due, later waits, pins win") {
            let now = local(9, 29, 10)
            func item(_ due: String? = nil, _ shelf: ShelfPin? = nil) -> TodoItem {
                var item = TodoItem(title: "일")
                item.dueDate = due
                item.shelf = shelf
                return item
            }
            try expect(Shelf.page(of: item(), now: now, calendar: seoul) == .today, "Undated work is for today")
            try expect(Shelf.page(of: item("2026-10-04"), now: now, calendar: seoul) == .deadline, "A future deadline waits on the shelf")
            try expect(Shelf.page(of: item("2026-09-29"), now: now, calendar: seoul) == .today, "Due today comes up to today")
            try expect(Shelf.page(of: item("2026-09-27"), now: now, calendar: seoul) == .today, "Overdue comes up to today")
            try expect(Shelf.page(of: item(nil, .later), now: now, calendar: seoul) == .later, "Saved for later")
            try expect(Shelf.page(of: item("2026-10-04", .later), now: now, calendar: seoul) == .deadline, "A deadline files it under 마감")
            try expect(Shelf.page(of: item("2026-10-20", .today), now: now, calendar: seoul) == .today, "Pinned to today stays today")
            try expect(Shelf.group(of: "2026-10-03", now: now, calendar: seoul) == .thisWeek && Shelf.group(of: "2026-09-30", now: now, calendar: seoul) == .thisWeek, "This week")
            try expect(Shelf.group(of: "2026-10-12", now: local(10, 6, 10), calendar: seoul) == .thisMonth, "This month")
            try expect(Shelf.group(of: "2026-11-02", now: now, calendar: seoul) == .afterwards, "Afterwards")
            var history = UndoableNotebook()
            let added = history.add("여행 계획", shelf: .later)!
            try expect(added.shelf == .later && history.notebook.items[0].shelf == .later, "Add straight to a shelf")
            history.undo()
            try expect(history.notebook.items.isEmpty, "Adding to a shelf is one undo step")
        }

        try test("deadline and series links are single undo steps; rolled copies return to today") {
            var history = UndoableNotebook()
            let task = history.add("보고서")!
            history.setDeadline(id: task.id, dueDate: "2026-10-09", keepOnToday: true)
            try expect(history.notebook.items[0].dueDate == "2026-10-09" && history.notebook.items[0].shelf == .today, "Deadline kept on today")
            history.undo()
            try expect(history.notebook.items[0].dueDate == nil && history.notebook.items[0].shelf == nil, "One undo clears deadline and pin")

            let later = history.add("운동", shelf: .later)!
            history.linkSeries(id: later.id, seriesID: "s1", placeToday: true, reminder: local(9, 29, 9))
            try expect(history.notebook.items[1].seriesID == "s1" && history.notebook.items[1].shelf == nil, "Today's copy leaves the shelf")
            history.undo()
            try expect(history.notebook.items[1].seriesID == nil && history.notebook.items[1].reminderAt == nil, "One undo unlinks")
            history.redo()

            history.setShelf(id: later.id, shelf: .later)
            history.placeRecurring(create: [], roll: [RepeatRoll(id: later.id, reminderAt: nil)])
            try expect(history.notebook.items[1].shelf == nil, "A rolled copy comes back to today's sheet")

            history.applySeries("s1", title: "스트레칭", reminder: .some(nil))
            try expect(history.notebook.items[1].title == "스트레칭" && history.notebook.items[1].reminderAt == nil, "Settings edits reach the open copy")
            try expect(Calendar.paper.identifier == .gregorian, "Day keys are always Gregorian")
        }

        try test("the upcoming week end is always a later day, even on the week's last day") {
            try expect(Deadline.upcomingWeekEnd(now: local(10, 1, 15), calendar: seoul) == "2026-10-03", "Thursday → this Saturday")
            try expect(Deadline.upcomingWeekEnd(now: local(10, 3, 15), calendar: seoul) == "2026-10-10", "Saturday → next Saturday")
            try expect(Deadline.upcomingWeekEnd(now: local(10, 4, 1), calendar: seoul) == "2026-10-10", "Sunday 1 a.m. is still Saturday")
            try expect(Deadline.upcomingWeekEnd(now: local(10, 4, 15), calendar: seoul, language: .nl) == "2026-10-11", "Dutch: Sunday → next Sunday")
            let now = local(10, 4, 15)
            try expect(Shelf.page(of: { var item = TodoItem(title: "발표"); item.dueDate = Deadline.upcomingWeekEnd(now: now, calendar: seoul); return item }(), now: now, calendar: seoul) == .deadline, "Stays on 마감")
            var history = UndoableNotebook()
            history.add("발표", shelf: nil, dueDate: "2026-10-11")
            try expect(history.notebook.items.first?.dueDate == "2026-10-11", "Added with its deadline")
            history.undo()
            try expect(history.notebook.items.isEmpty, "Adding with a deadline is one undo step")
        }

        try test("the Sunday-evening look-back counts this week once") {
            let entries = [(9, 27, 12), (9, 28, 12), (10, 1, 12), (10, 4, 20), (10, 5, 0)].map { month, day, hour in
                ArchiveEntry(id: UUID().uuidString, title: "일", createdAt: local(month, day), completedAt: local(month, day, hour))
            }
            try expect(Archive.weekKey(local(10, 4, 19), calendar: seoul) == "2026-09-28", "Week starts Monday")
            try expect(Archive.weeklyLookBack(entries, now: local(10, 4, 17), lastShownWeek: nil, calendar: seoul) == nil, "Not before 18:00")
            try expect(Archive.weeklyLookBack(entries, now: local(10, 3, 20), lastShownWeek: nil, calendar: seoul) == nil, "Only on Sunday")
            try expect(Archive.weeklyLookBack(entries, now: local(10, 4, 21), lastShownWeek: nil, calendar: seoul) == 3, "Mon–Sun so far (9/28, 10/1, 10/4)")
            try expect(Archive.weeklyLookBack(entries, now: local(10, 5, 1), lastShownWeek: nil, calendar: seoul) == 4, "1 a.m. Monday is still Sunday night")
            try expect(Archive.weeklyLookBack(entries, now: local(10, 4, 21), lastShownWeek: "2026-09-28", calendar: seoul) == nil, "Once a week")
        }

        try test("one memo edited on two devices at once merges both edits") {
            // Same cases as textMerge.test.ts in the Windows app.
            let cases: [(base: String, ours: String, theirs: String, merged: String)] = [
                ("장보기\n우유", "장보기 목록\n우유", "장보기\n우유 2개", "장보기 목록\n우유 2개"),
                ("회의 3시 준비물 노트", "회의 4시 준비물 노트", "회의 3시 준비물 노트북", "회의 4시 준비물 노트북"),
                ("할 일", "할 일\n맥에서", "할 일\n윈도우에서", "할 일\n맥에서\n윈도우에서"),
                ("메모", "메모 맥", "메모 윈도우", "메모 맥 윈도우"),
                ("3시", "4시", "5시", "4시\n5시"),
                ("a\nb\nc", "a\nc", "a\nb\nc!", "a\nc!"),
                ("a", "a", "b", "b"),
                ("a", "a b", "a b", "a b"),
                ("첫 줄\n둘째 줄\n셋째 줄", "첫 줄 고침\n둘째 줄\n셋째 줄", "첫 줄\n둘째 줄\n셋째 줄\n넷째 줄", "첫 줄 고침\n둘째 줄\n셋째 줄\n넷째 줄"),
                ("x", "", "xy", "xy"),
            ]
            for item in cases {
                let merged = TextMerge.merge(base: item.base, ours: item.ours, theirs: item.theirs)
                try expect(merged == item.merged, "merge(\(item.base.debugDescription), \(item.ours.debugDescription), \(item.theirs.debugDescription)) gave \(merged.debugDescription)")
            }
            // Long memos stay quick and lose nothing.
            let long = (1...3000).map { "줄 \($0)" }.joined(separator: "\n")
            let merged = TextMerge.merge(base: long, ours: "맨 위\n" + long, theirs: long + "\n맨 아래")
            try expect(merged.hasPrefix("맨 위\n줄 1\n") && merged.hasSuffix("줄 3000\n맨 아래"), "Long memo merge")
        }

        try test("the caret keeps its place when joined text comes in") {
            // Same cases as textMerge.test.ts in the Windows app.
            let cases: [(caret: Int, old: String, new: String, moved: Int)] = [
                (3, "장보기\n우유", "장보기\n우유 2개", 3),
                (5, "ab\ncd", "XXab\ncd", 7),
                (2, "abcd", "abXYcd", 2),
                (4, "abcd", "ab", 2),
                (1, "a😀b", "a😀b!", 1),
            ]
            for item in cases {
                let moved = TextMerge.caret(item.caret, from: item.old, to: item.new)
                try expect(moved == item.moved, "caret(\(item.caret), \(item.old.debugDescription) → \(item.new.debugDescription)) gave \(moved)")
            }
        }

        try test("종이냥 한마디 picks lines for the moment (same cases as chatter.test.ts)") {
            func numbers(_ values: [Double]) -> () -> Double {
                var queue = values
                return { queue.isEmpty ? 0 : queue.removeFirst() }
            }
            typealias C = PetChatter.Context
            let start = C(hour: 10, open: 3, done: 0, firstOpen: "보고서 쓰기")
            var line = PetChatter.pick(start, questions: false, recent: [], random: numbers([0, 0]))
            try expect(line.id == "p.start.0" && line.text == "‘보고서 쓰기’부터 시작해 볼까요?", "progress: \(line)")
            line = PetChatter.pick(start, questions: false, recent: [], random: numbers([0.6, 0.5]))
            try expect(line.id == "t.morning.3", "time of day: \(line.id)")
            line = PetChatter.pick(C(hour: 12, open: 2, done: 2, firstOpen: "장보기"), questions: true, recent: [], random: numbers([0.99, 0.35]))
            try expect(line.id == "q.first" && line.text == "‘장보기’ 지금 해 볼까요?" && line.answers.map(\.label) == ["해 볼게요", "나중에"], "question: \(line)")
            line = PetChatter.pick(C(hour: 15, open: 0, done: 4), questions: false, recent: ["p.all.0"], random: numbers([0, 0]))
            try expect(line.id == "p.all.1", "recent lines are skipped: \(line.id)")
            line = PetChatter.pick(C(hour: 9, open: 1, done: 1, overdue: 2), questions: false, recent: [], random: numbers([0.4, 0]))
            try expect(line.id == "d.over.0" && line.text == "지난 마감이 2개 있어요. 하나만 정리해 볼까요?", "overdue: \(line)")
            line = PetChatter.pick(C(hour: 10, open: 1, done: 0, firstOpen: "아주아주긴할일제목입니다요"), questions: false, recent: [], random: numbers([0, 0]))
            try expect(line.text == "‘아주아주긴할일제목입니다…’부터 시작해 볼까요?", "long titles shortened: \(line.text)")
            line = PetChatter.pick(C(hour: 10, open: 1, done: 0, firstOpen: "오늘 꼭 해야 할 일 정리하기"), questions: false, recent: [], random: numbers([0, 0]))
            try expect(line.text == "‘오늘 꼭 해야 할 일…’부터 시작해 볼까요?", "no space before …: \(line.text)")
            line = PetChatter.pick(C(hour: 14, open: 3, done: 2), questions: true, recent: [], random: numbers([0.99, 0.35]))
            try expect(line.id == "q.rest" && line.answers.first?.action == .rest5, "5분 쉬기 question: \(line.id)")
            // The day of the week: a Friday line, and on Friday the weekend question.
            line = PetChatter.pick(C(hour: 10, open: 3, done: 1, weekday: 5), questions: false, recent: [], random: numbers([0.74, 0.5]))
            try expect(line.id == "w.fri.1", "weekday line: \(line.id)")
            line = PetChatter.pick(C(hour: 16, open: 3, done: 1, weekday: 5), questions: true, recent: [], random: numbers([0.99, 0.99]))
            try expect(line.id == "q.weekend", "weekend question: \(line.id)")
            try expect(PetChatter.isQuietHour(23) && PetChatter.isQuietHour(6) && !PetChatter.isQuietHour(7) && !PetChatter.isQuietHour(22), "Quiet hours")
            try expect(PetChatter.nextDelay(.normal, random: { 0.5 }) == 2700, "45 minutes, give or take")
            try expect(PetChatter.petted(random: { 0.15 }).text == "골골골…" && PetChatter.petted(random: { 0.75 }).text == "냐앙~", "Patted")
            try expect(PetChatter.catalogueSize == 134, "Same catalogue as Windows: \(PetChatter.catalogueSize)")
        }

        try test("bubble lines break between sentences, after commas, never inside quotes (same cases as chatter.test.ts)") {
            let cases: [(String, String)] = [
                ("첫 번째 체크가 제일 어려워요. 할 수 있어요!", "첫 번째 체크가 제일 어려워요.\n할 수 있어요!"),
                ("벌써 3개 했어요! 좋아요.", "벌써 3개 했어요! 좋아요."),
                ("모니터에서 눈 떼고 먼 곳 한 번 보기!", "모니터에서 눈 떼고\n먼 곳 한 번 보기!"),
                ("‘오늘 꼭 해야 할 일…’부터 시작해 볼까요?", "‘오늘 꼭 해야 할 일…’부터\n시작해 볼까요?"),
                ("‘보고서 쓰기’, 생각보다 금방 끝날지도 몰라요.", "‘보고서 쓰기’,\n생각보다 금방 끝날지도 몰라요."),
                ("할 일이 없으면\n쉬는 것도 일이에요.", "할 일이 없으면\n쉬는 것도 일이에요."),
                ("냥.", "냥."),
            ]
            for (text, wrapped) in cases {
                try expect(BubbleText.wrap(text) == wrapped, "wrap(\(text.debugDescription)) gave \(BubbleText.wrap(text).debugDescription)")
            }
        }

        try test("timer sizes match the Windows app's") {
            try expect(TimerSize.allCases.map { "\($0.title) \($0.scale)" } == ["작게 0.8", "보통 1.0", "크게 1.25", "아주 크게 1.5"], "Timer sizes")
        }

        try test("오늘 일정: events on today's sheet (same cases as calendar.test.ts)") {
            func at(_ day: Int, _ hour: Int, _ minute: Int = 0, _ second: Int = 0) -> Date {
                seoul.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute, second: second))!
            }
            func one(_ id: String, _ title: String, _ day: Int, _ start: Int, _ end: Int, allDay: Bool = false, days: Int = 1) -> CalendarEvent {
                LocalEvent(id: id, title: title, date: String(format: "2026-10-%02d", day), allDay: allDay, days: days, start: start, end: end)
                    .occurrences(from: at(1, 0), to: at(20, 0), calendar: seoul).first!
            }
            let a = one("a", " 팀 회의 ", 7, 600, 660)
            let b = one("b", "치과", 7, 900, 960)
            let c = one("c", "생일", 7, 0, 0, allDay: true)
            let d = one("d", "출장", 5, 0, 0, allDay: true, days: 4)
            let e = one("e", "어제 저녁", 6, 1200, 1260)
            let f = one("f", "새벽 작업", 8, 120, 180)
            let g = one("g", "밤샘", 7, 180, 300)
            let i = one("i", "", 7, 720, 750)
            let late = one("j", "야간", 7, 1380, 360)
            let now = at(7, 9)
            try expect(a.title == "팀 회의" && !a.allDay && a.key == "local/a@2026-10-07" && a.color == "#5b8bd0" && a.canEdit, "1: \(a)")
            try expect(CalendarDay.timeLabel(a, now: now, calendar: seoul) == "10:00" && CalendarDay.status(a, now: now) == ("60분 뒤", .soon), "1 label/status")
            try expect(CalendarDay.timeLabel(b, now: now, calendar: seoul) == "15:00" && CalendarDay.status(b, now: now) == ("", .upcoming), "2")
            try expect(c.allDay && CalendarDay.timeLabel(c, now: now, calendar: seoul) == "종일" && CalendarDay.status(c, now: now) == ("", .allDay), "3")
            try expect(i.title == "(제목 없음)", "9")
            let today = CalendarDay.today([a, b, c, d, e, f, g, i, late], now: now, calendar: seoul)
            try expect(today.map(\.title) == ["생일", "출장", "밤샘", "팀 회의", "(제목 없음)", "치과", "야간", "새벽 작업"], "10: \(today.map(\.title))")
            try expect(!today.contains(e), "5: yesterday's evening is not today")
            try expect(CalendarDay.timeLabel(g, now: now, calendar: seoul) == "~05:00", "7")
            try expect(CalendarDay.timeLabel(late, now: now, calendar: seoul) == "23:00~", "13")
            try expect(CalendarDay.status(a, now: at(7, 10, 30)) == ("진행 중", .now) && CalendarDay.status(a, now: at(7, 11)) == ("끝남", .past), "11")
            try expect(CalendarDay.status(a, now: at(7, 9, 59, 30)) == ("1분 뒤", .soon), "11: rounds up")
            try expect(CalendarDay.dueAlerts([a, b, c], now: at(7, 9, 50), leadMinutes: 10, shownHere: []) == [a], "12: due")
            try expect(CalendarDay.dueAlerts([a, b, c], now: at(7, 9, 49), leadMinutes: 10, shownHere: []).isEmpty, "12: too early")
            try expect(CalendarDay.dueAlerts([a, b, c], now: at(7, 10), leadMinutes: 10, shownHere: []).isEmpty, "12: started")
            try expect(CalendarDay.dueAlerts([a], now: at(7, 9, 50), leadMinutes: 10, shownHere: [CalendarDay.alertKey(a)]).isEmpty, "12: shown here")
            try expect(CalendarDay.nextAlertTime([a, b, c], now: now, leadMinutes: 10, shownHere: []) == at(7, 9, 50), "12: next alert")
            try expect(CalendarDay.nextEvent([a, b, c, g], now: now, calendar: seoul) == a, "next event")
        }

        try test("종이냥 한마디 knows today's calendar (same cases as calendar.test.ts and chatter.test.ts)") {
            func at(_ hour: Int, _ minute: Int = 0, _ second: Int = 0) -> Date {
                seoul.date(from: DateComponents(year: 2026, month: 10, day: 7, hour: hour, minute: minute, second: second))!
            }
            func event(_ title: String, _ from: Date, _ to: Date, allDay: Bool = false) -> CalendarEvent {
                CalendarEvent(key: "c/\(title)", calendarId: "c", title: title, allDay: allDay, start: from, end: to, color: "#000000")
            }
            let events = [event("A", at(10), at(11)), event("B", at(13, 30), at(14, 30)), event("C", at(14), at(14, 3)),
                          event("D", at(14, 20), at(15)), event("E", at(18), at(19)), event("F", at(0), at(24), allDay: true)]
            var c = CalendarDay.chatter(events, now: at(14, 5), calendar: seoul)
            try expect(c == CalendarDay.Chatter(next: "D", nextIn: 15, now: "B", ended: "C", left: 2), "1: \(c)")
            c = CalendarDay.chatter(events, now: at(14, 5, 30), calendar: seoul)
            try expect(c.nextIn == 15, "2: rounds up")
            c = CalendarDay.chatter(events, now: at(14, 24), calendar: seoul)
            try expect(c.ended == nil && c.now == "B" && c.next == "E" && c.nextIn == 216 && c.left == 1, "3: \(c)")
            c = CalendarDay.chatter(events, now: at(11, 20), calendar: seoul)
            try expect(c.ended == "A" && c.now == nil, "4: 20 minutes still counts")
            c = CalendarDay.chatter(events, now: at(11, 21), calendar: seoul)
            try expect(c.ended == nil, "4: 21 minutes")
            c = CalendarDay.chatter([], now: at(14, 5), calendar: seoul)
            try expect(c == CalendarDay.Chatter(next: nil, nextIn: 0, now: nil, ended: nil, left: 0), "5: none")
            // The cat's lines: the next event within 30 minutes has its own group, and the questions follow it.
            let soon = PetChatter.Context(hour: 14, open: 2, done: 1, firstOpen: "보고서", weekday: 3, nextEvent: "팀 회의", nextIn: 12, eventsLeft: 2)
            let line = PetChatter.pick(soon, questions: false, recent: [], random: { 0.4 })
            try expect(line.id.hasPrefix("e.soon") && line.text.contains("팀 회의"), "6: \(line)")
            var asked = PetChatter.pick(soon, questions: true, recent: [], random: { 0.99 })
            try expect(asked.id == "q.ready" && asked.text == "곧 ‘팀 회의’ 시간이에요. 준비됐어요?", "7: \(asked)")
            let roomy = PetChatter.Context(hour: 14, open: 2, done: 1, weekday: 3, nextEvent: "팀 회의", nextIn: 50, eventsLeft: 1)
            asked = PetChatter.pick(roomy, questions: true, recent: ["q.mood", "q.water", "q.stretch", "q.first", "q.rest", "q.eyes", "q.walk", "q.music", "q.pet", "q.snack"], random: { 0.99 })
            try expect(asked.id == "q.focus" && asked.answers.first?.action == .focus25 && asked.text.hasPrefix("다음 일정까지 50분"), "8: \(asked)")
        }

        try test("일정: drafts and the app's own events (same cases as events.test.ts)") {
            func at(_ day: Int, _ hour: Int, _ minute: Int = 0, month: Int = 10, year: Int = 2026) -> Date {
                seoul.date(from: DateComponents(year: year, month: month, day: day, hour: hour, minute: minute))!
            }
            let now = at(7, 14, 5)
            // Drafts: the next slot, from a to-do, checks, lengths.
            func slot(_ date: Date) -> String { let s = CalendarDraft.nextSlot(date, calendar: seoul); return "\(s.date) \(s.minutes)" }
            try expect(slot(now) == "2026-10-07 870" && slot(at(7, 14, 25)) == "2026-10-07 900" && slot(at(7, 14)) == "2026-10-07 870"
                       && slot(at(7, 14, 20)) == "2026-10-07 870" && slot(at(7, 23, 55)) == "2026-10-08 30", "slot")
            func task(_ title: String, _ reminder: Date?, _ due: String?) -> CalendarDraft {
                CalendarDraft.forTask(title: title, reminderAt: reminder, dueDate: due, now: now, taskId: "T1", calendar: seoul)
            }
            var d = task("  보고서 쓰기 ", at(8, 15), nil)
            try expect(d == CalendarDraft(title: "보고서 쓰기", date: "2026-10-08", startMinutes: 900, endMinutes: 960, taskId: "T1"), "task: \(d)")
            d = task("x", nil, "2026-10-09")
            try expect(d.allDay && d.date == "2026-10-09" && d.days == 1, "task: deadline")
            d = task("x", nil, nil)
            try expect(!d.allDay && d.date == "2026-10-07" && d.startMinutes == 870 && d.endMinutes == 930, "task: next slot")
            d = task("x", at(7, 23, 30), nil)
            try expect(d.startMinutes == 1410 && d.endMinutes == 30 && d.lengthText == "1시간 · 다음 날" && d.span(calendar: seoul).end == at(8, 0, 30), "task: overnight")
            var v = CalendarDraft(title: "", date: "2026-10-07", startMinutes: 600, endMinutes: 630)
            try expect(v.problem == "제목을 적어 주세요", "check: title")
            v.title = "회의"; v.endMinutes = 600
            try expect(v.problem == "끝나는 시간이 시작과 같아요", "check: same")
            v.endMinutes = 630
            try expect(v.problem == nil, "check: ok")
            func length(_ from: Int, _ to: Int) -> String { CalendarDraft(title: "x", date: "2026-10-07", startMinutes: from, endMinutes: to).lengthText }
            try expect(length(600, 630) == "30분" && length(600, 690) == "1시간 30분" && length(600, 720) == "2시간"
                       && CalendarDraft(title: "x", date: "2026-10-07", allDay: true).lengthText == "하루"
                       && CalendarDraft(title: "x", date: "2026-10-07", allDay: true, days: 3).lengthText == "3일", "lengths")
            // 1–7: occurrences.
            func days(_ event: LocalEvent, _ from: Date, _ to: Date) -> [String] {
                event.occurrences(from: from, to: to, calendar: seoul).map { LocalEvent.occurrenceDay($0)! }
            }
            let weekly = LocalEvent(id: "E1", title: "회의", date: "2026-10-07", start: 600, end: 660, repeatRule: .weekly)
            let w = weekly.occurrences(from: at(1, 0), to: at(22, 0), calendar: seoul)
            try expect(w.map(\.start) == [at(7, 10), at(14, 10), at(21, 10)] && w[1].key == "local/E1@2026-10-14" && w[1].recurring
                       && w[1].color == "#5b8bd0" && w[1].eventId == "E1", "1: \(w.map(\.key))")
            try expect(days(LocalEvent(id: "E2", title: "월말", date: "2026-08-31", allDay: true, repeatRule: .monthly),
                            at(1, 0, month: 9), at(1, 0, month: 12)) == ["2026-10-31"], "2")
            try expect(days(LocalEvent(id: "E3", title: "생일", date: "2024-02-29", allDay: true, repeatRule: .yearly),
                            at(1, 0, month: 1, year: 2025), at(1, 0, month: 1, year: 2029)) == ["2028-02-29"], "3")
            try expect(days(LocalEvent(id: "E4", title: "운동", date: "2026-10-08", start: 540, end: 570, repeatRule: .daily, skip: ["2026-10-09"]),
                            at(8, 0), at(11, 0)) == ["2026-10-08", "2026-10-10"], "4")
            let night = LocalEvent(id: "E5", title: "야간", date: "2026-10-07", start: 1380, end: 60).occurrences(from: at(8, 0), to: at(9, 0), calendar: seoul)
            try expect(night.count == 1 && night[0].start == at(7, 23) && night[0].end == at(8, 1), "5")
            try expect(days(LocalEvent(id: "E6", title: "여행", date: "2026-10-10", allDay: true, days: 2, repeatRule: .weekly), at(11, 0), at(12, 0)) == ["2026-10-10"], "6")
            try expect(days(LocalEvent(id: "E7", title: "x", date: "2026-10-01", start: 600, end: 660), at(2, 0), at(3, 0)).isEmpty, "7")
            // 8: draft → event → draft, and unknown values read as none and blue.
            let draft = CalendarDraft(title: "회의", date: "2026-10-08", startMinutes: 900, endMinutes: 960, repeatRule: .weekly, color: .coral, location: "3층")
            let made = draft.event(id: "E8", now: now)
            try expect(CalendarDraft.forEvent(made) == draft && made.location == "3층" && made.createdAt == now, "8: round trip")
            let odd = try JSONDecoder.iso.decode(LocalEvent.self, from: Data(##"{"id":"x","title":"t","date":"2026-10-08","repeat":"hourly","color":"pink"}"##.utf8))
            try expect(odd.repeatRule == .none && odd.color == .blue && odd.days == 1, "8: unknown values")
            let file = LocalEvent.File(events: [made])
            try expect(try JSONDecoder.iso.decode(LocalEvent.File.self, from: JSONEncoder.iso.encode(file)) == file, "file round trip")
        }

        try test("백업: export, check, summary and merge (same cases as backup.test.ts)") {
            let todos = ##"{"items":[{"createdAt":"2026-10-07T01:00:00Z","id":"AAAAAAAA-0000-0000-0000-00000000000A","isCompleted":false,"title":"가"},{"createdAt":"2026-10-07T01:00:00Z","id":"AAAAAAAA-0000-0000-0000-00000000000B","isCompleted":false,"title":"나"}]}"##
            let memos = ##"{"memos":[{"createdAt":"2026-10-07T01:00:00Z","id":"M1","text":"메모","updatedAt":"2026-10-07T01:00:00Z"}]}"##
            let events = ##"{"events":[{"id":"E1","title":"a","date":"2026-10-07"},{"id":"E2","title":"b","date":"2026-10-08"},{"id":"E3","title":"c","date":"2026-10-09"}]}"##
            let line = { (id: String) in ##"{"completedAt":"2026-10-07T02:00:00Z","createdAt":"2026-10-07T01:00:00Z","id":""## + id + ##"","title":"끝"}"## }
            let files = ["todos.json": todos, "memos.json": memos, "events.json": events,
                         "archive/2026-10.jsonl": line("x") + "\n\n" + line("y") + "\n", "archive/2026-09.jsonl": line("w") + "\n"]
            // B1
            let text = Backup.make(files: files, exportedAt: Date(timeIntervalSince1970: 1_790_000_000), from: "macOS 1.31.0")
            let back = try Backup.parse(text)
            try expect(back.files == files && back.from == "macOS 1.31.0" && !back.exportedAt.isEmpty, "B1: round trip")
            for bad in [##"{"format":"x"}"##, "hello", ##"{"format":"jongi-nyang-backup","version":1,"files":[]}"##] {
                do { _ = try Backup.parse(bad); try expect(false, "B1: \(bad) accepted") } catch let problem as Backup.Problem {
                    try expect(problem.message == "종이냥 백업 파일이 아니에요.", "B1: \(bad)")
                }
            }
            do { _ = try Backup.parse(##"{"format":"jongi-nyang-backup","version":2,"files":{}}"##); try expect(false, "B1: newer accepted") } catch let problem as Backup.Problem {
                try expect(problem.message == "더 새 버전의 종이냥에서 만든 파일이에요. 종이냥을 업데이트해 주세요.", "B1: newer")
            }
            do { _ = try Backup.parse(Backup.make(files: ["todos.json": "{}"], exportedAt: Date(), from: "x")); try expect(false, "B1: bad todos") } catch let problem as Backup.Problem {
                try expect(problem.message == "백업 파일 안의 ‘todos.json’을 읽지 못했어요.", "B1: unreadable")
            }
            // B2
            try expect(Backup.summary(files).text == "할 일 2 · 메모 1 · 일정 3 · 완료 기록 3", "B2: \(Backup.summary(files).text)")
            try expect(Backup.summary([:]).text == "비어 있는 백업이에요.", "B2: empty")
            // B3
            let imported = ["todos.json": ##"{"items":[{"createdAt":"2026-10-07T01:00:00Z","id":"AAAAAAAA-0000-0000-0000-00000000000B","isCompleted":false,"title":"나2"},{"createdAt":"2026-10-07T01:00:00Z","id":"AAAAAAAA-0000-0000-0000-00000000000C","isCompleted":false,"title":"다"}]}"##,
                            "archive/2026-10.jsonl": line("y") + "\n" + line("z") + "\n", "archive/2026-08.jsonl": line("v") + "\n"]
            let merged = Backup.merge(current: files, imported: imported)
            let titles = try JSONDecoder.iso.decode(Notebook.self, from: Data(merged["todos.json"]!.utf8)).items.map(\.title)
            try expect(titles == ["가", "나", "다"], "B3: todos \(titles)")
            try expect(merged["archive/2026-10.jsonl"] == [line("x"), line("y"), line("z")].joined(separator: "\n") + "\n", "B3: archive")
            // B4
            try expect(merged["memos.json"] == memos && merged["events.json"] == events && merged["archive/2026-08.jsonl"] == line("v") + "\n"
                       && merged["archive/2026-09.jsonl"] == line("w") + "\n", "B4")
            try expect(Backup.summary(merged).text == "할 일 3 · 메모 1 · 일정 3 · 완료 기록 5", "B4: \(Backup.summary(merged).text)")
        }

        try test("백업: alarms.json goes along (same cases as backup.test.ts)") {
            let alarms = ##"{"alarms":[{"id":"A1","time":"07:00","days":[1,2,3,4,5]},{"id":"A2","time":"22:00"}]}"##
            let files = ["alarms.json": alarms, "events.json": ##"{"events":[{"id":"E1","title":"a","date":"2026-10-07"}]}"##]
            try expect(Backup.dataFiles.contains("alarms.json"), "a data file")
            try expect(try Backup.parse(Backup.make(files: files, exportedAt: Date(), from: "x")).files == files, "round trip")
            do { _ = try Backup.parse(Backup.make(files: ["alarms.json": ##"{"alarms":{}}"##], exportedAt: Date(), from: "x")); try expect(false, "bad alarms accepted") } catch let problem as Backup.Problem {
                try expect(problem == .unreadable("alarms.json"), "unreadable alarms")
            }
            try expect(Backup.summary(files).text == "일정 1 · 알람 2", "summary: \(Backup.summary(files).text)")
            try expect(Backup.summary(files).text(.en) == "1 event · 2 alarms" && Backup.summary(files).text(.nl) == "1 afspraak · 2 wekkers", "summary en nl")
            try expect(Backup.summary(["alarms.json": ##"{"alarms":[{"id":"A1","time":"07:00"}]}"##]).text(.en) == "1 alarm", "one alarm")
            try expect(Backup.summary(["alarms.json": ##"{"alarms":[{"id":"A1","time":"07:00"}]}"##]).text(.nl) == "1 wekker", "een wekker")
            let merged = Backup.merge(current: files, imported: ["alarms.json": ##"{"alarms":[{"id":"A2","time":"23:00"},{"id":"A3","time":"06:00"}]}"##])
            let ids = try Alarm.File.decode(Data(merged["alarms.json"]!.utf8)).alarms.map { "\($0.id) \($0.time)" }
            try expect(ids == ["A1 07:00", "A2 22:00", "A3 06:00"], "merge keeps what's here: \(ids)")
        }

        try test("달력: month and week pages (same cases as calendar.test.ts)") {
            func at(_ day: Int, _ hour: Int, _ minute: Int = 0, month: Int = 10) -> Date {
                seoul.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute))!
            }
            // 1
            var grid = CalendarMonth.monthGrid(year: 2026, month: 10, calendar: seoul)
            try expect(grid.count == 42 && grid.first == "2026-09-27" && grid.last == "2026-11-07", "1: \(grid.first!) \(grid.last!)")
            grid = CalendarMonth.monthGrid(year: 2026, month: 2, calendar: seoul)
            try expect(grid.first == "2026-02-01" && grid.last == "2026-03-14", "1: February")
            // 2
            let week = CalendarMonth.weekDays("2026-10-07", calendar: seoul)
            try expect(week.first == "2026-10-04" && week.last == "2026-10-10" && week.count == 7, "2")
            try expect(CalendarMonth.weekDays("2026-10-04", calendar: seoul) == week, "2: Sunday")
            let newYear = CalendarMonth.weekDays("2027-01-01", calendar: seoul)
            try expect(newYear.first == "2026-12-27" && newYear.last == "2027-01-02", "2: new year")
            // 3
            func event(_ title: String, _ start: Date, _ end: Date, allDay: Bool = false) -> CalendarEvent {
                CalendarEvent(key: "c/\(title)", calendarId: "c", title: title, allDay: allDay, start: start, end: end, color: "#000000")
            }
            let birthday = event("생일", at(7, 0), at(8, 0), allDay: true)
            let trip = event("출장", at(5, 0), at(9, 0), allDay: true)
            let meeting = event("회의", at(7, 10), at(7, 11))
            let night = event("야간", at(6, 23), at(7, 1))
            let late = event("늦은", at(7, 23, 30), at(8, 0, 30))
            let tomorrow = event("내일", at(8, 0), at(8, 1))
            let events = [birthday, trip, meeting, night, late, tomorrow]
            try expect(CalendarMonth.eventsOn("2026-10-07", events, calendar: seoul).map(\.title) == ["생일", "출장", "야간", "회의", "늦은"], "3")
            // 4
            func time(_ e: CalendarEvent) -> String { CalendarMonth.agendaTime(e, on: "2026-10-07", calendar: seoul) }
            try expect(time(birthday) == "종일" && time(meeting) == "10:00–11:00" && time(night) == "~01:00" && time(late) == "23:30~"
                       && time(event("길게", at(6, 20), at(8, 9))) == "종일" && time(event("순간", at(7, 12), at(7, 12))) == "12:00", "4")
            // 5
            func task(_ title: String, due: String? = nil, reminder: Date? = nil, done: Bool = false) -> TodoItem {
                var item = TodoItem(title: title, isCompleted: done, reminderAt: reminder)
                item.dueDate = due
                return item
            }
            let tasks = [task("A", due: "2026-10-07"), task("B", reminder: at(7, 15)), task("C", reminder: at(7, 9, 30)),
                         task("D", due: "2026-10-07", reminder: at(7, 8)), task("E", due: "2026-10-07", done: true), task("F", due: "2026-10-08")]
            let onDay = CalendarMonth.dayTasks("2026-10-07", tasks, calendar: seoul)
            try expect(onDay.map { "\($0.title) \($0.kind.rawValue) \($0.time ?? "-")" } == ["C reminder 09:30", "B reminder 15:00", "A deadline -", "D deadline -"], "5: \(onDay)")
            // 6
            let cell = CalendarMonth.cellItems("2026-10-07", events: events, tasks: tasks, calendar: seoul)
            try expect(cell.items == [.event(birthday), .event(trip), .event(night)] && cell.more == 4, "6: \(cell.more)")
            // 7
            try expect(CalendarMonth.monthTitle(year: 2026, month: 10) == "2026년 10월"
                       && CalendarMonth.weekTitle(week) == "10월 4일 – 10일"
                       && CalendarMonth.weekTitle(CalendarMonth.weekDays("2026-10-01", calendar: seoul)) == "9월 27일 – 10월 3일"
                       && CalendarMonth.weekTitle(newYear) == "2026년 12월 27일 – 2027년 1월 2일"
                       && CalendarMonth.dayTitle("2026-10-07", calendar: seoul) == "10월 7일 수요일", "7")
            // 8
                        var d = CalendarMonth.draftForDay("2026-10-07", now: at(7, 14, 5), calendar: seoul)
            try expect(d.date == "2026-10-07" && d.startMinutes == 870 && d.endMinutes == 930, "8: today")
            d = CalendarMonth.draftForDay("2026-10-09", now: at(7, 14, 5), calendar: seoul)
            try expect(d.date == "2026-10-09" && d.startMinutes == 540 && d.endMinutes == 600 && d.title.isEmpty && !d.allDay, "8: another day")
            d = CalendarMonth.draftForDay("2026-10-07", now: at(7, 23, 55), calendar: seoul)
            try expect(d.date == "2026-10-07" && d.startMinutes == 1260 && d.endMinutes == 1320, "8: late")
            // 9
            let range = CalendarMonth.fetchRange(CalendarMonth.monthGrid(year: 2026, month: 10, calendar: seoul), calendar: seoul)
            try expect(range.start == at(27, 0, month: 9) && range.end == at(8, 0, month: 11), "9")
        }

        try test("quick entry understands dates and times written into a task") {
            let now = local(10, 1, 10) // Thursday 10:00
            func parse(_ text: String) -> QuickParse { QuickParse.parse(text, now: now, calendar: seoul) }
            func key(_ date: Date?) -> String { date.map { Deadline.key($0, calendar: seoul) + String(format: " %02d:%02d", seoul.component(.hour, from: $0), seoul.component(.minute, from: $0)) } ?? "-" }
            var r = parse("내일 3시 회의")
            try expect(r.title == "회의" && key(r.reminderAt) == "2026-10-02 15:00" && r.summary == "내일 오후 3:00 알림", "내일 3시: \(r)")
            r = parse("금요일까지 보고서")
            try expect(r.title == "보고서" && r.dueDate == "2026-10-02" && r.summary == "10월 2일 (금)까지" && r.reminderAt == nil, "금요일까지: \(r)")
            r = parse("보고서 10/5까지")
            try expect(r.title == "보고서" && r.dueDate == "2026-10-05", "10/5까지: \(r)")
            r = parse("오후 2시 반 치과")
            try expect(r.title == "치과" && key(r.reminderAt) == "2026-10-01 14:30" && r.summary == "오늘 오후 2:30 알림", "2시 반: \(r)")
            r = parse("9시 운동")
            try expect(r.title == "운동" && key(r.reminderAt) == "2026-10-02 09:00", "9시: \(r)")
            r = parse("다음 주 월요일 회의 준비")
            try expect(r.title == "회의 준비" && r.dueDate == "2026-10-05", "다음 주 월요일: \(r)")
            r = parse("이번 주까지 정리")
            try expect(r.title == "정리" && r.dueDate == "2026-10-04", "이번 주까지: \(r)")
            r = parse("오후 3:30 회의")
            try expect(r.title == "회의" && key(r.reminderAt) == "2026-10-01 15:30", "오후 3:30: \(r)")
            r = parse("15:30 전화")
            try expect(r.title == "전화" && key(r.reminderAt) == "2026-10-01 15:30", "15:30: \(r)")
            r = parse("오늘 장보기")
            try expect(r.title == "장보기" && r.dueDate == nil && r.reminderAt == nil, "오늘: \(r)")
            r = parse("3월 1일 이사")
            try expect(r.title == "이사" && r.dueDate == "2027-03-01", "3월 1일: \(r)")
            r = parse("내일")
            try expect(r.title == "내일" && r.dueDate == nil && r.reminderAt == nil, "내일 alone: \(r)")
            r = parse("책 3권 읽기")
            try expect(r.title == "책 3권 읽기" && r.dueDate == nil && r.reminderAt == nil, "3권: \(r)")
        }

        // MARK: English and Dutch (the same cases as i18n.test.ts on Windows)

        try test("languages: the setting, the week start and dates written by hand") {
            try expect(AppLanguage.resolve(setting: "auto", preferred: ["nl-NL", "en"]) == .nl, "auto: Dutch first")
            try expect(AppLanguage.resolve(setting: "auto", preferred: ["fr-FR", "en-GB"]) == .en, "auto: the first known")
            try expect(AppLanguage.resolve(setting: "auto", preferred: ["de", "fr"]) == .en, "auto: English when none")
            try expect(AppLanguage.resolve(setting: nil, preferred: ["ko_KR"]) == .ko, "auto: underscore")
            try expect(AppLanguage.resolve(setting: "ko", preferred: ["nl"]) == .ko && AppLanguage.resolve(setting: "nl", preferred: []) == .nl, "chosen")
            try expect(!AppLanguage.ko.weekStartsMonday && !AppLanguage.en.weekStartsMonday && AppLanguage.nl.weekStartsMonday, "week start")
            try expect(AppLanguage.allCases.map(\.nativeName) == ["한국어", "English", "Nederlands"], "names")
            let thursday = local(10, 8)
            try expect(AppLanguage.allCases.map { $0.longDate(thursday, calendar: seoul) } == ["10월 8일 목요일", "Thursday, October 8", "donderdag 8 oktober"], "long date")
            try expect(AppLanguage.allCases.map { $0.shortDate(thursday, calendar: seoul) } == ["10월 8일 (목)", "Thu, Oct 8", "do 8 okt"], "short date")
            try expect(AppLanguage.en.shortDate(seoul.date(from: DateComponents(year: 2027, month: 1, day: 2))!, calendar: seoul, withYear: true) == "Sat, Jan 2, 2027", "short date, year")
            try expect(AppLanguage.allCases.map { $0.monthTitle(year: 2026, month: 10) } == ["2026년 10월", "October 2026", "oktober 2026"], "month title")
            try expect(AppLanguage.allCases.map { $0.clock(hour: 15, minute: 0) } == ["15:00", "3:00 PM", "15:00"], "clock")
            try expect(AppLanguage.en.clock(hour: 0, minute: 5) == "12:05 AM" && AppLanguage.en.clock(hour: 12, minute: 0) == "12:00 PM" && AppLanguage.nl.clock(hour: 9, minute: 5) == "09:05", "clock: midnight, noon")
            try expect(AppLanguage.allCases.map { $0.spokenTime(hour: 9, minute: 30) } == ["오전 9:30", "9:30 AM", "09:30"], "spoken time")
            try expect(AppLanguage.en.timeRange(from: (15, 0), to: (16, 0)) == "3:00–4:00 PM" && AppLanguage.en.timeRange(from: (11, 30), to: (12, 30)) == "11:30 AM–12:30 PM"
                       && AppLanguage.nl.timeRange(from: (11, 30), to: (12, 30)) == "11:30–12:30", "time range")
            try expect(AppLanguage.allCases.map { $0.minutesAway(5) } == ["5분 뒤", "in 5 min", "over 5 min"], "minutes away")
            try expect(AppLanguage.allCases.map { "\($0.days(1)) \($0.days(3)) \($0.todos(1)) \($0.todos(2))" }
                       == ["1일 3일 할 일 1개 할 일 2개", "1 day 3 days 1 to-do 2 to-dos", "1 dag 3 dagen 1 taak 2 taken"], "counts")
            try expect(AppLanguage.allCases.map { $0.weekdayShort(0) + $0.weekdayName(1) + $0.monthShort(3) + $0.monthName(5) } == ["일월요일3월5월", "SunMondayMarMay", "zomaandagmrtmei"], "names")
        }

        try test("calendar pages in English and Dutch: Monday weeks in Dutch, titles, times") {
            func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
                seoul.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
            }
            var grid = CalendarMonth.monthGrid(year: 2026, month: 10, calendar: seoul, language: .nl)
            try expect(grid.count == 42 && grid.first == "2026-09-28" && grid.last == "2026-11-08", "nl grid: \(grid.first!) \(grid.last!)")
            grid = CalendarMonth.monthGrid(year: 2026, month: 2, calendar: seoul, language: .nl)
            try expect(grid.first == "2026-01-26" && grid.last == "2026-03-08", "nl grid: February starts on a Sunday")
            try expect(CalendarMonth.monthGrid(year: 2026, month: 10, calendar: seoul, language: .en).first == "2026-09-27", "en grid: Sunday")
            let nlWeek = CalendarMonth.weekDays("2026-10-07", calendar: seoul, language: .nl)
            try expect(nlWeek.first == "2026-10-05" && nlWeek.last == "2026-10-11", "nl week")
            try expect(CalendarMonth.weekDays("2026-10-04", calendar: seoul, language: .nl).first == "2026-09-28", "nl week: Sunday ends it")
            try expect(CalendarMonth.weekDays("2026-10-05", calendar: seoul, language: .nl).first == "2026-10-05", "nl week: Monday starts it")
            try expect(CalendarMonth.weekDays("2026-10-07", calendar: seoul, language: .en).first == "2026-10-04", "en week")
            try expect(CalendarMonth.weekdayLabels(.ko) == ["일", "월", "화", "수", "목", "금", "토"] && CalendarMonth.weekdayLabels(.en) == ["S", "M", "T", "W", "T", "F", "S"]
                       && CalendarMonth.weekdayLabels(.nl) == ["ma", "di", "wo", "do", "vr", "za", "zo"], "weekday labels")
            let week = CalendarMonth.weekDays("2026-10-07", calendar: seoul), across = CalendarMonth.weekDays("2026-10-01", calendar: seoul)
            let newYear = CalendarMonth.weekDays("2027-01-01", calendar: seoul)
            try expect(CalendarMonth.monthTitle(year: 2026, month: 10, language: .en) == "October 2026" && CalendarMonth.monthTitle(year: 2026, month: 10, language: .nl) == "oktober 2026", "month titles")
            try expect([week, across, newYear].map { CalendarMonth.weekTitle($0, language: .en) } == ["Oct 4 – 10", "Sep 27 – Oct 3", "Dec 27, 2026 – Jan 2, 2027"], "en week titles")
            try expect([nlWeek, across, newYear].map { CalendarMonth.weekTitle($0, language: .nl) } == ["5 – 11 okt", "27 sep – 3 okt", "27 dec 2026 – 2 jan 2027"], "nl week titles")
            try expect(CalendarMonth.dayTitle("2026-10-07", calendar: seoul, language: .en) == "Wednesday, October 7"
                       && CalendarMonth.dayTitle("2026-10-07", calendar: seoul, language: .nl) == "woensdag 7 oktober", "day titles")
            func event(_ title: String, _ start: Date, _ end: Date, allDay: Bool = false) -> CalendarEvent {
                CalendarEvent(key: "c/\(title)", calendarId: "c", title: title, allDay: allDay, start: start, end: end, color: "#000000")
            }
            let birthday = event("생일", at(7, 0), at(8, 0), allDay: true), meeting = event("회의", at(7, 10), at(7, 11))
            let night = event("야간", at(6, 23), at(7, 1)), late = event("늦은", at(7, 23, 30), at(8, 0, 30))
            let moment = event("순간", at(7, 12), at(7, 12)), noon = event("점심", at(7, 11, 30), at(7, 12, 30))
            func time(_ e: CalendarEvent, _ language: AppLanguage) -> String { CalendarMonth.agendaTime(e, on: "2026-10-07", calendar: seoul, language: language) }
            try expect([birthday, meeting, night, late, moment, noon].map { time($0, .en) } == ["All day", "10:00–11:00 AM", "~1:00 AM", "11:30 PM~", "12:00 PM", "11:30 AM–12:30 PM"], "en agenda")
            try expect([birthday, meeting, night, late, moment, noon].map { time($0, .nl) } == ["Hele dag", "10:00–11:00", "~01:00", "23:30~", "12:00", "11:30–12:30"], "nl agenda")
            let tasks = [TodoItem(title: "B", reminderAt: at(7, 15)), TodoItem(title: "C", reminderAt: at(7, 9, 30))]
            try expect(CalendarMonth.dayTasks("2026-10-07", tasks, calendar: seoul, language: .en).map { $0.time ?? "-" } == ["9:30 AM", "3:00 PM"], "en task times")
            try expect(CalendarMonth.dayTasks("2026-10-07", tasks, calendar: seoul, language: .nl).map { $0.time ?? "-" } == ["09:30", "15:00"], "nl task times")
            // Today's strip.
            func one(_ id: String, _ title: String, _ day: Int, _ start: Int, _ end: Int, allDay: Bool = false, language: AppLanguage) -> CalendarEvent {
                LocalEvent(id: id, title: title, date: String(format: "2026-10-%02d", day), allDay: allDay, start: start, end: end)
                    .occurrences(from: at(1, 0), to: at(20, 0), calendar: seoul, language: language).first!
            }
            let a = one("a", "Standup", 7, 600, 660, language: .en), g = one("g", "Late shift", 7, 180, 300, language: .en)
            let j = one("j", "Night", 7, 1380, 360, language: .en), c = one("c", "Birthday", 7, 0, 0, allDay: true, language: .en)
            let now = at(7, 9)
            try expect([a, g, j, c].map { CalendarDay.timeLabel($0, now: now, calendar: seoul, language: .en) } == ["10:00 AM", "~5:00 AM", "11:00 PM~", "All day"], "en strip labels")
            try expect([a, g, j, c].map { CalendarDay.timeLabel($0, now: now, calendar: seoul, language: .nl) } == ["10:00", "~05:00", "23:00~", "Hele dag"], "nl strip labels")
            try expect(CalendarDay.status(a, now: now, language: .en) == ("in 60 min", .soon) && CalendarDay.status(a, now: now, language: .nl) == ("over 60 min", .soon), "soon")
            try expect(CalendarDay.status(a, now: at(7, 10, 30), language: .en) == ("Now", .now) && CalendarDay.status(a, now: at(7, 11), language: .en) == ("Over", .past), "en now/over")
            try expect(CalendarDay.status(a, now: at(7, 10, 30), language: .nl) == ("Nu", .now) && CalendarDay.status(a, now: at(7, 11), language: .nl) == ("Voorbij", .past), "nl now/over")
            try expect(one("i", " ", 7, 720, 750, language: .en).title == "(No title)" && one("i", "", 7, 720, 750, language: .nl).title == "(Geen titel)", "untitled")
        }

        try test("events, drafts, deadlines, repeats and the rest in English and Dutch") {
            // Drafts.
            var v = CalendarDraft(title: "", date: "2026-10-07", startMinutes: 600, endMinutes: 630)
            try expect(v.problem(.en) == "Give it a title" && v.problem(.nl) == "Geef het een titel", "check: title")
            v.title = "x"; v.endMinutes = 600
            try expect(v.problem(.en) == "It ends when it starts" && v.problem(.nl) == "Het eindigt wanneer het begint", "check: same")
            func length(_ from: Int, _ to: Int, _ language: AppLanguage) -> String { CalendarDraft(title: "x", date: "2026-10-07", startMinutes: from, endMinutes: to).lengthText(language) }
            try expect([(600, 630), (600, 660), (600, 690), (600, 720), (1410, 30)].map { length($0.0, $0.1, .en) } == ["30 min", "1 hour", "1 hour 30 min", "2 hours", "1 hour · next day"], "en lengths")
            try expect([(600, 630), (600, 660), (600, 690), (600, 720), (1410, 30)].map { length($0.0, $0.1, .nl) } == ["30 min", "1 uur", "1 uur 30 min", "2 uur", "1 uur · volgende dag"], "nl lengths")
            let allDay = CalendarDraft(title: "x", date: "2026-10-07", allDay: true), three = CalendarDraft(title: "x", date: "2026-10-07", allDay: true, days: 3)
            try expect([allDay, three].map { $0.lengthText(.en) } == ["1 day", "3 days"] && [allDay, three].map { $0.lengthText(.nl) } == ["1 dag", "3 dagen"], "all-day lengths")
            // The event sheet's names.
            try expect(LocalEvent.Repeat.allCases.map { $0.title(.en) } == ["Never", "Every day", "Every week", "Every month", "Every year"], "en repeats")
            try expect(LocalEvent.Repeat.allCases.map { $0.title(.nl) } == ["Nooit", "Elke dag", "Elke week", "Elke maand", "Elk jaar"], "nl repeats")
            try expect(LocalEvent.Color.allCases.map { $0.title(.en) } == ["Blue", "Green", "Orange", "Purple", "Yellow", "Gray"], "en colours")
            try expect(LocalEvent.Color.allCases.map { $0.title(.nl) } == ["Blauw", "Groen", "Oranje", "Paars", "Geel", "Grijs"], "nl colours")
            // Deadlines, from Thursday 1 October.
            let now = local(10, 1, 10)
            func dday(_ key: String, _ language: AppLanguage) -> String { Deadline.label(key, style: .dday, now: now, calendar: seoul, language: language) }
            func date(_ key: String, _ language: AppLanguage) -> String { Deadline.label(key, style: .date, now: now, calendar: seoul, language: language) }
            let keys = ["2026-10-04", "2026-10-02", "2026-10-01", "2026-09-30", "2026-09-28"]
            try expect(keys.map { dday($0, .ko) } == ["D-3", "D-1", "D-day", "D+1", "D+3"], "ko d-day")
            try expect(keys.map { dday($0, .en) } == ["3 days left", "1 day left", "due today", "1 day late", "3 days late"], "en d-day")
            try expect(keys.map { dday($0, .nl) } == ["nog 3 dagen", "nog 1 dag", "vandaag", "1 dag te laat", "3 dagen te laat"], "nl d-day")
            let dates = ["2026-10-01", "2026-10-02", "2026-10-04", "2026-10-31", "2027-01-02"]
            try expect(dates.map { date($0, .en) } == ["by today", "by tomorrow", "by Sun", "by Oct 31", "by Jan 2, 2027"], "en dates: \(dates.map { date($0, .en) })")
            try expect(dates.map { date($0, .nl) } == ["tot vandaag", "tot morgen", "tot zo", "tot 31 okt", "tot 2 jan 2027"], "nl dates")
            try expect(["2026-10-04", "2026-10-01", "2026-09-30"].map { Deadline.sentence($0, now: now, calendar: seoul, language: .en) }
                       == ["Due Sun, Oct 4 · 3 days left", "Due Thu, Oct 1 · today", "Due Wed, Sep 30 · 1 day late"], "en sentences")
            try expect(["2026-10-04", "2026-10-01", "2026-09-30"].map { Deadline.sentence($0, now: now, calendar: seoul, language: .nl) }
                       == ["Deadline zo 4 okt · nog 3 dagen", "Deadline do 1 okt · vandaag", "Deadline wo 30 sep · 1 dag te laat"], "nl sentences")
            try expect(Deadline.sentence("2026-10-04", now: now, calendar: seoul) == "10월 4일 (일)까지 · 3일 남음", "ko sentence")
            try expect(DueStyle.allCases.map { $0.title(.en) } == ["Countdown", "Date"] && DueStyle.allCases.map { $0.title(.nl) } == ["Aftellen", "Datum"], "due styles")
            try expect([DeadlineChoice.today, .thisWeek, .thisMonth, .date(now)].map { $0.title(.en) } == ["Today", "This week", "This month", "Pick a date"]
                       && [DeadlineChoice.today, .thisWeek, .thisMonth, .date(now)].map { $0.title(.nl) } == ["Vandaag", "Deze week", "Deze maand", "Datum kiezen"], "deadline choices")
            // Repeats.
            func describe(_ rule: RepeatRule, _ at: String? = nil, _ language: AppLanguage) -> String { Repeat.describe(rule, remindAt: at, language: language) }
            try expect(RepeatKind.allCases.map { $0.title(.en) } == ["Every day", "Weekdays", "Every week", "Every month"]
                       && RepeatKind.allCases.map { $0.title(.nl) } == ["Elke dag", "Werkdagen", "Elke week", "Elke maand"], "repeat kinds")
            try expect(describe(RepeatRule(kind: .weekly, weekdays: [3, 1]), nil, .en) == "Every Mon, Wed" && describe(RepeatRule(kind: .weekly, weekdays: [3, 1]), nil, .nl) == "Elke ma, wo", "weekly")
            try expect(describe(RepeatRule(kind: .weekly, weekdays: [0, 1, 2, 3, 4, 5, 6]), nil, .en) == "Every day" && describe(RepeatRule(kind: .weekly, weekdays: [0, 6]), nil, .en) == "Every Sat, Sun", "weekly: all, weekend")
            try expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 31].map { describe(RepeatRule(kind: .monthly, monthDay: $0), nil, .en) }.joined(separator: "|")
                       == ["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "23rd", "31st"].map { "Every month on the \($0)" }.joined(separator: "|"), "ordinals")
            try expect(describe(RepeatRule(kind: .monthly, monthDay: 15), nil, .nl) == "Elke maand op de 15e", "nl monthly")
            try expect(describe(RepeatRule(kind: .daily), "09:00", .en) == "Every day · reminder at 9:00 AM" && describe(RepeatRule(kind: .weekdays), "21:30", .en) == "Weekdays · reminder at 9:30 PM", "en alerts")
            try expect(describe(RepeatRule(kind: .daily), "09:00", .nl) == "Elke dag · herinnering om 09:00" && describe(RepeatRule(kind: .daily), "09:00", .ko) == "매일 · 오전 9:00 알림", "nl alerts")
            // Shelves, sizes, the record, the timer.
            try expect(Shelf.Group.allCases.map { $0.title(.en) } == ["This week", "This month", "After that"] && Shelf.Group.allCases.map { $0.title(.nl) } == ["Deze week", "Deze maand", "Daarna"], "shelves")
            try expect(TimerSize.allCases.map { $0.title(.en) } == ["Small", "Regular", "Large", "Extra large"] && TimerSize.allCases.map { $0.title(.nl) } == ["Klein", "Normaal", "Groot", "Extra groot"], "timer sizes")
            try expect([ArchiveAfterDays.nextDay, .threeDays, .week, .never].map { $0.title(.en) } == ["Next day", "After 3 days", "After 7 days", "Never"]
                       && [ArchiveAfterDays.nextDay, .threeDays, .week, .never].map { $0.title(.nl) } == ["Volgende dag", "Na 3 dagen", "Na 7 dagen", "Nooit"], "archive choices")
            try expect(Archive.heatLevelTitles(.en) == ["None", "1", "2–3", "4–5", "6 or more"] && Archive.heatLevelTitles(.nl) == ["Geen", "1", "2–3", "4–5", "6 of meer"] && Archive.heatLevelTitles(.ko) == Archive.heatLevelTitles, "heat levels")
            try expect(Archive.lookBackMessage(5) == "이번 주 5개 끝냈어요. 수고했어요!" && Archive.lookBackMessage(1, language: .en) == "You finished 1 to-do this week. Nice work!"
                       && Archive.lookBackMessage(5, language: .en) == "You finished 5 to-dos this week. Nice work!"
                       && Archive.lookBackMessage(1, language: .nl) == "Je hebt deze week 1 taak afgerond. Goed gedaan!"
                       && Archive.lookBackMessage(5, language: .nl) == "Je hebt deze week 5 taken afgerond. Goed gedaan!", "look-back")
            let start = Date(timeIntervalSince1970: 1_700_000_000)
            let focus = FocusTimer.pomodoro(PomodoroSettings(), now: start), rest = focus.next(at: start)!
            var long = focus
            for _ in 0..<7 { long = long.next(at: start)! }
            try expect([focus, rest, long, FocusTimer.countdown(minutes: 5, now: start)].map { $0.caption(.en) } == ["Focus 1/4", "Break", "Long break", "Timer"], "en captions: \(long.phase)")
            try expect([focus, rest, long, FocusTimer.countdown(minutes: 5, now: start)].map { $0.caption(.nl) } == ["Focus 1/4", "Pauze", "Lange pauze", "Timer"], "nl captions")
            try expect(focus.phaseName() == "집중" && focus.phaseName(.en) == "Focus" && rest.phaseName(.nl) == "Pauze" && focus.caption == "집중 1/4", "phase names")
            try expect(Memo(text: " \n").title(.en) == "Empty note" && Memo(text: "").title(.nl) == "Lege notitie" && Memo(text: "Boodschappen\nmelk").title(.nl) == "Boodschappen", "memo titles")
            try expect(PetChatter.Frequency.allCases.map { $0.title(.en) } == ["Rarely", "Sometimes", "Often"] && PetChatter.Frequency.allCases.map { $0.title(.nl) } == ["Zelden", "Soms", "Vaak"], "chatter frequency")
        }

        try test("백업 in English and Dutch (same cases as i18n.test.ts)") {
            for (language, expected) in [(AppLanguage.en, ["This isn’t a Jongi-nyang backup file.", "This file comes from a newer version of Jongi-nyang. Please update Jongi-nyang.", "Couldn’t read ‘todos.json’ in the backup file."]),
                                         (.nl, ["Dit is geen back-upbestand van Jongi-nyang.", "Dit bestand komt uit een nieuwere versie van Jongi-nyang. Werk Jongi-nyang bij.", "Kon ‘todos.json’ in het back-upbestand niet lezen."])] {
                try expect([Backup.Problem.notBackup, .newer, .unreadable("todos.json")].map { $0.message(language) } == expected, "\(language) messages")
            }
            var summary = Backup.Summary()
            summary.todos = 2; summary.memos = 1; summary.events = 3; summary.archive = 3
            try expect(summary.text(.en) == "2 to-dos · 1 note · 3 events · 3 in history", "en summary: \(summary.text(.en))")
            try expect(summary.text(.nl) == "2 taken · 1 notitie · 3 afspraken · 3 in geschiedenis", "nl summary")
            summary.todos = 1; summary.memos = 2; summary.repeats = 1; summary.events = 1; summary.archive = 1
            try expect(summary.text(.en) == "1 to-do · 2 notes · 1 repeating to-do · 1 event · 1 in history", "en singular")
            try expect(summary.text(.nl) == "1 taak · 2 notities · 1 herhalende taak · 1 afspraak · 1 in geschiedenis", "nl singular")
            summary.repeats = 2
            try expect(summary.text(.en).contains("2 repeating to-dos") && summary.text(.nl).contains("2 herhalende taken") && summary.text == "할 일 1 · 메모 2 · 반복 2 · 일정 1 · 완료 기록 1", "plural repeats")
            try expect(Backup.Summary().text(.en) == "This backup is empty." && Backup.Summary().text(.nl) == "Deze back-up is leeg.", "empty")
            try expect(AppLanguage.allCases.map { Backup.fileName(local(10, 8), calendar: seoul, language: $0) }
                       == ["종이냥-백업-2026-10-08.jongi", "Jongi-nyang-backup-2026-10-08.jongi", "Jongi-nyang-back-up-2026-10-08.jongi"], "file names")
            let stamp = ISO8601DateFormatter().string(from: local(10, 8, 14, 30))
            try expect(AppLanguage.allCases.map { Backup.exportedText(stamp, calendar: seoul, language: $0) ?? "-" } == ["10월 8일 14:30", "Oct 8, 2:30 PM", "8 okt 14:30"], "exported")
            try expect(Backup.exportedText("soon", calendar: seoul) == nil, "unreadable time")
        }

        try test("quick entry in English and Dutch (same cases as i18n.test.ts)") {
            let now = local(10, 1, 10) // Thursday 10:00
            func show(_ date: Date?) -> String {
                date.map { Deadline.key($0, calendar: seoul) + String(format: " %02d:%02d", seoul.component(.hour, from: $0), seoul.component(.minute, from: $0)) } ?? "-"
            }
            let cases: [(AppLanguage, String, String, String, String, String)] = [
                (.en, "call mom tomorrow 3pm", "call mom", "2026-10-02 15:00", "-", "Reminder tomorrow at 3:00 PM"),
                (.en, "report by friday", "report", "-", "2026-10-02", "Due Fri, Oct 2"),
                (.en, "dentist at 3", "dentist", "2026-10-01 15:00", "-", "Reminder today at 3:00 PM"),
                (.en, "gym 9am", "gym", "2026-10-02 09:00", "-", "Reminder tomorrow at 9:00 AM"),
                (.en, "pay rent oct 12", "pay rent", "-", "2026-10-12", "Due Mon, Oct 12"),
                (.en, "trip 12 oct", "trip", "-", "2026-10-12", "Due Mon, Oct 12"),
                (.en, "taxes 10/15", "taxes", "-", "2026-10-15", "Due Thu, Oct 15"),
                (.en, "standup in 30 min", "standup", "2026-10-01 10:30", "-", "Reminder today at 10:30 AM"),
                (.en, "laundry in 2 hours", "laundry", "2026-10-01 12:00", "-", "Reminder today at 12:00 PM"),
                (.en, "review in an hour", "review", "2026-10-01 11:00", "-", "Reminder today at 11:00 AM"),
                (.en, "lunch with Sam at noon", "lunch with Sam", "2026-10-01 12:00", "-", "Reminder today at 12:00 PM"),
                (.en, "movie tonight", "movie", "2026-10-01 20:00", "-", "Reminder today at 8:00 PM"),
                (.en, "movie tonight at 9", "movie", "2026-10-01 21:00", "-", "Reminder today at 9:00 PM"),
                (.en, "cleanup this week", "cleanup", "-", "2026-10-04", "Due Sun, Oct 4"),
                (.en, "Party next week", "Party", "-", "2026-10-11", "Due Sun, Oct 11"),
                (.en, "invoice end of month", "invoice", "-", "2026-10-31", "Due Sat, Oct 31"),
                (.en, "plan next friday", "plan", "-", "2026-10-09", "Due Fri, Oct 9"),
                (.en, "plan on monday", "plan", "-", "2026-10-05", "Due Mon, Oct 5"),
                (.en, "buy milk today", "buy milk", "-", "-", "-"),
                (.en, "finish by today", "finish", "-", "2026-10-01", "Due Thu, Oct 1"),
                (.en, "read 3 books", "read 3 books", "-", "-", "-"),
                (.en, "tomorrow", "tomorrow", "-", "-", "-"),
                (.en, "meeting 15:30", "meeting", "2026-10-01 15:30", "-", "Reminder today at 3:30 PM"),
                (.en, "call 3:30pm", "call", "2026-10-01 15:30", "-", "Reminder today at 3:30 PM"),
                (.en, "dinner day after tomorrow", "dinner", "-", "2026-10-03", "Due Sat, Oct 3"),
                (.en, "Doctor appointment Tuesday at 4:30", "Doctor appointment", "2026-10-06 16:30", "-", "Reminder Tue, Oct 6 at 4:30 PM"),
                (.en, "Pay bills due Oct 20th", "Pay bills", "-", "2026-10-20", "Due Tue, Oct 20"),
                (.en, "send card before 12/25", "send card", "-", "2026-12-25", "Due Fri, Dec 25"),
                (.en, "Wed standup at 11:30am", "standup", "2026-10-07 11:30", "-", "Reminder Wed, Oct 7 at 11:30 AM"),
                (.en, "call at 7 o'clock", "call", "2026-10-02 07:00", "-", "Reminder tomorrow at 7:00 AM"),
                (.en, "sun cream", "sun cream", "-", "-", "-"),
                (.en, "회의 내일 3시", "회의", "2026-10-02 15:00", "-", "Reminder tomorrow at 3:00 PM"),
                (.nl, "mama bellen morgen om 3 uur", "mama bellen", "2026-10-02 15:00", "-", "Herinnering morgen om 15:00"),
                (.nl, "verslag tot vrijdag", "verslag", "-", "2026-10-02", "Deadline vr 2 okt"),
                (.nl, "vr presentatie", "presentatie", "-", "2026-10-02", "Deadline vr 2 okt"),
                (.nl, "tandarts om 15:00", "tandarts", "2026-10-01 15:00", "-", "Herinnering vandaag om 15:00"),
                (.nl, "sporten 9u", "sporten", "2026-10-02 09:00", "-", "Herinnering morgen om 09:00"),
                (.nl, "bellen 14u30", "bellen", "2026-10-01 14:30", "-", "Herinnering vandaag om 14:30"),
                (.nl, "huur 12 okt", "huur", "-", "2026-10-12", "Deadline ma 12 okt"),
                (.nl, "belasting 15/10", "belasting", "-", "2026-10-15", "Deadline do 15 okt"),
                (.nl, "cadeau voor 5 december", "cadeau", "-", "2026-12-05", "Deadline za 5 dec"),
                (.nl, "vergadering over 30 min", "vergadering", "2026-10-01 10:30", "-", "Herinnering vandaag om 10:30"),
                (.nl, "wassen over 2 uur", "wassen", "2026-10-01 12:00", "-", "Herinnering vandaag om 12:00"),
                (.nl, "kapper over een kwartier", "kapper", "2026-10-01 10:15", "-", "Herinnering vandaag om 10:15"),
                (.nl, "film vanavond", "film", "2026-10-01 20:00", "-", "Herinnering vandaag om 20:00"),
                (.nl, "film vanavond om 9 uur", "film", "2026-10-01 21:00", "-", "Herinnering vandaag om 21:00"),
                (.nl, "opruimen deze week", "opruimen", "-", "2026-10-04", "Deadline zo 4 okt"),
                (.nl, "factuur eind van de maand", "factuur", "-", "2026-10-31", "Deadline za 31 okt"),
                (.nl, "plannen volgende vrijdag", "plannen", "-", "2026-10-09", "Deadline vr 9 okt"),
                (.nl, "etentje overmorgen", "etentje", "-", "2026-10-03", "Deadline za 3 okt"),
                (.nl, "boodschappen vandaag", "boodschappen", "-", "-", "-"),
                (.nl, "afronden uiterlijk vandaag", "afronden", "-", "2026-10-01", "Deadline do 1 okt"),
                (.nl, "lunch om 12 uur ’s middags", "lunch", "2026-10-01 12:00", "-", "Herinnering vandaag om 12:00"),
                (.nl, "bellen 's middags om 2 uur", "bellen", "2026-10-01 14:00", "-", "Herinnering vandaag om 14:00"),
                (.nl, "afspraak op dinsdag om 4:30", "afspraak", "2026-10-06 16:30", "-", "Herinnering di 6 okt om 16:30"),
                (.nl, "3 boeken lezen", "3 boeken lezen", "-", "-", "-"),
                (.nl, "2 uur werk", "2 uur werk", "-", "-", "-"),
                (.nl, "zo doen", "zo doen", "-", "-", "-"),
                (.nl, "feest 3/25", "feest 3/25", "-", "-", "-"),
                (.nl, "회의 내일 3시", "회의", "2026-10-02 15:00", "-", "Herinnering morgen om 15:00"),
                (.ko, "taxes 10/15", "taxes", "-", "2026-10-15", "10월 15일 (목)까지"),
                (.ko, "call mom tomorrow 3pm", "call mom tomorrow 3pm", "-", "-", "-"),
            ]
            for (language, text, title, alert, due, summary) in cases {
                let r = QuickParse.parse(text, now: now, calendar: seoul, language: language)
                let got = "\(r.title) | \(show(r.reminderAt)) | \(r.dueDate ?? "-") | \(r.summary ?? "-")"
                try expect(got == "\(title) | \(alert) | \(due) | \(summary)", "\(language) \(text.debugDescription): \(got)")
            }
        }

        try test("종이냥 한마디 in English and Dutch: the same line ids, the language's words (same cases as i18n.test.ts)") {
            func numbers(_ values: [Double]) -> () -> Double {
                var queue = values
                return { queue.isEmpty ? 0 : queue.removeFirst() }
            }
            typealias C = PetChatter.Context
            func pick(_ c: C, _ questions: Bool, _ recent: [String], _ values: [Double], _ language: AppLanguage) -> PetChatter.Line {
                PetChatter.pick(c, questions: questions, recent: recent, language: language, random: numbers(values))
            }
            let start = C(hour: 10, open: 3, done: 0, firstOpen: "Write report")
            try expect(pick(start, false, [], [0, 0], .en).text == "Shall we start with ‘Write report’?" && pick(start, false, [], [0, 0], .en).id == "p.start.0", "en start")
            try expect(pick(start, false, [], [0, 0], .nl).text == "Zullen we beginnen met ‘Write report’?", "nl start")
            var line = pick(C(hour: 12, open: 2, done: 2, firstOpen: "Groceries"), true, [], [0.99, 0.35], .en)
            try expect(line.id == "q.first" && line.text == "Do ‘Groceries’ now?" && line.answers.map(\.label) == ["I’ll try", "Later"], "en question: \(line)")
            line = pick(C(hour: 12, open: 2, done: 2, firstOpen: "Boodschappen"), true, [], [0.99, 0.35], .nl)
            try expect(line.id == "q.first" && line.text == "Nu ‘Boodschappen’ doen?" && line.answers.map(\.label) == ["Ik probeer het", "Straks"] && line.answers.map(\.pose) == [.cheer, .blink], "nl question")
            try expect(pick(C(hour: 9, open: 1, done: 1, overdue: 2), false, [], [0.4, 0], .en).text == "2 past due. Shall we sort out one?", "en overdue")
            try expect(pick(C(hour: 9, open: 1, done: 1, overdue: 2), false, [], [0.4, 0], .nl).text == "2 over de deadline. Zullen we er één oppakken?", "nl overdue")
            try expect(pick(C(hour: 10, open: 1, done: 0, firstOpen: "Clean out the garage this weekend"), false, [], [0, 0], .en).text == "Shall we start with ‘Clean out the garage…’?", "en: names cut at 20")
            try expect(pick(C(hour: 10, open: 1, done: 0), false, [], [0, 0], .en).text == "Shall we start with ‘first to-do’?" && pick(C(hour: 10, open: 1, done: 0), false, [], [0, 0], .nl).text == "Zullen we beginnen met ‘eerste taak’?", "fallbacks")
            line = pick(C(hour: 14, open: 3, done: 2), true, [], [0.99, 0.35], .nl)
            try expect(line.id == "q.rest" && line.answers.first?.action == .rest5 && line.answers.first?.reply == "Fijn! Ik zet een timer van 5 minuten.", "nl rest question")
            let roomy = C(hour: 14, open: 2, done: 1, weekday: 3, nextEvent: "Team meeting", nextIn: 50, eventsLeft: 1)
            line = pick(roomy, true, ["q.mood", "q.water", "q.stretch", "q.first", "q.rest", "q.eyes", "q.walk", "q.music", "q.pet", "q.snack"], [0.99, 0.99], .en)
            try expect(line.id == "q.focus" && line.text == "50 min until your next event.\nFocus for 25 minutes?" && line.answers.first?.action == .focus25, "en focus question: \(line)")
            try expect(PetChatter.petted(language: .en, random: { 0.15 }).text == "Purrrr…" && PetChatter.petted(language: .nl, random: { 0.75 }).text == "Mrauw~"
                       && PetChatter.petted(language: .en, random: { 0.75 }).id == PetChatter.petted(random: { 0.75 }).id, "petted")
            // Every pick has the same id in every language, with every placeholder filled.
            let contexts = [C(hour: 8, open: 0, done: 0), C(hour: 12, open: 0, done: 3), C(hour: 15, open: 4, done: 0, firstOpen: "Write report"),
                            C(hour: 19, open: 1, done: 2, overdue: 1, firstOpen: "Call Mia", weekday: 1), C(hour: 21, open: 2, done: 1, dueSoon: 2, weekday: 5),
                            C(hour: 10, open: 2, done: 1, weekday: 0, nextEvent: "Standup", nextIn: 12, eventsLeft: 3),
                            C(hour: 16, open: 3, done: 0, weekday: 3, nextEvent: "Review", nextIn: 90, nowEvent: "Lunch", eventsLeft: 2),
                            C(hour: 13, open: 1, done: 1, weekday: 6, endedEvent: "Dentist")]
            var checked = 0
            for c in contexts {
                for a in stride(from: 0.0, to: 1.0, by: 0.07) {
                    for b in stride(from: 0.0, to: 1.0, by: 0.13) {
                        let lines = AppLanguage.allCases.map { pick(c, true, [], [a, b], $0) }
                        try expect(Set(lines.map(\.id)).count == 1 && lines.map { $0.answers.count }.allSatisfy({ $0 == lines[0].answers.count }), "ids: \(lines.map(\.id))")
                        for other in lines.dropFirst() {
                            try expect(!other.text.contains("{") && other.text.range(of: "[가-힣]", options: .regularExpression) == nil, "\(other.id): \(other.text)")
                            try expect(other.answers.map(\.pose) == lines[0].answers.map(\.pose) && other.answers.map(\.action) == lines[0].answers.map(\.action), "\(other.id): answers")
                        }
                        checked += 1
                    }
                }
            }
            try expect(checked == 960, "picks checked: \(checked)")
        }

        try test("bubble lines in English and Dutch break at spaces, never inside words or quotes (same cases as i18n.test.ts)") {
            let cases: [(AppLanguage, String, String)] = [
                (.en, "The first check is the hardest. You’ve got this!", "The first check\nis the hardest.\nYou’ve got this!"),
                (.en, "Shall we start with ‘Clean out the garage…’?", "Shall we start with\n‘Clean out the garage…’?"),
                (.en, "‘Write report’ might go quicker than you think.", "‘Write report’ might go\nquicker than you think."),
                (.en, "Catch your breath, then ‘Write report’?", "Catch your breath,\nthen ‘Write report’?"),
                (.en, "I’m right here. Call me if you need me.", "I’m right here.\nCall me if you need me."),
                (.en, "Meow.", "Meow."),
                (.en, "Afternoon sun is perfect for a nap… oh right, work.", "Afternoon sun is\nperfect for a nap…\noh right, work."),
                (.en, "Nothing to do?\nResting counts too.", "Nothing to do?\nResting counts too."),
                (.en, "Is ‘Weekly design review…’ over? Good job!", "Is ‘Weekly design review…’\nover? Good job!"),
                (.en, "Write tomorrow’s to-dos now and the morning gets easier.", "Write tomorrow’s to-dos now\nand the morning gets easier."),
                (.nl, "Het eerste vinkje is het moeilijkst. Jij kunt het!", "Het eerste vinkje\nis het moeilijkst.\nJij kunt het!"),
                (.nl, "’s Middags word je slaperig. Even rekken!", "’s Middags word je slaperig.\nEven rekken!"),
                (.nl, "Even op adem komen, dan ‘Verslag schrijven’?", "Even op adem komen,\ndan ‘Verslag schrijven’?"),
                (.nl, "Zullen we beginnen met ‘Garage opruimen dit wee…’?", "Zullen we beginnen met\n‘Garage opruimen dit wee…’?"),
                (.nl, "Je bent ‘Teamoverleg’ toch niet vergeten? Ik onthoud het.", "Je bent ‘Teamoverleg’\ntoch niet vergeten?\nIk onthoud het."),
                (.nl, "Dat je vandaag al zo ver bent, knap hoor.", "Dat je vandaag al zo\nver bent, knap hoor."),
                (.ko, "첫 번째 체크가 제일 어려워요. 할 수 있어요!", "첫 번째 체크가 제일 어려워요.\n할 수 있어요!"),
            ]
            for (language, text, wrapped) in cases {
                let got = BubbleText.wrap(text, language: language)
                try expect(got == wrapped, "wrap(\(text.debugDescription), \(language)) gave \(got.debugDescription)")
            }
        }

        print("\n\(count) checks passed.")
    }
}

private extension JSONDecoder {
    static var iso: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

private extension JSONEncoder {
    static var iso: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
