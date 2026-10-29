import Foundation

// 편의 기능 (Convenience.swift, QuickParse's Korean relative times): the same cases as the Windows app
// (test/convenience.test.ts), listed in convenience-cases.md. Framework-free like the other core tests.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private let seoul: Calendar = {
    var calendar = Calendar(identifier: .gregorian)
    calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
    return calendar
}()

private func at(_ day: Int, _ hour: Int, _ minute: Int = 0, second: Int = 0, month: Int = 10) -> Date {
    seoul.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute, second: second))!
}

private func show(_ date: Date?) -> String {
    guard let date else { return "-" }
    let p = seoul.dateComponents([.year, .month, .day, .hour, .minute], from: date)
    return String(format: "%04d-%02d-%02d %02d:%02d", p.year!, p.month!, p.day!, p.hour!, p.minute!)
}

/// Thursday 2026-10-08 14:50.
private let now = at(8, 14, 50)

private func task(_ title: String = "t", done: Bool = false, due: String? = nil, shelf: ShelfPin? = nil, series: String? = nil,
                  since: String? = nil, reminder: Date? = nil) -> TodoItem {
    var item = TodoItem(title: title, isCompleted: done, reminderAt: reminder, seriesID: series)
    item.dueDate = due
    item.shelf = shelf
    item.todaySince = since
    return item
}

@main
private enum ConvenienceTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        try test("todaySince: stamps and labels (C1–C14)") {
            let ko = "어제부터 / since yesterday / sinds gisteren"
            let cases: [(String, Date, TodoItem, String?, String?)] = [
                ("C1", now, task(), "2026-10-08", nil),
                ("C2", now, task(since: "2026-10-07"), "2026-10-07", ko),
                ("C3", now, task(since: "2026-10-06"), "2026-10-06", "3일째 / 3 days / 3 dagen"),
                ("C4", now, task(since: "2026-10-01"), "2026-10-01", "8일째 / 8 days / 8 dagen"),
                ("C5", now, task(done: true, since: "2026-10-06"), nil, nil),
                ("C6", now, task(due: "2026-10-08", since: "2026-10-07"), nil, nil),
                ("C7", now, task(shelf: .later, since: "2026-10-07"), nil, nil),
                ("C8", now, task(series: "s1"), nil, nil),
                ("C9", now, task(since: "2026-10-09"), "2026-10-08", nil),
                ("C10", at(9, 2), task(since: "2026-10-08"), "2026-10-08", nil),
                ("C11", at(9, 4, 30), task(since: "2026-10-08"), "2026-10-08", ko),
                ("C12", now, task(since: "yesterday"), "2026-10-08", nil),
                ("C13", now, task(shelf: .today), "2026-10-08", nil),
                ("C14", now, task(due: "2026-10-12"), nil, nil),
            ]
            for (name, when, item, after, label) in cases {
                var stamped = item
                if let change = Carry.stamps([item], now: when, calendar: seoul)[item.id] { stamped.todaySince = change }
                try expect(stamped.todaySince == after, "\(name): \(stamped.todaySince ?? "nil")")
                let labels = AppLanguage.allCases.map { Carry.label(stamped, now: when, calendar: seoul, language: $0) }
                let got = labels.allSatisfy { $0 == nil } ? nil : labels.map { $0 ?? "-" }.joined(separator: " / ")
                try expect(got == label, "\(name) label: \(got ?? "nil")")
            }
            // JSON: the key is "todaySince"; an old file without it reads fine.
            let old = #"{"items":[{"id":"7F1B4C2E-1C1A-4E0B-9F57-1A2B3C4D5E6F","title":"a","isCompleted":false,"createdAt":"2026-10-08T05:50:00Z"}]}"#
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            let notebook = try decoder.decode(Notebook.self, from: Data(old.utf8))
            try expect(notebook.items.first?.todaySince == nil, "old file")
            var stamped = notebook.items[0]
            stamped.todaySince = "2026-10-07"
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.sortedKeys]
            encoder.dateEncodingStrategy = .iso8601
            let json = String(decoding: try encoder.encode(stamped), as: UTF8.self)
            try expect(json.contains(#""todaySince":"2026-10-07""#), json)
            try expect(!String(decoding: try encoder.encode(notebook.items[0]), as: UTF8.self).contains("todaySince"), "absent when nil")
        }

        try test("todaySince: bookkeeping, not an undo step") {
            var history = UndoableNotebook(notebook: Notebook(items: [task("a")]))
            history.add("b", now: now)
            history.stampToday(now: now, calendar: seoul)
            try expect(history.notebook.items.allSatisfy { $0.todaySince == "2026-10-08" }, "stamped")
            history.undo()
            try expect(history.notebook.items.count == 1 && history.notebook.items[0].todaySince == "2026-10-08", "undo keeps the stamp")
        }

        try test("날짜 바꾸기: choices (M1–M6)") {
            func describe(_ choices: [DateMove.Choice]) -> String {
                choices.map { choice -> String in
                    switch choice {
                    case .tomorrow(let d): "tomorrow \(d)"
                    case .friday(let d): "friday \(d)"
                    case .nextMonday(let d): "nextMonday \(d)"
                    case .someday: "someday"
                    case .pick: "pick"
                    }
                }.joined(separator: " · ")
            }
            let cases: [(String, Date, String)] = [
                ("M1", now, "tomorrow 2026-10-09 · friday 2026-10-09 · nextMonday 2026-10-12 · someday · pick"),
                ("M2", at(9, 10), "tomorrow 2026-10-10 · nextMonday 2026-10-12 · someday · pick"),
                ("M3", at(11, 10), "tomorrow 2026-10-12 · someday · pick"),
                ("M4", at(12, 10), "tomorrow 2026-10-13 · friday 2026-10-16 · nextMonday 2026-10-19 · someday · pick"),
                ("M5", at(9, 1, 30), "tomorrow 2026-10-09 · friday 2026-10-09 · nextMonday 2026-10-12 · someday · pick"),
                ("M6", at(10, 10), "tomorrow 2026-10-11 · nextMonday 2026-10-12 · someday · pick"),
            ]
            for (name, when, expected) in cases {
                let got = describe(DateMove.choices(now: when, calendar: seoul))
                try expect(got == expected, "\(name): \(got)")
            }
            let all: [DateMove.Choice] = [.tomorrow(""), .friday(""), .nextMonday(""), .someday, .pick]
            let titles: [String] = AppLanguage.allCases.map { language in all.map { $0.title(language) }.joined(separator: " · ") }
            try expect(titles == ["내일 · 이번 주 금요일 · 다음 주 월요일 · 언젠가 · 날짜 고르기…", "Tomorrow · This Friday · Next Monday · Someday · Pick a date…",
                                  "Morgen · Deze vrijdag · Volgende maandag · Ooit · Datum kiezen…"], "\(titles)")
        }

        try test("날짜 바꾸기: a day later or earlier (S1–S7) and the toast") {
            let cases: [(String, String?, String?, String?)] = [
                ("S1", nil, "2026-10-09", nil),
                ("S2", "2026-10-12", "2026-10-13", "2026-10-11"),
                ("S3", "2026-10-09", "2026-10-10", "2026-10-08"),
                ("S4", "2026-10-08", "2026-10-09", nil),
                ("S5", "2026-10-05", "2026-10-09", nil),
            ]
            for (name, due, later, earlier) in cases {
                let plus = DateMove.shift(due, by: 1, now: now, calendar: seoul), minus = DateMove.shift(due, by: -1, now: now, calendar: seoul)
                try expect(plus == later && minus == earlier, "\(name): \(plus ?? "nil") \(minus ?? "nil")")
            }
            // S6 / S7: applying a day removes the shelf (later or today).
            for shelf in [ShelfPin.later, .today] {
                var notebook = Notebook(items: [task(due: shelf == .today ? "2026-10-08" : nil, shelf: shelf)])
                let id = notebook.items[0].id
                notebook.schedule(id: id, dueDate: DateMove.shift(notebook.items[0].dueDate, by: 1, now: now, calendar: seoul)!)
                try expect(notebook.items[0].dueDate == "2026-10-09" && notebook.items[0].shelf == nil, "S6/S7 \(shelf)")
            }
            var texts: [String] = AppLanguage.allCases.map { DateMove.movedText("2026-10-09", now: now, calendar: seoul, language: $0) }
            texts += AppLanguage.allCases.map { DateMove.movedText("2026-10-12", now: now, calendar: seoul, language: $0) }
            let wantedTexts: [String] = ["내일로 옮겼어요", "Moved to tomorrow", "Verplaatst naar morgen", "10월 12일로 옮겼어요", "Moved to Oct 12", "Verplaatst naar 12 okt"]
            try expect(texts == wantedTexts, "\(texts)")
        }

        try test("다시 알림: the choices and their times") {
            let options = Snooze.options(now: at(8, 14, 50, second: 40), calendar: seoul)
            try expect(options == [.minutes(5), .minutes(10), .minutes(30), .minutes(60), .evening, .tomorrowMorning, .tomorrow], "\(options)")
            let times: [String] = options.map { show($0.date(now: at(8, 14, 50, second: 40), calendar: seoul)) }
            try expect(times == ["2026-10-08 14:55", "2026-10-08 15:00", "2026-10-08 15:20", "2026-10-08 15:50", "2026-10-08 19:00", "2026-10-09 09:00", "-"], "\(times)")
            try expect(Snooze.options(now: at(8, 17, 59), calendar: seoul).contains(.evening), "17:59")
            try expect(!Snooze.options(now: at(8, 18), calendar: seoul).contains(.evening), "18:00")
            let late = at(9, 1)
            try expect(!Snooze.options(now: late, calendar: seoul).contains(.evening) && show(Snooze.tomorrowMorning.date(now: late, calendar: seoul)) == "2026-10-09 09:00", "01:00")
            try expect(!Snooze.options(now: now, moves: false, calendar: seoul).contains(.tomorrow), "periodic")
            let titles: [String] = AppLanguage.allCases.map { language in options.map { $0.title(language) }.joined(separator: " · ") }
            try expect(titles == [
                "5분 뒤 · 10분 뒤 · 30분 뒤 · 1시간 뒤 · 오늘 저녁 7시 · 내일 아침 9시 · 내일로 미루기",
                "In 5 min · In 10 min · In 30 min · In 1 hour · Tonight at 7 PM · Tomorrow at 9 AM · Move to tomorrow",
                "Over 5 min · Over 10 min · Over 30 min · Over 1 uur · Vanavond om 19:00 · Morgen om 09:00 · Naar morgen",
            ], "\(titles)")
            try expect(AppLanguage.allCases.map { Snooze.eventAgainTitle($0) } == ["5분 전에 다시", "5 min before", "5 min ervoor"], "event")
            try expect(show(Snooze.eventAgain(start: at(8, 15, 30), now: now)) == "2026-10-08 15:25" && Snooze.eventAgain(start: at(8, 14, 54), now: now) == nil, "event again")
        }

        try test("저녁 정리: candidates and when") {
            let evening = at(8, 20)
            let a = task("A"), b = task("B", reminder: at(8, 21)), c = task("C", reminder: at(8, 9)), d = task("D", done: true)
            let e = task("E", series: "s"), f = task("F", due: "2026-10-08"), g = task("G", due: "2026-10-12"), h = task("H", shelf: .later)
            let items = [a, b, c, d, e, f, g, h]
            try expect(Sweep.candidates(items, now: evening, calendar: seoul).map(\.title) == ["A", "C", "F"], "candidates")
            func moment(_ when: Date, _ shown: String?, opening: Bool = false, _ list: [TodoItem] = items) -> String {
                guard let due = Sweep.due(list, now: when, minutes: 1200, shown: shown, opening: opening, calendar: seoul) else { return "-" }
                return "\(due.moment.rawValue) \(due.items.map(\.title).joined(separator: ",")) \(due.mark)"
            }
            try expect(moment(at(8, 19, 59), nil) == "-", "19:59")
            try expect(moment(evening, nil) == "evening A,C,F 2026-10-08", moment(evening, nil))
            try expect(moment(evening, "2026-10-08") == "-", "shown")
            try expect(moment(at(9, 2), "") == "evening A,B,C,F 2026-10-08", moment(at(9, 2), ""))
            try expect(moment(evening, nil, [g, h]) == "-", "none")
            let carried = [task("X", since: "2026-10-08"), task("Y", since: "2026-10-09"), task("Z")]
            try expect(moment(at(9, 9), "2026-10-07", opening: true, carried) == "morning X 2026-10-08", moment(at(9, 9), "2026-10-07", opening: true, carried))
            try expect(moment(at(9, 9), "2026-10-08", opening: true, carried) == "-", "yesterday's evening came")
            try expect(moment(at(9, 9), "2026-10-07", opening: false, carried) == "-", "only when opening")
            try expect(Sweep.times.first == 1080 && Sweep.times.last == 1320 && Sweep.times.count == 9 && Sweep.defaultTime == 1200, "times")
            var words: [String] = AppLanguage.allCases.map { Sweep.question(.evening, count: 3, language: $0) }
            words.append(Sweep.question(.evening, count: 1, language: .en))
            words += AppLanguage.allCases.map { Sweep.movedText(count: 3, someday: false, language: $0) }
            words += AppLanguage.allCases.map { Sweep.movedText(count: 2, someday: true, language: $0) }
            let wanted: [String] = ["오늘 3개 남았어요. 내일로 넘길까요?", "3 to-dos left today. Move them to tomorrow?", "Nog 3 taken voor vandaag. Naar morgen schuiven?",
                                    "1 to-do left today. Move it to tomorrow?", "3개를 내일로 옮겼어요", "Moved 3 to tomorrow", "3 verplaatst naar morgen",
                                    "2개를 언젠가로 옮겼어요", "Moved 2 to Someday", "2 verplaatst naar Ooit"]
            try expect(words == wanted, "\(words)")
        }

        try test("검색: matching (Q1–Q14)") {
            func found(_ text: String, _ query: String) -> String? {
                guard let range = Search.match(query, in: text) else { return nil }
                let scalars = Array(text.precomposedStringWithCanonicalMapping.unicodeScalars)[range]
                return String(String.UnicodeScalarView(scalars))
            }
            let cases: [(String, String, String, String?)] = [
                ("Q1", "분기 보고서 초안", "보고서", "보고서"), ("Q2", "분기 보고서 초안", "ㅂㄱㅅ", "보고서"), ("Q3", "분기 보고서 초안", "ㅂㄱ", "분기"),
                ("Q4", "분기 보고서 초안", "보고ㅅ", "보고서"), ("Q5", "Coffee with Anna", "COFFEE", "Coffee"), ("Q6", "Café Noir", "cafe", "Café"),
                ("Q7", "nieuwe ideeën", "ideeen", "ideeën"), ("Q8", "ideeen lijst", "ideeën", "ideeen"), ("Q9", "까치 보기", "ㄲ", "까"),
                ("Q10", "가치 보기", "ㄲ", nil), ("Q11", "회의 준비", "ㅎ", "회"), ("Q12", "보고서", "ㅂ ㄱ", nil), ("Q13", "anything", "   ", nil),
                ("Q14", "주간 회의록", "회의록", "회의록"),
            ]
            for (name, text, query, expected) in cases {
                let got = found(text, query)
                try expect(got == expected, "\(name): \(got ?? "nil")")
            }
        }

        try test("검색: groups in order, newest first, at most 20 (완료 기록 30)") {
            let today = task("보고서 쓰기"), done = task("보고서 초안", done: true), ahead = task("보고서 제출", due: "2026-10-12")
            let someday = task("보고서 정리", shelf: .later)
            let memo = Memo(id: "m1", text: "회의\n보고서 메모", updatedAt: at(7, 10))
            let old = ArchiveEntry(id: "h1", title: "보고서 1", createdAt: at(1, 9), completedAt: at(2, 9))
            let new = ArchiveEntry(id: "h2", title: "보고서 2", createdAt: at(1, 9), completedAt: at(5, 9))
            let events = [Search.EventEntry(id: "e1", title: "보고서 회의", date: "2026-10-01"), Search.EventEntry(id: "e2", title: "보고서 발표", date: "2026-10-20"),
                          Search.EventEntry(id: "e3", title: "점심", date: "2026-10-09", location: "보고서 카페")]
            let groups = Search.find("ㅂㄱㅅ", items: [done, today, someday, ahead], memos: [memo], history: [old, new], events: events, now: now, calendar: seoul)
            let got: [String] = groups.map { group in group.group.title(.ko) + ": " + group.hits.map(\.text).joined(separator: ", ") }
            try expect(got == ["오늘: 보고서 쓰기, 보고서 초안", "앞으로: 보고서 제출, 보고서 정리", "메모: 보고서 메모", "완료 기록: 보고서 2, 보고서 1",
                               "일정: 점심, 보고서 발표, 보고서 회의"], "\(got)")
            try expect(groups[3].hits.map(\.detail) == ["10월 5일", "10월 2일"], "history days")
            let many = (0..<40).map { ArchiveEntry(id: "x\($0)", title: "보고서 \($0)", createdAt: at(1, 9), completedAt: at(1, 9)) }
            let manyTasks = (0..<25).map { task("보고서 \($0)") }
            let limited = Search.find("보고서", items: manyTasks, memos: [], history: many, events: [], now: now, calendar: seoul)
            try expect(limited.map(\.hits.count) == [20, 30], "\(limited.map(\.hits.count))")
            try expect(Search.find("  ", items: manyTasks, memos: [], history: [], events: [], now: now, calendar: seoul).isEmpty, "blank")
            // 1.43: a memo's folder in 메모 서랍 is found by its name, and named with every memo hit.
            let filed = Memo(id: "F1", text: "주간 회의\n시안 두 개", createdAt: now, updatedAt: now)
            let byFolder = Search.find("회사", items: [], memos: [filed], history: [], events: [], now: now, calendar: seoul, memoFolders: ["F1": "회사"])
            try expect(byFolder.first?.hits.first.map { $0.text == "주간 회의" && $0.range == 0..<0 && $0.detail.hasPrefix("회사 · ") } == true, "folder name: \(byFolder)")
            let byWord = Search.find("시안", items: [], memos: [filed], history: [], events: [], now: now, calendar: seoul, memoFolders: ["F1": "회사"])
            try expect(byWord.first?.hits.first?.detail.hasPrefix("회사 · ") == true, "folder named")
            let groupTitles: [String] = AppLanguage.allCases.map { language in Search.Group.allCases.map { $0.title(language) }.joined(separator: " · ") }
            try expect(groupTitles == ["오늘 · 앞으로 · 메모 · 완료 기록 · 일정", "Today · Ahead · Notes · History · Events", "Vandaag · Vooruit · Notities · Geschiedenis · Afspraken"], "titles")
        }

        try test("입력 줄: Korean relative times (T1–T11)") {
            let cases: [(String, AppLanguage, Date, String, String, String)] = [
                ("T1", .ko, now, "30분 뒤 빨래 꺼내기", "빨래 꺼내기", "2026-10-08 15:20"),
                ("T2", .ko, now, "2시간 뒤 회의 준비", "회의 준비", "2026-10-08 16:50"),
                ("T3", .ko, now, "1시간 30분 후 약 먹기", "약 먹기", "2026-10-08 16:20"),
                ("T4", .ko, now, "1시간 반 뒤 산책", "산책", "2026-10-08 16:20"),
                ("T5", .ko, now, "빨래 꺼내기 10분 후", "빨래 꺼내기", "2026-10-08 15:00"),
                ("T6", .ko, now, "30분뒤 물 마시기", "물 마시기", "2026-10-08 15:20"),
                ("T7", .en, now, "take out laundry in 2 hours", "take out laundry", "2026-10-08 16:50"),
                ("T8", .nl, now, "over een kwartier was ophalen", "was ophalen", "2026-10-08 15:05"),
                ("T9", .ko, at(8, 23, 50), "30분 뒤 불 끄기", "불 끄기", "2026-10-09 00:20"),
                ("T10", .ko, now, "3분기 보고서", "3분기 보고서", "-"),
                ("T11", .en, now, "30분 뒤 빨래", "빨래", "2026-10-08 15:20"),
            ]
            for (name, language, when, text, title, reminder) in cases {
                let parsed = QuickParse.parse(text, now: when, calendar: seoul, language: language)
                try expect(parsed.title == title && show(parsed.reminderAt) == reminder, "\(name): \(parsed.title) \(show(parsed.reminderAt))")
            }
        }

        try test("하루 띠: a click on the track becomes a start rounded to 15 minutes") {
            func slot(_ fraction: Double, _ start: Int = 8, _ end: Int = 24, now: Date = now) -> String {
                let s = DayRibbon.slot(at: fraction, startHour: start, endHour: end, now: now, calendar: seoul)
                return String(format: "%@ %02d:%02d", s.date, s.minutes / 60, s.minutes % 60)
            }
            try expect(slot(0.5) == "2026-10-08 16:00", slot(0.5))
            try expect(slot(0.51) == "2026-10-08 16:15", slot(0.51))
            try expect(slot(0) == "2026-10-08 08:00" && slot(1) == "2026-10-08 23:00", "ends")
            try expect(slot(0.95, 8, 28) == "2026-10-09 03:00", slot(0.95, 8, 28))
            try expect(slot(0.5, now: at(9, 1)) == "2026-10-08 16:00", "after midnight it's still the 8th's ribbon")
        }

        try test("오늘 꼭 하나: first in 다음 (besides the three by time); done or gone, it's the usual split; login ask") {
            let a = task("A"), b = task("B", reminder: at(8, 16)), c = task("C"), d = task("D", done: true)
            let plain = TodayGroups.split([a, b, c, d], series: [], now: now, calendar: seoul)
            try expect(plain.next == [b.id] && plain.rest == [a.id, c.id, d.id], "plain")
            let picked = TodayGroups.split([a, b, c, d], series: [], now: now, first: c.id, calendar: seoul)
            try expect(picked.next == [c.id, b.id] && picked.rest == [a.id, d.id] && picked.showsHeaders, "picked")
            let pickedTimed = TodayGroups.split([a, b, c], series: [], now: now, first: b.id, calendar: seoul)
            try expect(pickedTimed.next == [b.id] && pickedTimed.times[b.id] != nil, "picked timed")
            let pickedDone = TodayGroups.split([a, b, d], series: [], now: now, first: d.id, calendar: seoul)
            try expect(pickedDone.next == [b.id], "done pick ignored")
            try expect(!LoginAsk.shouldAsk(manualStarts: 2, loginItemOn: false, asked: false) && LoginAsk.shouldAsk(manualStarts: 3, loginItemOn: false, asked: false)
                       && !LoginAsk.shouldAsk(manualStarts: 5, loginItemOn: true, asked: false) && !LoginAsk.shouldAsk(manualStarts: 5, loginItemOn: false, asked: true), "login")
        }

        print("\(count) convenience checks passed.")
    }
}
