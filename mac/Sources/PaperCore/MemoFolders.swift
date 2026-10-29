import Foundation

/// 메모 서랍: which folder each memo is in and which are pinned, kept in memo-folders.json next to
/// memos.json (memos.json itself never changes shape, so an older app saving it can't lose folders).
/// Same file, rules and cases (D1–D16) as the Windows app (memoFolders.ts).
public struct MemoFolders: Equatable, Sendable {
    public static let fileName = "memo-folders.json"
    public static let inbox = "inbox"
    /// A deleted folder's tombstone is kept this long, so another device can't bring it back.
    public static let tombstoneDays = 30

    public enum Color: String, CaseIterable, Sendable {
        case lavender, pink, mint, yellow, sky, peach, sand, gray
    }

    /// 정렬 (1.44): a folder's order — 고친 순 (the default, absent in the file), 만든 순, 제목 순.
    public enum Sort: String, CaseIterable, Sendable {
        case edited, created, title
    }

    /// 이 메모의 종이 (1.44): a memo's own paper; absent = 서랍 따라 (the drawer's).
    public enum Paper: String, CaseIterable, Sendable {
        case day, night, kraft, grid
    }

    public struct Folder: Equatable, Sendable {
        public var id: String
        public var name: String
        /// One of `Color`'s keys; an unknown key (a newer app) is kept and shown as lavender.
        public var color: String
        public var order: Int
        public var updatedAt: Date
        public var deleted: Bool
        /// 정렬 as written (nil: 고친 순); a value a newer app wrote is kept and read as 고친 순.
        public var sort: String?
        /// Keys this version doesn't know, kept as read (1.44: they survive a read and a write).
        public var extra: [String: KeptJSON]

        public init(id: String, name: String, color: String, order: Int, updatedAt: Date, deleted: Bool = false,
                    sort: String? = nil, extra: [String: KeptJSON] = [:]) {
            self.id = id
            self.name = name
            self.color = color
            self.order = order
            self.updatedAt = updatedAt
            self.deleted = deleted
            self.sort = sort
            self.extra = extra
        }

        public var colorKey: Color { Color(rawValue: color) ?? .lavender }
        public var sortKey: Sort { sort.flatMap(Sort.init(rawValue:)) ?? .edited }
        public var isInbox: Bool { id == MemoFolders.inbox }

        /// The inbox's untouched default name follows the app's language; any other name is the user's.
        public func displayName(_ language: AppLanguage = .ko) -> String {
            isInbox && MemoFolders.inboxNames.contains(name) ? MemoFolders.inboxNames[language.index] : name
        }
    }

    public struct Placement: Equatable, Sendable {
        public var folder: String
        public var pinned: Bool
        public var at: Date
        /// 이 메모의 종이 as written (nil: 서랍 따라); an unknown value is kept and read as 서랍 따라.
        public var paper: String?
        public var extra: [String: KeptJSON]

        public init(folder: String, pinned: Bool, at: Date, paper: String? = nil, extra: [String: KeptJSON] = [:]) {
            self.folder = folder
            self.pinned = pinned
            self.at = at
            self.paper = paper
            self.extra = extra
        }

        public var paperKey: Paper? { paper.flatMap(Paper.init(rawValue:)) }
    }

    /// "메모" · "Notes" · "Notities"
    public static let inboxNames = ["메모", "Notes", "Notities"]

    public var folders: [Folder]
    public var placement: [String: Placement]
    public var updatedAt: Date
    /// Top-level keys this version doesn't know (kept, written after the known ones).
    public var extra: [String: KeptJSON]

    public init(folders: [Folder] = [], placement: [String: Placement] = [:], updatedAt: Date = Date(timeIntervalSince1970: 0),
                extra: [String: KeptJSON] = [:], language: AppLanguage = .ko) {
        self.folders = folders
        self.placement = placement
        self.updatedAt = updatedAt
        self.extra = extra
        ensureInbox(language)
    }

    /// D1: no file yet — the inbox alone, every memo in it.
    public static func fresh(language: AppLanguage = .ko) -> MemoFolders { MemoFolders(language: language) }

    private mutating func ensureInbox(_ language: AppLanguage) {
        guard !folders.contains(where: \.isInbox) else {
            // The inbox can't be deleted, even by a file that says so.
            if let i = folders.firstIndex(where: \.isInbox) { folders[i].deleted = false }
            return
        }
        folders.insert(Folder(id: Self.inbox, name: Self.inboxNames[language.index], color: Color.lavender.rawValue,
                              order: folders.isEmpty ? 0 : min(0, (folders.map(\.order).min() ?? 0) - 1),
                              updatedAt: Date(timeIntervalSince1970: 0)), at: 0)
    }

    // MARK: Reading the folders

    /// The bookmarks, in order: live folders by `order`, then id.
    public var visible: [Folder] {
        folders.filter { !$0.deleted }.sorted { ($0.order, $0.id) < ($1.order, $1.id) }
    }

    public func folder(_ id: String) -> Folder? { folders.first { $0.id == id && !$0.deleted } }

    /// D2, D5: a memo with no placement, or placed in a deleted or unknown folder, is in the inbox.
    public func folderID(of memoID: String) -> String {
        guard let place = placement[memoID], folder(place.folder) != nil else { return Self.inbox }
        return place.folder
    }

    public func isPinned(_ memoID: String) -> Bool { placement[memoID]?.pinned ?? false }

    /// 이 메모의 종이: nil = 서랍 따라.
    public func paper(of memoID: String) -> Paper? { placement[memoID]?.paperKey }

    /// 정렬 of a folder (고친 순 when it has none or is gone).
    public func sort(of folderID: String) -> Sort { folder(folderID)?.sortKey ?? .edited }

    /// The memos shown under a bookmark, in the given order (the app keeps memos newest first).
    public func memos(_ all: [Memo], in folderID: String) -> [Memo] { all.filter { self.folderID(of: $0.id) == folderID } }

    /// 고정: pinned memos from every folder.
    public func pinnedMemos(_ all: [Memo]) -> [Memo] { all.filter { isPinned($0.id) } }

    public func count(_ all: [Memo], in folderID: String) -> Int { all.reduce(0) { $0 + (self.folderID(of: $1.id) == folderID ? 1 : 0) } }

    // MARK: Changing

    /// The memo's placement changed (its paper and unknown keys kept).
    private mutating func update(_ memoID: String, now: Date, _ change: (inout Placement) -> Void) {
        var place = placement[memoID] ?? Placement(folder: Self.inbox, pinned: false, at: Self.second(now))
        place.folder = folderID(of: memoID)
        change(&place)
        place.at = Self.second(now)
        placement[memoID] = place
        touch(now)
    }

    public mutating func place(_ memoID: String, in folderID: String, now: Date) {
        let target = folder(folderID) == nil ? Self.inbox : folderID
        update(memoID, now: now) { $0.folder = target }
    }

    public mutating func setPinned(_ memoID: String, _ pinned: Bool, now: Date) {
        update(memoID, now: now) { $0.pinned = pinned }
    }

    /// 이 메모의 종이 (D17): nil = 서랍 따라 (the key goes).
    public mutating func setPaper(_ memoID: String, _ paper: Paper?, now: Date) {
        update(memoID, now: now) { $0.paper = paper?.rawValue }
    }

    /// 정렬 (D17): 고친 순 is written as no key.
    public mutating func setSort(_ folderID: String, _ sort: Sort, now: Date) {
        let raw = sort == .edited ? nil : sort.rawValue
        guard let i = folders.firstIndex(where: { $0.id == folderID && !$0.deleted }), folders[i].sort != raw else { return }
        folders[i].sort = raw
        folders[i].updatedAt = Self.second(now)
        touch(now)
    }

    /// 고정 모두 풀기 (D28): every pinned memo let go; returns them (for 되돌리기).
    @discardableResult
    public mutating func unpinAll(now: Date) -> [String] {
        let pinned = placement.filter(\.value.pinned).map(\.key).sorted()
        for id in pinned { setPinned(id, false, now: now) }
        return pinned
    }

    /// 복제 (D21): a new folder right after this one — `회사 사본` (then `회사 사본 2` …), its colour and 정렬 — holding
    /// the copies (`copies`: original memo id → the copy's id) with their originals' pin and paper. The folders after it
    /// move down one (their updatedAt now). Returns the new folder's id, nil when there's no such folder.
    @discardableResult
    public mutating func duplicateFolder(_ folderID: String, as newID: String, copies: [(String, String)], now: Date, language: AppLanguage = .ko) -> String? {
        guard let original = folder(folderID) else { return nil }
        let taken = Set(visible.map { $0.displayName(language) })
        // The original's name is cut so the ending always fits in 40 (a long name's copy still differs from it).
        func named(_ n: Int) -> String {
            let ending = String(Self.copyName("", language).dropFirst()) + (n > 1 ? " \(n)" : "")
            let name = Self.cleanName(original.displayName(language))
            return String(name.prefix(max(0, 40 - ending.count - 1))) + " " + ending
        }
        var n = 1
        var name = named(n)
        while taken.contains(name) {
            n += 1
            name = named(n)
        }
        let stamp = Self.second(now)
        for i in folders.indices where !folders[i].deleted && folders[i].order > original.order {
            folders[i].order += 1
            folders[i].updatedAt = stamp
        }
        folders.append(Folder(id: newID, name: name, color: original.color, order: original.order + 1, updatedAt: stamp, sort: original.sort))
        for (from, to) in copies {
            placement[to] = Placement(folder: newID, pinned: isPinned(from), at: stamp, paper: placement[from]?.paper)
        }
        touch(now)
        return newID
    }

    /// "회사 사본" · "Work copy" · "Werk kopie".
    public static func copyName(_ name: String, _ language: AppLanguage) -> String {
        ["\(name) 사본", "\(name) copy", "\(name) kopie"][language.index]
    }

    /// A new folder after the others; returns its id.
    @discardableResult
    public mutating func addFolder(name: String, color: Color, now: Date, id: String = UUID().uuidString.lowercased()) -> String {
        let order = (visible.map(\.order).max() ?? 0) + 1
        folders.append(Folder(id: id, name: Self.cleanName(name), color: color.rawValue, order: order, updatedAt: Self.second(now)))
        touch(now)
        return id
    }

    public mutating func rename(_ folderID: String, to name: String, now: Date) {
        let clean = Self.cleanName(name)
        guard !clean.isEmpty, let i = folders.firstIndex(where: { $0.id == folderID && !$0.deleted }), folders[i].name != clean else { return }
        folders[i].name = clean
        folders[i].updatedAt = Self.second(now)
        touch(now)
    }

    public mutating func recolor(_ folderID: String, to color: Color, now: Date) {
        guard let i = folders.firstIndex(where: { $0.id == folderID && !$0.deleted }), folders[i].color != color.rawValue else { return }
        folders[i].color = color.rawValue
        folders[i].updatedAt = Self.second(now)
        touch(now)
    }

    /// D3: the folder becomes a tombstone and its memos go to the inbox (pins kept). D4: the inbox
    /// can't be deleted (false).
    @discardableResult
    public mutating func deleteFolder(_ folderID: String, now: Date) -> Bool {
        guard folderID != Self.inbox, let i = folders.firstIndex(where: { $0.id == folderID && !$0.deleted }) else { return false }
        folders[i].deleted = true
        folders[i].updatedAt = Self.second(now)
        for (memo, place) in placement where place.folder == folderID {
            placement[memo] = Placement(folder: Self.inbox, pinned: place.pinned, at: Self.second(now))
        }
        touch(now)
        return true
    }

    /// 되돌리기 after deleting a folder: it comes back, with the memos that were moved out of it.
    public mutating func restoreFolder(_ folderID: String, memoIDs: [String], now: Date) {
        guard folderID != Self.inbox, let i = folders.firstIndex(where: { $0.id == folderID && $0.deleted }) else { return }
        folders[i].deleted = false
        folders[i].updatedAt = Self.second(now)
        for memo in memoIDs where self.folderID(of: memo) == Self.inbox {
            placement[memo] = Placement(folder: folderID, pinned: isPinned(memo), at: Self.second(now))
        }
        touch(now)
    }

    /// Bookmarks dragged into a new order (live folder ids, any not listed keep their place after).
    public mutating func reorder(_ ids: [String], now: Date) {
        let listed = ids.filter { folder($0) != nil }
        let rest = visible.map(\.id).filter { !listed.contains($0) }
        var changed = false
        for (order, id) in (listed + rest).enumerated() {
            guard let i = folders.firstIndex(where: { $0.id == id }), folders[i].order != order else { continue }
            folders[i].order = order
            folders[i].updatedAt = Self.second(now)
            changed = true
        }
        if changed { touch(now) }
    }

    /// A placement this new is kept even without its memo: another device's new memo may reach
    /// memos.json after memo-folders.json (cloud folders sync files one by one).
    public static let pruneGrace: TimeInterval = 3600

    /// D6: placements of memos that are gone (and older than an hour) are dropped; tombstones older than 30 days too.
    public func pruned(memoIDs: Set<String>, now: Date) -> MemoFolders {
        var copy = self
        let recent = now.addingTimeInterval(-Self.pruneGrace)
        copy.placement = placement.filter { memoIDs.contains($0.key) || $0.value.at > recent }
        let limit = now.addingTimeInterval(-Double(Self.tombstoneDays) * 86_400)
        copy.folders = folders.filter { !$0.deleted || $0.updatedAt >= limit }
        return copy
    }

    private mutating func touch(_ now: Date) { updatedAt = max(updatedAt, Self.second(now)) }

    /// A folder name on one line, trimmed, at most 40 characters.
    public static func cleanName(_ name: String) -> String {
        String(name.split(whereSeparator: \.isNewline).joined(separator: " ").trimmingCharacters(in: .whitespaces).prefix(40))
    }

    static func second(_ date: Date) -> Date { Date(timeIntervalSince1970: date.timeIntervalSince1970.rounded(.down)) }

    // MARK: Merging (D13, D14)

    /// The file changed on another device: folders by id and placements by memo id, the newer
    /// `updatedAt` / `at` winning (tombstones too); a tie keeps this device's. Same-named folders
    /// made apart have different ids, so both stay.
    public static func merge(here: MemoFolders, theirs: MemoFolders) -> MemoFolders {
        var folders = here.folders
        for their in theirs.folders {
            if let i = folders.firstIndex(where: { $0.id == their.id }) {
                if their.updatedAt > folders[i].updatedAt { folders[i] = their }
            } else {
                folders.append(their)
            }
        }
        var placement = here.placement
        for (memo, their) in theirs.placement {
            if let mine = placement[memo], mine.at >= their.at { continue }
            placement[memo] = their
        }
        // Unknown top-level keys: both sides', a key on both taken from the newer file (a tie keeps this device's).
        var extra = here.extra
        for (key, value) in theirs.extra where extra[key] == nil || theirs.updatedAt > here.updatedAt { extra[key] = value }
        return MemoFolders(folders: folders, placement: placement, updatedAt: max(here.updatedAt, theirs.updatedAt), extra: extra)
    }

    // MARK: The file

    public enum ReadError: Error, Equatable { case unreadable }

    static let fileKeys: Set<String> = ["v", "folders", "placement", "updatedAt"]
    static let folderKeys: Set<String> = ["id", "name", "color", "order", "updatedAt", "deleted", "sort"]
    static let placementKeys: Set<String> = ["folder", "pinned", "at", "paper"]

    /// D15: anything that isn't the file's shape throws (the app moves it aside and starts fresh).
    /// Single bad entries are skipped; unknown keys are kept (D18).
    public static func decode(_ data: Data, language: AppLanguage = .ko) throws -> MemoFolders {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let list = object["folders"] as? [Any] else { throw ReadError.unreadable }
        func unknown(_ dictionary: [String: Any], _ known: Set<String>) -> [String: KeptJSON] {
            var out: [String: KeptJSON] = [:]
            for (key, value) in dictionary where !known.contains(key) { out[key] = KeptJSON(value) }
            return out
        }
        var folders: [Folder] = []
        for (index, entry) in list.enumerated() {
            guard let f = entry as? [String: Any], let id = f["id"] as? String, !id.isEmpty, !folders.contains(where: { $0.id == id }) else { continue }
            folders.append(Folder(id: id, name: f["name"] as? String ?? "", color: f["color"] as? String ?? Color.lavender.rawValue,
                                  order: (f["order"] as? Int) ?? index, updatedAt: date(f["updatedAt"]), deleted: f["deleted"] as? Bool ?? false,
                                  sort: (f["sort"] as? String).flatMap { $0 == Sort.edited.rawValue ? nil : $0 }, extra: unknown(f, folderKeys)))
        }
        var placement: [String: Placement] = [:]
        for (memo, entry) in object["placement"] as? [String: Any] ?? [:] {
            guard let p = entry as? [String: Any], let folder = p["folder"] as? String else { continue }
            placement[memo] = Placement(folder: folder, pinned: p["pinned"] as? Bool ?? false, at: date(p["at"]),
                                        paper: p["paper"] as? String, extra: unknown(p, placementKeys))
        }
        return MemoFolders(folders: folders, placement: placement, updatedAt: date(object["updatedAt"]), extra: unknown(object, fileKeys), language: language)
    }

    // The formatters are made once (one per date made the file take 0.7 s to read at 2,000 memos); ISO8601DateFormatter
    // is safe to share between threads.
    nonisolated(unsafe) private static let plainISO = ISO8601DateFormatter()
    nonisolated(unsafe) private static let fractionalISO: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    nonisolated(unsafe) private static let utcISO: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter
    }()

    private static func date(_ value: Any?) -> Date {
        guard let text = value as? String else { return Date(timeIntervalSince1970: 0) }
        if let quick = utcSecond(text) { return quick }
        return (plainISO.date(from: text) ?? fractionalISO.date(from: text)).map(second) ?? Date(timeIntervalSince1970: 0)
    }

    /// The file's own shape, `2026-10-28T05:01:02Z`, read without a formatter (the formatters for anything else).
    /// Only dates the formatter reads the same way: years from 1900, every field in range.
    static func utcSecond(_ text: String) -> Date? {
        let b = Array(text.utf8)
        guard b.count == 20, b[4] == 0x2D, b[7] == 0x2D, b[10] == 0x54, b[13] == 0x3A, b[16] == 0x3A, b[19] == 0x5A else { return nil }
        func number(_ from: Int, _ count: Int) -> Int? {
            var out = 0
            for i in from..<(from + count) {
                let d = Int(b[i]) - 0x30
                guard (0...9).contains(d) else { return nil }
                out = out * 10 + d
            }
            return out
        }
        guard let year = number(0, 4), let month = number(5, 2), let day = number(8, 2), let hour = number(11, 2),
              let minute = number(14, 2), let sec = number(17, 2), year >= 1900, (1...12).contains(month), hour < 24, minute < 60, sec < 60
        else { return nil }
        let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0)
        let lengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
        guard (1...lengths[month - 1]).contains(day) else { return nil }
        // Days from 1970-01-01 (the civil-calendar count, H. Hinnant's days_from_civil).
        let y = month <= 2 ? year - 1 : year
        let era = y / 400
        let yoe = y - era * 400
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        let days = era * 146_097 + doe - 719_468
        return Date(timeIntervalSince1970: TimeInterval(days * 86_400 + hour * 3_600 + minute * 60 + sec))
    }

    /// The file's text: keys in a fixed order, 2-space indent, folders in `order`, placements by
    /// memo id, whole-second UTC times, a trailing newline (the Windows app writes the same bytes).
    public func encoded() -> String {
        var out = "{\n  \"v\": 1,\n  \"folders\": ["
        let sorted = folders.sorted { ($0.order, $0.id) < ($1.order, $1.id) }
        out += sorted.isEmpty ? "]" : "\n" + sorted.map { f in
            var fields = ["\"id\": \(Self.quote(f.id))", "\"name\": \(Self.quote(f.name))", "\"color\": \(Self.quote(f.color))",
                          "\"order\": \(f.order)", "\"updatedAt\": \(Self.quote(Self.iso(f.updatedAt)))"]
            if let sort = f.sort { fields.append("\"sort\": \(Self.quote(sort))") }
            if f.deleted { fields.append("\"deleted\": true") }
            fields += Self.extraFields(f.extra)
            return "    { " + fields.joined(separator: ", ") + " }"
        }.joined(separator: ",\n") + "\n  ]"
        out += ",\n  \"placement\": {"
        let places = placement.sorted { $0.key < $1.key }
        out += places.isEmpty ? "}" : "\n" + places.map { memo, p in
            var fields = ["\"folder\": \(Self.quote(p.folder))", "\"pinned\": \(p.pinned)", "\"at\": \(Self.quote(Self.iso(p.at)))"]
            if let paper = p.paper { fields.append("\"paper\": \(Self.quote(paper))") }
            fields += Self.extraFields(p.extra)
            return "    \(Self.quote(memo)): { " + fields.joined(separator: ", ") + " }"
        }.joined(separator: ",\n") + "\n  }"
        out += ",\n  \"updatedAt\": \(Self.quote(Self.iso(updatedAt)))"
        for field in Self.extraFields(extra) { out += ",\n  " + field }
        out += "\n}\n"
        return out
    }

    /// Unknown keys after the known ones, by key, each value compact on the line (D18).
    static func extraFields(_ extra: [String: KeptJSON]) -> [String] {
        extra.sorted { $0.key < $1.key }.map { "\(quote($0.key)): \($0.value.compact)" }
    }

    public static func iso(_ date: Date) -> String {
        utcISO.string(from: second(date))
    }

    static func quote(_ text: String) -> String {
        var out = "\""
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if scalar.value < 0x20 { out += String(format: "\\u%04x", scalar.value) } else { out.unicodeScalars.append(scalar) }
            }
        }
        return out + "\""
    }

    /// Atomic (temp file + rename).
    public func save(to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(encoded().utf8).write(to: url, options: .atomic)
    }

    /// "memo-folders.unreadable-20261027-140501.json", next to the file (D15).
    public static func asideName(_ now: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return "memo-folders.unreadable-\(formatter.string(from: now)).json"
    }

    // MARK: Tabs, the last folder, quick write

    public enum Tab: Equatable, Hashable, Sendable {
        case folder(String)
        case pinned
    }

    /// D16: ⌘1–9 pick the bookmarks in order, ⌘0 고정; a number without a bookmark does nothing.
    public func tab(forDigit digit: Int) -> Tab? {
        if digit == 0 { return .pinned }
        guard (1...9).contains(digit), digit <= visible.count else { return nil }
        return .folder(visible[digit - 1].id)
    }

    /// The setting's last folder, if it still exists; else the inbox (never opened → inbox).
    public func lastFolder(_ setting: String?) -> String {
        guard let setting, folder(setting) != nil else { return Self.inbox }
        return setting
    }

    /// Where the quick-write slip puts a new memo: the shown folder, or from 고정 the inbox, pinned (D11).
    public func quickWriteTarget(_ tab: Tab) -> (folder: String, pinned: Bool) {
        switch tab {
        case .folder(let id): (folder(id) == nil ? Self.inbox : id, false)
        case .pinned: (Self.inbox, true)
        }
    }

    /// D10: the typed text trimmed; nil when only blanks.
    public static func quickWriteText(_ typed: String) -> String? {
        let text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    // MARK: Words on the drawer

    /// A slip's time: today the clock ("14:05", en "2:05 PM"), yesterday "어제" · "Yesterday" · "Gisteren",
    /// before that the day ("10월 21일", "Oct 21", "21 okt"; another year adds it).
    public static func slipTime(_ date: Date, now: Date, calendar: Calendar = .current, language: AppLanguage = .ko) -> String {
        let day = calendar.startOfDay(for: date), today = calendar.startOfDay(for: now)
        let p = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        if day == today { return language.clock(hour: p.hour!, minute: p.minute!) }
        if calendar.date(byAdding: .day, value: 1, to: day) == today { return ["어제", "Yesterday", "Gisteren"][language.index] }
        let thisYear = calendar.component(.year, from: now)
        return language.dayMonth(month: p.month!, day: p.day!, year: p.year == thisYear ? nil : p.year)
    }

    /// Korean counts sheets in native numbers up to ten ("다섯 장"), then digits ("12장").
    public static func sheets(_ count: Int) -> String {
        let native = ["", "한", "두", "세", "네", "다섯", "여섯", "일곱", "여덟", "아홉", "열"]
        return (1...10).contains(count) ? "\(native[count]) 장" : "\(count)장"
    }

    /// A count of memos on its own: "다섯 장" · "5 notes" · "5 notities".
    public static func sheetCount(_ count: Int, language: AppLanguage = .ko) -> String {
        switch language {
        case .ko: sheets(count)
        case .en: AppLanguage.plural(count, "note", "notes")
        case .nl: AppLanguage.plural(count, "notitie", "notities")
        }
    }

    /// The footer (1.44): "회사 · 다섯 장" · "Work · 5 notes" · "Werk · 5 notities"; an empty folder just "비어 있어요" ·
    /// "Empty" · "Leeg" (#39: the line in the middle says how to fill it, the bookmark says which folder).
    public static func footerShort(folder name: String, count: Int, language: AppLanguage = .ko) -> String {
        count == 0 ? emptyFooter(language) : "\(name) · \(sheetCount(count, language: language))"
    }

    /// 고정's footer (1.44): "고정 · 세 장" · "Pinned · 3 notes" · "Vastgezet · 3 notities"; none "비어 있어요".
    public static func pinnedFooterShort(count: Int, language: AppLanguage = .ko) -> String {
        count == 0 ? emptyFooter(language) : "\(["고정", "Pinned", "Vastgezet"][language.index]) · \(sheetCount(count, language: language))"
    }

    /// An empty folder's or 고정's footer: "비어 있어요" · "Empty" · "Leeg".
    public static func emptyFooter(_ language: AppLanguage = .ko) -> String {
        ["비어 있어요", "Empty", "Leeg"][language.index]
    }

    /// A bookmark's label (1.44): "장보기 · 세 장 · ⌘3"; empty "공부 · 비어 있어요" · "Study · empty" · "Studie · leeg"; past the
    /// ninth no key. `key` is the app's way of writing it (⌘3, Ctrl+3).
    public static func bookmarkLabel(_ name: String, count: Int, key: String?, language: AppLanguage = .ko) -> String {
        let amount = count == 0 ? ["비어 있어요", "empty", "leeg"][language.index] : sheetCount(count, language: language)
        return ([name, amount] + (key.map { [$0] } ?? [])).joined(separator: " · ")
    }

    /// The drawer's footer in a sentence: "회사에 다섯 장" · "5 notes in Work" · "5 notities in Werk"; an empty folder
    /// "비어 있어요" · "Empty" · "Leeg" (#39).
    public static func footer(folder name: String, count: Int, language: AppLanguage = .ko) -> String {
        switch (language, count) {
        case (_, 0): return emptyFooter(language)
        case (.ko, _): return "\(name)에 \(sheets(count))"
        case (.en, _): return "\(AppLanguage.plural(count, "note", "notes")) in \(name)"
        case (.nl, _): return "\(AppLanguage.plural(count, "notitie", "notities")) in \(name)"
        }
    }

    /// 고정: "고정한 메모 세 장" · "3 pinned notes" · "3 vastgezette notities"; none "비어 있어요" · "Empty" · "Leeg".
    public static func pinnedFooter(count: Int, language: AppLanguage = .ko) -> String {
        switch (language, count) {
        case (_, 0): return emptyFooter(language)
        case (.ko, _): return "고정한 메모 \(sheets(count))"
        case (.en, _): return AppLanguage.plural(count, "pinned note", "pinned notes")
        case (.nl, _): return AppLanguage.plural(count, "vastgezette notitie", "vastgezette notities")
        }
    }

    /// Search (every folder): "찾은 메모 세 장" · "3 notes found" · "3 notities gevonden"; none the same with 0 — the
    /// line in the middle says what was looked for (#39).
    public static func searchFooter(count: Int, language: AppLanguage = .ko) -> String {
        switch language {
        case .ko: return "찾은 메모 \(sheets(count))"
        case .en: return "\(AppLanguage.plural(count, "note", "notes")) found"
        case .nl: return "\(AppLanguage.plural(count, "notitie", "notities")) gevonden"
        }
    }

    /// A folder deleted with memos in it (D29): "메모 두 장은 ‘메모’ 폴더로 옮겼어요" · "2 notes moved to ‘Notes’" ·
    /// "2 notities verplaatst naar ‘Notities’".
    public static func movedToInbox(count: Int, inbox: String, language: AppLanguage = .ko) -> String {
        switch language {
        case .ko: "메모 \(sheets(count))은 ‘\(inbox)’ 폴더로 옮겼어요"
        case .en: "\(AppLanguage.plural(count, "note", "notes")) moved to ‘\(inbox)’"
        case .nl: "\(AppLanguage.plural(count, "notitie", "notities")) verplaatst naar ‘\(inbox)’"
        }
    }

    /// The handle's number: memos changed today (0 → no number).
    public static func changedToday(_ memos: [Memo], now: Date, calendar: Calendar = .current) -> Int {
        memos.reduce(0) { $0 + (calendar.isDate($1.updatedAt, inSameDayAs: now) ? 1 : 0) }
    }
}

// MARK: - Checklist lines (D7–D9)

public enum Checklist {
    public struct Line: Equatable, Sendable {
        /// The line's index in the memo (lines split at "\n").
        public var index: Int
        public var checked: Bool
        /// The text after the box.
        public var text: String
    }

    /// `^(\s*)[-*] \[( |x|X)\] (.*)$` — returns (checked, the text after the box, where the box's mark is).
    /// Lines split at "\n" only (a "\r" before it stays with its line; Swift keeps "\r\n" as one Character).
    public static func split(_ text: String) -> [String] {
        text.unicodeScalars.split(separator: "\n", omittingEmptySubsequences: false).map { String(String.UnicodeScalarView($0)) }
    }

    static func parse(_ line: String) -> (checked: Bool, text: Substring, mark: String.Index, line: String)? {
        let line = line.hasSuffix("\r") ? String(line.unicodeScalars.dropLast()) : line
        var i = line.startIndex
        while i < line.endIndex, line[i] == " " || line[i] == "\t" { i = line.index(after: i) }
        let rest = line[i...]
        let chars = Array(rest.prefix(6))
        guard chars.count == 6, chars[0] == "-" || chars[0] == "*", chars[1] == " ", chars[2] == "[",
              chars[3] == " " || chars[3] == "x" || chars[3] == "X", chars[4] == "]", chars[5] == " " else { return nil }
        let mark = rest.index(rest.startIndex, offsetBy: 3)
        return (chars[3] != " ", rest[rest.index(rest.startIndex, offsetBy: 6)...], mark, line)
    }

    /// A line drawn in a fixed-width face: indented four spaces or a tab, starting "$ " or a backtick, or
    /// starting with a common command (git, npm, brew, cd …) followed by more.
    public static func isCode(_ line: String) -> Bool {
        if line.hasPrefix("    ") || line.hasPrefix("\t") { return !line.trimmingCharacters(in: .whitespaces).isEmpty }
        let text = line.trimmingCharacters(in: .whitespaces)
        if text.hasPrefix("$ ") || text.hasPrefix("`") { return true }
        // A command line is Latin: no Hangul in it (the Windows app's rule).
        guard !text.unicodeScalars.contains(where: { (0xAC00...0xD7A3).contains($0.value) || (0x3131...0x318E).contains($0.value) }) else { return false }
        let words = text.split(separator: " ", maxSplits: 1)
        guard words.count == 2, let first = words.first else { return false }
        return commands.contains(String(first)) || first.hasPrefix("./")
    }

    static let commands: Set<String> = ["git", "npm", "npx", "yarn", "pnpm", "node", "brew", "cd", "ls", "swift", "python", "python3", "pip",
                                        "pip3", "curl", "ssh", "scp", "docker", "kubectl", "make", "sudo", "xcodebuild", "defaults", "cat",
                                        "grep", "rg", "echo", "export", "bash", "sh", "zsh", "open", "mkdir", "rm", "mv", "cp", "chmod", "tail", "gh"]

    public static func lines(_ text: String) -> [Line] {
        split(text).enumerated().compactMap { index, line in
            parse(line).map { Line(index: index, checked: $0.checked, text: String($0.text)) }
        }
    }

    /// D7, D8: flips `[ ]` ↔ `[x]` (`[X]` counts as checked) on that line only; anything else
    /// (not a checklist line, no such line) gives the text back unchanged.
    public static func toggle(_ text: String, line index: Int) -> String {
        var lines = split(text)
        guard lines.indices.contains(index), let parsed = parse(lines[index]) else { return text }
        // parse works on the line without its "\r": find the mark again by its character offset.
        var line = lines[index]
        let offset = parsed.line.distance(from: parsed.line.startIndex, to: parsed.mark)
        line.replaceSubrange(line.index(line.startIndex, offsetBy: offset)...line.index(line.startIndex, offsetBy: offset), with: parsed.checked ? " " : "x")
        lines[index] = line
        return lines.joined(separator: "\n")
    }

    /// D9: (checked, total) over the checklist lines; nil without any (no bar).
    public static func progress(_ text: String) -> (done: Int, total: Int)? {
        let all = lines(text)
        return all.isEmpty ? nil : (all.filter(\.checked).count, all.count)
    }

    /// 체크한 줄 지우기 (D27): every ticked checklist line goes; the rest byte for byte.
    public static func removeChecked(_ text: String) -> String {
        split(text).filter { parse($0)?.checked != true }.joined(separator: "\n")
    }

    public struct Summary: Equatable, Sendable {
        public struct Row: Equatable, Sendable {
            /// nil: plain text; true/false: a checklist line, ☑ / ☐.
            public var checked: Bool?
            public var text: String
            public init(checked: Bool?, text: String) { self.checked = checked; self.text = text }
        }
        public var title: String
        public var preview: [Row]
    }

    /// The collapsed slip: the first non-empty line (its box taken off) and the next two non-empty lines.
    public static func summary(_ text: String, language: AppLanguage = .ko) -> Summary {
        let rows: [Summary.Row] = split(text).compactMap { line in
            if let parsed = parse(line) {
                let body = parsed.text.trimmingCharacters(in: .whitespaces)
                return Summary.Row(checked: parsed.checked, text: body)
            }
            let body = line.trimmingCharacters(in: .whitespacesAndNewlines)
            return body.isEmpty ? nil : Summary.Row(checked: nil, text: body)
        }.filter { !$0.text.isEmpty || $0.checked != nil }
        guard let start = rows.firstIndex(where: { !$0.text.isEmpty }) else {
            return Summary(title: ["빈 메모", "Empty note", "Lege notitie"][language.index], preview: [])
        }
        return Summary(title: rows[start].text, preview: Array(rows[(start + 1)...].prefix(2)))
    }
}

// MARK: - The memo tab became the drawer (1.43)

/// The note's 메모 tab went away in 1.43; memos live in 메모 서랍. Nothing in the files changes: every memo without a
/// placement is in the 메모 folder. A device that updates with memos gets one notice (M1–M3).
public enum MemoMove {
    /// M1–M3: shown once per device, only when there are memos; the flag is set on the first launch either way.
    public static func notice(memoCount: Int, shown: Bool) -> (show: Bool, markShown: Bool) {
        (show: !shown && memoCount > 0, markShown: !shown)
    }

    /// "메모가 서랍으로 옮겨 갔어요" · "Your notes moved to the drawer" · "Je notities staan nu in de lade".
    public static func title(_ language: AppLanguage = .ko) -> String {
        ["메모가 서랍으로 옮겨 갔어요", "Your notes moved to the drawer", "Je notities staan nu in de lade"][language.index]
    }

    /// "메모 탭에 있던 메모 다섯 장은 서랍의 ‘메모’ 폴더에 그대로 있어요. ⇧⌘D나 노트 위의 서랍 버튼으로 열어요."
    /// `shortcut` nil (turned off): only the button.
    public static func body(count: Int, shortcut: String?, language: AppLanguage = .ko) -> String {
        let inbox = MemoFolders.inboxNames[language.index]
        switch language {
        case .ko:
            let open = shortcut.map { "\($0) 키나 노트 위의 서랍 버튼으로 열어요." } ?? "노트 위의 서랍 버튼으로 열어요."
            return "메모 탭에 있던 메모 \(MemoFolders.sheets(count))은 서랍의 ‘\(inbox)’ 폴더에 그대로 있어요. " + open
        case .en:
            let open = shortcut.map { "Open it with \($0) or the drawer button above the notepad." } ?? "Open it with the drawer button above the notepad."
            return "\(count == 1 ? "The note" : "All \(count) notes") from the Notes tab \(count == 1 ? "is" : "are") in the drawer’s ‘\(inbox)’ folder. " + open
        case .nl:
            let open = shortcut.map { "Open haar met \($0) of de ladeknop boven het notitieblok." } ?? "Open haar met de ladeknop boven het notitieblok."
            return "\(count == 1 ? "De notitie" : "Alle \(count) notities") van het tabblad Notities \(count == 1 ? "staat" : "staan") in de map ‘\(inbox)’ van de lade. " + open
        }
    }

    /// M4: what `/메모` and 빠른 메모 say once the memo is in: "메모 서랍에 넣었어요" with "열기".
    public static func addedToast(_ language: AppLanguage = .ko) -> (text: String, action: String) {
        [("메모 서랍에 넣었어요", "열기"), ("Added to the notes drawer", "Open"), ("In de notitielade gezet", "Openen")][language.index]
    }
}

// MARK: - Unknown keys (1.44)

/// A JSON value this version doesn't know the meaning of, kept so a read and a write give it back (D18).
public indirect enum KeptJSON: Equatable, Sendable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case null
    case array([KeptJSON])
    case object([String: KeptJSON])

    /// From what JSONSerialization read.
    public init(_ any: Any) {
        switch any {
        case let text as String: self = .string(text)
        case let number as NSNumber:
            if CFGetTypeID(number) == CFBooleanGetTypeID() {
                self = .bool(number.boolValue)
            } else if CFNumberIsFloatType(number) {
                let value = number.doubleValue
                // A whole number (1.0) is written as one (1), as JavaScript does.
                self = value.rounded() == value && abs(value) < 1e15 ? .int(Int(value)) : .double(value)
            } else {
                self = .int(number.intValue)
            }
        case let list as [Any]: self = .array(list.map(KeptJSON.init))
        case let dictionary as [String: Any]: self = .object(dictionary.mapValues(KeptJSON.init))
        default: self = .null
        }
    }

    /// On one line: `{ "a": 1, "b": [1, 2.5] }`, keys sorted; `{}` and `[]` when empty.
    public var compact: String {
        switch self {
        case .string(let text): MemoFolders.quote(text)
        case .int(let value): String(value)
        case .double(let value): "\(value)"
        case .bool(let value): value ? "true" : "false"
        case .null: "null"
        case .array(let list): list.isEmpty ? "[]" : "[" + list.map(\.compact).joined(separator: ", ") + "]"
        case .object(let dictionary):
            dictionary.isEmpty ? "{}" : "{ " + dictionary.sorted { $0.key < $1.key }.map { "\(MemoFolders.quote($0.key)): \($0.value.compact)" }.joined(separator: ", ") + " }"
        }
    }
}
