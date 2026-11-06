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
    /// memo-trash.json (1.46, 지운 메모) by MemoTrash.merge (by memo id, the later deletion winning; emptied stays emptied).
    public static let dataFiles = ["todos.json", "memos.json", "repeats.json", "events.json", "alarms.json", Focus.fileName, MemoFolders.fileName,
                                   TodoSpaces.fileName, MemoTrash.fileName]

    public struct Contents: Equatable, Sendable {
        public var exportedAt: String
        public var from: String
        /// "todos.json", "archive/2026-10.jsonl", … → the file's text.
        public var files: [String: String]
        /// B4 (optional, version still 1): why the copy was made and what it holds, so a list can show both.
        public var reason: Reason?
        public var counts: Counts?

        public init(exportedAt: String, from: String, files: [String: String], reason: Reason? = nil, counts: Counts? = nil) {
            self.exportedAt = exportedAt
            self.from = from
            self.files = files
            self.reason = reason
            self.counts = counts
        }
    }

    /// What a copy holds, shortly (B4 `counts`): to-dos, memos, events and the record's lines.
    public struct Counts: Equatable, Sendable {
        public var todos = 0, memos = 0, events = 0, archive = 0

        public init(todos: Int = 0, memos: Int = 0, events: Int = 0, archive: Int = 0) {
            self.todos = todos
            self.memos = memos
            self.events = events
            self.archive = archive
        }

        public init(_ files: [String: String]) {
            let all = Backup.summary(files)
            self.init(todos: all.todos, memos: all.memos, events: all.events, archive: all.archive)
        }

        /// `counts` as written by make: non-negative whole numbers (a missing one is 0); anything else nil.
        public init?(json: Any?) {
            guard let object = json as? [String: Any] else { return nil }
            var values: [Int] = []
            for key in ["todos", "memos", "events", "archive"] {
                guard let value = object[key] else { values.append(0); continue }
                guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID(),
                      number.doubleValue == number.doubleValue.rounded(), number.intValue >= 0 else { return nil }
                values.append(number.intValue)
            }
            self.init(todos: values[0], memos: values[1], events: values[2], archive: values[3])
        }

        var json: [String: Int] { ["todos": todos, "memos": memos, "events": events, "archive": archive] }

        /// A list row's contents: "할 일 24개 · 메모 12장 · 일정 6개 · 기록 310개" (zeros left out; none: "비어 있어요") —
        /// en "24 to-dos · 12 notes · 6 events · 310 in history" ("Empty"), nl "24 taken · 12 notities · 6 afspraken · 310 in geschiedenis" ("Leeg").
        public func text(_ language: AppLanguage) -> String {
            let values = [todos, memos, events, archive]
            let parts: [String]
            switch language {
            case .ko:
                parts = zip(["할 일 %d개", "메모 %d장", "일정 %d개", "기록 %d개"], values).filter { $0.1 > 0 }.map { String(format: $0.0, $0.1) }
            case .en:
                let nouns = [("to-do", "to-dos"), ("note", "notes"), ("event", "events"), ("in history", "in history")]
                parts = zip(nouns, values).filter { $0.1 > 0 }.map { AppLanguage.plural($0.1, $0.0.0, $0.0.1) }
            case .nl:
                let nouns = [("taak", "taken"), ("notitie", "notities"), ("afspraak", "afspraken"), ("in geschiedenis", "in geschiedenis")]
                parts = zip(nouns, values).filter { $0.1 > 0 }.map { AppLanguage.plural($0.1, $0.0.0, $0.0.1) }
            }
            return parts.isEmpty ? ["비어 있어요", "Empty", "Leeg"][language.index] : parts.joined(separator: " · ")
        }
    }

    public enum Problem: Error, Equatable {
        case notBackup
        case newer
        case unreadable(String)
        /// #173 (review L-05): past FileLimits.backupBytes (64MB) the file is not opened.
        case tooLarge

        public var message: String { message(.ko) }

        public func message(_ language: AppLanguage) -> String {
            switch (self, language) {
            case (.tooLarge, .ko): "파일이 너무 커서 열지 않았어요. 백업 파일은 64MB까지 열 수 있어요."
            case (.tooLarge, .en): "This file is too big to open. Backup files can be up to 64 MB."
            case (.tooLarge, .nl): "Dit bestand is te groot om te openen. Back-upbestanden mogen tot 64 MB zijn."
            case (.notBackup, .ko): "종이냥 백업 파일이 아니에요."
            case (.newer, .ko): "더 새 버전의 종이냥에서 만든 파일이에요. 종이냥을 업데이트해 주세요."
            case (.unreadable(let name), .ko): "백업 파일 안의 ‘\(name)’을 읽지 못했어요."
            case (.notBackup, .en): "This isn’t a Jongi-nyang backup file."
            case (.newer, .en): "This file comes from a newer version of Jongi-nyang. Please update Jongi-nyang."
            case (.unreadable(let name), .en): "Couldn’t read ‘\(name)’ in the backup file."
            case (.notBackup, .nl): "Dit is geen back-upbestand van Jongi-nyang."
            case (.newer, .nl): "Dit bestand komt uit een nieuwere versie van Jongi-nyang. Werk Jongi-nyang bij."
            case (.unreadable(let name), .nl): "Het lukte niet om ‘\(name)’ in het back-upbestand te lezen."
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

    // MARK: Automatic copies (backups/ on this device)

    /// Why a copy was made. The raw values are the .jongi file's optional `reason` (B4); the same in backup.ts.
    public enum Reason: String, CaseIterable, Sendable {
        case daily, beforeImport, beforeFolderSwitch, beforeRestore, beforeUpdate, manual, export

        /// The start of the copy's name in backups/ — Korean in every language (old copies are found by it); nil for 내보내기.
        public var filePrefix: String? {
            switch self {
            case .daily: "매일"
            case .beforeImport: "가져오기-전"
            case .beforeFolderSwitch: "폴더-바꾸기-전"
            case .beforeRestore: "되돌리기-전"
            case .beforeUpdate: "업데이트-전"
            case .manual: "직접"
            case .export: nil
            }
        }

        /// How many of this kind stay: 14 daily ones, 10 of each ‘before’ kind; nil = until deleted (직접).
        public var keeps: Int? {
            switch self {
            case .daily: 14
            case .beforeImport, .beforeFolderSwitch, .beforeRestore, .beforeUpdate: 10
            case .manual, .export: nil
            }
        }
    }

    /// A copy in backups/, read from its name.
    public struct Saved: Equatable, Sendable {
        public var name: String
        public var reason: Reason
        public var date: Date
    }

    /// "매일-20261030-091200.jongi", "폴더-바꾸기-전-20261030-091200.jongi" (local time).
    public static func savedName(_ reason: Reason, at date: Date, calendar: Calendar = .paper) -> String {
        let p = calendar.dateComponents([.year, .month, .day, .hour, .minute, .second], from: date)
        let stamp = String(format: "%04d%02d%02d-%02d%02d%02d", p.year!, p.month!, p.day!, p.hour!, p.minute!, p.second!)
        return "\(reason.filePrefix ?? "직접")-\(stamp).jongi" // ko-only: file names
    }

    /// The kind and time in a copy's name; nil for any other file.
    public static func saved(_ name: String, calendar: Calendar = .paper) -> Saved? {
        guard name.hasSuffix(".jongi") else { return nil }
        let stem = name.dropLast(6)
        for reason in Reason.allCases {
            guard let prefix = reason.filePrefix, stem.hasPrefix(prefix + "-") else { continue }
            let stamp = stem.dropFirst(prefix.count + 1)
            let digits = stamp.split(separator: "-")
            guard digits.count == 2, digits[0].count == 8, digits[1].count == 6,
                  digits.allSatisfy({ $0.allSatisfy(\.isASCII) && $0.allSatisfy(\.isNumber) }) else { continue }
            let day = Array(digits[0]), clock = Array(digits[1])
            let number = { (chars: ArraySlice<Character>) in Int(String(chars))! }
            var parts = DateComponents()
            parts.year = number(day[0..<4]); parts.month = number(day[4..<6]); parts.day = number(day[6..<8])
            parts.hour = number(clock[0..<2]); parts.minute = number(clock[2..<4]); parts.second = number(clock[4..<6])
            // A real moment only: month 13 or day 40 doesn't roll over into the next.
            guard let date = calendar.date(from: parts),
                  calendar.dateComponents([.month, .day], from: date) == DateComponents(month: parts.month, day: parts.day) else { continue }
            return Saved(name: name, reason: reason, date: date)
        }
        return nil
    }

    /// The copies to remove: past the newest 14 daily ones and the newest 10 of each ‘before’ kind. 직접 and other files stay.
    public static func prune(_ names: [String], calendar: Calendar = .paper) -> [String] {
        let copies = names.compactMap { Self.saved($0, calendar: calendar) }
        var remove: [String] = []
        for reason in Reason.allCases {
            guard let keeps = reason.keeps else { continue }
            let kind = copies.filter { $0.reason == reason }.sorted { ($0.date, $0.name) > ($1.date, $1.name) }
            remove += kind.dropFirst(keeps).map(\.name)
        }
        return remove.sorted()
    }

    /// The daily copy is due when something changed since the last copy and the newest daily one is from an earlier
    /// day — the app's day, which ends at 4 a.m. (as the record's). Nothing changed: none, so the same copy doesn't pile up.
    public static func isDue(now: Date, lastDaily: Date?, changed: Bool, calendar: Calendar = .paper) -> Bool {
        guard changed else { return false }
        guard let lastDaily else { return true }
        return Archive.logicalDayStart(lastDaily, calendar: calendar) < Archive.logicalDayStart(now, calendar: calendar)
    }

    /// 저장과 백업's one line about the backups (#240, D2 C): what the user wants to know first — when the last copy was,
    /// or what is wrong — then how they are made. The same words as the Windows app (backup.ts: backupStatus) and
    /// docs/plans/storage-summary-cases.json.
    public struct Status: Equatable, Sendable {
        public enum Tone: String, Sendable { case ok, off, warn }
        public var title: String
        public var detail: String
        public var tone: Tone
    }

    public static func status(auto: Bool, failed: Bool, missing: Bool, newest: Date?, now: Date, language: AppLanguage = .ko,
                              calendar: Calendar = .paper) -> Status {
        let i = language.index
        let title: String
        if failed {
            title = ["마지막 백업을 하지 못했어요", "The last backup didn’t work", "De laatste back-up is niet gelukt"][i]
        } else if !auto {
            title = ["자동 백업이 꺼져 있어요", "Automatic backups are off", "Automatische back-ups staan uit"][i]
        } else if let newest {
            let when = savedWhen(newest, now: now, language: language, midSentence: true, calendar: calendar)
            title = ["\(when)에 백업했어요", "Backed up \(when)", "Back-up gemaakt \(when)"][i]
        } else {
            title = ["아직 백업이 없어요", "No backups yet", "Nog geen back-ups"][i]
        }
        let detail = failed ? ["백업 폴더를 확인해 주세요.", "Please check the backup folder.", "Controleer de back-upmap."][i]
            : missing ? ["고른 백업 폴더를 찾지 못해 기본 폴더에 백업해요.", "Couldn’t find the chosen backup folder, so backups go to the default one.",
                         "De gekozen back-upmap is niet gevonden, dus back-ups gaan naar de standaardmap."][i]
            : !auto ? ["덮어쓰기 전에는 그래도 백업해 둬요.", "Anything about to be overwritten is still backed up first.", "Wat overschreven wordt, wordt eerst toch bewaard."][i]
            : ["하루 한 번, 덮어쓰기 전에도 저절로 남겨요.", "Once a day, and before anything is overwritten.", "Eén keer per dag, en voordat iets wordt overschreven."][i]
        return Status(title: title, detail: detail, tone: failed || missing ? .warn : auto ? .ok : .off)
    }

    /// When a copy was made, by calendar day: "오늘 09:12" · "어제 21:40" · "10월 28일 08:55" · "2025년 12월 30일 08:55" —
    /// en "Today 9:12 AM" · "Oct 28, 8:55 AM" · "Dec 30, 2025, 8:55 AM", nl "Vandaag 09:12" · "28 okt 08:55" · "30 dec 2025 08:55".
    /// `midSentence`: en "today …" · "yesterday …", nl "vandaag …" · "gisteren …". The same as backup.ts savedWhen.
    public static func savedWhen(_ date: Date, now: Date, language: AppLanguage = .ko, midSentence: Bool = false, calendar: Calendar = .paper) -> String {
        let days = calendar.dateComponents([.day], from: calendar.startOfDay(for: date), to: calendar.startOfDay(for: now)).day ?? 99
        let p = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: date)
        let time = language.clock(hour: p.hour!, minute: p.minute!)
        if days == 0 || days == 1 {
            let word = [["오늘", "Today", "Vandaag"], ["어제", "Yesterday", "Gisteren"]][days][language.index]
            return "\(midSentence && language != .ko ? word.lowercased() : word) \(time)"
        }
        let year = p.year == calendar.component(.year, from: now) ? nil : p.year
        return language.dayMonth(month: p.month!, day: p.day!, year: year) + (language == .en ? ", " : " ") + time
    }

    /// A copy's size: "220KB" · "2.9MB" (KB = 1024 bytes, rounded up below 1000 KB) — en "220 KB" · "2.9 MB", nl "220 kB" · "2,9 MB".
    public static func sizeText(_ bytes: Int, language: AppLanguage = .ko) -> String {
        let kilobytes = max(1, (bytes + 1023) / 1024)
        let gap = language == .ko ? "" : " "
        if kilobytes < 1000 { return "\(kilobytes)\(gap)\(language == .nl ? "kB" : "KB")" }
        let megabytes = Double(bytes) / 1_048_576
        let shown = megabytes >= 100 ? String(Int(megabytes.rounded())) : String(format: "%.1f", (megabytes * 10).rounded() / 10)
        return (language == .nl ? shown.replacingOccurrences(of: ".", with: ",") : shown) + gap + "MB"
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

    /// The backup file's text. With a reason (B4), also `"reason"` and `"counts"` (to-dos, memos, events, record lines);
    /// `version` stays 1 and older versions read past both (they only look at format, version and files).
    public static func make(files: [String: String], exportedAt: Date, from: String, reason: Reason? = nil) -> String {
        let iso = ISO8601DateFormatter()
        var object: [String: Any] = ["format": format, "version": version, "exportedAt": iso.string(from: exportedAt), "from": from, "files": files]
        if let reason {
            object["reason"] = reason.rawValue
            object["counts"] = Counts(files).json
        }
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
        return Contents(exportedAt: object["exportedAt"] as? String ?? "", from: object["from"] as? String ?? "", files: texts,
                        reason: (object["reason"] as? String).flatMap(Reason.init(rawValue:)), counts: Counts(json: object["counts"]))
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
            case MemoTrash.fileName: ok = (try? MemoTrash.decode(data)) != nil
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
            case MemoTrash.fileName:
                // 지운 메모 (#120): joined as two devices' copies are (T5); mine unreadable: the backup's.
                guard let theirs = try? MemoTrash.decode(Data(text.utf8)) else { continue }
                guard let here = try? MemoTrash.decode(Data(mine.utf8)) else { result[name] = text; continue }
                let merged = MemoTrash.merge(here: here, theirs: theirs)
                result[name] = merged == here ? mine : merged.encoded()
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
