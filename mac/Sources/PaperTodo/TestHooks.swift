import AppKit

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

    /// #217: a check's run — `--offscreen`, `--snapshot` or `PAPERTODO_OFFSCREEN=1`, never in a release build. It stays
    /// behind the person's apps: it never makes itself the active app, has no Dock icon or menu bar item, and no
    /// window of it takes the keyboard (a non-activating panel would, and the system could then show the input-source
    /// indicator on the person's screen). Its input comes from inside (PerfDrive), not from the system.
    static let staysBehind = enabled && (arguments.contains("--offscreen") || arguments.contains("--snapshot")
        || ProcessInfo.processInfo.environment["PAPERTODO_OFFSCREEN"] == "1")

    /// #250: a check's window as Mission Control and App Exposé leave it out (`.transient`) and the window cycle skips it
    /// (`.ignoresCycle`). Those views draw every window of the Space shrunk onto the screen, the ones far off every display
    /// too — a Windows check run's cat, drawer and desk were seen there on the person's screen. The rest of `behavior`
    /// (spaces, full screen) stays; `.managed` · `.stationary` and `.participatesInCycle` go, as AppKit takes one of each.
    nonisolated static func hiddenFromOverviews(_ behavior: NSWindow.CollectionBehavior) -> NSWindow.CollectionBehavior {
        var kept = behavior
        kept.subtract([.managed, .stationary, .participatesInCycle])
        kept.insert([.transient, .ignoresCycle])
        return kept
    }

    /// In a check's run (#250), every window and panel of the app — now and each time one comes, or its behaviour is set
    /// again — gets `hiddenFromOverviews`. Looked at after each turn of the event loop (no timer of its own: the idle
    /// checks count wakeups) and whenever a window is ordered in or out.
    @MainActor static func keepOutOfOverviews() {
        guard staysBehind, overviewObservers.isEmpty else { return }
        let apply: @Sendable (Notification) -> Void = { _ in MainActor.assumeIsolated { hideWindowsFromOverviews() } }
        overviewObservers = [
            NotificationCenter.default.addObserver(forName: NSApplication.didUpdateNotification, object: nil, queue: .main, using: apply),
            NotificationCenter.default.addObserver(forName: NSWindow.didChangeOcclusionStateNotification, object: nil, queue: .main, using: apply),
        ]
        hideWindowsFromOverviews()
    }

    @MainActor private static var overviewObservers: [NSObjectProtocol] = []

    @MainActor static func hideWindowsFromOverviews() {
        for window in NSApp.windows {
            let wanted = hiddenFromOverviews(window.collectionBehavior)
            if window.collectionBehavior != wanted { window.collectionBehavior = wanted }
        }
    }

    /// The app made the active one, as a click on it would — except in a check's run (#217).
    @MainActor static func activate() {
        guard !staysBehind else { return }
        NSApp.activate(ignoringOtherApps: true)
    }
}
