import PaperCore
import SwiftUI

/// A roomy month calendar in the paper style, replacing the tiny system picker.
/// Big day numbers, weekdays in the app's language (Sunday in the accent colour; Dutch weeks
/// start on Monday), today ringed, the choice
/// filled in sage, past days dimmed and disabled. For deadlines it also shades the span from
/// today to the chosen day, so "how long do I have" reads at a glance.
struct PaperCalendar: View {
    @Binding var selection: Date
    var minimum: Date = .distantPast
    var showsSpanFromToday = false
    /// The day ringed as today. Deadlines pass the 4 a.m. logical day, so at 1 a.m. it's still yesterday.
    var today: Date?
    /// Its own card and border; off inside a popover, which is the frame already.
    var framed = true

    @State private var month: Date

    private let language = AppLanguage.current
    private let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "ko_KR")
        calendar.firstWeekday = AppLanguage.current.weekStartsMonday ? 2 : 1
        return calendar
    }()
    private static let cellHeight: CGFloat = 34

    init(selection: Binding<Date>, minimum: Date = .distantPast, showsSpanFromToday: Bool = false, today: Date? = nil, framed: Bool = true) {
        _selection = selection
        self.framed = framed
        self.minimum = minimum
        self.showsSpanFromToday = showsSpanFromToday
        self.today = today
        _month = State(initialValue: selection.wrappedValue)
    }

    var body: some View {
        VStack(spacing: 8) {
            header
            HStack(spacing: 0) {
                ForEach(language.weekdayOrder, id: \.self) { weekday in
                    Text(language.weekdayShort(weekday))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(weekdayColor(weekday).opacity(0.85))
                        .frame(maxWidth: .infinity)
                }
            }
            VStack(spacing: 2) {
                ForEach(weeks, id: \.self) { week in
                    HStack(spacing: 0) {
                        ForEach(week, id: \.self) { day in
                            cell(day)
                        }
                    }
                }
            }
        }
        .padding(12)
        .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay { if framed { RoundedRectangle(cornerRadius: 12).strokeBorder(PaperTheme.rule, lineWidth: 1) } }
        .onChange(of: selection) { _, new in
            if !calendar.isDate(new, equalTo: month, toGranularity: .month) { month = new }
        }
    }

    private var header: some View {
        HStack(spacing: 6) {
            Text(language == .ko ? month.formatted(.dateTime.year().month(.wide).locale(Locale(identifier: "ko_KR")))
                 : language.monthTitle(year: calendar.component(.year, from: month), month: calendar.component(.month, from: month)))
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(PaperTheme.ink)
                .accessibilityAddTraits(.isHeader)
            Spacer()
            Button("오늘") {
                month = todayDate
                if todayDate >= startOfDay(minimum) { selection = keepingTime(of: selection, on: todayDate) }
            }
            .buttonStyle(.plain)
            .font(.system(size: 11.5, weight: .semibold))
            .foregroundStyle(PaperTheme.sageText)
            .padding(.horizontal, 9)
            .frame(height: 24)
            .background(PaperTheme.sage.opacity(0.1), in: Capsule())
            monthButton("chevron.left", offset: -1, label: L("이전 달"))
                .disabled(calendar.compare(month, to: minimum, toGranularity: .month) != .orderedDescending)
            monthButton("chevron.right", offset: 1, label: L("다음 달"))
        }
    }

    private func monthButton(_ symbol: String, offset: Int, label: String) -> some View {
        Button { month = calendar.date(byAdding: .month, value: offset, to: month) ?? month } label: {
            Image(systemName: symbol)
                .font(.system(size: 11, weight: .bold))
                .frame(width: 26, height: 24)
                .contentShape(Rectangle())
        }
        .buttonStyle(QuietButtonStyle(size: 26))
        .help(label)
        .accessibilityLabel(label)
    }

    /// Six rows of seven days; days outside the month are nil.
    private var weeks: [[Date?]] {
        guard let interval = calendar.dateInterval(of: .month, for: month) else { return [] }
        let first = interval.start
        let leading = (calendar.component(.weekday, from: first) - calendar.firstWeekday + 7) % 7
        let count = calendar.range(of: .day, in: .month, for: month)?.count ?? 30
        var days: [Date?] = Array(repeating: nil, count: leading)
        for offset in 0..<count { days.append(calendar.date(byAdding: .day, value: offset, to: first)) }
        while days.count % 7 != 0 { days.append(nil) }
        return stride(from: 0, to: days.count, by: 7).map { Array(days[$0..<$0 + 7]) }
    }

    @ViewBuilder
    private func cell(_ day: Date?) -> some View {
        if let day {
            let selected = calendar.isDate(day, inSameDayAs: selection)
            let today = calendar.isDate(day, inSameDayAs: todayDate)
            let disabled = day < startOfDay(minimum)
            let inSpan = showsSpanFromToday && !selected && day > startOfDay(todayDate) && day < selection
            let weekday = calendar.component(.weekday, from: day) - 1
            Button { selection = keepingTime(of: selection, on: day) } label: {
                Text("\(calendar.component(.day, from: day))")
                    .font(.system(size: 13.5, weight: selected || today ? .bold : .regular).monospacedDigit())
                    .foregroundStyle(selected ? PaperTheme.onSage : disabled ? PaperTheme.faint : weekdayColor(weekday))
                    .frame(width: 32, height: 30)
                    .background {
                        if selected {
                            Circle().fill(PaperTheme.sage)
                        } else if today {
                            Circle().strokeBorder(PaperTheme.ink.opacity(0.55), lineWidth: 1.2)
                        }
                    }
                    .frame(maxWidth: .infinity, minHeight: Self.cellHeight)
                    .background {
                        if inSpan { Rectangle().fill(PaperTheme.sage.opacity(0.1)).padding(.vertical, 3) }
                    }
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(disabled)
            .accessibilityLabel((language == .ko ? day.formatted(.dateTime.month().day().weekday(.wide).locale(Locale(identifier: "ko_KR")))
                                 : language.longDate(day, calendar: calendar)) + (today ? L(", 오늘") : ""))
            .accessibilityAddTraits(selected ? .isSelected : [])
        } else {
            Color.clear.frame(maxWidth: .infinity, minHeight: Self.cellHeight)
        }
    }

    private func weekdayColor(_ index: Int) -> Color {
        index == 0 ? PaperTheme.clayText : index == 6 ? PaperTheme.secondary : PaperTheme.ink
    }

    private func startOfDay(_ date: Date) -> Date { calendar.startOfDay(for: date) }
    private var todayDate: Date { today ?? Date() }

    /// Picking a day keeps the chosen time of day (for reminders).
    private func keepingTime(of time: Date, on day: Date) -> Date {
        let parts = calendar.dateComponents([.hour, .minute], from: time)
        return calendar.date(bySettingHour: parts.hour ?? 9, minute: parts.minute ?? 0, second: 0, of: day) ?? day
    }
}
