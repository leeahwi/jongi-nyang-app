import AppKit
import PaperCore
import SwiftUI

// 서랍 종이 (#142, docs/plans/settings-plan.md P2 · P3): the drawer's paper picked from small drawer pictures instead of
// a list of names, and 밤에는 밤 종이로 instead of ‘자동’. The tiles are drawn from DrawerPalette, so a colour changed
// there changes its tile too; a tile shows its paper as it is, day or night. The Windows app draws the same tiles.

/// One paper as a small drawer: its paper with three bookmarks on the left, a sheet with a handwritten title and two
/// lines, the folder colours as dots. Picked: a sage edge (2.5 pt) and a check in the corner.
struct DrawerPaperTile: View {
    let theme: MemoDrawer.Theme
    let picked: Bool

    private static let dots: [MemoFolders.Color] = [.lavender, .pink, .mint, .yellow, .sky, .peach]

    var body: some View {
        let palette = theme.paperPalette
        VStack(spacing: 6) {
            ZStack(alignment: .topLeading) {
                palette.paper
                if palette.background == .grid { GridLines(step: 7).stroke(palette.rule, lineWidth: 0.6) }
                VStack(spacing: 3) {
                    ForEach(Self.dots.prefix(3), id: \.self) { color in
                        RoundedRectangle(cornerRadius: 2).fill(palette.tab(color).a).frame(width: 6, height: 11)
                    }
                }
                .padding(.leading, 6)
                .padding(.top, 9)
                VStack(alignment: .leading, spacing: 3) {
                    Text(L("주간 회의").handwritten)
                        .font(HandwritingFont.swiftUI(face: .pen, size: 11))
                        .foregroundStyle(palette.ink)
                        .lineLimit(1)
                    Capsule().fill(palette.ink.opacity(0.4)).frame(height: 2).padding(.trailing, 10)
                    Capsule().fill(palette.ink.opacity(0.4)).frame(width: 30, height: 2)
                }
                .padding(.horizontal, 6)
                .padding(.vertical, 4)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(palette.sheet)
                .overlay { Rectangle().strokeBorder(palette.sheetEdge, lineWidth: 1) }
                .padding(.leading, 17)
                .padding(.trailing, 8)
                .padding(.top, 8)
                HStack(spacing: 3) {
                    ForEach(Self.dots, id: \.self) { color in
                        Circle().fill(palette.tab(color).a).frame(width: 6, height: 6)
                            .overlay { Circle().strokeBorder(.black.opacity(0.18), lineWidth: 0.5) }
                    }
                }
                .padding(.leading, 17)
                .frame(maxHeight: .infinity, alignment: .bottom)
                .padding(.bottom, 7)
            }
            .aspectRatio(1.45, contentMode: .fit)
            .clipShape(RoundedRectangle(cornerRadius: 9, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .strokeBorder(picked ? PaperTheme.sage : palette.edge, lineWidth: picked ? 2.5 : 1)
            }
            .overlay(alignment: .bottomTrailing) {
                if picked {
                    Image(systemName: "checkmark")
                        .font(.system(size: 8.5, weight: .bold))
                        .foregroundStyle(PaperTheme.onSage)
                        .frame(width: 16, height: 16)
                        .background(PaperTheme.sage, in: Circle())
                        .overlay { Circle().strokeBorder(PaperTheme.card, lineWidth: 1.5) }
                        .padding(5)
                }
            }
            Text(theme.title)
                .font(.system(size: 11.5, weight: picked ? .semibold : .regular))
                .foregroundStyle(picked ? PaperTheme.ink : PaperTheme.ink2)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(theme.title)
        .accessibilityAddTraits(picked ? [.isButton, .isSelected] : .isButton)
    }
}

/// 메모 서랍 → 서랍 종이: the tiles (five to a line on a wide desk, three on a narrow one), ← → ↑ ↓ pick the next, and
/// 밤에는 밤 종이로 under them.
struct DrawerPaperGroup: View {
    @ObservedObject var drawer: MemoDrawer
    @FocusState private var focused: Bool

    var body: some View {
        SettingsGroup(title: L("서랍 종이"), footer: L("종이는 이 Mac에만 저장돼요. 공유 폴더의 다른 기기는 저마다 고른 종이로 보여요.")) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 10)], spacing: 12) {
                ForEach(MemoDrawer.Theme.allCases) { theme in
                    Button { drawer.theme = theme } label: { DrawerPaperTile(theme: theme, picked: drawer.theme == theme) }
                        .buttonStyle(.plain)
                }
            }
            .padding(12)
            .focusable()
            .focused($focused)
            .focusEffectDisabled()
            .onKeyPress(keys: [.leftArrow, .upArrow]) { _ in step(-1); return .handled }
            .onKeyPress(keys: [.rightArrow, .downArrow]) { _ in step(1); return .handled }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(L("서랍 종이"))
            SettingsSeparator()
            HStack(spacing: 10) {
                SettingsTile(systemImage: "moon")
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("밤에는 밤 종이로")).font(.system(size: 13))
                    Text(L("낮 · 밤이 밤일 때 고른 종이 대신 밤 종이(먹색 종이를 골랐으면 그대로)"))
                        .font(.system(size: 11))
                        .foregroundStyle(PaperTheme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                Toggle(L("밤에는 밤 종이로"), isOn: $drawer.nightPaper).toggleStyle(PaperToggleStyle()).labelsHidden()
            }
            .padding(.vertical, 8)
            .settingsRow()
        }
    }

    private func step(_ by: Int) {
        let all = MemoDrawer.Theme.allCases
        guard let at = all.firstIndex(of: drawer.theme) else { return }
        drawer.theme = all[(at + by + all.count) % all.count]
    }
}
