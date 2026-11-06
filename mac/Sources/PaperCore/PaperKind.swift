import Foundation

/// 종이 (#244, docs/plans/paper-themes.md 2장): the fifteen papers the whole app picks from — the note, the desk calendar, the
/// widgets, the slips, the desk and (unless it picks its own) the drawer. The keys, the order (light papers, then dark ones:
/// the tiles' and the arrow keys' order), each paper's lightness, ruling and grain, and its names in three languages are the
/// same as the Windows app's `core/paper.ts`; the colours are in `docs/plans/paper-themes/tokens.json`
/// (`NotePalette.swift`, `MemoDrawerTheme.swift`).
public enum PaperKind: String, CaseIterable, Sendable, Identifiable {
    case day, hanji, kraft, grid, sage, blossom, memo, manuscript, lined, lavender, recycled
    case night, ink, nightsky, chalk

    public var id: String { rawValue }

    public enum Scheme: String, Sendable { case light, dark }

    /// How the note is ruled: lines every row (44 pt), 모눈's squares (11 pt, four to a row), 원고지's red cells (two rules a
    /// row and a stroke every 22 pt), 하늘색 줄노트's blue lines with a red margin (2 pt).
    public enum Ruling: String, Sendable {
        case lines, grid, manuscript, margin

        /// The squares and cells run under the rows too; lines are each row's own line.
        public var fillsRows: Bool { self == .grid || self == .manuscript }
    }

    public var scheme: Scheme {
        switch self {
        case .night, .ink, .nightsky, .chalk: .dark
        default: .light
        }
    }

    public var isDark: Bool { scheme == .dark }

    public var ruling: Ruling {
        switch self {
        case .grid: .grid
        case .manuscript: .manuscript
        case .lined: .margin
        default: .lines
        }
    }

    /// The paper's grain (the texture's opacity): stronger on 한지 · 크라프트지 · 재생지, none on 메모지 · 모눈 · 줄노트 and the
    /// dark papers. Off under Increase Contrast whatever this says.
    public var grain: Double {
        switch self {
        case .day: 0.22
        case .hanji, .kraft: 0.30
        case .recycled: 0.35
        case .sage, .blossom, .lavender: 0.18
        case .manuscript: 0.12
        case .grid, .memo, .lined, .night, .ink, .nightsky, .chalk: 0
        }
    }

    /// One of the seven added in 1.48 (the tiles say 새 nowhere; the snapshots and the changelog do).
    public var isNew: Bool {
        switch self {
        case .memo, .manuscript, .lined, .lavender, .recycled, .nightsky, .chalk: true
        default: false
        }
    }

    public static let light: [PaperKind] = allCases.filter { !$0.isDark }
    public static let dark: [PaperKind] = allCases.filter(\.isDark)

    /// The next (or previous) tile: one radio group of fifteen, wrapping round (← → ↑ ↓, K1).
    public func step(_ by: Int) -> PaperKind {
        let all = Self.allCases
        let at = all.firstIndex(of: self)!
        return all[((at + by) % all.count + all.count) % all.count]
    }

    /// Names: the tile's and the popup's (`ko`), the drawer ⚙ menu's short one, English and Dutch.
    public struct Names: Equatable, Sendable {
        public let ko: String
        public let short: String
        public let en: String
        public let nl: String

        public func name(_ language: AppLanguage) -> String {
            switch language {
            case .ko: ko
            case .en: en
            case .nl: nl
            }
        }
    }

    public var names: Names {
        switch self {
        case .day: Names(ko: "낮 종이", short: "낮", en: "Day paper", nl: "Dagpapier")
        case .hanji: Names(ko: "한지", short: "한지", en: "Hanji", nl: "Hanji")
        case .kraft: Names(ko: "크라프트지", short: "크라프트", en: "Kraft paper", nl: "Kraftpapier")
        case .grid: Names(ko: "모눈 노트", short: "모눈", en: "Grid notebook", nl: "Ruitjesschrift")
        case .sage: Names(ko: "쑥색 종이", short: "쑥색", en: "Sage", nl: "Salie")
        case .blossom: Names(ko: "벚꽃 종이", short: "벚꽃", en: "Blossom", nl: "Bloesem")
        case .memo: Names(ko: "노란 메모지", short: "메모지", en: "Sticky note", nl: "Plakbriefje")
        case .manuscript: Names(ko: "원고지", short: "원고지", en: "Manuscript paper", nl: "Manuscriptpapier")
        case .lined: Names(ko: "하늘색 줄노트", short: "줄노트", en: "Blue lined notebook", nl: "Blauw lijntjesschrift")
        case .lavender: Names(ko: "라벤더 종이", short: "라벤더", en: "Lavender", nl: "Lavendel")
        case .recycled: Names(ko: "재생지", short: "재생지", en: "Recycled paper", nl: "Kringlooppapier")
        case .night: Names(ko: "밤 종이", short: "밤", en: "Night paper", nl: "Nachtpapier")
        case .ink: Names(ko: "먹색 종이", short: "먹색", en: "Ink", nl: "Inkt")
        case .nightsky: Names(ko: "밤하늘 종이", short: "밤하늘", en: "Night sky", nl: "Nachthemel")
        case .chalk: Names(ko: "칠판", short: "칠판", en: "Chalkboard", nl: "Schoolbord")
        }
    }

    /// What VoiceOver reads for a tile (K2): its name and its lightness (the state, 선택됨, is the system's).
    public func spokenLabel(_ language: AppLanguage) -> String {
        let lightness: String = switch (language, scheme) {
        case (.ko, .light): "밝은 종이"
        case (.ko, .dark): "어두운 종이"
        case (.en, .light): "light paper"
        case (.en, .dark): "dark paper"
        case (.nl, .light): "licht papier"
        case (.nl, .dark): "donker papier"
        }
        return "\(names.name(language)), \(lightness)"
    }
}

/// 밤에는 (3-2): what a light paper turns into at night — 그대로 (keep it) or one of the four dark papers (밤 종이 by default).
public enum NightChoice: String, CaseIterable, Sendable, Identifiable {
    case keep, night, ink, nightsky, chalk

    public var id: String { rawValue }

    /// The dark paper (nil for 그대로).
    public var paper: PaperKind? {
        switch self {
        case .keep: nil
        case .night: .night
        case .ink: .ink
        case .nightsky: .nightsky
        case .chalk: .chalk
        }
    }
}
