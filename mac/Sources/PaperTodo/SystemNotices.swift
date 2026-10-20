import AppKit
import PaperCore
import UserNotifications

/// 시스템 알림으로도 보내기 (1.38): besides the cat's own bubble, a macOS notification — always, or only for
/// what may be missed (놓친 것만: the screen is locked, the cat and the note are both out of sight, or another
/// app is full screen). Task reminders get `끝냄` · `10분 뒤`, alarms `끄기` · `다시 알림`; a click opens the
/// note (an alarm: its ring slip). Permission is asked the first time one is needed.
@MainActor
final class SystemNoticeController: NSObject, UNUserNotificationCenterDelegate {
    private let model: AppModel
    /// Whether the cat or the note is on screen now.
    var petVisible: () -> Bool = { false }
    var noteVisible: () -> Bool = { false }
    var onOpenNote: () -> Void = {}
    var onSnoozeTasks: ([UUID], Int) -> Void = { _, _ in }
    var onStopAlarm: (String) -> Void = { _ in }
    var onSnoozeAlarm: (String) -> Void = { _ in }
    var onShowAlarm: (String) -> Void = { _ in }
    private var screenLocked = false

    static let taskCategory = "jongi.task"
    static let alarmCategory = "jongi.alarm"
    static let eventCategory = "jongi.event"

    /// UNUserNotificationCenter needs a real app bundle (not the snapshot renderer).
    private var center: UNUserNotificationCenter? {
        Bundle.main.bundleIdentifier == nil || Bundle.main.bundleURL.pathExtension != "app" ? nil : .current()
    }
    var available: Bool { center != nil }

    init(model: AppModel) {
        self.model = model
        super.init()
        let distributed = DistributedNotificationCenter.default()
        distributed.addObserver(self, selector: #selector(locked), name: .init("com.apple.screenIsLocked"), object: nil)
        distributed.addObserver(self, selector: #selector(unlocked), name: .init("com.apple.screenIsUnlocked"), object: nil)
        guard let center else { return }
        center.delegate = self
        let done = UNNotificationAction(identifier: "done", title: L("끝냄"))
        let later = UNNotificationAction(identifier: "later", title: L("10분 뒤"))
        let stop = UNNotificationAction(identifier: "stop", title: L("끄기"))
        let again = UNNotificationAction(identifier: "again", title: L("다시 알림"))
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.taskCategory, actions: [done, later], intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.alarmCategory, actions: [stop, again], intentIdentifiers: []),
            UNNotificationCategory(identifier: Self.eventCategory, actions: [], intentIdentifiers: []),
        ])
    }

    @objc private func locked() { screenLocked = true }
    @objc private func unlocked() { screenLocked = false }

    /// The setting was turned on (or the first notice is due): macOS asks once.
    func askPermission() {
        center?.requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    /// Whether what the cat shows now may go unseen (놓친 것만).
    var mayBeMissed: Bool {
        if screenLocked || CGSessionCopyCurrentDictionary().flatMap({ ($0 as NSDictionary)["CGSSessionScreenIsLocked"] as? Bool }) == true { return true }
        if !petVisible() && !noteVisible() { return true }
        return otherAppFullScreen
    }

    /// The front app (not this one) has a window covering a whole screen.
    private var otherAppFullScreen: Bool {
        guard let front = NSWorkspace.shared.frontmostApplication, front.processIdentifier != ProcessInfo.processInfo.processIdentifier,
              let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] else { return false }
        let screens = NSScreen.screens.map(\.frame.size)
        return windows.contains { info in
            guard (info[kCGWindowOwnerPID as String] as? pid_t) == front.processIdentifier, (info[kCGWindowLayer as String] as? Int) == 0,
                  let bounds = info[kCGWindowBounds as String] as? [String: CGFloat] else { return false }
            return screens.contains { abs($0.width - (bounds["Width"] ?? 0)) < 1 && abs($0.height - (bounds["Height"] ?? 0)) < 1 }
        }
    }

    private var shouldPost: Bool {
        switch model.systemNotices {
        case .off: false
        case .always: true
        case .missed: mayBeMissed
        }
    }

    // MARK: Posting

    /// Task reminders due now (one notice for all of them).
    func tasksDue(_ tasks: [TodoItem], force: Bool = false) {
        guard !tasks.isEmpty, force || shouldPost else { return }
        let content = UNMutableNotificationContent()
        content.title = tasks.count == 1 ? L("종이냥 · 알림") : L("할 일 알림 · \(tasks.count)개")
        content.body = tasks.prefix(3).map(\.title).joined(separator: "\n") + (tasks.count > 3 ? "\n" + L("외 \(tasks.count - 3)개") : "")
        content.sound = .default
        content.categoryIdentifier = Self.taskCategory
        content.userInfo = ["tasks": tasks.map(\.id.uuidString)]
        post(content, id: "tasks-\(Int(Date().timeIntervalSince1970))")
    }

    /// An alarm ringing.
    func alarmRings(_ alarm: Alarm) {
        guard shouldPost else { return }
        let content = UNMutableNotificationContent()
        content.title = L("알람 · \(Alarm.timeText(alarm, language: .current))")
        content.body = alarm.label.isEmpty ? L("종이냥") : alarm.label
        content.sound = .default
        content.categoryIdentifier = Self.alarmCategory
        content.userInfo = ["alarm": alarm.id]
        post(content, id: "alarm-\(alarm.id)")
    }

    /// An event about to start.
    func eventSoon(title: String, line: String) {
        guard shouldPost else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = line
        content.categoryIdentifier = Self.eventCategory
        post(content, id: "event-\(Int(Date().timeIntervalSince1970))")
    }

    private func post(_ content: UNMutableNotificationContent, id: String) {
        guard let center else { return }
        let request = UNNotificationRequest(identifier: id, content: content, trigger: nil)
        // The live test copy asks for quiet (provisional) delivery: no permission prompt to answer.
        let arguments = ProcessInfo.processInfo.arguments
        let options: UNAuthorizationOptions = arguments.contains("--live-test") ? [.alert, .sound, .provisional] : [.alert, .sound]
        let log = arguments.firstIndex(of: "--notice-log").flatMap { arguments.indices.contains($0 + 1) ? arguments[$0 + 1] : nil }
        func note(_ line: String) {
            guard let log else { return }
            let text = line + "\n"
            if let handle = FileHandle(forWritingAtPath: log) { handle.seekToEndOfFile(); handle.write(Data(text.utf8)); try? handle.close() }
            else { try? text.write(toFile: log, atomically: true, encoding: .utf8) }
        }
        note("posting \(id)")
        Task {
            let settings = await center.notificationSettings()
            note("status before: \(settings.authorizationStatus.rawValue)")
            if settings.authorizationStatus == .notDetermined {
                do {
                    let granted = try await center.requestAuthorization(options: options)
                    note("authorization: \(granted)")
                    guard granted else { return }
                } catch {
                    note("authorization failed: \(error)")
                    return
                }
            }
            do { try await center.add(request); note("added \(id)") } catch { note("add failed: \(error)") }
            try? await Task.sleep(for: .seconds(1))
            let delivered = await center.deliveredNotifications().map(\.request.identifier)
            note("status=\(await center.notificationSettings().authorizationStatus.rawValue) delivered=\(delivered)")
        }
    }

    // MARK: Answers

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                            withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                            withCompletionHandler completionHandler: @escaping () -> Void) {
        let info = response.notification.request.content.userInfo
        let tasks = (info["tasks"] as? [String] ?? []).compactMap(UUID.init(uuidString:))
        let alarm = info["alarm"] as? String
        let action = response.actionIdentifier
        Task { @MainActor [weak self] in
            guard let self else { return }
            switch action {
            case "done": self.model.completeTasks(tasks)
            case "later": self.onSnoozeTasks(tasks, 10)
            case "stop": if let alarm { self.onStopAlarm(alarm) }
            case "again": if let alarm { self.onSnoozeAlarm(alarm) }
            default:
                if let alarm { self.onShowAlarm(alarm) } else { self.onOpenNote() }
            }
        }
        completionHandler()
    }
}
