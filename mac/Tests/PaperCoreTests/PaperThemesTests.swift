import Foundation

// 종이 테마 열다섯 가지 (#244, PaperKind.swift · PaperLook.swift): the shared cases from docs/plans/paper-themes-cases.json
// (the Windows app's test/paper.test.ts reads the same file) — the papers and their names, the paper drawn and the system
// controls' lightness (R), the drawer (D), 1.47's settings moved (M), what is saved read back (S), the widget's paper (W1)
// and the tiles' order and spoken names (K). The colours are checked by scripts/check-contrast.py against tokens.json.
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
private enum PaperThemesTests {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "../docs/plans/paper-themes-cases.json"
        let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        let tokensPath = URL(fileURLWithPath: path).deletingLastPathComponent().appendingPathComponent("paper-themes/tokens.json")
        let tokens = try JSONSerialization.jsonObject(with: Data(contentsOf: tokensPath)) as! [String: Any]
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        func paper(_ value: Any?) -> PaperKind { PaperKind(rawValue: value as! String)! }
        func night(_ value: Any?) -> NightChoice { NightChoice(rawValue: value as! String)! }

        // MARK: The papers
        let papers = file["papers"] as! [String: Any]
        try test("the fifteen papers in the tiles' order") {
            try equal(PaperKind.allCases.map(\.rawValue), papers["order"] as! [String], "order")
            try equal(PaperKind.dark.map(\.rawValue), papers["dark"] as! [String], "dark papers")
            try equal(NightChoice.allCases.map(\.rawValue), papers["nightChoices"] as! [String], "밤에는")
            try equal(PaperKind.light.count, 11, "light papers")
        }
        for (key, value) in papers["names"] as! [String: [String: String]] {
            try test("names: \(key)") {
                let names = PaperKind(rawValue: key)!.names
                try equal([names.ko, names.short, names.en, names.nl], [value["ko"]!, value["short"]!, value["en"]!, value["nl"]!], key)
            }
        }
        // Every paper's names, lightness, ruling and grain as tokens.json has them (the shared colour source).
        for entry in tokens["papers"] as! [[String: Any]] {
            let kind = PaperKind(rawValue: entry["key"] as! String)!
            try test("tokens.json: \(kind.rawValue)") {
                let names = entry["names"] as! [String: String]
                try equal([kind.names.ko, kind.names.short, kind.names.en, kind.names.nl], [names["ko"]!, names["short"]!, names["en"]!, names["nl"]!], "names")
                try equal(kind.scheme.rawValue, entry["scheme"] as! String, "scheme")
                try equal(kind.ruling.rawValue, entry["ruling"] as! String, "ruling")
                try equal(kind.grain, entry["grain"] as! Double, "grain")
                try equal(kind.isNew, entry["new"] as! Bool, "new")
            }
        }
        try test("tokens.json lists the fifteen in order") {
            try equal((tokens["papers"] as! [[String: Any]]).map { $0["key"] as! String }, PaperKind.allCases.map(\.rawValue), "order")
        }

        // MARK: R · the paper drawn
        for entry in file["shown"] as! [[String: Any]] {
            try test("\(entry["case"]!)") {
                let look = PaperLook(dayNight: PaperLook.DayNight(rawValue: entry["dayNight"] as! String)!, paper: paper(entry["paper"]), night: night(entry["night"]))
                let shown = look.shown(systemDark: entry["systemDark"] as! Bool)
                try equal(shown.rawValue, entry["shown"] as! String, "shown")
                try equal(shown.scheme.rawValue, entry["scheme"] as! String, "scheme")
                try equal(look.appearance.rawValue, entry["appearance"] as! String, "appearance")
            }
        }
        try test("R the system controls always match the paper drawn") {
            for dayNight in PaperLook.DayNight.allCases {
                for kind in PaperKind.allCases {
                    for choice in NightChoice.allCases {
                        let look = PaperLook(dayNight: dayNight, paper: kind, night: choice)
                        for systemDark in [false, true] {
                            let dark: Bool = switch look.appearance {
                            case .system: systemDark
                            case .light: false
                            case .dark: true
                            }
                            try equal(dark, look.shown(systemDark: systemDark).isDark, "\(dayNight) \(kind) \(choice) \(systemDark)")
                        }
                    }
                }
            }
        }

        // MARK: D · the drawer
        for entry in file["drawer"] as! [[String: Any]] {
            try test("\(entry["case"]!)") {
                let note = entry["note"] as? [String: String]
                let look = PaperLook(dayNight: .auto, paper: note.map { paper($0["paper"]) } ?? .day, night: note.map { night($0["night"]) } ?? .night)
                let drawer = PaperLook.Drawer(sameAsNote: entry["sameAsNote"] as! Bool,
                                              paper: (entry["drawerPaper"] as? String).map { paper($0) } ?? .day,
                                              night: (entry["drawerNight"] as? String).map { night($0) } ?? .night)
                try equal(look.drawerShown(drawer, systemDark: entry["systemDark"] as! Bool).rawValue, entry["shown"] as! String, "shown")
            }
        }

        // MARK: M · moving 1.47's settings
        for entry in file["migrate"] as! [[String: Any]] {
            try test("\(entry["case"]!)") {
                if let old = entry["old"] as? [String: Any], let new = entry["new"] as? [String: Any] {
                    // The note's settings: absent in 1.47, so 낮 종이 + 밤 종이; 낮 · 밤 read as it was.
                    let look = PaperLook(dayNight: PaperLook.readDayNight(old["paper.color"]), paper: PaperLook.readPaper(old["paper.theme"]),
                                         night: PaperLook.readNight(old["paper.night"]))
                    let drawer = PaperLook.readDrawer(sameAsNote: nil, theme: old["drawer.theme"] as? String, nightPaper: old["drawer.nightPaper"] as? Bool, night: nil)
                    if let value = new["paper.color"] as? String { try equal(look.dayNight.rawValue, value, "paper.color") }
                    if let value = new["paper.theme"] as? String { try equal(look.paper.rawValue, value, "paper.theme") }
                    if let value = new["paper.night"] as? String { try equal(look.night.rawValue, value, "paper.night") }
                    if let value = new["drawer.sameAsNote"] as? Bool { try equal(drawer.sameAsNote, value, "drawer.sameAsNote") }
                    if let value = new["drawer.theme"] as? String { try equal(drawer.paper.rawValue, value, "drawer.theme") }
                    if let value = new["drawer.night"] as? String { try equal(drawer.night.rawValue, value, "drawer.night") }
                    // Nothing on screen changes: the drawer drawn by day and at night is 1.47's.
                    let old47 = PaperLook.drawerPaper(theme: old["drawer.theme"] as? String, nightPaper: old["drawer.nightPaper"] as? Bool)
                    for systemDark in [false, true] {
                        try equal(look.drawerShown(drawer, systemDark: systemDark).rawValue,
                                  PaperLook.drawerShownPaper(paper: old47.paper, nightPaper: old47.nightPaper, night: look.isNight(systemDark: systemDark)),
                                  "the drawer drawn as in 1.47 (night \(systemDark))")
                    }
                }
                if let write = entry["write"] as? [String: Any], let stored = entry["stored"] as? [String: Any] {
                    let drawer = PaperLook.Drawer(sameAsNote: write["drawer.sameAsNote"] as! Bool, paper: paper(write["drawer.theme"]), night: night(write["drawer.night"]))
                    let written = PaperLook.storedDrawer(drawer)
                    try equal(written.theme, stored["drawer.theme"] as! String, "drawer.theme")
                    try equal(written.nightPaper, stored["drawer.nightPaper"] as! Bool, "drawer.nightPaper")
                    // And 1.48 reads it back as written.
                    try equal(PaperLook.readDrawer(sameAsNote: drawer.sameAsNote, theme: written.theme, nightPaper: written.nightPaper, night: drawer.night.rawValue), drawer, "read back")
                }
            }
        }
        try test("M every drawer setting written to the old keys reads back the same") {
            for kind in PaperKind.allCases {
                for choice in NightChoice.allCases {
                    for same in [false, true] {
                        let drawer = PaperLook.Drawer(sameAsNote: same, paper: kind, night: choice)
                        let written = PaperLook.storedDrawer(drawer)
                        try equal(PaperLook.readDrawer(sameAsNote: same, theme: written.theme, nightPaper: written.nightPaper, night: choice.rawValue), drawer, "\(kind) \(choice)")
                    }
                }
            }
        }

        try test("M 1.47 turning 밤에는 밤 종이로 on or off after 1.48 ran wins over drawer.night") {
            try equal(PaperLook.readDrawer(sameAsNote: false, theme: "kraft", nightPaper: true, night: "keep").night, .night, "on in 1.47")
            try equal(PaperLook.readDrawer(sameAsNote: false, theme: "kraft", nightPaper: false, night: "night").night, .keep, "off in 1.47")
            try equal(PaperLook.readDrawer(sameAsNote: false, theme: "kraft", nightPaper: false, night: "chalk").night, .chalk, "칠판 stays")
            try equal(PaperLook.readDrawer(sameAsNote: false, theme: "auto", nightPaper: true, night: "chalk").night, .night, "1.47's 자동")
        }

        // MARK: S · reading what is saved
        for entry in file["read"] as! [[String: Any]] {
            try test("\(entry["case"]!)") {
                let stored = entry["stored"] as! [String: Any]
                if let expected = entry["paper"] as? String {
                    try equal(PaperLook.readPaper(stored["paper.theme"] ?? stored["paperTheme"]).rawValue, expected, "paper")
                }
                if let expected = entry["night"] as? String {
                    try equal(PaperLook.readNight(stored["paper.night"]).rawValue, expected, "night")
                }
            }
        }

        // MARK: W · the widget follows the paper drawn
        for entry in (file["widget"] as! [[String: Any]]) where entry["note"] != nil {
            try test("\(entry["case"]!)") {
                let note = entry["note"] as! [String: String]
                let look = PaperLook(paper: paper(note["paper"]), night: night(note["night"]))
                try equal(look.shown(systemDark: entry["systemDark"] as! Bool).rawValue, entry["widget"] as! String, "widget")
            }
        }

        // MARK: K · the tiles
        for entry in file["keyboard"] as! [[String: Any]] {
            try test("\(entry["case"]!)") {
                if let from = entry["from"] as? String {
                    let by = ["ArrowRight": 1, "ArrowDown": 1, "ArrowLeft": -1, "ArrowUp": -1][entry["key"] as! String]!
                    try equal(PaperKind(rawValue: from)!.step(by).rawValue, entry["to"] as! String, "next")
                }
                if let labels = entry["label"] as? [String: String] {
                    let kind = paper(entry["paper"])
                    for language in AppLanguage.allCases {
                        try equal(kind.spokenLabel(language), labels[language.rawValue]!, language.rawValue)
                    }
                }
                if let enabled = entry["nightRowEnabled"] as? Bool {
                    try equal(PaperLook(paper: paper(entry["paper"])).nightChoiceEnabled, enabled, "밤에는 enabled")
                }
            }
        }
        try test("K the arrows go round all fifteen and back") {
            var at = PaperKind.day
            for _ in PaperKind.allCases { at = at.step(1) }
            try equal(at, .day, "right fifteen times")
            try equal(PaperKind.day.step(-1), .chalk, "left from the first")
        }

        print("\(count) paper theme checks passed")
    }
}
