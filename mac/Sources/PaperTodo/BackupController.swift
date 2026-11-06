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
        TestHooks.activate()
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
        TestHooks.activate()
        guard panel.runModal() == .OK, let url = panel.url else { return }
        let backup: Backup.Contents
        do {
            backup = try Backup.parse(backupText(url, chosen: true))
        } catch let problem as Backup.Problem {
            return fail(L("가져오지 못했어요. 지금 목록은 그대로예요."), problem.message(.current))
        } catch {
            return fail(L("가져오지 못했어요. 지금 목록은 그대로예요."), Backup.Problem.notBackup.message(.current))
        }

        let ask = SlipAlert.run(symbol: "square.and.arrow.down", title: L("가져오기"), message: L("이 백업을 가져올까요?"), replacesList: true,
                                detail: importDetail(fileName: url.lastPathComponent, backup: backup), choices: importChoices, width: .medium)
        let replace: Bool
        switch ask {
        case 2: replace = false
        case 1:
            let sure = SlipAlert.run(symbol: "arrow.triangle.2.circlepath", title: L("바꾸기"), message: L("지금 것을 이 백업으로 바꿀까요?"), replacesList: true,
                                     detail: L("지금 있는 할 일 · 메모 · 일정 · 기록이 이 백업으로 바뀌어요. 바꾸기 전 상태는 자동으로 백업해 둘게요."),
                                     choices: [.init(title: L("취소"), isCancel: true), .init(title: L("바꾸기"), role: .destructive, isDefault: true)])
            guard sure == 1 else { return }
            replace = true
        default: return
        }

        model.saveEverything()
        let safety = model.backups?.activeFolder ?? backupsFolder
        model.backups?.busy = true
        let result: [String: String]
        do {
            result = try apply(backup, replace: replace, folder: model.storageFolderURL, safety: safety) { model.stopSaving() }
        } catch {
            model.backups?.busy = false
            return fail(L("가져오지 못했어요. 지금 목록은 그대로예요."), (error as? Backup.Problem)?.message(.current))
        }

        let done = SlipAlert.run(symbol: "checkmark", title: L("가져오기"), message: L("가져왔어요."), replacesList: true,
                                 detail: "\(Backup.summary(result).text(.current))\n" + L("종이냥이 다시 시작돼요. 가져오기 전 것도 ‘backups’ 폴더에 남겨 뒀어요."),
                                 choices: [.init(title: L("백업 폴더 열기")), .init(title: L("다시 시작"), role: .primary, isDefault: true, isCancel: true)],
                                 cat: .happy)
        if done == 0 { NSWorkspace.shared.open(safety) }
        restart()
    }

    // MARK: Restore (#140)

    /// 백업 목록 → 되돌리기…: the copy read and checked, the question (합치기 by default, 바꾸기 on the left in clay),
    /// then what's here goes to a 되돌리기-전-… copy and the copy's files go in, as for an import; the app restarts.
    static func restore(_ entry: BackupBook.Entry, book: BackupBook, model: AppModel) {
        let backup: Backup.Contents
        do {
            backup = try Backup.parse(backupText(entry.url, chosen: false))
        } catch {
            return SlipAlert.inform(title: String(localized: "되돌리기", table: "Settings"), message: L("되돌리지 못했어요. 지금 목록은 그대로예요."),
                                    detail: ((error as? Backup.Problem) ?? .notBackup).message(.current))
        }
        let when = Backup.savedWhen(entry.date, now: book.now(), language: .current, midSentence: true)
        let answer = SlipAlert.run(symbol: "clock.arrow.circlepath", title: String(localized: "되돌리기", table: "Settings"), message: L("\(when) 백업으로 되돌릴까요?"), replacesList: true,
                                   detail: restoreDetail(backup, shared: model.sharedFolder != nil), choices: importChoices, width: .medium)
        guard answer == 1 || answer == 2 else { return }
        model.saveEverything()
        book.busy = true
        let result: [String: String]
        do {
            result = try apply(backup, replace: answer == 1, folder: model.storageFolderURL, safety: book.activeFolder, reason: .beforeRestore) { model.stopSaving() }
        } catch {
            book.busy = false
            return SlipAlert.inform(title: String(localized: "되돌리기", table: "Settings"), message: L("되돌리지 못했어요. 지금 목록은 그대로예요."),
                                    detail: (error as? Backup.Problem)?.message(.current))
        }
        SlipAlert.run(symbol: "checkmark", title: String(localized: "되돌리기", table: "Settings"), message: L("되돌렸어요."), replacesList: true,
                      detail: "\(Backup.summary(result).text(.current))\n" + L("종이냥이 다시 시작돼요. 되돌리기 전 것도 백업 목록에 남겨 뒀어요."),
                      choices: [.init(title: L("다시 시작"), role: .primary, isDefault: true, isCancel: true)], cat: .happy)
        restart()
    }

    /// The restore question's lines: what the copy holds, the two ways back, and — with a shared folder — that the
    /// other devices' list changes too.
    static func restoreDetail(_ backup: Backup.Contents, shared: Bool) -> String {
        let counts = backup.counts ?? Backup.Counts(backup.files)
        return counts.text(.current).keptTogether + "\n\n" + L("합치기: 지금 것은 두고, 그 뒤에 지운 것만 되살려요.") + "\n" + L("바꾸기: 지금 것을 모두 그때로 바꿔요.")
            + "\n" + L("어느 쪽이든 지금 것은 먼저 백업해 둬요.") + (shared ? "\n" + L("다른 기기의 목록도 같이 바뀌어요.") : "")
    }

    // MARK: Files

    /// The backup file's text for what's in the folder now.
    static func exportText(folder: URL) throws -> String {
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        return Backup.make(files: try files(in: folder), exportedAt: Date(), from: "macOS \(version)", reason: .export)
    }

    /// 가져오기 (and 되돌리기) itself: a safety copy of what's here, then the merged (or replacing) files written in.
    /// `beforeWriting` runs once everything is checked, just before the folder changes.
    @discardableResult
    static func apply(_ backup: Backup.Contents, replace: Bool, folder: URL, safety: URL = backupsFolder, reason: Backup.Reason = .beforeImport,
                      now: Date = Date(), beforeWriting: () -> Void = {}) throws -> [String: String] {
        let current = try files(in: folder)
        try saveCopy(current, reason: reason, in: safety, now: now)
        let result = replace ? Backup.known(backup.files) : Backup.merge(current: current, imported: backup.files)
        try Backup.validate(result)
        beforeWriting()
        try place(result, in: folder, removeOthers: replace)
        return result
    }

    /// todos/memos/repeats/events/alarms/memo-trash … and archive/*.jsonl as they are on disk. #173 (review L-04 · L-05):
    /// a link, or a file past FileLimits.dataFileBytes (32MB), is skipped — its name goes to `skipped`.
    nonisolated static func files(in folder: URL) throws -> [String: String] { try read(folder).files }

    /// files(in:) and the names it skipped.
    nonisolated static func read(_ folder: URL) throws -> (files: [String: String], skipped: [String]) {
        var found: [String: String] = [:]
        var skipped: [String] = []
        func read(_ name: String, _ url: URL) throws {
            do {
                if let text = try SafeFile.text(url) { found[name] = text }
            } catch is SafeFile.Refusal {
                skipped.append(name)
            }
        }
        for name in Backup.dataFiles { try read(name, folder.appendingPathComponent(name)) }
        let archive = folder.appendingPathComponent("archive", isDirectory: true)
        guard SafeFile.entry(archive)?.isLink != true else { return (found, skipped) }
        for url in ((try? FileManager.default.contentsOfDirectory(at: archive, includingPropertiesForKeys: nil)) ?? []).sorted(by: { $0.lastPathComponent < $1.lastPathComponent })
        where url.pathExtension == "jsonl" {
            try read("archive/" + url.lastPathComponent, url)
        }
        return (found, skipped)
    }

    /// #173: a .jongi's text — the file the person picked (`chosen`: a link of theirs is followed) or a copy in the
    /// backup folder (never through a link). Past FileLimits.backupBytes (64MB) it is not read: Problem.tooLarge.
    nonisolated static func backupText(_ url: URL, chosen: Bool) throws -> String {
        if chosen {
            let size = (try? FileManager.default.attributesOfItem(atPath: url.resolvingSymlinksInPath().path)[.size] as? Int) ?? 0
            if size > FileLimits.backupBytes { throw Backup.Problem.tooLarge }
            return try String(contentsOf: url, encoding: .utf8)
        }
        do {
            guard let text = try SafeFile.text(url, limit: FileLimits.backupBytes) else { throw Backup.Problem.notBackup }
            return text
        } catch SafeFile.Refusal.tooLarge {
            throw Backup.Problem.tooLarge
        } catch is SafeFile.Refusal {
            throw Backup.Problem.notBackup
        }
    }


    /// Every file is written beside its place first; only when all are there do they replace the old ones.
    private static func place(_ files: [String: String], in folder: URL, removeOthers: Bool) throws {
        let manager = FileManager.default
        let archive = folder.appendingPathComponent("archive", isDirectory: true)
        try manager.createDirectory(at: archive, withIntermediateDirectories: true)
        var staged: [(URL, URL)] = []
        for (name, text) in files {
            let target = folder.appendingPathComponent(name)
            // #173: a target that is a link, or past the size limit (left out of `current` by files(in:)), stays as it is;
            // the temporary file beside it has a random name.
            if SafeFile.isRefused(target) { continue }
            let temporary = SafeFile.temporaryURL(beside: target, prefix: ".가져오는 중-") // ko-only: a hidden file name
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
        for name in Backup.dataFiles where files[name] == nil && !SafeFile.isRefused(folder.appendingPathComponent(name)) {
            try? manager.removeItem(at: folder.appendingPathComponent(name))
        }
        for url in (try? manager.contentsOfDirectory(at: archive, includingPropertiesForKeys: nil)) ?? []
        where url.pathExtension == "jsonl" && files["archive/" + url.lastPathComponent] == nil && !SafeFile.isRefused(url) {
            try? manager.removeItem(at: url)
        }
    }

    // MARK: The safety copy

    nonisolated static var backupsFolder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "com.noa.PaperTodo", isDirectory: true)
            .appendingPathComponent("backups", isDirectory: true)
    }

    /// backups/가져오기-전-20261008-153012.jongi (or 폴더-바꾸기-전-…, #137): what's here as a backup file, then the
    /// oldest of that kind past what it keeps (Backup.prune: ten of each ‘before’ kind) removed. Returns the file.
    @discardableResult
    nonisolated static func saveCopy(_ files: [String: String], reason: Backup.Reason, in backupsFolder: URL, now: Date = Date()) throws -> URL {
        let manager = FileManager.default
        try manager.createDirectory(at: backupsFolder, withIntermediateDirectories: true)
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        // The file name stays Korean in every language: old copies are found by it.
        let url = backupsFolder.appendingPathComponent(Backup.savedName(reason, at: now))
        try Backup.make(files: files, exportedAt: now, from: "macOS \(version)", reason: reason).write(to: url, atomically: true, encoding: .utf8)
        let names = (try? manager.contentsOfDirectory(atPath: backupsFolder.path)) ?? []
        for name in Backup.prune(names) where Backup.saved(name)?.reason == reason {
            try? manager.removeItem(at: backupsFolder.appendingPathComponent(name))
        }
        return url
    }

    // MARK: Helpers

    /// "macOS 1.31.0에서 10월 8일 15:30 내보냄", "Exported from macOS 1.31.0 on Oct 8, 3:30 PM"
    /// The question's lines: the file, where and when it was made, what's in it, and the two ways in.
    static func importDetail(fileName: String, backup: Backup.Contents) -> String {
        "\(fileName)\n\(origin(backup))\n\(Backup.summary(backup.files).text(.current))\n\n"
            + L("합치기: 지금 것은 그대로 두고 없는 것만 더해요.\n바꾸기: 지금 것을 모두 이 백업으로 바꿔요.\n어느 쪽이든 지금 것은 먼저 백업해 둬요.")
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

    private static func fail(_ title: String, _ detail: String?) {
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
