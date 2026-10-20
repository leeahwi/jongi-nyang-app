import AppKit

@MainActor
final class FloatingMascotController {
    private enum Constants {
        static let size = NSSize(width: 110, height: 130)
        static let edgePadding: CGFloat = 12
        static let dragThreshold: CGFloat = 3
        static let savedXKey = "FloatingMascot.origin.x"
        static let savedYKey = "FloatingMascot.origin.y"
    }

    private let preferences: UserDefaults
    private let onRestore: () -> Void
    private var image: NSImage
    private var summary = FloatingNoteSummary(titles: [], remaining: 0, total: 0)
    private var panel: NSPanel?
    private weak var mascotView: FloatingMascotView?
    private var lastRequestedAnchor: NSPoint?
    private var lastResolvedOrigin: NSPoint?

    var isVisible: Bool {
        panel?.isVisible == true
    }

    init(preferences: UserDefaults = .standard, image: NSImage, onRestore: @escaping () -> Void) {
        self.preferences = preferences
        self.image = image
        self.onRestore = onRestore
    }

    func show(near frame: NSRect, anchoredAt anchor: NSPoint? = nil) {
        let panel = panel ?? makePanel()
        updateImage(image)
        let origin = initialOrigin(near: frame, anchoredAt: anchor)
        lastRequestedAnchor = anchor ?? fallbackAnchor(near: frame)
        lastResolvedOrigin = origin
        panel.setFrame(NSRect(origin: origin, size: Constants.size)
            .offsetBy(dx: OffscreenRendering.offset.x, dy: OffscreenRendering.offset.y), display: true)
        panel.orderFrontRegardless()
    }

    func hide() {
        panel?.orderOut(nil)
    }

    /// Where the icon currently sits on screen, including after the person dragged it.
    var iconCenter: NSPoint? {
        guard let panel, panel.isVisible else { return nil }
        return NSPoint(x: panel.frame.midX - OffscreenRendering.offset.x, y: panel.frame.midY - OffscreenRendering.offset.y)
    }

    func updateImage(_ image: NSImage) {
        self.image = image
        mascotView?.image = image
    }

    /// The folded note shows what is actually left instead of placeholder lines.
    func updateSummary(titles: [String], remaining: Int, total: Int) {
        let new = FloatingNoteSummary(titles: titles, remaining: remaining, total: total)
        // Asked every second while a timer runs (the menu bar's tick): only a change is passed on (1.39).
        guard new != summary else { return }
        summary = new
        mascotView?.summary = summary
    }

    func captureSnapshot(at url: URL) {
        guard let view = panel?.contentView,
              let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return }
        view.cacheDisplay(in: view.bounds, to: bitmap)
        guard let data = bitmap.representation(using: .png, properties: [:]) else { return }
        try? data.write(to: url)
        if let panel, let screen = NSScreen.screens.first(where: { $0.frame.contains(NSPoint(x: panel.frame.midX, y: panel.frame.midY)) }) {
            let actualAnchor = NSPoint(x: panel.frame.midX, y: panel.frame.midY)
            let requestedAnchor = lastRequestedAnchor ?? actualAnchor
            let placement: [String: CGFloat] = [
                "iconCenterX": panel.frame.midX,
                "iconCenterY": panel.frame.midY,
                "iconOriginX": panel.frame.minX,
                "iconOriginY": panel.frame.minY,
                "requestedAnchorX": requestedAnchor.x,
                "requestedAnchorY": requestedAnchor.y,
                "anchorDeltaX": panel.frame.midX - requestedAnchor.x,
                "anchorDeltaY": panel.frame.midY - requestedAnchor.y,
                "resolvedOriginX": lastResolvedOrigin?.x ?? panel.frame.minX,
                "resolvedOriginY": lastResolvedOrigin?.y ?? panel.frame.minY,
                "screenCenterX": screen.visibleFrame.midX,
                "screenMinX": screen.visibleFrame.minX,
                "screenMaxX": screen.visibleFrame.maxX,
                "screenMinY": screen.visibleFrame.minY,
                "screenMaxY": screen.visibleFrame.maxY,
                "topGap": screen.visibleFrame.maxY - panel.frame.maxY
            ]
            if let json = try? JSONSerialization.data(withJSONObject: placement, options: [.sortedKeys]) {
                try? json.write(to: url.deletingPathExtension().appendingPathExtension("placement.json"))
            }
        }
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(origin: .zero, size: Constants.size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.title = L("종이냥 · 작은 아이콘")
        panel.level = .floating
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.animationBehavior = .none
        panel.ignoresMouseEvents = false
        panel.acceptsMouseMovedEvents = true
        panel.isMovable = false
        panel.isMovableByWindowBackground = false

        let view = FloatingMascotView(
            frame: NSRect(origin: .zero, size: Constants.size),
            image: image,
            dragThreshold: Constants.dragThreshold,
            onRestore: { [weak self] in self?.onRestore() },
            onHide: { [weak self] in self?.hide() },
            onMoveFinished: { [weak self] origin in self?.finishMove(at: origin) }
        )
        view.summary = summary
        panel.contentView = view
        self.panel = panel
        mascotView = view
        return panel
    }

    private func initialOrigin(near frame: NSRect, anchoredAt anchor: NSPoint?) -> NSPoint {
        let visibleFrames = NSScreen.screens.map(\.visibleFrame)
        guard !visibleFrames.isEmpty else {
            return FloatingMascotPlacement.origin(centeredAt: anchor ?? .zero, size: Constants.size, visibleFrames: [.zero], edgePadding: Constants.edgePadding)
        }
        return FloatingMascotPlacement.origin(centeredAt: anchor ?? fallbackAnchor(near: frame), size: Constants.size, visibleFrames: visibleFrames, edgePadding: Constants.edgePadding)
    }

    private func fallbackAnchor(near frame: NSRect) -> NSPoint {
        guard !frame.isEmpty else {
            let visibleFrame = NSScreen.main?.visibleFrame ?? NSScreen.screens.first?.visibleFrame ?? .zero
            return NSPoint(x: visibleFrame.midX, y: visibleFrame.maxY - Constants.edgePadding - Constants.size.height / 2)
        }
        return NSPoint(x: frame.midX, y: frame.maxY - 42)
    }

    private func save(origin: NSPoint) {
        preferences.set(origin.x, forKey: Constants.savedXKey)
        preferences.set(origin.y, forKey: Constants.savedYKey)
    }

    private func finishMove(at origin: NSPoint) {
        let origin = clampedOrigin(origin)
        panel?.setFrameOrigin(origin)
        save(origin: origin)
    }

    private func clampedOrigin(_ origin: NSPoint) -> NSPoint {
        let visibleFrames = NSScreen.screens.map(\.visibleFrame)
        guard !visibleFrames.isEmpty else { return origin }

        let currentFrame = NSRect(origin: origin, size: Constants.size)
        let targetFrame = visibleFrames.first { $0.intersects(currentFrame) }
            ?? visibleFrames.first { $0.contains(origin) }
            ?? NSScreen.main?.visibleFrame
            ?? visibleFrames[0]

        return clampedOrigin(origin, in: targetFrame)
    }

    private func clampedOrigin(_ origin: NSPoint, in targetFrame: NSRect) -> NSPoint {
        return NSPoint(
            x: min(max(origin.x, targetFrame.minX + Constants.edgePadding), targetFrame.maxX - Constants.size.width - Constants.edgePadding),
            y: min(max(origin.y, targetFrame.minY + Constants.edgePadding), targetFrame.maxY - Constants.size.height - Constants.edgePadding)
        )
    }

}

struct FloatingMascotPlacement {
    /// Unfolds the note around the icon: the spot on the note that the icon was folded into
    /// follows the icon, and the whole note stays on the icon's display.
    static func noteOrigin(iconCenter: NSPoint, anchorInNote: NSPoint, noteSize: NSSize, visibleFrames: [NSRect]) -> NSPoint {
        let proposed = NSPoint(x: iconCenter.x - anchorInNote.x, y: iconCenter.y - anchorInNote.y)
        guard let screen = targetVisibleFrame(for: iconCenter, visibleFrames: visibleFrames) else { return proposed }
        let x = noteSize.width >= screen.width ? screen.minX : min(max(proposed.x, screen.minX), screen.maxX - noteSize.width)
        // A note taller than the display keeps its top (and window controls) reachable.
        let y = noteSize.height >= screen.height ? screen.maxY - noteSize.height : min(max(proposed.y, screen.minY), screen.maxY - noteSize.height)
        return NSPoint(x: x, y: y)
    }

    static func origin(centeredAt anchor: NSPoint, size: NSSize, visibleFrames: [NSRect], edgePadding: CGFloat) -> NSPoint {
        guard let targetFrame = targetVisibleFrame(for: anchor, visibleFrames: visibleFrames) else {
            return NSPoint(x: anchor.x - size.width / 2, y: anchor.y - size.height / 2)
        }
        let proposed = NSPoint(x: anchor.x - size.width / 2, y: anchor.y - size.height / 2)
        return clampedOrigin(proposed, size: size, in: targetFrame, edgePadding: edgePadding)
    }

    private static func targetVisibleFrame(for anchor: NSPoint, visibleFrames: [NSRect]) -> NSRect? {
        if let containing = visibleFrames.first(where: { $0.contains(anchor) }) {
            return containing
        }
        return visibleFrames.min { lhs, rhs in
            squaredDistance(from: anchor, to: lhs) < squaredDistance(from: anchor, to: rhs)
        }
    }

    private static func clampedOrigin(_ origin: NSPoint, size: NSSize, in targetFrame: NSRect, edgePadding: CGFloat) -> NSPoint {
        NSPoint(
            x: clamp(origin.x, min: targetFrame.minX + edgePadding, max: targetFrame.maxX - size.width - edgePadding),
            y: clamp(origin.y, min: targetFrame.minY + edgePadding, max: targetFrame.maxY - size.height - edgePadding)
        )
    }

    private static func squaredDistance(from point: NSPoint, to rect: NSRect) -> CGFloat {
        let dx = distance(point.x, min: rect.minX, max: rect.maxX)
        let dy = distance(point.y, min: rect.minY, max: rect.maxY)
        return dx * dx + dy * dy
    }

    private static func distance(_ value: CGFloat, min minimum: CGFloat, max maximum: CGFloat) -> CGFloat {
        if value < minimum { return minimum - value }
        if value > maximum { return value - maximum }
        return 0
    }

    private static func clamp(_ value: CGFloat, min minimum: CGFloat, max maximum: CGFloat) -> CGFloat {
        guard minimum <= maximum else { return (minimum + maximum) / 2 }
        return Swift.min(Swift.max(value, minimum), maximum)
    }
}

struct FloatingNoteSummary: Equatable {
    var titles: [String]
    var remaining: Int
    var total: Int

    var caption: String {
        total == 0 ? L("비어 있어요") : remaining == 0 ? L("다 했어요") : L("\(remaining)개 남음")
    }
}

@MainActor
private final class FloatingMascotView: NSView {
    var image: NSImage {
        didSet { needsDisplay = true }
    }
    var summary = FloatingNoteSummary(titles: [], remaining: 0, total: 0) {
        didSet {
            guard summary != oldValue else { return }
            needsDisplay = true
            configureAccessibility()
        }
    }
    private var hovering = false {
        didSet { if hovering != oldValue { needsDisplay = true } }
    }
    /// 종이 색 changed (or macOS went dark): redraw the note in the other colours.
    override func viewDidChangeEffectiveAppearance() {
        super.viewDidChangeEffectiveAppearance()
        needsDisplay = true
    }
    private var trackingArea: NSTrackingArea?

    private let dragThreshold: CGFloat
    private let onRestore: () -> Void
    private let onHide: () -> Void
    private let onMoveFinished: (NSPoint) -> Void
    private var mouseDownScreenPoint: NSPoint?
    private var mouseDownWindowOrigin: NSPoint?
    private var didDrag = false

    init(
        frame: NSRect,
        image: NSImage,
        dragThreshold: CGFloat,
        onRestore: @escaping () -> Void,
        onHide: @escaping () -> Void,
        onMoveFinished: @escaping (NSPoint) -> Void
    ) {
        self.image = image
        self.dragThreshold = dragThreshold
        self.onRestore = onRestore
        self.onHide = onHide
        self.onMoveFinished = onMoveFinished
        super.init(frame: frame)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
        configureAccessibility()
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        nil
    }

    override var isOpaque: Bool { false }
    override var acceptsFirstResponder: Bool { false }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        true
    }

    override func draw(_ dirtyRect: NSRect) {
        NSGraphicsContext.current?.cgContext.clear(dirtyRect)

        let imageSize = image.size
        guard imageSize.width > 0, imageSize.height > 0 else { return }

        // The character sits behind the note; the sheet naturally hides its body.
        // On hover the cat peeks a little higher, as if checking who's there.
        let mascotArea = NSRect(x: 28, y: hovering ? 56 : 53, width: 74, height: 74)
        let scale = min(mascotArea.width / imageSize.width, mascotArea.height / imageSize.height)
        let drawSize = NSSize(width: imageSize.width * scale, height: imageSize.height * scale)
        let drawRect = NSRect(
            x: mascotArea.midX - drawSize.width / 2,
            y: mascotArea.midY - drawSize.height / 2,
            width: drawSize.width,
            height: drawSize.height
        )
        image.draw(in: drawRect, from: .zero, operation: .sourceOver, fraction: 1, respectFlipped: true, hints: [.interpolation: NSImageInterpolation.high])
        drawStickyNote()
    }

    override func updateTrackingAreas() {
        if let trackingArea { removeTrackingArea(trackingArea) }
        let area = NSTrackingArea(rect: bounds, options: [.activeAlways, .mouseEnteredAndExited, .inVisibleRect], owner: self)
        addTrackingArea(area)
        trackingArea = area
        super.updateTrackingAreas()
    }

    override func mouseEntered(with event: NSEvent) { hovering = true }
    override func mouseExited(with event: NSEvent) { hovering = false }

    private func drawStickyNote() {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.saveGState()
        defer { context.restoreGState() }

        let note = NSRect(x: 14, y: 10, width: 76, height: 76)
        // 밤 종이: a honey note in the night's tab colour, with light ink.
        let night = effectiveAppearance.isNight
        context.translateBy(x: note.midX, y: note.midY)
        context.rotate(by: (hovering ? -2 : -4) * .pi / 180)
        context.translateBy(x: -note.midX, y: -note.midY)
        let paper = NSBezierPath(roundedRect: note, xRadius: 2, yRadius: 2)

        NSGraphicsContext.saveGraphicsState()
        let shadow = NSShadow()
        shadow.shadowColor = NSColor.black.withAlphaComponent(night ? 0.4 : 0.18)
        shadow.shadowBlurRadius = 5
        shadow.shadowOffset = NSSize(width: 0, height: -3)
        shadow.set()
        (night ? NSColor(paperHex: "#6a5e35")! : NSColor(red: 0.97, green: 0.90, blue: 0.64, alpha: 1)).setFill() // night: tab1
        paper.fill()
        NSGraphicsContext.restoreGraphicsState()

        NSGraphicsContext.saveGraphicsState()
        paper.addClip()
        if !night { PaperTheme.texture.draw(in: note, from: .zero, operation: .sourceOver, fraction: 0.16) }
        (night ? NSColor.black.withAlphaComponent(0.12) : NSColor(red: 0.60, green: 0.48, blue: 0.20, alpha: 0.07)).setFill()
        NSRect(x: note.minX, y: note.maxY - 9, width: note.width, height: 9).fill()
        NSGraphicsContext.restoreGraphicsState()

        drawTaskLines(in: note, night: night)

        let done = summary.total > 0 && summary.remaining == 0
        let caption = (done ? "✓ " : "") + summary.caption
        (caption as NSString).draw(at: NSPoint(x: 24, y: 17), withAttributes: [
            .font: NSFont.systemFont(ofSize: 8.5, weight: .semibold),
            .foregroundColor: done
                ? (night ? NSColor(paperHex: "#cfe6c8")! : NSColor(red: 0.35, green: 0.45, blue: 0.33, alpha: 0.95))
                : (night ? NSColor(paperHex: "#e6dcbd")! : NSColor(red: 0.46, green: 0.40, blue: 0.25, alpha: 0.85))
        ])

        let fold = NSBezierPath()
        fold.move(to: NSPoint(x: note.maxX - 11, y: note.minY))
        fold.line(to: NSPoint(x: note.maxX - 11, y: note.minY + 11))
        fold.line(to: NSPoint(x: note.maxX, y: note.minY + 11))
        fold.close()
        (night ? NSColor(paperHex: "#7d7048")! : NSColor(red: 1, green: 0.97, blue: 0.80, alpha: 1)).setFill()
        fold.fill()
        (night ? NSColor.black.withAlphaComponent(0.25) : NSColor(red: 0.65, green: 0.54, blue: 0.29, alpha: 0.20)).setStroke()
        fold.lineWidth = 0.6
        fold.stroke()

        // Paws are drawn in the note's rotated space so they grip its top edge.
        PaperPaw.drawResting(in: CGRect(x: 36, y: note.maxY - 7, width: 14, height: 13))
        PaperPaw.drawResting(in: CGRect(x: 63, y: note.maxY - 7, width: 14, height: 13))
    }

    /// Up to three open tasks in tiny handwriting on ruled lines; empty rules when there are none.
    private func drawTaskLines(in note: NSRect, night: Bool) {
        let ink = night ? NSColor(paperHex: "#f1e9d2")! : NSColor(red: 0.30, green: 0.26, blue: 0.17, alpha: 0.88)
        let rule = night ? NSColor.white.withAlphaComponent(0.14) : NSColor(red: 0.57, green: 0.48, blue: 0.26, alpha: 0.24)
        let style = NSMutableParagraphStyle()
        style.lineBreakMode = .byTruncatingTail
        let font = HandwritingFont.native(face: .pen, size: 11.5)
        let visible = Array(summary.titles.prefix(summary.titles.count > 3 ? 2 : 3))
        var lines = visible.map { Optional($0) }
        if summary.titles.count > 3 { lines.append(L("외 \(summary.titles.count - 2)개")) }
        while lines.count < 3 { lines.append(nil) }

        for (index, title) in lines.enumerated() {
            let baseline = 60 - CGFloat(index) * 12.5
            rule.setStroke()
            let line = NSBezierPath()
            line.move(to: NSPoint(x: 22, y: baseline - 2))
            line.line(to: NSPoint(x: note.maxX - 10, y: baseline - 2.4))
            line.lineWidth = 0.6
            line.stroke()
            guard let title else { continue }
            let isMore = summary.titles.count > 3 && index == 2
            var x: CGFloat = 23
            if !isMore {
                let box = NSBezierPath(roundedRect: NSRect(x: x, y: baseline, width: 5.5, height: 5.5), xRadius: 1, yRadius: 1)
                ink.withAlphaComponent(0.55).setStroke()
                box.lineWidth = 0.7
                box.stroke()
                x += 9
            }
            (title as NSString).draw(
                in: NSRect(x: x, y: baseline - 3, width: note.maxX - 10 - x, height: 14),
                withAttributes: [.font: isMore ? NSFont.systemFont(ofSize: 7.5, weight: .medium) : font,
                                 .foregroundColor: isMore ? ink.withAlphaComponent(night ? 1 : 0.8) : ink,
                                 .paragraphStyle: style]
            )
        }
    }

    override func mouseDown(with event: NSEvent) {
        guard event.type == .leftMouseDown else {
            super.mouseDown(with: event)
            return
        }
        mouseDownScreenPoint = window?.convertPoint(toScreen: event.locationInWindow)
        mouseDownWindowOrigin = window?.frame.origin
        didDrag = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window,
              let startPoint = mouseDownScreenPoint,
              let startOrigin = mouseDownWindowOrigin else { return }

        let currentPoint = window.convertPoint(toScreen: event.locationInWindow)
        let delta = NSPoint(x: currentPoint.x - startPoint.x, y: currentPoint.y - startPoint.y)
        if !didDrag {
            didDrag = hypot(delta.x, delta.y) >= dragThreshold
        }
        guard didDrag else { return }

        window.setFrameOrigin(NSPoint(x: startOrigin.x + delta.x, y: startOrigin.y + delta.y))
    }

    override func mouseUp(with event: NSEvent) {
        defer {
            mouseDownScreenPoint = nil
            mouseDownWindowOrigin = nil
        }

        guard event.type == .leftMouseUp else {
            super.mouseUp(with: event)
            return
        }

        if didDrag {
            if let origin = window?.frame.origin {
                onMoveFinished(origin)
            }
        } else {
            onRestore()
        }
    }

    override func rightMouseDown(with event: NSEvent) {
        NSMenu.popUpContextMenu(makeContextMenu(), with: event, for: self)
    }

    override func menu(for event: NSEvent) -> NSMenu? {
        makeContextMenu()
    }

    override func accessibilityPerformPress() -> Bool {
        onRestore()
        return true
    }

    private func configureAccessibility() {
        setAccessibilityElement(true)
        setAccessibilityRole(.button)
        setAccessibilityLabel(L("노트 열기, \(summary.caption)"))
        setAccessibilityHelp(L("포스트잇을 클릭하면 노트를 열고, 드래그하면 옮깁니다"))
        toolTip = "\(summary.caption) · " + L("클릭해서 열기 · 드래그해서 이동")
    }

    private func makeContextMenu() -> NSMenu {
        let menu = NSMenu()
        menu.addItem(FloatingMascotMenuItem(title: L("노트 열기"), action: #selector(FloatingMascotMenuItem.restore(_:)), callback: onRestore))
        menu.addItem(FloatingMascotMenuItem(title: L("아이콘 숨기기"), action: #selector(FloatingMascotMenuItem.hide(_:)), callback: onHide))
        menu.addItem(.separator())
        let quit = NSMenuItem(title: L("종이냥 종료"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "")
        quit.target = NSApp
        menu.addItem(quit)
        return menu
    }
}

@MainActor
private final class FloatingMascotMenuItem: NSMenuItem {
    private let callback: () -> Void

    init(title: String, action: Selector, callback: @escaping () -> Void) {
        self.callback = callback
        super.init(title: title, action: action, keyEquivalent: "")
        target = self
    }

    @available(*, unavailable)
    required init(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    @objc func restore(_ sender: Any?) {
        callback()
    }

    @objc func hide(_ sender: Any?) {
        callback()
    }
}
