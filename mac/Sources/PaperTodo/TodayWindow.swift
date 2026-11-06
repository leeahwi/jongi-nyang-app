import AppKit
import Combine
import PaperCore
import SwiftUI

/// Settings → 꾸미기 → 메뉴 막대에 글자: 자동 (a running timer, or what starts within the hour)
/// or 숨기기 (the cat face only).
enum MenuBarTextMode: String, CaseIterable, Identifiable {
    case auto, hide
    var id: String { rawValue }
}

/// The menu bar's small cat face: a template image, so it follows a light or dark menu bar.
enum CatFaceIcon {
    /// `progress` (1.38): while a timer or a focus runs, a thin ring around a smaller face — the part gone
    /// by drawn solid from the top, clockwise; the rest faint.
    static func image(size: CGFloat = 18, progress: Double? = nil) -> NSImage {
        let image = NSImage(size: NSSize(width: size, height: size), flipped: true) { rect in
            let ringed = progress != nil
            if let progress {
                let center = NSPoint(x: rect.midX, y: rect.midY)
                let radius = rect.width / 2 - 1
                let track = NSBezierPath(ovalIn: rect.insetBy(dx: 1, dy: 1))
                track.lineWidth = 1.3
                NSColor.black.withAlphaComponent(0.3).setStroke()
                track.stroke()
                let arc = NSBezierPath()
                let end = -90 + 360 * min(1, max(0, progress))
                arc.appendArc(withCenter: center, radius: radius, startAngle: -90, endAngle: CGFloat(end), clockwise: false)
                arc.lineWidth = 1.8
                arc.lineCapStyle = .round
                NSColor.black.setStroke()
                if progress > 0.005 { arc.stroke() }
            }
            // With the ring, the face shrinks to fit inside it.
            let faceScale: CGFloat = ringed ? 0.62 : 1
            let offset = rect.width * (1 - faceScale) / 2
            let s = rect.width / 18 * faceScale
            func p(_ x: CGFloat, _ y: CGFloat) -> NSPoint { NSPoint(x: offset + x * s, y: offset + y * s) }
            // Ears, then the round head, each filled on its own (overlapping paths would cancel out).
            let left = NSBezierPath(), right = NSBezierPath()
            left.move(to: p(2.2, 9)); left.line(to: p(3.4, 1.8)); left.line(to: p(8, 5.2)); left.close()
            right.move(to: p(15.8, 9)); right.line(to: p(14.6, 1.8)); right.line(to: p(10, 5.2)); right.close()
            NSColor.black.setFill()
            for part in [left, right, NSBezierPath(ovalIn: NSRect(x: offset + 1.6 * s, y: offset + 4 * s, width: 14.8 * s, height: 12.2 * s))] {
                part.lineJoinStyle = .round
                part.fill()
            }
            // Eyes and a nose, cut out.
            NSGraphicsContext.current?.compositingOperation = .destinationOut
            NSBezierPath(ovalIn: NSRect(x: offset + 5.2 * s, y: offset + 8.6 * s, width: 1.9 * s, height: 2.5 * s)).fill()
            NSBezierPath(ovalIn: NSRect(x: offset + 10.9 * s, y: offset + 8.6 * s, width: 1.9 * s, height: 2.5 * s)).fill()
            let nose = NSBezierPath()
            nose.move(to: p(8.1, 12)); nose.line(to: p(9.9, 12)); nose.line(to: p(9, 13.2)); nose.close()
            nose.fill()
            return true
        }
        image.isTemplate = true
        image.accessibilityDescription = L("종이냥")
        return image
    }
}

/// What the menu bar item says right now.
@MainActor
struct MenuBarState: Equatable {
    var text: String
    var accessibility: String
    /// A running (or paused) timer's part gone by, for the ring around the face.
    var progress: Double? = nil

    /// `focusing`: 집중 on a to-do — the time gets a small mark ("● 21분"). A paused timer has no words.
    static func current(model: AppModel, timer: FocusTimer?, focusing: Bool = false, now: Date = Date()) -> MenuBarState {
        let soon = TodayWindowView.soon(model: model, now: now)
        let remaining = timer.flatMap { $0.isPaused ? nil : $0.remaining(at: now) }
        let language = AppLanguage.current
        var text = model.menuBarText == .hide ? "" : TodayGlance.menuBarText(timerRemaining: remaining, soon: soon, language: language)
        if focusing, let remaining, model.menuBarText != .hide { text = Focus.menuBarText(remaining: remaining, language: language) }
        // VoiceOver and the tooltip still name a paused timer's time.
        let accessibility = TodayGlance.accessibilityText(appName: PaperTheme.mascotName, timerRemaining: timer.map { $0.remaining(at: now) }, soon: soon,
                                                          openTasks: model.hereRemainingCount, language: language)
        let progress = timer.map { $0.duration > 0 ? 1 - $0.remaining(at: now) / $0.duration : 1 }
        return MenuBarState(text: text, accessibility: accessibility, progress: progress)
    }

    /// The status item's button (and the snapshots' stand-in): the cat face and, when there is
    /// something to say, the words beside it in tabular digits.
    func apply(to button: NSButton) {
        button.image = CatFaceIcon.image(progress: progress)
        button.imagePosition = text.isEmpty ? .imageOnly : .imageLeading
        button.font = NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
        button.title = text.isEmpty ? "" : " " + text
        button.toolTip = accessibility
        button.setAccessibilityLabel(accessibility)
    }
}

/// The menu bar item and its 오늘 창: a cat face that speaks only when something is near (a
/// running timer's time, or "치과 40분"); a click drops the 오늘 창 below it (cards for the next
/// event, the timer and the next alarm, 다음 and a few of today's tasks, the input line); a
/// right-click shows a short menu.
///
/// The 오늘 창 is a borderless, non-activating paper slip rather than an NSPopover, so the input
/// line takes typing without bringing the note forward, and the paper reaches every edge.
@MainActor
final class TodayWindowController: NSObject {
    private let model: AppModel
    private let timer: FocusTimerState
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var panel: TodayPanel?
    private var monitors: [Any] = []
    private var ticker: Timer?
    private var tickEverySecond = false
    private var shown: MenuBarState?
    private var subscriptions = Set<AnyCancellable>()
    private var focus = 0
    var onOpenNote: () -> Void = {}
    var onCalendar: () -> Void = {}
    var onQuickEntry: () -> Void = {}
    var onSettings: () -> Void = {}
    var timerMenu: () -> NSMenu = { NSMenu() }
    /// #230: 전체 화면에서 보이기 (in all apps), so the small cat can be put away from a full-screen app.
    var companionMenuItem: () -> NSMenuItem? = { nil }
    /// Told whenever the item is brought up to date (the folded icon's summary follows it).
    var onUpdate: () -> Void = {}

    var isShown: Bool { panel?.isVisible == true }

    init(model: AppModel, timer: FocusTimerState) {
        self.model = model
        self.timer = timer
        super.init()
        // #217: a check's run puts nothing in the person's menu bar.
        if TestHooks.staysBehind { statusItem.isVisible = false }
        if let button = statusItem.button {
            button.target = self
            button.action = #selector(clicked)
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
        }
        update()
        model.objectWillChange.sink { [weak self] _ in
            DispatchQueue.main.async { self?.update() }
        }.store(in: &subscriptions)
        timer.$timer.sink { [weak self] _ in
            DispatchQueue.main.async { self?.update() }
        }.store(in: &subscriptions)
        model.calendar.objectWillChange.sink { [weak self] _ in
            DispatchQueue.main.async { self?.update() }
        }.store(in: &subscriptions)
    }

    /// The words and the label; ticks every second while a timer runs, else twice a minute.
    func update() {
        let state = MenuBarState.current(model: model, timer: timer.timer, focusing: timer.isFocusing)
        // #64: the half-minute tick (and every model change) mostly finds the same words: no new face, no redraw then.
        if state != shown, let button = statusItem.button {
            state.apply(to: button)
            shown = state
        }
        let everySecond = timer.timer.map { !$0.isPaused } ?? false
        if ticker == nil || everySecond != tickEverySecond {
            ticker?.invalidate()
            tickEverySecond = everySecond
            let next = Timer(timeInterval: everySecond ? 1 : 30, repeats: true) { _ in
                Task { @MainActor [weak self] in self?.update() }
            }
            next.tolerance = everySecond ? 0.1 : 5
            RunLoop.main.add(next, forMode: .common)
            ticker = next
        }
        onUpdate()
    }

    @objc private func clicked() {
        let event = NSApp.currentEvent
        if event?.type == .rightMouseUp || event?.modifierFlags.contains(.control) == true {
            close()
            showMenu()
        } else {
            isShown ? close() : show()
        }
    }

    // MARK: The 오늘 창

    func show() {
        guard let button = statusItem.button, let buttonWindow = button.window else { return }
        let panel = panel ?? makePanel()
        focus += 1
        let itemFrame = buttonWindow.convertToScreen(button.convert(button.bounds, to: nil))
        // #200: the to-do rows follow the room under the menu bar on the item's screen (TodayGlance.rowCap).
        let screen = NSScreen.screens.first { $0.frame.contains(NSPoint(x: itemFrame.midX, y: itemFrame.midY)) } ?? NSScreen.main
        panel.show(TodayWindowView(model: model, timer: timer, alarms: model.alarms, calendar: model.calendar, focus: focus,
                                   rowRoom: screen.map { Double($0.visibleFrame.height) },
                                   onOpenNote: { [weak self] in self?.close(); self?.onOpenNote() },
                                   onCalendar: { [weak self] in self?.close(); self?.onCalendar() },
                                   onReveal: { [weak self] id in self?.close(); self?.model.reveal(id) }))
        panel.placeSlip(topCenter: NSPoint(x: itemFrame.midX, y: itemFrame.minY - 4))
        panel.makeKeyAndOrderFront(nil)
        button.highlight(true)
        // A click anywhere else closes it, like a popover.
        monitors.forEach(NSEvent.removeMonitor)
        monitors = []
        if let global = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] _ in
            let location = NSEvent.mouseLocation
            Task { @MainActor in
                // A click on the item itself toggles it (see clicked), wherever the menu bar's windows live.
                guard let self, !self.itemFrame.contains(location) else { return }
                self.close()
            }
        }) { monitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { [weak self] event in
            if let self, event.window !== self.panel, event.window !== self.statusItem.button?.window { self.close() }
            return event
        }) { monitors.append(local) }
    }

    /// The item on screen.
    private var itemFrame: NSRect {
        guard let button = statusItem.button, let window = button.window else { return .zero }
        return window.convertToScreen(button.convert(button.bounds, to: nil))
    }

    func close() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors = []
        statusItem.button?.highlight(false)
        guard let panel, panel.isVisible else { return }
        panel.orderOut(nil)
    }

    private func makePanel() -> TodayPanel {
        let panel = TodayPanel(nonactivating: true)
        panel.title = L("오늘 창")
        panel.level = .popUpMenu
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.onResignKey = { [weak self] in self?.close() }
        panel.onCancel = { [weak self] in self?.close() }
        self.panel = panel
        return panel
    }

    // MARK: Right-click

    private func showMenu() {
        let menu = NSMenu()
        func add(_ title: String, _ action: @escaping () -> Void) {
            let item = NSMenuItem(title: title, action: #selector(MenuAction.run), keyEquivalent: "")
            let box = MenuAction(action)
            item.target = box
            item.representedObject = box
            menu.addItem(item)
        }
        add(L("노트 열기")) { [weak self] in self?.onOpenNote() }
        add(L("빠른 입력")) { [weak self] in self?.onQuickEntry() }
        let timers = NSMenuItem(title: L("타이머"), action: nil, keyEquivalent: "")
        timers.submenu = timerMenu()
        menu.addItem(timers)
        add(L("설정…")) { [weak self] in self?.onSettings() }
        if let companion = companionMenuItem() { menu.addItem(companion) }
        menu.addItem(.separator())
        let quit = NSMenuItem(title: L("종이냥 종료"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        quit.target = NSApp
        menu.addItem(quit)
        guard let button = statusItem.button else { return }
        menu.popUp(positioning: nil, at: NSPoint(x: 0, y: button.bounds.height + 5), in: button)
    }
}

/// A menu item's closure.
private final class MenuAction: NSObject {
    let action: () -> Void
    init(_ action: @escaping () -> Void) { self.action = action }
    @objc func run() { action() }
}

/// The 오늘 창's window: Esc closes it.
final class TodayPanel: SlipPanel {
    var onCancel: () -> Void = {}
    override func cancelOperation(_ sender: Any?) { onCancel() }
}

// MARK: - The view

/// 오늘 창: the date and today's progress; the cards with something in them (다음 일정 · 타이머 · 다음 알람 — the
/// one within the hour in clay, a running timer in sage) and the empty ones as a row of chips (#200); 다음 and more of
/// today's open tasks (seven rows at most) with working checkboxes, a title opening the note on its row; the input
/// line, and links to the note, the calendar and the desktop cat.
struct TodayWindowView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var timer: FocusTimerState
    @ObservedObject var alarms: AlarmBook
    @ObservedObject var calendar: EventBook
    var focus = 0
    /// The screen's height under the menu bar, for how many to-do rows fit (`TodayGlance.rowCap`); nil: seven.
    var rowRoom: Double? = nil
    /// Snapshots: a fixed now, a toast already showing, a timer card and the first to-do drawn as if hovered.
    var now: Date?
    var previewToast: PaperToast?
    var previewTimerHover = false
    var previewRowHover = false
    var onOpenNote: () -> Void = {}
    var onCalendar: () -> Void = {}
    /// A to-do's title: the note, on its row.
    var onReveal: (UUID) -> Void = { _ in }
    @State private var toast: PaperToast?
    @State private var timerHover = false
    /// 1.38: an empty card's suggestion, put into the line below (‘타이머 25’, ‘알람 7시’).
    @State private var lineFill: String?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    static let width: CGFloat = 320

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let now = self.now ?? timeline.date
            PaperSlip(kind: .todo, width: Self.width, taped: false) {
                VStack(alignment: .leading, spacing: 10) {
                    header(now: now)
                    cards(now: now)
                    tasks(now: now)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        // The toast floats just above the line it came from, centred on it.
                        .overlay(alignment: .bottom) {
                            ZStack {
                                if let shown = toast ?? previewToast {
                                    ToastView(toast: shown) { if toast?.id == shown.id { toast = nil } }
                                        .fixedSize(horizontal: false, vertical: true)
                                        .padding(.horizontal, -2)
                                        .transition(.toast)
                                        .id(shown.id)
                                }
                            }
                            .toastMotion(shown: toast ?? previewToast != nil)
                        }
                        .zIndex(1)
                    IntentLineView(model: model, page: .todos, toast: $toast, compact: true, focusRequest: focus, prefill: $lineFill)
                    footer
                }
                .padding(12)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("오늘 창"))
    }

    // MARK: Cards

    /// What's coming within the hour (for the menu bar and the 다음 일정 card).
    static func soon(model: AppModel, now: Date) -> TodayGlance.Soon? {
        TodayGlance.soon(events: model.calendar.todayEvents(now: now), reminders: reminders(model: model), now: now)
    }

    static func reminders(model: AppModel) -> [DayRibbon.Reminder] {
        model.hereTodayItems.compactMap { item in
            guard !item.isCompleted, let at = item.reminderAt else { return nil }
            return DayRibbon.Reminder(id: item.id.uuidString, title: item.title, at: at)
        }
    }

    // MARK: Header

    /// The to-dos this window lists and counts: today's sheet. (#196, the spaces a device hides, filters them here — in
    /// this one place, so the rows and the progress agree.)
    private var dayItems: [TodoItem] { model.hereTodayItems }

    /// Today's open to-dos (and those just checked, still playing their check), from `dayItems`.
    private var openItems: [TodoItem] {
        let open = Set(model.glanceTodayItems.map(\.id))
        return dayItems.filter { open.contains($0.id) }
    }

    /// #200: the note's date and today's progress — ‘11월 3일 화요일 · 11개 중 2개 끝냈어요’ — with a thin bar under them.
    /// Every space's to-dos, whatever the lens shows (A5: the window's counts are everyone's).
    private func header(now: Date) -> some View {
        let language = AppLanguage.current
        let items = dayItems
        let done = items.filter(\.isCompleted).count
        let date = TodayGlance.headerDate(now, language: language)
        let progress = TodayGlance.progressText(total: items.count, done: done, language: language)
        return VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(date)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PaperTheme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                Spacer(minLength: 0)
                if let progress {
                    Text(progress)
                        .font(.system(size: 11, weight: .medium).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink3)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            if !items.isEmpty { GlanceProgressBar(fraction: Double(done) / Double(items.count)) }
        }
        .padding(.horizontal, 2)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(progress.map { date + ", " + $0 } ?? date)
        .accessibilityAddTraits(.isHeader)
    }

    // MARK: Cards

    private func cards(now: Date) -> some View {
        let language = AppLanguage.current
        let events = calendar.todayEvents(now: now)
        let next = events.filter { !$0.allDay && $0.start > now }.min { $0.start < $1.start }
        let alarm = alarms.next(now: now)
        let running = timer.timer
        // #200: only the cards with something in them take full size; the empty ones are chips in one row.
        let layout = TodayGlance.layout(filled: Set([next.map { _ in .event }, running.map { _ in .timer }, alarm.map { _ in .alarm }]
            .compactMap { $0 } as [TodayGlance.CardKind]))
        return VStack(alignment: .leading, spacing: 6) {
            if !layout.cards.isEmpty {
                HStack(alignment: .top, spacing: 6) {
                    ForEach(layout.cards, id: \.self) { kind in
                        switch kind {
                        case .event: if let next { eventCard(next, now: now, wide: layout.wide, language: language) }
                        case .timer: if let running { timerCard(running, now: now, wide: layout.wide, language: language) }
                        case .alarm: if let alarm { alarmCard(alarm, now: now, wide: layout.wide, language: language) }
                        }
                    }
                }
                .fixedSize(horizontal: false, vertical: true)
            }
            if !layout.chips.isEmpty {
                FlowLayout(spacing: 6, lineSpacing: 6) {
                    ForEach(layout.chips, id: \.self) { chip($0, language: language) }
                }
            }
        }
        .animation(Motion.animation(.change, reduce: reduceMotion), value: layout)
    }

    private func eventCard(_ next: CalendarEvent, now: Date, wide: Bool, language: AppLanguage) -> some View {
        let minutes = max(1, Int((next.start.timeIntervalSince(now) / 60).rounded(.up)))
        return GlanceCard(caption: L("다음 일정"), value: clock(next.start, language),
                          line: TodayGlance.eventLine(title: next.title, minutes: minutes, language: language),
                          hot: minutes <= TodayGlance.window, wide: wide,
                          accessibility: L("다음 일정") + ": " + next.title + ", " + clock(next.start, language) + ", " + DayRibbon.away(minutes, language: language)) {
            calendar.sheet = .edit(next, in: calendar)
            onOpenNote()
        }
    }

    private func timerCard(_ running: FocusTimer, now: Date, wide: Bool, language: AppLanguage) -> some View {
        // While focusing: the to-do's title under the time (focus-cases.md glance rule).
        let focusTitle = timer.isFocusing ? timer.session?.title : nil
        let line: String = {
            guard let focusTitle else {
                // A plain timer: when it ends (the caption already says 타이머).
                if running.phase == .timer && !running.isPaused {
                    return L("\(clock(now.addingTimeInterval(running.remaining(at: now)), language))에 끝나요")
                }
                return running.caption(language) + (running.isPaused ? " · " + L("멈춤") : "")
            }
            return running.isPaused ? L("멈춤") + " · " + focusTitle : focusTitle
        }()
        // #46: a length ("21분" + small "남음"), not "20:50" beside the clock times either side. No action of its own:
        // pause and stop are its two small buttons.
        return GlanceCard(caption: L("타이머"), value: TodayGlance.timerLength(running.remaining(at: now), language: language),
                          unit: TodayGlance.timerLeftWord(language), unitFirst: TodayGlance.timerLeftWordFirst(language),
                          line: line, hot: false, running: !running.isPaused, wide: wide,
                          accessibility: L("타이머") + ": " + TodayGlance.timerLeftText(running.remaining(at: now), language: language) + ", " + running.caption(language))
            .overlay(alignment: .topTrailing) {
                if timerHover || previewTimerHover { timerButtons(paused: running.isPaused) }
            }
            .onHover { timerHover = $0 }
    }

    private func alarmCard(_ alarm: (alarm: Alarm, fire: Date), now: Date, wide: Bool, language: AppLanguage) -> some View {
        GlanceCard(caption: L("다음 알람"), value: Alarm.clockText(alarm.alarm, language: language),
                   line: TodayGlance.alarmLine(fire: alarm.fire, days: alarm.alarm.days, now: now, language: language),
                   hot: alarm.fire.timeIntervalSince(now) <= TimeInterval(TodayGlance.window * 60), wide: wide,
                   accessibility: L("다음 알람") + ": " + Alarm.timeText(alarm.alarm, language: language) + ", " + Alarm.untilText(alarm.fire, now: now, language: language)) {
            // 1.38: an alarm opens 시계.
            model.showAlarmSettings()
        }
    }

    /// An empty card as a chip: none today → a new event (1.38); ‘타이머 25’ · ‘알람 7시’ into the line below.
    private func chip(_ kind: TodayGlance.CardKind, language: AppLanguage) -> some View {
        let text = TodayGlance.chipText(kind, language: language)
        let symbol: String
        let label: String
        let action: () -> Void
        switch kind {
        case .event:
            symbol = "calendar"
            label = L("다음 일정") + ": " + TodayGlance.noEvent(language)
            action = { model.newEvent(); onOpenNote() }
        case .timer:
            symbol = "timer"
            label = L("타이머") + ": " + L("없음") + ", " + text
            action = { lineFill = TodayGlance.timerWords(language) }
        case .alarm:
            symbol = "alarm"
            label = L("다음 알람") + ": " + L("없음") + ", " + text
            action = { lineFill = TodayGlance.alarmWords(language) }
        }
        return GlanceChip(symbol: symbol, text: text, accessibility: label, action: action)
    }

    private func timerButtons(paused: Bool) -> some View {
        HStack(spacing: 0) {
            Button { model.petCommand(.togglePause) } label: {
                Image(systemName: paused ? "play" : "pause").font(.system(size: 9.5, weight: .semibold)).frame(width: 20, height: 20)
            }
            .help(paused ? L("계속") : L("일시정지"))
            .accessibilityLabel(paused ? L("계속") : L("일시정지"))
            Button { model.petCommand(.stop) } label: {
                Image(systemName: "stop").font(.system(size: 9.5, weight: .semibold)).frame(width: 20, height: 20)
            }
            .help(L("중지"))
            .accessibilityLabel(L("중지"))
        }
        .buttonStyle(.plain)
        .foregroundStyle(PaperTheme.clay)
        .padding(3)
    }

    private func clock(_ date: Date, _ language: AppLanguage) -> String {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        return language.clock(hour: parts.hour!, minute: parts.minute!)
    }

    // MARK: Tasks

    @ViewBuilder
    private func tasks(now: Date) -> some View {
        // 2a (A5): the note's lens — one space's to-dos (the menu bar's words and the counts stay everyone's).
        let shown = model.spaceShown
        let items = openItems
        let open = shown == .all ? items : items.filter { shown.includes(model.spaceOf($0.id)?.id) }
        let split = TodayGroups.split(open, series: model.series, now: now)
        let byID = Dictionary(uniqueKeysWithValues: open.map { ($0.id, $0) })
        let next = split.next.compactMap { byID[$0] }
        let others = split.rest.compactMap { byID[$0] }
        // #200: seven rows at most (fewer on a short screen, never under three), 다음 counted; one left over is shown.
        let slots = TodayGlance.slots(next: next.count, others: others.count, cap: TodayGlance.rowCap(room: rowRoom))
        let rest = others.prefix(slots.rest)
        let more = others.dropFirst(slots.rest).filter { !$0.isCompleted }.count
        let first = (next.first ?? rest.first)?.id
        VStack(alignment: .leading, spacing: 0) {
            if open.isEmpty && (shown == .all || model.hiddenOpenCount(here: true) == 0) {
                // 1.38: the small cat, like every other empty sheet.
                HStack(spacing: 8) {
                    Image(nsImage: PetArt.image(dayItems.isEmpty ? .happy : .cheer) ?? PaperTheme.mascot)
                        .resizable().scaledToFit().frame(width: 30, height: 30)
                        .accessibilityHidden(true)
                    Text(dayItems.isEmpty ? L("오늘 할 일을 한 줄 적어 볼까요?") : L("오늘 한 장 끝! 수고했어요"))
                        .font(.system(size: 12))
                        .foregroundStyle(PaperTheme.ink3)
                }
                .frame(maxWidth: .infinity, minHeight: 36)
            }
            // #52 · #200: the small heads only when both groups have rows, as on the note and Windows.
            if split.showsHeaders { GlanceHeader(title: L("다음")) }
            ForEach(next) { GlanceTaskRow(item: $0, model: model, time: split.times[$0.id], previewHover: previewRowHover && $0.id == first, onReveal: onReveal) }
            if split.showsHeaders && !rest.isEmpty { GlanceHeader(title: L("그 밖에")).padding(.top, 4) }
            ForEach(Array(rest)) { GlanceTaskRow(item: $0, model: model, time: nil, previewHover: previewRowHover && $0.id == first, onReveal: onReveal) }
            if more > 0 {
                Button(action: onOpenNote) {
                    Text(L("외 \(more)개 · 노트에서 보기"))
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(PaperTheme.sage)
                        .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.leading, 2)
            }
            if shown != .all { GlanceLensLine(model: model, shown: shown) }
        }
    }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: 0) {
            footerLink(L("노트 열기"), symbol: "note.text", action: onOpenNote)
            Spacer(minLength: 6)
            footerLink(L("책상"), symbol: "sidebar.left", action: onCalendar)
            Spacer(minLength: 6)
            footerLink(model.petVisible ? L("종이냥 숨기기") : L("종이냥 보이기"), symbol: "cat") { model.petVisible.toggle() }
        }
        .padding(.horizontal, 2)
    }

    private func footerLink(_ title: String, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: symbol).font(.system(size: 10.5))
                Text(title).lineLimit(1).fixedSize()
            }
            .font(.system(size: 11.5))
            .foregroundStyle(PaperTheme.ink2)
            .frame(minHeight: 22)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(title)
    }
}

/// A card with something in it: a small caption, a big tabular value, a line under it (two lines at most). One card
/// alone (`wide`, #200) lies flat: the line beside the value. A card with an action is a button (the keyboard and
/// VoiceOver reach it); the running timer's has none — its pause and stop are buttons of their own.
private struct GlanceCard: View {
    let caption: String
    let value: String
    /// A small word beside the value: the timer's "남음" · "left" after it, or Dutch "nog" before it (#46).
    var unit: String? = nil
    var unitFirst = false
    let line: String
    /// Within the hour: clay (clay means 곧 · 늦음).
    let hot: Bool
    /// A timer that's running: sage, so it doesn't sit as a second clay card beside a soon event.
    var running = false
    var wide = false
    let accessibility: String
    var action: (() -> Void)? = nil
    @Environment(\.colorSchemeContrast) private var contrast
    @State private var lineWidth: CGFloat = 0

    private var accent: Color? { hot ? PaperTheme.clayText : running ? PaperTheme.sageText : nil }

    var body: some View {
        if let action {
            Button(action: action) { card }
                .buttonStyle(.plain)
                .accessibilityLabel(accessibility)
        } else {
            card
                .accessibilityElement(children: .contain)
                .accessibilityLabel(accessibility)
        }
    }

    private var card: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(caption)
                .font(.system(size: 9.5, weight: .semibold))
                .tracking(0.3)
                .foregroundStyle(accent ?? PaperTheme.ink3)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
            if wide {
                HStack(alignment: .firstTextBaseline, spacing: 10) {
                    valueLine(unit: unit).foregroundStyle(accent ?? PaperTheme.ink)
                    lineText
                }
            } else {
                // The small word steps aside when the card is too narrow for it (the value never gets "…").
                ViewThatFits(in: .horizontal) {
                    valueLine(unit: unit)
                    valueLine(unit: nil)
                }
                .foregroundStyle(accent ?? PaperTheme.ink)
                lineText
            }
        }
        .padding(.horizontal, wide ? 10 : 8)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(hot ? PaperTheme.clay2 : running ? PaperTheme.sage2 : PaperTheme.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(hot ? PaperTheme.clay : running ? PaperTheme.sage : contrast == .increased ? PaperTheme.ink3 : PaperTheme.rule, lineWidth: 1)
        }
        .contentShape(RoundedRectangle(cornerRadius: 10))
    }

    private var lineText: some View {
        Text(shownLine)
            .font(.system(size: 10.5).monospacedDigit())
            .foregroundStyle(PaperTheme.ink2)
            .lineLimit(2)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { lineWidth = $0 }
    }

    /// The line's first part is kept whole with its ‘ ·’ (#136). When the line doesn't fit on one line of the card, it
    /// would break inside that part or after the dot (nl ‘over 1 u 46 min ·’ / ‘Teamoverleg’, ‘· Teamoverleg’ on a line of
    /// its own) — then the two parts go on two lines from the start, without the dot (#240, 점검 3의 23).
    private var shownLine: String {
        guard lineWidth > 0, let cut = line.range(of: "\u{00A0}· ") else { return line }
        let font = NSFont.monospacedDigitSystemFont(ofSize: 10.5, weight: .regular)
        let needed = (line as NSString).size(withAttributes: [.font: font]).width
        return needed <= lineWidth ? line : String(line[..<cut.lowerBound]) + "\n" + String(line[cut.upperBound...])
    }

    private func valueLine(unit: String?) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 3) {
            if let unit, unitFirst { Text(unit).font(.system(size: 10.5, weight: .medium)) }
            Text(value)
                .font(.system(size: 17, weight: .semibold).monospacedDigit())
                .lineLimit(1)
                .minimumScaleFactor(unit == nil ? 0.75 : 1)
            if let unit, !unitFirst { Text(unit).font(.system(size: 10.5, weight: .medium)) }
        }
        .fixedSize(horizontal: unit != nil, vertical: false)
    }
}

/// #200: an empty card as a quiet chip (the slips' chip: paper-2, ink-2, a small symbol) — ‘오늘 일정 없음’,
/// ‘‘타이머 25’’, ‘‘알람 7시’’.
private struct GlanceChip: View {
    let symbol: String
    let text: String
    let accessibility: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: symbol).font(.system(size: 10.5, weight: .medium)).foregroundStyle(PaperTheme.ink3)
                Text(text).lineLimit(1).fixedSize()
            }
            .font(.system(size: 11.5, weight: .medium))
            .foregroundStyle(hovering ? PaperTheme.ink : PaperTheme.ink2)
            .padding(.leading, 8)
            .padding(.trailing, 10)
            .frame(minHeight: 26)
            .background(hovering ? PaperTheme.sage2 : PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(text)
        .accessibilityLabel(accessibility)
    }
}

/// #200: today's progress under the header — a 3 pt line, sage over the rule; its length eases (Motion.change).
private struct GlanceProgressBar: View {
    let fraction: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(PaperTheme.rule)
                Capsule().fill(PaperTheme.sage).frame(width: proxy.size.width * min(1, max(0, fraction)))
            }
        }
        .frame(height: 3)
        .animation(Motion.animation(.change, reduce: reduceMotion), value: fraction)
        .accessibilityHidden(true)
    }
}

/// 2a (A5): under the 오늘 창's to-dos while one space shows — `● 회사만`, and with hidden open to-dos
/// ` · 다른 스페이스에 N개 더 · 모두 보기` (모두 보기 lets the lens go everywhere).
private struct GlanceLensLine: View {
    @ObservedObject var model: AppModel
    let shown: SpaceLens.Shown

    var body: some View {
        let hidden = model.hiddenOpenCount(here: true)
        let name = model.spaceName(shown) ?? ""
        // One line when it fits; else the name on its own line and the rest under it (Dutch is long), never cut.
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                lens(name)
                if hidden > 0 {
                    dot
                    more(hidden)
                }
            }
            VStack(alignment: .leading, spacing: 2) {
                lens(name)
                if hidden > 0 { more(hidden).padding(.leading, 12) }
            }
        }
        .font(.system(size: 11))
        .lineLimit(1)
        .padding(.leading, 4)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, minHeight: 24, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(SpaceWords.lensLabel(name, hidden: hidden, language: .current))
    }

    private var dot: some View { Text("·").foregroundStyle(PaperTheme.ink3).accessibilityHidden(true) }

    /// `● 회사만` (일반: an empty dot).
    private func lens(_ name: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Group {
                if let space = model.todoSpaces.space(shown.lensID) {
                    SpaceDotView(space: space, size: 7)
                } else {
                    Circle().strokeBorder(PaperTheme.ink3, lineWidth: 1).frame(width: 7, height: 7)
                }
            }
            .alignmentGuide(.firstTextBaseline) { d in d[.bottom] }
            Text(SpaceWords.only(name, language: .current)).fontWeight(.semibold).foregroundStyle(PaperTheme.ink2)
        }
        .fixedSize()
    }

    /// `다른 스페이스에 N개 더 · 모두 보기`.
    private func more(_ hidden: Int) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(SpaceWords.more(hidden, language: .current)).foregroundStyle(PaperTheme.ink3)
            dot
            Button { model.showSpace(.all) } label: {
                Text(L("모두 보기")).fontWeight(.semibold).foregroundStyle(PaperTheme.ink2).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(L("모두 보기") + " (⌥⌘0)")
        }
        .fixedSize()
    }
}

private struct GlanceHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(size: 10.5, weight: .semibold))
            .tracking(0.5)
            .foregroundStyle(PaperTheme.ink3)
            .padding(.leading, 2)
            .frame(height: 18)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A task in the 오늘 창: the checkbox (with the note's pop and pencil line, 28 × 32 to press), the handwritten
/// title — pressing it opens the note on the row (#200) — and for 다음 its time.
private struct GlanceTaskRow: View {
    let item: TodoItem
    @ObservedObject var model: AppModel
    let time: Date?
    /// Snapshots: drawn as if the pointer were on it.
    var previewHover = false
    var onReveal: (UUID) -> Void = { _ in }
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var strike: CGFloat = 0
    @State private var pops = 0
    @State private var hovering = false

    private static let height: CGFloat = 32
    private var hovered: Bool { hovering || previewHover }

    var body: some View {
        HStack(spacing: 6) {
            Button {
                withAnimation(Motion.animation(.enter, reduce: reduceMotion)) { model.toggle(item.id) }
            } label: {
                ZStack {
                    RoundedRectangle(cornerRadius: 5).fill(item.isCompleted ? PaperTheme.sage : PaperTheme.card)
                    RoundedRectangle(cornerRadius: 5)
                        .strokeBorder(item.isCompleted ? PaperTheme.sage : PaperTheme.checkBorder, lineWidth: 1.5)
                    if item.isCompleted {
                        Image(systemName: "checkmark").font(.system(size: 9.5, weight: .bold)).foregroundStyle(PaperTheme.onSage)
                    }
                }
                .frame(width: 17, height: 17)
                .checkPop(pops)
                .frame(width: 28, height: Self.height)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(item.isCompleted ? L("완료 취소") : L("완료 표시"))
            .accessibilityLabel("\(item.title) 완료")
            .accessibilityValue(item.isCompleted ? L("완료됨") : L("미완료"))

            // #200: the title opens the note with this row picked.
            Button { onReveal(item.id) } label: {
                Text(item.title.handwritten)
                    .font(model.notebookFont.bodyFont(.small))
                    .foregroundStyle(item.isCompleted ? PaperTheme.ink3 : PaperTheme.ink)
                    .lineLimit(1)
                    .underline(hovered && !item.isCompleted, color: PaperTheme.ink3.opacity(0.45))
                    .overlay {
                        PencilStrike().trim(from: 0, to: strike)
                            .stroke(PaperTheme.ink.opacity(0.62), style: StrokeStyle(lineWidth: 1.25, lineCap: .round))
                            .allowsHitTesting(false)
                    }
                    .frame(maxWidth: .infinity, minHeight: Self.height, alignment: .leading)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(L("노트에서 보기"))
            .accessibilityLabel(item.title)
            .accessibilityHint(L("노트에서 보기"))
            // 1.39: a task with a time today shows its range (clock), else the reminder (bell).
            if let range = item.timeRange, TimeBlock.day(of: item, now: Date()) != nil {
                HStack(spacing: 3) {
                    Image(systemName: "clock").font(.system(size: 9.5, weight: .semibold))
                    Text(range.text(.current))
                }
                .font(.system(size: 11, weight: .medium).monospacedDigit())
                .foregroundStyle(PaperTheme.sage)
                .fixedSize()
            } else if let time {
                HStack(spacing: 3) {
                    Image(systemName: "bell").font(.system(size: 9.5, weight: .semibold))
                    Text(TaskRow.timeCaption(time, now: Date()))
                }
                .font(.system(size: 11, weight: .medium).monospacedDigit())
                .foregroundStyle(PaperTheme.sage)
                .fixedSize()
            }
        }
        .padding(.trailing, 4)
        .frame(minHeight: Self.height)
        .background(PaperTheme.sage.opacity(hovered ? 0.055 : 0), in: RoundedRectangle(cornerRadius: 4))
        .overlay(alignment: .leading) {
            // 2a (A5): the space's band at the row's left end, in the window's margin clear of the box.
            if let space = model.spaceOf(item.id) { SpaceBand(space: space, height: Self.height, faded: item.isCompleted).offset(x: -8) }
        }
        .overlay(alignment: .bottom) { Rectangle().fill(PaperTheme.rule).frame(height: 0.6).padding(.leading, 30) }
        .onHover { hovering = $0 }
        .onAppear { strike = item.isCompleted ? 1 : 0 }
        .onChange(of: item.isCompleted) { _, done in
            // 체크 한 번, as in the note (the hold before the row goes is the model's: 0.65 s, 0.3 under Reduce Motion).
            guard done, Motion.animation(.change, reduce: reduceMotion) != nil else { strike = done ? 1 : 0; return }
            strike = 0
            withAnimation(Motion.strike(reduce: reduceMotion)) { strike = 1 }
            pops += 1
        }
    }
}
