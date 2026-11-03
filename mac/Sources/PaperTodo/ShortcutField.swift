import AppKit
import Carbon.HIToolbox
import PaperCore
import SwiftUI

/// A key from anywhere, as a settings row (#27; the note's key too since #85): the key (click, then press the new one),
/// a small ‘기본값’ link once it isn't the default, and a switch that keeps the key, as in macOS's own keyboard settings.
/// A key another of the app's keys holds is refused with `refusal`'s words. The drawer's row (책상 → 메모 서랍) and the
/// note's (책상 → 꾸미기 → 빠른 입력) are both this one.
struct ShortcutRow: View {
    let title: String
    let systemImage: String
    /// What the key field is read out as.
    let fieldLabel: String
    /// The key now; nil when the switch is off.
    let shortcut: GlobalShortcut?
    let standard: GlobalShortcut
    /// Why `key` can't be taken (another of the app's keys has it), or nil.
    let refusal: (GlobalShortcut) -> String?
    /// A new key was pressed (it turns the switch on).
    let choose: (GlobalShortcut) -> Void
    /// The switch: on brings back the key it had.
    let turn: (Bool) -> Void
    /// While recording, the app's own keys from anywhere step aside, so the key pressed reaches the field.
    let pause: (Bool) -> Void
    /// Snapshots: the recorder drawn listening, or with a refusal under it.
    var previewRecording = false
    var previewProblem: String?
    @State private var recording = false
    @State private var problem: String?
    @State private var monitor: Any?

    var body: some View {
        VStack(alignment: .trailing, spacing: 4) {
            HStack(spacing: 10) {
                SettingsLabel(title, systemImage: systemImage)
                Spacer(minLength: 8)
                if let shortcut, shortcut != standard, !listening {
                    Button(L("기본값")) { stop(); choose(standard); problem = nil }
                        .buttonStyle(.plain)
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(PaperTheme.sageText)
                        .help(L("\(standard.text)로 되돌려요"))
                        .fixedSize()
                }
                Button(action: toggleRecording) {
                    Text(listening ? L("키를 누르세요…") : shortcut?.text ?? L("끔"))
                        .font(.system(size: 12.5, weight: .medium).monospacedDigit())
                        .foregroundStyle(listening ? PaperTheme.sageText : shortcut == nil ? PaperTheme.ink3 : PaperTheme.ink)
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
                .accessibilityLabel(fieldLabel)
                .accessibilityValue(shortcut?.text ?? L("끔"))
                Toggle(title, isOn: Binding(get: { shortcut != nil }, set: { stop(); problem = nil; turn($0) }))
                    .toggleStyle(PaperToggleStyle()).labelsHidden()
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
        pause(true)
        monitor = NSEvent.addLocalMonitorForEvents(matching: .keyDown) { event in
            if event.keyCode == UInt16(kVK_Escape) {
                stop()
                return nil
            }
            guard let shortcut = GlobalShortcut.from(event) else {
                problem = L("⌘, ⌃, ⌥ 가운데 하나와 같이 눌러 주세요.")
                return nil
            }
            if let refused = refusal(shortcut) {
                problem = refused
                return nil
            }
            problem = nil
            stop()
            choose(shortcut)
            return nil
        }
    }

    private func stop() {
        if let monitor { NSEvent.removeMonitor(monitor) }
        monitor = nil
        if recording {
            recording = false
            pause(false)
        }
    }
}

/// The note's key as the welcome guide and help name it: the one chosen (#85; kept while its switch is off), set by
/// AppModel as it loads and changes.
@MainActor
enum NoteKey {
    static var text = GlobalShortcut.noteStandard.text
}

extension ShortcutRules {
    /// The words under a refused key: the drawer's names its three (1.43), the note's the other three (#85).
    static func refusal(_ key: GlobalShortcut, for user: ShortcutUser, note: GlobalShortcut, drawer: GlobalShortcut?) -> String? {
        guard taken(key, by: user, note: note, drawer: drawer) != nil else { return nil }
        return user == .drawer
            ? L("\(key.text) 키는 종이냥이 이미 써요(빠른 메모 · 노트 · 빠른 입력). 다른 키를 눌러 주세요.")
            : L("\(key.text) 키는 종이냥이 이미 써요(빠른 입력 · 빠른 메모 · 메모 서랍). 다른 키를 눌러 주세요.")
    }
}
