import Foundation

// 시계 알람 (Alarm.swift): the same cases as the Windows app (test/alarm.test.ts). Local times in
// October 2026 (4 Sun · 5 Mon · 8 Thu · 9 Fri · 10 Sat · 11 Sun · 12 Mon), so any time zone gives
// the same answers. Framework-free like the other core tests.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

@main
private enum AlarmTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        let langs = AppLanguage.allCases
        let calendar = Calendar.paper
        func at(_ day: Int, _ hour: Int, _ minute: Int = 0, _ second: Int = 0, month: Int = 10) -> Date {
            calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute, second: second))!
        }
        let september = ISO8601DateFormatter().date(from: "2026-09-01T00:00:00Z")!
        func alarm(_ time: String, _ days: [Int], id: String = "A1", enabled: Bool = true, updatedAt: Date? = nil) -> Alarm {
            Alarm(id: id, time: time, days: days, enabled: enabled, createdAt: september, updatedAt: updatedAt ?? september)
        }
        let weekdays = [1, 2, 3, 4, 5]

        try test("nextFire: once, daily and weekdays, across midnight and the week end") {
            let once = alarm("07:00", [])
            try expect(Alarm.nextFire(once, now: at(8, 6, 30)) == at(8, 7), "once: today while still ahead")
            try expect(Alarm.nextFire(once, now: at(8, 7)) == at(8, 7), "at its very minute it is still today")
            try expect(Alarm.nextFire(once, now: at(8, 7, 0, 1)) == at(9, 7), "once: else tomorrow")
            try expect(Alarm.nextFire(once, now: at(8, 23, 30)) == at(9, 7), "across midnight")
            let daily = alarm("00:15", [0, 1, 2, 3, 4, 5, 6])
            try expect(Alarm.nextFire(daily, now: at(8, 23, 50)) == at(9, 0, 15), "daily across midnight")
            try expect(Alarm.nextFire(daily, now: at(9, 0, 10)) == at(9, 0, 15), "daily just before")
            let work = alarm("07:30", weekdays)
            try expect(Alarm.nextFire(work, now: at(8, 8)) == at(9, 7, 30), "Thursday after the time: Friday")
            try expect(Alarm.nextFire(work, now: at(9, 8)) == at(12, 7, 30), "Friday after the time: Monday")
            try expect(Alarm.nextFire(work, now: at(10, 6)) == at(12, 7, 30), "Saturday morning: Monday")
            try expect(Alarm.nextFire(alarm("09:00", [0, 6]), now: at(9, 9, 1)) == at(10, 9), "weekends from Friday")
            try expect(Alarm.nextFire(alarm("09:00", [4]), now: at(8, 9, 1)) == at(15, 9), "the same weekday a week on")
            try expect(Alarm.nextFire(alarm("07:00", []), now: at(30, 22, month: 9)) == at(1, 7), "across a month end")
            try expect(Alarm.nextFire(alarm("07:00", weekdays, enabled: false), now: at(8, 6)) == nil, "off: never")
            let handled: Set<String> = [Alarm.key(once, at(8, 7))]
            try expect(Alarm.nextFire(once, now: at(8, 7), handled: handled) == at(9, 7), "a ring at this very minute already handled: the next one")
        }

        try test("due: within 15 minutes of the time, once per ring, not before the alarm was set") {
            let work = alarm("07:30", weekdays)
            try expect(Alarm.due([work], now: at(8, 7, 29), handled: []).isEmpty, "not yet")
            try expect(Alarm.due([work], now: at(8, 7, 30), handled: []).map(\.id) == ["A1"], "on the minute")
            try expect(Alarm.due([work], now: at(8, 7, 44, 59), handled: []).map(\.id) == ["A1"], "late but within 15 minutes")
            try expect(Alarm.due([work], now: at(8, 7, 45), handled: []).isEmpty, "15 minutes late: skipped")
            try expect(Alarm.due([work], now: at(10, 7, 31), handled: []).isEmpty, "not on Saturday")
            try expect(Alarm.due([work], now: at(8, 7, 31), handled: [Alarm.key(work, at(8, 7, 30))]).isEmpty, "handled here already")
            try expect(Alarm.due([work], now: at(9, 7, 31), handled: [Alarm.key(work, at(8, 7, 30))]).count == 1, "yesterday's key doesn't cover today")
            try expect(Alarm.due([alarm("07:30", weekdays, enabled: false)], now: at(8, 7, 31), handled: []).isEmpty, "off")
            let once = alarm("23:55", [])
            try expect(Alarm.due([once], now: at(9, 0, 5), handled: []).count == 1, "once, across midnight")
            try expect(Alarm.key(once, Alarm.lastFire(once, now: at(9, 0, 5))!) == "A1@2026-10-08T23:55", "its key")
            let setLate = alarm("07:00", [], updatedAt: at(8, 7, 5))
            try expect(Alarm.due([setLate], now: at(8, 7, 6), handled: []).isEmpty, "set at 7:05 for 7:00: waits for tomorrow")
            try expect(Alarm.nextFire(setLate, now: at(8, 7, 6)) == at(9, 7), "and rings tomorrow")
        }

        try test("the handled keys and the next alarm") {
            try expect(Alarm.key(alarm("07:05", []), at(8, 7, 5)) == "A1@2026-10-08T07:05", "key")
            let keys: Set<String> = ["A1@2026-10-04T07:00", "A1@2026-10-05T07:00", "A1@2026-10-08T07:00", "broken"]
            try expect(Alarm.recentHandled(keys, now: at(8, 12)) == ["A1@2026-10-05T07:00", "A1@2026-10-08T07:00"], "three days kept")
            let soon = alarm("09:00", [], id: "B")
            let later = alarm("07:00", weekdays, id: "C")
            try expect(Alarm.next([later, soon, alarm("08:00", [], id: "D", enabled: false)], now: at(8, 8))?.alarm.id == "B", "the soonest")
            try expect(Alarm.next([later, soon], now: at(8, 8))?.fire == at(8, 9), "its time")
            try expect(Alarm.next([], now: at(8, 8)) == nil, "none")
        }

        try test("days, time and until in three languages (Dutch weeks start on Monday)") {
            let cases: [([Int], [String])] = [
                ([], ["한 번", "Once", "Eenmalig"]),
                ([0, 1, 2, 3, 4, 5, 6], ["매일", "Every day", "Elke dag"]),
                ([1, 2, 3, 4, 5], ["평일", "Weekdays", "Doordeweeks"]),
                ([6, 0], ["주말", "Weekends", "Weekend"]),
                ([1, 3, 5], ["월·수·금", "Mon, Wed, Fri", "ma, wo, vr"]),
                ([0, 1, 6], ["일·월·토", "Sun, Mon, Sat", "ma, za, zo"]),
            ]
            for (days, words) in cases {
                let got = langs.map { Alarm.daysText(days, language: $0) }
                try expect(got == words, "daysText(\(days)) = \(got)")
            }
            try expect(langs.map { Alarm.timeText(alarm("07:00", []), language: $0) } == ["오전 7:00", "7:00 AM", "07:00"], "07:00")
            try expect(langs.map { Alarm.timeText(alarm("19:30", []), language: $0) } == ["오후 7:30", "7:30 PM", "19:30"], "19:30")
            func until(_ next: Date, _ now: Date) -> [String] { langs.map { Alarm.untilText(next, now: now, language: $0) } }
            try expect(until(at(9, 7), at(8, 23, 30)) == ["7시간 30분 뒤에 울려요", "Rings in 7 h 30 min", "Gaat over 7 u 30 min"], "7 h 30")
            try expect(until(at(8, 7, 25), at(8, 7)) == ["25분 뒤에 울려요", "Rings in 25 min", "Gaat over 25 min"], "25 min")
            try expect(until(at(8, 9), at(8, 7)) == ["2시간 뒤에 울려요", "Rings in 2 h", "Gaat over 2 u"], "whole hours")
            try expect(until(at(8, 7, 0, 30), at(8, 7)) == ["1분 뒤에 울려요", "Rings in 1 min", "Gaat over 1 min"], "seconds round up")
            try expect(until(at(9, 7, 30), at(8, 7)) == ["내일 오전 7:30에 울려요", "Rings tomorrow at 7:30 AM", "Gaat morgen om 07:30"], "tomorrow")
            try expect(until(at(12, 7), at(9, 8)) == ["월요일 오전 7:00에 울려요", "Rings Mon at 7:00 AM", "Gaat ma om 07:00"], "Monday")
        }

        try test("alarms.json: defaults for missing keys, broken entries skipped, written in key order") {
            let text = ##"{"alarms":[{"id":"A","time":"7:05"},{"id":"B","time":"06:30","label":"약","days":[5,1,1,9,"x"],"enabled":false,"sound":"trumpet","snooze":7,"createdAt":"2026-10-01T08:00:00Z"},{"id":"C","time":"21:15","sound":"soft","snooze":15,"createdAt":"2026-10-01T08:00:00.123Z","updatedAt":"2026-10-02T09:00:00Z"},{"id":"D","time":"25:00"},{"time":"07:00"},{"id":"A","time":"08:00"},"nonsense"]}"##
            let alarms = try Alarm.File.decode(Data(text.utf8)).alarms
            let iso = ISO8601DateFormatter()
            try expect(alarms.map(\.id) == ["A", "B", "C"], "ids: \(alarms.map(\.id))")
            let a = alarms[0]
            try expect(a.time == "07:05" && a.label == "" && a.days == [] && a.enabled && a.sound == .bell && a.snooze == 10
                       && a.createdAt == Date(timeIntervalSince1970: 0) && a.updatedAt == Date(timeIntervalSince1970: 0), "A: \(a)")
            let b = alarms[1]
            try expect(b.days == [1, 5] && !b.enabled && b.sound == .bell && b.snooze == 10 && b.label == "약"
                       && b.updatedAt == iso.date(from: "2026-10-01T08:00:00Z"), "B: \(b)")
            let c = alarms[2]
            try expect(c.sound == .soft && c.snooze == 15 && c.createdAt == iso.date(from: "2026-10-01T08:00:00Z")
                       && c.updatedAt == iso.date(from: "2026-10-02T09:00:00Z"), "C: \(c)")
            try expect((try? Alarm.File.decode(Data("{ not json".utf8))) == nil, "not JSON")
            try expect((try? Alarm.File.decode(Data(#"{"items":[]}"#.utf8))) == nil, "no alarms")
            let written = try Alarm.File(alarms: alarms).encoded()
            try expect(try Alarm.File.decode(written).alarms == alarms, "round-trips")
            let object = try JSONSerialization.jsonObject(with: written) as! [String: [[String: Any]]]
            try expect(object["alarms"]![0].keys.sorted() == ["createdAt", "days", "enabled", "id", "label", "snooze", "sound", "time", "updatedAt"], "keys")
            let writtenText = String(decoding: written, as: UTF8.self)
            try expect(writtenText.hasSuffix("}\n") && writtenText.contains("\"createdAt\" : \"1970-01-01T00:00:00Z\""), "whole seconds, newline: \(writtenText)")
            let keyOrder = ["createdAt", "days", "enabled", "id", "label", "snooze", "sound", "time", "updatedAt"].map { writtenText.range(of: "\"\($0)\"")!.lowerBound }
            try expect(keyOrder == keyOrder.sorted(), "written in key order")
            let fresh = Alarm.new(now: at(8, 12))
            try expect(fresh.time == "07:00" && fresh.days == [1, 2, 3, 4, 5] && fresh.enabled && fresh.sound == .bell && fresh.snooze == 10 && fresh.label == "", "new")
            try expect(fresh.createdAt == at(8, 12) && fresh.updatedAt == at(8, 12), "new: whole seconds")
        }

        try test("A1–A2 (1.39): snooze 0 is no snooze; anything but 0 · 5 · 10 · 15 reads as 10") {
            let text = ##"{"alarms":[{"id":"A","time":"07:00","snooze":0},{"id":"B","time":"07:00","snooze":7},{"id":"C","time":"07:00"},{"id":"D","time":"07:00","snooze":5}]}"##
            let alarms = try Alarm.File.decode(Data(text.utf8)).alarms
            try expect(alarms.map(\.snooze) == [0, 10, 10, 5], "snoozes: \(alarms.map(\.snooze))")
            try expect(alarms.map(\.snoozes) == [false, true, true, true], "snoozes at all")
            try expect(try Alarm.File.decode(Alarm.File(alarms: alarms).encoded()).alarms[0].snooze == 0, "0 round-trips")
            try expect(Alarm(id: "x", time: "07:00", snooze: 0).snooze == 0 && Alarm(id: "y", time: "07:00", snooze: 3).snooze == 10, "init")
            try expect(Alarm.snoozeOptions == [0, 5, 10, 15] && Alarm.snoozeChoices == [5, 10, 15], "editor options, ring chips")
        }

        try test("Mac only: the ring window's clock, the untitled name, sounds, times as kept") {
            try expect(langs.map { Alarm.clockText(alarm("07:00", []), language: $0) } == ["07:00", "7:00 AM", "07:00"], "clock 07:00")
            try expect(langs.map { Alarm.clockText(alarm("19:30", []), language: $0) } == ["19:30", "7:30 PM", "19:30"], "clock 19:30")
            try expect(langs.map { Alarm.untitled($0) } == ["알람", "Alarm", "Wekker"], "untitled")
            try expect(langs.map { Alarm.Sound.soft.title($0) } == ["부드럽게", "Soft", "Zacht"], "sound")
            try expect(Alarm.normalTime("7:05") == "07:05" && Alarm.normalTime(" 23:59 ") == "23:59", "normal times")
            try expect([Alarm.normalTime("7:5"), Alarm.normalTime("24:00"), Alarm.normalTime("12:60"), Alarm.normalTime("7")].allSatisfy { $0 == nil }, "unreadable times")
            try expect(Alarm.time(hour: 7, minute: 5) == "07:05", "the editor's minute is zero-padded")
        }

        print("\n\(count) alarm checks passed.")
    }
}
