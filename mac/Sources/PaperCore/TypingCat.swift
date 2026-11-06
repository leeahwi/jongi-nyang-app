import CoreGraphics
import Foundation

/// 치면 두드리는 고양이 (#230, docs/plans/typing-cat.md): the cat on its cushion puts a paw down for each key — the viewer's
/// left paw first, then the other, back to rest 0.12 s after the last key. The same rules as the Windows app's
/// `src/core/typingCat.ts`; both run the cases in docs/plans/typing-cat-cases.json.
///
/// What it is given is only that a key went down and when (a monotonic clock, in seconds). It never sees which key,
/// and it keeps nothing of one: two poses, a time and a deadline.
public struct TypingCat: Equatable, Sendable {
    /// The three pictures (left · right as the viewer sees them).
    public enum Pose: String, CaseIterable, Sendable { case idle, left, right }

    /// 책상 → 종이냥 → 글자 칠 때 두드리기 (`pet.typing`, a device setting): `app` unless changed.
    public enum Scope: String, CaseIterable, Sendable {
        case off, app, everywhere
        public static let fallback = Scope.app
        public init(saved: String?) { self = saved.flatMap(Scope.init(rawValue:)) ?? .fallback }
    }

    /// How long a paw stays down after its key (the first value to try on real typing).
    public static let hold: Double = 0.12
    /// The cat stays on its cushion this long after the last key before the pet's usual moments come back.
    public static let linger: Double = 3
    /// 종이냥 한마디 waits this long after the last key (a bubble doesn't pop up mid-sentence).
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

    // MARK: Beside the pet's other moments

    /// What the desktop pet is doing when a key comes.
    public enum Doing: String, CaseIterable, Sendable {
        /// Sitting (or already on its cushion).
        case resting
        /// Dozing after five minutes away.
        case sleeping
        case walking
        /// One of the small moments (a blink, a look, a stretch, grooming, a yawn, tea).
        case moment
        /// Answering something: a cheer (a task or a timer done), hearts (petted, an answer), a hop (a reminder, a question).
        case answering
        /// Being dragged.
        case dragging
        /// Hidden, or out of sight (a full-screen app over it, the screen off).
        case hidden
    }

    /// What a key does to the pet.
    public enum Reply: String, Sendable {
        /// Nothing (no catching up later either).
        case ignore
        /// A paw goes down.
        case type
        /// It stops where it is, sits on its cushion and types.
        case stopAndType
        /// It wakes up and types (the person is back).
        case wakeAndType
    }

    public static func reply(to doing: Doing) -> Reply {
        switch doing {
        case .resting, .moment: .type
        case .walking: .stopAndType
        case .sleeping: .wakeAndType
        case .answering, .dragging, .hidden: .ignore
        }
    }
}

/// Where typing is heard from, and who shows it (Mac). In this app: a key-down watcher while the cat is out. In all
/// apps: a listen-only key-down tap, only once the person turned it on and macOS's Input Monitoring allows it.
public enum TypingSource: String, Sendable {
    case none, app, everywhere

    public static func of(scope: TypingCat.Scope, granted: Bool, petShown: Bool) -> TypingSource {
        guard petShown else { return .none }
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

/// The small cat over full-screen apps (Mac): in all apps, allowed, the person didn't turn it off, the pet is out and its
/// spot above the Dock can't be seen (a full-screen app covers it). Never both at once: one of them shows.
public enum TypingCompanion {
    public enum Corner: String, CaseIterable, Sendable {
        case topLeft, topRight, bottomLeft, bottomRight
        public static let fallback = Corner.bottomRight
        public init(saved: String?) { self = saved.flatMap(Corner.init(rawValue:)) ?? .fallback }
    }

    /// Its first size (points); 96 and 128 are the ones to compare on a real screen.
    public static let size: CGFloat = 112
    public static let margin: CGFloat = 20

    public static func shows(source: TypingSource, enabled: Bool, petShown: Bool, dockCovered: Bool, locked: Bool) -> Bool {
        source == .everywhere && enabled && petShown && dockCovered && !locked
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
