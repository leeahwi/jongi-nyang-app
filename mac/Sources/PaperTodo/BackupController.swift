import AppKit
import PaperCore
import UniformTypeIdentifiers

/// 백업 · 옮기기: everything in the storage folder to one .jongi file, and back in on another
/// computer (Mac or Windows) — 합치기 adds what's missing, 바꾸기 takes the backup as it is.
/// Before either, what's here goes to backups/ in this Mac's app folder; the files are written
/// next to their places first and then swapped in, and the app restarts on them.
@MainActor
enum BackupController {
    static let fileType = UTType(filenameExtension: "jongi", conformingTo: .json) ?? .json

    // MARK: Export

    static func export(model: AppModel) {
        model.saveEverything()
        let panel = NSSavePanel()
        panel.nameFieldStringValue = Backup.fileName(Date(), language: .current)
        panel.allowedContentTypes = [fileType]
        panel.message = L("다른 컴퓨터의 종이냥에서 가져올 수 있는 백업 파일을 만들어요")
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        do {
            try exportText(folder: model.storageFolderURL).write(to: url, atomically: true, encoding: .utf8)
            NSWorkspace.shared.activateFileViewerSelecting([url])
        } catch {
            fail(L("백업 파일을 만들지 못했어요."), error.localizedDescription)
        }
    }

    // MARK: Import

    static func importBackup(model: AppModel) {
        let panel = NSOpenPanel()
        panel.allowedContentTypes = [fileType, .json]
        panel.prompt = L("가져오기")
        panel.message = L("종이냥에서 내보낸 백업 파일(.jongi)을 골라요")
        NSApp.activate(ignoringOtherApps: true)
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let backup: Backup.Contents
        do {
            backup = try Backup.parse(String(contentsOf: url, encoding: .utf8))
        } catch let problem as Backup.Problem {
            return fail(L("가져오지 못했어요."), problem.message(.current))
        } catch {
            return fail(L("가져오지 못했어요."), Backup.Problem.notBackup.message(.current))
        }

        let ask = SlipAlert.run(symbol: "square.and.arrow.down", title: L("가져오기"), message: L("이 백업을 가져올까요?"),
                                detail: importDetail(fileName: url.lastPathComponent, backup: backup), choices: importChoices, width: .medium)
        let replace: Bool
        switch ask {
        case 2: replace = false
        case 1:
            let sure = SlipAlert.run(symbol: "arrow.triangle.2.circlepath", title: L("바꾸기"), message: L("지금 것을 이 백업으로 바꿀까요?"),
                                     detail: L("지금 있는 할 일 · 메모 · 일정 · 기록이 이 백업으로 바뀌어요. 바꾸기 전 상태는 자동으로 백업해 둘게요."),
                                     choices: [.init(title: L("취소"), isCancel: true), .init(title: L("바꾸기"), role: .destructive, isDefault: true)])
            guard sure == 1 else { return }
            replace = true
        default: return
        }

        model.saveEverything()
        let result: [String: String]
        do {
            result = try apply(backup, replace: replace, folder: model.storageFolderURL) { model.stopSaving() }
        } catch {
            return fail(L("가져오지 못했어요."), (error as? Backup.Problem)?.message(.current) ?? error.localizedDescription)
        }

        let done = SlipAlert.run(symbol: "checkmark", title: L("가져오기"), message: L("가져왔어요."),
                                 detail: "\(Backup.summary(result).text(.current))\n" + L("가져오기 전 상태는 ‘backups’ 폴더에 있어요. 종이냥이 다시 시작돼요."),
                                 choices: [.init(title: L("백업 폴더 열기")), .init(title: L("확인"), role: .primary, isDefault: true, isCancel: true)],
                                 cat: .happy)
        if done == 0 { NSWorkspace.shared.open(backupsFolder) }
        restart()
    }

    // MARK: Files

    /// The backup file's text for what's in the folder now.
    static func exportText(folder: URL) throws -> String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        return Backup.make(files: try files(in: folder), exportedAt: Date(), from: "macOS \(version)")
    }

    /// 가져오기 itself: a safety copy of what's here, then the merged (or replacing) files written in.
    /// `beforeWriting` runs once everything is checked, just before the folder changes.
    @discardableResult
    static func apply(_ backup: Backup.Contents, replace: Bool, folder: URL, safety: URL = backupsFolder,
                      beforeWriting: () -> Void = {}) throws -> [String: String] {
        let current = try files(in: folder)
        try saveSafetyCopy(current, in: safety)
        let result = replace ? Backup.known(backup.files) : Backup.merge(current: current, imported: backup.files)
        try Backup.validate(result)
        beforeWriting()
        try place(result, in: folder, removeOthers: replace)
        return result
    }

    /// todos/memos/repeats/events/alarms and archive/*.jsonl as they are on disk.
    static func files(in folder: URL) throws -> [String: String] {
        var found: [String: String] = [:]
        for name in Backup.dataFiles {
            let url = folder.appendingPathComponent(name)
            if FileManager.default.fileExists(atPath: url.path) { found[name] = try String(contentsOf: url, encoding: .utf8) }
        }
        let archive = folder.appendingPathComponent("archive", isDirectory: true)
        for url in (try? FileManager.default.contentsOfDirectory(at: archive, includingPropertiesForKeys: nil)) ?? []
        where url.pathExtension == "jsonl" {
            found["archive/" + url.lastPathComponent] = try String(contentsOf: url, encoding: .utf8)
        }
        return found
    }


    /// Every file is written beside its place first; only when all are there do they replace the old ones.
    private static func place(_ files: [String: String], in folder: URL, removeOthers: Bool) throws {
        let manager = FileManager.default
        let archive = folder.appendingPathComponent("archive", isDirectory: true)
        try manager.createDirectory(at: archive, withIntermediateDirectories: true)
        var staged: [(URL, URL)] = []
        for (name, text) in files {
            let target = folder.appendingPathComponent(name)
            let temporary = target.deletingLastPathComponent().appendingPathComponent(".가져오는 중-" + target.lastPathComponent + ".tmp") // ko-only: a hidden file name
            try text.write(to: temporary, atomically: true, encoding: .utf8)
            staged.append((temporary, target))
        }
        for (temporary, target) in staged {
            if manager.fileExists(atPath: target.path) {
                _ = try manager.replaceItemAt(target, withItemAt: temporary)
            } else {
                try manager.moveItem(at: temporary, to: target)
            }
        }
        guard removeOthers else { return }
        // 바꾸기: what the backup doesn't have goes (it's in the safety copy).
        for name in Backup.dataFiles where files[name] == nil {
            try? manager.removeItem(at: folder.appendingPathComponent(name))
        }
        for url in (try? manager.contentsOfDirectory(at: archive, includingPropertiesForKeys: nil)) ?? []
        where url.pathExtension == "jsonl" && files["archive/" + url.lastPathComponent] == nil {
            try? manager.removeItem(at: url)
        }
    }

    // MARK: The safety copy

    nonisolated static var backupsFolder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "com.noa.PaperTodo", isDirectory: true)
            .appendingPathComponent("backups", isDirectory: true)
    }

    /// backups/가져오기-전-20261008-153012.jongi; the ten newest stay.
    private static func saveSafetyCopy(_ files: [String: String], in backupsFolder: URL) throws {
        let manager = FileManager.default
        try manager.createDirectory(at: backupsFolder, withIntermediateDirectories: true)
        let stamp = Date.FormatStyle().year(.defaultDigits).month(.twoDigits).day(.twoDigits)
        let clock = Date.FormatStyle().hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).second(.twoDigits)
        let now = Date()
        // The file name stays Korean in every language: old copies are found by it.
        let name = "가져오기-전-" + now.formatted(stamp).filter(\.isNumber) + "-" + now.formatted(clock).filter(\.isNumber) + ".jongi" // ko-only
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        try Backup.make(files: files, exportedAt: now, from: "macOS \(version)")
            .write(to: backupsFolder.appendingPathComponent(name), atomically: true, encoding: .utf8)
        let old = ((try? manager.contentsOfDirectory(at: backupsFolder, includingPropertiesForKeys: nil)) ?? [])
            .filter { $0.lastPathComponent.hasPrefix("가져오기-전-") } // ko-only
            .sorted { $0.lastPathComponent > $1.lastPathComponent }
        for url in old.dropFirst(10) { try? manager.removeItem(at: url) }
    }

    // MARK: Helpers

    /// "macOS 1.31.0에서 10월 8일 15:30 내보냄", "Exported from macOS 1.31.0 on Oct 8, 3:30 PM"
    /// The question's lines: the file, where and when it was made, what's in it, and the two ways in.
    static func importDetail(fileName: String, backup: Backup.Contents) -> String {
        "\(fileName)\n\(origin(backup))\n\(Backup.summary(backup.files).text(.current))\n\n"
            + L("합치기: 지금 것은 그대로 두고 없는 것만 더해요.\n바꾸기: 지금 것을 모두 이 백업으로 바꿔요.")
    }

    /// 바꾸기 replaces everything: clay, on the left, away from the default 합치기.
    static var importChoices: [SlipAlert.Choice] {
        [.init(title: L("취소"), isCancel: true), .init(title: L("바꾸기"), role: .danger, leading: true),
         .init(title: L("합치기"), role: .primary, isDefault: true)]
    }

    private static func origin(_ backup: Backup.Contents) -> String {
        // "10월 8일 14:30" (the Korean format style gave "10. 8. 02:30", a 12-hour clock without 오후).
        guard let when = Backup.exportedText(backup.exportedAt, language: .current) else {
            return backup.from.isEmpty ? "" : L("\(backup.from)에서 내보냄")
        }
        return backup.from.isEmpty ? L("\(when) 내보냄") : L("\(backup.from)에서 \(when) 내보냄")
    }

    private static func fail(_ title: String, _ detail: String) {
        SlipAlert.inform(title: L("백업 · 옮기기"), message: title, detail: detail)
    }

    /// A fresh start on the new files; the quit path (which saves) is skipped on purpose.
    private static func restart() {
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.createsNewApplicationInstance = true
        NSWorkspace.shared.openApplication(at: Bundle.main.bundleURL, configuration: configuration) { _, _ in
            DispatchQueue.main.async { exit(0) }
        }
    }
}
