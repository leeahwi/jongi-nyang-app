import AppKit
import Combine
import PaperCore

/// 치면 두드리는 고양이 (#230 · #289, docs/plans/typing-cat.md): a cat of its own, apart from the desktop pet. It sits on
/// its cushion in a corner of the screen in use (`TypingCatPanel`), hears keys (`TypingKeys`) as the setting says and
/// runs the rules (`TypingCat`: a paw at once, rest 0.12 s after the last key, one timer at most).
///
/// - 종이냥에서만: it comes with a key typed in 종이냥 and quietly goes `TypingCat.linger` after the last one.
/// - 모든 앱에서 (with Input Monitoring): it is always in its corner, over full-screen apps too.
/// - Hiding the pet, or the pet walking, sleeping or cheering, changes nothing here; the pet never comes to the cushion.
/// - #331: pressed on the cat and dragged, the window follows; let go, it stays there (옮긴 자리, `TypingPlace`), wholly on
///   that display. Clicks anywhere clear still go to the app behind: the app's one mouse ear (`PointerWatch`) says when
///   the pointer is over the drawn cat.
///
/// At rest nothing runs: no timer, no animation, one still picture (or no window at all).
@MainActor
final class TypingCatController {
    private(set) var cat = TypingCat()
    private let model: AppModel
    private let preferences: UserDefaults
    private let access: InputMonitoringAccess
    let keys = TypingKeys()
    private var panel: TypingCatPanel?
    private var pawTask: Task<Void, Never>?
    /// 종이냥에서만: the one wait until the cat goes (moved on by each key).
    private var goTask: Task<Void, Never>?
    private var locked = false
    private var subscriptions = Set<AnyCancellable>()
    /// `--offscreen` and the bench: the window far off every screen (40,000 points), and no fading.
    var offscreen = false
    /// The screen whose corner it sits in: the one in use (the bench hands in its own).
    var screen: () -> NSScreen? = { NSScreen.main ?? NSScreen.screens.first }
    /// #331: the displays a kept place is looked up on (the bench hands in its own).
    var screens: () -> [TypingCorner.Screen] = { NSScreen.typingScreens }
    /// #331: held and being dragged — it isn't put back in its place, and 종이냥에서만 doesn't send it away meanwhile.
    private(set) var dragging = false
    /// When it was last let go: 종이냥에서만 keeps it `linger` from then, as after a key.
    private var droppedAt: Double?

    init(model: AppModel, preferences: UserDefaults, access: InputMonitoringAccess) {
        self.model = model
        self.preferences = preferences
        self.access = access
        keys.onKey = { [weak self] in self?.typed() }
        keys.onTapLost = { [weak self] in self?.refresh() }
        // Chosen in Settings or from the menu (not at launch): ask macOS once, if this build never did.
        model.$typingScope.dropFirst().removeDuplicates().sink { [weak self] scope in
            DispatchQueue.main.async { self?.chose(scope) }
        }.store(in: &subscriptions)
        model.$typingCorner.dropFirst().removeDuplicates().sink { [weak self] _ in
            DispatchQueue.main.async { self?.placeIfShown() }
        }.store(in: &subscriptions)
        // #304: 크기: the window takes its new side at once, flush in the same corner.
        model.$typingSize.dropFirst().removeDuplicates().sink { [weak self] _ in
            DispatchQueue.main.async { self?.placeIfShown() }
        }.store(in: &subscriptions)
        // The permission may have changed in System Settings meanwhile; the screens may have moved.
        let center = NotificationCenter.default
        Publishers.Merge(center.publisher(for: NSApplication.didBecomeActiveNotification),
                         center.publisher(for: NSApplication.didChangeScreenParametersNotification))
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.refresh() }.store(in: &subscriptions)
        NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.activeSpaceDidChangeNotification)
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.refresh() }.store(in: &subscriptions)
        // Locked: nothing is heard and the cat goes; back as it was once unlocked.
        let distributed = DistributedNotificationCenter.default()
        distributed.publisher(for: Notification.Name("com.apple.screenIsLocked"))
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.setLocked(true) }.store(in: &subscriptions)
        distributed.publisher(for: Notification.Name("com.apple.screenIsUnlocked"))
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.setLocked(false) }.store(in: &subscriptions)
    }

    /// Starts hearing as the setting says (the app calls it once everything is made).
    func start() { refresh() }

    private var buildKey: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "dev" }
    private var askedThisBuild: Bool { preferences.string(forKey: "pet.typing.askedBuild") == buildKey }

    private func chose(_ scope: TypingCat.Scope) {
        if TypingSource.shouldAsk(scope: scope, granted: access.granted, askedThisBuild: askedThisBuild, chosenNow: true) {
            preferences.set(buildKey, forKey: "pet.typing.askedBuild")
            access.request()
        }
        refresh()
    }

    func setLocked(_ locked: Bool) {
        guard locked != self.locked else { return }
        self.locked = locked
        refresh()
    }

    /// Brings everything in line with the setting, the permission and the lock: what is heard, and whether the cat is in
    /// its corner.
    func refresh() {
        let granted = model.typingScope == .everywhere && access.granted
        let before = keys.source
        keys.use(TypingSource.of(scope: model.typingScope, granted: granted, locked: locked))
        // A tap macOS wouldn't make counts as not allowed (locked, nothing is tapped, and that's fine).
        let working = granted && (locked || keys.source == .everywhere)
        let noPermission = TypingSource.showsNoPermission(scope: model.typingScope, granted: working)
        if model.typingNoPermission != noPermission { model.typingNoPermission = noPermission }
        // Heard from elsewhere now (turned off, locked, the permission gone): the paws rest.
        if keys.source != before { stopPaws() }
        update()
    }

    /// In its corner or not, as `TypingCorner.shows` says now.
    private func update() {
        if TypingCorner.shows(source: keys.source, lastKey: cat.lastKey, now: now, dragging: dragging, dropped: droppedAt) {
            show()
            if keys.source == .app { armGo() }
        } else {
            hide()
        }
    }

    var isShown: Bool { panel?.isShown == true }
    /// Tests: where the cat is.
    var frame: NSRect? { panel?.frame }

    private func show() {
        let panel = panel ?? makePanel()
        self.panel = panel
        place(panel)
        panel.show(cat.pose)
        watchPointer()
    }

    private func makePanel() -> TypingCatPanel {
        let panel = TypingCatPanel()
        panel.onDragStart = { [weak self] in self?.dragBegan() }
        panel.onDragEnd = { [weak self] in self?.dragEnded() }
        return panel
    }

    private func hide() {
        goTask?.cancel()
        goTask = nil
        stopPaws()
        dragging = false
        PointerWatch.shared.stop("typingCat")
        panel?.hide(fade: !offscreen && !reduceMotion)
    }

    private func placeIfShown() {
        guard let panel, panel.isShown else { return }
        place(panel)
    }

    /// Where it sits now (on the screens, before `--offscreen`'s shift): 옮긴 자리 when chosen and kept, else the corner.
    var target: NSRect? {
        guard let screen = screen() ?? NSScreen.main ?? NSScreen.screens.first else { return nil }
        return TypingCorner.frame(corner: model.typingCorner, place: model.typingPlace, screen: screen.frame,
                                  topInset: max(NSStatusBar.system.thickness, screen.safeAreaInsets.top),
                                  size: model.typingSize.typingSize, on: screens())
    }

    /// Put in its place — never while it is held (a key or a display change mid-drag leaves it in the hand).
    private func place(_ panel: TypingCatPanel) {
        guard !dragging, var frame = target else { return }
        if offscreen { frame.origin.x += 40_000 }
        panel.place(frame)
        if PointerWatch.shared.watches("typingCat") { PointerWatch.shared.refresh() }
    }

    // MARK: Moving it (#331)

    /// While it is out: the app's one mouse ear (#64) tells it when the pointer is over the drawn cat, and only then does
    /// the window take the mouse. Far away, the ear looks only now and then (`PointerPace`).
    private func watchPointer() {
        guard !PointerWatch.shared.watches("typingCat") else { return }
        PointerWatch.shared.watch("typingCat", distance: { [weak self] point in
            guard let self, let panel = self.panel, panel.isShown else { return .infinity }
            return PointerPace.distance(from: point, to: TypingCorner.catBox(in: panel.frame))
        }, moved: { [weak self] point in
            guard let self, !self.dragging, let panel = self.panel else { return }
            panel.takesMouse = panel.isShown && TypingCorner.isOnCat(point, frame: panel.frame)
        })
    }

    /// The bench: whether clicks pass through the window now (true) or the cat takes them.
    var passesClicks: Bool { panel?.takesMouse != true }

    /// Pressed on the cat and moved past the threshold: held until let go.
    func dragBegan() {
        guard isShown else { return }
        dragging = true
    }

    /// Let go: kept wholly on the display it is mostly on, and that place kept as 옮긴 자리 (chosen in Settings now).
    func dragEnded() {
        guard dragging, let panel else { return }
        dragging = false
        droppedAt = now
        var frame = panel.frame
        if offscreen { frame.origin.x -= 40_000 }
        if let dropped = TypingCorner.dropped(frame, on: screens()) {
            model.typingPlace = dropped.place
            // The same place either way: choosing 옮긴 자리 again puts it there too.
            model.typingCorner = .moved
            var kept = dropped.frame
            if offscreen { kept.origin.x += 40_000 }
            panel.place(kept)
        }
        PointerWatch.shared.refresh()
        // 종이냥에서만: it stays `linger` from now, then goes.
        update()
    }

    /// The bench: a drag as the window's view makes one — pressed, moved by `offset`, let go.
    func drag(by offset: CGVector) {
        guard let panel else { return }
        dragBegan()
        guard dragging else { return }
        panel.place(panel.frame.offsetBy(dx: offset.dx, dy: offset.dy))
        dragEnded()
    }

    // MARK: Keys

    private var now: Double { ProcessInfo.processInfo.systemUptime }
    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    /// A key went down (from `TypingKeys`; the bench calls it directly).
    func typed() {
        guard keys.source != .none else { return }
        arm(cat.key(at: now, reduceMotion: reduceMotion))
        update()
    }

    /// The one timer: woken at the paw's time, it puts it back, or sleeps on when a newer key moved the time.
    private func arm(_ due: Double?) {
        guard var due, pawTask == nil else { return }
        pawTask = Task { @MainActor [weak self] in
            while true {
                try? await Task.sleep(for: .seconds(max(0, due - ProcessInfo.processInfo.systemUptime)))
                guard let self, !Task.isCancelled else { return }
                guard let next = self.cat.wake(at: self.now) else { break }
                due = next
            }
            guard let self else { return }
            self.pawTask = nil
            if self.isShown { self.panel?.show(self.cat.pose) }
        }
    }

    /// 종이냥에서만: one wait until `linger` after the last key (or the last drop); a newer one moves it on, then the cat
    /// goes. Held by a drag meanwhile, it waits: letting go starts the wait again.
    private func armGo() {
        guard goTask == nil else { return }
        goTask = Task { @MainActor [weak self] in
            while true {
                guard let self, let last = self.lastTouch else { return }
                try? await Task.sleep(for: .seconds(max(0, last + TypingCat.linger - ProcessInfo.processInfo.systemUptime)))
                guard !Task.isCancelled else { return }
                if self.dragging { self.goTask = nil; return }
                if !((self.lastTouch.map { self.now - $0 < TypingCat.linger }) ?? false) { break }
            }
            guard let self else { return }
            self.goTask = nil
            self.update()
        }
    }

    /// The last key or drop, whichever was later.
    private var lastTouch: Double? { [cat.lastKey, droppedAt].compactMap { $0 }.max() }

    /// 종이냥 한마디 (the pet's) waits after typing.
    var chatterWaits: Bool { cat.typed(within: TypingCat.chatterQuiet, of: now) }

    /// The paws rest and nothing waits for them.
    private func stopPaws() {
        pawTask?.cancel()
        pawTask = nil
        cat.stop()
    }

    /// Quitting: nothing is heard any more.
    func shutDown() {
        keys.stop()
        goTask?.cancel()
        goTask = nil
        stopPaws()
        dragging = false
        PointerWatch.shared.stop("typingCat")
        panel?.hide(fade: false)
    }

    /// Tests: whether anything still waits or runs.
    var isQuiet: Bool { pawTask == nil && goTask == nil && cat.returnAt == nil }
    var heard: TypingSource { keys.source }

    /// The menu bar's 타닥냥: checked while on; it turns the cat off, or back to what it was.
    func menuItem() -> NSMenuItem {
        let item = PetMenuItem(L("타닥냥")) { [weak self] in self?.model.toggleTypingCat() }
        item.state = model.typingScope == .off ? .off : .on
        return item
    }
}

/// The typing cat's window: a transparent panel that never takes the keyboard, in the chosen corner (or where it was
/// dragged), on every Space including full-screen ones. Clicks pass through it except over the drawn cat (`takesMouse`),
/// where a press and a drag move it (#331); a click without moving does nothing. It is hidden from the menu bar's menu
/// or Settings. Screen sharing shows it like any window.
@MainActor
final class TypingCatPanel {
    private let panel: NSPanel
    private let imageView = TypingCatView()
    private var pose: TypingCat.Pose?
    /// Moved on by each show and hide, so a fade that ends after the cat came back leaves it.
    private var turn = 0
    private var going = false
    var onDragStart: () -> Void {
        get { imageView.onDragStart }
        set { imageView.onDragStart = newValue }
    }
    var onDragEnd: () -> Void {
        get { imageView.onDragEnd }
        set { imageView.onDragEnd = newValue }
    }

    /// Over the drawn cat: the window takes the mouse; anywhere else (and while hidden) clicks go to the app behind.
    var takesMouse: Bool {
        get { !panel.ignoresMouseEvents }
        set { if panel.ignoresMouseEvents == newValue { panel.ignoresMouseEvents = !newValue } }
    }

    init() {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: TypingCorner.size, height: TypingCorner.size),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.title = L("타닥냥")
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.ignoresMouseEvents = true
        // Over the cat, moves reach the app's one mouse ear (its local monitor), so it hears the pointer leave it.
        panel.acceptsMouseMovedEvents = true
        panel.becomesKeyOnlyIfNeeded = true
        // Every Space, full-screen ones too.
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        imageView.imageScaling = .scaleProportionallyUpOrDown
        imageView.setAccessibilityElement(false)
        panel.contentView = imageView
    }

    var isShown: Bool { panel.isVisible && !going }
    var frame: NSRect { panel.frame }

    /// Its frame: a corner's, or 옮긴 자리 (the side is the chosen 크기, #304; 112 at 보통). The picture fills it.
    func place(_ frame: NSRect) {
        if panel.frame != frame { panel.setFrame(frame, display: false) }
    }

    func show(_ pose: TypingCat.Pose) {
        if pose != self.pose, let image = PetArt.typing(pose) {
            self.pose = pose
            imageView.image = image
        }
        if going {
            turn += 1
            going = false
            panel.alphaValue = 1
        }
        if !panel.isVisible { panel.orderFrontRegardless() }
    }

    /// Quietly away: a quarter-second fade (none with reduced motion).
    func hide(fade: Bool) {
        guard panel.isVisible, !going else { return }
        turn += 1
        takesMouse = false
        guard fade else { panel.orderOut(nil); return }
        let mine = turn
        going = true
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.25
            panel.animator().alphaValue = 0
        }
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(0.3))
            guard let self, self.turn == mine else { return }
            self.going = false
            self.panel.orderOut(nil)
            self.panel.alphaValue = 1
        }
    }
}

/// #331: the cat's picture, which a press on the drawn cat and a drag move with the window (the window takes the mouse
/// only there, `TypingCatPanel.takesMouse`). A click without moving does nothing; nothing here takes the keyboard.
final class TypingCatView: NSImageView {
    var onDragStart: () -> Void = {}
    var onDragEnd: () -> Void = {}
    /// Where the press was (the pointer on the screens) and where the window was then.
    private var press: (pointer: NSPoint, origin: NSPoint)?
    private var moving = false
    /// Points the pointer moves before a press is a drag (a click that wobbles stays a click).
    private let threshold: CGFloat = 3

    override var mouseDownCanMoveWindow: Bool { false }
    // The app isn't active (the panel never takes the keyboard): the first press drags already.
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func isAccessibilityElement() -> Bool { false }

    override func mouseDown(with event: NSEvent) {
        guard let window else { return }
        press = (NSEvent.mouseLocation, window.frame.origin)
        moving = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window, let press else { return }
        let pointer = NSEvent.mouseLocation
        let dx = pointer.x - press.pointer.x, dy = pointer.y - press.pointer.y
        if !moving {
            guard hypot(dx, dy) >= threshold else { return }
            moving = true
            onDragStart()
        }
        window.setFrameOrigin(NSPoint(x: press.origin.x + dx, y: press.origin.y + dy))
    }

    override func mouseUp(with event: NSEvent) {
        let moved = moving
        press = nil
        moving = false
        if moved { onDragEnd() }
    }

    // Inert: no menu of its own (the menu bar's 타닥냥 and Settings have its switch).
    override func rightMouseDown(with event: NSEvent) {}
    override func menu(for event: NSEvent) -> NSMenu? { nil }
}
