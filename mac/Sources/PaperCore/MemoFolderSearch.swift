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
            /// The words without marks (#84), which the lines are in.
            var plain: String
            var keys: [UInt32]
            /// Where each line is in `plain` (the lines `split` makes).
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
            let plain = MemoMarkdown.plain(memo.text)
            for line in plain.split(whereSeparator: \.isNewline) {
                keys += Search.scalars(line.trimmingCharacters(in: .whitespaces)).map(Search.foldKey)
                keys.append(Self.lineBreak)
                lines.append(line.startIndex..<line.endIndex)
            }
            return Entry(text: memo.text, plain: plain, keys: keys, lines: lines)
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
            return known.plain[known.lines[index]].trimmingCharacters(in: .whitespaces)
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
    /// `keep`: only these memos are looked at (the lines of the others stay known for the next search).
    public func search(_ query: String, memos: [Memo], language: AppLanguage = .ko, index: SearchIndex? = nil, where keep: ((Memo) -> Bool)? = nil) -> [Hit] {
        let query = Search.Query(query)
        guard !query.isEmpty else { return [] }
        index?.keep(memos)
        var nameMatches: [String: Bool] = [:]
        return memos.compactMap { memo in
            if let keep, !keep(memo) { return nil }
            let folderID = folderID(of: memo.id)
            if let index {
                if let found = index.firstMatch(query, in: memo) {
                    return Hit(memoID: memo.id, folderID: folderID, text: index.line(memo, found.line), range: found.range)
                }
            } else {
                for line in MemoMarkdown.plain(memo.text).split(whereSeparator: \.isNewline) {
                    let text = line.trimmingCharacters(in: .whitespaces)
                    if let range = Search.match(query, in: text) { return Hit(memoID: memo.id, folderID: folderID, text: text, range: range) }
                }
            }
            let named = nameMatches[folderID] ?? (folder(folderID).map { Search.match(query, in: $0.displayName(language)) != nil } ?? false)
            nameMatches[folderID] = named
            return named ? Hit(memoID: memo.id, folderID: folderID, text: MemoMarkdown.title(memo.text, language: language), range: nil) : nil
        }
    }

    // MARK: Results by folder, scope and filters (#114, B1)

    /// The kinds of memo the search can keep to (chips under the field): 체크 남음 (a checklist line not ticked yet), 링크
    /// (a web address anywhere, written or as a markdown link), 고정. Several at once keep the memos that are all of them.
    public struct SearchFilters: OptionSet, Hashable, Sendable {
        public let rawValue: Int
        public init(rawValue: Int) { self.rawValue = rawValue }
        public static let open = SearchFilters(rawValue: 1)
        public static let link = SearchFilters(rawValue: 2)
        public static let pinned = SearchFilters(rawValue: 4)
        /// The names the shared cases use: "open", "link", "pinned".
        public init(names: [String]) {
            self = names.reduce(into: []) { set, name in
                switch name {
                case "open": set.insert(.open)
                case "link": set.insert(.link)
                case "pinned": set.insert(.pinned)
                default: break
                }
            }
        }
    }

    /// One folder's results: its hits in the memos' order.
    public struct HitGroup: Equatable, Sendable {
        public var folderID: String
        public var hits: [Hit]
    }

    /// 메모 찾기 (#114): `scope` nil looks in every folder, a tab only there (a folder, or 고정's pinned memos). The memos
    /// are kept to `filters`, then searched as `search` does; with no query the filters alone pick them (each with its
    /// title, nothing marked), and with neither there is nothing. The hits come in groups, one per folder, the folders in
    /// the order their first hit comes (the newest first), each group's hits in the memos' order. The shared cases
    /// in docs/plans/drawer-search-cases.json (Windows: drawerFind).
    public func find(_ query: String, memos: [Memo], scope: Tab?, filters: SearchFilters, language: AppLanguage = .ko,
                     index: SearchIndex? = nil, isOpen: ((Memo) -> Bool)? = nil, hasLink: ((Memo) -> Bool)? = nil) -> [HitGroup] {
        let typed = !Search.Query(query).isEmpty
        guard typed || !filters.isEmpty else { return [] }
        let everywhere = scope == nil && filters.isEmpty
        func allowed(_ memo: Memo) -> Bool {
            switch scope {
            case .folder(let id)?: if folderID(of: memo.id) != id { return false }
            case .pinned?: if !isPinned(memo.id) { return false }
            case nil: break
            }
            if filters.contains(.pinned), !isPinned(memo.id) { return false }
            if filters.contains(.open), !(isOpen?(memo) ?? Self.hasOpenBox(memo.text)) { return false }
            if filters.contains(.link), !(hasLink?(memo) ?? MemoCards.hasLink(memo.text)) { return false }
            return true
        }
        let hits = typed
            ? search(query, memos: memos, language: language, index: index, where: everywhere ? nil : allowed)
            : memos.filter(allowed).map { Hit(memoID: $0.id, folderID: folderID(of: $0.id), text: MemoMarkdown.title($0.text, language: language), range: nil) }
        var groups: [HitGroup] = [], at: [String: Int] = [:]
        for hit in hits {
            if let index = at[hit.folderID] {
                groups[index].hits.append(hit)
            } else {
                at[hit.folderID] = groups.count
                groups.append(HitGroup(folderID: hit.folderID, hits: [hit]))
            }
        }
        return groups
    }

    /// 체크 남음: a checklist line not ticked yet.
    public static func hasOpenBox(_ text: String) -> Bool { Checklist.lines(text).contains { !$0.checked } }

    /// The found line as a result shows it (#114): a match far into a long line is brought near the start — cut 8
    /// letters before it (at the first space there, so a word isn't halved) with "…" in front, its range moved with it;
    /// a match within the first 16 letters leaves the line as it is. The end is cut by the result's own lines. Letters
    /// are Unicode scalars of the NFC text (as `range` counts them). The shared cases P1….
    public static func snippet(_ text: String, range: Range<Int>?) -> (text: String, range: Range<Int>?) {
        guard let range else { return (text, nil) }
        let scalars = Array(text.precomposedStringWithCanonicalMapping.unicodeScalars)
        guard range.lowerBound > 16, range.upperBound <= scalars.count else { return (text, range) }
        var cut = range.lowerBound - 8
        if let space = scalars[cut..<range.lowerBound].firstIndex(where: { $0 == " " }) { cut = space + 1 }
        let shown = "…" + String(String.UnicodeScalarView(scalars[cut...]))
        return (shown, (range.lowerBound - cut + 1)..<(range.upperBound - cut + 1))
    }
}
