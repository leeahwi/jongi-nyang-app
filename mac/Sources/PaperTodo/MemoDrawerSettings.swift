import AppKit
import PaperCore
import SwiftUI

/// 책상 → 메모 서랍 (1.43.1; in 1.43 a group at the bottom of 꾸미기; #142 서랍 종이 as its own group): as on Windows, groups — 단축키 (the key, a
/// ‘기본값’ link once it differs, and a switch), 여는 방법 (the handle, 다른 창 위에 띄우기), 모양 (the side, the width, the
/// paper, the backdrop), then 메모 글꼴 (#141). Each row's control changes only what its name says (#27): ‘서랍 열기’ is in the pane's header.
/// All of it this Mac's own (not in the shared folder). 빠른 메모 ⌃⌥M stays in 꾸미기 → 빠른 입력 with the other
/// keys from anywhere, as on Windows.
struct MemoDrawerSettingsGroup: View {
    @ObservedObject var drawer: MemoDrawer
    /// Snapshots: the recorder drawn listening, or with a refusal under it.
    var previewRecording = false
    var previewProblem: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            SettingsGroup(title: L("단축키"), footer: shortcutFooter) {
                DrawerShortcutRow(drawer: drawer, previewRecording: previewRecording, previewProblem: previewProblem)
                    .settingsRow()
            }
            SettingsGroup(title: L("여는 방법"), more: "drawer", footer: L("노트 위의 발 버튼, ⌘3, ⋯ → 메모 서랍, 펫 우클릭, Dock 아이콘 우클릭으로도 열려요. 다른 앱을 눌러도 닫히지 않고, 같은 단축키 · Esc를 누르거나 안쪽 가장자리 가운데의 작은 바를 누르면 닫혀요.")) {
                HStack {
                    SettingsLabel(L("화면 끝에 손잡이 두기"), systemImage: "pawprint")
                    Spacer()
                    Toggle(L("화면 끝에 손잡이 두기"), isOn: $drawer.handleOn).toggleStyle(PaperToggleStyle()).labelsHidden()
                }
                .settingsRow()
                SettingsSeparator()
                HStack {
                    SettingsLabel(L("다른 창 위에 띄우기"), systemImage: "pin")
                    Spacer()
                    Toggle(L("다른 창 위에 띄우기"), isOn: Binding(get: { drawer.pinned }, set: { drawer.pinned = $0; drawer.onPin() }))
                        .toggleStyle(PaperToggleStyle()).labelsHidden()
                }
                .settingsRow()
            }
            // 서랍 종이 (#142): small drawer pictures and 밤에는 밤 종이로.
            DrawerPaperGroup(drawer: drawer)
            SettingsGroup(title: L("모양"), footer: appearanceFooter) {
                HStack(spacing: 12) {
                    SettingsLabel(L("화면 쪽"), systemImage: "sidebar.right")
                    Spacer(minLength: 8)
                    PaperSegmented(selection: $drawer.side, options: [(.left, L("왼쪽"), nil), (.right, L("오른쪽"), nil)], label: L("화면 쪽"))
                        .frame(width: AppLanguage.current == .ko ? 150 : 190)
                }
                .settingsRow()
                SettingsSeparator()
                HStack(spacing: 12) {
                    SettingsLabel(L("폭"), systemImage: "arrow.left.and.right")
                    Spacer(minLength: 8)
                    Slider(value: Binding(get: { Double(drawer.width) }, set: { drawer.width = CGFloat(($0 / 10).rounded() * 10) }),
                           in: Double(MemoDrawer.widths.lowerBound)...Double(MemoDrawer.widths.upperBound))
                        .tint(PaperTheme.sage)
                        .frame(width: 150)
                        .accessibilityLabel(L("폭"))
                        .help(L("서랍 안쪽 끝을 끌어도 폭이 바뀌어요"))
                    Text("\(Int(drawer.width))")
                        .font(.system(size: 12).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink2)
                        .frame(width: 30, alignment: .trailing)
                }
                .settingsRow()
                SettingsSeparator()
                HStack(spacing: 12) {
                    SettingsLabel(L("바탕"), systemImage: "square.on.square.dashed")
                    Spacer(minLength: 8)
                    PaperMenuPicker(selection: $drawer.backdrop, options: MemoDrawer.Backdrop.allCases.map { ($0, $0.title) }, label: L("바탕"))
                }
                .settingsRow()
                SettingsSeparator()
                // #84 (2026-10-30): the marks hidden off the caret's line unless this is on; ticked items go down.
                HStack {
                    SettingsLabel(L("기호 늘 보이기"), systemImage: "eye")
                    Spacer()
                    Toggle(L("기호 늘 보이기"), isOn: $drawer.showMarks).toggleStyle(PaperToggleStyle()).labelsHidden()
                }
                .settingsRow()
                SettingsSeparator()
                HStack {
                    SettingsLabel(L("끝낸 항목 아래로 보내기"), systemImage: "checklist.checked")
                    Spacer()
                    Toggle(L("끝낸 항목 아래로 보내기"), isOn: $drawer.doneToBottom).toggleStyle(PaperToggleStyle()).labelsHidden()
                }
                .settingsRow()
            }
            // 메모 글꼴 (#141): a sample memo, then the face, the size in nine steps, the line and paragraph spacing.
            DrawerFontGroup(drawer: drawer)
        }
    }

    private var appearanceFooter: String {
        let base = L("바탕은 서랍 종이를 비쳐 보이게 하거나(반투명 · 투명) 걷어 내요(바탕 없음). 메모지는 늘 불투명해요.")
            + " " + L("굵게 · 목록 같은 서식 기호는 커서가 있는 줄에서만 보여요. ⇧⌘R로 늘 보이게 할 수 있어요.")
        guard drawer.reduceTransparency else { return base }
        return base + " " + L("손쉬운 사용의 ‘투명도 줄이기’가 켜져 있어서 반투명 · 투명은 불투명으로 보여요.")
    }

    private var shortcutFooter: String {
        guard let shortcut = drawer.shortcut else {
            return L("단축키를 껐어요. 손잡이, 노트 위의 발 버튼, ⋯ 메뉴, ⌘3으로 열어요.")
        }
        guard drawer.shortcutRegistered else {
            return L("다른 앱이 \(shortcut.text) 키를 쓰고 있어요. 다른 키를 골라 주세요.")
        }
        return L("어디서든 \(shortcut.text) 키를 누르면 서랍이 열리고, 한 번 더 누르면 닫혀요. 다른 앱이 같은 키를 써도 서랍이 먼저 열려요.")
    }
}

/// The pane's header button: the drawer itself, out of the rows (#27).
struct OpenDrawerButton: View {
    let model: AppModel

    var body: some View {
        Button { model.openMemoDrawer() } label: {
            Label(L("서랍 열기"), systemImage: "pawprint").labelStyle(.titleAndIcon)
        }
        .buttonStyle(PaperActionButtonStyle())
        .fixedSize()
    }
}

/// 어디서든 열고 닫기 (#27): the shared key row (ShortcutField.swift). ⌃⌥M · ⌃⌥N and the note's key can't be taken.
private struct DrawerShortcutRow: View {
    @ObservedObject var drawer: MemoDrawer
    var previewRecording = false
    var previewProblem: String?

    var body: some View {
        ShortcutRow(title: L("어디서든 열고 닫기"), systemImage: "keyboard", fieldLabel: L("열고 닫는 단축키"),
                    shortcut: drawer.shortcut, standard: .standard,
                    refusal: { ShortcutRules.refusal($0, for: .drawer, note: drawer.model.noteShortcut, drawer: nil) },
                    choose: { drawer.shortcut = $0 }, turn: { drawer.shortcutOn = $0 },
                    pause: { drawer.model.onPauseDrawerShortcut?($0) },
                    previewRecording: previewRecording, previewProblem: previewProblem)
    }
}
