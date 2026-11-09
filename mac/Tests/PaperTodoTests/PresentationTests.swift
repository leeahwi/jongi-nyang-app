import Foundation
import AppKit
import SwiftUI
import PaperCore

private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private func expectEqual<T: Equatable>(_ actual: @autoclosure () throws -> T, _ expected: T, _ message: String) throws {
    let value = try actual()
    if value != expected {
        throw TestFailure(description: "\(message): expected \(expected), got \(value)")
    }
}

@MainActor
private struct Fixture {
    let folder: URL
    let storageURL: URL
    let suite: TestDefaults
    let preferences: UserDefaults

    init(items: [(String, Bool)]) throws {
        folder = FileManager.default.temporaryDirectory.appendingPathComponent("PaperTodo-presentation-\(UUID().uuidString)")
        storageURL = folder.appendingPathComponent("todos.json")
        suite = TestDefaults("PresentationTests")
        preferences = suite.defaults

        var notebook = Notebook()
        for item in items {
            let id = notebook.add(item.0)!
            if item.1 { notebook.toggle(id: id.id) }
        }
        try NotebookFile(url: storageURL).save(notebook)
    }

    func model() -> AppModel {
        AppModel(storageURL: storageURL, preferences: preferences)
    }

    func cleanup() {
        suite.remove()
        try? FileManager.default.removeItem(at: folder)
    }
}

@main
private enum PresentationTests {
    static func main() async throws {
        var count = 0
        func test(_ name: String, _ action: @MainActor () async throws -> Void) async throws {
            try await action()
            count += 1
            print("PASS \(name)")
        }

        try await test("only the header can initiate window movement at every supported height") {
            _ = NSApplication.shared
            for height: CGFloat in [400, 560, 1200] {
                let window = NoteWindow(contentRect: NSRect(x: 100, y: 100, width: 420, height: height),
                                        styleMask: [.titled, .fullSizeContentView], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false
                defer { window.close() }
                try expect(!window.isMovable && !window.isMovableByWindowBackground, "Implicit window movement must be disabled")
                try expect(window.canStartHeaderDrag(at: NSPoint(x: 150, y: height - 60)), "Header must remain draggable")
                try expect(!window.canStartHeaderDrag(at: NSPoint(x: 12, y: height - 154)), "First row grip must never move the window")
                try expect(!window.canStartHeaderDrag(at: NSPoint(x: 160, y: height - 198)), "Task title must never move the window")
                try expect(!window.canStartHeaderDrag(at: NSPoint(x: 150, y: height - NoteHeader.height)), "Header boundary belongs to the list")
                try expect(!window.canStartHeaderDrag(at: NSPoint(x: -1, y: height - 60)), "Outside-window coordinates must be rejected")
                try expect(!window.canStartHeaderDrag(at: NSPoint(x: 200, y: height - 17)), "The 할 일 | 메모 switch must take clicks, not drag the window")
                try expect(!window.canStartHeaderDrag(at: NSPoint(x: 400, y: height - 17)), "Toolbar icons must take clicks")
                // Once the header reports where its tabs and tools are, the empty stretch between them drags.
                window.toolbarControlFrames = [CGRect(x: 76, y: 8, width: 220, height: 30), CGRect(x: 330, y: 2, width: 80, height: 34)]
                try expect(window.canStartHeaderDrag(at: NSPoint(x: 312, y: height - 17)), "Empty space in the top row moves the window")
                try expect(!window.canStartHeaderDrag(at: NSPoint(x: 200, y: height - 17)), "Tabs still take clicks")
                try expect(!window.canStartHeaderDrag(at: NSPoint(x: 360, y: height - 17)), "Tools still take clicks")
                try expect(!window.canStartHeaderDrag(at: NSPoint(x: 40, y: height - 17)), "The window buttons still take clicks")
            }
        }

        try await test("grip pointer position selects insertion boundaries without mutating row order") {
            let rows = (0..<4).map { _ in UUID() }
            try expectEqual(TaskRowDrop.destination(source: rows[1], rows: rows, offsetFromSourceTop: -80),
                            TaskRowDrop(source: rows[1], target: rows[0], after: false), "Pointer above first row must insert at the beginning")
            try expectEqual(TaskRowDrop.destination(source: rows[1], rows: rows, offsetFromSourceTop: 120),
                            TaskRowDrop(source: rows[1], target: rows[3], after: true), "Pointer below last midpoint must insert at the end")
            try expectEqual(TaskRowDrop.destination(source: rows[0], rows: rows, offsetFromSourceTop: 109),
                            TaskRowDrop(source: rows[0], target: rows[2], after: false), "Upper half must select before")
            try expectEqual(TaskRowDrop.destination(source: rows[0], rows: rows, offsetFromSourceTop: 110),
                            TaskRowDrop(source: rows[0], target: rows[2], after: true), "Lower half must select after")
            try expect(TaskRowDrop.destination(source: UUID(), rows: rows, offsetFromSourceTop: 0) == nil, "Missing source must reject a stale gesture")
        }

        try await test("replacing and dismissing a walking reminder cancels its old entrance") {
            let popup = ReminderPopupController(onOpen: {}, onSnooze: { _ in }, onComplete: { _ in })
            popup.show(image: PaperTheme.mascot, tasks: [ReminderPopupTask(title: "첫 알림")], duration: 0.1, style: .character)
            if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
                try expect(!popup.motionSnapshot.bubbleVisible && !popup.motionSnapshot.readingStarted, "Walk must start before the bubble and reading timer")
            }
            try await Task.sleep(for: .milliseconds(80))
            popup.show(image: PaperTheme.mascot, tasks: [ReminderPopupTask(title: "교체 알림")], duration: 0, style: .compact)
            let replacementFrame = popup.motionSnapshot.frame
            try expect(popup.motionSnapshot.readingStarted, "Mascot-free reminder should be immediately readable")
            try await Task.sleep(for: .seconds(2.2))
            try expect(popup.isVisible && popup.motionSnapshot.frame == replacementFrame, "Old entrance must not move or close a replacement")
            popup.dismiss()
            try await Task.sleep(for: .milliseconds(100))
            try expect(!popup.isVisible && !popup.motionSnapshot.bubbleVisible, "Dismissed entrance must not reappear")
        }

        try await test("walking time does not consume the readable reminder duration") {
            let popup = ReminderPopupController(onOpen: {}, onSnooze: { _ in })
            popup.show(image: PaperTheme.mascot, tasks: [ReminderPopupTask(title: "도착 후 알림")], duration: 2, style: .paper)
            for _ in 0..<150 {
                if popup.motionSnapshot.readingStarted { break }
                try await Task.sleep(for: .milliseconds(20))
            }
            try expect(popup.motionSnapshot.readingStarted && popup.motionSnapshot.bubbleVisible, "Arrival must reveal the bubble")
            try expect(popup.isVisible && (popup.motionSnapshot.readingTimeLeft ?? 0) > 1.7, "The two-second reading interval must remain after the walk")
            try expectEqual(popup.motionSnapshot.progress, 1, "Cat must settle at the destination")
            popup.dismiss()
        }

        try await test("cat walk starts off-screen and hands over to the landing without a jump") {
            let start = Date()
            let travel: CGFloat = 460
            let first = MascotMotion.pose(.walkingIn(start), at: start, travel: travel)
            try expect(first.x >= travel, "Cat must begin fully beyond the screen edge")
            let landed = MascotMotion.pose(.walkingIn(start), at: start.addingTimeInterval(MascotMotion.walkInDuration), travel: travel)
            let arrived = MascotMotion.pose(.arrived(start), at: start, travel: travel)
            try expect(abs(landed.x) < 0.01 && abs(landed.rotation) < 0.01 && abs(landed.lift) < 0.01, "Walk must end planted at the destination")
            try expect(abs(landed.scaleY - arrived.scaleY) < 0.002 && abs(landed.scaleX - arrived.scaleX) < 0.002,
                       "Landing squash must continue from the last step")
            var previous = first.x
            for frame in 1...120 {
                let pose = MascotMotion.pose(.walkingIn(start), at: start.addingTimeInterval(Double(frame) / 60), travel: travel)
                try expect(pose.x <= previous + 0.001, "Cat must never slide backwards while walking in")
                try expect(abs(pose.rotation) <= 7.01 && pose.lift <= 3.01, "Waddle must stay small")
                previous = pose.x
            }
            let leaving = MascotMotion.pose(.leaving(start), at: start, travel: travel)
            try expect(abs(leaving.x) < 0.01 && abs(leaving.scaleY - 1) < 0.001, "Walking away must start from the resting pose")
            let gone = MascotMotion.pose(.leaving(start), at: start.addingTimeInterval(MascotMotion.leaveDuration), travel: travel)
            try expect(gone.x >= travel, "Cat must leave past the screen edge")
        }

        try await test("timed-out reminder walks away before closing") {
            let popup = ReminderPopupController(onOpen: {}, onSnooze: { _ in })
            popup.show(image: PaperTheme.mascot, tasks: [ReminderPopupTask(title: "떠나기")], duration: 0.2, style: .paper)
            for _ in 0..<150 {
                if popup.motionSnapshot.readingStarted { break }
                try await Task.sleep(for: .milliseconds(20))
            }
            try await Task.sleep(for: .milliseconds(450))
            if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
                try expect(popup.isVisible && !popup.motionSnapshot.bubbleVisible, "Bubble must fold before the cat walks off")
                try expect(popup.mascotPose.x > 0, "Cat must be walking towards the edge")
            }
            try await Task.sleep(for: .seconds(1.3))
            try expect(!popup.isVisible, "Reminder must close once the cat has left")
        }

        try await test("one bubble lists several tasks and closes after the last check") {
            var completed: [UUID] = []
            let popup = ReminderPopupController(onOpen: {}, onSnooze: { _ in }, onComplete: { completed.append($0) })
            let tasks = ["하나", "둘", "셋", "넷", "다섯"].map { ReminderPopupTask(title: $0) }
            popup.show(image: PaperTheme.mascot, tasks: tasks, duration: 0, style: .compact)
            try expectEqual(popup.shownTaskIDs, tasks.map(\.id), "All tasks must share a single bubble")
            popup.retainTasks(openIDs: Set(tasks.dropFirst().map(\.id)))
            try expectEqual(popup.shownTaskIDs, tasks.dropFirst().map(\.id), "Tasks finished elsewhere must drop out of the bubble")
            popup.retainTasks(openIDs: [])
            try expect(!popup.isVisible, "An empty bubble must close")
            _ = completed
        }

        try await test("scheduled reminders due together arrive in one bubble") {
            let fixture = try Fixture(items: [("A", false), ("B", false), ("C", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            let past = Date().addingTimeInterval(-60)
            for item in model.items { model.setTaskReminder(item.id, at: past) }
            try expectEqual(TaskReminderDue.readyItems(in: model.items, now: .now).count, 3, "All three must be due")
            var shows = 0
            let controller = TaskReminderController(model: model, duration: { 0 }, beforeShow: { shows += 1 }, onOpen: {})
            try await Task.sleep(for: .seconds(1.6))
            try expectEqual(shows, 1, "Three due tasks must produce exactly one reminder")
            try expect(model.items.allSatisfy { $0.reminderLastDeliveredAt != nil }, "Every task in the bubble must count as delivered")
            try expect(TaskReminderDue.readyItems(in: model.items, now: .now, shownHere: model.remindersShownHere).isEmpty, "Nothing may queue up behind the bubble")
            controller.dismiss()
        }

        try await test("the keyboard walks, completes, edits, deletes and moves rows") {
            let fixture = try Fixture(items: [("A", false), ("B", false), ("C", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            model.showsGuide = false
            let ids = model.visibleItems.map(\.id)
            try expect(model.handleListKey(.down) && model.selectedTaskID == ids[0], "↓ from nothing picks the first row")
            model.handleListKey(.down)
            try expect(model.selectedTaskID == ids[1], "↓ moves on")
            model.handleListKey(.toggle)
            try expect(model.items.first { $0.id == ids[1] }?.isCompleted == true, "Space completes")
            model.handleListKey(.moveUp)
            try expectEqual(model.visibleItems.map(\.id), [ids[1], ids[0], ids[2]], "⌘↑ moves it up")
            model.handleListKey(.edit)
            try expect(model.editRequestID == ids[1], "Return asks the row to edit")
            model.handleListKey(.delete)
            try expect(!model.items.contains { $0.id == ids[1] } && model.selectedTaskID == ids[0], "⌫ deletes and picks the next row")
            model.undo()
            try expect(model.items.contains { $0.id == ids[1] }, "and can be undone")
            model.selectedTaskID = nil
            model.handleListKey(.up)
            try expect(model.selectedTaskID == model.visibleItems.last?.id, "↑ from nothing picks the last row")
            try expect(model.handleListKey(.clear) && model.selectedTaskID == nil, "Esc lets go")
        }

        try await test("typed dates become alerts or deadlines; dropping on a tab moves a task") {
            let fixture = try Fixture(items: [("A", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            model.add("내일 3시 회의")
            let meeting = model.items.last!
            try expect(meeting.title == "회의" && meeting.reminderAt != nil && meeting.dueDate == nil, "내일 3시 → alert")
            model.add("금요일까지 보고서")
            try expect(model.items.last!.title == "보고서" && model.items.last!.dueDate != nil, "금요일까지 → deadline")
            model.add("내일 3시 회의", literal: true)
            try expect(model.items.last!.title == "내일 3시 회의" && model.items.last!.reminderAt == nil, "Shift+Return keeps it as typed")
            model.addLater("다음 주 월요일 장보기")
            try expect(model.items.last!.shelf == nil && model.items.last!.dueDate != nil, "A date on 앞으로 makes it a deadline on that day")
            let a = model.items[0].id
            model.dropTask(a, on: .ahead)
            let later = model.items.first { $0.id == a }!
            try expect(later.dueDate == nil && later.shelf == .later, "Dropped on the 앞으로 tab without a date → 언젠가")
            try expect(model.toast?.text == Ahead.movedText(.someday, now: Date(), language: .current) && model.toast?.moved == a, "The move's toast")
            model.undo()
            try expect(model.items.first { $0.id == a }?.shelf == nil, "One undo step")
            let report = model.items.first { $0.title == "보고서" }!
            model.setDeadline(report.id, to: report.dueDate!, keepOnToday: true)
            if (Deadline.daysLeft(report.dueDate!, now: Date()) ?? 0) > 0 {
                model.dropTask(report.id, on: .ahead)
                try expect(model.items.first { $0.id == report.id }?.shelf == nil, "A pinned deadline dropped on 앞으로 goes back to its day")
            }
        }

        try await test("앞으로: a drop on a day sets the date (off the later shelf), on 언젠가 takes it off; the toast undoes it") {
            let fixture = try Fixture(items: [("A", false), ("B", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            let a = model.items[0].id, b = model.items[1].id
            let inThree = Deadline.key(Calendar.paper.date(byAdding: .day, value: 3, to: Archive.logicalDayStart(Date()))!)
            model.moveToLater(a)
            model.move(a, to: .day(inThree))
            var item = model.items.first { $0.id == a }!
            try expect(item.dueDate == inThree && item.shelf == nil, "On a day: due then, off the later shelf")
            try expect(model.toast?.text == Ahead.movedText(.day(inThree), now: Date(), language: .current), "Toast says where it went")
            try expect(model.aheadItems.map(\.id) == [a] && model.aheadCount == 1, "It shows on 앞으로")
            model.toast?.perform?()
            item = model.items.first { $0.id == a }!
            try expect(item.dueDate == nil && item.shelf == .later && model.toast == nil, "되돌리기 puts it back")
            model.move(a, to: .day(inThree))
            model.toggle(b)
            model.toast?.perform?()
            item = model.items.first { $0.id == a }!
            try expect(item.dueDate == nil && item.shelf == .later && model.items.first { $0.id == b }!.isCompleted, "After another change only this task goes back")
            model.move(a, to: .day(inThree))
            model.move(a, to: .someday)
            item = model.items.first { $0.id == a }!
            try expect(item.dueDate == nil && item.shelf == .later, "On 언젠가: no date, the later shelf")
            model.move(a, to: .today)
            try expect(model.todayItems.contains { $0.id == a }, "On 오늘: today's sheet")
            model.toast = nil
            model.move(a, to: .today)
            try expect(model.toast == nil, "Already there: nothing happens")
        }

        try await test("앞으로: a drag lands between rows of its own day, else on the day or 언젠가 under the pointer") {
            let a = UUID(), b = UUID(), c = UUID()
            let rows: [UUID: CGRect] = [a: CGRect(x: 80, y: 100, width: 300, height: 36), b: CGRect(x: 80, y: 136, width: 300, height: 36),
                                        c: CGRect(x: 80, y: 300, width: 300, height: 36)]
            let targets: [AheadDropTarget: CGRect] = [.day("2026-10-09"): CGRect(x: 0, y: 90, width: 420, height: 90),
                                                      .day("2026-10-13"): CGRect(x: 0, y: 200, width: 420, height: 60),
                                                      .someday: CGRect(x: 0, y: 280, width: 420, height: 80)]
            var (row, target) = AheadPageView.drop(a, at: CGPoint(x: 200, y: 160), group: [a, b], rowFrames: rows, targetFrames: targets)
            try expect(row == TaskRowDrop(source: a, target: b, after: true) && target == nil, "below the middle of its neighbour: after it")
            (row, target) = AheadPageView.drop(b, at: CGPoint(x: 200, y: 105), group: [a, b], rowFrames: rows, targetFrames: targets)
            try expect(row == TaskRowDrop(source: b, target: a, after: false) && target == nil, "above the middle: before it")
            (row, target) = AheadPageView.drop(a, at: CGPoint(x: 30, y: 230), group: [a, b], rowFrames: rows, targetFrames: targets)
            try expect(row == nil && target == .day("2026-10-13"), "another day")
            (row, target) = AheadPageView.drop(a, at: CGPoint(x: 200, y: 310), group: [a, b], rowFrames: rows, targetFrames: targets)
            try expect(row == nil && target == .someday, "a row of 언젠가 is 언젠가 for a task from a day")
            (row, target) = AheadPageView.drop(c, at: CGPoint(x: 200, y: 290), group: nil, rowFrames: rows, targetFrames: targets)
            try expect(row == nil && target == .someday, "from 그 뒤 (no group): the area")
            (row, target) = AheadPageView.drop(a, at: CGPoint(x: 200, y: 600), group: [a, b], rowFrames: rows, targetFrames: targets)
            try expect(row == nil && target == nil, "nowhere")
        }

        try await test("앞으로: a line without a date goes to 언젠가, with one to its day; old page names open 앞으로") {
            let fixture = try Fixture(items: [])
            defer { fixture.cleanup() }
            let model = fixture.model()
            model.commitIntent(text: "자전거 바람 넣기", candidates: model.intentCandidates("자전거 바람 넣기"), index: 0, page: .ahead)
            try expect(model.items.last?.shelf == .later && model.items.last?.dueDate == nil, "No date → 언젠가")
            model.commitIntent(text: "금요일까지 보고서", candidates: model.intentCandidates("금요일까지 보고서"), index: 0, page: .ahead)
            try expect(model.items.last?.shelf == nil && model.items.last?.dueDate != nil, "A date → its day")
            try expect(AppModel.Page(saved: "deadlines") == .ahead && AppModel.Page(saved: "later") == .ahead
                       && AppModel.Page(saved: "todos") == .todos && AppModel.Page(saved: "memos") == .todos, "마감 and 나중에 open 앞으로; the 메모 tab (until 1.42) opens 오늘")
            model.reveal(model.items.first!.id)
            try expect(model.page == .ahead, "Revealing a task that isn't for today opens 앞으로")
        }

        try await test("in a shared folder a change lands on top of what another device just saved") {
            let fixture = try Fixture(items: [("A", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            model.sharedFolder = fixture.folder
            // The other computer adds a task a moment before this Mac ticks A off.
            var elsewhere = try NotebookFile(url: fixture.storageURL).load()
            _ = elsewhere.add("from Windows")
            try NotebookFile(url: fixture.storageURL).save(elsewhere)
            model.toggle(model.items[0].id)
            let saved = try NotebookFile(url: fixture.storageURL).load()
            try expectEqual(saved.items.map(\.title), ["A", "from Windows"], "The other device's task must survive")
            try expect(saved.items[0].isCompleted, "This Mac's change is kept too")
            model.undo()
            try expect(!(try NotebookFile(url: fixture.storageURL).load()).items[0].isCompleted, "Undo still works after catching up")
        }

        try await test("moving folders merges the record by task, whichever list is kept") {
            let source = FileManager.default.temporaryDirectory.appendingPathComponent("PaperTodo-archive-\(UUID().uuidString)")
            let target = source.appendingPathExtension("target")
            defer { try? FileManager.default.removeItem(at: source); try? FileManager.default.removeItem(at: target) }
            try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
            try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true)
            try #"{"completedAt":"2026-09-02T00:00:00Z","id":"both","title":"둘 다"}\#n{"id":"mine","title":"내 것"}\#n"#
                .write(to: source.appendingPathComponent("2026-09.jsonl"), atomically: true, encoding: .utf8)
            // Windows wrote the shared entry with its keys in another order.
            try #"{"id":"both","title":"둘 다","completedAt":"2026-09-02T00:00:00Z"}"#
                .write(to: target.appendingPathComponent("2026-09.jsonl"), atomically: true, encoding: .utf8)
            try StorageFolder.mergeArchive(from: source, into: target)
            let ids = try String(contentsOf: target.appendingPathComponent("2026-09.jsonl"), encoding: .utf8)
                .split(separator: "\n").map { ($0.contains("mine") ? "mine" : "both") }
            try expectEqual(ids, ["both", "mine"], "Each task once")
        }

        try await test("text size persists, grows step by step and still fits a ruled line") {
            let fixture = try Fixture(items: [("write", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            model.textSize = .large
            try expectEqual(fixture.model().textSize, .large, "Text size did not round-trip")
            for font in NotebookFont.allCases {
                let sizes = NotebookTextSize.allCases.map { font.bodySize($0) }
                try expect(zip(sizes, sizes.dropFirst()).allSatisfy { $0 < $1 }, "Each step must be larger")
                try expect(sizes.last! < PaperTheme.rowHeight - 12, "Largest text must fit the 44 pt line")
            }
            try expect(NotebookTextSize.extraLarge.larger == nil && NotebookTextSize.small.smaller == nil, "Steps must stop at both ends")
        }

        try await test("bundled handwriting fonts load with narrow standalone jamo") {
            HandwritingFont.register()
            for face in [HandwritingFont.Face.pen, .brush] {
                let font = HandwritingFont.native(face: face, size: 23)
                try expect(font.fontName.hasPrefix("HanJang"), "Tightened font must load, got \(font.fontName)")
                let jamo = ("ㅇ" as NSString).size(withAttributes: [.font: font]).width
                let syllable = ("가" as NSString).size(withAttributes: [.font: font]).width
                try expect(jamo <= syllable, "A lone jamo must not be wider than a full syllable (\(jamo) > \(syllable))")
            }
        }

        try await test("코드 글꼴 D2Coding (#143) loads from the bundle, a Hangul syllable two Latin columns wide") {
            let font = MemoText(codeFace: .d2coding).codeFont
            try expect(font.fontName == "D2Coding", "D2Coding must load, got \(font.fontName)")
            let latin = ("a" as NSString).size(withAttributes: [.font: font]).width
            let hangul = ("가" as NSString).size(withAttributes: [.font: font]).width
            try expect(abs(hangul - 2 * latin) < 0.5, "A syllable must be two columns (\(hangul) vs \(latin))")
            try expect(MemoText(codeFace: .system).codeFont.fontName != "D2Coding", "The system face stays the default")
            try expect(MemoText(face: .mono, codeFace: .d2coding).font().fontName == "D2Coding", "고정폭 body follows the code font")
        }

        try await test("making a row recur links it, places today's copy once and deleting keeps the task") {
            let fixture = try Fixture(items: [("스트레칭", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            let calendar = Calendar.current
            let morning = calendar.date(bySettingHour: 8, minute: 0, second: 0, of: Date())!
            model.saveSeries(taskID: model.items[0].id, rule: RepeatRule(kind: .daily), remindAt: "09:00", now: morning)
            try expectEqual(model.series.count, 1, "Series must be created")
            try expectEqual(model.items.count, 1, "The row itself is today's copy")
            try expect(model.items[0].seriesID == model.series[0].id, "Row must link to its series")
            try expect(model.items[0].reminderAt == calendar.date(bySettingHour: 9, minute: 0, second: 0, of: morning), "Today's alert must be set")
            model.placeRecurring(now: morning.addingTimeInterval(12 * 3600))
            try expectEqual(model.items.count, 1, "No duplicate later the same day")
            model.placeRecurring(now: calendar.date(byAdding: .day, value: 1, to: morning)!)
            try expectEqual(model.items.count, 1, "Unfinished copy is carried, not stacked")
            model.completeTask(model.items[0].id)
            model.placeRecurring(now: calendar.date(byAdding: .day, value: 2, to: morning)!)
            try expectEqual(model.items.filter { !$0.isCompleted }.count, 1, "A new copy after finishing")
            try expectEqual(fixture.model().series.count, 1, "Series persist in repeats.json")
            model.deleteSeries(model.series[0].id)
            try expect(model.series.isEmpty && model.items.allSatisfy { $0.isCompleted || $0.seriesID == nil }, "Open copies become ordinary tasks")
        }

        try await test("pet clips end where they should and resting poses need no redraw") {
            let start = Date()
            let walk = PetActivity(.walk(from: 100, to: 300), start: start)
            try expect(abs(PetMotion.frame(walk, homeX: 100, at: start).x - 100) < 0.01, "Walk starts at home")
            try expect(abs(PetMotion.frame(walk, homeX: 100, at: start.addingTimeInterval(walk.duration)).x - 300) < 0.01, "Walk ends at the target")
            try expect(PetMotion.frame(walk, homeX: 100, at: start.addingTimeInterval(walk.duration / 2)).facingRight, "Faces the way it walks")
            for action in [PetAction.blink, .tilt, .hop, .stretch, .yawn, .happy, .cheer] {
                let activity = PetActivity(action, start: start)
                let end = PetMotion.frame(activity, homeX: 50, at: start.addingTimeInterval(activity.duration))
                try expect(activity.duration > 0 && activity.isOver(at: start.addingTimeInterval(activity.duration + 0.001)), "\(action) must end")
                try expect(abs(end.pose.lift) < 0.5 && abs(end.pose.rotation) < 0.5, "\(action) must land back at rest")
            }
            for action in [PetAction.sit, .sleep] {
                try expect(action.isResting && !PetActivity(action, start: start).isOver(at: start.addingTimeInterval(3600)), "\(action) is a resting state")
            }
        }

        try await test("pet walk frames keep contact with the floor and repeat by travelled distance") {
            try expectEqual(PetArt.walkCycle?.count, 8, "All complete walking frames must be bundled")
            try expect(abs(PetArt.walkStride - 17.25) < 0.001, "Stride must match the frame design's planted-paw travel at 92pt")
            let start = Date(timeIntervalSince1970: 1_000)
            @MainActor func sample(distance: CGFloat, right: Bool) -> PetFrame {
                let target = right ? distance * 2 : -distance * 2
                var clip = PetActivity(.walk(from: 0, to: target), start: start)
                clip.duration = 2
                return PetMotion.frame(clip, homeX: 0, at: start.addingTimeInterval(1))
            }
            for step in 0..<8 {
                let distance = PetArt.walkStride * (CGFloat(step) + 0.25) / 8
                let left = sample(distance: distance, right: false)
                let right = sample(distance: distance, right: true)
                let nextCycle = sample(distance: distance + PetArt.walkStride, right: true)
                try expectEqual(right.walkFrame, step, "Distance must visit every frame in sequence")
                try expectEqual(left.walkFrame, right.walkFrame, "Facing direction must not change contact phase")
                try expectEqual(nextCycle.walkFrame, right.walkFrame, "A full stride must repeat the same pose")
                try expect(abs(right.pose.lift) < 0.001 && abs(right.pose.rotation) < 0.001,
                           "Planted paws must not be lifted by an extra global bounce")
                try expect(right.pose.scaleX == 1 && right.pose.scaleY == 1, "Walking must preserve the original proportions")
            }
        }

        try await test("memos: blank ones vanish, deletes can be undone, and everything persists") {
            let fixture = try Fixture(items: [])
            defer { fixture.cleanup() }
            let model = fixture.model()
            let blank = model.newMemo()
            try expect(model.page == .todos && model.openMemoID == blank, "New memo is open for typing (the note stays on its page)")
            model.closeMemo()
            try expect(model.memos.isEmpty, "A blank memo disappears when closed")
            let first = model.newMemo()
            model.updateMemo(first, text: "장보기\n우유, 달걀")
            model.closeMemo()
            let second = model.newMemo()
            model.updateMemo(second, text: "회의 메모")
            model.closeMemo()
            try expect(model.memos.map(\.title) == ["회의 메모", "장보기"], "Newest first, titled by the first line")
            try expectEqual(model.memos[1].preview, "우유, 달걀", "Preview is the rest")
            model.updateMemo(first, text: "장보기\n우유, 달걀, 사과")
            try expectEqual(model.memos.first?.id, first, "Editing brings a memo to the top")
            model.deleteMemo(second)
            try expect(model.memos.count == 1 && model.lastDeletedMemo?.id == second, "Delete keeps one undo")
            model.restoreDeletedMemo()
            try expectEqual(model.memos.count, 2, "Deleted memo restored")
            model.saveMemosNow()
            try expectEqual(fixture.model().memos.map(\.title), ["장보기", "회의 메모"], "Memos persist in memos.json")
        }

        try await test("M4 /메모 goes to the drawer's last folder, its toast opens the drawer on it (1.43)") {
            let fixture = try Fixture(items: [])
            defer { fixture.cleanup() }
            let model = fixture.model()
            let work = model.addMemoFolder(name: "회사", color: .pink)!
            model.drawer.lastFolder = work
            var revealed: String?
            model.onRevealMemo = { revealed = $0 }
            let candidates = model.intentCandidates("/메모 우유")
            guard let commit = model.commitIntent(text: "/메모 우유", candidates: candidates, index: 0, page: .todos),
                  case .memo(let id) = commit.made else { throw TestFailure(description: "no memo made") }
            try expectEqual(model.memoFolders.folderID(of: id), work, "in the last folder")
            let toast = model.makeToast(for: commit, onChange: { _ in })
            try expectEqual(toast.text, "메모 서랍에 넣었어요", "toast")
            try expectEqual(toast.action, "열기", "its action")
            toast.perform?()
            try expectEqual(revealed, id, "열기 opens the drawer on it")
            model.revealMemo("x")
            try expectEqual(revealed, "x", "M5 a search hit opens the drawer with it (SearchSlip → revealMemo)")
        }

        try await test("memos: changes from another device and from here both survive") {
            let fixture = try Fixture(items: [])
            defer { fixture.cleanup() }
            let model = fixture.model()
            model.sharedFolder = fixture.folder
            var ids: [String: String] = [:]
            for name in ["keep", "theirs", "gone-here", "gone-there"] {
                let id = model.newMemo()
                model.updateMemo(id, text: name)
                model.closeMemo()
                ids[name] = id
            }
            // The other device, a moment ago: edits one memo, deletes one, adds one, and edits
            // the one this Mac is about to delete.
            let memosURL = fixture.folder.appendingPathComponent("memos.json")
            var there = try MemoFile.load(memosURL)
            let later = Date().addingTimeInterval(5)
            for index in there.indices where [ids["theirs"], ids["gone-here"]].contains(there[index].id) {
                there[index].text += " (edited there)"
                there[index].updatedAt = later
            }
            there.removeAll { $0.id == ids["gone-there"] }
            there.append(Memo(text: "new there", createdAt: later, updatedAt: later))
            try MemoFile.save(there, to: memosURL)
            // This Mac, before its two-second check: edits one memo and deletes another.
            model.updateMemo(ids["keep"]!, text: "keep (edited here)")
            model.deleteMemo(ids["gone-here"]!)
            let saved = Set(try MemoFile.load(memosURL).map(\.text))
            try expectEqual(saved, ["keep (edited here)", "theirs (edited there)", "new there"], "Both devices' memo changes are kept")
            try expectEqual(Set(model.memos.map(\.text)), saved, "This Mac shows the merged memos")

            // A memo only opened here takes the other device's text; once typed in, it keeps this Mac's.
            let open = ids["keep"]!
            model.openMemoID = open
            there = try MemoFile.load(memosURL)
            for index in there.indices where there[index].id == open { there[index].text = "edited there while open" }
            there.append(Memo(text: "another one", createdAt: later, updatedAt: later))
            try MemoFile.save(there, to: memosURL)
            model.reloadFromDisk()
            try expectEqual(model.memos.first { $0.id == open }?.text, "edited there while open", "Opened, not typed in: theirs")
            try expect(model.memos.contains { $0.text == "another one" }, "Other memos still come in while one is open")
            model.updateMemo(open, text: "typed here")
            model.saveMemosNow()
            there = try MemoFile.load(memosURL)
            for index in there.indices where there[index].id == open { there[index].text = "edited there again" }
            try MemoFile.save(there, to: memosURL)
            model.reloadFromDisk()
            try expectEqual(model.memos.first { $0.id == open }?.text, "edited there again", "Nothing typed since the save: theirs")
            model.updateMemo(open, text: "edited there again") // the editor shows it

            // Both edit the same memo at once: the two edits are joined, also while typing goes on.
            model.updateMemo(open, text: "장보기\n우유")
            model.saveMemosNow()
            there = try MemoFile.load(memosURL)
            for index in there.indices where there[index].id == open { there[index].text = "장보기\n우유 2개\n달걀" }
            try MemoFile.save(there, to: memosURL)
            model.updateMemo(open, text: "장보기 목록\n우유", from: "장보기\n우유") // typed here before the check
            model.reloadFromDisk()
            try expectEqual(model.memos.first { $0.id == open }?.text, "장보기 목록\n우유 2개\n달걀", "Joined on the check")
            // The editor still had its own text and sends one more keystroke: the join is kept.
            model.updateMemo(open, text: "장보기 목록!\n우유", from: "장보기 목록\n우유")
            try expectEqual(model.memos.first { $0.id == open }?.text, "장보기 목록!\n우유 2개\n달걀", "Joined again while typing")
            // The editor shows the join, then types on: each addition counts once.
            model.updateMemo(open, text: "장보기 목록!\n우유 2개\n달걀", from: "장보기 목록!\n우유")
            model.updateMemo(open, text: "장보기 목록!\n우유 2개\n달걀 6개", from: "장보기 목록!\n우유 2개\n달걀")
            try expectEqual(model.memos.first { $0.id == open }?.text, "장보기 목록!\n우유 2개\n달걀 6개", "No doubled text after the editor caught up")
            model.updateMemo(open, text: "장보기 목록!\n우유 2개\n달걀", from: "장보기 목록!\n우유 2개\n달걀 6개")
            try expectEqual(model.memos.first { $0.id == open }?.text, "장보기 목록!\n우유 2개\n달걀", "Joined again while typing")
            // One more arrives just before closing (inside the two-second check): joined too.
            there = try MemoFile.load(memosURL)
            for index in there.indices where there[index].id == open { there[index].text += "\n빵" }
            try MemoFile.save(there, to: memosURL)
            model.closeMemo()
            try expectEqual(try MemoFile.load(memosURL).first { $0.id == open }?.text, "장보기 목록!\n우유 2개\n달걀\n빵", "and saved")
        }

        try await test("the cat's bubble slides inward near a screen edge (same cases as chatter.test.ts)") {
            try expectEqual(PetBubble.shift(centerX: 150, width: 200, stripWidth: 300), 0, "Room on both sides")
            try expectEqual(PetBubble.shift(centerX: 232, width: 212, stripWidth: 300), -44, "Near the right edge")
            try expectEqual(PetBubble.pointer(shift: -44, width: 212), 44, "Pointer back toward the cat")
            try expectEqual(PetBubble.shift(centerX: 70, width: 230, stripWidth: 300), 51, "Near the left edge")
            try expectEqual(PetBubble.pointer(shift: 51, width: 230), -51, "Pointer back toward the cat")
            try expectEqual(PetBubble.pointer(shift: -120, width: 100), 32, "Never into the rounded corner")
            try expectEqual(PetBubble.shift(centerX: 150, width: 0, stripWidth: 300), 0, "Not measured yet")
        }

        try await test("the desk: one window, its panes in sidebar order, ⌘1…⌘9 and the old entry points") {
            // #240 (D4 B, docs/plans/desk-sidebar-cases.json): four groups of six rows or fewer.
            try expectEqual(DeskPane.allCases.map(\.rawValue),
                            ["calendar", "history", "appearance", "notifications", "clock", "repeating", "events", "pet", "drawer", "spaces", "storage", "ai", "help"], "Sidebar order")
            try expectEqual(DeskPane.Section.view.panes, [.calendar, .history], "보기")
            try expectEqual(DeskPane.Section.settings.panes, [.appearance, .notifications, .clock, .repeating, .events, .pet], "설정")
            try expectEqual(DeskPane.Section.data.panes, [.drawer, .spaces, .storage, .ai], "메모와 데이터")
            try expectEqual(DeskPane.Section.help.panes, [.help], "도움")
            try expectEqual(DeskPane.allCases.compactMap(\.shortcut), Array(1...9), "⌘1…⌘9 for the first nine")
            // ⌘1…⌘9 follow the new order, 달력 to 메모 서랍 (as on Windows).
            try expectEqual((1...9).map { number in DeskPane.allCases.first { $0.shortcut == number }! },
                            [.calendar, .history, .appearance, .notifications, .clock, .repeating, .events, .pet, .drawer], "⌘1…⌘9")
            try expect(DeskPane.storage.shortcut == nil && DeskPane.spaces.shortcut == nil && DeskPane.ai.shortcut == nil, "스페이스, 저장과 백업 and AI 연결 have no number")
            try expect(DeskPane.help.shortcut == nil, "도움말 is ⌘? instead")
            let fixture = try Fixture(items: [])
            defer { fixture.cleanup() }
            let model = fixture.model()
            var opened: [DeskPane] = []
            model.onDesk = { opened.append($0) }
            model.showDesk()
            model.showDesk(.storage)
            try expectEqual(opened, [.calendar, .storage], "The note's desk button opens 달력; any pane can be asked for")
            let state = DeskState()
            try expectEqual(state.pane, .calendar, "A new desk starts on 달력")
        }

        try await test("종이 색: 자동 · 낮 · 밤 persists and sets the app's appearance") {
            let fixture = try Fixture(items: [])
            defer { fixture.cleanup() }
            let model = fixture.model()
            try expectEqual(model.paperColor, .auto, "Automatic by default")
            model.paperColor = .night
            try expect(NSApplication.shared.appearance?.name == .darkAqua, "Night: every window dark")
            try expectEqual(fixture.model().paperColor, .night, "Kept for next time")
            model.paperColor = .day
            try expect(NSApplication.shared.appearance?.name == .aqua, "Day: light even in dark mode")
            model.paperColor = .auto
            try expect(NSApplication.shared.appearance == nil, "Automatic follows macOS")
        }

        try await test("Settings shows where everything is kept") {
            let fixture = try Fixture(items: [])
            defer { fixture.cleanup() }
            let model = fixture.model()
            try expectEqual(model.storageFolderURL.standardizedFileURL, fixture.folder.standardizedFileURL, "The list's folder")
            try expectEqual(model.archiveFolderURL.lastPathComponent, "archive", "The record sits in archive/ inside it")
            try expectEqual(AppModel.displayPath(URL(fileURLWithPath: NSHomeDirectory() + "/Library/Application Support/com.noa.PaperTodo")),
                            "~/Library/Application Support/com.noa.PaperTodo", "Home shown as ~")
        }

        try await test("deadlines persist and show in the chosen style") {
            let fixture = try Fixture(items: [("보고서", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            let key = Deadline.day(for: .thisWeek, now: Date(), language: .current)
            model.setDue(model.items[0].id, to: key)
            model.dueStyle = .date
            let reopened = fixture.model()
            try expect(reopened.items[0].dueDate == key && reopened.dueStyle == .date, "Deadline and style persist")
            model.undo()
            try expect(model.items[0].dueDate == nil, "Setting a deadline can be undone")
        }

        try await test("shelves: deadlines leave today until due, later waits, 오늘 하기 brings things back") {
            let fixture = try Fixture(items: [("오늘 일", false), ("보고서", false), ("여행", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            let report = model.items[1].id, trip = model.items[2].id
            let nextWeek = Deadline.key(Calendar.current.date(byAdding: .day, value: 8, to: Date())!)
            model.setDeadline(report, to: nextWeek, keepOnToday: false)
            model.moveToLater(trip)
            try expectEqual(model.visibleItems.map(\.title), ["오늘 일"], "Only today's work on today's sheet")
            try expectEqual(model.remainingCount, 1, "Counts (footer, menu bar, reminders) cover today only")
            try expectEqual(model.aheadItems.map(\.title), ["보고서", "여행"], "The deadline and the later task wait on 앞으로")
            try expectEqual(model.aheadSections().last?.kind, .someday, "Saved for later: 언젠가")
            model.moveToToday(report)
            model.moveToToday(trip)
            try expectEqual(model.visibleItems.map(\.title), ["오늘 일", "보고서", "여행"], "오늘 하기 brings both back")
            try expect(model.items[1].dueDate == nextWeek, "The deadline itself is kept")
            model.setDeadline(report, to: nextWeek, keepOnToday: false)
            try expect(!model.visibleItems.contains { $0.id == report }, "Unchecking 오늘에도 두기 sends it back to the shelf")
            model.addLater("겨울옷")
            try expect(model.aheadItems.map(\.title).contains("겨울옷") && fixture.model().aheadItems.contains { $0.title == "겨울옷" && $0.shelf == .later }, "Adding to 언젠가 persists")
        }

        try await test("notebook font selection persists across models") {
            let fixture = try Fixture(items: [("write", false)])
            defer { fixture.cleanup() }

            for font in NotebookFont.allCases.prefix(3) {
                let model = fixture.model()
                model.notebookFont = font
                try expectEqual(fixture.model().notebookFont, font, "Font preference did not round-trip")
            }
        }

        try await test("all reminder designs persist and completion is idempotent") {
            let fixture = try Fixture(items: [("Action", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            for style in ReminderPresentationStyle.allCases {
                model.reminderStyle = style
                try expectEqual(fixture.model().reminderStyle, style, "Reminder design did not persist")
            }
            let task = try expectItem(model, titled: "Action")
            model.completeTask(task.id)
            model.completeTask(task.id)
            try expect(model.items[0].isCompleted, "A second completion must not uncheck a finished task")
            model.undo()
            try expect(!model.items[0].isCompleted, "Repeated completion must not add another undo action")
        }

        try await test("visible reorder skips hidden completed records") {
            let fixture = try Fixture(items: [("A", false), ("B", true), ("C", false), ("D", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            model.hideCompleted = true

            let d = try expectItem(model, titled: "D")
            model.move(d.id, by: -1)

            try expectEqual(model.visibleItems.map(\.title), ["A", "D", "C"], "Visible order ignored hidden completed rows")
            try expectEqual(model.items.map(\.title), ["A", "B", "D", "C"], "Backing order moved the item to the wrong insertion point")
            try expect(model.items[1].isCompleted, "Hidden completed row lost completion state")
        }

        try await test("drag insertion supports both halves, hidden rows, persistence and undo") {
            let fixture = try Fixture(items: [("A", false), ("Hidden", true), ("B", false), ("C", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            model.hideCompleted = true
            let a = try expectItem(model, titled: "A")
            let c = try expectItem(model, titled: "C")
            model.move(a.id, relativeTo: c.id, after: true)
            try expectEqual(model.visibleItems.map(\.title), ["B", "C", "A"], "Bottom-half drop must reach the last position")
            try expectEqual(fixture.model().items.map(\.title), ["Hidden", "B", "C", "A"], "Dropped order must persist")
            model.undo()
            try expectEqual(model.items.map(\.title), ["A", "Hidden", "B", "C"], "One undo must restore original order")
            model.move(c.id, relativeTo: a.id, after: false)
            try expectEqual(model.visibleItems.map(\.title), ["C", "A", "B"], "Top-half drop must reach first position")
            model.move(c.id, relativeTo: c.id, after: true)
            model.move(UUID(), relativeTo: a.id, after: false)
            model.undo()
            try expectEqual(model.items.map(\.title), ["A", "Hidden", "B", "C"], "Self/foreign drops must not create undo steps")
        }

        try await test("hide completed grace delay and undo preserve task data") {
            let fixture = try Fixture(items: [("Alpha", false), ("Beta", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            model.hideCompleted = true

            let alpha = try expectItem(model, titled: "Alpha")
            model.toggle(alpha.id)
            try expectEqual(model.visibleItems.map(\.title), ["Alpha", "Beta"], "Completed task disappeared before the grace delay")
            try expect(model.items.first(where: { $0.id == alpha.id })?.isCompleted == true, "Toggle did not complete the task")

            // The grace delay is about half a second; a busy machine may take a little longer.
            for _ in 0..<20 where model.visibleItems.count > 1 { try await Task.sleep(for: .milliseconds(100)) }
            try expectEqual(model.visibleItems.map(\.title), ["Beta"], "Completed task remained visible after the grace delay")

            model.undo()
            try expectEqual(model.visibleItems.map(\.title), ["Alpha", "Beta"], "Undo did not restore the task to the visible list")
            let restored = try expectItem(model, titled: "Alpha")
            try expect(!restored.isCompleted && restored.id == alpha.id, "Undo did not restore the original active task data")
        }

        try await test("rapid toggle back keeps the task visible after pending hide expires") {
            let fixture = try Fixture(items: [("Quick", false), ("Later", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            model.hideCompleted = true

            let quick = try expectItem(model, titled: "Quick")
            model.toggle(quick.id)
            model.toggle(quick.id)

            try await Task.sleep(for: .milliseconds(750))
            let current = try expectItem(model, titled: "Quick")
            try expect(!current.isCompleted, "Rapid toggle back left the task completed")
            try expectEqual(model.visibleItems.map(\.title), ["Quick", "Later"], "Canceled hide removed an active task")
        }

        try await test("백업: export, then replace into an empty folder and merge into another") {
            let source = try Fixture(items: [("보고서", false), ("장보기", true)])
            let empty = try Fixture(items: [])
            let other = try Fixture(items: [("다른 컴퓨터 할 일", false)])
            let safety = FileManager.default.temporaryDirectory.appendingPathComponent("PaperTodo-safety-\(UUID().uuidString)")
            defer { source.cleanup(); empty.cleanup(); other.cleanup(); try? FileManager.default.removeItem(at: safety) }
            let model = source.model()
            model.updateMemo(model.newMemo(), text: "옮길 메모")
            model.saveEverything()
            model.calendar.perform(.create(CalendarDraft(title: "회의", date: "2026-10-08", startMinutes: 600, endMinutes: 660, repeatRule: .weekly)))
            let archive = source.folder.appendingPathComponent("archive")
            try FileManager.default.createDirectory(at: archive, withIntermediateDirectories: true)
            try (##"{"completedAt":"2026-10-07T02:00:00Z","createdAt":"2026-10-07T01:00:00Z","id":"x","title":"끝"}"## + "\n")
                .write(to: archive.appendingPathComponent("2026-10.jsonl"), atomically: true, encoding: .utf8)
            let before = try BackupController.files(in: source.folder)
            try expect(Set(before.keys) == ["todos.json", "memos.json", "events.json", "archive/2026-10.jsonl"], "Export missed files: \(before.keys.sorted())")

            // 바꾸기 into an empty folder: the same files.
            let backup = try Backup.parse(BackupController.exportText(folder: source.folder))
            try BackupController.apply(backup, replace: true, folder: empty.folder, safety: safety)
            try expectEqual(try BackupController.files(in: empty.folder), before, "Replace did not give the same files")
            let moved = empty.model()
            try expectEqual(moved.items.map(\.title), ["보고서", "장보기"], "Moved list")
            try expect(moved.calendar.events.count == 1 && moved.calendar.events[0].repeatRule == .weekly, "Moved events")

            // 합치기 into a folder with its own list: both lists, a safety copy of the old state.
            try BackupController.apply(backup, replace: false, folder: other.folder, safety: safety)
            try expectEqual(other.model().items.map(\.title), ["다른 컴퓨터 할 일", "보고서", "장보기"], "Merged list")
            let copies = try FileManager.default.contentsOfDirectory(atPath: safety.path).filter { $0.hasPrefix("가져오기-전-") }
            try expect(!copies.isEmpty, "No safety copy")
            // Merging the same backup again adds nothing.
            try BackupController.apply(backup, replace: false, folder: other.folder, safety: safety)
            try expect(other.model().items.count == 3, "A second merge added again")
            // A bad backup changes nothing.
            var bad = backup
            bad.files["todos.json"] = "{}"
            do { try BackupController.apply(bad, replace: true, folder: other.folder, safety: safety); try expect(false, "Bad backup applied") } catch {}
            try expect(other.model().items.count == 3, "A bad backup changed the folder")
        }

        try await test("빠른 메모: a new memo at the top, the draft kept until it's added") {
            let fixture = try Fixture(items: [])
            defer { fixture.cleanup() }
            let model = fixture.model()
            let first = model.newMemo()
            model.updateMemo(first, text: "older")
            model.closeMemo()
            model.quickMemoDraft = "half a thought"
            try expectEqual(fixture.model().quickMemoDraft, "half a thought", "draft survives a restart")
            model.addMemo(text: "   \n ")
            try expectEqual(model.memos.count, 1, "blank adds nothing")
            model.addMemo(text: "groceries\nmilk")
            try expectEqual(model.memos.first?.text, "groceries\nmilk", "on top")
            try expectEqual(fixture.model().memos.map(\.text), ["groceries\nmilk", "older"], "saved")
            model.quickMemoDraft = ""
            try expect(fixture.preferences.object(forKey: "quickMemo.draft") == nil, "empty draft removed")
        }

        try await test("직접 정하기: typed lengths come back in the menus, newest first") {
            let fixture = try Fixture(items: [])
            defer { fixture.cleanup() }
            let model = fixture.model()
            for minutes in [40, 25, 90, 40, 120, 70] { model.rememberTimer(minutes) }
            try expectEqual(model.timerRecent, [70, 120, 40], "three, no presets")
            try expectEqual(fixture.model().timerRecent, [70, 120, 40], "kept")
            fixture.preferences.set([5, 300, 33], forKey: "timer.recent")
            try expectEqual(fixture.model().timerRecent, [33], "a strange saved list is cleaned")
        }

        try await test("알람: alarms.json saved and read back; a ring just past isn't rung on saving") {
            let fixture = try Fixture(items: [])
            defer { fixture.cleanup() }
            let model = fixture.model()
            let book = model.alarms
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = .current
            let now = calendar.date(from: DateComponents(year: 2026, month: 10, day: 8, hour: 7, minute: 3))!
            let id = book.add(now: now)
            try expectEqual(book.alarms.count, 1, "added")
            var alarm = book.alarm(id)!
            try expect(alarm.time == "07:00" && alarm.days == [1, 2, 3, 4, 5] && alarm.enabled, "new alarm")
            // Thursday 07:03: today's 07:00 is over, it doesn't go off the moment it's added.
            try expect(Alarm.due(book.alarms, now: now, handled: book.handled).isEmpty, "made just after its time")
            alarm.time = "07:30"
            alarm.label = "기상"
            book.update(alarm, now: now)
            let saved = try Alarm.File.decode(Data(contentsOf: fixture.folder.appendingPathComponent("alarms.json"))).alarms
            try expect(saved.count == 1 && saved[0].time == "07:30" && saved[0].label == "기상", "saved: \(saved)")
            try expectEqual(fixture.model().alarms.alarms, book.alarms, "read back")
            try expectEqual(book.next(now: now)?.fire, calendar.date(bySettingHour: 7, minute: 30, second: 0, of: now), "next ring")
            book.setEnabled(id, false, now: now)
            try expect(book.next(now: now) == nil, "off")
            // Another device writes the file: read again.
            let other = Alarm(id: "other", time: "22:00", days: [], createdAt: now)
            try Alarm.File(alarms: book.alarms + [other]).encoded().write(to: fixture.folder.appendingPathComponent("alarms.json"))
            model.reloadFromDisk()
            try expectEqual(book.alarms.map(\.id), [id, "other"], "reloaded")
            book.delete(id)
            try expectEqual(fixture.model().alarms.alarms.map(\.id), ["other"], "deleted")
            // Handled rings are kept per device for three days.
            book.markHandled("other@2026-10-01T22:00", now: now)
            book.markHandled("other@2026-10-07T22:00", now: now)
            try expectEqual(Set(fixture.preferences.stringArray(forKey: "alarm.handled") ?? []), ["other@2026-10-07T22:00", "wake@2026-10-08T07:00".replacingOccurrences(of: "wake", with: id)], "handled")
        }

        // 1.37: 집중 — the line's "보고서 25분 집중", the pick state's keys, the focus record file,
        // and the menu bar's words while focusing.
        try await test("focus: the line focuses on an open to-do with that title, or makes one; 멈추기 takes a made one back") {
            let fixture = try Fixture(items: [("보고서", false), ("장보기", true)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            var commands: [PetCommand] = []
            model.onPetCommand = { commands.append($0) }
            let existing = try expectItem(model, titled: "보고서")
            let candidates = model.intentCandidates(" 보고서  25분 집중")
            let commit = model.commitIntent(text: "보고서 25분 집중", candidates: candidates, index: 0, page: .todos)
            try expectEqual(commands, [.focus(task: existing.id, minutes: 25)], "focus on the open one")
            try expectEqual(model.items.count, 2, "nothing made")
            let made = model.commitIntent(text: "메일 정리 25분 집중", candidates: model.intentCandidates("메일 정리 25분 집중"), index: 0, page: .todos)
            let mail = try expectItem(model, titled: "메일 정리")
            try expectEqual(commands.last, .focus(task: mail.id, minutes: 25), "focus on the made one")
            model.takeBack(made!)
            try expect(!model.items.contains { $0.title == "메일 정리" }, "taken back")
            try expectEqual(commands.last, .focusStep(.discard), "focus ended without a line")
            model.takeBack(commit!)
            try expect(model.items.contains { $0.id == existing.id }, "an existing to-do stays")
            // A done to-do of that title isn't focused on: a new one is made.
            _ = model.commitIntent(text: "장보기 25분 집중", candidates: model.intentCandidates("장보기 25분 집중"), index: 0, page: .todos)
            try expectEqual(model.items.filter { $0.title == "장보기" }.count, 2, "a new 장보기")
        }

        try await test("focus: the pick state — Return focuses on the picked row, a done row stays, Esc cancels") {
            let fixture = try Fixture(items: [("끝낸 일", true), ("읽기", false), ("쓰기", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            var commands: [PetCommand] = []
            model.onPetCommand = { commands.append($0) }
            model.page = .ahead
            model.startFocusPick()
            try expect(model.focusPicking && model.page == .todos, "picking on 오늘")
            let read = try expectItem(model, titled: "읽기")
            try expectEqual(model.selectedTaskID, read.id, "the first open row picked")
            try expect(model.handleListKey(.edit), "Return used")
            try expectEqual(commands, [.focus(task: read.id, minutes: model.pomodoroSettings.focusMinutes)], "focused")
            model.selectedTaskID = try expectItem(model, titled: "끝낸 일").id
            try expect(model.handleListKey(.edit), "Return on a done row")
            try expectEqual(commands.count, 1, "nothing for a done row")
            try expect(model.handleListKey(.clear) && !model.focusPicking, "Esc cancels")
        }

        try await test("focus: while a focus runs Esc asks, the list's keys rest; focus.jsonl gets each record") {
            let fixture = try Fixture(items: [("읽기", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            var commands: [PetCommand] = []
            model.onPetCommand = { commands.append($0) }
            model.finishGuide()
            model.timerState.session = .focus(taskId: "T", title: "읽기", minutes: 25, now: Date())
            try expect(!model.handleListKey(.down), "↓ rests")
            try expect(model.handleListKey(.clear), "Esc used")
            try expectEqual(commands, [.focusStep(.askToStop)], "asks first")
            let start = Date(timeIntervalSince1970: 1_791_000_000)
            let record = Focus.record(id: "r1", taskId: "T", title: "읽기", start: start, end: start.addingTimeInterval(1500), kind: .focus, done: true)!
            model.focusLog.append(record)
            try FileManager.default.createDirectory(at: fixture.folder, withIntermediateDirectories: true)
            try (try String(contentsOf: model.focusLog.url, encoding: .utf8) + #"{"id":"torn"#).write(to: model.focusLog.url, atomically: true, encoding: .utf8)
            model.focusLog.append(Focus.record(id: "r2", title: "", start: start, end: start.addingTimeInterval(300), kind: .timer)!)
            try expectEqual(model.focusLog.records().map(\.id), ["r1", "r2"], "records past a torn line")
            try expectEqual(model.focusLog.url.lastPathComponent, "focus.jsonl", "next to todos.json")
            try expectEqual(model.focusLog.url.deletingLastPathComponent().standardizedFileURL, fixture.folder.standardizedFileURL, "in the storage folder")
        }

        try await test("focus: the menu bar shows ● and the time while focusing, the time for a plain timer, nothing paused") {
            let fixture = try Fixture(items: [("읽기", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            let now = Date()
            var timer = FocusTimer.countdown(minutes: 25, now: now.addingTimeInterval(-(12 * 60 + 30)))
            // #46: a length (12:30 left → "13분"), not a clock's form.
            let words = [FocusTimer.lengthText(12 * 60 + 30, language: .current), FocusTimer.leftText(12 * 60 + 30, language: .current)]
            try expectEqual(MenuBarState.current(model: model, timer: timer, focusing: true, now: now).text, "● " + words[0], "focusing")
            try expectEqual(MenuBarState.current(model: model, timer: timer, now: now).text, words[0], "plain")
            timer.pause(at: now)
            try expectEqual(MenuBarState.current(model: model, timer: timer, focusing: true, now: now).text, "", "paused")
            try expect(MenuBarState.current(model: model, timer: timer, now: now).accessibility.contains(words[1]), "VoiceOver still hears a paused time")
        }

        try await test("handwriting: a title's last letter keeps its ink inside the frame (Ahead, coffee, koffie)") {
            _ = NSApplication.shared
            HandwritingFont.register()
            /// The right-most column with ink, as a share of the width, of `text` drawn in a frame that clips.
            @MainActor func inkRight(_ text: String, font: Font) -> (ink: Int, width: Int) {
                let view = Text(text).font(font).foregroundStyle(Color.black).fixedSize().padding(.vertical, 6).clipped()
                let hosting = NSHostingView(rootView: view)
                let size = hosting.fittingSize
                hosting.frame = NSRect(origin: .zero, size: size)
                hosting.layoutSubtreeIfNeeded()
                let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds)!
                hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
                var right = -1
                for x in 0..<bitmap.pixelsWide {
                    for y in 0..<bitmap.pixelsHigh where (bitmap.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.25 { right = x; break }
                }
                return (right, bitmap.pixelsWide)
            }
            for face in [NotebookFont.pen, .brush] {
                for title in ["Ahead", "coffee", "koffie", "Vooruit", "커피 coffee"] {
                    for size: CGFloat in [20, 34] {
                        let drawn = inkRight(title.handwritten, font: face.handFont(size))
                        // The last inked column is inside the frame, with a pixel to spare.
                        try expect(drawn.ink < drawn.width - 1, "\(face) \(Int(size)) ‘\(title)’: ink reaches the edge (\(drawn.ink) of \(drawn.width))")
                    }
                }
            }
            try expect("오늘 할 일".handwritten == "오늘 할 일" && "coffee".handwritten.hasSuffix("\u{2009}") && "".handwritten.isEmpty, "Korean endings need no space")
        }

        // 1.40: the timer tag doesn't change width as the seconds tick — the time takes the width of its form's widest
        // text ("88:88", "8:88:88") in tabular digits. Same for the focus card's ring and the menu bar's words.
        try await test("the timer tag keeps its width while it counts") {
            _ = NSApplication.shared
            let start = Date(timeIntervalSinceReferenceDate: 800_000_000)
            @MainActor func width(_ minutes: Int, left: TimeInterval, focusTitle: String? = nil) -> CGFloat {
                let timer = FocusTimer.countdown(minutes: minutes, now: start)
                let now = start.addingTimeInterval(TimeInterval(minutes * 60) - left)
                let hosting = NSHostingView(rootView: TimerBoard(timer: timer, focusTitle: focusTitle, now: now))
                return hosting.fittingSize.width
            }
            // 10:00, 9:59, 1:11, 0:08, 59:59 (one form) and 1:00:00, 1:59:59 (the hour form).
            let short = [width(10, left: 600), width(10, left: 599), width(10, left: 71), width(10, left: 8), width(60, left: 3599)]
            let long = [width(60, left: 3600), width(120, left: 7199), width(120, left: 3600 + 11 * 60 + 11)]
            try expect(Set(short).count == 1, "mm:ss widths differ: \(short)")
            try expect(Set(long).count == 1, "h:mm:ss widths differ: \(long)")
            try expect(long[0] > short[0], "the hour form is wider")
            let focused = [width(25, left: 1500, focusTitle: "보고서"), width(25, left: 1111, focusTitle: "보고서"), width(25, left: 9, focusTitle: "보고서")]
            try expect(Set(focused).count == 1, "focus tag widths differ: \(focused)")
            try expect(TabularClock.template("1:02:05") == "8:88:88" && TabularClock.template("09:59") == "88:88", "templates")
            // The menu bar draws "● 21분" (#46) in the system's tabular digits: the same width for every time of a form.
            let font = NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
            @MainActor func bar(_ seconds: TimeInterval) -> CGFloat { (" " + Focus.menuBarText(remaining: seconds) as NSString).size(withAttributes: [.font: font]).width }
            let menu = [600, 599, 1500, 3000].map { bar(TimeInterval($0)) }
            try expect(Set(menu).count == 1, "menu bar widths differ: \(menu)")
            try expect(Set([4200, 5400, 8400].map { bar(TimeInterval($0)) }).count == 1, "menu bar hour form")
        }

        // 1.42.1: a slip's window is the slip's size from the start (not the provisional 520 × 420 with the slip
        // centred in it — a tall 오늘 창 lost its top), and as the slip grows its top edge and middle stay put.
        try await test("a slip window takes the slip's size at once and keeps its top as the slip grows") {
            _ = NSApplication.shared
            SlipMotion.enabled = false
            defer { SlipMotion.enabled = true }
            let fixture = try Fixture(items: [("장보기", false), ("보고서 마무리", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            model.calendar.showForSnapshot([])
            model.alarms.showForSnapshot([])
            defer { model.calendar.showForSnapshot([]); model.alarms.showForSnapshot([]) }
            let timer = FocusTimerState()
            let now = Date()
            @MainActor func view() -> TodayWindowView {
                TodayWindowView(model: model, timer: timer, alarms: model.alarms, calendar: model.calendar, now: now)
            }
            // The slip's own size, measured apart from any window.
            @MainActor func slipSize() -> NSSize { NSHostingView(rootView: view().padding(SlipMetrics.margin).fixedSize()).fittingSize }
            func same(_ a: NSSize, _ b: NSSize) -> Bool { abs(a.width - b.width) < 0.5 && abs(a.height - b.height) < 0.5 }
            let panel = TodayPanel(nonactivating: true)
            defer { panel.orderOut(nil) }
            panel.show(view())
            try expect(same(panel.frame.size, slipSize()), "window \(panel.frame.size) is not the slip's \(slipSize())")
            panel.placeSlip(topCenter: NSPoint(x: 600, y: 700))
            let top = panel.frame.maxY, middle = panel.frame.midX
            // A running timer, an event whose line wraps (in 1시간 46분), and more tasks than fit: a taller slip.
            let start = now.addingTimeInterval(106 * 60)
            model.calendar.showForSnapshot([LocalEvent(id: "wrap", title: "일정 45", date: CalendarDraft.day(start),
                                                       start: CalendarDraft.minutes(start), end: CalendarDraft.minutes(start) + 30)])
            timer.timer = FocusTimer.countdown(minutes: 25, now: now)
            for title in ["회의 자료 보내기", "약 챙겨 먹기", "산책", "메일 정리", "빨래", "책 읽기"] { model.add(title, literal: true) }
            model.setTaskReminder(model.items[2].id, at: now.addingTimeInterval(40 * 60))
            model.setTaskReminder(model.items[3].id, at: now.addingTimeInterval(50 * 60))
            let grown = slipSize()
            try expect(grown.height > 420, "the grown 오늘 창 should be taller than the old provisional window (\(grown.height))")
            for _ in 0..<30 where !same(panel.frame.size, grown) { try await Task.sleep(for: .milliseconds(50)) }
            try expect(same(panel.frame.size, grown), "window \(panel.frame.size) didn't follow the slip to \(grown)")
            try expect(abs(panel.frame.maxY - top) < 0.5 && abs(panel.frame.midX - middle) < 0.5, "the top edge and the middle stay put")
            // A slip shown again in the same window starts from its own size too.
            panel.show(view())
            try expect(same(panel.frame.size, grown), "shown again: window \(panel.frame.size), slip \(grown)")
        }

        // #228 · #229 (docs/plans/slip-move-cases.json): every window here is far off the screens (x −40 000) and clear
        // (alpha 0), and the app is never brought to the front; the beep is counted, not played.
        try await test("#228 a question slip moves by its paper and its title row; its chip, field and button still take clicks") {
            _ = NSApplication.shared
            SlipMotion.enabled = false
            defer { SlipMotion.enabled = true }
            let probe = SlipProbe()
            let panel = ModalSlipPanel(title: "회사를 이 기기에서 보일 시간")
            panel.alphaValue = 0
            defer { panel.orderOut(nil) }
            panel.show(SlipProbeView(probe: probe))
            panel.setFrameOrigin(NSPoint(x: -40_000, y: -40_000))
            guard let hosting = panel.contentView else { throw TestFailure(description: "no slip view") }
            @MainActor func settle() { for _ in 0..<8 { hosting.layoutSubtreeIfNeeded(); RunLoop.main.run(until: Date().addingTimeInterval(0.03)) } }
            settle()
            /// What a press at (x, y) on the paper (from its top left) lands on.
            @MainActor func hit(_ x: CGFloat, _ y: CGFloat, in window: NSWindow = panel) -> NSView? {
                guard let view = window.contentView else { return nil }
                let point = NSPoint(x: SlipMetrics.margin.leading + x, y: view.isFlipped ? SlipMetrics.margin.top + y : view.bounds.height - SlipMetrics.margin.top - y)
                return view.hitTest(view.convert(point, to: view.superview))
            }
            for (name, x, y) in [("the title", 90.0, 30.0), ("the badge", 30, 30), ("the paper beside the chip", 250, 64), ("the paper under the button", 160, 170)] {
                try expect(hit(x, y) is SlipDragView, "\(name) drags the slip (\(String(describing: hit(x, y))))")
            }
            for (name, x, y) in [("the chip", 40.0, 64.0), ("the field", 160, 99), ("the button", 160, 131)] {
                try expect(!(hit(x, y) is SlipDragView), "\(name) takes the click")
            }
            // A slip that hangs from something (빠른 입력, the 오늘 창, the reminders) has no paper to drag by.
            let still = SlipPanel(nonactivating: true)
            still.alphaValue = 0
            still.show(SlipProbeView(probe: SlipProbe()))
            still.setFrameOrigin(NSPoint(x: -40_000, y: -38_000))
            for _ in 0..<4 { still.contentView?.layoutSubtreeIfNeeded(); try await Task.sleep(for: .milliseconds(30)) }
            try expect(!(hit(160, 170, in: still) is SlipDragView), "a slip that doesn't move has no drag area")

            // A drag: the window follows the pointer (no screen has the pointer here, so nothing keeps it in).
            try expect(hit(160, 170) is SlipDragView, "the paper")
            @MainActor func mouse(_ type: NSEvent.EventType, _ x: CGFloat, _ y: CGFloat) -> NSEvent {
                NSEvent.mouseEvent(with: type, location: NSPoint(x: x, y: y), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                   windowNumber: 0, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1)!
            }
            @MainActor func drag(_ steps: [(CGFloat, CGFloat)]) {
                let last = steps.last ?? (0, 0)
                var events = steps.map { mouse(.leftMouseDragged, -39_000 + $0.0, -39_000 + $0.1) } + [mouse(.leftMouseUp, -39_000 + last.0, -39_000 + last.1)]
                panel.dragSlip(from: mouse(.leftMouseDown, -39_000, -39_000)) { events.isEmpty ? nil : events.removeFirst() }
            }
            let before = panel.frame.origin
            drag([(1, 1), (2, 0)])
            try expectEqual(panel.frame.origin, before, "a press that moves 2 pt is a click, not a drag")
            try expect(!panel.movedByUser, "not moved")
            drag([(5, 2), (18, 9), (30, -20)])
            try expectEqual(panel.frame.origin, NSPoint(x: before.x + 30, y: before.y - 20), "the window followed the pointer")
            try expect(panel.movedByUser, "moved by the person")
            // Taller (a time row added): it grows from where it was put — its top edge and its middle stay.
            let top = panel.frame.maxY, middle = panel.frame.midX, height = panel.frame.height
            probe.rows = 3
            for _ in 0..<30 where abs(panel.frame.height - height) < 0.5 { hosting.layoutSubtreeIfNeeded(); try await Task.sleep(for: .milliseconds(30)) }
            try expect(panel.frame.height > height + 40, "the slip grew (\(height) → \(panel.frame.height))")
            try expect(abs(panel.frame.maxY - top) < 0.5 && abs(panel.frame.midX - middle) < 0.5, "it grew from where it was moved to")

            // On a screen: the head stays on it (the Mac's y goes up; SlipMove's cases are top-down).
            let area = NSRect(x: 0, y: 80, width: 1440, height: 795)
            let window = NSRect(x: 400, y: 300, width: 320 + 52, height: 300)
            let slipTop = { (origin: NSPoint) in origin.y + window.height - SlipMetrics.margin.top }
            try expectEqual(slipTop(SlipPanel.dragged(window, by: CGVector(dx: 0, dy: 5_000), in: area)), area.maxY, "up: under the menu bar")
            try expectEqual(slipTop(SlipPanel.dragged(window, by: CGVector(dx: 0, dy: -5_000), in: area)), area.minY + SlipMove.head, "down: the head stays")
            let left = SlipPanel.dragged(window, by: CGVector(dx: -5_000, dy: 0), in: area)
            try expectEqual(left.x + window.width - SlipMetrics.margin.trailing, area.minX + SlipMove.keep, "left: 80 stays")
            try expectEqual(SlipPanel.dragged(window, by: CGVector(dx: 12, dy: -7), in: area), NSPoint(x: 412, y: 293), "inside: as dragged")
        }

        // #246: 빠른 입력 and 빠른 메모 move by their paper and title row too (far off the screens, clear, never in front).
        try await test("#246 the quick entry and quick note slips move by their paper; their field and buttons still take clicks") {
            _ = NSApplication.shared
            SlipMotion.enabled = false
            defer { SlipMotion.enabled = true }
            let fixture = try Fixture(items: [("A", false)])
            defer { fixture.cleanup() }
            let model = fixture.model()
            for (name, view) in [("quick entry", AnyView(QuickEntryView(model: model, text: "내일 3시 회의"))), // ko-only: sample text
                                 ("quick note", AnyView(QuickMemoView(model: model, text: "장보기")))] { // ko-only: sample text
                let panel = SlipPanel(nonactivating: true)
                panel.movesByPaper = true
                panel.alphaValue = 0
                defer { panel.orderOut(nil) }
                panel.show(view)
                panel.setFrameOrigin(NSPoint(x: -40_000, y: -36_000))
                for _ in 0..<8 { panel.contentView?.layoutSubtreeIfNeeded(); try await Task.sleep(for: .milliseconds(30)) }
                @MainActor func hit(_ x: CGFloat, _ y: CGFloat) -> NSView? {
                    guard let view = panel.contentView else { return nil }
                    let point = NSPoint(x: SlipMetrics.margin.leading + x, y: view.isFlipped ? SlipMetrics.margin.top + y : view.bounds.height - SlipMetrics.margin.top - y)
                    return view.hitTest(view.convert(point, to: view.superview))
                }
                let width = panel.slipFrame.width, height = panel.slipFrame.height
                try expect(hit(width / 2, 30) is SlipDragView, "\(name): the title row drags it (\(String(describing: hit(width / 2, 30))))")
                try expect(hit(width - 30, 30).map { !($0 is SlipDragView) } ?? false, "\(name): the × takes the click")
                try expect(hit(width - 60, height - 28).map { !($0 is SlipDragView) } ?? false, "\(name): the button takes the click")
                // The field: whatever is under the line's middle is not the paper.
                let field = (0..<30).lazy.map { CGFloat($0) * 4 + 70 }.first { !(hit(width / 2, $0) is SlipDragView) }
                try expect(field != nil, "\(name): the field takes the click")
                var moved = 0
                panel.onMoved = { moved += 1 }
                @MainActor func mouse(_ type: NSEvent.EventType, _ x: CGFloat, _ y: CGFloat) -> NSEvent {
                    NSEvent.mouseEvent(with: type, location: NSPoint(x: x, y: y), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                       windowNumber: 0, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseUp ? 0 : 1)!
                }
                let before = panel.frame.origin
                var events = [mouse(.leftMouseDragged, -39_990, -35_990), mouse(.leftMouseDragged, -39_960, -36_020), mouse(.leftMouseUp, -39_960, -36_020)]
                panel.dragSlip(from: mouse(.leftMouseDown, -40_000, -36_000)) { events.isEmpty ? nil : events.removeFirst() }
                try expectEqual(panel.frame.origin, NSPoint(x: before.x + 40, y: before.y - 20), "\(name): the window followed the pointer")
                try expectEqual(moved, 1, "\(name): the place is kept once, at the drop")
            }
        }

        try await test("#229 a click elsewhere while a question is up brings it forward, shakes it once and beeps once") {
            _ = NSApplication.shared
            let cases = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "../docs/plans/slip-move-cases.json"))) as! [String: Any]
            let nudge = cases["nudge"] as! [String: Any]
            try expectEqual(Motion.shake, (nudge["shake"] as! [NSNumber]).map { CGFloat($0.doubleValue) }, "the shake")
            try expectEqual(Motion.blink, (nudge["blink"] as! [NSNumber]).map(\.doubleValue), "the tape's blink")
            try expectEqual([nudge["motion"] as! String, nudge["blinkStep"] as! String], ["bounce", "quick"], "the motion words")
            var beeps = 0
            let playing = SlipModal.beep
            SlipModal.beep = { beeps += 1 }
            defer { SlipModal.beep = playing }

            let question = ModalSlipPanel(title: "종이냥 종료")
            question.show(SlipAlertView(symbol: "exclamationmark.circle", title: "종이냥 종료", message: "아직 저장하지 못한 할 일이 있어요",
                                        choices: [SlipAlert.Choice(title: "취소", isCancel: true), SlipAlert.Choice(title: "종료", role: .primary, isDefault: true)]))
            var windows: [String: NSWindow] = ["question": question]
            @MainActor func made(_ window: NSWindow, _ level: NSWindow.Level) -> NSWindow {
                window.isReleasedWhenClosed = false
                window.level = level
                return window
            }
            @MainActor func plain(_ level: NSWindow.Level) -> NSWindow {
                made(RecordingWindow(contentRect: NSRect(x: 0, y: 0, width: 40, height: 40), styleMask: [.borderless], backing: .buffered, defer: false), level)
            }
            windows["note"] = plain(.normal)
            windows["desk"] = plain(.normal)
            windows["drawer"] = plain(.floating)
            windows["reminder"] = plain(.floating)
            windows["pet"] = plain(.floating)
            windows["today"] = made(SlipPanel(nonactivating: true), .popUpMenu)
            let times = SlipPanel(nonactivating: false)
            times.movesByPaper = true
            windows["times"] = made(times, .floating)
            let alarm = AlarmRingPanel(nonactivating: true)
            alarm.worksWhenModal = true
            windows["alarm"] = made(alarm, .statusBar)
            for (index, window) in windows.values.enumerated() {
                window.alphaValue = 0
                window.setFrameOrigin(NSPoint(x: -40_000 + CGFloat(index) * 600, y: -40_000))
                window.orderFront(nil)
            }
            defer { for window in windows.values { window.orderOut(nil) } }
            @MainActor func press(_ name: String, _ type: NSEvent.EventType = .leftMouseDown) -> NSEvent {
                NSEvent.mouseEvent(with: type, location: NSPoint(x: 10, y: 10), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                   windowNumber: windows[name]!.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
            }
            for entry in (cases["clicks"] as! [[String: Any]]) where entry["up"] as? String == "question" {
                let name = entry["click"] as! String
                try expectEqual(SlipModal.nudges(press(name), question) ? "nudge" : "works", entry["then"] as! String, entry["case"] as! String)
                try expect(!SlipModal.nudges(press(name, .leftMouseUp), question), "\(name): only a press nudges")
            }

            // The session itself: a left and a right click on the note, one on the drawer, one on the alarm (which works),
            // a tenth of a second apart like clicks by hand; then the answer.
            var answered = false
            for (index, click) in [("note", NSEvent.EventType.leftMouseDown), ("note", .rightMouseDown), ("drawer", .leftMouseDown), ("alarm", .leftMouseDown)].enumerated() {
                let timer = Timer(timeInterval: 0.05 + 0.1 * Double(index), repeats: false) { _ in
                    MainActor.assumeIsolated { NSApp.postEvent(press(click.0, click.1), atStart: false) }
                }
                RunLoop.main.add(timer, forMode: .common)
            }
            let answer = Timer(timeInterval: 0.6, repeats: false) { _ in MainActor.assumeIsolated { answered = true; SlipModal.wake() } }
            RunLoop.main.add(answer, forMode: .common)
            SlipModal.run(question) { answered }
            absorbWake()
            try expectEqual(question.nudges.count, 3, "each blocked press nudged the question once")
            try expectEqual(beeps, 3 * (nudge["beeps"] as! Int), "one beep each")
            try expect((windows["note"] as! RecordingWindow).presses == 0, "the note never got the presses")
            try expect(NSApp.modalWindow == nil, "the session ended with the answer")

            // The settings slip (보일 시간) holds nothing up: no session, the windows work (slip-move-cases.json S1–S4).
            SlipAlert.open(id: "probe:times", title: "회사를 이 기기에서 보일 시간") { done in
                Button("저장") { done() }
            }
            absorbWake()
            try expect(NSApp.modalWindow == nil, "the times slip isn't modal")
            for entry in (cases["clicks"] as! [[String: Any]]) where entry["up"] as? String == "settings" {
                try expectEqual(NSApp.modalWindow == nil ? "works" : "nudge", entry["then"] as! String, entry["case"] as! String)
            }
            if let probe = SlipAlert.openSlip("probe:times") { SlipAlert.close(probe) }
            absorbWake()
        }

        try await test("#229 the times slip doesn't wait for an answer, and a space has one at a time") {
            _ = NSApplication.shared
            SlipMotion.enabled = false
            defer { SlipMotion.enabled = true }
            let fixture = try Fixture(items: [])
            defer { fixture.cleanup() }
            let model = fixture.model()
            let cases = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "../docs/plans/slip-move-cases.json"))) as! [String: Any]
            for entry in cases["open"] as! [[String: Any]] {
                let keys = entry["keys"] as! [String]
                var panels: [ObjectIdentifier: SlipPanel] = [:]
                for key in keys {
                    // Returns at once: the slip is up and the app goes on.
                    SpaceTimesSlip.present(model: model, key: key, name: key, color: nil)
                    absorbWake()
                    guard let panel = SlipAlert.openSlip(SpaceTimesSlip.slipID(key)) else { throw TestFailure(description: "\(key): no slip") }
                    try expect(panel.frame.minX < -30_000, "off the screens in a check")
                    try expect(panel.movesByPaper && panel.level == .floating && panel.hidesOnDeactivate, "a floating slip that moves")
                    try expect(NSApp.modalWindow == nil, "nothing waits")
                    panels[ObjectIdentifier(panel)] = panel
                }
                try expectEqual(panels.count, entry["slips"] as! Int, entry["case"] as! String)
                for key in Set(keys) {
                    guard let panel = SlipAlert.openSlip(SpaceTimesSlip.slipID(key)) else { continue }
                    // 취소 (Esc): the slip goes away and the space can open a new one.
                    SlipAlert.close(panel)
                }
                absorbWake()
                for key in Set(keys) { try expect(SlipAlert.openSlip(SpaceTimesSlip.slipID(key)) == nil, "\(key) closed") }
            }
        }

        try await test("#253 the questions that replace the whole list say so where they are made (widget-ask-cases.json)") {
            let cases = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "../docs/plans/widget-ask-cases.json"))) as! [String: Any]
            let folder = URL(fileURLWithPath: "Sources/PaperTodo")
            let files = try FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil).filter { $0.pathExtension == "swift" }
            let lines = try files.flatMap { try String(contentsOf: $0, encoding: .utf8).components(separatedBy: "\n") }
                .filter { !$0.trimmingCharacters(in: .whitespaces).hasPrefix("//") }
            var tagged = 0
            for entry in cases["questions"] as! [[String: Any]] {
                if let apps = entry["apps"] as? [String], !apps.contains("mac") { continue }
                let message = (entry["message"] as? String) ?? (entry["message"] as! [String: String])["mac"]!
                let found = lines.filter { $0.contains("\(message)\")") && $0.contains("message: ") }
                let name = entry["case"] as! String
                try expect(!found.isEmpty, "\(name): the question “\(message)” is asked")
                for line in found {
                    try expectEqual(line.contains("replacesList: true"), entry["replacesList"] as! Bool, "\(name): \(line.trimmingCharacters(in: .whitespaces).prefix(80))")
                }
                if entry["replacesList"] as! Bool { tagged += found.count }
            }
            try expectEqual(lines.filter { $0.contains("replacesList: true") }.count, tagged, "every replacesList: true is a question of the shared list")
        }

        try await test("#253 while a question is up the desktop widgets and their day sheet work; one that replaces the list holds 넣기") {
            _ = NSApplication.shared
            let cases = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "../docs/plans/widget-ask-cases.json"))) as! [String: Any]
            var beeps = 0
            let playing = SlipModal.beep
            SlipModal.beep = { beeps += 1 }
            defer { SlipModal.beep = playing }
            let question = ModalSlipPanel(title: "되돌리기")
            question.show(SlipAlertView(symbol: "clock.arrow.circlepath", title: "되돌리기", message: "11월 4일 백업으로 되돌릴까요?",
                                        choices: [SlipAlert.Choice(title: "취소", isCancel: true), SlipAlert.Choice(title: "합치기", role: .primary, isDefault: true)]))
            let widget = CalendarWidgetPanel(size: NSSize(width: 120, height: 120))
            widget.level = CalendarWidgetPanel.level(.top)
            let sheet = WidgetDaySheetController().makePanel()
            let note = RecordingWindow(contentRect: NSRect(x: 0, y: 0, width: 80, height: 80), styleMask: [.borderless], backing: .buffered, defer: false)
            note.isReleasedWhenClosed = false
            let windows: [NSWindow] = [question, widget, sheet, note]
            for (index, window) in windows.enumerated() {
                window.alphaValue = 0
                window.setFrameOrigin(NSPoint(x: -40_000 + CGFloat(index) * 600, y: -40_000))
                window.orderFront(nil)
            }
            defer { for window in windows { window.orderOut(nil) } }
            @MainActor func press(_ window: NSWindow, _ type: NSEvent.EventType = .leftMouseDown) -> NSEvent {
                NSEvent.mouseEvent(with: type, location: NSPoint(x: 10, y: 10), modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                   windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
            }
            // The widget and the sheet aren't held (their presses, hovers and keys go to them); the note still is.
            for (name, window) in [("widget", widget as NSWindow), ("sheet", sheet as NSWindow)] {
                try expect(window.worksWhenModal, "\(name) works while a question waits")
                for type in [NSEvent.EventType.leftMouseDown, .rightMouseDown, .leftMouseUp, .mouseMoved] {
                    try expect(!SlipModal.holds(press(window, type), question), "\(name): \(type) isn't held")
                }
                try expect(!SlipModal.nudges(press(window), question), "\(name): a press doesn't nudge")
            }
            try expect(SlipModal.nudges(press(note), question), "the note is still held")
            // Z1: the question over the day sheet over a widget kept on top over the windows.
            let levels = cases["levels"] as! [String: Any]
            let level: [String: NSWindow.Level] = ["question": question.level, "sheet": sheet.level, "widgetOnTop": widget.level, "window": .normal]
            let top = (levels["top"] as! [String]).map { level[$0]!.rawValue }
            try expect(zip(top, top.dropFirst()).allSatisfy { $0 > $1 }, "\(levels["case"] as! String): \(top)")
            // T1–T3: a widget never takes the keys, so what is being typed elsewhere keeps its text and its caret.
            for entry in cases["typing"] as! [[String: Any]] {
                let name = entry["case"] as! String
                let field = NSTextView(frame: NSRect(x: 0, y: 0, width: 200, height: 40))
                field.string = "꽃집 들러서 화분 사기"
                field.setSelectedRange(NSRange(location: 3, length: 0))
                let typing = NSWindow(contentRect: NSRect(x: -40_000, y: -38_000, width: 200, height: 40), styleMask: [.borderless], backing: .buffered, defer: false)
                typing.isReleasedWhenClosed = false
                typing.contentView = field
                _ = typing.makeFirstResponder(field)
                widget.sendEvent(press(widget))
                widget.sendEvent(press(widget, .leftMouseUp))
                try expect(!widget.canBecomeKey && widget.styleMask.contains(.nonactivatingPanel) && !widget.isKeyWindow, "\(name): the widget took no keys")
                try expect(typing.firstResponder === field, "\(name): the field kept the keyboard")
                try expectEqual(field.string, "꽃집 들러서 화분 사기", "\(name): the text")
                try expectEqual(field.selectedRange(), NSRange(location: 3, length: 0), "\(name): the caret")
                try expectEqual(entry["then"] as! String, "kept", name)
            }

            // The sessions: what is up for the widgets, and what waits (widget-ask-cases.json `presses`).
            @MainActor func session(_ asked: SlipMove.Asked, over: NSWindow?, on panel: SlipPanel? = nil, _ steps: [@MainActor () throws -> Void]) throws {
                var answered = false
                var failure: Error?
                for (index, step) in steps.enumerated() {
                    let timer = Timer(timeInterval: 0.05 + 0.1 * Double(index), repeats: false) { _ in
                        MainActor.assumeIsolated {
                            do { try step() } catch { failure = failure ?? error }
                        }
                    }
                    RunLoop.main.add(timer, forMode: .common)
                }
                let answer = Timer(timeInterval: 0.1 + 0.1 * Double(steps.count), repeats: false) { _ in MainActor.assumeIsolated { answered = true; SlipModal.wake() } }
                RunLoop.main.add(answer, forMode: .common)
                SlipModal.run(panel ?? question, asked: asked, over: over) { answered }
                absorbWake()
                if let failure { throw failure }
            }
            let presses = cases["presses"] as! [[String: Any]]
            for up in [SlipMove.Asked.question, .replacesList] {
                let start = question.nudges.count, heard = beeps
                var expected = 0
                try session(up, over: note, [
                    { try expectEqual(SlipAsking.shared.up, up, "\(up): what is up") },
                    // A press on the widget goes to it, unheld.
                    { NSApp.postEvent(press(widget), atStart: false) },
                    {
                        for entry in presses where entry["up"] as? String == up.rawValue {
                            let kind = SlipMove.WidgetPress(rawValue: entry["press"] as! String)!
                            guard kind == .add || kind == .undo else { continue }
                            let waits = SlipModal.waits(kind)
                            try expectEqual(waits ? "waits" : "works", entry["then"] as! String, entry["case"] as! String)
                            if waits { expected += 1 }
                        }
                    },
                    // O1 · O2: another window comes forward under it; the window it was asked over nudges it.
                    { SlipModal.cameForward(widget) },
                    { SlipModal.cameForward(note); expected += 1 },
                ])
                try expectEqual(question.nudges.count - start, expected, "\(up): the nudges")
                try expectEqual(beeps - heard, expected, "\(up): one beep each")
                try expectEqual(note.presses, 0, "\(up): the note never got a press")
                try expectEqual(SlipAsking.shared.up, .none, "\(up): answered, nothing is up")
            }
            // 가져오기 → 바꾸기: a question asked while another waits gives the first one back when it is answered.
            let inner = ModalSlipPanel(title: "바꾸기")
            inner.show(SlipAlertView(symbol: "arrow.triangle.2.circlepath", title: "바꾸기", message: "지금 것을 이 백업으로 바꿀까요?",
                                     choices: [SlipAlert.Choice(title: "취소", isCancel: true)]))
            inner.alphaValue = 0
            inner.setFrameOrigin(NSPoint(x: -37_000, y: -40_000))
            defer { inner.orderOut(nil) }
            try session(.question, over: nil, [
                {
                    inner.orderFront(nil)
                    try session(.replacesList, over: nil, on: inner, [{ try expectEqual(SlipAsking.shared.up, .replacesList, "the inner question") }])
                    try expectEqual(SlipAsking.shared.up, .question, "the outer question again")
                    // (The outer answer's wake may have come while the inner question was up: wake it again.)
                    SlipModal.wake()
                },
            ])
            try expectEqual(SlipAsking.shared.up, .none, "nothing is up")
            try expect(NSApp.modalWindow == nil, "the sessions ended")
        }

        try await test("메모 서랍 (1.45): a key restyles only its own lines, and the memo looks as if it were restyled whole") {
            _ = NSApplication.shared
            // #84: the same for the markdown editor, marks hidden off the caret's line (the caret moving restyles only the
            // lines it left and reached) and with 기호 늘 보이기.
            let memoText = MemoText()
            for markdown in [nil, memoText, MemoText(showMarks: true)] as [MemoText?] {
                let parent = DrawerTextView(text: .constant(""), palette: DrawerPalette.of(.day), bodyFont: memoText.font(),
                                            titleFont: .systemFont(ofSize: 20, weight: .semibold), lineHeight: memoText.line,
                                            titleLineHeight: MemoSlipStyle.titleRow, markdown: markdown)
                @MainActor func made(_ text: String, caret: NSRange? = nil) -> (DrawerTextView.KeyTextView, DrawerTextView.Coordinator) {
                    let view: DrawerTextView.KeyTextView
                    if markdown != nil {
                        let storage = NSTextStorage(), layout = MemoLayoutManager(), container = NSTextContainer()
                        storage.addLayoutManager(layout)
                        layout.addTextContainer(container)
                        view = DrawerTextView.KeyTextView(frame: .zero, textContainer: container)
                    } else {
                        view = DrawerTextView.KeyTextView()
                    }
                    view.isRichText = false
                    let coordinator = DrawerTextView.Coordinator(parent)
                    view.string = text
                    if let caret { view.setSelectedRange(caret) }
                    view.delegate = coordinator
                    coordinator.restyle(view, full: true)
                    return (view, coordinator)
                }
                let (view, coordinator) = made("\n  \n장보기 목록\n- [ ] 우유\n    indented code\ngit log --oneline -5\n보통 줄", caret: NSRange(location: 0, length: 0))
                let pieces = ["가", "a", " ", "\n", "    ", "git status x", "$ ls", "`x`", "\n\n", "제목 ", "- [ ] ", "\t"]
                    + (markdown == nil ? [] : ["**", "# ", "```", "\n```\n", "> ", "- ", "1. ", "~~", "[a](b)", "---", "_x_ "])
                var seed: UInt64 = 11
                func next(_ n: Int) -> Int {
                    seed = seed &* 6364136223846793005 &+ 1442695040888963407
                    return Int((seed >> 33) % UInt64(max(1, n)))
                }
                for step in 0..<600 {
                    let length = (view.string as NSString).length
                    let at = next(length + 1)
                    let cut = next(4) == 0 ? min(next(6), length - at) : 0
                    let typed = next(5) == 0 ? "" : pieces[next(pieces.count)]
                    view.insertText(typed, replacementRange: NSRange(location: at, length: cut))
                    // Now and then the caret moves on its own (a click, an arrow).
                    if markdown != nil, next(4) == 0 { view.setSelectedRange(NSRange(location: next((view.string as NSString).length + 1), length: 0)) }
                    let (whole, _) = made(view.string, caret: view.selectedRange())
                    try expect(view.textStorage!.isEqual(to: whole.textStorage!),
                               "\(markdown.map { $0.showMarks ? "marks shown" : "markdown" } ?? "plain") step \(step): ‘\(typed)’ at \(at) (cut \(cut)) in \(view.string.debugDescription)")
                }
                try expect(coordinator.lineRestyles > 300, "most keys restyled only their lines (\(coordinator.lineRestyles) of 600)")
            }
        }

        try await test("#3: the open memo's words leave the text view as a native string, exactly as the view has them") {
            // A bridged NSString made every later comparison of a Korean memo go through Unicode normalization (0.2 s a key
            // at 1 MB); the copy must be the same characters, lone surrogates and NULs included.
            let samples = ["", "a", "한글 메모\n- [ ] 우유", "e\u{301} é 각 각", "🐈‍⬛ 고양이 👍🏽", "줄\u{0}중간", String(repeating: "긴 줄 ", count: 40_000),
                           String(utf16CodeUnits: [0x41, 0xD800, 0x42], count: 3), String(utf16CodeUnits: [0xDC00], count: 1)]
            for sample in samples {
                let words = NSMutableString(string: sample)
                let copy = DrawerTextView.KeyTextView.native(words)
                try expect(Array(copy.utf16) == Array((words as String).utf16) || copy == (words as String),
                           "the copy of \(sample.prefix(20).debugDescription) has the same characters")
                try expect(copy.utf8.withContiguousStorageIfAvailable { _ in true } == true, "the copy of \(sample.prefix(20).debugDescription) is native")
            }
            _ = NSApplication.shared
            final class Box { var text = "" }
            let box = Box()
            let memoText = MemoText()
            let parent = DrawerTextView(text: Binding(get: { box.text }, set: { box.text = $0 }), palette: DrawerPalette.of(.day), bodyFont: memoText.font(),
                                        lineHeight: memoText.line, markdown: memoText)
            let storage = NSTextStorage(), layout = MemoLayoutManager(), container = NSTextContainer()
            storage.addLayoutManager(layout)
            layout.addTextContainer(container)
            let view = DrawerTextView.KeyTextView(frame: .zero, textContainer: container)
            let coordinator = DrawerTextView.Coordinator(parent)
            view.delegate = coordinator
            view.string = "메모 제목\n본문"
            view.setSelectedRange(NSRange(location: (view.string as NSString).length, length: 0))
            view.insertText("가a", replacementRange: NSRange(location: NSNotFound, length: 0))
            try expect(box.text == "메모 제목\n본문가a" && coordinator.shown == box.text, "the binding has the keys (\(box.text.debugDescription))")
            try expect(box.text.utf8.withContiguousStorageIfAvailable { _ in true } == true, "the binding's text is native")
        }

        try await test("입력 줄 (#162): pasted lines grow the line up to 4, then it scrolls with the caret in sight; the keys still work") {
            _ = NSApplication.shared
            HandwritingFont.register()
            let fixture = try Fixture(items: [])
            defer { fixture.cleanup() }
            let model = fixture.model()
            model.calendar.showForSnapshot([])
            model.alarms.showForSnapshot([])
            // Never shown: a window that is never ordered in, so nothing reaches the screen.
            let hosting = NSHostingView(rootView: IntentLineView(model: model, page: .todos).frame(width: 420).fixedSize(horizontal: false, vertical: true))
            let window = NSWindow(contentRect: NSRect(x: -40_000, y: -40_000, width: 420, height: 400), styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            defer { window.close() }
            window.contentView = hosting
            @MainActor func settle() {
                for _ in 0..<10 { hosting.layoutSubtreeIfNeeded(); RunLoop.main.run(until: Date().addingTimeInterval(0.03)) }
            }
            settle()
            @MainActor func keyField(_ view: NSView) -> IntentField.KeyField? {
                if let field = view as? IntentField.KeyField { return field }
                return view.subviews.lazy.compactMap { keyField($0) }.first
            }
            guard let field = keyField(hosting) else { throw TestFailure(description: "no field in the line") }
            let font = model.notebookFont.handNSFont(20)
            let line = IntentField.lineHeight(font)
            try expect(line > 15 && line < 40, "a line of the hand at 20 pt (\(line))")
            try expectEqual(field.frame.height, line, "empty: one line, as tall as before")
            try expect(window.makeFirstResponder(field), "the field takes the keyboard")
            guard let editor = field.currentEditor() as? NSTextView else { throw TestFailure(description: "no field editor") }
            // A paste from a private pasteboard (never the user's clipboard).
            let board = NSPasteboard(name: NSPasteboard.Name("PaperTodo.PresentationTests.\(UUID().uuidString)"))
            defer { board.releaseGlobally() }
            @MainActor func paste(_ text: String) {
                board.clearContents()
                board.setString(text, forType: .string)
                _ = editor.readSelection(from: board, type: .string)
                settle()
            }
            /// The caret's line lies inside the field itself (not only in the field editor's room around it). Asked
            /// through the text input API, as the field does: the editor's layout manager would turn it to TextKit 1.
            @MainActor func caretShown() -> Bool {
                guard let caret = IntentField.KeyField.caretLine(editor, window: window) else { return false }
                let line = field.convert(caret, from: editor)
                return line.height > 0 && line.minY >= field.bounds.minY - 1 && line.maxY <= field.bounds.maxY + 1
            }
            /// The field editor is still TextKit 2, as AppKit gives it (TextKit 1 lays lines out with the font's leading).
            @MainActor func textKit2() -> Bool { editor.textLayoutManager != nil }
            let chipsHeight = NSHostingView(rootView: IntentChips(candidates: model.intentCandidates("장보기 목록\n우유"), picked: 0)
                .frame(width: 400)).fittingSize.height
            /// What the field and its editor draw sits under the chips (8 pt padding, the chips) and inside the card.
            @MainActor func underChips() -> Bool {
                var frame = hosting.convert(field.bounds, from: field)
                if let clip = editor.superview, editor.window != nil { frame = frame.union(hosting.convert(clip.bounds, from: clip)) }
                let top = hosting.isFlipped ? frame.minY : hosting.bounds.height - frame.maxY
                let bottom = hosting.isFlipped ? frame.maxY : hosting.bounds.height - frame.minY
                return top >= 8 + chipsHeight && bottom <= hosting.bounds.height - 1.5
            }
            paste("장보기 목록")
            try expectEqual(field.frame.height, line, "one line: as tall as before")
            editor.selectAll(nil)
            paste("장보기 목록\n\n우유 · 달걀 · 빵")
            try expectEqual(field.stringValue, "장보기 목록\n\n우유 · 달걀 · 빵", "the lines are kept as pasted")
            try expect(textKit2(), "the field editor is TextKit 2")
            try expect(abs(field.frame.height - 3 * line) < 0.5, "3 lines: two lines taller (\(field.frame.height))")
            try expect(underChips(), "3 lines: under the chips, inside the card")
            try expect(caretShown(), "3 lines: the caret is in sight")
            try expect(editor.visibleRect.minY < 0.5, "3 lines: nothing to scroll")
            editor.selectAll(nil)
            paste("장보기 목록\n우유\n달걀\n빵\n사과\n휴지")
            try expect(abs(field.frame.height - 4 * line) < 0.5, "6 lines: 4 lines high, no more (\(field.frame.height))")
            try expect(underChips(), "6 lines: under the chips, inside the card")
            try expect(caretShown(), "6 lines: the caret at the end is in sight")
            try expect(editor.visibleRect.minY > line, "6 lines: scrolled down inside the field (\(editor.visibleRect.minY))")
            // Scrolled, only the field editor draws the words: the field's own drawing (unscrolled, its last line ending
            // in …) stays out from under it.
            do {
                let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(field.bounds.width), pixelsHigh: Int(field.bounds.height),
                                              bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                              bytesPerRow: 0, bitsPerPixel: 0)!
                NSGraphicsContext.saveGraphicsState()
                NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
                field.cell?.drawInterior(withFrame: field.bounds, in: field)
                NSGraphicsContext.restoreGraphicsState()
                var ink = 0
                for y in 0..<bitmap.pixelsHigh {
                    for x in 0..<bitmap.pixelsWide where (bitmap.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.4 { ink += 1 }
                }
                try expect(field.currentEditor() === editor, "still typing")
                try expectEqual(ink, 0, "6 lines: the field draws no words under its editor")
            }
            // Typing on: the caret stays in sight.
            editor.insertText("\n물", replacementRange: editor.selectedRange())
            settle()
            try expect(caretShown(), "typing a 7th line: the caret is in sight")
            try expect(textKit2(), "the field editor stays TextKit 2")
            try expect(abs(field.frame.height - 4 * line) < 0.5, "7 lines: still 4 lines high")
            // ↑ moves the caret up a line (the line gives it away), Tab picks another reading.
            let end = editor.selectedRange().location
            try expect(!(field.delegate as! IntentField.Coordinator).control(field, textView: editor, doCommandBy: #selector(NSResponder.moveUp(_:))),
                       "↑ is the field's own")
            editor.moveUp(nil)
            try expect(editor.selectedRange().location < end, "↑ moved the caret up a line")
            // Esc empties the line, and it is one line again.
            try expect((field.delegate as! IntentField.Coordinator).control(field, textView: editor, doCommandBy: #selector(NSResponder.cancelOperation(_:))),
                       "Esc is taken")
            settle()
            try expectEqual(field.stringValue, "", "Esc empties the line")
            try expectEqual(field.frame.height, line, "Esc: one line again")
            // Return puts it in (a memo, or a to-do of its first line); ⌘Z brings the lines back.
            paste("장보기 목록\n우유\n달걀\n빵\n사과\n휴지")
            let memos = model.memos.count, items = model.items.count
            try expect((field.delegate as! IntentField.Coordinator).control(field, textView: editor, doCommandBy: #selector(NSResponder.insertNewline(_:))),
                       "Return is taken")
            settle()
            try expect(model.memos.count + model.items.count == memos + items + 1, "Return made one thing")
            try expectEqual(field.stringValue, "", "Return empties the line")
            try expectEqual(field.frame.height, line, "Return: one line again")
            let commandZ = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command, timestamp: 0, windowNumber: window.windowNumber,
                                            context: nil, characters: "z", charactersIgnoringModifiers: "z", isARepeat: false, keyCode: 6)!
            try expect(field.performKeyEquivalent(with: commandZ), "⌘Z is taken while the toast is up")
            settle()
            try expect(model.memos.count + model.items.count == memos + items, "⌘Z took it back")
            try expectEqual(field.stringValue, "장보기 목록\n우유\n달걀\n빵\n사과\n휴지", "⌘Z: the lines come back")
            try expect(abs(field.frame.height - 4 * line) < 0.5, "⌘Z: 4 lines high again")
            // ⇧Return (literal): a to-do of the text as it is, as before.
            NSApp.postEvent(NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .shift, timestamp: 0, windowNumber: window.windowNumber,
                                             context: nil, characters: "\r", charactersIgnoringModifiers: "\r", isARepeat: false, keyCode: 36)!, atStart: true)
            guard let shiftReturn = NSApp.nextEvent(matching: .keyDown, until: .distantPast, inMode: .default, dequeue: true) else {
                throw TestFailure(description: "no ⇧Return event")
            }
            try expect(NSApp.currentEvent?.modifierFlags.contains(.shift) == true, "⇧Return is the current event")
            editor.keyDown(with: shiftReturn)
            settle()
            try expect(model.items.count == items + 1 && model.memos.count == memos, "⇧Return made a to-do")
            try expectEqual(field.stringValue, "", "⇧Return empties the line")
            // ⌘Return is the field's key equivalent (as an event), still caught before the window's menu.
            try expect(field.performKeyEquivalent(with: NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: .command, timestamp: 0,
                                                                          windowNumber: window.windowNumber, context: nil, characters: "\r",
                                                                          charactersIgnoringModifiers: "\r", isARepeat: false, keyCode: 36)!),
                       "⌘Return is taken")
            // The 오늘 창's compact line and 빠른 입력 grow the same way; the search slip stays one line.
            try expectEqual(IntentField.lines("장보기 목록\n\n우유 · 달걀 · 빵", font: font, width: 300), 3, "3 lines counted")
            try expectEqual(IntentField.lines("장보기 목록\n", font: font, width: 300), 2, "a last line break counts the caret's line")
            try expectEqual(IntentField.lines("장보기 목록", font: font, width: 300), 1, "one line")
            try expect(IntentField.lines(String(repeating: "우유 달걀 빵 ", count: 12), font: font, width: 300) > 1, "a long line wraps, as on Windows")
            let quick = NSHostingView(rootView: QuickEntryView(model: model, text: "장보기 목록\n우유\n달걀\n빵\n사과\n휴지").fixedSize())
            let quickEmpty = NSHostingView(rootView: QuickEntryView(model: model).fixedSize())
            let quickLine = IntentField.lineHeight(model.notebookFont.handNSFont(28))
            try expect(quick.fittingSize.height - quickEmpty.fittingSize.height >= 3 * quickLine - 0.5, "빠른 입력: 4 lines high (\(quick.fittingSize.height) vs \(quickEmpty.fittingSize.height))")
            model.toast = nil
        }

        try await test("입력 줄 (#162): the first line is drawn where one line is, and the lines don't move when the keyboard comes") {
            _ = NSApplication.shared
            HandwritingFont.register()
            let font = NotebookFont.pen.handNSFont(20)
            /// The field drawn (never shown on screen) on white, and the rows (in the field's points, from its top) that
            /// have ink: drawn by the field, or by its field editor when the keyboard is in it.
            @MainActor func drawn(_ text: String, editing: Bool) throws -> (picture: NSBitmapImageRep, ink: Set<Int>) {
                let hosting = NSHostingView(rootView: IntentField(text: .constant(text), placeholder: "", font: font).growing(oneLine: 26)
                    .frame(width: 300).fixedSize(horizontal: false, vertical: true).background(Color.white))
                let window = NSWindow(contentRect: NSRect(x: -40_000, y: -40_000, width: 300, height: 200), styleMask: [.borderless], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false
                defer { window.close() }
                window.contentView = hosting
                hosting.frame.size = hosting.fittingSize
                hosting.layoutSubtreeIfNeeded()
                func find(_ view: NSView) -> IntentField.KeyField? { (view as? IntentField.KeyField) ?? view.subviews.lazy.compactMap(find).first }
                guard let field = find(hosting) else { throw TestFailure(description: "no field") }
                var source: NSView = field
                if editing {
                    guard window.makeFirstResponder(field), let editor = field.currentEditor() as? NSTextView else { throw TestFailure(description: "no editor") }
                    editor.selectedRange = NSRange(location: 0, length: 0)
                    source = editor
                }
                RunLoop.main.run(until: Date().addingTimeInterval(0.05))
                hosting.layoutSubtreeIfNeeded()
                let picture = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds)!
                hosting.cacheDisplay(in: hosting.bounds, to: picture)
                let bitmap = source.bitmapImageRepForCachingDisplay(in: source.bounds)!
                source.cacheDisplay(in: source.bounds, to: bitmap)
                let scale = CGFloat(bitmap.pixelsHigh) / bitmap.size.height
                let top = field.convert(source.bounds, from: source).minY
                var ink = Set<Int>()
                for y in 0..<bitmap.pixelsHigh {
                    for x in 0..<bitmap.pixelsWide where (bitmap.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.4 {
                        ink.insert(Int((top + CGFloat(y) / scale).rounded(.down)))
                        break
                    }
                }
                return (picture, ink)
            }
            /// Pixels that differ in the top `rows` points of both.
            func differing(_ a: NSBitmapImageRep, _ b: NSBitmapImageRep, rows: CGFloat) -> Int {
                let scale = CGFloat(a.pixelsHigh) / a.size.height
                var count = 0
                for y in 0..<Int(rows * scale) {
                    for x in 0..<min(a.pixelsWide, b.pixelsWide) {
                        guard let p = a.colorAt(x: x, y: y), let q = b.colorAt(x: x, y: y) else { continue }
                        if abs(p.brightnessComponent - q.brightnessComponent) > 0.15 { count += 1 }
                    }
                }
                return count
            }
            let one = try drawn("장보기 목록", editing: false)
            let three = try drawn("장보기 목록\n우유 · 달걀\n빵", editing: false)
            try expect(abs(three.picture.size.height - (26 + 2 * IntentField.lineHeight(font))) < 0.5, "3 lines drawn 2 lines taller (\(three.picture.size.height))")
            try expectEqual(one.picture.size.height, 26, "one line: 26 pt, as the one-line field's frame")
            // The one-line field sat in the middle of its 26 pt: 3 pt above a 20 pt line.
            try expectEqual(differing(one.picture, three.picture, rows: (26 + IntentField.lineHeight(font)) / 2), 0, "the first line of three is drawn as one line")
            // The field editor lays the lines out as the field draws them: the same rows have ink either way.
            let typing = try drawn("장보기 목록\n우유 · 달걀\n빵", editing: true)
            try expect(three.ink.count > 30 && three.ink.symmetricDifference(typing.ink).count <= 2,
                       "with the keyboard in it the lines stay put (\(three.ink.sorted()) vs \(typing.ink.sorted()))")
            let typingOne = try drawn("장보기 목록", editing: true)
            try expect(one.ink.symmetricDifference(typingOne.ink).count <= 1, "one line: the same rows with the keyboard (\(one.ink.sorted()) vs \(typingOne.ink.sorted()))")
        }

        try await test("#185: while 모든 스페이스 ▾ is open a plain 1–9 picks that space and 0 모든 스페이스; the rows keep ⌥⌘") {
            _ = NSApplication.shared
            let fixture = try Fixture(items: [("보고서 쓰기", false)])
            defer { fixture.cleanup() }
            let model = AppModel(storageURL: fixture.storageURL, isolated: true, preferences: fixture.preferences)
            let work = model.addTodoSpace(name: "회사", color: .pink)!
            let home = model.addTodoSpace(name: "집", color: .mint)!
            let menu = DrawerMenuBuilder.menu(SpaceMenus.header(model), palette: nil, font: .pen)
            let shown = menu.items.filter { !$0.isHidden && !$0.isSeparatorItem }
            try expectEqual(shown.map { $0.title.components(separatedBy: "\t")[0] }[1...2], ["회사", "집"], "the spaces in order (the count after a tab)")
            // #196 added one row, 이 기기에서 숨기기 ▸ (a submenu: no digit of its own).
            try expectEqual(shown.count, 7, "the same rows as before (모든 스페이스, two spaces, 일반, 묶기, 관리) and 이 기기에서 숨기기 ▸, no twin in sight")
            try expect(shown.contains { $0.hasSubmenu && $0.title.hasPrefix(SpaceDevice.Words.hideHere.text(.current)) }, "이 기기에서 숨기기 ▸ is a submenu")
            try expectEqual(menu.items.filter(\.isHidden).map(\.keyEquivalent), ["0", "1", "2"], "a hidden twin for 0, 1 and 2")
            try expectEqual(shown.prefix(3).map { $0.keyEquivalentModifierMask.intersection([.command, .option]) }, [[.command, .option], [.command, .option], [.command, .option]], "the rows still show ⌥⌘0–2")
            @MainActor func press(_ key: String, _ flags: NSEvent.ModifierFlags = []) -> Bool {
                let event = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: flags, timestamp: 0, windowNumber: 0, context: nil,
                                             characters: key, charactersIgnoringModifiers: key, isARepeat: false, keyCode: 0)!
                return DrawerMenuBuilder.menu(SpaceMenus.header(model), palette: nil, font: .pen).performKeyEquivalent(with: event)
            }
            try expect(press("2"), "2 is taken by the open menu")
            try expectEqual(model.spaceShown, .space(home), "2: the second space")
            try expect(press("1"), "1 is taken")
            try expectEqual(model.spaceShown, .space(work), "1: the first space")
            try expect(press("0"), "0 is taken")
            try expectEqual(model.spaceShown, .all, "0: 모든 스페이스")
            try expect(!press("3"), "3: no third space, nothing happens")
            try expectEqual(model.spaceShown, .all, "still 모든 스페이스")
            try expect(press("1", [.command, .option]), "⌥⌘1 still picks in the open menu")
            try expectEqual(model.spaceShown, .space(work), "⌥⌘1: the first space")
        }

        try await test("#250: a check's windows are left out of Mission Control, App Exposé and the window cycle") {
            _ = NSApplication.shared
            // Every behaviour the app's windows and panels set (their collectionBehavior lines), and none.
            let behaviours: [NSWindow.CollectionBehavior] = [
                [], [.fullScreenPrimary], [.fullScreenAuxiliary], [.moveToActiveSpace, .fullScreenAuxiliary],
                [.canJoinAllSpaces, .fullScreenAuxiliary], [.canJoinAllSpaces, .fullScreenAuxiliary, .transient],
                [.canJoinAllSpaces, .stationary, .ignoresCycle], [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle],
                [.ignoresCycle, .fullScreenAuxiliary], [.managed, .participatesInCycle],
            ]
            for behaviour in behaviours {
                let hidden = TestHooks.hiddenFromOverviews(behaviour)
                try expect(hidden.contains(.transient) && hidden.contains(.ignoresCycle), "\(behaviour.rawValue): transient and out of the cycle")
                try expect(hidden.isDisjoint(with: [.managed, .stationary, .participatesInCycle]), "\(behaviour.rawValue): no behaviour AppKit refuses beside them")
                let kept: NSWindow.CollectionBehavior = [.canJoinAllSpaces, .moveToActiveSpace, .fullScreenPrimary, .fullScreenAuxiliary, .fullScreenNone]
                try expectEqual(hidden.intersection(kept), behaviour.intersection(kept), "\(behaviour.rawValue): spaces and full screen kept")
                try expectEqual(TestHooks.hiddenFromOverviews(hidden), hidden, "\(behaviour.rawValue): once is enough")
                // A real panel takes it (AppKit raises on a combination it refuses).
                let panel = NSPanel(contentRect: NSRect(x: -40_000, y: -40_000, width: 100, height: 100), styleMask: [.borderless, .nonactivatingPanel],
                                    backing: .buffered, defer: true)
                panel.isReleasedWhenClosed = false
                panel.collectionBehavior = behaviour
                panel.collectionBehavior = hidden
                try expectEqual(panel.collectionBehavior, hidden, "\(behaviour.rawValue): the panel keeps it")
                panel.close()
            }
        }

        print("\n\(count) checks passed.")
    }

    @MainActor
    private static func expectItem(_ model: AppModel, titled title: String) throws -> TodoItem {
        guard let item = model.items.first(where: { $0.title == title }) else {
            throw TestFailure(description: "Missing item titled \(title)")
        }
        return item
    }
}

/// #228's probe slip: a header, a chip, a field, a button and paper, at known places (from the paper's top left: the
/// header to 44, the chip's row 44–84, the field 84–114, the button 114–148, then 40 of paper), and `rows` more rows of
/// 30 to make it taller.
@MainActor
private final class SlipProbe: ObservableObject {
    @Published var rows = 0
}

private struct SlipProbeView: View {
    @ObservedObject var probe: SlipProbe
    @State private var text = "장보기 목록"

    var body: some View {
        PaperSlip(kind: .confirm, width: 320) {
            VStack(spacing: 0) {
                SlipHeader(kind: .confirm, symbol: "clock", title: "회사를 이 기기에서 보일 시간")
                HStack(spacing: 0) {
                    SlipChipButton(title: "평일", action: {}).frame(width: 80, height: 40)
                    Spacer(minLength: 0)
                }
                .frame(height: 40)
                TextField("", text: $text).frame(width: 200, height: 30)
                Button("저장") {}.buttonStyle(SlipButtonStyle(role: .primary)).frame(width: 100, height: 34)
                ForEach(0..<probe.rows, id: \.self) { _ in Color.clear.frame(height: 30) }
                Color.clear.frame(height: 40)
            }
        }
    }
}

/// Posting an event, a modal session and bringing a window to the front wake the main run loop by stopping it; a stop left
/// for the next turn would land on the checks' own run loop and end them. A few turns of a nested loop take it.
@MainActor
private func absorbWake() {
    for _ in 0..<3 { RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.02)) }
}

/// A window that counts the presses that reach it.
private final class RecordingWindow: NSWindow {
    var presses = 0

    override func sendEvent(_ event: NSEvent) {
        if [.leftMouseDown, .rightMouseDown].contains(event.type) { presses += 1; return }
        super.sendEvent(event)
    }
}
