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

    /// Every folder, in the memos' order: the first matching line of each memo (the note's memo
    /// search, 초성 included); a memo whose own text doesn't match but whose folder's name does comes too.
    public func search(_ query: String, memos: [Memo], language: AppLanguage = .ko) -> [Hit] {
        guard !Search.cleanQuery(query).isEmpty else { return [] }
        var nameMatches: [String: Bool] = [:]
        return memos.compactMap { memo in
            let folderID = folderID(of: memo.id)
            for line in memo.text.split(whereSeparator: \.isNewline) {
                let text = line.trimmingCharacters(in: .whitespaces)
                if let range = Search.match(query, in: text) { return Hit(memoID: memo.id, folderID: folderID, text: text, range: range) }
            }
            let named = nameMatches[folderID] ?? (folder(folderID).map { Search.match(query, in: $0.displayName(language)) != nil } ?? false)
            nameMatches[folderID] = named
            return named ? Hit(memoID: memo.id, folderID: folderID, text: Checklist.summary(memo.text, language: language).title, range: nil) : nil
        }
    }
}
