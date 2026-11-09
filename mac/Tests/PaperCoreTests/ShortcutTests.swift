import Foundation

// Keys from any app (GlobalShortcut.swift, #85): the cases S1–S14 shared with the Windows app (test/shortcuts.test.ts).
// Framework-free like the other core tests.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private let ctrlOpt = GlobalShortcut.control | GlobalShortcut.option
private let ctrlOptK = GlobalShortcut(keyCode: 40, modifiers: ctrlOpt, key: "K")
private let cmdShiftE = GlobalShortcut(keyCode: 14, modifiers: GlobalShortcut.command | GlobalShortcut.shift, key: "E")

private func data(_ key: GlobalShortcut) -> Data { try! JSONEncoder().encode(key) }

@main
private enum ShortcutTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        try test("S1–S3: the defaults and their caps") {
            try expect(GlobalShortcut.noteStandard.text == "⌃⌥J", "note default \(GlobalShortcut.noteStandard.text)")
            try expect(GlobalShortcut.drawerStandard.text == "⇧⌘D", "drawer default \(GlobalShortcut.drawerStandard.text)")
            try expect(GlobalShortcut.noteStandard.caps == ["⌃", "⌥", "J"], "note caps")
            let all = GlobalShortcut(keyCode: 1, modifiers: GlobalShortcut.command | GlobalShortcut.shift | ctrlOpt, key: "S")
            try expect(all.caps == ["⌃", "⌥", "⇧", "⌘", "S"], "Mac order \(all.caps)")
        }
        try test("S4: the note can't take 빠른 입력, 빠른 메모 or the drawer's key") {
            let note = GlobalShortcut.noteStandard
            try expect(ShortcutRules.taken(.quickEntry, by: .note, note: note, drawer: .drawerStandard) == .quickEntry, "⌃⌥N")
            try expect(ShortcutRules.taken(.quickMemo, by: .note, note: note, drawer: .drawerStandard) == .quickMemo, "⌃⌥M")
            try expect(ShortcutRules.taken(.drawerStandard, by: .note, note: note, drawer: .drawerStandard) == .drawer, "⇧⌘D")
            try expect(ShortcutRules.taken(cmdShiftE, by: .note, note: note, drawer: cmdShiftE) == .drawer, "the drawer's own key")
        }
        try test("S5: the drawer's default stays refused while the drawer has another key or is off") {
            try expect(ShortcutRules.taken(.drawerStandard, by: .note, note: .noteStandard, drawer: cmdShiftE) == .drawer, "moved")
            try expect(ShortcutRules.taken(.drawerStandard, by: .note, note: .noteStandard, drawer: nil) == .drawer, "off")
        }
        try test("S6: a free key, and the note's own key, are fine for the note") {
            try expect(ShortcutRules.taken(ctrlOptK, by: .note, note: .noteStandard, drawer: .drawerStandard) == nil, "⌃⌥K")
            try expect(ShortcutRules.taken(.noteStandard, by: .note, note: ctrlOptK, drawer: .drawerStandard) == nil, "back to ⌃⌥J")
            try expect(ShortcutRules.taken(ctrlOptK, by: .note, note: ctrlOptK, drawer: .drawerStandard) == nil, "its own key again")
        }
        try test("S7: the drawer can't take the note's key, chosen or default") {
            try expect(ShortcutRules.taken(.noteStandard, by: .drawer, note: ctrlOptK, drawer: nil) == .note, "⌃⌥J")
            try expect(ShortcutRules.taken(ctrlOptK, by: .drawer, note: ctrlOptK, drawer: nil) == .note, "⌃⌥K chosen")
            try expect(ShortcutRules.taken(.quickMemo, by: .drawer, note: ctrlOptK, drawer: nil) == .quickMemo, "⌃⌥M")
            try expect(ShortcutRules.taken(cmdShiftE, by: .drawer, note: ctrlOptK, drawer: .drawerStandard) == nil, "⇧⌘E free")
        }
        try test("S8: the same key under another name is the same key") {
            let renamed = GlobalShortcut(keyCode: 38, modifiers: ctrlOpt, key: "j")
            try expect(ShortcutRules.taken(renamed, by: .drawer, note: .noteStandard, drawer: nil) == .note, "renamed J")
            try expect(renamed.same(as: .noteStandard) && renamed != .noteStandard, "same, not equal")
        }
        try test("S9: a key needs ⌘, ⌃ or ⌥") {
            try expect(!GlobalShortcut(keyCode: 38, modifiers: GlobalShortcut.shift, key: "J").hasModifier, "⇧J")
            try expect(!GlobalShortcut(keyCode: 38, modifiers: 0, key: "J").hasModifier, "J")
            try expect(cmdShiftE.hasModifier && ctrlOptK.hasModifier, "⇧⌘E, ⌃⌥K")
        }
        try test("S10: nothing saved (before 1.45.1) is ⌃⌥J") {
            try expect(ShortcutRules.savedNote(nil, drawer: .drawerStandard) == .noteStandard, "missing")
            try expect(ShortcutRules.savedNote(Data(), drawer: .drawerStandard) == .noteStandard, "empty")
            try expect(ShortcutRules.savedNote(Data("{".utf8), drawer: .drawerStandard) == .noteStandard, "unreadable")
        }
        try test("S11: a saved key comes back, and a taken one falls back to ⌃⌥J") {
            try expect(ShortcutRules.savedNote(data(ctrlOptK), drawer: .drawerStandard) == ctrlOptK, "⌃⌥K kept")
            try expect(ShortcutRules.savedNote(data(cmdShiftE), drawer: cmdShiftE) == .noteStandard, "the drawer's key")
            try expect(ShortcutRules.savedNote(data(.quickEntry), drawer: nil) == .noteStandard, "⌃⌥N")
            try expect(ShortcutRules.savedNote(data(GlobalShortcut(keyCode: 40, modifiers: GlobalShortcut.shift, key: "K")), drawer: nil) == .noteStandard, "⇧K")
        }
        try test("S12: the JSON is the drawer's since 1.43") {
            let json = #"{"keyCode":2,"modifiers":768,"key":"D"}"#
            let read = try JSONDecoder().decode(GlobalShortcut.self, from: Data(json.utf8))
            try expect(read == .drawerStandard, "\(read)")
        }
        try test("S13: on screen hides, otherwise it comes forward") {
            try expect(NoteToggle.action(visible: true, minimized: false, folded: false, uncovered: true) == .hide, "on screen")
            try expect(NoteToggle.action(visible: false, minimized: false, folded: false, uncovered: false) == .bringForward, "hidden")
            try expect(NoteToggle.action(visible: false, minimized: false, folded: true, uncovered: false) == .bringForward, "folded")
            try expect(NoteToggle.action(visible: true, minimized: true, folded: false, uncovered: false) == .bringForward, "in the Dock")
        }
        try test("S14: covered by other windows comes forward; some of it showing hides") {
            try expect(NoteToggle.action(visible: true, minimized: false, folded: false, uncovered: false) == .bringForward, "covered")
            try expect(NoteToggle.action(visible: true, minimized: false, folded: true, uncovered: true) == .bringForward, "folded wins")
        }
        try test("S15 (#273): a note on 바탕화면에 두기 is taken for covered unless summoned, so the key brings it forward") {
            let desktop = NoteLayer.desktop
            try expect(!desktop.uncovered(occlusionVisible: true, summoned: false), "behind, showing a corner")
            try expect(desktop.uncovered(occlusionVisible: true, summoned: true), "summoned and showing")
            try expect(NoteLayer.normal.uncovered(occlusionVisible: true, summoned: false), "보통 as before")
            try expect(NoteToggle.action(visible: true, minimized: false, folded: false, uncovered: desktop.uncovered(occlusionVisible: true, summoned: false)) == .bringForward, "comes forward")
        }
        try test("L1 (#273): 노트 위치 as saved — the choice, else the pin's old switch (on: 항상 위에 두기), else 보통") {
            try expect(NoteLayer.saved("desktop", legacyOnTop: true) == .desktop, "the choice wins")
            try expect(NoteLayer.saved(nil, legacyOnTop: true) == .top, "1.48's pin on")
            try expect(NoteLayer.saved(nil, legacyOnTop: false) == .normal, "1.48's pin off")
            try expect(NoteLayer.saved("floating", legacyOnTop: false) == .normal, "unknown")
            try expect(NoteLayer.top.legacyOnTop && !NoteLayer.desktop.legacyOnTop && !NoteLayer.normal.legacyOnTop, "the old switch written beside it")
        }
        try test("L2 (#273): only 바탕화면에 두기 stays behind, and not while summoned") {
            try expect(NoteLayer.desktop.staysBehind(summoned: false), "desktop")
            try expect(!NoteLayer.desktop.staysBehind(summoned: true), "summoned")
            try expect(!NoteLayer.top.staysBehind(summoned: false) && !NoteLayer.normal.staysBehind(summoned: false), "the others")
        }
        print("\(count) shortcut tests passed")
    }
}
