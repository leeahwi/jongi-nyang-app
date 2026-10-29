import AppKit
import PaperCore
import SwiftUI

extension Notification.Name {
    static let paperCommitEditing = Notification.Name("paperCommitEditing")
}

struct PaperView: View {
    @ObservedObject var model: AppModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// The peeking cat nods when a task is checked off.
    @State var mascotNod = false
    @State private var rowDrop: TaskRowDrop?
    /// Snapshots: the input line drawn with text in it.
    var previewLine: String?
    /// Snapshots: 앞으로 with a drag under way onto a day.
    var previewAheadDrag: (source: UUID, target: AheadDropTarget)?
    /// Snapshots: the 하루 띠 at a fixed time.
    var previewNow: Date?

    /// The note's height: the 하루 띠's rows and its open day follow it.
    @State private var height: CGFloat = 560
    /// The list's rows (for the ruled paper under them); `.greatestFiniteMagnitude` once they fill the sheet.
    @State private var listHeight: CGFloat = 0
    /// The header's tools (pin, 책상, ⋯) as drawn, so the tab row's variants are measured against a stand-in of the
    /// same width rather than four copies of the tools (1.39: the ⋯ menu measured four times on every redraw).
    @State var toolbarWidth: CGFloat = 110
    /// The narrowest variant is showing: the tools leave out 책상.
    @State var headerSmall = false
    /// 1.38: a short note keeps a one-line header.
    var compactHeader: Bool { height <= NoteHeader.compactBelow }

    var body: some View {
        // 집중: the focus card instead of the sheet while a focus on a to-do runs.
        FocusSwitch(state: model.timerState) { focusing in
            if focusing {
                FocusCardView(model: model, state: model.timerState)
            } else {
                note
            }
        }
    }

    private var note: some View {
        VStack(spacing: 0) {
            // Above what follows: the cat's paws hang over the edge onto the ribbon or the list.
            header.zIndex(1)
            if model.page == .ahead {
                AheadPageView(model: model, previewDrag: previewAheadDrag, previewLine: previewLine)
            } else {
                DayStripView(model: model, calendar: model.calendar, noteHeight: height, compact: height < 470, now: previewNow)
                // 할 일 스페이스 (1.45): what the list hides while one space shows (nothing otherwise).
                SpaceLensBand(model: model)
                todayList
                    .overlay(alignment: .bottom) { ToastHost(model: model) }
                Group {
                    // 할 일 골라 집중…: the pick banner stands where the input line was.
                    if model.focusPicking { FocusPickBanner(model: model) }
                    else { IntentLineView(model: model, page: .todos, previewText: previewLine, previewFocused: previewLine != nil) }
                }
                    .padding(.horizontal, 12)
                    .padding(.top, 8)
                    .padding(.bottom, 8)
                footer
            }
        }
        .background(PaperBackground())
        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { height = $0 }
        .overlay {
            if model.showsGuide { GuideView(model: model).transition(.opacity) }
        }
        .foregroundStyle(PaperTheme.ink)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.18), value: model.visibleItems.map(\.id))
        .onChange(of: model.completedCount) { old, new in
            guard new > old, !reduceMotion else { return }
            // A nod: 2° and a 2 pt dip, 400 ms there and back.
            withAnimation(.easeOut(duration: 0.2)) { mascotNod = true }
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(200))
                withAnimation(.easeIn(duration: 0.2)) { mascotNod = false }
            }
        }
        .onChange(of: model.page) { model.toast = nil }
        .onChange(of: compactHeader, initial: true) { _, compact in
            // The header drags the window: as tall as it is now (the focus card sets its own).
            guard !model.timerState.isFocusing, let window = NSApp.windows.first(where: { $0 is NoteWindow }) as? NoteWindow else { return }
            window.dragHeight = NoteHeader.tabRow + (compact ? NoteHeader.compactTitleBlock : NoteHeader.titleBlock)
        }
        .eventSheetPanel(calendar: model.calendar)
    }

    /// Washi tabs for the three pages, then the title block; see HeaderVariants.swift.
    private var header: some View { indexTabsHeader }

    // MARK: Today's list: 다음, then the rest

    /// #31: the to-dos the 하루 띠 shows in its 지금 · 다음 block (DayStripView's own state), for the rows' small mark.
    /// None while the strip is off or the day is open.
    private func stripMarks(width: CGFloat) -> [String: DayStrip.Mode] {
        let calendar = model.calendar
        let now = previewNow ?? Date()
        guard calendar.showsStrip, !calendar.isDayOpen(now: now) else { return [:] }
        let items = DayStrip.items(events: calendar.todayEvents(now: now), tasks: model.todayItems, now: now)
        return DayStrip.marks(DayStrip.state(items, now: now, rows: DayStrip.rowLimit(width: Double(width), height: Double(height))))
    }

    private var todayList: some View {
        let visible = model.visibleItems
        let split = TodayGroups.split(visible, series: model.series, now: Date(), first: model.todayPickID)
        let byID = Dictionary(uniqueKeysWithValues: visible.map { ($0.id, $0) })
        let next = split.next.compactMap { byID[$0] }
        let rest = split.rest.compactMap { byID[$0] }
        // Worked out once here and handed to the rows (#61): each row asking the model filtered the whole sheet, twice.
        let restIDs = rest.map(\.id)
        let firstID = visible.first?.id, lastID = visible.last?.id
        let shared = TaskRowShared(model)
        return GeometryReader { geometry in
            let marks = stripMarks(width: geometry.size.width)
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    VStack(spacing: 0) {
                      // Lazy (1.39): only the rows on screen are built and laid out — the whole sheet was, on every
                      // key press and tab switch.
                      LazyVStack(spacing: 0) {
                        if split.showsHeaders {
                            GroupHeader(title: L("다음"), count: next.count).padding(.top, 4)
                        }
                        ForEach(next) { item in
                            TaskRow(item: item, model: model, rowDrop: $rowDrop, ruled: true, draggable: false, nextTime: split.times[item.id],
                                    stripMark: marks[item.id.uuidString], edges: RowEdges(item.id, first: firstID, last: lastID), shared: shared)
                        }
                        if split.showsHeaders {
                            // Not "오늘 할 일" again under the page title of that name.
                            GroupHeader(title: L("그 밖에"), count: rest.count).padding(.top, 8)
                        }
                        ForEach(rest) { item in
                            TaskRow(item: item, model: model, rowDrop: $rowDrop, ruled: true, stripMark: marks[item.id.uuidString], groupRows: restIDs,
                                    edges: RowEdges(item.id, first: firstID, last: lastID), shared: shared)
                        }
                        if model.todayItems.isEmpty {
                            EmptySheetNote(pose: .happy, text: L("오늘 할 일을 한 줄 적어 볼까요?"))
                        }
                        if model.remainingCount == 0 && !model.todayItems.isEmpty {
                            allDoneNote
                                .transition(.opacity.combined(with: .move(edge: .top)))
                        }
                      }
                      // Rows as tall as the sheet or taller are kept as one value: the rules below are one row then,
                      // whatever the rows add up to. The lazy stack's height is a guess that moves by a point or so on
                      // each layout; fed back in, every guess redrew the whole sheet and laid it out again — with 2,000
                      // rows the line going from empty to written (or back with Esc) went round 500–900 times, 4–14 s.
                      .onGeometryChange(for: CGFloat.self) { [sheet = geometry.size.height] in
                          $0.size.height < sheet ? $0.size.height : .greatestFiniteMagnitude
                      } action: { listHeight = $0 }
                        // The paper's lines carry on below the last row.
                        PaperRules().frame(height: max(PaperTheme.rowHeight, geometry.size.height - listHeight))
                    }
                    .frame(maxWidth: .infinity, minHeight: geometry.size.height, alignment: .top)
                    .overlay(alignment: .leading) {
                        Rectangle()
                            .fill(PaperTheme.marginRule)
                            .frame(width: 0.6)
                            .padding(.leading, PaperTheme.margin)
                            .allowsHitTesting(false)
                    }
                }
                .scrollIndicators(.never) // never a legacy scroller: its 17 pt gutter shifted the rules and meta
                .scrollEdgeFade()
                .onChange(of: model.selectedTaskID) { _, id in
                    guard let id else { return }
                    withAnimation(reduceMotion ? nil : .easeOut(duration: 0.2)) { proxy.scrollTo(id, anchor: .center) }
                }
            }
        }
    }

    /// Pin, 책상 and ⋯ (접기 and the rest are in the ⋯ menu).
    @ViewBuilder
    func toolbarIcons(desk: Bool = true) -> some View {
                Button {
                    model.alwaysOnTop.toggle()
                } label: {
                    Image(systemName: model.alwaysOnTop ? "pin.fill" : "pin")
                        .font(.system(size: 12.5, weight: .regular))
                        .rotationEffect(.degrees(model.alwaysOnTop ? -25 : 0))
                        .foregroundStyle(model.alwaysOnTop ? PaperTheme.sage : PaperTheme.ink2)
                }
                .buttonStyle(QuietButtonStyle(size: 26))
                .help(model.alwaysOnTop ? L("항상 위에 두기 해제") : L("항상 위에 두기"))
                .accessibilityLabel("항상 위에 두기")
                .accessibilityValue(model.alwaysOnTop ? L("켬") : L("끔"))

                // 1.43: 메모 서랍 (where the 메모 tab's memos went).
                Button(action: model.toggleMemoDrawer) {
                    Image(systemName: "pawprint").font(.system(size: 12.5, weight: .regular))
                }
                .buttonStyle(QuietButtonStyle(size: 26))
                .help(model.drawer.shortcut.map { L("메모 서랍 (\($0.text))") } ?? L("메모 서랍"))
                .accessibilityLabel(L("메모 서랍"))

                if desk {
                Button { model.showDesk(.calendar) } label: {
                    Image(systemName: "sidebar.left").font(.system(size: 12.5, weight: .regular))
                }
                .buttonStyle(QuietButtonStyle(size: 26))
                .help("책상 — 달력 · 기록 · 시계 · 설정 (⌘ D)")
                .accessibilityLabel("책상 열기")
                }

                // ⋯ (#18): the same groups in the same order as Windows' moreMenu() — 만들기 | 찾기 | 보기 | 창 | 책상 |
                // 종이냥 · 타이머 | 편집 | 목록 | 도움 — with the menu bar's keys beside them.
                Menu {
                    Button("새 할 일", action: model.focusNewTask)
                        .keyboardShortcut("n")
                    Button("새 일정…") { model.newEvent() }
                    Button("빠른 메모…", action: model.showQuickMemo)
                        .keyboardShortcut("m", modifiers: [.control, .option])
                    Divider()
                    Button("검색…") { model.onSearch?() }
                        .keyboardShortcut("f")
                    Button("메모 서랍", action: model.toggleMemoDrawer)
                    Divider()
                    Picker("글꼴", selection: $model.notebookFont) {
                        ForEach(NotebookFont.allCases) { font in
                            Text("\(font.title)  \(font.preview)").tag(font)
                        }
                    }
                    Picker("글자 크기", selection: $model.textSize) {
                        ForEach(NotebookTextSize.allCases) { Text($0.title).tag($0) }
                    }
                    Toggle("완료 숨기기", isOn: $model.hideCompleted)
                    Divider()
                    Button("포스트잇으로 접기", action: model.minimizeToIcon)
                        .keyboardShortcut("m")
                    Toggle("화면 오른쪽에 붙이기", isOn: Binding(get: { model.dockedSide?() == .right }, set: { _ in model.onDockNote?(.right) }))
                    Toggle("화면 왼쪽에 붙이기", isOn: Binding(get: { model.dockedSide?() == .left }, set: { _ in model.onDockNote?(.left) }))
                    Divider()
                    Button("달력…", action: model.showCalendar)
                        .keyboardShortcut("d")
                    Button("완료 기록…", action: model.showHistory)
                        .keyboardShortcut("y")
                    Button("반복 할 일…", action: model.showRepeatSettings)
                    Button("알람…", action: model.showAlarmSettings)
                    Button("설정…", action: model.showReminderSettings)
                        .keyboardShortcut(",")
                    Divider()
                    Toggle("종이냥 펫", isOn: $model.petVisible)
                        .keyboardShortcut("p", modifiers: [.command, .shift])
                    Menu("타이머") {
                        ForEach(TimerLength.presets + model.timerRecent, id: \.self) { minutes in
                            Button("\(minutes)분 타이머") { model.petCommand(.countdown(minutes: minutes)) }
                        }
                        Button("직접 정하기…") { model.petCommand(.chooseLength) }
                        Button("뽀모도로 시작") { model.petCommand(.pomodoro) }
                        Button("할 일 골라 집중…") { model.petCommand(.pickFocus) }
                        Divider()
                        Button("일시정지 · 계속") { model.petCommand(.togglePause) }
                        Button("중지") { model.petCommand(.stop) }
                    }
                    Divider()
                    Button("완료한 일 정리", action: model.clearCompleted)
                        .disabled(model.completedCount == 0)
                    Button("실행 취소", action: model.undo).disabled(!model.canUndo)
                        .keyboardShortcut("z")
                    Button("다시 실행", action: model.redo).disabled(!model.canRedo)
                        .keyboardShortcut("z", modifiers: [.command, .shift])
                    Divider()
                    Button("목록 복사", action: model.copyTasks).disabled(model.items.isEmpty)
                        .keyboardShortcut("c", modifiers: [.command, .shift])
                    Button("텍스트로 내보내기…", action: model.exportTasks).disabled(model.items.isEmpty)
                        .keyboardShortcut("e")
                    Divider()
                    Button("사용 안내", action: model.showGuide)
                    Button("도움말…", action: model.showHelp)
                        .keyboardShortcut("?")
                    Button("키보드 단축키", action: model.showShortcuts)
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 14, weight: .medium))
                        .frame(width: 26, height: 26)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .foregroundStyle(PaperTheme.ink2)
                .help("더 보기")
                .accessibilityLabel("더 보기")
    }

    private var allDoneNote: some View {
        HStack(spacing: 8) {
            Image(systemName: "leaf").font(.system(size: 11))
            Text(L("오늘 한 장 끝! 수고했어요").handwritten)
                .font(model.notebookFont.bodyFont(model.textSize))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.trailing, 16)
        .foregroundStyle(PaperTheme.sage)
        .padding(.leading, PaperTheme.margin + 17)
        .frame(maxWidth: .infinity, minHeight: PaperTheme.rowHeight, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var footer: some View {
        HStack(spacing: 8) {
            if let error = model.storageError {
                Button {
                    model.showStorageError(error)
                } label: {
                    Label("저장 폴더 확인", systemImage: "exclamationmark.circle")
                        .foregroundStyle(PaperTheme.clayText)
                }
                .buttonStyle(.plain)
            } else {
                // 1.45 (#20): the same footer with or without to-dos — the empty sheet's word is the cat's, above.
                historyButton
            }
            Spacer(minLength: 8)
            // Nothing done yet: nothing to hide — gone, but its place kept, so nothing moves when the first is done.
            let nothingDone = model.completedCount == 0
            Button {
                model.hideCompleted.toggle()
            } label: {
                Text(model.hideCompleted ? L("완료 보기") : L("완료 숨기기")).lineLimit(1)
            }
            .buttonStyle(.plain)
            .disabled(nothingDone)
            .help("완료한 할 일 표시 전환")
            .foregroundStyle(PaperTheme.faded)
            .opacity(nothingDone ? 0 : 1)
            .accessibilityHidden(nothingDone)
        }
        .font(.system(size: 11))
        .foregroundStyle(PaperTheme.secondary)
        .padding(.horizontal, 20)
        .frame(height: 32)
        .overlay(alignment: .top) {
            Rectangle().fill(PaperTheme.rule).frame(height: 0.6)
                .padding(.horizontal, 16)
        }
    }

    private var historyButton: some View {
        Button(action: model.showHistory) {
            HStack(spacing: 4) {
                Image(systemName: "leaf").font(.system(size: 11))
                Text("완료 기록").lineLimit(1)
            }
            .padding(.horizontal, 6)
            .frame(height: 22)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(PaperTheme.secondary)
        .help("완료 기록 (⌘ Y)")
        .accessibilityLabel("완료 기록 보기")
    }
}

/// A small group heading in the list: "다음 · 2", "오늘 할 일 · 3" (앞으로: "다음 주 · 2"; no count
/// when a section has only events).
struct GroupHeader: View {
    let title: String
    let count: Int?
    /// Where the title starts: past the margin line on 오늘, at the date column on 앞으로.
    var leading: CGFloat = PaperTheme.margin + 17

    var body: some View {
        HStack {
            Text(title)
            Spacer(minLength: 8)
            if let count { Text("\(count)").monospacedDigit() }
        }
        .font(.system(size: 10.5, weight: .semibold))
        .tracking(0.5)
        .foregroundStyle(PaperTheme.ink3)
        .padding(.leading, leading)
        .padding(.trailing, 22)
        .frame(height: 20)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

extension View {
    /// A soft 12 pt fade at the top and bottom of a scrolling list instead of a hard cut.
    func scrollEdgeFade(_ size: CGFloat = 12) -> some View {
        mask {
            VStack(spacing: 0) {
                LinearGradient(colors: [.black.opacity(0), .black], startPoint: .top, endPoint: .bottom).frame(height: size)
                Color.black
                LinearGradient(colors: [.black, .black.opacity(0)], startPoint: .top, endPoint: .bottom).frame(height: size)
            }
        }
    }
}

/// How a row sits: on the ruled sheet (오늘), or inside a day of 앞으로 (shorter, narrower gutter).
enum TaskRowStyle {
    case sheet, inset

    var height: CGFloat { self == .sheet ? PaperTheme.rowHeight : 36 }
    /// Room for the drag handle on the left.
    var handle: CGFloat { self == .sheet ? 24 : 16 }
    /// The checkbox's column and the box itself.
    var checkColumn: CGFloat { self == .sheet ? PaperTheme.margin - 24 : 22 }
    var box: CGFloat { self == .sheet ? 19 : 17 }
    var titleGap: CGFloat { self == .sheet ? 17 : 6 }
}

/// Whether a row is the first or the last of today's visible rows: 위로 · 아래로 이동 can't go further.
struct RowEdges: Equatable {
    var first: Bool
    var last: Bool

    init(_ id: UUID, first: UUID?, last: UUID?) {
        self.first = first == id
        self.last = last == id
    }
}

/// What the rows of a list share of the model, read once as the list is drawn (#61).
@MainActor
struct TaskRowShared {
    let selected: UUID?
    let pick: UUID?
    let editRequest: UUID?
    let editingReminder: UUID?
    let font: NotebookFont
    let textSize: NotebookTextSize
    let dueStyle: DueStyle
    let focusPicking: Bool

    init(_ model: AppModel) {
        selected = model.selectedTaskID
        pick = model.todayPickID
        editRequest = model.editRequestID
        editingReminder = model.editingTaskReminderID
        font = model.notebookFont
        textSize = model.textSize
        dueStyle = model.dueStyle
        focusPicking = model.focusPicking
    }
}

/// What one row shows of the model: the row is drawn again when this (or the task) changes, not on every change.
struct TaskRowLook: Equatable {
    var selected: Bool
    var picked: Bool
    var editRequested: Bool
    var editingReminder: Bool
    var aiMarked: Bool
    var space: TodoSpaces.Space?
    var series: Series?
    var font: NotebookFont
    var textSize: NotebookTextSize
    var dueStyle: DueStyle
    var focusPicking: Bool
    var edges: RowEdges

    @MainActor
    init(_ item: TodoItem, model: AppModel, shared: TaskRowShared, edges: RowEdges) {
        selected = shared.selected == item.id
        picked = shared.pick == item.id
        editRequested = shared.editRequest == item.id
        editingReminder = shared.editingReminder == item.id
        aiMarked = model.isAIMarked(item.id.uuidString)
        space = model.spaceOf(item.id)
        series = item.seriesID.flatMap { id in model.series.first { $0.id == id } }
        font = shared.font
        textSize = shared.textSize
        dueStyle = shared.dueStyle
        focusPicking = shared.focusPicking
        self.edges = edges
    }
}

/// A row's right-click menu, worked out when SwiftUI asks for the menu — not every time the row is drawn (#61). It
/// watches the model itself, so a menu opened again shows the model as it is then (spaces, recent lengths, the day).
private struct TaskRowContextMenu: View {
    @ObservedObject var model: AppModel
    let item: TodoItem
    let onShelf: Bool
    let actions: TaskRowMenu.Actions
    let edges: RowEdges

    var body: some View {
        RowMenuContent(items: TaskRowMenu.items(model, item: item, onShelf: onShelf, actions: actions),
                       disabled: TaskRowMenu.disabled(isFirst: edges.first, isLast: edges.last))
    }
}

/// What a 앞으로 row shows at its end instead of the D-3 / ~금 caption.
enum AheadMeta: Equatable {
    /// In a day: a small flag (the day says when).
    case due
    /// Under 그 뒤: its date, "11월 3일 (화)".
    case date(String)
}

struct TaskRow: View {
    let item: TodoItem
    /// On 앞으로: 오늘 하기 / 마감 날짜 instead of 나중에 / 알림, and moves by dropping on a day.
    var onShelf = false
    /// Not watched (#61): what the row shows of the model is `look`, from the list that draws it, so a change redraws
    /// only the rows it touches. Every row watched the whole model: a check redrew every row built so far (all of
    /// them once ↑ had scrolled to the last), 2.8–13.9 s with 2,000 to-dos.
    let model: AppModel
    let look: TaskRowLook
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hovering = false
    @State private var editing = false
    @State private var editText = ""
    @Binding var rowDrop: TaskRowDrop?
    /// Design snapshots draw a row as if hovered.
    var previewHover = false
    /// The 오늘 list draws each row's own rule (its groups break the paper's even lines).
    var ruled = false
    /// Rows in 다음 sit by time: no handle.
    var draggable = true
    /// In 다음: when it's due today (a reminder, or a repeat's time).
    var nextTime: Date?
    /// #31: shown in the 하루 띠's 지금 · 다음 block too — a small 지금 or 다음 before the row's time.
    var stripMark: DayStrip.Mode?
    /// The rows a drag moves among (the row's group); all visible rows when nil.
    var groupRows: [UUID]?
    var style: TaskRowStyle = .sheet
    var aheadMeta: AheadMeta?
    /// 앞으로: the drag reports where the pointer is, and its end, to the page (days are drop targets).
    var onDragPoint: ((CGPoint) -> Void)?
    var onDragEnd: ((Bool) -> Void)?
    @State private var strikeProgress: CGFloat = 0
    /// The row's width: narrow rows (1.38) show the move buttons as arrows only, so the title keeps some room.
    @State private var rowWidth: CGFloat = 420
    @State private var checkPop = false
    @State private var showingReminderEditor = false
    @State private var editorOnDeadline = false
    @State private var editorOnTime = false
    @FocusState private var editFocused: Bool
    /// Started with Return on a selected row: finishing hands the keyboard back to the list.
    @State private var editFromKeyboard = false

    /// `edges`: first or last of today's visible rows (the menu's 위로 · 아래로), from the list; asked of the model when
    /// nil. `shared`: what the list's rows share of the model, read once for them all; read here when nil.
    init(item: TodoItem, onShelf: Bool = false, model: AppModel, rowDrop: Binding<TaskRowDrop?>, previewHover: Bool = false,
         ruled: Bool = false, draggable: Bool = true, nextTime: Date? = nil, stripMark: DayStrip.Mode? = nil, groupRows: [UUID]? = nil,
         edges: RowEdges? = nil, shared: TaskRowShared? = nil, style: TaskRowStyle = .sheet, aheadMeta: AheadMeta? = nil,
         onDragPoint: ((CGPoint) -> Void)? = nil, onDragEnd: ((Bool) -> Void)? = nil) {
        self.item = item
        self.onShelf = onShelf
        self.model = model
        _rowDrop = rowDrop
        self.previewHover = previewHover
        self.ruled = ruled
        self.draggable = draggable
        self.nextTime = nextTime
        self.stripMark = stripMark
        self.groupRows = groupRows
        self.style = style
        self.aheadMeta = aheadMeta
        self.onDragPoint = onDragPoint
        self.onDragEnd = onDragEnd
        look = TaskRowLook(item, model: model, shared: shared ?? TaskRowShared(model),
                           edges: edges ?? RowEdges(item.id, first: model.visibleItems.first?.id, last: model.visibleItems.last?.id))
    }

    private var isFirst: Bool { look.edges.first }
    private var isLast: Bool { look.edges.last }
    private var hasReminder: Bool { item.reminderAt != nil }
    private var series: Series? { look.series }
    private var dropAfter: Bool? { rowDrop?.target == item.id ? rowDrop?.after : nil }

    var body: some View {
        HStack(spacing: 0) {
            if !draggable || (onShelf && onDragPoint == nil) { Color.clear.frame(width: style.handle, height: style.height) } else { dragHandle }
            Button {
                commitEdit()
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) {
                    model.toggle(item.id)
                }
            } label: {
                ZStack {
                    RoundedRectangle(cornerRadius: 5)
                        .fill(item.isCompleted ? PaperTheme.sage : PaperTheme.card.opacity(0.6))
                    RoundedRectangle(cornerRadius: 5)
                        .strokeBorder(item.isCompleted ? PaperTheme.sage : PaperTheme.checkBorder.opacity(hovering ? 1 : 0.85), lineWidth: 1.5)
                    if item.isCompleted {
                        Image(systemName: "checkmark")
                            .font(.system(size: 10.5, weight: .bold))
                            .foregroundStyle(PaperTheme.onSage)
                    }
                }
                .frame(width: style.box, height: style.box)
                // Checking: the box fills sage with a short pop (0.85 → 1, 160 ms).
                .scaleEffect(checkPop ? 0.85 : 1)
                .rotationEffect(.degrees(style == .sheet ? -2 : 0))
                .frame(width: style.checkColumn, height: style.height)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(item.isCompleted ? L("완료 취소") : L("완료 표시"))
            .accessibilityLabel("\(item.title) 완료")
            .accessibilityValue(item.isCompleted ? L("완료됨") : L("미완료"))

            taskContent
                .font(look.font.bodyFont(style == .sheet ? look.textSize : look.textSize.smaller ?? .small))
                .tint(PaperTheme.sage)
                .padding(.leading, style.titleGap)
                .padding(.trailing, 8)
            // One place at the end of the row: what the task has (deadline, alert, repeat) as quiet
            // text, and on hover the same place turns into its buttons. Nothing covers the title;
            // at rest the title keeps the full width, and only the hovered row makes room.
            Group {
                if offersFocus && (showsActions || isSelected) { focusPickButton.transition(.opacity) }
                else if showsActions { actionBar.transition(.opacity) } else { meta.transition(.opacity) }
            }
            .animation(.easeOut(duration: 0.12), value: showsActions)
            .layoutPriority(1)
            Color.clear.frame(width: style == .sheet ? 14 : 4)
        }
        .frame(height: style.height)
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { rowWidth = $0 }
        .contentShape(Rectangle())
        .background(rowBackground)
        .overlay(alignment: .leading) {
            // 할 일 스페이스 (1.45): the space's colour band on 오늘's rows only (phase 1).
            if style == .sheet && !onShelf, let space = look.space {
                SpaceBand(space: space, height: style.height, faded: item.isCompleted)
            }
        }
        .overlay(alignment: .bottom) {
            if ruled {
                Rectangle().fill(PaperTheme.rule).frame(height: 0.6)
                    .padding(.leading, 18).padding(.trailing, 20)
                    .allowsHitTesting(false)
            }
        }
        .opacity(rowDrop?.source == item.id ? 0.55 : 1)
        .onHover { hovering = $0 }
        .onTapGesture {
            // A click on the row's empty area picks it for the keyboard.
            NSApp.keyWindow?.makeFirstResponder(nil)
            model.selectedTaskID = item.id
        }
        .onChange(of: look.editRequested) { _, requested in
            guard requested else { return }
            model.editRequestID = nil
            beginEdit()
            editFromKeyboard = true
        }
        .accessibilityAddTraits(isSelected ? .isSelected : [])
        .popover(isPresented: $showingReminderEditor, arrowEdge: .trailing) {
            TaskReminderEditorView(
                item: item, model: model,
                onSave: { date in model.setTaskReminder(item.id, at: date); showingReminderEditor = false },
                onRemove: { model.setTaskReminder(item.id, at: nil); showingReminderEditor = false },
                onCancel: { showingReminderEditor = false },
                startOnDeadline: editorOnDeadline,
                startOnTime: editorOnTime
            )
        }
        .onChange(of: showingReminderEditor) { _, shown in
            if !shown && model.editingTaskReminderID == item.id { model.editingTaskReminderID = nil }
        }
        .onChange(of: look.editingReminder) { _, editing in
            if showingReminderEditor && !editing { showingReminderEditor = false }
        }
        .contextMenu {
            TaskRowContextMenu(model: model, item: item, onShelf: onShelf, actions: menuActions, edges: look.edges)
        }
        .overlay(alignment: dropAfter == true ? .bottom : .top) {
            if dropAfter != nil {
                HStack(spacing: 0) {
                    Circle().fill(PaperTheme.sage).frame(width: 5, height: 5)
                    Rectangle().fill(PaperTheme.sage).frame(height: 2)
                }
                .padding(.leading, style == .sheet ? PaperTheme.margin + 9 : style.handle + 2)
                .padding(.trailing, style == .sheet ? 12 : 4)
                .allowsHitTesting(false)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .paperCommitEditing)) { _ in commitEdit() }
        .onAppear { strikeProgress = item.isCompleted ? 1 : 0 }
        .onChange(of: item.isCompleted) { _, completed in
            // Checking draws the pencil line left to right (220 ms); unchecking clears it at once.
            guard completed, !reduceMotion else {
                strikeProgress = completed ? 1 : 0
                return
            }
            strikeProgress = 0
            withAnimation(.easeOut(duration: 0.22)) { strikeProgress = 1 }
            checkPop = true
            withAnimation(.easeOut(duration: 0.16)) { checkPop = false }
        }
    }

    private var isSelected: Bool { look.selected && !editing }

    /// What the right-click menu (TaskRowMenu) does with this row.
    private var menuActions: TaskRowMenu.Actions {
        TaskRowMenu.Actions(edit: beginEdit, reminder: openReminderEditor, deadline: { openEditor(deadline: true) },
                            time: { openEditor(time: true) }, calendar: openCalendarSheet, moveUp: moveUp, moveDown: moveDown)
    }

    private func openCalendarSheet() {
        commitEdit()
        let calendar = model.calendar
        calendar.sheet = CalendarSheetRequest(mode: .send, draft: .forTask(
            title: item.title, reminderAt: item.reminderAt, dueDate: item.dueDate, now: Date(),
            color: calendar.lastColor, taskId: item.id.uuidString))
    }

    private var rowBackground: some View {
        ZStack {
            if isSelected {
                // Picked with the keyboard: a soft tint and a bar on the margin line.
                RoundedRectangle(cornerRadius: 4)
                    .fill(PaperTheme.sage.opacity(0.1))
                    .padding(.leading, style == .sheet ? 14 : 2)
                    .padding(.trailing, style == .sheet ? 7 : 0)
                Rectangle().fill(PaperTheme.sage).frame(width: 2)
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, style == .sheet ? PaperTheme.margin - 1 : 0)
            } else if hovering || editing {
                RoundedRectangle(cornerRadius: 4)
                    .fill(PaperTheme.sage.opacity(0.055))
                    .padding(.leading, style == .sheet ? 14 : 2)
                    .padding(.trailing, style == .sheet ? 7 : 0)
            }
            if dropAfter != nil {
                PaperTheme.accent.opacity(0.07)
            }
        }
    }

    private var dragHandle: some View {
        PaperTaskDragHandle { offset in
            guard onDragPoint == nil else { return }
            rowDrop = TaskRowDrop.destination(source: item.id, rows: groupRows ?? model.visibleItems.map(\.id), offsetFromSourceTop: offset)
        } onFinish: { accepted in
            if let onDragEnd { return onDragEnd(accepted) }
            if accepted, let drop = rowDrop {
                model.move(drop.source, relativeTo: drop.target, after: drop.after)
            }
            rowDrop = nil
        } onTabHover: { page in
            model.dragOverPage = page
        } onTabDrop: { page in
            rowDrop = nil
            model.dragOverPage = nil
            onDragEnd?(false)
            model.dropTask(item.id, on: page)
        } onPoint: { point in
            onDragPoint?(point)
        }
            .frame(width: style.handle, height: style.height)
            .opacity(hovering || rowDrop?.source == item.id ? 1 : 0)
            .animation(.easeOut(duration: 0.12), value: hovering)
            .accessibilityElement(children: .ignore)
            .help("잡아서 위아래로 끌어 순서 변경")
            .accessibilityLabel("\(item.title) 이동 손잡이")
            .accessibilityAction(named: Text("위로 이동"), moveUp)
            .accessibilityAction(named: Text("아래로 이동"), moveDown)
    }

    private var reminderTimeCaption: some View {
        TimelineView(.periodic(from: .now, by: 60)) { timeline in
            let sent = item.reminderLastDeliveredAt.map { $0 >= (item.reminderAt ?? .distantFuture) } ?? false
            let symbol = series != nil ? "repeat" : item.isCompleted ? "bell.slash" : sent ? "checkmark.circle" : "bell"
            let language = AppLanguage.current
            let text = (nextTime ?? item.reminderAt).map { Self.timeCaption($0, now: timeline.date) }
                ?? series.map { Self.repeatCaption($0.rule) }
                ?? ""
            let labels = [series.map { Repeat.describe($0.rule, remindAt: $0.remindAt, language: language) },
                          ReminderTimeText.rowLabel(for: item, now: timeline.date, language: language)].compactMap { $0 }
            let quiet = item.reminderAt != nil && (item.isCompleted || sent)
            Button(action: openReminderEditor) {
                HStack(spacing: 3) {
                    Image(systemName: symbol).font(.system(size: 9.5, weight: .semibold))
                    Text(text)
                }
                .font(.system(size: 11, weight: .medium))
                .monospacedDigit()
                .foregroundStyle(quiet ? PaperTheme.faded : PaperTheme.sage)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
                .frame(height: 24)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .fixedSize(horizontal: true, vertical: false)
            .help(labels.joined(separator: " · ") + " · " + L("눌러서 고치기"))
            .accessibilityLabel("\(item.title) 알림·반복: \(labels.joined(separator: ", "))")
        }
    }

    /// A row's time: just the clock when it's today ("16:00"), else with the day ("내일 09:00").
    static func timeCaption(_ date: Date, now: Date) -> String {
        let language = AppLanguage.current
        let (start, end) = CalendarDay.window(now)
        if date >= start && date < end {
            let parts = Calendar.current.dateComponents([.hour, .minute], from: date)
            return language.clock(hour: parts.hour!, minute: parts.minute!)
        }
        return ReminderTimeText.compact(date, relativeTo: now, language: language)
    }

    /// A repeat at the end of a row, short: "매일", "월·수·금" (the weekly days without "매주").
    static func repeatCaption(_ rule: RepeatRule, language: AppLanguage = .current) -> String {
        let text = Repeat.describe(rule, language: language)
        guard rule.kind == .weekly, (rule.weekdays ?? []).count < 7 else { return text }
        let prefix: String = switch language {
        case .ko: "매주 " // ko-only: the prefix the core writes
        case .en: "Every "
        case .nl: "Elke "
        }
        return text.hasPrefix(prefix) ? String(text.dropFirst(prefix.count)) : text
    }

    private var showsActions: Bool { (hovering || previewHover) && !editing }
    /// 할 일 골라 집중…: open rows offer 집중 (on hover, or always on the selected row).
    private var offersFocus: Bool { look.focusPicking && !item.isCompleted && !editing }

    /// At rest: the deadline and the alert or repeat, as quiet text.
    private var meta: some View {
        HStack(spacing: 10) {
            if !item.isCompleted, let stripMark { StripMarkTag(mode: stripMark) }
            if !item.isCompleted && !onShelf { carriedTag }
            if !item.isCompleted { SentToCalendarMark(calendar: model.calendar, taskID: item.id) }
            if let aheadMeta, let due = item.dueDate, !item.isCompleted {
                aheadCaption(aheadMeta, due: due)
            } else if let due = item.dueDate, !item.isCompleted { dueCaption(due) }
            if let range = shownRange { rangeCaption(range) }
            else if hasReminder || nextTime != nil || (series != nil && !item.isCompleted) { reminderTimeCaption }
        }
    }

    /// 1.39: a range on a day takes the bell's place at the end of the row.
    private var shownRange: TimeRange? {
        guard let range = item.timeRange, TimeBlock.day(of: item, now: Date()) != nil else { return nil }
        return range
    }

    /// "🕑 14:00–15:30": the task's time on its day (a reminder at another time stays in the tooltip).
    private func rangeCaption(_ range: TimeRange) -> some View {
        let text = range.text(.current)
        let reminder = item.reminderAt.flatMap { at -> String? in
            guard let start = TimeBlock.interval(of: item, now: Date())?.start, start != at else { return nil }
            return ReminderTimeText.rowLabel(for: item, now: Date(), language: .current)
        }
        return Button { openEditor(time: true) } label: {
            HStack(spacing: 3) {
                Image(systemName: "clock").font(.system(size: 9.5, weight: .semibold))
                Text(text)
            }
            .font(.system(size: 11, weight: .medium))
            .monospacedDigit()
            .foregroundStyle(item.isCompleted ? PaperTheme.faded : PaperTheme.sage)
            .lineLimit(1)
            .frame(height: 24)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .fixedSize(horizontal: true, vertical: false)
        .help(([L("시간 \(text)")] + [reminder].compactMap { $0 }).joined(separator: " · ") + " · " + L("눌러서 고치기"))
        .accessibilityLabel(L("\(item.title) 시간: \(text)"))
    }

    /// On hover, in the same place — three at most (#55 D-3, the user's pick; the title keeps its room). Today: → 내일 ·
    /// 알림 · ⋯. 앞으로: ↑ 오늘로 · 마감 · ⋯. Finished: ⋯. The rest (언젠가로 ⌥↓, 이거 집중 F, 지우기 ⌫ …) are in ⋯,
    /// which is the right-click menu (#17), for the mouse, keyboard and VoiceOver alike. Same as Windows.
    private var actionBar: some View {
        HStack(spacing: 2) {
            if !item.isCompleted {
                if onShelf {
                    moveButton(L("오늘로"), symbol: "arrow.up", help: L("오늘 할 일로 옮겨요")) { model.moveToToday(item.id) }
                        .accessibilityLabel("\(item.title) 오늘 하기")
                    rowIconButton("flag", help: item.dueDate == nil ? L("마감 정하기") : L("마감 날짜 바꾸기")) { openEditor(deadline: true) }
                        .accessibilityLabel("\(item.title) 마감 날짜")
                } else {
                    // 1.38: → 내일 (⌥→), then 알림.
                    moveButton(L("내일"), symbol: "arrow.right", help: L("내일 할 일로 옮겨요 (⌥→)")) { model.moveToTomorrow(item.id) }
                        .accessibilityLabel(L("\(item.title) 내일 하기"))
                    rowIconButton("bell", help: L("알림 · 반복 · 마감 설정"), action: openReminderEditor)
                        .accessibilityLabel("\(item.title) 알림 설정")
                }
            }
            rowIconButton("ellipsis", help: L("더 보기"), action: openRowMenu)
                .accessibilityLabel(L("더 보기"))
        }
    }

    /// ⋯: the right-click menu (TaskRowMenu), under the pointer that pressed it. A menu popped for the moment, so its
    /// keys (⌫, ⌥↓ …) are the menu's only while it is open, never the hovered row's.
    private func openRowMenu() {
        commitEdit()
        let items = TaskRowMenu.items(model, item: item, onShelf: onShelf, actions: menuActions)
        let menu = DrawerMenuBuilder.menu(items, palette: nil, font: model.notebookFont)
        let disabled = TaskRowMenu.disabled(isFirst: isFirst, isLast: isLast)
        for row in menu.items where disabled.contains(row.title) { row.isEnabled = false }
        guard let event = NSApp.currentEvent, let view = event.window?.contentView else { return }
        menu.popUp(positioning: nil, at: view.convert(event.locationInWindow, from: nil), in: view)
    }

    /// 어제부터 · 3일째: how long it has sat on today's sheet (ink3, before the time or deadline).
    @ViewBuilder
    private var carriedTag: some View {
        if nextTime == nil, let label = Carry.label(item, now: Date(), language: .current) {
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(PaperTheme.ink3)
                .lineLimit(1)
                .fixedSize()
                .help(L("오늘 할 일에 \(label) 있어요"))
        }
    }

    /// The pick state's button at the end of a row: 집중.
    private var focusPickButton: some View {
        Button { model.focus(on: item.id) } label: {
            HStack(spacing: 4) {
                Image(systemName: "timer").font(.system(size: 9.5, weight: .bold))
                Text("집중")
            }
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(PaperTheme.onSage)
            .padding(.horizontal, 10)
            .frame(height: 24)
            .background(PaperTheme.sage, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .help(L("이 할 일에 집중하기"))
        .accessibilityLabel(L("\(item.title)에 집중"))
        .padding(.trailing, 4)
    }

    /// Below this width the move buttons drop their words (English and Dutch words run longer).
    private var compactMoves: Bool { rowWidth < (AppLanguage.current == .ko ? 400 : 460) }

    /// "↑ 오늘로" / "↓ 언젠가" / "→ 내일": moving a task, in words rather than a symbol (just the arrow on a narrow row).
    private func moveButton(_ title: String, symbol: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 3) {
                Image(systemName: symbol).font(.system(size: 9, weight: .bold))
                if !compactMoves { Text(title) }
            }
            .frame(minWidth: compactMoves ? 10 : nil)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(PaperTheme.sageText)
            .padding(.horizontal, 8)
            .frame(height: 24)
            // Circular corners, not Capsule: Capsule's outline left hairlines at both ends.
            .background(PaperTheme.sage.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .circular))
            .overlay { RoundedRectangle(cornerRadius: 12, style: .circular).strokeBorder(PaperTheme.sage.opacity(0.25), lineWidth: 0.7) }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .help(help)
        .padding(.trailing, 4)
    }

    private func rowIconButton(_ symbol: String, help: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(PaperTheme.secondary)
                .frame(width: 26, height: 28)
                .contentShape(Rectangle())
        }
        .buttonStyle(RowIconButtonStyle())
        .help(help)
    }

    private func openReminderEditor() {
        openEditor(deadline: false)
    }

    private func openEditor(deadline: Bool = false, time: Bool = false) {
        editorOnDeadline = deadline
        editorOnTime = time
        model.prepareTaskReminderEditing(item.id)
        showingReminderEditor = true
    }

    /// "D-3" / "~금" as quiet text. Overdue reads in the accent colour, due soon in bold sage.
    private func dueCaption(_ key: String) -> some View {
        TimelineView(.periodic(from: .now, by: 300)) { timeline in
            let urgency = Deadline.urgency(key, now: timeline.date)
            let tint: Color = urgency == .overdue ? PaperTheme.clayText : urgency == .later ? PaperTheme.secondary : PaperTheme.sageText
            Button { openEditor(deadline: true) } label: {
                HStack(spacing: 3) {
                    Image(systemName: "flag").font(.system(size: 9.5, weight: .semibold))
                    Text(Deadline.label(key, style: look.dueStyle, now: timeline.date, language: .current))
                }
                .font(.system(size: 11, weight: urgency == .later ? .medium : .bold))
                .monospacedDigit()
                .foregroundStyle(tint)
                .lineLimit(1)
                .frame(height: 24)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .fixedSize()
            .help(Deadline.sentence(key, now: timeline.date, language: .current) + " · " + L("눌러서 고치기"))
            .accessibilityLabel("\(item.title) 마감: \(Deadline.sentence(key, now: timeline.date, language: .current))")
        }
    }

    /// 앞으로: a flag in a day (clay when it's in the next two days), or the date under 그 뒤.
    private func aheadCaption(_ meta: AheadMeta, due key: String) -> some View {
        let urgency = Deadline.urgency(key, now: Date())
        let sentence = Deadline.sentence(key, now: Date(), language: .current)
        return Button { openEditor(deadline: true) } label: {
            HStack(spacing: 3) {
                Image(systemName: "flag").font(.system(size: 9.5, weight: .semibold))
                if case .date(let text) = meta { Text(text) }
            }
            .font(.system(size: 11, weight: .medium))
            .monospacedDigit()
            // A quiet ink flag: the day column already says when. Clay only when late (spec: clay = 곧 · 늦음).
            .foregroundStyle(urgency == .overdue ? PaperTheme.clayText : PaperTheme.ink3)
            .lineLimit(1)
            .frame(height: 24)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .fixedSize()
        .help(sentence + " · " + L("눌러서 고치기"))
        .accessibilityLabel("\(item.title) 마감: \(sentence)")
    }

    @ViewBuilder
    private var taskContent: some View {
        if editing {
            TextField("할 일", text: $editText)
                .textFieldStyle(.plain)
                .focused($editFocused)
                .onSubmit {
                    commitEdit()
                    returnToList()
                }
                .onExitCommand {
                    editing = false
                    editFocused = false
                    returnToList()
                }
                .onChange(of: editFocused) { _, focused in
                    if !focused { commitEdit() }
                }
                .accessibilityLabel("할 일 고치기")
        } else {
            HStack(spacing: 5) {
            if look.picked && !onShelf {
                // 오늘 꼭 하나: a small star before the title, until the day ends.
                Image(systemName: "star.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(PaperTheme.sage)
                    .help(L("오늘 꼭 하나"))
                    .accessibilityLabel(L("오늘 꼭 하나"))
            }
            Group {
                // AI 연결 (1.42): Claude added or changed it today — the stamp, or its small seal when the title
                // would otherwise be squeezed.
                if look.aiMarked {
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 6) { titleText; AIStamp() }
                        HStack(spacing: 6) { titleText.frame(minWidth: 110, idealWidth: 110, alignment: .leading); AIStamp() }
                        HStack(spacing: 5) { titleText; AIStamp(compact: true) }
                    }
                } else {
                    titleText
                }
            }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
                .onTapGesture(perform: beginEdit)
                .accessibilityAddTraits(.isButton)
                .accessibilityAction { beginEdit() }
                .help(item.title + " — " + L("눌러서 고치기"))
            }
        }
    }

    private var titleText: some View {
        Text(item.title.handwritten)
            .foregroundStyle(item.isCompleted ? PaperTheme.faded : PaperTheme.ink)
            .lineLimit(1)
            .overlay {
                PencilStrike().trim(from: 0, to: strikeProgress)
                    .stroke(PaperTheme.ink.opacity(0.62), style: StrokeStyle(lineWidth: 1.25, lineCap: .round, lineJoin: .round))
                    .allowsHitTesting(false)
            }
    }

    /// After a keyboard edit the row stays picked, so ↑↓ and Space carry on from it.
    private func returnToList() {
        guard editFromKeyboard else { return }
        editFromKeyboard = false
        model.selectedTaskID = item.id
        DispatchQueue.main.async { NSApp.keyWindow?.makeFirstResponder(nil) }
    }

    private func beginEdit() {
        editFromKeyboard = false
        editText = item.title
        editing = true
        editFocused = true
    }

    private func commitEdit() {
        guard editing else { return }
        editing = false
        editFocused = false
        model.rename(item.id, to: editText)
    }

    private func moveUp() {
        guard !isFirst else { return }
        model.move(item.id, by: -1)
    }

    private func moveDown() {
        guard !isLast else { return }
        model.move(item.id, by: 1)
    }
}

/// The hand-drawn line across a finished task's title.
struct PencilStrike: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: 0, y: rect.height * 0.56))
        path.addCurve(
            to: CGPoint(x: rect.width, y: rect.height * 0.48),
            control1: CGPoint(x: rect.width * 0.30, y: rect.height * 0.48),
            control2: CGPoint(x: rect.width * 0.68, y: rect.height * 0.60)
        )
        return path
    }
}


private struct RowIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(PaperTheme.sage.opacity(configuration.isPressed ? 0.16 : 0), in: RoundedRectangle(cornerRadius: 6))
            .scaleEffect(configuration.isPressed ? 0.92 : 1)
    }
}

/// A to-do put on the calendar: a small calendar at the end of its row.
private struct SentToCalendarMark: View {
    @ObservedObject var calendar: EventBook
    let taskID: UUID

    var body: some View {
        if calendar.isSent(taskID) {
            Image(systemName: "calendar")
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(PaperTheme.sage.opacity(0.7))
                .help("달력에 넣은 할 일")
                .accessibilityLabel("달력에 넣은 할 일")
        }
    }
}

/// #31: "지금" on the row the 하루 띠 shows going on now (sage text on its tint, 4.5:1 and more on both papers; #47: not "다음").
struct StripMarkTag: View {
    let mode: DayStrip.Mode

    var body: some View {
        let word = DayStrip.markWord(mode, language: .current)
        Text(word)
            .font(.system(size: 10.5, weight: .semibold))
            .foregroundStyle(PaperTheme.sageText)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 6)
            .frame(height: 17)
            .background(PaperTheme.sage2, in: Capsule())
            .help(mode == .now ? L("하루 띠의 ‘지금’에도 있어요") : L("하루 띠의 ‘다음’에도 있어요"))
            .accessibilityLabel(word)
    }
}
