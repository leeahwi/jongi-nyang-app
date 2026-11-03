import Foundation

/// #168: the rows picked on 오늘 — one (the keyboard's row, as before) or several. A click picks one; ⌘-click (Windows
/// Ctrl-click) adds or takes away one; ⇧-click picks the range from the anchor to it; ⇧↑↓ grows or shrinks that range
/// from the anchor; Esc lets them all go. `order` is the rows as shown, top to bottom. The same rules and cases (S46,
/// spaces-cases.json `multi`) as the Windows app (selection.ts).
public struct ListSelection: Equatable, Sendable {
    /// Where a range starts (the last row clicked or ⌘-clicked).
    public var anchor: UUID?
    /// The keyboard's row (↑↓ go on from it; the one that's tinted and scrolled to).
    public var focus: UUID?
    /// Every picked row (the focus too); empty when none.
    public var ids: Set<UUID>

    public init(anchor: UUID? = nil, focus: UUID? = nil, ids: Set<UUID> = []) {
        self.anchor = anchor
        self.focus = focus
        self.ids = ids
    }

    /// One row picked (or none).
    public static func one(_ id: UUID?) -> ListSelection {
        ListSelection(anchor: id, focus: id, ids: id.map { [$0] } ?? [])
    }

    /// More than one row picked.
    public var isMany: Bool { ids.count > 1 }

    /// The picked rows in `order`.
    public func ordered(_ order: [UUID]) -> [UUID] { order.filter { ids.contains($0) } }

    /// A plain click.
    public mutating func click(_ id: UUID) { self = .one(id) }

    /// ⌘-click: in or out; the clicked row becomes the anchor, and the focus when it went in (else the first picked row
    /// left, in `order`).
    public mutating func toggle(_ id: UUID, order: [UUID]) {
        anchor = id
        if ids.contains(id) {
            ids.remove(id)
            focus = order.first { ids.contains($0) }
        } else {
            ids.insert(id)
            focus = id
        }
    }

    /// ⇧-click: the rows from the anchor to `id` (a plain click with no anchor).
    public mutating func range(to id: UUID, order: [UUID]) {
        guard let anchor, let from = order.firstIndex(of: anchor), let to = order.firstIndex(of: id) else { return click(id) }
        ids = Set(order[min(from, to)...max(from, to)])
        focus = id
    }

    /// ⇧↑ (−1) · ⇧↓ (+1): the focus a row further, the rows from the anchor to it picked. With nothing picked, the first
    /// row (↓) or the last (↑).
    public mutating func extend(_ step: Int, order: [UUID]) {
        guard !order.isEmpty else { return }
        guard let focus, let index = order.firstIndex(of: focus) else { return click(step > 0 ? order[0] : order[order.count - 1]) }
        let next = order[max(0, min(order.count - 1, index + step))]
        if anchor == nil || !order.contains(anchor!) { anchor = focus }
        range(to: next, order: order)
    }

    /// Esc: none.
    public mutating func clear() { self = ListSelection() }

    /// Rows that are no longer shown let go (a fold, the lens, a delete).
    public func kept(_ order: [UUID]) -> ListSelection {
        let shown = Set(order)
        var out = self
        out.ids = ids.intersection(shown)
        if let focus, !shown.contains(focus) { out.focus = order.first { out.ids.contains($0) } }
        if let anchor, !shown.contains(anchor) { out.anchor = out.focus }
        return out
    }
}

extension SpaceGroups {
    /// #168 (S47): `ids` put together before (or after) `target`, in the list's order — a drag of several rows. Nothing
    /// when the target is one of them.
    public static func movedBlock(_ order: [UUID], _ ids: [UUID], relativeTo target: UUID, after: Bool) -> [UUID] {
        let moving = Set(ids)
        guard !moving.contains(target) else { return order }
        let block = order.filter { moving.contains($0) }
        var out = order.filter { !moving.contains($0) }
        guard let at = out.firstIndex(of: target) else { return order }
        out.insert(contentsOf: block, at: at + (after ? 1 : 0))
        return out
    }

    /// #168 (S47): 되돌리기 of a block move — each of `ids` back after the row it followed in `previous` (rows added or
    /// gone since are left as they are).
    public static func restored(_ order: [UUID], _ ids: [UUID], previous: [UUID]) -> [UUID] {
        let moving = Set(ids).intersection(order)
        var out = order.filter { !moving.contains($0) }
        var placed = Set(out)
        for (index, id) in previous.enumerated() where moving.contains(id) {
            let anchor = previous[..<index].reversed().first { placed.contains($0) }
            out.insert(id, at: anchor.flatMap { out.firstIndex(of: $0) }.map { $0 + 1 } ?? 0)
            placed.insert(id)
        }
        return out
    }

    /// #168 (S48): ⌥⌘↑ · ⌥⌘↓ with several rows picked — the group above or below the focused row's; every picked row
    /// goes there. Nil at the ends.
    public static func neighbor(of selection: ListSelection, step: Int, in groups: [Group]) -> String? {
        guard let focus = selection.focus else { return nil }
        return neighbor(of: focus, step: step, in: groups)
    }
}

extension SpaceWords {
    /// #168: "3개를 집으로 옮겼어요" · "Moved 3 to Home" · "3 verplaatst naar Thuis" (one: as `moved(to:)`).
    public static func moved(_ count: Int, to name: String, language: AppLanguage = .ko) -> String {
        guard count > 1 else { return moved(to: name, language: language) }
        let n = grouped(count, language)
        switch language {
        case .ko: return "\(n)개를 \(name)\(ro(name)) 옮겼어요"
        case .en: return "Moved \(n) to \(name)"
        case .nl: return "\(n) verplaatst naar \(name)"
        }
    }

    /// #168: the badge on a drag of several rows: "3개" · "3" · "3".
    public static func badge(_ count: Int, language: AppLanguage = .ko) -> String {
        let n = grouped(count, language)
        return language == .ko ? "\(n)개" : n
    }
}
