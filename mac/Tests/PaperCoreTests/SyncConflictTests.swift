import Foundation

// #385: the shared cases (shared/cases/sync-conflict-cases.json) — which names are a cloud's conflict copies, and joining
// two lists by item — plus the three files joined as bytes (todos · events · alarms). Made-up data only.
@main
private enum SyncConflictTests {
    static func main() throws {
        let path = CommandLine.arguments.dropFirst().first ?? "../shared/cases/sync-conflict-cases.json"
        let cases = try JSONSerialization.jsonObject(with: Data(contentsOf: URL(fileURLWithPath: path))) as! [String: Any]
        var failed = 0, passed = 0
        func check(_ ok: Bool, _ name: String) {
            if ok { passed += 1 } else { failed += 1; print("FAIL \(name)") }
        }

        let before = failed
        for item in cases["copies"] as! [[String: Any]] {
            let name = item["name"] as! String, expected = item["copyOf"] as? String
            let got = SyncConflict.copyOf(name)
            check(got == expected, "\(name) (\(item["why"] as! String)): \(got ?? "none"), not \(expected ?? "none")")
        }
        if failed == before { print("PASS \((cases["copies"] as! [Any]).count) names: iCloud Drive, Google Drive, Dropbox, OneDrive, and what isn't a copy") }

        for item in cases["merge"] as! [[String: Any]] {
            let name = item["name"] as! String
            let got = SyncConflict.merge(base: item["base"] as! [[String: Any]], here: item["here"] as! [[String: Any]],
                                         theirs: item["theirs"] as! [[String: Any]])
            let expected = item["expected"] as! [[String: Any]]
            let ok = SyncConflict.same(got, expected)
            check(ok, "\(name): \(String(data: try JSONSerialization.data(withJSONObject: got, options: [.sortedKeys]), encoding: .utf8)!)")
            if ok { print("PASS \(name)") }
        }

        // The three files as the app writes them: the items joined, everything else theirs.
        func joinedBytes(_ base: Data?, _ here: Data, _ theirs: Data, _ key: String) -> Data? {
            if case .joined(let data) = SyncConflict.join(base: base, here: here, theirs: theirs, key: key) { return data }
            return nil
        }
        let when = Date(timeIntervalSince1970: 1_793_000_000)
        var list = Notebook()
        let shopping = list.add("장보기")!.id
        let laundry = list.add("빨래")!.id
        let base = try NotebookFile.encode(list)
        var mine = list
        _ = mine.toggle(id: shopping)
        var theirs = list
        _ = theirs.edit(id: laundry, title: "빨래 개기")
        let added = theirs.add("공부")!.id
        let joined = try NotebookFile.decode(joinedBytes(base, try NotebookFile.encode(mine), try NotebookFile.encode(theirs), "items")!)
        check(joined.items.map(\.title) == ["장보기", "빨래 개기", "공부"] && joined.items[0].isCompleted && joined.items[2].id == added,
              "todos.json: ticked here, renamed and added there: \(joined.items.map(\.title))")
        let event = CalendarDraft(title: "회의", date: "2026-11-12", startMinutes: 600, endMinutes: 660).event(id: "e1", now: when)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        var moved = event
        moved.title = "회의 (3층)"
        let lunch = CalendarDraft(title: "점심", date: "2026-11-12", startMinutes: 720, endMinutes: 780).event(id: "e2", now: when)
        let events = try decoder.decode(LocalEvent.File.self, from: joinedBytes(
            try encoder.encode(LocalEvent.File(events: [event])), try encoder.encode(LocalEvent.File(events: [event, lunch])),
            try encoder.encode(LocalEvent.File(events: [moved])), "events")!)
        check(events.events.map(\.title) == ["회의 (3층)", "점심"], "events.json: added here, renamed there: \(events.events.map(\.title))")
        let alarm = Alarm(id: "w1", time: "07:00", label: "일어나기", createdAt: when)
        var later = alarm
        later.time = "07:30"
        let alarms = try Alarm.File.decode(joinedBytes(try Alarm.File(alarms: [alarm]).encoded(), try Alarm.File(alarms: [later]).encoded(),
                                                           try Alarm.File(alarms: []).encoded(), "alarms")!)
        check(alarms.alarms.map(\.time) == ["07:30"], "alarms.json: changed here, deleted there: kept (\(alarms.alarms.map(\.time)))")
        check(SyncConflict.join(base: nil, here: Data("{".utf8), theirs: base, key: "items") == nil, "a file that doesn't read isn't joined")
        // Nothing changed here since the file was last read: theirs as it is, as before #385 (formatting aside).
        let windows = Data(String(decoding: base, as: UTF8.self).replacingOccurrences(of: "\n", with: "").utf8)
        check(SyncConflict.join(base: windows, here: base, theirs: try NotebookFile.encode(theirs), key: "items") == .theirs,
              "unchanged here: theirs as it is")
        check(SyncConflict.join(base: base, here: try NotebookFile.encode(mine), theirs: try NotebookFile.encode(mine), key: "items") == .theirs,
              "theirs already has this device's change: theirs as it is")

        print(failed == 0 ? "\(passed) sync conflict checks passed" : "\(failed) of \(passed + failed) failed")
        if failed > 0 { exit(1) }
    }
}
