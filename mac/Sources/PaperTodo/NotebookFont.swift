import SwiftUI

enum NotebookFont: String, CaseIterable, Identifiable {
    case pen
    case brush
    case clean

    var id: String { rawValue }

    var title: String {
        switch self {
        case .pen: L("손글씨 펜")
        case .brush: L("손글씨 붓")
        case .clean: L("기본 글씨")
        }
    }

    var preview: String { L("오늘 할 일") }

    @MainActor
    func bodyFont(_ textSize: NotebookTextSize = .regular) -> Font {
        let size = bodySize(textSize)
        switch self {
        case .pen: return HandwritingFont.swiftUI(face: .pen, size: size)
        case .brush: return HandwritingFont.swiftUI(face: .brush, size: size)
        case .clean: return .system(size: size)
        }
    }

    /// The Latin handwriting's taller line (see HandwritingFont.extraLineHeight); zero for the clean face.
    @MainActor
    func extraLineHeight(_ textSize: NotebookTextSize = .regular) -> (top: CGFloat, bottom: CGFloat) {
        switch self {
        case .pen: HandwritingFont.extraLineHeight(face: .pen, size: bodySize(textSize))
        case .brush: HandwritingFont.extraLineHeight(face: .brush, size: bodySize(textSize))
        case .clean: (0, 0)
        }
    }

    func bodySize(_ textSize: NotebookTextSize = .regular) -> CGFloat {
        let base: CGFloat = switch self {
        case .pen: 23
        case .brush: 22
        case .clean: 15
        }
        return (base * textSize.scale).rounded()
    }

    /// A handwritten size given in pen points (the focus card's 30 pt title): the brush runs a little
    /// smaller for the same look, the clean face in the UI font.
    @MainActor
    func font(points: CGFloat) -> Font {
        switch self {
        case .pen: HandwritingFont.swiftUI(face: .pen, size: points)
        case .brush: HandwritingFont.swiftUI(face: .brush, size: (points * 0.93).rounded())
        case .clean: .system(size: (points * 0.72).rounded(), weight: .medium)
        }
    }

    @MainActor
    func titleFont() -> Font {
        switch self {
        case .pen:
            return HandwritingFont.swiftUI(face: .pen, size: 35)
        case .brush:
            return HandwritingFont.swiftUI(face: .brush, size: 32)
        case .clean:
            return .system(size: 27, weight: .semibold)
        }
    }
}

/// Four steps that all still fit the 44 pt ruled line.
enum NotebookTextSize: String, CaseIterable, Identifiable {
    case small, regular, large, extraLarge

    var id: String { rawValue }
    var title: String {
        switch self {
        case .small: L("작게")
        case .regular: L("보통")
        case .large: L("크게")
        case .extraLarge: L("아주 크게")
        }
    }
    var scale: CGFloat {
        switch self {
        case .small: 0.87
        case .regular: 1
        case .large: 1.13
        case .extraLarge: 1.26
        }
    }
    var larger: NotebookTextSize? { Self.allCases.firstIndex(of: self).flatMap { Self.allCases.indices.contains($0 + 1) ? Self.allCases[$0 + 1] : nil } }
    var smaller: NotebookTextSize? { Self.allCases.firstIndex(of: self).flatMap { $0 > 0 ? Self.allCases[$0 - 1] : nil } }
}
