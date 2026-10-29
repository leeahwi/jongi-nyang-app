import AppKit
import PaperCore
import SwiftUI

/// 쪽지 모달 가족: every floating window, panel and sheet the app draws is a slip of paper taped
/// to the screen — one container, one header, one footer, one set of buttons, chips and fields.
/// The tape's colour says what kind of slip it is.
enum SlipKind {
    case todo, memo, event, timer, alarm, confirm

    var tape: Color {
        switch self {
        case .todo: PaperTheme.tapeHoney
        case .memo: PaperTheme.tapeLavender
        case .event: PaperTheme.tapeSky
        case .timer: PaperTheme.tapeMint
        case .alarm: PaperTheme.tapeRose
        case .confirm: PaperTheme.tapeNeutral
        }
    }

    /// The tape's 1 pt edge.
    var tapeEdge: Color {
        switch self {
        case .todo: PaperTheme.tapeHoneyEdge
        case .memo: PaperTheme.tapeLavenderEdge
        case .event: PaperTheme.tapeSkyEdge
        case .timer: PaperTheme.tapeMintEdge
        case .alarm: PaperTheme.tapeRoseEdge
        case .confirm: PaperTheme.tapeNeutralEdge
        }
    }

    /// The header badge's background and icon colour.
    var badge: (background: Color, foreground: Color) {
        switch self {
        case .todo, .timer: (PaperTheme.sage2, PaperTheme.sage)
        case .memo: (PaperTheme.memoTint, PaperTheme.memoPurple)
        case .event: (PaperTheme.eventTint, PaperTheme.eventBlue)
        case .alarm: (PaperTheme.clay2, PaperTheme.clay)
        case .confirm: (PaperTheme.paper2, PaperTheme.ink2)
        }
    }
}

/// S 320 (timer, confirm) · M 420 (quick entry, quick memo, reminders) · L 460 (event sheet).
enum SlipWidth: CGFloat {
    case small = 320, medium = 420, large = 460
}

enum SlipMetrics {
    /// Room around a slip in its window: the tape above, the shadow below and to the sides.
    static let margin = EdgeInsets(top: 16, leading: 26, bottom: 34, trailing: 26)
    static let radius: CGFloat = 16
}

/// Snapshots draw slips still (no rise-and-settle), and so does Reduce Motion.
@MainActor
enum SlipMotion {
    static var enabled = true
}

/// The container: paper, radius 16, one floating shadow, the washi tape on its top edge.
struct PaperSlip<Content: View>: View {
    let kind: SlipKind
    var width: CGFloat? = SlipWidth.medium.rawValue
    /// Where the tape sits across the top edge, 0…1 (the reminder bubble puts it at 70%).
    var tapeAt: CGFloat = 0.5
    /// The 오늘 창 hangs from the menu bar: no tape.
    var taped = true
    @ViewBuilder let content: Content
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.colorSchemeContrast) private var contrast
    @State private var settled = false

    var body: some View {
        content
            .frame(width: width)
            .background(PaperTheme.paper, in: RoundedRectangle(cornerRadius: SlipMetrics.radius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: SlipMetrics.radius, style: .continuous)
                    .strokeBorder(contrast == .increased ? PaperTheme.ink2 : PaperTheme.ink.opacity(0.07), lineWidth: contrast == .increased ? 1 : 0.6)
            }
            .overlay(alignment: .top) {
                // A thin highlight along the top, like light on the paper's edge.
                RoundedRectangle(cornerRadius: SlipMetrics.radius, style: .continuous)
                    .stroke(PaperTheme.edgeLight, lineWidth: 1)
                    .mask(alignment: .top) { Rectangle().frame(height: 2) }
                    .allowsHitTesting(false)
            }
            .slipShadow()
            .overlay(alignment: .topLeading) {
                GeometryReader { geometry in
                    if taped { WashiTape(kind: kind)
                        .frame(width: 74, height: 20)
                        .position(x: geometry.size.width * tapeAt, y: 1) }
                }
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            .foregroundStyle(PaperTheme.ink)
            .modifier(SlipAppear(active: SlipMotion.enabled && !reduceMotion))
    }
}

extension View {
    /// The one shadow of floating things (slips, toasts, popovers).
    func slipShadow() -> some View {
        modifier(SlipShadow())
    }
}

/// Warm and soft on paper; at night the same shape, deeper (a soft one vanishes on dark paper).
private struct SlipShadow: ViewModifier {
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let night = scheme == .dark
        content
            .shadow(color: PaperTheme.shadow.opacity(night ? 0.3 : 0.08), radius: 3, y: 2)
            .shadow(color: PaperTheme.shadow.opacity(night ? 0.45 : 0.2), radius: 14, y: 12)
    }
}

/// Appear: rise 8 pt, fade in, turn from −0.6° to level, 180 ms ease-out.
private struct SlipAppear: ViewModifier {
    let active: Bool
    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(!active || shown ? 1 : 0)
            .offset(y: !active || shown ? 0 : 8)
            .rotationEffect(.degrees(!active || shown ? 0 : -0.6))
            .onAppear {
                guard active else { return }
                withAnimation(.easeOut(duration: 0.18)) { shown = true }
            }
    }
}

/// A piece of washi tape: 74 × 20, turned −2.5°, its kind's colour solid with a 1 pt edge (1.45, like the note's
/// tabs — no stripes), zig-zag ends.
struct WashiTape: View {
    let kind: SlipKind

    var body: some View {
        kind.tape
            // A 2 pt stroke clipped to the outline: 1 pt inside, along the zig-zag ends too.
            .overlay { TapeShape().stroke(kind.tapeEdge, lineWidth: 2) }
            .clipShape(TapeShape())
            .rotationEffect(.degrees(-2.5))
    }
}

/// The tape's outline: torn zig-zag ends left and right.
struct TapeShape: Shape {
    func path(in rect: CGRect) -> Path {
        let w = rect.width, h = rect.height
        let points: [(CGFloat, CGFloat)] = [
            (0, 0.08), (0.04, 0), (0.08, 0.10), (0.12, 0), (0.88, 0), (0.92, 0.10), (0.96, 0), (1, 0.08),
            (1, 0.92), (0.96, 1), (0.92, 0.90), (0.88, 1), (0.12, 1), (0.08, 0.90), (0.04, 1), (0, 0.92),
        ]
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + points[0].0 * w, y: rect.minY + points[0].1 * h))
        for point in points.dropFirst() { path.addLine(to: CGPoint(x: rect.minX + point.0 * w, y: rect.minY + point.1 * h)) }
        path.closeSubpath()
        return path
    }
}

/// The header: a 28 pt round badge with the kind's line icon, the title (13 pt semibold), an
/// optional faint context (`· 4개 남았어요`), and × on the right when the slip can be closed.
struct SlipHeader: View {
    let kind: SlipKind
    let symbol: String
    let title: String
    var context: String?
    var onClose: (() -> Void)?

    var body: some View {
        HStack(spacing: 10) {
            SlipBadge(kind: kind, symbol: symbol)
            HStack(spacing: 4) {
                Text(title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(PaperTheme.ink)
                    .lineLimit(1)
                    .layoutPriority(1)
                if let context {
                    Text("· " + context)
                        .font(.system(size: 12, weight: .medium).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink3)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 4)
            if let onClose {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .medium))
                        .frame(width: 26, height: 26)
                        .contentShape(Rectangle())
                }
                .buttonStyle(SlipIconButtonStyle())
                .help("닫기")
                .accessibilityLabel("닫기")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
    }
}

struct SlipBadge: View {
    let kind: SlipKind
    let symbol: String

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 12.5, weight: .medium))
            .foregroundStyle(kind.badge.foreground)
            .frame(width: 28, height: 28)
            .background(kind.badge.background, in: Circle())
            .accessibilityHidden(true)
    }
}

/// The footer: key hints on the left, buttons on the right (a destructive one leftmost).
struct SlipFooter<Leading: View, Trailing: View>: View {
    @ViewBuilder var leading: Leading
    @ViewBuilder var trailing: Trailing

    var body: some View {
        HStack(spacing: 8) {
            leading
            Spacer(minLength: 6)
            trailing
        }
        .padding(.horizontal, 16)
        .padding(.top, 12)
        .padding(.bottom, 14)
    }
}

/// A key hint in the footer: `[esc] 닫기`.
struct KeyHint: View {
    let key: String
    let label: String

    var body: some View {
        HStack(spacing: 4) {
            KeyCap(key)
            Text(label).lineLimit(1)
        }
        .font(.system(size: 11, weight: .medium))
        .foregroundStyle(PaperTheme.ink3)
        .fixedSize()
    }
}

/// A keycap: 10 pt semibold on card, a 1 pt rule border with a 2 pt bottom.
struct KeyCap: View {
    let key: String
    var onPrimary = false

    init(_ key: String, onPrimary: Bool = false) {
        self.key = key
        self.onPrimary = onPrimary
    }

    var body: some View {
        Text(key)
            .font(.system(size: 10, weight: .semibold))
            .foregroundStyle(onPrimary ? PaperTheme.onSage.opacity(0.92) : PaperTheme.ink2)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 5)
            .frame(minHeight: 15)
            .background(onPrimary ? PaperTheme.onSage.opacity(0.16) : PaperTheme.card, in: RoundedRectangle(cornerRadius: 5))
            .overlay {
                RoundedRectangle(cornerRadius: 5)
                    .strokeBorder(onPrimary ? PaperTheme.onSage.opacity(0.28) : PaperTheme.rule, lineWidth: 1)
            }
            .overlay(alignment: .bottom) {
                // The 2 pt bottom edge of a key.
                RoundedRectangle(cornerRadius: 5)
                    .fill(onPrimary ? PaperTheme.onSage.opacity(0.28) : PaperTheme.rule)
                    .frame(height: 2)
                    .mask(alignment: .bottom) { RoundedRectangle(cornerRadius: 5).frame(height: 2) }
            }
            .accessibilityHidden(true)
    }
}

/// The footer's buttons: one primary (sage fill, its key inside), ghosts (text only, ink2),
/// and a destructive one in clay.
struct SlipButtonStyle: ButtonStyle {
    /// primary: sage fill · ghost: text only · danger: clay text · quiet: paper2 fill ·
    /// destructive: clay fill (a delete that is the slip's main answer, like 일정 지우기).
    enum Role { case primary, ghost, danger, quiet, destructive }
    var role: Role = .ghost
    /// The primary's shortcut, drawn inside it (`↩`, `⌘↩`).
    var key: String?
    var fullWidth = false
    var large = false
    @Environment(\.isEnabled) private var enabled
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 8) {
            configuration.label
                .lineLimit(1)
            if let key { KeyCap(key, onPrimary: role == .primary || role == .destructive) }
        }
        .font(.system(size: large ? 15 : 13, weight: .semibold))
        .foregroundStyle(foreground)
        .padding(.horizontal, role == .danger ? 4 : 14)
        .padding(.vertical, large ? 12 : 7)
        .frame(maxWidth: fullWidth ? .infinity : nil)
        .background {
            switch role {
            case .primary, .destructive:
                let fill = role == .primary ? PaperTheme.sage : PaperTheme.clayText
                RoundedRectangle(cornerRadius: large ? 12 : 10, style: .continuous).fill(fill)
                    .overlay(alignment: .top) {
                        RoundedRectangle(cornerRadius: large ? 12 : 10, style: .continuous).stroke(PaperTheme.edgeLight.opacity(0.36), lineWidth: 1)
                            .mask(alignment: .top) { Rectangle().frame(height: 1.5) }
                    }
                    // A tinted drop shadow by day; at night a tinted one reads as a glow, so it's black.
                    .shadow(color: PaperTheme.buttonShadow(fill), radius: 3, y: 2)
            case .quiet:
                RoundedRectangle(cornerRadius: 10, style: .continuous).fill(PaperTheme.paper2)
            case .ghost, .danger:
                RoundedRectangle(cornerRadius: 10, style: .continuous).fill(PaperTheme.sage.opacity(hovering ? 0.06 : 0))
            }
        }
        .overlay {
            RoundedRectangle(cornerRadius: large ? 12 : 10, style: .continuous).fill(PaperTheme.ink.opacity(configuration.isPressed ? 0.08 : 0))
        }
        .opacity(enabled ? 1 : 0.45)
        .contentShape(RoundedRectangle(cornerRadius: 10))
        .onHover { hovering = $0 }
    }

    private var foreground: Color {
        switch role {
        case .primary, .destructive: PaperTheme.onSage
        case .ghost, .quiet: PaperTheme.ink2
        case .danger: PaperTheme.clayText
        }
    }
}

/// × and other small icon buttons on a slip.
struct SlipIconButtonStyle: ButtonStyle {
    @State private var hovering = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(PaperTheme.ink3)
            .background(PaperTheme.paper2.opacity(configuration.isPressed ? 1 : hovering ? 0.8 : 0), in: RoundedRectangle(cornerRadius: 8))
            .onHover { hovering = $0 }
    }
}

/// What the person picks: a chip (radius 8, paper2; picked: sage2 with a 1.5 pt sage ring).
struct SlipChip: View {
    let title: String
    var symbol: String?
    var selected = false
    var centered = false

    var body: some View {
        HStack(spacing: 6) {
            if let symbol { Image(systemName: symbol).font(.system(size: 11, weight: .medium)) }
            Text(title).lineLimit(1).minimumScaleFactor(0.8)
        }
        .font(.system(size: 12, weight: .medium).monospacedDigit())
        .foregroundStyle(selected ? PaperTheme.sageText : PaperTheme.ink2)
        .padding(.horizontal, centered ? 6 : 10)
        .padding(.vertical, 4)
        .frame(maxWidth: centered ? .infinity : nil, minHeight: 24)
        .background(selected ? PaperTheme.sage2 : PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay {
            if selected { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) }
        }
        .contentShape(RoundedRectangle(cornerRadius: 8))
    }
}

/// A chip that's a button.
struct SlipChipButton: View {
    let title: String
    var symbol: String?
    var selected = false
    var centered = false
    let action: () -> Void

    var body: some View {
        Button(action: action) { SlipChip(title: title, symbol: symbol, selected: selected, centered: centered) }
            .buttonStyle(.plain)
            .accessibilityLabel(title)
            .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// What the person writes: handwriting on one underline (1.5 pt rule, sage when focused).
struct HandField: View {
    let placeholder: String
    @Binding var text: String
    var size: CGFloat = 28
    var font: NotebookFont = .pen
    var trailing: AnyView?
    var onSubmit: () -> Void = {}
    var onCancel: (() -> Void)?
    var autofocus = false
    @FocusState private var focused: Bool

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .font(font.handFont(size))
                .tint(PaperTheme.sage)
                .focused($focused)
                .onSubmit(onSubmit)
                .onExitCommand(perform: onCancel)
                .accessibilityLabel(placeholder)
            if let trailing { trailing }
        }
        .padding(.top, 2)
        .padding(.bottom, 6)
        .overlay(alignment: .bottom) {
            Rectangle().fill(focused ? PaperTheme.sage : PaperTheme.rule).frame(height: 1.5)
        }
        // (Snapshots draw it unfocused, without a selection.)
        .onAppear { if autofocus && SlipMotion.enabled { DispatchQueue.main.async { focused = true } } }
    }
}

extension NotebookFont {
    /// The handwriting at a given size (the clean face stays the system font, a little smaller).
    @MainActor
    func handFont(_ size: CGFloat) -> Font {
        switch self {
        case .pen: HandwritingFont.swiftUI(face: .pen, size: size)
        case .brush: HandwritingFont.swiftUI(face: .brush, size: size * 0.94)
        case .clean: .system(size: (size * 0.62).rounded(), weight: .medium)
        }
    }

    @MainActor
    func handNSFont(_ size: CGFloat) -> NSFont {
        switch self {
        case .pen: HandwritingFont.native(face: .pen, size: size)
        case .brush: HandwritingFont.native(face: .brush, size: size * 0.94)
        case .clean: .systemFont(ofSize: (size * 0.62).rounded(), weight: .medium)
        }
    }
}

// MARK: - Windows

/// A borderless window that holds one slip with room around it for the tape and the shadow. It
/// takes typing (`canBecomeKey`) without needing a title bar.
class SlipPanel: NSPanel {
    var onResignKey: () -> Void = {}
    override var canBecomeKey: Bool { true }

    convenience init(nonactivating: Bool) {
        self.init(contentRect: NSRect(x: 0, y: 0, width: 100, height: 100),
                  styleMask: nonactivating ? [.borderless, .nonactivatingPanel] : [.borderless],
                  backing: .buffered, defer: false)
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        becomesKeyOnlyIfNeeded = false
        animationBehavior = .none
    }

    override func resignKey() {
        super.resignKey()
        onResignKey()
    }

    /// Puts a slip in the window (with its margins) and sizes the window to it; when the slip
    /// grows or shrinks (chips appear, a hint shows, a card's line wraps) the window follows, the
    /// slip's top edge and its middle staying put.
    ///
    /// The slip tells its own size as it is laid out (the geometry callback → `fit`), so it is laid
    /// out where it will live: in this window, first at a roomy provisional size. 1.42.1: it used to be
    /// measured on its own before going in. That first size came back while the old content was still
    /// in the window, and the provisional size set after it replaced it; the slip reports again only
    /// when its size changes, so a slip that kept its size stayed centred in a 520 × 420 window — a
    /// short one sat low, and a tall 오늘 창 (a running timer, a wrapped card, two lists) lost the top
    /// and the bottom of its paper. (The hosting view's own fitting size is always 0 × 0 here: it is
    /// told not to size itself.)
    func show<V: View>(_ view: V) {
        let root = view
            .padding(SlipMetrics.margin)
            .fixedSize()
            .onGeometryChange(for: CGSize.self) { $0.size } action: { [weak self] size in self?.fit(size) }
        let hosting = NSHostingView(rootView: AnyView(root))
        // The window follows the slip (fit), not the other way round.
        hosting.sizingOptions = []
        // Shown from inside a SwiftUI action (a button in another window), the slip may report only a moment
        // later; till then the provisional size keeps the window visible and clickable — a zero-size modal
        // one blocked every click (1.40.0, the focus card's ×).
        let provisional = NSSize(width: 520, height: 420)
        setContentSize(provisional)
        hosting.frame = NSRect(origin: .zero, size: provisional)
        contentView = hosting
        hosting.layoutSubtreeIfNeeded()
    }

    /// The window takes the slip's size: the top edge and the middle stay where they were (where
    /// `placeSlip` put them, under the menu bar item for the 오늘 창), and a slip on screen stays
    /// inside the screen's visible frame.
    private func fit(_ size: CGSize) {
        guard size.width > 1, size.height > 1, abs(size.height - frame.height) > 0.5 || abs(size.width - frame.width) > 0.5 else { return }
        var next = NSRect(x: frame.midX - size.width / 2, y: frame.maxY - size.height, width: size.width, height: size.height)
        if isVisible, let area = screen?.visibleFrame { next.origin = Self.kept(next, in: area) }
        setFrame(next, display: true)
        contentView?.frame = NSRect(origin: .zero, size: size)
    }

    /// The slip's own frame on screen (the window less its margins).
    var slipFrame: NSRect {
        let m = SlipMetrics.margin
        return NSRect(x: frame.minX + m.leading, y: frame.minY + m.bottom,
                      width: frame.width - m.leading - m.trailing, height: frame.height - m.top - m.bottom)
    }

    /// Places the slip (not the window) with the middle of its top edge at `point`, kept on that screen.
    func placeSlip(topCenter point: NSPoint) {
        let m = SlipMetrics.margin
        let slipWidth = frame.width - m.leading - m.trailing
        var origin = NSPoint(x: point.x - slipWidth / 2 - m.leading, y: point.y - frame.height + m.top)
        if let area = (NSScreen.screens.first { $0.frame.contains(point) } ?? NSScreen.main)?.visibleFrame {
            origin = Self.kept(NSRect(origin: origin, size: frame.size), in: area)
        }
        setFrameOrigin(origin)
    }

    /// Where a slip window goes so the slip (not its margins) stays 8 pt inside `area`; when it
    /// can't, its top edge does.
    static func kept(_ window: NSRect, in area: NSRect) -> NSPoint {
        let m = SlipMetrics.margin
        return NSPoint(x: min(max(window.minX, area.minX - m.leading + 8), area.maxX - window.width + m.trailing - 8),
                       y: min(max(window.minY, area.minY - m.bottom + 8), area.maxY - window.height + m.top - 8))
    }
}

extension String {
    /// A handwritten title with room for its last letter: Caveat and Kalam lean right, past the
    /// text's frame ("Ahead" would read "Aheaa", "coffee" "coffe" where the frame clips), so anything
    /// that doesn't end in Hangul gets a thin space after it — in every language, since a Korean list
    /// can hold "coffee" too. Korean letters sit inside their frame. (Checked by test-presentation.sh.)
    var handwritten: String {
        guard let last = unicodeScalars.last, !last.properties.isWhitespace else { return self }
        let hangul = (0xAC00...0xD7A3).contains(last.value) || (0x3131...0x318E).contains(last.value)
        return hangul ? self : self + "\u{2009}"
    }
}

/// A borderless one-line field in the UI face whose placeholder is faint (ink3), like every other
/// hint on paper — SwiftUI's plain TextField draws its placeholder in the text's own colour here.
/// The event sheet's 장소 (선택).
struct PlainSlipField: NSViewRepresentable {
    let placeholder: String
    @Binding var text: String
    var size: CGFloat = 13
    var accessibilityLabel: String?
    /// Return in the field (the sheet's 만들기 / 저장).
    var onSubmit: () -> Void = {}

    func makeCoordinator() -> Coordinator { Coordinator(text: $text, onSubmit: onSubmit) }

    func makeNSView(context: Context) -> NSTextField {
        let field = NSTextField()
        field.isBordered = false
        field.isBezeled = false
        field.drawsBackground = false
        field.focusRingType = .none
        field.lineBreakMode = .byTruncatingTail
        field.cell?.isScrollable = true
        field.cell?.wraps = false
        field.delegate = context.coordinator
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        update(field)
        return field
    }

    func updateNSView(_ field: NSTextField, context: Context) {
        context.coordinator.text = $text
        context.coordinator.onSubmit = onSubmit
        update(field)
    }

    private func update(_ field: NSTextField) {
        if field.stringValue != text { field.stringValue = text }
        let font = NSFont.systemFont(ofSize: size)
        if field.font != font { field.font = font }
        field.textColor = NSColor(PaperTheme.ink)
        field.placeholderAttributedString = NSAttributedString(string: placeholder, attributes: [
            .font: font, .foregroundColor: NSColor(PaperTheme.ink3),
        ])
        field.setAccessibilityLabel(accessibilityLabel ?? placeholder)
    }

    final class Coordinator: NSObject, NSTextFieldDelegate {
        var text: Binding<String>
        var onSubmit: () -> Void
        init(text: Binding<String>, onSubmit: @escaping () -> Void) { self.text = text; self.onSubmit = onSubmit }

        func control(_ control: NSControl, textView: NSTextView, doCommandBy selector: Selector) -> Bool {
            guard selector == #selector(NSResponder.insertNewline(_:)) else { return false }
            onSubmit()
            return true
        }

        func controlTextDidChange(_ notification: Notification) {
            guard let field = notification.object as? NSTextField else { return }
            text.wrappedValue = field.stringValue
        }

        func controlTextDidBeginEditing(_ notification: Notification) {
            (notification.object as? NSTextField)?.currentEditor().flatMap { $0 as? NSTextView }?.insertionPointColor = NSColor(PaperTheme.sage)
        }
    }
}
