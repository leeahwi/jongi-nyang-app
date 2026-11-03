import Foundation

/// 지운 메모 (#120, docs/plans/drawer-ux-plan.md B3): a deleted memo is kept 30 days in memo-trash.json next to memos.json
/// — out of memos.json, so an older app (or another device's) never shows it again — with the folder, pin and paper it
/// had, to go back there. The same file, rules and shared cases (docs/plans/drawer-trash-cases.json) as the Windows app
/// (core/memoTrash.ts):
///
///     { "v": 1,
///       "memos": [{ "id": "…", "text": "…", "createdAt": "…", "updatedAt": "…", "deletedAt": "…", "folder": "work",
///                   "pinned": false, "paper": "night" }, …],          newest deleted first, then by id
///       "emptiedAt": "…",                                               when 모두 비우기 was last pressed (else no key)
///       "updatedAt": "…" }
///
/// Two devices sharing the folder (T-cases): the copies join by memo id, the later `deletedAt` winning (a tie keeps this
/// device's); 모두 비우기 is `emptiedAt`, the later of the two, and takes every entry deleted at or before it, so emptied
/// memos don't come back from the other copy while one deleted after it, elsewhere, stays. A memo that is in memos.json
/// is alive: its entry goes (restored elsewhere, or written to again by another device after it was deleted here — an
/// edit is never hidden). Entries 30 days old go when the file is saved, `emptiedAt` too. Keys this version doesn't know
/// are kept (D18). The file is the drawer's alone: the AI connection reads memos.json only.
public struct MemoTrash: Equatable, Sendable {
    public static let fileName = "memo-trash.json"
    /// How long a deleted memo is kept (as Apple Notes' 최근 삭제된 항목).
    public static let keepDays = 30

    public struct Entry: Equatable, Sendable {
        public var memo: Memo
        public var deletedAt: Date
        /// Where it was: its folder (a deleted folder's id stays; restoring puts it in 메모 then), pin and paper.
        public var folder: String
        public var pinned: Bool
        public var paper: String?
        public var extra: [String: KeptJSON]

        public init(memo: Memo, deletedAt: Date, folder: String, pinned: Bool = false, paper: String? = nil, extra: [String: KeptJSON] = [:]) {
            self.memo = memo
            self.deletedAt = deletedAt
            self.folder = folder
            self.pinned = pinned
            self.paper = paper
            self.extra = extra
        }
    }

    /// Newest deleted first, then by id.
    public private(set) var entries: [Entry]
    public var emptiedAt: Date?
    public var updatedAt: Date
    public var extra: [String: KeptJSON]

    public init(entries: [Entry] = [], emptiedAt: Date? = nil, updatedAt: Date = Date(timeIntervalSince1970: 0), extra: [String: KeptJSON] = [:]) {
        self.entries = Self.sorted(entries)
        self.emptiedAt = emptiedAt
        self.updatedAt = updatedAt
        self.extra = extra
    }

    static func sorted(_ entries: [Entry]) -> [Entry] {
        entries.sorted { $0.deletedAt != $1.deletedAt ? $0.deletedAt > $1.deletedAt : $0.memo.id < $1.memo.id }
    }

    public var isEmpty: Bool { entries.isEmpty }
    public var count: Int { entries.count }
    public func entry(_ id: String) -> Entry? { entries.first { $0.memo.id == id } }

    private mutating func touch(_ now: Date) { updatedAt = max(updatedAt, MemoFolders.second(now)) }

    // MARK: Changing

    /// T1: a memo deleted — kept with where it was (a blank memo isn't kept). Deleted again, its entry is the new one.
    public mutating func add(_ memo: Memo, folder: String, pinned: Bool, paper: String?, now: Date) {
        guard !memo.isBlank else { return }
        var kept = entries.filter { $0.memo.id != memo.id }
        kept.append(Entry(memo: memo, deletedAt: MemoFolders.second(now), folder: folder, pinned: pinned, paper: paper))
        entries = Self.sorted(kept)
        touch(now)
    }

    /// T2: 되돌리기 — the entry out of the trash (the caller puts the memo back in memos.json and in its folder).
    @discardableResult
    public mutating func remove(_ id: String, now: Date) -> Entry? {
        guard let index = entries.firstIndex(where: { $0.memo.id == id }) else { return nil }
        let entry = entries.remove(at: index)
        touch(now)
        return entry
    }

    /// T3: 지금 모두 비우기 — every entry gone for good; the time is kept so the other device's copy doesn't bring them back.
    public mutating func empty(now: Date) {
        entries = []
        emptiedAt = MemoFolders.second(now)
        touch(now)
    }

    /// T4, T6: before a write — entries deleted 30 days ago or more go, and those whose memo is alive in memos.json
    /// (`alive`; never pruned against a list that couldn't be read: pass none then); an `emptiedAt` that old too.
    public func pruned(now: Date, alive: Set<String>) -> MemoTrash {
        let limit = now.addingTimeInterval(-Double(Self.keepDays) * 86_400)
        var copy = self
        copy.entries = entries.filter { $0.deletedAt > limit && !alive.contains($0.memo.id) }
        if let emptied = emptiedAt, emptied <= limit { copy.emptiedAt = nil }
        return copy
    }

    /// T5: another device's copy joined with this one's: by memo id, the later `deletedAt` winning (a tie keeps this
    /// one's); the later `emptiedAt`, which takes every entry deleted at or before it; unknown top-level keys from both,
    /// a key on both from the newer file.
    public static func merge(here: MemoTrash, theirs: MemoTrash) -> MemoTrash {
        var byID = Dictionary(here.entries.map { ($0.memo.id, $0) }, uniquingKeysWith: { first, _ in first })
        for their in theirs.entries {
            if let mine = byID[their.memo.id], mine.deletedAt >= their.deletedAt { continue }
            byID[their.memo.id] = their
        }
        let emptied = [here.emptiedAt, theirs.emptiedAt].compactMap { $0 }.max()
        let entries = byID.values.filter { entry in emptied.map { entry.deletedAt > $0 } ?? true }
        var extra = here.extra
        for (key, value) in theirs.extra where extra[key] == nil || theirs.updatedAt > here.updatedAt { extra[key] = value }
        return MemoTrash(entries: Array(entries), emptiedAt: emptied, updatedAt: max(here.updatedAt, theirs.updatedAt), extra: extra)
    }

    // MARK: The file

    public enum ReadError: Error, Equatable { case unreadable }

    static let fileKeys: Set<String> = ["v", "memos", "emptiedAt", "updatedAt"]
    static let entryKeys: Set<String> = ["id", "text", "createdAt", "updatedAt", "deletedAt", "folder", "pinned", "paper"]

    /// Anything that isn't the file's shape throws (the app keeps it aside, as memo-folders.json); single bad entries are
    /// skipped; unknown keys are kept.
    public static func decode(_ data: Data) throws -> MemoTrash {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any], let list = object["memos"] as? [Any] else {
            throw ReadError.unreadable
        }
        func unknown(_ dictionary: [String: Any], _ known: Set<String>) -> [String: KeptJSON] {
            var out: [String: KeptJSON] = [:]
            for (key, value) in dictionary where !known.contains(key) { out[key] = KeptJSON(value) }
            return out
        }
        var entries: [Entry] = []
        var seen = Set<String>()
        for item in list {
            guard let e = item as? [String: Any], let id = e["id"] as? String, !id.isEmpty, let text = e["text"] as? String, !seen.contains(id) else { continue }
            seen.insert(id)
            entries.append(Entry(memo: Memo(id: id, text: text, createdAt: date(e["createdAt"]), updatedAt: date(e["updatedAt"])),
                                 deletedAt: date(e["deletedAt"]), folder: (e["folder"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? MemoFolders.inbox,
                                 pinned: e["pinned"] as? Bool ?? false, paper: e["paper"] as? String, extra: unknown(e, entryKeys)))
        }
        return MemoTrash(entries: entries, emptiedAt: object["emptiedAt"].map(date), updatedAt: date(object["updatedAt"]), extra: unknown(object, fileKeys))
    }

    nonisolated(unsafe) private static let plainISO = ISO8601DateFormatter()
    nonisolated(unsafe) private static let fractionalISO: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()

    private static func date(_ value: Any?) -> Date {
        guard let text = value as? String else { return Date(timeIntervalSince1970: 0) }
        if let quick = MemoFolders.utcSecond(text) { return quick }
        return (plainISO.date(from: text) ?? fractionalISO.date(from: text)).map(MemoFolders.second) ?? Date(timeIntervalSince1970: 0)
    }

    /// The file's text, the same bytes as the Windows app's: two-space indent, each memo on one line in the keys' order
    /// (`paper` only when set, unknown keys after, by key), `emptiedAt` only when set, whole-second UTC times, a newline at
    /// the end.
    public func encoded() -> String {
        let quote = MemoFolders.quote, iso = MemoFolders.iso
        var out = "{\n  \"v\": 1,\n  \"memos\": ["
        out += entries.isEmpty ? "]" : "\n" + entries.map { e in
            var fields = ["\"id\": \(quote(e.memo.id))", "\"text\": \(quote(e.memo.text))", "\"createdAt\": \(quote(iso(e.memo.createdAt)))",
                          "\"updatedAt\": \(quote(iso(e.memo.updatedAt)))", "\"deletedAt\": \(quote(iso(e.deletedAt)))",
                          "\"folder\": \(quote(e.folder))", "\"pinned\": \(e.pinned)"]
            if let paper = e.paper { fields.append("\"paper\": \(quote(paper))") }
            fields += MemoFolders.extraFields(e.extra)
            return "    { " + fields.joined(separator: ", ") + " }"
        }.joined(separator: ",\n") + "\n  ]"
        if let emptiedAt { out += ",\n  \"emptiedAt\": \(quote(iso(emptiedAt)))" }
        out += ",\n  \"updatedAt\": \(quote(iso(updatedAt)))"
        for field in MemoFolders.extraFields(extra) { out += ",\n  " + field }
        return out + "\n}\n"
    }

    // MARK: Words

    /// The folder menu's row (#120): "지운 메모 세 장" · "3 deleted notes" · "3 verwijderde notities".
    public static func menuLabel(_ count: Int, language: AppLanguage = .ko) -> String {
        switch language {
        case .ko: "지운 메모 \(MemoFolders.sheets(count))"
        case .en: AppLanguage.plural(count, "deleted note", "deleted notes")
        case .nl: AppLanguage.plural(count, "verwijderde notitie", "verwijderde notities")
        }
    }

    /// When it was deleted, by calendar days: "오늘" · "어제" · "3일 전" (en "today" · "yesterday" · "3 days ago", nl
    /// "vandaag" · "gisteren" · "3 dagen geleden").
    public static func ago(_ date: Date, now: Date, calendar: Calendar = .current, language: AppLanguage = .ko) -> String {
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 0
        switch (language, max(0, days)) {
        case (_, 0): return ["오늘", "today", "vandaag"][language.index]
        case (_, 1): return ["어제", "yesterday", "gisteren"][language.index]
        case (.ko, let n): return "\(n)일 전"
        case (.en, let n): return "\(n) days ago"
        case (.nl, let n): return "\(n) dagen geleden"
        }
    }

    /// 지금 모두 비우기's question: "지운 메모 세 장을 완전히 지울까요?" · "Delete 3 notes for good?" · "3 notities definitief
    /// verwijderen?".
    public static func emptyQuestion(_ count: Int, language: AppLanguage = .ko) -> String {
        switch language {
        case .ko: "지운 메모 \(MemoFolders.sheets(count))을 완전히 지울까요?"
        case .en: "Delete \(AppLanguage.plural(count, "note", "notes")) for good?"
        case .nl: "\(AppLanguage.plural(count, "notitie", "notities")) definitief verwijderen?"
        }
    }

    /// After 되돌리기: "‘회사’ 폴더로 되돌렸어요" · "Restored to ‘Work’" · "Teruggezet in ‘Werk’".
    public static func restored(to folder: String, language: AppLanguage = .ko) -> String {
        ["‘\(folder)’ 폴더로 되돌렸어요", "Restored to ‘\(folder)’", "Teruggezet in ‘\(folder)’"][language.index]
    }
}
