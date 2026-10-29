import AppKit
import Carbon.HIToolbox
import Combine
import PaperCore
import SwiftUI

/// 메모 서랍's windows: the drawer (made the first time it opens, hidden — never closed — after) and the paw handle at
/// the screen's edge. The drawer takes typing without bringing the note forward (a non-activating panel), floats above
/// other windows while pinned, and never closes on a click elsewhere: only the shortcut, Esc or its ×.
@MainActor
final class MemoDrawerController {
    private let model: AppModel
    private var drawer: MemoDrawer { model.drawer }
    private var panel: DrawerPanel?
    private weak var backdrop: DrawerBackdropView?
    private var handle: DrawerHandlePanel?
    private let handleState = DrawerHandleState()
    private var hotKey: GlobalHotKey?
    /// Global shortcuts only for the real app (never a preview, a snapshot or a test copy).
    private let live: Bool
    private var subscriptions = Set<AnyCancellable>()
    private(set) var isOpen = false
    /// `--offscreen` (the performance check): the drawer and the handle drawn far off every screen, out of the way.
    var offscreen = false
    private var shift: CGFloat { offscreen ? 40_000 : 0 }
    /// The screen the drawer is out on.
    private var screen: NSScreen?
    private var closing: Task<Void, Never>?
    /// Set by the app.
    var onShortcutChange: () -> Void = {}

    static let slide: TimeInterval = 0.18

    init(model: AppModel, live: Bool) {
        self.model = model
        self.live = live
        drawer.onClose = { [weak self] in self?.close() }
        drawer.onToggle = { [weak self] in self?.toggle() }
        drawer.onWidth = { [weak self] mouse in self?.drag(toX: mouse) }
        drawer.onPin = { [weak self] in self?.applyPin() }
        drawer.onEscape = { [weak self] in self?.escape() }
        drawer.$handleOn.removeDuplicates().dropFirst().sink { [weak self] _ in DispatchQueue.main.async { self?.updateHandle() } }.store(in: &subscriptions)
        drawer.$side.removeDuplicates().dropFirst().sink { [weak self] _ in
            DispatchQueue.main.async {
                self?.updateHandle()
                if self?.isOpen == true { self?.place(animated: false) }
            }
        }.store(in: &subscriptions)
        // 바탕: the blur behind the paper follows the setting, the side, the width and Reduce transparency.
        Publishers.Merge4(drawer.$backdrop.map { _ in () }, drawer.$side.map { _ in () }, drawer.$width.map { _ in () }, drawer.$reduceTransparency.map { _ in () })
            .dropFirst()
            .receive(on: RunLoop.main)
            .sink { [weak self] in self?.backdrop?.needsLayout = true }
            .store(in: &subscriptions)
        drawer.$shortcut.removeDuplicates().dropFirst().sink { [weak self] _ in DispatchQueue.main.async { self?.registerShortcut() } }.store(in: &subscriptions)
        // The handle's number: memos changed today (worked out only when the memos change).
        model.$memos.sink { [weak self] memos in
            let count = MemoFolders.changedToday(memos, now: Date())
            if self?.handleState.count != count { self?.handleState.count = count }
        }.store(in: &subscriptions)
        NotificationCenter.default.publisher(for: NSApplication.didChangeScreenParametersNotification)
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                self?.updateHandle()
                if self?.isOpen == true { self?.place(animated: false) }
            }.store(in: &subscriptions)
    }

    /// At launch: the shortcut and the handle.
    func start() {
        registerShortcut()
        updateHandle()
    }

    // MARK: Shortcut

    func registerShortcut() {
        hotKey?.unregister()
        hotKey = nil
        guard live, let shortcut = drawer.shortcut else {
            drawer.shortcutRegistered = true
            onShortcutChange()
            return
        }
        hotKey = GlobalHotKey(keyCode: shortcut.keyCode, modifiers: shortcut.modifiers) { [weak self] in self?.toggle() }
        drawer.shortcutRegistered = hotKey != nil
        onShortcutChange()
    }

    /// The recorder in Settings: off while a key is being recorded, so the drawer's own shortcut can be pressed.
    func pauseShortcut(_ paused: Bool) {
        if paused {
            hotKey?.unregister()
            hotKey = nil
        } else {
            registerShortcut()
        }
    }

    // MARK: Opening and closing

    func toggle() {
        if isOpen { close() } else { open() }
    }

    func open() {
        closing?.cancel()
        closing = nil
        PerfProbe.begin("drawer")
        let panel = self.panel ?? makePanel()
        let mouse = NSEvent.mouseLocation
        screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
        drawer.willOpen()
        let wasOpen = isOpen
        isOpen = true
        applyPin()
        handle?.orderOut(nil)
        let target = frame()
        if wasOpen || NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            panel.setFrame(target, display: true)
            panel.alphaValue = 1
            panel.makeKeyAndOrderFront(nil)
        } else {
            panel.setFrame(offscreen(target), display: false)
            panel.alphaValue = 1
            panel.makeKeyAndOrderFront(nil)
            NSAnimationContext.runAnimationGroup { context in
                context.duration = Self.slide
                context.timingFunction = CAMediaTimingFunction(name: .easeOut)
                panel.animator().setFrame(target, display: true)
            }
        }
        if drawer.expandedID == nil && !drawer.searching && drawer.bigID == nil { drawer.focusQuick += 1 }
    }

    /// A memo from elsewhere (a search result, a toast's 열기): the drawer opens on its folder with it expanded.
    func reveal(_ id: String) {
        if !isOpen { open() }
        drawer.reveal(id)
    }

    /// ⇧⌘N 새 메모: the drawer, the keyboard in its quick-write slip.
    func write() {
        if !isOpen { open() }
        drawer.endSearch()
        drawer.bigID = nil
        if drawer.expandedID != nil { drawer.collapse() }
        drawer.focusQuick += 1
    }

    func close() {
        guard isOpen, let panel else { return }
        PerfProbe.begin("drawerclose")
        isOpen = false
        drawer.didClose()
        if NSWorkspace.shared.accessibilityDisplayShouldReduceMotion {
            finishClose()
            return
        }
        let target = offscreen(panel.frame)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = Self.slide
            context.timingFunction = CAMediaTimingFunction(name: .easeIn)
            panel.animator().setFrame(target, display: true)
        } completionHandler: { [weak self] in
            MainActor.assumeIsolated { self?.finishClose() }
        }
    }

    private func finishClose() {
        guard !isOpen else { return }
        panel?.orderOut(nil)
        updateHandle()
    }

    /// Esc: the open things one at a time, then the drawer.
    func escape() {
        if !drawer.escape() { close() }
    }

    private func applyPin() {
        panel?.level = drawer.pinned ? .floating : .normal
    }

    private func makePanel() -> DrawerPanel {
        let panel = DrawerPanel()
        panel.title = L("메모 서랍")
        let hosting = NSHostingView(rootView: MemoDrawerView(drawer: drawer))
        hosting.sizingOptions = []
        let container = DrawerBackdropView(drawer: drawer, hosting: hosting)
        panel.contentView = container
        backdrop = container
        panel.onKey = { [weak self] event in self?.key(event) ?? false }
        panel.onCancel = { [weak self] in self?.escape() }
        self.panel = panel
        return panel
    }

    // MARK: Size and place

    private var visible: NSRect { (screen ?? NSScreen.main)?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900) }

    private var panelWidth: CGFloat { MemoDrawerView.shadowRoom + MemoDrawerView.tabsWidth + drawer.width }

    /// The usable height of the screen, against its edge.
    private func frame() -> NSRect {
        let area = visible
        let width = panelWidth
        return NSRect(x: (drawer.side == .right ? area.maxX - width : area.minX) + shift, y: area.minY, width: width, height: area.height)
    }

    private func offscreen(_ frame: NSRect) -> NSRect {
        frame.offsetBy(dx: drawer.side == .right ? frame.width : -frame.width, dy: 0)
    }

    private func place(animated: Bool) {
        guard let panel else { return }
        panel.setFrame(frame(), display: true, animate: animated)
    }

    /// The inner edge dragged to the pointer: 260–480 pt.
    private func drag(toX mouse: CGFloat) {
        let area = visible
        let raw = drawer.side == .right ? area.maxX - mouse : mouse - area.minX
        let width = min(max(raw.rounded(), MemoDrawer.widths.lowerBound), MemoDrawer.widths.upperBound)
        guard width != drawer.width else { return }
        drawer.width = width
        place(animated: false)
    }

    // MARK: Keys

    /// The drawer's keys (the plan's keyboard map), before the menus see them: ⌘N, ⌘F, ⌘1–9, ⌘0, ⇧⌘C, ⌘⌫, ↑ ↓ ↩ Esc —
    /// and ⌘Z, which here undoes the typing, never a to-do in the note.
    private func key(_ event: NSEvent) -> Bool {
        guard let panel else { return false }
        let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])
        let code = Int(event.keyCode)
        let responder = panel.firstResponder as? NSTextView
        let typing = responder != nil
        let field = responder?.isFieldEditor == true
        if responder?.hasMarkedText() == true { return false }
        let digits: [Int: Int] = [kVK_ANSI_0: 0, kVK_ANSI_1: 1, kVK_ANSI_2: 2, kVK_ANSI_3: 3, kVK_ANSI_4: 4, kVK_ANSI_5: 5,
                                  kVK_ANSI_6: 6, kVK_ANSI_7: 7, kVK_ANSI_8: 8, kVK_ANSI_9: 9]
        if flags == [.command] {
            if let digit = digits[code] { drawer.showDigit(digit); return true }
            switch code {
            case kVK_ANSI_N:
                drawer.newMemo()
                return true
            case kVK_ANSI_L: drawer.openFolderList(); return true
            case kVK_ANSI_Comma: drawer.openSettings(); return true
            case kVK_ANSI_F: drawer.startSearch(); return true
            case kVK_ANSI_W: close(); return true
            case kVK_Delete:
                guard !typing, let id = drawer.selectedID ?? drawer.expandedID else { return typing ? false : true }
                drawer.delete(id)
                return true
            case kVK_ANSI_Z:
                responder?.undoManager?.undo()
                return true
            default: return false
            }
        }
        if flags == [.command, .shift] {
            switch code {
            case kVK_ANSI_C:
                if let id = drawer.selectedID ?? drawer.expandedID { drawer.copy(id) }
                return true
            case kVK_ANSI_Z:
                responder?.undoManager?.redo()
                return true
            default: return false
            }
        }
        guard flags.isEmpty || flags == [.shift] else { return false }
        if code == kVK_Escape {
            escape()
            return true
        }
        // In the search field, ↑ ↓ pick a result while typing.
        if field && drawer.searching && (code == kVK_UpArrow || code == kVK_DownArrow) {
            drawer.moveSelection(code == kVK_UpArrow ? -1 : 1)
            return true
        }
        guard !typing, flags.isEmpty else { return false }
        switch code {
        case kVK_UpArrow: drawer.moveSelection(-1); return true
        case kVK_DownArrow: drawer.moveSelection(1); return true
        case kVK_Return, kVK_ANSI_KeypadEnter: drawer.openSelected(); return true
        default: return false
        }
    }

    // MARK: The handle

    func updateHandle() {
        guard drawer.handleOn, !isOpen, let screen = NSScreen.screens.first else {
            handle?.orderOut(nil)
            return
        }
        let handle = self.handle ?? makeHandle()
        handleState.right = drawer.side == .right
        let area = screen.visibleFrame
        let size = DrawerHandleView.size
        let position = drawer.handlePosition ?? 0.33
        let centre = area.maxY - area.height * CGFloat(min(max(position, 0), 1))
        let y = min(max(centre - size.height / 2, area.minY + 8), area.maxY - size.height - 8)
        handle.setFrame(NSRect(x: (drawer.side == .right ? screen.frame.maxX - size.width : screen.frame.minX) + shift, y: y, width: size.width, height: size.height), display: true)
        handle.orderFrontRegardless()
    }

    private func makeHandle() -> DrawerHandlePanel {
        let panel = DrawerHandlePanel()
        let view = DrawerHandleView(state: handleState, drawer: drawer, onOpen: { [weak self] in self?.open() },
                                    onDrag: { [weak self] y in self?.dragHandle(toY: y) }, onDragEnd: { [weak self] in self?.saveHandle() })
        let hosting = NSHostingView(rootView: view)
        hosting.sizingOptions = []
        panel.contentView = hosting
        handle = panel
        return panel
    }

    private func dragHandle(toY mouse: CGFloat) {
        guard let handle, let screen = NSScreen.screens.first else { return }
        let area = screen.visibleFrame
        let height = handle.frame.height
        let y = min(max(mouse - height / 2, area.minY + 8), area.maxY - height - 8)
        handle.setFrameOrigin(NSPoint(x: handle.frame.minX, y: y))
    }

    private func saveHandle() {
        guard let handle, let screen = NSScreen.screens.first else { return }
        let area = screen.visibleFrame
        drawer.handlePosition = Double((area.maxY - handle.frame.midY) / area.height)
    }

    /// For the performance check and the live test.
    var panelForTesting: NSWindow? { panel }
}

/// The drawer's window: borderless, non-activating, but it takes typing; Esc and the keys go to the controller first.
final class DrawerPanel: NSPanel {
    var onKey: (NSEvent) -> Bool = { _ in false }
    var onCancel: () -> Void = {}

    init() {
        super.init(contentRect: NSRect(x: 0, y: 0, width: 360, height: 600), styleMask: [.borderless, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        becomesKeyOnlyIfNeeded = false
        animationBehavior = .none
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isMovable = false
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func sendEvent(_ event: NSEvent) {
        if event.type == .keyDown, onKey(event) { return }
        super.sendEvent(event)
    }

    override func cancelOperation(_ sender: Any?) { onCancel() }
}

/// The handle's window: never key, never in the way of full-screen apps (it isn't allowed on their spaces).
final class DrawerHandlePanel: NSPanel {
    init() {
        super.init(contentRect: NSRect(origin: .zero, size: DrawerHandleView.size), styleMask: [.borderless, .nonactivatingPanel],
                   backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        animationBehavior = .none
        level = .floating
        collectionBehavior = [.canJoinAllSpaces, .stationary, .ignoresCycle]
        title = L("메모 서랍 손잡이")
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class DrawerHandleState: ObservableObject {
    @Published var count = 0
    @Published var right = true
}

/// The paw bookmark at the screen's edge: 24 × 46, 6 more out under the pointer; the number of memos changed today
/// under the paw (none when 0). Click opens the drawer; drag moves it up or down. Nothing moves on its own.
struct DrawerHandleView: View {
    @ObservedObject var state: DrawerHandleState
    @ObservedObject var drawer: MemoDrawer
    /// Snapshots: this paper rather than the drawer's.
    var paper: DrawerPalette?
    var onOpen: () -> Void = {}
    var onDrag: (CGFloat) -> Void = { _ in }
    var onDragEnd: () -> Void = {}
    @Environment(\.colorScheme) private var scheme
    @State private var hovering = false
    @State private var dragged = false
    @State private var startY: CGFloat?

    static let size = NSSize(width: 36, height: 54)
    static let tab = CGSize(width: 24, height: 46)
    static let peek: CGFloat = 6

    var body: some View {
        let palette = paper ?? drawer.theme.palette(scheme)
        let right = state.right
        let shape = right ? UnevenRoundedRectangle(topLeadingRadius: 10, bottomLeadingRadius: 10, style: .continuous)
            : UnevenRoundedRectangle(bottomTrailingRadius: 10, topTrailingRadius: 10, style: .continuous)
        let width = Self.tab.width + (hovering ? Self.peek : 0)
        HStack(spacing: 0) {
            if right { Spacer(minLength: 0) }
            ZStack {
                StripeFill(shape: shape, a: palette.pinTab.0, b: palette.pinTab.1)
                shape.strokeBorder(Color.black.opacity(palette.kind == .night ? 0.35 : 0.1), lineWidth: 0.5)
                VStack(spacing: 2) {
                    Image(systemName: "pawprint.fill")
                        .font(.system(size: 11))
                    if state.count > 0 {
                        Text("\(min(state.count, 99))")
                            .font(.system(size: 9.5, weight: .semibold).monospacedDigit())
                            .lineLimit(1)
                            .fixedSize()
                    }
                }
                .foregroundStyle(palette.pinTabInk)
                .offset(x: right ? -1 : 1)
            }
            .frame(width: width, height: Self.tab.height)
            .shadow(color: .black.opacity(0.18), radius: 3, x: right ? -1 : 1, y: 1)
            if !right { Spacer(minLength: 0) }
        }
        .frame(width: Self.size.width, height: Self.size.height)
        .contentShape(Rectangle().inset(by: 2))
        .onHover { inside in
            withAnimation(.easeOut(duration: 0.12)) { hovering = inside }
        }
        .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .global)
            .onChanged { _ in
                let y = NSEvent.mouseLocation.y
                if startY == nil { startY = y }
                if let startY, abs(y - startY) > 3 { dragged = true }
                if dragged { onDrag(y) }
            }
            .onEnded { _ in
                if dragged { onDragEnd() } else { onOpen() }
                dragged = false
                startY = nil
            })
        .help(L("메모 서랍"))
        .accessibilityElement()
        .accessibilityLabel(L("메모 서랍 열기"))
        .accessibilityValue(state.count > 0 ? L("오늘 고친 메모 \(state.count)장") : "")
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { onOpen() }
    }
}

/// The drawer window's content: the SwiftUI drawer over, for 반투명 and 강하게, a behind-window blur cut to the paper's
/// shape (ears and all). Under Reduce transparency (or 불투명, 바탕 없음) there's no blur at all — nothing runs while idle.
final class DrawerBackdropView: NSView {
    private let drawer: MemoDrawer
    private let blur = NSVisualEffectView()
    private var maskSize: NSSize = .zero
    private var maskRight = true

    init(drawer: MemoDrawer, hosting: NSView) {
        self.drawer = drawer
        super.init(frame: NSRect(x: 0, y: 0, width: 360, height: 600))
        blur.blendingMode = .behindWindow
        blur.state = .active
        blur.material = .popover
        blur.isHidden = true
        addSubview(blur)
        hosting.frame = bounds
        hosting.autoresizingMask = [.width, .height]
        addSubview(hosting)
    }

    required init?(coder: NSCoder) { nil }

    override var isFlipped: Bool { true }

    override func layout() {
        super.layout()
        MainActor.assumeIsolated { placeBlur() }
    }

    @MainActor private func placeBlur() {
        let mode = drawer.shownBackdrop
        let on = mode == .translucent || mode == .strong
        blur.isHidden = !on
        guard on else { return }
        let right = drawer.side == .right
        let top = MemoDrawerView.catRoom - DrawerCat.earHeight
        let x = right ? MemoDrawerView.shadowRoom + MemoDrawerView.tabsWidth : 0
        let frame = NSRect(x: x, y: top, width: drawer.width, height: max(0, bounds.height - top))
        if blur.frame != frame { blur.frame = frame }
        blur.appearance = NSAppearance(named: drawer.palette.scheme == .dark ? .darkAqua : .aqua)
        // The system's own blur (its radius isn't ours to set): 강하게 differs by letting more of it through (62 %).
        blur.material = .popover
        guard frame.size != maskSize || right != maskRight else { return }
        maskSize = frame.size
        maskRight = right
        // The paper's outline as the blur's mask (drawn once per size).
        blur.maskImage = NSImage(size: frame.size, flipped: true) { rect in
            let path = DrawerCat.outline(in: rect, right: right)
            NSColor.black.setFill()
            NSBezierPath(cgPath: path.cgPath).fill()
            return true
        }
    }
}
