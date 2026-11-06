import AppKit

@MainActor
/// An AppKit view in the note's header that takes clicks itself; the header's window drag leaves it alone.
protocol HeaderClickable: NSView {}

final class NoteWindow: NSWindow {
    static let headerHeight: CGFloat = NoteHeader.height
    /// The top row holds the window buttons, the page tabs and the tools; those take clicks.
    /// Everything else in the header — the empty stretch of the top row and the title row —
    /// drags the window (and a double-click folds it).
    static let toolbarHeight: CGFloat = 38
    /// Where the window buttons sit, from the left edge.
    static let windowButtonsWidth: CGFloat = 76
    /// The tabs' and tools' frames, measured from the top-left of the content (reported by the header).
    var toolbarControlFrames: [CGRect] = []
    /// How far down the header drags the window: the whole header, or only the top row while the
    /// focus card shows (its ring and buttons take clicks).
    var dragHeight: CGFloat = NoteWindow.headerHeight
    /// Each page tab's frame (top-left content coordinates), for dropping a task on a tab.
    var tabFrames: [AppModel.Page: CGRect] = [:]

    /// The tab under a point in window coordinates, if any.
    func tab(at windowPoint: NSPoint) -> AppModel.Page? {
        guard let contentView else { return nil }
        let local = contentView.convert(windowPoint, from: nil)
        let fromTop = contentView.isFlipped ? local.y - contentView.bounds.minY : contentView.bounds.maxY - local.y
        let point = CGPoint(x: local.x - contentView.bounds.minX, y: fromTop)
        return tabFrames.first { $0.value.insetBy(dx: -2, dy: -4).contains(point) }?.key
    }

    /// `contentPoint` in the content view's coordinates.
    func isOverToolbar(_ contentPoint: NSPoint) -> Bool {
        guard let contentView else { return false }
        let bounds = contentView.bounds
        let fromTop = contentView.isFlipped ? contentPoint.y - bounds.minY : bounds.maxY - contentPoint.y
        guard fromTop < Self.toolbarHeight else { return false }
        let x = contentPoint.x - bounds.minX
        if x < Self.windowButtonsWidth { return true }
        // Before the header has reported its controls, keep the whole row clickable.
        guard !toolbarControlFrames.isEmpty else { return true }
        let point = CGPoint(x: x, y: fromTop)
        return toolbarControlFrames.contains { $0.insetBy(dx: -3, dy: -3).contains(point) }
    }
    var onMinimize: (() -> Void)?
    /// Keys for the list (↑↓, Space, Return, ⌫, ⌘↑↓, Esc); returns whether one was used.
    var onListKey: ((AppModel.ListKey) -> Bool)?
    /// 하루 일정표 (1.40): while the open day has the keys (↑ ↓ Return Space ⌥↑ ⌥↓ Esc), they go to it before the list.
    var onTimetableKey: ((NSEvent) -> Bool)?

    /// Turns a key press into a list command, unless someone is typing. In an empty input
    /// line, ↑ leaves the line and selects the last row.
    private func listKey(for event: NSEvent) -> AppModel.ListKey? {
        let flags = event.modifierFlags.intersection([.command, .option, .control, .shift])
        let typing = firstResponder is NSText
        if typing {
            guard flags.isEmpty, let editor = firstResponder as? NSText, editor.string.isEmpty else { return nil }
            return event.keyCode == 126 ? .upFromInput : event.keyCode == 125 ? .downFromInput : nil
        }
        switch (event.keyCode, flags) {
        case (126, []): return .up
        case (125, []): return .down
        case (49, []): return .toggle
        case (36, []), (76, []): return .edit
        case (51, []), (117, []): return .delete
        case (126, [.command]): return .moveUp
        case (125, [.command]): return .moveDown
        // 2b (S44): ⌥⌘↑ · ⌥⌘↓ to the group above or below.
        // #168: ⇧↑ · ⇧↓ pick more rows (or fewer).
        case (126, [.shift]): return .extendUp
        case (125, [.shift]): return .extendDown
        case (126, [.command, .option]): return .groupUp
        case (125, [.command, .option]): return .groupDown
        case (53, []): return .clear
        // 1.38: ⌥→ / ⌥← a day later or earlier, ⌥↓ 언젠가, F 이거 집중.
        case (124, [.option]): return .later
        case (123, [.option]): return .earlier
        case (125, [.option]): return .someday
        case (3, []): return .focus
        default: return nil
        }
    }

    override init(contentRect: NSRect, styleMask style: NSWindow.StyleMask, backing backingStoreType: NSWindow.BackingStoreType, defer flag: Bool) {
        super.init(contentRect: contentRect, styleMask: style, backing: backingStoreType, defer: flag)
        isMovable = false
        isMovableByWindowBackground = false
    }

    /// `--offscreen` (the performance check): the note stays where it was put, far off every screen. A titled window
    /// is pulled back onto a screen as it comes up — the check's note came up at the screen's left edge.
    var keepsOffscreen = false

    /// Not in a check's run (#217): if the system makes the app active anyway (a switch of Spaces can), no window of it
    /// may take the person's typing.
    override var canBecomeKey: Bool { !TestHooks.staysBehind && super.canBecomeKey }

    /// A check's run (#217): this would be the key window now, though it never becomes one (PerfDrive's keys go here).
    override func makeKeyAndOrderFront(_ sender: Any?) {
        super.makeKeyAndOrderFront(sender)
        PerfDrive.wouldBeKey(self)
    }

    /// The level changed (항상 위에 두기): the ears above the note (NoteEars.swift) take the same one.
    var onLevelChange: (() -> Void)?
    override var level: NSWindow.Level {
        didSet { if level != oldValue { onLevelChange?() } }
    }

    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        keepsOffscreen ? frameRect : super.constrainFrameRect(frameRect, to: screen)
    }

    func canStartHeaderDrag(at point: NSPoint) -> Bool {
        guard let contentView else { return false }
        let contentPoint = contentView.convert(point, from: nil)
        let bounds = contentView.bounds
        let fromTop = contentView.isFlipped ? contentPoint.y - bounds.minY : bounds.maxY - contentPoint.y
        let x = contentPoint.x - bounds.minX
        // The window's top edge and its top corners resize it (AppKit does that after us): leave them alone, or a
        // press on the top-right corner moved the note instead of resizing it.
        let onEdge = fromTop < Self.resizeBorder || x < Self.resizeBorder || x > bounds.width - Self.resizeBorder
        let inCorner = fromTop < Self.resizeCorner && (x < Self.resizeCorner || x > bounds.width - Self.resizeCorner)
        return bounds.contains(contentPoint) && fromTop >= 0 && fromTop < dragHeight && !onEdge && !inCorner
            && !isOverToolbar(contentPoint) && !isOverHeaderButton(point)
    }

    /// A button of ours below the top row (모든 스페이스 ▾ on the date line): its press is a click, not a drag.
    private func isOverHeaderButton(_ windowPoint: NSPoint) -> Bool {
        guard let contentView, let frameView = contentView.superview else { return false }
        var view = contentView.hitTest(frameView.convert(windowPoint, from: nil))
        while let current = view, current !== contentView {
            if current is HeaderClickable { return true }
            view = current.superview
        }
        return false
    }

    /// How far in from the top and side edges a press resizes the window, and the size of a top corner's square.
    static let resizeBorder: CGFloat = 5
    static let resizeCorner: CGFloat = 12

    override func performDrag(with event: NSEvent) {
        guard event.window === self, event.type == .leftMouseDown,
              canStartHeaderDrag(at: event.locationInWindow) else { return }
        // Keep automatic movement disabled, including while a header gesture runs.
        let origin = frame.origin
        let start = convertPoint(toScreen: event.locationInWindow)
        while let next = nextEvent(matching: [.leftMouseDragged, .leftMouseUp, .keyDown],
                                   until: .distantFuture, inMode: .eventTracking, dequeue: true) {
            if next.type == .keyDown {
                if next.keyCode == 53 { setFrameOrigin(origin); return }
                continue
            }
            let current = convertPoint(toScreen: next.locationInWindow)
            setFrameOrigin(NSPoint(x: origin.x + current.x - start.x, y: origin.y + current.y - start.y))
            if next.type == .leftMouseUp { return }
        }
    }

    /// ⌘F 검색, and the focus card's ⌘↩ 다 했어요 · ⌘= 5분 더 — before the menus (⌘= is also 글자 크게).
    var onKeyEquivalent: ((NSEvent) -> Bool)?

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.type == .keyDown, onKeyEquivalent?(event) == true { return true }
        return super.performKeyEquivalent(with: event)
    }

    override func miniaturize(_ sender: Any?) {
        if let onMinimize { onMinimize() }
        else { super.miniaturize(sender) }
    }

    /// The note's own keys, before AppKit's: the open day's, then the list's. Whether one was used (also for PerfDrive).
    func handleOwnKey(_ event: NSEvent) -> Bool {
        if event.type == .keyDown, !(firstResponder is NSText), onTimetableKey?(event) == true { return true }
        if event.type == .keyDown, let key = listKey(for: event), onListKey?(key) == true {
            if firstResponder is NSText { makeFirstResponder(nil) }
            return true
        }
        return false
    }

    override func sendEvent(_ event: NSEvent) {
        if handleOwnKey(event) { return }
        recordInteraction(event, phase: "before")
        if event.type == .leftMouseDown, event.clickCount == 1,
           canStartHeaderDrag(at: event.locationInWindow) {
            performDrag(with: event)
        } else {
            super.sendEvent(event)
        }
        recordInteraction(event, phase: "after")
    }

    private func recordInteraction(_ event: NSEvent, phase: String) {
        guard [.leftMouseDown, .leftMouseDragged, .leftMouseUp].contains(event.type),
              let index = TestHooks.arguments.firstIndex(of: "--interaction-log"),
              TestHooks.arguments.indices.contains(index + 1),
              let contentView else { return }
        let point = contentView.convert(event.locationInWindow, from: nil)
        let record: [String: Any] = [
            "phase": phase, "type": event.type.rawValue,
            "x": event.locationInWindow.x, "y": event.locationInWindow.y,
            "windowX": frame.minX, "windowY": frame.minY, "header": canStartHeaderDrag(at: event.locationInWindow),
            "hit": contentView.hitTest(point).map { String(describing: type(of: $0)) } ?? "none"
        ]
        guard var data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) else { return }
        data.append(10)
        let path = TestHooks.arguments[index + 1]
        if !FileManager.default.fileExists(atPath: path) { FileManager.default.createFile(atPath: path, contents: nil) }
        guard let handle = FileHandle(forWritingAtPath: path) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
    }
}
