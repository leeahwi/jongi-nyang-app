import AppKit
import SwiftUI

/// The app's questions (language, import, storage folder, quitting with unsaved changes …) on a
/// slip with neutral tape instead of the system alert. File pickers stay the system's.
@MainActor
enum SlipAlert {
    struct Choice {
        let title: String
        var role: SlipButtonStyle.Role = .ghost
        /// Return picks it.
        var isDefault = false
        /// Esc picks it.
        var isCancel = false
        /// Drawn on the footer's left, apart from the others (a destructive choice, like 바꾸기).
        var leading = false
    }

    /// Shows the question and waits; returns the index of the choice picked.
    @discardableResult
    static func run(symbol: String, title: String, message: String, detail: String? = nil, choices: [Choice],
                    cat: PetArt.Pose? = .curious, width: SlipWidth = .small) -> Int {
        let panel = ModalSlipPanel(nonactivating: false)
        panel.title = title
        panel.level = .modalPanel
        var picked = choices.firstIndex { $0.isCancel } ?? max(0, choices.count - 1)
        panel.show(SlipAlertView(symbol: symbol, title: title, message: message, detail: detail, choices: choices, cat: cat, width: width) { index in
            picked = index
            NSApp.stopModal()
        })
        let anchor = NSApp.keyWindow ?? NSApp.mainWindow
        if let anchor, anchor.isVisible {
            panel.placeSlip(topCenter: NSPoint(x: anchor.frame.midX, y: anchor.frame.maxY - 90))
        } else if let area = (NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main)?.visibleFrame {
            panel.placeSlip(topCenter: NSPoint(x: area.midX, y: area.maxY - area.height / 4))
        }
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        NSApp.runModal(for: panel)
        panel.orderOut(nil)
        return picked
    }

    /// A name asked on a slip (새 스페이스…, 1.45): the trimmed text, or nil for 취소 / Esc / nothing typed.
    static func askName(title: String, message: String, placeholder: String, initial: String = "") -> String? {
        let panel = ModalSlipPanel(nonactivating: false)
        panel.title = title
        panel.level = .modalPanel
        var result: String?
        panel.show(NameSlipView(title: title, message: message, placeholder: placeholder, text: initial) { name in
            result = name
            NSApp.stopModal()
        })
        let anchor = NSApp.keyWindow ?? NSApp.mainWindow
        if let anchor, anchor.isVisible {
            panel.placeSlip(topCenter: NSPoint(x: anchor.frame.midX, y: anchor.frame.maxY - 90))
        } else if let area = (NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main)?.visibleFrame {
            panel.placeSlip(topCenter: NSPoint(x: area.midX, y: area.maxY - area.height / 4))
        }
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        NSApp.runModal(for: panel)
        panel.orderOut(nil)
        let clean = result.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
        return clean?.isEmpty == false ? clean : nil
    }

    /// Something went wrong: the reason and 확인.
    static func inform(symbol: String = "exclamationmark.circle", title: String, message: String, detail: String? = nil) {
        run(symbol: symbol, title: title, message: message, detail: detail,
            choices: [Choice(title: L("확인"), role: .primary, isDefault: true, isCancel: true)], cat: nil)
    }
}

private final class ModalSlipPanel: SlipPanel {
    override var canBecomeMain: Bool { true }
}

struct SlipAlertView: View {
    let symbol: String
    let title: String
    let message: String
    var detail: String?
    let choices: [SlipAlert.Choice]
    var cat: PetArt.Pose?
    var width: SlipWidth = .small
    var onPick: (Int) -> Void = { _ in }

    var body: some View {
        PaperSlip(kind: .confirm, width: width.rawValue) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .confirm, symbol: symbol, title: title)
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(message.keepingParticles)
                            .font(.system(size: 15))
                            .lineSpacing(3)
                            .foregroundStyle(PaperTheme.ink)
                            .fixedSize(horizontal: false, vertical: true)
                        if let detail, !detail.isEmpty {
                            Text(detail.keepingParticles)
                                .font(.system(size: 12.5, weight: .medium))
                                .lineSpacing(2)
                                .foregroundStyle(PaperTheme.ink2)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    if let cat, let image = PetArt.image(cat) {
                        Image(nsImage: image).resizable().scaledToFit().frame(width: 54, height: 54)
                            .padding(.top, -6)
                            .accessibilityHidden(true)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 4)
                SlipFooter {
                    // Esc: the choice that keeps things as they are.
                    if let cancel = choices.firstIndex(where: { $0.isCancel }) {
                        Button("") { onPick(cancel) }
                            .keyboardShortcut(.cancelAction)
                            .opacity(0)
                            .frame(width: 0, height: 0)
                            .accessibilityHidden(true)
                    }
                    ForEach(Array(choices.enumerated()).filter { $0.element.leading }, id: \.offset) { index, choice in
                        button(index, choice)
                    }
                } trailing: {
                    // The buttons may not all fit on one line in English and Dutch: they wrap.
                    FlowLayout(spacing: 6, lineSpacing: 6, trailing: true) {
                        ForEach(Array(choices.enumerated()).filter { !$0.element.leading }, id: \.offset) { index, choice in
                            button(index, choice)
                        }
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    @ViewBuilder
    private func button(_ index: Int, _ choice: SlipAlert.Choice) -> some View {
        let base = Button(choice.title) { onPick(index) }
            .buttonStyle(SlipButtonStyle(role: choice.role, key: choice.isDefault ? "↩" : nil))
        if choice.isDefault { base.keyboardShortcut(.defaultAction) } else { base }
    }
}

/// The name slip: a line to type in, 취소 and 만들기 (Return).
struct NameSlipView: View {
    let title: String
    let message: String
    let placeholder: String
    @State var text: String
    var onDone: (String?) -> Void = { _ in }
    @FocusState private var focused: Bool

    var body: some View {
        PaperSlip(kind: .confirm, width: SlipWidth.small.rawValue) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .confirm, symbol: "square.stack", title: title)
                VStack(alignment: .leading, spacing: 8) {
                    Text(message)
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(PaperTheme.ink2)
                    TextField(placeholder, text: $text)
                        .textFieldStyle(.plain)
                        .font(.system(size: 15))
                        .foregroundStyle(PaperTheme.ink)
                        .focused($focused)
                        .onSubmit { if !trimmed.isEmpty { onDone(text) } }
                        .padding(.horizontal, 10)
                        .frame(height: 32)
                        .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                        .overlay { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(focused ? PaperTheme.sage : PaperTheme.rule, lineWidth: 1.5) }
                        .accessibilityLabel(message)
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 4)
                SlipFooter {
                    Button("") { onDone(nil) }
                        .keyboardShortcut(.cancelAction)
                        .opacity(0)
                        .frame(width: 0, height: 0)
                        .accessibilityHidden(true)
                } trailing: {
                    HStack(spacing: 6) {
                        Button(L("취소")) { onDone(nil) }.buttonStyle(SlipButtonStyle(role: .ghost))
                        Button(L("만들기")) { onDone(text) }
                            .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
                            .disabled(trimmed.isEmpty)
                    }
                }
            }
        }
        .onAppear { focused = true }
    }

    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
}
