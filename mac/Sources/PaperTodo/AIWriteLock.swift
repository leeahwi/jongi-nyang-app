import Foundation

/// `ai-write.lock` (1.42, shared with the extension and the Windows app): while AI 연결 is on, a write of
/// todos.json, events.json or memos.json — catching up with the disk, changing, saving — holds this file in the
/// settings folder, so the extension and the app never write over each other in the same moment. Taken by
/// creating the file exclusively ("pid time random"); a lock older than 3 s is stale and removed; waiting stops
/// after 300 ms and the write goes on (the catch-up just before it still applies). Let go only while it's still ours.
@MainActor
enum AIWriteLock {
    static let fileName = "ai-write.lock"
    /// The settings folder while AI 연결 is on; nil: no lock.
    static var folder: URL?
    private static var depth = 0
    private static var token: String?

    static func with<T>(_ body: () -> T) -> T {
        guard let folder else { return body() }
        if depth == 0 { token = take(folder.appendingPathComponent(fileName)) }
        depth += 1
        defer {
            depth -= 1
            if depth == 0, let held = token {
                release(folder.appendingPathComponent(fileName), held)
                token = nil
            }
        }
        return body()
    }

    private static func take(_ url: URL, wait: TimeInterval = 0.3) -> String? {
        let content = "\(getpid()) \(Int(Date().timeIntervalSince1970 * 1000)) \(UInt32.random(in: 0...UInt32.max))"
        let deadline = Date().addingTimeInterval(wait)
        repeat {
            let descriptor = open(url.path, O_CREAT | O_EXCL | O_WRONLY, 0o644)
            if descriptor >= 0 {
                let data = Data(content.utf8)
                _ = data.withUnsafeBytes { write(descriptor, $0.baseAddress, data.count) }
                close(descriptor)
                return content
            }
            if let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]))?.contentModificationDate,
               Date().timeIntervalSince(modified) > 3 {
                try? FileManager.default.removeItem(at: url)
                continue
            }
            usleep(5_000)
        } while Date() < deadline
        return nil
    }

    private static func release(_ url: URL, _ content: String) {
        guard (try? String(contentsOf: url, encoding: .utf8)) == content else { return }
        try? FileManager.default.removeItem(at: url)
    }
}
