import AppKit
import PaperCore

/// Keeping the list in a shared folder (iCloud Drive, Dropbox, OneDrive …) so another Mac or
/// the Windows app uses the same list. The files keep their names and format, so pointing both
/// apps at one folder is all it takes.
@MainActor
enum StorageFolder {
    static let preferenceKey = "storage.folder"
    static let files = ["todos.json", "memos.json", "repeats.json", "events.json", "alarms.json", MemoFolders.fileName, TodoSpaces.fileName, MemoTrash.fileName]

    /// The folder chosen in Settings, if it still exists.
    static func chosen(_ preferences: UserDefaults) -> URL? {
        guard let path = preferences.string(forKey: preferenceKey) else { return nil }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory), isDirectory.boolValue else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }

    /// Moves the app to `target` (nil = back to this Mac's folder) and restarts it there. If the
    /// target already holds a list, asks which one to keep.
    static func switchTo(_ target: URL?, defaultFolder: URL, current: URL, model: AppModel, preferences: UserDefaults) {
        let destination = target ?? defaultFolder
        guard destination.standardizedFileURL != current.standardizedFileURL else { return }
        var copyCurrent = true
        if FileManager.default.fileExists(atPath: destination.appendingPathComponent("todos.json").path) {
            let message = target == nil ? L("이 Mac에 전에 쓰던 목록이 있어요.") : L("이 폴더에 이미 종이냥 목록이 있어요.")
            let detail = target == nil
                ? L("공유 폴더로 옮기기 전의 목록으로 돌아가려면 ‘전에 쓰던 목록 쓰기’를 고르세요. 덮어써도 바꾸기 전 상태를 백업해 둬요.")
                : L("다른 기기에서 쓰던 목록이면 ‘폴더 목록 쓰기’를 고르세요. 덮어써도 바꾸기 전 상태를 이 Mac에 백업해 둬요.")
            // An overwrite backs the overwritten list up first (#137, see move); the record is merged either way.
            let after = L("어느 쪽이든 완료 기록은 합쳐지고, 종이냥이 다시 시작돼요.")
            let answer = SlipAlert.run(symbol: "folder", title: L("저장 폴더"), message: message, detail: detail + "\n" + after,
                                       choices: [.init(title: L("취소"), isCancel: true),
                                                 .init(title: target == nil ? L("공유 폴더 목록으로 덮어쓰기") : L("이 Mac 목록으로 덮어쓰기"), role: .quiet),
                                                 .init(title: target == nil ? L("전에 쓰던 목록 쓰기") : L("폴더 목록 쓰기"), role: .primary, isDefault: true)],
                                       width: .medium)
            switch answer {
            case 2: copyCurrent = false
            case 1: copyCurrent = true
            default: return
            }
        }
        model.saveMemosNow()
        do {
            try move(from: current, to: destination, copyCurrent: copyCurrent, backups: model.backups?.activeFolder ?? BackupController.backupsFolder)
        } catch {
            SlipAlert.inform(title: L("저장 폴더"), message: L("폴더로 옮기지 못했어요. 지금 목록은 그대로예요."))
            return
        }
        if let target { preferences.set(target.path, forKey: preferenceKey) } else { preferences.removeObject(forKey: preferenceKey) }
        // #195: the restarted app says once where the list went — the folder's name (as Finder shows it), never its path.
        preferences.set(["folder": target.map { FileManager.default.displayName(atPath: $0.path) } ?? "", "kept": copyCurrent ? "moved" : "folder"],
                        forKey: movedKey)
        relaunch()
    }

    /// #195: the note the move leaves for the restarted app (`switchTo`), read and forgotten at launch.
    static let movedKey = "storage.moved"

    /// The toast after a move, once: where the list went (`folder` empty = this Mac's own folder), or whose list is kept.
    static func movedNotice(_ preferences: UserDefaults) -> String? {
        guard let note = preferences.dictionary(forKey: movedKey) else { return nil }
        preferences.removeObject(forKey: movedKey)
        return movedText(folder: note["folder"] as? String ?? "", moved: note["kept"] as? String != "folder")
    }

    static func movedText(folder: String, moved: Bool) -> String {
        switch (folder.isEmpty, moved) {
        case (false, true): L("목록을 ‘\(folder)’ 폴더로 옮겼어요")
        case (false, false): L("‘\(folder)’ 폴더의 목록을 써요")
        case (true, true): L("목록을 이 Mac의 기본 위치로 옮겼어요")
        case (true, false): L("이 Mac에 전에 쓰던 목록을 써요")
        }
    }

    /// The move itself, without questions. `copyCurrent`: this Mac's list goes over whatever `destination` holds — and
    /// what it holds goes to `backups` first (폴더-바꾸기-전-…, the same place and format as before an import, #137);
    /// a failed backup stops the move. Either way the record and the focus record are merged.
    static func move(from current: URL, to destination: URL, copyCurrent: Bool, backups: URL, now: Date = Date()) throws {
        let manager = FileManager.default
        try manager.createDirectory(at: destination, withIntermediateDirectories: true)
        if copyCurrent {
            let overwritten = try BackupController.files(in: destination)
            if !overwritten.isEmpty { try BackupController.saveCopy(overwritten, reason: .beforeFolderSwitch, in: backups, now: now) }
            for name in files {
                let source = current.appendingPathComponent(name)
                let target = destination.appendingPathComponent(name)
                guard manager.fileExists(atPath: source.path) else { continue }
                // #173: a link or an oversized file on either side is left alone (never copied, never replaced).
                if SafeFile.isRefused(source) || SafeFile.isRefused(target) { continue }
                if manager.fileExists(atPath: target.path) { try manager.removeItem(at: target) }
                try manager.copyItem(at: source, to: target)
            }
        }
        // Whichever list is kept, what this Mac already filed stays in the record.
        try mergeArchive(from: current.appendingPathComponent("archive"), into: destination.appendingPathComponent("archive"))
        // …and the focus record: the sessions the other folder lacks are added (by id), none removed.
        try mergeFocus(from: current, into: destination)
    }

    /// The record is never overwritten: each month's lines are added to what the other device
    /// already filed, skipping tasks that are already there (matched by id, since the Windows app
    /// writes the same entry with its keys in another order).
    static func mergeArchive(from source: URL, into target: URL) throws {
        let manager = FileManager.default
        guard let months = try? manager.contentsOfDirectory(at: source, includingPropertiesForKeys: nil) else { return }
        try manager.createDirectory(at: target, withIntermediateDirectories: true)
        for month in months where month.pathExtension == "jsonl" {
            let destination = target.appendingPathComponent(month.lastPathComponent)
            // #173: a linked or oversized month on either side is skipped (not read into the record, not written through).
            if SafeFile.isRefused(month) || SafeFile.isRefused(destination) { continue }
            let incoming = (try? SafeFile.text(month)) ?? ""
            let existing = (try? SafeFile.text(destination)) ?? ""
            var have = Set(existing.split(separator: "\n").map { entryID(String($0)) })
            let added = incoming.split(separator: "\n").map(String.init).filter { line in
                !line.isEmpty && have.insert(entryID(line)).inserted
            }
            guard !added.isEmpty else { continue }
            let joined = (existing.isEmpty || existing.hasSuffix("\n") ? existing : existing + "\n") + added.joined(separator: "\n") + "\n"
            try joined.write(to: destination, atomically: true, encoding: .utf8)
        }
    }

    /// focus.jsonl: this folder's sessions added to the target's by id (see Focus.merge).
    static func mergeFocus(from source: URL, into target: URL) throws {
        let incoming = (try? SafeFile.text(source.appendingPathComponent(Focus.fileName))) ?? ""
        guard !incoming.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let destination = target.appendingPathComponent(Focus.fileName)
        if SafeFile.isRefused(destination) { return }
        let existing = (try? SafeFile.text(destination)) ?? ""
        let merged = Focus.merge(existing, incoming)
        guard merged != existing else { return }
        try merged.write(to: destination, atomically: true, encoding: .utf8)
    }

    private static func entryID(_ line: String) -> String {
        let object = (try? JSONSerialization.jsonObject(with: Data(line.utf8))) as? [String: Any]
        return object?["id"] as? String ?? line
    }

    static func choose(defaultFolder: URL, current: URL, model: AppModel, preferences: UserDefaults) {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.canCreateDirectories = true
        panel.allowsMultipleSelection = false
        // #195: the button and the line above say what picking does — the list moves there, then the app restarts.
        panel.prompt = L("이 폴더로 옮기기")
        panel.message = L("다른 기기와 함께 쓸 폴더를 골라요(iCloud Drive, Dropbox, OneDrive …). 지금 목록이 그 폴더로 옮겨지고 종이냥이 다시 시작돼요.")
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let folder = panel.url else { return }
        switchTo(folder, defaultFolder: defaultFolder, current: current, model: model, preferences: preferences)
    }

    private static func relaunch() {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration) { _, _ in
            DispatchQueue.main.async { NSApp.terminate(nil) }
        }
    }
}

/// Notices when another device changed the shared files and has the model reload them.
/// Cloud folders replace files rather than editing them, so this checks modification dates
/// every two seconds instead of watching a file handle. With AI 연결 on (1.42) it also runs for this
/// Mac's own folder (the extension writes it) and follows ai-log.jsonl in the settings folder: the log is only
/// ever appended to, so the system tells as soon as a line comes (no waiting for the next check, nothing done
/// in between); the two-second check stays as the fallback and re-arms it when the file was replaced.
@MainActor
final class StorageWatcher {
    private let folder: URL
    private let model: AppModel
    private let log: URL?
    private let onLog: () -> Void
    private var timer: Timer?
    private var seen: [String: Date] = [:]
    private var seenLog: [Int] = []
    private var logSource: DispatchSourceFileSystemObject?

    init(folder: URL, model: AppModel, log: URL? = nil, onLog: @escaping () -> Void = {}) {
        self.folder = folder
        self.model = model
        self.log = log
        self.onLog = onLog
        seen = Self.dates(in: folder)
        seenLog = Self.stamp(log)
        let timer = Timer(timeInterval: 2, repeats: true) { _ in
            Task { @MainActor [weak self] in self?.check() }
        }
        timer.tolerance = 0.5
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        armLog()
    }

    func stop() {
        timer?.invalidate()
        timer = nil
        logSource?.cancel()
        logSource = nil
    }

    /// Told by the system when the log is written to (or replaced: then re-armed by the next check).
    private func armLog() {
        guard logSource == nil, let log else { return }
        let descriptor = open(log.path, O_EVTONLY)
        guard descriptor >= 0 else { return }
        let source = DispatchSource.makeFileSystemObjectSource(fileDescriptor: descriptor, eventMask: [.write, .extend, .delete, .rename], queue: .main)
        source.setEventHandler {
            Task { @MainActor [weak self] in self?.logEvent() }
        }
        source.setCancelHandler { close(descriptor) }
        source.resume()
        logSource = source
    }

    private func logEvent() {
        if Self.stamp(log).isEmpty || logSource?.data.contains(.delete) == true || logSource?.data.contains(.rename) == true {
            logSource?.cancel()
            logSource = nil
        }
        checkLog()
    }

    private func check() {
        let now = Self.dates(in: folder)
        if now != seen {
            seen = now
            model.reloadFromDisk()
        }
        armLog()
        checkLog()
    }

    private func checkLog() {
        guard log != nil else { return }
        let stamp = Self.stamp(log)
        guard stamp != seenLog else { return }
        seenLog = stamp
        onLog()
    }

    private static func dates(in folder: URL) -> [String: Date] {
        var result: [String: Date] = [:]
        for name in StorageFolder.files + [Focus.fileName] {
            let values = try? folder.appendingPathComponent(name).resourceValues(forKeys: [.contentModificationDateKey])
            if let date = values?.contentModificationDate { result[name] = date }
        }
        return result
    }

    /// The log's size and modification time (an append changes both).
    private static func stamp(_ url: URL?) -> [Int] {
        guard let url, let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey]) else { return [] }
        return [values.fileSize ?? 0, Int((values.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000)]
    }
}
