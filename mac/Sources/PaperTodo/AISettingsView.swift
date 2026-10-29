import PaperCore
import SwiftUI

/// Settings › AI 연결 (1.42): the toggle, connecting Claude Desktop or Claude Code, and the recent work with
/// 되돌리기 per entry. The same cards and rows as every other settings pane.
struct AISettingsPanel: View {
    @ObservedObject var ai: AIConnection

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            SettingsGroup(title: L("AI 연결"), footer: L("켜 두면 Claude가 할 일 · 일정 · 메모를 보고, 새로 넣고, 바꾸기 전과 후를 먼저 보여 준 뒤 ‘응’을 받으면 고쳐요. 지우지는 못해요. 끄면 Claude는 아무것도 읽지 못해요.")) {
                HStack(spacing: 12) {
                    SettingsLabel(L("Claude가 종이냥을 보고 쓸 수 있게 하기"), systemImage: "text.bubble")
                    Spacer(minLength: 8)
                    Toggle(L("Claude가 종이냥을 보고 쓸 수 있게 하기"), isOn: Binding(get: { ai.enabled }, set: { ai.setEnabled($0) }))
                        .toggleStyle(PaperToggleStyle())
                        .labelsHidden()
                }
                .settingsRow()
            }

            SettingsGroup(title: L("연결하기"), footer: L("따로 켜 두는 프로그램은 없어요. Claude가 대화에 필요할 때만 종이냥 for Claude를 실행하고, Claude를 끄면 같이 꺼져요. 연결하면 AI 연결이 켜져요.")) {
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 10) {
                        SettingsLabel(L("Claude 데스크톱"), systemImage: "macwindow")
                        Spacer(minLength: 8)
                        Button(L("Claude 데스크톱에 연결")) { ai.connectDesktop() }
                            .buttonStyle(PaperActionButtonStyle(primary: true))
                    }
                    note(L("누르면 Claude가 ‘종이냥 for Claude’를 설치할지 물어봐요. Claude Code가 있으면 같이 연결해요."))
                }
                .padding(.vertical, 9)
                .settingsRow()
                SettingsSeparator()
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 10) {
                        SettingsLabel("Claude Code", systemImage: "terminal")
                        Spacer(minLength: 8)
                        Button(ai.codeBusy ? L("연결하는 중…") : ai.codeLinked ? L("다시 연결") : L("Claude Code에 연결")) { ai.connectCode() }
                            .buttonStyle(PaperActionButtonStyle())
                            .disabled(ai.codeBusy)
                    }
                    note(ai.codeLinked ? L("연결했어요. 새로 여는 Claude Code 세션부터 종이냥이 보여요.")
                                       : L("터미널과 Claude 데스크톱의 Code 탭 모두에 연결돼요. Node가 필요해요."))
                    Text(ai.codeCommand)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(PaperTheme.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                        .help(ai.codeCommand)
                        .padding(.leading, FolderPath.indent)
                        .padding(.top, 2)
                }
                .padding(.vertical, 9)
                .settingsRow()
            }

            SettingsGroup(title: L("최근 AI 작업"), footer: L("오늘과 어제 Claude가 한 일이에요. 되돌리기는 그 뒤로 바뀌지 않은 항목만 되돌려요. Claude가 넣거나 고친 할 일과 일정에는 그날 동안 작은 도장이 찍혀요.")) {
                if ai.recent.isEmpty {
                    Text(L("아직 없어요"))
                        .font(.system(size: 13))
                        .foregroundStyle(PaperTheme.ink3)
                        .settingsRow()
                } else {
                    let days = ai.recentByDay()
                    ForEach(Array(days.enumerated()), id: \.element.title) { dayIndex, day in
                        if dayIndex > 0 { Rectangle().fill(PaperTheme.rule).frame(height: 1) }
                        Text(day.title)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(PaperTheme.ink3)
                            .padding(.horizontal, 14)
                            .padding(.top, 10)
                            .padding(.bottom, 2)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .accessibilityAddTraits(.isHeader)
                        ForEach(Array(day.entries.enumerated()), id: \.element.id) { index, entry in
                            if index > 0 { Rectangle().fill(PaperTheme.rule).frame(height: 1).padding(.leading, 14) }
                            row(entry)
                        }
                    }
                }
            }
        }
        .onAppear { ai.reload() }
    }

    private func note(_ text: String) -> some View {
        Text(text.keepingParticles)
            .font(.system(size: 11))
            .foregroundStyle(PaperTheme.ink2)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.leading, FolderPath.indent)
    }

    private func row(_ entry: AIConnect.Entry) -> some View {
        let done = ai.undone.contains(entry.id)
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(ai.clockText(entry))
                .font(.system(size: 11.5, weight: .medium).monospacedDigit())
                .foregroundStyle(PaperTheme.ink2)
                .lineLimit(1)
                .fixedSize()
                .frame(minWidth: AppLanguage.current == .en ? 56 : 38, alignment: .leading)
            Text(AIText.toast(entry, .current).keepingParticles)
                .font(.system(size: 13))
                .foregroundStyle(done ? PaperTheme.ink3 : PaperTheme.ink)
                .strikethrough(done, color: PaperTheme.ink3)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
            if done {
                Text(AIText.undoneLabel(.current))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(PaperTheme.ink3)
                    .fixedSize()
            } else {
                Button(AIText.undoAction(.current)) { ai.undo(entry.id) }
                    .buttonStyle(PaperActionButtonStyle())
                    .fixedSize()
            }
        }
        .padding(.vertical, 8)
        .settingsRow()
        .accessibilityElement(children: .contain)
    }
}

/// The small stamp on a to-do or an event Claude added or changed today: a rubber stamp in blue-grey ink, a
/// little crooked, like one pressed on paper by hand. It goes when the row is edited here, and the next day.
struct AIStamp: View {
    /// A narrow row: just the small seal "C".
    var compact = false

    var body: some View {
        Text(verbatim: compact ? "C" : "Claude")
            .font(.system(size: 9, weight: .semibold))
            .tracking(0.3)
            .foregroundStyle(PaperTheme.stamp)
            .padding(.horizontal, compact ? 3 : 4)
            .padding(.vertical, 1)
            .overlay { RoundedRectangle(cornerRadius: 3, style: .continuous).strokeBorder(PaperTheme.stamp.opacity(0.8), lineWidth: 1) }
            .rotationEffect(.degrees(-4))
            .fixedSize()
            .help(L("Claude가 오늘 넣거나 고쳤어요"))
            .accessibilityElement()
            .accessibilityLabel(L("Claude가 오늘 넣거나 고쳤어요"))
    }
}
