import Foundation

/// 할 일 스페이스 (1.45): to-dos split into a few spaces (회사 · 집 · 공부) without splitting the day — 오늘 still shows
/// them all, each with a small colour band, and the header can show one space for the rest of the day. Which space a
/// to-do is in lives beside todos.json in todo-spaces.json (an older version that saves todos.json drops keys it
/// doesn't know, so the place can't live on the to-do). Same file, rules and cases (S1–S22,
/// docs/plans/spaces-phase1.md, docs/plans/spaces-cases.json) as the Windows app (todoSpaces.ts):
///
///     { "general": { "name": "기타", "updatedAt": "…" },
///       "items": { "<todo id>": { "at": "…", "space": "s-7f3a9c" | null } },
///       "series": { "<repeat rule id>": { "space": "s-7f3a9c" | null, "updatedAt": "…" } },
///       "spaces": [{ "color": "pink", "id": "s-7f3a9c", "name": "회사", "order": 0, "updatedAt": "…" }, …],
///       "version": 1 }
///
/// A to-do without an entry has no space: it's in 일반 (#89 — the to-dos in no space, named ‘일반’ · ‘General’ ·
/// ‘Algemeen’ until renamed; `general` is in the file only once it's been renamed). `space: null` is a move to 일반 (kept
/// so it wins a merge). A deleted space stays as a tombstone for 30 days. A repeat rule's space (2a, `series`; repeats.json
/// keeps its shape for the same reason as todos.json) is where the to-dos made from it go. Keys this version doesn't know
/// are kept where they were.
public struct TodoSpaces: Equatable, Sendable {
    public static let fileName = "todo-spaces.json"
    /// Tombstones and the entries of to-dos that are gone are kept this long (S17, S22).
    public static let keepDays = 30
    public typealias Color = MemoFolders.Color

    public struct Space: Equatable, Sendable, Identifiable {
        public var id: String
        public var name: String
        /// One of `Color`'s keys; an unknown key (a newer app) is kept and drawn lavender.
        public var color: String
        public var order: Int
        public var updatedAt: Date
        public var deleted: Bool
        public var extra: [String: KeptJSON]

        public init(id: String, name: String, color: String, order: Int, updatedAt: Date, deleted: Bool = false, extra: [String: KeptJSON] = [:]) {
            self.id = id
            self.name = name
            self.color = color
            self.order = order
            self.updatedAt = updatedAt
            self.deleted = deleted
            self.extra = extra
        }

        public var colorKey: Color { Color(rawValue: color) ?? .lavender }
    }

    public struct Place: Equatable, Sendable {
        /// nil: moved to 스페이스 없음 (written as `null`).
        public var space: String?
        public var at: Date
        public var extra: [String: KeptJSON]

        public init(space: String?, at: Date, extra: [String: KeptJSON] = [:]) {
            self.space = space
            self.at = at
            self.extra = extra
        }
    }

    /// 일반's name once renamed (#89, S23–S26). `name` "" is back to the default — kept with its time, so the reset wins a
    /// merge (as `space: null` does).
    public struct General: Equatable, Sendable {
        public var name: String
        public var updatedAt: Date
        public var extra: [String: KeptJSON]

        public init(name: String, updatedAt: Date, extra: [String: KeptJSON] = [:]) {
            self.name = name
            self.updatedAt = updatedAt
            self.extra = extra
        }
    }

    /// A repeat rule's space (2a, A7): the to-dos made from it go there. `space` nil: moved to 일반 (written as `null`,
    /// kept so the move wins a merge).
    public struct SeriesPlace: Equatable, Sendable {
        public var space: String?
        public var updatedAt: Date
        public var extra: [String: KeptJSON]

        public init(space: String?, updatedAt: Date, extra: [String: KeptJSON] = [:]) {
            self.space = space
            self.updatedAt = updatedAt
            self.extra = extra
        }
    }

    public var version: Int
    public var spaces: [Space]
    /// By to-do id as todos.json writes it (an upper-case UUID in both apps).
    public var items: [String: Place]
    /// nil: never renamed (no `general` key in the file).
    public var general: General?
    /// By repeat rule id (repeats.json's series). nil: no `series` key in the file (a present one is written back as
    /// read, `{}` too).
    public var series: [String: SeriesPlace]?
    public var extra: [String: KeptJSON]

    public init(version: Int = 1, spaces: [Space] = [], items: [String: Place] = [:], general: General? = nil,
                series: [String: SeriesPlace]? = nil, extra: [String: KeptJSON] = [:]) {
        self.version = version
        self.spaces = spaces
        self.items = items
        self.general = general
        self.series = series
        self.extra = extra
    }

    // MARK: 일반 — the to-dos in no space (#89)

    /// The default names, ko · en · nl.
    public static let generalDefaults = ["일반", "General", "Algemeen"]

    public static func defaultGeneralName(_ language: AppLanguage) -> String { generalDefaults[language.index] }

    /// The name it was renamed to; nil while it's the default.
    public var generalRenamed: String? {
        guard let name = general?.name, !name.isEmpty else { return nil }
        return name
    }

    /// 일반 as shown: the renamed name, or the default in the app's language.
    public func generalName(_ language: AppLanguage) -> String { generalRenamed ?? Self.defaultGeneralName(language) }

    /// The names `#` finds it by (S27): the renamed one, or the default in every language.
    public var generalNames: [String] { generalRenamed.map { [$0] } ?? Self.generalDefaults }

    /// 일반 renamed (S23); blank or any language's default name: back to the default (S24 — nothing written when it is
    /// the default already).
    public mutating func renameGeneral(to name: String, now: Date) {
        var clean = MemoFolders.cleanName(name)
        if Self.generalDefaults.contains(where: { SpaceToken.normal($0) == SpaceToken.normal(clean) }) { clean = "" }
        guard clean != (general?.name ?? "") else { return }
        general = General(name: clean, updatedAt: Self.second(now), extra: general?.extra ?? [:])
    }

    // MARK: Reading where things are

    /// The spaces shown, in order (deleted ones left out).
    public var visible: [Space] {
        spaces.filter { !$0.deleted }.sorted { Self.before($0, $1) }
    }

    public var isEmpty: Bool { !spaces.contains { !$0.deleted } }

    public func space(_ id: String?) -> Space? {
        guard let id else { return nil }
        return spaces.first { $0.id == id && !$0.deleted }
    }

    /// A to-do's space: its entry's, when that space is live; else none (S12: the file keeps the entry).
    public func spaceID(of todoID: String) -> String? {
        guard let place = items[todoID]?.space, space(place) != nil else { return nil }
        return place
    }

    public func spaceID(of todo: UUID) -> String? { spaceID(of: todo.uuidString) }

    /// Every to-do's live space at once (drawing 2,000 rows looks each up once).
    public func index() -> [String: Space] {
        var live: [String: Space] = [:]
        for space in spaces where !space.deleted { live[space.id] = space }
        guard !live.isEmpty else { return [:] }
        var out: [String: Space] = [:]
        for (todo, place) in items {
            if let id = place.space, let space = live[id] { out[todo] = space }
        }
        return out
    }

    // MARK: Changing

    /// `s-` and six lowercase hex digits, not one the file already has.
    public func newID(random: () -> UInt32 = { UInt32.random(in: 0..<0x100_0000) }) -> String {
        while true {
            let id = "s-" + String(format: "%06x", random() & 0xFF_FFFF)
            if !spaces.contains(where: { $0.id == id }) { return id }
        }
    }

    /// W6: the first of the eight colours no live space has; all taken, the one at (live count % 8).
    public var nextColor: Color {
        let live = visible
        return Color.allCases.first { color in !live.contains { $0.color == color.rawValue } } ?? Color.allCases[live.count % Color.allCases.count]
    }

    /// A new space after the others; returns its id (nil for a blank name).
    @discardableResult
    public mutating func addSpace(name: String, color: Color? = nil, now: Date, id: String? = nil) -> String? {
        let clean = MemoFolders.cleanName(name)
        let id = id ?? newID()
        guard !clean.isEmpty, !spaces.contains(where: { $0.id == id }) else { return nil }
        let order = (visible.map(\.order).max() ?? -1) + 1
        spaces.append(Space(id: id, name: clean, color: (color ?? nextColor).rawValue, order: order, updatedAt: Self.second(now)))
        return id
    }

    public mutating func rename(_ id: String, to name: String, now: Date) {
        let clean = MemoFolders.cleanName(name)
        guard !clean.isEmpty, let i = spaces.firstIndex(where: { $0.id == id && !$0.deleted }), spaces[i].name != clean else { return }
        spaces[i].name = clean
        spaces[i].updatedAt = Self.second(now)
    }

    public mutating func recolor(_ id: String, to color: Color, now: Date) {
        guard let i = spaces.firstIndex(where: { $0.id == id && !$0.deleted }), spaces[i].color != color.rawValue else { return }
        spaces[i].color = color.rawValue
        spaces[i].updatedAt = Self.second(now)
    }

    /// A space deleted: a tombstone (its to-dos read as 스페이스 없음 from now on, their entries stay — S12). Returns the
    /// to-dos that were in it, for 되돌리기 (nil: no such live space).
    @discardableResult
    public mutating func deleteSpace(_ id: String, now: Date) -> [String]? {
        guard let i = spaces.firstIndex(where: { $0.id == id && !$0.deleted }) else { return nil }
        let todos = items.filter { $0.value.space == id }.map(\.key).sorted(by: Self.utf8Before)
        spaces[i].deleted = true
        spaces[i].updatedAt = Self.second(now)
        return todos
    }

    /// 되돌리기 after a delete: the space live again (a new time), its to-dos in it as they were.
    public mutating func restoreSpace(_ id: String, todoIDs: [String], now: Date) {
        guard let i = spaces.firstIndex(where: { $0.id == id }) else { return }
        let at = Self.second(now)
        spaces[i].deleted = false
        spaces[i].updatedAt = at
        for todo in todoIDs {
            var place = items[todo] ?? Place(space: id, at: at)
            place.space = id
            place.at = at
            items[todo] = place
        }
    }

    /// The spaces in a new order (ids top to bottom); each one whose place changed gets a new time.
    public mutating func reorder(_ ids: [String], now: Date) {
        let shown = visible.map(\.id)
        let order = ids.filter { shown.contains($0) } + shown.filter { !ids.contains($0) }
        for (index, id) in order.enumerated() {
            guard let i = spaces.firstIndex(where: { $0.id == id }), spaces[i].order != index else { continue }
            spaces[i].order = index
            spaces[i].updatedAt = Self.second(now)
        }
    }

    /// A to-do moved to a space, or to 스페이스 없음 (nil: written as an entry, so the move wins a merge — S14). Nothing
    /// for a space that isn't live, the space it's in already, or 없음 for a to-do that never had one.
    public mutating func move(_ todoID: String, to spaceID: String?, now: Date) {
        if let spaceID, space(spaceID) == nil { return }
        let current = items[todoID]
        if let current, current.space == spaceID { return }
        if current == nil && spaceID == nil { return }
        var place = current ?? Place(space: spaceID, at: now)
        place.space = spaceID
        place.at = Self.second(now)
        items[todoID] = place
    }

    /// S17, S22, S36: entries of to-dos that are gone and tombstones, each more than 30 days old, dropped before a write;
    /// so are the spaces of rules no longer in repeats.json (`seriesIDs`; nil when repeats.json couldn't be read: none
    /// dropped).
    public func pruned(todoIDs: Set<String>, seriesIDs: Set<String>? = nil, now: Date) -> TodoSpaces {
        let cutoff = now.addingTimeInterval(-Double(Self.keepDays) * 86_400)
        var copy = self
        copy.items = items.filter { todoIDs.contains($0.key) || $0.value.at >= cutoff }
        copy.spaces = spaces.filter { !$0.deleted || $0.updatedAt >= cutoff }
        if let seriesIDs, let series {
            copy.series = series.filter { seriesIDs.contains($0.key) || $0.value.updatedAt >= cutoff }
        }
        return copy
    }

    // MARK: Repeat rules' spaces (2a, A7–A10)

    /// A rule's live space (S35: a deleted one reads as 일반).
    public func seriesSpaceID(of seriesID: String?) -> String? {
        guard let seriesID, let place = series?[seriesID]?.space, space(place) != nil else { return nil }
        return place
    }

    /// S34: a rule moved to a space, or to 일반 (nil: an entry, so it wins a merge). Nothing for a space that isn't live,
    /// the one it has, or 일반 without an entry. Its open to-dos (`copies`) move with it, by the to-dos' own rule (W20).
    public mutating func setSeriesSpace(_ seriesID: String, to spaceID: String?, copies: [String] = [], now: Date) {
        if let spaceID, space(spaceID) == nil { return }
        let current = series?[seriesID]
        if current.map({ $0.space != spaceID }) ?? (spaceID != nil) {
            // A `series` this version couldn't read (kept as an unknown key) gives way to the one written now (S33odd).
            if series == nil { extra["series"] = nil }
            var place = current ?? SeriesPlace(space: spaceID, updatedAt: now)
            place.space = spaceID
            place.updatedAt = Self.second(now)
            var rules = series ?? [:]
            rules[seriesID] = place
            series = rules
        }
        for todo in copies { move(todo, to: spaceID, now: now) }
    }

    /// S35: to-dos just made from rules (to-do id, rule id), each put in its rule's live space; 일반, no entry or a gone
    /// space: nothing.
    public mutating func placeCopies(_ made: [(todo: String, series: String)], now: Date) {
        for copy in made {
            if let space = seriesSpaceID(of: copy.series) { move(copy.todo, to: space, now: now) }
        }
    }

    // MARK: Merging (S13–S15, W3)

    /// Two copies as one: spaces by id and entries by to-do id; `incoming` wins only when strictly newer, so on the same
    /// second the copy already in the file (`existing`) stays. Unknown top-level keys: the existing copy's, then any
    /// only the incoming one has.
    public static func merge(existing: TodoSpaces, incoming: TodoSpaces) -> TodoSpaces {
        var spaces = existing.spaces
        for their in incoming.spaces {
            if let i = spaces.firstIndex(where: { $0.id == their.id }) {
                if their.updatedAt > spaces[i].updatedAt { spaces[i] = their }
            } else {
                spaces.append(their)
            }
        }
        var items = existing.items
        for (todo, their) in incoming.items {
            if let mine = items[todo], their.at <= mine.at { continue }
            items[todo] = their
        }
        // 일반's name (S25): the later one; on the same second the file's stays.
        var general = existing.general
        if let their = incoming.general, general.map({ their.updatedAt > $0.updatedAt }) ?? true { general = their }
        // The rules' spaces (S32): by rule id, the same way.
        var series = existing.series
        if let theirs = incoming.series {
            var merged = series ?? [:]
            for (id, their) in theirs {
                if let mine = merged[id], their.updatedAt <= mine.updatedAt { continue }
                merged[id] = their
            }
            series = merged
        }
        var extra = existing.extra
        for (key, value) in incoming.extra where extra[key] == nil { extra[key] = value }
        if general != nil { extra["general"] = nil }
        if series != nil { extra["series"] = nil }
        return TodoSpaces(version: max(existing.version, incoming.version), spaces: spaces, items: items, general: general,
                          series: series, extra: extra)
    }

    // MARK: The file

    public enum ReadError: Error, Equatable { case unreadable }

    static let fileKeys: Set<String> = ["version", "spaces", "items"]
    static let spaceKeys: Set<String> = ["id", "name", "color", "order", "updatedAt", "deleted"]
    static let placeKeys: Set<String> = ["space", "at"]
    static let generalKeys: Set<String> = ["name", "updatedAt"]
    static let seriesKeys: Set<String> = ["space", "updatedAt"]

    /// The file read: throws when it isn't the spaces file at all (S21: kept aside, started afresh). Entries it can't
    /// use are left out; everything else, unknown keys too, is kept as read (S16).
    public static func decode(_ data: Data) throws -> TodoSpaces {
        guard let object = (try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed])) as? [String: Any] else { throw ReadError.unreadable }
        if let list = object["spaces"], !(list is [Any]) { throw ReadError.unreadable }
        if let items = object["items"], !(items is [String: Any]) { throw ReadError.unreadable }
        func unknown(_ dictionary: [String: Any], _ known: Set<String>) -> [String: KeptJSON] {
            var out: [String: KeptJSON] = [:]
            for (key, value) in dictionary where !known.contains(key) { out[key] = KeptJSON(value) }
            return out
        }
        var spaces: [Space] = []
        for (index, entry) in (object["spaces"] as? [Any] ?? []).enumerated() {
            guard let s = entry as? [String: Any], let id = s["id"] as? String, !id.isEmpty, !spaces.contains(where: { $0.id == id }),
                  let name = s["name"] as? String else { continue }
            spaces.append(Space(id: id, name: name, color: s["color"] as? String ?? Color.lavender.rawValue,
                                order: integer(s["order"]) ?? index, updatedAt: date(s["updatedAt"]),
                                deleted: (s["deleted"] as? NSNumber).map { CFGetTypeID($0) == CFBooleanGetTypeID() && $0.boolValue } ?? false,
                                extra: unknown(s, spaceKeys)))
        }
        var items: [String: Place] = [:]
        for (todo, entry) in object["items"] as? [String: Any] ?? [:] {
            guard let p = entry as? [String: Any] else { continue }
            let space: String?
            if p["space"] is NSNull {
                space = nil
            } else if let id = p["space"] as? String, !id.isEmpty {
                space = id
            } else {
                continue
            }
            items[todo] = Place(space: space, at: date(p["at"]), extra: unknown(p, placeKeys))
        }
        // 일반's name; a `general` this version can't read stays as it was, with the other unknown keys.
        var extra = unknown(object, fileKeys)
        var general: General?
        if let g = object["general"] as? [String: Any], let name = g["name"] as? String {
            general = General(name: name, updatedAt: date(g["updatedAt"]), extra: unknown(g, generalKeys))
            extra["general"] = nil
        }
        // The rules' spaces (A7): a `series` that isn't an object stays as it was, with the other unknown keys (S33odd);
        // entries it can't use are left out, as the to-dos' are (S33dropped).
        var series: [String: SeriesPlace]?
        if let list = object["series"] as? [String: Any] {
            var read: [String: SeriesPlace] = [:]
            for (id, entry) in list {
                guard let p = entry as? [String: Any] else { continue }
                let space: String?
                if p["space"] is NSNull {
                    space = nil
                } else if let value = p["space"] as? String, !value.isEmpty {
                    space = value
                } else {
                    continue
                }
                read[id] = SeriesPlace(space: space, updatedAt: date(p["updatedAt"]), extra: unknown(p, seriesKeys))
            }
            series = read
            extra["series"] = nil
        }
        return TodoSpaces(version: integer(object["version"]) ?? 1, spaces: spaces, items: items, general: general, series: series, extra: extra)
    }

    private static func integer(_ value: Any?) -> Int? {
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { return nil }
        let double = number.doubleValue
        return double.isFinite && double.rounded() == double && abs(double) < 1e15 ? Int(double) : nil
    }

    /// A time as both apps write it ("2026-10-28T09:01:00Z") read by hand — a file of 2,000 entries is read at every
    /// launch and catch-up, and making a formatter for each took a third of a second; anything else (fractions, an
    /// offset) through ISO8601DateFormatter. Unreadable: the epoch (W2).
    static func date(_ value: Any?) -> Date {
        guard let text = value as? String else { return Date(timeIntervalSince1970: 0) }
        if let fast = plainUTC(text) { return fast }
        let plain = ISO8601DateFormatter()
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return (plain.date(from: text) ?? fractional.date(from: text)).map(second) ?? Date(timeIntervalSince1970: 0)
    }

    /// "yyyy-MM-ddTHH:mm:ssZ" only; nil for anything else.
    static func plainUTC(_ text: String) -> Date? {
        let b = Array(text.utf8)
        guard b.count == 20, b[4] == 45, b[7] == 45, b[10] == 84, b[13] == 58, b[16] == 58, b[19] == 90 else { return nil }
        func number(_ range: Range<Int>) -> Int? {
            var out = 0
            for i in range {
                guard (48...57).contains(b[i]) else { return nil }
                out = out * 10 + Int(b[i] - 48)
            }
            return out
        }
        guard let year = number(0..<4), let month = number(5..<7), let day = number(8..<10), let hour = number(11..<13),
              let minute = number(14..<16), let secondValue = number(17..<19),
              (1...12).contains(month), (1...31).contains(day), hour < 24, minute < 60, secondValue < 61 else { return nil }
        // Days from 1970-01-01 (the civil-from-days algorithm, proleptic Gregorian).
        let y = month <= 2 ? year - 1 : year
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let doy = (153 * (month + (month > 2 ? -3 : 9)) + 2) / 5 + day - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        let days = era * 146_097 + doe - 719_468
        return Date(timeIntervalSince1970: TimeInterval(days * 86_400 + hour * 3600 + minute * 60 + secondValue))
    }

    /// W2: the file's text — every object spread out (2-space indent, `"key": value`), keys sorted at every depth (UTF-8
    /// byte order), spaces by order then id, `deleted` only when true, whole-second UTC times, a newline at the end. The
    /// Windows app writes the same bytes.
    public func encoded() -> String {
        let sorted = spaces.sorted { Self.before($0, $1) }
        let list: [KeptJSON] = sorted.map { s in
            var fields = s.extra
            fields["id"] = .string(s.id)
            fields["name"] = .string(s.name)
            fields["color"] = .string(s.color)
            fields["order"] = .int(s.order)
            fields["updatedAt"] = .string(Self.iso(s.updatedAt))
            if s.deleted { fields["deleted"] = .bool(true) } else { fields["deleted"] = nil }
            return .object(fields)
        }
        var places: [String: KeptJSON] = [:]
        for (todo, place) in items {
            var fields = place.extra
            fields["space"] = place.space.map(KeptJSON.string) ?? .null
            fields["at"] = .string(Self.iso(place.at))
            places[todo] = .object(fields)
        }
        var top = extra
        top["version"] = .int(version)
        top["spaces"] = .array(list)
        top["items"] = .object(places)
        if let general {
            var fields = general.extra
            fields["name"] = .string(general.name)
            fields["updatedAt"] = .string(Self.iso(general.updatedAt))
            top["general"] = .object(fields)
        }
        if let series {
            var rules: [String: KeptJSON] = [:]
            for (id, place) in series {
                var fields = place.extra
                fields["space"] = place.space.map(KeptJSON.string) ?? .null
                fields["updatedAt"] = .string(Self.iso(place.updatedAt))
                rules[id] = .object(fields)
            }
            top["series"] = .object(rules)
        }
        return KeptJSON.object(top).pretty() + "\n"
    }

    /// Atomic (temp file + rename).
    public func save(to url: URL) throws {
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try Data(encoded().utf8).write(to: url, options: .atomic)
    }

    /// "todo-spaces.json.unreadable-20261028-090000" (UTC), next to the file (S21).
    public static func asideName(_ now: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(identifier: "UTC")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return "\(fileName).unreadable-\(formatter.string(from: now))"
    }

    /// "2026-10-28T09:01:00Z" (UTC, whole seconds), written by hand for the same reason as `plainUTC`.
    public static func iso(_ date: Date) -> String {
        var time = time_t(date.timeIntervalSince1970.rounded(.down))
        var parts = tm()
        guard gmtime_r(&time, &parts) != nil else { return MemoFolders.iso(date) }
        func two(_ n: Int32) -> String { n < 10 ? "0\(n)" : "\(n)" }
        let year = Int(parts.tm_year) + 1900
        guard (0...9999).contains(year) else { return MemoFolders.iso(date) }
        let y = String(year)
        return String(repeating: "0", count: 4 - y.count) + y + "-" + two(parts.tm_mon + 1) + "-" + two(parts.tm_mday) + "T"
            + two(parts.tm_hour) + ":" + two(parts.tm_min) + ":" + two(parts.tm_sec) + "Z"
    }

    static func second(_ date: Date) -> Date { Date(timeIntervalSince1970: date.timeIntervalSince1970.rounded(.down)) }

    static func before(_ a: Space, _ b: Space) -> Bool { a.order != b.order ? a.order < b.order : utf8Before(a.id, b.id) }

    /// UTF-8 byte order (= Unicode code point order), as the Windows app sorts.
    static func utf8Before(_ a: String, _ b: String) -> Bool { a.unicodeScalars.lexicographicallyPrecedes(b.unicodeScalars) { $0.value < $1.value } }
}

// MARK: - Writing any value spread out (W2)

extension KeptJSON {
    /// `JSON.stringify(value, null, 2)` with keys sorted at every depth: `[]` / `{}` when empty.
    public func pretty(_ indent: String = "") -> String {
        let inner = indent + "  "
        switch self {
        case .array(let list):
            return list.isEmpty ? "[]" : "[\n" + list.map { inner + $0.pretty(inner) }.joined(separator: ",\n") + "\n\(indent)]"
        case .object(let dictionary):
            guard !dictionary.isEmpty else { return "{}" }
            let keys = dictionary.keys.sorted(by: TodoSpaces.utf8Before)
            return "{\n" + keys.map { "\(inner)\(MemoFolders.quote($0)): \(dictionary[$0]!.pretty(inner))" }.joined(separator: ",\n") + "\n\(indent)}"
        case .double(let value):
            return Self.shortest(value)
        default:
            return compact
        }
    }

    /// The shortest decimal, as JavaScript writes it (`1e-7`, `1e+21`, `2.5`).
    static func shortest(_ value: Double) -> String {
        guard value.isFinite else { return "null" }
        var text = "\(value)"
        if text.hasSuffix(".0") { text.removeLast(2) }
        guard let e = text.firstIndex(where: { $0 == "e" || $0 == "E" }) else { return text }
        var mantissa = String(text[..<e])
        if mantissa.hasSuffix(".0") { mantissa.removeLast(2) }
        var exponent = String(text[text.index(after: e)...])
        let sign = exponent.hasPrefix("-") ? "-" : "+"
        exponent = String(exponent.drop { $0 == "-" || $0 == "+" || $0 == "0" })
        return mantissa + "e" + sign + (exponent.isEmpty ? "0" : exponent)
    }
}

// MARK: - The `#` in the input line (W5)

public enum SpaceToken {
    public struct Found: Equatable, Sendable {
        /// The words after `#`.
        public var name: String
        /// Where `#name` is in the line.
        public var range: Range<String.Index>
    }

    /// The first `#name` that starts the line or follows a space or tab — not digits only (`#12`), not `##`; `C#` and
    /// `a#b` aren't tokens. Several lines (a memo): only the first is looked at.
    public static func find(_ text: String) -> Found? {
        let end = text.firstIndex(of: "\n") ?? text.endIndex
        var i = text.startIndex
        while i < end {
            if text[i] == "#", i == text.startIndex || text[text.index(before: i)] == " " || text[text.index(before: i)] == "\t" {
                let start = text.index(after: i)
                var stop = start
                while stop < end, !text[stop].isWhitespace { stop = text.index(after: stop) }
                let name = String(text[start..<stop])
                if !name.isEmpty, !name.allSatisfy({ ("0"..."9").contains($0) }), !name.hasPrefix("#") {
                    return Found(name: name, range: i..<stop)
                }
                i = stop
                continue
            }
            i = text.index(after: i)
        }
        return nil
    }

    /// The text without the token and the one space (or tab) before it.
    public static func removing(_ found: Found, from text: String) -> String {
        var start = found.range.lowerBound
        if start > text.startIndex {
            let before = text.index(before: start)
            if text[before] == " " || text[before] == "\t" { start = before }
        }
        return String(text[..<start]) + String(text[found.range.upperBound...])
    }

    /// For comparing: NFC, lower case, no blanks.
    static func normal(_ text: String) -> String {
        String(text.precomposedStringWithCanonicalMapping.lowercased().unicodeScalars.filter { !CharacterSet.whitespacesAndNewlines.contains($0) }.map(Character.init))
    }

    private static let initials: [Character] = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"]

    /// 회사 → ㅎㅅ: each syllable's first consonant, other characters as they are.
    static func initialsOf(_ text: String) -> String {
        String(text.unicodeScalars.map { scalar -> Character in
            (0xAC00...0xD7A3).contains(scalar.value) ? initials[Int(scalar.value - 0xAC00) / 588] : Character(scalar)
        })
    }

    /// Only ㄱ–ㅎ (compatibility jamo U+3131–U+314E).
    static func onlyInitials(_ text: String) -> Bool {
        !text.isEmpty && text.unicodeScalars.allSatisfy { (0x3131...0x314E).contains($0.value) }
    }

    public enum Choice: Equatable, Hashable, Sendable {
        case space(String)
        case new(String)
        case noSpace
    }

    /// S1–S4, S20, S27, S28: what a token could mean, best first — the whole name, then names it starts (space order),
    /// then names whose first consonants it starts (`#ㅎㅅ`). 일반 (`.noSpace`) is found by its names too (`#일반`, `#gen`,
    /// `#ㅇㅂ`; once renamed, by that name only), after the spaces of the same step — so a space with the same name comes
    /// first (S28). Nothing found: a new space by that name. 일반 comes last when it wasn't found.
    public static func choices(_ token: String, in spaces: TodoSpaces) -> [Choice] {
        let typed = normal(token)
        let names = spaces.visible.map { ($0, normal($0.name)) }
        let general = spaces.generalNames.map(normal)
        var found: [Choice] = []
        func add(_ choice: Choice) { if !found.contains(choice) { found.append(choice) } }
        for (space, name) in names where name == typed { add(.space(space.id)) }
        if general.contains(typed) { add(.noSpace) }
        for (space, name) in names where name.hasPrefix(typed) { add(.space(space.id)) }
        if general.contains(where: { $0.hasPrefix(typed) }) { add(.noSpace) }
        if onlyInitials(typed) {
            for (space, name) in names where initialsOf(name).hasPrefix(typed) { add(.space(space.id)) }
            if general.contains(where: { initialsOf($0).hasPrefix(typed) }) { add(.noSpace) }
        }
        let picks: [Choice] = found.isEmpty ? [.new(MemoFolders.cleanName(token))] : found
        return picks.contains(.noSpace) ? picks : picks + [.noSpace]
    }

    public struct Reading: Equatable, Sendable {
        /// The line to read for meaning: the token taken out.
        public var text: String
        public var token: Found?
        /// ⇧Tab (with a token) and a click on the chip go through these; empty: no chip.
        public var choices: [Choice]
    }

    /// A line read for its space. M2: with no spaces at all `#` isn't read (S19). No token: the lens's space (S7) —
    /// none while showing everything or 스페이스 없음.
    public static func read(_ text: String, spaces: TodoSpaces, lens: SpaceLens.Shown) -> Reading {
        guard !spaces.isEmpty else { return Reading(text: text, token: nil, choices: []) }
        if let token = find(text) {
            return Reading(text: removing(token, from: text), token: token, choices: choices(token.name, in: spaces))
        }
        if case .space(let id) = lens, spaces.space(id) != nil { return Reading(text: text, token: nil, choices: [.space(id)]) }
        return Reading(text: text, token: nil, choices: [])
    }
}

// MARK: - 한 스페이스만 보기 (a device setting, W9)

public struct SpaceLens: Codable, Equatable, Sendable {
    /// A space's id, or `none` (스페이스 없음만 보기).
    public var spaceId: String
    /// The logical (4 a.m.) day it was picked on, "yyyy-MM-dd".
    public var day: String

    public static let none = "none"

    public init(spaceId: String, day: String) {
        self.spaceId = spaceId
        self.day = day
    }

    /// What the today tab shows.
    public enum Shown: Equatable, Hashable, Sendable {
        case all
        case space(String)
        case noSpace

        /// Whether a to-do in `space` (nil: none) shows.
        public func includes(_ space: String?) -> Bool {
            switch self {
            case .all: true
            case .noSpace: space == nil
            case .space(let id): space == id
            }
        }

        public var lensID: String? {
            switch self {
            case .all: nil
            case .noSpace: SpaceLens.none
            case .space(let id): id
            }
        }
    }

    /// A lens picked now: for the rest of the logical day (nil for 모두).
    public static func picked(_ shown: Shown, now: Date, calendar: Calendar = .paper) -> SpaceLens? {
        shown.lensID.map { SpaceLens(spaceId: $0, day: Archive.dayKey(now, calendar: calendar)) }
    }

    /// S11, S12: what shows — everything once the 4 a.m. day has turned, when the space is gone, or when there are no
    /// spaces at all (S19).
    public static func shown(_ lens: SpaceLens?, spaces: TodoSpaces, now: Date, calendar: Calendar = .paper) -> Shown {
        guard let lens, lens.day == Archive.dayKey(now, calendar: calendar), !spaces.isEmpty else { return .all }
        if lens.spaceId == none { return .noSpace }
        return spaces.space(lens.spaceId) != nil ? .space(lens.spaceId) : .all
    }

    /// W8 / ⌥⌘1–9 the spaces in order, ⌥⌘0 everything; a digit with no space → nil (nothing happens).
    public static func forDigit(_ digit: Int, spaces: TodoSpaces) -> Shown? {
        if digit == 0 { return .all }
        let live = spaces.visible
        guard (1...9).contains(digit), digit <= live.count else { return nil }
        return .space(live[digit - 1].id)
    }
}

// MARK: - Words (W11, W12)

public enum SpaceWords {
    /// The final consonant of a word's last sound: 0 none, 8 ㄹ, else another (digits and Latin letters as read).
    static func final(_ word: String) -> Int {
        guard let last = word.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.last else { return 0 }
        if (0xAC00...0xD7A3).contains(last.value) { return Int(last.value - 0xAC00) % 28 }
        switch Character(last).lowercased() {
        case "1", "7", "8", "l", "r": return 8 // 일 칠 팔 엘 알
        case "0", "3", "6", "m", "n": return 1 // 영 삼 육 엠 엔
        default: return 0
        }
    }

    /// 회사로 · 집으로 · 서울로 (ㄹ takes 로).
    public static func ro(_ word: String) -> String { [0, 8].contains(final(word)) ? "로" : "으로" }

    /// 회사를 · 집을.
    public static func eul(_ word: String) -> String { final(word) == 0 ? "를" : "을" }

    /// "회사로 옮겼어요" · "Moved to Work" · "Verplaatst naar Werk" (`name` already in the app's language).
    public static func moved(to name: String, language: AppLanguage = .ko) -> String {
        switch language {
        case .ko: "\(name)\(ro(name)) 옮겼어요"
        case .en: "Moved to \(name)"
        case .nl: "Verplaatst naar \(name)"
        }
    }

    /// "스페이스 ‘회사’를 지웠어요" · "Deleted the space ‘Work’" · "Ruimte ‘Werk’ verwijderd".
    public static func deleted(_ name: String, language: AppLanguage = .ko) -> String {
        switch language {
        case .ko: "스페이스 ‘\(name)’\(eul(name)) 지웠어요"
        case .en: "Deleted the space ‘\(name)’"
        case .nl: "Ruimte ‘\(name)’ verwijderd"
        }
    }

    /// "회사만 보는 중" · "Showing Work only" · "Alleen Werk zichtbaar" (일반 too, by its name) — the header button's
    /// spoken label.
    public static func showing(_ name: String, language: AppLanguage = .ko) -> String {
        ["\(name)만 보는 중", "Showing \(name) only", "Alleen \(name) zichtbaar"][language.index]
    }

    /// #87, the faint line at the end of the list while one space shows: "다른 스페이스에 4개 더" · "4 more in other
    /// spaces" · "Nog 4 in andere ruimtes" (followed by 모두 보기; no line for 0).
    public static func more(_ count: Int, language: AppLanguage = .ko) -> String {
        let n = grouped(count, language)
        return ["다른 스페이스에 \(n)개 더", "\(n) more in other spaces", "Nog \(n) in andere ruimtes"][language.index]
    }

    /// The header button for a screen reader while one space shows (#87): "회사만 보는 중, 다른 스페이스에 4개 더".
    public static func lensLabel(_ name: String, hidden: Int, language: AppLanguage = .ko) -> String {
        let showing = showing(name, language: language)
        guard hidden > 0 else { return showing }
        let n = grouped(hidden, language)
        return [", 다른 스페이스에 \(n)개 더", ", \(n) more in other spaces", ", nog \(n) in andere ruimtes"].map { showing + $0 }[language.index]
    }

    /// 1,466 (ko, en) · 1.466 (nl), as the tab's count is written.
    public static func grouped(_ count: Int, _ language: AppLanguage) -> String {
        let digits = String(abs(count))
        var out = ""
        for (i, c) in digits.enumerated() {
            if i > 0 && (digits.count - i) % 3 == 0 { out += language == .nl ? "." : "," }
            out.append(c)
        }
        return (count < 0 ? "-" : "") + out
    }

    /// The header button: "회사만" · "Work only" · "Alleen Werk" (일반: "일반만").
    public static func only(_ name: String, language: AppLanguage = .ko) -> String {
        ["\(name)만", "\(name) only", "Alleen \(name)"][language.index]
    }

    /// The input line's hint while one space shows: "회사 스페이스에 넣어요: 할 일, 일정" (the name is the space's,
    /// not a place to write at — #37).
    public static func writeIn(_ name: String, language: AppLanguage = .ko) -> String {
        ["\(name) 스페이스에 넣어요: 할 일, 일정", "Adding to \(name): a to-do, an event", "Naar \(name): een taak, afspraak"][language.index]
    }

    /// The hint when the long one doesn't fit: "회사 스페이스에 넣어요" · "Adding to Work" · "Naar Werk".
    public static func writeInShort(_ name: String, language: AppLanguage = .ko) -> String {
        ["\(name) 스페이스에 넣어요", "Adding to \(name)", "Naar \(name)"][language.index]
    }

    /// "새 스페이스 ‘세탁’" · "New space ‘Laundry’" · "Nieuwe ruimte ‘Was’".
    public static func newSpace(_ name: String, language: AppLanguage = .ko) -> String {
        ["새 스페이스 ‘\(name)’", "New space ‘\(name)’", "Nieuwe ruimte ‘\(name)’"][language.index]
    }

    /// "모든 스페이스" · "All spaces" · "Alle ruimtes".
    public static func allSpaces(_ language: AppLanguage = .ko) -> String { ["모든 스페이스", "All spaces", "Alle ruimtes"][language.index] }

    /// S5: a line that is only the token — "할 일 내용을 적어 주세요" · "Write what the to-do is" · "Schrijf wat de taak is".
    public static func needsTitle(_ language: AppLanguage = .ko) -> String {
        ["할 일 내용을 적어 주세요", "Write what the to-do is", "Schrijf wat de taak is"][language.index]
    }

    /// C4, under the empty search slip's hint: "#회사처럼 적으면 그 스페이스에서만 찾아요" (the first space's name, blanks left
    /// out as `#` reads it).
    public static func searchHint(_ name: String, language: AppLanguage = .ko) -> String {
        let tag = "#" + name.filter { !$0.isWhitespace }
        return ["\(tag)처럼 적으면 그 스페이스에서만 찾아요", "Type \(tag) to look in that space only",
                "Typ \(tag) om alleen in die ruimte te zoeken"][language.index]
    }
}

// MARK: - The record's spaces (spaces 2c)

extension TodoSpaces {
    /// C5: a record line's space — its own `space` while that space is live, else the to-do's place here (kept 30 days
    /// after it left the list), else 일반 (nil).
    public func spaceID(of entry: ArchiveEntry) -> String? {
        if let own = entry.space, space(own) != nil { return own }
        return spaceID(of: entry.id)
    }

    /// H3: a focus line's space — its own `space` while live, else its task's place, else 일반 (nil). A plain timer
    /// (no task) is in no space at all: `kept(_:in:)` leaves it out of every space and of 일반.
    public func spaceID(of record: FocusRecord) -> String? {
        if let own = record.space, space(own) != nil { return own }
        return record.taskId.flatMap { spaceID(of: $0.uppercased()) }
    }

    /// H1–H2: the record lines of one space (`.all`: every line).
    public func kept(_ entries: [ArchiveEntry], in filter: SpaceFilter) -> [ArchiveEntry] {
        switch filter {
        case .all: entries
        case .general: entries.filter { spaceID(of: $0) == nil }
        case .space(let id): entries.filter { spaceID(of: $0) == id }
        }
    }

    /// H1–H3: the focus lines of one space; a plain timer only with `.all`.
    public func kept(_ records: [FocusRecord], in filter: SpaceFilter) -> [FocusRecord] {
        switch filter {
        case .all: records
        case .general: records.filter { $0.taskId != nil && spaceID(of: $0) == nil }
        case .space(let id): records.filter { $0.taskId != nil && spaceID(of: $0) == id }
        }
    }
}

/// 완료 기록's `모든 스페이스 ▾` (spaces 2c, H1): every line, 일반's, or one space's.
public enum SpaceFilter: Hashable, Sendable {
    case all, general
    case space(String)

    /// The filter as it still stands: a space deleted since is back to all (H4).
    public func live(in spaces: TodoSpaces) -> SpaceFilter {
        if case .space(let id) = self, spaces.space(id) == nil { return .all }
        if self == .general, spaces.isEmpty { return .all }
        return self
    }
}
