import AppKit
import PaperCore
import SwiftUI

// MARK: - 2b 스페이스별로 묶기 (docs/plans/spaces-phase2.md, SpaceGroups in PaperCore)

/// The groups' look, this Mac's: F 메모지 (the default) or E 책갈피.
enum SpaceGroupStyle: String, CaseIterable, Identifiable {
    case card, bookmark

    var id: String { rawValue }
    var title: String { self == .card ? L("메모지") : L("책갈피") }
}

extension AppModel {
    /// 오늘's list in groups: turned on here, with a space to group by (none: as before, nothing added).
    var showsSpaceGroups: Bool { groupBySpace && !todoSpaces.isEmpty }

    /// The groups of the rows shown now (S39–S42).
    func spaceGroups(now: Date = Date()) -> [SpaceGroups.Group] {
        let index = spaceIndex
        return SpaceGroups.groups(visibleItems, series: series, spaces: todoSpaces, shown: spaceShown, now: now) { index[$0]?.id }
    }

    /// A group's name: its space's, or 일반's.
    func groupName(_ group: SpaceGroups.Group) -> String { todoSpaces.space(group.space)?.name ?? generalName }

    /// The rows a group shows: none while folded; F keeps the finished ones under `끝낸 N` until opened.
    func shownRows(_ group: SpaceGroups.Group) -> [UUID] {
        // I: a column shows every row, its finished ones at the foot (columns don't fold).
        if spaceBoardShown { return group.items }
        if foldedGroups.contains(group.id) { return [] }
        if groupStyle == .card && !openDoneGroups.contains(group.id) { return group.timed + group.rest }
        return group.items
    }

    /// ↑↓'s order while grouped: group after group, the folded rows left out.
    func groupedDisplayOrder(_ visible: [TodoItem]) -> [TodoItem] {
        let byID = Dictionary(uniqueKeysWithValues: visible.map { ($0.id, $0) })
        return spaceGroups().flatMap(shownRows).compactMap { byID[$0] }
    }

    /// ‘스페이스별로 묶기’ on or off (the header's menu, 보기 → 스페이스 ⌥⌘G, 책상 → 스페이스).
    func toggleGroupBySpace() {
        var instant = Transaction()
        instant.disablesAnimations = true
        withTransaction(instant) { groupBySpace.toggle() }
    }

    /// A group's head clicked: that space alone (as ⌥⌘1–9); clicked again while it's alone, everything.
    func showGroupAlone(_ group: SpaceGroups.Group) {
        let alone: SpaceLens.Shown = group.space.map { .space($0) } ?? .noSpace
        showSpace(spaceShown == alone ? .all : alone)
    }

    /// ⌥⌘↑ · ⌥⌘↓ (S44): the row to the group above or below, with the move's toast; nothing at the ends.
    func moveToNeighborGroup(_ id: UUID, step: Int) {
        guard let key = SpaceGroups.neighbor(of: id, step: step, in: spaceGroups()) else { return }
        // #168 (S48): every picked row goes, and stays picked.
        let selection = listSelection
        moveTodos(pickedRows(including: id), toSpace: SpaceGroups.space(key))
        apply(selection)
    }

    /// J (S43): a row dropped on another group — on its head (`relativeTo` nil) or between its rows. It moves there with
    /// the toast `집으로 옮겼어요 · 되돌리기`, whose 되돌리기 puts back its space and its place in the list.
    func dropTodo(_ id: UUID, toGroup key: String, relativeTo target: UUID?, after: Bool) {
        let back = target == nil ? nil : SpaceGroups.returnPoint(of: id, in: items.map(\.id))
        if let target { move(id, relativeTo: target, after: after) }
        moveTodo(id, toSpace: SpaceGroups.space(key), alsoTakeBack: back.map { back in { [weak self] in self?.move(id, relativeTo: back.target, after: back.after) } })
    }

    /// ⌄ on a group's head: folded to its head and count, or open again (this Mac remembers, per space).
    func toggleFold(_ key: String) {
        if foldedGroups.contains(key) { markUnfolding(key); foldedGroups.remove(key) } else { foldedGroups.insert(key) }
    }

    /// A shortcut chip: that group opened (when folded) and scrolled to.
    func revealGroup(_ key: String) {
        if foldedGroups.contains(key) { markUnfolding(key) }
        foldedGroups.remove(key)
        groupToReveal = key
    }

    /// I: a column's `+ 회사에 넣기` — the input line, writing into that group.
    func writeInGroup(_ key: String) {
        lineSpace = SpaceGroups.space(key).map { .space($0) } ?? .noSpace
        focusNewTask()
    }
}

// MARK: - I · 넓은 노트는 칸으로

/// A wide note while grouped, when every column gets 220 pt (S45, `SpaceGroups.boardFits`; the note goes up to 1,200
/// then): one column per group — a 4 pt band of its colour on top, its name and count (no ⌄), its rows (the finished
/// ones at the foot, the time on a small line under the title), `+ 회사에 넣기`. The columns share the width; they
/// don't scroll sideways. A row dragged to another column moves there (J).
struct SpaceBoard: View {
    @ObservedObject var model: AppModel
    @ObservedObject var drag: SpaceGroupDrag
    @Binding var rowDrop: TaskRowDrop?
    let groups: [SpaceGroups.Group]
    let byID: [UUID: TodoItem]
    let shared: TaskRowShared

    /// Whether `groups` stand side by side in a note this wide.
    static func fits(width: CGFloat, count: Int) -> Bool { SpaceGroups.boardFits(width: Double(width), count: count) }

    var body: some View {
        GeometryReader { geometry in
            let rowGroups = Dictionary(uniqueKeysWithValues: groups.flatMap { group in group.items.map { ($0, group.id) } })
            HStack(alignment: .top, spacing: SpaceGroups.columnGap) {
                ForEach(groups) { group in
                    SpaceColumn(model: model, drag: drag, rowDrop: $rowDrop, group: group, byID: byID, shared: shared, rowGroups: rowGroups)
                        .frame(maxWidth: .infinity)
                        .frame(height: max(160, geometry.size.height - 14))
                }
            }
            .padding(.horizontal, SpaceGroups.boardMargin)
            .padding(.top, 8)
            .padding(.bottom, 6)
            .onPreferenceChange(SpaceGroupFramesKey.self) { drag.groupFrames = $0 }
            .onPreferenceChange(SpaceRowFramesKey.self) { drag.rowFrames = $0 }
        }
    }
}

/// One column of the board.
struct SpaceColumn: View {
    @ObservedObject var model: AppModel
    @ObservedObject var drag: SpaceGroupDrag
    @Binding var rowDrop: TaskRowDrop?
    let group: SpaceGroups.Group
    let byID: [UUID: TodoItem]
    let shared: TaskRowShared
    let rowGroups: [UUID: String]

    var body: some View {
        let space = model.todoSpaces.space(group.space)
        let name = model.groupName(group)
        let color = space.map { PaperTheme.space($0.colorKey) }
        let lit = drag.target == group.id
        let rows = group.items.compactMap { byID[$0] }
        let reorder = group.items.filter { group.times[$0] == nil }
        let dragging = drag.source != nil
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        VStack(spacing: 0) {
            Rectangle().fill(color ?? PaperTheme.faint.opacity(0.55)).frame(height: 4)
            HStack(spacing: 6) {
                // J: in a narrow column the words take the head (they say the name).
                if lit {
                    SpaceDropHint(name: name)
                    Spacer(minLength: 0)
                } else {
                    Button { model.showGroupAlone(group) } label: {
                        Text(name)
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundStyle(PaperTheme.ink)
                            .lineLimit(1)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help(SpaceWords.only(name, language: .current))
                    .layoutPriority(1)
                    Spacer(minLength: 4)
                    Text(SpaceWords.grouped(group.open, .current))
                        .font(.system(size: 11).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink3)
                }
            }
            .padding(.horizontal, 12)
            .frame(height: 34)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            .accessibilityLabel(name + ", " + SpaceGroupWords.left(group.open, language: .current))
            ScrollView(.vertical) {
                LazyVStack(spacing: 0) {
                    ForEach(rows) { item in
                        TaskRow(item: item, model: model, rowDrop: $rowDrop, ruled: item.id != rows.last?.id,
                                nextTime: group.times[item.id], groupRows: reorder, shared: shared, style: .inset,
                                onDragPoint: { point in drag.place(item.id, at: point, from: group.id, rowGroups: rowGroups, into: $rowDrop) },
                                onDragEnd: { accepted in dropped(item.id, accepted: accepted) }, band: false, metaBelow: true)
                            .padding(.horizontal, 4)
                            .opacity(drag.source == item.id ? 0.55 : 1)
                            .groupFrame(dragging, group: group.id, row: item.id)
                            .id(item.id)
                    }
                    Button { model.writeInGroup(group.id) } label: {
                        Text(SpaceGroupWords.addTo(name, language: .current))
                            .font(.system(size: 11))
                            .foregroundStyle(PaperTheme.ink3)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
                            .padding(.leading, 12)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .help(SpaceGroupWords.addTo(name, language: .current))
                }
            }
            .scrollIndicators(.never)
        }
        .background {
            shape.fill(PaperTheme.card)
            if lit { shape.fill((color ?? PaperTheme.ink3).opacity(0.10)) }
        }
        .clipShape(shape)
        .overlay { shape.strokeBorder(lit ? (color ?? PaperTheme.ink3) : PaperTheme.rule, lineWidth: lit ? 1.5 : 1) }
        .groupFrame(dragging, group: group.id)
    }

    private func dropped(_ id: UUID, accepted: Bool) {
        let target = drag.target, place = rowDrop
        drag.ended()
        rowDrop = nil
        guard accepted else { return }
        // #168: a picked row takes every picked row with it.
        if model.multiSelected.contains(id) {
            if target != nil || place != nil {
                model.dropTodos(model.pickedRows(including: id), toGroup: target, relativeTo: place?.target, after: place?.after ?? false)
            }
        } else if let target {
            model.dropTodo(id, toGroup: target, relativeTo: place?.target, after: place?.after ?? false)
        } else if let place {
            model.move(place.source, relativeTo: place.target, after: place.after)
        }
    }
}

/// J: a row being dragged over the groups — where it would go (another group, maybe between two of its rows), and the
/// frames it's measured against (reported only while a drag is on).
@MainActor
final class SpaceGroupDrag: ObservableObject {
    @Published var source: UUID?
    /// Another group under the pointer (nil: its own group, or nowhere).
    @Published var target: String?
    var groupFrames: [String: CGRect] = [:]
    var rowFrames: [UUID: CGRect] = [:]

    /// Snapshots: a drag drawn as if under way onto `target`.
    func preview(_ source: UUID, onto target: String) {
        self.source = source
        self.target = target
    }

    /// The pointer moved: the group under it and, over a row, the place before or after that row.
    func moved(_ id: UUID, to point: CGPoint, from group: String, rowGroups: [UUID: String]) -> TaskRowDrop? {
        if source == nil { source = id }
        if let over = rowFrames.first(where: { $0.key != id && $0.value.contains(point) }), let key = rowGroups[over.key] {
            let next: String? = key == group ? nil : key
            if target != next { target = next }
            return TaskRowDrop(source: id, target: over.key, after: point.y > over.value.midY)
        }
        let key = groupFrames.first { $0.value.contains(point) }?.key
        let next: String? = key == group ? nil : key
        if target != next { target = next }
        return nil
    }

    /// #167: a move's place written only when it changed (each write drew the whole sheet again).
    func place(_ id: UUID, at point: CGPoint, from group: String, rowGroups: [UUID: String], into rowDrop: Binding<TaskRowDrop?>) {
        let place = moved(id, to: point, from: group, rowGroups: rowGroups)
        if place != rowDrop.wrappedValue { rowDrop.wrappedValue = place }
    }

    func ended() {
        source = nil
        target = nil
        groupFrames = [:]
        rowFrames = [:]
    }
}

struct SpaceGroupFramesKey: PreferenceKey {
    static let defaultValue: [String: CGRect] = [:]
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue()) { $0.union($1) }
    }
}

struct SpaceRowFramesKey: PreferenceKey {
    static let defaultValue: [UUID: CGRect] = [:]
    static func reduce(value: inout [UUID: CGRect], nextValue: () -> [UUID: CGRect]) {
        value.merge(nextValue()) { $1 }
    }
}

extension View {
    /// While a drag is on: this element's frame as part of its group (and as a row).
    @ViewBuilder func groupFrame(_ on: Bool, group: String, row: UUID? = nil) -> some View {
        if on {
            background {
                GeometryReader { geometry in
                    let frame = geometry.frame(in: .global)
                    Color.clear
                        .preference(key: SpaceGroupFramesKey.self, value: [group: frame])
                        .preference(key: SpaceRowFramesKey.self, value: row.map { [$0: frame] } ?? [:])
                }
            }
        } else {
            self
        }
    }
}

// MARK: - The list

/// 오늘's rows in groups (F or E): each group's head and rows as the lazy list's own elements, so only what is on
/// screen is built (a card is drawn slice by slice: its head, each row, its foot).
struct SpaceGroupRows: View {
    @ObservedObject var model: AppModel
    @ObservedObject var drag: SpaceGroupDrag
    @Binding var rowDrop: TaskRowDrop?
    let groups: [SpaceGroups.Group]
    let byID: [UUID: TodoItem]
    let marks: [String: DayStrip.Mode]
    let shared: TaskRowShared
    var now: Date = Date()

    var body: some View {
        let card = model.groupStyle == .card
        let shown = Dictionary(uniqueKeysWithValues: groups.map { ($0.id, model.shownRows($0)) })
        let firstID = groups.first.flatMap { shown[$0.id]?.first }
        let lastID = groups.last.flatMap { shown[$0.id]?.last }
        let rowGroups = Dictionary(uniqueKeysWithValues: groups.flatMap { group in group.items.map { ($0, group.id) } })
        let dragging = drag.source != nil
        ForEach(groups) { group in
            let ids = shown[group.id] ?? []
            let rows = ids.compactMap { byID[$0] }
            let folded = model.foldedGroups.contains(group.id)
            let doneFold = card && !folded && !group.done.isEmpty
            let space = model.todoSpaces.space(group.space)
            let lit = drag.target == group.id
            let reorder = ids.filter { group.times[$0] == nil }
            Group {
                Group {
                    if card {
                        SpaceCardHead(model: model, group: group, space: space, folded: folded, dropHint: lit)
                            .cardSlice(top: true, bottom: rows.isEmpty && !doneFold, tape: space, first: group.id == groups.first?.id, lit: lit ? space : nil, litGeneral: lit && space == nil)
                    } else {
                        SpaceBookmarkHead(model: model, group: group, space: space, folded: folded, now: now, dropHint: lit)
                            .groupLit(lit, space: space)
                    }
                }
                .id("space-group-" + group.id)
                .groupFrame(dragging, group: group.id)
                ForEach(rows) { item in
                    let last = item.id == rows.last?.id && !doneFold
                    TaskRow(item: item, model: model, rowDrop: $rowDrop, ruled: !(card && last),
                            nextTime: group.times[item.id], stripMark: marks[item.id.uuidString], groupRows: reorder,
                            edges: RowEdges(item.id, first: firstID, last: lastID), shared: shared,
                            onDragPoint: { point in drag.place(item.id, at: point, from: group.id, rowGroups: rowGroups, into: $rowDrop) },
                            onDragEnd: { accepted in dropped(item.id, accepted: accepted) }, band: !card)
                        .opacity(drag.source == item.id ? 0.55 : 1)
                        .groupLit(!card && lit, space: space)
                        .cardSlice(card, bottom: last, lit: lit ? space : nil, litGeneral: lit && space == nil)
                        .groupFrame(dragging, group: group.id, row: item.id)
                        .modifier(UnfoldFade(active: model.unfoldingGroup == group.id))
                        .id(item.id)
                }
                if doneFold {
                    SpaceDoneFold(model: model, group: group)
                        .cardSlice(top: false, bottom: true, lit: lit ? space : nil, litGeneral: lit && space == nil)
                        .groupFrame(dragging, group: group.id)
                }
            }
        }
    }

    private func dropped(_ id: UUID, accepted: Bool) {
        let target = drag.target, place = rowDrop
        drag.ended()
        rowDrop = nil
        guard accepted else { return }
        // #168: a picked row takes every picked row with it.
        if model.multiSelected.contains(id) {
            if target != nil || place != nil {
                model.dropTodos(model.pickedRows(including: id), toGroup: target, relativeTo: place?.target, after: place?.after ?? false)
            }
        } else if let target {
            model.dropTodo(id, toGroup: target, relativeTo: place?.target, after: place?.after ?? false)
        } else if let place {
            model.move(place.source, relativeTo: place.target, after: place.after)
        }
    }
}

extension View {
    /// E: the group under a dragged row, lit in its space's colour.
    @ViewBuilder func groupLit(_ lit: Bool, space: TodoSpaces.Space?) -> some View {
        if lit {
            background((space.map { PaperTheme.space($0.colorKey) } ?? PaperTheme.ink3).opacity(0.10))
        } else {
            self
        }
    }
}

/// N12: a group's row that comes into view as the group opens fades in (바뀜); its place is there at once (no height
/// moves, so it costs the same whatever the group holds). Rows built later, by scrolling, just show.
private struct UnfoldFade: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var hidden: Bool

    init(active: Bool) { _hidden = State(initialValue: active) }

    func body(content: Content) -> some View {
        content
            .opacity(hidden ? 0 : 1)
            .onAppear {
                guard hidden else { return }
                withAnimation(Motion.animation(.change, reduce: reduceMotion)) { hidden = false }
            }
    }
}

/// ⌄ on a group's head: fold to the head and its count, or open. It turns with 바뀜 (N12).
struct SpaceFoldButton: View {
    @ObservedObject var model: AppModel
    let key: String
    let name: String
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let folded = model.foldedGroups.contains(key)
        Button { model.toggleFold(key) } label: {
            Image(systemName: "chevron.down")
                .font(.system(size: 9, weight: .bold))
                .rotationEffect(.degrees(folded ? -90 : 0))
                .animation(Motion.animation(.change, reduce: reduceMotion), value: folded)
                .foregroundStyle(PaperTheme.ink3)
                .frame(width: 22, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .help(folded ? L("펼치기") : L("접기"))
        .accessibilityLabel(name + " " + (folded ? L("펼치기") : L("접기")))
        .accessibilityValue(folded ? L("접힘") : L("펼침"))
    }
}

// MARK: - H · 바로 가기 칩

/// Under the title while grouped: `● 회사 2 · ● 집 2 · ● 공부 1 · 일반 1` (the open to-dos). A click scrolls to that group
/// (opening it when folded). One line: it scrolls sideways when the chips don't fit.
struct SpaceGroupChips: View {
    @ObservedObject var model: AppModel
    let groups: [SpaceGroups.Group]

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 6) {
                ForEach(groups) { group in
                    let space = model.todoSpaces.space(group.space)
                    let name = model.groupName(group)
                    Button { model.revealGroup(group.id) } label: {
                        HStack(spacing: 5) {
                            if let space {
                                RoundedRectangle(cornerRadius: 2).fill(PaperTheme.space(space.colorKey)).frame(width: 7, height: 7)
                            } else {
                                RoundedRectangle(cornerRadius: 2).strokeBorder(PaperTheme.ink3, lineWidth: 1).frame(width: 7, height: 7)
                            }
                            Text(name).lineLimit(1)
                            Text(SpaceWords.grouped(group.open, .current)).monospacedDigit().foregroundStyle(PaperTheme.ink3)
                        }
                        .font(.system(size: 11, weight: .medium))
                        .foregroundStyle(PaperTheme.ink2)
                        .padding(.horizontal, 8)
                        .frame(height: 22)
                        .fixedSize()
                        .background {
                            Capsule(style: .circular).fill(PaperTheme.card)
                                .overlay { Capsule(style: .circular).inset(by: 0.5).stroke(PaperTheme.rule, lineWidth: 1) }
                        }
                        .compositingGroup()
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(name + ", " + SpaceGroupWords.left(group.open, language: .current))
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 3)
        }
        .scrollIndicators(.never)
        .scrollBounceBehavior(.basedOnSize, axes: .horizontal)
        .frame(height: 28)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("스페이스 바로 가기"))
    }
}

// MARK: - F · 묶음 메모지

/// A card's slice: the card's paper, its 1 pt edge (the sides; the top's or the bottom's rounded corners when it's the
/// first or last slice), its tape (the head), and the 12 pt between cards.
private struct CardSlice: ViewModifier {
    let top: Bool
    let bottom: Bool
    var tape: TodoSpaces.Space??
    var first = false
    /// J: the card under a dragged row, lit in its space's colour (`litGeneral`: 일반's, in ink).
    var lit: TodoSpaces.Space?
    var litGeneral = false

    func body(content: Content) -> some View {
        let shape = UnevenRoundedRectangle(cornerRadii: .init(topLeading: top ? 10 : 0, bottomLeading: bottom ? 10 : 0,
                                                              bottomTrailing: bottom ? 10 : 0, topTrailing: top ? 10 : 0), style: .continuous)
        let glow: Color? = lit.map { PaperTheme.space($0.colorKey) } ?? (litGeneral ? PaperTheme.ink3 : nil)
        content
            .background {
                shape.fill(PaperTheme.card)
                if let glow { shape.fill(glow.opacity(0.10)) }
                CardEdge(top: top, bottom: bottom).stroke(glow ?? PaperTheme.rule, lineWidth: glow == nil ? 1 : 1.5)
            }
            .overlay(alignment: .top) {
                if let tape {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(tape.map { PaperTheme.space($0.colorKey) } ?? PaperTheme.faint.opacity(0.55))
                        .opacity(0.8)
                        .frame(width: 46, height: 11)
                        .offset(y: -6)
                        .accessibilityHidden(true)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, top ? (first ? 14 : 12) : 0)
            .padding(.bottom, bottom ? 2 : 0)
    }
}

/// The edge of a card's slice: both sides, and the rounded top or bottom when the slice has it.
struct CardEdge: Shape {
    let top: Bool
    let bottom: Bool
    var radius: CGFloat = 10

    func path(in rect: CGRect) -> Path {
        let r = rect.insetBy(dx: 0.5, dy: 0.5)
        var path = Path()
        if bottom {
            path.move(to: CGPoint(x: r.minX + radius, y: r.maxY))
            path.addArc(tangent1End: CGPoint(x: r.minX, y: r.maxY), tangent2End: CGPoint(x: r.minX, y: r.maxY - radius), radius: radius)
        } else {
            path.move(to: CGPoint(x: r.minX, y: rect.maxY))
        }
        if top {
            path.addArc(tangent1End: CGPoint(x: r.minX, y: r.minY), tangent2End: CGPoint(x: r.minX + radius, y: r.minY), radius: radius)
            path.addArc(tangent1End: CGPoint(x: r.maxX, y: r.minY), tangent2End: CGPoint(x: r.maxX, y: r.minY + radius), radius: radius)
        } else {
            path.addLine(to: CGPoint(x: r.minX, y: rect.minY))
            path.move(to: CGPoint(x: r.maxX, y: rect.minY))
        }
        if bottom {
            path.addArc(tangent1End: CGPoint(x: r.maxX, y: r.maxY), tangent2End: CGPoint(x: r.maxX - radius, y: r.maxY), radius: radius)
            path.addLine(to: CGPoint(x: r.minX + radius, y: r.maxY))
        } else {
            path.addLine(to: CGPoint(x: r.maxX, y: rect.maxY))
        }
        return path
    }
}

extension View {
    /// A slice of an F card (`on`: E draws plain rows).
    @ViewBuilder func cardSlice(_ on: Bool, bottom: Bool, lit: TodoSpaces.Space? = nil, litGeneral: Bool = false) -> some View {
        if on { modifier(CardSlice(top: false, bottom: bottom, lit: lit, litGeneral: litGeneral)) } else { self }
    }

    func cardSlice(top: Bool, bottom: Bool, tape: TodoSpaces.Space? = nil, first: Bool = false, lit: TodoSpaces.Space? = nil, litGeneral: Bool = false) -> some View {
        modifier(CardSlice(top: top, bottom: bottom, tape: top ? .some(tape) : nil, first: first, lit: lit, litGeneral: litGeneral))
    }
}

/// F's head: the ring (finished / all, in the space's colour), the name, `N개 남음`, ⌄. A click on it shows that space
/// alone.
struct SpaceCardHead: View {
    @ObservedObject var model: AppModel
    let group: SpaceGroups.Group
    let space: TodoSpaces.Space?
    let folded: Bool
    /// J: a row dragged over this group — `여기 놓으면 집으로 옮겨요` in place of `N개 남음`.
    var dropHint = false

    var body: some View {
        let name = model.groupName(group)
        HStack(spacing: 4) {
            Button { model.showGroupAlone(group) } label: {
                HStack(spacing: 8) {
                    SpaceRing(done: group.done.count, total: group.count, color: space.map { PaperTheme.space($0.colorKey) } ?? PaperTheme.ink3)
                    Text(name)
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(PaperTheme.ink)
                        .lineLimit(1)
                        .layoutPriority(1)
                    Spacer(minLength: 6)
                    if dropHint {
                        SpaceDropHint(name: name)
                    } else {
                        Text(SpaceGroupWords.left(group.open, language: .current))
                            .font(.system(size: 11).monospacedDigit())
                            .foregroundStyle(PaperTheme.ink3)
                            .lineLimit(1)
                            .fixedSize()
                    }
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(SpaceWords.only(name, language: .current))
            .accessibilityLabel(name + ", " + SpaceGroupWords.left(group.open, language: .current))
            .accessibilityHint(L("이 스페이스만 보기"))
            SpaceFoldButton(model: model, key: group.id, name: name)
        }
        .padding(.leading, 14)
        .padding(.trailing, 6)
        .frame(height: 38)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isHeader)
    }
}

/// J's words on the group under a dragged row.
struct SpaceDropHint: View {
    let name: String

    var body: some View {
        Text(SpaceGroupWords.dropHere(name, language: .current))
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(PaperTheme.ink)
            .lineLimit(1)
            .minimumScaleFactor(0.85)
    }
}

/// F's progress ring: finished of all, drawn in the space's colour on the rule colour.
struct SpaceRing: View {
    let done: Int
    let total: Int
    let color: Color
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle().stroke(PaperTheme.rule, lineWidth: 3)
            Circle()
                .trim(from: 0, to: total > 0 ? CGFloat(done) / CGFloat(total) : 0)
                .stroke(color, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
        // N17: fills with 그리기 as the donut does (Windows: the card ring's keyframe).
        .animation(Motion.animation(.draw, reduce: reduceMotion), value: total > 0 ? Double(done) / Double(total) : 0)
        .frame(width: 14, height: 14)
        .accessibilityHidden(true)
    }
}

/// F's `끝낸 N ⌄` at a card's foot: a click shows (or folds again) the finished rows, remembered here.
struct SpaceDoneFold: View {
    @ObservedObject var model: AppModel
    let group: SpaceGroups.Group
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let open = model.openDoneGroups.contains(group.id)
        Button {
            if open { model.openDoneGroups.remove(group.id) } else { model.markUnfolding(group.id); model.openDoneGroups.insert(group.id) }
        } label: {
            HStack(spacing: 4) {
                Text(SpaceGroupWords.done(group.done.count, language: .current))
                // ⌄ turns over as the finished rows open (N12, as on Windows).
                Image(systemName: "chevron.down").font(.system(size: 8, weight: .bold))
                    .rotationEffect(.degrees(open ? 180 : 0))
                    .animation(Motion.animation(.change, reduce: reduceMotion), value: open)
                Spacer(minLength: 0)
            }
            .font(.system(size: 11))
            .foregroundStyle(PaperTheme.ink3)
            .padding(.leading, PaperTheme.margin + 17)
            .frame(height: 30)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(SpaceGroupWords.done(group.done.count, language: .current))
        .accessibilityValue(open ? L("펼침") : L("접힘"))
    }
}

// MARK: - E · 책갈피 머리말

/// E's head (30 pt): the space's bookmark at the left end (its pale colour, a 4 pt band, rounded on the right; 일반's
/// dashed) with the name and the count, and `다음 13:43` on the right.
struct SpaceBookmarkHead: View {
    @ObservedObject var model: AppModel
    let group: SpaceGroups.Group
    let space: TodoSpaces.Space?
    let folded: Bool
    var now: Date = Date()
    /// J: a row dragged over this group — `여기 놓으면 집으로 옮겨요` in place of `다음 13:43`.
    var dropHint = false

    var body: some View {
        let name = model.groupName(group)
        HStack(spacing: 4) {
            Button { model.showGroupAlone(group) } label: {
                HStack(spacing: 6) {
                    Text(name).font(.system(size: 11.5, weight: .semibold)).foregroundStyle(PaperTheme.ink).lineLimit(1)
                    Text(SpaceWords.grouped(group.open, .current)).font(.system(size: 10.5).monospacedDigit()).foregroundStyle(PaperTheme.ink2)
                }
                .padding(.leading, 10)
                .padding(.trailing, 10)
                .frame(height: 22)
                .background { bookmark }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help(SpaceWords.only(name, language: .current))
            .accessibilityLabel(name + ", " + SpaceGroupWords.left(group.open, language: .current))
            .accessibilityHint(L("이 스페이스만 보기"))
            .layoutPriority(1)
            Spacer(minLength: 8)
            if dropHint {
                SpaceDropHint(name: name)
            } else if let next = group.next {
                Text(SpaceGroupWords.next(DayStrip.clockText(next, language: .current), language: .current))
                    .font(.system(size: 10.5).monospacedDigit())
                    .foregroundStyle(PaperTheme.ink3)
                    .lineLimit(1)
                    .fixedSize()
            }
            SpaceFoldButton(model: model, key: group.id, name: name)
        }
        .padding(.trailing, 10)
        .frame(height: 30)
        .padding(.top, 8)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isHeader)
    }

    @ViewBuilder private var bookmark: some View {
        let shape = UnevenRoundedRectangle(cornerRadii: .init(topLeading: 0, bottomLeading: 0, bottomTrailing: 8, topTrailing: 8), style: .continuous)
        // On the paper, so the margin line under it doesn't show through (it ran through the count).
        if let space {
            shape.fill(PaperTheme.paper)
                .overlay { shape.fill(PaperTheme.space(space.colorKey).opacity(0.17)) }
                .overlay(alignment: .leading) { Rectangle().fill(PaperTheme.space(space.colorKey)).frame(width: 4) }
                .clipShape(shape)
        } else {
            shape.fill(PaperTheme.paper)
                .overlay { shape.strokeBorder(PaperTheme.faint, style: StrokeStyle(lineWidth: 1.2, dash: [3, 2])) }
        }
    }
}

// MARK: - Where it's turned on

/// 책상 → 스페이스: ‘스페이스별로 묶기’ and its look (메모지 · 책갈피).
struct SpaceGroupSettings: View {
    @ObservedObject var model: AppModel

    var body: some View {
        SettingsGroup(title: L("스페이스별로 묶기"), footer: L("오늘 탭의 할 일을 스페이스마다 모아 보여요. 이 Mac에만 적용돼요.")) {
            HStack {
                SettingsLabel(L("스페이스별로 묶기"), systemImage: "square.stack.3d.up")
                Spacer()
                Toggle(L("스페이스별로 묶기"), isOn: $model.groupBySpace).toggleStyle(PaperToggleStyle()).labelsHidden()
            }
            .settingsRow()
            SettingsSeparator()
            HStack {
                SettingsLabel(L("모양"), systemImage: "rectangle.on.rectangle")
                Spacer()
                PaperMenuPicker(selection: $model.groupStyle, options: SpaceGroupStyle.allCases.map { ($0, $0.title) }, label: L("모양"))
            }
            .settingsRow()
            .disabled(!model.groupBySpace)
        }
    }
}
