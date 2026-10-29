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
struct MenuBarState {
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
                                                          openTasks: model.remainingCount, language: language)
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
    private var subscriptions = Set<AnyCancellable>()
    private var focus = 0
    var onOpenNote: () -> Void = {}
    var onCalendar: () -> Void = {}
    var onQuickEntry: () -> Void = {}
    var onSettings: () -> Void = {}
    var timerMenu: () -> NSMenu = { NSMenu() }
    /// Told whenever the item is brought up to date (the folded icon's summary follows it).
    var onUpdate: () -> Void = {}

    var isShown: Bool { panel?.isVisible == true }

    init(model: AppModel, timer: FocusTimerState) {
        self.model = model
        self.timer = timer
        super.init()
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
        if let button = statusItem.button { state.apply(to: button) }
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
        panel.show(TodayWindowView(model: model, timer: timer, alarms: model.alarms, calendar: model.calendar, focus: focus,
                                   onOpenNote: { [weak self] in self?.close(); self?.onOpenNote() },
                                   onCalendar: { [weak self] in self?.close(); self?.onCalendar() }))
        let itemFrame = buttonWindow.convertToScreen(button.convert(button.bounds, to: nil))
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

/// 오늘 창: three cards (다음 일정 · 타이머 · 다음 알람 — the one within the hour, or a running
/// timer, in clay), 다음 and a few more of today's open tasks with working checkboxes, the input
/// line, and links to the note, the calendar and the desktop cat.
struct TodayWindowView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var timer: FocusTimerState
    @ObservedObject var alarms: AlarmBook
    @ObservedObject var calendar: EventBook
    var focus = 0
    /// Snapshots: a fixed now, a toast already showing, and a timer card drawn as if hovered.
    var now: Date?
    var previewToast: PaperToast?
    var previewTimerHover = false
    var onOpenNote: () -> Void = {}
    var onCalendar: () -> Void = {}
    @State private var toast: PaperToast?
    @State private var timerHover = false
    /// 1.38: an empty card's suggestion, put into the line below (“타이머 25”, “알람 7시”).
    @State private var lineFill: String?

    static let width: CGFloat = 320
    /// Tasks under 다음.
    static let moreLimit = 3

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let now = self.now ?? timeline.date
            PaperSlip(kind: .todo, width: Self.width, taped: false) {
                VStack(alignment: .leading, spacing: 10) {
                    cards(now: now)
                    tasks(now: now)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        // The toast floats just above the line it came from, centred on it.
                        .overlay(alignment: .bottom) {
                            if let shown = toast ?? previewToast {
                                ToastView(toast: shown) { if toast?.id == shown.id { toast = nil } }
                                    .fixedSize(horizontal: false, vertical: true)
                                    .padding(.horizontal, -2)
                                    .id(shown.id)
                            }
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
        model.todayItems.compactMap { item in
            guard !item.isCompleted, let at = item.reminderAt else { return nil }
            return DayRibbon.Reminder(id: item.id.uuidString, title: item.title, at: at)
        }
    }

    private func cards(now: Date) -> some View {
        let language = AppLanguage.current
        let events = calendar.todayEvents(now: now)
        let next = events.filter { !$0.allDay && $0.start > now }.min { $0.start < $1.start }
        let nextMinutes = next.map { max(1, Int(($0.start.timeIntervalSince(now) / 60).rounded(.up))) }
        let alarm = alarms.next(now: now)
        let running = timer.timer
        return HStack(alignment: .top, spacing: 6) {
            // 다음 일정
            GlanceCard(caption: L("다음 일정"),
                       value: next.map { clock($0.start, language) } ?? "—",
                       line: next.map { TodayGlance.eventLine(title: $0.title, minutes: nextMinutes ?? 0, language: language) } ?? TodayGlance.noEvent(language),
                       hot: (nextMinutes ?? .max) <= TodayGlance.window,
                       accessibility: next.map { L("다음 일정") + ": " + $0.title + ", " + clock($0.start, language) + ", " + DayRibbon.away(nextMinutes ?? 0, language: language) }
                           ?? L("다음 일정") + ": " + TodayGlance.noEvent(language))
                // 1.38: none today → a new event.
                .onTapGesture {
                    if let next { calendar.sheet = .edit(next, in: calendar) } else { model.newEvent() }
                    onOpenNote()
                }
            // 타이머
            // While focusing: the to-do's title under the time (focus-cases.md glance rule).
            let focusTitle = timer.isFocusing ? timer.session?.title : nil
            GlanceCard(caption: L("타이머"),
                       // #46: a length ("21분" + small "남음"), not "20:50" beside the clock times either side.
                       value: running.map { TodayGlance.timerLength($0.remaining(at: now), language: language) } ?? "—",
                       unit: running.map { _ in TodayGlance.timerLeftWord(language) },
                       unitFirst: TodayGlance.timerLeftWordFirst(language),
                       line: running.map { timer in
                           guard let focusTitle else {
                               // A plain timer: when it ends (the caption already says 타이머).
                               if timer.phase == .timer && !timer.isPaused {
                                   return L("\(clock(now.addingTimeInterval(timer.remaining(at: now)), language))에 끝나요")
                               }
                               return timer.caption(language) + (timer.isPaused ? " · " + L("멈춤") : "")
                           }
                           return timer.isPaused ? L("멈춤") + " · " + focusTitle : focusTitle
                       } ?? TodayGlance.timerHint(language),
                       hot: false,
                       running: running.map { !$0.isPaused } ?? false,
                       accessibility: running.map { L("타이머") + ": " + TodayGlance.timerLeftText($0.remaining(at: now), language: language) + ", " + $0.caption(language) }
                           ?? L("타이머") + ": " + L("없음"))
                .overlay(alignment: .topTrailing) {
                    if running != nil && (timerHover || previewTimerHover) { timerButtons(paused: running?.isPaused ?? false) }
                }
                .onHover { timerHover = $0 }
                // 1.38: an empty timer card puts “타이머 25” into the line.
                .onTapGesture { if running == nil { lineFill = TodayGlance.timerWords(language) } }
            // 다음 알람
            GlanceCard(caption: L("다음 알람"),
                       value: alarm.map { Alarm.clockText($0.alarm, language: language) } ?? "—",
                       line: alarm.map { TodayGlance.alarmLine(fire: $0.fire, days: $0.alarm.days, now: now, language: language) } ?? TodayGlance.alarmHint(language),
                       hot: alarm.map { $0.fire.timeIntervalSince(now) <= TimeInterval(TodayGlance.window * 60) } ?? false,
                       accessibility: alarm.map { L("다음 알람") + ": " + Alarm.timeText($0.alarm, language: language) + ", " + Alarm.untilText($0.fire, now: now, language: language) }
                           ?? L("다음 알람") + ": " + L("없음"))
                // 1.38: an alarm opens 시계; none puts “알람 7시” into the line.
                .onTapGesture { if alarm == nil { lineFill = TodayGlance.alarmWords(language) } else { model.showAlarmSettings() } }
        }
        .fixedSize(horizontal: false, vertical: true)
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
        let open = model.glanceTodayItems
        let split = TodayGroups.split(open, series: model.series, now: now)
        let byID = Dictionary(uniqueKeysWithValues: open.map { ($0.id, $0) })
        let next = split.next.compactMap { byID[$0] }
        let rest = split.rest.compactMap { byID[$0] }.prefix(Self.moreLimit)
        let more = open.filter { !$0.isCompleted }.count - next.filter { !$0.isCompleted }.count - rest.filter { !$0.isCompleted }.count
        VStack(alignment: .leading, spacing: 0) {
            if open.isEmpty {
                // 1.38: the small cat, like every other empty sheet.
                HStack(spacing: 8) {
                    Image(nsImage: PetArt.image(model.todayItems.isEmpty ? .happy : .cheer) ?? PaperTheme.mascot)
                        .resizable().scaledToFit().frame(width: 30, height: 30)
                        .accessibilityHidden(true)
                    Text(model.todayItems.isEmpty ? L("오늘 할 일을 한 줄 적어 볼까요?") : L("오늘 한 장 끝! 수고했어요"))
                        .font(.system(size: 12))
                        .foregroundStyle(PaperTheme.ink3)
                }
                .frame(maxWidth: .infinity, minHeight: 36)
            }
            if !next.isEmpty {
                GlanceHeader(title: L("다음"))
                ForEach(next) { GlanceTaskRow(item: $0, model: model, time: split.times[$0.id]) }
            }
            if !rest.isEmpty {
                if !next.isEmpty { GlanceHeader(title: L("오늘 할 일")).padding(.top, 4) }
                ForEach(Array(rest)) { GlanceTaskRow(item: $0, model: model, time: nil) }
            }
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

/// One of the three cards: a small caption, a big tabular value, a line under it (two lines at most).
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
    let accessibility: String
    @Environment(\.colorSchemeContrast) private var contrast

    private var accent: Color? { hot ? PaperTheme.clayText : running ? PaperTheme.sageText : nil }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(caption)
                .font(.system(size: 9.5, weight: .semibold))
                .tracking(0.3)
                .foregroundStyle(accent ?? PaperTheme.ink3)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
            // The small word steps aside when the card is too narrow for it (the value never gets "…").
            ViewThatFits(in: .horizontal) {
                valueLine(unit: unit)
                valueLine(unit: nil)
            }
            .foregroundStyle(accent ?? PaperTheme.ink)
            Text(line)
                .font(.system(size: 10.5).monospacedDigit())
                .foregroundStyle(PaperTheme.ink2)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(hot ? PaperTheme.clay2 : running ? PaperTheme.sage2 : PaperTheme.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .strokeBorder(hot ? PaperTheme.clay : running ? PaperTheme.sage : contrast == .increased ? PaperTheme.ink3 : PaperTheme.rule, lineWidth: 1)
        }
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .accessibilityElement(children: .contain)
        .accessibilityLabel(accessibility)
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

/// A task in the 오늘 창: the checkbox (with the note's pop and pencil line), the handwritten
/// title, and for 다음 its time.
private struct GlanceTaskRow: View {
    let item: TodoItem
    @ObservedObject var model: AppModel
    let time: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var strike: CGFloat = 0
    @State private var pop = false
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 8) {
            Button {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) { model.toggle(item.id) }
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
                .scaleEffect(pop ? 0.85 : 1)
                .frame(width: 22, height: 30)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(item.isCompleted ? L("완료 취소") : L("완료 표시"))
            .accessibilityLabel("\(item.title) 완료")
            .accessibilityValue(item.isCompleted ? L("완료됨") : L("미완료"))

            Text(item.title.handwritten)
                .font(model.notebookFont.bodyFont(.small))
                .foregroundStyle(item.isCompleted ? PaperTheme.ink3 : PaperTheme.ink)
                .lineLimit(1)
                .overlay {
                    PencilStrike().trim(from: 0, to: strike)
                        .stroke(PaperTheme.ink.opacity(0.62), style: StrokeStyle(lineWidth: 1.25, lineCap: .round))
                        .allowsHitTesting(false)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
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
        .frame(minHeight: 30)
        .background(PaperTheme.sage.opacity(hovering ? 0.055 : 0), in: RoundedRectangle(cornerRadius: 4))
        .overlay(alignment: .bottom) { Rectangle().fill(PaperTheme.rule).frame(height: 0.6).padding(.leading, 26) }
        .onHover { hovering = $0 }
        .onAppear { strike = item.isCompleted ? 1 : 0 }
        .onChange(of: item.isCompleted) { _, done in
            guard done, !reduceMotion else { strike = done ? 1 : 0; return }
            strike = 0
            withAnimation(.easeOut(duration: 0.22)) { strike = 1 }
            pop = true
            withAnimation(.easeOut(duration: 0.16)) { pop = false }
        }
    }
}
