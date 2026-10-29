import AppKit
import Carbon.HIToolbox
import PaperCore
import SwiftUI

// MARK: - Making what the line read

/// What the line made, so 바꾸기 and ⌘Z can take it back.
struct IntentCommit {
    enum Made {
        case todo(UUID), event(String), timer, alarm(String), memo(String), nothing
        /// 반복 할 일 (1.38): the series (and today's copy, if one was placed).
        case series(String)
        /// 집중 on a to-do (`made`: the line made the to-do too).
        case focus(task: UUID, made: Bool)
    }

    var text: String
    var candidates: [Intent.Candidate]
    var index: Int
    var key: String?
    var made: Made
    var page: AppModel.Page

    var candidate: Intent.Candidate { candidates[index] }

    /// The candidate 바꾸기 turns it into: the next one of another kind.
    var nextIndex: Int? {
        guard candidates.count > 1 else { return nil }
        for step in 1..<candidates.count {
            let index = (self.index + step) % candidates.count
            if candidates[index].kind != candidate.kind { return index }
        }
        return nil
    }
}

extension AppModel {
    /// The line's guesses for this text (with what 바꾸기 taught it).
    func intentCandidates(_ text: String, now: Date = Date()) -> [Intent.Candidate] {
        Intent.read(text, now: now, language: .current, prefer: intentMemory.prefer)
    }

    /// Makes the picked candidate. A to-do gets the sheet's defaults: on 앞으로 one without a date
    /// goes to 언젠가 (the later shelf), one with a date to its day.
    @discardableResult
    func commitIntent(text: String, candidates: [Intent.Candidate], index: Int, page: Page, now: Date = Date()) -> IntentCommit? {
        guard candidates.indices.contains(index) else { return nil }
        let made: IntentCommit.Made
        switch candidates[index] {
        case .todo(let parsed):
            let asksForPick = page == .todos && asksForDailyPick
            let id: UUID? = switch page {
            case .ahead: addParsed(parsed, shelf: .later, now: now)
            case .todos: addParsed(parsed, now: now)
            }
            guard let id else { return nil }
            // 오늘 꼭 하나: the first to-do written while the line asked becomes the day's one thing.
            if asksForPick && Shelf.page(of: items.first { $0.id == id } ?? TodoItem(title: ""), now: now) == .today { setDailyPick(id) }
            made = .todo(id)
        case .event(let guess):
            let draft = CalendarDraft(title: guess.title, date: guess.date, allDay: guess.allDay, startMinutes: guess.start,
                                      endMinutes: guess.end, repeatRule: guess.eventRepeat, color: calendar.lastColor)
            if let problem = draft.problem(.current) {
                // Can't be made as it is: the sheet opens to finish it.
                self.page = .todos
                onShowNote?()
                calendar.sheet = CalendarSheetRequest(mode: .new, draft: draft, problem: problem)
                return nil
            }
            guard let id = calendar.perform(.create(draft), now: now) else { return nil }
            made = .event(id)
        case .timer(let minutes, let title):
            // "보고서 25분 집중": a focus on that to-do (made on today's sheet when there's none).
            if let title, let target = focusTarget(title: title, now: now) {
                petCommand(.focus(task: target.id, minutes: minutes))
                made = .focus(task: target.id, made: target.made)
            } else {
                petCommand(.countdown(minutes: minutes))
                made = .timer
            }
        case .alarm(let time, let days, let label):
            made = .alarm(alarms.add(time: time, days: days, label: label, now: now))
        case .memo(let text):
            guard let id = addMemo(text: text) else { return nil }
            made = .memo(id)
        case .repeating(let guess):
            guard let id = saveSeries(title: guess.title, rule: guess.rule, remindAt: guess.time, now: now) else { return nil }
            made = .series(id)
        }
        return IntentCommit(text: text, candidates: candidates, index: index,
                            key: Intent.key(text, now: now, language: .current), made: made, page: page)
    }

    /// Takes back what a commit made, leaving no trace (no 되살리기, no line in the record).
    func takeBack(_ commit: IntentCommit) {
        switch commit.made {
        case .todo(let id): delete(id)
        case .event(let id): calendar.perform(.delete(id))
        case .timer: petCommand(.stop)
        case .focus(let task, let made):
            // Ended without a line in the record; a to-do the line made goes too.
            petCommand(.focusStep(.discard))
            if made { delete(task) }
        case .alarm(let id): alarms.delete(id)
        case .memo(let id): removeMemoQuietly(id)
        case .series(let id): removeSeriesQuietly(id)
        case .nothing: break
        }
    }

    /// 바꾸기: the made thing goes and the next kind is made instead; the line learns from it.
    func switchIntent(_ commit: IntentCommit, now: Date = Date()) -> IntentCommit? {
        guard let next = commit.nextIndex else { return nil }
        takeBack(commit)
        if let key = commit.key {
            var memory = intentMemory
            memory.switched(key: key, from: commit.candidate.kind, to: commit.candidates[next].kind)
            intentMemory = memory
        }
        return commitIntent(text: commit.text, candidates: commit.candidates, index: next, page: commit.page, now: now)
    }

    /// The toast for a commit: what was made, and its action (바꾸기, 멈추기 or 되돌리기).
    func makeToast(for commit: IntentCommit, onChange: @escaping (PaperToast?) -> Void, now: Date = Date()) -> PaperToast {
        let language = AppLanguage.current
        let candidate = commit.candidate
        var toast = PaperToast(symbol: Self.symbol(candidate.kind),
                               text: Intent.addedText(candidate, language: language, now: now),
                               emphasis: Intent.addedEmphasis(candidate, language: language))
        toast.commit = commit
        switch candidate {
        case .memo where commit.nextIndex == nil:
            // 1.43: memos live in 메모 서랍 — 열기 opens it on the new memo (⌘Z still takes it back).
            let added = MemoMove.addedToast(language)
            toast.text = added.text
            toast.emphasis = nil
            if case .memo(let id) = commit.made {
                toast.action = added.action
                toast.perform = { [weak self] in self?.revealMemo(id); onChange(nil) }
            }
        case .timer:
            toast.action = L("멈추기")
            toast.perform = { [weak self] in self?.takeBack(commit); onChange(nil) }
        case .alarm:
            toast.action = L("되돌리기")
            toast.perform = { [weak self] in self?.takeBack(commit); onChange(nil) }
        default:
            if let next = commit.nextIndex {
                toast.action = Intent.switchText(commit.candidates[next].kind, language: language)
                toast.perform = { [weak self] in
                    guard let self else { return }
                    onChange(self.switchIntent(commit).map { self.makeToast(for: $0, onChange: onChange) })
                }
            } else {
                toast.action = L("되돌리기")
                toast.perform = { [weak self] in self?.takeBack(commit); onChange(nil) }
            }
        }
        return toast
    }

    static func symbol(_ kind: Intent.Kind) -> String {
        switch kind {
        case .todo: "checkmark"
        case .event: "calendar"
        case .timer: "timer"
        case .alarm: "alarm"
        case .memo: "note.text"
        case .repeating: "repeat"
        }
    }
}

// MARK: - The toast

/// A short notice at the bottom of the sheet (or a slip): dark ink pill, an optional action,
/// gone after 4 s (paused while the pointer is on it), Esc dismisses. One at a time.
struct PaperToast: Identifiable {
    let id = UUID()
    var symbol: String
    var text: String
    /// Drawn a little brighter: the kind's word ("일정") or the timer's length.
    var emphasis: String?
    var action: String?
    var perform: (() -> Void)?
    /// What ⌘Z takes back while it's up.
    var commit: IntentCommit?
    /// A task moved on 앞으로 (⌘Z takes the move back, and the toast goes with it).
    var moved: UUID?
    /// 되돌리기 for a change in the list (지웠어요, 3개 끝냈어요 …): ⌘Z takes it back and the toast goes too.
    var undoable = false
    /// A change outside the list (an event moved or stretched in the timetable, 1.41): ⌘Z runs this while the toast is up.
    var takeBack: (() -> Void)?
    /// How long it stays (4 s when nil): Claude's work a little longer, the away notice longer still (1.42).
    var seconds: Double?
}

struct ToastView: View {
    let toast: PaperToast
    var seconds: Double = 4
    var onDismiss: () -> Void
    @State private var hovering = false
    @State private var remaining: Double = 4

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: toast.symbol)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(PaperTheme.toastText)
                .accessibilityHidden(true)
            Text(styled)
                .font(.system(size: 12.5, weight: .medium).monospacedDigit())
                .foregroundStyle(PaperTheme.toastText)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .layoutPriority(1)
            if let action = toast.action, let perform = toast.perform {
                Button(action: perform) {
                    Text(action)
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(PaperTheme.toastAction)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.vertical, 2)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(action)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(PaperTheme.toastBack, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .shadow(color: .black.opacity(0.25), radius: 10, y: 6)
        .onHover { hovering = $0 }
        // The text and its action stay two elements, so the action can be pressed.
        .accessibilityElement(children: .contain)
        .task(id: toast.id) {
            remaining = seconds
            // Counts down in small steps; the pointer on it holds the clock.
            while remaining > 0 {
                try? await Task.sleep(for: .milliseconds(100))
                if Task.isCancelled { return }
                if !hovering { remaining -= 0.1 }
            }
            onDismiss()
        }
        .onAppear { NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested, userInfo: [.announcement: toast.text, .priority: NSAccessibilityPriorityLevel.medium.rawValue]) }
    }

    private var styled: AttributedString {
        var text = AttributedString(toast.text.keepingParticles)
        if let emphasis = toast.emphasis, let range = text.range(of: emphasis) {
            text[range].foregroundColor = PaperTheme.toastKind
            text[range].font = .system(size: 12.5, weight: .semibold)
        }
        return text
    }
}

// MARK: - The field

/// The line's text field: handwriting, and the keys the line needs that a SwiftUI TextField
/// gives away — Tab / ⇧Tab (another reading), Return / ⇧Return (literal) / ⌘Return (as an
/// event), Esc, and ⌘Z right after a commit.
struct IntentField: NSViewRepresentable {
    @Binding var text: String
    var placeholder: String
    var font: NSFont
    /// Changing it puts the keyboard in the field.
    var focusRequest = 0
    var onFocus: (Bool) -> Void = { _ in }
    var onTab: (Int) -> Bool = { _ in false }
    /// `shift`: literal, `command`: as an event.
    var onSubmit: (_ shift: Bool, _ command: Bool) -> Void = { _, _ in }
    var onEscape: () -> Bool = { false }
    var onUndo: () -> Bool = { false }
    /// ↑ (-1) / ↓ (+1) — the search slip walks its results.
    var onArrow: (Int) -> Bool = { _ in false }
    var accessibilityLabel = ""

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> KeyField {
        let field = KeyField()
        field.isBordered = false
        field.isBezeled = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.lineBreakMode = .byTruncatingTail
        field.cell?.isScrollable = true
        field.cell?.wraps = false
        field.delegate = context.coordinator
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        update(field, context: context)
        return field
    }

    func updateNSView(_ field: KeyField, context: Context) {
        context.coordinator.parent = self
        update(field, context: context)
        if context.coordinator.focusRequest != focusRequest {
            context.coordinator.focusRequest = focusRequest
            DispatchQueue.main.async {
                guard let window = field.window else { return }
                window.makeFirstResponder(field)
                if let editor = field.currentEditor() { editor.selectedRange = NSRange(location: (field.stringValue as NSString).length, length: 0) }
            }
        }
    }

    private func update(_ field: KeyField, context: Context) {
        if field.stringValue != text { field.stringValue = text }
        if field.font != font { field.font = font }
        field.textColor = NSColor(PaperTheme.ink)
        field.placeholderAttributedString = NSAttributedString(string: placeholder, attributes: [
            .font: font, .foregroundColor: NSColor(PaperTheme.ink3),
        ])
        field.setAccessibilityLabel(accessibilityLabel)
        field.onFocus = { context.coordinator.parent.onFocus(true) }
        field.onUndo = { context.coordinator.parent.onUndo() }
        field.onCommandReturn = { context.coordinator.parent.onSubmit(false, true) }
    }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        var parent: IntentField
        var focusRequest: Int

        init(_ parent: IntentField) {
            self.parent = parent
            focusRequest = parent.focusRequest
        }

        func controlTextDidChange(_ notification: Notification) {
            guard let field = notification.object as? NSTextField else { return }
            parent.text = field.stringValue
        }

        func controlTextDidBeginEditing(_ notification: Notification) {
            (notification.object as? NSTextField)?.currentEditor().flatMap { $0 as? NSTextView }?.insertionPointColor = NSColor(PaperTheme.sage)
        }

        func controlTextDidEndEditing(_ notification: Notification) {
            parent.onFocus(false)
        }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            switch selector {
            case #selector(NSResponder.insertTab(_:)): return parent.onTab(1)
            case #selector(NSResponder.insertBacktab(_:)): return parent.onTab(-1)
            case #selector(NSResponder.insertNewline(_:)):
                let flags = NSApp.currentEvent?.modifierFlags ?? []
                parent.onSubmit(flags.contains(.shift), flags.contains(.command))
                return true
            case #selector(NSResponder.cancelOperation(_:)): return parent.onEscape()
            case #selector(NSResponder.moveUp(_:)): return parent.onArrow(-1)
            case #selector(NSResponder.moveDown(_:)): return parent.onArrow(1)
            default: return false
            }
        }
    }

    final class KeyField: NSTextField {
        var onFocus: () -> Void = {}
        var onUndo: () -> Bool = { false }
        var onCommandReturn: () -> Void = {}

        override func becomeFirstResponder() -> Bool {
            let became = super.becomeFirstResponder()
            if became {
                onFocus()
                (currentEditor() as? NSTextView)?.insertionPointColor = NSColor(PaperTheme.sage)
            }
            return became
        }

        override func performKeyEquivalent(with event: NSEvent) -> Bool {
            guard currentEditor() != nil, event.type == .keyDown else { return super.performKeyEquivalent(with: event) }
            let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])
            if flags == [.command], event.keyCode == UInt16(kVK_ANSI_Z), stringValue.isEmpty, onUndo() { return true }
            if flags == [.command], event.keyCode == UInt16(kVK_Return) || event.keyCode == UInt16(kVK_ANSI_KeypadEnter) {
                onCommandReturn()
                return true
            }
            return super.performKeyEquivalent(with: event)
        }
    }
}

// MARK: - The chips

/// The guesses over the text: the picked one outlined in sage, and `Tab` when there's a choice.
struct IntentChips: View {
    let candidates: [Intent.Candidate]
    let picked: Int
    var now = Date()
    var onPick: (Int) -> Void = { _ in }

    var body: some View {
        FlowLayout(spacing: 5, lineSpacing: 5) {
            ForEach(Array(candidates.enumerated()), id: \.offset) { index, candidate in
                let title = candidate.chip(.current, now: now)
                Button { onPick(index) } label: {
                    IntentChip(title: title, symbol: AppModel.symbol(candidate.kind), picked: index == picked)
                }
                .buttonStyle(.plain)
                .help(title)
                .accessibilityLabel(title)
                .accessibilityAddTraits(index == picked ? .isSelected : [])
            }
            if candidates.count > 1 {
                IntentChip(title: "Tab", symbol: nil, picked: false, faint: true)
                    .help(L("Tab: 다른 뜻으로"))
                    .accessibilityHidden(true)
            }
        }
    }
}

struct IntentChip: View {
    let title: String
    let symbol: String?
    let picked: Bool
    var faint = false

    var body: some View {
        HStack(spacing: 5) {
            if let symbol { Image(systemName: symbol).font(.system(size: 10.5, weight: .medium)) }
            Text(title).lineLimit(1)
        }
        .font(.system(size: 11, weight: .medium).monospacedDigit())
        .foregroundStyle(picked ? PaperTheme.sageText : faint ? PaperTheme.ink3 : PaperTheme.ink2)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .frame(minHeight: 21)
        .background(picked ? PaperTheme.sage2 : PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            if picked { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) }
        }
        .contentShape(RoundedRectangle(cornerRadius: 8))
    }
}

/// Lays chips out in rows, wrapping when a row is full.
struct FlowLayout: Layout {
    var spacing: CGFloat = 6
    var lineSpacing: CGFloat = 6
    /// Rows packed to the right (buttons in a footer).
    var trailing = false

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let width = rows.map { $0.width }.max() ?? 0
        let height = rows.map(\.height).reduce(0, +) + CGFloat(max(0, rows.count - 1)) * lineSpacing
        return CGSize(width: min(width, proposal.width ?? width), height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = trailing ? bounds.maxX - row.width : bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(ProposedViewSize(width: min(bounds.width, subviews[index].sizeThatFits(.unspecified).width), height: nil))
                subviews[index].place(at: CGPoint(x: x, y: y + (row.height - size.height) / 2), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height + lineSpacing
        }
    }

    private struct Row { var indices: [Int] = []; var width: CGFloat = 0; var height: CGFloat = 0 }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var row = Row()
        for index in subviews.indices {
            var size = subviews[index].sizeThatFits(.unspecified)
            size.width = min(size.width, width)
            if !row.indices.isEmpty && row.width + spacing + size.width > width {
                rows.append(row)
                row = Row()
            }
            row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
            row.height = max(row.height, size.height)
            row.indices.append(index)
        }
        if !row.indices.isEmpty { rows.append(row) }
        return rows
    }
}

// MARK: - The line on the note

/// 입력 줄: at the bottom of the 오늘 and 앞으로 sheets (and in the 오늘 창) — write anything; the
/// chips show what it'll become, Tab picks another, Return makes it and a toast offers 바꾸기. On
/// 메모 the line makes memos (no chips).
struct IntentLineView: View {
    @ObservedObject var model: AppModel
    let page: AppModel.Page
    /// Snapshots: text already typed.
    var previewText: String?
    var previewFocused = false
    /// Where the toast shows: the note's (model.toast) unless the line sits elsewhere (the 오늘 창).
    var toast: Binding<PaperToast?>?
    /// The 오늘 창: a shorter line (20 pt high), the short placeholder.
    var compact = false
    /// Puts the keyboard in the line when it changes (the 오늘 창 opening).
    var focusRequest: Int?
    /// Words put into the line from outside (the 오늘 창's empty cards), then cleared.
    var prefill: Binding<String?>?
    @State private var localFocus = 0
    @State private var text = ""
    @State private var picked = 0
    @State private var focused = false
    @State private var width: CGFloat = 400
    @Environment(\.colorSchemeContrast) private var contrast

    @State private var reading = IntentReading()

    private var typing: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    /// Read once per text (and minute): the body is drawn more than once per key press (1.39).
    private var candidates: [Intent.Candidate] { !typing ? [] : reading.candidates(text, model: model) }
    private var problem: Intent.Problem? { Intent.problem(text, language: .current) }
    private var active: Bool { focused || previewFocused }

    var body: some View {
        let candidates = self.candidates
        VStack(alignment: .leading, spacing: 6) {
            if !candidates.isEmpty {
                IntentChips(candidates: candidates, picked: min(picked, candidates.count - 1)) { picked = $0 }
            }
            HStack(spacing: 8) {
                IntentField(text: $text, placeholder: placeholder, font: model.notebookFont.handNSFont(compact ? 18 : 20),
                            focusRequest: (focusRequest ?? model.focusRequest) + localFocus,
                            onFocus: { focused = $0; model.inputLineFocused = $0 },
                            onTab: { step in
                                guard candidates.count > 1 else { return false }
                                picked = (picked + step + candidates.count) % candidates.count
                                return true
                            },
                            onSubmit: { shift, command in submit(literal: shift, asEvent: command) },
                            onEscape: escape,
                            onUndo: undo,
                            accessibilityLabel: L("입력 줄"))
                    .frame(height: compact ? 22 : 26)
                    .accessibilityHint(L("할 일, 일정, 타이머, 알람이나 메모를 적어요. Tab으로 다른 뜻을 골라요."))
                // No fade between the shortcut chip and the ↩ hint: a half-faded chip lingered while typing.
                trailing(readable: !candidates.isEmpty)
                    .transaction { $0.animation = nil }
            }
            if let problem {
                Text(problem.text(.current))
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(PaperTheme.clayText)
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, compact ? 6 : 8)
        .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(active ? PaperTheme.sage : contrast == .increased ? PaperTheme.ink3 : PaperTheme.rule, lineWidth: 1.5)
        }
        .background {
            // The focus halo: 4 pt of sage2 around the card.
            if active {
                RoundedRectangle(cornerRadius: 15, style: .continuous).fill(PaperTheme.sage2).padding(-4)
            }
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .onChange(of: text) { picked = 0 }
        .onChange(of: prefill?.wrappedValue) { _, words in
            guard let words else { return }
            text = words
            prefill?.wrappedValue = nil
            localFocus += 1
        }
        .onAppear { if let previewText { text = previewText } }
        .animation(.easeOut(duration: 0.12), value: candidates.count)
    }

    private var placeholder: String {
        // 오늘 꼭 하나 (1.38): the day's first line asks for the one thing.
        if page == .todos && !compact && model.asksForDailyPick {
            let long = L("오늘 꼭 하나만 고른다면?")
            let needed = (long as NSString).size(withAttributes: [.font: model.notebookFont.handNSFont(20)]).width
            return needed > width - 84 ? L("오늘 꼭 하나만?") : long
        }
        let long = L("무엇이든 적어요 — 할 일, 일정, 타이머 40…")
        // The long one only when all of it fits beside the shortcut chip (English and Dutch run wider).
        let room = width - 20 - (model.quickEntryEnabled && width >= 260 ? 64 : 0)
        let needed = (long as NSString).size(withAttributes: [.font: model.notebookFont.handNSFont(20)]).width
        return compact || width < 370 || needed > room ? L("무엇이든 적어요") : long
    }

    /// `readable`: Return would put something in — a slash line it can't read dims the hint.
    @ViewBuilder
    private func trailing(readable: Bool) -> some View {
        if typing {
            HStack(spacing: 4) {
                KeyCap("↩")
                Text(L("넣기"))
            }
            .font(.system(size: 10.5, weight: .semibold))
            .foregroundStyle(PaperTheme.ink3)
            .fixedSize()
            .opacity(readable ? 1 : 0.35)
        } else if model.quickEntryEnabled && !compact && width >= 260 {
            KeyCap("⌃⌥N")
                .help(L("어디서든 ⌃⌥N으로 빠른 입력"))
        }
    }

    private func submit(literal: Bool, asEvent: Bool) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        var list = model.intentCandidates(trimmed)
        var index = min(picked, max(0, list.count - 1))
        if literal {
            // ⇧Return: the text as it is, a to-do.
            list = [.todo(QuickParse(title: trimmed))]
            index = 0
        } else if asEvent, let event = list.firstIndex(where: { $0.kind == .event }) {
            index = event
        }
        guard !list.isEmpty else { return } // a slash line that can't be read: the hint says why
        guard let commit = model.commitIntent(text: trimmed, candidates: list, index: index, page: page) else { return }
        text = ""
        picked = 0
        shownToast = model.makeToast(for: commit, onChange: { shownToast = $0 })
    }

    /// The toast this line talks to.
    private var shownToast: PaperToast? {
        get { toast.map(\.wrappedValue) ?? model.toast }
        nonmutating set { if let toast { toast.wrappedValue = newValue } else { model.toast = newValue } }
    }

    private func escape() -> Bool {
        if shownToast != nil { shownToast = nil; return true }
        if !text.isEmpty { text = ""; return true }
        return false
    }

    /// ⌘Z while the toast is up: what was just made goes, and its words come back to the line.
    private func undo() -> Bool {
        guard let commit = shownToast?.commit else { return false }
        model.takeBack(commit)
        shownToast = nil
        text = commit.text
        return true
    }
}

/// The line's last reading, kept while the text (and the minute, and what 바꾸기 taught) stay the same.
@MainActor
final class IntentReading {
    private var key: (text: String, minute: Int, memory: Intent.Memory)?
    private var list: [Intent.Candidate] = []

    func candidates(_ text: String, model: AppModel, now: Date = Date()) -> [Intent.Candidate] {
        let minute = Int(now.timeIntervalSince1970 / 60)
        let memory = model.intentMemory
        if let key, key.text == text, key.minute == minute, key.memory == memory { return list }
        list = model.intentCandidates(text, now: now)
        key = (text, minute, memory)
        return list
    }
}

/// The toast over the bottom of a sheet's list (오늘 · 앞으로).
struct ToastHost: View {
    @ObservedObject var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        if let toast = model.toast {
            ToastView(toast: toast, seconds: toast.seconds ?? 4) { if model.toast?.id == toast.id { model.toast = nil } }
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
                .transition(reduceMotion ? .opacity : .move(edge: .bottom).combined(with: .opacity))
                .id(toast.id)
        }
    }
}
