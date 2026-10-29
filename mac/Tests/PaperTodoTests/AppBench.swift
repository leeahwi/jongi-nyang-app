import AppKit
import PaperCore
import SwiftUI

/// Perf audit 2 (scripts/bench-app.sh): the app's own views and model on a demo data folder (scripts/perf-data.py),
/// hosted in borderless windows that are never put on screen. Each step is timed to the end of layout and a full draw
/// into a bitmap (what the window server would get), median and max of a few runs. Nothing of the user's is read.
///
///   AppBench <data folder> [--runs N] [--only a,b]
@main
@MainActor
enum AppBench {
    static var runs = 5
    static var only: [String] = []
    static func wanted(_ name: String) -> Bool { only.isEmpty || only.contains { name.hasPrefix($0) } }

    static func main() async throws {
        let args = CommandLine.arguments
        let folder = URL(fileURLWithPath: args[1])
        if let i = args.firstIndex(of: "--runs") { runs = Int(args[i + 1]) ?? 5 }
        if let i = args.firstIndex(of: "--only") { only = args[i + 1].split(separator: ",").map(String.init) }
        checking = args.contains("--check")
        defer { if !over.isEmpty { print("over the ceiling: \(over.joined(separator: ", "))"); exit(1) } }
        L10n.activate(setting: "ko", preferred: [])
        AppLanguage.hourCycle = .h24
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.prohibited)
        HandwritingFont.register()
        SlipMotion.enabled = false
        let suite = "PaperTodo.Bench.\(UUID())"
        let preferences = UserDefaults(suiteName: suite)!
        defer { preferences.removePersistentDomain(forName: suite) }
        preferences.set(false, forKey: "reminder.enabled")
        let storage = folder.appendingPathComponent("todos.json")
        let model = AppModel(storageURL: storage, isolated: true, preferences: preferences)
        let archive = ArchiveStore(model: model)
        print("data: \(model.items.count) to-dos, \(model.memos.count) memos, \(archive.allEntries().count) finished, \(model.calendar.events.count) events")

        // ── Core ──────────────────────────────────────────────────────────────
        if wanted("core") {
            report("core Calendar.paper ×10,000", time { var n = 0; for _ in 0..<10_000 { n &+= Calendar.paper.firstWeekday }; sink(n) })
            let fixed = Calendar.paper
            report("core same Calendar kept ×10,000", time { var n = 0; for _ in 0..<10_000 { n &+= fixed.firstWeekday }; sink(n) })
            let date = Date()
            report("core Archive.dayKey ×10,000", time { var n = 0; for _ in 0..<10_000 { n &+= Archive.dayKey(date).count }; sink(n) })
            let notebook = try NotebookFile(url: storage).load()
            let scratch = FileManager.default.temporaryDirectory.appendingPathComponent("bench-\(UUID()).json")
            defer { try? FileManager.default.removeItem(at: scratch) }
            report("core save todos.json (encode + atomic write)", time { try? NotebookFile(url: scratch).save(notebook) })
            report("core load todos.json (read + decode)", time { _ = try? NotebookFile(url: scratch).load() })
            report("core Carry.stamps over the list", time { sink(Carry.stamps(notebook.items, now: Date()).count) })
            // The undo stack's bookkeeping: one stampToday that changes a stamp, with 0 and 200 steps behind it.
            var added: [Int: [Double]] = [:]
            for depth in [0, 200] {
                var history = UndoableNotebook(notebook: notebook)
                let ids = notebook.items.filter { !$0.isCompleted }.map(\.id)
                // Each step stamped after it, as the app does (AppModel.mutateHeld).
                for step in 0..<depth { _ = history.toggle(id: ids[step % ids.count]); history.stampToday(now: Date()) }
                added[depth] = time(runs: 5) {
                    var copy = history
                    _ = copy.add("새 할 일", shelf: nil)
                    copy.stampToday(now: Date())
                }
                report("core add a today task + stampToday, undo depth \(depth)", added[depth]!)
            }
            // #63: the same with 200 steps of undo behind it as with none.
            ceiling("core add + stampToday with 200 steps of undo (≤ 3 × none + 3 ms)", added[200]!, at: 3 * added[0]!.sorted()[2] + 3)
            let files = try BackupController.files(in: folder)
            var text = ""
            report("core backup make (\(files.count) files)", time(runs: 3) { text = Backup.make(files: files, exportedAt: Date(), from: "Mac") })
            print("  backup size \(text.utf8.count / 1024) KB")
            report("core backup parse + validate", time(runs: 3) { _ = try? Backup.parse(text) })
            report("core backup merge (합치기, same data)", time(runs: 3) { sink(Backup.merge(current: files, imported: files).count) })
        }

        // ── Model actions (each saves todos.json, as in the app) ─────────────
        if wanted("model") {
            let open = model.items.filter { !$0.isCompleted }.map(\.id)
            let shallow = time(runs: 3) { model.toggle(open[0]); model.toggle(open[0]); pump() }
            report("model check + uncheck (2 saves), undo depth ~0", shallow)
            for _ in 0..<100 { model.toggle(open[1]); model.toggle(open[1]) }
            pump()
            let deep = time(runs: 3) { model.toggle(open[2]); model.toggle(open[2]); pump() }
            report("model check + uncheck, undo depth 200", deep)
            ceiling("model check + uncheck with 200 steps of undo (≤ 2 × ~0 + 20 ms)", deep, at: 2 * shallow.sorted()[1] + 20)
            report("model add a to-do, undo depth 200", time(runs: 3) { model.add("벤치 할 일"); pump() })
            report("model undo, depth 200", time(runs: 3) { model.undo(); pump() })
            report("model reloadFromDisk (the 2 s watcher's catch-up)", time { model.reloadFromDisk() })
            report("model MenuBarState.current (menu bar tick)", time { _ = MenuBarState.current(model: model, timer: nil) })
        }

        // ── The note ─────────────────────────────────────────────────────────
        // Each step: `update` = the change, the main queue drained and SwiftUI's update and layout; `draw` = the whole
        // view drawn into a bitmap after it (every pixel, so an upper bound for the window server's share).
        if wanted("note") {
            let host = Host(PaperView(model: model), size: NSSize(width: 420, height: 640))
            report("note first draw (오늘)", host.firstDraw)
            host.step("note nothing changed") {}
            let open = model.items.filter { !$0.isCompleted }.map(\.id)
            var flip = false
            // #61: Space on the first row, then ↑ from the input line to the last one (the list scrolls down to it).
            let checks = host.step("note check / uncheck a to-do (saves)") { model.toggle(open[3]) }
            var down = false
            let picks = host.step("note pick the last row ↔ the first (scrolls)") {
                down.toggle()
                model.selectedTaskID = down ? model.todayDisplayOrder.last?.id : model.todayDisplayOrder.first?.id
            }
            model.selectedTaskID = nil; host.frame()
            ceiling("note check / uncheck (\(model.todayItems.count) rows)", checks, at: 300)
            ceiling("note pick the last row ↔ the first (\(model.todayItems.count) rows)", picks, at: 1_200)
            host.step("note unrelated change (selection)") { model.selectedTaskID = open[Int.random(in: 0..<20)] }
            host.step("note tab 오늘 ↔ 앞으로") { flip.toggle(); model.page = flip ? .ahead : .todos }
            if model.page == .todos { model.page = .ahead; host.frame() }
            host.step("note 앞으로 unrelated change") { model.selectedTaskID = open[Int.random(in: 0..<20)] }
            model.page = .todos; host.frame()
            if let space = model.todoSpaces.spaces.first {
                flip = false
                host.step("note lens one space ↔ all") { flip.toggle(); model.showSpace(flip ? .space(space.id) : .all) }
                model.showSpace(.all); host.frame()
            }
            host.close()
        }

        // ── The desk's panes ─────────────────────────────────────────────────
        if wanted("history") {
            let host = Host(HistoryView(archive: archive, model: model), size: NSSize(width: 860, height: 640))
            report("history first draw", host.firstDraw)
            host.step("history nothing changed") {}
            // #62: a change the pane doesn't show (it went through .id(revision) until 1.45), then one it does.
            let unrelated = host.step("history after an unrelated model change (selection)") { model.selectedTaskID = UUID() }
            ceiling("history after an unrelated model change", unrelated, at: 5)
            let open = model.items.filter { !$0.isCompleted }.map(\.id)
            host.step("history after a check (the record changes)") { model.toggle(open[5]) }
            // Not asked to lay out (as in a window that isn't on screen, e.g. the desk after ⌘W): does SwiftUI still
            // rebuild it? The process's CPU over 0.6 s after a change, against the same with no history view.
            let busy = { (label: String, change: () -> Void) in
                let samples = (0..<3).map { _ -> Double in
                    let start = clock_gettime_nsec_np(CLOCK_PROCESS_CPUTIME_ID)
                    change()
                    RunLoop.main.run(until: Date().addingTimeInterval(0.6))
                    return Double(clock_gettime_nsec_np(CLOCK_PROCESS_CPUTIME_ID) - start) / 1e6
                }
                report(label, samples)
                return samples
            }
            let select = { model.selectedTaskID = UUID() }
            let check = { model.toggle(open[6]) }
            _ = busy("history not on screen: CPU ms in 0.6 s after a change", select)
            _ = busy("history not on screen: CPU ms in 0.6 s after a check", check)
            // The desk after ⌘W: shown once (far off every screen), then closed with its view kept, as DeskWindow does
            // (and, as DeskWindowController does, the archive paused while it's closed).
            host.window.setFrameOrigin(NSPoint(x: -40_000, y: -40_000))
            host.window.orderFront(nil)
            host.frame()
            host.window.close()
            archive.paused = true
            pump()
            _ = busy("history in a closed window (after ⌘W): CPU ms in 0.6 s after a change", select)
            let closed = busy("history in a closed window (after ⌘W): CPU ms in 0.6 s after a check", check)
            archive.paused = false
            host.close()
            let none = busy("no history view: CPU ms in 0.6 s after a check", check)
            ceiling("history in a closed window: a check costs what it costs with no history view (+5 ms)",
                    closed, at: (none.sorted()[1]) + 5)
        }
        // ── The cat (#64): one frame of a clip — what the app does 60 times a second while the cat moves ──
        if wanted("pet") {
            let state = PetState()
            state.homeX = 600
            let host = Host(DesktopPetView(state: state), size: NSSize(width: 1710, height: 250))
            report("pet first draw", host.firstDraw)
            var step = 0.0
            let started = Date()
            host.step("pet a walk frame", runs: 60) {
                step += 1
                state.activity = PetActivity(.walk(from: 500, to: 670), start: started.addingTimeInterval(-step / 60))
            }
            host.step("pet a tilt frame", runs: 60) {
                step += 1
                state.activity = PetActivity(.tilt, start: Date().addingTimeInterval(-(step.truncatingRemainder(dividingBy: 80)) / 60))
            }
            state.activity = PetActivity(.sit)
            host.frame()
            host.step("pet at rest, nothing changed", runs: 20) {}
            host.close()
        }
        if wanted("calendar") {
            for mode in [CalendarWindowView.Mode.month, .week] {
                let host = Host(CalendarWindowView(model: model, today: CalendarDraft.day(Date()), mode: mode), size: NSSize(width: 860, height: 640))
                report("calendar \(mode.rawValue) first draw", host.firstDraw)
                host.step("calendar \(mode.rawValue) nothing changed") {}
                host.step("calendar \(mode.rawValue) after a model change") { model.selectedTaskID = UUID() }
                host.close()
            }
        }
        if wanted("search") {
            let history = archive.allEntries()
            for query in ["보", "보고서", "ㅂㄱㅅ", "없는말"] {
                let host = Host(SearchView(model: model, history: history, previewQuery: query), size: NSSize(width: 520, height: 560))
                report("search ‘\(query)’ first draw", host.firstDraw)
                host.step("search ‘\(query)’ after a model change") { model.selectedTaskID = UUID() }
                host.close()
            }
        }
        if wanted("sweep") {
            let open = model.items.filter { !$0.isCompleted && Shelf.page(of: $0, now: Date()) == .today }
            for count in [10, 100, 1000] where count <= open.count {
                let host = Host(SweepView(model: model, moment: .evening, items: Array(open.prefix(count))), size: nil)
                report("sweep slip \(count) items first draw", host.firstDraw)
                host.close()
            }
            let ids = Array(open.prefix(500)).map(\.id)
            report("model.sweep \(ids.count) items to tomorrow", time(runs: 1) { model.sweep(ids, someday: false); pump() })
        }
    }

    // MARK: Timing

    static func pump() { for _ in 0..<3 { RunLoop.main.run(until: Date()) } }
    static func sink<T>(_ value: T) { if "\(value)".isEmpty { print("") } }

    static func time(runs: Int? = nil, _ block: () -> Void) -> [Double] {
        (0..<(runs ?? AppBench.runs)).map { _ in
            let start = DispatchTime.now().uptimeNanoseconds
            block()
            return Double(DispatchTime.now().uptimeNanoseconds - start) / 1e6
        }
    }

    /// `--check` (scripts/bench-app.sh with CHECK=1): fails the run when a step's median is over its ceiling. Only
    /// the steps that hold steady on a busy Mac (#61–#63) have one, set well above what they take now.
    static var checking = false
    static var over: [String] = []
    static func ceiling(_ name: String, _ samples: [Double], at limit: Double) {
        guard checking, !samples.isEmpty else { return }
        let median = samples.sorted()[samples.count / 2]
        let line = String(format: "ceiling %@: %.2f ms (≤ %.2f)", name, median, limit)
        print(median <= limit ? "ok    " + line : "OVER  " + line)
        if median > limit { over.append(name) }
    }

    static func report(_ name: String, _ samples: [Double], halve: Bool = false) {
        let values = samples.map { halve ? $0 / 2 : $0 }.sorted()
        guard !values.isEmpty else { return }
        let median = values[values.count / 2]
        print(String(format: "%@\t%.2f\t%.2f ms", name, median, values.last!))
        fflush(stdout)
    }

    /// A view in a borderless window that is never ordered in; `frame()` lays it out and draws it whole.
    @MainActor final class Host {
        let hosting: NSView
        let window: NSWindow
        let bitmap: NSBitmapImageRep
        var firstDraw: [Double] = []

        init<V: View>(_ view: V, size: NSSize?) {
            let start = DispatchTime.now().uptimeNanoseconds
            let hosting = NSHostingView(rootView: view)
            let fitting = size ?? hosting.fittingSize
            window = NSWindow(contentRect: NSRect(origin: .zero, size: fitting), styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.contentView = hosting
            hosting.frame = NSRect(origin: .zero, size: fitting)
            self.hosting = hosting
            bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds)!
            hosting.layoutSubtreeIfNeeded()
            hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
            firstDraw = [Double(DispatchTime.now().uptimeNanoseconds - start) / 1e6]
            AppBench.pump()
        }

        func frame() {
            AppBench.pump()
            hosting.layoutSubtreeIfNeeded()
            hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        }

        @discardableResult
        func step(_ name: String, runs: Int? = nil, _ change: () -> Void) -> [Double] {
            var update: [Double] = [], draw: [Double] = []
            for _ in 0..<(runs ?? AppBench.runs) {
                let t0 = DispatchTime.now().uptimeNanoseconds
                change()
                AppBench.pump()
                hosting.layoutSubtreeIfNeeded()
                let t1 = DispatchTime.now().uptimeNanoseconds
                hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
                let t2 = DispatchTime.now().uptimeNanoseconds
                update.append(Double(t1 - t0) / 1e6); draw.append(Double(t2 - t1) / 1e6)
            }
            AppBench.report(name + " · update", update)
            AppBench.report(name + " · draw", draw)
            return update
        }

        /// The view leaves the window, so it stops observing the model before the next one is measured.
        func close() { window.contentView = nil; window.close(); AppBench.pump() }
    }
}
