import AppKit
import PaperCore
import SwiftUI

/// 저녁 정리 (1.38): at the evening time (Settings → 알림), or the first time the note opens on a new day
/// when yesterday's evening never came, the cat asks what to do with what's left — `내일로 · 언젠가로 ·
/// 그대로 두기` (morning: `오늘 할게요 · 언젠가로 · 내일로`), with the to-dos listed so some can be left
/// out. A slip over the cat when it's out, else at the note. Once a day (Sweep.due); waits while focusing.
@MainActor
final class SweepController {
    private let model: AppModel
    private var panel: SlipPanel?
    private var timer: Timer?
    /// The cat (if it's out): the slip stands above it, and the cat looks up.
    var petAnchor: () -> NSRect? = { nil }
    var onPetGreet: () -> Void = {}
    /// Where the note is (when the cat is hidden), and whether something else is on screen now.
    var noteFrame: () -> NSRect? = { nil }
    var isBusy: () -> Bool = { false }

    init(model: AppModel) {
        self.model = model
        let timer = Timer(timeInterval: 60, repeats: true) { _ in
            Task { @MainActor [weak self] in self?.check(opening: false) }
        }
        timer.tolerance = 10
        RunLoop.main.add(timer, forMode: .common)
        self.timer = timer
    }

    var isVisible: Bool { panel?.isVisible == true }

    /// `opening`: the note was just opened or shown (the morning one only comes then).
    func check(opening: Bool, now: Date = Date()) {
        guard model.sweepEnabled, !isVisible, !isBusy(), !model.timerState.isFocusing, !model.showsGuide,
              let due = Sweep.due(model.items, now: now, minutes: model.sweepTime, shown: model.sweepShown, opening: opening) else { return }
        model.sweepShown = due.mark
        show(due.moment, items: due.items)
    }

    func show(_ moment: Sweep.Moment, items: [TodoItem]) {
        let panel = panel ?? makePanel()
        panel.show(SweepView(model: model, moment: moment, items: items, onClose: { [weak self] in self?.close() }))
        if let pet = petAnchor() {
            onPetGreet()
            panel.placeSlip(topCenter: NSPoint(x: pet.midX, y: pet.maxY + panel.frame.height - 10))
        } else if let note = noteFrame() {
            panel.placeSlip(topCenter: NSPoint(x: note.midX, y: note.maxY - 60))
        } else if let area = NSScreen.main?.visibleFrame {
            panel.placeSlip(topCenter: NSPoint(x: area.maxX - 260, y: area.minY + panel.frame.height + 40))
        }
        panel.orderFrontRegardless()
    }

    func close() { panel?.orderOut(nil) }

    private func makePanel() -> SlipPanel {
        let panel = SlipPanel(nonactivating: true)
        panel.title = L("저녁 정리")
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        self.panel = panel
        return panel
    }
}

struct SweepView: View {
    @ObservedObject var model: AppModel
    let moment: Sweep.Moment
    let items: [TodoItem]
    var onClose: () -> Void = {}
    @State private var excluded: Set<UUID> = []

    private var chosen: [UUID] { items.map(\.id).filter { !excluded.contains($0) } }
    private static let visibleRows = 5

    var body: some View {
        PaperSlip(kind: .todo, width: SlipWidth.medium.rawValue) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .todo, symbol: moment == .evening ? "moon" : "sun.max",
                           title: moment == .evening ? L("저녁 정리") : L("아침 정리"), onClose: onClose)
                HStack(alignment: .center, spacing: 12) {
                    Image(nsImage: PetArt.image(moment == .evening ? .tea : .happy) ?? PaperTheme.mascot)
                        .resizable().scaledToFit()
                        .frame(width: 52, height: 52)
                        .accessibilityHidden(true)
                    Text(Sweep.question(moment, count: items.count, language: .current))
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(PaperTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 16)
                .padding(.top, 10)
                GroupHeader(title: L("넘길 할 일"), count: chosen.count, leading: 16)
                    .padding(.top, 8)
                ScrollView(.vertical) {
                    VStack(spacing: 0) {
                        ForEach(items) { item in row(item) }
                    }
                }
                .scrollIndicators(.never)
                .scrollEdgeFade(8)
                // More than five: half of the sixth shows, so it reads as a list that scrolls.
                .frame(height: items.count > Self.visibleRows ? (CGFloat(Self.visibleRows) + 0.5) * 34 : CGFloat(items.count) * 34 + 4)
                .padding(.horizontal, 12)
                SlipFooter {
                    if moment == .evening {
                        Button(L("그대로 두기"), action: onClose).buttonStyle(SlipButtonStyle(role: .ghost))
                    }
                } trailing: {
                    if moment == .evening {
                        Button(L("언젠가로")) { apply(someday: true) }
                            .buttonStyle(SlipButtonStyle(role: .quiet)).disabled(chosen.isEmpty)
                        Button(L("내일로")) { apply(someday: false) }
                            .buttonStyle(SlipButtonStyle(role: .primary)).disabled(chosen.isEmpty)
                            .help(L("할 일을 내일로 옮겨요"))
                    } else {
                        Button(L("언젠가로")) { apply(someday: true) }
                            .buttonStyle(SlipButtonStyle(role: .ghost)).disabled(chosen.isEmpty)
                        Button(L("내일로")) { apply(someday: false) }
                            .buttonStyle(SlipButtonStyle(role: .quiet)).disabled(chosen.isEmpty)
                        Button(L("오늘 할게요"), action: onClose).buttonStyle(SlipButtonStyle(role: .primary))
                    }
                }
            }
        }
    }

    private func row(_ item: TodoItem) -> some View {
        let on = !excluded.contains(item.id)
        return Button {
            if on { excluded.insert(item.id) } else { excluded.remove(item.id) }
        } label: {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 4).fill(on ? PaperTheme.sage : PaperTheme.card)
                    RoundedRectangle(cornerRadius: 4).strokeBorder(on ? PaperTheme.sage : PaperTheme.checkBorder, lineWidth: 1.3)
                    if on { Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundStyle(PaperTheme.onSage) }
                }
                .frame(width: 16, height: 16)
                Text(item.title.handwritten)
                    .font(model.notebookFont.bodyFont(.small))
                    .foregroundStyle(on ? PaperTheme.ink : PaperTheme.ink3)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if let carried = Carry.label(item, now: Date(), language: .current) {
                    Text(carried).font(.system(size: 11, weight: .medium)).foregroundStyle(PaperTheme.ink3).fixedSize()
                }
            }
            .padding(.horizontal, 4)
            .frame(height: 34)
            .contentShape(Rectangle())
            .overlay(alignment: .bottom) { Rectangle().fill(PaperTheme.rule).frame(height: 0.6) }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(item.title)
        .accessibilityValue(on ? L("넘김") : L("남김"))
    }

    private func apply(someday: Bool) {
        model.sweep(chosen, someday: someday)
        onClose()
    }
}
