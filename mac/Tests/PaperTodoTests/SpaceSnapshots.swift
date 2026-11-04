import AppKit
import PaperCore
import SwiftUI

/// 할 일 스페이스 (1.45, spec §7): 오늘 with no spaces (as 1.44), a mixed sheet with bands, 회사만 보는 중 (the faint
/// line at the end of the list, #87), the input line's `#회사`, `#일반` and new-space chips, the `모든 스페이스 ▾` popup,
/// the row's 스페이스로 옮기기, the desk's 스페이스 pane with 일반 as its fixed first row (#89; renamed too), its toast, the
/// editor's space field. Sample spaces are plain words (회사 · 집 · 공부).
extension DesignSnapshots {
    static func renderSpaces(folder: URL, preferences: UserDefaults, output: URL) throws {
        let only = ProcessInfo.processInfo.environment["PAPERTODO_ONLY"] ?? ""
        guard only.isEmpty || only.contains("spaces") else { return }
        let storage = folder.appendingPathComponent("spaces/todos.json")
        try FileManager.default.createDirectory(at: storage.deletingLastPathComponent(), withIntermediateDirectories: true)
        var notebook = Notebook()
        let first = notebook.add(L("창문 열고, 커피 한 잔"))!
        notebook.toggle(id: first.id)
        let scheduled = notebook.add(L("오늘 꼭 해야 할 일 정리하기"))!
        notebook.setReminder(id: scheduled.id, at: Date().addingTimeInterval(3600))
        let report = notebook.add(t("주간 보고서 초안", "Draft the weekly report", "Weekrapport opzetten"))!
        let book = notebook.add(L("미뤄 둔 책 10쪽 읽기"))!
        let air = notebook.add(L("잠깐, 바깥 공기 쐬기"))!
        let laundry = notebook.add(t("세탁기 돌리기", "Run the washing machine", "Wasmachine aanzetten"))!
        _ = notebook.add(L("내일의 나에게 메모 남기기"))
        try NotebookFile(url: storage).save(notebook)
        let model = AppModel(storageURL: storage, isolated: true, preferences: preferences)
        keptModels.append(model)
        model.paperColor = night ? .night : .day
        model.notebookFont = .pen
        let size = NSSize(width: 420, height: 600)
        func note(_ name: String, line: String? = nil, size: NSSize = size) throws {
            try render(PaperView(model: model, previewLine: line), size: size, to: output.appendingPathComponent("spaces-\(name).png"))
        }
        /// The input line alone (drawn twice: its typed text arrives on appear, after the first layout).
        func line(_ name: String, _ text: String, focused: Bool = true) throws {
            for _ in 0..<2 {
                try render(IntentLineView(model: model, page: .todos, previewText: text, previewFocused: focused)
                            .padding(12).frame(width: 420).background(PaperTheme.paper),
                           size: nil, to: output.appendingPathComponent("spaces-line-\(name).png"))
            }
        }

        // S19: no spaces — the sheet as 1.44 drew it, and the desk's pane with only + 새 스페이스.
        try note("today-none")
        do {
            let controller = ReminderController(model: model, preferences: preferences, onOpen: {})
            try render(DeskView(state: DeskState(pane: .spaces), model: model, archive: ArchiveStore(model: model), reminders: controller, previewTitlebar: true),
                       size: DeskMetrics.size, to: output.appendingPathComponent("spaces-desk-empty.png"))
        }
        try line("none", t("빨래 #세탁", "laundry #chores", "was #klusjes"))

        let work = model.addTodoSpace(name: t("회사", "Work", "Werk"), color: .pink)!
        let home = model.addTodoSpace(name: t("집", "Home", "Thuis"), color: .mint)!
        let study = model.addTodoSpace(name: t("공부", "Study", "Studie"), color: .sky)!
        for (todo, space) in [(scheduled.id, work), (report.id, work), (book.id, study), (air.id, home), (laundry.id, home), (first.id, work)] {
            model.moveTodo(todo, toSpace: space, toast: false)
        }
        try note("today-mixed")
        try note("today-mixed-narrow", size: NSSize(width: 350, height: 480))

        // ② 회사만 보는 중.
        model.showSpace(.space(work))
        try note("lens")
        try note("lens-narrow", size: NSSize(width: 350, height: 480))
        model.showSpace(.noSpace)
        try note("lens-none")
        model.showSpace(.all)

        // ③ The input line.
        for (name, text) in [("chip", t("견적서 보내기 금요일까지 #회사", "send the quote by Friday #work", "offerte sturen vrijdag #werk")),
                             ("prefix", t("견적서 #ㅎㅅ", "quote #wo", "offerte #we")),
                             ("new", t("빨래 #세탁", "laundry #chores", "was #klusjes")),
                             ("event", t("내일 3시 회의 #회사", "meeting tomorrow 3pm #work", "morgen om 3 uur overleg #werk")),
                             ("only-token", t("#회사", "#work", "#werk")),
                             ("general", t("빨래 #일반", "laundry #general", "was #algemeen"))] {
            try line(name, text)
        }
        model.showSpace(.space(work))
        try note("lens-typing", line: t("보고서", "report", "rapport"))
        try line("lens-hint", "", focused: false)
        model.showSpace(.all)

        // The popup and the row's menu, drawn from the items the app's menus are made of.
        let screen = night ? Color(white: 0.12) : PaperTheme.desk
        func menuShot(_ name: String, _ items: [DrawerMenuItem], at point: CGPoint, sub: [DrawerMenuItem]? = nil, subAt: CGFloat = 0) throws {
            let total = NSSize(width: max(size.width, point.x + 260 + (sub == nil ? 0 : 230)) + 20, height: size.height)
            let view = ZStack(alignment: .topLeading) {
                PaperView(model: model).frame(width: size.width, height: size.height)
                DrawerMenuPreview(items: items, font: model.notebookFont, width: 250).offset(x: point.x, y: point.y)
                if let sub { DrawerMenuPreview(items: sub, font: model.notebookFont, width: 220).offset(x: point.x + 242, y: point.y + subAt) }
            }
            .frame(width: total.width, height: total.height, alignment: .topLeading)
            .background(screen)
            try render(view, size: total, to: output.appendingPathComponent("spaces-\(name).png"))
        }
        try menuShot("popup", SpaceMenus.header(model), at: CGPoint(x: 170, y: 100))
        model.showSpace(.space(work))
        try menuShot("popup-lens", SpaceMenus.header(model), at: CGPoint(x: 170, y: 100))
        model.showSpace(.all)
        // The row's right-click menu (TaskRowMenu, the app's own rows: icons and keys) with 스페이스로 옮기기 open.
        let noop = TaskRowMenu.Actions(edit: {}, reminder: {}, deadline: {}, time: {}, calendar: {}, moveUp: {}, moveDown: {})
        let row = TaskRowMenu.items(model, item: model.items.first { $0.id == report.id }!, onShelf: false, actions: noop)
        let spacesRow = row.firstIndex { $0.title == L("스페이스로 옮기기") }!
        let above = row[..<spacesRow].reduce(CGFloat(5)) { sum, entry in
            if case .separator = entry.kind { return sum + 11 }
            return sum + 22
        }
        try menuShot("move-menu", row, at: CGPoint(x: 90, y: 120), sub: SpaceMenus.move(model, report.id), subAt: above)

        // ⑤ The desk's pane, and the toast after a delete.
        let controller = ReminderController(model: model, preferences: preferences, onOpen: {})
        let archive = ArchiveStore(model: model)
        func desk(_ name: String, size: NSSize = DeskMetrics.size) throws {
            try render(DeskView(state: DeskState(pane: .spaces), model: model, archive: archive, reminders: controller, previewTitlebar: true),
                       size: size, to: output.appendingPathComponent("spaces-\(name).png"))
        }
        try desk("desk")
        try desk("desk-narrow", size: DeskMetrics.minimum)
        // #89: 일반 renamed — the desk's first row, the popup and the line's end while it shows alone.
        model.renameGeneral(to: t("기타", "Other", "Overig"))
        try desk("desk-general-renamed")
        model.showSpace(.noSpace)
        try menuShot("popup-general", SpaceMenus.header(model), at: CGPoint(x: 170, y: 100))
        model.showSpace(.all)
        model.renameGeneral(to: "")
        // + 새 스페이스: the row being named right there (1.45.1, no slip).
        try render(SpacesSettingsPanel(model: model, previewDraft: t("운동", "Exercise", "Sport")).padding(28).frame(width: 640).background(PaperBackground()),
                   size: nil, to: output.appendingPathComponent("spaces-desk-new.png"))
        var toast = PaperToast(symbol: "trash", text: SpaceWords.deleted(t("공부", "Study", "Studie"), language: .current))
        toast.action = L("되돌리기")
        toast.perform = {}
        try render(SpacesSettingsPanel(model: model, previewToast: toast).padding(28).frame(width: 640).background(PaperBackground()),
                   size: nil, to: output.appendingPathComponent("spaces-desk-toast.png"))
        var moved = PaperToast(symbol: "square.stack", text: SpaceWords.moved(to: t("회사", "Work", "Werk"), language: .current))
        moved.action = L("되돌리기")
        moved.perform = {}
        model.toast = moved
        try note("toast")
        model.toast = nil

        // The editor's space field.
        let item = model.items.first { $0.id == report.id }!
        try render(TaskReminderEditorView(item: item, model: model, onSave: { _ in }, onRemove: {}, onCancel: {}),
                   size: nil, to: output.appendingPathComponent("spaces-editor.png"))
        try render(TaskReminderEditorView(item: item, model: model, onSave: { _ in }, onRemove: {}, onCancel: {}, startOnDeadline: true),
                   size: nil, to: output.appendingPathComponent("spaces-editor-deadline.png"))
        let plain = model.items.first { $0.title == L("내일의 나에게 메모 남기기") }!
        try render(TaskReminderEditorView(item: plain, model: model, onSave: { _ in }, onRemove: {}, onCancel: {}),
                   size: nil, to: output.appendingPathComponent("spaces-editor-none.png"))

        // 2a draws a fixed day (13:20): the demo list's reminder, an hour from the real clock, waits at a fixed 21:30 meanwhile
        // (as the 하루 띠's shots do), so it doesn't land somewhere else on the day each time (#191).
        let scheduledAt = model.items.first { $0.id == scheduled.id }?.reminderAt
        model.setTaskReminder(scheduled.id, at: sampleTime(21, 30))
        try renderSpaces2a(model: model, work: work, home: home, output: output)
        model.setTaskReminder(scheduled.id, at: scheduledAt)
        try renderSpaces2b(folder: folder, preferences: preferences, output: output)
        try renderSpaces2c(folder: folder, preferences: preferences, output: output)
    }

    /// 2b 스페이스별로 묶기 (spaces-phase2.md): F 메모지 and E 책갈피 on a mixed sheet, folded groups and a finished row open,
    /// the shortcut chips, a drag over another group, the wide note's columns, the header's menu and the desk's switch.
    /// The day is fixed at 12:40. Made-up to-dos only. `PAPERTODO_ONLY=spaces2b`.
    /// Spaces 2c (C1–C4, H1–H3): the search slip with `#회사 보고서`, `#회사` alone and the blank slip's hint, and 완료 기록
    /// filtered by 회사 (wide, and the desk's narrowest). Made-up lines over the last months, each in a space or 일반.
    static func renderSpaces2c(folder: URL, preferences: UserDefaults, output: URL) throws {
        let storage = folder.appendingPathComponent("spaces2c/todos.json")
        try FileManager.default.createDirectory(at: storage.deletingLastPathComponent(), withIntermediateDirectories: true)
        try NotebookFile(url: storage).save(Notebook())
        let model = AppModel(storageURL: storage, isolated: true, preferences: preferences)
        keptModels.append(model)
        model.paperColor = night ? .night : .day
        model.notebookFont = .pen
        let work = model.addTodoSpace(name: t("회사", "Work", "Werk"), color: .pink)!
        let home = model.addTodoSpace(name: t("집", "Home", "Thuis"), color: .mint)!
        let study = model.addTodoSpace(name: t("공부", "Study", "Studie"), color: .sky)!
        func add(_ title: String, in space: String?, due: Int? = nil) {
            model.add(title, literal: true)
            let id = model.items.last!.id
            if let space { model.moveTodo(id, toSpace: space, toast: false) }
            if let due, let day = Calendar.current.date(byAdding: .day, value: due, to: Date()) { model.setDue(id, to: Deadline.key(day)) }
        }
        add(t("주간 보고서 초안", "Draft the weekly report", "Weekrapport opzetten"), in: work)
        add(t("보고서 표 다듬기", "Tidy the report’s tables", "Tabellen in het rapport bijwerken"), in: work)
        add(t("분기 보고서 검토", "Review the quarterly report", "Kwartaalrapport nakijken"), in: work, due: 3)
        add(t("가계부 보고 정리", "Sum up the household report", "Huishoudrapport bijwerken"), in: home)
        add(t("독서 보고서 쓰기", "Write the reading report", "Leesrapport schrijven"), in: study)
        add(t("세탁기 돌리기", "Run the washing machine", "Wasmachine aanzetten"), in: home)
        model.toast = nil
        model.selectedTaskID = nil
        // The record: about five months of made-up lines, a space written on each (일반 for some).
        var seed: UInt64 = 0x2c2c
        func random() -> Double { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return Double(seed >> 33) / Double(1 << 31) }
        let titles: [(String, String?)] = [
            (t("주간 보고서 제출", "Hand in the weekly report", "Weekrapport inleveren"), work),
            (t("회의 보고서 정리", "Write up the meeting report", "Vergaderverslag uitwerken"), work),
            (t("견적서 보내기", "Send the quote", "Offerte sturen"), work),
            (t("장보기", "Groceries", "Boodschappen"), home),
            (t("빨래 개기", "Fold the laundry", "Was opvouwen"), home),
            (t("독서 보고서 쓰기", "Write the reading report", "Leesrapport schrijven"), study),
            (t("단어 20개 외우기", "Learn 20 words", "20 woorden leren"), study),
            (t("화분 물 주기", "Water the plants", "Planten water geven"), nil),
        ]
        let today = Calendar.current.startOfDay(for: Date())
        var lines: [ArchiveEntry] = []
        var sessions: [FocusRecord] = []
        for back in stride(from: 150, through: 1, by: -1) {
            let day = Calendar.current.date(byAdding: .day, value: -back, to: today)!.addingTimeInterval(10 * 3600)
            for index in 0..<Int(random() * 5) {
                let pick = Int(random() * Double(titles.count))
                let (title, space) = titles[pick]
                let at = day.addingTimeInterval(Double(index) * 53 * 60)
                lines.append(ArchiveEntry(id: "s2c-\(back)-\(index)", title: title, createdAt: at, completedAt: at, space: space))
                if back <= 60, random() < 0.5 {
                    let minutes = [25, 25, 50, 40][Int(random() * 4)]
                    sessions.append(FocusRecord(id: "s2c-focus-\(back)-\(index)", taskId: "s2c-task-\(pick)", title: title, start: at,
                                                end: at.addingTimeInterval(Double(minutes) * 60), minutes: minutes, kind: .focus, space: space))
                }
            }
        }
        let archive = ArchiveStore(model: model)
        archive.seed(lines)
        model.focusLog.seed(sessions)

        let searchHistory = archive.allEntries()
        try slip(SearchView(model: model, history: searchHistory, previewQuery: t("#회사 보고서", "#Work report", "#Werk rapport")),
                 to: output.appendingPathComponent("spaces2c-search.png"))
        try slip(SearchView(model: model, history: searchHistory, previewQuery: t("#집", "#Home", "#Thuis")),
                 to: output.appendingPathComponent("spaces2c-search-space.png"))
        try slip(SearchView(model: model, history: searchHistory), to: output.appendingPathComponent("spaces2c-search-blank.png"))
        let controller = ReminderController(model: model, preferences: preferences, onOpen: {})
        func desk(_ name: String, _ filter: SpaceFilter, size: NSSize = DeskMetrics.size) throws {
            try render(DeskView(state: DeskState(pane: .history), model: model, archive: archive, reminders: controller, previewTitlebar: true,
                                previewHistorySpace: filter),
                       size: size, to: output.appendingPathComponent("spaces2c-\(name).png"))
        }
        try desk("history-work", .space(work))
        try desk("history-general", .general)
        try desk("history-work-narrow", .space(work), size: DeskMetrics.minimum)
    }

    static func renderSpaces2b(folder: URL, preferences: UserDefaults, output: URL) throws {
        let storage = folder.appendingPathComponent("spaces2b/todos.json")
        try FileManager.default.createDirectory(at: storage.deletingLastPathComponent(), withIntermediateDirectories: true)
        try NotebookFile(url: storage).save(Notebook())
        let model = AppModel(storageURL: storage, isolated: true, preferences: preferences)
        keptModels.append(model)
        model.paperColor = night ? .night : .day
        model.notebookFont = .pen
        func at(_ hour: Int, _ minute: Int = 0) -> Date { sampleTime(hour, minute) }
        let stripNow = at(12, 40)
        let work = model.addTodoSpace(name: t("회사", "Work", "Werk"), color: .pink)!
        let home = model.addTodoSpace(name: t("집", "Home", "Thuis"), color: .mint)!
        let study = model.addTodoSpace(name: t("공부", "Study", "Studie"), color: .sky)!
        func add(_ title: String, in space: String?, done: Bool = false) -> UUID {
            model.add(title, literal: true)
            let id = model.items.last!.id
            if let space { model.moveTodo(id, toSpace: space, toast: false) }
            if done { model.toggle(id) }
            return id
        }
        let coffee = add(L("창문 열고, 커피 한 잔"), in: nil, done: true)
        let plan = add(L("오늘 꼭 해야 할 일 정리하기"), in: work)
        // Against the scene's own clock: 13:40 is ahead of 12:40, so it has its reminder (the bell in 다음, #191).
        model.setTimeRange(plan, to: TimeRange(start: 13 * 60 + 40, end: 14 * 60 + 10), now: stripNow)
        _ = add(t("주간 보고서 초안", "Draft the weekly report", "Weekrapport opzetten"), in: work)
        _ = add(t("회의록 올리기", "Post the meeting notes", "Notulen delen"), in: work, done: true)
        let laundry = add(t("세탁기 돌리기", "Run the washing machine", "Wasmachine aanzetten"), in: home)
        model.setTimeRange(laundry, to: TimeRange(start: 19 * 60, end: 19 * 60 + 30), now: stripNow)
        _ = add(L("잠깐, 바깥 공기 쐬기"), in: home)
        let book = add(L("미뤄 둔 책 10쪽 읽기"), in: study)
        _ = add(L("내일의 나에게 메모 남기기"), in: nil)
        _ = coffee
        model.toast = nil
        model.selectedTaskID = nil
        model.groupBySpace = true

        func shot(_ name: String, size: NSSize = NSSize(width: 420, height: 720), drag: (UUID, String)? = nil) throws {
            try render(PaperView(model: model, previewNow: stripNow, previewGroupDrag: drag), size: size,
                       to: output.appendingPathComponent("spaces2b-\(name).png"))
        }
        // F 메모지 (the default), then with 일반's finished row open; E 책갈피.
        try shot("card")
        try shot("card-narrow", size: NSSize(width: 350, height: 560))
        model.openDoneGroups = [SpaceGroups.general]
        try shot("card-done-open")
        model.openDoneGroups = []
        model.groupStyle = .bookmark
        try shot("bookmark")
        try shot("bookmark-narrow", size: NSSize(width: 350, height: 560))
        model.groupStyle = .card
        // Folded: 집 and 공부 only their heads.
        model.foldedGroups = [home, study]
        try shot("card-folded")
        model.groupStyle = .bookmark
        try shot("bookmark-folded")
        model.groupStyle = .card
        model.foldedGroups = []
        // A drag of 공부's book over 집: the group lights up in its colour and says where it goes.
        try shot("drag", drag: (book, home))
        model.groupStyle = .bookmark
        try shot("bookmark-drag", drag: (book, home))
        model.groupStyle = .card
        // Only 회사: its group alone.
        model.showSpace(.space(work))
        try shot("lens")
        model.showSpace(.all)
        // I (S45): the note at 1,200 (its widest while grouped) — four columns; a drag over 집; 집's `+ 집에 넣기`, the line
        // writing into 집. At 720 four columns don't get 220 each: 메모지 as usual. Then three columns (only 회사 · 집 ·
        // 공부 with to-dos) at 1,200.
        let wide = NSSize(width: 1_200, height: 640)
        try shot("board", size: wide)
        try shot("board-drag", size: wide, drag: (book, home))
        model.lineSpace = .space(home)
        try render(PaperView(model: model, previewLine: t("빨래 개기", "Fold the laundry", "Was opvouwen"), previewNow: stripNow),
                   size: wide, to: output.appendingPathComponent("spaces2b-board-add.png"))
        model.lineSpace = nil
        try shot("board-720-cards", size: NSSize(width: 720, height: 640))
        model.hideCompleted = true
        if let memo = model.items.first(where: { $0.title == L("내일의 나에게 메모 남기기") }) { model.moveTodo(memo.id, toSpace: study, toast: false) }
        model.toast = nil
        try shot("board-three", size: wide)
        model.hideCompleted = false

        // #168: three to-dos picked (⌘-click), in 메모지, 책갈피 and the plain list; one dragged over 집 with the ‘3개’
        // badge; the toast after.
        try renderMultiPick(model: model, home: home, now: stripNow, output: output)

        // The header's menu with 스페이스별로 묶기 ✓, and the desk's pane with the switch and the look.
        let screen = night ? Color(white: 0.12) : PaperTheme.desk
        let menu = ZStack(alignment: .topLeading) {
            PaperView(model: model, previewNow: stripNow).frame(width: 420, height: 640)
            DrawerMenuPreview(items: SpaceMenus.header(model), font: model.notebookFont, width: 250).offset(x: 160, y: 100)
        }
        .frame(width: 440, height: 640, alignment: .topLeading)
        .background(screen)
        try render(menu, size: NSSize(width: 440, height: 640), to: output.appendingPathComponent("spaces2b-menu.png"))
        let controller = ReminderController(model: model, preferences: preferences, onOpen: {})
        try render(DeskView(state: DeskState(pane: .spaces), model: model, archive: ArchiveStore(model: model), reminders: controller, previewTitlebar: true),
                   size: DeskMetrics.size, to: output.appendingPathComponent("spaces2b-desk.png"))
        model.groupBySpace = false
    }

    /// #168: several to-dos picked and moved at once — `PAPERTODO_ONLY=multi`.
    static func renderMultiPick(model: AppModel, home: String, now: Date, output: URL) throws {
        func id(_ title: String) -> UUID? { model.items.first { $0.title == title }?.id }
        let picks = [id(t("주간 보고서 초안", "Draft the weekly report", "Weekrapport opzetten")), id(L("미뤄 둔 책 10쪽 읽기")),
                     id(L("잠깐, 바깥 공기 쐬기"))].compactMap { $0 }
        guard picks.count == 3 else { print("multi: the sample rows are missing"); return }
        model.apply(ListSelection(anchor: picks[0], focus: picks[2], ids: Set(picks)))
        let size = NSSize(width: 420, height: 720)
        func shot(_ name: String, drag: (UUID, String)? = nil) throws {
            try render(PaperView(model: model, previewNow: now, previewGroupDrag: drag), size: size, to: output.appendingPathComponent("multi-\(name).png"))
        }
        model.groupStyle = .card
        try shot("pick")
        model.groupStyle = .bookmark
        try shot("pick-bookmark")
        model.groupStyle = .card
        model.groupBySpace = false
        try shot("pick-plain")
        model.groupBySpace = true
        // The drag: the picture of the first picked row (its grip's), lifted over 집 with the badge.
        let url = output.appendingPathComponent("multi-drag.png")
        if wanted(url) {
            // The picture is taken from the note as it is at the press (the row not faded yet), then put over the note as
            // it is while dragging (the row faded, 집 lit).
            func host(_ drag: (UUID, String)?) -> (NSHostingView<PaperView>, NSWindow) {
                let hosting = NSHostingView(rootView: PaperView(model: model, previewNow: now, previewGroupDrag: drag))
                let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
                window.isReleasedWhenClosed = false
                window.appearance = NSAppearance(named: night ? .darkAqua : .aqua)
                window.contentView = hosting
                hosting.frame = NSRect(origin: .zero, size: size)
                hosting.layoutSubtreeIfNeeded()
                RunLoop.main.run(until: Date().addingTimeInterval(0.2))
                hosting.layoutSubtreeIfNeeded()
                return (hosting, window)
            }
            let (pressed, pressWindow) = host(nil)
            let (hosting, window) = host((picks[0], home))
            var grips: [PaperTaskDragHandle.GripView] = []
            func visit(_ view: NSView) { if let grip = view as? PaperTaskDragHandle.GripView { grips.append(grip) }; view.subviews.forEach(visit) }
            visit(pressed)
            // 회사's second row (주간 보고서 초안, the first picked; the first, timed, has its grip too): the grips top to bottom.
            let ordered = grips.sorted { $0.convert($0.bounds, to: nil).maxY > $1.convert($1.bounds, to: nil).maxY }
            let lifted = ordered.count > 1 ? DragGhost.lift(ordered[1], in: pressWindow, badge: SpaceWords.badge(picks.count, language: .current)) : nil
            if let lifted { lifted.removeFromSuperview(); hosting.addSubview(lifted) }
            pressWindow.contentView = nil
            pressWindow.close()
            if let ghost = lifted {
                ghost.place(dx: 6, dy: -150)
                // The note drawn without the picture, then the picture (with its badge) drawn on top where it is, with
                // the shadow it has on screen (a bitmap of the view doesn't draw a layer's shadow).
                ghost.isHidden = true
                hosting.layoutSubtreeIfNeeded()
                let badge = ghost.subviews.compactMap { $0 as? DragBadge }.first
                if let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds),
                   let picture = (ghost.subviews.first as? NSImageView)?.image,
                   let badge, let badgeBitmap = badge.bitmapImageRepForCachingDisplay(in: badge.bounds) {
                    hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
                    badge.cacheDisplay(in: badge.bounds, to: badgeBitmap)
                    let frame = ghost.frame
                    let at = NSRect(x: frame.minX, y: hosting.bounds.height - frame.maxY, width: frame.width, height: frame.height)
                    NSGraphicsContext.saveGraphicsState()
                    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
                    let shadow = NSShadow()
                    shadow.shadowColor = NSColor.black.withAlphaComponent(0.22)
                    shadow.shadowBlurRadius = 10
                    shadow.shadowOffset = NSSize(width: 0, height: -5)
                    shadow.set()
                    NSColor(PaperTheme.card).setFill()
                    NSBezierPath(roundedRect: at, xRadius: 6, yRadius: 6).fill()
                    NSShadow().set()
                    picture.draw(in: at, from: .zero, operation: .sourceOver, fraction: 0.95, respectFlipped: true, hints: nil)
                    NSColor(PaperTheme.rule).setStroke()
                    NSBezierPath(roundedRect: at.insetBy(dx: 0.5, dy: 0.5), xRadius: 6, yRadius: 6).stroke()
                    // The badge where it sits on the picture (the picture's own coordinates are y up, as the bitmap's).
                    badgeBitmap.draw(in: badge.frame.offsetBy(dx: at.minX, dy: at.minY), from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: nil)
                    NSGraphicsContext.restoreGraphicsState()
                    try bitmap.representation(using: .png, properties: [:])?.write(to: url)
                }
                ghost.removeFromSuperview()
            } else {
                print("multi: no grip for the drag picture")
            }
            window.contentView = nil
            window.close()
        }
        // The toast after a drop of the three on 집: it counts only the rows that change space, as `moveTodos` does
        // (잠깐, 바깥 공기 쐬기 is in 집 already).
        let moving = picks.filter { model.spaceIndex[$0]?.id != home }.count
        var toast = PaperToast(symbol: "square.stack", text: SpaceWords.moved(moving, to: t("집", "Home", "Thuis"), language: .current))
        toast.action = L("되돌리기")
        toast.perform = {}
        model.toast = toast
        try shot("toast")
        model.toast = nil
        model.apply(ListSelection())
    }

    /// 2a (spaces-phase2.md A1–A12): the bands and the lens on 앞으로, the day strip (dots), the day's timetable (left
    /// edges), the 오늘 창 (bands, the lens line), the focus card's space, the rule editor's 스페이스 field and a repeat's
    /// chip in the line. The day is fixed at 13:20 so it looks the same whenever it's drawn. `PAPERTODO_ONLY=spaces2a`.
    static func renderSpaces2a(model: AppModel, work: String, home: String, output: URL) throws {
        func at(_ hour: Int, _ minute: Int = 0) -> Date { sampleTime(hour, minute) }
        let stripNow = at(13, 20)
        let day = CalendarDraft.day(CalendarDay.window(stripNow).start)
        func event(_ id: String, _ title: String, _ color: LocalEvent.Color, _ from: Date, _ to: Date) -> LocalEvent {
            LocalEvent(id: id, title: title, date: day, start: CalendarDraft.minutes(from), end: CalendarDraft.minutes(to), color: color)
        }
        model.calendar.showForSnapshot([
            event("m", t("팀 회의", "Team meeting", "Teamoverleg"), .sage, at(11), at(12)),
            event("d", t("치과", "Dentist", "Tandarts"), .blue, at(17), at(18)),
        ])
        func add(_ title: String, in space: String?) -> UUID {
            model.add(title, literal: true)
            let id = model.items.last!.id
            if let space { model.moveTodo(id, toSpace: space, toast: false) }
            return id
        }
        func ranged(_ title: String, _ start: Int, _ end: Int, in space: String?) -> UUID {
            let id = add(title, in: space)
            model.setTimeRange(id, to: TimeRange(start: start, end: end), now: stripNow)
            return id
        }
        let plan = ranged(t("기획안 검토", "Review the plan", "Plan nalopen"), 13 * 60, 14 * 60, in: work)
        _ = ranged(t("빨래 개기", "Fold the laundry", "Was opvouwen"), 14 * 60 + 30, 15 * 60, in: home)
        _ = ranged(t("자료 정리", "Sort the notes", "Notities ordenen"), 15 * 60 + 30, 16 * 60, in: work)
        let pill = add(t("약 먹기", "Take my medicine", "Medicijnen innemen"), in: nil)
        model.setTaskReminder(pill, at: at(15))
        // 앞으로: tomorrow, next week, later, someday — in 회사, 집 and 일반.
        let calendar = Calendar.paper
        let today = Archive.logicalDayStart(stripNow)
        func due(_ title: String, days: Int, in space: String?) {
            let id = add(title, in: space)
            model.move(id, to: .day(Deadline.key(calendar.date(byAdding: .day, value: days, to: today)!)))
        }
        due(t("견적서 보내기", "Send the quote", "Offerte sturen"), days: 1, in: work)
        due(t("장보기", "Groceries", "Boodschappen"), days: 1, in: home)
        due(t("운동 등록", "Sign up for the gym", "Inschrijven sportschool"), days: 6, in: home)
        due(t("분기 보고", "Quarterly report", "Kwartaalrapport"), days: 9, in: work)
        due(t("세금 신고", "File the taxes", "Belastingaangifte"), days: 24, in: nil)
        let someday = add(t("책장 정리", "Tidy the bookshelf", "Boekenkast opruimen"), in: home)
        model.move(someday, to: .someday)
        model.toast = nil

        func shot(_ name: String, _ view: some View, size: NSSize? = nil) throws {
            try render(view, size: size, to: output.appendingPathComponent("spaces2a-\(name).png"))
        }
        let strip = { (width: CGFloat) in
            DayStripView(model: model, calendar: model.calendar, noteHeight: 640, now: stripNow).frame(width: width).background(PaperTheme.paper)
        }
        let window = { TodayWindowView(model: model, timer: FocusTimerState(), alarms: model.alarms, calendar: model.calendar, now: stripNow) }
        func each(_ lens: SpaceLens.Shown, _ suffix: String) throws {
            model.showSpace(lens)
            model.page = .ahead
            try shot("ahead\(suffix)", PaperView(model: model, previewNow: stripNow), size: NSSize(width: 420, height: 640))
            try shot("ahead\(suffix)-narrow", PaperView(model: model, previewNow: stripNow), size: NSSize(width: 350, height: 480))
            model.page = .todos
            try shot("note\(suffix)", PaperView(model: model, previewNow: stripNow), size: NSSize(width: 420, height: 640))
            try shot("strip\(suffix)", strip(420))
            try shot("strip\(suffix)-narrow", strip(350))
            model.calendar.setDayOpen(true, now: stripNow)
            try shot("timetable\(suffix)", strip(420))
            model.calendar.setDayOpen(false, now: stripNow)
            try slip(window(), to: output.appendingPathComponent("spaces2a-today-window\(suffix).png"))
        }
        try each(.all, "")
        try each(.space(work), "-lens")
        try each(.space(home), "-lens-home")
        try each(.noSpace, "-lens-general")
        model.showSpace(.all)

        // The focus card: `● 회사` over the title.
        let session = FocusSession.focus(taskId: plan.uuidString, title: model.items.first { $0.id == plan }!.title, minutes: 25,
                                         now: Date().addingTimeInterval(-(12 * 60 + 30)))
        model.timerState.session = session
        model.timerState.timer = session.timer
        try shot("focus", PaperView(model: model), size: NSSize(width: 420, height: 560))
        try shot("focus-small", PaperView(model: model), size: NSSize(width: 350, height: 400))
        model.timerState.session = nil
        model.timerState.timer = nil

        // A repeat's rule in 집 (its first to-do there too, A10), the rule editor's 스페이스 field, and a repeat's chip.
        let rule = model.saveSeries(title: t("물 마시기", "Drink water", "Water drinken"), rule: RepeatRule(kind: .daily), remindAt: nil, space: .some(home))
        if let entry = model.series.first(where: { $0.id == rule }) {
            try shot("rule-editor", RepeatSettingsPanel(model: model, previewEditing: entry).padding(28).frame(width: 640).background(PaperBackground()))
        }
        // Only 집: the rule's first to-do is there.
        model.showSpace(.space(home))
        try shot("today-repeat", PaperView(model: model, previewNow: stripNow), size: NSSize(width: 420, height: 640))
        model.showSpace(.all)
        for _ in 0..<2 {
            try shot("line-repeat", IntentLineView(model: model, page: .todos, previewText: t("매일 스트레칭 #집", "every day stretch #home", "elke dag rekken #thuis"), previewFocused: true)
                        .padding(12).frame(width: 420).background(PaperTheme.paper))
        }
    }
}
