import Foundation

// 달력의 알림 할 일 (#227, CalendarMonth): the shared cases from docs/plans/calendar-reminders-cases.json (the Windows app's
// test/calendarReminders.test.ts reads the same file) — a month cell's lines (events, deadlines, then reminders by time, the
// title only) and its "+N", a week row's to-dos, the day panel's (unchanged), the tooltips, and what a space this Mac hides
// leaves out.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    if actual != expected { throw TestFailure(description: "\(name): expected \(expected), got \(actual)") }
}

@main
private enum CalendarRemindersTests {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "../docs/plans/calendar-reminders-cases.json"
        let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        let calendar = Calendar.paper
        /// "2026-11-10 15:00" on this Mac's wall clock.
        func moment(_ text: String) -> Date {
            let p = text.split(whereSeparator: { $0 == "-" || $0 == " " || $0 == ":" }).map { Int($0)! }
            return calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: p[3], minute: p[4]))!
        }
        let pool = file["todos"] as! [String: [String: Any]]
        func todo(_ name: String) -> TodoItem {
            let entry = pool[name]!
            var item = TodoItem(id: UUID(uuidString: entry["id"] as! String)!, title: entry["title"] as! String,
                                isCompleted: entry["done"] as? Bool ?? false, reminderAt: (entry["reminder"] as? String).map(moment))
            item.dueDate = entry["due"] as? String
            if let time = entry["time"] as? [String] { item.timeStart = time[0]; item.timeEnd = time[1] }
            return item
        }
        let eventPool = file["events"] as! [String: [String: Any]]
        func event(_ name: String) -> CalendarEvent {
            let entry = eventPool[name]!
            return CalendarEvent(key: "local/\(name)", calendarId: "local", title: entry["title"] as! String, allDay: entry["allDay"] as? Bool ?? false,
                                 start: moment(entry["start"] as! String), end: moment(entry["end"] as! String), color: "#5b8def")
        }
        // The spaces file, each to-do placed in its space (none: 일반).
        var spacesFile = file["spaces"] as! [String: Any]
        var places: [String: Any] = [:]
        for entry in pool.values { if let space = entry["space"] as? String { places[entry["id"] as! String] = ["space": space, "at": "2026-11-01T00:00:00Z"] } }
        spacesFile["items"] = places
        let spaces = try TodoSpaces.decode(JSONSerialization.data(withJSONObject: spacesFile))
        let rules = file["rules"] as! [String: Any]
        let now = moment(file["now"] as! String)
        /// The case's to-dos as the calendar gets them: without the ones its rule hides at its time (as AppModel.hereItems).
        func todos(_ entry: [String: Any]) -> [TodoItem] {
            let all = (entry["todos"] as! [String]).map(todo)
            guard let rule = entry["hidden"] as? String else { return all }
            let at = (entry["at"] as? String).map(moment) ?? now
            let hidden = SpaceDevice.hidden(SpaceDevice.read(rules[rule]), spaces: spaces, at: at, calendar: calendar)
            return all.filter { !SpaceDevice.isHidden(spaces.spaceID(of: $0.id), in: hidden, spaces: spaces) }
        }
        func line(_ item: CalendarMonth.CellItem) -> String {
            switch item {
            case .event(let event): "event \(event.title)"
            case .task(let task): "\(task.kind.rawValue) \(task.title)"
            }
        }
        func timed(_ task: CalendarMonth.DayTask) -> String { "\(task.kind.rawValue) \(task.time ?? "-") \(task.title)" }

        for entry in file["cells"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let day = entry["day"] as! String
                let page = CalendarMonth.Page(days: [day], events: (entry["events"] as! [String]).map(event), tasks: todos(entry), now: now,
                                              calendar: calendar)
                let cell = page.cell(day, limit: entry["limit"] as! Int)
                try equal(cell.items.map(line), entry["lines"] as! [String], "lines")
                try equal(cell.more, entry["more"] as! Int, "more")
                // The one-day form gives the same.
                let alone = CalendarMonth.cellItems(day, events: (entry["events"] as! [String]).map(event), tasks: todos(entry),
                                                    limit: entry["limit"] as! Int, calendar: calendar)
                try equal(alone.items, cell.items, "cellItems")
                try equal(alone.more, cell.more, "cellItems more")
            }
        }
        for entry in file["week"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let day = entry["day"] as! String
                let page = CalendarMonth.Page(days: [day], events: [], tasks: todos(entry), now: now, calendar: calendar)
                try equal(page.weekTasks(on: day).map(timed), entry["lines"] as! [String], "week")
            }
        }
        for entry in file["day"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let day = entry["day"] as! String
                let page = CalendarMonth.Page(days: [day], events: [], tasks: todos(entry), now: now, calendar: calendar)
                try equal(page.tasks(on: day).map(timed), entry["lines"] as! [String], "day panel")
                try equal(CalendarMonth.dayTasks(day, todos(entry), now: now, calendar: calendar).map(timed), entry["lines"] as! [String], "dayTasks")
            }
        }
        for entry in file["tooltips"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let day = entry["day"] as! String
                let id = UUID(uuidString: pool[entry["todo"] as! String]!["id"] as! String)!
                for language in AppLanguage.allCases {
                    let page = CalendarMonth.Page(days: [day], events: [], tasks: [todo(entry["todo"] as! String)], now: now, calendar: calendar,
                                                  language: language)
                    var tasks = page.weekTasks(on: day)
                    for case .task(let task) in page.cell(day, limit: 99).items { tasks.append(task) }
                    let task = tasks.first { $0.taskId == id && $0.kind.rawValue == entry["kind"] as! String }!
                    try equal(CalendarMonth.tooltip(task, language: language), entry[language.rawValue] as! String, language.rawValue)
                }
            }
        }
        print("\(count) calendar reminder cases passed")
    }
}
