import CoreGraphics
import Foundation

/// #64: how often the app has to hear the mouse. The pet and the calendar widgets let clicks through except right over the
/// cat (or a widget's ears), so they follow the pointer across every app — and a mouse reports 60 to 1,000 moves a
/// second, each one waking the app. Most of them happen far from the cat and the widgets, where nothing changes.
///
/// So after a move far from them, the app stops listening for a moment: the pointer can't reach them sooner than
/// `distance / speed`. Then it looks once where the pointer is. Still moving and still far: another pause. Stopped: it
/// listens again (one wake for the next move, none while the mouse rests). Within `near` + a frame's worth of travel,
/// every move is heard as before.
public enum PointerPace {
    /// Faster than a hand takes the pointer somewhere (points a second). A flick faster than this across the screen
    /// reaches the cat at most `longest` before the app looks again.
    public static let speed: Double = 4_000
    /// This close to the cat or a widget (points), every move is heard: they may have to take the mouse at once.
    public static let near: Double = 40
    /// The longest the app looks away.
    public static let longest: TimeInterval = 0.25
    /// A shorter pause isn't worth stopping for (two wakes instead of one): every move is heard.
    public static let shortest: TimeInterval = 1.0 / 30

    /// How long the app may stop listening after the pointer was `distance` points from the nearest thing that reacts
    /// to it (0 inside it; `.infinity` when nothing does). 0 means: keep hearing every move.
    public static func pause(distance: Double) -> TimeInterval {
        guard !distance.isNaN else { return 0 }
        guard distance.isFinite else { return longest }
        let pause = (distance - near) / speed
        return pause < shortest ? 0 : min(longest, pause)
    }

    /// Points from `point` to the nearest edge of `rect` (0 inside it).
    public static func distance(from point: CGPoint, to rect: CGRect) -> Double {
        let dx = max(rect.minX - point.x, 0, point.x - rect.maxX)
        let dy = max(rect.minY - point.y, 0, point.y - rect.maxY)
        return Double(hypot(dx, dy))
    }

    /// What the app does next.
    public enum Next: Equatable {
        /// Hear every move (no timer: a resting mouse costs nothing).
        case listen
        /// Stop listening and look again after this many seconds.
        case look(after: TimeInterval)
    }

    /// After a move was heard, or after a look (`moved`: the pointer is somewhere else than at the last look) with the
    /// pointer `distance` points from the nearest thing that reacts to it.
    public static func next(moved: Bool, distance: Double) -> Next {
        guard moved else { return .listen }
        let pause = pause(distance: distance)
        return pause > 0 ? .look(after: pause) : .listen
    }
}
