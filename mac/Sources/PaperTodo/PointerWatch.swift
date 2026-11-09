import AppKit
import PaperCore

/// #64: the app's one ear for the mouse moving anywhere (the pet and the click-through calendar widgets). Each watcher
/// says how far the pointer is from what reacts to it and what to do with the pointer. One system-wide monitor is
/// installed while anyone watches; after a move far from all of them it is taken off for a moment and the app looks once
/// where the pointer is (`PointerPace`), so moving the mouse over other apps wakes the app a few times a second instead
/// of on every move. Near the cat or a widget, every move is heard as before.
@MainActor
final class PointerWatch {
    static let shared = PointerWatch()

    struct Watcher {
        /// Points from the pointer to what reacts to it (0 over it, `.infinity` when nothing does now).
        var distance: (NSPoint) -> Double
        /// The pointer moved (or was looked at) here.
        var moved: (NSPoint) -> Void
        /// Also told while the left button is held (a drag in another app).
        var duringDrag: Bool
    }

    private var watchers: [String: Watcher] = [:]
    private var monitors: [Any] = []
    private var lookTimer: Timer?
    private var lastPoint: NSPoint?

    /// Where the pointer is (the bench hands in its own path).
    var pointer: () -> NSPoint = { NSEvent.mouseLocation }
    /// Whether the left button is held (a drag going on).
    var buttonDown: () -> Bool = { NSEvent.pressedMouseButtons & 1 != 0 }
    /// The keys held now (⌥ over a widget).
    var modifiers: () -> NSEvent.ModifierFlags = { NSEvent.modifierFlags }
    /// The bench: false hears this app's own events only and keeps them from its windows (a stand-in for the system-wide
    /// monitor, whose moves never reach a window), so no real mouse move is heard.
    var systemWide = true
    /// The bench's "before": every move handled, no pause (as up to 1.48).
    var paced = true
    /// The bench: told when listening starts or stops (a stand-in window server sends moves only meanwhile).
    var onListening: (Bool) -> Void = { _ in }
    /// Counted for the bench and `--perf-log`: moves heard, looks after a pause, monitors installed.
    private(set) var heard = 0
    private(set) var looks = 0
    private(set) var installs = 0

    var isListening: Bool { !monitors.isEmpty }
    var isLookingAway: Bool { lookTimer != nil }
    func watches(_ id: String) -> Bool { watchers[id] != nil }

    func watch(_ id: String, duringDrag: Bool = false, distance: @escaping (NSPoint) -> Double, moved: @escaping (NSPoint) -> Void) {
        let first = watchers[id] == nil
        watchers[id] = Watcher(distance: distance, moved: moved, duringDrag: duringDrag)
        if first { refresh() }
    }

    func stop(_ id: String) {
        guard watchers.removeValue(forKey: id) != nil else { return }
        if watchers.isEmpty {
            stopListening()
            lookTimer?.invalidate()
            lookTimer = nil
            lastPoint = nil
        }
    }

    /// What reacts to the pointer changed under it (the cat moved to another display, a question came up): looked at now,
    /// and every move heard again until the next one far away.
    func refresh() {
        guard !watchers.isEmpty else { return }
        lookTimer?.invalidate()
        lookTimer = nil
        let point = pointer()
        _ = tell(point, dragging: buttonDown())
        lastPoint = point
        listen()
    }

    // MARK: Hearing

    private func listen() {
        guard monitors.isEmpty, !watchers.isEmpty else { return }
        installs += 1
        let heard: (NSEvent) -> Void = { [weak self] event in
            let dragging = event.type == .leftMouseDragged
            MainActor.assumeIsolated { self?.heardMove(dragging: dragging) }
        }
        if systemWide {
            if let global = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged], handler: heard) { monitors.append(global) }
            if let local = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved], handler: { heard($0); return $0 }) { monitors.append(local) }
        } else if let local = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged], handler: { heard($0); return nil }) {
            monitors.append(local)
        }
        onListening(true)
    }

    private func stopListening() {
        guard !monitors.isEmpty else { return }
        monitors.forEach(NSEvent.removeMonitor)
        monitors.removeAll()
        onListening(false)
    }

    private func heardMove(dragging: Bool) {
        PerfProbe.count("pointerMove")
        heard += 1
        // A move already on its way when the monitor came off.
        guard lookTimer == nil, !watchers.isEmpty else { return }
        let point = pointer()
        let distance = tell(point, dragging: dragging)
        lastPoint = point
        guard paced, case .look(let after) = PointerPace.next(moved: true, distance: distance) else { return }
        stopListening()
        look(after: after)
    }

    private func look(after seconds: TimeInterval) {
        let timer = Timer(timeInterval: seconds, repeats: false) { [weak self] _ in
            MainActor.assumeIsolated { self?.looked() }
        }
        timer.tolerance = seconds / 10
        RunLoop.main.add(timer, forMode: .common)
        lookTimer = timer
    }

    /// After a pause: where is the pointer now?
    private func looked() {
        lookTimer = nil
        guard !watchers.isEmpty else { return }
        PerfProbe.count("pointerLook")
        looks += 1
        let point = pointer()
        let moved = point != lastPoint
        var distance = Double.infinity
        if moved {
            distance = tell(point, dragging: buttonDown())
            lastPoint = point
        }
        switch PointerPace.next(moved: moved, distance: distance) {
        case .listen: listen()
        case .look(let after): look(after: after)
        }
    }

    /// Every watcher hears the pointer (during a drag only those that want it); the distance to the nearest of them.
    private func tell(_ point: NSPoint, dragging: Bool) -> Double {
        var nearest = Double.infinity
        for watcher in watchers.values {
            if !dragging || watcher.duringDrag { watcher.moved(point) }
            nearest = min(nearest, watcher.distance(point))
        }
        return nearest
    }
}
