import AppKit
import PaperCore
import SwiftUI

// 종이 테마 (#244, docs/plans/paper-themes.md 8-3 · W3): picking a paper redraws every open window once — between two light
// papers too, where no appearance change tells AppKit to — and nothing redraws while the app is idle. The windows are never
// shown (drawn to a bitmap, as the snapshots are), so nothing appears on screen. Sample data only; the notes are made up.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: Bool, _ message: String) throws {
    guard condition else { throw TestFailure(description: message) }
}

/// Counts its own redraws: its body reads one token, as every paper view does.
@MainActor
private enum Probe { static var bodies = 0 }

private struct ProbeView: View {
    var body: some View {
        Probe.bodies += 1
        return PaperTheme.card.frame(width: 40, height: 40)
    }
}

/// An AppKit view drawing with a colour it kept (as the drag ghost and the desk's window background do).
private final class KeptColorView: NSView {
    let color = NSColor(PaperTheme.paper)
    override func draw(_ dirtyRect: NSRect) {
        color.setFill()
        dirtyRect.fill()
    }
}

@main
@MainActor
private enum PaperThemeRedrawTests {
    static func main() throws {
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.prohibited)
        HandwritingFont.register()
        SlipMotion.enabled = false
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }

        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("PaperThemes-\(UUID())")
        let suite = TestDefaults("PaperThemes")
        let preferences = suite.defaults
        defer {
            suite.remove()
            try? FileManager.default.removeItem(at: folder)
        }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        preferences.set(false, forKey: "reminder.enabled")
        var notebook = Notebook()
        _ = notebook.add("창문 열고, 커피 한 잔")
        _ = notebook.add("미뤄 둔 책 10쪽 읽기")
        let storage = folder.appendingPathComponent("todos.json")
        try NotebookFile(url: storage).save(notebook)
        let model = AppModel(storageURL: storage, isolated: true, preferences: preferences)
        model.paperColor = .day
        model.paperTheme = .day
        model.paperNight = .night

        // Four windows, never ordered in: the note, the desk calendar, the drawer and an AppKit view with a kept colour.
        var windows: [NSWindow] = []
        func window(_ view: NSView, _ size: NSSize) -> NSView {
            let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
            window.isReleasedWhenClosed = false
            window.contentView = view
            view.frame = NSRect(origin: .zero, size: size)
            windows.append(window)
            return view
        }
        let note = window(NSHostingView(rootView: PaperView(model: model)), NSSize(width: 420, height: 560))
        let calendar = window(NSHostingView(rootView: CalendarWindowView(model: model)), NSSize(width: 760, height: 560))
        let drawer = window(NSHostingView(rootView: MemoDrawerView(drawer: model.drawer).frame(width: 320, height: 560)), NSSize(width: 320, height: 560))
        let kept = window(KeptColorView(), NSSize(width: 60, height: 60))
        let probe = window(NSHostingView(rootView: ProbeView()), NSSize(width: 40, height: 40))
        func settle() { RunLoop.main.run(until: Date().addingTimeInterval(0.25)) }
        settle()

        /// The colour at a point (from the top left), as sRGB 0–255.
        func pixel(_ view: NSView, _ x: CGFloat, _ y: CGFloat) -> [Double] {
            view.layoutSubtreeIfNeeded()
            let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds)!
            view.cacheDisplay(in: view.bounds, to: bitmap)
            let scale = CGFloat(bitmap.pixelsWide) / view.bounds.width
            let color = bitmap.colorAt(x: Int(x * scale), y: Int(y * scale))!.usingColorSpace(.sRGB)!
            return [color.redComponent, color.greenComponent, color.blueComponent].map { Double($0) * 255 }
        }
        func distance(_ a: [Double], _ hex: String) -> Double {
            let b = DrawerPalette.rgb(hex)!
            return sqrt(zip(a, b).map { ($0 - $1) * ($0 - $1) }.reduce(0, +))
        }
        /// Closer to the new paper's colour than to the old one's.
        func shows(_ view: NSView, at point: (CGFloat, CGFloat), _ new: String, not old: String, _ name: String) throws {
            let seen = pixel(view, point.0, point.1)
            try expect(distance(seen, new) < distance(seen, old), "\(name): \(seen.map { Int($0) }) is nearer \(old) than \(new)")
        }
        // Where each window shows its paper: the note's sheet under the rows, a day in the month's card, the drawer's paper
        // beside the bookmarks, the kept colour.
        let notePoint: (CGFloat, CGFloat) = (406, 380), calendarPoint: (CGFloat, CGFloat) = (250, 200), drawerPoint: (CGFloat, CGFloat) = (280, 340)

        try test("8-3 a light paper to another light paper redraws every open window (낮 종이 → 모눈 노트 → 노란 메모지 → 하늘색 줄노트: papers without grain, so a pixel shows its colour)") {
            for (from, to) in [(PaperKind.day, PaperKind.grid), (.grid, .memo), (.memo, .lined)] {
                let old = NotePalette.of(from), new = NotePalette.of(to)
                model.paperTheme = to
                settle()
                try expect(NSApp.appearance?.name == .aqua, "낮 · 밤 낮 with a light paper: light controls")
                try shows(note, at: notePoint, new.paper, not: old.paper, "note \(from) → \(to)")
                try shows(calendar, at: calendarPoint, new.card, not: old.card, "calendar (a day's card) \(from) → \(to)")
                try shows(drawer, at: drawerPoint, hex(.init(to)), not: hex(.init(from)), "drawer \(from) → \(to)")
                try shows(kept, at: (30, 30), new.paper, not: old.paper, "a colour AppKit kept \(from) → \(to)")
            }
        }

        try test("3-1 a dark paper turns the system controls dark by day, and back") {
            model.paperTheme = .chalk
            settle()
            try expect(NSApp.appearance?.name == .darkAqua, "칠판: dark controls, got \(String(describing: NSApp.appearance?.name))")
            try shows(note, at: notePoint, NotePalette.chalk.paper, not: NotePalette.lined.paper, "note → 칠판")
            model.paperTheme = .kraft
            model.paperNight = .keep
            settle()
            try expect(NSApp.appearance?.name == .aqua, "크라프트지 kept at night: light controls")
            model.paperNight = .night
            model.paperColor = .auto
            settle()
            try expect(NSApp.appearance == nil, "자동 with a light paper and 밤 종이 at night: the system's look")
            model.paperColor = .day
            settle()
        }

        try test("W3 one paper change redraws a view once; nothing redraws while idle") {
            settle()
            let before = Probe.bodies
            RunLoop.main.run(until: Date().addingTimeInterval(1))
            try expect(Probe.bodies == before, "idle: \(Probe.bodies - before) redraws")
            let revision = PaperLook.shared.revision
            model.paperTheme = .memo
            settle()
            try expect(PaperLook.shared.revision == revision + 1, "one change of colours")
            try expect(Probe.bodies == before + 1, "the probe redrew \(Probe.bodies - before) times")
            RunLoop.main.run(until: Date().addingTimeInterval(1))
            try expect(Probe.bodies == before + 1, "after: \(Probe.bodies - before - 1) more")
            // Picking the same paper again draws nothing.
            model.paperTheme = .memo
            settle()
            try expect(Probe.bodies == before + 1, "the same paper again redrew")
            _ = probe
        }

        try test("D the drawer follows the note, or keeps its own paper with 노트와 같은 종이 off") {
            model.drawer.sameAsNote = false
            model.drawer.theme = .grid
            settle()
            try shows(drawer, at: drawerPoint, hex(.grid), not: hex(.memo), "own paper")
            model.drawer.sameAsNote = true
            settle()
            try shows(drawer, at: drawerPoint, hex(.memo), not: hex(.grid), "the note's again")
        }

        try test("이 메모의 종이 offers the fifteen papers in the tiles' order, after 서랍과 같게 (as the Windows app's memoPapers)") {
            try expect(MemoFolders.Paper.allCases.map(\.rawValue) == PaperKind.allCases.map(\.rawValue), "memo papers \(MemoFolders.Paper.allCases)")
            try expect(MemoFolders.Paper.allCases.allSatisfy { DrawerPalette.Kind(rawValue: $0.rawValue) != nil }, "every memo paper has a drawer palette")
        }

        for window in windows { window.close() }
        print("\(count) paper redraw checks passed")
    }

    /// The drawer's paper colour as written.
    static func hex(_ kind: DrawerPalette.Kind) -> String {
        let source = try! String(contentsOfFile: "Sources/PaperTodo/MemoDrawerTheme.swift", encoding: .utf8)
        let block = source.components(separatedBy: "static let \(kind.rawValue) = DrawerPalette(")[1]
        return String(block.components(separatedBy: "paper: pair(\"")[1].prefix(7))
    }
}
