import PaperCore
import SwiftUI

/// The form's working copy of a recurrence: how often, which days, and the alert time.
struct RepeatDraft: Equatable {
    var kind: RepeatKind = .daily
    var weekdays: Set<Int>
    var monthDay: Int
    var alertOn = true
    var time: Date

    init(series: Series? = nil, now: Date = Date()) {
        let calendar = Calendar.current
        let today = Archive.logicalDayStart(now)
        kind = series?.rule.kind ?? .daily
        weekdays = Set(series?.rule.weekdays ?? [calendar.component(.weekday, from: today) - 1])
        monthDay = series?.rule.monthDay ?? calendar.component(.day, from: today)
        alertOn = series.map { $0.remindAt != nil } ?? true
        let parts = (series?.remindAt ?? "09:00").split(separator: ":").compactMap { Int($0) }
        time = calendar.date(bySettingHour: parts.first ?? 9, minute: parts.last ?? 0, second: 0, of: now) ?? now
    }

    var rule: RepeatRule {
        switch kind {
        case .weekly: RepeatRule(kind: .weekly, weekdays: weekdays.sorted())
        case .monthly: RepeatRule(kind: .monthly, monthDay: monthDay)
        default: RepeatRule(kind: kind)
        }
    }

    var remindAt: String? {
        guard alertOn else { return nil }
        let parts = Calendar.current.dateComponents([.hour, .minute], from: time)
        return String(format: "%02d:%02d", parts.hour ?? 9, parts.minute ?? 0)
    }

    var isValid: Bool { Repeat.isValid(rule) }
}

/// The shared "반복" form: 매일·평일·매주·매월, which days, the alert time, and a live summary.
/// Used by the row editor and by Settings → 반복.
struct RepeatFieldsView: View {
    @Binding var draft: RepeatDraft
    @State private var pickingTime = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PaperSegmented(selection: $draft.kind, options: RepeatKind.allCases.map { ($0, $0.title(.current), nil) }, label: L("반복 주기"))

            if draft.kind == .weekly {
                HStack(spacing: 5) {
                    ForEach([1, 2, 3, 4, 5, 6, 0], id: \.self) { day in
                        let on = draft.weekdays.contains(day)
                        Button {
                            if on { draft.weekdays.remove(day) } else { draft.weekdays.insert(day) }
                        } label: {
                            // The chip family: sage2 and a sage ring when picked.
                            SlipChip(title: AppLanguage.current.weekdayShort(day), selected: on, centered: true)
                                .frame(maxWidth: .infinity)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(AppLanguage.current.weekdayName(day))
                        .accessibilityAddTraits(on ? .isSelected : [])
                    }
                }
            }

            if draft.kind == .monthly {
                HStack(spacing: 8) {
                    Text("매월").font(.system(size: 12.5))
                    PaperMenuPicker(selection: $draft.monthDay,
                                    options: (1...31).map { ($0, AppLanguage.current == .ko ? "\($0)일" : "\($0)") }, // ko-only: the number alone in English and Dutch
                                    label: L("매월 날짜"))
                    Text("그 날이 없는 달은 마지막 날").font(.system(size: 11)).foregroundStyle(PaperTheme.secondary)
                }
            }

            HStack(spacing: 8) {
                Image(systemName: "bell").font(.system(size: 12, weight: .medium)).foregroundStyle(PaperTheme.sage)
                Text("알림").font(.system(size: 12.5))
                Spacer(minLength: 0)
                // A time chip with the 15-minute list (any time can be typed), as on the event sheet.
                Button { pickingTime = true } label: {
                    let parts = Calendar.current.dateComponents([.hour, .minute], from: draft.time)
                    Text(AppLanguage.current.spokenTime(hour: parts.hour ?? 9, minute: parts.minute ?? 0))
                        .font(.system(size: 13, weight: .semibold).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, 10)
                        .frame(height: 26)
                        .background(pickingTime ? PaperTheme.raised : PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay {
                            if pickingTime { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) }
                        }
                        .contentShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .accessibilityLabel(L("알림 시각"))
                .popover(isPresented: $pickingTime, arrowEdge: .bottom) {
                    let parts = Calendar.current.dateComponents([.hour, .minute], from: draft.time)
                    TimePickerList(minutes: (parts.hour ?? 9) * 60 + (parts.minute ?? 0)) { minutes in
                        draft.time = Calendar.current.date(bySettingHour: minutes / 60, minute: minutes % 60, second: 0, of: draft.time) ?? draft.time
                        pickingTime = false
                    }
                }
                .disabled(!draft.alertOn)
                .opacity(draft.alertOn ? 1 : 0.5)
                Toggle("반복 알림", isOn: $draft.alertOn)
                    .toggleStyle(PaperToggleStyle(small: true))
                    .labelsHidden()
            }
            .padding(.horizontal, 10)
            .frame(height: 38)
            .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 10))
            .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(PaperTheme.rule, lineWidth: 1) }

            summary
        }
    }

    private var summary: some View {
        let rule = draft.rule
        let valid = draft.isValid
        let today = Archive.logicalDayStart(Date())
        let next = valid ? Repeat.nextOccurrence(rule, from: Date()) : nil
        let calendar = Calendar.current
        return HStack(alignment: .top, spacing: 10) {
            Image(systemName: "repeat").font(.system(size: 13, weight: .semibold)).foregroundStyle(PaperTheme.sage).frame(width: 18, height: 22)
            VStack(alignment: .leading, spacing: 3) {
                Text("반복").font(.system(size: 11, weight: .semibold)).foregroundStyle(PaperTheme.secondary)
                Text(valid ? Repeat.describe(rule, remindAt: draft.remindAt, language: .current) : L("요일을 하나 이상 골라 주세요"))
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(valid ? PaperTheme.ink : PaperTheme.clayText)
                if let next {
                    Text(next == today ? L("오늘부터 목록에 나타나요")
                         : L("다음: \(AppLanguage.current.shortDate(next, calendar: calendar))부터 나타나요"))
                        .font(.system(size: 11))
                        .foregroundStyle(PaperTheme.secondary)
                }
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 10))
        .overlay { RoundedRectangle(cornerRadius: 10).strokeBorder(PaperTheme.rule, lineWidth: 1) }
    }
}

/// A full-width segmented control in the paper style (the system one keeps its compact width on macOS).
struct PaperSegmented<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(value: Value, title: String, symbol: String?)]
    let label: String

    var body: some View {
        HStack(spacing: 2) {
            ForEach(options, id: \.value) { option in
                let selected = option.value == selection
                Button { selection = option.value } label: {
                    HStack(spacing: 5) {
                        if let symbol = option.symbol { Image(systemName: symbol).font(.system(size: 11, weight: .medium)) }
                        Text(option.title).font(.system(size: 12.5, weight: selected ? .semibold : .regular))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .foregroundStyle(selected ? PaperTheme.sage : PaperTheme.ink2)
                    .frame(maxWidth: .infinity, minHeight: 28)
                    .background {
                        if selected {
                            RoundedRectangle(cornerRadius: 6, style: .continuous).fill(PaperTheme.raised)
                                .shadow(color: PaperTheme.shadow.opacity(0.14), radius: 1, y: 1)
                        }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(selected ? .isSelected : [])
            }
        }
        .padding(2)
        .background(PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PaperTheme.rule, lineWidth: 1) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }
}
