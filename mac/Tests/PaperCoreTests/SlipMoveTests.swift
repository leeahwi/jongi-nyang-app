import CoreGraphics
import Foundation

// 질문 쪽지 옮기기 (#228, SlipMove): the drag cases from docs/plans/slip-move-cases.json (the Windows app's
// test/slipMove.test.ts reads the same file). The clicks, open and nudge cases are the app's (test-presentation.sh).
// #253: and what works on the desktop calendar widgets while a question waits, from docs/plans/widget-ask-cases.json.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    if actual != expected { throw TestFailure(description: "\(name): expected \(expected), got \(actual)") }
}

@main
private enum SlipMoveTests {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "../docs/plans/slip-move-cases.json"
        let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        let numbers = { (value: Any?) in (value as! [NSNumber]).map { CGFloat($0.doubleValue) } }
        let rect = { (value: Any?) -> CGRect? in
            guard let list = value as? [NSNumber] else { return nil }
            let n = list.map { CGFloat($0.doubleValue) }
            return CGRect(x: n[0], y: n[1], width: n[2], height: n[3])
        }

        try test("the head and the part kept sideways") {
            try equal(SlipMove.head, CGFloat((file["head"] as! NSNumber).doubleValue), "head")
            try equal(SlipMove.keep, CGFloat((file["keep"] as! NSNumber).doubleValue), "keep")
        }
        for entry in file["drag"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let by = numbers(entry["by"]), to = numbers(entry["to"])
                let point = SlipMove.dragged(rect(entry["slip"])!, by: CGVector(dx: by[0], dy: by[1]), in: rect(entry["area"]))
                try equal([point.x, point.y], to, "to")
            }
        }
        // #246: 빠른 입력 · 빠른 메모 keep where they were dragged, per display.
        let place = file["place"] as! [String: Any]
        let saved = { (value: Any?) -> SlipMove.Place? in
            guard let entry = value as? [String: NSNumber] else { return nil }
            return SlipMove.Place(dx: CGFloat(entry["dx"]!.doubleValue), dy: CGFloat(entry["dy"]!.doubleValue),
                                  areaWidth: CGFloat(entry["areaWidth"]!.doubleValue), areaHeight: CGFloat(entry["areaHeight"]!.doubleValue))
        }
        for entry in place["keep"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                try equal(SlipMove.place(of: rect(entry["slip"])!, in: rect(entry["area"])!), saved(entry["saved"])!, "saved")
            }
        }
        for entry in place["open"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let size = numbers(entry["size"])
                let point = SlipMove.placed(saved(entry["saved"]), size: CGSize(width: size[0], height: size[1]), in: rect(entry["area"])!)
                try equal(point.map { [$0.x, $0.y] }, (entry["to"] as? [NSNumber]).map { $0.map { CGFloat($0.doubleValue) } }, "to")
            }
        }
        // #253: what works on the widgets and their day sheet while a question waits (widget-ask-cases.json `presses`).
        let askedPath = CommandLine.arguments.dropFirst(2).first ?? "../docs/plans/widget-ask-cases.json"
        let asked = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: askedPath))) as! [String: Any]
        for entry in asked["presses"] as! [[String: Any]] {
            try test(entry["case"] as! String) {
                let outcome = SlipMove.widgetPress(SlipMove.WidgetPress(rawValue: entry["press"] as! String)!,
                                                   up: SlipMove.Asked(rawValue: entry["up"] as! String)!, over: entry["over"] as? Bool ?? false)
                try equal(outcome.rawValue, entry["then"] as! String, "then")
            }
        }
        print("\(count) slip move checks passed")
    }
}
