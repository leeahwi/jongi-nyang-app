import AppKit
import Carbon.HIToolbox
import Combine
import PaperCore
import SwiftUI

/// 빠른 메모: ⌃⌥M from any app (or the pet, ⋯, 파일 메뉴) opens a paper slip for a few lines.
/// ⌘Return puts them at the top of the folder on its chip (#117: the drawer's last folder unless another is picked) as a
/// new memo; ⌥⌘Return does too and keeps the slip open, empty, for the next; Esc or clicking elsewhere closes it and
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
    private var subscriptions = Set<AnyCancellable>()

    init(model: AppModel) {
        self.model = model
        // A copy is noticed within a few seconds — the pasteboard looked at only while the setting is on (#64: every
        // 3 s all day, the setting off too).
        model.$quickMemoClipboard.removeDuplicates().sink { [weak self] on in
            DispatchQueue.main.async { self?.watchPasteboard(on) }
        }.store(in: &subscriptions)
    }

    private func watchPasteboard(_ on: Bool) {
        guard on else { watch?.invalidate(); watch = nil; return }
        guard watch == nil else { return }
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

/// 빠른 메모 on a slip (lavender tape): ruled handwriting lines every 40 pt; at the foot the folder it goes into (a chip,
/// #117), `esc 닫기` and 넣기 ⌘↩ (⌥⌘↩ puts it in and keeps writing). Esc or clicking away keeps what was written for next
/// time.
struct QuickMemoView: View {
    static let lineHeight: CGFloat = 40
    static let lines = 4
    let model: AppModel
    var onClose: () -> Void = {}
    /// The copied text came in: selected, so typing replaces it.
    var selectAll = false
    @State private var text: String
    /// The folder the memo goes into: the drawer's last one, unless another is picked on the chip.
    @State private var folder: String

    init(model: AppModel, text: String? = nil, selectAll: Bool = false, folder: String? = nil, onClose: @escaping () -> Void = {}) {
        self.model = model
        self.onClose = onClose
        self.selectAll = selectAll
        _text = State(initialValue: text ?? model.quickMemoDraft)
        _folder = State(initialValue: folder ?? model.memoFolders.lastFolder(model.drawer.lastFolder))
    }

    var body: some View {
        PaperSlip(kind: .memo, width: SlipWidth.medium.rawValue) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .memo, symbol: "note.text", title: L("빠른 메모"), context: selectAll ? L("복사한 글을 넣었어요") : L("쓰던 글은 남아요"), onClose: close)
                MemoTextView(text: $text, font: model.notebookFont.handNSFont(24), onSubmit: { add() }, onSubmitAndKeep: { add(keep: true) },
                             onEscape: close, lineHeight: Self.lineHeight, selectAll: selectAll)
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
                    QuickMemoFolderChip(model: model, folder: $folder)
                    KeyHint(key: "Esc", label: L("닫기"))
                } trailing: {
                    Button(L("넣기")) { add() }
                        .buttonStyle(SlipButtonStyle(role: .primary, key: "⌘↩"))
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                        .help(L("⌘↩ 넣기 · ⌥⌘↩ 넣고 계속 적기"))
                }
            }
        }
        .onChange(of: text) { _, value in model.quickMemoDraft = value }
        // Also when the focus isn't in the text (the editor handles these itself first).
        .background {
            Button("넣기") { add() }
                .keyboardShortcut(.return, modifiers: .command)
                .opacity(0)
                .accessibilityHidden(true)
            Button("넣고 계속 적기") { add(keep: true) }
                .keyboardShortcut(.return, modifiers: [.command, .option])
                .opacity(0)
                .accessibilityHidden(true)
            Button("닫기", action: close)
                .keyboardShortcut(.cancelAction)
                .opacity(0)
                .accessibilityHidden(true)
        }
    }

    /// ⌘Return: a new memo with the text in the chip's folder (blank just closes). ⌥⌘Return (`keep`, Craft's ‘넣고
    /// 계속’): the same, and the slip stays open, empty, on the same folder.
    private func add(keep: Bool = false) {
        let blank = text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        if keep && blank { return }
        let target = model.memoFolders.folder(folder) == nil ? nil : folder
        if !blank, let id = model.addMemo(text: text, folder: target) {
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
        if !keep { onClose() }
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
    /// ⌥⌘Return (빠른 메모's 넣고 계속 적기).
    var onSubmitAndKeep: () -> Void = {}
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
        view.onSubmitAndKeep = { context.coordinator.parent.onSubmitAndKeep() }
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
        var onSubmitAndKeep: () -> Void = {}
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
                if flags.contains(.option) { onSubmitAndKeep() } else { onSubmit() }
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

/// #117: where 빠른 메모 puts the memo — the folder's colour and name with ▾; a click lists the folders (the drawer's
/// folder list, without 고정), the one picked checked. Picked for this slip only; the next one starts on the drawer's last
/// folder again.
struct QuickMemoFolderChip: View {
    let model: AppModel
    @Binding var folder: String

    var body: some View {
        let folders = model.memoFolders.visible
        let current = folders.first { $0.id == folder } ?? folders.first
        HStack(spacing: 5) {
            if let current {
                RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                    .fill(DrawerPalette.day.tab(current.colorKey).a)
                    .overlay { RoundedRectangle(cornerRadius: 2.5, style: .continuous).strokeBorder(DrawerPalette.day.tab(current.colorKey).edge, lineWidth: 1) }
                    .frame(width: 10, height: 10)
            }
            Text(current?.displayName(.current) ?? "")
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(PaperTheme.ink2)
                .lineLimit(1)
                .truncationMode(.tail)
            Image(systemName: "chevron.down")
                .font(.system(size: 8, weight: .semibold))
                .foregroundStyle(PaperTheme.ink3)
        }
        .padding(.horizontal, 8)
        .frame(height: 22)
        .frame(maxWidth: 150)
        .background(PaperTheme.card, in: Capsule())
        .overlay { Capsule().strokeBorder(PaperTheme.rule, lineWidth: 1) }
        .fixedSize()
        .overlay {
            // The drawer's menus (system look, keyboard, VoiceOver): a click or Space opens the folder list under it.
            DrawerMenuButtonArea(drawer: model.drawer, label: L("넣을 폴더") + ", " + (current?.displayName(.current) ?? ""), items: {
                folders.map { entry in
                    var item = DrawerMenuItem.action(entry.displayName(.current), symbol: nil, checked: entry.id == folder) { folder = entry.id }
                    item.square = entry.colorKey
                    return item
                }
            }, keyboard: true)
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
