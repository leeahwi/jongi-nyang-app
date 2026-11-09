import Foundation

/// Throwaway preferences for one check, bench or render (#278). Every test file that needs its own `UserDefaults` makes it
/// here and calls `remove()` when it is done (`defer`, a fixture's cleanup).
///
/// Why not `UserDefaults(suiteName: "PaperTodo.<group>.<UUID>")`: macOS keeps such a suite in
/// ~/Library/Preferences/<name>.plist, and `removePersistentDomain(forName:)` empties it without taking the file away —
/// cfprefsd writes the empty file back a while later, even after the process has ended and the file was deleted. Over a
/// few weeks of checks that left more than 12,900 empty files there. A suite named by an absolute path is a plain file
/// at that path instead, so this one lives in the temporary folder and goes away for good with its file.
///
/// The real app is bundle id `com.noa.PaperTodo` with ~/Library/Preferences/com.noa.PaperTodo.plist. That name (and any
/// spelling of it) is refused by `isTestName`, and nothing here reads, writes or deletes in ~/Library/Preferences.
final class TestDefaults {
    /// The suite's name, `PaperTodo.<group>.<UUID>`.
    let name: String
    /// Where the suite lives: `<temporary folder>/PaperTodoTestDefaults/<name>` (macOS adds `.plist`).
    let path: String
    let defaults: UserDefaults

    /// `group` is a short word for the check (`Design`, `PresentationTests` …): letters, digits, `-` and `_` only.
    init(_ group: String) {
        let name = "PaperTodo.\(group).\(UUID().uuidString)"
        precondition(group.range(of: "^[A-Za-z0-9_-]+$", options: .regularExpression) != nil && Self.isTestName(name),
                     "TestDefaults: refusing ‘\(name)’, not a test suite name")
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("PaperTodoTestDefaults", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        self.name = name
        path = folder.appendingPathComponent(name).path
        defaults = UserDefaults(suiteName: path)!
    }

    /// Empties the suite and deletes its file. Safe to call more than once.
    func remove() {
        defaults.removePersistentDomain(forName: path)
        try? FileManager.default.removeItem(atPath: path + ".plist")
    }

    /// Whether `name` may be a throwaway preferences domain: `PaperTodo.<something>` (the checks' suites) or
    /// `com.noa.PaperTodo.<something>` (a test copy's bundle id, like `com.noa.PaperTodo.Perf2`). Never the real app's
    /// `com.noa.PaperTodo` in any letter case (the disk ignores case), never a bare prefix, a path or a file name.
    /// scripts/lib/test-defaults.sh follows the same rule.
    static func isTestName(_ name: String) -> Bool {
        let lower = name.lowercased()
        if lower == "com.noa.papertodo" || lower.hasSuffix(".plist") { return false }
        return lower.range(of: "^(com\\.noa\\.)?papertodo\\.[a-z0-9][a-z0-9._-]*$", options: .regularExpression) != nil
    }
}
