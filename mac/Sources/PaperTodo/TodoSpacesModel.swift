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
        guard let data = try? SafeFile.sharedData(todoSpacesURL) else {
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
        guard let data = try? SafeFile.sharedData(todoSpacesURL), data != knownSpacesData else { return }
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
        // The rules' spaces: never against a repeats.json that couldn't be read (S36).
        if !items.isEmpty {
            spaces = spaces.pruned(todoIDs: Set(items.map(\.id.uuidString)), seriesIDs: repeatsUnreadable ? nil : Set(series.map(\.id)), now: now)
        }
        if spaces != todoSpaces {
            // N3-7: a to-do moved here loses Claude's stamp, as an edit of the row does.
            let moved = aiMarks.ids.filter { spaces.spaceID(of: $0) != todoSpaces.spaceID(of: $0) }
            todoSpaces = spaces
            if !moved.isEmpty { ai?.clearMarks(moved) }
        }
        // The lens goes with its space (S12).
        if let lens = spaceLens, lens.spaceId != SpaceLens.none, spaces.space(lens.spaceId) == nil { spaceLens = nil }
        guard spaces.encoded().utf8.elementsEqual(knownSpacesData ?? Data()) == false else { return }
        let started = PerfProbe.now
        defer { PerfProbe.io("todo-spaces", since: started) }
        do {
            try spaces.save(to: todoSpacesURL)
            knownSpacesData = try? SafeFile.sharedData(todoSpacesURL)
        } catch {
            storageError = Self.saveProblem(L("스페이스를 저장하지 못했어요."))
        }
    }

    // MARK: Reading

    /// What the today tab shows now (everything once the 4 a.m. day has turned — S11).
    var spaceShown: SpaceLens.Shown {
        guard spaceLens != nil else { return .all }
        // #196 (D7): a lens on a space this Mac hides lets go.
        return SpaceDevice.lens(SpaceLens.shown(spaceLens, spaces: todoSpaces, now: Date()), hidden: hiddenOnNote)
    }

    func spaceOf(_ id: UUID) -> TodoSpaces.Space? { spaceIndex[id] }

    /// Open to-dos on today's sheet in a space (nil: in none); every one for `.all`.
    /// `everything` (the desk, D13): what this Mac hides counts too.
    func openCount(_ shown: SpaceLens.Shown, everything: Bool = false) -> Int {
        (everything ? allTodayItems : todayItems).reduce(0) { $0 + (!$1.isCompleted && shown.includes(spaceIndex[$1.id]?.id) ? 1 : 0) }
    }

    /// 2a (A1, A3–A5): today's sheet as the lens shows it (finished ones too) — the day strip, the timetable, the 오늘 창.
    var lensedTodayItems: [TodoItem] {
        let shown = spaceShown
        let today = todayItems
        return shown == .all ? today : today.filter { shown.includes(spaceIndex[$0.id]?.id) }
    }

    /// The space of a strip item's to-do (an event has none).
    func spaceOf(taskID: String?) -> TodoSpaces.Space? { taskID.flatMap(UUID.init(uuidString:)).flatMap { spaceIndex[$0] } }

    /// The band's N: open to-dos the lens hides.
    /// The band's N: open to-dos the lens hides (#196: of what this Mac shows; `here` leaves out what is peeked at too).
    func hiddenOpenCount(here: Bool) -> Int {
        let shown = spaceShown
        guard shown != .all else { return 0 }
        return (here ? hereTodayItems : todayItems).reduce(0) { $0 + (!$1.isCompleted && !shown.includes(spaceIndex[$1.id]?.id) ? 1 : 0) }
    }
    var hiddenOpenCount: Int { hiddenOpenCount(here: false) }

    /// The name of what's shown — a space's, or 일반's (#89); nil showing everything.
    func spaceName(_ shown: SpaceLens.Shown) -> String? {
        switch shown {
        case .space(let id): todoSpaces.space(id)?.name
        case .noSpace: generalName
        case .all: nil
        }
    }

    /// 일반 — the to-dos in no space — as it's called now: renamed, or ‘일반’ · ‘General’ · ‘Algemeen’ (#89).
    var generalName: String { todoSpaces.generalName(.current) }

    /// A line read for its space: the lens counts on the note's 오늘 sheet and in 빠른 입력 (M16).
    func spaceReading(_ text: String, lens: Bool) -> SpaceToken.Reading {
        SpaceToken.read(text, spaces: todoSpaces, lens: lens ? lineShown : .all)
    }

    /// The space the note's line writes into: a board column's `+ 회사에 넣기` (2b, I), else the lens's.
    var lineShown: SpaceLens.Shown { lineSpace ?? spaceShown }

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

    /// Moves a to-do (nil: 일반), with the toast and its 되돌리기.
    /// `alsoTakeBack` (2b, a drop between rows): what the toast's 되돌리기 undoes besides the space — the row's place.
    func moveTodo(_ id: UUID, toSpace space: String?, toast: Bool = true, alsoTakeBack: (() -> Void)? = nil) {
        let before = todoSpaces.items[id.uuidString]
        let was = spaceIndex[id]?.id
        guard was != space else { return }
        changeTodoSpaces { spaces, now in spaces.move(id.uuidString, to: space, now: now) }
        guard toast else { return }
        let name = todoSpaces.space(space)?.name ?? generalName
        var shown = PaperToast(symbol: "square.stack", text: SpaceWords.moved(to: name, language: .current))
        shown.action = L("되돌리기")
        shown.takeBack = { [weak self] in
            self?.putBack(id, before: before)
            alsoTakeBack?()
        }
        shown.perform = { [weak self] in
            self?.putBack(id, before: before)
            alsoTakeBack?()
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

    /// 일반 renamed (#89); blank or a default name: back to the default.
    func renameGeneral(to name: String) {
        changeTodoSpaces { spaces, now in spaces.renameGeneral(to: name, now: now) }
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

    // MARK: Repeat rules' spaces (2a)

    /// A rule's live space (nil: 일반).
    func ruleSpace(_ seriesID: String?) -> TodoSpaces.Space? { todoSpaces.space(todoSpaces.seriesSpaceID(of: seriesID)) }

    /// A9: a rule's space (nil: 일반); its open to-dos move with it. Nothing written when nothing changes (no file is
    /// made for someone without spaces).
    func setRuleSpace(_ seriesID: String, to space: String?) {
        let copies = items.filter { $0.seriesID == seriesID && !$0.isCompleted }.map(\.id.uuidString)
        var trial = todoSpaces
        trial.setSeriesSpace(seriesID, to: space, copies: copies, now: Date())
        guard trial != todoSpaces else { return }
        changeTodoSpaces { spaces, now in spaces.setSeriesSpace(seriesID, to: space, copies: copies, now: now) }
    }

    /// A10: to-dos just made from rules go to their rule's space.
    func placeMadeCopies(_ made: [TodoItem]) {
        let list = made.compactMap { item in item.seriesID.map { (todo: item.id.uuidString, series: $0) } }
        guard list.contains(where: { todoSpaces.seriesSpaceID(of: $0.series) != nil }) else { return }
        changeTodoSpaces { spaces, now in spaces.placeCopies(list, now: now) }
    }

    /// The line's commit taken back: a space it made goes too, when nothing else is in it — no to-do on the list (the
    /// taken-back one's entry stays in the file until it's pruned) and no repeat rule (2a).
    func takeBackMadeSpace(_ id: String) {
        guard !items.contains(where: { spaceIndex[$0.id]?.id == id }),
              !series.contains(where: { todoSpaces.seriesSpaceID(of: $0.id) == id }) else { return }
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
    /// 할 일 스페이스 (1.45): the band's colour — the space colour's deep side, ≥ 3:1 on every paper (M11; #244: each paper's own, NotePalette.swift).
    static var spaceLavender: Color { PaperLook.color(.spaceLavender) }
    static var spacePink: Color { PaperLook.color(.spacePink) }
    static var spaceMint: Color { PaperLook.color(.spaceMint) }
    static var spaceYellow: Color { PaperLook.color(.spaceYellow) }
    static var spaceSky: Color { PaperLook.color(.spaceSky) }
    static var spacePeach: Color { PaperLook.color(.spacePeach) }
    static var spaceSand: Color { PaperLook.color(.spaceSand) }
    static var spaceGray: Color { PaperLook.color(.spaceGray) }

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
    /// `모든 스페이스 ▾`: 모든 스페이스 (N), the spaces (colour, name, open count, ⌥⌘1–9), 일반 (N), 스페이스 관리….
    /// #185: while it is open a plain 1–9 picks the space in that place and 0 모든 스페이스, as on Windows (where
    /// Ctrl+Shift+digits may be the system's input-language keys).
    static func header(_ model: AppModel) -> [DrawerMenuItem] {
        let shown = model.spaceShown
        let language = AppLanguage.current
        var all = DrawerMenuItem.action(SpaceWords.allSpaces(language), symbol: nil, key: ("0", [.command, .option]), checked: shown == .all) { model.showSpace(.all) }
        all.digit = "0"
        all.dot = .all
        all.detail = SpaceWords.grouped(model.openCount(.all), .current)
        var items: [DrawerMenuItem] = [all, .separator]
        // #196: what this Mac hides (not peeked at) gathers under 이 기기에서 숨김, each with 보이기; the digits keep the order.
        let hidden = model.hiddenOnNote
        var hiddenRows: [DrawerMenuItem] = []
        var hideRows: [DrawerMenuItem] = []
        for (index, space) in model.todoSpaces.visible.enumerated() {
            if hidden.contains(space.id) {
                hiddenRows += hiddenRow(model, key: space.id, name: space.name, dot: .color(space.colorKey))
                continue
            }
            var row = DrawerMenuItem.action(space.name, symbol: nil, key: index < 9 ? ("\(index + 1)", [.command, .option]) : nil,
                                            checked: shown == .space(space.id)) { model.showSpace(.space(space.id)) }
            row.digit = index < 9 ? "\(index + 1)" : nil
            row.dot = .color(space.colorKey)
            row.detail = SpaceWords.grouped(model.openCount(.space(space.id)), .current)
            items.append(row)
            items += timeHint(model, key: space.id)
            var hide = DrawerMenuItem.action(space.name, symbol: nil) { model.setDeviceRule(space.id, .hide) }
            hide.dot = .color(space.colorKey)
            hideRows.append(hide)
        }
        let general = model.todoSpaces.generalName(language)
        if hidden.contains(SpaceDevice.none) {
            hiddenRows += hiddenRow(model, key: SpaceDevice.none, name: general, dot: .empty)
        } else {
            var none = DrawerMenuItem.action(general, symbol: nil, checked: shown == .noSpace) { model.showSpace(.noSpace) }
            none.dot = .empty
            none.detail = SpaceWords.grouped(model.openCount(.noSpace), .current)
            items.append(none)
            items += timeHint(model, key: SpaceDevice.none)
            var hide = DrawerMenuItem.action(general, symbol: nil) { model.setDeviceRule(SpaceDevice.none, .hide) }
            hide.dot = .empty
            hideRows.append(hide)
        }
        if !hiddenRows.isEmpty {
            items.append(.separator)
            items.append(.section(SpaceDevice.Words.hiddenSection.text(language)))
            items += hiddenRows
        }
        items.append(.separator)
        if !hideRows.isEmpty {
            // A submenu, not a button that shows on hover: the keyboard (→) reaches it too.
            items.append(.submenu(SpaceDevice.Words.hideHere.text(language), symbol: "eye.slash",
                                  hideRows + [.separator, .action(SpaceDevice.Words.setTimes.text(language), symbol: "clock") { model.showDesk(.spaces) }]))
        }
        // 2b: 스페이스별로 묶기 (⌥⌘G), this Mac's.
        items.append(.action(L("스페이스별로 묶기"), symbol: nil, key: ("g", [.command, .option]), checked: model.groupBySpace) { model.toggleGroupBySpace() })
        items.append(.action(L("스페이스 관리…"), symbol: "slider.horizontal.3") { model.showDesk(.spaces) })
        return items
    }

    /// #196: under a time-ruled space, its hint (‘지금은 숨김 · 평일 09:00–18:00에 보여요’ or ‘…에만 보여요’).
    private static func timeHint(_ model: AppModel, key: String) -> [DrawerMenuItem] {
        guard case .times(let times) = model.deviceRule(key) else { return [] }
        return [.section(SpaceDevice.hint(times, hiddenNow: model.isHiddenHere(key), .current))]
    }

    /// #196: a hidden space under 이 기기에서 숨김 — picking it shows it again (보이기, the time rule too), its hint below.
    private static func hiddenRow(_ model: AppModel, key: String, name: String, dot: SpaceDot) -> [DrawerMenuItem] {
        var row = DrawerMenuItem.action(name, symbol: nil) { model.setDeviceRule(key, nil) }
        row.dot = dot
        row.detail = SpaceDevice.Words.show.text(.current)
        return [row] + timeHint(model, key: key)
    }

    /// A row's 스페이스로 옮기기 ▸: the spaces (✓ the one it's in), 일반, 새 스페이스… (the editor's field: no
    /// 새 스페이스…, W18).
    static func move(_ model: AppModel, _ id: UUID, offerNew: Bool = true) -> [DrawerMenuItem] {
        // #168: the row's menu moves every picked row when it's one of them; the editor's field, its one to-do.
        let rows = offerNew ? model.pickedRows(including: id) : [id]
        let current = model.spaceOf(id)?.id
        var items: [DrawerMenuItem] = model.todoSpaces.visible.map { space in
            // #168: every picked row when this one is one of them.
            var row = DrawerMenuItem.action(space.name, symbol: nil, checked: current == space.id) { model.moveTodos(rows, toSpace: space.id) }
            row.dot = .color(space.colorKey)
            return row
        }
        if !items.isEmpty {
            items.append(.separator)
            var none = DrawerMenuItem.action(model.generalName, symbol: nil, checked: current == nil) { model.moveTodos(rows, toSpace: nil) }
            none.dot = .empty
            items.append(none)
        }
        if offerNew { items.append(.action(L("새 스페이스…"), symbol: "plus") { model.newTodoSpace(moving: id) }) }
        return items
    }

    /// 2a (A11): the rule editor's 스페이스 field — the spaces (✓ the one picked), 일반; `pick` keeps it until 저장.
    static func pick(_ model: AppModel, current: String?, _ pick: @escaping (String?) -> Void) -> [DrawerMenuItem] {
        var items: [DrawerMenuItem] = model.todoSpaces.visible.map { space in
            var row = DrawerMenuItem.action(space.name, symbol: nil, checked: current == space.id) { pick(space.id) }
            row.dot = .color(space.colorKey)
            return row
        }
        items.append(.separator)
        var none = DrawerMenuItem.action(model.generalName, symbol: nil, checked: current == nil) { pick(nil) }
        none.dot = .empty
        items.append(none)
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

    final class ButtonView: NSView, HeaderClickable {
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
        /// The first click opens it too: the note is often not in front (another app was), and without this the
        /// click only brought the note forward — 모든 스페이스 ▾ seemed dead.
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
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

/// 2a (A11): `스페이스  ● 회사 ⌃⌄` in the rule editor (desk → 반복): a click opens the spaces and 일반; applied on 저장.
struct RuleSpaceField: View {
    @ObservedObject var model: AppModel
    @Binding var space: String?

    var body: some View {
        let picked = model.todoSpaces.space(space)
        let name = picked?.name ?? model.generalName
        HStack(spacing: 8) {
            // One space here: "Space" (the desk's pane is "Spaces", M24).
            Text(String(localized: "스페이스", table: "Reminder"))
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(PaperTheme.ink2)
            HStack(spacing: 5) {
                if let picked {
                    RoundedRectangle(cornerRadius: 2).fill(PaperTheme.space(picked.colorKey)).frame(width: 8, height: 8)
                } else {
                    RoundedRectangle(cornerRadius: 2).strokeBorder(PaperTheme.ink3, lineWidth: 1).frame(width: 8, height: 8)
                }
                Text(name).lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 8, weight: .semibold)).foregroundStyle(PaperTheme.ink3)
            }
            .font(.system(size: 12, weight: .medium))
            .foregroundStyle(PaperTheme.ink)
            .padding(.horizontal, 8)
            .frame(height: 24)
            .background(PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .fixedSize()
            .overlay { SpaceMenuArea(label: name, items: { SpaceMenus.pick(model, current: space) { space = $0 } }, font: model.notebookFont) }
            .accessibilityLabel(String(localized: "스페이스", table: "Reminder") + " " + name)
            Spacer(minLength: 0)
        }
    }
}

/// 2a (A3, A6): a small round dot in a space's band colour (the day strip's titles, the focus card's line).
struct SpaceDotView: View {
    let space: TodoSpaces.Space
    var size: CGFloat = 6

    var body: some View {
        Circle().fill(PaperTheme.space(space.colorKey)).frame(width: size, height: size).accessibilityHidden(true)
    }
}

// MARK: - The header's button and the band over the list

/// `● 모든 스페이스 ▾` · `● 회사만 ▾` · `일반만 ▾` (#89): a click opens the popup. A narrow note keeps the dot and ▾. A
/// screen reader hears what the list hides too (#87): "회사만 보는 중, 다른 스페이스에 4개 더".
struct SpaceHeaderButton: View {
    @ObservedObject var model: AppModel
    /// The dot and ▾ only (the compact header).
    var short = false

    var body: some View {
        let shown = model.spaceShown
        let space = model.todoSpaces.space(shown.lensID)
        let name = model.spaceName(shown)
        let title = name.map { SpaceWords.only($0, language: .current) } ?? SpaceWords.allSpaces(.current)
        let spoken = name.map { SpaceWords.lensLabel($0, hidden: model.hiddenOpenCount, language: .current) } ?? title
        ViewThatFits(in: .horizontal) {
            if !short { pill(title, shown: shown, space: space, short: false) }
            pill(title, shown: shown, space: space, short: true)
        }
        .overlay { SpaceMenuArea(label: title, items: { SpaceMenus.header(model) }, font: model.notebookFont) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L("스페이스") + ": " + spoken)
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

/// Spaces 2c (H1): 완료 기록's `모든 스페이스 ▾` — the same pill as the note's, with its own choice (not the lens): 모든
/// 스페이스 · the spaces · 일반. The pill names what's picked (`● 회사`).
struct SpaceFilterButton: View {
    let spaces: TodoSpaces
    let filter: SpaceFilter
    let language: AppLanguage
    var font: NotebookFont = .pen
    let pick: @MainActor (SpaceFilter) -> Void

    private var space: TodoSpaces.Space? { if case .space(let id) = filter { spaces.space(id) } else { nil } }

    private var title: String {
        switch filter {
        case .all: SpaceWords.allSpaces(language)
        case .general: spaces.generalName(language)
        case .space: space?.name ?? SpaceWords.allSpaces(language)
        }
    }

    var body: some View {
        HStack(spacing: 5) {
            dot
            Text(title).lineLimit(1).fixedSize()
            Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold))
        }
        .font(.system(size: 11.5, weight: filter == .all ? .medium : .semibold))
        .foregroundStyle(filter == .all ? PaperTheme.ink2 : PaperTheme.ink)
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
        .overlay { SpaceMenuArea(label: title, items: { items }, font: font) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L("스페이스") + ": " + title)
        .help(title)
    }

    @ViewBuilder private var dot: some View {
        switch filter {
        case .space: RoundedRectangle(cornerRadius: 2).fill(PaperTheme.space(space?.colorKey ?? .lavender)).frame(width: 8, height: 8)
        case .general: RoundedRectangle(cornerRadius: 2).strokeBorder(PaperTheme.ink3, lineWidth: 1).frame(width: 8, height: 8)
        case .all:
            HStack(spacing: 0) {
                Rectangle().fill(PaperTheme.spacePink)
                Rectangle().fill(PaperTheme.spaceSky)
            }
            .frame(width: 8, height: 8)
            .clipShape(RoundedRectangle(cornerRadius: 2))
        }
    }

    @MainActor private var items: [DrawerMenuItem] {
        let pick = pick
        var all = DrawerMenuItem.action(SpaceWords.allSpaces(language), symbol: nil, checked: filter == .all) { pick(.all) }
        all.dot = .all
        // #185, as in the note's menu: while it's open a plain 1–9 picks the space in that place and 0 모든 스페이스.
        all.digit = "0"
        var items: [DrawerMenuItem] = [all, .separator]
        for (index, space) in spaces.visible.enumerated() {
            var row = DrawerMenuItem.action(space.name, symbol: nil, checked: filter == .space(space.id)) { pick(.space(space.id)) }
            row.dot = .color(space.colorKey)
            row.digit = index < 9 ? "\(index + 1)" : nil
            items.append(row)
        }
        var none = DrawerMenuItem.action(spaces.generalName(language), symbol: nil, checked: filter == .general) { pick(.general) }
        none.dot = .empty
        items.append(none)
        return items
    }
}

/// #87: at the end of 오늘's list while one space shows, one small faint line — `다른 스페이스에 4개 더 · 모두 보기`
/// (the open to-dos the lens hides; no line for none). 모두 보기 shows everything again, as ⌥⌘0 does. It replaced the
/// band over the list, which said again, larger, what the header's `회사만 ▾` says.
struct SpaceMoreLine: View {
    @ObservedObject var model: AppModel
    /// 2a (A1): another screen's N (앞으로's hidden to-dos ahead); nil: 오늘's.
    var hidden: Int?
    /// Where the words start: under the rows' titles.
    var leading: CGFloat = PaperTheme.margin + 17

    var body: some View {
        let hidden = self.hidden ?? model.hiddenOpenCount
        if hidden > 0 {
            HStack(alignment: .firstTextBaseline, spacing: 5) {
                Text(SpaceWords.more(hidden, language: .current))
                    .foregroundStyle(PaperTheme.ink3)
                    .truncationMode(.tail)
                Text("·").foregroundStyle(PaperTheme.ink3).accessibilityHidden(true)
                Button { model.showSpace(.all) } label: {
                    Text(L("모두 보기"))
                        .fontWeight(.semibold)
                        .foregroundStyle(PaperTheme.ink2)
                        .fixedSize()
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .layoutPriority(1)
                .help(L("모두 보기") + " (⌥⌘0)")
            }
            .font(.system(size: 11))
            .lineLimit(1)
            .padding(.leading, leading)
            .padding(.trailing, 16)
            .frame(maxWidth: .infinity, minHeight: PaperTheme.rowHeight, alignment: .leading)
            // A row of the paper: ruled like the rows above and the lines below.
            .overlay(alignment: .bottom) {
                Rectangle().fill(PaperTheme.rule).frame(height: 0.6).padding(.leading, 18).padding(.trailing, 20).accessibilityHidden(true)
            }
            .accessibilityElement(children: .contain)
        }
    }
}
