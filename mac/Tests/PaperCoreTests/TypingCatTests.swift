import CoreGraphics
import Foundation

// 치면 두드리는 고양이 (#230 · #289, TypingCat.swift): the shared cases from docs/plans/typing-cat-cases.json (the Windows app's
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
        // #331: the place cases sit beside the others.
        let placesPath = URL(fileURLWithPath: path).deletingLastPathComponent().appendingPathComponent("typing-cat-place-cases.json").path
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
        for entry in file["chatter"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                var cat = TypingCat()
                cat.key(at: Double(entry["lastKey"] as! Int) / 1000, reduceMotion: false)
                try equal(cat.typed(within: TypingCat.chatterQuiet, of: Double(entry["now"] as! Int) / 1000), entry["quiet"] as! Bool, "quiet")
            }
        }
        // #289: the pet plays no part — `petShown` is in the cases to say so, and isn't asked.
        for entry in file["sources"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let source = TypingSource.of(scope: TypingCat.Scope(rawValue: entry["scope"] as! String)!, granted: entry["granted"] as! Bool,
                                             locked: entry["locked"] as! Bool)
                try equal(source.rawValue, entry["source"] as! String, "source")
            }
        }
        for entry in file["shows"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let last = (entry["lastKey"] as? Int).map { Double($0) / 1000 }
                try equal(TypingCorner.shows(source: TypingSource(rawValue: entry["source"] as! String)!, lastKey: last,
                                             now: Double(entry["now"] as! Int) / 1000, dragging: entry["dragging"] as? Bool ?? false,
                                             dropped: (entry["dropped"] as? Int).map { Double($0) / 1000 }), entry["shows"] as! Bool, "shows")
            }
        }
        let moving = file["moving"] as! [String: Any]
        for entry in moving["scope"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                try equal(TypingCat.Scope(saved: entry["now"] as? String, before: entry["before"] as? String).rawValue, entry["scope"] as! String, "scope")
            }
        }
        for entry in moving["corner"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                try equal(TypingCorner.Corner(saved: entry["now"] as? String, before: entry["before"] as? String).rawValue, entry["corner"] as! String, "corner")
            }
        }
        for entry in file["toggle"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let toggled = TypingCat.Scope.toggled(TypingCat.Scope(rawValue: entry["scope"] as! String)!,
                                                      last: (entry["last"] as? String).flatMap(TypingCat.Scope.init(rawValue:)))
                try equal(toggled.scope.rawValue, entry["scopeAfter"] as! String, "scope")
                if let last = entry["lastAfter"] as? String { try equal(toggled.last?.rawValue, last, "remembered") }
            }
        }

        let mac = file["mac"] as! [String: Any]
        for entry in mac["asking"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let scope = TypingCat.Scope(rawValue: entry["scope"] as! String)!
                let granted = entry["granted"] as! Bool, asked = entry["asked"] as! Bool
                try equal(TypingSource.shouldAsk(scope: scope, granted: granted, askedThisBuild: asked, chosenNow: entry["chosenNow"] as! Bool),
                          entry["ask"] as! Bool, "ask")
                try equal(TypingSource.showsNoPermission(scope: scope, granted: granted), entry["note"] as! Bool, "note")
            }
        }
        for entry in file["frames"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let s = (entry["screen"] as! [Double]).map { CGFloat($0) }, f = (entry["frame"] as! [Double]).map { CGFloat($0) }
                let screen = CGRect(x: s[0], y: s[1], width: s[2], height: s[3])
                let frame = TypingCorner.frame(corner: TypingCorner.Corner(rawValue: entry["corner"] as! String)!, screen: screen,
                                                  topInset: CGFloat(entry["topInset"] as! Double))
                try equal(frame, CGRect(x: f[0], y: f[1], width: f[2], height: f[3]), "frame")
                try expect(screen.contains(frame), "inside the screen")
            }
        }
        try test("G every corner of every screen stays inside it") {
            for screen in [CGRect(x: 0, y: 0, width: 1440, height: 900), CGRect(x: 2560, y: -400, width: 1080, height: 1920), CGRect(x: 0, y: 0, width: 800, height: 600)] {
                for corner in TypingCorner.Corner.allCases {
                    for inset: CGFloat in [0, 24, 38] {
                        try expect(screen.contains(TypingCorner.frame(corner: corner, screen: screen, topInset: inset)), "\(corner) in \(screen)")
                    }
                }
            }
        }
        try test("settings: unknown or missing values read as the defaults") {
            try equal(TypingCat.Scope(saved: nil), .app, "scope")
            try equal(TypingCat.Scope(saved: "loud"), .app, "scope")
            try equal(TypingCat.Scope(saved: "everywhere"), .everywhere, "scope")
            try equal(TypingCorner.Corner(saved: nil), .bottomRight, "corner")
            try equal(TypingCorner.Corner(saved: "middle"), .bottomRight, "corner")
            try equal(TypingCorner.size, 112, "size")
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
        try placeCases(placesPath, test)
        print("\(count) typing-cat checks passed")
    }

    /// #331 (docs/plans/typing-cat-place-cases.json): the drawn area, letting go, the kept place read back after a relaunch,
    /// a size change, a display change or one unplugged, and 자리 as chosen.
    static func placeCases(_ path: String, _ test: (String, () throws -> Void) throws -> Void) throws {
        let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        func rect(_ value: Any?) -> CGRect? {
            guard let parts = value as? [Double], parts.count == 4 else { return nil }
            return CGRect(x: parts[0], y: parts[1], width: parts[2], height: parts[3])
        }
        func near(_ actual: CGRect?, _ expected: CGRect?, _ name: String) throws {
            guard let actual, let expected else { return try expect(actual == nil && expected == nil, "\(name): expected \(String(describing: expected)), got \(String(describing: actual))") }
            let off = [actual.minX - expected.minX, actual.minY - expected.minY, actual.width - expected.width, actual.height - expected.height]
            try expect(off.allSatisfy { abs($0) < 1e-6 }, "\(name): expected \(expected), got \(actual)")
        }
        func samePlace(_ actual: TypingPlace?, _ expected: Any?, _ name: String) throws {
            guard let expected = expected as? [String: Any], let want = TypingPlace(saved: expected) else {
                return try expect(actual == nil, "\(name): expected nothing, got \(String(describing: actual))")
            }
            guard let actual else { throw TestFailure(description: "\(name): expected \(want), got nothing") }
            try equal(actual.screen, want.screen, "\(name) screen")
            for (a, b, part) in [(actual.x, want.x, "x"), (actual.y, want.y, "y"), (actual.centerX, want.centerX, "centerX"), (actual.centerY, want.centerY, "centerY")] {
                try expect(abs(a - b) < 1e-6, "\(name) \(part): expected \(b), got \(a)")
            }
        }
        func screens(_ value: Any?) -> [TypingCorner.Screen] {
            (value as! [[String: Any]]).map {
                TypingCorner.Screen(id: $0["id"] as! String, display: ScreenFit.Display(frame: rect($0["frame"])!, visible: rect($0["visible"])!))
            }
        }
        let drawn = file["drawn"] as! [String: Any]
        try test("D the drawn area is the app's") {
            let bands = (drawn["bands"] as! [Any]).map { ($0 as? [Double]).map { $0[0]...$0[1] } }
            try equal(bands, TypingCorner.drawn, "bands")
            let box = drawn["box"] as! [String: [Double]], frame = CGRect(x: 100, y: 200, width: 160, height: 160)
            let expected = CGRect(x: 100 + 160 * box["across"]![0], y: 200 + 160 * (1 - box["down"]![1]),
                                  width: 160 * (box["across"]![1] - box["across"]![0]), height: 160 * (box["down"]![1] - box["down"]![0]))
            try near(TypingCorner.catBox(in: frame), expected, "box")
        }
        for entry in drawn["hits"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let at = entry["at"] as! [Double], frame = CGRect(x: 100, y: 200, width: 160, height: 160)
                // [across, down] → the Mac's y-up point.
                let point = CGPoint(x: frame.minX + frame.width * at[0], y: frame.maxY - frame.height * at[1])
                try equal(TypingCorner.isOnCat(point, frame: frame), entry["on"] as! Bool, "on the cat")
            }
        }
        let all = screens(file["screens"])
        for entry in file["dropped"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let dropped = TypingCorner.dropped(rect(entry["frame"])!, on: all)
                try near(dropped?.frame, rect(entry["kept"]), "kept")
                try samePlace(dropped?.place, entry["place"], "place")
                // Wholly inside its display, and read back where it was let go.
                if let dropped {
                    try expect(all.contains { $0.display.visible.contains(dropped.frame) }, "inside a display")
                    try near(TypingCorner.frame(place: dropped.place, size: dropped.frame.width, on: all), dropped.frame, "read back")
                }
            }
        }
        for entry in file["restored"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let place = TypingPlace(saved: entry["place"] as? [String: Any])!
                let on = entry["screens"].map(screens) ?? all
                try near(TypingCorner.frame(place: place, size: CGFloat(entry["size"] as! Double), on: on), rect(entry["frame"]), "frame")
            }
        }
        let chosen = file["chosen"] as! [String: Any], area = rect(chosen["area"])!
        for entry in chosen["cases"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let size = CGFloat(entry["size"] as? Double ?? 112)
                let frame = TypingCorner.frame(corner: TypingCorner.Corner(rawValue: entry["corner"] as! String)!,
                                               place: TypingPlace(saved: entry["place"] as? [String: Any]), screen: area, topInset: 0,
                                               size: size, on: all)
                let expected = (entry["sameAs"] as? String).map {
                    TypingCorner.frame(corner: TypingCorner.Corner(rawValue: $0)!, screen: area, topInset: 0, size: size)
                } ?? rect(entry["frame"])
                try near(frame, expected, "frame")
            }
        }
        for entry in file["saved"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let place = TypingPlace(saved: entry["saved"] as? [String: Any])
                try samePlace(place, entry["place"], "place")
                if let place { try samePlace(TypingPlace(saved: place.saved), entry["place"], "saved again") }
            }
        }
        try test("P the four corners and 옮긴 자리, apart") {
            try equal(TypingCorner.Corner.corners, [.topLeft, .topRight, .bottomLeft, .bottomRight], "corners")
            try equal(TypingCorner.Corner(saved: "moved"), .moved, "moved")
        }
    }
}
