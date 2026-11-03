import AppKit
import PaperCore
import SwiftUI

// 메모 마크다운 (#84, docs/plans/memo-markdown.md): how a memo's marks look while it is typed (DrawerTextView) and in an
// open memo (CheckedText) — styled as written, the marks kept but faint (40 % of the ink). The spans come from
// PaperCore's MemoMarkdown, the same as the Windows app's.

extension NSAttributedString.Key {
    /// On every character of a line (its "\n" too) after which a code block is open: the next line's start reads it,
    /// so a key restyles only its own lines and still knows whether they are code.
    static let memoFence = NSAttributedString.Key("PaperTodo.memoFence")
    /// Drawn behind a line by MemoLayoutManager: a code block's tint, a quote's bar, a rule.
    static let memoBlockFill = NSAttributedString.Key("PaperTodo.memoBlockFill")
    static let memoQuoteBar = NSAttributedString.Key("PaperTodo.memoQuoteBar")
    static let memoRule = NSAttributedString.Key("PaperTodo.memoRule")
    /// A link's address (a `[words](url)` link's words, a bare address): ⌘-click opens it.
    static let memoLink = NSAttributedString.Key("PaperTodo.memoLink")
    /// On a hidden list mark's first character: MemoLayoutManager draws a • there, in this colour.
    static let memoBullet = NSAttributedString.Key("PaperTodo.memoBullet")
    /// On a hidden checklist mark's first character (#133): MemoLayoutManager draws the card's box there; a click ticks it.
    static let memoCheckBox = NSAttributedString.Key("PaperTodo.memoCheckBox")
}

/// A checklist line's box in the editor (#133): the card's CheckBox — 15 pt (#163; 13 before, the note's own are 17–19),
/// 3.5 pt corners, an edge when open, filled with a checkmark when done.
final class MemoBox: NSObject {
    static let size: CGFloat = 15
    /// The box and the gap after it (CheckedText's HStack spacing): how wide the hidden `- [ ] ` is drawn.
    static let width: CGFloat = 22
    /// #163: a click this close round the box (about 25 × 25 pt, as the note's to-do boxes) ticks it.
    static let target: CGFloat = 25
    let checked: Bool
    let edge: NSColor
    let fill: NSColor
    let mark: NSColor
    init(checked: Bool, edge: NSColor, fill: NSColor, mark: NSColor) {
        self.checked = checked; self.edge = edge; self.fill = fill; self.mark = mark
    }

    /// Two boxes alike are the same attribute (a restyle of a few lines matches a whole one, and runs join).
    override func isEqual(_ object: Any?) -> Bool {
        guard let other = object as? MemoBox else { return false }
        return checked == other.checked && edge == other.edge && fill == other.fill && mark == other.mark
    }

    override var hash: Int { checked ? 1 : 0 }

    /// The box in `rect` (15 × 15, a flipped view's). `look` (#163): how ticked it is drawn, 0 open – 1 done — while a
    /// click ticks it, the fill grows in over the first half and the mark draws itself in after; nil: as it is.
    func draw(in rect: NSRect, look: CGFloat? = nil) {
        let look = min(max(look ?? (checked ? 1 : 0), 0), 1)
        if look < 1 {
            let inner = NSBezierPath(roundedRect: rect.insetBy(dx: 0.6, dy: 0.6), xRadius: 2.9, yRadius: 2.9)
            inner.lineWidth = 1.2
            edge.withAlphaComponent(edge.alphaComponent * (1 - look)).setStroke()
            inner.stroke()
        }
        guard look > 0 else { return }
        let grow = min(1, look / 0.55)
        let scale = 0.82 + 0.18 * grow
        let filled = NSRect(x: rect.midX - rect.width * scale / 2, y: rect.midY - rect.height * scale / 2, width: rect.width * scale, height: rect.height * scale)
        fill.withAlphaComponent(fill.alphaComponent * grow).setFill()
        NSBezierPath(roundedRect: filled, xRadius: 3.5 * scale, yRadius: 3.5 * scale).fill()
        let drawn = max(0, min(1, (look - 0.35) / 0.65))
        guard drawn > 0 else { return }
        // The mark as two strokes, drawn in from its short arm (the same shape at rest).
        let a = NSPoint(x: rect.minX + rect.width * 0.27, y: rect.minY + rect.height * 0.52)
        let b = NSPoint(x: rect.minX + rect.width * 0.43, y: rect.minY + rect.height * 0.68)
        let c = NSPoint(x: rect.minX + rect.width * 0.74, y: rect.minY + rect.height * 0.34)
        let first = hypot(b.x - a.x, b.y - a.y), second = hypot(c.x - b.x, c.y - b.y)
        var length = (first + second) * drawn
        let path = NSBezierPath()
        path.lineWidth = 1.9
        path.lineCapStyle = .round
        path.lineJoinStyle = .round
        path.move(to: a)
        let toB = min(1, length / first)
        path.line(to: NSPoint(x: a.x + (b.x - a.x) * toB, y: a.y + (b.y - a.y) * toB))
        length -= first
        if length > 0 {
            let toC = min(1, length / second)
            path.line(to: NSPoint(x: b.x + (c.x - b.x) * toC, y: b.y + (c.y - b.y) * toC))
        }
        mark.setStroke()
        path.stroke()
    }
}

/// TextKit 1's layout manager with the blocks drawn behind the words: a code block's tint across the text's width, a
/// quote's 2 pt bar at its left, a rule's 1 pt line through the middle of its line.
final class MemoLayoutManager: NSLayoutManager {
    /// #163: how ticked the box at a character is drawn while it ticks (the text view's animation); nil: as it is.
    var boxLook: ((Int) -> CGFloat?)?
    /// Snapshots: the `n`th box of the text drawn this far into its tick (mid-animation, frozen).
    @MainActor static var previewLook: (index: Int, look: CGFloat)?

    override func drawBackground(forGlyphRange glyphsToShow: NSRange, at origin: NSPoint) {
        super.drawBackground(forGlyphRange: glyphsToShow, at: origin)
        guard let storage = textStorage, let container = textContainers.first, storage.length > 0 else { return }
        let characters = characterRange(forGlyphRange: glyphsToShow, actualGlyphRange: nil)
        let width = container.size.width < 1e6 ? container.size.width : usedRect(for: container).width
        for key in [NSAttributedString.Key.memoBlockFill, .memoQuoteBar, .memoRule] {
            storage.enumerateAttribute(key, in: characters, options: []) { value, range, _ in
                guard let color = value as? NSColor else { return }
                color.setFill()
                let glyphs = glyphRange(forCharacterRange: range, actualCharacterRange: nil)
                enumerateLineFragments(forGlyphRange: glyphs) { rect, _, _, _, _ in
                    let line = rect.offsetBy(dx: origin.x, dy: origin.y)
                    switch key {
                    case .memoBlockFill: NSRect(x: line.minX, y: line.minY, width: width, height: line.height).fill()
                    case .memoQuoteBar: NSRect(x: line.minX, y: line.minY + 2, width: 2, height: line.height - 4).fill()
                    default: NSRect(x: line.minX, y: (line.midY - 0.5).rounded(), width: width, height: 1).fill()
                    }
                }
            }
        }
        // A list's hidden `- `: a • where its mark is.
        storage.enumerateAttribute(.memoBullet, in: characters, options: []) { value, range, _ in
            guard let color = value as? NSColor, let font = storage.attribute(.font, at: range.location, effectiveRange: nil) as? NSFont,
                  let container = textContainer(forGlyphAt: glyphIndexForCharacter(at: range.location), effectiveRange: nil) else { return }
            let glyph = glyphRange(forCharacterRange: NSRange(location: range.location, length: 1), actualCharacterRange: nil)
            let rect = boundingRect(forGlyphRange: glyph, in: container).offsetBy(dx: origin.x, dy: origin.y)
            let fragment = lineFragmentRect(forGlyphAt: glyph.location, effectiveRange: nil).offsetBy(dx: origin.x, dy: origin.y)
            let bullet = NSAttributedString(string: "•", attributes: [.font: font, .foregroundColor: color])
            let size = bullet.size()
            bullet.draw(at: NSPoint(x: rect.minX, y: fragment.midY - size.height / 2))
        }
        // A checklist's hidden `- [ ] ` (#133): the card's box where its mark is.
        let preview = MainActor.assumeIsolated { Self.previewLook }
        /// Which box of the text this is (snapshots only).
        func ordinal(_ at: Int) -> Int {
            var count = 0
            storage.enumerateAttribute(.memoCheckBox, in: NSRange(location: 0, length: at), options: []) { value, _, _ in if value != nil { count += 1 } }
            return count
        }
        storage.enumerateAttribute(.memoCheckBox, in: characters, options: []) { value, range, _ in
            guard let box = value as? MemoBox, let rect = boxRect(at: range.location, origin: origin) else { return }
            let frozen = preview.flatMap { $0.index == ordinal(range.location) ? $0.look : nil }
            box.draw(in: rect, look: frozen ?? boxLook?(range.location))
        }
    }

    /// Where the box of the checklist mark starting at `character` is drawn (#133), in the text container's
    /// coordinates moved by `origin`; nil when nothing is laid out there.
    func boxRect(at character: Int, origin: NSPoint = .zero) -> NSRect? {
        let glyph = glyphRange(forCharacterRange: NSRange(location: character, length: 1), actualCharacterRange: nil)
        guard glyph.length > 0, let container = textContainer(forGlyphAt: glyph.location, effectiveRange: nil) else { return nil }
        let rect = boundingRect(forGlyphRange: glyph, in: container)
        let fragment = lineFragmentRect(forGlyphAt: glyph.location, effectiveRange: nil)
        let size = MemoBox.size
        return NSRect(x: rect.minX + origin.x, y: (fragment.midY - size / 2).rounded() + origin.y, width: size, height: size)
    }
}

/// How a line of a memo is drawn: the face and size of the drawer's setting (MemoText), each line exactly its height
/// (a heading's taller), the marks faint.
@MainActor
struct MemoStyler {
    let text: MemoText
    let ink: NSColor
    /// A quote's words, one step lighter.
    let soft: NSColor
    /// A link's underline.
    let accent: NSColor
    /// A checklist's box (#133): its edge, its fill and checkmark when done, and a done item's words.
    var box: NSColor = .secondaryLabelColor
    var checkFill: NSColor = .systemGreen
    var checkMark: NSColor = .white
    var done: NSColor?
    var faint: NSColor { ink.withAlphaComponent(0.4) }
    var tint: NSColor { ink.withAlphaComponent(0.07) }

    static let headingScale: [CGFloat] = [1.45, 1.25, 1.1]
    /// A quote's words start this far in (its bar at the left).
    static let quoteIndent: CGFloat = 9
    /// A hidden mark's face: next to no width.
    static let hidden = NSFont.systemFont(ofSize: 0.01)

    /// A font on a line `height` tall, its glyphs centred in it (AppKit puts them at its foot).
    func ruled(_ font: NSFont, _ height: CGFloat, first: CGFloat = 0, head: CGFloat = 0, color: NSColor? = nil) -> [NSAttributedString.Key: Any] {
        let paragraph = NSMutableParagraphStyle()
        paragraph.minimumLineHeight = height
        paragraph.maximumLineHeight = height
        paragraph.firstLineHeadIndent = first
        paragraph.headIndent = head
        let offset = (height - (font.ascender - font.descender)) / 2
        return [.font: font, .foregroundColor: color ?? ink, .paragraphStyle: paragraph, .baselineOffset: offset]
    }

    var body: [NSAttributedString.Key: Any] { ruled(text.font(), text.line) }

    /// The words of `units[from..<to]` as wide as `font` draws them (a list item's hanging indent).
    private func width(_ units: [UInt16], _ to: Int, _ font: NSFont) -> CGFloat {
        let prefix = String(decoding: units[..<min(to, units.count)], as: UTF16.self).replacingOccurrences(of: "\t", with: "    ")
        return ceil((prefix as NSString).size(withAttributes: [.font: font]).width)
    }

    /// One line: `range` its characters without "\n", `whole` with it. `title`: the memo's first line's look (the
    /// handwriting wins; only its marks go faint). `fenceAfter`: a code block is open after it. `reveal`: the line the
    /// caret or the selection touches (or 기호 늘 보이기) — its marks shown faint; elsewhere they are hidden (#84,
    /// 2026-10-30): no width, a list's `- ` drawn as •, a number shown.
    func style(_ storage: NSTextStorage, units: [UInt16], read: MemoMarkdown.LineRead, range: NSRange, whole: NSRange,
               title: [NSAttributedString.Key: Any]?, fenceAfter: Bool, reveal: Bool = true, spaceAfter: Bool = false) {
        var attributes: [NSAttributedString.Key: Any]
        var lineFont = text.font()
        var height = text.line
        if let title {
            attributes = title
        } else {
            switch read.kind {
            case .heading:
                let scale = Self.headingScale[max(0, min(2, read.level - 1))]
                lineFont = bold(text.font(scale: scale))
                height = (text.line * scale).rounded()
                attributes = ruled(lineFont, height)
                if !hasBold(lineFont) { attributes[.strokeWidth] = -3.0 }
            case .code, .fence:
                lineFont = text.codeFont
                attributes = ruled(lineFont, height)
                attributes[.memoBlockFill] = tint
            case .list, .olist:
                attributes = ruled(lineFont, height, head: width(units, read.words, lineFont))
            case .quote:
                let head = Self.quoteIndent
                attributes = ruled(lineFont, height, first: head, head: head + width(units, reveal ? read.words : read.markFrom, lineFont), color: soft)
                attributes[.memoQuoteBar] = faint
            case .rule:
                attributes = ruled(lineFont, height)
                attributes[.memoRule] = faint
            case .check:
                // The words hang after the box (#133), or after the marks on the caret's line.
                attributes = ruled(lineFont, height, head: reveal ? width(units, read.words, lineFont) : width(units, read.markFrom, lineFont) + MemoBox.width)
            default:
                attributes = ruled(lineFont, height)
            }
        }
        if fenceAfter { attributes[.memoFence] = 1 }
        // 문단 간격 (#141): a paragraph's last line keeps the room after it (TextSteps.endsParagraph).
        if spaceAfter, let paragraph = (attributes[.paragraphStyle] as? NSParagraphStyle)?.mutableCopy() as? NSMutableParagraphStyle {
            paragraph.paragraphSpacing = text.paragraph
            attributes[.paragraphStyle] = paragraph
        }
        storage.setAttributes(attributes, range: whole)
        guard range.length > 0, read.kind != .code, read.kind != .blank else { return }
        if read.kind == .check { styleCheck(storage, read: read, range: range, reveal: reveal) }
        var spans: [MemoMarkdown.Span] = []
        MemoMarkdown.lineSpans(units, read, base: range.location, into: &spans)
        if title == nil, read.kind == .text, !spans.contains(where: { $0.kind == .code }),
           Checklist.isCode(String(decoding: units[..<read.end], as: UTF16.self)) {
            // The old code lines (four spaces in, `$ `, a command): fixed-width as before.
            storage.addAttributes(ruled(text.codeFont, height), range: range)
        }
        for (index, span) in spans.enumerated() {
            let at = span.range
            guard at.length > 0, NSMaxRange(at) <= NSMaxRange(range) else { continue }
            if span.kind == .mark {
                let blockMark = span.from == range.location + read.markFrom
                if reveal || (blockMark && read.kind == .olist) {
                    // Shown faint: the caret's lines (or 기호 늘 보이기), and a number always. The title's strokes (a
                    // hair heavier) go faint with it.
                    storage.addAttributes([.foregroundColor: faint, .strokeColor: faint], range: at)
                } else if blockMark, read.kind == .list {
                    // A list's `- `: kept as wide as it is, not drawn; MemoLayoutManager draws a • in its place.
                    storage.addAttributes([.foregroundColor: NSColor.clear, .strokeColor: NSColor.clear], range: at)
                    storage.addAttribute(.memoBullet, value: soft, range: NSRange(location: at.location, length: 1))
                } else {
                    // Hidden: no width at all.
                    storage.addAttributes([.font: Self.hidden, .foregroundColor: NSColor.clear, .strokeWidth: 0, .kern: 0], range: at)
                }
                continue
            }
            guard title == nil else { continue }
            switch span.kind {
            case .bold:
                storage.enumerateAttribute(.font, in: at) { value, part, _ in
                    guard let font = value as? NSFont else { return }
                    let heavier = bold(font)
                    if hasBold(heavier) { storage.addAttribute(.font, value: heavier, range: part) } else { storage.addAttribute(.strokeWidth, value: -3.0, range: part) }
                }
            case .italic:
                storage.addAttribute(.obliqueness, value: 0.18, range: at)
            case .strike:
                storage.addAttributes([.strikethroughStyle: NSUnderlineStyle.single.rawValue, .strikethroughColor: ink], range: at)
            case .code:
                let code = text.codeFont
                storage.addAttributes([.font: code, .backgroundColor: tint, .baselineOffset: (height - (code.ascender - code.descender)) / 2], range: at)
            case .link:
                let url = spans[index...].first { $0.kind == .linkurl }.map { String(decoding: units[($0.from - range.location + 1)..<($0.to - range.location - 1)], as: UTF16.self) }
                storage.addAttributes([.underlineStyle: NSUnderlineStyle.single.rawValue, .underlineColor: accent], range: at)
                if let url { storage.addAttribute(.memoLink, value: url, range: at) }
            case .url:
                let url = String(decoding: units[(span.from - range.location)..<(span.to - range.location)], as: UTF16.self)
                storage.addAttributes([.underlineStyle: NSUnderlineStyle.single.rawValue, .underlineColor: accent, .memoLink: url], range: at)
            default:
                break
            }
        }
    }

    /// A checklist line (#133): `- [ ] ` faint on the caret's line, elsewhere drawn as the card's box (its first
    /// character as wide as the box and its gap, the rest no width); a done item's words faint and struck through.
    private func styleCheck(_ storage: NSTextStorage, read: MemoMarkdown.LineRead, range: NSRange, reveal: Bool) {
        let mark = NSRange(location: range.location + read.markFrom, length: read.words - read.markFrom)
        guard mark.length > 0, NSMaxRange(mark) <= NSMaxRange(range) else { return }
        let checked = read.checked == true
        if checked, read.words < range.length {
            let words = NSRange(location: range.location + read.words, length: range.length - read.words)
            let color = done ?? faint
            storage.addAttributes([.foregroundColor: color, .strokeColor: color, .strikethroughStyle: NSUnderlineStyle.single.rawValue,
                                   .strikethroughColor: color], range: words)
        }
        if reveal {
            storage.addAttributes([.foregroundColor: faint, .strokeColor: faint], range: mark)
            return
        }
        let first = NSRange(location: mark.location, length: 1)
        let font = storage.attribute(.font, at: mark.location, effectiveRange: nil) as? NSFont ?? text.font()
        let advance = (storage.string as NSString).substring(with: first).size(withAttributes: [.font: font]).width
        storage.addAttributes([.foregroundColor: NSColor.clear, .strokeColor: NSColor.clear, .kern: MemoBox.width - advance,
                               .memoCheckBox: MemoBox(checked: checked, edge: box, fill: checkFill, mark: checkMark)], range: first)
        if mark.length > 1 {
            storage.addAttributes([.font: Self.hidden, .foregroundColor: NSColor.clear, .strokeWidth: 0, .kern: 0],
                                  range: NSRange(location: mark.location + 1, length: mark.length - 1))
        }
    }

    private func bold(_ font: NSFont) -> NSFont { NSFontManager.shared.convert(font, toHaveTrait: .boldFontMask) }
    private func hasBold(_ font: NSFont) -> Bool { font.fontDescriptor.symbolicTraits.contains(.bold) }

    /// A line for SwiftUI (an open memo with checklist boxes, CheckedText): its words with the marks faint, bold,
    /// italic, struck, code and links; the line's own look (heading, code, quote …) is the view's.
    /// `hide`: the marks left out (an open memo reads without them, #84 2026-10-30), a number kept.
    func swiftUI(_ units: [UInt16], _ read: MemoMarkdown.LineRead, base: Font, scale: CGFloat = 1, hide: Bool = false) -> AttributedString {
        let words = String(decoding: units[..<read.end], as: UTF16.self)
        var out = AttributedString(words)
        guard read.kind != .code, read.kind != .fence, read.kind != .blank else { return out }
        var spans: [MemoMarkdown.Span] = []
        MemoMarkdown.lineSpans(units, read, base: 0, into: &spans)
        let ns = words as NSString
        func range(_ span: MemoMarkdown.Span) -> Range<AttributedString.Index>? {
            guard span.to <= ns.length, let found = Range(NSRange(location: span.from, length: span.to - span.from), in: words) else { return nil }
            return Range(found, in: out)
        }
        let plain = text.font(scale: scale)
        for span in spans {
            guard let at = range(span), !at.isEmpty else { continue }
            switch span.kind {
            case .mark: out[at].foregroundColor = Color(nsColor: faint)
            case .bold: out[at].font = Font(bold(plain))
            case .italic: out[at].font = (out[at].font ?? base).italic()
            case .strike: out[at].strikethroughStyle = .single
            case .code:
                out[at].font = Font(text.codeFont)
                out[at].backgroundColor = Color(nsColor: tint)
            case .link, .url: out[at].underlineStyle = .single
            default: break
            }
        }
        guard hide else { return out }
        // Last first, so the earlier places stay right.
        for span in spans.reversed() where span.kind == .mark && !(read.kind == .olist && span.from == read.markFrom) {
            guard span.to <= ns.length, let found = Range(NSRange(location: span.from, length: span.to - span.from), in: words) else { continue }
            let offset = words.distance(from: words.startIndex, to: found.lowerBound), length = words.distance(from: found.lowerBound, to: found.upperBound)
            let start = out.characters.index(out.startIndex, offsetBy: offset)
            out.removeSubrange(start..<out.characters.index(start, offsetBy: length))
        }
        return out
    }
}
