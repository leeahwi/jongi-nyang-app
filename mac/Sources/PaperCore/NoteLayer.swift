import Foundation

/// 노트 위치 (#273): where the note sits among the other windows — 보통 (an ordinary window), 항상 위에 두기 (floating
/// over them) or 바탕화면에 두기 (on the desktop under them, as a widget). The same three as Windows (core/stayBehind.ts).
public enum NoteLayer: String, CaseIterable, Sendable {
    case normal, top, desktop

    /// As saved: `noteLayer` since #273; before it, the pin's switch `alwaysOnTop` (on: 항상 위에 두기). The switch is
    /// still written beside the choice, so an older version keeps 항상 위에 두기 (and reads 바탕화면에 두기 as 보통).
    public static func saved(_ raw: String?, legacyOnTop: Bool) -> NoteLayer {
        raw.flatMap(NoteLayer.init(rawValue:)) ?? (legacyOnTop ? .top : .normal)
    }

    /// The pin's old switch, written beside the choice.
    public var legacyOnTop: Bool { self == .top }

    /// 바탕화면에 두기 stays under the other windows, except while it was summoned (the note's key, the menu bar, the
    /// Dock) and still has the keyboard: then it is an ordinary window until another window is clicked.
    public func staysBehind(summoned: Bool) -> Bool { self == .desktop && !summoned }

    /// The note's key: a note kept behind is taken for covered unless it was summoned (so the key brings it forward
    /// instead of putting it away).
    public func uncovered(occlusionVisible: Bool, summoned: Bool) -> Bool { occlusionVisible && !staysBehind(summoned: summoned) }
}
