import CoreGraphics
import Foundation

/// 질문 쪽지 옮기기 (#228, docs/plans/slip-move-cases.json; Windows core/slipMove.ts): where a slip goes as it is dragged.
/// In the coordinates people see a screen in — the top left is 0 and y grows downwards (the Mac turns its own over).
public enum SlipMove {
    /// The slip's head (its badge and title) stays on the screen: the top this much of the paper.
    public static let head: CGFloat = 44
    /// Sideways, at least this much of the slip stays on the screen.
    public static let keep: CGFloat = 80

    /// The slip's paper `slip` dragged by `by`, kept with its head inside `area` (the usable part of the screen with the
    /// pointer); nil `area` (the pointer on no screen) follows the drag as it is.
    public static func dragged(_ slip: CGRect, by: CGVector, in area: CGRect?) -> CGPoint {
        var x = slip.minX + by.dx, y = slip.minY + by.dy
        guard let area else { return CGPoint(x: x, y: y) }
        y = min(max(y, area.minY), area.maxY - head)
        x = min(max(x, area.minX + keep - slip.width), area.maxX - keep)
        return CGPoint(x: x, y: y)
    }

    /// #246: where a slip that hangs nowhere (빠른 입력 · 빠른 메모) was dragged, kept per display for the next time it opens:
    /// its top-left from the top-left of the display's usable area, and that area's size then. Top-down coordinates.
    public struct Place: Codable, Equatable, Sendable {
        public var dx: CGFloat
        public var dy: CGFloat
        public var areaWidth: CGFloat
        public var areaHeight: CGFloat

        public init(dx: CGFloat, dy: CGFloat, areaWidth: CGFloat, areaHeight: CGFloat) {
            self.dx = dx; self.dy = dy; self.areaWidth = areaWidth; self.areaHeight = areaHeight
        }
    }

    /// The place to keep for `slip` dropped in `area`.
    public static func place(of slip: CGRect, in area: CGRect) -> Place {
        Place(dx: slip.minX - area.minX, dy: slip.minY - area.minY, areaWidth: area.width, areaHeight: area.height)
    }

    /// Where a slip of `size` opens on `area` from its kept `place` (its top-left, its head kept on the screen as a drag
    /// keeps it); nil — the default spot — when nothing is kept, or the display's area changed size since (another
    /// resolution, a dock moved): a display change brings it back to where it usually opens.
    public static func placed(_ place: Place?, size: CGSize, in area: CGRect) -> CGPoint? {
        guard let place, abs(place.areaWidth - area.width) < 1, abs(place.areaHeight - area.height) < 1 else { return nil }
        let slip = CGRect(x: area.minX + place.dx, y: area.minY + place.dy, width: size.width, height: size.height)
        return dragged(slip, by: .zero, in: area)
    }

    // MARK: #253 — the widgets while a question waits (docs/plans/widget-ask-cases.json)

    /// What is up: no question, a question, or one that replaces the whole list (its answer swaps the list for a backup or
    /// a shared folder's, or the app starts again after the list was swapped: SlipAlert.run(replacesList:)).
    public enum Asked: String, Sendable { case none, question, replacesList }
    /// What was done on a desktop calendar widget or its day sheet: ‹ › paging, hovering, a day opened, the sheet's day
    /// before or after, a line put in, one taken back, or a line opening the note or the desk's calendar.
    public enum WidgetPress: String, Sendable { case page, hover, openSheet, sheetDay, add, undo, open }
    /// works: as ever. waits: held for the answer (the sheet's 넣기 dims; a press nudges the question, the text stays).
    /// front: the window comes forward and the question stays over it. nudge: the question's own window — as #229.
    public enum WidgetOutcome: String, Sendable { case works, waits, front, nudge }

    /// #253: the widgets and their day sheet aren't held up by a question (answering one often means looking at the
    /// calendar). Looking always works; putting in and taking back wait only while the question replaces the whole list
    /// (what went in would be lost with the list); a line that opens the note or the desk brings it forward under the
    /// question — `over`, the window the question was asked over, nudges as a click there would.
    public static func widgetPress(_ press: WidgetPress, up: Asked, over: Bool = false) -> WidgetOutcome {
        guard up != .none else { return .works }
        switch press {
        case .open: return over ? .nudge : .front
        case .add, .undo: return up == .replacesList ? .waits : .works
        case .page, .hover, .openSheet, .sheetDay: return .works
        }
    }
}
