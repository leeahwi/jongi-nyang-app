import AppKit
import Carbon.HIToolbox
import Combine
import PaperCore
import SwiftUI

/// Rings the alarms on this Mac: a paper card with the cat in the middle of the screen (or over
/// the pet), the sound looping until 끄기 or 다시. Ten minutes without an answer snoozes once,
/// then it gives up. The focus timer and reminders never hold an alarm back.
@MainActor
final class AlarmController {
    /// One ring on the card: the alarm, and whether it already snoozed by itself once.
    private struct Ring {
        var alarm: Alarm
        var autoSnoozed = false
    }

    static let ringingLimit: TimeInterval = 10 * 60
    private let book: AlarmBook
    private let state = AlarmRingState()
    private let sound = AlarmSound()
    private var panel: AlarmRingPanel?
    private var timer: Timer?
    private var current: Ring?
    private var waiting: [Ring] = []
    private var snoozes: [Timer] = []
    private var timeoutTask: Task<Void, Never>?
    private var sleeping = false
    private var subscriptions = Set<AnyCancellable>()
    /// Over the pet when it's out.
    var petAnchor: () -> NSRect? = { nil }
    /// Something rang (the pet cheers).
    var onRing: () -> Void = {}

    var isRinging: Bool { current != nil }
    /// The alarm ringing now (시스템 알림's 끄기 · 다시 알림 act on it).
    var ringingID: String? { current?.alarm.id }
    /// Told each ring (시스템 알림으로도 보내기, 1.38).
    var onRingAlarm: (Alarm) -> Void = { _ in }

    init(book: AlarmBook) {
        self.book = book
        state.onStop = { [weak self] in self?.stop() }
        state.onSnooze = { [weak self] minutes in self?.snooze(minutes: minutes) }
        book.objectWillChange.sink { [weak self] _ in
            DispatchQueue.main.async { self?.arm() }
        }.store(in: &subscriptions)
        let center = NSWorkspace.shared.notificationCenter
        center.publisher(for: NSWorkspace.willSleepNotification).receive(on: RunLoop.main).sink { [weak self] _ in
            self?.sleeping = true
            self?.timer?.invalidate()
        }.store(in: &subscriptions)
        center.publisher(for: NSWorkspace.didWakeNotification).receive(on: RunLoop.main).sink { [weak self] _ in
            self?.sleeping = false
            // Rings missed while asleep: within 15 minutes they still go off, older ones are skipped.
            self?.check()
        }.store(in: &subscriptions)
        DispatchQueue.main.async { [weak self] in self?.check() }
    }

    // MARK: When

    /// Waits for the next ring (checking at least every minute, for another device's changes).
    private func arm() {
        timer?.invalidate()
        guard !sleeping else { return }
        let now = Date()
        let delay = book.next(now: now).map { max(0.3, $0.fire.timeIntervalSince(now) + 0.2) } ?? 60
        let timer = Timer(timeInterval: min(60, delay), repeats: false) { _ in
            Task { @MainActor [weak self] in self?.check() }
        }
        timer.tolerance = 0.3
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func check() {
        guard !sleeping else { return }
        book.reloadIfChanged()
        let now = Date()
        for alarm in Alarm.due(book.alarms, now: now, handled: book.handled) {
            if let fire = Alarm.lastFire(alarm, now: now) { book.markHandled(Alarm.key(alarm, fire), now: now) }
            waiting.append(Ring(alarm: alarm))
        }
        presentNext()
        arm()
    }

    // MARK: Ringing

    private func presentNext() {
        guard current == nil, !waiting.isEmpty else { return }
        let ring = waiting.removeFirst()
        current = ring
        state.alarm = ring.alarm
        state.startedAt = Date()
        sound.loop(ring.alarm.sound)
        show()
        onRing()
        onRingAlarm(ring.alarm)
        timeoutTask?.cancel()
        timeoutTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(Self.ringingLimit))
            guard !Task.isCancelled else { return }
            self?.timedOut()
        }
    }

    /// 끄기 (Return): a once-alarm is done and turns itself off.
    func stop() {
        guard let ring = current else { return }
        finish()
        if ring.alarm.isOnce { book.setEnabled(ring.alarm.id, false) }
        presentNext()
    }

    /// 다시 울림: S or Space with the alarm's own length, 1 · 2 · 3 or a chip for 5 · 10 · 15 minutes.
    func snooze(minutes: Int? = nil) {
        // 1.39: an alarm without 다시 울림 (없음) only stops.
        guard let ring = current, ring.alarm.snoozes else { return }
        finish()
        later(ring, minutes: minutes)
        presentNext()
    }

    /// Ten minutes and nobody answered: one snooze, then it gives up (at once without 다시 울림).
    private func timedOut() {
        guard var ring = current else { return }
        finish()
        if ring.autoSnoozed || !ring.alarm.snoozes {
            if ring.alarm.isOnce { book.setEnabled(ring.alarm.id, false) }
        } else {
            ring.autoSnoozed = true
            later(ring)
        }
        presentNext()
    }

    private func later(_ ring: Ring, minutes: Int? = nil) {
        let id = ring.alarm.id, autoSnoozed = ring.autoSnoozed
        let timer = Timer(timeInterval: TimeInterval((minutes ?? ring.alarm.snooze) * 60), repeats: false) { _ in
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.snoozes.removeAll { !$0.isValid }
                // Changed meanwhile: the latest version rings; turned off or removed: nothing.
                guard let alarm = self.book.alarm(id), alarm.enabled else { return }
                self.waiting.append(Ring(alarm: alarm, autoSnoozed: autoSnoozed))
                self.presentNext()
            }
        }
        timer.tolerance = 0.5
        RunLoop.main.add(timer, forMode: .common)
        snoozes.append(timer)
    }

    private func finish() {
        timeoutTask?.cancel()
        sound.stop()
        current = nil
        panel?.orderOut(nil)
    }

    // MARK: The card

    private func show() {
        let panel = panel ?? makePanel()
        panel.show(AlarmRingView(state: state))
        panel.setFrame(frame(size: panel.frame.size), display: true)
        // Keys typed in another app just then don't stop it (clicks always work).
        panel.keysFrom = Date().addingTimeInterval(AlarmRingPanel.keyDelay)
        panel.makeKeyAndOrderFront(nil)
        panel.orderFrontRegardless()
    }

    /// Centred on the screen with the pointer, or just above the pet (`size`: the window's, the
    /// slip and its margins).
    private func frame(size: NSSize) -> NSRect {
        if let pet = petAnchor(), let screen = (NSScreen.screens.first { $0.frame.intersects(pet) } ?? NSScreen.main) {
            let area = screen.visibleFrame
            let x = min(max(pet.midX - size.width / 2, area.minX + 12), area.maxX - size.width - 12)
            let y = min(max(pet.maxY + 8, area.minY + 12), area.maxY - size.height - 12)
            return NSRect(origin: NSPoint(x: x, y: y), size: size)
        }
        let mouse = NSEvent.mouseLocation
        let area = (NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main)?.visibleFrame ?? NSRect(origin: .zero, size: size)
        return NSRect(x: area.midX - size.width / 2, y: area.midY - size.height / 2, width: size.width, height: size.height)
    }

    private func makePanel() -> AlarmRingPanel {
        let panel = AlarmRingPanel(nonactivating: true)
        panel.title = Alarm.untitled(.current)
        panel.level = .statusBar
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isMovableByWindowBackground = true
        panel.onStop = { [weak self] in self?.stop() }
        panel.onSnooze = { [weak self] minutes in self?.snooze(minutes: minutes) }
        self.panel = panel
        return panel
    }
}

/// Return stops, S or Space snoozes (the alarm's own length), 1 · 2 · 3 snooze 5 · 10 · 15
/// minutes, wherever the focus is on the slip — after its first 1.5 seconds, so typing that was
/// going on in another app doesn't answer it.
final class AlarmRingPanel: SlipPanel {
    static let keyDelay: TimeInterval = 1.5
    var onStop: () -> Void = {}
    var onSnooze: (Int?) -> Void = { _ in }
    var keysFrom = Date.distantPast

    override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown || event.type == .keyUp, Date() < keysFrom { return }
        if event.type == .keyDown, event.modifierFlags.intersection([.command, .control, .option]).isEmpty {
            switch Int(event.keyCode) {
            case kVK_Return, kVK_ANSI_KeypadEnter: return onStop()
            case kVK_Space, kVK_ANSI_S: return onSnooze(nil)
            case kVK_ANSI_1, kVK_ANSI_Keypad1: return onSnooze(5)
            case kVK_ANSI_2, kVK_ANSI_Keypad2: return onSnooze(10)
            case kVK_ANSI_3, kVK_ANSI_Keypad3: return onSnooze(15)
            default: break
            }
        }
        super.sendEvent(event)
    }
}

@MainActor
final class AlarmRingState: ObservableObject {
    @Published var alarm: Alarm?
    /// When this ring began (for "1분째 울리는 중").
    @Published var startedAt = Date()
    var onStop: () -> Void = {}
    var onSnooze: (Int?) -> Void = { _ in }
}

/// The alarm's sound: macOS's own system sounds (bell: Glass, soft: Purr, quieter), looping
/// while it rings; ▶ 들어 보기 plays it once.
@MainActor
final class AlarmSound {
    private var playing: NSSound?

    func loop(_ sound: Alarm.Sound) { play(sound, loops: true) }
    func playOnce(_ sound: Alarm.Sound) { play(sound, loops: false) }

    func stop() {
        playing?.stop()
        playing = nil
    }

    private func play(_ sound: Alarm.Sound, loops: Bool) {
        stop()
        let name: String
        switch sound {
        case .bell: name = "Glass"
        case .soft: name = "Purr"
        case .silent: return
        }
        // A copy: the named sound is shared (the timer plays Glass too).
        guard let player = NSSound(named: name)?.copy() as? NSSound else { return }
        player.loops = loops
        player.volume = sound == .soft ? 0.55 : 1
        player.play()
        playing = player
    }
}
