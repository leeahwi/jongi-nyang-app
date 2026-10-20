import AppKit
import SwiftUI

/// A small textured foreground paw shared by the waving and peeking characters.
struct PaperPaw: View {
    var showsPads = false

    var body: some View {
        PaperPawOutline()
            .fill(Color(red: 0.97, green: 0.90, blue: 0.77))
            .overlay {
                // Sized to the paw before clipping: a scaled-to-fill image is larger than its frame, and
                // clipping that drew a bigger paw-shaped smudge around the paw (grey at night).
                Color.clear
                    .overlay { Image(nsImage: PaperTheme.texture).resizable().scaledToFill().opacity(0.30) }
                    .clipShape(PaperPawOutline())
            }
            .overlay {
                PaperPawOutline().stroke(Color(red: 0.42, green: 0.30, blue: 0.19).opacity(0.9), lineWidth: 0.95)
            }
            .overlay {
                if showsPads {
                    GeometryReader { geometry in
                        let w = geometry.size.width
                        let h = geometry.size.height
                        Ellipse().fill(Color(red: 0.66, green: 0.43, blue: 0.28))
                            .frame(width: w * 0.42, height: h * 0.26)
                            .position(x: w * 0.5, y: h * 0.61)
                        ForEach(0..<3) { index in
                            Ellipse().fill(Color(red: 0.66, green: 0.43, blue: 0.28))
                                .frame(width: w * 0.16, height: h * 0.14)
                                .position(x: w * (0.29 + CGFloat(index) * 0.21), y: h * 0.34)
                        }
                    }
                }
            }
            .accessibilityHidden(true)
    }

    @MainActor static func drawResting(in rect: CGRect) {
        guard let context = NSGraphicsContext.current?.cgContext else { return }
        context.saveGState()
        defer { context.restoreGState() }
        context.translateBy(x: rect.minX, y: rect.maxY)
        context.scaleBy(x: 1, y: -1)
        let bounds = CGRect(origin: .zero, size: rect.size)
        let path = PaperPawOutline().path(in: bounds).cgPath
        context.addPath(path)
        context.setFillColor(NSColor(red: 0.97, green: 0.90, blue: 0.77, alpha: 1).cgColor)
        context.fillPath()
        context.saveGState()
        context.addPath(path)
        context.clip()
        PaperTheme.texture.draw(in: bounds, from: .zero, operation: .sourceOver, fraction: 0.24)
        context.restoreGState()
        context.addPath(path)
        context.setStrokeColor(NSColor(red: 0.42, green: 0.30, blue: 0.19, alpha: 0.85).cgColor)
        context.setLineWidth(0.85)
        context.strokePath()
        context.setLineWidth(0.55)
        context.setLineCap(.round)
        for fraction in [0.37, 0.62] {
            context.move(to: CGPoint(x: bounds.width * fraction, y: bounds.height * 0.59))
            context.addLine(to: CGPoint(x: bounds.width * fraction, y: bounds.height * 0.82))
        }
        context.strokePath()
    }
}

private struct PaperPawOutline: Shape {
    func path(in rect: CGRect) -> Path {
        let r = rect.insetBy(dx: 0.6, dy: 0.6)
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: r.minX + x * r.width, y: r.minY + y * r.height)
        }
        var path = Path()
        path.move(to: p(0.23, 0.92))
        path.addCurve(to: p(0.09, 0.27), control1: p(0, 0.76), control2: p(0, 0.43))
        path.addCurve(to: p(0.51, 0.07), control1: p(0.14, 0.03), control2: p(0.37, 0))
        path.addCurve(to: p(0.91, 0.28), control1: p(0.73, 0), control2: p(0.89, 0.12))
        path.addCurve(to: p(0.76, 0.94), control1: p(1, 0.48), control2: p(1, 0.77))
        path.addQuadCurve(to: p(0.23, 0.92), control: p(0.49, 1.05))
        path.closeSubpath()
        return path
    }
}
