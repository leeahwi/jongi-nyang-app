import Foundation

// 바탕화면 달력 위젯 (#234, CalendarWidget): the shared cases from docs/plans/calendar-widget-cases.json (the Windows app's
// test/calendarWidget.test.ts reads the same file) — what each kind shows, the day sheet, the opacity rules, places on
// displays, the quick entry's reading, the stored settings and when a widget draws again.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    if actual != expected { throw TestFailure(description: "\(name): expected \(expected), got \(actual)") }
}

@main
private enum CalendarWidgetTests {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "../docs/plans/calendar-widget-cases.json"
        let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            do { try action() } catch { throw TestFailure(description: "\(name) — \(error)") }
            count += 1
            print("PASS \(name)")
        }
        let calendar = Calendar.paper
        /// "2026-11-06T15:00:00" on this Mac's wall clock.
        func moment(_ text: String) -> Date {
            let p = text.split(whereSeparator: { $0 == "-" || $0 == "T" || $0 == ":" }).map { Int($0)! }
            return calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: p[3], minute: p[4], second: p.count > 5 ? p[5] : 0))!
        }
        func stamp(_ date: Date) -> String {
            let p = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
            return String(format: "%04d-%02d-%02dT%02d:%02d:%02d", p.year!, p.month!, p.day!, p.hour!, p.minute!, p.second!)
        }
        let pool = file["todos"] as! [String: [String: Any]]
        func todo(_ name: String) -> TodoItem {
            let entry = pool[name]!
            var item = TodoItem(id: UUID(uuidString: entry["id"] as! String)!, title: entry["title"] as! String,
                                isCompleted: entry["done"] as? Bool ?? false, reminderAt: (entry["reminderAt"] as? String).map(moment))
            item.dueDate = entry["dueDate"] as? String
            if let time = entry["time"] as? [String] { item.timeStart = time[0]; item.timeEnd = time[1] }
            return item
        }
        let eventPool = file["events"] as! [String: [String: Any]]
        let colorName = Dictionary(uniqueKeysWithValues: LocalEvent.Color.allCases.map { ($0.hex, $0.rawValue) })
        func event(_ name: String) -> CalendarEvent {
            let entry = eventPool[name]!
            return CalendarEvent(key: "local/\(name)", calendarId: "local", title: entry["title"] as! String, allDay: entry["allDay"] as? Bool ?? false,
                                 start: moment(entry["start"] as! String), end: moment(entry["end"] as! String),
                                 color: LocalEvent.Color(rawValue: entry["color"] as! String)!.hex)
        }
        var spacesFile = file["spaces"] as! [String: Any]
        var places: [String: Any] = [:]
        for entry in pool.values { if let space = entry["space"] as? String { places[entry["id"] as! String] = ["space": space, "at": "2026-11-01T00:00:00Z"] } }
        spacesFile["items"] = places
        let spaces = try TodoSpaces.decode(JSONSerialization.data(withJSONObject: spacesFile))
        let hidden = SpaceDevice.hidden(SpaceDevice.read(file["rules"]), spaces: spaces, at: moment(file["now"] as! String), calendar: calendar)
        /// The to-dos as a widget gets them: without the ones this device hides (AppModel.hereItems).
        func here(_ names: [String]) -> [TodoItem] {
            names.map(todo).filter { !SpaceDevice.isHidden(spaces.spaceID(of: $0.id), in: hidden, spaces: spaces) }
        }
        let baseNow = moment(file["now"] as! String)
        func set(_ entry: [String: Any]) -> (events: [CalendarEvent], todos: [TodoItem]) {
            let use = file[(entry["use"] as? String) ?? "base"] as! [String: [String]]
            return (use["events"]!.map(event), here(use["todos"]!))
        }
        func page(_ days: [String], _ data: (events: [CalendarEvent], todos: [TodoItem]), now: Date, language: AppLanguage = .ko) -> CalendarMonth.Page {
            CalendarMonth.Page(days: days, events: data.events, tasks: data.todos, now: now, calendar: calendar, language: language)
        }
        func text(_ line: CalendarWidget.Line) -> String {
            let kind = line.kind.rawValue
            return line.time.map { "\(kind) \($0) \(line.title)" } ?? "\(kind) \(line.title)"
        }
        func dot(_ color: String) -> String { colorName[color] ?? color }

        // Kinds
        for entry in file["kinds"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let now = (entry["now"] as? String).map(moment) ?? baseNow
                let today = CalendarWidget.today(now, calendar: calendar)
                let data = set(entry)
                if let sizes = entry["sizes"] as? [[Any]] {
                    for row in sizes {
                        let kind = CalendarWidget.Kind(rawValue: row[0] as! String)!, style = CalendarWidget.Style(rawValue: row[1] as! String)!
                        let size = CalendarWidget.size(kind, style)
                        try equal([size.width, size.height], [row[2] as! Double, row[3] as! Double], "size \(kind) \(style)")
                        try equal(CalendarWidget.earScale(kind, style), row[4] as! Double, "ears \(kind)")
                        try equal(CalendarWidget.windowSize(kind, style).height, size.height + 16 * (row[4] as! Double), "window \(kind)")
                    }
                    return
                }
                if let names = entry["names"] as? [[String]] {
                    for row in names {
                        for (i, language) in AppLanguage.allCases.enumerated() {
                            try equal(CalendarWidget.name(CalendarWidget.Kind(rawValue: row[0])!, CalendarWidget.Style(rawValue: row[1])!, language), row[2 + i], "name")
                        }
                    }
                    return
                }
                let kind = CalendarWidget.Kind(rawValue: entry["kind"] as! String)!
                let style = CalendarWidget.Style(rawValue: entry["style"] as? String ?? "simple")!
                let days = CalendarWidget.pageDays(kind, today: today, calendar: calendar)
                let p = page(days, data, now: now)
                if let lines = entry["lines"] as? [String] {
                    let limit = kind == .week ? 2 : 3
                    let up = CalendarWidget.upcoming(today, page: p, tasks: data.todos, now: now, limit: limit, calendar: calendar)
                    try equal(up.lines.map(text), lines, "lines")
                    if let more = entry["more"] as? Int { try equal(up.more, more, "more") }
                }
                if let dots = entry["dots"] as? [String: [String]] {
                    let plus = Set(entry["plus"] as! [String])
                    for (day, want) in dots {
                        let found = CalendarWidget.dots(day, page: p)
                        try equal(found.colors.map(dot), want, "dots \(day)")
                        try equal(found.plus, plus.contains(day), "plus \(day)")
                    }
                    if kind == .week { try equal(days.count, 7, "week days") }
                    if kind == .month { try equal(days.count, 42, "month days") }
                    _ = style
                }
                if let rows = entry["rows"] as? [String: Any] {
                    for (day, want) in rows {
                        let row = CalendarWidget.weekRow(day, page: p, calendar: calendar)
                        if let want = want as? [Any] {
                            try equal(row.first.map(text) ?? "-", want[0] as! String, "row \(day)")
                            try equal(row.more, want[1] as! Int, "row more \(day)")
                        } else {
                            try equal(row.first == nil, true, "empty row \(day)")
                        }
                    }
                }
                if let cells = entry["cells"] as? [String: [Any]] {
                    for (day, want) in cells {
                        let cell = CalendarWidget.monthCell(day, page: p, style: style, calendar: calendar)
                        try equal(cell.lines.map(text), want[0] as! [String], "cell \(day)")
                        try equal(cell.more, want[1] as! Int, "cell more \(day)")
                    }
                }
                if let agenda = entry["days"] as? [[Any]] {
                    let found = CalendarWidget.agenda(today, page: p, tasks: data.todos, now: now, calendar: calendar)
                    try equal(found.map(\.day), agenda.map { $0[0] as! String }, "agenda days")
                    for (got, want) in zip(found, agenda) { try equal(got.lines.map(text), want[1] as! [String], "agenda \(got.day)") }
                }
                if let absent = entry["absent"] as? [String] {
                    let ids = Set(absent.map { UUID(uuidString: pool[$0]!["id"] as! String)! })
                    for kind in CalendarWidget.Kind.allCases {
                        let all = CalendarWidget.pageDays(kind, today: today, calendar: calendar)
                        let pg = page(all, data, now: now)
                        var lines: [CalendarWidget.Line] = []
                        for day in all {
                            lines += CalendarWidget.dayLines(day, page: pg, tasks: data.todos, now: now, calendar: calendar)
                            lines += CalendarWidget.monthCell(day, page: pg).lines
                            lines += CalendarWidget.weekRow(day, page: pg).first.map { [$0] } ?? []
                        }
                        try equal(lines.contains { $0.taskId.map(ids.contains) ?? false }, false, "absent in \(kind)")
                    }
                }
                if entry["empty"] as? Bool == true {
                    try equal(CalendarWidget.upcoming(today, page: p, tasks: data.todos, now: now, calendar: calendar).lines.isEmpty, true, "empty")
                    let words = entry["text"] as! [String: String]
                    for language in AppLanguage.allCases { try equal(CalendarWidget.emptyText(language), words[language.rawValue]!, "empty text") }
                }
            }
        }

        // The day sheet
        for entry in file["sheet"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let data = set(entry)
                if let steps = entry["steps"] as? [[Any]] {
                    for step in steps {
                        try equal(CalendarWidget.step(step[0] as! String, by: step[1] as! Int, calendar: calendar), step[2] as! String, "step")
                    }
                    return
                }
                if let labels = entry["labels"] as? [String: String] {
                    try equal(CalendarWidget.target >= entry["target"] as! Double, true, "target")
                    for language in AppLanguage.allCases { try equal(CalendarWidget.moreLabel(entry["count"] as! Int, language), labels[language.rawValue]!, "label") }
                    return
                }
                let day = entry["day"] as! String
                if let titles = entry["titles"] as? [String: String] {
                    for language in AppLanguage.allCases { try equal(CalendarWidget.sheetTitle(day, calendar: calendar, language: language), titles[language.rawValue]!, "title") }
                    return
                }
                let p = page([day], data, now: baseNow)
                let sheet = CalendarWidget.sheetLines(day, page: p, tasks: data.todos, now: baseNow, calendar: calendar)
                if let lines = entry["lines"] as? [String] { try equal(sheet.map(text), lines, "sheet") }
                if let shown = entry["shown"] as? Int {
                    let cell = CalendarWidget.monthCell(day, page: p)
                    try equal(cell.lines.count, shown, "shown")
                    try equal(cell.more, entry["more"] as! Int, "more")
                    try equal(sheet.count, entry["sheetCount"] as! Int, "sheet count")
                    try equal(cell.lines.count + cell.more, sheet.count, "+N opens all")
                }
                if let first = entry["first"] as? String {
                    let row = CalendarWidget.weekRow(day, page: p)
                    try equal(row.first.map(text) ?? "-", first, "first")
                    try equal(row.more, entry["more"] as! Int, "more")
                }
                if let absent = entry["absent"] as? [String] {
                    let ids = Set(absent.map { UUID(uuidString: pool[$0]!["id"] as! String)! })
                    try equal(sheet.contains { $0.taskId.map(ids.contains) ?? false }, false, "absent")
                }
            }
        }

        // Opacity: the papers of #244 (docs/plans/paper-themes/tokens.json, beside this file).
        let tokensURL = URL(fileURLWithPath: path).deletingLastPathComponent().appendingPathComponent("paper-themes/tokens.json")
        let papers = ((try JSONSerialization.jsonObject(with: Data(contentsOf: tokensURL)) as! [String: Any])["papers"] as! [[String: Any]])
        func rgb(_ hex: String) -> (Double, Double, Double) {
            let v = Int(hex.dropFirst(), radix: 16)!
            return (Double((v >> 16) & 255) / 255, Double((v >> 8) & 255) / 255, Double(v & 255) / 255)
        }
        func floor(_ key: String) -> Int {
            let paper = papers.first { $0["key"] as? String == key }!
            let note = paper["note"] as! [String: String]
            return CalendarWidget.floor(paper: rgb(note["paper"]!), ink: rgb(note["ink"]!), dark: paper["scheme"] as? String == "dark")
        }
        for entry in file["opacity"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                if let tinted = entry["tintedFloors"] as? [String: Int] {
                    for (key, want) in tinted {
                        let paper = papers.first { $0["key"] as? String == key }!
                        let note = paper["note"] as! [String: String]
                        let tint = CalendarWidget.weekendTint(clay2: rgb(note["clay2"]!), paper: rgb(note["paper"]!))
                        try equal(CalendarWidget.floor(paper: tint, ink: rgb(note["ink"]!), dark: paper["scheme"] as? String == "dark"), want, "tinted \(key)")
                    }
                    return
                }
                if let ring = entry["todayRing"] as? [Bool] {
                    try equal((entry["opacity"] as! [Int]).map(CalendarWidget.todayRing), ring, "today ring")
                    return
                }
                if let floors = entry["floors"] as? [String: Int] {
                    for (key, want) in floors { try equal(floor(key), want, "floor \(key)") }
                    try equal(Set(floors.keys), Set(papers.map { $0["key"] as! String }), "every paper")
                    return
                }
                if let read = entry["read"] as? [Int] { try equal(read.map(CalendarWidget.opacity), entry["want"] as! [Int], "read") }
                if let values = entry["opacity"] as? [Int] {
                    let paperFloor = floor(entry["paper"] as? String ?? "day")
                    if let want = entry["backing"] as? [Bool] { try equal(values.map { CalendarWidget.backing($0, floor: paperFloor) }, want, "backing") }
                    if let want = entry["tile"] as? [Int] { try equal(values.map(CalendarWidget.tile), want, "tile") }
                    if let want = entry["inkOnly"] as? [Bool] { try equal(values.map(CalendarWidget.inkOnly), want, "inkOnly") }
                    if let want = entry["ear"] as? [Int] { try equal(values.map(CalendarWidget.earOpacity), want, "ear") }
                    if let want = entry["bolder"] as? [Bool] { try equal(values.map(CalendarWidget.bolder), want, "bolder") }
                    if let want = entry["halo"] as? [Bool] { try equal(values.map(CalendarWidget.halo), want, "halo") }
                    if let want = entry["edge"] as? [Double] { try equal(values.map(CalendarWidget.edgeStrength), want, "edge") }
                } else if let value = entry["opacity"] as? Int {
                    if entry["reduceTransparency"] as? Bool == true {
                        try equal(CalendarWidget.drawn(value, reduceTransparency: true, hover: false, solidOnHover: false), entry["drawn"] as! Int, "reduce")
                    }
                    if let solid = entry["solidOnHover"] as? [Bool] {
                        try equal(solid.map { CalendarWidget.drawn(value, reduceTransparency: false, hover: true, solidOnHover: $0) }, entry["drawn"] as! [Int], "hover")
                        try equal(CalendarWidget.drawn(value, reduceTransparency: false, hover: false, solidOnHover: true), value, "not hovering")
                    }
                }
            }
        }

        // Places
        let placeFile = file["place"] as! [String: Any]
        let screenPool = (placeFile["screens"] as! [String: [String: Any]]).mapValues { entry -> CalendarWidget.Screen in
            let a = entry["area"] as! [Double]
            return CalendarWidget.Screen(id: entry["id"] as! String, area: CalendarWidget.Rect(x: a[0], y: a[1], width: a[2], height: a[3]))
        }
        let size = placeFile["size"] as! [Double]
        func rect(_ a: Any) -> CalendarWidget.Rect { let a = a as! [Double]; return CalendarWidget.Rect(x: a[0], y: a[1], width: a[2], height: a[3]) }
        func place(_ a: Any) -> CalendarWidget.Place { let a = a as! [Any]; return CalendarWidget.Place(display: a[0] as! String, x: a[1] as! Double, y: a[2] as! Double) }
        for entry in placeFile["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let screens = (entry["screens"] as? [String] ?? ["main"]).map { screenPool[$0]! }
                if let of = entry["of"] {
                    try equal(CalendarWidget.place(of: rect(of), screens: screens), place(entry["place"]!), "place of")
                } else if let p = entry["place"], let want = entry["frame"] {
                    try equal(CalendarWidget.frame(place(p), width: size[0], height: size[1], screens: screens), rect(want), "frame")
                }
                for key in ["inside", "inside2"] {
                    if let pair = entry[key] as? [Any] {
                        try equal(CalendarWidget.inside(rect(pair[0]), area: screenPool["main"]!.area), rect(pair[1]), key)
                    }
                }
                for snap in entry["snaps"] as? [[String: Any]] ?? [] {
                    let others = (snap["others"] as! [Any]).map(rect)
                    try equal(CalendarWidget.snap(rect(snap["frame"]!), area: screenPool["main"]!.area, others: others), rect(snap["want"]!), "snap")
                }
                for new in entry["news"] as? [[String: Any]] ?? [] {
                    let others = (new["others"] as! [Any]).map(rect)
                    try equal(CalendarWidget.newPlace(width: size[0], height: size[1], screen: screenPool["main"]!, others: others), place(new["place"]!), "new")
                }
            }
        }

        // Quick entry
        func chipLine(_ candidate: Intent.Candidate, now: Date, language: AppLanguage = .ko) -> String {
            let parts = CalendarWidget.chipParts(candidate, now: now, calendar: calendar, language: language)
            let kind = candidate.kind.rawValue
            return parts.when.isEmpty ? kind : "\(kind) \(parts.when)"
        }
        for entry in file["quickAdd"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let now = baseNow
                if let reads = entry["reads"] as? [[Any]] {
                    for read in reads {
                        let lens: SpaceLens.Shown = (read[1] as? String).map { .space($0) } ?? .all
                        let reading = SpaceToken.read(read[0] as! String, spaces: spaces, lens: lens)
                        let first: String? = switch reading.choices.first { case .space(let id)?: id; default: nil }
                        try equal(first, read[2] as? String, "space")
                        try equal(reading.text.trimmingCharacters(in: .whitespaces), read[3] as! String, "text")
                    }
                    return
                }
                if let toasts = entry["toasts"] as? [[String]] {
                    for row in toasts {
                        for (i, language) in AppLanguage.allCases.enumerated() {
                            try equal(CalendarWidget.addedText(day: row[0], event: row[1] == "event", now: now, calendar: calendar, language: language), row[2 + i], "toast")
                        }
                    }
                    return
                }
                if let toast = entry["toast"] as? String {
                    let reading = SpaceToken.read(entry["text"] as! String, spaces: spaces, lens: .all)
                    guard case .space(let id)? = reading.choices.first else { throw TestFailure(description: "no space") }
                    try equal(id, entry["space"] as! String, "space")
                    try equal(SpaceDevice.isHidden(id, in: hidden, spaces: spaces), true, "hidden")
                    try equal(SpaceDevice.added(to: spaces.space(id)!.name, .ko), toast, "toast")
                    return
                }
                if let langs = entry["langs"] as? [[Any]] {
                    for row in langs {
                        let language = AppLanguage(rawValue: row[0] as! String)!
                        let found = CalendarWidget.candidates(row[1] as! String, day: entry["day"] as! String, now: now, calendar: calendar, language: language)
                        try equal(found.map { chipLine($0, now: now, language: language) }, row[2] as! [String], "chips \(language)")
                    }
                    return
                }
                let day = entry["day"] as! String
                if let texts = entry["texts"] as? [[Any]] {
                    for row in texts {
                        let found = CalendarWidget.candidates(row[0] as! String, day: day, now: now, calendar: calendar)
                        try equal(found.map { chipLine($0, now: now) }, row[1] as! [String], "chips \(row[0])")
                    }
                    return
                }
                let found = CalendarWidget.candidates(entry["text"] as! String, day: day, now: now, calendar: calendar)
                if let chips = entry["chips"] as? [String] { try equal(found.map { chipLine($0, now: now) }, chips, "chips") }
                if let first = entry["first"] as? String { try equal(found.first?.kind.rawValue ?? "-", first, "first kind") }
                if let want = entry["want"] as? String, case .event(let guess)? = found.first {
                    let start = calendar.date(byAdding: .minute, value: guess.start, to: CalendarMonth.date(guess.date, calendar: calendar))!
                    try equal(stamp(start), want, "start")
                }
                if let made = entry["made"] as? [String: String], case .todo(let parsed)? = found.first {
                    try equal(parsed.title, made["title"]!, "title")
                    try equal(parsed.dueDate, made["dueDate"], "dueDate")
                    try equal(parsed.reminderAt.map(stamp), made["reminderAt"], "reminderAt")
                }
            }
        }

        // Settings
        for entry in file["settings"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let read = CalendarWidget.read(entry["read"])
                if let ids = entry["ids"] as? [String] { try equal(read.map(\.id), ids, "ids") }
                if let styles = entry["styles"] as? [String] { try equal(read.map(\.style.rawValue), styles, "styles") }
                if let scales = entry["scales"] as? [Double] { try equal(read.map(\.scale), scales, "scales") }
                if let want = entry["want"] as? [[String: Any]] {
                    let written = CalendarWidget.write(read)
                    let a = try JSONSerialization.data(withJSONObject: written, options: [.sortedKeys])
                    let b = try JSONSerialization.data(withJSONObject: want, options: [.sortedKeys])
                    try equal(String(data: a, encoding: .utf8)!, String(data: b, encoding: .utf8)!, "settings")
                    try equal(CalendarWidget.read(written), read, "round trip")
                }
            }
        }

        // 크기 (#271)
        let scaleFile = file["scale"] as! [String: Any]
        try equal(CalendarWidget.scales, scaleFile["steps"] as! [Double], "steps")
        func near(_ a: Double, _ b: Double, _ name: String) throws {
            if abs(a - b) > 0.005 { throw TestFailure(description: "\(name): expected \(b), got \(a)") }
        }
        func kindStyle(_ text: String) -> (CalendarWidget.Kind, CalendarWidget.Style) {
            let parts = text.split(separator: "-").map(String.init)
            return (CalendarWidget.Kind(rawValue: parts[0])!, CalendarWidget.Style(rawValue: parts[1])!)
        }
        for entry in scaleFile["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                if let read = entry["read"] as? [Double] { try equal(read.map(CalendarWidget.scale), entry["want"] as! [Double], "read") }
                for row in entry["names"] as? [[Any]] ?? [] {
                    for (i, language) in AppLanguage.allCases.enumerated() {
                        try equal(CalendarWidget.scaleName(row[0] as! Double, language), row[1 + i] as! String, "name")
                    }
                }
                for row in entry["windows"] as? [[Any]] ?? [] {
                    let kind = CalendarWidget.Kind(rawValue: row[0] as! String)!, style = CalendarWidget.Style(rawValue: row[1] as! String)!
                    let window = CalendarWidget.windowSize(kind, style, scale: row[2] as! Double)
                    try near(window.width, row[3] as! Double, "width \(kind) \(style) \(row[2])")
                    try near(window.height, row[4] as! Double, "height \(kind) \(style) \(row[2])")
                }
                if let areas = entry["areas"] as? [String: [Double]], let fits = entry["fits"] as? [String: [Bool]] {
                    for (name, a) in areas {
                        let area = CalendarWidget.Rect(x: a[0], y: a[1], width: a[2], height: a[3])
                        for (key, want) in fits {
                            let (kind, style) = kindStyle(key)
                            try equal(CalendarWidget.scales.map { CalendarWidget.fits(kind, style, scale: $0, area: area) }, want, "fits \(key) \(name)")
                        }
                    }
                }
                if let shown = entry["shown"] as? [[Any]] {
                    let area = rect(entry["area"]!)
                    for row in shown {
                        let kind = CalendarWidget.Kind(rawValue: row[0] as! String)!, style = CalendarWidget.Style(rawValue: row[1] as! String)!
                        try equal(CalendarWidget.shownScale(row[2] as! Double, kind, style, area: area), row[3] as! Double, "shown \(kind) \(style) \(row[2])")
                    }
                }
                if let frames = entry["frames"] as? [[Any]] {
                    let kind = CalendarWidget.Kind(rawValue: entry["kind"] as! String)!, style = CalendarWidget.Style(rawValue: entry["style"] as! String)!
                    let screen = CalendarWidget.Screen(id: "1", area: rect(entry["area"]!))
                    for row in frames {
                        let window = CalendarWidget.windowSize(kind, style, scale: row[0] as! Double)
                        let frame = CalendarWidget.frame(place(entry["place"]!), width: window.width, height: window.height, screens: [screen])
                        let want = row[1] as! [Double]
                        for (got, value) in zip([frame.x, frame.y, frame.width, frame.height], want) { try near(got, value, "frame \(row[0])") }
                    }
                }
            }
        }

        // Drawing again
        for entry in file["redraw"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                if let offsets = entry["offsets"] as? [[Any]] {
                    let touched = moment(entry["touched"] as! String)
                    for row in offsets {
                        try equal(CalendarWidget.offset(row[1] as! Int, touched: touched, now: moment(row[0] as! String)), row[2] as! Int, "offset")
                    }
                    return
                }
                if let today = entry["today"] as? String {
                    try equal(CalendarWidget.today(moment(entry["now"] as! String), calendar: calendar), today, "today")
                    let month = entry["month"] as! [String: String]
                    try equal(stamp(CalendarWidget.nextRedraw(.month, now: moment(month["now"]!), lines: [], calendar: calendar)), month["next"]!, "month")
                    return
                }
                let now = (entry["now"] as? String).map(moment) ?? baseNow
                let kind = CalendarWidget.Kind(rawValue: entry["kind"] as! String)!
                let data = set(entry)
                let today = CalendarWidget.today(now, calendar: calendar)
                let p = page(CalendarWidget.pageDays(kind, today: today, calendar: calendar), data, now: now)
                let lines = CalendarWidget.dayLines(today, page: p, tasks: data.todos, now: now, calendar: calendar)
                try equal(stamp(CalendarWidget.nextRedraw(kind, now: now, lines: lines, calendar: calendar)), entry["next"] as! String, "next")
            }
        }
        print("\(count) calendar widget cases passed")
    }
}
