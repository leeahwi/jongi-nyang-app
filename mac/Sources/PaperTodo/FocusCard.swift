import AppKit
import PaperCore
import SwiftUI

/// The note while focusing on a to-do (1.37): one card with the time left and the task — the tabs,
/// the list and the input line rest. Top: `집중 · 2 / 4` (or `25분 다 됐어요`) and the round dots; a
/// ring (clay = time gone by; sage when the time is up or on a break) with the time; the task in
/// handwriting; what's next today; 다 했어요 · 5분 더 · 다음에; and `그 밖의 오늘 할 일 3개 · 펼치기`,
/// which opens today's other to-dos below (still checkable). Esc or × asks before it stops.
struct FocusCardView: View {
    @ObservedObject var model: AppModel
    @ObservedObject var state: FocusTimerState
    /// Snapshots: a fixed now.
    var now: Date?
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse = false
    @State private var nod = false
    @State private var height: CGFloat = 560

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let at = now ?? timeline.date
            if let session = state.session {
                card(session, at: at)
            }
        }
        .background(PaperBackground())
        .foregroundStyle(PaperTheme.ink)
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
        .onChange(of: state.timeUps) {
            // The primary button pulses once when the time is up.
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 0.22)) { pulse = true }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(240))
                withAnimation(.easeIn(duration: 0.22)) { pulse = false }
            }
        }
        .onReceive(Timer.publish(every: 300, on: .main, in: .common).autoconnect()) { _ in
            // The cat nods every five minutes.
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 0.2)) { nod = true }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(200))
                withAnimation(.easeIn(duration: 0.2)) { nod = false }
            }
        }
        .onAppear { setWindowDrag(focusing: true) }
        .onDisappear { setWindowDrag(focusing: false) }
    }

    /// Only the top row drags the window while the card shows (its ring and buttons take clicks).
    private func setWindowDrag(focusing: Bool) {
        guard let window = NSApp.windows.first(where: { $0 is NoteWindow }) as? NoteWindow else { return }
        let short = (window.contentView?.bounds.height ?? 560) <= NoteHeader.compactBelow
        window.dragHeight = focusing ? NoteHeader.tabRow : NoteHeader.tabRow + (short ? NoteHeader.compactTitleBlock : NoteHeader.titleBlock)
    }

    private var language: AppLanguage { .current }
    /// Shorter windows (and an open list) get a smaller ring.
    private var ringSize: CGFloat {
        if state.restOpen { return height < 520 ? 96 : height < 640 ? 120 : 150 }
        return height < 440 ? 128 : height < 500 ? 148 : 170
    }

    @ViewBuilder
    private func card(_ session: FocusSession, at now: Date) -> some View {
        let stage = session.stage(at: now)
        let others = otherTasks(session)
        VStack(spacing: 0) {
            topRow(session, stage: stage)
            Spacer(minLength: 4)
            VStack(spacing: state.restOpen || height < 470 ? 6 : 10) {
                ring(session, stage: stage, at: now)
                title(session.title, points: height < 470 ? 26 : 30)
                    .padding(.horizontal, 24)
                    .accessibilityAddTraits(.isHeader)
                if let next = nextLine(at: now) {
                    Text(next)
                        .font(.system(size: 12).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink2)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .padding(.horizontal, 20)
                }
                buttons(session, stage: stage)
                    .padding(.top, 2)
            }
            Spacer(minLength: 6)
            restSection(others)
        }
        .overlay(alignment: .bottomLeading) {
            // The cat cheers along, small, at the bottom left (above the list).
            if !state.restOpen && height >= 440 {
                Image(nsImage: PetArt.image(.cheer) ?? PaperTheme.mascot)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 54, height: 54)
                    .rotationEffect(.degrees(nod ? 2 : 0), anchor: .bottom)
                    .offset(y: nod ? 2 : 0)
                    .padding(.leading, 10)
                    .padding(.bottom, others.isEmpty ? 14 : 40)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
    }

    /// The task in handwriting (two lines at most, held close together; see HandTitle).
    @ViewBuilder
    private func title(_ text: String, points: CGFloat) -> some View {
        switch model.notebookFont {
        case .pen: HandTitle(text: text.handwritten, font: HandwritingFont.native(face: .pen, size: points))
        case .brush: HandTitle(text: text.handwritten, font: HandwritingFont.native(face: .brush, size: (points * 0.93).rounded()))
        case .clean:
            Text(text).font(model.notebookFont.font(points: points)).lineLimit(2).multilineTextAlignment(.center)
        }
    }

    // MARK: Top row

    private func topRow(_ session: FocusSession, stage: FocusSession.Stage) -> some View {
        let round = session.round
        let line = stage == .timeUp ? Focus.timeUpLine(minutes: session.plannedMinutes, language: language)
            : Focus.topLine(round: round?.number, of: round?.of, language: language)
        return HStack(spacing: 8) {
            Color.clear.frame(width: NoteWindow.windowButtonsWidth - 8, height: 1) // the window's buttons
            Text(line)
                .font(.system(size: 11, weight: .semibold).monospacedDigit())
                .foregroundStyle(stage == .timeUp ? PaperTheme.sageText : PaperTheme.ink3)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Spacer(minLength: 6)
            if let round {
                HStack(spacing: 5) {
                    ForEach(0..<round.of, id: \.self) { index in
                        Circle().fill(index < round.number ? PaperTheme.clay : PaperTheme.rule).frame(width: 7, height: 7)
                    }
                }
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Focus.topLine(round: round.number, of: round.of, language: language))
            }
            Button { model.petCommand(.focusStep(.askToStop)) } label: {
                Image(systemName: "xmark").font(.system(size: 11, weight: .semibold))
            }
            .buttonStyle(QuietButtonStyle(size: 26))
            .background(ToolbarControlFrame())
            .help(L("집중 그만두기 (esc)"))
            .accessibilityLabel(L("집중 그만두기"))
        }
        .padding(.trailing, 10)
        .frame(height: NoteHeader.tabRow)
        .onPreferenceChange(ToolbarControlFramesKey.self) { frames in
            (NSApp.windows.first { $0 is NoteWindow } as? NoteWindow)?.toolbarControlFrames = frames
        }
    }

    // MARK: Ring

    private func ring(_ session: FocusSession, stage: FocusSession.Stage, at now: Date) -> some View {
        let timer = session.timer
        let gone = timer.duration > 0 ? min(1, max(0, 1 - timer.remaining(at: now) / timer.duration)) : 1
        let over = stage == .timeUp || stage == .restOver
        let resting = stage == .resting || stage == .restOver
        let clock: String = stage == .timeUp ? FocusTimer.clock(timer.elapsed(at: now)) : FocusTimer.clock(timer.remaining(at: now))
        let label: String = switch stage {
        case .running: timer.isPaused ? L("멈춤") : L("남았어요")
        case .timeUp: L("집중했어요")
        case .resting: timer.isPaused ? L("멈춤") : L("쉬는 중")
        case .restOver: L("쉬는 시간 끝")
        }
        let size = ringSize
        return ZStack {
            // The track: a soft rule (paper2, as in the mock, all but vanishes on the grain).
            Circle().stroke(PaperTheme.rule, lineWidth: 9)
            // Updated every second, without a sweeping animation: a 25-minute ring moves a quarter of a
            // degree a second, so steps don't show, and a resize never drags an arc along.
            Circle()
                .trim(from: 0, to: over ? 1 : gone)
                .stroke(over || resting ? PaperTheme.sage : PaperTheme.clay, style: StrokeStyle(lineWidth: 9, lineCap: over ? .butt : .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                // 1.40: the width of its form's widest time (tabular digits), so it never shifts as it ticks.
                Text(TabularClock.template(clock))
                    .font(.system(size: size < 140 ? 28 : 34, weight: .semibold).monospacedDigit())
                    .tracking(-0.5)
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
                    .hidden()
                    .overlay {
                        Text(clock)
                            .font(.system(size: size < 140 ? 28 : 34, weight: .semibold).monospacedDigit())
                            .tracking(-0.5)
                            .lineLimit(1)
                            .minimumScaleFactor(0.6)
                    }
                    .accessibilityHidden(true)
                Text(label)
                    .font(.system(size: 11))
                    .foregroundStyle(PaperTheme.ink3)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
                if !over {
                    // 1.38: ⏸ / ▶ under the time (Space), not only a click on the ring.
                    Button { model.petCommand(.focusStep(.togglePause)) } label: {
                        Image(systemName: timer.isPaused ? "play" : "pause")
                            .font(.system(size: 10.5, weight: .bold))
                            .foregroundStyle(PaperTheme.ink2)
                            .frame(width: 26, height: 22)
                            .background(PaperTheme.paper2, in: Capsule())
                            .overlay { Capsule().strokeBorder(PaperTheme.rule, lineWidth: 0.8) }
                            .contentShape(Capsule())
                    }
                    .buttonStyle(.plain)
                    .padding(.top, size < 140 ? 3 : 6)
                    .help(timer.isPaused ? L("계속 (Space)") : L("일시정지 (Space)"))
                    .accessibilityLabel(timer.isPaused ? L("계속") : L("일시정지"))
                }
            }
            .padding(.horizontal, 18)
        }
        .padding(4.5)
        .frame(width: size, height: size)
        .contentShape(Circle())
        .onTapGesture { if !over { model.petCommand(.focusStep(.togglePause)) } }
        .help(over ? "" : timer.isPaused ? L("누르면 계속") : L("누르면 일시정지"))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(clock) \(label)")
        .accessibilityAddTraits(over ? [] : .isButton)
        .accessibilityAction { if !over { model.petCommand(.focusStep(.togglePause)) } }
    }

    // MARK: Buttons

    @ViewBuilder
    private func buttons(_ session: FocusSession, stage: FocusSession.Stage) -> some View {
        let steps = Self.steps(session, stage: stage, pomodoro: model.pomodoroSettings)
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { ForEach(steps, id: \.title) { stepButton($0) } }
            VStack(spacing: 8) {
                HStack(spacing: 8) { ForEach(steps.prefix(2), id: \.title) { stepButton($0) } }
                HStack(spacing: 8) { ForEach(steps.dropFirst(2), id: \.title) { stepButton($0) } }
            }
        }
        .padding(.horizontal, 12)
    }

    struct Step {
        let title: String
        let step: FocusStep
        var primary = false

        /// The keycap on the button (1.38): ⌘↩ 다 했어요 · ⌘= 5분 더 · Esc 다음에.
        var key: String? {
            switch step {
            case .done: "⌘↩"
            case .more: "⌘="
            case .later: "Esc"
            default: primary ? "↩" : nil
            }
        }
    }

    /// The card's buttons for a stage (the first is the primary one).
    static func steps(_ session: FocusSession, stage: FocusSession.Stage, pomodoro: PomodoroSettings) -> [Step] {
        let done = Step(title: String(localized: "다 했어요", table: "Focus"), step: .done)
        let more = Step(title: L("5분 더"), step: .more)
        let later = Step(title: L("다음에"), step: .later)
        switch stage {
        case .running:
            return [Step(title: done.title, step: .done, primary: true), more, later]
        case .timeUp:
            guard session.isPomodoro else { return [Step(title: done.title, step: .done, primary: true), more, later] }
            // The break that comes next: a long one after the last round of a set.
            let rounds = max(1, pomodoro.roundsBeforeLongRest)
            let long = (session.timer.completedRounds + 1) % rounds == 0
            let minutes = long ? pomodoro.longRestMinutes : pomodoro.restMinutes
            return [Step(title: L("\(minutes)분 쉬기"), step: .takeBreak, primary: true), done, more, later]
        case .resting, .restOver:
            return [Step(title: L("다음 라운드"), step: .nextRound, primary: true), Step(title: L("그만하기"), step: .stopRounds)]
        }
    }

    private func stepButton(_ step: Step) -> some View {
        Button { model.petCommand(.focusStep(step.step)) } label: {
            Text(step.title).fixedSize()
        }
        .buttonStyle(SlipButtonStyle(role: step.primary ? .primary : .quiet, key: step.key))
        .scaleEffect(step.primary && pulse ? 1.06 : 1)
        .keyboardShortcut(step.primary ? .defaultAction : nil)
    }

    // MARK: Next, and the rest of today

    private func nextLine(at now: Date) -> String? {
        let layout = DayRibbon.layout(events: model.calendar.todayEvents(now: now), reminders: TodayWindowView.reminders(model: model), now: now)
        guard let next = layout.next else { return nil }
        return Focus.nextLine(title: next.title, at: next.at, minutes: next.minutes, language: language)
    }

    private func otherTasks(_ session: FocusSession) -> [TodoItem] {
        model.glanceTodayItems.filter { $0.id.uuidString != session.taskId }
    }

    @ViewBuilder
    private func restSection(_ others: [TodoItem]) -> some View {
        let open = others.filter { !$0.isCompleted }.count
        if let line = Focus.restLine(open, open: state.restOpen, language: language) {
            VStack(spacing: 0) {
                Button {
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.18)) { state.restOpen.toggle() }
                } label: {
                    Text(line).lineLimit(1).minimumScaleFactor(0.85)
                    .font(.system(size: 11.5))
                    .foregroundStyle(PaperTheme.ink3)
                    .frame(maxWidth: .infinity, minHeight: 32)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .overlay(alignment: .top) { Rectangle().fill(PaperTheme.rule).frame(height: 1).padding(.horizontal, 18) }
                if state.restOpen {
                    ScrollView {
                        VStack(spacing: 0) {
                            ForEach(others) { item in FocusRestRow(item: item, model: model) }
                        }
                        .padding(.horizontal, 18)
                    }
                    .scrollIndicators(.never) // never a legacy scroller: its 17 pt gutter shifted the rules and meta
                    .scrollEdgeFade(8)
                    .frame(maxHeight: max(72, height * 0.34))
                    .padding(.bottom, 8)
                    .transition(.opacity)
                }
            }
        } else {
            Color.clear.frame(height: 12)
        }
    }
}

/// A compact row in the focus card's list: the checkbox (with its pop) and the title.
private struct FocusRestRow: View {
    let item: TodoItem
    @ObservedObject var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pop = false

    var body: some View {
        HStack(spacing: 10) {
            Button {
                if !item.isCompleted && !reduceMotion {
                    pop = true
                    withAnimation(.easeOut(duration: 0.16)) { pop = false }
                }
                model.toggle(item.id)
            } label: {
                ZStack {
                    RoundedRectangle(cornerRadius: 5).fill(item.isCompleted ? PaperTheme.sage : PaperTheme.card.opacity(0.6))
                    RoundedRectangle(cornerRadius: 5).strokeBorder(item.isCompleted ? PaperTheme.sage : PaperTheme.checkBorder, lineWidth: 1.5)
                    if item.isCompleted {
                        Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundStyle(PaperTheme.onSage)
                    }
                }
                .frame(width: 16, height: 16)
                .scaleEffect(pop ? 0.85 : 1)
                .frame(width: 24, height: 30)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(item.title) 완료")
            .accessibilityValue(item.isCompleted ? L("완료됨") : L("미완료"))
            Text(item.title.handwritten)
                .font(model.notebookFont.bodyFont(.small))
                .foregroundStyle(item.isCompleted ? PaperTheme.ink3 : PaperTheme.ink)
                .strikethrough(item.isCompleted, color: PaperTheme.ink.opacity(0.5))
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(minHeight: 32)
        .overlay(alignment: .bottom) { Rectangle().fill(PaperTheme.rule).frame(height: 0.6) }
    }
}

/// 할 일 골라 집중…: in place of the input line while the rows offer 집중 (Esc cancels).
struct FocusPickBanner: View {
    @ObservedObject var model: AppModel

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "timer").font(.system(size: 11, weight: .semibold)).foregroundStyle(PaperTheme.sageText)
            Text("집중할 할 일을 골라요")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PaperTheme.sageText)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
            Spacer(minLength: 6)
            KeyCap("Esc")
            Button { model.focusPicking = false } label: {
                Text("취소").font(.system(size: 12, weight: .medium)).foregroundStyle(PaperTheme.ink2).fixedSize()
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 44)
        .background(PaperTheme.sage2, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) }
        .accessibilityElement(children: .contain)
    }
}

/// Shows the focus card in place of the note while a focus runs.
struct FocusSwitch<Content: View>: View {
    @ObservedObject var state: FocusTimerState
    @ViewBuilder var content: (Bool) -> Content

    var body: some View { content(state.isFocusing) }
}

/// The focus card's handwritten title: centred, up to two lines, with the lines kept as close as
/// the Korean face sets them (Caveat and Kalam bring a much taller line, which left a wide gap
/// between two wrapped lines in English and Dutch). The clean face is the system font as usual.
struct HandTitle: NSViewRepresentable {
    let text: String
    let font: NSFont

    func makeNSView(context: Context) -> NSTextField {
        let field = NSTextField(wrappingLabelWithString: "")
        field.isSelectable = false
        field.drawsBackground = false
        field.isBordered = false
        field.maximumNumberOfLines = 2
        field.lineBreakMode = .byWordWrapping
        field.cell?.truncatesLastVisibleLine = true
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        update(field)
        return field
    }

    func updateNSView(_ field: NSTextField, context: Context) { update(field) }

    private var paragraph: NSParagraphStyle {
        let style = NSMutableParagraphStyle()
        style.alignment = .center
        style.lineBreakMode = .byWordWrapping
        // One line of the Korean face (about 1.15 × the size), whatever face draws the letters.
        let line = (font.pointSize * 1.18).rounded()
        style.minimumLineHeight = line
        style.maximumLineHeight = line
        return style
    }

    private func update(_ field: NSTextField) {
        field.attributedStringValue = NSAttributedString(string: text, attributes: [
            .font: font, .foregroundColor: NSColor(PaperTheme.ink), .paragraphStyle: paragraph,
            .baselineOffset: -(font.ascender + font.descender - font.pointSize) / 4,
        ])
        field.setAccessibilityRole(.staticText)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView field: NSTextField, context: Context) -> CGSize? {
        let width = proposal.width ?? 10_000
        field.preferredMaxLayoutWidth = width
        let size = field.cell?.cellSize(forBounds: NSRect(x: 0, y: 0, width: width, height: 10_000)) ?? .zero
        return CGSize(width: min(width, ceil(size.width)), height: ceil(size.height))
    }
}
