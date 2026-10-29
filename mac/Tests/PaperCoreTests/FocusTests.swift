import Foundation

// 집중 기록 (Focus.swift): the same cases as the Windows app (test/focus.test.ts), listed in
// focus-cases.md — the file's lines, totals by the 4 a.m. day, the summary in three languages,
// the tasks focused on longest, backups, the focus card's words and a session's steps.
// Framework-free like the other core tests.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private func expectEqual<T: Equatable>(_ actual: T, _ expected: T, _ message: String) throws {
    if actual != expected { throw TestFailure(description: "\(message)\n  expected: \(expected)\n  actual:   \(actual)") }
}

@main
private enum FocusTests {
    static func main() throws {
        var count = 0
        var perLanguage: [AppLanguage: Int] = [:]
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        let all = AppLanguage.allCases
        /// A case in every language: ko, en, nl (counted per language).
        func each(_ got: [String?], _ expected: [String?], _ message: String) throws {
            try expectEqual(got, expected, message)
            for language in all { perLanguage[language, default: 0] += 1 }
        }
        var seoul = Calendar(identifier: .gregorian)
        seoul.timeZone = TimeZone(identifier: "Asia/Seoul")!
        func at(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ min: Int = 0, _ s: Int = 0) -> Date {
            seoul.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min, second: s))!
        }
        let iso = ISO8601DateFormatter()

        func local(_ text: String) -> Date {
            let parts = text.split(separator: " "), d = parts[0].split(separator: "-").map { Int($0)! }, t = parts[1].split(separator: ":").map { Int($0)! }
            return at(d[0], d[1], d[2], t[0], t[1])
        }
        func rec(_ id: String, _ title: String, _ task: String?, _ start: String, _ end: String, _ minutes: Int, _ kind: FocusRecord.Kind, _ done: Bool = false) -> FocusRecord {
            FocusRecord(id: id, taskId: task, title: title, start: local(start), end: local(end), minutes: minutes, kind: kind, done: done)
        }
        // The shared records R (focus-cases.md).
        let R = [
            rec("r1", "보고서 마무리", "T1", "2026-10-08 09:00", "2026-10-08 09:25", 25, .focus, true),
            rec("r2", "보고서 마무리", "T1", "2026-10-08 10:00", "2026-10-08 10:50", 50, .focus),
            rec("r3", "", nil, "2026-10-08 13:00", "2026-10-08 13:40", 40, .timer),
            rec("r4", "책 읽기", "T2", "2026-10-08 23:50", "2026-10-09 00:20", 30, .focus),
            rec("r5", "책 읽기", "T2", "2026-10-09 03:30", "2026-10-09 04:10", 40, .focus),
            rec("r6", "산책", nil, "2026-10-09 07:00", "2026-10-09 07:15", 15, .focus),
            rec("r7", "운동", "T3", "2026-10-01 18:00", "2026-10-01 18:30", 30, .focus, true),
            rec("r8", "Book", "T2", "2026-10-09 20:00", "2026-10-09 20:30", 30, .focus),
        ]
        func day(_ text: String) -> Date { local(text + " 12:00") }
        func totals(_ from: String, _ to: String) -> String {
            Focus.totals(R, from: day(from), to: day(to), calendar: seoul).sorted { $0.key < $1.key }.map { "\($0.key) \($0.value)" }.joined(separator: " · ")
        }
        func byTask(_ from: String, _ to: String, _ limit: Int = 3, _ records: [FocusRecord]? = nil) -> String {
            Focus.byTask(records ?? R, from: day(from), to: day(to), limit: limit, calendar: seoul)
                .map { "\($0.title) \($0.minutes) (\($0.sessions)\($0.taskId.map { ", " + $0 } ?? ""))" }.joined(separator: " · ")
        }

        try test("F1–F3 totals: minutes per logical day, a session on the day it started") {
            try expectEqual(totals("2026-10-08", "2026-10-09"), "2026-10-08 185 · 2026-10-09 45", "F1")
            try expectEqual(totals("2026-10-01", "2026-10-31"), "2026-10-01 30 · 2026-10-08 185 · 2026-10-09 45", "F2")
            try expectEqual(totals("2026-09-01", "2026-09-30"), "", "F3")
            try expect(Focus.sum(R, from: day("2026-10-08"), to: day("2026-10-08"), calendar: seoul) == (185, 5), "sum")
        }

        try test("F4–F7 summary in three languages, with plurals") {
            @MainActor func summaries(_ from: String, _ to: String) -> [String?] {
                let first = day(from), last = day(to)
                return all.map { Focus.summary(R, from: first, to: last, language: $0, calendar: seoul) }
            }
            try each(summaries("2026-10-08", "2026-10-08"), ["집중 3시간 5분 · 5번", "Focus 3 h 5 min · 5 sessions", "Focus 3 u 5 min · 5 sessies"], "F4")
            try each(summaries("2026-10-09", "2026-10-09"), ["집중 45분 · 2번", "Focus 45 min · 2 sessions", "Focus 45 min · 2 sessies"], "F5")
            try each(summaries("2026-10-01", "2026-10-01"), ["집중 30분 · 1번", "Focus 30 min · 1 session", "Focus 30 min · 1 sessie"], "F6")
            try each(summaries("2026-09-01", "2026-09-30"), ["집중 0분 · 0번", "Focus 0 min · 0 sessions", "Focus 0 min · 0 sessies"], "F7")
            try each(all.map { Focus.lengthText(200, language: $0) }, ["3시간 20분", "3 h 20 min", "3 u 20 min"], "a total")
        }

        try test("F8–F11 by task: most minutes first, the newest title, plain timers left out") {
            try expectEqual(byTask("2026-10-01", "2026-10-09"), "Book 100 (3, T2) · 보고서 마무리 75 (2, T1) · 운동 30 (1, T3)", "F8")
            try expectEqual(byTask("2026-10-01", "2026-10-09", 5), "Book 100 (3, T2) · 보고서 마무리 75 (2, T1) · 운동 30 (1, T3) · 산책 15 (1)", "F9")
            try expectEqual(byTask("2026-10-08", "2026-10-08"), "보고서 마무리 75 (2, T1) · 책 읽기 70 (2, T2)", "F10")
            let ties = [rec("a", "가", nil, "2026-10-08 09:00", "2026-10-08 09:20", 20, .focus),
                        rec("b", "나", nil, "2026-10-08 10:00", "2026-10-08 10:20", 20, .focus),
                        rec("c", " 가 ", nil, "2026-10-08 08:00", "2026-10-08 08:05", 5, .focus)]
            try expectEqual(byTask("2026-10-08", "2026-10-08", 3, ties), "가 25 (2) · 나 20 (1)", "F11")
        }

        try test("F12 parse: tolerant of bad, torn and repeated lines") {
            let lines = [
                #"{"id":"A","taskId":"T","title":"가","start":"2026-10-08T00:00:00Z","end":"2026-10-08T00:25:00Z","minutes":25,"kind":"focus","done":true}"#,
                "",
                "not json",
                #"{"id":"B","title":"","start":"2026-10-08T01:00:00.500Z","end":"2026-10-08T01:40:00.250Z","minutes":40,"kind":"timer","done":false}"#,
                #"{"id":"A","title":"dup","start":"2026-10-08T02:00:00Z","end":"2026-10-08T02:10:00Z","minutes":10,"kind":"timer","done":false}"#,
                #"{"id":"C","title":"no minutes","start":"2026-10-08T02:00:00Z","end":"2026-10-08T02:10:00Z"}"#,
                #"{"id":"D","title":"bad start","start":"yesterday","end":"2026-10-08T02:10:00Z","minutes":5}"#,
                #"{"id":"E","taskId":"T9","title":"no kind","start":"2026-10-08T03:00:00Z","end":"2026-10-08T03:12:00Z","minutes":12.4}"#,
                #"{"id":"F","title":"odd kind","start":"2026-10-08T03:00:00Z","end":"2026-10-08T03:12:00Z","minutes":7,"kind":"nap"}"#,
                "[1,2]",
                #"{"id":"G","title":"negative","start":"2026-10-08T03:00:00Z","end":"2026-10-08T03:12:00Z","minutes":-3}"#,
                #"{"id":"","title":"empty id","start":"2026-10-08T03:00:00Z","end":"2026-10-08T03:12:00Z","minutes":3}"#,
                #"{"id":"H","title":"torn"#,
            ]
            let records = Focus.parse(lines.joined(separator: "\r\n"))
            try expectEqual(records.map { "\($0.id) \($0.minutes) \($0.kind.rawValue)\($0.taskId.map { " " + $0 } ?? "")\($0.done ? " done" : "")" },
                            ["A 25 focus T done", "B 40 timer", "E 12 focus T9", "F 7 timer"], "F12")
            try expectEqual(records[1].start, iso.date(from: "2026-10-08T01:00:00Z")!.addingTimeInterval(0.5), "fractional seconds")
            try expectEqual(Focus.parse(""), [], "empty")
            // Mac extra: a line without a title, minutes true, done 1 (not a boolean).
            let extra = Focus.parse([#"{"id":"X","start":"2026-10-08T03:00:00Z","end":"2026-10-08T03:12:00Z","minutes":3}"#,
                                     #"{"id":"Y","title":"","start":"2026-10-08T03:00:00Z","end":"2026-10-08T03:12:00Z","minutes":true}"#,
                                     #"{"id":"Z","title":"","start":"2026-10-08T03:00:00Z","end":"2026-10-08T03:12:00Z","minutes":3,"done":1}"#].joined(separator: "\n"))
            try expectEqual(extra.map { "\($0.id) \($0.done)" }, ["Z false"], "title, minutes and done are typed")
        }

        try test("F13–F15 record: whole minutes counted down, whole seconds, never under a minute") {
            let start = at(2026, 10, 8, 14).addingTimeInterval(0.7), end = at(2026, 10, 8, 14, 25).addingTimeInterval(0.3)
            let made = Focus.record(id: "X", taskId: "T", title: "  보고서  ", start: start, end: end, kind: .focus, done: true)!
            try expectEqual(made.minutes, 24, "F13 minutes")
            try expectEqual(made.start, at(2026, 10, 8, 14), "F13 start")
            try expectEqual(made.end, at(2026, 10, 8, 14, 25), "F13 end")
            try expectEqual(made.title, "보고서", "F15")
            func minutes(_ seconds: TimeInterval) -> Int? { Focus.record(id: "Y", title: "", start: start, end: end, seconds: seconds, kind: .timer)?.minutes }
            try expect(minutes(59.999) == nil && minutes(60) == 1 && minutes(25 * 60) == 25, "F14")
            let line = #"{"done":true,"end":"2026-10-08T05:25:00Z","id":"X","kind":"focus","minutes":24,"start":"2026-10-08T05:00:00Z","taskId":"T","title":"보고서"}"#
            try expectEqual(Focus.encodeLine(made), line, "the line (Mac: keys sorted)")
            let plain = Focus.record(id: "Z", title: "", start: start, end: end, seconds: 300, kind: .timer)!
            try expect(!Focus.encodeLine(plain).contains("taskId"), "no task, no taskId")
            let text = Focus.append(plain, to: Focus.append(made, to: #"{"id":"torn""#))
            try expectEqual(Focus.parse(text), [made, plain], "round trip past a torn line")
            try expect(text.hasSuffix("\n"), "ends with a newline")
        }

        try test("F16–F17 merge: by id, this side first; unchanged when nothing is added") {
            func line(_ id: String, _ title: String? = nil) -> String {
                #"{"id":"\#(id)","title":"\#(title ?? id)","start":"2026-10-08T00:00:00Z","end":"2026-10-08T00:25:00Z","minutes":25,"kind":"focus","done":false}"#
            }
            let merged = Focus.merge("\(line("A"))\n\(line("B"))\n", "\(line("B", "other"))\n\(line("C"))\n\(line("C"))\n\n")
            try expectEqual(Focus.parse(merged).map { "\($0.id) \($0.title)" }, ["A A", "B B", "C C"], "F16")
            let one = line("A") + "\n"
            try expectEqual(Focus.merge(one, one), one, "F17")
        }

        try test("FB1–FB4 backup: focus.jsonl travels, is never refused, merges by id, is counted last") {
            func focusText(_ count: Int) -> String {
                (0..<count).map { #"{"id":"f\#($0)","title":"가","start":"2026-10-08T00:00:00Z","end":"2026-10-08T00:25:00Z","minutes":25,"kind":"focus","done":false}"# }.joined(separator: "\n") + "\n"
            }
            try expect(Backup.dataFiles.contains("focus.jsonl"), "FB1 carried")
            let file = Backup.make(files: ["focus.jsonl": "{torn\n" + focusText(2)], exportedAt: Date(timeIntervalSince1970: 0), from: "test")
            try expect(try Backup.parse(file).files["focus.jsonl"]?.contains("\"f1\"") == true, "FB1 never refused")
            var counts = Backup.summary(["focus.jsonl": focusText(18), "archive/2026-10.jsonl": String(repeating: "a\n", count: 140)])
            try expectEqual(counts.focus, 18, "FB2 count")
            counts.todos = 12
            try each(all.map { counts.text($0) }, ["할 일 12 · 완료 기록 140 · 집중 기록 18", "12 to-dos · 140 in history · 18 focus sessions", "12 taken · 140 in geschiedenis · 18 focussessies"], "FB2")
            try each(all.map { Backup.summary(["focus.jsonl": focusText(1)]).text($0) }, ["집중 기록 1", "1 focus session", "1 focussessie"], "FB2 one")
            let merged = Backup.merge(current: ["focus.jsonl": focusText(2)], imported: ["focus.jsonl": focusText(3)])
            try expectEqual(Focus.parse(merged["focus.jsonl"]!).map(\.id), ["f0", "f1", "f2"], "FB3")
            try expectEqual(Backup.merge(current: [:], imported: ["focus.jsonl": focusText(1)])["focus.jsonl"], focusText(1), "FB3 one side")
            try expectEqual(Backup.known(["focus.jsonl": focusText(1), "other.txt": "x"]).keys.sorted(), ["focus.jsonl"], "FB4 (바꾸기 writes the known files; the Mac removes a data file the backup lacks)")
        }

        try test("card words: top line, time up, next, the rest line, the menu bar") {
            try each(all.map { Focus.topLine(language: $0) }, ["집중", "Focus", "Focus"], "plain")
            try each(all.map { Focus.topLine(round: 2, of: 4, language: $0) }, ["집중 · 2 / 4", "Focus · 2 / 4", "Focus · 2 / 4"], "round")
            try each(all.map { Focus.timeUpLine(minutes: 25, language: $0) }, ["25분 다 됐어요", "25 min done", "25 min voorbij"], "time up")
            try each(all.map { Focus.timeUpLine(minutes: 90, language: $0) }, ["1시간 30분 다 됐어요", "1 h 30 min done", "1 u 30 min voorbij"], "time up, long")
            let dentist = ["치과", "Dentist", "Tandarts"]
            try each(all.map { Focus.nextLine(title: dentist[$0 == .ko ? 0 : $0 == .en ? 1 : 2], at: at(2026, 10, 8, 15, 30), minutes: 40, language: $0, calendar: seoul) },
                            ["40분 뒤 치과 · 15:30", "Dentist in 40 min · 3:30 PM", "Tandarts over 40 min · 15:30"], "next: how long first, the clock last (#46)")
            try each(all.map { Focus.nextLine(title: "x", at: at(2026, 10, 8, 16, 10), minutes: 80, language: $0, calendar: seoul) },
                            ["1시간 20분 뒤 x · 16:10", "x in 1 h 20 min · 4:10 PM", "x over 1 u 20 min · 16:10"], "next, later")
            try each(all.map { Focus.restLine(3, open: false, language: $0) },
                            ["그 밖의 오늘 할 일 3개 · 펼치기", "3 other to-dos today · Show", "Nog 3 taken vandaag · Tonen"], "rest")
            try each(all.map { Focus.restLine(1, open: true, language: $0) },
                            ["그 밖의 오늘 할 일 1개 · 접기", "1 other to-do today · Hide", "Nog 1 taak vandaag · Verbergen"], "rest, open")
            try expect(all.allSatisfy { Focus.restLine(0, open: false, language: $0) == nil }, "none")
            try expectEqual(AppLanguage.allCases.map { Focus.menuBarText(remaining: 750, language: $0) }, ["● 13분", "● 13 min", "● 13 min"], "menu bar (#46)")
        }

        let start = at(2026, 10, 8, 14)
        try test("session: 25 min on a to-do, 다 했어요 halfway → a done record of the minutes run") {
            let session = FocusSession.focus(taskId: "T1", title: "보고서", minutes: 25, now: start)
            try expect(session.isFocus && !session.isPomodoro && session.round == nil, "a focus")
            try expectEqual(session.stage(at: start.addingTimeInterval(600)), .running, "running")
            let record = session.record(done: true, at: start.addingTimeInterval(12 * 60 + 40), id: "r")
            try expectEqual(record, FocusRecord(id: "r", taskId: "T1", title: "보고서", start: start, end: start.addingTimeInterval(760), minutes: 12, kind: .focus, done: true), "record")
            try expect(session.record(at: start.addingTimeInterval(30)) == nil, "under a minute: nothing")
        }

        try test("session: time up; 5분 더 runs five minutes from now and adds them") {
            var session = FocusSession.focus(taskId: "T1", title: "보고서", minutes: 25, now: start)
            let late = start.addingTimeInterval(27 * 60)
            try expectEqual(session.stage(at: late), .timeUp, "time up")
            try expectEqual(session.plannedMinutes, 25, "planned")
            try expectEqual(session.record(at: late, id: "r")?.minutes, 25, "the wait after time up isn't counted")
            session.more(at: late)
            try expectEqual(session.stage(at: late.addingTimeInterval(60)), .running, "running again")
            try expectEqual(session.timer.remaining(at: late), 300, "five minutes from now")
            try expectEqual(session.plannedMinutes, 30, "planned 30")
            try expectEqual(session.record(at: late.addingTimeInterval(5 * 60), id: "r")?.minutes, 30, "the wait isn't counted")
        }

        try test("session: paused time isn't counted") {
            var session = FocusSession.focus(taskId: nil, title: "산책", minutes: 25, now: start)
            session.pause(at: start.addingTimeInterval(5 * 60))
            session.resume(at: start.addingTimeInterval(15 * 60))
            try expectEqual(session.record(at: start.addingTimeInterval(20 * 60), id: "r")?.minutes, 10, "10 of 20 minutes")
        }

        try test("session: a Pomodoro round → 5분 쉬기 (the round's record) → break over → 다음 라운드") {
            var session = FocusSession.pomodoro(taskId: "T1", title: "보고서", settings: PomodoroSettings(), now: start)
            try expect(session.round! == (1, 4), "round 1 of 4")
            let up = start.addingTimeInterval(25 * 60 + 30)
            try expectEqual(session.stage(at: up), .timeUp, "round over")
            let round = session.takeBreak(at: up)
            try expectEqual(round?.minutes, 25, "round recorded")
            try expectEqual(session.stage(at: up), .resting, "a break")
            try expect(session.round! == (1, 4), "still round 1 on the break")
            try expect(session.record(at: up.addingTimeInterval(60)) == nil, "breaks aren't recorded")
            try expectEqual(session.stage(at: up.addingTimeInterval(6 * 60)), .restOver, "break over")
            session.nextRound(at: up.addingTimeInterval(7 * 60))
            try expect(session.round! == (2, 4), "round 2")
            try expectEqual(session.stage(at: up.addingTimeInterval(8 * 60)), .running, "focusing")
            try expectEqual(session.record(at: up.addingTimeInterval(17 * 60), id: "r")?.start, up.addingTimeInterval(7 * 60), "the round starts at 다음 라운드")
        }

        try test("session: the timer board's Pomodoro moves on by itself, one record per focus round") {
            var session = FocusSession(timer: .pomodoro(PomodoroSettings(focusMinutes: 2, restMinutes: 1), now: start), segmentStart: start)
            try expect(!session.isFocus, "a plain timer")
            let first = session.advance(at: start.addingTimeInterval(130), autoContinue: true)
            try expectEqual(first?.kind, .timer, "kind timer")
            try expectEqual(first?.minutes, 2, "two minutes")
            try expect(session.advance(at: start.addingTimeInterval(140), autoContinue: true) == nil, "not over yet")
            try expect(session.advance(at: start.addingTimeInterval(200), autoContinue: false) == nil, "the break isn't recorded")
            try expect(session.timer.isPaused && session.stage(at: start.addingTimeInterval(400)) == .running, "next round waits (paused)")
        }

        try expect(all.allSatisfy { (perLanguage[$0] ?? 0) >= 8 }, "cases per language: \(perLanguage)")
        print("\n\(count) focus checks passed (\(perLanguage[.ko] ?? 0) cases in each language).")
    }
}
