import AppKit
import PaperCore
import SwiftUI

/// 달력: a month or a week of events and to-dos in its own window, with the chosen day on the
/// right. Double-click a day (or Return) for a new event; click an event to change it.
struct CalendarWindowView: View {
    enum Mode: String { case month, week }

    @ObservedObject var model: AppModel
    @ObservedObject var calendar: EventBook
    @State private var mode: Mode
    @State private var selected: String
    /// Any day on the page that shows (the month, or the week).
    @State private var page: String
    @State private var sheet: CalendarSheetRequest?
    @FocusState private var focused: Bool
    @State private var width: CGFloat = 820
    /// The day panel grows a little on a wide window.
    private var panelWidth: CGFloat { min(360, max(260, width * 0.34)) }

    private let language = AppLanguage.current
    /// Agenda times ("10:00–11:00", English "10:00–11:00 AM") and the day panel's to-do times.
    private var agendaWidth: CGFloat { language == .en ? 112 : 84 }
    private var panelTimeWidth: CGFloat { [40, 64, 56][AppLanguage.allCases.firstIndex(of: language)!] }
    /// "14:00–15:30" · "2:00–3:30 PM" (1.39).
    private var panelRangeWidth: CGFloat { [84, 104, 84][AppLanguage.allCases.firstIndex(of: language)!] }
    /// Snapshots: the day they draw (to-dos without a date take their time on it).
    private var fixedDay: String?
    private var now: Date { fixedDay.flatMap { Deadline.date(from: $0) } ?? Date() }

    init(model: AppModel, today: String? = nil) {
        self.model = model
        fixedDay = today
        calendar = model.calendar
        let day = today ?? CalendarDraft.day(Date())
        _mode = State(initialValue: Mode(rawValue: UserDefaults.standard.string(forKey: "calendar.view") ?? "") ?? .month)
        _selected = State(initialValue: day)
        _page = State(initialValue: day)
    }

    /// Design snapshots: a given page and view.
    init(model: AppModel, today: String, mode: Mode) {
        self.init(model: model, today: today)
        _mode = State(initialValue: mode)
    }

    private var today: String { CalendarDraft.day(Date()) }

    private var days: [String] {
        switch mode {
        case .month:
            let p = CalendarMonth.parts(page)
            return CalendarMonth.monthGrid(year: p.year, month: p.month, language: language)
        case .week:
            return CalendarMonth.weekDays(page, language: language)
        }
    }

    private var events: [CalendarEvent] {
        let range = CalendarMonth.fetchRange(days)
        return calendar.occurrences(from: range.start, to: range.end)
    }

    var body: some View {
        VStack(spacing: 0) {
            topBar
                .padding(.horizontal, 20)
                .padding(.top, DeskMetrics.top)
                .padding(.bottom, 12)
            HStack(spacing: 0) {
                Group {
                    if mode == .month { monthView } else { weekView }
                }
                .padding(.leading, 16)
                .padding(.trailing, 12)
                .padding(.bottom, 16)
                Rectangle().fill(PaperTheme.rule).frame(width: 1)
                dayPanel
                    .frame(width: panelWidth)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .foregroundStyle(PaperTheme.ink)
        .environment(\.locale, AppLanguage.current.locale)
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onAppear {
            focused = true
            showAskedDay()
        }
        .onChange(of: calendar.windowDay) { showAskedDay() }
        .onKeyPress(keys: [.leftArrow, .rightArrow, .upArrow, .downArrow, .return, "t", "T"]) { press in
            key(press.key)
        }
    }

    // MARK: Top bar

    private var title: String {
        if mode == .week { return CalendarMonth.weekTitle(days, language: language) }
        let p = CalendarMonth.parts(page)
        return CalendarMonth.monthTitle(year: p.year, month: p.month, language: language)
    }

    /// The pane's header: the month (or week) in 22 pt, ‹ 오늘 ›, 주 · 월 and + 새 일정.
    private var topBar: some View {
        HStack(spacing: 10) {
            Text(title)
                .font(.system(size: 22, weight: .semibold).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: 2) {
                arrow("chevron.left", help: mode == .month ? L("이전 달") : L("이전 주"), key: "[") { turn(-1) }
                Button("오늘") { go(to: today) }
                    .buttonStyle(PaperActionButtonStyle())
                    .help("오늘로 (T)")
                arrow("chevron.right", help: mode == .month ? L("다음 달") : L("다음 주"), key: "]") { turn(1) }
            }
            .fixedSize()
            PaperSegmented(selection: modeBinding, options: [(.week, L("주"), "calendar.day.timeline.left"), (.month, L("월"), "calendar")], label: L("보기"))
                .frame(width: language == .ko ? 132 : 172)
            Button { newEvent(on: selected) } label: {
                Label("새 일정", systemImage: "plus").labelStyle(.titleAndIcon).lineLimit(1)
            }
            .buttonStyle(PaperActionButtonStyle(primary: true))
            .fixedSize()
            .help("새 일정 (Return)")
        }
    }

    private func arrow(_ symbol: String, help: String, key: KeyEquivalent, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .semibold))
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(PaperTheme.secondary)
        .keyboardShortcut(key, modifiers: .command)
        .help(help)
        .accessibilityLabel(help)
    }

    private var modeBinding: Binding<Mode> {
        Binding(get: { mode }, set: { mode = $0; page = selected; UserDefaults.standard.set($0.rawValue, forKey: "calendar.view") })
    }

    // MARK: Month

    private var monthView: some View {
        VStack(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(language.weekdayOrder, id: \.self) { weekday in
                    Text(language.weekdayShort(weekday))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(weekday == 0 ? PaperTheme.clayText : PaperTheme.secondary)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: 22)
            GeometryReader { geometry in
                let height = geometry.size.height / 6
                // Title only (the time is in the tooltip and the day panel); very narrow cells: colour dots.
                let dots = geometry.size.width / 7 < 52 // (Windows: 52 px)
                VStack(spacing: 0) {
                    ForEach(0..<6, id: \.self) { row in
                        HStack(spacing: 0) {
                            ForEach(days[(row * 7)..<(row * 7 + 7)], id: \.self) { day in
                                // The day number (≈30 pt with its padding), then ≈16 pt per line ("+N" counts as one).
                                monthCell(day, lines: max(1, Int((height - 30) / 16)), dots: dots).frame(maxWidth: .infinity).frame(height: height)
                            }
                        }
                    }
                }
            }
        }
        .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(PaperTheme.rule, lineWidth: 1) }
    }

    /// `lines`: as many as the cell's height fits (3 at the usual size).
    private func monthCell(_ day: String, lines: Int, dots: Bool) -> some View {
        let inMonth = CalendarMonth.parts(day).month == CalendarMonth.parts(page).month
        var cell = CalendarMonth.cellItems(day, events: events, tasks: model.items, limit: lines)
        // More than fits: one line fewer, so "+N" has its own.
        if cell.more > 0 && lines > 1 { cell = CalendarMonth.cellItems(day, events: events, tasks: model.items, limit: lines - 1) }
        return VStack(alignment: .leading, spacing: 2) {
            dayNumber(day, size: 12)
            if dots {
                // Too narrow for words: a dot per item, then "+N".
                let all = CalendarMonth.cellItems(day, events: events, tasks: model.items, limit: 99).items
                HStack(spacing: 2.5) {
                    ForEach(Array(all.prefix(4).enumerated()), id: \.offset) { _, item in
                        if case .task(let task) = item, task.kind == .deadline {
                            // A deadline: a small flag, as on Windows.
                            Image(systemName: "flag.fill").font(.system(size: 6.5)).foregroundStyle(dotColor(item, day: day))
                        } else {
                            Circle().fill(dotColor(item, day: day)).frame(width: 5, height: 5)
                        }
                    }
                    if all.count > 4 {
                        Text("+\(all.count - 4)").font(.system(size: 8.5, weight: .semibold)).foregroundStyle(PaperTheme.secondary)
                    }
                }
                .padding(.leading, 2)
            } else {
                ForEach(Array(cell.items.enumerated()), id: \.offset) { _, item in cellLine(item, day: day) }
                if cell.more > 0 {
                    Text("+\(cell.more)")
                        .font(.system(size: 9.5, weight: .semibold))
                        .foregroundStyle(PaperTheme.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 4)
        .padding(.top, 4)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        // Never taller than its row (a small window): the rows stay lined up.
        .clipped()
        .background {
            if day == selected {
                RoundedRectangle(cornerRadius: 6).fill(PaperTheme.sage.opacity(0.1))
                    .overlay { RoundedRectangle(cornerRadius: 6).stroke(PaperTheme.sage.opacity(0.6), lineWidth: 1) }
                    .padding(1.5)
            }
        }
        .overlay(alignment: .top) { Rectangle().fill(PaperTheme.rule.opacity(0.55)).frame(height: 0.5) }
        .opacity(inMonth ? 1 : 0.4)
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { select(day); newEvent(on: day) }
        .onTapGesture { select(day) }
        .accessibilityElement(children: .combine)
        .accessibilityLabel(CalendarMonth.dayTitle(day, language: language))
        .accessibilityAddTraits(day == selected ? .isSelected : [])
    }

    @ViewBuilder
    private func cellLine(_ item: CalendarMonth.CellItem, day: String) -> some View {
        switch item {
        case .event(let event):
            HStack(spacing: 3) {
                RoundedRectangle(cornerRadius: 1).fill(color(event)).frame(width: 2.5, height: 10)
                Text(event.title).font(.system(size: 10.5)).lineLimit(1)
            }
            .padding(.horizontal, event.allDay ? 3 : 0)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background { if event.allDay { RoundedRectangle(cornerRadius: 3).fill(color(event).opacity(0.16)) } }
            .help(cellTime(event, on: day).map { $0 + " " + event.title } ?? event.title)
        case .task(let task):
            // Clay only when it's due today or late; a deadline still ahead is a quiet ink flag.
            let late = day <= today
            HStack(spacing: 2) {
                Image(systemName: task.kind == .deadline ? "flag.fill" : "bell.fill").font(.system(size: 7))
                    .foregroundStyle(late ? PaperTheme.clayText : PaperTheme.ink3)
                Text(task.title).font(.system(size: 10.5)).lineLimit(1)
                    .foregroundStyle(late ? PaperTheme.clayText : PaperTheme.ink2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .help(task.title)
        }
    }

    private func dotColor(_ item: CalendarMonth.CellItem, day: String) -> Color {
        switch item {
        case .event(let event): color(event)
        case .task: day <= today ? PaperTheme.clay : PaperTheme.ink3
        }
    }

    /// A month cell's start time, when the event starts that day: "10:00" — English "10a", "9:30p".
    private func cellTime(_ event: CalendarEvent, on day: String) -> String? {
        let agenda = CalendarMonth.agendaTime(event, on: day, language: language)
        guard let first = agenda.first, first.isNumber else { return nil }
        guard language == .en else { return String(agenda.prefix(5)) }
        let parts = Calendar.paper.dateComponents([.hour, .minute], from: event.start)
        let hour = parts.hour! % 12 == 0 ? 12 : parts.hour! % 12
        return "\(hour)" + (parts.minute! == 0 ? "" : String(format: ":%02d", parts.minute!)) + (parts.hour! < 12 ? "a" : "p")
    }

    private func dayNumber(_ day: String, size: CGFloat) -> some View {
        let isToday = day == today
        let weekday = Calendar.paper.component(.weekday, from: CalendarMonth.date(day))
        return Text("\(CalendarMonth.parts(day).day)")
            .font(.system(size: size, weight: isToday ? .bold : .semibold).monospacedDigit())
            .foregroundStyle(isToday ? PaperTheme.onSage : weekday == 1 ? PaperTheme.clayText : PaperTheme.ink)
            .frame(minWidth: size + 8, minHeight: size + 8)
            .background { if isToday { Circle().fill(PaperTheme.sage) } }
    }

    // MARK: Week

    private var weekView: some View {
        GeometryReader { geometry in
            let lines = max(1, Int((geometry.size.height / 7 - 12) / 16))
            VStack(spacing: 0) {
                ForEach(days, id: \.self) { day in
                    weekRow(day, limit: lines)
                        .frame(maxHeight: .infinity)
                    if day != days.last { Rectangle().fill(PaperTheme.rule.opacity(0.55)).frame(height: 0.5) }
                }
            }
        }
        .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(PaperTheme.rule, lineWidth: 1) }
    }

    /// `limit`: lines the row's height fits (3 at the usual size).
    private func weekRow(_ day: String, limit fitting: Int) -> some View {
        let dayEvents = CalendarMonth.eventsOn(day, events)
        let tasks = CalendarMonth.dayTasks(day, model.items, now: now, language: language)
        let lines = dayEvents.count + tasks.count
        // More than fits: one line fewer, so "+N개 더" has its own and the row keeps its height.
        let limit = lines > fitting && fitting > 1 ? fitting - 1 : fitting
        return HStack(alignment: .top, spacing: 10) {
            VStack(spacing: 1) {
                dayNumber(day, size: 16)
                Text(language.weekdayShort(Calendar.paper.component(.weekday, from: CalendarMonth.date(day)) - 1))
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(PaperTheme.secondary)
            }
            .frame(width: 58)
            VStack(alignment: .leading, spacing: 1) {
                ForEach(Array(dayEvents.prefix(limit).enumerated()), id: \.offset) { _, event in
                    eventLine(event, day: day, size: 12)
                }
                ForEach(Array(tasks.prefix(max(0, limit - dayEvents.count)).enumerated()), id: \.offset) { _, task in
                    taskLine(task, size: 12, day: day)
                }
                if lines > limit {
                    Text("+\(lines - limit)개 더").font(.system(size: 11, weight: .medium)).foregroundStyle(PaperTheme.sage)
                }
                if lines == 0 { Text(" ").font(.system(size: 12)) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background { if day == selected { RoundedRectangle(cornerRadius: 6).fill(PaperTheme.sage.opacity(0.1)).padding(2) } }
        .contentShape(Rectangle())
        .onTapGesture(count: 2) { select(day); newEvent(on: day) }
        .onTapGesture { select(day) }
    }

    private func eventLine(_ event: CalendarEvent, day: String, size: CGFloat) -> some View {
        HStack(spacing: 7) {
            RoundedRectangle(cornerRadius: 1.5).fill(color(event)).frame(width: 3, height: size + 2).frame(width: 12)
            Text(CalendarMonth.agendaTime(event, on: day, language: language))
                .font(.system(size: size - 1, weight: .medium).monospacedDigit())
                .foregroundStyle(PaperTheme.secondary)
                .lineLimit(1)
                .frame(width: agendaWidth, alignment: .leading)
            Text(event.title).font(.system(size: size)).lineLimit(1)
        }
    }

    /// 🔔 09:30 (a task reminder: the bell, as everywhere else; the alarm clock means 알람) or ⚑ 마감,
    /// then the title; `timeWidth` lines it up with the events around it. A deadline is clay only
    /// when it's due that day or late.
    private func taskLine(_ task: CalendarMonth.DayTask, size: CGFloat, day: String, timeWidth: CGFloat? = nil) -> some View {
        let late = task.kind == .deadline && day <= today
        return HStack(spacing: 7) {
            if task.kind == .range {
                // 1.39: a to-do's time — an outlined block, like on the 하루 띠.
                RoundedRectangle(cornerRadius: 2.5, style: .continuous).fill(PaperTheme.card)
                    .overlay { RoundedRectangle(cornerRadius: 2.5, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) }
                    .frame(width: 10, height: size - 2)
                    .frame(width: 12)
            } else {
                Image(systemName: task.kind == .deadline ? "flag.fill" : "bell.fill")
                    .font(.system(size: size - 4, weight: .semibold))
                    .foregroundStyle(task.kind == .deadline ? (late ? PaperTheme.clay : PaperTheme.ink3) : PaperTheme.sage)
                    .frame(width: 12)
            }
            Text(task.time ?? L("마감"))
                .font(.system(size: size - 1, weight: .medium).monospacedDigit())
                .foregroundStyle(late ? PaperTheme.clayText : PaperTheme.secondary)
                .lineLimit(1)
                // A range is longer than a clock: it keeps its own width.
                .frame(minWidth: timeWidth ?? agendaWidth, alignment: .leading)
                .fixedSize(horizontal: task.kind == .range, vertical: false)
            Text(task.title).font(.system(size: size)).lineLimit(1)
        }
    }

    // MARK: The day

    private var dayPanel: some View {
        let dayEvents = CalendarMonth.eventsOn(selected, events)
        let tasks = CalendarMonth.dayTasks(selected, model.items, now: now, language: language)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text(CalendarMonth.dayTitle(selected, language: language)).font(.system(size: 15, weight: .semibold))
                if selected == today {
                    Text("오늘").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(PaperTheme.onSage)
                        .padding(.horizontal, 6).frame(height: 17).background(PaperTheme.sage, in: Capsule())
                }
                Spacer(minLength: 0)
            }
            .padding(.bottom, 12)
            .background(EventSheetAnchor(request: sheet, calendar: calendar, onClose: { sheet = nil }, topInset: 70))
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    section(L("일정"))
                    if dayEvents.isEmpty {
                        Text("일정 없음").font(.system(size: 12)).foregroundStyle(PaperTheme.faded)
                    }
                    ForEach(dayEvents, id: \.key) { event in panelEvent(event) }
                    Button { newEvent(on: selected) } label: {
                        Label("새 일정", systemImage: "plus").font(.system(size: 12, weight: .medium))
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(PaperTheme.sage)
                    .padding(.top, 2)
                    if !tasks.isEmpty {
                        section(L("할 일")).padding(.top, 12)
                        // With a time range among them, the column is wide enough for "14:00–15:30" on every line.
                        let timeWidth = tasks.contains { $0.kind == .range } ? panelRangeWidth : panelTimeWidth
                        ForEach(tasks, id: \.taskId) { task in
                            Button { model.reveal(task.taskId) } label: { taskLine(task, size: 12.5, day: selected, timeWidth: timeWidth).contentShape(Rectangle()) }
                                .buttonStyle(.plain)
                                .help("노트에서 보기")
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(16)
    }

    private func section(_ title: String) -> some View {
        Text(title).font(.system(size: 11, weight: .semibold)).foregroundStyle(PaperTheme.secondary)
    }

    private func panelEvent(_ event: CalendarEvent) -> some View {
        Button { sheet = .edit(event, in: calendar) } label: {
            HStack(alignment: .top, spacing: 8) {
                RoundedRectangle(cornerRadius: 1.5).fill(color(event)).frame(width: 3, height: event.location == nil ? 18 : 30)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(CalendarMonth.agendaTime(event, on: selected, language: language))
                            .font(.system(size: 11.5, weight: .medium).monospacedDigit())
                            .foregroundStyle(PaperTheme.secondary)
                        Text(event.title).font(.system(size: 13)).lineLimit(2)
                        if event.recurring {
                            Image(systemName: "repeat").font(.system(size: 9.5)).foregroundStyle(PaperTheme.faded)
                        }
                    }
                    if let location = event.location {
                        Text(location).font(.system(size: 10.5)).foregroundStyle(PaperTheme.faded).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help("눌러서 고치기")
        .contextMenu { TodayEventsStrip.menu(event, calendar: calendar, onAddTask: { model.add($0, literal: true) }) { sheet = $0 } }
    }

    // MARK: Doing

    private func color(_ event: CalendarEvent) -> Color { PaperTheme.event(event.color, fallback: PaperTheme.sage) }

    private func select(_ day: String) {
        selected = day
        focused = true
    }

    private func go(to day: String) {
        selected = day
        page = day
    }

    /// ‹ ›: a month or a week. A new month starts on its 1st (or today, if it's this month).
    private func turn(_ step: Int) {
        if mode == .week {
            go(to: CalendarMonth.adding(7 * step, to: selected))
            return
        }
        let p = CalendarMonth.parts(page)
        let first = Calendar.paper.date(byAdding: .month, value: step, to: CalendarMonth.date(String(format: "%04d-%02d-01", p.year, p.month)))!
        let day = CalendarDraft.day(first)
        go(to: CalendarMonth.parts(today).month == CalendarMonth.parts(day).month && CalendarMonth.parts(today).year == CalendarMonth.parts(day).year ? today : day)
    }

    private func key(_ key: KeyEquivalent) -> KeyPress.Result {
        guard sheet == nil else { return .ignored }
        switch key {
        case .leftArrow: move(-1)
        case .rightArrow: move(1)
        case .upArrow: move(mode == .month ? -7 : -1)
        case .downArrow: move(mode == .month ? 7 : 1)
        case .return: newEvent(on: selected)
        default: go(to: today)
        }
        return .handled
    }

    private func move(_ days: Int) {
        let day = CalendarMonth.adding(days, to: selected)
        selected = day
        if !self.days.contains(day) || (mode == .month && CalendarMonth.parts(day).month != CalendarMonth.parts(page).month) { page = day }
    }

    private func showAskedDay() {
        guard let day = calendar.windowDay else { return }
        calendar.windowDay = nil
        go(to: day)
    }

    private func newEvent(on day: String) {
        sheet = CalendarSheetRequest(mode: .new, draft: CalendarMonth.draftForDay(day, now: Date(), color: calendar.lastColor))
    }
}
