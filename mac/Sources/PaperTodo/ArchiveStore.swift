import AppKit
import Combine
import PaperCore

/// The record of finished tasks: `archive/2026-09.jsonl` next to `todos.json`, one line per
/// task. Lines are only ever appended, so the files stay small and a crash can at most tear
/// the last line. The format matches the Windows app.
@MainActor
final class ArchiveStore: ObservableObject {
    let directory: URL
    /// Bumped whenever the record or the list changes, so the history window redraws.
    @Published private(set) var revision = 0
    private let model: AppModel
    private var cache: [ArchiveEntry]?
    private var timer: Timer?
    private var boundaryTimer: Timer?
    private var subscriptions = Set<AnyCancellable>()

    init(model: AppModel) {
        self.model = model
        directory = model.file.url.deletingLastPathComponent().appendingPathComponent("archive", isDirectory: true)
        model.$archiveAfterDays.dropFirst().sink { [weak self] _ in
            DispatchQueue.main.async { self?.run() }
        }.store(in: &subscriptions)
        model.objectWillChange.sink { [weak self] _ in
            DispatchQueue.main.async { self?.revision += 1 }
        }.store(in: &subscriptions)
        model.fileCompleted = { [weak self] items in self?.file(items) ?? [] }
        model.unfileCompleted = { [weak self] ids in self?.unfile(ids) }
    }

    /// Day housekeeping: yesterday's finished work goes to the record, then today's recurring
    /// copies appear. Runs at launch, every 30 minutes, after waking and right after 4 a.m.
    func start() {
        tick()
        let timer = Timer(timeInterval: 30 * 60, repeats: true) { _ in
            Task { @MainActor [weak self] in self?.tick() }
        }
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
        armBoundary()
        NSWorkspace.shared.notificationCenter.publisher(for: NSWorkspace.didWakeNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.tick()
                self?.armBoundary()
            }
            .store(in: &subscriptions)
    }

    private func tick() {
        run()
        model.placeRecurring()
        model.stampCarried()
        // A new day re-sorts the pages (deadlines come due) even when nothing was archived or placed.
        model.objectWillChange.send()
    }

    private func armBoundary() {
        boundaryTimer?.invalidate()
        let next = Calendar.current.date(byAdding: .day, value: 1, to: Archive.logicalDayStart(Date()))!
        let timer = Timer(fire: next.addingTimeInterval(5), interval: 0, repeats: false) { _ in
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
        let saved = append(due.map(ArchiveEntry.init))
        // Only tasks that actually reached the file leave the list.
        let filed = due.filter { saved.contains($0.id.uuidString) }
        if !filed.isEmpty { model.archiveCompleted(Set(filed.map(\.id))) }
        return filed
    }

    /// 완료한 일 정리's 되돌리기: these entries leave the record again (the tasks go back on the list).
    func unfile(_ ids: Set<String>) {
        guard !ids.isEmpty else { return }
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        for url in files where url.pathExtension == "jsonl" {
            guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
            let entries = Archive.parseLines(text)
            guard entries.contains(where: { ids.contains($0.id) }) else { continue }
            let kept = entries.filter { !ids.contains($0.id) }
            if kept.isEmpty { try? FileManager.default.removeItem(at: url) } else {
                try? Data((kept.map(Archive.encodeLine).joined(separator: "\n") + "\n").utf8).write(to: url, options: .atomic)
            }
        }
        cache = nil
        revision += 1
    }

    /// Everything finished: the record plus completed tasks still on the list.
    func allEntries() -> [ArchiveEntry] {
        let archived = load()
        let archivedIDs = Set(archived.map(\.id))
        return archived + model.items.filter { $0.isCompleted && !archivedIDs.contains($0.id.uuidString) }.map(ArchiveEntry.init)
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
                if let handle = try? FileHandle(forWritingTo: url) {
                    defer { try? handle.close() }
                    try handle.seekToEnd()
                    try handle.write(contentsOf: data)
                } else {
                    try data.write(to: url, options: .atomic)
                }
                for entry in list { saved.insert(entry.id); cache?.append(entry) }
            }
        } catch {
            model.storageError = L("완료 기록을 저장하지 못했어요. 끝낸 일은 목록에 그대로 둘게요.") + "\n\(directory.path)"
        }
        if !saved.isEmpty { revision += 1 }
        return saved
    }

    private func load() -> [ArchiveEntry] {
        if let cache { return cache }
        let files = (try? FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil)) ?? []
        let entries = files.filter { $0.pathExtension == "jsonl" }
            .sorted { $0.lastPathComponent < $1.lastPathComponent }
            .flatMap { Archive.parseLines((try? String(contentsOf: $0, encoding: .utf8)) ?? "") }
        cache = entries
        return entries
    }
}
