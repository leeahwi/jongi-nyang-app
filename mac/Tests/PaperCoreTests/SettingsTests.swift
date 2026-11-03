import Foundation

// 글꼴 · 종이 설정 (#141 · #142, TextSteps.swift): the shared cases from docs/plans/settings-cases.json (the Windows app's
// test/textSteps.test.ts reads the same file) — the note's seven steps and the drawer's nine read from 1.45's names and
// written back as the nearest of them, the drawer's line, paragraph and preview sizes, where a paragraph ends, and the
// drawer's paper read from 1.45's ‘자동’ with 밤에는 밤 종이로 (#142).
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
private enum SettingsTests {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "../docs/plans/settings-cases.json"
        let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }

        try test("F1 the note's seven scales") {
            try equal(TextSteps.noteScales, file["noteScales"] as! [Double], "scales")
        }
        for entry in file["noteSteps"] as! [[String: Any]] {
            try test("\(entry["case"]!)") {
                try equal(TextSteps.noteStep(saved: entry["saved"] as? Int, legacy: entry["legacy"] as? String), entry["step"] as! Int, "step")
            }
        }
        try test("F1 a step written back as the nearest of 1.45's four") {
            try equal(TextSteps.noteScales.indices.map(TextSteps.noteLegacyName), file["noteLegacyNames"] as! [String], "names")
            for (name, step) in TextSteps.noteLegacy { try equal(TextSteps.noteLegacyName(step), name, "1.45's \(name) stays itself") }
        }
        for entry in file["drawerPoints"] as! [[String: Any]] {
            try test("\(entry["case"]!) (drawer)") {
                try equal(TextSteps.drawerPoint(saved: entry["saved"] as? Int, legacy: entry["legacy"] as? String), entry["points"] as! Int, "points")
            }
        }
        try test("F1 the drawer's points written back as the nearest of 1.45's four") {
            for (points, name) in file["drawerLegacyNames"] as! [String: String] {
                try equal(TextSteps.drawerLegacyName(Int(points)!), name, "\(points)")
            }
        }
        for entry in file["drawerMetrics"] as! [[String: Any]] {
            try test("\(entry["case"]!) (metrics)") {
                let line = TextSteps.LineSpacing(rawValue: entry["line"] as? String ?? "regular")!
                let paragraph = TextSteps.ParagraphSpacing(rawValue: entry["paragraph"] as? String ?? "regular")!
                let made = TextSteps.drawerMetrics(points: entry["points"] as! Int, line: line, paragraph: paragraph)
                let want = entry["expect"] as! [String: Int]
                try equal([made.body, made.line, made.paragraph, made.preview, made.previewLine],
                          [want["body"]!, want["line"]!, want["paragraph"]!, want["preview"]!, want["previewLine"]!], "metrics")
            }
        }
        for entry in file["paragraphs"] as! [[String: Any]] {
            try test("\(entry["case"]!)") {
                try equal(TextSteps.paragraphEnds(entry["text"] as! String), entry["ends"] as! [Bool], "ends")
            }
        }

        for entry in file["drawerPapers"] as! [[String: Any]] {
            try test("\(entry["case"]!)") {
                let picked = TextSteps.drawerPaper(theme: entry["theme"] as? String, nightPaper: entry["saved"] as? Bool)
                try equal([picked.paper, "\(picked.nightPaper)"], [entry["paper"] as! String, "\(entry["nightPaper"] as! Bool)"], "picked")
                try equal(TextSteps.drawerThemeValue(paper: picked.paper, nightPaper: picked.nightPaper), entry["writes"] as! String, "written")
                try equal([false, true].map { TextSteps.drawerShownPaper(paper: picked.paper, nightPaper: picked.nightPaper, night: $0) },
                          entry["shown"] as! [String], "shown by day, at night")
            }
        }

        print("\(count) settings checks passed")
    }
}
