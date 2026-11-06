import AppKit
import PaperCore
import SwiftUI

// 바탕화면 달력 위젯 (#234): one widget as it is drawn — the ears, the paper (only the paper fades; on the Mac the
// wallpaper behind it is frosted first), and one of the kinds. Each day is a frosted paper tile that never fades below its
// paper's floor (ink keeps 4.5:1 on it over any wallpaper); weekends and holidays are tinted with the paper's clay2; text
// off the tiles gets a backing at the floor once the paper is fainter. Below 100 % the text is ink and the marks keep a
// ring of paper (docs/plans/calendar-widget.md 4장 · 4-6; the rules are CalendarWidget's).

/// How the widget is drawn at its opacity now.
struct WidgetLook {
    let drawn: Int
    let backing: Bool
    let inkOnly: Bool
    let bolder: Bool
    let halo: Bool
    let strongEdge: Bool
    /// The paper's floor and the weekend tint's (CalendarWidget.floor), and the tint itself.
    var floor = 60
    var tintFloor = 65
    var tint = Color.clear
    var showsLunar = true
    var showsHolidays = true

    init(drawn: Int, contrast: Bool, palette: WidgetPalette = .standard, floor: Int = 60, tintFloor: Int = 65, tint: Color = .clear) {
        self.drawn = drawn
        self.palette = palette
        self.floor = floor
        self.tintFloor = tintFloor
        self.tint = tint
        backing = CalendarWidget.backing(drawn, floor: floor)
        inkOnly = CalendarWidget.inkOnly(drawn)
        bolder = CalendarWidget.bolder(drawn)
        halo = CalendarWidget.halo(drawn)
        strongEdge = contrast
    }

    var palette = WidgetPalette.standard
    var paper: Double { Double(drawn) / 100 }
    var ink2: Color { inkOnly ? palette.ink : palette.ink2 }
    var ink3: Color { inkOnly ? palette.ink : palette.ink3 }
    var sageText: Color { inkOnly ? palette.ink : palette.sageText }
    var clayText: Color { inkOnly ? palette.ink : palette.clayText }
    /// The backing under text off the tiles: the paper's floor (대비 증가: 95 %).
    var backingPaper: Double { strongEdge ? 0.95 : Double(floor) / 100 }
    /// A day's tile: the paper as drawn, never fainter than its floor (the tinted ones their own).
    func tileOpacity(tinted: Bool) -> Double {
        let value = Double(CalendarWidget.tile(drawn, floor: tinted ? tintFloor : floor)) / 100
        return strongEdge ? max(value, 0.95) : value
    }
}

private struct BackingModifier: ViewModifier {
    let look: WidgetLook
    var radius: CGFloat = 6
    var on = true
    @Environment(\.widgetPalette) private var palette

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 3)
            .background {
                if on && look.backing {
                    RoundedRectangle(cornerRadius: radius, style: .continuous).fill(palette.paper.opacity(look.backingPaper))
                }
            }
    }
}

extension View {
    /// One backing per cell or line (not per word: on a busy wallpaper that read as confetti).
    func widgetBacking(_ look: WidgetLook, radius: CGFloat = 6, on: Bool = true) -> some View {
        modifier(BackingModifier(look: look, radius: radius, on: on))
    }
}

/// The paper: frosted wallpaper under it on the Mac (variant C, NSVisualEffectView behind the window), the paper at its
/// opacity, an edge that never fades below half and a hairline of paper outside it.
private struct WidgetPaper: View {
    let look: WidgetLook
    let frosted: Bool
    /// Snapshots: the wallpaper drawn blurred under the paper instead of the window server's.
    var previewBackdrop: AnyView?
    @Environment(\.colorScheme) private var scheme
    @Environment(\.widgetPalette) private var palette
    private let shape = RoundedRectangle(cornerRadius: 13, style: .continuous)

    var body: some View {
        let edge = CalendarWidget.edgeStrength(look.drawn)
        ZStack {
            if frosted {
                if let previewBackdrop {
                    previewBackdrop.blur(radius: 22).saturation(1.2).brightness(scheme == .dark ? -0.18 : 0.12).clipShape(shape)
                } else {
                    WidgetFrost().clipShape(shape)
                }
            }
            shape.fill(palette.paper.opacity(look.paper))
            shape.strokeBorder(palette.paper.opacity(0.35 * edge), lineWidth: 1.75)
            shape.strokeBorder(look.strongEdge ? palette.ink3 : palette.edge.opacity(edge), lineWidth: look.strongEdge ? 1 : 0.75)
        }
    }
}

/// The window server's frosted glass behind the paper (the wallpaper and, kept on top, the windows behind blurred).
/// 투명도 줄이기 makes it solid by itself.
private struct WidgetFrost: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .popover
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}

// MARK: - The widget

struct CalendarWidgetView: View {
    @ObservedObject var state: WidgetState
    @ObservedObject var feed: WidgetFeed
    @ObservedObject var widgets: CalendarWidgets
    var previewBackdrop: AnyView?
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.colorScheme) private var scheme
    @Environment(\.self) private var environment
    @State private var pages = WidgetPageCache()
    /// The paper drawn (#244): read here, in `body`, so a paper picked in 꾸미기 redraws the widget once; handed to the
    /// widget's parts through the environment.
    private var palette: WidgetPalette { .standard }
    @State private var backTask: Task<Void, Never>?

    var body: some View {
        let settings = state.settings
        let drawn = CalendarWidget.drawn(settings.opacity, reduceTransparency: widgets.reduceTransparency,
                                         hover: state.hovering, solidOnHover: settings.solidOnHover)
        let look = makeLook(drawn)
        let paper = CalendarWidget.size(settings.kind, settings.style)
        let earHeight = CalendarWidget.earHeight(settings.kind, settings.style)
        VStack(spacing: 0) {
            WidgetEars(kind: settings.kind, style: settings.style, opacity: Double(CalendarWidget.earOpacity(drawn)) / 100,
                       strongEdge: look.strongEdge, twitch: state.twitch)
                .frame(width: paper.width, height: earHeight)
                .zIndex(1)
            ZStack {
                WidgetPaper(look: look, frosted: settings.opacity < 100 && !widgets.reduceTransparency, previewBackdrop: previewBackdrop)
                content(look)
                    .padding(.top, 12)
                    .padding(.horizontal, 13)
                    .padding(.bottom, 11)
            }
            .frame(width: paper.width, height: paper.height)
            .opacity(state.removed ? 0 : 1)
            .overlay(alignment: .bottom) {
                if let toast = state.toast {
                    ToastView(toast: toast) { [id = settings.id] in widgets.toastDone(id) }
                        .padding(.horizontal, 10)
                        .padding(.bottom, 10)
                        .id(toast.id)
                }
            }
        }
        .frame(width: paper.width, height: paper.height + earHeight)
        .foregroundStyle(palette.ink)
        .environment(\.widgetPalette, palette)
        .environment(\.locale, AppLanguage.current.locale)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(CalendarWidget.name(settings.kind, settings.style, .current))
    }

    /// The look at this opacity, with the paper's floors worked out from the palette as drawn (a paper theme's too).
    private func makeLook(_ drawn: Int) -> WidgetLook {
        func rgb(_ color: Color) -> (Double, Double, Double) {
            let resolved = color.resolve(in: environment)
            return (Double(resolved.red), Double(resolved.green), Double(resolved.blue))
        }
        let paper = rgb(palette.paper), ink = rgb(palette.ink), dark = scheme == .dark
        let tint = CalendarWidget.weekendTint(clay2: rgb(palette.clay2), paper: paper)
        var look = WidgetLook(drawn: drawn, contrast: contrast == .increased, palette: palette,
                              floor: CalendarWidget.floor(paper: paper, ink: ink, dark: dark),
                              tintFloor: CalendarWidget.floor(paper: tint, ink: ink, dark: dark),
                              tint: Color(red: tint.0, green: tint.1, blue: tint.2))
        look.showsLunar = feed.showsLunar
        look.showsHolidays = feed.showsHolidays
        return look
    }

    // MARK: Pages

    private var language: AppLanguage { .current }
    private var today: String { CalendarWidget.today(feed.now) }

    private func page() -> CalendarMonth.Page {
        pages.page(days: CalendarWidget.pageDays(state.settings.kind, today: today, offset: state.offset, language: language),
                   events: feed.events, tasks: feed.tasks, now: feed.now, language: language)
    }

    @ViewBuilder
    private func content(_ look: WidgetLook) -> some View {
        let page = page()
        switch (state.settings.kind, state.settings.style) {
        case (.today, _): todayKind(page, look)
        case (.week, .simple): weekSimple(page, look)
        case (.week, .detail), (.week, .wall): weekDetail(page, look)
        case (.month, .simple): monthKind(page, look, detail: false)
        case (.month, .detail): monthKind(page, look, detail: true)
        case (.month, .wall): monthKind(page, look, detail: true, wall: true)
        case (.agenda, _): agendaKind(page, look)
        }
    }

    // MARK: Header and ‹ 오늘 ›

    private func header(_ title: String, _ look: WidgetLook, nav: Bool) -> some View {
        HStack(spacing: 6) {
            Text(title)
                .font(.system(size: 13.5, weight: look.bolder ? .heavy : .bold))
                .lineLimit(1)
                .widgetBacking(look)
            Spacer(minLength: 4)
            if nav && (state.hovering || state.offset != 0) {
                HStack(spacing: 2) {
                    navButton("chevron.left", label: state.settings.kind == .week ? L("이전 주") : L("이전 달")) { move(-1) }
                    Button { move(0) } label: {
                        Text(L("오늘"))
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundStyle(look.sageText)
                            .padding(.horizontal, 6)
                            .frame(height: 20)
                            .background(palette.sage2, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .frame(minWidth: CalendarWidget.target, minHeight: CalendarWidget.target)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    navButton("chevron.right", label: state.settings.kind == .week ? L("다음 주") : L("다음 달")) { move(1) }
                }
            }
        }
        .frame(height: 22)
        .padding(.bottom, 4)
    }

    private func navButton(_ symbol: String, label: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 10.5, weight: .semibold))
                .frame(width: 20, height: 20)
                .background(palette.paper2, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .frame(width: CalendarWidget.target, height: CalendarWidget.target)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(label)
        .accessibilityLabel(label)
    }

    /// ‹ › (0: back to now); untouched for 2 minutes, it comes back to now by itself.
    private func move(_ step: Int) {
        state.offset = step == 0 ? 0 : state.offset + step
        backTask?.cancel()
        guard state.offset != 0 else { return }
        backTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(CalendarWidget.backAfter))
            if !Task.isCancelled { state.offset = 0 }
        }
    }

    // MARK: Lines

    private func mark(_ line: CalendarWidget.Line, _ look: WidgetLook) -> some View {
        WidgetMark(kind: line.kind, color: color(line.color), halo: look.halo)
    }

    private func color(_ name: String) -> Color {
        switch name {
        case "clay": palette.clay
        case "sage": palette.sage
        default: PaperTheme.event(name)
        }
    }

    private func timeText(_ line: CalendarWidget.Line) -> String {
        line.time ?? (line.kind == .deadline ? L("마감") : CalendarDay.allDayText(language))
    }

    /// A line: its mark, its time, its title — a press opens it (the event on the desk's calendar, the to-do's row in
    /// the note; no ticking off here).
    private func lineView(_ line: CalendarWidget.Line, _ look: WidgetLook, day: String, height: CGFloat = 19, timeWidth: CGFloat = 34,
                          backed: Bool = true) -> some View {
        Button { open(line, day: day) } label: {
            HStack(spacing: 6) {
                mark(line, look)
                Text(timeText(line))
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(look.ink2)
                    .frame(minWidth: timeWidth, alignment: .leading)
                    .fixedSize()
                Text(line.title.keepingParticles)
                    .font(.system(size: 11.5))
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            .widgetBacking(look, on: backed)
            .frame(height: height, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(line.title)
    }

    /// An event opens on the desk's calendar to change or remove; a to-do shows its row in the note.
    private func open(_ line: CalendarWidget.Line, day: String) {
        if let task = line.taskId { widgets.reveal(task) } else { widgets.openCalendar(on: day, event: line.eventKey) }
    }

    private func more(_ count: Int, _ look: WidgetLook, day: String, backed: Bool = true) -> some View {
        Button { widgets.openDay(day, from: state.settings.id) } label: {
            Text("+\(count)")
                .font(.system(size: 10.5, weight: .bold).monospacedDigit())
                .foregroundStyle(look.ink2)
                .widgetBacking(look, on: backed)
                .frame(minWidth: CalendarWidget.target, minHeight: CalendarWidget.target)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(CalendarWidget.moreLabel(count, language))
        .accessibilityLabel(CalendarWidget.moreLabel(count, language))
    }

    private func empty(_ look: WidgetLook) -> some View {
        Text(CalendarWidget.emptyText(language))
            .font(.system(size: 11.5))
            .foregroundStyle(look.ink2)
            .widgetBacking(look)
            .frame(height: 19)
    }

    private func dayNumber(_ day: String, _ look: WidgetLook, size: CGFloat, weight: Font.Weight = .bold, box: CGFloat = 24,
                           sunday: Bool, dim: Bool = false) -> some View {
        let isToday = day == today
        let number = CalendarMonth.parts(day).day
        let red = sunday || holiday(day, look) != nil
        return Text("\(number)")
            .font(.system(size: size, weight: isToday || look.bolder ? .heavy : weight).monospacedDigit())
            .foregroundStyle(isToday ? palette.onSage : red ? look.clayText : palette.ink)
            .frame(width: box, height: box)
            .background {
                if isToday {
                    Circle().fill(palette.sage)
                    if look.halo { Circle().strokeBorder(palette.paper, lineWidth: 2).padding(-2) }
                }
            }
            .opacity(dim ? 0.42 : 1)
    }

    private func isSunday(_ day: String) -> Bool {
        Calendar.paper.component(.weekday, from: CalendarMonth.date(day)) == 1
    }

    private func isWeekend(_ day: String) -> Bool {
        let weekday = Calendar.paper.component(.weekday, from: CalendarMonth.date(day))
        return weekday == 1 || weekday == 7
    }

    private func holiday(_ day: String, _ look: WidgetLook) -> String? { look.showsHolidays ? DayMarks.holiday(day) : nil }
    private func lunar(_ day: String, _ look: WidgetLook) -> (label: String, spoken: String)? { look.showsLunar ? DayMarks.lunar(day) : nil }

    /// A day's frosted paper tile: the paper (weekends and holidays its clay2 tint) at the tile's opacity; today with a
    /// sage outline and, below 100 %, a ring of paper inside it.
    private func tile(_ day: String, _ look: WidgetLook, radius: CGFloat = 7) -> some View {
        let tinted = isWeekend(day) || holiday(day, look) != nil
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        return ZStack {
            shape.fill((tinted ? look.tint : palette.paper).opacity(look.tileOpacity(tinted: tinted)))
            if day == today {
                if CalendarWidget.todayRing(look.drawn) { shape.strokeBorder(palette.paper, lineWidth: 3) }
                shape.strokeBorder(palette.sage, lineWidth: 1.5)
            }
        }
    }

    /// The lunar date at a tile's top right (8.21 · 음 9.1), the spoken form as its tooltip.
    @ViewBuilder
    private func lunarText(_ day: String, _ look: WidgetLook, size: CGFloat = 9.5) -> some View {
        if let lunar = lunar(day, look) {
            Text(lunar.label)
                .font(.system(size: size).monospacedDigit())
                .foregroundStyle(look.ink3)
                .lineLimit(1)
                .fixedSize()
                .help(lunar.spoken)
                .accessibilityLabel(lunar.spoken)
        }
    }

    /// A holiday's name in the tile: clayText at 100 %, below that ink after a clay ⚑.
    @ViewBuilder
    /// `two` (#260): the name on two lines where the month's tile has a line to spare (`twoLineTitles`).
    private func holidayLine(_ day: String, _ look: WidgetLook, size: CGFloat = 10, two: Bool = false) -> some View {
        if let name = holiday(day, look) {
            HStack(alignment: two ? .top : .center, spacing: 3) {
                if look.inkOnly {
                    Image(systemName: "flag.fill").font(.system(size: size - 3)).foregroundStyle(palette.clay).padding(.top, two ? 3 : 0)
                }
                Text(two ? DayMarks.holidayShown(day) ?? name : name).font(.system(size: size, weight: .semibold))
                    .foregroundStyle(look.clayText).lineLimit(two ? 2 : 1).truncationMode(.tail)
                    .fixedSize(horizontal: false, vertical: two)
            }
            .frame(minHeight: size + 4, maxHeight: two ? nil : size + 4, alignment: .leading)
            .help(name)
        }
    }

    private func dots(_ day: String, page: CalendarMonth.Page, _ look: WidgetLook) -> some View {
        let found = CalendarWidget.dots(day, page: page)
        return HStack(spacing: 3) {
            ForEach(Array(found.colors.enumerated()), id: \.offset) { _, name in
                Circle().fill(color(name)).frame(width: 5, height: 5)
                    .overlay { if look.halo { Circle().strokeBorder(palette.paper, lineWidth: 1.5).padding(-1.5) } }
            }
            if found.plus {
                Text("+").font(.system(size: 8.5, weight: .bold)).foregroundStyle(look.ink2)
            }
        }
        .frame(height: 6)
    }

    // MARK: 오늘

    private func todayKind(_ page: CalendarMonth.Page, _ look: WidgetLook) -> some View {
        let up = CalendarWidget.upcoming(today, page: page, tasks: feed.tasks, now: feed.now, limit: 3, language: language)
        let p = CalendarMonth.parts(today)
        let weekday = Calendar.paper.component(.weekday, from: CalendarMonth.date(today)) - 1
        return ZStack(alignment: .bottomTrailing) {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .bottom, spacing: 7) {
                    Text("\(p.day)")
                        .font(.system(size: 38, weight: .bold).monospacedDigit())
                        .foregroundStyle(look.inkOnly ? palette.ink : palette.sage)
                        .widgetBacking(look)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(language.monthName(p.month))
                        Text(language.weekdayName(weekday))
                    }
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(look.ink2)
                    .widgetBacking(look)
                    .padding(.bottom, 3)
                }
                .frame(height: 40, alignment: .bottomLeading)
                .padding(.bottom, holiday(today, look) == nil ? 8 : 2)
                if holiday(today, look) != nil { holidayLine(today, look, size: 10.5).widgetBacking(look).padding(.bottom, 3) }
                if up.lines.isEmpty {
                    empty(look)
                } else {
                    ForEach(Array(up.lines.enumerated()), id: \.offset) { _, line in lineView(line, look, day: today) }
                }
                if up.more > 0 { more(up.more, look, day: today).padding(.leading, -3) }
                Spacer(minLength: 0)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            addButton(look, compact: true)
        }
    }

    /// 오늘 · 오늘 목록's +: today's sheet.
    private func addButton(_ look: WidgetLook, compact: Bool) -> some View {
        Button { widgets.openDay(today, from: state.settings.id) } label: {
            Group {
                if compact {
                    Image(systemName: "plus").font(.system(size: 13, weight: .semibold))
                        .frame(width: CalendarWidget.target, height: CalendarWidget.target)
                } else {
                    Text(L("+ 넣기")).font(.system(size: 11.5, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 26)
                }
            }
            .foregroundStyle(look.sageText)
            .background(palette.sage2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(L("+ 넣기"))
        .accessibilityLabel(L("+ 넣기"))
    }

    // MARK: 이번 주

    private var weekDays: [String] {
        CalendarMonth.weekDays(CalendarMonth.adding(7 * state.offset, to: today), language: language)
    }

    private func weekSimple(_ page: CalendarMonth.Page, _ look: WidgetLook) -> some View {
        let days = weekDays
        let up = CalendarWidget.upcoming(today, page: page, tasks: feed.tasks, now: feed.now, limit: 2, language: language)
        return VStack(alignment: .leading, spacing: 0) {
            header(CalendarMonth.weekTitle(days, language: language), look, nav: true)
            HStack(spacing: 3) {
                ForEach(days, id: \.self) { day in
                    Button { widgets.openDay(day, from: state.settings.id) } label: {
                        VStack(spacing: 3) {
                            Text(language.weekdayLetter(Calendar.paper.component(.weekday, from: CalendarMonth.date(day)) - 1))
                                .font(.system(size: 10.5))
                                .foregroundStyle(isSunday(day) || holiday(day, look) != nil ? look.clayText : look.ink2)
                            dayNumber(day, look, size: 14, sunday: isSunday(day))
                            dots(day, page: page, look)
                        }
                        .padding(.vertical, 4)
                        .frame(maxWidth: .infinity)
                        .background { tile(day, look) }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help(holiday(day, look) ?? "")
                    .accessibilityLabel(CalendarMonth.dayTitle(day, language: language) + (holiday(day, look).map { ", " + $0 } ?? ""))
                }
            }
            .padding(.bottom, 6)
            if up.lines.isEmpty {
                empty(look)
            } else {
                ForEach(Array(up.lines.enumerated()), id: \.offset) { _, line in lineView(line, look, day: today) }
            }
            Spacer(minLength: 0)
        }
    }

    private func weekDetail(_ page: CalendarMonth.Page, _ look: WidgetLook) -> some View {
        let days = weekDays
        return VStack(alignment: .leading, spacing: 2) {
            header(CalendarMonth.weekTitle(days, language: language), look, nav: true)
            ForEach(days, id: \.self) { day in
                let row = CalendarWidget.weekRow(day, page: page, language: language)
                let weekday = Calendar.paper.component(.weekday, from: CalendarMonth.date(day)) - 1
                let red = isSunday(day) || holiday(day, look) != nil
                HStack(spacing: 4) {
                    Button { widgets.openDay(day, from: state.settings.id) } label: {
                        HStack(spacing: 4) {
                            Text(language.weekdayShort(weekday))
                                .font(.system(size: 10.5))
                                .foregroundStyle(red ? look.clayText : look.ink2)
                                .frame(width: 27, alignment: .leading)
                            Text("\(CalendarMonth.parts(day).day)")
                                .font(.system(size: 12, weight: .heavy).monospacedDigit())
                                .foregroundStyle(day == today ? look.sageText : red ? look.clayText : palette.ink)
                                .frame(width: 20, alignment: .leading)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if holiday(day, look) != nil { holidayLine(day, look, size: 10).fixedSize() }
                    if let first = row.first {
                        lineView(first, look, day: day, height: 15, timeWidth: 30, backed: false)
                    }
                    Spacer(minLength: 0)
                    if row.more > 0 { more(row.more, look, day: day, backed: false).frame(height: 15) }
                    if holiday(day, look) == nil { lunarText(day, look) }
                }
                .padding(.horizontal, 4)
                .frame(height: 14.5)
                .background { tile(day, look, radius: 5) }
            }
            Spacer(minLength: 0)
        }
    }

    // MARK: 이번 달

    private func monthKind(_ page: CalendarMonth.Page, _ look: WidgetLook, detail: Bool, wall: Bool = false) -> some View {
        let shown = CalendarWidget.shifted(today, months: state.offset)
        let days = CalendarMonth.monthGrid(year: shown.year, month: shown.month, language: language)
        let weekdays = CalendarMonth.weekdayLabels(language)
        let rows = 6, gap: CGFloat = 3
        return VStack(spacing: 0) {
            header(CalendarMonth.monthTitle(year: shown.year, month: shown.month, language: language), look, nav: true)
            HStack(spacing: gap) {
                ForEach(Array(weekdays.enumerated()), id: \.offset) { index, label in
                    Text(label)
                        .font(.system(size: wall ? 11 : 10, weight: .medium))
                        .foregroundStyle(language.weekdayOrder[index] == 0 ? look.clayText : look.ink2)
                        .widgetBacking(look)
                        .frame(maxWidth: .infinity)
                }
            }
            .frame(height: wall ? 18 : 16)
            .padding(.bottom, 2)
            GeometryReader { geometry in
                let height = (geometry.size.height - gap * CGFloat(rows - 1)) / CGFloat(rows)
                let tileWidth = (geometry.size.width - gap * 6) / 7
                VStack(spacing: gap) {
                    ForEach(0..<rows, id: \.self) { row in
                        let week = Array(days[(row * 7)..<(row * 7 + 7)])
                        // calendar-flows D1: a multi-day event's band joins along the row (a holiday's name holds the
                        // first place).
                        let cells = detail ? week.map { day in
                            (day, holiday(day, look), page.cell(day, limit: max(1, CalendarWidget.lines(wall ? .wall : .detail) - (holiday(day, look) == nil ? 0 : 1))))
                        } : []
                        let bands = detail ? CalendarMonth.bands(cells.map { day, holiday, cell in
                            (holiday == nil ? [] : [nil]) + cell.items.map { item in
                                if case .event(let event) = item { return CalendarMonth.bandKey(event, on: day) } else { return nil }
                            }
                        }) : []
                        HStack(spacing: gap) {
                            ForEach(0..<7, id: \.self) { column in
                                let day = week[column]
                                let other = CalendarMonth.parts(day).month != shown.month
                                Group {
                                    if detail {
                                        detailCell(day, page: page, look, other: other, wall: wall,
                                                   bands: Array(bands[column].dropFirst(cells[column].1 == nil ? 0 : 1)), tileWidth: tileWidth, gap: gap)
                                    } else {
                                        simpleCell(day, page: page, look, other: other)
                                    }
                                }
                                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
                                .background { tile(day, look).opacity(other ? 0.6 : 1) }
                                // A title running over the next days is drawn above their tiles.
                                .zIndex(Double(7 - column))
                            }
                        }
                        .frame(height: height)
                    }
                }
            }
        }
    }

    private func simpleCell(_ day: String, page: CalendarMonth.Page, _ look: WidgetLook, other: Bool) -> some View {
        Button { widgets.openDay(day, from: state.settings.id) } label: {
            VStack(spacing: 3) {
                dayNumber(day, look, size: 12.5, box: 21, sunday: isSunday(day), dim: other)
                dots(day, page: page, look).opacity(other ? 0.5 : 1)
            }
            .padding(.top, 3)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(holiday(day, look) ?? "")
        .accessibilityLabel(CalendarMonth.dayTitle(day, language: language) + (holiday(day, look).map { ", " + $0 } ?? ""))
    }

    private func detailCell(_ day: String, page: CalendarMonth.Page, _ look: WidgetLook, other: Bool, wall: Bool, bands: [CalendarMonth.Band],
                            tileWidth: CGFloat, gap: CGFloat) -> some View {
        let style: CalendarWidget.Style = wall ? .wall : .detail
        let room = max(1, CalendarWidget.lines(style) - (holiday(day, look) == nil ? 0 : 1))
        let shownCell = page.cell(day, limit: room)
        let cell = (lines: shownCell.items.map { CalendarWidget.line($0, language: language) }, more: shownCell.more)
        let size: CGFloat = wall ? 12 : 10.5
        func band(_ index: Int) -> CalendarMonth.Band { bands.indices.contains(index) ? bands[index] : .init(run: 1, fromLeft: false, toRight: false) }
        // Audit 3 · 28 (D2), #260: the tile's spare lines go to cut titles — the holiday's name first — 벽 달력 and 자세히
        // alike (Korean between words only; English and Dutch also inside a word, by its hyphenation).
        let font = NSFont.systemFont(ofSize: size)
        let textRoom = tileWidth - 8 - 13 - 1
        let holidaySize: CGFloat = wall ? 11 : 10
        let holidayFit = holiday(day, look).map { _ in
            CellFit.of(DayMarks.holidayShown(day) ?? "", font: .systemFont(ofSize: holidaySize, weight: .semibold), room: tileWidth - 8 - (look.inkOnly ? holidaySize : 0) - 1, language: language)
        }
        let twos = CalendarMonth.twoLineTitles(room: CalendarWidget.lines(style), holiday: holidayFit, lines: cell.lines.indices.map { index in
            band(index).joined ? .band : CellFit.of(cell.lines[index].title, font: font, room: textRoom, language: language)
        })
        let two = twos.lines
        return ZStack(alignment: .topLeading) {
            // The cell's empty room opens the day's sheet.
            Button { widgets.openDay(day, from: state.settings.id) } label: { Color.clear.contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .accessibilityLabel(CalendarMonth.dayTitle(day, language: language) + (holiday(day, look).map { ", " + $0 } ?? ""))
            VStack(alignment: .leading, spacing: wall ? 2 : 1) {
                HStack(spacing: 2) {
                    dayNumber(day, look, size: wall ? 14 : 12, box: wall ? 22 : 19, sunday: isSunday(day), dim: other)
                        .allowsHitTesting(false)
                    if cell.more > 0 { more(cell.more, look, day: day, backed: false).frame(height: 19) }
                    Spacer(minLength: 0)
                    if CalendarWidget.showsLunar(lunarDay: KoreanCalendar.lunar(day)?.day ?? 0, cellWidth: tileWidth, moreInHead: cell.more > 0) {
                        lunarText(day, look, size: wall ? 10.5 : 9.5).opacity(other ? 0.6 : 1)
                    }
                }
                holidayLine(day, look, size: holidaySize, two: twos.holiday).opacity(other ? 0.6 : 1)
                ForEach(Array(cell.lines.enumerated()), id: \.offset) { index, line in
                    let wrap = two.indices.contains(index) && two[index]
                    let joined = band(index)
                    let tinted = line.allDay || (shownCell.items.indices.contains(index) && {
                        if case .event(let event) = shownCell.items[index] { return CalendarMonth.bandKey(event, on: day) != nil } else { return false }
                    }())
                    Button { open(line, day: day) } label: {
                        HStack(alignment: wrap ? .top : .center, spacing: 3) {
                            // calendar-flows D1: no mark of its own where the band goes on from the day before.
                            mark(line, look).padding(.top, wrap ? 2 : 0).opacity(joined.fromLeft ? 0 : 1)
                            Text(wrap ? CalendarMonth.hyphenated(line.title.keepingParticles, language: language) : line.title.keepingParticles)
                                .font(.system(size: size))
                                .lineLimit(wrap ? 2 : 1)
                                .truncationMode(.tail)
                                .fixedSize(horizontal: false, vertical: wrap)
                                .opacity(joined.run == 1 ? 1 : 0)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .frame(minHeight: wall ? 17 : 15)
                        .overlay(alignment: .leading) {
                            if joined.run > 1 {
                                // The title over the days the band runs on (their clicks go to them).
                                Text(line.title.keepingParticles).font(.system(size: size)).lineLimit(1)
                                    .frame(width: max(0, CGFloat(joined.run) * (tileWidth + gap) - gap - 8 - 13 - 2), alignment: .leading)
                                    .padding(.leading, 13)
                                    .allowsHitTesting(false)
                            }
                        }
                        .background {
                            if tinted {
                                UnevenRoundedRectangle(cornerRadii: .init(topLeading: joined.fromLeft ? 0 : 3, bottomLeading: joined.fromLeft ? 0 : 3,
                                                                          bottomTrailing: joined.toRight ? 0 : 3, topTrailing: joined.toRight ? 0 : 3))
                                    .fill(color(line.color).opacity(0.16))
                                    .padding(.leading, joined.fromLeft ? -4 : -2)
                                    .padding(.trailing, joined.toRight ? -4 : 0)
                            }
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help(line.time.map { "\($0) · \(line.title)" } ?? line.title)
                    .opacity(other ? 0.55 : 1)
                }
            }
            .padding(.top, 3)
            .padding(.horizontal, 4)
        }
    }

    // MARK: 오늘 목록

    /// ‘오늘’, ‘내일 · 토요일’, and the holiday after it: ‘오늘 · 한글날’.
    private func agendaHeading(index: Int, day: String, weekday: Int, _ look: WidgetLook) -> String {
        let word = language.dayWord(index == 0 ? 0 : 1) ?? ""
        let head = index == 0 ? word : word + " · " + language.weekdayName(weekday)
        guard let name = holiday(day, look) else { return head }
        return head + " · " + name
    }

    private func agendaKind(_ page: CalendarMonth.Page, _ look: WidgetLook) -> some View {
        let days = CalendarWidget.agenda(today, page: page, tasks: feed.tasks, now: feed.now, language: language)
        // Room for 12 lines with the two day headings; the rest of a day is on its sheet (+N).
        var room = 12
        let shown: [(day: String, lines: [CalendarWidget.Line], more: Int)] = days.map { entry in
            let take = max(0, min(entry.lines.count, room))
            room -= max(1, take)
            return (entry.day, Array(entry.lines.prefix(take)), entry.lines.count - take)
        }
        return VStack(alignment: .leading, spacing: 0) {
            header(CalendarMonth.dayTitle(today, language: language), look, nav: false)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(shown.enumerated()), id: \.offset) { index, entry in
                    let weekday = Calendar.paper.component(.weekday, from: CalendarMonth.date(entry.day)) - 1
                    HStack(spacing: 4) {
                        Text(agendaHeading(index: index, day: entry.day, weekday: weekday, look))
                            .font(.system(size: 10.5, weight: .bold))
                            .foregroundStyle(holiday(entry.day, look) == nil ? look.ink2 : look.clayText)
                            .lineLimit(1)
                            .widgetBacking(look)
                        if entry.more > 0 { more(entry.more, look, day: entry.day).frame(height: 18) }
                    }
                    .frame(height: 18)
                    .padding(.top, index == 0 ? 0 : 6)
                    if entry.lines.isEmpty {
                        Text(index == 0 ? CalendarWidget.emptyText(language) : L("아직 아무것도 없어요"))
                            .font(.system(size: 11.5))
                            .foregroundStyle(look.ink2)
                            .widgetBacking(look)
                            .frame(height: 21)
                    }
                    ForEach(Array(entry.lines.enumerated()), id: \.offset) { _, line in lineView(line, look, day: entry.day, height: 21) }
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .clipped()
            addButton(look, compact: false)
                .padding(.top, 6)
        }
    }
}

/// A line's mark: an event's colour bar, a reminder's bell, a deadline's flag, a time range's outlined bar — never faded,
/// with a ring of paper below 100 %.
struct WidgetMark: View {
    let kind: CalendarWidget.Line.Kind
    let color: Color
    let halo: Bool
    @Environment(\.widgetPalette) private var palette

    var body: some View {
        Group {
            switch kind {
            case .event:
                RoundedRectangle(cornerRadius: 1.5).fill(color).frame(width: 3, height: 11)
                    .overlay { if halo { RoundedRectangle(cornerRadius: 2.5).strokeBorder(palette.paper, lineWidth: 1.5).padding(-1.5) } }
            case .range:
                RoundedRectangle(cornerRadius: 1.5).strokeBorder(color, lineWidth: 1.2).frame(width: 4, height: 11)
            case .reminder, .deadline:
                Image(systemName: kind == .reminder ? "bell.fill" : "flag.fill")
                    .font(.system(size: 8.5, weight: .semibold))
                    .foregroundStyle(color)
                    .shadow(color: halo ? palette.paper : .clear, radius: 0.8)
            }
        }
        .frame(width: 10)
        .accessibilityHidden(true)
    }
}

/// The ears: the note's ears (CatEars, NoteEar) at the widget's scale, at least 85 % (the paper may fade more), one
/// twitch after something is put in.
struct WidgetEars: View {
    let kind: CalendarWidget.Kind
    let style: CalendarWidget.Style
    let opacity: Double
    let strongEdge: Bool
    let twitch: Int
    @Environment(\.widgetPalette) private var palette

    var body: some View {
        let scale = CalendarWidget.earScale(kind, style)
        let width = CalendarWidget.size(kind, style).width / scale
        let edge = CatEars.height
        ZStack(alignment: .topLeading) {
            ForEach(0..<CatEars.bases.count, id: \.self) { index in
                let base = CatEars.base(index, width: width, right: true)
                let flick: CGFloat = index == 0 ? -4 : 4
                NoteEar(a: base.a, b: base.b, edge: edge, strongEdge: strongEdge, fill: opacity,
                        colors: (palette.earPaper, palette.earInner, palette.earEdge))
                    .keyframeAnimator(initialValue: CGFloat(0), trigger: index == 1 ? twitch : 0) { content, tip in
                        content.modifier(EarFlick(tip: tip, edge: edge))
                    } keyframes: { _ in
                        KeyframeTrack {
                            CubicKeyframe(flick, duration: 0.11)
                            CubicKeyframe(-flick / 3, duration: 0.14)
                            CubicKeyframe(0, duration: 0.15)
                        }
                    }
            }
        }
        .frame(width: width, height: edge, alignment: .topLeading)
        .scaleEffect(scale, anchor: .topLeading)
        .frame(width: width * scale, height: edge * scale, alignment: .topLeading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L("위젯 메뉴"))
        .accessibilityAddTraits(.isButton)
        .help(L("위젯 메뉴"))
    }
}

/// A widget's page worked out once per change of what it shows (not on a hover).
final class WidgetPageCache {
    private struct Key: Equatable {
        var days: [String]
        var events: [LocalEvent]
        var tasks: [TodoItem]
        var now: Date
        var language: AppLanguage
    }
    private var key: Key?
    private var page: CalendarMonth.Page?

    func page(days: [String], events: [LocalEvent], tasks: [TodoItem], now: Date, language: AppLanguage) -> CalendarMonth.Page {
        let key = Key(days: days, events: events, tasks: tasks, now: now, language: language)
        if let page, key == self.key { return page }
        let range = CalendarMonth.fetchRange(days)
        let occurrences = LocalEvent.expand(events, from: range.start, to: range.end, calendar: .paper, language: .current)
        let made = CalendarMonth.Page(days: days, events: occurrences, tasks: tasks, now: now, language: language)
        self.key = key
        page = made
        return made
    }
}

/// Every colour of a widget as one set — the paper, the inks, the rules, the sage and clay marks, the edge and the ears.
/// #244: the paper the note and the calendar draw (PaperTheme's tokens, NoteEarsColors): `standard` is read anew each time,
/// so the widget follows the paper picked, and its tiles' floors are worked out from it (CalendarWidget.floor).
struct WidgetPalette {
    var paper: Color
    var paper2: Color
    var ink: Color
    var ink2: Color
    var ink3: Color
    var sage: Color
    var sage2: Color
    var sageText: Color
    var onSage: Color
    var clay: Color
    var clay2: Color
    var clayText: Color
    var rule: Color
    /// The edge line at full strength (CalendarWidget.edgeStrength scales it).
    var edge: Color
    var earPaper: Color
    var earInner: Color
    var earEdge: Color

    static var standard: WidgetPalette { WidgetPalette(
        paper: PaperTheme.paper, paper2: PaperTheme.paper2, ink: PaperTheme.ink, ink2: PaperTheme.ink2, ink3: PaperTheme.ink3,
        sage: PaperTheme.sage, sage2: PaperTheme.sage2, sageText: PaperTheme.sageText, onSage: PaperTheme.onSage,
        clay: PaperTheme.clay, clay2: PaperTheme.clay2, clayText: PaperTheme.clayText, rule: PaperTheme.rule,
        edge: Color(nsColor: NSColor(name: nil) { appearance in
            appearance.isNight ? NSColor(red: 236 / 255, green: 230 / 255, blue: 214 / 255, alpha: 0.24)
                : NSColor(red: 47 / 255, green: 46 / 255, blue: 42 / 255, alpha: 0.26)
        }),
        earPaper: NoteEarsColors.paper, earInner: NoteEarsColors.inner, earEdge: NoteEarsColors.edge) }
}

private struct WidgetPaletteKey: EnvironmentKey {
    static var defaultValue: WidgetPalette { .standard }
}

extension EnvironmentValues {
    var widgetPalette: WidgetPalette {
        get { self[WidgetPaletteKey.self] }
        set { self[WidgetPaletteKey.self] = newValue }
    }
}
