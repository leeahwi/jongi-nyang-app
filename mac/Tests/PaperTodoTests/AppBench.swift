import AppKit
import Metal
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
        GPU.warmUp()
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
            // The pick looks its row up for the scroll (the scroll itself is animated, and an animation doesn't run in a
            // window that isn't on screen).
            let picks = host.step("note pick the last row ↔ the first (scrolls)") {
                down.toggle()
                model.selectedTaskID = down ? model.todayDisplayOrder.last?.id : model.todayDisplayOrder.first?.id
            }
            model.selectedTaskID = nil; host.frame()
            ceiling("note check / uncheck (\(model.todayItems.count) rows)", checks, at: 300)
            // #61: 50–65 ms (the first 250–560) before 1.46 with 2,000 to-dos, every row above the last built to look it up.
            ceiling("note pick the last row ↔ the first (\(model.todayItems.count) rows)", picks, at: 60)
            host.step("note unrelated change (selection)") { model.selectedTaskID = open[Int.random(in: 0..<20)] }
            // #61: the same check once ↑ has been to the last row (as in the app: ⌘N, ↑, Space).
            model.selectedTaskID = model.todayDisplayOrder.last?.id; host.frame()
            // The list taken to its end here, where the app's (animated) scroll leaves it.
            if let scroll = scrollView(in: host.hosting), let document = scroll.documentView {
                scroll.contentView.scroll(to: NSPoint(x: 0, y: document.frame.height - scroll.contentView.bounds.height))
                scroll.reflectScrolledClipView(scroll.contentView)
                host.frame()
            }
            let after = host.step("note check / uncheck after ↑ to the last row") { model.toggle(open[3]) }
            model.selectedTaskID = nil; host.frame()
            // #61: 65–80 ms before 1.46 with 2,000 to-dos (all of them built by the pick, and gone over on every change).
            ceiling("note check / uncheck after ↑ to the last row (\(model.todayItems.count) rows)", after, at: 60)
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

        // ── Dragging a row (#167) ────────────────────────────────────────────
        // A row's grip pressed, then 60 moves 4 pt apart and Esc, as events posted to this process's own queue for the
        // bench's window (never on screen, no global events): the grip's tracking loop takes them as it does the mouse's.
        // The time per move is the whole loop over the moves (the drop place worked out, SwiftUI's update and layout).
        if wanted("drag") {
            for (label, grouped, style) in [("plain list", false, SpaceGroupStyle.card), ("메모지", true, .card), ("책갈피", true, .bookmark)] {
                model.groupBySpace = grouped
                model.groupStyle = style
                let host = Host(PaperView(model: model), size: NSSize(width: 420, height: 640))
                // Shown as the app's note is, far off every screen (a borderless window stays where it's put), so the
                // grip's display after each move draws for real.
                host.window.setFrameOrigin(NSPoint(x: -40_000, y: -40_000))
                host.window.orderFront(nil)
                host.frame()
                // Each move's frame drawn as on screen (Core Animation with Metal), as the window server would.
                PaperTaskDragHandle.GripView.afterMove = { _ = host.gpu.render() }
                defer { PaperTaskDragHandle.GripView.afterMove = nil }
                var samples: [Double] = []
                for _ in 0..<AppBench.runs {
                    guard let grip = grips(in: host.hosting).dropFirst(grouped ? 2 : 0).first else { print("drag: no grip (\(grips(in: host.hosting).count) found)"); break }
                    samples.append(drag(grip, in: host.window, moves: Int(ProcessInfo.processInfo.environment["BENCH_MOVES"] ?? "") ?? 60))
                    host.frame()
                }
                report("drag a row \(label) (\(model.todayItems.count) rows) · per move", samples)
                host.close()
            }
            model.groupBySpace = false
        }

        // ── The desk's panes ─────────────────────────────────────────────────
        if wanted("history") {
            let host = Host(HistoryView(archive: archive, model: model), size: NSSize(width: 860, height: 640))
            host.reportFirst("history")
            // #62: 0.38–0.40 s before 1.46 with 2,000 to-dos and three years, 0.3 s the aim (the chosen day, today, made a
            // row for each of its 381 finished to-dos).
            ceiling("history first open (\(archive.allEntries().count) finished)", host.firstOpen, at: 400)
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
            let size = "\(model.items.count) to-dos · \(model.calendar.events.count) events"
            for mode in [CalendarWindowView.Mode.month, .week] {
                let name = "calendar \(mode.rawValue)"
                let host = Host(CalendarWindowView(model: model, today: CalendarDraft.day(Date()), mode: mode), size: NSSize(width: 860, height: 640))
                host.reportFirst(name)
                host.step("\(name) nothing changed", gpu: true) {}
                let unrelated = host.step("\(name) after a model change", gpu: true) { model.selectedTaskID = UUID() }
                let open = model.items.filter { !$0.isCompleted }.map(\.id)
                let checks = host.step("\(name) after a check (the to-dos change)") { model.toggle(open[7]) }
                host.close()
                // #68: 174–283 ms (month) and 19–45 ms (week) before 1.46 with 2,000 to-dos and 200 events; 16 ms is the aim.
                ceiling("\(name) after a model change (\(size))", unrelated, at: 40)
                ceiling("\(name) after a check (\(size))", checks, at: mode == .month ? 120 : 60)
                ceiling("\(name) first open (\(size))", host.firstOpen, at: 300)
            }
        }
        if wanted("search") {
            let history = archive.allEntries()
            let size = "\(model.items.count) to-dos · \(history.count) finished"
            for query in ["보", "보고서", "ㅂㄱㅅ", "없는말"] {
                let host = Host(SearchView(model: model, history: history, previewQuery: query), size: NSSize(width: 520, height: 560))
                host.reportFirst("search ‘\(query)’")
                host.step("search ‘\(query)’ after a model change") { model.selectedTaskID = UUID() }
                host.close()
            }
            // #69: ⌘F's slip as it opens (empty), then typed into as the keyboard does — 보 · 보고 · 보고서, then erased.
            let keys = ["보", "보고", "보고서", "보고", "보", ""]
            let typing = { (name: String) -> [Double] in
                let host = Host(SearchView(model: model, history: history), size: NSSize(width: 520, height: 560))
                host.reportFirst("search (empty) \(name)")
                guard let field = field(in: host.hosting) else { print("search: no field"); return [] }
                // Each key timed to its layout, then 0.15 s for the pause to run out and the results to come.
                let letters = (0..<(keys.count * 2)).map { key -> Double in
                    let start = DispatchTime.now().uptimeNanoseconds
                    type(keys[key % keys.count], into: field)
                    pump()
                    host.hosting.layoutSubtreeIfNeeded()
                    let took = Double(DispatchTime.now().uptimeNanoseconds - start) / 1e6
                    RunLoop.main.run(until: Date().addingTimeInterval(0.15))
                    pump()
                    host.hosting.layoutSubtreeIfNeeded()
                    return took
                }
                report("search a key \(name) · update", letters)
                host.close()
                ceiling("search first open (\(size))", host.firstOpen, at: 150)
                return letters
            }
            _ = typing("(the field only, the results after the pause)")
            SearchView.pause = .zero // after
            let results = typing("→ its results (no pause)") // after
            SearchView.pause = .milliseconds(80) // after
            // 12–38 ms before 1.46 (and the drawing on top); 16 ms is the aim.
            ceiling("search a key → its results (\(size))", results, at: 16) // after
        }
        if wanted("sweep") {
            let open = model.items.filter { !$0.isCompleted && Shelf.page(of: $0, now: Date()) == .today }
            for count in [10, 100, 1000] where count <= open.count {
                let host = Host(SweepView(model: model, moment: .evening, items: Array(open.prefix(count))), size: nil)
                host.reportFirst("sweep slip \(count) items")
                host.close()
                // #70: 1.0–1.7 s before 1.46.
                if count == 1000 { ceiling("sweep slip 1,000 items first open", host.firstOpen, at: 300) }
            }
            let ids = Array(open.prefix(500)).map(\.id)
            // Each run put back with ⌘Z (not timed), so the next moves the same to-dos.
            var moves: [Double] = []
            for _ in 0..<3 {
                moves += time(runs: 1) { model.sweep(ids, someday: false); pump() }
                model.undo(); pump()
            }
            report("model.sweep \(ids.count) items to tomorrow", moves)
            // #70: 0.5–0.9 s before 1.46.
            if ids.count == 500 { ceiling("model.sweep 500 items to tomorrow", moves, at: 100) }
        }
    }

    /// The rows' grips, top to bottom.
    static func grips(in view: NSView) -> [PaperTaskDragHandle.GripView] {
        var all: [PaperTaskDragHandle.GripView] = []
        func visit(_ view: NSView) { if let grip = view as? PaperTaskDragHandle.GripView { all.append(grip) }; view.subviews.forEach(visit) }
        visit(view)
        return all.sorted { $0.convert($0.bounds, to: nil).maxY > $1.convert($1.bounds, to: nil).maxY }
    }

    /// ms per move: the grip pressed, `moves` drags 4 pt apart (down and back up over the rows in view), then Esc — all posted to this process's queue.
    static func drag(_ grip: PaperTaskDragHandle.GripView, in window: NSWindow, moves: Int) -> Double {
        let start = grip.convert(NSPoint(x: grip.bounds.midX, y: grip.bounds.midY), to: nil)
        func mouse(_ type: NSEvent.EventType, _ point: NSPoint) -> NSEvent {
            NSEvent.mouseEvent(with: type, location: point, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                               windowNumber: window.windowNumber, context: nil, eventNumber: 0, clickCount: 1, pressure: 1)!
        }
        // Down 4 pt a move for 30 moves, then back up, and again: over the rows in view (a few rows apart).
        for step in 1...moves {
            let phase = step % 60
            let down = CGFloat(phase < 30 ? phase : 60 - phase) * 4
            NSApp.postEvent(mouse(.leftMouseDragged, NSPoint(x: start.x + 20, y: start.y - 8 - down)), atStart: false)
        }
        let escape = NSEvent.keyEvent(with: .keyDown, location: .zero, modifierFlags: [], timestamp: ProcessInfo.processInfo.systemUptime,
                                      windowNumber: window.windowNumber, context: nil, characters: "\u{1b}", charactersIgnoringModifiers: "\u{1b}",
                                      isARepeat: false, keyCode: 53)!
        NSApp.postEvent(escape, atStart: false)
        let t0 = DispatchTime.now().uptimeNanoseconds
        grip.mouseDown(with: mouse(.leftMouseDown, start))
        return Double(DispatchTime.now().uptimeNanoseconds - t0) / 1e6 / Double(moves)
    }

    /// The largest scroll view in the view (the note's list).
    static func scrollView(in view: NSView) -> NSScrollView? {
        var all: [NSScrollView] = []
        func visit(_ view: NSView) { if let scroll = view as? NSScrollView { all.append(scroll) }; view.subviews.forEach(visit) }
        visit(view)
        return all.max { ($0.documentView?.frame.height ?? 0) < ($1.documentView?.frame.height ?? 0) }
    }

    /// The search slip's field (IntentField).
    static func field(in view: NSView) -> NSTextField? {
        if let field = view as? IntentField.KeyField { return field }
        return view.subviews.lazy.compactMap { field(in: $0) }.first
    }

    /// A key in the field: its new text, and the field's delegate told, as AppKit does.
    static func type(_ text: String, into field: NSTextField) {
        field.stringValue = text
        field.delegate?.controlTextDidChange?(Notification(name: NSControl.textDidChangeNotification, object: field))
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
    /// the steps that hold steady on a busy Mac (#61–#63, #68–#70) have one, set well above what they take now.
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
        let gpu: GPU
        /// Made, laid out and drawn into the bitmap (on the CPU).
        var firstDraw: [Double] = []
        /// Made, laid out, committed and drawn by Core Animation with Metal, as on screen (#68).
        var firstOpen: [Double] = []

        init<V: View>(_ view: V, size: NSSize?) {
            let start = DispatchTime.now().uptimeNanoseconds
            let hosting = NSHostingView(rootView: view)
            let fitting = size ?? hosting.fittingSize
            window = NSWindow(contentRect: NSRect(origin: .zero, size: fitting), styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.contentView = hosting
            hosting.frame = NSRect(origin: .zero, size: fitting)
            // As every window of the app hosts its view: no min / max size worked out from the view after each change
            // (it measured the note's whole list for the window's constraints, a third of a check here).
            hosting.sizingOptions = []
            self.hosting = hosting
            hosting.layoutSubtreeIfNeeded()
            let laidOut = Double(DispatchTime.now().uptimeNanoseconds - start) / 1e6
            gpu = GPU(hosting.layer!, size: fitting)
            firstOpen = [laidOut + gpu.render()]
            let drawing = DispatchTime.now().uptimeNanoseconds
            bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds)!
            hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
            firstDraw = [laidOut + Double(DispatchTime.now().uptimeNanoseconds - drawing) / 1e6]
            AppBench.pump()
        }

        /// The first draw both ways: through the bitmap (CPU) and as on screen (GPU).
        func reportFirst(_ name: String) {
            AppBench.report(name + " first draw", firstDraw)
            AppBench.report(name + " first open (layout + GPU draw)", firstOpen)
        }

        func frame() {
            AppBench.pump()
            hosting.layoutSubtreeIfNeeded()
            hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        }

        /// `gpu`: also the frame drawn as on screen (`· GPU draw`), before the bitmap.
        @discardableResult
        func step(_ name: String, runs: Int? = nil, gpu drawsOnGPU: Bool = false, _ change: () -> Void) -> [Double] {
            var update: [Double] = [], draw: [Double] = [], onGPU: [Double] = []
            for _ in 0..<(runs ?? AppBench.runs) {
                let t0 = DispatchTime.now().uptimeNanoseconds
                change()
                AppBench.pump()
                hosting.layoutSubtreeIfNeeded()
                let t1 = DispatchTime.now().uptimeNanoseconds
                if drawsOnGPU { onGPU.append(gpu.render()) }
                let t2 = DispatchTime.now().uptimeNanoseconds
                hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
                let t3 = DispatchTime.now().uptimeNanoseconds
                update.append(Double(t1 - t0) / 1e6); draw.append(Double(t3 - t2) / 1e6)
            }
            AppBench.report(name + " · update", update)
            if drawsOnGPU { AppBench.report(name + " · GPU draw", onGPU) }
            AppBench.report(name + " · draw", draw)
            return update
        }

        /// The view leaves the window, so it stops observing the model before the next one is measured.
        func close() { window.contentView = nil; window.close(); AppBench.pump() }
    }

    /// A frame as the window server draws it (#68): the view's layers committed, then rendered by Core Animation with
    /// Metal (CARenderer) into a texture of the window's size — nothing is on screen. The bitmap `draw` renders the
    /// same layers on the CPU, where a translucent layer is drawn through a transparency layer the size of the whole
    /// bitmap: the month's 66 dimmed layers of the days around it took 0.6–1.7 s that way, a few ms here.
    @MainActor final class GPU {
        static let device = MTLCreateSystemDefaultDevice()!
        let renderer: CARenderer

        init(_ layer: CALayer, size: NSSize) {
            let scale = NSScreen.main?.backingScaleFactor ?? 2
            let texture = MTLTextureDescriptor.texture2DDescriptor(pixelFormat: .bgra8Unorm, width: Int(size.width * scale),
                                                                   height: Int(size.height * scale), mipmapped: false)
            texture.usage = [.renderTarget, .shaderRead]
            texture.storageMode = .private
            renderer = CARenderer(mtlTexture: Self.device.makeTexture(descriptor: texture)!, options: nil)
            renderer.layer = layer
            renderer.bounds = CGRect(origin: .zero, size: size)
        }

        /// ms: the commit (the layers' contents drawn) and the frame.
        func render() -> Double {
            let start = DispatchTime.now().uptimeNanoseconds
            CATransaction.flush()
            renderer.beginFrame(atTime: CACurrentMediaTime(), timeStamp: nil)
            renderer.addUpdate(renderer.bounds)
            renderer.render()
            renderer.endFrame()
            return Double(DispatchTime.now().uptimeNanoseconds - start) / 1e6
        }

        /// The first frame of the process builds Metal's pipelines (≈0.4 s), which the window server has long had.
        static func warmUp() {
            let host = Host(ZStack {
                RoundedRectangle(cornerRadius: 6).fill(Color.blue.opacity(0.5)).shadow(radius: 4)
                Text("종이냥").opacity(0.4)
                Image(systemName: "flag.fill")
            }.padding(20).clipped(), size: NSSize(width: 200, height: 120))
            _ = host.gpu.render()
            host.close()
        }
    }
}
