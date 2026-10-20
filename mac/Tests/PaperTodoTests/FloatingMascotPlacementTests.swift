import AppKit
import Foundation

private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expectPoint(_ actual: NSPoint, _ expected: NSPoint, _ message: String) throws {
    let tolerance: CGFloat = 0.001
    guard abs(actual.x - expected.x) <= tolerance, abs(actual.y - expected.y) <= tolerance else {
        throw TestFailure(description: "\(message): expected \(expected), got \(actual)")
    }
}

@main
private enum FloatingMascotPlacementTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }

        let size = NSSize(width: 110, height: 130)
        let padding: CGFloat = 12
        let primary = NSRect(x: 0, y: 0, width: 1440, height: 900)
        let leftDisplay = NSRect(x: -1280, y: 0, width: 1280, height: 800)

        let note = NSSize(width: 420, height: 560)
        let anchor = NSPoint(x: 210, y: 518)

        try test("unfolding without moving the icon restores the original note") {
            let original = NSPoint(x: 300, y: 200)
            let icon = NSPoint(x: original.x + anchor.x, y: original.y + anchor.y)
            let origin = FloatingMascotPlacement.noteOrigin(iconCenter: icon, anchorInNote: anchor, noteSize: note, visibleFrames: [primary])
            try expectPoint(origin, original, "Unmoved icon must reopen the note where it was")
        }

        try test("unfolding follows an icon that was dragged elsewhere") {
            let origin = FloatingMascotPlacement.noteOrigin(iconCenter: NSPoint(x: 1000, y: 700), anchorInNote: anchor, noteSize: note, visibleFrames: [primary])
            try expectPoint(origin, NSPoint(x: 790, y: 182), "Note must open under the moved icon")
        }

        try test("unfolding near an edge keeps the whole note on the icon's display") {
            let corner = FloatingMascotPlacement.noteOrigin(iconCenter: NSPoint(x: 1420, y: 80), anchorInNote: anchor, noteSize: note, visibleFrames: [primary, leftDisplay])
            try expectPoint(corner, NSPoint(x: 1020, y: 0), "Note must stay inside the bottom-right corner")
            let left = FloatingMascotPlacement.noteOrigin(iconCenter: NSPoint(x: -1270, y: 790), anchorInNote: anchor, noteSize: note, visibleFrames: [primary, leftDisplay])
            try expectPoint(left, NSPoint(x: -1280, y: 240), "Note must open on the display holding the icon")
        }

        try test("centers the icon on the requested click point") {
            let origin = FloatingMascotPlacement.origin(
                centeredAt: NSPoint(x: 400, y: 500),
                size: size,
                visibleFrames: [primary],
                edgePadding: padding
            )
            try expectPoint(origin, NSPoint(x: 345, y: 435), "Centered origin drifted")
        }

        try test("keeps a click near the screen edge inside the visible frame") {
            let origin = FloatingMascotPlacement.origin(
                centeredAt: NSPoint(x: 5, y: 895),
                size: size,
                visibleFrames: [primary],
                edgePadding: padding
            )
            try expectPoint(origin, NSPoint(x: 12, y: 758), "Edge clamp used the wrong visible bounds")
        }

        try test("uses the visible frame that contains a negative-origin display click") {
            let origin = FloatingMascotPlacement.origin(
                centeredAt: NSPoint(x: -640, y: 700),
                size: size,
                visibleFrames: [primary, leftDisplay],
                edgePadding: padding
            )
            try expectPoint(origin, NSPoint(x: -695, y: 635), "Negative-origin display click used the wrong screen")
        }

        try test("chooses the nearest display before clamping an offscreen point") {
            let origin = FloatingMascotPlacement.origin(
                centeredAt: NSPoint(x: -1400, y: 300),
                size: size,
                visibleFrames: [primary, leftDisplay],
                edgePadding: padding
            )
            try expectPoint(origin, NSPoint(x: -1268, y: 235), "Offscreen anchor did not clamp to the nearest display")
        }

        print("\n\(count) checks passed.")
    }
}
