import PaperCore

/// The note's colours on each of the fifteen papers (#244): the values of docs/plans/paper-themes/tokens.json (`note` and
/// `eventMarks`), the same as the Windows app's `renderer/papers.css`. 낮 종이 and 밤 종이 are 1.47's `PaperTheme` colours;
/// the others start from them and are a step darker (lighter on a dark paper) where a pair fell below AA. `PaperTheme` draws
/// them through `PaperLook`; `scripts/check-contrast.py` reads the `pair(` lines below, checks every pair on every paper
/// against WCAG AA and that each value is tokens.json's.
///
/// `mark*`: an event's bar and dot (and its tint) on this paper — its colour (`LocalEvent.Color`) a step deeper where it
/// stood below 3:1 on the paper or a card (Q6); on a dark paper already at 85 % brightness as 1.47 drew it at night.
struct NotePalette: Sendable {
    enum Token: Int, CaseIterable, Sendable {
        case paper, paper2, card, raised, ink, ink2, ink3, faint
        case rule, sage, sage2, sageText, onSage, clay, clay2, clayText
        case switchKnob, marginRule, checkBorder, tabToday, tabAhead, tabTodayEdge, tabAheadEdge, tabInk
        case tintToday, tintAhead, tabMemo, tapeHoney, tapeLavender, tapeSky, tapeMint, tapeRose
        case tapeNeutral, tapeHoneyEdge, tapeLavenderEdge, tapeSkyEdge, tapeMintEdge, tapeRoseEdge, tapeNeutralEdge, eventBlue
        case eventTint, memoPurple, memoTint, stamp, lavenderText, honeyText, honey2, toastBack
        case toastText, toastAction, toastKind, desk, spaceLavender, spacePink, spaceMint, spaceYellow
        case spaceSky, spacePeach, spaceSand, spaceGray, markBlue, markSage, markCoral, markPurple
        case markYellow, markGray
    }

    let kind: PaperKind
    let paper, paper2, card, raised, ink, ink2, ink3, faint, rule, sage: String
    let sage2, sageText, onSage, clay, clay2, clayText, switchKnob, marginRule, checkBorder, tabToday: String
    let tabAhead, tabTodayEdge, tabAheadEdge, tabInk, tintToday, tintAhead, tabMemo, tapeHoney, tapeLavender, tapeSky: String
    let tapeMint, tapeRose, tapeNeutral, tapeHoneyEdge, tapeLavenderEdge, tapeSkyEdge, tapeMintEdge, tapeRoseEdge, tapeNeutralEdge, eventBlue: String
    let eventTint, memoPurple, memoTint, stamp, lavenderText, honeyText, honey2, toastBack, toastText, toastAction: String
    let toastKind, desk, spaceLavender, spacePink, spaceMint, spaceYellow, spaceSky, spacePeach, spaceSand, spaceGray: String
    let markBlue, markSage, markCoral, markPurple, markYellow, markGray: String

    /// The colour as "#rrggbb".
    func hex(_ token: Token) -> String {
        switch token {
        case .paper: paper
        case .paper2: paper2
        case .card: card
        case .raised: raised
        case .ink: ink
        case .ink2: ink2
        case .ink3: ink3
        case .faint: faint
        case .rule: rule
        case .sage: sage
        case .sage2: sage2
        case .sageText: sageText
        case .onSage: onSage
        case .clay: clay
        case .clay2: clay2
        case .clayText: clayText
        case .switchKnob: switchKnob
        case .marginRule: marginRule
        case .checkBorder: checkBorder
        case .tabToday: tabToday
        case .tabAhead: tabAhead
        case .tabTodayEdge: tabTodayEdge
        case .tabAheadEdge: tabAheadEdge
        case .tabInk: tabInk
        case .tintToday: tintToday
        case .tintAhead: tintAhead
        case .tabMemo: tabMemo
        case .tapeHoney: tapeHoney
        case .tapeLavender: tapeLavender
        case .tapeSky: tapeSky
        case .tapeMint: tapeMint
        case .tapeRose: tapeRose
        case .tapeNeutral: tapeNeutral
        case .tapeHoneyEdge: tapeHoneyEdge
        case .tapeLavenderEdge: tapeLavenderEdge
        case .tapeSkyEdge: tapeSkyEdge
        case .tapeMintEdge: tapeMintEdge
        case .tapeRoseEdge: tapeRoseEdge
        case .tapeNeutralEdge: tapeNeutralEdge
        case .eventBlue: eventBlue
        case .eventTint: eventTint
        case .memoPurple: memoPurple
        case .memoTint: memoTint
        case .stamp: stamp
        case .lavenderText: lavenderText
        case .honeyText: honeyText
        case .honey2: honey2
        case .toastBack: toastBack
        case .toastText: toastText
        case .toastAction: toastAction
        case .toastKind: toastKind
        case .desk: desk
        case .spaceLavender: spaceLavender
        case .spacePink: spacePink
        case .spaceMint: spaceMint
        case .spaceYellow: spaceYellow
        case .spaceSky: spaceSky
        case .spacePeach: spacePeach
        case .spaceSand: spaceSand
        case .spaceGray: spaceGray
        case .markBlue: markBlue
        case .markSage: markSage
        case .markCoral: markCoral
        case .markPurple: markPurple
        case .markYellow: markYellow
        case .markGray: markGray
        }
    }

    /// An event's mark on this paper, by its colour.
    func mark(_ color: LocalEvent.Color) -> String {
        switch color {
        case .blue: markBlue
        case .sage: markSage
        case .coral: markCoral
        case .purple: markPurple
        case .yellow: markYellow
        case .gray: markGray
        }
    }

    static func of(_ kind: PaperKind) -> NotePalette {
        switch kind {
        case .day: day
        case .hanji: hanji
        case .kraft: kraft
        case .grid: grid
        case .sage: sage
        case .blossom: blossom
        case .memo: memo
        case .manuscript: manuscript
        case .lined: lined
        case .lavender: lavender
        case .recycled: recycled
        case .night: night
        case .ink: ink
        case .nightsky: nightsky
        case .chalk: chalk
        }
    }

    /// One colour as written (named so the contrast check finds each paper's values).
    static func pair(_ hex: String) -> String { hex }

    /// 낮 종이 (Day paper).
    static let day = NotePalette(
        kind: .day,
        paper: pair("#fbf9f3"), paper2: pair("#f5f1e7"), card: pair("#fffdf8"), raised: pair("#fffdf8"), ink: pair("#2f2e2a"),
        ink2: pair("#6b685e"), ink3: pair("#726e64"), faint: pair("#a5a195"), rule: pair("#e6e0d2"), sage: pair("#5c7a5a"),
        sage2: pair("#e4ebe0"), sageText: pair("#546f52"), onSage: pair("#fffdf8"), clay: pair("#b06a4f"), clay2: pair("#f6e3db"),
        clayText: pair("#955842"), switchKnob: pair("#ffffff"), marginRule: pair("#e7d8ce"), checkBorder: pair("#908a7b"), tabToday: pair("#f6dc7c"),
        tabAhead: pair("#d6ccf6"), tabTodayEdge: pair("#dcc062"), tabAheadEdge: pair("#bdb0ea"), tabInk: pair("#2f2e2a"), tintToday: pair("#f5e7b2"),
        tintAhead: pair("#e3ddf2"), tabMemo: pair("#f3dbd7"), tapeHoney: pair("#e9cf7a"), tapeLavender: pair("#cfc6ea"), tapeSky: pair("#bcd0ea"),
        tapeMint: pair("#c9dcc4"), tapeRose: pair("#ecc4bc"), tapeNeutral: pair("#d9d3c4"), tapeHoneyEdge: pair("#c8b269"), tapeLavenderEdge: pair("#b2aac9"),
        tapeSkyEdge: pair("#a2b3c9"), tapeMintEdge: pair("#adbda9"), tapeRoseEdge: pair("#cba9a2"), tapeNeutralEdge: pair("#bbb5a9"), eventBlue: pair("#5585cc"),
        eventTint: pair("#e2eaf6"), memoPurple: pair("#7a6aae"), memoTint: pair("#ebe6f6"), stamp: pair("#4d5b86"), lavenderText: pair("#62559a"),
        honeyText: pair("#755e12"), honey2: pair("#f5ebc6"), toastBack: pair("#2f2e2a"), toastText: pair("#fbf9f3"), toastAction: pair("#f6d9c7"),
        toastKind: pair("#cfe3c9"), desk: pair("#efeadf"), spaceLavender: pair("#897ccf"), spacePink: pair("#d16776"), spaceMint: pair("#54966a"),
        spaceYellow: pair("#a78527"), spaceSky: pair("#578bcd"), spacePeach: pair("#d46b2b"), spaceSand: pair("#9f8550"), spaceGray: pair("#8c887e"),
        markBlue: pair("#5b8bd0"), markSage: pair("#6b8f71"), markCoral: pair("#ce705a"), markPurple: pair("#8e7cc3"), markYellow: pair("#aa8623"),
        markGray: pair("#8a8a8a"))

    /// 한지 (Hanji).
    static let hanji = NotePalette(
        kind: .hanji,
        paper: pair("#f7f2e7"), paper2: pair("#eee7d8"), card: pair("#fffcf5"), raised: pair("#fffcf5"), ink: pair("#2b2925"),
        ink2: pair("#5a564d"), ink3: pair("#5f5b52"), faint: pair("#a39d8e"), rule: pair("#e4dccb"), sage: pair("#577456"),
        sage2: pair("#e0e4d4"), sageText: pair("#50694e"), onSage: pair("#fffcf5"), clay: pair("#b06a4f"), clay2: pair("#f2dccf"),
        clayText: pair("#8e543f"), switchKnob: pair("#ffffff"), marginRule: pair("#ead6c9"), checkBorder: pair("#8a8374"), tabToday: pair("#f6dc7c"),
        tabAhead: pair("#d6ccf6"), tabTodayEdge: pair("#dcc062"), tabAheadEdge: pair("#bdb0ea"), tabInk: pair("#2b2925"), tintToday: pair("#f1e0a6"),
        tintAhead: pair("#dfd6e6"), tabMemo: pair("#efd4cb"), tapeHoney: pair("#e9cf7a"), tapeLavender: pair("#cfc6ea"), tapeSky: pair("#bcd0ea"),
        tapeMint: pair("#c9dcc4"), tapeRose: pair("#ecc4bc"), tapeNeutral: pair("#d9d3c4"), tapeHoneyEdge: pair("#c8b269"), tapeLavenderEdge: pair("#b2aac9"),
        tapeSkyEdge: pair("#a2b3c9"), tapeMintEdge: pair("#adbda9"), tapeRoseEdge: pair("#cba9a2"), tapeNeutralEdge: pair("#bbb5a9"), eventBlue: pair("#517ec2"),
        eventTint: pair("#dee3ea"), memoPurple: pair("#7a6aae"), memoTint: pair("#e7dfea"), stamp: pair("#4d5b86"), lavenderText: pair("#62559a"),
        honeyText: pair("#755e12"), honey2: pair("#f1e4ba"), toastBack: pair("#2b2925"), toastText: pair("#f7f2e7"), toastAction: pair("#f6d9c7"),
        toastKind: pair("#cfe3c9"), desk: pair("#e9e1d0"), spaceLavender: pair("#897ccf"), spacePink: pair("#d16776"), spaceMint: pair("#54966a"),
        spaceYellow: pair("#a78527"), spaceSky: pair("#578bcd"), spacePeach: pair("#d46b2b"), spaceSand: pair("#9f8550"), spaceGray: pair("#8c887e"),
        markBlue: pair("#5b8bd0"), markSage: pair("#6b8f71"), markCoral: pair("#ce705a"), markPurple: pair("#8e7cc3"), markYellow: pair("#aa8623"),
        markGray: pair("#8a8a8a"))

    /// 크라프트지 (Kraft paper).
    static let kraft = NotePalette(
        kind: .kraft,
        paper: pair("#e9dbc2"), paper2: pair("#dfceb0"), card: pair("#faf4e7"), raised: pair("#faf4e7"), ink: pair("#2e241a"),
        ink2: pair("#4f4130"), ink3: pair("#54452f"), faint: pair("#9a8564"), rule: pair("#d3bf9c"), sage: pair("#47653a"),
        sage2: pair("#d2cdaf"), sageText: pair("#445a43"), onSage: pair("#faf4e7"), clay: pair("#9e5f47"), clay2: pair("#e4c5aa"),
        clayText: pair("#794735"), switchKnob: pair("#ffffff"), marginRule: pair("#d6a98f"), checkBorder: pair("#77644a"), tabToday: pair("#f6dc7c"),
        tabAhead: pair("#d6ccf6"), tabTodayEdge: pair("#dcc062"), tabAheadEdge: pair("#bdb0ea"), tabInk: pair("#2e241a"), tintToday: pair("#e3c981"),
        tintAhead: pair("#d1bfc1"), tabMemo: pair("#e1bda6"), tapeHoney: pair("#e9cf7a"), tapeLavender: pair("#cfc6ea"), tapeSky: pair("#bcd0ea"),
        tapeMint: pair("#c9dcc4"), tapeRose: pair("#ecc4bc"), tapeNeutral: pair("#d9d3c4"), tapeHoneyEdge: pair("#c8b269"), tapeLavenderEdge: pair("#b2aac9"),
        tapeSkyEdge: pair("#a2b3c9"), tapeMintEdge: pair("#adbda9"), tapeRoseEdge: pair("#cba9a2"), tapeNeutralEdge: pair("#bbb5a9"), eventBlue: pair("#4871ad"),
        eventTint: pair("#d0ccc5"), memoPurple: pair("#7465a5"), memoTint: pair("#d9c8c5"), stamp: pair("#49567f"), lavenderText: pair("#584c8b"),
        honeyText: pair("#695510"), honey2: pair("#e3cd95"), toastBack: pair("#2e241a"), toastText: pair("#e9dbc2"), toastAction: pair("#f6d9c7"),
        toastKind: pair("#cfe3c9"), desk: pair("#cdb187"), spaceLavender: pair("#7b70ba"), spacePink: pair("#bc5d6a"), spaceMint: pair("#4c875f"),
        spaceYellow: pair("#967823"), spaceSky: pair("#4e7db8"), spacePeach: pair("#bf6027"), spaceSand: pair("#8f7848"), spaceGray: pair("#7e7a71"),
        markBlue: pair("#527dbb"), markSage: pair("#608166"), markCoral: pair("#b86451"), markPurple: pair("#8070b0"), markYellow: pair("#94751f"),
        markGray: pair("#7c7c7c"))

    /// 모눈 노트 (Grid notebook).
    static let grid = NotePalette(
        kind: .grid,
        paper: pair("#fbfcfe"), paper2: pair("#eef2f7"), card: pair("#ffffff"), raised: pair("#ffffff"), ink: pair("#1f2a35"),
        ink2: pair("#4b5865"), ink3: pair("#57636f"), faint: pair("#9aa7b5"), rule: pair("#d5dfeb"), sage: pair("#5c7a5a"),
        sage2: pair("#e4eeeb"), sageText: pair("#546f52"), onSage: pair("#ffffff"), clay: pair("#b06a4f"), clay2: pair("#f6e6e6"),
        clayText: pair("#955842"), switchKnob: pair("#ffffff"), marginRule: pair("#f0d0cc"), checkBorder: pair("#7d8a98"), tabToday: pair("#f6dc7c"),
        tabAhead: pair("#d6ccf6"), tabTodayEdge: pair("#dcc062"), tabAheadEdge: pair("#bdb0ea"), tabInk: pair("#1f2a35"), tintToday: pair("#f5eabd"),
        tintAhead: pair("#e3e0fd"), tabMemo: pair("#f3dee2"), tapeHoney: pair("#e9cf7a"), tapeLavender: pair("#cfc6ea"), tapeSky: pair("#bcd0ea"),
        tapeMint: pair("#c9dcc4"), tapeRose: pair("#ecc4bc"), tapeNeutral: pair("#d9d3c4"), tapeHoneyEdge: pair("#c8b269"), tapeLavenderEdge: pair("#b2aac9"),
        tapeSkyEdge: pair("#a2b3c9"), tapeMintEdge: pair("#adbda9"), tapeRoseEdge: pair("#cba9a2"), tapeNeutralEdge: pair("#bbb5a9"), eventBlue: pair("#5585cc"),
        eventTint: pair("#e2edff"), memoPurple: pair("#7a6aae"), memoTint: pair("#ebe9ff"), stamp: pair("#4d5b86"), lavenderText: pair("#62559a"),
        honeyText: pair("#755e12"), honey2: pair("#f5eed1"), toastBack: pair("#1f2a35"), toastText: pair("#fbfcfe"), toastAction: pair("#f6d9c7"),
        toastKind: pair("#cfe3c9"), desk: pair("#dde6f0"), spaceLavender: pair("#897ccf"), spacePink: pair("#d16776"), spaceMint: pair("#54966a"),
        spaceYellow: pair("#a78527"), spaceSky: pair("#578bcd"), spacePeach: pair("#d46b2b"), spaceSand: pair("#9f8550"), spaceGray: pair("#8c887e"),
        markBlue: pair("#5b8bd0"), markSage: pair("#6b8f71"), markCoral: pair("#d9765f"), markPurple: pair("#8e7cc3"), markYellow: pair("#aa8623"),
        markGray: pair("#8a8a8a"))

    /// 쑥색 종이 (Sage).
    static let sage = NotePalette(
        kind: .sage,
        paper: pair("#eff4e9"), paper2: pair("#e3eadb"), card: pair("#fbfdf7"), raised: pair("#fbfdf7"), ink: pair("#223020"),
        ink2: pair("#465243"), ink3: pair("#4b5847"), faint: pair("#95a28c"), rule: pair("#d6e0cb"), sage: pair("#4b7446"),
        sage2: pair("#d8e6d6"), sageText: pair("#50694e"), onSage: pair("#fbfdf7"), clay: pair("#b06a4f"), clay2: pair("#eaded1"),
        clayText: pair("#8e543f"), switchKnob: pair("#ffffff"), marginRule: pair("#e6d3c8"), checkBorder: pair("#77836e"), tabToday: pair("#f6dc7c"),
        tabAhead: pair("#d6ccf6"), tabTodayEdge: pair("#dcc062"), tabAheadEdge: pair("#bdb0ea"), tabInk: pair("#223020"), tintToday: pair("#e9e2a8"),
        tintAhead: pair("#d7d8e8"), tabMemo: pair("#e7d6cd"), tapeHoney: pair("#e9cf7a"), tapeLavender: pair("#cfc6ea"), tapeSky: pair("#bcd0ea"),
        tapeMint: pair("#c9dcc4"), tapeRose: pair("#ecc4bc"), tapeNeutral: pair("#d9d3c4"), tapeHoneyEdge: pair("#c8b269"), tapeLavenderEdge: pair("#b2aac9"),
        tapeSkyEdge: pair("#a2b3c9"), tapeMintEdge: pair("#adbda9"), tapeRoseEdge: pair("#cba9a2"), tapeNeutralEdge: pair("#bbb5a9"), eventBlue: pair("#517ec2"),
        eventTint: pair("#d6e5ec"), memoPurple: pair("#7a6aae"), memoTint: pair("#dfe1ec"), stamp: pair("#4d5b86"), lavenderText: pair("#62559a"),
        honeyText: pair("#755e12"), honey2: pair("#e9e6bc"), toastBack: pair("#223020"), toastText: pair("#eff4e9"), toastAction: pair("#f6d9c7"),
        toastKind: pair("#cfe3c9"), desk: pair("#d9e2cf"), spaceLavender: pair("#897ccf"), spacePink: pair("#d16776"), spaceMint: pair("#54966a"),
        spaceYellow: pair("#a78527"), spaceSky: pair("#578bcd"), spacePeach: pair("#d46b2b"), spaceSand: pair("#9f8550"), spaceGray: pair("#8c887e"),
        markBlue: pair("#5b8bd0"), markSage: pair("#6b8f71"), markCoral: pair("#ce705a"), markPurple: pair("#8e7cc3"), markYellow: pair("#aa8623"),
        markGray: pair("#8a8a8a"))

    /// 벚꽃 종이 (Blossom).
    static let blossom = NotePalette(
        kind: .blossom,
        paper: pair("#fcf3f1"), paper2: pair("#f4e5e2"), card: pair("#fffaf8"), raised: pair("#fffaf8"), ink: pair("#33262a"),
        ink2: pair("#61494e"), ink3: pair("#67525a"), faint: pair("#b29ea2"), rule: pair("#eedad6"), sage: pair("#577456"),
        sage2: pair("#e5e5de"), sageText: pair("#50694e"), onSage: pair("#fffaf8"), clay: pair("#b06a4f"), clay2: pair("#f7ddd9"),
        clayText: pair("#8e543f"), switchKnob: pair("#ffffff"), marginRule: pair("#e9c3c3"), checkBorder: pair("#8f7c80"), tabToday: pair("#f6dc7c"),
        tabAhead: pair("#d6ccf6"), tabTodayEdge: pair("#dcc062"), tabAheadEdge: pair("#bdb0ea"), tabInk: pair("#33262a"), tintToday: pair("#f6e1b0"),
        tintAhead: pair("#e4d7f0"), tabMemo: pair("#f4d5d5"), tapeHoney: pair("#e9cf7a"), tapeLavender: pair("#cfc6ea"), tapeSky: pair("#bcd0ea"),
        tapeMint: pair("#c9dcc4"), tapeRose: pair("#ecc4bc"), tapeNeutral: pair("#d9d3c4"), tapeHoneyEdge: pair("#c8b269"), tapeLavenderEdge: pair("#b2aac9"),
        tapeSkyEdge: pair("#a2b3c9"), tapeMintEdge: pair("#adbda9"), tapeRoseEdge: pair("#cba9a2"), tapeNeutralEdge: pair("#bbb5a9"), eventBlue: pair("#517ec2"),
        eventTint: pair("#e3e4f4"), memoPurple: pair("#7a6aae"), memoTint: pair("#ece0f4"), stamp: pair("#4d5b86"), lavenderText: pair("#62559a"),
        honeyText: pair("#755e12"), honey2: pair("#f6e5c4"), toastBack: pair("#33262a"), toastText: pair("#fcf3f1"), toastAction: pair("#f6d9c7"),
        toastKind: pair("#cfe3c9"), desk: pair("#efd9d5"), spaceLavender: pair("#897ccf"), spacePink: pair("#d16776"), spaceMint: pair("#54966a"),
        spaceYellow: pair("#a78527"), spaceSky: pair("#578bcd"), spacePeach: pair("#d46b2b"), spaceSand: pair("#9f8550"), spaceGray: pair("#8c887e"),
        markBlue: pair("#5b8bd0"), markSage: pair("#6b8f71"), markCoral: pair("#ce705a"), markPurple: pair("#8e7cc3"), markYellow: pair("#aa8623"),
        markGray: pair("#8a8a8a"))

    /// 노란 메모지 (Sticky note).
    static let memo = NotePalette(
        kind: .memo,
        paper: pair("#fcf0b0"), paper2: pair("#f3e597"), card: pair("#fffadc"), raised: pair("#fffadc"), ink: pair("#2f2914"),
        ink2: pair("#5c522c"), ink3: pair("#605630"), faint: pair("#b3a46a"), rule: pair("#ead889"), sage: pair("#577456"),
        sage2: pair("#e5e29d"), sageText: pair("#50694e"), onSage: pair("#fffadc"), clay: pair("#b06a4f"), clay2: pair("#f7da98"),
        clayText: pair("#87503c"), switchKnob: pair("#ffffff"), marginRule: pair("#efc39a"), checkBorder: pair("#857844"), tabToday: pair("#f2c35a"),
        tabAhead: pair("#d6ccf6"), tabTodayEdge: pair("#d39f2c"), tabAheadEdge: pair("#bdb0ea"), tabInk: pair("#2f2914"), tintToday: pair("#f6de6f"),
        tintAhead: pair("#e4d4af"), tabMemo: pair("#f4d294"), tapeHoney: pair("#e8b85a"), tapeLavender: pair("#cfc6ea"), tapeSky: pair("#bcd0ea"),
        tapeMint: pair("#c9dcc4"), tapeRose: pair("#ecc4bc"), tapeNeutral: pair("#d9d3c4"), tapeHoneyEdge: pair("#c99a3c"), tapeLavenderEdge: pair("#b2aac9"),
        tapeSkyEdge: pair("#a2b3c9"), tapeMintEdge: pair("#adbda9"), tapeRoseEdge: pair("#cba9a2"), tapeNeutralEdge: pair("#bbb5a9"), eventBlue: pair("#517ec2"),
        eventTint: pair("#e3e1b3"), memoPurple: pair("#7a6aae"), memoTint: pair("#ecddb3"), stamp: pair("#4d5b86"), lavenderText: pair("#62559a"),
        honeyText: pair("#755e12"), honey2: pair("#f6e283"), toastBack: pair("#2f2914"), toastText: pair("#fcf0b0"), toastAction: pair("#f6d9c7"),
        toastKind: pair("#cfe3c9"), desk: pair("#f0de86"), spaceLavender: pair("#897ccf"), spacePink: pair("#d16776"), spaceMint: pair("#54966a"),
        spaceYellow: pair("#a78527"), spaceSky: pair("#578bcd"), spacePeach: pair("#d46b2b"), spaceSand: pair("#9f8550"), spaceGray: pair("#8c887e"),
        markBlue: pair("#5b8bd0"), markSage: pair("#6b8f71"), markCoral: pair("#c36a56"), markPurple: pair("#8e7cc3"), markYellow: pair("#9f7d21"),
        markGray: pair("#838383"))

    /// 원고지 (Manuscript paper).
    static let manuscript = NotePalette(
        kind: .manuscript,
        paper: pair("#fcfaf5"), paper2: pair("#f3eee3"), card: pair("#fffefb"), raised: pair("#fffefb"), ink: pair("#2d2a26"),
        ink2: pair("#605a51"), ink3: pair("#686258"), faint: pair("#b0a898"), rule: pair("#eab4a6"), sage: pair("#5c7a5a"),
        sage2: pair("#e5ece2"), sageText: pair("#546f52"), onSage: pair("#fffefb"), clay: pair("#b06a4f"), clay2: pair("#f7e4dd"),
        clayText: pair("#955842"), switchKnob: pair("#ffffff"), marginRule: pair("#e39b8a"), checkBorder: pair("#8f877a"), tabToday: pair("#f6dc7c"),
        tabAhead: pair("#d6ccf6"), tabTodayEdge: pair("#dcc062"), tabAheadEdge: pair("#bdb0ea"), tabInk: pair("#2d2a26"), tintToday: pair("#f6e8b4"),
        tintAhead: pair("#e4def4"), tabMemo: pair("#f4dcd9"), tapeHoney: pair("#e9cf7a"), tapeLavender: pair("#cfc6ea"), tapeSky: pair("#bcd0ea"),
        tapeMint: pair("#c9dcc4"), tapeRose: pair("#ecc4bc"), tapeNeutral: pair("#d9d3c4"), tapeHoneyEdge: pair("#c8b269"), tapeLavenderEdge: pair("#b2aac9"),
        tapeSkyEdge: pair("#a2b3c9"), tapeMintEdge: pair("#adbda9"), tapeRoseEdge: pair("#cba9a2"), tapeNeutralEdge: pair("#bbb5a9"), eventBlue: pair("#5585cc"),
        eventTint: pair("#e3ebf8"), memoPurple: pair("#7a6aae"), memoTint: pair("#ece7f8"), stamp: pair("#4d5b86"), lavenderText: pair("#62559a"),
        honeyText: pair("#755e12"), honey2: pair("#f6ecc8"), toastBack: pair("#2d2a26"), toastText: pair("#fcfaf5"), toastAction: pair("#f6d9c7"),
        toastKind: pair("#cfe3c9"), desk: pair("#ece5d6"), spaceLavender: pair("#897ccf"), spacePink: pair("#d16776"), spaceMint: pair("#54966a"),
        spaceYellow: pair("#a78527"), spaceSky: pair("#578bcd"), spacePeach: pair("#d46b2b"), spaceSand: pair("#9f8550"), spaceGray: pair("#8c887e"),
        markBlue: pair("#5b8bd0"), markSage: pair("#6b8f71"), markCoral: pair("#d9765f"), markPurple: pair("#8e7cc3"), markYellow: pair("#aa8623"),
        markGray: pair("#8a8a8a"))

    /// 하늘색 줄노트 (Blue lined notebook).
    static let lined = NotePalette(
        kind: .lined,
        paper: pair("#eaf3fb"), paper2: pair("#dce8f4"), card: pair("#f8fbff"), raised: pair("#f8fbff"), ink: pair("#1d2a3a"),
        ink2: pair("#435367"), ink3: pair("#48586c"), faint: pair("#93a6bb"), rule: pair("#b8cfe6"), sage: pair("#577456"),
        sage2: pair("#d3e5e8"), sageText: pair("#50694e"), onSage: pair("#f8fbff"), clay: pair("#b06a4f"), clay2: pair("#e5dde3"),
        clayText: pair("#8e543f"), switchKnob: pair("#ffffff"), marginRule: pair("#e8a9a9"), checkBorder: pair("#6e8094"), tabToday: pair("#f6dc7c"),
        tabAhead: pair("#d6ccf6"), tabTodayEdge: pair("#dcc062"), tabAheadEdge: pair("#bdb0ea"), tabInk: pair("#1d2a3a"), tintToday: pair("#e4e1ba"),
        tintAhead: pair("#d2d7fa"), tabMemo: pair("#e2d5df"), tapeHoney: pair("#e9cf7a"), tapeLavender: pair("#cfc6ea"), tapeSky: pair("#bcd0ea"),
        tapeMint: pair("#c9dcc4"), tapeRose: pair("#ecc4bc"), tapeNeutral: pair("#d9d3c4"), tapeHoneyEdge: pair("#c8b269"), tapeLavenderEdge: pair("#b2aac9"),
        tapeSkyEdge: pair("#a2b3c9"), tapeMintEdge: pair("#adbda9"), tapeRoseEdge: pair("#cba9a2"), tapeNeutralEdge: pair("#bbb5a9"), eventBlue: pair("#517ec2"),
        eventTint: pair("#d1e4fe"), memoPurple: pair("#7a6aae"), memoTint: pair("#dae0fe"), stamp: pair("#4d5b86"), lavenderText: pair("#62559a"),
        honeyText: pair("#755e12"), honey2: pair("#e4e5ce"), toastBack: pair("#1d2a3a"), toastText: pair("#eaf3fb"), toastAction: pair("#f6d9c7"),
        toastKind: pair("#cfe3c9"), desk: pair("#d3e3f2"), spaceLavender: pair("#897ccf"), spacePink: pair("#d16776"), spaceMint: pair("#54966a"),
        spaceYellow: pair("#a78527"), spaceSky: pair("#578bcd"), spacePeach: pair("#d46b2b"), spaceSand: pair("#9f8550"), spaceGray: pair("#8c887e"),
        markBlue: pair("#5b8bd0"), markSage: pair("#6b8f71"), markCoral: pair("#ce705a"), markPurple: pair("#8e7cc3"), markYellow: pair("#aa8623"),
        markGray: pair("#8a8a8a"))

    /// 라벤더 종이 (Lavender).
    static let lavender = NotePalette(
        kind: .lavender,
        paper: pair("#f2eefa"), paper2: pair("#e7e1f4"), card: pair("#fcfbff"), raised: pair("#fcfbff"), ink: pair("#2a2638"),
        ink2: pair("#565070"), ink3: pair("#5b5574"), faint: pair("#a69fbe"), rule: pair("#ddd5ef"), sage: pair("#577456"),
        sage2: pair("#dbe0e7"), sageText: pair("#50694e"), onSage: pair("#fcfbff"), clay: pair("#b06a4f"), clay2: pair("#edd8e2"),
        clayText: pair("#87503c"), switchKnob: pair("#ffffff"), marginRule: pair("#e9cfd8"), checkBorder: pair("#857e9c"), tabToday: pair("#f6dc7c"),
        tabAhead: pair("#c2b3f0"), tabTodayEdge: pair("#dcc062"), tabAheadEdge: pair("#a594e0"), tabInk: pair("#2a2638"), tintToday: pair("#ecdcb9"),
        tintAhead: pair("#dad2f9"), tabMemo: pair("#ead0de"), tapeHoney: pair("#e9cf7a"), tapeLavender: pair("#bdb0e6"), tapeSky: pair("#bcd0ea"),
        tapeMint: pair("#c9dcc4"), tapeRose: pair("#ecc4bc"), tapeNeutral: pair("#d9d3c4"), tapeHoneyEdge: pair("#c8b269"), tapeLavenderEdge: pair("#a093cf"),
        tapeSkyEdge: pair("#a2b3c9"), tapeMintEdge: pair("#adbda9"), tapeRoseEdge: pair("#cba9a2"), tapeNeutralEdge: pair("#bbb5a9"), eventBlue: pair("#517ec2"),
        eventTint: pair("#d9dffd"), memoPurple: pair("#7a6aae"), memoTint: pair("#e2dbfd"), stamp: pair("#4d5b86"), lavenderText: pair("#62559a"),
        honeyText: pair("#755e12"), honey2: pair("#ece0cd"), toastBack: pair("#2a2638"), toastText: pair("#f2eefa"), toastAction: pair("#f6d9c7"),
        toastKind: pair("#cfe3c9"), desk: pair("#e0d8f1"), spaceLavender: pair("#897ccf"), spacePink: pair("#d16776"), spaceMint: pair("#54966a"),
        spaceYellow: pair("#a78527"), spaceSky: pair("#578bcd"), spacePeach: pair("#d46b2b"), spaceSand: pair("#9f8550"), spaceGray: pair("#8c887e"),
        markBlue: pair("#5b8bd0"), markSage: pair("#6b8f71"), markCoral: pair("#ce705a"), markPurple: pair("#8e7cc3"), markYellow: pair("#9f7d21"),
        markGray: pair("#8a8a8a"))

    /// 재생지 (Recycled paper).
    static let recycled = NotePalette(
        kind: .recycled,
        paper: pair("#ecebe6"), paper2: pair("#e2e1db"), card: pair("#f8f8f5"), raised: pair("#f8f8f5"), ink: pair("#262624"),
        ink2: pair("#4f4e49"), ink3: pair("#55544e"), faint: pair("#9e9d95"), rule: pair("#d5d3cb"), sage: pair("#536e51"),
        sage2: pair("#d5ddd3"), sageText: pair("#4c644a"), onSage: pair("#f8f8f5"), clay: pair("#a7654b"), clay2: pair("#e7d5ce"),
        clayText: pair("#87503c"), switchKnob: pair("#ffffff"), marginRule: pair("#dbc8c1"), checkBorder: pair("#7a7972"), tabToday: pair("#f6dc7c"),
        tabAhead: pair("#d6ccf6"), tabTodayEdge: pair("#dcc062"), tabAheadEdge: pair("#bdb0ea"), tabInk: pair("#262624"), tintToday: pair("#e6d9a5"),
        tintAhead: pair("#d4cfe5"), tabMemo: pair("#e4cdca"), tapeHoney: pair("#e9cf7a"), tapeLavender: pair("#cfc6ea"), tapeSky: pair("#bcd0ea"),
        tapeMint: pair("#c9dcc4"), tapeRose: pair("#ecc4bc"), tapeNeutral: pair("#d9d3c4"), tapeHoneyEdge: pair("#c8b269"), tapeLavenderEdge: pair("#b2aac9"),
        tapeSkyEdge: pair("#a2b3c9"), tapeMintEdge: pair("#adbda9"), tapeRoseEdge: pair("#cba9a2"), tapeNeutralEdge: pair("#bbb5a9"), eventBlue: pair("#4c78b8"),
        eventTint: pair("#d3dce9"), memoPurple: pair("#7a6aae"), memoTint: pair("#dcd8e9"), stamp: pair("#4d5b86"), lavenderText: pair("#62559a"),
        honeyText: pair("#755e12"), honey2: pair("#e6ddb9"), toastBack: pair("#262624"), toastText: pair("#ecebe6"), toastAction: pair("#f6d9c7"),
        toastKind: pair("#cfe3c9"), desk: pair("#dad9d2"), spaceLavender: pair("#897ccf"), spacePink: pair("#c76270"), spaceMint: pair("#508e65"),
        spaceYellow: pair("#9f7e25"), spaceSky: pair("#5384c3"), spacePeach: pair("#c96629"), spaceSand: pair("#977e4c"), spaceGray: pair("#858178"),
        markBlue: pair("#5684c6"), markSage: pair("#6b8f71"), markCoral: pair("#c36a56"), markPurple: pair("#8e7cc3"), markYellow: pair("#9f7d21"),
        markGray: pair("#838383"))

    /// 밤 종이 (Night paper).
    static let night = NotePalette(
        kind: .night,
        paper: pair("#2a2924"), paper2: pair("#33322c"), card: pair("#312f29"), raised: pair("#46433b"), ink: pair("#ece6d6"),
        ink2: pair("#bdb7a7"), ink3: pair("#9f9989"), faint: pair("#8a8577"), rule: pair("#3e3c34"), sage: pair("#a3c49c"),
        sage2: pair("#39443a"), sageText: pair("#a3c49c"), onSage: pair("#1f2a1e"), clay: pair("#e29a7c"), clay2: pair("#4a3630"),
        clayText: pair("#e29a7c"), switchKnob: pair("#ece6d6"), marginRule: pair("#4a3630"), checkBorder: pair("#837e69"), tabToday: pair("#c4a245"),
        tabAhead: pair("#9d92dc"), tabTodayEdge: pair("#d6b65a"), tabAheadEdge: pair("#b2a8ea"), tabInk: pair("#1f1d18"), tintToday: pair("#6a5e35"),
        tintAhead: pair("#4f4868"), tabMemo: pair("#63443f"), tapeHoney: pair("#8a7a3f"), tapeLavender: pair("#5d5578"), tapeSky: pair("#4d5f7a"),
        tapeMint: pair("#4f6650"), tapeRose: pair("#7a4f4a"), tapeNeutral: pair("#55524a"), tapeHoneyEdge: pair("#a19565"), tapeLavenderEdge: pair("#7d7793"),
        tapeSkyEdge: pair("#717f95"), tapeMintEdge: pair("#728573"), tapeRoseEdge: pair("#95726e"), tapeNeutralEdge: pair("#77756e"), eventBlue: pair("#8fb1e3"),
        eventTint: pair("#313b4a"), memoPurple: pair("#bcb0e2"), memoTint: pair("#3a3548"), stamp: pair("#a9b6dc"), lavenderText: pair("#c6bcf0"),
        honeyText: pair("#e4c86e"), honey2: pair("#463d22"), toastBack: pair("#ece6d6"), toastText: pair("#2a2924"), toastAction: pair("#8f4a30"),
        toastKind: pair("#3d6639"), desk: pair("#3a3833"), spaceLavender: pair("#9a8fd6"), spacePink: pair("#d9828f"), spaceMint: pair("#6fae84"),
        spaceYellow: pair("#d1a93a"), spaceSky: pair("#6f9bd4"), spacePeach: pair("#e09466"), spaceSand: pair("#b9a274"), spaceGray: pair("#9a978e"),
        markBlue: pair("#567db5"), markSage: pair("#638168"), markCoral: pair("#b86451"), markPurple: pair("#8070aa"), markYellow: pair("#b48e25"),
        markGray: pair("#7c7c7c"))

    /// 먹색 종이 (Ink).
    static let ink = NotePalette(
        kind: .ink,
        paper: pair("#1f2636"), paper2: pair("#283146"), card: pair("#263045"), raised: pair("#36415a"), ink: pair("#eef1f7"),
        ink2: pair("#cdd4e2"), ink3: pair("#aeb7c9"), faint: pair("#7f8aa0"), rule: pair("#343e56"), sage: pair("#a3c49c"),
        sage2: pair("#2e414c"), sageText: pair("#a3c49c"), onSage: pair("#1f2a1e"), clay: pair("#e29a7c"), clay2: pair("#3f3342"),
        clayText: pair("#e29a7c"), switchKnob: pair("#eef1f7"), marginRule: pair("#4a3a44"), checkBorder: pair("#8d97ab"), tabToday: pair("#c4a245"),
        tabAhead: pair("#9d92dc"), tabTodayEdge: pair("#d6b65a"), tabAheadEdge: pair("#b2a8ea"), tabInk: pair("#1f1d18"), tintToday: pair("#5f5b47"),
        tintAhead: pair("#44457a"), tabMemo: pair("#584151"), tapeHoney: pair("#8a7a3f"), tapeLavender: pair("#5d5578"), tapeSky: pair("#4d5f7a"),
        tapeMint: pair("#4f6650"), tapeRose: pair("#7a4f4a"), tapeNeutral: pair("#55524a"), tapeHoneyEdge: pair("#a19565"), tapeLavenderEdge: pair("#7d7793"),
        tapeSkyEdge: pair("#717f95"), tapeMintEdge: pair("#728573"), tapeRoseEdge: pair("#95726e"), tapeNeutralEdge: pair("#77756e"), eventBlue: pair("#8fb1e3"),
        eventTint: pair("#26385c"), memoPurple: pair("#bcb0e2"), memoTint: pair("#2f325a"), stamp: pair("#a9b6dc"), lavenderText: pair("#c6bcf0"),
        honeyText: pair("#e4c86e"), honey2: pair("#3b3a34"), toastBack: pair("#eef1f7"), toastText: pair("#1f2636"), toastAction: pair("#8f4a30"),
        toastKind: pair("#3d6639"), desk: pair("#1a2030"), spaceLavender: pair("#9a8fd6"), spacePink: pair("#d9828f"), spaceMint: pair("#6fae84"),
        spaceYellow: pair("#d1a93a"), spaceSky: pair("#6f9bd4"), spacePeach: pair("#e09466"), spaceSand: pair("#b9a274"), spaceGray: pair("#9a978e"),
        markBlue: pair("#567db5"), markSage: pair("#638168"), markCoral: pair("#b86451"), markPurple: pair("#8070aa"), markYellow: pair("#b48e25"),
        markGray: pair("#7c7c7c"))

    /// 밤하늘 종이 (Night sky).
    static let nightsky = NotePalette(
        kind: .nightsky,
        paper: pair("#1f1c33"), paper2: pair("#292542"), card: pair("#27233f"), raised: pair("#3a345e"), ink: pair("#efedf9"),
        ink2: pair("#cdc8e4"), ink3: pair("#b0aacb"), faint: pair("#7d779d"), rule: pair("#332e50"), sage: pair("#a3c49c"),
        sage2: pair("#2e3749"), sageText: pair("#a3c49c"), onSage: pair("#1f2a1e"), clay: pair("#e29a7c"), clay2: pair("#3f293f"),
        clayText: pair("#e29a7c"), switchKnob: pair("#efedf9"), marginRule: pair("#4c3650"), checkBorder: pair("#8f89b0"), tabToday: pair("#c4a245"),
        tabAhead: pair("#9d92dc"), tabTodayEdge: pair("#d6b65a"), tabAheadEdge: pair("#b2a8ea"), tabInk: pair("#1f1d18"), tintToday: pair("#5f5144"),
        tintAhead: pair("#443b77"), tabMemo: pair("#58374e"), tapeHoney: pair("#8a7a3f"), tapeLavender: pair("#5d5578"), tapeSky: pair("#4d5f7a"),
        tapeMint: pair("#4f6650"), tapeRose: pair("#7a4f4a"), tapeNeutral: pair("#55524a"), tapeHoneyEdge: pair("#a19565"), tapeLavenderEdge: pair("#7d7793"),
        tapeSkyEdge: pair("#717f95"), tapeMintEdge: pair("#728573"), tapeRoseEdge: pair("#95726e"), tapeNeutralEdge: pair("#77756e"), eventBlue: pair("#8fb1e3"),
        eventTint: pair("#262e59"), memoPurple: pair("#bcb0e2"), memoTint: pair("#2f2857"), stamp: pair("#a9b6dc"), lavenderText: pair("#c6bcf0"),
        honeyText: pair("#e4c86e"), honey2: pair("#3b3031"), toastBack: pair("#efedf9"), toastText: pair("#1f1c33"), toastAction: pair("#8f4a30"),
        toastKind: pair("#3d6639"), desk: pair("#17142a"), spaceLavender: pair("#9a8fd6"), spacePink: pair("#d9828f"), spaceMint: pair("#6fae84"),
        spaceYellow: pair("#d1a93a"), spaceSky: pair("#6f9bd4"), spacePeach: pair("#e09466"), spaceSand: pair("#b9a274"), spaceGray: pair("#9a978e"),
        markBlue: pair("#4d76b1"), markSage: pair("#5b7a60"), markCoral: pair("#b86451"), markPurple: pair("#7969a6"), markYellow: pair("#b48e25"),
        markGray: pair("#757575"))

    /// 칠판 (Chalkboard).
    static let chalk = NotePalette(
        kind: .chalk,
        paper: pair("#23312b"), paper2: pair("#2b3b35"), card: pair("#293832"), raised: pair("#3b4c45"), ink: pair("#eef3ea"),
        ink2: pair("#cad4c7"), ink3: pair("#abb8a9"), faint: pair("#7c8b7d"), rule: pair("#34463e"), sage: pair("#a3c49c"),
        sage2: pair("#324c41"), sageText: pair("#a3c49c"), onSage: pair("#1f2a1e"), clay: pair("#e29a7c"), clay2: pair("#433e37"),
        clayText: pair("#e29a7c"), switchKnob: pair("#eef3ea"), marginRule: pair("#4e3e37"), checkBorder: pair("#8b9b8c"), tabToday: pair("#c4a245"),
        tabAhead: pair("#9d92dc"), tabTodayEdge: pair("#d6b65a"), tabAheadEdge: pair("#b2a8ea"), tabInk: pair("#1f1d18"), tintToday: pair("#63663c"),
        tintAhead: pair("#48506f"), tabMemo: pair("#5c4c46"), tapeHoney: pair("#8a7a3f"), tapeLavender: pair("#5d5578"), tapeSky: pair("#4d5f7a"),
        tapeMint: pair("#4f6650"), tapeRose: pair("#7a4f4a"), tapeNeutral: pair("#55524a"), tapeHoneyEdge: pair("#a19565"), tapeLavenderEdge: pair("#7d7793"),
        tapeSkyEdge: pair("#717f95"), tapeMintEdge: pair("#728573"), tapeRoseEdge: pair("#95726e"), tapeNeutralEdge: pair("#77756e"), eventBlue: pair("#8fb1e3"),
        eventTint: pair("#2a4351"), memoPurple: pair("#bcb0e2"), memoTint: pair("#333d4f"), stamp: pair("#a9b6dc"), lavenderText: pair("#c6bcf0"),
        honeyText: pair("#e4c86e"), honey2: pair("#3f4529"), toastBack: pair("#eef3ea"), toastText: pair("#23312b"), toastAction: pair("#8f4a30"),
        toastKind: pair("#3d6639"), desk: pair("#1b2722"), spaceLavender: pair("#9a8fd6"), spacePink: pair("#d9828f"), spaceMint: pair("#6fae84"),
        spaceYellow: pair("#d1a93a"), spaceSky: pair("#6f9bd4"), spacePeach: pair("#e09466"), spaceSand: pair("#b9a274"), spaceGray: pair("#9a978e"),
        markBlue: pair("#5e84b9"), markSage: pair("#6b8770"), markCoral: pair("#bc6c5a"), markPurple: pair("#8677ae"), markYellow: pair("#b48e25"),
        markGray: pair("#838383"))
}
