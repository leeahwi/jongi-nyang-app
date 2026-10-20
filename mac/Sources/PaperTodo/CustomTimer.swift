import AppKit
import PaperCore
import SwiftUI

/// 직접 정하기…: a small slip (mint tape) near the pointer with one handwritten field for the
/// timer's length ("40", "1:30", "1시간 30분" …), what it understood at its end, length chips
/// that start at once, and [취소] [시작 ↩]. Esc or clicking elsewhere closes.
@MainActor
final class CustomTimerSheet {
    private var panel: SlipPanel?
    private let onStart: (Int) -> Void
    /// The recent typed lengths, newest first (for the chips).
    var recent: () -> [Int] = { [] }

    init(onStart: @escaping (Int) -> Void) {
        self.onStart = onStart
    }

    var isVisible: Bool { panel?.isVisible == true }

    func show() {
        let panel = panel ?? makePanel()
        panel.show(CustomTimerView(
            recent: recent(),
            onStart: { [weak self] minutes in
                self?.close()
                self?.onStart(minutes)
            },
            onCancel: { [weak self] in self?.close() }))
        let point = NSEvent.mouseLocation
        panel.placeSlip(topCenter: NSPoint(x: point.x, y: point.y + panel.slipFrame.height + 12))
        panel.makeKeyAndOrderFront(nil)
    }

    func close() {
        panel?.orderOut(nil)
    }

    private func makePanel() -> SlipPanel {
        let panel = SlipPanel(nonactivating: true)
        panel.title = L("타이머 시간 정하기")
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.onResignKey = { [weak self] in self?.close() }
        self.panel = panel
        return panel
    }
}

struct CustomTimerView: View {
    var recent: [Int] = []
    var onStart: (Int) -> Void = { _ in }
    var onCancel: () -> Void = {}
    @State private var text: String

    init(text: String = "", recent: [Int] = [], onStart: @escaping (Int) -> Void = { _ in }, onCancel: @escaping () -> Void = {}) {
        _text = State(initialValue: text)
        self.recent = recent
        self.onStart = onStart
        self.onCancel = onCancel
    }

    private var minutes: Int? { TimerLength.parseDuration(text, language: .current) }

    /// Four chips: the recent lengths first, then the presets (15 · 25 · 50 · 5), in order of length.
    static func chips(recent: [Int]) -> [Int] {
        var seen = Set<Int>()
        let picked = (TimerLength.cleaned(recent) + [15, 25, 50, 5]).filter { seen.insert($0).inserted }.prefix(4)
        return picked.sorted()
    }

    var body: some View {
        PaperSlip(kind: .timer, width: SlipWidth.small.rawValue) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .timer, symbol: "timer", title: L("타이머"), context: L("1분–3시간"), onClose: onCancel)
                VStack(alignment: .leading, spacing: 12) {
                    HandField(placeholder: L("예: 40 또는 1:30"), text: $text, size: 28,
                              trailing: AnyView(hint), onSubmit: start, onCancel: onCancel, autofocus: true)
                    HStack(spacing: 6) {
                        ForEach(Self.chips(recent: recent), id: \.self) { length in
                            SlipChipButton(title: TimerLength.text(length, language: .current), selected: minutes == length, centered: true) {
                                onStart(length)
                            }
                            .help(L("\(TimerLength.text(length, language: .current)) 타이머 시작"))
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 12)
                .padding(.bottom, 4)
                SlipFooter {
                    EmptyView()
                } trailing: {
                    Button(L("취소"), action: onCancel)
                        .buttonStyle(SlipButtonStyle(role: .ghost))
                    Button(L("시작"), action: start)
                        .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
                        .disabled(minutes == nil)
                }
            }
        }
    }

    /// What it understood (`1시간 30분`, sage) or how to write it (clay), at the end of the line.
    @ViewBuilder
    private var hint: some View {
        if let minutes {
            Text(TimerLength.text(minutes, language: .current))
                .font(.system(size: 13, weight: .semibold).monospacedDigit())
                .foregroundStyle(PaperTheme.sage)
                .fixedSize()
        } else if !text.trimmingCharacters(in: .whitespaces).isEmpty {
            Text("1분에서 3시간까지 적어 주세요")
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(PaperTheme.clayText)
                .lineLimit(2)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 130, alignment: .trailing)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func start() {
        guard let minutes else { return }
        onStart(minutes)
    }
}

/// The length field and, under it, what it understood (`1시간 30분`) or how to write it
/// (`1분에서 3시간까지 적어 주세요`, in the accent colour). The sheet and Settings → 시계 share it.
struct TimerLengthField: View {
    @Binding var text: String
    var onSubmit: () -> Void = {}
    var onCancel: (() -> Void)?
    var compact = false
    /// The sheet: typing goes straight into the field.
    var autofocus = false
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            TextField("예: 40 또는 1:30", text: $text)
                .textFieldStyle(.plain)
                .font(.system(size: compact ? 13 : 15, weight: .medium).monospacedDigit())
                .tint(PaperTheme.accent)
                .onSubmit(onSubmit)
                .onExitCommand(perform: onCancel)
                .focused($focused)
                .padding(.horizontal, 10)
                .frame(height: compact ? 28 : 32)
                .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 8))
                .overlay { RoundedRectangle(cornerRadius: 8).stroke(PaperTheme.rule, lineWidth: 0.8) }
                .accessibilityLabel("타이머 시간")
                .onAppear { if autofocus { focused = true } }
            hint
                .font(.system(size: 11, weight: .medium))
                .lineLimit(1)
                .minimumScaleFactor(0.8)
                .padding(.leading, 4)
        }
    }

    @ViewBuilder
    private var hint: some View {
        let trimmed = text.trimmingCharacters(in: .whitespaces)
        if let minutes = TimerLength.parseDuration(text, language: .current) {
            Text(TimerLength.text(minutes, language: .current)).foregroundStyle(PaperTheme.sage)
        } else if trimmed.isEmpty {
            Text("1분에서 3시간까지 적어 주세요").foregroundStyle(PaperTheme.faded)
        } else {
            Text("1분에서 3시간까지 적어 주세요").foregroundStyle(PaperTheme.clayText)
        }
    }
}
