import AppKit
import SwiftUI

struct TaskRowDrop: Equatable {
    let source: UUID
    let target: UUID
    let after: Bool

    static func destination(source: UUID, rows: [UUID], offsetFromSourceTop: CGFloat) -> TaskRowDrop? {
        guard let index = rows.firstIndex(of: source), !rows.isEmpty else { return nil }
        let position = CGFloat(index) * PaperTheme.rowHeight + offsetFromSourceTop
        let targetIndex = max(0, min(rows.count - 1, Int(floor(position / PaperTheme.rowHeight))))
        let after = position - CGFloat(targetIndex) * PaperTheme.rowHeight >= PaperTheme.rowHeight / 2
        return TaskRowDrop(source: source, target: rows[targetIndex], after: after)
    }
}

/// Tracks only the grip's mouse gesture; it never asks AppKit to move the window.
struct PaperTaskDragHandle: NSViewRepresentable {
    let onUpdate: (CGFloat) -> Void
    let onFinish: (Bool) -> Void
    /// The page tab under the pointer while dragging (nil when not over one).
    var onTabHover: (AppModel.Page?) -> Void = { _ in }
    /// Dropped on a page tab instead of between rows.
    var onTabDrop: (AppModel.Page) -> Void = { _ in }
    /// Where the pointer is while dragging, from the content's top-left (the 앞으로 days use it).
    var onPoint: (CGPoint) -> Void = { _ in }
    /// #168: the badge on the picture that follows the pointer ("3개" for several rows), asked at the press.
    var badge: () -> String? = { nil }

    func makeNSView(context: Context) -> GripView { GripView() }
    func updateNSView(_ view: GripView, context: Context) {
        view.onUpdate = onUpdate
        view.onFinish = onFinish
        view.onTabHover = onTabHover
        view.onTabDrop = onTabDrop
        view.onPoint = onPoint
        view.badge = badge
    }

    final class GripView: NSView {
        /// The bench (#167): run after each move, to draw the frame as on screen.
        static var afterMove: (() -> Void)?
        var onUpdate: (CGFloat) -> Void = { _ in }
        var onFinish: (Bool) -> Void = { _ in }
        var onTabHover: (AppModel.Page?) -> Void = { _ in }
        var onTabDrop: (AppModel.Page) -> Void = { _ in }
        var onPoint: (CGPoint) -> Void = { _ in }
        var badge: () -> String? = { nil }
        override var mouseDownCanMoveWindow: Bool { false }
        override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
        override func resetCursorRects() { addCursorRect(bounds, cursor: .openHand) }

        override func draw(_ dirtyRect: NSRect) {
            NSColor(PaperTheme.secondary).withAlphaComponent(0.7).setFill()
            for column in 0..<2 {
                for row in 0..<3 {
                    NSBezierPath(ovalIn: NSRect(x: bounds.midX - 3.75 + CGFloat(column) * 5,
                                               y: bounds.midY - 6.25 + CGFloat(row) * 5,
                                               width: 2.5, height: 2.5)).fill()
                }
            }
        }

        /// #167: how near the list's top or bottom edge (pt) the list starts to scroll, and its fastest step per tick
        /// (a tick is 1/60 s while the pointer waits there).
        static let scrollEdge: CGFloat = 40
        static let fastestStep: CGFloat = 24

        override func mouseDown(with event: NSEvent) {
            guard let window else { return }
            let start = event.locationInWindow
            // Where the row's top was at the press, and how far the list has scrolled since (down: +): the place in
            // the list is worked out from these, so it holds when the row scrolls out of view and its grip goes.
            let startTop = convert(NSPoint(x: bounds.midX, y: bounds.maxY), to: nil)
            var scrolled: CGFloat = 0
            let ownScroll = enclosingScrollView
            var dragging = false
            var overTab: AppModel.Page?
            var last = start
            var ghost: DragGhost?
            defer {
                ghost?.removeFromSuperview()
                if dragging { NSCursor.pop() }
                if overTab != nil { onTabHover(nil) }
                onFinish(false)
            }
            /// The list's drop place and the page's pointer for `point` (window coordinates).
            func report(_ point: NSPoint) {
                onUpdate(startTop.y + scrolled - point.y)
                if let content = window.contentView {
                    let local = content.convert(point, from: nil)
                    let fromTop = content.isFlipped ? local.y - content.bounds.minY : content.bounds.maxY - local.y
                    onPoint(CGPoint(x: local.x - content.bounds.minX, y: fromTop))
                }
                Self.afterMove?()
            }
            while true {
                // While dragging, a tick every 1/60 s with no event: the list keeps scrolling near an edge.
                let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp, .keyDown],
                                            until: dragging ? Date(timeIntervalSinceNow: 1.0 / 60) : .distantFuture,
                                            inMode: .eventTracking, dequeue: true)
                guard let next else {
                    if dragging, overTab == nil, let step = Self.autoScroll(at: last, in: window, fallback: ownScroll) {
                        scrolled += step
                        window.contentView?.layoutSubtreeIfNeeded()
                        report(last)
                    }
                    continue
                }
                if next.type == .keyDown {
                    if next.keyCode == 53 { return }
                    continue
                }
                let point = next.locationInWindow
                if !dragging && hypot(point.x - start.x, point.y - start.y) >= 3 {
                    dragging = true
                    NSCursor.closedHand.push()
                    ghost = DragGhost.lift(self, in: window, badge: badge())
                }
                if dragging {
                    let tab = (window as? NoteWindow)?.tab(at: point)
                    if tab != overTab { overTab = tab; onTabHover(tab) }
                    ghost?.follow(dx: point.x - start.x, dy: point.y - start.y)
                    // A move within the same point (a pressure change) changes nothing.
                    if point != last || next.type == .leftMouseUp {
                        last = point
                        report(point)
                    }
                }
                if next.type == .leftMouseUp {
                    if dragging, let tab = overTab {
                        onTabDrop(tab)
                        return
                    }
                    if dragging, let content = window.contentView {
                        let local = content.convert(point, from: nil)
                        let fromTop = content.isFlipped ? local.y - content.bounds.minY : content.bounds.maxY - local.y
                        onFinish(content.bounds.contains(local) && fromTop >= NoteWindow.headerHeight && fromTop < content.bounds.height - 42)
                    }
                    return
                }
            }
        }

        /// #167: the pointer within 40 pt of a list's top or bottom edge (or past it) scrolls that list — faster the
        /// nearer the edge — and of its left or right edge one that scrolls sideways. The list under the pointer, else the
        /// row's own. Returns how far it scrolled down (up: −), nil when it didn't.
        static func autoScroll(at point: NSPoint, in window: NSWindow, fallback: NSScrollView?) -> CGFloat? {
            var under: NSScrollView?
            if let content = window.contentView, let frame = content.superview {
                under = content.hitTest(frame.convert(point, from: nil))?.enclosingScrollView
            }
            let scrolls = { (scroll: NSScrollView?) -> Bool in
                guard let scroll, let document = scroll.documentView else { return false }
                return document.frame.height > scroll.contentView.bounds.height + 1 || document.frame.width > scroll.contentView.bounds.width + 1
            }
            guard let scroll = scrolls(under) ? under : scrolls(fallback) ? fallback : nil, let document = scroll.documentView else { return nil }
            let frame = scroll.convert(scroll.bounds, to: nil)
            func step(_ distance: CGFloat) -> CGFloat {
                let near = 1 - max(0, min(distance, scrollEdge)) / scrollEdge
                return (4 + (fastestStep - 4) * near).rounded()
            }
            let clip = scroll.contentView
            var origin = clip.bounds.origin
            var down: CGFloat = 0
            if document.frame.height > clip.bounds.height + 1 {
                let fromTop = frame.maxY - point.y, fromBottom = point.y - frame.minY
                if fromTop < scrollEdge { down = -step(fromTop) } else if fromBottom < scrollEdge { down = step(fromBottom) }
                let top = clip.isFlipped ? origin.y + down : origin.y - down
                origin.y = min(max(top, 0), document.frame.height - clip.bounds.height)
            }
            if document.frame.width > clip.bounds.width + 1, point.y >= frame.minY, point.y <= frame.maxY {
                let fromLeft = point.x - frame.minX, fromRight = frame.maxX - point.x
                let side: CGFloat = fromLeft < scrollEdge ? -step(fromLeft) : fromRight < scrollEdge ? step(fromRight) : 0
                origin.x = min(max(origin.x + side, 0), document.frame.width - clip.bounds.width)
            }
            guard origin != clip.bounds.origin else { return nil }
            let moved = clip.isFlipped ? origin.y - clip.bounds.origin.y : clip.bounds.origin.y - origin.y
            clip.scroll(to: origin)
            scroll.reflectScrolledClipView(clip)
            return moved
        }
    }
}

/// #167: a picture of the dragged row that follows the pointer (lifted a little, with a shadow), drawn once at the
/// press and only moved after — the row stays where it was, faded, until the drop.
final class DragGhost: NSView {
    private var home: NSPoint = .zero

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    /// The row the grip is on: the grip's height, from the grip to the list's right edge. #168: `badge` ("3개") on its
    /// top right corner when several rows go.
    @MainActor static func lift(_ grip: NSView, in window: NSWindow, badge: String? = nil) -> DragGhost? {
        guard let content = window.contentView else { return nil }
        let gripFrame = grip.convert(grip.bounds, to: content)
        let right = grip.enclosingScrollView.map { $0.convert($0.bounds, to: content).maxX } ?? content.bounds.maxX
        let rect = NSRect(x: gripFrame.minX, y: gripFrame.minY, width: max(40, right - gripFrame.minX - 6), height: gripFrame.height).integral
        guard let bitmap = content.bitmapImageRepForCachingDisplay(in: rect) else { return nil }
        content.cacheDisplay(in: rect, to: bitmap)
        // Through a CGImage: the bitmap of the (flipped) note, put in an NSImage as a rep, was drawn upside down.
        guard let cgImage = bitmap.cgImage else { return nil }
        let image = NSImage(cgImage: cgImage, size: rect.size)
        let ghost = DragGhost(frame: rect)
        ghost.home = rect.origin
        ghost.wantsLayer = true
        let picture = NSImageView(frame: ghost.bounds)
        picture.image = image
        picture.imageScaling = .scaleAxesIndependently
        picture.autoresizingMask = [.width, .height]
        ghost.addSubview(picture)
        if let badge { ghost.addSubview(DragBadge(badge, in: ghost.bounds)) }
        ghost.layer?.cornerRadius = 6
        ghost.layer?.backgroundColor = NSColor(PaperTheme.card).cgColor
        ghost.layer?.borderColor = NSColor(PaperTheme.rule).cgColor
        ghost.layer?.borderWidth = 1
        ghost.layer?.shadowOpacity = 0.22
        ghost.layer?.shadowRadius = 10
        ghost.layer?.shadowOffset = CGSize(width: 0, height: -5)
        ghost.layer?.masksToBounds = false
        ghost.alphaValue = 0.95
        content.addSubview(ghost)
        return ghost
    }

    /// Moved by the pointer's travel since the press (window coordinates, y up) — by its layer only, so the note's view
    /// isn't laid out again for it.
    func follow(dx: CGFloat, dy: CGFloat) {
        guard let content = superview, let layer else { return }
        // AppKit keeps a layer-backed view's layer in its superview's coordinates (a flipped superview's layer is
        // geometry-flipped), so the layer moves as the view's frame would.
        let flip: CGFloat = content.isFlipped ? -1 : 1
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.setAffineTransform(CGAffineTransform(translationX: dx, y: dy * flip))
        CATransaction.commit()
    }

    /// Snapshots: moved by its frame (a bitmap of the view doesn't draw a layer's transform).
    func place(dx: CGFloat, dy: CGFloat) {
        let flip: CGFloat = superview?.isFlipped == true ? -1 : 1
        setFrameOrigin(NSPoint(x: home.x + dx, y: home.y + dy * flip))
    }
}

/// #168: "3개" — how many rows a drag takes — on the dragged picture's top right corner, in a sage capsule.
final class DragBadge: NSView {
    private let text: NSAttributedString

    init(_ label: String, in bounds: NSRect) {
        text = NSAttributedString(string: label, attributes: [
            .font: NSFont.systemFont(ofSize: 11, weight: .bold),
            .foregroundColor: NSColor(PaperTheme.onSage),
        ])
        let size = NSSize(width: ceil(text.size().width) + 14, height: 20)
        // On the top right corner, a little over the edge (the picture's own coordinates: y up).
        let y = bounds.maxY - size.height + 6
        super.init(frame: NSRect(x: bounds.maxX - size.width - 8, y: y, width: size.width, height: size.height))
        setAccessibilityElement(false)
    }

    required init?(coder: NSCoder) { nil }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func draw(_ dirtyRect: NSRect) {
        NSColor(PaperTheme.sage).setFill()
        NSBezierPath(roundedRect: bounds, xRadius: bounds.height / 2, yRadius: bounds.height / 2).fill()
        let size = text.size()
        text.draw(at: NSPoint(x: (bounds.width - size.width) / 2, y: (bounds.height - size.height) / 2))
    }
}
