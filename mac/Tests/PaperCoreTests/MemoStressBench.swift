import Foundation

// 메모 서랍 under load (docs/perf-memo-stress.md): times the drawer's core work on a stress folder made by
// scripts/memo-stress-data.py — reading and writing the files, the cards' words, the date groups, search,
// merging another device's edits, checklist lines. scripts/bench-memo-stress.sh runs it per tier;
// `--check` fails when a step is far slower than it should be (the regression check in test-memo-stress.sh).
//
//   MemoStressBench <folder> [--runs N] [--check]

private func ms(_ start: UInt64) -> Double { Double(DispatchTime.now().uptimeNanoseconds - start) / 1_000_000 }

/// The median of `runs` timings of `work` (ms).
private func time(_ runs: Int, _ work: () throws -> Void) rethrows -> Double {
    var all: [Double] = []
    for _ in 0..<runs {
        let start = DispatchTime.now().uptimeNanoseconds
        try work()
        all.append(ms(start))
    }
    return all.sorted()[all.count / 2]
}

@main
private enum MemoStressBench {
    static func main() throws {
        let args = CommandLine.arguments
        guard args.count > 1 else { print("usage: MemoStressBench <folder> [--runs N] [--check]"); exit(2) }
        let folder = URL(fileURLWithPath: args[1])
        let runs = args.firstIndex(of: "--runs").map { Int(args[$0 + 1])! } ?? 5
        let check = args.contains("--check")
        let memosURL = folder.appendingPathComponent("memos.json")
        let foldersURL = folder.appendingPathComponent(MemoFolders.fileName)
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("memo-stress-\(getpid())")
        defer { try? FileManager.default.removeItem(at: out) }
        var results: [(String, Double)] = []
        func record(_ name: String, _ value: Double) {
            results.append((name, value))
            print(name.padding(toLength: 36, withPad: " ", startingAt: 0) + String(format: "%10.2f ms", value))
        }

        // Files.
        var memos: [Memo] = []
        record("load memos.json", try time(runs) { memos = try MemoFile.decode(Data(contentsOf: memosURL)) })
        var folders = MemoFolders.fresh()
        record("load memo-folders.json", try time(runs) { folders = try MemoFolders.decode(Data(contentsOf: foldersURL)) })
        record("save memos.json", try time(runs) { try MemoFile.save(memos, to: out.appendingPathComponent("memos.json")) })
        record("save memo-folders.json", try time(runs) { try folders.save(to: out.appendingPathComponent(MemoFolders.fileName)) })

        // The cards' words (the app works them out once per text; this is the first open).
        record("card words, all memos", time(runs) {
            for memo in memos { _ = (MemoCards.title(memo.text), MemoCards.previewRows(memo.text), MemoCards.kind(memo.text)) }
        })
        // The list of the inbox: titles known (the app's cache), then the date groups — done on every redraw.
        let now = Date()
        let inbox = folders.memos(memos, in: MemoFolders.inbox)
        let titles = Dictionary(inbox.map { ($0.id, MemoCards.title($0.text)) }, uniquingKeysWith: { a, _ in a })
        func entries() -> [MemoCards.Entry] {
            inbox.map { MemoCards.Entry(id: $0.id, date: $0.updatedAt, updatedAt: $0.updatedAt, title: titles[$0.id]!, pinned: folders.isPinned($0.id)) }
        }
        record("date groups, inbox (\(inbox.count))", time(runs) { _ = MemoCards.sections(entries(), sort: .edited, pinnedGroup: true, now: now) })
        record("title sort, inbox", time(runs) { _ = MemoCards.sections(entries(), sort: .title, pinnedGroup: true, now: now) })
        // What one keystroke costs the list before SwiftUI: the typed memo to the top, the inbox's memos, the groups, the lookup.
        var typed = memos
        record("per-keystroke list work", time(runs) {
            if let index = typed.firstIndex(where: { $0.id == inbox.last?.id }) { typed.insert(typed.remove(at: index), at: 0) }
            let shown = folders.memos(typed, in: MemoFolders.inbox)
            _ = MemoCards.sections(shown.map { MemoCards.Entry(id: $0.id, date: $0.updatedAt, updatedAt: $0.updatedAt, title: titles[$0.id] ?? "", pinned: false) },
                                   sort: .edited, pinnedGroup: true, now: now)
            _ = Dictionary(typed.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        })

        // Search (D12): words that are there, consonants (초성), and a word that's nowhere (every line read).
        for query in ["보고서", "ㅂㄱㅅ", "zzqq없음"] {
            record("search \"\(query)\"", time(runs) { _ = folders.search(query, memos: memos) })
        }
        // The drawer keeps each memo's lines between searches (the next key of a query, the memos unchanged).
        let index = MemoFolders.SearchIndex()
        _ = folders.search("보", memos: memos, index: index)
        for query in ["보고서", "ㅂㄱㅅ", "zzqq없음"] {
            record("search again \"\(query)\"", time(runs) { _ = folders.search(query, memos: memos, index: index) })
        }

        // Another device saved memos.json while this one typed in one memo (MemoFile.merge).
        if let first = memos.first {
            var here = memos
            here[0].text += "\n여기서 더한 줄"
            var theirs = memos
            if theirs.count > 1 { theirs[1].text += "\n저쪽에서 더한 줄" }
            theirs[0].text = "저쪽 첫 줄\n" + theirs[0].text
            record("merge files (one memo both sides)", time(runs) {
                _ = MemoFile.merge(base: memos, here: here, theirs: theirs, changedHere: [first.id], deletedHere: [])
            })
        }

        // The long memos: both sides edit (apart; then the same line), and the per-key compare/copy the model does.
        for memo in memos where memo.id.hasPrefix("STRESS-LONG-") {
            let kb = memo.text.utf8.count / 1024
            var lines = memo.text.components(separatedBy: "\n")
            let middle = lines.count / 2
            var ours = lines; ours[1] += " 여기"
            var theirs = lines; theirs[lines.count - 2] += " 저기"
            let o = ours.joined(separator: "\n"), t = theirs.joined(separator: "\n")
            record("merge \(kb)KB, lines apart", time(max(1, runs / 2)) { _ = TextMerge.merge(base: memo.text, ours: o, theirs: t) })
            ours = lines; ours[middle] = "가" + ours[middle]
            theirs = lines; theirs[middle] += "나"
            let o2 = ours.joined(separator: "\n"), t2 = theirs.joined(separator: "\n")
            record("merge \(kb)KB, same line", time(max(1, runs / 2)) { _ = TextMerge.merge(base: memo.text, ours: o2, theirs: t2) })
            lines[middle] += "x"
            let next = lines.joined(separator: "\n")
            record("per-key compare+copy \(kb)KB", time(runs) {
                var copy = memo
                if copy.text != next { copy.text = next }
                _ = MemoCards.kind(copy.text)
            })
            record("card words \(kb)KB", time(runs) { _ = (MemoCards.title(memo.text), MemoCards.previewRows(memo.text), MemoCards.kind(memo.text)) })
        }

        // A memo of thousands of checklist lines: tick one, the bar's count, the summary on the card.
        for memo in memos where memo.id.hasPrefix("STRESS-CHECK-") {
            let total = Checklist.lines(memo.text).count
            record("checklist toggle (\(total) lines)", time(runs) { _ = Checklist.toggle(memo.text, line: total / 2) })
            record("checklist progress", time(runs) { _ = Checklist.progress(memo.text) })
            record("checklist summary (card)", time(runs) { _ = Checklist.summary(memo.text) })
            record("checklist split (open memo)", time(runs) { _ = Checklist.split(memo.text).map { Checklist.lines($0).first } })
        }

        guard check else { return }
        // Generous ceilings (about 5–10× what this Mac measures), so only a real slowdown trips them.
        let ceilings: [(String, Double)] = [
            ("load memos.json", 400), ("save memos.json", 400), ("card words, all memos", 400),
            // memo-folders.json with the formatters kept (1.45): about 10 and 16 ms on a busy Mac.
            ("load memo-folders.json", 150), ("save memo-folders.json", 150),
            // Search (1.45): a first search 30–100 ms on a busy Mac, the next key's with the lines kept about 5 ms.
            ("per-keystroke list work", 50), ("search \"보고서\"", 250), ("search \"zzqq없음\"", 300), ("search again", 60),
            ("merge 100KB, lines apart", 500), ("merge 100KB, same line", 1500), ("checklist toggle", 50),
        ]
        var failed = 0
        for (prefix, ceiling) in ceilings {
            for (name, value) in results where name.hasPrefix(prefix) && value > ceiling {
                print("SLOW \(name): \(String(format: "%.1f", value)) ms > \(Int(ceiling)) ms")
                failed += 1
            }
        }
        if failed > 0 { exit(1) }
        print("memo stress checks passed")
    }
}
