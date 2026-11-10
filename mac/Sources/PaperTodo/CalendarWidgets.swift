import AppKit
import Combine
import PaperCore
import SwiftUI

// 바탕화면 달력 위젯 (#234): up to four paper calendars on the desktop, each its own borderless window under every other
// window (or 항상 위에 두기), with a pair of cat ears at its top right. The rules — what each kind shows, how the paper
// fades and the text stays readable, where it sits on which display — are PaperCore's CalendarWidget (the same as the
// Windows app); this file keeps the windows: their settings (this Mac only, `calendar.widgets`), their places across
// display changes, the mouse (drag by the ears, click-through), and the one timer that wakes them when the day or the
// next thing changes. Nothing runs while they wait.

/// What every widget draws from: the events, this Mac's to-dos (without the spaces it hides, `hereItems`) and the time.
/// Set only when one of them changes, so an idle widget doesn't draw.
@MainActor
final class WidgetFeed: ObservableObject {
    @Published var events: [LocalEvent] = []
    @Published var tasks: [TodoItem] = []
    /// #274: this Mac's repeating to-dos (`hereSeries`), drawn on the days they come back.
    @Published var series: [Series] = []
    @Published var now = Date()
    /// 음력 · 공휴일 (책상 → 일정 → 달력).
    @Published var showsLunar = true
    @Published var showsHolidays = true
}

/// 음력 · 공휴일 (#234) for a day, as the desk calendar and the widgets draw them (PaperCore's KoreanCalendar), each day
/// worked out once.
@MainActor
enum DayMarks {
    private static var lunars: [String: KoreanCalendar.Lunar] = [:]

    /// "8.21", "음 9.1" and its spoken form "음력 9월 1일".
    static func lunar(_ day: String, language: AppLanguage = .current) -> (label: String, spoken: String)? {
        let lunar: KoreanCalendar.Lunar
        if let known = lunars[day] {
            lunar = known
        } else {
            guard let found = KoreanCalendar.lunar(day) else { return nil }
            if lunars.count > 2_000 { lunars.removeAll() }
            lunars[day] = found
            lunar = found
        }
        return (KoreanCalendar.lunarLabel(lunar, language: language), KoreanCalendar.lunarSpoken(lunar, language: language))
    }

    static func holiday(_ day: String, language: AppLanguage = .current) -> String? { KoreanCalendar.label(on: day, language: language) }
    /// #260: as a month cell draws it, with the places it may break (`KoreanCalendar.Name.shown`).
    static func holidayShown(_ day: String, language: AppLanguage = .current) -> String? { KoreanCalendar.label(on: day, language: language, shown: true) }
}

/// One widget's state, beside its settings.
@MainActor
final class WidgetState: ObservableObject {
    @Published var settings: CalendarWidget.Settings
    /// The pointer is over it (or over its ears while clicks pass through): drawn at 100 % with 선명하게.
    @Published var hovering = false
    /// ‹ › on a week or month: weeks or months away from now.
    @Published var offset = 0
    /// 크기 (#271) as drawn: the size picked, or a smaller one where its display has no room (CalendarWidget.shownScale).
    @Published var scale = CalendarWidget.defaultScale
    /// The toast at its foot (넣었어요 · 되돌리기, 위젯을 제거했어요 · 되돌리기).
    @Published var toast: PaperToast?
    /// Removed: only its toast is left, until the toast goes.
    @Published var removed = false
    /// A change plays one twitch of the near ear.
    @Published var twitch = 0
    /// Snapshots: a day drawn as if the pointer were on it.
    var previewHoverDay: String?

    init(settings: CalendarWidget.Settings) { self.settings = settings }
}

/// A widget's window: borderless, never key, never bringing the app forward (a click on the desktop calendar leaves the
/// app the user is in where it is, and what is being typed in the drawer, the quick entry or the quick memo — its text and
/// its caret — where it was), placed only by the app (macOS doesn't pull it back on screen; CalendarWidget.inside keeps it
/// there). #253: it works while a question waits (SlipModal).
final class CalendarWidgetPanel: NSPanel {
    init(size: NSSize) {
        super.init(contentRect: NSRect(origin: .zero, size: size), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        isExcludedFromWindowsMenu = true
        animationBehavior = .none
        becomesKeyOnlyIfNeeded = true
        worksWhenModal = true
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }

    /// 바탕화면에 두기: just above the desktop's icons, so every other window comes over it.
    static let desktopLevel = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)

    /// 항상 위에 두기 floats; else on the desktop. (#253: a question, `.modalPanel`, and the day sheet stay above both.)
    static func level(_ level: CalendarWidget.Level) -> NSWindow.Level { level == .top ? .floating : desktopLevel }
}

@MainActor
final class CalendarWidgets: ObservableObject {
    static let shared = CalendarWidgets()
    /// This Mac's widgets (not the shared folder: the desktops at home and at work differ).
    static let key = "calendar.widgets"

    @Published private(set) var list: [CalendarWidget.Settings] = []
    /// 달력 위젯 숨기기 (the 윈도우 menu): all of them away for now; not saved — they come back with the app.
    @Published private(set) var allHidden = false
    /// 투명도 줄이기: every widget at 100 %.
    @Published private(set) var reduceTransparency = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
    let feed = WidgetFeed()
    private(set) var states: [String: WidgetState] = [:]
    private var panels: [String: CalendarWidgetPanel] = [:]
    private(set) weak var model: AppModel?
    private var preferences = UserDefaults.standard
    /// `--offscreen` / PAPERTODO_OFFSCREEN (the checks): every widget 40,000 points off every screen.
    var offscreen = OffscreenRendering.enabled
    private var subscriptions = Set<AnyCancellable>()
    private var observers: [(NotificationCenter, NSObjectProtocol)] = []
    private var timer: Timer?
    private var mouseMonitors: [Any] = []
    private var started = false
    let sheet = WidgetDaySheetController()

    // MARK: Start

    func start(model: AppModel, preferences: UserDefaults, offscreen: Bool) {
        guard !started else { return }
        started = true
        self.model = model
        self.preferences = preferences
        self.offscreen = offscreen || OffscreenRendering.enabled
        sheet.widgets = self
        list = CalendarWidget.read(preferences.array(forKey: Self.key))
        // The data: only when it changes (the note's typing doesn't reach here until a to-do changes).
        model.$history.combineLatest(model.$hiddenHere, model.$todoSpaces, model.$series)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in self?.refreshTasks() }
            .store(in: &subscriptions)
        model.calendar.$showsLunar.receive(on: RunLoop.main).sink { [weak self] on in
            if self?.feed.showsLunar != on { self?.feed.showsLunar = on }
        }.store(in: &subscriptions)
        model.calendar.$showsHolidays.receive(on: RunLoop.main).sink { [weak self] on in
            if self?.feed.showsHolidays != on { self?.feed.showsHolidays = on }
        }.store(in: &subscriptions)
        model.calendar.$events
            .receive(on: RunLoop.main)
            .sink { [weak self] events in
                guard let self, self.feed.events != events else { return }
                self.feed.events = events
                self.scheduleTick()
            }
            .store(in: &subscriptions)
        let center = NotificationCenter.default, workspace = NSWorkspace.shared.notificationCenter
        observe(center, NSApplication.didChangeScreenParametersNotification) { $0.placeAll() }
        observe(workspace, NSWorkspace.accessibilityDisplayOptionsDidChangeNotification) {
            $0.reduceTransparency = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
            for settings in $0.list { $0.castsShadow(settings.id) }
        }
        // Waking, a new day, another time zone: the page is worked out again.
        observe(workspace, NSWorkspace.didWakeNotification) { $0.tick() }
        observe(center, .NSCalendarDayChanged) { $0.tick() }
        observe(center, .NSSystemTimeZoneDidChange) { $0.tick() }
        observe(center, .NSSystemClockDidChange) { $0.tick() }
        sync()
    }

    private func observe(_ center: NotificationCenter, _ name: Notification.Name, _ action: @escaping @MainActor (CalendarWidgets) -> Void) {
        let token = center.addObserver(forName: name, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { if let self { action(self) } }
        }
        observers.append((center, token))
    }

    private func refreshTasks() {
        guard let model else { return }
        let tasks = model.hereItems
        if feed.tasks != tasks { feed.tasks = tasks }
        let series = model.hereSeries
        if feed.series != series { feed.series = series }
        scheduleTick()
    }

    // MARK: The list

    var canAdd: Bool { list.count < CalendarWidget.limit }

    /// + 위젯 더하기: the main display's top right, where no widget is.
    @discardableResult
    func add(_ kind: CalendarWidget.Kind, _ style: CalendarWidget.Style) -> String? {
        guard canAdd else { return nil }
        var settings = CalendarWidget.Settings(id: CalendarWidget.newID(taken: list.map(\.id)), kind: kind, style: style)
        let size = CalendarWidget.windowSize(kind, settings.style)
        if let main = screens().first {
            let others = list.compactMap { panels[$0.id] }.map { Self.rect($0.frame.offsetBy(dx: -offscreenShift.x, dy: -offscreenShift.y)) }
            settings.place = CalendarWidget.newPlace(width: size.width, height: size.height, screen: main, others: others)
        }
        list.append(settings)
        save()
        sync()
        return settings.id
    }

    /// The settings slip and the menu change a widget at once (`save: false` while the slip is still open).
    func update(_ id: String, save saving: Bool = true, _ change: (inout CalendarWidget.Settings) -> Void) {
        guard let index = list.firstIndex(where: { $0.id == id }) else { return }
        var settings = list[index]
        change(&settings)
        settings = CalendarWidget.Settings(id: settings.id, kind: settings.kind, style: settings.style, opacity: settings.opacity,
                                           solidOnHover: settings.solidOnHover, clickThrough: settings.clickThrough, locked: settings.locked,
                                           level: settings.level, allSpaces: settings.allSpaces, place: settings.place, scale: settings.scale)
        let old = list[index]
        // Another size (#271), or dropped on another display (whose room may draw it smaller): placed again, inside.
        let resized = settings.style != old.style || settings.scale != old.scale || settings.place?.display != old.place?.display
        list[index] = settings
        states[id]?.settings = settings
        if saving { save() }
        if let panel = panels[id] {
            apply(settings, to: panel)
            if resized { place(id) }
        }
        updateMouseMonitors()
    }

    /// 위젯 제거: gone at once — the paper and the ears; its toast stays where it was for 4 seconds with 되돌리기.
    func remove(_ id: String) {
        guard let index = list.firstIndex(where: { $0.id == id }) else { return }
        let settings = list.remove(at: index)
        save()
        sheet.close(for: id)
        guard let state = states[id], panels[id] != nil else { return sync() }
        state.removed = true
        state.hovering = false
        var toast = PaperToast(symbol: "trash", text: L("위젯을 제거했어요"))
        toast.action = L("되돌리기")
        toast.perform = { [weak self] in self?.restore(settings, at: index) }
        state.toast = toast
        castsShadow(id)
        updateMouseMonitors()
    }

    func restore(_ settings: CalendarWidget.Settings, at index: Int) {
        guard canAdd, !list.contains(where: { $0.id == settings.id }) else { return }
        list.insert(settings, at: min(index, list.count))
        save()
        if let state = states[settings.id] {
            state.removed = false
            state.toast = nil
        }
        sync()
        castsShadow(settings.id)
    }

    /// The window's shadow is the shape of what it draws, and it shows through what is faint. So only a solid paper casts
    /// one (#321: below 100 % it lay under the faint paper — darker tiles, a soft shadow under every letter and a hard dark
    /// line round the edge; the edge line, never below half, marks the widget there). A removed widget's window holds only
    /// its toast, whose own soft shadow the window server would ring with a rough dark line, so it casts none either (#322;
    /// the toast keeps its own, as every toast). Worked out again once the widget has redrawn (#320: without the ears'
    /// shadow left behind). Not on hover (마우스를 올리면 선명하게): the paper at rest decides.
    func castsShadow(_ id: String) {
        guard let panel = panels[id], let state = states[id] else { return }
        let solid = CalendarWidget.drawn(state.settings.opacity, reduceTransparency: reduceTransparency, hover: false, solidOnHover: false) == 100
        let casts = solid && !state.removed
        if panel.hasShadow != casts { panel.hasShadow = casts }
        DispatchQueue.main.async { panel.invalidateShadow() }
    }

    /// The removed widget's toast went: its window goes too.
    func toastDone(_ id: String) {
        guard let state = states[id] else { return }
        state.toast = nil
        if state.removed { sync() }
    }

    func setAllHidden(_ hidden: Bool) {
        allHidden = hidden
        sync()
    }

    private func save() { preferences.set(CalendarWidget.write(list), forKey: Self.key) }

    /// Snapshots: the desk's rows, with no window.
    func showForSnapshot(_ list: [CalendarWidget.Settings]) { self.list = list }

    // MARK: Windows

    /// The windows to match the list: made, closed, shown or hidden.
    func sync() {
        let ids = Set(list.map(\.id))
        // A removed widget's window stays while its toast (되돌리기) is up.
        for (id, panel) in panels where !ids.contains(id) && !(states[id]?.removed == true && states[id]?.toast != nil) {
            panel.orderOut(nil)
            panel.close()
            panels[id] = nil
            states[id] = nil
        }
        for settings in list {
            let panel = panels[settings.id] ?? makePanel(settings)
            apply(settings, to: panel)
            if allHidden {
                panel.orderOut(nil)
            } else if !panel.isVisible {
                place(settings.id)
                panel.orderFrontRegardless()
            }
        }
        updateMouseMonitors()
        scheduleTick()
        objectWillChange.send()
    }

    private func makePanel(_ settings: CalendarWidget.Settings) -> CalendarWidgetPanel {
        let size = windowSize(settings)
        let panel = CalendarWidgetPanel(size: NSSize(width: size.width, height: size.height))
        panel.title = CalendarWidget.name(settings.kind, settings.style, .current)
        let state = states[settings.id] ?? WidgetState(settings: settings)
        state.settings = settings
        states[settings.id] = state
        state.scale = shownScale(settings)
        let view = CalendarWidgetView(state: state, feed: feed, widgets: self)
        let hosting = CalendarWidgetHostingView(rootView: AnyView(view), id: settings.id, widgets: self)
        hosting.sizingOptions = []
        hosting.frame = NSRect(origin: .zero, size: panel.frame.size)
        panel.contentView = hosting
        panels[settings.id] = panel
        return panel
    }

    private func apply(_ settings: CalendarWidget.Settings, to panel: CalendarWidgetPanel) {
        let level = CalendarWidgetPanel.level(settings.level)
        if panel.level != level { panel.level = level }
        // Not over a full-screen app (a film, a talk): no .fullScreenAuxiliary, as the pet.
        let behavior: NSWindow.CollectionBehavior = settings.allSpaces ? [.canJoinAllSpaces, .stationary, .ignoresCycle] : [.ignoresCycle]
        if panel.collectionBehavior != behavior { panel.collectionBehavior = behavior }
        let size = windowSize(settings)
        if panel.frame.size != NSSize(width: size.width, height: size.height) {
            panel.setContentSize(NSSize(width: size.width, height: size.height))
            panel.contentView?.frame = NSRect(origin: .zero, size: panel.frame.size)
        }
        panel.ignoresMouseEvents = settings.clickThrough && states[settings.id]?.hovering != true
        castsShadow(settings.id)
    }

    /// The panel of a widget (the sheet goes beside it).
    func panel(_ id: String) -> NSPanel? { panels[id] }
    func state(_ id: String) -> WidgetState? { states[id] }

    // MARK: Places

    /// Display areas in the core's terms (top-left origin, y down), the main display first. The id is the display's
    /// UUID, which stays the same when it comes back.
    func screens() -> [CalendarWidget.Screen] {
        NSScreen.screens.map { CalendarWidget.Screen(id: Self.id(of: $0), area: Self.rect($0.visibleFrame)) }
    }

    // MARK: 크기 (#271)

    /// The display a widget is on (its remembered one, else the main one).
    private func screen(of settings: CalendarWidget.Settings) -> CalendarWidget.Screen? {
        let all = screens()
        return all.first { $0.id == settings.place?.display } ?? all.first
    }

    /// The size a widget is drawn at: the one picked, else the largest that fits its display. Snapshots draw the one picked.
    func shownScale(_ settings: CalendarWidget.Settings) -> Double {
        guard let area = screen(of: settings)?.area else { return settings.scale }
        return CalendarWidget.shownScale(settings.scale, settings.kind, settings.style, area: area)
    }

    /// The window at the size drawn; the widget's view hears that size.
    private func windowSize(_ settings: CalendarWidget.Settings) -> (width: Double, height: Double) {
        let scale = shownScale(settings)
        if let state = states[settings.id], state.scale != scale { state.scale = scale }
        return CalendarWidget.windowSize(settings.kind, settings.style, scale: scale)
    }

    /// The sizes that fit the widget's display (the others are greyed out in its menu and its settings).
    func fitting(_ settings: CalendarWidget.Settings) -> [Double] {
        guard let area = screen(of: settings)?.area else { return CalendarWidget.scales }
        return CalendarWidget.scales.filter { CalendarWidget.fits(settings.kind, settings.style, scale: $0, area: area) }
    }

    static func id(of screen: NSScreen) -> String {
        let number = (screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value ?? 0
        if let uuid = CGDisplayCreateUUIDFromDisplayID(number)?.takeRetainedValue(), let text = CFUUIDCreateString(nil, uuid) as String? {
            return text
        }
        return String(number)
    }

    /// The main display's top edge: the core's y runs down from it.
    private static var top: CGFloat { NSScreen.screens.first?.frame.maxY ?? 0 }
    static func rect(_ frame: NSRect) -> CalendarWidget.Rect {
        CalendarWidget.Rect(x: frame.minX, y: top - frame.maxY, width: frame.width, height: frame.height)
    }
    static func frame(_ rect: CalendarWidget.Rect) -> NSRect {
        NSRect(x: rect.x, y: top - rect.y - rect.height, width: rect.width, height: rect.height)
    }

    private var offscreenShift: NSPoint { offscreen ? NSPoint(x: -40_000, y: -40_000) : .zero }

    /// A widget at its place: on its display, else on the main one at the same shares (the remembered display stays
    /// remembered, so it goes back when that display returns).
    func place(_ id: String) {
        guard let panel = panels[id], let settings = list.first(where: { $0.id == id }) else { return }
        let size = windowSize(settings)
        let all = screens()
        let place = settings.place ?? all.first.map {
            CalendarWidget.newPlace(width: size.width, height: size.height, screen: $0, others: [])
        } ?? CalendarWidget.Place(display: "", x: 1, y: 0)
        let frame = Self.frame(CalendarWidget.frame(place, width: size.width, height: size.height, screens: all))
            .offsetBy(dx: offscreenShift.x, dy: offscreenShift.y)
        if panel.frame != frame {
            panel.setFrame(frame, display: true)
            panel.contentView?.frame = NSRect(origin: .zero, size: panel.frame.size)
        }
    }

    /// The displays changed (one came or went, a new resolution, the Dock moved): every widget again.
    func placeAll() {
        for settings in list { place(settings.id) }
        sheet.follow()
    }

    /// A drag let go: it snaps to the display's edges and the other widgets', and the new place is remembered.
    func dropped(_ id: String) {
        guard let panel = panels[id] else { return }
        let all = screens()
        let current = Self.rect(panel.frame.offsetBy(dx: -offscreenShift.x, dy: -offscreenShift.y))
        guard let place = CalendarWidget.place(of: current, screens: all),
              let screen = all.first(where: { $0.id == place.display }) else { return }
        let others = list.filter { $0.id != id }.compactMap { panels[$0.id] }.filter(\.isVisible)
            .map { Self.rect($0.frame.offsetBy(dx: -offscreenShift.x, dy: -offscreenShift.y)) }
        let snapped = CalendarWidget.snap(current, area: screen.area, others: others)
        panel.setFrame(Self.frame(snapped).offsetBy(dx: offscreenShift.x, dy: offscreenShift.y), display: true)
        update(id) { $0.place = CalendarWidget.place(of: snapped, screens: all) }
        sheet.follow()
    }

    // MARK: Time

    /// One timer for all of them, set again each time: the next midnight, or the next change of what is still to come.
    func scheduleTick() {
        timer?.invalidate()
        timer = nil
        guard !list.isEmpty, !allHidden else { return }
        let now = Date()
        var next = Calendar.paper.date(byAdding: .day, value: 1, to: Calendar.paper.startOfDay(for: now))!
        let today = CalendarWidget.today(now)
        if list.contains(where: { $0.kind != .month }) {
            let page = CalendarMonth.Page(days: [today], events: LocalEvent.expand(feed.events, from: Calendar.paper.startOfDay(for: now), to: next,
                                                                                    language: .current),
                                          tasks: feed.tasks, series: feed.series, now: now)
            let lines = CalendarWidget.dayLines(today, page: page, tasks: feed.tasks, now: now)
            next = min(next, CalendarWidget.nextRedraw(.today, now: now, lines: lines))
        }
        let fire = Timer(fire: next.addingTimeInterval(0.5), interval: 0, repeats: false) { _ in
            MainActor.assumeIsolated { CalendarWidgets.shared.tick() }
        }
        fire.tolerance = 1
        RunLoop.main.add(fire, forMode: .common)
        timer = fire
    }

    func tick() {
        feed.now = Date()
        scheduleTick()
    }

    // MARK: The mouse while clicks pass through

    /// Watched only while a widget lets clicks through: over its ears, or with ⌥ held over it, it takes the mouse and
    /// is drawn solid; off it, clicks pass again. The moves come through the app's one mouse ear (PointerWatch, #64:
    /// it looks away for a moment while the pointer is far from every widget); ⌥ going down or up is heard at once
    /// (no key watching, no permission).
    private func updateMouseMonitors() {
        let needed = list.contains { $0.clickThrough } && !allHidden
        if needed, mouseMonitors.isEmpty {
            let watch = PointerWatch.shared
            watch.watch("widgets", distance: { [weak self] point in
                self?.distance(to: point) ?? .infinity
            }, moved: { [weak self] point in
                self?.pointerMoved(at: point, option: PointerWatch.shared.modifiers().contains(.option))
            })
            let flags: (NSEvent) -> Void = { [weak self] event in
                let option = event.modifierFlags.contains(.option)
                MainActor.assumeIsolated { self?.pointerMoved(at: PointerWatch.shared.pointer(), option: option) }
            }
            if watch.systemWide, let global = NSEvent.addGlobalMonitorForEvents(matching: .flagsChanged, handler: flags) { mouseMonitors.append(global) }
            if let local = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged, handler: { flags($0); return $0 }) { mouseMonitors.append(local) }
        } else if !needed, !mouseMonitors.isEmpty {
            PointerWatch.shared.stop("widgets")
            mouseMonitors.forEach(NSEvent.removeMonitor)
            mouseMonitors.removeAll()
        }
    }

    /// Points from the pointer to the nearest widget that lets clicks through.
    private func distance(to point: NSPoint) -> Double {
        list.filter(\.clickThrough).compactMap { panels[$0.id] }.filter(\.isVisible)
            .map { PointerPace.distance(from: point, to: $0.frame) }.min() ?? .infinity
    }

    /// The bench: whether a widget's clicks pass through it now.
    func passesClicks(_ id: String) -> Bool { panels[id]?.ignoresMouseEvents ?? true }

    private func pointerMoved(at point: NSPoint, option: Bool) {
        for settings in list where settings.clickThrough {
            guard let panel = panels[settings.id], let state = states[settings.id] else { continue }
            let inside = panel.frame.contains(point)
            let ears = earRects(settings, in: panel.frame).contains { $0.insetBy(dx: -4, dy: -4).contains(point) }
            let takes = inside && (ears || option || (state.hovering && !panel.ignoresMouseEvents))
            if panel.ignoresMouseEvents == takes { panel.ignoresMouseEvents = !takes }
            if state.hovering != takes { state.hovering = takes }
        }
    }

    /// The ears' boxes on screen (at the size drawn).
    func earRects(_ settings: CalendarWidget.Settings, in frame: NSRect) -> [NSRect] {
        let k = states[settings.id]?.scale ?? 1
        let height = CalendarWidget.earHeight(settings.kind, settings.style) * k
        return CalendarWidget.ears(settings.kind, settings.style).map { ear in
            NSRect(x: frame.maxX - ear.far * k, y: frame.maxY - height - 2, width: (ear.far - ear.near) * k, height: height + 2)
        }
    }

    // MARK: Actions from a widget

    /// The desk's 달력 on a day — with an event pressed, that event open to change or remove (calendar-flows D3). #253:
    /// while a question waits, the desk comes forward under it (SlipModal.cameForward).
    func openCalendar(on day: String?, event: String? = nil) {
        model?.calendar.windowEvent = day == nil ? nil : event
        model?.onCalendar?(day)
        SlipModal.cameForward(Self.frontWindow)
    }

    func reveal(_ task: UUID) {
        model?.reveal(task)
        SlipModal.cameForward(Self.frontWindow)
    }

    /// A line pressed: a to-do's row in the note; a repeat without an open copy (#274) its rule on the desk (책상 → 반복);
    /// an event on the desk's calendar, on its day (calendar-flows D3).
    func open(_ line: CalendarWidget.Line, day: String) {
        if let task = line.taskId {
            reveal(task)
        } else if line.kind == .repeating {
            model?.showRepeatSettings()
            SlipModal.cameForward(Self.frontWindow)
        } else {
            openCalendar(on: day, event: line.eventKey)
        }
    }

    /// The app's window in front now (the note or the desk just shown), not a panel.
    private static var frontWindow: NSWindow? { NSApp.orderedWindows.first { $0.isVisible && !($0 is NSPanel) } }

    /// A day pressed (or its +N, or the + of 오늘 · 오늘 목록): the day sheet beside the widget.
    func openDay(_ day: String, from id: String) {
        guard let model, let panel = panels[id] else { return }
        sheet.open(day: day, beside: panel, widget: id, model: model, offscreen: offscreen)
    }

    /// Something was put in from a widget's sheet: its toast, and one twitch of its ears.
    func made(_ toast: PaperToast, on id: String) {
        guard let state = states[id] else { return }
        state.toast = toast
        if !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion { state.twitch += 1 }
    }

    // MARK: The menu

    func menu(for id: String) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        guard let settings = list.first(where: { $0.id == id }) else { return menu }
        func add(_ title: String, checked: Bool = false, indent: Bool = false, _ action: @escaping () -> Void) {
            let item = WidgetMenuItem(title: title, action: action)
            item.state = checked ? .on : .off
            item.indentationLevel = indent ? 1 : 0
            menu.addItem(item)
        }
        if CalendarWidget.hasStyles(settings.kind) {
            menu.addItem(NSMenuItem.sectionHeader(title: String(localized: "모양", table: "Widget")))
            for style in CalendarWidget.styles(settings.kind) {
                add(CalendarWidget.styleName(style, .current), checked: settings.style == style, indent: true) { [weak self] in
                    self?.update(id) { $0.style = style }
                }
            }
            menu.addItem(.separator())
        }
        // 크기 (#271): one that doesn't fit this display is greyed out.
        menu.addItem(NSMenuItem.sectionHeader(title: L("크기")))
        let fitting = fitting(settings)
        for scale in CalendarWidget.scales {
            add(CalendarWidget.scaleName(scale, .current), checked: settings.scale == scale, indent: true) { [weak self] in
                self?.update(id) { $0.scale = scale }
            }
            menu.items.last?.isEnabled = fitting.contains(scale)
        }
        menu.addItem(.separator())
        menu.addItem(NSMenuItem.sectionHeader(title: L("불투명도")))
        for value in [100, 85, 70, 50, 30] {
            add("\(value)%", checked: settings.opacity == value, indent: true) { [weak self] in self?.update(id) { $0.opacity = value } }
        }
        menu.addItem(.separator())
        add(L("클릭 통과"), checked: settings.clickThrough) { [weak self] in self?.update(id) { $0.clickThrough.toggle() } }
        add(L("위치 고정"), checked: settings.locked) { [weak self] in self?.update(id) { $0.locked.toggle() } }
        menu.addItem(.separator())
        add(L("설정…")) { [weak self] in self?.openSettings(id) }
        add(L("위젯 제거")) { [weak self] in self?.remove(id) }
        return menu
    }

    func openSettings(_ id: String) {
        guard let settings = list.first(where: { $0.id == id }) else { return }
        WidgetSettingsSlip.open(settings, widgets: self)
    }
}

/// A menu item that runs a closure.
final class WidgetMenuItem: NSMenuItem {
    private let run: () -> Void

    init(title: String, action: @escaping () -> Void) {
        run = action
        super.init(title: title, action: #selector(runAction), keyEquivalent: "")
        target = self
    }

    required init(coder: NSCoder) { fatalError("init(coder:) is not used") }

    @objc private func runAction() { run() }
}

/// The widget's view in its window: takes the first click while another app is in front, moves the window by its ears
/// (and its header) after 4 pt, opens the menu on a click on the ears or a right click, and tells the widget when the
/// pointer is over it. Everything else goes to the SwiftUI view.
final class CalendarWidgetHostingView: NSHostingView<AnyView> {
    let id: String
    weak var widgets: CalendarWidgets?
    private var tracking: NSTrackingArea?
    private var leaving: DispatchWorkItem?

    init(rootView: AnyView, id: String, widgets: CalendarWidgets) {
        self.id = id
        self.widgets = widgets
        super.init(rootView: rootView)
    }

    @MainActor @preconcurrency required init(rootView: AnyView) { fatalError("init(rootView:) is not used") }
    @MainActor @preconcurrency required dynamic init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area)
        tracking = area
    }

    override func mouseEntered(with event: NSEvent) {
        super.mouseEntered(with: event)
        leaving?.cancel()
        guard let state = widgets?.state(id), !state.removed else { return }
        withAnimation(reduceMotion ? nil : .easeOut(duration: Motion.widgetSolid)) { state.hovering = true }
    }

    override func mouseExited(with event: NSEvent) {
        super.mouseExited(with: event)
        // A moment before it fades again, so passing over an edge doesn't flicker.
        let work = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                guard let self, let state = self.widgets?.state(self.id) else { return }
                withAnimation(self.reduceMotion ? nil : .easeOut(duration: Motion.widgetSolid)) { state.hovering = false }
                if state.settings.clickThrough { self.window?.ignoresMouseEvents = true }
            }
        }
        leaving = work
        DispatchQueue.main.asyncAfter(deadline: .now() + Motion.widgetFadeDelay, execute: work)
    }

    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    /// From the top of the view (the window's coordinates turned over when need be).
    private func fromTop(_ event: NSEvent) -> NSPoint {
        let point = convert(event.locationInWindow, from: nil)
        return NSPoint(x: point.x, y: isFlipped ? point.y : bounds.height - point.y)
    }

    private enum Grip { case ears, header }

    private func grip(at point: NSPoint) -> Grip? {
        guard let state = widgets?.state(id), !state.removed else { return nil }
        let settings = state.settings, k = state.scale
        let earHeight = CalendarWidget.earHeight(settings.kind, settings.style) * k
        let width = bounds.width
        for ear in CalendarWidget.ears(settings.kind, settings.style)
        where point.y <= earHeight + 2 && point.x >= width - ear.far * k - 4 && point.x <= width - ear.near * k + 4 { return .ears }
        // The header row, left of ‹ 오늘 › (오늘 · 오늘 목록: the big date and the heading).
        if point.y > earHeight, point.y < earHeight + 38 * k, point.x < width - 100 * k { return .header }
        return nil
    }

    override func mouseDown(with event: NSEvent) {
        guard let grip = grip(at: fromTop(event)), let window else { return super.mouseDown(with: event) }
        let locked = widgets?.state(id)?.settings.locked == true
        let start = NSEvent.mouseLocation, origin = window.frame.origin
        var moved = false
        while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp]) {
            let point = NSEvent.mouseLocation
            let dx = point.x - start.x, dy = point.y - start.y
            if !moved, hypot(dx, dy) >= 4, !locked { moved = true }
            if moved { window.setFrameOrigin(NSPoint(x: origin.x + dx, y: origin.y + dy)) }
            if next.type == .leftMouseUp { break }
        }
        if moved {
            widgets?.dropped(id)
        } else if grip == .ears {
            showMenu(event)
        } else if let state = widgets?.state(id) {
            // A click on the heading: the desk's calendar on that page's day.
            widgets?.openCalendar(on: Self.pageDay(state))
        }
    }

    /// The day a widget's page is on: today, the week ‹ › went to, or the 1st of the month it went to.
    static func pageDay(_ state: WidgetState, now: Date = Date()) -> String {
        let today = CalendarWidget.today(now)
        switch state.settings.kind {
        case .week: return CalendarMonth.adding(7 * state.offset, to: today)
        case .month where state.offset != 0:
            let shown = CalendarWidget.shifted(today, months: state.offset)
            return String(format: "%04d-%02d-01", shown.year, shown.month)
        default: return today
        }
    }

    override func rightMouseDown(with event: NSEvent) { showMenu(event) }

    private func showMenu(_ event: NSEvent) {
        guard let widgets, widgets.state(id)?.removed == false else { return }
        let menu = widgets.menu(for: id)
        menu.popUp(positioning: nil, at: convert(event.locationInWindow, from: nil), in: self)
    }
}
