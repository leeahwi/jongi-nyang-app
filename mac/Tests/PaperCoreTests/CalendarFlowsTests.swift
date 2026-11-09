import Foundation

// 달력을 실제로 쓰는 흐름 (docs/plans/calendar-flows.md): the shared cases from docs/plans/calendar-flows-cases.json (the
// Windows app's test/calendarFlows.test.ts reads the same file) — the all-day order that keeps a trip's band in place,
// which days draw an event as a band and how bands join along a week row, which cut titles take a second line, the
// week's first day from the system, and the day sheet's holiday line and faded lines.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    if actual != expected { throw TestFailure(description: "\(name): expected \(expected), got \(actual)") }
}

@main
private enum CalendarFlowsTests {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "../docs/plans/calendar-flows-cases.json"
        let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            do { try action() } catch { throw TestFailure(description: "\(name) — \(error)") }
            count += 1
            print("PASS \(name)")
        }
        let calendar = Calendar.paper
        func moment(_ text: String) -> Date {
            let p = text.split(whereSeparator: { $0 == "-" || $0 == "T" || $0 == ":" }).map { Int($0)! }
            return calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: p[3], minute: p[4], second: p.count > 5 ? p[5] : 0))!
        }
        func event(_ name: String, _ entry: [String: Any]) -> CalendarEvent {
            CalendarEvent(key: "local/\(name)", calendarId: "local", title: entry["title"] as! String, allDay: entry["allDay"] as? Bool ?? false,
                          start: moment(entry["start"] as! String), end: moment(entry["end"] as! String),
                          color: LocalEvent.Color(rawValue: entry["color"] as! String)!.hex)
        }
        let pool = file["events"] as! [String: [String: Any]]
        let now = moment(file["now"] as! String)
        let languages: [AppLanguage] = [.ko, .en, .nl]

        // D1: the order and the bands.
        for entry in (file["order"] as! [String: Any])["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let events = (entry["events"] as! [String]).map { event($0, pool[$0]!) }
                try equal(CalendarMonth.eventsOn(entry["day"] as! String, events, calendar: calendar).map(\.title), entry["titles"] as! [String], "order")
            }
        }
        for entry in (file["bands"] as! [String: Any])["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let name = entry["event"] as! String
                let found = event(name, pool[name]!)
                for (day, band) in (entry["days"] as! [String: Bool]).sorted(by: { $0.key < $1.key }) {
                    try equal(CalendarMonth.bandKey(found, on: day, calendar: calendar) != nil, band, day)
                }
            }
        }
        func written(_ band: CalendarMonth.Band) -> String { "\(band.run)" + (band.fromLeft ? "<" : "") + (band.toRight ? ">" : "") }
        func rows(_ value: Any) -> [[String?]] { (value as! [[Any]]).map { $0.map { $0 as? String } } }
        for entry in (file["runs"] as! [String: Any])["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                try equal(CalendarMonth.bands(rows(entry["rows"]!)).map { $0.map(written) }, entry["runs"] as! [[String]], "runs")
                if let next = entry["next"] as? [String: Any] {
                    try equal(CalendarMonth.bands(rows(next["rows"]!)).map { $0.map(written) }, next["runs"] as! [[String]], "next row")
                }
            }
        }

        // D2 (audit 3 · 28): the cut titles that take a second line.
        for entry in (file["twoLines"] as! [String: Any])["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let lines = (entry["lines"] as! [String]).map { CalendarMonth.LineFit(rawValue: $0)! }
                try equal(CalendarMonth.twoLineTitles(room: entry["room"] as! Int, lines: lines), entry["two"] as! [Bool], "two lines")
            }
        }
        // #260: a holiday's name by the same rule, and where English and Dutch break a long word.
        let twoLines = file["twoLines"] as! [String: Any]
        for entry in (twoLines["holiday"] as! [String: Any])["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let lines = (entry["lines"] as! [String]).map { CalendarMonth.LineFit(rawValue: $0)! }
                let holiday = (entry["holiday"] as? String).map { CalendarMonth.LineFit(rawValue: $0)! }
                let found = CalendarMonth.twoLineTitles(room: entry["room"] as! Int, holiday: holiday, lines: lines)
                let two = entry["two"] as! [String: Any]
                try equal(found.holiday, two["holiday"] as! Bool, "holiday")
                try equal(found.lines, two["lines"] as! [Bool], "lines")
            }
        }
        let breaks = twoLines["breaks"] as! [String: Any]
        try test("K0 하이픈으로 나누는 언어") {
            for (code, hyphenates) in breaks["hyphenates"] as! [String: Bool] {
                try equal(CalendarMonth.hyphenates(AppLanguage(rawValue: code)!), hyphenates, code)
            }
        }
        for entry in breaks["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let found = CalendarMonth.lineFit(overflows: entry["overflows"] as! Bool, betweenWords: entry["betweenWords"] as! Bool,
                                                  inWord: entry["inWord"] as! Bool, language: AppLanguage(rawValue: entry["lang"] as! String)!)
                try equal(found.rawValue, entry["fit"] as! String, "fit")
            }
        }
        try test("K9 공휴일 이름은 정해 둔 자리에서 나눠요") {
            for (key, value) in (breaks["holidays"] as! [String: Any]) where key != "about" {
                let name = KoreanCalendar.Name(rawValue: key)!, marked = value as! [String]
                try equal(name.shown(.en).replacingOccurrences(of: "\u{00AD}", with: "|"), marked[0], "en \(key)")
                try equal(name.shown(.nl).replacingOccurrences(of: "\u{00AD}", with: "|"), marked[1], "nl \(key)")
                try equal(marked.map { $0.replacingOccurrences(of: "|", with: "") }, [name.text(.en), name.text(.nl)], "same name \(key)")
                try equal(name.shown(.ko), name.text(.ko), "ko \(key)")
            }
            try equal(KoreanCalendar.label(on: "2026-10-09", language: .nl, shown: true), "Han\u{00AD}geul\u{00AD}dag", "2026-10-09")
            try equal(CalendarMonth.hyphenated("Han\u{00AD}geul\u{00AD}dag", language: .nl), "Han\u{00AD}geul\u{00AD}dag", "kept")
        }
        // The Mac's own: the system's hyphenation gives soft hyphens in English and Dutch words, none in Korean.
        try test("K8 Mac: 시스템의 하이픈 규칙으로 긴 낱말에 나눌 자리를 넣어요") {
            let soft = "\u{00AD}"
            let dutch = CalendarMonth.hyphenated("Avondwandeling", language: .nl)
            try equal(dutch.contains(soft), true, "nl soft hyphen")
            try equal(dutch.replacingOccurrences(of: soft, with: ""), "Avondwandeling", "nl text")
            try equal(CalendarMonth.firstPiece("Onafhankelijkheidsdag", language: .nl).map { $0.count < 10 } ?? false, true, "nl first piece")
            try equal(CalendarMonth.hyphenated("Independence Movement Day", language: .en).contains(soft), true, "en soft hyphen")
            try equal(CalendarMonth.hyphenated("대체공휴일 아침 회의", language: .ko), "대체공휴일 아침 회의", "ko as it is")
            try equal(CalendarMonth.hyphenated("Dag", language: .nl), "Dag", "short word")
        }

        // D4: the week's first day from the system.
        let weekStart = file["weekStart"] as! [String: Any]
        for entry in weekStart["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let language = AppLanguage(rawValue: entry["lang"] as! String)!
                try equal(AppLanguage.weekStartsMonday(system: entry["system"] as? String, language: language), entry["monday"] as! Bool, "monday")
                AppLanguage.weekStart = entry["system"] as? String
                defer { AppLanguage.weekStart = nil }
                try equal(language.weekStartsMonday, entry["monday"] as! Bool, "as set")
            }
        }
        for entry in weekStart["grid"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let language = AppLanguage(rawValue: entry["lang"] as! String)!
                AppLanguage.weekStart = (entry["monday"] as! Bool) ? "monday" : "sunday"
                defer { AppLanguage.weekStart = nil }
                if let year = entry["year"] as? Int {
                    let grid = CalendarMonth.monthGrid(year: year, month: entry["month"] as! Int, calendar: calendar, language: language)
                    try equal(grid.first!, entry["first"] as! String, "first")
                    try equal(CalendarMonth.weekdayLabels(language), entry["labels"] as! [String], "labels")
                }
                if let day = entry["week"] as? String {
                    let week = Deadline.week(of: moment(day + "T12:00:00"), calendar: calendar, language: language)
                    try equal([week.first, week.last], entry["days"] as! [String], "week")
                    let days = CalendarMonth.weekDays(day, calendar: calendar, language: language)
                    try equal([days.first!, days.last!], entry["days"] as! [String], "week view")
                }
            }
        }
        let readers = weekStart["readers"] as! [String: Any]
        try test("F9 Mac: Calendar.firstWeekday를 요일 이름으로 읽어요") {
            for entry in readers["mac"] as! [[String: Any]] {
                try equal(AppLanguage.weekdayName(firstWeekday: entry["value"] as! Int), entry["day"] as? String, "\(entry["value"]!)")
            }
            try equal(AppLanguage.weekdayName(firstWeekday: 0), nil, "0")
        }

        // The lunar date beside a cell's number.
        for entry in (file["lunar"] as! [String: Any])["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                try equal(CalendarWidget.showsLunar(lunarDay: entry["lunarDay"] as! Int, cellWidth: Double(entry["width"] as! Int),
                                                    moreInHead: entry["moreInHead"] as! Bool), entry["shows"] as! Bool, "shows")
            }
        }

        // #295: the lunar 1st without its mark where the head is short of room.
        for entry in ((file["lunar"] as! [String: Any])["short"] as! [String: Any])["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let lunar = KoreanCalendar.Lunar(month: entry["month"] as! Int, day: entry["day"] as! Int, leap: entry["leap"] as! Bool)
                for (index, language) in languages.enumerated() {
                    try equal(KoreanCalendar.lunarLabel(lunar, language: language), (entry["labels"] as! [String])[index], "label \(language)")
                    try equal(KoreanCalendar.lunarLabel(lunar, language: language, short: true), (entry["short"] as! [String])[index], "short \(language)")
                }
            }
        }

        for entry in (((file["lunar"] as! [String: Any])["short"] as! [String: Any])["head"] as! [String: Any])["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                func w(_ key: String) -> Double { Double(entry[key] as! Int) }
                let fit = CalendarWidget.headFit(room: w("room"), number: w("number"), mark: w("mark"), count: w("count"), more: w("more"),
                                                 lunar: w("lunar"), short: w("short"), gap: w("gap"))
                let then = entry["then"] as! [String: Any]
                try equal(fit.lunar.rawValue, then["lunar"] as! String, "lunar")
                try equal(fit.count, then["count"] as! Bool, "count")
                try equal(fit.mark, then["mark"] as! Bool, "mark")
            }
        }

        // The day sheet.
        let sheet = file["sheet"] as! [String: Any]
        for entry in sheet["holiday"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                for (index, language) in languages.enumerated() {
                    try equal(CalendarWidget.holidayWord(language), (entry["word"] as! [String])[index], "word \(language)")
                    try equal(KoreanCalendar.label(on: entry["day"] as! String, language: language), (entry["name"] as! [Any])[index] as? String, "name \(language)")
                }
            }
        }
        let over = sheet["over"] as! [String: Any]
        try test(over["case"] as! String) {
            let day = over["day"] as! String
            let events = (over["events"] as! [String: [String: Any]]).sorted { $0.key < $1.key }.map { event($0.key, $0.value) }
            let tasks = (over["todos"] as! [String: [String: Any]]).sorted { $0.key < $1.key }.map { entry -> TodoItem in
                let value = entry.value
                var item = TodoItem(id: UUID(uuidString: value["id"] as! String)!, title: value["title"] as! String,
                                    reminderAt: (value["reminderAt"] as? String).map(moment))
                item.dueDate = value["dueDate"] as? String
                return item
            }
            let page = CalendarMonth.Page(days: [day], events: events, tasks: tasks, now: now, calendar: calendar)
            let lines = CalendarWidget.sheetLines(day, page: page, tasks: tasks, now: now, calendar: calendar)
            try equal(lines.map(\.title), over["lines"] as! [String], "lines")
            try equal(lines.map { $0.over(now) }, over["over"] as! [Bool], "over")
        }

        // #274: the days a repeating to-do comes back on.
        let repeats = file["repeats"] as! [String: Any]
        func series(_ entries: [[String: Any]], now: Date) -> (series: [Series], tasks: [TodoItem]) {
            var found: [Series] = [], tasks: [TodoItem] = []
            for (index, entry) in entries.enumerated() {
                let rule = entry["rule"] as! [String: Any]
                let id = "S\(index + 1)"
                found.append(Series(id: id, title: entry["title"] as! String,
                                    rule: RepeatRule(kind: RepeatKind(rawValue: rule["kind"] as! String)!, weekdays: rule["weekdays"] as? [Int],
                                                     monthDay: rule["monthDay"] as? Int),
                                    remindAt: entry["remindAt"] as? String, createdAt: now, lastPlaced: entry["lastPlaced"] as? String))
                if let copy = entry["copy"] as? [String: Any] {
                    var item = TodoItem(title: entry["title"] as! String, reminderAt: (copy["reminderAt"] as? String).map(moment), seriesID: id)
                    item.dueDate = copy["dueDate"] as? String
                    tasks.append(item)
                }
            }
            return (found, tasks)
        }
        func span(_ from: String, _ to: String) -> [String] {
            var days = [from]
            while days.last! < to { days.append(CalendarMonth.adding(1, to: days.last!, calendar: calendar)) }
            return days
        }
        for entry in repeats["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let at = (entry["now"] as? String).map(moment) ?? now
                let made = series(entry["series"] as! [[String: Any]], now: at)
                let days = span(entry["from"] as! String, entry["to"] as! String)
                let found = CalendarMonth.repeats(on: Set(days), series: made.series, tasks: made.tasks, now: at, calendar: calendar)
                func written(_ day: String, _ task: CalendarMonth.DayTask) -> String {
                    let kind: String = task.ahead ? "ahead" : "next"
                    let time: String = task.time.map { " " + $0 } ?? ""
                    let copy: String = task.taskId == nil ? "" : " (copy)"
                    return day + " " + kind + time + " " + task.title + copy
                }
                let lines: [String] = days.flatMap { day in (found[day] ?? []).map { written(day, $0) } }
                try equal(lines, entry["lines"] as! [String], "lines")
                // The page gives the same to the day's list (after its to-dos) and to the cells.
                let page = CalendarMonth.Page(days: days, events: [], tasks: made.tasks, series: made.series, now: at, calendar: calendar)
                for day in days {
                    try equal(page.tasks(on: day).filter { $0.kind == .repeating }, found[day] ?? [], "page \(day)")
                }
            }
        }
        let repeatCell = repeats["cell"] as! [String: Any]
        try test(repeatCell["case"] as! String) {
            let day = repeatCell["day"] as! String
            let events = (repeatCell["events"] as! [String]).map { event($0, pool[$0]!) }
            let tasks = (repeatCell["todos"] as! [[String: Any]]).map { value -> TodoItem in
                var item = TodoItem(title: value["title"] as! String, reminderAt: (value["reminderAt"] as? String).map(moment))
                item.dueDate = value["dueDate"] as? String
                return item
            }
            let made = series(repeatCell["series"] as! [[String: Any]], now: now)
            func titles(_ cell: (items: [CalendarMonth.CellItem], more: Int)) -> [String] {
                cell.items.map { item in
                    switch item {
                    case .event(let event): event.title
                    case .task(let task): task.title
                    }
                }
            }
            let page = CalendarMonth.Page(days: [day], events: events, tasks: tasks + made.tasks, series: made.series, now: now, ranges: false,
                                          calendar: calendar)
            let cell = page.cell(day, limit: repeatCell["limit"] as! Int)
            try equal(titles(cell), repeatCell["titles"] as! [String], "titles")
            try equal(cell.more, repeatCell["more"] as! Int, "more")
            try equal(titles(page.cell(day, limit: 99)), repeatCell["roomy"] as! [String], "roomy")
        }
        let words = repeats["words"] as! [String: Any]
        try test(words["case"] as! String) {
            for (index, language) in languages.enumerated() {
                for ahead in [true, false] {
                    let task = CalendarMonth.DayTask(title: words["title"] as! String, kind: .repeating, time: words["time"] as? String, ahead: ahead)
                    let name = ahead ? "ahead" : "next"
                    try equal(CalendarMonth.tooltip(task, language: language), ((words["tooltip"] as! [String: [String]])[name]!)[index], "tooltip \(name) \(language)")
                    try equal(CalendarMonth.spoken(task, language: language), ((words["spoken"] as! [String: [String]])[name]!)[index], "spoken \(name) \(language)")
                }
                let untimed = CalendarMonth.DayTask(title: words["title"] as! String, kind: .repeating, ahead: true)
                try equal(CalendarMonth.spoken(untimed, language: language), (words["untimed"] as! [String])[index], "untimed \(language)")
            }
        }

        // #296: the faded daily · weekday repeats a month cell folds into its head.
        let fold = repeats["fold"] as! [String: Any]
        for entry in fold["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let day = entry["day"] as! String
                let events = (entry["events"] as! [String]).map { event($0, pool[$0]!) }
                let made = series(entry["series"] as! [[String: Any]], now: now)
                func titles(_ items: [CalendarMonth.CellItem]) -> [String] {
                    items.map { item in
                        switch item {
                        case .event(let event): event.title
                        case .task(let task): task.title
                        }
                    }
                }
                let page = CalendarMonth.Page(days: [day], events: events, tasks: made.tasks, series: made.series, now: now, ranges: false, calendar: calendar)
                let cell = page.cell(day, limit: entry["limit"] as! Int, folding: true)
                try equal(titles(cell.items), entry["titles"] as! [String], "titles")
                try equal(cell.more, entry["more"] as! Int, "more")
                let folded = page.folded(day)
                try equal(folded.map(\.title), entry["folded"] as! [String], "folded")
                for (index, language) in languages.enumerated() {
                    try equal(CalendarMonth.foldedLabel(folded, language: language), (entry["label"] as! [Any])[index] as? String, "label \(language)")
                }
                try equal(CalendarMonth.foldedTooltip(folded), entry["tooltip"] as? String, "tooltip")
                // The week, the day's list and the sheet still show every one.
                try equal(page.tasks(on: day).filter { $0.kind == .repeating }.map(\.title), entry["list"] as! [String], "list")
                // The widget's month cell folds them too.
                try equal(CalendarWidget.monthCell(day, page: page, style: .wall).lines.map(\.title), entry["titles"] as! [String], "widget")
            }
        }
        let wrap = fold["wrap"] as! [String: Any]
        try test(wrap["case"] as! String) {
            let found = (wrap["lines"] as! [[String: Any]]).map { line in
                CalendarMonth.mayWrap(.task(CalendarMonth.DayTask(title: "분리수거", kind: line["kind"] as! String == "repeat" ? .repeating : .reminder,
                                                                  ahead: line["ahead"] as! Bool)))
            }
            try equal(found, wrap["wraps"] as! [Bool], "wraps")
        }

        // #275: the desk calendar's day list by the keys.
        let keys = file["keys"] as! [String: Any]
        for entry in keys["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let then = entry["then"] as! [String: Any]
                let step = CalendarMonth.listKey(CalendarMonth.ListKey(rawValue: entry["key"] as! String)!, picked: entry["picked"] as? Int,
                                                 count: entry["count"] as! Int)
                try equal(step.picked, then["picked"] as? Int, "picked")
                try equal(step.open, then["open"] as? Int, "open")
                try equal(step.handled, then["handled"] as! Bool, "handled")
            }
        }
        let label = keys["label"] as! [String: Any]
        try test(label["case"] as! String) {
            for (index, language) in languages.enumerated() {
                try equal(CalendarMonth.eventLabel(title: label["title"] as! String, time: label["time"] as! String, index: label["index"] as! Int,
                                                   count: label["count"] as! Int, language: language), (label["spoken"] as! [String])[index], "\(language)")
            }
        }
        print("\(count) calendar flow cases passed")
    }
}
