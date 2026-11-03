import Foundation

/// How big a file the app reads (#173, security review L-05): a file is read whole and then parsed, so memory grows to a
/// few times its size. Past these it is refused untouched, with a message, and what is on the list stays as it is. The
/// same numbers as the Windows app and 종이냥 for Claude (windows/src/core/fileLimits.ts); both tests read them from
/// docs/plans/file-safety-cases.json.
public enum FileLimits {
    /// A .jongi (가져오기, 되돌리기, the backup list's counts).
    public static let backupBytes = 64 * 1024 * 1024
    /// One data file in the storage folder (todos.json, memos.json, memo-trash.json, archive/2026-10.jsonl …).
    public static let dataFileBytes = 32 * 1024 * 1024
}

/// Reading the storage folder's and the backup folder's files safely (#173, security review L-04): someone who can write
/// to a shared folder could put a link where a data file goes, or a huge file. A file is looked at with `lstat` first: a
/// link is neither read nor written over, and one past its limit is not read. The same rules as the Windows app's
/// `safeFiles.ts`; the shared cases are docs/plans/file-safety-cases.json.
public enum SafeFile {
    public enum Refusal: Error, Equatable {
        case link
        case tooLarge(limit: Int)
    }

    /// What is at `url` itself (a link is not followed): nil when nothing is there.
    public static func entry(_ url: URL) -> (isLink: Bool, isFile: Bool, size: Int)? {
        var info = stat()
        guard lstat(url.path, &info) == 0 else { return nil }
        let kind = info.st_mode & S_IFMT
        return (kind == S_IFLNK, kind == S_IFREG, Int(info.st_size))
    }

    /// Throws a Refusal when `url` is a link, or a file bigger than `limit`. Nothing there (or a folder) passes.
    public static func check(_ url: URL, limit: Int = FileLimits.dataFileBytes) throws {
        guard let entry = entry(url) else { return }
        if entry.isLink { throw Refusal.link }
        if entry.isFile, entry.size > limit { throw Refusal.tooLarge(limit: limit) }
    }

    /// True when a reader would refuse `url` (a link, or past `limit`).
    public static func isRefused(_ url: URL, limit: Int = FileLimits.dataFileBytes) -> Bool {
        (try? check(url, limit: limit)) == nil
    }

    /// The file's bytes, nil when there is none: checked with lstat, opened without following a link (O_NOFOLLOW) and
    /// checked again on the open file. A Refusal for a link or past `limit`; other failures throw as Foundation's do.
    public static func data(_ url: URL, limit: Int = FileLimits.dataFileBytes) throws -> Data? {
        guard entry(url) != nil else { return nil }
        try check(url, limit: limit)
        let descriptor = open(url.path, O_RDONLY | O_NOFOLLOW)
        if descriptor < 0 {
            if errno == ELOOP { throw Refusal.link }
            if errno == ENOENT { return nil }
            throw CocoaError(.fileReadUnknown)
        }
        let handle = FileHandle(fileDescriptor: descriptor, closeOnDealloc: true)
        var info = stat()
        if fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG, Int(info.st_size) > limit { throw Refusal.tooLarge(limit: limit) }
        return try handle.readToEnd() ?? Data()
    }

    /// For the app's own reads of the storage folder (the list, memos, events, alarms, memo folders, 지운 메모, spaces,
    /// repeats), in place of `Data(contentsOf:)`: no file throws as it does; a link, or a file past
    /// FileLimits.dataFileBytes, reads as no bytes — never read whole, and since no reader decodes empty bytes it takes
    /// that reader's path for an unreadable file (kept aside, or never saved over). Saves are Foundation's atomic writes,
    /// which replace a link rather than write through it.
    public static func sharedData(_ url: URL) throws -> Data {
        do {
            guard let data = try data(url) else { throw CocoaError(.fileReadNoSuchFile) }
            return data
        } catch is Refusal {
            return Data()
        }
    }

    /// `data` as UTF-8 text (nil when there is no file); text that isn't UTF-8 throws.
    public static func text(_ url: URL, limit: Int = FileLimits.dataFileBytes) throws -> String? {
        guard let data = try data(url, limit: limit) else { return nil }
        guard let text = String(data: data, encoding: .utf8) else { throw CocoaError(.fileReadInapplicableStringEncoding) }
        return text
    }

    /// A temporary file beside `url`, random each time (so it can't be planted beforehand), starting with `prefix`.
    public static func temporaryURL(beside url: URL, prefix: String = ".") -> URL {
        url.deletingLastPathComponent().appendingPathComponent("\(prefix)\(url.lastPathComponent).\(UUID().uuidString.prefix(12)).tmp")
    }
}
