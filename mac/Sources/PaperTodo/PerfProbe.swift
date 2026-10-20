import AppKit
import Darwin

/// `--perf-log <file>` (scripts/perf.sh): timing lines for the performance check, nothing otherwise.
/// Each key press or click is timed to the moment the main thread next goes idle (after the frame was
/// committed): `<label> <from the event's timestamp> <from when the app got it>` — the first includes the
/// system's delivery (slow on a busy Mac), the last (the line's last number) is the app's own work: the
/// update, layout and drawing. `begin` times an action that has no event of its own (a menu pressed through
/// accessibility). Cold start is measured from the process's start to the first idle with the note
/// on screen.
@MainActor
enum PerfProbe {
    private static var file: Int32 = -1
    private static var pending: [(label: String, since: TimeInterval, received: TimeInterval)] = []
    private static var noteShown = false
    private static var monitor: Any?
    private static var observer: CFRunLoopObserver?
    private static var shotSignal: DispatchSourceSignal?
    private static var shots = 0
    private static var folder = ""

    static var isOn: Bool { file >= 0 }

    static func start(arguments: [String]) {
        guard let index = arguments.firstIndex(of: "--perf-log"), arguments.indices.contains(index + 1) else { return }
        let path = arguments[index + 1]
        // Appending, so the lines the script adds in between stay where they are.
        file = open(path, O_WRONLY | O_APPEND | O_CREAT, 0o644)
        folder = (path as NSString).deletingLastPathComponent
        // `kill -USR1 <pid>`: every window on screen drawn into the log's folder (the live check's pictures).
        signal(SIGUSR1, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
        source.setEventHandler { MainActor.assumeIsolated { capture() } }
        source.resume()
        shotSignal = source
        write("start \(String(format: "%.1f", sinceProcessStart()))")
        monitor = NSEvent.addLocalMonitorForEvents(matching: [.keyDown, .leftMouseUp]) { event in
            let label: String
            switch event.type {
            case .keyDown:
                let keys = event.charactersIgnoringModifiers ?? ""
                label = "key \(event.keyCode) \(keys.unicodeScalars.allSatisfy { $0.value >= 32 && $0.value < 0xF700 } ? keys : "")"
            default: label = "click"
            }
            pending.append((label, event.timestamp, ProcessInfo.processInfo.systemUptime))
            return event
        }
        let observer = CFRunLoopObserverCreateWithHandler(nil, CFRunLoopActivity.beforeWaiting.rawValue, true, CFIndex.max) { _, _ in
            MainActor.assumeIsolated { idle() }
        }
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
        self.observer = observer
    }

    /// An action that has no event of its own; timed until the next idle.
    static func begin(_ label: String) {
        guard isOn else { return }
        let now = ProcessInfo.processInfo.systemUptime
        pending.append((label, now, now))
    }

    /// A point in the launch: milliseconds since the process started.
    static func mark(_ label: String) {
        guard isOn else { return }
        write("mark \(label) \(String(format: "%.1f", sinceProcessStart()))")
    }

    /// A file written, and how long it took.
    static func io(_ name: String, since start: TimeInterval) {
        guard isOn else { return }
        write("io \(name) \(String(format: "%.2f", (ProcessInfo.processInfo.systemUptime - start) * 1000))")
    }

    static var now: TimeInterval { ProcessInfo.processInfo.systemUptime }

    private static func idle() {
        let uptime = ProcessInfo.processInfo.systemUptime
        if !noteShown, let note = NSApp.windows.first(where: { $0 is NoteWindow }), note.isVisible {
            noteShown = true
            write("noteVisible \(String(format: "%.1f", sinceProcessStart()))")
        }
        guard !pending.isEmpty else { return }
        for entry in pending {
            write("\(entry.label) \(String(format: "%.2f", (uptime - entry.since) * 1000)) \(String(format: "%.2f", (uptime - entry.received) * 1000))")
        }
        pending.removeAll()
    }

    private static func capture() {
        shots += 1
        for (index, window) in NSApp.windows.enumerated() where window.isVisible {
            guard let view = window.contentView, view.bounds.width > 0,
                  let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { continue }
            view.cacheDisplay(in: view.bounds, to: bitmap)
            let name = String(format: "shot-%02d-%d-%@.png", shots, index, window.title.isEmpty ? "untitled" : window.title)
            try? bitmap.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: folder).appendingPathComponent(name))
        }
        write("shot \(shots)")
    }

    private static func write(_ line: String) {
        guard file >= 0 else { return }
        let bytes = Array((line + "\n").utf8)
        _ = bytes.withUnsafeBufferPointer { Darwin.write(file, $0.baseAddress, $0.count) }
    }

    /// Milliseconds since this process started (the kernel's start time).
    private static func sinceProcessStart() -> Double {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return -1 }
        let started = info.kp_proc.p_un.__p_starttime
        let start = Double(started.tv_sec) + Double(started.tv_usec) / 1_000_000
        return (Date().timeIntervalSince1970 - start) * 1000
    }
}
