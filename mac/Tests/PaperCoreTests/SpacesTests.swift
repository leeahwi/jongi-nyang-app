import Foundation

// 할 일 스페이스 (TodoSpaces.swift): todo-spaces.json, the `#` token, the lens, merging, pruning and the backup — the
// shared cases S1–S22 read from docs/plans/spaces-cases.json (the Windows app reads the same file), then the Mac's own.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    try expect(actual == expected, "\(name): expected \(expected), got \(actual)")
}

private func at(_ text: String) -> Date {
    let fractional = ISO8601DateFormatter()
    fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return ISO8601DateFormatter().date(from: text) ?? fractional.date(from: text)!
}

@main
private enum SpacesTests {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "../docs/plans/spaces-cases.json"
        let cases = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: cases["timeZone"] as! String)!
        let now = at(cases["now"] as! String)
        func json(_ value: Any) -> Data { try! JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed]) }
        let base = try TodoSpaces.decode(json(cases["file"]!))
        func choiceText(_ choice: SpaceToken.Choice) -> String {
            switch choice {
            case .space(let id): id
            case .new(let name): "new:" + name
            case .noSpace: "none"
            }
        }

        // MARK: S1–S10, S19, S20: the input line

        for entry in cases["lines"] as! [[String: Any]] {
            let name = "\(entry["case"]!) \(entry["text"]!)"
            try test(name) {
                var spaces = entry["noSpaces"] as? Bool == true ? TodoSpaces() : base
                if let extra = entry["addSpace"] as? [String: Any] {
                    spaces.spaces += try TodoSpaces.decode(json(["spaces": [extra]])).spaces
                }
                if let general = entry["general"] as? [String: Any] {
                    spaces.general = try TodoSpaces.decode(json(["general": general])).general
                }
                let lens: SpaceLens.Shown = (entry["lens"] as? String).map { $0 == SpaceLens.none ? .noSpace : .space($0) } ?? .all
                let expected = entry["expect"] as! [String: Any]
                let reading = SpaceToken.read(entry["text"] as! String, spaces: spaces, lens: lens)
                let candidates = Intent.read(reading.text, now: now, calendar: calendar, language: .ko)
                // S29: a repeat whose title sounds like an event (회의) is the second reading (Tab) — picked by its kind.
                let picked = expected["kind"] as? String == "repeat" ? candidates.first { $0.kind == .repeating } : candidates.first
                guard let first = picked else {
                    try equal(false, expected["added"] as! Bool, "added")
                    try equal(reading.token != nil ? SpaceWords.needsTitle() : nil, expected["hint"] as? String, "hint")
                    return
                }
                try equal(true, expected["added"] as! Bool, "added")
                try equal(first.kind.rawValue, expected["kind"] as! String, "kind")
                let title: String = switch first {
                case .todo(let parsed): parsed.title
                case .event(let event): event.title
                case .repeating(let guess): guess.title
                default: ""
                }
                try equal(title, expected["title"] as! String, "title")
                try equal(reading.choices.map(choiceText), expected["choices"] as! [String], "choices")
                // The space a made to-do takes: only a to-do takes one, and (2a, A12) a repeat's rule.
                let choice = [.todo, .repeating].contains(first.kind) ? reading.choices.first : nil
                switch choice {
                case .space(let id): try equal(id, expected["space"] as? String, "space")
                case .new(let made):
                    try equal(nil, expected["space"] as? String, "space")
                    let new = expected["newSpace"] as! [String: String]
                    try equal(made, new["name"]!, "new space")
                    try equal(spaces.nextColor.rawValue, new["color"]!, "new colour")
                    var after = spaces
                    let id = after.addSpace(name: made, now: now)!
                    try expect(id.range(of: "^s-[0-9a-f]{6}$", options: .regularExpression) != nil, "new id \(id)")
                    try equal(after.space(id)?.order, 3, "new order")
                case .noSpace, nil: try equal(nil, expected["space"] as? String, "space")
                }
            }
        }

        // MARK: S11, S12, S19: the lens

        for entry in cases["lens"] as! [[String: Any]] {
            try test("\(entry["case"]!) lens \(entry["now"]!)") {
                var spaces = entry["noSpaces"] as? Bool == true ? TodoSpaces() : base
                if let id = entry["deleteSpace"] as? String {
                    spaces.items["X"] = TodoSpaces.Place(space: id, at: now)
                    let moved = spaces.deleteSpace(id, now: now)
                    try equal(moved, ["X"], "S12 moved")
                    // S12: the to-do reads as none, and the file keeps its entry.
                    try equal(spaces.spaceID(of: "X"), nil, "S12 space")
                    try expect(spaces.encoded().contains("\"space\": \"\(id)\""), "S12 entry kept")
                }
                let lens = try JSONDecoder().decode(SpaceLens.self, from: json(entry["lens"]!))
                let shown = SpaceLens.shown(lens, spaces: spaces, now: at(entry["now"] as! String), calendar: calendar)
                try equal(shown.lensID, entry["expect"] as? String, "shown")
            }
        }

        // MARK: S13–S15, W3: merging

        func file(_ items: [String: Any]) throws -> TodoSpaces {
            var object = cases["file"] as! [String: Any]
            object["items"] = items
            return try TodoSpaces.decode(json(object))
        }
        for entry in cases["merges"] as! [[String: Any]] {
            try test("\(entry["case"]!) merge") {
                let merged = TodoSpaces.merge(existing: try file(entry["existing"] as! [String: Any]), incoming: try file(entry["incoming"] as! [String: Any]))
                for (todo, space) in entry["expect"] as! [String: Any] {
                    try equal(merged.items[todo]?.space, space as? String, todo)
                    try expect(merged.items[todo] != nil, "\(todo) kept")
                }
            }
        }
        for entry in cases["renames"] as! [[String: Any]] {
            try test("\(entry["case"]!) rename") {
                func named(_ side: [String: Any]) -> TodoSpaces {
                    var copy = base
                    copy.spaces[0].name = side["name"] as! String
                    copy.spaces[0].updatedAt = at(side["updatedAt"] as! String)
                    return copy
                }
                let merged = TodoSpaces.merge(existing: named(entry["existing"] as! [String: Any]), incoming: named(entry["incoming"] as! [String: Any]))
                try equal(merged.space("s-a")?.name, entry["expect"] as? String, "name")
            }
        }

        // MARK: S16: unknown keys, byte for byte

        let canonical = cases["S16"] as! String
        try test("S16 unknown keys survive a read and a write, byte for byte") {
            let read = try TodoSpaces.decode(Data(canonical.utf8))
            try equal(read.encoded(), canonical, "bytes")
            try equal(read.series?["daily-water"]?.space, "s-b", "series read (2a)")
            try equal(read.extra["series"] == nil, true, "series not an unknown key")
            try equal(read.space("s-a")?.extra["icon"], .string("briefcase"), "icon")
            try equal(read.items["0B1C5E2A-6F3D-4C8B-9A7E-1D2F3A4B5C6D"]?.extra["pin"], .bool(true), "pin")
            // An unknown colour is kept and drawn lavender; a tombstone isn't shown.
            try equal(read.spaces.first { $0.id == "s-c" }?.colorKey, .lavender, "unknown colour")
            try equal(read.visible.map(\.id), ["s-a", "s-b"], "visible")
            // A change keeps them too.
            var changed = read
            changed.rename("s-a", to: "직장", now: now)
            let again = try TodoSpaces.decode(Data(changed.encoded().utf8))
            try equal(again.extra, read.extra, "top-level kept after a change")
            try equal(again.space("s-a")?.extra["icon"], .string("briefcase"), "icon after a change")
            try equal(again.space("s-a")?.name, "직장", "renamed")
        }

        // MARK: S23–S26: 일반's name (#89)

        let general = cases["general"] as! [String: Any]
        func generalOf(_ value: Any?) throws -> TodoSpaces.General? {
            guard let value = value as? [String: Any] else { return nil }
            return try TodoSpaces.decode(json(["general": value])).general
        }
        func shownNames(_ spaces: TodoSpaces) -> [String: String] {
            ["ko": spaces.generalName(.ko), "en": spaces.generalName(.en), "nl": spaces.generalName(.nl)]
        }
        try test("S23–S24 일반 renamed; blank or a default name: back to the default") {
            try equal(shownNames(base), general["names"] as! [String: String], "default names")
            for entry in general["renames"] as! [[String: Any]] {
                var spaces = base
                spaces.general = try generalOf(entry["general"])
                spaces.renameGeneral(to: entry["to"] as! String, now: at(entry["now"] as! String))
                let label = "\(entry["case"]!) ‘\(entry["to"]!)’"
                try equal(spaces.general, try generalOf(entry["expect"]), label)
                try equal(shownNames(spaces), entry["shown"] as! [String: String], label + " shown")
            }
        }
        try test("S25 일반's name merged: the later one, the file's on the same second") {
            for entry in general["merges"] as! [[String: Any]] {
                var existing = base, incoming = base
                existing.general = try generalOf(entry["existing"])
                incoming.general = try generalOf(entry["incoming"])
                try equal(TodoSpaces.merge(existing: existing, incoming: incoming).general, try generalOf(entry["expect"]), "\(entry["case"]!) \((entry["note"] as? String) ?? "")")
            }
        }
        try test("S26 일반's name in the file: byte for byte, its unknown keys and an odd one kept") {
            let text = general["S26"] as! String
            let read = try TodoSpaces.decode(Data(text.utf8))
            try equal(read.encoded(), text, "bytes")
            try equal(shownNames(read), general["S26names"] as! [String: String], "names")
            try equal(read.general?.extra["icon"], .string("tray"), "unknown key in it")
            try equal(read.series, [:], "an empty series kept (2a)")
            var renamed = read
            renamed.renameGeneral(to: "개인", now: now)
            let again = try TodoSpaces.decode(Data(renamed.encoded().utf8))
            try equal(again.general?.extra["icon"], .string("tray"), "kept after a rename")
            try equal(again.general?.name, "개인", "renamed")
            // A `general` this version can't read stays as it was, and reads as the default.
            let odd = general["S26odd"] as! String
            let oddRead = try TodoSpaces.decode(Data(odd.utf8))
            try equal(oddRead.encoded(), odd, "odd bytes")
            try equal(oddRead.generalName(.en), "General", "odd: the default")
            // Not renamed: no key.
            try equal(base.encoded().contains("\"general\""), false, "no key by default")
        }

        // MARK: S17, S22: pruning

        try test("S17 S22 entries of gone to-dos and tombstones older than 30 days go at a save") {
            let prune = cases["prune"] as! [String: Any]
            var spaces = TodoSpaces(spaces: [base.spaces[0]])
            for (id, day) in prune["tombstones"] as! [String: String] {
                spaces.spaces.append(TodoSpaces.Space(id: id, name: id, color: "gray", order: 9, updatedAt: at(day), deleted: true))
            }
            for (todo, place) in prune["items"] as! [String: [String: String]] {
                spaces.items[todo] = TodoSpaces.Place(space: place["space"], at: at(place["at"]!))
            }
            let pruned = spaces.pruned(todoIDs: Set(prune["todos"] as! [String]), now: at(prune["now"] as! String))
            try equal(pruned.items.keys.sorted(), prune["expectItems"] as! [String], "items")
            try equal(pruned.spaces.map(\.id).sorted(), prune["expectSpaces"] as! [String], "spaces")
        }

        // MARK: S18: the backup

        try test("S18 a backup merged in follows S13 and S14") {
            let mine = try file(["X": ["at": "2026-10-28T01:00:00Z", "space": "s-a"], "Y": ["at": "2026-10-28T01:05:00Z", "space": NSNull()], "Z": ["at": "2026-10-28T01:00:00Z", "space": "s-c"]])
            let backup = try file(["X": ["at": "2026-10-28T01:05:00Z", "space": "s-b"], "Y": ["at": "2026-10-28T01:00:00Z", "space": "s-a"], "W": ["at": "2026-10-28T01:00:00Z", "space": "s-b"]])
            try expect(Backup.dataFiles.contains(TodoSpaces.fileName), "a data file")
            let text = Backup.make(files: [TodoSpaces.fileName: backup.encoded()], exportedAt: now, from: "macOS 1.45.0")
            let parsed = try Backup.parse(text)
            let merged = Backup.merge(current: [TodoSpaces.fileName: mine.encoded()], imported: parsed.files)
            let result = try TodoSpaces.decode(Data(merged[TodoSpaces.fileName]!.utf8))
            try equal(result.items["X"]?.space, "s-b", "X (S13)")
            try equal(result.items["Y"].map { $0.space == nil }, true, "Y (S14)")
            try equal(result.items["Z"]?.space, "s-c", "Z kept")
            try equal(result.items["W"]?.space, "s-b", "W added")
            try equal(merged[TodoSpaces.fileName]!, result.encoded(), "written in the file's bytes")
            // Only the backup has one: taken as it is; this Mac's unreadable one: the backup's.
            try equal(Backup.merge(current: [:], imported: parsed.files)[TodoSpaces.fileName], parsed.files[TodoSpaces.fileName], "taken")
            try equal(Backup.merge(current: [TodoSpaces.fileName: "{ broken"], imported: parsed.files)[TodoSpaces.fileName], parsed.files[TodoSpaces.fileName], "mine unreadable")
            // An unreadable one in the backup refuses it.
            do {
                _ = try Backup.parse(Backup.make(files: [TodoSpaces.fileName: "{ not json"], exportedAt: now, from: "x"))
                try expect(false, "bad spaces accepted")
            } catch let problem as Backup.Problem {
                try equal(problem, .unreadable(TodoSpaces.fileName), "refused")
            }
        }

        // MARK: S21: an unreadable file

        try test("S21 a file that isn't the spaces file can't be read; its name aside") {
            for text in cases["unreadable"] as! [String] {
                do {
                    _ = try TodoSpaces.decode(Data(text.utf8))
                    try expect(false, "read: \(text)")
                } catch TodoSpaces.ReadError.unreadable {}
            }
            for text in cases["readable"] as! [String] {
                try equal(try TodoSpaces.decode(Data(text.utf8)), TodoSpaces(), text)
            }
            try equal(TodoSpaces.asideName(at("2026-10-28T09:00:00Z")), "todo-spaces.json.unreadable-20261028-090000", "aside name")
            try equal(TodoSpaces().encoded(), "{\n  \"items\": {},\n  \"spaces\": [],\n  \"version\": 1\n}\n", "empty file")
        }

        // MARK: S32–S36: the repeat rules' spaces (2a)

        let rules = cases["series"] as! [String: Any]
        func seriesOf(_ value: Any?) throws -> [String: TodoSpaces.SeriesPlace]? {
            guard let value = value as? [String: Any] else { return nil }
            return try TodoSpaces.decode(json(["series": value])).series
        }
        func spacesOf(_ series: [String: TodoSpaces.SeriesPlace]?) -> [String: String?]? {
            series?.mapValues { $0.space }
        }
        func expectedSpaces(_ value: Any?) -> [String: String?]? {
            (value as? [String: Any])?.mapValues { $0 as? String }
        }
        try test("S32 rules' spaces merged: the later one, the file's on the same second") {
            for entry in rules["merges"] as! [[String: Any]] {
                var existing = base, incoming = base
                existing.series = try seriesOf(entry["existing"])
                incoming.series = try seriesOf(entry["incoming"])
                let merged = TodoSpaces.merge(existing: existing, incoming: incoming)
                try equal(spacesOf(merged.series), expectedSpaces(entry["expect"]), "S32 \((entry["note"] as? String) ?? "")")
            }
        }
        try test("S33 rules' spaces in the file: byte for byte, unknown keys kept, an odd series kept, unreadable entries out") {
            let text = rules["S33"] as! String
            let read = try TodoSpaces.decode(Data(text.utf8))
            try equal(read.encoded(), text, "bytes")
            try equal(read.series?["4C2B7A10-0D3E-4F5A-8B6C-7D8E9F0A1B2C"]?.extra["pin"], .bool(true), "unknown key in a rule")
            try equal(read.series?["daily-water"].map { $0.space == nil }, true, "null kept")
            var changed = read
            changed.setSeriesSpace("4C2B7A10-0D3E-4F5A-8B6C-7D8E9F0A1B2C", to: nil, now: now)
            let again = try TodoSpaces.decode(Data(changed.encoded().utf8))
            try equal(again.series?["4C2B7A10-0D3E-4F5A-8B6C-7D8E9F0A1B2C"]?.extra["pin"], .bool(true), "kept after a change")
            let odd = rules["S33odd"] as! String
            var oddRead = try TodoSpaces.decode(Data(odd.utf8))
            try equal(oddRead.encoded(), odd, "odd bytes")
            try equal(oddRead.series == nil, true, "odd: no rules")
            oddRead.setSeriesSpace("daily-water", to: "s-gone", now: now)
            try equal(oddRead.encoded(), odd, "odd: nothing for a gone space")
            var withSpace = oddRead
            withSpace.spaces = base.spaces
            withSpace.setSeriesSpace("daily-water", to: "s-a", now: now)
            try equal(withSpace.extra["series"] == nil, true, "odd: replaced once a rule has a space")
            try equal(withSpace.seriesSpaceID(of: "daily-water"), "s-a", "odd: the new one")
            let dropped = try TodoSpaces.decode(Data((rules["S33dropped"] as! String).utf8))
            try equal(spacesOf(dropped.series), expectedSpaces(rules["S33droppedExpect"]), "unreadable entries out")
        }
        func places(_ value: Any?) throws -> [String: TodoSpaces.Place] {
            try file(value as? [String: Any] ?? [:]).items
        }
        try test("S34 a rule's space set; its open to-dos move with it") {
            for entry in rules["sets"] as! [[String: Any]] {
                let label = "S34 \(entry["to"] ?? "nil") \((entry["note"] as? String) ?? "")"
                var spaces = base
                spaces.series = try seriesOf(entry["series"])
                spaces.items = try places(entry["items"])
                spaces.setSeriesSpace(entry["seriesID"] as! String, to: entry["to"] as? String, copies: entry["copies"] as! [String],
                                      now: at(entry["now"] as! String))
                try equal(spaces.series, try seriesOf(entry["expect"]), label)
                try equal(spaces.items, try places(entry["expectItems"]), label + " items")
            }
        }
        try test("S35 to-dos made from a rule go to its space; moving one moves only it") {
            let copies = rules["copies"] as! [String: Any]
            var spaces = base
            spaces.series = try seriesOf(copies["series"])
            _ = spaces.deleteSpace(copies["deleteSpace"] as! String, now: now)
            let made = (copies["made"] as! [[String: String]]).map { (todo: $0["todo"]!, series: $0["series"]!) }
            spaces.placeCopies(made, now: at(copies["now"] as! String))
            try equal(spaces.items, try places(copies["expectItems"]), "placed")
            let move = copies["thenMove"] as! [String: String]
            spaces.move(move["todo"]!, to: move["to"], now: at(move["now"]!))
            let after = copies["expectAfterMove"] as! [String: Any]
            try equal(spaces.items, try places(after["items"]), "moved")
            try equal(spacesOf(spaces.series), expectedSpaces(after["series"]), "the rule as it was")
        }
        try test("S36 rules gone from repeats.json for more than 30 days go at a save; not when repeats.json didn't read") {
            let prune = rules["prune"] as! [String: Any]
            var spaces = base
            spaces.series = try seriesOf(prune["series"])
            let when = at(prune["now"] as! String)
            let pruned = spaces.pruned(todoIDs: [], seriesIDs: Set(prune["seriesIDs"] as! [String]), now: when)
            try equal(pruned.series?.keys.sorted(), prune["expect"] as? [String], "pruned")
            try equal(spaces.pruned(todoIDs: [], seriesIDs: nil, now: when).series?.keys.sorted(), prune["expectWithoutRepeats"] as? [String], "unreadable repeats")
        }

        // MARK: S37–S38: the lens on the 앞으로 tab and the day strip (2a)

        let todoDecoder = JSONDecoder()
        todoDecoder.dateDecodingStrategy = .iso8601
        func todos(_ block: [String: Any]) throws -> [TodoItem] {
            try todoDecoder.decode([TodoItem].self, from: json(block["todos"]!))
        }
        func lensOf(_ value: Any?) -> SpaceLens.Shown {
            (value as? String).map { $0 == SpaceLens.none ? .noSpace : .space($0) } ?? .all
        }
        let ahead = cases["ahead"] as! [String: Any]
        let aheadItems = try todos(ahead)
        let aheadSpaces = ahead["spaces"] as! [String: String]
        for entry in ahead["cases"] as! [[String: Any]] {
            try test("S37 앞으로 under the lens \(entry["lens"] as? String ?? "all")") {
                let shown = lensOf(entry["lens"])
                let lensed = Ahead.lensed(aheadItems, now: now, calendar: calendar) { shown.includes(aheadSpaces[$0.id.uuidString]) }
                let sections = Ahead.sections(items: lensed.items, events: [], now: now, calendar: calendar, language: .ko)
                let expected = entry["expect"] as! [String: Any]
                var counts: [String: Int] = [:]
                for section in sections { counts[section.kind.rawValue] = section.count }
                try equal(counts, expected["counts"] as! [String: Int], "counts")
                var days: [String: [String]] = [:]
                for day in sections.flatMap(\.days) where !day.tasks.isEmpty { days[day.date] = day.tasks.map(\.uuidString) }
                try equal(days, expected["days"] as! [String: [String]], "days")
                try equal(lensed.hidden, expected["hidden"] as! Int, "hidden")
            }
        }
        let strip = cases["strip"] as! [String: Any]
        let stripItems = try todos(strip)
        let stripSpaces = strip["spaces"] as! [String: String]
        let events = (strip["events"] as! [[String: String]]).enumerated().map { index, event in
            CalendarEvent(key: "local/e\(index)@2026-10-28", calendarId: "local", title: event["title"]!, allDay: false,
                          start: at(event["start"]!), end: at(event["end"]!), color: "#7a9e7e")
        }
        for entry in strip["cases"] as! [[String: Any]] {
            try test("S38 the day strip under the lens \(entry["lens"] as? String ?? "all")") {
                let shown = lensOf(entry["lens"])
                let tasks = stripItems.filter { shown.includes(stripSpaces[$0.id.uuidString]) }
                let state = DayStrip.state(DayStrip.items(events: events, tasks: tasks, now: now, calendar: calendar), now: now, rows: 3)
                let expected = entry["expect"] as! [String: Any]
                try equal("\(state.mode)", expected["mode"] as! String, "mode")
                try equal(state.lead?.title, expected["lead"] as? String, "lead")
                try equal(state.rows.map(\.title), expected["rows"] as! [String], "rows")
            }
        }

        // MARK: S39–S44: 스페이스별로 묶기 (2b)

        let grouping = cases["groups"] as! [String: Any]
        let groupItems = try todos(grouping)
        let groupSpaces = grouping["spaces"] as! [String: String]
        let kst = DateFormatter()
        kst.calendar = calendar
        kst.timeZone = calendar.timeZone
        kst.dateFormat = "HH:mm"
        let titleOf = Dictionary(uniqueKeysWithValues: groupItems.map { ($0.id, $0.title) })
        func groupsOf(_ items: [TodoItem], _ spaceMap: [String: String], lens: SpaceLens.Shown) -> [SpaceGroups.Group] {
            SpaceGroups.groups(items, spaces: base, shown: lens, now: now, calendar: calendar) { spaceMap[$0.uuidString] }
        }
        func checkGroups(_ groups: [SpaceGroups.Group], _ expected: [[String: Any]]) throws {
            try equal(groups.count, expected.count, "group count")
            for (group, want) in zip(groups, expected) {
                try equal(group.space, want["space"] as? String, "space")
                try equal(group.items.map { titleOf[$0]! }, want["titles"] as! [String], "titles of \(group.id)")
                try equal(group.open, want["open"] as! Int, "open of \(group.id)")
                try equal(group.done.count, want["done"] as! Int, "done of \(group.id)")
                try equal(group.next.map { kst.string(from: $0) }, want["next"] as? String, "next of \(group.id)")
            }
        }
        for entry in grouping["cases"] as! [[String: Any]] {
            try test("\(entry["case"]!) the groups under the lens \(entry["lens"] as? String ?? "all")") {
                try checkGroups(groupsOf(groupItems, groupSpaces, lens: lensOf(entry["lens"])), entry["expect"] as! [[String: Any]])
            }
        }
        let firstCase = (grouping["cases"] as! [[String: Any]])[0]["expect"] as! [[String: Any]]
        for entry in grouping["drops"] as! [[String: Any]] {
            try test("S43 a drop: \(entry["note"]!)") {
                let id = UUID(uuidString: entry["id"] as! String)!
                let to = SpaceGroups.space(entry["to"] as! String)
                var order = groupItems.map(\.id)
                let back = SpaceGroups.returnPoint(of: id, in: order)
                if let target = (entry["relativeTo"] as? String).flatMap(UUID.init(uuidString:)) {
                    order = SpaceGroups.moved(order, id, relativeTo: target, after: entry["after"] as! Bool)
                }
                var map = groupSpaces
                let was = map[id.uuidString]
                map[id.uuidString] = to
                let byID = Dictionary(uniqueKeysWithValues: groupItems.map { ($0.id, $0) })
                try checkGroups(groupsOf(order.compactMap { byID[$0] }, map, lens: .all), entry["expect"] as! [[String: Any]])
                // 되돌리기: its space and its place in the list as they were.
                map[id.uuidString] = was
                if let back { order = SpaceGroups.moved(order, id, relativeTo: back.target, after: back.after) }
                try equal(order, groupItems.map(\.id), "the list's order after 되돌리기")
                try checkGroups(groupsOf(order.compactMap { byID[$0] }, map, lens: .all), firstCase)
            }
        }
        for entry in grouping["keys"] as! [[String: Any]] {
            try test("S44 ⌥⌘\(entry["direction"] as! String == "up" ? "↑" : "↓") \(entry["note"] as? String ?? "")") {
                let groups = groupsOf(groupItems, groupSpaces, lens: lensOf(entry["lens"]))
                let target = SpaceGroups.neighbor(of: UUID(uuidString: entry["id"] as! String)!, step: entry["direction"] as! String == "up" ? -1 : 1, in: groups)
                try equal(target, entry["to"] as? String, "the group it goes to")
            }
        }

        let board = grouping["board"] as! [String: Any]
        let widths = board["maxWidth"] as! [String: Double]
        try test("S45 the note's widest: 1,200 grouped, 720 not") {
            try equal(SpaceGroups.wideNote, widths["grouped"]!, "grouped")
            try equal(SpaceGroups.narrowNote, widths["plain"]!, "plain")
        }
        for entry in board["cases"] as! [[String: Any]] {
            try test("S45 \(entry["count"]!) groups at \(entry["width"]!): \((entry["columns"] as! Bool) ? "columns" : "cards")") {
                try equal(SpaceGroups.boardFits(width: entry["width"] as! Double, count: entry["count"] as! Int), entry["columns"] as! Bool, "columns")
            }
        }

        // MARK: S46–S48: several to-dos picked and moved at once (#168)

        let multi = cases["multi"] as! [String: Any]
        let names = multi["rows"] as! [String]
        let rowIDs = names.indices.map { UUID(uuidString: String(format: "E0000000-0000-4000-8000-%012d", $0 + 1))! }
        let nameOf = Dictionary(uniqueKeysWithValues: zip(rowIDs, names))
        let idOf = Dictionary(uniqueKeysWithValues: zip(names, rowIDs))
        for entry in multi["selection"] as! [[String: Any]] {
            try test("S46 picking: \(entry["note"] as? String ?? "\(entry["steps"]!)")") {
                var selection = ListSelection()
                for step in entry["steps"] as! [[Any]] {
                    switch step[0] as! String {
                    case "click": selection.click(idOf[step[1] as! String]!)
                    case "toggle": selection.toggle(idOf[step[1] as! String]!, order: rowIDs)
                    case "range": selection.range(to: idOf[step[1] as! String]!, order: rowIDs)
                    case "extend": selection.extend(step[1] as! Int, order: rowIDs)
                    default: selection.clear()
                    }
                }
                let want = entry["expect"] as! [String: Any]
                try equal(selection.ordered(rowIDs).map { nameOf[$0]! }, want["ids"] as! [String], "ids")
                try equal(selection.focus.map { nameOf[$0]! }, want["focus"] as? String, "focus")
                try equal(selection.anchor.map { nameOf[$0]! }, want["anchor"] as? String, "anchor")
            }
        }
        let byID = Dictionary(uniqueKeysWithValues: groupItems.map { ($0.id, $0) })
        let listOrder = groupItems.map(\.id)
        for entry in multi["moves"] as! [[String: Any]] {
            try test("S47 several moved: \(entry["note"]!)") {
                let ids = (entry["ids"] as! [String]).map { UUID(uuidString: $0)! }
                let to = SpaceGroups.space(entry["to"] as! String)
                var order = listOrder
                if let target = (entry["relativeTo"] as? String).flatMap(UUID.init(uuidString:)) {
                    order = SpaceGroups.movedBlock(order, ids, relativeTo: target, after: entry["after"] as! Bool)
                }
                var map = groupSpaces
                var moved = 0
                for id in ids where map[id.uuidString] != to { map[id.uuidString] = to; moved += 1 }
                try equal(moved, entry["moved"] as! Int, "moved")
                try checkGroups(groupsOf(order.compactMap { byID[$0] }, map, lens: .all), entry["expect"] as! [[String: Any]])
                // 되돌리기: every space and place as it was.
                order = SpaceGroups.restored(order, ids, previous: listOrder)
                try equal(order, listOrder, "the list's order after 되돌리기")
                try checkGroups(groupsOf(order.compactMap { byID[$0] }, groupSpaces, lens: .all), firstCase)
            }
        }
        for entry in multi["keys"] as! [[String: Any]] {
            try test("S48 ⌥⌘\(entry["direction"] as! String == "up" ? "↑" : "↓") with several picked \(entry["note"] as? String ?? "")") {
                let ids = (entry["ids"] as! [String]).map { UUID(uuidString: $0)! }
                let focus = UUID(uuidString: entry["focus"] as! String)!
                let selection = ListSelection(anchor: focus, focus: focus, ids: Set(ids))
                let groups = groupsOf(groupItems, groupSpaces, lens: .all)
                let target = SpaceGroups.neighbor(of: selection, step: entry["direction"] as! String == "up" ? -1 : 1, in: groups)
                try equal(target, entry["to"] as? String, "the group")
                let moved = target.map { key in ids.filter { groupSpaces[$0.uuidString] != SpaceGroups.space(key) }.count } ?? 0
                try equal(moved, entry["moved"] as! Int, "moved")
            }
        }
        try test("#168 words: 3개를 집으로 옮겼어요, one as before, the badge") {
            try equal(SpaceWords.moved(3, to: "집", language: .ko), "3개를 집으로 옮겼어요", "ko")
            try equal(SpaceWords.moved(3, to: "Home", language: .en), "Moved 3 to Home", "en")
            try equal(SpaceWords.moved(3, to: "Thuis", language: .nl), "3 verplaatst naar Thuis", "nl")
            try equal(SpaceWords.moved(1, to: "회사", language: .ko), "회사로 옮겼어요", "one")
            try equal(SpaceWords.badge(3, language: .ko), "3개", "badge")
        }

        try test("#168 reorder: the list in a given order as one undo step; the same order changes nothing") {
            var history = UndoableNotebook(notebook: Notebook())
            for title in ["가", "나", "다", "라"] { _ = history.add(title, shelf: nil) }
            let ids = history.notebook.items.map(\.id)
            try equal(history.reorder(ids), false, "same order")
            try equal(history.reorder([ids[2], ids[0]]), true, "changed")
            try equal(history.notebook.items.map(\.title), ["다", "가", "나", "라"], "order")
            _ = history.undo()
            try equal(history.notebook.items.map(\.title), ["가", "나", "다", "라"], "undone")
        }

        // MARK: S49–S54: 찾기의 `#스페이스` (2c)

        let searching = cases["search"] as! [String: Any]
        /// The file with the block's places (`spaces`: to-do id → space id).
        func placed(_ places: [String: String]) throws -> TodoSpaces {
            var file = cases["file"] as! [String: Any]
            file["items"] = places.mapValues { ["space": $0, "at": "2026-10-20T00:00:00Z"] }
            return try TodoSpaces.decode(json(file))
        }
        let searchSpaces = try placed(searching["spaces"] as! [String: String])
        let searchItems = try todos(searching)
        let record = Archive.parseLines((searching["archive"] as! [Any]).map { String(decoding: json($0), as: UTF8.self) }.joined(separator: "\n"))
        let searchMemos = try todoDecoder.decode([Memo].self, from: json(searching["memos"]!))
        try test("C5 the record's lines read their space (and a bad one reads as none)") {
            try equal(record.map(\.space), [nil, "s-a", nil, "s-x"], "spaces")
            try equal(record.map { searchSpaces.spaceID(of: $0) }, [nil, "s-a", "s-b", nil], "C5")
            let odd = Archive.parseLines(#"{"id":"x","title":"t","createdAt":"2026-10-01T00:00:00Z","space":7}"#)
            try equal(odd.map(\.space), [nil], "a number")
            let line = Archive.encodeLine(ArchiveEntry(id: "x", title: "t", createdAt: at("2026-10-01T00:00:00Z"), completedAt: nil, space: "s-a"))
            try equal(Archive.parseLines(line).first?.space, "s-a", "round trip")
            try expect(!Archive.encodeLine(ArchiveEntry(id: "x", title: "t", createdAt: at("2026-10-01T00:00:00Z"), completedAt: nil)).contains("space"),
                       "일반: no key")
        }
        for entry in searching["cases"] as! [[String: Any]] {
            try test("\(entry["case"]!) search \(entry["query"]!)") {
                let spaces = entry["noSpaces"] as? Bool == true ? TodoSpaces() : searchSpaces
                let expected = entry["expect"] as! [String: Any]
                let reading = Search.spaceReading(entry["query"] as! String, spaces: spaces)
                let space: String? = switch reading.space { case .some(let id): id ?? SpaceLens.none; case nil: nil }
                try equal(space, expected["space"] as? String, "space")
                try equal(reading.words, expected["words"] as! String, "words")
                for index in [nil, Search.Index()] as [Search.Index?] {
                    let groups = Search.find(reading.words, items: searchItems, memos: searchMemos, history: record, events: [], now: now,
                                             calendar: calendar, language: .ko, index: index, only: Search.only(reading, spaces: spaces))
                    func hits(_ group: Search.Group) -> [String] {
                        groups.first { $0.group == group }?.hits.map { group == .memos ? $0.id : $0.text } ?? []
                    }
                    for (name, group) in [("today", Search.Group.today), ("ahead", .ahead), ("memos", .memos), ("history", .history)] {
                        try equal(hits(group), expected[name] as! [String], name + (index == nil ? "" : " (index)"))
                    }
                }
            }
        }

        // MARK: S55–S56: 완료 기록 · 집중 기록 거르기 (2c)

        let filtering = cases["history"] as! [String: Any]
        let focusLines = Focus.parse((filtering["focus"] as! [Any]).map { String(decoding: json($0), as: UTF8.self) }.joined(separator: "\n"))
        try test("H3 the focus lines read their space") {
            try equal(focusLines.map(\.space), ["s-a", nil, nil, nil, "s-b"], "own")
            try equal(focusLines.map { searchSpaces.spaceID(of: $0) }, ["s-a", "s-b", nil, nil, "s-b"], "H3")
            let line = Focus.encodeLine(Focus.record(taskId: "T", title: "t", start: now, end: now.addingTimeInterval(600), kind: .focus, space: "s-a")!)
            try equal(Focus.parse(line).first?.space, "s-a", "round trip")
            let timer = Focus.record(title: "", start: now, end: now.addingTimeInterval(600), kind: .timer, space: "s-a")!
            try equal(timer.space, nil, "a timer takes none")
        }
        for entry in filtering["cases"] as! [[String: Any]] {
            try test("\(entry["case"]!) history filter \(entry["filter"] as? String ?? "all")") {
                let filter: SpaceFilter = switch entry["filter"] as? String {
                case nil: .all
                case SpaceLens.none?: .general
                case let id?: .space(id)
                }
                let expected = entry["expect"] as! [String: Any]
                try equal(searchSpaces.kept(record, in: filter).map(\.id), expected["archive"] as! [String], "archive")
                try equal(searchSpaces.kept(focusLines, in: filter).map(\.id), expected["focus"] as! [String], "focus")
            }
        }
        try test("H4 a deleted space's filter is back to all") {
            try equal(SpaceFilter.space("s-x").live(in: searchSpaces), .all, "gone")
            try equal(SpaceFilter.space("s-a").live(in: searchSpaces), .space("s-a"), "live")
            try equal(SpaceFilter.general.live(in: TodoSpaces()), .all, "no spaces")
        }

        // MARK: The Mac's own cases

        try test("W2 the bytes: spread out, keys sorted, deleted only when true, a newline at the end") {
            var spaces = TodoSpaces()
            let id = spaces.addSpace(name: "  회사\n일  ", now: at("2026-10-28T09:00:00.700Z"), id: "s-7f3a9c")!
            spaces.move("6F1C0000-0000-4000-8000-000000000000", to: id, now: at("2026-10-28T09:01:00Z"))
            try equal(spaces.encoded(), """
            {
              "items": {
                "6F1C0000-0000-4000-8000-000000000000": {
                  "at": "2026-10-28T09:01:00Z",
                  "space": "s-7f3a9c"
                }
              },
              "spaces": [
                {
                  "color": "lavender",
                  "id": "s-7f3a9c",
                  "name": "회사 일",
                  "order": 0,
                  "updatedAt": "2026-10-28T09:00:00Z"
                }
              ],
              "version": 1
            }

            """, "bytes")
            try equal(KeptJSON.shortest(1e-7), "1e-7", "small")
            try equal(KeptJSON.shortest(1e21), "1e+21", "large")
            try equal(KeptJSON.shortest(2.5), "2.5", "plain")
        }

        try test("W6 new spaces: the first colour not in use, then by count; order after the last") {
            var spaces = TodoSpaces()
            try equal(spaces.nextColor, .lavender, "first")
            for (n, name) in ["회사", "집", "공부", "운동", "가족", "취미", "독서", "여행"].enumerated() {
                _ = spaces.addSpace(name: name, now: now, id: "s-00000\(n)")
            }
            try equal(spaces.visible.map(\.color), TodoSpaces.Color.allCases.map(\.rawValue), "eight colours in order")
            try equal(spaces.nextColor, .lavender, "all taken: 8 % 8")
            spaces.recolor("s-000001", to: .gray, now: now)
            try equal(spaces.nextColor, .pink, "a colour freed")
            try equal(spaces.addSpace(name: "  ", now: now), nil, "blank name")
            try equal(spaces.visible.map(\.order), Array(0..<8), "orders")
        }

        try test("moving: to a space, to none (an entry), nothing for a gone space or none without an entry") {
            var spaces = base
            spaces.move("T", to: nil, now: now)
            try equal(spaces.items["T"] == nil, true, "none without an entry")
            spaces.move("T", to: "s-zz", now: now)
            try equal(spaces.items["T"] == nil, true, "unknown space")
            spaces.move("T", to: "s-a", now: now)
            try equal(spaces.spaceID(of: "T"), "s-a", "moved")
            spaces.move("T", to: nil, now: now.addingTimeInterval(60))
            try equal(spaces.items["T"].map { $0.space == nil }, true, "an entry for none")
            try equal(spaces.encoded().contains("\"space\": null"), true, "written as null")
        }

        try test("deleting and 되돌리기: the space back with its to-dos") {
            var spaces = base
            spaces.move("T1", to: "s-a", now: now)
            spaces.move("T2", to: "s-a", now: now)
            let moved = spaces.deleteSpace("s-a", now: now)!
            try equal(moved, ["T1", "T2"], "its to-dos")
            try equal(spaces.visible.map(\.id), ["s-b", "s-c"], "gone")
            try equal(spaces.spaceID(of: "T1"), nil, "reads as none")
            spaces.restoreSpace("s-a", todoIDs: moved, now: now.addingTimeInterval(5))
            try equal(spaces.visible.map(\.id), ["s-a", "s-b", "s-c"], "back")
            try equal(spaces.spaceID(of: "T2"), "s-a", "its to-dos back")
            try equal(spaces.deleteSpace("s-zz", now: now), nil, "no such space")
        }

        try test("reorder: the dragged order; only moved ones get a new time") {
            var spaces = base
            let later = now.addingTimeInterval(3600)
            spaces.reorder(["s-b", "s-a"], now: later)
            try equal(spaces.visible.map(\.id), ["s-b", "s-a", "s-c"], "order")
            try equal(spaces.space("s-a")?.updatedAt, later, "moved: a new time")
            try equal(spaces.space("s-c")?.updatedAt, at("2026-10-01T00:00:00Z"), "s-c stayed third: its time kept")
        }

        try test("W5 tokens: tabs, punctuation, several lines, NFD, the space removed with it") {
            try equal(SpaceToken.find("빨래\t#집")?.name, "집", "after a tab")
            try equal(SpaceToken.find("보고서 #회사, 내일")?.name, "회사,", "punctuation in it")
            try equal(SpaceToken.find("첫 줄\n#회사 둘째 줄")?.name, nil, "only the first line")
            try equal(SpaceToken.find("#")?.name, nil, "a lone #")
            let found = SpaceToken.find("#회사 보고서")!
            try equal(SpaceToken.removing(found, from: "#회사 보고서"), " 보고서", "at the start")
            try equal(SpaceToken.removing(SpaceToken.find("보고서  #회사")!, from: "보고서  #회사"), "보고서 ", "one space only")
            let decomposed = "#" + "회사".decomposedStringWithCanonicalMapping
            try equal(SpaceToken.choices(String(decomposed.dropFirst()), in: base), [.space("s-a"), .noSpace], "NFD")
            try equal(SpaceToken.choices("공", in: base), [.space("s-c"), .noSpace], "prefix")
            try equal(SpaceToken.choices("ㄱ", in: base), [.space("s-c"), .noSpace], "initial")
            try equal(SpaceToken.initialsOf("a업무"), "aㅇㅁ", "other characters as they are")
        }

        try test("several matches: the whole name, then the start, then the first consonants, each once") {
            var spaces = TodoSpaces()
            _ = spaces.addSpace(name: "회사일", now: now, id: "s-1")
            _ = spaces.addSpace(name: "회사", now: now, id: "s-2")
            _ = spaces.addSpace(name: "회의록", now: now, id: "s-3")
            try equal(SpaceToken.choices("회사", in: spaces), [.space("s-2"), .space("s-1"), .noSpace], "exact first")
            try equal(SpaceToken.choices("ㅎ", in: spaces), [.space("s-1"), .space("s-2"), .space("s-3"), .noSpace], "initials")
        }

        try test("⌘⌥ digits: the spaces in order, 0 everything, past the last nothing") {
            try equal(SpaceLens.forDigit(1, spaces: base), .space("s-a"), "1")
            try equal(SpaceLens.forDigit(3, spaces: base), .space("s-c"), "3")
            try equal(SpaceLens.forDigit(4, spaces: base), nil, "4")
            try equal(SpaceLens.forDigit(0, spaces: base), .all, "0")
            try equal(SpaceLens.picked(.space("s-b"), now: at("2026-10-27T18:59:00Z"), calendar: calendar), SpaceLens(spaceId: "s-b", day: "2026-10-27"), "picked before 4")
            try equal(SpaceLens.picked(.all, now: now, calendar: calendar), nil, "all: no lens")
            try equal(SpaceLens.Shown.noSpace.includes(nil), true, "none shows none")
            try equal(SpaceLens.Shown.space("s-a").includes("s-b"), false, "another space hidden")
        }

        try test("words: the particles by the last sound, en and nl") {
            try equal(SpaceWords.moved(to: "회사"), "회사로 옮겼어요", "로")
            try equal(SpaceWords.moved(to: "집"), "집으로 옮겼어요", "으로")
            try equal(SpaceWords.moved(to: "서울"), "서울로 옮겼어요", "ㄹ")
            try equal(SpaceWords.moved(to: "Work"), "Work로 옮겼어요", "Latin")
            try equal(SpaceWords.moved(to: "Team"), "Team으로 옮겼어요", "m")
            try equal(SpaceWords.moved(to: "2030"), "2030으로 옮겼어요", "영")
            try equal(SpaceWords.moved(to: "일반"), "일반으로 옮겼어요", "일반")
            try equal(SpaceWords.moved(to: base.generalName(.en), language: .en), "Moved to General", "General")
            try equal(SpaceWords.deleted("회사"), "스페이스 ‘회사’를 지웠어요", "를")
            try equal(SpaceWords.deleted("집"), "스페이스 ‘집’을 지웠어요", "을")
            try equal(SpaceWords.showing("회사"), "회사만 보는 중", "showing")
            try equal(SpaceWords.showing("Algemeen", language: .nl), "Alleen Algemeen zichtbaar", "showing 일반")
            try equal(SpaceWords.more(4), "다른 스페이스에 4개 더", "#87 ko")
            try equal(SpaceWords.more(1, language: .en), "1 more in other spaces", "#87 en")
            try equal(SpaceWords.more(1466, language: .nl), "Nog 1.466 in andere ruimtes", "#87 nl grouped")
            try equal(SpaceWords.lensLabel("회사", hidden: 4), "회사만 보는 중, 다른 스페이스에 4개 더", "#87 label")
            try equal(SpaceWords.lensLabel("Work", hidden: 0, language: .en), "Showing Work only", "#87 label, none hidden")
            try equal(SpaceWords.lensLabel("Werk", hidden: 1466, language: .nl), "Alleen Werk zichtbaar, nog 1.466 in andere ruimtes", "#87 label nl")
            try equal(SpaceWords.writeIn("Werk", language: .nl), "Naar Werk: een taak, afspraak", "nl hint")
            try equal(SpaceWords.only("Work", language: .en), "Work only", "button")
        }

        try test("the index: every to-do's live space at once") {
            var spaces = base
            spaces.move("A", to: "s-a", now: now)
            spaces.move("B", to: "s-b", now: now)
            _ = spaces.deleteSpace("s-b", now: now)
            try equal(spaces.index().mapValues(\.id), ["A": "s-a"], "index")
            try equal(TodoSpaces().index().isEmpty, true, "none")
        }

        try test("times: read and written by hand, the same as the formatters") {
            let formatter = ISO8601DateFormatter()
            for text in ["2026-10-28T09:01:00Z", "1970-01-01T00:00:00Z", "2024-02-29T23:59:59Z", "2000-03-01T00:00:00Z", "1999-12-31T12:30:05Z", "2100-02-28T01:02:03Z"] {
                try equal(TodoSpaces.plainUTC(text), formatter.date(from: text), text)
                try equal(TodoSpaces.iso(formatter.date(from: text)!), text, "written \(text)")
            }
            try equal(TodoSpaces.plainUTC("2026-10-28T09:01:00.500Z"), nil, "fractions: the formatter's")
            try equal(TodoSpaces.date("2026-10-28T09:01:00.500Z"), at("2026-10-28T09:01:00Z"), "fractions dropped")
            try equal(TodoSpaces.date("2026-10-28T18:01:00+09:00"), at("2026-10-28T09:01:00Z"), "an offset")
            try equal(TodoSpaces.date("not a time"), Date(timeIntervalSince1970: 0), "unreadable: the epoch")
            try equal(TodoSpaces.iso(at("2026-10-28T09:01:00.900Z")), "2026-10-28T09:01:00Z", "whole seconds")
        }

        print("\(count) spaces checks passed")
    }
}
