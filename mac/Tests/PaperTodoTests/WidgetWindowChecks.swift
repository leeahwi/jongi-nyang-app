import AppKit
import PaperCore
import SwiftUI

// 바탕화면 달력 위젯 (#320 · #322): the real widget windows, 40,000 points off every screen — a widget added, removed
// (its toast with 되돌리기), put back, removed again and left until the toast goes. Each step is checked in the window
// server's own pixels (what a desktop would show: the ears, the toast, the window's shadow) and in its window list, so
// no window is left behind. `scripts/test-widget-windows.sh [folder]` also draws the steps over a made-up wallpaper.

@MainActor
@main
private enum WidgetWindowChecks {
    struct Failure: Error, CustomStringConvertible { let description: String }

    /// Every step is checked and printed; a failed one fails the run at its end.
    static var failed = 0
    static func expect(_ condition: Bool, _ message: String) throws {
        if !condition { failed += 1 }
        print("\(condition ? "ok  " : "FAIL") \(message)")
    }

    static var night = ProcessInfo.processInfo.environment["PAPERTODO_PAPER"] == "night"

    static func main() {
        do {
            try run()
            if failed > 0 { exit(1) }
        } catch {
            print("FAIL \(error)")
            exit(1)
        }
    }

    static func run() throws {
        L10n.activate(setting: ProcessInfo.processInfo.environment["PAPERTODO_LANG"] ?? "ko", preferred: [])
        _ = NSApplication.shared
        NSApp.appearance = NSAppearance(named: night ? .darkAqua : .aqua)
        NSApp.setActivationPolicy(.prohibited)
        SlipMotion.enabled = false
        let output = CommandLine.arguments.count > 1 ? URL(fileURLWithPath: CommandLine.arguments[1]) : nil
        if let output { try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true) }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("PaperWidgetWindows-\(UUID())")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let suite = TestDefaults("WidgetWindows")
        defer {
            suite.remove()
            try? FileManager.default.removeItem(at: folder)
        }
        suite.defaults.set(false, forKey: "reminder.enabled")
        let model = AppModel(storageURL: folder.appendingPathComponent("todos.json"), isolated: true, preferences: suite.defaults)
        model.paperColor = night ? .night : .day
        let widgets = CalendarWidgets.shared
        widgets.start(model: model, preferences: suite.defaults, offscreen: true)
        let paper = night ? "night" : "day"

        guard let id = widgets.add(.month, .simple), let panel = widgets.panel(id), let state = widgets.state(id) else {
            throw Failure(description: "a widget was added with its window")
        }
        widgets.update(id) { $0.opacity = 100 }
        settle()
        let frame = panel.frame
        try expect(frame.minX < -20_000 && frame.minY < -20_000, "\(paper): the widget's window is off every screen (\(Int(frame.minX)), \(Int(frame.minY)))")
        try expect(windows(of: panel) == 1, "\(paper): the window server lists the widget's window")
        try expect(earsDrawn(panel, state), "\(paper): the ears are drawn at the widget's top right")
        try expect(panel.hasShadow, "\(paper): the widget casts the window's shadow")
        if let output { try picture(panel, to: output.appendingPathComponent("remove-0-widget-\(paper).png")) }

        // Removed: the paper and the ears go at once; only the toast (with 되돌리기) is left, and nothing else casts a shadow.
        widgets.remove(id)
        settle()
        try expect(state.removed && state.toast != nil, "\(paper): removed, its toast is up")
        try expect(widgets.panel(id) === panel && panel.isVisible, "\(paper): the toast's window stays while 되돌리기 is up")
        try expect(!earsDrawn(panel, state), "\(paper): no ear is left once the widget is removed (#320)")
        try expect(!panel.hasShadow, "\(paper): the toast's window casts no window shadow of its own (#322)")
        try expect(toastDrawn(panel, state), "\(paper): the toast is drawn at the widget's foot")
        if let output { try picture(panel, to: output.appendingPathComponent("remove-1-toast-\(paper).png")) }

        // 되돌리기: the widget and its ears come back in the same place, with the window's shadow.
        state.toast?.perform?()
        settle()
        try expect(!state.removed && state.toast == nil && widgets.list.contains { $0.id == id }, "\(paper): 되돌리기 puts the widget back in the list")
        try expect(widgets.panel(id) === panel && panel.frame == frame, "\(paper): it comes back in the same place")
        try expect(earsDrawn(panel, state), "\(paper): its ears come back with it")
        try expect(panel.hasShadow, "\(paper): the window's shadow comes back")
        try expect(windows(of: panel) == 1, "\(paper): still one window for the widget")

        // Removed again and left alone: when the toast's 4 seconds are up, the window goes and nothing is left.
        let number = panel.windowNumber
        widgets.remove(id)
        settle()
        try expect(!earsDrawn(panel, state), "\(paper): removed again, no ear")
        let deadline = Date().addingTimeInterval(8)
        while widgets.panel(id) != nil && Date() < deadline { settle(0.2) }
        try expect(widgets.panel(id) == nil && widgets.state(id) == nil, "\(paper): when the toast goes, the widget's window is closed")
        try expect(!listed(number), "\(paper): the window server lists no window of the removed widget")
        try expect(listedCount() == 0, "\(paper): no widget window is left at all")
        print("done \(paper)")
    }

    static func settle(_ seconds: Double = 0.4) {
        RunLoop.main.run(until: Date().addingTimeInterval(seconds))
    }

    // MARK: The window server

    private typealias CreateImage = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?
    /// CGWindowListCreateImage: Swift has hidden it since macOS 15 (ScreenCaptureKit instead), but it still draws one of this
    /// process's own windows, off screen too, without asking for screen recording.
    private static let createImage: CreateImage = {
        let handle = dlopen("/System/Library/Frameworks/CoreGraphics.framework/CoreGraphics", RTLD_NOW)
        return unsafeBitCast(dlsym(handle, "CGWindowListCreateImage")!, to: CreateImage.self)
    }()
    private static let includingWindow: UInt32 = 1 << 3, ignoreFraming: UInt32 = 1 << 0

    /// The window as the window server has it, at its full resolution; `framing` adds its shadow.
    static func image(_ panel: NSWindow, framing: Bool) -> CGImage? {
        createImage(.null, includingWindow, UInt32(panel.windowNumber), framing ? 0 : ignoreFraming)?.takeRetainedValue()
    }

    /// How many of `rect`'s pixels (in points, from the window's top left) are drawn (alpha over 10 %).
    static func drawn(_ panel: NSWindow, in rect: CGRect) -> Int {
        guard let image = image(panel, framing: false) else { return 0 }
        let scale = CGFloat(image.width) / panel.frame.width
        let bitmap = NSBitmapImageRep(cgImage: image)
        var count = 0
        for y in Int(rect.minY * scale)..<Int(rect.maxY * scale) {
            for x in Int(rect.minX * scale)..<Int(rect.maxX * scale) where (bitmap.colorAt(x: x, y: y)?.alphaComponent ?? 0) > 0.1 {
                count += 1
            }
        }
        return count
    }

    /// The ears' strip at the widget's top.
    static func earsDrawn(_ panel: NSWindow, _ state: WidgetState) -> Bool {
        let ear = CalendarWidget.earHeight(state.settings.kind, state.settings.style) * state.scale
        return drawn(panel, in: CGRect(x: 0, y: 0, width: panel.frame.width, height: ear - 1)) > 20
    }

    /// The toast's row at the widget's foot.
    static func toastDrawn(_ panel: NSWindow, _ state: WidgetState) -> Bool {
        drawn(panel, in: CGRect(x: 0, y: panel.frame.height - 50, width: panel.frame.width, height: 40)) > 2_000
    }

    static func ownWindows() -> [[String: Any]] {
        let all = CGWindowListCopyWindowInfo([.optionAll], kCGNullWindowID) as? [[String: Any]] ?? []
        let pid = Int(ProcessInfo.processInfo.processIdentifier)
        return all.filter { ($0[kCGWindowOwnerPID as String] as? Int) == pid }
    }

    static func windows(of panel: NSWindow) -> Int {
        ownWindows().filter { ($0[kCGWindowNumber as String] as? Int) == panel.windowNumber }.count
    }

    static func listed(_ number: Int) -> Bool {
        ownWindows().contains { ($0[kCGWindowNumber as String] as? Int) == number && ($0[kCGWindowIsOnscreen as String] as? Bool) == true }
    }

    /// Shown windows of the size of a widget's (the checks open no other).
    static func listedCount() -> Int {
        ownWindows().filter { ($0[kCGWindowIsOnscreen as String] as? Bool) == true && ($0[kCGWindowLayer as String] as? Int) != 0 }.count
    }

    // MARK: Pictures

    /// The window, with the window server's shadow when it casts one, over a made-up light or dark wallpaper, 2× — always on
    /// a canvas of the window's size and 50 pt around it, the window at the same place, so two steps compare side by side.
    static func picture(_ panel: NSWindow, to url: URL) throws {
        guard let exact = image(panel, framing: false) else { throw Failure(description: "no picture of the window") }
        // With a shadow the window server's picture is larger by it; without one it is cut to what is drawn, so the window then.
        let framed = panel.hasShadow ? image(panel, framing: true) ?? exact : exact
        let (dx, dy) = offset(of: exact, in: framed)
        let margin = Int(50 * CGFloat(exact.width) / panel.frame.width)
        let width = exact.width + margin * 2, height = exact.height + margin * 2
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { throw Failure(description: "no canvas") }
        let colors = night
            ? [CGColor(srgbRed: 0.10, green: 0.12, blue: 0.17, alpha: 1), CGColor(srgbRed: 0.20, green: 0.22, blue: 0.29, alpha: 1)]
            : [CGColor(srgbRed: 0.90, green: 0.91, blue: 0.94, alpha: 1), CGColor(srgbRed: 0.84, green: 0.86, blue: 0.90, alpha: 1)]
        let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors as CFArray, locations: [0, 1])!
        context.drawLinearGradient(gradient, start: .zero, end: CGPoint(x: width, y: height), options: [])
        // CoreGraphics counts y up from the bottom.
        context.draw(framed, in: CGRect(x: margin - dx, y: height - (margin - dy) - framed.height, width: framed.width, height: framed.height))
        guard let made = context.makeImage() else { throw Failure(description: "no picture") }
        try NSBitmapImageRep(cgImage: made).representation(using: .png, properties: [:])!.write(to: url)
        print("     \(url.lastPathComponent)")
    }

    /// Where the window's own picture sits in the one with its shadow (from the top left): the offset where its solid
    /// pixels match.
    static func offset(of exact: CGImage, in framed: CGImage) -> (Int, Int) {
        guard framed.width > exact.width || framed.height > exact.height else { return (0, 0) }
        let a = NSBitmapImageRep(cgImage: exact), b = NSBitmapImageRep(cgImage: framed)
        var samples: [(Int, Int, NSColor)] = []
        for y in stride(from: 0, to: exact.height, by: 7) {
            for x in stride(from: 0, to: exact.width, by: 7) {
                if let color = a.colorAt(x: x, y: y), color.alphaComponent > 0.95 { samples.append((x, y, color)) }
            }
        }
        samples = Array(samples.prefix(400))
        var best = (0, 0), bestError = Double.infinity
        for dy in 0...max(0, framed.height - exact.height) {
            for dx in 0...max(0, framed.width - exact.width) {
                var error = 0.0
                for (x, y, color) in samples {
                    guard let other = b.colorAt(x: x + dx, y: y + dy) else { error += 3; continue }
                    error += abs(Double(color.redComponent - other.redComponent)) + abs(Double(color.greenComponent - other.greenComponent))
                        + abs(Double(color.blueComponent - other.blueComponent))
                    if error >= bestError { break }
                }
                if error < bestError { (best, bestError) = ((dx, dy), error) }
            }
        }
        return best
    }
}
