import AppKit
import Combine
import PaperCore
import SwiftUI

@MainActor
final class FocusTimerState: ObservableObject {
    /// The running timer (the board, the 오늘 창, the menu bar): the session's timer.
    @Published var timer: FocusTimer?
    /// What the timer is for: a plain timer, or 집중 on a to-do (the note's focus card).
    @Published var session: FocusSession?
    @Published var message: String?
    /// TimerSize: the whole tag (cat, board, buttons) drawn larger or smaller.
    @Published var scale: CGFloat = 1
    /// The focus card's list of today's other to-dos is open.
    @Published var restOpen = false
    /// Counts the times a focus stretch or break ran out (the card's primary button pulses once).
    @Published var timeUps = 0

    /// 집중 on a to-do is under way (the note shows the focus card).
    var isFocusing: Bool { session?.isFocus == true }
}

/// 이거 집중 · 5분 더 · 다 했어요 …: the steps of a focus session, from the card, the menus and the board.
enum FocusStep: Equatable {
    case done, more, later, takeBreak, nextRound, stopRounds, togglePause
    /// Taken back (the toast's 멈추기, ⌘Z): ends without a line in the record.
    case discard
    /// Esc or the card's ×: asks first, then ends like 다음에.
    case askToStop
}

/// The focus timer, on its own: a paper tag stuck anywhere on the screen, independent of the
/// desktop pet. It exists only while a timer runs (and for a few seconds after, to say it's
/// done). Drag it anywhere; it comes back to the same spot next time.
///
/// 집중 (1.37): a session on a to-do runs on the same clock, but the note shows it as the focus
/// card; the tag stays away unless the note is out of sight. Every stretch of a minute or more goes
/// into focus.jsonl (see Focus / FocusLog).
@MainActor
final class FocusTimerController {
    let state: FocusTimerState
    private let model: AppModel
    private let preferences: UserDefaults
    /// The pet (if it's out) cheers when a stretch of focus or rest ends.
    var onFinished: () -> Void = {}
    /// Whether the note is on screen (the focus card shows there; else the tag stands in).
    var noteVisible: () -> Bool = { false }
    /// Brings the note forward (a focus starting, a click on the tag while focusing).
    var showNote: () -> Void = {}
    /// A focus session ended: task alerts held meanwhile come now.
    var onFocusEnded: () -> Void = {}
    private var panel: NSPanel?
    private var tickTimer: Timer?
    private var messageTask: Task<Void, Never>?
    private var lingerTask: Task<Void, Never>?
    private var dragStart: (mouse: NSPoint, origin: NSPoint)?
    private var subscriptions = Set<AnyCancellable>()
    /// The end of the stretch already announced (chime, pulse), so it's announced once.
    private var announcedEnd: Date?
    /// 직접 정하기…
    private lazy var lengthSheet: CustomTimerSheet = {
        let sheet = CustomTimerSheet { [weak self] minutes in self?.command(.countdown(minutes: minutes)) }
        sheet.recent = { [weak self] in self?.model.timerRecent ?? [] }
        return sheet
    }()
    /// 이거 집중 → 직접 정하기…: the same slip, starting a focus on the to-do picked.
    private var focusLengthTask: UUID?
    private lazy var focusLengthSheet: CustomTimerSheet = {
        let sheet = CustomTimerSheet { [weak self] minutes in
            guard let self, let task = self.focusLengthTask else { return }
            self.command(.focus(task: task, minutes: minutes))
        }
        sheet.recent = { [weak self] in self?.model.timerRecent ?? [] }
        return sheet
    }()
    /// The window at 보통; other sizes scale it.
    static let size = NSSize(width: 250, height: 250)
    private var currentSize: NSSize { NSSize(width: Self.size.width * state.scale, height: Self.size.height * state.scale) }

    init(model: AppModel, preferences: UserDefaults) {
        self.model = model
        self.preferences = preferences
        state = model.timerState
        let saved = preferences.data(forKey: "focus.session").flatMap { try? JSONDecoder().decode(FocusSession.self, from: $0) }
        let timer = preferences.data(forKey: "pet.timer").flatMap { try? JSONDecoder().decode(FocusTimer.self, from: $0) }
        if let saved, saved.timer == timer {
            state.session = saved
        } else if let timer {
            // From before 1.37: the stretch started as long ago as it has run.
            state.session = FocusSession(timer: timer, segmentStart: Date().addingTimeInterval(-timer.elapsed(at: Date())))
        }
        state.timer = state.session?.timer
        state.scale = model.timerSize.scale
        model.$timerSize.dropFirst().removeDuplicates().sink { [weak self] size in
            DispatchQueue.main.async { self?.resize(to: size) }
        }.store(in: &subscriptions)
        NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.didWakeNotification)
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.tick() }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.place() }.store(in: &subscriptions)
        if let session = state.session {
            // A stretch that ran out while the app was closed was announced then (or never will be).
            if session.stage(at: Date()) == .timeUp || session.stage(at: Date()) == .restOver { announcedEnd = session.timer.endsAt }
            startTicking()
            DispatchQueue.main.async { self.updateBoard() }
        }
    }

    var isVisible: Bool { panel?.isVisible == true }
    /// 집중 on a to-do is under way.
    var isFocusing: Bool { state.isFocusing }

    // MARK: Commands

    func command(_ command: PetCommand) {
        let now = Date()
        switch command {
        case .countdown(let minutes):
            end(at: now)
            setSession(FocusSession(timer: .countdown(minutes: minutes, now: now), segmentStart: now))
            // A typed length comes back in every timer menu (presets are there already).
            model.rememberTimer(minutes)
            say(L("\(minutes)분 재 볼게요!"), for: 3)
        case .chooseLength:
            lengthSheet.show()
        case .pomodoro:
            end(at: now)
            setSession(FocusSession(timer: .pomodoro(model.pomodoroSettings, now: now), segmentStart: now))
            say(L("\(model.pomodoroSettings.focusMinutes)분 집중해요. 화이팅!"), for: 3)
        case .togglePause:
            guard var session = state.session else { return }
            if session.timer.isPaused { session.resume(at: now) } else { session.pause(at: now) }
            setSession(session)
        case .addMinutes(let minutes):
            guard var session = state.session else { return }
            session.more(minutes: minutes, at: now)
            setSession(session)
        case .stop:
            end(at: now)
            hide()
        case .focus(let task, let minutes):
            guard let item = model.items.first(where: { $0.id == task }) else { return }
            end(at: now)
            if !TimerLength.presets.contains(minutes) && minutes != model.pomodoroSettings.focusMinutes { model.rememberTimer(minutes) }
            startFocus(.focus(taskId: item.id.uuidString, title: item.title, minutes: minutes, now: now))
        case .focusPomodoro(let task):
            guard let item = model.items.first(where: { $0.id == task }) else { return }
            end(at: now)
            startFocus(.pomodoro(taskId: item.id.uuidString, title: item.title, settings: model.pomodoroSettings, now: now))
        case .focusChooseLength(let task):
            focusLengthTask = task
            focusLengthSheet.show()
        case .pickFocus:
            model.startFocusPick()
            showNote()
        case .focusStep(let step):
            perform(step, at: now)
        }
    }

    private func startFocus(_ session: FocusSession) {
        model.focusPicking = false
        state.restOpen = false
        // The tag steps aside: the note shows the focus card.
        lingerTask?.cancel()
        hide()
        setSession(session)
        showNote()
    }

    private func perform(_ step: FocusStep, at now: Date) {
        guard var session = state.session else { return }
        switch step {
        case .done:
            let task = session.taskId.flatMap(UUID.init(uuidString:))
            end(done: true, at: now)
            if let task { model.completeTask(task) }
        case .more:
            session.more(at: now)
            setSession(session)
        case .later, .stopRounds:
            end(at: now)
        case .takeBreak:
            if let record = session.takeBreak(at: now) { model.focusLog.append(record) }
            setSession(session)
        case .nextRound:
            session.nextRound(at: now)
            setSession(session)
        case .togglePause:
            command(.togglePause)
        case .discard:
            setSession(nil)
            state.restOpen = false
            hide()
            if session.isFocus { onFocusEnded() }
        case .askToStop:
            // Time is up (or the break is over): nothing is lost by closing — it ends like 다음에, no question.
            if [.timeUp, .restOver].contains(session.stage(at: now)) { end(at: now); return }
            // Ask after the click that got here has finished (a modal loop inside a SwiftUI action can't size its slip).
            DispatchQueue.main.async { [weak self] in self?.askToStop() }
        }
    }

    private func askToStop() {
        guard let session = state.session else { return }
        let answer = SlipAlert.run(symbol: "timer", title: L("집중"), message: L("집중을 그만둘까요?"),
                                   detail: session.record(at: Date()) == nil ? nil : L("지금까지 집중한 시간은 기록에 남아요."),
                                   choices: [.init(title: L("계속하기"), isCancel: true),
                                             .init(title: L("그만두기"), role: .primary, isDefault: true)])
        if answer == 1 { end(at: Date()) }
    }

    /// Ends what's running: its stretch goes into the record (a minute or more), the tag goes,
    /// and after a focus the held task alerts come.
    private func end(done: Bool = false, at now: Date) {
        guard let session = state.session else { return }
        if let record = session.record(done: done, at: now) { model.focusLog.append(record) }
        setSession(nil)
        state.restOpen = false
        if session.isFocus {
            hide()
            onFocusEnded()
        }
    }

    private func setSession(_ session: FocusSession?) {
        if session?.timer.endsAt != state.session?.timer.endsAt || session == nil { announcedEnd = nil }
        state.session = session
        state.timer = session?.timer
        preferences.set(session.flatMap { try? JSONEncoder().encode($0.timer) }, forKey: "pet.timer")
        preferences.set(session.flatMap { try? JSONEncoder().encode($0) }, forKey: "focus.session")
        if session == nil {
            stopTicking()
        } else {
            lingerTask?.cancel()
            startTicking()
            updateBoard()
        }
    }

    private func startTicking() {
        guard tickTimer == nil else { return }
        let timer = Timer(timeInterval: 1, repeats: true) { _ in
            Task { @MainActor [weak self] in self?.tick() }
        }
        timer.tolerance = 0.2
        RunLoop.main.add(timer, forMode: .common)
        tickTimer = timer
    }

    private func stopTicking() {
        tickTimer?.invalidate()
        tickTimer = nil
    }

    private func tick() {
        guard var session = state.session else { return }
        updateBoard()
        let now = Date()
        guard session.timer.isFinished(at: now) else { return }
        if session.isFocus {
            // The card waits for a button: the chime, the pulse and the cat's cheer once.
            guard announcedEnd != session.timer.endsAt else { return }
            announcedEnd = session.timer.endsAt
            if model.timerSound { NSSound(named: "Glass")?.play() }
            state.timeUps += 1
            if !noteVisible() {
                say(session.stage(at: now) == .restOver ? L("쉬는 시간 끝! 다음 라운드를 시작할까요?")
                    : Focus.timeUpLine(minutes: session.plannedMinutes, language: .current), for: 10)
            }
            onFinished()
            return
        }
        if model.timerSound { NSSound(named: "Glass")?.play() }
        if session.isPomodoro {
            if let record = session.advance(at: now, autoContinue: model.pomodoroAutoContinue) { model.focusLog.append(record) }
            setSession(session)
            let settings = model.pomodoroSettings
            let hint = model.pomodoroAutoContinue ? "" : "\n" + L("팻말을 누르면 시작해요")
            switch session.timer.phase {
            case .rest: say(L("집중 끝! \(settings.restMinutes)분 쉬어요") + hint)
            case .longRest: say(L("\(settings.roundsBeforeLongRest)번 해냈어요! \(settings.longRestMinutes)분 푹 쉬어요") + hint)
            default: say(L("다시 집중해 볼까요?") + hint)
            }
        } else {
            // Done: only the message stays for a moment, then the tag goes away.
            end(at: now)
            say(L("\(Int(session.timer.duration / 60))분 끝났어요!"), for: 10)
            lingerTask = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .seconds(10))
                guard !Task.isCancelled, self?.state.timer == nil else { return }
                self?.hide()
            }
        }
        onFinished()
    }

    private func say(_ text: String, for seconds: TimeInterval = 6) {
        messageTask?.cancel()
        withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) { state.message = text }
        messageTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            withAnimation(.easeIn(duration: 0.15)) { self?.state.message = nil }
        }
    }

    // MARK: Window

    /// The tag shows for a plain timer, and for a focus only while the note is out of sight.
    func updateBoard() {
        guard let session = state.session else { return }
        if session.isFocus && noteVisible() { hide() } else { show() }
    }

    private func show() {
        let panel = panel ?? makePanel()
        if !panel.isVisible {
            place()
            panel.orderFrontRegardless()
        }
    }

    private func hide() {
        panel?.orderOut(nil)
        dragStart = nil
        messageTask?.cancel()
        // Called every second while focusing with the note in view: setting it again redrew the note (1.39).
        if state.message != nil { state.message = nil }
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(contentRect: NSRect(origin: .zero, size: currentSize), styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.title = L("타이머")
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        // Left unset on purpose: clicks on the window's fully transparent parts go to whatever
        // is behind it, so only the tag (and its bubble) catch the mouse.
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        let view = FocusTimerView(
            state: state,
            onPause: { [weak self] in
                // While focusing, a click on the tag brings the focus card back.
                if self?.isFocusing == true { self?.showNote() } else { self?.command(.togglePause) }
            },
            onStop: { [weak self] in self?.command(.stop) },
            onDrag: { [weak self] in self?.drag() },
            onDragEnd: { [weak self] in self?.dragEnded() }
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

    /// Where the person last put it, or the lower right corner above the Dock.
    private func place() {
        guard let panel else { return }
        let origin: NSPoint
        if preferences.object(forKey: "timer.x") != nil {
            origin = NSPoint(x: preferences.double(forKey: "timer.x"), y: preferences.double(forKey: "timer.y"))
        } else {
            let area = (NSScreen.main ?? NSScreen.screens.first)?.visibleFrame ?? .zero
            origin = NSPoint(x: area.maxX - currentSize.width - 24, y: area.minY + 150)
        }
        panel.setFrame(clamped(NSRect(origin: origin, size: currentSize)), display: true)
    }

    /// A new size: it grows or shrinks around the middle of its bottom edge (where the tag is),
    /// so it stays where it was put.
    private func resize(to size: TimerSize) {
        state.scale = size.scale
        guard let panel else { return }
        let old = panel.frame
        let frame = clamped(NSRect(x: old.midX - currentSize.width / 2, y: old.minY, width: currentSize.width, height: currentSize.height))
        panel.setFrame(frame, display: true)
        if preferences.object(forKey: "timer.x") != nil {
            preferences.set(Double(frame.minX), forKey: "timer.x")
            preferences.set(Double(frame.minY), forKey: "timer.y")
        }
    }

    /// Keeps the tag itself (the lower part of the window) on a screen.
    private func clamped(_ frame: NSRect) -> NSRect {
        let center = NSPoint(x: frame.midX, y: frame.minY + 40)
        guard let area = (NSScreen.screens.first { $0.frame.contains(center) } ?? NSScreen.main)?.visibleFrame else { return frame }
        var result = frame
        result.origin.x = min(max(frame.minX, area.minX - 40), area.maxX - frame.width + 40)
        result.origin.y = min(max(frame.minY, area.minY - 10), area.maxY - frame.height)
        return result
    }

    /// Moves the window with the mouse (a translation would drift as the window moves).
    private func drag() {
        guard let panel else { return }
        let mouse = NSEvent.mouseLocation
        if dragStart == nil { dragStart = (mouse, panel.frame.origin) }
        let start = dragStart!
        panel.setFrameOrigin(NSPoint(x: start.origin.x + mouse.x - start.mouse.x, y: start.origin.y + mouse.y - start.mouse.y))
    }

    private func dragEnded() {
        guard dragStart != nil, let panel else { return }
        dragStart = nil
        let frame = clamped(panel.frame)
        panel.setFrame(frame, display: true)
        preferences.set(Double(frame.minX), forKey: "timer.x")
        preferences.set(Double(frame.minY), forKey: "timer.y")
    }

    // MARK: Menu

    func menu() -> NSMenu {
        let menu = NSMenu()
        if let session = state.session {
            menu.addItem(PetMenuItem(session.timer.isPaused ? L("계속") : L("일시정지")) { [weak self] in self?.command(.togglePause) })
            menu.addItem(PetMenuItem(L("5분 더")) { [weak self] in self?.command(.addMinutes(5)) })
            if session.isFocus {
                menu.addItem(PetMenuItem(L("집중 화면 보기")) { [weak self] in self?.showNote() })
                menu.addItem(PetMenuItem(L("집중 그만두기")) { [weak self] in self?.command(.stop) })
            } else {
                menu.addItem(PetMenuItem(L("중지")) { [weak self] in self?.command(.stop) })
            }
            menu.addItem(.separator())
        }
        // The presets, the recent typed lengths (newest first), then 직접 정하기….
        for minutes in TimerLength.presets + model.timerRecent {
            menu.addItem(PetMenuItem(L("\(minutes)분 타이머")) { [weak self] in self?.command(.countdown(minutes: minutes)) })
        }
        menu.addItem(PetMenuItem(L("직접 정하기…")) { [weak self] in self?.command(.chooseLength) })
        let settings = model.pomodoroSettings
        menu.addItem(PetMenuItem(L("뽀모도로 시작 (\(settings.focusMinutes)분 집중 · \(settings.restMinutes)분 휴식)")) { [weak self] in self?.command(.pomodoro) })
        // 집중 (1.37): pick a to-do on the note, then its focus card.
        menu.addItem(PetMenuItem(L("할 일 골라 집중…")) { [weak self] in self?.command(.pickFocus) })
        menu.addItem(.separator())
        let sizes = NSMenu()
        for size in TimerSize.allCases {
            let item = PetMenuItem(size.title(.current)) { [weak self] in self?.model.timerSize = size }
            item.state = model.timerSize == size ? .on : .off
            sizes.addItem(item)
        }
        let sizeItem = NSMenuItem(title: L("크기"), action: nil, keyEquivalent: "")
        sizeItem.submenu = sizes
        menu.addItem(sizeItem)
        return menu
    }
}

/// The paper cat holding up the timer tag, with a speech bubble above for phase changes. It
/// breathes while the time runs, closes its eyes while paused, and cheers when it's done.
/// (This cat belongs to the timer; the desktop pet stays on its floor.)
struct FocusTimerView: View {
    @ObservedObject var state: FocusTimerState
    var onPause: () -> Void = {}
    var onStop: () -> Void = {}
    var onDrag: () -> Void = {}
    var onDragEnd: () -> Void = {}
    private let catSize: CGFloat = 92

    var body: some View {
        VStack(spacing: 4) {
            Spacer(minLength: 0)
            if let message = state.message {
                SpeechBubble(text: message)
                    .transition(.scale(scale: 0.6, anchor: .bottom).combined(with: .opacity))
            }
            if let timer = state.timer {
                ZStack(alignment: .bottom) {
                    // Holding the board, the cat stands a little higher so its face clears the sign.
                    BreathingImage(image: timer.isPaused ? PetArt.closedEyes : PaperTheme.mascot,
                                   style: timer.isPaused ? .asleep : .awake)
                        .frame(width: catSize, height: catSize)
                        // The tag is taller with a to-do's title on it: the cat stands higher still.
                        .offset(y: -catSize * 0.4 - (state.isFocusing ? 19 : 0))
                        .accessibilityHidden(true)
                    board(timer)
                        .offset(y: -catSize * 0.02)
                }
                .frame(width: catSize + 40, height: catSize + 26, alignment: .bottom)
            } else if state.message != nil {
                // Done: the cat cheers under the message, then the window goes away.
                BreathingImage(image: PetArt.image(.cheer) ?? PaperTheme.mascot, style: .awake)
                    .frame(width: catSize, height: catSize)
                    .accessibilityHidden(true)
            }
        }
        // Room under the tilted board for its corner and shadow (they were cut by the panel's edge).
        .padding(.bottom, 14)
        .frame(width: FocusTimerController.size.width, height: FocusTimerController.size.height)
        .gesture(DragGesture(minimumDistance: 4, coordinateSpace: .global)
            .onChanged { _ in onDrag() }
            .onEnded { _ in onDragEnd() })
        // TimerSize: drawn at 보통 and scaled as a whole, so every part keeps its proportions.
        .scaleEffect(state.scale, anchor: .topLeading)
        .frame(width: FocusTimerController.size.width * state.scale, height: FocusTimerController.size.height * state.scale, alignment: .topLeading)
    }

    @ViewBuilder
    private func board(_ timer: FocusTimer) -> some View {
        // 집중 with the note out of sight: the to-do's title on the tag; a click brings the card back.
        let focusTitle = state.isFocusing ? state.session?.title : nil
                TimerBoard(timer: timer, focusTitle: focusTitle, onPause: onPause, onStop: onStop)
                    .onTapGesture(perform: onPause)
                    .help(focusTitle == nil ? L("누르면 일시정지 · 계속 · 끌어서 옮기기 · 우클릭하면 메뉴") : L("누르면 집중 화면 · 끌어서 옮기기 · 우클릭하면 메뉴"))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel(focusTitle.map { Focus.topLine(language: .current) + " · " + $0 + ", " + FocusTimer.clock(timer.remaining(at: Date())) }
                                        ?? L("\(timer.caption(.current)) 타이머, \(FocusTimer.clock(timer.remaining(at: Date()))) 남음"))
                    .accessibilityAddTraits(.isButton)
                    .accessibilityAction { onPause() }
                    .accessibilityAction(named: "타이머 종료") { onStop() }
    }
}
