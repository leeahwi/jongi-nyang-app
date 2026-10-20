import Foundation

/// How big the floating focus timer (the cat holding its tag) is drawn: Settings → 타이머, or
/// 크기 in its right-click menu. Same steps as the Windows app (timerWidget.ts).
public enum TimerSize: String, CaseIterable, Sendable {
    case small, regular, large, extraLarge

    public var scale: Double {
        switch self {
        case .small: 0.8
        case .regular: 1
        case .large: 1.25
        case .extraLarge: 1.5
        }
    }

    public var title: String { title(.ko) }

    /// "작게", "보통", "크게", "아주 크게" — en "Small", "Regular", "Large", "Extra large"; nl "Klein", "Normaal", "Groot", "Extra groot".
    public func title(_ language: AppLanguage) -> String {
        let titles: [String] = switch language {
        case .ko: ["작게", "보통", "크게", "아주 크게"]
        case .en: ["Small", "Regular", "Large", "Extra large"]
        case .nl: ["Klein", "Normaal", "Groot", "Extra groot"]
        }
        return titles[Self.allCases.firstIndex(of: self)!]
    }
}
