import AppKit
import PaperCore
import SwiftUI

// 위젯 더하기 (#319): the gallery slip in its real window (SlipPanel, its paper movable) far off every screen, with a
// made-up month of events and to-dos, clicked the way a mouse clicks it — a press and a release on a tile. Per click:
// the main thread's CPU time for the click and everything it set off within 60 ms (SwiftUI's update, layout, drawing the
// window), less an idle 60 ms; and whether the tile clicked is the one picked after it. Then every tile is pressed at
// six places (its picture's corners and middle, the gap under it, its name) to see where a press doesn't pick it.
//
//   GalleryBench [--rounds N]

private func cpuMs() -> Double {
    var time = timespec()
    clock_gettime(CLOCK_THREAD_CPUTIME_ID, &time)
    return Double(time.tv_sec) * 1000 + Double(time.tv_nsec) / 1_000_000
}

/// A view drawn into a bitmap (rows top-down) and read back by point.
@MainActor
private struct Picture {
    let bitmap: NSBitmapImageRep
    let scale: CGFloat

    /// `rect`: a part of it (the view's own points), drawn alone — the slip's soft shadow makes the whole view slow to draw.
    init(_ view: NSView, _ rect: NSRect? = nil) {
        let rect = rect ?? view.bounds
        bitmap = view.bitmapImageRepForCachingDisplay(in: rect)!
        view.cacheDisplay(in: rect, to: bitmap)
        scale = CGFloat(bitmap.pixelsWide) / rect.width
    }

    var width: Int { bitmap.pixelsWide }
    var height: Int { bitmap.pixelsHigh }

    /// Whether pixel `x`, `y` (top-down) is the same in both.
    func same(_ x: Int, _ y: Int, as other: Picture) -> Bool {
        let size = bitmap.bitsPerPixel / 8
        let a = bitmap.bitmapData! + y * bitmap.bytesPerRow + x * size, b = other.bitmap.bitmapData! + y * other.bitmap.bytesPerRow + x * size
        return memcmp(a, b, size) == 0
    }

    /// Pixels that differ between two pictures of the same view, as points (top-down) and how many.
    func differences(from other: Picture, in rect: CGRect? = nil) -> (box: CGRect, count: Int) {
        let area = rect.map { CGRect(x: $0.minX * scale, y: $0.minY * scale, width: $0.width * scale, height: $0.height * scale) }
            ?? CGRect(x: 0, y: 0, width: width, height: height)
        var minX = Int.max, minY = Int.max, maxX = -1, maxY = -1, count = 0
        for y in max(0, Int(area.minY))..<min(height, Int(area.maxY)) {
            for x in max(0, Int(area.minX))..<min(width, Int(area.maxX)) where !same(x, y, as: other) {
                minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y); count += 1
            }
        }
        guard count > 0 else { return (.null, 0) }
        return (CGRect(x: CGFloat(minX) / scale, y: CGFloat(minY) / scale, width: CGFloat(maxX - minX + 1) / scale, height: CGFloat(maxY - minY + 1) / scale), count)
    }
}

@main
@MainActor
private enum GalleryBench {
    static func main() async throws {
        let args = CommandLine.arguments
        let rounds = args.firstIndex(of: "--rounds").map { Int(args[$0 + 1])! } ?? 5
        L10n.activate(setting: ProcessInfo.processInfo.environment["PAPERTODO_LANG"] ?? "ko", preferred: [])
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)
        HandwritingFont.register()
        SlipMotion.enabled = false

        // A made-up October: a few events a week and some to-dos (as the snapshots draw them).
        let calendar = Calendar.paper
        func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
            calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
        }
        let titles = ["팀 회의", "점심 약속", "운동", "스터디", "치과 검진", "장보기"]
        let colors: [LocalEvent.Color] = [.sage, .purple, .blue, .coral, .yellow, .gray]
        var events: [LocalEvent] = []
        for day in 1...31 where day % 2 == 0 || day % 3 == 0 {
            for slot in 0..<(day % 4 == 0 ? 3 : 1) {
                let start = (9 + slot * 3) * 60
                events.append(LocalEvent(id: "e\(day)-\(slot)", title: titles[(day + slot) % titles.count], date: String(format: "2026-10-%02d", day),
                                         allDay: false, start: start, end: start + 60, color: colors[(day + slot) % colors.count]))
            }
        }
        let widgets = CalendarWidgets.shared
        widgets.feed.events = events
        widgets.feed.tasks = (1...12).map { TodoItem(title: "할 일 \($0)", reminderAt: at(($0 * 2) % 28 + 1, 10)) }
        widgets.feed.now = at(8, 9, 20)

        let panel = SlipPanel(nonactivating: false)
        panel.movesByPaper = true
        panel.setFrameOrigin(NSPoint(x: -40_000, y: -40_000))
        panel.show(WidgetGalleryView(widgets: widgets, done: {}))
        panel.orderFrontRegardless()
        panel.makeKey()
        func settle(_ seconds: Double) {
            let end = Date().addingTimeInterval(seconds)
            while Date() < end {
                while let event = NSApp.nextEvent(matching: .any, until: Date(), inMode: .default, dequeue: true) { NSApp.sendEvent(event) }
                RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.002))
            }
            panel.displayIfNeeded()
        }
        settle(0.6)

        // The seven tiles' pictures, found by drawing the slip with none picked and with each one picked: where the
        // green border comes (top-down points in the hosting view). The picture is 130 × 88; its name 5 pt under it.
        let names = WidgetGalleryView.choices.map { CalendarWidget.name($0.0, $0.1, .current) }
        func drawn(_ picked: Int) -> Picture {
            panel.show(WidgetGalleryView(widgets: widgets, done: {}, picked: picked))
            settle(0.3)
            return Picture(panel.contentView!)
        }
        let none = drawn(-1)
        var thumbs: [CGRect] = []
        for index in names.indices {
            let box = drawn(index).differences(from: none).box
            guard !box.isNull else { print("tile \(index) drew no border"); exit(1) }
            thumbs.append(CGRect(x: box.minX, y: box.minY, width: 130, height: 88))
        }
        /// Each picture's top edge, where its border goes: a strip 2 pt high, compared with the slip drawn with none picked
        /// (one drawing for all seven: the slip's soft shadow makes each drawing slow).
        let edges = thumbs.map { $0.insetBy(dx: 20, dy: 0).divided(atDistance: 2, from: .minYEdge).slice }

        // Opening the slip: the CPU the main thread spends putting it up and drawing it (within 300 ms), three times.
        var openings: [Double] = []
        for _ in 0..<3 {
            let start = cpuMs()
            panel.show(WidgetGalleryView(widgets: widgets, done: {}))
            settle(0.3)
            openings.append(cpuMs() - start)
        }
        let opening = openings.sorted()[1]
        settle(0.1)
        guard let hosting = panel.contentView else { print("no hosting view"); exit(1) }
        guard panel.frame.minX < -30_000, !NSScreen.screens.contains(where: { $0.frame.intersects(panel.frame) }) else {
            print("the slip isn't off every screen: \(panel.frame)"); exit(1)
        }
        /// A top-down point in the hosting view, in the window's points.
        func window(_ x: CGFloat, _ y: CGFloat) -> NSPoint {
            hosting.convert(NSPoint(x: x, y: hosting.isFlipped ? y : hosting.bounds.height - y), to: nil)
        }
        /// The tile whose border is drawn now (nil: none, or more than one).
        func picked() -> Int? {
            let now = Picture(hosting)
            let shown = edges.indices.filter { now.differences(from: none, in: edges[$0]).count > 0 }
            return shown.count == 1 ? shown[0] : nil
        }
        guard picked() == 3 else { print("the slip opened without 이번 달 picked"); exit(1) }
        /// Whether the slip's SwiftUI view takes a click at a point (not the movable paper behind it).
        func takes(_ x: CGFloat, _ y: CGFloat) -> Bool {
            hosting.hitTest(hosting.superview!.convert(window(x, y), from: nil)) === hosting
        }
        // A capture of the window by itself is drawn a few points off from where the window takes clicks (the snapshots,
        // drawn another way, agree with the clicks): each picture as clicks find it — the first point down its middle and
        // across from its left that a tile takes.
        let tiles = thumbs.map { thumb -> CGRect in
            let top = stride(from: thumb.minY - 2, through: thumb.minY + 14, by: 0.5).first { takes(thumb.midX, $0) } ?? thumb.minY
            let left = stride(from: thumb.minX - 4, through: thumb.minX + 12, by: 0.5).first { takes($0, thumb.midY) } ?? thumb.minX
            return thumb.offsetBy(dx: left - thumb.minX, dy: top - thumb.minY)
        }
        print(String(format: "clicks find the pictures %.1f pt right and %.1f pt down of the capture", tiles[0].minX - thumbs[0].minX, tiles[0].minY - thumbs[0].minY))

        func mouse(_ type: NSEvent.EventType, _ point: NSPoint) -> NSEvent {
            NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                               windowNumber: panel.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: type == .leftMouseDown ? 1 : 0)!
        }
        /// A press and a release at `point`: the CPU the main thread spends on them and on what follows within 60 ms.
        func click(_ point: NSPoint?) -> Double {
            let start = cpuMs()
            if let point {
                // The release waits in the queue, as it does when a press starts a drag loop (the paper's).
                NSApp.postEvent(mouse(.leftMouseUp, point), atStart: false)
                panel.sendEvent(mouse(.leftMouseDown, point))
            }
            settle(0.06)
            return cpuMs() - start
        }
        let idle = (0..<5).map { _ in click(nil) }.sorted()[2]

        // Back and forth between 이번 주 and 이번 달 (as in the issue), then across all seven.
        let order = [1, 3, 1, 3, 2, 4] + Array(0..<names.count)
        var costs: [Double] = [], late = 0, missed = 0
        let middle = { (thumb: CGRect) in window(thumb.midX, thumb.midY) }
        /// Whether `index` is picked 60 ms after its click (nil), only 300 ms later (‘late’), or not at all.
        func check(_ index: Int) -> String? {
            if picked() == index { return nil }
            settle(0.3)
            return picked() == index ? "late" : "missed"
        }
        _ = click(middle(tiles[0]))
        for _ in 0..<rounds {
            for index in order {
                costs.append(max(0, click(middle(tiles[index])) - idle))
                switch check(index) {
                case "late": late += 1
                case "missed": missed += 1
                default: break
                }
            }
        }
        let sorted = costs.sorted()
        let median = sorted[sorted.count / 2], p95 = sorted[min(sorted.count - 1, Int(Double(sorted.count) * 0.95))]
        print("tiles \(names.count) · events \(events.count) · idle 60 ms costs \(String(format: "%.2f", idle)) ms CPU")
        print(String(format: "opening the slip: %6.2f ms CPU (median of 3, with 300 ms of waiting)", opening))
        print(String(format: "a click on a tile: median %6.2f · p95 %6.2f · max %6.2f ms (%d clicks); picked only after 300 ms: %d, not picked: %d",
                     median, p95, sorted.last!, sorted.count, late, missed))

        // Where on a tile a press picks it: inside the picture's corners (5 pt in), its middle, the gap under it, the name.
        var misses: [String] = []
        for (index, thumb) in tiles.enumerated() {
            let name = thumb.maxY + 5 + 7
            let spots: [(String, NSPoint)] = [
                ("top left", window(thumb.minX + 5, thumb.minY + 5)), ("middle", middle(thumb)), ("bottom right", window(thumb.maxX - 5, thumb.maxY - 5)),
                ("gap", window(thumb.midX, thumb.maxY + 2.5)), ("name", window(thumb.midX, name)), ("name right", window(thumb.maxX - 4, name)),
            ]
            for (spot, point) in spots {
                _ = click(middle(tiles[(index + 1) % tiles.count]))
                _ = click(point)
                if let result = check(index) { misses.append("\(names[index]) \(spot) (\(result))") }
            }
        }
        print("presses on the tiles: \(tiles.count * 6), not picked 60 ms after: \(misses.count)\(misses.isEmpty ? "" : " — " + misses.joined(separator: ", "))")
        panel.close()
    }
}
