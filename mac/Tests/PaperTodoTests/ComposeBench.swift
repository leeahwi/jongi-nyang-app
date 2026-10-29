import AppKit
import Combine
import PaperCore
import SwiftUI

// 메모 서랍, Korean typed the way the input method types it (docs/perf-memo-stress.md): the drawer in a window off
// every screen, a memo open in a short folder on 모눈 노트, and its text view sent what the IME sends — marked
// text for each jamo (ㅎ → 하 → 한), then the syllable committed. Per step: the main thread's CPU time for the key
// and everything it set off (SwiftUI's update, layout, drawing the window), and whether the memo list or the save
// moved. Finished characters (insertText) are timed the same way.
//
//   ComposeBench <folder made by memo-stress-data.py> [--rounds N]

private func cpuMs() -> Double {
    var time = timespec()
    clock_gettime(CLOCK_THREAD_CPUTIME_ID, &time)
    return Double(time.tv_sec) * 1000 + Double(time.tv_nsec) / 1_000_000
}

private func views<T: NSView>(_ type: T.Type, in view: NSView) -> [T] {
    ((view as? T).map { [$0] } ?? []) + view.subviews.flatMap { views(type, in: $0) }
}

@main
@MainActor
private enum ComposeBench {
    static func main() async throws {
        let args = CommandLine.arguments
        guard args.count > 1 else { print("usage: ComposeBench <folder> [--rounds N]"); exit(2) }
        let data = URL(fileURLWithPath: args[1])
        let rounds = args.firstIndex(of: "--rounds").map { Int(args[$0 + 1])! } ?? 3
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.accessory)
        try NotebookFile(url: data.appendingPathComponent("todos.json")).save(Notebook())
        let suite = "PaperTodo.ComposeBench.\(UUID())"
        let preferences = UserDefaults(suiteName: suite)!
        defer { preferences.removePersistentDomain(forName: suite) }
        let model = AppModel(storageURL: data.appendingPathComponent("todos.json"), isolated: true, preferences: preferences)
        let drawer = model.drawer
        drawer.theme = .grid
        drawer.willOpen()

        // A short folder (the fewest memos, at least three), its newest memo open for typing.
        var counts: [String: Int] = [:]
        for memo in model.memos { counts[model.memoFolders.folderID(of: memo.id), default: 0] += 1 }
        let folder = counts.filter { $0.value >= 3 && $0.key != MemoFolders.inbox }.min { $0.value < $1.value }?.key ?? MemoFolders.inbox
        drawer.show(.folder(folder))
        guard let target = drawer.shown.first(where: { Checklist.lines($0.text).isEmpty }) ?? drawer.shown.first else { print("no memo"); exit(1) }

        let window = NSWindow(contentRect: NSRect(x: -20_000, y: 0, width: MemoDrawerView.shadowRoom + MemoDrawerView.tabsWidth + 300, height: 820),
                              styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(rootView: MemoDrawerView(drawer: drawer))
        window.orderFrontRegardless()
        // The note beside it, as in the app (it hears every change of the memos).
        let note = NSWindow(contentRect: NSRect(x: -21_000, y: 0, width: 420, height: 640), styleMask: [.borderless], backing: .buffered, defer: false)
        note.isReleasedWhenClosed = false
        note.contentView = NSHostingView(rootView: PaperView(model: model).ignoresSafeArea())
        note.orderFrontRegardless()
        func settle(_ seconds: Double) {
            let end = Date().addingTimeInterval(seconds)
            while Date() < end { RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.002)) }
            window.displayIfNeeded()
        }
        settle(0.5)
        drawer.edit(target.id)
        settle(0.6)
        guard let text = views(DrawerTextView.KeyTextView.self, in: window.contentView!).first(where: { $0.isEditable && $0.string == target.text }) else {
            print("the open memo's text view wasn't found"); exit(1)
        }
        window.makeFirstResponder(text)
        text.setSelectedRange(NSRange(location: (text.string as NSString).length, length: 0))
        settle(0.3)

        var listChanges = 0, textChanges = 0
        let watch = model.$memos.dropFirst().sink { _ in listChanges += 1 }
        defer { watch.cancel() }
        let observer = NotificationCenter.default.addObserver(forName: NSText.didChangeNotification, object: text, queue: nil) { _ in
            MainActor.assumeIsolated { textChanges += 1 }
        }
        defer { NotificationCenter.default.removeObserver(observer) }

        /// One key: the CPU the main thread spends on it and on what follows within 60 ms (the drawer's list and the
        /// save wait longer than that, and are counted separately).
        func key(_ action: () -> Void) -> Double {
            let start = cpuMs()
            action()
            let end = Date().addingTimeInterval(0.06)
            while Date() < end { RunLoop.main.run(mode: .default, before: Date().addingTimeInterval(0.002)) }
            window.displayIfNeeded()
            note.displayIfNeeded()
            return cpuMs() - start
        }
        // An idle 60 ms, to take away.
        let idle = (0..<5).map { _ in key {} }.sorted()[2]

        // 한글 입력 as two-set Korean types it: each jamo replaces the marked syllable; a jamo that can't join commits it.
        let syllables: [[String]] = [["ㅎ", "하", "한"], ["ㄱ", "그", "글"], ["ㅇ", "이", "입"], ["ㄹ", "려", "력"]]
        var composing: [Double] = [], committing: [Double] = [], plain: [Double] = []
        var changesWhileComposing = 0, textChangesWhileComposing = 0
        for _ in 0..<rounds {
            for syllable in syllables {
                for (index, marked) in syllable.enumerated() {
                    let before = listChanges, textBefore = textChanges
                    composing.append(key {
                        text.setMarkedText(marked, selectedRange: NSRange(location: (marked as NSString).length, length: 0),
                                           replacementRange: NSRange(location: NSNotFound, length: 0))
                        // As when the text view reports the marked syllable as a change (the input method's path).
                        text.didChangeText()
                    } - idle)
                    changesWhileComposing += listChanges - before
                    textChangesWhileComposing += textChanges - textBefore
                    _ = index
                }
                committing.append(key { text.insertText(syllable.last!, replacementRange: NSRange(location: NSNotFound, length: 0)) } - idle)
            }
            for letter in "abcdefgh" { plain.append(key { text.insertText(String(letter), replacementRange: NSRange(location: NSNotFound, length: 0)) } - idle) }
        }
        settle(1.0)
        print("the memo now ends: …\(String(text.string.suffix(24)).debugDescription), marked \(text.hasMarkedText()), key window \(window.isKeyWindow), first responder \(window.firstResponder === text)")
        func line(_ name: String, _ values: [Double]) {
            let sorted = values.map { max(0, $0) }.sorted()
            let median = sorted[sorted.count / 2], p95 = sorted[min(sorted.count - 1, Int(Double(sorted.count) * 0.95))]
            print(name.padding(toLength: 34, withPad: " ", startingAt: 0) + String(format: "median %6.2f · p95 %6.2f · max %6.2f ms (%d)", median, p95, sorted.last!, sorted.count))
        }
        note.close()
        print("memos \(model.memos.count) · folder \(counts[folder] ?? 0) memos · paper grid · idle 60 ms costs \(String(format: "%.2f", idle)) ms CPU")
        line("composing (marked jamo)", composing)
        line("committing a syllable", committing)
        line("finished letters", plain)
        print("while composing: the text view said it changed \(textChangesWhileComposing) times, the memo list changed \(changesWhileComposing) times")
        let file = (try? String(contentsOf: data.appendingPathComponent("memos.json"), encoding: .utf8)) ?? ""
        print("saved after the keys: \(file.contains("한글입력") ? "yes" : "no") · a lone jamo saved: \(["ㅎ\"", "하\"", "ㄱ\"", "그\""].contains { file.contains("abcdefgh" + $0) || file.contains("한글입력" + $0) } ? "yes" : "no")")
        window.close()
    }
}
