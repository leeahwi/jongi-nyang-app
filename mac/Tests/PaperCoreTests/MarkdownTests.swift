import Foundation

// 메모 마크다운 (#84, MemoMarkdown.swift): the shared cases from docs/plans/memo-markdown-cases.json (the Windows app's
// test/memoMarkdown.test.ts reads the same file) — every case's spans, its words without marks, and its card title,
// preview rows and kind when given; then the Mac's own checks.
private struct TestFailure: Error, CustomStringConvertible {
    let description: String
}

private func expect(_ condition: @autoclosure () throws -> Bool, _ message: String) throws {
    if try !condition() { throw TestFailure(description: message) }
}

private func equal<T: Equatable>(_ actual: T, _ expected: T, _ name: String) throws {
    try expect(actual == expected, "\(name): expected \(expected), got \(actual)")
}

@main
private enum MarkdownTests {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "../docs/plans/memo-markdown-cases.json"
        let file = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        func show(_ spans: [MemoMarkdown.Span]) -> [String] {
            spans.map { "\($0.kind.rawValue) \($0.from)-\($0.to)" + ($0.level.map { " L\($0)" } ?? "") }
        }

        for entry in file["cases"] as! [[String: Any]] {
            let text = entry["text"] as! String
            try test("\(entry["id"]!) \(entry["about"]!)") {
                let expected = (entry["spans"] as! [[String: Any]]).map {
                    MemoMarkdown.Span(MemoMarkdown.Kind(rawValue: $0["kind"] as! String)!, $0["from"] as! Int, $0["to"] as! Int, level: $0["level"] as? Int)
                }
                try equal(show(MemoMarkdown.spans(text)), show(expected), "spans")
                try equal(MemoMarkdown.plain(text), entry["plain"] as! String, "plain")
                if let title = entry["title"] as? String { try equal(MemoCards.title(text), title, "title") }
                if let preview = entry["preview"] as? [String] { try equal(MemoCards.previewRows(text).map(\.text), preview, "preview") }
                if entry.keys.contains("kind") {
                    let kind = MemoCards.kind(text)
                    switch entry["kind"] {
                    case let wanted as [String: String]:
                        if let link = wanted["link"] {
                            try equal(kind, .link(url: link, label: wanted["label"] ?? ""), "kind")
                        } else if let phone = wanted["phone"] {
                            try equal(kind, .phone(phone), "kind")
                        } else if let checklist = wanted["checklist"] {
                            guard case .checklist(let done, let total) = kind else { throw TestFailure(description: "kind: expected a checklist, got \(String(describing: kind))") }
                            try equal("\(done)/\(total)", checklist, "kind")
                        }
                    default:
                        try equal(kind, nil, "kind")
                    }
                }
            }
        }

        try test("every span lies in the text") {
            for entry in file["cases"] as! [[String: Any]] {
                let text = entry["text"] as! String
                let length = (text as NSString).length
                for span in MemoMarkdown.spans(text) { try expect(span.from >= 0 && span.from <= span.to && span.to <= length, "\(entry["id"]!) \(span)") }
            }
        }

        try test("search finds a word inside marks, and shows the line without them") {
            let memo = Memo(id: "m", text: "회의\n**보고서** 내기")
            let hits = MemoFolders().search("보고서", memos: [memo], index: MemoFolders.SearchIndex())
            try equal(hits.map(\.text), ["보고서 내기"], "hit")
            try equal(hits.first?.range, 0..<3, "range")
            try equal(MemoFolders().search("보고서", memos: [memo]).map(\.text), ["보고서 내기"], "without the index")
        }

        try test("lines read one at a time carry the code block (the editor restyles only the lines it touches)") {
            try equal(MemoMarkdown.lines("a\n```\n# b\n```\n# c").map(\.read.kind), [.text, .fence, .code, .fence, .heading], "kinds")
        }

        try test("a title with only marks falls to the next line with words; none: the empty memo's name") {
            try equal(MemoMarkdown.title("---\n\n**제목**"), "제목", "title")
            try equal(MemoMarkdown.title("```\n```", language: .en), "Empty note", "empty")
        }

        // 메모 서식 (#84): the shared `edits` (‸ the caret, « » a selection) and `done` cases.
        func parse(_ marked: String) -> MemoEdits.Edit {
            let ns = marked as NSString
            let caret = ns.range(of: "‸").location
            if caret != NSNotFound { return .init(text: ns.replacingCharacters(in: NSRange(location: caret, length: 1), with: ""), from: caret, to: caret) }
            let from = ns.range(of: "«").location, to = ns.range(of: "»").location - 1
            return .init(text: marked.replacingOccurrences(of: "«", with: "").replacingOccurrences(of: "»", with: ""), from: from, to: to)
        }
        func show(_ edit: MemoEdits.Edit) -> String {
            let ns = edit.text as NSString
            func part(_ a: Int, _ b: Int) -> String { ns.substring(with: NSRange(location: a, length: b - a)) }
            if edit.from == edit.to { return part(0, edit.from) + "‸" + part(edit.from, ns.length) }
            return part(0, edit.from) + "«" + part(edit.from, edit.to) + "»" + part(edit.to, ns.length)
        }
        for entry in file["edits"] as! [[String: Any]] {
            try test("\(entry["id"]!) \(entry["about"]!)") {
                let start = parse(entry["text"] as! String)
                let (text, from, to) = (start.text, start.from, start.to)
                let result: MemoEdits.Edit? = switch entry["op"] as! String {
                case "enter": MemoEdits.enter(text, from: from, to: to)
                case "heading": MemoEdits.heading(text, from: from, to: to, level: entry["level"] as? Int)
                case "wrap": MemoEdits.wrap(text, from: from, to: to, mark: entry["mark"] as! String)
                case "line": MemoEdits.toggleLines(text, from: from, to: to, kind: MemoEdits.LineKind(rawValue: entry["kind"] as! String)!)
                case "rule": MemoEdits.rule(text, from: from, to: to)
                case "link": MemoEdits.link(text, from: from, to: to)
                case "indent": MemoEdits.indent(text, from: from, to: to, out: false)
                case "outdent": MemoEdits.indent(text, from: from, to: to, out: true)
                case "moveUp": MemoEdits.moveLines(text, from: from, to: to, up: true)
                case "moveDown": MemoEdits.moveLines(text, from: from, to: to, up: false)
                case "paste": MemoEdits.paste(text, from: from, to: to, pasted: entry["pasted"] as! String)
                case "tick": MemoEdits.tick(text, line: entry["line"] as! Int, from: from, to: to, moveDone: entry["move"] as! Bool)
                case "tickKey": MemoEdits.tickAtCaret(text, from: from, to: to, moveDone: entry["move"] as! Bool)
                case "linkSet": MemoEdits.setLink(text, from: from, to: to, url: entry["url"] as! String)
                default: throw TestFailure(description: "unknown op \(entry["op"]!)")
                }
                try equal(result.map(show), entry["expect"] as? String, "edit")
            }
        }
        for entry in file["done"] as! [[String: Any]] {
            try test("\(entry["id"]!) \(entry["about"]!)") {
                try equal(MemoEdits.toggleDone(entry["text"] as! String, line: entry["line"] as! Int, moveDone: entry["move"] as! Bool),
                          entry["expect"] as! String, "done")
            }
        }

        print("\(count) markdown checks passed")
    }
}
