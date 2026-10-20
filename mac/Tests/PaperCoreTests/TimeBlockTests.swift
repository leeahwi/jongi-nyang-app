import Foundation

// 할 일 시간 정하기 (TimeBlock.swift, QuickParse, Intent, DayRibbon): the shared cases with the Windows app
// (test/timeblock.test.ts), listed in timeblock-cases.md. Framework-free like the other core tests.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    try expect(actual == expected, "\(name): expected \(expected), got \(actual)")
}

@main
private enum TimeBlockTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        var seoul = Calendar(identifier: .gregorian)
        seoul.timeZone = TimeZone(identifier: "Asia/Seoul")!
        func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
            seoul.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
        }
        // Thursday 2026-10-08 10:20.
        let now = at(8, 10, 20)
        func show(_ date: Date?) -> String {
            guard let date else { return "-" }
            let p = seoul.dateComponents([.year, .month, .day, .hour, .minute], from: date)
            return String(format: "%04d-%02d-%02d %02d:%02d", p.year!, p.month!, p.day!, p.hour!, p.minute!)
        }
        func hm(_ minutes: Int) -> String { String(format: "%02d:%02d", minutes % 1440 / 60, minutes % 60) }
        func describe(_ candidate: Intent.Candidate, _ language: AppLanguage, now: Date) -> String {
            let fields: String
            switch candidate {
            case .todo(let parsed):
                fields = "todo \"\(parsed.title)\"" + (parsed.range.map { " range \(hm($0.start))–\($0.end.map(hm) ?? "")" } ?? "")
                    + (parsed.dueDate.map { " due \($0)" } ?? "") + (parsed.reminderAt.map { " reminder \(show($0))" } ?? "")
            case .event(let event):
                fields = "event \"\(event.title)\" \(event.date) " + (event.allDay ? "all-day" : "\(hm(event.start))–\(hm(event.end))")
            default:
                fields = "\(candidate.kind)"
            }
            return fields + " ⟨" + candidate.chip(language, now: now, calendar: seoul) + "⟩"
        }
        func read(_ text: String, _ language: AppLanguage, now: Date = now) -> [String] {
            Intent.read(text, now: now, calendar: seoul, language: language).map { describe($0, language, now: now) }
        }

        // MARK: 1. Data

        try test("D1–D6 lenient reading") {
            func decode(_ json: String) throws -> TodoItem {
                let text = #"{"items":[{"id":"6F0C9A9E-2B61-4C55-9C11-1D2E3F4A5B6C","title":"보고서","isCompleted":false,"createdAt":"2026-10-08T01:00:00Z","#
                    + json.dropFirst().dropLast() + "}]}"
                let decoder = JSONDecoder()
                decoder.dateDecodingStrategy = .iso8601
                return try decoder.decode(Notebook.self, from: Data(text.utf8)).items[0]
            }
            let rows: [(String, String?, String?)] = [
                (#"{"timeStart":"14:00","timeEnd":"15:30"}"#, "14:00", "15:30"),
                (#"{"timeStart":"9:05"}"#, "09:05", nil),
                (#"{"timeStart":"14:00","timeEnd":"13:00"}"#, "14:00", nil),
                (#"{"timeStart":"25:00","timeEnd":"26:00"}"#, nil, nil),
                (#"{"timeEnd":"15:00"}"#, nil, nil),
                (#"{"timeStart":"14:00","timeEnd":"14:00"}"#, "14:00", nil),
            ]
            for (index, row) in rows.enumerated() {
                let item = try decode(row.0)
                try equal(item.timeStart, row.1, "D\(index + 1) start")
                try equal(item.timeEnd, row.2, "D\(index + 1) end")
            }
        }

        try test("keys omitted when nil, written as HH:mm") {
            var item = TodoItem(title: "보고서", createdAt: now)
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            try expect(!String(decoding: try encoder.encode(item), as: UTF8.self).contains("time"), "no time keys")
            item.timeRange = TimeRange(start: 9 * 60 + 5, end: 15 * 60 + 30)
            let text = String(decoding: try encoder.encode(item), as: UTF8.self)
            try expect(text.contains(#""timeStart":"09:05""#) && text.contains(#""timeEnd":"15:30""#), text)
        }

        try test("range day: deadline, today on the sheet, none on 언젠가") {
            var item = TodoItem(title: "a", createdAt: now)
            try equal(TimeBlock.day(of: item, now: now, calendar: seoul), "2026-10-08", "today")
            item.dueDate = "2026-10-12"
            try equal(TimeBlock.day(of: item, now: now, calendar: seoul), "2026-10-12", "due")
            item.dueDate = nil
            item.shelf = .later
            try equal(TimeBlock.day(of: item, now: now, calendar: seoul), nil, "someday")
            // Before 4 a.m. it is still yesterday's sheet.
            item.shelf = nil
            try equal(TimeBlock.day(of: item, now: at(9, 2), calendar: seoul), "2026-10-08", "4 a.m. rule")
        }

        // MARK: 2. Reading

        let rows: [(String, AppLanguage, String, [String])] = [
            ("R1", .ko, "3시부터 5시까지 보고서", [
                "todo \"보고서\" range 15:00–17:00 reminder 2026-10-08 15:00 ⟨할 일 · 오늘 15:00–17:00⟩",
                "event \"보고서\" 2026-10-08 15:00–17:00 ⟨일정 · 오늘(목) 15:00–17:00⟩"]),
            ("R2", .ko, "14:00-15:30 보고서", [
                "todo \"보고서\" range 14:00–15:30 reminder 2026-10-08 14:00 ⟨할 일 · 오늘 14:00–15:30⟩",
                "event \"보고서\" 2026-10-08 14:00–15:30 ⟨일정 · 오늘(목) 14:00–15:30⟩"]),
            ("R3", .ko, "보고서 2시~4시", [
                "todo \"보고서\" range 14:00–16:00 reminder 2026-10-08 14:00 ⟨할 일 · 오늘 14:00–16:00⟩",
                "event \"보고서\" 2026-10-08 14:00–16:00 ⟨일정 · 오늘(목) 14:00–16:00⟩"]),
            ("R4", .ko, "오후 2시부터 1시간 보고서", [
                "todo \"보고서\" range 14:00–15:00 reminder 2026-10-08 14:00 ⟨할 일 · 오늘 14:00–15:00⟩",
                "event \"보고서\" 2026-10-08 14:00–15:00 ⟨일정 · 오늘(목) 14:00–15:00⟩"]),
            ("R5", .ko, "내일 10시~11시 반 회의", [
                "event \"회의\" 2026-10-09 10:00–11:30 ⟨일정 · 내일(금) 10:00–11:30⟩",
                "todo \"회의\" range 10:00–11:30 due 2026-10-09 reminder 2026-10-09 10:00 ⟨할 일 · 내일 10:00–11:30⟩"]),
            ("R6", .ko, "오후 2시~4시 장보기", [
                "todo \"장보기\" range 14:00–16:00 reminder 2026-10-08 14:00 ⟨할 일 · 오늘 14:00–16:00⟩",
                "event \"장보기\" 2026-10-08 14:00–16:00 ⟨일정 · 오늘(목) 14:00–16:00⟩"]),
            ("R7", .ko, "11시~1시 점심 준비", [
                "event \"점심 준비\" 2026-10-08 11:00–13:00 ⟨일정 · 오늘(목) 11:00–13:00⟩",
                "todo \"점심 준비\" range 11:00–13:00 reminder 2026-10-08 11:00 ⟨할 일 · 오늘 11:00–13:00⟩"]),
            ("R8", .ko, "8:00-9:00 운동", [
                "todo \"운동\" range 08:00–09:00 due 2026-10-09 reminder 2026-10-09 08:00 ⟨할 일 · 내일 08:00–09:00⟩",
                "event \"운동\" 2026-10-09 08:00–09:00 ⟨일정 · 내일(금) 08:00–09:00⟩"]),
            ("R9", .ko, "10:00-11:00 정리", [
                "todo \"정리\" range 10:00–11:00 ⟨할 일 · 오늘 10:00–11:00⟩",
                "event \"정리\" 2026-10-08 10:00–11:00 ⟨일정 · 오늘(목) 10:00–11:00⟩"]),
            ("R11", .ko, "금요일 9시부터 30분 동안 통화", [
                "todo \"통화\" range 09:00–09:30 due 2026-10-09 reminder 2026-10-09 09:00 ⟨할 일 · 내일 09:00–09:30⟩",
                "event \"통화\" 2026-10-09 09:00–09:30 ⟨일정 · 내일(금) 09:00–09:30⟩"]),
            ("R12", .en, "report 2-4pm", [
                "todo \"report\" range 14:00–16:00 reminder 2026-10-08 14:00 ⟨To-do · today 2:00–4:00 PM⟩",
                "event \"report\" 2026-10-08 14:00–16:00 ⟨Event · today (Thu) 2:00–4:00 PM⟩"]),
            ("R13", .en, "report from 2 to 4", [
                "todo \"report\" range 14:00–16:00 reminder 2026-10-08 14:00 ⟨To-do · today 2:00–4:00 PM⟩",
                "event \"report\" 2026-10-08 14:00–16:00 ⟨Event · today (Thu) 2:00–4:00 PM⟩"]),
            ("R14", .en, "2pm–3:30pm report", [
                "todo \"report\" range 14:00–15:30 reminder 2026-10-08 14:00 ⟨To-do · today 2:00–3:30 PM⟩",
                "event \"report\" 2026-10-08 14:00–15:30 ⟨Event · today (Thu) 2:00–3:30 PM⟩"]),
            ("R15", .en, "meeting tomorrow 11-1pm", [
                "event \"meeting\" 2026-10-09 11:00–13:00 ⟨Event · tomorrow (Fri) 11:00 AM–1:00 PM⟩",
                "todo \"meeting\" range 11:00–13:00 due 2026-10-09 reminder 2026-10-09 11:00 ⟨To-do · tomorrow 11:00 AM–1:00 PM⟩"]),
            ("R16", .ko, "23:00-01:00 정리", [
                "todo \"정리\" range 23:00–01:00 reminder 2026-10-08 23:00 ⟨할 일 · 오늘 23:00–01:00⟩",
                "event \"정리\" 2026-10-08 23:00–01:00 ⟨일정 · 오늘(목) 23:00–01:00⟩"]),
            ("R17", .nl, "verslag 14:00-15:30", [
                "todo \"verslag\" range 14:00–15:30 reminder 2026-10-08 14:00 ⟨Taak · vandaag 14:00–15:30⟩",
                "event \"verslag\" 2026-10-08 14:00–15:30 ⟨Afspraak · vandaag (do) 14:00–15:30⟩"]),
            ("R18", .nl, "verslag van 2 tot 4 uur", [
                "todo \"verslag\" range 14:00–16:00 reminder 2026-10-08 14:00 ⟨Taak · vandaag 14:00–16:00⟩",
                "event \"verslag\" 2026-10-08 14:00–16:00 ⟨Afspraak · vandaag (do) 14:00–16:00⟩"]),
            ("R19", .nl, "morgen van 9 tot 10 uur tandarts", [
                "event \"tandarts\" 2026-10-09 09:00–10:00 ⟨Afspraak · morgen (vr) 09:00–10:00⟩",
                "todo \"tandarts\" range 09:00–10:00 due 2026-10-09 reminder 2026-10-09 09:00 ⟨Taak · morgen 09:00–10:00⟩"]),
            ("R20", .ko, "3시 회의", [
                "event \"회의\" 2026-10-08 15:00–16:00 ⟨일정 · 오늘(목) 15:00–16:00⟩",
                "todo \"회의\" reminder 2026-10-08 15:00 ⟨할 일 · 알림 15:00⟩"]),
            ("R21", .en, "read chapters 2-4", [
                "todo \"read chapters 2-4\" ⟨To-do⟩", "memo ⟨Save as a note⟩"]),
            ("R22", .ko, "22:00-23:30 정리", [
                "todo \"정리\" range 22:00–23:30 reminder 2026-10-08 22:00 ⟨할 일 · 오늘 22:00–23:30⟩",
                "event \"정리\" 2026-10-08 22:00–23:30 ⟨일정 · 오늘(목) 22:00–23:30⟩"]),
        ]
        for (name, language, input, expected) in rows {
            try test("\(name) \(language) \(input)") {
                let got = read(input, language)
                try expect(got == expected, "\(name) \(input):\n  expected \(expected.joined(separator: "; "))\n  got      \(got.joined(separator: "; "))")
            }
        }

        // The Windows rows 301–324 in intent-cases.md (now Thursday 14:50), in their notation.
        let windowsNow = at(8, 14, 50)
        func describeW(_ candidate: Intent.Candidate, _ language: AppLanguage) -> String {
            let today = "2026-10-08"
            let fields: String
            switch candidate {
            case .todo(let parsed):
                fields = "todo \"\(parsed.title)\"" + (parsed.range.map { " range \(parsed.dueDate ?? today) \(hm($0.start))–\($0.end.map(hm) ?? "")" } ?? "")
                    + (parsed.reminderAt.map { " reminder \(show($0))" } ?? "") + (parsed.dueDate.map { " due \($0)" } ?? "")
            case .event(let event):
                fields = "event \"\(event.title)\" \(event.date) " + (event.allDay ? "all-day" : "\(hm(event.start))–\(hm(event.end))")
            case .memo(let text):
                fields = "memo \"\(text)\""
            default:
                fields = "\(candidate.kind)"
            }
            return fields + " ⟨" + candidate.chip(language, now: windowsNow, calendar: seoul) + "⟩"
        }
        let windowsRows: [(String, AppLanguage, String, [String])] = [
            ("301", .ko, "3시부터 5시까지 보고서", ["todo \"보고서\" range 2026-10-08 15:00–17:00 reminder 2026-10-08 15:00 ⟨할 일 · 오늘 15:00–17:00⟩", "event \"보고서\" 2026-10-08 15:00–17:00 ⟨일정 · 오늘(목) 15:00–17:00⟩"]),
            ("302", .ko, "14:00-15:30 보고서", ["todo \"보고서\" range 2026-10-08 14:00–15:30 ⟨할 일 · 오늘 14:00–15:30⟩", "event \"보고서\" 2026-10-08 14:00–15:30 ⟨일정 · 오늘(목) 14:00–15:30⟩"]),
            ("303", .ko, "보고서 2시~4시", ["todo \"보고서\" range 2026-10-08 14:00–16:00 ⟨할 일 · 오늘 14:00–16:00⟩", "event \"보고서\" 2026-10-08 14:00–16:00 ⟨일정 · 오늘(목) 14:00–16:00⟩"]),
            ("304", .ko, "오후 2시부터 1시간 보고서", ["todo \"보고서\" range 2026-10-08 14:00–15:00 ⟨할 일 · 오늘 14:00–15:00⟩", "event \"보고서\" 2026-10-08 14:00–15:00 ⟨일정 · 오늘(목) 14:00–15:00⟩"]),
            ("305", .ko, "내일 3시부터 5시까지 회의", ["event \"회의\" 2026-10-09 15:00–17:00 ⟨일정 · 내일(금) 15:00–17:00⟩", "todo \"회의\" range 2026-10-09 15:00–17:00 reminder 2026-10-09 15:00 due 2026-10-09 ⟨할 일 · 내일 15:00–17:00⟩"]),
            ("306", .ko, "9시~10시 운동", ["todo \"운동\" range 2026-10-09 09:00–10:00 reminder 2026-10-09 09:00 due 2026-10-09 ⟨할 일 · 내일 09:00–10:00⟩", "event \"운동\" 2026-10-09 09:00–10:00 ⟨일정 · 내일(금) 09:00–10:00⟩"]),
            ("307", .ko, "오후 7시부터 9시까지 청소", ["todo \"청소\" range 2026-10-08 19:00–21:00 reminder 2026-10-08 19:00 ⟨할 일 · 오늘 19:00–21:00⟩", "event \"청소\" 2026-10-08 19:00–21:00 ⟨일정 · 오늘(목) 19:00–21:00⟩"]),
            ("308", .ko, "1~2시간 독서", ["todo \"1~2시간 독서\" ⟨할 일⟩", "memo \"1~2시간 독서\" ⟨메모로 남기기⟩"]),
            ("309", .ko, "16:00~17:00 보고서", ["todo \"보고서\" range 2026-10-08 16:00–17:00 reminder 2026-10-08 16:00 ⟨할 일 · 오늘 16:00–17:00⟩", "event \"보고서\" 2026-10-08 16:00–17:00 ⟨일정 · 오늘(목) 16:00–17:00⟩"]),
            ("310", .ko, "/할일 3시부터 5시까지 보고서", ["todo \"보고서\" range 2026-10-08 15:00–17:00 reminder 2026-10-08 15:00 ⟨할 일 · 오늘 15:00–17:00⟩"]),
            ("311", .ko, "/일정 3시부터 5시까지 보고서", ["event \"보고서\" 2026-10-08 15:00–17:00 ⟨일정 · 오늘(목) 15:00–17:00⟩"]),
            ("312", .ko, "3~5시 보고서", ["todo \"보고서\" range 2026-10-08 15:00–17:00 reminder 2026-10-08 15:00 ⟨할 일 · 오늘 15:00–17:00⟩", "event \"보고서\" 2026-10-08 15:00–17:00 ⟨일정 · 오늘(목) 15:00–17:00⟩"]),
            ("313", .ko, "4시 반부터 6시 보고서", ["todo \"보고서\" range 2026-10-08 16:30–18:00 reminder 2026-10-08 16:30 ⟨할 일 · 오늘 16:30–18:00⟩", "event \"보고서\" 2026-10-08 16:30–18:00 ⟨일정 · 오늘(목) 16:30–18:00⟩"]),
            ("314", .en, "report 2-4pm", ["todo \"report\" range 2026-10-08 14:00–16:00 ⟨To-do · today 2:00–4:00 PM⟩", "event \"report\" 2026-10-08 14:00–16:00 ⟨Event · today (Thu) 2:00–4:00 PM⟩"]),
            ("315", .en, "report from 2 to 4", ["todo \"report\" range 2026-10-08 14:00–16:00 ⟨To-do · today 2:00–4:00 PM⟩", "event \"report\" 2026-10-08 14:00–16:00 ⟨Event · today (Thu) 2:00–4:00 PM⟩"]),
            ("316", .en, "2pm–3:30pm report", ["todo \"report\" range 2026-10-08 14:00–15:30 ⟨To-do · today 2:00–3:30 PM⟩", "event \"report\" 2026-10-08 14:00–15:30 ⟨Event · today (Thu) 2:00–3:30 PM⟩"]),
            ("317", .en, "read pages 2-4", ["todo \"read pages 2-4\" ⟨To-do⟩", "memo \"read pages 2-4\" ⟨Save as a note⟩"]),
            ("318", .en, "meeting tomorrow 10-11am", ["event \"meeting\" 2026-10-09 10:00–11:00 ⟨Event · tomorrow (Fri) 10:00–11:00 AM⟩", "todo \"meeting\" range 2026-10-09 10:00–11:00 reminder 2026-10-09 10:00 due 2026-10-09 ⟨To-do · tomorrow 10:00–11:00 AM⟩"]),
            ("319", .en, "report 11-1pm", ["todo \"report\" range 2026-10-09 11:00–13:00 reminder 2026-10-09 11:00 due 2026-10-09 ⟨To-do · tomorrow 11:00 AM–1:00 PM⟩", "event \"report\" 2026-10-09 11:00–13:00 ⟨Event · tomorrow (Fri) 11:00 AM–1:00 PM⟩"]),
            ("320", .en, "보고서 3시부터 5시까지", ["todo \"보고서\" range 2026-10-08 15:00–17:00 reminder 2026-10-08 15:00 ⟨To-do · today 3:00–5:00 PM⟩", "event \"보고서\" 2026-10-08 15:00–17:00 ⟨Event · today (Thu) 3:00–5:00 PM⟩"]),
            ("321", .nl, "verslag 14:00-15:30", ["todo \"verslag\" range 2026-10-08 14:00–15:30 ⟨Taak · vandaag 14:00–15:30⟩", "event \"verslag\" 2026-10-08 14:00–15:30 ⟨Afspraak · vandaag (do) 14:00–15:30⟩"]),
            ("322", .nl, "verslag van 2 tot 4 uur", ["todo \"verslag\" range 2026-10-08 14:00–16:00 ⟨Taak · vandaag 14:00–16:00⟩", "event \"verslag\" 2026-10-08 14:00–16:00 ⟨Afspraak · vandaag (do) 14:00–16:00⟩"]),
            ("323", .nl, "morgen van 9 tot 10 uur overleg", ["event \"overleg\" 2026-10-09 09:00–10:00 ⟨Afspraak · morgen (vr) 09:00–10:00⟩", "todo \"overleg\" range 2026-10-09 09:00–10:00 reminder 2026-10-09 09:00 due 2026-10-09 ⟨Taak · morgen 09:00–10:00⟩"]),
            ("324", .nl, "pagina 2-4 lezen", ["todo \"pagina 2-4 lezen\" ⟨Taak⟩", "memo \"pagina 2-4 lezen\" ⟨Bewaren als notitie⟩"]),
        ]
        for (name, language, input, expected) in windowsRows {
            try test("W\(name) \(language) \(input)") {
                let got = Intent.read(input, now: windowsNow, calendar: seoul, language: language).map { describeW($0, language) }
                try expect(got == expected, "\(name) \(input):\n  expected \(expected.joined(separator: "; "))\n  got      \(got.joined(separator: "; "))")
            }
        }

        try test("R10 an end before the start is no range") {
            let parsed = QuickParse.parse("5시~3시 보고서", now: now, calendar: seoul, language: .ko)
            try equal(parsed.range, nil, "no range")
            let late = QuickParse.parse("23:00-23:30 정리", now: now, calendar: seoul, language: .ko)
            try equal(late.range, TimeRange(start: 23 * 60, end: 23 * 60 + 30), "late range")
            try equal(QuickParse.parse("03:00-05:00 정리", now: now, calendar: seoul, language: .ko).range, nil, "across 04:00")
            try equal(QuickParse.parse("1~2시간 운동", now: now, calendar: seoul, language: .ko).range, nil, "1~2시간")
            try equal(QuickParse.parse("verslag 14-16 uur", now: now, calendar: seoul, language: .nl).range, nil, "nl needs van…tot or clocks")
        }

        try test("toasts") {
            func toast(_ text: String, _ language: AppLanguage) -> String {
                Intent.addedText(Intent.read(text, now: now, calendar: seoul, language: language)[0], language: language, now: now, calendar: seoul)
            }
            try equal(toast("3시부터 5시까지 보고서", .ko), "할 일로 넣었어요 · 오늘 15:00–17:00", "ko")
            try equal(toast("2pm–3:30pm report", .en), "Added as a to-do · today 2:00–3:30 PM", "en")
            try equal(toast("verslag 14:00-15:30", .nl), "Toegevoegd als taak · vandaag 14:00–15:30", "nl")
        }

        // MARK: 3. The ribbon

        func task(_ title: String, _ start: String, _ end: String? = nil, done: Bool = false, reminder: Date? = nil) -> TodoItem {
            var item = TodoItem(title: title, isCompleted: done, createdAt: at(8, 8), reminderAt: reminder)
            item.timeStart = start
            item.timeEnd = end
            return item
        }
        func event(_ title: String, _ from: (Int, Int), _ to: (Int, Int)) -> CalendarEvent {
            CalendarEvent(key: title, calendarId: "local", title: title, allDay: false, start: at(8, from.0, from.1), end: at(8, to.0, to.1), color: "blue")
        }
        func layout(_ events: [CalendarEvent], _ tasks: [TodoItem], now: Date, reminders: [DayRibbon.Reminder] = []) -> DayRibbon.Layout {
            DayRibbon.layout(events: events, reminders: reminders, blocks: DayRibbon.blocks(tasks, now: now, calendar: seoul), now: now, calendar: seoul)
        }
        try test("L1–L6 lanes and span") {
            var l = layout([event("e", (10, 0), (11, 0))], [task("A", "14:00", "15:30")], now: at(8, 9))
            try equal(l.blocks.map(\.lane), [0], "L1"); try equal(l.taskLanes, 1, "L1 one task lane")
            l = layout([event("e", (14, 0), (15, 0))], [task("A", "14:30", "16:00")], now: at(8, 9))
            try equal(l.blocks.map(\.lane), [0], "L2 (events have their own lane)"); try equal(l.taskLanes, 1, "L2 lanes")
            l = layout([], [task("A", "14:00", "15:00"), task("B", "14:30", "15:30"), task("C", "14:45", "15:00")], now: at(8, 9))
            try equal(l.blocks.map(\.lane), [0, 1, 1], "L3 (a third overlap shares lane 1)"); try equal(l.taskLanes, 2, "L3 lanes")
            l = layout([], [], now: at(8, 9))
            try equal(l.taskLanes, 0, "no blocks, no task lane")
            l = layout([], [task("A", "14:00")], now: at(8, 9))
            try equal(l.blocks.map(\.lane), [0], "L4 lane")
            try equal(l.blocks[0].start, 14 * 60, "L4 start"); try equal(l.blocks[0].end, 14 * 60 + 30, "L4 drawn end")
            l = layout([event("e", (15, 0), (16, 0))], [task("A", "14:00", "15:00")], now: at(8, 9))
            try equal(l.blocks.map(\.lane), [0], "L5")
            l = layout([], [task("A", "07:00", "08:00")], now: at(8, 6))
            try equal(l.startHour, 7, "L6 start"); try equal(l.endHour, 24, "L6 end")
        }
        try test("L7–L10 now, next, overdue, done, rings") {
            var l = layout([event("치과", (15, 0), (16, 0))], [task("보고서", "14:00", "15:30")], now: at(8, 14, 10))
            try equal(l.current?.title, "보고서", "L7 current")
            try equal(l.next?.title, "치과", "L7 next"); try equal(l.next?.isEvent, true, "L7 next is the event")
            l = layout([], [task("A", "09:00", "10:00")], now: at(8, 10, 20))
            try equal(l.blocks.map(\.overdue), [true], "L8")
            l = layout([], [task("A", "09:00", "10:00", done: true)], now: at(8, 10, 20))
            try equal(l.blocks.map(\.overdue), [false], "L9 not overdue"); try equal(l.blocks.map(\.done), [true], "L9 done")
            try equal(l.current == nil && l.next == nil, true, "L9 no current or next")
            let ranged = task("A", "14:00", "15:00", reminder: at(8, 14))
            let reminders = DayRibbon.reminders([ranged], now: at(8, 9), calendar: seoul)
            l = layout([], [ranged], now: at(8, 9), reminders: reminders)
            try equal(l.rings.count, 0, "L10 no ring"); try equal(l.next?.title, "A", "L10 next")
            var other = task("B", "14:00", "15:00", reminder: at(8, 13))
            other.id = UUID()
            try equal(DayRibbon.reminders([other], now: at(8, 9), calendar: seoul).count, 1, "another time keeps its ring")
        }

        // MARK: 4. Changing a range

        try test("C1–C6 reminder coupling") {
            func change(_ item: TodoItem, to range: TimeRange?) -> TodoItem {
                var notebook = Notebook(items: [item])
                notebook.setTimeRange(id: item.id, to: range, now: now)
                return notebook.items[0]
            }
            let plain = TodoItem(title: "a", createdAt: now)
            var after = change(plain, to: TimeRange(start: 840, end: 900))
            try equal(after.timeStart, "14:00", "C1 start"); try equal(after.timeEnd, "15:00", "C1 end"); try equal(show(after.reminderAt), "2026-10-08 14:00", "C1 reminder")
            var withReminder = plain; withReminder.reminderAt = at(8, 13)
            after = change(withReminder, to: TimeRange(start: 840, end: 900))
            try equal(show(after.reminderAt), "2026-10-08 13:00", "C2")
            var atStart = plain; atStart.timeRange = TimeRange(start: 840, end: 900); atStart.reminderAt = at(8, 14)
            after = change(atStart, to: TimeRange(start: 960, end: 1020))
            try equal(show(after.reminderAt), "2026-10-08 16:00", "C3")
            var elsewhere = atStart; elsewhere.reminderAt = at(8, 13, 30)
            after = change(elsewhere, to: TimeRange(start: 960, end: 1020))
            try equal(show(after.reminderAt), "2026-10-08 13:30", "C4")
            after = change(plain, to: TimeRange(start: 540, end: 600))
            try equal(after.reminderAt, nil, "C5")
            after = change(atStart, to: nil)
            try equal(after.timeStart, nil, "C6 cleared"); try equal(show(after.reminderAt), "2026-10-08 14:00", "C6 reminder stays")
            // C4b (1.40, as Windows): moved back to a start already gone → the reminder there is delivered now.
            var late = plain; late.timeRange = TimeRange(start: 840, end: 900); late.reminderAt = at(8, 14)
            var notebook = Notebook(items: [late])
            notebook.setTimeRange(id: late.id, to: TimeRange(start: 600, end: 690), now: at(8, 14, 50))
            try equal(show(notebook.items[0].reminderAt), "2026-10-08 10:00", "C4b reminder moves")
            try equal(notebook.items[0].reminderLastDeliveredAt, at(8, 14, 50), "C4b delivered now")
            after = change(atStart, to: TimeRange(start: 960, end: 1020))
            try equal(after.reminderLastDeliveredAt, nil, "C4 ahead: not delivered")
        }

        try test("drag in 15-minute steps inside the track") {
            let range = TimeRange(start: 840, end: 900)
            try equal(TimeBlock.dragged(range, edge: .end, by: 22, bounds: 480...1440), TimeRange(start: 840, end: 915), "stretch end")
            try equal(TimeBlock.dragged(range, edge: .start, by: 80, bounds: 480...1440), TimeRange(start: 885, end: 900), "start stops 15 before the end")
            try equal(TimeBlock.dragged(range, edge: .whole, by: -400, bounds: 480...1440), TimeRange(start: 480, end: 540), "move stops at the track's start")
            try equal(TimeBlock.dragged(TimeRange(start: 840), edge: .whole, by: 30, bounds: 480...1440), TimeRange(start: 870), "a start alone moves alone")
        }

        // MARK: 5. Lists

        try test("다음 includes ranged tasks by start, ending ahead") {
            var a = TodoItem(title: "a", createdAt: now); a.timeRange = TimeRange(start: 16 * 60, end: 17 * 60)
            var b = TodoItem(title: "b", createdAt: now); b.reminderAt = at(8, 15)
            var c = TodoItem(title: "c", createdAt: now); c.timeRange = TimeRange(start: 9 * 60, end: 10 * 60) // over
            var d = TodoItem(title: "d", createdAt: now); d.timeRange = TimeRange(start: 10 * 60, end: 11 * 60) // going on
            let split = TodayGroups.split([a, b, c, d], series: [], now: now, calendar: seoul)
            try equal(split.next, [d.id, b.id, a.id], "order by time")
        }

        try test("focus length: minutes left until the end") {
            var item = TodoItem(title: "a", createdAt: now)
            item.timeRange = TimeRange(start: 10 * 60, end: 11 * 60 + 30)
            try equal(TimeBlock.focusMinutes(item, now: now, calendar: seoul), 70, "70 min left")
            item.timeRange = TimeRange(start: 9 * 60, end: 10 * 60)
            try equal(TimeBlock.focusMinutes(item, now: now, calendar: seoul), nil, "over")
            item.timeRange = TimeRange(start: 14 * 60, end: 18 * 60)
            try equal(TimeBlock.focusMinutes(item, now: now, calendar: seoul), nil, "more than 180 min")
            item.timeRange = TimeRange(start: 14 * 60)
            try equal(TimeBlock.focusMinutes(item, now: now, calendar: seoul), 30, "a start alone: 30")
            // Begun in its first 5 minutes: the whole range (a 30-minute task at 10:20 started 3 min late is 30, not 27).
            item.timeRange = TimeRange(start: 10 * 60 + 17, end: 10 * 60 + 47)
            try equal(TimeBlock.focusMinutes(item, now: now, calendar: seoul), 30, "3 min in: whole range")
            item.timeRange = TimeRange(start: 10 * 60 + 15, end: 10 * 60 + 45)
            try equal(TimeBlock.focusMinutes(item, now: now, calendar: seoul), 30, "exactly 5 min in: whole range")
            item.timeRange = TimeRange(start: 10 * 60 + 14, end: 10 * 60 + 44)
            try equal(TimeBlock.focusMinutes(item, now: now, calendar: seoul), 24, "6 min in: minutes left")
        }

        try test("export text and tooltip") {
            var item = TodoItem(title: "보고서", createdAt: now)
            item.timeRange = TimeRange(start: 840, end: 930)
            try equal(TimeBlock.exportText(item, language: .ko), " (14:00–15:30)", "ko")
            try equal(TimeBlock.exportText(item, language: .en), " (2:00–3:30 PM)", "en")
            try equal(TimeBlock.tooltip(item, language: .nl), "보고서 · 14:00–15:30", "nl tooltip")
            item.timeRange = TimeRange(start: 840)
            try equal(TimeBlock.tooltip(item, language: .ko), "보고서 · 14:00–14:30", "start alone")
            try equal(TimeBlock.exportText(item, language: .en), " (2:00 PM)", "start alone export")
            item.timeStart = "23:00"; item.timeEnd = "01:00"
            try equal(item.timeRange, TimeRange(start: 1380, end: 1500), "past midnight in the 4 a.m. day")
            try equal(item.timeRange?.text(.en), "11:00 PM–1:00 AM", "past midnight text")
            item.timeStart = "03:00"; item.timeEnd = "05:00"
            try equal(item.timeRange, TimeRange(start: 1620), "05:00 comes before 03:00 in the day")
        }

        // 1.39 performance: the record's dates read without making formatters — the same dates as before.
        try test("record dates read as ISO 8601 did") {
            let plain = ISO8601DateFormatter()
            let fractional = ISO8601DateFormatter()
            fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            for text in ["2026-10-08T05:00:00Z", "1999-12-31T23:59:59Z", "2026-02-28T00:00:00Z", "2024-02-29T12:30:45Z",
                         "2026-10-08T05:00:00.123Z", "2026-10-08T14:00:00+09:00", "2026-02-31T00:00:00Z", "2026-13-01T00:00:00Z",
                         "2026-10-08 05:00:00Z", "nonsense", ""] {
                let expected = plain.date(from: text) ?? fractional.date(from: text)
                try equal(Archive.isoDate(text), expected, text)
            }
        }

        print("\(count) time block tests passed")
    }
}
