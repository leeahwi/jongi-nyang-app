import AppKit
import PaperCore

/// Keeping the list in a shared folder (iCloud Drive, Dropbox, OneDrive …) so another Mac or
/// the Windows app uses the same list. The files keep their names and format, so pointing both
/// apps at one folder is all it takes.
@MainActor
enum StorageFolder {
    static let preferenceKey = "storage.folder"
    static let files = ["todos.json", "memos.json", "repeats.json", "events.json", "alarms.json"]

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
                ? L("‘그 목록 쓰기’는 공유 폴더로 옮기기 전의 목록으로 돌아가고, ‘지금 목록으로 바꾸기’는 지금 보고 있는 목록을 이 Mac으로 가져와요.")
                : L("다른 기기에서 쓰던 목록이라면 ‘그 목록 쓰기’를 고르세요. ‘지금 목록으로 바꾸기’는 그 폴더의 목록을 이 Mac의 목록으로 덮어써요.")
            let answer = SlipAlert.run(symbol: "folder", title: L("저장 폴더"), message: message, detail: detail,
                                       choices: [.init(title: L("취소"), isCancel: true), .init(title: L("지금 목록으로 바꾸기"), role: .quiet),
                                                 .init(title: L("그 목록 쓰기"), role: .primary, isDefault: true)],
                                       width: .medium)
            switch answer {
            case 2: copyCurrent = false
            case 1: copyCurrent = true
            default: return
            }
        }
        model.saveMemosNow()
        do {
            try FileManager.default.createDirectory(at: destination, withIntermediateDirectories: true)
            if copyCurrent {
                for name in files {
                    let source = current.appendingPathComponent(name)
                    let target = destination.appendingPathComponent(name)
                    guard FileManager.default.fileExists(atPath: source.path) else { continue }
                    if FileManager.default.fileExists(atPath: target.path) { try FileManager.default.removeItem(at: target) }
                    try FileManager.default.copyItem(at: source, to: target)
                }
            }
            // Whichever list is kept, what this Mac already filed stays in the record.
            try mergeArchive(from: current.appendingPathComponent("archive"), into: destination.appendingPathComponent("archive"))
            // …and the focus record: the sessions the other folder lacks are added (by id), none removed.
            try mergeFocus(from: current, into: destination)
        } catch {
            SlipAlert.inform(title: L("저장 폴더"), message: L("폴더로 옮기지 못했어요."), detail: error.localizedDescription)
            return
        }
        if let target { preferences.set(target.path, forKey: preferenceKey) } else { preferences.removeObject(forKey: preferenceKey) }
        relaunch()
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
            let incoming = (try? String(contentsOf: month, encoding: .utf8)) ?? ""
            let existing = (try? String(contentsOf: destination, encoding: .utf8)) ?? ""
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
        let incoming = (try? String(contentsOf: source.appendingPathComponent(Focus.fileName), encoding: .utf8)) ?? ""
        guard !incoming.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        let destination = target.appendingPathComponent(Focus.fileName)
        let existing = (try? String(contentsOf: destination, encoding: .utf8)) ?? ""
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
        panel.prompt = L("이 폴더 쓰기")
        panel.message = L("다른 기기와 함께 쓸 폴더를 골라요 (iCloud Drive, Dropbox, OneDrive …)")
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
/// every two seconds instead of watching a file handle.
@MainActor
final class StorageWatcher {
    private let folder: URL
    private let model: AppModel
    private var timer: Timer?
    private var seen: [String: Date] = [:]

    init(folder: URL, model: AppModel) {
        self.folder = folder
        self.model = model
        seen = Self.dates(in: folder)
        let timer = Timer(timeInterval: 2, repeats: true) { _ in
            Task { @MainActor [weak self] in self?.check() }
        }
        timer.tolerance = 0.5
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    private func check() {
        let now = Self.dates(in: folder)
        guard now != seen else { return }
        seen = now
        model.reloadFromDisk()
    }

    private static func dates(in folder: URL) -> [String: Date] {
        var result: [String: Date] = [:]
        for name in StorageFolder.files + [Focus.fileName] {
            let values = try? folder.appendingPathComponent(name).resourceValues(forKeys: [.contentModificationDateKey])
            if let date = values?.contentModificationDate { result[name] = date }
        }
        return result
    }
}
