import AppKit
import PaperCore
import SwiftUI

/// 메모 서랍's papers (design F, docs/design/memo-drawer-themes.png): 낮 종이, 밤 종이, 크라프트지, 모눈 노트, since #142
/// 한지, 쑥색 종이, 벚꽃 종이, 먹색 종이 (docs/plans/settings-plan.md P4), and since #244 the seven new papers of the note
/// (docs/plans/paper-themes.md: tokens.json's `drawer`; the same colours as the Windows app's drawer.css). Each is a fixed
/// set of colours: the drawer follows the note's paper (노트와 같은 종이), or its own with its own 밤에는.
/// `scripts/check-contrast.py` reads the `pair(` lines below and checks them against WCAG AA.
struct DrawerPalette: Equatable {
    enum Kind: String, CaseIterable {
        case day, night, kraft, grid, hanji, sage, blossom, ink
        case memo, manuscript, lined, lavender, recycled, nightsky, chalk

        init(_ paper: PaperKind) { self.init(rawValue: paper.rawValue)! }
        var paper: PaperKind { PaperKind(rawValue: rawValue)! }
    }
    /// The drawer's paper: plain (#111: no ruled lines, as the memo sheets since 1.45), or 모눈's squares.
    enum Background { case plain, grid }

    let kind: Kind
    /// The drawer's paper, its edge, its ruling.
    let paper: Color
    let edge: Color
    let rule: Color
    let background: Background
    let texture: Double
    /// Text: ink (titles, memo text), the small green 메모 서랍 line, secondary (search hints, chips), faint (times,
    /// footer); preview: a card's lines under its title (#14, option B) — the ink at one step lighter over the sheet
    /// (낮 78 %, 밤 86 %, 크라프트 84 %, 모눈 80 %: each above the old grey's contrast), written as the colour it makes.
    let ink: Color
    let title: Color
    let label: Color
    let secondary: Color
    let preview: Color
    let faint: Color
    /// Icons in the header and on slips.
    let icon: Color
    /// A memo slip and the quick-write slip.
    let slip: Color
    let slipEdge: Color
    let slipRadius: CGFloat
    /// A memo's sheet (design B2): ruled notebook paper.
    let sheet: Color
    let placeholder: Color
    /// The dog-ear of a pinned slip.
    let dogEar: Color
    /// Ticked boxes and the progress bar.
    let check: Color
    let checkOn: Color
    let box: Color
    let track: Color
    /// The paw in the footer.
    let paw: Color
    /// What's picked (by keyboard) and the open slip's edge when the folder has no colour of its own here.
    let selection: Color
    let toast: Color
    let toastText: Color
    /// 고정 (the paw bookmark, 1.45 solid): its colour (day and night: the note's 오늘 tab), its 1 pt edge, its paw;
    /// and the washi tape on a pinned memo in the 고정 view (unchanged, the old second stripe).
    let pinTab: Color
    let pinTabEdge: Color
    let pinTabInk: Color
    let pinTape: Color
    /// kraft and grid: the picked bookmark is a paper of its own colour (the others keep their colours).
    let pickedTab: (back: Color, ink: Color, edge: Color)?
    /// 1.44: the open memo's margin line when the folder's colour can't be used; 지우기 on the bar; a sheet's shadow.
    let openLine: Color
    let danger: Color
    let shadow: Color
    /// A date group's header (its word; the count is faint).
    let groupHeader: Color
    /// #83: the small bar in the middle of the paper's inner edge that closes the drawer, at rest: `faint` mixed into
    /// the paper until it's quiet but still 3:1 on the paper, on the see-through paper and on the sheet it floats on
    /// under 바탕 없음 (under the pointer it's `ink`). The Windows app's `--d-closebar` is the same colour.
    let closeBar: Color
    let scheme: ColorScheme

    static func == (a: DrawerPalette, b: DrawerPalette) -> Bool { a.kind == b.kind }

    /// The sheet's foot (a 1 pt lip under it). Sheet D (#14): no rules and no margin line any more.
    var sheetBottom: Color { Color(drawerHex: ["day": "#e0d7c4", "night": "#1d1c19", "kraft": "#c9b08a", "grid": "#d8e0e8", "hanji": "#e3dbc9", "sage": "#cad4bf", "blossom": "#e5ccc7", "ink": "#141926",
                                                "memo": "#e7d57c", "manuscript": "#e2dac9", "lined": "#c9dbec", "lavender": "#d6cdea", "recycled": "#cfcec7", "nightsky": "#110f20", "chalk": "#141d19"][kind.rawValue]!) }
    /// A sheet's 1 pt edge (1.44).
    var sheetEdge: Color { slipEdge }
    /// An open or picked sheet (#14): its shadow a little deeper instead of a box round it.
    var deepShadow: Color {
        switch kind {
        case .day, .kraft, .hanji, .manuscript, .memo, .recycled: Color(red: 60 / 255, green: 50 / 255, blue: 30 / 255).opacity(0.24)
        case .night, .ink, .nightsky, .chalk: Color.black.opacity(0.62)
        case .lined: Color(red: 30 / 255, green: 50 / 255, blue: 80 / 255).opacity(0.24)
        case .lavender: Color(red: 45 / 255, green: 35 / 255, blue: 70 / 255).opacity(0.24)
        case .grid: Color(red: 30 / 255, green: 50 / 255, blue: 80 / 255).opacity(0.24)
        case .sage: Color(red: 40 / 255, green: 55 / 255, blue: 30 / 255).opacity(0.24)
        case .blossom: Color(red: 70 / 255, green: 40 / 255, blue: 40 / 255).opacity(0.24)
        }
    }
    /// The bar's pills and the kind chips: ink at 6 %, a hairline at 10 %.
    var pill: Color { ink.opacity(scheme == .dark ? 0.07 : 0.06) }
    var pillEdge: Color { ink.opacity(scheme == .dark ? 0.12 : 0.10) }

    var innerEar: Color {
        switch kind {
        case .day, .hanji, .sage, .memo, .manuscript, .lined, .lavender, .recycled: Color(drawerHex: "#f2c9c6").opacity(0.8)
        case .blossom: Color(drawerHex: "#e8a3aa").opacity(0.7)
        case .night, .ink, .nightsky, .chalk: Color(drawerHex: "#7d555a")
        case .kraft: Color(drawerHex: "#e3a08e").opacity(0.7)
        case .grid: Color(drawerHex: "#f6d6d2")
        }
    }

    // MARK: Folder colours by paper

    /// A bookmark's colours: its fill `a` (1.45: solid on every paper; `b` was the second stripe and is only measured
    /// now), its ink, its 1 pt edge (also the open slip's), the tape.
    struct TabColors {
        let a: Color
        let b: Color
        let ink: Color
        let edge: Color
        let tape: Color
    }

    func tab(_ color: MemoFolders.Color) -> TabColors {
        let row = Self.folders(kind)[color]!
        return TabColors(a: Color(drawerHex: row.0), b: Color(drawerHex: row.1), ink: Color(drawerHex: row.2), edge: Color(drawerHex: row.3), tape: Color(drawerHex: row.4))
    }

    /// The folder colours on a paper: its own table, or (the seven papers of #244) 한지's on a light paper and 먹색 종이's on a
    /// dark one — as #142 made 한지 · 먹색's from 낮 · 밤 종이's.
    static func folders(_ kind: Kind) -> [MemoFolders.Color: (String, String, String, String, String)] {
        folderColors[kind] ?? folderColors[kind.paper.isDark ? .ink : .hanji]!
    }

    /// (fill, old second stripe, ink on it, edge, tape) per paper and colour key.
    static let folderColors: [Kind: [MemoFolders.Color: (String, String, String, String, String)]] = [
        .day: [
            .lavender: ("#dcd8f3", "#d3cef0", "#3f3a73", "#c9c0ef", "#d3cef0"),
            .pink: ("#f2d3d6", "#eccacd", "#7a3a42", "#e3b3b9", "#eccacd"),
            .mint: ("#cfe6d6", "#c4dfcc", "#2f5a3c", "#a5cdb1", "#c4dfcc"),
            .yellow: ("#f3e3a0", "#efdc90", "#6b5520", "#dcc46a", "#efdc90"),
            .sky: ("#d6e3f3", "#cbdcf0", "#2f4a72", "#adc6e6", "#cbdcf0"),
            .peach: ("#f6dcc8", "#f2d2bb", "#7a4426", "#e7bc9c", "#f2d2bb"),
            .sand: ("#ebe2cf", "#e4d9c3", "#5e5030", "#d2c3a2", "#e4d9c3"),
            .gray: ("#e2e0da", "#d9d7d0", "#45443f", "#c4c1b8", "#d9d7d0"),
        ],
        .night: [
            .lavender: ("#5e5888", "#575181", "#f1edff", "#8f87c4", "#7d75ad"),
            .pink: ("#74545a", "#6c4e54", "#ffe4e8", "#a8797f", "#8a666c"),
            .mint: ("#4b6a55", "#46634f", "#e2f5e7", "#719a7e", "#5f8269"),
            .yellow: ("#716641", "#6a603c", "#fff1bf", "#a3955d", "#85794f"),
            .sky: ("#4a5d78", "#455770", "#e3eeff", "#7189ad", "#5d7090"),
            .peach: ("#765b49", "#6e5544", "#ffe8d8", "#a8826a", "#8b6d58"),
            .sand: ("#6a644f", "#635d4a", "#f5ecd4", "#958c6e", "#7b745d"),
            .gray: ("#5d5a55", "#57544f", "#f0ede6", "#87837c", "#6e6b65"),
        ],
        .kraft: [
            .lavender: ("#bdb3e0", "#bdb3e0", "#3a3160", "#8f84bd", "#bdb3e0"),
            .pink: ("#e9a38f", "#e9a38f", "#5c2a1d", "#c27a66", "#e9a38f"),
            .mint: ("#9cc2a6", "#9cc2a6", "#24452d", "#6f9a7b", "#9cc2a6"),
            .yellow: ("#f1d37a", "#f1d37a", "#5a4410", "#c8a74a", "#f1d37a"),
            .sky: ("#a3c1dd", "#a3c1dd", "#203e5c", "#7598ba", "#a3c1dd"),
            .peach: ("#efb98d", "#efb98d", "#5a3216", "#c88d5f", "#efb98d"),
            .sand: ("#efe2c0", "#efe2c0", "#4a3b1e", "#b89d73", "#efe2c0"),
            .gray: ("#c4bcad", "#c4bcad", "#3a342a", "#958c7c", "#c4bcad"),
        ],
        .grid: [
            .lavender: ("#e3def6", "#e3def6", "#3a3470", "#b6acdf", "#e3def6"),
            .pink: ("#f6d6d2", "#f6d6d2", "#6e2e28", "#e0aaa3", "#f6d6d2"),
            .mint: ("#d3eadf", "#d3eadf", "#24503c", "#9fcab5", "#d3eadf"),
            .yellow: ("#f6e7b0", "#f6e7b0", "#5e4a12", "#dcc57a", "#f6e7b0"),
            .sky: ("#d8e5f6", "#d8e5f6", "#24416e", "#9fb6dc", "#d8e5f6"),
            .peach: ("#f8dfcc", "#f8dfcc", "#6a3a1a", "#e3b896", "#f8dfcc"),
            .sand: ("#ede6d4", "#ede6d4", "#4e4228", "#cdbf9c", "#ede6d4"),
            .gray: ("#e2e6eb", "#e2e6eb", "#2e3a46", "#b4bec9", "#e2e6eb"),
        ],
        // #142: the light papers take the Windows app's 낮 종이 table, 먹색 its 밤 종이 table; an edge a step darker
        // (lighter on 먹색) where its 3 pt open line needed it to stand 3.2:1 on the sheet (scripts/check-contrast.py).
        .hanji: [
            .lavender: ("#dcd8f3", "#d3cef0", "#3f3a73", "#9d92d8", "#d3cef0"),
            .pink: ("#f2d3d6", "#eccacd", "#6f3239", "#d3979f", "#ecc6ca"),
            .mint: ("#cfe6d6", "#c4dfcc", "#2d5638", "#80b090", "#c4dfcc"),
            .yellow: ("#f3e3a0", "#efdc90", "#66531a", "#bfae71", "#efdc90"),
            .sky: ("#d6e5f4", "#cbdcef", "#2c4c70", "#8fb0da", "#cbdcef"),
            .peach: ("#f6dccb", "#f1d1bc", "#6f4026", "#c8a793", "#f1d1bc"),
            .sand: ("#ebe2cf", "#e3d8c1", "#574629", "#aea48e", "#e3d8c1"),
            .gray: ("#e2e0da", "#d9d6cf", "#47453f", "#a8a6a0", "#d9d6cf"),
        ],
        .sage: [
            .lavender: ("#dcd8f3", "#d3cef0", "#3f3a73", "#9d92d8", "#d3cef0"),
            .pink: ("#f2d3d6", "#eccacd", "#6f3239", "#d3979f", "#ecc6ca"),
            .mint: ("#cfe6d6", "#c4dfcc", "#2d5638", "#80b090", "#c4dfcc"),
            .yellow: ("#f3e3a0", "#efdc90", "#66531a", "#bfae71", "#efdc90"),
            .sky: ("#d6e5f4", "#cbdcef", "#2c4c70", "#8fb0da", "#cbdcef"),
            .peach: ("#f6dccb", "#f1d1bc", "#6f4026", "#c8a793", "#f1d1bc"),
            .sand: ("#ebe2cf", "#e3d8c1", "#574629", "#aea48e", "#e3d8c1"),
            .gray: ("#e2e0da", "#d9d6cf", "#47453f", "#a8a6a0", "#d9d6cf"),
        ],
        .blossom: [
            .lavender: ("#dcd8f3", "#d3cef0", "#3f3a73", "#9d92d8", "#d3cef0"),
            .pink: ("#f2d3d6", "#eccacd", "#6f3239", "#cf949c", "#ecc6ca"),
            .mint: ("#cfe6d6", "#c4dfcc", "#2d5638", "#86b896", "#c4dfcc"),
            .yellow: ("#f3e3a0", "#efdc90", "#66531a", "#bfae71", "#efdc90"),
            .sky: ("#d6e5f4", "#cbdcef", "#2c4c70", "#8fb0da", "#cbdcef"),
            .peach: ("#f6dccb", "#f1d1bc", "#6f4026", "#c8a793", "#f1d1bc"),
            .sand: ("#ebe2cf", "#e3d8c1", "#574629", "#aea48e", "#e3d8c1"),
            .gray: ("#e2e0da", "#d9d6cf", "#47453f", "#a8a6a0", "#d9d6cf"),
        ],
        .ink: [
            .lavender: ("#5e5888", "#575181", "#f1edff", "#8f87c4", "#7d75ad"),
            .pink: ("#74545a", "#6c4e54", "#ffe4e8", "#a8797f", "#8a666c"),
            .mint: ("#4b6a55", "#46634f", "#e2f5e7", "#719a7e", "#5f8269"),
            .yellow: ("#716641", "#6a603c", "#fff1bf", "#9d9168", "#85794f"),
            .sky: ("#4a5d78", "#455770", "#e3eeff", "#7189ad", "#5d7090"),
            .peach: ("#765b49", "#6e5544", "#ffe8d8", "#a08675", "#8b6d58"),
            .sand: ("#6a644f", "#635d4a", "#f5ecd4", "#958c6e", "#7b745d"),
            .gray: ("#5d5a55", "#57544f", "#f0ede6", "#8a8782", "#6e6b65"),
        ],
    ]

    // MARK: The open memo's line (1.44)

    /// The sheet's colour as written, for working out contrast.
    static let sheetHex: [Kind: String] = [.day: "#fffdf7", .night: "#3d3a34", .kraft: "#fbf6ea", .grid: "#ffffff", .hanji: "#fffcf5", .sage: "#fbfdf7", .blossom: "#fffaf8", .ink: "#283146",
                                           .memo: "#fffadc", .manuscript: "#fffefb", .lined: "#f8fbff", .lavender: "#fcfbff", .recycled: "#f8f8f5", .nightsky: "#27233f", .chalk: "#293832"]

    /// The open / picked memo's margin line (3 pt) and outline: the folder's edge colour on this paper, scaled toward
    /// black (toward white on a dark sheet) in 5 % steps until it stands 3:1 against the memo's sheet — the same rule as
    /// the Windows app. `sheet`: the memo's own paper (이 메모의 종이) or the drawer's.
    @MainActor static func openLine(_ folder: MemoFolders.Color, drawer: DrawerPalette, sheet: DrawerPalette) -> Color {
        let key = "\(folder.rawValue)-\(drawer.kind.rawValue)-\(sheet.kind.rawValue)"
        if let known = openLines[key] { return known }
        let made = Color(drawerHex: openLineHex(folders(drawer.kind)[folder]!.3, on: sheetHex[sheet.kind]!) ?? "")
        openLines[key] = made
        return made
    }
    @MainActor private static var openLines: [String: Color] = [:]

    /// The hex the line is drawn in (nil only for a bad hex).
    nonisolated static func openLineHex(_ edge: String, on sheet: String) -> String? {
        guard let start = rgb(edge), let back = rgb(sheet) else { return nil }
        let dark = luminance(back) < 0.2
        var colour = start
        var step = 0
        while contrast(colour, back) < 3, step < 20 {
            step += 1
            let k = 1 - Double(step) * 0.05
            colour = dark ? start.map { (255 - (255 - $0) * k).rounded() } : start.map { ($0 * k).rounded() }
        }
        return "#" + colour.map { String(format: "%02x", Int($0)) }.joined()
    }

    nonisolated static func rgb(_ hex: String) -> [Double]? {
        let digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        guard digits.count == 6, let value = Int(digits, radix: 16) else { return nil }
        return [Double((value >> 16) & 0xff), Double((value >> 8) & 0xff), Double(value & 0xff)]
    }

    nonisolated static func luminance(_ rgb: [Double]) -> Double {
        let c = rgb.map { v -> Double in
            let s = v / 255
            return s <= 0.03928 ? s / 12.92 : pow((s + 0.055) / 1.055, 2.4)
        }
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    }

    nonisolated static func contrast(_ a: [Double], _ b: [Double]) -> Double {
        let x = luminance(a), y = luminance(b)
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    // MARK: The papers

    /// 1.44: the drawer paper a step darker than the memo sheets, every sheet with a 1 pt edge and a soft shadow,
    /// greys darker (lighter at night) — the user picked these from mock/v3 (bottom row).
    static let day = DrawerPalette(
        kind: .day, paper: pair("#e6dbc3"), edge: pair("#c9bb9b"), rule: Color(red: 170 / 255, green: 150 / 255, blue: 110 / 255).opacity(0.35),
        background: .plain, texture: 0.18,
        ink: pair("#2a2925"), title: pair("#2a2925"), label: pair("#42603c"), secondary: pair("#5c584f"), preview: pair("#595853"), faint: pair("#646057"),
        icon: pair("#55504a"), slip: pair("#fffdf7"), slipEdge: pair("#d0c2a3"), slipRadius: 10, sheet: pair("#fffdf7"), placeholder: pair("#646057"),
        dogEar: pair("#efe7d4"), check: pair("#5f7a5a"), checkOn: pair("#fffdf8"), box: pair("#8a8374"), track: pair("#ece6d8"), paw: pair("#c4797e"),
        selection: pair("#b9b2a2"), toast: pair("#2a2925"), toastText: pair("#fbf9f3"),
        pinTab: Color(drawerHex: "#f6dc7c"), pinTabEdge: Color(drawerHex: "#dcc062"), pinTabInk: pair("#6b5520"), pinTape: Color(drawerHex: "#efdc90"), pickedTab: nil,
        openLine: pair("#8d82cf"), danger: pair("#a4472f"), shadow: Color(red: 60 / 255, green: 50 / 255, blue: 30 / 255).opacity(0.12), groupHeader: pair("#5c584f"), closeBar: pair("#7b766a"), scheme: .light)

    /// 1.43.1: lighter text and sheets a step above the drawer (the user found 1.43's night paper hard to read); 1.44 a
    /// darker drawer still and edged sheets.
    static let night = DrawerPalette(
        kind: .night, paper: pair("#1c1a17"), edge: pair("#4a463f"), rule: Color.white.opacity(0.04),
        background: .plain, texture: 0,
        ink: pair("#f6f1e6"), title: pair("#f6f1e6"), label: pair("#b3cbad"), secondary: pair("#dad3c3"), preview: pair("#dcd7cd"), faint: pair("#c4bdad"),
        icon: pair("#cdc6b7"), slip: pair("#3d3a34"), slipEdge: pair("#5a554b"), slipRadius: 10, sheet: pair("#3d3a34"), placeholder: pair("#c4bdad"),
        dogEar: pair("#4f4b43"), check: pair("#b3cbad"), checkOn: pair("#1f2a1e"), box: pair("#a39d90"), track: pair("#55514a"), paw: pair("#d39a9e"),
        selection: pair("#847e72"), toast: pair("#ece6d6"), toastText: pair("#2a2924"),
        pinTab: Color(drawerHex: "#c4a245"), pinTabEdge: Color(drawerHex: "#d6b65a"), pinTabInk: pair("#1f1d18"), pinTape: Color(drawerHex: "#6a603c"), pickedTab: nil,
        openLine: pair("#9d95d6"), danger: pair("#eaa58a"), shadow: Color.black.opacity(0.45), groupHeader: pair("#dad3c3"), closeBar: pair("#8e897d"), scheme: .dark)

    static let kraft = DrawerPalette(
        kind: .kraft, paper: pair("#cdb187"), edge: pair("#a98d63"), rule: .clear,
        background: .plain, texture: 0.3,
        ink: pair("#33281d"), title: pair("#33281d"), label: pair("#4a3a22"), secondary: pair("#574a39"), preview: pair("#53493e"), faint: pair("#54452f"),
        icon: pair("#5a4732"), slip: pair("#fbf6ea"), slipEdge: pair("#a98d63"), slipRadius: 4, sheet: pair("#fbf6ea"), placeholder: pair("#54452f"),
        dogEar: pair("#e8dcc3"), check: pair("#4f7040"), checkOn: pair("#fbf6ea"), box: pair("#8c7a58"), track: pair("#e8dcc3"), paw: pair("#a55f4c"),
        selection: pair("#8f7650"), toast: pair("#33281d"), toastText: pair("#fbf6ea"),
        pinTab: Color(drawerHex: "#f1d37a"), pinTabEdge: Color(drawerHex: "#dcc46a"), pinTabInk: pair("#5a4410"), pinTape: Color(drawerHex: "#f1d37a"),
        pickedTab: (Color(drawerHex: "#f4ecdc"), Color(drawerHex: "#5a3f22"), Color(drawerHex: "#a98d63")),
        openLine: pair("#8a6a40"), danger: pair("#8f3a22"), shadow: Color(red: 60 / 255, green: 50 / 255, blue: 30 / 255).opacity(0.12), groupHeader: pair("#4a3a22"), closeBar: pair("#6a583f"), scheme: .light)

    static let grid = DrawerPalette(
        kind: .grid, paper: pair("#dde6f0"), edge: pair("#b3c2d4"), rule: Color(drawerHex: "#c9d5e3"),
        background: .grid, texture: 0,
        ink: pair("#1f2a35"), title: pair("#1f2a35"), label: pair("#2f5793"), secondary: pair("#4b5865"), preview: pair("#4c555d"), faint: pair("#57636f"),
        icon: pair("#4f5c69"), slip: pair("#ffffff"), slipEdge: pair("#bccadb"), slipRadius: 10, sheet: pair("#ffffff"), placeholder: pair("#57636f"),
        dogEar: pair("#e4ebf2"), check: pair("#3f6aa8"), checkOn: pair("#ffffff"), box: pair("#7d8a98"), track: pair("#e2e9f0"), paw: pair("#c4797e"),
        selection: pair("#9fb6dc"), toast: pair("#1f2a35"), toastText: pair("#f8fafb"),
        pinTab: Color(drawerHex: "#f6e7b0"), pinTabEdge: Color(drawerHex: "#dcc46a"), pinTabInk: pair("#5e4a12"), pinTape: Color(drawerHex: "#f6e7b0"),
        pickedTab: (Color(drawerHex: "#e4ebf8"), Color(drawerHex: "#24416e"), Color(drawerHex: "#9fb6dc")),
        openLine: pair("#6f8fc4"), danger: pair("#a4472f"), shadow: Color(red: 30 / 255, green: 50 / 255, blue: 80 / 255).opacity(0.13), groupHeader: pair("#4b5865"), closeBar: pair("#74808b"), scheme: .light)

    /// 한지 (#142): a plain light paper (the folder colours from the Windows app's 낮 종이 table).
    static let hanji = DrawerPalette(
        kind: .hanji, paper: pair("#e9e1d0"), edge: pair("#cdc2ab"), rule: .clear,
        background: .plain, texture: 0.22,
        ink: pair("#2b2925"), title: pair("#2b2925"), label: pair("#42603c"), secondary: pair("#5a564d"), preview: pair("#55534f"), faint: pair("#5f5b52"),
        icon: pair("#55504a"), slip: pair("#fffcf5"), slipEdge: pair("#d6ccb6"), slipRadius: 10, sheet: pair("#fffcf5"), placeholder: pair("#5f5b52"),
        dogEar: pair("#f2ecdf"), check: pair("#5f7a5a"), checkOn: pair("#fffdf8"), box: pair("#8a8374"), track: pair("#efe9dc"), paw: pair("#c4797e"),
        selection: pair("#b9b2a2"), toast: pair("#2b2925"), toastText: pair("#fbf9f3"),
        pinTab: Color(drawerHex: "#f6dc7c"), pinTabEdge: Color(drawerHex: "#dcc062"), pinTabInk: pair("#6b5520"), pinTape: Color(drawerHex: "#efdc90"), pickedTab: nil,
        openLine: pair("#8d82cf"), danger: pair("#a4472f"), shadow: Color(red: 60 / 255, green: 50 / 255, blue: 30 / 255).opacity(0.12), groupHeader: pair("#5a564d"), closeBar: pair("#847f74"), scheme: .light)

    /// 쑥색 종이 (#142): a plain light paper (the folder colours from the Windows app's 낮 종이 table).
    static let sage = DrawerPalette(
        kind: .sage, paper: pair("#d9e2cf"), edge: pair("#b2c1a4"), rule: .clear,
        background: .plain, texture: 0.18,
        ink: pair("#223020"), title: pair("#223020"), label: pair("#355530"), secondary: pair("#465243"), preview: pair("#455142"), faint: pair("#4b5847"),
        icon: pair("#47553f"), slip: pair("#fbfdf7"), slipEdge: pair("#c0ceb3"), slipRadius: 10, sheet: pair("#fbfdf7"), placeholder: pair("#4b5847"),
        dogEar: pair("#e9efe0"), check: pair("#4f7a4a"), checkOn: pair("#fbfdf7"), box: pair("#7d8a74"), track: pair("#e4ebdc"), paw: pair("#b86f76"),
        selection: pair("#9fb393"), toast: pair("#223020"), toastText: pair("#f7faf2"),
        pinTab: Color(drawerHex: "#f6dc7c"), pinTabEdge: Color(drawerHex: "#dcc062"), pinTabInk: pair("#6b5520"), pinTape: Color(drawerHex: "#efdc90"), pickedTab: nil,
        openLine: pair("#6f8a64"), danger: pair("#a4472f"), shadow: Color(red: 40 / 255, green: 55 / 255, blue: 30 / 255).opacity(0.12), groupHeader: pair("#465243"), closeBar: pair("#768170"), scheme: .light)

    /// 벚꽃 종이 (#142): a plain light paper (the folder colours from the Windows app's 낮 종이 table).
    static let blossom = DrawerPalette(
        kind: .blossom, paper: pair("#efd9d5"), edge: pair("#d4b7b1"), rule: .clear,
        background: .plain, texture: 0.18,
        ink: pair("#33262a"), title: pair("#33262a"), label: pair("#7a3a42"), secondary: pair("#61494e"), preview: pair("#584c4f"), faint: pair("#67525a"),
        icon: pair("#5e4a4f"), slip: pair("#fffaf8"), slipEdge: pair("#e0c6c1"), slipRadius: 10, sheet: pair("#fffaf8"), placeholder: pair("#67525a"),
        dogEar: pair("#f7e9e6"), check: pair("#5f7a5a"), checkOn: pair("#fffdf8"), box: pair("#8f7c80"), track: pair("#f3e5e2"), paw: pair("#b9636c"),
        selection: pair("#c7aaa8"), toast: pair("#33262a"), toastText: pair("#fdf8f7"),
        pinTab: Color(drawerHex: "#f6dc7c"), pinTabEdge: Color(drawerHex: "#dcc062"), pinTabInk: pair("#6b5520"), pinTape: Color(drawerHex: "#efdc90"), pickedTab: nil,
        openLine: pair("#a46f7a"), danger: pair("#a4472f"), shadow: Color(red: 70 / 255, green: 40 / 255, blue: 40 / 255).opacity(0.12), groupHeader: pair("#61494e"), closeBar: pair("#8c767b"), scheme: .light)

    /// 먹색 종이 (#142): the dark paper beside 밤 종이 (the folder colours from 밤 종이's).
    static let ink = DrawerPalette(
        kind: .ink, paper: pair("#1a2030"), edge: pair("#3d4760"), rule: Color.white.opacity(0.04),
        background: .plain, texture: 0,
        ink: pair("#eef1f7"), title: pair("#eef1f7"), label: pair("#a9c7e8"), secondary: pair("#cdd4e2"), preview: pair("#d2d6de"), faint: pair("#b9c1d1"),
        icon: pair("#c4ccdb"), slip: pair("#283146"), slipEdge: pair("#46516b"), slipRadius: 10, sheet: pair("#283146"), placeholder: pair("#b9c1d1"),
        dogEar: pair("#333d56"), check: pair("#a9c7e8"), checkOn: pair("#1a2030"), box: pair("#9aa4b8"), track: pair("#3c4660"), paw: pair("#d39a9e"),
        selection: pair("#7a86a3"), toast: pair("#e6eaf2"), toastText: pair("#1f2533"),
        pinTab: Color(drawerHex: "#c4a245"), pinTabEdge: Color(drawerHex: "#d6b65a"), pinTabInk: pair("#1f1d18"), pinTape: Color(drawerHex: "#6a603c"), pickedTab: nil,
        openLine: pair("#9d95d6"), danger: pair("#eaa58a"), shadow: Color.black.opacity(0.45), groupHeader: pair("#cdd4e2"), closeBar: pair("#757c8c"), scheme: .dark)

    /// 노란 메모지 (#244): a light paper (the folder colours from 한지's), the colours of tokens.json's `drawer`.
    static let memo = DrawerPalette(
        kind: .memo, paper: pair("#eedc84"), edge: pair("#ccbc70"), rule: .clear,
        background: .plain, texture: 0,
        ink: pair("#2f2914"), title: pair("#2f2914"), label: pair("#4c644a"), secondary: pair("#5c522c"), preview: pair("#544f38"), faint: pair("#605630"),
        icon: pair("#5c522c"), slip: pair("#fffadc"), slipEdge: pair("#d5d0b4"), slipRadius: 10, sheet: pair("#fffadc"), placeholder: pair("#605630"),
        dogEar: pair("#f3e597"), check: pair("#577456"), checkOn: pair("#fffadc"), box: pair("#857844"), track: pair("#f3e597"), paw: pair("#c4797e"),
        selection: pair("#b5a662"), toast: pair("#2f2914"), toastText: pair("#fcf0b0"),
        pinTab: Color(drawerHex: "#f6dc7c"), pinTabEdge: Color(drawerHex: "#dcc062"), pinTabInk: pair("#6b5520"), pinTape: Color(drawerHex: "#efdc90"), pickedTab: nil,
        openLine: pair("#577456"), danger: pair("#a4472f"), shadow: Color(red: 70 / 255, green: 60 / 255, blue: 20 / 255).opacity(0.12), groupHeader: pair("#5c522c"), closeBar: pair("#847845"), scheme: .light)

    /// 원고지 (#244): a light paper (the folder colours from 한지's), the colours of tokens.json's `drawer`.
    static let manuscript = DrawerPalette(
        kind: .manuscript, paper: pair("#e8e0cf"), edge: pair("#c6bfb1"), rule: .clear,
        background: .plain, texture: 0.12,
        ink: pair("#2d2a26"), title: pair("#2d2a26"), label: pair("#50694e"), secondary: pair("#605a51"), preview: pair("#5b5955"), faint: pair("#686258"),
        icon: pair("#605a51"), slip: pair("#fffefb"), slipEdge: pair("#d5d4d0"), slipRadius: 10, sheet: pair("#fffefb"), placeholder: pair("#686258"),
        dogEar: pair("#f3eee3"), check: pair("#5c7a5a"), checkOn: pair("#fffefb"), box: pair("#8f877a"), track: pair("#f3eee3"), paw: pair("#c4797e"),
        selection: pair("#b0a99c"), toast: pair("#2d2a26"), toastText: pair("#fcfaf5"),
        pinTab: Color(drawerHex: "#f6dc7c"), pinTabEdge: Color(drawerHex: "#dcc062"), pinTabInk: pair("#6b5520"), pinTape: Color(drawerHex: "#efdc90"), pickedTab: nil,
        openLine: pair("#5c7a5a"), danger: pair("#a4472f"), shadow: Color(red: 60 / 255, green: 50 / 255, blue: 30 / 255).opacity(0.12), groupHeader: pair("#605a51"), closeBar: pair("#817c70"), scheme: .light)

    /// 하늘색 줄노트 (#244): a light paper (the folder colours from 한지's), the colours of tokens.json's `drawer`.
    static let lined = DrawerPalette(
        kind: .lined, paper: pair("#d0e1f1"), edge: pair("#b0c0d0"), rule: .clear,
        background: .plain, texture: 0,
        ink: pair("#1d2a3a"), title: pair("#1d2a3a"), label: pair("#50694e"), secondary: pair("#435367"), preview: pair("#44505d"), faint: pair("#48586c"),
        icon: pair("#435367"), slip: pair("#f8fbff"), slipEdge: pair("#ccd1d8"), slipRadius: 10, sheet: pair("#f8fbff"), placeholder: pair("#48586c"),
        dogEar: pair("#dce8f4"), check: pair("#577456"), checkOn: pair("#f8fbff"), box: pair("#6e8094"), track: pair("#dce8f4"), paw: pair("#c4797e"),
        selection: pair("#9aaaba"), toast: pair("#1d2a3a"), toastText: pair("#eaf3fb"),
        pinTab: Color(drawerHex: "#f6dc7c"), pinTabEdge: Color(drawerHex: "#dcc062"), pinTabInk: pair("#6b5520"), pinTape: Color(drawerHex: "#efdc90"), pickedTab: nil,
        openLine: pair("#577456"), danger: pair("#a4472f"), shadow: Color(red: 30 / 255, green: 50 / 255, blue: 80 / 255).opacity(0.12), groupHeader: pair("#435367"), closeBar: pair("#6a7a8d"), scheme: .light)

    /// 라벤더 종이 (#244): a light paper (the folder colours from 한지's), the colours of tokens.json's `drawer`.
    static let lavender = DrawerPalette(
        kind: .lavender, paper: pair("#ddd4f0"), edge: pair("#bdb5cf"), rule: .clear,
        background: .plain, texture: 0.18,
        ink: pair("#2a2638"), title: pair("#2a2638"), label: pair("#4c644a"), secondary: pair("#565070"), preview: pair("#545160"), faint: pair("#5b5574"),
        icon: pair("#565070"), slip: pair("#fcfbff"), slipEdge: pair("#d2d0d7"), slipRadius: 10, sheet: pair("#fcfbff"), placeholder: pair("#5b5574"),
        dogEar: pair("#e7e1f4"), check: pair("#577456"), checkOn: pair("#fcfbff"), box: pair("#857e9c"), track: pair("#e7e1f4"), paw: pair("#c4797e"),
        selection: pair("#a7a0b9"), toast: pair("#2a2638"), toastText: pair("#f2eefa"),
        pinTab: Color(drawerHex: "#f6dc7c"), pinTabEdge: Color(drawerHex: "#dcc062"), pinTabInk: pair("#6b5520"), pinTape: Color(drawerHex: "#efdc90"), pickedTab: nil,
        openLine: pair("#577456"), danger: pair("#a4472f"), shadow: Color(red: 45 / 255, green: 35 / 255, blue: 70 / 255).opacity(0.12), groupHeader: pair("#565070"), closeBar: pair("#7c7593"), scheme: .light)

    /// 재생지 (#244): a light paper (the folder colours from 한지's), the colours of tokens.json's `drawer`.
    static let recycled = DrawerPalette(
        kind: .recycled, paper: pair("#d6d5ce"), edge: pair("#b6b6af"), rule: .clear,
        background: .plain, texture: 0.3,
        ink: pair("#262624"), title: pair("#262624"), label: pair("#485f46"), secondary: pair("#4f4e49"), preview: pair("#4c4c4a"), faint: pair("#55544e"),
        icon: pair("#4f4e49"), slip: pair("#f8f8f5"), slipEdge: pair("#cececb"), slipRadius: 10, sheet: pair("#f8f8f5"), placeholder: pair("#55544e"),
        dogEar: pair("#e2e1db"), check: pair("#536e51"), checkOn: pair("#f8f8f5"), box: pair("#7a7972"), track: pair("#e2e1db"), paw: pair("#c4797e"),
        selection: pair("#a1a09b"), toast: pair("#262624"), toastText: pair("#ecebe6"),
        pinTab: Color(drawerHex: "#f6dc7c"), pinTabEdge: Color(drawerHex: "#dcc062"), pinTabInk: pair("#6b5520"), pinTape: Color(drawerHex: "#efdc90"), pickedTab: nil,
        openLine: pair("#536e51"), danger: pair("#a4472f"), shadow: Color(red: 40 / 255, green: 40 / 255, blue: 36 / 255).opacity(0.12), groupHeader: pair("#4f4e49"), closeBar: pair("#75746e"), scheme: .light)

    /// 밤하늘 종이 (#244): a dark paper (the folder colours from 먹색 종이's), the colours of tokens.json's `drawer`.
    static let nightsky = DrawerPalette(
        kind: .nightsky, paper: pair("#17142a"), edge: pair("#3e3b4f"), rule: Color.white.opacity(0.04),
        background: .plain, texture: 0,
        ink: pair("#efedf9"), title: pair("#efedf9"), label: pair("#a3c49c"), secondary: pair("#cdc8e4"), preview: pair("#cfcddb"), faint: pair("#b0aacb"),
        icon: pair("#cdc8e4"), slip: pair("#27233f"), slipEdge: pair("#4f4b64"), slipRadius: 10, sheet: pair("#27233f"), placeholder: pair("#b0aacb"),
        dogEar: pair("#292542"), check: pair("#a3c49c"), checkOn: pair("#1f2a1e"), box: pair("#8f89b0"), track: pair("#292542"), paw: pair("#d39a9e"),
        selection: pair("#585568"), toast: pair("#efedf9"), toastText: pair("#1f1c33"),
        pinTab: Color(drawerHex: "#c4a245"), pinTabEdge: Color(drawerHex: "#d6b65a"), pinTabInk: pair("#1f1d18"), pinTape: Color(drawerHex: "#6a603c"), pickedTab: nil,
        openLine: pair("#a3c49c"), danger: pair("#eaa58a"), shadow: Color.black.opacity(0.45), groupHeader: pair("#cdc8e4"), closeBar: pair("#8a84a3"), scheme: .dark)

    /// 칠판 (#244): a dark paper (the folder colours from 먹색 종이's), the colours of tokens.json's `drawer`.
    static let chalk = DrawerPalette(
        kind: .chalk, paper: pair("#1b2722"), edge: pair("#414c46"), rule: Color.white.opacity(0.04),
        background: .plain, texture: 0,
        ink: pair("#eef3ea"), title: pair("#eef3ea"), label: pair("#a3c49c"), secondary: pair("#cad4c7"), preview: pair("#ced5cd"), faint: pair("#abb8a9"),
        icon: pair("#cad4c7"), slip: pair("#293832"), slipEdge: pair("#505d57"), slipRadius: 10, sheet: pair("#293832"), placeholder: pair("#abb8a9"),
        dogEar: pair("#2b3b35"), check: pair("#a3c49c"), checkOn: pair("#1f2a1e"), box: pair("#8b9b8c"), track: pair("#2b3b35"), paw: pair("#d39a9e"),
        selection: pair("#5a645e"), toast: pair("#eef3ea"), toastText: pair("#23312b"),
        pinTab: Color(drawerHex: "#c4a245"), pinTabEdge: Color(drawerHex: "#d6b65a"), pinTabInk: pair("#1f1d18"), pinTape: Color(drawerHex: "#6a603c"), pickedTab: nil,
        openLine: pair("#a3c49c"), danger: pair("#eaa58a"), shadow: Color.black.opacity(0.45), groupHeader: pair("#cad4c7"), closeBar: pair("#879487"), scheme: .dark)


    static func of(_ kind: Kind) -> DrawerPalette {
        switch kind {
        case .day: day
        case .night: night
        case .kraft: kraft
        case .grid: grid
        case .hanji: hanji
        case .sage: sage
        case .blossom: blossom
        case .ink: ink
        case .memo: memo
        case .manuscript: manuscript
        case .lined: lined
        case .lavender: lavender
        case .recycled: recycled
        case .nightsky: nightsky
        case .chalk: chalk
        }
    }

    /// One fixed colour (named so the contrast check finds the theme's pairs).
    static func pair(_ hex: String) -> Color { Color(drawerHex: hex) }
}

extension MemoDrawer.Theme {
    /// The paper's colours as they are (a tile, a swatch).
    var paperPalette: DrawerPalette { DrawerPalette.of(DrawerPalette.Kind(rawValue: rawValue)!) }
}

extension Color {
    init(drawerHex hex: String) { self.init(nsColor: NSColor(paperHex: hex) ?? .gray) }
}
