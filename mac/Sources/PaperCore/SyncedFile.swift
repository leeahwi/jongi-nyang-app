import Foundation

/// #411: one shared data file of the storage folder (todos.json, repeats.json, events.json, alarms.json, memos.json,
/// memo-folders.json, memo-trash.json, todo-spaces.json), the steps every one of them takes — the bytes this Mac knows,
/// catching up with the disk, an atomic write, a file that mustn't be written — in one place. What a file does with
/// another device's bytes (take them, merge by id, keep this Mac's) stays with the file; the write lock (AIWriteLock)
/// stays with the app.
///
/// Catching up is cheap when nothing changed: the file's stamp (which file, its size, when its bytes and its entry last
/// changed) is kept with the bytes, and an equal stamp means the same bytes, so they aren't read again. This Mac's own
/// write keeps the stamp of the file it put there, so the check after it reads nothing either.
public final class SyncedFile {
    /// What is at a path without reading it. A sync, an editor or another app that puts new bytes there changes at least
    /// one part: a replaced file is another inode, a file written in place gets a new change time (`ctime`, which no app
    /// can set back, unlike the modification time).
    public struct Stamp: Equatable, Sendable {
        let device: Int64
        let inode: UInt64
        let size: Int64
        let modified: Int64
        let changed: Int64

        init(_ info: stat) {
            device = Int64(info.st_dev)
            inode = UInt64(info.st_ino)
            size = Int64(info.st_size)
            modified = Int64(info.st_mtimespec.tv_sec) * 1_000_000_000 + Int64(info.st_mtimespec.tv_nsec)
            changed = Int64(info.st_ctimespec.tv_sec) * 1_000_000_000 + Int64(info.st_ctimespec.tv_nsec)
        }

        /// The entry at `url` itself (a link is not followed), nil when nothing is there.
        static func of(_ url: URL) -> Stamp? {
            var info = stat()
            return lstat(url.path, &info) == 0 ? Stamp(info) : nil
        }
    }

    /// The file on disk, next to what this Mac knows.
    public enum Look: Equatable, Sendable {
        /// The bytes this Mac last read or wrote.
        case same
        /// No file there (an iCloud Drive placeholder isn't one: see `SafeFile.isAbsent`).
        case absent
        /// There, but not readable just now (no permission, a cloud file on its way).
        case unreadable
        /// Other bytes: another device, Claude or a sync wrote it. A link or a file past the size limit reads as no bytes
        /// (`SafeFile.sharedData`), which no reader decodes.
        case changed(Data)
    }

    public struct Blocked: Error, Equatable {}

    public let url: URL
    /// The file's bytes as this Mac last read or wrote them; nil before the first, or when forgotten.
    public private(set) var known: Data?
    private var knownStamp: Stamp?
    /// The stamp of the bytes `look` last returned as changed, until the caller takes them (`accept`).
    private var seen: (data: Data, stamp: Stamp?)?
    /// Never written while set (#382: a file that is there but can't be read, or couldn't be kept aside): set and cleared
    /// by the file's owner; `write` throws `Blocked`.
    public var blocked = false
    /// How many times the bytes were read (tests and PerfProbe: a check that finds the stamp unchanged reads nothing).
    public private(set) var reads = 0

    public init(url: URL) {
        self.url = url
    }

    /// The file now, read only when its stamp isn't the one of the bytes this Mac knows.
    public func look() -> Look {
        guard let stamp = Stamp.of(url) else { return .absent }
        if let knownStamp, stamp == knownStamp { return .same }
        let data: Data
        do {
            data = try SafeFile.sharedData(url)
        } catch {
            return Stamp.of(url) == nil ? .absent : .unreadable
        }
        reads += 1
        // The stamp taken before the read: if the file changed in between, the next look sees another stamp and reads it.
        if data == known {
            knownStamp = stamp
            return .same
        }
        seen = (data, stamp)
        return .changed(data)
    }

    /// The caller took these bytes (read them in, merged them, or kept them aside): they are what this Mac knows now.
    public func accept(_ data: Data) {
        known = data
        knownStamp = seen.flatMap { $0.data == data ? $0.stamp : nil }
        seen = nil
    }

    /// Nothing known: the next look reads the file, whatever it holds.
    public func forget() {
        known = nil
        knownStamp = nil
        seen = nil
    }

    /// Writes `data` whole: to a new temporary file beside it, then renamed over it (a crash never leaves half a file, and
    /// a link there is replaced, not written through). Afterwards these are the known bytes, with the stamp of the file
    /// this Mac put there — unless something replaced it in the moment after, which the next look then reads.
    public func write(_ data: Data) throws {
        guard !blocked else { throw Blocked() }
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        let temporary = SafeFile.temporaryURL(beside: url)
        do {
            try data.write(to: temporary, options: .withoutOverwriting)
            let ours = Stamp.of(temporary)
            guard rename(temporary.path, url.path) == 0 else { throw CocoaError(.fileWriteUnknown) }
            let there = Stamp.of(url)
            known = data
            knownStamp = there != nil && there?.inode == ours?.inode && there?.device == ours?.device ? there : nil
            seen = nil
        } catch {
            try? FileManager.default.removeItem(at: temporary)
            throw error
        }
    }
}

/// A SyncedFile read as a value: the file's own decoding and encoding (the app's formats, shared with Windows).
public final class SyncedJSONFile<Value> {
    public let file: SyncedFile
    /// The value this Mac last took in (`accept`) or wrote (`save`), as it was in memory: the base of a three-way merge
    /// (repeats). nil when the bytes taken didn't decode, or nothing is known.
    public private(set) var knownValue: Value?
    private let decoder: (Data) throws -> Value
    private let encoder: (Value) throws -> Data

    public init(url: URL, decode: @escaping (Data) throws -> Value, encode: @escaping (Value) throws -> Data) {
        file = SyncedFile(url: url)
        decoder = decode
        encoder = encode
    }

    /// The file now, as a value.
    public enum CatchUp {
        case same
        case absent
        case unreadable
        /// Bytes that don't decode (half synced, broken, a link or too big): the file decides whether to keep them aside.
        case broken(Data)
        case theirs(Value, Data)
    }

    public func catchUp() -> CatchUp {
        switch file.look() {
        case .same: return .same
        case .absent: return .absent
        case .unreadable: return .unreadable
        case .changed(let data):
            guard let value = try? decoder(data) else { return .broken(data) }
            return .theirs(value, data)
        }
    }

    /// The bytes on disk taken in: `value` read from them (nil: they didn't decode, and are known as they are).
    public func accept(_ data: Data, as value: Value?) {
        file.accept(data)
        knownValue = value
    }

    /// Nothing known: the next catch-up reads the file, whatever it holds.
    public func forget() {
        file.forget()
        knownValue = nil
    }

    public func decode(_ data: Data) throws -> Value { try decoder(data) }
    public func encode(_ value: Value) throws -> Data { try encoder(value) }

    /// Writes the value (always: a file deleted meanwhile is put back). Returns the bytes written.
    @discardableResult
    public func save(_ value: Value) throws -> Data {
        let data = try encoder(value)
        try file.write(data)
        knownValue = value
        return data
    }
}
