import AppKit
import Darwin
import PaperCore

/// 치면 두드리는 고양이 (#230 · #289, scripts/bench-typing-cat.sh): the real typing cat — its own window in a corner,
/// apart from the pet — off every screen (`--offscreen`'s 40,000 points), in a process that never becomes active. Keys
/// are handed to it as calls: no key watcher or key tap hears anything real, and macOS's Input Monitoring is a stand-in
/// that never asks. It checks the cat's side of the rules (paws, its corner, cleanup, the setting, the permission, the
/// lock, the menu's switch, the pet apart), then measures this process's CPU: typing off, in this app at rest (no
/// window), in all apps at rest (the cat in its corner), typing 8 keys a second, and at rest after a burst.
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
        let suite = TestDefaults("TypingBench")
        let preferences = suite.defaults
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("typing-bench-\(UUID().uuidString)", isDirectory: true)
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        defer {
            suite.remove()
            try? FileManager.default.removeItem(at: folder)
        }
        // The pet out, sitting near its spot: no wandering, no 한마디 (steadier numbers); the typing cat as it comes.
        preferences.set(true, forKey: "pet.visible")
        preferences.set(false, forKey: "pet.wanders")
        preferences.set(false, forKey: "chatter.enabled")
        preferences.set(false, forKey: "reminder.enabled")
        // #289: an older version's 전체 화면에서 보이기 corner, moved over to the new 자리.
        preferences.set("topLeft", forKey: "pet.companion.corner")
        let model = AppModel(storageURL: folder.appendingPathComponent("todos.json"), isolated: true, preferences: preferences)
        let access = StandInAccess()
        let pet = DesktopPetController(model: model, preferences: preferences, onOpenNote: {})
        pet.offscreen = true
        let typing = TypingCatController(model: model, preferences: preferences, access: access)
        typing.offscreen = true
        typing.keys.fakeTap = { true }
        let screen = NSScreen.screens.first
        typing.screen = { screen }
        typing.start()
        pet.typingLately = { typing.chatterWaits }
        await wait(0.6)

        check("the pet is out, and every window is off the screens", pet.isVisible && windowsOffScreen())
        check("in this app (the default): the key watcher is on, no cat in the corner yet", typing.heard == .app && !typing.isShown)
        check("the old full-screen corner came along (top left)", model.typingCorner == .topLeft)

        // Paws, in this app: out with the first key, in its corner, 112 pt.
        typing.typed()
        check("the first key: out in its corner with the left paw down, off the screens here, 112 pt",
              typing.isShown && typing.cat.pose == .left && (typing.frame?.minX ?? 0) > 20_000 && typing.frame?.width == 112 && windowsOffScreen())
        if let screen, let frame = typing.frame {
            check("…in the top-left corner of the screen", frame.minX - 40_000 == screen.frame.minX + 20 && frame.maxY < screen.frame.maxY)
        }
        typing.typed()
        check("the next key: the right paw", typing.cat.pose == .right)
        await wait(0.25)
        check("120 ms after the last key: resting on the cushion, still in its corner", typing.cat.pose == .idle && typing.isShown)
        typing.typed()
        check("the next paw is kept across the rest (left, right … left)", typing.cat.pose == .left)
        for _ in 0..<40 { typing.typed(); await wait(0.01) }
        await wait(0.3)
        check("after a burst of 40 keys: resting, no paw timer left", typing.cat.pose == .idle && typing.cat.returnAt == nil)
        check("종이냥 한마디 (the pet's) waits right after typing", typing.chatterWaits)
        await wait(3.2)
        check("3 s after the last key: quietly gone, nothing waits", !typing.isShown && typing.isQuiet)

        // Apart from the pet (#289).
        pet.play(.walk(from: 200, to: 640))
        await wait(0.5)
        typing.typed()
        check("the pet walking: it keeps walking (no cushion), the typing cat taps",
              pet.state.activity.action.name == "walk" && typing.cat.pose != .idle)
        await wait(0.3)
        model.petVisible = false
        await wait(0.3)
        typing.typed()
        check("the pet hidden: the typing cat still hears and taps", !pet.isVisible && typing.heard == .app && typing.isShown && typing.cat.pose != .idle)
        model.petVisible = true
        await wait(0.3)

        // The setting.
        model.typingScope = .off
        await wait(0.2)
        check("turned off: nothing is heard, the cat goes, nothing waits", typing.heard == .none && !typing.isShown && typing.isQuiet)
        typing.typed()
        check("…a key then does nothing", !typing.isShown)
        model.typingScope = .app
        await wait(0.2)
        check("back on in this app", typing.heard == .app)

        // In all apps, with a stand-in permission (nothing real is asked or tapped).
        model.typingScope = .everywhere
        await wait(0.2)
        check("in all apps chosen, not allowed: asked once, heard in this app only, the line shows",
              access.requests == 1 && typing.heard == .app && model.typingNoPermission)
        model.typingScope = .app
        await wait(0.1)
        model.typingScope = .everywhere
        await wait(0.2)
        check("chosen again after a refusal: not asked again", access.requests == 1 && model.typingNoPermission)
        access.granted = true
        typing.refresh()
        check("allowed (in System Settings): the key tap takes over, the line goes, the cat is in its corner at rest",
              typing.heard == .everywhere && !model.typingNoPermission && typing.isShown && typing.cat.pose == .idle)
        model.typingCorner = .bottomRight
        await wait(0.2)
        if let screen, let frame = typing.frame {
            check("자리 changed: bottom right now", frame.maxX - 40_000 == screen.frame.maxX - 20 && frame.minY == screen.frame.minY + 20)
        }
        typing.typed()
        await wait(3.3)
        check("in all apps: still there long after the last key, nothing waits", typing.isShown && typing.isQuiet)
        typing.setLocked(true)
        check("the screen locked: nothing heard, the cat goes", typing.heard == .none && !typing.isShown && !model.typingNoPermission)
        typing.setLocked(false)
        check("unlocked: heard in all apps again, back in its corner", typing.heard == .everywhere && typing.isShown)
        typing.typed()
        access.granted = false
        typing.refresh()
        check("the permission taken back: in this app only, the line, the paws rest", typing.heard == .app && model.typingNoPermission && typing.cat.pose == .idle)
        access.granted = true
        typing.refresh()

        // The menu bar's 타닥냥.
        check("the menu item is checked while on", typing.menuItem().state == .on)
        model.toggleTypingCat()
        await wait(0.2)
        check("hidden from the menu: off, nothing heard, the cat goes", model.typingScope == .off && typing.heard == .none && !typing.isShown)
        check("…the menu item unchecked", typing.menuItem().state == .off)
        model.toggleTypingCat()
        await wait(0.2)
        check("shown again from the menu: back to in all apps", model.typingScope == .everywhere && typing.heard == .everywhere && typing.isShown)
        model.typingScope = .app
        await wait(0.8)

        // CPU, the pet out (off the screens, awake as if someone were there). Its own small moments (a blink, a look, a
        // stretch) come at random every 5–14 s whatever the setting, so each kind is measured in four turns, taking turns,
        // and the median is what counts.
        print("== CPU · \(ProcessInfo.processInfo.operatingSystemVersionString) · load \(load()) · \(Int(rest)) s a turn")
        func median(_ values: [Double]) -> Double { let sorted = values.sorted(); return (sorted[1] + sorted[2]) / 2 }
        func line(_ name: String, _ values: [Double]) {
            print("\(name): median \(String(format: "%.2f", median(values)))% CPU (\(values.map { String(format: "%.2f", $0) }.joined(separator: " · "))) · load \(load())")
        }
        var off: [Double] = [], app: [Double] = [], everywhere: [Double] = []
        for _ in 0..<4 {
            model.typingScope = .off
            await wait(0.5)
            off.append(await measure(rest))
            model.typingScope = .app
            await wait(0.5)
            app.append(await measure(rest))
            model.typingScope = .everywhere
            await wait(0.5)
            everywhere.append(await measure(rest))
        }
        line("typing cat off, at rest", off)
        line("in this app, at rest (no window)", app)
        line("in all apps, at rest (the cat in its corner)", everywhere)
        let typed = await measure(15) {
            for _ in 0..<120 { typing.typed(); await wait(0.125) }
        }
        print(String(format: "typing 8 keys a second for 15 s: %.2f%% CPU · load %@", typed, load()))
        for _ in 0..<60 { typing.typed(); await wait(0.012) }
        await wait(0.3)
        check("after the burst: no paw timer left", typing.isQuiet)
        var after: [Double] = []
        for _ in 0..<4 { after.append(await measure(rest)) }
        line("in all apps, at rest after a burst", after)
        check("every window stayed off the screens", windowsOffScreen())
        typing.shutDown()
        print("\(passed) checks passed\(failures.isEmpty ? "" : ", failed: \(failures.joined(separator: "; "))")")
        exit(failures.isEmpty ? 0 : 1)
    }
}
