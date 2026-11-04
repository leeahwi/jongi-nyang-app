import AppKit
import PaperCore
import SwiftUI

/// 기기마다 보일 스페이스 (#196, spaces-device.md §4): the desk's rows with their 이 기기에서 lines and marks (and its popup
/// open), the 시간 정하기 slip with several ranges and with a preset picked, the `모든 스페이스 ▾` menu with 이 기기에서 숨김
/// and the 이 기기에서 숨기기 ▸ submenu, a note at home with 회사 hidden (mixed, 메모지, peeked at, narrow) and the toast
/// after `#회사` there. The clock is fixed at Tuesday 20:10. Made-up to-dos only. `PAPERTODO_ONLY=device`.
extension DesignSnapshots {
    static func renderSpaceDevice(folder: URL, preferences: UserDefaults, output: URL) throws {
        let only = ProcessInfo.processInfo.environment["PAPERTODO_ONLY"] ?? ""
        guard only.isEmpty || only.contains("device") else { return }
        let storage = folder.appendingPathComponent("spaces-device/todos.json")
        try FileManager.default.createDirectory(at: storage.deletingLastPathComponent(), withIntermediateDirectories: true)
        try NotebookFile(url: storage).save(Notebook())
        let model = AppModel(storageURL: storage, isolated: true, preferences: preferences)
        keptModels.append(model)
        model.paperColor = night ? .night : .day
        model.notebookFont = .pen
        // Tuesday 3 November 2026, 20:10 on this Mac's clock.
        var parts = DateComponents(year: 2026, month: 11, day: 3, hour: 20, minute: 10)
        parts.calendar = Calendar.paper
        let now = parts.date!
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
        let shopping = add(t("장보기 목록 정리", "Sort out the shopping list", "Boodschappenlijst maken"), in: home)
        model.setTimeRange(shopping, to: TimeRange(start: 20 * 60 + 30, end: 21 * 60))
        _ = add(t("빨래 개기", "Fold the laundry", "Was vouwen"), in: home, done: true)
        _ = add(t("주간 보고서 쓰기", "Write the weekly report", "Weekrapport schrijven"), in: work)
        _ = add(t("팀 회의 자료 보내기", "Send the team meeting notes", "Stukken teamoverleg sturen"), in: work)
        _ = add(L("미뤄 둔 책 10쪽 읽기"), in: study)
        _ = add(t("화분에 물 주기", "Water the plants", "Planten water geven"), in: nil)
        model.toast = nil
        model.selectedTaskID = nil
        // 회사 hidden on this Mac; 공부 only on weekday mornings and evenings (shown at 20:10).
        let studyTimes = [SpaceDevice.Times(days: [1, 2, 3, 4, 5], from: 7 * 60, to: 8 * 60 + 30),
                          SpaceDevice.Times(days: [1, 2, 3, 4, 5], from: 19 * 60, to: 23 * 60)]
        model.setDeviceRule(work, .hide)
        model.setDeviceRule(study, .times(studyTimes))
        model.refreshDeviceHidden(now: now)
        // The fixed clock stays: no minute tick while the snapshots are drawn.
        model.deviceClock?.invalidate()
        model.deviceClock = nil
        _ = home

        let screen = night ? Color(white: 0.12) : PaperTheme.desk
        let controller = ReminderController(model: model, preferences: preferences, onOpen: {})
        let archive = ArchiveStore(model: model)
        func desk(_ name: String, size: NSSize = DeskMetrics.size) throws {
            try render(DeskView(state: DeskState(pane: .spaces), model: model, archive: archive, reminders: controller, previewTitlebar: true),
                       size: size, to: output.appendingPathComponent("spaces-device-\(name).png"))
        }
        // ① The desk's rows: a line under the name, the mark on the dot, the popup at the right.
        try desk("desk")
        try desk("desk-narrow", size: DeskMetrics.minimum)
        // The popup open on 공부's row (the system menu's items, drawn as the app's menus are).
        let language = AppLanguage.current
        var show = DrawerMenuItem.action(SpaceDevice.Words.show.text(language), symbol: "eye") {}
        show.checked = false
        let popup: [DrawerMenuItem] = [show, .action(SpaceDevice.Words.hide.text(language), symbol: "eye.slash") {}, .separator,
                                       .action(SpaceDevice.Words.setTimes.text(language), symbol: "clock", checked: true) {}]
        do {
            let size = DeskMetrics.size
            let view = ZStack(alignment: .topLeading) {
                DeskView(state: DeskState(pane: .spaces), model: model, archive: archive, reminders: controller, previewTitlebar: true)
                    .frame(width: size.width, height: size.height)
                DrawerMenuPreview(items: popup, font: model.notebookFont, width: 190).offset(x: size.width - 250, y: 312)
            }
            .frame(width: size.width, height: size.height, alignment: .topLeading)
            try render(view, size: size, to: output.appendingPathComponent("spaces-device-desk-popup.png"))
        }

        // ② 시간 정하기: several ranges (평일 09:00–12:00, 13:00–18:00 · 토 10:00–14:00), and 주말 picked with a row past midnight
        // and one with no days (저장 off).
        let split = [SpaceDevice.Times(days: [1, 2, 3, 4, 5], from: 9 * 60, to: 12 * 60), SpaceDevice.Times(days: [1, 2, 3, 4, 5], from: 13 * 60, to: 18 * 60),
                     SpaceDevice.Times(days: [6], from: 10 * 60, to: 14 * 60)]
        func slip(_ name: String, title: String, rows: [SpaceDevice.Times]) throws {
            try render(SpaceTimesSlip(title: title, color: .pink, rows: rows, previewNow: now).padding(24).background(screen),
                       size: nil, to: output.appendingPathComponent("spaces-device-\(name).png"))
        }
        try slip("times", title: SpaceDevice.slipTitle(t("회사", "Work", "Werk"), language), rows: split)
        try slip("times-preset", title: SpaceDevice.slipTitle(t("집", "Home", "Thuis"), language),
                 rows: SpaceDevice.Preset.weekend.times + [SpaceDevice.Times(days: [1, 2, 3, 4, 5], from: 19 * 60, to: 60), SpaceDevice.Times(days: [], from: 9 * 60, to: 18 * 60)])

        // ③ The menu: 회사 under 이 기기에서 숨김 with 보이기, 공부's hint, and 이 기기에서 숨기기 ▸ open.
        let size = NSSize(width: 420, height: 600)
        func menuShot(_ name: String, _ items: [DrawerMenuItem], at point: CGPoint, sub: [DrawerMenuItem]? = nil, subAt: CGFloat = 0) throws {
            let total = NSSize(width: max(size.width, point.x + 280 + (sub == nil ? 0 : 230)) + 20, height: size.height)
            let view = ZStack(alignment: .topLeading) {
                PaperView(model: model, previewNow: now).frame(width: size.width, height: size.height)
                DrawerMenuPreview(items: items, font: model.notebookFont, width: 270).offset(x: point.x, y: point.y)
                if let sub { DrawerMenuPreview(items: sub, font: model.notebookFont, width: 220).offset(x: point.x + 262, y: point.y + subAt) }
            }
            .frame(width: total.width, height: total.height, alignment: .topLeading)
            .background(screen)
            try render(view, size: total, to: output.appendingPathComponent("spaces-device-\(name).png"))
        }
        let header = SpaceMenus.header(model)
        let subIndex = header.firstIndex { if case .submenu = $0.kind { true } else { false } }!
        guard case .submenu(let sub) = header[subIndex].kind else { return }
        let above = header[..<subIndex].reduce(CGFloat(5)) { sum, entry in
            switch entry.kind {
            case .separator: sum + 11
            case .section: sum + 20
            default: sum + 22
            }
        }
        try menuShot("menu", header, at: CGPoint(x: 150, y: 100), sub: sub, subAt: above)

        // ④ The note at home: the end line (mixed and 메모지), 잠깐 보기, narrow; ⑤ the toast after `#회사`.
        func note(_ name: String, size: NSSize = NSSize(width: 420, height: 600)) throws {
            try render(PaperView(model: model, previewNow: now), size: size, to: output.appendingPathComponent("spaces-device-\(name).png"))
        }
        try note("note")
        try note("note-narrow", size: NSSize(width: 350, height: 480))
        model.groupBySpace = true
        try note("note-cards", size: NSSize(width: 420, height: 720))
        model.groupBySpace = false
        model.peekHidden(model.todayDeviceLine.hidden)
        try note("note-peek")
        model.hideAgain()
        var toast = PaperToast(symbol: "eye.slash", text: SpaceDevice.added(to: t("회사", "Work", "Werk"), language))
        toast.action = L("되돌리기")
        toast.perform = {}
        model.toast = toast
        try note("toast")
        try note("toast-narrow", size: NSSize(width: 350, height: 480))
        model.toast = nil
    }
}
