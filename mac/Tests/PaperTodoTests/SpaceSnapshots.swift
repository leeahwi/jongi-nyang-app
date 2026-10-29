import AppKit
import PaperCore
import SwiftUI

/// 할 일 스페이스 (1.45, spec §7): 오늘 with no spaces (as 1.44), a mixed sheet with bands, 회사만 보는 중 (the band over
/// the list), the input line's `#회사` and new-space chips, the `모든 스페이스 ▾` popup, the row's 스페이스로 옮기기, the
/// desk's 스페이스 pane (and its toast), the editor's space field. Sample spaces are plain words (회사 · 집 · 공부).
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

        // S19: no spaces — the sheet as 1.44 drew it.
        try note("today-none")
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
                             ("only-token", t("#회사", "#work", "#werk"))] {
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
    }
}
