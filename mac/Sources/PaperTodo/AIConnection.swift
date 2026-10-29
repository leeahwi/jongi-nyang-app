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
    static let codeKey = "ai.codeServer"

    /// Claude may see and write the list (default off).
    @Published private(set) var enabled: Bool
    /// Today's and yesterday's work, newest first.
    @Published private(set) var recent: [AIConnect.Entry] = []
    @Published private(set) var undone: Set<String> = []
    /// Claude Code: connecting now, and whether it knows this app's program (the path it was given is this one).
    @Published private(set) var codeBusy = false
    @Published private(set) var codeLinked = false

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
    /// How Claude Code is told about the program (tests swap it, so nothing is written into the real Claude Code).
    var codeLinker = AICodeLinker.system
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
        codeLinked = model.preferences.string(forKey: Self.codeKey) == serverPath
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

    /// ai-link.json, at launch and whenever the toggle changes (the folder and the language change only with a
    /// restart, which writes it again).
    func writeLink() {
        guard live else { return }
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?"
        let link = AIConnect.Link(enabled: enabled, dataFolder: dataFolder.path, lang: language, app: "mac \(version)")
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
        let text = (try? String(contentsOf: logURL, encoding: .utf8)) ?? ""
        show(AIConnect.parse(text), now: now)
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

    /// At launch: the link, a trim when the log grew past 1 MB, and one notice for what Claude did meanwhile.
    func launch() {
        guard live else { return }
        writeLink()
        guard enabled else { return }
        trimLogIfNeeded()
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
        var written: [AIConnect.Change] = []
        var outcome = AIConnect.UndoOutcome(undone: 0, left: 0)
        for change in entry.changes {
            let current = currentJSON(change.id, entry.target)
            switch AIConnect.undoStep(change, target: entry.target, current: current) {
            case .alreadyBack:
                outcome.undone += 1
            case .changedSince:
                outcome.left += 1
            case .remove:
                switch entry.target {
                case .todos: if let uuid = UUID(uuidString: change.id) { notebook.delete(id: uuid) }
                case .events: eventChanges.append(.delete(change.id))
                case .memos: memoRemovals.append(change.id)
                case .unknown: break
                }
                written.append(.init(file: change.file, id: change.id, before: current, after: nil))
                outcome.undone += 1
            case .restore(let before):
                switch entry.target {
                case .todos:
                    guard let item = AIConnect.decode(TodoItem.self, from: before) else { outcome.left += 1; continue }
                    let order = notebook.items.map(\.id) + [item.id]
                    notebook.merge(changed: [item], added: [item], removed: [], order: order)
                case .events:
                    guard let event = AIConnect.decode(LocalEvent.self, from: before) else { outcome.left += 1; continue }
                    eventChanges.append(.put(event))
                case .memos, .unknown:
                    // Claude can't change memos; nothing else to put back.
                    outcome.left += 1
                    continue
                }
                written.append(.init(file: change.file, id: change.id, before: current, after: before))
                outcome.undone += 1
            }
        }
        if notebook != model.history.notebook { model.adoptExternal(notebook) }
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

    /// Past 1 MB the log keeps its last 30 days. Skipped when the extension wrote meanwhile.
    private func trimLogIfNeeded() {
        guard let size = (try? logURL.resourceValues(forKeys: [.fileSizeKey]))?.fileSize, size > AIConnect.logLimit,
              let text = try? String(contentsOf: logURL, encoding: .utf8),
              let trimmed = AIConnect.trimmed(text, now: Date()) else { return }
        guard (try? logURL.resourceValues(forKeys: [.fileSizeKey]))?.fileSize == size else { return }
        try? Data(trimmed.utf8).write(to: logURL, options: .atomic)
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
        // The Code tab next to it (and the terminal's Claude Code) reads its own list, not the extensions.
        connectCode(quiet: true)
    }

    /// Nothing opens .mcpb files: Claude Desktop isn't installed (닫기 · 내려받는 곳 열기).
    static var missingDesktop: SlipAlertView {
        SlipAlertView(symbol: "bubble.left", title: L("Claude 데스크톱이 필요해요"),
                      message: L("이 Mac에 Claude 데스크톱이 없어서 연결 파일을 열 수 없어요."),
                      detail: L("claude.ai/download에서 Claude 데스크톱을 설치한 뒤 다시 눌러 주세요. 설치하면 종이냥 for Claude를 넣을지 물어봐요."),
                      choices: [.init(title: L("닫기"), isCancel: true), .init(title: L("내려받는 곳 열기"), role: .primary, isDefault: true)],
                      cat: .curious, width: .medium)
    }

    /// This app's copy of the program (Node runs it).
    var serverPath: String {
        (resources ?? Bundle.main.bundleURL.appendingPathComponent("Contents/Resources/mcp")).appendingPathComponent("server/index.js").path
    }

    /// The line to paste into Terminal, with Node where it usually is (the row shows it, a failed connection
    /// copies it).
    var codeCommand: String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let node = AIConnect.toolPlaces("node", home: home).first { FileManager.default.isExecutableFile(atPath: $0) }
        return AIConnect.codeCommand(node: node ?? "node", server: serverPath)
    }

    /// Claude Code learns the app's program (`claude mcp add-json -s user`), so every new Claude Code session —
    /// the terminal's and Claude Desktop's Code tab — sees 종이냥 without pasting anything. `quiet` (from 연결 to
    /// Claude Desktop): no slip when Claude Code or Node isn't there; the Code row still says how it went.
    func connectCode(quiet: Bool = false) {
        guard !codeBusy else { return }
        if !enabled { setEnabled(true) }
        let server = serverPath
        guard FileManager.default.fileExists(atPath: server) else {
            if !quiet { SlipAlert.inform(title: L("AI 연결"), message: L("앱 안에서 확장 파일을 찾지 못했어요."), detail: L("종이냥을 다시 설치해 주세요.")) }
            return
        }
        guard !AIConnect.movablePlace(Bundle.main.bundlePath) else {
            if !quiet {
                SlipAlert.inform(title: L("Claude Code에 연결"), message: L("종이냥을 응용 프로그램 폴더로 옮긴 뒤 다시 눌러 주세요."),
                                 detail: L("지금 있는 곳에서는 Claude Code가 다음에 종이냥을 찾지 못해요."))
            }
            return
        }
        codeBusy = true
        let linker = codeLinker
        DispatchQueue.global(qos: .userInitiated).async {
            let result = linker.link(server: server)
            DispatchQueue.main.async { [weak self] in
                MainActor.assumeIsolated { self?.finishCode(result.outcome, command: result.command, server: server, quiet: quiet) }
            }
        }
    }

    private func finishCode(_ outcome: AICodeLinker.Outcome, command: String, server: String, quiet: Bool) {
        codeBusy = false
        note("code \(outcome)")
        if outcome == .linked {
            preferences.set(server, forKey: Self.codeKey)
            codeLinked = true
            return
        }
        guard !quiet else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(command, forType: .string)
        switch outcome {
        case .linked:
            break
        case .noClaude:
            SlipAlert.inform(symbol: "terminal", title: L("Claude Code를 찾지 못했어요"), message: L("이 Mac에서 claude 명령을 찾지 못했어요."),
                             detail: L("연결 명령을 복사해 두었어요. Claude Code를 설치한 뒤 터미널에 붙여 넣어요."))
        case .noNode:
            SlipAlert.inform(symbol: "terminal", title: L("Node가 필요해요"), message: L("종이냥 for Claude는 Node로 실행돼요. 이 Mac에서 Node를 찾지 못했어요."),
                             detail: L("nodejs.org에서 Node를 설치한 뒤 다시 눌러 주세요. 연결 명령도 복사해 두었어요."))
        case .failed(let output):
            SlipAlert.inform(title: L("Claude Code에 연결하지 못했어요"), message: L("연결 명령을 복사해 두었어요. 터미널에 붙여 넣어 주세요."),
                             detail: String(output.trimmingCharacters(in: .whitespacesAndNewlines).suffix(300)))
        }
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

/// Tells Claude Code about the app's program: finds `claude` and `node`, takes out an earlier entry, adds this
/// one. Runs off the main thread.
struct AICodeLinker: Sendable {
    enum Outcome: Equatable, Sendable { case linked, noClaude, noNode, failed(String) }

    var find: @Sendable (_ tool: String) -> String?
    var run: @Sendable (_ executable: String, _ arguments: [String]) -> (ok: Bool, output: String)

    /// What happened, and the line to paste when it didn't.
    func link(server: String) -> (outcome: Outcome, command: String) {
        let node = find("node")
        let command = AIConnect.codeCommand(node: node ?? "node", server: server)
        guard let claude = find("claude") else { return (.noClaude, command) }
        guard let node else { return (.noNode, command) }
        _ = run(claude, AIConnect.codeRemoveArguments)
        let added = run(claude, AIConnect.codeAddArguments(node: node, server: server))
        return (added.ok ? .linked : .failed(added.output), command)
    }

    static let system = AICodeLinker(find: { locate($0) }, run: { execute($0, $1) })

    /// The usual places first, then what a login shell finds (nvm, asdf, a PATH of one's own).
    static func locate(_ tool: String) -> String? {
        let files = FileManager.default
        if let path = AIConnect.toolPlaces(tool, home: files.homeDirectoryForCurrentUser.path).first(where: files.isExecutableFile) {
            return path
        }
        let shell = execute("/bin/zsh", ["-lc", "command -v \(tool)"])
        let path = shell.output.split(separator: "\n").last.map { String($0).trimmingCharacters(in: .whitespaces) } ?? ""
        return shell.ok && path.hasPrefix("/") && files.isExecutableFile(atPath: path) ? path : nil
    }

    /// Runs a program and waits (at most 20 seconds), with what it printed.
    static func execute(_ executable: String, _ arguments: [String]) -> (ok: Bool, output: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: executable)
        process.arguments = arguments
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe
        process.standardInput = FileHandle.nullDevice
        do { try process.run() } catch { return (false, error.localizedDescription) }
        let stop = DispatchWorkItem { if process.isRunning { process.terminate() } }
        DispatchQueue.global().asyncAfter(deadline: .now() + 20, execute: stop)
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        process.waitUntilExit()
        stop.cancel()
        return (process.terminationStatus == 0, String(decoding: data, as: UTF8.self))
    }

    /// `--ai-code-log <file>` (tests): records what would run instead of running it, as if `claude` and `node`
    /// were there; `--ai-no-code` acts as if `claude` weren't.
    static func recording(to log: URL, noClaude: Bool) -> AICodeLinker {
        AICodeLinker(find: { tool in
            tool == "claude" && noClaude ? nil : "/stub/\(tool)"
        }, run: { executable, arguments in
            let text = ((try? String(contentsOf: log, encoding: .utf8)) ?? "") + ([executable] + arguments).joined(separator: " ") + "\n"
            try? text.write(to: log, atomically: true, encoding: .utf8)
            return (true, "")
        })
    }
}
