import PaperCore
import SwiftUI

// #22: the desk's list panes (반복 · 시계 · 스페이스) add and delete the same way, as on Windows (settings.ts):
// `+ 새 …` is the list card's last row (alone when the list is empty), a row's trash shows only under the pointer,
// a row's right-click has 고치기 · 지우기, and a delete leaves a 지웠어요 · 되돌리기 toast under the card.

/// The list card's last row: + and the words in sage.
struct DeskListAddRow: View {
    let title: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: "plus").font(.system(size: 12, weight: .semibold)).frame(width: 28)
                Text(title).font(.system(size: 13, weight: .medium))
                Spacer(minLength: 0)
            }
            .foregroundStyle(PaperTheme.sageText)
            .contentShape(Rectangle())
            .settingsRow()
        }
        .buttonStyle(.plain)
    }
}

/// A row's trash: drawn while the pointer is over the row (`shown`), always there for VoiceOver and the keyboard.
struct DeskRowTrash: View {
    let shown: Bool
    let label: String
    var help: String = L("지우기")
    let action: () -> Void
    @FocusState private var focused: Bool

    var body: some View {
        Button(action: action) {
            Image(systemName: "trash").font(.system(size: 12))
                .frame(width: 26, height: 26)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(PaperTheme.ink2)
        .focused($focused)
        .opacity(shown || focused ? 1 : 0)
        .help(help)
        .accessibilityLabel(label)
    }
}

/// A row's right-click: 고치기 · 지우기 (the same icons as a to-do's menu).
struct DeskRowMenu: ViewModifier {
    var edit: (() -> Void)?
    let delete: () -> Void

    func body(content: Content) -> some View {
        content.contextMenu {
            if let edit { Button(action: edit) { Label(L("고치기"), systemImage: "pencil").labelStyle(.titleAndIcon) } }
            Divider()
            Button(role: .destructive, action: delete) { Label(L("지우기"), systemImage: "trash").labelStyle(.titleAndIcon) }
        }
    }
}

extension View {
    func deskRowMenu(edit: (() -> Void)? = nil, delete: @escaping () -> Void) -> some View {
        modifier(DeskRowMenu(edit: edit, delete: delete))
    }

    /// The toast after a delete, under the list card (the 스페이스 pane's since 1.45).
    func deskPaneToast(_ toast: Binding<PaperToast?>, preview: PaperToast? = nil) -> some View {
        overlay(alignment: .bottom) {
            if let shown = toast.wrappedValue ?? preview {
                ToastView(toast: shown) { if toast.wrappedValue?.id == shown.id { toast.wrappedValue = nil } }
                    .offset(y: 56)
                    .id(shown.id)
            }
        }
        .padding(.bottom, toast.wrappedValue ?? preview == nil ? 0 : 56)
    }
}

extension PaperToast {
    /// ‘알람을 지웠어요 · 되돌리기’ (what was deleted, #38): `restore` brings it back (and the toast goes).
    @MainActor static func deleted(_ text: String, into toast: Binding<PaperToast?>, restore: @escaping () -> Void) -> PaperToast {
        var shown = PaperToast(symbol: "trash", text: text)
        shown.action = L("되돌리기")
        shown.takeBack = restore
        shown.perform = {
            restore()
            toast.wrappedValue = nil
        }
        return shown
    }
}
