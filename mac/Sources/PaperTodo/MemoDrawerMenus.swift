import AppKit
import PaperCore
import SwiftUI

// 메모 서랍's menus (1.44, mock/v2): the folder list under the name, the ⚙ / empty-area menu, a memo's menu (⋯ and
// right-click), a bookmark's menu, the open memo's ⚙ and 폴더로 옮기기, and the section added to the text menu. Each is
// built once as `DrawerMenuItem`s: the app turns them into a real NSMenu (system look, keyboard, VoiceOver), the
// snapshots draw the same items so their words can be checked at 2×. Rows have icons; shortcuts only where the drawer
// already has them; destructive last; what doesn't apply is left out.

struct DrawerMenuItem {
    enum Kind {
        case action
        /// A row that isn't picked: the target's name at the top (a memo's title, a folder with its count).
        case header
        /// A small grey section title (`최근`, `이 메모`, `종이`).
        case section
        case separator
        /// A row of paper or backdrop swatches, picked with one click.
        case swatches([DrawerSwatch])
        case submenu([DrawerMenuItem])
    }

    var kind: Kind
    var title = ""
    var symbol: String?
    /// A folder's colour square instead of a symbol.
    var square: MemoFolders.Color?
    /// The square drawn as 고정's paw.
    var paw = false
    /// Shown right-aligned (a folder's count).
    var detail: String?
    /// Shown as the row's shortcut (and pressed while the menu is open): the key and its modifiers.
    var key: (String, NSEvent.ModifierFlags)?
    /// Drawn only (the menu can't take it: ↩, ⌘⌫ are the drawer's own keys).
    var keyText: String?
    var checked = false
    var destructive = false
    /// The header's title in handwriting (a memo's title).
    var handwritten = false
    var action: () -> Void = {}

    static func action(_ title: String, symbol: String?, key: (String, NSEvent.ModifierFlags)? = nil, keyText: String? = nil,
                       checked: Bool = false, destructive: Bool = false, _ action: @escaping () -> Void) -> DrawerMenuItem {
        DrawerMenuItem(kind: .action, title: title, symbol: symbol, key: key, keyText: keyText, checked: checked, destructive: destructive, action: action)
    }

    static func submenu(_ title: String, symbol: String?, _ items: [DrawerMenuItem]) -> DrawerMenuItem {
        DrawerMenuItem(kind: .submenu(items), title: title, symbol: symbol)
    }

    static func section(_ title: String) -> DrawerMenuItem { DrawerMenuItem(kind: .section, title: title) }
    static var separator: DrawerMenuItem { DrawerMenuItem(kind: .separator) }
    static func swatches(_ swatches: [DrawerSwatch]) -> DrawerMenuItem { DrawerMenuItem(kind: .swatches(swatches)) }

    /// The key as the menu writes it: ⇧⌘C.
    var shortcutText: String? {
        if let keyText { return keyText }
        guard let (key, mask) = key else { return nil }
        var out = ""
        if mask.contains(.control) { out += "⌃" }
        if mask.contains(.option) { out += "⌥" }
        if mask.contains(.shift) { out += "⇧" }
        if mask.contains(.command) { out += "⌘" }
        return out + key.uppercased()
    }
}

/// One swatch in a swatch row: a paper (the drawer's or a memo's) or a backdrop.
struct DrawerSwatch: Identifiable {
    enum Look: Equatable {
        /// 자동 / 서랍 따라: half day, half night.
        case split
        /// The drawer's paper of this kind.
        case paper(DrawerPalette.Kind)
        /// A memo's sheet of this kind.
        case sheet(DrawerPalette.Kind)
        case backdrop(MemoDrawer.Backdrop, DrawerPalette.Kind)
    }

    var id: String
    var label: String
    var look: Look
    var picked: Bool
    var pick: () -> Void
}

// MARK: - The menus

@MainActor
enum DrawerMenus {
    static func cmd(_ key: String, _ more: NSEvent.ModifierFlags = []) -> (String, NSEvent.ModifierFlags) { (key, more.union(.command)) }

    /// The folder list (the name's ▾, ⌘L): colour, name, count, ⌘1–9; 고정 with its count; 새 폴더….
    static func folderList(_ drawer: MemoDrawer) -> [DrawerMenuItem] {
        var items: [DrawerMenuItem] = [.section(L("폴더"))]
        for (index, folder) in drawer.folders.visible.enumerated() {
            var item = DrawerMenuItem.action(folder.displayName(.current), symbol: nil, key: index < 9 ? cmd("\(index + 1)") : nil,
                                             checked: drawer.tab == .folder(folder.id) && !drawer.searching) { drawer.show(.folder(folder.id)) }
            item.square = folder.colorKey
            item.detail = "\(drawer.folders.count(drawer.memos, in: folder.id))"
            items.append(item)
        }
        var pinned = DrawerMenuItem.action(L("고정"), symbol: nil, key: cmd("0"), checked: drawer.tab == .pinned && !drawer.searching) { drawer.show(.pinned) }
        pinned.paw = true
        pinned.detail = "\(drawer.folders.pinnedMemos(drawer.memos).count)"
        items.append(pinned)
        items.append(.separator)
        items.append(.action(L("새 폴더…"), symbol: "plus") { drawer.newFolder() })
        return items
    }

    /// The footer's ⚙ = a right-click on the drawer's empty area or header.
    static func drawer(_ drawer: MemoDrawer) -> [DrawerMenuItem] {
        let auto = drawer.theme == .auto
        let papers: [DrawerSwatch] = MemoDrawer.Theme.allCases.map { theme in
            let look: DrawerSwatch.Look = theme == .auto ? .split : .paper(theme.palette(.light).kind)
            return DrawerSwatch(id: theme.rawValue, label: theme.short, look: look, picked: drawer.theme == theme || (auto && theme == .auto)) { drawer.theme = theme }
        }
        let kind = drawer.theme.palette(drawer.model.paperColor == .night ? .dark : .light).kind
        let backdrops = MemoDrawer.Backdrop.allCases.map { backdrop in
            DrawerSwatch(id: backdrop.rawValue, label: backdrop.title, look: .backdrop(backdrop, kind), picked: drawer.backdrop == backdrop) { drawer.backdrop = backdrop }
        }
        return [
            .action(L("새 메모"), symbol: "plus", key: cmd("n")) { drawer.newMemo() },
            .action(L("복사한 글로 새 메모"), symbol: "doc.on.clipboard") { drawer.newFromClipboard() },
            .separator,
            .section(L("종이")),
            .swatches(papers),
            .section(L("바탕")),
            .swatches(backdrops),
            .separator,
            drawer.side == .right
                ? .action(L("왼쪽에 두기"), symbol: "sidebar.left") { drawer.side = .left }
                : .action(L("오른쪽에 두기"), symbol: "sidebar.right") { drawer.side = .right },
            .action(L("메모 서랍 설정…"), symbol: "gearshape", key: cmd(",")) { drawer.openSettings() },
            .action(L("도움말"), symbol: "questionmark.circle") { drawer.openHelp() },
            .separator,
            .action(L("종이냥 끝내기"), symbol: "power", key: cmd("q")) { NSApp.terminate(nil) },
        ]
    }

    /// A memo's menu (its ⋯, a right-click on it): its title on top, then what can be done to it.
    static func memo(_ drawer: MemoDrawer, _ id: String) -> [DrawerMenuItem] {
        guard let memo = drawer.memo(id) else { return [] }
        let pinned = drawer.folders.isPinned(id)
        var header = DrawerMenuItem(kind: .header, title: MemoCards.title(memo.text, language: .current), symbol: "doc.text")
        header.handwritten = true
        var items: [DrawerMenuItem] = [
            header,
            .separator,
            .action(L("펼쳐서 고치기"), symbol: "pencil", keyText: "↩") { drawer.edit(id) },
            .action(L("크게 보기"), symbol: "arrow.up.left.and.arrow.down.right") { drawer.showBig(id) },
            .separator,
            .action(L("복사"), symbol: "doc.on.doc", key: cmd("c", .shift)) { drawer.copy(id) },
            .action(L("복제"), symbol: "plus.square.on.square") { drawer.duplicate(id) },
            .separator,
            .action(String(localized: "고정", table: "Drawer"), symbol: "pawprint", checked: pinned) { drawer.togglePin(id) },
            .submenu(L("폴더로 옮기기"), symbol: "tray.and.arrow.down", move(drawer, id)),
            .separator,
            .section(L("이 메모의 종이")),
            .swatches(paperSwatches(drawer, id)),
        ]
        if Checklist.progress(memo.text)?.done ?? 0 > 0 {
            items.append(.action(L("체크한 줄 지우기"), symbol: "checklist.unchecked") { drawer.clearChecked(id) })
        }
        items += [.separator, .action(L("지우기"), symbol: "trash", keyText: "⌘⌫", destructive: true) { drawer.delete(id) }]
        return items
    }

    /// 이 메모의 종이: 서랍 따라 · 낮 · 밤 · 크라프트 · 모눈.
    static func paperSwatches(_ drawer: MemoDrawer, _ id: String) -> [DrawerSwatch] {
        let current = drawer.folders.paper(of: id)
        var out = [DrawerSwatch(id: "follow", label: L("서랍 따라"), look: .split, picked: current == nil) { drawer.setPaper(id, nil) }]
        for paper in MemoFolders.Paper.allCases {
            let kind = DrawerPalette.Kind(rawValue: paper.rawValue)!
            out.append(DrawerSwatch(id: paper.rawValue, label: paper.short, look: .sheet(kind), picked: current == paper) { drawer.setPaper(id, paper) })
        }
        return out
    }

    /// 폴더로 옮기기 ▸: `최근` (the last two folders moved to), the other folders, 새 폴더… (makes it, then moves there).
    static func move(_ drawer: MemoDrawer, _ id: String) -> [DrawerMenuItem] {
        let current = drawer.folders.folderID(of: id)
        let visible = drawer.folders.visible.filter { $0.id != current }
        let recent = drawer.recentMoves.compactMap { recentID in visible.first { $0.id == recentID } }
        func row(_ folder: MemoFolders.Folder) -> DrawerMenuItem {
            var item = DrawerMenuItem.action(folder.displayName(.current), symbol: nil) { drawer.move(id, to: folder.id) }
            item.square = folder.colorKey
            return item
        }
        var items: [DrawerMenuItem] = []
        if !recent.isEmpty {
            items.append(.section(L("최근")))
            items += recent.map(row)
            items.append(.separator)
        }
        items += visible.filter { folder in !recent.contains { $0.id == folder.id } }.map(row)
        if !items.isEmpty, case .action = items.last!.kind { items.append(.separator) }
        items.append(.action(L("새 폴더…"), symbol: "plus") { drawer.newFolder(moving: id) })
        return items
    }

    /// The open memo's ⚙: 고정 · 이 메모의 종이 · 체크한 줄 지우기.
    static func memoGear(_ drawer: MemoDrawer, _ id: String) -> [DrawerMenuItem] {
        guard let memo = drawer.memo(id) else { return [] }
        var items: [DrawerMenuItem] = [
            .action(String(localized: "고정", table: "Drawer"), symbol: "pawprint", checked: drawer.folders.isPinned(id)) { drawer.togglePin(id) },
            .separator,
            .section(L("이 메모의 종이")),
            .swatches(paperSwatches(drawer, id)),
        ]
        if Checklist.progress(memo.text)?.done ?? 0 > 0 {
            items += [.separator, .action(L("체크한 줄 지우기"), symbol: "checklist.unchecked") { drawer.clearChecked(id) }]
        }
        return items
    }

    /// A bookmark's menu: the folder (colour, name, count) on top; 여기에 새 메모; 이름 바꾸기 · 색 · 정렬 · 복제;
    /// 폴더 지우기… (not on 메모).
    static func folder(_ drawer: MemoDrawer, _ id: String) -> [DrawerMenuItem] {
        guard let folder = drawer.folders.folder(id) else { return [] }
        var header = DrawerMenuItem(kind: .header, title: folder.displayName(.current))
        header.square = folder.colorKey
        header.detail = MemoFolders.sheetCount(drawer.folders.count(drawer.memos, in: id), language: .current)
        let colors = MemoFolders.Color.allCases.map { color in
            var item = DrawerMenuItem.action(color.title, symbol: nil, checked: folder.colorKey == color) { drawer.model.recolorMemoFolder(id, to: color) }
            item.square = color
            return item
        }
        var items: [DrawerMenuItem] = [
            header,
            .separator,
            .action(L("여기에 새 메모"), symbol: "plus") { drawer.newMemo(in: .folder(id)) },
            .separator,
            .action(L("이름 바꾸기"), symbol: "character.cursor.ibeam") { drawer.editFolder(id) },
            .submenu(L("색"), symbol: "paintpalette", colors),
            .submenu(L("정렬"), symbol: "arrow.up.arrow.down", sort(drawer, .folder(id))),
            .action(L("복제"), symbol: "plus.square.on.square") { drawer.duplicateFolder(id) },
        ]
        if !folder.isInbox {
            items += [.separator, .action(L("폴더 지우기…"), symbol: "trash", destructive: true) { drawer.deleteFolder(id) }]
        }
        return items
    }

    /// 고정's bookmark: 정렬 · 고정 모두 풀기.
    static func pinned(_ drawer: MemoDrawer) -> [DrawerMenuItem] {
        var header = DrawerMenuItem(kind: .header, title: L("고정"))
        header.paw = true
        header.detail = MemoFolders.sheetCount(drawer.folders.pinnedMemos(drawer.memos).count, language: .current)
        var items: [DrawerMenuItem] = [header, .separator, .submenu(L("정렬"), symbol: "arrow.up.arrow.down", sort(drawer, .pinned))]
        if !drawer.folders.pinnedMemos(drawer.memos).isEmpty {
            items += [.separator, .action(L("고정 모두 풀기"), symbol: "pawprint", destructive: false) { drawer.unpinAll() }]
        }
        return items
    }

    /// 정렬 ▸: 고친 순 · 만든 순 · 제목 순.
    static func sort(_ drawer: MemoDrawer, _ tab: MemoFolders.Tab) -> [DrawerMenuItem] {
        let current: MemoFolders.Sort = {
            switch tab {
            case .pinned: drawer.pinnedSort
            case .folder(let id): drawer.folders.sort(of: id)
            }
        }()
        return MemoFolders.Sort.allCases.map { sort in .action(sort.title, symbol: nil, checked: current == sort) { drawer.setSort(sort, for: tab) } }
    }

    /// The text menu's own section while typing in a memo: `이 메모` — 폴더로 옮기기 ▸ · 이 메모의 종이 ▸ · 체크한 줄 지우기.
    static func textSection(_ drawer: MemoDrawer, _ id: String) -> [DrawerMenuItem] {
        guard let memo = drawer.memo(id) else { return [] }
        var items: [DrawerMenuItem] = [
            .section(L("이 메모")),
            .submenu(L("폴더로 옮기기"), symbol: "tray.and.arrow.down", move(drawer, id)),
            .submenu(L("이 메모의 종이"), symbol: "doc.richtext", [.swatches(paperSwatches(drawer, id))]),
        ]
        if Checklist.progress(memo.text)?.done ?? 0 > 0 {
            items.append(.action(L("체크한 줄 지우기"), symbol: "checklist.unchecked") { drawer.clearChecked(id) })
        }
        return items
    }
}

extension MemoFolders.Sort {
    var title: String {
        switch self {
        case .edited: L("고친 순")
        case .created: L("만든 순")
        case .title: L("제목 순")
        }
    }
}

extension MemoFolders.Paper {
    /// The swatch's word: 낮 · 밤 · 크라프트 · 모눈.
    var short: String {
        switch self {
        case .day: L("낮")
        case .night: L("밤")
        case .kraft: L("크라프트")
        case .grid: L("모눈")
        }
    }
}

extension MemoDrawer.Theme {
    /// The swatch's word: 자동 · 낮 · 밤 · 크라프트 · 모눈.
    var short: String {
        switch self {
        case .auto: String(localized: "자동", table: "Drawer")
        case .day: L("낮")
        case .night: L("밤")
        case .kraft: L("크라프트")
        case .grid: L("모눈")
        }
    }
}

// MARK: - As an NSMenu

/// A menu row that runs a closure.
final class DrawerNSMenuItem: NSMenuItem {
    var run: () -> Void = {}

    convenience init(_ title: String, run: @escaping () -> Void) {
        self.init(title: title, action: #selector(fire), keyEquivalent: "")
        target = self
        self.run = run
    }

    @objc private func fire() { run() }
}

@MainActor
enum DrawerMenuBuilder {
    static func menu(_ items: [DrawerMenuItem], palette: DrawerPalette?, font: NotebookFont) -> NSMenu {
        let menu = NSMenu()
        menu.autoenablesItems = false
        for item in items { add(item, to: menu, palette: palette, font: font) }
        return menu
    }

    static func add(_ item: DrawerMenuItem, to menu: NSMenu, palette: DrawerPalette?, font: NotebookFont) {
        switch item.kind {
        case .separator:
            menu.addItem(.separator())
        case .section:
            menu.addItem(.sectionHeader(title: item.title))
        case .header:
            let row = NSMenuItem()
            row.view = MenuHeaderView(item: item, font: font)
            menu.addItem(row)
        case .swatches(let swatches):
            let row = NSMenuItem()
            row.view = SwatchRowView(swatches: swatches)
            menu.addItem(row)
        case .submenu(let children):
            let row = NSMenuItem(title: item.title, action: nil, keyEquivalent: "")
            row.image = image(item)
            row.submenu = Self.menu(children, palette: palette, font: font)
            menu.addItem(row)
        case .action:
            let row = DrawerNSMenuItem(item.title, run: item.action)
            row.image = image(item)
            row.state = item.checked ? .on : .off
            if let (key, mask) = item.key {
                row.keyEquivalent = key
                row.keyEquivalentModifierMask = mask
            } else if let text = item.keyText {
                // A key the drawer handles itself: written at the right, not taken by the menu.
                row.attributedTitle = titleWithKey(item.title, key: text, destructive: item.destructive)
            }
            if let detail = item.detail { row.attributedTitle = titleWithDetail(item.title, detail: detail) }
            if item.destructive && row.attributedTitle == nil {
                row.attributedTitle = NSAttributedString(string: item.title, attributes: [.font: NSFont.menuFont(ofSize: 0), .foregroundColor: NSColor.systemRed])
            }
            menu.addItem(row)
        }
    }

    static func image(_ item: DrawerMenuItem) -> NSImage? {
        if item.paw { return NSImage(systemSymbolName: "pawprint.fill", accessibilityDescription: nil) }
        if let square = item.square { return colorSquare(square) }
        guard let symbol = item.symbol else { return nil }
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
        return image?.withSymbolConfiguration(.init(pointSize: 13, weight: .regular))
    }

    /// A folder's colour (its day bookmark, which reads on both menu appearances) as a small rounded square.
    static func colorSquare(_ color: MemoFolders.Color) -> NSImage {
        let colors = DrawerPalette.day.tab(color)
        let fill = NSColor(colors.a), edge = NSColor(colors.edge)
        return NSImage(size: NSSize(width: 14, height: 14), flipped: false) { rect in
            let path = NSBezierPath(roundedRect: rect.insetBy(dx: 1.5, dy: 1.5), xRadius: 3, yRadius: 3)
            fill.setFill()
            path.fill()
            edge.setStroke()
            path.lineWidth = 1
            path.stroke()
            return true
        }
    }

    private static func tabbed(_ title: String, _ right: String, colour: NSColor?, rightColour: NSColor) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        let width = (title as NSString).size(withAttributes: [.font: NSFont.menuFont(ofSize: 0)]).width
        paragraph.tabStops = [NSTextTab(textAlignment: .right, location: max(170, ceil(width) + 60))]
        let text = NSMutableAttributedString(string: title, attributes: [.font: NSFont.menuFont(ofSize: 0), .paragraphStyle: paragraph,
                                                                          .foregroundColor: colour ?? NSColor.labelColor])
        text.append(NSAttributedString(string: "\t" + right, attributes: [.font: NSFont.menuFont(ofSize: 0), .paragraphStyle: paragraph, .foregroundColor: rightColour]))
        return text
    }

    static func titleWithKey(_ title: String, key: String, destructive: Bool) -> NSAttributedString {
        tabbed(title, key, colour: destructive ? .systemRed : nil, rightColour: .tertiaryLabelColor)
    }

    static func titleWithDetail(_ title: String, detail: String) -> NSAttributedString {
        tabbed(title, detail, colour: nil, rightColour: .secondaryLabelColor)
    }

    /// Opens the menu under `view` (a button) or at the pointer (a right-click).
    static func pop(_ items: [DrawerMenuItem], drawer: MemoDrawer, under view: NSView? = nil, event: NSEvent? = nil) {
        guard !items.isEmpty else { return }
        let menu = menu(items, palette: drawer.palette, font: drawer.model.notebookFont)
        menu.appearance = NSAppearance(named: drawer.palette.scheme == .dark ? .darkAqua : .aqua)
        if let view {
            menu.popUp(positioning: nil, at: NSPoint(x: 0, y: view.isFlipped ? view.bounds.maxY + 4 : -4), in: view)
        } else if let event, let view = event.window?.contentView {
            NSMenu.popUpContextMenu(menu, with: event, for: view)
        }
    }
}

/// A menu's top row: what it's about (a memo's title in handwriting, a folder's colour, name and count).
private final class MenuHeaderView: NSView {
    init(item: DrawerMenuItem, font: NotebookFont) {
        let content = NSHostingView(rootView: DrawerMenuHeader(item: item, font: font, scheme: nil))
        let size = content.fittingSize
        super.init(frame: NSRect(x: 0, y: 0, width: max(size.width, 200), height: size.height))
        content.frame = bounds
        content.autoresizingMask = [.width, .height]
        addSubview(content)
        setAccessibilityElement(true)
        setAccessibilityRole(.staticText)
        setAccessibilityLabel(item.title)
    }

    required init?(coder: NSCoder) { nil }
}

/// A row of swatches in a menu: one click picks and closes the menu. Drawn by SwiftUI, clicked here (a menu's
/// tracking loop doesn't give SwiftUI buttons their clicks).
private final class SwatchRowView: NSView {
    private let swatches: [DrawerSwatch]
    private let hosting: NSHostingView<DrawerSwatchRow>
    private var hovered: Int? { didSet { if hovered != oldValue { hosting.rootView = DrawerSwatchRow(swatches: swatches, hovered: hovered) } } }

    init(swatches: [DrawerSwatch]) {
        self.swatches = swatches
        hosting = NSHostingView(rootView: DrawerSwatchRow(swatches: swatches, hovered: nil))
        let size = hosting.fittingSize
        super.init(frame: NSRect(origin: .zero, size: size))
        hosting.frame = bounds
        hosting.autoresizingMask = [.width, .height]
        addSubview(hosting)
        addTrackingArea(NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
        setAccessibilityElement(true)
        setAccessibilityRole(.radioGroup)
        setAccessibilityChildren(swatches.enumerated().map { index, swatch in
            let element = NSAccessibilityElement()
            element.setAccessibilityRole(.radioButton)
            element.setAccessibilityLabel(swatch.label)
            element.setAccessibilityValue(swatch.picked ? 1 : 0)
            element.setAccessibilityParent(self)
            element.setAccessibilityFrameInParentSpace(frame(of: index))
            return element
        })
    }

    required init?(coder: NSCoder) { nil }

    override func hitTest(_ point: NSPoint) -> NSView? { frame.contains(point) ? self : nil }

    private func frame(of index: Int) -> NSRect {
        let x = DrawerSwatchRow.inset + CGFloat(index) * (DrawerSwatchRow.cell + DrawerSwatchRow.gap)
        return NSRect(x: x, y: 0, width: DrawerSwatchRow.cell, height: bounds.height)
    }

    private func index(at point: NSPoint) -> Int? {
        swatches.indices.first { frame(of: $0).contains(point) }
    }

    override func mouseMoved(with event: NSEvent) { hovered = index(at: convert(event.locationInWindow, from: nil)) }
    override func mouseExited(with event: NSEvent) { hovered = nil }

    override func mouseUp(with event: NSEvent) {
        guard let index = index(at: convert(event.locationInWindow, from: nil)) else { return }
        let pick = swatches[index].pick
        enclosingMenuItem?.menu?.cancelTracking()
        DispatchQueue.main.async { pick() }
    }
}

// MARK: - Drawn (the menu rows' look; snapshots draw whole menus with it)

/// The swatch row: 44 × 30 samples with their names under them, the picked one ringed.
struct DrawerSwatchRow: View {
    let swatches: [DrawerSwatch]
    var hovered: Int?

    static let cell: CGFloat = 50
    static let gap: CGFloat = 4
    static let inset: CGFloat = 14

    var body: some View {
        HStack(spacing: Self.gap) {
            ForEach(Array(swatches.enumerated()), id: \.element.id) { index, swatch in
                VStack(spacing: 3) {
                    DrawerSwatchSample(look: swatch.look)
                        .frame(width: 44, height: 30)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .overlay { RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Color.primary.opacity(0.2), lineWidth: 0.5) }
                        .padding(2)
                        .overlay {
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .strokeBorder(swatch.picked ? Color.accentColor : Color.primary.opacity(hovered == index ? 0.35 : 0), lineWidth: swatch.picked ? 2 : 1)
                        }
                    Text(swatch.label)
                        .font(.system(size: 10.5, weight: swatch.picked ? .semibold : .regular))
                        .foregroundStyle(swatch.picked ? Color.primary : Color.secondary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                        .frame(width: Self.cell)
                }
                .frame(width: Self.cell)
            }
        }
        .padding(.horizontal, Self.inset)
        .padding(.top, 3)
        .padding(.bottom, 6)
    }
}

/// One swatch's picture: a paper (its colour, ruling or grid), a memo sheet, a backdrop over a colourful desktop.
struct DrawerSwatchSample: View {
    let look: DrawerSwatch.Look

    var body: some View {
        switch look {
        case .split:
            ZStack {
                Color(drawerHex: "#fffdf7")
                DiagonalHalf().fill(Color(drawerHex: "#2a2925"))
            }
        case .paper(let kind):
            let palette = DrawerPalette.of(kind)
            ZStack {
                palette.paper
                if kind == .grid { GridLines(step: 6).stroke(palette.rule, lineWidth: 0.6) }
            }
        case .sheet(let kind):
            let palette = DrawerPalette.of(kind)
            ZStack(alignment: .leading) {
                palette.sheet
                if kind == .grid { GridLines(step: 6).stroke(palette.sheetRule, lineWidth: 0.6) }
                Rectangle().fill(palette.sheetMargin).frame(width: 1).padding(.leading, 7)
            }
            .overlay { Rectangle().strokeBorder(palette.sheetEdge, lineWidth: 1) }
        case .backdrop(let backdrop, let kind):
            let palette = DrawerPalette.of(kind)
            ZStack {
                DrawerDesktop()
                switch backdrop {
                case .opaque: palette.paper
                case .translucent, .strong:
                    palette.paper.opacity(backdrop.paperOpacity)
                case .none:
                    palette.sheet.frame(width: 22, height: 10).shadow(color: .black.opacity(0.25), radius: 2, y: 1)
                }
            }
        }
    }
}

private struct DiagonalHalf: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}

struct GridLines: Shape {
    let step: CGFloat
    func path(in rect: CGRect) -> Path {
        var path = Path()
        var x = rect.minX + step
        while x < rect.maxX { path.move(to: CGPoint(x: x, y: rect.minY)); path.addLine(to: CGPoint(x: x, y: rect.maxY)); x += step }
        var y = rect.minY + step
        while y < rect.maxY { path.move(to: CGPoint(x: rect.minX, y: y)); path.addLine(to: CGPoint(x: rect.maxX, y: y)); y += step }
        return path
    }
}

/// A busy, colourful desktop (the backdrop swatches; the snapshots' screen behind the four backdrops).
struct DrawerDesktop: View {
    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(drawerHex: "#e9d7f5"), Color(drawerHex: "#9fb8e8")], startPoint: .topLeading, endPoint: .bottomTrailing)
            RadialGradient(colors: [Color(drawerHex: "#f3a96b"), .clear], center: UnitPoint(x: 0.2, y: 0.25), startRadius: 0, endRadius: 140)
            RadialGradient(colors: [Color(drawerHex: "#5b8bd6"), .clear], center: UnitPoint(x: 0.8, y: 0.7), startRadius: 0, endRadius: 160)
            RadialGradient(colors: [Color(drawerHex: "#7cc39a"), .clear], center: UnitPoint(x: 0.3, y: 0.85), startRadius: 0, endRadius: 120)
        }
    }
}

/// A menu's top row as drawn.
struct DrawerMenuHeader: View {
    let item: DrawerMenuItem
    let font: NotebookFont
    /// Snapshots: drawn in this appearance's colours.
    var scheme: ColorScheme?

    var body: some View {
        HStack(spacing: 8) {
            if item.paw {
                Image(systemName: "pawprint.fill").font(.system(size: 12)).foregroundStyle(.secondary)
            } else if let square = item.square {
                Image(nsImage: DrawerMenuBuilder.colorSquare(square))
            } else if let symbol = item.symbol {
                Image(systemName: symbol).font(.system(size: 12)).foregroundStyle(.secondary)
            }
            if item.handwritten {
                Text(item.title.handwritten).font(font.handFont(MemoDrawerView.hand(18))).lineLimit(1)
            } else {
                Text(item.title).font(.system(size: 13, weight: .semibold)).lineLimit(1)
            }
            Spacer(minLength: 12)
            if let detail = item.detail {
                Text(detail).font(.system(size: 12)).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: 260)
        .padding(.horizontal, 14)
        .padding(.vertical, 4)
    }
}

/// A whole menu drawn as the system draws it (near enough): for the snapshots only — the words, their order, icons,
/// shortcuts, swatches and what's left out are what's checked there.
struct DrawerMenuPreview: View {
    let items: [DrawerMenuItem]
    let font: NotebookFont
    var width: CGFloat = 270

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in row(item) }
        }
        .padding(.vertical, 5)
        .frame(width: width, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .background(Color(nsColor: .windowBackgroundColor).opacity(0.92), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(Color.primary.opacity(0.15), lineWidth: 0.5) }
        .shadow(color: .black.opacity(0.22), radius: 12, y: 6)
    }

    @ViewBuilder private func row(_ item: DrawerMenuItem) -> some View {
        switch item.kind {
        case .separator:
            Rectangle().fill(Color.primary.opacity(0.12)).frame(height: 1).padding(.horizontal, 10).padding(.vertical, 5)
        case .section:
            Text(item.title).font(.system(size: 11, weight: .semibold)).foregroundStyle(.secondary).padding(.horizontal, 14).padding(.top, 4).padding(.bottom, 2)
        case .header:
            DrawerMenuHeader(item: item, font: font)
        case .swatches(let swatches):
            DrawerSwatchRow(swatches: swatches)
        case .action, .submenu:
            HStack(spacing: 7) {
                Image(systemName: "checkmark").font(.system(size: 11, weight: .semibold)).opacity(item.checked ? 1 : 0).frame(width: 12)
                Group {
                    if item.paw {
                        Image(systemName: "pawprint.fill")
                    } else if let square = item.square {
                        Image(nsImage: DrawerMenuBuilder.colorSquare(square))
                    } else if let symbol = item.symbol {
                        Image(systemName: symbol)
                    } else {
                        Color.clear
                    }
                }
                .font(.system(size: 12.5))
                .frame(width: 16)
                .opacity(item.symbol == nil && item.square == nil && !item.paw ? 0 : 1)
                Text(item.title).font(.system(size: 13)).foregroundStyle(item.destructive ? Color(nsColor: .systemRed) : .primary).lineLimit(1)
                Spacer(minLength: 16)
                if let detail = item.detail { Text(detail).font(.system(size: 13)).foregroundStyle(.secondary) }
                if let key = item.shortcutText { Text(key).font(.system(size: 13)).foregroundStyle(.tertiary) }
                if case .submenu = item.kind { Image(systemName: "chevron.right").font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary) }
            }
            .padding(.horizontal, 10)
            .frame(height: 22)
        }
    }
}

// MARK: - Where menus open from

/// Over a SwiftUI view: a right-click (or ⌃-click) opens `items` at the pointer; every other event goes through to
/// the view underneath (clicks, hover, drags).
struct DrawerContextArea: NSViewRepresentable {
    let drawer: MemoDrawer
    let items: @MainActor () -> [DrawerMenuItem]

    func makeNSView(context: Context) -> ContextView {
        let view = ContextView()
        view.drawer = drawer
        view.items = items
        return view
    }

    func updateNSView(_ view: ContextView, context: Context) {
        view.drawer = drawer
        view.items = items
    }

    final class ContextView: NSView {
        weak var drawer: MemoDrawer?
        var items: @MainActor () -> [DrawerMenuItem] = { [] }

        private func isMenuClick(_ event: NSEvent?) -> Bool {
            guard let event else { return false }
            return event.type == .rightMouseDown || (event.type == .leftMouseDown && event.modifierFlags.contains(.control))
        }

        override func hitTest(_ point: NSPoint) -> NSView? {
            guard isMenuClick(NSApp.currentEvent), let superview, frame.contains(point) else { return nil }
            _ = superview
            return self
        }

        override func rightMouseDown(with event: NSEvent) { open(event) }
        override func mouseDown(with event: NSEvent) { if event.modifierFlags.contains(.control) { open(event) } }

        private func open(_ event: NSEvent) {
            guard let drawer else { return }
            let list = items()
            guard !list.isEmpty else { return }
            let menu = DrawerMenuBuilder.menu(list, palette: drawer.palette, font: drawer.model.notebookFont)
            menu.appearance = NSAppearance(named: drawer.palette.scheme == .dark ? .darkAqua : .aqua)
            NSMenu.popUpContextMenu(menu, with: event, for: self)
        }
    }
}

/// A button's menu: a click opens `items` just under the button (the name's ▾, ⚙, ⋯, 폴더로 옮기기). The SwiftUI view
/// under it draws the button; this takes its clicks and tells VoiceOver it's a menu button.
struct DrawerMenuButtonArea: NSViewRepresentable {
    let drawer: MemoDrawer
    let label: String
    let items: @MainActor () -> [DrawerMenuItem]
    /// Gives the drawer a way to open it from the keyboard (⌘L for the folder list).
    var register: ((@escaping () -> Void) -> Void)?

    func makeNSView(context: Context) -> ButtonView {
        let view = ButtonView()
        update(view)
        return view
    }

    func updateNSView(_ view: ButtonView, context: Context) { update(view) }

    private func update(_ view: ButtonView) {
        view.drawer = drawer
        view.items = items
        view.setAccessibilityLabel(label)
        view.toolTip = label
        register? { [weak view] in view?.open() }
    }

    final class ButtonView: NSView {
        weak var drawer: MemoDrawer?
        var items: @MainActor () -> [DrawerMenuItem] = { [] }

        override init(frame: NSRect) {
            super.init(frame: frame)
            setAccessibilityElement(true)
            setAccessibilityRole(.menuButton)
        }

        required init?(coder: NSCoder) { nil }

        override var isFlipped: Bool { true }
        override func hitTest(_ point: NSPoint) -> NSView? { frame.contains(point) ? self : nil }
        override func mouseDown(with event: NSEvent) { open() }
        override func rightMouseDown(with event: NSEvent) { open() }
        override func accessibilityPerformPress() -> Bool { open(); return true }

        func open() {
            guard let drawer, window != nil else { return }
            DrawerMenuBuilder.pop(items(), drawer: drawer, under: self)
        }
    }
}
