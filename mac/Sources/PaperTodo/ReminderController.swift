import AppKit
import Combine
import PaperCore
import ServiceManagement
import SwiftUI

@MainActor
final class ReminderController: ObservableObject {
    @Published var enabled: Bool {
        didSet {
            preferences.set(enabled, forKey: "reminder.enabled")
            configure()
            if !enabled { popup.dismiss() }
        }
    }
    @Published var intervalMinutes: Int {
        didSet {
            let clamped = min(240, max(1, intervalMinutes))
            if intervalMinutes != clamped {
                intervalMinutes = clamped
                return
            }
            preferences.set(intervalMinutes, forKey: "reminder.intervalMinutes")
            configure()
        }
    }
    @Published var displaySeconds: Int {
        didSet { preferences.set(displaySeconds, forKey: "reminder.displaySeconds") }
    }
    @Published private(set) var nextDue: Date?
    @Published private(set) var hasTasks: Bool
    var isOtherReminderVisible: (() -> Bool)?
    var isPopupVisible: Bool { popup.isVisible }

    private let model: AppModel
    private let preferences: UserDefaults
    private let onOpen: () -> Void
    private let snapshotURL: URL?
    private var schedule: ReminderSchedule
    private var timer: Timer?
    private var subscriptions = Set<AnyCancellable>()
    private var sleeping = false
    private var showingPreview = false
    private lazy var popup = ReminderPopupController(
        onOpen: { [weak self] in self?.onOpen() },
        onSnooze: { [weak self] choice in self?.snoozeFromPopup(choice) },
        onComplete: { [weak self] id in self?.completeFromPopup(id) }
    )

    init(model: AppModel, preferences: UserDefaults, snapshotURL: URL? = nil, onOpen: @escaping () -> Void) {
        self.model = model
        self.preferences = preferences
        self.onOpen = onOpen
        self.snapshotURL = snapshotURL
        let initialEnabled = preferences.object(forKey: "reminder.enabled") == nil ? true : preferences.bool(forKey: "reminder.enabled")
        enabled = initialEnabled
        let savedInterval = preferences.integer(forKey: "reminder.intervalMinutes")
        let initialInterval = savedInterval == 0 ? 30 : min(240, max(1, savedInterval))
        intervalMinutes = initialInterval
        let savedDuration = preferences.integer(forKey: "reminder.displaySeconds")
        displaySeconds = [10, 15, 25].contains(savedDuration) ? savedDuration : 15
        hasTasks = model.remainingCount > 0
        schedule = ReminderSchedule(enabled: initialEnabled, intervalMinutes: initialInterval, now: .now)
        armTimer()

        model.objectWillChange.sink { [weak self] _ in
            // Published model mutations are delivered before their new values are installed.
            DispatchQueue.main.async { self?.modelChanged() }
        }.store(in: &subscriptions)

        let center = NSWorkspace.shared.notificationCenter
        for name in [NSWorkspace.willSleepNotification, NSWorkspace.screensDidSleepNotification, NSWorkspace.sessionDidResignActiveNotification] {
            center.publisher(for: name).receive(on: RunLoop.main).sink { [weak self] _ in
                self?.suspend()
            }.store(in: &subscriptions)
        }
        for name in [NSWorkspace.didWakeNotification, NSWorkspace.screensDidWakeNotification, NSWorkspace.sessionDidBecomeActiveNotification] {
            center.publisher(for: name).receive(on: RunLoop.main).sink { [weak self] _ in
                self?.resume()
            }.store(in: &subscriptions)
        }
    }

    func preview() {
        showPopup(preview: true)
    }

    func dismiss() { popup.dismiss() }

    func snooze(minutes: Int) {
        popup.dismiss()
        schedule.snooze(until: Date().addingTimeInterval(TimeInterval(minutes * 60)))
        armTimer()
    }

    private func configure() {
        schedule.configure(enabled: enabled, intervalMinutes: intervalMinutes, now: .now)
        armTimer()
    }

    private func modelChanged() {
        let available = model.remainingCount > 0
        if available != hasTasks {
            hasTasks = available
            schedule.resetAfterWake(now: .now)
            armTimer()
        }
        popup.retainTasks(openIDs: Set(model.items.filter { !$0.isCompleted }.map(\.id)))
    }

    private func armTimer() {
        timer?.invalidate()
        nextDue = schedule.nextDue
        guard !sleeping, let due = schedule.nextDue else { return }
        let timer = Timer(timeInterval: max(1, due.timeIntervalSinceNow), repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in self?.tick() }
        }
        timer.tolerance = 1
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func tick() {
        guard !sleeping else { return }
        let busy = (NSApp.isActive && NSApp.keyWindow != nil) || NSApp.modalWindow != nil || popup.isVisible || isOtherReminderVisible?() == true
        if schedule.consumeIfDue(now: .now, hasTasks: model.remainingCount > 0, isBusy: busy) {
            showPopup(preview: false)
        }
        armTimer()
    }

    private func showPopup(preview: Bool) {
        let unfinished = model.todayItems.filter { !$0.isCompleted }
        guard preview || !unfinished.isEmpty else { return }
        showingPreview = preview
        let tasks = unfinished.isEmpty ? [ReminderPopupTask(title: L("예: 책 10쪽 읽기"))] : unfinished.map(ReminderPopupTask.init)
        popup.show(
            image: model.mascotImage,
            tasks: tasks,
            duration: TimeInterval(displaySeconds),
            screen: NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main,
            snoozeEnabled: enabled,
            notebookFont: model.notebookFont,
            style: model.reminderStyle,
            preview: preview
        )
        if let snapshotURL {
            let capturedStyle = model.reminderStyle
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.8) { [weak self] in
                guard let self, self.model.reminderStyle == capturedStyle else { return }
                self.popup.captureSnapshot(at: snapshotURL)
                let variant = snapshotURL.deletingPathExtension().appendingPathExtension(capturedStyle.rawValue + ".png")
                self.popup.captureSnapshot(at: variant)
            }
        }
    }

    private func completeFromPopup(_ id: UUID) {
        guard !showingPreview else { return }
        model.completeTask(id)
    }

    /// The periodic nudge rests until the chosen time (it has no 내일로 미루기).
    private func snoozeFromPopup(_ choice: Snooze) {
        guard !showingPreview, let until = choice.date(now: Date()) else { return }
        popup.dismiss()
        schedule.snooze(until: until)
        armTimer()
    }

    private func suspend() {
        sleeping = true
        timer?.invalidate()
        popup.dismiss()
    }

    private func resume() {
        sleeping = false
        schedule.resetAfterWake(now: .now)
        armTimer()
    }
}

/// One settings pane of the desk (책상): 꾸미기 · 알림 · 반복 · 종이냥 · 일정 · 저장과 백업, and 시계
/// (alarms and the timer). The pane's header is drawn here too, so it scrolls with the groups.
struct SettingsPaneView: View {
    private static let intervalPresets = [10, 15, 20, 30, 45, 60, 90, 120, 180, 240]

    @ObservedObject var controller: ReminderController
    @ObservedObject var model: AppModel
    let pane: DeskPane

    /// Snapshots: an alarm already open for editing.
    private let alarmEditing: String?

    internal init(controller: ReminderController, model: AppModel, pane: DeskPane, alarmEditing: String? = nil) {
        self.controller = controller
        self.model = model
        self.pane = pane
        self.alarmEditing = alarmEditing
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    if pane == .drawer {
                        // 서랍 열기 in the header, not in a row that is about something else (#27).
                        DeskPaneHeader(title: pane.title, subtitle: pane.subtitle) { OpenDrawerButton(model: model) }
                    } else {
                        DeskPaneHeader(title: pane.title, subtitle: pane.subtitle, cat: pane == .appearance ? .groom : nil)
                    }
                    content
                }
                .frame(maxWidth: DeskMetrics.column, alignment: .leading)
                .padding(.horizontal, DeskMetrics.gutter)
                .padding(.top, DeskMetrics.top)
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity, alignment: .leading)
                .environment(\.settingsTint, pane.tint)
            }
            .scrollIndicators(.automatic)
            .scrollEdgeFade()
            if pane == .notifications {
                settingsActions
            }
        }
        .foregroundStyle(PaperTheme.ink)
        .onChange(of: model.reminderStyle) { if pane == .notifications { controller.preview() } }
    }

    @ViewBuilder
    private var content: some View {
        switch pane {
        case .appearance: appearancePanel
        case .notifications: notificationPanel
        case .repeating: RepeatSettingsPanel(model: model)
        case .pet: PetSettingsPanel(model: model, part: .pet)
        case .clock:
            AlarmSettingsGroup(book: model.alarms, notebookFont: model.notebookFont, editing: alarmEditing)
            PetSettingsPanel(model: model, part: .timer)
        case .events: CalendarSettingsPanel(calendar: model.calendar)
        case .storage:
            StorageSettingsGroup(model: model)
            CompletedSettingsGroup(model: model)
            BackupSettingsGroup(model: model)
        case .drawer: MemoDrawerSettingsGroup(drawer: model.drawer)
        case .spaces: SpacesSettingsPanel(model: model)
        case .ai:
            if let ai = model.ai { AISettingsPanel(ai: ai) }
        case .calendar, .history, .help: EmptyView()
        }
    }

    // MARK: Appearance

    private var appearancePanel: some View {
        Group {
            LanguageSettingsGroup(model: model)
            PaperColorGroup(model: model)

            // The sample sheet, named like every other group (#21).
            VStack(alignment: .leading, spacing: 7) {
                Text(L("미리보기"))
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PaperTheme.ink2)
                    .padding(.leading, 4)
                    .accessibilityAddTraits(.isHeader)
                livePreview
            }

            SettingsGroup(title: L("글꼴")) {
                ForEach(Array(NotebookFont.allCases.enumerated()), id: \.element) { index, font in
                    if index > 0 { SettingsSeparator() }
                    Button { model.notebookFont = font } label: {
                        HStack(spacing: 10) {
                            Image(systemName: model.notebookFont == font ? "checkmark.circle.fill" : "circle")
                                .font(.system(size: 14))
                                .foregroundStyle(model.notebookFont == font ? PaperTheme.sage : PaperTheme.faded)
                            Text(font.title).font(.system(size: 13, weight: .medium))
                                .lineLimit(1)
                            Spacer(minLength: 8)
                            Text(font.preview.handwritten)
                                .font(font.bodyFont())
                                .foregroundStyle(model.notebookFont == font ? PaperTheme.ink : PaperTheme.secondary)
                                .lineLimit(1)
                        }
                        .settingsRow()
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(model.notebookFont == font ? .isSelected : [])
                }
            }

            SettingsGroup(title: L("글자 크기"), footer: L("⌘ = 와 ⌘ − 로도 바꿀 수 있어요.")) {
                HStack(spacing: 12) {
                    Text("가").font(.system(size: 11)).foregroundStyle(PaperTheme.secondary)
                    PaperSegmented(selection: $model.textSize,
                                   options: NotebookTextSize.allCases.map { ($0, $0.title, nil) },
                                   label: L("글자 크기"))
                    Text("가").font(.system(size: 17)).foregroundStyle(PaperTheme.secondary)
                }
                .settingsRow()
            }

            SettingsGroup(title: L("마감 표시"), footer: L("할 일의 알림 → 마감에서 오늘까지·이번 주 안·이번 달 안·날짜를 정해요. 지난 마감은 붉게 표시돼요.")) {
                HStack(spacing: 12) {
                    SettingsLabel(L("마감을 이렇게 보여 주기"), systemImage: "flag")
                    Spacer(minLength: 8)
                    // Examples of each style: "D-3" / "~금", "3 days left" / "by Fri".
                    PaperSegmented(selection: $model.dueStyle, options: [(.dday, L("D-3"), nil), (.date, L("~금"), nil)], label: L("마감 표시 방식"))
                        .frame(width: AppLanguage.current == .ko ? 150 : 210)
                }
                .settingsRow()
            }

            // #30: 시작 (로그인 시 실행) with the other "outside the note" groups, as on Windows (시작 · 빠른 입력).
            LoginItemGroup()

            SettingsGroup(title: L("메뉴 막대"), more: "window", footer: L("자동이면 타이머의 남은 시간이나 1시간 안의 일정이 ‘치과 40분’처럼 얼굴 옆에 나와요. 누르면 오늘 창이 열려요.")) {
                HStack(spacing: 12) {
                    SettingsLabel(L("메뉴 막대에 글자"), systemImage: "menubar.rectangle")
                    Spacer(minLength: 8)
                    PaperSegmented(selection: $model.menuBarText, options: [(.auto, L("자동"), nil), (.hide, L("숨기기"), nil)], label: L("메뉴 막대에 글자"))
                        .frame(width: AppLanguage.current == .ko ? 150 : 210)
                }
                .settingsRow()
                SettingsSeparator()
                HStack {
                    SettingsLabel(L("Dock에 남은 개수"), systemImage: "app.badge")
                    Spacer()
                    Toggle(L("Dock에 남은 개수"), isOn: $model.dockBadge).toggleStyle(PaperToggleStyle()).labelsHidden()
                }
                .settingsRow()
            }

            SettingsGroup(title: L("빠른 입력"), more: "quick", footer: [
                model.quickEntryRegistered
                    ? L("다른 앱을 쓰다가도 ⌃⌥N을 누르면 작은 입력 칸이 떠요. 적은 말에 맞춰 알림 · 마감 · 일정을 정해요.")
                    : L("다른 앱이 ⌃⌥N을 쓰고 있어요. 그 앱의 단축키를 바꾼 뒤 다시 켜 주세요."),
                model.quickMemoRegistered
                    ? L("빠른 메모는 메모 서랍에서 마지막으로 본 폴더 맨 위에 들어가요.")
                    : L("다른 앱이 ⌃⌥M을 쓰고 있어요. 그 앱의 단축키를 바꾼 뒤 다시 켜 주세요."),
                model.noteHotKeyRegistered
                    ? ""
                    : L("다른 앱이 ⌃⌥J를 쓰고 있어요. 그 앱의 단축키를 바꾼 뒤 다시 켜 주세요."),
                model.quickMemoClipboard ? L("빈 메모를 열면 방금 복사한 글이 골라진 채로 들어가요.") : "",
            ].filter { !$0.isEmpty }.joined(separator: " ")) {
                HStack {
                    SettingsLabel(L("어디서든 빠른 입력 (⌃⌥N)"), systemImage: "keyboard")
                    Spacer()
                    Toggle("어디서든 빠른 입력", isOn: $model.quickEntryEnabled).toggleStyle(PaperToggleStyle()).labelsHidden()
                }
                .settingsRow()
                SettingsSeparator()
                HStack {
                    SettingsLabel(L("어디서든 빠른 메모 (⌃⌥M)"), systemImage: "note.text")
                    Spacer()
                    Toggle("어디서든 빠른 메모", isOn: $model.quickMemoEnabled).toggleStyle(PaperToggleStyle()).labelsHidden()
                }
                .settingsRow()
                SettingsSeparator()
                HStack {
                    SettingsLabel(L("어디서든 노트 보이기 · 숨기기 (⌃⌥J)"), systemImage: "macwindow")
                    Spacer()
                    Toggle(L("어디서든 노트 보이기 · 숨기기"), isOn: $model.noteHotKeyEnabled).toggleStyle(PaperToggleStyle()).labelsHidden()
                }
                .settingsRow()
                SettingsSeparator()
                HStack {
                    SettingsLabel(L("빠른 메모를 열 때 복사한 글 넣기"), systemImage: "doc.on.clipboard")
                    Spacer()
                    Toggle(L("빠른 메모를 열 때 복사한 글 넣기"), isOn: $model.quickMemoClipboard).toggleStyle(PaperToggleStyle()).labelsHidden()
                }
                .settingsRow()
            }
        }
    }

    /// A small ruled sheet that redraws with the chosen font and size.
    private var livePreview: some View {
        let samples: [(String, Bool)] = {
            let titles = model.items.prefix(2).map { ($0.title, $0.isCompleted) }
            return titles.count == 2 ? titles : [(L("창문 열고, 커피 한 잔"), true), (L("미뤄 둔 책 10쪽 읽기"), false)]
        }()
        return VStack(spacing: 0) {
            ForEach(Array(samples.enumerated()), id: \.offset) { index, sample in
                HStack(spacing: 12) {
                    RoundedRectangle(cornerRadius: 3)
                        .fill(sample.1 ? PaperTheme.sage.opacity(0.88) : .clear)
                        .overlay {
                            RoundedRectangle(cornerRadius: 3)
                                .strokeBorder(sample.1 ? .clear : PaperTheme.secondary.opacity(0.6), lineWidth: 1)
                        }
                        .overlay {
                            if sample.1 {
                                Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundStyle(PaperTheme.onSage)
                            }
                        }
                        .frame(width: 16, height: 16)
                    Text(sample.0.handwritten)
                        .font(model.notebookFont.bodyFont(model.textSize))
                        .foregroundStyle(sample.1 ? PaperTheme.faded : PaperTheme.ink)
                        .strikethrough(sample.1, color: PaperTheme.ink.opacity(0.5))
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
                .frame(height: PaperTheme.rowHeight)
                .overlay(alignment: .bottom) {
                    if index < samples.count - 1 {
                        Rectangle().fill(PaperTheme.rule).frame(height: 0.7).padding(.leading, 44)
                    }
                }
            }
        }
        .padding(.vertical, 2)
        .background(PaperTheme.paper, in: RoundedRectangle(cornerRadius: 12))
        .overlay { RoundedRectangle(cornerRadius: 12).stroke(PaperTheme.rule, lineWidth: 0.8) }
        .shadow(color: .black.opacity(0.05), radius: 6, y: 2)
        .animation(.easeOut(duration: 0.15), value: model.textSize)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("글씨 미리보기")
    }

    // MARK: Notifications

    private var notificationPanel: some View {
        Group {
            // 할 일별 알림 was a card of words only, like a row one could press (#21): now this group's footnote.
            SettingsGroup(title: L("알림 모양"), footer: L("할 일마다 알림은 할 일 줄의 알림 버튼에서 정해요. 같은 때 울릴 알림은 한 번에 모아 보여 줘요.")) {
                HStack(spacing: 10) {
                    ForEach(ReminderPresentationStyle.allCases) { style in
                        Button { model.reminderStyle = style } label: {
                            ReminderStyleTile(style: style, selected: model.reminderStyle == style, mascot: model.mascotImage)
                        }
                        .buttonStyle(.plain)
                        .help(style.detail)
                        .accessibilityLabel("\(style.title), \(style.detail)")
                        .accessibilityAddTraits(model.reminderStyle == style ? .isSelected : [])
                    }
                }
                .padding(12)
            }

            SettingsGroup(title: L("주기 알림"), footer: statusText) {
                HStack(spacing: 12) {
                    SettingsTile(systemImage: "bell.badge")
                    VStack(alignment: .leading, spacing: 2) {
                        Text("남은 할 일 알려주기").font(.system(size: 13, weight: .medium))
                        Text("할 일이 남아 있을 때만 종이냥이 한 번에 모아서 알려 줘요.")
                            .font(.system(size: 11))
                            .foregroundStyle(PaperTheme.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Toggle("남은 할 일 알려주기", isOn: $controller.enabled)
                        .toggleStyle(PaperToggleStyle())
                        .labelsHidden()
                }
                .padding(.vertical, 8)
                .settingsRow()

                SettingsSeparator()
                HStack {
                    SettingsLabel(L("간격"), systemImage: "timer")
                    Spacer()
                    PaperMenuPicker(selection: $controller.intervalMinutes,
                                    options: intervalChoices.map { ($0, Self.intervalTitle($0)) }, label: L("간격"))
                }
                .settingsRow()
                // Resting while 주기 알림 is off: faded as a whole, but not system-disabled (that dimmed
                // the words to 1.3–1.6:1 at night).
                .allowsHitTesting(controller.enabled)
                .opacity(controller.enabled ? 1 : 0.55)
                .accessibilityHidden(!controller.enabled)

                SettingsSeparator()
                HStack {
                    SettingsLabel(L("화면에 머무는 시간"), systemImage: "hourglass")
                    Spacer()
                    PaperSegmented(selection: $controller.displaySeconds,
                                   options: [10, 15, 25].map { ($0, L("\($0)초"), nil) },
                                   label: L("표시 시간"))
                    .frame(width: 160)
                }
                .settingsRow()
                // Resting while 주기 알림 is off: faded as a whole, but not system-disabled (that dimmed
                // the words to 1.3–1.6:1 at night).
                .allowsHitTesting(controller.enabled)
                .opacity(controller.enabled ? 1 : 0.55)
                .accessibilityHidden(!controller.enabled)
            }

            // 1.38: 하루 정리 — 저녁 정리 and 오늘 꼭 하나.
            SettingsGroup(title: L("하루 정리"), footer: L("저녁 정리는 하루 한 번 와요. 그날 저녁을 놓치면 다음 날 처음 노트를 열 때 물어봐요.")) {
                switchRow(L("저녁 정리"), detail: L("남은 할 일을 내일이나 언젠가로 넘길지 물어봐요."), symbol: "moon", isOn: $model.sweepEnabled)
                SettingsSeparator()
                HStack {
                    SettingsLabel(L("저녁 정리 시각"), systemImage: "clock")
                    Spacer()
                    PaperMenuPicker(selection: $model.sweepTime,
                                    options: Sweep.times.map { ($0, AppLanguage.current.clock(hour: $0 / 60, minute: $0 % 60)) }, label: L("저녁 정리 시각"))
                }
                .settingsRow()
                .allowsHitTesting(model.sweepEnabled)
                .opacity(model.sweepEnabled ? 1 : 0.55)
                SettingsSeparator()
                switchRow(L("오늘 꼭 하나"), detail: L("새 날 처음 노트를 열면 오늘 꼭 할 하나를 물어보고, 그 일에 별을 달아 맨 위에 둬요."), symbol: "star", isOn: $model.dailyPickEnabled)
            }

            SettingsGroup(title: L("시스템 알림"), more: "alerts", footer: L("놓친 것만: 화면이 잠겼거나, 고양이와 노트가 숨어 있거나, 다른 앱이 전체 화면일 때만 macOS 알림으로도 보내요.")) {
                // The name and, on the right, its choices — the row every other setting has (#21).
                HStack(spacing: 12) {
                    SettingsLabel(L("시스템 알림으로도 보내기"), systemImage: "bell.badge")
                    Spacer(minLength: 8)
                    PaperSegmented(selection: $model.systemNotices,
                                   options: [(.missed, L("놓친 것만"), nil), (.always, L("항상"), nil), (.off, String(localized: "끄기", table: "Settings"), nil)],
                                   label: L("시스템 알림으로도 보내기"))
                        .frame(width: AppLanguage.current == .ko ? 220 : AppLanguage.current == .en ? 260 : 300)
                }
                .settingsRow()
            }

        }
    }


    /// A switch with a line under its name (하루 정리).
    private func switchRow(_ title: String, detail: String, symbol: String, isOn: Binding<Bool>) -> some View {
        HStack(spacing: 12) {
            SettingsTile(systemImage: symbol)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.system(size: 13, weight: .medium))
                Text(detail)
                    .font(.system(size: 11))
                    .foregroundStyle(PaperTheme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Toggle(title, isOn: isOn).toggleStyle(PaperToggleStyle()).labelsHidden()
        }
        .padding(.vertical, 8)
        .settingsRow()
    }

    private var intervalChoices: [Int] {
        Self.intervalPresets.contains(controller.intervalMinutes)
            ? Self.intervalPresets
            : (Self.intervalPresets + [controller.intervalMinutes]).sorted()
    }

    private static func intervalTitle(_ minutes: Int) -> String {
        if minutes < 60 { return L("\(minutes)분마다") }
        if minutes % 60 == 0 { return L("\(minutes / 60)시간마다") }
        return L("\(minutes / 60)시간 \(minutes % 60)분마다")
    }

    private var settingsActions: some View {
        HStack(spacing: 8) {
            Button {
                controller.preview()
            } label: {
                Label("미리보기", systemImage: "play.fill")
            }
            .buttonStyle(PaperActionButtonStyle(primary: true))
            .help("지금 알림을 한 번 띄워 봐요. 목록은 바뀌지 않아요.")

            Spacer(minLength: 0)

            Button {
                controller.snooze(minutes: 60)
            } label: {
                Label("1시간 쉬기", systemImage: "moon")
            }
            .buttonStyle(PaperActionButtonStyle())
            .disabled(!controller.enabled)
        }
        .frame(maxWidth: DeskMetrics.column)
        .padding(.horizontal, DeskMetrics.gutter)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PaperTheme.paper)
        .overlay(alignment: .top) {
            Rectangle().fill(PaperTheme.rule.opacity(0.8)).frame(height: 0.7)
        }
    }

    private var statusText: String {
        if !controller.enabled {
            return L("꺼져 있어요. 켜면 노트를 쓰는 동안에는 잠시 기다렸다 알려 줘요.")
        } else if !controller.hasTasks {
            return L("남은 할 일이 생기면 알려 줘요.")
        } else if let next = controller.nextDue {
            let language = AppLanguage.current
            let time = language == .ko
                ? next.formatted(.dateTime.locale(Locale(identifier: "ko_KR")).hour().minute())
                : language.clock(hour: Calendar.current.component(.hour, from: next), minute: Calendar.current.component(.minute, from: next))
            return L("다음 알림 \(time) · 노트를 쓰는 동안은 잠시 기다려요.")
        }
        return L("알림 시간을 준비하고 있어요.")
    }
}

/// A label style chosen at run time.
private struct AnyLabelStyle: LabelStyle {
    private let make: (Configuration) -> AnyView
    init<S: LabelStyle>(_ style: S) { make = { AnyView(style.makeBody(configuration: $0)) } }
    func makeBody(configuration: Configuration) -> some View { make(configuration) }
}

/// A group of settings: a small title, then rows on one card (radius 12, 1 pt rule, card colour).
struct SettingsGroup<Content: View>: View {
    let title: String
    var footer: String?
    /// A 도움말 topic: the footnote ends in ‘자세히’, which opens it (#21) — the footnote stays one or two lines.
    var more: String?
    let content: Content
    @Environment(\.openHelpTopic) private var openHelpTopic

    init(title: String, more: String? = nil, footer: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.footer = footer
        self.more = more
        self.content = content()
    }

    /// The footnote, and ‘자세히’ after it as a link in the sage text colour.
    private func footnote(_ text: String) -> AttributedString {
        var line = AttributedString(text.keepingParticles)
        guard let more, let url = URL(string: "jongi-help:\(more)") else { return line }
        var link = AttributedString(L("자세히"))
        link.link = url
        link.foregroundColor = PaperTheme.sageText
        link.font = .system(size: 11, weight: .semibold)
        line += AttributedString(" ") + link
        return line
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PaperTheme.ink2)
                .padding(.leading, 4)
                .accessibilityAddTraits(.isHeader)
            VStack(spacing: 0) { content }
                .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(PaperTheme.rule, lineWidth: 1) }
            if let footer {
                Text(footnote(footer))
                    .font(.system(size: 11))
                    .foregroundStyle(PaperTheme.ink2)
                    .tint(PaperTheme.sageText)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 4)
                    .environment(\.openURL, OpenURLAction { url in
                        guard url.scheme == "jongi-help" else { return .systemAction }
                        openHelpTopic(url.absoluteString.replacingOccurrences(of: "jongi-help:", with: ""))
                        return .handled
                    })
            }
        }
    }
}

struct SettingsSeparator: View {
    var body: some View {
        Rectangle().fill(PaperTheme.rule).frame(height: 1).padding(.leading, 52)
    }
}

extension View {
    func settingsRow() -> some View {
        padding(.horizontal, 14)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
    }
}

/// A miniature of each reminder layout, so the choice is visual rather than a word.
private struct ReminderStyleTile: View {
    let style: ReminderPresentationStyle
    let selected: Bool
    let mascot: NSImage

    var body: some View {
        VStack(spacing: 7) {
            ZStack(alignment: .bottomLeading) {
                RoundedRectangle(cornerRadius: 8).fill(PaperTheme.sage.opacity(0.06))
                HStack(alignment: .bottom, spacing: 3) {
                    if style != .compact {
                        Image(nsImage: mascot).resizable().scaledToFit()
                            .frame(width: style == .character ? 30 : 22)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(0..<2, id: \.self) { index in
                            HStack(spacing: 3) {
                                Circle().stroke(PaperTheme.sage.opacity(0.7), lineWidth: 0.8).frame(width: 5, height: 5)
                                Capsule().fill(PaperTheme.ink.opacity(0.35)).frame(width: index == 0 ? 36 : 26, height: 2.5)
                            }
                        }
                        Capsule().fill(PaperTheme.sage.opacity(0.18)).frame(width: 28, height: 7)
                    }
                    .padding(6)
                    .background(PaperTheme.paper, in: RoundedRectangle(cornerRadius: 6))
                    .overlay { RoundedRectangle(cornerRadius: 6).stroke(PaperTheme.sage.opacity(0.18), lineWidth: 0.6) }
                    .shadow(color: .black.opacity(0.08), radius: 2, y: 1)
                }
                .padding(7)
            }
            .frame(height: 70)
            .overlay {
                RoundedRectangle(cornerRadius: 8)
                    .stroke(selected ? PaperTheme.sage : PaperTheme.rule, lineWidth: selected ? 2 : 0.8)
            }
            HStack(spacing: 4) {
                if selected { Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)) }
                Text(style.title).font(.system(size: 12, weight: selected ? .semibold : .regular))
            }
            .foregroundStyle(selected ? PaperTheme.sage : PaperTheme.secondary)
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
    }
}

/// Settings → 반복: every recurring task with its next day, edit/delete, and `+ 새 반복 할 일` as the card's last row (#22).
private struct RepeatSettingsPanel: View {
    @ObservedObject var model: AppModel
    @State private var editing: String?
    @State private var title = ""
    @State private var draft = RepeatDraft()
    @State private var hovered: String?
    @State private var toast: PaperToast?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            SettingsGroup(title: L("반복 할 일"), footer: L("반복하는 날마다 목록에 하나씩 나타나요. 전날 것을 못 끝냈으면 새로 쌓지 않고 오늘로 옮겨요.")) {
                if model.series.isEmpty {
                    Text("아직 반복 할 일이 없어요. 할 일의 종 버튼 → 반복에서 만들거나 아래 ‘새 반복 할 일’로 더해 보세요.")
                        .font(.system(size: 12))
                        .foregroundStyle(PaperTheme.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.vertical, 12)
                        .settingsRow()
                }
                ForEach(Array(model.series.enumerated()), id: \.element.id) { index, entry in
                    if index > 0 { SettingsSeparator() }
                    if editing == entry.id { form(for: entry) } else { row(entry) }
                }
                SettingsSeparator()
                if editing == "new" {
                    form(for: nil)
                } else {
                    DeskListAddRow(title: L("새 반복 할 일")) { begin(nil) }
                }
            }
            .deskPaneToast($toast)
        }
    }

    private func delete(_ entry: Series) {
        let restore = model.deleteSeries(entry.id)
        toast = .deleted(L("반복 할 일을 지웠어요"), into: $toast, restore: restore)
    }

    private func row(_ entry: Series) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "repeat").font(.system(size: 13, weight: .medium)).foregroundStyle(PaperTheme.sage)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title.handwritten).font(model.notebookFont.bodyFont(.small)).lineLimit(1)
                Text("\(Repeat.describe(entry.rule, remindAt: entry.remindAt, language: .current)) · \(nextLabel(entry))")
                    .font(.system(size: 11)).foregroundStyle(PaperTheme.secondary).lineLimit(1)
            }
            Spacer(minLength: 0)
            Button { begin(entry) } label: { Image(systemName: "slider.horizontal.3").font(.system(size: 12)) }
                .buttonStyle(QuietButtonStyle())
                .help("고치기")
                .accessibilityLabel("\(entry.title) 고치기")
            DeskRowTrash(shown: hovered == entry.id, label: L("\(entry.title) 반복 그만하기"), help: L("반복 그만하기 (목록의 할 일은 남아요)")) { delete(entry) }
        }
        .padding(.vertical, 8)
        .settingsRow()
        .contentShape(Rectangle())
        .onHover { hovered = $0 ? entry.id : (hovered == entry.id ? nil : hovered) }
        .deskRowMenu(edit: { begin(entry) }, delete: { delete(entry) })
    }

    private func form(for entry: Series?) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField("예: 물 마시기", text: $title)
                .textFieldStyle(.plain)
                .font(model.notebookFont.bodyFont(.small))
                .padding(.horizontal, 10)
                .frame(height: 36)
                .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 8))
                .overlay { RoundedRectangle(cornerRadius: 8).stroke(PaperTheme.rule, lineWidth: 0.8) }
                .accessibilityLabel("반복할 일")
            RepeatFieldsView(draft: $draft)
            HStack(spacing: 6) {
                Spacer()
                Button("취소") { editing = nil }
                    .buttonStyle(PaperActionButtonStyle())
                    .keyboardShortcut(.cancelAction)
                Button {
                    model.saveSeries(seriesID: entry?.id, title: title, rule: draft.rule, remindAt: draft.remindAt)
                    editing = nil
                } label: {
                    Label(entry == nil ? L("추가") : L("저장"), systemImage: "repeat").labelStyle(.titleAndIcon)
                }
                .buttonStyle(PaperActionButtonStyle(primary: true))
                .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty || !draft.isValid)
            }
        }
        .padding(12)
        .background(PaperTheme.sage.opacity(0.04))
    }

    private func begin(_ entry: Series?) {
        title = entry?.title ?? ""
        draft = RepeatDraft(series: entry)
        editing = entry?.id ?? "new"
    }

    private func nextLabel(_ entry: Series) -> String {
        guard let next = Repeat.nextOccurrence(entry.rule, from: Date()) else { return "" }
        if next == Archive.logicalDayStart(Date()) { return L("오늘") }
        let calendar = Calendar.current
        return L("다음 \(AppLanguage.current.shortDate(next, calendar: calendar))")
    }
}

/// Settings → 꾸미기 → 완료한 일: when finished tasks move to the record, and where it is kept.
struct CompletedSettingsGroup: View {
    @ObservedObject var model: AppModel

    var body: some View {
        SettingsGroup(title: L("완료한 일"), footer: model.archiveAfterDays == .never
            ? L("완료한 일이 목록에 계속 남아요. ⋯ → 완료한 일 정리로 직접 지울 수 있어요.")
            : model.archiveAfterDays == .nextDay ? L("끝낸 일은 다음 날 새벽 4시에 완료 기록으로 옮겨요.")
            : model.archiveAfterDays == .threeDays ? L("끝낸 일은 3일 뒤 새벽 4시에 완료 기록으로 옮겨요.")
            : L("끝낸 일은 7일 뒤 새벽 4시에 완료 기록으로 옮겨요.")) {
            HStack {
                SettingsLabel(L("완료한 일 기록으로 옮기기"), systemImage: "calendar")
                Spacer()
                PaperMenuPicker(selection: $model.archiveAfterDays,
                                options: ArchiveAfterDays.allCases.map { ($0, $0.title(.current)) }, label: L("보관 시점"))
            }
            .settingsRow()
            SettingsSeparator()
            Button(action: model.showHistory) {
                HStack {
                    // The desk's own 완료 기록 icon (1.45).
                    SettingsLabel(L("완료 기록 보기"), systemImage: "leaf")
                    Spacer()
                    Text("⌘ Y  ›").font(.system(size: 12)).foregroundStyle(PaperTheme.faded)
                }
                .settingsRow()
            }
            .buttonStyle(.plain)
            SettingsSeparator()
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 10) {
                    SettingsLabel(L("기록 폴더"), systemImage: "archivebox")
                    Spacer(minLength: 8)
                    Button("열기") { model.openFolder(model.archiveFolderURL) }
                        .buttonStyle(PaperActionButtonStyle())
                        .help("Finder에서 완료 기록 폴더 열기")
                }
                FolderPath(url: model.archiveFolderURL)
                    .padding(.leading, FolderPath.indent)
            }
            .padding(.vertical, 9)
            .settingsRow()
        }
    }
}

/// Settings → 꾸미기 → 저장 위치: the folder everything is kept in, and moving it to a shared one.
struct StorageSettingsGroup: View {
    @ObservedObject var model: AppModel

    var body: some View {
        SettingsGroup(title: L("저장 위치"), more: "data", footer: L("할 일 · 메모 · 일정 · 기록이 모두 이 폴더에 있어요. iCloud Drive 같은 공유 폴더를 고르면 다른 기기와 같은 목록을 써요.")) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 10) {
                    SettingsLabel(L("저장 폴더"), systemImage: "folder")
                    Spacer(minLength: 8)
                    Text(model.sharedFolder == nil ? L("이 Mac (기본)") : L("공유 폴더"))
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(PaperTheme.secondary)
                }
                FolderPath(url: model.storageFolderURL)
                    .padding(.leading, FolderPath.indent)
            }
            .padding(.vertical, 9)
            .settingsRow()
            SettingsSeparator()
            HStack(spacing: 8) {
                Button { model.openFolder(model.storageFolderURL) } label: {
                    Label("폴더 열기", systemImage: "arrow.up.forward.app").labelStyle(.titleAndIcon)
                }
                .buttonStyle(PaperActionButtonStyle())
                .help("Finder에서 저장 폴더 열기")
                Spacer()
                if model.sharedFolder != nil {
                    Button("기본으로", action: model.resetStorageFolder).buttonStyle(PaperActionButtonStyle())
                }
                Button("다른 폴더…", action: model.chooseStorageFolder).buttonStyle(PaperActionButtonStyle(primary: true))
            }
            .padding(.vertical, 8)
            .settingsRow()
        }
    }
}

/// Settings → 캘린더: the strip and the alerts for the app's own events.
struct CalendarSettingsPanel: View {
    @ObservedObject var calendar: EventBook

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            SettingsGroup(title: L("오늘 일정"), more: "calendar", footer: L("하루 띠는 제목 아래에 지금 하는 일과 다음 일을 보여 줘요. 누르면 하루 일정표가 펼쳐져요.")) {
                HStack {
                    SettingsLabel(L("하루 띠 보이기"), systemImage: "calendar")
                    Spacer()
                    Toggle("하루 띠 보이기", isOn: $calendar.showsStrip).toggleStyle(PaperToggleStyle()).labelsHidden()
                }
                .settingsRow()
                SettingsSeparator()
                HStack(spacing: 12) {
                    SettingsLabel(L("일정 알림"), systemImage: "bell")
                    Spacer(minLength: 8)
                    PaperSegmented(selection: $calendar.alertMinutes,
                                   options: EventBook.alertChoices.map { ($0, $0 == 0 ? L("끔") : L("\($0)분 전"), nil) },
                                   label: L("일정 알림"))
                        .frame(width: AppLanguage.current == .ko ? 280 : 240)
                }
                .settingsRow()
            }
        }
    }
}

/// A folder's place on disk, said as Finder's path bar says it (1.45, FolderPlace): the places it's in faint and
/// shortened from the front when long, then its own name in full and a little bolder — `~ › Library › Application
/// Support › com.noa.PaperTodo`, `iCloud Drive › 종이냥`. The full path on hover and in Copy Path.
struct FolderPath: View {
    let url: URL
    /// Lines the path up with a SettingsLabel's title (its tile and the gap after it).
    static let indent: CGFloat = 38
    /// Snapshots only: the sample's temporary folder said as a stand-in one (`from` → `to`), so no real path is drawn.
    @MainActor static var standIn: (from: String, to: String)?

    var body: some View {
        let shown = Self.standIn.map { url.path.replacingOccurrences(of: $0.from, with: $0.to) } ?? url.path
        let place = FolderPlace.of(shown, home: NSHomeDirectory())
        HStack(spacing: 0) {
            if !place.leadText.isEmpty {
                Text(place.leadText)
                    .foregroundStyle(PaperTheme.ink3)
                    .lineLimit(1)
                    .truncationMode(.head)
            }
            Text(place.name)
                .fontWeight(.semibold)
                .foregroundStyle(PaperTheme.ink2)
                .lineLimit(1)
                .truncationMode(.middle)
                .layoutPriority(1)
        }
        .font(.system(size: 11.5))
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .help(shown)
        .contextMenu {
            Button(L("경로 복사")) {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(url.path, forType: .string)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L("폴더 위치 \(place.text)"))
    }
}

/// Settings → 펫 and → 타이머: the desktop pet, and the focus timer that floats on its own.
struct PetSettingsPanel: View {
    enum Part { case pet, timer }

    @ObservedObject var model: AppModel
    let part: Part
    /// Settings → 시계 → 타이머 시작 → 직접.
    @State private var customLength = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if part == .pet { petGroup } else { timerGroups }
        }
    }

    @ViewBuilder
    private var petGroup: some View {
            SettingsGroup(title: L("종이냥 펫"), footer: L("Dock 위에 앉아 눈을 깜빡이고, 가끔 걸어 다녀요. 끌어서 옮기고, 우클릭하면 메뉴가 나와요.")) {
                toggleRow(L("펫 보이기"), systemImage: "cat", isOn: $model.petVisible)
                SettingsSeparator()
                toggleRow(L("돌아다니기"), systemImage: "figure.walk", isOn: $model.petWanders)
                    .disabled(!model.petVisible)
                    .opacity(model.petVisible ? 1 : 0.45)
            }

            SettingsGroup(title: L("종이냥 한마디"), more: "pet", footer: L("가끔 응원하거나 말을 걸어요. 집중할 때와 밤 11시–아침 7시에는 조용해요.")) {
                toggleRow(L("가끔 말 걸기"), systemImage: "bubble.left", isOn: $model.chatterEnabled)
                SettingsSeparator()
                HStack(spacing: 12) {
                    SettingsLabel(L("얼마나 자주"), systemImage: "clock")
                    Spacer(minLength: 8)
                    PaperSegmented(selection: $model.chatterFrequency,
                                   options: PetChatter.Frequency.allCases.map { ($0, $0.title(.current), nil) },
                                   label: L("말 거는 횟수"))
                        .frame(width: 186)
                }
                .settingsRow()
                .help("가끔 약 1시간 반, 보통 약 45분, 자주 약 20분마다")
                .disabled(!model.chatterEnabled)
                .opacity(model.chatterEnabled ? 1 : 0.45)
                SettingsSeparator()
                toggleRow(L("가끔 물어보기"), systemImage: "questionmark.bubble", isOn: $model.chatterQuestions)
                    .disabled(!model.chatterEnabled)
                    .opacity(model.chatterEnabled ? 1 : 0.45)
                SettingsSeparator()
                HStack {
                    SettingsLabel(L("지금 한마디 듣기"), systemImage: "quote.bubble")
                    Spacer()
                    Button("들어 보기", action: model.previewChatter)
                        .buttonStyle(PaperActionButtonStyle())
                        .disabled(!model.petVisible)
                }
                .settingsRow()
            }
    }

    @ViewBuilder
    private var timerGroups: some View {
            SettingsGroup(title: L("뽀모도로"), more: "timer", footer: L("집중과 휴식을 번갈아 해요. 시간은 −·+로 1분씩(⌥나 ⇧를 누르면 5분씩) 바꾸거나 직접 적어요.")) {
                stepperRow(L("집중"), systemImage: "target", value: $model.pomodoroSettings.focusMinutes, range: 1...180, unit: L("분"))
                SettingsSeparator()
                stepperRow(L("휴식"), systemImage: "cup.and.saucer", value: $model.pomodoroSettings.restMinutes, range: 1...60, unit: L("분"))
                SettingsSeparator()
                stepperRow(L("긴 휴식"), systemImage: "bed.double", value: $model.pomodoroSettings.longRestMinutes, range: 1...60, unit: L("분"))
                SettingsSeparator()
                stepperRow(L("긴 휴식까지"), systemImage: "repeat", value: $model.pomodoroSettings.roundsBeforeLongRest, range: 2...8, unit: L("번"))
                SettingsSeparator()
                toggleRow(L("다음 단계 자동으로 시작"), systemImage: "arrow.triangle.2.circlepath", isOn: $model.pomodoroAutoContinue)
                SettingsSeparator()
                toggleRow(L("끝날 때 소리"), systemImage: "speaker.wave.2", isOn: $model.timerSound)
            }

            SettingsGroup(title: L("타이머 크기"), footer: L("화면에 뜨는 타이머(팻말을 든 고양이)의 크기예요. 타이머를 우클릭해 ‘크기’에서도 바꿀 수 있어요.")) {
                HStack(spacing: 12) {
                    SettingsLabel(L("크기"), systemImage: "arrow.up.left.and.arrow.down.right")
                    Spacer(minLength: 8)
                    PaperSegmented(selection: $model.timerSize,
                                   options: TimerSize.allCases.map { ($0, $0.title(.current), nil) },
                                   label: L("타이머 크기"))
                        .frame(width: 264)
                }
                .settingsRow()
            }

            SettingsGroup(title: L("타이머 시작")) {
                HStack(spacing: 6) {
                    ForEach([5, 15, 25, 50], id: \.self) { minutes in
                        Button("\(minutes)분") { model.petCommand(.countdown(minutes: minutes)) }
                            .buttonStyle(PaperActionButtonStyle())
                    }
                    Spacer(minLength: 0)
                    Button { model.petCommand(.pomodoro) } label: {
                        Label("뽀모도로", systemImage: "timer").labelStyle(.titleAndIcon)
                    }
                    .buttonStyle(PaperActionButtonStyle(primary: true))
                }
                .padding(.vertical, 10)
                .settingsRow()
                SettingsSeparator()
                // 직접: any length from a minute to three hours.
                HStack(alignment: .top, spacing: 10) {
                    SettingsLabel(L("직접"), systemImage: "pencil")
                        .frame(height: 28)
                    Spacer(minLength: 8)
                    TimerLengthField(text: $customLength, onSubmit: startCustom, compact: true)
                        .frame(width: 180)
                    Button("시작", action: startCustom)
                        .buttonStyle(PaperActionButtonStyle(primary: true))
                        .frame(height: 28)
                        .disabled(TimerLength.parseDuration(customLength, language: .current) == nil)
                }
                .padding(.vertical, 10)
                .settingsRow()
            }
    }

    private func startCustom() {
        guard let minutes = TimerLength.parseDuration(customLength, language: .current) else { return }
        model.petCommand(.countdown(minutes: minutes))
        customLength = ""
    }

    private func toggleRow(_ title: String, systemImage: String, isOn: Binding<Bool>) -> some View {
        HStack {
            SettingsLabel(title, systemImage: systemImage)
            Spacer()
            Toggle(title, isOn: isOn).toggleStyle(PaperToggleStyle()).labelsHidden()
        }
        .settingsRow()
    }

    private func stepperRow(_ title: String, systemImage: String, value: Binding<Int>, range: ClosedRange<Int>, unit: String) -> some View {
        HStack {
            SettingsLabel(title, systemImage: systemImage)
            Spacer()
            PaperStepper(title: title, value: value, range: range, unit: unit)
        }
        .settingsRow()
    }
}

// MARK: - Settings look

private struct SettingsTintKey: EnvironmentKey {
    static let defaultValue = PaperTheme.sage2
}

private struct OpenHelpTopicKey: EnvironmentKey {
    static let defaultValue: @MainActor (String) -> Void = { _ in }
}

extension EnvironmentValues {
    /// ‘자세히’ under a settings group: opens 도움말 on that topic (the desk sets it).
    var openHelpTopic: @MainActor (String) -> Void {
        get { self[OpenHelpTopicKey.self] }
        set { self[OpenHelpTopicKey.self] = newValue }
    }

    /// The open pane's colour, for the icon tiles in its rows.
    var settingsTint: Color {
        get { self[SettingsTintKey.self] }
        set { self[SettingsTintKey.self] = newValue }
    }
}

/// A row's line icon on a 28 pt square tinted in the pane's colour.
struct SettingsTile: View {
    let systemImage: String
    @Environment(\.settingsTint) private var tint

    var body: some View {
        Image(systemName: systemImage)
            .font(.system(size: 12.5, weight: .medium))
            .foregroundStyle(PaperTheme.ink)
            .frame(width: 28, height: 28)
            .background(tint, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .accessibilityHidden(true)
    }
}

struct SettingsLabel: View {
    let title: String
    let systemImage: String

    init(_ title: String, systemImage: String) {
        self.title = title
        self.systemImage = systemImage
    }

    var body: some View {
        HStack(spacing: 10) {
            SettingsTile(systemImage: systemImage)
            Text(title.keepingParticles).font(.system(size: 13))
        }
    }
}

/// "− 25분 +" on paper instead of the system stepper arrows: −/+ change it by one (by five with
/// ⌥ or ⇧ held), and the number can be typed.
private struct PaperStepper: View {
    let title: String
    @Binding var value: Int
    let range: ClosedRange<Int>
    let unit: String
    @State private var typed = ""
    @FocusState private var typing: Bool

    /// Five at a time with ⌥ or ⇧ held.
    private var step: Int { NSEvent.modifierFlags.intersection([.option, .shift]).isEmpty ? 1 : 5 }

    var body: some View {
        HStack(spacing: 0) {
            button("minus", enabled: value > range.lowerBound) { set(value - step) }
                .accessibilityLabel("\(title) 줄이기")
            HStack(spacing: 0) {
                TextField(title, text: $typed)
                    .textFieldStyle(.plain)
                    .multilineTextAlignment(.trailing)
                    .font(.system(size: 13, weight: .semibold).monospacedDigit())
                    // As wide as the number, so "5분" and "180분" both sit in the middle.
                    .frame(width: CGFloat(max(1, min(3, typed.count))) * 8.5 + 3)
                    .focused($typing)
                    .onSubmit(commit)
                Text(unit)
                    .font(.system(size: 13, weight: .semibold))
                    .fixedSize()
            }
            .frame(minWidth: 52)
            .padding(.horizontal, 2)
            button("plus", enabled: value < range.upperBound) { set(value + step) }
                .accessibilityLabel("\(title) 늘리기")
        }
        .padding(2)
        .background(PaperTheme.sage.opacity(0.08), in: Capsule())
        .overlay { Pill().strokeBorder(PaperTheme.rule, lineWidth: 0.7) }
        .accessibilityElement(children: .contain)
        .accessibilityValue("\(value)\(unit)")
        .onAppear { typed = "\(value)" }
        .onChange(of: value) { _, new in typed = "\(new)" }
        .onChange(of: typing) { _, now in if !now { commit() } }
    }

    private func set(_ new: Int) {
        value = min(range.upperBound, max(range.lowerBound, new))
        typed = "\(value)"
    }

    /// A typed number, kept inside the range; anything else goes back to the value.
    private func commit() {
        if let number = Int(typed.trimmingCharacters(in: .whitespaces)) { set(number) } else { typed = "\(value)" }
    }

    private func button(_ symbol: String, enabled: Bool, action: @escaping () -> Void) -> some View {
        Button { withAnimation(.snappy(duration: 0.2)) { action() } } label: {
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(enabled ? PaperTheme.ink2 : PaperTheme.faint)
                .frame(width: 26, height: 24)
                // Card, not white: at night a white disc was the brightest thing in the pane.
                .background(PaperTheme.card.opacity(enabled ? 1 : 0.5), in: Capsule())
                .overlay { Pill().strokeBorder(PaperTheme.rule, lineWidth: enabled ? 0.7 : 0) }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }
}

/// Settings → 꾸미기 → 시작: open 종이냥 when logging in to the Mac.
private struct LoginItemGroup: View {
    @State private var on = SMAppService.mainApp.status == .enabled
    @State private var note: String?

    var body: some View {
        SettingsGroup(title: String(localized: "시작", table: "Settings"), footer: note ?? L("Mac에 로그인하면 종이냥이 바로 켜져서 알림을 놓치지 않아요.")) {
            HStack {
                SettingsLabel(L("로그인할 때 같이 열기"), systemImage: "power")
                Spacer()
                Toggle("로그인할 때 같이 열기", isOn: $on)
                    .toggleStyle(PaperToggleStyle()).labelsHidden()
            }
            .settingsRow()
        }
        .onChange(of: on) { _, value in apply(value) }
    }

    /// Adds or removes 종이냥 as a login item. macOS may ask to approve it in System Settings.
    private func apply(_ value: Bool) {
        let service = SMAppService.mainApp
        do {
            if value, service.status != .enabled { try service.register() }
            if !value, service.status == .enabled { try service.unregister() }
            note = service.status == .requiresApproval ? L("시스템 설정 → 일반 → 로그인 항목에서 종이냥을 허용해 주세요.") : nil
        } catch {
            note = L("로그인 항목을 바꾸지 못했어요. 종이냥을 응용 프로그램 폴더로 옮긴 뒤 다시 해 보세요.")
        }
    }
}

/// Settings → 꾸미기 → 언어: 자동 · 한국어 · English · Nederlands. The app restarts in the new
/// language after a confirm (see L10n.change). The language names are always in their own language.
struct LanguageSettingsGroup: View {
    let model: AppModel
    @State private var setting = L10n.setting

    var body: some View {
        // The name and, on the right, the choices — as on Windows and every other row (#21).
        SettingsGroup(title: L("언어")) {
            HStack(spacing: 12) {
                SettingsLabel(L("앱 언어"), systemImage: "globe")
                Spacer(minLength: 8)
                PaperSegmented(selection: Binding(get: { setting }, set: { choose($0) }),
                               options: [("auto", L("자동"), nil)] + AppLanguage.allCases.map { ($0.rawValue, $0.nativeName, nil) },
                               label: L("언어"))
                    .frame(width: AppLanguage.current == .ko ? 330 : AppLanguage.current == .en ? 340 : 370)
            }
            .settingsRow()
        }
    }

    private func choose(_ value: String) {
        guard value != setting else { return }
        let before = setting
        setting = value
        // Asked after the control moves, so the choice shows while the question is up.
        DispatchQueue.main.async {
            L10n.change(to: value) { model.saveEverything() }
            setting = before
        }
    }
}

/// 꾸미기 → 종이 색: 자동 (follows macOS, live) · 낮 · 밤. Every open window changes at once.
struct PaperColorGroup: View {
    @ObservedObject var model: AppModel

    var body: some View {
        SettingsGroup(title: L("종이"), footer: L("자동이면 Mac이 어두운 모드일 때 밤 종이가 돼요. 불 끈 방의 종이처럼 어둡고 조용한 색이에요.")) {
            HStack(spacing: 12) {
                // The icon follows the choice: half and half for 자동, a sun for 낮, a moon for 밤 (#21).
                SettingsLabel(L("종이 색"), systemImage: model.paperColor == .day ? "sun.max" : model.paperColor == .night ? "moon" : "circle.lefthalf.filled")
                Spacer(minLength: 8)
                PaperSegmented(selection: $model.paperColor, options: PaperColor.allCases.map { ($0, $0.title, nil) }, label: L("종이 색"))
                    // Dutch "Automatisch" needs room on both sides of it (1.45: it touched its segment's edges at 250).
                    .frame(width: AppLanguage.current == .ko ? 180 : AppLanguage.current == .en ? 250 : 290)
            }
            .settingsRow()
        }
    }
}

/// 저장과 백업 → 백업 · 옮기기: everything to one file, and back in on another computer.
struct BackupSettingsGroup: View {
    let model: AppModel

    var body: some View {
        SettingsGroup(title: L("백업 · 옮기기"), more: "backup", footer: L("내보낸 백업 파일(.jongi)을 다른 컴퓨터의 종이냥에서 가져오면 모두 그대로 옮겨져요. Mac ↔ Windows도 돼요.")) {
            HStack(spacing: 10) {
                SettingsLabel(L("백업 파일"), systemImage: "square.and.arrow.up")
                Spacer(minLength: 8)
                Button("내보내기…") { BackupController.export(model: model) }
                    .buttonStyle(PaperActionButtonStyle())
                Button("가져오기…") { BackupController.importBackup(model: model) }
                    .buttonStyle(PaperActionButtonStyle())
            }
            .settingsRow()
        }
    }
}
