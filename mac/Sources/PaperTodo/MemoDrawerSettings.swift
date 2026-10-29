import AppKit
import Carbon.HIToolbox
import PaperCore
import SwiftUI

/// 책상 → 메모 서랍 (1.43.1; in 1.43 a group at the bottom of 꾸미기): as on Windows, three groups — 단축키 (record a
/// key, 기본값으로, 끄기), 여는 방법 (the handle, 다른 창 위에 띄우기), 모양 (the side, the width, the paper, 서랍 열기).
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
                HStack(spacing: 10) {
                    SettingsLabel(L("열고 닫는 단축키"), systemImage: "keyboard")
                    Spacer(minLength: 8)
                    ShortcutRecorder(drawer: drawer, previewRecording: previewRecording, previewProblem: previewProblem)
                }
                .settingsRow()
            }
            SettingsGroup(title: L("여는 방법"), footer: L("노트 위의 발 버튼, ⌘3, ⋯ → 메모 서랍 열기, 펫 우클릭, Dock 아이콘 우클릭으로도 열려요. 다른 앱을 눌러도 닫히지 않고, 같은 단축키 · Esc · ×로 닫혀요. 손잡이는 위아래로 끌어 옮겨요.")) {
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
                    Text("\(Int(drawer.width))")
                        .font(.system(size: 12).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink2)
                        .frame(width: 30, alignment: .trailing)
                }
                .settingsRow()
                SettingsSeparator()
                HStack(spacing: 12) {
                    SettingsLabel(L("종이"), systemImage: "doc.richtext")
                    Spacer(minLength: 8)
                    PaperMenuPicker(selection: $drawer.theme, options: MemoDrawer.Theme.allCases.map { ($0, $0.title) }, label: L("종이"))
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
                HStack(spacing: 12) {
                    SettingsLabel(L("서랍 안쪽 끝을 끌어도 폭이 바뀌어요"), systemImage: "tray")
                    Spacer(minLength: 8)
                    Button(L("서랍 열기")) { drawer.model.openMemoDrawer() }
                        .buttonStyle(PaperActionButtonStyle(primary: true))
                        .fixedSize()
                }
                .settingsRow()
            }
        }
    }

    private var appearanceFooter: String {
        let base = L("자동 종이는 노트의 낮 · 밤을 따라요. 바탕은 서랍 종이를 비쳐 보이게 하거나(반투명 · 강하게) 걷어 내요(바탕 없음). 메모지는 늘 불투명해요.")
        guard drawer.reduceTransparency else { return base }
        return base + " " + L("손쉬운 사용의 ‘투명도 줄이기’가 켜져 있어서 반투명 · 강하게는 불투명으로 보여요.")
    }

    private var shortcutFooter: String {
        guard let shortcut = drawer.shortcut else {
            return L("단축키를 껐어요. 손잡이, 노트 위의 발 버튼, ⋯ 메뉴, ⌘3으로 열어요.")
        }
        guard drawer.shortcutRegistered else {
            return L("다른 앱이 \(shortcut.text) 키를 쓰고 있어서 켜지 못했어요. 다른 키를 골라 주세요.")
        }
        return L("어디서든 \(shortcut.text) 키를 누르면 화면 끝에서 서랍이 나와요. 켜 두면 다른 앱의 같은 단축키보다 먼저 받아요.")
    }
}

/// The shortcut field: shows the keys; clicked, it listens for the next key with ⌘, ⌃ or ⌥ (Esc stops listening).
/// The app's own ⌃⌥M · ⌃⌥J · ⌃⌥N can't be taken.
private struct ShortcutRecorder: View {
    @ObservedObject var drawer: MemoDrawer
    var previewRecording = false
    var previewProblem: String?
    @State private var recording = false
    @State private var problem: String?
    @State private var monitor: Any?

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            HStack(spacing: 6) {
                Button(action: toggleRecording) {
                    Text(listening ? L("키를 누르세요…") : drawer.shortcut?.text ?? L("끔"))
                        .font(.system(size: 12.5, weight: .medium).monospacedDigit())
                        .foregroundStyle(listening ? PaperTheme.sageText : drawer.shortcut == nil ? PaperTheme.ink3 : PaperTheme.ink)
                        .lineLimit(1)
                        .fixedSize()
                        .padding(.horizontal, 10)
                        .frame(minWidth: 74, minHeight: 26)
                        .background(PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .strokeBorder(listening ? PaperTheme.sage : PaperTheme.rule, lineWidth: listening ? 1.2 : 0.7)
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help(L("누르고 새 단축키를 눌러요"))
                .accessibilityLabel(L("열고 닫는 단축키"))
                .accessibilityValue(drawer.shortcut?.text ?? L("끔"))
                Button(L("기본값으로")) { stop(); drawer.shortcut = .standard; problem = nil }
                    .buttonStyle(PaperActionButtonStyle())
                    .disabled(drawer.shortcut == .standard)
                    .fixedSize()
                Button(String(localized: "끄기", table: "Settings")) { stop(); drawer.shortcut = nil; problem = nil }
                    .buttonStyle(PaperActionButtonStyle())
                    .disabled(drawer.shortcut == nil)
                    .fixedSize()
            }
            if let message = previewProblem ?? problem {
                Text(message.keepingParticles)
                    .font(.system(size: 11))
                    .foregroundStyle(PaperTheme.clayText)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.trailing)
            }
        }
        .padding(.vertical, 6)
        .onDisappear { stop() }
    }

    private var listening: Bool { recording || previewRecording }

    private func toggleRecording() {
        if recording { stop(); return }
        problem = nil
        recording = true
        drawer.model.onPauseDrawerShortcut?(true)
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.keyCode == UInt16(kVK_Escape) {
                stop()
                return nil
            }
            guard let shortcut = DrawerShortcut.from(event) else {
                problem = L("⌘, ⌃, ⌥ 가운데 하나와 같이 눌러 주세요.")
                return nil
            }
            if shortcut.isReserved {
                problem = L("\(shortcut.text) 키는 종이냥이 이미 쓰고 있어요 (빠른 메모 · 노트 · 빠른 입력).")
                return nil
            }
            problem = nil
            stop()
            drawer.shortcut = shortcut
            return nil
        }
    }

    private func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        if recording {
            recording = false
            drawer.model.onPauseDrawerShortcut?(false)
        }
    }
}
