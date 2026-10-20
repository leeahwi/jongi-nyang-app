import AppKit
import Combine
import PaperCore
import SwiftUI

/// The paper cat living just above the Dock. It sits, blinks, looks around, wanders a little,
/// dozes off when the Mac is left alone and cheers when a task is finished. The focus timer
/// is its own little window (`FocusTimerController`); the cat only cheers when it ends.
///
/// The window is a transparent strip along the bottom of the screen that ignores the mouse
/// everywhere except over the cat, so it never blocks clicks meant for other apps.
@MainActor
final class DesktopPetController {
    let state = PetState()
    private let model: AppModel
    private let preferences: UserDefaults
    private let onOpenNote: () -> Void
    /// The 타이머 submenu, provided by the timer.
    var timerMenu: () -> NSMenu = { NSMenu() }
    private var panel: NSPanel?
    private var monitors: [Any] = []
    private var clipTask: Task<Void, Never>?
    private var idleTask: Task<Void, Never>?
    private var messageTask: Task<Void, Never>?
    private var subscriptions = Set<AnyCancellable>()
    private var dragOrigin: CGFloat?
    private var asleep = false
    /// The spot the person chose (by dragging); wandering stays near it.
    private var anchorX: CGFloat = 0
    private var lastCompleted: Int
    private static let stripHeight: CGFloat = 250
    /// 종이냥 한마디: busy elsewhere (focus timer running, a reminder up) means later.
    var isBusy: () -> Bool = { false }
    /// ‘쉴래요’ on the rest question: a five-minute timer.
    var onRest: () -> Void = {}
    /// 다음 일정까지 25분 집중.
    var onFocus: () -> Void = {}
    private var chatterTimer: Timer?
    private var nextChatter = Date().addingTimeInterval(Double.random(in: 300...600))
    private var questionTask: Task<Void, Never>?

    init(model: AppModel, preferences: UserDefaults, onOpenNote: @escaping () -> Void) {
        self.model = model
        self.preferences = preferences
        self.onOpenNote = onOpenNote
        lastCompleted = model.totalCompletedCount
        model.$petVisible.removeDuplicates().sink { [weak self] visible in
            DispatchQueue.main.async { self?.setVisible(visible) }
        }.store(in: &subscriptions)
        // A task checked off anywhere gets a little cheer.
        model.objectWillChange.sink { [weak self] _ in
            DispatchQueue.main.async { self?.checkForCompletion() }
        }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.layout() }.store(in: &subscriptions)
        let timer = Timer(timeInterval: 30, repeats: true) { _ in
            Task { @MainActor [weak self] in self?.checkChatter() }
        }
        timer.tolerance = 5
        RunLoop.main.add(timer, forMode: .common)
        chatterTimer = timer
    }

    var isVisible: Bool { panel?.isVisible == true }

    /// Where the cat is on screen — reminders appear above it instead of walking in a second cat.
    var anchorFrame: NSRect? {
        guard let panel, panel.isVisible else { return nil }
        let x = PetMotion.frame(state.activity, homeX: state.homeX, at: Date()).x
        return NSRect(x: panel.frame.minX + x - state.size / 2, y: panel.frame.minY, width: state.size, height: state.size)
    }

    // MARK: Showing

    private func setVisible(_ visible: Bool) {
        if visible {
            if isVisible { return }
            let panel = panel ?? makePanel()
            layout()
            panel.orderFrontRegardless()
            installMouseMonitors()
            settle()
            scheduleIdle()
        } else {
            panel?.orderOut(nil)
            removeMouseMonitors()
            idleTask?.cancel()
            clipTask?.cancel()
            dragOrigin = nil
        }
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = L("종이냥")
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.ignoresMouseEvents = true
        panel.acceptsMouseMovedEvents = true
        // Every desktop, but not over full-screen apps (videos, presentations).
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        let view = DesktopPetView(
            state: state,
            onTap: { [weak self] in self?.petted() },
            onDoubleTap: { [weak self] in self?.onOpenNote() },
            onDrag: { [weak self] dx in self?.drag(by: dx) },
            onDragEnd: { [weak self] in self?.dragEnded() },
            onAnswer: { [weak self] index in self?.answer(index) }
        )
        let hosting = PetHostingView(rootView: view)
        hosting.onRightClick = { [weak self] event in
            guard let self, let panel = self.panel else { return }
            NSMenu.popUpContextMenu(self.menu(), with: event, for: panel.contentView!)
        }
        panel.contentView = hosting
        self.panel = panel
        return panel
    }

    private var homeFraction: Double {
        preferences.object(forKey: "pet.homeFraction") == nil ? 0.78 : preferences.double(forKey: "pet.homeFraction")
    }

    /// A strip along the bottom of the pet's screen, just above the Dock.
    private func layout() {
        guard let panel else { return }
        let screen = savedScreen() ?? NSScreen.main ?? NSScreen.screens.first
        guard let area = screen?.visibleFrame else { return }
        panel.setFrame(NSRect(x: area.minX, y: area.minY, width: area.width, height: Self.stripHeight), display: true)
        anchorX = clampX(area.width * homeFraction)
        state.homeX = anchorX
    }

    private func savedScreen() -> NSScreen? {
        let id = preferences.integer(forKey: "pet.screen")
        return NSScreen.screens.first { ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? Int) == id }
    }

    private func clampX(_ x: CGFloat) -> CGFloat {
        let width = panel?.frame.width ?? 800
        return min(max(x, 70), width - 70)
    }

    // MARK: Mouse: click-through except over the cat

    private func installMouseMonitors() {
        guard monitors.isEmpty else { return }
        let update: (NSEvent) -> Void = { [weak self] _ in self?.updateInteractivity() }
        if let global = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged], handler: update) { monitors.append(global) }
        if let local = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved], handler: { event in update(event); return event }) { monitors.append(local) }
    }

    private func removeMouseMonitors() {
        monitors.forEach(NSEvent.removeMonitor)
        monitors.removeAll()
    }

    private func updateInteractivity() {
        guard let panel, dragOrigin == nil else { return }
        let point = NSEvent.mouseLocation
        let over = (anchorFrame.map { $0.insetBy(dx: -8, dy: 0).contains(point) } ?? false)
            || (questionFrame?.contains(point) ?? false)
        if panel.ignoresMouseEvents == over { panel.ignoresMouseEvents = !over }
    }

    // MARK: Behaviour

    private var restingAction: PetAction { asleep ? .sleep : .sit }
    private var reduceMotion: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    /// Plays a short clip, then returns to resting and plans the next thing to do.
    func play(_ action: PetAction) {
        guard isVisible else { return }
        clipTask?.cancel()
        let activity = PetActivity(action)
        state.activity = activity
        clipTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(activity.duration))
            guard !Task.isCancelled, let self else { return }
            if case .walk(_, let to) = action { self.state.homeX = to }
            self.settle()
            self.scheduleIdle()
        }
    }

    private func settle() {
        state.activity = PetActivity(restingAction)
    }

    private func scheduleIdle() {
        idleTask?.cancel()
        idleTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(Double.random(in: 5...14)))
            guard !Task.isCancelled, let self else { return }
            self.idle()
        }
    }

    /// Picks what to do next. Resting between clips means no redraws most of the time.
    private func idle() {
        guard isVisible else { return }
        let away = systemIdleSeconds()
        if asleep {
            if away < 5 { asleep = false; play(.stretch) } else { scheduleIdle() }
            return
        }
        if away > 300 {
            asleep = true
            play(.yawn)
            return
        }
        var choices: [(PetAction, Int)] = [(.blink, 34), (.tilt, 14), (.sit, 12), (.stretch, 7), (.yawn, 3)]
        if !reduceMotion { choices += [(.hop, 5)] }
        if PetArt.has(.groom) { choices.append((.groom, 7)) }
        if PetArt.has(.tea) { choices.append((.tea, 5)) }
        if model.petWanders && !reduceMotion {
            let target = clampX(anchorX + CGFloat.random(in: -170...170))
            if abs(target - state.homeX) > 40 { choices.append((.walk(from: state.homeX, to: target), 22)) }
        }
        let total = choices.reduce(0) { $0 + $1.1 }
        var pick = Int.random(in: 0..<total)
        for (action, weight) in choices {
            if pick < weight {
                if action == .sit { settle(); scheduleIdle() } else { play(action) }
                return
            }
            pick -= weight
        }
    }

    private func systemIdleSeconds() -> TimeInterval {
        let types: [CGEventType] = [.mouseMoved, .keyDown, .leftMouseDown, .scrollWheel]
        return types.map { CGEventSource.secondsSinceLastEventType(.combinedSessionState, eventType: $0) }.min() ?? 0
    }

    private func petted() {
        if asleep { asleep = false; play(.stretch); return }
        play(.happy)
        // Now and then a word back.
        if model.chatterEnabled, state.message == nil, state.question == nil, Bool.random() {
            say(PetChatter.petted(language: .current, random: { Double.random(in: 0..<1) }).text, for: 3)
        }
    }

    private func checkForCompletion() {
        let completed = model.totalCompletedCount
        defer { lastCompleted = completed }
        guard completed > lastCompleted, isVisible, !asleep else { return }
        play(.cheer)
    }

    /// A small hop to say "look up here" when a reminder bubble appears above the cat.
    func greet() {
        asleep = false
        play(.hop)
    }

    /// The focus timer finished a stretch: wake up and cheer (the timer shows its own message).
    func celebrate() {
        asleep = false
        play(.cheer)
    }

    // MARK: Dragging

    private func drag(by dx: CGFloat) {
        if dragOrigin == nil {
            dragOrigin = state.homeX
            clipTask?.cancel()
            idleTask?.cancel()
            asleep = false
            settle()
        }
        state.homeX = clampX(dragOrigin! + dx)
    }

    private func dragEnded() {
        guard dragOrigin != nil else { return }
        dragOrigin = nil
        // Dropped over another display: move there.
        let point = NSEvent.mouseLocation
        let current = savedScreen() ?? NSScreen.main
        if let target = NSScreen.screens.first(where: { $0.frame.contains(point) }), target.frame != current?.frame,
           let id = target.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? Int {
            preferences.set(id, forKey: "pet.screen")
            preferences.set(Double((point.x - target.visibleFrame.minX) / target.visibleFrame.width), forKey: "pet.homeFraction")
            layout()
            play(.hop)
            return
        }
        anchorX = state.homeX
        if let width = panel?.frame.width, width > 0 { preferences.set(Double(anchorX / width), forKey: "pet.homeFraction") }
        play(.hop)
    }

    // MARK: Speech

    func say(_ text: String, for seconds: TimeInterval = 6) {
        messageTask?.cancel()
        dropQuestion()
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) { state.message = text }
        messageTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            withAnimation(.easeIn(duration: 0.15)) { self?.state.message = nil }
        }
    }

    // MARK: 종이냥 한마디

    /// Every half minute: time for a line, if the cat is out, awake, the person is here, and
    /// nothing else is going on. Otherwise it tries again a little later.
    private func checkChatter() {
        guard model.chatterEnabled, isVisible, Date() >= nextChatter else { return }
        let now = Date()
        guard !asleep, dragOrigin == nil, !isBusy(), state.message == nil, state.question == nil,
              !PetChatter.isQuietHour(Calendar.paper.component(.hour, from: now)), systemIdleSeconds() < 120 else {
            nextChatter = now.addingTimeInterval(120)
            return
        }
        speakUp()
    }

    /// Says a line or asks a question now (also Settings → 지금 한마디 듣기).
    func speakUp() {
        guard isVisible else { return }
        asleep = false
        var recent = preferences.stringArray(forKey: "chatter.recent") ?? []
        let line = PetChatter.pick(model.chatterContext(), questions: model.chatterQuestions, recent: recent, language: .current, random: { Double.random(in: 0..<1) })
        recent = Array(([line.id] + recent.filter { $0 != line.id }).prefix(12))
        preferences.set(recent, forKey: "chatter.recent")
        nextChatter = Date().addingTimeInterval(PetChatter.nextDelay(model.chatterFrequency, random: { Double.random(in: 0..<1) }))
        if line.isQuestion {
            ask(line)
        } else {
            say(line.text, for: 8)
            play(.tilt)
        }
    }

    private func ask(_ line: PetChatter.Line) {
        messageTask?.cancel()
        state.message = nil
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) { state.question = line }
        play(reduceMotion ? .tilt : .hop)
        questionTask?.cancel()
        // Unanswered, it quietly goes away.
        questionTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(25))
            guard !Task.isCancelled else { return }
            self?.dropQuestion()
        }
    }

    /// A question of the app's own (1.38: the login item): `onAnswer` gets the button's index.
    func ask(_ line: PetChatter.Line, onAnswer: @escaping (Int) -> Void) {
        guard isVisible else { return }
        ownAnswer = onAnswer
        asleep = false
        ask(line)
    }
    private var ownAnswer: ((Int) -> Void)?

    private func answer(_ index: Int) {
        guard let line = state.question, line.answers.indices.contains(index) else { return }
        let answer = line.answers[index]
        if let own = ownAnswer {
            ownAnswer = nil
            own(index)
        }
        say(answer.reply, for: 5)
        play(action(for: answer.pose))
        if answer.action == .rest5 { onRest() }
        if answer.action == .focus25 { onFocus() }
    }

    private func dropQuestion() {
        questionTask?.cancel()
        ownAnswer = nil
        guard state.question != nil else { return }
        withAnimation(.easeIn(duration: 0.15)) { state.question = nil }
        updateInteractivity()
    }

    /// The bubble with answer buttons takes clicks too (where it is drawn: slid inward near an edge).
    private var questionFrame: NSRect? {
        guard state.question != nil, let panel, panel.isVisible else { return nil }
        let x = PetMotion.frame(state.activity, homeX: state.homeX, at: Date()).x
        let width = max(state.bubbleWidth, state.size + 40)
        let shift = PetBubble.shift(centerX: x, width: state.bubbleWidth, stripWidth: panel.frame.width)
        return NSRect(x: panel.frame.minX + x + shift - width / 2, y: panel.frame.minY, width: width, height: state.size + 150)
    }

    private func action(for pose: PetChatter.Pose) -> PetAction {
        switch pose {
        case .happy: .happy
        case .cheer: .cheer
        case .tilt: .tilt
        case .stretch: .stretch
        case .yawn: .yawn
        case .tea: PetArt.has(.tea) ? .tea : .happy
        case .blink: .blink
        case .hop: reduceMotion ? .happy : .hop
        }
    }

    // MARK: Menu

    func menu() -> NSMenu {
        let menu = NSMenu()
        let timerItem = NSMenuItem(title: L("타이머"), action: nil, keyEquivalent: "")
        timerItem.submenu = timerMenu()
        menu.addItem(timerItem)
        menu.addItem(PetMenuItem(L("빠른 메모")) { [weak self] in self?.model.showQuickMemo() })
        menu.addItem(PetMenuItem(L("알람…")) { [weak self] in self?.model.showAlarmSettings() })
        menu.addItem(PetMenuItem(L("설정…")) { [weak self] in self?.model.showDesk(.pet) })
        menu.addItem(.separator())
        menu.addItem(PetMenuItem(L("노트 열기")) { [weak self] in self?.onOpenNote() })
        let wander = PetMenuItem(L("돌아다니기")) { [weak self] in self?.model.petWanders.toggle() }
        wander.state = model.petWanders ? .on : .off
        menu.addItem(wander)
        menu.addItem(PetMenuItem(L("펫 숨기기")) { [weak self] in self?.model.petVisible = false })
        return menu
    }
}

/// Hosts the pet and forwards right-clicks (SwiftUI has no context-menu hook for a floating panel).
final class PetHostingView<Content: View>: NSHostingView<Content> {
    var onRightClick: (NSEvent) -> Void = { _ in }
    override func rightMouseDown(with event: NSEvent) { onRightClick(event) }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

@MainActor
final class PetMenuItem: NSMenuItem {
    private let handler: () -> Void

    init(_ title: String, handler: @escaping () -> Void) {
        self.handler = handler
        super.init(title: title, action: #selector(run), keyEquivalent: "")
        target = self
    }

    @available(*, unavailable)
    required init(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    @objc private func run() { handler() }
}
