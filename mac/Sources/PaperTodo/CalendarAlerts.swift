import AppKit
import Combine
import PaperCore

/// 일정 알림: a few minutes before an event (Settings → 캘린더 → 일정 알림), the same bubble as a
/// task's alert — without the check circle or 다시 알림, since an event isn't checked off here.
/// Each device remembers what it has shown (two days), like task alerts.
@MainActor
final class CalendarAlertController {
    private let model: AppModel
    private let preferences: UserDefaults
    private let duration: () -> TimeInterval
    /// Another alert is up: wait for it.
    var isBusy: () -> Bool = { false }
    private var timer: Timer?
    private var subscriptions = Set<AnyCancellable>()
    /// The day of the event shown, for 달력.
    private var shownDay: String?
    private lazy var popup = ReminderPopupController(
        onOpen: { [weak self] in self?.openShown() },
        onSnooze: { _ in },
        onComplete: { _ in }
    )
    /// 5분 전에 다시: these events come again five minutes before they start.
    private var again: [(event: CalendarEvent, at: Date)] = []
    private var shownEvents: [CalendarEvent] = []
    /// 시스템 알림으로도 보내기 (1.38).
    var onShown: ([CalendarEvent]) -> Void = { _ in }

    init(model: AppModel, preferences: UserDefaults, duration: @escaping () -> TimeInterval) {
        self.model = model
        self.preferences = preferences
        self.duration = duration
        model.calendar.objectWillChange.sink { [weak self] _ in
            DispatchQueue.main.async { self?.arm() }
        }.store(in: &subscriptions)
        NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.didWakeNotification)
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.arm(minimumDelay: 15) }.store(in: &subscriptions)
        popup.onEventAgain = { [weak self] in self?.remindAgain() }
        arm()
    }

    /// `5분 전에 다시`: the shown events come again five minutes before they start.
    private func remindAgain() {
        for event in shownEvents {
            if let at = Snooze.eventAgain(start: event.start, now: Date()) { again.append((event, at)) }
        }
        arm()
    }

    private var shownHere: Set<String> { Set(preferences.stringArray(forKey: "calendar.alertsShown") ?? []) }

    private func arm(minimumDelay: TimeInterval = 1) {
        timer?.invalidate()
        let alert = CalendarDay.nextAlertTime(model.calendar.visibleEvents, now: .now, leadMinutes: model.calendar.alertMinutes, shownHere: shownHere)
        guard let next = ([alert].compactMap { $0 } + again.map(\.at)).min() else { return }
        let timer = Timer(timeInterval: max(minimumDelay, next.timeIntervalSinceNow), repeats: false) { _ in
            Task { @MainActor [weak self] in self?.tick() }
        }
        timer.tolerance = 2
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func tick() {
        guard !popup.isVisible, !isBusy(), NSApp.modalWindow == nil else {
            arm(minimumDelay: 15)
            return
        }
        let now = Date()
        let comingAgain = again.filter { $0.at <= now }.map(\.event)
        again.removeAll { $0.at <= now }
        let due = CalendarDay.dueAlerts(model.calendar.visibleEvents, now: .now, leadMinutes: model.calendar.alertMinutes, shownHere: shownHere)
            + comingAgain
        guard !due.isEmpty else {
            arm()
            return
        }
        popup.show(
            image: model.mascotImage,
            tasks: due.map { ReminderPopupTask(title: $0.title, scheduledAt: $0.start, endsAt: $0.end, location: $0.location) },
            duration: duration(),
            screen: NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main,
            snoozeEnabled: false,
            scheduled: true,
            notebookFont: model.notebookFont,
            style: model.reminderStyle,
            canComplete: false,
            calendarEvents: true
        )
        shownDay = due.first.map { CalendarDraft.day($0.start) }
        shownEvents = due
        onShown(due)
        remember(due)
        arm()
    }

    /// Kept for two days, so an event shown here never comes back after a restart.
    private func remember(_ events: [CalendarEvent]) {
        let cutoff = Date().addingTimeInterval(-2 * 86_400).timeIntervalSince1970
        var kept = shownHere.filter { key in (key.split(separator: "@").last.flatMap { Double($0) } ?? 0) >= cutoff }
        kept.formUnion(events.map(CalendarDay.alertKey))
        preferences.set(Array(kept).sorted(), forKey: "calendar.alertsShown")
    }

    /// The bubble's title opens 달력 on that day.
    private func openShown() {
        if let day = shownDay { model.showCalendar(on: day) } else { model.showCalendar() }
    }
}
