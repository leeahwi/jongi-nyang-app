import AppKit
import PaperCore
import SwiftUI

// The two parts of 메모 서랍's look that are still being chosen with the user (1.43): the cat on the drawer and the
// memo slip's paper. Each lives here alone, so a new design replaces it without touching layout or behaviour.

/// The cat on the drawer (design B2, 2026-10-27): no picture — the drawer's paper itself has two cat ears on its top
/// edge, toward the screen's edge, with a little pink inside. `outline` is the paper with its ears (one fill, texture
/// and edge); the view draws the pink.
struct DrawerCat: View {
    let palette: DrawerPalette
    let right: Bool

    /// How far the ears stand above the paper's top edge.
    nonisolated static let earHeight: CGFloat = 16
    /// Each ear: its base's start and end, measured from the screen-edge side (mock: 262 pt drawer, ears 170–200, 214–246).
    nonisolated static let ears: [(CGFloat, CGFloat)] = [(62, 92), (16, 48)]
    nonisolated static let innerCorner: CGFloat = 12
    nonisolated static let bottomCorner: CGFloat = 14

    /// The paper with its ears: `rect`'s top is the ears' tips; the paper's top edge is `earHeight` below.
    nonisolated static func outline(in rect: CGRect, right: Bool) -> Path {
        let top = rect.minY + earHeight
        func x(_ fromEdge: CGFloat) -> CGFloat { right ? rect.maxX - fromEdge : rect.minX + fromEdge }
        var path = Path()
        let r = innerCorner, rb = bottomCorner
        if right {
            // Start at the inner bottom corner, go up the inner side, along the top with the ears, down the screen edge.
            path.move(to: CGPoint(x: rect.minX + rb, y: rect.maxY))
            path.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - rb), control: CGPoint(x: rect.minX, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX, y: top + r))
            path.addQuadCurve(to: CGPoint(x: rect.minX + r, y: top), control: CGPoint(x: rect.minX, y: top))
            for (near, far) in ears { addEar(&path, from: x(far), to: x(near), top: top, tip: rect.minY) }
            path.addLine(to: CGPoint(x: rect.maxX, y: top))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        } else {
            path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.minX, y: top))
            for (near, far) in ears.reversed() { addEar(&path, from: x(near), to: x(far), top: top, tip: rect.minY) }
            path.addLine(to: CGPoint(x: rect.maxX - r, y: top))
            path.addQuadCurve(to: CGPoint(x: rect.maxX, y: top + r), control: CGPoint(x: rect.maxX, y: top))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - rb))
            path.addQuadCurve(to: CGPoint(x: rect.maxX - rb, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
        }
        path.closeSubpath()
        return path
    }

    /// One ear from `a` to `b` along the top (left to right), its tip a little rounded.
    nonisolated private static func addEar(_ path: inout Path, from a: CGFloat, to b: CGFloat, top: CGFloat, tip: CGFloat) {
        let peak = (a + b) / 2
        path.addLine(to: CGPoint(x: a, y: top))
        path.addLine(to: CGPoint(x: peak - 1.6, y: tip + 1.8))
        path.addQuadCurve(to: CGPoint(x: peak + 1.6, y: tip + 1.8), control: CGPoint(x: peak, y: tip))
        path.addLine(to: CGPoint(x: b, y: top))
    }

    var body: some View {
        Canvas { context, size in
            var inner = Path()
            for (near, far) in Self.ears {
                let a = right ? size.width - far : near, b = right ? size.width - near : far
                let peak = (a + b) / 2
                inner.move(to: CGPoint(x: peak - 5.5, y: 13))
                inner.addLine(to: CGPoint(x: peak, y: 5))
                inner.addLine(to: CGPoint(x: peak + 5.5, y: 13))
                inner.closeSubpath()
            }
            context.fill(inner, with: .color(palette.innerEar))
        }
        .frame(height: Self.earHeight)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The drawer's paper with its ears, as a shape (fill, texture, ruling and edge all follow it).
struct DrawerPaperShape: Shape {
    let right: Bool
    func path(in rect: CGRect) -> Path { DrawerCat.outline(in: rect, right: right) }
}

/// A memo's paper in the drawer (#14, sheet D, the user's pick 2026-10-28): a clean square sheet — no rules and no
/// margin line — with 16 pt round its words; the paper hints are the folder-colour tape, a 1 pt edge with a soft
/// shadow, and a row of tiny perforation holes along the straight top edge. Open or picked, the shadow goes a little
/// deeper instead of a box round it; picked (the keyboard's place) also takes a 2 pt edge in the folder's line colour
/// (#118), so it shows by depth and edge, not by colour alone. Used by the list, search results and 크게 보기.
struct MemoSlipStyle: ViewModifier {
    struct State {
        var open = false
        var selected = false
        /// The memo's folder (the picked edge takes its colour).
        var folder: MemoFolders.Color = .lavender
        /// 크게 보기: the whole drawer's height.
        var big = false
        /// At least this tall (68, dense 56).
        var minHeight: CGFloat = 0
        /// 바탕 없음: a deeper shadow (the sheet floats on the desktop).
        var floating = false
        /// More than 20 memos: a little less paper above and below the text (mock: dense).
        var dense = false
    }

    /// The memo's sheet: its own paper (이 메모의 종이) or the drawer's.
    let palette: DrawerPalette
    /// The drawer's paper (the folder's colours come from it).
    var drawer: DrawerPalette?
    let state: State

    /// Paper round the words (#14: 12 → 16; dense 10 above and below).
    static let top: CGFloat = 16
    static let bottom: CGFloat = 14
    static let side: CGFloat = 16
    /// The handwritten title's row (22 pt, option B); the body's lines and sizes are the drawer's setting (MemoText, #84).
    static let titleRow: CGFloat = 28
    static let kindRow: CGFloat = 24
    /// A collapsed card's least height (a title-only memo), and when dense.
    static let cardHeight: CGFloat = 68
    static let denseHeight: CGFloat = 56

    func body(content: Content) -> some View {
        let shape = SheetShape()
        let deep = state.open || state.selected
        content
            .padding(.horizontal, Self.side)
            .padding(.top, state.dense ? 10 : Self.top)
            .padding(.bottom, state.dense ? 9 : Self.bottom)
            // A card shorter than its least height (a title only) has its words in the middle, not at the top.
            .frame(maxWidth: .infinity, minHeight: state.minHeight, alignment: .leading)
            .background {
                ZStack(alignment: .topLeading) {
                    // The shadow on a plain rectangle only (cheap to draw), the sheet with its holes over it.
                    Rectangle().fill(palette.sheetBottom).padding(.top, 2).offset(y: 1)
                        .shadow(color: shadow(deep), radius: deep ? 9 : (state.floating ? 7 : 5), x: 0, y: deep ? 6 : 4)
                    shape.fill(palette.sheet)
                    shape.stroke(palette.sheetEdge, lineWidth: 1)
                }
            }
            .overlay {
                if state.selected && !state.open {
                    // #118: a 2 pt edge in the folder's line colour (3:1 on the sheet, scripts/check-contrast.py), so the
                    // keyboard's place shows by its edge, not by colour alone.
                    Rectangle().strokeBorder(DrawerPalette.openLine(state.folder, drawer: drawer ?? palette, sheet: palette), lineWidth: 2)
                        .allowsHitTesting(false)
                }
            }
            .contentShape(Rectangle())
    }

    private func shadow(_ deep: Bool) -> Color {
        if deep { return state.floating ? .black.opacity(0.34) : palette.deepShadow }
        return state.floating ? .black.opacity(0.22) : palette.shadow
    }
}

/// 메모 글꼴 · 크기 (#84, docs/plans/memo-markdown.md): the drawer's one face and size step for memo words, this Mac's
/// own (`drawer.font` · `drawer.textSize`; never in the shared folder). The body, an open memo, 크게 보기 and the editor
/// follow both; a card's preview follows only the step (always the plain face, so three lines cut alike). Lines are the
/// size × 1.85 (보통 14 → 26, as in 1.45). The handwriting faces run as much larger as the notebook's (pen 23 : 15,
/// brush 22 : 15), the Latin faces corrected as HandwritingFont does. The same steps as the Windows app.
struct MemoText: Equatable {
    enum Face: String, CaseIterable, Identifiable {
        case clean, pen, brush, mono
        var id: String { rawValue }
        var title: String {
            switch self {
            case .clean: L("기본 글씨")
            case .pen: L("손글씨 펜")
            case .brush: L("손글씨 붓")
            case .mono: L("고정폭")
            }
        }
        /// The notebook face it is (titles take it too), nil for the plain and fixed-width faces.
        var notebook: NotebookFont? {
            switch self {
            case .pen: .pen
            case .brush: .brush
            case .clean, .mono: nil
            }
        }
    }

    /// 글자 크기 (#141): nine steps of a point, 12–20 (1.45's four were 13 · 14 · 16 · 18, read as those points).
    enum Size: Int, CaseIterable, Identifiable {
        case pt12 = 12, pt13, pt14, pt15, pt16, pt17, pt18, pt19, pt20
        static let small = Size.pt13, regular = Size.pt14, large = Size.pt16, extraLarge = Size.pt18
        var id: Int { rawValue }
        var title: String { "\(rawValue) pt" }
        /// What VoiceOver says (‘14포인트’).
        var spoken: String { L("\(rawValue)포인트") }
        /// A snapshot's name: 1.45's four by their old names, the others by their points.
        var name: String { [13: "small", 14: "regular", 16: "large", 18: "extraLarge"][rawValue] ?? "\(rawValue)" }
    }

    /// 줄 간격 · 문단 간격 (#141, F2): the words' line (size × 1.6 · 1.85 · 2.1) and the room after a paragraph (+0 · 0.35 ·
    /// 0.7 of a line; a list's lines stay together).
    typealias LineSpacing = TextSteps.LineSpacing
    typealias ParagraphSpacing = TextSteps.ParagraphSpacing

    /// 코드 글꼴 (#143): the fixed-width face of code (a code block, `code`, the old code lines) and of the 고정폭 body —
    /// the system's (SF Mono, Hangul from Apple SD Gothic Neo) or the bundled D2Coding (NAVER, OFL), whose Hangul is two
    /// Latin columns wide, so a code line with Korean in it keeps its columns.
    enum CodeFace: String, CaseIterable, Identifiable {
        case system, d2coding
        var id: String { rawValue }
        var title: String {
            switch self {
            case .system: L("고정폭(시스템)")
            case .d2coding: "D2Coding"
            }
        }
    }

    var face: Face = .clean
    var size: Size = .regular
    var codeFace: CodeFace = .system
    /// 기호 늘 보이기 (#84, 2026-10-30): every line's marks shown faint, not only the caret's.
    var showMarks = false
    var lineSpacingChoice: LineSpacing = .regular
    var paragraphChoice: ParagraphSpacing = .regular

    private var metrics: TextSteps.DrawerMetrics { TextSteps.drawerMetrics(points: size.rawValue, line: lineSpacingChoice, paragraph: paragraphChoice) }
    /// 12–20 pt, on lines of size × 1.85 (보통 14 → 26, as in 1.45).
    var bodySize: CGFloat { CGFloat(metrics.body) }
    var line: CGFloat { CGFloat(metrics.line) }
    /// The room under a paragraph's last line.
    var paragraph: CGFloat { CGFloat(metrics.paragraph) }
    /// A card's preview: 11–16 pt (1.45's 12 · 13 · 14 · 15 at its four steps) on lines of × 20 / 13.
    var previewSize: CGFloat { CGFloat(metrics.preview) }
    var previewLine: CGFloat { CGFloat(metrics.previewLine) }

    /// The words' face at a scale of the body (headings 1.45 · 1.25 · 1.1).
    @MainActor func font(scale: CGFloat = 1) -> NSFont {
        let size = bodySize * scale
        switch face {
        case .clean: return .systemFont(ofSize: size)
        case .mono: return Self.mono((size - 1).rounded(), codeFace)
        case .pen: return HandwritingFont.native(face: .pen, size: (size * 23 / 15).rounded())
        case .brush: return HandwritingFont.native(face: .brush, size: (size * 22 / 15).rounded())
        }
    }

    /// Code (a code block, `code`, the old code lines): fixed-width a point under the body, in the 코드 글꼴.
    @MainActor var codeFont: NSFont { Self.mono(bodySize - 1, codeFace) }

    /// A fixed-width face at `size`: D2Coding when it's picked (and loaded), else the system's.
    @MainActor static func mono(_ size: CGFloat, _ face: CodeFace) -> NSFont {
        if face == .d2coding {
            HandwritingFont.register()
            if let font = NSFont(name: "D2Coding", size: size) { return font }
        }
        return .monospacedSystemFont(ofSize: size, weight: .regular)
    }

    /// Body text drawn so each line takes exactly `line`: the font's own line height plus this.
    @MainActor var lineSpacing: CGFloat { max(0, line - Self.lineHeight(font())) }
    /// The same for a card's preview lines (the plain face).
    @MainActor var previewSpacing: CGFloat { max(0, previewLine - Self.lineHeight(.systemFont(ofSize: previewSize))) }

    /// A face's own line height, worked out once per face and size (every card asks on every redraw of the list).
    @MainActor private static var heights: [String: CGFloat] = [:]
    @MainActor static func lineHeight(_ font: NSFont) -> CGFloat {
        let key = "\(font.fontName)@\(font.pointSize)"
        if let known = heights[key] { return known }
        let height = NSLayoutManager().defaultLineHeight(for: font)
        heights[key] = height
        return height
    }
}

/// The sheet: square, a row of half-holes along the top (where it was torn off).
struct SheetShape: Shape {
    func path(in rect: CGRect) -> Path {
        var sheet = Path(rect)
        var holes = Path()
        var x = rect.minX + 3
        while x < rect.maxX - 1 {
            holes.addEllipse(in: CGRect(x: x - 1.4, y: rect.minY - 1.4, width: 2.8, height: 2.8))
            x += 7
        }
        sheet = sheet.subtracting(holes)
        return sheet
    }
}

/// A piece of tape on a card's top edge (1.44): 30 × 10 in the folder's tape colour, half over the sheet; where it sits
/// (its left edge 20–65 % across) and its tilt (±2°) come from the memo's id, so it stays put across redraws and
/// launches — the same numbers as the Windows app (FNV-1a over the id's UTF-16 code units).
struct CardTape: View {
    let id: String
    let color: Color

    /// FNV-1a over the id's UTF-16 code units (Swift's own hash changes every launch).
    static func seed(_ id: String) -> UInt32 {
        var hash: UInt32 = 2_166_136_261
        for unit in id.utf16 { hash = (hash ^ UInt32(unit)) &* 16_777_619 }
        return hash
    }

    var body: some View {
        let seed = Self.seed(id)
        let across = (20 + Double(seed % 4501) / 100) / 100
        let tilt = Double((seed >> 16) % 401) / 100 - 2
        // One canvas (no GeometryReader): the list may hold many cards.
        Canvas { context, size in
            context.translateBy(x: size.width * across + 15, y: 5)
            context.rotate(by: .degrees(tilt))
            context.fill(Path(CGRect(x: -15, y: -5, width: 30, height: 10)), with: .color(color.opacity(0.85)))
        }
        .frame(height: 10)
        .offset(y: -5)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
