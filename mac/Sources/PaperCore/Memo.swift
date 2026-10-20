import Foundation

/// A free-form note on the back of the sheet. Kept in memos.json next to todos.json.
public struct Memo: Codable, Equatable, Identifiable, Sendable {
    public var id: String
    public var text: String
    public var createdAt: Date
    public var updatedAt: Date

    public init(id: String = UUID().uuidString, text: String = "", createdAt: Date = Date(), updatedAt: Date = Date()) {
        self.id = id
        self.text = text
        self.createdAt = createdAt
        self.updatedAt = updatedAt
    }

    public var isBlank: Bool { text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// The first non-empty line, used as the memo's name in the list.
    public var title: String { title(.ko) }

    /// An empty memo is "빈 메모", en "Empty note", nl "Lege notitie".
    public func title(_ language: AppLanguage) -> String {
        text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.first { !$0.isEmpty }
            ?? ["빈 메모", "Empty note", "Lege notitie"][language.index]
    }

    /// The next bit of text after the title, flattened to one line.
    public var preview: String {
        let lines = text.split(whereSeparator: \.isNewline).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return lines.dropFirst().joined(separator: " ")
    }
}

public enum MemoFile {
    private struct Contents: Codable { var memos: [Memo] }

    /// No file yet gives no memos; a file that can't be read throws, so it is never saved over.
    public static func load(_ url: URL) throws -> [Memo] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        return try decode(Data(contentsOf: url))
    }

    public static func decode(_ data: Data) throws -> [Memo] {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(Contents.self, from: data).memos
    }

    /// Returns what was written, so the app can tell its own file from another device's.
    @discardableResult
    public static func save(_ memos: [Memo], to url: URL) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let data = try encoder.encode(Contents(memos: memos))
        try data.write(to: url, options: .atomic)
        return data
    }

    /// Another device saved memos while this one had changes of its own (`base`: the file as
    /// this device last read or wrote it). Its memos are taken, except memos deleted here stay
    /// deleted and memos changed here keep this device's edits; a memo both changed gets both
    /// edits joined (TextMerge). Newest first. The same rule as the Windows app (mergeMemos).
    public static func merge(base: [Memo], here: [Memo], theirs: [Memo], changedHere: Set<String>, deletedHere: Set<String>) -> [Memo] {
        let start = Dictionary(base.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let other = Dictionary(theirs.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let kept = here.filter { changedHere.contains($0.id) }.map { memo -> Memo in
            guard let their = other[memo.id], their.text != memo.text else { return memo }
            var joined = memo
            joined.text = TextMerge.merge(base: start[memo.id]?.text ?? "", ours: memo.text, theirs: their.text)
            joined.updatedAt = max(memo.updatedAt, their.updatedAt)
            return joined
        }
        let others = theirs.filter { !changedHere.contains($0.id) && !deletedHere.contains($0.id) }
        return (others + kept).sorted { $0.updatedAt > $1.updatedAt }
    }
}
