import CoreGraphics
import Foundation

// 종이냥 펫과 타닥냥의 크기 (#304, CatSize.swift): the shared cases from docs/plans/cat-size-cases.json (the Windows app's
// test/catSize.test.ts reads the same file).
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    try expect(actual == expected, "\(name): expected \(expected), got \(actual)")
}

private func number(_ value: Any?) -> CGFloat { CGFloat((value as! NSNumber).doubleValue) }

@main
private enum CatSizeTests {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "../docs/plans/cat-size-cases.json"
        let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        func step(_ entry: [String: Any]) -> CatSize { CatSize(rawValue: entry["step"] as! String)! }

        try test("the steps, their scales and names (the timer's)") {
            let steps = file["steps"] as! [[String: Any]]
            try equal(CatSize.allCases.map(\.rawValue), steps.map { $0["id"] as! String }, "steps")
            for entry in steps {
                let size = CatSize(rawValue: entry["id"] as! String)!
                try equal(size.scale, number(entry["scale"]), "scale")
                try equal(size.names, entry["names"] as! [String], "names")
            }
        }
        try test("saved as pet.size · typing.size, 보통 unless changed") {
            let prefs = (file["prefs"] as! [String: Any])["mac"] as! [String: String]
            try equal(prefs["pet"]!, "pet.size", "pet")
            try equal(prefs["typing"]!, "typing.size", "typing")
            try equal(CatSize(saved: nil).rawValue, file["default"] as! String, "default")
        }
        for entry in file["read"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                try equal(CatSize(saved: entry["saved"] as? String).rawValue, entry["want"] as! String, "read")
            }
        }
        let pet = file["pet"] as! [String: Any]
        try test("the pet's numbers at 보통 are the ones before #304") {
            try equal(CatSize.petBase, number(pet["base"]), "size")
            try equal(CatSize.stride(CatSize.petBase), number(pet["strideBase"]), "stride")
            try equal(CatSize.stripHeight(CatSize.petBase), number(pet["stripBase"]), "strip")
            try equal(CatSize.margin(CatSize.petBase), number(pet["marginBase"]), "margin")
            try equal(CatSize.regular.petSize, 92, "regular")
        }
        for entry in pet["sizes"] as! [[String: Any]] {
            try test("pet " + (entry["case"] as! String)) {
                let size = step(entry).petSize
                try equal(size, number(entry["size"]), "size")
                try equal(CatSize.stride(size), number(entry["stride"]), "stride")
                try equal(CatSize.stripHeight(size), number(entry["strip"]), "strip")
                try equal(CatSize.margin(size), number(entry["margin"]), "margin")
                try expect(size + 150 <= CatSize.stripHeight(size), "a question's bubble fits")
            }
        }
        for entry in pet["clamp"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                try equal(CatSize.clamp(number(entry["x"]), width: number(entry["width"]), size: step(entry).petSize), number(entry["want"]), "clamp")
            }
        }
        for entry in pet["anchor"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let size = step(entry).petSize, x = number(entry["homeX"])
                let r = (entry["rect"] as! [Any]).map(number)
                // DesktopPetController.anchorFrame, in the strip's coordinates.
                try equal(CGRect(x: x - size / 2, y: 0, width: size, height: size), CGRect(x: r[0], y: r[1], width: r[2], height: r[3]), "anchor")
            }
        }
        for entry in pet["lift"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let size = step(entry).petSize
                try equal(number(entry["lift"]) * (size / CatSize.petBase), number(entry["want"]), "lift")
            }
        }
        let typing = file["typing"] as! [String: Any]
        try test("타닥냥's side at each step") {
            try equal(TypingCorner.size, number(typing["base"]), "base")
            try equal(TypingCorner.margin, number(typing["margin"]), "margin")
            for entry in typing["sizes"] as! [[String: Any]] {
                try equal(step(entry).typingSize, number(entry["size"]), entry["step"] as! String)
            }
        }
        for entry in typing["frames"] as! [[String: Any]] {
            try test("타닥냥 " + (entry["case"] as! String)) {
                let s = (entry["screen"] as! [Any]).map(number), f = (entry["frame"] as! [Any]).map(number)
                let screen = CGRect(x: s[0], y: s[1], width: s[2], height: s[3])
                let frame = TypingCorner.frame(corner: TypingCorner.Corner(rawValue: entry["corner"] as! String)!, screen: screen,
                                               topInset: number(entry["topInset"]), size: step(entry).typingSize)
                try equal(frame, CGRect(x: f[0], y: f[1], width: f[2], height: f[3]), "frame")
                try expect(screen.contains(frame), "inside the screen")
            }
        }
        try test("every corner of every screen holds 타닥냥 at every size, flush by the margin") {
            for screen in [CGRect(x: 0, y: 0, width: 1440, height: 900), CGRect(x: -1280, y: 200, width: 1280, height: 800),
                           CGRect(x: 1512, y: -300, width: 2560, height: 1440), CGRect(x: 0, y: 0, width: 150, height: 120)] {
                for size in CatSize.allCases {
                    for corner in TypingCorner.Corner.allCases {
                        let frame = TypingCorner.frame(corner: corner, screen: screen, topInset: 0, size: size.typingSize)
                        try expect(screen.contains(frame), "\(size) \(corner) in \(screen)")
                        let left = corner == .topLeft || corner == .bottomLeft, top = corner == .topLeft || corner == .topRight
                        try equal(left ? frame.minX - screen.minX : screen.maxX - frame.maxX, TypingCorner.margin, "\(size) \(corner) x")
                        try equal(top ? screen.maxY - frame.maxY : frame.minY - screen.minY, TypingCorner.margin, "\(size) \(corner) y")
                    }
                }
            }
        }
        print("\(count) cat-size checks passed")
    }
}
