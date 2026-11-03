import Foundation

// Keys from any app (#85): the note's 보이기 · 숨기기 and the drawer's 열고 닫기 can be changed, 빠른 입력 ⌃⌥N and 빠른
// 메모 ⌃⌥M can't. Which keys each may take, and when the note's key hides it. Same rules and cases as the Windows app
// (windows/src/core/shortcuts.ts, test/shortcuts.test.ts).

/// A key from any app: a Carbon key code and Carbon modifier bits, with the key's name for showing. The bits are
/// Carbon's own (cmdKey 0x100, shiftKey 0x200, optionKey 0x800, controlKey 0x1000), written out so the core needs no
/// Carbon. Saved as JSON {keyCode, modifiers, key}: the drawer's key has been kept like that since 1.43.
public struct GlobalShortcut: Equatable, Codable, Sendable {
    public var keyCode: Int
    public var modifiers: Int
    public var key: String

    public init(keyCode: Int, modifiers: Int, key: String) {
        self.keyCode = keyCode
        self.modifiers = modifiers
        self.key = key
    }

    public static let command = 0x100
    public static let shift = 0x200
    public static let option = 0x800
    public static let control = 0x1000

    /// ⌃⌥N 빠른 입력 and ⌃⌥M 빠른 메모: fixed.
    public static let quickEntry = GlobalShortcut(keyCode: 45, modifiers: control | option, key: "N")
    public static let quickMemo = GlobalShortcut(keyCode: 46, modifiers: control | option, key: "M")
    /// ⌃⌥J 노트 보이기 · 숨기기 and ⇧⌘D 메모 서랍: where they start, and what ‘기본값’ brings back.
    public static let noteStandard = GlobalShortcut(keyCode: 38, modifiers: control | option, key: "J")
    public static let drawerStandard = GlobalShortcut(keyCode: 2, modifiers: command | shift, key: "D")

    /// The modifiers in the Mac's order (⌃⌥⇧⌘), then the key: one key cap each.
    public var caps: [String] {
        var out: [String] = []
        if modifiers & Self.control != 0 { out.append("⌃") }
        if modifiers & Self.option != 0 { out.append("⌥") }
        if modifiers & Self.shift != 0 { out.append("⇧") }
        if modifiers & Self.command != 0 { out.append("⌘") }
        return out + [key]
    }

    /// "⌃⌥J".
    public var text: String { caps.joined() }

    /// A key from any app needs ⌘, ⌃ or ⌥ (⇧ alone isn't enough).
    public var hasModifier: Bool { modifiers & (Self.command | Self.control | Self.option) != 0 }

    /// The same key, whatever its name says.
    public func same(as other: GlobalShortcut) -> Bool { keyCode == other.keyCode && modifiers == other.modifiers }
}

/// Who holds a key from any app.
public enum ShortcutUser: String, Sendable, CaseIterable {
    case quickEntry, quickMemo, note, drawer
}

public enum ShortcutRules {
    /// Who already has `key` when `user` asks for it, or nil when it's free. 빠른 입력 and 빠른 메모 always hold theirs;
    /// the note and the drawer never take each other's chosen key, nor each other's default (so ‘기본값’ always works).
    /// `note` is the note's chosen key (kept while its switch is off); `drawer` the drawer's (nil: off).
    public static func taken(_ key: GlobalShortcut, by user: ShortcutUser, note: GlobalShortcut, drawer: GlobalShortcut?) -> ShortcutUser? {
        if key.same(as: .quickEntry) { return .quickEntry }
        if key.same(as: .quickMemo) { return .quickMemo }
        switch user {
        case .note:
            if key.same(as: .drawerStandard) || drawer.map(key.same(as:)) == true { return .drawer }
        case .drawer:
            if key.same(as: .noteStandard) || key.same(as: note) { return .note }
        case .quickEntry, .quickMemo:
            break
        }
        return nil
    }

    /// The note's key as saved: what was chosen, or ⌃⌥J when nothing was (before 1.45.1), it can't be read, or
    /// another holds it now.
    public static func savedNote(_ data: Data?, drawer: GlobalShortcut?) -> GlobalShortcut {
        guard let data, let key = try? JSONDecoder().decode(GlobalShortcut.self, from: data), key.hasModifier, !key.key.isEmpty,
              taken(key, by: .note, note: .noteStandard, drawer: drawer) == nil else { return .noteStandard }
        return key
    }
}

/// What the note's key does (#85): the note on screen goes away at once, even with another app in front; otherwise it
/// comes forward (unfolded from the sticky note). On screen: shown, not in the Dock, not folded into the sticky note,
/// and some of it not covered by other windows (macOS's occlusion state).
public enum NoteToggle: Equatable, Sendable {
    case hide, bringForward

    public static func action(visible: Bool, minimized: Bool, folded: Bool, uncovered: Bool) -> NoteToggle {
        visible && !minimized && !folded && uncovered ? .hide : .bringForward
    }
}
