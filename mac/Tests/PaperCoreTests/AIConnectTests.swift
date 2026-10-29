import Foundation

// 종이냥 for Claude (AIConnect.swift, Notebook.adopt): the log, its texts, undo (M13 · M14 · partial), the away
// notice (M15), marks, "seen until", trimming, and ⌘Z keeping Claude's work. Framework-free like the other core tests.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    try expect(actual == expected, "\(name): expected \(expected), got \(actual)")
}

@main
private enum AIConnectTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        var seoul = Calendar(identifier: .gregorian)
        seoul.timeZone = TimeZone(identifier: "Asia/Seoul")!
        func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
            seoul.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
        }
        func iso(_ date: Date) -> String { AIConnect.isoText(date) }
        let taskA = "6F1C2B9A-1111-4A4A-9A9A-000000000001"
        let taskB = "6f1c2b9a-1111-4a4a-9a9a-000000000002" // the Windows app may write lower case
        func todo(_ id: String, _ title: String, start: String? = nil, end: String? = nil, done: Bool = false, extra: String = "") -> String {
            var fields = ["\"id\":\"\(id)\"", "\"title\":\"\(title)\"", "\"isCompleted\":\(done)", "\"createdAt\":\"2026-10-27T05:12:03Z\""]
            if let start { fields.append("\"timeStart\":\"\(start)\"") }
            if let end { fields.append("\"timeEnd\":\"\(end)\"") }
            if !extra.isEmpty { fields.append(extra) }
            return "{" + fields.joined(separator: ",") + "}"
        }
        func line(_ id: String, _ when: Date, kind: String = "add", target: String = "todos", count: Int? = nil, title: String = "보고서 쓰기",
                  client: String = "Claude", undoes: String? = nil, changes: [(String, String?, String?)]) -> String {
            let list = changes.map { "{\"file\":\"\(target).json\",\"id\":\"\($0.0)\",\"before\":\($0.1 ?? "null"),\"after\":\($0.2 ?? "null")}" }
            let undo = undoes.map { ",\"undoes\":\"\($0)\"" } ?? ""
            return "{\"v\":1,\"id\":\"\(id)\",\"at\":\"\(iso(when))\",\"client\":\"\(client)\",\"tool\":\"add_todos\",\"kind\":\"\(kind)\",\"target\":\"\(target)\",\"count\":\(count ?? changes.count),\"title\":\"\(title)\"\(undo),\"changes\":[\(list.joined(separator: ","))]}"
        }
        let now = at(27, 14, 0)
        func change(_ before: String, _ after: String, target: String = "todos") -> AIConnect.Entry {
            AIConnect.parse(line("c", now, kind: "change", target: target, title: "", changes: [(taskA, before, after)]))[0]
        }
        let added = line("e1", at(27, 13, 0), changes: [(taskA, nil, todo(taskA, "보고서 쓰기", start: "15:00", end: "16:00")),
                                                          (taskB, nil, todo(taskB, "장보기"))])

        try test("parse: good lines, a broken one, blanks, unknown kinds and targets") {
            let text = [added, "{\"v\":1,\"id\":\"e2\",\"at\":\"2026-10-27T04:0", "", "   ",
                        line("e3", at(27, 13, 5), kind: "delete", changes: []),
                        line("e4", at(27, 13, 6), target: "alarms", changes: []),
                        "{\"v\":1,\"at\":\"2026-10-27T04:00:00Z\",\"kind\":\"add\"}", // no id
                        "not json at all",
                        line("e5", at(27, 13, 7), kind: "change", count: 1, changes: [(taskA, todo(taskA, "보고서 쓰기", start: "15:00", end: "16:00"),
                                                                                       todo(taskA, "보고서 쓰기", start: "16:00", end: "17:00"))])]
                .joined(separator: "\n") // no newline at the end
            let entries = AIConnect.parse(text)
            try equal(entries.map(\.id), ["e1", "e3", "e4", "e5"], "readable lines")
            try equal(entries[1].kind, .unknown, "unknown kind kept as unknown")
            try equal(entries[2].target, .unknown, "unknown target")
            try equal(entries.filter(\.isAIWork).map(\.id), ["e1", "e5"], "only add/change on known targets count")
            try equal(entries[0].count, 2, "count")
            try equal(entries[0].changes[1].id, taskB, "ids as written")
            try expect(entries[0].changes[0].before == nil, "before null reads as nil")
            try equal(entries[0].changes[0].after?["timeStart"], .string("15:00"), "after kept whole")
        }

        try test("parse: fractional seconds, CRLF, a line the app wrote") {
            let entry = AIConnect.Entry(id: "u1", at: at(27, 13, 30), client: "app", tool: "undo", kind: .undo, target: .todos, title: "보고서 쓰기",
                                        undoes: "e1", changes: [.init(file: "todos.json", id: taskA, before: .object(["title": .string("x")]), after: nil)])
            let text = "{\"v\":1,\"id\":\"f\",\"at\":\"2026-10-27T04:00:00.123Z\",\"kind\":\"add\",\"target\":\"memos\",\"changes\":[]}\r\n" + entry.line() + "\r\n"
            let entries = AIConnect.parse(text)
            try equal(entries.count, 2, "both read")
            try equal(entries[1], entry, "the app's own line round-trips")
            try equal(Int(entries[0].at.timeIntervalSince1970), Int(ISO8601DateFormatter().date(from: "2026-10-27T04:00:00Z")!.timeIntervalSince1970), "fractional")
            try expect(!entry.line().contains("\n"), "one line")
        }

        try test("toasts: the plan's table, ko/en/nl") {
            let entry = AIConnect.parse(added)[0]
            try equal(AIText.toast(entry, .ko), "Claude가 할 일 2개를 넣었어요", "ko add")
            try equal(AIText.toast(entry, .en), "Claude added 2 tasks", "en add")
            try equal(AIText.toast(entry, .nl), "Claude heeft 2 taken toegevoegd", "nl add")
            let moved = AIConnect.parse(line("c", now, kind: "change", changes: [(taskA, todo(taskA, "보고서 쓰기", start: "15:00", end: "16:00"),
                                                                                  todo(taskA, "보고서 쓰기", start: "16:00", end: "17:00"))]))[0]
            try equal(AIText.toast(moved, .ko), "Claude가 ‘보고서 쓰기’ 시간을 바꿨어요", "ko time")
            try equal(AIText.toast(moved, .en), "Claude changed the time of ‘보고서 쓰기’", "en time")
            try equal(AIText.toast(moved, .nl), "Claude heeft de tijd van ‘보고서 쓰기’ gewijzigd", "nl time")
            try equal(AIText.away(3, .ko), "자리 비운 사이 Claude가 3가지를 했어요", "ko away")
            try equal(AIText.away(3, .en), "While you were away, Claude made 3 changes", "en away")
            try equal(AIText.away(3, .nl), "Terwijl je weg was, heeft Claude 3 dingen gedaan", "nl away")
            try equal(AIText.away(1, .en), "While you were away, Claude made 1 change", "en away one")
            let none = AIConnect.UndoOutcome(undone: 0, left: 1)
            try equal(AIText.undoResult(none, .ko), "그새 바뀌어서 되돌리지 못했어요", "ko no undo")
            try equal(AIText.undoResult(none, .en), "It changed since, so it can’t be undone", "en no undo")
            try equal(AIText.undoResult(none, .nl), "Het is intussen gewijzigd, dus herstellen lukt niet", "nl no undo")
            try equal([AIText.undoAction(.ko), AIText.undoAction(.en), AIText.undoAction(.nl)], ["되돌리기", "Undo", "Herstel"], "undo (this app's Dutch word)")
            try equal([AIText.showAction(.ko), AIText.showAction(.en), AIText.showAction(.nl)], ["보기", "Show", "Bekijken"], "show")
        }

        try test("toasts: targets, one item, dates, done, other changes") {
            let event = AIConnect.Entry(id: "x", at: now, kind: .add, target: .events, count: 1, title: "치과")
            try equal(AIText.toast(event, .ko), "Claude가 일정 1개를 넣었어요", "ko event")
            try equal(AIText.toast(event, .en), "Claude added 1 event", "en event")
            try equal(AIText.toast(event, .nl), "Claude heeft 1 afspraak toegevoegd", "nl event")
            let memos = AIConnect.Entry(id: "x", at: now, kind: .add, target: .memos, count: 2)
            try equal([AIText.toast(memos, .ko), AIText.toast(memos, .en), AIText.toast(memos, .nl)],
                      ["Claude가 메모 2개를 넣었어요", "Claude added 2 notes", "Claude heeft 2 notities toegevoegd"], "memos")
            let dated = change(todo(taskA, "보고서 쓰기", extra: "\"dueDate\":\"2026-10-28\""), todo(taskA, "보고서 쓰기", extra: "\"dueDate\":\"2026-10-29\""))
            try equal(AIText.toast(dated, .ko), "Claude가 ‘보고서 쓰기’ 날짜를 바꿨어요", "date (title from after)")
            try equal(AIText.toast(dated, .en), "Claude changed the date of ‘보고서 쓰기’", "en date")
            let done = change(todo(taskA, "보고서 쓰기"), todo(taskA, "보고서 쓰기", done: true, extra: "\"completedAt\":\"2026-10-27T05:00:00Z\""))
            try equal(AIText.toast(done, .ko), "Claude가 ‘보고서 쓰기’ 완료 표시를 했어요", "done")
            try equal(AIText.toast(done, .nl), "Claude heeft ‘보고서 쓰기’ afgevinkt", "nl done")
            let renamed = change(todo(taskA, "보고서"), todo(taskA, "보고서 쓰기"))
            try equal(AIText.toast(renamed, .ko), "Claude가 ‘보고서 쓰기’ 할 일을 바꿨어요", "other")
            try equal(AIText.toast(renamed, .en), "Claude changed the task ‘보고서 쓰기’", "en other")
            let place = change("{\"id\":\"e\",\"title\":\"치과\",\"date\":\"2026-10-27\",\"start\":600,\"end\":660,\"location\":\"A\"}",
                               "{\"id\":\"e\",\"title\":\"치과\",\"date\":\"2026-10-27\",\"start\":600,\"end\":660,\"location\":\"B\"}", target: "events")
            try equal(AIText.toast(place, .ko), "Claude가 ‘치과’ 일정을 바꿨어요", "event other")
            try equal(AIText.toast(place, .nl), "Claude heeft de afspraak ‘치과’ gewijzigd", "nl event other")
            let many = AIConnect.Entry(id: "x", at: now, kind: .change, target: .todos, count: 3)
            try equal([AIText.toast(many, .ko), AIText.toast(many, .en), AIText.toast(many, .nl)],
                      ["Claude가 할 일 3개를 바꿨어요", "Claude changed 3 tasks", "Claude heeft 3 taken gewijzigd"], "many")
            try equal(AIText.shortTitle("이번 주 금요일까지 분기 보고서 초안 마무리하고 팀장님께 보내기"), "이번 주 금요일까지 분기 보고서 초안 마무…", "long title cut")
        }

        try test("M13: undo when nothing changed since — back to before") {
            let entry = AIConnect.parse(added)[0]
            // The app stamped 어제부터 on it meanwhile: bookkeeping doesn't count as a change.
            let current = JSONValue.parse(todo(taskA, "보고서 쓰기", start: "15:00", end: "16:00", extra: "\"todaySince\":\"2026-10-27\""))
            try equal(AIConnect.undoStep(entry.changes[0], target: .todos, current: current), .remove, "added → removed")
            let before = todo(taskA, "보고서 쓰기", start: "15:00", end: "16:00")
            let changed = AIConnect.parse(line("c", now, kind: "change", changes: [(taskA, before, todo(taskA, "보고서 쓰기", start: "16:00", end: "17:00"))]))[0]
            let now16 = JSONValue.parse(todo(taskA, "보고서 쓰기", start: "16:00", end: "17:00"))
            try equal(AIConnect.undoStep(changed.changes[0], target: .todos, current: now16), .restore(JSONValue.parse(before)!), "changed → before")
            // The Windows app's ".000Z" and this app's whole seconds are the same instant.
            let remind = AIConnect.Change(file: "todos.json", id: taskA, before: nil,
                                          after: JSONValue.parse(todo(taskA, "x", extra: "\"reminderAt\":\"2026-10-27T06:00:00.000Z\"")))
            try equal(AIConnect.undoStep(remind, target: .todos, current: JSONValue.parse(todo(taskA, "x", extra: "\"reminderAt\":\"2026-10-27T06:00:00Z\""))),
                      .remove, "same instant")
            // allDay false written or left out.
            let event = AIConnect.Change(file: "events.json", id: "ev", before: nil,
                                         after: .object(["id": .string("ev"), "title": .string("치과"), "date": .string("2026-10-27"), "start": .number(600), "end": .number(660)]))
            try equal(AIConnect.undoStep(event, target: .events, current: .object(["id": .string("ev"), "title": .string("치과"), "date": .string("2026-10-27"),
                                                                                   "start": .number(600), "end": .number(660), "allDay": .bool(false)])),
                      .remove, "event as saved")
        }

        try test("M14: undo after the person changed it — left alone") {
            let entry = AIConnect.parse(added)[0]
            let edited = JSONValue.parse(todo(taskA, "보고서 쓰기 (초안)", start: "15:00", end: "16:00"))
            try equal(AIConnect.undoStep(entry.changes[0], target: .todos, current: edited), .changedSince, "renamed since")
            let moved = JSONValue.parse(todo(taskA, "보고서 쓰기", start: "15:30", end: "16:00"))
            try equal(AIConnect.undoStep(entry.changes[0], target: .todos, current: moved), .changedSince, "moved since")
            try equal(AIConnect.undoStep(entry.changes[0], target: .todos, current: nil), .alreadyBack, "deleted here: nothing to undo")
            let change = AIConnect.Change(file: "todos.json", id: taskA, before: JSONValue.parse(todo(taskA, "a")), after: JSONValue.parse(todo(taskA, "b")))
            try equal(AIConnect.undoStep(change, target: .todos, current: JSONValue.parse(todo(taskA, "a"))), .alreadyBack, "already back")
        }

        try test("partial undo: what can go back goes, the rest stays, and the text says so") {
            let entry = AIConnect.parse(added)[0]
            let steps = [AIConnect.undoStep(entry.changes[0], target: .todos, current: JSONValue.parse(todo(taskA, "보고서 쓰기", start: "15:00", end: "16:00"))),
                         AIConnect.undoStep(entry.changes[1], target: .todos, current: JSONValue.parse(todo(taskB, "장보기", done: true)))]
            try equal(steps, [.remove, .changedSince], "steps")
            let outcome = AIConnect.UndoOutcome(undone: 1, left: 1)
            try equal(AIText.undoResult(outcome, .ko), "1개는 되돌리고, 그새 바뀐 1개는 그대로 뒀어요", "ko partial")
            try equal(AIText.undoResult(outcome, .en), "Undid 1; 1 changed since, so it stays", "en partial")
            try equal(AIText.undoResult(outcome, .nl), "1 hersteld; 1 intussen gewijzigd, die blijft staan", "nl partial")
            try equal(AIText.undoResult(.init(undone: 2, left: 0), .ko), "되돌렸어요", "all")
        }

        try test("M15: the away notice counts what Claude did after 'seen until'") {
            let old = line("e0", at(26, 20, 0), changes: [(taskA, nil, todo(taskA, "어제 일"))])
            let event = line("e6", at(27, 13, 10), target: "events", title: "치과", changes: [("ev1", nil, "{\"id\":\"ev1\",\"title\":\"치과\"}")])
            let undoneLater = line("e7", at(27, 13, 20), changes: [(taskA, nil, todo(taskA, "취소된 일"))])
            let appUndo = line("u7", at(27, 13, 21), kind: "undo", client: "app", undoes: "e7", changes: [(taskA, todo(taskA, "취소된 일"), nil)])
            let entries = AIConnect.parse([old, added, event, undoneLater, appUndo].joined(separator: "\n"))
            let seen = AIConnect.Seen(id: "e0", at: at(26, 20, 0))
            let unseen = AIConnect.unseen(entries, after: seen)
            try equal(unseen.map(\.id), ["e1", "e6", "e7", "u7"], "after the seen line")
            try equal(AIConnect.awayCount(unseen, undone: AIConnect.undone(entries)), 3, "2 tasks + 1 event, the undone one left out")
            // The seen line was trimmed away: by time.
            try equal(AIConnect.unseen(Array(entries.dropFirst()), after: seen).map(\.id), ["e1", "e6", "e7", "u7"], "by time")
            try equal(AIConnect.unseen(entries, after: AIConnect.Seen(id: "u7", at: at(27, 13, 21))), [], "all seen")
            try equal(AIConnect.unseen(entries, after: nil).count, 5, "nothing seen yet: all")
            try equal(AIConnect.advance(seen, over: unseen), AIConnect.Seen(id: "u7", at: at(27, 13, 21)), "advance")
            try equal(AIConnect.advance(seen, over: []), seen, "nothing new: stays")
        }

        try test("marks: today's items (4 a.m. day), not undone, not edited here") {
            let late = line("n1", at(27, 2, 30), changes: [("AAAA", nil, todo("AAAA", "새벽"))]) // still the 26th
            let event = line("e6", at(27, 13, 10), target: "events", changes: [("ev1", nil, "{\"id\":\"ev1\"}")])
            let memo = line("m1", at(27, 13, 11), target: "memos", changes: [("memo1", nil, "{\"id\":\"memo1\",\"text\":\"x\"}")])
            let gone = line("e7", at(27, 13, 20), changes: [("CCCC", nil, todo("CCCC", "x"))])
            let undo = line("u7", at(27, 13, 21), kind: "undo", client: "app", undoes: "e7", changes: [("CCCC", todo("CCCC", "x"), nil)])
            let entries = AIConnect.parse([late, added, event, memo, gone, undo].joined(separator: "\n"))
            let marks = AIConnect.marks(entries, now: now, calendar: seoul)
            try equal(marks, [taskA, taskB.uppercased(), "ev1"], "today's task and event ids, upper-cased task ids")
            try equal(AIConnect.marks(entries, now: now, cleared: [taskA], calendar: seoul), [taskB.uppercased(), "ev1"], "edited here")
            try equal(AIConnect.marks(entries, now: at(28, 5, 0), calendar: seoul), [], "the next day: none")
            try equal(AIConnect.marks(entries, now: at(27, 3, 0), calendar: seoul), ["AAAA"], "before 4 a.m.: the night's")
        }

        try test("recent work: today and yesterday, newest first") {
            let older = line("o", at(25, 12, 0), changes: [])
            let yesterday = line("y", at(26, 12, 0), changes: [])
            let undo = line("u", at(27, 13, 30), kind: "undo", client: "app", undoes: "e1", changes: [])
            let entries = AIConnect.parse([older, yesterday, added, undo].joined(separator: "\n"))
            try equal(AIConnect.recent(entries, now: now, calendar: seoul).map(\.id), ["e1", "y"], "recent")
            try equal(AIConnect.undone(entries), ["e1"], "undone")
        }

        try test("trimming a huge log keeps the last 30 days") {
            var lines: [String] = []
            for index in 0..<4000 { lines.append(line("old\(index)", at(1, 12).addingTimeInterval(-40 * 86_400), changes: [(taskA, nil, todo(taskA, "오래된 일 \(index)"))])) }
            lines.append("{broken")
            for index in 0..<10 { lines.append(line("new\(index)", at(27, 12), changes: [(taskA, nil, todo(taskA, "새 일"))])) }
            let text = lines.joined(separator: "\n") + "\n"
            try expect(text.utf8.count > AIConnect.logLimit, "over 1 MB (\(text.utf8.count))")
            guard let trimmed = AIConnect.trimmed(text, now: now) else { throw TestFailure(description: "expected a trim") }
            try equal(AIConnect.parse(trimmed).map(\.id), (0..<10).map { "new\($0)" }, "kept")
            try expect(trimmed.hasSuffix("\n"), "ends with a newline (the next append starts a line)")
            try expect(AIConnect.trimmed(added + "\n", now: now) == nil, "small: untouched")
        }

        try test("the cat: now and then, not twice in two hours") {
            let entry = AIConnect.parse(added)[0]
            try equal(AIText.catLine(entry, lastSaid: nil, now: now, random: { 0.2 }, .ko), "Claude가 할 일 두 개 놓고 갔어요.", "ko two")
            try equal(AIText.catLine(entry, lastSaid: nil, now: now, random: { 0.2 }, .en), "Claude left two tasks for you.", "en")
            try equal(AIText.catLine(entry, lastSaid: nil, now: now, random: { 0.2 }, .nl), "Claude heeft twee taken voor je klaargezet.", "nl")
            try expect(AIText.catLine(entry, lastSaid: nil, now: now, random: { 0.7 }, .ko) == nil, "only half the time")
            try expect(AIText.catLine(entry, lastSaid: now.addingTimeInterval(-3600), now: now, random: { 0 }, .ko) == nil, "not again within two hours")
            let change = AIConnect.Entry(id: "c", at: now, kind: .change, target: .todos, count: 1)
            try equal(AIText.catLine(change, lastSaid: now.addingTimeInterval(-3 * 3600), now: now, random: { 0 }, .ko), "Claude랑 계획 세웠어요? 저도 볼게요.", "plan line")
            let one = AIConnect.Entry(id: "c", at: now, kind: .add, target: .events, count: 1)
            try equal(AIText.catLine(one, lastSaid: nil, now: now, random: { 0 }, .ko), "Claude가 일정 하나 놓고 갔어요.", "one event")
            let undo = AIConnect.Entry(id: "u", at: now, client: "app", kind: .undo, target: .todos)
            try expect(AIText.catLine(undo, lastSaid: nil, now: now, random: { 0 }, .ko) == nil, "not for undo")
        }

        try test("ai-link.json: the spec's keys") {
            let link = AIConnect.Link(enabled: true, dataFolder: "/home/x/Library/Application Support/com.noa.PaperTodo", lang: .nl, app: "mac 1.42.0", now: at(27, 14))
            let value = JSONValue.parse(String(data: link.encoded(), encoding: .utf8)!)
            try equal(value?["v"], .number(1), "v")
            try equal(value?["enabled"], .bool(true), "enabled")
            try equal(value?["dataFolder"], .string("/home/x/Library/Application Support/com.noa.PaperTodo"), "folder, slashes unescaped")
            try equal(value?["lang"], .string("nl"), "lang")
            try equal(value?["app"], .string("mac 1.42.0"), "app")
            try equal(value?["updatedAt"], .string("2026-10-27T05:00:00Z"), "UTC, whole seconds")
        }

        try test("items to and from the log") {
            var item = TodoItem(id: UUID(uuidString: taskA)!, title: "보고서 쓰기", createdAt: ISO8601DateFormatter().date(from: "2026-10-27T05:12:03Z")!)
            item.timeStart = "15:00"; item.timeEnd = "16:00"
            let json = AIConnect.json(item)
            try expect(AIConnect.sameSaved(json, JSONValue.parse(todo(taskA, "보고서 쓰기", start: "15:00", end: "16:00")), .todos), "as saved")
            let back = AIConnect.decode(TodoItem.self, from: JSONValue.parse(todo(taskB, "장보기", extra: "\"reminderAt\":\"2026-10-27T06:00:00.000Z\""))!)
            try equal(back?.id, UUID(uuidString: taskB), "lower-case id")
            try equal(back?.reminderAt.map { Int($0.timeIntervalSince1970) }, Int(ISO8601DateFormatter().date(from: "2026-10-27T06:00:00Z")!.timeIntervalSince1970), "fractional date")
        }

        try test("⌘Z after Claude's work takes back this Mac's step, not Claude's") {
            var history = UndoableNotebook()
            let mine = history.add("내 일", now: now)!
            _ = history.add("또 내 일", now: now)
            var disk = history.notebook
            let claude = disk.add("Claude가 넣은 일", now: now)!
            disk.edit(id: mine.id, title: "내 일 (Claude가 고침)")
            history.adopt(disk)
            try equal(history.notebook, disk, "Claude's version is the list")
            try expect(history.canUndo, "this Mac's steps are still there")
            history.undo()
            try equal(history.notebook.items.map(\.title), ["내 일 (Claude가 고침)", "Claude가 넣은 일"], "my last add undone; Claude's stays")
            history.undo()
            try equal(history.notebook.items.map(\.title), ["Claude가 넣은 일"], "first add undone; Claude's still there")
            history.redo(); history.redo()
            try equal(history.notebook.items.map(\.title), ["내 일 (Claude가 고침)", "또 내 일", "Claude가 넣은 일"], "redo keeps it in place")
            // Gone on disk: gone from the copies too.
            var removed = history.notebook
            removed.delete(id: claude.id)
            history.adopt(removed)
            history.undo()
            try expect(!history.notebook.items.contains { $0.id == claude.id }, "removed everywhere")
            // Nothing new: no change.
            let same = history
            history.adopt(history.notebook)
            try equal(history, same, "same file")
        }

        try test("Claude Code: user scope, full paths, one line to paste") {
            let node = "/usr/local/bin/node"
            let server = "/Applications/종이냥.app/Contents/Resources/mcp/server/index.js"
            try equal(AIConnect.codeAddArguments(node: node, server: server),
                      ["mcp", "add-json", "-s", "user", "jongi-nyang",
                       "{\"args\":[\"/Applications/종이냥.app/Contents/Resources/mcp/server/index.js\"],\"command\":\"/usr/local/bin/node\",\"type\":\"stdio\"}"],
                      "arguments")
            try equal(AIConnect.codeRemoveArguments, ["mcp", "remove", "-s", "user", "jongi-nyang"], "remove")
            let line = AIConnect.codeCommand(node: node, server: "/home/a b/it's/index.js")
            try expect(line.hasPrefix("claude mcp add-json -s user jongi-nyang '{"), "command: \(line)")
            try expect(line.contains("/home/a b/it'\\''s/index.js"), "quote inside: \(line)")
            try equal(AIConnect.shellQuoted("/usr/local/bin/node"), "/usr/local/bin/node", "plain")
            try equal(AIConnect.shellQuoted(""), "''", "empty")
            try expect(AIConnect.toolPlaces("claude", home: "/home/a").first == "/home/a/.local/bin/claude", "claude places")
            try expect(AIConnect.toolPlaces("node", home: "/home/a").contains("/opt/homebrew/bin/node"), "node places")
            try expect(AIConnect.movablePlace("/Volumes/종이냥/종이냥.app"), "disk image")
            try expect(AIConnect.movablePlace("/private/var/folders/x/AppTranslocation/Y/d/종이냥.app"), "translocated")
            try expect(!AIConnect.movablePlace("/Applications/종이냥.app"), "Applications")
        }

        print("\(count) AI connection tests passed")
    }
}
