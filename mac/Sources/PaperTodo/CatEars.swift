import SwiftUI

/// The cat's two ears on a paper's top edge (#151): 메모 서랍's ears (`DrawerCat`, design B2) as a shared shape, so the
/// note window can stand the same ears above its top edge. The numbers are the drawer's — 16 pt tall, the bases 16–48
/// and 62–92 pt in from the edge they stand toward, a little rounded tip, a pink triangle inside.
/// (`DrawerCat` in MemoDrawerLook.swift still draws its own copy; it can draw through this later.)
enum CatEars {
    /// How far the tips stand above the edge.
    nonisolated static let height: CGFloat = 16
    /// Each ear's base, measured in from the edge they stand toward: the far ear first (the left one when they stand
    /// toward the right), then the near one.
    nonisolated static let bases: [(near: CGFloat, far: CGFloat)] = [(62, 92), (16, 48)]
    /// From the edge they stand toward to the far ear's far foot.
    nonisolated static let span: CGFloat = 92

    /// One ear's base along the edge, left to right, in a box `width` wide.
    nonisolated static func base(_ index: Int, width: CGFloat, right: Bool) -> (a: CGFloat, b: CGFloat) {
        let ear = bases[index]
        return right ? (width - ear.far, width - ear.near) : (ear.near, ear.far)
    }

    /// One ear standing on `edge` (y grows downward), its tip `height` above; `below` runs its base that much further
    /// down, over the paper it stands on, so no seam shows between them.
    nonisolated static func ear(from a: CGFloat, to b: CGFloat, edge: CGFloat, below: CGFloat = 0) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: a, y: edge + below))
        addSides(&path, from: a, to: b, edge: edge)
        path.addLine(to: CGPoint(x: b, y: edge + below))
        path.closeSubpath()
        return path
    }

    /// The ear's two sides and its tip, open along the base (for an edge line that leaves the base to the paper).
    nonisolated static func sides(from a: CGFloat, to b: CGFloat, edge: CGFloat) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: a, y: edge))
        addSides(&path, from: a, to: b, edge: edge)
        return path
    }

    /// The pink inside: a small triangle, 11 pt wide at 3 pt above the edge, its top 5 pt under the tip.
    nonisolated static func inner(from a: CGFloat, to b: CGFloat, edge: CGFloat) -> Path {
        let peak = (a + b) / 2, tip = edge - height
        var path = Path()
        path.move(to: CGPoint(x: peak - 5.5, y: tip + 13))
        path.addLine(to: CGPoint(x: peak, y: tip + 5))
        path.addLine(to: CGPoint(x: peak + 5.5, y: tip + 13))
        path.closeSubpath()
        return path
    }

    /// The same sides as `DrawerCat.addEar`: straight up to just under the tip, a little curve over it, straight down.
    nonisolated private static func addSides(_ path: inout Path, from a: CGFloat, to b: CGFloat, edge: CGFloat) {
        let peak = (a + b) / 2, tip = edge - height
        path.addLine(to: CGPoint(x: a, y: edge))
        path.addLine(to: CGPoint(x: peak - 1.6, y: tip + 1.8))
        path.addQuadCurve(to: CGPoint(x: peak + 1.6, y: tip + 1.8), control: CGPoint(x: peak, y: tip))
        path.addLine(to: CGPoint(x: b, y: edge))
    }
}
