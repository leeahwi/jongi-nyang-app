import Foundation

// #411: every shared data file through SyncedJSONFile, one case table — the same steps for each file with its own format
// (catching up, this Mac's own write, another writer, the same bytes again, a file written in place, a broken, unreadable
// or linked file, a blocked one). Temporary folders and made-up data only.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: Bool, _ message: String) throws {
    guard condition else { throw TestFailure(description: message) }
}

/// One shared file: its name, its format, and two values (this Mac's, another device's).
private struct FileCase {
    let name: String
    let run: (URL) throws -> Void

    init<Value: Equatable>(_ name: String, decode: @escaping (Data) throws -> Value, encode: @escaping (Value) throws -> Data,
                           mine: Value, theirs: Value) {
        self.name = name
        // As the file holds them (whole-second dates).
        run = { folder in
            try scenarios(folder.appendingPathComponent(name), decode: decode, encode: encode,
                          mine: try decode(try encode(mine)), theirs: try decode(try encode(theirs)))
        }
    }
}

private func scenarios<Value: Equatable>(_ url: URL, decode: @escaping (Data) throws -> Value, encode: @escaping (Value) throws -> Data,
                                         mine: Value, theirs: Value) throws {
    let name = url.lastPathComponent
    let synced = SyncedJSONFile(url: url, decode: decode, encode: encode)
    let file = synced.file
    /// Another app writing the file as a sync does: a new file renamed over it.
    func replace(_ data: Data) throws { try data.write(to: url, options: .atomic) }

    guard case .absent = synced.catchUp() else { throw TestFailure(description: "\(name): no file reads as absent") }
    try expect(file.reads == 0, "\(name): nothing read while there's no file")

    try replace(try encode(theirs))
    guard case .theirs(let value, let data) = synced.catchUp() else { throw TestFailure(description: "\(name): another device's file is theirs") }
    try expect(value == theirs && file.reads == 1, "\(name): read once, as written")
    synced.accept(data, as: value)
    guard case .same = synced.catchUp() else { throw TestFailure(description: "\(name): taken, it's the same") }
    try expect(file.reads == 1, "\(name): an unchanged stamp isn't read again (\(file.reads))")
    try expect(synced.knownValue == theirs, "\(name): the known value is the base of a merge")

    // This Mac's own write: the check right after it reads nothing (#411, V8 of the #412 review).
    let written = try synced.save(mine)
    try expect(try Data(contentsOf: url) == written && written == (try encode(mine)), "\(name): this Mac's bytes on disk")
    guard case .same = synced.catchUp() else { throw TestFailure(description: "\(name): this Mac's own write is the same") }
    try expect(file.reads == 1, "\(name): this Mac's own write isn't read back (\(file.reads))")
    try expect(file.known == written && synced.knownValue == mine, "\(name): what was written is what's known")

    // The same bytes again (a sync that puts the file back as it was): read once, then not again.
    try replace(written)
    guard case .same = synced.catchUp() else { throw TestFailure(description: "\(name): the same bytes are the same") }
    guard case .same = synced.catchUp() else { throw TestFailure(description: "\(name): and stay the same") }
    try expect(file.reads == 2, "\(name): the same bytes read once (\(file.reads))")

    // Written in place, the same size and the modification time set back: the change time still tells.
    var info = stat()
    _ = lstat(url.path, &info)
    var changed = written
    if let index = changed.lastIndex(of: UInt8(ascii: "}")) { changed[index] = UInt8(ascii: " ") }
    let handle = try FileHandle(forWritingTo: url)
    try handle.write(contentsOf: changed)
    try handle.close()
    var times = [timespec(tv_sec: info.st_atimespec.tv_sec, tv_nsec: info.st_atimespec.tv_nsec),
                 timespec(tv_sec: info.st_mtimespec.tv_sec, tv_nsec: info.st_mtimespec.tv_nsec)]
    _ = utimensat(AT_FDCWD, url.path, &times, 0)
    if case .same = synced.catchUp() { throw TestFailure(description: "\(name): a file written in place is noticed") }

    // Broken bytes: never taken, so the next check reads them again.
    try replace(Data("{".utf8))
    guard case .broken = synced.catchUp() else { throw TestFailure(description: "\(name): broken bytes are broken") }
    let reads = file.reads
    guard case .broken = synced.catchUp() else { throw TestFailure(description: "\(name): still broken") }
    try expect(file.reads == reads + 1, "\(name): bytes not taken are read again")

    // Not readable just now (no permission; a cloud file on its way reads the same).
    try replace(written)
    try FileManager.default.setAttributes([.posixPermissions: 0o000], ofItemAtPath: url.path)
    let unreadable = synced.catchUp()
    try FileManager.default.setAttributes([.posixPermissions: 0o644], ofItemAtPath: url.path)
    guard case .unreadable = unreadable else { throw TestFailure(description: "\(name): a file that can't be opened is unreadable") }

    // Blocked (#382): never written.
    file.blocked = true
    do {
        try synced.save(theirs)
        throw TestFailure(description: "\(name): a blocked file was written")
    } catch is SyncedFile.Blocked {}
    try expect(try Data(contentsOf: url) == written, "\(name): a blocked file keeps its bytes")
    file.blocked = false

    // A link where the file goes (#173) is never read through: no bytes, which no file decodes.
    let elsewhere = url.deletingLastPathComponent().appendingPathComponent("elsewhere-\(name)")
    try (try encode(theirs)).write(to: elsewhere)
    try FileManager.default.removeItem(at: url)
    try FileManager.default.createSymbolicLink(at: url, withDestinationURL: elsewhere)
    guard case .broken(let bytes) = synced.catchUp(), bytes.isEmpty else { throw TestFailure(description: "\(name): a link reads as no bytes") }
    // …and a write replaces the link rather than writing through it.
    try synced.save(mine)
    try expect(SafeFile.entry(url)?.isLink == false && (try Data(contentsOf: elsewhere)) == (try encode(theirs)), "\(name): the link is replaced")

    // Forgotten: the next check reads the file whatever it holds.
    synced.forget()
    guard case .theirs(let again, _) = synced.catchUp() else { throw TestFailure(description: "\(name): forgotten, the file is read") }
    try expect(again == mine && synced.knownValue == nil, "\(name): as written, nothing known")
}

@main
private enum SyncedFileTests {
    static func main() throws {
        let now = Date(timeIntervalSince1970: 1_793_000_000)
        var list = Notebook()
        _ = list.add("장보기")
        var theirList = list
        _ = theirList.add("우유 사기")
        let event = CalendarDraft(title: "회의", date: "2026-11-12", startMinutes: 600, endMinutes: 660).event(id: "event-1", now: now)
        let memo = Memo(id: "memo-1", text: "장보기\n우유, 달걀", createdAt: now, updatedAt: now)
        var folders = MemoFolders.fresh()
        _ = folders.addFolder(name: "공부", color: MemoFolders.Color.allCases[0], now: now, id: "folder-1")
        var trash = MemoTrash()
        trash.add(memo, folder: "inbox", pinned: false, paper: nil, now: now)
        var spaces = TodoSpaces()
        _ = spaces.addSpace(name: "회사", now: now, id: "space-1")

        let cases: [FileCase] = [
            FileCase("todos.json", decode: NotebookFile.decode, encode: NotebookFile.encode, mine: list, theirs: theirList),
            FileCase("repeats.json", decode: RepeatsFile.decode, encode: RepeatsFile.encode,
                     mine: [], theirs: [Series(id: "series-1", title: "물 마시기", rule: RepeatRule(kind: .daily), createdAt: now)]),
            FileCase("events.json", decode: { try JSONDecoder.iso.decode(LocalEvent.File.self, from: $0) }, encode: { try JSONEncoder.iso.encode($0) },
                     mine: LocalEvent.File(events: []), theirs: LocalEvent.File(events: [event])),
            FileCase("alarms.json", decode: Alarm.File.decode, encode: { try $0.encoded() },
                     mine: Alarm.File(alarms: []), theirs: Alarm.File(alarms: [Alarm(id: "alarm-1", time: "07:30", label: "일어나기")])),
            FileCase("memos.json", decode: MemoFile.decode, encode: MemoFile.encode, mine: [], theirs: [memo]),
            FileCase("memo-folders.json", decode: { try MemoFolders.decode($0) }, encode: { Data($0.encoded().utf8) },
                     mine: MemoFolders.fresh(), theirs: folders),
            FileCase("memo-trash.json", decode: MemoTrash.decode, encode: { Data($0.encoded().utf8) }, mine: MemoTrash(), theirs: trash),
            FileCase("todo-spaces.json", decode: TodoSpaces.decode, encode: { Data($0.encoded().utf8) }, mine: TodoSpaces(), theirs: spaces),
        ]
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("SyncedFile-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: folder) }
        for item in cases {
            try item.run(folder)
            print("PASS \(item.name): catch up, own write unread, same bytes once, in place, broken, unreadable, blocked, link")
        }
        print("\(cases.count) synced files passed")
    }
}

private extension JSONDecoder {
    static var iso: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

private extension JSONEncoder {
    static var iso: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return encoder
    }
}
