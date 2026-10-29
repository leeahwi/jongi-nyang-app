import AppKit
import Combine
import PaperCore
import SwiftUI

@MainActor
final class ReminderPopupController {
    private enum Constants {
        static let edgePadding: CGFloat = 22
        static let bottomPadding: CGFloat = 34
        static let revealDuration: TimeInterval = 0.3
        static let closeDuration: TimeInterval = 0.16
    }

    private let onOpen: () -> Void
    private let onComplete: ((UUID) -> Void)?
    private let onSnooze: (Snooze) -> Void
    /// 일정 알림: `5분 전에 다시` (1.38).
    var onEventAgain: (() -> Void)?
    /// 모두 끝냄 (two or more): one undo step with its toast (1.38).
    var onCompleteAll: (([UUID]) -> Void)?
    private let state = ReminderPopupState()
    private var panel: ReminderPopupPanel?
    private var dismissTask: Task<Void, Never>?
    private var entranceTask: Task<Void, Never>?
    private var exitTask: Task<Void, Never>?
    private var generation = 0
    private var dismissDeadline: Date?
    private var remainingDismissInterval: TimeInterval?
    private var pointerInside = false
    private var finishing = false
    private var menuTrackingDepth = 0
    private var menuSubscriptions = Set<AnyCancellable>()

    var isVisible: Bool {
        panel?.isVisible == true
    }

    init(
        onOpen: @escaping () -> Void,
        onSnooze: @escaping (Snooze) -> Void,
        onComplete: ((UUID) -> Void)? = nil
    ) {
        self.onOpen = onOpen
        self.onComplete = onComplete
        self.onSnooze = onSnooze
        state.onOpen = { [weak self] in self?.openNote() }
        state.onComplete = { [weak self] id in self?.complete(id) }
        state.onSnooze = { [weak self] choice in self?.snooze(choice) }
        state.onEventAgain = { [weak self] in
            self?.dismiss()
            self?.onEventAgain?()
        }
        state.onCompleteAll = { [weak self] ids in self?.completeAll(ids) }
        state.onDismiss = { [weak self] in self?.dismiss() }
        NotificationCenter.default.publisher(for: NSMenu.didBeginTrackingNotification)
            .receive(on: RunLoop.main).sink { [weak self] _ in
                guard let self else { return }
                self.menuTrackingDepth += 1
                self.pauseDismissForInteraction()
            }.store(in: &menuSubscriptions)
        NotificationCenter.default.publisher(for: NSMenu.didEndTrackingNotification)
            .receive(on: RunLoop.main).sink { [weak self] _ in
                guard let self else { return }
                self.menuTrackingDepth = max(0, self.menuTrackingDepth - 1)
                self.resumeDismissIfIdle()
            }.store(in: &menuSubscriptions)
    }

    /// Shows every task in one bubble: up to three rows, the rest summarised as "+N".
    func show(
        image: NSImage,
        tasks: [ReminderPopupTask],
        duration: TimeInterval,
        screen: NSScreen? = nil,
        snoozeEnabled: Bool = true,
        scheduled: Bool = false,
        notebookFont: NotebookFont = .pen,
        style: ReminderPresentationStyle = .compact,
        canComplete: Bool = true,
        preview: Bool = false,
        calendarEvents: Bool = false,
        snoozeMoves: Bool = false
    ) {
        // With the desktop pet out, the bubble rises above it rather than a second cat walking in.
        let petAnchor = Self.petAnchor?()
        let style = petAnchor == nil ? style : .compact
        if petAnchor != nil { Self.onPetAlert?() }
        generation += 1
        entranceTask?.cancel()
        entranceTask = nil
        exitTask?.cancel()
        exitTask = nil
        dismissTask?.cancel()
        dismissTask = nil
        dismissDeadline = nil
        remainingDismissInterval = nil
        pointerInside = false
        finishing = false
        panel?.contentView?.layer?.removeAllAnimations()

        let reduceMotion = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let shouldWalk = !reduceMotion && style != .compact
        state.mascotPhase = shouldWalk ? .walkingIn(Date()) : .still
        state.bubbleVisible = reduceMotion
        state.readingStarted = false
        state.image = image
        state.tasks = tasks
        state.completed = []
        state.snoozeEnabled = snoozeEnabled
        state.scheduled = scheduled
        state.notebookFont = notebookFont
        state.style = style
        state.renderedSize = size(for: style, tasks: tasks, scheduled: scheduled, font: notebookFont, events: calendarEvents)
        state.canComplete = canComplete && onComplete != nil
        state.preview = preview
        state.calendarEvents = calendarEvents
        state.snoozeMoves = snoozeMoves
        state.isPresented = true
        state.animationID = UUID()

        // The panel stays put and reaches the screen edge; the cat walks inside it, so the
        // edge clips the cat naturally and nothing spills onto a neighbouring display.
        let targetFrame = petAnchor.map { frame(above: $0, size: state.renderedSize) } ?? frame(on: screen, size: state.renderedSize)
        state.panelWidth = targetFrame.width
        let panel = panel ?? makePanel(size: targetFrame.size)
        resizePanel(panel, to: targetFrame.size)
        panel.setFrame(targetFrame, display: true)
        panel.alphaValue = 1
        panel.ignoresMouseEvents = shouldWalk
        panel.orderFrontRegardless()

        guard shouldWalk else {
            if !reduceMotion {
                let currentGeneration = generation
                DispatchQueue.main.async { [weak self] in
                    guard let self, self.generation == currentGeneration else { return }
                    self.state.bubbleVisible = true
                }
            }
            beginReading(duration: duration)
            return
        }
        let currentGeneration = generation
        entranceTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(MascotMotion.walkInDuration))
            guard !Task.isCancelled, let self, self.generation == currentGeneration else { return }
            self.state.mascotPhase = .arrived(Date())
            panel.ignoresMouseEvents = false
            self.state.bubbleVisible = true
            try? await Task.sleep(for: .seconds(Constants.revealDuration))
            guard !Task.isCancelled, self.generation == currentGeneration else { return }
            self.beginReading(duration: duration)
            // Once the greeting is over the cat holds still, so the timeline can stop redrawing.
            try? await Task.sleep(for: .seconds(MascotMotion.greetingDuration - Constants.revealDuration))
            guard !Task.isCancelled, self.generation == currentGeneration,
                  case .arrived = self.state.mascotPhase else { return }
            self.state.mascotPhase = .still
            self.entranceTask = nil
        }
    }

    private func beginReading(duration: TimeInterval) {
        state.readingStarted = true
        guard duration > 0 else { return }
        pointerInside = panel?.frame.contains(NSEvent.mouseLocation) == true
        if menuTrackingDepth > 0 || pointerInside { remainingDismissInterval = duration }
        else { scheduleDismiss(after: duration, generation: generation) }
    }

    var motionSnapshot: (frame: NSRect, progress: Double, bubbleVisible: Bool, readingStarted: Bool, readingTimeLeft: TimeInterval?) {
        (panel?.frame ?? .zero, state.walkProgress, state.bubbleVisible, state.readingStarted,
         remainingDismissInterval ?? dismissDeadline?.timeIntervalSinceNow)
    }

    /// Drops rows whose task was finished or deleted elsewhere; rows checked here stay struck through.
    func retainTasks(openIDs: Set<UUID>) {
        guard state.isPresented, !state.preview else { return }
        let kept = state.tasks.filter { openIDs.contains($0.id) || state.completed.contains($0.id) }
        guard kept.count != state.tasks.count else { return }
        state.tasks = kept
        if kept.isEmpty { dismiss() }
        else if state.allVisibleCompleted { finishAfterCompletion() }
    }

    var shownTaskIDs: [UUID] { state.tasks.map(\.id) }

    var mascotPose: MascotPose {
        MascotMotion.pose(state.mascotPhase, at: Date(), travel: state.panelWidth)
    }

    func dismiss() {
        generation += 1
        entranceTask?.cancel()
        entranceTask = nil
        exitTask?.cancel()
        exitTask = nil
        dismissTask?.cancel()
        dismissTask = nil
        dismissDeadline = nil
        remainingDismissInterval = nil
        pointerInside = false
        finishing = false
        panel?.contentView?.layer?.removeAllAnimations()
        panel?.orderOut(nil)
        state.isPresented = false
        state.bubbleVisible = false
        state.readingStarted = false
        state.mascotPhase = .still
    }

    /// Timed-out reminders fold the bubble back and let the cat walk off the way it came.
    private func leave() {
        guard state.isPresented, let panel else { return dismiss() }
        dismissTask = nil
        dismissDeadline = nil
        remainingDismissInterval = nil
        panel.ignoresMouseEvents = true
        state.bubbleVisible = false
        let walksAway = state.style != .compact && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let currentGeneration = generation
        exitTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(Constants.closeDuration))
            guard !Task.isCancelled, let self, self.generation == currentGeneration else { return }
            if walksAway {
                self.state.mascotPhase = .leaving(Date())
                try? await Task.sleep(for: .seconds(MascotMotion.leaveDuration))
                guard !Task.isCancelled, self.generation == currentGeneration else { return }
            }
            self.dismiss()
        }
    }

    func captureSnapshot(at url: URL) {
        guard let view = panel?.contentView,
              let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else { return }
        try? data.write(to: url)
    }

    private func makePanel(size: NSSize) -> ReminderPopupPanel {
        let panel = ReminderPopupPanel(
            contentRect: NSRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.title = L("종이냥 · 알림")
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.animationBehavior = .none
        panel.ignoresMouseEvents = false
        panel.acceptsMouseMovedEvents = true
        panel.isMovable = false
        panel.isMovableByWindowBackground = false

        let hosting = ReminderPopupHostingView(rootView: ReminderPopupView(state: state))
        hosting.frame = NSRect(origin: .zero, size: size)
        hosting.wantsLayer = true
        hosting.layer?.backgroundColor = NSColor.clear.cgColor
        hosting.onMouseEntered = { [weak self] in self?.pauseDismissForPointer() }
        hosting.onMouseExited = { [weak self] in self?.resumeDismissAfterPointerExit() }
        panel.contentView = hosting
        self.panel = panel
        return panel
    }

    private func resizePanel(_ panel: ReminderPopupPanel, to size: NSSize) {
        panel.setContentSize(size)
        panel.contentView?.frame = NSRect(origin: .zero, size: size)
    }

    /// The slip (400 wide, M) with room above for its tape, beside the cat when there is one.
    private func size(for style: ReminderPresentationStyle, tasks: [ReminderPopupTask], scheduled: Bool, font: NotebookFont, events: Bool) -> NSSize {
        let rows = min(tasks.count, ReminderPopupTask.visibleLimit)
        let bodyHeight: CGFloat
        if events && rows <= 1 {
            // One event: its title in large handwriting (up to two lines) and the place · time line.
            let title = HandwritingFont.native(face: .pen, size: 28)
            let measured = ((tasks.first?.title ?? "") as NSString).boundingRect(
                with: NSSize(width: ReminderPopupView.bubbleWidth - 40, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin], attributes: [.font: title]).height
            bodyHeight = min(max(34, measured), 70) + 22
        } else if rows <= 1 {
            let nativeFont = ReminderPopupView.rowFont(font)
            let lineHeight = nativeFont.ascender - nativeFont.descender + nativeFont.leading
            let measured = ((tasks.first?.title ?? "") as NSString).boundingRect(
                with: NSSize(width: ReminderPopupView.bubbleWidth - 110, height: .greatestFiniteMagnitude),
                options: [.usesLineFragmentOrigin], attributes: [.font: nativeFont]).height
            bodyHeight = max(38, min(max(lineHeight, measured), lineHeight * 3) + 8)
        } else {
            bodyHeight = CGFloat(rows) * 38
        }
        let moreHeight: CGFloat = tasks.count > rows ? 26 : 0
        // Tape room 14 · header 44 · body 12 + rows + 4 · footer 56 · bottom room 8.
        let height = 14 + 44 + 12 + bodyHeight + moreHeight + 4 + 56 + 22
        return NSSize(width: ReminderPopupView.bubbleWidth + style.mascotGutter + 28 + (style == .compact ? 0 : 9),
                      height: max(style == .character ? 150 : 140, ceil(height)))
    }

    /// Where the desktop pet is, if it's showing; set by the app.
    static var petAnchor: (@MainActor () -> NSRect?)?
    static var onPetAlert: (@MainActor () -> Void)?

    private func frame(above anchor: NSRect, size: NSSize) -> NSRect {
        let area = (NSScreen.screens.first { $0.frame.intersects(anchor) } ?? NSScreen.main)?.visibleFrame ?? anchor
        let x = min(max(anchor.midX - size.width / 2, area.minX + 8), area.maxX - size.width - 8)
        let y = min(anchor.maxY + 4, area.maxY - size.height)
        return NSRect(x: x, y: y, width: size.width, height: size.height)
            .offsetBy(dx: OffscreenRendering.offset.x, dy: OffscreenRendering.offset.y)
    }

    private func frame(on screen: NSScreen?, size: NSSize) -> NSRect {
        let visibleFrame = (screen ?? NSScreen.main ?? NSScreen.screens.first)?.visibleFrame ?? .zero
        return NSRect(
            x: visibleFrame.maxX - size.width - Constants.edgePadding,
            y: visibleFrame.minY + Constants.bottomPadding,
            width: size.width + Constants.edgePadding,
            height: size.height
        ).offsetBy(dx: OffscreenRendering.offset.x, dy: OffscreenRendering.offset.y)
    }

    private func scheduleDismiss(after interval: TimeInterval, generation currentGeneration: Int) {
        dismissTask?.cancel()
        guard interval > 0 else { return }
        dismissDeadline = Date().addingTimeInterval(interval)
        dismissTask = Task { [weak self] in
            let delay = UInt64(max(0, interval) * 1_000_000_000)
            try? await Task.sleep(nanoseconds: delay)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                guard self?.generation == currentGeneration else { return }
                self?.leave()
            }
        }
    }

    private func pauseDismissForPointer() {
        guard state.isPresented, !pointerInside else { return }
        pointerInside = true
        pauseDismissForInteraction()
    }

    private func pauseDismissForInteraction() {
        guard state.isPresented, !finishing else { return }
        if let dismissDeadline {
            remainingDismissInterval = max(0.3, dismissDeadline.timeIntervalSinceNow)
        }
        dismissTask?.cancel()
        dismissTask = nil
        dismissDeadline = nil
    }

    private func resumeDismissAfterPointerExit() {
        guard state.isPresented, pointerInside else { return }
        pointerInside = false
        resumeDismissIfIdle()
    }

    private func resumeDismissIfIdle() {
        guard state.isPresented, !pointerInside, menuTrackingDepth == 0 else { return }
        guard let interval = remainingDismissInterval else { return }
        remainingDismissInterval = nil
        scheduleDismiss(after: interval, generation: generation)
    }

    private func openNote() {
        dismiss()
        onOpen()
    }

    private func complete(_ id: UUID) {
        guard state.canComplete, !state.completed.contains(id) else { return }
        state.completed.insert(id)
        onComplete?(id)
        if state.allVisibleCompleted { finishAfterCompletion() }
    }

    /// Lets the last check mark land before the bubble folds and the cat heads off.
    private func finishAfterCompletion() {
        finishing = true
        remainingDismissInterval = nil
        dismissDeadline = nil
        entranceTask?.cancel()
        entranceTask = nil
        dismissTask?.cancel()
        dismissTask = nil
        let currentGeneration = generation
        dismissTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(0.7))
            guard !Task.isCancelled, let self, self.generation == currentGeneration else { return }
            self.leave()
        }
    }

    private func snooze(_ choice: Snooze) {
        dismiss()
        onSnooze(choice)
    }

    /// 모두 끝냄: every row checked at once, as one step.
    private func completeAll(_ ids: [UUID]) {
        guard state.canComplete else { return }
        let open = ids.filter { !state.completed.contains($0) }
        state.completed.formUnion(open)
        if let onCompleteAll, open.count > 1 { onCompleteAll(open) } else { open.forEach { onComplete?($0) } }
        if state.allVisibleCompleted { finishAfterCompletion() }
    }
}

struct ReminderPopupTask: Identifiable, Equatable {
    static let visibleLimit = 3

    let id: UUID
    let title: String
    var scheduledAt: Date? = nil
    /// An event's end and place (일정 알림).
    var endsAt: Date? = nil
    var location: String? = nil

    init(id: UUID = UUID(), title: String, scheduledAt: Date? = nil, endsAt: Date? = nil, location: String? = nil) {
        self.id = id
        self.title = title.trimmingCharacters(in: .whitespacesAndNewlines)
        self.scheduledAt = scheduledAt
        self.endsAt = endsAt
        self.location = location
    }

    init(_ item: TodoItem) {
        self.init(id: item.id, title: item.title, scheduledAt: item.reminderAt)
    }
}

/// Tests and design renders set PAPERTODO_OFFSCREEN=1 so their sample reminders are drawn
/// far outside every display instead of popping up on the person's screen.
enum OffscreenRendering {
    static let enabled = ProcessInfo.processInfo.environment["PAPERTODO_OFFSCREEN"] == "1"
    static var offset: NSPoint { enabled ? NSPoint(x: -40_000, y: -40_000) : .zero }
}

// MARK: - Mascot motion

enum MascotPhase: Equatable {
    case still
    case walkingIn(Date)
    case arrived(Date)
    case leaving(Date)
}

struct MascotPose: Equatable {
    var x: CGFloat = 0
    var lift: CGFloat = 0
    var rotation: Double = 0
    var pivot = UnitPoint(x: 0.5, y: 0.93)
    var scaleX: CGFloat = 1
    var scaleY: CGFloat = 1

    static let rest = MascotPose()
}

/// The cat artwork faces the viewer, so it walks the way flat mascots do: it rocks onto one
/// front paw, which lifts the other, then the next. Every pose is a pure function of time.
enum MascotMotion {
    static let walkInDuration: TimeInterval = 2.0
    static let greetingDuration: TimeInterval = 2.35
    static let leaveDuration: TimeInterval = 1.2
    private static let walkInSteps = 8.0
    private static let leaveSteps = 5.0
    private static let leftPaw = UnitPoint(x: 0.39, y: 0.93)
    private static let rightPaw = UnitPoint(x: 0.56, y: 0.93)

    static func pose(_ phase: MascotPhase, at date: Date, travel: CGFloat) -> MascotPose {
        switch phase {
        case .still:
            return .rest
        case .walkingIn(let start):
            let u = min(1, max(0, date.timeIntervalSince(start) / walkInDuration))
            // Nearly even pace that slows to half speed for the last steps.
            let distance = 1.15 * u - 0.15 * pow(u, 4)
            var pose = step(distance * walkInSteps, strength: 1)
            pose.x = travel * CGFloat(1 - distance)
            return pose
        case .arrived(let start):
            return arrival(max(0, date.timeIntervalSince(start)))
        case .leaving(let start):
            let u = min(1, max(0, date.timeIntervalSince(start) / leaveDuration))
            let distance = pow(u, 1.6)
            var pose = step(distance * leaveSteps, strength: min(1, u * 5))
            pose.x = travel * CGFloat(distance)
            return pose
        }
    }

    static func step(_ progress: Double, strength: Double) -> MascotPose {
        let fraction = progress - progress.rounded(.down)
        let swing = sin(.pi * fraction) * strength
        let contact = pow(cos(.pi * fraction), 2) * strength
        let leftPlanted = Int(progress.rounded(.down)).isMultiple(of: 2)
        return MascotPose(
            lift: CGFloat(swing * 3),
            rotation: (leftPlanted ? -7 : 7) * swing,
            pivot: leftPlanted ? leftPaw : rightPaw,
            scaleX: 1 + CGFloat(0.03 * contact),
            scaleY: 1 - CGFloat(0.04 * contact)
        )
    }

    /// Lands from the last step, gives a small hello hop, tilts its head, then rests.
    private static func arrival(_ t: Double) -> MascotPose {
        var pose = MascotPose()
        var squash = 0.04 * exp(-t * 9) * cos(t * 20)

        let hopStart = 0.4, hopLength = 0.36
        if t > hopStart, t < hopStart + hopLength {
            let height = sin(.pi * (t - hopStart) / hopLength)
            pose.lift = CGFloat(height * 7)
            squash -= 0.05 * height
        }
        let landed = t - hopStart - hopLength
        if landed > 0 { squash += 0.05 * exp(-landed * 8) * sin(landed * 22) }

        let tiltStart = 1.0, tiltLength = 1.3
        if t > tiltStart, t < tiltStart + tiltLength {
            pose.rotation = -6 * pow(sin(.pi * (t - tiltStart) / tiltLength), 2)
        }

        pose.scaleY = 1 - CGFloat(squash)
        pose.scaleX = 1 + CGFloat(squash * 0.75)
        return pose
    }
}

// MARK: - Views

@MainActor
private final class ReminderPopupPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor
private final class ReminderPopupHostingView<Content: View>: NSHostingView<Content> {
    var onMouseEntered: () -> Void = {}
    var onMouseExited: () -> Void = {}
    private var trackingArea: NSTrackingArea?

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }

    override func updateTrackingAreas() {
        if let trackingArea {
            removeTrackingArea(trackingArea)
        }
        let area = NSTrackingArea(
            rect: bounds,
            options: [.activeAlways, .mouseEnteredAndExited, .inVisibleRect],
            owner: self,
            userInfo: nil
        )
        addTrackingArea(area)
        trackingArea = area
        super.updateTrackingAreas()
    }

    override func mouseEntered(with event: NSEvent) {
        onMouseEntered()
    }

    override func mouseExited(with event: NSEvent) {
        onMouseExited()
    }
}

@MainActor
private final class ReminderPopupState: ObservableObject {
    @Published var image = NSImage()
    @Published var tasks: [ReminderPopupTask] = []
    @Published var completed: Set<UUID> = []
    @Published var animationID = UUID()
    @Published var snoozeEnabled = true
    @Published var scheduled = false
    @Published var notebookFont = NotebookFont.pen
    @Published var isPresented = false
    @Published var style = ReminderPresentationStyle.compact
    @Published var renderedSize = ReminderPresentationStyle.compact.size
    @Published var panelWidth = ReminderPresentationStyle.compact.size.width
    @Published var canComplete = true
    @Published var preview = false
    /// 일정 알림: events — a calendar mark instead of the check circle, and the title opens 달력.
    @Published var calendarEvents = false
    @Published var mascotPhase = MascotPhase.still
    @Published var bubbleVisible = true
    @Published var readingStarted = false

    var onOpen: () -> Void = {}
    var onComplete: (UUID) -> Void = { _ in }
    var onSnooze: (Snooze) -> Void = { _ in }
    var onEventAgain: () -> Void = {}
    var onCompleteAll: ([UUID]) -> Void = { _ in }
    /// Task alerts: the menu ends with 내일로 미루기 and the footer has 내일로 (1.38).
    @Published var snoozeMoves = false
    var onDismiss: () -> Void = {}

    var walkProgress: Double {
        guard case .walkingIn(let start) = mascotPhase else { return 1 }
        return min(1, Date().timeIntervalSince(start) / MascotMotion.walkInDuration)
    }

    var visibleTasks: [ReminderPopupTask] { Array(tasks.prefix(ReminderPopupTask.visibleLimit)) }
    var hiddenCount: Int { max(0, tasks.count - ReminderPopupTask.visibleLimit) }
    var isList: Bool { visibleTasks.count > 1 }
    var allVisibleCompleted: Bool { !visibleTasks.isEmpty && visibleTasks.allSatisfy { completed.contains($0.id) } }

    /// One shared time when every task is due at the same minute, so rows don't repeat it.
    var sharedTime: Date? {
        let minutes = Set(tasks.compactMap { $0.scheduledAt.map { Int($0.timeIntervalSinceReferenceDate / 60) } })
        guard scheduled, minutes.count == 1, tasks.allSatisfy({ $0.scheduledAt != nil }) else { return nil }
        return tasks.first?.scheduledAt
    }

    /// One task: its time is in the header already.
    var showsRowTimes: Bool { scheduled && tasks.count > 1 }

    /// The header: "할 일 알림 · 4개 남았어요", "일정 · 10분 뒤 17:15", "미리보기 · …".
    var headerTitle: String {
        if calendarEvents { return Intent.kindName(.event, language: .current) }
        if preview { return L("미리보기") }
        return scheduled ? L("할 일 알림") : L("남은 할 일")
    }

    var headerContext: String? {
        let open = tasks.count - completed.count
        if calendarEvents {
            guard let start = tasks.first?.scheduledAt else { return nil }
            let minutes = Int((start.timeIntervalSinceNow / 60).rounded(.up))
            let clock = Self.clock(start)
            return minutes <= 0 ? DayRibbon.nowWord(.current) : DayRibbon.away(minutes, language: .current) + " " + clock
        }
        if open == 0 { return L("다 끝냈어요, 수고했어요!") }
        if scheduled, let at = sharedTime, tasks.count == 1 { return Self.clock(at) }
        // "남은 할 일 · 12개", not "남은 할 일 · 12개 남았어요".
        return scheduled ? L("\(open)개 남았어요") : L("\(open)개")
    }

    static func clock(_ date: Date) -> String {
        let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
        return AppLanguage.current.clock(hour: parts.hour!, minute: parts.minute!)
    }

}

private struct ReminderPopupView: View {
    @ObservedObject var state: ReminderPopupState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hoveredTask: UUID?

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            note
                .scaleEffect(bubbleScale, anchor: tailAnchor)
                .animation(bubbleScaleAnimation, value: state.bubbleVisible)
                .opacity(state.bubbleVisible ? 1 : 0)
                .animation(.easeOut(duration: state.bubbleVisible ? 0.18 : 0.14), value: state.bubbleVisible)
                .padding(.leading, state.style.mascotGutter)
                .padding(.horizontal, 14)
                .padding(.top, 14)
                .padding(.bottom, 22)
                .allowsHitTesting(state.bubbleVisible)
                .accessibilityHidden(!state.bubbleVisible)

            if state.style != .compact {
                mascot
                    .padding(.leading, 1)
                    .padding(.bottom, 26)
            }
        }
        .frame(width: state.renderedSize.width, height: state.renderedSize.height)
        .frame(width: state.panelWidth, alignment: .leading)
        .fixedSize()
        .onChange(of: state.animationID) { hoveredTask = nil }
    }

    private var hasTail: Bool { state.style != .compact }
    private var tailInset: CGFloat { state.style == .character ? 46 : 37 }

    /// The bubble grows out of its tail, so it reads as something the cat is saying.
    private var tailAnchor: UnitPoint {
        guard hasTail else { return UnitPoint(x: 0.5, y: 1) }
        let height = max(1, state.renderedSize.height - 16)
        return UnitPoint(x: 0, y: (height - tailInset) / height)
    }

    private var bubbleScale: CGFloat {
        if state.bubbleVisible || reduceMotion { return 1 }
        return hasTail ? 0.5 : 0.94
    }

    private var bubbleScaleAnimation: Animation? {
        if reduceMotion { return nil }
        return state.bubbleVisible ? .spring(response: 0.36, dampingFraction: 0.7) : .easeIn(duration: 0.14)
    }

    /// The slip's width: M (the mock's 400; the cat stands beside it).
    static let bubbleWidth: CGFloat = 400

    static func rowFont(_ font: NotebookFont) -> NSFont {
        switch font {
        case .pen: HandwritingFont.native(face: .pen, size: 22)
        case .brush: HandwritingFont.native(face: .brush, size: 21)
        case .clean: .systemFont(ofSize: 15, weight: .medium)
        }
    }

    private var kind: SlipKind { state.calendarEvents ? .event : .alarm }

    private var note: some View {
        VStack(alignment: .leading, spacing: 0) {
            SlipHeader(kind: kind, symbol: state.calendarEvents ? "calendar" : "bell",
                       title: state.headerTitle, context: state.headerContext, onClose: state.onDismiss)
            Group {
                if state.calendarEvents && state.visibleTasks.count <= 1, let event = state.visibleTasks.first {
                    eventBody(event)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(state.visibleTasks.enumerated()), id: \.element.id) { index, task in
                            taskRow(task, last: index == state.visibleTasks.count - 1)
                        }
                        if state.hiddenCount > 0 {
                            Button(action: state.onOpen) {
                                Text("외 \(state.hiddenCount)개 · 노트에서 보기")
                                    .font(.system(size: 12, weight: .medium))
                                    .foregroundStyle(PaperTheme.ink3)
                                    .frame(height: 22)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .padding(.top, 4)
                            .help("노트 열기")
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 4)
            footer
        }
        .frame(width: Self.bubbleWidth)
        .padding(.leading, hasTail ? 9 : 0)
        .background {
            ReminderBubble(hasTail: hasTail, tailInset: tailInset)
                .fill(PaperTheme.paper)
                .overlay {
                    ReminderBubble(hasTail: hasTail, tailInset: tailInset)
                        .stroke(PaperTheme.ink.opacity(0.07), lineWidth: 0.6)
                }
                .slipShadow()
        }
        .overlay(alignment: .topLeading) {
            WashiTape(kind: kind)
                .frame(width: 74, height: 20)
                .offset(x: (hasTail ? 9 : 0) + Self.bubbleWidth * 0.7 - 37, y: -9)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private var footer: some View {
        if state.calendarEvents {
            let again = state.tasks.first?.scheduledAt.map { Snooze.eventAgain(start: $0, now: Date()) != nil } ?? false
            SlipFooter {
                if again {
                    Button(Snooze.eventAgainTitle(.current), action: state.onEventAgain)
                        .buttonStyle(SlipButtonStyle(role: .ghost))
                        .fixedSize()
                }
            } trailing: {
                // With 5분 전에 다시 the header's × closes (닫기 would push 달력에서 열기 out of the slip).
                if !again {
                    Button(L("닫기"), action: state.onDismiss)
                        .buttonStyle(SlipButtonStyle(role: .ghost))
                }
                Button(action: state.onOpen) {
                    Label(L("달력에서 열기"), systemImage: "arrow.up.forward.square")
                }
                .buttonStyle(SlipButtonStyle(role: .primary))
                .fixedSize()
            }
        } else {
            SlipFooter {
                snoozeSplit
            } trailing: {
                if state.canComplete && !state.scheduled {
                    // The periodic nudge isn't a due list: one click shouldn't finish a handful of to-dos.
                    // The rows keep their own boxes; the primary just opens the note.
                    Button(L("노트 열기"), action: state.onOpen)
                        .buttonStyle(SlipButtonStyle(role: .primary))
                } else if state.canComplete {
                    let open = state.visibleTasks.filter { !state.completed.contains($0.id) }
                    if state.snoozeMoves {
                        // 1.38: 내일로 — what's shown moves to tomorrow (its reminder cleared).
                        // Its own table: a short "Tomorrow" / "Morgen" fits beside 모두 끝냄 (the tidy-up's says "To tomorrow").
                        Button(String(localized: "내일로", table: "Reminder")) { state.onSnooze(.tomorrow) }
                            .buttonStyle(SlipButtonStyle(role: .quiet))
                            .fixedSize()
                            .disabled(open.isEmpty)
                            .help(L("할 일을 내일로 옮겨요"))
                    }
                    Button(open.count >= 2 ? L("모두 끝내기") : L("끝내기")) {
                        withAnimation(.spring(response: 0.3, dampingFraction: 0.6)) {
                            if open.count >= 2 { state.onCompleteAll(open.map(\.id)) } else { for task in open { state.onComplete(task.id) } }
                        }
                    }
                    .buttonStyle(SlipButtonStyle(role: .primary))
                    .fixedSize()
                    .disabled(open.isEmpty)
                }
            }
        }
    }

    /// `↻ 10분 뒤 다시 | ⌄` on paper2.
    private var snoozeSplit: some View {
        HStack(spacing: 0) {
            Button { state.onSnooze(.minutes(10)) } label: {
                Label("10분 뒤 다시", systemImage: "arrow.counterclockwise")
                    .font(.system(size: 12.5, weight: .semibold))
                    .lineLimit(1)
                    // With 내일로 beside 모두 끝냄 (1.38) a long language's words may shrink a little.
                    .minimumScaleFactor(0.8)
                    .padding(.horizontal, 10)
                    .frame(height: 30)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Rectangle().fill(PaperTheme.rule).frame(width: 1, height: 30)
            Menu {
                // 1.38: 5분 · 10분 · 30분 · 1시간 · 오늘 저녁 7시 · 내일 아침 9시 (· 내일로 미루기 for task alerts).
                ForEach(Snooze.options(now: Date(), moves: state.snoozeMoves), id: \.self) { choice in
                    if choice == .tomorrow { Divider() }
                    Button(choice.title(.current)) { state.onSnooze(choice) }
                }
            } label: {
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
                    .frame(width: 30, height: 30)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .help("다시 알림 시간 선택")
            .accessibilityLabel("다시 알림 시간 선택")
        }
        .foregroundStyle(PaperTheme.ink2)
        .background(PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .fixedSize(horizontal: !state.snoozeMoves, vertical: true)
        .disabled(!state.snoozeEnabled)
        .opacity(state.snoozeEnabled ? 1 : 0.45)
    }

    /// One event: its title large in handwriting, then `장소 · 17:15–18:15`.
    private func eventBody(_ event: ReminderPopupTask) -> some View {
        Button(action: state.onOpen) {
            VStack(alignment: .leading, spacing: 4) {
                Text(event.title.handwritten)
                    .font(HandwritingFont.swiftUI(face: .pen, size: 28))
                    .foregroundStyle(PaperTheme.ink)
                    .lineLimit(2)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    Image(systemName: "mappin").font(.system(size: 11, weight: .medium))
                    Text(eventLine(event)).lineLimit(1)
                }
                .font(.system(size: 12, weight: .medium).monospacedDigit())
                .foregroundStyle(PaperTheme.ink2)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(event.title + " · " + L("달력에서 보기"))
        .accessibilityLabel(event.title + ", " + eventLine(event))
    }

    private func eventLine(_ event: ReminderPopupTask) -> String {
        var parts: [String] = []
        if let place = event.location, !place.isEmpty { parts.append(place) }
        if let start = event.scheduledAt {
            let calendar = Calendar.current
            let time = { (date: Date) in (hour: calendar.component(.hour, from: date), minute: calendar.component(.minute, from: date)) }
            parts.append(event.endsAt.map { AppLanguage.current.timeRange(from: time(start), to: time($0)) } ?? ReminderPopupState.clock(start))
        }
        return parts.joined(separator: " · ")
    }

    private func taskRow(_ task: ReminderPopupTask, last: Bool) -> some View {
        let done = state.completed.contains(task.id)
        let title = task.title.isEmpty ? (state.canComplete ? L("제목 없는 할 일") : L("알림 미리보기")) : task.title
        return HStack(alignment: .center, spacing: 10) {
            if state.calendarEvents {
                Image(systemName: "calendar")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PaperTheme.eventBlue)
                    .frame(width: 22)
                    .accessibilityHidden(true)
            } else {
                Button { withAnimation(.easeOut(duration: 0.16)) { state.onComplete(task.id) } } label: {
                    ZStack {
                        RoundedRectangle(cornerRadius: 5).fill(done ? PaperTheme.sage : PaperTheme.card.opacity(0.6))
                        RoundedRectangle(cornerRadius: 5).strokeBorder(done ? PaperTheme.sage : PaperTheme.checkBorder, lineWidth: 1.5)
                        if done || hoveredTask == task.id {
                            Image(systemName: "checkmark")
                                .font(.system(size: 9.5, weight: .bold))
                                .foregroundStyle(done ? PaperTheme.onSage : PaperTheme.sage)
                        }
                    }
                    .frame(width: 17, height: 17)
                    .frame(width: 22, height: 30)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .onHover { hoveredTask = $0 ? task.id : (hoveredTask == task.id ? nil : hoveredTask) }
                .disabled(!state.canComplete || done)
                .opacity(state.canComplete ? 1 : 0.4)
                .help(state.preview ? L("미리보기: 목록은 바뀌지 않아요") : L("완료 표시"))
                .accessibilityLabel(done ? L("\(title), 완료함") : L("\(title) 완료"))
            }

            Button(action: state.onOpen) {
                HStack(alignment: .center, spacing: 8) {
                    Text(title.handwritten)
                        .font(Font(Self.rowFont(state.notebookFont)))
                        .strikethrough(done, color: PaperTheme.ink.opacity(0.55))
                        .lineLimit(state.isList ? 1 : 3)
                        .truncationMode(.tail)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if state.showsRowTimes, let at = task.scheduledAt {
                        Text(TaskRow.timeCaption(at, now: Date()))
                            .font(.system(size: 11, weight: .medium).monospacedDigit())
                            .foregroundStyle(PaperTheme.ink3)
                            .fixedSize()
                    }
                }
                .foregroundStyle(done ? PaperTheme.ink3 : PaperTheme.ink)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(title + " · " + (state.calendarEvents ? L("달력에서 보기") : L("노트에서 보기")))
            .accessibilityLabel(title + ", " + (state.calendarEvents ? L("달력에서 보기") : L("노트에서 보기")))
        }
        .frame(minHeight: 38)
        .overlay(alignment: .bottom) {
            if !last { Rectangle().fill(PaperTheme.rule).frame(height: 1) }
        }
        .animation(.easeOut(duration: 0.2), value: done)
    }

    private var mascot: some View {
        let size: CGFloat = state.style == .character ? 86 : 63
        let animating = !reduceMotion && state.mascotPhase != .still
        return TimelineView(.animation(minimumInterval: 1.0 / 60, paused: !animating)) { context in
            let pose = animating
                ? MascotMotion.pose(state.mascotPhase, at: context.date, travel: state.panelWidth)
                : .rest
            ZStack(alignment: .bottom) {
                Ellipse()
                    .fill(.black.opacity(0.10 - 0.008 * Double(pose.lift)))
                    .frame(width: size * 0.6 * (1 - 0.03 * pose.lift), height: size * 0.07)
                    .offset(y: -size * 0.035)
                Image(nsImage: state.image)
                    .resizable().scaledToFit()
                    .frame(width: size, height: size)
                    .scaleEffect(x: pose.scaleX, y: pose.scaleY, anchor: UnitPoint(x: 0.5, y: 0.93))
                    .rotationEffect(.degrees(pose.rotation), anchor: pose.pivot)
                    .offset(y: -pose.lift)
            }
            .frame(width: size + 10, height: size + 12, alignment: .bottom)
            .offset(x: pose.x)
        }
        .contentShape(Rectangle())
        .onTapGesture(perform: state.onOpen)
        .accessibilityLabel("종이냥, 노트 열기")
        .help("노트 열기")
    }
}

private struct ReminderBubble: Shape {
    var hasTail: Bool
    var tailInset: CGFloat = 37

    func path(in rect: CGRect) -> Path {
        let left = rect.minX + (hasTail ? 9 : 0)
        let radius: CGFloat = 16
        let tailY = rect.maxY - tailInset
        var path = Path()
        path.move(to: CGPoint(x: left + radius, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + radius), control: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - radius))
        path.addQuadCurve(to: CGPoint(x: rect.maxX - radius, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: left + radius, y: rect.maxY))
        path.addQuadCurve(to: CGPoint(x: left, y: rect.maxY - radius), control: CGPoint(x: left, y: rect.maxY))
        if hasTail {
            path.addLine(to: CGPoint(x: left, y: tailY + 10))
            path.addQuadCurve(to: CGPoint(x: rect.minX, y: tailY + 4), control: CGPoint(x: left - 5, y: tailY + 9))
            path.addQuadCurve(to: CGPoint(x: left, y: tailY - 6), control: CGPoint(x: left - 2, y: tailY))
        }
        path.addLine(to: CGPoint(x: left, y: rect.minY + radius))
        path.addQuadCurve(to: CGPoint(x: left + radius, y: rect.minY), control: CGPoint(x: left, y: rect.minY))
        path.closeSubpath()
        return path
    }
}
