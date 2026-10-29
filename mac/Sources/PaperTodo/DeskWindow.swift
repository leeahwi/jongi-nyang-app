import AppKit
import Combine
import PaperCore
import SwiftUI

/// 책상 (Desk): what used to be five windows — 달력, 완료 기록, 설정 (its tabs), 도움말 — as panes of one
/// window with a sidebar. 보기: 달력 · 완료 기록 · 시계; 설정: 꾸미기 · 알림 · 반복 · 종이냥 · 일정 ·
/// 저장과 백업 · 메모 서랍 · 스페이스 · AI 연결; 도움: 도움말 (and 사용 안내, which opens the guide over the note).
enum DeskPane: String, CaseIterable, Identifiable {
    case calendar, history, clock, appearance, notifications, repeating, pet, events, storage, drawer, spaces, ai, help

    var id: String { rawValue }

    enum Section: CaseIterable {
        case view, settings, help

        var title: String {
            switch self {
            case .view: String(localized: "보기", table: "Desk")
            case .settings: String(localized: "설정", table: "Desk")
            case .help: String(localized: "도움", table: "Desk")
            }
        }

        var panes: [DeskPane] { DeskPane.allCases.filter { $0.section == self } }
    }

    var section: Section {
        switch self {
        case .calendar, .history, .clock: .view
        case .appearance, .notifications, .repeating, .pet, .events, .storage, .drawer, .spaces, .ai: .settings
        case .help: .help
        }
    }

    var title: String {
        switch self {
        case .calendar: L("달력")
        case .history: L("완료 기록")
        case .clock: L("시계")
        case .appearance: L("꾸미기")
        // "알림" alone is one reminder elsewhere; here it's the pane of reminders.
        case .notifications: String(localized: "알림", table: "Desk")
        case .repeating: L("반복")
        // The pane for the desktop cat and its talk (not the app's name).
        case .pet: String(localized: "종이냥", table: "Desk")
        case .events: L("일정")
        case .storage: L("저장과 백업")
        case .drawer: L("메모 서랍")
        // 할 일 스페이스 (1.45).
        case .spaces: L("스페이스")
        case .ai: L("AI 연결")
        case .help: L("도움말")
        }
    }

    /// One line icon per pane (SF Symbols, regular): the same shapes as the Windows desk (docs/icons.md).
    var symbol: String {
        switch self {
        case .calendar: "calendar"
        case .history: "leaf"
        case .clock: "alarm"
        case .appearance: "paintbrush"
        case .notifications: "bell"
        case .repeating: "repeat"
        // The cat is 종이냥 (the pet); the paw is the memo drawer.
        case .pet: "cat"
        case .events: "calendar.badge.clock"
        case .storage: "archivebox"
        // The drawer's handle is a cat's paw bookmark (the Windows desk draws the same).
        case .drawer: "pawprint"
        case .spaces: "square.stack"
        case .ai: "bubble.left"
        case .help: "questionmark.circle"
        }
    }

    /// The pane header's line under the title (the calendar's header is its toolbar instead, and
    /// the history's says how it's going).
    var subtitle: String? {
        switch self {
        case .calendar, .history: nil
        case .clock: L("알람을 맞추고, 뽀모도로 시간과 소리를 정해 바로 시작해요.")
        case .appearance: L("언어와 종이 색, 글꼴과 글자 크기를 정해요.")
        case .notifications: L("주기 알림과 알림 모양을 정하고, 미리보기로 확인해요.")
        case .repeating: L("반복하는 날마다 목록에 한 줄씩 놓여요.")
        case .pet: L("종이냥을 보이거나 숨기고, 돌아다닐지, 말을 걸지 정해요.")
        case .events: L("일정을 적어 두면 오늘 할 일 위에 보이고, 시작 전에 알려 줘요.")
        case .storage: L("할 일과 기록이 저장되는 곳, 다른 컴퓨터로 옮기는 백업이에요.")
        case .drawer: L("화면 끝에서 메모를 꺼내 보고, 바로 적고, 그 자리에서 고쳐요.")
        case .spaces: L("할 일에 색을 붙여 나눠요. 오늘 한 장은 그대로예요.")
        case .ai: L("Claude와 이야기하면서 할 일과 일정을 보고, 넣고, 고쳐요.")
        case .help: L("궁금한 걸 찾아보세요")
        }
    }

    /// The tint behind the row icons of a settings pane, and (#30) behind the pane's icon in the sidebar, so the colour
    /// says which pane a row belongs to (the Windows desk uses the same tiles).
    var tint: Color {
        switch self {
        case .appearance: PaperTheme.tintToday
        case .notifications: PaperTheme.tintAhead
        case .repeating, .calendar, .history, .help, .drawer, .spaces: PaperTheme.sage2
        case .pet: PaperTheme.tabMemo
        case .clock: PaperTheme.clay2
        case .events: PaperTheme.eventTint
        case .storage: PaperTheme.paper2
        case .ai: PaperTheme.tintAhead
        }
    }

    /// ⌘1…⌘9 inside the desk: the first nine panes in sidebar order, 달력 to 저장과 백업 (메모 서랍, 스페이스 and AI 연결
    /// after it have none, as on Windows; 도움말 is ⌘?).
    var shortcut: Int? {
        let index = Self.allCases.firstIndex(of: self)!
        return index < 9 ? index + 1 : nil
    }

    /// The title bar: the pane's own name, nothing joined to it ("알림", not "책상 — 알림") (#73).
    var windowTitle: String { title }
}

/// Which pane is open (the app moves it from menus, the note, the 오늘 창 …).
@MainActor
final class DeskState: ObservableObject {
    @Published var pane: DeskPane

    init(pane: DeskPane = .calendar) { self.pane = pane }
}

enum DeskMetrics {
    static let sidebar: CGFloat = 184
    /// Below 820 pt the sidebar folds to its icons.
    static let compactSidebar: CGFloat = 64
    static let compactBelow: CGFloat = 820
    static let size = NSSize(width: 920, height: 640)
    static let minimum = NSSize(width: 760, height: 520)
    /// The settings panes' readable column, their side margin and the space under the title bar.
    static let column: CGFloat = 640
    static let gutter: CGFloat = 28
    static let top: CGFloat = 10
}

/// The one desk window: opens on a pane, or brings the open one forward and switches its pane.
@MainActor
final class DeskWindowController: NSObject, NSWindowDelegate {
    let state = DeskState()
    private let model: AppModel
    private let archive: ArchiveStore
    private let reminders: ReminderController
    /// 도움 → 사용 안내: the guide over the note.
    var onGuide: () -> Void = {}
    private var window: DeskWindow?
    private var subscriptions = Set<AnyCancellable>()
    /// Test and preview runs don't keep the window's place.
    private let remembersFrame: Bool
    /// `--offscreen` (the performance check): the desk far off every screen, out of the user's way (#62, #64).
    var offscreen = false

    init(model: AppModel, archive: ArchiveStore, reminders: ReminderController, remembersFrame: Bool = true) {
        self.model = model
        self.archive = archive
        self.reminders = reminders
        self.remembersFrame = remembersFrame
        super.init()
        // 완료 기록 follows the model only while the desk is open (#62).
        archive.paused = true
    }

    /// The desk is what the person is looking at: the key window, or (no key window, say while
    /// the app isn't active) the frontmost of the app's windows.
    var isKey: Bool {
        guard let window, window.isVisible else { return false }
        if window.isKeyWindow { return true }
        return NSApp.keyWindow == nil && NSApp.orderedWindows.first { $0.isVisible && !($0 is NSPanel) } === window
    }

    func show(_ pane: DeskPane) {
        PerfProbe.begin("desk")
        state.pane = pane
        archive.paused = false
        let window = window ?? makeWindow()
        window.level = model.window?.level ?? .normal
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// ⌘1…⌘9 while the desk is in front.
    func select(shortcut number: Int) {
        guard let pane = DeskPane.allCases.first(where: { $0.shortcut == number }) else { return }
        state.pane = pane
    }

    private func makeWindow() -> DeskWindow {
        let window = DeskWindow(contentRect: NSRect(origin: .zero, size: DeskMetrics.size),
                                styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                                backing: .buffered, defer: false)
        window.titlebarAppearsTransparent = true
        window.titlebarSeparatorStyle = .none
        window.isReleasedWhenClosed = false
        // The paper itself, day or night, so nothing white shows while the window opens or grows.
        window.backgroundColor = NSColor(PaperTheme.paper)
        window.contentMinSize = DeskMetrics.minimum
        window.collectionBehavior = [.fullScreenPrimary]
        window.onShortcut = { [weak self] number in self?.select(shortcut: number) }
        let view = DeskView(state: state, model: model, archive: archive, reminders: reminders,
                            onGuide: { [weak self] in self?.onGuide() })
        let hosting = NSHostingView(rootView: view)
        // The window keeps its own size (920 × 640 at first, then what the person chose); the
        // panes fit themselves to it rather than the window to the panes.
        hosting.sizingOptions = []
        window.contentView = hosting
        window.setContentSize(DeskMetrics.size)
        window.center()
        if remembersFrame { window.setFrameAutosaveName("PaperTodoDesk") }
        if offscreen {
            window.keepsOffscreen = true
            window.setFrameOrigin(NSPoint(x: -40_000, y: 200))
        }
        window.delegate = self
        state.$pane.sink { [weak window] pane in window?.title = pane.windowTitle }.store(in: &subscriptions)
        self.window = window
        return window
    }

    func windowWillClose(_ notification: Notification) {
        // A field being typed in (an alarm's name, a repeat's title) keeps what was typed.
        window?.makeFirstResponder(nil)
        // The closed desk keeps its view: 완료 기록 stops following the model until it opens again (#62).
        archive.paused = true
    }
}

/// The desk's window: ⌘1…⌘9 pick a pane (before the menu's ⌘1–⌘3 for the note's tabs).
final class DeskWindow: NSWindow {
    var onShortcut: (Int) -> Void = { _ in }
    /// `--offscreen`: kept where it was put (a titled window is pulled back onto a screen as it comes up).
    var keepsOffscreen = false

    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        keepsOffscreen ? frameRect : super.constrainFrameRect(frameRect, to: screen)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.type == .keyDown, event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command,
           let characters = event.charactersIgnoringModifiers, let number = Int(characters), (1...9).contains(number) {
            onShortcut(number)
            return true
        }
        return super.performKeyEquivalent(with: event)
    }
}

// MARK: - The view

struct DeskView: View {
    @ObservedObject var state: DeskState
    /// Not watched here: each pane watches what it shows (#62 — every change to the model built the open pane anew,
    /// 완료 기록 too, even with the desk closed).
    let model: AppModel
    let archive: ArchiveStore
    let reminders: ReminderController
    var onGuide: () -> Void = {}
    /// Snapshots: a stand-in for the window's title bar (traffic lights and the title), since a
    /// snapshot draws only the content.
    var previewTitlebar = false
    /// Snapshots: an alarm open for editing on 시계.
    var previewAlarmEditing: String?
    /// Snapshots: 도움말 on a topic or a search.
    var previewHelp: (topic: String, query: String)?
    /// Snapshots: the calendar on its week.
    var previewCalendarWeek = false
    @State private var width: CGFloat = DeskMetrics.size.width

    private var compact: Bool { width < DeskMetrics.compactBelow }
    private var titlebarInset: CGFloat { previewTitlebar ? 28 : 0 }

    var body: some View {
        HStack(spacing: 0) {
            // 1.42: eleven panes (twelve since 1.43.1): in a short window the rows sit closer, and in a very short one the sidebar scrolls.
            ViewThatFits(in: .vertical) {
                DeskSidebar(state: state, compact: compact, onGuide: onGuide, onSearch: { model.onSearch?() })
                DeskSidebar(state: state, compact: compact, tight: true, onGuide: onGuide, onSearch: { model.onSearch?() })
                ScrollView { DeskSidebar(state: state, compact: compact, tight: true, onGuide: onGuide, onSearch: { model.onSearch?() }).padding(.bottom, 10) }
                    .scrollIndicators(.never)
            }
                .padding(.top, titlebarInset)
                .frame(width: compact ? DeskMetrics.compactSidebar : DeskMetrics.sidebar)
                .frame(maxHeight: .infinity, alignment: .top)
                .background(PaperTheme.paper2.ignoresSafeArea())
            Rectangle().fill(PaperTheme.rule).frame(width: 1).ignoresSafeArea()
            pane
                .id(state.pane)
                .padding(.top, titlebarInset)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(PaperBackground())
        }
        .overlay(alignment: .top) {
            if previewTitlebar { TitlebarStandIn(title: state.pane.windowTitle) }
        }
        .foregroundStyle(PaperTheme.ink)
        .environment(\.locale, AppLanguage.current.locale)
        .environment(\.openHelpTopic, { [state] topic in
            HelpView.requestedTopic = topic
            state.pane = .help
        })
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
    }

    @ViewBuilder
    private var pane: some View {
        switch state.pane {
        case .calendar:
            if previewCalendarWeek { CalendarWindowView(model: model, today: CalendarDraft.day(Date()), mode: .week) } else { CalendarWindowView(model: model) }
        case .history: HistoryView(archive: archive, model: model)
        case .help:
            if let previewHelp { HelpView(topic: previewHelp.topic, query: previewHelp.query) } else { HelpView() }
        default: SettingsPaneView(controller: reminders, model: model, pane: state.pane, alarmEditing: previewAlarmEditing)
        }
    }
}

/// The sidebar: three small headings, the panes under them, ↑/↓ to move, ⌘1…⌘9 from anywhere in
/// the desk. Narrow windows fold it to its icons (the names come up on hover).
struct DeskSidebar: View {
    @ObservedObject var state: DeskState
    let compact: Bool
    /// A short window (1.42): rows 26 pt instead of 30, less space between the groups.
    var tight = false
    var onGuide: () -> Void = {}
    /// 1.38: 검색 at the top (the same slip as ⌘F in the note).
    var onSearch: (() -> Void)?
    @FocusState private var focused: Bool

    private var rowHeight: CGFloat { tight ? 26 : 30 }

    var body: some View {
        VStack(alignment: compact ? .center : .leading, spacing: 2) {
            if let onSearch {
                DeskSidebarRow(title: L("검색"), symbol: "magnifyingglass", selected: false, compact: compact, shortcut: "⌘F", height: rowHeight, action: onSearch)
                    .padding(.bottom, compact || tight ? 4 : 8)
            }
            ForEach(DeskPane.Section.allCases, id: \.self) { section in
                if compact {
                    if section != .view { Rectangle().fill(PaperTheme.rule).frame(width: 28, height: 1).padding(.vertical, tight ? 5 : 8) }
                } else {
                    Text(section.title)
                        .font(.system(size: 10.5, weight: .semibold))
                        .tracking(0.6)
                        .foregroundStyle(PaperTheme.ink3)
                        .lineLimit(1)
                        .padding(.horizontal, 10)
                        .padding(.top, section == .view ? 0 : tight ? 7 : 12)
                        .padding(.bottom, 3)
                        .accessibilityAddTraits(.isHeader)
                }
                ForEach(section.panes) { pane in
                    DeskSidebarRow(title: pane.title, symbol: pane.symbol, selected: state.pane == pane, compact: compact,
                                   shortcut: pane.shortcut.map { "⌘\($0)" } ?? (pane == .help ? "⌘?" : nil), height: rowHeight, tint: pane.tint) {
                        state.pane = pane
                    }
                }
                if section == .help {
                    DeskSidebarRow(title: L("사용 안내"), symbol: "sparkles", selected: false, compact: compact, shortcut: nil, height: rowHeight, action: onGuide)
                }
            }
        }
        .padding(.horizontal, compact ? 8 : 10)
        .padding(.top, tight ? 8 : 12)
        .frame(maxWidth: .infinity, alignment: compact ? .center : .leading)
        .focusable()
        .focusEffectDisabled()
        .focused($focused)
        .onKeyPress(keys: [.upArrow, .downArrow]) { press in
            let all = DeskPane.allCases
            let index = all.firstIndex(of: state.pane)!
            let next = press.key == .upArrow ? max(0, index - 1) : min(all.count - 1, index + 1)
            state.pane = all[next]
            return .handled
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("책상"))
    }
}

private struct DeskSidebarRow: View {
    let title: String
    let symbol: String
    let selected: Bool
    let compact: Bool
    let shortcut: String?
    var height: CGFloat = 30
    /// A pane's tile colour (its rows' tiles have the same), behind the icon only while the pane is chosen (#55 D-1:
    /// plain icons elsewhere, like 검색 and 사용 안내 — the one tinted row says where you are; same as Windows).
    var tint: Color?
    let action: () -> Void
    @State private var hovering = false

    private var tiled: Bool { tint != nil && selected }

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Image(systemName: symbol)
                    .font(.system(size: tiled ? 11.5 : 13, weight: .regular))
                    .foregroundStyle(selected ? PaperTheme.ink : PaperTheme.ink2)
                    .frame(width: 22, height: 22)
                    .background {
                        if let tint, selected {
                            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(tint)
                                .overlay { RoundedRectangle(cornerRadius: 6, style: .continuous).stroke(PaperTheme.rule, lineWidth: 0.5) }
                        }
                    }
                if !compact {
                    Text(title)
                        .font(.system(size: 12.5, weight: selected ? .semibold : .regular))
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                    Spacer(minLength: 0)
                }
            }
            .foregroundStyle(selected ? PaperTheme.ink : PaperTheme.ink2)
            .padding(.horizontal, compact ? 0 : 9)
            .frame(width: compact ? 40 : nil, height: height)
            .frame(maxWidth: compact ? nil : .infinity, alignment: .leading)
            .background {
                if selected {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(PaperTheme.raised)
                        .shadow(color: PaperTheme.shadow.opacity(0.10), radius: 1.5, y: 1)
                } else if hovering {
                    RoundedRectangle(cornerRadius: 8, style: .continuous).fill(PaperTheme.sage.opacity(0.07))
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(shortcut.map { "\(title) (\($0))" } ?? title)
        .accessibilityLabel(title)
        .accessibilityAddTraits(selected ? [.isSelected, .isButton] : .isButton)
    }
}

/// A pane's header: the name in 22 pt, a line under it in ink2, controls on the right, and on
/// 꾸미기 and 도움말 one small cat.
struct DeskPaneHeader<Trailing: View>: View {
    let title: String
    var subtitle: String?
    var cat: PetArt.Pose?
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 22, weight: .semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                    .accessibilityAddTraits(.isHeader)
                if let subtitle {
                    Text(subtitle.keepingParticles)
                        .font(.system(size: 12))
                        .foregroundStyle(PaperTheme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            trailing
            if let cat {
                Image(nsImage: PetArt.image(cat) ?? PaperTheme.mascot)
                    .resizable().scaledToFit()
                    .frame(width: 56, height: 56)
                    .accessibilityHidden(true)
            }
        }
    }
}

extension DeskPaneHeader where Trailing == EmptyView {
    init(title: String, subtitle: String? = nil, cat: PetArt.Pose? = nil) {
        self.init(title: title, subtitle: subtitle, cat: cat) { EmptyView() }
    }
}

/// Snapshots only: the title bar the window draws over the desk (traffic lights, the title).
private struct TitlebarStandIn: View {
    let title: String

    var body: some View {
        ZStack {
            Text(title)
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PaperTheme.ink2)
                .lineLimit(1)
            HStack(spacing: 8) {
                ForEach(["#ff5f57", "#febc2e", "#28c840"], id: \.self) { hex in
                    Circle().fill(Color(hex: hex)!).frame(width: 12, height: 12)
                        .overlay { Circle().strokeBorder(.black.opacity(0.12), lineWidth: 0.5) }
                }
                Spacer()
            }
            .padding(.leading, 12)
        }
        .frame(height: 28)
        .accessibilityHidden(true)
    }
}
