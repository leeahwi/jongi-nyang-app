import Combine
import PaperCore
import SwiftUI

struct TaskReminderEditorView: View {
    let item: TodoItem
    @ObservedObject var model: AppModel
    let onSave: (Date) -> Void
    let onRemove: () -> Void
    let onCancel: () -> Void

    @State private var draftDate: Date
    @State private var now: Date
    @State private var selectedPreset: ReminderPreset?
    @State private var showingCustomDate = false
    @State private var headerHeight: CGFloat = 72
    @State private var customHeight: CGFloat = 230
    @State private var mode: EditorMode
    @State private var repeatDraft: RepeatDraft
    @State private var deadline: DeadlineChoice
    @State private var deadlineDate: Date
    @State private var keepOnToday: Bool
    @State private var pickingTime = false
    /// 시간 정하기 (1.39): the range being edited, in the 4 a.m. day's minutes; the end may be left out.
    @State private var rangeStart: Int
    @State private var rangeEnd: Int?
    @State private var pickingRange: RangeEnd?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let clock = Timer.publish(every: 30, on: .main, in: .common).autoconnect()

    init(
        item: TodoItem,
        model: AppModel,
        onSave: @escaping (Date) -> Void,
        onRemove: @escaping () -> Void,
        onCancel: @escaping () -> Void,
        startOnRepeat: Bool = false,
        startOnDeadline: Bool = false,
        startOnTime: Bool = false
    ) {
        let initialNow = Date()
        let series = model.series.first { $0.id == item.seriesID }
        _mode = State(initialValue: startOnTime ? .time : startOnDeadline ? .deadline : startOnRepeat || series != nil ? .repeating : .once)
        let range = item.timeRange ?? Self.suggestedRange(now: initialNow, today: TimeBlock.day(of: item, now: initialNow) == Archive.dayKey(initialNow))
        _rangeStart = State(initialValue: range.start)
        _rangeEnd = State(initialValue: range.end)
        let existingDue = item.dueDate
        let initialDeadline: DeadlineChoice = [DeadlineChoice.today, .thisWeek, .thisMonth]
            .first { Deadline.day(for: $0, now: initialNow, language: .current) == existingDue }
            ?? existingDue.flatMap { Deadline.date(from: $0) }.map { .date($0) }
            ?? .thisWeek
        _deadline = State(initialValue: initialDeadline)
        _deadlineDate = State(initialValue: existingDue.flatMap { Deadline.date(from: $0) } ?? Archive.logicalDayStart(initialNow))
        _keepOnToday = State(initialValue: item.shelf == .today)
        _repeatDraft = State(initialValue: RepeatDraft(series: series, now: initialNow))
        let initialPreset: ReminderPreset?
        let initialDate: Date

        if let reminderAt = item.reminderAt, reminderAt > initialNow {
            initialDate = reminderAt
            initialPreset = ReminderPreset.matching(reminderAt, relativeTo: initialNow)
        } else {
            initialPreset = .tenMinutes
            initialDate = ReminderPreset.tenMinutes.date(relativeTo: initialNow)
        }

        self.item = item
        self.model = model
        self.onSave = onSave
        self.onRemove = onRemove
        self.onCancel = onCancel
        _draftDate = State(initialValue: initialDate)
        _now = State(initialValue: initialNow)
        _selectedPreset = State(initialValue: initialPreset)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(.horizontal, 18)
                .padding(.top, 16)
                .padding(.bottom, 10)
                .background {
                    GeometryReader { geometry in
                        Color.clear.preference(key: EditorHeaderHeight.self, value: geometry.size.height)
                    }
                }
            // Four words of very different lengths in Dutch: as wide as their words, so the gaps read even (1.45).
            PaperSegmented(selection: $mode, options: modeOptions, label: L("알림 종류"), fit: true)
            .padding(.horizontal, 18)
            .padding(.bottom, 12)

            if mode == .repeating {
                RepeatFieldsView(draft: $repeatDraft)
                    .padding(.horizontal, 18)
                    .padding(.bottom, 14)
            } else if mode == .deadline {
                deadlineFields
                    .padding(.horizontal, 18)
                    .padding(.bottom, 14)
            } else if mode == .time {
                timeFields
                    .padding(.horizontal, 18)
                    .padding(.bottom, 14)
            } else if showingCustomDate {
                HStack(spacing: 10) {
                    Button { showingCustomDate = false } label: {
                        Label("빠른 선택", systemImage: "chevron.left")
                            .labelStyle(.titleAndIcon)
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(PaperTheme.sage)
                    Spacer(minLength: 0)
                    Text(isValid ? ReminderTimeText.scheduled(draftDate, relativeTo: now, language: .current) : L("지난 시간은 고를 수 없어요"))
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(isValid ? PaperTheme.sage : PaperTheme.clayText)
                        .lineLimit(1)
                }
                .padding(.horizontal, 18)
                .frame(height: 44)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(PaperTheme.rule.opacity(0.65)).frame(height: 0.7)
                }
                ScrollView {
                    customDateControls.padding(.horizontal, 18).padding(.vertical, 14)
                        .background {
                            GeometryReader { geometry in
                                Color.clear.preference(key: EditorCustomHeight.self, value: geometry.size.height)
                            }
                        }
                }
                .scrollEdgeFade(12)
                .frame(height: min(customHeight, max(188, 720 - headerHeight - 44 - 58 - 52)))
            } else {
                VStack(alignment: .leading, spacing: 14) {
                    presets
                    summary
                    customDateDisclosure
                }
                .padding(.horizontal, 18)
                .padding(.bottom, 14)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            footer
                .padding(.horizontal, 18)
                .padding(.vertical, 12)
                .background(PaperTheme.paper.opacity(0.92))
                .overlay(alignment: .top) {
                    Rectangle()
                        .fill(PaperTheme.rule.opacity(0.75))
                        .frame(height: 0.7)
                }
        }
        // English and Dutch buttons are longer: a little wider, so the footer stays on one line.
        .frame(width: AppLanguage.current == .ko ? 340 : 380)
        .frame(maxHeight: 720)
        .background(PaperBackground())
        .background {
            if let output = snapshotURL {
                ViewSnapshotAnchor(url: output).allowsHitTesting(false).accessibilityHidden(true)
            }
        }
        .onPreferenceChange(EditorHeaderHeight.self) { height in
            if abs(headerHeight - height) > 1 { headerHeight = height }
        }
        .onPreferenceChange(EditorCustomHeight.self) { height in
            if abs(customHeight - height) > 1 { customHeight = height }
        }
        .onReceive(clock) { tick in
            now = tick
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                SlipBadge(kind: .todo, symbol: mode == .time ? "clock" : "bell")
                Text(offersTime ? L("알림 · 반복 · 마감 · 시간") : L("알림 · 반복 · 마감"))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PaperTheme.ink)
            }

            Text(item.title.handwritten)
                .font(model.notebookFont.bodyFont(model.textSize))
                .foregroundStyle(PaperTheme.ink)
                .lineLimit(2)
                .minimumScaleFactor(0.86)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)

            if let previousReminderText {
                Text(previousReminderText)
                    .font(.system(size: 11))
                    .foregroundStyle(PaperTheme.faded)
                    .padding(.top, 1)
            }
            // 할 일 스페이스 (1.45): which space it's in, changed at once (only once there's a space).
            if !model.todoSpaces.isEmpty { spaceField.padding(.top, 2) }
        }
    }

    private var spaceField: some View {
        let space = model.spaceOf(item.id)
        return HStack(spacing: 8) {
            // One space here: "Space" (the desk's pane is "Spaces").
            Text(String(localized: "스페이스", table: "Reminder"))
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(PaperTheme.ink2)
            HStack(spacing: 5) {
                if let space {
                    RoundedRectangle(cornerRadius: 2).fill(PaperTheme.space(space.colorKey)).frame(width: 8, height: 8)
                } else {
                    RoundedRectangle(cornerRadius: 2).strokeBorder(PaperTheme.ink3, lineWidth: 1).frame(width: 8, height: 8)
                }
                Text(space?.name ?? SpaceWords.noSpace(.current)).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 8, weight: .semibold)).foregroundStyle(PaperTheme.ink3)
            }
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(PaperTheme.ink)
            .padding(.horizontal, 8)
            .frame(height: 24)
            .background(PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .fixedSize()
            .overlay { SpaceMenuArea(label: space?.name ?? SpaceWords.noSpace(.current), items: { SpaceMenus.move(model, item.id, offerNew: false) }, font: model.notebookFont) }
            .accessibilityLabel(L("스페이스") + " " + (space?.name ?? SpaceWords.noSpace(.current)))
            Spacer(minLength: 0)
        }
    }

    private var presets: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("빠른 선택")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PaperTheme.secondary)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach(ReminderPreset.allCases) { preset in
                    Button {
                        selectPreset(preset)
                    } label: {
                        ReminderChoiceLabel(title: preset.title, selected: selectedPreset == preset)
                    }
                    .buttonStyle(.plain)
                    .help(L("\(preset.title)에 알림 설정"))
                }
            }
        }
    }

    private var summary: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: isValid ? "clock" : "exclamationmark.triangle")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(isValid ? PaperTheme.sage : PaperTheme.clayText)
                .frame(width: 18, height: 22)

            VStack(alignment: .leading, spacing: 3) {
                Text("알림 시간")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(PaperTheme.secondary)

                Text(ReminderTimeText.scheduled(draftDate, relativeTo: now, language: .current))
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(isValid ? PaperTheme.ink : PaperTheme.clayText)

                Text(isValid ? L("앱이 켜져 있을 때 종이냥이 알려 줘요.") : L("지난 시간은 고를 수 없어요."))
                    .font(.system(size: 11))
                    .foregroundStyle(isValid ? PaperTheme.secondary : PaperTheme.clayText)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(PaperTheme.rule, lineWidth: 1) }
    }

    private var customDateDisclosure: some View {
        Button {
            if reduceMotion {
                showingCustomDate.toggle()
            } else {
                withAnimation(.easeInOut(duration: 0.16)) {
                    showingCustomDate.toggle()
                }
            }
        } label: {
            HStack(spacing: 7) {
                Image(systemName: "calendar.badge.clock")
                    .font(.system(size: 11, weight: .semibold))
                    .frame(width: 15)

                Text("다른 날짜·시간")
                    .font(.system(size: 13, weight: .semibold))

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(PaperTheme.faded)
            }
            .foregroundStyle(PaperTheme.sageText)
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background(PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var customDateControls: some View {
        VStack(alignment: .leading, spacing: 12) {
            PaperCalendar(selection: customDateBinding, minimum: now)
            HStack(spacing: 10) {
                Image(systemName: "clock").font(.system(size: 13, weight: .semibold)).foregroundStyle(PaperTheme.sage)
                Text("시간").font(.system(size: 13, weight: .semibold))
                Spacer()
                // As on the event sheet: a chip that opens the 15-minute list (any time can be typed).
                Button { pickingTime = true } label: {
                    Text(AppLanguage.current.spokenTime(hour: Calendar.current.component(.hour, from: draftDate),
                                                        minute: Calendar.current.component(.minute, from: draftDate)))
                        .font(.system(size: 14, weight: .semibold).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, 10)
                        .frame(height: 28)
                        .background(pickingTime ? PaperTheme.raised : PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay {
                            if pickingTime { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) }
                        }
                        .contentShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L("시간"))
                .popover(isPresented: $pickingTime, arrowEdge: .bottom) {
                    let parts = Calendar.current.dateComponents([.hour, .minute], from: draftDate)
                    TimePickerList(minutes: (parts.hour ?? 9) * 60 + (parts.minute ?? 0)) { minutes in
                        if let date = Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: draftDate) {
                            customDateBinding.wrappedValue = date
                        }
                        pickingTime = false
                    }
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 44)
            .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(PaperTheme.rule, lineWidth: 1) }
        }
    }
    private var series: Series? { model.series.first { $0.id == item.seriesID } }

    @ViewBuilder
    private var footer: some View {
        switch mode {
        case .repeating: repeatFooter
        case .deadline: deadlineFooter
        case .once: onceFooter
        case .time: timeFooter
        }
    }

    // MARK: 시간 정하기 (1.39)

    /// 시간 is offered when the task has a day (not on 언젠가), or already has a range.
    private var offersTime: Bool { TimeBlock.day(of: item, now: now) != nil || item.timeRange != nil }

    private var modeOptions: [(value: EditorMode, title: String, symbol: String?)] {
        var options: [(value: EditorMode, title: String, symbol: String?)] = [(.once, L("한 번 알림"), "bell"), (.repeating, L("반복"), "repeat"), (.deadline, L("마감"), "flag")]
        if offersTime { options.append((.time, L("시간"), "clock")) }
        return options
    }

    /// A new range: the next quarter hour from now on today's sheet (an hour long), else 09:00–10:00.
    static func suggestedRange(now: Date, today: Bool) -> TimeRange {
        guard today else { return TimeRange(start: 9 * 60, end: 10 * 60) }
        let parts = Calendar.current.dateComponents([.hour, .minute], from: now)
        let start = TimeBlock.logical(((parts.hour! * 60 + parts.minute!) / 15 + 1) * 15 % 1440)
        let clamped = min(start, TimeBlock.dayEnd - 60)
        return TimeRange(start: clamped, end: clamped + 60)
    }

    private var draftRange: TimeRange { TimeRange(start: rangeStart, end: rangeEnd) }
    private var rangeIsValid: Bool { rangeEnd.map { $0 > rangeStart && $0 <= TimeBlock.dayEnd } ?? true }

    /// "오늘", "내일" or the short date of the range's day.
    private var rangeDayText: String {
        let language = AppLanguage.current
        guard let key = TimeBlock.day(of: item, now: now), let day = Deadline.date(from: key) else { return "" }
        let today = Calendar.paper.startOfDay(for: Archive.logicalDayStart(now))
        let offset = Calendar.paper.dateComponents([.day], from: today, to: Calendar.paper.startOfDay(for: day)).day ?? 99
        if let word = language.dayWord(offset), (0...1).contains(offset) { return word }
        return language.shortDate(day)
    }

    /// What happens to the reminder when this range is saved (TimeBlock.reminder).
    private var rangeReminderText: String {
        guard rangeIsValid else { return L("끝은 시작보다 뒤여야 해요.") }
        let after = TimeBlock.reminder(for: item, from: item.timeRange, to: draftRange, now: now)
        var placed = item
        placed.timeRange = draftRange
        let start = TimeBlock.interval(of: placed, now: now)?.start
        let clock = { (date: Date) -> String in
            let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
            return AppLanguage.current.clock(hour: parts.hour!, minute: parts.minute!)
        }
        if let after, after == start { return L("시작할 때 알려 줘요.") }
        if let after { return L("알림은 그대로예요 · \(clock(after))") }
        return L("이미 지난 시간이라 알림은 없어요.")
    }

    private func rangeChip(_ which: RangeEnd) -> some View {
        let minutes = which == .start ? rangeStart : rangeEnd
        let language = AppLanguage.current
        let text = minutes.map { language.clock(hour: $0 % 1440 / 60, minute: $0 % 60) } ?? "—"
        let picking = pickingRange == which
        return Button { pickingRange = which } label: {
            Text(text)
                .font(.system(size: 14, weight: .semibold).monospacedDigit())
                .foregroundStyle(minutes == nil ? PaperTheme.ink3 : PaperTheme.ink)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 10)
                .frame(minWidth: 64, minHeight: 28)
                .background(picking ? PaperTheme.raised : PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                    if picking { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) }
                }
                .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(which == .start ? L("시작 시각") : L("끝 시각"))
        .accessibilityValue(text)
        .popover(isPresented: Binding(get: { pickingRange == which }, set: { if !$0 && pickingRange == which { pickingRange = nil } }), arrowEdge: .bottom) {
            TimePickerList(minutes: (minutes ?? (rangeStart + 60)) % 1440) { picked in
                let value = TimeBlock.logical(picked)
                if which == .start {
                    // The length stays when the start moves.
                    let length = rangeEnd.map { $0 - rangeStart }
                    rangeStart = min(value, TimeBlock.dayEnd - 15)
                    if let length { rangeEnd = min(TimeBlock.dayEnd, rangeStart + length) }
                } else {
                    rangeEnd = value
                }
                pickingRange = nil
            }
        }
    }

    private var timeFields: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "clock").font(.system(size: 13, weight: .semibold)).foregroundStyle(PaperTheme.sage)
                Text("시간").font(.system(size: 13, weight: .semibold))
                Spacer(minLength: 4)
                rangeChip(.start)
                Image(systemName: "arrow.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(PaperTheme.ink3)
                    .accessibilityHidden(true)
                rangeChip(.end)
            }
            .padding(.horizontal, 12)
            .frame(height: 44)
            .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(PaperTheme.rule, lineWidth: 1) }

            HStack(spacing: 6) {
                ForEach([30, 60, 120], id: \.self) { length in
                    let fits = rangeStart + length <= TimeBlock.dayEnd
                    Button { rangeEnd = rangeStart + length } label: {
                        ReminderChoiceLabel(title: TimerLength.text(length, language: .current), selected: rangeEnd == rangeStart + length)
                    }
                    .buttonStyle(.plain)
                    .disabled(!fits)
                    .opacity(fits ? 1 : 0.4)
                }
            }

            HStack(alignment: .top, spacing: 10) {
                Image(systemName: rangeIsValid ? "clock" : "exclamationmark.triangle")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(rangeIsValid ? PaperTheme.sage : PaperTheme.clayText)
                    .frame(width: 18, height: 22)
                VStack(alignment: .leading, spacing: 3) {
                    Text("할 일 시간").font(.system(size: 11, weight: .semibold)).foregroundStyle(PaperTheme.secondary)
                    Text(rangeDayText + " " + draftRange.text(.current))
                        .font(.system(size: 15, weight: .semibold).monospacedDigit())
                        .foregroundStyle(rangeIsValid ? PaperTheme.ink : PaperTheme.clayText)
                    Text(rangeReminderText)
                        .font(.system(size: 11))
                        .foregroundStyle(rangeIsValid ? PaperTheme.secondary : PaperTheme.clayText)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(PaperTheme.rule, lineWidth: 1) }
        }
    }

    private var timeFooter: some View {
        HStack(spacing: 8) {
            if item.timeRange != nil {
                Button("시간 지우기") {
                    model.setTimeRange(item.id, to: nil)
                    onCancel()
                }
                .buttonStyle(SlipButtonStyle(role: .danger))
                .fixedSize()
            }
            Spacer(minLength: 0)
            Button("취소", action: onCancel)
                .buttonStyle(SlipButtonStyle(role: .ghost))
                .fixedSize()
                .keyboardShortcut(.cancelAction)
            Button {
                model.setTimeRange(item.id, to: draftRange)
                onCancel()
            } label: {
                Text("시간 정하기")
            }
            .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
            .fixedSize()
            .disabled(!rangeIsValid)
            .keyboardShortcut(.defaultAction)
        }
    }

    private var repeatFooter: some View {
        HStack(spacing: 8) {
            if let series {
                Button("반복 해제") {
                    model.deleteSeries(series.id)
                    onCancel()
                }
                .buttonStyle(SlipButtonStyle(role: .danger))
                .fixedSize()
            }
            Spacer(minLength: 0)
            Button("취소", action: onCancel)
                .buttonStyle(SlipButtonStyle(role: .ghost))
                .fixedSize()
                .keyboardShortcut(.cancelAction)
            Button {
                model.saveSeries(taskID: item.id, rule: repeatDraft.rule, remindAt: repeatDraft.remindAt)
                onCancel()
            } label: {
                Text(series == nil ? L("반복 만들기") : L("반복 저장"))
            }
            .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
                .fixedSize()
            .disabled(!repeatDraft.isValid)
            .keyboardShortcut(.defaultAction)
        }
    }

    private var deadlineKey: String {
        if case .date = deadline { return Deadline.key(deadlineDate) }
        return Deadline.day(for: deadline, now: now, language: .current)
    }

    private var deadlineFields: some View {
        VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
                ForEach([DeadlineChoice.today, .thisWeek, .thisMonth, .date(deadlineDate)], id: \.self) { choice in
                    let selected = choice.title == deadline.title
                    Button { deadline = choice } label: {
                        ReminderChoiceLabel(title: choice.title(.current), subtitle: deadlineHint(choice), selected: selected)
                    }
                    .buttonStyle(.plain)
                }
            }
            if case .date = deadline {
                PaperCalendar(selection: $deadlineDate, minimum: Archive.logicalDayStart(now), showsSpanFromToday: true, today: Archive.logicalDayStart(now))
                    .onChange(of: deadlineDate) { deadline = .date(deadlineDate) }
            }
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "flag").font(.system(size: 13, weight: .semibold)).foregroundStyle(PaperTheme.sage).frame(width: 18, height: 22)
                VStack(alignment: .leading, spacing: 3) {
                    Text("마감").font(.system(size: 11, weight: .semibold)).foregroundStyle(PaperTheme.secondary)
                    Text(Deadline.sentence(deadlineKey, now: now, language: .current)).font(.system(size: 14, weight: .semibold))
                    Text(keepOnToday || (Deadline.daysLeft(deadlineKey, now: now) ?? 0) <= 0
                         ? L("오늘 할 일에 \(Deadline.label(deadlineKey, style: model.dueStyle, now: now, language: .current))로 보여요")
                         : L("마감 날까지 ‘앞으로’ 탭에서 \(Deadline.label(deadlineKey, style: model.dueStyle, now: now, language: .current))로 기다려요"))
                        .font(.system(size: 11)).foregroundStyle(PaperTheme.secondary)
                }
            }
            .padding(.vertical, 10)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(PaperTheme.rule, lineWidth: 1) }

            HStack {
                Label("오늘 할 일에도 두기", systemImage: "pin").font(.system(size: 12.5))
                Spacer()
                Toggle("오늘 할 일에도 두기", isOn: $keepOnToday).toggleStyle(PaperToggleStyle(small: true)).labelsHidden()
            }
            .padding(.horizontal, 12)
            .frame(height: 38)
            .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(PaperTheme.rule, lineWidth: 1) }
            .help("마감 전이라도 오늘 할 일에 계속 둬요")
        }
    }

    /// The day each choice means, under its name: "10/4 (일)", or 달력에서 for a date not yet picked.
    private func deadlineHint(_ choice: DeadlineChoice) -> String {
        if case .date = choice, !(deadline.title == choice.title) { return L("달력에서 고르기") }
        guard let day = Deadline.date(from: Deadline.day(for: choice, now: now, language: .current)) else { return "" }
        let language = AppLanguage.current
        guard language == .ko else { return language.shortDate(day) }
        let parts = Calendar.paper.dateComponents([.month, .day, .weekday], from: day)
        return "\(parts.month!)/\(parts.day!) (\(Repeat.weekdayShort[parts.weekday! - 1]))"
    }

    private var deadlineFooter: some View {
        HStack(spacing: 8) {
            if item.dueDate != nil {
                Button("마감 없애기") {
                    model.setDue(item.id, to: nil)
                    onCancel()
                }
                .buttonStyle(SlipButtonStyle(role: .danger))
                .fixedSize()
            }
            Spacer(minLength: 0)
            Button("취소", action: onCancel)
                .buttonStyle(SlipButtonStyle(role: .ghost))
                .fixedSize()
                .keyboardShortcut(.cancelAction)
            Button {
                model.setDeadline(item.id, to: deadlineKey, keepOnToday: keepOnToday)
                onCancel()
            } label: {
                Text("마감 정하기")
            }
            .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
                .fixedSize()
            .keyboardShortcut(.defaultAction)
        }
    }

    private var onceFooter: some View {
        HStack(spacing: 8) {
            if item.reminderAt != nil {
                Button("알림 해제", action: onRemove)
                    .buttonStyle(SlipButtonStyle(role: .danger))
                .fixedSize()
            }

            Spacer(minLength: 0)

            Button("취소", action: onCancel)
                .buttonStyle(SlipButtonStyle(role: .ghost))
                .fixedSize()
                .keyboardShortcut(.cancelAction)

            Button {
                let current = Date()
                now = current
                guard draftDate > current else { return }
                onSave(draftDate)
            } label: {
                Text("이 시간에 알림")
            }
            .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
                .fixedSize()
            .disabled(!isValid)
            .keyboardShortcut(.defaultAction)
        }
    }

    private var customDateBinding: Binding<Date> {
        Binding {
            draftDate
        } set: { newValue in
            draftDate = newValue
            selectedPreset = nil
        }
    }

    private var snapshotURL: URL? {
        let arguments = ProcessInfo.processInfo.arguments
        guard let index = arguments.firstIndex(of: "--editor-snapshot"), arguments.indices.contains(index + 1) else { return nil }
        return URL(fileURLWithPath: arguments[index + 1]).deletingPathExtension()
            .appendingPathExtension((mode == .repeating ? "repeat" : mode == .time ? "time" : showingCustomDate ? "custom" : "quick") + ".png")
    }

    private var isValid: Bool {
        draftDate > now
    }

    private var previousReminderText: String? {
        guard let reminderAt = item.reminderAt,
              reminderAt <= now || (item.reminderLastDeliveredAt ?? .distantPast) >= reminderAt else { return nil }

        return ReminderTimeText.rowLabel(for: item, now: now, language: .current)
    }

    private func selectPreset(_ preset: ReminderPreset) {
        let base = Date()
        selectedPreset = preset
        draftDate = preset.date(relativeTo: base)
        now = base
    }
}

private enum EditorMode: Hashable {
    case once, repeating, deadline, time
}

private enum RangeEnd: Hashable { case start, end }

private struct ReminderChoiceLabel: View {
    let title: String
    /// A small second line (the day a deadline choice means); never wraps the title.
    var subtitle: String = ""
    let selected: Bool

    var body: some View {
        HStack(spacing: 7) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title)
                    .font(.system(size: 13, weight: selected ? .semibold : .medium))
                    .lineLimit(1)
                if !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.system(size: 10.5).monospacedDigit())
                        .foregroundStyle(selected ? PaperTheme.sageText : PaperTheme.ink3)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            if selected {
                Image(systemName: "checkmark")
                    .font(.system(size: 10.5, weight: .bold))
                    .foregroundStyle(PaperTheme.sageText)
            }
        }
        .padding(.vertical, subtitle.isEmpty ? 0 : 6)
        .foregroundStyle(selected ? PaperTheme.sageText : PaperTheme.ink2)
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, minHeight: 34)
        .background(selected ? PaperTheme.sage2 : PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            if selected { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) }
        }
        .contentShape(Rectangle())
    }
}

private enum ReminderPreset: String, CaseIterable, Identifiable {
    case tenMinutes
    case thirtyMinutes
    case oneHour
    case tomorrowMorning

    var id: String { rawValue }

    var title: String {
        switch self {
        case .tenMinutes:
            return L("10분 뒤")
        case .thirtyMinutes:
            return L("30분 뒤")
        case .oneHour:
            return L("1시간 뒤")
        case .tomorrowMorning:
            return L("내일 오전 9시")
        }
    }

    func date(relativeTo date: Date) -> Date {
        switch self {
        case .tenMinutes:
            return date.addingTimeInterval(10 * 60)
        case .thirtyMinutes:
            return date.addingTimeInterval(30 * 60)
        case .oneHour:
            return date.addingTimeInterval(60 * 60)
        case .tomorrowMorning:
            let calendar = Calendar.current
            let tomorrow = calendar.date(byAdding: .day, value: 1, to: date) ?? date.addingTimeInterval(24 * 60 * 60)
            return calendar.date(bySettingHour: 9, minute: 0, second: 0, of: tomorrow) ?? tomorrow
        }
    }

    static func matching(_ date: Date, relativeTo now: Date) -> ReminderPreset? {
        allCases.first { preset in
            abs(preset.date(relativeTo: now).timeIntervalSince(date)) < 1
        }
    }
}

private struct EditorHeaderHeight: PreferenceKey {
    static let defaultValue: CGFloat = 72
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

private struct EditorCustomHeight: PreferenceKey {
    static let defaultValue: CGFloat = 230
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}
