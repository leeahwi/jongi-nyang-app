import AppKit
import PaperCore
import SwiftUI

/// 제목만 (#115, docs/plans/drawer-ux-plan.md B2 · mock ③): a memo as one line 36 pt tall — its folder's colour as a 3 pt
/// band at the left, the handwritten title, a checklist's `1/3`, the card's short time — about twelve to a screen. The
/// date groups stay; a click opens the memo in place as its card (as on the list), ↑ ↓ ↩ and the right-click menu are the
/// card's, and it drags to a bookmark as a card does.
struct MemoTitleRow: View {
    @ObservedObject var drawer: MemoDrawer
    let memo: Memo
    let palette: DrawerPalette
    let font: NotebookFont
    let group: MemoCards.Group

    static let height: CGFloat = 36
    static let gap: CGFloat = 6

    var body: some View {
        let selected = drawer.selectedID == memo.id
        let color = drawer.folders.folder(drawer.folders.folderID(of: memo.id))?.colorKey ?? .lavender
        let sheet = drawer.folders.paper(of: memo.id).map { DrawerPalette.of(DrawerPalette.Kind(rawValue: $0.rawValue)!) } ?? palette
        let line = DrawerPalette.openLine(color, drawer: palette, sheet: sheet)
        let card = drawer.card(memo)
        let pinned = drawer.folders.isPinned(memo.id) && group == .pinned
        let floating = drawer.shownBackdrop == .none
        HStack(alignment: .center, spacing: 8) {
            CardTitle(words: Text(verbatim: card.title.handwritten), font: font, color: sheet.ink, size: 19)
                .frame(maxWidth: .infinity, alignment: .leading)
            if case .checklist(let done, let total)? = card.kind {
                Text(verbatim: "\(done)/\(total)")
                    .font(.system(size: 11).monospacedDigit())
                    .foregroundStyle(sheet.secondary)
                    .fixedSize()
                    .accessibilityLabel(L("체크 목록 \(done)/\(total)"))
            }
            if pinned {
                Image(systemName: "pin.fill").font(.system(size: 10)).foregroundStyle(sheet.paw).accessibilityLabel(L("고정"))
            }
            TimeText(text: MemoCards.shortTime(drawer.sortDate(memo), in: group, now: drawer.now(), language: .current), palette: sheet)
        }
        .padding(.leading, 14)
        .padding(.trailing, 12)
        .frame(height: Self.height)
        .background {
            RoundedRectangle(cornerRadius: 5, style: .continuous).fill(sheet.sheet)
                .shadow(color: floating ? .black.opacity(0.2) : sheet.shadow, radius: floating ? 5 : 2, y: 1)
        }
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: 5, bottomLeadingRadius: 5, style: .continuous).fill(line).frame(width: 3)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .strokeBorder(selected ? line.opacity(0.8) : sheet.sheetEdge, lineWidth: selected ? 1.5 : 0.8)
                .allowsHitTesting(false)
        }
        .contentShape(Rectangle())
        .overlay { DrawerContextArea(drawer: drawer) { DrawerMenus.memo(drawer, memo.id) } }
        .onTapGesture { drawer.expand(memo.id) }
        .draggable("memo:" + memo.id) { Text(card.title.handwritten).font(font.handFont(MemoDrawerView.hand(19))).padding(8).background(sheet.sheet) }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { drawer.expand(memo.id) }
    }
}
