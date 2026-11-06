import AppKit
import Darwin
import PaperCore

/// 치면 두드리는 고양이 (#230, scripts/bench-typing-cat.sh): the real pet controller with its typing, off every screen
/// (`--offscreen`'s 40,000 points), in a process that never becomes active. Keys are handed to it as calls — no key
/// watcher or key tap hears anything real, and macOS's Input Monitoring is a stand-in that never asks. It checks the
/// pet's side of the rules (paws, cleanup, the setting, the permission, the full-screen cat), then measures this
/// process's CPU with the pet out: typing off, typing on at rest, typing 8 keys a second, and at rest after a burst.
///
///   TypingCatBench [seconds per rest]
@MainActor
final class StandInAccess: InputMonitoringAccess {
    var granted = false
    var requests = 0
    func request() { requests += 1 }
}

@main
@MainActor
enum TypingCatBench {
    static var failures: [String] = []
    static var passed = 0

    static func check(_ name: String, _ condition: Bool) {
        if condition { passed += 1; print("PASS \(name)") } else { failures.append(name); print("FAIL \(name)") }
    }

    static func wait(_ seconds: Double) async { try? await Task.sleep(for: .seconds(seconds)) }

    /// Every window of this process is off the screens (40,000 points away) or not shown at all.
    static func windowsOffScreen() -> Bool {
        NSApp.windows.allSatisfy { !$0.isVisible || $0.frame.minX > 20_000 }
    }

    static func cpuSeconds() -> Double {
        var usage = rusage()
        getrusage(RUSAGE_SELF, &usage)
        return Double(usage.ru_utime.tv_sec) + Double(usage.ru_utime.tv_usec) / 1e6 + Double(usage.ru_stime.tv_sec) + Double(usage.ru_stime.tv_usec) / 1e6
    }

    static func measure(_ seconds: Double, while work: (() async -> Void)? = nil) async -> Double {
        let cpu = cpuSeconds(), start = ProcessInfo.processInfo.systemUptime
        if let work { await work() } else { await wait(seconds) }
        return (cpuSeconds() - cpu) / (ProcessInfo.processInfo.systemUptime - start) * 100
    }

    static func load() -> String {
        var loads = [Double](repeating: 0, count: 3)
        getloadavg(&loads, 3)
        return loads.map { String(format: "%.2f", $0) }.joined(separator: " ")
    }

    static func main() async {
        let rest = CommandLine.arguments.dropFirst().first.flatMap(Double.init) ?? 30
        L10n.activate(setting: "ko", preferred: [])
        _ = NSApplication.shared
        NSApp.setActivationPolicy(.prohibited)
        let suite = "PaperTodo.TypingBench.\(UUID().uuidString)"
        let preferences = UserDefaults(suiteName: suite)!
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("typing-bench-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer {
            preferences.removePersistentDomain(forName: suite)
            try? FileManager.default.removeItem(at: folder)
        }
        // The pet out, sitting near its spot: no wandering, no 한마디 (steadier numbers), typing as it comes.
        preferences.set(true, forKey: "pet.visible")
        preferences.set(false, forKey: "pet.wanders")
        preferences.set(false, forKey: "chatter.enabled")
        preferences.set(false, forKey: "reminder.enabled")
        let model = AppModel(storageURL: folder.appendingPathComponent("todos.json"), isolated: true, preferences: preferences)
        let access = StandInAccess()
        let pet = DesktopPetController(model: model, preferences: preferences, inputMonitoring: access, onOpenNote: {})
        pet.offscreen = true
        pet.typing.offscreen = true
        pet.typing.keys.fakeTap = { true }
        await wait(0.6)

        check("the pet is out, and every window is off the screens", pet.isVisible && windowsOffScreen())
        check("in this app (the default): the key watcher is on", pet.typing.heard == .app)

        // Paws.
        pet.typing.typed()
        check("the first key: the left paw, at once", pet.state.typing == .left)
        pet.typing.typed()
        check("the next key: the right paw", pet.state.typing == .right)
        await wait(0.25)
        check("120 ms after the last key: resting on the cushion, nothing waits", pet.state.typing == .idle && pet.typing.isQuiet)
        pet.typing.typed()
        check("the next paw is kept across the rest (left, right … left)", pet.state.typing == .left)
        for _ in 0..<40 { pet.typing.typed(); await wait(0.01) }
        await wait(0.3)
        check("after a burst of 40 keys: resting, no timer left", pet.state.typing == .idle && pet.typing.isQuiet)
        check("종이냥 한마디 waits right after typing", pet.typing.chatterWaits)

        // Beside the pet's other moments.
        pet.play(.cheer)
        pet.typing.typed()
        check("cheering: the key is let go (no paw, the cheer goes on)", pet.state.typing == nil && pet.state.activity.action == .cheer)
        await wait(2)
        pet.play(.walk(from: 200, to: 640))
        await wait(1)
        pet.typing.typed()
        let stoppedAt = pet.state.homeX
        check("walking: it stops where it is and types", pet.state.activity.action == .sit && pet.state.typing != nil && stoppedAt > 200 && stoppedAt < 640)
        pet.play(.blink)
        check("a clip takes the cat off its cushion", pet.state.typing == nil)
        await wait(0.3)

        // The setting.
        model.petTyping = .off
        await wait(0.2)
        check("turned off: nothing is heard", pet.typing.heard == .none && pet.typing.isQuiet)
        pet.typing.typed()
        pet.typing.refresh()
        model.petTyping = .app
        await wait(0.2)
        check("back on in this app", pet.typing.heard == .app)

        // In all apps, with a stand-in permission (nothing real is asked or tapped).
        model.petTyping = .everywhere
        await wait(0.2)
        check("in all apps chosen, not allowed: asked once, heard in this app only, the line shows",
              access.requests == 1 && pet.typing.heard == .app && model.typingNoPermission)
        model.petTyping = .app
        await wait(0.1)
        model.petTyping = .everywhere
        await wait(0.2)
        check("chosen again after a refusal: not asked again", access.requests == 1 && model.typingNoPermission)
        access.granted = true
        pet.typing.refresh()
        check("allowed (in System Settings): the key tap takes over, the line goes", pet.typing.heard == .everywhere && !model.typingNoPermission)
        pet.typing.typed()
        access.granted = false
        pet.typing.refresh()
        check("the permission taken back: in this app only, the line, the paws rest", pet.typing.heard == .app && model.typingNoPermission && pet.typing.isQuiet)
        model.petVisible = false
        await wait(0.3)
        check("the pet hidden: nothing is heard, nothing waits, off the cushion", pet.typing.heard == .none && pet.typing.isQuiet && pet.state.typing == nil)

        // The small cat over full-screen apps: its own typing, with a stand-in pet that a full-screen app covers.
        var covered = true
        var dockPoses: [TypingCat.Pose?] = []
        let companion = PetTyping(model: model, preferences: preferences, access: access)
        companion.offscreen = true
        companion.keys.fakeTap = { true }
        access.granted = true
        model.petTyping = .everywhere
        model.petCompanion = true
        companion.attach(PetTyping.Host(isVisible: { true }, isCovered: { covered }, doing: { .resting }, prepare: { _ in },
                                        show: { dockPoses.append($0) }, screen: { NSScreen.main }))
        await wait(0.7)
        check("covered by a full-screen app: the small cat shows, off the screens here, 112 pt",
              companion.companionShown && (companion.companionFrame?.minX ?? 0) > 20_000 && companion.companionFrame?.width == 112 && windowsOffScreen())
        companion.typed()
        check("…and takes the paws (the pet above the Dock doesn't)", companion.cat.pose == .left && !dockPoses.contains { $0 != nil })
        await wait(0.25)
        check("…back to rest, nothing waits", companion.cat.pose == .idle && companion.isQuiet)
        model.petCompanion = false
        await wait(0.2)
        check("turned off from the menu: it goes", !companion.companionShown)
        model.petCompanion = true
        await wait(0.7)
        covered = false
        companion.refresh()
        check("the pet above the Dock seen again: the small cat goes at once (never both)", !companion.companionShown)
        access.granted = false
        covered = true
        companion.refresh()
        await wait(0.7)
        check("not allowed: no small cat (never pretended)", !companion.companionShown)
        companion.shutDown()
        model.petTyping = .app
        model.petVisible = true
        await wait(0.8)

        // CPU, the pet out (off the screens, awake as if someone were there). Its own small moments (a blink, a look, a
        // stretch) come at random every 5–14 s whatever the setting, so each kind is measured in four turns, off and on
        // taking turns, and the median is what counts.
        print("== CPU · \(ProcessInfo.processInfo.operatingSystemVersionString) · load \(load()) · \(Int(rest)) s a turn")
        func median(_ values: [Double]) -> Double { let sorted = values.sorted(); return (sorted[1] + sorted[2]) / 2 }
        func line(_ name: String, _ values: [Double]) {
            print("\(name): median \(String(format: "%.2f", median(values)))% CPU (\(values.map { String(format: "%.2f", $0) }.joined(separator: " · "))) · load \(load())")
        }
        var off: [Double] = [], on: [Double] = []
        for _ in 0..<4 {
            model.petTyping = .off
            await wait(0.5)
            off.append(await measure(rest))
            model.petTyping = .app
            await wait(0.5)
            on.append(await measure(rest))
        }
        line("typing off, at rest", off)
        line("typing on, at rest", on)
        let typing = await measure(15) {
            for _ in 0..<120 { pet.typing.typed(); await wait(0.125) }
        }
        print(String(format: "typing 8 keys a second for 15 s: %.2f%% CPU · load %@", typing, load()))
        for _ in 0..<60 { pet.typing.typed(); await wait(0.012) }
        await wait(0.3)
        check("after the burst: no paw timer left", pet.typing.isQuiet)
        var after: [Double] = []
        for _ in 0..<4 { after.append(await measure(rest)) }
        line("typing on, at rest after a burst", after)
        check("every window stayed off the screens", windowsOffScreen())
        pet.typing.shutDown()
        print("\(passed) checks passed\(failures.isEmpty ? "" : ", failed: \(failures.joined(separator: "; "))")")
        exit(failures.isEmpty ? 0 : 1)
    }
}
