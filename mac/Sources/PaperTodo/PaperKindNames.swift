import PaperCore

// 종이 (#244): the fifteen papers' names in the app's language (PaperKind.names holds the same three, which the shared
// cases and LocalizationTests check against these).
extension PaperKind {
    /// The tile's name, the popup's row: 낮 종이 · 크라프트지 · 노란 메모지 ….
    var title: String {
        switch self {
        case .day: L("낮 종이")
        case .hanji: L("한지")
        case .kraft: L("크라프트지")
        case .grid: L("모눈 노트")
        case .sage: L("쑥색 종이")
        case .blossom: L("벚꽃 종이")
        case .memo: L("노란 메모지")
        case .manuscript: L("원고지")
        case .lined: L("하늘색 줄노트")
        case .lavender: L("라벤더 종이")
        case .recycled: L("재생지")
        case .night: L("밤 종이")
        case .ink: L("먹색 종이")
        case .nightsky: L("밤하늘 종이")
        case .chalk: L("칠판")
        }
    }

    /// The swatch's word in the drawer's ⚙ menu: 낮 · 크라프트 · 메모지 …. 메모지 · 원고지 · 재생지 are in the Drawer table:
    /// the same Korean is the memo cards' name, or the paper's whole name, elsewhere.
    var short: String {
        switch self {
        case .day: L("낮")
        case .hanji: L("한지")
        case .kraft: L("크라프트")
        case .grid: L("모눈")
        case .sage: L("쑥색")
        case .blossom: L("벚꽃")
        case .memo: String(localized: "메모지", table: "Drawer")
        case .manuscript: String(localized: "원고지", table: "Drawer")
        case .lined: L("줄노트")
        case .lavender: L("라벤더")
        case .recycled: String(localized: "재생지", table: "Drawer")
        case .night: L("밤")
        case .ink: L("먹색")
        case .nightsky: L("밤하늘")
        case .chalk: L("칠판")
        }
    }

    /// What VoiceOver reads for a tile: ‘노란 메모지, 밝은 종이’ (선택됨 is the system's, from the selected trait).
    var spoken: String { isDark ? L("\(title), 어두운 종이") : L("\(title), 밝은 종이") }
}

extension NightChoice {
    /// 밤에는's rows: 그대로, then the four dark papers.
    var title: String { paper?.title ?? L("그대로") }
}
