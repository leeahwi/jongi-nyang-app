import AppKit
import Carbon.HIToolbox
import PaperCore
import SwiftUI

/// The drawer's text: the quick-write slip (↩ saves, ⇧↩ a new line) and an open memo (every key types; its first
/// line drawn in handwriting, code lines fixed-width). Grows with its text — the drawer's list scrolls, not the slip.
struct DrawerTextView: NSViewRepresentable {
    @Binding var text: String
    var palette: DrawerPalette
    var bodyFont: NSFont = .systemFont(ofSize: 12.5)
    /// The first non-empty line in this face (the memo's title); nil: all body.
    var titleFont: NSFont?
    /// Every line this tall (the memo sheet's rules), the title line `titleLineHeight`; nil: the font's own.
    var lineHeight: CGFloat?
    var titleLineHeight: CGFloat?
    /// ↩ calls onSubmit (⇧↩ is a new line); off: ↩ is a new line.
    var submitsOnReturn = false
    var onSubmit: () -> Void = {}
    var onEscape: () -> Void = {}
    /// Bumped to take the keyboard; the caret goes to the end (or to the end of `caretLine`).
    var focus = 0
    var caretLine: Int?
    var minHeight: CGFloat = 18
    /// Called with the text before each change (another device's edit may have come in meanwhile).
    var onEdit: ((String, String) -> Void)?
    var accessibilityLabel = ""
    /// A memo being typed: its right-click is the system's text menu with this section added (`이 메모`, 1.44).
    var extraMenu: (@MainActor () -> [DrawerMenuItem])?
    var menuDrawer: MemoDrawer?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> KeyTextView {
        let view = KeyTextView()
        view.isRichText = false
        view.allowsUndo = true
        view.drawsBackground = false
        view.isAutomaticQuoteSubstitutionEnabled = false
        view.isAutomaticDashSubstitutionEnabled = false
        view.isAutomaticTextReplacementEnabled = false
        view.isAutomaticSpellingCorrectionEnabled = false
        view.textContainerInset = .zero
        view.textContainer?.lineFragmentPadding = 0
        view.textContainer?.widthTracksTextView = true
        view.isVerticallyResizable = false
        view.isHorizontallyResizable = false
        view.delegate = context.coordinator
        view.setAccessibilityLabel(accessibilityLabel)
        view.string = text
        context.coordinator.restyle(view)
        view.onSubmit = { context.coordinator.parent.onSubmit() }
        view.onEscape = { context.coordinator.parent.onEscape() }
        view.submitsOnReturn = submitsOnReturn
        view.extraMenu = extraMenu
        view.menuFont = menuDrawer?.model.notebookFont
        context.coordinator.focused = focus
        if focus > 0 { context.coordinator.takeFocus(view, line: caretLine) }
        return view
    }

    func updateNSView(_ view: KeyTextView, context: Context) {
        let coordinator = context.coordinator
        let old = coordinator.parent
        coordinator.parent = self
        view.submitsOnReturn = submitsOnReturn
        view.extraMenu = extraMenu
        if view.string != text, !view.hasMarkedText() {
            // From elsewhere (another device, a box ticked): taken, the caret kept where it was.
            let caret = TextMerge.caret(view.selectedRange().location, from: view.string, to: text)
            view.string = text
            coordinator.restyle(view)
            view.setSelectedRange(NSRange(location: min(caret, (text as NSString).length), length: 0))
            view.invalidateIntrinsicContentSize()
        } else if old.palette != palette || old.titleFont != titleFont || old.bodyFont != bodyFont {
            coordinator.restyle(view)
        }
        if focus != coordinator.focused {
            coordinator.focused = focus
            coordinator.takeFocus(view, line: caretLine)
        }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView view: KeyTextView, context: Context) -> CGSize? {
        let width = proposal.width ?? 240
        guard let container = view.textContainer, let layout = view.layoutManager else { return nil }
        container.containerSize = NSSize(width: width, height: .greatestFiniteMagnitude)
        layout.ensureLayout(for: container)
        var height = layout.usedRect(for: container).height
        if view.string.isEmpty || view.string.hasSuffix("\n") {
            let each = lineHeight ?? layout.defaultLineHeight(for: view.font ?? bodyFont)
            height = max(height, each * CGFloat(max(1, view.string.components(separatedBy: "\n").count)))
        }
        return CGSize(width: width, height: max(minHeight, ceil(height)))
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: DrawerTextView
        var focused = 0
        init(_ parent: DrawerTextView) { self.parent = parent }

        func textDidChange(_ notification: Notification) {
            guard let view = notification.object as? NSTextView else { return }
            let before = parent.text
            restyle(view)
            parent.text = view.string
            parent.onEdit?(before, view.string)
            view.invalidateIntrinsicContentSize()
        }

        func takeFocus(_ view: NSTextView, line: Int?) {
            DispatchQueue.main.async {
                guard let window = view.window else { return }
                window.makeFirstResponder(view)
                let text = view.string as NSString
                var location = text.length
                if let line {
                    var start = 0
                    let lines = view.string.components(separatedBy: "\n")
                    for (index, part) in lines.enumerated() {
                        let length = (part as NSString).length
                        if index == line { location = start + length; break }
                        start += length + 1
                    }
                }
                view.setSelectedRange(NSRange(location: min(location, text.length), length: 0))
            }
        }

        /// The memo's look while it's typed: ink, the title line in handwriting, code lines fixed-width.
        func restyle(_ view: NSTextView) {
            guard let storage = view.textStorage else { return }
            let palette = parent.palette
            let ink = NSColor(palette.ink)
            func ruled(_ font: NSFont, _ height: CGFloat?) -> [NSAttributedString.Key: Any] {
                let paragraph = NSMutableParagraphStyle()
                guard let height else {
                    paragraph.lineSpacing = 3
                    return [.font: font, .foregroundColor: ink, .paragraphStyle: paragraph]
                }
                paragraph.minimumLineHeight = height
                paragraph.maximumLineHeight = height
                // The glyphs centred in the line (AppKit puts them at its foot).
                let offset = (height - (font.ascender - font.descender)) / 2
                return [.font: font, .foregroundColor: ink, .paragraphStyle: paragraph, .baselineOffset: offset]
            }
            let body = ruled(parent.bodyFont, parent.lineHeight)
            view.typingAttributes = body
            view.insertionPointColor = NSColor(palette.check)
            view.selectedTextAttributes = [.backgroundColor: NSColor(palette.check).withAlphaComponent(0.22)]
            guard !view.hasMarkedText() else { return }
            storage.beginEditing()
            let full = NSRange(location: 0, length: storage.length)
            storage.setAttributes(body, range: full)
            let text = storage.string as NSString
            var location = 0
            var titled = parent.titleFont == nil
            let mono = NSFont.monospacedSystemFont(ofSize: parent.bodyFont.pointSize - 1, weight: .regular)
            while location <= text.length {
                let range = text.lineRange(for: NSRange(location: location, length: 0))
                let line = text.substring(with: range).trimmingCharacters(in: .newlines)
                if !titled, !line.trimmingCharacters(in: .whitespaces).isEmpty, let title = parent.titleFont {
                    storage.addAttributes(ruled(title, parent.titleLineHeight ?? parent.lineHeight), range: range)
                    titled = true
                } else if Checklist.isCode(line) {
                    storage.addAttributes(ruled(mono, parent.lineHeight), range: range)
                }
                if range.length == 0 { break }
                location = NSMaxRange(range)
                if location >= text.length { break }
            }
            storage.endEditing()
            if let title = parent.titleFont, storage.length == 0 {
                view.typingAttributes = ruled(title, parent.titleLineHeight ?? parent.lineHeight)
            }
        }
    }

    final class KeyTextView: NSTextView {
        var onSubmit: () -> Void = {}
        var onEscape: () -> Void = {}
        var submitsOnReturn = false
        var extraMenu: (@MainActor () -> [DrawerMenuItem])?
        var menuFont: NotebookFont?

        /// The system's text menu (cut, copy, paste, spelling, substitutions …), then `이 메모`.
        override func menu(for event: NSEvent) -> NSMenu? {
            let menu = super.menu(for: event)
            guard let extra = extraMenu?(), !extra.isEmpty, let menu, let font = menuFont else { return menu }
            menu.addItem(.separator())
            for item in extra { DrawerMenuBuilder.add(item, to: menu, palette: nil, font: font) }
            return menu
        }

        override var intrinsicContentSize: NSSize { NSSize(width: NSView.noIntrinsicMetric, height: NSView.noIntrinsicMetric) }

        override func keyDown(with event: NSEvent) {
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if event.keyCode == UInt16(kVK_Escape), !hasMarkedText() {
                onEscape()
                return
            }
            if submitsOnReturn, !hasMarkedText(), event.keyCode == UInt16(kVK_Return) || event.keyCode == UInt16(kVK_ANSI_KeypadEnter) {
                if flags.contains(.shift) || flags.contains(.option) {
                    insertNewlineIgnoringFieldEditor(nil)
                } else {
                    onSubmit()
                }
                return
            }
            super.keyDown(with: event)
        }
    }
}
