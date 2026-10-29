import PaperCore
import SwiftUI

/// Sequential sage ramp, validated: lightness steps monotonically from the paper toward ink, and
/// the first step stands out from the paper (day 2.13:1), so "one completion" never disappears
/// into the page. At night the ramp runs the other way: more done = brighter sage.
enum HeatColor {
    static let levels: [Color] = [
        PaperTheme.token("#ebe9e0", night: "#3a3933"), // nothing
        PaperTheme.token("#9db48f", night: "#4c6347"), // 1
        PaperTheme.token("#86a278", night: "#668561"), // 2–3
        PaperTheme.token("#627f55", night: "#87a981"), // 4–5
        PaperTheme.token("#3e5a33", night: "#b2d1a9"), // 6+
    ]
}

/// A GitHub-style year of completions, monthly totals and what was finished on a chosen day.
struct HistoryView: View {
    /// What it shows changes with the archive's revision (#62): not with every change to the model, which it doesn't
    /// watch — only its 검색 → 완료 기록 day and the notebook's font.
    @ObservedObject var archive: ArchiveStore
    let model: AppModel
    var now: () -> Date = Date.init

    @State private var range: HistoryRange = .recent
    @State private var selectedKey = Archive.dayKey(Date())
    @State private var font: NotebookFont

    init(archive: ArchiveStore, model: AppModel, now: @escaping () -> Date = Date.init) {
        self.archive = archive
        self.model = model
        self.now = now
        _font = State(initialValue: model.notebookFont)
    }

    private let calendar = Calendar.current
    private let language = AppLanguage.current
    fileprivate static let gap: CGFloat = 3
    /// The heatmap card's inner width: the squares grow or shrink with the pane (7…12 pt).
    @State private var heatWidth: CGFloat = 600
    /// The summary row's width: five tiles in a row, or 3 + 2 when narrow (the two wider, so no cell is left empty).
    @State private var summaryWidth: CGFloat = 700

    private func takeHistoryDay() {
        guard let day = model.historyDay else { return }
        model.historyDay = nil
        selectedKey = day
        if let date = Deadline.date(from: day), !range.bounds(today: now(), calendar: calendar).contains(date) {
            range = .year(calendar.component(.year, from: date))
        }
    }

    var body: some View {
        let _ = PerfProbe.count("historyBody")
        let (entries, days) = archive.history()
        let today = now()
        let bounds = range.bounds(today: today, calendar: calendar)
        // 집중 (1.37): focus.jsonl beside the record — the minutes per day over the range.
        let focus = model.focusLog.records()
        let focusDays = Focus.totals(focus, from: bounds.lowerBound, to: bounds.upperBound)
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                header(entries: entries, days: days)
                summary(days: days, bounds: bounds, today: today, focus: focus)
                heatmap(days: days, bounds: bounds, today: today, focusDays: focusDays,
                        longest: Focus.byTask(focus, from: bounds.lowerBound, to: bounds.upperBound))
                HStack(alignment: .top, spacing: 14) {
                    monthBars(days: days, bounds: bounds, today: today)
                    dayPanel(days: days, today: today, focus: focus).frame(width: 290)
                }
                footer(entries: entries)
            }
            .padding(.horizontal, DeskMetrics.gutter - 4)
            .padding(.top, DeskMetrics.top)
            .padding(.bottom, 20)
        }
        .scrollEdgeFade()
        .foregroundStyle(PaperTheme.ink)
        // 검색 → 완료 기록: that day picked (and the whole year shown when it's older).
        .onAppear(perform: takeHistoryDay)
        .onReceive(model.$historyDay.receive(on: DispatchQueue.main)) { _ in takeHistoryDay() }
        .onReceive(model.$notebookFont) { font = $0 }
    }

    // MARK: Header

    /// The pane's header: a word about the streak (or, before the first, how to start), and the range. (1.45: no
    /// "지금까지 564개를 끝냈어요" — the first tile says that number.)
    private func header(entries: [ArchiveEntry], days: [String: [ArchiveEntry]]) -> some View {
        let years = Set(days.keys.compactMap { Int($0.prefix(4)) }).sorted(by: >)
        let total = entries.filter { $0.completedAt != nil }.count
        let streak = Archive.currentStreak(Set(days.keys), today: now())
        let word = streak > 1 ? L("\(streak)일째 이어 가고 있어요. 오늘도 한 칸!")
            : streak == 1 ? L("오늘도 한 칸 채웠어요. 내일도 이어 가 봐요.")
            : L("하나만 끝내도 오늘 칸이 초록으로 채워져요.")
        let line = total == 0 ? L("첫 칸을 채워 볼까요?") + " · " + word : word
        return DeskPaneHeader(title: L("완료 기록"), subtitle: line) {
            PaperSegmented(selection: $range, options: ([HistoryRange.recent] + years.map(HistoryRange.year)).map { ($0, $0.title, nil) },
                           label: L("기간"))
                .frame(width: CGFloat(min(4, years.count + 1)) * (language == .ko ? 78 : 100))
        }
    }

    // MARK: Summary

    private func summary(days: [String: [ArchiveEntry]], bounds: ClosedRange<Date>, today: Date, focus: [FocusRecord]) -> some View {
        let focused = Focus.sum(focus, from: bounds.lowerBound, to: bounds.upperBound)
        var total = 0
        var best: (key: String, value: Int) = ("", 0)
        forEachDay(in: bounds) { date in
            let key = Archive.dayKey(date)
            let value = days[key]?.count ?? 0
            total += value
            if value > best.value { best = (key, value) }
        }
        let dayCount = max(1, (calendar.dateComponents([.day], from: bounds.lowerBound, to: bounds.upperBound).day ?? 0) + 1)
        let thisMonth = monthTotal(days: days, offset: 0, today: today)
        // Last month's number only, no 적어요 / 많아요 (#42).
        let lastMonth = monthTotal(days: days, offset: -1, today: today)
        let keys = Set(days.keys)
        let month = calendar.component(.month, from: Archive.logicalDayStart(today))
        let point = String(format: "%.1f", Double(total) / Double(dayCount))
        let average = language == .nl ? point.replacingOccurrences(of: ".", with: ",") : point
        let streak = Archive.currentStreak(keys, today: today), longest = Archive.longestStreak(keys)
        let tiles: [AnyView] = [
            // "%@ 완료" is also a to-do's checkbox ("Mark … done"): this one has its own table.
            AnyView(SummaryTile(symbol: "checkmark", label: range == .recent ? L("최근 1년 완료") : String(localized: "\(range.title) 완료", table: "History"), value: total.formatted(), unit: L("개"),
                        detail: L("하루 평균 \(average)개"))),
            AnyView(SummaryTile(symbol: "calendar", label: String(localized: "\(language.monthName(month)) 완료", table: "History"), value: "\(thisMonth)", unit: L("개"),
                        detail: L("지난달 \(lastMonth)개"))),
            // "일", "day" / "days", "dag" / "dagen": the core's day count without its number.
            AnyView(SummaryTile(symbol: "flame", label: L("연속 기록"), value: "\(streak)",
                        unit: String(language.days(streak).drop(while: \.isNumber)).trimmingCharacters(in: .whitespaces),
                        detail: L("최장 \(longest)일"))),
            AnyView(SummaryTile(symbol: "star", label: L("가장 많이 한 날"), value: "\(best.value)", unit: L("개"),
                        detail: best.value > 0 ? longDate(best.key) : L("아직 없어요"))),
            // 집중: the range's focus time and sessions (focus.jsonl).
            // ko "79번 집중", not a bare "79번".
            AnyView(SummaryTile(symbol: "timer", label: L("집중"), value: "", unit: "",
                        detail: language == .ko ? "\(focused.sessions)번 집중" : Focus.sessionsText(focused.sessions, language: language), // ko-only: the Korean count with its noun
                        parts: Self.lengthParts(focused.minutes, language: language))),
        ]
        // One row when the pane is wide enough for every tile's lines; otherwise 3 + 2, so a narrow
        // tile never breaks a line inside a word ("25개", "fewer").
        let oneRow = summaryWidth >= (language == .ko ? 150 : 176) * CGFloat(tiles.count) + 10 * CGFloat(tiles.count - 1)
        return Group {
            if oneRow {
                HStack(spacing: 10) { ForEach(tiles.indices, id: \.self) { tiles[$0] } }
            } else {
                // 3 + 2 on six columns (1.45): the first row's tiles two columns each, the second row's three, so both
                // rows end at the same edge and none is left empty.
                Grid(horizontalSpacing: 10, verticalSpacing: 10) {
                    GridRow { ForEach(0..<3, id: \.self) { tiles[$0].gridCellColumns(2) } }
                        .fixedSize(horizontal: false, vertical: true)
                    GridRow { ForEach(3..<tiles.count, id: \.self) { tiles[$0].gridCellColumns(3) } }
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { summaryWidth = $0 }
        // Every tile as tall as the tallest (a label or a line may wrap in English and Dutch).
        .fixedSize(horizontal: false, vertical: true)
    }

    private func monthTotal(days: [String: [ArchiveEntry]], offset: Int, today: Date) -> Int {
        let base = Archive.logicalDayStart(today)
        guard let month = calendar.date(byAdding: .month, value: offset, to: base),
              let interval = calendar.dateInterval(of: .month, for: month) else { return 0 }
        var sum = 0
        forEachDay(in: interval.start...interval.end.addingTimeInterval(-1)) { sum += days[Archive.dayKey($0)]?.count ?? 0 }
        return sum
    }

    // MARK: Heatmap

    private func heatmap(days: [String: [ArchiveEntry]], bounds: ClosedRange<Date>, today: Date, focusDays: [String: Int], longest: [Focus.TaskTotal]) -> some View {
        let columns = weekColumns(bounds: bounds)
        let todayKey = Archive.dayKey(today)
        let lastDay = Archive.logicalDayStart(today)
        // 24 pt of weekday names and a 4 pt gap on the left, then one column per week.
        let cell = max(7, min(12, ((heatWidth - 28) / CGFloat(max(1, columns.count)) - Self.gap).rounded(.down)))
        let step = cell + Self.gap
        return Card {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("날마다 완료한 일").font(.system(size: 12, weight: .semibold)).foregroundStyle(PaperTheme.secondary)
                Text("칸을 누르면 그날 한 일을 볼 수 있어요").font(.system(size: 11)).foregroundStyle(PaperTheme.faded)
            }
            .padding(.bottom, 10)
            HStack(alignment: .top, spacing: 4) {
                VStack(alignment: .trailing, spacing: Self.gap) {
                    Color.clear.frame(width: 24, height: 16)
                    ForEach(0..<7, id: \.self) { row in
                        Text(row % 2 == 1 ? language.weekdayShort(row) : "").font(.system(size: 9.5))
                            .foregroundStyle(PaperTheme.secondary).frame(width: 24, height: cell, alignment: .trailing)
                    }
                }
                VStack(alignment: .leading, spacing: 0) {
                    ZStack(alignment: .topLeading) {
                        ForEach(monthLabels(columns: columns), id: \.column) { label in
                            Text(label.title).font(.system(size: 10)).foregroundStyle(PaperTheme.secondary)
                                .fixedSize().offset(x: CGFloat(label.column) * step)
                        }
                    }
                    .frame(height: 16, alignment: .topLeading)
                    .accessibilityHidden(true)
                    HStack(alignment: .top, spacing: Self.gap) {
                        ForEach(Array(columns.enumerated()), id: \.offset) { _, week in
                            VStack(spacing: Self.gap) {
                                ForEach(week, id: \.self) { date in
                                    dayCell(date: date, days: days, bounds: bounds, todayKey: todayKey, lastDay: lastDay, cell: cell, focusMinutes: focusDays[Archive.dayKey(date)] ?? 0)
                                }
                            }
                        }
                    }
                }
            }
            // The card's width decides the squares, never the other way round.
            .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { heatWidth = $0 }
            HStack {
                Text("하루는 새벽 4시에 바뀌어요")
                Spacer()
                Text("적음")
                ForEach(0..<5, id: \.self) { level in
                    RoundedRectangle(cornerRadius: 2.5).fill(HeatColor.levels[level])
                        .frame(width: cell, height: cell)
                        .help(Archive.heatLevelTitles(language)[level])
                }
                Text("많음")
            }
            .font(.system(size: 10.5))
            .foregroundStyle(PaperTheme.secondary)
            .padding(.top, 10)
            longestFocus(longest)
        }
    }

    @ViewBuilder
    private func dayCell(date: Date, days: [String: [ArchiveEntry]], bounds: ClosedRange<Date>, todayKey: String, lastDay: Date, cell: CGFloat, focusMinutes: Int) -> some View {
        let key = Archive.dayKey(date)
        let outside = !bounds.contains(date)
        let future = !outside && date > lastDay.addingTimeInterval(86_400)
        if outside {
            Color.clear.frame(width: cell, height: cell)
        } else if future {
            RoundedRectangle(cornerRadius: 2.5).strokeBorder(PaperTheme.rule, lineWidth: 0.8).frame(width: cell, height: cell)
        } else {
            let focusNote = focusMinutes > 0 ? " · " + L("집중 \(Focus.lengthText(focusMinutes, language: .current))") : ""
            let count = days[key]?.count ?? 0
            HeatCell(count: count, cell: cell, selected: key == selectedKey, today: key == todayKey,
                     help: L("\(count)개 완료 · \(shortDate(key))") + focusNote,
                     label: L("\(longDate(key)), \(count)개 완료") + focusNote) { selectedKey = key }
        }
    }

    /// Sunday-first weeks covering the range, like GitHub.
    private func weekColumns(bounds: ClosedRange<Date>) -> [[Date]] {
        let weekday = calendar.component(.weekday, from: bounds.lowerBound) - 1
        var cursor = calendar.date(byAdding: .day, value: -weekday, to: bounds.lowerBound)!
        var columns: [[Date]] = []
        while cursor <= bounds.upperBound {
            columns.append((0..<7).map { calendar.date(byAdding: .day, value: $0, to: cursor)! })
            cursor = calendar.date(byAdding: .day, value: 7, to: cursor)!
        }
        return columns
    }

    private func monthLabels(columns: [[Date]]) -> [(column: Int, title: String)] {
        var labels: [(Int, String)] = []
        var lastMonth = -1
        for (index, week) in columns.enumerated() where index < columns.count - 1 {
            let first = week[0]
            let month = calendar.component(.month, from: first)
            if month != lastMonth && calendar.component(.day, from: first) <= 7 {
                labels.append((index, language.monthShort(month)))
                lastMonth = month
            }
        }
        return labels
    }

    // MARK: Month bars

    private func monthBars(days: [String: [ArchiveEntry]], bounds: ClosedRange<Date>, today: Date) -> some View {
        let endMonth = calendar.dateInterval(of: .month, for: bounds.upperBound)!.start
        let buckets: [(date: Date, value: Int)] = (0..<12).map { index in
            let month = calendar.date(byAdding: .month, value: index - 11, to: endMonth)!
            let interval = calendar.dateInterval(of: .month, for: month)!
            var value = 0
            forEachDay(in: interval.start...interval.end.addingTimeInterval(-1)) { date in
                if bounds.contains(date) { value += days[Archive.dayKey(date)]?.count ?? 0 }
            }
            return (month, value)
        }
        let maximum = max(1, buckets.map(\.value).max() ?? 1)
        let peakIndex = buckets.indices.max { buckets[$0].value < buckets[$1].value }
        let currentMonth = calendar.dateInterval(of: .month, for: Archive.logicalDayStart(today))!.start
        return Card {
            Text("월별 완료").font(.system(size: 12, weight: .semibold)).foregroundStyle(PaperTheme.secondary)
            HStack(alignment: .bottom, spacing: 6) {
                ForEach(buckets.indices, id: \.self) { index in
                    let bucket = buckets[index]
                    let current = bucket.date == currentMonth
                    let height = CGFloat(bucket.value) / CGFloat(maximum) * 112
                    VStack(spacing: 5) {
                        // Direct labels only where they earn it: the peak month and this month.
                        Text((index == peakIndex && bucket.value > 0) || current ? "\(bucket.value)" : " ")
                            .font(.system(size: 10.5, weight: .semibold).monospacedDigit())
                        // Lighter bars with this month in the deepest green, so the eye lands on now.
                        UnevenRoundedRectangle(topLeadingRadius: bucket.value > 0 ? 6 : 1, topTrailingRadius: bucket.value > 0 ? 6 : 1)
                            .fill(bucket.value == 0 ? HeatColor.levels[0] : current ? HeatColor.levels[4] : HeatColor.levels[2])
                            .frame(maxWidth: 20)
                            .frame(height: bucket.value == 0 ? 2 : max(3, height))
                        Text(language.monthShort(calendar.component(.month, from: bucket.date)))
                            .font(.system(size: 10, weight: current ? .semibold : .regular))
                            .foregroundStyle(current ? PaperTheme.ink : PaperTheme.secondary)
                    }
                    .frame(maxWidth: .infinity)
                    .help(L("\(bucket.value)개 완료 · \(monthTitle(bucket.date))"))
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(monthTitle(bucket.date)) \(bucket.value)개")
                }
            }
            .frame(height: 150, alignment: .bottom)
            .overlay(alignment: .bottom) {
                // A faint baseline under the bars, above the month names.
                Rectangle().fill(PaperTheme.rule).frame(height: 0.7).padding(.bottom, 19)
            }
            .padding(.top, 6)
        }
    }

    // MARK: Selected day

    private func dayPanel(days: [String: [ArchiveEntry]], today: Date, focus: [FocusRecord]) -> some View {
        let list = days[selectedKey] ?? []
        let day = date(for: selectedKey)
        let focused = Focus.sum(focus, from: day, to: day)
        return Card {
            HStack(alignment: .firstTextBaseline) {
                // The app's words (the date) in the UI type; handwriting is for what you wrote.
                Text(longDate(selectedKey)).font(.system(size: 15, weight: .semibold))
                Spacer()
                Text("\(list.count)개")
                    .font(.system(size: 11, weight: .bold).monospacedDigit())
                    .foregroundStyle(PaperTheme.ink.opacity(0.7))
                    .padding(.horizontal, 8)
                    .frame(height: 20)
                    .background(PaperTheme.sage2, in: Capsule())
            }
            .padding(.bottom, 4)
            if focused.sessions > 0 {
                HStack(spacing: 6) {
                    Image(systemName: "timer").font(.system(size: 10, weight: .semibold)).foregroundStyle(PaperTheme.clay)
                    Text(Focus.summaryText(minutes: focused.minutes, sessions: focused.sessions, language: language))
                        .font(.system(size: 11.5, weight: .medium).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink2)
                        .lineLimit(1)
                }
                .padding(.bottom, 6)
                .accessibilityElement(children: .combine)
            }
            if list.isEmpty {
                VStack(spacing: 6) {
                    Image(nsImage: PetArt.image(.sleep) ?? model.mascotImage)
                        .resizable().scaledToFit().frame(width: 64, height: 64).opacity(0.9)
                        .accessibilityHidden(true)
                    Text(selectedKey == Archive.dayKey(today) ? L("오늘은 아직 완료한 일이 없어요.\n하나만 끝내도 칸이 채워져요.") : L("이 날은 쉬어 갔어요."))
                        .font(.system(size: 12))
                        .foregroundStyle(PaperTheme.secondary)
                        .multilineTextAlignment(.center)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            } else {
                ScrollView {
                    VStack(spacing: 0) {
                        ForEach(list, id: \.id) { entry in
                            HStack(spacing: 8) {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 7.5, weight: .heavy))
                                    .foregroundStyle(PaperTheme.onSage)
                                    .frame(width: 15, height: 15)
                                    .background(PaperTheme.sage.opacity(0.85), in: Circle())
                                Text(entry.title.handwritten).font(font.bodyFont(.small)).lineLimit(1).help(entry.title)
                                Spacer(minLength: 4)
                                Text(entry.completedAt.map(time) ?? "")
                                    .font(.system(size: 10.5).monospacedDigit()).foregroundStyle(PaperTheme.secondary)
                            }
                            .frame(minHeight: 30)
                            .overlay(alignment: .bottom) { Rectangle().fill(PaperTheme.rule).frame(height: 0.6) }
                        }
                    }
                }
                // A taller list and a deeper fade, so a row cut by the card's edge clearly scrolls on.
                .scrollEdgeFade(14)
                .frame(maxHeight: 200)
            }
        }
    }

    // MARK: 가장 오래 집중한 일

    /// Under the squares: the to-dos focused on longest in the range, as small chips (as many of the
    /// three as fit; hidden while there are none).
    @ViewBuilder
    private func longestFocus(_ top: [Focus.TaskTotal]) -> some View {
        if !top.isEmpty {
            ViewThatFits(in: .horizontal) {
                ForEach((1...top.count).reversed(), id: \.self) { count in focusRow(Array(top.prefix(count))) }
                Text("가장 오래 집중한 일").font(.system(size: 11.5, weight: .semibold)).foregroundStyle(PaperTheme.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.top, 10)
            .overlay(alignment: .top) { Rectangle().fill(PaperTheme.rule).frame(height: 0.6) }
            .padding(.top, 10)
        }
    }

    private func focusRow(_ tasks: [Focus.TaskTotal]) -> some View {
        HStack(spacing: 8) {
            Text("가장 오래 집중한 일").font(.system(size: 11.5, weight: .semibold)).foregroundStyle(PaperTheme.secondary)
                .fixedSize()
            ForEach(Array(tasks.enumerated()), id: \.offset) { _, task in
                HStack(spacing: 6) {
                    Text(task.title.handwritten).font(font.font(points: 16))
                        .lineLimit(1)
                    Text(Focus.lengthText(task.minutes, language: language))
                        .font(.system(size: 10.5, weight: .medium).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink2)
                }
                .fixedSize()
                .padding(.horizontal, 9)
                .frame(height: 24)
                .background(PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .help(task.title + " · " + Focus.lengthText(task.minutes, language: language) + " · " + Focus.sessionsText(task.sessions, language: language))
                .accessibilityElement(children: .combine)
            }
        }
    }

    /// "3시간 20분" as number-and-unit pairs for a tile: [("3", "시간"), ("20", "분")]; en h / min, nl u / min.
    static func lengthParts(_ minutes: Int, language: AppLanguage) -> [(String, String)] {
        let units: (String, String) = switch language {
        case .ko: ("시간", "분") // ko-only: the core's own units (TimerLength.text)
        case .en: ("h", "min")
        case .nl: ("u", "min")
        }
        let hours = minutes / 60, rest = minutes % 60
        var parts: [(String, String)] = []
        if hours > 0 { parts.append(("\(hours)", units.0)) }
        if rest > 0 || hours == 0 { parts.append(("\(rest)", units.1)) }
        return parts
    }

    private func footer(entries: [ArchiveEntry]) -> some View {
        let undated = entries.filter { $0.completedAt == nil }.count
        return HStack {
            Text(undated > 0 ? L("날짜가 기록되기 전에 완료한 \(undated)개는 달력에 표시하지 않아요.") : L("완료한 일은 설정한 시점에 목록에서 기록으로 옮겨져요."))
            Spacer()
            // The link only: the folder's path is in 저장과 백업.
            Button("기록 폴더 열기", action: archive.openFolder)
                .buttonStyle(.plain)
                .foregroundStyle(PaperTheme.sage)
                .fontWeight(.semibold)
        }
        .font(.system(size: 11))
        .foregroundStyle(PaperTheme.secondary)
    }

    // MARK: Helpers

    private func forEachDay(in range: ClosedRange<Date>, _ visit: (Date) -> Void) {
        var date = calendar.startOfDay(for: range.lowerBound).addingTimeInterval(12 * 3600)
        while date <= range.upperBound.addingTimeInterval(12 * 3600) {
            visit(date)
            date = calendar.date(byAdding: .day, value: 1, to: date)!
        }
    }


    private func date(for key: String) -> Date {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2], hour: 12)) ?? Date()
    }

    /// "10월 8일 목요일", "Thursday, October 8", "donderdag 8 oktober"
    private func longDate(_ key: String) -> String { language.longDate(date(for: key), calendar: calendar) }

    /// "10월 8일 (목)", "Thu, Oct 8", "do 8 okt"
    private func shortDate(_ key: String) -> String { language.shortDate(date(for: key), calendar: calendar) }

    /// "2026년 10월", "October 2026", "oktober 2026"
    private func monthTitle(_ date: Date) -> String {
        language.monthTitle(year: calendar.component(.year, from: date), month: calendar.component(.month, from: date))
    }

    /// When a task was finished: "15:05" or "3:05 PM", on the app's clock.
    private func time(_ date: Date) -> String {
        language.clock(hour: calendar.component(.hour, from: date), minute: calendar.component(.minute, from: date))
    }
}

enum HistoryRange: Hashable {
    case recent
    case year(Int)

    var title: String {
        switch self {
        case .recent: L("최근 1년")
        case .year(let year): L("\(String(year))년")
        }
    }

    /// Noon-anchored bounds: the last 53 weeks ending today, or a calendar year.
    func bounds(today: Date, calendar: Calendar) -> ClosedRange<Date> {
        switch self {
        case .recent:
            let end = calendar.startOfDay(for: Archive.logicalDayStart(today, calendar: calendar)).addingTimeInterval(12 * 3600)
            let weekday = calendar.component(.weekday, from: end) - 1
            let start = calendar.date(byAdding: .day, value: -(7 * 52 + weekday), to: end)!
            return start...end
        case .year(let year):
            let start = calendar.date(from: DateComponents(year: year, month: 1, day: 1, hour: 12))!
            let end = calendar.date(from: DateComponents(year: year, month: 12, day: 31, hour: 12))!
            return start...end
        }
    }
}

/// A day's square. The hover outline is its own (#62: a hover on the pane's state redrew the whole pane).
private struct HeatCell: View {
    let count: Int
    let cell: CGFloat
    let selected: Bool
    let today: Bool
    let help: String
    let label: String
    let select: () -> Void
    @State private var hovering = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 2.5)
        shape.fill(HeatColor.levels[Archive.heatLevel(count)])
            .frame(width: cell, height: cell)
            .overlay {
                if selected {
                    shape.inset(by: -2).stroke(PaperTheme.accent, lineWidth: 1.5)
                } else if today {
                    shape.inset(by: -1).stroke(PaperTheme.ink, lineWidth: 1.2)
                } else if hovering {
                    shape.inset(by: -1).stroke(PaperTheme.ink.opacity(0.55), lineWidth: 1)
                }
            }
            .contentShape(Rectangle().inset(by: -HistoryView.gap / 2))
            .onHover { hovering = $0 }
            .onTapGesture(perform: select)
            .help(help)
            .accessibilityElement()
            .accessibilityLabel(label)
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { select() }
    }
}

private struct SummaryTile: View {
    let symbol: String
    let label: String
    let value: String
    let unit: String
    let detail: String
    /// A value in several number-and-unit pairs ("3시간 20분"), instead of `value` and `unit`.
    var parts: [(String, String)] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 7) {
                Image(systemName: symbol)
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(PaperTheme.ink)
                    .frame(width: 20, height: 20)
                    .background(PaperTheme.sage2, in: RoundedRectangle(cornerRadius: 5))
                Text(label).font(.system(size: 11)).foregroundStyle(PaperTheme.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(alignment: .firstTextBaseline, spacing: 2) {
                if parts.isEmpty {
                    Text(value).font(.system(size: 24, weight: .bold, design: .rounded).monospacedDigit())
                    Text(unit).font(.system(size: 12, weight: .semibold)).foregroundStyle(PaperTheme.secondary)
                } else {
                    ForEach(Array(parts.enumerated()), id: \.offset) { index, part in
                        Text(part.0).font(.system(size: 24, weight: .bold, design: .rounded).monospacedDigit())
                            .padding(.leading, index > 0 ? 4 : 0)
                        Text(part.1).font(.system(size: 12, weight: .semibold)).foregroundStyle(PaperTheme.secondary)
                    }
                }
            }
            .lineLimit(1)
            .minimumScaleFactor(0.7)
            // Longer in English and Dutch: two lines rather than cut off.
            Text(detail).font(.system(size: 11)).foregroundStyle(PaperTheme.secondary).lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(PaperTheme.rule, lineWidth: 1) }
        .accessibilityElement(children: .combine)
    }
}

private struct Card<Content: View>: View {
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { content }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(PaperTheme.rule, lineWidth: 1) }
    }
}
