import CoreGraphics
import Foundation

/// 치면 두드리는 고양이 (#230 · #289, docs/plans/typing-cat.md): a cat of its own, apart from the desktop pet, in a
/// corner of the screen on its cushion. It puts a paw down for each key — the viewer's left paw first, then the other,
/// back to rest 0.12 s after the last key. The same rules as the Windows app's `src/core/typingCat.ts`; both run the
/// cases in docs/plans/typing-cat-cases.json.
///
/// What it is given is only that a key went down and when (a monotonic clock, in seconds). It never sees which key,
/// and it keeps nothing of one: two poses, a time and a deadline.
public struct TypingCat: Equatable, Sendable {
    /// The three pictures (left · right as the viewer sees them).
    public enum Pose: String, CaseIterable, Sendable { case idle, left, right }

    /// 책상 → 종이냥 → 타닥냥 → 두드리기 (`typing.scope`, a device setting): `app` unless changed.
    public enum Scope: String, CaseIterable, Sendable {
        case off, app, everywhere
        public static let fallback = Scope.app
        public init(saved: String?) { self = saved.flatMap(Scope.init(rawValue:)) ?? .fallback }

        /// #289: the setting as saved now, or else as the pet's ‘글자 칠 때 두드리기’ (`pet.typing`) left it.
        public init(saved: String?, before: String?) { self.init(saved: saved ?? before) }

        /// The menu bar's 타닥냥: on, it is turned off and the choice remembered (`last`); off, the remembered
        /// choice comes back (종이냥에서만 if none). Settings shows the same 끄기, so there is one switch, not two.
        public static func toggled(_ scope: Scope, last: Scope?) -> (scope: Scope, last: Scope?) {
            if scope == .off { return (last.flatMap { $0 == .off ? nil : $0 } ?? .fallback, last) }
            return (.off, scope)
        }
    }

    /// How long a paw stays down after its key (the first value to try on real typing).
    public static let hold: Double = 0.12
    /// 종이냥에서만: the cat stays in its corner this long after the last key, then quietly goes.
    public static let linger: Double = 3
    /// 종이냥 한마디 (the pet's) waits this long after the last key (a bubble doesn't pop up mid-sentence).
    public static let chatterQuiet: Double = 5

    public private(set) var pose: Pose = .idle
    /// The paw for the next key: kept across rests, so slow typing alternates too.
    public private(set) var nextPaw: Pose = .left
    /// When the paw goes back to rest; nil when nothing waits (then no timer runs).
    public private(set) var returnAt: Double?
    /// When the last key that counted went down.
    public private(set) var lastKey: Double?

    public init() {}

    /// A key went down at `now`. The pose changes at once (no clips queued); the answer is when to wake to put the paw
    /// back, nil when there's nothing to wait for. Reduced motion: the cat stays still in its resting pose.
    @discardableResult
    public mutating func key(at now: Double, reduceMotion: Bool) -> Double? {
        lastKey = now
        if reduceMotion {
            pose = .idle
            returnAt = nil
            return nil
        }
        pose = nextPaw
        nextPaw = nextPaw == .left ? .right : .left
        returnAt = now + Self.hold
        return returnAt
    }

    /// The timer woke at `now`: the paw goes back once its time has come. A newer key moved the time on; the answer is
    /// then when to wake again (nil: done, nothing waits).
    public mutating func wake(at now: Double) -> Double? {
        guard let due = returnAt else { return nil }
        if now < due - 1e-9 { return due }
        pose = .idle
        returnAt = nil
        return nil
    }

    /// Hidden, turned off, permission gone, quitting: nothing waits and the paws rest. The next paw is kept.
    public mutating func stop() {
        pose = .idle
        returnAt = nil
    }

    /// Typed within `seconds` of `now`.
    public func typed(within seconds: Double, of now: Double) -> Bool {
        lastKey.map { now - $0 < seconds } ?? false
    }

    /// Whether a key-down counts as typing: not a key held down (its repeats), not a command (⌘ or ⌃ held). ⇧ and ⌥ type
    /// letters, so they count. A modifier pressed alone is no key-down at all.
    public static func counts(isRepeat: Bool, command: Bool, control: Bool) -> Bool {
        !isRepeat && !command && !control
    }
}

/// Where typing is heard from. In this app: a key-down watcher. In all apps: a listen-only key-down tap, only once the
/// person chose it and macOS's Input Monitoring allows it (Windows: the low-level key hook could be set). Nothing while
/// the screen is locked. The desktop pet plays no part: hiding it leaves the tap-tap cat as it is (#289).
public enum TypingSource: String, Sendable {
    case none, app, everywhere

    public static func of(scope: TypingCat.Scope, granted: Bool, locked: Bool) -> TypingSource {
        guard !locked else { return .none }
        switch scope {
        case .off: return .none
        case .app: return .app
        case .everywhere: return granted ? .everywhere : .app
        }
    }

    /// Ask macOS for Input Monitoring now: the person just chose ‘모든 앱에서’ (`chosenNow`; never at launch or on its own),
    /// it isn't allowed, and this build of the app never asked. Asked once, it isn't asked again: Settings shows a line
    /// with a button to System Settings instead.
    public static func shouldAsk(scope: TypingCat.Scope, granted: Bool, askedThisBuild: Bool, chosenNow: Bool) -> Bool {
        chosenNow && scope == .everywhere && !granted && !askedThisBuild
    }

    /// The line under the setting: ‘모든 앱에서’ chosen and not allowed (refused, not answered yet, taken back, or lost with
    /// an update of the app), so the cat answers typing in this app only.
    public static func showsNoPermission(scope: TypingCat.Scope, granted: Bool) -> Bool {
        scope == .everywhere && !granted
    }
}

/// The typing cat's own small window (#289): a corner of the screen in use, over full-screen apps too, clicks passing
/// through. In all apps it is always there; in this app only it comes with a key and goes `TypingCat.linger` after the
/// last one.
public enum TypingCorner {
    public enum Corner: String, CaseIterable, Sendable {
        case topLeft, topRight, bottomLeft, bottomRight
        public static let fallback = Corner.bottomRight
        public init(saved: String?) { self = saved.flatMap(Corner.init(rawValue:)) ?? .fallback }
        /// #289: as saved now, or else as the Mac's 전체 화면에서 보이기 corner (`pet.companion.corner`) left it.
        public init(saved: String?, before: String?) { self.init(saved: saved ?? before) }
    }

    /// Its size (points).
    public static let size: CGFloat = 112
    public static let margin: CGFloat = 20

    /// Whether the cat is in its corner now: heard in all apps (always), or in this app within `linger` of the last key.
    public static func shows(source: TypingSource, lastKey: Double?, now: Double) -> Bool {
        switch source {
        case .none: return false
        case .everywhere: return true
        case .app: return lastKey.map { now - $0 < TypingCat.linger } ?? false
        }
    }

    /// Its frame in a screen's corner, kept inside the screen (under a notch or menu bar at the top: `topInset`).
    public static func frame(corner: Corner, screen: CGRect, topInset: CGFloat, size: CGFloat = size) -> CGRect {
        let side = min(size, max(0, screen.width - 2 * margin), max(0, screen.height - 2 * margin - topInset))
        let left = screen.minX + margin
        let right = screen.maxX - margin - side
        let bottom = screen.minY + margin
        let top = screen.maxY - margin - topInset - side
        switch corner {
        case .topLeft: return CGRect(x: left, y: top, width: side, height: side)
        case .topRight: return CGRect(x: right, y: top, width: side, height: side)
        case .bottomLeft: return CGRect(x: left, y: bottom, width: side, height: side)
        case .bottomRight: return CGRect(x: right, y: bottom, width: side, height: side)
        }
    }
}
