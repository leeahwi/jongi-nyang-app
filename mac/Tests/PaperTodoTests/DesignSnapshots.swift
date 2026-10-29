import AppKit
import PaperCore
import SwiftUI

/// Renders real SwiftUI views using disposable data, without reading user notes.
@main
@MainActor
enum DesignSnapshots {
    static func main() async throws {
        // `PAPERTODO_LANG=en` / `nl` (scripts/render-design.sh en): the app's text and the sample
        // data in that language; Korean when unset.
        L10n.activate(setting: ProcessInfo.processInfo.environment["PAPERTODO_LANG"] ?? "ko", preferred: [])
        _ = NSApplication.shared
        // `PAPERTODO_PAPER=night` (scripts/render-design.sh ko night): everything in 밤 종이.
        NSApp.appearance = NSAppearance(named: night ? .darkAqua : .aqua)
        NSApp.setActivationPolicy(.prohibited)
        HandwritingFont.register()
        // Slips are drawn settled (no rise-and-turn as they appear).
        SlipMotion.enabled = false
        let output = URL(fileURLWithPath: CommandLine.arguments[1])
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("PaperDesign-\(UUID())")
        let suite = "PaperTodo.Design.\(UUID())"
        let preferences = UserDefaults(suiteName: suite)!
        defer {
            preferences.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: folder)
        }
        preferences.set(false, forKey: "reminder.enabled")
        var notebook = Notebook()
        // The demo list (AppModel's --demo), in the language being drawn.
        let first = notebook.add(L("창문 열고, 커피 한 잔"))!
        notebook.toggle(id: first.id)
        let scheduled = notebook.add(L("오늘 꼭 해야 할 일 정리하기"))!
        notebook.setReminder(id: scheduled.id, at: Date().addingTimeInterval(3600))
        _ = notebook.add(L("미뤄 둔 책 10쪽 읽기"))
        _ = notebook.add(L("잠깐, 바깥 공기 쐬기"))
        _ = notebook.add(L("내일의 나에게 메모 남기기"))
        let storage = folder.appendingPathComponent("todos.json")
        try NotebookFile(url: storage).save(notebook)
        let model = AppModel(storageURL: storage, isolated: true, preferences: preferences)
        model.paperColor = night ? .night : .day
        for font in NotebookFont.allCases {
            model.notebookFont = font
            try render(PaperView(model: model), size: NSSize(width: 420, height: 560),
                       to: output.appendingPathComponent("note-\(font.rawValue).png"))
        }
        model.notebookFont = .pen
        try render(PaperView(model: model), size: NSSize(width: 350, height: 400),
                   to: output.appendingPathComponent("note-small-cat.png"))
        // 오늘 일정: the app's own events above the tasks.
        let now = Date()
        func timed(_ id: String, _ title: String, _ color: LocalEvent.Color, _ from: Double, _ to: Double,
                   repeating: LocalEvent.Repeat = .none, location: String? = nil) -> LocalEvent {
            let start = now.addingTimeInterval(from * 60), end = now.addingTimeInterval(to * 60)
            return LocalEvent(id: id, title: title, date: CalendarDraft.day(start), start: CalendarDraft.minutes(start),
                              end: CalendarDraft.minutes(end), repeatRule: repeating, color: color, location: location)
        }
        let todayKey = CalendarDraft.day(CalendarDay.window(now).start)
        let snapshotEvents = [
            LocalEvent(id: "birthday", title: t("엄마 생신", "Mom’s birthday", "Verjaardag mama"), date: todayKey, allDay: true, repeatRule: .yearly, color: .coral),
            timed("study", t("아침 스터디", "Morning study", "Ochtendstudie"), .purple, -120, -60),
            timed("standup", t("팀 회의", "Team meeting", "Teamoverleg"), .sage, -15, 30, repeating: .weekly),
            timed("dentist", t("치과", "Dentist", "Tandarts"), .blue, 40, 80, location: t("연세바른치과", "Bright Smile Dental", "Tandartspraktijk De Linde")),
            timed("dinner", t("저녁 약속", "Dinner with friends", "Uit eten met vrienden"), .yellow, 300, 420),
            timed("gym", t("운동", "Gym", "Sporten"), .blue, 480, 540),
        ]
        model.calendar.showForSnapshot(snapshotEvents)
        try render(PaperView(model: model), size: NSSize(width: 420, height: 560),
                   to: output.appendingPathComponent("note-calendar.png"))
        // Window sizes: the note at its smallest and its largest.
        try render(PaperView(model: model), size: NSSize(width: 350, height: 400), to: output.appendingPathComponent("size-note-min.png"))
        try render(PaperView(model: model), size: NSSize(width: 720, height: 1200), to: output.appendingPathComponent("size-note-max.png"))
        // The sheet: putting a to-do on the calendar, a repeating event being changed, and removing it.
        let tomorrow3 = Calendar.current.date(bySettingHour: 15, minute: 0, second: 0, of: Calendar.current.date(byAdding: .day, value: 1, to: now)!)!
        let sendDraft = CalendarDraft.forTask(title: t("보고서 마무리", "Finish the report", "Rapport afmaken"), reminderAt: tomorrow3, dueDate: nil, now: now, taskId: "T1")
        try slip(CalendarEventSheet(calendar: model.calendar, request: CalendarSheetRequest(mode: .send, draft: sendDraft), onClose: {}),
                 to: output.appendingPathComponent("calendar-send.png"))
        let weekly = snapshotEvents[2]
        try slip(CalendarEventSheet(calendar: model.calendar, request: CalendarSheetRequest(mode: .edit(weekly, day: weekly.date), draft: .forEvent(weekly)), onClose: {}),
                 to: output.appendingPathComponent("calendar-edit.png"))
        try slip(CalendarEventSheet(calendar: model.calendar, request: CalendarSheetRequest(mode: .edit(weekly, day: weekly.date), draft: .forEvent(weekly), confirmDelete: true), onClose: {}),
                 to: output.appendingPathComponent("calendar-delete.png"))
        try slip(CalendarEventSheet(calendar: model.calendar, request: CalendarSheetRequest(mode: .new, draft: .new(now: now)), onClose: {}),
                 to: output.appendingPathComponent("calendar-new.png"))
        var allDay = CalendarDraft.new(now: now)
        allDay.title = t("제주 여행", "Trip to Jeju", "Reis naar Jeju")
        allDay.allDay = true
        allDay.days = 3
        allDay.color = .sage
        try slip(CalendarEventSheet(calendar: model.calendar, request: CalendarSheetRequest(mode: .new, draft: allDay), onClose: {}),
                 to: output.appendingPathComponent("calendar-allday.png"))
        // One picker open: the sheet with the time list it opens beside its chip.
        let sheet = CalendarEventSheet(calendar: model.calendar, request: CalendarSheetRequest(mode: .new, draft: sendDraft), onClose: {})
        try slip(HStack(alignment: .top, spacing: 14) {
            sheet
            VStack(spacing: 14) {
                sheet.pickerView(.start).clipShape(RoundedRectangle(cornerRadius: 10)).slipShadow()
                sheet.pickerView(.date).background(PaperTheme.card).clipShape(RoundedRectangle(cornerRadius: 10)).slipShadow()
            }
            .padding(.top, 120)
        }, to: output.appendingPathComponent("calendar-picker.png"))
        // No events today: the card keeps its header and the +.
        model.calendar.showForSnapshot([timed("later", t("다음 주 일정", "Next week’s plan", "Afspraak volgende week"), .blue, 60 * 24 * 8, 60 * 24 * 8 + 60)])
        try render(PaperView(model: model), size: NSSize(width: 420, height: 400),
                   to: output.appendingPathComponent("note-calendar-empty.png"))
        // The other notes are drawn without events.
        model.calendar.showForSnapshot([])
        model.saveSeries(taskID: model.items[3].id, rule: RepeatRule(kind: .weekly, weekdays: [1, 3, 5]), remindAt: nil)
        model.saveSeries(title: t("물 마시기", "Drink water", "Water drinken"), rule: RepeatRule(kind: .daily), remindAt: "23:30")
        model.saveSeries(title: t("주간 회고 쓰기", "Write the weekly review", "Weekoverzicht schrijven"), rule: RepeatRule(kind: .weekly, weekdays: [5]), remindAt: "17:00")
        try render(PaperView(model: model), size: NSSize(width: 420, height: 560),
                   to: output.appendingPathComponent("note-repeat.png"))
        // 1.34: the 오늘 sheet with the 하루 띠, 다음 and the input line; typing; the toast.
        model.calendar.showForSnapshot(snapshotEvents)
        try render(PaperView(model: model), size: NSSize(width: 420, height: 640), to: output.appendingPathComponent("note-today.png"))
        try render(PaperView(model: model), size: NSSize(width: 350, height: 400), to: output.appendingPathComponent("size-note-min-today.png"))
        try render(PaperView(model: model, previewLine: t("내일 3시 회의", "meeting tomorrow 3pm", "morgen om 3 uur overleg")),
                   size: NSSize(width: 350, height: 480), to: output.appendingPathComponent("size-note-min-typing.png"))
        try render(PaperView(model: model, previewLine: t("알람 7시 평일", "alarm 7am weekdays", "wekker 7 uur doordeweeks")),
                   size: NSSize(width: 720, height: 900), to: output.appendingPathComponent("size-note-max-typing.png"))
        for (name, text) in [("event", t("내일 3시 회의", "meeting tomorrow 3pm", "morgen om 3 uur overleg")),
                             ("todo", t("내일 3시 장보기", "buy milk tomorrow 9am", "boodschappen morgen om 9 uur")),
                             ("timer", t("타이머 40", "timer 40", "timer 40")),
                             ("focus", t("보고서 25분 집중", "focus 25 report", "focus 25 rapport")),
                             ("alarm", t("알람 7시 평일", "alarm 7am weekdays", "wekker 7 uur doordeweeks")),
                             ("memo-slash", t("/메모 우유, 달걀", "/note milk, eggs", "/notitie melk, eieren")),
                             ("slash-problem", t("/알람 언젠가", "/alarm someday", "/wekker ooit")),
                             ("empty", "")] {
            try render(IntentLineView(model: model, page: .todos, previewText: text, previewFocused: !text.isEmpty)
                        .padding(12).frame(width: 420).background(PaperTheme.paper),
                       size: nil, to: output.appendingPathComponent("line-\(name).png"))
        }
        let eventCommit = IntentCommit(text: "", candidates: model.intentCandidates(t("내일 3시 회의", "meeting tomorrow 3pm", "morgen om 3 uur overleg")),
                                       index: 0, key: nil, made: .nothing, page: .todos)
        model.toast = model.makeToast(for: eventCommit, onChange: { _ in })
        try render(PaperView(model: model), size: NSSize(width: 420, height: 640), to: output.appendingPathComponent("note-toast.png"))
        model.toast = nil
        // 1.40 하루 띠: the day of the mock (now 13:20) — on now (an event, a to-do), nothing on (the next soon, far),
        // nothing left, narrow, tall and wide; then opened into the whole day (overlaps, done and late to-dos,
        // reminders, a crowd with +N) and the timer tag at several times.
        func at(_ hour: Int, _ minute: Int = 0) -> Date { Calendar.current.date(bySettingHour: hour, minute: minute, second: 0, of: now)! }
        let ribbonNow = at(13, 20)
        // The demo list's reminder (an hour from the real now) at a fixed 21:30 for these, so the day looks the same
        // whenever it's drawn (1.41; before, a morning render put it beside 메일 답장 and split that into two columns).
        let scheduledAt = model.items.first { $0.id == scheduled.id }?.reminderAt
        model.setTaskReminder(scheduled.id, at: at(21, 30))
        func event(_ id: String, _ title: String, _ color: LocalEvent.Color, _ from: Date, _ to: Date, location: String? = nil) -> LocalEvent {
            LocalEvent(id: id, title: title, date: CalendarDraft.day(from), start: CalendarDraft.minutes(from), end: CalendarDraft.minutes(to), color: color, location: location)
        }
        let ribbonDay = CalendarDraft.day(CalendarDay.window(ribbonNow).start)
        let ribbonEvents = [
            LocalEvent(id: "b", title: t("엄마 생신", "Mom’s birthday", "Verjaardag mama"), date: ribbonDay, allDay: true, color: .coral),
            LocalEvent(id: "h", title: t("한글날 연휴", "Long weekend", "Lang weekend"), date: ribbonDay, allDay: true, color: .yellow),
            LocalEvent(id: "c", title: t("청소 당번", "Cleaning duty", "Schoonmaakbeurt"), date: ribbonDay, allDay: true, color: .gray),
            event("s", t("아침 스터디", "Morning study", "Ochtendstudie"), .purple, at(9), at(10)),
            event("m", t("팀 회의", "Team meeting", "Teamoverleg"), .sage, at(13), at(14), location: t("3층 회의실", "Room 3B", "Zaal 3")),
            event("d", t("치과", "Dentist", "Tandarts"), .blue, at(15, 30), at(16, 30), location: t("연세바른치과", "Bright Smile Dental", "Tandartspraktijk De Linde")),
            event("y", t("요가", "Yoga", "Yoga"), .purple, at(19), at(20)),
        ]
        model.calendar.showForSnapshot(ribbonEvents)
        func ranged(_ title: String, _ start: String, _ end: String?, done: Bool = false) -> UUID {
            model.add(title, literal: true)
            let id = model.items.last!.id
            let startMinutes = TimeBlock.minutes(start)!
            model.setTimeRange(id, to: TimeRange(start: startMinutes, end: end.flatMap(TimeBlock.minutes)))
            if done { model.toggle(id) }
            return id
        }
        let report = ranged(t("보고서 마무리", "Finish the report", "Rapport afmaken"), "14:00", "15:30")
        model.setTaskReminder(report, at: at(13, 45))
        model.add(t("물 마시기", "Drink water", "Water drinken"), literal: true)
        let water = model.items.last!.id
        model.setTaskReminder(water, at: at(16))
        let shopping = ranged(t("장보기", "Groceries", "Boodschappen"), "17:00", nil)
        let strip = { (time: Date, width: CGFloat, height: CGFloat) in
            DayStripView(model: model, calendar: model.calendar, noteHeight: height, now: time).frame(width: width).background(PaperTheme.paper)
        }
        let timetable = { (preview: TimetablePreview) in
            DayStripView(model: model, calendar: model.calendar, noteHeight: 640, now: ribbonNow, timetablePreview: preview)
                .frame(width: 420).background(PaperTheme.paper)
        }
        try render(strip(ribbonNow, 420, 560), size: nil, to: output.appendingPathComponent("strip-now-event.png"))
        try render(strip(at(14, 20), 420, 560), size: nil, to: output.appendingPathComponent("strip-now-task.png"))
        try render(strip(at(12, 40), 420, 560), size: nil, to: output.appendingPathComponent("strip-next-soon.png"))
        try render(strip(at(10, 30), 420, 560), size: nil, to: output.appendingPathComponent("strip-next-far.png"))
        try render(strip(at(23, 50), 420, 560), size: nil, to: output.appendingPathComponent("strip-nothing.png"))
        try render(strip(ribbonNow, 350, 560), size: nil, to: output.appendingPathComponent("strip-narrow.png"))
        try render(strip(at(14, 20), 350, 560), size: nil, to: output.appendingPathComponent("strip-narrow-task.png"))
        try render(strip(ribbonNow, 420, 800), size: nil, to: output.appendingPathComponent("strip-tall.png"))
        try render(strip(ribbonNow, 720, 1000), size: nil, to: output.appendingPathComponent("strip-wide.png"))
        for (name, size) in [("note-strip", NSSize(width: 420, height: 640)), ("note-strip-narrow", NSSize(width: 350, height: 560)),
                             ("note-strip-small", NSSize(width: 350, height: 400)), ("note-strip-wide", NSSize(width: 720, height: 900))] {
            try render(PaperView(model: model, previewNow: ribbonNow), size: size, to: output.appendingPathComponent("\(name).png"))
        }
        // Opened: a done to-do, one over and not done, a reminder beside a to-do (two columns), now at 13:20.
        let done = ranged(t("서류 정리", "Sort the papers", "Papieren ordenen"), "10:30", "11:30", done: true)
        let late = ranged(t("메일 답장", "Answer emails", "Mails beantwoorden"), "11:45", "12:30")
        model.add(t("약 먹기", "Take my medicine", "Medicijnen innemen"), literal: true)
        let pill = model.items.last!.id
        model.setTaskReminder(pill, at: at(14, 30))
        model.calendar.setDayOpen(true, now: ribbonNow)
        try render(strip(ribbonNow, 420, 640), size: nil, to: output.appendingPathComponent("day-open.png"))
        try render(strip(ribbonNow, 350, 560), size: nil, to: output.appendingPathComponent("day-open-narrow.png"))
        try render(strip(at(9, 10), 420, 640), size: nil, to: output.appendingPathComponent("day-open-morning.png"))
        try render(PaperView(model: model, previewNow: ribbonNow), size: NSSize(width: 420, height: 760), to: output.appendingPathComponent("note-day-open.png"))
        try render(PaperView(model: model, previewNow: ribbonNow), size: NSSize(width: 720, height: 1000), to: output.appendingPathComponent("note-day-open-wide.png"))
        // 1.41: the pointer on 보고서's top band (↕ and its grab bar); 보고서 dragged 31 pt down (it follows the pointer, the
        // ghost and the label show where it lands: 14:30–16:00); its bottom stretched (to 16:15) and its top (to 13:30);
        // the dentist's end stretched (to 17:00); then dropped, 14:00–16:00, with the toast.
        let reportID = report.uuidString
        try render(timetable(TimetablePreview(id: reportID, edge: .start, hover: true)), size: nil, to: output.appendingPathComponent("day-band-hover.png"))
        try render(timetable(TimetablePreview(id: reportID, edge: .whole, points: 31)), size: nil, to: output.appendingPathComponent("day-drag.png"))
        try render(timetable(TimetablePreview(id: reportID, edge: .end, points: 33)), size: nil, to: output.appendingPathComponent("day-stretch-bottom.png"))
        try render(timetable(TimetablePreview(id: reportID, edge: .start, points: -28)), size: nil, to: output.appendingPathComponent("day-stretch-top.png"))
        if let dentist = model.calendar.todayEvents(now: ribbonNow).first(where: { $0.title == t("치과", "Dentist", "Tandarts") }) {
            try render(timetable(TimetablePreview(id: dentist.key, edge: .end, points: 26)), size: nil, to: output.appendingPathComponent("day-stretch-event.png"))
        }
        model.setTimeRange(report, to: TimeRange(start: 840, end: 960))
        model.toast = PaperToast(symbol: "clock", text: L("시간을 바꿨어요 · \(TimeRange(start: 840, end: 960).text(.current))"), action: L("되돌리기"), perform: {})
        try render(PaperView(model: model, previewNow: ribbonNow), size: NSSize(width: 420, height: 760), to: output.appendingPathComponent("note-day-stretched.png"))
        model.toast = nil
        model.setTimeRange(report, to: TimeRange(start: 840, end: 930))
        // A crowd at 15:30: the dentist and three to-dos and a reminder — three columns, then +N.
        let crowd = [ranged(t("발표 연습", "Practice the talk", "Presentatie oefenen"), "15:30", "16:00"),
                     ranged(t("자료 출력", "Print the slides", "Slides printen"), "15:45", "16:15"),
                     ranged(t("우편 보내기", "Post the letter", "Brief posten"), "16:00", "16:30")]
        model.add(t("전화하기", "Call back", "Terugbellen"), literal: true)
        let call = model.items.last!.id
        model.setTaskReminder(call, at: at(16, 5))
        try render(strip(at(15, 0), 420, 640), size: nil, to: output.appendingPathComponent("day-open-crowded.png"))
        model.calendar.setDayOpen(false, now: ribbonNow)
        try render(TimetableNewItem(minutes: 15 * 60, onMake: { _, _ in }, onCancel: {}).padding(14).background(PaperTheme.desk),
                   size: nil, to: output.appendingPathComponent("day-new-item.png"))
        try render(TimetableNewItem(minutes: 15 * 60, onMake: { _, _ in }, onCancel: {}, text: t("치과 예약 전화", "dentist appointment", "afspraak tandarts")).padding(14).background(PaperTheme.desk),
                   size: nil, to: output.appendingPathComponent("day-new-item-event.png"))
        for id in [report, water, shopping, done, late, pill, call] + crowd { model.delete(id) }
        model.setTaskReminder(scheduled.id, at: scheduledAt)
        // The timer tag at 10:00, 9:59, 1:11, 0:08, 59:59, 1:00:00: the same width in each form (1.40).
        let tagStart = Date()
        func tag(_ minutes: Int, left: TimeInterval) -> some View {
            TimerBoard(timer: FocusTimer.countdown(minutes: minutes, now: tagStart), now: tagStart.addingTimeInterval(TimeInterval(minutes * 60) - left))
                .fixedSize()
                .background(alignment: .leading) { Rectangle().fill(Color.red.opacity(0.25)).frame(width: 1).offset(x: -1) }
        }
        try render(VStack(alignment: .leading, spacing: 22) {
            tag(10, left: 600); tag(10, left: 599); tag(10, left: 71); tag(10, left: 8); tag(60, left: 3599); tag(60, left: 3600); tag(120, left: 7199)
        }.padding(.horizontal, 24).padding(.vertical, 20).background(desktop), size: nil, to: output.appendingPathComponent("timer-widths.png"))
        // 1.39 할 일 시간 정하기: rows with ranges (one overlapping another, one going on now, one done, one over and not
        // done, a start alone); the editor's 시간; the line's chips.
        let blockTasks = [
            ranged(t("보고서 쓰기", "Write the report", "Verslag schrijven"), "14:00", "15:30"),
            ranged(t("메일 답장", "Answer emails", "Mails beantwoorden"), "14:15", "14:45"),
            ranged(t("장보기", "Groceries", "Boodschappen"), "11:00", "12:00", done: true),
            ranged(t("서류 정리", "Sort the papers", "Papieren ordenen"), "12:30", "13:30"),
            ranged(t("운동", "Workout", "Sporten"), "19:00", nil),
        ]
        model.calendar.showForSnapshot(ribbonEvents)
        try render(PaperView(model: model), size: NSSize(width: 420, height: 720), to: output.appendingPathComponent("note-ranges.png"))
        try render(PaperView(model: model), size: NSSize(width: 350, height: 560), to: output.appendingPathComponent("note-ranges-narrow.png"))
        let rangedItem = model.items.first { $0.id == blockTasks[0] }!
        let timeEditor = TaskReminderEditorView(item: rangedItem, model: model, onSave: { _ in }, onRemove: {}, onCancel: {}, startOnTime: true)
        try render(timeEditor, size: nil, to: output.appendingPathComponent("editor-time.png"))
        try render(HStack(alignment: .top, spacing: 14) {
            timeEditor
            TimePickerList(minutes: 15 * 60 + 30) { _ in }.clipShape(RoundedRectangle(cornerRadius: 10)).slipShadow().padding(.top, 120)
        }.padding(14).background(PaperTheme.paper), size: nil, to: output.appendingPathComponent("editor-time-list.png"))
        let plainItem = model.items.first { $0.timeRange == nil && !$0.isCompleted }!
        try render(TaskReminderEditorView(item: plainItem, model: model, onSave: { _ in }, onRemove: {}, onCancel: {}, startOnTime: true),
                   size: nil, to: output.appendingPathComponent("editor-time-new.png"))
        for (name, text) in [("range", t("3시부터 5시까지 보고서", "report 2-4pm", "verslag van 2 tot 4 uur")),
                             ("range-event", t("내일 10시~11시 반 회의", "meeting tomorrow 10-11am", "morgen van 9 tot 10 uur overleg"))] {
            try render(IntentLineView(model: model, page: .todos, previewText: text, previewFocused: true)
                        .padding(12).frame(width: 420).background(PaperTheme.paper),
                       size: nil, to: output.appendingPathComponent("line-\(name).png"))
            try render(IntentLineView(model: model, page: .todos, previewText: text, previewFocused: true)
                        .padding(12).frame(width: 350).background(PaperTheme.paper),
                       size: nil, to: output.appendingPathComponent("line-\(name)-narrow.png"))
        }
        for id in blockTasks { model.delete(id) }
        model.calendar.showForSnapshot(ribbonEvents)
        // Washi tabs up close: every state, with and without counts, in each face; then the header narrow and wide.
        for font in NotebookFont.allCases {
            try zoom(VStack(alignment: .leading, spacing: 10) {
                ForEach([true, false], id: \.self) { counts in
                    HStack(alignment: .bottom, spacing: 4) {
                        IndexTab(title: L("오늘"), count: counts ? 6 : nil, color: IndexTab.color(.todos), font: font, active: true) {}
                        IndexTab(title: L("앞으로"), count: counts ? 12 : nil, color: IndexTab.color(.ahead), font: font, active: false, previewHover: true) {}
                    }
                    .padding(.horizontal, 8)
                    .background(alignment: .bottom) { Rectangle().fill(IndexTab.color(.todos)).frame(height: 3) }
                }
            }.padding(8).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading).background(PaperTheme.paper),
                     size: NSSize(width: 400, height: 92), height: 92, to: output.appendingPathComponent("tabs-\(font.rawValue).png"))
        }
        model.notebookFont = .pen
        model.calendar.showForSnapshot(snapshotEvents)
        try zoom(PaperView(model: model), size: NSSize(width: 350, height: 400), height: 120, to: output.appendingPathComponent("header-narrow.png"))
        try zoom(PaperView(model: model), size: NSSize(width: 720, height: 600), height: 120, to: output.appendingPathComponent("header-wide.png"))
        // The header cat peeking over its edge, awake and (23:00–05:00) asleep, nodding — up close.
        try zoom(HStack(alignment: .bottom, spacing: 24) {
            PeekingCat(hour: 10)
            PeekingCat(nodding: true, hour: 10)
            PeekingCat(hour: 23)
        }
        .padding(.horizontal, 20).padding(.top, 24).padding(.bottom, 14)
        .frame(width: 320, height: 110, alignment: .bottom)
        .background(PaperBackground()), size: NSSize(width: 320, height: 110), height: 110, to: output.appendingPathComponent("header-cat.png"))
        model.calendar.showForSnapshot([])
        // Deadlines: this week, overdue, this month.
        model.setDue(model.items[2].id, to: Deadline.day(for: .thisWeek, now: Date(), language: .current))
        model.setDue(model.items[4].id, to: Deadline.key(Calendar.current.date(byAdding: .day, value: -1, to: Date())!))
        model.setDue(model.items[1].id, to: Deadline.day(for: .thisMonth, now: Date()))
        try render(PaperView(model: model), size: NSSize(width: 420, height: 560),
                   to: output.appendingPathComponent("note-deadlines.png"))
        model.dueStyle = .date
        try render(PaperView(model: model), size: NSSize(width: 420, height: 560),
                   to: output.appendingPathComponent("note-deadlines-date.png"))
        model.dueStyle = .dday
        try render(TaskReminderEditorView(item: model.items[2], model: model, onSave: { _ in }, onRemove: {}, onCancel: {}, startOnDeadline: true),
                   size: nil, to: output.appendingPathComponent("editor-deadline.png"))
        model.setDue(model.items[2].id, to: Deadline.key(Calendar.current.date(byAdding: .day, value: 12, to: Date())!))
        try render(TaskReminderEditorView(item: model.items[2], model: model, onSave: { _ in }, onRemove: {}, onCancel: {}, startOnDeadline: true),
                   size: nil, to: output.appendingPathComponent("editor-deadline-date.png"))
        model.setDue(model.items[2].id, to: Deadline.day(for: .thisWeek, now: Date(), language: .current))
        // 1.35: 앞으로 — empty, then this week's and next week's days (events and deadlines), 그 뒤 by
        // month, 언젠가; a drag onto a day; narrow and wide; its header up close.
        let aheadSaved = model.items.filter { Shelf.page(of: $0, now: now) != .today }.map { ($0.id, $0.dueDate, $0.shelf) }
        for (id, _, _) in aheadSaved { model.moveToToday(id) }
        model.page = .ahead
        try render(PaperView(model: model), size: NSSize(width: 420, height: 560), to: output.appendingPathComponent("ahead-empty.png"))
        func dayKey(_ days: Int) -> String { Deadline.key(Calendar.paper.date(byAdding: .day, value: days, to: Archive.logicalDayStart(now))!) }
        func dated(_ title: String, _ days: Int) {
            model.add(title, literal: true)
            model.setDue(model.items.last!.id, to: dayKey(days))
        }
        dated(t("회의록 정리", "Tidy up the minutes", "Notulen uitwerken"), 1)
        dated(t("책 10쪽 읽기", "Read 10 pages", "10 bladzijden lezen"), 3)
        dated(t("발표 자료 보내기", "Send the slides", "Dia’s versturen"), 8)
        dated(t("세금 신고", "File the taxes", "Belastingaangifte doen"), 26)
        dated(t("연말 계획", "Year-end plans", "Plannen voor het jaareinde"), 70)
        model.addLater(t("자전거 바람 넣기", "Pump up the bike tyres", "Fietsbanden oppompen"))
        model.addLater(t("겨울옷 정리하기", "Sort the winter clothes", "Winterkleren opruimen"))
        func aheadEvent(_ id: String, _ title: String, _ color: LocalEvent.Color, days: Int, hour: Int? = nil, length: Int = 1) -> LocalEvent {
            let date = dayKey(days)
            guard let hour else { return LocalEvent(id: id, title: title, date: date, allDay: true, days: length, color: color) }
            return LocalEvent(id: id, title: title, date: date, start: hour * 60, end: (hour + length) * 60, color: color)
        }
        model.calendar.showForSnapshot([
            aheadEvent("weekly", t("주간 회의", "Weekly meeting", "Weekoverleg"), .sage, days: 1, hour: 10),
            aheadEvent("jeju", t("제주 여행", "Trip to Jeju", "Reis naar Jeju"), .yellow, days: 2, length: 2),
            aheadEvent("check", t("치과 정기 검진", "Dental checkup", "Controle tandarts"), .blue, days: 5, hour: 14),
            aheadEvent("party", t("수진이 생일 파티", "Sujin’s birthday party", "Verjaardagsfeest van Sujin"), .coral, days: 8, hour: 19, length: 3),
        ])
        try render(PaperView(model: model), size: NSSize(width: 420, height: 560), to: output.appendingPathComponent("ahead.png"))
        try render(PaperView(model: model), size: NSSize(width: 420, height: 900), to: output.appendingPathComponent("ahead-tall.png"))
        try render(PaperView(model: model), size: NSSize(width: 350, height: 400), to: output.appendingPathComponent("size-ahead-min.png"))
        try render(PaperView(model: model), size: NSSize(width: 720, height: 1200), to: output.appendingPathComponent("size-ahead-max.png"))
        let dragged = model.items.last { $0.dueDate == dayKey(3) }!.id
        try render(PaperView(model: model, previewAheadDrag: (dragged, .day(dayKey(5)))), size: NSSize(width: 420, height: 760),
                   to: output.appendingPathComponent("ahead-drag.png"))
        try render(PaperView(model: model, previewAheadDrag: (dragged, .someday)), size: NSSize(width: 420, height: 1000),
                   to: output.appendingPathComponent("ahead-drag-someday.png"))
        model.move(dragged, to: .day(dayKey(5)))
        try render(PaperView(model: model), size: NSSize(width: 420, height: 560), to: output.appendingPathComponent("ahead-toast.png"))
        model.undo()
        model.toast = nil
        try zoom(PaperView(model: model), size: NSSize(width: 350, height: 400), height: 120, to: output.appendingPathComponent("header-ahead-narrow.png"))
        try zoom(PaperView(model: model), size: NSSize(width: 720, height: 600), height: 120, to: output.appendingPathComponent("header-ahead-wide.png"))
        try render(PaperView(model: model, previewLine: t("금요일까지 보고서", "report by Friday", "verslag voor vrijdag")),
                   size: NSSize(width: 420, height: 560), to: output.appendingPathComponent("ahead-typing.png"))
        // 1.39: a day row with its time.
        dated(t("발표 연습", "Practice the talk", "Presentatie oefenen"), 1)
        let aheadRanged = model.items.last!.id
        model.setTimeRange(aheadRanged, to: TimeRange(start: 16 * 60, end: 17 * 60 + 30))
        try render(PaperView(model: model), size: NSSize(width: 420, height: 560), to: output.appendingPathComponent("ahead-ranges.png"))
        try render(PaperView(model: model), size: NSSize(width: 350, height: 560), to: output.appendingPathComponent("ahead-ranges-narrow.png"))
        model.delete(aheadRanged)
        for font in [NotebookFont.brush, .clean] {
            model.notebookFont = font
            try render(PaperView(model: model), size: NSSize(width: 420, height: 560), to: output.appendingPathComponent("ahead-\(font.rawValue).png"))
        }
        model.notebookFont = .pen
        model.calendar.showForSnapshot([])
        model.page = .todos
        try render(PaperView(model: model), size: NSSize(width: 420, height: 560),
                   to: output.appendingPathComponent("today-with-shelf.png"))
        // Memos (in 메모 서랍 from 1.43; the search snapshots find them).
        for text in [t("장보기\n우유, 달걀, 사과", "Groceries\nmilk, eggs, apples", "Boodschappen\nmelk, eieren, appels"),
                     t("회의 메모\n다음 주까지 시안 2개, 금요일 공유", "Meeting notes\ntwo drafts by next week, share on Friday", "Notities overleg\ntwee ontwerpen voor volgende week, vrijdag delen"),
                     t("읽고 싶은 책\n작은 것들의 신 · 아무튼 산책", "Books to read\nThe God of Small Things · Wanderlust", "Boeken om te lezen\nDe god van kleine dingen · Wandelen")] {
            let id = model.newMemo()
            model.updateMemo(id, text: text)
            model.closeMemo()
        }
        model.page = .todos
        let repeating = model.items[3]
        try render(TaskReminderEditorView(item: repeating, model: model, onSave: { _ in }, onRemove: {}, onCancel: {}, startOnRepeat: true),
                   size: nil, to: output.appendingPathComponent("editor-repeat.png"))
        let item = model.items.first { $0.id == scheduled.id }!
        try render(TaskReminderEditorView(item: item, model: model, onSave: { _ in }, onRemove: {}, onCancel: {}),
                   size: nil, to: output.appendingPathComponent("editor.png"))
        // 1.37: 집중 — the focus card in each state (running, a Pomodoro round, time up, a break, the
        // list open), small and wide, other faces, the pick state and the stop question.
        model.calendar.showForSnapshot(snapshotEvents)
        let focusItem = model.items.first { !$0.isCompleted && Shelf.page(of: $0, now: now) == .today }!
        func focusSession(_ build: (Date) -> FocusSession) -> FocusSession { build(Date()) }
        func focusCard(_ name: String, _ session: FocusSession, size: NSSize = NSSize(width: 420, height: 560), open: Bool = false) throws {
            model.timerState.session = session
            model.timerState.timer = session.timer
            model.timerState.restOpen = open
            try render(PaperView(model: model), size: size, to: output.appendingPathComponent("focus-\(name).png"))
        }
        let taskID = focusItem.id.uuidString, taskTitle = focusItem.title
        let running = FocusSession.focus(taskId: taskID, title: taskTitle, minutes: 25, now: Date().addingTimeInterval(-(12 * 60 + 30)))
        func pomodoroRound2(minutesIn: Double) -> FocusSession {
            let start = Date().addingTimeInterval(-(31 + minutesIn) * 60)
            var session = FocusSession.pomodoro(taskId: taskID, title: taskTitle, settings: model.pomodoroSettings, now: start)
            _ = session.takeBreak(at: start.addingTimeInterval(25 * 60))
            session.nextRound(at: start.addingTimeInterval(31 * 60))
            return session
        }
        func pomodoroBreak(after: Double) -> FocusSession {
            let start = Date().addingTimeInterval(-(25 + after) * 60)
            var session = FocusSession.pomodoro(taskId: taskID, title: taskTitle, settings: model.pomodoroSettings, now: start)
            _ = session.takeBreak(at: start.addingTimeInterval(25 * 60))
            return session
        }
        try focusCard("running", running)
        try focusCard("pomodoro", pomodoroRound2(minutesIn: 9.5))
        try focusCard("time-up", FocusSession.focus(taskId: taskID, title: taskTitle, minutes: 25, now: Date().addingTimeInterval(-26 * 60)))
        try focusCard("pomodoro-time-up", pomodoroRound2(minutesIn: 26))
        try focusCard("break", pomodoroBreak(after: 2))
        try focusCard("break-over", pomodoroBreak(after: 7))
        try focusCard("list", running, open: true)
        try focusCard("small", running, size: NSSize(width: 350, height: 400))
        try focusCard("small-list", running, size: NSSize(width: 350, height: 400), open: true)
        try focusCard("small-pomodoro-time-up", pomodoroRound2(minutesIn: 26), size: NSSize(width: 350, height: 400))
        try focusCard("wide", pomodoroRound2(minutesIn: 9.5), size: NSSize(width: 720, height: 900), open: true)
        var paused = running
        paused.pause(at: Date())
        try focusCard("paused", paused)
        let longTitle = FocusSession.focus(taskId: nil, title: t("오늘 정리해야 할 긴 제목의 할 일과 회의 준비 내용을 차근차근 확인하기", "Go through today’s long to-do with a long title and everything for the meeting", "Vandaag de lange taak met een lange titel en alles voor het overleg doorlopen"),
                                           minutes: 50, now: Date().addingTimeInterval(-5 * 60))
        try focusCard("long-title", longTitle)
        try focusCard("small-long-title", longTitle, size: NSSize(width: 350, height: 400))
        for font in [NotebookFont.brush, .clean] {
            model.notebookFont = font
            try focusCard("font-\(font.rawValue)", running)
        }
        model.notebookFont = .pen
        model.timerState.session = nil
        model.timerState.timer = nil
        model.timerState.restOpen = false
        // 할 일 골라 집중…: the banner, and the picked row offering 집중.
        model.page = .todos
        model.focusPicking = true
        model.selectedTaskID = focusItem.id
        try render(PaperView(model: model), size: NSSize(width: 420, height: 560), to: output.appendingPathComponent("focus-pick.png"))
        try render(PaperView(model: model), size: NSSize(width: 350, height: 400), to: output.appendingPathComponent("focus-pick-small.png"))
        model.focusPicking = false
        model.selectedTaskID = nil
        model.calendar.showForSnapshot([])
        try slip(SlipAlertView(symbol: "timer", title: L("집중"), message: L("집중을 그만둘까요?"), detail: L("여기까지 한 시간은 집중 기록에 남아요."),
                               choices: [.init(title: L("계속하기"), isCancel: true), .init(title: L("그만두기"), role: .primary, isDefault: true)]),
                 to: output.appendingPathComponent("confirm-focus-stop.png"))
        // 1.36: the desk (책상) — every settings pane at the window's size and in full (to check
        // every row), with a stand-in title bar.
        let controller = ReminderController(model: model, preferences: preferences, onOpen: {})
        let archive = ArchiveStore(model: model)
        func desk(_ pane: DeskPane, _ name: String, size: NSSize = DeskMetrics.size, alarmEditing: String? = nil,
                  help: (topic: String, query: String)? = nil, week: Bool = false) throws {
            try render(DeskView(state: DeskState(pane: pane), model: model, archive: archive, reminders: controller, previewTitlebar: true,
                                previewAlarmEditing: alarmEditing, previewHelp: help, previewCalendarWeek: week),
                       size: size, to: output.appendingPathComponent("\(name).png"))
        }
        let full = NSSize(width: DeskMetrics.size.width, height: 1500)
        for pane in [DeskPane.appearance, .notifications, .repeating, .pet, .events, .storage] {
            try desk(pane, "desk-\(pane.rawValue)")
            try desk(pane, "desk-\(pane.rawValue)-full", size: full)
        }
        // 1.43.1: 메모 서랍 has its own pane (it was a group at the bottom of 꾸미기).
        try desk(.drawer, "desk-drawer-pane")
        try desk(.drawer, "desk-drawer-pane-full", size: full)
        // 1.42 종이냥 for Claude: AI 연결 off, then on with today's and yesterday's work (one taken back); the
        // toast, the away notice, the stamp on tasks (wide and narrow), and the slip when Claude Desktop isn't there.
        let ai = AIConnection(model: model, settingsFolder: folder, dataFolder: folder, live: false)
        model.ai = ai
        let aiNow = Date()
        let open = model.todayItems.filter { !$0.isCompleted && $0.seriesID == nil }
        let added = Array(open.dropFirst().prefix(2))
        func aiChange(_ item: TodoItem, before: TodoItem? = nil) -> AIConnect.Change {
            AIConnect.Change(file: "todos.json", id: item.id.uuidString, before: before.flatMap(AIConnect.json), after: AIConnect.json(item))
        }
        var moved = open[0]
        moved.timeStart = "15:00"; moved.timeEnd = "16:00"
        var earlier = moved
        earlier.timeStart = "14:00"; earlier.timeEnd = "15:00"
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: Archive.logicalDayStart(aiNow))!
        let addEntry = AIConnect.Entry(id: "ai1", at: aiNow.addingTimeInterval(-60), kind: .add, target: .todos, title: added[0].title,
                                       changes: added.map { aiChange($0) })
        let entries = [
            AIConnect.Entry(id: "ai4", at: Calendar.current.date(bySettingHour: 20, minute: 5, second: 0, of: yesterday)!, kind: .add, target: .memos, count: 1),
            AIConnect.Entry(id: "u4", at: Calendar.current.date(bySettingHour: 20, minute: 7, second: 0, of: yesterday)!, client: "app", tool: "undo",
                            kind: .undo, target: .memos, count: 1, undoes: "ai4"),
            AIConnect.Entry(id: "ai3", at: Calendar.current.date(bySettingHour: 21, minute: 10, second: 0, of: yesterday)!, kind: .add, target: .events, count: 1,
                            title: t("치과", "Dentist", "Tandarts")),
            AIConnect.Entry(id: "ai2", at: aiNow.addingTimeInterval(-3600), kind: .change, target: .todos, title: moved.title,
                            changes: [aiChange(moved, before: earlier)]),
            addEntry,
        ]
        ai.show(entries, now: aiNow)
        try desk(.ai, "desk-ai-off")
        ai.setEnabled(true)
        try desk(.ai, "desk-ai")
        try desk(.ai, "desk-ai-full", size: full)
        try desk(.ai, "desk-narrow-ai", size: DeskMetrics.minimum)
        // The shortest window with the full sidebar: twelve panes (메모 서랍 since 1.43.1) and 사용 안내 still all reachable.
        try desk(.ai, "desk-short-ai", size: NSSize(width: DeskMetrics.compactBelow, height: DeskMetrics.minimum.height))
        ai.show([], now: aiNow)
        try desk(.ai, "desk-ai-empty")
        ai.show(entries, now: aiNow)
        model.page = .todos
        var aiToast = PaperToast(symbol: "text.bubble", text: AIText.toast(addEntry, .current))
        aiToast.action = AIText.undoAction(.current)
        aiToast.perform = {}
        model.toast = aiToast
        try render(PaperView(model: model), size: NSSize(width: 420, height: 640), to: output.appendingPathComponent("note-ai-toast.png"))
        try render(PaperView(model: model), size: NSSize(width: 350, height: 560), to: output.appendingPathComponent("note-ai-toast-narrow.png"))
        var awayToast = PaperToast(symbol: "text.bubble", text: AIText.away(3, .current))
        awayToast.action = AIText.showAction(.current)
        awayToast.perform = {}
        model.toast = awayToast
        try render(PaperView(model: model), size: NSSize(width: 420, height: 640), to: output.appendingPathComponent("note-ai-away.png"))
        try render(PaperView(model: model), size: NSSize(width: 350, height: 560), to: output.appendingPathComponent("note-ai-away-narrow.png"))
        model.toast = PaperToast(symbol: "exclamationmark.circle", text: AIText.undoResult(.init(undone: 0, left: 1), .current))
        try render(PaperView(model: model), size: NSSize(width: 350, height: 560), to: output.appendingPathComponent("note-ai-undo-failed.png"))
        model.toast = nil
        try render(PaperView(model: model), size: NSSize(width: 420, height: 640), to: output.appendingPathComponent("note-ai-marked.png"))
        try render(PaperView(model: model), size: NSSize(width: 350, height: 560), to: output.appendingPathComponent("note-ai-marked-narrow.png"))
        try slip(AIConnection.missingDesktop, to: output.appendingPathComponent("ai-no-desktop.png"))
        ai.setEnabled(false)
        ai.show([], now: aiNow)
        model.ai = nil
        // 시계: the alarms (three, one open for editing, none), and the timer groups under them.
        let morning = Date(timeIntervalSince1970: 1_791_000_000)
        let sampleAlarms = [
            Alarm(id: "wake", time: "07:00", label: t("기상", "Wake up", "Opstaan"), days: [1, 2, 3, 4, 5], createdAt: morning),
            Alarm(id: "pill", time: "13:30", label: t("약 먹기", "Take my medicine", "Medicijnen innemen"), days: Array(0...6), sound: .soft, snooze: 5, createdAt: morning),
            Alarm(id: "stretch", time: "22:30", label: "", days: [], enabled: false, sound: .silent, createdAt: morning),
        ]
        model.alarms.showForSnapshot(sampleAlarms)
        try desk(.clock, "desk-clock")
        try desk(.clock, "desk-clock-edit", alarmEditing: "wake")
        // 1.39: 다시 울림 없음.
        let napAlarm = Alarm(id: "nap", time: "15:00", label: t("낮잠 끝", "End of nap", "Einde dutje"), days: [], snooze: 0, createdAt: morning)
        model.alarms.showForSnapshot(sampleAlarms + [napAlarm])
        try desk(.clock, "desk-clock-edit-nosnooze", alarmEditing: "nap")
        model.alarms.showForSnapshot(sampleAlarms)
        model.rememberTimer(40)
        model.rememberTimer(90)
        try desk(.clock, "desk-clock-full", size: full)
        model.alarms.showForSnapshot([])
        try desk(.clock, "desk-clock-empty")
        // Narrow: the sidebar folded to its icons (the window's smallest size), and a wide window.
        try desk(.appearance, "desk-narrow-appearance", size: DeskMetrics.minimum)
        try desk(.notifications, "desk-narrow-notifications", size: DeskMetrics.minimum)
        try desk(.appearance, "desk-wide-appearance", size: NSSize(width: 1400, height: 900))
        model.alarms.showForSnapshot(sampleAlarms)
        model.rememberTimer(40)
        model.rememberTimer(90)
        // The ring window, 직접 정하기…, and 빠른 메모 (⌃⌥M).
        let ring = AlarmRingState()
        ring.alarm = sampleAlarms[0]
        ring.startedAt = Date().addingTimeInterval(-70)
        try slip(AlarmRingView(state: ring), to: output.appendingPathComponent("alarm-ring.png"))
        ring.startedAt = Date()
        ring.alarm = Alarm(id: "once", time: "13:30", label: "", days: [], snooze: 5)
        try slip(AlarmRingView(state: ring), to: output.appendingPathComponent("alarm-ring-once.png"))
        ring.alarm = Alarm(id: "long", time: "18:45", label: t("오후 회의 전에 자료 다시 보고 약 챙겨 먹기", "Look over the notes again and take my medicine before the afternoon meeting", "Stukken nog eens doorlezen en medicijnen innemen voor het middagoverleg"),
                           days: [1, 3, 5], snooze: 15)
        // Ringing at its own time (18:45 today), so "다음은 …" names the next day it rings.
        let ringNow = Calendar.current.date(bySettingHour: 18, minute: 45, second: 20, of: Date())!
        ring.startedAt = ringNow
        try slip(AlarmRingView(state: ring, now: ringNow), to: output.appendingPathComponent("alarm-ring-long.png"))
        // 1.39: no 다시 울림 — only 끄기.
        ring.alarm = napAlarm
        ring.startedAt = Date()
        try slip(AlarmRingView(state: ring), to: output.appendingPathComponent("alarm-ring-nosnooze.png"))
        try slip(CustomTimerView(text: t("1시간 30분", "1h 30m", "1u 30m"), recent: model.timerRecent), to: output.appendingPathComponent("custom-timer.png"))
        try slip(CustomTimerView(text: t("세 시간 반", "four hours", "vier uur"), recent: model.timerRecent), to: output.appendingPathComponent("custom-timer-invalid.png"))
        try slip(QuickMemoView(model: model, text: t("주말에 할 것\n화분 분갈이, 책 반납\n엄마한테 전화하기", "This weekend\nrepot the plants, return the book\ncall Mom", "Dit weekend\nplanten verpotten, boek terugbrengen\nmama bellen")),
                 to: output.appendingPathComponent("quick-memo.png"))
        // Questions on a slip instead of the system alert.
        // To the next language: Korean asks about English, English and Dutch about Korean.
        let otherLanguage = AppLanguage.current == .ko ? "en" : "ko"
        try slip(SlipAlertView(symbol: "globe", title: L("언어 바꾸기"), message: L10n.changeQuestion(to: otherLanguage),
                               detail: L10n.changeDetail, choices: L10n.changeChoices, cat: .curious, width: .medium),
                 to: output.appendingPathComponent("confirm-language.png"))
        // A backup from the Windows app: the same lines the app shows (file, origin, counts, the two ways in).
        func list(_ key: String, _ count: Int) -> String { "{\"\(key)\":[" + Array(repeating: "{}", count: count).joined(separator: ",") + "]}" }
        let sampleBackup = Backup.Contents(exportedAt: "2026-10-08T05:30:00Z", from: "Windows 1.22.0",
                                           files: ["todos.json": list("items", 12), "memos.json": list("memos", 3), "repeats.json": list("series", 2),
                                                   "events.json": list("events", 9), "alarms.json": list("alarms", 3),
                                                   "archive/2026-10.jsonl": String(repeating: "{}\n", count: 140)])
        try slip(SlipAlertView(symbol: "square.and.arrow.down", title: L("가져오기"), message: L("이 백업을 가져올까요?"),
                               detail: BackupController.importDetail(fileName: "JongiNyang-2026-10-08.jongi", backup: sampleBackup),
                               choices: BackupController.importChoices, cat: .curious, width: .medium),
                 to: output.appendingPathComponent("confirm-import.png"))
        // 달력: the month and the week with events and deadlines.
        func later(_ id: String, _ title: String, _ color: LocalEvent.Color, days: Int, hour: Int, length: Int = 1, location: String? = nil) -> LocalEvent {
            let day = Calendar.current.date(byAdding: .day, value: days, to: now)!
            return LocalEvent(id: id, title: title, date: CalendarDraft.day(day), start: hour * 60, end: (hour + length) * 60, color: color, location: location)
        }
        let tripStart = Calendar.current.date(byAdding: .day, value: 2, to: Calendar.current.startOfDay(for: now))!
        let monthEvents = snapshotEvents + [
            LocalEvent(id: "trip", title: t("제주 여행", "Trip to Jeju", "Reis naar Jeju"), date: CalendarDraft.day(tripStart), allDay: true, days: 3, color: .sage),
            later("check", t("치과 정기 검진", "Dental checkup", "Controle tandarts"), .blue, days: 5, hour: 14, location: t("연세바른치과", "Bright Smile Dental", "Tandartspraktijk De Linde")),
            later("review", t("분기 리뷰", "Quarterly review", "Kwartaalreview"), .purple, days: 8, hour: 10, length: 2),
            later("study2", t("스터디", "Study group", "Studiegroep"), .purple, days: -3, hour: 20),
            later("lunch", t("팀 점심", "Team lunch", "Teamlunch"), .yellow, days: -6, hour: 12),
        ]
        model.calendar.showForSnapshot(monthEvents)
        try desk(.calendar, "desk-calendar")
        try desk(.calendar, "desk-calendar-week", week: true)
        try desk(.calendar, "desk-narrow-calendar", size: DeskMetrics.minimum)
        try desk(.calendar, "desk-narrow-calendar-week", size: DeskMetrics.minimum, week: true)
        try desk(.calendar, "desk-wide-calendar", size: NSSize(width: 1600, height: 1000))
        // 1.39: to-dos with a time — today's (no date) and one in two days — as outlined blocks in the week and the day panel.
        model.add(t("보고서 쓰기", "Write the report", "Verslag schrijven"), literal: true)
        let todayRanged = model.items.last!.id
        model.setTimeRange(todayRanged, to: TimeRange(start: 14 * 60, end: 15 * 60 + 30))
        model.add(t("치과 서류 챙기기", "Bring the dental forms", "Tandartsformulieren meenemen"), literal: true)
        let laterRanged = model.items.last!.id
        model.setDue(laterRanged, to: Deadline.key(Calendar.paper.date(byAdding: .day, value: 2, to: Archive.logicalDayStart(now))!))
        model.setTimeRange(laterRanged, to: TimeRange(start: 10 * 60, end: 11 * 60))
        try desk(.calendar, "desk-calendar-ranges")
        try desk(.calendar, "desk-calendar-week-ranges", week: true)
        model.delete(todayRanged)
        model.delete(laterRanged)
        model.calendar.showForSnapshot([])
        let periodicTasks = model.items.filter { !$0.isCompleted }.map(ReminderPopupTask.init)
        let popup = ReminderPopupController(onOpen: {}, onSnooze: { _ in }, onComplete: { _ in })
        for style in ReminderPresentationStyle.allCases {
            popup.show(image: model.mascotImage, tasks: [ReminderPopupTask(title: L("내일의 나에게 메모 남기기"), scheduledAt: Date())],
                       duration: 0, scheduled: true, notebookFont: .pen, style: style, snoozeMoves: true)
            try await Task.sleep(for: .seconds(2.8))
            popup.captureSnapshot(at: output.appendingPathComponent("reminder-\(style.rawValue).png"))
            popup.dismiss()
        }
        // A long title wrapping in the 기본 글씨 font (the other reminder shots use the pen).
        popup.show(image: model.mascotImage,
                   tasks: [ReminderPopupTask(title: t("오늘 정리해야 할 긴 제목의 할 일과 회의 준비 내용을 차근차근 확인하기", "Go through today’s long to-do with a long title and everything to prepare for the meeting, step by step", "Vandaag de lange taak met een lange titel en alles voor het overleg stap voor stap doorlopen"),
                                             scheduledAt: Date().addingTimeInterval(-7200))],
                   duration: 0, scheduled: true, notebookFont: .clean, style: .paper, snoozeMoves: true)
        try await Task.sleep(for: .seconds(2.8))
        popup.captureSnapshot(at: output.appendingPathComponent("reminder-long.png"))
        popup.dismiss()
        popup.show(image: PaperTheme.mascot, tasks: periodicTasks,
                   duration: 0, notebookFont: .brush, style: .character)
        try await Task.sleep(for: .seconds(2.8))
        popup.captureSnapshot(at: output.appendingPathComponent("reminder-cat-periodic.png"))
        popup.dismiss()
        let soon = Date().addingTimeInterval(-60)
        popup.show(image: model.mascotImage,
                   tasks: [t("회의 자료 보내기", "Send the meeting notes", "Stukken voor overleg sturen"), t("약 챙겨 먹기", "Take my medicine", "Medicijnen innemen")].map { ReminderPopupTask(title: $0, scheduledAt: soon) },
                   duration: 0, scheduled: true, notebookFont: .pen, style: .paper, snoozeMoves: true)
        try await Task.sleep(for: .seconds(2.8))
        popup.captureSnapshot(at: output.appendingPathComponent("reminder-batched.png"))
        popup.dismiss()
        popup.show(image: model.mascotImage,
                   tasks: [ReminderPopupTask(title: t("점심 약속", "Lunch with Mia", "Lunch met Mia"), scheduledAt: Date().addingTimeInterval(10 * 60 + 30),
                                             endsAt: Date().addingTimeInterval(70 * 60), location: t("김밥천국", "Corner Café", "Café de Hoek"))],
                   duration: 0, scheduled: true, notebookFont: .pen, style: .paper, canComplete: false, calendarEvents: true)
        try await Task.sleep(for: .seconds(2.8))
        popup.captureSnapshot(at: output.appendingPathComponent("reminder-event.png"))
        popup.dismiss()
        popup.show(image: PaperTheme.mascot, tasks: periodicTasks,
                   duration: 10, notebookFont: .pen, style: .character)
        var phases: [[String: Any]] = []
        func capture(_ name: String) {
            popup.captureSnapshot(at: output.appendingPathComponent("walk-\(name).png"))
            let snapshot = popup.motionSnapshot
            let pose = popup.mascotPose
            phases.append(["phase": name, "panelX": snapshot.frame.minX, "catX": pose.x, "lift": pose.lift,
                           "rotation": pose.rotation, "scaleY": pose.scaleY, "progress": snapshot.progress,
                           "bubbleVisible": snapshot.bubbleVisible, "readingStarted": snapshot.readingStarted])
        }
        for (name, wait) in [("walking", 0.55), ("arriving", 0.95), ("ready", 0.85), ("greeting", 0.55)] {
            try await Task.sleep(for: .seconds(wait))
            capture(name)
        }
        popup.dismiss()
        popup.show(image: PaperTheme.mascot, tasks: periodicTasks,
                   duration: 0.4, notebookFont: .pen, style: .character)
        try await Task.sleep(for: .seconds(3.3))
        capture("leaving")
        try JSONSerialization.data(withJSONObject: phases, options: [.prettyPrinted, .sortedKeys])
            .write(to: output.appendingPathComponent("walk-phases.json"))
        popup.dismiss()
        for item in model.items where !item.isCompleted { model.completeTask(item.id) }
        try render(PaperView(model: model), size: NSSize(width: 420, height: 560),
                   to: output.appendingPathComponent("note-all-done.png"))
        let floating = FloatingMascotController(preferences: preferences, image: PaperTheme.mascot, onRestore: {})
        let states: [(String, [String], Int, Int)] = [
            ("tasks", [t("회의 자료 보내기", "Send the meeting notes", "Stukken voor overleg sturen"), t("약 챙겨 먹기", "Take my medicine", "Medicijnen innemen"), t("산책", "Go for a walk", "Wandelen")], 3, 4),
            ("many", [t("회의 자료 보내기", "Send the meeting notes", "Stukken voor overleg sturen"), t("약 챙겨 먹기", "Take my medicine", "Medicijnen innemen"), t("산책", "Go for a walk", "Wandelen"), t("책 읽기", "Read", "Lezen"), t("메일", "Email", "Mail")], 5, 5),
            ("done", [], 0, 4)
        ]
        for (name, titles, remaining, total) in states {
            floating.updateSummary(titles: titles, remaining: remaining, total: total)
            floating.show(near: NSRect(x: 400, y: 400, width: 420, height: 560))
            try await Task.sleep(for: .milliseconds(200))
            floating.captureSnapshot(at: output.appendingPathComponent("floating-\(name).png"))
        }
        floating.hide()
        // A believable year of finished tasks (deterministic sample data, never the user's list).
        let titles = AppLanguage.current == .ko ? ["메일 정리", "책 10쪽 읽기", "산책", "회의 준비", "장보기", "운동", "일기 쓰기", "빨래", "보고서 초안", "물 마시기"]
            : AppLanguage.current == .en ? ["Clear the inbox", "Read 10 pages", "Walk", "Prepare the meeting", "Groceries", "Workout", "Journal", "Laundry", "Report draft", "Drink water"]
            : ["Inbox opruimen", "10 bladzijden lezen", "Wandelen", "Overleg voorbereiden", "Boodschappen", "Sporten", "Dagboek", "Was doen", "Opzet rapport", "Water drinken"]
        var seed: UInt64 = 7
        func random() -> Double { seed = seed &* 6364136223846793005 &+ 1442695040888963407; return Double(seed >> 11) / Double(1 << 53) }
        var samples: [ArchiveEntry] = []
        let today = Calendar.current.startOfDay(for: Date())
        for back in stride(from: 330, through: 1, by: -1) {
            let day = Calendar.current.date(byAdding: .day, value: -back, to: today)!.addingTimeInterval(10 * 3600)
            let weekend = Calendar.current.isDateInWeekend(day)
            let busy = max(0, Int((random() * (weekend ? 3 : 7) - (back > 200 ? 2.5 : 1)).rounded()))
            for index in 0..<busy {
                let at = day.addingTimeInterval(Double(index) * 47 * 60)
                samples.append(ArchiveEntry(id: "sample-\(back)-\(index)", title: titles[Int(random() * Double(titles.count))], createdAt: at, completedAt: at))
            }
        }
        archive.seed(samples)
        // 1.37: focus sessions over the last two months (focus.jsonl), for the history's 집중.
        let focusTitles = AppLanguage.current == .ko ? ["보고서 마무리", "책 읽기", "발표 준비", "메일 정리"]
            : AppLanguage.current == .en ? ["Finish the report", "Read", "Prepare the talk", "Clear the inbox"]
            : ["Rapport afmaken", "Lezen", "Presentatie voorbereiden", "Inbox opruimen"]
        var focusRecords: [FocusRecord] = []
        for back in stride(from: 60, through: 0, by: -1) where back == 0 || random() < 0.55 {
            let day = Calendar.current.date(byAdding: .day, value: -back, to: today)!.addingTimeInterval(9 * 3600)
            for index in 0..<(1 + Int(random() * 3)) {
                let start = day.addingTimeInterval(Double(index) * 95 * 60)
                let pick = Int(random() * Double(focusTitles.count))
                let minutes = [25, 25, 50, 40, 15][Int(random() * 5)]
                focusRecords.append(FocusRecord(id: "focus-\(back)-\(index)", taskId: "task-\(pick)", title: focusTitles[pick], start: start,
                                                end: start.addingTimeInterval(Double(minutes) * 60), minutes: minutes, kind: random() < 0.15 ? .timer : .focus,
                                                done: random() < 0.3))
            }
        }
        model.focusLog.seed(focusRecords.map { record in
            var plain = record
            if plain.kind == .timer { plain.title = ""; plain.taskId = nil }
            return plain
        })
        try desk(.history, "desk-history")
        try desk(.history, "desk-history-full", size: NSSize(width: DeskMetrics.size.width, height: 900))
        try desk(.history, "desk-narrow-history", size: DeskMetrics.minimum)
        try desk(.history, "desk-wide-history", size: NSSize(width: 1400, height: 900))
        // A hovered row: its actions float over the end of the title.
        model.page = .todos
        model.add(t("오늘 안에 끝낼 긴 제목의 할 일 하나, 끝까지 잘 보이나요", "One to-do with a long title to finish today, can you read it all", "Eén taak met een lange titel die vandaag af moet, is hij helemaal leesbaar"))
        model.add(t("알림이 걸린 할 일", "A to-do with a reminder", "Een taak met een herinnering"))
        let plain = model.items[model.items.count - 2], reminded = model.items[model.items.count - 1]
        model.setTaskReminder(reminded.id, at: Date().addingTimeInterval(3600))
        let current = { (id: UUID) in model.items.first { $0.id == id }! }
        model.add(t("다음 주 발표 준비", "Prepare the talk", "Presentatie voorbereiden"), literal: true)
        model.setDue(model.items.last!.id, to: Deadline.key(Calendar.current.date(byAdding: .day, value: 2, to: Date())!))
        let waiting = model.items.last!
        // At rest, then hovered: today's rows, and a row in a day of 앞으로.
        try render(VStack(spacing: 0) {
            TaskRow(item: current(plain.id), model: model, rowDrop: .constant(nil), previewHover: true)
            TaskRow(item: current(reminded.id), model: model, rowDrop: .constant(nil))
            TaskRow(item: current(reminded.id), model: model, rowDrop: .constant(nil), previewHover: true)
            TaskRow(item: waiting, onShelf: true, model: model, rowDrop: .constant(nil), style: .inset, aheadMeta: .due, onDragPoint: { _ in }).padding(.leading, 76)
            TaskRow(item: waiting, onShelf: true, model: model, rowDrop: .constant(nil), previewHover: true, style: .inset, aheadMeta: .due, onDragPoint: { _ in }).padding(.leading, 76)
        }.background(PaperTheme.paper), size: NSSize(width: 420, height: 210), to: output.appendingPathComponent("row-hover.png"))
        model.delete(plain.id)
        model.delete(reminded.id)
        model.delete(waiting.id)
        // Quick entry (⌃⌥N) with a date understood, and a row picked with the keyboard.
        try slip(QuickEntryView(model: model, text: t("내일 3시 회의", "meeting tomorrow 3pm", "morgen om 3 uur overleg")), to: output.appendingPathComponent("quick-entry.png"))
        try slip(QuickEntryView(model: model), to: output.appendingPathComponent("quick-entry-empty.png"))
        let timerCommit = IntentCommit(text: "", candidates: model.intentCandidates(t("타이머 40", "timer 40", "timer 40")), index: 0, key: nil, made: .nothing, page: .todos)
        try slip(QuickEntryView(model: model, previewToast: model.makeToast(for: timerCommit, onChange: { _ in })), to: output.appendingPathComponent("quick-entry-toast.png"))
        model.page = .todos
        model.selectedTaskID = model.visibleItems.dropFirst().first?.id
        try render(PaperView(model: model), size: NSSize(width: 420, height: 560), to: output.appendingPathComponent("note-selected.png"))
        model.selectedTaskID = nil
        // 도움말: a topic, and a search.
        try desk(.help, "desk-help", help: ("window", ""))
        try desk(.help, "desk-help-tasks", help: ("tasks", ""))
        try desk(.help, "desk-help-calendar", help: ("calendar", ""))
        try desk(.help, "desk-help-ai", help: ("ai", ""))
        try desk(.help, "desk-help-ai-full", size: full, help: ("ai", ""))
        try desk(.help, "desk-narrow-help", size: DeskMetrics.minimum, help: ("calendar", ""))
        try desk(.help, "desk-wide-help", size: NSSize(width: 1600, height: 1000), help: ("calendar", ""))
        try desk(.help, "desk-help-search", help: ("start", t("접기", "fold", "inklappen")))
        // The first-launch guide, every card, over the note.
        model.page = .todos
        for index in GuideView.cards.indices {
            try render(ZStack { PaperView(model: model); GuideView(model: model, startStep: index) },
                       size: NSSize(width: 420, height: 560), to: output.appendingPathComponent("guide-\(index + 1).png"))
            // The smallest note (350 × 400): the card must still fit.
            try render(ZStack { PaperView(model: model); GuideView(model: model, startStep: index) },
                       size: NSSize(width: 350, height: 400), to: output.appendingPathComponent("guide-small-\(index + 1).png"))
        }
        // Empty pages in the real note at 350, 420 and 720 wide: the cat and its line centred on the sheet.
        let emptyStorage = folder.appendingPathComponent("empty/todos.json")
        try FileManager.default.createDirectory(at: emptyStorage.deletingLastPathComponent(), withIntermediateDirectories: true)
        try NotebookFile(url: emptyStorage).save(Notebook())
        let emptyModel = AppModel(storageURL: emptyStorage, isolated: true, preferences: preferences)
        emptyModel.paperColor = night ? .night : .day
        for page in [AppModel.Page.todos, .ahead] {
            emptyModel.page = page
            for width: CGFloat in [350, 420, 720] {
                try render(PaperView(model: emptyModel), size: NSSize(width: width, height: 560),
                           to: output.appendingPathComponent("empty-\(page.rawValue)-\(Int(width)).png"))
            }
        }
        // Empty pages: the cat and a line of what goes there — each at the note's width (420), so the
        // lines wrap as they do in the app.
        try render(HStack(alignment: .top, spacing: 0) {
            EmptySheetNote(pose: .happy, text: L("오늘 할 일을 한 줄 적어 볼까요?")).frame(width: 420)
            EmptySheetNote(pose: .curious, text: Ahead.emptyText(.current)).frame(width: 420)
            EmptySheetNote(pose: .tea, text: L("떠오른 생각을 가볍게 적어 두세요")).frame(width: 420)
        }.padding(.bottom, 20).background(PaperTheme.paper), size: NSSize(width: 1260, height: 210), to: output.appendingPathComponent("empty-states.png"))
        // Desktop pet states, each drawn mid-clip.
        let petStates: [(String, (PetState) -> Void)] = [
            ("sit", { _ in }),
            ("blink", { $0.activity = PetActivity(.blink, start: Date().addingTimeInterval(-0.1)) }),
            ("happy", { $0.activity = PetActivity(.happy, start: Date().addingTimeInterval(-0.55)) }),
            ("sleep", { $0.activity = PetActivity(.sleep) }),
            ("tilt", { $0.activity = PetActivity(.tilt, start: Date().addingTimeInterval(-0.75)) }),
            // 종이냥 한마디: a line, and a question with answer buttons.
            ("line", { $0.message = PetChatter.pick(PetChatter.Context(hour: 15, open: 3, done: 2, firstOpen: t("보고서 쓰기", "Write the report", "Rapport schrijven")), questions: false, recent: [], language: .current, random: { 0 }).text }),
            ("question", { $0.question = PetChatter.pick(PetChatter.Context(hour: 10, open: 2, done: 0), questions: true, recent: [], language: .current, random: { 0.99 }) }),
            ("question-many", { $0.question = PetChatter.pick(PetChatter.Context(hour: 9, open: 5, done: 0), questions: true, recent: ["q.mood", "q.water", "q.stretch", "q.sleep", "q.eyes", "q.walk", "q.music", "q.pet"], language: .current, random: { 0.99 }) }),
            // Near the screen's edges the bubble slides inward and its pointer still finds the cat.
            ("question-edge", { state in
                state.homeX = 232
                state.question = PetChatter.pick(PetChatter.Context(hour: 9, open: 5, done: 0), questions: true, recent: ["q.mood", "q.water", "q.stretch", "q.sleep", "q.eyes", "q.walk", "q.music", "q.pet"], language: .current, random: { 0.99 })
            }),
            ("line-wrap", { $0.message = t("첫 번째 체크가 제일 어려워요. 할 수 있어요!", "The first tick is always the hardest. You can do it!", "Het eerste vinkje is altijd het moeilijkst. Jij kunt het!") }),
            ("line-long", { $0.message = PetChatter.pick(PetChatter.Context(hour: 10, open: 3, done: 0, firstOpen: L("오늘 꼭 해야 할 일 정리하기")), questions: false, recent: ["p.start.0", "p.start.1", "p.start.2", "p.start.3"], language: .current, random: { 0 }).text }),
            ("line-edge", { state in
                state.homeX = 70
                state.message = t("붉은 글씨 마감이 2개 있어요. 날짜를 다시 정해도 괜찮아요.", "2 in red, past their dates. It’s okay to pick a new date for them.", "2 in het rood, over hun datum. Een nieuwe datum kiezen mag gerust.")
            }),
            ("question-walk", { $0.question = PetChatter.pick(PetChatter.Context(hour: 16, open: 2, done: 1), questions: true, recent: ["q.mood", "q.water", "q.stretch", "q.snack", "q.eyes", "q.music", "q.pet"], language: .current, random: { 0.99 }) }),
            ("question-eyes", { $0.question = PetChatter.pick(PetChatter.Context(hour: 16, open: 2, done: 1), questions: true, recent: ["q.mood", "q.water", "q.stretch", "q.snack", "q.walk", "q.music", "q.pet"], language: .current, random: { 0.99 }) }),
            ("question-mood", { $0.question = PetChatter.pick(PetChatter.Context(hour: 16, open: 2, done: 1), questions: true, recent: ["q.water", "q.stretch"], language: .current, random: { 0.95 }) }),
        ]
        for (name, configure) in petStates {
            let state = PetState()
            state.homeX = 150
            configure(state)
            try render(DesktopPetView(state: state).background(desktop),
                       size: NSSize(width: 300, height: 250), to: output.appendingPathComponent("pet-\(name).png"))
        }
        // The focus timer, a tag of its own: focusing, resting with a message, and done.
        let timerStates: [(String, (FocusTimerState) -> Void)] = [
            ("focus", { $0.timer = FocusTimer.pomodoro(PomodoroSettings(), now: Date().addingTimeInterval(-9 * 60)) }),
            ("rest", { state in
                let start = Date().addingTimeInterval(-25 * 60 - 60)
                state.timer = FocusTimer.pomodoro(PomodoroSettings(), now: start).next(at: start.addingTimeInterval(25 * 60))
                state.message = L("집중 끝! \(5)분 쉬어요")
            }),
            ("done", { $0.message = L("\(25)분 끝났어요!") }),
        ]
        for (name, configure) in timerStates {
            let state = FocusTimerState()
            configure(state)
            try render(FocusTimerView(state: state).background(desktop),
                       size: FocusTimerController.size, to: output.appendingPathComponent("timer-\(name).png"))
        }
        // TimerSize: the same tag smaller and larger.
        // 집중 with the note out of sight: the tag shows the to-do's title.
        let focusBoard = FocusTimerState()
        focusBoard.session = FocusSession.focus(taskId: "T", title: t("보고서 마무리", "Finish the report", "Rapport afmaken"), minutes: 25, now: Date().addingTimeInterval(-9 * 60))
        focusBoard.timer = focusBoard.session?.timer
        try render(FocusTimerView(state: focusBoard).background(desktop), size: FocusTimerController.size, to: output.appendingPathComponent("timer-focus.png"))
        for size in [TimerSize.small, .extraLarge] {
            let state = FocusTimerState()
            state.timer = FocusTimer.pomodoro(PomodoroSettings(), now: Date().addingTimeInterval(-9 * 60))
            state.scale = size.scale
            let scaled = NSSize(width: FocusTimerController.size.width * size.scale, height: FocusTimerController.size.height * size.scale)
            try render(FocusTimerView(state: state).background(desktop),
                       size: scaled, to: output.appendingPathComponent("timer-\(size.rawValue).png"))
        }
        // 1.38: 편의 기능.
        try await renderConveniences(folder: folder, preferences: preferences, history: samples, output: output)
        // 1.43: 메모 서랍.
        try renderMemoDrawer(folder: folder, output: output)
        // 1.35: the menu bar item (its words in each state) and the 오늘 창 below it.
        try renderTodayWindow(model: model, alarms: sampleAlarms, events: snapshotEvents, output: output)
        print("Rendered note (3 fonts + minimum size), editor, settings and 3 reminders to \(output.path)")
    }

    /// 1.38 편의 기능: the row's new buttons and marks, the evening tidy-up, today's one thing, search, the ribbon
    /// click, the compact header, toasts, the quick note with copied text, the cat's login question, and the
    /// menus that can't be drawn (written to conv-menus.txt).
    static func renderConveniences(folder: URL, preferences: UserDefaults, history: [ArchiveEntry], output: URL) async throws {
        let storage = folder.appendingPathComponent("conv/todos.json")
        try FileManager.default.createDirectory(at: storage.deletingLastPathComponent(), withIntermediateDirectories: true)
        let now = Date()
        func daysAgo(_ n: Int) -> String { Deadline.key(Calendar.paper.date(byAdding: .day, value: -n, to: Archive.logicalDayStart(now))!) }
        var notebook = Notebook()
        let report = notebook.add(t("분기 보고서 초안 쓰기", "Write the quarterly report draft", "Concept kwartaalrapport schrijven"))!
        let shirts = notebook.add(t("세탁소에 셔츠 맡기기", "Take the shirts to the cleaners", "Overhemden naar de stomerij"))!
        let post = notebook.add(t("우체국 들르기", "Stop by the post office", "Langs het postkantoor"))!
        let call = notebook.add(t("보고서 메일로 보내기", "Email the report", "Rapport mailen"))!
        let done = notebook.add(t("물 마시기", "Drink water", "Water drinken"))!
        notebook.toggle(id: done.id)
        try NotebookFile(url: storage).save(notebook)
        let model = AppModel(storageURL: storage, isolated: true, preferences: preferences)
        model.paperColor = night ? .night : .day
        // 어제부터 · 3일째 (stamps written as another day would have).
        model.mutate { history in
            history.batch { notebook in
                notebook.setReminder(id: call.id, at: now.addingTimeInterval(2 * 3600))
            }
        }
        var stamped = model.notebookNow.items
        for index in stamped.indices {
            if stamped[index].id == shirts.id { stamped[index].todaySince = daysAgo(1) }
            if stamped[index].id == post.id { stamped[index].todaySince = daysAgo(3) }
        }
        model.mutate { history in history.batch { notebook in
            let carried = stamped.filter { $0.id == shirts.id || $0.id == post.id }
            for item in carried { notebook.delete(id: item.id) }
            notebook.restore(carried, order: stamped.map(\.id))
        } }
        let row = { (id: UUID) in model.items.first { $0.id == id }! }
        // Rows: hovered (→ 내일 · ↓ 언젠가 · 집중 · 알림 · 지우기), the marks at rest, today's one thing.
        model.dailyPickEnabled = true
        model.setDailyPick(report.id)
        for width: CGFloat in [420, 350] {
            try render(VStack(spacing: 0) {
                TaskRow(item: row(report.id), model: model, rowDrop: .constant(nil), ruled: true)
                TaskRow(item: row(report.id), model: model, rowDrop: .constant(nil), previewHover: true, ruled: true)
                TaskRow(item: row(shirts.id), model: model, rowDrop: .constant(nil), ruled: true)
                TaskRow(item: row(post.id), model: model, rowDrop: .constant(nil), ruled: true)
                TaskRow(item: row(post.id), model: model, rowDrop: .constant(nil), previewHover: true, ruled: true)
            }.background(PaperTheme.paper), size: NSSize(width: width, height: 5 * PaperTheme.rowHeight), to: output.appendingPathComponent("conv-rows-\(Int(width)).png"))
        }
        // The note: the star at the top of 다음, the marks; then the line asking for the one thing.
        try render(PaperView(model: model), size: NSSize(width: 420, height: 560), to: output.appendingPathComponent("conv-note-carry.png"))
        model.setDailyPick(nil)
        try render(PaperView(model: model), size: NSSize(width: 420, height: 560), to: output.appendingPathComponent("conv-note-pick-prompt.png"))
        try render(PaperView(model: model), size: NSSize(width: 350, height: 400), to: output.appendingPathComponent("conv-note-pick-prompt-small.png"))
        model.dailyPickEnabled = false
        // The compact header (480 pt and less), at a few sizes.
        for size in [NSSize(width: 420, height: 480), NSSize(width: 350, height: 400), NSSize(width: 720, height: 470)] {
            try render(PaperView(model: model), size: size, to: output.appendingPathComponent("conv-header-compact-\(Int(size.width))x\(Int(size.height)).png"))
        }
        model.page = .ahead
        try render(PaperView(model: model), size: NSSize(width: 350, height: 400), to: output.appendingPathComponent("conv-header-compact-ahead.png"))
        model.page = .todos
        // Toasts with 되돌리기.
        for (name, text) in [("deleted", L("지웠어요")), ("done", L("\(3)개 끝냈어요")), ("tomorrow", DateMove.movedText(DateMove.tomorrow(now: now), now: now, language: .current)),
                             ("filed", L("\(3)개를 기록으로 옮겼어요")), ("sweep", Sweep.movedText(count: 3, someday: false, language: .current))] {
            var toast = PaperToast(symbol: "trash", text: text)
            toast.action = L("되돌리기")
            model.toast = toast
            try render(PaperView(model: model), size: NSSize(width: 350, height: 480), to: output.appendingPathComponent("conv-toast-\(name).png"))
        }
        model.toast = nil
        // 저녁 정리: evening (3, with one left out), morning, one, and many (scrolls).
        let open = model.items.filter { !$0.isCompleted }
        try slip(SweepView(model: model, moment: .evening, items: open), to: output.appendingPathComponent("conv-sweep-evening.png"))
        try slip(SweepView(model: model, moment: .morning, items: Array(open.dropFirst())), to: output.appendingPathComponent("conv-sweep-morning.png"))
        try slip(SweepView(model: model, moment: .evening, items: [open[1]]), to: output.appendingPathComponent("conv-sweep-one.png"))
        var many = open
        for title in [t("빨래 개기", "Fold the laundry", "Was vouwen"), t("화분에 물 주기", "Water the plants", "Planten water geven"), t("영수증 정리", "Sort receipts", "Bonnetjes sorteren"),
                      t("오늘 정리해야 할 긴 제목의 할 일과 회의 준비 내용을 차근차근 확인하기", "Go through today’s long to-do with a long title and everything to prepare for the meeting", "Vandaag de lange taak met een lange titel en alles voor het overleg doorlopen")] {
            many.append(TodoItem(title: title))
        }
        try slip(SweepView(model: model, moment: .evening, items: many), to: output.appendingPathComponent("conv-sweep-many.png"))
        // 검색: 초성 in Korean (the word in English and Dutch), nothing found, and the empty slip.
        model.addMemo(text: t("회의 메모\n보고서 목차: 요약, 숫자, 다음 할 일", "Meeting notes\nReport outline: summary, numbers, next steps", "Vergadernotities\nOpzet rapport: samenvatting, cijfers, vervolg"))
        model.calendar.showForSnapshot([LocalEvent(id: "review", title: t("보고서 검토 회의", "Report review meeting", "Overleg rapportreview"),
                                                   date: Deadline.key(Calendar.paper.date(byAdding: .day, value: 2, to: Archive.logicalDayStart(now))!), start: 600, end: 660)])
        let searchHistory = history.prefix(400).map { $0 } + [ArchiveEntry(id: "h-report", title: t("주간 보고서 제출", "Hand in the weekly report", "Weekrapport inleveren"),
                                                                            createdAt: now.addingTimeInterval(-6 * 86_400), completedAt: now.addingTimeInterval(-5 * 86_400))]
        // 1.39: a to-do with a time shows it in the result's detail.
        model.add(t("보고서 마무리", "Finish the report", "Rapport afmaken"), literal: true)
        let searchRanged = model.items.last!.id
        model.setTimeRange(searchRanged, to: TimeRange(start: 16 * 60, end: 17 * 60))
        try slip(SearchView(model: model, history: searchHistory, previewQuery: t("ㅂㄱㅅ", "report", "rapport")), to: output.appendingPathComponent("conv-search.png"))
        model.delete(searchRanged)
        try slip(SearchView(model: model, history: searchHistory, previewQuery: t("검토", "review", "review")), to: output.appendingPathComponent("conv-search-events.png"))
        try slip(SearchView(model: model, history: searchHistory, previewQuery: t("ㅋㅋㅋ", "zebra", "zebra")), to: output.appendingPathComponent("conv-search-none.png"))
        try slip(SearchView(model: model, history: searchHistory), to: output.appendingPathComponent("conv-search-blank.png"))
        model.calendar.showForSnapshot([])
        // A click on the ribbon's empty track: the new event slip at that time.
        let slot = DayRibbon.slot(at: 0.51, startHour: 8, endHour: 24, now: now)
        try slip(CalendarEventSheet(calendar: model.calendar, request: CalendarSheetRequest(mode: .new, draft: CalendarDraft(title: "", date: slot.date, startMinutes: slot.minutes,
                                                                                                                      endMinutes: (slot.minutes + 60) % 1440)), onClose: {}),
                 to: output.appendingPathComponent("conv-ribbon-new-event.png"))
        // 빠른 메모 with copied text (selected).
        try slip(QuickMemoView(model: model, text: t("서울시 마포구 월드컵로 12, 3층", "12 Market Street, 3rd floor", "Marktstraat 12, 3e verdieping"), selectAll: true),
                 to: output.appendingPathComponent("conv-quick-memo-copied.png"))
        // The task reminder with 내일로 (and the 5분 전에 다시 of an event alert is in reminder-event).
        let popup = ReminderPopupController(onOpen: {}, onSnooze: { _ in }, onComplete: { _ in })
        popup.show(image: model.mascotImage, tasks: [ReminderPopupTask(title: L("내일의 나에게 메모 남기기"), scheduledAt: Date())],
                   duration: 0, scheduled: true, notebookFont: .pen, style: .compact, snoozeMoves: true)
        try await Task.sleep(for: .seconds(1.5))
        popup.captureSnapshot(at: output.appendingPathComponent("conv-reminder-one.png"))
        popup.dismiss()
        // The cat asks about opening at login.
        let state = PetState()
        state.homeX = 150
        state.question = PetChatter.Line(question: "login.ask", text: L("저를 켤 때마다 불러 주셨네요. 컴퓨터 켤 때 같이 열까요?"), answers: [
            PetChatter.Answer(label: L("열기"), reply: "", pose: .cheer), PetChatter.Answer(label: L("괜찮아요"), reply: "", pose: .happy),
        ])
        try render(DesktopPetView(state: state).background(desktop), size: NSSize(width: 300, height: 250), to: output.appendingPathComponent("pet-login-ask.png"))
        // What can't be drawn: the menus' words.
        let date: [String] = DateMove.choices(now: now).map { $0.title(.current) }
        var lines = [L("날짜 바꾸기") + " ▸ " + date.joined(separator: " · ")]
        lines.append(L("다시 알림") + " ▸ " + Snooze.options(now: now).map { $0.title(.current) }.joined(separator: " · "))
        lines.append("evening hidden at 18:00 ▸ " + Snooze.options(now: Calendar.current.date(bySettingHour: 18, minute: 0, second: 0, of: now)!).map { $0.title(.current) }.joined(separator: " · "))
        lines.append("Dock ▸ " + [L("빠른 입력"), L("빠른 메모"), L("책상"), L("25분 집중"), L("5분 타이머")].joined(separator: " · "))
        lines.append("⋯ ▸ " + [L("검색…"), L("화면 오른쪽에 붙이기"), L("화면 왼쪽에 붙이기")].joined(separator: " · "))
        lines.append(L("시스템 알림으로도 보내기") + " ▸ " + [L("놓친 것만"), L("항상"), String(localized: "끄기", table: "Settings")].joined(separator: " · "))
        lines.append("notification ▸ " + L("종이냥 · 알림") + " [" + L("끝냄") + " · " + L("10분 뒤") + "] · " + L("알람 · \("7:00")") + " [" + L("끄기") + " · " + L("다시 알림") + "]")
        try (lines.joined(separator: "\n") + "\n").write(to: output.appendingPathComponent("conv-menus.txt"), atomically: true, encoding: .utf8)
    }

    /// The menu bar item's states (drawn on a strip like the menu bar, in light and dark) and the
    /// 오늘 창: nothing on, an event soon, a timer running (hovered), an alarm set, many tasks, a toast.
    static func renderTodayWindow(model: AppModel, alarms: [Alarm], events: [LocalEvent], output: URL) throws {
        let now = Date()
        for item in model.items { model.delete(item.id) }
        model.calendar.showForSnapshot([])
        model.alarms.showForSnapshot([])
        let timer = FocusTimerState()
        func window(_ name: String, toast: PaperToast? = nil, hover: Bool = false, inPanel: Bool = false) throws {
            let view = TodayWindowView(model: model, timer: timer, alarms: model.alarms, calendar: model.calendar, now: now,
                                       previewToast: toast, previewTimerHover: hover)
            let url = output.appendingPathComponent("today-window-\(name).png")
            if inPanel { try panelSlip(view, to: url) } else { try slip(view, to: url) }
        }
        // The menu bar's words, each state on its own strip.
        func strip(_ state: MenuBarState, dark: Bool) -> some View {
            MenuBarButtonPreview(state: state, dark: dark)
                .fixedSize()
                .frame(height: 24)
                .frame(minWidth: 160, alignment: .trailing)
                .padding(.horizontal, 12)
                .background(dark ? Color(white: 0.16) : Color(white: 0.93))
                .environment(\.colorScheme, dark ? .dark : .light)
        }
        var states: [(String, MenuBarState)] = [("nothing", MenuBarState.current(model: model, timer: nil, now: now))]
        try window("nothing")
        // 1.42.1: through the real window too — the window is the slip's size (it used to start 520 × 420 with the
        // slip centred in it: a short slip sat low under the menu bar, a tall one lost its top).
        try window("panel-nothing", inPanel: true)
        model.add(t("장보기", "Groceries", "Boodschappen"), literal: true)
        model.add(t("보고서 마무리", "Finish the report", "Rapport afmaken"), literal: true)
        model.setTaskReminder(model.items.last!.id, at: now.addingTimeInterval(95 * 60))
        model.calendar.showForSnapshot(events)
        states.append(("soon", MenuBarState.current(model: model, timer: nil, now: now)))
        try window("event-soon")
        timer.timer = FocusTimer.countdown(minutes: 25, now: now.addingTimeInterval(-(12 * 60 + 30)))
        states.append(("timer", MenuBarState.current(model: model, timer: timer.timer, now: now)))
        try window("timer", hover: true)
        timer.timer = nil
        model.calendar.showForSnapshot([])
        let soonAlarm = Alarm(id: "soon", time: Alarm.time(hour: Calendar.current.component(.hour, from: now.addingTimeInterval(1800)),
                                                           minute: Calendar.current.component(.minute, from: now.addingTimeInterval(1800))),
                              label: t("약 먹기", "Take my medicine", "Medicijnen innemen"), days: [], createdAt: now.addingTimeInterval(-60))
        model.alarms.showForSnapshot([alarms[0]])
        try window("alarm")
        model.alarms.showForSnapshot([soonAlarm])
        try window("alarm-soon")
        model.alarms.showForSnapshot([alarms[0]])
        model.calendar.showForSnapshot(events)
        for title in [t("회의 자료 보내기", "Send the meeting notes", "Stukken voor overleg sturen"), t("약 챙겨 먹기", "Take my medicine", "Medicijnen innemen"),
                      t("산책", "Go for a walk", "Wandelen"), t("메일 정리", "Clear the inbox", "Inbox opruimen"),
                      t("오늘 정리해야 할 긴 제목의 할 일과 회의 준비 내용을 차근차근 확인하기", "Go through today’s long to-do with a long title and everything to prepare for the meeting", "Vandaag de lange taak met een lange titel en alles voor het overleg doorlopen"),
                      t("빨래", "Laundry", "Was doen")] {
            model.add(title, literal: true)
        }
        model.setTaskReminder(model.items[model.items.count - 5].id, at: now.addingTimeInterval(3 * 3600))
        model.toggle(model.items[0].id)
        try window("many")
        let commit = IntentCommit(text: "", candidates: model.intentCandidates(t("타이머 25", "timer 25", "timer 25")), index: 0, key: nil, made: .nothing, page: .todos)
        try window("toast", toast: model.makeToast(for: commit, onChange: { _ in }))
        // 집중: the timer card names the to-do, and the menu bar's time gets its mark.
        timer.session = FocusSession.focus(taskId: "T", title: t("보고서 마무리", "Finish the report", "Rapport afmaken"), minutes: 25, now: now.addingTimeInterval(-(12 * 60 + 30)))
        timer.timer = timer.session?.timer
        states.append(("focus", MenuBarState.current(model: model, timer: timer.timer, focusing: true, now: now)))
        try window("focus", hover: true)
        timer.session = nil
        timer.timer = nil
        let focusCommit = IntentCommit(text: "", candidates: model.intentCandidates(t("보고서 25분 집중", "focus 25 report", "focus 25 rapport")), index: 0, key: nil, made: .nothing, page: .todos)
        try window("toast-focus", toast: model.makeToast(for: focusCommit, onChange: { _ in }))
        // 1.42.1: everything at once, as it was found cut off at the top: an event in 1시간 46분 (its line wraps), a
        // timer running, two under 다음 and more than fit — drawn as usual and through the real window.
        let later = now.addingTimeInterval(106 * 60)
        model.calendar.showForSnapshot([LocalEvent(id: "later", title: t("팀 회의", "Team sync", "Teamoverleg"), date: CalendarDraft.day(later),
                                                   start: CalendarDraft.minutes(later), end: CalendarDraft.minutes(later.addingTimeInterval(45 * 60)))])
        timer.timer = FocusTimer.countdown(minutes: 25, now: now.addingTimeInterval(-(4 * 60 + 10)))
        try window("full")
        try window("panel-full", inPanel: true)
        timer.timer = nil
        // A long title is cut at 12 characters.
        model.calendar.showForSnapshot([LocalEvent(id: "long", title: t("치과 정기 검진과 스케일링 예약", "Dental checkup and cleaning", "Tandartscontrole en gebitsreiniging"),
                                                   date: CalendarDraft.day(now.addingTimeInterval(25 * 60)), start: CalendarDraft.minutes(now.addingTimeInterval(25 * 60)),
                                                   end: CalendarDraft.minutes(now.addingTimeInterval(85 * 60)))])
        try window("long-event")
        states.append(("long", MenuBarState.current(model: model, timer: nil, now: now)))
        model.menuBarText = .hide
        states.append(("hidden", MenuBarState.current(model: model, timer: nil, now: now)))
        model.menuBarText = .auto
        try render(VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(states.enumerated()), id: \.offset) { _, entry in
                HStack(spacing: 10) {
                    Text(entry.0).font(.system(size: 11, design: .monospaced)).foregroundStyle(PaperTheme.ink2).frame(width: 60, alignment: .leading)
                    strip(entry.1, dark: false)
                    strip(entry.1, dark: true)
                    Spacer(minLength: 0)
                }
            }
        }.padding(12).frame(width: 520, alignment: .leading).background(PaperTheme.paper), size: nil, to: output.appendingPathComponent("menubar-states.png"))
        model.calendar.showForSnapshot([])
        model.alarms.showForSnapshot([])
    }

    /// Drawn in 밤 종이 (`PAPERTODO_PAPER=night`).
    static let night = ProcessInfo.processInfo.environment["PAPERTODO_PAPER"] == "night"
    /// The screen behind the desktop cat and the timer: a light or a dark desktop.
    static var desktop: Color { night ? Color(white: 0.17) : Color(red: 0.93, green: 0.94, blue: 0.95) }

    /// Sample data in the language being drawn.
    static func t(_ ko: String, _ en: String, _ nl: String) -> String {
        switch AppLanguage.current {
        case .ko: ko
        case .en: en
        case .nl: nl
        }
    }

    /// A slip as it floats on screen: with its margins (tape, shadow) on the desk colour.
    static func slip<V: View>(_ view: V, to url: URL) throws {
        try render(view.padding(SlipMetrics.margin).background(PaperTheme.desk), size: nil, to: url)
    }

    /// A slip through its real window (SlipPanel, as the app shows it): what the window holds, on the desk
    /// colour — the window must be the slip's size, with its top edge and its shadow whole (1.42.1).
    static func panelSlip<V: View>(_ view: V, to url: URL) throws {
        guard wanted(url) else { return }
        let panel = SlipPanel(nonactivating: true)
        panel.appearance = NSAppearance(named: night ? .darkAqua : .aqua)
        panel.show(view)
        RunLoop.main.run(until: Date().addingTimeInterval(0.15))
        guard let hosting = panel.contentView else { throw CocoaError(.fileWriteUnknown) }
        // The desk under the window's clear corners, behind the slip (the window itself is clear).
        let desk = DeskBackdrop(frame: NSRect(origin: .zero, size: panel.frame.size))
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

    private final class DeskBackdrop: NSView {
        override func draw(_ dirtyRect: NSRect) {
            NSColor(PaperTheme.desk).setFill()
            dirtyRect.fill()
        }
    }

    /// The top of a view (`height` points of a `size` view), drawn at twice the size for checking edges
    /// up close: rendered at 4× backing scale and cropped.
    static func zoom<V: View>(_ view: V, size: NSSize, height: CGFloat, to url: URL) throws {
        guard wanted(url) else { return }
        let hosting = NSHostingView(rootView: view.frame(width: size.width, height: size.height))
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: night ? .darkAqua : .aqua)
        window.contentView = hosting
        hosting.frame = NSRect(origin: .zero, size: size)
        hosting.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.15))
        let scale: CGFloat = 4
        let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width * scale), pixelsHigh: Int(height * scale), bitsPerSample: 8,
                                      samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
        bitmap.size = NSSize(width: size.width, height: height)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: bitmap)
        // The top `height` points: shift the view down so its top lands in the bitmap.
        let transform = NSAffineTransform()
        transform.translateX(by: 0, yBy: height - size.height)
        transform.concat()
        hosting.displayIgnoringOpacity(hosting.bounds, in: NSGraphicsContext.current!)
        NSGraphicsContext.restoreGraphicsState()
        try bitmap.representation(using: .png, properties: [:])!.write(to: url)
        window.close()
    }

    /// `PAPERTODO_ONLY=note-,ahead` draws only the files whose names contain one of the words (quick
    /// checks while working); unset draws everything.
    static let only = ProcessInfo.processInfo.environment["PAPERTODO_ONLY"]?.split(separator: ",").map(String.init) ?? []
    static func wanted(_ url: URL) -> Bool {
        only.isEmpty || only.contains { url.lastPathComponent.contains($0) }
    }

    static func render<V: View>(_ view: V, size: NSSize?, to url: URL) throws {
        guard wanted(url) else { return }
        let hosting = NSHostingView(rootView: view)
        let fitting = size ?? hosting.fittingSize
        let window = NSWindow(contentRect: NSRect(origin: .zero, size: fitting),
                              styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: night ? .darkAqua : .aqua)
        window.contentView = hosting
        hosting.frame = NSRect(origin: .zero, size: fitting)
        hosting.layoutSubtreeIfNeeded()
        RunLoop.main.run(until: Date().addingTimeInterval(0.15))
        guard let bitmap = hosting.bitmapImageRepForCachingDisplay(in: hosting.bounds) else {
            throw CocoaError(.fileWriteUnknown)
        }
        hosting.cacheDisplay(in: hosting.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else {
            throw CocoaError(.fileWriteUnknown)
        }
        try data.write(to: url)
        window.close()
    }
}

/// The status item's button as the menu bar draws it: an NSButton set up the same way.
private struct MenuBarButtonPreview: NSViewRepresentable {
    let state: MenuBarState
    let dark: Bool

    func makeNSView(context: Context) -> NSButton {
        let button = NSButton(title: "", target: nil, action: nil)
        button.isBordered = false
        button.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
        // The menu bar draws a template image and its words in the label colour.
        button.contentTintColor = .labelColor
        state.apply(to: button)
        return button
    }

    func updateNSView(_ button: NSButton, context: Context) { state.apply(to: button) }
}
