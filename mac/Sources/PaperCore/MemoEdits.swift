import Foundation

/// 메모 서식 (#84, docs/plans/memo-markdown.md ‘사이드노트에서 가져온 것’): what a formatting key, the Aa bar, a paste or a
/// ticked box does to a memo's words — pure text in, text out, with the selection (UTF-16 offsets, `from` ≤ `to`). The
/// editor only applies the result (one change, so one undo). The same rules and the same cases as the Windows app
/// (memoEdits.ts; the `edits` and `done` of docs/plans/memo-markdown-cases.json). nil: nothing to do here (the editor
/// does its own thing — a plain new line, a plain paste).
public enum MemoEdits {
    public struct Edit: Equatable, Sendable {
        public var text: String
        public var from: Int
        public var to: Int
        public init(text: String, from: Int, to: Int) { self.text = text; self.from = from; self.to = to }
    }

    public enum LineKind: String, Sendable { case list, olist, check, quote }

    private struct Line { var start: Int; var end: Int; var text: String }

    private static func lineAt(_ text: NSString, _ at: Int) -> Line {
        let before = at > 0 ? text.range(of: "\n", options: .backwards, range: NSRange(location: 0, length: at)).location : NSNotFound
        let start = before == NSNotFound ? 0 : before + 1
        let after = at < text.length ? text.range(of: "\n", options: [], range: NSRange(location: at, length: text.length - at)).location : NSNotFound
        let end = after == NSNotFound ? text.length : after
        return Line(start: start, end: end, text: text.substring(with: NSRange(location: start, length: end - start)))
    }

    /// The lines `from`–`to` touch (a selection ending at a line's very start leaves that line out).
    private static func linesOf(_ text: NSString, _ from: Int, _ to: Int) -> [Line] {
        var out = [lineAt(text, from)]
        let stop = to > from && text.character(at: to - 1) == 0x0A ? to - 1 : to
        while out[out.count - 1].end < stop { out.append(lineAt(text, out[out.count - 1].end + 1)) }
        return out
    }

    /// Whether a ``` block is open where the line starting at `start` starts.
    private static func inBlock(_ text: NSString, _ start: Int) -> Bool {
        var open = false, at = 0
        while at < start {
            let found = text.range(of: "\n", options: [], range: NSRange(location: at, length: text.length - at)).location
            let end = min(found == NSNotFound ? text.length : found, start)
            if MemoMarkdown.isFence(Array(text.substring(with: NSRange(location: at, length: end - at)).utf16)) { open.toggle() }
            at = end + 1
        }
        return open
    }

    private static func read(_ text: NSString, _ line: Line) -> MemoMarkdown.LineRead {
        MemoMarkdown.readLine(Array(line.text.utf16), inBlock: inBlock(text, line.start))
    }

    private static func slice(_ text: String, _ from: Int, _ to: Int? = nil) -> String {
        let units = text as NSString
        let end = min(to ?? units.length, units.length)
        return from >= end ? "" : units.substring(with: NSRange(location: from, length: end - from))
    }

    /// Lines replaced one by one (`change` gives each line's new words and how far its words moved); the selection follows.
    private static func eachLine(_ text: String, _ from: Int, _ to: Int,
                                 _ change: (Line, MemoMarkdown.LineRead) -> (text: String, words: Int, newWords: Int)) -> Edit {
        let ns = text as NSString
        let lines = linesOf(ns, from, to)
        var out = slice(text, 0, lines[0].start)
        var newFrom = from, newTo = to, shift = 0
        for (index, line) in lines.enumerated() {
            let changed = change(line, read(ns, line))
            // A place at the line's start stays there (a whole line chosen); elsewhere it keeps to the words.
            func place(_ at: Int) -> Int {
                line.start + shift + (at == line.start ? 0 : max(changed.newWords, at - line.start - changed.words + changed.newWords))
            }
            if from >= line.start, from <= line.end { newFrom = place(from) }
            if to >= line.start, to <= line.end { newTo = place(to) }
            out += changed.text + (index < lines.count - 1 ? "\n" : "")
            shift += (changed.text as NSString).length - (line.text as NSString).length
        }
        out += slice(text, lines[lines.count - 1].end)
        return Edit(text: out, from: min(newFrom, newTo), to: max(newFrom, newTo))
    }

    /// The line's block mark and the indent before it (a list's `- `, a number, a box, a quote's `> `).
    private static func blockMark(_ line: String, _ kind: MemoMarkdown.LineRead) -> (indent: String, mark: String, words: Int) {
        switch kind.kind {
        case .list, .olist, .check, .quote:
            return (slice(line, 0, kind.markFrom), slice(line, kind.markFrom, kind.words), kind.words)
        default:
            return ("", "", 0)
        }
    }

    // MARK: ↩

    /// ↩ on a list, checklist, numbered or quote line: the next line starts with the same mark (a number one more, a box
    /// empty), the words after the caret going with it. On an item with no words the mark goes instead (the list ends).
    public static func enter(_ text: String, from: Int, to: Int) -> Edit? {
        guard from == to else { return nil }
        let ns = text as NSString
        let line = lineAt(ns, from)
        let kind = read(ns, line)
        guard [.list, .olist, .check, .quote].contains(kind.kind), from - line.start >= kind.words else { return nil }
        if slice(line.text, kind.words).trimmingCharacters(in: .whitespaces).isEmpty {
            return Edit(text: slice(text, 0, line.start) + slice(text, line.end), from: line.start, to: line.start)
        }
        let (indent, mark, _) = blockMark(line.text, kind)
        var next = mark
        if kind.kind == .olist, let number = Int(kind.marker.dropLast()) { next = "\(number + 1)\(kind.marker.suffix(1)) " }
        if kind.kind == .check { next = "\(mark.prefix(1)) [ ] " }
        let insert = "\n" + indent + next
        let length = (insert as NSString).length
        return Edit(text: slice(text, 0, from) + insert + slice(text, from), from: from + length, to: from + length)
    }

    // MARK: Lines

    /// ⌃⌘1–3 · ⌃⌘0 (`level`), or the Aa bar's 제목 (`nil`: none → # → ## → ### → none) on each line touched.
    public static func heading(_ text: String, from: Int, to: Int, level: Int?) -> Edit {
        let ns = text as NSString
        let first = read(ns, linesOf(ns, from, to)[0])
        let target = level ?? (first.kind == .heading ? (first.level + 1) % 4 : 1)
        return eachLine(text, from, to) { line, kind in
            let words = kind.kind == .heading ? kind.words : 0
            let mark = target > 0 ? String(repeating: "#", count: target) + " " : ""
            return (mark + slice(line.text, words), words, (mark as NSString).length)
        }
    }

    /// 목록 · 번호 · 체크(⇧⌘L) · 인용 on each line touched: on when any line isn't that already (another list's mark is
    /// swapped, the indent kept; numbers count from 1), off when all of them are. Blank lines in a selection stay blank.
    public static func toggleLines(_ text: String, from: Int, to: Int, kind want: LineKind) -> Edit {
        let ns = text as NSString
        let lines = linesOf(ns, from, to)
        let filled = lines.filter { !$0.text.trimmingCharacters(in: .whitespaces).isEmpty }
        let wanted: MemoMarkdown.LineKind = switch want {
        case .list: .list
        case .olist: .olist
        case .check: .check
        case .quote: .quote
        }
        let all = !filled.isEmpty && filled.allSatisfy { read(ns, $0).kind == wanted }
        var number = 0
        return eachLine(text, from, to) { line, kind in
            let (indent, mark, words) = blockMark(line.text, kind)
            if line.text.trimmingCharacters(in: .whitespaces).isEmpty, lines.count > 1 { return (line.text, 0, 0) }
            let rest = slice(line.text, words)
            let lead = mark.isEmpty ? "" : indent
            var next = ""
            if !all {
                number += 1
                next = switch want {
                case .list: "- "
                case .olist: "\(number). "
                case .check: "- [ ] "
                case .quote: "> "
                }
            }
            return (lead + next + rest, words, (lead as NSString).length + (next as NSString).length)
        }
    }

    /// 가로줄: a `---` line under the caret's line (on an empty line, that line), the caret on the line after it.
    public static func rule(_ text: String, from: Int, to: Int) -> Edit {
        let line = lineAt(text as NSString, to)
        if line.text.trimmingCharacters(in: .whitespaces).isEmpty {
            let insert = "---\n"
            return Edit(text: slice(text, 0, line.start) + insert + slice(text, line.end), from: line.start + 4, to: line.start + 4)
        }
        let insert = "\n---\n"
        return Edit(text: slice(text, 0, line.end) + insert + slice(text, line.end), from: line.end + 5, to: line.end + 5)
    }

    /// Tab · ⇧Tab: a list, numbered or checklist line a step in (three at most) or out; elsewhere Tab puts two spaces.
    public static func indent(_ text: String, from: Int, to: Int, out: Bool) -> Edit? {
        let ns = text as NSString
        let listy = linesOf(ns, from, to).allSatisfy { [.list, .olist, .check].contains(read(ns, $0).kind) }
        guard listy else {
            guard !out, from == to else { return nil }
            return Edit(text: slice(text, 0, from) + "  " + slice(text, from), from: from + 2, to: from + 2)
        }
        return eachLine(text, from, to) { line, kind in
            if !out {
                let level = kind.kind == .check ? min(3, 1 + kind.markFrom / 2) : kind.level
                if level >= 3 { return (line.text, 0, 0) }
                return ("  " + line.text, 0, 2)
            }
            let lead = line.text.hasPrefix("\t") ? 1 : line.text.hasPrefix("  ") ? 2 : line.text.hasPrefix(" ") ? 1 : 0
            return (slice(line.text, lead), lead, 0)
        }
    }

    /// ⌥↑ · ⌥↓: the lines touched trade places with the line above or below; the selection goes with them.
    public static func moveLines(_ text: String, from: Int, to: Int, up: Bool) -> Edit? {
        let ns = text as NSString
        let lines = linesOf(ns, from, to)
        let first = lines[0], last = lines[lines.count - 1]
        if up ? first.start == 0 : last.end >= ns.length { return nil }
        let block = slice(text, first.start, last.end)
        if up {
            let above = lineAt(ns, first.start - 1)
            let by = (above.text as NSString).length + 1
            return Edit(text: slice(text, 0, above.start) + block + "\n" + above.text + slice(text, last.end), from: from - by, to: to - by)
        }
        let below = lineAt(ns, last.end + 1)
        let by = (below.text as NSString).length + 1
        return Edit(text: slice(text, 0, first.start) + below.text + "\n" + block + slice(text, below.end), from: from + by, to: to + by)
    }

    // MARK: In a line

    /// ⌘B `**` · ⌘I `*` · ⇧⌘X `~~` · code `` ` ``: the selection wrapped in the mark, or let out of it when it already is
    /// (the marks just outside it, or at its own ends); with no selection a pair with the caret between (a pair with
    /// nothing in it goes again).
    public static func wrap(_ text: String, from: Int, to: Int, mark: String) -> Edit {
        let ns = text as NSString
        let size = (mark as NSString).length
        let single = mark == "*" || mark == "_"
        let first = (mark as NSString).character(at: 0)
        func unit(_ at: Int) -> UInt16? { at >= 0 && at < ns.length ? ns.character(at: at) : nil }
        // `*` is italic only where it isn't half of `**`.
        func isMark(_ at: Int) -> Bool {
            guard at >= 0, at + size <= ns.length, ns.substring(with: NSRange(location: at, length: size)) == mark else { return false }
            return !single || (unit(at - 1) != first && unit(at + size) != first)
        }
        if from == to {
            if from >= size, isMark(from - size), isMark(from) {
                return Edit(text: slice(text, 0, from - size) + slice(text, from + size), from: from - size, to: from - size)
            }
            return Edit(text: slice(text, 0, from) + mark + mark + slice(text, from), from: from + size, to: from + size)
        }
        if from >= size, isMark(from - size), isMark(to) {
            return Edit(text: slice(text, 0, from - size) + slice(text, from, to) + slice(text, to + size), from: from - size, to: to - size)
        }
        let inside = slice(text, from, to)
        if to - from >= size * 2 + 1, isMark(from), isMark(to - size) {
            return Edit(text: slice(text, 0, from) + slice(inside, size, to - from - size) + slice(text, to), from: from, to: to - size * 2)
        }
        return Edit(text: slice(text, 0, from) + mark + inside + mark + slice(text, to), from: from + size, to: to + size)
    }

    /// ⌘K: the selection becomes a link's words — `[words](url)`, the caret in the empty address (or after a given one).
    public static func link(_ text: String, from: Int, to: Int, url: String = "") -> Edit {
        let words = slice(text, from, to)
        let made = "[\(words)](\(url))"
        let length = (made as NSString).length
        let caret = !url.isEmpty ? from + length : !words.isEmpty ? from + (words as NSString).length + 3 : from + 1
        return Edit(text: slice(text, 0, from) + made + slice(text, to), from: caret, to: caret)
    }

    /// A `[words](address)` link: the whole of it, its words and its address (UTF-16 offsets in the memo).
    public struct LinkAt: Equatable, Sendable {
        public var from: Int
        public var to: Int
        public var wordsFrom: Int
        public var wordsTo: Int
        public var url: String
    }

    /// #135: the link the selection is in (both ends inside one `[words](address)`, its marks included). nil: none there.
    public static func linkAt(_ text: String, from: Int, to: Int) -> LinkAt? {
        let ns = text as NSString
        let line = lineAt(ns, min(from, ns.length))
        guard to <= line.end else { return nil }
        let units = Array(line.text.utf16)
        let read = MemoMarkdown.readLine(units, inBlock: inBlock(ns, line.start))
        guard read.kind != .code, read.kind != .fence else { return nil }
        var spans: [MemoMarkdown.Span] = []
        MemoMarkdown.lineSpans(units, read, base: line.start, into: &spans)
        for (index, span) in spans.enumerated() where span.kind == .link {
            guard let address = spans[index...].first(where: { $0.kind == .linkurl }) else { continue }
            let start = span.from - 1, end = address.to
            guard start <= from, to <= end else { continue }
            let url = ns.substring(with: NSRange(location: address.from + 1, length: max(0, address.to - address.from - 2)))
            return LinkAt(from: start, to: end, wordsFrom: span.from, wordsTo: span.to, url: url)
        }
        return nil
    }

    /// The address as typed in the link field, made one a link can open: trimmed, spaces as `%20`, `https://` before
    /// one with no scheme (`example.com/map`).
    public static func cleanURL(_ typed: String) -> String {
        let trimmed = typed.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: " ", with: "%20")
        guard !trimmed.isEmpty else { return "" }
        let schemed = trimmed.range(of: "^[A-Za-z][A-Za-z0-9+.-]*:", options: .regularExpression) != nil
        return schemed ? trimmed : "https://" + trimmed
    }

    /// #135 (SideNotes' way): the link field's Return. In a link: its address changed (an empty one takes the link out,
    /// its words left chosen). On chosen words: they become the link's words. With nothing chosen: the address itself.
    /// The caret after the link. nil: nothing to do (an empty address outside a link).
    public static func setLink(_ text: String, from: Int, to: Int, url typed: String) -> Edit? {
        let url = cleanURL(typed)
        if let link = linkAt(text, from: from, to: to) {
            let words = slice(text, link.wordsFrom, link.wordsTo)
            if url.isEmpty {
                return Edit(text: slice(text, 0, link.from) + words + slice(text, link.to), from: link.from, to: link.from + (words as NSString).length)
            }
            let made = "[\(words)](\(url))"
            let caret = link.from + (made as NSString).length
            return Edit(text: slice(text, 0, link.from) + made + slice(text, link.to), from: caret, to: caret)
        }
        let words = slice(text, from, to)
        guard !url.isEmpty, !words.contains("\n") else { return nil }
        let made = words.isEmpty ? url : "[\(words)](\(url))"
        let caret = from + (made as NSString).length
        return Edit(text: slice(text, 0, from) + made + slice(text, to), from: caret, to: caret)
    }

    // MARK: Paste

    private static func looksLikeCode(_ line: String) -> Bool {
        if Checklist.isCode(line) || line.first?.isWhitespace == true { return true }
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if let last = trimmed.last, "{};".contains(last) { return true }
        if let first = trimmed.first, ")}]".contains(first) { return true }
        return false
    }

    /// A paste (⌥⇧⌘V never comes here): a bare address over a selection makes a link of it; several lines of code onto
    /// an empty line (not in a code block) come in ``` fences. Anything else: as it is.
    public static func paste(_ text: String, from: Int, to: Int, pasted: String) -> Edit? {
        let clip = pasted.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let trimmed = clip.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = trimmed.lowercased()
        if from < to, lower.hasPrefix("http://") || lower.hasPrefix("https://"), !trimmed.contains(where: \.isWhitespace),
           !slice(text, from, to).contains("\n") {
            let made = "[\(slice(text, from, to))](\(trimmed))"
            let caret = from + (made as NSString).length
            return Edit(text: slice(text, 0, from) + made + slice(text, to), from: caret, to: caret)
        }
        let lines = trimmed.components(separatedBy: "\n").filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        guard from == to, lines.count >= 2 else { return nil }
        let ns = text as NSString
        let line = lineAt(ns, from)
        guard line.text.trimmingCharacters(in: .whitespaces).isEmpty, !inBlock(ns, line.start) else { return nil }
        var code = clip.components(separatedBy: "\n")
        while code.first?.isEmpty == true { code.removeFirst() }
        while let last = code.last, last.trimmingCharacters(in: .whitespaces).isEmpty { code.removeLast() }
        if let last = code.last { code[code.count - 1] = String(last.reversed().drop(while: \.isWhitespace).reversed()) }
        let coded = code.filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty && looksLikeCode($0) }.count
        guard coded * 2 >= lines.count, !code.contains(where: { MemoMarkdown.isFence(Array($0.utf16)) }) else { return nil }
        let block = "```\n" + code.joined(separator: "\n") + "\n```"
        let after = line.end < ns.length ? "" : "\n"
        let caret = line.start + (block as NSString).length + 1
        return Edit(text: slice(text, 0, line.start) + block + after + slice(text, line.end), from: caret, to: caret)
    }

    // MARK: Ticking a box

    private static let checkLine = try! NSRegularExpression(pattern: "^[ \\t]*[-*] \\[( |x|X)\\] ")

    private static func isCheck(_ line: String?) -> Bool {
        guard var line else { return false }
        if line.hasSuffix("\r") { line.removeLast() }
        return checkLine.firstMatch(in: line, range: NSRange(location: 0, length: (line as NSString).length)) != nil
    }

    private static func ticked(_ line: String) -> Bool {
        guard let match = checkLine.firstMatch(in: line, range: NSRange(location: 0, length: (line as NSString).length)) else { return false }
        return (line as NSString).substring(with: match.range(at: 1)) != " "
    }

    /// A box ticked or unticked on line `index` (0-based); with `moveDone`, a finished item goes to the bottom of its
    /// checklist (the checklist lines next to it, no line between), an unfinished one back just above the finished ones.
    /// One change of the words, so one undo brings back both the box and the place.
    public static func toggleDone(_ text: String, line index: Int, moveDone: Bool) -> String {
        tickedLines(text, line: index, moveDone: moveDone)?.lines.joined(separator: "\n") ?? text
    }

    /// A box clicked in the editor (#133): the words as toggleDone makes them, and the selection kept on its own words —
    /// on the ticked line it goes along with it, elsewhere it stays on the line it was on. nil: not a checklist line.
    public static func tick(_ text: String, line index: Int, from: Int, to: Int, moveDone: Bool) -> Edit? {
        guard let (lines, order) = tickedLines(text, line: index, moveDone: moveDone) else { return nil }
        let old = Checklist.split(text).map { ($0 as NSString).length }
        var starts = [Int](repeating: 0, count: old.count), at = 0
        for (index, line) in old.enumerated() { starts[index] = at; at += line + 1 }
        var newStart = [Int](repeating: 0, count: old.count)
        at = 0
        for (place, was) in order.enumerated() { newStart[was] = at; at += (lines[place] as NSString).length + 1 }
        func follow(_ offset: Int) -> Int {
            var line = 0
            while line + 1 < starts.count, starts[line + 1] <= offset { line += 1 }
            return newStart[line] + offset - starts[line]
        }
        let a = follow(from), b = follow(to)
        return Edit(text: lines.joined(separator: "\n"), from: min(a, b), to: max(a, b))
    }

    /// ⇧⌘U (Apple Notes' 체크 표시): the box on the caret's line (the line `from` is on) ticked or unticked, as a click on
    /// it would. nil: not a checklist line.
    public static func tickAtCaret(_ text: String, from: Int, to: Int, moveDone: Bool) -> Edit? {
        let ns = text as NSString
        var line = 0, search = 0
        let stop = min(from, ns.length)
        while search < stop {
            let found = ns.range(of: "\n", options: [], range: NSRange(location: search, length: stop - search))
            if found.location == NSNotFound { break }
            line += 1
            search = NSMaxRange(found)
        }
        return tick(text, line: line, from: from, to: to, moveDone: moveDone)
    }

    /// The lines after a box on line `index` is ticked, and which old line each one was. nil: not a checklist line.
    private static func tickedLines(_ text: String, line index: Int, moveDone: Bool) -> (lines: [String], order: [Int])? {
        var lines = Checklist.split(text)
        guard lines.indices.contains(index), isCheck(lines[index]) else { return nil }
        let line = lines[index] as NSString
        let at = line.range(of: "[").location
        let done = line.character(at: at + 1) == 0x20
        let changed = line.replacingCharacters(in: NSRange(location: at + 1, length: 1), with: done ? "x" : " ")
        lines[index] = changed
        var order = Array(lines.indices)
        guard moveDone else { return (lines, order) }
        var first = index, last = index
        while first > 0, isCheck(lines[first - 1]) { first -= 1 }
        while last + 1 < lines.count, isCheck(lines[last + 1]) { last += 1 }
        lines.remove(at: index)
        order.remove(at: index)
        last -= 1
        var place = first
        if done {
            place = last + 1
        } else {
            while place <= last, !ticked(lines[place]) { place += 1 }
        }
        lines.insert(changed, at: place)
        order.insert(index, at: place)
        return (lines, order)
    }
}
