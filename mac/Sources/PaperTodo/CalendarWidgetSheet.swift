import AppKit
import PaperCore
import SwiftUI

// 바탕화면 위젯의 날짜 쪽지 (#234): a day pressed on a widget (or its +N, or the + of 오늘 · 오늘 목록) opens this slip
// beside the widget — always solid, over the windows even when the widget is under them. It lists every event and to-do
// of that day with its time (also what is over, so a busy day can always be read in full), and its line reads what is
// written as the note's input line does, on that day when no day is written (CalendarWidget.candidates). Tab switches
// to-do and event, Return puts the picked one in, ⇧Return as a to-do, ⌘Return as an event, ⌥← · ⌥→ (nothing written)
// the day before or after, Esc or a click elsewhere closes it. What was put in shows as the widget's toast.
// #253: it works while a question waits (SlipModal); while the question replaces the whole list, 넣기 dims and says why,
// and Return, ⌘Z and the toast's 되돌리기 bring the question forward instead (the text stays).

@MainActor
final class WidgetDaySheetController {
    weak var widgets: CalendarWidgets?
    private var panel: SlipPanel?
    private(set) var widgetID: String?
    private(set) var day: String?
    /// What was typed and not put in: it stays until the sheet opens again.
    var draft = ""
    /// The last thing put in, for ⌘Z while its toast is up.
    var lastCommit: (IntentCommit, Date)?
    private var offscreen = false

    var isOpen: Bool { panel?.isVisible == true }

    func open(day: String, beside widget: NSPanel, widget id: String, model: AppModel, offscreen: Bool) {
        self.offscreen = offscreen
        widgetID = id
        self.day = day
        let panel = panel ?? makePanel()
        panel.show(WidgetDaySheetView(model: model, controller: self, day: day))
        follow()
        panel.makeKeyAndOrderFront(nil)
    }

    /// Another day in the same sheet (⌥← · ⌥→).
    func show(day: String) {
        guard let model = widgets?.model, let panel else { return }
        self.day = day
        panel.show(WidgetDaySheetView(model: model, controller: self, day: day))
    }

    func close() {
        panel?.orderOut(nil)
    }

    func close(for id: String) {
        if widgetID == id { close() }
    }

    /// Beside its widget, on the side with more room on that display, its top with the paper's top.
    func follow() {
        guard let panel, let id = widgetID, let widget = widgets?.panel(id), let settings = widgets?.state(id)?.settings else { return }
        if offscreen {
            panel.setFrameOrigin(NSPoint(x: -40_000, y: -40_000))
            return
        }
        let area = (widget.screen ?? NSScreen.holding(widget.frame))?.visibleFrame ?? widget.frame
        let width = WidgetDaySheetView.width + SlipMetrics.margin.leading + SlipMetrics.margin.trailing
        let gap: CGFloat = 8
        let right = area.maxX - widget.frame.maxX >= widget.frame.minX - area.minX
        let left = right ? widget.frame.maxX + gap - SlipMetrics.margin.leading : widget.frame.minX - gap + SlipMetrics.margin.trailing - width
        let top = widget.frame.maxY - CalendarWidget.earHeight(settings.kind, settings.style) + SlipMetrics.margin.top
        panel.placeSlip(topCenter: NSPoint(x: left + width / 2, y: top))
    }

    /// The sheet's window (made once; the checks make one to look at).
    func makePanel() -> SlipPanel {
        let panel = SlipPanel(nonactivating: true)
        panel.title = L("날짜 쪽지")
        // Over the widgets, those kept on top too.
        panel.level = NSWindow.Level(rawValue: NSWindow.Level.floating.rawValue + 1)
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.onResignKey = { [weak self] in self?.close() }
        panel.worksWhenModal = true
        self.panel = panel
        return panel
    }
}

struct WidgetDaySheetView: View {
    static let width: CGFloat = 300
    @ObservedObject var model: AppModel
    /// #253: what is up (a question that replaces the whole list dims 넣기).
    @ObservedObject var asking = SlipAsking.shared
    let controller: WidgetDaySheetController
    let day: String
    @State private var text = ""
    @State private var picked = 0
    @State private var focus = 0
    @State private var focused = false
    /// Snapshots: the text in the line, and the time it is drawn at.
    var previewText: String?
    var previewNow: Date?
    /// Snapshots: drawn as while a question that replaces the whole list waits (#253).
    var previewWaiting = false
    private var now: Date { previewNow ?? Date() }

    private var language: AppLanguage { .current }
    private var reading: SpaceToken.Reading { model.spaceReading(text, lens: true) }
    private var candidates: [Intent.Candidate] {
        CalendarWidget.candidates(reading.text, day: day, now: now, language: language)
    }

    private var lines: [CalendarWidget.Line] {
        let range = CalendarMonth.fetchRange([day])
        let tasks = model.hereItems
        let page = CalendarMonth.Page(days: [day], events: model.calendar.occurrences(from: range.start, to: range.end), tasks: tasks,
                                      series: model.hereSeries, now: now, language: language)
        return CalendarWidget.sheetLines(day, page: page, tasks: tasks, now: now, language: language)
    }

    var body: some View {
        let candidates = self.candidates
        let index = min(picked, max(0, candidates.count - 1))
        let lines = self.lines
        PaperSlip(kind: .event, width: Self.width) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .event, symbol: "calendar", title: CalendarWidget.sheetTitle(day, language: language), onClose: { controller.close() })
                    .overlay(alignment: .trailing) {
                        // The day before or after (⌥← · ⌥→ while nothing is written).
                        HStack(spacing: 2) {
                            dayButton("chevron.left", L("이전 날"), -1)
                            dayButton("chevron.right", L("다음 날"), 1)
                        }
                        .padding(.trailing, 46)
                    }
                VStack(alignment: .leading, spacing: 8) {
                    // calendar-flows: the holiday first, as in the month's cells.
                    let holiday = model.calendar.showsHolidays ? DayMarks.holiday(day) : nil
                    if let holiday { holidayRow(holiday).padding(.bottom, lines.isEmpty ? -6 : -8) }
                    if lines.isEmpty {
                        Text(L("아직 아무것도 없어요"))
                            .font(.system(size: 12))
                            .foregroundStyle(PaperTheme.ink3)
                            .frame(height: 22, alignment: .leading)
                    } else {
                        ScrollView(.vertical) {
                            VStack(alignment: .leading, spacing: 0) {
                                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in row(line) }
                            }
                        }
                        .frame(height: min(CGFloat(lines.count) * 24, holiday == nil ? 216 : 192))
                    }
                    if !candidates.isEmpty {
                        IntentChips(candidates: candidates, picked: index, onPick: { picked = $0 },
                                    title: { CalendarWidget.chip($0, now: now, language: language) })
                    }
                    IntentField(text: $text, placeholder: L("할 일이나 일정을 적어요"), font: model.notebookFont.handNSFont(24),
                                focusRequest: focus,
                                onFocus: { focused = $0 },
                                onTab: { step in
                                    guard candidates.count > 1 else { return false }
                                    picked = (picked + step + candidates.count) % candidates.count
                                    return true
                                },
                                onSubmit: { shift, command in submit(literal: shift, asEvent: command) },
                                onEscape: { controller.close(); return true },
                                onUndo: undo,
                                onWordArrow: { step in
                                    guard text.isEmpty else { return false }
                                    controller.show(day: CalendarWidget.step(day, by: step))
                                    return true
                                },
                                accessibilityLabel: L("할 일이나 일정을 적어요"))
                        .growing(oneLine: 30)
                        .padding(.bottom, 4)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(focused || !text.isEmpty ? PaperTheme.sage : PaperTheme.rule).frame(height: 1.5)
                        }
                }
                .padding(.horizontal, 16)
                .padding(.top, 10)
                .padding(.bottom, 4)
                SlipFooter {
                    FlowLayout(spacing: 10, lineSpacing: 4) {
                        KeyHint(key: "Tab", label: L("할 일 ↔ 일정"))
                        KeyHint(key: "⌥←→", label: L("다른 날"))
                        KeyHint(key: "Esc", label: L("닫기"))
                    }
                } trailing: {
                    let put = Button(L("넣기")) { submit(literal: false, asEvent: false) }
                        .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
                        .disabled(candidates.isEmpty)
                        .fixedSize()
                    if waiting {
                        // Still pressable: a press brings the question forward and shakes it.
                        put.opacity(0.4)
                            .help(Self.waitingReason)
                            .accessibilityHint(Self.waitingReason)
                    } else {
                        put
                    }
                }
            }
        }
        .onChange(of: text) {
            picked = 0
            controller.draft = text
        }
        .onAppear {
            text = previewText ?? controller.draft
            focus += 1
        }
    }

    /// #253: 넣기 waits for the answer of a question that replaces the whole list.
    private var waiting: Bool { previewWaiting || SlipMove.widgetPress(.add, up: asking.up) == .waits }
    static var waitingReason: String { L("질문에 답하면 넣을 수 있어요") }

    private func dayButton(_ symbol: String, _ label: String, _ step: Int) -> some View {
        Button { controller.show(day: CalendarWidget.step(day, by: step)) } label: {
            Image(systemName: symbol).font(.system(size: 11, weight: .medium)).frame(width: 26, height: 26).contentShape(Rectangle())
        }
        .buttonStyle(SlipIconButtonStyle())
        .help(label)
        .accessibilityLabel(label)
    }

    /// ‘공휴일 · 한글날’ in clay, not a button (there is nothing to open).
    private func holidayRow(_ name: String) -> some View {
        HStack(spacing: 7) {
            Image(systemName: "flag.fill").font(.system(size: 8.5, weight: .semibold)).foregroundStyle(PaperTheme.clay).frame(width: 10)
            Text(CalendarWidget.holidayWord(language))
                .font(.system(size: 11.5).monospacedDigit())
                .frame(minWidth: 40, alignment: .leading)
                .fixedSize()
            Text(name).font(.system(size: 12.5, weight: .semibold)).lineLimit(1).truncationMode(.tail)
            Spacer(minLength: 0)
        }
        .foregroundStyle(PaperTheme.clayText)
        .frame(height: 24)
        .accessibilityElement(children: .combine)
    }

    private func row(_ line: CalendarWidget.Line) -> some View {
        // calendar-flows: what is over by now is drawn faded (all-day events and deadlines last the whole day); #274: a
        // repeat after the next one too.
        let over = line.over(now) || line.ahead
        let time = line.time ?? (line.kind == .deadline ? L("마감") : line.kind == .repeating ? CalendarMonth.repeatWord(ahead: false, language: language) : CalendarDay.allDayText(language))
        return Button {
            controller.widgets?.open(line, day: day)
            controller.close()
        } label: {
            HStack(spacing: 7) {
                WidgetMark(kind: line.kind, color: line.color == "clay" ? PaperTheme.clay : line.color == "sage" || line.color == "faint" ? PaperTheme.sage
                           : PaperTheme.event(line.color), halo: false)
                    .opacity(over ? 0.45 : 1)
                Text(time)
                    .font(.system(size: 11.5).monospacedDigit())
                    .foregroundStyle(PaperTheme.ink3)
                    .frame(minWidth: 40, alignment: .leading)
                    .fixedSize()
                Text(line.title.keepingParticles)
                    .font(.system(size: 12.5))
                    .foregroundStyle(over ? PaperTheme.ink3 : PaperTheme.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 0)
            }
            .frame(height: 24)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(line.taskId != nil ? L("노트에서 보기") : line.kind == .repeating ? L("반복 할 일 보기") : L("달력에서 열기"))
        .accessibilityLabel(CalendarWidget.spoken(line, language: language) ?? "\(time) \(line.title)")
    }

    /// Return: the picked reading; ⇧Return the text as a to-do on the day; ⌘Return as an event.
    private func submit(literal: Bool, asEvent: Bool) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return controller.close() }
        // #253: a question that replaces the whole list comes first (what went in would be lost with the list).
        if SlipModal.waits(.add) { return }
        let reading = model.spaceReading(trimmed, lens: true)
        let now = Date()
        var list = CalendarWidget.candidates(reading.text, day: day, now: now, language: language)
        var index = min(picked, max(0, list.count - 1))
        if literal {
            list = [.todo(CalendarWidget.onDay(QuickParse(title: reading.text.trimmingCharacters(in: .whitespaces)), day: day, now: now))]
            index = 0
        } else if asEvent, let event = list.firstIndex(where: { $0.kind == .event }) {
            index = event
        }
        guard !list.isEmpty else { return }
        let space = reading.choices.first
        guard let commit = model.commitIntent(text: trimmed, candidates: list, index: index, page: .todos, space: space, now: now) else {
            return controller.close()
        }
        text = ""
        controller.draft = ""
        controller.lastCommit = (commit, now)
        if let id = controller.widgetID { controller.widgets?.made(Self.toast(for: commit, model: model, now: now), on: id) }
        controller.close()
    }

    /// ‘토요일 할 일에 넣었어요 · 되돌리기’, or the hidden space's ‘회사에 넣었어요 · 이 기기에서는 숨겨져 있어요 · 되돌리기’.
    static func toast(for commit: IntentCommit, model: AppModel, now: Date) -> PaperToast {
        let base = model.makeToast(for: commit, onChange: { _ in }, now: now)
        var toast = PaperToast(symbol: base.symbol, text: base.text)
        if base.symbol != "eye.slash" {
            let candidate = commit.candidate
            toast.text = CalendarWidget.addedText(day: CalendarWidget.day(of: candidate, now: now), event: candidate.kind == .event, now: now,
                                                  language: .current)
        }
        toast.action = L("되돌리기")
        toast.perform = { [weak model] in
            if SlipModal.waits(.undo) { return }
            model?.takeBack(commit)
            CalendarWidgets.shared.clearToasts()
        }
        toast.commit = commit
        return toast
    }

    /// ⌘Z while the last toast is still up.
    private func undo() -> Bool {
        guard let (commit, at) = controller.lastCommit, Date().timeIntervalSince(at) < 4 else { return false }
        if SlipModal.waits(.undo) { return true }
        model.takeBack(commit)
        controller.lastCommit = nil
        CalendarWidgets.shared.clearToasts()
        text = commit.text
        return true
    }
}

extension CalendarWidgets {
    /// 되돌리기 pressed: the put-in toasts go.
    func clearToasts() {
        for state in states.values where state.toast?.commit != nil { state.toast = nil }
    }
}
