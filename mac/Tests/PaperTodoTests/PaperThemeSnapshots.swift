import AppKit
import PaperCore
import SwiftUI

/// 종이 테마 (#244): each of the fifteen papers drawn on the note, the desk's month calendar and the drawer (노트와 같은 종이),
/// and the 꾸미기 → 종이 tiles with 밤에는, the drawer's 서랍 종이 — off-screen, from made-up data, never the user's notes.
/// scripts/render-paper-themes.sh [ko|en|nl] [day|night] [papers]
@main
@MainActor
enum PaperThemeSnapshots {
    static let night = ProcessInfo.processInfo.environment["PAPERTODO_PAPER"] == "night"

    static func t(_ ko: String, _ en: String, _ nl: String) -> String {
        switch AppLanguage.current {
        case .ko: ko
        case .en: en
        case .nl: nl
        }
    }

    static func main() async throws {
        L10n.activate(setting: ProcessInfo.processInfo.environment["PAPERTODO_LANG"] ?? "ko", preferred: [])
        AppLanguage.hourCycle = AppLanguage.current == .en ? .h12 : .h24
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.prohibited)
        HandwritingFont.register()
        SlipMotion.enabled = false
        let output = URL(fileURLWithPath: CommandLine.arguments[1])
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let papers = (ProcessInfo.processInfo.environment["PAPERTODO_PAPERS"].map { $0.split(separator: ",").compactMap { PaperKind(rawValue: String($0)) } }) ?? PaperKind.allCases
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("PaperThemes-\(UUID())")
        let suite = TestDefaults("PaperThemes")
        let preferences = suite.defaults
        defer {
            suite.remove()
            try? FileManager.default.removeItem(at: folder)
        }
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        preferences.set(false, forKey: "reminder.enabled")

        // The demo list, in the language drawn: one done, one with a reminder, one due today.
        var notebook = Notebook()
        let first = notebook.add(t("창문 열고, 커피 한 잔", "Open the window, have a coffee", "Raam open, kopje koffie"))!
        notebook.toggle(id: first.id)
        let scheduled = notebook.add(t("발표 자료 마무리", "Finish the slides", "Presentatie afmaken"))!
        notebook.setReminder(id: scheduled.id, at: Date().addingTimeInterval(3600))
        _ = notebook.add(t("미뤄 둔 책 10쪽 읽기", "Read 10 pages of that book", "10 bladzijden lezen"))
        _ = notebook.add(t("우체국 들르기", "Stop by the post office", "Langs het postkantoor"))
        let storage = folder.appendingPathComponent("todos.json")
        try NotebookFile(url: storage).save(notebook)
        // Three made-up memos for the drawer: a note, a checklist, a short line.
        let memoTime = Date().addingTimeInterval(-3600)
        try MemoFile.save([
            Memo(id: "weekly", text: t("주간 회의\n시안 두 개는 금요일까지. 리뷰는 목요일 3시.", "Weekly meeting\nTwo drafts by Friday. Review on Thursday at 3.",
                                       "Weekoverleg\nTwee ontwerpen voor vrijdag. Review donderdag om 3 uur."), createdAt: memoTime, updatedAt: memoTime),
            Memo(id: "shop", text: t("장보기\n- [ ] 우유\n- [ ] 달걀\n- [x] 커피 원두", "Groceries\n- [ ] Milk\n- [ ] Eggs\n- [x] Coffee beans",
                                     "Boodschappen\n- [ ] Melk\n- [ ] Eieren\n- [x] Koffiebonen"), createdAt: memoTime.addingTimeInterval(-600), updatedAt: memoTime.addingTimeInterval(-600)),
            Memo(id: "books", text: t("읽고 싶은 책 정리", "Books to read", "Boeken om te lezen"), createdAt: memoTime.addingTimeInterval(-86400), updatedAt: memoTime.addingTimeInterval(-86400)),
        ], to: folder.appendingPathComponent("memos.json"))
        let model = AppModel(storageURL: storage, isolated: true, preferences: preferences)
        model.paperColor = night ? .night : .day
        model.notebookFont = .pen
        model.setDue(model.items[2].id, to: Deadline.key(Archive.logicalDayStart(Date())))
        let now = Date()
        func timed(_ id: String, _ title: String, _ color: LocalEvent.Color, _ from: Double, _ to: Double) -> LocalEvent {
            let start = now.addingTimeInterval(from * 60), end = now.addingTimeInterval(to * 60)
            return LocalEvent(id: id, title: title, date: CalendarDraft.day(start), start: CalendarDraft.minutes(start), end: CalendarDraft.minutes(end), color: color)
        }
        func later(_ id: String, _ title: String, _ color: LocalEvent.Color, days: Int, hour: Int) -> LocalEvent {
            let day = Calendar.current.date(byAdding: .day, value: days, to: now)!
            return LocalEvent(id: id, title: title, date: CalendarDraft.day(day), start: hour * 60, end: (hour + 1) * 60, color: color)
        }
        // Every one of the six event colours, so each paper's marks show.
        let tripStart = Calendar.current.date(byAdding: .day, value: 2, to: Calendar.current.startOfDay(for: now))!
        let events = [
            timed("standup", t("팀 회의", "Team meeting", "Teamoverleg"), .sage, -15, 30),
            timed("dentist", t("치과", "Dentist", "Tandarts"), .blue, 40, 80),
            timed("dinner", t("저녁 약속", "Dinner with friends", "Uit eten met vrienden"), .yellow, 300, 420),
            LocalEvent(id: "trip", title: t("제주 여행", "Trip to Jeju", "Reis naar Jeju"), date: CalendarDraft.day(tripStart), allDay: true, days: 3, color: .coral),
            later("review", t("분기 리뷰", "Quarterly review", "Kwartaalreview"), .purple, days: 8, hour: 10),
            later("yoga", t("요가", "Yoga", "Yoga"), .gray, days: -3, hour: 19),
            later("lunch", t("팀 점심", "Team lunch", "Teamlunch"), .yellow, days: -6, hour: 12),
            later("call", t("엄마와 통화", "Call Mom", "Mama bellen"), .blue, days: 4, hour: 18),
        ]
        model.calendar.showForSnapshot(events)
        let drawer = model.drawer
        drawer.now = { now }
        drawer.refreshForSnapshot()
        let controller = ReminderController(model: model, preferences: preferences, onOpen: {})
        let archive = ArchiveStore(model: model)
        let screen = { (dark: Bool) in dark ? Color(white: 0.14) : Color(red: 0.86, green: 0.87, blue: 0.89) }

        func use(_ paper: PaperKind, _ choice: NightChoice = .night) {
            model.paperTheme = paper
            model.paperNight = choice
        }
        /// The paper drawn in this run (day: the paper; night: what 밤에는 turns it into).
        func dark() -> Bool { PaperLook.shared.look.shown(systemDark: night).isDark }

        func shots(_ name: String) throws {
            let isDark = dark()
            try render(PaperView(model: model), size: NSSize(width: 420, height: 560), dark: isDark, to: output.appendingPathComponent("\(name)-note.png"))
            try render(DeskView(state: DeskState(pane: .calendar), model: model, archive: archive, reminders: controller, previewTitlebar: true),
                       size: DeskMetrics.size, dark: isDark, to: output.appendingPathComponent("\(name)-calendar.png"))
            try render(MemoDrawerView(drawer: drawer).frame(width: MemoDrawerView.shadowRoom + MemoDrawerView.tabsWidth + 300, height: 640).background(screen(isDark)),
                       size: nil, dark: isDark, to: output.appendingPathComponent("\(name)-drawer.png"))
        }

        if ProcessInfo.processInfo.environment["PAPERTODO_ONLY"] != "gallery" {
            if night {
                // At night every light paper turns into 밤에는's (밤 종이 by default): drawn once on 낮 종이; then each dark
                // paper as 밤에는, 그대로 on 크라프트지 (the menus stay light), and the dark papers as themselves.
                use(.day)
                try shots("day-at-night")
                for choice in [NightChoice.ink, .nightsky, .chalk] {
                    use(.day, choice)
                    try shots("day-at-night-\(choice.rawValue)")
                }
                use(.kraft, .keep)
                try shots("kraft-kept")
                for paper in papers where paper.isDark {
                    use(paper)
                    try shots(paper.rawValue)
                }
            } else {
                for paper in papers {
                    use(paper)
                    try shots(paper.rawValue)
                }
            }
        }

        // 꾸미기 → 종이 and 메모 서랍 → 서랍 종이, at the desk's usual width and its narrowest; picked: 노란 메모지 (light) and
        // 칠판 (dark: 밤에는 dimmed with its reason).
        for (picked, name) in [(PaperKind.memo, "gallery"), (.chalk, "gallery-dark")] {
            use(picked)
            for (width, suffix) in [(CGFloat(560), ""), (CGFloat(400), "-narrow")] {
                try render(PaperThemeGroup(model: model).padding(20).frame(width: width).background(PaperTheme.paper2), size: nil, dark: dark(),
                           to: output.appendingPathComponent("\(name)\(suffix).png"))
            }
        }
        use(.day)
        drawer.sameAsNote = true
        try render(DrawerPaperGroup(drawer: drawer).padding(20).frame(width: 560).background(PaperTheme.paper2), size: nil, dark: dark(),
                   to: output.appendingPathComponent("drawer-gallery-same.png"))
        drawer.sameAsNote = false
        drawer.theme = .lined
        drawer.night = .nightsky
        try render(DrawerPaperGroup(drawer: drawer).padding(20).frame(width: 560).background(PaperTheme.paper2), size: nil, dark: dark(),
                   to: output.appendingPathComponent("drawer-gallery-own.png"))
        try render(DeskView(state: DeskState(pane: .appearance), model: model, archive: archive, reminders: controller, previewTitlebar: true),
                   size: NSSize(width: DeskMetrics.size.width, height: 1500), dark: dark(), to: output.appendingPathComponent("desk-appearance-full.png"))
        drawer.sameAsNote = true
    }

    static func render<V: View>(_ view: V, size: NSSize?, dark: Bool, to url: URL) throws {
        let hosting = NSHostingView(rootView: view)
        let fitting = size ?? hosting.fittingSize
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: fitting), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        window.contentView = hosting
        hosting.frame = NSRect(origin: .zero, size: fitting)
        hosting.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.15))
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { throw CocoaError(.fileWriteUnknown) }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else { throw CocoaError(.fileWriteUnknown) }
        try data.write(to: url)
        window.close()
    }
}
