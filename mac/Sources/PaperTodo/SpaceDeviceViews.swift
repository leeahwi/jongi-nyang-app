import AppKit
import PaperCore
import SwiftUI

// MARK: - 기기마다 보일 스페이스 on screen (#196, docs/plans/spaces-device.md §4, the chosen mock spaces-device-mock-2.png)

private typealias Words = SpaceDevice.Words

/// The small mark on a space's colour dot: an eye struck through (hidden on this Mac), a clock (time rule, shown or not).
struct SpaceDeviceMark: View {
    let rule: SpaceDevice.Rule?
    var size: CGFloat = 11

    var body: some View {
        switch rule {
        case nil: EmptyView()
        case .hide: mark("eye.slash", PaperTheme.clayText)
        case .times: mark("clock", PaperTheme.sageText)
        }
    }

    private func mark(_ symbol: String, _ color: Color) -> some View {
        Image(systemName: symbol)
            .font(.system(size: size * 0.62, weight: .bold))
            .foregroundStyle(color)
            .frame(width: size, height: size)
            .background(PaperTheme.card, in: Circle())
            .offset(x: size * 0.45, y: size * 0.45)
            .accessibilityHidden(true)
    }
}

/// The desk row's line under the name: none for 보이기, ‘이 기기에서 숨겨 뒀어요’, or ‘평일 09:00–18:00에만 · 지금 보여요’
/// (drawn again when what is hidden changes, on the minute).
struct SpaceDeviceStatus: View {
    @ObservedObject var model: AppModel
    let key: String

    var body: some View {
        let rule = model.deviceRule(key)
        if let text = SpaceDevice.status(rule, hiddenNow: model.isHiddenHere(key), .current) {
            Text(text)
                .font(.system(size: 11))
                .foregroundStyle(rule == .hide ? PaperTheme.clayText : PaperTheme.sageText)
                .lineLimit(1)
                .truncationMode(.tail)
        }
    }
}

/// The desk row's popup at the right: 보이기 · 숨기기 · 시간 정하기…, its button the state's mark and ▾. A system menu,
/// so Tab reaches it and Space opens it; a screen reader hears "회사, 이 기기에서: 숨기기".
struct SpaceDevicePopup: View {
    @ObservedObject var model: AppModel
    let key: String
    let name: String
    let color: TodoSpaces.Color?

    var body: some View {
        let rule = model.deviceRule(key)
        let language = AppLanguage.current
        Menu {
            Toggle(isOn: Binding(get: { rule == nil }, set: { _ in model.setDeviceRule(key, nil) })) {
                Label(Words.show.text(language), systemImage: "eye")
            }
            Toggle(isOn: Binding(get: { rule == .hide }, set: { _ in model.setDeviceRule(key, .hide) })) {
                Label(Words.hide.text(language), systemImage: "eye.slash")
            }
            Divider()
            Toggle(isOn: Binding(get: { if case .times = rule { true } else { false } },
                                 set: { _ in SpaceTimesSlip.present(model: model, key: key, name: name, color: color) })) {
                Label(Words.setTimes.text(language), systemImage: "clock")
            }
        } label: {
            Image(systemName: rule == nil ? "eye" : rule == .hide ? "eye.slash" : "clock")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.visible)
        .fixedSize()
        .tint(rule == nil ? PaperTheme.ink2 : rule == .hide ? PaperTheme.clayText : PaperTheme.sageText)
        .padding(.horizontal, 4)
        .frame(height: 22)
        .background(PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        .help(Words.onThisDevice.text(language))
        .accessibilityLabel(SpaceDevice.popupLabel(name, rule: rule, language))
    }
}

/// 시간 정하기 (§4): 바로 고르기 chips, the time ranges (days, start – end, ×), + 시간 더하기, the summary with what it means
/// now, and 취소 · 저장 ↩ (Esc cancels). Applied on 저장.
struct SpaceTimesSlip: View {
    let title: String
    let color: TodoSpaces.Color?
    @State var rows: [SpaceDevice.Times]
    var previewNow: Date?
    var onDone: ([SpaceDevice.Times]?) -> Void = { _ in }

    static let width = SlipWidth.large.rawValue

    /// Opens the slip for a space (`none`: 일반) over the window in front; 저장 sets its times.
    static func present(model: AppModel, key: String, name: String, color: TodoSpaces.Color?) {
        let start: [SpaceDevice.Times]
        if case .times(let times) = model.deviceRule(key), !times.isEmpty { start = times } else { start = SpaceDevice.Preset.workday.times }
        let title = SpaceDevice.slipTitle(name, .current)
        SlipAlert.present(title: title) { done in
            SpaceTimesSlip(title: title, color: color, rows: start) { picked in
                if let picked { model.setDeviceRule(key, .times(picked)) }
                done()
            }
        }
    }

    private var language: AppLanguage { .current }
    private var valid: Bool { !rows.isEmpty && rows.allSatisfy { !$0.days.isEmpty } }

    var body: some View {
        PaperSlip(kind: .confirm, width: Self.width) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .confirm, symbol: "clock", title: title)
                VStack(alignment: .leading, spacing: 10) {
                    Text(Words.slipNote.text(language))
                        .font(.system(size: 12))
                        .foregroundStyle(PaperTheme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    presets
                    VStack(spacing: 0) {
                        ForEach(Array(rows.indices), id: \.self) { index in
                            row(index)
                            Rectangle().fill(PaperTheme.rule).frame(height: 1)
                        }
                    }
                    .overlay(alignment: .top) { Rectangle().fill(PaperTheme.rule).frame(height: 1) }
                    Button {
                        rows.append(rows.last ?? SpaceDevice.Preset.workday.times[0])
                    } label: {
                        Label(Words.addTime.text(language), systemImage: "plus")
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(PaperTheme.sageText)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(rows.count >= SpaceDevice.maxTimes)
                    summary
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 4)
                SlipFooter {
                    Button("") { onDone(nil) }
                        .keyboardShortcut(.cancelAction)
                        .opacity(0)
                        .frame(width: 0, height: 0)
                        .accessibilityHidden(true)
                } trailing: {
                    HStack(spacing: 6) {
                        Button(L("취소")) { onDone(nil) }.buttonStyle(SlipButtonStyle(role: .ghost))
                        Button(L("저장")) { onDone(rows) }
                            .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
                            .keyboardShortcut(.defaultAction)
                            .disabled(!valid)
                    }
                }
            }
        }
    }

    /// 바로 고르기: each fills the rows in, to change after.
    private var presets: some View {
        HStack(spacing: 6) {
            ForEach(SpaceDevice.Preset.allCases, id: \.self) { preset in
                Button { rows = preset.times } label: {
                    SlipChip(title: preset.title(language), selected: rows == preset.times)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(rows == preset.times ? .isSelected : [])
            }
            Spacer(minLength: 0)
        }
    }

    private func row(_ index: Int) -> some View {
        let range = rows[index]
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                ForEach(1...7, id: \.self) { day in dayChip(index, day) }
                    .overlay {
                        if range.days.isEmpty {
                            RoundedRectangle(cornerRadius: 9, style: .continuous).strokeBorder(PaperTheme.clay, lineWidth: 1.5).padding(-3)
                        }
                    }
                Spacer(minLength: 8)
                Button { rows.remove(at: index) } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(PaperTheme.ink3)
                        .frame(width: 22, height: 22)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(Words.removeTime.text(language))
                .accessibilityLabel(Words.removeTime.text(language))
            }
            HStack(spacing: 6) {
                SpaceTimeButton(minutes: Binding(get: { rows[safe: index]?.from ?? 0 }, set: { set(index, from: $0) }), label: Words.start.text(language))
                Text("–").foregroundStyle(PaperTheme.ink3).accessibilityHidden(true)
                SpaceTimeButton(minutes: Binding(get: { rows[safe: index]?.to ?? 0 }, set: { set(index, to: $0) }), label: Words.end.text(language))
                if range.wholeDay {
                    Text(Words.wholeDay.text(language)).font(.system(size: 11)).foregroundStyle(PaperTheme.ink3)
                } else if range.crossesMidnight {
                    Text(Words.nextDay.text(language)).font(.system(size: 11)).foregroundStyle(PaperTheme.ink3)
                }
                Spacer(minLength: 0)
            }
        }
        .padding(.vertical, 8)
    }

    private func dayChip(_ index: Int, _ day: Int) -> some View {
        let on = rows[index].days.contains(day)
        return Button {
            var days = rows[index].days
            if on { days.removeAll { $0 == day } } else { days.append(day) }
            rows[index] = SpaceDevice.Times(days: days, from: rows[index].from, to: rows[index].to)
        } label: {
            SlipChip(title: SpaceDevice.dayName(day, language), selected: on, centered: true)
                .frame(width: language == .ko ? 28 : 36)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SpaceDevice.dayName(day, language))
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func set(_ index: Int, from: Int? = nil, to: Int? = nil) {
        guard rows.indices.contains(index) else { return }
        rows[index] = SpaceDevice.Times(days: rows[index].days, from: from ?? rows[index].from, to: to ?? rows[index].to)
    }

    /// ‘평일 09:00–12:00, 13:00–18:00 · 토 10:00–14:00에만 보여요.’ and ‘지금(화 20:10)은 숨어 있어요’, on the minute.
    private var summary: some View {
        TimelineView(.everyMinute) { context in
            let now = previewNow ?? context.date
            let usable = rows.filter { !$0.days.isEmpty }
            VStack(alignment: .leading, spacing: 3) {
                if !usable.isEmpty {
                    Text(SpaceDevice.sentence(usable, language) + (language == .ko ? "." : ""))
                        .font(.system(size: 12, weight: .semibold))
                    Text(SpaceDevice.nowLine(showing: SpaceDevice.Rule.times(usable).shows(day: SpaceDevice.moment(now).day, minute: SpaceDevice.moment(now).minute),
                                             at: now, language))
                        .font(.system(size: 11.5))
                        .opacity(0.85)
                }
                if rows.contains(where: \.days.isEmpty) {
                    Text(Words.noDays.text(language)).font(.system(size: 11.5)).foregroundStyle(PaperTheme.clayText)
                }
            }
            .foregroundStyle(PaperTheme.sageText)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(PaperTheme.sage2, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            .accessibilityElement(children: .combine)
        }
    }
}

/// A time in the slip: the app's clock on a paper button; a click opens the 15-minute list with a field for any time.
private struct SpaceTimeButton: View {
    @Binding var minutes: Int
    let label: String
    @State private var picking = false

    var body: some View {
        Button { picking = true } label: {
            Text(AppLanguage.current.clock(hour: minutes / 60, minute: minutes % 60))
                .font(.system(size: 13, weight: .semibold).monospacedDigit())
                .foregroundStyle(PaperTheme.ink)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 10)
                .frame(height: 26)
                .background(picking ? PaperTheme.raised : PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                .overlay { if picking { RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) } }
                .contentShape(RoundedRectangle(cornerRadius: 7))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label + ", " + AppLanguage.current.clock(hour: minutes / 60, minute: minutes % 60))
        .popover(isPresented: $picking, arrowEdge: .bottom) {
            TimePickerList(minutes: minutes) { value in
                minutes = value
                picking = false
            }
        }
    }
}

/// D9 · D6: at the end of a list, ‘회사는 이 기기에서 숨겨 뒀어요 · 잠깐 보기’ and ‘회사를 잠깐 보는 중 · 다시 숨기기’ — G7's look
/// (small, ink-3, the button ink-2 and bold, one ruled row each).
struct SpaceDeviceLine: View {
    @ObservedObject var model: AppModel
    let line: (hidden: [String], peeking: [String])
    var leading: CGFloat = PaperTheme.margin + 17

    var body: some View {
        let language = AppLanguage.current
        VStack(spacing: 0) {
            if !line.hidden.isEmpty {
                row(symbol: "eye.slash", text: SpaceDevice.line(model.deviceNames(line.hidden), language), button: SpaceDevice.peekWord(language)) {
                    model.peekHidden(line.hidden)
                }
            }
            if !line.peeking.isEmpty {
                row(symbol: "eye", text: SpaceDevice.peeking(model.deviceNames(line.peeking), language), button: SpaceDevice.hideAgainWord(language)) {
                    model.hideAgain()
                }
            }
        }
    }

    private func row(symbol: String, text: String, button: String, action: @escaping () -> Void) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Image(systemName: symbol).font(.system(size: 9.5, weight: .semibold)).foregroundStyle(PaperTheme.ink3).accessibilityHidden(true)
            // Never cut (nl on a narrow note): the words take a second line, the button stays with them.
            Text(text + "  ·  ").foregroundStyle(PaperTheme.ink3)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Button(action: action) {
                Text(button).fontWeight(.semibold).foregroundStyle(PaperTheme.ink2).fixedSize().contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .layoutPriority(1)
        }
        .font(.system(size: 11))
        .padding(.leading, leading)
        .padding(.trailing, 16)
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, minHeight: PaperTheme.rowHeight, alignment: .leading)
        .overlay(alignment: .bottom) {
            Rectangle().fill(PaperTheme.rule).frame(height: 0.6).padding(.leading, 18).padding(.trailing, 20).accessibilityHidden(true)
        }
        .accessibilityElement(children: .contain)
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
