import AppKit
import Combine
import PaperCore

/// 집중 기록: `focus.jsonl` next to `todos.json`, one line per focus session or timer that ran a
/// minute or more (see Focus). Lines are only ever appended, so another device in a shared folder
/// adds its own without either losing any; the file is read again whenever it changed on disk.
@MainActor
final class FocusLog: ObservableObject {
    let url: URL
    /// Bumped when a line is added here (the history pane redraws).
    @Published private(set) var revision = 0
    private weak var model: AppModel?
    private var cache: (date: Date?, size: Int, records: [FocusRecord])?

    init(folder: URL, model: AppModel?) {
        url = folder.appendingPathComponent(Focus.fileName)
        self.model = model
    }

    /// Every readable record, in file order.
    func records() -> [FocusRecord] {
        let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
        let date = values?.contentModificationDate, size = values?.fileSize ?? 0
        if let cache, cache.date == date, cache.size == size { return cache.records }
        let records = Focus.parse((try? String(contentsOf: url, encoding: .utf8)) ?? "")
        cache = (date, size, records)
        return records
    }

    func append(_ record: FocusRecord) {
        guard model?.savingStopped != true else { return }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let existing = (try? String(contentsOf: url, encoding: .utf8)) ?? ""
            if FileManager.default.fileExists(atPath: url.path), let handle = try? FileHandle(forWritingTo: url) {
                defer { try? handle.close() }
                try handle.seekToEnd()
                // A torn last line (no newline) gets its own line first.
                let lead = existing.isEmpty || existing.hasSuffix("\n") ? "" : "\n"
                try handle.write(contentsOf: Data((lead + Focus.encodeLine(record) + "\n").utf8))
            } else {
                try Data(Focus.append(record, to: "").utf8).write(to: url, options: .atomic)
            }
        } catch {
            // Appended once, never tried again: this session isn't in the record.
            model?.storageError = [L("집중 기록을 저장하지 못했어요."), L("이번 집중은 기록에 남지 않았어요."), L("저장 폴더가 열리는지 확인해 주세요.")].joined(separator: " ")
        }
        cache = nil
        revision += 1
        // The history pane follows the model's changes.
        model?.objectWillChange.send()
    }

    /// Design snapshots: sample sessions, written like real ones.
    func seed(_ records: [FocusRecord]) {
        for record in records { append(record) }
    }
}
