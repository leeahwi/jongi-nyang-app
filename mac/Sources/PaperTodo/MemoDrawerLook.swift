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

/// A memo's paper in the drawer (design B2, 1.44 ③): a square sheet of ruled notebook paper — a red margin line, rules
/// every 22 pt under the text lines (the first under the title), a straight top edge with one row of tiny perforation
/// holes, a 1 pt edge all round and a soft shadow (1.44). Open or picked, the margin line is 3 pt in the folder's
/// colour (DrawerPalette.openLine); picked also gets a 2 pt outline. Used by the list, search results and 크게 보기.
struct MemoSlipStyle: ViewModifier {
    struct State {
        var open = false
        var selected = false
        /// The memo's folder (the line takes its colour when picked or open).
        var folder: MemoFolders.Color = .lavender
        /// 크게 보기: the whole drawer's height.
        var big = false
        /// At least this tall (68, dense 56); the ruling runs on into the room.
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

    static let top: CGFloat = 13
    static let bottom: CGFloat = 10
    static let titleRow: CGFloat = 26
    static let line: CGFloat = 22
    static let leading: CGFloat = 22
    static let margin: CGFloat = 14.5
    static let bodySize: CGFloat = 12.5
    /// A collapsed card's least height (a title-only memo as tall as a title and one preview line), and when dense.
    static let cardHeight: CGFloat = 68
    static let denseHeight: CGFloat = 56
    /// Body text drawn so each line takes exactly one rule's height: the font's own line height plus this.
    @MainActor static let lineSpacing: CGFloat = {
        let font = NSFont.systemFont(ofSize: bodySize)
        return max(0, line - NSLayoutManager().defaultLineHeight(for: font))
    }()

    func body(content: Content) -> some View {
        let shape = SheetShape()
        let top = state.dense ? 9 : Self.top
        let marked = state.open || state.selected
        let line = DrawerPalette.openLine(state.folder, drawer: drawer ?? palette, sheet: palette)
        content
            .padding(.leading, Self.leading)
            .padding(.trailing, 12)
            .padding(.top, top)
            .padding(.bottom, state.dense ? 6 : Self.bottom)
            .frame(maxWidth: .infinity, minHeight: state.minHeight, alignment: .topLeading)
            .background {
                ZStack(alignment: .topLeading) {
                    // The shadow on a plain rectangle only (cheap to draw), the sheet with its holes and ruling over it.
                    Rectangle().fill(palette.sheetBottom).padding(.top, 2).offset(y: 1)
                        .shadow(color: state.floating ? .black.opacity(0.22) : palette.shadow, radius: state.floating ? 7 : 5, x: 0, y: 4)
                    shape.fill(palette.sheet)
                    Canvas { context, size in
                        var rules = Path()
                        // Each rule is the last point of its line's band.
                        var y = top + Self.titleRow - 1
                        while y < size.height - 2 {
                            rules.addRect(CGRect(x: 0, y: y, width: size.width, height: 1))
                            y += Self.line
                        }
                        context.fill(rules, with: .color(palette.sheetRule))
                        let x = marked ? Self.margin - 1 : Self.margin
                        context.fill(Path(CGRect(x: x, y: 0, width: marked ? 3 : 1, height: size.height)), with: .color(marked ? line : palette.sheetMargin))
                    }
                    .clipShape(shape)
                    shape.stroke(palette.sheetEdge, lineWidth: 1)
                }
            }
            .overlay {
                if state.selected && !state.open { Rectangle().strokeBorder(line, lineWidth: 2).padding(-1).allowsHitTesting(false) }
            }
            .contentShape(Rectangle())
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
