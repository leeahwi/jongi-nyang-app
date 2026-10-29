import AppKit
import Carbon.HIToolbox
import PaperCore
import SwiftUI

/// 빠른 메모: ⌃⌥M from any app (or the pet, ⋯, 파일 메뉴) opens a paper slip for a few lines.
/// ⌘Return puts them at the top of 메모 as a new memo; Esc or clicking elsewhere closes it and
/// keeps the text for next time (even after a restart: `quickMemo.draft`).
@MainActor
final class QuickMemoController {
    private let model: AppModel
    private var panel: SlipPanel?
    private var hotKey: GlobalHotKey?
    /// Whether ⌃⌥M could be claimed (another app may own it).
    var registered: Bool { hotKey != nil }

    /// 빠른 메모를 열 때 복사한 글 넣기 (1.38): the pasteboard as last seen, and when it last changed.
    private var seenChangeCount = NSPasteboard.general.changeCount
    private var changedAt: Date?
    private var watch: Timer?

    init(model: AppModel) {
        self.model = model
        // A copy is noticed within a few seconds (only while the setting is on).
        let timer = Timer(timeInterval: 3, repeats: true) { _ in
            Task { @MainActor [weak self] in self?.notice() }
        }
        timer.tolerance = 1
        RunLoop.main.add(timer, forMode: .common)
        watch = timer
    }

    private var lastPolled = NSPasteboard.general.changeCount
    private func notice() {
        guard model.quickMemoClipboard else { return }
        let count = NSPasteboard.general.changeCount
        if count != lastPolled { lastPolled = count; changedAt = Date() }
    }

    /// Text copied since the last open and within two minutes, for an empty draft.
    private func copiedText() -> String? {
        let pasteboard = NSPasteboard.general
        defer { seenChangeCount = pasteboard.changeCount }
        guard model.quickMemoClipboard, model.quickMemoDraft.isEmpty, pasteboard.changeCount != seenChangeCount,
              (changedAt.map { Date().timeIntervalSince($0) <= 120 } ?? true),
              let text = pasteboard.string(forType: .string), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
        return text
    }

    func setEnabled(_ enabled: Bool) {
        if enabled {
            guard hotKey == nil else { return }
            hotKey = GlobalHotKey(keyCode: kVK_ANSI_M, modifiers: controlKey | optionKey) { [weak self] in self?.show() }
        } else {
            hotKey?.unregister()
            hotKey = nil
        }
    }

    var isVisible: Bool { panel?.isVisible == true }

    func show() {
        let panel = panel ?? makePanel()
        let copied = copiedText()
        panel.show(QuickMemoView(model: model, text: copied, selectAll: copied != nil, onClose: { [weak self] in self?.close() }))
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
        if let area = screen?.visibleFrame {
            panel.placeSlip(topCenter: NSPoint(x: area.midX, y: area.maxY - area.height / 5))
        }
        panel.makeKeyAndOrderFront(nil)
    }

    func close() {
        panel?.orderOut(nil)
    }

    private func makePanel() -> SlipPanel {
        let panel = SlipPanel(nonactivating: true)
        panel.title = L("빠른 메모")
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.onResignKey = { [weak self] in self?.close() }
        self.panel = panel
        return panel
    }
}

/// 빠른 메모 on a slip (lavender tape): ruled handwriting lines every 40 pt, `esc 닫기` and
/// 메모에 넣기 ⌘↩. Esc or clicking away keeps what was written for next time.
struct QuickMemoView: View {
    static let lineHeight: CGFloat = 40
    static let lines = 4
    let model: AppModel
    var onClose: () -> Void = {}
    /// The copied text came in: selected, so typing replaces it.
    var selectAll = false
    @State private var text: String

    init(model: AppModel, text: String? = nil, selectAll: Bool = false, onClose: @escaping () -> Void = {}) {
        self.model = model
        self.onClose = onClose
        self.selectAll = selectAll
        _text = State(initialValue: text ?? model.quickMemoDraft)
    }

    var body: some View {
        PaperSlip(kind: .memo, width: SlipWidth.medium.rawValue) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .memo, symbol: "note.text", title: L("빠른 메모"), context: selectAll ? L("복사한 글을 넣었어요") : L("쓰던 글은 남아요"), onClose: close)
                MemoTextView(text: $text, font: model.notebookFont.handNSFont(24), onSubmit: add, onEscape: close, lineHeight: Self.lineHeight,
                             selectAll: selectAll)
                    .accessibilityLabel("빠른 메모")
                    .frame(height: Self.lineHeight * CGFloat(Self.lines))
                    .background(alignment: .top) {
                        // The ruled lines the handwriting sits on.
                        Canvas { context, size in
                            var y = Self.lineHeight - 0.5
                            while y < size.height {
                                context.fill(Path(CGRect(x: 0, y: y, width: size.width, height: 1)), with: .color(PaperTheme.rule))
                                y += Self.lineHeight
                            }
                        }
                        .allowsHitTesting(false)
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 8)
                SlipFooter {
                    KeyHint(key: "Esc", label: L("닫기"))
                } trailing: {
                    Button(L("메모에 넣기"), action: add)
                        .buttonStyle(SlipButtonStyle(role: .primary, key: "⌘↩"))
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
        .onChange(of: text) { _, value in model.quickMemoDraft = value }
        // Also when the focus isn't in the text (the editor handles these itself first).
        .background {
            Button("메모에 넣기", action: add)
                .keyboardShortcut(.return, modifiers: .command)
                .opacity(0)
                .accessibilityHidden(true)
            Button("닫기", action: close)
                .keyboardShortcut(.cancelAction)
                .opacity(0)
                .accessibilityHidden(true)
        }
    }

    /// ⌘Return: a new memo with the text (blank just closes).
    private func add() {
        if !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, let id = model.addMemo(text: text) {
            // 1.43: it went into 메모 서랍 — the note's toast offers 열기.
            let added = MemoMove.addedToast(.current)
            var toast = PaperToast(symbol: "note.text", text: added.text)
            toast.action = added.action
            toast.perform = { [weak model] in
                model?.toast = nil
                model?.revealMemo(id)
            }
            model.toast = toast
        }
        text = ""
        model.quickMemoDraft = ""
        onClose()
    }

    /// Esc: closes; the draft stays.
    private func close() {
        model.quickMemoDraft = text
        onClose()
    }
}

/// A plain multi-line editor in the notebook's font that reports ⌘Return and Esc (SwiftUI's
/// TextEditor gives Esc to completion and has no submit).
struct MemoTextView: NSViewRepresentable {
    @Binding var text: String
    let font: NSFont
    var onSubmit: () -> Void = {}
    var onEscape: () -> Void = {}
    /// Every line this tall (the slip's ruled lines), or the font's own.
    var lineHeight: CGFloat?
    /// Opens with all of it selected (빠른 메모's copied text).
    var selectAll = false

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> NSScrollView {
        let scroll = NSScrollView()
        scroll.drawsBackground = false
        scroll.hasVerticalScroller = true
        scroll.autohidesScrollers = true
        scroll.borderType = .noBorder
        let view = KeyTextView()
        view.isRichText = false
        view.allowsUndo = true
        view.drawsBackground = false
        view.isAutomaticQuoteSubstitutionEnabled = false
        view.isAutomaticDashSubstitutionEnabled = false
        view.textContainerInset = lineHeight == nil ? NSSize(width: 4, height: 6) : .zero
        view.textContainer?.lineFragmentPadding = lineHeight == nil ? 5 : 2
        if let lineHeight {
            let paragraph = NSMutableParagraphStyle()
            paragraph.minimumLineHeight = lineHeight
            paragraph.maximumLineHeight = lineHeight
            view.defaultParagraphStyle = paragraph
            view.typingAttributes[.paragraphStyle] = paragraph
            // The handwriting sits on the line: the text drops to the bottom of each 40 pt row.
            view.typingAttributes[.baselineOffset] = -(lineHeight - font.ascender + font.descender) / 2 + 2
        }
        view.isVerticallyResizable = true
        view.isHorizontallyResizable = false
        view.autoresizingMask = [.width]
        view.textContainer?.widthTracksTextView = true
        view.insertionPointColor = NSColor(PaperTheme.sage)
        view.font = font
        view.textColor = NSColor(PaperTheme.ink)
        view.typingAttributes[.font] = font
        view.typingAttributes[.foregroundColor] = NSColor(PaperTheme.ink)
        view.string = text
        if lineHeight != nil, let storage = view.textStorage {
            storage.setAttributes(view.typingAttributes, range: NSRange(location: 0, length: storage.length))
        }
        view.delegate = context.coordinator
        view.onSubmit = { context.coordinator.parent.onSubmit() }
        view.onEscape = { context.coordinator.parent.onEscape() }
        view.selectsAll = selectAll
        scroll.documentView = view
        return scroll
    }

    func updateNSView(_ scroll: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let view = scroll.documentView as? KeyTextView else { return }
        if view.string != text {
            view.string = text
            if let storage = view.textStorage { storage.setAttributes(view.typingAttributes, range: NSRange(location: 0, length: storage.length)) }
        }
        if view.font != font { view.font = font }
    }

    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: MemoTextView
        init(_ parent: MemoTextView) { self.parent = parent }

        func textDidChange(_ notification: Notification) {
            guard let view = notification.object as? NSTextView else { return }
            parent.text = view.string
        }
    }

    final class KeyTextView: NSTextView {
        var onSubmit: () -> Void = {}
        var onEscape: () -> Void = {}
        var selectsAll = false

        /// Typing goes straight in, after what was there (or over it, when it's all selected).
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            guard let window else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self, self.window === window else { return }
                window.makeFirstResponder(self)
                let length = (self.string as NSString).length
                self.setSelectedRange(self.selectsAll ? NSRange(location: 0, length: length) : NSRange(location: length, length: 0))
            }
        }

        private func handled(_ event: NSEvent) -> Bool {
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if (event.keyCode == UInt16(kVK_Return) || event.keyCode == UInt16(kVK_ANSI_KeypadEnter)) && flags.contains(.command) {
                onSubmit()
                return true
            }
            if event.keyCode == UInt16(kVK_Escape) && !hasMarkedText() {
                onEscape()
                return true
            }
            return false
        }

        override func performKeyEquivalent(with event: NSEvent) -> Bool {
            if window?.firstResponder === self, handled(event) { return true }
            return super.performKeyEquivalent(with: event)
        }

        override func keyDown(with event: NSEvent) {
            if !handled(event) { super.keyDown(with: event) }
        }
    }
}

extension NotebookFont {
    /// The face as an AppKit font, for text views.
    @MainActor
    func nsFont(_ textSize: NotebookTextSize = .regular) -> NSFont {
        let size = bodySize(textSize)
        switch self {
        case .pen: return HandwritingFont.native(face: .pen, size: size)
        case .brush: return HandwritingFont.native(face: .brush, size: size)
        case .clean: return .systemFont(ofSize: size)
        }
    }
}
