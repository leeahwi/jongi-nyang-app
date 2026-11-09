import AppKit
import Darwin
import PaperCore

/// #64 (scripts/bench-pointer.sh): what moving the mouse over other apps costs the app — the real pet and a real
/// click-through month widget, off every screen, in a process that never becomes active. No real mouse move is heard
/// and the cursor is never moved: a thread of this process stands in for the window server and hands the app 120 mouse
/// moves a second along a made-up path (posted into this app's own event queue, `PointerWatch.systemWide = false`),
/// only while the app listens — as macOS sends moves only while a monitor is installed. The pointer the app reads is the
/// same made-up path.
///
/// It checks the watch (it looks away far from the cat and the widget, hears every move near them, the cat and the
/// widget still take the mouse, nothing runs while the mouse rests), then measures the main thread's CPU and wake-ups
/// for each path, before (every move handled, `paced = false`, as up to 1.48) and after, taking turns.
///
///   PointerBench [seconds per turn, default 20] [turns, default 2]
@main
@MainActor
enum PointerBench {
    static var failures: [String] = []
    static var passed = 0
    static var mainThread = mach_thread_self()
    static var wakes = 0

    static func check(_ name: String, _ condition: Bool) {
        if condition { passed += 1; print("PASS \(name)") } else { failures.append(name); print("FAIL \(name)") }
    }

    static func wait(_ seconds: Double) async { try? await Task.sleep(for: .seconds(seconds)) }

    static func windowsOffScreen() -> Bool {
        NSApp.windows.allSatisfy { !$0.isVisible || $0.frame.minX > 20_000 || $0.frame.maxX < -20_000 }
    }

    /// The main thread's CPU seconds so far.
    static func mainCPU() -> Double {
        var info = thread_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<thread_basic_info_data_t>.size / MemoryLayout<integer_t>.size)
        let result = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { thread_info(mainThread, thread_flavor_t(THREAD_BASIC_INFO), $0, &count) }
        }
        guard result == KERN_SUCCESS else { return 0 }
        return Double(info.user_time.seconds) + Double(info.user_time.microseconds) / 1e6
            + Double(info.system_time.seconds) + Double(info.system_time.microseconds) / 1e6
    }

    static func processCPU() -> Double {
        var usage = rusage()
        getrusage(RUSAGE_SELF, &usage)
        return Double(usage.ru_utime.tv_sec) + Double(usage.ru_utime.tv_usec) / 1e6 + Double(usage.ru_stime.tv_sec) + Double(usage.ru_stime.tv_usec) / 1e6
    }

    static func load() -> String {
        var loads = [Double](repeating: 0, count: 3)
        getloadavg(&loads, 3)
        return loads.map { String(format: "%.2f", $0) }.joined(separator: " ")
    }

    static func main() {
        L10n.activate(setting: "ko", preferred: [])
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.prohibited)
        mainThread = mach_thread_self()
        // Every time the main thread wakes from waiting.
        let observer = CFRunLoopObserverCreateWithHandler(nil, CFRunLoopActivity.afterWaiting.rawValue, true, 0) { _, _ in
            MainActor.assumeIsolated { wakes += 1 }
        }
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
        Task { @MainActor in
            let ok = await run()
            exit(ok ? 0 : 1)
        }
        NSApp.run()
    }

    static func run() async -> Bool {
        let arguments = CommandLine.arguments.dropFirst()
        let seconds = arguments.first.flatMap(Double.init) ?? 20
        let turns = arguments.dropFirst().first.flatMap(Int.init) ?? 2
        guard let screen = NSScreen.screens.first else { print("no screen"); return false }
        let suite = TestDefaults("PointerBench")
        let preferences = suite.defaults
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("pointer-bench-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer {
            suite.remove()
            try? FileManager.default.removeItem(at: folder)
        }
        preferences.set(true, forKey: "pet.visible")
        preferences.set(false, forKey: "pet.wanders")
        preferences.set(false, forKey: "chatter.enabled")
        preferences.set(false, forKey: "reminder.enabled")

        // The stand-in window server: moves only while the app listens.
        let feed = Feed()
        let watch = PointerWatch.shared
        watch.systemWide = false
        watch.pointer = { feed.point() }
        watch.buttonDown = { false }
        watch.modifiers = { [] }
        watch.onListening = { feed.setListening($0) }
        feed.start(app: NSApp)

        let model = AppModel(storageURL: folder.appendingPathComponent("todos.json"), isolated: true, preferences: preferences)
        let pet = DesktopPetController(model: model, preferences: preferences, onOpenNote: {})
        pet.offscreen = true
        let widgets = CalendarWidgets.shared
        widgets.start(model: model, preferences: preferences, offscreen: true)
        await wait(0.6)
        check("the pet is out and watched", pet.isVisible && watch.watches("pet") && watch.isListening)
        check("no widget yet: the widgets aren't watched", !watch.watches("widgets"))
        guard let id = widgets.add(.month, .simple), let panel = widgets.panel(id), let cat = pet.anchorFrame else {
            print("FAIL no widget or no cat"); return false
        }
        widgets.update(id) { $0.clickThrough = true }
        // The widget where people keep one: the top right of the same (off-screen) display as the cat.
        let shown = NSRect(x: screen.frame.minX + 40_000, y: screen.frame.minY, width: screen.frame.width, height: screen.frame.height)
        panel.setFrameOrigin(NSPoint(x: shown.maxX - panel.frame.width - 24, y: shown.maxY - panel.frame.height - 60))
        let widget = panel.frame
        let ears = widgets.earRects(widgets.list[0], in: widget)[0]
        check("a click-through widget is watched too, through the same one ear", watch.watches("widgets") && watch.isListening)
        check("every window is off the screens", windowsOffScreen())
        print("    display \(Int(shown.width))×\(Int(shown.height)) · cat \(fmt(cat)) · widget \(fmt(widget))")

        // One move, where the made-up pointer is now.
        func move(to point: NSPoint) async {
            feed.manual = point
            feed.postOne()
            await wait(0.06)
        }
        let far = NSPoint(x: shown.midX - 200, y: shown.midY)
        await move(to: far)
        check("a move far from both: the app stops listening and looks again within 0.25 s",
              !watch.isListening && watch.isLookingAway && pet.passesClicks && widgets.passesClicks(id))
        feed.manual = NSPoint(x: cat.midX, y: cat.midY)
        await wait(0.3)
        check("the pointer on the cat meanwhile: the look finds it — the cat takes the mouse, every move heard again",
              !pet.passesClicks && watch.isListening && !watch.isLookingAway)
        await move(to: NSPoint(x: cat.midX, y: cat.maxY + 60))
        check("just off the cat: clicks pass again, still hearing every move", pet.passesClicks && watch.isListening)
        await move(to: NSPoint(x: ears.midX, y: ears.midY))
        check("on the widget's ears: the widget takes the mouse", !widgets.passesClicks(id) && watch.isListening)
        await move(to: far)
        await wait(0.6)
        check("off the widget and far: clicks pass, and once the pointer rests the app listens again (no timer)",
              widgets.passesClicks(id) && watch.isListening && !watch.isLookingAway)
        let (heard, looks, before) = (watch.heard, watch.looks, wakes)
        await wait(1)
        check("the mouse resting: nothing heard, nothing looked at", watch.heard == heard && watch.looks == looks)
        print("    resting 1 s: \(wakes - before) wakes (the cat's own moments included)")

        // Each path, before and after, taking turns.
        let paths: [(String, PointerPath)] = [
            ("far: working in other apps (middle of the display)", .far(shown)),
            ("across the display, past the cat and the widget", .sweep(shown)),
            ("circling the cat", .around(NSPoint(x: cat.midX, y: cat.midY))),
            ("circling the widget's ears", .around(NSPoint(x: ears.midX, y: ears.midY))),
        ]
        print("== CPU · \(ProcessInfo.processInfo.operatingSystemVersionString) · load \(load()) · 120 moves a second · \(Int(seconds)) s a turn · \(turns) turns")
        struct Result { var main: [Double] = []; var process: [Double] = []; var wakes: [Double] = []; var moves: [Double] = []; var looks: [Double] = []; var installs: [Double] = [] }
        func measure(_ path: PointerPath?, paced: Bool, into result: inout Result) async {
            watch.paced = paced
            feed.manual = nil
            feed.path = path
            watch.refresh()
            await wait(0.5)
            let (m, p, w, h, l, i, s) = (mainCPU(), processCPU(), wakes, watch.heard, watch.looks, watch.installs, ProcessInfo.processInfo.systemUptime)
            await wait(seconds)
            let span = ProcessInfo.processInfo.systemUptime - s
            feed.path = nil
            result.main.append((mainCPU() - m) / span * 100)
            result.process.append((processCPU() - p) / span * 100)
            result.wakes.append(Double(wakes - w) / span)
            result.moves.append(Double(watch.heard - h) / span)
            result.looks.append(Double(watch.looks - l) / span)
            result.installs.append(Double(watch.installs - i) / span)
        }
        func median(_ values: [Double]) -> Double {
            let sorted = values.sorted()
            return sorted.count % 2 == 1 ? sorted[sorted.count / 2] : (sorted[sorted.count / 2 - 1] + sorted[sorted.count / 2]) / 2
        }
        func line(_ name: String, _ result: Result) -> String {
            String(format: "%@: main thread %.2f%% CPU (%@), process %.2f%%, %.1f wakes/s, %.1f moves heard/s, %.1f looks/s, %.1f monitor installs/s",
                   name, median(result.main), result.main.map { String(format: "%.2f", $0) }.joined(separator: " · "),
                   median(result.process), median(result.wakes), median(result.moves), median(result.looks), median(result.installs))
        }
        var resting = Result()
        for _ in 0..<turns { await measure(nil, paced: true, into: &resting) }
        print(line("the mouse resting", resting))
        for (name, path) in paths {
            var old = Result(), new = Result()
            for _ in 0..<turns {
                await measure(path, paced: false, into: &old)
                await measure(path, paced: true, into: &new)
            }
            print("-- \(name)")
            print(line("   before (every move)", old))
            print(line("   after", new))
        }
        watch.paced = true

        // What taking a monitor off and putting it back costs (the app does it when the pointer goes far and rests).
        var start = ProcessInfo.processInfo.systemUptime
        for _ in 0..<1_000 {
            if let monitor = NSEvent.addLocalMonitorForEvents(matching: .mouseMoved, handler: { $0 }) { NSEvent.removeMonitor(monitor) }
        }
        let local = (ProcessInfo.processInfo.systemUptime - start) / 1_000 * 1e6
        start = ProcessInfo.processInfo.systemUptime
        for _ in 0..<200 {
            if let monitor = NSEvent.addGlobalMonitorForEvents(matching: .mouseMoved, handler: { _ in }) { NSEvent.removeMonitor(monitor) }
        }
        let global = (ProcessInfo.processInfo.systemUptime - start) / 200 * 1e6
        print(String(format: "a monitor put on and taken off: %.0f µs (this app's), %.0f µs (system-wide)", local, global))

        model.petVisible = false
        await wait(0.3)
        check("the pet hidden: no longer watched, the widget still is", !watch.watches("pet") && watch.watches("widgets"))
        widgets.update(id) { $0.clickThrough = false }
        check("no widget lets clicks through: nothing watched, nothing listening", !watch.watches("widgets") && !watch.isListening && !watch.isLookingAway)
        check("every window stayed off the screens", windowsOffScreen())
        widgets.remove(id)
        feed.stop()
        print("\(passed) checks passed\(failures.isEmpty ? "" : ", failed: \(failures.joined(separator: "; "))")")
        return failures.isEmpty
    }

    static func fmt(_ rect: NSRect) -> String { "(\(Int(rect.minX)), \(Int(rect.minY)), \(Int(rect.width))×\(Int(rect.height)))" }
}

/// A made-up pointer path (points on the off-screen display, by seconds).
enum PointerPath: Sendable {
    /// Back and forth in the middle of the display, as when working in other apps.
    case far(NSRect)
    /// Across the whole display, now and then past the cat at the bottom and the widget at the top right.
    case sweep(NSRect)
    /// Round and round, 90 pt from a spot.
    case around(NSPoint)

    func point(at t: Double) -> NSPoint {
        switch self {
        case .far(let d):
            NSPoint(x: d.minX + d.width * (0.42 + 0.22 * sin(2.0 * t)), y: d.minY + d.height * (0.5 + 0.14 * sin(2.7 * t)))
        case .sweep(let d):
            NSPoint(x: d.minX + d.width * (0.5 + 0.47 * sin(0.9 * t)), y: d.minY + d.height * (0.5 + 0.48 * sin(1.3 * t)))
        case .around(let c):
            NSPoint(x: c.x + 90 * cos(2.5 * t), y: c.y + 90 * sin(2.5 * t))
        }
    }
}

/// The stand-in window server: a thread that posts a mouse move into this app's queue 120 times a second while the app
/// listens and a path is set. Nothing leaves the process.
final class Feed: @unchecked Sendable {
    private let lock = NSLock()
    private var _listening = true
    private var _path: PointerPath?
    private var _manual: NSPoint?
    private var _start = ProcessInfo.processInfo.systemUptime
    private var running = true
    private typealias Post = @convention(c) (AnyObject, Selector, NSEvent, ObjCBool) -> Void
    private var post: Post?
    nonisolated(unsafe) private var app: NSApplication?
    private let selector = #selector(NSApplication.postEvent(_:atStart:))

    var path: PointerPath? {
        get { lock.withLock { _path } }
        set { lock.withLock { _path = newValue; _start = ProcessInfo.processInfo.systemUptime } }
    }
    var manual: NSPoint? {
        get { lock.withLock { _manual } }
        set { lock.withLock { _manual = newValue } }
    }
    func setListening(_ on: Bool) { lock.withLock { _listening = on } }

    func point() -> NSPoint {
        lock.withLock {
            if let _manual { return _manual }
            if let _path { return _path.point(at: ProcessInfo.processInfo.systemUptime - _start) }
            return NSPoint(x: -1_000_000, y: -1_000_000)
        }
    }

    @MainActor
    func start(app: NSApplication) {
        self.app = app
        post = unsafeBitCast(app.method(for: selector), to: Post.self)
        let thread = Thread { [self] in self.loop() }
        thread.qualityOfService = .userInteractive
        thread.start()
    }

    func stop() { lock.withLock { running = false } }

    /// One move now (the checks).
    func postOne() { send(point()) }

    private func send(_ point: NSPoint) {
        guard let app, let post, let event = NSEvent.mouseEvent(with: .mouseMoved, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                                         windowNumber: 0, context: nil, eventNumber: 0, clickCount: 0, pressure: 0) else { return }
        post(app, selector, event, false)
    }

    private func loop() {
        let step = 1.0 / 120
        var next = ProcessInfo.processInfo.systemUptime
        while lock.withLock({ running }) {
            next += step
            let delay = next - ProcessInfo.processInfo.systemUptime
            if delay > 0 { usleep(useconds_t(delay * 1e6)) } else { next = ProcessInfo.processInfo.systemUptime }
            let (on, moving) = lock.withLock { (_listening, _path != nil && _manual == nil) }
            if on && moving { send(point()) }
        }
    }
}
