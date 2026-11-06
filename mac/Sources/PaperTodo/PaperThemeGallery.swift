import AppKit
import PaperCore
import SwiftUI

// 꾸미기 → 종이 (#244, docs/plans/paper-themes.md 6장): the fifteen papers as small notes — 밝은 종이 eleven, then 어두운
// 종이 four — one radio group the arrow keys walk round, and 밤에는 under them. A tile is drawn from the paper's colours
// (NotePalette), so a colour changed there changes its tile too. The Windows app draws the same tiles.

/// One paper as a small note: its paper and ruling, the 오늘 tab, a ticked box and an open one with their lines, the
/// paper's name under it. Picked: a sage edge (2.5 pt) and a check in the corner, as the drawer's tiles.
struct PaperThemeTile: View {
    let kind: PaperKind
    let picked: Bool

    var body: some View {
        let palette = NotePalette.of(kind)
        let color = { (token: NotePalette.Token) in Color(drawerHex: palette.hex(token)) }
        VStack(spacing: 5) {
            ZStack(alignment: .topLeading) {
                color(.paper)
                PaperThemeTileRules(ruling: kind.ruling, rule: color(.rule), margin: color(.marginRule))
                RoundedRectangle(cornerRadius: 1.5).fill(color(.tabToday))
                    .overlay { RoundedRectangle(cornerRadius: 1.5).strokeBorder(color(.tabTodayEdge), lineWidth: 0.5) }
                    .frame(width: 16, height: 6)
                    .padding(.leading, 7)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 4) {
                        RoundedRectangle(cornerRadius: 1.5).fill(color(.sage)).frame(width: 6, height: 6)
                        Capsule().fill(color(.ink)).frame(width: 26, height: 2)
                    }
                    HStack(spacing: 4) {
                        RoundedRectangle(cornerRadius: 1.5).strokeBorder(color(.checkBorder), lineWidth: 0.8).frame(width: 6, height: 6)
                        Capsule().fill(color(.ink2)).frame(width: 18, height: 2)
                    }
                }
                .padding(.leading, 9)
                .padding(.top, 12)
            }
            .frame(height: 44)
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .strokeBorder(picked ? PaperTheme.sage : PaperTheme.checkBorder.opacity(0.45), lineWidth: picked ? 2.5 : 1)
            }
            .overlay(alignment: .bottomTrailing) {
                if picked {
                    Image(systemName: "checkmark")
                        .font(.system(size: 7.5, weight: .bold))
                        .foregroundStyle(PaperTheme.onSage)
                        .frame(width: 14, height: 14)
                        .background(PaperTheme.sage, in: Circle())
                        .overlay { Circle().strokeBorder(PaperTheme.card, lineWidth: 1.5) }
                        .padding(3)
                }
            }
            Text(kind.title)
                .font(.system(size: 11, weight: picked ? .semibold : .regular))
                .foregroundStyle(picked ? PaperTheme.ink : PaperTheme.ink2)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .top)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(kind.spoken)
        .accessibilityAddTraits(picked ? [.isButton, .isSelected] : .isButton)
    }
}

/// A tile's ruling, small: lines, squares, cells, or blue lines with a red margin.
private struct PaperThemeTileRules: View {
    let ruling: PaperKind.Ruling
    let rule: Color
    let margin: Color

    var body: some View {
        Canvas { context, size in
            var path = Path()
            switch ruling {
            case .lines, .margin:
                var y: CGFloat = 13.5
                while y < size.height { path.move(to: CGPoint(x: 4, y: y)); path.addLine(to: CGPoint(x: size.width - 4, y: y)); y += 11 }
            case .grid:
                var y: CGFloat = 5.5
                while y < size.height { path.move(to: CGPoint(x: 0, y: y)); path.addLine(to: CGPoint(x: size.width, y: y)); y += 5.5 }
                var x: CGFloat = 5.5
                while x < size.width { path.move(to: CGPoint(x: x, y: 0)); path.addLine(to: CGPoint(x: x, y: size.height)); x += 5.5 }
            case .manuscript:
                var top: CGFloat = 8
                while top < size.height {
                    path.move(to: CGPoint(x: 4, y: top)); path.addLine(to: CGPoint(x: size.width - 4, y: top))
                    path.move(to: CGPoint(x: 4, y: top + 9)); path.addLine(to: CGPoint(x: size.width - 4, y: top + 9))
                    var x: CGFloat = 4
                    while x <= size.width - 4 { path.move(to: CGPoint(x: x, y: top)); path.addLine(to: CGPoint(x: x, y: top + 9)); x += 9 }
                    top += 12
                }
            }
            context.stroke(path, with: .color(rule), lineWidth: 0.6)
            if ruling == .margin {
                context.fill(Path(CGRect(x: 6, y: 0, width: 1.2, height: size.height)), with: .color(margin))
            }
        }
        .allowsHitTesting(false)
    }
}

/// The tiles in two headed parts (밝은 종이, 어두운 종이) — one radio group: ← → ↑ ↓ pick the next of all fifteen, round from
/// the last to the first. Picking keeps the focus on the group.
struct PaperTileGrid: View {
    let picked: PaperKind
    let label: String
    let pick: (PaperKind) -> Void
    /// The narrowest tile: Dutch names are long single words (Manuscriptpapier, Kringlooppapier) that mustn't break.
    var minimum: CGFloat = AppLanguage.current == .nl ? 100 : 70
    @FocusState private var focused: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            part(L("밝은 종이"), PaperKind.light)
            part(L("어두운 종이"), PaperKind.dark)
        }
        .padding(12)
        .focusable()
        .focused($focused)
        .focusEffectDisabled()
        .onKeyPress(keys: [.leftArrow, .upArrow]) { _ in pick(picked.step(-1)); return .handled }
        .onKeyPress(keys: [.rightArrow, .downArrow]) { _ in pick(picked.step(1)); return .handled }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }

    private func part(_ title: String, _ kinds: [PaperKind]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(PaperTheme.ink2)
                .accessibilityAddTraits(.isHeader)
            LazyVGrid(columns: [GridItem(.adaptive(minimum: minimum), spacing: 8, alignment: .top)], alignment: .leading, spacing: 8) {
                ForEach(kinds) { kind in
                    Button { pick(kind) } label: { PaperThemeTile(kind: kind, picked: kind == picked) }
                        .buttonStyle(.plain)
                }
            }
        }
    }
}

/// 밤에는: 그대로 · 밤 종이 · 먹색 종이 · 밤하늘 종이 · 칠판. Dimmed under a dark paper, with why.
struct PaperNightRow: View {
    @Binding var night: NightChoice
    let enabled: Bool

    var body: some View {
        HStack(spacing: 10) {
            SettingsTile(systemImage: "moon")
            VStack(alignment: .leading, spacing: 2) {
                Text(L("밤에는")).font(.system(size: 13))
                if !enabled {
                    Text(L("어두운 종이는 밤에도 그대로예요."))
                        .font(.system(size: 11))
                        .foregroundStyle(PaperTheme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            PaperMenuPicker(selection: $night, options: NightChoice.allCases.map { ($0, $0.title) }, label: L("밤에는"))
                .disabled(!enabled)
                .accessibilityHint(enabled ? "" : L("어두운 종이는 밤에도 그대로예요."))
        }
        .padding(.vertical, 6)
        .settingsRow()
    }
}

/// 꾸미기 → 종이: under 낮 · 밤.
struct PaperThemeGroup: View {
    @ObservedObject var model: AppModel

    var body: some View {
        SettingsGroup(title: L("종이"), footer: L("노트 · 달력 · 위젯 · 쪽지 · 책상이 같은 종이를 써요. 밝은 종이는 밤이 되면 ‘밤에는’에서 고른 종이로 바뀌어요.")) {
            PaperTileGrid(picked: model.paperTheme, label: L("종이")) { model.paperTheme = $0 }
            SettingsSeparator()
            PaperNightRow(night: $model.paperNight, enabled: !model.paperTheme.isDark)
        }
    }
}
