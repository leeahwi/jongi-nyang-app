import PaperCore
import SwiftUI

/// 책상 → 스페이스 (1.45, after 메모 서랍; no ⌘ number, like AI 연결): the spaces in order — drag to reorder, the colour
/// (eight, the memo folders' set), the name edited in place, the open to-dos in it, 지우기 (its to-dos go to 일반,
/// the toast's 되돌리기 brings them back) — and + 새 스페이스, which adds a row to name right there, as on Windows
/// (1.45.1: it asked on a modal slip, and the desk stopped answering when the slip didn't show). 일반 (#89) is the
/// fixed first row.
struct SpacesSettingsPanel: View {
    @ObservedObject var model: AppModel
    /// Snapshots: the toast after a delete; a new space's row being named.
    var previewToast: PaperToast?
    var previewDraft: String?
    @State private var toast: PaperToast?
    /// The new space's name while its row is open (+ 새 스페이스); nil without one.
    @State private var draft: String?

    static let rowHeight: CGFloat = 44

    var body: some View {
        let spaces = model.todoSpaces.visible
        SettingsGroup(title: L("스페이스"), more: "spaces", footer: L("머리말에서 한 스페이스만 볼 수 있어요. 입력 줄에 #이름을 붙이면 그 스페이스로 들어가요.")) {
            let draft = draft ?? previewDraft
            if !spaces.isEmpty {
                // #89: 일반 — the to-dos in no space — first, fixed: out of the list, so it can't be dragged or deleted.
                GeneralSettingsRow(model: model)
                SettingsSeparator()
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
            if let draft {
                NewSpaceRow(color: model.todoSpaces.nextColor, name: Binding(get: { draft }, set: { self.draft = $0 })) { name in
                    self.draft = nil
                    if let name { _ = model.addTodoSpace(name: name) }
                }
                SettingsSeparator()
            }
            DeskListAddRow(title: L("새 스페이스")) { if self.draft == nil { self.draft = "" } }
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

/// 일반 (#89): the first row, fixed — no grip, no colour (its to-dos have no band on the sheet), the name edited in place
/// (blank or a default name: back to ‘일반’ · ‘General’ · ‘Algemeen’), the open to-dos in it; no 지우기. Shown once
/// there is a space: before that every to-do is in it, and the name is shown nowhere.
struct GeneralSettingsRow: View {
    @ObservedObject var model: AppModel
    @State private var name = ""
    @FocusState private var editing: Bool

    var body: some View {
        HStack(spacing: 10) {
            // Where a space's grip and colour are: the names stay in one column.
            Color.clear.frame(width: 14)
            Color.clear.frame(width: 22, height: 22)
            TextField(TodoSpaces.defaultGeneralName(.current), text: $name)
                .textFieldStyle(.plain)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(PaperTheme.ink)
                .focused($editing)
                .onSubmit(commit)
                .onChange(of: editing) { _, now in if !now { commit() } }
                .accessibilityLabel(L("스페이스 없는 할 일의 이름"))
            Spacer(minLength: 8)
            let open = model.openCount(.noSpace)
            if open > 0 {
                Text(model.todoCountText(open))
                    .font(.system(size: 11.5).monospacedDigit())
                    .foregroundStyle(PaperTheme.ink3)
                    .lineLimit(1)
                    .fixedSize()
            }
            // A space row's trash, never shown (no 지우기): its place keeps the counts in one column.
            DeskRowTrash(shown: false, label: "") {}.hidden().accessibilityHidden(true)
        }
        .padding(.horizontal, 14)
        // In line with the rows below (the list draws them 8 pt in, and 9 pt from the right: the snapshots measured it).
        .padding(.leading, 8)
        .padding(.trailing, 9)
        .frame(height: SpacesSettingsPanel.rowHeight)
        .contentShape(Rectangle())
        .help(L("어느 스페이스에도 넣지 않은 할 일이에요. 이름을 바꿀 수 있어요."))
        .contextMenu {
            Button { editing = true } label: { Label(L("고치기"), systemImage: "pencil").labelStyle(.titleAndIcon) }
        }
        .onAppear { name = model.generalName }
        .onChange(of: model.generalName) { _, new in if !editing { name = new } }
    }

    private func commit() {
        model.renameGeneral(to: name)
        name = model.generalName
    }
}

/// + 새 스페이스's row: the next colour and a name field with the cursor in it. Return or leaving the field makes the
/// space (nothing typed: no space); Esc drops the row.
private struct NewSpaceRow: View {
    let color: TodoSpaces.Color
    @Binding var name: String
    let done: (String?) -> Void
    @FocusState private var focused: Bool
    @State private var finished = false

    var body: some View {
        HStack(spacing: 10) {
            Color.clear.frame(width: 14)
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(PaperTheme.space(color))
                .frame(width: 14, height: 14)
                .frame(width: 22, height: 22)
                .accessibilityHidden(true)
            TextField(L("이름"), text: $name)
                .textFieldStyle(.plain)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(PaperTheme.ink)
                .focused($focused)
                .onSubmit { finish(name) }
                .onExitCommand { finish(nil) }
                .onChange(of: focused) { _, now in if !now { finish(name) } }
                .accessibilityLabel(L("새 스페이스 이름"))
            Spacer(minLength: 8)
        }
        .padding(.horizontal, 14)
        // In line with the rows above (the list draws them 8 pt in).
        .padding(.leading, 8)
        .frame(height: SpacesSettingsPanel.rowHeight)
        .onAppear { DispatchQueue.main.async { focused = true } }
    }

    private func finish(_ text: String?) {
        guard !finished else { return }
        finished = true
        let clean = text.map { MemoFolders.cleanName($0) } ?? ""
        done(clean.isEmpty ? nil : clean)
    }
}

extension AppModel {
    /// "할 일 3개" · "3 to-dos" · "3 taken".
    func todoCountText(_ count: Int) -> String { AppLanguage.current.todos(count) }
}
