import PaperCore
import SwiftUI

/// 책상 → 스페이스 (1.45, after 메모 서랍; no ⌘ number, like AI 연결): the spaces in order — drag to reorder, the colour
/// (eight, the memo folders' set), the name edited in place, the open to-dos in it, 지우기 (its to-dos go to 스페이스
/// 없음, the toast's 되돌리기 brings them back) — and + 새 스페이스.
struct SpacesSettingsPanel: View {
    @ObservedObject var model: AppModel
    /// Snapshots: the toast after a delete.
    var previewToast: PaperToast?
    @State private var toast: PaperToast?

    static let rowHeight: CGFloat = 44

    var body: some View {
        let spaces = model.todoSpaces.visible
        SettingsGroup(title: L("스페이스"), more: "spaces", footer: L("할 일을 회사 · 집처럼 나눠요. 오늘 한 장에는 그대로 모두 보이고, 머리말에서 한 스페이스만 볼 수 있어요. 입력 줄에 #이름을 붙이면 그 스페이스로 들어가요.")) {
            if !spaces.isEmpty {
                List {
                    ForEach(spaces) { space in
                        SpaceSettingsRow(model: model, space: space, toast: $toast)
                            .listRowInsets(EdgeInsets())
                            .listRowBackground(Color.clear)
                            .listRowSeparator(.hidden)
                    }
                    .onMove { from, to in
                        var ids = spaces.map(\.id)
                        ids.move(fromOffsets: from, toOffset: to)
                        model.reorderTodoSpaces(ids)
                    }
                }
                .listStyle(.plain)
                .scrollContentBackground(.hidden)
                .scrollDisabled(true)
                .environment(\.defaultMinListRowHeight, Self.rowHeight)
                .frame(height: CGFloat(spaces.count) * Self.rowHeight)
                SettingsSeparator()
            }
            DeskListAddRow(title: L("새 스페이스")) { model.newTodoSpace() }
        }
        .deskPaneToast($toast, preview: previewToast)
    }
}

/// One space: ≡ (drag), its colour (a menu of the eight), its name (Return or leaving the field keeps it), the open
/// to-dos on today's sheet, 지우기.
struct SpaceSettingsRow: View {
    @ObservedObject var model: AppModel
    let space: TodoSpaces.Space
    @Binding var toast: PaperToast?
    @State private var name = ""
    @FocusState private var editing: Bool
    @State private var hovering = false

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "line.3.horizontal")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(PaperTheme.faint)
                .frame(width: 14)
                .help(L("끌어서 순서 바꾸기"))
                .accessibilityHidden(true)
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(PaperTheme.space(space.colorKey))
                .frame(width: 14, height: 14)
                .frame(width: 22, height: 22)
                .overlay { SpaceMenuArea(label: L("색"), items: { SpaceMenus.colors(model, space) }) }
            .help(L("색"))
            .accessibilityLabel(L("색") + " " + space.colorKey.title)
            TextField(L("스페이스 이름"), text: $name)
                .textFieldStyle(.plain)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(PaperTheme.ink)
                .focused($editing)
                .onSubmit(commit)
                .onChange(of: editing) { _, now in if !now { commit() } }
                .accessibilityLabel(L("스페이스 이름"))
            Spacer(minLength: 8)
            let open = model.openCount(.space(space.id))
            if open > 0 {
                Text(model.todoCountText(open))
                    .font(.system(size: 11.5).monospacedDigit())
                    .foregroundStyle(PaperTheme.ink3)
                    .lineLimit(1)
                    .fixedSize()
            }
            DeskRowTrash(shown: hovering, label: L("지우기") + " " + space.name) { model.deleteTodoSpace(space.id, toast: $toast) }
        }
        .padding(.horizontal, 14)
        .frame(height: SpacesSettingsPanel.rowHeight)
        .contentShape(Rectangle())
        .onHover { hovering = $0 }
        .deskRowMenu(edit: { editing = true }, delete: { model.deleteTodoSpace(space.id, toast: $toast) })
        .overlay(alignment: .bottom) {
            if model.todoSpaces.visible.last?.id != space.id {
                Rectangle().fill(PaperTheme.rule).frame(height: 1).padding(.leading, 44)
            }
        }
        .onAppear { name = space.name }
        .onChange(of: space.name) { _, new in if !editing { name = new } }
    }

    private func commit() {
        let clean = MemoFolders.cleanName(name)
        if clean.isEmpty || clean == space.name { name = space.name } else { model.renameTodoSpace(space.id, to: clean) }
    }
}

extension AppModel {
    /// "할 일 3개" · "3 to-dos" · "3 taken".
    func todoCountText(_ count: Int) -> String { AppLanguage.current.todos(count) }
}
