import Foundation

/// #174 (security review L-07): the switches tests, snapshots and checks start the app with — `--demo`, `--snapshot`,
/// `--storage`, the logs it writes to anywhere (`--ai-open-log`, `--ai-code-log`, `--ai-check-log`, `--notice-log`,
/// `--perf-log`, `--interaction-log`, the snapshot paths) and the rest. A release build (`scripts/build.sh` compiles
/// with `-D PAPERTODO_RELEASE`) reads none of them: it sees only `--offscreen`, which writes nothing and only keeps its
/// windows off the screens. Test and check scripts build without the flag, so they keep every switch.
enum TestHooks {
    #if PAPERTODO_RELEASE
    static let enabled = false
    #else
    static let enabled = true
    #endif

    /// The launch's arguments as the app may read them.
    static let arguments: [String] = filtered(ProcessInfo.processInfo.arguments, enabled: enabled)

    static func filtered(_ all: [String], enabled: Bool) -> [String] {
        guard !enabled else { return all }
        return Array(all.prefix(1)) + all.dropFirst().filter { $0 == "--offscreen" }
    }
}
