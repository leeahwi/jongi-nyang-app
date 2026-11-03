import AppKit
import Foundation

// 노트 창 위의 고양이 귀 (#151): where the ears' panel goes and when it shows (NoteEarsPlacement), and the ears' shape
// (CatEars, the drawer's numbers). The Windows app checks the same cases (windows/test/noteEars.test.ts).

private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: Bool, _ message: String) throws {
    guard condition else { throw TestFailure(description: message) }
}

@main
private enum NoteEarsTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }

        // A 1440 × 900 screen with a 25 pt menu bar (its visible frame) and a 420 × 560 note in the middle.
        let screen = NSRect(x: 0, y: 0, width: 1440, height: 875)
        let note = NSRect(x: 300, y: 200, width: 420, height: 560)

        try test("E1 the ears' panel stands flush with the note's right edge, its foot 1 pt over the top edge") {
            let frame = NoteEarsPlacement.frame(note: note)
            try expect(frame.maxX == note.maxX, "right edge \(frame.maxX) ≠ \(note.maxX)")
            try expect(frame.minY == note.maxY - 1, "foot \(frame.minY) ≠ \(note.maxY - 1)")
            try expect(frame.width == 100 && frame.height == 20, "size \(frame.size)")
            try expect(NoteEarsPlacement.edge == 19, "the note's edge 19 pt under the panel's top, got \(NoteEarsPlacement.edge)")
        }

        try test("E2 the drawer's ears: 16 pt tall, bases 16–48 and 62–92 pt from the right edge, the left one first") {
            try expect(CatEars.height == 16, "height")
            let left = CatEars.base(0, width: 100, right: true), right = CatEars.base(1, width: 100, right: true)
            try expect(left.a == 8 && left.b == 38, "left ear \(left)")
            try expect(right.a == 52 && right.b == 84, "right ear \(right)")
            let mirrored = CatEars.base(1, width: 100, right: false)
            try expect(mirrored.a == 16 && mirrored.b == 48, "toward the left edge \(mirrored)")
        }

        try test("E3 an ear's shape: the tip 16 pt above the edge (rounded, so drawn about 1 pt lower), the foot running down over the paper") {
            let path = CatEars.ear(from: 8, to: 38, edge: 19, below: 1)
            let box = path.boundingRect
            try expect(abs(box.minY - 3.9) < 0.2, "tip at \(box.minY), want about 3.9")
            try expect(abs(box.maxY - 20) < 0.01 && abs(box.minX - 8) < 0.01 && abs(box.maxX - 38) < 0.01, "box \(box)")
            let inner = CatEars.inner(from: 8, to: 38, edge: 19).boundingRect
            try expect(inner.minY == 8 && inner.maxY == 16 && inner.width == 11 && inner.midX == 23, "pink \(inner)")
        }

        try test("E4 the ears show on a visible note with room above it") {
            try expect(NoteEarsPlacement.shows(note: note, screen: screen, visible: true, minimized: false, fullScreen: false, offscreen: false), "should show")
        }

        try test("E5 hidden, folded into the post-it or closed (not visible): no ears") {
            try expect(!NoteEarsPlacement.shows(note: note, screen: screen, visible: false, minimized: false, fullScreen: false, offscreen: false), "should hide")
        }

        try test("E6 minimised or in full screen: no ears") {
            try expect(!NoteEarsPlacement.shows(note: note, screen: screen, visible: true, minimized: true, fullScreen: false, offscreen: false), "minimised")
            try expect(!NoteEarsPlacement.shows(note: note, screen: screen, visible: true, minimized: false, fullScreen: true, offscreen: false), "full screen")
        }

        try test("E7 the note against the menu bar (docked full height too): no room above, no ears") {
            let top = NSRect(x: 300, y: screen.maxY - 560, width: 420, height: 560)
            try expect(!NoteEarsPlacement.shows(note: top, screen: screen, visible: true, minimized: false, fullScreen: false, offscreen: false), "flush")
            let near = top.offsetBy(dx: 0, dy: -15)
            try expect(!NoteEarsPlacement.shows(note: near, screen: screen, visible: true, minimized: false, fullScreen: false, offscreen: false), "15 pt under")
            let room = top.offsetBy(dx: 0, dy: -16)
            try expect(NoteEarsPlacement.shows(note: room, screen: screen, visible: true, minimized: false, fullScreen: false, offscreen: false), "16 pt under")
        }

        try test("E8 off every screen: ears only in the off-screen checks, where they stay 40,000 pt away with the note") {
            let away = NSRect(x: -40_000, y: 200, width: 420, height: 560)
            try expect(!NoteEarsPlacement.shows(note: away, screen: nil, visible: true, minimized: false, fullScreen: false, offscreen: false), "no screen")
            try expect(NoteEarsPlacement.shows(note: away, screen: nil, visible: true, minimized: false, fullScreen: false, offscreen: true), "checks")
            try expect(NoteEarsPlacement.frame(note: away).maxX < -39_000, "off-screen")
        }

        print("\(count) note-ears checks passed")
    }
}
