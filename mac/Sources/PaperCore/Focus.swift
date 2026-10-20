import Foundation

/// 집중 기록: `focus.jsonl` in the storage folder, one line per focus session or timer that ran at
/// least a minute — `{"id","taskId"?,"title","start","end","minutes","kind","done"}`, whole-second ISO
/// 8601 in UTC. The record of finished tasks (archive/*.jsonl) is left as it is. Same format, rules
/// and test cases as the Windows app (focus.ts; the shared cases are in focus-cases.md).
public struct FocusRecord: Codable, Equatable, Sendable {
    public enum Kind: String, Codable, Sendable {
        /// A focus session on a task (집중 모드).
        case focus
        /// A plain timer, no task (the timer board, the input line's `타이머 40`).
        case timer
    }

    public var id: String
    public var taskId: String?
    public var title: String
    public var start: Date
    public var end: Date
    /// Minutes of running time (pauses left out), at least 1.
    public var minutes: Int
    public var kind: Kind
    /// The task was checked at the end ("다 했어요").
    public var done: Bool

    public init(id: String = UUID().uuidString, taskId: String? = nil, title: String, start: Date, end: Date,
                minutes: Int, kind: Kind, done: Bool = false) {
        self.id = id; self.taskId = taskId; self.title = title; self.start = start; self.end = end
        self.minutes = minutes; self.kind = kind; self.done = done
    }
}

public enum Focus {
    public static let fileName = "focus.jsonl"

    // MARK: Writing

    /// The record for a stretch from `start` to `end` that ran `seconds` (pauses not counted; the whole
    /// span when nil), as whole minutes counted down (24 min 59 s → 24) — nil under a minute. The title
    /// is trimmed; start and end drop their fractions of a second.
    public static func record(id: String = UUID().uuidString, taskId: String? = nil, title: String, start: Date, end: Date,
                              seconds: TimeInterval? = nil, kind: FocusRecord.Kind, done: Bool = false) -> FocusRecord? {
        let active = max(0, seconds ?? end.timeIntervalSince(start))
        let minutes = Int((active / 60).rounded(.down))
        guard minutes >= 1 else { return nil }
        return FocusRecord(id: id, taskId: taskId, title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                           start: whole(start), end: whole(end), minutes: minutes, kind: kind, done: done)
    }

    /// One line of the file (no newline): keys sorted, no `taskId` when there's no task.
    public static func encodeLine(_ record: FocusRecord) -> String {
        String(decoding: try! encoder.encode(record), as: UTF8.self)
    }

    /// The file's text with `record` added at the end (a missing last newline is mended first).
    public static func append(_ record: FocusRecord, to text: String) -> String {
        let base = text.isEmpty || text.hasSuffix("\n") ? text : text + "\n"
        return base + encodeLine(record) + "\n"
    }

    // MARK: Reading

    /// Every readable line, in file order. Tolerant: blank and broken lines are skipped (a torn last
    /// line after a crash); a line needs a non-empty string `id`, a string `title`, ISO `start` and `end`
    /// (fractional seconds read) and a number `minutes` ≥ 0 (rounded); a `kind` other than focus/timer
    /// follows `taskId` (task → focus); `done` only when it's `true`; a repeated `id` keeps its first line.
    public static func parse(_ text: String) -> [FocusRecord] {
        var seen = Set<String>()
        var records: [FocusRecord] = []
        for line in text.split(whereSeparator: \.isNewline) {
            guard let object = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any],
                  let id = object["id"] as? String, !id.isEmpty, let title = object["title"] as? String,
                  let start = (object["start"] as? String).flatMap(date), let end = (object["end"] as? String).flatMap(date),
                  let number = object["minutes"] as? NSNumber, !isBool(number), number.doubleValue.isFinite, number.doubleValue >= 0,
                  seen.insert(id).inserted else { continue }
            let taskId = (object["taskId"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            let kind = (object["kind"] as? String).flatMap(FocusRecord.Kind.init(rawValue:)) ?? (taskId == nil ? .timer : .focus)
            let done = (object["done"] as? NSNumber).map { isBool($0) && $0.boolValue } ?? false
            records.append(FocusRecord(id: id, taskId: taskId, title: title, start: start, end: end,
                                       minutes: Int(number.doubleValue.rounded()), kind: kind, done: done))
        }
        return records
    }

    /// Lines of both files by id: those here first (as they are), then the imported ones this side
    /// lacks (a line without an id by its whole trimmed text) — backup 합치기, a storage move. The text
    /// is left as it is when nothing is added.
    public static func merge(_ current: String, _ imported: String) -> String {
        func id(_ line: Substring) -> String? {
            ((try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any])?["id"] as? String
        }
        let mine = current.split(whereSeparator: \.isNewline).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        var ids = Set(mine.compactMap(id))
        var texts = Set(mine.map { $0.trimmingCharacters(in: .whitespaces) })
        var added: [Substring] = []
        for line in imported.split(whereSeparator: \.isNewline) where !line.trimmingCharacters(in: .whitespaces).isEmpty {
            if let lineID = id(line) {
                guard ids.insert(lineID).inserted else { continue }
            } else {
                guard texts.insert(line.trimmingCharacters(in: .whitespaces)).inserted else { continue }
            }
            added.append(line)
        }
        guard !added.isEmpty else { return current }
        return (mine + added).joined(separator: "\n") + "\n"
    }

    // MARK: Totals

    /// The logical (4 a.m.) day a record counts on: the day it started.
    public static func day(_ record: FocusRecord, calendar: Calendar = .paper) -> String { Archive.dayKey(record.start, calendar: calendar) }

    /// The records that started on a logical day from `from`'s to `to`'s, both included.
    public static func inRange(_ records: [FocusRecord], from: Date, to: Date, calendar: Calendar = .paper) -> [FocusRecord] {
        let first = Archive.dayKey(from, calendar: calendar), last = Archive.dayKey(to, calendar: calendar)
        return records.filter { let key = day($0, calendar: calendar); return key >= first && key <= last }
    }

    /// Minutes per day ("2026-10-08" → 185) over the days from `from`'s to `to`'s; days without time left
    /// out. A session counts on the day it started (23:50–00:20 is that evening's; 03:30 the night before's).
    public static func totals(_ records: [FocusRecord], from: Date, to: Date, calendar: Calendar = .paper) -> [String: Int] {
        var days: [String: Int] = [:]
        for record in inRange(records, from: from, to: to, calendar: calendar) where record.minutes > 0 {
            days[day(record, calendar: calendar), default: 0] += record.minutes
        }
        return days
    }

    /// All the minutes and sessions (focus and plain timers alike) over the days.
    public static func sum(_ records: [FocusRecord], from: Date, to: Date, calendar: Calendar = .paper) -> (minutes: Int, sessions: Int) {
        let shown = inRange(records, from: from, to: to, calendar: calendar)
        return (shown.reduce(0) { $0 + $1.minutes }, shown.count)
    }

    /// "집중 1시간 40분 · 4번" — en "Focus 1 h 40 min · 4 sessions" ("1 session"); nl "Focus 1 u 40 min · 4 sessies" ("1 sessie").
    public static func summary(_ records: [FocusRecord], from: Date, to: Date, language: AppLanguage = .ko, calendar: Calendar = .paper) -> String {
        let total = sum(records, from: from, to: to, calendar: calendar)
        return summaryText(minutes: total.minutes, sessions: total.sessions, language: language)
    }

    public static func summaryText(minutes: Int, sessions: Int, language: AppLanguage = .ko) -> String {
        "\(["집중", "Focus", "Focus"][language.index]) \(lengthText(minutes, language: language)) · \(sessionsText(sessions, language: language))"
    }

    /// "4번" · "4 sessions" · "4 sessies" (1 session · 1 sessie).
    public static func sessionsText(_ count: Int, language: AppLanguage = .ko) -> String {
        switch language {
        case .ko: "\(count)번"
        case .en: AppLanguage.plural(count, "session", "sessions")
        case .nl: AppLanguage.plural(count, "sessie", "sessies")
        }
    }

    /// "3시간 20분", "3 h 20 min", "3 u 20 min" ("0분" · "0 min" for none) — a total on its own.
    public static func lengthText(_ minutes: Int, language: AppLanguage = .ko) -> String { TimerLength.text(max(0, minutes), language: language) }

    /// A task's focus time, for 가장 오래 집중한 일.
    public struct TaskTotal: Equatable, Sendable {
        public var title: String
        public var taskId: String?
        public var minutes: Int
        public var sessions: Int
    }

    /// 가장 오래 집중한 일: focus sessions (not plain timers) over the days, by task — its id, or for a
    /// line without one its title (trimmed, case ignored) — most minutes first, equal minutes by title
    /// (code-unit order), at most `limit`. The title shown is the newest session's.
    public static func byTask(_ records: [FocusRecord], from: Date, to: Date, limit: Int = 3, calendar: Calendar = .paper) -> [TaskTotal] {
        var groups: [String: (total: TaskTotal, latest: Date)] = [:]
        var order: [String] = []
        for record in inRange(records, from: from, to: to, calendar: calendar) where record.kind == .focus && record.minutes > 0 {
            let key = record.taskId.map { "id:" + $0 } ?? "title:" + record.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            if var group = groups[key] {
                group.total.minutes += record.minutes
                group.total.sessions += 1
                if record.start >= group.latest { group.latest = record.start; group.total.title = record.title }
                groups[key] = group
            } else {
                groups[key] = (TaskTotal(title: record.title, taskId: record.taskId, minutes: record.minutes, sessions: 1), record.start)
                order.append(key)
            }
        }
        return order.map { groups[$0]!.total }.sorted { a, b in
            a.minutes != b.minutes ? a.minutes > b.minutes : Array(a.title.utf16).lexicographicallyPrecedes(Array(b.title.utf16))
        }.prefix(max(0, limit)).map { $0 }
    }

    // MARK: The focus card's words

    /// The card's top line: "집중 · 2 / 4" for a Pomodoro round, else "집중" — en/nl "Focus · 2 / 4", "Focus".
    public static func topLine(round: Int? = nil, of rounds: Int? = nil, language: AppLanguage = .ko) -> String {
        let word = ["집중", "Focus", "Focus"][language.index]
        guard let round, let rounds else { return word }
        return "\(word) · \(round) / \(rounds)"
    }

    /// When the time is up: "25분 다 됐어요" · "25 min done" · "25 min voorbij".
    public static func timeUpLine(minutes: Int, language: AppLanguage = .ko) -> String {
        let length = TimerLength.text(minutes, language: language)
        return ["\(length) 다 됐어요", "\(length) done", "\(length) voorbij"][language.index]
    }

    /// "다음 · 15:30 치과 (40분 뒤)" · "Next · 3:30 PM Dentist (in 40 min)" · "Volgende · 15:30 Tandarts (over 40 min)".
    public static func nextLine(title: String, at: Date, minutes: Int, language: AppLanguage = .ko, calendar: Calendar = .paper) -> String {
        let p = calendar.dateComponents([.hour, .minute], from: at)
        let clock = language.clock(hour: p.hour!, minute: p.minute!)
        let word = ["다음", "Next", "Volgende"][language.index]
        return "\(word) · \(clock) \(title) (\(DayRibbon.away(minutes, language: language)))"
    }

    /// The line under the buttons: "그 밖의 오늘 할 일 3개 · 펼치기" ("· 접기" when open) — en "3 other to-dos today ·
    /// Show" ("Hide"); nl "Nog 3 taken vandaag · Tonen" ("Verbergen"). Nil when there are none.
    public static func restLine(_ count: Int, open: Bool, language: AppLanguage = .ko) -> String? {
        guard count > 0 else { return nil }
        let action = open ? ["접기", "Hide", "Verbergen"][language.index] : ["펼치기", "Show", "Tonen"][language.index]
        switch language {
        case .ko: return "그 밖의 오늘 할 일 \(count)개 · \(action)"
        case .en: return AppLanguage.plural(count, "other to-do", "other to-dos") + " today · \(action)"
        case .nl: return "Nog " + AppLanguage.plural(count, "taak", "taken") + " vandaag · \(action)"
        }
    }

    /// The menu bar / tray words while focusing: "● 12:30" (a plain timer stays "12:30").
    public static func menuBarText(remaining: TimeInterval) -> String { "● " + FocusTimer.clock(max(0, remaining)) }

    // MARK: Helpers

    /// A JSON true/false (JSONSerialization gives numbers and booleans as NSNumber).
    private static func isBool(_ number: NSNumber) -> Bool { CFGetTypeID(number) == CFBooleanGetTypeID() }

    private static func whole(_ date: Date) -> Date { Date(timeIntervalSince1970: date.timeIntervalSince1970.rounded(.down)) }

    /// Whole-second or fractional ISO 8601, read like the record's lines (1.39: without two new formatters per date).
    private static func date(_ text: String) -> Date? { Archive.isoDate(text) }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        return encoder
    }()
}

/// What the timer is doing, with what it's for: a plain timer (no task) on the timer board, or 집중
/// on a task (the note's focus card). Pure like FocusTimer — every step takes `now` — and Codable,
/// so a session survives a relaunch. Same steps as the Windows app (focus.ts: FocusSession).
public struct FocusSession: Codable, Equatable, Sendable {
    public enum Stage: Equatable, Sendable {
        /// Focusing (or a plain timer) with time left.
        case running
        /// The focus time is up: 다 했어요 · 5분 더 · 다음에 (a Pomodoro round: 5분 쉬기 first).
        case timeUp
        /// A Pomodoro break with time left.
        case resting
        /// The break is over: 다음 라운드 · 그만하기.
        case restOver
    }

    public private(set) var timer: FocusTimer
    /// The to-do focused on (nil for a plain timer, or a focus whose to-do is gone).
    public var taskId: String?
    /// The to-do's title ("" for a plain timer).
    public var title: String
    /// When the current stretch of focus (a session, or a Pomodoro round) started.
    public private(set) var segmentStart: Date

    public init(timer: FocusTimer, taskId: String? = nil, title: String = "", segmentStart: Date) {
        self.timer = timer
        self.taskId = taskId
        self.title = title
        self.segmentStart = segmentStart
    }

    /// 집중 on a to-do for `minutes`.
    public static func focus(taskId: String?, title: String, minutes: Int, now: Date) -> FocusSession {
        FocusSession(timer: .countdown(minutes: minutes, now: now), taskId: taskId, title: title, segmentStart: now)
    }

    /// 집중 on a to-do as a Pomodoro (its own focus length, breaks between rounds).
    public static func pomodoro(taskId: String?, title: String, settings: PomodoroSettings, now: Date) -> FocusSession {
        FocusSession(timer: .pomodoro(settings, now: now), taskId: taskId, title: title, segmentStart: now)
    }

    /// A focus session (on a to-do), as opposed to a plain timer.
    public var isFocus: Bool { taskId != nil || !title.isEmpty }
    public var isPomodoro: Bool { timer.pomodoro != nil }
    private var focusing: Bool { timer.phase == .focus || timer.phase == .timer }

    public func stage(at now: Date) -> Stage {
        let over = timer.isFinished(at: now)
        if focusing { return over ? .timeUp : .running }
        return over ? .restOver : .resting
    }

    /// The Pomodoro round under way (or just finished, on a break) and how many make a set: (2, 4).
    public var round: (number: Int, of: Int)? {
        guard let pomodoro = timer.pomodoro else { return nil }
        let rounds = max(1, pomodoro.roundsBeforeLongRest)
        let done = focusing ? timer.completedRounds : max(0, timer.completedRounds - 1)
        return (done % rounds + 1, rounds)
    }

    /// The minutes this stretch was meant to run when it started (for "25분 다 됐어요": the time asked for,
    /// with 5분 더 added).
    public var plannedMinutes: Int { Int((timer.duration / 60).rounded()) }

    public mutating func pause(at now: Date) { timer.pause(at: now) }
    public mutating func resume(at now: Date) { timer.resume(at: now) }

    /// 5분 더 (from the time-up card: five more minutes from now).
    public mutating func more(minutes: Int = 5, at now: Date) { timer.extend(minutes: minutes, at: now) }

    /// The record of the stretch of focus so far — nil on a break or under a minute. It ends now (the
    /// wall clock); its minutes are the time run (pauses and the wait after time was up left out).
    public func record(done: Bool = false, at now: Date, id: String = UUID().uuidString) -> FocusRecord? {
        guard focusing else { return nil }
        return Focus.record(id: id, taskId: taskId, title: title, start: segmentStart, end: max(segmentStart, now),
                            seconds: timer.elapsed(at: now), kind: isFocus ? .focus : .timer, done: done)
    }

    /// 5분 쉬기 (a Pomodoro round's time is up, or skipped ahead): the round's record, then the break.
    public mutating func takeBreak(at now: Date) -> FocusRecord? {
        guard focusing, let next = timer.next(at: now) else { return nil }
        let made = record(at: now)
        timer = next
        return made
    }

    /// 다음 라운드: the next round of focus, from now (from a break, over or not).
    public mutating func nextRound(at now: Date) {
        guard !focusing, let next = timer.next(at: now) else { return }
        timer = next
        segmentStart = now
    }

    /// The timer board's Pomodoro (no buttons to wait for): when a phase is over, the next one, and
    /// the record of a focus round that ended.
    public mutating func advance(at now: Date, autoContinue: Bool) -> FocusRecord? {
        guard timer.isFinished(at: now), let next = timer.next(at: now) else { return nil }
        let made = record(at: now)
        var upcoming = next
        if !autoContinue { upcoming.pause(at: now) }
        timer = upcoming
        if focusing { segmentStart = now }
        return made
    }

    /// The board's own controls (pause, + minutes) act on the timer itself.
    public mutating func setTimer(_ timer: FocusTimer, at now: Date) {
        if timer.phase != self.timer.phase { segmentStart = now }
        self.timer = timer
    }
}
