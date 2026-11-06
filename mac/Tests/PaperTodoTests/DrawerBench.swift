import AppKit
import Combine
import PaperCore
import SwiftUI

// 메모 서랍 under load, in this process (#3, docs/perf-memo-stress.md): the drawer and the note in borderless windows
// far off every screen, never made key and never activated (the app stays an accessory), so no text field of it ever
// has the keyboard the way a window on screen does — the input-source indicator can't come up. Keys go to the open
// memo's text view directly (insertText), not through the system's event queue.
//
// Per step, the main thread's CPU time for it and for what it set off within `window` ms (SwiftUI's update, layout,
// drawing), less an idle window's own: the same work as the old perf-memo.sh's "key → main thread idle after the
// frame", but steady on a busy Mac (another process's load doesn't add to this thread's CPU time).
//
//   DrawerBench <folder made by memo-stress-data.py> [--long] [--keys N] [--sample <file>] [--ceiling ms]
//
// --long: the folder has the 10 KB, 100 KB and 1 MB memos and the 2,000-line checklist (memo-stress-data.py --long).
// --sample <file>: sample(1) of this process while the keys go into the biggest memo (or the top one).
// --ceiling: an open (↩) or the drawer's first open over it is listed and the run exits 1. --open-ceiling: the first
// open's own.
// --sample-open <file>: sample(1) of the drawer's first open and reopens (1 ms apart).
//
// Last (#217, measured in the app until #208): ↩ in the quick-write slip — a new memo — and the saves it sets off,
// memos.json and memo-folders.json, as the app's own timing lines tell them (PerfProbe, into a temporary log).

private func cpuMs() -> Double {
    var time = timespec()
    clock_gettime(CLOCK_THREAD_CPUTIME_ID, &time)
    return Double(time.tv_sec) * 1000 + Double(time.tv_nsec) / 1_000_000
}

/// This process's memory as Activity Monitor shows it (phys_footprint), as perf-probe's `mem` read it from the test copy.
private func footprintMB() -> Double {
    var info = rusage_info_v4()
    let result = withUnsafeMutablePointer(to: &info) { pointer in
        pointer.withMemoryRebound(to: rusage_info_t?.self, capacity: 1) { proc_pid_rusage(getpid(), RUSAGE_INFO_V4, $0) }
    }
    return result == 0 ? Double(info.ri_phys_footprint) / 1_048_576 : -1
}

private func views<T: NSView>(_ type: T.Type, in view: NSView) -> [T] {
    ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap { views(type, in: $0) }
}

@main
@MainActor
private enum DrawerBench {
    static func main() async throws {
        let args = CommandLine.arguments
        guard args.count > 1 else { print("usage: DrawerBench <folder> [--long] [--keys N] [--sample file] [--ceiling ms]"); exit(2) }
        let data = URL(fileURLWithPath: args[1])
        let long = args.contains("--long")
        let keys = args.firstIndex(of: "--keys").map { Int(args[$0 + 1])! } ?? 20
        let sampleFile = args.firstIndex(of: "--sample").map { args[$0 + 1] }
        /// --sample-memo STRESS-LONG-100K: which long memo is sampled (the 1 MB one otherwise).
        let sampleMemo = args.firstIndex(of: "--sample-memo").map { args[$0 + 1] }
        /// --sample-seconds 12: how long sample(1) runs from just before ↩ (the open, the keys, the catch-up and Esc).
        let sampleSeconds = args.firstIndex(of: "--sample-seconds").map { Double(args[$0 + 1])! } ?? Double(keys) * 0.13 + 8
        let ceiling = args.firstIndex(of: "--ceiling").map { Double(args[$0 + 1])! }
        /// --open-ceiling: the drawer's first open has its own (#3: 150 ms at 500 and 2,000 memos), else `--ceiling`.
        let openCeiling = args.firstIndex(of: "--open-ceiling").map { Double(args[$0 + 1])! } ?? ceiling
        var over: [String] = []
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)
        // As AppBench: no slips' motion (a window off every screen gets no frames to run an animation on, so a card
        // closing with one would stay half gone).
        SlipMotion.enabled = false
        try NotebookFile(url: data.appendingPathComponent("todos.json")).save(Notebook())
        let suite = "PaperTodo.DrawerBench.\(UUID())"
        let preferences = UserDefaults(suiteName: suite)!
        /// The run's own preferences go, file and all (also before `exit`, which skips a `defer`).
        func forgetPreferences() {
            preferences.removePersistentDomain(forName: suite)
            let file = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Preferences/\(suite).plist")
            try? FileManager.default.removeItem(at: file)
        }
        defer { forgetPreferences() }
        let model = AppModel(storageURL: data.appendingPathComponent("todos.json"), isolated: true, preferences: preferences)
        let drawer = model.drawer

        let size = NSSize(width: MemoDrawerView.shadowRoom + MemoDrawerView.tabsWidth + drawer.width, height: 900)
        let window = NSWindow(contentRect: NSRect(origin: NSPoint(x: -40_000, y: 0), size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        // The note beside it, as in the app (it hears every change of the memos).
        let note = NSWindow(contentRect: NSRect(x: -41_000, y: 0, width: 420, height: 640), styleMask: [.borderless], backing: .buffered, defer: false)
        note.isReleasedWhenClosed = false
        note.contentView = NSHostingView(rootView: PaperView(model: model).ignoresSafeArea())
        note.orderFrontRegardless()

        func pump(_ ms: Double) {
            let end = Date().addingTimeInterval(ms / 1000)
            while Date() < end { RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.002)) }
            window.displayIfNeeded()
            note.displayIfNeeded()
        }
        /// One step: the main thread's CPU for it and what follows within `within` ms.
        func step(within: Double = 60, _ action: () -> Void) -> Double {
            let start = cpuMs()
            action()
            pump(within)
            return cpuMs() - start
        }
        pump(300)
        let idle60 = (0..<5).map { _ in step {} }.sorted()[2]
        let idle300 = (0..<3).map { _ in step(within: 300) {} }.sorted()[1]
        func line(_ name: String, _ values: [Double]) -> String {
            let sorted = values.map { max(0, $0) }.sorted()
            guard !sorted.isEmpty else { return name + ": -" }
            let median = sorted.count % 2 == 1 ? sorted[sorted.count / 2] : (sorted[sorted.count / 2 - 1] + sorted[sorted.count / 2]) / 2
            let p95 = sorted[min(sorted.count - 1, max(0, Int((Double(sorted.count) * 0.95).rounded()) - 1))]
            return name.padding(toLength: 30, withPad: " ", startingAt: 0)
                + (sorted.count == 1 ? String(format: "%7.1f ms", sorted[0]) : String(format: "median %6.1f · p95 %6.1f · max %6.1f ms (%d)", median, p95, sorted.last!, sorted.count))
        }
        func check(_ name: String, _ value: Double, first: Bool = false) {
            guard let ceiling = first ? openCeiling : ceiling, value > ceiling else { return }
            over.append(String(format: "%@: %.1f ms (over %.0f)", name, value, ceiling))
        }

        print("memos \(model.memos.count) · idle 60 ms costs \(String(format: "%.2f", idle60)) ms CPU, 300 ms \(String(format: "%.2f", idle300))")

        // --sample-open <file>: sample(1) of the first open (and the reopens after it), to see where its time goes.
        var openProfile: Process?
        if let index = args.firstIndex(of: "--sample-open") {
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/sample")
            process.arguments = ["\(getpid())", "3", "1", "-file", args[index + 1]]
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try? process.run()
            pump(500)
            openProfile = process
        }
        // The drawer's first open: its view made (as the app's panel makes it), the list worked out and drawn.
        let first = step(within: 300) {
            drawer.willOpen()
            let hosting = NSHostingView(rootView: MemoDrawerView(drawer: drawer))
            hosting.sizingOptions = []
            window.contentView = hosting
            window.orderFrontRegardless()
        } - idle300
        print(line("drawer first open", [first]))
        check("drawer first open", first, first: true)
        var reopen: [Double] = []
        for _ in 0..<3 {
            _ = step(within: 200) { drawer.didClose(); window.orderOut(nil) }
            reopen.append(step(within: 300) { drawer.willOpen(); window.orderFrontRegardless() } - idle300)
        }
        print(line("drawer reopen", reopen))
        openProfile?.waitUntilExit()

        /// The open memo's text view (a card still sliding shut may have one too: the one with this memo's words).
        func editor(_ id: String) -> DrawerTextView.KeyTextView? {
            guard drawer.expandedID == id, let length = model.memos.first(where: { $0.id == id }).map({ ($0.text as NSString).length }) else { return nil }
            return views(DrawerTextView.KeyTextView.self, in: window.contentView!).first {
                $0.isEditable && $0.markdownOpen && ($0.textStorage?.length ?? -1) == length
            }
        }
        /// sample(1) of this process from now (↩, the keys, the list catching up and Esc), when asked for.
        func sampler(_ wanted: Bool) -> Process? {
            guard wanted, let sampleFile else { return nil }
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/sample")
            process.arguments = ["\(getpid())", "\(sampleSeconds)", "-file", sampleFile]
            process.standardOutput = FileHandle.nullDevice
            process.standardError = FileHandle.nullDevice
            try? process.run()
            pump(300)
            return process
        }
        /// ↩ on a memo: open, typing in it; then keys at its end; then Esc.
        func memo(_ name: String, _ id: String, sample: Bool) {
            drawer.selectedID = id
            pump(100)
            let profile = sampler(sample)
            let open = step(within: 300) { drawer.openSelected(); drawer.editing = true } - idle300
            var found = editor(id)
            let give = Date().addingTimeInterval(30)
            while found == nil, Date() < give { pump(100); found = editor(id) }
            guard let text = found else {
                let seen = views(DrawerTextView.KeyTextView.self, in: window.contentView!).map { "\($0.isEditable ? "e" : "-")\($0.markdownOpen ? "m" : "-") \($0.textStorage?.length ?? -1)" }
                print("  \(name): its text view wasn't found (↩ took \(Int(open)) ms; open \(drawer.expandedID ?? "none"), typing \(drawer.editing); text views: \(seen))")
                return
            }
            window.makeFirstResponder(text)
            text.setSelectedRange(NSRange(location: (text.string as NSString).length, length: 0))
            pump(200)
            let letters = Array("가나다라마바사아자차abcdefghij")
            var typed: [Double] = []
            for index in 0..<keys {
                let letter = String(letters[index % letters.count])
                typed.append(step { text.insertText(letter, replacementRange: NSRange(location: NSNotFound, length: 0)) } - idle60)
                pump(60) // 120 ms between keys, as the old perf-memo.sh typed
            }
            // The keys go to the model 250 ms after the last one: the list catches up.
            let handoff = step(within: 600) {} - idle300 * 2
            let close = step(within: 300) { _ = drawer.escape() } - idle300
            pump(300)
            profile?.waitUntilExit()
            print(line("  ↩ open \(name)", [open]))
            print(line("  typing in \(name)", typed))
            print(line("  the list after the keys", [handoff]))
            print(line("  Esc \(name)", [close]))
            check("↩ open \(name)", open)
        }
        if long {
            for (name, id) in [("10 KB", "STRESS-LONG-10K"), ("100 KB", "STRESS-LONG-100K"), ("1 MB", "STRESS-LONG-1024K")] {
                memo(name, id, sample: id == (sampleMemo ?? "STRESS-LONG-1024K"))
            }
            if let checklist = model.memos.first(where: { $0.id.hasPrefix("STRESS-CHECK-") }) {
                drawer.selectedID = checklist.id
                pump(100)
                let profile = sampler(sampleMemo == checklist.id)
                let open = step(within: 300) { drawer.openSelected() } - idle300
                pump(200)
                let close = step(within: 300) { _ = drawer.escape() } - idle300
                pump(300)
                profile?.waitUntilExit()
                print(line("  ↩ open 2,000-line checklist", [open]))
                print(line("  Esc checklist", [close]))
                check("↩ open checklist", open)
            }
        } else if let top = drawer.shown.first(where: { Checklist.lines($0.text).isEmpty }) {
            // ↓ through the list, 30 steps from the top as the old perf-memo.sh's keys were (#208): each picks the next
            // slip and scrolls to it.
            drawer.selectedID = drawer.shown.first?.id
            pump(200)
            var steps: [Double] = []
            for _ in 0..<30 {
                steps.append(step { drawer.moveSelection(1) } - idle60)
                pump(90) // 150 ms between keys, as it pressed them
            }
            print(line("↓ through the list", steps))
            memo("the top memo", top.id, sample: true)
        }
        print(String(format: "memory: footprint %.1f MB", footprintMB()))
        let saved = (try? String(contentsOf: data.appendingPathComponent("memos.json"), encoding: .utf8)) ?? ""
        print("saved after the keys: \(saved.contains("가나다라마바사아자차") ? "yes" : "no")")

        // ↩ in the quick-write slip, on a folder's tab (the new memo's place goes into memo-folders.json; the inbox's
        // memos have none): the words in the slip, then ↩ — a new memo, saved.
        if let folder = model.memos.lazy.map({ model.memoFolders.folderID(of: $0.id) }).first(where: { $0 != MemoFolders.inbox }) {
            drawer.show(.folder(folder))
        }
        let probeLog = FileManager.default.temporaryDirectory.appendingPathComponent("DrawerBench-\(UUID()).log")
        defer { try? FileManager.default.removeItem(at: probeLog) }
        PerfProbe.start(arguments: ["DrawerBench", "--perf-log", probeLog.path])
        drawer.quickText = "빠른 메모 하나"
        pump(200)
        let quick = step(within: 300) { drawer.quickWrite() } - idle300
        // The saves come after it (memo-folders.json off the main thread): up to 5 s for both lines.
        func saves() -> [String: String] {
            let lines = ((try? String(contentsOf: probeLog, encoding: .utf8)) ?? "").split(separator: "\n")
            var found: [String: String] = [:]
            for line in lines where line.hasPrefix("io ") {
                let parts = line.split(separator: " ")
                if parts.count == 3, found[String(parts[1])] == nil { found[String(parts[1])] = String(parts[2]) }
            }
            return found
        }
        let give = Date().addingTimeInterval(5)
        while Date() < give, saves()["memos"] == nil || saves()["memo-folders"] == nil { pump(100) }
        model.finishMemoFolderWrites()
        let written = saves()
        let added = ((try? String(contentsOf: data.appendingPathComponent("memos.json"), encoding: .utf8)) ?? "").contains("빠른 메모 하나")
        print(line("quick write ↩ (new memo)", [quick]))
        print("  saves: memos.json \(written["memos"] ?? "-") ms · memo-folders.json \(written["memo-folders"] ?? "-") ms · in memos.json: \(added ? "yes" : "no")")
        drawer.didClose()
        model.finishMemoFolderWrites()
        window.close()
        note.close()
        if !over.isEmpty {
            print("over the ceiling: " + over.joined(separator: " · "))
            forgetPreferences()
            exit(1)
        }
    }
}

private extension DrawerTextView.KeyTextView {
    /// An open memo's text view (the quick-write slip has no formatting).
    var markdownOpen: Bool { formats }
}
