import AppKit
import PaperCore

// MARK: - #168: several to-dos picked and moved at once (ListSelection in PaperCore)

/// The note already had one picked row — `selectedTaskID`, the keyboard's row (↑↓ · Space · Return · ⌫ · ⌘↑↓ · ⌥→ act
/// on it, a click picks it, Esc lets it go). This adds to that same pick rather than a second one: ⌘-click and ⇧-click
/// pick more, ⇧↑↓ grows the range, and `multiSelected` holds them all while there are several. Anything that picks a
/// row the plain way leaves only that one.
extension AppModel {
    /// The pick as it is now.
    var listSelection: ListSelection {
        let ids = multiSelected.isEmpty ? Set(selectedTaskID.map { [$0] } ?? []) : multiSelected
        return ListSelection(anchor: selectionAnchor ?? selectedTaskID, focus: selectedTaskID, ids: ids)
    }

    /// A pick written: its keyboard row, its anchor, and the others when there are several.
    func apply(_ selection: ListSelection) {
        applyingSelection = true
        defer { applyingSelection = false }
        selectionAnchor = selection.anchor
        multiSelected = selection.isMany ? selection.ids : []
        selectedTaskID = selection.ids.isEmpty ? nil : selection.focus
    }

    /// The rows as the keyboard walks them, on the page shown.
    private var pickOrder: [UUID] { keyboardRows.map(\.id) }

    /// A click on a row: ⌘ adds or takes it away, ⇧ picks the range from the anchor, else that row alone.
    func clickRow(_ id: UUID, modifiers: NSEvent.ModifierFlags) {
        var selection = listSelection
        let flags = modifiers.intersection([.command, .shift])
        if flags.contains(.command) { selection.toggle(id, order: pickOrder) }
        else if flags.contains(.shift) { selection.range(to: id, order: pickOrder) }
        else { selection.click(id) }
        apply(selection)
    }

    /// ⇧↑ · ⇧↓.
    func extendSelection(_ step: Int) {
        var selection = listSelection
        selection.extend(step, order: pickOrder)
        apply(selection)
    }

    /// What a row's action moves: every picked row when it's one of them, else the row alone — in the list's order.
    func pickedRows(including id: UUID) -> [UUID] {
        guard multiSelected.contains(id) else { return [id] }
        return pickOrder.filter { multiSelected.contains($0) }
    }

    /// The badge on a drag of several rows ("3개"), nil for one.
    func dragBadge(for id: UUID) -> String? {
        let rows = pickedRows(including: id)
        return rows.count > 1 ? SpaceWords.badge(rows.count, language: .current) : nil
    }

    /// The list in `order` (one undo step).
    func reorder(_ order: [UUID]) {
        mutate { $0.reorder(order) }
    }

    /// #168 (S47): to-dos to a space (nil: 일반) — the ones not there already — with one toast `3개를 집으로 옮겼어요 ·
    /// 되돌리기`, whose 되돌리기 puts every one back (and runs `alsoTakeBack`, the places of a drop between rows).
    func moveTodos(_ ids: [UUID], toSpace space: String?, toast: Bool = true, alsoTakeBack: (() -> Void)? = nil) {
        let moving = ids.filter { spaceIndex[$0]?.id != space }
        guard !moving.isEmpty else { return }
        let before = Dictionary(uniqueKeysWithValues: moving.map { ($0, todoSpaces.items[$0.uuidString]) })
        changeTodoSpaces { spaces, now in for id in moving { spaces.move(id.uuidString, to: space, now: now) } }
        guard toast else { return }
        let name = todoSpaces.space(space)?.name ?? generalName
        let putBack = { [weak self] in
            self?.changeTodoSpaces { spaces, now in
                for id in moving {
                    let was = (before[id] ?? nil)?.space.flatMap { spaces.space($0) != nil ? $0 : nil }
                    spaces.move(id.uuidString, to: was, now: now)
                }
            }
            alsoTakeBack?()
        }
        var shown = PaperToast(symbol: "square.stack", text: SpaceWords.moved(moving.count, to: name, language: .current))
        shown.action = L("되돌리기")
        shown.takeBack = putBack
        shown.perform = { [weak self] in
            putBack()
            self?.toast = nil
        }
        self.toast = shown
    }

    /// #168: several rows dropped on another group (its head, or between its rows: put there together, in the list's
    /// order) — or reordered inside their own group or the plain list (`key` nil).
    func dropTodos(_ ids: [UUID], toGroup key: String?, relativeTo target: UUID?, after: Bool) {
        let previous = items.map(\.id)
        if let target { reorder(SpaceGroups.movedBlock(previous, ids, relativeTo: target, after: after)) }
        guard let key else { return }
        let takeBack: (() -> Void)? = target == nil ? nil : { [weak self] in
            guard let self else { return }
            self.reorder(SpaceGroups.restored(self.items.map(\.id), ids, previous: previous))
        }
        moveTodos(ids, toSpace: SpaceGroups.space(key), alsoTakeBack: takeBack)
    }
}
