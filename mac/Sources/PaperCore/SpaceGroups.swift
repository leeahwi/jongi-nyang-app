import Foundation

/// 2b 스페이스별로 묶기 (docs/plans/spaces-phase2.md): 오늘's list in one group per space — the desk's order, 일반 last, no
/// empty group, only the lens's group while one space shows. In a group: the rows with a time today (by time), the rest
/// (in the list's order), then the finished ones. The same rules and cases (S39–S44, spaces-cases.json `groups`) as the
/// Windows app (spaceGroups.ts).
public enum SpaceGroups {
    /// 일반's key wherever a group is named by a string (the device's folded groups, the cases): the lens's `none`.
    public static let general = SpaceLens.none

    public struct Group: Equatable, Sendable, Identifiable {
        /// The space's id; nil: 일반.
        public var space: String?
        /// Open rows with a time today, by time (then the list's order).
        public var timed: [UUID]
        /// The other open rows, in the list's order.
        public var rest: [UUID]
        /// Finished rows, in the list's order.
        public var done: [UUID]
        /// The soonest time still ahead (a row going on now isn't 다음) — E's `다음 13:43`.
        public var next: Date?
        /// When the timed rows are due.
        public var times: [UUID: Date]

        /// The space's id, or `none` for 일반.
        public var id: String { space ?? SpaceGroups.general }
        public var items: [UUID] { timed + rest + done }
        public var open: Int { timed.count + rest.count }
        public var count: Int { timed.count + rest.count + done.count }
    }

    /// The groups as shown. `items`: the rows shown (finished ones too, unless hidden), in the list's order; `spaceOf`:
    /// a row's live space (nil: 일반).
    public static func groups(_ items: [TodoItem], series: [Series] = [], spaces: TodoSpaces, shown: SpaceLens.Shown = .all,
                              now: Date, calendar: Calendar = .paper, spaceOf: (UUID) -> String?) -> [Group] {
        let times = TodayGroups.times(items, series: series, now: now, calendar: calendar)
        let order = Dictionary(uniqueKeysWithValues: items.enumerated().map { ($1.id, $0) })
        var byKey: [String: Group] = [:]
        for item in items {
            let space = spaceOf(item.id).flatMap { spaces.space($0) != nil ? $0 : nil }
            guard shown.includes(space) else { continue }
            let key = space ?? general
            var group = byKey[key] ?? Group(space: space, timed: [], rest: [], done: [], next: nil, times: [:])
            if item.isCompleted { group.done.append(item.id) }
            else if let at = times[item.id] {
                group.timed.append(item.id)
                group.times[item.id] = at
                if at > now, group.next.map({ at < $0 }) ?? true { group.next = at }
            } else { group.rest.append(item.id) }
            byKey[key] = group
        }
        for (key, var group) in byKey where group.timed.count > 1 {
            group.timed.sort { (group.times[$0]!, order[$0]!) < (group.times[$1]!, order[$1]!) }
            byKey[key] = group
        }
        return (spaces.visible.map(\.id) + [general]).compactMap { byKey[$0] }
    }

    /// S44: ⌥⌘↑ (-1) · ⌥⌘↓ (+1) on a row — the group above or below among those shown (`none`: 일반); nil: none there
    /// (the top or bottom one, or one space shown alone).
    public static func neighbor(of id: UUID, step: Int, in groups: [Group]) -> String? {
        guard let index = groups.firstIndex(where: { $0.items.contains(id) }), groups.indices.contains(index + step) else { return nil }
        return groups[index + step].id
    }

    // MARK: I · 넓은 노트는 칸으로 (S45)

    /// The narrowest a column may be; the gap between columns and the margin at each side.
    public static let columnWidth = 220.0
    public static let columnGap = 10.0
    public static let boardMargin = 14.0
    /// While grouped, the note may be this wide (it stays 720 otherwise).
    public static let wideNote = 1_200.0
    public static let narrowNote = 720.0

    /// S45: the groups stand side by side on a wide note (720 and more) only when every column gets 220 (count × 220
    /// + the gaps + the margins fit the note's width); else the chosen look (메모지 · 책갈피). Columns never scroll
    /// sideways.
    public static func boardFits(width: Double, count: Int) -> Bool {
        guard count > 0, width >= narrowNote else { return false }
        return Double(count) * columnWidth + Double(count - 1) * columnGap + boardMargin * 2 <= width
    }

    /// A group's key as the space it moves a to-do to: nil for 일반.
    public static func space(_ key: String) -> String? { key == general ? nil : key }

    /// S43: where a dragged row was in the whole list, for 되돌리기 — the row before it (after: true), or the one after it
    /// when it was first; nil when it's alone.
    public static func returnPoint(of id: UUID, in order: [UUID]) -> (target: UUID, after: Bool)? {
        guard let index = order.firstIndex(of: id) else { return nil }
        if index > 0 { return (order[index - 1], true) }
        return order.count > 1 ? (order[1], false) : nil
    }

    /// The list's order with `id` put before (or after) `target` — as the list's own move does.
    public static func moved(_ order: [UUID], _ id: UUID, relativeTo target: UUID, after: Bool) -> [UUID] {
        guard id != target, let from = order.firstIndex(of: id) else { return order }
        var out = order
        out.remove(at: from)
        guard let to = out.firstIndex(of: target) else { return order }
        out.insert(id, at: to + (after ? 1 : 0))
        return out
    }
}

/// 2b's words (ko · en · nl), as the Windows app's i18n tables have them.
public enum SpaceGroupWords {
    /// F's head: "2개 남음" · "2 left" · "nog 2".
    public static func left(_ count: Int, language: AppLanguage = .ko) -> String {
        let n = SpaceWords.grouped(count, language)
        return ["\(n)개 남음", "\(n) left", "nog \(n)"][language.index]
    }

    /// E's head: "다음 13:43" · "Next 13:43" · "Volgende 13:43" (`time` as the app writes times).
    public static func next(_ time: String, language: AppLanguage = .ko) -> String {
        ["다음 \(time)", "Next \(time)", "Volgende \(time)"][language.index]
    }

    /// F's folded finished rows: "끝낸 1" · "1 done" · "1 klaar".
    public static func done(_ count: Int, language: AppLanguage = .ko) -> String {
        let n = SpaceWords.grouped(count, language)
        return ["끝낸 \(n)", "\(n) done", "\(n) klaar"][language.index]
    }

    /// The drop's hint on the group under a dragged row: "여기 놓으면 집으로 옮겨요".
    public static func dropHere(_ name: String, language: AppLanguage = .ko) -> String {
        ["여기 놓으면 \(name)\(SpaceWords.ro(name)) 옮겨요", "Drop to move to \(name)", "Naar \(name) verplaatsen"][language.index]
    }

    /// A board column's foot: "+ 회사에 넣기" · "+ Add to Work" · "+ Toevoegen aan Werk".
    public static func addTo(_ name: String, language: AppLanguage = .ko) -> String {
        ["+ \(name)에 넣기", "+ Add to \(name)", "+ Toevoegen aan \(name)"][language.index]
    }
}
