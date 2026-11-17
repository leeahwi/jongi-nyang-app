import Foundation

// #528 (InputHistory): the shared cases from shared/cases/input-history-cases.json (the Windows app's
// test/inputHistory.test.ts reads the same file) — ↑ · ↓ bring back the lines put in before.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    if actual != expected { throw TestFailure(description: "\(name): expected \(expected), got \(actual)") }
}

@main
private enum InputHistoryTests {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "../shared/cases/input-history-cases.json"
        let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        try test("the limit") { try equal(InputHistory.limit, file["limit"] as! Int, "limit") }
        for entry in file["steps"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                var history = InputHistory(entries: entry["entries"] as! [String])
                for (number, key) in (entry["keys"] as! [[String: Any]]).enumerated() {
                    let result = history.step(up: key["key"] as! String == "up", text: key["text"] as! String)
                    try equal(result, key["result"] as? String, "key \(number + 1)")
                }
            }
        }
        for entry in file["add"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                var history = InputHistory(entries: entry["entries"] as! [String])
                history.add(entry["line"] as! String)
                try equal(history.entries, entry["added"] as! [String], "entries")
            }
        }
        try test("a long history keeps the newest \(InputHistory.limit)") {
            var history = InputHistory(entries: (1...60).map { "할 일 \($0)" })
            try equal(history.entries.count, InputHistory.limit, "from the file")
            history.add("새 줄")
            try equal(history.entries.count, InputHistory.limit, "after a line")
            try equal(history.entries.last, "새 줄", "newest")
            try equal(history.entries.first, "할 일 12", "oldest kept")
        }
        print("\(count) input history checks passed.")
    }
}
