import Foundation

/// #385: what two devices writing the same shared folder leave behind, and how their lists are joined. The same rules as
/// the Windows app will use; the shared cases are shared/cases/sync-conflict-cases.json.
public enum SyncConflict {
    /// The storage folder's data files (a conflict copy of any of them is noticed).
    public static let dataFiles = ["todos.json", "repeats.json", "events.json", "alarms.json", "memos.json", "memo-folders.json",
                                   "memo-trash.json", "todo-spaces.json"]

    /// The data file `name` is a cloud's conflict copy of, nil when it is none:
    /// - iCloud Drive: `todos 2.json`
    /// - Google Drive: `todos (1).json`
    /// - Dropbox: `todos (Minji's MacBook conflicted copy 2026-11-11).json`, `todos (… 충돌 사본 …).json`
    /// - OneDrive: `todos-MINJI-PC.json` (the device's name after a hyphen)
    public static func copyOf(_ name: String, files: [String] = dataFiles) -> String? {
        let lower = name.lowercased()
        // A data file itself is never a copy ("memo-folders.json" isn't OneDrive's copy of a "memo.json").
        guard lower.hasSuffix(".json"), !files.contains(where: { $0.lowercased() == lower }) else { return nil }
        let stem = String(name.dropLast(5))
        for file in files {
            let base = String(file.dropLast(5))
            guard stem.count > base.count, stem.lowercased().hasPrefix(base.lowercased()) else { continue }
            let rest = String(stem.dropFirst(base.count))
            if rest.range(of: #"^ [0-9]{1,3}$"#, options: .regularExpression) != nil { return file }
            if rest.range(of: #"^ \([0-9]{1,3}\)$"#, options: .regularExpression) != nil { return file }
            if rest.range(of: #"^ \(.*(conflicted copy|충돌).*\)$"#, options: [.regularExpression, .caseInsensitive]) != nil { return file }
            if rest.range(of: #"^-[A-Za-z0-9][A-Za-z0-9_-]{0,62}$"#, options: .regularExpression) != nil { return file }
        }
        return nil
    }

    /// The conflict copies in a folder's names, with the file each is a copy of.
    public static func copies(in names: [String]) -> [(name: String, of: String)] {
        names.sorted().compactMap { name in copyOf(name).map { (name, $0) } }
    }

    // MARK: Joining two lists by item

    /// Three lists of items (JSON objects with an "id"): `base` as this device last read or wrote the file, `here` as it
    /// is now, `theirs` as another device left it. Field by field, the side that changed a field from `base` wins; when
    /// both changed it, this device's. An item one side changed and the other deleted stays (an edit is never lost to a
    /// delete); one side deleted and the other left as it was goes. Items new on either side stay. The order is theirs,
    /// and an item only here goes right after the item it followed here.
    public static func merge(base: [[String: Any]], here: [[String: Any]], theirs: [[String: Any]]) -> [[String: Any]] {
        func byID(_ list: [[String: Any]]) -> [String: [String: Any]] {
            var out: [String: [String: Any]] = [:]
            for item in list { if let id = item["id"] as? String, out[id] == nil { out[id] = item } }
            return out
        }
        let start = byID(base), mine = byID(here), other = byID(theirs)
        var result: [[String: Any]] = []
        var placed = Set<String>()
        for item in theirs {
            guard let id = item["id"] as? String, !placed.contains(id) else { continue }
            if let own = mine[id] {
                result.append(fields(base: start[id], here: own, theirs: item))
            } else if let was = start[id], same(was, item) {
                continue // deleted here, untouched there
            } else {
                result.append(item) // new there, or changed there and deleted here
            }
            placed.insert(id)
        }
        // What is only here: new here, or changed here and deleted there (deleted there and untouched here goes).
        var after: String?
        for item in here {
            guard let id = item["id"] as? String else { continue }
            defer { if placed.contains(id) { after = id } }
            guard !placed.contains(id), other[id] == nil else { continue }
            if let was = start[id], same(was, item) { continue }
            let index = after.flatMap { previous in result.firstIndex { ($0["id"] as? String) == previous } }.map { $0 + 1 } ?? 0
            result.insert(item, at: index)
            placed.insert(id)
        }
        return result
    }

    /// One item both sides have: each field from the side that changed it.
    private static func fields(base: [String: Any]?, here: [String: Any], theirs: [String: Any]) -> [String: Any] {
        var out: [String: Any] = [:]
        for key in Set(here.keys).union(theirs.keys).union(base?.keys ?? [String: Any]().keys) {
            let was = base?[key], mine = here[key], their = theirs[key]
            let pick = base != nil && same(mine, was) ? their : mine
            if let pick, !(pick is NSNull) { out[key] = pick }
        }
        return out
    }

    /// JSON values as equal (keys in any order; a missing field and null are the same).
    static func same(_ a: Any?, _ b: Any?) -> Bool {
        let a = a is NSNull ? nil : a, b = b is NSNull ? nil : b
        switch (a, b) {
        case (nil, nil): return true
        case (nil, _), (_, nil): return false
        case let (x as [String: Any], y as [String: Any]):
            return Set(x.keys).union(y.keys).allSatisfy { same(x[$0], y[$0]) }
        case let (x as [Any], y as [Any]):
            return x.count == y.count && zip(x, y).allSatisfy { same($0, $1) }
        case let (x as NSObject, y as NSObject):
            return x.isEqual(y)
        default:
            return false
        }
    }

    /// What joining a file another device wrote gives.
    public enum Joined: Equatable {
        /// Their file as it is: nothing was changed here since `base` (as before #385), or the join is theirs anyway.
        case theirs
        /// Theirs with this device's changes in: to take in and write back.
        case joined(Data)
    }

    /// `merge` for a file `{ "<key>": [items], … }` as bytes (`base`: as this device last read or wrote it; `here`: what it
    /// holds now, as it would write it). The other fields are theirs. nil when `here` or `theirs` doesn't read.
    public static func join(base: Data?, here: Data, theirs: Data, key: String) -> Joined? {
        func object(_ data: Data?) -> [String: Any]? {
            data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
        }
        guard let mine = object(here), let other = object(theirs),
              let hereItems = mine[key] as? [[String: Any]], let theirItems = other[key] as? [[String: Any]] else { return nil }
        let baseItems = object(base)?[key] as? [[String: Any]]
        if let baseItems, same(baseItems, hereItems) { return .theirs }
        let merged = merge(base: baseItems ?? [], here: hereItems, theirs: theirItems)
        if same(merged, theirItems) { return .theirs }
        var out = other
        out[key] = merged
        return (try? JSONSerialization.data(withJSONObject: out, options: [.sortedKeys])).map { .joined($0) }
    }
}
