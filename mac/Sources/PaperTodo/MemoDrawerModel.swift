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
        guard let data = try? SafeFile.sharedData(memoFoldersURL) else {
            memoFolders = .fresh(language: .current)
            knownFoldersData = nil
            return
        }
        do {
            memoFolders = try MemoFolders.decode(data, language: .current)
            knownFoldersData = data
        } catch {
            moveFoldersAside(now: now, starting: true)
            memoFolders = .fresh(language: .current)
            knownFoldersData = nil
        }
    }

    /// The unreadable file moved aside, said the way every file says it (#34): what happened, what's safe, where the
    /// original is (its name only — the storage folder button shows where). At launch every memo starts in 메모;
    /// later (another device's file) the folders here stay and are written again on the next change.
    private func moveFoldersAside(now: Date, starting: Bool) {
        let aside = memoFoldersURL.deletingLastPathComponent().appendingPathComponent(MemoFolders.asideName(now))
        let what = starting ? L("메모 폴더를 읽지 못해서 메모를 모두 ‘메모’ 폴더에 두고 시작했어요.")
                            : L("메모 폴더를 읽지 못했어요. 여기 있던 폴더는 그대로예요.")
        if (try? FileManager.default.moveItem(at: memoFoldersURL, to: aside)) != nil {
            storageError = what + " " + Self.keptAside(aside)
        } else {
            storageError = what + " " + L("저장 폴더가 열리는지 확인해 주세요.")
        }
    }

    /// Another device (or an older app's backup) changed the file: merged in, the newer side winning (D13, D14).
    /// A write of this Mac's still under way is waited for first, so the file read is never this Mac's older one.
    func catchUpMemoFolders() {
        finishMemoFolderWrites()
        guard let data = try? SafeFile.sharedData(memoFoldersURL), data != knownFoldersData else { return }
        knownFoldersData = data
        guard let theirs = try? MemoFolders.decode(data, language: .current) else {
            moveFoldersAside(now: Date(), starting: false)
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
        // Written off the main thread (tens of ms at thousands of memos); the next change, a check for another
        // device's file, a backup and quitting all wait for it first.
        let url = memoFoldersURL
        folderWriter.write(folders, to: url) { [weak self] result in
            guard let self else { return }
            switch result {
            case .success(let written):
                if written.latest { self.knownFoldersData = written.data }
                // A save that works again takes its own notice away (as on Windows).
                if self.storageError?.hasPrefix(L("메모 폴더를 저장하지 못했어요.")) == true { self.storageError = nil }
                PerfProbe.io("memo-folders", ms: written.ms)
            case .failure:
                // Every change writes the whole file again, so the next change really is the next try.
                self.storageError = Self.saveProblem(L("메모 폴더를 저장하지 못했어요."))
            }
        }
    }

    /// Every write of memo-folders.json asked for is on disk (and `knownFoldersData` is the last one).
    func finishMemoFolderWrites() {
        if let data = folderWriter.finish() { knownFoldersData = data }
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
        // 끝낸 항목 아래로 보내기 (#84): a finished item to the bottom of its checklist, one change of the words.
        let text = MemoEdits.toggleDone(memo.text, line: line, moveDone: drawer.doneToBottom)
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

    /// 보기 (#115): 카드 · 제목만, in memo-folders.json.
    func setMemoFolderView(_ id: String, _ view: MemoFolders.View) {
        guard let folder = memoFolders.folder(id), folder.view != (view == .cards ? nil : view.rawValue) else { return }
        changeMemoFolders { folders, now in folders.setView(id, view, now: now) }
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

/// memo-folders.json's writes, in order, on a queue of their own. `finish` waits for them and hands back the bytes of
/// the last one when no newer write is still to come.
final class MemoFoldersWriter: @unchecked Sendable {
    struct Written: Sendable {
        var data: Data
        /// No write was asked for after this one.
        var latest: Bool
        var ms: Double
    }
    private let queue = DispatchQueue(label: "memo-folders.json", qos: .userInitiated)
    private let lock = NSLock()
    private var asked = 0
    private var done: (number: Int, data: Data)?

    func write(_ folders: MemoFolders, to url: URL, then: @escaping @MainActor @Sendable (Result<Written, Error>) -> Void) {
        let number = lock.withLock { asked += 1; return asked }
        queue.async { [self] in
            let started = ProcessInfo.processInfo.systemUptime
            let result = Result<Data, Error> {
                let data = Data(folders.encoded().utf8)
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                try data.write(to: url, options: .atomic)
                return data
            }
            let ms = (ProcessInfo.processInfo.systemUptime - started) * 1000
            let latest: Bool = lock.withLock {
                if case .success(let data) = result { done = (number, data) }
                return number == asked
            }
            DispatchQueue.main.async {
                MainActor.assumeIsolated { then(result.map { Written(data: $0, latest: latest, ms: ms) }) }
            }
        }
    }

    /// Waits for the writes under way; the last one's bytes when it is the newest asked for.
    func finish() -> Data? {
        queue.sync {}
        return lock.withLock {
            guard let done, done.number == asked else { return nil }
            return done.data
        }
    }
}

// MARK: - The drawer's settings and what it shows

/// The drawer's key is a `GlobalShortcut` (PaperCore, saved as before); ⇧⌘D unless changed (Windows Ctrl+Shift+D).
typealias DrawerShortcut = GlobalShortcut

extension GlobalShortcut {
    /// ⇧⌘D, the drawer's.
    static var standard: GlobalShortcut { .drawerStandard }

    /// What a key press in a recorder makes: nil without ⌘, ⌃ or ⌥ (a plain letter can't be global).
    static func from(_ event: NSEvent) -> GlobalShortcut? {
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
        return GlobalShortcut(keyCode: code, modifiers: modifiers, key: key)
    }

    /// For a menu item: the key equivalent and its modifier mask.
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

    /// 서랍 종이 (#142): the paper picked for the day — the four of 1.45, then 한지 · 쑥색 · 벚꽃 · 먹색. Whether it gives
    /// way to 밤 종이 at night is `nightPaper` (1.45's ‘자동’ is 낮 종이 with it on).
    enum Theme: String, CaseIterable, Identifiable {
        case day, night, kraft, grid, hanji, sage, blossom, ink
        var id: String { rawValue }
        var title: String {
            switch self {
            case .day: L("낮 종이")
            case .night: L("밤 종이")
            case .kraft: L("크라프트지")
            case .grid: L("모눈 노트")
            case .hanji: L("한지")
            case .sage: L("쑥색 종이")
            case .blossom: L("벚꽃 종이")
            case .ink: L("먹색 종이")
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
    @Published var theme: Theme { didSet { saveTheme() } }
    /// 밤에는 밤 종이로 (#142): at night a light paper gives way to 밤 종이 (a dark one stays).
    @Published var nightPaper: Bool { didSet { saveTheme() } }
    /// `drawer.theme` keeps 1.45's values (`auto` for 낮 종이 with the switch on), `drawer.nightPaper` the switch.
    private func saveTheme() {
        preferences.set(TextSteps.drawerThemeValue(paper: theme.rawValue, nightPaper: nightPaper), forKey: "drawer.theme")
        preferences.set(nightPaper, forKey: "drawer.nightPaper")
    }
    /// 위에 고정: floating above other windows (default on).
    @Published var pinned: Bool { didSet { preferences.set(pinned, forKey: "drawer.pinned") } }
    /// nil: 끄기.
    @Published var shortcut: DrawerShortcut? {
        didSet {
            if let shortcut, let data = try? JSONEncoder().encode(shortcut) { preferences.set(data, forKey: "drawer.shortcut") } else { preferences.set(Data(), forKey: "drawer.shortcut") }
            // The key turned off is kept, so the switch turns that same key back on (#27).
            if shortcut == nil, let oldValue, let data = try? JSONEncoder().encode(oldValue) { preferences.set(data, forKey: "drawer.shortcutBeforeOff") }
        }
    }
    /// The switch beside the key: on brings back the key last turned off (or ⇧⌘D).
    var shortcutOn: Bool {
        get { shortcut != nil }
        set {
            guard newValue != (shortcut != nil) else { return }
            if newValue {
                let kept = preferences.data(forKey: "drawer.shortcutBeforeOff").flatMap { try? JSONDecoder().decode(DrawerShortcut.self, from: $0) }
                // Unless 빠른 입력 · 빠른 메모 or the note holds it now (#85).
                shortcut = kept.flatMap { ShortcutRules.taken($0, by: .drawer, note: model.noteShortcut, drawer: nil) == nil ? $0 : nil } ?? .standard
            } else {
                shortcut = nil
            }
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
    /// 메모 글꼴 · 크기 (#84): one face and one size step for every memo in the drawer, this Mac's.
    @Published var bodyFace: MemoText.Face { didSet { preferences.set(bodyFace.rawValue, forKey: "drawer.font") } }
    /// #141: 12–20 pt as `drawer.textPt`, and the nearest of 1.45's four as `drawer.textSize` for an older version.
    @Published var textSize: MemoText.Size {
        didSet {
            preferences.set(textSize.rawValue, forKey: "drawer.textPt")
            preferences.set(TextSteps.drawerLegacyName(textSize.rawValue), forKey: "drawer.textSize")
        }
    }
    /// 줄 간격 · 문단 간격 (#141), this Mac's.
    @Published var lineSpacing: MemoText.LineSpacing { didSet { preferences.set(lineSpacing.rawValue, forKey: "drawer.lineHeight") } }
    @Published var paragraphSpacing: MemoText.ParagraphSpacing { didSet { preferences.set(paragraphSpacing.rawValue, forKey: "drawer.paragraph") } }
    /// 코드 글꼴 (#143), this Mac's: the system's fixed-width face (the default) or D2Coding.
    @Published var codeFace: MemoText.CodeFace { didSet { preferences.set(codeFace.rawValue, forKey: "drawer.codeFont") } }
    /// 기호 늘 보이기 (⇧⌘R) and 끝낸 항목 아래로 보내기 (#84, 2026-10-30), this Mac's.
    @Published var showMarks: Bool { didSet { preferences.set(showMarks, forKey: "drawer.showMarks") } }
    @Published var doneToBottom: Bool { didSet { preferences.set(doneToBottom, forKey: "drawer.doneToBottom") } }
    var text: MemoText { MemoText(face: bodyFace, size: textSize, codeFace: codeFace, showMarks: showMarks, lineSpacingChoice: lineSpacing, paragraphChoice: paragraphSpacing) }
    /// The open memo's text view (the Aa bar's buttons act on it) and whether the bar is out.
    weak var editorView: DrawerTextView.KeyTextView?
    @Published var formatBarOpen = false
    func format(_ format: DrawerTextView.KeyTextView.Format) { editorView?.format(format) }

    /// #135 (SideNotes' way): the link field under the open memo — the chosen words (or the link the caret is in) and
    /// the address it starts with. Nothing in the memo changes until Return (one undo); Esc puts it away.
    struct LinkEdit: Equatable {
        var from: Int
        var to: Int
        var url: String
        /// In a link already: Return changes its address, an empty one (or 링크 빼기) takes the link out.
        var existing: Bool
    }
    @Published var linkEdit: LinkEdit?

    /// The link field's Return (or 링크 빼기, an empty address): the words made a link, its address changed, or the link
    /// taken out; the keyboard back in the memo.
    func finishLink(_ url: String) {
        guard let edit = linkEdit else { return }
        linkEdit = nil
        guard let view = editorView else { return }
        let length = (view.string as NSString).length
        if edit.to <= length {
            view.apply(MemoEdits.setLink(view.string, from: edit.from, to: edit.to, url: url))
        }
        view.window?.makeFirstResponder(view)
    }

    /// Esc in the link field: nothing changes, the keyboard back in the memo where it was.
    func cancelLink() {
        guard linkEdit != nil else { return }
        linkEdit = nil
        if let view = editorView { view.window?.makeFirstResponder(view) }
    }
    /// The titles' handwriting: the body's when it is a handwriting face (title and words alike), else the notebook's.
    var titleFont: NotebookFont { bodyFace.notebook ?? model.notebookFont }
    /// System Settings › Accessibility › Display › Reduce transparency: 반투명 and 강하게 draw as 불투명.
    @Published var reduceTransparency = NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
    /// What's drawn: 반투명/강하게 fall back to 불투명 under Reduce transparency (바탕 없음 still works).
    var shownBackdrop: Backdrop {
        reduceTransparency && (backdrop == .translucent || backdrop == .strong) ? .opaque : backdrop
    }
    /// 고정's 정렬 (고정 isn't a folder, so it lives here, on this Mac).
    @Published var pinnedSort: MemoFolders.Sort {
        didSet {
            preferences.set(pinnedSort.rawValue, forKey: "drawer.pinnedSort")
            listChanged()
        }
    }
    /// 고정's 보기 (#115; 고정 isn't a folder, so it lives here, on this Mac, as its 정렬 does).
    @Published var pinnedView: MemoFolders.View {
        didSet {
            preferences.set(pinnedView.rawValue, forKey: "drawer.pinnedView")
            listChanged()
        }
    }
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
    @Published private(set) var memos: [Memo] = [] {
        didSet {
            listChanged()
            forgetGoneCards()
        }
    }
    @Published private(set) var folders = MemoFolders.fresh() { didSet { listChanged() } }
    @Published var tab: MemoFolders.Tab = .folder(MemoFolders.inbox) { didSet { listChanged() } }
    @Published var expandedID: String?
    /// The open slip is being typed in (its raw text), not just shown with its boxes.
    @Published var editing = false
    /// Where the caret goes when an open slip turns to typing (the line clicked).
    var editLine: Int?
    @Published var selectedID: String?
    /// 크게 보기: one memo the drawer's whole height, the drawer wider while it shows (#113).
    @Published var bigID: String?
    /// The width of the screen the drawer is out on (set as it opens): 크게 보기 takes up to 45 % of it.
    var screenWidth: CGFloat = 1440
    /// The paper's width now: the user's, or while a memo is shown big up to 640 (#113, MemoCards.bigWidth); the
    /// setting itself never changes.
    var shownWidth: CGFloat {
        guard bigID != nil else { return width }
        return CGFloat(MemoCards.bigWidth(user: Double(width), screen: Double(screenWidth),
                                          chrome: Double(MemoDrawerView.shadowRoom + MemoDrawerView.tabsWidth)))
    }
    @Published var searching = false
    @Published var query = "" { didSet { if query != oldValue { searchSoon() } } }
    /// 메모 찾기's chips (#114): only the folder (or 고정) shown, and the kinds of memo kept to. Both start over with each
    /// search.
    @Published var searchHere = false { didSet { foundCache = nil } }
    @Published var searchFilters: MemoFolders.SearchFilters = [] { didSet { foundCache = nil } }
    /// What the results are for: `query` once its keys pause (80 ms), at once when it's emptied.
    @Published private(set) var searchedQuery = ""
    private var searchTask: Task<Void, Never>?
    /// The memos' lines as the search reads them, kept per memo text between searches.
    private let searchIndex = MemoFolders.SearchIndex()
    /// The wait after the last key before searching (snapshots: none).
    var searchPause: Duration = .milliseconds(80)
    @Published var quickText = ""
    /// The folder sheet (new, or name and colour of one).
    @Published var folderSheet: FolderSheet?
    /// 지운 메모's slip (#120) and its question before 모두 비우기 (MemoDrawerTrash.swift).
    @Published var trashOpen = false
    @Published var trashConfirm = false
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
    /// Set by the snapshot renderer: the empty bookmark (+) and the close bar drawn as if under the pointer.
    var previewEdgeHover = false
    /// The close bar has the keyboard (#83): ↩ there closes the drawer instead of opening the picked memo.
    var closeBarFocused = false
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

    /// The paper drawn now (밤에는 밤 종이로 follows the app's day or night).
    var palette: DrawerPalette {
        palette(NSApp.effectiveAppearance.bestMatch(from: [.darkAqua, .aqua]) == .darkAqua ? .dark : .light)
    }

    /// The paper drawn under `scheme`: the picked one, or 밤 종이 at night when the switch says so.
    func palette(_ scheme: ColorScheme) -> DrawerPalette {
        let shown = TextSteps.drawerShownPaper(paper: theme.rawValue, nightPaper: nightPaper, night: scheme == .dark)
        return DrawerPalette.of(DrawerPalette.Kind(rawValue: shown) ?? .day)
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
        // #142: 1.45's ‘자동’ is 낮 종이 with 밤에는 밤 종이로 on; a paper picked by name had it off.
        let picked = TextSteps.drawerPaper(theme: store.string(forKey: "drawer.theme"), nightPaper: store.object(forKey: "drawer.nightPaper") as? Bool)
        theme = Theme(rawValue: picked.paper) ?? .day
        nightPaper = picked.nightPaper
        pinned = store.object(forKey: "drawer.pinned") == nil ? true : store.bool(forKey: "drawer.pinned")
        backdrop = Backdrop(rawValue: store.string(forKey: "drawer.backdrop") ?? "") ?? .opaque
        bodyFace = MemoText.Face(rawValue: store.string(forKey: "drawer.font") ?? "") ?? .clean
        textSize = MemoText.Size(rawValue: TextSteps.drawerPoint(saved: store.object(forKey: "drawer.textPt") as? Int, legacy: store.string(forKey: "drawer.textSize"))) ?? .regular
        lineSpacing = MemoText.LineSpacing(rawValue: store.string(forKey: "drawer.lineHeight") ?? "") ?? .regular
        paragraphSpacing = MemoText.ParagraphSpacing(rawValue: store.string(forKey: "drawer.paragraph") ?? "") ?? .regular
        codeFace = MemoText.CodeFace(rawValue: store.string(forKey: "drawer.codeFont") ?? "") ?? .system
        showMarks = store.bool(forKey: "drawer.showMarks")
        doneToBottom = store.object(forKey: "drawer.doneToBottom") == nil ? true : store.bool(forKey: "drawer.doneToBottom")
        pinnedSort = MemoFolders.Sort(rawValue: store.string(forKey: "drawer.pinnedSort") ?? "") ?? .edited
        pinnedView = MemoFolders.View(rawValue: store.string(forKey: "drawer.pinnedView") ?? "") ?? .cards
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
        // 지운 메모 (#120): its slip and the menus' row follow the trash while the drawer is out.
        model.$memoTrash.dropFirst().sink { [weak self] _ in if self?.isOpen == true { self?.objectWillChange.send() } }.store(in: &subscriptions)
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
        sendTyped()
        isOpen = false
        commitOpenSlip()
        if expandedID != nil { expandedID = nil }
        if editing { editing = false }
        if bigID != nil { bigID = nil }
        if folderSheet != nil { folderSheet = nil }
        if trashOpen { trashOpen = false }
        if trashConfirm { trashConfirm = false }
    }

    /// For snapshots and the first draw: the model's data now.
    func refreshForSnapshot() {
        isOpen = true
        searchPause = .zero
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
    var shown: [Memo] { list.shown }

    /// What the list draws, worked out once per change of the memos, the folders, the bookmark, the sort or the frozen
    /// order (and again when the day turns, as the groups move): a redraw, and every card in it, reads it.
    struct List {
        var day: Date
        var sections: [MemoCards.Section]
        var byID: [String: Memo]
        var shown: [Memo]
        /// More than 20 memos shown: the cards a little closer (12 pt apart, at least 56 tall).
        var dense: Bool
        /// 제목만 (#115): one line a memo.
        var titles = false
    }
    private var listCache: List?
    private var folderCounts: [String: Int]?
    private var foundCache: (query: String, groups: [MemoFolders.HitGroup], hits: [MemoFolders.Hit])?

    private func listChanged() {
        listCache = nil
        folderCounts = nil
        foundCache = nil
    }

    var list: List {
        let day = Calendar.current.startOfDay(for: now())
        if let known = listCache, known.day == day { return known }
        let inTab = tabMemos
        let sort = sort
        let entries = inTab.map { memo -> MemoCards.Entry in
            let still = frozen[memo.id]
            let updated = still?.updated ?? memo.updatedAt
            return MemoCards.Entry(id: memo.id, date: sort == .created ? memo.createdAt : updated, updatedAt: updated,
                                   title: still?.title ?? cardTitle(memo), pinned: folders.isPinned(memo.id))
        }
        let sections = MemoCards.sections(entries, sort: sort, pinnedGroup: tab != .pinned, now: now())
        let byID = Dictionary(memos.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        let made = List(day: day, sections: sections, byID: byID, shown: sections.flatMap(\.ids).compactMap { byID[$0] }, dense: inTab.count > 20,
                        titles: view == .titles)
        listCache = made
        return made
    }

    /// A bookmark's count (its hover words): every folder's worked out once per change, not once per bookmark per redraw.
    func folderCount(_ id: String) -> Int {
        if let counts = folderCounts { return counts[id] ?? 0 }
        var counts: [String: Int] = [:]
        for memo in memos { counts[folders.folderID(of: memo.id), default: 0] += 1 }
        folderCounts = counts
        return counts[id] ?? 0
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

    /// 보기 of what's shown (#115): the folder's, or 고정's (this Mac's).
    var view: MemoFolders.View { view(of: tab) }

    func view(of tab: MemoFolders.Tab) -> MemoFolders.View {
        switch tab {
        case .pinned: pinnedView
        case .folder(let id): folders.view(of: id)
        }
    }

    func setView(_ view: MemoFolders.View, for tab: MemoFolders.Tab) {
        switch tab {
        case .pinned: pinnedView = view
        case .folder(let id): model.setMemoFolderView(id, view)
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
    var sections: [MemoCards.Section] { list.sections }

    /// What a card says (its title, up to three preview rows, kind), worked out once per text: the list redraws on every
    /// open and keystroke, and the kinds are found with regular expressions.
    struct Card {
        var title: String
        var rows: [MemoCards.PreviewRow]
        var kind: MemoCards.Kind?
    }
    private var cards: [String: (text: String, card: Card)] = [:]

    func card(_ memo: Memo) -> Card {
        if let known = cards[memo.id], known.text == memo.text { return known.card }
        let made = Card(title: MemoCards.title(memo.text, language: .current), rows: MemoCards.previewRows(memo.text), kind: MemoCards.kind(memo.text))
        cards[memo.id] = (memo.text, made)
        return made
    }

    /// Only the card's title (the list's order and 제목 순 need no more).
    func cardTitle(_ memo: Memo) -> String {
        if let known = cards[memo.id], known.text == memo.text { return known.card.title }
        if let known = titles[memo.id], known.text == memo.text { return known.title }
        let title = MemoCards.title(memo.text, language: .current)
        titles[memo.id] = (memo.text, title)
        return title
    }
    private var titles: [String: (text: String, title: String)] = [:]

    /// The caches keep one entry per memo that still exists (a folder of 5,000 is never worked out again on each
    /// redraw); those of memos gone are dropped once there are a few.
    private func forgetGoneCards() {
        guard cards.count > memos.count + 64 || titles.count > memos.count + 64 else { return }
        let ids = Set(memos.map(\.id))
        cards = cards.filter { ids.contains($0.key) }
        titles = titles.filter { ids.contains($0.key) }
        links = links.filter { ids.contains($0.key) }
    }

    /// The time a card is grouped and timed by: 만든 순 its creation, else its last edit (frozen while a memo is open).
    func sortDate(_ memo: Memo) -> Date {
        sort == .created ? memo.createdAt : (frozen[memo.id]?.updated ?? memo.updatedAt)
    }

    /// More than 20 memos shown: the cards a little closer (12 pt apart, at least 56 tall).
    var dense: Bool { list.dense }

    func arranged(_ list: [Memo]) -> [Memo] {
        list.enumerated().sorted { a, b in
            let x = order[a.element.id] ?? -1, y = order[b.element.id] ?? -1
            return x != y ? x < y : a.offset < b.offset
        }.map(\.element)
    }

    /// The results for `searchedQuery` and the chips (#114), by folder, worked out once per query and change (the list,
    /// the keys and the footer all read them).
    var found: [MemoFolders.HitGroup] { foundNow().groups }

    /// The results one after another, as the list shows them (↑ ↓ go through them in this order).
    var hits: [MemoFolders.Hit] { foundNow().hits }

    private func foundNow() -> (query: String, groups: [MemoFolders.HitGroup], hits: [MemoFolders.Hit]) {
        if let known = foundCache, known.query == searchedQuery { return known }
        let groups = folders.find(searchedQuery, memos: arranged(memos), scope: searchHere ? tab : nil, filters: searchFilters,
                                  language: .current, index: searchIndex, isOpen: { [unowned self] memo in
                                      if case .checklist(let done, let total)? = card(memo).kind { return done < total }
                                      return false
                                  }, hasLink: { [unowned self] memo in hasLink(memo) })
        let made = (searchedQuery, groups, groups.flatMap(\.hits))
        foundCache = made
        return made
    }

    /// 링크 (#114): a web address in the memo, read once per text.
    private func hasLink(_ memo: Memo) -> Bool {
        if let known = links[memo.id], known.text == memo.text { return known.link }
        let link = MemoCards.hasLink(memo.text)
        links[memo.id] = (memo.text, link)
        return link
    }
    private var links: [String: (text: String, link: Bool)] = [:]

    private func searchSoon() {
        searchTask?.cancel()
        searchTask = nil
        guard searchPause > .zero, !query.trimmingCharacters(in: .whitespaces).isEmpty else {
            if searchedQuery != query { searchedQuery = query }
            return
        }
        let pause = searchPause
        searchTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: pause)
            guard !Task.isCancelled else { return }
            self?.searchNow()
        }
    }

    /// The results for what's typed now (↩ and ↑ ↓ don't wait for the pause).
    func searchNow() {
        searchTask?.cancel()
        searchTask = nil
        if searchedQuery != query { searchedQuery = query }
    }

    func freezeOrder() {
        order = Dictionary(memos.enumerated().map { ($0.element.id, $0.offset) }, uniquingKeysWith: { first, _ in first })
        frozen = Dictionary(memos.map { ($0.id, ($0.updatedAt, cardTitle($0))) }, uniquingKeysWith: { first, _ in first })
        listChanged()
    }

    /// A memo as it is now: the open one with the keys still waiting to go to the model (copy, the menus … take the
    /// last key).
    func memo(_ id: String?) -> Memo? {
        guard let id, var memo = list.byID[id] else { return nil }
        if let typed, typed.id == id { memo.text = typed.text }
        return memo
    }

    // MARK: Typing in the open memo

    /// The open memo's keys not yet handed to the model: its text now, and the text the model had (for joining with
    /// another device's edit, as each key did before). Composing Korean never gets here: the text view hands over a
    /// syllable once it's committed.
    private var typed: (id: String, text: String, from: String)?
    private var typedTask: Task<Void, Never>?
    /// How long the keys pause before the model, the list, the other windows and the save hear them (the memo shows
    /// every key itself). The save follows 0.4 s after that, as before.
    static let typedPause: Duration = .milliseconds(250)

    /// A key in the open memo: kept here until the keys pause.
    func edit(_ id: String, text: String, from old: String) {
        if let waiting = typed, waiting.id != id { sendTyped() }
        typed = (id, text, typed?.from ?? old)
        typedTask?.cancel()
        typedTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: Self.typedPause)
            guard !Task.isCancelled else { return }
            self?.sendTyped()
        }
    }

    /// The keys go to the model now (the pause is over, the memo or the drawer closes, the text lets go of the
    /// keyboard, another change to the memo came in, quitting): one change of the memos, heard once by the list.
    func sendTyped() {
        typedTask?.cancel()
        typedTask = nil
        guard let waiting = typed else { return }
        typed = nil
        PerfProbe.begin("list")
        model.updateMemo(waiting.id, text: waiting.text, from: waiting.from)
    }

    /// Keys of this memo still wait (another change that comes in sends them first, to be joined).
    func isWaiting(_ id: String) -> Bool { typed?.id == id }

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
        // The memos' lines read for searching off the main thread while the field opens, so the first key's search
        // finds them ready.
        let memos = memos
        Task.detached(priority: .userInitiated) { [weak self] in
            let read = MemoFolders.SearchIndex.read(memos)
            await self?.takeSearchLines(read)
        }
    }

    private func takeSearchLines(_ read: MemoFolders.SearchIndex.Read) { searchIndex.take(read) }

    func endSearch() {
        searching = false
        query = ""
        searchNow()
        selectedID = nil
        if searchHere { searchHere = false }
        if !searchFilters.isEmpty { searchFilters = [] }
    }

    /// The folder shown (or 고정) by name: the search's `{이름}만` chip (#114).
    var hereName: String {
        switch tab {
        case .pinned: L("고정")
        case .folder: currentFolder?.displayName(.current) ?? ""
        }
    }

    /// A filter chip (#114) pressed: on or off; the results follow at once.
    func toggleFilter(_ filter: MemoFolders.SearchFilters) {
        searchNow()
        if searchFilters.contains(filter) { searchFilters.remove(filter) } else { searchFilters.insert(filter) }
        selectedID = nil
    }

    /// 모든 폴더 · {지금 폴더}만 (#114).
    func setSearchHere(_ here: Bool) {
        searchNow()
        guard searchHere != here else { return }
        searchHere = here
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
        if searching { searchNow() }
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
        if searching { searchNow() }
        guard let id = selectedID else { return }
        if searching { reveal(id); return }
        expand(id)
    }

    /// One open slip at a time.
    func expand(_ id: String) {
        guard expandedID != id else { return }
        linkEdit = nil
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
        linkEdit = nil
        commitOpenSlip()
        expandedID = nil
        editing = false
        freezeOrder()
    }

    /// Esc: the big view, the open slip, the folder sheet, the search — one at a time; false when nothing was open
    /// (the drawer closes).
    func escape() -> Bool {
        if linkEdit != nil { cancelLink(); return true }
        if trashConfirm { trashConfirm = false; return true }
        if trashOpen { trashOpen = false; return true }
        if folderSheet != nil { folderSheet = nil; return true }
        if bigID != nil { bigID = nil; return true }
        if expandedID != nil { collapse(); return true }
        if searching { endSearch(); return true }
        return false
    }

    /// Leaving the open memo: a blank one quietly goes away, the rest is written out (AppModel.closeMemo).
    private func commitOpenSlip() {
        sendTyped()
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
        sendTyped()
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
        sendTyped()
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
        sendTyped()
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

    /// #163: a box ticked in an open memo as it reads — the words change at once, in place (the box draws its tick);
    /// with 끝낸 항목 아래로 the line goes down once that is drawn (0.36 s; unticked 0.14 s). `motion` off (Reduce motion):
    /// one change at once, as before.
    func tickInCard(_ id: String, line: Int, motion: Bool) {
        guard motion, doneToBottom, let before = memo(id)?.text else { return model.toggleChecklist(id, line: line) }
        let inPlace = MemoEdits.toggleDone(before, line: line, moveDone: false)
        guard inPlace != before else { return }
        let on = Checklist.lines(Checklist.split(before)[line]).first?.checked == false
        model.updateMemo(id, text: inPlace, from: before)
        model.saveMemosNow()
        // After the tick is drawn (등장 + 바뀜, or 살짝 back), as in the editor.
        let drawn = on ? Motion.enter.duration + Motion.change.duration : Motion.quick.duration
        DispatchQueue.main.asyncAfter(deadline: .now() + drawn + 0.02) { [weak self] in
            guard let self, self.memo(id)?.text == inPlace else { return }
            self.model.updateMemo(id, text: MemoEdits.toggleDone(before, line: line, moveDone: true), from: inPlace)
            self.model.saveMemosNow()
        }
    }

    /// The folder list (the name's ▾, ⌘L): set by the header's hotspot.
    var openFolderList: () -> Void = {}
    /// A menu under the folder's name in the header (set by the same hotspot).
    var popUnderName: ([DrawerMenuItem]) -> Void = { _ in }

    /// ⇧⌘M (#118): the picked memo's 폴더로 옮기기, under the folder's name.
    func openMoveList(_ id: String) {
        guard memo(id) != nil else { return }
        popUnderName(DrawerMenus.moveList(self, id))
    }

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
        // #119: VoiceOver says the toast too (it isn't focused, and goes in a few seconds).
        NSAccessibility.post(element: NSApp as Any, notification: .announcementRequested,
                             userInfo: [.announcement: action.map { text + ", " + $0 } ?? text, .priority: NSAccessibilityPriorityLevel.high.rawValue])
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
