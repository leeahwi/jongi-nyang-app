import AppKit
import PaperCore
import SwiftUI

/// 하루 띠 (1.40): a region on the paper under the 오늘 sheet's header, ruled above and below — no card. The top line
/// has the all-day events and `하루 전체 ›`; under it a thin bar of the whole day (events in their colours, to-dos with
/// a time in sage, the past a shade darker, now a short clay mark) with its hours; then what's on now in large, with a
/// ring of the time left (or, with nothing on, the next thing and the time until it), and the next few as rows.
/// Clicking `하루 전체 ›`, the bar or the strip's empty space opens it in place into the day's timetable
/// (DayTimetable). Redrawn once a minute and when the data changes — nothing moves in between (the 1.39 pulse of the
/// now-line was the big idle cost; the mark is still now).
struct DayStripView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var calendar: EventBook
    /// The note's height: three rows in a tall note, and the open day's height.
    var noteHeight: CGFloat = 560
    /// A short note: no hours under the bar.
    var compact = false
    /// Snapshots: a fixed now.
    var now: Date?
    /// Snapshots: a block of the open day dragged, stretched or under the pointer (1.41).
    var timetablePreview: TimetablePreview?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast
    /// The strip's width (the note's): narrow at 400 pt or less.
    @State private var width: CGFloat = 420
    /// A to-do being ticked from the strip: its box fills, then it's done and the strip moves on.
    @State private var ticking: String?
    /// The day was opened by a click here (its keys then work at once).
    @State private var openedHere = false

    private var narrow: Bool { width <= 400 }

    var body: some View {
        TimelineView(.everyMinute) { context in
            let now = self.now ?? context.date
            let events = calendar.showsStrip ? calendar.todayEvents(now: now) : []
            let today = model.todayItems
            let layout = DayRibbon.layout(events: events, reminders: DayRibbon.reminders(today, now: now),
                                          blocks: DayRibbon.blocks(today, now: now), now: now)
            if calendar.showsStrip && !layout.isEmpty {
                region(layout, items: DayStrip.items(events: events, tasks: today, now: now), now: now)
            } else {
                Color.clear.frame(height: 0)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }

    private func setOpen(_ open: Bool, now: Date) {
        openedHere = open
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.22)) { calendar.setDayOpen(open, now: now) }
    }

    private func region(_ layout: DayRibbon.Layout, items: [DayStrip.Item], now: Date) -> some View {
        let open = calendar.isDayOpen(now: now)
        let state = DayStrip.state(items, now: now, rows: DayStrip.rowLimit(width: Double(width), height: Double(noteHeight)))
        return VStack(alignment: .leading, spacing: 0) {
            if open {
                DayTimetable(model: model, calendar: calendar, layout: layout, items: items, now: now, noteHeight: noteHeight,
                             narrow: narrow, allDay: { allDayEvents(layout.allDay, limit: narrow ? 1 : 2) },
                             onClose: { setOpen(false, now: now) }, takesFocus: openedHere, preview: timetablePreview)
                    .transition(.opacity)
            } else {
                strip(layout, state: state, now: now)
                    .transition(.opacity)
            }
        }
        .padding(.top, 8)
        .padding(.bottom, 10)
        .overlay(alignment: .top) { rule }
        .overlay(alignment: .bottom) { rule }
        .padding(.horizontal, 16)
        .padding(.top, 6)
        .padding(.bottom, 2)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(open ? L("오늘 하루") : DayStrip.sentence(state, language: .current))
    }

    private var rule: some View {
        Rectangle().fill(contrast == .increased ? PaperTheme.ink3 : PaperTheme.rule).frame(height: 1)
    }

    // MARK: The strip

    private func strip(_ layout: DayRibbon.Layout, state: DayStrip.State, now: Date) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                allDayEvents(layout.allDay, limit: narrow ? 1 : 2)
                Spacer(minLength: 8)
                Button { setOpen(true, now: now) } label: {
                    Text(DayStrip.wholeDayLink(narrow: narrow, language: .current))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(PaperTheme.sageText)
                        .fixedSize()
                        .frame(minHeight: 18)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(L("하루 전체 보기"))
                .accessibilityLabel(L("하루 전체 보기"))
            }
            Button { setOpen(true, now: now) } label: {
                StripDayBar(layout: layout).frame(height: 12).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, 4)
            .help(L("하루 전체 보기"))
            .accessibilityLabel(L("하루 전체 보기"))
            if !compact { hourLabels(layout) }
            lead(state, now: now).padding(.top, 9)
            if !state.rows.isEmpty {
                VStack(alignment: .leading, spacing: 1) {
                    ForEach(state.rows, id: \.id) { row($0, now: now) }
                }
                .padding(.leading, 64)
                .padding(.top, 6)
            }
        }
        // The strip's empty space opens the whole day too.
        .contentShape(Rectangle())
        .onTapGesture { setOpen(true, now: now) }
    }

    /// Dot + `종일 · 엄마 생신`, at most `limit` (two, or one when they don't fit whole), then `+N`.
    @ViewBuilder
    func allDayEvents(_ events: [CalendarEvent], limit: Int) -> some View {
        if !events.isEmpty {
            ViewThatFits(in: .horizontal) {
                if limit >= 2 && events.count >= 2 { allDayPills(events, shown: 2).fixedSize() }
                allDayPills(events, shown: 1).fixedSize()
                allDayPills(events, shown: 1)
            }
        }
    }

    private func allDayPills(_ events: [CalendarEvent], shown: Int) -> some View {
        HStack(spacing: 10) {
            ForEach(events.prefix(shown), id: \.key) { event in
                Button { calendar.sheet = .edit(event, in: calendar) } label: {
                    HStack(spacing: 5) {
                        Circle().fill(PaperTheme.event(event.color, fallback: PaperTheme.sage)).frame(width: 6, height: 6)
                        Text(CalendarDay.allDayText(.current) + " · " + event.title).lineLimit(1)
                    }
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(PaperTheme.ink2)
                    .frame(minHeight: 18)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(TodayEventsStrip.tooltip(event))
            }
            if events.count > shown {
                Text("+\(events.count - shown)")
                    .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                    .foregroundStyle(PaperTheme.ink3)
                    .fixedSize()
                    .help(events.dropFirst(shown).map(\.title).joined(separator: "\n"))
            }
        }
    }

    private func hourLabels(_ layout: DayRibbon.Layout) -> some View {
        GeometryReader { geometry in
            let span = CGFloat(layout.endHour - layout.startHour)
            ZStack(alignment: .topLeading) {
                ForEach(Array(layout.labels.enumerated()), id: \.offset) { index, hour in
                    let x = geometry.size.width * CGFloat(hour - layout.startHour) / span
                    // The first label starts at its hour, the last ends at it, the others centre on it.
                    let anchor: CGFloat = index == 0 ? 0 : index == layout.labels.count - 1 ? 1 : 0.5
                    Text(DayRibbon.hourLabel(hour, language: .current))
                        .font(.system(size: 9, weight: .medium).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink3)
                        .fixedSize()
                        .alignmentGuide(.leading) { d in -(x - d.width * anchor) }
                }
            }
            .frame(width: geometry.size.width, alignment: .leading)
        }
        .frame(height: 12)
        .accessibilityHidden(true)
    }

    // MARK: Now (or next)

    @ViewBuilder
    private func lead(_ state: DayStrip.State, now: Date) -> some View {
        if let item = state.lead {
            HStack(alignment: .center, spacing: 12) {
                ring(state, item: item, now: now)
                VStack(alignment: .leading, spacing: 0) {
                    ViewThatFits(in: .horizontal) {
                        kicker(DayStrip.kicker(mode: state.mode, item: item, language: .current))
                        kicker(DayStrip.kicker(mode: state.mode, item: item, language: .current, short: true))
                    }
                    HStack(spacing: 7) {
                        if state.mode == .now, item.kind == .task, let id = item.taskID { checkbox(id) }
                        Text(item.title.handwritten)
                            .font(model.notebookFont.font(points: 27))
                            .foregroundStyle(PaperTheme.ink)
                            .lineLimit(1)
                            .truncationMode(.tail)
                            .padding(.trailing, 3)
                            .contentShape(Rectangle())
                            .onTapGesture { open(item) }
                            .help(tooltip(item))
                            .accessibilityLabel(item.title)
                            .accessibilityAddTraits(.isButton)
                            .accessibilityAction { open(item) }
                    }
                    subLine(item, mode: state.mode, now: now)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .contextMenu { menu(item) }
        } else {
            // Nothing more today: one quiet line (the bar above still shows the day, all past).
            Text(DayRibbon.nothingAhead(.current))
                .font(.system(size: 12.5))
                .foregroundStyle(PaperTheme.ink3)
                .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
        }
    }

    private func kicker(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
            .tracking(0.4)
            .foregroundStyle(PaperTheme.sageText)
            .lineLimit(1)
            .fixedSize()
    }

    /// The ring: going on → the time left, sage on its sage track; up next → the time until it, clay within the hour
    /// (the arc fills over that hour), else ink2 on the rule.
    private func ring(_ state: DayStrip.State, item: DayStrip.Item, now: Date) -> some View {
        let text = DayStrip.ringText(minutes: state.minutes, mode: state.mode, language: .current)
        let soon = state.mode == .next && DayStrip.isSoon(state.minutes)
        let focusable = state.mode == .now && item.kind == .task
        let said = state.mode == .now ? DayStrip.leftText(state.minutes, language: .current) : DayStrip.awayText(state.minutes, language: .current)
        return Button {
            if focusable, let id = item.taskID.flatMap(UUID.init(uuidString:)) { startFocus(id, now: now) } else { open(item) }
        } label: {
            StripRing(progress: state.progress,
                      arc: state.mode == .now ? PaperTheme.sage : PaperTheme.clay,
                      track: state.mode == .now ? PaperTheme.sage2 : soon ? PaperTheme.clay2 : PaperTheme.rule,
                      value: text.value, caption: text.caption,
                      valueColor: state.mode == .now ? PaperTheme.ink : soon ? PaperTheme.clayText : PaperTheme.ink2,
                      captionColor: soon ? PaperTheme.clayText : PaperTheme.ink3)
        }
        .buttonStyle(.plain)
        .help(focusable ? L("눌러서 집중 시작") : tooltip(item))
        .accessibilityLabel(item.title + ", " + said)
        .accessibilityHint(focusable ? L("눌러서 집중 시작") : "")
    }

    @ViewBuilder
    private func subLine(_ item: DayStrip.Item, mode: DayStrip.Mode, now: Date) -> some View {
        let focusing = model.timerState.isFocusing && model.timerState.session?.taskId == item.taskID && item.taskID != nil
        if item.kind == .event {
            if let place = item.event?.location, !place.isEmpty { subText(Text(place), bell: false) }
        } else if focusing, let timer = model.timerState.timer {
            subText(Text(L("집중 중") + " " + FocusTimer.clock(timer.remaining(at: now))), bell: false)
        } else {
            subText(Text(String(localized: "할 일", table: "Day")), bell: item.hasReminder)
        }
    }

    private func subText(_ text: Text, bell: Bool) -> some View {
        HStack(spacing: 4) {
            text.lineLimit(1)
            if bell { Image(systemName: "bell").font(.system(size: 9, weight: .medium)).accessibilityLabel(L("알림")) }
        }
        .font(.system(size: 11, weight: .medium).monospacedDigit())
        .foregroundStyle(PaperTheme.ink3)
        .padding(.top, 1)
    }

    /// The current to-do's box: ticked, it fills, and a moment later the to-do is done (the strip moves on).
    private func checkbox(_ id: String) -> some View {
        let ticked = ticking == id
        return Button {
            guard ticking == nil, let uuid = UUID(uuidString: id) else { return }
            withAnimation(reduceMotion ? nil : .spring(duration: 0.25, bounce: 0.4)) { ticking = id }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(reduceMotion ? 0 : 450))
                model.toggle(uuid)
                ticking = nil
            }
        } label: {
            ZStack {
                RoundedRectangle(cornerRadius: 4, style: .continuous).fill(ticked ? PaperTheme.sage : Color.clear)
                RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(ticked ? PaperTheme.sage : PaperTheme.checkBorder, lineWidth: 1.5)
                if ticked {
                    Image(systemName: "checkmark").font(.system(size: 9, weight: .heavy)).foregroundStyle(PaperTheme.onSage)
                        .transition(.scale(scale: 0.3).combined(with: .opacity))
                }
            }
            .frame(width: 15, height: 15)
            .scaleEffect(ticked ? 1.12 : 1)
            .frame(width: 20, height: 22)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(L("완료 표시"))
        .accessibilityLabel(L("완료 표시"))
    }

    // MARK: Next rows

    private func row(_ item: DayStrip.Item, now: Date) -> some View {
        let minutes = DayStrip.minutes(from: now, to: item.start)
        let soon = DayStrip.isSoon(minutes)
        let clock = DayStrip.clockText(item.start, language: .current)
        let away = DayStrip.awayText(minutes, language: .current)
        return Button { open(item) } label: {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(clock)
                    .font(.system(size: 11, weight: .semibold).monospacedDigit())
                    .foregroundStyle(PaperTheme.ink2)
                    .lineLimit(1)
                    .frame(width: Self.timeWidth, alignment: .leading)
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    StripMark(item: item)
                        .alignmentGuide(.firstTextBaseline) { d in d[.bottom] + 1 }
                    if item.kind == .event {
                        Text(item.title).font(.system(size: 12.5)).lineLimit(1)
                    } else {
                        Text(item.title.handwritten).font(model.notebookFont.font(points: 19)).lineLimit(1).padding(.trailing, 2)
                    }
                    if let id = item.taskID ?? item.event?.eventId, model.isAIMarked(id) {
                        AIStamp().alignmentGuide(.firstTextBaseline) { d in d[.bottom] - 2 }
                    }
                }
                .foregroundStyle(PaperTheme.ink)
                Spacer(minLength: 6)
                Text(away)
                    .font(.system(size: 10.5, weight: soon ? .semibold : .medium).monospacedDigit())
                    .foregroundStyle(soon ? PaperTheme.clayText : PaperTheme.ink3)
                    .lineLimit(1)
                    .fixedSize()
            }
            .frame(minHeight: 22)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(tooltip(item))
        .contextMenu { menu(item) }
        .accessibilityLabel(clock + " " + item.title + ", " + away)
    }

    /// The rows' time column: "14:00" fits 40 pt; English "10:30 AM" needs more.
    static var timeWidth: CGFloat { AppLanguage.current == .en ? 52 : 40 }

    // MARK: Actions

    private func open(_ item: DayStrip.Item) {
        if let event = item.event {
            calendar.sheet = .edit(event, in: calendar)
        } else if let id = item.taskID.flatMap(UUID.init(uuidString:)) {
            model.selectedTaskID = id
        }
    }

    private func startFocus(_ id: UUID, now: Date) {
        guard let task = model.items.first(where: { $0.id == id }) else { return }
        model.focus(on: id, minutes: TimeBlock.focusMinutes(task, now: now))
    }

    private func tooltip(_ item: DayStrip.Item) -> String {
        if let event = item.event { return TodayEventsStrip.tooltip(event) }
        guard let end = item.end else { return item.title + " · " + DayStrip.clockText(item.start, language: .current) }
        return item.title + " · " + DayStrip.rangeText(item.start, end, language: .current)
    }

    @ViewBuilder
    private func menu(_ item: DayStrip.Item) -> some View {
        if let event = item.event {
            TodayEventsStrip.menu(event, calendar: calendar, onAddTask: { model.add($0, literal: true) }) { calendar.sheet = $0 }
        } else if let id = item.taskID.flatMap(UUID.init(uuidString:)) {
            Button(item.done ? L("완료 취소") : L("완료 표시")) { model.toggle(id) }
            if !item.done { Button(L("이거 집중")) { startFocus(id, now: Date()) } }
            if item.kind == .task { Button(L("시간 지우기")) { model.setTimeRange(id, to: nil) } }
        }
    }
}

/// The thin bar of the whole day: paper2, the past a shade darker, events in their colours (faded once over), to-dos
/// with a time in sage at half strength; now is a short clay mark across it (12 pt, still).
struct StripDayBar: View {
    let layout: DayRibbon.Layout

    var body: some View {
        GeometryReader { geometry in
            let width = geometry.size.width
            ZStack(alignment: .topLeading) {
                ZStack(alignment: .topLeading) {
                    Rectangle().fill(PaperTheme.paper2)
                    if let x = layout.now {
                        Rectangle().fill(PaperTheme.ink.opacity(0.06)).frame(width: width * x)
                    }
                    ForEach(Array(layout.bars.enumerated()), id: \.offset) { _, bar in
                        segment(from: bar.from, to: bar.to, width: width)
                            .fill(PaperTheme.event(bar.event.color, fallback: PaperTheme.sage))
                            .opacity(bar.past ? 0.5 : 1)
                    }
                    ForEach(layout.blocks, id: \.id) { block in
                        segment(from: block.from, to: block.to, width: width)
                            .fill(PaperTheme.sage)
                            .opacity(block.done ? 0.25 : 0.5)
                    }
                }
                .frame(width: width, height: 6)
                .clipShape(Capsule())
                .offset(y: 3)
                if let x = layout.now {
                    RoundedRectangle(cornerRadius: 1)
                        .fill(PaperTheme.clay)
                        .frame(width: 2, height: 12)
                        .offset(x: min(max(0, width * x - 1), width - 2))
                }
            }
        }
        .accessibilityHidden(true)
    }

    private func segment(from: Double, to: Double, width: CGFloat) -> some Shape {
        let x = width * from
        let length = max(3, width * to - x)
        return RoundedRectangle(cornerRadius: 3).path(in: CGRect(x: min(x, width - length), y: 0, width: length, height: 6))
    }
}

/// The ring beside what's on: a 5 pt arc on its track around a paper centre, the number and its small word inside.
struct StripRing: View {
    /// 8.5 pt on one line when it fits the ring's opening (36 pt), else 7.5 pt, else two lines at 8 pt.
    static func captionFit(_ caption: String) -> (size: CGFloat, lines: Int) {
        func width(_ size: CGFloat) -> CGFloat {
            (caption as NSString).size(withAttributes: [.font: NSFont.systemFont(ofSize: size, weight: .medium)]).width
        }
        if width(8.5) <= 36 { return (8.5, 1) }
        if width(7.5) <= 36 { return (7.5, 1) }
        return (8, 2)
    }

    let progress: Double
    let arc: Color
    let track: Color
    let value: String
    let caption: String
    let valueColor: Color
    let captionColor: Color

    var body: some View {
        ZStack {
            Circle().fill(PaperTheme.paper)
            Circle().strokeBorder(track, lineWidth: 5)
            if progress > 0 {
                Circle()
                    .inset(by: 2.5)
                    .trim(from: 0, to: min(1, progress))
                    .stroke(arc, style: StrokeStyle(lineWidth: 5, lineCap: .butt))
                    .rotationEffect(.degrees(-90))
            }
            VStack(spacing: 1) {
                Text(value)
                    .font(.system(size: 13, weight: .semibold).monospacedDigit())
                    .foregroundStyle(valueColor)
                    .lineLimit(1)
                // Inside the ring's opening at its height (the chord there is about 38 pt): a long word gets a little
                // smaller, and the longest ("min te gaan") takes two short lines.
                let fit = Self.captionFit(caption)
                Text(caption)
                    .font(.system(size: fit.size, weight: .medium))
                    .foregroundStyle(captionColor)
                    .lineLimit(fit.lines)
                    .multilineTextAlignment(.center)
                    .lineSpacing(-1)
                    .frame(width: fit.lines == 1 ? 37 : 30)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(width: 40)
            .offset(y: 0.5)
        }
        .frame(width: 52, height: 52)
        .contentShape(Circle())
    }
}

/// A row's kind: an event's dot in its colour, a to-do's sage square, a reminder's ink3 ring.
struct StripMark: View {
    let item: DayStrip.Item

    var body: some View {
        Group {
            switch item.kind {
            case .event:
                Circle().fill(PaperTheme.event(item.event?.color ?? "", fallback: PaperTheme.sage))
            case .task:
                RoundedRectangle(cornerRadius: 2).strokeBorder(PaperTheme.sage, lineWidth: 1.5)
            case .reminder:
                Circle().strokeBorder(PaperTheme.ink3, lineWidth: 1.5)
            }
        }
        .frame(width: 7, height: 7)
        .accessibilityHidden(true)
    }
}
