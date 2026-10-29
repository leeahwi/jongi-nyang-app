import AppKit
import PaperCore
import SwiftUI

// MARK: - todo-spaces.json in the model (할 일 스페이스, 1.45)

extension AppModel {
    var todoSpacesURL: URL { storageFolderURL.appendingPathComponent(TodoSpaces.fileName) }

    static func spaceIndex(_ spaces: TodoSpaces) -> [UUID: TodoSpaces.Space] {
        var out: [UUID: TodoSpaces.Space] = [:]
        for (todo, space) in spaces.index() {
            if let id = UUID(uuidString: todo) { out[id] = space }
        }
        return out
    }

    /// At launch: the file, or no spaces; an unreadable one is moved aside with one notice (S21).
    func loadTodoSpaces(now: Date = Date()) {
        guard let data = try? Data(contentsOf: todoSpacesURL) else {
            todoSpaces = TodoSpaces()
            knownSpacesData = nil
            return
        }
        do {
            todoSpaces = try TodoSpaces.decode(data)
            knownSpacesData = data
        } catch {
            moveSpacesAside(now: now)
            todoSpaces = TodoSpaces()
            knownSpacesData = nil
        }
    }

    private func moveSpacesAside(now: Date) {
        let aside = storageFolderURL.appendingPathComponent(TodoSpaces.asideName(now))
        if (try? FileManager.default.moveItem(at: todoSpacesURL, to: aside)) != nil {
            storageError = L("스페이스 파일을 읽지 못해서 스페이스 없이 시작했어요. 할 일은 모두 그대로예요.") + " " + Self.keptAside(aside)
        }
    }

    /// Another device changed the file: merged in — the file's copy is the one already there, this Mac's comes in (W3).
    /// One that doesn't read may be half synced: it's read again on the next checks, and moved aside on the third (W21).
    func catchUpTodoSpaces() {
        guard let data = try? Data(contentsOf: todoSpacesURL), data != knownSpacesData else { return }
        guard let theirs = try? TodoSpaces.decode(data) else {
            spacesBadReads += 1
            if spacesBadReads >= 3 {
                spacesBadReads = 0
                knownSpacesData = nil
                moveSpacesAside(now: Date())
            }
            return
        }
        spacesBadReads = 0
        knownSpacesData = data
        let merged = TodoSpaces.merge(existing: theirs, incoming: todoSpaces)
        if merged != todoSpaces { todoSpaces = merged }
    }

    /// Every change: catch up with the file, change, drop old entries of gone to-dos and old tombstones (S17, S22), write.
    func changeTodoSpaces(now: Date = Date(), _ change: (inout TodoSpaces, Date) -> Void) {
        guard !savingStopped else { return }
        catchUpTodoSpaces()
        var spaces = todoSpaces
        change(&spaces, now)
        // Never pruned against a list that couldn't be read (it's empty then).
        if !items.isEmpty { spaces = spaces.pruned(todoIDs: Set(items.map(\.id.uuidString)), now: now) }
        if spaces != todoSpaces { todoSpaces = spaces }
        // The lens goes with its space (S12).
        if let lens = spaceLens, lens.spaceId != SpaceLens.none, spaces.space(lens.spaceId) == nil { spaceLens = nil }
        guard spaces.encoded().utf8.elementsEqual(knownSpacesData ?? Data()) == false else { return }
        let started = PerfProbe.now
        defer { PerfProbe.io("todo-spaces", since: started) }
        do {
            try spaces.save(to: todoSpacesURL)
            knownSpacesData = try? Data(contentsOf: todoSpacesURL)
        } catch {
            storageError = Self.saveProblem(L("스페이스를 저장하지 못했어요."))
        }
    }

    // MARK: Reading

    /// What the today tab shows now (everything once the 4 a.m. day has turned — S11).
    var spaceShown: SpaceLens.Shown {
        guard spaceLens != nil else { return .all }
        return SpaceLens.shown(spaceLens, spaces: todoSpaces, now: Date())
    }

    func spaceOf(_ id: UUID) -> TodoSpaces.Space? { spaceIndex[id] }

    /// Open to-dos on today's sheet in a space (nil: in none); every one for `.all`.
    func openCount(_ shown: SpaceLens.Shown) -> Int {
        todayItems.reduce(0) { $0 + (!$1.isCompleted && shown.includes(spaceIndex[$1.id]?.id) ? 1 : 0) }
    }

    /// The band's N: open to-dos the lens hides.
    var hiddenOpenCount: Int {
        let shown = spaceShown
        guard shown != .all else { return 0 }
        return todayItems.reduce(0) { $0 + (!$1.isCompleted && !shown.includes(spaceIndex[$1.id]?.id) ? 1 : 0) }
    }

    /// The name of what's shown (nil: 스페이스 없음), for the band and the header button.
    func spaceName(_ shown: SpaceLens.Shown) -> String? {
        if case .space(let id) = shown { return todoSpaces.space(id)?.name }
        return nil
    }

    /// A line read for its space: the lens counts on the note's 오늘 sheet and in 빠른 입력 (M16).
    func spaceReading(_ text: String, lens: Bool) -> SpaceToken.Reading {
        SpaceToken.read(text, spaces: todoSpaces, lens: lens ? spaceShown : .all)
    }

    // MARK: Changing

    /// 한 스페이스만 보기 (or everything): the header's popup, ⌥⌘1–9 · ⌥⌘0, the band's 모두 보기.
    func showSpace(_ shown: SpaceLens.Shown) {
        // At once, not animated: the sheet's row animation diffing 2,000 rows in and out took seconds (perf.sh --spaces).
        var instant = Transaction()
        instant.disablesAnimations = true
        withTransaction(instant) {
            spaceLens = SpaceLens.picked(shown, now: Date())
            selectedTaskID = nil
        }
    }

    /// The 4 a.m. turn (ArchiveStore's day tick): a lens from yesterday goes.
    func dropStaleSpaceLens(now: Date = Date()) {
        guard let lens = spaceLens, lens.day != Archive.dayKey(now) else { return }
        spaceLens = nil
    }

    /// Moves a to-do (nil: 스페이스 없음), with the toast and its 되돌리기.
    func moveTodo(_ id: UUID, toSpace space: String?, toast: Bool = true) {
        let before = todoSpaces.items[id.uuidString]
        let was = spaceIndex[id]?.id
        guard was != space else { return }
        changeTodoSpaces { spaces, now in spaces.move(id.uuidString, to: space, now: now) }
        guard toast else { return }
        let name = todoSpaces.space(space)?.name ?? SpaceWords.noSpace(.current)
        var shown = PaperToast(symbol: "square.stack", text: SpaceWords.moved(to: name, language: .current))
        shown.action = L("되돌리기")
        shown.takeBack = { [weak self] in self?.putBack(id, before: before) }
        shown.perform = { [weak self] in
            self?.putBack(id, before: before)
            self?.toast = nil
        }
        self.toast = shown
    }

    /// 되돌리기 of a move: back where it was (a new time, so it wins a merge); 스페이스 없음 when that space is gone.
    private func putBack(_ id: UUID, before: TodoSpaces.Place?) {
        changeTodoSpaces { spaces, now in
            let space = before?.space.flatMap { spaces.space($0) != nil ? $0 : nil }
            spaces.move(id.uuidString, to: space, now: now)
        }
    }

    /// A new space (the name asked first); returns its id.
    @discardableResult
    func addTodoSpace(name: String, color: TodoSpaces.Color? = nil) -> String? {
        let clean = MemoFolders.cleanName(name)
        guard !clean.isEmpty else { return nil }
        var made: String?
        changeTodoSpaces { spaces, now in made = spaces.addSpace(name: clean, color: color, now: now) }
        return made
    }

    /// 새 스페이스…: asks for the name on a slip, makes it and (from a row) moves the to-do there.
    func newTodoSpace(moving todo: UUID? = nil) {
        guard let name = SlipAlert.askName(title: L("새 스페이스"), message: L("스페이스 이름"), placeholder: L("회사, 집, 공부…")),
              let id = addTodoSpace(name: name) else { return }
        if let todo { moveTodo(todo, toSpace: id) }
    }

    func renameTodoSpace(_ id: String, to name: String) {
        changeTodoSpaces { spaces, now in spaces.rename(id, to: name, now: now) }
    }

    func recolorTodoSpace(_ id: String, to color: TodoSpaces.Color) {
        changeTodoSpaces { spaces, now in spaces.recolor(id, to: color, now: now) }
    }

    func reorderTodoSpaces(_ ids: [String]) {
        changeTodoSpaces { spaces, now in spaces.reorder(ids, now: now) }
    }

    /// 지우기: its to-dos read as 스페이스 없음; the toast's 되돌리기 brings it back with them. `toast` nil: the note's.
    func deleteTodoSpace(_ id: String, toast: Binding<PaperToast?>? = nil) {
        guard let name = todoSpaces.space(id)?.name else { return }
        var moved: [String] = []
        changeTodoSpaces { spaces, now in moved = spaces.deleteSpace(id, now: now) ?? [] }
        var shown = PaperToast(symbol: "trash", text: SpaceWords.deleted(name, language: .current))
        shown.action = L("되돌리기")
        let restore = { [weak self] in
            guard let self else { return }
            self.changeTodoSpaces { spaces, now in spaces.restoreSpace(id, todoIDs: moved, now: now) }
        }
        shown.takeBack = restore
        shown.perform = { [weak self] in
            restore()
            if let toast { toast.wrappedValue = nil } else { self?.toast = nil }
        }
        if let toast { toast.wrappedValue = shown } else { self.toast = shown }
    }

    /// The line made a to-do: the space it picked (a new one made first). Returns a space the line made.
    func placeMadeTodo(_ id: UUID, choice: SpaceToken.Choice?) -> String? {
        switch choice {
        case .space(let space):
            changeTodoSpaces { spaces, now in spaces.move(id.uuidString, to: space, now: now) }
            return nil
        case .new(let name):
            var made: String?
            changeTodoSpaces { spaces, now in
                made = spaces.addSpace(name: name, now: now)
                if let made { spaces.move(id.uuidString, to: made, now: now) }
            }
            return made
        case .noSpace, nil:
            return nil
        }
    }

    /// The line's commit taken back: a space it made goes too, when nothing else is in it.
    func takeBackMadeSpace(_ id: String) {
        guard !spaceIndex.values.contains(where: { $0.id == id }) else { return }
        changeTodoSpaces { spaces, now in _ = spaces.deleteSpace(id, now: now) }
    }
}

// MARK: - The colour band and dots

/// A menu row's mark for a space.
enum SpaceDot: Equatable {
    case color(TodoSpaces.Color)
    /// 모든 스페이스.
    case all
    /// 스페이스 없음.
    case empty
}

extension PaperTheme {
    /// 할 일 스페이스 (1.45): the band's colour — the space colour's deep side, ≥ 3:1 on day and night paper (M11).
    static let spaceLavender = token("#897ccf", night: "#9a8fd6")
    static let spacePink = token("#d16776", night: "#d9828f")
    static let spaceMint = token("#54966a", night: "#6fae84")
    static let spaceYellow = token("#a78527", night: "#d1a93a")
    static let spaceSky = token("#578bcd", night: "#6f9bd4")
    static let spacePeach = token("#d46b2b", night: "#e09466")
    static let spaceSand = token("#9f8550", night: "#b9a274")
    static let spaceGray = token("#8c887e", night: "#9a978e")

    static func space(_ color: TodoSpaces.Color) -> Color {
        switch color {
        case .lavender: spaceLavender
        case .pink: spacePink
        case .mint: spaceMint
        case .yellow: spaceYellow
        case .sky: spaceSky
        case .peach: spacePeach
        case .sand: spaceSand
        case .gray: spaceGray
        }
    }

    /// The menus' dot: a small rounded square in the band's colour; 모든 스페이스 two colours, 스페이스 없음 an empty one.
    static func spaceDot(_ dot: SpaceDot) -> NSImage {
        NSImage(size: NSSize(width: 14, height: 14), flipped: false) { rect in
            let box = rect.insetBy(dx: 2.5, dy: 2.5)
            let path = NSBezierPath(roundedRect: box, xRadius: 2.5, yRadius: 2.5)
            switch dot {
            case .color(let color):
                NSColor(space(color)).setFill()
                path.fill()
            case .all:
                NSGraphicsContext.saveGraphicsState()
                path.addClip()
                NSColor(space(.pink)).setFill()
                NSRect(x: box.minX, y: box.minY, width: box.width / 2, height: box.height).fill()
                NSColor(space(.sky)).setFill()
                NSRect(x: box.midX, y: box.minY, width: box.width / 2, height: box.height).fill()
                NSGraphicsContext.restoreGraphicsState()
            case .empty:
                NSColor.tertiaryLabelColor.setStroke()
                path.lineWidth = 1
                path.stroke()
            }
            return true
        }
    }
}

/// The band at a today row's left end: 4 pt, about 55 % of the row, rounded on the right; its space's name on hover.
struct SpaceBand: View {
    let space: TodoSpaces.Space
    var height: CGFloat = PaperTheme.rowHeight
    var faded = false

    var body: some View {
        UnevenRoundedRectangle(cornerRadii: .init(topLeading: 0, bottomLeading: 0, bottomTrailing: 2, topTrailing: 2), style: .continuous)
            .fill(PaperTheme.space(space.colorKey))
            .frame(width: 4, height: (height * 0.55).rounded())
            .opacity(faded ? 0.45 : 1)
            .frame(width: 6, height: height, alignment: .leading)
            .contentShape(Rectangle())
            .help(space.name)
            .accessibilityElement()
            .accessibilityLabel(L("스페이스") + " " + space.name)
    }
}

// MARK: - The menus (one list of items for the app's NSMenu, SwiftUI's menus and the snapshots)

@MainActor
enum SpaceMenus {
    /// `모든 스페이스 ▾`: 모든 스페이스 (N), the spaces (colour, name, open count, ⌥⌘1–9), 스페이스 없음 (N), 스페이스 관리….
    static func header(_ model: AppModel) -> [DrawerMenuItem] {
        let shown = model.spaceShown
        let language = AppLanguage.current
        var all = DrawerMenuItem.action(SpaceWords.allSpaces(language), symbol: nil, key: ("0", [.command, .option]), checked: shown == .all) { model.showSpace(.all) }
        all.dot = .all
        all.detail = SpaceWords.grouped(model.openCount(.all), .current)
        var items: [DrawerMenuItem] = [all, .separator]
        for (index, space) in model.todoSpaces.visible.enumerated() {
            var row = DrawerMenuItem.action(space.name, symbol: nil, key: index < 9 ? ("\(index + 1)", [.command, .option]) : nil,
                                            checked: shown == .space(space.id)) { model.showSpace(.space(space.id)) }
            row.dot = .color(space.colorKey)
            row.detail = SpaceWords.grouped(model.openCount(.space(space.id)), .current)
            items.append(row)
        }
        var none = DrawerMenuItem.action(SpaceWords.noSpace(language), symbol: nil, checked: shown == .noSpace) { model.showSpace(.noSpace) }
        none.dot = .empty
        none.detail = SpaceWords.grouped(model.openCount(.noSpace), .current)
        items.append(none)
        items.append(.separator)
        items.append(.action(L("스페이스 관리…"), symbol: "slider.horizontal.3") { model.showDesk(.spaces) })
        return items
    }

    /// A row's 스페이스로 옮기기 ▸: the spaces (✓ the one it's in), 스페이스 없음, 새 스페이스… (the editor's field: no
    /// 새 스페이스…, W18).
    static func move(_ model: AppModel, _ id: UUID, offerNew: Bool = true) -> [DrawerMenuItem] {
        let current = model.spaceOf(id)?.id
        var items: [DrawerMenuItem] = model.todoSpaces.visible.map { space in
            var row = DrawerMenuItem.action(space.name, symbol: nil, checked: current == space.id) { model.moveTodo(id, toSpace: space.id) }
            row.dot = .color(space.colorKey)
            return row
        }
        if !items.isEmpty {
            items.append(.separator)
            var none = DrawerMenuItem.action(SpaceWords.noSpace(.current), symbol: nil, checked: current == nil) { model.moveTodo(id, toSpace: nil) }
            none.dot = .empty
            items.append(none)
        }
        if offerNew { items.append(.action(L("새 스페이스…"), symbol: "plus") { model.newTodoSpace(moving: id) }) }
        return items
    }

    /// A desk row's colour: the eight, ✓ the one it has.
    static func colors(_ model: AppModel, _ space: TodoSpaces.Space) -> [DrawerMenuItem] {
        TodoSpaces.Color.allCases.map { color in
            var row = DrawerMenuItem.action(color.title, symbol: nil, checked: space.colorKey == color) { model.recolorTodoSpace(space.id, to: color) }
            row.dot = .color(color)
            return row
        }
    }
}

/// DrawerMenuItems as SwiftUI menu content (the row's right-click menu, the editor's field).
struct SpaceMenuContent: View {
    let items: [DrawerMenuItem]

    var body: some View {
        ForEach(Array(items.enumerated()), id: \.offset) { _, item in
            switch item.kind {
            case .separator: Divider()
            case .action:
                if item.checked {
                    Toggle(isOn: Binding(get: { true }, set: { _ in item.action() })) { label(item) }
                } else {
                    Button(action: item.action) { label(item) }
                }
            default: EmptyView()
            }
        }
    }

    @ViewBuilder private func label(_ item: DrawerMenuItem) -> some View {
        if let dot = item.dot {
            Label { Text(item.title) } icon: { Image(nsImage: PaperTheme.spaceDot(dot)) }
        } else if let symbol = item.symbol {
            Label(item.title, systemImage: symbol)
        } else {
            Text(item.title)
        }
    }
}

/// A click opens `items` as an NSMenu (the memo drawer's kind) just under the SwiftUI view it covers: the header's
/// popup, the editor's space field, a desk row's colour. (A SwiftUI Menu on macOS drops a custom label's shapes.)
struct SpaceMenuArea: NSViewRepresentable {
    let label: String
    let items: @MainActor () -> [DrawerMenuItem]
    var font: NotebookFont = .pen

    func makeNSView(context: Context) -> ButtonView {
        let view = ButtonView()
        update(view)
        return view
    }

    func updateNSView(_ view: ButtonView, context: Context) { update(view) }

    private func update(_ view: ButtonView) {
        view.items = items
        view.font = font
        view.setAccessibilityLabel(label)
        view.toolTip = label
    }

    final class ButtonView: NSView {
        var items: @MainActor () -> [DrawerMenuItem] = { [] }
        var font: NotebookFont = .pen

        override init(frame: NSRect) {
            super.init(frame: frame)
            setAccessibilityElement(true)
            setAccessibilityRole(.menuButton)
        }

        required init?(coder: NSCoder) { nil }

        override var isFlipped: Bool { true }
        override func hitTest(_ point: NSPoint) -> NSView? { frame.contains(point) ? self : nil }
        override func mouseDown(with event: NSEvent) { open() }
        override func accessibilityPerformPress() -> Bool { open(); return true }

        func open() {
            guard window != nil else { return }
            let list = items()
            guard !list.isEmpty else { return }
            let menu = DrawerMenuBuilder.menu(list, palette: nil, font: font)
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: bounds.maxY + 4), in: self)
        }
    }
}

// MARK: - The header's button and the band over the list

/// `● 모든 스페이스 ▾` · `● 회사만 ▾` · `스페이스 없음 ▾` (W11): a click opens the popup. A narrow note keeps the dot and ▾.
struct SpaceHeaderButton: View {
    @ObservedObject var model: AppModel
    /// The dot and ▾ only (the compact header).
    var short = false

    var body: some View {
        let shown = model.spaceShown
        let space = model.todoSpaces.space(shown.lensID)
        let title: String = switch shown {
        case .all: SpaceWords.allSpaces(.current)
        case .noSpace: SpaceWords.noSpace(.current)
        case .space: SpaceWords.only(space?.name ?? "", language: .current)
        }
        ViewThatFits(in: .horizontal) {
            if !short { pill(title, shown: shown, space: space, short: false) }
            pill(title, shown: shown, space: space, short: true)
        }
        .overlay { SpaceMenuArea(label: title, items: { SpaceMenus.header(model) }, font: model.notebookFont) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L("스페이스") + ": " + title)
    }

    private func pill(_ title: String, shown: SpaceLens.Shown, space: TodoSpaces.Space?, short: Bool) -> some View {
        HStack(spacing: 5) {
            dot(shown, space: space)
            if !short {
                Text(title).lineLimit(1).fixedSize()
            }
            Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold))
        }
        .font(.system(size: 11.5, weight: shown == .all ? .medium : .semibold))
        .foregroundStyle(shown == .all ? PaperTheme.ink2 : PaperTheme.ink)
        .padding(.horizontal, 9)
        .frame(height: 24)
        .background {
            RoundedRectangle(cornerRadius: 9, style: .continuous).fill(PaperTheme.card)
            if let space { RoundedRectangle(cornerRadius: 9, style: .continuous).fill(PaperTheme.space(space.colorKey).opacity(0.16)) }
        }
        .overlay {
            RoundedRectangle(cornerRadius: 9, style: .continuous)
                .strokeBorder(space.map { PaperTheme.space($0.colorKey) } ?? PaperTheme.rule, lineWidth: 1)
        }
        .fixedSize()
        .help(title)
    }

    @ViewBuilder private func dot(_ shown: SpaceLens.Shown, space: TodoSpaces.Space?) -> some View {
        switch shown {
        case .space: RoundedRectangle(cornerRadius: 2).fill(PaperTheme.space(space?.colorKey ?? .lavender)).frame(width: 8, height: 8)
        case .noSpace: RoundedRectangle(cornerRadius: 2).strokeBorder(PaperTheme.ink3, lineWidth: 1).frame(width: 8, height: 8)
        case .all:
            HStack(spacing: 0) {
                Rectangle().fill(PaperTheme.spacePink)
                Rectangle().fill(PaperTheme.spaceSky)
            }
            .frame(width: 8, height: 8)
            .clipShape(RoundedRectangle(cornerRadius: 2))
        }
    }
}

/// Over the list while one space shows: `회사만 보는 중 · 다른 할 일 4개는 숨겼어요` and `모두 보기` (N = 0: no count).
struct SpaceLensBand: View {
    @ObservedObject var model: AppModel

    var body: some View {
        let shown = model.spaceShown
        if shown != .all {
            let space = model.todoSpaces.space(shown.lensID)
            let hidden = model.hiddenOpenCount
            let words = [SpaceWords.showing(space?.name, language: .current)] + (hidden > 0 ? [SpaceWords.hidden(hidden, language: .current)] : [])
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(words.joined(separator: " · ").keepingParticles)
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(PaperTheme.ink)
                    // Two lines at most: a text sized to its words would make the whole note taller (its minimum).
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Button { model.showSpace(.all) } label: {
                    Text(L("모두 보기"))
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(PaperTheme.ink)
                        .lineLimit(1)
                        .fixedSize()
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(L("모두 보기") + " (⌥⌘0)")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background {
                RoundedRectangle(cornerRadius: 9, style: .continuous).fill(PaperTheme.paper2)
                if let space { RoundedRectangle(cornerRadius: 9, style: .continuous).fill(PaperTheme.space(space.colorKey).opacity(0.12)) }
            }
            .overlay {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .strokeBorder(space.map { PaperTheme.space($0.colorKey).opacity(0.45) } ?? PaperTheme.rule, lineWidth: 1)
            }
            .padding(.horizontal, 14)
            .padding(.top, 6)
            .padding(.bottom, 2)
            .accessibilityElement(children: .contain)
        }
    }
}
