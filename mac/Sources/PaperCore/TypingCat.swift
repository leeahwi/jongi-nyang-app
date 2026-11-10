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
        /// #331: 옮긴 자리 — where the cat was dragged to (`TypingPlace`), chosen by the drag itself.
        case moved
        public static let fallback = Corner.bottomRight
        /// The four corners (Settings lists 옮긴 자리 after them once there is one).
        public static let corners: [Corner] = [.topLeft, .topRight, .bottomLeft, .bottomRight]
        public init(saved: String?) { self = saved.flatMap(Corner.init(rawValue:)) ?? .fallback }
        /// #289: as saved now, or else as the Mac's 전체 화면에서 보이기 corner (`pet.companion.corner`) left it.
        public init(saved: String?, before: String?) { self.init(saved: saved ?? before) }
    }

    /// Its size (points).
    public static let size: CGFloat = 112
    public static let margin: CGFloat = 20

    /// Whether the cat is in its corner now: heard in all apps (always), or in this app within `linger` of the last key.
    /// #331: while it is being dragged it stays (종이냥에서만 waits), and once let go (`dropped`, the time) it stays
    /// `linger` from then as after a key.
    public static func shows(source: TypingSource, lastKey: Double?, now: Double, dragging: Bool = false, dropped: Double? = nil) -> Bool {
        switch source {
        case .none: return false
        case .everywhere: return true
        case .app:
            if dragging { return true }
            let last = [lastKey, dropped].compactMap { $0 }.max()
            return last.map { now - $0 < TypingCat.linger } ?? false
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
        // 옮긴 자리 without a place kept: the corner it sits in unless changed.
        case .bottomRight, .moved: return CGRect(x: right, y: bottom, width: side, height: side)
        }
    }

    /// #331: the cat's drawn area — the cat and its cushion — as 16 bands from the top of its picture, each the part
    /// across it (fractions of the side) that has paint in any of the three poses; nil where there is none. The rest of
    /// the square is clear, and a press there goes to the app behind. The same table as Windows' `typingCatDrawn`.
    public static let drawn: [ClosedRange<Double>?] = [
        nil, 0.296875...0.796875, 0.265625...0.828125, 0.25...0.859375, 0.21875...0.90625, 0.203125...0.90625,
        0.171875...0.90625, 0.171875...0.890625, 0.171875...0.890625, 0.125...0.875, 0.125...0.828125, 0.125...0.828125,
        0.078125...0.859375, 0.078125...0.875, 0.09375...0.875, nil,
    ]

    /// Whether `point` is on the cat drawn in `frame` (both in the same y-up coordinates).
    public static func isOnCat(_ point: CGPoint, frame: CGRect) -> Bool {
        guard frame.width > 0, frame.height > 0, frame.contains(point) else { return false }
        let down = (frame.maxY - point.y) / frame.height
        let band = min(drawn.count - 1, max(0, Int(down * CGFloat(drawn.count))))
        guard let across = drawn[band] else { return false }
        return across.contains(Double((point.x - frame.minX) / frame.width))
    }

    /// The box around the drawn area in `frame` (for how near the pointer is).
    public static func catBox(in frame: CGRect) -> CGRect {
        let rows = drawn.enumerated().compactMap { index, across in across.map { (index, $0) } }
        guard let first = rows.first, let last = rows.last else { return frame }
        let left = rows.map(\.1.lowerBound).min()!, right = rows.map(\.1.upperBound).max()!
        let count = CGFloat(drawn.count)
        return CGRect(x: frame.minX + frame.width * left, y: frame.maxY - frame.height * CGFloat(last.0 + 1) / count,
                      width: frame.width * (right - left), height: frame.height * CGFloat(last.0 + 1 - first.0) / count)
    }

    /// A display as the cat's place sees it: its id (Mac: NSScreenNumber; Windows: the display's id) and its areas.
    public struct Screen: Equatable, Sendable {
        public var id: String
        public var display: ScreenFit.Display
        public init(id: String, display: ScreenFit.Display) { self.id = id; self.display = display }
    }

    /// #331: where it sits as 자리 says: 옮긴 자리 with a place kept (and a display to put it on) there; otherwise the
    /// corner of `screen` (옮긴 자리 with nothing kept: bottom right). A corner leaves the kept place as it is.
    public static func frame(corner: Corner, place: TypingPlace?, screen: CGRect, topInset: CGFloat, size: CGFloat = size,
                             on screens: [Screen]) -> CGRect {
        if corner == .moved, let place, let frame = frame(place: place, size: size, on: screens) { return frame }
        return frame(corner: corner, screen: screen, topInset: topInset, size: size)
    }

    /// #331: let go at `frame` (the window as the drag left it): moved wholly inside the usable area of the display it is
    /// mostly on (or the nearest), and the place to keep for it there. No displays: nil.
    public static func dropped(_ frame: CGRect, on screens: [Screen]) -> (frame: CGRect, place: TypingPlace)? {
        guard let index = ScreenFit.index(of: frame, in: screens.map(\.display)) else { return nil }
        let kept = ScreenFit.inside(frame, area: screens[index].display.visible)
        return place(of: kept, on: screens).map { (kept, $0) }
    }

    /// The place kept for a cat dropped at `frame`: on the display it is mostly on (or the nearest), its centre as a
    /// fraction of that display's usable area, and the centre itself (to find the nearest display once that one is gone).
    public static func place(of frame: CGRect, on screens: [Screen]) -> TypingPlace? {
        guard let index = ScreenFit.index(of: frame, in: screens.map(\.display)) else { return nil }
        let area = screens[index].display.visible
        guard area.width > 0, area.height > 0 else { return nil }
        return TypingPlace(screen: screens[index].id, x: Double((frame.midX - area.minX) / area.width),
                           y: Double((frame.midY - area.minY) / area.height),
                           centerX: Double(frame.midX), centerY: Double(frame.midY))
    }

    /// The cat's frame at `size` from a kept place: its centre where it was on that display (a size change keeps the
    /// centre; another resolution keeps it as far across), wholly inside that display's usable area. That display gone:
    /// on the display nearest its old centre, inside it. No displays: nil.
    public static func frame(place: TypingPlace, size: CGFloat = size, on screens: [Screen]) -> CGRect? {
        guard !screens.isEmpty else { return nil }
        let index: Int, center: CGPoint
        if let found = screens.firstIndex(where: { $0.id == place.screen }) {
            index = found
            let area = screens[found].display.visible
            center = CGPoint(x: area.minX + area.width * CGFloat(place.x), y: area.minY + area.height * CGFloat(place.y))
        } else {
            center = CGPoint(x: place.centerX, y: place.centerY)
            let near = CGRect(origin: center, size: .zero).insetBy(dx: -size / 2, dy: -size / 2)
            guard let nearest = ScreenFit.index(of: near, in: screens.map(\.display)) else { return nil }
            index = nearest
        }
        let area = screens[index].display.visible
        let side = max(0, min(size, area.width, area.height))
        let rect = CGRect(x: center.x - side / 2, y: center.y - side / 2, width: side, height: side)
        return ScreenFit.inside(rect, area: area)
    }
}

/// #331: 옮긴 자리 — where the typing cat was dragged to, kept across launches and display changes (`typing.place`,
/// Windows `typingPlace`): the display it was dropped on, its centre as a fraction of that display's usable area, and the
/// centre itself.
public struct TypingPlace: Equatable, Sendable {
    public var screen: String
    public var x: Double, y: Double
    public var centerX: Double, centerY: Double
    public init(screen: String, x: Double, y: Double, centerX: Double, centerY: Double) {
        self.screen = screen; self.x = x; self.y = y; self.centerX = centerX; self.centerY = centerY
    }

    /// As saved: a display id and four finite numbers (fractions kept within 0…1), or nothing.
    public init?(saved: [String: Any]?) {
        guard let saved, let screen = saved["screen"] as? String, !screen.isEmpty else { return nil }
        let numbers = ["x", "y", "centerX", "centerY"].compactMap { (saved[$0] as? NSNumber)?.doubleValue }
        guard numbers.count == 4, numbers.allSatisfy(\.isFinite) else { return nil }
        self.init(screen: screen, x: min(1, max(0, numbers[0])), y: min(1, max(0, numbers[1])), centerX: numbers[2], centerY: numbers[3])
    }

    public var saved: [String: Any] { ["screen": screen, "x": x, "y": y, "centerX": centerX, "centerY": centerY] }
}
