import AppKit
import PaperCore
import SwiftUI

/// 종이냥 for Claude (1.42): Settings › AI 연결. Writes `ai-link.json` for the extension (a small program Claude
/// starts when a conversation needs it; there is no server here), reads `ai-log.jsonl` for what Claude did —
/// toasts while running, one "while you were away" notice at launch, the day's marks, the recent-work list —
/// and undoes an entry when nothing was changed since (AIConnect decides; this applies it).
///
/// Both files live in the app's settings folder (`~/Library/Application Support/<bundle id>/`), so a test copy
/// with its own bundle id never touches the real app's. Previews and snapshots (`live: false`) read and write
/// nothing.
@MainActor
final class AIConnection: ObservableObject {
    static let enabledKey = "ai.enabled"
    static let seenKey = "ai.seen"
    static let clearedKey = "ai.cleared"
    static let catKey = "ai.catSaid"

    /// Claude may see and write the list (default off).
    @Published private(set) var enabled: Bool
    /// Today's and yesterday's work, newest first.
    @Published private(set) var recent: [AIConnect.Entry] = []
    @Published private(set) var undone: Set<String> = []
    /// Claude Desktop's installed extension is older than the one this app carries (AIConnect.extOutdated).
    @Published private(set) var desktopOutdated = false
    /// #174: there is something in ai-log.jsonl (기록 지우기 has something to clear).
    @Published private(set) var hasLog = false

    let settingsFolder: URL
    let dataFolder: URL
    let live: Bool
    private unowned let model: AppModel
    private var entries: [AIConnect.Entry] = []
    /// The latest entry ⌘Z may undo, with the list and events as they were right after it came in.
    private var latest: (id: String, notebook: Notebook, events: [LocalEvent])?

    var linkURL: URL { settingsFolder.appendingPathComponent(AIConnect.linkFile) }
    var logURL: URL { settingsFolder.appendingPathComponent(AIConnect.logFile) }

    /// Set by the app: the watcher follows the toggle; 보기 opens this pane; the cat says a line when it may.
    var onEnabledChange: ((Bool) -> Void)?
    var onShowList: (() -> Void)?
    var speak: ((String) -> Bool)?
    /// How the bundled extension is opened (tests swap it, so nothing is installed into the real Claude).
    var opener = AIOpener.workspace
    /// `--ai-check-log <file>` (scripts/ai-check.sh): each toast and undo, with the time, for the end-to-end check.
    var checkLog: URL?

    /// The check log: what this app just saved (scripts/ai-check.sh compares it with the file afterwards).
    func noteSave(_ notebook: Notebook) {
        guard checkLog != nil else { return }
        note("save \(notebook.items.count) " + notebook.items.map(\.title).joined(separator: "|"))
    }

    private func note(_ line: String) {
        guard let checkLog else { return }
        let text = ((try? String(contentsOf: checkLog, encoding: .utf8)) ?? "") + "\(Int(Date().timeIntervalSince1970 * 1000)) \(line)\n"
        try? text.write(to: checkLog, atomically: true, encoding: .utf8)
    }

    /// Where the bundled extension and its program are (Contents/Resources/mcp).
    var resources: URL? = Bundle.main.resourceURL?.appendingPathComponent("mcp", isDirectory: true)

    init(model: AppModel, settingsFolder: URL, dataFolder: URL, live: Bool) {
        self.model = model
        self.settingsFolder = settingsFolder
        self.dataFolder = dataFolder
        self.live = live
        enabled = model.preferences.bool(forKey: Self.enabledKey)
    }

    private var preferences: UserDefaults { model.preferences }
    private var language: AppLanguage { .current }

    // MARK: On and off

    func setEnabled(_ on: Bool) {
        guard on != enabled else { return }
        enabled = on
        preferences.set(on, forKey: Self.enabledKey)
        if on {
            // Turned on now: what is already in the log isn't news.
            reload()
            seen = AIConnect.advance(seen, over: entries)
        }
        writeLink()
        onEnabledChange?(on)
    }

    /// ai-link.json, at launch, whenever the toggle changes and whenever 이 기기에서 changes (N3-9; the folder and the
    /// language change only with a restart, which writes it again).
    func writeLink() {
        guard live else { return }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let link = AIConnect.Link(enabled: enabled, dataFolder: dataFolder.path, lang: language, app: "mac \(version)",
                                  spaceDevice: SpaceDevice.linkRules(model.deviceRules))
        do {
            try FileManager.default.createDirectory(at: settingsFolder, withIntermediateDirectories: true)
            try link.encoded().write(to: linkURL, options: .atomic)
        } catch {
            // Written again whenever the switch changes.
            model.storageError = L("AI 연결 설정을 저장하지 못했어요. 스위치를 껐다 켜면 다시 저장해 볼게요.")
        }
    }

    // MARK: Reading the log

    private var seen: AIConnect.Seen? {
        get { preferences.data(forKey: Self.seenKey).flatMap { try? JSONDecoder().decode(AIConnect.Seen.self, from: $0) } }
        set { preferences.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: Self.seenKey) }
    }

    /// Reads the log again and works out the list, the undone entries and the day's marks.
    func reload(now: Date = Date()) {
        guard live else { return }
        let text = trimOldLines(now: now)
        if hasLog != !text.isEmpty { hasLog = !text.isEmpty }
        show(AIConnect.parse(text), now: now)
        // From the real log only (previews and snapshots show entries as if from the current extension).
        let outdated = AIConnect.extOutdated(entries)
        if outdated != desktopOutdated { desktopOutdated = outdated }
    }

    /// Previews and snapshots: these entries instead of the log.
    func show(_ entries: [AIConnect.Entry], now: Date = Date()) {
        self.entries = entries
        undone = AIConnect.undone(entries)
        let recent = AIConnect.recent(entries, now: now)
        if recent != self.recent { self.recent = recent }
        refreshMarks(now: now)
    }

    func refreshMarks(now: Date = Date()) {
        let day = Archive.dayKey(now)
        let marks = AIMarks(day: day, ids: AIConnect.marks(entries, now: now, cleared: cleared(day)))
        if marks != model.aiMarks { model.aiMarks = marks }
    }

    /// Items edited here today lose their mark (kept for the day in the settings).
    func clearMarks(_ ids: Set<String>, now: Date = Date()) {
        let day = Archive.dayKey(now)
        var kept = cleared(day)
        guard !ids.isSubset(of: kept) else { return }
        kept.formUnion(ids)
        preferences.set(["day": day, "ids": Array(kept).sorted()] as [String: Any], forKey: Self.clearedKey)
        refreshMarks(now: now)
    }

    private func cleared(_ day: String) -> Set<String> {
        guard let saved = preferences.dictionary(forKey: Self.clearedKey), saved["day"] as? String == day else { return [] }
        return Set(saved["ids"] as? [String] ?? [])
    }

    /// At launch: the link, the log's lines older than 30 days dropped (on or off), and one notice for what Claude
    /// did meanwhile.
    func launch() {
        guard live else { return }
        writeLink()
        let text = trimOldLines(now: Date())
        hasLog = !text.isEmpty
        guard enabled else { return }
        reload()
        let unseen = AIConnect.unseen(entries, after: seen)
        seen = AIConnect.advance(seen, over: unseen)
        let count = AIConnect.awayCount(unseen, undone: undone)
        guard count > 0 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            guard let self else { return }
            var toast = PaperToast(symbol: "bubble.left", text: AIText.away(count, self.language))
            toast.action = AIText.showAction(self.language)
            toast.seconds = 8
            toast.perform = { [weak self] in
                self?.model.toast = nil
                self?.onShowList?()
            }
            self.model.toast = toast
            self.note("away \(count) \(toast.text)")
        }
    }

    /// The log changed (the watcher checks every two seconds while AI 연결 is on): a toast for Claude's newest work.
    func logChanged(now: Date = Date()) {
        guard live, enabled else { return }
        // The data first, so the toast and ⌘Z see the list Claude wrote.
        model.reloadFromDisk()
        reload(now: now)
        let unseen = AIConnect.unseen(entries, after: seen)
        seen = AIConnect.advance(seen, over: unseen)
        guard let last = unseen.last(where: { $0.isAIWork && !undone.contains($0.id) }) else { return }
        announce(last, now: now)
    }

    private func announce(_ entry: AIConnect.Entry, now: Date) {
        latest = (entry.id, model.history.notebook, model.calendar.events)
        var toast = PaperToast(symbol: "bubble.left", text: AIText.toast(entry, language))
        toast.action = AIText.undoAction(language)
        toast.seconds = 6
        let id = entry.id
        toast.perform = { [weak self] in self?.undo(id) }
        toast.takeBack = { [weak self] in self?.undo(id) }
        model.toast = toast
        note("toast \(entry.id) items=\(model.items.count) marks=\(model.aiMarks.ids.count) \(toast.text)")
        // Now and then the cat says something about it.
        let said = preferences.object(forKey: Self.catKey) as? Date
        if let line = AIText.catLine(entry, lastSaid: said, now: now, random: { Double.random(in: 0..<1) }, language), speak?(line) == true {
            preferences.set(now, forKey: Self.catKey)
        }
    }

    // MARK: Undo

    /// ⌘Z goes to Claude's latest work while nothing was changed here since it came in.
    var canUndoLatest: Bool {
        guard enabled, let latest, !undone.contains(latest.id) else { return false }
        return model.history.notebook == latest.notebook && model.calendar.events == latest.events
    }

    func undoLatestIfClean() -> Bool {
        guard canUndoLatest, let latest else { return false }
        undo(latest.id)
        return true
    }

    /// Puts back what an entry changed, item by item, where the item is still as Claude left it (M13); what was
    /// changed since stays (M14). Logged as an undo entry; the toast says how it went.
    @discardableResult
    func undo(_ id: String) -> AIConnect.UndoOutcome? {
        reload()
        guard let entry = entries.first(where: { $0.id == id }), entry.isAIWork, !undone.contains(id) else { return nil }
        // Catch up first: the item may have changed on disk since the last check.
        model.reloadFromDisk()
        var notebook = model.history.notebook
        var eventChanges: [EventBook.Change] = []
        var memoRemovals: [String] = []
        // Spaces 2c (N3-7): places put back, by to-do id (nil: 일반).
        var placeMoves: [(id: String, space: String?)] = []
        var written: [AIConnect.Change] = []
        // Item by item, whole or not at all; a place is compared by the space it shows now.
        let plan = AIConnect.undoPlan(entry, current: { [model] change in
            change.file == AIConnect.placesFile ? Self.placeJSON(change.id, spaces: model.todoSpaces) : self.currentJSON(change.id, entry.target)
        }, gone: { [model] change in !model.items.contains { $0.id.uuidString == change.id.uppercased() } })
        var outcome = plan.outcome
        for planned in plan.steps {
            let change = planned.change
            let current = change.file == AIConnect.placesFile ? Self.placeJSON(change.id, spaces: model.todoSpaces) : currentJSON(change.id, entry.target)
            if change.file == AIConnect.placesFile {
                guard case .restore(let before) = planned.step else { continue }
                let space = before["space"]?.string
                placeMoves.append((change.id.uppercased(), space))
                written.append(.init(file: change.file, id: change.id, before: current, after: before))
                continue
            }
            switch planned.step {
            case .alreadyBack, .changedSince:
                continue
            case .remove:
                switch entry.target {
                case .todos: if let uuid = UUID(uuidString: change.id) { notebook.delete(id: uuid) }
                case .events: eventChanges.append(.delete(change.id))
                case .memos: memoRemovals.append(change.id)
                case .unknown: break
                }
                written.append(.init(file: change.file, id: change.id, before: current, after: nil))
            case .restore(let before):
                // What can't be read back (or a memo: Claude can't change memos) stays, and counts as left.
                func stays() { outcome.undone -= 1; outcome.left += 1 }
                switch entry.target {
                case .todos:
                    guard let item = AIConnect.decode(TodoItem.self, from: before) else { stays(); continue }
                    let order = notebook.items.map(\.id) + [item.id]
                    notebook.merge(changed: [item], added: [item], removed: [], order: order)
                case .events:
                    guard let event = AIConnect.decode(LocalEvent.self, from: before) else { stays(); continue }
                    eventChanges.append(.put(event))
                case .memos, .unknown:
                    stays()
                    continue
                }
                written.append(.init(file: change.file, id: change.id, before: current, after: before))
            }
        }
        if notebook != model.history.notebook { model.adoptExternal(notebook) }
        if !placeMoves.isEmpty {
            model.changeTodoSpaces { spaces, now in
                for move in placeMoves {
                    // A space deleted since: the to-do goes to 일반, as everywhere it reads.
                    spaces.move(move.id, to: move.space.flatMap { spaces.space($0) == nil ? nil : $0 }, now: now)
                }
            }
        }
        for change in eventChanges { model.calendar.perform(change) }
        for memo in memoRemovals { model.removeMemoQuietly(memo) }
        if outcome.undone > 0 {
            let line = AIConnect.Entry(id: UUID().uuidString, at: Date(), client: "app", tool: "undo", kind: .undo, target: entry.target,
                                       count: outcome.undone, title: entry.title, undoes: entry.id, changes: written)
            append(line)
            reload()
            seen = AIConnect.advance(seen, over: AIConnect.unseen(entries, after: seen))
        }
        if latest?.id == id { latest = nil }
        model.toast = PaperToast(symbol: outcome.undone > 0 ? "arrow.uturn.backward" : "exclamationmark.circle", text: AIText.undoResult(outcome, language))
        note("undo \(id) items=\(model.items.count) \(outcome.undone)/\(outcome.left) \(AIText.undoResult(outcome, language))")
        return outcome
    }

    /// A to-do's place as an undo compares it (N3-7): `{id, space}` with the space it shows now (null: 일반).
    static func placeJSON(_ id: String, spaces: TodoSpaces) -> JSONValue {
        .object(["id": .string(id), "space": spaces.spaceID(of: id.uppercased()).map(JSONValue.string) ?? .null])
    }

    private func currentJSON(_ id: String, _ target: AIConnect.Target) -> JSONValue? {
        switch target {
        case .todos: model.items.first { $0.id.uuidString == id.uppercased() }.flatMap(AIConnect.json)
        case .events: model.calendar.event(id).flatMap(AIConnect.json)
        case .memos: model.memos.first { $0.id == id }.flatMap(AIConnect.json)
        case .unknown: nil
        }
    }

    /// One line at the end of the log, in one write (the extension appends the same way).
    private func append(_ entry: AIConnect.Entry) {
        guard live else {
            entries.append(entry)
            return
        }
        try? FileManager.default.createDirectory(at: settingsFolder, withIntermediateDirectories: true)
        let data = Data((entry.line() + "\n").utf8)
        let descriptor = open(logURL.path, O_WRONLY | O_APPEND | O_CREAT, 0o644)
        guard descriptor >= 0 else { return }
        defer { close(descriptor) }
        _ = data.withUnsafeBytes { write(descriptor, $0.baseAddress, data.count) }
    }

    /// #174 (review I-01): the log keeps its last 30 days, whatever its size. Returns the log's text as it is now
    /// ("" without one). Not written when the extension wrote meanwhile (the next read trims it).
    private func trimOldLines(now: Date) -> String {
        guard let text = try? String(contentsOf: logURL, encoding: .utf8) else { return "" }
        let size = text.utf8.count
        guard let trimmed = AIConnect.trimmed(text, now: now, limit: 0) else { return text }
        guard (try? logURL.resourceValues(forKeys: [.fileSizeKey]))?.fileSize == size else { return text }
        try? Data(trimmed.utf8).write(to: logURL, options: .atomic)
        return trimmed
    }

    /// 기록 지우기 (#174, review I-01): after a yes on the slip, ai-log.jsonl is emptied — the recent list, its 되돌리기
    /// and the stamps go with it; the to-dos, events and memos stay. The extension starts a new log with its next change.
    func askToClearLog() {
        let answer = SlipAlert.run(symbol: "trash", title: L("기록 지우기"), message: L("Claude가 한 일의 기록을 지울까요?"),
                                   detail: L("최근 AI 작업과 그 되돌리기가 함께 사라져요. 할 일 · 일정 · 메모는 그대로예요."),
                                   choices: [.init(title: L("취소"), isCancel: true),
                                             .init(title: L("지우기"), role: .primary, isDefault: true)])
        if answer == 1 { clearLog() }
    }

    func clearLog() {
        guard live else { return }
        guard (try? Data().write(to: logURL, options: .atomic)) != nil else { return }
        latest = nil
        hasLog = false
        show([])
    }

    // MARK: Connecting

    /// Contents/Resources/mcp/jongi-nyang.mcpb, opened with what handles it (Claude Desktop shows its install
    /// screen). Nothing handles it: a slip about installing Claude Desktop.
    func connectDesktop() {
        guard let bundle = resources?.appendingPathComponent("jongi-nyang.mcpb"), FileManager.default.fileExists(atPath: bundle.path) else {
            SlipAlert.inform(title: L("AI 연결"), message: L("앱 안에서 확장 파일을 찾지 못했어요."), detail: L("종이냥을 다시 설치해 주세요."))
            return
        }
        if !enabled { setEnabled(true) }
        guard opener.handler(bundle) != nil else {
            let slip = Self.missingDesktop
            let answer = SlipAlert.run(symbol: slip.symbol, title: slip.title, message: slip.message, detail: slip.detail,
                                       choices: slip.choices, cat: slip.cat, width: slip.width)
            if answer == 1, let download = URL(string: "https://claude.ai/download") { opener.open(download) }
            return
        }
        opener.open(bundle)
    }

    /// Nothing opens .mcpb files: Claude Desktop isn't installed (닫기 · 내려받는 곳 열기).
    static var missingDesktop: SlipAlertView {
        SlipAlertView(symbol: "bubble.left", title: L("Claude 데스크톱이 필요해요"),
                      message: L("이 Mac에 Claude 데스크톱이 없어서 연결 파일을 열 수 없어요."),
                      detail: L("claude.ai/download에서 Claude 데스크톱을 설치한 뒤 다시 눌러 주세요. 설치하면 종이냥 for Claude를 넣을지 물어봐요."),
                      choices: [.init(title: L("닫기"), isCancel: true), .init(title: L("내려받는 곳 열기"), role: .primary, isDefault: true)],
                      cat: .curious, width: .medium)
    }

    /// The line ‘Claude Code 명령 복사’ copies: this app's own program with `--mcp-stdio` (#389, MCPStdio.swift).
    var codeCommand: String {
        AIConnect.codeCommand(app: Bundle.main.executablePath ?? Bundle.main.bundleURL.appendingPathComponent("Contents/MacOS/PaperTodo").path)
    }

    /// ‘Claude Code 명령 복사’ (#389, the same as Windows): the line goes on the clipboard and the switch turns on;
    /// pasting it into Terminal connects Claude Code. Nothing runs here and Claude Code's settings are never written
    /// by the app. False when the app is where Claude Code couldn't find it later (the disk image, App Translocation).
    func copyCodeCommand() -> Bool {
        guard !AIConnect.movablePlace(Bundle.main.bundlePath) else {
            // After the click that got here (a modal loop inside a SwiftUI action can't size its slip).
            DispatchQueue.main.async {
                SlipAlert.inform(symbol: "terminal", title: L("Claude Code 명령 복사"), message: L("종이냥을 응용 프로그램 폴더로 옮긴 뒤 다시 눌러 주세요."),
                                 detail: L("지금 있는 곳에서는 Claude Code가 다음에 종이냥을 찾지 못해요."))
            }
            return false
        }
        if !enabled { setEnabled(true) }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(codeCommand, forType: .string)
        return true
    }

    // MARK: The list

    /// The list under 오늘 and 어제.
    func recentByDay(now: Date = Date()) -> [(title: String, entries: [AIConnect.Entry])] {
        let today = Archive.dayKey(now)
        let todays = recent.filter { Archive.dayKey($0.at) == today }
        let earlier = recent.filter { Archive.dayKey($0.at) != today }
        return [(language.dayWord(0) ?? "", todays), (language.dayWord(-1) ?? "", earlier)].filter { !$0.entries.isEmpty }
    }

    /// "14:05" (the app's clock style).
    func clockText(_ entry: AIConnect.Entry) -> String {
        let p = Calendar.current.dateComponents([.hour, .minute], from: entry.at)
        return language.clock(hour: p.hour ?? 0, minute: p.minute ?? 0)
    }
}

/// The day's marks: ids (to-dos upper-cased) Claude added or changed today.
struct AIMarks: Equatable {
    var day = ""
    var ids: Set<String> = []
}

/// Opens the bundled extension. `handler` is the app that would open it (nil: none).
struct AIOpener {
    var handler: (URL) -> URL?
    var open: (URL) -> Void

    @MainActor static let workspace = AIOpener(handler: { NSWorkspace.shared.urlForApplication(toOpen: $0) },
                                               open: { NSWorkspace.shared.open($0) })

    /// `--ai-open-log <file>` (tests): records what would be opened instead of opening it; `--ai-no-handler`
    /// acts as if nothing could open it.
    static func recording(to log: URL, noHandler: Bool) -> AIOpener {
        AIOpener(handler: { url in
            let handler = noHandler ? nil : NSWorkspace.shared.urlForApplication(toOpen: url)
            Self.note("handler \(handler?.path ?? "none") for \(url.lastPathComponent)", log)
            return noHandler ? nil : (handler ?? URL(fileURLWithPath: "/stub"))
        }, open: { url in Self.note("open \(url.isFileURL ? url.path : url.absoluteString)", log) })
    }

    private static func note(_ line: String, _ log: URL) {
        let text = ((try? String(contentsOf: log, encoding: .utf8)) ?? "") + line + "\n"
        try? text.write(to: log, atomically: true, encoding: .utf8)
    }
}
