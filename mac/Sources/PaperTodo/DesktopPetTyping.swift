import AppKit
import Combine
import PaperCore

/// 치면 두드리는 고양이 (#230, docs/plans/typing-cat.md): the pet's paws for typing. It hears keys (`TypingKeys`) while
/// the pet is out and the setting is on, runs the rules (`TypingCat`: a paw at once, rest 0.12 s after the last key,
/// one timer at most) and shows the pose on one cat — the pet above the Dock, or, in all apps while a full-screen app
/// covers it, the small cat in a corner (`TypingCompanionPanel`). Never both.
@MainActor
final class PetTyping {
    /// What the pet above the Dock does with typing (DesktopPetController).
    struct Host {
        var isVisible: () -> Bool
        /// Its strip can't be seen (a full-screen app over it).
        var isCovered: () -> Bool
        var doing: () -> TypingCat.Doing
        /// Make room for a paw: stop walking, wake up, put a small moment away.
        var prepare: (TypingCat.Reply) -> Void
        /// On its cushion with this paw down (nil: back to its usual self).
        var show: (TypingCat.Pose?) -> Void
        /// The screen it lives on.
        var screen: () -> NSScreen?
    }

    private(set) var cat = TypingCat()
    private let model: AppModel
    private let preferences: UserDefaults
    private let access: InputMonitoringAccess
    let keys = TypingKeys()
    private var host: Host?
    private var pawTask: Task<Void, Never>?
    private var companion: TypingCompanionPanel?
    private var companionTask: Task<Void, Never>?
    private var locked = false
    private var subscriptions = Set<AnyCancellable>()
    /// `--offscreen`: the small cat far off every screen too.
    var offscreen = false

    init(model: AppModel, preferences: UserDefaults, access: InputMonitoringAccess) {
        self.model = model
        self.preferences = preferences
        self.access = access
        keys.onKey = { [weak self] in self?.typed() }
        keys.onTapLost = { [weak self] in self?.refresh() }
    }

    func attach(_ host: Host) {
        self.host = host
        // Chosen in Settings (not at launch): ask macOS once, if this build never did.
        model.$petTyping.dropFirst().removeDuplicates().sink { [weak self] scope in
            DispatchQueue.main.async { self?.chose(scope) }
        }.store(in: &subscriptions)
        Publishers.Merge(model.$petCompanion.dropFirst().map { _ in () }, model.$petCompanionCorner.dropFirst().map { _ in () })
            .sink { [weak self] _ in DispatchQueue.main.async { self?.refresh() } }
            .store(in: &subscriptions)
        // The permission may have changed in System Settings meanwhile; the screens and Spaces may have moved.
        let center = NotificationCenter.default
        Publishers.Merge(center.publisher(for: NSApplication.didBecomeActiveNotification),
                         center.publisher(for: NSApplication.didChangeScreenParametersNotification))
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.refresh() }.store(in: &subscriptions)
        NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.activeSpaceDidChangeNotification)
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.refresh() }.store(in: &subscriptions)
        let distributed = DistributedNotificationCenter.default()
        distributed.publisher(for: Notification.Name("com.apple.screenIsLocked"))
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.locked = true; self?.refresh() }.store(in: &subscriptions)
        distributed.publisher(for: Notification.Name("com.apple.screenIsUnlocked"))
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.locked = false; self?.refresh() }.store(in: &subscriptions)
        refresh()
    }

    private var buildKey: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "dev" }
    private var askedThisBuild: Bool { preferences.string(forKey: "pet.typing.askedBuild") == buildKey }

    private func chose(_ scope: TypingCat.Scope) {
        if TypingSource.shouldAsk(scope: scope, granted: access.granted, askedThisBuild: askedThisBuild, chosenNow: true) {
            preferences.set(buildKey, forKey: "pet.typing.askedBuild")
            access.request()
        }
        refresh()
    }

    /// Brings everything in line with the setting, the permission and the pet: what is heard, and which cat shows.
    func refresh() {
        guard let host else { return }
        let shown = host.isVisible()
        let granted = model.petTyping == .everywhere && access.granted
        let before = keys.source
        keys.use(TypingSource.of(scope: model.petTyping, granted: granted, petShown: shown))
        // A tap macOS wouldn't make counts as not allowed (the pet hidden, nothing is tapped, and that's fine).
        let working = granted && (!shown || keys.source == .everywhere)
        let noPermission = TypingSource.showsNoPermission(scope: model.petTyping, granted: working)
        if model.typingNoPermission != noPermission { model.typingNoPermission = noPermission }
        // Heard from elsewhere now (turned off, hidden, the permission gone): the paws rest; with nothing heard the pet
        // leaves its cushion.
        if keys.source != before {
            stopPaws()
            if onCushion { host.show(keys.source == .none ? nil : .idle) }
        }
        let wanted = TypingCompanion.shows(source: keys.source, enabled: model.petCompanion, petShown: shown,
                                           dockCovered: host.isCovered(), locked: locked)
        if wanted {
            if let companion, companion.isShown {
                companion.place(on: host.screen(), corner: model.petCompanionCorner, offscreen: offscreen)
            } else if companionTask == nil {
                // A moment's wait, so a Space sliding past doesn't flash it.
                companionTask = Task { @MainActor [weak self] in
                    try? await Task.sleep(for: .seconds(0.4))
                    guard let self, !Task.isCancelled else { return }
                    self.companionTask = nil
                    self.showCompanion()
                }
            }
        } else {
            companionTask?.cancel()
            companionTask = nil
            hideCompanion()
        }
    }

    var companionShown: Bool { companion?.isShown == true }
    /// Tests: where the small cat is.
    var companionFrame: NSRect? { companion?.frame }

    private func showCompanion() {
        guard let host, TypingCompanion.shows(source: keys.source, enabled: model.petCompanion, petShown: host.isVisible(),
                                              dockCovered: host.isCovered(), locked: locked) else { return }
        // The pet above the Dock leaves its cushion; the small cat takes the paws over.
        host.show(nil)
        let panel = companion ?? TypingCompanionPanel()
        companion = panel
        panel.place(on: host.screen(), corner: model.petCompanionCorner, offscreen: offscreen)
        panel.show(cat.pose)
    }

    private func hideCompanion() {
        guard let companion, companion.isShown else { return }
        companion.hide()
        cat.stop()
        pawTask?.cancel()
        pawTask = nil
    }

    // MARK: Keys

    private var now: Double { ProcessInfo.processInfo.systemUptime }
    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    /// A key went down (from `TypingKeys`; tests call it directly).
    func typed() {
        guard let host else { return }
        if companionShown {
            arm(cat.key(at: now, reduceMotion: reduceMotion))
            companion?.show(cat.pose)
            return
        }
        let reply = TypingCat.reply(to: host.doing())
        guard reply != .ignore else { return }
        host.prepare(reply)
        arm(cat.key(at: now, reduceMotion: reduceMotion))
        host.show(cat.pose)
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
            self.publish()
        }
    }

    private func publish() {
        if companionShown { companion?.show(cat.pose) } else if onCushion { host?.show(cat.pose) }
    }

    /// The pet above the Dock is on its cushion (set by it).
    var onCushion = false

    /// Typed lately: the cat stays on its cushion (`TypingCat.linger`).
    var typedLately: Bool { cat.typed(within: TypingCat.linger, of: now) }
    /// 종이냥 한마디 waits.
    var chatterWaits: Bool { cat.typed(within: TypingCat.chatterQuiet, of: now) }

    /// The paws rest and nothing waits (a clip took over, the pet went away).
    func stopPaws() {
        pawTask?.cancel()
        pawTask = nil
        cat.stop()
    }

    /// Quitting: nothing is heard any more.
    func shutDown() {
        keys.stop()
        stopPaws()
        companionTask?.cancel()
        companionTask = nil
        companion?.hide()
    }

    /// Tests: whether anything still waits or runs for the paws.
    var isQuiet: Bool { pawTask == nil && cat.returnAt == nil }
    var heard: TypingSource { keys.source }
}

/// The small cat over full-screen apps: a transparent, click-through panel that never takes the keyboard, in the chosen
/// corner of the pet's screen, on every Space including full-screen ones. Nothing in it reacts to the mouse; the
/// person hides it from the pet's or the menu bar's menu. Screen sharing shows it like any window.
@MainActor
final class TypingCompanionPanel {
    private let panel: NSPanel
    private let imageView = NSImageView()
    private var pose: TypingCat.Pose?

    init() {
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: TypingCompanion.size, height: TypingCompanion.size),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        panel.title = L("종이냥")
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.ignoresMouseEvents = true
        panel.becomesKeyOnlyIfNeeded = true
        // Every Space, full-screen ones too (the pet above the Dock stays off those).
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        imageView.imageScaling = .scaleProportionallyUpOrDown
        imageView.setAccessibilityElement(false)
        panel.contentView = imageView
    }

    var isShown: Bool { panel.isVisible }
    var frame: NSRect { panel.frame }

    func place(on screen: NSScreen?, corner: TypingCompanion.Corner, offscreen: Bool) {
        guard let screen = screen ?? NSScreen.main ?? NSScreen.screens.first else { return }
        var frame = TypingCompanion.frame(corner: corner, screen: screen.frame, topInset: max(NSStatusBar.system.thickness, screen.safeAreaInsets.top))
        if offscreen { frame.origin.x += 40_000 }
        if panel.frame != frame { panel.setFrame(frame, display: false) }
    }

    func show(_ pose: TypingCat.Pose) {
        if pose != self.pose, let image = PetArt.typing(pose) {
            self.pose = pose
            imageView.image = image
        }
        if !panel.isVisible { panel.orderFrontRegardless() }
    }

    func hide() {
        panel.orderOut(nil)
    }
}
