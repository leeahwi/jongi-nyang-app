import Foundation

// 입력 줄 (Intent.swift): the same cases as the Windows app (test/intent.test.ts), listed in
// intent-cases.md. Framework-free like the other core tests.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

@main
private enum IntentTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        var seoul = Calendar(identifier: .gregorian)
        seoul.timeZone = TimeZone(identifier: "Asia/Seoul")!
        // Thursday 2026-10-08 14:50.
        let now = seoul.date(from: DateComponents(year: 2026, month: 10, day: 8, hour: 14, minute: 50))!

        func show(_ date: Date?) -> String {
            guard let date else { return "-" }
            let p = seoul.dateComponents([.year, .month, .day, .hour, .minute], from: date)
            return String(format: "%04d-%02d-%02d %02d:%02d", p.year!, p.month!, p.day!, p.hour!, p.minute!)
        }
        func rule(_ rule: RepeatRule) -> String {
            switch rule.kind {
            case .weekly: "weekly [\((rule.weekdays ?? []).map(String.init).joined(separator: ","))]"
            case .monthly: "monthly \(rule.monthDay ?? 0)"
            default: rule.kind.rawValue
            }
        }
        func describe(_ candidate: Intent.Candidate, _ language: AppLanguage) -> String {
            let fields: String
            switch candidate {
            case .todo(let parsed):
                fields = "todo \"\(parsed.title)\"" + (parsed.reminderAt.map { " reminder \(show($0))" } ?? "") + (parsed.dueDate.map { " due \($0)" } ?? "")
            case .event(let event):
                fields = "event \"\(event.title)\" \(event.date) " + (event.allDay ? "all-day"
                    : String(format: "%02d:%02d–%02d:%02d", event.start / 60, event.start % 60, event.end / 60, event.end % 60))
                    + (event.rule.map { " " + $0.kind.rawValue } ?? "")
            case .repeating(let guess):
                fields = "repeat \"\(guess.title)\" " + rule(guess.rule) + (guess.time.map { " \($0)" } ?? "")
            case .timer(let minutes, let title):
                fields = "timer \(minutes)" + (title.map { " \"\($0)\"" } ?? "")
            case .alarm(let time, let days, let label):
                fields = "alarm \(time) [\(days.map(String.init).joined(separator: ","))] \"\(label)\""
            case .memo(let text):
                fields = "memo \"\(text.replacingOccurrences(of: "\n", with: "\\n"))\""
            }
            return fields + " ⟨" + candidate.chip(language, now: now, calendar: seoul) + "⟩"
        }
        func problemName(_ problem: Intent.Problem?) -> String {
            switch problem {
            case .alarmTime: "alarmTime"
            case .timerLength: "timerLength"
            case .repeating: "repeat"
            case nil: "-"
            }
        }

        try test("read: the shared cases (intent-cases.md)") {
            let cases: [(Int, AppLanguage, String, [String: Intent.Kind], [String], String)] = [
            (1, .ko, "내일 3시 회의", [:], ["event \"회의\" 2026-10-09 15:00–16:00 ⟨일정 · 내일(금) 15:00–16:00⟩", "todo \"회의\" reminder 2026-10-09 15:00 ⟨할 일 · 알림 내일 15:00⟩"], "-"),
            (2, .ko, "내일 3시 장보기", [:], ["todo \"장보기\" reminder 2026-10-09 15:00 ⟨할 일 · 알림 내일 15:00⟩", "event \"장보기\" 2026-10-09 15:00–16:00 ⟨일정 · 내일(금) 15:00–16:00⟩"], "-"),
            (3, .ko, "금요일까지 보고서", [:], ["todo \"보고서\" due 2026-10-09 ⟨할 일 · 마감 10월 9일⟩", "event \"보고서\" 2026-10-09 all-day ⟨일정 · 10월 9일 종일⟩"], "-"),
            (4, .ko, "장보기", [:], ["todo \"장보기\" ⟨할 일⟩", "memo \"장보기\" ⟨메모로 남기기⟩"], "-"),
            (5, .ko, "15:30 치과", [:], ["event \"치과\" 2026-10-08 15:30–16:30 ⟨일정 · 오늘(목) 15:30–16:30⟩", "todo \"치과\" reminder 2026-10-08 15:30 ⟨할 일 · 알림 15:30⟩"], "-"),
            (6, .ko, "타이머 40", [:], ["timer 40 ⟨40분 타이머 시작⟩", "todo \"타이머 40\" ⟨할 일⟩"], "-"),
            (7, .ko, "40분 집중", [:], ["timer 40 ⟨40분 타이머 시작⟩", "todo \"40분 집중\" ⟨할 일⟩"], "-"),
            (8, .ko, "집중 1:30", [:], ["timer 90 ⟨1시간 30분 타이머 시작⟩", "todo \"집중\" reminder 2026-10-09 01:30 ⟨할 일 · 알림 내일 01:30⟩"], "-"),
            (9, .ko, "보고서 25분 집중", [:], ["timer 25 \"보고서\" ⟨25분 집중 · 보고서⟩", "todo \"보고서 25분 집중\" ⟨할 일⟩"], "-"),
            (10, .ko, "40분 타이머", [:], ["timer 40 ⟨40분 타이머 시작⟩", "todo \"40분 타이머\" ⟨할 일⟩"], "-"),
            (11, .ko, "알람 7시", [:], ["alarm 07:00 [] \"\" ⟨알람 · 내일 오전 7:00⟩", "todo \"알람\" reminder 2026-10-09 07:00 ⟨할 일 · 알림 내일 07:00⟩"], "-"),
            (12, .ko, "알람 오전 7:30 평일", [:], ["alarm 07:30 [1,2,3,4,5] \"\" ⟨알람 · 평일 오전 7:30⟩", "todo \"알람 평일\" reminder 2026-10-09 07:30 ⟨할 일 · 알림 내일 07:30⟩"], "-"),
            (13, .ko, "알람 6시 월수금 약", [:], ["alarm 06:00 [1,3,5] \"약\" ⟨알람 · 월·수·금 오전 6:00⟩", "todo \"알람 월수금 약\" reminder 2026-10-08 18:00 ⟨할 일 · 알림 18:00⟩"], "-"),
            (14, .ko, "알람 7시 주말", [:], ["alarm 07:00 [0,6] \"\" ⟨알람 · 주말 오전 7:00⟩", "todo \"알람 주말\" reminder 2026-10-09 07:00 ⟨할 일 · 알림 내일 07:00⟩"], "-"),
            (15, .ko, "알람 7시 기상", [:], ["alarm 07:00 [] \"기상\" ⟨알람 · 내일 오전 7:00⟩", "todo \"알람 기상\" reminder 2026-10-09 07:00 ⟨할 일 · 알림 내일 07:00⟩"], "-"),
            (16, .ko, "/메모 내일 3시 회의", [:], ["memo \"내일 3시 회의\" ⟨메모로 남기기⟩"], "-"),
            (17, .ko, "/알람 abc", [:], [], "alarmTime"),
            (18, .ko, "/타이머 0", [:], [], "timerLength"),
            (19, .ko, "/할일 내일 3시 회의", [:], ["todo \"회의\" reminder 2026-10-09 15:00 ⟨할 일 · 알림 내일 15:00⟩"], "-"),
            (20, .ko, "/일정 장보기", [:], ["event \"장보기\" 2026-10-08 15:00–16:00 ⟨일정 · 오늘(목) 15:00–16:00⟩"], "-"),
            (21, .ko, "장보기\n우유, 달걀", [:], ["memo \"장보기\\n우유, 달걀\" ⟨메모로 남기기⟩", "todo \"장보기\" ⟨할 일⟩"], "-"),
            (22, .ko, "   ", [:], [], "-"),
            (23, .ko, "내일 3시 장보기", ["장보기": .event], ["event \"장보기\" 2026-10-09 15:00–16:00 ⟨일정 · 내일(금) 15:00–16:00⟩", "todo \"장보기\" reminder 2026-10-09 15:00 ⟨할 일 · 알림 내일 15:00⟩"], "-"),
            (24, .ko, "내일 3시 회의", ["회의": .todo], ["todo \"회의\" reminder 2026-10-09 15:00 ⟨할 일 · 알림 내일 15:00⟩", "event \"회의\" 2026-10-09 15:00–16:00 ⟨일정 · 내일(금) 15:00–16:00⟩"], "-"),
            (25, .ko, "/timer 25", [:], ["todo \"/timer 25\" ⟨할 일⟩", "memo \"/timer 25\" ⟨메모로 남기기⟩"], "-"),
            (26, .ko, "/메모", [:], [], "-"),
            (27, .en, "meeting tomorrow 3pm", [:], ["event \"meeting\" 2026-10-09 15:00–16:00 ⟨Event · tomorrow (Fri) 3:00–4:00 PM⟩", "todo \"meeting\" reminder 2026-10-09 15:00 ⟨To-do · reminder tomorrow 3:00 PM⟩"], "-"),
            (28, .en, "call mom at 4", [:], ["event \"call mom\" 2026-10-08 16:00–17:00 ⟨Event · today (Thu) 4:00–5:00 PM⟩", "todo \"call mom\" reminder 2026-10-08 16:00 ⟨To-do · reminder 4:00 PM⟩"], "-"),
            (29, .en, "buy milk tomorrow 9am", [:], ["todo \"buy milk\" reminder 2026-10-09 09:00 ⟨To-do · reminder tomorrow 9:00 AM⟩", "event \"buy milk\" 2026-10-09 09:00–10:00 ⟨Event · tomorrow (Fri) 9:00–10:00 AM⟩"], "-"),
            (30, .en, "report by friday", [:], ["todo \"report\" due 2026-10-09 ⟨To-do · due Oct 9⟩", "event \"report\" 2026-10-09 all-day ⟨Event · Oct 9 all day⟩"], "-"),
            (31, .en, "buy milk", [:], ["todo \"buy milk\" ⟨To-do⟩", "memo \"buy milk\" ⟨Save as a note⟩"], "-"),
            (32, .en, "timer 40", [:], ["timer 40 ⟨Start a 40 min timer⟩", "todo \"timer 40\" ⟨To-do⟩"], "-"),
            (33, .en, "25 min focus", [:], ["timer 25 ⟨Start a 25 min timer⟩", "todo \"25 min focus\" ⟨To-do⟩"], "-"),
            (34, .en, "focus 1:30", [:], ["timer 90 ⟨Start a 1 h 30 min timer⟩", "todo \"focus\" reminder 2026-10-09 01:30 ⟨To-do · reminder tomorrow 1:30 AM⟩"], "-"),
            (35, .en, "40 min timer", [:], ["timer 40 ⟨Start a 40 min timer⟩", "todo \"40 min timer\" ⟨To-do⟩"], "-"),
            (36, .en, "alarm 7am", [:], ["alarm 07:00 [] \"\" ⟨Alarm · tomorrow 7:00 AM⟩", "todo \"alarm\" reminder 2026-10-09 07:00 ⟨To-do · reminder tomorrow 7:00 AM⟩"], "-"),
            (37, .en, "alarm 7:30 weekdays", [:], ["alarm 07:30 [1,2,3,4,5] \"\" ⟨Alarm · weekdays 7:30 AM⟩", "todo \"alarm weekdays\" reminder 2026-10-09 07:30 ⟨To-do · reminder tomorrow 7:30 AM⟩"], "-"),
            (38, .en, "alarm 7 every day", [:], ["alarm 07:00 [0,1,2,3,4,5,6] \"\" ⟨Alarm · every day 7:00 AM⟩", "todo \"alarm 7 every day\" ⟨To-do⟩"], "-"),
            (39, .en, "/note call the bank", [:], ["memo \"call the bank\" ⟨Save as a note⟩"], "-"),
            (40, .en, "/alarm soon", [:], [], "alarmTime"),
            (41, .en, "/타이머 25", [:], ["timer 25 ⟨Start a 25 min timer⟩"], "-"),
            (42, .en, "/event dentist friday", [:], ["event \"dentist\" 2026-10-09 all-day ⟨Event · Oct 9 all day⟩"], "-"),
            (43, .en, "groceries\nmilk, eggs", [:], ["memo \"groceries\\nmilk, eggs\" ⟨Save as a note⟩", "todo \"groceries\" ⟨To-do⟩"], "-"),
            (44, .en, "buy milk tomorrow 9am", ["buy": .event], ["event \"buy milk\" 2026-10-09 09:00–10:00 ⟨Event · tomorrow (Fri) 9:00–10:00 AM⟩", "todo \"buy milk\" reminder 2026-10-09 09:00 ⟨To-do · reminder tomorrow 9:00 AM⟩"], "-"),
            (45, .en, "/taak x", [:], ["todo \"/taak x\" ⟨To-do⟩", "memo \"/taak x\" ⟨Save as a note⟩"], "-"),
            (46, .en, "", [:], [], "-"),
            (47, .en, "/timer 0", [:], [], "timerLength"),
            (48, .nl, "morgen om 3 uur overleg", [:], ["event \"overleg\" 2026-10-09 15:00–16:00 ⟨Afspraak · morgen (vr) 15:00–16:00⟩", "todo \"overleg\" reminder 2026-10-09 15:00 ⟨Taak · herinnering morgen 15:00⟩"], "-"),
            (49, .nl, "boodschappen morgen om 9 uur", [:], ["todo \"boodschappen\" reminder 2026-10-09 09:00 ⟨Taak · herinnering morgen 09:00⟩", "event \"boodschappen\" 2026-10-09 09:00–10:00 ⟨Afspraak · morgen (vr) 09:00–10:00⟩"], "-"),
            (50, .nl, "verslag tot vrijdag", [:], ["todo \"verslag\" due 2026-10-09 ⟨Taak · deadline 9 okt⟩", "event \"verslag\" 2026-10-09 all-day ⟨Afspraak · 9 okt hele dag⟩"], "-"),
            (51, .nl, "boodschappen", [:], ["todo \"boodschappen\" ⟨Taak⟩", "memo \"boodschappen\" ⟨Bewaren als notitie⟩"], "-"),
            (52, .nl, "timer 40", [:], ["timer 40 ⟨Timer van 40 min starten⟩", "todo \"timer 40\" ⟨Taak⟩"], "-"),
            (53, .nl, "40 min timer", [:], ["timer 40 ⟨Timer van 40 min starten⟩", "todo \"40 min timer\" ⟨Taak⟩"], "-"),
            (54, .nl, "focus 25", [:], ["timer 25 ⟨Timer van 25 min starten⟩", "todo \"focus 25\" ⟨Taak⟩"], "-"),
            (55, .nl, "wekker 7:00", [:], ["alarm 07:00 [] \"\" ⟨Wekker · morgen 07:00⟩", "todo \"wekker\" reminder 2026-10-09 07:00 ⟨Taak · herinnering morgen 07:00⟩"], "-"),
            (56, .nl, "wekker 7 uur doordeweeks", [:], ["alarm 07:00 [1,2,3,4,5] \"\" ⟨Wekker · doordeweeks 07:00⟩", "todo \"wekker 7 uur doordeweeks\" ⟨Taak⟩"], "-"),
            (57, .nl, "/notitie bel de bank", [:], ["memo \"bel de bank\" ⟨Bewaren als notitie⟩"], "-"),
            (58, .nl, "/wekker abc", [:], [], "alarmTime"),
            (59, .nl, "/timer 0", [:], [], "timerLength"),
            (60, .nl, "tandarts om 15:00", [:], ["event \"tandarts\" 2026-10-08 15:00–16:00 ⟨Afspraak · vandaag (do) 15:00–16:00⟩", "todo \"tandarts\" reminder 2026-10-08 15:00 ⟨Taak · herinnering 15:00⟩"], "-"),
            (61, .nl, "/afspraak etentje", [:], ["event \"etentje\" 2026-10-08 15:00–16:00 ⟨Afspraak · vandaag (do) 15:00–16:00⟩"], "-"),
            (62, .nl, "lijstje\nmelk, eieren", [:], ["memo \"lijstje\\nmelk, eieren\" ⟨Bewaren als notitie⟩", "todo \"lijstje\" ⟨Taak⟩"], "-"),
            (63, .nl, "morgen om 3 uur overleg", ["overleg": .todo], ["todo \"overleg\" reminder 2026-10-09 15:00 ⟨Taak · herinnering morgen 15:00⟩", "event \"overleg\" 2026-10-09 15:00–16:00 ⟨Afspraak · morgen (vr) 15:00–16:00⟩"], "-"),
            (64, .nl, "알람 7시 매일", [:], ["alarm 07:00 [0,1,2,3,4,5,6] \"\" ⟨Wekker · elke dag 07:00⟩", "todo \"알람 매일\" reminder 2026-10-09 07:00 ⟨Taak · herinnering morgen 07:00⟩"], "-"),
            (65, .nl, "/할일 내일 3시 회의", [:], ["todo \"회의\" reminder 2026-10-09 15:00 ⟨Taak · herinnering morgen 15:00⟩"], "-"),
            (66, .nl, "  ", [:], [], "-"),
            // Added by Windows (stage 4, 집중): a timer with a title is a focus (intent-cases.md rows 101–111).
            (101, .ko, "집중 25분 보고서", [:], ["timer 25 \"보고서\" ⟨25분 집중 · 보고서⟩", "todo \"집중 25분 보고서\" ⟨할 일⟩"], "-"),
            (102, .ko, "25분 집중 보고서", [:], ["timer 25 \"보고서\" ⟨25분 집중 · 보고서⟩", "todo \"25분 집중 보고서\" ⟨할 일⟩"], "-"),
            (103, .ko, "집중 1시간 30분 보고서 쓰기", [:], ["timer 90 \"보고서 쓰기\" ⟨1시간 30분 집중 · 보고서 쓰기⟩", "todo \"집중 1시간 30분 보고서 쓰기\" ⟨할 일⟩"], "-"),
            (104, .ko, "집중 보고서", [:], ["todo \"집중 보고서\" ⟨할 일⟩", "memo \"집중 보고서\" ⟨메모로 남기기⟩"], "-"),
            (105, .en, "focus 25 report", [:], ["timer 25 \"report\" ⟨Focus 25 min · report⟩", "todo \"focus 25 report\" ⟨To-do⟩"], "-"),
            (106, .en, "25 min focus report", [:], ["timer 25 \"report\" ⟨Focus 25 min · report⟩", "todo \"25 min focus report\" ⟨To-do⟩"], "-"),
            (107, .en, "report 25 min focus", [:], ["timer 25 \"report\" ⟨Focus 25 min · report⟩", "todo \"report 25 min focus\" ⟨To-do⟩"], "-"),
            (108, .en, "focus 1 h 30 min write report", [:], ["timer 90 \"write report\" ⟨Focus 1 h 30 min · write report⟩", "todo \"focus 1 h 30 min write report\" ⟨To-do⟩"], "-"),
            (109, .nl, "focus 25 rapport", [:], ["timer 25 \"rapport\" ⟨25 min focussen · rapport⟩", "todo \"focus 25 rapport\" ⟨Taak⟩"], "-"),
            (110, .nl, "rapport 25 min focus", [:], ["timer 25 \"rapport\" ⟨25 min focussen · rapport⟩", "todo \"rapport 25 min focus\" ⟨Taak⟩"], "-"),
            (111, .nl, "25 min focus rapport", [:], ["timer 25 \"rapport\" ⟨25 min focussen · rapport⟩", "todo \"25 min focus rapport\" ⟨Taak⟩"], "-"),
            // Added by Mac (stage 4): more forms (rows 112–118).
            (112, .ko, "집중 25분 보고서 쓰기", [:], ["timer 25 \"보고서 쓰기\" ⟨25분 집중 · 보고서 쓰기⟩", "todo \"집중 25분 보고서 쓰기\" ⟨할 일⟩"], "-"),
            (113, .ko, "보고서 1시간 반 집중", [:], ["timer 90 \"보고서\" ⟨1시간 30분 집중 · 보고서⟩", "todo \"보고서 1시간 반 집중\" ⟨할 일⟩"], "-"),
            (114, .ko, "타이머 25 보고서", [:], ["todo \"타이머 25 보고서\" ⟨할 일⟩", "memo \"타이머 25 보고서\" ⟨메모로 남기기⟩"], "-"),
            (115, .en, "focus 25 min write the report", [:], ["timer 25 \"write the report\" ⟨Focus 25 min · write the report⟩", "todo \"focus 25 min write the report\" ⟨To-do⟩"], "-"),
            (116, .en, "timer 25 report", [:], ["todo \"timer 25 report\" ⟨To-do⟩", "memo \"timer 25 report\" ⟨Save as a note⟩"], "-"),
            (117, .nl, "25 min focus rapport afmaken", [:], ["timer 25 \"rapport afmaken\" ⟨25 min focussen · rapport afmaken⟩", "todo \"25 min focus rapport afmaken\" ⟨Taak⟩"], "-"),
            (118, .nl, "focus 1 uur rapport", [:], ["timer 60 \"rapport\" ⟨1 u focussen · rapport⟩", "todo \"focus 1 uur rapport\" ⟨Taak⟩"], "-"),

            ]
            var languages: [AppLanguage: Int] = [:]
            for (number, language, text, prefer, expected, problem) in cases {
                let got = Intent.read(text, now: now, calendar: seoul, language: language, prefer: prefer).map { describe($0, language) }
                try expect(got == expected, "#\(number) \(language) \(text.debugDescription):\n  got      \(got)\n  expected \(expected)")
                let gotProblem = problemName(Intent.problem(text, now: now, calendar: seoul, language: language))
                try expect(gotProblem == problem, "#\(number) problem: \(gotProblem)")
                languages[language, default: 0] += 1
            }
            try expect(cases.count == 84 && AppLanguage.allCases.allSatisfy { (languages[$0] ?? 0) >= 12 }, "cases per language: \(languages)")
        }

        try test("read: repeats and Korean relative times (1.38, intent-cases.md rows 201–228)") {
            let cases: [(Int, AppLanguage, String, [String], String)] = [
                (201, .ko, "매일 물 마시기", ["repeat \"물 마시기\" daily ⟨반복 할 일 · 매일⟩", "todo \"매일 물 마시기\" ⟨할 일⟩"], "-"),
                (202, .ko, "매주 월 9시 주간 회의", ["event \"주간 회의\" 2026-10-12 09:00–10:00 weekly ⟨반복 일정 · 매주 월 09:00–10:00⟩", "repeat \"주간 회의\" weekly [1] 09:00 ⟨반복 할 일 · 매주 월 09:00⟩", "todo \"매주 월 주간 회의\" reminder 2026-10-09 09:00 ⟨할 일 · 알림 내일 09:00⟩"], "-"),
                (203, .ko, "평일 8시 운동", ["repeat \"운동\" weekdays 08:00 ⟨반복 할 일 · 평일 08:00⟩", "todo \"평일 운동\" reminder 2026-10-09 08:00 ⟨할 일 · 알림 내일 08:00⟩"], "-"),
                (204, .ko, "/반복 매일 9시 약 먹기", ["repeat \"약 먹기\" daily 09:00 ⟨반복 할 일 · 매일 09:00⟩"], "-"),
                (205, .ko, "/반복 약 먹기", [], "repeat"),
                (206, .ko, "매일", ["todo \"매일\" ⟨할 일⟩", "memo \"매일\" ⟨메모로 남기기⟩"], "-"),
                (207, .ko, "매월 15일 카드값 내기", ["repeat \"카드값 내기\" monthly 15 ⟨반복 할 일 · 매월 15일⟩", "todo \"매월 15일 카드값 내기\" ⟨할 일⟩"], "-"),
                (208, .ko, "매주 월수금 3시 수영", ["repeat \"수영\" weekly [1,3,5] 15:00 ⟨반복 할 일 · 매주 월·수·금 15:00⟩", "todo \"매주 월수금 수영\" reminder 2026-10-08 15:00 ⟨할 일 · 알림 15:00⟩"], "-"),
                (209, .ko, "주말 10시 청소", ["repeat \"청소\" weekly [0,6] 10:00 ⟨반복 할 일 · 매주 토·일 10:00⟩", "todo \"주말 청소\" reminder 2026-10-09 10:00 ⟨할 일 · 알림 내일 10:00⟩"], "-"),
                (210, .ko, "매일 9시 약 먹기", ["repeat \"약 먹기\" daily 09:00 ⟨반복 할 일 · 매일 09:00⟩", "todo \"매일 약 먹기\" reminder 2026-10-09 09:00 ⟨할 일 · 알림 내일 09:00⟩", "event \"약 먹기\" 2026-10-08 09:00–10:00 daily ⟨반복 일정 · 매일 09:00–10:00⟩"], "-"),
                (211, .ko, "매주 회의", ["todo \"매주 회의\" ⟨할 일⟩", "memo \"매주 회의\" ⟨메모로 남기기⟩"], "-"),
                (212, .ko, "매주 금요일 저녁 7시 영화", ["event \"영화\" 2026-10-09 19:00–20:00 weekly ⟨반복 일정 · 매주 금 19:00–20:00⟩", "repeat \"영화\" weekly [5] 19:00 ⟨반복 할 일 · 매주 금 19:00⟩", "todo \"매주 영화\" reminder 2026-10-09 19:00 ⟨할 일 · 알림 내일 19:00⟩"], "-"),
                (213, .en, "every day drink water", ["repeat \"drink water\" daily ⟨Repeating to-do · every day⟩", "todo \"every day drink water\" ⟨To-do⟩"], "-"),
                (214, .en, "every Monday 9am team meeting", ["event \"team meeting\" 2026-10-12 09:00–10:00 weekly ⟨Repeating event · every Mon 9:00–10:00 AM⟩", "repeat \"team meeting\" weekly [1] 09:00 ⟨Repeating to-do · every Mon 9:00 AM⟩", "todo \"every team meeting\" reminder 2026-10-12 09:00 ⟨To-do · reminder Mon, Oct 12 9:00 AM⟩"], "-"),
                (215, .en, "weekdays 8am workout", ["repeat \"workout\" weekdays 08:00 ⟨Repeating to-do · weekdays 8:00 AM⟩", "todo \"weekdays workout\" reminder 2026-10-09 08:00 ⟨To-do · reminder tomorrow 8:00 AM⟩"], "-"),
                (216, .en, "/repeat every friday 5pm review", ["repeat \"review\" weekly [5] 17:00 ⟨Repeating to-do · every Fri 5:00 PM⟩"], "-"),
                (217, .en, "every monday and thursday at 6 gym", ["repeat \"gym\" weekly [1,4] 18:00 ⟨Repeating to-do · every Mon, Thu 6:00 PM⟩", "todo \"every and thursday gym\" reminder 2026-10-12 18:00 ⟨To-do · reminder Mon, Oct 12 6:00 PM⟩"], "-"),
                (218, .en, "every month on the 1st pay rent", ["repeat \"pay rent\" monthly 1 ⟨Repeating to-do · every month on the 1st⟩", "todo \"every month on the 1st pay rent\" ⟨To-do⟩"], "-"),
                (219, .en, "매일 물 마시기", ["repeat \"물 마시기\" daily ⟨Repeating to-do · every day⟩", "todo \"매일 물 마시기\" ⟨To-do⟩"], "-"),
                (220, .nl, "elke dag water drinken", ["repeat \"water drinken\" daily ⟨Herhalende taak · elke dag⟩", "todo \"elke dag water drinken\" ⟨Taak⟩"], "-"),
                (221, .nl, "elke maandag 9 uur overleg", ["event \"overleg\" 2026-10-12 09:00–10:00 weekly ⟨Herhalende afspraak · elke ma 09:00–10:00⟩", "repeat \"overleg\" weekly [1] 09:00 ⟨Herhalende taak · elke ma 09:00⟩", "todo \"elke 9 uur overleg\" due 2026-10-12 ⟨Taak · deadline 12 okt⟩"], "-"),
                (222, .nl, "doordeweeks 8 uur sporten", ["repeat \"sporten\" weekdays 08:00 ⟨Herhalende taak · werkdagen 08:00⟩", "todo \"doordeweeks 8 uur sporten\" ⟨Taak⟩"], "-"),
                (223, .nl, "elke dinsdag en donderdag om 7 uur hardlopen", ["repeat \"hardlopen\" weekly [2,4] 07:00 ⟨Herhalende taak · elke di, do 07:00⟩", "todo \"elke en donderdag hardlopen\" reminder 2026-10-13 07:00 ⟨Taak · herinnering di 13 okt 07:00⟩"], "-"),
                (224, .nl, "/herhaal elke dag", [], "repeat"),
                (225, .ko, "30분 뒤 빨래 꺼내기", ["todo \"빨래 꺼내기\" reminder 2026-10-08 15:20 ⟨할 일 · 알림 15:20⟩", "event \"빨래 꺼내기\" 2026-10-08 15:20–16:20 ⟨일정 · 오늘(목) 15:20–16:20⟩"], "-"),
                (226, .ko, "2시간 뒤 회의 준비", ["event \"회의 준비\" 2026-10-08 16:50–17:50 ⟨일정 · 오늘(목) 16:50–17:50⟩", "todo \"회의 준비\" reminder 2026-10-08 16:50 ⟨할 일 · 알림 16:50⟩"], "-"),
                (227, .en, "laundry in 30 min", ["todo \"laundry\" reminder 2026-10-08 15:20 ⟨To-do · reminder 3:20 PM⟩", "event \"laundry\" 2026-10-08 15:20–16:20 ⟨Event · today (Thu) 3:20–4:20 PM⟩"], "-"),
                (228, .nl, "over een kwartier was ophalen", ["todo \"was ophalen\" reminder 2026-10-08 15:05 ⟨Taak · herinnering 15:05⟩", "event \"was ophalen\" 2026-10-08 15:05–16:05 ⟨Afspraak · vandaag (do) 15:05–16:05⟩"], "-"),
            ]
            for (row, language, text, expected, problem) in cases {
                let got = Intent.read(text, now: now, calendar: seoul, language: language).map { describe($0, language) }
                try expect(got == expected, "row \(row) \(text.debugDescription):\n  got  \(got)\n  want \(expected)")
                let hint = problemName(Intent.problem(text, now: now, calendar: seoul, language: language))
                try expect(hint == problem, "row \(row) problem \(hint)")
            }
            func added(_ text: String, _ language: AppLanguage) -> String {
                Intent.addedText(Intent.read(text, now: now, calendar: seoul, language: language)[0], language: language, now: now, calendar: seoul)
            }
            let toasts = [added("매주 월 9시 주간 회의", .ko), added("평일 8시 운동", .ko), added("every day drink water", .en), added("elke maandag 9 uur overleg", .nl)]
            try expect(toasts == ["반복 일정으로 넣었어요 · 매주 월 09:00", "반복 할 일로 넣었어요 · 평일 08:00", "Added as a repeating to-do · every day",
                                  "Toegevoegd als herhalende afspraak · elke ma 09:00"], "toasts \(toasts)")
            try expect(AppLanguage.allCases.map { Intent.switchText(.repeating, language: $0) } == ["반복 할 일로 바꾸기", "Make it a repeating to-do", "Maak er een herhalende taak van"]
                       && AppLanguage.allCases.map { Intent.kindName(.repeating, language: $0) } == ["반복 할 일", "Repeating to-do", "Herhalende taak"], "words")
            try expect(AppLanguage.allCases.map { Intent.Problem.repeating.text($0) } == ["반복을 알아듣지 못했어요", "Couldn’t read the repeat", "Kon de herhaling niet lezen"], "hint")
        }

        try test("read: the hint texts in every language") {
            try expect(AppLanguage.allCases.map { Intent.Problem.alarmTime.text($0) } == ["알람 시간을 알아듣지 못했어요", "Couldn’t read the alarm time", "Kon de wektijd niet lezen"], "alarm")
            try expect(AppLanguage.allCases.map { Intent.Problem.timerLength.text($0) } == ["타이머 길이를 알아듣지 못했어요", "Couldn’t read the timer length", "Kon de timerduur niet lezen"], "timer")
            try expect(Intent.slashKind("/메모 a", language: .en) == .memo && Intent.slashKind("/note a", language: .ko) == nil && Intent.slashKind("/Wekker 7", language: .nl) == .alarm, "slash kinds")
        }

        try test("added: the toast's words, and the switch words (same as intent.test.ts)") {
            func added(_ text: String, _ language: AppLanguage, _ index: Int = 0) -> String {
                Intent.addedText(Intent.read(text, now: now, calendar: seoul, language: language)[index], language: language, now: now, calendar: seoul)
            }
            try expect(added("내일 3시 회의", .ko) == "일정으로 넣었어요 · 내일 15:00", added("내일 3시 회의", .ko))
            try expect(added("meeting tomorrow 3pm", .en) == "Added as an event · tomorrow 3:00 PM", added("meeting tomorrow 3pm", .en))
            try expect(added("morgen om 3 uur overleg", .nl) == "Toegevoegd als afspraak · morgen 15:00", "nl event")
            try expect(added("타이머 40", .ko) == "40분 타이머를 시작했어요" && added("timer 40", .en) == "Started a 40 min timer" && added("timer 40", .nl) == "Timer van 40 min gestart", "timer")
            // 집중 (stage 4): a timer with a title.
            let focus = [added("보고서 25분 집중", .ko), added("focus 25 report", .en), added("focus 25 rapport", .nl)]
            try expect(focus == ["25분 집중을 시작했어요 · 보고서", "Focusing for 25 min · report", "25 min focus gestart · rapport"], "focus: \(focus)")
            try expect(added("알람 오전 7:30 평일", .ko) == "알람을 맞췄어요 · 평일 오전 7:30" && added("alarm 7:30 weekdays", .en) == "Alarm set · weekdays 7:30 AM", "alarm: \(added("alarm 7:30 weekdays", .en))")
            try expect(added("장보기\n우유", .ko) == "메모로 남겼어요" && added("buy milk", .en, 1) == "Saved as a note" && added("boodschappen", .nl, 1) == "Bewaard als notitie", "memo")
            try expect(added("금요일까지 보고서", .ko, 1) == "일정으로 넣었어요 · 10월 9일 종일" && added("report by friday", .en, 1) == "Added as an event · Oct 9 all day", "all-day")
            try expect(added("내일 3시 장보기", .ko) == "할 일로 넣었어요 · 내일 15:00" && added("15:30 치과", .ko, 1) == "할 일로 넣었어요 · 오늘 15:30"
                       && added("장보기", .ko) == "할 일로 넣었어요" && added("금요일까지 보고서", .ko) == "할 일로 넣었어요 · 마감 10월 9일", "todo")
            try expect(added("call mom at 4", .en, 1) == "Added as a to-do · today 4:00 PM", added("call mom at 4", .en, 1))
            try expect(AppLanguage.allCases.map { Intent.switchText(.todo, language: $0) } == ["할 일로 바꾸기", "Make it a to-do", "Maak er een taak van"]
                       && AppLanguage.allCases.map { Intent.switchText(.event, language: $0) } == ["일정으로 바꾸기", "Make it an event", "Maak er een afspraak van"]
                       && AppLanguage.allCases.map { Intent.switchText(.memo, language: $0) } == ["메모로 바꾸기", "Make it a note", "Maak er een notitie van"], "switch")
        }

        try test("key: the title's first word, lowercased, without punctuation") {
            let cases: [(AppLanguage, String, String?)] = [
                (.ko, "내일 3시 장보기", "장보기"), (.ko, "내일 3시 회의", "회의"), (.en, "buy milk tomorrow 9am", "buy"),
                (.en, "Meeting, tomorrow 3pm", "meeting"), (.nl, "morgen om 3 uur overleg", "overleg"), (.ko, "   ", nil),
            ]
            for (language, text, key) in cases {
                let got = Intent.key(text, now: now, calendar: seoul, language: language)
                try expect(got == key, "\(text.debugDescription): \(got ?? "nil")")
            }
        }

        try test("memory: twice the same switch learns it, switching back once forgets it, 200 keys at most") {
            var memory = Intent.Memory()
            memory.switched(key: "장보기", from: .todo, to: .event)
            try expect(memory.prefer.isEmpty && memory.pending["장보기"] == .init(kind: .event, count: 1), "1: \(memory)")
            memory.switched(key: "장보기", from: .todo, to: .event)
            try expect(memory.prefer == ["장보기": .event] && memory.pending.isEmpty, "2: \(memory)")
            memory.switched(key: "장보기", from: .event, to: .todo)
            try expect(memory.prefer.isEmpty && memory.pending.isEmpty, "3: \(memory)")
            var other = Intent.Memory()
            other.switched(key: "a", from: .todo, to: .event)
            other.switched(key: "a", from: .todo, to: .memo)
            try expect(other.prefer.isEmpty && other.pending["a"] == .init(kind: .memo, count: 1), "4: \(other)")
            var many = Intent.Memory()
            for index in 0...200 {
                many.switched(key: "k\(index)", from: .todo, to: .event)
                many.switched(key: "k\(index)", from: .todo, to: .event)
            }
            try expect(many.prefer.count == 200 && many.prefer["k0"] == nil && many.prefer["k200"] == .event && many.order.count == 200, "5: \(many.prefer.count)")
            // Kept as JSON by the app.
            let data = try JSONEncoder().encode(memory)
            try expect(try JSONDecoder().decode(Intent.Memory.self, from: data) == memory, "codable")
        }

        // MARK: 하루 띠 and 다음 (DayRibbon.swift)

        func at(_ hour: Int, _ minute: Int = 0, day: Int = 8) -> Date {
            seoul.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
        }
        func event(_ id: String, _ from: Date, _ to: Date, allDay: Bool = false) -> CalendarEvent {
            CalendarEvent(key: "local/\(id)", calendarId: "local", title: id, allDay: allDay, start: from, end: to, color: "#5b8bd0")
        }

        try test("ribbon: 8–24 by default, labels every four hours, bars, rings, now and next") {
            let events = [event("study", at(9), at(10)), event("standup", at(14, 30), at(15, 15)), event("dentist", at(15, 30), at(16, 30)),
                          event("birthday", at(0), at(0, day: 9), allDay: true)]
            let reminders = [DayRibbon.Reminder(id: "r", title: "report", at: at(16)), DayRibbon.Reminder(id: "old", title: "yesterday", at: at(10, day: 7))]
            let layout = DayRibbon.layout(events: events, reminders: reminders, now: now, calendar: seoul)
            try expect(layout.startHour == 8 && layout.endHour == 24 && layout.labels == [8, 12, 16, 20, 24], "track: \(layout.startHour)–\(layout.endHour) \(layout.labels)")
            try expect(layout.bars.count == 3 && layout.bars[0].past && !layout.bars[1].past && abs(layout.bars[0].from - 1.0 / 16) < 0.0001, "bars")
            try expect(layout.rings.map(\.reminder.id) == ["r"] && abs(layout.rings[0].at - 0.5) < 0.0001 && layout.rings[0].count == 1, "rings: only today's")
            // Reminders within 12 minutes of the first on the track share its ring (same as ribbon.ts).
            let close = [DayRibbon.Reminder(id: "a", title: "a", at: at(16)), DayRibbon.Reminder(id: "b", title: "b", at: at(16, 10)),
                         DayRibbon.Reminder(id: "c", title: "c", at: at(16, 13)), DayRibbon.Reminder(id: "d", title: "d", at: at(16, 20))]
            let merged = DayRibbon.layout(events: [], reminders: close, now: now, calendar: seoul).rings
            try expect(merged.map(\.reminder.id) == ["a", "c"] && merged.map(\.count) == [2, 2], "merged rings: \(merged.map(\.reminder.id)) \(merged.map(\.count))")
            try expect(layout.allDay.map(\.title) == ["birthday"] && abs((layout.now ?? 0) - (6 + 50.0 / 60) / 16) < 0.0001, "all-day, now")
            try expect(layout.current?.title == "standup" && layout.next == DayRibbon.Next(title: "dentist", at: at(15, 30), minutes: 40, isEvent: true), "now/next: \(String(describing: layout.next))")
            try expect(!layout.isEmpty && DayRibbon.layout(events: [], reminders: [], now: now, calendar: seoul).isEmpty, "empty")
        }

        try test("ribbon: earlier and after midnight widen the track; the next reminder when no event is ahead") {
            var layout = DayRibbon.layout(events: [event("run", at(6, 30), at(7, 15))], reminders: [], now: now, calendar: seoul)
            try expect(layout.startHour == 6 && layout.endHour == 24 && layout.labels == [6, 12, 18, 24] && layout.next == nil, "early: \(layout.labels)")
            layout = DayRibbon.layout(events: [event("party", at(22), at(1, day: 9))], reminders: [DayRibbon.Reminder(id: "w", title: "water", at: at(23, 30))], now: now, calendar: seoul)
            try expect(layout.startHour == 8 && layout.endHour == 28 && layout.labels == [8, 12, 18, 24, 28], "late: \(layout.labels)")
            try expect(layout.next?.title == "party" && layout.next?.minutes == 430, "next event")
            layout = DayRibbon.layout(events: [], reminders: [DayRibbon.Reminder(id: "w", title: "water", at: at(23, 30))], now: now, calendar: seoul)
            try expect(layout.next == DayRibbon.Next(title: "water", at: at(23, 30), minutes: 520, isEvent: false) && layout.current == nil, "next reminder")
            try expect(AppLanguage.allCases.map { DayRibbon.away(40, language: $0) } == ["40분 뒤", "in 40 min", "over 40 min"], "away 40")
            try expect(AppLanguage.allCases.map { DayRibbon.away(125, language: $0) } == ["2시간 5분 뒤", "in 2 h 5 min", "over 2 u 5 min"], "away 125")
            try expect(AppLanguage.allCases.map { DayRibbon.away(120, language: $0) } == ["2시간 뒤", "in 2 h", "over 2 u"], "away 120")
            try expect([8, 12, 24, 28].map { DayRibbon.hourLabel($0, language: .en) } == ["8 AM", "12 PM", "12 AM", "4 AM"] && [8, 24, 28].map { DayRibbon.hourLabel($0, language: .nl) } == ["8", "24", "4"], "labels")
            try expect(AppLanguage.allCases.map(DayRibbon.nothingAhead) == ["오늘 남은 일정이 없어요", "Nothing else today", "Verder niets vandaag"], "nothing ahead")
        }

        try test("다음: later reminders and repeats today by time, three at most; overdue and done stay below") {
            let eight = at(8), nine = at(9)
            func item(_ title: String, reminder: Date? = nil, done: Bool = false, series: String? = nil) -> TodoItem {
                var item = TodoItem(title: title, isCompleted: done, createdAt: eight, reminderAt: reminder, seriesID: series)
                if done { item.completedAt = nine }
                return item
            }
            let water = Series(id: "water", title: "water", rule: RepeatRule(kind: .daily), remindAt: "23:30")
            let items = [item("coffee", done: true), item("report", reminder: at(16)), item("late", reminder: at(10)),
                         item("water", series: "water"), item("shop"), item("call", reminder: at(15)), item("tomorrow", reminder: at(9, day: 9)),
                         item("finished", reminder: at(17), done: true), item("email", reminder: at(18))]
            var split = TodayGroups.split(items, series: [water], now: now, calendar: seoul)
            let titles = { (ids: [UUID]) in ids.map { id in items.first { $0.id == id }!.title } }
            try expect(titles(split.next) == ["call", "report", "email"], "next: \(titles(split.next))")
            try expect(titles(split.rest) == ["coffee", "late", "water", "shop", "tomorrow", "finished"] && split.showsHeaders, "rest: \(titles(split.rest))")
            split = TodayGroups.split([items[0], items[1], items[3]], series: [water], now: now, calendar: seoul)
            try expect(titles(split.next) == ["report", "water"] && split.times[items[3].id] == at(23, 30) && !split.showsHeaders, "all open are next: no headers")
            split = TodayGroups.split([items[4]], series: [], now: now, calendar: seoul)
            try expect(split.next.isEmpty && !split.showsHeaders, "nothing next")
        }

        print("\n\(count) intent checks passed.")
    }
}
