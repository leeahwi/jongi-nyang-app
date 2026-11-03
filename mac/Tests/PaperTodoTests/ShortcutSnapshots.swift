import AppKit
import PaperCore
import SwiftUI

/// #85 · #86: the shortcut list slip (the keys as they start; a note key of one's own with the drawer's off; scrolling
/// on a short screen) and 책상 → 꾸미기 → 빠른 입력 with the note's key row (at rest, listening, a refused key, a key of
/// one's own with ‘기본값’, off, held by another app).
extension DesignSnapshots {
    static func renderShortcuts(model: AppModel, output: URL) throws {
        let ownKey = GlobalShortcut(keyCode: 40, modifiers: GlobalShortcut.control | GlobalShortcut.option, key: "K")
        let standard = ShortcutList.groups(note: .noteStandard, drawer: .drawerStandard)
        try slip(ShortcutListSlip(groups: standard), to: output.appendingPathComponent("shortcut-list.png"))
        let custom = ShortcutList.groups(note: ownKey, drawer: nil)
        try slip(ShortcutListSlip(groups: custom), to: output.appendingPathComponent("shortcut-list-custom.png"))
        // A short screen (a 720-point-high display less the menu bar and the slip's margins): the groups scroll.
        try slip(ShortcutListSlip(groups: standard, scrollHeight: ShortcutListSlip.scrollHeight(standard, room: 420)),
                 to: output.appendingPathComponent("shortcut-list-scroll.png"))
        // #118: ⌘/ in the drawer — its two groups on a slip of their own.
        try slip(ShortcutListSlip(groups: ShortcutList.drawerGroups(), title: L("메모 서랍의 키"), footnote: false),
                 to: output.appendingPathComponent("shortcut-list-drawer.png"))

        func settings(_ view: some View) -> some View {
            view.environment(\.settingsTint, DeskPane.appearance.tint).frame(width: 640).padding(28).background(PaperTheme.paper)
        }
        let keptKey = model.noteShortcut
        let keptOn = model.noteHotKeyEnabled
        defer {
            model.noteShortcut = keptKey
            model.noteHotKeyEnabled = keptOn
            model.noteHotKeyRegistered = true
        }
        model.noteShortcut = .noteStandard
        model.noteHotKeyEnabled = true
        try render(settings(QuickEntrySettingsGroup(model: model)), size: nil, to: output.appendingPathComponent("shortcut-settings.png"))
        try render(settings(QuickEntrySettingsGroup(model: model, previewNoteRecording: true,
                                                    previewNoteProblem: ShortcutRules.refusal(.drawerStandard, for: .note, note: .noteStandard, drawer: .drawerStandard))),
                   size: nil, to: output.appendingPathComponent("shortcut-settings-refused.png"))
        model.noteShortcut = ownKey
        try render(settings(QuickEntrySettingsGroup(model: model)), size: nil, to: output.appendingPathComponent("shortcut-settings-custom.png"))
        model.noteHotKeyEnabled = false
        try render(settings(QuickEntrySettingsGroup(model: model)), size: nil, to: output.appendingPathComponent("shortcut-settings-off.png"))
        model.noteHotKeyEnabled = true
        model.noteHotKeyRegistered = false
        try render(settings(QuickEntrySettingsGroup(model: model)), size: nil, to: output.appendingPathComponent("shortcut-settings-taken.png"))
    }
}
