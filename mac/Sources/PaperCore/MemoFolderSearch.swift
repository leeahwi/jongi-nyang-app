import Foundation

/// 메모 서랍's search (D12): kept apart from MemoFolders.swift so the backup's core (which reads and
/// merges memo-folders.json) doesn't need the note's search.
extension MemoFolders {
    // MARK: Search (D12)

    public struct Hit: Equatable, Sendable {
        public var memoID: String
        public var folderID: String
        /// The matching line (or the title when only the folder's name matched).
        public var text: String
        /// Where the query is in `text` (Search.match's scalar offsets); nil when the folder's name matched.
        public var range: Range<Int>?
    }

    /// The memos' lines made ready for searching, kept per memo text: the drawer searches again each time the keys
    /// of a query pause, and the lines of an unchanged memo are folded only once. Each memo's lines are
    /// `Search.foldKey`s of their NFC scalars (trimmed, as the search reads them), one after another, each followed
    /// by a break no query letter matches.
    public final class SearchIndex {
        static let lineBreak: UInt32 = .max
        fileprivate struct Entry: Sendable {
            var text: String
            var keys: [UInt32]
            /// Where each line is in `text` (the lines `split` makes).
            var lines: [Range<String.Index>]
        }
        private var entries: [String: Entry] = [:]

        public init() {}

        private func entry(_ memo: Memo) -> Entry {
            if let known = entries[memo.id], known.text == memo.text { return known }
            let made = Self.read(memo)
            entries[memo.id] = made
            return made
        }

        private static func read(_ memo: Memo) -> Entry {
            var keys: [UInt32] = [], lines: [Range<String.Index>] = []
            for line in memo.text.split(whereSeparator: \.isNewline) {
                keys += Search.scalars(line.trimmingCharacters(in: .whitespaces)).map(Search.foldKey)
                keys.append(Self.lineBreak)
                lines.append(line.startIndex..<line.endIndex)
            }
            return Entry(text: memo.text, keys: keys, lines: lines)
        }

        /// Memos read ahead, on any thread (the drawer reads them while the search field opens), for `take`.
        public struct Read: Sendable { fileprivate var entries: [String: Entry] }
        public static func read(_ memos: [Memo]) -> Read {
            Read(entries: Dictionary(memos.map { ($0.id, read($0)) }, uniquingKeysWith: { first, _ in first }))
        }

        /// Memos read ahead join the ones known (an entry is used only while its memo's text is the same).
        public func take(_ read: Read) {
            entries.merge(read.entries) { _, fresh in fresh }
        }

        /// A line of the memo as the search shows it (trimmed).
        func line(_ memo: Memo, _ index: Int) -> String {
            let known = entry(memo)
            return known.text[known.lines[index]].trimmingCharacters(in: .whitespaces)
        }

        /// Only the memos still there are kept (checked once there are a few more than them).
        public func keep(_ memos: [Memo]) {
            guard entries.count > memos.count + 64 else { return }
            let ids = Set(memos.map(\.id))
            entries = entries.filter { ids.contains($0.key) }
        }

        /// The first line with the query and where in it, as `Search.match` finds it line by line.
        func firstMatch(_ query: Search.Query, in memo: Memo) -> (line: Int, range: Range<Int>)? {
            let keys = entry(memo).keys, wanted = query.keys, count = wanted.count
            guard count > 0, keys.count >= count else { return nil }
            var line = 0, lineStart = 0
            var start = 0
            outer: while start <= keys.count - count {
                for offset in 0..<count {
                    let key = keys[start + offset]
                    if key == wanted[offset] { continue }
                    let initial = query.initials[offset]
                    // A key in the syllable table is the syllable itself (Search.foldKey).
                    if initial >= 0, (0xAC00...0xD7A3).contains(key), Int((key - 0xAC00) / 588) == initial { continue }
                    if keys[start] == Self.lineBreak { line += 1; lineStart = start + 1 }
                    start += 1
                    continue outer
                }
                return (line, (start - lineStart)..<(start - lineStart + count))
            }
            return nil
        }
    }

    /// Every folder, in the memos' order: the first matching line of each memo (the note's memo
    /// search, 초성 included); a memo whose own text doesn't match but whose folder's name does comes too.
    /// `index`: the lines of memos searched before, kept (the same results, sooner).
    public func search(_ query: String, memos: [Memo], language: AppLanguage = .ko, index: SearchIndex? = nil) -> [Hit] {
        let query = Search.Query(query)
        guard !query.isEmpty else { return [] }
        index?.keep(memos)
        var nameMatches: [String: Bool] = [:]
        return memos.compactMap { memo in
            let folderID = folderID(of: memo.id)
            if let index {
                if let found = index.firstMatch(query, in: memo) {
                    return Hit(memoID: memo.id, folderID: folderID, text: index.line(memo, found.line), range: found.range)
                }
            } else {
                for line in memo.text.split(whereSeparator: \.isNewline) {
                    let text = line.trimmingCharacters(in: .whitespaces)
                    if let range = Search.match(query, in: text) { return Hit(memoID: memo.id, folderID: folderID, text: text, range: range) }
                }
            }
            let named = nameMatches[folderID] ?? (folder(folderID).map { Search.match(query, in: $0.displayName(language)) != nil } ?? false)
            nameMatches[folderID] = named
            return named ? Hit(memoID: memo.id, folderID: folderID, text: Checklist.summary(memo.text, language: language).title, range: nil) : nil
        }
    }
}
