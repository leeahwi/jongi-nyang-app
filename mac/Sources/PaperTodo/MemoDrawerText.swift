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
    /// The title's strokes a hair heavier (#14, option B: a 0.7 pt stroke in its own ink, as dark as a card's title;
    /// not for the clean face).
    var titleStroke = false
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
    /// The text lets go of the keyboard.
    var onBlur: (() -> Void)?
    var accessibilityLabel = ""
    /// A memo being typed: its right-click is the system's text menu with this section added (`이 메모`, 1.44).
    var extraMenu: (@MainActor () -> [DrawerMenuItem])?
    var menuDrawer: MemoDrawer?
    /// An open memo (#84): its marks styled as written, in the drawer's face and size (MemoText; `bodyFont` and
    /// `lineHeight` come from it). nil: plain text (the quick-write slip).
    var markdown: MemoText?

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    func makeNSView(context: Context) -> KeyTextView {
        let view: KeyTextView
        if markdown != nil {
            // TextKit 1 with the layout manager that draws code blocks, quotes and rules behind the words.
            let storage = NSTextStorage()
            let layout = MemoLayoutManager()
            // #132: TextKit 1 laid the words out from the top again whenever the view's frame was set or its display
            // marked (a long memo: 0.15–0.25 s more to open, the time the TextKit 2 view of 1.45 never paid);
            // non-contiguous layout does only the part asked for. A long memo's height isn't measured whole either
            // (#209, sizeThatFits): nothing is laid out ahead in idle time, only what is shown or asked for.
            layout.allowsNonContiguousLayout = true
            layout.backgroundLayoutEnabled = false
            layout.delegate = context.coordinator
            storage.addLayoutManager(layout)
            let container = NSTextContainer(size: NSSize(width: 240, height: CGFloat.greatestFiniteMagnitude))
            layout.addTextContainer(container)
            // Born as wide as its container, not zero (the container follows the view's width).
            view = KeyTextView(frame: NSRect(x: 0, y: 0, width: container.size.width, height: 18), textContainer: container)
            layout.boxLook = { [weak view] at in MainActor.assumeIsolated { view?.boxLook(at: at) } }
            view.drew = { [weak coordinator = context.coordinator] in coordinator?.laidOut() }
        } else {
            view = KeyTextView()
        }
        view.isRichText = false
        view.allowsUndo = true
        view.drawsBackground = false
        view.isAutomaticQuoteSubstitutionEnabled = false
        view.isAutomaticDashSubstitutionEnabled = false
        view.isAutomaticTextReplacementEnabled = false
        view.isAutomaticSpellingCorrectionEnabled = false
        view.textContainerInset = .zero
        // #14: no ring or box round the text while it's typed — the caret alone says so.
        view.focusRingType = .none
        view.textContainer?.lineFragmentPadding = 0
        view.textContainer?.widthTracksTextView = true
        view.isVerticallyResizable = false
        view.isHorizontallyResizable = false
        view.delegate = context.coordinator
        context.coordinator.textView = view
        view.setAccessibilityLabel(accessibilityLabel)
        view.string = text
        context.coordinator.shown = text
        context.coordinator.restyle(view, full: true)
        view.onSubmit = { context.coordinator.parent.onSubmit() }
        view.onEscape = { context.coordinator.parent.onEscape() }
        view.submitsOnReturn = submitsOnReturn
        view.extraMenu = extraMenu
        view.menuFont = menuDrawer?.model.notebookFont
        // #84: the formatting keys and the Aa bar reach this view.
        view.formats = markdown != nil
        if markdown != nil, let drawer = menuDrawer {
            drawer.editorView = view
            view.toggleMarks = { [weak drawer] in drawer?.showMarks.toggle() }
            view.askLink = { [weak drawer] edit in drawer?.linkEdit = edit }
            view.doneToBottom = { [weak drawer] in drawer?.doneToBottom ?? true }
        }
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
        // #3: against the coordinator's own copy of the words, not `view.string` (a bridged NSString: comparing a Korean
        // memo with it went through Unicode normalization, 20 ms a key at 100 KB and 0.2 s at 1 MB).
        if text != coordinator.shown, !view.hasMarkedText() {
            // From elsewhere (another device, a box ticked): taken, the caret kept where it was.
            let caret = TextMerge.caret(view.selectedRange().location, from: coordinator.shown, to: text)
            view.string = text
            coordinator.shown = text
            coordinator.restyle(view, full: true)
            view.setSelectedRange(NSRange(location: min(caret, (text as NSString).length), length: 0))
            view.invalidateIntrinsicContentSize()
        } else if old.palette != palette || old.titleFont != titleFont || old.bodyFont != bodyFont || old.titleStroke != titleStroke || old.markdown != markdown {
            coordinator.restyle(view, full: true)
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
        let words = view.textStorage?.string as NSString? ?? ""
        if words.length > Self.wholeLayout, layout.allowsNonContiguousLayout {
            // #209: a long memo (a 1 MB one took 2–3 s here) has only its first screens laid out; past them the height
            // is TextKit's own estimate, where it would put the words it hasn't laid out yet. It follows as TextKit lays
            // out more: the text scrolled into view, a key at the end (Coordinator's `laidOut`).
            layout.ensureLayout(forBoundingRect: NSRect(x: 0, y: 0, width: width, height: Self.firstScreens), in: container)
            let height = max(minHeight, ceil(layout.usedRect(for: container).height))
            context.coordinator.estimated = (width, height)
            return CGSize(width: width, height: height)
        }
        context.coordinator.estimated = nil
        layout.ensureLayout(for: container)
        var height = layout.usedRect(for: container).height
        if words.length == 0 || words.hasSuffix("\n") {
            let each = lineHeight ?? layout.defaultLineHeight(for: view.font ?? bodyFont)
            height = max(height, each * CGFloat(max(1, words.components(separatedBy: "\n").count)))
        }
        return CGSize(width: width, height: max(minHeight, ceil(height)))
    }

    /// #209: up to this many characters (UTF-16) the height is measured whole, every line laid out (about 0.1 s at
    /// this length on a busy Mac); a longer memo gets its first `firstScreens` points laid out and the rest estimated.
    static let wholeLayout = 20_000
    static let firstScreens: CGFloat = 2_400

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate, NSLayoutManagerDelegate {
        var parent: DrawerTextView
        var focused = 0
        /// #209: a long memo's last height given (TextKit's estimate past what it has laid out) and the width it was for;
        /// nil: measured whole.
        var estimated: (width: CGFloat, height: CGFloat)?
        private var heightAsked = false

        /// The memo's text view (its layout manager tells this coordinator when it laid out more).
        weak var textView: NSTextView?

        /// TextKit laid out more of a long memo (asked for, or to draw what scrolled into view: KeyTextView's `drew`):
        /// when that moved its estimate, the view asks for its height again, once, after this turn.
        nonisolated func layoutManager(_ layoutManager: NSLayoutManager, didCompleteLayoutFor textContainer: NSTextContainer?, atEnd layoutFinishedFlag: Bool) {
            MainActor.assumeIsolated { laidOut() }
        }

        /// Whether a long memo's estimate moved from the height last given (never when it was measured whole, nor at
        /// another width).
        private func heightMoved() -> Bool {
            guard let estimated, let view = textView, let container = view.textContainer, let layout = view.layoutManager,
                  abs(container.containerSize.width - estimated.width) < 0.5 else { return false }
            return abs(max(parent.minHeight, ceil(layout.usedRect(for: container).height)) - estimated.height) >= 1
        }

        func laidOut() {
            guard !heightAsked, heightMoved() else { return }
            heightAsked = true
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.heightAsked = false
                if self.heightMoved() { self.textView?.invalidateIntrinsicContentSize() }
            }
        }

        /// The words the view shows (outside a syllable being composed), as a native Swift string: what the binding
        /// and the model get, and what a text from elsewhere is compared with (#3).
        var shown = ""
        /// What the keys changed since the last restyle: from `start` to `tail` characters before the end (both stay
        /// right as later keys move the text around them). nil: nothing yet.
        private var dirty: (start: Int, tail: Int)?
        /// How many restyles took only the edited lines (the check counts them).
        private(set) var lineRestyles = 0
        /// #84: the lines whose marks show (the caret's), and the look the last restyle used.
        private var revealed: NSRange?
        private var lastStyle: (MemoStyler, [NSAttributedString.Key: Any]?)?
        /// The paper the caret's and the selection's colours were last set for.
        private var paintedPalette: DrawerPalette?
        init(_ parent: DrawerTextView) { self.parent = parent }

        func textView(_ textView: NSTextView, shouldChangeTextIn range: NSRange, replacementString text: String?) -> Bool {
            let tail = (textView.textStorage?.length ?? 0) - NSMaxRange(range)
            dirty = dirty.map { (min($0.start, range.location), min($0.tail, tail)) } ?? (range.location, tail)
            return true
        }

        func textDidChange(_ notification: Notification) {
            guard let view = notification.object as? NSTextView else { return }
            // Korean (any input method) while a syllable is being composed: nothing leaves the text view — no
            // restyle, no edit, no save — until it's committed; only its height may change.
            guard !view.hasMarkedText() else {
                view.invalidateIntrinsicContentSize()
                return
            }
            let before = parent.text
            restyle(view)
            // #3: copied out of the text storage once (a bridged NSString would make every later comparison of the
            // memo — SwiftUI's, the list's, the save's — a slow one through Unicode normalization).
            let now = (view as? KeyTextView)?.native ?? view.string
            shown = now
            parent.text = now
            parent.onEdit?(before, now)
            view.invalidateIntrinsicContentSize()
        }

        func textDidEndEditing(_ notification: Notification) { parent.onBlur?() }

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

        /// The memo's look while it's typed: ink, the title line in handwriting, code lines fixed-width. A key after the
        /// title line restyles only its own lines (a 1 MB memo isn't styled again whole on every key).
        func restyle(_ view: NSTextView, full: Bool = false) {
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
            func titleAttributes(_ font: NSFont) -> [NSAttributedString.Key: Any] {
                var attributes = ruled(font, parent.titleLineHeight ?? parent.lineHeight)
                guard parent.titleStroke else { return attributes }
                // Stroke and fill: the width is a percentage of the size, so 0.7 pt at any size (AppKit's 0.35 barely shows).
                attributes[.strokeWidth] = -(0.7 / font.pointSize * 100)
                attributes[.strokeColor] = ink
                return attributes
            }
            // An open memo (#84): its words in the drawer's face (MemoText), styled by MemoStyler below.
            let styler = parent.markdown.map {
                MemoStyler(text: $0, ink: ink, soft: NSColor(palette.preview), accent: NSColor(palette.check),
                           box: NSColor(palette.box), checkFill: NSColor(palette.check), checkMark: NSColor(palette.checkOn), done: NSColor(palette.faint))
            }
            let wordsLook = styler?.body ?? body
            // Keys typed on the title line take the title's face at once — a Korean syllable being composed too
            // (restyling waits for it below), so the line doesn't show the body face until a space and then jump.
            if let title = parent.titleFont {
                let text = storage.string as NSString
                let end = titleEnd(text)
                let at = view.selectedRange().location
                let onTitle = at < end || (at == end && end == text.length && !text.hasSuffix("\n"))
                view.typingAttributes = onTitle ? titleAttributes(title) : wordsLook
            } else {
                view.typingAttributes = wordsLook
            }
            // #132: only when the paper changed — setting the selection's look marks the text for display again,
            // and each key (and the first restyle, before the view has its size) paid a layout for it.
            if paintedPalette != palette {
                paintedPalette = palette
                view.insertionPointColor = NSColor(palette.check)
                view.selectedTextAttributes = [.backgroundColor: NSColor(palette.check).withAlphaComponent(0.22)]
            }
            guard !view.hasMarkedText() else { return }
            let text = storage.string as NSString
            let mono = NSFont.monospacedSystemFont(ofSize: parent.bodyFont.pointSize - 1, weight: .regular)
            let edited = dirty.map { ($0.start, max($0.start, text.length - $0.tail)) }
            dirty = nil
            if let styler {
                restyleMarkdown(storage, text, styler: styler, edited: full ? nil : edited, title: parent.titleFont.map(titleAttributes), selection: view.selectedRange())
                return
            }
            if !full, let (start, end) = edited, start <= text.length, start >= titleEnd(text) {
                // The lines the keys touched, and the one after (a line break typed or taken away moves it).
                var lines = text.lineRange(for: NSRange(location: start, length: min(end, text.length) - start))
                if NSMaxRange(lines) < text.length { lines = NSUnionRange(lines, text.lineRange(for: NSRange(location: NSMaxRange(lines), length: 0))) }
                storage.beginEditing()
                storage.setAttributes(body, range: lines)
                var location = lines.location
                while location < NSMaxRange(lines) {
                    let range = text.lineRange(for: NSRange(location: location, length: 0))
                    if Checklist.isCode(text.substring(with: range).trimmingCharacters(in: .newlines)) {
                        storage.addAttributes(ruled(mono, parent.lineHeight), range: range)
                    }
                    if range.length == 0 { break }
                    location = NSMaxRange(range)
                }
                storage.endEditing()
                lineRestyles += 1
                return
            }
            storage.beginEditing()
            let full = NSRange(location: 0, length: storage.length)
            storage.setAttributes(body, range: full)
            var location = 0
            var titled = parent.titleFont == nil
            while location <= text.length {
                let range = text.lineRange(for: NSRange(location: location, length: 0))
                let line = text.substring(with: range).trimmingCharacters(in: .newlines)
                if !titled, !line.trimmingCharacters(in: .whitespaces).isEmpty, let title = parent.titleFont {
                    storage.addAttributes(titleAttributes(title), range: range)
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
                view.typingAttributes = titleAttributes(title)
            }
        }

        /// #84: the memo's lines with their marks styled (MemoStyler). A key after the title line restyles its own
        /// lines and the one after, and goes on only while a line now ends inside or outside a code block differently
        /// than before — so a ``` typed or taken away restyles the block it opens or closes, nothing more; anything
        /// else (a change from elsewhere, the look) restyles every line.
        private func restyleMarkdown(_ storage: NSTextStorage, _ text: NSString, styler: MemoStyler, edited: (Int, Int)?,
                                     title: [NSAttributedString.Key: Any]?, selection: NSRange) {
            lastStyle = (styler, title)
            let reveal = Self.lines(text, selection)
            defer { revealed = reveal }

            storage.beginEditing()
            defer { storage.endEditing() }
            if let (start, end) = edited, start <= text.length, start >= titleEnd(text) {
                var first = Self.lineStart(text, start)
                // 문단 간격 (#141): the line above too — whether a paragraph ends under it follows the edited line.
                if styler.text.paragraph > 0, first > 0, Self.lineStart(text, first - 1) >= titleEnd(text) { first = Self.lineStart(text, first - 1) }
                var stop = Self.lineEnd(text, min(end, text.length))
                if stop < text.length { stop = Self.lineEnd(text, stop + 1) }
                let open = first > 0 && (storage.attribute(.memoFence, at: first - 1, effectiveRange: nil) as? Int) == 1
                styleLines(storage, text, styler: styler, from: first, through: stop, open: open, title: nil, titleAt: -1, bodyDone: false, reveal: reveal)
                // The line the caret left (↩, a click while typing) hides its marks again.
                if let old = revealed, old != reveal, old.location < first || old.location > stop {
                    restyleLines(storage, text, old, styler: styler, title: title, reveal: reveal)
                }
                lineRestyles += 1
                return
            }
            storage.setAttributes(styler.body, range: NSRange(location: 0, length: storage.length))
            let titleAt = title == nil ? -1 : titleStart(text)
            styleLines(storage, text, styler: styler, from: 0, through: text.length, open: false, title: title, titleAt: titleAt, bodyDone: true, reveal: reveal)
        }

        /// The lines from the one `range` starts in through the one it ends in, styled again as they are.
        private func restyleLines(_ storage: NSTextStorage, _ text: NSString, _ range: NSRange, styler: MemoStyler,
                                  title: [NSAttributedString.Key: Any]?, reveal: NSRange) {
            let start = Self.lineStart(text, min(range.location, text.length))
            let open = start > 0 && (storage.attribute(.memoFence, at: start - 1, effectiveRange: nil) as? Int) == 1
            styleLines(storage, text, styler: styler, from: start, through: min(NSMaxRange(range), text.length), open: open,
                       title: title, titleAt: title == nil ? -1 : titleStart(text), bodyDone: false, reveal: reveal)
        }

        /// The lines a selection touches: from its first line's start to its last line's end.
        static func lines(_ text: NSString, _ selection: NSRange) -> NSRange {
            let start = lineStart(text, min(selection.location, text.length))
            let end = lineEnd(text, min(NSMaxRange(selection), text.length))
            return NSRange(location: start, length: end - start)
        }

        /// #84 (2026-10-30): the caret moved to other lines — the lines it left hide their marks, the lines it reached
        /// show them; only those lines are styled again (not while a syllable is composed, nor mid-edit).
        func textViewDidChangeSelection(_ notification: Notification) {
            guard let view = notification.object as? NSTextView, let storage = view.textStorage, dirty == nil, !view.hasMarkedText(),
                  let (styler, title) = lastStyle, !styler.text.showMarks else { return }
            let text = storage.string as NSString
            let reveal = Self.lines(text, view.selectedRange())
            guard let old = revealed, old != reveal, NSMaxRange(old) <= text.length else { revealed = reveal; return }
            revealed = reveal
            storage.beginEditing()
            restyleLines(storage, text, old, styler: styler, title: title, reveal: reveal)
            restyleLines(storage, text, reveal, styler: styler, title: title, reveal: reveal)
            storage.endEditing()
        }

        /// Styles the lines from the one starting at `from`, at least through `through`, then on while each line's
        /// end changed whether a code block is open. `bodyDone`: plain lines already have the body's look.
        private func styleLines(_ storage: NSTextStorage, _ text: NSString, styler: MemoStyler, from: Int, through: Int, open: Bool,
                                title: [NSAttributedString.Key: Any]?, titleAt: Int, bodyDone: Bool, reveal: NSRange) {
            var location = from, inBlock = open
            var units: [UInt16] = []
            while location <= text.length {
                let end = Self.lineEnd(text, location)
                let range = NSRange(location: location, length: end - location)
                let whole = NSRange(location: location, length: min(end + 1, text.length) - location)
                units = [UInt16](repeating: 0, count: range.length)
                if range.length > 0 { text.getCharacters(&units, range: range) }
                let read = MemoMarkdown.readLine(units, inBlock: inBlock)
                let after = read.kind == .fence ? !inBlock : inBlock
                let before = whole.length > 0 && (storage.attribute(.memoFence, at: NSMaxRange(whole) - 1, effectiveRange: nil) as? Int) == 1
                let isTitle = location == titleAt
                let shown = styler.text.showMarks || (location <= NSMaxRange(reveal) && end >= reveal.location)
                // 문단 간격 (#141): the room under a paragraph's last line, which depends on the line after it.
                let spaced = styler.text.paragraph > 0 && !isTitle && end < text.length
                    && TextSteps.endsParagraph(read.kind, next: Self.nextKind(text, end + 1, inBlock: after))
                if bodyDone, !isTitle, !after, !shown, !spaced, read.kind == .blank || (read.kind == .text && !units.contains(where: Self.markish)
                                                                          && !Self.mayBeCode(units, read.end)) {
                    // A plain line in a whole restyle: the body's look is already on it.
                } else {
                    styler.style(storage, units: units, read: read, range: range, whole: whole, title: isTitle ? title : nil, fenceAfter: after, reveal: shown,
                                 spaceAfter: spaced)
                }
                inBlock = after
                if end >= text.length { break }
                location = end + 1
                if location > through, after == before { break }
            }
        }

        /// The kind of the line starting at `at` (#141: whether the line above ends a paragraph).
        private static func nextKind(_ text: NSString, _ at: Int, inBlock: Bool) -> MemoMarkdown.LineKind {
            let end = lineEnd(text, at)
            var units = [UInt16](repeating: 0, count: end - at)
            if end > at { text.getCharacters(&units, range: NSRange(location: at, length: end - at)) }
            return MemoMarkdown.readLine(units, inBlock: inBlock).kind
        }

        /// Whether `Checklist.isCode` could say yes to the line's first `end` units (#209): a line with Hangul, without
        /// `$` or `` ` `` and without four spaces or a tab in front, can't be an old code line, so it isn't made a String
        /// to ask (a 1 MB memo's lines: 50 ms on ↩); any other line is asked.
        private static func mayBeCode(_ units: [UInt16], _ end: Int) -> Bool {
            let line = units[..<min(end, units.count)]
            let indented = line.first == 0x09 || (line.count >= 4 && line.prefix(4).allSatisfy { $0 == 0x20 })
            if !indented, !line.contains(0x24), !line.contains(0x60), line.contains(where: { (0xAC00...0xD7A3).contains($0) || (0x3131...0x318E).contains($0) }) { return false }
            return Checklist.isCode(String(decoding: line, as: UTF16.self))
        }

        /// A character a mark could start with (a plain line without any, and not an old code line, needs no styling).
        private static func markish(_ unit: UInt16) -> Bool {
            switch unit {
            case 0x2A, 0x5F, 0x7E, 0x60, 0x5B, 0x3A: true // * _ ~ ` [ and the colon of an address
            default: false
            }
        }

        static func lineStart(_ text: NSString, _ at: Int) -> Int {
            guard at > 0 else { return 0 }
            let found = text.range(of: "\n", options: .backwards, range: NSRange(location: 0, length: min(at, text.length)))
            return found.location == NSNotFound ? 0 : found.location + 1
        }

        /// Where the line from `at` ends: its "\n", or the text's end.
        static func lineEnd(_ text: NSString, _ at: Int) -> Int {
            guard at < text.length else { return text.length }
            let found = text.range(of: "\n", options: [], range: NSRange(location: at, length: text.length - at))
            return found.location == NSNotFound ? text.length : found.location
        }

        /// Where the title line (the first with words) starts; -1 when no line has words.
        private func titleStart(_ text: NSString) -> Int {
            var location = 0
            while location < text.length {
                let end = Self.lineEnd(text, location)
                let line = text.substring(with: NSRange(location: location, length: end - location))
                if !line.trimmingCharacters(in: .whitespaces).trimmingCharacters(in: .newlines).isEmpty { return location }
                location = end + 1
            }
            return -1
        }

        /// Where the title line (the first with words) ends, its break included; 0 without a title face, the text's
        /// end when no line has words yet. An edit from there on can't change which line is the title.
        private func titleEnd(_ text: NSString) -> Int {
            guard parent.titleFont != nil else { return 0 }
            var location = 0
            while location < text.length {
                let range = text.lineRange(for: NSRange(location: location, length: 0))
                // The same test as the whole restyle's.
                if !text.substring(with: range).trimmingCharacters(in: .newlines).trimmingCharacters(in: .whitespaces).isEmpty { return NSMaxRange(range) }
                if range.length == 0 { break }
                location = NSMaxRange(range)
            }
            return text.length + 1
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

        /// After each drawing (#209): what scrolled into view was laid out for it, which may move a long memo's height.
        var drew: () -> Void = {}

        override func draw(_ dirtyRect: NSRect) {
            super.draw(dirtyRect)
            drew()
        }

        /// #209: being taken out of the drawer (the memo put away), it isn't marked for display: with no view above it
        /// to clip it, all of it counts as shown (an infinite visible rect), and a long memo laid out only in part was
        /// laid out whole for that (1 MB: 1.2–1.7 s on Esc).
        private var wasInWindow = false

        override func viewDidMoveToWindow() {
            if window != nil { wasInWindow = true }
            super.viewDidMoveToWindow()
        }

        override func setNeedsDisplay(_ rect: NSRect, avoidAdditionalLayout flag: Bool) {
            guard !(wasInWindow && visibleRect.isInfinite) else { return }
            super.setNeedsDisplay(rect, avoidAdditionalLayout: flag)
        }

        /// The words as a native Swift string, copied out of the text storage (#3): `string` is the storage's NSString
        /// bridged, and Swift's work on a long Korean one (comparing, searching, the edits below) goes through Unicode
        /// normalization character by character. Copied in bulk (Foundation writes its UTF-8 in one go, Swift takes the
        /// bytes as they are): about a millisecond for 1 MB, where `makeContiguousUTF8` and `String(decoding:as: UTF16)`
        /// went a character at a time (35–40 ms).
        var native: String {
            guard let words = textStorage?.string as NSString? else { return string }
            return Self.native(words)
        }

        static func native(_ words: NSString) -> String {
            let length = words.length
            guard length > 0 else { return "" }
            let capacity = length * 3
            var bytes = [UInt8](repeating: 0, count: capacity)
            var used = 0
            var rest = NSRange(location: 0, length: 0)
            let whole = bytes.withUnsafeMutableBytes { raw in
                words.getBytes(raw.baseAddress, maxLength: capacity, usedLength: &used, encoding: String.Encoding.utf8.rawValue,
                               options: [], range: NSRange(location: 0, length: length), remaining: &rest)
            }
            // A lone surrogate (UTF-8 can't hold it): the slow copy, which writes U+FFFD for it as Swift always does.
            guard whole, rest.length == 0 else {
                var copy = words as String
                copy.makeContiguousUTF8()
                return copy
            }
            return bytes.withUnsafeBufferPointer { String(decoding: UnsafeBufferPointer(rebasing: $0[..<used]), as: UTF8.self) }
        }

        // MARK: 메모 서식 (#84, 2026-10-30): keys, the Aa bar and paste, as MemoEdits says (one change, so one undo)

        /// An open memo: the formatting keys, ↩ that continues a list, Tab, ⌥↑↓ and the smart paste are on.
        var formats = false
        /// ⇧⌘R: 기호 늘 보이기.
        var toggleMarks: () -> Void = {}

        /// The words made what `edit` says: only the part that differs is replaced (a 1 MB memo isn't put back whole),
        /// through the text view's own change, so the edit is one undo; then the selection.
        @discardableResult
        func apply(_ edit: MemoEdits.Edit?) -> Bool {
            guard let edit, let storage = textStorage, !hasMarkedText() else { return false }
            let old = storage.string as NSString, new = edit.text as NSString
            let limit = min(old.length, new.length)
            var start = 0
            while start < limit, old.character(at: start) == new.character(at: start) { start += 1 }
            var tail = 0
            while tail < limit - start, old.character(at: old.length - 1 - tail) == new.character(at: new.length - 1 - tail) { tail += 1 }
            let range = NSRange(location: start, length: old.length - start - tail)
            let insert = new.substring(with: NSRange(location: start, length: new.length - start - tail))
            if range.length > 0 || !insert.isEmpty {
                guard shouldChangeText(in: range, replacementString: insert) else { return false }
                storage.replaceCharacters(in: range, with: insert)
                didChangeText()
            }
            setSelectedRange(NSRange(location: edit.from, length: edit.to - edit.from))
            scrollRangeToVisible(selectedRange())
            return true
        }

        enum Format { case bold, italic, strike, code, heading, list, olist, check, quote, rule, link }

        /// The Aa bar's buttons and the keys: on the selection, or at the caret (a line's format on the caret's line).
        func format(_ format: Format) {
            if format == .link, linkField() { return }
            let text = native, range = selectedRange()
            let (from, to) = (range.location, NSMaxRange(range))
            let edit: MemoEdits.Edit = switch format {
            case .bold: MemoEdits.wrap(text, from: from, to: to, mark: "**")
            case .italic: MemoEdits.wrap(text, from: from, to: to, mark: "*")
            case .strike: MemoEdits.wrap(text, from: from, to: to, mark: "~~")
            case .code: MemoEdits.wrap(text, from: from, to: to, mark: "`")
            case .heading: MemoEdits.heading(text, from: from, to: to, level: nil)
            case .list: MemoEdits.toggleLines(text, from: from, to: to, kind: .list)
            case .olist: MemoEdits.toggleLines(text, from: from, to: to, kind: .olist)
            case .check: MemoEdits.toggleLines(text, from: from, to: to, kind: .check)
            case .quote: MemoEdits.toggleLines(text, from: from, to: to, kind: .quote)
            case .rule: MemoEdits.rule(text, from: from, to: to)
            case .link: MemoEdits.link(text, from: from, to: to)
            }
            apply(edit)
        }

        /// #135: ⌘K (and the Aa bar's link) asks the drawer for the link field — on chosen words, or with the caret in a
        /// link; with nothing chosen it puts `[]()` in as before.
        var askLink: ((MemoDrawer.LinkEdit) -> Void)?

        /// Whether the link field was asked for.
        private func linkField() -> Bool {
            guard let askLink, !hasMarkedText() else { return false }
            let range = selectedRange(), (from, to) = (range.location, NSMaxRange(range))
            if let link = MemoEdits.linkAt(native, from: from, to: to) {
                askLink(MemoDrawer.LinkEdit(from: from, to: to, url: link.url, existing: true))
                return true
            }
            guard to > from, !(string as NSString).substring(with: range).contains("\n") else { return false }
            askLink(MemoDrawer.LinkEdit(from: from, to: to, url: "", existing: false))
            return true
        }

        /// ⌘B ⌘I ⇧⌘X ⌥⌘C(code; ⌘E is 텍스트로 내보내기) ⌘K, ⌃⌘1–3 · ⌃⌘0 (⌥⌘ digits are the spaces'), ⇧⌘L, ⇧⌘U, ⇧⌘R, ⌥⇧⌘V.
        override func performKeyEquivalent(with event: NSEvent) -> Bool {
            guard formats, window?.firstResponder === self, !hasMarkedText(), let key = event.charactersIgnoringModifiers?.lowercased() else {
                return super.performKeyEquivalent(with: event)
            }
            let flags = event.modifierFlags.intersection([.command, .shift, .option, .control])
            let range = selectedRange()
            switch (flags, key) {
            case ([.command], "b"): format(.bold)
            case ([.command], "i"): format(.italic)
            case ([.command], "k"): format(.link)
            case ([.command, .shift], "x"): format(.strike)
            case ([.command, .option], "c"), ([.command, .option], "ç"): format(.code)
            case ([.command, .shift], "l"): format(.check)
            // The caret's box ticked or unticked (#133; Apple Notes' 체크 표시), as a click on it: one undo.
            case ([.command, .shift], "u"): apply(MemoEdits.tickAtCaret(native, from: range.location, to: NSMaxRange(range), moveDone: doneToBottom()))
            case ([.command, .shift], "r"): toggleMarks()
            case ([.command, .control], let digit) where ["0", "1", "2", "3"].contains(digit):
                apply(MemoEdits.heading(native, from: range.location, to: NSMaxRange(range), level: Int(digit)!))
            case ([.command, .option, .shift], "v"), ([.command, .option, .shift], "◊"):
                if let plain = NSPasteboard.general.string(forType: .string) { insertText(plain, replacementRange: range) }
            default:
                return super.performKeyEquivalent(with: event)
            }
            return true
        }

        /// Tab · ⇧Tab: a list a step in or out (elsewhere Tab puts two spaces, ⇧Tab moves on as before).
        override func insertTab(_ sender: Any?) {
            let range = selectedRange()
            if formats, apply(MemoEdits.indent(native, from: range.location, to: NSMaxRange(range), out: false)) { return }
            super.insertTab(sender)
        }

        override func insertBacktab(_ sender: Any?) {
            let range = selectedRange()
            if formats, apply(MemoEdits.indent(native, from: range.location, to: NSMaxRange(range), out: true)) { return }
            super.insertBacktab(sender)
        }

        /// A paste: a bare address over a selection makes a link, lines of code onto an empty line come in ``` fences.
        override func paste(_ sender: Any?) {
            let range = selectedRange()
            if formats, let pasted = NSPasteboard.general.string(forType: .string),
               apply(MemoEdits.paste(native, from: range.location, to: NSMaxRange(range), pasted: pasted)) { return }
            super.paste(sender)
        }

        /// 끝낸 항목 아래로 보내기: read when a box is clicked (#133).
        var doneToBottom: () -> Bool = { true }

        /// The checklist box drawn under `point` (#133): its line (0-based). The caret's line shows `- [ ]` instead,
        /// so it has none.
        func box(at point: NSPoint) -> Int? { boxHit(at: point)?.line }

        /// The box under (or within MemoBox.target round) `point`: its line and the character it is drawn on.
        func boxHit(at point: NSPoint) -> (line: Int, at: Int)? {
            guard let storage = textStorage, let layout = layoutManager as? MemoLayoutManager, let container = textContainer, storage.length > 0 else { return nil }
            let inside = NSPoint(x: point.x - textContainerOrigin.x, y: point.y - textContainerOrigin.y)
            let index = layout.characterIndexForGlyph(at: layout.glyphIndex(for: inside, in: container))
            let text = storage.string as NSString
            let start = Coordinator.lineStart(text, min(index, text.length))
            // The box is on its line's mark, at most a few spaces in.
            var at = start
            while at < min(text.length, start + 12), storage.attribute(.memoCheckBox, at: at, effectiveRange: nil) == nil { at += 1 }
            guard at < text.length, storage.attribute(.memoCheckBox, at: at, effectiveRange: nil) != nil,
                  let rect = layout.boxRect(at: at) else { return nil }
            // #163: as generous as the note's boxes — about 25 × 25 round its middle (the line's height at most).
            let reach = (MemoBox.target - MemoBox.size) / 2
            guard rect.insetBy(dx: -reach, dy: -reach).contains(inside) else { return nil }
            var line = 0, search = 0
            while search < start {
                let found = text.range(of: "\n", options: [], range: NSRange(location: search, length: start - search))
                if found.location == NSNotFound { break }
                line += 1
                search = NSMaxRange(found)
            }
            return (line, at)
        }

        // MARK: #163 — a box ticked by a click is drawn ticking

        /// The box being drawn ticking (or unticking): its character, when it started, which way, its words and their
        /// colours before and after (the words fade to done once the box is filled).
        private struct Ticking {
            var at: Int
            var start: CFTimeInterval
            var on: Bool
            var words: NSRange
            var ink: NSColor?
            var done: NSColor?
            /// The text's changes when it started: another change stops it.
            var edits: Int
        }
        private var ticking: Ticking?
        private var tickTimer: Timer?
        private var edits = 0
        /// The shared motion words (PaperTheme `Motion`): the box fills with 등장, the words fade with 바뀜, back with 살짝.
        static let fill: CFTimeInterval = Motion.enter.duration
        static let fade: CFTimeInterval = Motion.change.duration
        static let untick: CFTimeInterval = Motion.quick.duration

        override func didChangeText() {
            edits += 1
            super.didChangeText()
        }

        func boxLook(at character: Int) -> CGFloat? {
            guard let ticking, ticking.at == character else { return nil }
            let elapsed = CACurrentMediaTime() - ticking.start
            return ticking.on ? CGFloat(min(1, elapsed / Self.fill)) : CGFloat(max(0, 1 - elapsed / Self.untick))
        }

        /// A click on a box: the words change at once (one undo); the tick is drawn over 0.34 s (unticked 0.12 s);
        /// with 끝낸 항목 아래로 the line moves only after that, the tick undone and made again with the move so the two
        /// stay one undo. Reduce motion: one change at once, as before.
        private func tickBox(line: Int, at: Int) {
            let range = selectedRange(), before = native
            let move = doneToBottom()
            guard !Motion.reduced, SlipMotion.enabled, let storage = textStorage else {
                apply(MemoEdits.tick(before, line: line, from: range.location, to: NSMaxRange(range), moveDone: move))
                return
            }
            let on = (storage.attribute(.memoCheckBox, at: at, effectiveRange: nil) as? MemoBox)?.checked == false
            let ns = before as NSString
            let start = Coordinator.lineStart(ns, at), end = Coordinator.lineEnd(ns, at)
            let read = MemoMarkdown.readLine(Array(ns.substring(with: NSRange(location: start, length: end - start)).utf16), inBlock: false)
            let words = NSRange(location: start + read.words, length: max(0, read.end - read.words))
            let ink = words.length > 0 ? storage.attribute(.foregroundColor, at: words.location, effectiveRange: nil) as? NSColor : nil
            breakUndoCoalescing()
            guard apply(MemoEdits.tick(before, line: line, from: range.location, to: NSMaxRange(range), moveDone: false)) else { return }
            let done = words.length > 0 && words.location < storage.length ? storage.attribute(.foregroundColor, at: words.location, effectiveRange: nil) as? NSColor : nil
            ticking = Ticking(at: at, start: CACurrentMediaTime(), on: on, words: words, ink: ink, done: done, edits: edits)
            frame()
            tickTimer?.invalidate()
            let timer = Timer(timeInterval: 1.0 / 60, repeats: true) { [weak self] _ in MainActor.assumeIsolated { self?.frame() } }
            RunLoop.main.add(timer, forMode: .common)
            tickTimer = timer
            guard move else { return }
            let after = edits
            DispatchQueue.main.asyncAfter(deadline: .now() + (on ? Self.fill + Self.fade + 0.02 : Self.untick + 0.02)) { [weak self] in
                guard let self, self.edits == after, self.window != nil, !self.hasMarkedText(), self.undoManager?.canUndo == true else { return }
                self.stopTicking()
                self.undoManager?.undo()
                self.apply(MemoEdits.tick(before, line: line, from: range.location, to: NSMaxRange(range), moveDone: true))
            }
        }

        /// One frame: the box redrawn, the words' ink and line faded toward done once the box is filled.
        private func frame() {
            guard let ticking, let storage = textStorage, let layout = layoutManager as? MemoLayoutManager else { return stopTicking() }
            guard ticking.edits == edits, window != nil, NSMaxRange(ticking.words) <= storage.length else { return stopTicking() }
            let elapsed = CACurrentMediaTime() - ticking.start
            if ticking.on, ticking.words.length > 0, let ink = ticking.ink, let done = ticking.done {
                let fade = CGFloat(max(0, min(1, (elapsed - Self.fill) / Self.fade)))
                let color = ink.blended(withFraction: fade, of: done) ?? done
                storage.beginEditing()
                storage.addAttributes([.foregroundColor: color, .strokeColor: color, .strikethroughColor: done.withAlphaComponent(done.alphaComponent * fade)], range: ticking.words)
                storage.endEditing()
            }
            if let rect = layout.boxRect(at: ticking.at) {
                setNeedsDisplay(rect.offsetBy(dx: textContainerOrigin.x, dy: textContainerOrigin.y).insetBy(dx: -3, dy: -3))
            }
            if elapsed >= (ticking.on ? Self.fill + Self.fade : Self.untick) { stopTicking() }
        }

        private func stopTicking() {
            tickTimer?.invalidate()
            tickTimer = nil
            guard let finished = ticking else { return }
            ticking = nil
            if let storage = textStorage, finished.edits == edits, finished.on, let done = finished.done, NSMaxRange(finished.words) <= storage.length, finished.words.length > 0 {
                storage.addAttributes([.foregroundColor: done, .strokeColor: done, .strikethroughColor: done], range: finished.words)
            }
            if let layout = layoutManager as? MemoLayoutManager, let rect = layout.boxRect(at: finished.at) {
                setNeedsDisplay(rect.offsetBy(dx: textContainerOrigin.x, dy: textContainerOrigin.y).insetBy(dx: -3, dy: -3))
            }
        }

        /// ⌘-click on a link's words or a bare address opens it (#84); a click on a checklist's box ticks it (#133, one
        /// undo, the caret kept on its words); a plain click places the caret as before.
        override func mouseDown(with event: NSEvent) {
            if formats, !hasMarkedText(), event.modifierFlags.intersection([.command, .shift, .option, .control]).isEmpty,
               let hit = boxHit(at: convert(event.locationInWindow, from: nil)) {
                tickBox(line: hit.line, at: hit.at)
                return
            }
            if event.modifierFlags.contains(.command), let storage = textStorage, let layout = layoutManager, let container = textContainer {
                let point = convert(event.locationInWindow, from: nil)
                let inside = NSPoint(x: point.x - textContainerOrigin.x, y: point.y - textContainerOrigin.y)
                let index = layout.characterIndex(for: inside, in: container, fractionOfDistanceBetweenInsertionPoints: nil)
                if index < storage.length, let address = storage.attribute(.memoLink, at: index, effectiveRange: nil) as? String,
                   let url = URL(string: address), ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") {
                    NSWorkspace.shared.open(url)
                    return
                }
            }
            super.mouseDown(with: event)
        }

        override func keyDown(with event: NSEvent) {
            let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
            if event.keyCode == UInt16(kVK_Escape), !hasMarkedText() {
                onEscape()
                return
            }
            let mods = flags.intersection([.command, .shift, .option, .control])
            if formats, !hasMarkedText() {
                let range = selectedRange()
                // ↩ continues a list, a checklist, a number or a quote (⇧↩: a plain new line in the same item).
                if event.keyCode == UInt16(kVK_Return), mods.isEmpty,
                   apply(MemoEdits.enter(native, from: range.location, to: NSMaxRange(range))) { return }
                if event.keyCode == UInt16(kVK_Return), mods == .shift {
                    insertText("\n", replacementRange: range)
                    return
                }
                // ⌥↑ · ⌥↓: the caret's line (or the lines chosen) up or down.
                if mods == .option,
                   event.keyCode == UInt16(kVK_UpArrow) || event.keyCode == UInt16(kVK_DownArrow) {
                    apply(MemoEdits.moveLines(native, from: range.location, to: NSMaxRange(range), up: event.keyCode == UInt16(kVK_UpArrow)))
                    return
                }
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
