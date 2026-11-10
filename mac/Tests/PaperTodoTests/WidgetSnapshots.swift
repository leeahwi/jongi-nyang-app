import AppKit
import PaperCore
import SwiftUI

// 바탕화면 달력 위젯 (#234): every kind at 100 % and 40 % over a made-up wallpaper (light by day, dark at night, and a
// busy one), hovering, with its toast, the day sheet, the gallery, the settings slip and the desk's group — drawn in
// one language and paper per run (scripts/render-widgets.sh ko|en|nl day|night). #321: also over a desktop with icons at
// 20 · 50 · 85 · 100 %, which show through the paper as they are (no frost). All sample data is made up.

@main
private enum WidgetSnapshots {
    /// Drawn in 밤 종이 (`PAPERTODO_PAPER=night`); #244: also while a dark paper's scenes are drawn.
    static var night = ProcessInfo.processInfo.environment["PAPERTODO_PAPER"] == "night"

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
        NSApp.appearance = NSAppearance(named: night ? .darkAqua : .aqua)
        NSApp.setActivationPolicy(.prohibited)
        HandwritingFont.register()
        SlipMotion.enabled = false
        let output = URL(fileURLWithPath: CommandLine.arguments[1])
        try FileManager.default.createDirectory(at: output, withIntermediateDirectories: true)
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("PaperWidgets-\(UUID())")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        let suite = TestDefaults("Widgets")
        let preferences = suite.defaults
        defer {
            suite.remove()
            try? FileManager.default.removeItem(at: folder)
        }
        preferences.set(false, forKey: "reminder.enabled")

        // Thursday 8 October 2026, 09:20: a month with 개천절, its 대체공휴일 and 한글날, and lunar dates.
        let calendar = Calendar.paper
        func at(_ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
            calendar.date(from: DateComponents(year: 2026, month: 10, day: day, hour: hour, minute: minute))!
        }
        let now = at(8, 9, 20)
        var notebook = Notebook()
        func todo(_ title: String, reminder: Date? = nil, due: String? = nil) {
            let item = notebook.add(title, now: at(7, 9))!
            if let reminder { _ = notebook.setReminder(id: item.id, at: reminder) }
            if let due { _ = notebook.setDue(id: item.id, dueDate: due) }
        }
        todo(t("치과 예약", "Book the dentist", "Tandarts bellen"), reminder: at(8, 15))
        todo(t("장보기", "Groceries", "Boodschappen"), due: "2026-10-08")
        todo(t("도서관 책 반납", "Return library books", "Bibliotheekboeken terugbrengen"), reminder: at(9, 11))
        todo(t("약 먹기", "Take medicine", "Medicijn innemen"), reminder: at(8, 8))
        todo(t("운동복 챙기기", "Pack gym clothes", "Sportkleren inpakken"), due: "2026-10-08")
        todo(t("보고서 초안", "Draft the report", "Rapport opzetten"), due: "2026-10-14")
        todo(t("화분에 물 주기", "Water the plants", "Planten water geven"), due: "2026-10-21")
        todo(t("우편물 부치기", "Post the letters", "Brieven posten"), reminder: at(22, 10))
        let storage = folder.appendingPathComponent("todos.json")
        try NotebookFile(url: storage).save(notebook)
        // #274: two repeating to-dos — every Monday, and Fridays at 17:00 — on the days they come back (the next one solid).
        struct Repeats: Encodable { var series: [Series] }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        try encoder.encode(Repeats(series: [
            Series(id: "R1", title: t("분리수거", "Recycling", "Oud papier"), rule: RepeatRule(kind: .weekly, weekdays: [1]), createdAt: at(1, 9)),
            Series(id: "R2", title: t("주간 회고", "Weekly review", "Weekoverzicht"), rule: RepeatRule(kind: .weekly, weekdays: [5]), remindAt: "17:00",
                   createdAt: at(1, 9)),
        ])).write(to: folder.appendingPathComponent("repeats.json"))
        let model = AppModel(storageURL: storage, isolated: true, preferences: preferences)
        model.paperColor = night ? .night : .day
        func event(_ id: String, _ title: String, _ color: LocalEvent.Color, day: Int, _ hour: Int, _ minute: Int = 0, length: Int = 60,
                   allDay: Bool = false) -> LocalEvent {
            let start = hour * 60 + minute
            return LocalEvent(id: id, title: title, date: String(format: "2026-10-%02d", day), allDay: allDay, start: start, end: start + length, color: color)
        }
        let events = [
            event("a", t("팀 회의", "Team meeting", "Teamoverleg"), .sage, day: 8, 10),
            event("b", t("점심 약속", "Lunch with Mina", "Lunch met Mina"), .purple, day: 8, 12),
            event("c", t("운동", "Workout", "Sporten"), .blue, day: 8, 18, 30),
            event("d", t("가족 모임", "Family dinner", "Familiediner"), .coral, day: 16, 18, length: 120),
            event("e", t("치과 검진", "Dentist check-up", "Tandartscontrole"), .blue, day: 12, 9, 30),
            event("f", t("스터디", "Study group", "Studiegroep"), .purple, day: 1, 19),
            event("g", t("스터디", "Study group", "Studiegroep"), .purple, day: 15, 19),
            event("h", t("생일", "Birthday", "Verjaardag"), .yellow, day: 23, 0, allDay: true),
            event("i", t("팀 회의", "Team meeting", "Teamoverleg"), .sage, day: 20, 10),
            event("j", t("이사 준비", "Moving prep", "Verhuizing"), .gray, day: 28, 14),
            // calendar-flows D1: a three-day trip (Sun–Tue): its band joins along the row, the title once.
            LocalEvent(id: "k", title: t("제주 여행", "Trip to Jeju", "Reis naar Jeju"), date: "2026-10-18", allDay: true, days: 3, color: .sage),
        ]
        model.calendar.showForSnapshot(events)
        let widgets = CalendarWidgets.shared
        widgets.feed.events = events
        widgets.feed.tasks = model.hereItems
        widgets.feed.series = model.hereSeries
        widgets.feed.now = now

        let kinds: [(CalendarWidget.Kind, CalendarWidget.Style, String)] = [
            (.today, .simple, "today"), (.week, .simple, "week-simple"), (.week, .detail, "week-detail"),
            (.month, .simple, "month-simple"), (.month, .detail, "month-detail"), (.month, .wall, "month-wall"), (.agenda, .simple, "agenda"),
        ]
        let plain: Wallpaper.Kind = night ? .dark : .light
        for (kind, style, name) in kinds {
            try scene(kind, style, opacity: 100, wall: plain, to: output.appendingPathComponent("widget-\(name)-100.png"))
            try scene(kind, style, opacity: 40, wall: .busy, to: output.appendingPathComponent("widget-\(name)-40-busy.png"))
        }
        try scene(.month, .simple, opacity: 40, wall: night ? .light : .dark, to: output.appendingPathComponent("widget-month-simple-40-other.png"))
        // #321: a desktop with icons behind the month at 20 · 50 · 85 · 100 %, light and dark — what shows through the paper.
        for opacity in [20, 50, 85, 100] {
            try scene(.month, .simple, opacity: opacity, wall: .lightIcons, to: output.appendingPathComponent("widget-month-simple-\(opacity)-icons-light.png"))
            try scene(.month, .simple, opacity: opacity, wall: .darkIcons, to: output.appendingPathComponent("widget-month-simple-\(opacity)-icons-dark.png"))
        }
        try scene(.month, .detail, opacity: 20, wall: night ? .darkIcons : .lightIcons, to: output.appendingPathComponent("widget-month-detail-20-icons.png"))
        try scene(.week, .detail, opacity: 20, wall: night ? .darkIcons : .lightIcons, to: output.appendingPathComponent("widget-week-detail-20-icons.png"))
        try scene(.today, .simple, opacity: 20, wall: night ? .darkIcons : .lightIcons, to: output.appendingPathComponent("widget-today-20-icons.png"))
        // #296: two daily repeats and a weekday one fold into each day's head; #295: 11 October (음 9.1) busy, so its head has
        // +N beside the lunar date and the repeat mark.
        let quiet = (series: widgets.feed.series, tasks: widgets.feed.tasks)
        widgets.feed.series += [
            Series(id: "R3", title: t("물 마시기", "Drink water", "Water drinken"), rule: RepeatRule(kind: .daily), createdAt: at(1, 9)),
            Series(id: "R4", title: t("잠깐, 바깥 공기 쐬기", "Step outside for a moment", "Even naar buiten"), rule: RepeatRule(kind: .daily), createdAt: at(1, 9)),
            Series(id: "R5", title: t("아침 운동", "Morning workout", "Ochtendtraining"), rule: RepeatRule(kind: .weekdays), remindAt: "07:30", createdAt: at(1, 9)),
        ]
        widgets.feed.tasks += [(t("빨래 개기", "Fold the laundry", "Was vouwen"), 10), (t("화분 물 주기", "Water the plants", "Planten water geven"), 14),
                               (t("엄마한테 전화하기", "Call Mum", "Mama bellen"), 19), (t("택배 받기", "Pick up the parcel", "Pakket ophalen"), 20)]
            .map { TodoItem(title: $0.0, reminderAt: at(11, $0.1)) }
        for (style, name) in [(CalendarWidget.Style.simple, "simple"), (.detail, "detail"), (.wall, "wall")] {
            try scene(.month, style, opacity: 100, wall: plain, to: output.appendingPathComponent("widget-month-\(name)-repeats.png"))
        }
        try scene(.month, .detail, opacity: 100, wall: plain, scale: 0.85, to: output.appendingPathComponent("widget-month-detail-repeats-small.png"))
        widgets.feed.series = quiet.series
        widgets.feed.tasks = quiet.tasks
        // 크기 (#271): every kind at 작게 · 크게 · 아주 크게 (보통 is above) — the same lines in each cell, nothing cut; and the
        // month at 아주 크게 and 40 % over the busy wallpaper (the floors hold at any size).
        for (scale, word) in [(0.85, "small"), (1.25, "large"), (1.5, "xlarge")] {
            for (kind, style, name) in kinds {
                try scene(kind, style, opacity: 100, wall: plain, scale: scale, to: output.appendingPathComponent("widget-\(name)-size-\(word).png"))
            }
        }
        try scene(.month, .detail, opacity: 40, wall: .busy, scale: 1.5, to: output.appendingPathComponent("widget-month-detail-size-xlarge-40-busy.png"))
        try scene(.month, .detail, opacity: 40, wall: .busy, hover: true, to: output.appendingPathComponent("widget-month-detail-hover.png"))
        // #244: the widget follows the paper picked — a few papers by day (light ones and dark ones), at 100 % and 40 % over
        // the busy wallpaper, where each paper's own floor keeps the tiles readable.
        if !night {
            for paper in [PaperKind.kraft, .memo, .lined, .recycled, .nightsky, .chalk] {
                model.paperTheme = paper
                night = paper.isDark
                try scene(.month, .simple, opacity: 100, wall: night ? .dark : .light, to: output.appendingPathComponent("widget-paper-\(paper.rawValue)-month-100.png"))
                try scene(.month, .simple, opacity: 40, wall: .busy, to: output.appendingPathComponent("widget-paper-\(paper.rawValue)-month-40-busy.png"))
                try scene(.today, .simple, opacity: 100, wall: night ? .dark : .light, to: output.appendingPathComponent("widget-paper-\(paper.rawValue)-today-100.png"))
            }
            night = false
            model.paperTheme = .day
        }
        var toast = PaperToast(symbol: "checkmark", text: CalendarWidget.addedText(day: "2026-10-16", event: false, now: now, language: .current))
        toast.action = L("되돌리기")
        toast.perform = {}
        try scene(.month, .simple, opacity: 70, wall: plain, toast: toast, to: output.appendingPathComponent("widget-toast.png"))

        // The day sheet: a day with a line being written, and the busy day in full.
        let controller = WidgetDaySheetController()
        try panelSlip(WidgetDaySheetView(model: model, controller: controller, day: "2026-10-16",
                                         previewText: t("3시 팀 회의", "team meeting at 3pm", "teamoverleg om 15:00"), previewNow: now),
                      to: output.appendingPathComponent("widget-sheet.png"))
        try panelSlip(WidgetDaySheetView(model: model, controller: controller, day: "2026-10-08", previewText: "", previewNow: now),
                      to: output.appendingPathComponent("widget-sheet-busy.png"))
        try panelSlip(WidgetDaySheetView(model: model, controller: controller, day: "2026-10-16",
                                         previewText: t("알람 7시 약 먹기", "alarm 7am take medicine", "wekker 7:00 medicijn innemen"), previewNow: now),
                      to: output.appendingPathComponent("widget-sheet-alarm.png"))
        // #253: while a question that replaces the whole list waits, 넣기 dims (the text stays).
        try panelSlip(WidgetDaySheetView(model: model, controller: controller, day: "2026-10-16",
                                         previewText: t("3시 팀 회의", "team meeting at 3pm", "teamoverleg om 15:00"), previewNow: now, previewWaiting: true),
                      to: output.appendingPathComponent("widget-sheet-waiting.png"))
        // calendar-flows: a holiday's sheet — its name first.
        try panelSlip(WidgetDaySheetView(model: model, controller: controller, day: "2026-10-09", previewText: "", previewNow: now),
                      to: output.appendingPathComponent("widget-sheet-holiday.png"))

        // Settings: the gallery, one widget's slip, the desk's group.
        try panelSlip(WidgetGalleryView(widgets: widgets, done: {}), to: output.appendingPathComponent("widget-gallery.png"))
        let month = CalendarWidget.Settings(id: "w-1", kind: .month, style: .simple)
        let today = CalendarWidget.Settings(id: "w-2", kind: .today, style: .simple, opacity: 70, clickThrough: true)
        try panelSlip(WidgetSettingsView(widgets: widgets, original: month, done: {}), to: output.appendingPathComponent("widget-settings.png"))
        // #271: 벽 달력 on a 1280×800 display — 크게 · 아주 크게 don't fit there and are greyed out.
        let wall = CalendarWidget.Settings(id: "w-3", kind: .month, style: .wall)
        let small = CalendarWidget.Rect(x: 0, y: 25, width: 1280, height: 775)
        try panelSlip(WidgetSettingsView(widgets: widgets, original: wall,
                                         previewFitting: CalendarWidget.scales.filter { CalendarWidget.fits(.month, .wall, scale: $0, area: small) }, done: {}),
                      to: output.appendingPathComponent("widget-settings-small-screen.png"))
        widgets.showForSnapshot([month, today])
        let reminders = ReminderController(model: model, preferences: preferences, onOpen: {})
        let archive = ArchiveStore(model: model)
        try render(DeskView(state: DeskState(pane: .events), model: model, archive: archive, reminders: reminders, previewTitlebar: true),
                   size: DeskMetrics.size, to: output.appendingPathComponent("widget-desk.png"))
        widgets.showForSnapshot([])
        try render(DeskView(state: DeskState(pane: .events), model: model, archive: archive, reminders: reminders, previewTitlebar: true),
                   size: DeskMetrics.size, to: output.appendingPathComponent("widget-desk-empty.png"))
        _ = model
    }

    /// A widget at `opacity` on a wallpaper, 28 pt in from its left and 24 pt from its top.
    @MainActor
    static func scene(_ kind: CalendarWidget.Kind, _ style: CalendarWidget.Style, opacity: Int, wall: Wallpaper.Kind, hover: Bool = false,
                      toast: PaperToast? = nil, scale: Double = 1, to url: URL) throws {
        let window = CalendarWidget.windowSize(kind, style, scale: scale)
        let inset = CGPoint(x: 28, y: 24)
        let size = CGSize(width: window.width + 56, height: window.height + 48 + (toast == nil ? 0 : 0))
        let state = WidgetState(settings: CalendarWidget.Settings(id: "snap", kind: kind, style: style, opacity: opacity, scale: scale))
        state.hovering = hover
        state.toast = toast
        state.scale = scale
        let view = ZStack(alignment: .topLeading) {
            Wallpaper(kind: wall)
            CalendarWidgetView(state: state, feed: CalendarWidgets.shared.feed, widgets: CalendarWidgets.shared)
                // The window's shadow: of the whole widget, and only under a solid paper (#321, CalendarWidgets.castsShadow).
                .compositingGroup()
                .shadow(color: opacity == 100 ? .black.opacity(night ? 0.45 : 0.18) : .clear, radius: 7, y: 4)
                .offset(x: inset.x, y: inset.y)
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .environment(\.colorScheme, night ? .dark : .light)
        // SwiftUI's own renderer: it draws the shadows as the window does.
        let renderer = ImageRenderer(content: view)
        renderer.scale = 2
        guard let image = renderer.cgImage else { throw CocoaError(.fileWriteUnknown) }
        let bitmap = NSBitmapImageRep(cgImage: image)
        try bitmap.representation(using: .png, properties: [:])!.write(to: url)
    }

    /// A slip through its real window, on the desk colour.
    @MainActor
    static func panelSlip<V: View>(_ view: V, to url: URL) throws {
        let panel = SlipPanel(nonactivating: true)
        panel.appearance = NSAppearance(named: night ? .darkAqua : .aqua)
        panel.setFrameOrigin(NSPoint(x: -40_000, y: -40_000))
        panel.show(view)
        RunLoop.main.run(until: Date().addingTimeInterval(0.25))
        guard let hosting = panel.contentView else { throw CocoaError(.fileWriteUnknown) }
        let desk = Backdrop(frame: NSRect(origin: .zero, size: panel.frame.size))
        panel.contentView = desk
        hosting.frame = desk.bounds
        desk.addSubview(hosting)
        desk.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.15))
        guard let bitmap = desk.bitmapImageRepForCachingDisplay(in: desk.bounds) else { throw CocoaError(.fileWriteUnknown) }
        desk.cacheDisplay(in: desk.bounds, to: bitmap)
        try bitmap.representation(using: .png, properties: [:])!.write(to: url)
        panel.close()
    }

    private final class Backdrop: NSView {
        override func draw(_ dirtyRect: NSRect) {
            NSColor(PaperTheme.desk).setFill()
            dirtyRect.fill()
        }
    }

    @MainActor
    static func render<V: View>(_ view: V, size: NSSize, to url: URL) throws {
        let hosting = NSHostingView(rootView: view)
        let window = NSWindow(contentRect: NSRect(origin: NSPoint(x: -40_000, y: -40_000), size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: night ? .darkAqua : .aqua)
        window.contentView = hosting
        hosting.frame = NSRect(origin: .zero, size: size)
        hosting.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.2))
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else { throw CocoaError(.fileWriteUnknown) }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        try bitmap.representation(using: .png, properties: [:])!.write(to: url)
        window.close()
    }
}

/// Made-up wallpapers: a light sky, a night sky, and a busy one (bold colours and stripes) — the worst a widget meets.
struct Wallpaper: View {
    enum Kind { case light, dark, busy, lightIcons, darkIcons }
    let kind: Kind

    var body: some View {
        switch kind {
        case .lightIcons, .darkIcons:
            IconDesktop(dark: kind == .darkIcons)
        case .light:
            ZStack {
                LinearGradient(colors: [Color(red: 0.81, green: 0.89, blue: 0.93), Color(red: 0.93, green: 0.95, blue: 0.92), Color(red: 0.91, green: 0.86, blue: 0.77)],
                               startPoint: .top, endPoint: .bottom)
                RadialGradient(colors: [Color(red: 1, green: 0.98, blue: 0.91), .clear], center: UnitPoint(x: 0.8, y: 0.2), startRadius: 0, endRadius: 140)
            }
        case .dark:
            ZStack {
                LinearGradient(colors: [Color(red: 0.06, green: 0.08, blue: 0.13), Color(red: 0.11, green: 0.15, blue: 0.21), Color(red: 0.17, green: 0.19, blue: 0.26)],
                               startPoint: .top, endPoint: .bottom)
                RadialGradient(colors: [Color(red: 0.23, green: 0.28, blue: 0.4), .clear], center: UnitPoint(x: 0.78, y: 0.22), startRadius: 0, endRadius: 150)
            }
        case .busy:
            Canvas { context, size in
                context.fill(Path(CGRect(origin: .zero, size: size)),
                             with: .linearGradient(Gradient(colors: [Color(red: 0.11, green: 0.54, blue: 0.31), Color(red: 0.94, green: 0.54, blue: 0.14),
                                                                      Color(red: 0.42, green: 0.17, blue: 0.72)]),
                                                   startPoint: .zero, endPoint: CGPoint(x: size.width, y: size.height)))
                let blobs: [(CGFloat, CGFloat, CGFloat, Color)] = [(0.2, 0.3, 0.2, Color(red: 0.91, green: 0.27, blue: 0.24)),
                                                                   (0.7, 0.7, 0.24, Color(red: 0.16, green: 0.38, blue: 0.84)),
                                                                   (0.85, 0.2, 0.15, Color(red: 0.95, green: 0.78, blue: 0.14))]
                for (x, y, r, color) in blobs {
                    let radius = r * max(size.width, size.height)
                    context.fill(Path(ellipseIn: CGRect(x: x * size.width - radius, y: y * size.height - radius, width: radius * 2, height: radius * 2)), with: .color(color))
                }
                for i in stride(from: -size.height, to: size.width + size.height, by: 27) {
                    var stripe = Path()
                    stripe.move(to: CGPoint(x: i, y: 0))
                    stripe.addLine(to: CGPoint(x: i + size.height * 0.53, y: size.height))
                    context.stroke(stripe, with: .color(.white.opacity(0.85)), lineWidth: 5)
                }
                for i in stride(from: -size.width, to: size.width + size.height, by: 40) {
                    var stripe = Path()
                    stripe.move(to: CGPoint(x: 0, y: i))
                    stripe.addLine(to: CGPoint(x: size.width, y: i - size.width * 0.5))
                    context.stroke(stripe, with: .color(.black.opacity(0.7)), lineWidth: 6)
                }
            }
        }
    }
}

/// #321: a desktop with icons (folders and files, made-up names) on a light or dark wallpaper — what should show through
/// a faint widget.
struct IconDesktop: View {
    let dark: Bool

    var body: some View {
        GeometryReader { geometry in
            let step = CGSize(width: 86, height: 84)
            let columns = Int(geometry.size.width / step.width) + 1, rows = Int(geometry.size.height / step.height) + 1
            ZStack(alignment: .topLeading) {
                Wallpaper(kind: dark ? .dark : .light)
                ForEach(0..<(columns * rows), id: \.self) { index in
                    let (row, column) = index.quotientAndRemainder(dividingBy: columns)
                    icon(index).position(x: 44 + CGFloat(column) * step.width, y: 40 + CGFloat(row) * step.height)
                }
            }
        }
    }

    private static let names = [("회사", "Work", "Werk", true), ("집", "Home", "Thuis", true), ("장보기.txt", "Groceries.txt", "Boodschappen.txt", false),
                                ("공부", "Study", "Studie", true), ("사진", "Photos", "Foto's", true), ("영수증.pdf", "Receipt.pdf", "Bon.pdf", false),
                                ("여행 계획.txt", "Trip plan.txt", "Reisplan.txt", false)]

    private func icon(_ index: Int) -> some View {
        let name = Self.names[index % Self.names.count]
        return VStack(spacing: 3) {
            Image(systemName: name.3 ? "folder.fill" : "doc.text.fill")
                .font(.system(size: 34))
                .foregroundStyle(name.3 ? Color(red: 0.36, green: 0.66, blue: 0.94) : Color(white: 0.97))
                .shadow(color: .black.opacity(0.25), radius: 1.5, y: 1)
            Text(WidgetSnapshots.t(name.0, name.1, name.2))
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(dark ? Color.white : Color(white: 0.1))
                .lineLimit(1)
        }
        .frame(width: 80)
    }
}
