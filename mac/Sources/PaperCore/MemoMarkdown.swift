import Foundation

/// 메모 마크다운 (#84, docs/plans/memo-markdown.md): a memo's words stay as written (memos.json keeps the marks); this
/// reads where they are — the spans the editor and the open memo draw (bold, a heading, a list …; `mark` = a mark drawn
/// faint at 40 % of the ink) and the words without the marks (the card's title and preview, search, a memo's kind).
/// Positions are UTF-16 offsets, `to` not included. The same rules and the same cases as the Windows app
/// (memoMarkdown.ts; docs/plans/memo-markdown-cases.json).
///
/// Lines: `# ` · `## ` · `### ` headings, `- ` · `* ` · `+ ` lists (two spaces or a tab a step in, three at most),
/// `1. ` · `1) ` numbered, `> ` quotes, a line of ``` opening or closing a code block (unclosed: to the memo's end), a
/// line that is only `---` or `***` a rule; a checklist line (`- [ ] `) stays the checklist it was. In a line: `**` ·
/// `__` bold, `*` · `_` italic (`_` not inside a word), `~~` struck, `` ` `` code, `[words](url)`; marks that don't pair
/// stay words. Inside code nothing else; inside bold or italic only code; a link's words as they are.
public enum MemoMarkdown {
    public enum Kind: String, Sendable, Comparable {
        case mark, bold, italic, strike, code, codeblock, heading, list, olist, quote, rule, link, linkurl, url
        public static func < (a: Kind, b: Kind) -> Bool { a.rawValue < b.rawValue }
    }

    public struct Span: Equatable, Sendable {
        public var kind: Kind
        public var from: Int
        public var to: Int
        /// Heading 1–3, list and numbered list 1–3.
        public var level: Int?
        public init(_ kind: Kind, _ from: Int, _ to: Int, level: Int? = nil) {
            self.kind = kind
            self.from = from
            self.to = to
            self.level = level
        }
        public var range: NSRange { NSRange(location: from, length: to - from) }
    }

    public enum LineKind: String, Sendable { case blank, text, heading, list, olist, quote, rule, fence, code, check }

    /// A line as the blocks read it (no marks inside it yet).
    public struct LineRead: Equatable, Sendable {
        public var kind: LineKind
        /// Heading 1–3, list and numbered list 1–3; else 0.
        public var level = 0
        /// Where the line ends without a "\r".
        public var end: Int
        /// Where the block's mark starts (after the indent) and where the words start (after the mark).
        public var markFrom = 0
        public var words = 0
        /// A numbered line's number and its `.` / `)`.
        public var marker = ""
        /// A checklist line: ticked.
        public var checked: Bool?
    }

    typealias Units = [UInt16]
    private static let tab: UInt16 = 0x09, blank: UInt16 = 0x20, backtick: UInt16 = 0x60, star: UInt16 = 0x2A, under: UInt16 = 0x5F, tilde: UInt16 = 0x7E
    private static let hash: UInt16 = 0x23, dash: UInt16 = 0x2D, plus: UInt16 = 0x2B, quoteMark: UInt16 = 0x3E, open: UInt16 = 0x5B, close: UInt16 = 0x5D
    private static let paren: UInt16 = 0x28, shut: UInt16 = 0x29, dot: UInt16 = 0x2E, ret: UInt16 = 0x0D

    static func space(_ unit: UInt16) -> Bool { unit == 0x20 || unit == 0x09 || unit == 0x0D || unit == 0x0A || unit == 0xA0 || unit == 0x3000 }
    private static let alphanumerics = CharacterSet.alphanumerics
    private static func wordChar(_ text: Units, _ at: Int) -> Bool {
        guard at >= 0, at < text.count, let scalar = Unicode.Scalar(text[at]) else { return false }
        return alphanumerics.contains(scalar)
    }

    /// A line that opens or closes a code block: up to three spaces, then ```.
    public static func isFence(_ line: some Collection<UInt16>) -> Bool {
        var count = 0, ticks = 0
        for unit in line {
            if ticks == 0, unit == blank, count < 3 { count += 1; continue }
            guard unit == backtick else { return false }
            ticks += 1
            if ticks == 3 { return true }
        }
        return false
    }

    /// What block a line is (inside a code block: `code`, or the `fence` that closes it).
    public static func readLine(_ line: [UInt16], inBlock: Bool) -> LineRead {
        let end = line.last == ret ? line.count - 1 : line.count
        func read(_ kind: LineKind, level: Int = 0, markFrom: Int = 0, words: Int = 0, marker: String = "") -> LineRead {
            LineRead(kind: kind, level: level, end: end, markFrom: markFrom, words: words, marker: marker)
        }
        if isFence(line[..<end]) { return read(.fence, markFrom: line.firstIndex(of: backtick) ?? 0, words: end) }
        if inBlock { return read(.code) }
        guard line[..<end].contains(where: { !space($0) }) else { return read(.blank) }
        var indent = 0
        while indent < end, line[indent] == blank || line[indent] == tab { indent += 1 }
        let first = line[indent]
        func at(_ index: Int) -> UInt16? { index < end ? line[index] : nil }
        // A rule: only `---` or `***` (three or more), spaces round them.
        if first == dash || first == star {
            var next = indent
            while next < end, line[next] == first { next += 1 }
            var after = next
            while after < end, line[after] == blank || line[after] == tab { after += 1 }
            if next - indent >= 3, after == end { return read(.rule, markFrom: indent, words: end) }
        }
        // A checklist line: `- [ ] ` / `* [x] `.
        if first == dash || first == star, at(indent + 1) == blank, at(indent + 2) == open,
           let mark = at(indent + 3), mark == blank || mark == 0x78 || mark == 0x58, at(indent + 4) == close, at(indent + 5) == blank {
            var made = read(.check, markFrom: indent, words: indent + 6)
            made.checked = mark != blank
            return made
        }
        if indent == 0, first == hash {
            var hashes = 0
            while hashes < end, line[hashes] == hash { hashes += 1 }
            if hashes <= 3, at(hashes) == blank {
                var words = hashes
                while words < end, line[words] == blank { words += 1 }
                return read(.heading, level: hashes, words: words)
            }
        }
        var level: Int {
            var width = 0
            for index in 0..<indent { width += line[index] == tab ? 2 : 1 }
            return min(3, 1 + width / 2)
        }
        if first == dash || first == star || first == plus, at(indent + 1) == blank {
            var words = indent + 1
            while words < end, line[words] == blank { words += 1 }
            return read(.list, level: level, markFrom: indent, words: words)
        }
        if (0x30...0x39).contains(first) {
            var next = indent
            while next < end, (0x30...0x39).contains(line[next]) { next += 1 }
            if next - indent <= 9, let mark = at(next), mark == dot || mark == shut, at(next + 1) == blank {
                var words = next + 1
                while words < end, line[words] == blank { words += 1 }
                return read(.olist, level: level, markFrom: indent, words: words, marker: String(decoding: line[indent...next], as: UTF16.self))
            }
        }
        if first == quoteMark {
            return read(.quote, markFrom: indent, words: at(indent + 1) == blank ? indent + 2 : indent + 1)
        }
        return read(.text)
    }

    private static func run(_ text: Units, _ at: Int, _ end: Int) -> Int {
        var next = at
        while next < end, text[next] == text[at] { next += 1 }
        return next - at
    }

    /// Where a code span that opens at `at` (a run of backticks) closes: its closing run's start, or nil.
    private static func codeClose(_ text: Units, _ at: Int, _ length: Int, _ end: Int) -> Int? {
        var next = at + length
        while next < end {
            guard text[next] == backtick else { next += 1; continue }
            let found = run(text, next, end)
            if found == length { return next > at + length ? next : nil }
            next += found
        }
        return nil
    }

    private static let http = Array("http://".utf16), https = Array("https://".utf16)

    /// What ends a sentence after an address, not the address (the cards' link chip leaves it out too).
    private static let trailingMarks: Set<UInt16> = Set(".,;:!?)]}>'\"’”".utf16)

    /// A bare `http(s)://` address at `at` (not in a word): its end.
    private static func urlEnd(_ text: Units, _ at: Int, _ end: Int) -> Int? {
        if wordChar(text, at - 1) { return nil }
        func starts(_ prefix: Units) -> Bool {
            guard at + prefix.count <= end else { return false }
            for (offset, unit) in prefix.enumerated() {
                var here = text[at + offset]
                if (0x41...0x5A).contains(here) { here += 0x20 }
                if here != unit { return false }
            }
            return true
        }
        guard let head = starts(https) ? https.count : starts(http) ? http.count : nil else { return nil }
        var next = at + head
        guard next < end, !space(text[next]) else { return nil }
        while next < end, !space(text[next]) { next += 1 }
        return next
    }

    /// Only the code spans in [from, to) (inside bold and italic).
    private static func codeSpans(_ text: Units, _ from: Int, _ to: Int, _ base: Int, _ out: inout [Span]) {
        var at = from
        while at < to {
            guard text[at] == backtick else { at += 1; continue }
            let length = run(text, at, to)
            guard let close = codeClose(text, at, length, to) else { at += length; continue }
            out += [Span(.mark, base + at, base + at + length), Span(.code, base + at + length, base + close), Span(.mark, base + close, base + close + length)]
            at = close + length
        }
    }

    /// The marks in a line's words [from, to): spans at `base` + their place in `text`.
    static func inlineSpans(_ text: Units, from: Int, to: Int, base: Int, into out: inout [Span]) {
        var at = from
        while at < to {
            let char = text[at]
            if char == backtick {
                let length = run(text, at, to)
                if let close = codeClose(text, at, length, to) {
                    out += [Span(.mark, base + at, base + at + length), Span(.code, base + at + length, base + close), Span(.mark, base + close, base + close + length)]
                    at = close + length
                } else {
                    at += length
                }
                continue
            }
            if char == 0x68 || char == 0x48, let url = urlEnd(text, at, to) {
                // A bare address: underlined (⌘-click opens it), nothing inside it read as marks; trailing punctuation left out.
                var stop = url
                while stop > at, trailingMarks.contains(text[stop - 1]) { stop -= 1 }
                out.append(Span(.url, base + at, base + stop))
                at = url
                continue
            }
            if char == open, let link = linkAt(text, at, to) {
                out += [Span(.mark, base + at, base + at + 1), Span(.link, base + at + 1, base + link.close), Span(.mark, base + link.close, base + link.close + 1),
                        Span(.linkurl, base + link.close + 1, base + link.end), Span(.mark, base + link.close + 1, base + link.end)]
                at = link.end
                continue
            }
            if char == star || char == under || char == tilde {
                let length = run(text, at, to)
                guard let close = emphasisClose(text, at, length, to) else { at += length; continue }
                let inside = (base + at + length, base + close)
                out.append(Span(.mark, base + at, base + at + length))
                if char == tilde {
                    out.append(Span(.strike, inside.0, inside.1))
                } else {
                    if length >= 2 { out.append(Span(.bold, inside.0, inside.1)) }
                    if length != 2 { out.append(Span(.italic, inside.0, inside.1)) }
                    codeSpans(text, at + length, close, base, &out)
                }
                out.append(Span(.mark, base + close, base + close + length))
                at = close + length
                continue
            }
            at += 1
        }
    }

    /// `[words](url)` at `at`: the `]` and the end after `)`.
    private static func linkAt(_ text: Units, _ at: Int, _ end: Int) -> (close: Int, end: Int)? {
        guard let close = text[(at + 1)..<end].firstIndex(of: Self.close), close > at + 1, close + 1 < end, text[close + 1] == paren,
              !text[(at + 1)..<close].contains(open),
              let shut = text[(close + 2)..<end].firstIndex(of: Self.shut), shut > close + 2,
              !text[(close + 2)..<shut].contains(where: space) else { return nil }
        return (close, shut + 1)
    }

    /// Where the emphasis opened by the run of `length` marks at `at` closes (nil: it stays words): a run of exactly as
    /// many of the same mark, the words between not starting or ending with a space; `_` neither opens nor closes inside
    /// a word; `~` only in twos; bold and italic step over their code.
    private static func emphasisClose(_ text: Units, _ at: Int, _ length: Int, _ end: Int) -> Int? {
        let char = text[at]
        if length > 3 || (char == tilde && length != 2) { return nil }
        let first = at + length
        if first >= end || space(text[first]) { return nil }
        if char == under, wordChar(text, at - 1) { return nil }
        var next = first
        while next < end {
            let here = text[next]
            if here == backtick, char != tilde {
                let found = run(text, next, end)
                next = codeClose(text, next, found, end).map { $0 + found } ?? next + found
                continue
            }
            guard here == char else { next += 1; continue }
            let found = run(text, next, end)
            if found == length, next > first, !space(text[next - 1]), !(char == under && wordChar(text, next + found)) { return next }
            next += found
        }
        return nil
    }

    /// One line's spans at `base` (its block and its marks; not the code block round it).
    public static func lineSpans(_ line: [UInt16], _ read: LineRead, base: Int, into out: inout [Span]) {
        let end = read.end
        switch read.kind {
        case .heading:
            out += [Span(.heading, base, base + end, level: read.level), Span(.mark, base, base + read.words)]
        case .list, .olist:
            out += [Span(read.kind == .list ? .list : .olist, base, base + end, level: read.level), Span(.mark, base + read.markFrom, base + read.words)]
        case .quote:
            out += [Span(.quote, base, base + end), Span(.mark, base + read.markFrom, base + read.words)]
        case .rule:
            var stop = end
            while stop > read.markFrom, space(line[stop - 1]) { stop -= 1 }
            out += [Span(.mark, base + read.markFrom, base + stop), Span(.rule, base + read.markFrom, base + stop)]
            return
        case .fence:
            out.append(Span(.mark, base + read.markFrom, base + end))
            return
        case .code, .blank:
            return
        case .text, .check:
            break
        }
        inlineSpans(line, from: read.words, to: end, base: base, into: &out)
    }

    static func ordered(_ a: Span, _ b: Span) -> Bool {
        if a.from != b.from { return a.from < b.from }
        if a.to != b.to { return a.to > b.to }
        return a.kind < b.kind
    }

    /// A line of a text: its UTF-16 units (no "\n"), where it starts, and how its block reads.
    public struct Line: Sendable {
        public var units: [UInt16]
        public var from: Int
        public var read: LineRead
    }

    /// Every line of a text, read in order (the code blocks carried along); `stop` ends the reading early.
    public static func forEachLine(_ text: String, _ body: (Line) -> Bool) {
        let all = Array(text.utf16)
        var inBlock = false, from = 0
        while from <= all.count {
            let stop = all[from...].firstIndex(of: 0x0A) ?? all.count
            let units = Array(all[from..<stop])
            let read = readLine(units, inBlock: inBlock)
            if read.kind == .fence { inBlock.toggle() }
            if !body(Line(units: units, from: from, read: read)) { return }
            from = stop + 1
        }
    }

    public static func lines(_ text: String) -> [Line] {
        var out: [Line] = []
        forEachLine(text) { out.append($0); return true }
        return out
    }

    /// Every span of a memo, in order: by start, the longer first, then by kind's name.
    public static func spans(_ text: String) -> [Span] {
        var out: [Span] = []
        var opened: Int?, last = 0
        forEachLine(text) { line in
            lineSpans(line.units, line.read, base: line.from, into: &out)
            if line.read.kind == .fence {
                if let start = opened { out.append(Span(.codeblock, start, line.from + line.read.end)); opened = nil } else { opened = line.from }
            }
            last = line.from + line.units.count
            return true
        }
        if let start = opened { out.append(Span(.codeblock, start, last)) }
        return out.sorted(by: ordered)
    }

    /// A line's words without its marks (a checklist line keeps its box; a rule or a fence has none).
    public static func linePlain(_ line: [UInt16], _ read: LineRead) -> String? {
        switch read.kind {
        case .rule, .fence: return nil
        case .code, .blank: return String(decoding: line[..<read.end], as: UTF16.self)
        default: break
        }
        var spans: [Span] = []
        inlineSpans(line, from: read.words, to: read.end, base: 0, into: &spans)
        let start = read.kind == .check || read.kind == .text ? 0 : read.words
        if spans.isEmpty { return String(decoding: line[start..<read.end], as: UTF16.self) }
        var plain: [UInt16] = []
        var at = start
        for span in spans.filter({ $0.kind == .mark }).sorted(by: ordered) {
            if span.from > at { plain += line[at..<span.from] }
            at = max(at, span.to)
        }
        if at < read.end { plain += line[at..<read.end] }
        return String(decoding: plain, as: UTF16.self)
    }

    /// Anything a mark could start with; a text without any is its own words.
    private static let markdownish = try! NSRegularExpression(pattern: "[*_~`\\[#>\\r]|^[ \\t]*(?:[-+] |\\d{1,9}[.)] |---)", options: [.anchorsMatchLines])

    /// The memo's words without marks, line by line (rules and code fences left out): what search and the cards read.
    public static func plain(_ text: String) -> String {
        // Most memos have no mark at all: their words are the text (a search's first pass reads every memo).
        guard markdownish.firstMatch(in: text, range: NSRange(location: 0, length: (text as NSString).length)) != nil else { return text }
        var lines: [String] = []
        forEachLine(text) { line in
            if let plain = linePlain(line.units, line.read) { lines.append(plain) }
            return true
        }
        return lines.joined(separator: "\n")
    }

    private static let trim = CharacterSet.whitespacesAndNewlines

    /// A checklist line's words (after its box), without marks.
    private static func itemWords(_ line: Line) -> String {
        let plain = Array((linePlain(line.units, line.read) ?? "").utf16)
        return String(decoding: plain.dropFirst(line.read.words), as: UTF16.self).trimmingCharacters(in: trim)
    }

    /// The memo's title: its first line with words, without marks (a checklist line's item words); an empty memo's words.
    public static func title(_ text: String, language: AppLanguage = .ko) -> String {
        var found: String?
        forEachLine(text) { line in
            switch line.read.kind {
            case .blank, .rule, .fence: return true
            case .check: found = itemWords(line)
            default: found = (linePlain(line.units, line.read) ?? "").trimmingCharacters(in: trim)
            }
            if found?.isEmpty == true { found = nil }
            return found == nil
        }
        return found ?? ["빈 메모", "Empty note", "Lege notitie"][language.index]
    }

    /// A row of a card's preview: a line's words, or a checklist item (`checked` set); `code` a code block's line.
    public struct Row: Equatable, Sendable {
        public var checked: Bool?
        public var text: String
        public var code = false
        public init(checked: Bool? = nil, text: String, code: Bool = false) { self.checked = checked; self.text = text; self.code = code }
    }

    /// What a card shows under its title (D30, #14, #84): a checklist memo its first `limit` items; any other memo its
    /// first `limit` lines with words after the title, without marks — a list item `• `, a numbered one its number, a
    /// quote its words, a code block its first line (fixed-width); rules and fences none. Each row cut at 300 characters.
    /// `withItems` false: the lines only (a checklist's items skipped; the one preview line under a title found in search).
    public static func rows(_ text: String, limit: Int = 3, withItems: Bool = true) -> [Row] {
        guard limit > 0 else { return [] }
        var items: [Row] = [], rows: [Row] = []
        var titled = false, blockShown = false
        func cut(_ words: String) -> String { words.count > 300 ? String(words.prefix(300)) : words }
        forEachLine(text) { line in
            let read = line.read
            switch read.kind {
            case .blank, .rule: return true
            case .fence: blockShown = false; return true
            case .check:
                let words = itemWords(line)
                guard !words.isEmpty else { return true }
                if !titled { titled = true; return true }
                guard withItems else { return true }
                items.append(Row(checked: read.checked == true, text: cut(words)))
                return items.count < limit
            default: break
            }
            if titled, rows.count >= limit { return withItems }
            if read.kind == .code, titled, blockShown { return true }
            let words = (linePlain(line.units, read) ?? "").trimmingCharacters(in: trim)
            guard !words.isEmpty else { return true }
            if !titled {
                titled = true
                if read.kind == .code { blockShown = true }
                return true
            }
            if read.kind == .code {
                blockShown = true
                rows.append(Row(text: cut(words), code: true))
                return true
            }
            let head = read.kind == .list ? "• " : read.kind == .olist ? read.marker + " " : ""
            rows.append(Row(text: cut(head + words)))
            return true
        }
        return items.isEmpty ? rows : items
    }

    /// The memo's `[words](url)` links in order (not in code): their words and URLs.
    public static func links(_ text: String) -> [(label: String, url: String)] {
        guard text.contains("](") else { return [] }
        var found: [(label: String, url: String)] = []
        forEachLine(text) { line in
            switch line.read.kind {
            case .code, .fence, .rule, .blank: return true
            default: break
            }
            var spans: [Span] = []
            inlineSpans(line.units, from: line.read.words, to: line.read.end, base: 0, into: &spans)
            for span in spans {
                if span.kind == .link { found.append((String(decoding: line.units[span.from..<span.to], as: UTF16.self), "")) }
                if span.kind == .linkurl, !found.isEmpty { found[found.count - 1].url = String(decoding: line.units[(span.from + 1)..<(span.to - 1)], as: UTF16.self) }
            }
            return true
        }
        return found
    }
}
