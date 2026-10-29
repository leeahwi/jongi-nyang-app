import AppKit
import Combine
import PaperCore
import UniformTypeIdentifiers

@MainActor
final class AppModel: ObservableObject {
    @Published private(set) var history = UndoableNotebook() { didSet { revision &+= 1 } }
    /// Bumped on every change to the list: the derived lists below are worked out once per change and day
    /// (1.39 — every row asked for them again on every redraw).
    private var revision = 0
    private var derived: (revision: Int, day: String, today: [TodoItem], ahead: Int)?
    @Published var storageError: String?
    @Published var focusRequest = 0
    @Published var editingTaskReminderID: UUID?
    @Published private var finishingIDs = Set<UUID>()
    private var finishingTasks: [UUID: Task<Void, Never>] = [:]
    @Published var notebookFont: NotebookFont {
        didSet { preferences.set(notebookFont.rawValue, forKey: "notebookFont") }
    }
    @Published var textSize: NotebookTextSize {
        didSet { preferences.set(textSize.rawValue, forKey: "textSize") }
    }
    /// Recurring tasks, kept in repeats.json next to todos.json (same format as the Windows app).
    @Published private(set) var series: [Series] = []
    var onRepeatSettings: (() -> Void)?
    // MARK: Desktop pet & focus timer preferences
    /// The first-launch guide over the note; ⋯ → 사용 안내 shows it again.
    @Published var showsGuide = false
    func showGuide() { showsGuide = true }
    func finishGuide() {
        showsGuide = false
        preferences.set(true, forKey: "guide.seen")
    }
    @Published var petVisible: Bool { didSet { preferences.set(petVisible, forKey: "pet.visible") } }
    @Published var petWanders: Bool { didSet { preferences.set(petWanders, forKey: "pet.wanders") } }
    /// 종이냥 한마디: now and then the cat says something (see PetChatter).
    @Published var chatterEnabled: Bool { didSet { preferences.set(chatterEnabled, forKey: "chatter.enabled") } }
    @Published var chatterFrequency: PetChatter.Frequency { didSet { preferences.set(chatterFrequency.rawValue, forKey: "chatter.frequency") } }
    @Published var chatterQuestions: Bool { didSet { preferences.set(chatterQuestions, forKey: "chatter.questions") } }
    var onChatterPreview: (() -> Void)?
    func previewChatter() { onChatterPreview?() }
    /// The menu bar item's words next to the cat face: automatic or hidden.
    @Published var menuBarText: MenuBarTextMode { didSet { preferences.set(menuBarText.rawValue, forKey: "menuBar.text") } }
    /// 꾸미기 → 종이 색: 자동 (follows macOS) · 낮 · 밤. Every open window follows at once.
    @Published var paperColor: PaperColor {
        didSet {
            preferences.set(paperColor.rawValue, forKey: PaperColor.key)
            paperColor.apply()
        }
    }
    /// ⌃⌥N from any app opens the quick-entry slip.
    @Published var quickEntryEnabled: Bool { didSet { preferences.set(quickEntryEnabled, forKey: "quickEntry.enabled") } }
    /// Whether ⌃⌥N could be claimed (set by the app; another app may own the shortcut).
    @Published var quickEntryRegistered = true
    /// ⌃⌥M from any app opens the quick-note panel.
    @Published var quickMemoEnabled: Bool { didSet { preferences.set(quickMemoEnabled, forKey: "quickMemo.enabled") } }
    /// Whether ⌃⌥M could be claimed (set by the app).
    @Published var quickMemoRegistered = true
    /// What was typed in the quick-note panel and not added yet: it stays for next time.
    var quickMemoDraft: String {
        get { preferences.string(forKey: "quickMemo.draft") ?? "" }
        set { newValue.isEmpty ? preferences.removeObject(forKey: "quickMemo.draft") : preferences.set(newValue, forKey: "quickMemo.draft") }
    }
    /// Set by the app: shows the quick-note panel.
    var onQuickMemo: (() -> Void)?
    func showQuickMemo() { onQuickMemo?() }
    // MARK: 편의 기능 (1.38)

    /// 저녁 정리: on/off and the time (minutes after midnight, 18:00–22:00).
    @Published var sweepEnabled: Bool { didSet { preferences.set(sweepEnabled, forKey: "sweep.enabled") } }
    @Published var sweepTime: Int { didSet { preferences.set(sweepTime, forKey: "sweep.time") } }
    /// The day key the tidy-up last came for (see Sweep.due).
    var sweepShown: String? {
        get { preferences.string(forKey: "sweep.shown") }
        set { preferences.set(newValue, forKey: "sweep.shown") }
    }
    /// 오늘 꼭 하나: asks for the day's one thing (default off).
    @Published var dailyPickEnabled: Bool { didSet { preferences.set(dailyPickEnabled, forKey: "dailyPick.enabled") } }
    /// Today's one thing: the task and the day it was picked for.
    @Published var dailyPick: DailyPick? {
        didSet { preferences.set(dailyPick.flatMap { try? JSONEncoder().encode($0) }, forKey: "dailyPick.current") }
    }
    /// 시스템 알림으로도 보내기: 놓친 것만 · 항상 · 끄기.
    @Published var systemNotices: SystemNoticeMode { didSet { preferences.set(systemNotices.rawValue, forKey: "systemNotices") } }
    /// ⌃⌥J from any app shows or hides the note.
    @Published var noteHotKeyEnabled: Bool { didSet { preferences.set(noteHotKeyEnabled, forKey: "noteHotKey.enabled") } }
    @Published var noteHotKeyRegistered = true
    /// Dock에 남은 개수: today's open to-dos on the Dock icon.
    @Published var dockBadge: Bool { didSet { preferences.set(dockBadge, forKey: "dock.badge") } }
    /// 빠른 메모를 열 때 복사한 글 넣기 (default off).
    @Published var quickMemoClipboard: Bool { didSet { preferences.set(quickMemoClipboard, forKey: "quickMemo.clipboard") } }
    /// Set by the app: the search slip, the note docked to an edge, the desk's history on a day.
    var onSearch: (() -> Void)?
    var onDockNote: ((DockSide) -> Void)?
    var dockedSide: (() -> DockSide?)?
    /// 검색 → 완료 기록: the day the history pane should show.
    @Published var historyDay: String?

    @Published var pomodoroSettings: PomodoroSettings {
        didSet { preferences.set(try? JSONEncoder().encode(pomodoroSettings), forKey: "pet.pomodoro") }
    }
    @Published var pomodoroAutoContinue: Bool { didSet { preferences.set(pomodoroAutoContinue, forKey: "pet.autoContinue") } }
    @Published var timerSound: Bool { didSet { preferences.set(timerSound, forKey: "pet.sound") } }
    /// How big the floating timer is drawn.
    @Published var timerSize: TimerSize { didSet { preferences.set(timerSize.rawValue, forKey: "timer.size") } }
    /// Typed timer lengths (직접 정하기), newest first, for every timer menu.
    @Published private(set) var timerRecent: [Int] { didSet { preferences.set(timerRecent, forKey: "timer.recent") } }
    func rememberTimer(_ minutes: Int) {
        let recent = TimerLength.remember(minutes, in: timerRecent)
        if recent != timerRecent { timerRecent = recent }
    }
    /// Set by the app: starts, pauses or stops the pet's timer.
    var onPetCommand: ((PetCommand) -> Void)?
    func petCommand(_ command: PetCommand) { onPetCommand?(command) }

    // MARK: 집중 (1.37)

    /// The timer and what it's for (a plain timer, or 집중 on a to-do): the note shows the focus card
    /// while a focus runs; FocusTimerController keeps it going.
    let timerState = FocusTimerState()
    /// 할 일 골라 집중…: the note's rows offer 집중 until one is picked (Esc cancels).
    @Published var focusPicking = false
    /// focus.jsonl, next to todos.json.
    private(set) lazy var focusLog = FocusLog(folder: storageFolderURL, model: self)

    /// 할 일 골라 집중…: the 오늘 sheet, its rows offering 집중.
    func startFocusPick() {
        commitEditing()
        if openMemoID != nil { closeMemo() }
        page = .todos
        focusPicking = true
        // The first open row is picked, so Return (or Space) focuses on it at once.
        selectedTaskID = todayDisplayOrder.first { !$0.isCompleted }?.id
    }

    /// 이거 집중 for `minutes` (the Pomodoro's focus length when nil).
    func focus(on id: UUID, minutes: Int? = nil) {
        petCommand(.focus(task: id, minutes: minutes ?? pomodoroSettings.focusMinutes))
    }

    /// "보고서 25분 집중": the open to-do with that title (today's first), or a new one on today's sheet.
    /// Returns the to-do and whether it was made here.
    func focusTarget(title: String, now: Date = Date()) -> (id: UUID, made: Bool)? {
        let wanted = title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !wanted.isEmpty else { return nil }
        let open = items.filter { !$0.isCompleted && $0.title.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == wanted }
        if let found = open.first(where: { Shelf.page(of: $0, now: now) == .today }) ?? open.first { return (found.id, false) }
        var made: UUID?
        mutate { made = $0.add(title.trimmingCharacters(in: .whitespacesAndNewlines), now: now)?.id }
        return made.map { ($0, true) }
    }

    /// Set by the app: Settings → 시계, where alarms are made.
    var onAlarmSettings: (() -> Void)?
    func showAlarmSettings() { onAlarmSettings?() }

    // MARK: Memos — the back of the sheet

    /// 오늘 · 앞으로 (앞으로 took over 마감 and 나중에 in 1.35; the 메모 tab became 메모 서랍 in 1.43).
    enum Page: String, Hashable { case todos, ahead

        /// A page as an older version or another place names it: 마감 and 나중에 open 앞으로; 메모 opens 오늘.
        init?(saved: String) {
            switch saved {
            case "deadlines", "deadline", "later": self = .ahead
            case "memos": self = .todos
            default: self.init(rawValue: saved)
            }
        }
    }
    @Published var page: Page = .todos { didSet { if page != oldValue { selectedTaskID = nil } } }
    /// Newest first.
    @Published private(set) var memos: [Memo] = []
    /// The memo open in 메모 서랍 (its slip expanded): kept even blank while open, and its typing wins over a late arrival.
    @Published var openMemoID: String? { didSet { if openMemoID != oldValue { openMemoTyped = false } } }
    /// Typed in since it was opened: another device's edit of the open memo is then joined with
    /// this Mac's, rather than taken as it is.
    private var openMemoTyped = false
    @Published private(set) var lastDeletedMemo: Memo?
    private var memoSaveTask: Task<Void, Never>?
    /// memos.json as this Mac last read or wrote it; anything else there came from another device.
    private var knownMemosData: Data?
    /// Memos written or deleted here since the last save: kept as they are here when another
    /// device's memos come in.
    private var memoEdits: Set<String> = []
    private var memoDeletions: Set<String> = []
    private var memosURL: URL { file.url.deletingLastPathComponent().appendingPathComponent("memos.json") }
    /// 메모 서랍 (1.43): folders and pins, in memo-folders.json next to memos.json (MemoDrawerModel.swift).
    @Published var memoFolders = MemoFolders.fresh(language: .current)
    /// memo-folders.json as this Mac last read or wrote it.
    var knownFoldersData: Data?
    /// The drawer: its settings (this Mac's), what it shows, its window (set by the app).
    private(set) lazy var drawer = MemoDrawer(model: self)
    /// Set by the app: opens or closes the drawer (the note's paw button, the cat, ⋯, 윈도우 메뉴, ⌘3).
    var onMemoDrawer: (() -> Void)?
    func toggleMemoDrawer() { onMemoDrawer?() }
    /// 책상 → 메모 서랍 → 서랍 열기: opens it (never closes it, unlike the toggle).
    var onOpenMemoDrawer: (() -> Void)?
    func openMemoDrawer() { onOpenMemoDrawer?() }
    /// Set by the app: the drawer opens on this memo, expanded (a search result, a toast's 열기).
    var onRevealMemo: ((String) -> Void)?
    func revealMemo(_ id: String) { onRevealMemo?(id) }
    /// Set by the app: the drawer opens with the keyboard in its quick-write slip (⇧⌘N 새 메모).
    var onWriteMemo: (() -> Void)?
    func writeMemo() { onWriteMemo?() }
    /// Set by the app: the recorder in Settings pauses the drawer's shortcut while a key is recorded.
    var onPauseDrawerShortcut: ((Bool) -> Void)?

    /// A blank memo, open for typing (it goes away when closed blank).
    @discardableResult
    func newMemo() -> String {
        if openMemoID != nil { closeMemo() }
        let memo = Memo()
        memos.insert(memo, at: 0)
        memoEdits.insert(memo.id)
        openMemoID = memo.id
        return memo.id
    }

    /// 빠른 메모: a new memo at the top of 메모 with this text, saved right away (the memo tab
    /// isn't opened).
    /// From 1.43 it goes into the drawer's last folder (메모 when the drawer was never opened); the drawer's
    /// quick-write slip gives its own folder (and 고정 a pin).
    @discardableResult
    func addMemo(text: String, folder: String? = nil, pinned: Bool = false) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let memo = Memo(text: text)
        memos.insert(memo, at: 0)
        memoEdits.insert(memo.id)
        saveMemosNow()
        let target = folder ?? memoFolders.lastFolder(drawer.lastFolder)
        if target != MemoFolders.inbox || pinned {
            changeMemoFolders { folders, now in
                folders.place(memo.id, in: target, now: now)
                if pinned { folders.setPinned(memo.id, true, now: now) }
            }
        }
        return memo.id
    }

    /// 복제 of a folder (D21): the copies keep their originals' times, so the copy's list looks the same.
    @discardableResult
    func duplicateMemoFolder(_ id: String) -> String? {
        guard memoFolders.folder(id) != nil else { return nil }
        let originals = memos.filter { memoFolders.folderID(of: $0.id) == id }
        var copies: [(String, String)] = []
        for memo in originals {
            let copy = Memo(text: memo.text, createdAt: memo.createdAt, updatedAt: memo.updatedAt)
            copies.append((memo.id, copy.id))
            memos.append(copy)
            memoEdits.insert(copy.id)
        }
        if !copies.isEmpty {
            // Newest first, as the memos are kept (stable: equal times keep their order).
            memos = memos.enumerated().sorted { $0.element.updatedAt != $1.element.updatedAt ? $0.element.updatedAt > $1.element.updatedAt : $0.offset < $1.offset }.map(\.element)
            saveMemosNow()
        }
        let newID = UUID().uuidString.lowercased()
        var made: String?
        changeMemoFolders { folders, now in made = folders.duplicateFolder(id, as: newID, copies: copies, now: now, language: .current) }
        return made
    }

    /// 복제 of one memo: a new memo now, in the same folder with the same pin and paper.
    @discardableResult
    func duplicateMemo(_ id: String) -> String? {
        guard let memo = memos.first(where: { $0.id == id }) else { return nil }
        let copy = Memo(text: memo.text)
        memos.insert(copy, at: 0)
        memoEdits.insert(copy.id)
        saveMemosNow()
        let folder = memoFolders.folderID(of: id), pinned = memoFolders.isPinned(id), paper = memoFolders.paper(of: id)
        if folder != MemoFolders.inbox || pinned || paper != nil {
            changeMemoFolders { folders, now in
                folders.place(copy.id, in: folder, now: now)
                if pinned { folders.setPinned(copy.id, true, now: now) }
                if let paper { folders.setPaper(copy.id, paper, now: now) }
            }
        }
        return copy.id
    }

    /// 바꾸기 / ⌘Z right after the line made a memo: it goes without a trace (no 되살리기).
    func removeMemoQuietly(_ id: String) {
        guard memos.contains(where: { $0.id == id }) else { return }
        memos.removeAll { $0.id == id }
        memoEdits.remove(id)
        memoDeletions.insert(id)
        if openMemoID == id { openMemoID = nil }
        saveMemosNow()
    }

    /// `from` is the text the editor had before this change: when another device's edit was
    /// joined in meanwhile (and the editor doesn't show it yet), the two are joined again.
    func updateMemo(_ id: String, text typed: String, from: String? = nil) {
        guard let index = memos.firstIndex(where: { $0.id == id }) else { return }
        let current = memos[index].text
        let text = from.map { $0 != current ? TextMerge.merge(base: $0, ours: typed, theirs: current) : typed } ?? typed
        guard text != current else { return }
        memos[index].text = text
        memos[index].updatedAt = Date()
        memoEdits.insert(id)
        if id == openMemoID { openMemoTyped = true }
        if index != 0 { memos.insert(memos.remove(at: index), at: 0) }
        saveMemosSoon()
    }

    func deleteMemo(_ id: String) {
        guard let index = memos.firstIndex(where: { $0.id == id }) else { return }
        let memo = memos.remove(at: index)
        memoEdits.remove(id)
        memoDeletions.insert(id)
        if !memo.isBlank { lastDeletedMemo = memo }
        if openMemoID == id { openMemoID = nil }
        saveMemosNow()
    }

    func restoreDeletedMemo() {
        guard let memo = lastDeletedMemo else { return }
        memoDeletions.remove(memo.id)
        memoEdits.insert(memo.id)
        memos.insert(memo, at: 0)
        memos.sort { $0.updatedAt > $1.updatedAt }
        lastDeletedMemo = nil
        saveMemosNow()
    }

    /// Leaving a memo: a blank one quietly disappears; everything is written out.
    func closeMemo() {
        if let id = openMemoID, memos.first(where: { $0.id == id })?.isBlank == true {
            memos.removeAll { $0.id == id }
        }
        // Saved while still open, so a memo typed in keeps this Mac's text over a late arrival.
        saveMemosNow()
        openMemoID = nil
    }

    private func saveMemosSoon() {
        memoSaveTask?.cancel()
        memoSaveTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(400))
            guard !Task.isCancelled else { return }
            self?.saveMemosNow()
        }
    }

    func saveMemosNow() {
        memoSaveTask?.cancel()
        guard !savingStopped else { return }
        AIWriteLock.with { saveMemosHeld() }
    }

    private func saveMemosHeld() {
        catchUpMemos()
        let started = PerfProbe.now
        defer { PerfProbe.io("memos", since: started) }
        do {
            knownMemosData = try MemoFile.save(memos.filter { !$0.isBlank || $0.id == openMemoID }, to: memosURL)
            memoEdits = []
            memoDeletions = []
        } catch {
            storageError = L("메모를 저장하지 못했어요.") + "\n\(memosURL.path)"
        }
    }

    /// How deadlines read on rows: "D-3" or "~금".
    @Published var dueStyle: DueStyle { didSet { preferences.set(dueStyle.rawValue, forKey: "dueStyle") } }
    func setDue(_ id: UUID, to key: String?) { mutate { $0.setDue(id: id, dueDate: key) } }

    /// Sets a deadline and whether the task also stays on today's sheet, as one undo step.
    func setDeadline(_ id: UUID, to key: String, keepOnToday: Bool) {
        mutate { $0.setDeadline(id: id, dueDate: key, keepOnToday: keepOnToday) }
    }

    @Published var archiveAfterDays: ArchiveAfterDays {
        didSet { preferences.set(archiveAfterDays.rawValue, forKey: "archiveAfterDays") }
    }
    var onHistory: (() -> Void)?
    var onHelp: (() -> Void)?
    /// Set by the app: the desk (책상), on one of its panes.
    var onDesk: ((DeskPane) -> Void)?
    func showDesk(_ pane: DeskPane = .calendar) { onDesk?(pane) }
    /// Brings the note forward (a quick-entry event to finish on the 오늘 page).
    var onShowNote: (() -> Void)?
    /// The 달력 window, on a day ("yyyy-MM-dd") or today.
    var onCalendar: ((String?) -> Void)?
    func showCalendar() { onCalendar?(nil) }
    func showCalendar(on day: String) { onCalendar?(day) }

    /// ⋯ → 새 일정: the sheet on the 오늘 page (over the strip, or the top of the note).
    func newEvent() {
        page = .todos
        calendar.sheet = CalendarSheetRequest(mode: .new, draft: .new(now: Date(), color: calendar.lastColor))
    }

    /// From the 달력 window: the note, on the tab that has the to-do, with it picked.
    func reveal(_ id: UUID) {
        let now = Date()
        page = items.first { $0.id == id }.map { Shelf.page(of: $0, now: now) != .today } == true ? .ahead : .todos
        onShowNote?()
        selectedTaskID = id
    }
    func showHelp() { onHelp?() }
    @Published var reminderStyle: ReminderPresentationStyle {
        didSet { preferences.set(reminderStyle.rawValue, forKey: "reminderStyle") }
    }
    var onCollapse: (() -> Void)?
    var onReminderSettings: (() -> Void)?
    var onTaskReminderEditing: (() -> Void)?
    @Published var hideCompleted: Bool {
        didSet { preferences.set(hideCompleted, forKey: "hideCompleted") }
    }
    @Published var alwaysOnTop: Bool {
        didSet {
            preferences.set(alwaysOnTop, forKey: "alwaysOnTop")
            window?.level = alwaysOnTop ? .floating : .normal
        }
    }
    weak var window: NSWindow?
    let file: NotebookFile
    let preferences: UserDefaults
    /// 일정: the app's own events, in events.json next to todos.json.
    let calendar: EventBook
    /// 시계 알람, in alarms.json next to todos.json.
    let alarms: AlarmBook
    private var canSave = true
    var hasUnsavedChanges = false
    var notebookNow: Notebook { history.notebook }
    /// 가져오기 wrote the folder: nothing here is saved over it before the restart.
    private(set) var savingStopped = false

    /// Everything here on disk now (before a backup is made or imported).
    func saveEverything() {
        commitEditing()
        if hasUnsavedChanges { retrySave() }
        saveMemosNow()
    }

    func stopSaving() {
        savingStopped = true
        memoSaveTask?.cancel()
        calendar.stopSaving()
        alarms.stopSaving()
    }

    /// A preview, a snapshot or a test copy (`--storage`): nothing system-wide is changed from it.
    let isolatedRun: Bool

    init(storageURL: URL, isolated: Bool = false, demo: Bool = false, preferences suppliedPreferences: UserDefaults? = nil) {
        file = NotebookFile(url: storageURL)
        isolatedRun = isolated
        preferences = suppliedPreferences ?? (isolated ? UserDefaults(suiteName: "PaperTodo.Preview")! : .standard)
        preferences.removeObject(forKey: "mascot")
        calendar = EventBook(preferences: preferences, folder: storageURL.deletingLastPathComponent())
        alarms = AlarmBook(preferences: preferences, folder: storageURL.deletingLastPathComponent())
        notebookFont = NotebookFont(rawValue: preferences.string(forKey: "notebookFont") ?? "") ?? .pen
        textSize = NotebookTextSize(rawValue: preferences.string(forKey: "textSize") ?? "") ?? .regular
        let store = preferences
        let flag = { (key: String, fallback: Bool) in store.object(forKey: key) == nil ? fallback : store.bool(forKey: key) }
        petVisible = flag("pet.visible", !isolated)
        showsGuide = !isolated && !store.bool(forKey: "guide.seen")
        petWanders = flag("pet.wanders", true)
        chatterEnabled = flag("chatter.enabled", true)
        chatterFrequency = PetChatter.Frequency(rawValue: store.string(forKey: "chatter.frequency") ?? "") ?? .normal
        chatterQuestions = flag("chatter.questions", true)
        quickEntryEnabled = flag("quickEntry.enabled", true)
        menuBarText = MenuBarTextMode(rawValue: store.string(forKey: "menuBar.text") ?? "") ?? .auto
        paperColor = PaperColor(rawValue: store.string(forKey: PaperColor.key) ?? "") ?? .auto
        quickMemoEnabled = flag("quickMemo.enabled", true)
        timerRecent = TimerLength.cleaned((store.array(forKey: "timer.recent") as? [Int]) ?? [])
        pomodoroAutoContinue = flag("pet.autoContinue", true)
        timerSize = TimerSize(rawValue: store.string(forKey: "timer.size") ?? "") ?? .regular
        timerSound = flag("pet.sound", true)
        sweepEnabled = flag("sweep.enabled", true)
        sweepTime = Sweep.times.contains(store.integer(forKey: "sweep.time")) ? store.integer(forKey: "sweep.time") : Sweep.defaultTime
        dailyPickEnabled = flag("dailyPick.enabled", false)
        dailyPick = store.data(forKey: "dailyPick.current").flatMap { try? JSONDecoder().decode(DailyPick.self, from: $0) }
        systemNotices = SystemNoticeMode(rawValue: store.string(forKey: "systemNotices") ?? "") ?? .missed
        noteHotKeyEnabled = flag("noteHotKey.enabled", true)
        dockBadge = flag("dock.badge", false)
        quickMemoClipboard = flag("quickMemo.clipboard", false)
        pomodoroSettings = store.data(forKey: "pet.pomodoro").flatMap { try? JSONDecoder().decode(PomodoroSettings.self, from: $0) } ?? PomodoroSettings()
        dueStyle = DueStyle(rawValue: store.string(forKey: "dueStyle") ?? "") ?? .dday
        archiveAfterDays = preferences.object(forKey: "archiveAfterDays") == nil
            ? .nextDay : ArchiveAfterDays(rawValue: preferences.integer(forKey: "archiveAfterDays")) ?? .nextDay
        reminderStyle = ReminderPresentationStyle(rawValue: preferences.string(forKey: "reminderStyle") ?? "") ?? .paper
        remindersShownHere = Set(preferences.stringArray(forKey: "taskReminders.shownHere") ?? [])
        hideCompleted = isolated ? false : preferences.bool(forKey: "hideCompleted")
        alwaysOnTop = isolated ? false : preferences.bool(forKey: "alwaysOnTop")
        loadRepeats()
        let memosFile = file.url.deletingLastPathComponent().appendingPathComponent("memos.json")
        do {
            memos = try MemoFile.load(memosFile).sorted { $0.updatedAt > $1.updatedAt }
            knownMemosData = try? Data(contentsOf: memosFile)
        } catch {
            keepUnreadable(memosFile, what: .memos)
        }
        loadMemoFolders()
        do {
            history = UndoableNotebook(notebook: try file.load())
        } catch NotebookFileError.missing {
            // The first launch starts with a blank sheet.
        } catch {
            let backup = storageURL.deletingPathExtension()
                .appendingPathExtension("unreadable-\(Int(Date().timeIntervalSince1970)).json")
            do {
                try FileManager.default.copyItem(at: storageURL, to: backup)
                storageError = L("전에 쓰던 목록을 읽지 못했어요. 원본은 \(backup.lastPathComponent)에 남겨 뒀어요. 새 목록은 그대로 잘 저장돼요.")
            } catch {
                canSave = false
                storageError = L("전에 쓰던 목록을 읽지 못했어요. 원본을 지키려고 덮어쓰지 않아요. 지금 목록은 ‘텍스트로 내보내기’로 남겨 두세요.") + "\n\(storageURL.path)"
            }
        }
        // 어제부터: older files have no stamps yet — today, from now on.
        history.stampToday(now: Date())
        if demo && history.notebook.items.isEmpty {
            var notebook = Notebook()
            notebook.add(L("창문 열고, 커피 한 잔"))
            notebook.add(L("오늘 꼭 해야 할 일 정리하기"))
            notebook.add(L("미뤄 둔 책 10쪽 읽기"))
            notebook.add(L("잠깐, 바깥 공기 쐬기"))
            notebook.add(L("내일의 나에게 메모 남기기"))
            if let first = notebook.items.first { notebook.toggle(id: first.id) }
            history = UndoableNotebook(notebook: notebook)
        }
    }

    var items: [TodoItem] { history.notebook.items }
    /// Today's sheet (see Shelf): undated work, pinned tasks, and deadlines that have arrived.
    var todayItems: [TodoItem] { derivedLists().today }

    /// Today's sheet and 앞으로's count, for this version of the list on this (4 a.m.) day.
    private func derivedLists() -> (today: [TodoItem], ahead: Int) {
        let now = Date()
        let day = Archive.dayKey(now)
        if let derived, derived.revision == revision, derived.day == day { return (derived.today, derived.ahead) }
        let today = items.filter { Shelf.page(of: $0, now: now) == .today }
        let ahead = items.filter { Ahead.isAhead($0, now: now) }.count
        derived = (revision, day, today, ahead)
        return (today, ahead)
    }
    var visibleItems: [TodoItem] { todayItems.filter(isShown) }
    /// Today's rows as the sheet shows them: 다음 first, then the rest.
    var todayDisplayOrder: [TodoItem] {
        let visible = visibleItems
        let split = TodayGroups.split(visible, series: series, now: Date(), first: todayPickID)
        let byID = Dictionary(uniqueKeysWithValues: visible.map { ($0.id, $0) })
        return (split.next + split.rest).compactMap { byID[$0] }
    }

    /// What the cat knows when it speaks up: today's sheet and the deadlines.
    func chatterContext(now: Date = Date()) -> PetChatter.Context {
        let today = todayItems
        let open = today.filter { !$0.isCompleted }
        let todayKey = Deadline.key(Archive.logicalDayStart(now))
        let tomorrowKey = Deadline.key(Calendar.paper.date(byAdding: .day, value: 1, to: Archive.logicalDayStart(now))!)
        let waiting = items.filter { !$0.isCompleted }.compactMap(\.dueDate)
        let events = calendar.hasEvents ? CalendarDay.chatter(calendar.visibleEvents, now: now) : nil
        return PetChatter.Context(
            hour: Calendar.paper.component(.hour, from: now),
            open: open.count, done: today.count - open.count,
            overdue: waiting.filter { $0 < todayKey }.count,
            dueSoon: waiting.filter { $0 == todayKey || $0 == tomorrowKey }.count,
            firstOpen: open.first?.title,
            weekday: Calendar.paper.component(.weekday, from: now) - 1,
            nextEvent: events?.next, nextIn: events?.nextIn ?? 0, nowEvent: events?.now,
            endedEvent: events?.ended, eventsLeft: events?.left ?? 0)
    }
    /// "완료한 일 숨기기" applies to every page; a just-finished task lingers for its animation.
    private func isShown(_ item: TodoItem) -> Bool { !hideCompleted || !item.isCompleted || finishingIDs.contains(item.id) }
    // MARK: 앞으로

    /// The 앞으로 tab: this week's and next week's days (events and tasks due), later deadlines by
    /// month, and 언젠가 (see Ahead). A task just checked there stays a moment for its animation.
    func aheadSections(now: Date = Date()) -> [Ahead.Section] {
        let shown = items.map { item -> TodoItem in
            guard item.isCompleted, finishingIDs.contains(item.id) else { return item }
            var lingering = item
            lingering.isCompleted = false
            return lingering
        }
        return Ahead.sections(items: shown, events: aheadEvents(now: now), now: now, language: .current)
    }

    /// Event occurrences from today to a little past next week (Ahead keeps tomorrow … next week).
    func aheadEvents(now: Date = Date()) -> [CalendarEvent] {
        let week = Ahead.week(of: now, language: .current)
        let from = Calendar.paper.startOfDay(for: Archive.logicalDayStart(now))
        let last = Deadline.date(from: week.last) ?? now
        return calendar.occurrences(from: from, to: Calendar.paper.date(byAdding: .day, value: 9, to: last)!)
    }

    /// The 앞으로 rows top to bottom (for the keyboard).
    var aheadItems: [TodoItem] {
        let byID = Dictionary(uniqueKeysWithValues: items.map { ($0.id, $0) })
        return aheadSections().flatMap { section in
            section.days.flatMap(\.tasks) + section.months.flatMap(\.tasks) + section.tasks
        }.compactMap { byID[$0] }
    }

    /// Open tasks on 앞으로 (its tab's count).
    var aheadCount: Int { derivedLists().ahead }

    /// Drops on 앞으로: on a day, it's due that day (off the later shelf and today's pin); on 언젠가,
    /// saved for later without a date; on 오늘, onto today's sheet. One undo step, and a toast with
    /// 되돌리기 (⌘Z works too).
    func move(_ id: UUID, to destination: Ahead.Destination, now: Date = Date()) {
        guard let item = items.first(where: { $0.id == id }) else { return }
        switch destination {
        case .day(let key):
            guard item.dueDate != key || item.shelf != nil else { return }
            mutate { $0.schedule(id: id, dueDate: key) }
        case .someday:
            guard item.dueDate != nil || item.shelf != .later else { return }
            mutate { $0.saveForLater(id: id) }
        case .today:
            guard Shelf.page(of: item, now: now) != .today else { return }
            moveToToday(id)
        }
        let after = history.notebook
        var toast = PaperToast(symbol: destination == .someday ? "tray" : destination == .today ? "sun.max" : "calendar",
                               text: { if case .day(let key) = destination { DateMove.movedText(key, now: now, language: .current) } else { Ahead.movedText(destination, now: now, language: .current) } }())
        toast.action = L("되돌리기")
        toast.moved = id
        toast.perform = { [weak self] in
            guard let self else { return }
            // Right after the move it is the last step; otherwise only this task goes back.
            if self.history.notebook == after { self.undo() } else {
                self.mutate { $0.restorePlace(id: id, dueDate: item.dueDate, shelf: item.shelf) }
            }
            self.toast = nil
        }
        self.toast = toast
    }
    /// The 오늘 창's tasks: today's open ones (and one just checked, for its animation).
    var glanceTodayItems: [TodoItem] { todayItems.filter { !$0.isCompleted || finishingIDs.contains($0.id) } }
    /// Counts for today's sheet — what the footer, menu bar and reminders talk about.
    var completedCount: Int { todayItems.filter(\.isCompleted).count }
    var remainingCount: Int { todayItems.filter { !$0.isCompleted }.count }
    /// Every finished task, wherever it lives.
    var totalCompletedCount: Int { history.notebook.completedCount }

    /// "오늘 하기": onto today's sheet (pinned if its deadline is still ahead).
    func moveToToday(_ id: UUID) {
        guard let item = items.first(where: { $0.id == id }) else { return }
        mutate { $0.setShelf(id: id, shelf: item.dueDate == nil ? nil : .today) }
    }

    /// "나중에 하기": off today's sheet onto the 나중에 shelf.
    func moveToLater(_ id: UUID) { mutate { $0.setShelf(id: id, shelf: .later) } }

    /// Added on 앞으로 without a date: 언젠가 (the later shelf); with one, on that day.
    func addLater(_ title: String, literal: Bool = false) { addTyped(title, shelf: .later, literal: literal) }

    /// Adds what was typed, understanding dates and times in it ("내일 3시 회의" → an alert,
    /// "금요일까지 보고서" → a deadline). `literal` (Shift+Return) keeps the text as it is.
    func addTyped(_ text: String, shelf: ShelfPin? = nil, defaultDue: String? = nil, literal: Bool = false, now: Date = Date()) {
        let parsed = literal ? QuickParse(title: text) : QuickParse.parse(text, now: now, language: .current)
        addParsed(parsed, shelf: shelf, defaultDue: defaultDue, now: now)
    }

    /// A to-do as it was read, with the sheet's defaults; returns its id.
    @discardableResult
    func addParsed(_ parsed: QuickParse, shelf: ShelfPin? = nil, defaultDue: String? = nil, now: Date = Date()) -> UUID? {
        // A deadline, alert or time range means it has a day; it leaves 언젠가 for its day (or today).
        let pin = parsed.dueDate != nil || parsed.reminderAt != nil || parsed.range != nil ? nil : shelf
        var made: UUID?
        mutate { made = $0.add(parsed.title, shelf: pin, dueDate: parsed.dueDate ?? defaultDue, reminder: parsed.reminderAt, range: parsed.range, now: now)?.id }
        return made
    }

    // MARK: 입력 줄

    /// The toast at the bottom of the sheet (one at a time).
    @Published var toast: PaperToast?
    /// The input line has the keyboard (⌘Z and Esc then belong to the toast).
    @Published var inputLineFocused = false
    /// 하루 일정표 (1.40): set while the open day has the keys (opened or clicked there); the note window offers it
    /// each key first.
    var timetableKey: ((NSEvent) -> Bool)?
    /// What 바꾸기 taught the line (`intent.prefer`).
    var intentMemory: Intent.Memory {
        get {
            if let intentMemoryRead { return intentMemoryRead }
            let read = preferences.data(forKey: "intent.prefer").flatMap { try? JSONDecoder().decode(Intent.Memory.self, from: $0) } ?? Intent.Memory()
            intentMemoryRead = read
            return read
        }
        set {
            intentMemoryRead = newValue
            preferences.set(try? JSONEncoder().encode(newValue), forKey: "intent.prefer")
        }
    }
    /// `intent.prefer` as read once (the line asks on every key press).
    private var intentMemoryRead: Intent.Memory?
    var canUndo: Bool { history.canUndo }
    var canRedo: Bool { history.canRedo }
    var mascotImage: NSImage { PaperTheme.mascot }

    func minimizeToIcon() { onCollapse?() }
    func showReminderSettings() { onReminderSettings?() }
    func showHistory() { onHistory?() }
    func showRepeatSettings() { onRepeatSettings?() }

    // MARK: Recurring tasks

    /// Creates or updates a recurring task. From a row, the task itself becomes today's copy
    /// when the rule applies today (and gets today's alert if that time is still ahead).
    @discardableResult
    func saveSeries(taskID: UUID? = nil, seriesID: String? = nil, title: String? = nil, rule: RepeatRule, remindAt: String?, now: Date = Date()) -> String? {
        guard Repeat.isValid(rule) else { return nil }
        let task = taskID.flatMap { id in items.first { $0.id == id } }
        let existingID = seriesID ?? task?.seriesID
        let cleanTitle = title?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let name = [cleanTitle, task?.title, series.first { $0.id == existingID }?.title].compactMap({ $0 }).first(where: { !$0.isEmpty }) else { return nil }
        var entry: Series
        if let index = series.firstIndex(where: { $0.id == existingID }) {
            series[index].title = name
            series[index].rule = rule
            series[index].remindAt = remindAt
            entry = series[index]
        } else {
            entry = Series(title: name, rule: rule, remindAt: remindAt, createdAt: Date(timeIntervalSince1970: now.timeIntervalSince1970.rounded(.down)))
            series.append(entry)
        }
        let today = Archive.logicalDayStart(now)
        let occursToday = Repeat.occurs(entry.rule, on: today)
        // Today's alert only if it is still ahead; a time already past never fires at once.
        let upcoming = occursToday ? entry.remindAt.flatMap { Repeat.alert(on: today, at: $0) }.flatMap { $0 > now ? $0 : nil } : nil
        let seriesID = entry.id
        if let task {
            mutate { $0.linkSeries(id: task.id, seriesID: seriesID, placeToday: occursToday, reminder: upcoming) }
            if occursToday, let index = series.firstIndex(where: { $0.id == seriesID }) {
                series[index].lastPlaced = Archive.dayKey(now)
            }
        }
        saveRepeats()
        placeRecurring(now: now)
        if task == nil {
            let placedToday = occursToday && series.first { $0.id == seriesID }?.lastPlaced == Archive.dayKey(now)
            mutate { $0.applySeries(seriesID, title: name, reminder: placedToday ? .some(upcoming) : nil) }
        }
        return seriesID
    }

    /// 바꾸기 / ⌘Z right after the line made a repeat: the series and its open copies go without a trace.
    func removeSeriesQuietly(_ id: String) {
        series.removeAll { $0.id == id }
        saveRepeats()
        let copies = items.filter { $0.seriesID == id && !$0.isCompleted }.map(\.id)
        guard !copies.isEmpty else { return }
        mutate { history in for copy in copies { history.delete(id: copy) } }
    }

    /// Stops the repetition; copies already on the list stay as ordinary tasks.
    func deleteSeries(_ id: String) {
        series.removeAll { $0.id == id }
        saveRepeats()
        let open = items.filter { $0.seriesID == id && !$0.isCompleted }.map(\.id)
        mutate { history in for item in open { history.setSeries(id: item, seriesID: nil) } }
    }

    /// Puts today's copies on the list; runs at launch, every 30 minutes, after waking and at 4 a.m.
    func placeRecurring(now: Date = Date()) {
        let plan = Repeat.planToday(series, items: items, now: now)
        guard !plan.placed.isEmpty else { return }
        mutate { $0.placeRecurring(create: plan.create, roll: plan.roll) }
        let key = Archive.dayKey(now)
        for index in series.indices where plan.placed.contains(series[index].id) { series[index].lastPlaced = key }
        saveRepeats()
    }

    private var repeatsURL: URL { file.url.deletingLastPathComponent().appendingPathComponent("repeats.json") }

    private struct RepeatsFile: Codable { var series: [Series] }

    private func loadRepeats() {
        guard FileManager.default.fileExists(atPath: repeatsURL.path) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        do {
            series = try decoder.decode(RepeatsFile.self, from: Data(contentsOf: repeatsURL)).series.filter { Repeat.isValid($0.rule) }
        } catch {
            keepUnreadable(repeatsURL, what: .repeats)
        }
    }

    /// An unreadable file is copied aside before anything is saved over it.
    private enum Unreadable { case memos, repeats }

    private func keepUnreadable(_ url: URL, what: Unreadable) {
        let backup = url.deletingPathExtension().appendingPathExtension("unreadable-\(Int(Date().timeIntervalSince1970)).json")
        if (try? FileManager.default.copyItem(at: url, to: backup)) != nil {
            storageError = what == .memos
                ? L("전에 쓰던 메모를 읽지 못했어요. 원본은 \(backup.lastPathComponent)에 남겨 뒀어요.")
                : L("전에 쓰던 반복 할 일을 읽지 못했어요. 원본은 \(backup.lastPathComponent)에 남겨 뒀어요.")
        } else {
            storageError = (what == .memos ? L("전에 쓰던 메모를 읽지 못했어요.") : L("전에 쓰던 반복 할 일을 읽지 못했어요.")) + "\n\(url.path)"
        }
    }

    private func saveRepeats() {
        guard !savingStopped else { return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        do {
            try FileManager.default.createDirectory(at: repeatsURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try encoder.encode(RepeatsFile(series: series)).write(to: repeatsURL, options: .atomic)
        } catch {
            storageError = L("반복 할 일을 저장하지 못했어요.") + "\n\(repeatsURL.path)"
        }
    }
    // MARK: Shared folder

    /// The folder the list lives in, when it's a shared one (iCloud Drive, Dropbox …); nil = this Mac.
    var sharedFolder: URL?

    /// Where everything is kept: todos.json, memos.json, repeats.json and the archive/ folder.
    var storageFolderURL: URL { file.url.deletingLastPathComponent() }
    var archiveFolderURL: URL { storageFolderURL.appendingPathComponent("archive", isDirectory: true) }
    /// For showing in Settings: the home folder as ~.
    static func displayPath(_ url: URL) -> String { (url.path as NSString).abbreviatingWithTildeInPath }

    /// Opens the folder in Finder (made first if nothing was saved yet).
    func openFolder(_ url: URL) {
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        NSWorkspace.shared.open(url)
    }
    var onChooseStorage: (() -> Void)?
    var onResetStorage: (() -> Void)?
    func chooseStorageFolder() { onChooseStorage?() }
    func resetStorageFolder() { onResetStorage?() }

    /// Another device changed the shared files: take its list, memos and repeats. The list waits
    /// while a title is being edited here (the next check catches up); memos written here and the
    /// open memo keep this Mac's text.
    func reloadFromDisk() {
        if !hasUnsavedChanges, editingTaskReminderID == nil, let notebook = try? file.load(), notebook != history.notebook {
            takeFromDisk(notebook)
        }
        catchUpMemos()
        catchUpMemoFolders()
        calendar.reloadIfChanged()
        alarms.reloadIfChanged()
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        if let data = try? Data(contentsOf: repeatsURL), let loaded = try? decoder.decode(RepeatsFile.self, from: data).series.filter({ Repeat.isValid($0.rule) }),
           loaded != series {
            series = loaded
        }
    }

    /// In a shared folder another device may have saved since the last check (it runs every two
    /// seconds): take its list first, so the change about to be made lands on top of it instead
    /// of writing over it. Everything here is saved right away, so a file that differs is newer.
    private func catchUpWithDisk() {
        guard sharedFolder != nil || aiWatching, !hasUnsavedChanges, let notebook = try? file.load(), notebook != history.notebook else { return }
        takeFromDisk(notebook)
    }

    /// Another writer's list. With AI 연결 on (1.42) its changes go into the undo history too, so ⌘Z still takes
    /// back this Mac's own steps; otherwise (another device in a shared folder) the history starts over, as before.
    private func takeFromDisk(_ notebook: Notebook) {
        if aiWatching { history.adopt(notebook) } else { history.replaceNotebook(notebook) }
        objectWillChange.send()
    }

    // MARK: AI 연결 (1.42)

    /// Settings › AI 연결 (nil in previews and snapshots until one is made for them).
    var ai: AIConnection?
    /// While AI 연결 is on, the folder is watched and caught up with before every change even when it is this
    /// Mac's own: the extension writes it (Claude can add while the app is open).
    var aiWatching = false
    /// To-dos and events Claude added or changed today (the small stamp on their rows).
    @Published var aiMarks = AIMarks()

    func isAIMarked(_ id: String) -> Bool {
        guard !aiMarks.ids.isEmpty, aiMarks.ids.contains(id) else { return false }
        return aiMarks.day == Archive.dayKey(Date())
    }

    /// An undo of Claude's work, written like Claude's own changes: not an undo step here (⌘Z after it goes to
    /// this Mac's previous step, not back to Claude's version).
    func adoptExternal(_ notebook: Notebook) {
        AIWriteLock.with {
            history.adopt(notebook)
            history.stampToday(now: Date())
            hasUnsavedChanges = true
            retrySave()
        }
    }

    /// Rows edited here lose their stamp (bookkeeping — 어제부터, a delivered alert — isn't an edit).
    private func clearAIMarks(from before: Notebook, to after: Notebook) {
        let old = Dictionary(before.items.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        func plain(_ item: TodoItem) -> TodoItem {
            var item = item
            item.todaySince = nil
            item.reminderLastDeliveredAt = nil
            return item
        }
        var edited = Set<String>()
        for item in after.items where aiMarks.ids.contains(item.id.uuidString) {
            if let was = old[item.id], plain(was) != plain(item) { edited.insert(item.id.uuidString) }
        }
        if !edited.isEmpty { ai?.clearMarks(edited) }
    }

    /// Another device may have saved memos since this Mac last read them (a shared folder is
    /// checked every two seconds): take its memos, joining in what was written here (and in the
    /// open memo once something was typed in it) and leaving deleted ones out, so a save never
    /// drops a memo or an edit made elsewhere.
    private func catchUpMemos() {
        guard let data = try? Data(contentsOf: memosURL), data != knownMemosData else { return }
        let base = knownMemosData.flatMap { try? MemoFile.decode($0) } ?? []
        knownMemosData = data
        guard let theirs = try? MemoFile.decode(data) else {
            // Half-arrived or broken: kept aside before this Mac's memos are written over it.
            keepUnreadable(memosURL, what: .memos)
            return
        }
        var changedHere = memoEdits
        if let openMemoID, openMemoTyped { changedHere.insert(openMemoID) }
        let merged = MemoFile.merge(base: base, here: memos, theirs: theirs, changedHere: changedHere, deletedHere: memoDeletions)
        if merged != memos { memos = merged }
    }

    /// Finished tasks that were written to the record leave the list (and its undo history).
    func archiveCompleted(_ ids: Set<UUID>) { mutate { $0.archive(ids: ids) } }
    func prepareTaskReminderEditing(_ id: UUID) {
        commitEditing()
        editingTaskReminderID = id
        onTaskReminderEditing?()
    }
    /// Task alerts this Mac has shown ("id@time", see TaskReminderDue), kept for two days. Another
    /// computer's "delivered" mark in a shared folder doesn't stand in for these.
    private(set) var remindersShownHere: Set<String> = []
    func noteRemindersShown(_ shown: [TodoItem], now: Date = Date()) {
        let cutoff = now.addingTimeInterval(-2 * 86_400).timeIntervalSince1970
        var kept = remindersShownHere.filter { key in (key.split(separator: "@").last.flatMap { Double($0) } ?? 0) >= cutoff }
        kept.formUnion(shown.compactMap(TaskReminderDue.key))
        remindersShownHere = kept
        preferences.set(Array(kept).sorted(), forKey: "taskReminders.shownHere")
    }
    func setTaskReminder(_ id: UUID, at date: Date?) { mutate { $0.setReminder(id: id, at: date) } }
    /// 시간 정하기 (1.39): the range (nil clears it) and the reminder that goes with it, one undo step.
    func setTimeRange(_ id: UUID, to range: TimeRange?) { mutate { $0.setTimeRange(id: id, to: range) } }
    func markTaskReminderDelivered(_ id: UUID, at date: Date) { mutate { $0.markReminderDelivered(id: id, at: date) } }
    func completeTask(_ id: UUID) {
        guard items.contains(where: { $0.id == id && !$0.isCompleted }) else { return }
        toggle(id)
    }

    func add(_ title: String, literal: Bool = false) { addTyped(title, literal: literal) }


    // MARK: Dropping a task on a tab

    /// The tab a task is being dragged over (it lifts and gets a green outline).
    @Published var dragOverPage: Page?

    /// Dropped on 앞으로: a task with a deadline still ahead goes to its day (unpinned from
    /// today); one without goes to 언젠가. On 오늘: onto today's sheet. On 메모: nothing. One undo
    /// step, with the toast.
    func dropTask(_ id: UUID, on target: Page, now: Date = Date()) {
        guard let item = items.first(where: { $0.id == id }) else { return }
        switch target {
        case .ahead:
            if let due = item.dueDate, (Deadline.daysLeft(due, now: now) ?? 0) > 0 {
                move(id, to: .day(due), now: now)
            } else {
                move(id, to: .someday, now: now)
            }
        case .todos: move(id, to: .today, now: now)
        }
    }

    // MARK: Keyboard

    /// The row picked with the keyboard (or a click on its empty area) on 오늘 / 앞으로.
    @Published var selectedTaskID: UUID?
    /// Asks a row to start editing its title (Return on the selected row).
    @Published var editRequestID: UUID?

    /// The rows the keyboard walks through on the page that's showing.
    var keyboardRows: [TodoItem] {
        switch page {
        case .todos: todayDisplayOrder
        case .ahead: aheadItems
        }
    }

    enum ListKey { case up, down, toggle, edit, delete, moveUp, moveDown, clear, upFromInput, downFromInput
        /// 1.38: ⌥→ · ⌥← · ⌥↓ on the selected row, F to focus on it.
        case later, earlier, someday, focus
    }

    /// ↑↓ select, Space completes, Return edits, ⌫ deletes, ⌘↑↓ moves, Esc clears. Returns
    /// whether the key was used. `fromEmptyInput`: ↑ pressed in an empty input line.
    @discardableResult
    func handleListKey(_ key: ListKey) -> Bool {
        // 집중: the card takes Esc (it asks first); the list's keys rest meanwhile.
        if timerState.isFocusing {
            guard !showsGuide else { return false }
            switch key {
            case .clear: petCommand(.focusStep(.askToStop))
            // Space pauses or resumes (1.38).
            case .toggle: petCommand(.focusStep(.togglePause))
            default: return false
            }
            return true
        }
        if focusPicking && key == .clear {
            focusPicking = false
            return true
        }
        // Picking: Return (or Space) on the selected row focuses on it (a done row stays as it is).
        if focusPicking, key == .edit || key == .toggle {
            if let id = selectedTaskID, keyboardRows.contains(where: { $0.id == id && !$0.isCompleted }) { focus(on: id) }
            return true
        }
        let rows = keyboardRows
        guard !showsGuide, !rows.isEmpty || key == .clear else { return false }
        let index = selectedTaskID.flatMap { id in rows.firstIndex { $0.id == id } }
        switch key {
        case .upFromInput:
            // The input line is below the rows on every sheet.
            selectedTaskID = rows.last?.id
        case .downFromInput:
            return false
        case .up:
            selectedTaskID = rows[max(0, (index ?? rows.count) - 1)].id
        case .down:
            guard let index else { selectedTaskID = rows.first?.id; return true }
            if index + 1 < rows.count { selectedTaskID = rows[index + 1].id } else {
                // Past the last row: back to the input line.
                selectedTaskID = nil
                focusNewTask()
            }
        case .toggle:
            guard let id = selectedTaskID, index != nil else { return false }
            toggle(id)
        case .edit:
            guard let id = selectedTaskID, index != nil else { return false }
            editRequestID = id
        case .delete:
            guard let id = selectedTaskID, let index else { return false }
            let next = rows.indices.contains(index + 1) ? rows[index + 1].id : index > 0 ? rows[index - 1].id : nil
            deleteWithToast(id)
            selectedTaskID = next
        case .later, .earlier, .someday:
            guard let id = selectedTaskID, let index, !rows[index].isCompleted else { return false }
            switch key {
            case .later: shiftDue(id, by: 1)
            case .earlier: shiftDue(id, by: -1)
            default: move(id, to: .someday)
            }
            // Still picked where it went (on 오늘 a moved row leaves the sheet: the next one is picked).
            if !keyboardRows.contains(where: { $0.id == id }) {
                let left = keyboardRows
                selectedTaskID = left.indices.contains(index) ? left[index].id : left.last?.id
            }
        case .focus:
            guard let id = selectedTaskID, let index, !rows[index].isCompleted else { return false }
            focus(on: id)
        case .moveUp, .moveDown:
            guard page == .todos, let id = selectedTaskID, index != nil else { return false }
            move(id, by: key == .moveUp ? -1 : 1)
        case .clear:
            guard selectedTaskID != nil else { return false }
            selectedTaskID = nil
        }
        return true
    }
    func rename(_ id: UUID, to title: String) { mutate { $0.edit(id: id, title: title) } }
    func toggle(_ id: UUID) {
        finishingTasks.removeValue(forKey: id)?.cancel()
        finishingIDs.remove(id)
        // A task being checked off stays a moment (its pop and pencil line) where it would go:
        // with 완료 숨기기, and on 앞으로 and the 오늘 창, which list open tasks only.
        let finishing = items.first(where: { $0.id == id })?.isCompleted == false
        if finishing { finishingIDs.insert(id) }
        mutate { $0.toggle(id: id) }
        if finishing {
            finishingTasks[id] = Task { @MainActor [weak self] in
                try? await Task.sleep(for: .milliseconds(650))
                guard !Task.isCancelled else { return }
                self?.finishingIDs.remove(id)
                self?.finishingTasks[id] = nil
            }
        }
    }
    func delete(_ id: UUID) { mutate { $0.delete(id: id) } }
    /// "완료한 일 정리": today's finished tasks go to the record now (set by `ArchiveStore`; returns the ones filed).
    var fileCompleted: (([TodoItem]) -> [TodoItem])?
    /// Takes entries out of the record again (완료한 일 정리's 되돌리기).
    var unfileCompleted: ((Set<String>) -> Void)?
    func clearCompleted() {
        commitEditing()
        let done = todayItems.filter(\.isCompleted)
        let order = items.map(\.id)
        let filed: [TodoItem]
        if let fileCompleted { filed = fileCompleted(done) } else { archiveCompleted(Set(done.map(\.id))); filed = done }
        guard !filed.isEmpty else { return }
        // 1.38: `3개를 기록으로 옮겼어요 · 되돌리기` — the entries leave the record and the tasks come back.
        var toast = PaperToast(symbol: "leaf", text: L("\(filed.count)개를 기록으로 옮겼어요"))
        toast.action = L("되돌리기")
        toast.perform = { [weak self] in
            guard let self else { return }
            self.unfileCompleted?(Set(filed.map(\.id.uuidString)))
            self.restoreTasks(filed, order: order)
            self.toast = nil
        }
        self.toast = toast
    }
    func undo() { mutate { $0.undo() } }
    func redo() { mutate { $0.redo() } }

    func move(_ id: UUID, by delta: Int) {
        let visible = visibleItems
        guard let index = visible.firstIndex(where: { $0.id == id }) else { return }
        let destination = index + delta
        guard visible.indices.contains(destination),
              let targetIndex = items.firstIndex(where: { $0.id == visible[destination].id }) else { return }
        mutate { $0.move(id: id, to: delta > 0 ? targetIndex + 1 : targetIndex) }
    }

    func move(_ id: UUID, before target: UUID) {
        move(id, relativeTo: target, after: false)
    }

    func move(_ id: UUID, relativeTo target: UUID, after: Bool) {
        guard let targetIndex = items.firstIndex(where: { $0.id == target }), id != target else { return }
        mutate { $0.move(id: id, to: targetIndex + (after ? 1 : 0)) }
    }

    func focusNewTask() { focusRequest += 1 }

    func commitEditing() {
        saveMemosNow()
        editingTaskReminderID = nil
        NotificationCenter.default.post(name: .paperCommitEditing, object: nil)
        window?.makeFirstResponder(nil)
    }

    func copyTasks() {
        commitEditing()
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(plainText, forType: .string)
    }

    func exportTasks() {
        commitEditing()
        let panel = NSSavePanel()
        panel.title = L("할 일 내보내기")
        panel.nameFieldStringValue = "\(PaperTheme.mascotName) - \(Date().formatted(.iso8601.year().month().day().dateSeparator(.dash))).txt"
        panel.allowedContentTypes = [.plainText]
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try plainText.write(to: url, atomically: true, encoding: .utf8)
        } catch {
            showStorageError(L("파일을 내보내지 못했어요.") + "\n\(error.localizedDescription)")
        }
    }

    func showShortcuts() {
        SlipAlert.run(symbol: "keyboard", title: L("종이냥 단축키"), message: L("⌘N     입력 줄로 가기\n⌘1 · ⌘2     오늘 · 앞으로\n⌘3     메모 서랍\n⌘F     검색\n⌘M     포스트잇으로 접기\n⌘D     책상\nReturn     넣기 · 고치기 끝\nEsc     고치기 취소\n⌘Z     되돌리기\n⇧⌘Z     다시 하기\n⇧⌘C     목록 복사\n⌘E     텍스트로 내보내기\n⌥→ · ⌥←     고른 할 일 하루 뒤로 · 앞으로\n⌥↓     고른 할 일 언젠가로\nF     고른 할 일에 집중\n⌃⌥N     빠른 입력 (어디서든)\n⌃⌥M     빠른 메모 (어디서든)\n⌃⌥J     노트 보이기 · 숨기기 (어디서든)\n\n집중하는 동안: Space 일시정지 · ⌘↩ 다 했어요 · ⌘= 5분 더 · Esc 그만두기\n할 일을 누르면 바로 고칠 수 있어요. 줄 왼쪽 손잡이를 끌거나 우클릭 메뉴로 순서를 바꿔요.\n목록은 이 Mac에 저절로 저장돼요."),
                      choices: [.init(title: L("확인"), role: .primary, isDefault: true, isCancel: true)], cat: nil, width: .medium)
    }

    func showStorageError(_ message: String) {
        let answer = SlipAlert.run(symbol: "externaldrive.badge.exclamationmark", title: L("저장 상태 확인"), message: message,
                                   choices: [.init(title: L("저장 폴더 열기")), .init(title: L("확인"), role: .primary, isDefault: true, isCancel: true)],
                                   cat: nil, width: .medium)
        if answer == 0 {
            NSWorkspace.shared.open(file.url.deletingLastPathComponent())
        }
    }

    func retrySave() {
        guard canSave, !savingStopped else { return }
        let started = PerfProbe.now
        defer { PerfProbe.io("todos", since: started) }
        do {
            try file.save(history.notebook)
            ai?.noteSave(history.notebook)
            hasUnsavedChanges = false
            storageError = nil
        } catch {
            storageError = L("목록을 저장하지 못했어요. 앱을 닫기 전에 텍스트로 내보내 주세요.") + "\n\(file.url.path)"
        }
    }

    private var plainText: String {
        let line = { (item: TodoItem) in "\(item.isCompleted ? "[x]" : "[ ]") \(item.title)" + TimeBlock.exportText(item, language: .current) }
        let now = Date()
        var text = todayItems.map(line).joined(separator: "\n") + "\n"
        // 앞으로: dated tasks by date, then 언젠가 in the list's order.
        let ahead = items.enumerated().filter { Shelf.page(of: $0.element, now: now) != .today }
        let dated = ahead.filter { $0.element.dueDate != nil }.sorted { ($0.element.dueDate!, $0.offset) < ($1.element.dueDate!, $1.offset) }.map(\.element)
        let someday = ahead.filter { $0.element.dueDate == nil }.map(\.element)
        for (heading, shelved) in [(L("앞으로"), dated), (Ahead.Kind.someday.title(.current), someday)] where !shelved.isEmpty {
            text += "\n[\(heading)]\n" + shelved.map { item in
                line(item) + (item.dueDate.map { " (~\($0))" } ?? "")
            }.joined(separator: "\n") + "\n"
        }
        return text
    }

    /// 어제부터: stamps without an undo step (bookkeeping), saved when anything changed.
    func stampToday(now: Date = Date()) {
        let before = history.notebook
        history.stampToday(now: now)
        guard history.notebook != before else { return }
        hasUnsavedChanges = true
        retrySave()
    }

    func mutate<T>(_ action: (inout UndoableNotebook) -> T) {
        AIWriteLock.with { mutateHeld(action) }
    }

    private func mutateHeld<T>(_ action: (inout UndoableNotebook) -> T) {
        catchUpWithDisk()
        let before = history.notebook
        _ = action(&history)
        if !aiMarks.ids.isEmpty { clearAIMarks(from: before, to: history.notebook) }
        history.stampToday(now: Date())
        guard history.notebook != before else { return }
        hasUnsavedChanges = true
        retrySave()
    }
}

enum PetCommand: Equatable {
    case countdown(minutes: Int)
    /// 직접 정하기…: asks for the length first.
    case chooseLength
    case pomodoro
    case togglePause
    case addMinutes(Int)
    case stop
    /// 이거 집중: the note becomes the focus card for this to-do.
    case focus(task: UUID, minutes: Int)
    /// 이거 집중 → 뽀모도로로.
    case focusPomodoro(task: UUID)
    /// 이거 집중 → 직접 정하기….
    case focusChooseLength(task: UUID)
    /// 할 일 골라 집중…: the note's pick state.
    case pickFocus
    /// The focus card's buttons (다 했어요 · 5분 더 · 다음에 …).
    case focusStep(FocusStep)
}
