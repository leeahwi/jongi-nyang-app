import Foundation

// 음력과 공휴일 (#234, KoreanCalendar): the shared cases from docs/plans/calendar-korean-cases.json (the Windows app's
// test/koreanCalendar.test.ts reads the same file) — lunar dates on 설날 · 추석 · 윤달 · year ends, every day of 2020–2035
// as one digest (the two apps' calendars must agree on each), the cell's lunar label, and every holiday of 2024–2030.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    if actual != expected { throw TestFailure(description: "\(name): expected \(expected), got \(actual)") }
}

@main
private enum KoreanCalendarTests {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "../docs/plans/calendar-korean-cases.json"
        let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            do { try action() } catch { throw TestFailure(description: "\(name) — \(error)") }
            count += 1
            print("PASS \(name)")
        }
        func text(_ lunar: KoreanCalendar.Lunar) -> String { "\(lunar.month)\(lunar.leap ? "L" : "").\(lunar.day)" }

        try test("lunar dates on 설날, 추석, the 윤달 and year ends") {
            for pair in file["lunar"] as! [[String]] {
                try equal(KoreanCalendar.lunar(pair[0]).map(text) ?? "-", pair[1], pair[0])
            }
        }
        try test("every day of the range agrees (FNV-1a of the lines)") {
            let range = file["range"] as! [String: Any]
            var day = range["from"] as! String
            let last = range["to"] as! String
            var hash: UInt32 = 0x811c9dc5
            var days = 0
            while day <= last {
                let lunar = KoreanCalendar.lunar(day)!
                for byte in "\(day) \(lunar.month)\(lunar.leap ? "L" : "") \(lunar.day)\n".utf8 { hash = (hash ^ UInt32(byte)) &* 0x01000193 }
                days += 1
                day = KoreanCalendar.shift(day, 1)
            }
            try equal(days, range["days"] as! Int, "days")
            try equal(Int(hash), range["fnv1a32"] as! Int, "digest")
        }
        try test("the cell's lunar label and its spoken form") {
            for entry in file["labels"] as! [[String: Any]] {
                let lunar = KoreanCalendar.lunar(entry["day"] as! String)!
                let spoken = entry["spoken"] as! [String: String]
                for language in AppLanguage.allCases {
                    try equal(KoreanCalendar.lunarLabel(lunar, language: language), entry[language.rawValue] as! String, "label \(language)")
                    try equal(KoreanCalendar.lunarSpoken(lunar, language: language), spoken[language.rawValue]!, "spoken \(language)")
                }
            }
        }
        for (year, list) in (file["holidays"] as! [String: [[Any]]]).sorted(by: { $0.key < $1.key }) {
            try test("holidays of \(year)") {
                let found = KoreanCalendar.holidays(year: Int(year)!)
                let want = Dictionary(uniqueKeysWithValues: list.map { ($0[0] as! String, ($0[1] as! [String])) })
                try equal(Set(found.keys), Set(want.keys), "days")
                for (day, names) in want { try equal(found[day]!.map(\.rawValue), names, day) }
            }
        }
        try test("names in ko · en · nl, and a day's label") {
            for (key, words) in file["names"] as! [String: [String]] {
                let name = KoreanCalendar.Name(rawValue: key)!
                for (i, language) in AppLanguage.allCases.enumerated() { try equal(name.text(language), words[i], key) }
            }
            for row in file["labelsOn"] as! [[Any]] {
                try equal(KoreanCalendar.label(on: row[0] as! String), row[1] as? String, "ko \(row[0])")
                try equal(KoreanCalendar.label(on: row[0] as! String, language: .en), row[2] as? String, "en \(row[0])")
            }
        }
        print("\(count) korean calendar cases passed")
    }
}
