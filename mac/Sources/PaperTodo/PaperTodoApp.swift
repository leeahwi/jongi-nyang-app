import AppKit
import Carbon.HIToolbox
import Combine
import PaperCore
import SwiftUI

@main
enum PaperTodoApp {
    @MainActor static func main() {
        // Before any text is looked up: the language of this run (Settings → 꾸미기 → 언어).
        L10n.activate()
        let app = NSApplication.shared
        let delegate = AppDelegate()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        withExtendedLifetime(delegate) { app.run() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, NSMenuItemValidation, NSMenuDelegate {
    private var window: NoteWindow!
    private var model: AppModel!
    /// The menu bar's cat face and its 오늘 창.
    private var todayWindow: TodayWindowController!
    private var floatingMascot: FloatingMascotController!
    private var archive: ArchiveStore!
    private var pet: DesktopPetController!
    private var focusTimer: FocusTimerController!
    private var quickEntry: QuickEntryController!
    private var quickMemo: QuickMemoController!
    private var alarms: AlarmController!
    /// 보기 → 다음 알람 오전 7:00 (hidden when no alarm is on).
    private let nextAlarmMenuItem = NSMenuItem(title: "", action: nil, keyEquivalent: "")
    private var viewMenu: NSMenu?
    private var storageWatcher: StorageWatcher?
    private var weeklyTimer: Timer?
    private var subscriptions = Set<AnyCancellable>()
    private let timerMenuItem = NSMenuItem(title: L("타이머"), action: nil, keyEquivalent: "")
    /// 책상: 달력 · 완료 기록 · 시계, the settings and 도움말 in one window.
    private var desk: DeskWindowController!
    /// The icon's centre relative to the note when it was folded, so unfolding mirrors it.
    private var collapseAnchorInNote: NSPoint?
    private var reminders: ReminderController!
    private var taskReminders: TaskReminderController!
    private var calendarAlerts: CalendarAlertController!
    private var headerEventMonitor: Any?
    // 편의 기능 (1.38)
    private var search: SearchController!
    private var sweep: SweepController!
    private var notices: SystemNoticeController!
    private var noteHotKey: GlobalHotKey?
    private let arguments = ProcessInfo.processInfo.arguments

    func applicationDidFinishLaunching(_ notification: Notification) {
        PerfProbe.start(arguments: arguments)
        HandwritingFont.register()
        PerfProbe.mark("fonts")

        let qaBuild = Bundle.main.bundleIdentifier?.hasSuffix(".QA") == true
        let demo = arguments.contains("--demo") || qaBuild
        let specifiedPath = argument(after: "--storage")
        let isolated = qaBuild || demo || specifiedPath != nil || arguments.contains("--snapshot")
        // Named after the bundle, so a renamed test copy of the app keeps its own list.
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let directory = support.appendingPathComponent(qaBuild ? "com.noa.PaperTodo" : Bundle.main.bundleIdentifier ?? "com.noa.PaperTodo", isDirectory: true)
        let qaStorage = support.appendingPathComponent("com.noa.PaperTodo.QA/test-todos.json")
        // A shared folder chosen in Settings (iCloud Drive, Dropbox …) holds the list instead.
        let shared = isolated ? nil : StorageFolder.chosen(.standard)
        let storage = specifiedPath.map { URL(fileURLWithPath: $0) }
            ?? (qaBuild ? qaStorage : isolated ? FileManager.default.temporaryDirectory.appendingPathComponent("PaperTodo-preview-\(UUID().uuidString).json") : (shared ?? directory).appendingPathComponent("todos.json"))
        let preferences = qaBuild ? UserDefaults(suiteName: "PaperTodo.QA")! : isolated ? UserDefaults(suiteName: "PaperTodo.Preview")! : .standard
        model = AppModel(storageURL: storage, isolated: isolated, demo: demo, preferences: preferences)
        PerfProbe.mark("model")
        model.sharedFolder = shared
        // 종이 색 (자동 · 낮 · 밤) before the first window, so nothing opens in the wrong colours.
        model.paperColor.apply()
        if !isolated {
            let current = storage.deletingLastPathComponent()
            model.onChooseStorage = { [weak self] in
                guard let self else { return }
                StorageFolder.choose(defaultFolder: directory, current: current, model: self.model, preferences: .standard)
            }
            model.onResetStorage = { [weak self] in
                guard let self else { return }
                StorageFolder.switchTo(nil, defaultFolder: directory, current: current, model: self.model, preferences: .standard)
            }
            if let shared { storageWatcher = StorageWatcher(folder: shared, model: model) }
        }
        buildMenu()

        window = NoteWindow(
            contentRect: NSRect(x: 0, y: 0, width: 420, height: 560),
            styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
            backing: .buffered, defer: false
        )
        window.title = L("종이냥")
        window.onListKey = { [weak self] key in self?.model.handleListKey(key) ?? false }
        window.onTimetableKey = { [weak self] event in self?.model.timetableKey?(event) ?? false }
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.toolbar = nil
        window.isReleasedWhenClosed = false
        window.isMovableByWindowBackground = false
        window.backgroundColor = NSColor(PaperTheme.paper)
        window.contentMinSize = NSSize(width: 350, height: 400)
        window.contentMaxSize = NSSize(width: 720, height: 1200)
        window.delegate = self
        window.collectionBehavior = [.fullScreenAuxiliary]
        let hosting = NSHostingView(rootView: PaperView(model: model).ignoresSafeArea())
        // The window keeps its own size limits (below): SwiftUI needn't measure the whole note for them on every
        // layout pass (1.39 — that doubled the work of each key press and tab switch).
        hosting.sizingOptions = []
        window.contentView = hosting
        window.center()
        if !isolated { window.setFrameAutosaveName("PaperTodoWindow") }
        model.window = window
        #if DEBUG
        TimetableReplay.start(arguments: arguments, window: window, model: model)
        #endif
        floatingMascot = FloatingMascotController(
            preferences: preferences,
            image: model.mascotImage,
            onRestore: { [weak self] in self?.showWindow() }
        )
        model.onCollapse = { [weak self] in self?.collapseToIcon() }
        window.onMinimize = { [weak self] in self?.collapseToIcon() }
        reminders = ReminderController(
            model: model,
            preferences: preferences,
            snapshotURL: argument(after: "--reminder-snapshot").map { URL(fileURLWithPath: $0) },
            onOpen: { [weak self] in self?.showWindow() }
        )
        PerfProbe.mark("window")
        archive = ArchiveStore(model: model)
        archive.start()
        PerfProbe.mark("archive")
        desk = DeskWindowController(model: model, archive: archive, reminders: reminders, remembersFrame: !isolated)
        desk.onGuide = { [weak self] in self?.showGuide() }
        model.onDesk = { [weak self] pane in self?.desk.show(pane) }
        model.onReminderSettings = { [weak self] in self?.desk.show(.appearance) }
        model.onHistory = { [weak self] in self?.desk.show(.history) }
        model.onHelp = { [weak self] in self?.desk.show(.help) }
        model.onShowNote = { [weak self] in self?.showWindow() }
        model.onCalendar = { [weak self] day in self?.showCalendar(on: day) }
        model.onRepeatSettings = { [weak self] in self?.desk.show(.repeating) }
        pet = DesktopPetController(model: model, preferences: preferences, onOpenNote: { [weak self] in self?.showWindow() })
        focusTimer = FocusTimerController(model: model, preferences: preferences)
        quickEntry = QuickEntryController(model: model)
        quickEntry.noteVisible = { [weak self] in
            guard let window = self?.window else { return false }
            return window.isVisible && !window.isMiniaturized && window.occlusionState.contains(.visible)
        }
        quickMemo = QuickMemoController(model: model)
        model.onQuickMemo = { [weak self] in self?.quickMemo.show() }
        model.onAlarmSettings = { [weak self] in self?.desk.show(.clock) }
        alarms = AlarmController(book: model.alarms)
        alarms.petAnchor = { [weak self] in self?.pet.anchorFrame }
        alarms.onRing = { [weak self] in self?.pet.celebrate() }
        if !isolated { startWeeklyLookBack(preferences: preferences) }
        if !isolated {
            model.$quickEntryEnabled.removeDuplicates().sink { [weak self] enabled in
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.quickEntry.setEnabled(enabled)
                    self.model.quickEntryRegistered = !enabled || self.quickEntry.registered
                }
            }.store(in: &subscriptions)
            model.$quickMemoEnabled.removeDuplicates().sink { [weak self] enabled in
                DispatchQueue.main.async {
                    guard let self else { return }
                    self.quickMemo.setEnabled(enabled)
                    self.model.quickMemoRegistered = !enabled || self.quickMemo.registered
                }
            }.store(in: &subscriptions)
        }
        focusTimer.onFinished = { [weak self] in self?.pet.celebrate() }
        // 집중: the note shows the focus card; the tag stands in while the note is out of sight.
        focusTimer.noteVisible = { [weak self] in
            guard let window = self?.window else { return false }
            return window.isVisible && !window.isMiniaturized && window.occlusionState.contains(.visible)
        }
        focusTimer.showNote = { [weak self] in self?.showWindow() }
        pet.timerMenu = { [weak self] in self?.focusTimer.menu() ?? NSMenu() }
        model.onPetCommand = { [weak self] command in self?.focusTimer.command(command) }
        ReminderPopupController.petAnchor = { [weak self] in self?.pet.anchorFrame }
        ReminderPopupController.onPetAlert = { [weak self] in self?.pet.greet() }
        taskReminders = TaskReminderController(
            model: model, duration: { [weak self] in TimeInterval(self?.reminders.displaySeconds ?? 15) },
            snapshotURL: argument(after: "--task-reminder-snapshot").map { URL(fileURLWithPath: $0) },
            beforeShow: { [weak self] in self?.reminders.dismiss() },
            onOpen: { [weak self] in self?.showWindow() }
        )
        model.onTaskReminderEditing = { [weak self] in
            self?.reminders.dismiss()
            self?.taskReminders.dismiss()
        }
        // The periodic reminder also waits while focusing.
        reminders.isOtherReminderVisible = { [weak self] in self?.taskReminders.isVisible == true || self?.focusTimer.isFocusing == true }
        // While focusing, task alerts wait and come together when it ends (events and alarms still come).
        taskReminders.isHeld = { [weak self] in self?.focusTimer.isFocusing == true }
        focusTimer.onFocusEnded = { [weak self] in self?.taskReminders.release() }
        // 일정 알림: events, shortly before they start.
        calendarAlerts = CalendarAlertController(model: model, preferences: preferences,
                                                 duration: { [weak self] in TimeInterval(self?.reminders.displaySeconds ?? 15) })
        calendarAlerts.isBusy = { [weak self] in self?.taskReminders.isVisible == true || self?.reminders.isPopupVisible == true }
        // Nothing of the Google connection (until 1.30) stays on this Mac.
        if !isolated { EventBook.removeLegacy(preferences: preferences) }
        // 종이냥 한마디 waits while the timer runs or a reminder is up; ‘쉴래요’ starts five minutes.
        pet.isBusy = { [weak self] in
            guard let self else { return true }
            return self.focusTimer.isVisible || self.focusTimer.isFocusing || self.reminders.isPopupVisible || self.taskReminders.isVisible || self.alarms.isRinging
        }
        pet.onRest = { [weak self] in self?.focusTimer.command(.countdown(minutes: 5)) }
        pet.onFocus = { [weak self] in self?.focusTimer.command(.countdown(minutes: 25)) }
        model.onChatterPreview = { [weak self] in self?.pet.speakUp() }
        installConveniences(isolated: isolated)
        installHeaderDoubleClick()
        PerfProbe.mark("controllers")
        window.level = model.alwaysOnTop ? .floating : .normal
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        PerfProbe.mark("ordered front")
        buildTodayWindow()
        updateMascot()
        PerfProbe.mark("launched")

        if let path = argument(after: "--snapshot") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [self] in
                captureSnapshot(at: path)
            }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        showWindow()
        return true
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        model.commitEditing()
        return true
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        model.commitEditing()
        if model.hasUnsavedChanges { model.retrySave() }
        guard model.hasUnsavedChanges else { return .terminateNow }
        let answer = SlipAlert.run(symbol: "exclamationmark.circle", title: L("종이냥 종료"), message: L("아직 저장하지 못한 할 일이 있어요"),
                                   detail: L("창으로 돌아가 목록을 텍스트로 내보내거나 저장 폴더를 확인해 주세요."),
                                   choices: [.init(title: L("저장하지 않고 종료"), role: .danger),
                                             .init(title: L("돌아가기"), role: .primary, isDefault: true, isCancel: true)])
        return answer == 0 ? .terminateNow : .terminateCancel
    }

    private func buildMenu() {
        let menu = NSMenu()
        let appMenu = NSMenu()
        let appRoot = NSMenuItem()
        appRoot.submenu = appMenu
        menu.addItem(appRoot)
        appMenu.addItem(item(L("종이냥에 관하여"), #selector(about), ""))
        appMenu.addItem(item(L("설정…"), #selector(showReminderSettings), ","))
        appMenu.addItem(.separator())
        appMenu.addItem(item(L("종이냥 가리기"), #selector(NSApplication.hide(_:)), "h", target: NSApp))
        appMenu.addItem(.separator())
        appMenu.addItem(item(L("종이냥 종료"), #selector(NSApplication.terminate(_:)), "q", target: NSApp))

        let file = NSMenu(title: L("파일"))
        let fileRoot = NSMenuItem(title: L("파일"), action: nil, keyEquivalent: "")
        fileRoot.submenu = file
        menu.addItem(fileRoot)
        file.addItem(item(L("새 할 일"), #selector(newTask), "n"))
        let entry = item(L("빠른 입력"), #selector(showQuickEntry), "n")
        entry.keyEquivalentModifierMask = [.control, .option]
        file.addItem(entry)
        let memo = item(L("빠른 메모"), #selector(showQuickMemo), "m")
        memo.keyEquivalentModifierMask = [.control, .option]
        file.addItem(memo)
        file.addItem(item(L("텍스트로 내보내기…"), #selector(export), "e"))
        file.addItem(.separator())
        file.addItem(item(L("저장과 백업…"), #selector(showStorage), ""))
        let backup = item(L("모두 내보내기…"), #selector(exportBackup), "e")
        backup.keyEquivalentModifierMask = [.command, .shift]
        file.addItem(backup)
        let restore = item(L("가져오기…"), #selector(importBackup), "i")
        restore.keyEquivalentModifierMask = [.command, .shift]
        file.addItem(restore)
        file.addItem(.separator())
        file.addItem(item(L("창 닫기"), #selector(NSWindow.performClose(_:)), "w", target: nil))

        let edit = NSMenu(title: L("편집"))
        let editRoot = NSMenuItem(title: L("편집"), action: nil, keyEquivalent: "")
        editRoot.submenu = edit
        menu.addItem(editRoot)
        edit.addItem(item(L("실행 취소"), #selector(undo), "z"))
        let redoItem = item(L("다시 실행"), #selector(redo), "z")
        redoItem.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(redoItem)
        edit.addItem(.separator())
        edit.addItem(item(L("잘라내기"), #selector(NSText.cut(_:)), "x", target: nil))
        edit.addItem(item(L("복사"), #selector(NSText.copy(_:)), "c", target: nil))
        edit.addItem(item(L("붙여넣기"), #selector(NSText.paste(_:)), "v", target: nil))
        edit.addItem(item(L("전체 선택"), #selector(NSText.selectAll(_:)), "a", target: nil))
        edit.addItem(.separator())
        edit.addItem(item(L("검색…"), #selector(showSearch), "f"))
        edit.addItem(.separator())
        let copy = item(L("목록 복사"), #selector(copyList), "c")
        copy.keyEquivalentModifierMask = [.command, .shift]
        edit.addItem(copy)

        let view = NSMenu(title: L("보기"))
        let viewRoot = NSMenuItem(title: L("보기"), action: nil, keyEquivalent: "")
        viewRoot.submenu = view
        menu.addItem(viewRoot)
        view.addItem(item(L("글자 크게"), #selector(largerText), "="))
        view.addItem(item(L("글자 작게"), #selector(smallerText), "-"))
        view.addItem(item(L("글자 크기 보통으로"), #selector(regularText), ""))
        view.addItem(.separator())
        view.addItem(item(L("오늘 할 일"), #selector(showTodos), "1"))
        view.addItem(item(L("앞으로"), #selector(showAhead), "2"))
        view.addItem(item(L("메모"), #selector(showMemos), "3"))
        let newMemo = item(L("새 메모"), #selector(newMemo), "n")
        newMemo.keyEquivalentModifierMask = [.command, .shift]
        view.addItem(newMemo)
        view.addItem(.separator())
        // The desk (책상), on its panes.
        view.addItem(item(L("달력"), #selector(openCalendar), "d"))
        view.addItem(item(L("완료 기록"), #selector(showHistory), "y"))
        view.addItem(item(L("시계"), #selector(showClock), ""))
        view.addItem(.separator())
        let petToggle = item(L("종이냥 펫 보이기"), #selector(togglePet), "p")
        petToggle.keyEquivalentModifierMask = [.command, .shift]
        view.addItem(petToggle)
        timerMenuItem.submenu = NSMenu(title: L("타이머"))
        timerMenuItem.submenu?.delegate = self
        view.addItem(timerMenuItem)
        nextAlarmMenuItem.isEnabled = false
        nextAlarmMenuItem.isHidden = true
        view.addItem(nextAlarmMenuItem)
        view.delegate = self
        viewMenu = view

        let windowMenu = NSMenu(title: L("윈도우"))
        let windowRoot = NSMenuItem(title: L("윈도우"), action: nil, keyEquivalent: "")
        windowRoot.submenu = windowMenu
        menu.addItem(windowRoot)
        windowMenu.addItem(item(L("노트 보기"), #selector(showWindow), "0"))
        let toggle = item(L("노트 보이기 · 숨기기"), #selector(toggleNoteFromMenu), "j")
        toggle.keyEquivalentModifierMask = [.control, .option]
        windowMenu.addItem(toggle)
        windowMenu.addItem(item(L("포스트잇으로 접기"), #selector(collapseToIcon), "m"))
        windowMenu.addItem(item(L("책상"), #selector(openCalendar), ""))
        windowMenu.addItem(.separator())
        windowMenu.addItem(item(L("화면 오른쪽에 붙이기"), #selector(dockRight), ""))
        windowMenu.addItem(item(L("화면 왼쪽에 붙이기"), #selector(dockLeft), ""))
        NSApp.windowsMenu = windowMenu
        let helpMenu = NSMenu(title: L("도움말"))
        let helpRoot = NSMenuItem(title: L("도움말"), action: nil, keyEquivalent: "")
        helpRoot.submenu = helpMenu
        menu.addItem(helpRoot)
        helpMenu.addItem(item(L("종이냥 도움말"), #selector(showHelp), "?"))
        helpMenu.addItem(item(L("사용 안내"), #selector(showGuide), ""))
        NSApp.helpMenu = helpMenu
        NSApp.mainMenu = menu
    }

    /// The menu bar item: the cat face, a few words when something is near, and the 오늘 창.
    private func buildTodayWindow() {
        todayWindow = TodayWindowController(model: model, timer: focusTimer.state)
        todayWindow.onOpenNote = { [weak self] in self?.showWindow() }
        todayWindow.onCalendar = { [weak self] in self?.showCalendar(on: nil) }
        todayWindow.onQuickEntry = { [weak self] in self?.quickEntry.show() }
        todayWindow.onSettings = { [weak self] in self?.desk.show(.appearance) }
        todayWindow.timerMenu = { [weak self] in self?.focusTimer.menu() ?? NSMenu() }
        todayWindow.onUpdate = { [weak self] in self?.updateFoldedSummary() }
        updateFoldedSummary()
    }

    /// The folded icon's summary of today's sheet.
    private func updateFoldedSummary() {
        let open = model.todayItems.filter { !$0.isCompleted }.map(\.title)
        floatingMascot?.updateSummary(titles: open, remaining: model.remainingCount, total: model.todayItems.count)
    }

    private func updateMascot() {
        let image = PaperTheme.mascot
        floatingMascot.updateImage(image)
        NSApp.applicationIconImage = image
    }

    private func item(_ title: String, _ action: Selector, _ key: String, target: AnyObject? = nil) -> NSMenuItem {
        let result = NSMenuItem(title: title, action: action, keyEquivalent: key)
        let responderActions = [#selector(NSText.cut(_:)), #selector(NSText.copy(_:)), #selector(NSText.paste(_:)), #selector(NSText.selectAll(_:)), #selector(NSWindow.performClose(_:)), #selector(NSWindow.performMiniaturize(_:))]
        result.target = responderActions.contains(action) ? target : (target ?? self)
        return result
    }

    /// The timer submenu reflects the running timer, so it is rebuilt each time it opens.
    func menuNeedsUpdate(_ menu: NSMenu) {
        if menu === viewMenu {
            // 다음 알람 오전 7:00, when one is on.
            let next = model.alarms.next()
            nextAlarmMenuItem.isHidden = next == nil
            if let next {
                nextAlarmMenuItem.title = L("다음 알람 \(Alarm.timeText(next.alarm, language: .current))")
                nextAlarmMenuItem.toolTip = Alarm.untilText(next.fire, now: Date(), language: .current)
            }
            return
        }
        guard menu === timerMenuItem.submenu, let focusTimer else { return }
        menu.removeAllItems()
        for item in focusTimer.menu().items { item.menu?.removeItem(item); menu.addItem(item) }
    }

    func validateMenuItem(_ menuItem: NSMenuItem) -> Bool {
        if menuItem.action == #selector(togglePet) { menuItem.state = model.petVisible ? .on : .off }
        if menuItem.action == #selector(dockRight) { menuItem.state = NoteDocking.side(of: window, preferences: model.preferences) == .right ? .on : .off }
        if menuItem.action == #selector(dockLeft) { menuItem.state = NoteDocking.side(of: window, preferences: model.preferences) == .left ? .on : .off }
        return switch menuItem.action {
        case #selector(undo): model.canUndo || model.toast?.commit != nil || (window?.firstResponder as? NSTextView)?.undoManager?.canUndo == true
        case #selector(redo): model.canRedo || (window?.firstResponder as? NSTextView)?.undoManager?.canRedo == true
        case #selector(copyList), #selector(export): !model.items.isEmpty
        case #selector(largerText): model.textSize.larger != nil
        case #selector(smallerText): model.textSize.smaller != nil
        default: true
        }
    }

    @objc private func showSearch() { search.show() }
    @objc private func toggleNoteFromMenu() { toggleNote() }
    @objc private func dockRight() { NoteDocking.toggle(window, side: .right, preferences: model.preferences) }
    @objc private func dockLeft() { NoteDocking.toggle(window, side: .left, preferences: model.preferences) }

    /// The Dock icon's menu (1.38): 빠른 입력 · 빠른 메모 · 책상 · 25분 집중 · 5분 타이머.
    func applicationDockMenu(_ sender: NSApplication) -> NSMenu? {
        let menu = NSMenu()
        menu.addItem(item(L("빠른 입력"), #selector(showQuickEntry), ""))
        menu.addItem(item(L("빠른 메모"), #selector(showQuickMemo), ""))
        menu.addItem(item(L("책상"), #selector(openCalendar), ""))
        menu.addItem(item(L("25분 집중"), #selector(dockFocus), ""))
        menu.addItem(item(L("5분 타이머"), #selector(dockTimer), ""))
        return menu
    }
    @objc private func dockFocus() { focusTimer.command(.countdown(minutes: 25)) }
    @objc private func dockTimer() { focusTimer.command(.countdown(minutes: 5)) }

    /// ⌃⌥J: the note comes up, or goes away when it's already in front.
    private func toggleNote() {
        if window.isVisible && !window.isMiniaturized && NSApp.isActive && window.isKeyWindow {
            model.commitEditing()
            window.orderOut(nil)
        } else {
            showWindow()
        }
    }

    private var noteOnScreen: Bool { window.isVisible && !window.isMiniaturized && window.occlusionState.contains(.visible) }

    private func installConveniences(isolated: Bool) {
        // 검색: ⌘F, ⋯ → 검색…, the desk's sidebar.
        search = SearchController(model: model, archive: archive)
        search.anchor = { [weak self] in self.flatMap { $0.noteOnScreen ? $0.window.frame : nil } }
        model.onSearch = { [weak self] in self?.search.show() }
        // 화면 오른쪽 · 왼쪽에 붙이기.
        model.onDockNote = { [weak self] side in
            guard let self else { return }
            self.showWindow()
            NoteDocking.toggle(self.window, side: side, preferences: self.model.preferences)
        }
        model.dockedSide = { [weak self] in self.flatMap { NoteDocking.side(of: $0.window, preferences: $0.model.preferences) } }
        // ⌘F, and the focus card's ⌘↩ · ⌘= ahead of the menus.
        window.onKeyEquivalent = { [weak self] event in
            guard let self else { return false }
            let flags = event.modifierFlags.intersection([.command, .option, .control, .shift])
            guard flags == [.command] else { return false }
            if event.keyCode == 3 { self.search.show(); return true } // F
            guard self.model.timerState.isFocusing, !self.model.showsGuide else { return false }
            switch event.keyCode {
            case 36, 76: self.model.petCommand(.focusStep(.done)); return true // ⌘↩
            case 24: self.model.petCommand(.focusStep(.more)); return true // ⌘=
            default: return false
            }
        }
        // 저녁 정리.
        sweep = SweepController(model: model)
        sweep.petAnchor = { [weak self] in self?.pet.anchorFrame }
        sweep.onPetGreet = { [weak self] in self?.pet.greet() }
        sweep.noteFrame = { [weak self] in self.flatMap { $0.noteOnScreen ? $0.window.frame : nil } }
        sweep.isBusy = { [weak self] in
            guard let self else { return true }
            return self.taskReminders.isVisible || self.reminders.isPopupVisible || self.alarms.isRinging || NSApp.modalWindow != nil
        }
        NotificationCenter.default.publisher(for: NSWindow.didBecomeKeyNotification, object: window)
            .receive(on: RunLoop.main).sink { [weak self] _ in self?.sweep.check(opening: true) }.store(in: &subscriptions)
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in self?.sweep.check(opening: self?.noteOnScreen == true) }
        // 시스템 알림으로도 보내기.
        notices = SystemNoticeController(model: model)
        notices.petVisible = { [weak self] in self?.pet.isVisible == true }
        notices.noteVisible = { [weak self] in self?.noteOnScreen == true }
        notices.onOpenNote = { [weak self] in self?.showWindow() }
        notices.onSnoozeTasks = { [weak self] ids, minutes in self?.taskReminders.snooze(ids, .minutes(minutes)) }
        notices.onStopAlarm = { [weak self] id in if self?.alarms.ringingID == id { self?.alarms.stop() } }
        notices.onSnoozeAlarm = { [weak self] id in if self?.alarms.ringingID == id { self?.alarms.snooze() } }
        notices.onShowAlarm = { _ in NSApp.activate(ignoringOtherApps: true) }
        taskReminders.onShown = { [weak self] due in self?.notices.tasksDue(due) }
        alarms.onRingAlarm = { [weak self] alarm in self?.notices.alarmRings(alarm) }
        calendarAlerts.onShown = { [weak self] events in
            guard let first = events.first else { return }
            let p = Calendar.current.dateComponents([.hour, .minute], from: first.start)
            self?.notices.eventSoon(title: first.title, line: AppLanguage.current.clock(hour: p.hour!, minute: p.minute!))
        }
        model.$systemNotices.dropFirst().removeDuplicates().sink { [weak self] mode in
            if mode != .off { self?.notices.askPermission() }
        }.store(in: &subscriptions)
        // `--notice-test`: posts one notice right away (the live test's check).
        if arguments.contains("--notice-test") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
                guard let self else { return }
                let open = Array(self.model.todayItems.filter { !$0.isCompleted }.prefix(2))
                if let index = self.arguments.firstIndex(of: "--notice-log"), self.arguments.indices.contains(index + 1) {
                    try? "notice test: \(open.count) to-dos, center \(self.notices.available)\n".write(toFile: self.arguments[index + 1], atomically: true, encoding: .utf8)
                }
                self.notices.tasksDue(open, force: true)
            }
        }
        // Dock badge: today's open count (setting).
        let badge = { [weak self] in
            guard let self else { return }
            let count = self.model.remainingCount
            NSApp.dockTile.badgeLabel = self.model.dockBadge && count > 0 ? "\(count)" : nil
        }
        model.objectWillChange.sink { _ in DispatchQueue.main.async { badge() } }.store(in: &subscriptions)
        badge()
        // A moment after the note is up (1.39): asking macOS whether the login item is on takes a while.
        if !isolated || arguments.contains("--live-test") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1) { [weak self] in self?.askLoginLater() }
        }
        guard !isolated else { return }
        // ⌃⌥J.
        model.$noteHotKeyEnabled.removeDuplicates().sink { [weak self] enabled in
            DispatchQueue.main.async {
                guard let self else { return }
                if enabled, self.noteHotKey == nil {
                    self.noteHotKey = GlobalHotKey(keyCode: kVK_ANSI_J, modifiers: controlKey | optionKey) { [weak self] in self?.toggleNote() }
                } else if !enabled {
                    self.noteHotKey?.unregister()
                    self.noteHotKey = nil
                }
                self.model.noteHotKeyRegistered = !enabled || self.noteHotKey != nil
            }
        }.store(in: &subscriptions)
    }

    /// 컴퓨터 켤 때 같이 열까요? — after the third start by hand with the login item off, the cat asks once.
    private func askLoginLater() {
        let store = model.preferences
        guard !model.loginItemOn else { return }
        let starts = store.integer(forKey: "login.manualStarts") + 1
        store.set(starts, forKey: "login.manualStarts")
        guard LoginAsk.shouldAsk(manualStarts: starts, loginItemOn: model.loginItemOn, asked: store.bool(forKey: "login.asked")) else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + (arguments.contains("--live-test") ? 4 : 40)) { [weak self] in
            guard let self, self.pet.isVisible, !self.model.showsGuide else { return }
            store.set(true, forKey: "login.asked")
            let line = PetChatter.Line(question: "login.ask", text: L("저를 켤 때마다 불러 주셨네요. 컴퓨터 켤 때 같이 열까요?"), answers: [
                PetChatter.Answer(label: L("열기"), reply: L("좋아요! 내일부터 먼저 와 있을게요."), pose: .cheer),
                PetChatter.Answer(label: L("괜찮아요"), reply: L("알겠어요. 필요할 때 불러 주세요."), pose: .happy),
            ])
            self.pet.ask(line) { [weak self] index in
                if index == 0 { self?.model.setLoginItem(true) }
            }
        }
    }

    @objc private func showWindow() {
        PerfProbe.begin("showNote")
        reminders?.dismiss()
        taskReminders?.dismiss()
        if let center = floatingMascot?.iconCenter, let anchor = collapseAnchorInNote {
            let origin = FloatingMascotPlacement.noteOrigin(
                iconCenter: center, anchorInNote: anchor,
                noteSize: window.frame.size, visibleFrames: NSScreen.screens.map(\.visibleFrame)
            )
            window.setFrameOrigin(origin)
        }
        collapseAnchorInNote = nil
        floatingMascot?.hide()
        if window.isMiniaturized { window.deminiaturize(nil) }
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
    private func installHeaderDoubleClick() {
        headerEventMonitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            guard let self, event.window === self.window, event.clickCount == 2 else { return event }
            let point = event.locationInWindow
            let height = self.window.contentView?.bounds.height ?? self.window.frame.height
            let inHeader = point.y >= height - self.window.dragHeight
            let contentPoint = self.window.contentView?.convert(point, from: nil) ?? point
            guard inHeader, !self.window.isOverToolbar(contentPoint) else { return event }
            self.collapseNear(anchor: self.screenPoint(from: event))
            return nil
        }
    }
    @objc private func showReminderSettings() { desk.show(.appearance) }
    @objc private func showStorage() { desk.show(.storage) }
    @objc private func showClock() { desk.show(.clock) }
    @objc private func collapseToIcon() {
        collapseNear(anchor: mouseTriggeredCollapseAnchor())
    }

    private func collapseNear(anchor: NSPoint?) {
        guard window.isVisible else { return }
        model.commitEditing()
        let frame = window.frame
        window.orderOut(nil)
        floatingMascot.show(near: frame, anchoredAt: anchor)
        collapseAnchorInNote = floatingMascot.iconCenter.map { NSPoint(x: $0.x - frame.minX, y: $0.y - frame.minY) }
        if let path = argument(after: "--icon-snapshot") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [self] in
                floatingMascot.captureSnapshot(at: URL(fileURLWithPath: path))
            }
        }
    }

    private func mouseTriggeredCollapseAnchor() -> NSPoint? {
        guard let event = NSApp.currentEvent else { return nil }
        switch event.type {
        case .leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp:
            return screenPoint(from: event)
        default:
            return nil
        }
    }

    private func screenPoint(from event: NSEvent) -> NSPoint {
        if let eventWindow = event.window {
            return eventWindow.convertPoint(toScreen: event.locationInWindow)
        }
        return NSEvent.mouseLocation
    }

    @objc private func togglePet() { model.petVisible.toggle() }
    /// ⌘1–⌘3 are the note's tabs, except typed in the desk, where ⌘1…⌘9 pick its panes (the
    /// menu items themselves, chosen with the pointer, still go to the note).
    private var typedInDesk: Bool { desk.isKey && NSApp.currentEvent?.type == .keyDown }
    @objc private func showTodos() { if typedInDesk { desk.select(shortcut: 1) } else { showWindow(); model.page = .todos } }
    @objc private func showGuide() { showWindow(); model.showGuide() }
    @objc private func showAhead() { if typedInDesk { desk.select(shortcut: 2) } else { showWindow(); model.page = .ahead } }
    @objc private func showMemos() { if typedInDesk { desk.select(shortcut: 3) } else { showWindow(); model.page = .memos } }
    @objc private func newMemo() { showWindow(); model.newMemo() }
    @objc private func showQuickMemo() { quickMemo.show() }
    @objc private func showQuickEntry() { quickEntry.show() }
    /// Sunday evening, once a week: the cat cheers for the week's finished tasks.
    private func startWeeklyLookBack(preferences: UserDefaults) {
        let timer = Timer(timeInterval: 10 * 60, repeats: true) { _ in
            Task { @MainActor [weak self] in self?.checkWeeklyLookBack() }
        }
        timer.tolerance = 60
        RunLoop.main.add(timer, forMode: .common)
        weeklyTimer = timer
        DispatchQueue.main.asyncAfter(deadline: .now() + 20) { [weak self] in self?.checkWeeklyLookBack() }
    }

    private func checkWeeklyLookBack() {
        let preferences = UserDefaults.standard
        // `--weekly-now 2026-10-04T19:00:00+09:00` checks the Sunday cheer on any day.
        let now = argument(after: "--weekly-now").flatMap { ISO8601DateFormatter().date(from: $0) } ?? Date()
        guard model.petVisible,
              let count = Archive.weeklyLookBack(archive.allEntries(), now: now, lastShownWeek: preferences.string(forKey: "weekly.lastShown"))
        else { return }
        preferences.set(Archive.weekKey(now), forKey: "weekly.lastShown")
        pet.celebrate()
        pet.say(Archive.lookBackMessage(count, language: .current), for: 10)
    }

    @objc private func showHelp() { desk.show(.help) }
    @objc private func showHistory() { desk.show(.history) }
    @objc private func openCalendar() { showCalendar(on: nil) }
    @objc private func exportBackup() { BackupController.export(model: model) }
    @objc private func importBackup() { BackupController.importBackup(model: model) }

    /// 책상 → 달력, on a day (an event alert's) or where it was.
    private func showCalendar(on day: String?) {
        if let day { model.calendar.windowDay = day }
        desk.show(.calendar)
    }
    @objc private func largerText() { if let size = model.textSize.larger { model.textSize = size } }
    @objc private func smallerText() { if let size = model.textSize.smaller { model.textSize = size } }
    @objc private func regularText() { model.textSize = .regular }
    @objc private func newTask() { showWindow(); model.focusNewTask() }
    @objc private func copyList() { model.copyTasks() }
    @objc private func export() { model.exportTasks() }
    @objc private func undo() {
        // Right after the input line made something (its toast still up): that goes first.
        if model.inputLineFocused, let commit = model.toast?.commit {
            model.takeBack(commit)
            model.toast = nil
            return
        }
        if let editor = window.firstResponder as? NSTextView, !editor.string.isEmpty, editor.undoManager?.canUndo == true {
            editor.undoManager?.undo()
        } else if let takeBack = model.toast?.takeBack {
            takeBack()
        } else {
            model.undo()
            // A move on 앞으로 taken back: its toast goes too.
            if model.toast?.moved != nil || model.toast?.undoable == true { model.toast = nil }
        }
    }
    @objc private func redo() {
        if let editor = window.firstResponder as? NSTextView, editor.undoManager?.canRedo == true {
            editor.undoManager?.redo()
        } else { model.redo() }
    }
    @objc private func about() {
        NSApp.orderFrontStandardAboutPanel(options: [
            .applicationName: L("종이냥"), .applicationVersion: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "",
            .credits: NSAttributedString(string: L("가볍게 적고, 하나씩 마치세요.\n이 Mac에만 저장되는 작은 할 일 노트."))
        ])
    }

    private func argument(after flag: String) -> String? {
        guard let index = arguments.firstIndex(of: flag), arguments.indices.contains(index + 1) else { return nil }
        return arguments[index + 1]
    }

    private func captureSnapshot(at path: String) {
        guard let view = window.contentView,
              let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else { return }
        do { try data.write(to: URL(fileURLWithPath: path)) }
        catch { fputs("Snapshot failed: \(error)\n", stderr) }
    }
}
