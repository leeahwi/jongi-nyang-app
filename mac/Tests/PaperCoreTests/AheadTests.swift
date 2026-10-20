import Foundation

// 앞으로 (Ahead.swift): the same cases as the Windows app (test/ahead.test.ts), listed in
// ahead-cases.md — the rows below are copied from it as written (inputs in its notation, parsed
// here). Framework-free like the other core tests.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private func expectEqual<T: Equatable>(_ actual: T, _ expected: T, _ message: String) throws {
    if actual != expected { throw TestFailure(description: "\(message)\n  expected: \(expected)\n  actual:   \(actual)") }
}

private struct Row {
    var number: Int
    var language: AppLanguage
    /// "" = the fixed now; else "yyyy-MM-dd HH:mm".
    var now: String
    var tasks: String
    var events: String
    var expected: String
    var eyebrow: String
    var summary: String
}

@main
private enum AheadTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        var seoul = Calendar(identifier: .gregorian)
        seoul.timeZone = TimeZone(identifier: "Asia/Seoul")!
        func at(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ min: Int = 0) -> Date {
            seoul.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
        }
        // Thursday 2026-10-08 14:50.
        let thursday = at(2026, 10, 8, 14, 50)

        // Generated from ahead-cases.md (gen_ahead_cases.py): every row, as written there.
        let sharedTasks = "\"회의록 정리\" due=2026-10-09; \"발표 자료 보내기\" due=2026-10-16; \"책 10쪽 읽기\" due=2026-10-11; \"자전거 바람 넣기\" shelf=later; \"오늘 할 일\"; \"끝낸 일\" due=2026-10-09 done; \"세금 신고\" due=2026-11-03; \"연말 정산\" due=2027-01-02; \"겨울옷 정리\" shelf=later; \"마감 지난 일\" due=2026-10-07; \"오늘에 꽂은 일\" due=2026-10-12 shelf=today"
        let sharedEvents = "\"주간 회의\" 2026-10-09 10:00–11:00; \"제주 여행\" 2026-10-10 all-day ×2; \"치과 정기 검진\" 2026-10-13 14:00–15:00; \"스탠드업\" 2026-10-05 09:30–09:45 weekly; \"오늘 일정\" 2026-10-08 16:00–17:00"
        let rows: [Row] = [
            Row(number: 1, language: .ko, now: "", tasks: "A", events: "A",
                expected: "이번 주(1): 금 9 내일 [ev 10:00 주간 회의; td 회의록 정리] · 토 10 [ev 종일 제주 여행] | 다음 주(2): 일 11 [ev 종일 제주 여행; td 책 10쪽 읽기] · 월 12 [ev 09:30 스탠드업] · 화 13 [ev 14:00 치과 정기 검진] · 금 16 [td 발표 자료 보내기] | 그 뒤(2): 11월 [td 세금 신고 @ 11월 3일 (화)] · 2027년 1월 [td 연말 정산 @ 2027년 1월 2일 (토)] | 언젠가(2): [td 자전거 바람 넣기; td 겨울옷 정리]", eyebrow: "이번 주 · 10월 4일 – 10일", summary: "할 일 7 · 일정 4"),
            Row(number: 2, language: .en, now: "", tasks: "A", events: "A",
                expected: "This week(1): Fri 9 Tomorrow [ev 10:00 AM 주간 회의; td 회의록 정리] · Sat 10 [ev All day 제주 여행] | Next week(2): Sun 11 [ev All day 제주 여행; td 책 10쪽 읽기] · Mon 12 [ev 9:30 AM 스탠드업] · Tue 13 [ev 2:00 PM 치과 정기 검진] · Fri 16 [td 발표 자료 보내기] | Later on(2): November [td 세금 신고 @ Tue, Nov 3] · January 2027 [td 연말 정산 @ Sat, Jan 2, 2027] | Someday(2): [td 자전거 바람 넣기; td 겨울옷 정리]", eyebrow: "This week · Oct 4 – 10", summary: "7 to-dos · 4 events"),
            Row(number: 3, language: .nl, now: "", tasks: "A", events: "A",
                expected: "Deze week(2): vr 9 Morgen [ev 10:00 주간 회의; td 회의록 정리] · za 10 [ev Hele dag 제주 여행] · zo 11 [ev Hele dag 제주 여행; td 책 10쪽 읽기] | Volgende week(1): ma 12 [ev 09:30 스탠드업] · di 13 [ev 14:00 치과 정기 검진] · vr 16 [td 발표 자료 보내기] | Daarna(2): november [td 세금 신고 @ di 3 nov] · januari 2027 [td 연말 정산 @ za 2 jan 2027] | Ooit(2): [td 자전거 바람 넣기; td 겨울옷 정리]", eyebrow: "Deze week · 5 – 11 okt", summary: "7 taken · 4 afspraken"),
            Row(number: 4, language: .ko, now: "", tasks: "\"오늘 할 일\"; \"끝낸 일\" due=2026-10-09 done; \"마감 지난 일\" due=2026-10-07", events: "\"오늘 일정\" 2026-10-08 16:00–17:00",
                expected: "[]", eyebrow: "이번 주 · 10월 4일 – 10일", summary: ""),
            Row(number: 5, language: .en, now: "", tasks: "(none)", events: "(none)",
                expected: "[]", eyebrow: "This week · Oct 4 – 10", summary: ""),
            Row(number: 6, language: .nl, now: "", tasks: "(none)", events: "(none)",
                expected: "[]", eyebrow: "Deze week · 5 – 11 okt", summary: ""),
            Row(number: 7, language: .ko, now: "", tasks: "\"A\" due=2026-10-10; \"B\" due=2026-10-11; \"C\" due=2026-10-17; \"D\" due=2026-10-18", events: "(none)",
                expected: "이번 주(1): 토 10 [td A] | 다음 주(2): 일 11 [td B] · 토 17 [td C] | 그 뒤(1): 10월 [td D @ 10월 18일 (일)]", eyebrow: "이번 주 · 10월 4일 – 10일", summary: "할 일 4"),
            Row(number: 8, language: .en, now: "", tasks: "\"A\" due=2026-10-10; \"B\" due=2026-10-11; \"C\" due=2026-10-17; \"D\" due=2026-10-18", events: "(none)",
                expected: "This week(1): Sat 10 [td A] | Next week(2): Sun 11 [td B] · Sat 17 [td C] | Later on(1): October [td D @ Sun, Oct 18]", eyebrow: "This week · Oct 4 – 10", summary: "4 to-dos"),
            Row(number: 9, language: .nl, now: "", tasks: "\"A\" due=2026-10-10; \"B\" due=2026-10-11; \"C\" due=2026-10-17; \"D\" due=2026-10-18", events: "(none)",
                expected: "Deze week(2): za 10 [td A] · zo 11 [td B] | Volgende week(2): za 17 [td C] · zo 18 [td D]", eyebrow: "Deze week · 5 – 11 okt", summary: "4 taken"),
            Row(number: 10, language: .ko, now: "2026-10-10 10:00", tasks: "\"A\" due=2026-10-11; \"B\" due=2026-10-17; \"C\" due=2026-10-18", events: "(none)",
                expected: "다음 주(2): 일 11 내일 [td A] · 토 17 [td B] | 그 뒤(1): 10월 [td C @ 10월 18일 (일)]", eyebrow: "이번 주 · 10월 4일 – 10일", summary: "할 일 3"),
            Row(number: 11, language: .en, now: "2026-10-10 10:00", tasks: "\"A\" due=2026-10-11; \"B\" due=2026-10-17; \"C\" due=2026-10-18", events: "(none)",
                expected: "Next week(2): Sun 11 Tomorrow [td A] · Sat 17 [td B] | Later on(1): October [td C @ Sun, Oct 18]", eyebrow: "This week · Oct 4 – 10", summary: "3 to-dos"),
            Row(number: 12, language: .nl, now: "2026-10-10 10:00", tasks: "\"A\" due=2026-10-11; \"B\" due=2026-10-17; \"C\" due=2026-10-18", events: "(none)",
                expected: "Deze week(1): zo 11 Morgen [td A] | Volgende week(2): za 17 [td B] · zo 18 [td C]", eyebrow: "Deze week · 5 – 11 okt", summary: "3 taken"),
            Row(number: 13, language: .ko, now: "2026-10-09 02:00", tasks: "\"A\" due=2026-10-09", events: "\"아침 운동\" 2026-10-09 07:00–08:00; \"밤 영화\" 2026-10-10 01:30–03:00; \"새벽 기차\" 2026-10-09 03:00–04:00",
                expected: "이번 주(1): 금 9 내일 [ev 07:00 아침 운동; ev 01:30 밤 영화; td A]", eyebrow: "이번 주 · 10월 4일 – 10일", summary: "할 일 1 · 일정 2"),
            Row(number: 14, language: .en, now: "2026-10-09 02:00", tasks: "\"A\" due=2026-10-09", events: "\"아침 운동\" 2026-10-09 07:00–08:00; \"밤 영화\" 2026-10-10 01:30–03:00; \"새벽 기차\" 2026-10-09 03:00–04:00",
                expected: "This week(1): Fri 9 Tomorrow [ev 7:00 AM 아침 운동; ev 1:30 AM 밤 영화; td A]", eyebrow: "This week · Oct 4 – 10", summary: "1 to-do · 2 events"),
            Row(number: 15, language: .nl, now: "2026-10-09 02:00", tasks: "\"A\" due=2026-10-09", events: "\"아침 운동\" 2026-10-09 07:00–08:00; \"밤 영화\" 2026-10-10 01:30–03:00; \"새벽 기차\" 2026-10-09 03:00–04:00",
                expected: "Deze week(1): vr 9 Morgen [ev 07:00 아침 운동; ev 01:30 밤 영화; td A]", eyebrow: "Deze week · 5 – 11 okt", summary: "1 taak · 2 afspraken"),
            Row(number: 16, language: .ko, now: "", tasks: "\"B\" due=2026-10-13; \"A\" due=2026-10-13; \"C\" due=2026-10-13 done", events: "\"Lunch\" 2026-10-13 12:00–13:00; \"Beach day\" 2026-10-13 all-day; \"Breakfast\" 2026-10-13 08:00–09:00; \"Anniversary\" 2026-10-13 all-day",
                expected: "다음 주(2): 화 13 [ev 종일 Anniversary; ev 종일 Beach day; ev 08:00 Breakfast; ev 12:00 Lunch; td B; td A]", eyebrow: "이번 주 · 10월 4일 – 10일", summary: "할 일 2 · 일정 4"),
            Row(number: 17, language: .en, now: "", tasks: "\"B\" due=2026-10-13; \"A\" due=2026-10-13; \"C\" due=2026-10-13 done", events: "\"Lunch\" 2026-10-13 12:00–13:00; \"Beach day\" 2026-10-13 all-day; \"Breakfast\" 2026-10-13 08:00–09:00; \"Anniversary\" 2026-10-13 all-day",
                expected: "Next week(2): Tue 13 [ev All day Anniversary; ev All day Beach day; ev 8:00 AM Breakfast; ev 12:00 PM Lunch; td B; td A]", eyebrow: "This week · Oct 4 – 10", summary: "2 to-dos · 4 events"),
            Row(number: 18, language: .nl, now: "", tasks: "\"B\" due=2026-10-13; \"A\" due=2026-10-13; \"C\" due=2026-10-13 done", events: "\"Lunch\" 2026-10-13 12:00–13:00; \"Beach day\" 2026-10-13 all-day; \"Breakfast\" 2026-10-13 08:00–09:00; \"Anniversary\" 2026-10-13 all-day",
                expected: "Volgende week(2): di 13 [ev Hele dag Anniversary; ev Hele dag Beach day; ev 08:00 Breakfast; ev 12:00 Lunch; td B; td A]", eyebrow: "Deze week · 5 – 11 okt", summary: "2 taken · 4 afspraken"),
            Row(number: 19, language: .ko, now: "", tasks: "\"C\" due=2027-01-05; \"A\" due=2026-11-20; \"B\" due=2026-11-02; \"D\" due=2026-12-31; \"E\" due=2026-11-02", events: "(none)",
                expected: "그 뒤(5): 11월 [td B @ 11월 2일 (월); td E @ 11월 2일 (월); td A @ 11월 20일 (금)] · 12월 [td D @ 12월 31일 (목)] · 2027년 1월 [td C @ 2027년 1월 5일 (화)]", eyebrow: "이번 주 · 10월 4일 – 10일", summary: "할 일 5"),
            Row(number: 20, language: .en, now: "", tasks: "\"C\" due=2027-01-05; \"A\" due=2026-11-20; \"B\" due=2026-11-02; \"D\" due=2026-12-31; \"E\" due=2026-11-02", events: "(none)",
                expected: "Later on(5): November [td B @ Mon, Nov 2; td E @ Mon, Nov 2; td A @ Fri, Nov 20] · December [td D @ Thu, Dec 31] · January 2027 [td C @ Tue, Jan 5, 2027]", eyebrow: "This week · Oct 4 – 10", summary: "5 to-dos"),
            Row(number: 21, language: .nl, now: "", tasks: "\"C\" due=2027-01-05; \"A\" due=2026-11-20; \"B\" due=2026-11-02; \"D\" due=2026-12-31; \"E\" due=2026-11-02", events: "(none)",
                expected: "Daarna(5): november [td B @ ma 2 nov; td E @ ma 2 nov; td A @ vr 20 nov] · december [td D @ do 31 dec] · januari 2027 [td C @ di 5 jan 2027]", eyebrow: "Deze week · 5 – 11 okt", summary: "5 taken"),
            Row(number: 22, language: .ko, now: "", tasks: "\"Someday task\" shelf=later", events: "\"Yoga\" 2026-09-30 19:00–20:00 weekly; \"Concert\" 2026-10-25 20:00–22:00",
                expected: "다음 주(0): 수 14 [ev 19:00 Yoga] | 언젠가(1): [td Someday task]", eyebrow: "이번 주 · 10월 4일 – 10일", summary: "할 일 1 · 일정 1"),
            Row(number: 23, language: .en, now: "", tasks: "\"Someday task\" shelf=later", events: "\"Yoga\" 2026-09-30 19:00–20:00 weekly; \"Concert\" 2026-10-25 20:00–22:00",
                expected: "Next week(0): Wed 14 [ev 7:00 PM Yoga] | Someday(1): [td Someday task]", eyebrow: "This week · Oct 4 – 10", summary: "1 to-do · 1 event"),
            Row(number: 24, language: .nl, now: "", tasks: "\"Someday task\" shelf=later", events: "\"Yoga\" 2026-09-30 19:00–20:00 weekly; \"Concert\" 2026-10-25 20:00–22:00",
                expected: "Volgende week(0): wo 14 [ev 19:00 Yoga] | Ooit(1): [td Someday task]", eyebrow: "Deze week · 5 – 11 okt", summary: "1 taak · 1 afspraak"),
            Row(number: 25, language: .ko, now: "", tasks: "\"Later dated\" due=2026-10-09 shelf=later; \"Pinned\" due=2026-10-09 shelf=today; \"Overdue\" due=2026-10-01", events: "\"\" 2026-10-09 all-day",
                expected: "이번 주(1): 금 9 내일 [ev 종일 (제목 없음); td Later dated]", eyebrow: "이번 주 · 10월 4일 – 10일", summary: "할 일 1 · 일정 1"),
            Row(number: 26, language: .en, now: "", tasks: "\"Later dated\" due=2026-10-09 shelf=later; \"Pinned\" due=2026-10-09 shelf=today; \"Overdue\" due=2026-10-01", events: "\"\" 2026-10-09 all-day",
                expected: "This week(1): Fri 9 Tomorrow [ev All day (No title); td Later dated]", eyebrow: "This week · Oct 4 – 10", summary: "1 to-do · 1 event"),
            Row(number: 27, language: .nl, now: "", tasks: "\"Later dated\" due=2026-10-09 shelf=later; \"Pinned\" due=2026-10-09 shelf=today; \"Overdue\" due=2026-10-01", events: "\"\" 2026-10-09 all-day",
                expected: "Deze week(1): vr 9 Morgen [ev Hele dag (Geen titel); td Later dated]", eyebrow: "Deze week · 5 – 11 okt", summary: "1 taak · 1 afspraak"),
            Row(number: 28, language: .ko, now: "", tasks: "(none)", events: "\"Trip\" 2026-10-08 all-day ×4",
                expected: "이번 주(0): 금 9 내일 [ev 종일 Trip] · 토 10 [ev 종일 Trip] | 다음 주(0): 일 11 [ev 종일 Trip]", eyebrow: "이번 주 · 10월 4일 – 10일", summary: "일정 1"),
            Row(number: 29, language: .en, now: "", tasks: "(none)", events: "\"Trip\" 2026-10-08 all-day ×4",
                expected: "This week(0): Fri 9 Tomorrow [ev All day Trip] · Sat 10 [ev All day Trip] | Next week(0): Sun 11 [ev All day Trip]", eyebrow: "This week · Oct 4 – 10", summary: "1 event"),
            Row(number: 30, language: .nl, now: "", tasks: "(none)", events: "\"Trip\" 2026-10-08 all-day ×4",
                expected: "Deze week(0): vr 9 Morgen [ev Hele dag Trip] · za 10 [ev Hele dag Trip] · zo 11 [ev Hele dag Trip]", eyebrow: "Deze week · 5 – 11 okt", summary: "1 afspraak"),
            Row(number: 31, language: .ko, now: "2026-10-11 10:00", tasks: "\"A\" due=2026-10-12; \"B\" due=2026-10-18", events: "(none)",
                expected: "이번 주(1): 월 12 내일 [td A] | 다음 주(1): 일 18 [td B]", eyebrow: "이번 주 · 10월 11일 – 17일", summary: "할 일 2"),
            Row(number: 32, language: .en, now: "2026-10-11 10:00", tasks: "\"A\" due=2026-10-12; \"B\" due=2026-10-18", events: "(none)",
                expected: "This week(1): Mon 12 Tomorrow [td A] | Next week(1): Sun 18 [td B]", eyebrow: "This week · Oct 11 – 17", summary: "2 to-dos"),
            Row(number: 33, language: .nl, now: "2026-10-11 10:00", tasks: "\"A\" due=2026-10-12; \"B\" due=2026-10-18", events: "(none)",
                expected: "Volgende week(2): ma 12 Morgen [td A] · zo 18 [td B]", eyebrow: "Deze week · 5 – 11 okt", summary: "2 taken"),
            Row(number: 34, language: .ko, now: "", tasks: "\"끝냄\" due=2026-10-12 done; \"오늘로 핀\" due=2026-10-12 shelf=today; \"지난 마감\" due=2026-10-07; \"오늘 마감\" due=2026-10-08; \"그냥 할 일\"; \"나중 1\" shelf=later; \"마감 있는 나중\" due=2026-10-12 shelf=later; \"나중 2\" shelf=later; \"끝낸 나중\" shelf=later done", events: "(none)",
                expected: "다음 주(1): 월 12 [td 마감 있는 나중] | 언젠가(2): [td 나중 1; td 나중 2]", eyebrow: "이번 주 · 10월 4일 – 10일", summary: "할 일 3"),
            Row(number: 35, language: .en, now: "", tasks: "\"끝냄\" due=2026-10-12 done; \"오늘로 핀\" due=2026-10-12 shelf=today; \"지난 마감\" due=2026-10-07; \"오늘 마감\" due=2026-10-08; \"그냥 할 일\"; \"나중 1\" shelf=later; \"마감 있는 나중\" due=2026-10-12 shelf=later; \"나중 2\" shelf=later; \"끝낸 나중\" shelf=later done", events: "(none)",
                expected: "Next week(1): Mon 12 [td 마감 있는 나중] | Someday(2): [td 나중 1; td 나중 2]", eyebrow: "This week · Oct 4 – 10", summary: "3 to-dos"),
            Row(number: 36, language: .nl, now: "", tasks: "\"끝냄\" due=2026-10-12 done; \"오늘로 핀\" due=2026-10-12 shelf=today; \"지난 마감\" due=2026-10-07; \"오늘 마감\" due=2026-10-08; \"그냥 할 일\"; \"나중 1\" shelf=later; \"마감 있는 나중\" due=2026-10-12 shelf=later; \"나중 2\" shelf=later; \"끝낸 나중\" shelf=later done", events: "(none)",
                expected: "Volgende week(1): ma 12 [td 마감 있는 나중] | Ooit(2): [td 나중 1; td 나중 2]", eyebrow: "Deze week · 5 – 11 okt", summary: "3 taken"),
            Row(number: 37, language: .ko, now: "", tasks: "(none)", events: "\"휴가\" 2026-10-16 all-day ×5; \"학회\" 2026-10-07 all-day ×3; \"늦은 회의\" 2026-10-09 23:00–00:30; \"새벽 일정\" 2026-10-10 00:30–01:00",
                expected: "이번 주(0): 금 9 내일 [ev 종일 학회; ev 23:00 늦은 회의; ev 00:30 새벽 일정] | 다음 주(0): 금 16 [ev 종일 휴가] · 토 17 [ev 종일 휴가]", eyebrow: "이번 주 · 10월 4일 – 10일", summary: "일정 4"),
            Row(number: 38, language: .en, now: "", tasks: "(none)", events: "\"휴가\" 2026-10-16 all-day ×5; \"학회\" 2026-10-07 all-day ×3; \"늦은 회의\" 2026-10-09 23:00–00:30; \"새벽 일정\" 2026-10-10 00:30–01:00",
                expected: "This week(0): Fri 9 Tomorrow [ev All day 학회; ev 11:00 PM 늦은 회의; ev 12:30 AM 새벽 일정] | Next week(0): Fri 16 [ev All day 휴가] · Sat 17 [ev All day 휴가]", eyebrow: "This week · Oct 4 – 10", summary: "4 events"),
            Row(number: 39, language: .nl, now: "", tasks: "(none)", events: "\"휴가\" 2026-10-16 all-day ×5; \"학회\" 2026-10-07 all-day ×3; \"늦은 회의\" 2026-10-09 23:00–00:30; \"새벽 일정\" 2026-10-10 00:30–01:00",
                expected: "Deze week(0): vr 9 Morgen [ev Hele dag 학회; ev 23:00 늦은 회의; ev 00:30 새벽 일정] | Volgende week(0): vr 16 [ev Hele dag 휴가] · za 17 [ev Hele dag 휴가] · zo 18 [ev Hele dag 휴가]", eyebrow: "Deze week · 5 – 11 okt", summary: "4 afspraken"),
            Row(number: 40, language: .ko, now: "2026-12-31 12:00", tasks: "\"새해 계획\" due=2027-01-01; \"보험 갱신\" due=2027-01-20", events: "(none)",
                expected: "이번 주(1): 금 1 내일 [td 새해 계획] | 그 뒤(1): 2027년 1월 [td 보험 갱신 @ 2027년 1월 20일 (수)]", eyebrow: "이번 주 · 2026년 12월 27일 – 2027년 1월 2일", summary: "할 일 2"),
            Row(number: 41, language: .en, now: "2026-12-31 12:00", tasks: "\"새해 계획\" due=2027-01-01; \"보험 갱신\" due=2027-01-20", events: "(none)",
                expected: "This week(1): Fri 1 Tomorrow [td 새해 계획] | Later on(1): January 2027 [td 보험 갱신 @ Wed, Jan 20, 2027]", eyebrow: "This week · Dec 27, 2026 – Jan 2, 2027", summary: "2 to-dos"),
            Row(number: 42, language: .nl, now: "2026-12-31 12:00", tasks: "\"새해 계획\" due=2027-01-01; \"보험 갱신\" due=2027-01-20", events: "(none)",
                expected: "Deze week(1): vr 1 Morgen [td 새해 계획] | Daarna(1): januari 2027 [td 보험 갱신 @ wo 20 jan 2027]", eyebrow: "Deze week · 28 dec 2026 – 3 jan 2027", summary: "2 taken"),
            Row(number: 43, language: .ko, now: "2026-09-30 12:00", tasks: "(none)", events: "(none)",
                expected: "[]", eyebrow: "이번 주 · 9월 27일 – 10월 3일", summary: ""),
            Row(number: 44, language: .en, now: "2026-09-30 12:00", tasks: "(none)", events: "(none)",
                expected: "[]", eyebrow: "This week · Sep 27 – Oct 3", summary: ""),
            Row(number: 45, language: .nl, now: "2026-09-30 12:00", tasks: "(none)", events: "(none)",
                expected: "[]", eyebrow: "Deze week · 28 sep – 4 okt", summary: ""),
        ]
        let movedRows: [(String, AppLanguage, String, String)] = [
            ("M1", .ko, "day 2026-10-09", "10월 9일로 옮겼어요"),
            ("M2", .en, "day 2026-10-09", "Moved to Oct 9"),
            ("M3", .nl, "day 2026-10-09", "Verplaatst naar 9 okt"),
            ("M4", .ko, "day 2027-01-02", "2027년 1월 2일로 옮겼어요"),
            ("M5", .en, "day 2027-01-02", "Moved to Jan 2, 2027"),
            ("M6", .nl, "day 2027-01-02", "Verplaatst naar 2 jan 2027"),
            ("M7", .ko, "someday", "언젠가로 옮겼어요"),
            ("M8", .en, "someday", "Moved to Someday"),
            ("M9", .nl, "someday", "Verplaatst naar Ooit"),
            ("M10", .ko, "today", "오늘로 옮겼어요"),
            ("M11", .en, "today", "Moved to Today"),
            ("M12", .nl, "today", "Verplaatst naar Vandaag"),
        ]
        let emptyRows: [(String, AppLanguage, String)] = [
            ("E1", .ko, "앞으로 할 일이 없어요. 아래에 “금요일까지 보고서”처럼 적어 보세요."),
            ("E2", .en, "Nothing ahead. Try typing ‘report by Friday’ below."),
            ("E3", .nl, "Niets vooruit. Typ hieronder bijv. ‘verslag voor vrijdag’."),
        ]

        // MARK: Reading the notation

        func moment(_ text: String) -> Date {
            guard !text.isEmpty else { return thursday }
            let n = text.split(whereSeparator: { "- :".contains($0) }).map { Int($0)! }
            return at(n[0], n[1], n[2], n[3], n[4])
        }
        func split(_ list: String) -> [String] {
            list == "(none)" ? [] : list.components(separatedBy: "; ").filter { !$0.isEmpty }
        }
        func quoted(_ entry: String) -> (title: String, rest: [String]) {
            let parts = entry.components(separatedBy: "\"")
            return (parts[1], parts[2].split(separator: " ").map(String.init))
        }
        func tasks(_ list: String) -> [TodoItem] {
            split(list == "A" ? sharedTasks : list).map { entry in
                let (title, rest) = quoted(entry)
                var item = TodoItem(title: title, createdAt: thursday)
                for token in rest {
                    if token.hasPrefix("due=") { item.dueDate = String(token.dropFirst(4)) }
                    if token == "shelf=later" { item.shelf = .later }
                    if token == "shelf=today" { item.shelf = .today }
                    if token == "done" { item.isCompleted = true; item.completedAt = thursday }
                }
                return item
            }
        }
        func events(_ list: String) -> [LocalEvent] {
            split(list == "A" ? sharedEvents : list).enumerated().map { index, entry in
                let (title, rest) = quoted(entry)
                var event = LocalEvent(id: "e\(index)", title: title, date: rest[0], createdAt: thursday)
                for token in rest.dropFirst() {
                    if token == "all-day" { event.allDay = true }
                    if token.hasPrefix("×") { event.days = Int(token.dropFirst())! }
                    if token == "weekly" { event.repeatRule = .weekly }
                    if token.contains("–") {
                        let times = token.components(separatedBy: "–").map { $0.split(separator: ":").map { Int($0)! } }
                        event.start = times[0][0] * 60 + times[0][1]
                        event.end = times[1][0] * 60 + times[1][1]
                    }
                }
                return event
            }
        }

        /// The occurrences the note hands over: from today's midnight to well after next week.
        func sections(_ items: [TodoItem], _ events: [LocalEvent], now: Date, _ language: AppLanguage) -> [Ahead.Section] {
            let week = Ahead.week(of: now, calendar: seoul, language: language)
            let from = seoul.startOfDay(for: Archive.logicalDayStart(now, calendar: seoul))
            let to = seoul.date(byAdding: .day, value: 9, to: Deadline.date(from: week.last, calendar: seoul)!)!
            let occurrences = LocalEvent.expand(events, from: from, to: to, calendar: seoul, language: language)
            return Ahead.sections(items: items, events: occurrences, now: now, calendar: seoul, language: language)
        }

        /// The cases' notation for what came out.
        func describe(_ sections: [Ahead.Section], _ items: [TodoItem], now: Date, _ language: AppLanguage) -> String {
            guard !sections.isEmpty else { return "[]" }
            let byID = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
            return sections.map { section in
                let body: String
                switch section.kind {
                case .thisWeek, .nextWeek:
                    body = section.days.map { day in
                        let entries = day.events.map { "ev \(Ahead.eventTime($0, calendar: seoul, language: language)) \($0.title)" }
                            + day.tasks.map { "td \(byID[$0]!.title)" }
                        return Ahead.dayLabel(day, language: language) + (day.relative.map { " \($0)" } ?? "") + " [" + entries.joined(separator: "; ") + "]"
                    }.joined(separator: " · ")
                case .later:
                    body = section.months.map { month in
                        month.title + " [" + month.tasks.map { id in
                            "td \(byID[id]!.title) @ " + Ahead.dateText(byID[id]!.dueDate!, now: now, calendar: seoul, language: language)
                        }.joined(separator: "; ") + "]"
                    }.joined(separator: " · ")
                case .someday:
                    body = "[" + section.tasks.map { "td \(byID[$0]!.title)" }.joined(separator: "; ") + "]"
                }
                return "\(section.title)(\(section.count)): \(body)"
            }.joined(separator: " | ")
        }

        // MARK: The cases

        try test("sections: every row of ahead-cases.md (\(rows.count) rows, ko · en · nl)") {
            for row in rows {
                let now = moment(row.now)
                let items = tasks(row.tasks)
                let result = sections(items, events(row.events), now: now, row.language)
                try expectEqual(describe(result, items, now: now, row.language), row.expected, "row \(row.number) (\(row.language.rawValue))")
                try expectEqual(Ahead.weekTitle(now: now, calendar: seoul, language: row.language), row.eyebrow, "row \(row.number) eyebrow")
                try expectEqual(Ahead.summary(todos: Ahead.count(result), events: Ahead.eventCount(result), language: row.language), row.summary,
                                "row \(row.number) summary")
            }
            for language in AppLanguage.allCases {
                try expect(rows.filter { $0.language == language }.count >= 10, "at least ten rows in \(language.rawValue)")
            }
        }

        try test("moved: the toast after a drop (M rows)") {
            for (number, language, destination, text) in movedRows {
                let place: Ahead.Destination = destination == "someday" ? .someday : destination == "today" ? .today
                    : .day(String(destination.dropFirst(4)))
                try expectEqual(Ahead.movedText(place, now: thursday, calendar: seoul, language: language), text, "row \(number)")
            }
        }

        try test("empty sheet text (E rows)") {
            for (number, language, text) in emptyRows {
                try expectEqual(Ahead.emptyText(language), text, "row \(number)")
            }
        }

        try test("count and badge: open tasks only; events counted once however many days they cover") {
            let items = tasks("A")
            let result = sections(items, events("A"), now: thursday, .ko)
            try expectEqual(result.map(\.count), [1, 2, 2, 2], "section counts")
            try expectEqual(Ahead.count(result), 7, "badge")
            try expectEqual(Ahead.eventCount(result), 4, "events")
            try expect(items.filter { Ahead.isAhead($0, now: thursday, calendar: seoul) }.count == 7, "isAhead")
        }

        try test("weeks: the week holding today per language, by the 4 a.m. day") {
            try expect(Ahead.week(of: thursday, calendar: seoul, language: .ko) == ("2026-10-04", "2026-10-10"), "ko week")
            try expect(Ahead.week(of: thursday, calendar: seoul, language: .nl) == ("2026-10-05", "2026-10-11"), "nl week")
            // Sunday 02:00 is still Saturday's day; Monday 03:00 still Sunday's.
            try expect(Ahead.week(of: at(2026, 10, 11, 2), calendar: seoul, language: .ko) == ("2026-10-04", "2026-10-10"), "ko Sunday night")
            try expect(Ahead.week(of: at(2026, 10, 12, 3), calendar: seoul, language: .nl) == ("2026-10-05", "2026-10-11"), "nl Monday night")
        }

        // MARK: 오늘 창 and the menu bar (TodayGlance; Mac checks)

        try test("today window: what's within the hour, the menu bar's words, the cards' lines") {
            func event(_ title: String, minutes: Double, allDay: Bool = false) -> CalendarEvent {
                CalendarEvent(key: title, calendarId: "local", title: title, allDay: allDay, start: thursday.addingTimeInterval(minutes * 60),
                              end: thursday.addingTimeInterval((minutes + 60) * 60), color: "#5b8bd0")
            }
            let dentist = event("치과", minutes: 40)
            try expect(TodayGlance.soon(events: [dentist, event("저녁", minutes: 70)], reminders: [], now: thursday)
                       == TodayGlance.Soon(title: "치과", at: dentist.start, minutes: 40, isEvent: true), "an event within the hour")
            try expect(TodayGlance.soon(events: [event("저녁", minutes: 70), event("휴가", minutes: 10, allDay: true), event("지난", minutes: -5)],
                                        reminders: [], now: thursday) == nil, "nothing within the hour (all-day and past don't count)")
            let pill = DayRibbon.Reminder(id: "p", title: "약", at: thursday.addingTimeInterval(30 * 60))
            try expect(TodayGlance.soon(events: [dentist], reminders: [pill], now: thursday)?.title == "약", "a reminder before the event")
            let same = DayRibbon.Reminder(id: "s", title: "준비", at: dentist.start)
            try expect(TodayGlance.soon(events: [dentist], reminders: [same], now: thursday)?.isEvent == true, "at the same time, the event")
            let soon = TodayGlance.soon(events: [dentist], reminders: [], now: thursday)
            try expectEqual(AppLanguage.allCases.map { TodayGlance.menuBarText(timerRemaining: nil, soon: TodayGlance.Soon(title: ["치과", "Dentist", "Tandarts"][AppLanguage.allCases.firstIndex(of: $0)!], at: dentist.start, minutes: 40, isEvent: true), language: $0) },
                            ["치과 40분", "Dentist 40 min", "Tandarts 40 min"], "soon words")
            try expectEqual(TodayGlance.menuBarText(timerRemaining: 750, soon: soon, language: .ko), "12:30", "a running timer comes first")
            try expectEqual(TodayGlance.menuBarText(timerRemaining: nil, soon: nil, language: .en), "", "nothing near: no words")
            try expectEqual(TodayGlance.shortTitle("치과 정기 검진과 스케일링 예약"), "치과 정기 검진과 스케…", "12 characters and …")
            try expectEqual(TodayGlance.shortTitle("Dentist"), "Dentist", "short titles stay")
            try expectEqual(TodayGlance.eventLine(title: "Dentist", minutes: 40, language: .en), "in\u{00A0}40\u{00A0}min\u{00A0}· Dentist", "event line")
            let seven = at(2026, 10, 9, 7)
            try expectEqual(AppLanguage.allCases.map { TodayGlance.alarmLine(fire: seven, days: [1, 2, 3, 4, 5], now: thursday, calendar: seoul, language: $0) },
                            ["내일\u{00A0}· 평일", "Tomorrow\u{00A0}· Weekdays", "Morgen\u{00A0}· Doordeweeks"], "alarm line")
            try expectEqual(TodayGlance.alarmLine(fire: at(2026, 10, 12, 7), days: [], now: thursday, calendar: seoul, language: .ko), "월\u{00A0}· 한 번", "a later day by its weekday")
            try expectEqual(TodayGlance.accessibilityText(appName: "종이냥", timerRemaining: 750, soon: soon, openTasks: 3, language: .ko),
                            "종이냥 · 타이머 12:30 남음 · 치과 40분 뒤 · 오늘 할 일 3개 남음", "the full state for VoiceOver")
            try expectEqual(TodayGlance.accessibilityText(appName: "Jongi-nyang", timerRemaining: nil, soon: nil, openTasks: 1, language: .en),
                            "Jongi-nyang · 1 to-do left today", "en")
            try expectEqual(TodayGlance.accessibilityText(appName: "Jongi-nyang", timerRemaining: nil, soon: nil, openTasks: 0, language: .nl),
                            "Jongi-nyang · Niets meer voor vandaag", "nl")
        }

        print("\(count) Ahead checks passed (\(rows.count) case rows, \(movedRows.count) moved, \(emptyRows.count) empty)")
    }
}
