import AppKit
import CryptoKit
import PaperCore

/// 자동 백업 (#139) and the backup list (#140): copies of the storage folder as .jongi files in a backup folder on
/// this Mac — once a day (the app's 4 a.m. day, only when something changed since the last copy), before anything is
/// overwritten (가져오기, 저장 폴더 덮어쓰기, 되돌리기, the first launch after an update) and when asked (지금 백업하기).
/// The folder is this Mac's app folder + backups even when the list is in a shared folder (each device keeps its own),
/// or one chosen in Settings (never the storage folder or inside it); a chosen folder that's gone (a disk taken out)
/// leaves the copies in the default one. Names, what each kind keeps and when the daily one is due: PaperCore Backup,
/// the same as the Windows app's autoBackup.ts.
@MainActor
final class BackupBook: ObservableObject {
    /// A copy in the folder, read from its name; `counts` from the file (B4) once it has been read.
    struct Entry: Identifiable, Equatable {
        var id: String { name }
        let name: String
        let reason: Backup.Reason
        let date: Date
        let size: Int
        var counts: Backup.Counts?
        let url: URL
    }

    nonisolated static let autoKey = "backup.auto"
    nonisolated static let folderKey = "backup.folder"
    nonisolated static let fingerprintKey = "backup.fingerprint"
    nonisolated static let versionKey = "backup.version"
    nonisolated static let failedKey = "backup.failed"

    /// This Mac's default: the app folder's backups (where the copies before an import always were).
    let defaultFolder: URL
    /// The storage folder (this Mac's or the shared one): what is copied.
    let storageFolder: URL
    let preferences: UserDefaults

    @Published private(set) var entries: [Entry] = []
    @Published private(set) var chosenFolder: URL?
    @Published private(set) var failed: Bool
    @Published var auto: Bool {
        didSet { preferences.set(auto, forKey: Self.autoKey) }
    }
    /// An import or a restore is under way: the daily copy waits for the next check.
    var busy = false
    /// Snapshots: a fixed now, so ‘오늘 09:12’ is drawn the same every time.
    var now: () -> Date = Date.init

    private var counted: [String: (Date, Backup.Counts)] = [:]
    private var checking = false
    private var timer: Timer?
    private var wake: NSObjectProtocol?

    init(storageFolder: URL, defaultFolder: URL, preferences: UserDefaults) {
        self.storageFolder = storageFolder
        self.defaultFolder = defaultFolder
        self.preferences = preferences
        auto = preferences.object(forKey: Self.autoKey) as? Bool ?? true
        chosenFolder = preferences.string(forKey: Self.folderKey).map { URL(fileURLWithPath: $0, isDirectory: true) }
        failed = preferences.object(forKey: Self.failedKey) != nil
        refresh()
    }

    // MARK: Where

    /// Where copies go now: the chosen folder while it's there and writable, else the default.
    var activeFolder: URL { Self.activeFolder(chosen: chosenFolder, default: defaultFolder) }
    /// A folder was chosen but isn't there now (the copies go to the default one meanwhile).
    var chosenMissing: Bool { chosenFolder.map { !Self.usable($0) } ?? false }

    nonisolated static func activeFolder(chosen: URL?, default folder: URL) -> URL {
        if let chosen, usable(chosen) { return chosen }
        return folder
    }

    nonisolated static func activeFolder(preferences: UserDefaults, default folder: URL) -> URL {
        activeFolder(chosen: preferences.string(forKey: folderKey).map { URL(fileURLWithPath: $0, isDirectory: true) }, default: folder)
    }

    /// An existing folder that can be written to — never made here, so a disk taken out stays missing.
    nonisolated static func usable(_ folder: URL) -> Bool {
        var isDirectory: ObjCBool = false
        return FileManager.default.fileExists(atPath: folder.path, isDirectory: &isDirectory) && isDirectory.boolValue
            && FileManager.default.isWritableFile(atPath: folder.path)
    }

    /// The storage folder itself, or a folder inside it, can't hold the backups.
    nonisolated static func refuses(_ folder: URL, storage: URL) -> Bool {
        let picked = folder.standardizedFileURL.resolvingSymlinksInPath().path
        let kept = storage.standardizedFileURL.resolvingSymlinksInPath().path
        return picked == kept || picked.hasPrefix(kept.hasSuffix("/") ? kept : kept + "/")
    }

    /// Settings → 다른 폴더…: false (and nothing changes) when it's the storage folder or inside it.
    @discardableResult
    func choose(_ folder: URL) -> Bool {
        guard !Self.refuses(folder, storage: storageFolder) else { return false }
        if folder.standardizedFileURL.path == defaultFolder.standardizedFileURL.path {
            resetFolder()
            return true
        }
        preferences.set(folder.path, forKey: Self.folderKey)
        chosenFolder = folder
        refresh()
        return true
    }

    func resetFolder() {
        preferences.removeObject(forKey: Self.folderKey)
        chosenFolder = nil
        refresh()
    }

    // MARK: Copies

    /// SHA-256 of every file (by name): the same files, the same fingerprint, so an unchanged day makes no copy.
    nonisolated static func fingerprint(_ files: [String: String]) -> String {
        var hash = SHA256()
        for name in files.keys.sorted() {
            hash.update(data: Data(name.utf8))
            hash.update(data: Data([0]))
            hash.update(data: Data(files[name]!.utf8))
            hash.update(data: Data([0]))
        }
        return hash.finalize().map { String(format: "%02x", $0) }.joined()
    }

    /// A copy of the storage folder now (직접, or before something is overwritten). Throws when it can't be written.
    @discardableResult
    func copy(_ reason: Backup.Reason) throws -> URL {
        do {
            let files = try BackupController.files(in: storageFolder)
            let url = try BackupController.saveCopy(files, reason: reason, in: activeFolder, now: now())
            succeeded(fingerprint: Self.fingerprint(files))
            return url
        } catch {
            recordFailure()
            throw error
        }
    }

    /// The daily copy, if due: off the main thread (reading and writing a big record takes a moment), then the list.
    func checkDaily() {
        guard auto, !busy, !checking else { return }
        checking = true
        let storage = storageFolder, folder = activeFolder, stored = preferences.string(forKey: Self.fingerprintKey), now = now()
        Task.detached(priority: .utility) {
            let result = Result { try Self.dailyCopy(storage: storage, folder: folder, fingerprint: stored, now: now) }
            await MainActor.run {
                self.checking = false
                switch result {
                case .success(let fingerprint?): self.succeeded(fingerprint: fingerprint)
                case .success(nil): break
                case .failure: self.recordFailure()
                }
                self.refresh()
            }
        }
    }

    /// The daily rule itself: the folder's files, and a 매일-… copy when Backup.isDue says so (something changed since
    /// the last copy, and the newest daily one is from an earlier 4 a.m. day). Returns the new fingerprint, or nil when
    /// nothing was written (nothing there, nothing changed, already done today).
    nonisolated static func dailyCopy(storage: URL, folder: URL, fingerprint stored: String?, now: Date) throws -> String? {
        let files = try BackupController.files(in: storage)
        guard !files.isEmpty else { return nil }
        let fingerprint = fingerprint(files)
        let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
        let lastDaily = names.compactMap { Backup.saved($0) }.filter { $0.reason == .daily }.map(\.date).max()
        guard Backup.isDue(now: now, lastDaily: lastDaily, changed: fingerprint != stored) else { return nil }
        try BackupController.saveCopy(files, reason: .daily, in: folder, now: now)
        return fingerprint
    }

    /// At launch, before the list is read (and maybe rewritten in a newer format): a 업데이트-전-… copy when this is a
    /// version this Mac hasn't run before and there is a list. Never stops the launch; a failure shows in Settings.
    @discardableResult
    static func beforeUpdate(storage: URL, defaultFolder: URL, preferences: UserDefaults, version: String, now: Date = Date()) -> URL? {
        guard preferences.string(forKey: versionKey) != version else { return nil }
        defer { preferences.set(version, forKey: versionKey) }
        do {
            let files = try BackupController.files(in: storage)
            guard !files.isEmpty else { return nil }
            let url = try BackupController.saveCopy(files, reason: .beforeUpdate, in: activeFolder(preferences: preferences, default: defaultFolder), now: now)
            preferences.set(fingerprint(files), forKey: fingerprintKey)
            preferences.removeObject(forKey: failedKey)
            return url
        } catch {
            preferences.set(now.timeIntervalSince1970, forKey: failedKey)
            return nil
        }
    }

    private func succeeded(fingerprint: String) {
        preferences.set(fingerprint, forKey: Self.fingerprintKey)
        preferences.removeObject(forKey: Self.failedKey)
        failed = false
        refresh()
    }

    private func recordFailure() {
        preferences.set(now().timeIntervalSince1970, forKey: Self.failedKey)
        failed = true
    }

    // MARK: The list

    /// The copies in the active folder, newest first; what each holds is read once, off the main thread
    /// (`readingNow`: at once — snapshots and tests).
    func refresh(readingNow: Bool = false) {
        let folder = activeFolder
        let urls = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey])) ?? []
        var found: [Entry] = []
        var unread: [(String, URL, Date)] = []
        for url in urls {
            // #173: a link in the backup folder is not a copy (not listed, never read).
            guard let saved = Backup.saved(url.lastPathComponent), SafeFile.entry(url)?.isLink != true else { continue }
            let values = try? url.resourceValues(forKeys: [.fileSizeKey, .contentModificationDateKey])
            let modified = values?.contentModificationDate ?? .distantPast
            var known = counted[saved.name].flatMap { $0.0 == modified ? $0.1 : nil }
            if known == nil, readingNow, let counts = Self.peekCounts(url) {
                counted[saved.name] = (modified, counts)
                known = counts
            }
            if known == nil { unread.append((saved.name, url, modified)) }
            found.append(Entry(name: saved.name, reason: saved.reason, date: saved.date, size: values?.fileSize ?? 0, counts: known, url: url))
        }
        entries = found.sorted { ($0.date, $0.name) > ($1.date, $1.name) }
        guard !unread.isEmpty else { return }
        Task.detached(priority: .utility) {
            let read = unread.compactMap { name, url, modified in Self.peekCounts(url).map { (name, modified, $0) } }
            await MainActor.run {
                for (name, modified, counts) in read { self.counted[name] = (modified, counts) }
                self.entries = self.entries.map { entry in
                    var entry = entry
                    if entry.counts == nil, let (_, counts) = self.counted[entry.name] { entry.counts = counts }
                    return entry
                }
            }
        }
    }

    /// What a copy holds: its `counts` (B4) or, for an older copy, counted from its files.
    nonisolated static func peekCounts(_ url: URL) -> Backup.Counts? {
        // #173: past FileLimits.backupBytes (64MB), or a link, the counts are not read (the list shows it without them).
        guard let data = try? SafeFile.data(url, limit: FileLimits.backupBytes),
              let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return nil }
        if let counts = Backup.Counts(json: object["counts"]) { return counts }
        guard let files = object["files"] as? [String: String] else { return nil }
        return Backup.Counts(files)
    }

    var totalSize: Int { entries.reduce(0) { $0 + $1.size } }
    var newest: Entry? { entries.first }

    func showInFinder(_ entry: Entry) { NSWorkspace.shared.activateFileViewerSelecting([entry.url]) }

    /// 지우기: to the Trash (it can come back from there).
    func trash(_ entry: Entry) {
        try? FileManager.default.trashItem(at: entry.url, resultingItemURL: nil)
        refresh()
    }

    func openFolder() {
        if chosenFolder == nil || !chosenMissing { try? FileManager.default.createDirectory(at: activeFolder, withIntermediateDirectories: true) }
        NSWorkspace.shared.open(activeFolder)
    }

    // MARK: When

    /// Checks ~30 s after launch, on waking and every hour (never on quitting: the app is rarely quit, and quitting
    /// shouldn't take longer).
    func start() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in self?.checkDaily() }
        let timer = Timer(timeInterval: 3600, repeats: true) { _ in
            Task { @MainActor [weak self] in self?.checkDaily() }
        }
        timer.tolerance = 120
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        wake = NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in
            MainActor.assumeIsolated {
                DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in self?.checkDaily() }
            }
        }
    }
}

extension String {
    /// Each ‘ · ’-separated part on one line when the text wraps (‘310 in geschiedenis’, ‘1,6 MB’ — never ‘310 in’ /
    /// ‘geschiedenis’): its spaces become no-break spaces. Only for showing (the list, its footnote, the restore question).
    var keptTogether: String {
        components(separatedBy: " · ").map { $0.replacingOccurrences(of: " ", with: "\u{00A0}") }.joined(separator: " · ")
    }
}
