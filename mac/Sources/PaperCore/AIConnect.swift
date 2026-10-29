import Foundation

/// 종이냥 for Claude (1.42): what the app and the extension share — `ai-link.json`, written by the app, and
/// `ai-log.jsonl`, appended by the extension (and by the app's undo). Both live in the app's settings folder
/// (`~/Library/Application Support/<bundle id>/`). Same formats, texts and cases as the Windows app and the
/// extension (the shared AI connection spec; cases M13–M15 here).
///
/// Everything here is pure: the app reads and writes the files, this decides what they mean.
public enum AIConnect {
    public static let linkFile = "ai-link.json"
    public static let logFile = "ai-log.jsonl"
    /// Past this the app rewrites the log with the last 30 days.
    public static let logLimit = 1_000_000
    public static let keepDays = 30

    // MARK: ai-link.json

    public struct Link: Codable, Equatable, Sendable {
        public var v: Int
        public var enabled: Bool
        public var dataFolder: String
        public var lang: String
        public var app: String
        public var updatedAt: String

        public init(enabled: Bool, dataFolder: String, lang: AppLanguage, app: String, now: Date = Date()) {
            v = 1
            self.enabled = enabled
            self.dataFolder = dataFolder
            self.lang = lang.rawValue
            self.app = app
            updatedAt = AIConnect.isoText(now)
        }

        public func encoded() -> Data {
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
            return (try? encoder.encode(self)) ?? Data()
        }
    }

    /// "2026-10-27T05:12:03Z": UTC, whole seconds (the log's and the link's format).
    public static func isoText(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(identifier: "UTC")
        return formatter.string(from: Date(timeIntervalSince1970: date.timeIntervalSince1970.rounded(.down)))
    }

    // MARK: Claude Code

    /// The server's name in Claude Code (the same as the extension's).
    public static let codeName = "jongi-nyang"

    /// What `claude mcp add-json` gets: Node, by its full path (an app opened from the Dock has a short PATH, and
    /// so may Claude Code), running the app's copy of the program.
    public static func codeServerJSON(node: String, server: String) -> String {
        let object: [String: Any] = ["type": "stdio", "command": node, "args": [server]]
        let data = (try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys, .withoutEscapingSlashes])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    /// `claude mcp add-json -s user …`: the user scope, so every Claude Code session sees it — the terminal's
    /// and Claude Desktop's Code tab, in any folder (without `-s` it would be the one folder it ran in).
    public static func codeAddArguments(node: String, server: String) -> [String] {
        ["mcp", "add-json", "-s", "user", codeName, codeServerJSON(node: node, server: server)]
    }

    /// An entry left by an earlier connection goes first (add-json refuses a name that is taken).
    public static let codeRemoveArguments = ["mcp", "remove", "-s", "user", codeName]

    /// The same as one line to paste into Terminal, when the app can't run it.
    public static func codeCommand(claude: String = "claude", node: String, server: String) -> String {
        ([claude] + codeAddArguments(node: node, server: server)).map(shellQuoted).joined(separator: " ")
    }

    /// 'text' for zsh, unless it needs nothing.
    static func shellQuoted(_ text: String) -> String {
        let plain = CharacterSet(charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./=:")
        if !text.isEmpty, text.unicodeScalars.allSatisfy(plain.contains) { return text }
        return "'" + text.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    /// Where `claude` and `node` usually are, looked at before asking a login shell.
    public static func toolPlaces(_ tool: String, home: String) -> [String] {
        switch tool {
        case "claude":
            return ["\(home)/.local/bin/claude", "\(home)/.claude/local/claude", "/opt/homebrew/bin/claude",
                    "/usr/local/bin/claude", "\(home)/.npm-global/bin/claude", "\(home)/.bun/bin/claude"]
        case "node":
            return ["/opt/homebrew/bin/node", "/usr/local/bin/node", "\(home)/.volta/bin/node", "/usr/bin/node"]
        default:
            return []
        }
    }

    /// A program inside the app can be linked only while the app stays where it is: not opened from the disk
    /// image, nor from where macOS moved it to check it (App Translocation).
    public static func movablePlace(_ appPath: String) -> Bool {
        appPath.hasPrefix("/Volumes/") || appPath.contains("/AppTranslocation/")
    }

    // MARK: ai-log.jsonl

    public enum Kind: String, Sendable { case add, change, undo, unknown }
    public enum Target: String, Sendable { case todos, events, memos, unknown }

    public struct Change: Equatable, Sendable {
        public var file: String
        public var id: String
        public var before: JSONValue?
        public var after: JSONValue?

        public init(file: String, id: String, before: JSONValue?, after: JSONValue?) {
            self.file = file; self.id = id; self.before = before; self.after = after
        }
    }

    public struct Entry: Equatable, Sendable {
        public var id: String
        public var at: Date
        public var client: String
        public var tool: String
        public var kind: Kind
        public var target: Target
        public var count: Int
        public var title: String
        public var undoes: String?
        public var changes: [Change]

        public init(id: String, at: Date, client: String = "Claude", tool: String = "", kind: Kind, target: Target, count: Int? = nil,
                    title: String = "", undoes: String? = nil, changes: [Change] = []) {
            self.id = id; self.at = at; self.client = client; self.tool = tool; self.kind = kind; self.target = target
            self.count = count ?? changes.count; self.title = title; self.undoes = undoes; self.changes = changes
        }

        /// Something Claude did (not the app's own undo, not a kind this version doesn't know).
        public var isAIWork: Bool { (kind == .add || kind == .change) && client != "app" && target != .unknown }

        /// One log line (the app writes its undo entries with this).
        public func line() -> String {
            var object: [String: JSONValue] = [
                "v": .number(1), "id": .string(id), "at": .string(AIConnect.isoText(at)), "client": .string(client),
                "tool": .string(tool), "kind": .string(kind.rawValue), "target": .string(target.rawValue),
                "count": .number(Double(count)), "title": .string(title),
                "changes": .array(changes.map { change in
                    .object(["file": .string(change.file), "id": .string(change.id),
                             "before": change.before ?? .null, "after": change.after ?? .null])
                }),
            ]
            if let undoes { object["undoes"] = .string(undoes) }
            return JSONValue.object(object).text
        }
    }

    /// Every readable line, in order. A broken line (half-written, hand-edited) is skipped, and the rest still
    /// read; a line without an id, a time or a kind is skipped too. Unknown kinds and targets are kept as
    /// `.unknown` (a newer extension may write more) and never shown.
    public static func parse(_ text: String) -> [Entry] {
        var entries: [Entry] = []
        for line in text.split(whereSeparator: \.isNewline) {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            guard trimmed.hasPrefix("{"), let entry = entry(trimmed) else { continue }
            entries.append(entry)
        }
        return entries
    }

    static func entry(_ line: String) -> Entry? {
        guard let value = JSONValue.parse(line), case .object(let o) = value,
              let id = o["id"]?.string, !id.isEmpty,
              let atText = o["at"]?.string, let at = Archive.isoDate(atText),
              let kindText = o["kind"]?.string else { return nil }
        let changes: [Change] = (o["changes"]?.array ?? []).compactMap { item in
            guard case .object(let c) = item, let id = c["id"]?.string else { return nil }
            return Change(file: c["file"]?.string ?? "", id: id, before: c["before"]?.nonNull, after: c["after"]?.nonNull)
        }
        return Entry(id: id, at: at, client: o["client"]?.string ?? "Claude", tool: o["tool"]?.string ?? "",
                     kind: Kind(rawValue: kindText) ?? .unknown, target: Target(rawValue: o["target"]?.string ?? "") ?? .unknown,
                     count: o["count"]?.number.map { max(0, Int($0)) } ?? changes.count,
                     title: o["title"]?.string ?? "", undoes: o["undoes"]?.string, changes: changes)
    }

    /// Entries an undo (by this app or another) has taken back.
    public static func undone(_ entries: [Entry]) -> Set<String> {
        Set(entries.filter { $0.kind == .undo }.compactMap(\.undoes))
    }

    // MARK: Seen until

    /// The last entry the app has dealt with; kept in the app's own settings.
    public struct Seen: Codable, Equatable, Sendable {
        public var id: String
        public var at: Date
        public init(id: String, at: Date) { self.id = id; self.at = at }
    }

    /// The entries after `seen`: after that line when it's still in the log, otherwise (the log was trimmed or
    /// rewritten) the ones written later than it. Nothing seen yet: everything.
    public static func unseen(_ entries: [Entry], after seen: Seen?) -> [Entry] {
        guard let seen else { return entries }
        if let index = entries.lastIndex(where: { $0.id == seen.id }) { return Array(entries[(index + 1)...]) }
        return entries.filter { $0.at > seen.at }
    }

    /// Where "seen until" goes after reading `entries` (unchanged when there's nothing).
    public static func advance(_ seen: Seen?, over entries: [Entry]) -> Seen? {
        entries.last.map { Seen(id: $0.id, at: $0.at) } ?? seen
    }

    /// 자리 비운 사이: how many things Claude did while the app was closed — the items it added or changed,
    /// leaving out what was already taken back (M15).
    public static func awayCount(_ unseen: [Entry], undone: Set<String>) -> Int {
        unseen.filter { $0.isAIWork && !undone.contains($0.id) }.reduce(0) { $0 + $1.count }
    }

    // MARK: Marks

    /// Item ids (to-dos uppercased, events as written) Claude added or changed on the logical day of `now`
    /// (4 a.m. rule), not taken back since and not edited here since (`cleared`).
    public static func marks(_ entries: [Entry], now: Date, cleared: Set<String> = [], calendar: Calendar = .paper) -> Set<String> {
        let day = Archive.dayKey(now, calendar: calendar)
        let undone = undone(entries)
        var ids = Set<String>()
        for entry in entries where entry.isAIWork && entry.target != .memos && !undone.contains(entry.id)
            && Archive.dayKey(entry.at, calendar: calendar) == day {
            for change in entry.changes { ids.insert(markID(change.id, entry.target)) }
        }
        // A later undo of a different entry may still have put an item back: its ids go too.
        for entry in entries where entry.kind == .undo && Archive.dayKey(entry.at, calendar: calendar) == day {
            for change in entry.changes where change.after == nil { ids.remove(markID(change.id, entry.target)) }
        }
        return ids.subtracting(cleared)
    }

    /// To-do ids are UUIDs (the Windows app may write them in lower case); events keep theirs.
    public static func markID(_ id: String, _ target: Target) -> String { target == .todos ? id.uppercased() : id }

    // MARK: Recent work

    /// Settings → AI 연결 → 최근 AI 작업: today's and yesterday's work (logical days), newest first.
    public static func recent(_ entries: [Entry], now: Date, calendar: Calendar = .paper) -> [Entry] {
        let today = Archive.logicalDayStart(now, calendar: calendar)
        guard let yesterday = calendar.date(byAdding: .day, value: -1, to: today) else { return [] }
        let days = [Archive.dayKey(today, calendar: calendar), Archive.dayKey(yesterday, calendar: calendar)]
        return entries.filter { $0.isAIWork && days.contains(Archive.dayKey($0.at, calendar: calendar)) }.reversed()
    }

    // MARK: Trimming

    /// The log past `limit` bytes: the lines of the last `keepDays` days (broken lines go too). Nil when it's
    /// small enough, or when nothing would go.
    public static func trimmed(_ text: String, now: Date, limit: Int = logLimit, keepDays: Int = keepDays) -> String? {
        guard text.utf8.count > limit else { return nil }
        let cutoff = now.addingTimeInterval(-Double(keepDays) * 86_400)
        let lines = text.split(whereSeparator: \.isNewline)
        let kept = lines.filter { line in entry(String(line)).map { $0.at >= cutoff } ?? false }
        guard kept.count < lines.count else { return nil }
        return kept.isEmpty ? "" : kept.joined(separator: "\n") + "\n"
    }

    // MARK: Undo

    /// What undoing one change does to the item as it is now (`current`; nil = not there).
    public enum UndoStep: Equatable, Sendable {
        /// Still as Claude left it: put `before` back.
        case restore(JSONValue)
        /// Claude added it and it's untouched: it goes.
        case remove
        /// Already as it was before (or the added item is gone): nothing to do.
        case alreadyBack
        /// Changed since (here, on another device, by Claude again): left alone (M14).
        case changedSince
    }

    public static func undoStep(_ change: Change, target: Target, current: JSONValue?) -> UndoStep {
        if sameSaved(current, change.after, target) {
            if let before = change.before { return sameSaved(current, before, target) ? .alreadyBack : .restore(before) }
            return current == nil ? .alreadyBack : .remove
        }
        if sameSaved(current, change.before, target) { return .alreadyBack }
        return .changedSince
    }

    /// The outcome of undoing an entry: how many items went back and how many were left as they are.
    public struct UndoOutcome: Equatable, Sendable {
        public var undone: Int
        public var left: Int
        public init(undone: Int, left: Int) { self.undone = undone; self.left = left }
        public var isComplete: Bool { left == 0 }
    }

    /// The fields a person sees and edits; bookkeeping (createdAt, completedAt, updatedAt, 어제부터's todaySince,
    /// a delivered alert, skipped days) doesn't stop an undo. A missing key equals null; times are compared as
    /// instants (one app writes ".000Z", the other doesn't).
    static func savedKeys(_ target: Target) -> [String] {
        switch target {
        case .todos: ["title", "isCompleted", "dueDate", "shelf", "timeStart", "timeEnd", "reminderAt", "seriesID"]
        case .events: ["title", "date", "allDay", "days", "start", "end", "repeat", "location", "color"]
        case .memos: ["text"]
        case .unknown: []
        }
    }

    static let dateKeys: Set<String> = ["reminderAt"]

    public static func sameSaved(_ a: JSONValue?, _ b: JSONValue?, _ target: Target) -> Bool {
        switch (a?.nonNull, b?.nonNull) {
        case (nil, nil): return true
        case (nil, _), (_, nil): return false
        case let (.object(x)?, .object(y)?):
            for key in savedKeys(target) where !sameField(x[key], y[key], date: dateKeys.contains(key)) { return false }
            return true
        case let (x?, y?): return x == y
        }
    }

    static func sameField(_ a: JSONValue?, _ b: JSONValue?, date: Bool) -> Bool {
        let x = a?.nonNull, y = b?.nonNull
        if date, let s = x?.string, let t = y?.string, let d = Archive.isoDate(s), let e = Archive.isoDate(t) {
            return Int(d.timeIntervalSince1970) == Int(e.timeIntervalSince1970)
        }
        // "false" written or left out reads the same for flags like allDay.
        if x == nil, y == .bool(false) { return true }
        if y == nil, x == .bool(false) { return true }
        return x == y
    }

    // MARK: Item ⇄ JSON

    /// An item as the files store it (ISO 8601 dates), for comparing with the log.
    public static func json<T: Encodable>(_ value: T) -> JSONValue? {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(value), let text = String(data: data, encoding: .utf8) else { return nil }
        return JSONValue.parse(text)
    }

    /// An item from the log (dates with or without fractional seconds).
    public static func decode<T: Decodable>(_ type: T.Type, from value: JSONValue) -> T? {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            guard let date = Archive.isoDate(text) else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Not an ISO 8601 date: \(text)"))
            }
            return date
        }
        return try? decoder.decode(type, from: Data(value.text.utf8))
    }

    // MARK: What changed

    public enum ChangeKind: Equatable, Sendable { case time, date, done, other }

    /// For a one-item change: what Claude changed, for the toast's wording.
    public static func changeKind(_ change: Change) -> ChangeKind {
        guard case .object(let before)? = change.before, case .object(let after)? = change.after else { return .other }
        let ignored: Set<String> = ["updatedAt", "createdAt", "completedAt", "todaySince", "reminderLastDeliveredAt"]
        let keys = Set(before.keys).union(after.keys).subtracting(ignored).filter { key in
            !sameField(before[key], after[key], date: dateKeys.contains(key))
        }
        guard !keys.isEmpty else { return .other }
        if keys.contains("isCompleted") { return after["isCompleted"] == .bool(true) ? .done : .other }
        let time: Set<String> = ["timeStart", "timeEnd", "start", "end", "allDay"]
        let date: Set<String> = ["dueDate", "shelf", "date", "days"]
        let rest = keys.subtracting(["reminderAt"])
        if !rest.isEmpty, rest.isSubset(of: time) { return .time }
        if !rest.isEmpty, rest.isSubset(of: date) { return .date }
        if rest.isEmpty { return .time }
        return .other
    }
}

// MARK: - Texts

/// The app builds every sentence itself from kind, target, count and title (the log holds no sentences).
/// en/nl as in the plan's table (drafts before translation review); the Windows app has the same table, except that
/// this app's Dutch says "Herstel" for 되돌리기, as everywhere else in it (Windows keeps its "Ongedaan maken").
public enum AIText {
    /// "할 일" / "task(s)" / "taak/taken".
    public static func unit(_ target: AIConnect.Target, count: Int, _ language: AppLanguage) -> String {
        let one = count == 1
        switch (target, language) {
        case (.events, .ko): return "일정"
        case (.memos, .ko): return "메모"
        case (_, .ko): return "할 일"
        case (.events, .en): return one ? "event" : "events"
        case (.memos, .en): return one ? "note" : "notes"
        case (_, .en): return one ? "task" : "tasks"
        case (.events, .nl): return one ? "afspraak" : "afspraken"
        case (.memos, .nl): return one ? "notitie" : "notities"
        case (_, .nl): return one ? "taak" : "taken"
        }
    }

    /// Long titles are cut so the toast stays on one or two lines.
    public static func shortTitle(_ title: String, limit: Int = 24) -> String {
        let clean = title.split(whereSeparator: \.isNewline).first.map(String.init)?.trimmingCharacters(in: .whitespaces) ?? ""
        return clean.count > limit ? String(clean.prefix(limit - 1)) + "…" : clean
    }

    /// "Claude가 할 일 2개를 넣었어요", "Claude가 ‘보고서 쓰기’ 시간을 바꿨어요" …
    public static func toast(_ entry: AIConnect.Entry, _ language: AppLanguage) -> String {
        let n = entry.count
        let unit = unit(entry.target, count: n, language)
        if entry.kind == .add {
            return [ "Claude가 \(unit) \(n)개를 넣었어요", "Claude added \(n) \(unit)", "Claude heeft \(n) \(unit) toegevoegd"][language.index]
        }
        guard n == 1, let change = entry.changes.first else {
            return ["Claude가 \(unit) \(n)개를 바꿨어요", "Claude changed \(n) \(unit)", "Claude heeft \(n) \(unit) gewijzigd"][language.index]
        }
        let title = shortTitle(entry.title.isEmpty ? (change.after?["title"]?.string ?? "") : entry.title)
        switch AIConnect.changeKind(change) {
        case .time:
            return ["Claude가 ‘\(title)’ 시간을 바꿨어요", "Claude changed the time of ‘\(title)’", "Claude heeft de tijd van ‘\(title)’ gewijzigd"][language.index]
        case .date:
            return ["Claude가 ‘\(title)’ 날짜를 바꿨어요", "Claude changed the date of ‘\(title)’", "Claude heeft de datum van ‘\(title)’ gewijzigd"][language.index]
        case .done:
            return ["Claude가 ‘\(title)’ 완료 표시를 했어요", "Claude checked off ‘\(title)’", "Claude heeft ‘\(title)’ afgevinkt"][language.index]
        case .other:
            let ko = entry.target == .events ? "일정" : "할 일"
            return ["Claude가 ‘\(title)’ \(ko)을 바꿨어요", "Claude changed the \(unit) ‘\(title)’", "Claude heeft de \(unit) ‘\(title)’ gewijzigd"][language.index]
        }
    }

    /// 자리 비운 사이 (once, at launch).
    public static func away(_ count: Int, _ language: AppLanguage) -> String {
        switch language {
        case .ko: "자리 비운 사이 Claude가 \(count)가지를 했어요"
        case .en: "While you were away, Claude made \(count) \(count == 1 ? "change" : "changes")"
        case .nl: "Terwijl je weg was, heeft Claude \(count) \(count == 1 ? "ding" : "dingen") gedaan"
        }
    }

    public static func undoAction(_ language: AppLanguage) -> String { ["되돌리기", "Undo", "Herstel"][language.index] }
    public static func showAction(_ language: AppLanguage) -> String { ["보기", "Show", "Bekijken"][language.index] }

    /// After 되돌리기: all back, some back (partial), or nothing (M14).
    public static func undoResult(_ outcome: AIConnect.UndoOutcome, _ language: AppLanguage) -> String {
        if outcome.undone == 0 {
            return ["그새 바뀌어서 되돌리지 못했어요", "It changed since, so it can’t be undone", "Het is intussen gewijzigd, dus herstellen lukt niet"][language.index]
        }
        if outcome.isComplete { return ["되돌렸어요", "Undone", "Hersteld"][language.index] }
        let (done, left) = (outcome.undone, outcome.left)
        return ["\(done)개는 되돌리고, 그새 바뀐 \(left)개는 그대로 뒀어요",
                "Undid \(done); \(left) changed since, so \(left == 1 ? "it stays" : "they stay")",
                "\(done) hersteld; \(left) intussen gewijzigd, \(left == 1 ? "die blijft" : "die blijven") staan"][language.index]
    }

    /// The recent-work list's mark on an entry that was taken back.
    public static func undoneLabel(_ language: AppLanguage) -> String { ["되돌림", "Undone", "Hersteld"][language.index] }

    // MARK: The cat

    /// Now and then, after a toast: a line in the chatter's voice. Only for Claude's own work, not more than once
    /// in two hours, and only half the time.
    public static func catLine(_ entry: AIConnect.Entry, lastSaid: Date?, now: Date, random: () -> Double, _ language: AppLanguage) -> String? {
        guard entry.isAIWork else { return nil }
        if let lastSaid, now.timeIntervalSince(lastSaid) < 2 * 3600 { return nil }
        guard random() < 0.5 else { return nil }
        if entry.kind == .add, entry.target != .memos {
            let n = entry.count
            let unit = unit(entry.target, count: n, language)
            switch language {
            case .ko:
                let counted = n == 1 ? "하나" : n <= 5 ? ["두", "세", "네", "다섯"][n - 2] + " 개" : "\(n)개"
                return "Claude가 \(unit) \(counted) 놓고 갔어요."
            case .en:
                let word = n <= 5 ? ["one", "two", "three", "four", "five"][n - 1] : "\(n)"
                return "Claude left \(word) \(unit) for you."
            case .nl:
                let word = n <= 5 ? ["één", "twee", "drie", "vier", "vijf"][n - 1] : "\(n)"
                return "Claude heeft \(word) \(unit) voor je klaargezet."
            }
        }
        return ["Claude랑 계획 세웠어요? 저도 볼게요.", "Did you make plans with Claude? Let me have a look too.",
                "Samen met Claude plannen gemaakt? Ik kijk even mee."][language.index]
    }
}

// MARK: - JSON values

/// A JSON value as written (the log keeps whole items, in whichever app's key order).
public enum JSONValue: Equatable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public static func parse(_ text: String) -> JSONValue? {
        guard let object = try? JSONSerialization.jsonObject(with: Data(text.utf8), options: [.fragmentsAllowed]) else { return nil }
        return from(object)
    }

    static func from(_ object: Any) -> JSONValue? {
        switch object {
        case is NSNull: return .null
        case let number as NSNumber:
            // JSONSerialization gives booleans as NSNumber too.
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
            return .number(number.doubleValue)
        case let string as String: return .string(string)
        case let array as [Any]: return .array(array.compactMap(from))
        case let dictionary as [String: Any]:
            var result: [String: JSONValue] = [:]
            for (key, value) in dictionary { result[key] = from(value) }
            return .object(result)
        default: return nil
        }
    }

    var foundation: Any {
        switch self {
        case .null: NSNull()
        case .bool(let value): value
        case .number(let value): value == value.rounded() && abs(value) < 1e15 ? Int(value) as Any : value
        case .string(let value): value
        case .array(let values): values.map(\.foundation)
        case .object(let values): values.mapValues(\.foundation)
        }
    }

    /// One line, keys sorted.
    public var text: String {
        guard let data = try? JSONSerialization.data(withJSONObject: foundation, options: [.sortedKeys, .fragmentsAllowed, .withoutEscapingSlashes]) else { return "null" }
        return String(data: data, encoding: .utf8) ?? "null"
    }

    public var nonNull: JSONValue? { self == .null ? nil : self }
    public var string: String? { if case .string(let value) = self { value } else { nil } }
    public var number: Double? { if case .number(let value) = self { value } else { nil } }
    public var array: [JSONValue]? { if case .array(let value) = self { value } else { nil } }
    public subscript(key: String) -> JSONValue? { if case .object(let value) = self { value[key] } else { nil } }
}
