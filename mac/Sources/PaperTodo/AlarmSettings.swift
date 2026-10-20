import PaperCore
import SwiftUI

/// Settings → 시계 → 알람: every alarm with its time, name, days and when it rings next, a
/// switch each, and the row opened for editing in place (time, name, days, sound, snooze).
struct AlarmSettingsGroup: View {
    @ObservedObject var book: AlarmBook
    let notebookFont: NotebookFont
    @State private var editing: String?
    @State private var draft = Alarm()
    @State private var sound = AlarmSound()
    @State private var pickingTime = false

    init(book: AlarmBook, notebookFont: NotebookFont, editing: String? = nil) {
        self.book = book
        self.notebookFont = notebookFont
        _editing = State(initialValue: editing)
        _draft = State(initialValue: editing.flatMap { book.alarm($0) } ?? Alarm())
    }

    var body: some View {
        SettingsGroup(title: L("알람"), footer: book.problem ?? L("종이냥이 켜져 있으면 이 Mac에서 울려요. Mac이 잠들어 있다가 알람 시각에서 15분 안에 깨어나면 그때 울리고, 그보다 늦으면 건너뛰어요. 공유 폴더를 쓰면 다른 기기도 같은 알람을 각자 울려요.")) {
            if book.alarms.isEmpty {
                HStack(spacing: 12) {
                    Image(nsImage: PetArt.image(.sleep) ?? PaperTheme.mascot).resizable().scaledToFit().frame(width: 40, height: 40)
                        .accessibilityHidden(true)
                    Text("알람이 없어요. 아침 기상이나 약 먹을 시간을 맞춰 보세요.")
                        .font(.system(size: 12))
                        .foregroundStyle(PaperTheme.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 10)
                .settingsRow()
                SettingsSeparator()
            }
            ForEach(book.sorted) { alarm in
                if editing == alarm.id {
                    editor
                } else {
                    row(alarm)
                }
                SettingsSeparator()
            }
            Button {
                let id = book.add()
                begin(id)
            } label: {
                SettingsLabel(L("알람 추가"), systemImage: "plus").settingsRow()
            }
            .buttonStyle(.plain)
        }
        .onDisappear { sound.stop() }
    }

    // MARK: A row

    private func row(_ alarm: Alarm) -> some View {
        let language = AppLanguage.current
        let label = alarm.label.trimmingCharacters(in: .whitespaces)
        return HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                // The time is the app's (UI type); the name is what you wrote (handwriting).
                Text(Alarm.timeText(alarm, language: language))
                    .font(.system(size: 19, weight: .semibold).monospacedDigit())
                    .foregroundStyle(alarm.enabled ? PaperTheme.ink : PaperTheme.faded)
                    .lineLimit(1)
                HStack(alignment: .firstTextBaseline, spacing: 5) {
                    if !label.isEmpty {
                        Text(label.handwritten)
                            .font(notebookFont.handFont(19))
                            .foregroundStyle(alarm.enabled ? PaperTheme.ink : PaperTheme.faded)
                            .lineLimit(1)
                        Text("·").foregroundStyle(PaperTheme.ink3)
                    }
                    Text(Alarm.daysText(alarm.days, language: language))
                        .foregroundStyle(alarm.enabled ? PaperTheme.ink2 : PaperTheme.faded)
                        .lineLimit(1)
                }
                .font(.system(size: 12, weight: .medium))
                // Kept current while Settings stays open.
                TimelineView(.everyMinute) { context in
                    if let next = Alarm.nextFire(alarm, now: context.date, handled: book.handled) {
                        Text(Alarm.untilText(next, now: context.date, language: language))
                            .font(.system(size: 11))
                            .foregroundStyle(PaperTheme.secondary)
                            .lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 8)
            Toggle(isOn: Binding(get: { alarm.enabled }, set: { book.setEnabled(alarm.id, $0) })) {
                Text(Alarm.timeText(alarm, language: language))
            }
            .toggleStyle(PaperToggleStyle()).labelsHidden()
        }
        .padding(.vertical, 8)
        .settingsRow()
        .onTapGesture { begin(alarm.id) }
        .help("눌러서 고치기")
        .accessibilityElement(children: .combine)
        .accessibilityAction(named: "고치기") { begin(alarm.id) }
    }

    // MARK: Editing

    private func begin(_ id: String) {
        guard let alarm = book.alarm(id) else { return }
        sound.stop()
        draft = alarm
        editing = id
    }

    private var editor: some View {
        let language = AppLanguage.current
        return VStack(alignment: .leading, spacing: 10) {
            field(L("시간")) {
                // As on the event sheet: a chip that opens the 15-minute list (any time can be typed).
                Button { pickingTime = true } label: {
                    Text(Alarm.timeText(draft, language: language))
                        .font(.system(size: 17, weight: .semibold).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, 12)
                        .frame(height: 32)
                        .background(pickingTime ? PaperTheme.raised : PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay {
                            if pickingTime { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) }
                        }
                        .contentShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L("시간") + ", " + Alarm.timeText(draft, language: language))
                .popover(isPresented: $pickingTime, arrowEdge: .bottom) {
                    TimePickerList(minutes: (draft.clock?.hour ?? 7) * 60 + (draft.clock?.minute ?? 0)) { minutes in
                        draft.time = Alarm.time(hour: minutes / 60, minute: minutes % 60)
                        pickingTime = false
                    }
                }
                Spacer(minLength: 0)
            }
            field(L("이름")) {
                HandField(placeholder: L("이름 (선택)"), text: $draft.label, size: 22, font: notebookFont)
            }
            field(L("요일")) {
                HStack(spacing: 4) {
                    ForEach(language.weekdayOrder, id: \.self) { day in
                        dayChip(day, language: language)
                    }
                }
            }
            Text(Alarm.daysText(draft.days, language: language))
                .font(.system(size: 11))
                .foregroundStyle(PaperTheme.secondary)
                .padding(.leading, Self.captionWidth + 10)
            field(L("소리")) {
                PaperSegmented(selection: $draft.sound,
                               options: Alarm.Sound.allCases.map { ($0, $0.title(language), nil) },
                               label: L("소리"))
                Button {
                    sound.playOnce(draft.sound)
                } label: {
                    Label("들어 보기", systemImage: "play.fill").labelStyle(.titleAndIcon)
                        .lineLimit(1)
                        .fixedSize()
                }
                .buttonStyle(SlipButtonStyle(role: .quiet))
                .disabled(draft.sound == .silent)
            }
            field(L("다시 울림")) {
                PaperSegmented(selection: $draft.snooze,
                               options: Alarm.snoozeOptions.map { ($0, $0 == 0 ? String(localized: "없음", table: "Settings") : L("\($0)분"), nil) },
                               label: L("다시 울림"))
                    .frame(width: 252)
                Spacer(minLength: 0)
            }
            HStack(spacing: 6) {
                Button(role: .destructive) {
                    sound.stop()
                    book.delete(draft.id)
                    editing = nil
                } label: {
                    Label("지우기", systemImage: "trash").labelStyle(.titleAndIcon)
                }
                .buttonStyle(SlipButtonStyle(role: .danger))
                Spacer()
                Button(String(localized: "완료", table: "Settings")) {
                    sound.stop()
                    book.update(draft)
                    editing = nil
                }
                .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
                .keyboardShortcut(.defaultAction)
            }
        }
        // No tinted block of its own: its rounded corners notched the group's outline.
        .padding(12)
    }

    private static let captionWidth: CGFloat = 64

    private func field<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 10) {
            Text(title)
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(PaperTheme.secondary)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .frame(width: Self.captionWidth, alignment: .leading)
            content()
        }
    }

    private func dayChip(_ day: Int, language: AppLanguage) -> some View {
        let on = draft.days.contains(day)
        return Button {
            draft.days = on ? draft.days.filter { $0 != day } : (draft.days + [day]).sorted()
        } label: {
            SlipChip(title: language.weekdayShort(day), selected: on, centered: true)
                .frame(width: language == .ko ? 32 : 40)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(language.weekdayName(day))
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
