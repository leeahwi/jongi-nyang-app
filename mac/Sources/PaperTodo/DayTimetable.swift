import AppKit
import PaperCore
import SwiftUI

/// 하루 일정표 (1.40): the 하루 띠 opened in place — today on an hour grid (50 pt an hour, the hours in a 36 pt column),
/// scrolled so an hour before now is at the top, at most 55% of the note high (at least 260 pt). Events are tinted
/// blocks with their colour bar, to-dos with a time are card blocks with a sage outline (clay once over and not done;
/// faded and struck through when done), reminders are small pills at their time; overlapping ones stand side by side
/// (three columns, then "+N"). Now is a clay line with a dot.
///
/// Drag a to-do or a (one-off) event to move it, or a to-do's bottom handle to change its end, a quarter hour at a time
/// (a toast takes it back). A click on empty space asks `무엇을 할까요?` for a to-do or an event at that time; a
/// double click opens a new event there. Keys: ↑ ↓ pick a block, Return opens it, Space ticks a to-do, ⌥↑ ⌥↓ move
/// a to-do by 15 minutes, Esc folds the day back into the strip.
struct DayTimetable<AllDay: View>: View {
    @ObservedObject var model: AppModel
    @ObservedObject var calendar: EventBook
    let layout: DayRibbon.Layout
    let items: [DayStrip.Item]
    let now: Date
    let noteHeight: CGFloat
    let narrow: Bool
    @ViewBuilder var allDay: () -> AllDay
    var onClose: () -> Void
    /// Opened by a click (not by the note coming back with the day open): the keys go to it.
    var takesFocus = false
    /// Snapshots: a block picked.
    var previewSelected: String?
    @State private var selected: String?
    @State private var drag: Drag?
    @State private var newSlot: Slot?
    @State private var moreShown: Slot?
    @Environment(\.colorScheme) private var scheme

    struct Drag: Equatable { var id: String; var start: Int; var end: Int }
    struct Slot: Identifiable, Equatable { var minutes: Int; var ids: [String] = []; var id: Int { minutes } }

    static var labelColumn: CGFloat { 36 }
    /// Room above the first hour's line and under the last's for their labels.
    static var pad: CGFloat { 8 }
    static var gap: CGFloat { 4 }
    /// The "+N" lane beside a crowded group.
    static var moreLane: CGFloat { 30 }
    private var hour: CGFloat { CGFloat(DayStrip.hourHeight) }
    private var firstMinute: Int { layout.startHour * 60 }
    private func y(_ minutes: Int) -> CGFloat { Self.pad + CGFloat(minutes - firstMinute) / 60 * hour }
    private var contentHeight: CGFloat { CGFloat(layout.endHour - layout.startHour) * hour + Self.pad * 2 }
    private var viewport: CGFloat { min(contentHeight, max(260, noteHeight * 0.55)) }
    private var midnight: Date { Calendar.paper.startOfDay(for: CalendarDay.window(now).start) }
    private var nowMinutes: Int { Int(now.timeIntervalSince(midnight) / 60) }
    private var spans: [DayStrip.Span] { DayStrip.spans(items, now: now) }
    private var picked: String? { selected ?? previewSelected }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            header
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    GeometryReader { geometry in grid(width: geometry.size.width) }
                        .frame(height: contentHeight)
                        .background(alignment: .topLeading) {
                            // Where it opens: an hour before now at the top.
                            VStack(spacing: 0) {
                                Color.clear.frame(height: DayStrip.scrollTop(now: now, startHour: layout.startHour))
                                Color.clear.frame(height: 1).id("timetable.top")
                            }
                        }
                }
                .scrollIndicators(.never)
                .scrollEdgeFade()
                .frame(height: viewport)
                .onAppear { proxy.scrollTo("timetable.top", anchor: .top) }
            }
        }
        .onAppear { if takesFocus { claimKeys() } }
        .onDisappear { model.timetableKey = nil }
        // The handler sees the day as it is now.
        .onChange(of: items) { if model.timetableKey != nil { claimKeys() } }
        .onChange(of: now) { if model.timetableKey != nil { claimKeys() } }
        .onChange(of: model.inputLineFocused) { _, typing in if typing { model.timetableKey = nil } }
        // A row picked in the list (not from here) takes the keys back.
        .onChange(of: model.selectedTaskID) { _, id in
            if let id, id.uuidString != picked { model.timetableKey = nil }
        }
    }

    /// The keys come here (see NoteWindow.onTimetableKey) until the line is typed in or the day folds.
    private func claimKeys() {
        let view = self
        model.timetableKey = { event in view.key(event) }
    }

    private var header: some View {
        HStack(spacing: 10) {
            Button(action: onClose) {
                Text("오늘 하루")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PaperTheme.ink)
                    .fixedSize()
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(L("접기 (Esc)"))
            allDay()
            Spacer(minLength: 8)
            Button(action: onClose) {
                HStack(spacing: 3) {
                    Text(String(localized: "접기", table: "Day"))
                    Image(systemName: "chevron.up").font(.system(size: 8.5, weight: .bold))
                }
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(PaperTheme.sageText)
                .fixedSize()
                .frame(minHeight: 18)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(L("접기 (Esc)"))
            .accessibilityLabel(L("하루 일정표 접기"))
        }
    }

    // MARK: The grid

    private func grid(width: CGFloat) -> some View {
        let (placed, more) = DayStrip.columns(spans)
        let byID = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
        let spanByID = Dictionary(uniqueKeysWithValues: spans.map { ($0.id, $0) })
        return ZStack(alignment: .topLeading) {
            // The empty space: a click asks what to put there, a double click opens a new event.
            Color.clear
                .contentShape(Rectangle())
                .gesture(SpatialTapGesture(count: 2).onEnded { value in newEvent(at: slot(value.location.y)) }
                    .exclusively(before: SpatialTapGesture(count: 1).onEnded { value in
                        selected = nil
                        newSlot = Slot(minutes: slot(value.location.y))
                    }))
                .help(L("빈 곳을 누르면 그 시간에 새 할 일 · 일정"))
            hourLines(width: width).allowsHitTesting(false)
            ForEach(placed.filter { !$0.hidden }, id: \.id) { place in
                if let item = byID[place.id], let span = spanByID[place.id] {
                    // A group with more than three columns leaves a lane on the right for its "+N".
                    let room = more.contains { $0.group == place.group } ? width - Self.moreLane : width
                    blockBack(item, span: span, place: place, width: room)
                    block(item, span: span, place: place, width: room)
                }
            }
            ForEach(more, id: \.start) { group in
                Button { moreShown = Slot(minutes: group.start, ids: group.ids) } label: {
                    Text("+\(group.ids.count)")
                        .font(.system(size: 10, weight: .semibold).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink2)
                        .padding(.horizontal, 6)
                        .frame(height: 16)
                        .background(PaperTheme.paper2, in: Capsule())
                        .overlay { Capsule().strokeBorder(PaperTheme.rule, lineWidth: 1) }
                }
                .buttonStyle(.plain)
                .fixedSize()
                .frame(width: Self.moreLane - 2, alignment: .trailing)
                .offset(x: width - Self.moreLane + 2, y: y(group.start) + 1)
                .zIndex(7)
                .help(L("겹친 일 \(group.ids.count)개 더"))
                .popover(item: Binding(get: { moreShown?.minutes == group.start ? moreShown : nil }, set: { moreShown = $0 }), arrowEdge: .trailing) { shown in
                    moreList(shown.ids.compactMap { byID[$0] })
                }
            }
            if nowMinutes >= firstMinute && nowMinutes <= layout.endHour * 60 {
                // Over the blocks' fills, under their words.
                nowLine(width: width).offset(y: y(nowMinutes) - 4).allowsHitTesting(false).zIndex(2)
            }
        }
        .frame(width: width, height: contentHeight, alignment: .topLeading)
        .popover(item: $newSlot,
                 attachmentAnchor: .rect(.rect(CGRect(x: Self.labelColumn, y: y(newSlot?.minutes ?? firstMinute), width: max(1, width - Self.labelColumn), height: 1))),
                 arrowEdge: .bottom) { slot in
            TimetableNewItem(minutes: slot.minutes, font: model.notebookFont) { title, kind in
                make(title, kind: kind, at: slot.minutes)
            } onCancel: { newSlot = nil }
        }
    }

    private func hourLines(width: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            ForEach(layout.startHour...layout.endHour, id: \.self) { hour in
                Rectangle().fill(PaperTheme.rule).frame(width: width, height: 1).offset(y: y(hour * 60))
                Text(DayRibbon.hourLabel(hour, language: .current))
                    .font(.system(size: 9.5, weight: .medium).monospacedDigit())
                    .foregroundStyle(PaperTheme.ink3)
                    .fixedSize()
                    .padding(.trailing, 4)
                    .background(PaperTheme.paper)
                    .offset(y: y(hour * 60) - 6.5)
            }
        }
        .accessibilityHidden(true)
    }

    private func nowLine(width: CGFloat) -> some View {
        ZStack(alignment: .leading) {
            Rectangle().fill(PaperTheme.clay).frame(width: width - Self.labelColumn + 6, height: 2).offset(x: Self.labelColumn - 6)
            Circle().fill(PaperTheme.clay).frame(width: 8, height: 8).offset(x: Self.labelColumn - 9)
        }
        .frame(width: width, height: 8, alignment: .leading)
        .accessibilityHidden(true)
    }

    private func slot(_ y: CGFloat) -> Int {
        DayStrip.slot(y: Double(y - Self.pad), startHour: layout.startHour, endHour: layout.endHour)
    }

    // MARK: Blocks

    /// Where a block is drawn: its column's x and width, its top and height (a reminder's pill is 20 pt).
    private func frame(_ item: DayStrip.Item, span: DayStrip.Span, place: DayStrip.Placed, width: CGFloat)
        -> (x: CGFloat, y: CGFloat, width: CGFloat, height: CGFloat, shown: (Int, Int)) {
        let columns = CGFloat(place.columns)
        let columnWidth = (width - Self.labelColumn - Self.gap * (columns - 1)) / columns
        let x = Self.labelColumn + CGFloat(place.column) * (columnWidth + Self.gap)
        let shown = drag?.id == item.id ? (drag!.start, drag!.end) : (span.start, span.end)
        let height = item.kind == .reminder ? 20 : max(18, y(shown.1) - y(shown.0) - 2)
        return (x, y(shown.0) + 1, columnWidth, height, shown)
    }

    /// A block's words and controls (its fill is `blockBack`, under the now line).
    @ViewBuilder
    private func block(_ item: DayStrip.Item, span: DayStrip.Span, place: DayStrip.Placed, width: CGFloat) -> some View {
        let f = frame(item, span: span, place: place, width: width)
        Group {
            switch item.kind {
            case .event: eventBlock(item, span: span, height: f.height)
            case .task: taskBlock(item, span: span, height: f.height, width: f.width, shown: f.shown)
            case .reminder: reminderPill(item)
            }
        }
        .frame(width: f.width, height: f.height, alignment: .topLeading)
        .offset(x: f.x, y: f.y)
        .zIndex(drag?.id == item.id ? 6 : 3)
    }

    /// What's under a block's words: the event's tint and colour bar, a to-do's card and outline, and the pick ring —
    /// drawn below the now line, so the line runs across the day while the words stay readable on top of it.
    @ViewBuilder
    private func blockBack(_ item: DayStrip.Item, span: DayStrip.Span, place: DayStrip.Placed, width: CGFloat) -> some View {
        let f = frame(item, span: span, place: place, width: width)
        let shape = RoundedRectangle(cornerRadius: 7, style: .continuous)
        let over = item.end.map { $0 <= now } ?? false
        Group {
            switch item.kind {
            case .event:
                let color = PaperTheme.event(item.event?.color ?? "", fallback: PaperTheme.sage)
                // 14 % by day, 24 % at night: ink2 on the tint stays above 4.5:1 for every colour (scripts/check-contrast.py).
                ZStack(alignment: .leading) {
                    color.opacity(scheme == .dark ? 0.24 : 0.14)
                    Rectangle().fill(color).frame(width: 3)
                }
                .clipShape(shape)
                .opacity(over ? 0.6 : 1)
                // Solid under the fade, so the hour lines don't show through a block that's over.
                .background(PaperTheme.paper, in: shape)
            case .task:
                shape.fill(PaperTheme.card)
                    .overlay { shape.strokeBorder(!item.done && over ? PaperTheme.clay : PaperTheme.sage, lineWidth: 1.5) }
                    .opacity(item.done ? 0.5 : 1)
                    .background(PaperTheme.paper, in: shape)
            case .reminder:
                Color.clear
            }
        }
        .frame(width: f.width, height: f.height)
        .background {
            if picked == item.id && item.kind != .reminder {
                RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(PaperTheme.sageText, lineWidth: 2).padding(-2)
            }
        }
        .offset(x: f.x, y: f.y)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
        .zIndex(drag?.id == item.id ? 5 : 1)
    }

    private func eventBlock(_ item: DayStrip.Item, span: DayStrip.Span, height: CGFloat) -> some View {
        let event = item.event!
        let color = PaperTheme.event(event.color, fallback: PaperTheme.sage)
        // The block's own fill behind its words: where the now line crosses a block, it stops at the words.
        let over = item.end.map { $0 <= now } ?? false
        // (Not on a block that's over: faded, the patch would show — and the now line is past it anyway.)
        let under = ZStack { PaperTheme.paper; color.opacity(scheme == .dark ? 0.24 : 0.14) }.opacity(over ? 0 : 1)
        let time = DayStrip.rangeText(minuteDate(drag?.id == item.id ? drag!.start : span.start), minuteDate(drag?.id == item.id ? drag!.end : span.end), language: .current)
        let detail = [time, event.location].compactMap { $0?.isEmpty == false ? $0 : nil }.joined(separator: " · ")
        let movable = event.canEdit && !event.recurring
        return Group {
            if height >= 32 {
                VStack(alignment: .leading, spacing: 1) {
                    Text(item.title).font(.system(size: 11, weight: .semibold)).lineLimit(1).background(under.padding(.horizontal, -2))
                    Text(detail).font(.system(size: 10, weight: .medium).monospacedDigit()).foregroundStyle(PaperTheme.ink2).lineLimit(1)
                        .background(under.padding(.horizontal, -2))
                }
            } else {
                HStack(spacing: 6) {
                    Text(item.title).font(.system(size: 11, weight: .semibold)).lineLimit(1).background(under.padding(.horizontal, -2))
                    Text(time).font(.system(size: 10, weight: .medium).monospacedDigit()).foregroundStyle(PaperTheme.ink2).lineLimit(1).fixedSize()
                        .background(under.padding(.horizontal, -2))
                }
            }
        }
        .foregroundStyle(PaperTheme.ink)
        .padding(.leading, 10)
        .padding(.trailing, 6)
        .padding(.vertical, height >= 32 ? 4 : 2)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
        .opacity(over ? 0.6 : 1)
        .contentShape(Rectangle())
        .onTapGesture {
            pick(item.id)
            calendar.sheet = .edit(event, in: calendar)
        }
        .gesture(movable ? moveGesture(item, span: span, edge: .whole) : nil)
        .onContinuousHover { phase in hover(phase, movable ? NSCursor.openHand : nil) }
        .help(TodayEventsStrip.tooltip(event))
        .contextMenu { TodayEventsStrip.menu(event, calendar: calendar, onAddTask: { model.add($0, literal: true) }) { calendar.sheet = $0 } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(item.title + ", " + detail)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { calendar.sheet = .edit(event, in: calendar) }
    }

    private func taskBlock(_ item: DayStrip.Item, span: DayStrip.Span, height: CGFloat, width: CGFloat, shown: (Int, Int)) -> some View {
        let id = item.taskID.flatMap(UUID.init(uuidString:))
        let overdue = !item.done && (item.end.map { $0 <= now } ?? false)
        let time = TimeRange(start: shown.0, end: shown.1).text(.current)
        let tall = height >= 40
        return HStack(alignment: tall ? .top : .center, spacing: 5) {
            Button { if let id { model.toggle(id) } } label: {
                ZStack {
                    RoundedRectangle(cornerRadius: 3).fill(item.done ? PaperTheme.sage : Color.clear)
                    RoundedRectangle(cornerRadius: 3).strokeBorder(item.done ? PaperTheme.sage : overdue ? PaperTheme.clay : PaperTheme.sage, lineWidth: 1.5)
                    if item.done {
                        Image(systemName: "checkmark").font(.system(size: 7, weight: .heavy)).foregroundStyle(PaperTheme.onSage)
                    }
                }
                .frame(width: 11, height: 11)
                .frame(width: 16, height: 16)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .padding(.top, tall ? 2 : 0)
            .help(item.done ? L("완료 취소") : L("완료 표시"))
            .accessibilityLabel(item.done ? L("완료 취소") : L("완료 표시"))
            if tall {
                VStack(alignment: .leading, spacing: 0) {
                    title(item)
                    Text(time).font(.system(size: 10, weight: .medium).monospacedDigit()).foregroundStyle(PaperTheme.ink2).lineLimit(1)
                        .background(PaperTheme.card.opacity(item.done ? 0 : 1).padding(.horizontal, -2))
                }
            } else {
                title(item)
                if width > 150 {
                    Spacer(minLength: 4)
                    Text(time).font(.system(size: 10, weight: .medium).monospacedDigit()).foregroundStyle(PaperTheme.ink2).lineLimit(1).fixedSize()
                        .background(PaperTheme.card.opacity(item.done ? 0 : 1).padding(.horizontal, -2))
                }
            }
        }
        .padding(.leading, 4)
        .padding(.trailing, 7)
        .padding(.vertical, tall ? 3 : 0)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: tall ? .topLeading : .leading)
        .overlay(alignment: .bottom) {
            if !item.done && height >= 30 {
                // The end's handle: drag it to change how long.
                Capsule().fill(PaperTheme.sage).opacity(0.5).frame(width: 18, height: 3)
                    .frame(width: 40, height: 9, alignment: .center)
                    .contentShape(Rectangle())
                    .highPriorityGesture(moveGesture(item, span: span, edge: .end))
                    .onContinuousHover { phase in hover(phase, NSCursor.resizeUpDown) }
                    .padding(.bottom, -1)
                    .help(L("끌어서 끝 시간 바꾸기"))
            }
        }
        .opacity(item.done ? 0.5 : 1)
        // Inside the 1.5 pt outline (drawn under the words): a tall handwriting line's card can't cover it.
        .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous).inset(by: 1.5))
        .contentShape(Rectangle())
        .onTapGesture {
            pick(item.id)
            if let id { model.selectedTaskID = id }
        }
        .gesture(item.done ? nil : moveGesture(item, span: span, edge: .whole))
        .onContinuousHover { phase in hover(phase, item.done ? nil : NSCursor.openHand) }
        .help(item.title + " · " + time)
        .contextMenu {
            if let id {
                Button(item.done ? L("완료 취소") : L("완료 표시")) { model.toggle(id) }
                if !item.done { Button(L("이거 집중")) { focus(id) } }
                Button(L("시간 지우기")) { model.setTimeRange(id, to: nil) }
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(item.title + ", " + time + (item.done ? ", " + L("완료됨") : overdue ? ", " + L("시간 지남") : ""))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { if let id { model.selectedTaskID = id } }
        .accessibilityAction(named: Text(item.done ? L("완료 취소") : L("완료 표시"))) { if let id { model.toggle(id) } }
    }

    private func title(_ item: DayStrip.Item) -> some View {
        Text(item.title.handwritten)
            .font(model.notebookFont.font(points: 17))
            .foregroundStyle(PaperTheme.ink)
            .strikethrough(item.done, color: PaperTheme.ink2)
            .lineLimit(1)
            .padding(.trailing, 2)
            // The card behind the words (their middle 14 pt — the handwriting's line is taller than a short block): the now
            // line stops at them.
            .background(PaperTheme.card.opacity(item.done ? 0 : 1).frame(height: 14).padding(.horizontal, -2))
    }

    private func reminderPill(_ item: DayStrip.Item) -> some View {
        let clock = DayStrip.clockText(item.start, language: .current)
        return HStack(spacing: 4) {
            Circle().strokeBorder(PaperTheme.ink3, lineWidth: 1.2).frame(width: 7, height: 7)
            Text(item.title).lineLimit(1)
            Text(clock).monospacedDigit().fixedSize()
        }
        .font(.system(size: 10, weight: .medium))
        .foregroundStyle(PaperTheme.ink2)
        .padding(.horizontal, 7)
        .frame(height: 20)
        .background(PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        .overlay {
            if picked == item.id { RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(PaperTheme.sageText, lineWidth: 1.5) }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            pick(item.id)
            if let id = item.taskID.flatMap(UUID.init(uuidString:)) { model.selectedTaskID = id }
        }
        .help(item.title + " · " + clock)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L("알림") + ": " + item.title + ", " + clock)
        .accessibilityAddTraits(.isButton)
    }

    private func moreList(_ hidden: [DayStrip.Item]) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(hidden, id: \.id) { item in
                Button {
                    moreShown = nil
                    open(item)
                } label: {
                    HStack(spacing: 6) {
                        StripMark(item: item)
                        Text(DayStrip.clockText(item.start, language: .current)).monospacedDigit().foregroundStyle(PaperTheme.ink2)
                        Text(item.title).lineLimit(1)
                    }
                    .font(.system(size: 12))
                    .frame(minHeight: 22)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(10)
        .frame(minWidth: 160, alignment: .leading)
        .background(PaperTheme.paper)
    }

    // MARK: Dragging

    private func moveGesture(_ item: DayStrip.Item, span: DayStrip.Span, edge: TimeBlock.Edge) -> some Gesture {
        DragGesture(minimumDistance: 3)
            .onChanged { value in
                let moved = DayStrip.dragged(start: span.start, end: span.end, edge: edge, points: Double(value.translation.height),
                                             startHour: layout.startHour, endHour: layout.endHour)
                drag = Drag(id: item.id, start: moved.start, end: moved.end)
                pick(item.id)
            }
            .onEnded { _ in
                defer { drag = nil }
                guard let drag, drag.id == item.id, drag.start != span.start || drag.end != span.end else { return }
                if item.kind == .event { moveEvent(item, to: drag) } else { moveTask(item, to: drag, edge: edge) }
            }
    }

    /// One undo step; a start alone stays a start alone when moved whole.
    private func moveTask(_ item: DayStrip.Item, to drag: Drag, edge: TimeBlock.Edge) {
        guard let id = item.taskID.flatMap(UUID.init(uuidString:)), let task = model.items.first(where: { $0.id == id }) else { return }
        let old = task.timeRange
        let new = TimeRange(start: drag.start, end: old?.end == nil && edge == .whole ? nil : drag.end)
        guard new != old else { return }
        model.setTimeRange(id, to: new)
        model.offerUndo(symbol: "clock", text: L("시간을 옮겼어요 · \(new.text(.current))"), after: model.notebookNow) { [model] in
            model.setTimeRange(id, to: old)
        }
    }

    /// A one-off event moves to the new time (same length); the toast takes it back.
    private func moveEvent(_ item: DayStrip.Item, to drag: Drag) {
        guard let event = item.event, let local = calendar.event(event.eventId), local.repeatRule == .none, !local.allDay else { return }
        let old = CalendarDraft.forEvent(local)
        var draft = old
        let start = minuteDate(drag.start)
        draft.date = CalendarDraft.day(start)
        draft.startMinutes = drag.start % 1440
        draft.endMinutes = drag.end % 1440
        calendar.perform(.update(local.id, draft))
        var toast = PaperToast(symbol: "calendar", text: L("일정을 옮겼어요 · \(DayStrip.rangeText(start, minuteDate(drag.end), language: .current))"))
        toast.action = L("되돌리기")
        toast.perform = { [calendar, model] in
            calendar.perform(.update(local.id, old))
            model.toast = nil
        }
        model.toast = toast
    }

    private func minuteDate(_ minutes: Int) -> Date { Calendar.paper.date(byAdding: .minute, value: minutes, to: midnight)! }

    private func hover(_ phase: HoverPhase, _ cursor: NSCursor?) {
        guard let cursor else { return }
        switch phase {
        case .active: cursor.set()
        case .ended: NSCursor.arrow.set()
        }
    }

    // MARK: Making

    private func make(_ title: String, kind: Intent.Kind?, at minutes: Int) {
        newSlot = nil
        let name = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        let candidates = DayStrip.newCandidates(title: name, at: minutes, kind: kind, now: Date(), language: .current)
        guard let commit = model.commitIntent(text: name, candidates: candidates, index: 0, page: .todos) else { return }
        model.toast = model.makeToast(for: commit) { [model] in model.toast = $0 }
    }

    private func newEvent(at minutes: Int) {
        newSlot = nil
        let start = minuteDate(minutes)
        calendar.sheet = CalendarSheetRequest(mode: .new, draft: CalendarDraft(title: "", date: CalendarDraft.day(start), startMinutes: minutes % 1440,
                                                                                endMinutes: min(TimeBlock.dayEnd, minutes + 60) % 1440, color: calendar.lastColor))
    }

    // MARK: Keys

    private func pick(_ id: String) {
        selected = id
        claimKeys()
    }

    private func open(_ item: DayStrip.Item) {
        if let event = item.event { calendar.sheet = .edit(event, in: calendar) }
        else if let id = item.taskID.flatMap(UUID.init(uuidString:)) { model.selectedTaskID = id }
    }

    private func focus(_ id: UUID) {
        guard let task = model.items.first(where: { $0.id == id }) else { return }
        model.focus(on: id, minutes: TimeBlock.focusMinutes(task, now: Date()))
    }

    /// The blocks drawn, top to bottom (then left to right).
    private var order: [DayStrip.Item] {
        let placed = DayStrip.columns(spans).placed.filter { !$0.hidden }
        let column = Dictionary(uniqueKeysWithValues: placed.map { ($0.id, $0.column) })
        let start = Dictionary(uniqueKeysWithValues: spans.map { ($0.id, $0.start) })
        return items.filter { column[$0.id] != nil }.sorted { (start[$0.id]!, column[$0.id]!) < (start[$1.id]!, column[$1.id]!) }
    }

    /// ↑ ↓ pick, Return opens, Space ticks a to-do, ⌥↑ ⌥↓ move it 15 minutes, Esc folds the day.
    private func key(_ event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection([.command, .option, .control, .shift])
        let blocks = order
        let index = selected.flatMap { id in blocks.firstIndex { $0.id == id } }
        let current = index.map { blocks[$0] }
        switch (event.keyCode, flags) {
        case (53, []):
            model.timetableKey = nil
            onClose()
            return true
        case (125, [.option]), (126, [.option]):
            guard let current, current.kind == .task, !current.done, let span = spans.first(where: { $0.id == current.id }) else { return true }
            let moved = DayStrip.nudged(start: span.start, end: span.end, by: event.keyCode == 125 ? 1 : -1, startHour: layout.startHour, endHour: layout.endHour)
            moveTask(current, to: Drag(id: current.id, start: moved.start, end: moved.end), edge: .whole)
            return true
        case (125, []), (126, []):
            guard !blocks.isEmpty else { return true }
            let down = event.keyCode == 125
            if let index {
                selected = blocks[min(blocks.count - 1, max(0, index + (down ? 1 : -1)))].id
            } else {
                // The first one not over yet.
                selected = (blocks.first { ($0.end ?? $0.start) > now } ?? blocks[0]).id
            }
            return true
        case (36, []), (76, []):
            guard let current else { return false }
            open(current)
            return true
        case (49, []):
            guard let current, current.kind != .event, let id = current.taskID.flatMap(UUID.init(uuidString:)) else { return false }
            model.toggle(id)
            return true
        default:
            return false
        }
    }
}

/// The little line a click on the timetable opens: `무엇을 할까요?`, 할 일 · 일정 (할 일 first, 일정 when the words say
/// so), Return puts it in.
struct TimetableNewItem: View {
    let minutes: Int
    var font: NotebookFont = .pen
    let onMake: (String, Intent.Kind?) -> Void
    let onCancel: () -> Void
    @State private var text: String
    @State private var kind: Intent.Kind?

    /// `text`: snapshots, the line already written.
    init(minutes: Int, font: NotebookFont = .pen, onMake: @escaping (String, Intent.Kind?) -> Void, onCancel: @escaping () -> Void, text: String = "") {
        self.minutes = minutes
        self.font = font
        self.onMake = onMake
        self.onCancel = onCancel
        _text = State(initialValue: text)
    }

    var body: some View {
        let auto: Intent.Kind = Intent.hasEventWord(text, language: .current) ? .event : .todo
        let chosen = kind ?? auto
        let empty = text.trimmingCharacters(in: .whitespaces).isEmpty
        VStack(alignment: .leading, spacing: 10) {
            Text(TimeRange(start: minutes, end: min(TimeBlock.dayEnd, minutes + 60)).text(.current))
                .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                .tracking(0.4)
                .foregroundStyle(PaperTheme.sageText)
            HandField(placeholder: L("무엇을 할까요?"), text: $text, size: 24, font: font,
                      onSubmit: { if !empty { onMake(text, kind) } }, onCancel: onCancel, autofocus: true)
            HStack(spacing: 6) {
                SlipChipButton(title: String(localized: "할 일", table: "Day"), symbol: "checkmark.square", selected: chosen == .todo) { kind = .todo }
                    .fixedSize()
                SlipChipButton(title: String(localized: "일정", table: "Day"), symbol: "calendar", selected: chosen == .event) { kind = .event }
                    .fixedSize()
                Spacer(minLength: 6)
                // The chips never shrink; the hint drops its word when there's no room (nl "Toevoegen").
                ViewThatFits(in: .horizontal) {
                    Text("↩ " + L("넣기")).fixedSize()
                    Text("↩").fixedSize()
                }
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(PaperTheme.ink3)
                .opacity(empty ? 0.35 : 1)
            }
        }
        .padding(14)
        .frame(width: 270)
        .background(PaperTheme.paper)
    }
}
