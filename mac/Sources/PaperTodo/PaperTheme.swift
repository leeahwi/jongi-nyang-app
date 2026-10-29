import AppKit
import SwiftUI

/// The paper's colours as named tokens: "종이" (day) and "밤 종이" (night, from 1.36). Each token
/// is one colour that resolves for the appearance it is drawn in — the app's 종이 색 setting sets
/// `NSApp.appearance` (자동 follows macOS), so every window and every system control switch together.
/// `scripts/check-contrast.py` reads the pairs below and checks them against WCAG AA.
enum PaperTheme {
    // MARK: Tokens
    /// The sheet.
    static let paper = token("#fbf9f3", night: "#2a2924")
    /// Sunken areas: chips, segmented backgrounds, the track, the desk's sidebar.
    static let paper2 = token("#f5f1e7", night: "#33322c")
    /// Raised cards on the sheet: the day ribbon, the input line, settings groups.
    static let card = token("#fffdf8", night: "#312f29")
    /// What's picked on a sunken surface: the desk's selected pane, a segmented control's choice
    /// (by day the card; at night a step lighter, since the night card sits below paper2).
    static let raised = token("#fffdf8", night: "#46433b")
    /// Text: primary, secondary, faint. (1.37: ink3 darkened by day to pass AA as text — 4.5:1 on paper,
    /// paper2 and card; the old colour lives on as `faint`, for marks that aren't text.)
    static let ink = token("#2f2e2a", night: "#ece6d6")
    static let ink2 = token("#6b685e", night: "#bdb7a7")
    static let ink3 = token("#726e64", night: "#9f9989")
    /// Decorative, not text: rules-ish marks, disabled glyphs, empty-state ornaments.
    static let faint = token("#a5a195", night: "#8a8577")
    /// Ruled lines and borders.
    static let rule = token("#e6e0d2", night: "#3e3c34")
    /// "지금 · 끝냄 · 선택".
    static let sage = token("#5c7a5a", night: "#a3c49c")
    static let sage2 = token("#e4ebe0", night: "#39443a")
    /// Sage as text (on paper, on sage2 and sage tints): a step darker by day to pass AA.
    static let sageText = token("#546f52", night: "#a3c49c")
    /// Text and marks on a sage fill (the primary button, a ticked box, today's date).
    static let onSage = token("#fffdf8", night: "#1f2a1e")
    /// "곧 · 늦음 · 지금 선".
    static let clay = token("#b06a4f", night: "#e29a7c")
    static let clay2 = token("#f6e3db", night: "#4a3630")
    /// Clay as text (late, `40분 뒤`, soon): a step darker by day to pass AA on paper, card and clay2.
    static let clayText = token("#955842", night: "#e29a7c")
    /// A switch's knob: white by day; the ink colour at night, so it isn't the brightest thing on the page.
    /// (The off track is `rule` edged with `checkBorder`, ≥ 3:1 against paper and card.)
    static let switchKnob = token("#ffffff", night: "#ece6d6")
    /// The note's red margin line (by day clay at 22% on paper; at night clay2, not a hand-mixed tint).
    static let marginRule = token("#e7d8ce", night: "#4a3630")
    /// An open checkbox's border.
    static let checkBorder = token("#908a7b", night: "#837e69")
    /// The note's tabs: 오늘 (tab1), 앞으로 (tab2, lavender), 메모 (tab3).
    static let tabToday = token("#f5e7b2", night: "#6a5e35")
    static let tabAhead = token("#e3ddf2", night: "#4f4868")
    static let tabMemo = token("#f3dbd7", night: "#63443f")
    /// Washi tape on the slips, by kind.
    static let tapeHoney = token("#e9cf7a", night: "#8a7a3f")
    static let tapeLavender = token("#cfc6ea", night: "#5d5578")
    static let tapeSky = token("#bcd0ea", night: "#4d5f7a")
    static let tapeMint = token("#c9dcc4", night: "#4f6650")
    static let tapeRose = token("#ecc4bc", night: "#7a4f4a")
    static let tapeNeutral = token("#d9d3c4", night: "#55524a")
    /// Event blue on a light tint (the event sheet's and alert's badge).
    static let eventBlue = token("#5585cc", night: "#8fb1e3")
    static let eventTint = token("#e2eaf6", night: "#313b4a")
    /// Memo purple on a light tint (the quick-memo badge).
    static let memoPurple = token("#7a6aae", night: "#bcb0e2")
    static let memoTint = token("#ebe6f6", night: "#3a3548")
    /// AI 연결's stamp on a row Claude added or changed today (1.42): blue-grey stamp ink.
    static let stamp = token("#4d5b86", night: "#a9b6dc")
    /// The toast: an ink pill with paper text (so at night a light pill with dark text); its
    /// action and the kind word in it.
    static let toastBack = token("#2f2e2a", night: "#ece6d6")
    static let toastText = token("#fbf9f3", night: "#2a2924")
    static let toastAction = token("#f6d9c7", night: "#8f4a30")
    static let toastKind = token("#cfe3c9", night: "#3d6639")
    /// The desk under the snapshots of slips.
    static let desk = token("#efeadf", night: "#3a3833")
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

    /// An event's colour: its own hue, a little dimmer at night (85% brightness) so it doesn't glare.
    static func event(_ hex: String, fallback: Color = PaperTheme.sage) -> Color {
        guard let day = NSColor(paperHex: hex) else { return fallback }
        return Color(nsColor: NSColor(name: nil) { appearance in
            guard appearance.isNight, let rgb = day.usingColorSpace(.sRGB) else { return day }
            return NSColor(hue: rgb.hueComponent, saturation: rgb.saturationComponent, brightness: rgb.brightnessComponent * 0.85, alpha: 1)
        })
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
        let url = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "Assets")
            ?? Bundle.module.url(forResource: name, withExtension: "png", subdirectory: "Assets")!
        return NSImage(contentsOf: url)!
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

/// 꾸미기 → 종이 색: 자동 (follows macOS) · 낮 · 밤.
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

    /// Every window that doesn't choose its own follows the app's appearance.
    @MainActor func apply() {
        NSApplication.shared.appearance = switch self {
        case .auto: nil
        case .day: NSAppearance(named: .aqua)
        case .night: NSAppearance(named: .darkAqua)
        }
    }
}

struct PaperBackground: View {
    /// Increase Contrast: plain paper, no grain.
    @Environment(\.colorSchemeContrast) private var contrast
    /// 밤 종이: plain paper too (the grain is a light texture; at night it would read as dust).
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        PaperTheme.paper
            .overlay {
                // A very faint grain (a few percent of contrast), off with Increase Contrast and at night.
                if contrast != .increased && scheme != .dark {
                    GeometryReader { geometry in
                        Image(nsImage: PaperTheme.texture)
                            .resizable()
                            .scaledToFill()
                            .frame(width: geometry.size.width, height: geometry.size.height)
                            .clipped()
                            .opacity(0.22)
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

struct PaperRules: View {
    var body: some View {
        Canvas { context, size in
            var rules = Path()
            var y = PaperTheme.rowHeight - 0.5
            while y < size.height {
                rules.move(to: CGPoint(x: 18, y: y))
                rules.addLine(to: CGPoint(x: size.width - 20, y: y))
                y += PaperTheme.rowHeight
            }
            context.stroke(rules, with: .color(PaperTheme.rule), lineWidth: 0.6)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
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
        Button { withAnimation(reduceMotion ? nil : .easeOut(duration: 0.14)) { action() } } label: {
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
