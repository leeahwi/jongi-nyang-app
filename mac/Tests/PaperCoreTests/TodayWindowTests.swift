import Foundation

// 오늘 창 (#200, TodayGlance): the shared cases from docs/plans/today-window-cases.json (the Windows app's
// test/todayWindow.test.ts reads the same file) — which cards stay full size and which become chips, how many to-do rows
// fit, 그 밖에's rows and 외 N개, the header's progress words and date, and the chips' words.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    if actual != expected { throw TestFailure(description: "\(name): expected \(expected), got \(actual)") }
}

@main
private enum TodayWindowTests {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "../docs/plans/today-window-cases.json"
        let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        let kinds = { (names: Any?) in (names as! [String]).map { TodayGlance.CardKind(rawValue: $0)! } }

        for entry in file["layout"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let layout = TodayGlance.layout(filled: Set(kinds(entry["filled"])))
                try equal(layout.cards, kinds(entry["cards"]), "cards")
                try equal(layout.chips, kinds(entry["chips"]), "chips")
                try equal(layout.wide, entry["wide"] as! Bool, "wide")
            }
        }
        for entry in file["rowCap"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                try equal(TodayGlance.rowCap(room: entry["room"] as? Double), entry["cap"] as! Int, "cap")
            }
        }
        for entry in file["slots"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let made = TodayGlance.slots(next: entry["next"] as! Int, others: entry["others"] as! Int, cap: entry["cap"] as! Int)
                try equal([made.rest, made.hidden], [entry["rest"] as! Int, entry["hidden"] as! Int], "rest, hidden")
            }
        }
        for entry in file["progress"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                for language in AppLanguage.allCases {
                    try equal(TodayGlance.progressText(total: entry["total"] as! Int, done: entry["done"] as! Int, language: language),
                              entry[language.rawValue] as? String, language.rawValue)
                }
            }
        }
        for entry in file["dates"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let at = entry["at"] as! [Int]
                let date = Calendar.paper.date(from: DateComponents(year: at[0], month: at[1], day: at[2], hour: at[3], minute: at[4]))!
                for language in AppLanguage.allCases {
                    try equal(TodayGlance.headerDate(date, language: language), entry[language.rawValue] as! String, language.rawValue)
                }
            }
        }
        try test("chips' words") {
            let chips = file["chips"] as! [String: [String: String]]
            for kind in TodayGlance.CardKind.allCases {
                for language in AppLanguage.allCases {
                    try equal(TodayGlance.chipText(kind, language: language), chips[kind.rawValue]![language.rawValue]!, "\(kind) \(language)")
                }
            }
        }
        print("\(count) today window checks passed")
    }
}
