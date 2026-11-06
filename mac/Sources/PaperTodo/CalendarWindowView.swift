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

    /// Today, worked out again when the day turns (`dayTurns`: the today ring and badge move at midnight).
    private var today: String {
        _ = dayTurns
        return CalendarDraft.day(Date())
    }
    @State private var dayTurns = 0

    /// Kept with the page (the body reads them for every row).
    private var days: [String] { pages.days(mode: mode, page: page, language: language) }

    /// The page's events and to-dos by day (#68), made again only when what they come from changes.
    @State private var pages = CalendarPageCache()

    private func makePage() -> CalendarMonth.Page {
        // #227: without the to-dos this Mac hides now (as the 오늘 창: a peek on the note doesn't reach here).
        pages.page(days: days, selected: selected, events: calendar.events, tasks: model.hereItems, now: now, language: language)
    }

    var body: some View {
        content(makePage())
    }

    private func content(_ data: CalendarMonth.Page) -> some View {
        VStack(spacing: 0) {
            topBar
                .padding(.horizontal, 20)
                .padding(.top, DeskMetrics.top)
                .padding(.bottom, 12)
            HStack(spacing: 0) {
                Group {
                    if mode == .month { monthView(data) } else { weekView(data) }
                }
                .padding(.leading, 16)
                .padding(.trailing, 12)
                .padding(.bottom, 16)
                Rectangle().fill(PaperTheme.rule).frame(width: 1)
                dayPanel(data)
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
        // The day turns at midnight (or the clock or time zone changes): the today ring and badge move with it.
        .onReceive(NotificationCenter.default.publisher(for: .NSCalendarDayChanged).merge(with:
            NotificationCenter.default.publisher(for: .NSSystemTimeZoneDidChange),
            NotificationCenter.default.publisher(for: .NSSystemClockDidChange)).receive(on: RunLoop.main)) { _ in dayTurns += 1 }
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

    private func monthView(_ data: CalendarMonth.Page) -> some View {
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
                let cellWidth = geometry.size.width / 7
                // Title only (the time is in the tooltip and the day panel); very narrow cells: colour dots.
                // #227: events, then deadlines, then reminders.
                let dots = cellWidth < 52 // (Windows: 52 px)
                // The day number (≈30 pt with its padding), then ≈16 pt per line ("+N" counts as one).
                let lines = max(1, Int((height - 30) / 16))
                VStack(spacing: 0) {
                    ForEach(0..<6, id: \.self) { row in
                        let week = Array(days[(row * 7)..<(row * 7 + 7)])
                        let cells = week.map { monthCellContent($0, data: data, lines: lines, dots: dots) }
                        // calendar-flows D1: a multi-day event's band joins along the row, its title once (a holiday's
                        // name holds the first place, as on Windows).
                        let bands = dots ? Array(repeating: [], count: 7) : CalendarMonth.bands(cells.enumerated().map { column, content in
                            (content.holiday == nil ? [] : [nil]) + content.cell.items.map { bandKey($0, on: week[column]) }
                        })
                        HStack(spacing: 0) {
                            ForEach(Array(week.enumerated()), id: \.element) { column, day in
                                let content = cells[column]
                                let dayBands = Array(bands[column].dropFirst(content.holiday == nil || dots ? 0 : 1))
                                let two = dots ? (holiday: false, lines: []) : twoLines(content, day: day, bands: dayBands, cellWidth: cellWidth)
                                Keyed(key: MonthCellKey(day: day, inMonth: inMonth(day), selected: day == selected, today: today, lines: lines,
                                                        dots: dots, all: data.cell(day, limit: 99), marks: marksKey(day), bands: dayBands, two: two.lines,
                                                        twoHoliday: two.holiday, width: (cellWidth * 2).rounded())) {
                                    monthCell(day, data: data, content: content, dots: dots, bands: dayBands, two: two.lines, twoHoliday: two.holiday,
                                              cellWidth: cellWidth)
                                }
                                .equatable()
                                .frame(maxWidth: .infinity).frame(height: height)
                                // A title running over the next days is drawn above their cells.
                                .zIndex(Double(7 - column))
                            }
                        }
                    }
                }
            }
        }
        .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(PaperTheme.rule, lineWidth: 1) }
    }

    private func inMonth(_ day: String) -> Bool { CalendarMonth.parts(day).month == CalendarMonth.parts(page).month }

    /// What a month cell is drawn from (#68): the cells are drawn again only when it changes, not on every change of
    /// the model (`all`: the day's lines, as `cell(limit: 99)` — every shorter cell is cut from it).
    private struct MonthCellKey: Equatable, Sendable {
        var day: String
        var inMonth: Bool
        var selected: Bool
        var today: String
        var lines: Int
        var dots: Bool
        var all: (items: [CalendarMonth.CellItem], more: Int)
        /// #234: the lunar date and the holiday it shows.
        var marks: String
        /// calendar-flows D1 · D2: how its lines join the days beside it, which titles take two lines, and the cell's
        /// width (a title running on is as wide as the days it covers).
        var bands: [CalendarMonth.Band]
        var two: [Bool]
        /// #260: the holiday's name on two lines.
        var twoHoliday: Bool
        var width: CGFloat
        static func == (a: Self, b: Self) -> Bool {
            a.day == b.day && a.inMonth == b.inMonth && a.selected == b.selected && a.today == b.today && a.lines == b.lines
                && a.dots == b.dots && a.all.items == b.all.items && a.all.more == b.all.more && a.marks == b.marks
                && a.bands == b.bands && a.two == b.two && a.twoHoliday == b.twoHoliday && a.width == b.width
        }
    }

    /// What a month cell holds: its holiday's name (which takes a line), the lines its height fits (`lines`) and those
    /// left for its things (`room`), and what it draws (one line fewer when more than fits, so "+N" has its own).
    private struct CellContent {
        var holiday: String?
        var lines: Int
        var room: Int
        var cell: (items: [CalendarMonth.CellItem], more: Int)
    }

    private func monthCellContent(_ day: String, data: CalendarMonth.Page, lines: Int, dots: Bool) -> CellContent {
        // #234: a holiday's name takes a line.
        let holiday = holidayName(day)
        let room = holiday != nil && !dots ? max(1, lines - 1) : lines
        var cell = data.cell(day, limit: room)
        if cell.more > 0 && room > 1 { cell = data.cell(day, limit: room - 1) }
        return CellContent(holiday: holiday, lines: lines, room: room, cell: cell)
    }

    private func bandKey(_ item: CalendarMonth.CellItem, on day: String) -> String? {
        guard case .event(let event) = item else { return nil }
        return CalendarMonth.bandKey(event, on: day)
    }

    /// Audit 3 · 28 (D2), #260: the cut titles — the holiday's name first — that take the cell's spare lines. Korean breaks
    /// only between words; English and Dutch also inside a word, by its hyphenation (`CellFit`). One that can't break
    /// stays on one line and ends with "…" (its whole name in the tooltip).
    private func twoLines(_ content: CellContent, day: String, bands: [CalendarMonth.Band], cellWidth: CGFloat) -> (holiday: Bool, lines: [Bool]) {
        let font = NSFont.systemFont(ofSize: 10.5)
        let fits: [CalendarMonth.LineFit] = content.cell.items.enumerated().map { index, item in
            if bands.indices.contains(index), bands[index].joined { return .band }
            let title: String, inset: CGFloat
            switch item {
            // The cell's padding, the colour bar (and a tinted band's own padding) · the flag or bell.
            case .event(let event): title = event.title; inset = 8 + 5.5 + (event.allDay || CalendarMonth.bandKey(event, on: day) != nil ? 6 : 0)
            case .task(let task): title = task.title; inset = 8 + 11
            }
            return CellFit.of(title, font: font, room: cellWidth - inset - 1, language: language)
        }
        // The holiday's name: the cell's padding and its own.
        let holiday = content.holiday.map { _ in CellFit.of(shownHoliday(day) ?? "", font: .systemFont(ofSize: 10, weight: .semibold), room: cellWidth - 8 - 2 - 1, language: language) }
        return CalendarMonth.twoLineTitles(room: content.lines - (content.cell.more > 0 ? 1 : 0), holiday: holiday, lines: fits)
    }

    /// `content`: what the cell holds (as many lines as its height fits, 3 at the usual size).
    private func monthCell(_ day: String, data: CalendarMonth.Page, content: CellContent, dots: Bool, bands: [CalendarMonth.Band], two: [Bool],
                           twoHoliday: Bool, cellWidth: CGFloat) -> some View {
        let inMonth = inMonth(day)
        let holiday = content.holiday
        let cell = content.cell
        let runs = bands.contains { $0.run > 1 }
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 2) {
                dayNumber(day, size: 12)
                Spacer(minLength: 0)
                if let lunar = lunar(day), !dots,
                   CalendarWidget.showsLunar(lunarDay: KoreanCalendar.lunar(day)?.day ?? 0, cellWidth: cellWidth, moreInHead: false) {
                    Text(lunar.label)
                        .font(.system(size: 9.5).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink3)
                        .lineLimit(1)
                        .fixedSize()
                        .help(lunar.spoken)
                        .padding(.trailing, 2)
                }
            }
            if let holiday, !dots {
                Text(twoHoliday ? shownHoliday(day) ?? holiday : holiday)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(PaperTheme.clayText)
                    .lineLimit(twoHoliday ? 2 : 1)
                    .fixedSize(horizontal: false, vertical: twoHoliday)
                    .truncationMode(.tail)
                    .padding(.leading, 2)
                    .help(holiday)
            }
            if dots {
                // Too narrow for words: a dot per item, then "+N".
                let all = data.cell(day, limit: 99).items
                HStack(spacing: 2.5) {
                    ForEach(Array(all.prefix(4).enumerated()), id: \.offset) { _, item in
                        if case .task(let task) = item {
                            // A deadline: a small flag, as on Windows; a reminder (#227): a small bell.
                            Image(systemName: task.kind == .deadline ? "flag.fill" : "bell.fill").font(.system(size: 6.5))
                                .foregroundStyle(dotColor(item, day: day))
                                .help(CalendarMonth.tooltip(task, language: language))
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
                ForEach(Array(cell.items.enumerated()), id: \.offset) { index, item in
                    cellLine(item, day: day, band: bands.indices.contains(index) ? bands[index] : .init(run: 1, fromLeft: false, toRight: false),
                             two: two.indices.contains(index) && two[index], cellWidth: cellWidth)
                }
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
        // Never taller than its row (a small window): the rows stay lined up. A title running over the next days may
        // go past the right edge.
        .clipShape(RunOver(extra: runs ? cellWidth * 7 : 0))
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
        // #260: the holiday's whole name, even where the cell cuts it.
        .accessibilityLabel(CalendarMonth.dayTitle(day, language: language) + (holiday.map { ", " + $0 } ?? ""))
        .accessibilityAddTraits(day == selected ? .isSelected : [])
    }

    @ViewBuilder
    private func cellLine(_ item: CalendarMonth.CellItem, day: String, band: CalendarMonth.Band, two: Bool, cellWidth: CGFloat) -> some View {
        switch item {
        case .event(let event):
            let tinted = event.allDay || CalendarMonth.bandKey(event, on: day) != nil
            let shape = UnevenRoundedRectangle(cornerRadii: .init(topLeading: band.fromLeft ? 0 : 3, bottomLeading: band.fromLeft ? 0 : 3,
                                                                  bottomTrailing: band.toRight ? 0 : 3, topTrailing: band.toRight ? 0 : 3))
            HStack(alignment: two ? .top : .center, spacing: 3) {
                // calendar-flows D1: no bar of its own where it goes on from the day before.
                if !band.fromLeft {
                    RoundedRectangle(cornerRadius: 1).fill(color(event)).frame(width: 2.5, height: 10).padding(.top, two ? 2 : 0)
                }
                Text(two ? CalendarMonth.hyphenated(event.title.keepingParticles, language: language) : event.title.keepingParticles)
                    .font(.system(size: 10.5)).lineLimit(two ? 2 : 1)
                    .fixedSize(horizontal: false, vertical: two)
                    // Drawn by the overlay (running on), or by the day it runs on from.
                    .opacity(band.run == 1 ? 1 : 0)
            }
            .padding(.horizontal, tinted ? 3 : 0)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .leading) {
                if band.run > 1 {
                    // The title over the days the band runs on (their clicks go to them).
                    Text(event.title).font(.system(size: 10.5)).lineLimit(1)
                        .frame(width: max(0, CGFloat(band.run) * cellWidth - 8 - 8.5 - 3), alignment: .leading)
                        .padding(.leading, 8.5)
                        .allowsHitTesting(false)
                }
            }
            .background {
                if tinted {
                    shape.fill(color(event).opacity(0.16))
                        .padding(.leading, band.fromLeft ? -4 : 0)
                        .padding(.trailing, band.toRight ? -4 : 0)
                }
            }
            .help(cellTime(event, on: day).map { $0 + " " + event.title } ?? event.title)
        case .task(let task):
            // Clay only when it's due today or late; a deadline still ahead is a quiet ink flag. A reminder (#227): a sage
            // bell and the title, without its time (that's in the tooltip and the day panel).
            let late = task.kind == .deadline && day <= today
            HStack(alignment: two ? .top : .center, spacing: 2) {
                Image(systemName: task.kind == .deadline ? "flag.fill" : "bell.fill").font(.system(size: 7))
                    .foregroundStyle(late ? PaperTheme.clayText : task.kind == .deadline ? PaperTheme.ink3 : PaperTheme.sage)
                    .padding(.top, two ? 3 : 0)
                Text(two ? CalendarMonth.hyphenated(task.title.keepingParticles, language: language) : task.title.keepingParticles)
                    .font(.system(size: 10.5)).lineLimit(two ? 2 : 1)
                    .fixedSize(horizontal: false, vertical: two)
                    .foregroundStyle(late ? PaperTheme.clayText : PaperTheme.ink2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .help(CalendarMonth.tooltip(task, language: language))
        }
    }

    private func dotColor(_ item: CalendarMonth.CellItem, day: String) -> Color {
        switch item {
        case .event(let event): color(event)
        case .task(let task) where task.kind != .deadline: PaperTheme.sage
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

    // MARK: 음력 · 공휴일 (#234)

    private func lunar(_ day: String) -> (label: String, spoken: String)? { calendar.showsLunar ? DayMarks.lunar(day) : nil }
    private func holidayName(_ day: String) -> String? { calendar.showsHolidays ? DayMarks.holiday(day) : nil }
    /// #260: as a month cell draws it on two lines, with the places it may break.
    private func shownHoliday(_ day: String) -> String? { calendar.showsHolidays ? DayMarks.holidayShown(day) : nil }
    /// The day panel's holiday name (clay) and lunar date, as one text that may wrap.
    private func panelMarks(_ holiday: String?, _ lunar: String?) -> Text {
        var text = AttributedString()
        if let holiday {
            var name = AttributedString(holiday)
            name.font = .system(size: 11.5, weight: .semibold)
            name.foregroundColor = PaperTheme.clayText
            text += name
        }
        if let lunar {
            // The lunar date stays whole on its line ("Maankalender 25-8", not "Maankalender" / "25-8").
            var date = AttributedString((holiday == nil ? "" : " · ") + lunar.replacingOccurrences(of: " ", with: "\u{00A0}"))
            date.font = .system(size: 11.5)
            date.foregroundColor = PaperTheme.ink3
            text += date
        }
        return Text(text)
    }
    private func marksKey(_ day: String) -> String { (lunar(day)?.label ?? "") + "|" + (holidayName(day) ?? "") }

    private func dayNumber(_ day: String, size: CGFloat) -> some View {
        let isToday = day == today
        let weekday = Calendar.paper.component(.weekday, from: CalendarMonth.date(day))
        let red = weekday == 1 || holidayName(day) != nil
        return Text("\(CalendarMonth.parts(day).day)")
            .font(.system(size: size, weight: isToday ? .bold : .semibold).monospacedDigit())
            .foregroundStyle(isToday ? PaperTheme.onSage : red ? PaperTheme.clayText : PaperTheme.ink)
            .frame(minWidth: size + 8, minHeight: size + 8)
            .background { if isToday { Circle().fill(PaperTheme.sage) } }
    }

    // MARK: Week

    private func weekView(_ data: CalendarMonth.Page) -> some View {
        GeometryReader { geometry in
            let lines = max(1, Int((geometry.size.height / 7 - 12) / 16))
            VStack(spacing: 0) {
                ForEach(days, id: \.self) { day in
                    Keyed(key: WeekRowKey(day: day, events: data.events(on: day), tasks: data.weekTasks(on: day), limit: lines,
                                          selected: day == selected, today: today, marks: marksKey(day))) {
                        weekRow(day, data: data, limit: lines)
                    }
                    .equatable()
                    .frame(maxHeight: .infinity)
                    if day != days.last { Rectangle().fill(PaperTheme.rule.opacity(0.55)).frame(height: 0.5) }
                }
            }
        }
        .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(PaperTheme.rule, lineWidth: 1) }
    }

    /// What a week row is drawn from (#68), as for the month's cells.
    private struct WeekRowKey: Equatable, Sendable {
        var day: String
        var events: [CalendarEvent]
        var tasks: [CalendarMonth.DayTask]
        var limit: Int
        var selected: Bool
        var today: String
        var marks: String
    }

    /// `limit`: lines the row's height fits (3 at the usual size).
    private func weekRow(_ day: String, data: CalendarMonth.Page, limit fitting: Int) -> some View {
        let dayEvents = data.events(on: day)
        // #227: as the month cells — events, deadlines, then reminders (with their time here: the row has the column).
        let tasks = data.weekTasks(on: day)
        let lines = dayEvents.count + tasks.count
        // More than fits: one line fewer, so "+N개 더" has its own and the row keeps its height.
        let limit = lines > fitting && fitting > 1 ? fitting - 1 : fitting
        return HStack(alignment: .top, spacing: 10) {
            VStack(spacing: 1) {
                dayNumber(day, size: 16)
                Text(language.weekdayShort(Calendar.paper.component(.weekday, from: CalendarMonth.date(day)) - 1))
                    .font(.system(size: 10.5, weight: .medium))
                    .foregroundStyle(PaperTheme.secondary)
                if let holiday = holidayName(day) {
                    Text(holiday).font(.system(size: 9.5, weight: .semibold)).foregroundStyle(PaperTheme.clayText)
                        .lineLimit(1).truncationMode(.tail).help(holiday)
                } else if let lunar = lunar(day) {
                    Text(lunar.label).font(.system(size: 9.5).monospacedDigit()).foregroundStyle(PaperTheme.ink3).help(lunar.spoken)
                }
            }
            .frame(width: 58)
            VStack(alignment: .leading, spacing: 1) {
                ForEach(Array(dayEvents.prefix(limit).enumerated()), id: \.offset) { _, event in
                    eventLine(event, day: day, size: 12)
                }
                ForEach(Array(tasks.prefix(max(0, limit - dayEvents.count)).enumerated()), id: \.offset) { _, task in
                    taskLine(task, size: 12, day: day).help(CalendarMonth.tooltip(task, language: language))
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

    private func dayPanel(_ data: CalendarMonth.Page) -> some View {
        let dayEvents = data.events(on: selected)
        let tasks = data.tasks(on: selected)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text(CalendarMonth.dayTitle(selected, language: language)).font(.system(size: 15, weight: .semibold))
                if selected == today {
                    Text("오늘").font(.system(size: 10.5, weight: .semibold)).foregroundStyle(PaperTheme.onSage)
                        .padding(.horizontal, 6).frame(height: 17).background(PaperTheme.sage, in: Capsule())
                }
                Spacer(minLength: 0)
            }
            .padding(.bottom, holidayName(selected) == nil && lunar(selected) == nil ? 12 : 2)
            .background(EventSheetAnchor(request: sheet, calendar: calendar, onClose: { sheet = nil }, topInset: 70))
            // calendar-flows: the holiday's name and the lunar date under the day (a narrow cell has no room for them).
            if holidayName(selected) != nil || lunar(selected) != nil {
                // #260: one line, or two for a long holiday name ("Vervangende vrije dag · Maankalender 25-8", as on Windows), never cut short.
                panelMarks(holidayName(selected), lunar(selected)?.spoken)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.bottom, 10)
            }
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
        // calendar-flows D3: an event pressed on a widget or its day sheet opens to change or remove.
        guard let key = calendar.windowEvent else { return }
        calendar.windowEvent = nil
        let range = CalendarMonth.fetchRange([day])
        if let occurrence = calendar.occurrences(from: range.start, to: range.end).first(where: { $0.key == key }) {
            sheet = .edit(occurrence, in: calendar)
        }
    }

    private func newEvent(on day: String) {
        sheet = CalendarSheetRequest(mode: .new, draft: CalendarMonth.draftForDay(day, now: Date(), color: calendar.lastColor))
    }
}

/// A month cell's clip (calendar-flows D1): its own box, and `extra` more to the right for a title that runs over the
/// next days of its band.
struct RunOver: Shape {
    var extra: CGFloat
    func path(in rect: CGRect) -> Path { Path(CGRect(x: rect.minX, y: rect.minY, width: rect.width + extra, height: rect.height)) }
}

/// A view drawn again only when its key changes (with `.equatable()`): the content is what the key describes.
struct Keyed<Key: Equatable & Sendable, Content: View>: View, Equatable {
    nonisolated let key: Key
    @ViewBuilder let content: () -> Content
    var body: some View { content() }
    nonisolated static func == (a: Self, b: Self) -> Bool { a.key == b.key }
}

/// The calendar window's page (#68): its events expanded once and its to-dos read once, kept until the days, the
/// chosen day, the events, the to-dos, the day or the language change. A change it doesn't show (a pick in the note)
/// costs a comparison: arrays that weren't touched compare by their storage.
@MainActor
final class CalendarPageCache {
    private struct Key: Equatable {
        var days: [String]
        var selected: String
        var events: [LocalEvent]
        var tasks: [TodoItem]
        var today: String
        var language: AppLanguage
        var calendar: Calendar
    }
    private var key: Key?
    private var page: CalendarMonth.Page?
    private var daysKey: (mode: CalendarWindowView.Mode, page: String, language: AppLanguage, calendar: Calendar)?
    private var shownDays: [String] = []

    /// The month's six weeks, or the week, around `page`.
    func days(mode: CalendarWindowView.Mode, page: String, language: AppLanguage) -> [String] {
        let calendar = Calendar.paper
        if let known = daysKey, known.mode == mode, known.page == page, known.language == language, known.calendar == calendar { return shownDays }
        switch mode {
        case .month:
            let p = CalendarMonth.parts(page)
            shownDays = CalendarMonth.monthGrid(year: p.year, month: p.month, calendar: calendar, language: language)
        case .week:
            shownDays = CalendarMonth.weekDays(page, calendar: calendar, language: language)
        }
        daysKey = (mode, page, language, calendar)
        return shownDays
    }

    func page(days: [String], selected: String, events: [LocalEvent], tasks: [TodoItem], now: Date, language: AppLanguage) -> CalendarMonth.Page {
        let calendar = Calendar.paper
        let key = Key(days: days, selected: selected, events: events, tasks: tasks, today: Archive.dayKey(now, calendar: calendar),
                      language: language, calendar: calendar)
        if let page, key == self.key { return page }
        let range = CalendarMonth.fetchRange(days, calendar: calendar)
        // As EventBook.occurrences.
        let occurrences = LocalEvent.expand(events, from: range.start, to: range.end, calendar: calendar, language: .current)
        let made = CalendarMonth.Page(days: days + [selected], events: occurrences, tasks: tasks, now: now, calendar: calendar, language: language)
        self.key = key
        page = made
        return made
    }
}

/// Audit 3 · 28 (D2), #260: how a month cell's title or holiday name sits on its line (the desk's 달력 and the calendar
/// widgets): whole, or cut where it could take a second line — between words, or in English and Dutch inside a long word
/// at a hyphenation point (`CalendarMonth.lineFit`). Korean: a title with no space, or whose first word is wider than the
/// line, stays on one line.
enum CellFit {
    static func of(_ text: String, font: NSFont, room: CGFloat, language: AppLanguage) -> CalendarMonth.LineFit {
        func width(_ text: String) -> CGFloat { (text as NSString).size(withAttributes: [.font: font]).width }
        guard width(text.keepingParticles) > room else { return .fit }
        let first = text.split(separator: " ").first.map(String.init) ?? text
        let piece = CalendarMonth.firstPiece(text, language: language)
        return CalendarMonth.lineFit(overflows: true, betweenWords: text.contains(" ") && width(first) <= room,
                                     inWord: piece.map { width($0 + "-") <= room } ?? false, language: language)
    }
}
