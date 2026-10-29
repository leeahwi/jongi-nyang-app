import AppKit
import Carbon.HIToolbox
import Combine
import PaperCore
import SwiftUI

// MARK: - memo-folders.json in the model

extension AppModel {
    var memoFoldersURL: URL { storageFolderURL.appendingPathComponent(MemoFolders.fileName) }

    /// At launch: the file, or the inbox alone (D1); an unreadable one is moved aside with one notice (D15).
    func loadMemoFolders(now: Date = Date()) {
        guard let data = try? Data(contentsOf: memoFoldersURL) else {
            memoFolders = .fresh(language: .current)
            knownFoldersData = nil
            return
        }
        do {
            memoFolders = try MemoFolders.decode(data, language: .current)
            knownFoldersData = data
        } catch {
            moveFoldersAside(now: now)
            memoFolders = .fresh(language: .current)
            knownFoldersData = nil
        }
    }

    private func moveFoldersAside(now: Date) {
        let aside = memoFoldersURL.deletingLastPathComponent().appendingPathComponent(MemoFolders.asideName(now))
        if (try? FileManager.default.moveItem(at: memoFoldersURL, to: aside)) != nil {
            storageError = L("메모 폴더 정보를 읽지 못해서 처음처럼 시작했어요. 원본은 \(aside.lastPathComponent)에 남겨 뒀어요.")
        }
    }

    /// Another device (or an older app's backup) changed the file: merged in, the newer side winning (D13, D14).
    func catchUpMemoFolders() {
        guard let data = try? Data(contentsOf: memoFoldersURL), data != knownFoldersData else { return }
        knownFoldersData = data
        guard let theirs = try? MemoFolders.decode(data, language: .current) else {
            moveFoldersAside(now: Date())
            return
        }
        let merged = MemoFolders.merge(here: memoFolders, theirs: theirs)
        if merged != memoFolders { memoFolders = merged }
    }

    /// Every change: catch up with the file, change, drop placements of memos that are gone (D6), write.
    func changeMemoFolders(now: Date = Date(), _ change: (inout MemoFolders, Date) -> Void) {
        guard !savingStopped else { return }
        catchUpMemoFolders()
        var folders = memoFolders
        change(&folders, now)
        // Never pruned against a list that couldn't be read (it's empty then).
        if !memos.isEmpty {
            var ids = Set(memos.map(\.id))
            if let deleted = lastDeletedMemo { ids.insert(deleted.id) }
            folders = folders.pruned(memoIDs: ids, now: now)
        }
        if folders != memoFolders { memoFolders = folders }
        let started = PerfProbe.now
        defer { PerfProbe.io("memo-folders", since: started) }
        do {
            try folders.save(to: memoFoldersURL)
            knownFoldersData = try? Data(contentsOf: memoFoldersURL)
        } catch {
            storageError = L("메모 폴더 정보를 저장하지 못했어요.") + "\n\(memoFoldersURL.path)"
        }
    }

    func moveMemo(_ id: String, to folder: String) {
        guard memoFolders.folderID(of: id) != folder else { return }
        changeMemoFolders { folders, now in folders.place(id, in: folder, now: now) }
    }

    func setMemoPinned(_ id: String, _ pinned: Bool) {
        changeMemoFolders { folders, now in folders.setPinned(id, pinned, now: now) }
    }

    @discardableResult
    func addMemoFolder(name: String, color: MemoFolders.Color) -> String? {
        let clean = MemoFolders.cleanName(name)
        guard !clean.isEmpty else { return nil }
        var made: String?
        changeMemoFolders { folders, now in made = folders.addFolder(name: clean, color: color, now: now) }
        return made
    }

    func renameMemoFolder(_ id: String, to name: String) {
        changeMemoFolders { folders, now in folders.rename(id, to: name, now: now) }
    }

    func recolorMemoFolder(_ id: String, to color: MemoFolders.Color) {
        changeMemoFolders { folders, now in folders.recolor(id, to: color, now: now) }
    }

    /// D3: returns the memos that went to 메모 (for 되돌리기), nil for the inbox (D4).
    func deleteMemoFolder(_ id: String) -> [String]? {
        guard id != MemoFolders.inbox, memoFolders.folder(id) != nil else { return nil }
        let moved = memos.filter { memoFolders.folderID(of: $0.id) == id }.map(\.id)
        changeMemoFolders { folders, now in folders.deleteFolder(id, now: now) }
        return moved
    }

    func restoreMemoFolder(_ id: String, memoIDs: [String]) {
        changeMemoFolders { folders, now in folders.restoreFolder(id, memoIDs: memoIDs, now: now) }
    }

    func reorderMemoFolders(_ ids: [String]) {
        changeMemoFolders { folders, now in folders.reorder(ids, now: now) }
    }

    /// D7, D8: the box on that line flips; the memo is saved like any edit.
    func toggleChecklist(_ id: String, line: Int) {
        guard let memo = memos.first(where: { $0.id == id }) else { return }
        let text = Checklist.toggle(memo.text, line: line)
        guard text != memo.text else { return }
        updateMemo(id, text: text, from: memo.text)
        saveMemosNow()
    }

    /// 이 메모의 종이 (1.44): nil = 서랍 따라.
    func setMemoPaper(_ id: String, _ paper: MemoFolders.Paper?) {
        guard memoFolders.paper(of: id) != paper else { return }
        changeMemoFolders { folders, now in folders.setPaper(id, paper, now: now) }
    }

    func setMemoFolderSort(_ id: String, _ sort: MemoFolders.Sort) {
        changeMemoFolders { folders, now in folders.setSort(id, sort, now: now) }
    }

    /// 고정 모두 풀기: the memos let go (for 되돌리기).
    func unpinAllMemos() -> [String] {
        var ids: [String] = []
        changeMemoFolders { folders, now in ids = folders.unpinAll(now: now) }
        return ids
    }

    func pinMemos(_ ids: [String]) {
        changeMemoFolders { folders, now in for id in ids { folders.setPinned(id, true, now: now) } }
    }

    /// The memo's folder as the note's memo tab shows it (nil for the inbox: nothing is written there).
    func memoFolderName(_ id: String) -> String? {
        let folder = memoFolders.folderID(of: id)
        guard folder != MemoFolders.inbox else { return nil }
        return memoFolders.folder(folder)?.displayName(.current)
    }
}

// MARK: - The drawer's settings and what it shows

/// A shortcut the drawer claims from any app: a key code and Carbon modifiers, with the key's letter for showing.
struct DrawerShortcut: Equatable, Codable {
    var keyCode: Int
    var modifiers: Int
    var key: String

    /// ⇧⌘D (Windows Ctrl+Shift+D).
    static let standard = DrawerShortcut(keyCode: kVK_ANSI_D, modifiers: cmdKey | shiftKey, key: "D")
    /// ⌃⌥M (빠른 메모), ⌃⌥J (노트), ⌃⌥N (빠른 입력): the app's own, not to be taken.
    static let reserved = [(kVK_ANSI_M, controlKey | optionKey), (kVK_ANSI_J, controlKey | optionKey), (kVK_ANSI_N, controlKey | optionKey)]

    /// In the Mac's order: ⌃⌥⇧⌘ then the key.
    var text: String {
        var out = ""
        if modifiers & controlKey != 0 { out += "⌃" }
        if modifiers & optionKey != 0 { out += "⌥" }
        if modifiers & shiftKey != 0 { out += "⇧" }
        if modifiers & cmdKey != 0 { out += "⌘" }
        return out + key
    }

    var isReserved: Bool { Self.reserved.contains { $0.0 == keyCode && $0.1 == modifiers } }

    /// What a key press in the recorder makes: nil without ⌘, ⌃ or ⌥ (a plain letter can't be global).
    static func from(_ event: NSEvent) -> DrawerShortcut? {
        let flags = event.modifierFlags.intersection([.command, .control, .option, .shift])
        guard !flags.intersection([.command, .control, .option]).isEmpty else { return nil }
        var modifiers = 0
        if flags.contains(.command) { modifiers |= cmdKey }
        if flags.contains(.control) { modifiers |= controlKey }
        if flags.contains(.option) { modifiers |= optionKey }
        if flags.contains(.shift) { modifiers |= shiftKey }
        let names: [Int: String] = [kVK_Space: "Space", kVK_Return: "↩", kVK_Tab: "⇥", kVK_Delete: "⌫", kVK_LeftArrow: "←", kVK_RightArrow: "→",
                                    kVK_UpArrow: "↑", kVK_DownArrow: "↓", kVK_F1: "F1", kVK_F2: "F2", kVK_F3: "F3", kVK_F4: "F4", kVK_F5: "F5",
                                    kVK_F6: "F6", kVK_F7: "F7", kVK_F8: "F8", kVK_F9: "F9", kVK_F10: "F10", kVK_F11: "F11", kVK_F12: "F12"]
        let code = Int(event.keyCode)
        guard code != kVK_Escape else { return nil }
        let key = names[code] ?? (event.charactersIgnoringModifiers ?? "").uppercased()
        guard !key.isEmpty, key.unicodeScalars.allSatisfy({ $0.value >= 32 }) else { return nil }
        return DrawerShortcut(keyCode: code, modifiers: modifiers, key: key)
    }

    /// For the menu item: the key equivalent and its modifier mask.
    var menuKey: (String, NSEvent.ModifierFlags)? {
        guard key.count == 1 else { return nil }
        var mask: NSEvent.ModifierFlags = []
        if modifiers & cmdKey != 0 { mask.insert(.command) }
        if modifiers & controlKey != 0 { mask.insert(.control) }
        if modifiers & optionKey != 0 { mask.insert(.option) }
        if modifiers & shiftKey != 0 { mask.insert(.shift) }
        return (key.lowercased(), mask)
    }
}

/// 메모 서랍: this Mac's settings for it (side, width, handle, theme, pin, shortcut, the last folder) and what it
/// shows (the folder, the open slip, the search). It keeps its own copy of the memos and folders, refreshed only
/// while the drawer is open, so the note's other changes don't redraw a hidden drawer.
@MainActor
final class MemoDrawer: ObservableObject {
    enum Side: String, CaseIterable { case right, left }

    enum Theme: String, CaseIterable, Identifiable {
        case auto, day, night, kraft, grid
        var id: String { rawValue }
        var title: String {
            switch self {
            case .auto: L("자동")
            case .day: L("낮 종이")
            case .night: L("밤 종이")
            case .kraft: L("크라프트지")
            case .grid: L("모눈 노트")
            }
        }
    }

    static let widths: ClosedRange<CGFloat> = 260...480
    static let defaultWidth: CGFloat = 300

    unowned let model: AppModel
    private var preferences: UserDefaults { model.preferences }
    private var subscriptions = Set<AnyCancellable>()

    // MARK: Settings (this Mac)
    @Published var side: Side { didSet { preferences.set(side.rawValue, forKey: "drawer.side") } }
    @Published var width: CGFloat { didSet { preferences.set(Double(width), forKey: "drawer.width") } }
    @Published var handleOn: Bool { didSet { preferences.set(handleOn, forKey: "drawer.handle") } }
    @Published var theme: Theme { didSet { preferences.set(theme.rawValue, forKey: "drawer.theme") } }
    /// 위에 고정: floating above other windows (default on).
    @Published var pinned: Bool { didSet { preferences.set(pinned, forKey: "drawer.pinned") } }
    /// nil: 끄기.
    @Published var shortcut: DrawerShortcut? {
        didSet {
            if let shortcut, let data = try? JSONEncoder().encode(shortcut) { preferences.set(data, forKey: "drawer.shortcut") } else { preferences.set(Data(), forKey: "drawer.shortcut") }
        }
    }
    /// Whether the shortcut could be claimed (another app may hold it).
    @Published var shortcutRegistered = true
    /// The handle's place: its centre as a fraction of the screen's usable height from the top (nil: a third down).
    var handlePosition: Double? {
        get { preferences.object(forKey: "drawer.handleY") as? Double }
        set { preferences.set(newValue, forKey: "drawer.handleY") }
    }
    /// 바탕 (1.44): the drawer's paper solid, 82 % with a blur, 62 % with a blur, or none (the sheets float).
    enum Backdrop: String, CaseIterable, Identifiable {
        case opaque, translucent, strong, none
        var id: String { rawValue }
        var title: String {
            switch self {
            case .opaque: L("불투명")
            case .translucent: L("반투명")
            case .strong: L("강하게")
            case .none: L("바탕 없음")
            }
        }
        /// The paper's opacity over the blur.
        var paperOpacity: Double {
            switch self {
            case .opaque: 1
            case .translucent: 0.82
            case .strong: 0.62
            case .none: 0
            }
        }
    }
    @Published var backdrop: Backdrop { didSet { preferences.set(backdrop.rawValue, forKey: "drawer.backdrop") } }
    /// System Settings › Accessibility › Display › Reduce transparency: 반투명 and 강하게 draw as 불투명.
    @Published var reduceTransparency = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
    /// What's drawn: 반투명/강하게 fall back to 불투명 under Reduce transparency (바탕 없음 still works).
    var shownBackdrop: Backdrop {
        reduceTransparency && (backdrop == .translucent || backdrop == .strong) ? .opaque : backdrop
    }
    /// 고정's 정렬 (고정 isn't a folder, so it lives here, on this Mac).
    @Published var pinnedSort: MemoFolders.Sort { didSet { preferences.set(pinnedSort.rawValue, forKey: "drawer.pinnedSort") } }
    /// The last two folders memos were moved to (폴더로 옮기기 › 최근).
    var recentMoves: [String] {
        get { preferences.stringArray(forKey: "drawer.recentMoves") ?? [] }
        set { preferences.set(Array(newValue.prefix(2)), forKey: "drawer.recentMoves") }
    }

    /// The folder last shown (quick memo and /메모 go there).
    var lastFolder: String? {
        get { preferences.string(forKey: "drawer.lastFolder") }
        set { preferences.set(newValue, forKey: "drawer.lastFolder") }
    }

    // MARK: What it shows
    @Published private(set) var memos: [Memo] = []
    @Published private(set) var folders = MemoFolders.fresh()
    @Published var tab: MemoFolders.Tab = .folder(MemoFolders.inbox)
    @Published var expandedID: String?
    /// The open slip is being typed in (its raw text), not just shown with its boxes.
    @Published var editing = false
    /// Where the caret goes when an open slip turns to typing (the line clicked).
    var editLine: Int?
    @Published var selectedID: String?
    /// 크게 보기: one memo the drawer's whole height.
    @Published var bigID: String?
    @Published var searching = false
    @Published var query = ""
    @Published var quickText = ""
    /// The folder sheet (new, or name and colour of one).
    @Published var folderSheet: FolderSheet?
    @Published var toast: DrawerToast?
    /// Bumped to move the keyboard: the quick-write slip, the search field.
    @Published var focusQuick = 0
    @Published var focusSearch = 0
    /// The order slips are drawn in, kept while one is open (an edit moves a memo to the top of the list).
    private var order: [String: Int] = [:]
    /// The times and titles the list is sorted and grouped by, frozen with the order (an edit doesn't move the open
    /// memo to 오늘 until it's closed).
    private var frozen: [String: (updated: Date, title: String)] = [:]
    /// Open on screen: only then do the memos and folders follow the model.
    private(set) var isOpen = false
    private var toastTask: Task<Void, Never>?

    /// Set by the app.
    var onClose: () -> Void = {}
    /// Esc in a text: the open things one at a time, then the drawer.
    var onEscape: () -> Void = {}
    var onToggle: () -> Void = {}
    var onWidth: (CGFloat) -> Void = { _ in }
    var onPin: () -> Void = {}
    /// Set by the snapshot renderer: a desktop drawn blurred under a see-through paper (the app's blur is the panel's).
    var previewDesktop = false
    /// Set by the snapshot renderer: this card drawn as if under the pointer (its hover pill).
    var previewHover: String?
    /// Set by the snapshot renderer: a fixed "now" for slip times.
    var now: (() -> Date) = { Date() }

    struct FolderSheet: Equatable {
        /// nil: a new folder.
        var id: String?
        var name: String
        var color: MemoFolders.Color
        /// 폴더로 옮기기 › 새 폴더…: the memo that goes into it once it's made.
        var moving: String?
    }

    /// The paper drawn now (자동 follows the app's day or night).
    var palette: DrawerPalette {
        theme.palette(NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .dark : .light)
    }

    struct DrawerToast: Equatable {
        var text: String
        var action: String?
        var id = UUID()
        static func == (a: DrawerToast, b: DrawerToast) -> Bool { a.id == b.id }
    }
    private var toastAction: (() -> Void)?

    init(model: AppModel) {
        self.model = model
        let store = model.preferences
        side = Side(rawValue: store.string(forKey: "drawer.side") ?? "") ?? .right
        let saved = store.double(forKey: "drawer.width")
        width = saved > 0 ? min(max(CGFloat(saved), Self.widths.lowerBound), Self.widths.upperBound) : Self.defaultWidth
        handleOn = store.object(forKey: "drawer.handle") == nil ? true : store.bool(forKey: "drawer.handle")
        theme = Theme(rawValue: store.string(forKey: "drawer.theme") ?? "") ?? .auto
        pinned = store.object(forKey: "drawer.pinned") == nil ? true : store.bool(forKey: "drawer.pinned")
        backdrop = Backdrop(rawValue: store.string(forKey: "drawer.backdrop") ?? "") ?? .opaque
        pinnedSort = MemoFolders.Sort(rawValue: store.string(forKey: "drawer.pinnedSort") ?? "") ?? .edited
        if let data = store.data(forKey: "drawer.shortcut") {
            shortcut = data.isEmpty ? nil : (try? JSONDecoder().decode(DrawerShortcut.self, from: data)) ?? .standard
        } else {
            shortcut = .standard
        }
        model.$memos.sink { [weak self] memos in
            guard let self, self.isOpen else { return }
            self.memos = memos
        }.store(in: &subscriptions)
        model.$notebookFont.dropFirst().sink { [weak self] _ in self?.objectWillChange.send() }.store(in: &subscriptions)
        NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                let reduce = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
                if self?.reduceTransparency != reduce { self?.reduceTransparency = reduce }
            }.store(in: &subscriptions)
        model.$memoFolders.sink { [weak self] folders in
            guard let self, self.isOpen else { return }
            self.folders = folders
            self.leaveMissingTab(folders)
        }.store(in: &subscriptions)
    }

    // MARK: Opening

    /// The drawer comes out: fresh memos and folders, on the last folder.
    func willOpen() {
        isOpen = true
        // Only what changed while it was closed is published: an unchanged drawer comes back without redrawing (1.43 perf).
        if memos != model.memos { memos = model.memos }
        if folders != model.memoFolders { folders = model.memoFolders }
        var wanted = tab
        if case .folder(let id) = tab, folders.folder(id) == nil { wanted = .folder(folders.lastFolder(lastFolder)) }
        if !openedOnce {
            openedOnce = true
            wanted = .folder(folders.lastFolder(lastFolder))
        }
        if wanted != tab { tab = wanted }
        freezeOrder()
    }
    private var openedOnce = false

    func didClose() {
        isOpen = false
        commitOpenSlip()
        if expandedID != nil { expandedID = nil }
        if editing { editing = false }
        if bigID != nil { bigID = nil }
        if folderSheet != nil { folderSheet = nil }
    }

    /// For snapshots and the first draw: the model's data now.
    func refreshForSnapshot() {
        isOpen = true
        memos = model.memos
        folders = model.memoFolders
        freezeOrder()
    }

    private func leaveMissingTab(_ folders: MemoFolders) {
        if case .folder(let id) = tab, folders.folder(id) == nil { show(.folder(MemoFolders.inbox)) }
    }

    // MARK: Lists

    var currentFolderID: String? {
        if case .folder(let id) = tab { return id }
        return nil
    }

    var currentFolder: MemoFolders.Folder? { currentFolderID.flatMap { folders.folder($0) } }

    /// The memos under the bookmark, in the list's order (its sections, top to bottom).
    var shown: [Memo] {
        let byID = Dictionary(memos.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        return sections.flatMap(\.ids).compactMap { byID[$0] }
    }

    private var tabMemos: [Memo] {
        switch tab {
        case .pinned: folders.pinnedMemos(memos)
        case .folder(let id): folders.memos(memos, in: id)
        }
    }

    /// 정렬 of what's shown: the folder's, or 고정's (this Mac's).
    var sort: MemoFolders.Sort {
        switch tab {
        case .pinned: pinnedSort
        case .folder(let id): folders.sort(of: id)
        }
    }

    func setSort(_ sort: MemoFolders.Sort, for tab: MemoFolders.Tab) {
        switch tab {
        case .pinned: pinnedSort = sort
        case .folder(let id): model.setMemoFolderSort(id, sort)
        }
        freezeOrder()
    }

    /// The list in its groups (D23, D24): 고정 first (not in 고정's own view), then by date — by the times frozen while
    /// a memo is open; a memo new since then goes on top.
    var sections: [MemoCards.Section] {
        let sort = sort
        let entries = tabMemos.map { memo -> MemoCards.Entry in
            let still = frozen[memo.id]
            let updated = still?.updated ?? memo.updatedAt
            return MemoCards.Entry(id: memo.id, date: sort == .created ? memo.createdAt : updated, updatedAt: updated,
                                   title: still?.title ?? cardTitle(memo), pinned: folders.isPinned(memo.id))
        }
        return MemoCards.sections(entries, sort: sort, pinnedGroup: tab != .pinned, now: now())
    }

    /// What a card says (its title, preview line, kind), worked out once per text: the list redraws on every open and
    /// keystroke, and the kinds are found with regular expressions.
    struct Card {
        var title: String
        var preview: String?
        var kind: MemoCards.Kind?
    }
    private var cards: [String: (text: String, card: Card)] = [:]

    func card(_ memo: Memo) -> Card {
        if let known = cards[memo.id], known.text == memo.text { return known.card }
        let made = Card(title: MemoCards.title(memo.text, language: .current), preview: MemoCards.preview(memo.text), kind: MemoCards.kind(memo.text))
        if cards.count > 2000 { cards.removeAll() }
        cards[memo.id] = (memo.text, made)
        return made
    }

    /// Only the card's title (the list's order and 제목 순 need no more).
    func cardTitle(_ memo: Memo) -> String {
        if let known = cards[memo.id], known.text == memo.text { return known.card.title }
        if let known = titles[memo.id], known.text == memo.text { return known.title }
        let title = MemoCards.title(memo.text, language: .current)
        if titles.count > 2000 { titles.removeAll() }
        titles[memo.id] = (memo.text, title)
        return title
    }
    private var titles: [String: (text: String, title: String)] = [:]

    /// The time a card is grouped and timed by: 만든 순 its creation, else its last edit (frozen while a memo is open).
    func sortDate(_ memo: Memo) -> Date {
        sort == .created ? memo.createdAt : (frozen[memo.id]?.updated ?? memo.updatedAt)
    }

    /// More than 20 memos shown: the cards a little closer (12 pt apart, at least 56 tall).
    var dense: Bool { tabMemos.count > 20 }

    func arranged(_ list: [Memo]) -> [Memo] {
        list.enumerated().sorted { a, b in
            let x = order[a.element.id] ?? -1, y = order[b.element.id] ?? -1
            return x != y ? x < y : a.offset < b.offset
        }.map(\.element)
    }

    var hits: [MemoFolders.Hit] { folders.search(query, memos: arranged(memos), language: .current) }

    func freezeOrder() {
        order = Dictionary(memos.enumerated().map { ($0.element.id, $0.offset) }, uniquingKeysWith: { first, _ in first })
        frozen = Dictionary(memos.map { ($0.id, ($0.updatedAt, cardTitle($0))) }, uniquingKeysWith: { first, _ in first })
    }

    func memo(_ id: String?) -> Memo? { id.flatMap { id in memos.first { $0.id == id } } }

    // MARK: Moving around

    func show(_ tab: MemoFolders.Tab) {
        commitOpenSlip()
        expandedID = nil
        editing = false
        bigID = nil
        selectedID = nil
        searching = false
        query = ""
        self.tab = tab
        if case .folder(let id) = tab { lastFolder = id }
        freezeOrder()
    }

    /// D16: ⌘1–9 · ⌘0.
    func showDigit(_ digit: Int) {
        guard let tab = folders.tab(forDigit: digit) else { return }
        show(tab)
    }

    func toggleSearch() {
        if searching { endSearch() } else { startSearch() }
    }

    func startSearch() {
        commitOpenSlip()
        expandedID = nil
        editing = false
        bigID = nil
        searching = true
        selectedID = nil
        focusSearch += 1
    }

    func endSearch() {
        searching = false
        query = ""
        selectedID = nil
    }

    /// A search result: its folder, opened at it.
    func reveal(_ id: String) {
        let folder = folders.folderID(of: id)
        show(.folder(folder))
        selectedID = id
        expand(id)
    }

    /// ↑ ↓: the next slip (the list's or the results').
    func moveSelection(_ step: Int) {
        let ids = searching ? hits.map(\.memoID) : shown.map(\.id)
        guard !ids.isEmpty else { return }
        if let current = selectedID ?? expandedID, let index = ids.firstIndex(of: current) {
            selectedID = ids[min(max(index + step, 0), ids.count - 1)]
        } else {
            selectedID = step > 0 ? ids.first : ids.last
        }
    }

    /// ↩ on the picked slip: opens it (typing at once when it has no boxes).
    func openSelected() {
        guard let id = selectedID else { return }
        if searching { reveal(id); return }
        expand(id)
    }

    /// One open slip at a time.
    func expand(_ id: String) {
        guard expandedID != id else { return }
        commitOpenSlip()
        expandedID = id
        selectedID = id
        model.openMemoID = id
        editLine = nil
        editing = Checklist.lines(memo(id)?.text ?? "").isEmpty
    }

    /// 펼쳐서 고치기: open, typing.
    func edit(_ id: String) {
        expand(id)
        editLine = nil
        editing = true
    }

    /// 크게 보기.
    func showBig(_ id: String) {
        if expandedID != id { expand(id) }
        bigID = id
    }

    func collapse() {
        commitOpenSlip()
        expandedID = nil
        editing = false
        freezeOrder()
    }

    /// Esc: the big view, the open slip, the folder sheet, the search — one at a time; false when nothing was open
    /// (the drawer closes).
    func escape() -> Bool {
        if folderSheet != nil { folderSheet = nil; return true }
        if bigID != nil { bigID = nil; return true }
        if expandedID != nil { collapse(); return true }
        if searching { endSearch(); return true }
        return false
    }

    /// Leaving the open memo: a blank one quietly goes away, the rest is written out (AppModel.closeMemo).
    private func commitOpenSlip() {
        if model.openMemoID != nil { model.closeMemo() }
    }

    // MARK: Writing

    /// D10, D11: ↩ in the quick-write slip.
    func quickWrite() {
        guard let text = MemoFolders.quickWriteText(quickText) else { return }
        let target = folders.quickWriteTarget(tab)
        if let id = model.addMemo(text: text, folder: target.folder, pinned: target.pinned) {
            quickText = ""
            memos = model.memos
            folders = model.memoFolders
            selectedID = id
        }
    }

    func edit(_ id: String, text: String, from old: String) {
        model.updateMemo(id, text: text, from: old)
    }

    func copy(_ id: String) {
        guard let memo = memo(id) else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(memo.text, forType: .string)
        say(L("복사했어요"))
    }

    func togglePin(_ id: String) {
        let pinned = !folders.isPinned(id)
        model.setMemoPinned(id, pinned)
        say(pinned ? L("고정했어요") : L("고정을 풀었어요"))
    }

    func move(_ id: String, to folder: String) {
        guard folders.folderID(of: id) != folder else { return }
        model.moveMemo(id, to: folder)
        recentMoves = [folder] + recentMoves.filter { $0 != folder }
        if case .folder(let current) = tab, current != folder, expandedID == id {
            expandedID = nil
            editing = false
        }
        let name = folders.folder(folder)?.displayName(.current) ?? ""
        say(L("‘\(name)’ 폴더로 옮겼어요"))
    }

    /// ⌘⌫ / ⋯ → 지우기: gone, with 되돌리기.
    func delete(_ id: String) {
        guard memo(id) != nil else { return }
        if expandedID == id { expandedID = nil; editing = false }
        if bigID == id { bigID = nil }
        let next = shown.map(\.id)
        if let index = next.firstIndex(of: id) { selectedID = next.indices.contains(index + 1) ? next[index + 1] : (index > 0 ? next[index - 1] : nil) }
        model.deleteMemo(id)
        say(L("메모를 지웠어요"), action: L("되돌리기")) { [weak self] in self?.model.restoreDeletedMemo() }
    }

    /// 복제 (the memo menu): a copy now, in the same folder.
    func duplicate(_ id: String) {
        guard let copy = model.duplicateMemo(id) else { return }
        memos = model.memos
        folders = model.memoFolders
        selectedID = copy
        say(L("복제했어요"))
    }

    /// 이 메모의 종이.
    func setPaper(_ id: String, _ paper: MemoFolders.Paper?) {
        model.setMemoPaper(id, paper)
    }

    /// 체크한 줄 지우기 (D27), with 되돌리기.
    func clearChecked(_ id: String) {
        guard let memo = memo(id) else { return }
        let text = Checklist.removeChecked(memo.text)
        guard text != memo.text else { return }
        model.updateMemo(id, text: text, from: memo.text)
        model.saveMemosNow()
        say(L("체크한 줄을 지웠어요"), action: L("되돌리기")) { [weak self] in
            guard let self, let now = self.memo(id) else { return }
            self.model.updateMemo(id, text: memo.text, from: now.text)
            self.model.saveMemosNow()
        }
    }

    /// 복사한 글로 새 메모: what's on the clipboard, as a new memo here (as the quick-write slip would).
    func newFromClipboard() {
        guard let text = NSPasteboard.general.string(forType: .string).flatMap(MemoFolders.quickWriteText) else {
            say(L("복사한 글이 없어요"))
            return
        }
        let target = folders.quickWriteTarget(tab)
        guard let id = model.addMemo(text: text, folder: target.folder, pinned: target.pinned) else { return }
        memos = model.memos
        folders = model.memoFolders
        selectedID = id
    }

    /// ⌘N / 새 메모: the keyboard in the quick-write slip.
    func newMemo() {
        endSearch()
        bigID = nil
        if expandedID != nil { collapse() }
        focusQuick += 1
    }

    /// 여기에 새 메모 (a bookmark's menu): that folder, the keyboard in the quick-write slip.
    func newMemo(in tab: MemoFolders.Tab) {
        if self.tab != tab || searching { show(tab) }
        newMemo()
    }

    /// 고정 모두 풀기 (D28), with 되돌리기.
    func unpinAll() {
        let ids = model.unpinAllMemos()
        guard !ids.isEmpty else { return }
        say(L("고정을 모두 풀었어요"), action: L("되돌리기")) { [weak self] in self?.model.pinMemos(ids) }
    }

    /// 복제 (a bookmark's menu): the copy, shown.
    func duplicateFolder(_ id: String) {
        guard let copy = model.duplicateMemoFolder(id) else { return }
        memos = model.memos
        folders = model.memoFolders
        show(.folder(copy))
    }

    /// 메모 서랍 설정… (⌘,): 책상 → 메모 서랍.
    func openSettings() { model.showDesk(.drawer) }

    /// 도움말: the 메모 서랍 topic.
    func openHelp() {
        HelpView.requestedTopic = "drawer"
        model.showDesk(.help)
    }

    /// The folder list (the name's ▾, ⌘L): set by the header's hotspot.
    var openFolderList: () -> Void = {}

    // MARK: Folders

    func newFolder(moving memo: String? = nil) {
        let used = Set(folders.visible.map(\.color))
        let color = MemoFolders.Color.allCases.first { !used.contains($0.rawValue) } ?? .lavender
        folderSheet = FolderSheet(id: nil, name: "", color: color, moving: memo)
    }

    func editFolder(_ id: String) {
        guard let folder = folders.folder(id) else { return }
        folderSheet = FolderSheet(id: id, name: folder.displayName(.current), color: folder.colorKey)
    }

    func saveFolderSheet() {
        guard let sheet = folderSheet else { return }
        let name = MemoFolders.cleanName(sheet.name)
        guard !name.isEmpty else { return }
        if let id = sheet.id {
            if folders.folder(id)?.displayName(.current) != name { model.renameMemoFolder(id, to: name) }
            model.recolorMemoFolder(id, to: sheet.color)
        } else if let id = model.addMemoFolder(name: name, color: sheet.color) {
            folders = model.memoFolders
            if let memo = sheet.moving { move(memo, to: id) } else { show(.folder(id)) }
        }
        folderSheet = nil
    }

    func deleteFolder(_ id: String) {
        let name = folders.folder(id)?.displayName(.current) ?? ""
        guard let moved = model.deleteMemoFolder(id) else { return }
        folderSheet = nil
        if currentFolderID == id { show(.folder(MemoFolders.inbox)) }
        let inbox = folders.folder(MemoFolders.inbox)?.displayName(.current) ?? ""
        let text = moved.isEmpty ? L("‘\(name)’ 폴더를 지웠어요") : MemoFolders.movedToInbox(count: moved.count, inbox: inbox, language: .current)
        say(text, action: L("되돌리기")) { [weak self] in
            self?.model.restoreMemoFolder(id, memoIDs: moved)
            self?.show(.folder(id))
        }
    }

    // MARK: Toast

    func say(_ text: String, action: String? = nil, perform: (() -> Void)? = nil) {
        toastTask?.cancel()
        toast = DrawerToast(text: text, action: action)
        toastAction = perform
        let seconds = action == nil ? 2.0 : 6.0
        toastTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(seconds))
            guard !Task.isCancelled else { return }
            self?.toast = nil
            self?.toastAction = nil
        }
    }

    func performToast() {
        toastAction?()
        toastTask?.cancel()
        toast = nil
        toastAction = nil
    }
}
