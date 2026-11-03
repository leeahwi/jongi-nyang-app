import PaperCore
import SwiftUI

/// The sheets of the note.
struct PageTab {
    let page: AppModel.Page
    let short: String
    let symbol: String

    static var all: [PageTab] {
        [
            PageTab(page: .todos, short: L("오늘"), symbol: "sun.max"),
            PageTab(page: .ahead, short: L("앞으로"), symbol: "calendar"),
        ]
    }

    static func title(_ page: AppModel.Page) -> String {
        switch page {
        case .todos: L("오늘 할 일")
        case .ahead: L("앞으로")
        }
    }
}

enum NoteHeader {
    /// Washi-tab row (38 pt) + title block (date eyebrow, the handwritten title and the progress).
    static let tabRow: CGFloat = 38
    static let titleBlock: CGFloat = 70
    static let height: CGFloat = tabRow + titleBlock
    /// 1.38 (audit P7): a short note (480 pt or less) gets a one-line title block, so the list keeps its rows.
    static let compactTitleBlock: CGFloat = 46
    static let compactBelow: CGFloat = 480
}

extension PaperView {
    // MARK: Washi tabs, then the title block

    var indexTabsHeader: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .bottom, spacing: 0) {
                Spacer().frame(width: 76) // the window's close / minimise / zoom buttons
                // Tabs and tools keep a clear gap; narrow windows drop the counts first.
                // (At the narrowest the labels get smaller and 달력 waits in ⋯.)
                ViewThatFits(in: .horizontal) {
                    tabsAndTools(counts: true)
                    tabsAndTools(counts: false)
                    tabsAndTools(counts: false, tight: true)
                    tabsAndTools(counts: false, tight: true, small: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                // The tools themselves, once, where the stand-in of the variant that fits is.
                .overlay(alignment: .bottomTrailing) {
                    HStack(spacing: 2) { toolbarIcons(desk: !headerSmall) }.frame(height: 30).padding(.bottom, 5)
                        .background(ToolbarControlFrame())
                        .fixedSize()
                        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width in
                            // The full set's width (with 책상), whichever is showing.
                            let full = headerSmall ? width + Self.deskToolWidth : width
                            if abs(full - toolbarWidth) > 0.5 { toolbarWidth = full }
                        }
                }
                .onPreferenceChange(HeaderSmallKey.self) { small in if small != headerSmall { headerSmall = small } }
                .onPreferenceChange(ToolbarControlFramesKey.self) { frames in
                    // Tell the window which parts of the top row are controls; the rest drags it.
                    (NSApp.windows.first { $0 is NoteWindow } as? NoteWindow)?.toolbarControlFrames = frames
                }
                .onPreferenceChange(TabFramesKey.self) { frames in
                    // …and where each tab is, so a task can be dropped on one.
                    (NSApp.windows.first { $0 is NoteWindow } as? NoteWindow)?.tabFrames = frames
                }
            }
            .padding(.trailing, 12)
            .frame(height: NoteHeader.tabRow, alignment: .bottom)
            .background(alignment: .bottom) {
                // The active tab's colour runs under the row and joins the tab to the sheet.
                Rectangle().fill(IndexTab.color(model.page)).frame(height: 3)
            }
            .zIndex(1)

            Group {
                if compactHeader { compactTitleBlock } else { titleBlock }
            }
            .frame(height: compactHeader ? NoteHeader.compactTitleBlock : NoteHeader.titleBlock, alignment: .top)
        }
    }

    /// The short note's title block: the title a size smaller with the date beside it, the progress and the space
    /// button at the end. (#151: no cat in the header any more — its ears stand on the window's top edge, NoteEars.swift.)
    private var compactTitleBlock: some View {
        HStack(alignment: .top, spacing: 8) {
            HStack(alignment: .lastTextBaseline, spacing: 10) {
                Text(PageTab.title(model.page).handwritten)
                    .font(model.notebookFont.bodyFont(.large))
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.top, -model.notebookFont.extraLineHeight(.large).top)
                    .padding(.bottom, -model.notebookFont.extraLineHeight(.large).bottom)
                    .accessibilityAddTraits(.isHeader)
                TimelineView(.periodic(from: .now, by: 60)) { timeline in
                    Text(model.page == .ahead ? Ahead.weekTitle(now: timeline.date, language: .current) : AppLanguage.current.longDate(timeline.date))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(PaperTheme.sageText)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                }
                ViewThatFits(in: .horizontal) { progressLine; Color.clear.frame(width: 0, height: 0) }
            }
            .padding(.top, 10)
            // 1.45: the title and date first, as in 1.44; the space button takes what's left — except while one space
            // shows (#87: no band over the list says so any more), when its dot and ▾ stay and the date gives way.
            .layoutPriority(showsSpaceButton && model.spaceShown == .all ? 1 : 0)
            Spacer(minLength: 0)
            // A short note's one-line header: the dot and ▾ only; showing everything, none when even that doesn't fit
            // (보기 → 스페이스 and ⌥⌘0–9 still pick).
            if showsSpaceButton {
                if model.spaceShown != .all {
                    SpaceHeaderButton(model: model, short: true).padding(.top, 9)
                } else {
                    ViewThatFits(in: .horizontal) {
                        SpaceHeaderButton(model: model, short: true).padding(.top, 9)
                        Color.clear.frame(width: 0, height: 0)
                    }
                }
            }
        }
        .padding(.leading, 20)
        .padding(.trailing, 14)
    }

    private var titleBlock: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                // 할 일 스페이스 (1.45): `모든 스페이스 ▾` at the end of the date line, as on Windows (W19), so a
                // longer or shorter label (모든 스페이스 ↔ 회사만) never moves the title and the progress (#13).
                HStack(alignment: .center, spacing: 8) {
                    TimelineView(.periodic(from: .now, by: 60)) { timeline in
                        // 앞으로: the week ("이번 주 · 10월 4일 – 10일"); elsewhere today's date.
                        Text(model.page == .ahead ? Ahead.weekTitle(now: timeline.date, language: .current) : AppLanguage.current.longDate(timeline.date))
                            .font(.system(size: 11, weight: .semibold))
                            .tracking(0.2)
                            .foregroundStyle(PaperTheme.sageText)
                            .lineLimit(1)
                    }
                    .layoutPriority(1)
                    if showsSpaceButton {
                        Spacer(minLength: 4)
                        // The 24 pt pill hangs over the date line's height, so the title sits where it did in 1.44.
                        SpaceHeaderButton(model: model).frame(height: 14)
                    }
                }
                // The progress sits beside the title when there's room, else under it.
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .lastTextBaseline, spacing: 12) { pageTitle; progressLine }
                    VStack(alignment: .leading, spacing: 3) { pageTitle; progressLine }
                    pageTitle
                }
            }
            .padding(.top, 12)
            .frame(maxWidth: showsSpaceButton ? .infinity : nil, alignment: .leading)
            Spacer(minLength: 0)
        }
        .padding(.leading, 20)
        .padding(.trailing, 14)
    }

    private var showsSpaceButton: Bool { model.page == .todos && !model.todoSpaces.isEmpty }

    private var pageTitle: some View {
        Text(PageTab.title(model.page).handwritten)
            .font(model.notebookFont.bodyFont(.extraLarge))
            .lineLimit(1)
            .fixedSize()
            // English and Dutch handwriting has a taller line: kept to the Korean one's.
            .padding(.top, -model.notebookFont.extraLineHeight(.extraLarge).top)
            .padding(.bottom, -model.notebookFont.extraLineHeight(.extraLarge).bottom)
            .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder
    private var progressLine: some View {
        if model.page == .todos && !model.todayItems.isEmpty {
            ProgressDonutLine(done: model.completedCount, total: model.todayItems.count)
                .fixedSize()
                .padding(.bottom, 3)
        } else if model.page == .ahead {
            // "할 일 6 · 일정 3" instead of the donut.
            let sections = model.aheadSections()
            let summary = Ahead.summary(todos: Ahead.count(sections), events: Ahead.eventCount(sections), language: .current)
            if !summary.isEmpty {
                Text(summary)
                    .font(.system(size: 11, weight: .semibold).monospacedDigit())
                    .foregroundStyle(PaperTheme.ink2)
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.bottom, 3)
            }
        }
    }

    /// 책상's button and the gap before it (QuietButtonStyle 26 pt, the tools' 2 pt spacing).
    static let deskToolWidth: CGFloat = 28

    private func tabsAndTools(counts: Bool, tight: Bool = false, small: Bool = false) -> some View {
        HStack(alignment: .bottom, spacing: 0) {
            indexTabs(counts: counts, tight: tight, small: small).background(ToolbarControlFrame())
            Spacer(minLength: small ? 6 : 12)
            // A stand-in as wide as the tools this variant has (drawn once, over it).
            Color.clear.frame(width: max(0, toolbarWidth - (small ? Self.deskToolWidth : 0)), height: 30)
        }
        .preference(key: HeaderSmallKey.self, value: small)
    }

    private func indexTabs(counts: Bool, tight: Bool, small: Bool) -> some View {
        HStack(alignment: .bottom, spacing: tight ? 2 : 4) {
            ForEach(PageTab.all, id: \.short) { tab in
                IndexTab(title: tab.short, count: counts ? tabCount(tab.page) : nil, color: IndexTab.color(tab.page), edge: IndexTab.edge(tab.page),
                         font: model.notebookFont, active: model.page == tab.page, targeted: model.dragOverPage == tab.page,
                         tight: tight, small: small) {
                    // N1: the page changes at once (as ⌘1 · ⌘2 do); only the tab rises (IndexTab, 살짝).
                    model.page = tab.page
                }
                .background(GeometryReader { geometry in
                    Color.clear.preference(key: TabFramesKey.self, value: [tab.page: geometry.frame(in: .global)])
                })
            }
        }
        .fixedSize()
    }

    private func tabCount(_ page: AppModel.Page) -> Int? {
        switch page {
        case .todos: model.remainingCount > 0 ? model.remainingCount : nil
        case .ahead: model.aheadCount.nonZero
        }
    }
}

/// "◔ 2 / 5 끝냈어요": a small donut that fills in sage as today's tasks get done.
struct ProgressDonutLine: View {
    let done: Int
    let total: Int

    var body: some View {
        HStack(spacing: 6) {
            ProgressDonut(fraction: total == 0 ? 0 : Double(done) / Double(total))
                .frame(width: 16, height: 16)
            Text("\(done) / \(total) 끝냈어요")
                .font(.system(size: 11, weight: .semibold).monospacedDigit())
                .foregroundStyle(PaperTheme.ink2)
                .lineLimit(1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(done == total ? L("오늘 할 일 \(total)개를 모두 끝냈어요") : L("\(total)개 중 \(done)개 끝냈어요, \(total - done)개 남았어요"))
    }
}

struct ProgressDonut: View {
    let fraction: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle().stroke(PaperTheme.rule, lineWidth: 3.5)
            Circle().trim(from: 0, to: max(0, min(1, fraction)))
                .stroke(PaperTheme.sage, style: StrokeStyle(lineWidth: 3.5, lineCap: .butt))
                .rotationEffect(.degrees(-90))
        }
        .padding(1.75)
        .animation(Motion.animation(.draw, reduce: reduceMotion), value: fraction)
        .accessibilityHidden(true)
    }
}

/// Reports a control's frame in window content coordinates (top-left origin).
struct ToolbarControlFrame: View {
    var body: some View {
        GeometryReader { geometry in
            Color.clear.preference(key: ToolbarControlFramesKey.self, value: [geometry.frame(in: .global)])
        }
    }
}

private struct TabFramesKey: PreferenceKey {
    static let defaultValue: [AppModel.Page: CGRect] = [:]
    static func reduce(value: inout [AppModel.Page: CGRect], nextValue: () -> [AppModel.Page: CGRect]) {
        value.merge(nextValue()) { $1 }
    }
}

/// The tab row's narrowest variant is the one showing.
private struct HeaderSmallKey: PreferenceKey {
    static let defaultValue = false
    static func reduce(value: inout Bool, nextValue: () -> Bool) { value = value || nextValue() }
}

struct ToolbarControlFramesKey: PreferenceKey {
    static let defaultValue: [CGRect] = []
    static func reduce(value: inout [CGRect], nextValue: () -> [CGRect]) { value += nextValue() }
}

private extension Int {
    var nonZero: Int? { self == 0 ? nil : self }
}

/// A paper tab: rounded top corners, a solid colour with a 1 pt edge (1.45, no stripes), the handwritten
/// name and a small count, both in `tabInk`. The active one stands 2 pt taller and joins the sheet through the band under the row;
/// the others sit a little lower. Tabs never overlap, so each one's outline shows whole.
struct IndexTab: View {
    let title: String
    let count: Int?
    let color: Color
    let edge: Color
    let font: NotebookFont
    let active: Bool
    /// A task is being dragged over this tab.
    var targeted = false
    /// Narrow windows: a little less padding…
    var tight = false
    /// …and at the narrowest, smaller labels.
    var small = false
    /// Snapshots: drawn as if the pointer were on it.
    var previewHover = false
    let action: () -> Void
    @State private var pointerOn = false
    private var hovering: Bool { pointerOn || previewHover }
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The tab's handwritten label; English and Dutch words are longer, so a little smaller.
    static var handwritingSize: CGFloat { AppLanguage.current == .ko ? 19 : 16 }

    static func color(_ page: AppModel.Page) -> Color {
        switch page {
        case .todos: PaperTheme.tabToday
        case .ahead: PaperTheme.tabAhead
        }
    }

    /// The tab's 1 pt edge, a step deeper than its colour (lighter at night).
    static func edge(_ page: AppModel.Page) -> Color {
        switch page {
        case .todos: PaperTheme.tabTodayEdge
        case .ahead: PaperTheme.tabAheadEdge
        }
    }

    private var height: CGFloat { active || targeted ? 30 : hovering ? 29 : 28 }

    var body: some View {
        Button(action: action) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(font == .clean ? title : title.handwritten)
                    .font(font == .clean ? .system(size: small ? 11.5 : 13, weight: active ? .semibold : .regular)
                          : Font(HandwritingFont.native(face: font == .brush ? .brush : .pen, size: small ? Self.handwritingSize - 3 : Self.handwritingSize)))
                    .foregroundStyle(PaperTheme.tabInk)
                    .lineLimit(1)
                    .fixedSize()
                if let count {
                    Text("\(count)")
                        .font(.system(size: 10, weight: .semibold).monospacedDigit())
                        .foregroundStyle(PaperTheme.tabInk)
                        .fixedSize()
                }
            }
            .padding(.horizontal, small ? 6 : tight ? 9 : 12)
            .frame(height: height)
            .background {
                WashiTabShape()
                    .fill(color)
                    .overlay {
                        // The 1 pt edge, inside the tab (left, top, right; open at the bottom where it meets the band).
                        WashiTabShape(inset: targeted ? 0.75 : 0.5)
                            .stroke(targeted ? PaperTheme.sage : contrast == .increased ? PaperTheme.ink3 : edge,
                                    lineWidth: targeted ? 1.5 : 1)
                    }
                    .brightness(active ? 0 : hovering ? -0.01 : -0.025)
            }
            .contentShape(WashiTabShape())
        }
        .buttonStyle(.plain)
        .onHover { pointerOn = $0 }
        .animation(Motion.animation(.quick, reduce: reduceMotion), value: hovering)
        .animation(Motion.animation(.quick, reduce: reduceMotion), value: targeted)
        .animation(Motion.animation(.quick, reduce: reduceMotion), value: active)
        .help(active ? title : L("\(title)(으)로"))
        .accessibilityLabel(count.map { L("\(title), \($0)개") } ?? title)
        .accessibilityAddTraits(active ? [.isSelected, .isButton] : .isButton)
    }
}

/// A tab with rounded top corners (radius 8), open at the bottom where it meets the sheet. `inset` draws it that much
/// inside the frame (on the left, top and right), so a stroke along it stays inside the tab.
struct WashiTabShape: Shape {
    var inset: CGFloat = 0

    func path(in frame: CGRect) -> Path {
        let rect = CGRect(x: frame.minX + inset, y: frame.minY + inset, width: max(0, frame.width - inset * 2), height: max(0, frame.height - inset))
        let radius = min(8, rect.height / 2, rect.width / 2)
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
        path.addArc(center: CGPoint(x: rect.minX + radius, y: rect.minY + radius), radius: radius,
                    startAngle: .degrees(180), endAngle: .degrees(270), clockwise: false)
        path.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
        path.addArc(center: CGPoint(x: rect.maxX - radius, y: rect.minY + radius), radius: radius,
                    startAngle: .degrees(270), endAngle: .degrees(0), clockwise: false)
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        return path
    }
}
