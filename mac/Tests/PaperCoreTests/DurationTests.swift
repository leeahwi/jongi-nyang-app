import Foundation

// 타이머 직접 정하기 (TimerLength in Duration.swift): the same cases as the Windows app
// (test/duration.test.ts). Framework-free like the other core tests.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

@main
private enum DurationTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        let langs = AppLanguage.allCases

        try test("parseDuration: the shared cases, in every language") {
            let cases: [(String, Int?)] = [
                ("40", 40), ("1:30", 90), ("0", nil), ("181", nil), ("3:00", 180), ("1시간 30분", 90), ("1h 30m", 90),
                ("1.5h", 90), ("anderhalf uur", 90), ("abc", nil), (" 25 ", 25), ("2:5", nil), ("0:45", 45),
            ]
            for lang in langs {
                for (text, minutes) in cases {
                    let got = TimerLength.parseDuration(text, language: lang)
                    try expect(got == minutes, "\(lang) \(text.debugDescription): \(String(describing: got))")
                }
            }
        }

        try test("parseDuration: every language's words, whatever the app speaks") {
            let cases: [(String, Int)] = [
                ("40분", 40), ("1시간", 60), ("1시간30분", 90), ("2시간 반", 150),
                ("40m", 40), ("40 min", 40), ("1h", 60), ("90 minutes", 90), ("1H 30M", 90), ("2 hours", 120),
                ("1u", 60), ("1 uur", 60), ("1u 30m", 90), ("1 uur 15 min", 75), ("Anderhalf  Uur", 90), ("half uur", 30),
            ]
            for lang in langs {
                for (text, minutes) in cases {
                    let got = TimerLength.parseDuration(text, language: lang)
                    try expect(got == minutes, "\(lang) \(text.debugDescription): \(String(describing: got))")
                }
            }
            try expect(TimerLength.parseDuration("", language: .ko) == nil, "empty")
            try expect(TimerLength.parseDuration("3:01", language: .en) == nil, "over three hours")
            try expect(TimerLength.parseDuration("1:60", language: .en) == nil, "1:60")
            try expect(TimerLength.parseDuration("4h", language: .en) == nil, "4h")
            try expect(TimerLength.parseDuration("1,5 uur", language: .nl) == 90, "a Dutch decimal comma")
            try expect(TimerLength.parseDuration("1,5 uur", language: .en) == nil, "no decimal comma in English")
        }

        try test("durationText: the hint under the field") {
            try expect(langs.map { TimerLength.text(40, language: $0) } == ["40분", "40 min", "40 min"], "40")
            try expect(langs.map { TimerLength.text(90, language: $0) } == ["1시간 30분", "1 h 30 min", "1 u 30 min"], "90")
            try expect(langs.map { TimerLength.text(120, language: $0) } == ["2시간", "2 h", "2 u"], "120")
        }

        try test("rememberTimer: newest first, three at most, never a preset") {
            try expect(TimerLength.remember(40, in: []) == [40], "first")
            try expect(TimerLength.remember(90, in: [40]) == [90, 40], "second")
            try expect(TimerLength.remember(40, in: [90, 40]) == [40, 90], "again")
            try expect(TimerLength.remember(45, in: [90, 40, 10]) == [45, 90, 40], "three")
            try expect(TimerLength.remember(25, in: [90, 40]) == [90, 40], "a preset leaves the list alone")
            try expect(TimerLength.remember(7, in: [90, 5, 400, 40]) == [7, 90, 40], "presets and nonsense in the saved list are dropped")
        }

        print("\n\(count) duration checks passed.")
    }
}
