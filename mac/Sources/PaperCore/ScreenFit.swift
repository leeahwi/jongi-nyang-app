import CoreGraphics

/// #327: which display a window is on, and how it is kept on that display — the floating windows (the timer, the folded
/// note's icon, the slips, the reminder bubble, the alarm slip) all ask here, so a window dragged onto another display
/// is kept on that one, up to its top edge.
///
/// In AppKit's coordinates: one plane for every display, its origin at the bottom left of the main display (the one
/// with the menu bar in 배치), y going up. A display above the main one starts at its height; one beside it can start
/// lower or higher, one to the left or below has negative x or y. `NSScreen.main` is the display of the key window
/// (often another app's, or not the window being moved), so it is never the answer for where a window is.
public enum ScreenFit {
    /// A display: all of it (`frame`) and the part windows may use (`visible`: without the menu bar and the Dock).
    public struct Display: Equatable, Sendable {
        public var frame: CGRect
        public var visible: CGRect
        public init(frame: CGRect, visible: CGRect) { self.frame = frame; self.visible = visible }
    }

    /// How far a window may go past each edge of the usable area (a part that is empty, a shadow); negative keeps it
    /// that far inside.
    public struct Slack: Equatable, Sendable {
        public var left: CGFloat, right: CGFloat, top: CGFloat, bottom: CGFloat
        public init(left: CGFloat = 0, right: CGFloat = 0, top: CGFloat = 0, bottom: CGFloat = 0) {
            self.left = left; self.right = right; self.top = top; self.bottom = bottom
        }
        /// The same on every edge.
        public static func all(_ value: CGFloat) -> Slack { Slack(left: value, right: value, top: value, bottom: value) }
        public static let zero = Slack()
    }

    /// The display `rect` is on: the one it overlaps most (the first of equals), or — on none — the nearest.
    public static func index(of rect: CGRect, in displays: [Display]) -> Int? {
        var best: (index: Int, overlap: CGFloat)?
        for (index, display) in displays.enumerated() {
            let overlap = area(rect.intersection(display.frame))
            if overlap > 0, overlap > (best?.overlap ?? 0) { best = (index, overlap) }
        }
        return best?.index ?? nearest(displays) { distance(from: rect, to: $0.frame) }
    }

    /// The display with `point` on it, or the nearest. Its top edge counts as on it: the pointer on a display's top
    /// row reads that display's top (`NSEvent.mouseLocation`), which `NSRect.contains` leaves out — so the pointer
    /// at the very top of a display used to fall through to `NSScreen.main`.
    /// `nearest` false: nil for a point on no display (a slip's drag follows such a pointer as it is).
    public static func index(at point: CGPoint, in displays: [Display], nearest orNearest: Bool = true) -> Int? {
        // A point on the line between two displays one above the other is the lower one's top row.
        func across(_ frame: CGRect) -> Bool { point.x >= frame.minX && point.x < frame.maxX }
        if let index = displays.firstIndex(where: { across($0.frame) && point.y > $0.frame.minY && point.y <= $0.frame.maxY }) { return index }
        // The bottom edge of a display with nothing under it (the pointer on the main display's bottom row reads 0).
        if let index = displays.firstIndex(where: { across($0.frame) && point.y == $0.frame.minY }) { return index }
        guard orNearest else { return nil }
        return nearest(displays) { distance(from: CGRect(origin: point, size: .zero), to: $0.frame) }
    }

    /// `rect` moved inside `area`, as far past each edge as `slack` lets it. One wider than the room keeps its left
    /// edge on the room's left; one taller keeps its top on the room's top (a title or a head stays reachable).
    public static func inside(_ rect: CGRect, area: CGRect, slack: Slack = .zero) -> CGRect {
        let lowX = area.minX - slack.left, highX = area.maxX + slack.right - rect.width
        let lowY = area.minY - slack.bottom, highY = area.maxY + slack.top - rect.height
        var moved = rect
        moved.origin.x = highX < lowX ? lowX : min(max(rect.minX, lowX), highX)
        moved.origin.y = highY < lowY ? highY : min(max(rect.minY, lowY), highY)
        return moved
    }

    /// The window `window` moved so its `part` (the bit that has to stay in sight, in the same coordinates) is inside
    /// the usable area of the display that part is mostly on — or the nearest display, when it is on none.
    /// No displays: left where it is.
    public static func kept(_ window: CGRect, part: CGRect, in displays: [Display], slack: Slack = .zero) -> CGRect {
        guard let index = index(of: part, in: displays) else { return window }
        let moved = inside(part, area: displays[index].visible, slack: slack)
        return window.offsetBy(dx: moved.minX - part.minX, dy: moved.minY - part.minY)
    }

    /// The whole window kept on its display.
    public static func kept(_ window: CGRect, in displays: [Display], slack: Slack = .zero) -> CGRect {
        kept(window, part: window, in: displays, slack: slack)
    }

    // MARK: Helpers

    private static func area(_ rect: CGRect) -> CGFloat { rect.isNull || rect.isEmpty ? 0 : rect.width * rect.height }

    private static func distance(from rect: CGRect, to other: CGRect) -> CGFloat {
        let dx = max(0, other.minX - rect.maxX, rect.minX - other.maxX)
        let dy = max(0, other.minY - rect.maxY, rect.minY - other.maxY)
        return dx * dx + dy * dy
    }

    private static func nearest(_ displays: [Display], by distance: (Display) -> CGFloat) -> Int? {
        displays.indices.min { distance(displays[$0]) < distance(displays[$1]) }
    }
}

/// #327: the focus timer's window — 250 × 250 pt at 보통 (TimerSize scales all of it): the cat holding its tag at the
/// bottom, empty room above its head for the speech bubble. What has to stay on the display is the cat and the tag, so
/// the empty top may go past the display's top edge (under the menu bar, or off it): the cat goes right up to the top.
/// It used to keep the whole window in, which stopped the cat about 110 pt below the top on every display.
public enum TimerWindow {
    public static let side: CGFloat = 250
    /// How much of the window's top is empty at 보통: the cat's ears are this far below the window's top edge (measured
    /// on FocusTimerView: the tag 14 pt up, the cat raised 37 pt, its picture's clear top 7 pt). With a to-do's title on
    /// the tag (집중 with the note away) the tag is taller and the cat stands 19 pt higher.
    public static func emptyTop(focusing: Bool) -> CGFloat { focusing ? 93 : 112 }
    /// The window's sides are empty too: it may hang this far past a side. And this far below the usable bottom (the
    /// tilted tag's corner and shadow sit 14 pt above the window's bottom): the tag stays just above the Dock.
    public static let slack = ScreenFit.Slack(left: 40, right: 40, top: 0, bottom: 10)

    /// The window's frame with its cat and tag kept on the display they are mostly on (or the nearest).
    public static func kept(_ frame: CGRect, scale: CGFloat, focusing: Bool, in displays: [ScreenFit.Display]) -> CGRect {
        let body = CGRect(x: frame.minX, y: frame.minY, width: frame.width,
                          height: max(0, frame.height - emptyTop(focusing: focusing) * scale))
        return ScreenFit.kept(frame, part: body, in: displays, slack: slack)
    }
}
