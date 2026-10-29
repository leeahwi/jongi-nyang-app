import AppKit
import PaperCore
import SwiftUI

/// 메모 서랍's four papers (design F, docs/design/memo-drawer-themes.png): 낮 종이, 밤 종이, 크라프트지, 모눈 노트.
/// Each is a fixed set of colours (the drawer doesn't follow the app's appearance except under 자동).
/// `scripts/check-contrast.py` reads the `pair(` lines below and checks them against WCAG AA.
struct DrawerPalette: Equatable {
    enum Kind: String, CaseIterable { case day, night, kraft, grid }
    enum Background { case ruled, plain, grid }

    let kind: Kind
    /// The drawer's paper, its edge, its ruling.
    let paper: Color
    let edge: Color
    let rule: Color
    let background: Background
    let texture: Double
    /// Text: ink (titles, memo text), the small green 메모 서랍 line, secondary (previews), faint (times, footer).
    let ink: Color
    let title: Color
    let label: Color
    let secondary: Color
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
    /// 고정 (the paw bookmark): its two stripes and its paw.
    let pinTab: (Color, Color)
    let pinTabInk: Color
    /// kraft and grid: the picked bookmark is a paper of its own colour (the others keep their colours).
    let pickedTab: (back: Color, ink: Color, edge: Color)?
    /// 1.44: the open memo's margin line when the folder's colour can't be used; 지우기 on the bar; a sheet's shadow.
    let openLine: Color
    let danger: Color
    let shadow: Color
    /// A date group's header (its word; the count is faint).
    let groupHeader: Color
    let scheme: ColorScheme

    static func == (a: DrawerPalette, b: DrawerPalette) -> Bool { a.kind == b.kind }

    /// The sheet's ruling (B2): rules, the red margin line, the line under it; the cat ears' pink inside.
    var sheetRule: Color { Color(drawerHex: ["day": "#ece4d2", "night": "#4a463f", "kraft": "#e8dcc3", "grid": "#d8e2ee"][kind.rawValue]!) }
    var sheetMargin: Color { Color(drawerHex: ["day": "#efc4c0", "night": "#9a6266", "kraft": "#d79a8a", "grid": "#f0b8b4"][kind.rawValue]!) }
    var sheetBottom: Color { Color(drawerHex: ["day": "#e0d7c4", "night": "#1d1c19", "kraft": "#c9b08a", "grid": "#d8e0e8"][kind.rawValue]!) }
    /// A sheet's 1 pt edge (1.44).
    var sheetEdge: Color { slipEdge }
    /// The bar's pills and the kind chips: ink at 6 %, a hairline at 10 %.
    var pill: Color { ink.opacity(kind == .night ? 0.07 : 0.06) }
    var pillEdge: Color { ink.opacity(kind == .night ? 0.12 : 0.10) }

    var innerEar: Color {
        switch kind {
        case .day: Color(drawerHex: "#f2c9c6").opacity(0.8)
        case .night: Color(drawerHex: "#7d555a")
        case .kraft: Color(drawerHex: "#e3a08e").opacity(0.7)
        case .grid: Color(drawerHex: "#f6d6d2")
        }
    }

    // MARK: Folder colours by paper

    /// A bookmark's colours: two stripes (one for solid papers), its ink, the open slip's edge, the tape.
    struct TabColors {
        let a: Color
        let b: Color
        let ink: Color
        let edge: Color
        let tape: Color
    }

    func tab(_ color: MemoFolders.Color) -> TabColors {
        let row = Self.folderColors[kind]![color]!
        return TabColors(a: Color(drawerHex: row.0), b: Color(drawerHex: row.1), ink: Color(drawerHex: row.2), edge: Color(drawerHex: row.3), tape: Color(drawerHex: row.4))
    }

    /// (stripe a, stripe b, ink on it, open slip's edge, tape) per paper and colour key.
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
    ]

    // MARK: The open memo's line (1.44)

    /// The sheet's colour as written, for working out contrast.
    static let sheetHex: [Kind: String] = [.day: "#fffdf7", .night: "#3d3a34", .kraft: "#fbf6ea", .grid: "#ffffff"]

    /// The open / picked memo's margin line (3 pt) and outline: the folder's edge colour on this paper, scaled toward
    /// black (toward white on a dark sheet) in 5 % steps until it stands 3:1 against the memo's sheet — the same rule as
    /// the Windows app. `sheet`: the memo's own paper (이 메모의 종이) or the drawer's.
    @MainActor static func openLine(_ folder: MemoFolders.Color, drawer: DrawerPalette, sheet: DrawerPalette) -> Color {
        let key = "\(folder.rawValue)-\(drawer.kind.rawValue)-\(sheet.kind.rawValue)"
        if let known = openLines[key] { return known }
        let made = Color(drawerHex: openLineHex(folderColors[drawer.kind]![folder]!.3, on: sheetHex[sheet.kind]!) ?? "")
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

    // MARK: The four papers

    /// 1.44: the drawer paper a step darker than the memo sheets, every sheet with a 1 pt edge and a soft shadow,
    /// greys darker (lighter at night) — the user picked these from mock/v3 (bottom row).
    static let day = DrawerPalette(
        kind: .day, paper: pair("#e6dbc3"), edge: pair("#c9bb9b"), rule: Color(red: 170 / 255, green: 150 / 255, blue: 110 / 255).opacity(0.35),
        background: .ruled, texture: 0.18,
        ink: pair("#2a2925"), title: pair("#2a2925"), label: pair("#42603c"), secondary: pair("#5c584f"), faint: pair("#646057"),
        icon: pair("#55504a"), slip: pair("#fffdf7"), slipEdge: pair("#d0c2a3"), slipRadius: 10, sheet: pair("#fffdf7"), placeholder: pair("#646057"),
        dogEar: pair("#efe7d4"), check: pair("#5f7a5a"), checkOn: pair("#fffdf8"), box: pair("#8a8374"), track: pair("#ece6d8"), paw: pair("#c4797e"),
        selection: pair("#b9b2a2"), toast: pair("#2a2925"), toastText: pair("#fbf9f3"),
        pinTab: (Color(drawerHex: "#f3e3a0"), Color(drawerHex: "#efdc90")), pinTabInk: pair("#6b5520"), pickedTab: nil,
        openLine: pair("#8d82cf"), danger: pair("#a4472f"), shadow: Color(red: 60 / 255, green: 50 / 255, blue: 30 / 255).opacity(0.12), groupHeader: pair("#5c584f"), scheme: .light)

    /// 1.43.1: lighter text and sheets a step above the drawer (the user found 1.43's night paper hard to read); 1.44 a
    /// darker drawer still and edged sheets.
    static let night = DrawerPalette(
        kind: .night, paper: pair("#1c1a17"), edge: pair("#4a463f"), rule: Color.white.opacity(0.04),
        background: .ruled, texture: 0,
        ink: pair("#f6f1e6"), title: pair("#f6f1e6"), label: pair("#b3cbad"), secondary: pair("#dad3c3"), faint: pair("#c4bdad"),
        icon: pair("#cdc6b7"), slip: pair("#3d3a34"), slipEdge: pair("#5a554b"), slipRadius: 10, sheet: pair("#3d3a34"), placeholder: pair("#c4bdad"),
        dogEar: pair("#4f4b43"), check: pair("#b3cbad"), checkOn: pair("#1f2a1e"), box: pair("#a39d90"), track: pair("#55514a"), paw: pair("#d39a9e"),
        selection: pair("#847e72"), toast: pair("#ece6d6"), toastText: pair("#2a2924"),
        pinTab: (Color(drawerHex: "#716641"), Color(drawerHex: "#6a603c")), pinTabInk: pair("#fff1bf"), pickedTab: nil,
        openLine: pair("#9d95d6"), danger: pair("#eaa58a"), shadow: Color.black.opacity(0.45), groupHeader: pair("#dad3c3"), scheme: .dark)

    static let kraft = DrawerPalette(
        kind: .kraft, paper: pair("#cdb187"), edge: pair("#a98d63"), rule: .clear,
        background: .plain, texture: 0.3,
        ink: pair("#33281d"), title: pair("#33281d"), label: pair("#4a3a22"), secondary: pair("#574a39"), faint: pair("#54452f"),
        icon: pair("#5a4732"), slip: pair("#fbf6ea"), slipEdge: pair("#a98d63"), slipRadius: 4, sheet: pair("#fbf6ea"), placeholder: pair("#54452f"),
        dogEar: pair("#e8dcc3"), check: pair("#4f7040"), checkOn: pair("#fbf6ea"), box: pair("#8c7a58"), track: pair("#e8dcc3"), paw: pair("#a55f4c"),
        selection: pair("#8f7650"), toast: pair("#33281d"), toastText: pair("#fbf6ea"),
        pinTab: (Color(drawerHex: "#f1d37a"), Color(drawerHex: "#f1d37a")), pinTabInk: pair("#5a4410"),
        pickedTab: (Color(drawerHex: "#f4ecdc"), Color(drawerHex: "#5a3f22"), Color(drawerHex: "#a98d63")),
        openLine: pair("#8a6a40"), danger: pair("#8f3a22"), shadow: Color(red: 60 / 255, green: 50 / 255, blue: 30 / 255).opacity(0.12), groupHeader: pair("#4a3a22"), scheme: .light)

    static let grid = DrawerPalette(
        kind: .grid, paper: pair("#dde6f0"), edge: pair("#b3c2d4"), rule: Color(drawerHex: "#c9d5e3"),
        background: .grid, texture: 0,
        ink: pair("#1f2a35"), title: pair("#1f2a35"), label: pair("#2f5793"), secondary: pair("#4b5865"), faint: pair("#57636f"),
        icon: pair("#4f5c69"), slip: pair("#ffffff"), slipEdge: pair("#bccadb"), slipRadius: 10, sheet: pair("#ffffff"), placeholder: pair("#57636f"),
        dogEar: pair("#e4ebf2"), check: pair("#3f6aa8"), checkOn: pair("#ffffff"), box: pair("#7d8a98"), track: pair("#e2e9f0"), paw: pair("#c4797e"),
        selection: pair("#9fb6dc"), toast: pair("#1f2a35"), toastText: pair("#f8fafb"),
        pinTab: (Color(drawerHex: "#f6e7b0"), Color(drawerHex: "#f6e7b0")), pinTabInk: pair("#5e4a12"),
        pickedTab: (Color(drawerHex: "#e4ebf8"), Color(drawerHex: "#24416e"), Color(drawerHex: "#9fb6dc")),
        openLine: pair("#6f8fc4"), danger: pair("#a4472f"), shadow: Color(red: 30 / 255, green: 50 / 255, blue: 80 / 255).opacity(0.13), groupHeader: pair("#4b5865"), scheme: .light)

    static func of(_ kind: Kind) -> DrawerPalette {
        switch kind {
        case .day: day
        case .night: night
        case .kraft: kraft
        case .grid: grid
        }
    }

    /// One fixed colour (named so the contrast check finds the theme's pairs).
    static func pair(_ hex: String) -> Color { Color(drawerHex: hex) }
}

extension MemoDrawer.Theme {
    /// 자동 follows the note's day or night.
    func palette(_ scheme: ColorScheme) -> DrawerPalette {
        switch self {
        case .auto: scheme == .dark ? .night : .day
        case .day: .day
        case .night: .night
        case .kraft: .kraft
        case .grid: .grid
        }
    }
}

extension Color {
    init(drawerHex hex: String) { self.init(nsColor: NSColor(paperHex: hex) ?? .gray) }
}
