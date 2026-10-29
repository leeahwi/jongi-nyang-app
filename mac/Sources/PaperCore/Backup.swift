import Foundation

/// 백업 · 옮기기: everything in the storage folder — todos, memos, repeats, events, alarms, the record
/// of finished tasks and the focus record (focus.jsonl, from 1.37) — in one .jongi file (JSON), for moving to another computer, Mac or Windows.
/// The files go in as they are; importing either adds what's missing (합치기) or takes the backup
/// as it is (바꾸기). Same format, rules and test cases as the Windows app (backup.ts).
public enum Backup {
    public static let format = "jongi-nyang-backup"
    public static let version = 1
    /// The files a backup carries, besides archive/*.jsonl. focus.jsonl is read tolerantly (a torn
    /// line is skipped, never a reason to refuse the backup) and merged line by line, by id.
    /// memo-folders.json (1.43, 메모 서랍) is merged by MemoFolders.merge (folders by id, placements by memo, newer wins);
    /// todo-spaces.json (1.45, 할 일 스페이스) by TodoSpaces.merge (S18: the same rules as two devices, this Mac's on a tie).
    public static let dataFiles = ["todos.json", "memos.json", "repeats.json", "events.json", "alarms.json", Focus.fileName, MemoFolders.fileName,
                                   TodoSpaces.fileName]

    public struct Contents: Equatable, Sendable {
        public var exportedAt: String
        public var from: String
        /// "todos.json", "archive/2026-10.jsonl", … → the file's text.
        public var files: [String: String]

        public init(exportedAt: String, from: String, files: [String: String]) {
            self.exportedAt = exportedAt
            self.from = from
            self.files = files
        }
    }

    public enum Problem: Error, Equatable {
        case notBackup
        case newer
        case unreadable(String)

        public var message: String { message(.ko) }

        public func message(_ language: AppLanguage) -> String {
            switch (self, language) {
            case (.notBackup, .ko): "종이냥 백업 파일이 아니에요."
            case (.newer, .ko): "더 새 버전의 종이냥에서 만든 파일이에요. 종이냥을 업데이트해 주세요."
            case (.unreadable(let name), .ko): "백업 파일 안의 ‘\(name)’을 읽지 못했어요."
            case (.notBackup, .en): "This isn’t a Jongi-nyang backup file."
            case (.newer, .en): "This file comes from a newer version of Jongi-nyang. Please update Jongi-nyang."
            case (.unreadable(let name), .en): "Couldn’t read ‘\(name)’ in the backup file."
            case (.notBackup, .nl): "Dit is geen back-upbestand van Jongi-nyang."
            case (.newer, .nl): "Dit bestand komt uit een nieuwere versie van Jongi-nyang. Werk Jongi-nyang bij."
            case (.unreadable(let name), .nl): "Kon ‘\(name)’ in het back-upbestand niet lezen."
            }
        }
    }

    /// "종이냥-백업-2026-10-08.jongi" — en "Jongi-nyang-backup-2026-10-08.jongi", nl "Jongi-nyang-back-up-2026-10-08.jongi".
    public static func fileName(_ date: Date, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String {
        let name = switch language {
        case .ko: "종이냥-백업"
        case .en: "Jongi-nyang-backup"
        case .nl: "Jongi-nyang-back-up"
        }
        return "\(name)-\(CalendarDraft.day(date, calendar: calendar)).jongi"
    }

    /// When a backup was made, for the import question: "10월 8일 14:30", en "Oct 8, 2:30 PM", nl "8 okt 14:30";
    /// nil when it can't be read (Windows: exportedText).
    public static func exportedText(_ exportedAt: String, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String? {
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = ISO8601DateFormatter().date(from: exportedAt) ?? fractional.date(from: exportedAt) else { return nil }
        let p = calendar.dateComponents([.month, .day, .hour, .minute], from: date)
        let day = language.dayMonth(month: p.month!, day: p.day!)
        return day + (language == .en ? ", " : " ") + language.clock(hour: p.hour!, minute: p.minute!)
    }

    public static func make(files: [String: String], exportedAt: Date, from: String) -> String {
        let iso = ISO8601DateFormatter()
        let object: [String: Any] = ["format": format, "version": version, "exportedAt": iso.string(from: exportedAt), "from": from, "files": files]
        let data = try! JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        return String(decoding: data, as: UTF8.self) + "\n"
    }

    /// The backup in a file, with every file inside checked the way the app will read it.
    public static func parse(_ text: String) throws -> Contents {
        guard let object = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any],
              object["format"] as? String == format, let files = object["files"] as? [String: Any] else { throw Problem.notBackup }
        if let version = object["version"] as? Int, version > Self.version { throw Problem.newer }
        var texts: [String: String] = [:]
        for (name, value) in files {
            guard let text = value as? String else { throw Problem.unreadable(name) }
            texts[name] = text
        }
        try validate(texts)
        return Contents(exportedAt: object["exportedAt"] as? String ?? "", from: object["from"] as? String ?? "", files: texts)
    }

    /// Each known file reads; unknown names are left alone (and not written).
    public static func validate(_ files: [String: String]) throws {
        let strict = JSONDecoder()
        strict.dateDecodingStrategy = .iso8601
        for (name, text) in files {
            let data = Data(text.utf8)
            let ok: Bool
            switch name {
            case "todos.json": ok = (try? strict.decode(Notebook.self, from: data)) != nil
            case "memos.json": ok = (try? MemoFile.decode(data)) != nil
            case "repeats.json": ok = (try? strict.decode(RepeatsFile.self, from: data)) != nil
            case "events.json": ok = (try? strict.decode(LocalEvent.File.self, from: data)) != nil
            case "alarms.json": ok = (try? Alarm.File.decode(data)) != nil
            case MemoFolders.fileName: ok = (try? MemoFolders.decode(data)) != nil
            case TodoSpaces.fileName: ok = (try? TodoSpaces.decode(data)) != nil
            default:
                guard isArchive(name) else { continue }
                ok = lines(text).allSatisfy { (try? tolerant.decode(ArchiveEntry.self, from: Data($0.utf8))) != nil }
            }
            if !ok { throw Problem.unreadable(name) }
        }
    }

    /// The files this app writes from a backup: the known ones only.
    public static func known(_ files: [String: String]) -> [String: String] {
        files.filter { dataFiles.contains($0.key) || isArchive($0.key) }
    }

    public static func isArchive(_ name: String) -> Bool {
        name.hasPrefix("archive/") && name.hasSuffix(".jsonl") && !name.dropFirst(8).contains("/")
    }

    // MARK: Summary

    public struct Summary: Equatable, Sendable {
        public var todos = 0, memos = 0, repeats = 0, events = 0, alarms = 0, archive = 0, focus = 0

        /// "할 일 12 · 메모 3 · 반복 2 · 일정 8 · 알람 2 · 완료 기록 140 · 집중 기록 5" (zeros left out).
        public var text: String { text(.ko) }

        /// en "12 to-dos · 3 notes · 2 repeating to-dos · 8 events · 2 alarms · 140 in history · 5 focus sessions" ("This backup is empty.");
        /// nl "12 taken · 3 notities · 2 herhalende taken · 8 afspraken · 2 wekkers · 140 in geschiedenis · 5 focussessies" ("Deze back-up is leeg.").
        public func text(_ language: AppLanguage) -> String {
            let counts = [todos, memos, repeats, events, alarms, archive, focus]
            let parts: [String]
            switch language {
            case .ko:
                parts = zip(["할 일", "메모", "반복", "일정", "알람", "완료 기록", "집중 기록"], counts).filter { $0.1 > 0 }.map { "\($0.0) \($0.1)" }
            case .en:
                let nouns = [("to-do", "to-dos"), ("note", "notes"), ("repeating to-do", "repeating to-dos"), ("event", "events"), ("alarm", "alarms"), ("in history", "in history"), ("focus session", "focus sessions")]
                parts = zip(nouns, counts).filter { $0.1 > 0 }.map { AppLanguage.plural($0.1, $0.0.0, $0.0.1) }
            case .nl:
                let nouns = [("taak", "taken"), ("notitie", "notities"), ("herhalende taak", "herhalende taken"), ("afspraak", "afspraken"), ("wekker", "wekkers"), ("in geschiedenis", "in geschiedenis"), ("focussessie", "focussessies")]
                parts = zip(nouns, counts).filter { $0.1 > 0 }.map { AppLanguage.plural($0.1, $0.0.0, $0.0.1) }
            }
            if parts.isEmpty { return ["비어 있는 백업이에요.", "This backup is empty.", "Deze back-up is leeg."][language.index] }
            return parts.joined(separator: " · ")
        }
    }

    public static func summary(_ files: [String: String]) -> Summary {
        var summary = Summary()
        summary.todos = count(files["todos.json"], "items")
        summary.memos = count(files["memos.json"], "memos")
        summary.repeats = count(files["repeats.json"], "series")
        summary.events = count(files["events.json"], "events")
        summary.alarms = count(files["alarms.json"], "alarms")
        summary.archive = files.filter { isArchive($0.key) }.reduce(0) { $0 + lines($1.value).count }
        summary.focus = files[Focus.fileName].map { Focus.parse($0).count } ?? 0
        return summary
    }

    // MARK: Merging

    /// 합치기: what's here stays; from the backup, only what isn't here (by id) is added after it.
    public static func merge(current: [String: String], imported: [String: String]) -> [String: String] {
        var result = known(current)
        for (name, text) in known(imported) {
            guard let mine = result[name] else {
                result[name] = text
                continue
            }
            switch name {
            case "todos.json": result[name] = mergeList(mine, text, key: "items")
            case "memos.json": result[name] = mergeList(mine, text, key: "memos")
            case "repeats.json": result[name] = mergeList(mine, text, key: "series")
            case "events.json": result[name] = mergeList(mine, text, key: "events")
            case "alarms.json": result[name] = mergeList(mine, text, key: "alarms")
            case Focus.fileName: result[name] = Focus.merge(mine, text)
            case MemoFolders.fileName:
                // Mine unreadable: the backup's is taken; the backup's unreadable was refused by validate.
                guard let theirs = try? MemoFolders.decode(Data(text.utf8)) else { continue }
                guard let here = try? MemoFolders.decode(Data(mine.utf8)) else { result[name] = text; continue }
                result[name] = MemoFolders.merge(here: here, theirs: theirs).encoded()
            case TodoSpaces.fileName:
                guard let theirs = try? TodoSpaces.decode(Data(text.utf8)) else { continue }
                guard let here = try? TodoSpaces.decode(Data(mine.utf8)) else { result[name] = text; continue }
                result[name] = TodoSpaces.merge(existing: here, incoming: theirs).encoded()
            default: result[name] = mergeLines(mine, text)
            }
        }
        return result
    }

    private static func mergeList(_ mine: String, _ theirs: String, key: String) -> String {
        guard var here = (try? JSONSerialization.jsonObject(with: Data(mine.utf8))) as? [String: Any],
              let ours = here[key] as? [[String: Any]],
              let there = ((try? JSONSerialization.jsonObject(with: Data(theirs.utf8))) as? [String: Any])?[key] as? [[String: Any]] else {
            return mine
        }
        let ids = Set(ours.compactMap { $0["id"] as? String })
        here[key] = ours + there.filter { ($0["id"] as? String).map { !ids.contains($0) } ?? true }
        let data = try! JSONSerialization.data(withJSONObject: here, options: [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes])
        return String(decoding: data, as: UTF8.self) + "\n"
    }

    private static func mergeLines(_ mine: String, _ theirs: String) -> String {
        let ours = lines(mine)
        var seen = Set(ours.map(lineID))
        var merged = ours
        for line in lines(theirs) where !seen.contains(lineID(line)) {
            seen.insert(lineID(line))
            merged.append(line)
        }
        return merged.joined(separator: "\n") + "\n"
    }

    /// A record line's id, or the line itself when it has none.
    private static func lineID(_ line: String) -> String {
        ((try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any])?["id"] as? String ?? line
    }

    // MARK: Helpers

    private struct RepeatsFile: Codable { var series: [Series] }

    private static func count(_ text: String?, _ key: String) -> Int {
        guard let text, let object = (try? JSONSerialization.jsonObject(with: Data(text.utf8))) as? [String: Any] else { return 0 }
        return (object[key] as? [Any])?.count ?? 0
    }

    private static func lines(_ text: String) -> [String] {
        text.split(whereSeparator: \.isNewline).map(String.init).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
    }

    /// Like the record's own reader: whole-second or fractional ISO 8601.
    private static let tolerant: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let text = try decoder.singleValueContainer().decode(String.self)
            guard let date = Archive.isoDate(text) else {
                throw DecodingError.dataCorrupted(.init(codingPath: decoder.codingPath, debugDescription: "Bad date \(text)"))
            }
            return date
        }
        return decoder
    }()
}
