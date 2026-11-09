import CoreGraphics
import Foundation

/// 종이냥 펫과 타닥냥의 크기 (#304, docs/plans/cat-size-cases.json — the Windows app's catSize.ts reads the same file):
/// 작게 · 보통 · 크게 · 아주 크게, chosen apart for each in 책상 → 종이냥 (`pet.size`, `typing.size`). The steps, scales and
/// names are the timer's (`TimerSize`). 보통 is a scale of 1: the cats as they were before #304, to the pixel.
public enum CatSize: String, CaseIterable, Sendable {
    case small, regular, large, extraLarge

    /// As saved; anything else, or nothing, is 보통.
    public init(saved: String?) { self = saved.flatMap(CatSize.init(rawValue:)) ?? .regular }

    public var scale: CGFloat {
        switch self {
        case .small: 0.8
        case .regular: 1
        case .large: 1.25
        case .extraLarge: 1.5
        }
    }

    /// ko, en and nl: "작게" "Small" "Klein" … — the timer's words (`TimerSize`).
    public var names: [String] {
        switch self {
        case .small: ["작게", "Small", "Klein"]
        case .regular: ["보통", "Regular", "Normaal"]
        case .large: ["크게", "Large", "Groot"]
        case .extraLarge: ["아주 크게", "Extra large", "Extra groot"]
        }
    }

    /// A base size at this step, rounded to a whole point.
    public func scaled(_ base: CGFloat) -> CGFloat { (base * scale).rounded() }

    // MARK: The pet (base 92 pt)

    public static let petBase: CGFloat = 92
    /// The floor strip above the Dock at 보통.
    public static let stripBase: CGFloat = 250

    /// The cat's size: 74 · 92 · 115 · 138.
    public var petSize: CGFloat { scaled(Self.petBase) }

    /// The paws' stride (192 of the art's 1024 at the cat's size). The walk's pace stays, so the planted paws don't slide.
    public static func stride(_ size: CGFloat) -> CGFloat { 192 * size / 1024 }

    /// The strip grows by what the cat grew, so a question's bubble and buttons (the cat + 150) still fit above it.
    public static func stripHeight(_ size: CGFloat) -> CGFloat { stripBase + max(0, size - petBase) }

    /// How far the cat's centre keeps from the floor's ends (70 at 보통).
    public static func margin(_ size: CGFloat) -> CGFloat { (70 * size / petBase).rounded() }

    /// Keeps a centre on the floor, clear of its ends.
    public static func clamp(_ x: CGFloat, width: CGFloat, size: CGFloat) -> CGFloat {
        let margin = margin(size)
        return min(max(x, margin), max(margin, width - margin))
    }

    // MARK: 타닥냥 (base 112 pt)

    /// Its window's side: 90 · 112 · 140 · 168.
    public var typingSize: CGFloat { scaled(TypingCorner.size) }
}
