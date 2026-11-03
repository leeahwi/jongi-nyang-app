import PaperCore
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

/// Seven steps that all still fit the 44 pt ruled line (#141): 1.45's four — 작게 · 보통 · 크게 · 아주 크게 — are the
/// 1st, 3rd, 5th and 7th, so no one's size changes (PaperCore TextSteps, the same table as the Windows app).
enum NotebookTextSize: Int, CaseIterable, Identifiable {
    case small, smallish, regular, largish, large, larger, extraLarge

    var id: Int { rawValue }
    var title: String {
        switch self {
        case .small: L("작게")
        case .smallish: L("조금 작게")
        case .regular: L("보통")
        case .largish: L("조금 크게")
        case .large: L("크게")
        case .larger: L("더 크게")
        case .extraLarge: L("아주 크게")
        }
    }
    var scale: CGFloat { CGFloat(TextSteps.noteScales[rawValue]) }
    var larger: NotebookTextSize? { NotebookTextSize(rawValue: rawValue + 1) }
    var smaller: NotebookTextSize? { NotebookTextSize(rawValue: rawValue - 1) }
    /// `steps` steps up (down when negative), held at the ends.
    func stepped(_ steps: Int) -> NotebookTextSize { NotebookTextSize(rawValue: TextSteps.clampNote(rawValue + steps))! }

    /// Read from this Mac's settings: `textStep`, or 1.45's `textSize`.
    static func saved(in preferences: UserDefaults) -> NotebookTextSize {
        let step = preferences.object(forKey: "textStep") as? Int
        return NotebookTextSize(rawValue: TextSteps.noteStep(saved: step, legacy: preferences.string(forKey: "textSize")))!
    }

    /// Written as its step, and as the nearest of 1.45's four for an older version.
    func save(in preferences: UserDefaults) {
        preferences.set(rawValue, forKey: "textStep")
        preferences.set(TextSteps.noteLegacyName(rawValue), forKey: "textSize")
    }
}
