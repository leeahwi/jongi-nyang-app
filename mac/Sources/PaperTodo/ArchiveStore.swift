import AppKit
import Combine
import PaperCore

/// The record of finished tasks: `archive/2026-09.jsonl` next to `todos.json`, one line per
/// task. Lines are only ever appended, so the files stay small and a crash can at most tear
/// the last line. The format matches the Windows app.
@MainActor
final class ArchiveStore: ObservableObject {
    let directory: URL
    /// Bumped when what 완료 기록 shows changes: the record, the finished tasks still on the list, focus sessions, the
    /// day (#62: it went up on every change to the model, and the pane was built again each time, 0.4–1.6 s).
    @Published private(set) var revision = 0
    /// The desk is closed (DeskWindowController): a change is only noted, and looked at when it opens again.
    var paused = false {
        didSet { if !paused && missed { refresh() } }
    }
    private var missed = false
    /// What the pane showed last (see `signature`).
    private var shown: Int?
    /// The pane's entries and days, worked out once per revision.
    private var grouped: (revision: Int, entries: [ArchiveEntry], days: [String: [ArchiveEntry]])?
    private let model: AppModel
    private var cache: [ArchiveEntry]?
    /// The month files `cache` was read from (`monthStamp`, #381).
    private var cacheStamp: [String]?
    private var timer: Timer?
    private var boundaryTimer: Timer?
    private var subscriptions = Set<AnyCancellable>()

    init(model: AppModel) {
        self.model = model
        directory = model.file.url.deletingLastPathComponent().appendingPathComponent("archive", isDirectory: true)
        model.$archiveAfterDays.dropFirst().sink { [weak self] _ in
            DispatchQueue.main.async { self?.run() }
        }.store(in: &subscriptions)
        // #64: what `signature` reads — the list and its spaces, and the focus record — not every change of the model.
        model.listChanged.merge(with: model.focusLog.$revision.dropFirst().map { _ in () }).sink { [weak self] _ in
            DispatchQueue.main.async { self?.modelChanged() }
        }.store(in: &subscriptions)
        model.fileCompleted = { [weak self] items in self?.file(items) ?? [] }
        model.unfileCompleted = { [weak self] ids in self?.unfile(ids) }
        NotificationCenter.default.publisher(for: StorageWatcher.changed).sink { [weak self] _ in
            DispatchQueue.main.async { self?.diskChanged() }
        }.store(in: &subscriptions)
    }

    /// Day housekeeping: yesterday's finished work goes to the record, then today's recurring
    /// copies appear. Runs at launch, every 30 minutes, after waking and right after 4 a.m.
    func start() {
        tick()
        let timer = Timer(timeInterval: 30 * 60, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.tick() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        armBoundary()
        NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.didWakeNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.armBoundary()
                // #377: after the shared folder's two-second check has had its turn (a night's changes from another
                // device are read first; every write below catches up with the disk again anyway).
                DispatchQueue.main.asyncAfter(deadline: .now() + Self.wakeDelay) { self?.tick() }
            }
            .store(in: &subscriptions)
    }

    /// Longer than StorageWatcher's two-second check.
    static let wakeDelay: TimeInterval = 3

    private func tick() {
        run()
        model.placeRecurring()
        model.stampCarried()
        // 할 일 스페이스 (1.45): yesterday's 한 스페이스만 보기 lets go (S11).
        model.dropStaleSpaceLens()
        // A new day re-sorts the pages (deadlines come due) even when nothing was archived or placed.
        model.dayTurned()
    }

    private func armBoundary() {
        boundaryTimer?.invalidate()
        let next = Calendar.current.date(byAdding: .day, value: 1, to: Archive.logicalDayStart(Date()))!
        let timer = Timer(fire: next.addingTimeInterval(5), interval: 0, repeats: false) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.tick()
                self?.armBoundary()
            }
        }
        RunLoop.main.add(timer, forMode: .common)
        boundaryTimer = timer
    }

    func run(now: Date = Date()) {
        file(Archive.due(model.items, now: now, after: model.archiveAfterDays))
    }

    /// Writes finished tasks to the record, then takes them off the list. Returns the ones filed.
    @discardableResult
    func file(_ due: [TodoItem]) -> [TodoItem] {
        guard !due.isEmpty else { return [] }
        // Spaces 2c (C5): each line keeps the to-do's space as it was filed (none for 일반).
        let spaces = model.todoSpaces
        let saved = append(due.map { ArchiveEntry($0, space: spaces.spaceID(of: $0.id)) })
        // Only tasks that actually reached the file leave the list.
        let filed = due.filter { saved.contains($0.id.uuidString) }
        if !filed.isEmpty { model.archiveCompleted(Set(filed.map(\.id))) }
        return filed
    }

    /// 완료한 일 정리's 되돌리기: these entries leave the record again (the tasks go back on the list). #379: only their
    /// lines go — the others stay byte for byte, a field this version doesn't know and a line it can't read too — and a
    /// month that can't be written says so.
    func unfile(_ ids: Set<String>) {
        guard !ids.isEmpty else { return }
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        var failed = false
        for url in files where url.pathExtension == "jsonl" {
            // #173: a linked or oversized month is left as it is.
            guard let text = try? SafeFile.text(url), let kept = Archive.removingLines(ids, from: text) else { continue }
            do {
                if kept.allSatisfy(\.isWhitespace) { try FileManager.default.removeItem(at: url) } else {
                    try Data(kept.utf8).write(to: url, options: .atomic)
                }
            } catch {
                failed = true
            }
        }
        if failed {
            model.storageError = L("완료 기록에서 되돌리지 못한 일이 있어요. 끝낸 일은 목록으로 돌아왔고, 완료 기록에도 그대로 남아 있어요.") + " "
                + L("저장 폴더가 열리는지 확인해 주세요.")
        }
        cache = nil
        revision += 1
    }

    private func modelChanged() {
        if paused { missed = true } else { refresh() }
    }

    /// A new revision only when the pane would show something else.
    private func refresh() {
        missed = false
        let now = signature()
        guard now != shown else { return }
        shown = now
        revision += 1
    }

    /// What the pane shows besides the record files: the finished tasks still on the list, the focus sessions, the day.
    private func signature() -> Int {
        var hasher = Hasher()
        hasher.combine(Archive.dayKey(Date()))
        hasher.combine(model.focusLog.records().count)
        let spaces = model.todoSpaces
        for item in model.items where item.isCompleted {
            hasher.combine(item.id)
            hasher.combine(item.title)
            hasher.combine(item.completedAt)
            // Spaces 2c: a finished to-do moved to another space is filtered anew.
            hasher.combine(spaces.spaceID(of: item.id))
        }
        hasher.combine(spaces.visible.map(\.id))
        return hasher.finalize()
    }

    /// `allEntries()` and its days for the pane, once per revision.
    func history() -> (entries: [ArchiveEntry], days: [String: [ArchiveEntry]]) {
        if let grouped, grouped.revision == revision { return (grouped.entries, grouped.days) }
        let entries = allEntries()
        let days = Archive.groupByDay(entries)
        grouped = (revision, entries, days)
        return (entries, days)
    }

    /// Everything finished: the record plus completed tasks still on the list.
    func allEntries() -> [ArchiveEntry] {
        let archived = load()
        let archivedIDs = Set(archived.map(\.id))
        let spaces = model.todoSpaces
        return archived + model.items.filter { $0.isCompleted && !archivedIDs.contains($0.id.uuidString) }
            .map { ArchiveEntry($0, space: spaces.spaceID(of: $0.id)) }
    }

    func seed(_ entries: [ArchiveEntry]) {
        _ = append(entries)
    }

    func openFolder() {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        NSWorkspace.shared.open(directory)
    }

    private func append(_ entries: [ArchiveEntry]) -> Set<String> {
        var known = Set(load().map(\.id))
        var saved = Set<String>()
        var byMonth: [String: [ArchiveEntry]] = [:]
        for entry in entries {
            if !known.insert(entry.id).inserted { saved.insert(entry.id); continue }
            byMonth[Archive.monthKey(entry), default: []].append(entry)
        }
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            for (month, list) in byMonth {
                let url = directory.appendingPathComponent("\(month).jsonl")
                let data = Data((list.map(Archive.encodeLine).joined(separator: "\n") + "\n").utf8)
                // #173: never appended through a link, nor onto a month past 32MB (the tasks stay on the list).
                try SafeFile.check(url)
                if let handle = try? FileHandle(forUpdating: url) {
                    defer { try? handle.close() }
                    let end = try handle.seekToEnd()
                    // #378: after a torn last line (a power cut mid-append) the new lines start on their own, as in
                    // focus.jsonl — joined to it, both would be unreadable and the tasks gone from the list and the record.
                    var lead = Data()
                    if end > 0 {
                        try handle.seek(toOffset: end - 1)
                        if try handle.read(upToCount: 1) != Data([0x0A]) { lead = Data([0x0A]) }
                        try handle.seekToEnd()
                    }
                    try handle.write(contentsOf: lead + data)
                } else {
                    try data.write(to: url, options: .atomic)
                }
                for entry in list { saved.insert(entry.id); cache?.append(entry) }
            }
        } catch {
            model.storageError = L("완료 기록을 저장하지 못했어요. 끝낸 일은 목록에 그대로 둘게요.") + " " + L("저장 폴더가 열리는지 확인해 주세요.")
        }
        if !saved.isEmpty { revision += 1 }
        // The cache already has this Mac's own lines (#381: not a reason to read the months again).
        if cache != nil, !byMonth.isEmpty { cacheStamp = monthStamp() }
        return saved
    }

    private func load() -> [ArchiveEntry] {
        // #381: another device files into a shared folder too — a month changed on disk is read again.
        let stamp = monthStamp()
        if let cache, stamp == cacheStamp { return cache }
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        let entries = files.filter { $0.pathExtension == "jsonl" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
            .flatMap { Archive.parseLines((try? SafeFile.text($0)) ?? "") } // #173: a link or a month past 32MB reads as none
        cache = entries
        cacheStamp = stamp
        return entries
    }

    /// The month files as they are on disk: name, size and modification time (#381).
    private func monthStamp() -> [String] {
        let keys: Set<URLResourceKey> = [.contentModificationDateKey, .fileSizeKey]
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: Array(keys))) ?? []
        return files.filter { $0.pathExtension == "jsonl" }.map { url in
            let values = try? url.resourceValues(forKeys: keys)
            return "\(url.lastPathComponent) \(values?.fileSize ?? -1) \(values?.contentModificationDate?.timeIntervalSince1970 ?? 0)"
        }.sorted()
    }

    /// The shared folder changed (StorageWatcher): when a month did, 완료 기록 · 연속 기록 · 찾기 read the record again.
    func diskChanged() {
        guard cache != nil, monthStamp() != cacheStamp else { return }
        cache = nil
        if paused {
            shown = nil
            missed = true
        } else {
            revision += 1
        }
    }
}
