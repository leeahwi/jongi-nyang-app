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

    /// #380: a folder is chosen but isn't there just now (Dropbox · OneDrive not running yet, a disk unplugged): its path.
    static func missing(_ preferences: UserDefaults) -> String? {
        guard let path = preferences.string(forKey: preferenceKey), chosen(preferences) == nil else { return nil }
        return path
    }

    /// At launch (#380): while the chosen folder is missing, nothing is read or written. A slip says so and the folder is
    /// looked for every second — once it is there it opens by itself. 다시 확인 looks again, 폴더 다시 고르기 picks another
    /// (the list isn't moved: that folder's own list opens), 이 Mac 목록 열기 opens this Mac's for this run (the folder
    /// stays chosen, for the next launch). `folder` is the one to open (nil: this Mac's); `missing` when it stands in.
    /// `ask`: the slip (a check answers it instead) — given the folder's name and whether it is there now, the choice.
    /// A folder that is there but whose list iCloud Drive hasn't brought down yet (a new Mac, 저장 공간 최적화) is waited
    /// for the same way (`askDownload`: 0 이 Mac 목록 열기 · 1 기다리기), the download asked for meanwhile: reading those
    /// files here would hold the app before its first window until iCloud is done — or for good.
    /// `ask` stays the last parameter, so a trailing closure (the tests') still answers the missing-folder question.
    static func waitForChosen(_ preferences: UserDefaults,
                              askDownload: @MainActor (String, @escaping @MainActor @Sendable () -> Bool) -> Int = askDownloading,
                              ask: @MainActor (String, @escaping @MainActor @Sendable () -> Bool) -> Int = askMissing)
        -> (folder: URL?, missing: String?) {
        while true {
            if let path = missing(preferences) {
                switch ask((path as NSString).lastPathComponent, { chosen(preferences) != nil }) {
                case 0: return (nil, path)
                case 1:
                    let panel = NSOpenPanel()
                    panel.canChooseDirectories = true
                    panel.canChooseFiles = false
                    panel.canCreateDirectories = true
                    panel.prompt = L("이 폴더 열기")
                    TestHooks.activate()
                    if panel.runModal() == .OK, let folder = panel.url { preferences.set(folder.path, forKey: preferenceKey) }
                default: break
                }
                continue
            }
            guard let folder = chosen(preferences) else { return (nil, nil) }
            let waiting = notDownloaded(folder)
            guard !waiting.isEmpty else { return (folder, nil) }
            SafeFile.requestDownload(waiting)
            // Picked another folder meanwhile (or it went): looked at again from the top.
            if askDownload(folder.lastPathComponent, { notDownloaded(folder).isEmpty || chosen(preferences) != folder }) == 0 {
                return (nil, folder.path)
            }
        }
    }

    /// The files of `folder` the app reads — the data files, focus.jsonl and the record's months — that iCloud Drive
    /// hasn't downloaded yet (SafeFile.isDataless). Only `lstat`, so it is cheap enough to ask every second.
    static func notDownloaded(_ folder: URL) -> [URL] {
        var urls = (files + [Focus.fileName]).map { folder.appendingPathComponent($0) }
        let archive = folder.appendingPathComponent("archive", isDirectory: true)
        urls += ((try? FileManager.default.contentsOfDirectory(at: archive, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.pathExtension == "jsonl" }
        return urls.filter(SafeFile.isDataless)
    }

    /// iCloud Drive에서 목록을 받고 있어요: 0 이 Mac 목록 열기 · 1 기다리기 (also when the download is done).
    static func askDownloading(_ name: String, back: @escaping @MainActor @Sendable () -> Bool) -> Int {
        SlipAlert.run(symbol: "icloud.and.arrow.down", title: L("저장 폴더"), message: L("iCloud Drive에서 목록을 받고 있어요"),
                      detail: L("‘\(name)’ 폴더의 파일이 아직 이 Mac에 다 내려오지 않았어요. 다 받으면 저절로 그 폴더로 열어요. 그전에는 아무 파일도 쓰지 않아요."),
                      choices: [.init(title: L("이 Mac 목록 열기"), role: .quiet, leading: true),
                                .init(title: L("기다리기"), role: .primary, isDefault: true, isCancel: true)],
                      width: .medium, answersItself: back)
    }

    /// Before a move reads `folders` (the question about a list already there, the backup, the merge): their iCloud
    /// files are brought down first, on a slip that answers itself (0 취소 · 1 기다리기). False: cancelled, nothing moved.
    static func waitForDownloads(_ folders: [URL], ask: @MainActor (String, @escaping @MainActor @Sendable () -> Bool) -> Int = askDownloadingMove) -> Bool {
        while let folder = folders.first(where: { !notDownloaded($0).isEmpty }) {
            SafeFile.requestDownload(notDownloaded(folder))
            if ask(folder.lastPathComponent, { notDownloaded(folder).isEmpty }) == 0 { return false }
        }
        return true
    }

    static func askDownloadingMove(_ name: String, back: @escaping @MainActor @Sendable () -> Bool) -> Int {
        SlipAlert.run(symbol: "icloud.and.arrow.down", title: L("저장 폴더"), message: L("iCloud Drive에서 목록을 받고 있어요"),
                      detail: L("‘\(name)’ 폴더의 파일을 다 받으면 저절로 이어서 옮겨요. 취소하면 지금 목록은 그대로예요."),
                      choices: [.init(title: L("취소")),
                                .init(title: L("기다리기"), role: .primary, isDefault: true, isCancel: true)],
                      width: .medium, answersItself: back)
    }

    /// 저장 폴더를 찾지 못했어요: 0 이 Mac 목록 열기 · 1 폴더 다시 고르기 · 2 다시 확인 (also when the folder comes back).
    static func askMissing(_ name: String, back: @escaping @MainActor @Sendable () -> Bool) -> Int {
        SlipAlert.run(symbol: "externaldrive.badge.questionmark", title: L("저장 폴더"), message: L("저장 폴더를 찾지 못했어요"),
                      detail: L("‘\(name)’ 폴더가 아직 보이지 않아요. iCloud Drive · Dropbox · OneDrive가 켜지거나 디스크가 연결되면 저절로 그 폴더로 열어요. 그전에는 아무 파일도 쓰지 않아요."),
                      choices: [.init(title: L("이 Mac 목록 열기"), role: .quiet, leading: true),
                                .init(title: L("폴더 다시 고르기")),
                                .init(title: L("다시 확인"), role: .primary, isDefault: true, isCancel: true)],
                      width: .medium, answersItself: back)
    }

    /// Moves the app to `target` (nil = back to this Mac's folder) and restarts it there. If the
    /// target already holds a list, asks which one to keep.
    static func switchTo(_ target: URL?, defaultFolder: URL, current: URL, model: AppModel, preferences: UserDefaults) {
        let destination = target ?? defaultFolder
        guard destination.standardizedFileURL != current.standardizedFileURL else { return }
        // A list in iCloud Drive not downloaded yet is read below on this thread: it comes down first.
        guard waitForDownloads([destination, current]) else { return }
        var copyCurrent = true
        if FileManager.default.fileExists(atPath: destination.appendingPathComponent("todos.json").path) {
            let detail = target == nil
                ? L("공유 폴더로 옮기기 전의 목록으로 돌아가려면 ‘전에 쓰던 목록 쓰기’를 고르면 돼요. 덮어써도 바꾸기 전 상태를 백업해 둬요.")
                : L("다른 기기에서 쓰던 목록이면 ‘폴더 목록 쓰기’를 고르면 돼요. 덮어써도 바꾸기 전 상태를 이 Mac에 백업해 둬요.")
            // An overwrite backs the overwritten list up first (#137, see move); the record is merged either way.
            let after = L("어느 쪽이든 완료 기록은 합쳐지고, 종이냥이 다시 시작돼요.")
            // #253: either answer may put another list in place of this one (an overwrite, or the folder's list).
            let answer = SlipAlert.run(symbol: "folder", title: L("저장 폴더"),
                                       message: target == nil ? L("이 Mac에 전에 쓰던 목록이 있어요.") : L("이 폴더에 이미 종이냥 목록이 있어요."), replacesList: true,
                                       detail: detail + "\n" + after,
                                       choices: [.init(title: L("취소"), isCancel: true),
                                                 .init(title: target == nil ? L("공유 폴더 목록으로 덮어쓰기") : L("이 Mac 목록으로 덮어쓰기"), role: .quiet),
                                                 .init(title: target == nil ? L("전에 쓰던 목록 쓰기") : L("폴더 목록 쓰기"), role: .primary, isDefault: true)],
                                       width: .medium)
            switch answer {
            case 2: copyCurrent = false
            case 1: copyCurrent = true
            default: return
            }
        } else if target == nil {
            // #240: ‘이 Mac에만’ is one click on the storage pane now — say what it does before the list moves and the app restarts.
            let answer = SlipAlert.run(symbol: "folder", title: L("저장 폴더"), message: L("목록을 이 Mac으로 옮길까요?"),
                                       detail: L("지금 목록이 이 Mac의 기본 폴더로 옮겨지고 종이냥이 다시 시작돼요. 공유 폴더의 파일은 그대로 남아요."),
                                       choices: [.init(title: L("취소"), isCancel: true),
                                                 .init(title: L("이 Mac으로 옮기기"), role: .primary, isDefault: true)],
                                       width: .medium)
            guard answer == 1 else { return }
        }
        model.saveMemosNow()
        // #390: 다시 시도 moves again with the same answer (it doesn't ask again).
        while true {
            do {
                try move(from: current, to: destination, copyCurrent: copyCurrent, backups: model.backups?.activeFolder ?? BackupController.backupsFolder)
                break
            } catch {
                guard SlipAlert.inform(title: L("저장 폴더"), message: L("폴더로 옮기지 못했어요. 지금 목록은 그대로예요."),
                                       detail: L("폴더에 쓸 수 있는지 확인하고 다시 시도해 주세요."), next: L("다시 시도")) else { return }
            }
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
        TestHooks.activate()
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
    /// The not-downloaded files last asked for (asked once, not every check).
    private var requested: [URL] = []
    private var seenLog: [Int] = []
    private var logSource: DispatchSourceFileSystemObject?

    init(folder: URL, model: AppModel, log: URL? = nil, onLog: @escaping () -> Void = {}) {
        self.folder = folder
        self.model = model
        self.log = log
        self.onLog = onLog
        seen = Self.dates(in: folder)
        seenLog = Self.stamp(log)
        let timer = Timer(timeInterval: 2, repeats: true) { [weak self] _ in
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
        source.setEventHandler { [weak self] in
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

    /// Posted after a check found the shared files changed (#381: ArchiveStore reads a changed month again).
    static let changed = Notification.Name("StorageWatcher.changed")

    private func check() {
        let now = Self.dates(in: folder)
        if now != seen {
            // A file iCloud Drive hasn't brought down (another device's save, 저장 공간 최적화): asked for, and read on a
            // later check once it is here — reading it now would hold the app until iCloud is done.
            let waiting = StorageFolder.notDownloaded(folder)
            if !waiting.isEmpty {
                if waiting != requested { SafeFile.requestDownload(waiting) }
                requested = waiting
                armLog()
                checkLog()
                return
            }
            requested = []
            seen = now
            model.reloadFromDisk()
            NotificationCenter.default.post(name: Self.changed, object: model)
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
        // #381: and the record's months, which another device appends to.
        let archive = folder.appendingPathComponent("archive", isDirectory: true)
        for month in (try? FileManager.default.contentsOfDirectory(at: archive, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
        where month.pathExtension == "jsonl" {
            if let date = (try? month.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate {
                result["archive/" + month.lastPathComponent] = date
            }
        }
        return result
    }

    /// The log's size and modification time (an append changes both).
    private static func stamp(_ url: URL?) -> [Int] {
        guard let url, let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey]) else { return [] }
        return [values.fileSize ?? 0, Int((values.contentModificationDate?.timeIntervalSince1970 ?? 0) * 1000)]
    }
}
