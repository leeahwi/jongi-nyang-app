import AppKit
import PaperCore
import SwiftUI

/// What the event sheet opens for: a to-do going on the calendar, a new event, or one being
/// changed (or, from a menu, straight to "remove it?").
struct CalendarSheetRequest: Identifiable, Equatable {
    enum Mode: Equatable {
        case send
        case new
        /// The event, and the day of the occurrence that was picked (for ‘이 날만 지우기’).
        case edit(LocalEvent, day: String?)
    }

    let id = UUID()
    var mode: Mode
    var draft: CalendarDraft
    var confirmDelete = false
    /// Shown on opening (a quick-entry event that needs finishing).
    var problem: String?

    /// 고치기 / 지우기 for an occurrence shown somewhere.
    @MainActor static func edit(_ occurrence: CalendarEvent, in book: EventBook, confirmDelete: Bool = false) -> CalendarSheetRequest? {
        guard let event = book.event(occurrence.eventId) else { return nil }
        return CalendarSheetRequest(mode: .edit(event, day: LocalEvent.occurrenceDay(occurrence)), draft: .forEvent(event), confirmDelete: confirmDelete)
    }
}

/// 캘린더에 넣기 · 새 일정 · 일정 고치기: one slip (sky tape, L) for the app's own events. No label
/// column: the title in handwriting, then rows led by an icon — the day (and 종일), the time
/// (start → end and how long), the repeat, the colour and the place. Chips open small pickers: a
/// month grid, a 15-minute list that also takes a typed time, the repeat choices.
struct CalendarEventSheet: View {
    enum Picker: Hashable { case date, start, end, days, repeating }

    @ObservedObject var calendar: EventBook
    let mode: CalendarSheetRequest.Mode
    var onClose: () -> Void
    @State private var draft: CalendarDraft
    @State private var confirming: Bool
    @State private var problem: String?
    @State private var picker: Picker?
    @FocusState private var titleFocused: Bool
    private let openedOnConfirm: Bool

    init(calendar: EventBook, request: CalendarSheetRequest, onClose: @escaping () -> Void) {
        self.calendar = calendar
        mode = request.mode
        self.onClose = onClose
        _draft = State(initialValue: request.draft)
        _confirming = State(initialValue: request.confirmDelete)
        _problem = State(initialValue: request.problem)
        openedOnConfirm = request.confirmDelete
    }

    var body: some View {
        PaperSlip(kind: .event, width: SlipWidth.large.rawValue) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .event, symbol: mode == .send ? "calendar.badge.plus" : "calendar", title: heading, onClose: onClose)
                Group {
                    if confirming { confirmView } else { fields }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 4)
                footer
            }
        }
        .environment(\.locale, AppLanguage.current.locale)
        .onAppear { if !confirming && draft.title.isEmpty { DispatchQueue.main.async { titleFocused = true } } }
    }

    // MARK: Parts

    private var heading: String {
        if confirming { return L("일정 지우기") }
        return switch mode {
        case .send: L("달력에 넣기")
        case .new: L("새 일정")
        case .edit: L("일정 고치기")
        }
    }

    private var fields: some View {
        VStack(alignment: .leading, spacing: 0) {
            TextField("일정 제목", text: $draft.title)
                .textFieldStyle(.plain)
                .font(HandwritingFont.swiftUI(face: .pen, size: 30))
                .tint(PaperTheme.sage)
                .focused($titleFocused)
                .onSubmit(save)
                .accessibilityLabel("일정 제목")
                .padding(.bottom, 6)
                .overlay(alignment: .bottom) {
                    Rectangle().fill(titleFocused || !draft.title.isEmpty ? PaperTheme.sage : PaperTheme.rule).frame(height: 1.5)
                }
            VStack(spacing: 0) {
                row("calendar") {
                    chip(dateText, picker: .date, label: L("날짜"))
                    Spacer(minLength: 8)
                    AllDaySwitch(on: $draft.allDay)
                }
                // All day: how many days, with a span icon ("3일" alone read like a date).
                row(draft.allDay ? "arrow.left.and.right" : "clock") {
                    if draft.allDay {
                        chip(draft.days <= 1 ? L("하루 종일") : L("\(AppLanguage.current.days(draft.days)) 동안"), picker: .days, label: L("기간"))
                    } else {
                        chip(clock(draft.startMinutes), picker: .start, label: L("시작"))
                        Text("→").foregroundStyle(PaperTheme.ink3).accessibilityHidden(true)
                        chip(clock(draft.endMinutes), picker: .end, label: L("끝"))
                        Text(draft.lengthText(.current))
                            .font(.system(size: 12).monospacedDigit())
                            .foregroundStyle(PaperTheme.ink3)
                            .lineLimit(1)
                            .fixedSize()
                    }
                    Spacer(minLength: 0)
                }
                if let problem {
                    Text(problem)
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(PaperTheme.clayText)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.leading, 34)
                        .padding(.bottom, 6)
                        .fixedSize(horizontal: false, vertical: true)
                }
                row("repeat") {
                    chip(draft.repeatRule == .none ? L("반복 안 함") : draft.repeatRule.title(.current), picker: .repeating, label: L("반복"))
                    Spacer(minLength: 0)
                }
                row("paintpalette") {
                    HStack(spacing: 8) {
                        ForEach(LocalEvent.Color.allCases, id: \.self) { color in
                            Button { draft.color = color } label: {
                                Circle()
                                    .fill(PaperTheme.event(color.hex, fallback: PaperTheme.sage))
                                    .frame(width: 18, height: 18)
                                    .overlay {
                                        if draft.color == color {
                                            Circle().strokeBorder(PaperTheme.paper, lineWidth: 2)
                                            Circle().strokeBorder(PaperTheme.event(color.hex, fallback: PaperTheme.sage), lineWidth: 1.5).padding(-3.5)
                                        }
                                    }
                                    .frame(width: 26, height: 26)
                                    .contentShape(Circle())
                            }
                            .buttonStyle(.plain)
                            .help(color.title(.current))
                            .accessibilityLabel(color.title(.current))
                            .accessibilityAddTraits(draft.color == color ? .isSelected : [])
                        }
                    }
                    Spacer(minLength: 0)
                }
                row("mappin", last: true) {
                    PlainSlipField(placeholder: L("장소 (선택)"), text: $draft.location, accessibilityLabel: L("장소"), onSubmit: save)
                        .frame(height: 20)
                }
            }
            .padding(.top, 8)
            if isEditing && draft.repeatRule != .none {
                Text("반복하는 일정은 고치면 모든 날이 함께 바뀌어요.")
                    .font(.system(size: 11))
                    .foregroundStyle(PaperTheme.ink3)
                    .padding(.top, 2)
            }
        }
    }

    /// A row: a 16 pt faint icon, then its controls; a rule under it.
    private func row(_ symbol: String, last: Bool = false, @ViewBuilder content: () -> some View) -> some View {
        HStack(spacing: 8) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .regular))
                .foregroundStyle(PaperTheme.ink3)
                .frame(width: 26)
                .accessibilityHidden(true)
            content()
        }
        .font(.system(size: 13, weight: .medium))
        .frame(minHeight: 40)
        .overlay(alignment: .bottom) {
            if !last { Rectangle().fill(PaperTheme.rule).frame(height: 1) }
        }
    }

    /// A chip that opens its picker.
    private func chip(_ title: String, picker which: Picker, label: String) -> some View {
        Button { picker = which } label: {
            Text(title)
                .font(.system(size: 13, weight: .medium).monospacedDigit())
                .foregroundStyle(PaperTheme.ink)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 10)
                .frame(height: 26)
                .background(picker == which ? PaperTheme.raised : PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .overlay {
                    if picker == which { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) }
                }
                .contentShape(RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label + ", " + title)
        .popover(isPresented: Binding(get: { picker == which }, set: { if !$0 { picker = nil } }), arrowEdge: .bottom) {
            pickerView(which)
        }
    }

    @ViewBuilder
    func pickerView(_ which: Picker) -> some View {
        switch which {
        case .date:
            PaperCalendar(selection: dateBinding, framed: false)
                .frame(width: 280)
                .background(PaperTheme.card)
                .onChange(of: draft.date) { picker = nil }
        case .start:
            TimePickerList(minutes: draft.startMinutes) { minutes in
                setStart(minutes)
                picker = nil
            }
        case .end:
            TimePickerList(minutes: draft.endMinutes) { minutes in
                draft.endMinutes = minutes
                picker = nil
            }
        case .days:
            ChoiceList(choices: Array(1...7), selected: draft.days, title: { $0 == 1 ? L("하루") : AppLanguage.current.days($0) }) { days in
                draft.days = days
                picker = nil
            }
        case .repeating:
            ChoiceList(choices: LocalEvent.Repeat.allCases, selected: draft.repeatRule,
                       title: { $0 == .none ? L("반복 안 함") : $0.title(.current) }) { rule in
                draft.repeatRule = rule
                picker = nil
            }
        }
    }

    private var confirmView: some View {
        Text("‘\(draft.title)’ 일정을 지울까요?")
            .font(.system(size: 15))
            .foregroundStyle(PaperTheme.ink)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 6)
    }

    @ViewBuilder
    private var footer: some View {
        if confirming {
            SlipFooter { EmptyView() } trailing: {
                // Opened from a 지우기… menu: cancelling closes instead of going back to the fields.
                Button("취소") { if openedOnConfirm { onClose() } else { confirming = false } }
                    .buttonStyle(SlipButtonStyle(role: .ghost))
                    .keyboardShortcut(.cancelAction)
                if case .edit(let event, let day) = mode, event.repeatRule != .none, let day {
                    // Every day of a repeating event goes: clay, and never on Return.
                    Button("이 날만") { finish(.skip(event.id, day: day)) }
                        .buttonStyle(SlipButtonStyle(role: .ghost))
                    Button("모두 지우기") { finish(.delete(event.id)) }
                        .buttonStyle(SlipButtonStyle(role: .destructive))
                } else if case .edit(let event, _) = mode {
                    Button("지우기") { finish(.delete(event.id)) }
                        .buttonStyle(SlipButtonStyle(role: .destructive, key: "↩"))
                        .keyboardShortcut(.defaultAction)
                }
            }
        } else {
            SlipFooter {
                // (A new event has 취소 on the right already: no "esc 닫기" beside it.)
                if isEditing {
                    Button("지우기") { confirming = true }
                        .buttonStyle(SlipButtonStyle(role: .danger))
                }
            } trailing: {
                Button("취소", action: onClose)
                    .buttonStyle(SlipButtonStyle(role: .ghost))
                    .keyboardShortcut(.cancelAction)
                Button(primaryLabel, action: save)
                    .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
                    .keyboardShortcut(.defaultAction)
                    .disabled(draft.problem(.current) != nil)
                    .help(draft.problem(.current) ?? "")
            }
        }
    }

    private var isEditing: Bool { if case .edit = mode { true } else { false } }

    private var primaryLabel: String {
        switch mode {
        case .send: L("넣기")
        case .new: L("만들기")
        case .edit: L("저장")
        }
    }

    // MARK: Values

    private var dateText: String {
        guard let day = CalendarDraft.localDay(draft.date) else { return draft.date }
        return AppLanguage.current.shortDate(day)
    }

    private func clock(_ minutes: Int) -> String {
        AppLanguage.current.clock(hour: (minutes / 60) % 24, minute: minutes % 60)
    }

    private var dateBinding: Binding<Date> {
        Binding(get: { CalendarDraft.localDay(draft.date) ?? Date() }, set: { draft.date = CalendarDraft.day($0) })
    }

    /// Moving the start keeps the length.
    private func setStart(_ minutes: Int) {
        let length = draft.endsNextDay ? draft.endMinutes + 1440 - draft.startMinutes : draft.endMinutes - draft.startMinutes
        draft.startMinutes = minutes
        draft.endMinutes = (minutes + length) % 1440
    }

    // MARK: Doing

    private func save() {
        if let problem = draft.problem(.current) {
            self.problem = problem
            return
        }
        switch mode {
        case .send, .new: finish(.create(draft))
        case .edit(let event, _): finish(.update(event.id, draft))
        }
    }

    private func finish(_ change: EventBook.Change) {
        calendar.perform(change)
        if let trouble = calendar.problem {
            problem = trouble
            confirming = false
            return
        }
        onClose()
    }
}

/// 종일: a small paper switch (sage when on).
private struct AllDaySwitch: View {
    @Binding var on: Bool

    var body: some View {
        Button { withAnimation(.easeOut(duration: 0.14)) { on.toggle() } } label: {
            HStack(spacing: 6) {
                Text("종일").font(.system(size: 12, weight: .medium)).foregroundStyle(PaperTheme.ink2)
                PaperSwitch(on: on, small: true) { on.toggle() }
                    .allowsHitTesting(false)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("종일")
        .accessibilityValue(on ? L("켬") : L("끔"))
        .accessibilityAddTraits(.isToggle)
    }
}

/// The time picker: every 15 minutes, scrolled to the current one, and a field that takes a
/// typed time ("17:20", "5:20pm", "오후 5시").
struct TimePickerList: View {
    let minutes: Int
    let onPick: (Int) -> Void
    @State private var typed = ""

    var body: some View {
        VStack(spacing: 6) {
            TextField(L("예: 17:20"), text: $typed)
                .textFieldStyle(.plain)
                .font(.system(size: 13, weight: .medium).monospacedDigit())
                .padding(.horizontal, 8)
                .frame(height: 28)
                .background(PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8))
                .onSubmit { if let value = Self.parse(typed) { onPick(value) } }
                .accessibilityLabel("시각 적기")
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 1) {
                        ForEach(Array(stride(from: 0, to: 1440, by: 15)), id: \.self) { value in
                            Button { onPick(value) } label: {
                                Text(AppLanguage.current.clock(hour: value / 60, minute: value % 60))
                                    .font(.system(size: 13, weight: value == minutes ? .semibold : .regular).monospacedDigit())
                                    .foregroundStyle(value == minutes ? PaperTheme.sageText : PaperTheme.ink)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 8)
                                    .frame(height: 26)
                                    .background(value == minutes ? PaperTheme.sage2 : .clear, in: RoundedRectangle(cornerRadius: 6))
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .id(value)
                        }
                    }
                }
                .frame(height: 200)
                .onAppear { proxy.scrollTo(minutes / 15 * 15, anchor: .center) }
            }
        }
        .padding(8)
        .frame(width: 150)
        .background(PaperTheme.card)
    }

    /// "17:20", "1720", "5:20pm", "5 pm", "오후 5:20", "오후 5시", "17u20" → minutes after midnight.
    static func parse(_ text: String) -> Int? {
        let value = text.trimmingCharacters(in: .whitespaces).lowercased()
        let pattern = #"^(오전|오후)?\s*(\d{1,2})(?:[:.u시]\s*(\d{2})?)?\s*(분)?\s*(am|pm|a|p)?$"# // ko-only: Korean words the parser reads
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: value, range: NSRange(value.startIndex..., in: value)) else {
            // "1720"
            if value.count == 4, let number = Int(value), number / 100 < 24, number % 100 < 60 { return number / 100 * 60 + number % 100 }
            return nil
        }
        func group(_ index: Int) -> String? {
            Range(match.range(at: index), in: value).map { String(value[$0]) }
        }
        guard var hour = group(2).flatMap(Int.init) else { return nil }
        let minute = group(3).flatMap(Int.init) ?? 0
        let pm = group(1) == "오후" || group(5)?.hasPrefix("p") == true // ko-only: Korean words the parser reads
        let am = group(1) == "오전" || group(5)?.hasPrefix("a") == true // ko-only: Korean words the parser reads
        if pm && hour < 12 { hour += 12 }
        if am && hour == 12 { hour = 0 }
        guard hour < 24, minute < 60 else { return nil }
        return hour * 60 + minute
    }
}

/// A short list of choices (repeat, days).
private struct ChoiceList<Value: Hashable>: View {
    let choices: [Value]
    let selected: Value
    let title: (Value) -> String
    let onPick: (Value) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            ForEach(choices, id: \.self) { choice in
                Button { onPick(choice) } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "checkmark").font(.system(size: 10, weight: .bold))
                            .opacity(choice == selected ? 1 : 0)
                        Text(title(choice)).lineLimit(1)
                    }
                    .font(.system(size: 13, weight: choice == selected ? .semibold : .regular))
                    .foregroundStyle(choice == selected ? PaperTheme.sageText : PaperTheme.ink)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.horizontal, 8)
                    .frame(height: 26)
                    .background(choice == selected ? PaperTheme.sage2 : .clear, in: RoundedRectangle(cornerRadius: 6))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .padding(8)
        .frame(minWidth: 150)
        .fixedSize()
        .background(PaperTheme.card)
    }
}
