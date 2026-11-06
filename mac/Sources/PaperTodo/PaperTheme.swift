import AppKit
import PaperCore
import SwiftUI

/// The paper's colours as named tokens. Since #244 each is the colour of the paper drawn (`PaperLook.shared`, one of the
/// fifteen in `NotePalette.swift`): one colour that resolves for the appearance it is drawn in — the paper by day, and at
/// night the paper 밤에는 picked — and a view whose `body` reads one redraws when the paper changes. 낮 · 밤 and the paper's
/// lightness set `NSApp.appearance`, so every window and every system control switch together. The values (낮 종이 and
/// 밤 종이 as 1.47's) are in NotePalette.swift, which `scripts/check-contrast.py` checks against WCAG AA.
enum PaperTheme {
    // MARK: Tokens
    /// The sheet.
    static var paper: Color { PaperLook.color(.paper) }
    /// Sunken areas: chips, segmented backgrounds, the track, the desk's sidebar.
    static var paper2: Color { PaperLook.color(.paper2) }
    /// Raised cards on the sheet: the day ribbon, the input line, settings groups.
    static var card: Color { PaperLook.color(.card) }
    /// What's picked on a sunken surface: the desk's selected pane, a segmented control's choice
    /// (by day the card; at night a step lighter, since the night card sits below paper2).
    static var raised: Color { PaperLook.color(.raised) }
    /// Text: primary, secondary, faint. (1.37: ink3 darkened by day to pass AA as text — 4.5:1 on paper,
    /// paper2 and card; the old colour lives on as `faint`, for marks that aren't text.)
    static var ink: Color { PaperLook.color(.ink) }
    static var ink2: Color { PaperLook.color(.ink2) }
    static var ink3: Color { PaperLook.color(.ink3) }
    /// Decorative, not text: rules-ish marks, disabled glyphs, empty-state ornaments.
    static var faint: Color { PaperLook.color(.faint) }
    /// Ruled lines and borders.
    static var rule: Color { PaperLook.color(.rule) }
    /// "지금 · 끝냄 · 선택".
    static var sage: Color { PaperLook.color(.sage) }
    static var sage2: Color { PaperLook.color(.sage2) }
    /// Sage as text (on paper, on sage2 and sage tints): a step darker by day to pass AA.
    static var sageText: Color { PaperLook.color(.sageText) }
    /// Text and marks on a sage fill (the primary button, a ticked box, today's date).
    static var onSage: Color { PaperLook.color(.onSage) }
    /// "곧 · 늦음 · 지금 선".
    static var clay: Color { PaperLook.color(.clay) }
    static var clay2: Color { PaperLook.color(.clay2) }
    /// Clay as text (late, `40분 뒤`, soon): a step darker by day to pass AA on paper, card and clay2.
    static var clayText: Color { PaperLook.color(.clayText) }
    /// A switch's knob: white by day; the ink colour at night, so it isn't the brightest thing on the page.
    /// (The off track is `rule` edged with `checkBorder`, ≥ 3:1 against paper and card.)
    static var switchKnob: Color { PaperLook.color(.switchKnob) }
    /// The note's red margin line (by day clay at 22% on paper; at night clay2, not a hand-mixed tint).
    static var marginRule: Color { PaperLook.color(.marginRule) }
    /// An open checkbox's border.
    static var checkBorder: Color { PaperLook.color(.checkBorder) }
    /// The note's tabs (1.45, solid with a 1 pt edge): 오늘 honey, 앞으로 lavender — lighter at night than the
    /// paper, so their names are in a dark ink there too (`tabInk`).
    static var tabToday: Color { PaperLook.color(.tabToday) }
    static var tabAhead: Color { PaperLook.color(.tabAhead) }
    static var tabTodayEdge: Color { PaperLook.color(.tabTodayEdge) }
    static var tabAheadEdge: Color { PaperLook.color(.tabAheadEdge) }
    /// A tab's name and count, picked or not: ink by day, a dark ink on the light night tabs.
    static var tabInk: Color { PaperLook.color(.tabInk) }
    /// The tabs' old softer colours, kept for what wears them under ink (light ink at night): the 꾸미기 · 알림 ·
    /// AI 연결 panes' icon tiles and the help's groups.
    static var tintToday: Color { PaperLook.color(.tintToday) }
    static var tintAhead: Color { PaperLook.color(.tintAhead) }
    /// 종이냥's pane tile and help group (rose).
    static var tabMemo: Color { PaperLook.color(.tabMemo) }
    /// Washi tape on the slips, by kind (1.45: solid with a 1 pt edge like the tabs, no stripes). Its edge is the
    /// colour a step darker by day and a step lighter at night, where the tape is lighter than the paper.
    static var tapeHoney: Color { PaperLook.color(.tapeHoney) }
    static var tapeLavender: Color { PaperLook.color(.tapeLavender) }
    static var tapeSky: Color { PaperLook.color(.tapeSky) }
    static var tapeMint: Color { PaperLook.color(.tapeMint) }
    static var tapeRose: Color { PaperLook.color(.tapeRose) }
    static var tapeNeutral: Color { PaperLook.color(.tapeNeutral) }
    static var tapeHoneyEdge: Color { PaperLook.color(.tapeHoneyEdge) }
    static var tapeLavenderEdge: Color { PaperLook.color(.tapeLavenderEdge) }
    static var tapeSkyEdge: Color { PaperLook.color(.tapeSkyEdge) }
    static var tapeMintEdge: Color { PaperLook.color(.tapeMintEdge) }
    static var tapeRoseEdge: Color { PaperLook.color(.tapeRoseEdge) }
    static var tapeNeutralEdge: Color { PaperLook.color(.tapeNeutralEdge) }
    /// Event blue on a light tint (the event sheet's and alert's badge).
    static var eventBlue: Color { PaperLook.color(.eventBlue) }
    static var eventTint: Color { PaperLook.color(.eventTint) }
    /// Memo purple on a light tint (the quick-memo badge).
    static var memoPurple: Color { PaperLook.color(.memoPurple) }
    static var memoTint: Color { PaperLook.color(.memoTint) }
    /// AI 연결's stamp on a row Claude added or changed today (1.42): blue-grey stamp ink.
    static var stamp: Color { PaperLook.color(.stamp) }
    /// 백업 목록's kind chips (#140): 업데이트 전 lavender words on memoTint, 직접 honey words on honey2 (매일 sage, the ‘before’ ones clay).
    static var lavenderText: Color { PaperLook.color(.lavenderText) }
    static var honeyText: Color { PaperLook.color(.honeyText) }
    static var honey2: Color { PaperLook.color(.honey2) }
    /// The toast: an ink pill with paper text (so at night a light pill with dark text); its
    /// action and the kind word in it.
    static var toastBack: Color { PaperLook.color(.toastBack) }
    static var toastText: Color { PaperLook.color(.toastText) }
    static var toastAction: Color { PaperLook.color(.toastAction) }
    static var toastKind: Color { PaperLook.color(.toastKind) }
    /// The desk under the snapshots of slips.
    static var desk: Color { PaperLook.color(.desk) }
    /// Light on a paper edge (the slips' top highlight): bright by day, a faint gleam at night.
    static let edgeLight = Color(nsColor: NSColor(name: nil) { appearance in
        NSColor.white.withAlphaComponent(appearance.isNight ? 0.06 : 0.7)
    })
    /// Floating things' shadow: warm and soft on paper, deeper at night (where a soft one vanishes).
    static let shadow = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.isNight ? NSColor.black : NSColor(red: 70 / 255, green: 58 / 255, blue: 30 / 255, alpha: 1)
    })

    /// A filled button's drop shadow: its own colour at 35% by day; black at night, where a tinted
    /// shadow on dark paper reads as a light halo.
    static func buttonShadow(_ fill: Color) -> Color {
        let day = NSColor(fill).withAlphaComponent(0.35)
        return Color(nsColor: NSColor(name: nil) { appearance in
            appearance.isNight ? NSColor.black.withAlphaComponent(0.45) : day
        })
    }

    /// Behind a card over the note (the welcome guide): a warm ink wash by day, black at night.
    static let scrim = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.isNight ? NSColor.black.withAlphaComponent(0.42) : NSColor(red: 47 / 255, green: 46 / 255, blue: 42 / 255, alpha: 0.18)
    })

    /// A day colour and its night one, as one colour.
    static func token(_ day: String, night: String) -> Color { Color(nsColor: NSColor.token(day, night: night)) }

    /// An event's colour on the paper drawn (#244, Q6): one of the six (`LocalEvent.Color`) is that paper's mark — a step
    /// deeper where its own colour stood below 3:1 on the paper or a card, dimmed on a dark paper as before; any other hue
    /// is itself, a little dimmer at night (85 % brightness) so it doesn't glare.
    static func event(_ hex: String, fallback: Color = PaperTheme.sage) -> Color {
        if let known = LocalEvent.Color.allCases.first(where: { $0.hex == hex.lowercased() }) { return PaperLook.mark(known) }
        guard let day = NSColor(paperHex: hex) else { return fallback }
        return Color(nsColor: NSColor(name: nil) { appearance in
            guard appearance.isNight, let rgb = day.usingColorSpace(.sRGB) else { return day }
            return NSColor(hue: rgb.hueComponent, saturation: rgb.saturationComponent, brightness: rgb.brightnessComponent * 0.85, alpha: 1)
        })
    }

    /// A token as 낮 종이 and 밤 종이 draw it, whatever paper is picked: for what keeps to day and night only (4-4 — the focus
    /// ring, the alarm's dial).
    static func dayNight(_ token: NotePalette.Token) -> Color {
        Color(nsColor: NSColor.token(NotePalette.day.hex(token), night: NotePalette.night.hex(token)))
    }

    // MARK: Older names (the same tokens)
    static var secondary: Color { ink2 }
    static var faded: Color { ink3 }
    static var accent: Color { clay }

    static let rowHeight: CGFloat = 44
    static let margin: CGFloat = 54

    @MainActor static let texture = asset("PaperTexture")
    static var mascotName: String { L("종이냥") }
    /// Shown in 종이냥에 관하여 (Info.plist) and under every help page; the same in every language.
    static let copyright = Bundle.main.object(forInfoDictionaryKey: "NSHumanReadableCopyright") as? String ?? "© 2026 leeAhwi. All rights reserved."
    /// The source art is 1254 px; nothing shows it larger than ~90 pt, so keep a 384 px copy.
    /// Redrawing the full-size bitmap every animation frame cost ~30% CPU during reminders.
    @MainActor static let mascot = downsampled(asset("PaperCat"), maxPixels: 384)

    @MainActor static func downsampled(_ image: NSImage, maxPixels: CGFloat) -> NSImage {
        guard let source = image.cgImage(forProposedRect: nil, context: nil, hints: nil),
              CGFloat(max(source.width, source.height)) > maxPixels else { return image }
        let scale = maxPixels / CGFloat(max(source.width, source.height))
        let width = Int((CGFloat(source.width) * scale).rounded()), height = Int((CGFloat(source.height) * scale).rounded())
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return image }
        context.interpolationQuality = .high
        context.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let scaled = context.makeImage() else { return image }
        return NSImage(cgImage: scaled, size: NSSize(width: width / 2, height: height / 2))
    }

    @MainActor static func asset(_ name: String) -> NSImage {
        let url = AppResources.url(name, extension: "png", in: "Assets")!
        return NSImage(contentsOf: url)!
    }
}

/// The motion words both apps share (docs/plans/motion-audit.md §2; Windows `--motion-*` in base.css and
/// `motion` in api.ts). Every new movement uses one of these, runs once and ends: nothing repeats.
/// 살짝 0.12 (hover, a tab rising, a drop target, fading out) · 바뀜 0.16 (switches, ⌄, a check's pop,
/// folding) · 등장 0.18 (slips, toasts, new rows; rising 6–8 pt with a fade) · 그리기 0.22 (the pencil line,
/// the donut) · 톡 0.3 (the cat's bubble and the first guide only).
enum Motion {
    case quick, change, enter, draw, bounce

    var duration: Double {
        switch self {
        case .quick: 0.12
        case .change: 0.16
        case .enter: 0.18
        case .draw: 0.22
        case .bounce: 0.3
        }
    }

    /// 바탕화면 위젯 (#234): solid this fast when the pointer comes onto it, and back this long after it left.
    static let widgetSolid = 0.15
    static let widgetFadeDelay = 0.6
    /// How far a new thing rises as it fades in (등장).
    static let rise: CGFloat = 6
    /// The pencil line starts this long after the box pops (체크 한 번, as on Windows).
    static let strikeDelay = 0.08
    /// A finished row stays this long where it was before it goes (완료 숨기기, 앞으로, 오늘 창).
    static let hold = 0.65
    /// The day strip's box, after it is pressed, before the task is done.
    static let dayStripHold = 0.45
    /// Both holds under Reduce Motion: long enough to see what was pressed.
    static let reducedHold = 0.3
    /// 흔들기 (#229, slip-move-cases.json `nudge`): a question a click couldn't get past swings to these (pt) and settles,
    /// in 톡's 0.3 s split evenly. Under Reduce Motion its tape blinks instead: these opacities, 살짝 (0.12 s) each.
    static let shake: [CGFloat] = [-7, 6, -4, 2, 0]
    static let blink: [Double] = [0.25, 1, 0.25, 1]

    /// Reduce Motion, for code outside a view (views read `accessibilityReduceMotion`).
    @MainActor static var reduced: Bool { NSWorkspace.shared.accessibilityDisplayShouldReduceMotion }

    /// The animation for a change (ease-out, the bounce a spring), or nil — no animation — under Reduce
    /// Motion and in snapshots (`SlipMotion.enabled == false`).
    @MainActor static func animation(_ motion: Motion, reduce: Bool) -> Animation? {
        guard !reduce, SlipMotion.enabled else { return nil }
        if motion == .bounce { return .spring(response: 0.3, dampingFraction: 0.7) }
        return .easeOut(duration: motion.duration)
    }

    /// The same, for something leaving (closing, fading out): ease-in.
    @MainActor static func exit(_ motion: Motion, reduce: Bool) -> Animation? {
        guard !reduce, SlipMotion.enabled else { return nil }
        return .easeIn(duration: motion.duration)
    }

    /// 체크 한 번 (N2 · T2 · R2 · F4, and #163's memo checkbox): the box pops from 0.85 with 바뀜, the pencil line is
    /// drawn left to right with 그리기 starting 0.08 s later, then (where the row goes) it holds `hold` and leaves.
    @MainActor static func strike(reduce: Bool) -> Animation? {
        animation(.draw, reduce: reduce)?.delay(strikeDelay)
    }

    /// A finished row's hold, in milliseconds (0.3 s under Reduce Motion).
    @MainActor static func holdMilliseconds(_ seconds: Double = hold, reduce: Bool? = nil) -> Int {
        Int((((reduce ?? reduced) ? reducedHold : seconds) * 1000).rounded())
    }
}

extension View {
    /// 체크 한 번's pop: the box shrinks to 0.85 and comes back with 바뀜 each time `trigger` goes up. Bump it only
    /// when a box is checked and `Motion.animation(.change, reduce:)` isn't nil (not under Reduce Motion, not in
    /// snapshots). Keyframes, because setting a flag and animating it back in the same update draws nothing.
    func checkPop(_ trigger: Int) -> some View { modifier(CheckPop(trigger: trigger)) }
}

private struct CheckPop: ViewModifier {
    let trigger: Int

    func body(content: Content) -> some View {
        content.keyframeAnimator(initialValue: CGFloat(1), trigger: trigger) { view, scale in
            view.scaleEffect(scale)
        } keyframes: { _ in
            KeyframeTrack {
                MoveKeyframe(0.85)
                LinearKeyframe(1, duration: 0.16, timingCurve: .easeOut) // 바뀜
            }
        }
    }
}

extension NSAppearance {
    /// Drawn in 밤 종이 (any dark appearance).
    var isNight: Bool { bestMatch(from: [.darkAqua, .aqua]) == .darkAqua }
}

extension NSColor {
    /// "#RRGGBB".
    convenience init?(paperHex hex: String) {
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        guard digits.count == 6, let value = Int(digits, radix: 16) else { return nil }
        self.init(srgbRed: CGFloat((value >> 16) & 0xFF) / 255, green: CGFloat((value >> 8) & 0xFF) / 255, blue: CGFloat(value & 0xFF) / 255, alpha: 1)
    }

    /// A day colour and its night one: resolves for the appearance it is drawn in.
    static func token(_ day: String, night: String) -> NSColor {
        let light = NSColor(paperHex: day)!, dark = NSColor(paperHex: night)!
        return NSColor(name: nil) { $0.isNight ? dark : light }
    }
}

/// 꾸미기 → 낮 · 밤: 자동 (follows macOS) · 낮 · 밤.
enum PaperColor: String, CaseIterable, Identifiable {
    case auto, day, night
    var id: String { rawValue }
    static let key = "paper.color"

    var title: String {
        switch self {
        case .auto: L("자동")
        case .day: L("낮")
        case .night: L("밤")
        }
    }

    var dayNight: PaperLook.DayNight { PaperLook.DayNight(rawValue: rawValue)! }

    /// Every window that doesn't choose its own follows the app's appearance: 낮 · 밤 with the paper's lightness (#244,
    /// `PaperLook.appearance` — a dark paper keeps the menus dark by day too).
    @MainActor func apply() {
        PaperLook.shared.update(dayNight: dayNight)
    }
}

struct PaperBackground: View {
    /// The grain is a cream texture (on average #f5f1e9, about 낮 종이's colour). On another paper it is tinted to that paper
    /// (#244) — multiplied by the paper over the texture's average, drawn once into a bitmap and kept — so the grain shows
    /// without washing a tinted paper (크라프트지, 재생지) toward cream. 낮 종이 keeps it as it is.
    @MainActor static func texture(_ kind: PaperKind) -> NSImage {
        if let made = textures[kind] { return made }
        let texture = PaperTheme.texture
        guard kind != .day, let paper = DrawerPalette.rgb(NotePalette.of(kind).paper),
              let source = texture.cgImage(forProposedRect: nil, context: nil, hints: nil),
              let context = CGContext(data: nil, width: source.width, height: source.height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return texture }
        let average: [Double] = [0xf5, 0xf1, 0xe9]
        let scale = zip(paper, average).map { CGFloat(min(1, $0 / $1)) }
        let rect = CGRect(x: 0, y: 0, width: source.width, height: source.height)
        context.draw(source, in: rect)
        context.setBlendMode(.multiply)
        context.setFillColor(CGColor(srgbRed: scale[0], green: scale[1], blue: scale[2], alpha: 1))
        context.fill(rect)
        guard let tinted = context.makeImage() else { return texture }
        let made = NSImage(cgImage: tinted, size: texture.size)
        textures[kind] = made
        return made
    }
    @MainActor private static var textures: [PaperKind: NSImage] = [:]

    /// Increase Contrast: plain paper, no grain.
    @Environment(\.colorSchemeContrast) private var contrast
    /// The paper drawn by day or at night: its grain (none on the dark papers — a light texture at night would read as dust).
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let kind = PaperLook.shared.paper(dark: scheme == .dark)
        let grain = kind.grain
        PaperTheme.paper
            .overlay {
                // A very faint grain (a few percent of contrast), off with Increase Contrast and on papers without one.
                if contrast != .increased && grain > 0 {
                    GeometryReader { geometry in
                        Image(nsImage: Self.texture(kind))
                            .resizable()
                            .scaledToFill()
                            .frame(width: geometry.size.width, height: geometry.size.height)
                            .clipped()
                            .opacity(grain)
                    }
                    .allowsHitTesting(false)
                }
            }
            .overlay(alignment: .top) {
                Rectangle().fill(scheme == .dark ? Color.white.opacity(0.04) : Color.white.opacity(0.6)).frame(height: 1)
            }
            .ignoresSafeArea()
            .accessibilityHidden(true)
    }
}

/// The paper's ruling under the rows (and, from #244, in each row of the sheet): lines every row; 모눈's squares (11 pt,
/// every fourth a row's line); 원고지's cells (a rule over and under each row's writing band and a stroke every 22 pt, in
/// the paper's red `rule`); 하늘색 줄노트's blue lines (its red margin is the note's margin line, 2 pt). One canvas, drawn
/// once — the squares and cells are more strokes, not more redraws.
struct PaperRules: View {
    /// A row's own ruling (its height), drawn over the row from its top; nil: the sheet below the rows.
    var row: CGFloat?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        // Read here (not in the canvas) so the paper's change redraws it.
        let ruling = PaperLook.shared.paper(dark: scheme == .dark).ruling
        let rule = PaperTheme.rule
        Canvas { context, size in
            context.stroke(PaperRules.path(ruling, size: size, row: row), with: .color(rule), lineWidth: ruling == .lines || ruling == .margin ? 0.6 : 0.5)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// 원고지: the gap between one row's cells and the next row's (the band where nothing is written).
    static let manuscriptGap: CGFloat = 8

    static func path(_ ruling: PaperKind.Ruling, size: CGSize, row: CGFloat?) -> Path {
        var path = Path()
        let left: CGFloat = 18, right = size.width - 20
        guard right > left else { return path }
        func horizontal(_ y: CGFloat) {
            path.move(to: CGPoint(x: left, y: y))
            path.addLine(to: CGPoint(x: right, y: y))
        }
        func vertical(_ x: CGFloat, _ top: CGFloat, _ bottom: CGFloat) {
            path.move(to: CGPoint(x: x, y: top))
            path.addLine(to: CGPoint(x: x, y: bottom))
        }
        let rowHeight = PaperTheme.rowHeight
        switch ruling {
        case .lines, .margin:
            // A row draws its own line (TaskRow); the sheet's lines carry on under the rows.
            guard row == nil else { return path }
            var y = rowHeight - 0.5
            while y < size.height { horizontal(y); y += rowHeight }
        case .grid:
            let step = rowHeight / 4
            var y = step - 0.5
            while y < size.height { horizontal(y); y += step }
            var x = left
            while x <= right { vertical(x, 0, size.height); x += step }
        case .manuscript:
            let band = row ?? rowHeight
            var top: CGFloat = 0
            while top < size.height {
                let bottom = top + band - 0.5, upper = top + band - manuscriptGap
                if row == nil { horizontal(bottom) }
                horizontal(upper)
                var x = left
                while x <= right { vertical(x, top, upper); x += rowHeight / 2 }
                if row != nil { break }
                top += rowHeight
            }
        }
        return path
    }
}

struct QuietButtonStyle: ButtonStyle {
    var size: CGFloat = 28
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(PaperTheme.secondary)
            .frame(width: size, height: size)
            .background(PaperTheme.sage.opacity(configuration.isPressed ? 0.16 : hovering ? 0.09 : 0), in: RoundedRectangle(cornerRadius: 6))
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
    }
}

struct PaperActionButtonStyle: ButtonStyle {
    var primary = false
    @Environment(\.isEnabled) private var enabled
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .semibold))
            .padding(.horizontal, 12)
            .frame(minHeight: 32)
            .foregroundStyle(primary ? PaperTheme.onSage : PaperTheme.sage)
            .background(primary ? PaperTheme.sage : PaperTheme.sage.opacity(hovering ? 0.14 : 0.08), in: RoundedRectangle(cornerRadius: 8))
            .overlay {
                RoundedRectangle(cornerRadius: 8).fill(PaperTheme.ink.opacity(configuration.isPressed ? 0.08 : 0))
            }
            .opacity(enabled ? 1 : 0.45)
            .contentShape(RoundedRectangle(cornerRadius: 8))
            .onHover { hovering = $0 }
    }
}

/// A switch in paper colours, by day and night: a sage track when on; off, a rule-coloured track with
/// a visible edge; the knob white by day, ink at night (the system switch kept cold white knobs on
/// grey tracks at night, and inactive windows drew "on" grey). The label is for VoiceOver only —
/// every switch sits beside its own text.
struct PaperToggleStyle: ToggleStyle {
    var small = false

    func makeBody(configuration: Configuration) -> some View {
        PaperSwitch(on: configuration.isOn, small: small) { configuration.isOn.toggle() }
            .accessibilityElement()
            .accessibilityRepresentation { Toggle(isOn: configuration.$isOn) { configuration.label } }
    }
}

/// The switch itself (also the event sheet's 종일).
struct PaperSwitch: View {
    let on: Bool
    var small = false
    let action: () -> Void
    @Environment(\.isEnabled) private var enabled
    @Environment(\.accessibilityReduceMotion) private var reduceMotion


    var body: some View {
        let width: CGFloat = small ? 30 : 36, height: CGFloat = small ? 18 : 21
        Button { withAnimation(Motion.animation(.change, reduce: reduceMotion)) { action() } } label: {
            // A circular-cornered rectangle, not Capsule: Capsule's stroke left hairlines at both ends.
            let track = RoundedRectangle(cornerRadius: height / 2, style: .circular)
            track
                .fill(on ? PaperTheme.sage : PaperTheme.rule)
                .overlay { track.strokeBorder(on ? Color.clear : PaperTheme.checkBorder, lineWidth: 1) }
                .frame(width: width, height: height)
                .overlay(alignment: on ? .trailing : .leading) {
                    Circle().fill(PaperTheme.switchKnob).frame(width: height - 4, height: height - 4).padding(2)
                        .shadow(color: PaperTheme.shadow.opacity(0.25), radius: 1, y: 1)
                }
                .opacity(enabled ? 1 : 0.45)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// A pop-up choice in paper colours (instead of the system pop-up button): the picked title and ⌃⌄ on
/// paper2, the list as the system menu. Disabled: ink3 text, still readable at night.
struct PaperMenuPicker<Value: Hashable>: View {
    @Binding var selection: Value
    let options: [(value: Value, title: String)]
    let label: String
    /// A font popup (#141): the picked name drawn in its own face.
    var face: ((Value) -> Font)?
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        Menu {
            ForEach(options.indices, id: \.self) { index in
                let option = options[index]
                Button { selection = option.value } label: {
                    if option.value == selection { Label(option.title, systemImage: "checkmark") } else { Text(option.title) }
                }
            }
        } label: {
            HStack(spacing: 6) {
                Text(options.first { $0.value == selection }?.title ?? "")
                    .font(face?(selection))
                    .lineLimit(1)
                Image(systemName: "chevron.up.chevron.down").font(.system(size: 8.5, weight: .bold))
            }
            .font(.system(size: 12.5, weight: .medium))
            .foregroundStyle(enabled ? PaperTheme.ink : PaperTheme.ink3)
            .padding(.horizontal, 10)
            .frame(height: 26)
            .background(PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(PaperTheme.rule, lineWidth: 0.7) }
            .contentShape(Rectangle())
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .fixedSize()
        .accessibilityLabel(label)
    }
}

/// A capsule drawn as a rounded rectangle with circular corners: SwiftUI's Capsule left hairline
/// marks at both ends when outlined (the hover pill, the switch, the stepper).
struct Pill: InsettableShape {
    var inset: CGFloat = 0
    func path(in rect: CGRect) -> Path {
        let r = rect.insetBy(dx: inset, dy: inset)
        return RoundedRectangle(cornerRadius: min(r.width, r.height) / 2, style: .circular).path(in: r)
    }
    func inset(by amount: CGFloat) -> Pill { Pill(inset: inset + amount) }
}
