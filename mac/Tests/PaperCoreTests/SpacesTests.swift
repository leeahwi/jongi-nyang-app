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
                let lens: SpaceLens.Shown = (entry["lens"] as? String).map { $0 == SpaceLens.none ? .noSpace : .space($0) } ?? .all
                let expected = entry["expect"] as! [String: Any]
                let reading = SpaceToken.read(entry["text"] as! String, spaces: spaces, lens: lens)
                let candidates = Intent.read(reading.text, now: now, calendar: calendar, language: .ko)
                guard let first = candidates.first else {
                    try equal(false, expected["added"] as! Bool, "added")
                    try equal(reading.token != nil ? SpaceWords.needsTitle() : nil, expected["hint"] as? String, "hint")
                    return
                }
                try equal(true, expected["added"] as! Bool, "added")
                try equal(first.kind.rawValue, expected["kind"] as! String, "kind")
                let title: String = switch first {
                case .todo(let parsed): parsed.title
                case .event(let event): event.title
                default: ""
                }
                try equal(title, expected["title"] as! String, "title")
                try equal(reading.choices.map(choiceText), expected["choices"] as! [String], "choices")
                // The space a made to-do takes (M4: only a to-do takes one).
                let choice = first.kind == .todo ? reading.choices.first : nil
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
            try equal(read.extra["series"] != nil, true, "series kept")
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
            try equal(SpaceWords.moved(to: "스페이스 없음"), "스페이스 없음으로 옮겼어요", "none")
            try equal(SpaceWords.deleted("회사"), "스페이스 ‘회사’를 지웠어요", "를")
            try equal(SpaceWords.deleted("집"), "스페이스 ‘집’을 지웠어요", "을")
            try equal(SpaceWords.showing("회사"), "회사만 보는 중", "showing")
            try equal(SpaceWords.showing(nil, language: .en), "Showing to-dos without a space", "showing none")
            try equal(SpaceWords.hidden(1, language: .en), "1 other to-do hidden", "en one")
            try equal(SpaceWords.hidden(4, language: .nl), "4 andere taken verborgen", "nl many")
            try equal(SpaceWords.hidden(1466), "다른 할 일 1,466개는 숨겼어요", "grouped")
            try equal(SpaceWords.hidden(1466, language: .nl), "1.466 andere taken verborgen", "nl grouped")
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
