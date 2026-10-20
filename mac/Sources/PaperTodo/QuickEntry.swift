import AppKit
import Carbon.HIToolbox
import PaperCore
import SwiftUI

/// ⌃⌥N from any app: the input line on a small slip (honey tape), to write anything down without
/// opening the note — the same chips, Tab and commit as the note's line. After Return the toast
/// shows in the slip for 1.5 s (or, with the note on screen, the slip closes and the note shows
/// it). Esc or clicking away closes.
@MainActor
final class QuickEntryController {
    private let model: AppModel
    private var panel: SlipPanel?
    private var hotKey: GlobalHotKey?
    /// Whether ⌃⌥N could be claimed (another app may own it).
    var registered: Bool { hotKey != nil }
    /// The note is on screen: the toast goes there.
    var noteVisible: () -> Bool = { false }

    init(model: AppModel) {
        self.model = model
    }

    // MARK: Shortcut

    func setEnabled(_ enabled: Bool) {
        if enabled {
            guard hotKey == nil else { return }
            hotKey = GlobalHotKey(keyCode: kVK_ANSI_N, modifiers: controlKey | optionKey) { [weak self] in self?.show() }
        } else {
            hotKey?.unregister()
            hotKey = nil
        }
    }

    // MARK: Window

    func show() {
        let panel = panel ?? makePanel()
        panel.show(QuickEntryView(model: model, onClose: { [weak self] in self?.close() }, noteVisible: { [weak self] in self?.noteVisible() ?? false }))
        let mouse = NSEvent.mouseLocation
        let screen = NSScreen.screens.first { $0.frame.contains(mouse) } ?? NSScreen.main
        if let area = screen?.visibleFrame {
            panel.placeSlip(topCenter: NSPoint(x: area.midX, y: area.maxY - area.height / 5))
        }
        panel.makeKeyAndOrderFront(nil)
    }

    func close() {
        panel?.orderOut(nil)
    }

    private func makePanel() -> SlipPanel {
        let panel = SlipPanel(nonactivating: true)
        panel.title = L("빠른 입력")
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.onResignKey = { [weak self] in self?.close() }
        self.panel = panel
        return panel
    }
}

/// 빠른 입력: header, the chips over a handwritten line, `tab 다른 뜻 · esc 닫기` and 넣기 ↩.
struct QuickEntryView: View {
    @ObservedObject var model: AppModel
    var onClose: () -> Void = {}
    var noteVisible: () -> Bool = { false }
    /// Snapshots: draw the toast as it shows after Return.
    var previewToast: PaperToast?
    @State private var text: String
    @State private var picked = 0
    @State private var toast: PaperToast?
    @State private var focus = 0
    @State private var focused = false

    init(model: AppModel, text: String = "", onClose: @escaping () -> Void = {}, noteVisible: @escaping () -> Bool = { false },
         previewToast: PaperToast? = nil) {
        self.model = model
        self.onClose = onClose
        self.noteVisible = noteVisible
        self.previewToast = previewToast
        _text = State(initialValue: text)
    }

    private var candidates: [Intent.Candidate] { model.intentCandidates(text) }

    var body: some View {
        let candidates = self.candidates
        PaperSlip(kind: .todo, width: SlipWidth.medium.rawValue) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .todo, symbol: "checkmark", title: L("빠른 입력"), context: L("어디서든 ⌃⌥N"), onClose: onClose)
                VStack(alignment: .leading, spacing: 8) {
                    if !candidates.isEmpty {
                        IntentChips(candidates: candidates, picked: min(picked, candidates.count - 1)) { picked = $0 }
                    }
                    IntentField(text: $text, placeholder: L("무엇이든 적어요"), font: model.notebookFont.handNSFont(28),
                                focusRequest: focus,
                                onFocus: { focused = $0 },
                                onTab: { step in
                                    guard candidates.count > 1 else { return false }
                                    picked = (picked + step + candidates.count) % candidates.count
                                    return true
                                },
                                onSubmit: { shift, command in submit(literal: shift, asEvent: command) },
                                onEscape: { onClose(); return true },
                                onUndo: undo,
                                accessibilityLabel: L("빠른 입력"))
                        .frame(height: 34)
                        .padding(.bottom, 4)
                        .overlay(alignment: .bottom) {
                            Rectangle().fill(focused || !text.isEmpty ? PaperTheme.sage : PaperTheme.rule).frame(height: 1.5)
                        }
                    if let problem = Intent.problem(text, language: .current) {
                        Text(problem.text(.current))
                            .font(.system(size: 11.5, weight: .medium))
                            .foregroundStyle(PaperTheme.clayText)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 4)
                SlipFooter {
                    HStack(spacing: 10) {
                        KeyHint(key: "Tab", label: L("다른 뜻"))
                        KeyHint(key: "Esc", label: L("닫기"))
                    }
                } trailing: {
                    Button(L("넣기")) { submit(literal: false, asEvent: false) }
                        .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
                        .disabled(candidates.isEmpty)
                }
                // The toast takes the footer's place (it was drawn over the hints and the button).
                .opacity(toast ?? previewToast == nil ? 1 : 0)
            }
            .overlay(alignment: .bottom) {
                if let shown = toast ?? previewToast {
                    ToastView(toast: shown, seconds: 1.5) { onClose() }
                        .padding(.horizontal, 16)
                        .padding(.bottom, 14)
                        .id(shown.id)
                }
            }
        }
        .onChange(of: text) { picked = 0 }
        .onAppear { focus += 1 }
    }

    /// Return: the picked reading; ⇧Return the text as it is; ⌘Return as an event.
    private func submit(literal: Bool, asEvent: Bool) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return onClose() }
        var list = model.intentCandidates(trimmed)
        var index = min(picked, max(0, list.count - 1))
        if literal {
            list = [.todo(QuickParse(title: trimmed))]
            index = 0
        } else if asEvent {
            if let event = list.firstIndex(where: { $0.kind == .event }) {
                index = event
            } else {
                // ⌘Return still makes an event (at the next half hour), as before.
                list = Intent.read("/일정 " + trimmed, now: Date(), language: .current) // ko-only: Korean words the parser reads
                index = 0
            }
        }
        guard !list.isEmpty else { return }
        guard let commit = model.commitIntent(text: trimmed, candidates: list, index: index, page: .todos) else {
            text = ""
            return onClose()
        }
        text = ""
        if noteVisible() {
            onClose()
            model.toast = model.makeToast(for: commit, onChange: { [model] in model.toast = $0 })
        } else {
            toast = model.makeToast(for: commit, onChange: { toast = $0 })
        }
    }

    /// ⌘Z while the toast is up: it goes, and the words come back.
    private func undo() -> Bool {
        guard let commit = toast?.commit else { return false }
        model.takeBack(commit)
        toast = nil
        text = commit.text
        return true
    }
}
