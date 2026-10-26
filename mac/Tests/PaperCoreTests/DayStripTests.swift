import Foundation

// 하루 띠 · 하루 일정표 (DayStrip.swift, 1.40): the shared cases with the Windows app (test/dayStrip.test.ts),
// listed in ribbon-cases.md. Framework-free like the other core tests.
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
private enum DayStripTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        var seoul = Calendar(identifier: .gregorian)
        seoul.timeZone = TimeZone(identifier: "Asia/Seoul")!
        func at(_ hour: Int, _ minute: Int = 0, _ second: Int = 0, day: Int = 8) -> Date {
            seoul.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute, second: second))!
        }
        func event(_ title: String, _ from: (Int, Int), _ to: (Int, Int), location: String? = nil) -> CalendarEvent {
            CalendarEvent(key: "local/\(title)@2026-10-08", calendarId: "local", title: title, allDay: false, start: at(from.0, from.1),
                          end: at(to.0, to.1), location: location, color: "#5b8bd0")
        }
        func task(_ title: String, _ start: String? = nil, _ end: String? = nil, done: Bool = false, reminder: Date? = nil, due: String? = nil) -> TodoItem {
            var item = TodoItem(title: title, isCompleted: done, createdAt: at(8), reminderAt: reminder)
            item.timeStart = start
            item.timeEnd = end
            item.dueDate = due
            return item
        }
        // The day of the mock (Thu 2026-10-08): R1–R4 below.
        let day: [CalendarEvent] = [event("아침 스터디", (9, 0), (10, 0)), event("팀 회의", (13, 0), (14, 0), location: "3층 회의실"),
                                    event("치과", (15, 30), (16, 30)), event("요가", (19, 0), (20, 0))]
        let tasks: [TodoItem] = [task("보고서 마무리", "14:00", "15:30"), task("물 마시기", reminder: at(16)), task("장보기", "17:00")]
        func state(_ now: Date, rows: Int = 2, events: [CalendarEvent] = day, tasks: [TodoItem] = tasks) -> DayStrip.State {
            DayStrip.state(DayStrip.items(events: events, tasks: tasks, now: now, calendar: seoul), now: now, rows: rows)
        }
        func titles(_ items: [DayStrip.Item]) -> [String] { items.map(\.title) }
        let languages = AppLanguage.allCases

        // MARK: Now and next

        try test("R1 something on now") {
            let s = state(at(13, 20))
            try equal(s.mode, .now, "mode"); try equal(s.lead?.title, "팀 회의", "lead")
            try equal(s.minutes, 40, "minutes left"); try expect(abs(s.progress - 1.0 / 3) < 0.0001, "progress \(s.progress)")
            try equal(titles(s.rows), ["보고서 마무리", "치과"], "rows")
            try equal(languages.map { DayStrip.ringText(minutes: s.minutes, mode: s.mode, language: $0).value }, ["40", "40", "40"], "ring value")
            try equal(languages.map { DayStrip.ringText(minutes: s.minutes, mode: s.mode, language: $0).caption }, ["분 남음", "min left", "min over"], "ring caption")
            try equal(languages.map { DayStrip.kicker(mode: s.mode, item: s.lead!, language: $0, calendar: seoul) },
                      ["지금 · 13:00–14:00", "Now · 1:00–2:00 PM", "Nu · 13:00–14:00"], "kicker")
            try equal(languages.map { DayStrip.kicker(mode: s.mode, item: s.lead!, language: $0, short: true, calendar: seoul) },
                      ["지금 · ~14:00", "Now · until 2:00 PM", "Nu · tot 14:00"], "short kicker")
            try equal(s.rows.map { DayStrip.awayText(DayStrip.minutes(from: at(13, 20), to: $0.start), language: .ko) }, ["40분 뒤", "2시간 뒤"], "row when")
            try equal(s.rows.map { DayStrip.isSoon(DayStrip.minutes(from: at(13, 20), to: $0.start)) }, [true, false], "row soon")
            try equal(languages.map { DayStrip.sentence(s, language: $0, calendar: seoul) },
                      ["지금 팀 회의, 40분 남음. 다음 14:00 보고서 마무리, 15:30 치과",
                       "Now 팀 회의, 40 min left. Next 2:00 PM 보고서 마무리, 3:30 PM 치과",
                       "Nu 팀 회의, nog 40 min. Volgende 14:00 보고서 마무리, 15:30 치과"], "sentence")
        }
        try test("R2 three rows: a reminder counts as an item") {
            let s = state(at(13, 20), rows: 3)
            try equal(titles(s.rows), ["보고서 마무리", "치과", "물 마시기"], "rows")
            try equal(s.rows.map(\.kind), [.task, .event, .reminder], "kinds")
            try equal(state(at(13, 20), rows: 1).rows.map(\.title), ["보고서 마무리"], "one row")
        }
        try test("R3 nothing on, the next soon") {
            let s = state(at(12, 40))
            try equal(s.mode, .next, "mode"); try equal(s.lead?.title, "팀 회의", "lead")
            try equal(s.minutes, 20, "minutes away"); try expect(abs(s.progress - 40.0 / 60) < 0.0001, "progress \(s.progress)")
            try equal(titles(s.rows), ["보고서 마무리", "치과"], "rows start after the lead")
            try equal(languages.map { DayStrip.ringText(minutes: 20, mode: .next, language: $0).caption }, ["분 뒤", "min away", "min te gaan"], "caption")
            try equal(DayStrip.isSoon(s.minutes), true, "clay")
            try equal(languages.map { DayStrip.kicker(mode: s.mode, item: s.lead!, language: $0, calendar: seoul) },
                      ["다음 · 13:00–14:00", "Next · 1:00–2:00 PM", "Volgende · 13:00–14:00"], "kicker")
            try equal(languages.map { DayStrip.sentence(s, language: $0, calendar: seoul) },
                      ["다음 13:00 팀 회의, 20분 뒤. 그다음 14:00 보고서 마무리, 15:30 치과",
                       "Next 1:00 PM 팀 회의, in 20 min. Then 2:00 PM 보고서 마무리, 3:30 PM 치과",
                       "Volgende 13:00 팀 회의, over 20 min. Daarna 14:00 보고서 마무리, 15:30 치과"], "sentence")
        }
        try test("R4 nothing on, the next far; nothing left") {
            var s = state(at(10, 30))
            try equal(s.mode, .next, "mode"); try equal(s.minutes, 150, "minutes"); try equal(s.progress, 0, "no arc over an hour away")
            try equal(DayStrip.isSoon(s.minutes), false, "ink2")
            try equal(languages.map { DayStrip.ringText(minutes: 150, mode: .next, language: $0).value }, ["2:30", "2:30", "2:30"], "value")
            try equal(languages.map { DayStrip.ringText(minutes: 150, mode: .next, language: $0).caption }, ["뒤", "away", "te gaan"], "caption")
            s = state(at(20, 30))
            try equal(s.mode, .nothing, "nothing left"); try equal(s.lead == nil && s.rows.isEmpty, true, "empty")
            try equal(languages.map { DayStrip.sentence(s, language: $0, calendar: seoul) }, ["오늘 남은 일정이 없어요", "Nothing else today", "Verder niets vandaag"], "sentence")
        }
        try test("R5 the latest start is current; an event first at the same start") {
            var s = state(at(13, 40), events: [event("A", (13, 0), (15, 0))], tasks: [task("B", "13:30", "14:00")])
            try equal(s.lead?.title, "B", "latest start"); try equal(s.minutes, 20, "B's time left")
            try equal(s.rows.isEmpty, true, "A has started: not a row")
            s = state(at(13, 10), events: [event("E", (13, 0), (14, 0))], tasks: [task("T", "13:00", "13:30")])
            try equal(s.lead?.title, "E", "event first at the same start")
            s = state(at(13, 10), events: [event("long", (13, 0), (15, 0)), event("short", (13, 0), (13, 30))], tasks: [])
            try equal(s.lead?.title, "short", "then the one ending first")
        }
        try test("R6 done to-dos are never current or next") {
            let s = state(at(14, 10), events: [event("치과", (15, 30), (16, 30))], tasks: [task("보고서", "14:00", "15:30", done: true)])
            try equal(s.mode, .next, "nothing on"); try equal(s.lead?.title, "치과", "next")
            let items = DayStrip.items(events: [], tasks: [task("보고서", "14:00", "15:30", done: true), task("끝난 알림", done: true, reminder: at(16))], now: at(9), calendar: seoul)
            try equal(items.map(\.kind), [.task], "a done to-do's time stays (drawn faded); its reminder doesn't")
        }
        try test("R7 same minute: event, to-do, reminder") {
            let s = state(at(13), rows: 3, events: [event("E", (14, 0), (15, 0))],
                          tasks: [task("R", reminder: at(14)), task("T", "14:00", "14:30")])
            try equal(s.mode, .next, "mode"); try equal(s.lead?.title, "E", "lead"); try equal(titles(s.rows), ["T", "R"], "rows")
        }
        try test("R8 a start alone lasts 30 minutes; a to-do with a time is one item") {
            var s = state(at(17, 10), events: [], tasks: [task("장보기", "17:00")])
            try equal(s.mode, .now, "current"); try equal(s.minutes, 20, "until 17:30")
            try equal(DayStrip.kicker(mode: .now, item: s.lead!, language: .ko, calendar: seoul), "지금 · 17:00–17:30", "drawn end")
            let both = task("보고서", "14:00", "15:30", reminder: at(13))
            let items = DayStrip.items(events: [], tasks: [both], now: at(9), calendar: seoul)
            try equal(items.map(\.kind), [.task], "no second item for its reminder"); try equal(items[0].hasReminder, true, "bell")
            s = state(at(9), events: [], tasks: [both])
            try equal(s.lead?.title, "보고서", "next by the block's start"); try equal(s.minutes, 300, "14:00")
        }
        try test("R9 what isn't today") {
            let items = DayStrip.items(events: [CalendarEvent(key: "b", calendarId: "local", title: "생일", allDay: true, start: at(0), end: at(0, day: 9), color: "#d4a72c")],
                                       tasks: [task("내일", "10:00", "11:00", due: "2026-10-09"), task("어제 알림", reminder: at(10, day: 7)),
                                               { var t = task("언젠가", "10:00", "11:00"); t.shelf = .later; return t }()],
                                       now: at(9), calendar: seoul)
            try equal(items.isEmpty, true, "all-day, another day's time, yesterday's reminder, an undated 언젠가 range: none")
        }
        try test("R10 an hour or more") {
            let s = state(at(12, 40), events: [event("긴 회의", (12, 0), (14, 0))], tasks: [])
            try equal(s.minutes, 80, "80")
            try equal(languages.map { DayStrip.ringText(minutes: 80, mode: .now, language: $0).value }, ["1:20", "1:20", "1:20"], "value")
            try equal(languages.map { DayStrip.ringText(minutes: 80, mode: .now, language: $0).caption }, ["남음", "left", "over"], "caption")
            try equal(languages.map { DayStrip.ringText(minutes: 60, mode: .now, language: $0).value }, ["1:00", "1:00", "1:00"], "60")
            try equal(languages.map { DayStrip.ringText(minutes: 59, mode: .now, language: $0).value }, ["59", "59", "59"], "59")
            try equal(languages.map { DayStrip.leftText(80, language: $0) }, ["1시간 20분 남음", "1 h 20 min left", "nog 1 u 20 min"], "said")
            try equal(languages.map { DayStrip.leftText(60, language: $0) }, ["1시간 남음", "1 h left", "nog 1 u"], "said 60")
            try equal(languages.map { DayStrip.leftText(5, language: $0) }, ["5분 남음", "5 min left", "nog 5 min"], "said 5")
        }
        try test("R11 a row's when") {
            let cases: [(Int, [String])] = [
                (1, ["1분 뒤", "in 1 min", "over 1 min"]), (40, ["40분 뒤", "in 40 min", "over 40 min"]),
                (60, ["1시간 뒤", "in 1 h", "over 1 u"]), (65, ["1시간 5분 뒤", "in 1 h 5 min", "over 1 u 5 min"]),
                (119, ["1시간 59분 뒤", "in 1 h 59 min", "over 1 u 59 min"]), (120, ["2시간 뒤", "in 2 h", "over 2 u"]),
                (130, ["2시간 뒤", "in 2 h", "over 2 u"]), (149, ["2시간 뒤", "in 2 h", "over 2 u"]), (150, ["3시간 뒤", "in 3 h", "over 3 u"]),
                (400, ["7시간 뒤", "in 7 h", "over 7 u"]),
            ]
            for (minutes, expected) in cases {
                try equal(languages.map { DayStrip.awayText(minutes, language: $0) }, expected, "\(minutes)")
            }
            try equal([1, 60, 61].map(DayStrip.isSoon), [true, true, false], "soon within the hour")
        }
        try test("R12 rounding up, rows by size, the link") {
            try equal(DayStrip.minutes(from: at(13, 20, 30), to: at(14)), 40, "13:20:30")
            try equal(DayStrip.minutes(from: at(13, 59, 1), to: at(14)), 1, "13:59:01")
            try equal(DayStrip.minutes(from: at(14), to: at(14)), 1, "at least 1")
            let sizes: [(Double, Double, Int)] = [(350, 560, 1), (400, 800, 1), (420, 560, 2), (420, 719, 2), (420, 720, 3), (720, 1200, 3)]
            for (w, h, rows) in sizes { try equal(DayStrip.rowLimit(width: w, height: h), rows, "\(w)×\(h)") }
            try equal(languages.map { DayStrip.wholeDayLink(narrow: false, language: $0) }, ["하루 전체 ›", "Whole day ›", "Hele dag ›"], "wide")
            try equal(languages.map { DayStrip.wholeDayLink(narrow: true, language: $0) }, ["전체 ›", "Day ›", "Dag ›"], "narrow")
        }
        try test("R13 a reminder as the lead") {
            let s = state(at(15, 50), events: [], tasks: [task("물 마시기", reminder: at(16))])
            try equal(s.mode, .next, "mode"); try equal(s.minutes, 10, "10")
            try equal(languages.map { DayStrip.kicker(mode: s.mode, item: s.lead!, language: $0, calendar: seoul) },
                      ["다음 · 16:00", "Next · 4:00 PM", "Volgende · 16:00"], "its time alone")
            try equal(DayStrip.kicker(mode: s.mode, item: s.lead!, language: .ko, short: true, calendar: seoul), "다음 · 16:00", "short")
        }
        try test("R14 past midnight") {
            let late = event("야간 상영", (23, 0), (1, 0))
            var shifted = late
            shifted.end = at(1, day: 9)
            let s = state(at(0, 30, day: 9), events: [shifted], tasks: [task("정리", "23:30", "01:30")])
            try equal(s.mode, .now, "on at 00:30"); try equal(s.lead?.title, "정리", "latest start"); try equal(s.minutes, 60, "until 01:30")
        }

        // MARK: The whole day

        func placed(_ spans: [DayStrip.Span]) -> [String] {
            DayStrip.columns(spans).placed.sorted { $0.id < $1.id }.map { "\($0.id)\($0.column)/\($0.columns)\($0.hidden ? "h" : "")" }
        }
        func span(_ id: String, _ from: String, _ to: String, _ kind: DayStrip.Kind = .event, order: Int = 0) -> DayStrip.Span {
            DayStrip.Span(id: id, kind: kind, start: TimeBlock.minutes(from)!, end: TimeBlock.minutes(to)!, order: order)
        }
        try test("K1–K6 columns") {
            try equal(placed([span("A", "13:00", "14:00"), span("B", "14:00", "15:30")]), ["A0/1", "B0/1"], "K1 touching")
            try equal(placed([span("T", "14:00", "15:30", .task), span("R", "14:30", "15:00", .reminder)]), ["R1/2", "T0/2"], "K2 the mock")
            try equal(placed([span("A", "10:00", "12:00"), span("B", "11:00", "13:00"), span("C", "11:30", "12:30"), span("D", "12:00", "12:30")]),
                      ["A0/3", "B1/3", "C2/3", "D0/3"], "K3")
            let crowd = [span("A", "09:00", "11:00"), span("B", "09:30", "11:00"), span("C", "10:00", "11:00"), span("D", "10:15", "10:45"), span("E", "10:30", "11:00")]
            try equal(placed(crowd), ["A0/3", "B1/3", "C2/3", "D3/3h", "E4/3h"], "K4 four and more")
            try equal(DayStrip.columns(crowd).more, [DayStrip.More(ids: ["D", "E"], start: 615, group: 0)], "K4 +2 at 10:15")
            try equal(placed([span("A", "09:00", "10:00"), span("B", "09:00", "11:00")]), ["A1/2", "B0/2"], "K5 the longer first")
            try equal(placed([span("A", "09:00", "10:00"), span("B", "09:30", "10:30"), span("C", "11:00", "12:00")]), ["A0/2", "B1/2", "C0/1"], "K6 groups")
            try equal(placed([span("E", "14:00", "15:00"), span("T", "14:00", "15:00", .task)]), ["E0/2", "T1/2"], "K7 same span: the event first")
        }
        try test("K8 spans from items") {
            let items = DayStrip.items(events: [event("치과", (15, 30), (16, 30))], tasks: [task("물", reminder: at(14, 30)), task("장보기", "17:00")], now: at(9), calendar: seoul)
            try equal(DayStrip.spans(items, now: at(9), calendar: seoul).map { "\($0.start)-\($0.end)" }, ["930-990", "870-900", "1020-1050"], "minutes")
            let late = DayStrip.items(events: [], tasks: [task("정리", "23:30", "01:30")], now: at(9), calendar: seoul)
            try equal(DayStrip.spans(late, now: at(9), calendar: seoul).map { "\($0.start)-\($0.end)" }, ["1410-1530"], "logical minutes")
        }
        try test("G1–G4 slot, scroll, drag, nudge") {
            let slots: [(Double, Int)] = [(0, 480), (49, 525), (50, 540), (-10, 480), (312.5, 855), (800, 1380), (2000, 1380)]
            for (y, minutes) in slots { try equal(DayStrip.slot(y: y, startHour: 8, endHour: 24), minutes, "slot \(y)") }
            try equal(DayStrip.scrollTop(now: at(13, 20), startHour: 8, calendar: seoul), 200, "scroll 13:20 → 12:00 at the top")
            try equal(DayStrip.scrollTop(now: at(13, 0), startHour: 8, calendar: seoul), 200, "scroll 13:00 → 12:00")
            try equal(DayStrip.scrollTop(now: at(12, 59), startHour: 8, calendar: seoul), 150, "scroll 12:59 → 11:00")
            try equal(DayStrip.scrollTop(now: at(9, 10), startHour: 8, calendar: seoul), 0, "scroll 09:10 → 08:00")
            try equal(DayStrip.scrollTop(now: at(8, 30), startHour: 8, calendar: seoul), 0, "scroll 08:30")
            try equal(DayStrip.scrollTop(now: at(0, 30, day: 9), startHour: 8, calendar: seoul), 750, "00:30 → 23:00 at the top")
            try equal(DayStrip.columns([span("A", "09:00", "10:00"), span("B", "11:00", "12:00")]).placed.map(\.group), [0, 1], "groups")
            let drags: [(TimeBlock.Edge, Double, Int, Int)] = [(.whole, 30, 870, 960), (.whole, 20, 870, 960), (.whole, 10, 855, 945), (.whole, 6, 840, 930),
                                                                 (.end, -50, 840, 870), (.end, -100, 840, 855), (.whole, -1000, 480, 570), (.whole, 1000, 1350, 1440)]
            for (edge, points, start, end) in drags {
                let moved = DayStrip.dragged(start: 840, end: 930, edge: edge, points: points, startHour: 8, endHour: 24)
                try equal("\(moved.start)-\(moved.end)", "\(start)-\(end)", "drag \(edge) \(points)")
            }
            try equal("\(DayStrip.nudged(start: 840, end: 930, by: 1, startHour: 8, endHour: 24))", "(start: 855, end: 945)", "⌥↓")
            try equal("\(DayStrip.nudged(start: 840, end: 930, by: -1, startHour: 8, endHour: 24))", "(start: 825, end: 915)", "⌥↑")
            try equal("\(DayStrip.nudged(start: 480, end: 540, by: -1, startHour: 8, endHour: 24))", "(start: 480, end: 540)", "not before the day")
            // W1 (Windows' row): the night's last hour moved up on an 8–28 day keeps a 04:00 end as 1680, never 240.
            let night = DayStrip.dragged(start: 1620, end: 1680, edge: .whole, points: -50, startHour: 8, endHour: 28)
            try equal("\(night.start)-\(night.end)", "1560-1620", "W1")
            // W2: an end at 04:00 isn't kept on the to-do (not after the start in logical minutes), drawn to 04:00 all the same.
            var item = TodoItem(title: "정리", createdAt: at(9))
            item.timeRange = TimeRange(start: 1650, end: 1680)
            try equal(item.timeStart, "03:30", "W2 start"); try equal(item.timeRange?.end, nil, "W2 end dropped")
            try equal(item.timeRange?.drawnEnd, 1680, "W2 drawn to 04:00")
        }

        try test("R1–R8 stretching and following (1.41)") {
            // R1 the bands: none under 20 pt, then 5, then 6.
            for (height, band) in [(18.0, 0.0), (19.5, 0.0), (20.0, 5.0), (22.0, 6.0), (48.0, 6.0), (300.0, 6.0)] {
                try equal(DayStrip.stretchBand(height: height), band, "R1 band at \(height)")
            }
            let day = DayStrip.stretchBounds(startHour: 8, endHour: 24, kind: .event)
            try equal(day, 480...1440, "R6 an event's bounds")
            try equal(DayStrip.stretchBounds(startHour: 8, endHour: 24, kind: .task), 480...1440, "R6 a to-do's (the day ends before 04:00)")
            try equal(DayStrip.stretchBounds(startHour: 8, endHour: 28, kind: .task), 480...1665, "R6 a to-do's end stops at 03:45 (W2)")
            try equal(DayStrip.stretchBounds(startHour: 8, endHour: 28, kind: .event), 480...1680, "R6 an event's runs to 04:00")
            // R2 following the pointer: exact (fractions of minutes), kept inside the day, an edge 15 minutes from the other.
            func follow(_ edge: TimeBlock.Edge, _ points: Double, _ start: Int = 840, _ end: Int = 930) -> String {
                let f = DayStrip.following(start: start, end: end, edge: edge, points: points, bounds: day)
                return "\(f.start)-\(f.end)"
            }
            try equal(follow(.whole, 10), "852.0-942.0", "R2 whole follows exactly")
            try equal(follow(.whole, 3.5), "844.2-934.2", "R2 a fraction of a step")
            try equal(follow(.whole, -1000), "480.0-570.0", "R2 not before the day")
            try equal(follow(.whole, 1000), "1350.0-1440.0", "R2 not after it")
            try equal(follow(.start, -20), "816.0-930.0", "R2 top")
            try equal(follow(.start, 200), "915.0-930.0", "R2 top stops 15 before the end")
            try equal(follow(.end, 7), "840.0-938.4", "R2 bottom")
            try equal(follow(.end, -200), "840.0-855.0", "R2 bottom stops 15 after the start")
            try equal(follow(.start, 5, 850, 860), "850.0-860.0", "R2 a block under 15 minutes doesn't shrink")
            // R3 where a stretched edge lands: the nearest quarter hour.
            func stretch(_ edge: TimeBlock.Edge, _ points: Double, _ start: Int = 840, _ end: Int = 930, bounds: ClosedRange<Int> = day) -> String {
                let r = DayStrip.resized(start: start, end: end, edge: edge, points: points, bounds: bounds)
                return "\(r.start)-\(r.end)"
            }
            try equal(stretch(.end, 30), "840-960", "R3 bottom +36 min → 16:00")
            try equal(stretch(.end, 20), "840-960", "R3 bottom +24 min → nearest 16:00")
            try equal(stretch(.end, 6), "840-930", "R3 less than half a step: unchanged")
            try equal(stretch(.start, -25), "810-930", "R3 top −30 min")
            try equal(stretch(.start, 200), "915-930", "R3 at least 15 minutes")
            try equal(stretch(.end, -200), "840-855", "R3 the bottom can't cross the top")
            try equal(stretch(.start, -1000), "480-930", "R3 not before the day")
            try equal(stretch(.end, 1000), "840-1440", "R3 not after it")
            try equal(stretch(.end, 0), "840-930", "R3 no move, no change")
            // R4 an edge off the quarter hours lands on one once it moves half a step.
            try equal(stretch(.end, 3, 850, 900), "850-900", "R4 14:10–15:00, a nudge: unchanged")
            try equal(stretch(.end, 10, 850, 900), "850-915", "R4 bottom → 15:15")
            try equal(stretch(.start, -10, 850, 900), "840-900", "R4 top → 14:00")
            // R5 a start alone (drawn 30 minutes) stretched gets the end it was drawn with.
            try equal(TimeBlock.resized(TimeRange(start: 840), edge: .start, by: -15, bounds: day), TimeRange(start: 825, end: 870), "R5 top")
            try equal(TimeBlock.resized(TimeRange(start: 840), edge: .end, by: 30, bounds: day), TimeRange(start: 840, end: 900), "R5 bottom")
            try equal(TimeBlock.resized(TimeRange(start: 840), edge: .end, by: 0, bounds: day), TimeRange(start: 840, end: 870), "R5 an explicit end even unmoved")
            // R6 a to-do's end at 03:45 at the latest on a day to 04:00.
            let night = DayStrip.stretchBounds(startHour: 8, endHour: 28, kind: .task)
            try equal(stretch(.end, 200, 1560, 1620, bounds: night), "1560-1665", "R6 to 03:45")
            // R7 ⇧⌥↓ / ⇧⌥↑: the end 15 minutes later or earlier.
            try equal("\(DayStrip.stretched(start: 840, end: 930, by: 1, bounds: day))", "(start: 840, end: 945)", "R7 ⇧⌥↓")
            try equal("\(DayStrip.stretched(start: 840, end: 930, by: -1, bounds: day))", "(start: 840, end: 915)", "R7 ⇧⌥↑")
            try equal("\(DayStrip.stretched(start: 840, end: 855, by: -1, bounds: day))", "(start: 840, end: 855)", "R7 not under 15 minutes")
            try equal("\(DayStrip.stretched(start: 1380, end: 1440, by: 1, bounds: day))", "(start: 1380, end: 1440)", "R7 not past the day")
            // W3 (Windows' row, adopted): a to-do moved whole stays inside the same bounds; an event runs to 04:00.
            let moved = DayStrip.dragged(start: 1560, end: 1620, edge: .whole, points: 100, bounds: night)
            try equal("\(moved.start)-\(moved.end)", "1605-1665", "W3 to-do moved whole")
            let event = DayStrip.dragged(start: 1560, end: 1620, edge: .whole, points: 100, bounds: DayStrip.stretchBounds(startHour: 8, endHour: 28, kind: .event))
            try equal("\(event.start)-\(event.end)", "1620-1680", "W3 an event")
            // R8 the ghost while moving is `dragged` (G rows): the follow and the landing agree on whole steps.
            for points in stride(from: -62.5, through: 62.5, by: 12.5) {
                let f = DayStrip.following(start: 840, end: 930, edge: .whole, points: points, bounds: day)
                let d = DayStrip.dragged(start: 840, end: 930, edge: .whole, points: points, startHour: 8, endHour: 24)
                try equal("\(Int(f.start))-\(Int(f.end))", "\(d.start)-\(d.end)", "R8 at \(points) pt")
            }
        }

        try test("N1–N5 a new item from the timetable") {
            let base = at(13, 20), calendar = seoul
            func describe(_ candidates: [Intent.Candidate]) -> [String] {
                candidates.map { candidate in
                    switch candidate {
                    case .todo(let p):
                        let range = p.range.map { " \(TimeBlock.text($0.start % 1440))–\(TimeBlock.text(($0.end ?? 0) % 1440))" } ?? ""
                        let reminder = p.reminderAt.map { " reminder \(DayStrip.clockText($0, language: .ko, calendar: calendar))" } ?? ""
                        return "todo \(p.title)\(range)\(reminder)"
                    case .event(let e): return "event \(e.title) \(e.date) \(TimeBlock.text(e.start))–\(TimeBlock.text(e.end))"
                    default: return "\(candidate.kind)"
                    }
                }
            }
            func new(_ title: String, _ minutes: Int, kind: Intent.Kind? = nil, language: AppLanguage = .ko) -> [String] {
                describe(DayStrip.newCandidates(title: title, at: minutes, kind: kind, now: base, language: language, calendar: calendar))
            }
            try equal(new("보고서", 840), ["todo 보고서 14:00–15:00 reminder 14:00", "event 보고서 2026-10-08 14:00–15:00"], "N1")
            try equal(new("팀 회의", 840), ["event 팀 회의 2026-10-08 14:00–15:00", "todo 팀 회의 14:00–15:00 reminder 14:00"], "N2 event word")
            try equal(new("dentist", 840, language: .en).first?.hasPrefix("event") ?? false, true, "N2 en")
            try equal(new("팀 회의", 840, kind: .todo).first?.hasPrefix("todo") ?? false, true, "N3 the chip decides")
            try equal(new("보고서", 840, kind: .event).first?.hasPrefix("event") ?? false, true, "N3 event chip")
            try equal(new("정리", 1410), ["todo 정리 23:30–00:30 reminder 23:30", "event 정리 2026-10-08 23:30–00:30"], "N4 past midnight")
            try equal(new("정리", 1650), ["todo 정리 03:30–04:00 reminder 03:30", "event 정리 2026-10-09 03:30–04:00"], "N4 not past 04:00")
            try equal(new("보고서", 780), ["todo 보고서 13:00–14:00", "event 보고서 2026-10-08 13:00–14:00"], "N5 started: no reminder")
        }

        print("\(count) day strip tests passed")
    }
}
