import Foundation

/// #528: ↑ · ↓ in the input line bring back the lines put in before, newest first (shared/cases/input-history-cases.json,
/// the Windows app's core/inputHistory.ts). The walk starts only on an empty line and goes on while the line still shows
/// the line it brought back; once that is changed, ↑ · ↓ are the field's own again (the caret moves). Kept on this device.
public struct InputHistory: Equatable {
    public static let limit = 50
    /// Oldest first.
    public private(set) var entries: [String]
    /// The entry the line shows now (nil: not walking).
    private var index: Int?

    public init(entries: [String] = []) {
        self.entries = Array(entries.suffix(Self.limit))
    }

    /// A line was put in: the newest entry (the same line again moves up, kept once). Ends any walk.
    public mutating func add(_ line: String) {
        index = nil
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        entries.removeAll { $0 == trimmed }
        entries.append(trimmed)
        if entries.count > Self.limit { entries.removeFirst(entries.count - Self.limit) }
    }

    /// ↑ (`up`) or ↓ with the line holding `text`: the line's new text, or nil when the key is the field's own.
    public mutating func step(up: Bool, text: String) -> String? {
        if let at = index, at < entries.count, entries[at] == text {
            if up {
                index = max(0, at - 1)
                return entries[index!]
            }
            if at + 1 < entries.count {
                index = at + 1
                return entries[at + 1]
            }
            index = nil
            return ""
        }
        index = nil
        guard up, text.isEmpty, !entries.isEmpty else { return nil }
        index = entries.count - 1
        return entries[index!]
    }
}
