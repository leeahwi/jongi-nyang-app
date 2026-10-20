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

    func makeNSView(context: Context) -> GripView { GripView() }
    func updateNSView(_ view: GripView, context: Context) {
        view.onUpdate = onUpdate
        view.onFinish = onFinish
        view.onTabHover = onTabHover
        view.onTabDrop = onTabDrop
        view.onPoint = onPoint
    }

    final class GripView: NSView {
        var onUpdate: (CGFloat) -> Void = { _ in }
        var onFinish: (Bool) -> Void = { _ in }
        var onTabHover: (AppModel.Page?) -> Void = { _ in }
        var onTabDrop: (AppModel.Page) -> Void = { _ in }
        var onPoint: (CGPoint) -> Void = { _ in }
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

        override func mouseDown(with event: NSEvent) {
            guard let window else { return }
            let start = event.locationInWindow
            var dragging = false
            var overTab: AppModel.Page?
            defer {
                if dragging { NSCursor.pop() }
                if overTab != nil { onTabHover(nil) }
                onFinish(false)
            }
            while let next = window.nextEvent(matching: [.leftMouseDragged, .leftMouseUp, .keyDown],
                                              until: .distantFuture, inMode: .eventTracking, dequeue: true) {
                if next.type == .keyDown {
                    if next.keyCode == 53 { return }
                    continue
                }
                let point = next.locationInWindow
                if !dragging && hypot(point.x - start.x, point.y - start.y) >= 3 {
                    dragging = true
                    NSCursor.closedHand.push()
                }
                if dragging {
                    let tab = (window as? NoteWindow)?.tab(at: point)
                    if tab != overTab { overTab = tab; onTabHover(tab) }
                    _ = autoscroll(with: next)
                    let top = convert(NSPoint(x: bounds.midX, y: bounds.maxY), to: nil)
                    onUpdate(top.y - point.y)
                    if let content = window.contentView {
                        let local = content.convert(point, from: nil)
                        let fromTop = content.isFlipped ? local.y - content.bounds.minY : content.bounds.maxY - local.y
                        onPoint(CGPoint(x: local.x - content.bounds.minX, y: fromTop))
                    }
                    window.contentView?.layoutSubtreeIfNeeded()
                    window.displayIfNeeded()
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
    }
}
