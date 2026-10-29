import AppKit
import CoreText
import PaperCore

/// The app layer in each language: run once per language (scripts/test-localization.sh sets
/// PAPERTODO_LANG and puts the translation tables next to the binary, like the app's bundle).
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expectEqual<T: Equatable>(_ actual: T, _ expected: T, _ message: String) throws {
    if actual != expected { throw TestFailure(description: "\(message): expected \(expected), got \(actual)") }
}

private func expect(_ condition: Bool, _ message: String) throws {
    if !condition { throw TestFailure(description: message) }
}

@main
@MainActor
private enum LocalizationTests {
    static func main() throws {
        // The setting, before the run's language is fixed: "auto" picks the first language the
        // app speaks from the Mac's list, else English; a chosen language wins.
        for (setting, preferred, expected) in [
            ("auto", ["de-DE", "nl-NL", "ko-KR"], AppLanguage.nl),
            ("auto", ["fr-FR", "ja-JP"], .en),
            ("auto", ["ko-KR", "en-US"], .ko),
            ("en", ["ko-KR"], .en),
            ("nl", ["en-GB"], .nl),
            ("klingon", ["en-GB"], .en),
        ] as [(String, [String], AppLanguage)] {
            L10n.activate(setting: setting, preferred: preferred)
            try expectEqual(L10n.language, expected, "\(setting) with \(preferred)")
        }

        let language = AppLanguage(rawValue: ProcessInfo.processInfo.environment["PAPERTODO_LANG"] ?? "ko") ?? .ko
        L10n.activate(setting: language.rawValue, preferred: [])
        try expectEqual(Bundle.main.preferredLocalizations.first, language.rawValue, "bundle language")
        func pick(_ ko: String, _ en: String, _ nl: String) -> String { [ko, en, nl][AppLanguage.allCases.firstIndex(of: language)!] }
        var count = 0
        func test(_ name: String, _ body: () throws -> Void) throws {
            try body()
            count += 1
            print("PASS [\(language.rawValue)] \(name)")
        }

        try test("plain texts and menus") {
            try expectEqual(L("새 할 일"), pick("새 할 일", "New to-do", "Nieuwe taak"), "new to-do")
            try expectEqual(L("종이냥 종료"), pick("종이냥 종료", "Quit Jongi-nyang", "Stop Jongi-nyang"), "quit")
            try expectEqual(PaperTheme.mascotName, pick("종이냥", "Jongi-nyang", "Jongi-nyang"), "app name")
            try expectEqual(PageTab.all.map(\.short), [pick("오늘", "Today", "Vandaag"), pick("앞으로", "Ahead", "Vooruit")], "tabs (메모 is the drawer from 1.43)")
            try expectEqual(L("메모 서랍"), pick("메모 서랍", "Notes drawer", "Notitielade"), "the drawer")
            try expectEqual(NotebookFont.allCases.map(\.title), [pick("손글씨 펜", "Pen", "Pen"), pick("손글씨 붓", "Marker", "Stift"),
                                                                pick("기본 글씨", "Clean", "Strak")], "fonts")
        }

        try test("placeholders, reordered") {
            try expectEqual(L("\(3)개 중 \(1)개 끝냈어요, \(2)개 남았어요"),
                            pick("3개 중 1개 끝냈어요, 2개 남았어요", "1 of 3 done, 2 left", "1 van 3 klaar, nog 2"), "progress")
            try expectEqual(L("\("macOS 1.32.0")에서 \("Oct 8, 3:30 PM") 내보냄"),
                            pick("macOS 1.32.0에서 Oct 8, 3:30 PM 내보냄", "Exported from macOS 1.32.0 on Oct 8, 3:30 PM",
                                 "Geëxporteerd uit macOS 1.32.0 op Oct 8, 3:30 PM"), "backup origin")
        }

        try test("counts: one and more") {
            try expectEqual(L("오늘 고친 메모 \(1)장"), pick("오늘 고친 메모 1장", "1 note changed today", "1 notitie vandaag gewijzigd"), "one note (the drawer's handle)")
            try expectEqual(L("오늘 고친 메모 \(3)장"), pick("오늘 고친 메모 3장", "3 notes changed today", "3 notities vandaag gewijzigd"), "notes")
            try expectEqual(L("\(1)시간마다"), pick("1시간마다", "Every hour", "Elk uur"), "every hour")
            try expectEqual(L("\(2)시간마다"), pick("2시간마다", "Every 2 hours", "Elke 2 uur"), "every 2 hours")
            try expectEqual(L("오늘 할 일 \(1)개를 모두 끝냈어요"), pick("오늘 할 일 1개를 모두 끝냈어요", "Today’s to-do is done", "De taak van vandaag is klaar"), "one done")
        }

        try test("the same Korean, a second meaning in its own table") {
            try expectEqual(String(localized: "일시정지", table: "Timer"), pick("일시정지", "Paused", "Gepauzeerd"), "paused")
            try expectEqual(L("일시정지"), pick("일시정지", "Pause", "Pauzeren"), "pause")
            try expectEqual(String(localized: "\("October") 완료", table: "History"), pick("October 완료", "Done in October", "Klaar in October"), "month done")
            try expectEqual(L("\("Read") 완료"), pick("Read 완료", "Mark Read done", "Read afvinken"), "checkbox")
        }

        try test("timer length, quick note and alarms (glossary)") {
            try expectEqual(L("직접 정하기…"), pick("직접 정하기…", "Custom…", "Zelf instellen…"), "custom timer")
            try expectEqual(L("빠른 메모"), pick("빠른 메모", "Quick note", "Snelle notitie"), "quick note")
            try expectEqual(L("\(10)분째 울리는 중"), pick("10분째 울리는 중", "Ringing for 10 min", "Gaat al 10 min"), "ringing")
            try expectEqual(L("\(2) / \(5) 끝냈어요"), pick("2 / 5 끝냈어요", "2 of 5 done", "2 van 5 klaar"), "progress")
            try expectEqual(L("끄기"), pick("끄기", "Stop", "Stoppen"), "stop")
            try expectEqual(L("다음 알람 \(Alarm.timeText(Alarm(time: "07:00"), language: language))"),
                            pick("다음 알람 오전 7:00", "Next alarm 7:00 AM", "Volgende wekker 07:00"), "next alarm")
            try expectEqual(DeskPane.clock.title, pick("시계", "Clock", "Klok"), "desk pane")
            try expectEqual(String(localized: "완료", table: "Settings"), pick("완료", "Done", "Klaar"), "the editor's done")
            try expectEqual(L("완료"), pick("완료", "Mark done", "Afvinken"), "mark done stays")
            try expectEqual(L("예: 40 또는 1:30"), pick("예: 40 또는 1:30", "e.g. 40 or 1:30", "bijv. 40 of 1:30"), "placeholder")
            try expectEqual(L("쓰던 글은 남아요"), pick("쓰던 글은 남아요", "your text stays", "je tekst blijft"), "quick note context")
            try expectEqual(L("무엇이든 적어요: 할 일, 일정, ‘타이머 40’"),
                            pick("무엇이든 적어요: 할 일, 일정, ‘타이머 40’", "Type anything: a to-do, an event, ‘timer 40’", "Typ wat je wilt: een taak, afspraak, ‘timer 40’"), "input line")
            try expectEqual(L("하루 띠 보이기"), pick("하루 띠 보이기", "Show day ribbon", "Daglint tonen"), "day ribbon setting")
            try expectEqual(L("알람이 없어요. 아침 기상이나 약 먹을 시간을 맞춰 보세요."),
                            pick("알람이 없어요. 아침 기상이나 약 먹을 시간을 맞춰 보세요.", "No alarms yet. Set one for waking up or taking medicine.",
                                 "Nog geen wekkers. Zet er een om op te staan of je medicijnen te nemen."), "no alarms")
        }

        try test("the desk and night paper (glossary)") {
            try expectEqual(DeskPane.calendar.windowTitle, pick("달력", "Calendar", "Kalender"), "window title (#73: just the pane's name, not ‘책상 — 달력’)")
            try expectEqual(DeskPane.notifications.title, pick("알림", "Reminders", "Herinneringen"), "reminders pane (its own table)")
            try expectEqual(L("알림"), pick("알림", "Reminder", "Herinnering"), "one reminder stays")
            try expectEqual(DeskPane.pet.title, pick("종이냥", "Cat", "Kat"), "cat pane")
            try expectEqual(L("종이냥"), pick("종이냥", "Jongi-nyang", "Jongi-nyang"), "the app's name stays")
            try expectEqual(DeskPane.storage.title, pick("저장과 백업", "Storage & backup", "Opslag & back-up"), "storage pane")
            try expectEqual(DeskPane.Section.allCases.map(\.title), language == .ko ? ["보기", "설정", "도움"] : language == .en ? ["View", "Settings", "Help"] : ["Bekijken", "Instellingen", "Help"], "sidebar headings")
            try expectEqual(PaperColor.allCases.map(\.title), language == .ko ? ["자동", "낮", "밤"] : language == .en ? ["Automatic", "Day", "Night"] : ["Automatisch", "Dag", "Nacht"], "paper colour")
            try expectEqual(L("종이 색"), pick("종이 색", "Paper color", "Papierkleur"), "paper setting")
            try expectEqual(L("밤 종이"), pick("밤 종이", "Night paper", "Nachtpapier"), "night paper")
        }

        try test("dates the app writes itself") {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = .current
            let september = calendar.date(from: DateComponents(year: 2025, month: 9, day: 28, hour: 14, minute: 39))!
            let october = calendar.date(from: DateComponents(year: 2025, month: 10, day: 3, hour: 9))!
            try expectEqual(MemoFolders.slipTime(september, now: october, calendar: calendar, language: language), pick("9월 28일", "Sep 28", "28 sep"), "memo date (메모 서랍's slip)")
            try expectEqual(TaskRow.repeatCaption(RepeatRule(kind: .weekly, weekdays: [1, 3, 5]), language: language),
                            pick("월·수·금", "Mon, Wed, Fri", "ma, wo, vr"), "weekly caption")
            try expectEqual(TaskRow.repeatCaption(RepeatRule(kind: .weekly, weekdays: [0, 1, 2, 3, 4, 5, 6]), language: language),
                            pick("매일", "Every day", "Elke dag"), "every day stays whole")
            try expectEqual(FloatingNoteSummary(titles: [], remaining: 3, total: 4).caption, pick("3개 남음", "3 left", "nog 3"), "sticky note")
        }

        try test("help and the tour are translated through") {
            var texts: [String] = []
            for topic in HelpTopic.all {
                texts += [topic.title, topic.headline]
                for entry in topic.entries { texts += [entry.title, entry.body] + entry.keys }
            }
            for card in GuideView.cards {
                texts += [card.title, card.body]
                for (label, key) in card.keys { texts += [label, key] }
            }
            let hangul = texts.filter { $0.replacingOccurrences(of: "종이냥", with: "").range(of: "[가-힣]", options: .regularExpression) != nil }
            if language == .ko {
                try expect(hangul.count > 100, "Korean help is Korean")
            } else {
                try expectEqual(hangul, [], "Hangul left in the help")
            }
        }

        try test("handwriting: Latin faces in English and Dutch, Hangul still from the Korean face") {
            HandwritingFont.register()
            for face in [HandwritingFont.Face.pen, .brush] {
                let font = HandwritingFont.native(face: face, size: 23)
                let hangul = CTFontCreateForString(font as CTFont, "가" as CFString, CFRange(location: 0, length: 1))
                try expect((CTFontCopyPostScriptName(hangul) as String).hasPrefix("HanJang"), "Hangul in \(face) comes from HanJang")
                if language == .ko {
                    try expect(font.fontName.hasPrefix("HanJang"), "Korean keeps HanJang, got \(font.fontName)")
                    try expectEqual(HandwritingFont.extraLineHeight(face: face, size: 23).top, 0, "no trim in Korean")
                } else {
                    try expectEqual(font.fontName, face.latinPostScriptName, "Latin face")
                    try expectEqual(font.pointSize, (23 * face.latinScale).rounded(), "Latin size")
                }
            }
        }

        print("\(count) localization checks passed in \(language.rawValue)")
    }
}
