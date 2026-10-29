import Foundation

// 메모 서랍 (MemoFolders.swift): memo-folders.json, placements, checklist lines, quick write, the last
// folder, search — the shared cases D1–D16 (the shared memo drawer cases, docs/memo-drawer-plan.md).
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
private enum MemoDrawerTests {
    static func main() throws {
        var count = 0
        func test(_ name: String, _ action: () throws -> Void) throws {
            try action()
            count += 1
            print("PASS \(name)")
        }
        let iso = ISO8601DateFormatter()
        func at(_ text: String) -> Date { iso.date(from: text)! }
        let now = at("2026-10-27T05:00:00Z")
        func memo(_ id: String, _ text: String, _ updated: String = "2026-10-27T04:00:00Z") -> Memo {
            Memo(id: id, text: text, createdAt: at("2026-10-20T00:00:00Z"), updatedAt: at(updated))
        }
        let memos = [memo("m1", "회의 메모\n- [ ] 우유\n- [x] 빵"), memo("m2", "npm run build"), memo("m3", "인사\n하이 반가워")]
        // The file both apps start the folder cases from.
        let sample = """
        {
          "v": 1,
          "folders": [
            { "id": "inbox", "name": "메모", "color": "lavender", "order": 0, "updatedAt": "1970-01-01T00:00:00Z" },
            { "id": "work", "name": "회사", "color": "pink", "order": 1, "updatedAt": "2026-10-26T09:00:00Z" },
            { "id": "home", "name": "집", "color": "mint", "order": 2, "updatedAt": "2026-10-26T09:00:00Z" }
          ],
          "placement": {
            "gone": { "folder": "work", "pinned": false, "at": "2026-10-26T09:00:00Z" },
            "m1": { "folder": "work", "pinned": true, "at": "2026-10-26T09:00:00Z" },
            "m3": { "folder": "work", "pinned": false, "at": "2026-10-26T09:00:00Z" }
          },
          "updatedAt": "2026-10-26T09:00:00Z"
        }

        """
        let folders = try MemoFolders.decode(Data(sample.utf8))

        try test("D1 no file: the inbox alone, every memo in it, and its text") {
            let fresh = MemoFolders.fresh()
            try equal(fresh.visible.map(\.id), ["inbox"], "folders")
            try equal(memos.map { fresh.folderID(of: $0.id) }, ["inbox", "inbox", "inbox"], "placements")
            try equal(fresh.encoded(), """
            {
              "v": 1,
              "folders": [
                { "id": "inbox", "name": "메모", "color": "lavender", "order": 0, "updatedAt": "1970-01-01T00:00:00Z" }
              ],
              "placement": {},
              "updatedAt": "1970-01-01T00:00:00Z"
            }

            """, "text")
            try equal(MemoFolders.fresh(language: .en).visible[0].name, "Notes", "en name")
            try equal(MemoFolders.fresh(language: .nl).visible[0].name, "Notities", "nl name")
            // The untouched default follows the language; a renamed inbox keeps its name.
            try equal(fresh.visible[0].displayName(.en), "Notes", "default shown in en")
            var renamed = fresh
            renamed.rename("inbox", to: "  받은 메모 ", now: now)
            try equal(renamed.visible[0].displayName(.en), "받은 메모", "renamed")
        }

        try test("the sample reads; writing it again gives the same bytes") {
            try equal(folders.visible.map(\.id), ["inbox", "work", "home"], "order")
            try equal(folders.encoded(), sample, "round trip")
        }

        try test("D2 a memo with no placement (or a deleted/unknown folder) is in the inbox") {
            try equal(folders.folderID(of: "m2"), "inbox", "m2")
            try equal(folders.folderID(of: "m1"), "work", "m1")
            try equal(folders.memos(memos, in: "work").map(\.id), ["m1", "m3"], "work")
            try equal(folders.memos(memos, in: "inbox").map(\.id), ["m2"], "inbox")
            try equal(folders.pinnedMemos(memos).map(\.id), ["m1"], "pinned")
            var odd = folders
            odd.placement["m2"] = .init(folder: "nowhere", pinned: false, at: now)
            try equal(odd.folderID(of: "m2"), "inbox", "unknown folder")
        }

        try test("D3 deleting a folder moves its memos to the inbox; nothing is lost") {
            var copy = folders
            try expect(copy.deleteFolder("work", now: now), "deleted")
            try equal(copy.visible.map(\.id), ["inbox", "home"], "bookmarks")
            try equal(copy.memos(memos, in: "inbox").map(\.id), ["m1", "m2", "m3"], "inbox")
            try equal(copy.placement["m1"], .init(folder: "inbox", pinned: true, at: now), "m1 keeps its pin")
            try equal(copy.folders.first { $0.id == "work" }?.deleted, true, "tombstone")
            try expect(copy.encoded().contains("{ \"id\": \"work\", \"name\": \"회사\", \"color\": \"pink\", \"order\": 1, \"updatedAt\": \"2026-10-27T05:00:00Z\", \"deleted\": true }"), "tombstone text")
            // Tombstones go after 30 days.
            try equal(copy.pruned(memoIDs: ["m1", "m2", "m3"], now: at("2026-11-27T05:00:00Z")).folders.map(\.id), ["inbox", "home"], "pruned")
            try equal(copy.pruned(memoIDs: ["m1", "m2", "m3"], now: at("2026-11-20T05:00:00Z")).folders.count, 3, "kept")
        }

        try test("D4 the inbox can't be deleted") {
            var copy = folders
            try expect(!copy.deleteFolder("inbox", now: now), "refused")
            try equal(copy, folders, "unchanged")
            // A file that marks it deleted is read as live.
            let marked = try MemoFolders.decode(Data(sample.replacingOccurrences(of: "\"order\": 0, \"updatedAt\": \"1970-01-01T00:00:00Z\" }", with: "\"order\": 0, \"updatedAt\": \"1970-01-01T00:00:00Z\", \"deleted\": true }").utf8))
            try equal(marked.visible.first?.id, "inbox", "live")
        }

        try test("D5 an older app saving memos.json alone: folders stay, a new memo is in the inbox") {
            let more = memos + [memo("m4", "옛 버전에서 적음")]
            try equal(folders.folderID(of: "m1"), "work", "m1")
            try equal(folders.folderID(of: "m4"), "inbox", "m4")
            try equal(folders.memos(more, in: "inbox").map(\.id), ["m2", "m4"], "inbox")
        }

        try test("D6 a deleted memo's placement is ignored and dropped on the next write") {
            try equal(folders.count(memos, in: "work"), 2, "not counted")
            let written = folders.pruned(memoIDs: Set(memos.map(\.id)), now: now)
            try equal(written.placement.keys.sorted(), ["m1", "m3"], "dropped")
            try expect(!written.encoded().contains("\"gone\""), "not written")
            // A placement made in the last hour stays: its memo may still be on its way from another device.
            var fresh = folders
            fresh.placement["new"] = .init(folder: "home", pinned: false, at: at("2026-10-27T04:10:00Z"))
            try equal(fresh.pruned(memoIDs: Set(memos.map(\.id)), now: now).placement.keys.sorted(), ["m1", "m3", "new"], "grace")
            try equal(fresh.pruned(memoIDs: Set(memos.map(\.id)), now: at("2026-10-27T05:10:01Z")).placement.keys.sorted(), ["m1", "m3"], "after an hour")
        }

        let list = "장보기\n- [ ] 우유\n- [ ] 빵\n  * [X] 계란\n-[ ] 아님\n- [ ]아님"
        try test("D7 checking a line changes that line only") {
            try equal(Checklist.toggle(list, line: 1), "장보기\n- [x] 우유\n- [ ] 빵\n  * [X] 계란\n-[ ] 아님\n- [ ]아님", "checked")
            try equal(Checklist.toggle("a\r\n- [ ] b\r\nc", line: 1), "a\r\n- [x] b\r\nc", "CRLF kept")
            try equal(Checklist.toggle(list, line: 0), list, "not a checklist line")
            try equal(Checklist.toggle(list, line: 4), list, "no space after the dash")
            try equal(Checklist.toggle(list, line: 5), list, "no space after the box")
            try equal(Checklist.toggle(list, line: 99), list, "no such line")
        }

        try test("D8 unchecking: [x] or [X] → [ ]") {
            try equal(Checklist.toggle(list, line: 3), "장보기\n- [ ] 우유\n- [ ] 빵\n  * [ ] 계란\n-[ ] 아님\n- [ ]아님", "unchecked")
            try equal(Checklist.toggle("- [x] 끝", line: 0), "- [ ] 끝", "lower x")
        }

        try test("D9 progress: checked / checklist lines; none → no bar") {
            try expect(Checklist.progress(list).map { $0 == (1, 3) } ?? false, "1/3")
            try expect(Checklist.progress("그냥 메모\n- 목록") == nil, "none")
            try expect(Checklist.progress("- [ ]") == nil, "a box needs a space after it")
            try equal(Checklist.lines(list).map(\.index), [1, 2, 3], "lines")
            try equal(Checklist.lines(list).map(\.text), ["우유", "빵", "계란"], "texts")
        }

        try test("the collapsed slip: title and two rows, boxes shown as ☐/☑") {
            let summary = Checklist.summary("\n\n- [ ] 우유 사기\n\n- [x] 빵\n- [ ] 계란\n- [ ] 버터")
            try equal(summary.title, "우유 사기", "title without its box")
            try equal(summary.preview, [.init(checked: true, text: "빵"), .init(checked: false, text: "계란")], "rows")
            try equal(Checklist.summary("  \n").title, "빈 메모", "blank")
            try equal(Checklist.summary("", language: .nl).title, "Lege notitie", "nl blank")
            try equal(Checklist.summary("회의\n첫째\n둘째\n셋째").preview.map(\.text), ["첫째", "둘째"], "plain")
        }

        try test("D10 quick write: blanks make nothing; text is trimmed") {
            try equal(MemoFolders.quickWriteText("  \n\t "), nil, "blank")
            try equal(MemoFolders.quickWriteText("  우유 사기\n  내일 \n"), "우유 사기\n  내일", "trimmed")
        }

        try test("D11 quick write into 고정: the inbox, pinned; a folder: that folder") {
            try expect(folders.quickWriteTarget(.pinned) == ("inbox", true), "pinned")
            try expect(folders.quickWriteTarget(.folder("home")) == ("home", false), "folder")
            try expect(folders.quickWriteTarget(.folder("nowhere")) == ("inbox", false), "gone")
            var copy = folders
            copy.place("new", in: "inbox", now: now)
            copy.setPinned("new", true, now: now)
            try equal(copy.placement["new"], .init(folder: "inbox", pinned: true, at: now), "written")
            try equal(copy.updatedAt, now, "file time")
        }

        try test("D12 search: 초성, every folder, the folder with each hit") {
            let hits = folders.search("ㅎㅇ", memos: memos)
            try equal(hits, [.init(memoID: "m1", folderID: "work", text: "회의 메모", range: 0..<2),
                             .init(memoID: "m3", folderID: "work", text: "하이 반가워", range: 0..<2)], "ㅎㅇ")
            try equal(folders.search("build", memos: memos).map(\.folderID), ["inbox"], "inbox too")
            try equal(folders.search("우유", memos: memos).first?.text, "- [ ] 우유", "the line as written")
            // The folder's name finds its memos (the title, nothing marked).
            try equal(folders.search("회사", memos: memos), [.init(memoID: "m1", folderID: "work", text: "회의 메모", range: nil),
                                                          .init(memoID: "m3", folderID: "work", text: "인사", range: nil)], "folder name")
            try equal(folders.search("  ", memos: memos), [], "blank")
        }

        try test("D13 the same memo moved on two devices: the later one wins") {
            var here = folders, theirs = folders
            here.place("m2", in: "work", now: at("2026-10-27T05:00:00Z"))
            theirs.place("m2", in: "home", now: at("2026-10-27T05:01:00Z"))
            try equal(MemoFolders.merge(here: here, theirs: theirs).folderID(of: "m2"), "home", "theirs later")
            try equal(MemoFolders.merge(here: theirs, theirs: here).folderID(of: "m2"), "home", "either way")
            var tie = folders
            tie.place("m2", in: "home", now: at("2026-10-27T05:00:00Z"))
            try equal(MemoFolders.merge(here: here, theirs: tie).folderID(of: "m2"), "work", "a tie keeps this device's")
            // A folder renamed on one, deleted later on the other: the delete wins.
            var renamed = folders, deleted = folders
            renamed.rename("home", to: "우리 집", now: at("2026-10-27T05:00:00Z"))
            deleted.deleteFolder("home", now: at("2026-10-27T05:02:00Z"))
            try equal(MemoFolders.merge(here: renamed, theirs: deleted).visible.map(\.id), ["inbox", "work"], "tombstone newer")
        }

        try test("D14 the same name made on two devices: both stay") {
            var here = folders, theirs = folders
            here.addFolder(name: "공부", color: .sky, now: now, id: "a")
            theirs.addFolder(name: "공부", color: .yellow, now: now, id: "b")
            let merged = MemoFolders.merge(here: here, theirs: theirs)
            try equal(merged.visible.map(\.id), ["inbox", "work", "home", "a", "b"], "both")
            try equal(merged.visible.map(\.name).filter { $0 == "공부" }.count, 2, "names")
        }

        try test("D15 an unreadable file throws (the app moves it aside and starts like D1)") {
            for text in ["{ not json", "[]", "{\"v\":1}", "{\"v\":1,\"folders\":{}}", ""] {
                try expect((try? MemoFolders.decode(Data(text.utf8))) == nil, "\(text) refused")
            }
            try equal(MemoFolders.asideName(now), "memo-folders.unreadable-20261027-050000.json", "aside name")
            // Odd entries are skipped, not a reason to refuse the file.
            let odd = try MemoFolders.decode(Data("{\"folders\":[{\"name\":\"no id\"},{\"id\":\"x\",\"name\":\"X\",\"color\":\"teal\"}],\"placement\":{\"m1\":3}}".utf8))
            try equal(odd.visible.map(\.id), ["inbox", "x"], "skipped")
            try equal(odd.visible[1].colorKey, .lavender, "unknown colour shown as lavender")
            try expect(odd.encoded().contains("\"color\": \"teal\""), "and kept")
        }

        try test("D16 ⌘1–9 bookmarks in order, ⌘0 고정, missing numbers nothing") {
            try equal(folders.tab(forDigit: 1), .folder("inbox"), "1")
            try equal(folders.tab(forDigit: 3), .folder("home"), "3")
            try equal(folders.tab(forDigit: 4), nil, "4")
            try equal(folders.tab(forDigit: 0), .pinned, "0")
            try equal(folders.tab(forDigit: 10), nil, "10")
        }

        try test("the last folder: never opened → inbox; a deleted one → inbox") {
            try equal(folders.lastFolder(nil), "inbox", "nil")
            try equal(folders.lastFolder("home"), "home", "home")
            var copy = folders
            copy.deleteFolder("home", now: now)
            try equal(copy.lastFolder("home"), "inbox", "deleted")
        }

        try test("folders: add, rename, colour, reorder") {
            var copy = folders
            let id = copy.addFolder(name: "  공부\n노트  ", color: .sky, now: now, id: "s")
            try equal(id, "s", "id")
            try equal(copy.folder("s")?.name, "공부 노트", "one line")
            try equal(copy.folder("s")?.order, 3, "last")
            copy.recolor("s", to: .peach, now: now)
            try equal(copy.folder("s")?.colorKey, .peach, "colour")
            copy.rename("s", to: "   ", now: now)
            try equal(copy.folder("s")?.name, "공부 노트", "blank rename ignored")
            copy.reorder(["home", "inbox"], now: now)
            try equal(copy.visible.map(\.id), ["home", "inbox", "work", "s"], "reordered")
            try equal(copy.folder("home")?.updatedAt, now, "changed ones stamped")
        }

        try test("the handle's number: memos changed today") {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "UTC")!
            let some = [memo("a", "x", "2026-10-27T01:00:00Z"), memo("b", "y", "2026-10-26T23:00:00Z")]
            try equal(MemoFolders.changedToday(some, now: now, calendar: calendar), 1, "today")
        }

        try test("undoing a folder's delete brings it back with its memos") {
            var copy = folders
            copy.deleteFolder("work", now: now)
            copy.restoreFolder("work", memoIDs: ["m1", "m3"], now: at("2026-10-27T05:00:05Z"))
            try equal(copy.visible.map(\.id), ["inbox", "work", "home"], "back")
            try equal(copy.memos(memos, in: "work").map(\.id), ["m1", "m3"], "memos back")
            try expect(copy.isPinned("m1"), "pin kept")
        }

        try test("words: slip times, sheets, footers") {
            var calendar = Calendar(identifier: .gregorian)
            calendar.timeZone = TimeZone(identifier: "Asia/Seoul")!
            let base = at("2026-10-27T05:00:00Z") // 14:00 in Seoul
            try equal(MemoFolders.slipTime(at("2026-10-27T01:12:00Z"), now: base, calendar: calendar), "10:12", "today")
            try equal(MemoFolders.slipTime(at("2026-10-27T01:12:00Z"), now: base, calendar: calendar, language: .en), "10:12 AM", "today en")
            try equal(MemoFolders.slipTime(at("2026-10-26T01:12:00Z"), now: base, calendar: calendar), "어제", "yesterday")
            try equal(MemoFolders.slipTime(at("2026-10-26T01:12:00Z"), now: base, calendar: calendar, language: .nl), "Gisteren", "gisteren")
            try equal(MemoFolders.slipTime(at("2026-10-21T01:12:00Z"), now: base, calendar: calendar), "10월 21일", "day")
            try equal(MemoFolders.slipTime(at("2026-10-21T01:12:00Z"), now: base, calendar: calendar, language: .en), "Oct 21", "day en")
            try equal(MemoFolders.slipTime(at("2025-10-21T01:12:00Z"), now: base, calendar: calendar, language: .nl), "21 okt 2025", "other year nl")
            try equal([1, 5, 10, 11].map(MemoFolders.sheets), ["한 장", "다섯 장", "열 장", "11장"], "sheets")
            try equal(MemoFolders.footer(folder: "회사", count: 5), "회사에 다섯 장", "footer")
            try equal(MemoFolders.footer(folder: "회사", count: 0), "회사에 아직 메모가 없어요", "empty")
            try equal(MemoFolders.footer(folder: "Work", count: 0, language: .en), "Nothing in Work yet", "empty en")
            try equal(MemoFolders.footer(folder: "Work", count: 1, language: .en), "1 note in Work", "en")
            try equal(MemoFolders.footer(folder: "Werk", count: 0, language: .nl), "Nog niets in Werk", "nl empty")
            try equal(MemoFolders.pinnedFooter(count: 3), "고정한 메모 세 장", "pinned")
            try equal(MemoFolders.pinnedFooter(count: 1, language: .nl), "1 vastgezette notitie", "pinned nl")
            try equal(MemoFolders.searchFooter(count: 2, language: .en), "2 notes found", "search en")
            try equal(MemoFolders.searchFooter(count: 2), "찾은 메모 두 장", "search ko")
            try equal(MemoFolders.searchFooter(count: 0), "찾는 메모가 없어요", "search none")
        }

        try test("code lines are drawn fixed-width") {
            try expect(Checklist.isCode("git log --oneline -5"), "git")
            try expect(Checklist.isCode("$ swift build"), "$")
            try expect(Checklist.isCode("    let x = 1"), "indented")
            try expect(Checklist.isCode("./scripts/qa.sh all"), "./")
            try expect(!Checklist.isCode("git"), "one word")
            try expect(!Checklist.isCode("Buy milk tomorrow"), "words")
            try expect(!Checklist.isCode("git 저장소 정리하기"), "Hangul: not a command line")
        }

        try test("M1–M3 the memo tab's move notice: once, only with memos") {
            try expect(MemoMove.notice(memoCount: 5, shown: false) == (true, true), "M1 first launch with memos")
            try expect(MemoMove.notice(memoCount: 0, shown: false) == (false, true), "M2 no memos: no notice, never later either")
            try expect(MemoMove.notice(memoCount: 5, shown: true) == (false, false), "M3 second launch")
            try equal(MemoMove.body(count: 5, shortcut: "⇧⌘D"), "메모 탭에 있던 메모 다섯 장은 서랍의 ‘메모’ 폴더에 그대로 있어요. ⇧⌘D 키나 노트 위의 서랍 버튼으로 열어요.", "ko")
            try equal(MemoMove.body(count: 1, shortcut: nil, language: .en), "The note from the Notes tab is in the drawer’s ‘Notes’ folder. Open it with the drawer button above the notepad.", "en one")
            try equal(MemoMove.body(count: 3, shortcut: "⇧⌘D", language: .nl), "Alle 3 notities van het tabblad Notities staan in de map ‘Notities’ van de lade. Open haar met ⇧⌘D of de ladeknop boven het notitieblok.", "nl")
            try equal(MemoMove.title(.en), "Your notes moved to the drawer", "title")
            try expect(MemoMove.addedToast() == ("메모 서랍에 넣었어요", "열기"), "M4 toast")
        }

        // MARK: 1.44 / 1.29 (D17–D29)

        func line(_ text: String, _ key: String) -> String {
            text.split(separator: "\n").first { $0.contains("\"\(key)\"") }.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        }

        try test("D17 sort and paper in the file: written only when not the default; moving keeps the paper") {
            var f = folders
            f.setSort("work", .created, now: now)
            f.setPaper("m3", .night, now: now)
            try equal(line(f.encoded(), "work"), "{ \"id\": \"work\", \"name\": \"회사\", \"color\": \"pink\", \"order\": 1, \"updatedAt\": \"2026-10-27T05:00:00Z\", \"sort\": \"created\" },", "work line")
            try equal(line(f.encoded(), "m3"), "\"m3\": { \"folder\": \"work\", \"pinned\": false, \"at\": \"2026-10-27T05:00:00Z\", \"paper\": \"night\" }", "m3 line")
            try equal(f.sort(of: "work"), .created, "sort read")
            try equal(f.paper(of: "m3"), .night, "paper read")
            f.place("m3", in: "home", now: now)
            try equal(f.paper(of: "m3"), .night, "moving keeps the paper")
            var back = f
            back.setSort("work", .edited, now: now)
            back.setPaper("m3", nil, now: now)
            try expect(!back.encoded().contains("\"sort\""), "edited: no sort key")
            try expect(!back.encoded().contains("\"paper\""), "서랍 따라: no paper key")
            var gone = folders
            gone.setSort("work", .title, now: now)
            gone.deleteFolder("work", now: now)
            try equal(line(gone.encoded(), "work"), "{ \"id\": \"work\", \"name\": \"회사\", \"color\": \"pink\", \"order\": 1, \"updatedAt\": \"2026-10-27T05:00:00Z\", \"sort\": \"title\", \"deleted\": true },", "tombstone with sort")
            var m2 = folders
            m2.setPaper("m2", .kraft, now: now)
            try equal(line(m2.encoded(), "m2"), "\"m2\": { \"folder\": \"inbox\", \"pinned\": false, \"at\": \"2026-10-27T05:00:00Z\", \"paper\": \"kraft\" },", "m2 without a placement")
        }

        try test("D18 unknown keys and values survive a read and a write") {
            let input = #"{"v":1,"folders":[{"id":"inbox","name":"메모","color":"lavender","order":0,"updatedAt":"1970-01-01T00:00:00Z","emoji":"🐱","sort":"newest"}],"placement":{"m1":{"folder":"inbox","pinned":false,"at":"2026-10-26T09:00:00Z","tag":7,"paper":"sepia"}},"updatedAt":"2026-10-26T09:00:00Z","extra":{"b":null,"a":[1,2.5,"x",1.0,{}]},"alpha":true}"#
            let read = try MemoFolders.decode(Data(input.utf8))
            try equal(read.sort(of: "inbox"), .edited, "unknown sort read as edited")
            try equal(read.paper(of: "m1"), nil, "unknown paper read as 서랍 따라")
            try equal(read.encoded(), "{\n  \"v\": 1,\n  \"folders\": [\n    { \"id\": \"inbox\", \"name\": \"메모\", \"color\": \"lavender\", \"order\": 0, \"updatedAt\": \"1970-01-01T00:00:00Z\", \"sort\": \"newest\", \"emoji\": \"🐱\" }\n  ],\n  \"placement\": {\n    \"m1\": { \"folder\": \"inbox\", \"pinned\": false, \"at\": \"2026-10-26T09:00:00Z\", \"paper\": \"sepia\", \"tag\": 7 }\n  },\n  \"updatedAt\": \"2026-10-26T09:00:00Z\",\n  \"alpha\": true,\n  \"extra\": { \"a\": [1, 2.5, \"x\", 1, {}], \"b\": null }\n}\n", "written back")
            try equal(folders.encoded(), sample, "SAMPLE still round-trips")
        }

        try test("D19 paper merges like pinned: the newer placement wins whole") {
            var here = folders
            here.setPaper("m1", .night, now: at("2026-10-27T05:00:00Z"))
            var theirs = folders
            theirs.place("m1", in: "home", now: at("2026-10-27T05:01:00Z"))
            for merged in [MemoFolders.merge(here: here, theirs: theirs), MemoFolders.merge(here: theirs, theirs: here)] {
                try equal(merged.folderID(of: "m1"), "home", "moved there later")
                try equal(merged.paper(of: "m1"), nil, "their placement has no paper")
                try expect(merged.isPinned("m1"), "pin kept")
            }
            var tie = folders
            tie.place("m1", in: "home", now: at("2026-10-27T05:00:00Z"))
            let kept = MemoFolders.merge(here: here, theirs: tie)
            try equal(kept.folderID(of: "m1"), "work", "tie: this device's")
            try equal(kept.paper(of: "m1"), .night, "tie: this device's paper")
            var later = try MemoFolders.decode(Data(sample.replacingOccurrences(of: #""m1": { "folder": "work", "pinned": true, "at": "2026-10-26T09:00:00Z" }"#, with: #""m1": { "folder": "work", "pinned": true, "at": "2026-10-27T05:02:00Z", "paper": "grid", "tag": 1 }"#).utf8))
            later = MemoFolders.merge(here: here, theirs: later)
            try equal(later.paper(of: "m1"), .grid, "their newer paper")
            try equal(later.placement["m1"]?.extra["tag"], .int(1), "their unknown key")
        }

        try test("D20 sort merges with its folder: the newer folder wins whole") {
            var here = folders
            here.setSort("work", .title, now: at("2026-10-27T05:00:00Z"))
            var theirs = folders
            theirs.rename("work", to: "일", now: at("2026-10-27T05:01:00Z"))
            let merged = MemoFolders.merge(here: here, theirs: theirs)
            try equal(merged.folder("work")?.name, "일", "their name")
            try equal(merged.sort(of: "work"), .edited, "their folder has no sort")
            var here2 = folders
            here2.setSort("work", .title, now: at("2026-10-27T05:01:00Z"))
            var theirs2 = folders
            theirs2.rename("work", to: "일", now: at("2026-10-27T05:00:00Z"))
            let merged2 = MemoFolders.merge(here: here2, theirs: theirs2)
            try equal(merged2.folder("work")?.name, "회사", "my name")
            try equal(merged2.sort(of: "work"), .title, "my sort")
        }

        try test("D21 duplicating a folder: right after it, `회사 사본`, copies with their pins and papers") {
            var f = folders
            f.setPaper("m3", .kraft, now: at("2026-10-26T09:00:00Z"))
            f.setSort("work", .created, now: at("2026-10-26T09:00:00Z"))
            let before = f
            try equal(f.duplicateFolder("work", as: "w2", copies: [("m1", "c1"), ("m3", "c3")], now: now), "w2", "new id")
            try equal(f.visible.map(\.id), ["inbox", "work", "w2", "home"], "bookmarks")
            try equal(line(f.encoded(), "w2"), "{ \"id\": \"w2\", \"name\": \"회사 사본\", \"color\": \"pink\", \"order\": 2, \"updatedAt\": \"2026-10-27T05:00:00Z\", \"sort\": \"created\" },", "copy line")
            try equal(f.folder("home")?.order, 3, "home moved down")
            try equal(f.folder("home")?.updatedAt, now, "home touched")
            try equal(f.folder("work"), before.folder("work"), "work unchanged")
            try equal(f.placement["c1"], MemoFolders.Placement(folder: "w2", pinned: true, at: now), "c1")
            try equal(f.placement["c3"], MemoFolders.Placement(folder: "w2", pinned: false, at: now, paper: "kraft"), "c3 with its paper")
            f.duplicateFolder("work", as: "w3", copies: [], now: now)
            try equal(f.folder("w3")?.name, "회사 사본 2", "second copy")
            try equal(f.visible.map(\.id), ["inbox", "work", "w3", "w2", "home"], "after work")
            try equal(f.folder("home")?.order, 4, "home again")
            var en = folders
            en.rename("work", to: "Work", now: now)
            en.duplicateFolder("work", as: "x", copies: [], now: now, language: .en)
            en.duplicateFolder("work", as: "y", copies: [], now: now, language: .en)
            try equal([en.folder("x")?.name, en.folder("y")?.name], ["Work copy", "Work copy 2"], "en")
            var nl = folders
            nl.rename("work", to: "Werk", now: now)
            nl.duplicateFolder("work", as: "x", copies: [], now: now, language: .nl)
            try equal(nl.folder("x")?.name, "Werk kopie", "nl")
            var inbox = folders
            inbox.duplicateFolder("inbox", as: "x", copies: [], now: now, language: .en)
            try equal(inbox.folder("x")?.name, "Notes copy", "the inbox's shown name")
            var long = folders
            long.rename("work", to: String(repeating: "가", count: 40), now: now)
            long.duplicateFolder("work", as: "x", copies: [], now: now)
            try equal(long.folder("x")?.name, String(repeating: "가", count: 37) + " 사본", "a long name is cut so the ending fits")
        }

        var seoul = Calendar(identifier: .gregorian)
        seoul.timeZone = TimeZone(identifier: "Asia/Seoul")!
        let nowG = at("2026-10-29T05:00:00Z")

        try test("D22 date groups and short times (weeks from Monday, midnight, month, year, future)") {
            let rows: [(String, MemoCards.Group, [String], [String])] = [
                ("2026-10-30T00:00:00Z", .today, ["오늘", "Today", "Vandaag"], ["오전 9:00", "9:00 AM", "09:00"]),
                ("2026-10-28T15:00:00Z", .today, ["오늘", "Today", "Vandaag"], ["오전 12:00", "12:00 AM", "00:00"]),
                ("2026-10-28T14:59:59Z", .yesterday, ["어제", "Yesterday", "Gisteren"], ["오후 11:59", "11:59 PM", "23:59"]),
                ("2026-10-27T00:00:00Z", .thisWeek, ["이번 주", "This week", "Deze week"], ["화요일", "Tuesday", "dinsdag"]),
                ("2026-10-25T15:00:00Z", .thisWeek, ["이번 주", "This week", "Deze week"], ["월요일", "Monday", "maandag"]),
                ("2026-10-25T14:59:59Z", .lastWeek, ["지난주", "Last week", "Vorige week"], ["일요일", "Sunday", "zondag"]),
                ("2026-10-18T15:00:00Z", .lastWeek, ["지난주", "Last week", "Vorige week"], ["월요일", "Monday", "maandag"]),
                ("2026-10-18T14:59:59Z", .month(year: 2026, month: 10), ["10월", "October", "oktober"], ["18일", "Oct 18", "18 okt"]),
                ("2026-09-30T15:00:00Z", .month(year: 2026, month: 10), ["10월", "October", "oktober"], ["1일", "Oct 1", "1 okt"]),
                ("2026-09-30T14:59:59Z", .month(year: 2026, month: 9), ["9월", "September", "september"], ["30일", "Sep 30", "30 sep"]),
                ("2025-12-31T15:00:00Z", .month(year: 2026, month: 1), ["1월", "January", "januari"], ["1일", "Jan 1", "1 jan"]),
                ("2025-12-31T14:59:59Z", .month(year: 2025, month: 12), ["2025년 12월", "December 2025", "december 2025"], ["12월 31일", "Dec 31", "31 dec"]),
            ]
            for (time, group, headers, shorts) in rows {
                let date = at(time)
                try equal(MemoCards.group(date, now: nowG, calendar: seoul), group, "group \(time)")
                for language in AppLanguage.allCases {
                    try equal(MemoCards.header(group, now: nowG, calendar: seoul, language: language), headers[language.index], "header \(time) \(language)")
                    try equal(MemoCards.shortTime(date, in: group, now: nowG, calendar: seoul, language: language), shorts[language.index], "short \(time) \(language)")
                }
            }
            let monday = at("2026-10-26T05:00:00Z")
            try equal(MemoCards.group(at("2026-10-25T01:00:00Z"), now: monday, calendar: seoul), .yesterday, "Monday: Sunday is 어제")
            try equal(MemoCards.group(at("2026-10-24T01:00:00Z"), now: monday, calendar: seoul), .lastWeek, "Monday: Saturday is 지난주")
            try equal(MemoCards.shortTime(at("2026-10-24T01:00:00Z"), in: .lastWeek, now: monday, calendar: seoul), "토요일", "토요일")
            try equal(MemoCards.header(.pinned, now: nowG, language: .nl), "Vastgezet", "pinned nl")
            // Without a date header: the day.
            try equal(MemoCards.dayTime(at("2026-10-29T09:02:00Z"), now: nowG, calendar: seoul), "오후 6:02", "day: today")
            try equal(MemoCards.dayTime(at("2026-10-28T09:02:00Z"), now: nowG, calendar: seoul, language: .en), "Yesterday", "day: yesterday")
            try equal(MemoCards.dayTime(at("2026-10-13T01:00:00Z"), now: nowG, calendar: seoul), "10월 13일", "day: this year")
            try equal(MemoCards.dayTime(at("2025-10-13T01:00:00Z"), now: nowG, calendar: seoul, language: .en), "Oct 13, 2025", "day: other year")
            try equal(MemoCards.dayTime(at("2025-10-13T01:00:00Z"), now: nowG, calendar: seoul, language: .nl), "13 okt 2025", "day: other year nl")
            // The open memo's bar.
            let edited: [(String, [String])] = [
                ("2026-10-29T08:38:00Z", ["오후 5:38 고침", "Edited 5:38 PM", "Bewerkt 17:38"]),
                ("2026-10-28T08:38:00Z", ["어제 고침", "Edited yesterday", "Gisteren bewerkt"]),
                ("2026-10-27T08:38:00Z", ["화요일 고침", "Edited Tuesday", "Dinsdag bewerkt"]),
                ("2026-10-13T08:38:00Z", ["10월 13일 고침", "Edited Oct 13", "Bewerkt 13 okt"]),
                ("2025-10-13T08:38:00Z", ["2025년 10월 13일 고침", "Edited Oct 13, 2025", "Bewerkt 13 okt 2025"]),
            ]
            for (time, words) in edited {
                for language in AppLanguage.allCases {
                    try equal(MemoCards.edited(at(time), now: nowG, calendar: seoul, language: language), words[language.index], "edited \(time) \(language)")
                }
            }
        }

        func entry(_ id: String, _ time: String, pinned: Bool = false, title: String? = nil, created: String? = nil) -> MemoCards.Entry {
            MemoCards.Entry(id: id, date: at(created ?? time), updatedAt: at(time), title: title ?? id, pinned: pinned)
        }

        try test("D23 the list in groups: 고정 first, then by date, newest first") {
            let list = [entry("f", "2025-12-31T14:59:59Z"), entry("e", "2026-10-18T14:59:59Z"), entry("a", "2026-10-27T00:00:00Z", pinned: true),
                        entry("d", "2026-10-25T14:59:59Z"), entry("c", "2026-10-28T14:59:59Z"), entry("b", "2026-10-28T15:00:00Z"), entry("b2", "2026-10-29T01:00:00Z")]
            let sections = MemoCards.sections(list, sort: .edited, pinnedGroup: true, now: nowG, calendar: seoul)
            try equal(sections.map(\.group), [.pinned, .today, .yesterday, .lastWeek, .month(year: 2026, month: 10), .month(year: 2025, month: 12)], "groups")
            try equal(sections.map(\.ids), [["a"], ["b2", "b"], ["c"], ["d"], ["e"], ["f"]], "ids")
            let pinnedView = MemoCards.sections(list, sort: .edited, pinnedGroup: false, now: nowG, calendar: seoul)
            try equal(pinnedView.first?.group, .today, "고정's own view: no 고정 group")
            try equal(pinnedView.first { $0.group == .thisWeek }?.ids, ["a"], "a goes to 이번 주")
            let created = [entry("x", "2026-10-29T01:00:00Z", created: "2026-10-01T01:00:00Z"), entry("y", "2026-10-01T01:00:00Z", created: "2026-10-29T01:00:00Z")]
            let byCreation = MemoCards.sections(created, sort: .created, pinnedGroup: true, now: nowG, calendar: seoul)
            try equal(byCreation.map(\.ids), [["y"], ["x"]], "만든 순 by createdAt")
            try equal(byCreation.map(\.group), [.today, .month(year: 2026, month: 10)], "만든 순 groups")
        }

        try test("D24 제목 순: 고정 stays, then titles (numbers by value, Latin before Hangul)") {
            let list = [entry("1", "2026-10-29T01:00:00Z", title: "b"), entry("2", "2026-10-29T01:00:00Z", title: "가방"), entry("3", "2026-10-29T01:00:00Z", title: "10번"),
                        entry("4", "2026-10-29T01:00:00Z", title: "2번"), entry("5", "2026-10-28T01:00:00Z", title: "A"), entry("6", "2026-10-29T01:00:00Z", pinned: true, title: "zz"),
                        entry("7", "2026-10-29T02:00:00Z", title: "a")]
            let sections = MemoCards.sections(list, sort: .title, pinnedGroup: true, now: nowG, calendar: seoul)
            try equal(sections.map(\.group), [.pinned, .rest], "groups")
            try equal(sections.map(\.ids), [["6"], ["4", "3", "7", "5", "1", "2"]], "order (a tie: the newer edit first)")
            try equal(MemoCards.header(.rest, now: nowG, language: .en), "Notes", "rest header")
        }

        try test("D25 links: first with a host, trailing punctuation off, the chip and a title that is a link") {
            try equal(MemoCards.kind("배포\n- [ ] a\n- [x] b\nhttps://x.com"), .checklist(done: 1, total: 2), "checklist first")
            try equal(MemoCards.title("배포\n- [ ] a\n- [x] b\nhttps://x.com"), "배포", "checklist title")
            let tube = "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
            try equal(MemoCards.kind(tube), .link(url: tube, label: "youtube.com/watch"), "youtube")
            try equal(AppLanguage.allCases.map { MemoCards.title(tube, language: $0) }, ["youtube.com 링크", "youtube.com link", "youtube.com-link"], "title is a link")
            try equal(MemoCards.preview(tube), nil, "no preview")
            try equal(MemoCards.kind("영상 볼 것\nhttps://youtu.be/abc."), .link(url: "https://youtu.be/abc", label: "youtu.be/abc"), "trailing dot")
            try equal(MemoCards.title("영상 볼 것\nhttps://youtu.be/abc."), "영상 볼 것", "title as written")
            try equal(MemoCards.preview("영상 볼 것\nhttps://youtu.be/abc."), "https://youtu.be/abc.", "preview")
            try equal(MemoCards.kind("(see http://Example.com/a/b/?q=1)"), .link(url: "http://Example.com/a/b/?q=1", label: "example.com/a/b"), "parenthesis")
            try equal(MemoCards.kind("https://"), nil, "no host")
            try equal(MemoCards.kind("see https://?x"), nil, "no host 2")
            try equal(MemoCards.title("https://www.youtube.com/watch?v=1 영상"), "https://www.youtube.com/watch?v=1 영상", "a space: as written")
            try equal(MemoCards.kind("https://x.com\n010-1234-5678"), .link(url: "https://x.com", label: "x.com"), "link beats phone")
            try equal(MemoCards.title("https://x.com\n010-1234-5678"), "x.com 링크", "x.com 링크")
            try equal(MemoCards.preview("https://x.com\n010-1234-5678"), "010-1234-5678", "preview after a link title")
            try equal(MemoCards.preview("장보기\n- [ ] 우유\n\n  메모 끝"), "메모 끝", "checklist lines aren't the preview")
        }

        try test("D26 phone numbers (Korean, 9–11 digits from 0)") {
            try equal(MemoCards.kind("꽃집 전화 010 1234 5678"), .phone("010-1234-5678"), "spaces")
            try equal(["02-123-4567", "전화 02 1234 5678", "010.1234.5678", "연락: 01012345678", "031-123-4567"].map { MemoCards.phone(in: $0) },
                      ["02-123-4567", "02-1234-5678", "010-1234-5678", "010-1234-5678", "031-123-4567"], "forms")
            try equal(["123-4567", "010-123-456", "2026.10.27", "0101234567890", "1010-1234-5678"].map { MemoCards.phone(in: $0) }, [nil, nil, nil, nil, nil], "not phones")
        }

        try test("D27 체크한 줄 지우기; D28 고정 모두 풀기") {
            let list = "장보기\n- [ ] 우유\n- [ ] 빵\n  * [X] 계란\n-[ ] 아님\n- [ ]아님"
            try equal(Checklist.removeChecked(list), "장보기\n- [ ] 우유\n- [ ] 빵\n-[ ] 아님\n- [ ]아님", "ticked lines gone")
            try equal(Checklist.removeChecked("a\r\n- [x] b\r\nc"), "a\r\nc", "CRLF kept")
            try equal(Checklist.removeChecked("a\n- [ ] b"), "a\n- [ ] b", "nothing ticked")
            var f = folders
            try equal(f.unpinAll(now: now), ["m1"], "the pinned")
            try equal(f.placement["m1"], MemoFolders.Placement(folder: "work", pinned: false, at: now), "m1 let go")
            try equal(f.placement["m3"], folders.placement["m3"], "m3 unchanged")
        }

        try test("footer and bookmark words (1.44, the Windows app's)") {
            try equal(MemoFolders.footerShort(folder: "회사", count: 5), "회사 · 다섯 장", "footer")
            try equal(MemoFolders.footerShort(folder: "Work", count: 5, language: .en), "Work · 5 notes", "footer en")
            try equal(MemoFolders.footerShort(folder: "Werk", count: 0, language: .nl), "Nog niets in Werk", "empty keeps its sentence")
            try equal(MemoFolders.pinnedFooterShort(count: 3), "고정 · 세 장", "pinned")
            try equal(MemoFolders.pinnedFooterShort(count: 3, language: .nl), "Vastgezet · 3 notities", "pinned nl")
            try equal(MemoFolders.bookmarkLabel("장보기", count: 3, key: "⌘3"), "장보기 · 세 장 · ⌘3", "bookmark")
            try equal(MemoFolders.bookmarkLabel("Study", count: 0, key: nil, language: .en), "Study · empty", "empty, past the ninth")
        }

        try test("D29 folder delete words") {
            try equal(MemoFolders.movedToInbox(count: 2, inbox: "메모"), "메모 두 장은 ‘메모’ 폴더로 옮겼어요", "ko")
            try equal(MemoFolders.movedToInbox(count: 1, inbox: "Notes", language: .en), "1 note moved to ‘Notes’", "en one")
            try equal(MemoFolders.movedToInbox(count: 2, inbox: "Notities", language: .nl), "2 notities verplaatst naar ‘Notities’", "nl")
        }

        print("\(count) memo drawer checks passed")
    }
}
