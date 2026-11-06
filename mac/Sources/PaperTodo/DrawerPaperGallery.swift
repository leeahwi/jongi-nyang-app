import AppKit
import PaperCore
import SwiftUI

// 서랍 종이 (#142, docs/plans/settings-plan.md P2 · P3): the drawer's paper picked from small drawer pictures instead of
// a list of names. #244: the note's fifteen papers, 노트와 같은 종이 on top and the drawer's own 밤에는 (instead of 밤에는 밤 종이로). The tiles are drawn from DrawerPalette, so a colour changed
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
        .accessibilityLabel(theme.spoken)
        .accessibilityAddTraits(picked ? [.isButton, .isSelected] : .isButton)
    }
}

/// 메모 서랍 → 서랍 종이: 노트와 같은 종이 on top (#244, on by default). Off, the drawer's own paper from its tiles — the
/// fifteen in two parts, one radio group the arrow keys walk round — and its own 밤에는 under them.
struct DrawerPaperGroup: View {
    @ObservedObject var drawer: MemoDrawer
    @FocusState private var focused: Bool

    var body: some View {
        SettingsGroup(title: L("서랍 종이"), footer: L("종이는 이 Mac에만 저장돼요. 공유 폴더의 다른 기기는 저마다 고른 종이로 보여요.")) {
            HStack(spacing: 10) {
                SettingsTile(systemImage: "rectangle.on.rectangle")
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("노트와 같은 종이")).font(.system(size: 13))
                    if drawer.sameAsNote {
                        Text(L("끄면 서랍만 따로 골라요."))
                            .font(.system(size: 11))
                            .foregroundStyle(PaperTheme.ink2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                Toggle(L("노트와 같은 종이"), isOn: $drawer.sameAsNote).toggleStyle(PaperToggleStyle()).labelsHidden()
            }
            .padding(.vertical, 6)
            .settingsRow()
            if !drawer.sameAsNote {
                SettingsSeparator()
                VStack(alignment: .leading, spacing: 8) {
                    part(L("밝은 종이"), PaperKind.light)
                    part(L("어두운 종이"), PaperKind.dark)
                }
                .padding(12)
                .focusable()
                .focused($focused)
                .focusEffectDisabled()
                .onKeyPress(keys: [.leftArrow, .upArrow]) { _ in drawer.theme = drawer.theme.step(-1); return .handled }
                .onKeyPress(keys: [.rightArrow, .downArrow]) { _ in drawer.theme = drawer.theme.step(1); return .handled }
                .accessibilityElement(children: .contain)
                .accessibilityLabel(L("서랍 종이"))
                SettingsSeparator()
                PaperNightRow(night: $drawer.night, enabled: !drawer.theme.isDark)
            }
        }
    }

    private func part(_ title: String, _ kinds: [PaperKind]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PaperTheme.ink2)
                .accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 10, alignment: .top)], alignment: .leading, spacing: 12) {
                ForEach(kinds) { theme in
                    Button { drawer.theme = theme } label: { DrawerPaperTile(theme: theme, picked: drawer.theme == theme) }
                        .buttonStyle(.plain)
                }
            }
        }
    }
}
