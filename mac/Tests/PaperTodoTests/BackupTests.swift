import Foundation
import PaperCore

// Backups on this Mac (#137, #139): every case runs in fictional temporary folders, never the app's own.

private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private func expectEqual<T: Equatable>(_ actual: @autoclosure () throws -> T, _ expected: T, _ message: String) throws {
    let value = try actual()
    if value != expected { throw TestFailure(description: "\(message): expected \(expected), got \(value)") }
}

private func temporary() -> URL {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent("PaperTodo-backup-tests-\(UUID().uuidString)", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

private func todos(_ titles: String...) -> String {
    let items = titles.enumerated().map { index, title in
        ##"{"createdAt":"2026-10-01T09:00:00Z","id":"00000000-0000-4000-8000-00000000000\##(index)","isCompleted":false,"title":"\##(title)"}"##
    }
    return ##"{"items":["## + items.joined(separator: ",") + "]}\n"
}

private func titles(_ text: String?) throws -> [String] {
    guard let text else { return [] }
    return try JSONDecoder.backupTests.decode(Notebook.self, from: Data(text.utf8)).items.map(\.title)
}

private extension JSONDecoder {
    static var backupTests: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

private func write(_ text: String, _ name: String, in folder: URL) throws {
    let url = folder.appendingPathComponent(name)
    try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
    try text.write(to: url, atomically: true, encoding: .utf8)
}

@main
private enum BackupTests {
    @MainActor
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        var made: [URL] = []
        defer { for url in made { try? FileManager.default.removeItem(at: url) } }
        func folder() -> URL { let url = temporary(); made.append(url); return url }

        try test("#137: overwriting a folder's list with this one backs that list up first (as before an import)") {
            let current = folder(), destination = folder(), backups = folder().appendingPathComponent("backups")
            try write(todos("이 Mac의 할 일"), "todos.json", in: current)
            try write(todos("폴더의 할 일", "회의 자료 정리"), "todos.json", in: destination)
            let line = ##"{"completedAt":"2026-10-01T10:00:00Z","createdAt":"2026-10-01T09:00:00Z","id":"a","title":"끝낸 일"}"##
            try write(line + "\n", "archive/2026-10.jsonl", in: destination)
            let now = Calendar.paper.date(from: DateComponents(year: 2026, month: 10, day: 30, hour: 9, minute: 12))!
            try StorageFolder.move(from: current, to: destination, copyCurrent: true, backups: backups, now: now)
            try expectEqual(try FileManager.default.contentsOfDirectory(atPath: backups.path), ["폴더-바꾸기-전-20261030-091200.jongi"], "one copy")
            let saved = try Backup.parse(String(contentsOf: backups.appendingPathComponent("폴더-바꾸기-전-20261030-091200.jongi"), encoding: .utf8))
            try expectEqual(try titles(saved.files["todos.json"]), ["폴더의 할 일", "회의 자료 정리"], "the folder's list is in it")
            try expectEqual(saved.files["archive/2026-10.jsonl"], line + "\n", "…with its record")
            try expectEqual(try titles(String(contentsOf: destination.appendingPathComponent("todos.json"), encoding: .utf8)), ["이 Mac의 할 일"], "then this list is there")
        }

        try test("#137: no backup when nothing is overwritten (an empty folder, or the folder's list kept)") {
            let current = folder(), backups = folder().appendingPathComponent("backups")
            try write(todos("이 Mac의 할 일"), "todos.json", in: current)
            try StorageFolder.move(from: current, to: folder(), copyCurrent: true, backups: backups)
            let kept = folder()
            try write(todos("폴더의 할 일"), "todos.json", in: kept)
            try StorageFolder.move(from: current, to: kept, copyCurrent: false, backups: backups)
            try expect(!FileManager.default.fileExists(atPath: backups.path), "no backups folder")
            try expectEqual(try titles(String(contentsOf: kept.appendingPathComponent("todos.json"), encoding: .utf8)), ["폴더의 할 일"], "the folder's list stays")
        }

        try test("#137: a backup that can't be written stops the move") {
            let current = folder(), destination = folder()
            let blocked = folder().appendingPathComponent("backups")
            try "a file where the folder should be".write(to: blocked, atomically: true, encoding: .utf8)
            try write(todos("이 Mac의 할 일"), "todos.json", in: current)
            try write(todos("폴더의 할 일"), "todos.json", in: destination)
            var threw = false
            do { try StorageFolder.move(from: current, to: destination, copyCurrent: true, backups: blocked) } catch { threw = true }
            try expect(threw, "the move stops")
            try expectEqual(try titles(String(contentsOf: destination.appendingPathComponent("todos.json"), encoding: .utf8)), ["폴더의 할 일"], "the folder's list is untouched")
        }

        try test("the copies before an import: the ten newest are kept") {
            let backups = folder()
            for second in 0..<13 {
                let at = Calendar.paper.date(from: DateComponents(year: 2026, month: 10, day: 8, hour: 14, minute: 30, second: second))!
                try BackupController.saveCopy([:], reason: .beforeImport, in: backups, now: at)
            }
            let kept = try FileManager.default.contentsOfDirectory(atPath: backups.path).sorted()
            try expectEqual(kept.count, 10, "ten")
            try expectEqual(kept.first, "가져오기-전-20261008-143003.jongi", "oldest kept")
            try expectEqual(kept.last, "가져오기-전-20261008-143012.jongi", "newest")
        }

        let calendar = Calendar.paper
        func at(_ month: Int, _ day: Int, _ hour: Int, _ minute: Int = 0) -> Date {
            calendar.date(from: DateComponents(year: 2026, month: month, day: day, hour: hour, minute: minute))!
        }
        func names(_ folder: URL) -> [String] { ((try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []).sorted() }

        try test("#139: the daily copy — once a 4 a.m. day, only when something changed, with its reason and counts") {
            let storage = folder(), backups = folder()
            try write(todos("보고서 쓰기", "장보기"), "todos.json", in: storage)
            let first = try BackupBook.dailyCopy(storage: storage, folder: backups, fingerprint: nil, now: at(10, 30, 9, 12))
            try expect(first != nil, "the first one")
            try expectEqual(names(backups), ["매일-20261030-091200.jongi"], "named")
            let saved = try Backup.parse(String(contentsOf: backups.appendingPathComponent("매일-20261030-091200.jongi"), encoding: .utf8))
            try expect(saved.reason == .daily && saved.counts == Backup.Counts(todos: 2), "B4 fields")
            try expect(try BackupBook.dailyCopy(storage: storage, folder: backups, fingerprint: first, now: at(10, 31, 9, 0)) == nil, "nothing changed: none the next day")
            try write(todos("보고서 쓰기", "장보기", "팀 회의"), "todos.json", in: storage)
            try expect(try BackupBook.dailyCopy(storage: storage, folder: backups, fingerprint: first, now: at(10, 31, 3, 59)) == nil, "before 4 a.m. is still the 30th")
            let second = try BackupBook.dailyCopy(storage: storage, folder: backups, fingerprint: first, now: at(10, 31, 4, 0))
            try expect(second != nil && second != first, "changed, a new day")
            try expect(try BackupBook.dailyCopy(storage: storage, folder: backups, fingerprint: first, now: at(10, 31, 20, 0)) == nil, "one a day")
            try expect(try BackupBook.dailyCopy(storage: folder(), folder: backups, fingerprint: nil, now: at(11, 1, 9, 0)) == nil, "an empty folder: none")
            for day in 1...20 { _ = try BackupBook.dailyCopy(storage: storage, folder: backups, fingerprint: "\(day)", now: at(11, day, 9)) }
            try expectEqual(names(backups).count, 14, "fourteen daily ones stay")
            try expectEqual(names(backups).first, "매일-20261107-090000.jongi", "the oldest ones went")
        }

        try test("#139: the first launch of a new version copies the list before it's read; once per version") {
            let storage = folder(), backups = folder()
            let suite = TestDefaults("BackupTests")
            let preferences = suite.defaults
            defer { suite.remove() }
            try expect(BackupBook.beforeUpdate(storage: storage, defaultFolder: backups, preferences: preferences, version: "1.45.1", now: at(10, 29, 9)) == nil, "no list yet: none")
            try write(todos("보고서 쓰기"), "todos.json", in: storage)
            try expect(BackupBook.beforeUpdate(storage: storage, defaultFolder: backups, preferences: preferences, version: "1.45.1", now: at(10, 29, 10)) == nil, "the same version: none")
            let copy = BackupBook.beforeUpdate(storage: storage, defaultFolder: backups, preferences: preferences, version: "1.46.0", now: at(10, 30, 8))
            try expectEqual(copy?.lastPathComponent, "업데이트-전-20261030-080000.jongi", "a new version")
            try expect(BackupBook.beforeUpdate(storage: storage, defaultFolder: backups, preferences: preferences, version: "1.46.0", now: at(10, 30, 9)) == nil, "once")
            try expectEqual(preferences.string(forKey: BackupBook.versionKey), "1.46.0", "remembered")
        }

        try test("#139: copies go to the chosen folder; while it's gone, to the default one; never inside the storage folder") {
            let storage = folder(), fallback = folder(), chosen = folder()
            try write(todos("보고서 쓰기"), "todos.json", in: storage)
            let suite = TestDefaults("BackupTests")
            let preferences = suite.defaults
            defer { suite.remove() }
            let book = BackupBook(storageFolder: storage, defaultFolder: fallback, preferences: preferences)
            book.now = { at(10, 30, 9, 12) }
            try expect(!book.choose(storage) && !book.choose(storage.appendingPathComponent("backups")), "the storage folder and inside it are refused")
            try expect(book.chosenFolder == nil, "nothing chosen")
            try expect(book.choose(chosen) && book.activeFolder == chosen, "chosen")
            try book.copy(.manual)
            try expectEqual(names(chosen), ["직접-20261030-091200.jongi"], "in the chosen folder")
            try FileManager.default.removeItem(at: chosen)
            try expect(book.chosenMissing && book.activeFolder == fallback, "gone: the default one")
            try book.copy(.manual)
            try expectEqual(names(fallback), ["직접-20261030-091200.jongi"], "in the default folder")
            try expect(!FileManager.default.fileExists(atPath: chosen.path), "the missing folder isn't made again")
            book.resetFolder()
            try expect(book.chosenFolder == nil && preferences.string(forKey: BackupBook.folderKey) == nil, "기본으로")
            try expect(book.entries.map(\.name) == ["직접-20261030-091200.jongi"] && book.entries.first?.reason == .manual, "listed")
        }

        try test("#140: restoring makes a 되돌리기-전 copy first; 합치기 brings back what was deleted, 바꾸기 takes the copy") {
            let storage = folder(), backups = folder()
            try write(todos("보고서 쓰기", "장보기"), "todos.json", in: storage)
            let old = try BackupController.saveCopy(BackupController.files(in: storage), reason: .daily, in: backups, now: at(10, 28, 8, 55))
            try write(##"{"items":[{"createdAt":"2026-10-01T09:00:00Z","id":"00000000-0000-4000-8000-000000000000","isCompleted":false,"title":"보고서 쓰기"},{"createdAt":"2026-10-01T09:00:00Z","id":"00000000-0000-4000-8000-000000000009","isCompleted":false,"title":"팀 회의"}]}"##, "todos.json", in: storage)
            let copy = try Backup.parse(String(contentsOf: old, encoding: .utf8))
            let merged = try BackupController.apply(copy, replace: false, folder: storage, safety: backups, reason: .beforeRestore, now: at(10, 30, 10))
            try expectEqual(try titles(merged["todos.json"]), ["보고서 쓰기", "팀 회의", "장보기"], "merge: the deleted one comes back")
            try expectEqual(names(backups), ["되돌리기-전-20261030-100000.jongi", "매일-20261028-085500.jongi"], "a copy before")
            let before = try Backup.parse(String(contentsOf: backups.appendingPathComponent("되돌리기-전-20261030-100000.jongi"), encoding: .utf8))
            try expect(before.reason == .beforeRestore && before.counts == Backup.Counts(todos: 2), "its reason and counts")
            let replaced = try BackupController.apply(copy, replace: true, folder: storage, safety: backups, reason: .beforeRestore, now: at(10, 30, 11))
            try expectEqual(try titles(replaced["todos.json"]), ["보고서 쓰기", "장보기"], "replace: as it was then")
            try expectEqual(try titles(String(contentsOf: storage.appendingPathComponent("todos.json"), encoding: .utf8)), ["보고서 쓰기", "장보기"], "on disk")
            try expect(BackupBook.peekCounts(old) == Backup.Counts(todos: 2), "the list reads what a copy holds")
            let older = backups.appendingPathComponent("직접-20261001-090000.jongi")
            try Backup.make(files: ["todos.json": todos("가", "나", "다")], exportedAt: at(10, 1, 9), from: "macOS 1.45.0").write(to: older, atomically: true, encoding: .utf8)
            try expect(BackupBook.peekCounts(older) == Backup.Counts(todos: 3), "…counted from the files when it has no counts")
        }

        // #173 (security review L-04 · L-05): the shared cases of docs/plans/file-safety-cases.json (the Windows app's
        // test/fileSafety.test.ts reads the same file).
        let casesURL = URL(fileURLWithPath: "../docs/plans/file-safety-cases.json")
        let cases = try JSONSerialization.jsonObject(with: Data(contentsOf: casesURL)) as! [String: Any]
        let limits = cases["limits"] as! [String: Int]
        let manager = FileManager.default
        func contents(_ name: String) -> String {
            name.hasSuffix(".jsonl") ? ##"{"id":"a","title":"x"}"## + "\n" : name == "todos.json" ? todos("x") : name == "memos.json" ? ##"{"memos":[]}"## + "\n" : "[]\n"
        }
        /// A sparse file of exactly `bytes`: only its size is looked at before reading.
        func sized(_ url: URL, _ bytes: Int) throws {
            try manager.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            manager.createFile(atPath: url.path, contents: nil)
            let handle = try FileHandle(forWritingTo: url)
            try handle.truncate(atOffset: UInt64(bytes))
            try handle.close()
        }

        try test("#173: the limits are the shared ones (64MB .jongi, 32MB data file)") {
            try expectEqual(FileLimits.backupBytes, limits["backupBytes"]!, "backup")
            try expectEqual(FileLimits.dataFileBytes, limits["dataFileBytes"]!, "data file")
        }

        for entry in cases["links"] as! [[String: String]] {
            try test("#173 \(entry["id"]!): \(entry["about"]!)") {
                let storage = folder(), outside = folder()
                let name = entry["file"]!
                let secret = outside.appendingPathComponent("elsewhere.txt")
                try contents(name).write(to: secret, atomically: true, encoding: .utf8)
                try write("[]\n", "repeats.json", in: storage)
                let place = storage.appendingPathComponent(name)
                if entry["expect"] == "read" {
                    try write(contents(name), name, in: storage)
                } else {
                    try manager.createDirectory(at: place.deletingLastPathComponent(), withIntermediateDirectories: true)
                    try manager.createSymbolicLink(at: place, withDestinationURL: secret)
                }
                if entry["where"] == "read" {
                    let (files, skipped) = try BackupController.read(storage)
                    if entry["expect"] == "skipped" {
                        try expect(files[name] == nil && skipped == [name], "skipped")
                        try expectEqual(files["repeats.json"], "[]\n", "the other files are read")
                    } else {
                        try expectEqual(files[name], contents(name), "read")
                        try expect(skipped.isEmpty, "nothing skipped")
                    }
                } else {
                    let imported = try Backup.parse(Backup.make(files: ["todos.json": todos("가져온 것"), name: ##"{"memos":[]}"##], exportedAt: at(10, 30, 9), from: "test"))
                    try BackupController.apply(imported, replace: true, folder: storage, safety: folder(), now: at(10, 30, 9))
                    try expect(SafeFile.entry(place)?.isLink == true, "the link stays a link")
                    try expectEqual(try String(contentsOf: secret, encoding: .utf8), contents(name), "what it points at is untouched")
                    try expectEqual(try titles(String(contentsOf: storage.appendingPathComponent("todos.json"), encoding: .utf8)), ["가져온 것"], "the other files go in")
                }
            }
        }

        for entry in cases["size"] as! [[String: String]] {
            try test("#173 \(entry["id"]!): \(entry["about"]!)") {
                let storage = folder()
                let isBackup = entry["kind"] == "backup"
                let limit = isBackup ? FileLimits.backupBytes : FileLimits.dataFileBytes
                let name = entry["file"] ?? (isBackup ? "직접-20261030-091200.jongi" : "todos.json")
                let url = storage.appendingPathComponent(name)
                try sized(url, entry["bytes"] == "limit" ? limit : limit + 1)
                if entry["expect"] == "allowed" {
                    try expect(!SafeFile.isRefused(url, limit: limit), "allowed")
                    return
                }
                try expect(SafeFile.isRefused(url, limit: limit), "refused")
                if isBackup {
                    // 가져오기 (the file picked) and 되돌리기 (a copy in the backup folder) both refuse it before reading.
                    for chosen in [true, false] {
                        do { _ = try BackupController.backupText(url, chosen: chosen); throw TestFailure(description: "read anyway") }
                        catch let problem as Backup.Problem { try expect(problem == .tooLarge, "too large (chosen: \(chosen))") }
                    }
                    try expect(BackupBook.peekCounts(url) == nil, "the list doesn't read its counts")
                } else {
                    let (files, skipped) = try BackupController.read(storage)
                    try expect(files[name] == nil && skipped == [name], "not in a backup")
                }
            }
        }

        try test("#173: the refusal's words (ko · en · nl), the same as the Windows app's") {
            let words = (cases["messages"] as! [String: [String: String]])["tooLarge"]!
            try expectEqual(Backup.Problem.tooLarge.message(.ko), words["ko"]!, "ko")
            try expectEqual(Backup.Problem.tooLarge.message(.en), words["en"]!, "en")
            try expectEqual(Backup.Problem.tooLarge.message(.nl), words["nl"]!, "nl")
        }

        for entry in cases["temporary"] as! [[String: String]] {
            try test("#173 \(entry["id"]!): \(entry["about"]!)") {
                let storage = folder()
                let target = storage.appendingPathComponent(entry["file"]!)
                switch entry["expect"] {
                case "unique":
                    try expectEqual(Set((0..<50).map { _ in SafeFile.temporaryURL(beside: target).lastPathComponent }).count, 50, "unique")
                case "beside":
                    let temporary = SafeFile.temporaryURL(beside: target)
                    try expect(temporary.deletingLastPathComponent() == storage && temporary.lastPathComponent.hasPrefix(".\(entry["file"]!).")
                               && temporary.lastPathComponent != "\(entry["file"]!).tmp", "beside, its own name")
                case "untouched":
                    let secret = folder().appendingPathComponent("elsewhere.txt")
                    try "keep me".write(to: secret, atomically: true, encoding: .utf8)
                    try manager.createSymbolicLink(at: storage.appendingPathComponent(entry["planted"]!), withDestinationURL: secret)
                    let imported = try Backup.parse(Backup.make(files: ["todos.json": todos("저장")], exportedAt: at(10, 30, 9), from: "test"))
                    try BackupController.apply(imported, replace: false, folder: storage, safety: folder(), now: at(10, 30, 9))
                    try expectEqual(try String(contentsOf: secret, encoding: .utf8), "keep me", "the planted link isn't followed")
                    try expectEqual(try titles(String(contentsOf: target, encoding: .utf8)), ["저장"], "written")
                default:
                    let imported = try Backup.parse(Backup.make(files: ["todos.json": todos("한 번")], exportedAt: at(10, 30, 9), from: "test"))
                    try BackupController.apply(imported, replace: true, folder: storage, safety: folder(), now: at(10, 30, 9))
                    try expectEqual(names(storage).filter { $0.hasSuffix(".tmp") }, [], "no temporary file left")
                }
            }
        }

        try test("#173: moving the storage folder skips a linked month and a linked or oversized file on either side") {
            let current = folder(), destination = folder(), outside = folder()
            let secret = outside.appendingPathComponent("elsewhere.jsonl")
            try ##"{"id":"secret","title":"남의 것"}"##.appending("\n").write(to: secret, atomically: true, encoding: .utf8)
            try write(todos("이 Mac"), "todos.json", in: current)
            try sized(current.appendingPathComponent(MemoTrash.fileName), FileLimits.dataFileBytes + 1)
            try manager.createDirectory(at: current.appendingPathComponent("archive"), withIntermediateDirectories: true)
            try manager.createSymbolicLink(at: current.appendingPathComponent("archive/2026-09.jsonl"), withDestinationURL: secret)
            try write(##"{"id":"a","title":"내 것"}"## + "\n", "archive/2026-10.jsonl", in: current)
            try manager.createDirectory(at: destination.appendingPathComponent("archive"), withIntermediateDirectories: true)
            try manager.createSymbolicLink(at: destination.appendingPathComponent("archive/2026-10.jsonl"), withDestinationURL: secret)
            try StorageFolder.move(from: current, to: destination, copyCurrent: true, backups: folder(), now: at(10, 30, 9))
            try expect(!manager.fileExists(atPath: destination.appendingPathComponent("archive/2026-09.jsonl").path), "the linked month isn't copied")
            try expect(!manager.fileExists(atPath: destination.appendingPathComponent(MemoTrash.fileName).path), "the oversized file isn't copied")
            try expectEqual(try String(contentsOf: secret, encoding: .utf8), ##"{"id":"secret","title":"남의 것"}"## + "\n", "nothing written through the link")
            try expectEqual(try titles(String(contentsOf: destination.appendingPathComponent("todos.json"), encoding: .utf8)), ["이 Mac"], "the rest moves")
        }

        // 저장과 백업의 백업 한 줄 (#240, D2 C): the shared cases from docs/plans/storage-summary-cases.json (the Windows
        // app's test/backup.test.ts reads the same file).
        try test("backup status: when the last copy was, or what is wrong, in ko · en · nl (shared cases)") {
            let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: "../docs/plans/storage-summary-cases.json"))) as! [String: Any]
            let date = { (parts: [NSNumber]) in
                Calendar.paper.date(from: DateComponents(year: parts[0].intValue, month: parts[1].intValue, day: parts[2].intValue,
                                                         hour: parts[3].intValue, minute: parts[4].intValue))!
            }
            let now = date(file["now"] as! [NSNumber])
            for entry in file["cases"] as! [[String: Any]] {
                for language in AppLanguage.allCases {
                    let got = Backup.status(auto: entry["auto"] as! Bool, failed: entry["failed"] as! Bool, missing: entry["missing"] as! Bool,
                                            newest: (entry["newest"] as? [NSNumber]).map(date), now: now, language: language)
                    try expectEqual([got.title, got.detail], entry[language.rawValue] as! [String], "\(entry["case"]!) \(language.rawValue)")
                    try expectEqual(got.tone.rawValue, entry["tone"] as! String, "\(entry["case"]!) tone")
                }
            }
        }

        print("\(count) backup tests passed")
    }
}
