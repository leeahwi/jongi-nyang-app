import Foundation

// 기기마다 보일 스페이스 (SpaceDevice.swift, #196): the shared cases S60–S72 read from docs/plans/spaces-cases.json →
// `device` (Windows test/spaceDevice.test.ts reads the same), then the Mac's own.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    try expect(actual == expected, "\(name): expected \(expected), got \(actual)")
}

private func at(_ text: String) -> Date { ISO8601DateFormatter().date(from: text)! }

@main
private enum SpaceDeviceTests {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "../docs/plans/spaces-cases.json"
        let all = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        let cases = all["device"] as! [String: Any]
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            do { try action() } catch { print("FAIL \(name): \(error)"); throw error }
            count += 1
            print("PASS \(name)")
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: all["timeZone"] as! String)!
        try equal(cases["fitLength"] as! Int, SpaceDevice.fitLength, "fitLength")
        let rawRules = cases["rules"] as! [String: Any]
        func rule(_ name: Any?) -> SpaceDevice.Rule? {
            guard let name = name as? String else { return nil }
            return SpaceDevice.read(["x": rawRules[name]!])["x"]
        }
        func minute(_ text: String) -> Int { SpaceDevice.minutes(text)! }
        func json(_ value: Any, sorted: Bool = false) -> Data { try! JSONSerialization.data(withJSONObject: value, options: sorted ? [.sortedKeys] : []) }
        let spaces = try TodoSpaces.decode(json(["version": 1, "items": [String: Any](), "spaces": cases["spaces"]!]))
        let noSpaces = TodoSpaces()
        func hideRules(_ keys: Any?) -> SpaceDevice.Rules {
            Dictionary(uniqueKeysWithValues: ((keys as? [String]) ?? []).map { ($0, SpaceDevice.Rule.hide) })
        }
        let someday = at("2026-11-03T01:00:00Z")

        // MARK: S60–S63: a day and a minute

        for entry in cases["visible"] as! [[String: Any]] {
            let name = "\(entry["case"]!) \(entry["rule"]!) day \(entry["day"]!) \(entry["time"]!)"
            try test(name) {
                let shows = rule(entry["rule"])!.shows(day: entry["day"] as! Int, minute: minute(entry["time"] as! String))
                try equal(shows, entry["visible"] as! Bool, name)
            }
        }

        // MARK: S64: the wall clock, apart from the 4 a.m. day

        for entry in cases["instants"] as! [[String: Any]] {
            let date = at(entry["at"] as! String)
            try test("S64 \(entry["at"]!)") {
                let moment = SpaceDevice.moment(date, calendar: calendar)
                try equal(moment.day, entry["day"] as! Int, "day")
                try equal(SpaceDevice.clockText(moment.minute), entry["time"] as! String, "time")
                try equal(Archive.dayKey(date, calendar: calendar), entry["logicalDay"] as! String, "logical day")
                for (name, expected) in entry["visible"] as! [String: Bool] {
                    try equal(SpaceDevice.shows(rule(name), at: date, calendar: calendar), expected, name)
                }
            }
        }

        // MARK: S65: reading the setting

        for (index, entry) in (cases["read"] as! [[String: Any]]).enumerated() {
            try test("S65 \(index) \(entry["note"] ?? "")") {
                let read = SpaceDevice.read(entry["value"])
                try equal(read, SpaceDevice.read(entry["expect"]), "read")
                try equal(read.count, (entry["expect"] as! [String: Any]).count, "entries")
                // Written and read again: the same.
                try equal(SpaceDevice.decode(SpaceDevice.encode(read)), read, "round trip")
                let plain = try JSONSerialization.jsonObject(with: SpaceDevice.encode(read)) as! NSDictionary
                try expect(plain.isEqual(to: entry["expect"] as! [String: Any]), "written \(plain)")
            }
        }

        // MARK: S66: what is hidden now

        for (index, entry) in (cases["hidden"] as! [[String: Any]]).enumerated() {
            try test("S66 hidden \(index) \(entry["note"] ?? "")") {
                let rules = (entry["rules"] as! [String: String]).compactMapValues { rule($0) }
                let hidden = SpaceDevice.hidden(rules, spaces: entry["noSpaces"] as? Bool == true ? noSpaces : spaces,
                                                at: at(entry["at"] as! String), calendar: calendar)
                try equal(hidden.sorted(), entry["expect"] as! [String], "hidden")
            }
        }
        for (index, entry) in (cases["places"] as! [[String: Any]]).enumerated() {
            try test("S66 place \(index) \(entry["note"] ?? "")") {
                let rules = (entry["rules"] as! [String: String]).compactMapValues { rule($0) }
                let hidden = SpaceDevice.hidden(rules, spaces: spaces, at: someday, calendar: calendar)
                try equal(SpaceDevice.isHidden(entry["space"] as? String, in: hidden, spaces: spaces), entry["hidden"] as! Bool, "hidden")
            }
        }

        // MARK: S67: the sheet, every space hidden, peeking

        let todos = (cases["todos"] as! [[String: Any]]).map { (space: $0["space"] as? String, done: $0["done"] as! Bool) }
        for entry in cases["sheet"] as! [[String: Any]] {
            try test("S67 \(entry["note"]!)") {
                let hidden = SpaceDevice.hidden(hideRules(entry["hide"]), spaces: spaces, at: someday, calendar: calendar)
                let peek = Set((entry["peek"] as? [String]) ?? []).intersection(hidden)
                let onNote = hidden.subtracting(peek)
                let shown = todos.filter { !SpaceDevice.isHidden($0.space, in: onNote, spaces: spaces) }
                try equal(shown.count, entry["shown"] as! Int, "shown")
                let open = todos.filter { !$0.done }.map { SpaceDevice.key(spaces.space($0.space)?.id) }
                try equal(SpaceDevice.lineKeys(open: open, among: onNote, spaces: spaces), entry["line"] as! [String], "line")
                try equal(SpaceDevice.lineKeys(open: open, among: peek, spaces: spaces), (entry["peeking"] as? [String]) ?? [], "peeking")
            }
        }

        // MARK: S68: the lens and the digits

        for entry in cases["lens"] as! [[String: Any]] {
            try test("S68 \(entry["note"]!)") {
                let hidden = SpaceDevice.hidden(hideRules(entry["hide"]), spaces: spaces, at: someday, calendar: calendar)
                let onNote = hidden.subtracting((entry["peek"] as? [String]) ?? [])
                let picked: SpaceLens.Shown = (entry["lens"] as! String) == SpaceLens.none ? .noSpace : .space(entry["lens"] as! String)
                let shown = SpaceDevice.lens(picked, hidden: onNote)
                try equal(shown.lensID, entry["expect"] as? String, "lens")
                let more = shown == .all ? 0 : todos.filter {
                    !$0.done && !SpaceDevice.isHidden($0.space, in: onNote, spaces: spaces) && !shown.includes(spaces.space($0.space)?.id)
                }.count
                try equal(more, entry["more"] as! Int, "more")
            }
        }
        for entry in cases["digits"] as! [[String: Any]] {
            try test("S68 digit \(entry["digit"]!)") {
                let hidden = SpaceDevice.hidden(hideRules(entry["hide"]), spaces: spaces, at: someday, calendar: calendar)
                let shown = SpaceDevice.forDigit(entry["digit"] as! Int, spaces: spaces, hidden: hidden)
                let said = shown.map { $0 == .all ? "all" : $0.lensID! } ?? "nothing"
                try equal(said, entry["expect"] as! String, "digit")
            }
        }

        // MARK: S69: reminders

        for entry in cases["reminders"] as! [[String: Any]] {
            try test("S69 \(entry["note"] ?? entry["rule"] ?? "")") {
                let rings = SpaceDevice.rings(rule(entry["rule"]), alert: at(entry["alert"] as! String), now: at(entry["now"] as! String),
                                              shownSince: (entry["shownSince"] as? String).map(at), calendar: calendar)
                try equal(rings, entry["rings"] as! Bool, "rings")
            }
        }

        // MARK: S70–S71: words

        let languages: [String: AppLanguage] = ["ko": .ko, "en": .en, "nl": .nl]
        for entry in cases["summary"] as! [[String: Any]] {
            let language = languages[entry["lang"] as! String]!
            try test("S70 \(entry["rule"]!) \(entry["lang"]!)") {
                guard case .times(let times) = rule(entry["rule"])! else { throw TestFailure(description: "not a time rule") }
                try equal(SpaceDevice.summary(times, language), entry["full"] as! String, "full")
                try equal(SpaceDevice.summary(times, language, short: true), entry["short"] as! String, "short")
                try equal(SpaceDevice.fitting(times, language), entry["fits"] as! String, "fits")
                try equal(SpaceDevice.sentence(times, language), entry["sentence"] as! String, "sentence")
                try equal(SpaceDevice.hint(times, hiddenNow: true, language), entry["hintHidden"] as! String, "hint hidden")
                try equal(SpaceDevice.hint(times, hiddenNow: false, language), entry["hintShown"] as! String, "hint shown")
                try equal(SpaceDevice.status(.times(times), hiddenNow: false, language), entry["statusShown"] as? String, "status shown")
                try equal(SpaceDevice.status(.times(times), hiddenNow: true, language), entry["statusHidden"] as? String, "status hidden")
            }
        }
        for entry in cases["days"] as! [[String: Any]] {
            try test("S70 days \(entry["days"] as! [Int])") {
                for (code, language) in languages {
                    try equal(SpaceDevice.dayWords(entry["days"] as! [Int], language), entry[code] as! String, code)
                }
            }
        }
        for entry in cases["groupsOrder"] as! [[String: Any]] {
            try test("S70 \(entry["note"]!)") {
                guard case .times(let times) = SpaceDevice.read(["x": ["show": "time", "times": entry["times"]!]])["x"]! else { return }
                try equal(SpaceDevice.summary(times, .ko), entry["ko"] as! String, "ko")
            }
        }
        for entry in cases["words"] as! [[String: Any]] {
            let language = languages[entry["lang"] as! String]!
            let names = entry["names"] as! [String]
            try test("S71 \(entry["lang"]!) \(names)") {
                try equal(SpaceDevice.line(names, language), entry["line"] as! String, "line")
                try equal(SpaceDevice.peekWord(language), entry["peek"] as! String, "peek")
                try equal(SpaceDevice.peeking(names, language), entry["peeking"] as! String, "peeking")
                try equal(SpaceDevice.hideAgainWord(language), entry["hideAgain"] as! String, "hide again")
            }
        }
        for entry in cases["toasts"] as! [[String: Any]] {
            try test("S71 toast \(entry["lang"]!) \(entry["name"]!)") {
                try equal(SpaceDevice.added(to: entry["name"] as! String, languages[entry["lang"] as! String]!), entry["toast"] as! String, "toast")
            }
        }

        // MARK: S72, the presets

        let clean = cases["clean"] as! [String: Any]
        try test("S72 \(clean["note"]!)") {
            let rules = (clean["rules"] as! [String: String]).compactMapValues { rule($0) }
            try equal(SpaceDevice.cleaned(rules, spaces: spaces).keys.sorted(), clean["expect"] as! [String], "kept")
        }
        for entry in cases["presets"] as! [[String: Any]] {
            try test("preset \(entry["id"]!)") {
                let preset = SpaceDevice.Preset(rawValue: entry["id"] as! String)!
                try equal(preset.times, { guard case .times(let t) = SpaceDevice.read(["x": ["show": "time", "times": entry["times"]!]])["x"]! else { return [] }; return t }(), "times")
                for (code, language) in languages { try equal(preset.title(language), entry[code] as! String, code) }
            }
        }

        // MARK: S73 (#121 N3-9): what ai-link.json carries for Claude — the `aiDevice` block, read by the Windows app and
        // the extension too.

        let aiDevice = all["aiDevice"] as! [String: Any]
        try test("S73 ai-link.json carries this Mac's 이 기기에서 as stored, none when nothing is set") {
            let expected = (aiDevice["link"] as! [String: Any])
            let rules = SpaceDevice.read(aiDevice["rules"])
            let link = AIConnect.Link(enabled: true, dataFolder: "/x", lang: .ko, app: "mac 1.48.0", spaceDevice: SpaceDevice.linkRules(rules))
            let written = try JSONSerialization.jsonObject(with: link.encoded()) as! [String: Any]
            try equal(written["ext"] as? Int, expected["ext"] as? Int, "ext")
            try equal(json(written["spaceDevice"]!, sorted: true), json(expected["spaceDevice"]!, sorted: true), "spaceDevice")
            let none = try JSONSerialization.jsonObject(with: AIConnect.Link(enabled: true, dataFolder: "/x", lang: .ko, app: "mac 1.48.0").encoded()) as! [String: Any]
            try expect(none["spaceDevice"] == nil, "no key without a setting: \(none)")
            let decoded = try JSONDecoder().decode(AIConnect.Link.self, from: link.encoded())
            try equal(decoded.spaceDevice, SpaceDevice.linkRules(rules), "reads back")
        }

        // MARK: The Mac's own

        try test("a time crossing midnight and the whole day say so") {
            let night = SpaceDevice.Times(days: [5], from: 1320, to: 360)
            try expect(night.crossesMidnight && !night.wholeDay, "night")
            try expect(SpaceDevice.Times(days: [6], from: 0, to: 0).wholeDay, "whole day")
            try equal(SpaceDevice.Times(days: [7, 0, 3, 3, 9], from: 0, to: 60).days, [3, 7], "days cleaned")
        }
        try test("the slip's now line") {
            try equal(SpaceDevice.nowLine(showing: false, at: at("2026-11-03T11:10:00Z"), .ko, calendar: calendar), "지금(화 20:10)은 숨어 있어요", "ko hidden")
            try equal(SpaceDevice.nowLine(showing: true, at: at("2026-11-03T11:10:00Z"), .ko, calendar: calendar), "지금(화 20:10) 보여요", "ko shown")
            try equal(SpaceDevice.nowLine(showing: true, at: at("2026-11-03T11:10:00Z"), .en, calendar: calendar), "Showing now (Tue 8:10 PM)", "en")
        }
        try test("the desk line for 숨기기 and none for 보이기") {
            try equal(SpaceDevice.status(.hide, hiddenNow: true, .ko), "이 기기에서 숨겨 뒀어요", "hide")
            try equal(SpaceDevice.status(nil, hiddenNow: false, .ko), nil, "show")
        }
        try test("the lens with nothing hidden stays") {
            try equal(SpaceDevice.lens(.space("s-a"), hidden: []), .space("s-a"), "lens")
            try equal(SpaceDevice.isHidden("s-a", in: [], spaces: spaces), false, "nothing hidden")
        }

        print("\(count) passed")
    }
}
