import AppKit
import PaperCore
import SwiftUI

/// Debug builds only (scripts/drag-check.sh): where the timetable's blocks were drawn, and how often its views were
/// redrawn, for the replayed drags below. Release builds keep nothing and draw nothing more.
@MainActor
enum TimetableProbe {
    #if DEBUG
    static var isOn = false
    /// The last frame each block (and "viewport") was drawn at, in the window's content (top-left origin).
    static var frames: [String: CGRect] = [:]
    /// Body evaluations by name ("grid", "block:<id>", "ghost").
    static var bodies: [String: Int] = [:]
    /// The timetable's scroll offset from the top, as the drag sees it.
    static var scroll: CGFloat = 0
    static var foundScrollView = false
    /// Each block's top as drawn this frame, in the hours' points — animation frames included (TimetableSlotOffset; read
    /// while SwiftUI draws, so outside the main actor's bookkeeping).
    nonisolated(unsafe) static var drawn: [String: CGFloat] = [:]
    nonisolated(unsafe) static var drawnOn = false
    /// The closures each block's drag gesture calls (DayTimetable.dragHandlers), by "<id>/<edge>": the replay calls them.
    static var handlers: [String: TimetableDragHandlers] = [:]
    #endif

    static func count(_ name: @autoclosure () -> String) {
        #if DEBUG
        if isOn { bodies[name(), default: 0] += 1 }
        #endif
    }
}

extension View {
    /// Debug builds with the replay on: reports where this view is drawn (TimetableProbe.frames). Otherwise nothing.
    @ViewBuilder
    func probeFrame(_ name: String) -> some View {
        #if DEBUG
        if TimetableProbe.isOn {
            onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { TimetableProbe.frames[name] = $0 }
        } else {
            self
        }
        #else
        self
        #endif
    }
}

#if DEBUG
/// `--timetable-replay <log>` (debug builds, scripts/drag-check.sh): opens today's timetable in this test copy and
/// replays drags on the first to-do with a time, 60 ticks a second, through the very closures its DragGesture calls
/// (DayTimetable.dragHandlers — SwiftUI's gestures don't take synthetic mouse events, so the replay starts one step
/// after them), with Esc as a real key event through the window. Every tick it logs the pointer and where the block
/// was drawn (its frame after SwiftUI laid it out), the timetable's scroll, and how many views were redrawn — one JSON
/// line a tick — so the check can see whether the block follows the pointer.
@MainActor
enum TimetableReplay {
    static func start(arguments: [String], window: NSWindow, model: AppModel) {
        guard let index = arguments.firstIndex(of: "--timetable-replay"), arguments.indices.contains(index + 1) else { return }
        TimetableProbe.isOn = true
        TimetableProbe.drawnOn = true
        let path = arguments[index + 1]
        FileManager.default.createFile(atPath: path, contents: nil)
        guard let handle = FileHandle(forWritingAtPath: path) else { return }
        Task { @MainActor in
            await Runner(window: window, model: model, handle: handle).run()
        }
    }

    @MainActor private final class Runner {
        let window: NSWindow
        let model: AppModel
        let handle: FileHandle
        var tick = 0
        /// The pointer, in the window's content (top-left origin), like the frames.
        var pointer: CGFloat = 0

        init(window: NSWindow, model: AppModel, handle: FileHandle) {
            self.window = window; self.model = model; self.handle = handle
        }

        func log(_ record: [String: Any]) {
            guard var data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) else { return }
            data.append(10)
            try? handle.write(contentsOf: data)
        }

        func wait(_ ticks: Int = 1) async { try? await Task.sleep(for: .milliseconds(16 * ticks)) }

        func escape() {
            guard let e = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                           windowNumber: window.windowNumber, context: nil, characters: "\u{1b}",
                                           charactersIgnoringModifiers: "\u{1b}", isARepeat: false, keyCode: 53) else { return }
            window.sendEvent(e)
        }

        var taskID: String? { model.items.first { $0.timeRange != nil && !$0.isCompleted }?.id.uuidString }
        var block: CGRect? { taskID.flatMap { TimetableProbe.frames[$0] } }
        var viewport: CGRect? { TimetableProbe.frames["viewport"] }

        func range() -> String {
            guard let id = taskID, let range = model.items.first(where: { $0.id.uuidString == id })?.timeRange else { return "none" }
            return "\(range.start)-\(range.end.map(String.init) ?? "nil")"
        }

        /// One line for this tick: what was drawn after the last reading.
        func record(_ scenario: String, _ phase: String) {
            let frame = block ?? .zero
            let id = taskID ?? ""
            let others = TimetableProbe.bodies.filter { $0.key.hasPrefix("block:") && $0.key != "block:" + id }.values.reduce(0, +)
            log(["scenario": scenario, "phase": phase, "tick": tick, "pointer": Double(pointer), "top": Double(frame.minY),
                 "bottom": Double(frame.maxY), "x": Double(frame.minX), "width": Double(frame.width),
                 "scroll": Double(TimetableProbe.scroll), "grid": TimetableProbe.bodies["grid"] ?? 0,
                 "dragged": TimetableProbe.bodies["block:" + id] ?? 0, "others": others,
                 "ghost": TimetableProbe.bodies["ghost"] ?? 0, "range": range(), "drawn": Double(TimetableProbe.drawn[id] ?? 0)])
            tick += 1
        }

        /// Presses at `grab` (window y) on the block's `edge` handle, moves by `steps` (points a tick), logs every tick,
        /// lets go, then logs the settle.
        func drag(_ scenario: String, edge: TimeBlock.Edge, grab: CGFloat, steps: [CGFloat], escapeAfter: Int? = nil) async {
            guard let id = taskID, let viewport else { log(["error": "no block for \(scenario)"]); return }
            let key = "\(id)/\(edge)"
            pointer = grab
            TimetableProbe.bodies = [:]
            record(scenario, "down")
            for (index, step) in steps.enumerated() {
                pointer += step
                // The latest closures, as SwiftUI calls the gesture's latest onChanged.
                guard let handlers = TimetableProbe.handlers[key] else { log(["error": "no handlers \(key)"]); return }
                handlers.changed(grab - viewport.minY, pointer - viewport.minY)
                await wait()
                record(scenario, "drag")
                if index + 1 == escapeAfter { escape(); await wait(); record(scenario, "escape") }
            }
            TimetableProbe.handlers[key]?.ended()
            for _ in 0..<24 { try? await Task.sleep(for: .milliseconds(8)); record(scenario, "settle") }
            await wait(10)
        }

        func run() async {
            log(["start": Date().timeIntervalSince1970])
            NSApp.activate(ignoringOtherApps: true)
            window.makeKeyAndOrderFront(nil)
            model.calendar.setDayOpen(true, now: Date())
            for _ in 0..<300 where block == nil || viewport == nil { await wait(2) }
            guard let first = block, let viewport else { log(["error": "no block drawn"]); return }
            await wait(30)
            log(["block": [first.minX, first.minY, first.width, first.height], "range": range(),
                 "viewport": [viewport.minX, viewport.minY, viewport.width, viewport.height],
                 "scrollView": TimetableProbe.foundScrollView, "scroll": Double(TimetableProbe.scroll)])
            // 1. Move: down quickly, slowly (under a point a tick), back up, a rest, let go 16 pt down (lands 15 min later).
            let moving = Array(repeating: CGFloat(1.3), count: 40) + Array(repeating: 0.4, count: 30) + Array(repeating: -1.2, count: 40) + Array(repeating: 0, count: 8)
            if let b = block { await drag("move", edge: .whole, grab: b.midY, steps: moving) }
            // 2. Stretch the bottom: down, back up a little.
            if let b = block { await drag("bottom", edge: .end, grab: b.maxY - 2, steps: Array(repeating: 1, count: 40) + Array(repeating: -1, count: 20)) }
            // 3. Stretch the top: up.
            if let b = block { await drag("top", edge: .start, grab: b.minY + 2, steps: Array(repeating: -1, count: 30)) }
            // 4. Esc in the middle of a move: back where it was, nothing changed.
            if let b = block { await drag("cancel", edge: .whole, grab: b.midY, steps: Array(repeating: 1.5, count: 30) + Array(repeating: 1, count: 10), escapeAfter: 30) }
            // 5. Past the bottom of the viewport: the timetable scrolls (held for 0.4 s, before the day's end), the block keeps
            // following; Esc, then let go.
            if let b = block, let viewport = self.viewport {
                let distance = viewport.maxY + 8 - b.midY
                await drag("scroll", edge: .whole, grab: b.midY, steps: Array(repeating: distance / 20, count: 20) + Array(repeating: 0, count: 24), escapeAfter: 44)
            }
            log(["done": true, "range": range()])
        }
    }
}
#endif
