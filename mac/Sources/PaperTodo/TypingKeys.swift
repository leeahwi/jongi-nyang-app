import AppKit
import PaperCore

/// 치면 두드리는 고양이 (#230): hears that a key went down — and nothing else. Each event is turned at once into "a key
/// went down" (`onKey`, no arguments); the event itself goes on unchanged and nothing of it is kept, written or logged.
/// Only whether it is a held key's repeat and whether ⌘ or ⌃ is held is looked at, to leave out repeats and shortcuts
/// (`TypingCat.counts`). scripts/test-typing-cat.sh checks this file for anything more.
///
/// In this app: a local key-down watcher (keys typed into 종이냥's own windows). In all apps: a listen-only key-down tap
/// of the login session, which macOS allows only with Input Monitoring. Never both, so no key is heard twice.
@MainActor
final class TypingKeys {
    /// A key went down.
    var onKey: () -> Void = {}
    /// The tap stopped and couldn't be started again (the permission was taken back): check it again.
    var onTapLost: () -> Void = {}
    private(set) var source: TypingSource = .none
    private var local: Any?
    private var tap: CFMachPort?
    private var tapLoop: CFRunLoopSource?
    /// Tests: stands in for the key tap (no tap is made, so no real key is ever heard by a test).
    var fakeTap: (() -> Bool)?

    /// Hears from `source` from now on (`.none`: nothing; anything else is let go first).
    func use(_ source: TypingSource) {
        guard source != self.source else { return }
        stop()
        switch source {
        case .none: break
        case .app: startLocal()
        case .everywhere: if !(fakeTap?() ?? startTap()) { startLocal(); self.source = .app; return }
        }
        self.source = source
    }

    func stop() {
        if let local { NSEvent.removeMonitor(local) }
        local = nil
        if let tap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let tapLoop { CFRunLoopRemoveSource(CFRunLoopGetMain(), tapLoop, .commonModes) }
        if let tap { CFMachPortInvalidate(tap) }
        tap = nil
        tapLoop = nil
        source = .none
    }

    private func startLocal() {
        local = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
            if TypingCat.counts(isRepeat: event.isARepeat, command: event.modifierFlags.contains(.command),
                                control: event.modifierFlags.contains(.control)) {
                self?.onKey()
            }
            return event
        }
    }

    /// Only called once Input Monitoring is allowed (`InputMonitoring.granted`): creating a key tap without it could make
    /// macOS ask on its own.
    private func startTap() -> Bool {
        let mask = CGEventMask(1 << CGEventType.keyDown.rawValue)
        let callback: CGEventTapCallBack = { _, type, event, info in
            guard let info else { return Unmanaged.passUnretained(event) }
            let keys = Unmanaged<TypingKeys>.fromOpaque(info).takeUnretainedValue()
            switch type {
            case .keyDown:
                let counts = TypingCat.counts(isRepeat: event.getIntegerValueField(.keyboardEventAutorepeat) != 0,
                                              command: event.flags.contains(.maskCommand), control: event.flags.contains(.maskControl))
                if counts { MainActor.assumeIsolated { keys.onKey() } }
            case .tapDisabledByTimeout, .tapDisabledByUserInput:
                MainActor.assumeIsolated { keys.tapDisabled() }
            default:
                break
            }
            return Unmanaged.passUnretained(event)
        }
        guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .tailAppendEventTap, options: .listenOnly,
                                          eventsOfInterest: mask, callback: callback,
                                          userInfo: Unmanaged.passUnretained(self).toOpaque()) else { return false }
        let loop = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
        // The main run loop: the callback runs on the main thread, where the cat is.
        CFRunLoopAddSource(CFRunLoopGetMain(), loop, .commonModes)
        CGEvent.tapEnable(tap: tap, enable: true)
        self.tap = tap
        tapLoop = loop
        return true
    }

    /// macOS turned the tap off (it was slow, or the permission went): on again once; if it stays off, it's lost.
    private func tapDisabled() {
        guard let tap else { return }
        CGEvent.tapEnable(tap: tap, enable: true)
        if !CGEvent.tapIsEnabled(tap: tap) { onTapLost() }
    }
}

/// macOS's Input Monitoring for hearing keys in all apps. Tests and test copies get one that never asks
/// (`InputMonitoring.neverAsks`), so no system question appears from them.
@MainActor
protocol InputMonitoringAccess: AnyObject {
    var granted: Bool { get }
    /// Shows macOS's question (once per build of the app; macOS itself doesn't ask again after an answer).
    func request()
}

@MainActor
enum InputMonitoring {
    final class System: InputMonitoringAccess {
        var granted: Bool { CGPreflightListenEventAccess() }
        func request() { _ = CGRequestListenEventAccess() }
    }

    /// Not allowed, and never asks.
    final class NeverAsks: InputMonitoringAccess {
        var granted: Bool { false }
        func request() {}
    }

    /// System Settings → 개인정보 보호 및 보안 → 입력 모니터링.
    static let settingsURL = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent")!
}
