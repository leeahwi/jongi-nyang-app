import AppKit
import Combine
import PaperCore
import SwiftUI

@MainActor
final class TaskReminderController {
    private let model: AppModel
    private let duration: () -> TimeInterval
    private let beforeShow: () -> Void
    private let onOpen: () -> Void
    private let snapshotURL: URL?
    private var timer: Timer?
    private var subscriptions = Set<AnyCancellable>()
    private var sleeping = false
    private lazy var popup = ReminderPopupController(
        onOpen: { [weak self] in self?.onOpen() },
        onSnooze: { [weak self] choice in self?.snoozeShown(choice) },
        onComplete: { [weak self] id in self?.complete(id) }
    )

    var isVisible: Bool { popup.isVisible }
    /// 집중: alerts wait while a focus runs, then come together once it ends (`release`).
    var isHeld: () -> Bool = { false }
    private var schedulableItems: [TodoItem] { model.items.filter { $0.id != model.editingTaskReminderID } }

    init(model: AppModel, duration: @escaping () -> TimeInterval, snapshotURL: URL? = nil,
         beforeShow: @escaping () -> Void, onOpen: @escaping () -> Void) {
        self.model = model
        self.duration = duration
        self.beforeShow = beforeShow
        self.onOpen = onOpen
        self.snapshotURL = snapshotURL
        // 모두 끝냄 (1.38): one undo step and `3개 끝냈어요 · 되돌리기`.
        popup.onCompleteAll = { [weak self] ids in
            self?.model.completeTasks(ids)
            self?.armTimer()
        }
        model.objectWillChange.sink { [weak self] _ in
            DispatchQueue.main.async { self?.modelChanged() }
        }.store(in: &subscriptions)
        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
            center.publisher(for: name).receive(on: RunLoop.main).sink { [weak self] _ in
                self?.sleeping = true
                self?.timer?.invalidate()
                self?.popup.dismiss()
            }.store(in: &subscriptions)
        }
        for name in [NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            center.publisher(for: name).receive(on: RunLoop.main).sink { [weak self] _ in
                self?.sleeping = false
                self?.armTimer(minimumDelay: 15)
            }.store(in: &subscriptions)
        }
        armTimer()
    }

    func dismiss() { popup.dismiss() }

    /// A focus ended: what came due meanwhile shows now, in one bubble.
    func release() { armTimer() }

    private func modelChanged() {
        popup.retainTasks(openIDs: Set(model.items.filter { !$0.isCompleted && $0.reminderAt != nil }.map(\.id)))
        armTimer()
    }

    private func armTimer(minimumDelay: TimeInterval = 1) {
        timer?.invalidate()
        guard !sleeping,
              let date = TaskReminderDue.nextTime(in: schedulableItems, now: .now, shownHere: model.remindersShownHere) else { return }
        let delay = max(minimumDelay, popup.isVisible ? duration() + 0.5 : 1, date.timeIntervalSinceNow)
        let timer = Timer(timeInterval: delay, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in self?.tick() }
        }
        timer.tolerance = 0.5
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func tick() {
        guard !sleeping else { return }
        guard !popup.isVisible, NSApp.modalWindow == nil, !isHeld() else {
            armTimer(minimumDelay: 15)
            return
        }
        // Everything that is due now arrives together in one bubble, never one popup per task.
        let due = TaskReminderDue.readyItems(in: schedulableItems, now: .now, shownHere: model.remindersShownHere)
        guard !due.isEmpty else {
            armTimer()
            return
        }
        beforeShow()
        popup.show(
            image: model.mascotImage,
            tasks: due.map(ReminderPopupTask.init),
            duration: duration(),
            screen: NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main,
            scheduled: true,
            notebookFont: model.notebookFont,
            style: model.reminderStyle,
            snoozeMoves: true
        )
        let now = Date()
        model.noteRemindersShown(due, now: now)
        onShown(due)
        for item in due { model.markTaskReminderDelivered(item.id, at: now) }
        armTimer()
        if let snapshotURL {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.8) { [weak self] in
                self?.popup.captureSnapshot(at: snapshotURL)
            }
        }
    }

    private func complete(_ id: UUID) {
        model.completeTask(id)
        armTimer()
    }

    /// 다시 알림 ▸ (1.38): later today, tonight, tomorrow morning — or 내일로 미루기 / 내일로: the tasks move to tomorrow.
    private func snoozeShown(_ choice: Snooze) {
        snooze(popup.shownTaskIDs, choice)
    }

    func snooze(_ ids: [UUID], _ choice: Snooze) {
        let shown = Set(ids)
        let open = model.items.filter { shown.contains($0.id) && !$0.isCompleted }.map(\.id)
        if choice == .tomorrow {
            model.moveTasksToTomorrow(open)
        } else if let date = choice.date(now: Date()) {
            for id in open { model.setTaskReminder(id, at: date) }
        }
        armTimer()
    }

    /// 시스템 알림으로도 보내기: told what was just shown.
    var onShown: ([TodoItem]) -> Void = { _ in }
}
