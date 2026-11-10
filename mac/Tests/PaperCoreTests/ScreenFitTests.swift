import CoreGraphics
import Foundation

// #327: which display a floating window is on and how it is kept there (ScreenFit, TimerWindow). Three made-up display
// layouts in AppKit's coordinates (origin at the main display's bottom left, y up), the same table for every window:
// the timer and the folded note's icon dragged to a display's top and bottom, across the line between two, and off
// every display; the pointer on a display's top row.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    if actual != expected { throw TestFailure(description: "\(name): expected \(expected), got \(actual)") }
}

private func display(_ frame: [CGFloat], visible: [CGFloat]) -> ScreenFit.Display {
    ScreenFit.Display(frame: CGRect(x: frame[0], y: frame[1], width: frame[2], height: frame[3]),
                      visible: CGRect(x: visible[0], y: visible[1], width: visible[2], height: visible[3]))
}

/// A: a MacBook (the main display: a 37 pt menu bar with the notch, the Dock at the bottom) with a bigger monitor above
/// it, shifted left; a menu bar on each (Displays have separate Spaces).
private let above = [
    display([0, 0, 1512, 982], visible: [0, 70, 1512, 875]),
    display([-524, 982, 2560, 1440], visible: [-524, 982, 2560, 1415]),
]
/// B: a MacBook (the Dock on the left) with a monitor to its right, 300 pt higher; the menu bar only on the main display.
private let beside = [
    display([0, 0, 1440, 900], visible: [60, 0, 1380, 875]),
    display([1440, 300, 1920, 1080], visible: [1440, 300, 1920, 1080]),
]
/// C: the monitor is the main display (the Dock at its bottom); the smaller MacBook is down and to its left.
private let belowLeft = [
    display([0, 0, 2560, 1440], visible: [0, 80, 2560, 1335]),
    display([-1512, -700, 1512, 982], visible: [-1512, -700, 1512, 945]),
]

@main
private enum ScreenFitTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        /// The timer's window at `origin` (보통 unless `scale`) as the end of a drag leaves it.
        func timer(_ origin: CGPoint, _ displays: [ScreenFit.Display], scale: CGFloat = 1, focusing: Bool = false) -> CGPoint {
            let side = TimerWindow.side * scale
            return TimerWindow.kept(CGRect(origin: origin, size: CGSize(width: side, height: side)), scale: scale, focusing: focusing, in: displays).origin
        }
        /// The cat's ears: the top of the window less its empty top.
        func ears(_ origin: CGPoint, scale: CGFloat = 1, focusing: Bool = false) -> CGFloat {
            origin.y + (TimerWindow.side - TimerWindow.emptyTop(focusing: focusing)) * scale
        }
        let icon = CGSize(width: 110, height: 130)
        func folded(_ origin: CGPoint, _ displays: [ScreenFit.Display]) -> CGPoint {
            ScreenFit.kept(CGRect(origin: origin, size: icon), in: displays, slack: .all(-12)).origin
        }

        // MARK: The timer (the issue)

        try test("A: the timer dragged to the top of the monitor above goes right up under its menu bar") {
            let end = timer(CGPoint(x: 200, y: 2342), above)
            try equal(end, CGPoint(x: 200, y: 2259), "origin")
            try equal(ears(end), 2397, "the cat's ears at the monitor's usable top")
        }
        try test("A: dragged past that top (on no display), it comes back to the same monitor's top, not the MacBook") {
            try equal(timer(CGPoint(x: 200, y: 2500), above), CGPoint(x: 200, y: 2259), "origin")
        }
        try test("A: dragged down onto the MacBook's Dock, the tag stays just above it") {
            try equal(timer(CGPoint(x: 600, y: -100), above), CGPoint(x: 600, y: 60), "origin")
        }
        try test("A: across the line between the two, mostly on the monitor: onto the monitor") {
            try equal(timer(CGPoint(x: 1400, y: 900), above), CGPoint(x: 1400, y: 972), "origin")
        }
        try test("A: across the line, mostly on the MacBook: under the MacBook's menu bar") {
            let end = timer(CGPoint(x: 100, y: 880), above)
            try equal(end, CGPoint(x: 100, y: 807), "origin")
            try equal(ears(end), 945, "the cat's ears at the MacBook's usable top")
        }
        try test("B: to the top of the monitor beside, 300 pt higher, without a menu bar: up to its very top") {
            let end = timer(CGPoint(x: 2000, y: 1300), beside)
            try equal(end, CGPoint(x: 2000, y: 1242), "origin")
            try equal(ears(end), 1380, "the cat's ears at the monitor's top edge")
        }
        try test("B: across the side line above the MacBook's top: kept on the monitor (it jumped down onto the MacBook)") {
            try equal(timer(CGPoint(x: 1300, y: 1100), beside), CGPoint(x: 1400, y: 1100), "origin")
        }
        try test("B: to the bottom of the monitor beside: its own bottom, not the MacBook's") {
            try equal(timer(CGPoint(x: 2000, y: 200), beside), CGPoint(x: 2000, y: 290), "origin")
        }
        try test("B: into the MacBook's Dock on the left: the empty side hangs over it, the tag stays clear") {
            try equal(timer(CGPoint(x: -100, y: 400), beside), CGPoint(x: 20, y: 400), "origin")
        }
        try test("C: to the top of the MacBook down to the left (a menu bar of its own)") {
            let end = timer(CGPoint(x: -1000, y: 200), belowLeft)
            try equal(end, CGPoint(x: -1000, y: 107), "origin")
            try equal(ears(end), 245, "the cat's ears at the MacBook's usable top")
        }
        try test("C: across the line between them, mostly on the MacBook: onto the MacBook") {
            try equal(timer(CGPoint(x: -150, y: 100), belowLeft), CGPoint(x: -210, y: 100), "origin")
        }
        try test("C: to the bottom of the MacBook (negative y): its own bottom") {
            try equal(timer(CGPoint(x: -1000, y: -900), belowLeft), CGPoint(x: -1000, y: -710), "origin")
        }
        try test("C: 아주 크게 with a to-do's title on the tag: the cat still reaches the top of the main display") {
            let end = timer(CGPoint(x: 500, y: 1400), belowLeft, scale: 1.5, focusing: true)
            try equal(end, CGPoint(x: 500, y: 1179.5), "origin")
            try equal(ears(end, scale: 1.5, focusing: true), 1415, "the cat's ears at the usable top")
        }
        try test("the timer left inside a display stays where it was put") {
            try equal(timer(CGPoint(x: 700, y: 400), above), CGPoint(x: 700, y: 400), "MacBook")
            try equal(timer(CGPoint(x: 2500, y: 700), beside), CGPoint(x: 2500, y: 700), "monitor beside")
        }

        // MARK: The folded note's icon (12 pt inside)

        try test("B: the icon dropped across the side line, mostly on the monitor: onto it (it went back to the MacBook)") {
            try equal(folded(CGPoint(x: 1400, y: 850), beside), CGPoint(x: 1452, y: 850), "origin")
        }
        try test("A: the icon dragged to the top of the monitor above: 12 pt under its menu bar") {
            try equal(folded(CGPoint(x: 0, y: 2400), above), CGPoint(x: 0, y: 2397 - 12 - 130), "origin")
        }
        try test("C: the icon dropped below every display: back onto the nearest (the MacBook)") {
            try equal(folded(CGPoint(x: -800, y: -1000), belowLeft), CGPoint(x: -800, y: -688), "origin")
        }

        // MARK: Which display

        try test("the pointer on a display's top row is on that display (NSRect.contains says no)") {
            try equal(ScreenFit.index(at: CGPoint(x: 2000, y: 1380), in: beside), 1, "the monitor beside's top row")
            try equal(ScreenFit.index(at: CGPoint(x: 700, y: 982), in: above), 0, "the MacBook's top row, under the monitor above")
            try equal(ScreenFit.index(at: CGPoint(x: 700, y: 983), in: above), 1, "the monitor's bottom row")
            try equal(ScreenFit.index(at: CGPoint(x: 700, y: 0), in: above), 0, "the main display's bottom row")
        }
        try test("a point on no display: the nearest one") {
            try equal(ScreenFit.index(at: CGPoint(x: 1300, y: 1200), in: beside), 1, "above the MacBook, left of the monitor beside")
            try equal(ScreenFit.index(at: CGPoint(x: 3000, y: 1000), in: above), 1, "right of the monitor above")
            try equal(ScreenFit.index(at: CGPoint(x: 1, y: 1), in: []), nil, "no displays")
            try equal(ScreenFit.index(at: CGPoint(x: -40_000, y: -36_000), in: beside, nearest: false), nil, "a slip's drag far off screen: none")
            try equal(ScreenFit.index(at: CGPoint(x: 2000, y: 1380), in: beside, nearest: false), 1, "on one: that one")
        }
        try test("a window is on the display it overlaps most, the first of equals") {
            try equal(ScreenFit.index(of: CGRect(x: 1380, y: 500, width: 100, height: 100), in: beside), 0, "60 on the MacBook, 40 beside")
            try equal(ScreenFit.index(of: CGRect(x: 1390, y: 500, width: 100, height: 100), in: beside), 0, "50 · 50")
            try equal(ScreenFit.index(of: CGRect(x: 1420, y: 500, width: 100, height: 100), in: beside), 1, "20 · 80")
        }

        // MARK: Inside an area

        try test("a rect taller than the area keeps its top on the area's top; wider keeps its left") {
            let area = CGRect(x: 0, y: 0, width: 500, height: 900)
            try equal(ScreenFit.inside(CGRect(x: 50, y: 300, width: 100, height: 2000), area: area).origin, CGPoint(x: 50, y: -1100), "tall")
            try equal(ScreenFit.inside(CGRect(x: 300, y: 10, width: 800, height: 100), area: area).origin, CGPoint(x: 0, y: 10), "wide")
        }
        try test("no displays: the window stays where it is") {
            let frame = CGRect(x: 7, y: 8, width: 250, height: 250)
            try equal(ScreenFit.kept(frame, in: []), frame, "kept")
            try equal(TimerWindow.kept(frame, scale: 1, focusing: false, in: []), frame, "timer")
        }

        print("\n\(count) checks passed.")
    }
}
