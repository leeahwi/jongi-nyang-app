import CoreGraphics
import Foundation

// #64 (PointerPace.swift): how long the app may stop hearing the mouse while the pointer is far from the cat and the
// widgets — and that a pointer moving no faster than `PointerPace.speed` is never over them unheard.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

/// The app's way of using the rules (PointerWatch): moves come `rate` times a second while it listens; after one far away
/// it stops listening and looks again after the pause; a look that finds the pointer moved and still far pauses again,
/// otherwise it listens.
private struct Watch {
    var listening = true
    var lookAt: Double?
    var lastPoint: CGPoint?
    /// Times the app woke: moves heard plus looks.
    var wakes = 0
    /// Moments it learned where the pointer is (a move heard or a look).
    var seen: [(time: Double, point: CGPoint)] = []

    mutating func run(seconds: Double, rate: Double, path: (Double) -> CGPoint, target: CGRect, paced: Bool = true) {
        let step = 1 / rate
        var time = 0.0
        while time <= seconds + 1e-9 {
            // A look due before this move.
            while let due = lookAt, due <= time + 1e-9 {
                lookAt = nil
                wakes += 1
                let point = path(due)
                seen.append((due, point))
                let moved = point != lastPoint
                lastPoint = point
                switch PointerPace.next(moved: moved, distance: PointerPace.distance(from: point, to: target)) {
                case .listen: listening = true
                case .look(let after): lookAt = due + after
                }
            }
            let point = path(time)
            if listening && point != lastPoint {
                wakes += 1
                seen.append((time, point))
                lastPoint = point
                if paced, case .look(let after) = PointerPace.next(moved: true, distance: PointerPace.distance(from: point, to: target)) {
                    listening = false
                    lookAt = time + after
                }
            }
            time += step
        }
    }
}

@main
enum PointerPaceTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ body: () throws -> Void) throws {
            try body()
            count += 1
            print("PASS \(name)")
        }
        let cat = CGRect(x: 1000, y: 0, width: 110, height: 110)

        try test("near the cat or over it: every move is heard") {
            try expect(PointerPace.pause(distance: 0) == 0, "over it")
            try expect(PointerPace.pause(distance: PointerPace.near) == 0, "at the edge of near")
            try expect(PointerPace.pause(distance: PointerPace.near + PointerPace.speed * PointerPace.shortest - 1) == 0, "within a frame's travel")
            try expect(PointerPace.next(moved: true, distance: 20) == .listen, "next: listen")
        }
        try test("far away: a pause, longer the farther, never longer than 0.25 s") {
            let a = PointerPace.pause(distance: 400), b = PointerPace.pause(distance: 800)
            try expect(a > 0 && b > a, "\(a) < \(b)")
            try expect(PointerPace.pause(distance: 5_000) == PointerPace.longest, "capped")
            try expect(PointerPace.pause(distance: .infinity) == PointerPace.longest, "nothing to watch")
            try expect(PointerPace.pause(distance: .nan) == 0, "unknown: listen")
            try expect(PointerPace.longest == 0.25, "longest")
        }
        try test("a pause is never long enough to reach the cat at the hand's top speed") {
            var distance = 0.0
            while distance < 3_000 {
                let pause = PointerPace.pause(distance: distance)
                try expect(pause * PointerPace.speed <= max(0, distance - PointerPace.near) + 1e-9, "at \(distance): \(pause) s")
                distance += 7
            }
        }
        try test("a resting pointer: listened for again, no timer") {
            try expect(PointerPace.next(moved: false, distance: 2_000) == .listen, "stopped far away")
            try expect(PointerPace.next(moved: true, distance: 2_000) == .look(after: 0.25), "moving far away")
        }
        try test("distance: 0 inside, to the nearest edge or corner outside") {
            try expect(PointerPace.distance(from: CGPoint(x: 1050, y: 50), to: cat) == 0, "inside")
            try expect(PointerPace.distance(from: CGPoint(x: 1050, y: 210), to: cat) == 100, "above")
            try expect(PointerPace.distance(from: CGPoint(x: 900, y: 50), to: cat) == 100, "left")
            try expect(abs(PointerPace.distance(from: CGPoint(x: 1140, y: 150), to: cat) - 50) < 1e-9, "corner (30, 40)")
        }
        try test("straight at the cat at up to 4,000 pt/s from 1,500 pt away: heard within one move of reaching it") {
            for speed in [300.0, 1_000, 2_500, 4_000] {
                for rate in [60.0, 120, 1_000] {
                    let start = CGPoint(x: 1055, y: 1_610)
                    let path: (Double) -> CGPoint = { t in CGPoint(x: start.x, y: max(55, start.y - speed * t)) }
                    var watch = Watch()
                    watch.run(seconds: 1_600 / speed, rate: rate, path: path, target: cat)
                    let arrives = (start.y - 110) / speed
                    guard let first = watch.seen.first(where: { cat.contains($0.point) }) else {
                        throw TestFailure(description: "\(speed) pt/s at \(rate) Hz: never seen over the cat")
                    }
                    try expect(first.time - arrives <= 1 / rate + 1e-6, "\(speed) pt/s at \(rate) Hz: seen \(first.time - arrives) s late")
                }
            }
        }
        try test("wandering far from the cat at 120 moves a second: fewer than 8 wakes a second instead of 120") {
            let path: (Double) -> CGPoint = { t in CGPoint(x: 700 + 450 * sin(t * 2), y: 800 + 250 * sin(t * 2.7)) }
            var paced = Watch(), before = Watch()
            paced.run(seconds: 30, rate: 120, path: path, target: cat)
            before.run(seconds: 30, rate: 120, path: path, target: cat, paced: false)
            let perSecond = Double(paced.wakes) / 30
            try expect(Double(before.wakes) / 30 > 119, "before: \(before.wakes)")
            try expect(perSecond < 8, "paced: \(perSecond) a second")
            print("    far: \(String(format: "%.1f", perSecond)) wakes/s (before \(String(format: "%.1f", Double(before.wakes) / 30)))")
        }
        try test("circling over and around the cat: every move heard, as before") {
            let path: (Double) -> CGPoint = { t in CGPoint(x: 1055 + 80 * cos(t * 3), y: 55 + 80 * sin(t * 3)) }
            var paced = Watch(), before = Watch()
            paced.run(seconds: 10, rate: 120, path: path, target: cat)
            before.run(seconds: 10, rate: 120, path: path, target: cat, paced: false)
            try expect(paced.wakes == before.wakes, "\(paced.wakes) vs \(before.wakes)")
        }
        try test("the mouse resting far away: no wake at all after the last look") {
            let path: (Double) -> CGPoint = { t in t < 1 ? CGPoint(x: 300 + 400 * t, y: 900) : CGPoint(x: 700, y: 900) }
            var watch = Watch()
            watch.run(seconds: 10, rate: 120, path: path, target: cat)
            try expect(watch.listening && watch.lookAt == nil, "listening, no look pending")
            try expect((watch.seen.last?.time ?? 99) <= 1 + 2 * PointerPace.longest, "last wake at \(watch.seen.last?.time ?? -1) s")
        }
        print("\(count) pointer-pace checks passed")
    }
}
