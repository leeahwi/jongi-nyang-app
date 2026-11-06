import CoreGraphics
import Foundation

// 치면 두드리는 고양이 (#230, TypingCat.swift): the shared cases from docs/plans/typing-cat-cases.json (the Windows app's
// test/typingCat.test.ts reads the same file), and a privacy check — the rules and the key watcher keep nothing of a key.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    try expect(actual == expected, "\(name): expected \(expected), got \(actual)")
}

/// The app's way of using the rules: one timer at most, woken at its deadline and set again when a newer key moved it.
private struct Clock {
    var cat = TypingCat()
    var timer: Double?
    var wakes = 0

    mutating func advance(to now: Double) {
        while let due = timer, due <= now + 1e-9 {
            timer = nil
            wakes += 1
            if let next = cat.wake(at: due) { timer = next }
        }
    }

    mutating func key(at now: Double, reduceMotion: Bool) {
        advance(to: now)
        if let due = cat.key(at: now, reduceMotion: reduceMotion), timer == nil { timer = due }
    }

    mutating func stop() {
        cat.stop()
        timer = nil
    }
}

@main
private enum TypingCatTests {
    static func main() throws {
        let arguments = CommandLine.arguments.dropFirst()
        let path = arguments.first ?? "../docs/plans/typing-cat-cases.json"
        let watcher = arguments.dropFirst().first ?? "Sources/PaperTodo/TypingKeys.swift"
        let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }

        try test("the numbers") {
            try equal(Int((TypingCat.hold * 1000).rounded()), file["holdMs"] as! Int, "hold")
            try equal(Int((TypingCat.linger * 1000).rounded()), file["lingerMs"] as! Int, "linger")
            try equal(Int((TypingCat.chatterQuiet * 1000).rounded()), file["chatterQuietMs"] as! Int, "chatter")
        }

        for entry in file["paws"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                var steps = entry["steps"] as! [[String: Any]]
                if let burst = entry["burst"] as? [String: Int] {
                    let keys = (0..<burst["count"]!).map { ["at": burst["from"]! + $0 * burst["every"]!, "key": true] as [String: Any] }
                    // Keys first at the same time, then the checks, each in its own order.
                    steps = (keys.map { (0, $0) } + steps.map { (1, $0) }).enumerated()
                        .sorted { ($0.element.1["at"] as! Int, $0.element.0, $0.offset) < ($1.element.1["at"] as! Int, $1.element.0, $1.offset) }
                        .map(\.element.1)
                }
                var clock = Clock()
                for step in steps {
                    let at = Double(step["at"] as! Int) / 1000
                    if step["key"] != nil {
                        clock.key(at: at, reduceMotion: step["reduceMotion"] as? Bool ?? false)
                    } else if step["stop"] != nil {
                        clock.advance(to: at)
                        clock.stop()
                    } else {
                        clock.advance(to: at)
                        let when = "at \(step["at"]!) ms"
                        if let pose = step["pose"] as? String { try equal(clock.cat.pose.rawValue, pose, "\(when) pose") }
                        if let next = step["next"] as? String { try equal(clock.cat.nextPaw.rawValue, next, "\(when) next paw") }
                        if let timer = step["timer"] as? Bool {
                            try equal(clock.timer != nil, timer, "\(when) a timer waits")
                            try equal(clock.cat.returnAt != nil, timer, "\(when) a return waits")
                        }
                    }
                }
            }
        }

        try test("T5 a burst wakes the one timer only a few times (no clip per key)") {
            var clock = Clock()
            for index in 0..<40 { clock.key(at: Double(index) * 0.01, reduceMotion: false) }
            clock.advance(to: 10)
            try expect(clock.wakes <= 5, "wakes: \(clock.wakes)")
            try equal(clock.timer == nil, true, "no timer")
        }

        try test("a stale wake (the timer of an older key) leaves the newer paw down") {
            var cat = TypingCat()
            cat.key(at: 0, reduceMotion: false)
            cat.key(at: 0.1, reduceMotion: false)
            try equal(cat.wake(at: 0.12), 0.22, "wake again at")
            try equal(cat.pose, .right, "pose")
            try equal(cat.wake(at: 0.22), nil, "done")
            try equal(cat.pose, .idle, "pose")
        }

        for entry in file["counts"] as! [[String: Any]] {
            try test("counts: \(entry["case"]!)") {
                try equal(TypingCat.counts(isRepeat: entry["repeat"] as! Bool, command: entry["command"] as! Bool, control: entry["control"] as! Bool),
                          entry["counts"] as! Bool, "counts")
            }
        }
        for entry in file["priorities"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                try equal(TypingCat.reply(to: TypingCat.Doing(rawValue: entry["doing"] as! String)!).rawValue, entry["reply"] as! String, "reply")
            }
        }
        try test("every pet moment has a case") {
            let listed = Set((file["priorities"] as! [[String: Any]]).map { $0["doing"] as! String })
            try equal(listed, Set(TypingCat.Doing.allCases.map(\.rawValue)), "moments")
        }
        for entry in file["linger"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                var cat = TypingCat()
                if let last = entry["lastKey"] as? Int { cat.key(at: Double(last) / 1000, reduceMotion: false) }
                try equal(cat.typed(within: TypingCat.linger, of: Double(entry["now"] as! Int) / 1000), entry["within"] as! Bool, "within")
            }
        }
        for entry in file["chatter"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                var cat = TypingCat()
                cat.key(at: Double(entry["lastKey"] as! Int) / 1000, reduceMotion: false)
                try equal(cat.typed(within: TypingCat.chatterQuiet, of: Double(entry["now"] as! Int) / 1000), entry["quiet"] as! Bool, "quiet")
            }
        }

        let mac = file["mac"] as! [String: Any]
        for entry in mac["sources"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let source = TypingSource.of(scope: TypingCat.Scope(rawValue: entry["scope"] as! String)!, granted: entry["granted"] as! Bool,
                                             petShown: entry["petShown"] as! Bool)
                try equal(source.rawValue, entry["source"] as! String, "source")
            }
        }
        for entry in mac["asking"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let scope = TypingCat.Scope(rawValue: entry["scope"] as! String)!
                let granted = entry["granted"] as! Bool, asked = entry["asked"] as! Bool
                try equal(TypingSource.shouldAsk(scope: scope, granted: granted, askedThisBuild: asked, chosenNow: entry["chosenNow"] as! Bool),
                          entry["ask"] as! Bool, "ask")
                try equal(TypingSource.showsNoPermission(scope: scope, granted: granted), entry["note"] as! Bool, "note")
            }
        }
        for entry in mac["companion"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                try equal(TypingCompanion.shows(source: TypingSource(rawValue: entry["source"] as! String)!, enabled: entry["enabled"] as! Bool,
                                                petShown: entry["petShown"] as! Bool, dockCovered: entry["dockCovered"] as! Bool,
                                                locked: entry["locked"] as! Bool), entry["shows"] as! Bool, "shows")
            }
        }
        for entry in mac["frames"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let s = (entry["screen"] as! [Double]).map { CGFloat($0) }, f = (entry["frame"] as! [Double]).map { CGFloat($0) }
                let screen = CGRect(x: s[0], y: s[1], width: s[2], height: s[3])
                let frame = TypingCompanion.frame(corner: TypingCompanion.Corner(rawValue: entry["corner"] as! String)!, screen: screen,
                                                  topInset: CGFloat(entry["topInset"] as! Double))
                try equal(frame, CGRect(x: f[0], y: f[1], width: f[2], height: f[3]), "frame")
                try expect(screen.contains(frame), "inside the screen")
            }
        }
        try test("G every corner of every screen stays inside it") {
            for screen in [CGRect(x: 0, y: 0, width: 1440, height: 900), CGRect(x: 2560, y: -400, width: 1080, height: 1920), CGRect(x: 0, y: 0, width: 800, height: 600)] {
                for corner in TypingCompanion.Corner.allCases {
                    for inset: CGFloat in [0, 24, 38] {
                        try expect(screen.contains(TypingCompanion.frame(corner: corner, screen: screen, topInset: inset)), "\(corner) in \(screen)")
                    }
                }
            }
        }
        try test("settings: unknown or missing values read as the defaults") {
            try equal(TypingCat.Scope(saved: nil), .app, "scope")
            try equal(TypingCat.Scope(saved: "loud"), .app, "scope")
            try equal(TypingCat.Scope(saved: "everywhere"), .everywhere, "scope")
            try equal(TypingCompanion.Corner(saved: nil), .bottomRight, "corner")
            try equal(TypingCompanion.Corner(saved: "middle"), .bottomRight, "corner")
        }

        // Privacy: the rules hold two poses, a deadline and a time — no text, no key code, nothing else.
        try test("privacy: the rules keep only poses and times") {
            var cat = TypingCat()
            for index in 0..<30 { cat.key(at: Double(index) * 0.05, reduceMotion: false) }
            let fields = Mirror(reflecting: cat).children.map { ($0.label ?? "?", String(describing: type(of: $0.value))) }
            try equal(fields.map(\.0), ["pose", "nextPaw", "returnAt", "lastKey"], "fields")
            for (label, kind) in fields {
                try expect(["Pose", "Optional<Double>"].contains(kind), "\(label) is \(kind)")
            }
            try expect(MemoryLayout<TypingCat>.size <= 40, "size \(MemoryLayout<TypingCat>.size)")
        }
        try test("privacy: the key watcher reads no key, no text, no clipboard and writes no log") {
            let source = try String(contentsOf: URL(fileURLWithPath: watcher), encoding: .utf8)
            // The comments may say what isn't read; the code may not touch it.
            let code = source.split(separator: "\n").map { line -> Substring in
                guard let comment = line.range(of: "//") else { return line }
                return line[..<comment.lowerBound]
            }.joined(separator: "\n")
            for name in ["characters", "keyCode", "keyboardEventKeycode", "keyboardEventUnicode", "keyboardGetUnicodeString", "specialKey",
                         "NSPasteboard", "NSTextInputContext", "markedText", "PerfProbe", "print(", "NSLog", "os_log", "Logger", "FileHandle",
                         "write(", "UserDefaults", "URLSession", "timestamp"] {
                try expect(!code.contains(name), "TypingKeys.swift uses \(name)")
            }
            try expect(code.contains("TypingCat.counts("), "the watcher asks TypingCat.counts")
            try expect(code.contains(".listenOnly"), "the tap only listens")
            try expect(code.contains("return event") && code.contains("passUnretained(event)"), "events pass through unchanged")
        }
        print("\(count) typing-cat checks passed")
    }
}
