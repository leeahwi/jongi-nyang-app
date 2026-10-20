import PaperCore
import SwiftUI

/// Where a task dragged on 앞으로 would land.
enum AheadDropTarget: Hashable {
    case day(String)
    case someday
}

/// 앞으로: this week's days from tomorrow, next week's, later deadlines by month, and 언젠가 (see
/// Ahead). Each day lists its events (a colour bar, the time, the title — click to edit, right-click
/// for the menu) and the tasks due that day. Drag a task onto another day to change its date, onto
/// 언젠가 to take the date off, onto the 오늘 tab for today, or within its day to reorder.
struct AheadPageView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var calendar: EventBook
    /// Snapshots: a fixed now, and a drag drawn as if under way onto this target.
    var now: Date?
    var previewDrag: (source: UUID, target: AheadDropTarget)?
    var previewLine: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast

    @State private var drag: UUID?
    @State private var target: AheadDropTarget?
    @State private var rowDrop: TaskRowDrop?
    @State private var targetFrames: [AheadDropTarget: CGRect] = [:]
    @State private var rowFrames: [UUID: CGRect] = [:]

    init(model: AppModel, now: Date? = nil, previewDrag: (source: UUID, target: AheadDropTarget)? = nil, previewLine: String? = nil) {
        self.model = model
        calendar = model.calendar
        self.now = now
        self.previewDrag = previewDrag
        self.previewLine = previewLine
    }

    private var dragging: UUID? { drag ?? previewDrag?.source }

    /// The list's left edge, the date column (46 pt, as in the design) and the gap after it.
    static let inset: CGFloat = 20
    /// 46 pt; English needs a little more for "Tomorrow".
    static var dateColumn: CGFloat { AppLanguage.current == .en ? 56 : 46 }
    static let columnGap: CGFloat = 10
    private var shownTarget: AheadDropTarget? { drag != nil ? target : previewDrag?.target }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { timeline in
            let now = self.now ?? timeline.date
            let sections = model.aheadSections(now: now)
            VStack(spacing: 0) {
                list(sections, now: now)
                    .overlay(alignment: .bottom) { ToastHost(model: model) }
                IntentLineView(model: model, page: .ahead, previewText: previewLine, previewFocused: previewLine != nil)
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                    .padding(.bottom, 8)
                footer
            }
        }
    }

    // MARK: The list

    private func list(_ sections: [Ahead.Section], now: Date) -> some View {
        let byID = Dictionary(uniqueKeysWithValues: model.items.map { ($0.id, $0) })
        return GeometryReader { geometry in
          ScrollViewReader { proxy in
            ScrollView(.vertical) {
                // Lazy (1.39): only the days on screen are built, so switching to 앞으로 doesn't make every row first.
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(withEmptyDays(sections, now: now), id: \.kind) { section in
                        GroupHeader(title: section.title, count: section.count > 0 ? section.count : nil, leading: Self.inset)
                            .padding(.top, section.kind == sections.first?.kind ? 2 : 10)
                            .background(frameReader(section.kind == .someday ? .someday : nil))
                        switch section.kind {
                        case .thisWeek, .nextWeek:
                            ForEach(section.days, id: \.date) { day in dayBlock(day, byID: byID, now: now) }
                        case .later:
                            ForEach(section.months, id: \.title) { month in monthBlock(month, byID: byID, now: now) }
                        case .someday:
                            somedayBlock(section.tasks, byID: byID)
                        }
                    }
                    if sections.isEmpty && dragging == nil {
                        EmptySheetNote(pose: .curious, text: Ahead.emptyText(.current))
                    }
                    Color.clear.frame(height: 12)
                }
                .frame(maxWidth: .infinity, minHeight: geometry.size.height, alignment: .top)
            }
            .scrollIndicators(.never) // never a legacy scroller: its 17 pt gutter shifted the rules and meta
            .scrollEdgeFade()
            .onPreferenceChange(AheadTargetFramesKey.self) { targetFrames = $0 }
            .onPreferenceChange(AheadRowFramesKey.self) { rowFrames = $0 }
            .onChange(of: model.selectedTaskID) { _, id in
                guard let id else { return }
                withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .center) }
            }
          }
        }
    }

    /// While a task is being dragged every day from tomorrow to the end of next week shows (an
    /// empty day is a place to drop it), and 언젠가 too.
    private func withEmptyDays(_ sections: [Ahead.Section], now: Date) -> [Ahead.Section] {
        guard dragging != nil else { return sections }
        let language = AppLanguage.current
        let calendar = Calendar.paper
        let week = Ahead.week(of: now, language: language)
        let existing = Dictionary(sections.flatMap(\.days).map { ($0.date, $0) }, uniquingKeysWith: { a, _ in a })
        guard let today = Deadline.date(from: Deadline.key(Archive.logicalDayStart(now))),
              let lastOfNext = Deadline.date(from: week.last).flatMap({ calendar.date(byAdding: .day, value: 7, to: $0) }) else { return sections }
        var thisWeek: [Ahead.Day] = [], nextWeek: [Ahead.Day] = []
        var offset = 1
        while let date = calendar.date(byAdding: .day, value: offset, to: today), date <= lastOfNext {
            let key = Deadline.key(date)
            let parts = calendar.dateComponents([.weekday, .day], from: date)
            let day = existing[key] ?? Ahead.Day(date: key, weekday: parts.weekday! - 1, day: parts.day!,
                                                relative: offset == 1 ? language.dayWord(1) : nil, events: [], tasks: [])
            if key <= week.last { thisWeek.append(day) } else { nextWeek.append(day) }
            offset += 1
        }
        func section(_ kind: Ahead.Kind, _ days: [Ahead.Day]) -> Ahead.Section? {
            guard !days.isEmpty else { return nil }
            return Ahead.Section(kind: kind, title: kind.title(language), days: days, months: [], tasks: [], count: days.map(\.tasks.count).reduce(0, +))
        }
        let later = sections.first { $0.kind == .later }
        let someday = sections.first { $0.kind == .someday }
            ?? Ahead.Section(kind: .someday, title: Ahead.Kind.someday.title(language), days: [], months: [], tasks: [], count: 0)
        return [section(.thisWeek, thisWeek), section(.nextWeek, nextWeek), later, someday].compactMap { $0 }
    }

    // MARK: A day

    private func dayBlock(_ day: Ahead.Day, byID: [UUID: TodoItem], now: Date) -> some View {
        let tomorrow = day.relative != nil
        let targeted = shownTarget == .day(day.date) && !day.tasks.contains(where: { $0 == dragging })
        let language = AppLanguage.current
        return HStack(alignment: .top, spacing: Self.columnGap) {
            // The date: weekday over the day number; tomorrow in sage with its word.
            VStack(alignment: .leading, spacing: 0) {
                Text(day.relative ?? language.weekdayShort(day.weekday))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(tomorrow ? PaperTheme.sage : PaperTheme.ink2)
                    .lineLimit(1)
                    .fixedSize()
                Text("\(day.day)")
                    .font(.system(size: 17, weight: .semibold).monospacedDigit())
                    .foregroundStyle(tomorrow ? PaperTheme.sage : PaperTheme.ink)
            }
            .frame(width: Self.dateColumn, alignment: .leading)
            .padding(.top, 2)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(language.shortDate(Deadline.date(from: day.date) ?? now) + (day.relative.map { ", \($0)" } ?? ""))
            .accessibilityAddTraits(.isHeader)

            VStack(alignment: .leading, spacing: 2) {
                ForEach(day.events, id: \.key) { event in eventLine(event) }
                ForEach(day.tasks, id: \.self) { id in
                    if let item = byID[id] { taskRow(item, group: day.tasks, meta: .due) }
                }
                if day.events.isEmpty && day.tasks.isEmpty {
                    // An empty day shows only while dragging: room to drop.
                    Color.clear.frame(height: 22)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 7)
        .padding(.leading, Self.inset)
        .padding(.trailing, 12)
        .background {
            if targeted {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(PaperTheme.sage2)
                    .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 1)
            }
        }
        .overlay(alignment: .bottom) {
            Rectangle().fill(contrast == .increased ? PaperTheme.ink3 : PaperTheme.rule).frame(height: 0.6)
                .padding(.leading, 18).padding(.trailing, 14)
                .opacity(targeted ? 0 : 1)
        }
        .background(frameReader(.day(day.date)))
        .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: targeted)
        .accessibilityElement(children: .contain)
    }

    /// An event in a day: a 4 pt colour bar, the time (tabular) and the title.
    private func eventLine(_ event: CalendarEvent) -> some View {
        let color = PaperTheme.event(event.color, fallback: PaperTheme.eventBlue)
        let time = Ahead.eventTime(event, language: .current)
        return Button {
            calendar.sheet = .edit(event, in: calendar)
        } label: {
            HStack(spacing: 7) {
                RoundedRectangle(cornerRadius: 2, style: .continuous).fill(color).frame(width: 4, height: 14)
                Text(time)
                    .font(.system(size: 11.5, weight: .medium).monospacedDigit())
                    .foregroundStyle(PaperTheme.ink2)
                    .fixedSize()
                Text(event.title)
                    .font(.system(size: 12.5))
                    .foregroundStyle(PaperTheme.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }
            // The colour bar sits under the checkboxes' middle.
            .padding(.leading, TaskRowStyle.inset.handle + TaskRowStyle.inset.checkColumn / 2 - 2)
            .frame(maxWidth: .infinity, minHeight: 22, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(AheadEventButtonStyle())
        .help(event.title + " · " + time)
        .contextMenu {
            TodayEventsStrip.menu(event, calendar: calendar, onAddTask: { model.add($0, literal: true) }) { calendar.sheet = $0 }
        }
        .accessibilityLabel(event.title + ", " + time)
    }

    // MARK: 그 뒤 and 언젠가

    /// A month of 그 뒤: its name in the date column (the year under it when it isn't this year),
    /// its deadlines beside it, each with its date.
    private func monthBlock(_ month: Ahead.Month, byID: [UUID: TodoItem], now: Date) -> some View {
        HStack(alignment: .top, spacing: Self.columnGap) {
            // The short name ("11월", "Nov", "nov"), the year under it when it isn't this year.
            VStack(alignment: .leading, spacing: 0) {
                Text(AppLanguage.current.monthShort(month.month))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PaperTheme.ink2)
                if month.title != AppLanguage.current.monthName(month.month) {
                    Text(verbatim: "\(month.year)")
                        .font(.system(size: 10, weight: .medium).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink3)
                }
            }
            .lineLimit(1)
            .fixedSize()
            .frame(width: Self.dateColumn, alignment: .leading)
            .padding(.top, 11)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(month.title)
            .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(month.tasks, id: \.self) { id in
                    if let item = byID[id], let due = item.dueDate {
                        taskRow(item, group: nil, meta: .date(Ahead.dateText(due, now: now, language: .current)))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 2)
        .padding(.leading, Self.inset)
        .padding(.trailing, 12)
        .overlay(alignment: .bottom) { rule.padding(.leading, 18).padding(.trailing, 14) }
    }

    private func somedayBlock(_ ids: [UUID], byID: [UUID: TodoItem]) -> some View {
        let targeted = shownTarget == .someday && !ids.contains(where: { $0 == dragging })
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(ids, id: \.self) { id in
                if let item = byID[id] {
                    taskRow(item, group: ids, meta: nil)
                        .padding(.leading, Self.inset + Self.dateColumn + Self.columnGap)
                        .padding(.trailing, 12)
                        .overlay(alignment: .bottom) { rule.padding(.leading, 18).padding(.trailing, 14).opacity(targeted ? 0 : 1) }
                }
            }
            if ids.isEmpty {
                Text("여기에 놓으면 날짜 없이 언젠가로")
                    .font(.system(size: 11.5))
                    .foregroundStyle(targeted ? PaperTheme.sage : PaperTheme.ink3)
                    .frame(maxWidth: .infinity, minHeight: 40)
                    .padding(.horizontal, Self.inset)
            }
        }
        .padding(.vertical, 2)
        .background {
            if targeted {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(PaperTheme.sage2)
                    .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) }
                    .padding(.horizontal, 10)
            } else if ids.isEmpty {
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(contrast == .increased ? PaperTheme.ink3 : PaperTheme.rule, style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    .padding(.horizontal, 10)
            }
        }
        .background(frameReader(.someday))
    }

    private var rule: some View {
        Rectangle().fill(contrast == .increased ? PaperTheme.ink3 : PaperTheme.rule).frame(height: 0.6).allowsHitTesting(false)
    }

    // MARK: Rows and dragging

    private func taskRow(_ item: TodoItem, group: [UUID]?, meta: AheadMeta?) -> some View {
        TaskRow(item: item, onShelf: true, model: model, rowDrop: $rowDrop, groupRows: group, style: .inset, aheadMeta: meta,
                onDragPoint: { point in dragMoved(item.id, to: point, group: group) },
                onDragEnd: { accepted in dragEnded(item.id, accepted: accepted) })
            .background {
                // Only while a task is being dragged (1.39): every row reporting its frame on every layout made
                // each tab switch and redraw of 앞으로 slow.
                if dragging != nil {
                    GeometryReader { geometry in
                        Color.clear.preference(key: AheadRowFramesKey.self, value: [item.id: geometry.frame(in: .global)])
                    }
                }
            }
            .opacity(dragging == item.id ? 0.55 : 1)
            .id(item.id)
    }

    @ViewBuilder
    private func frameReader(_ target: AheadDropTarget?) -> some View {
        if dragging != nil, let target {
            GeometryReader { geometry in
                Color.clear.preference(key: AheadTargetFramesKey.self, value: [target: geometry.frame(in: .global)])
            }
        }
    }

    /// Within its own day (or 언젠가) the pointer picks a place between rows; elsewhere the day or
    /// 언젠가 under it.
    private func dragMoved(_ id: UUID, to point: CGPoint, group: [UUID]?) {
        if drag == nil {
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { drag = id }
        }
        (rowDrop, target) = Self.drop(id, at: point, group: group, rowFrames: rowFrames, targetFrames: targetFrames)
    }

    /// Where a dragged task would land: between two rows of its own day (or 언젠가), else the day
    /// or 언젠가 under the pointer, else nowhere.
    static func drop(_ id: UUID, at point: CGPoint, group: [UUID]?, rowFrames: [UUID: CGRect],
                     targetFrames: [AheadDropTarget: CGRect]) -> (TaskRowDrop?, AheadDropTarget?) {
        if let group, let over = group.first(where: { $0 != id && rowFrames[$0]?.contains(point) == true }), let frame = rowFrames[over] {
            return (TaskRowDrop(source: id, target: over, after: point.y > frame.midY), nil)
        }
        return (nil, targetFrames.first { $0.value.contains(point) }?.key)
    }

    private func dragEnded(_ id: UUID, accepted: Bool) {
        defer {
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.16)) { drag = nil }
            target = nil
            rowDrop = nil
        }
        guard accepted else { return }
        if let drop = rowDrop {
            model.move(drop.source, relativeTo: drop.target, after: drop.after)
        } else if let target {
            switch target {
            case .day(let key): model.move(id, to: .day(key))
            case .someday: model.move(id, to: .someday)
            }
        }
    }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: 8) {
            // The hint, when there's room for all of it.
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    Image(systemName: "hand.draw").font(.system(size: 11))
                    Text("다른 날로 끌면 마감이 바뀌어요").lineLimit(1).fixedSize()
                }
                Color.clear.frame(width: 1, height: 1)
            }
            Spacer(minLength: 8)
            Button(action: model.showCalendar) {
                HStack(spacing: 4) {
                    Image(systemName: "calendar").font(.system(size: 11))
                    Text("달력").lineLimit(1)
                }
                .padding(.horizontal, 6)
                .frame(height: 22)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("달력 (⌘ D)")
        }
        .font(.system(size: 11))
        .foregroundStyle(PaperTheme.secondary)
        .padding(.horizontal, 20)
        .frame(height: 32)
        .overlay(alignment: .top) {
            Rectangle().fill(PaperTheme.rule).frame(height: 0.6).padding(.horizontal, 16)
        }
    }
}

/// An event line in a day: a faint sage wash on hover, like the rows.
private struct AheadEventButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        HoverWash(pressed: configuration.isPressed) { configuration.label }
    }

    private struct HoverWash<Content: View>: View {
        let pressed: Bool
        @ViewBuilder let content: () -> Content
        @State private var hovering = false

        var body: some View {
            content()
                .background(PaperTheme.sage.opacity(pressed ? 0.12 : hovering ? 0.055 : 0), in: RoundedRectangle(cornerRadius: 4))
                .onHover { hovering = $0 }
        }
    }
}

private struct AheadTargetFramesKey: PreferenceKey {
    static let defaultValue: [AheadDropTarget: CGRect] = [:]
    static func reduce(value: inout [AheadDropTarget: CGRect], nextValue: () -> [AheadDropTarget: CGRect]) {
        value.merge(nextValue()) { a, b in a.union(b) }
    }
}

private struct AheadRowFramesKey: PreferenceKey {
    static let defaultValue: [UUID: CGRect] = [:]
    static func reduce(value: inout [UUID: CGRect], nextValue: () -> [UUID: CGRect]) {
        value.merge(nextValue()) { $1 }
    }
}
