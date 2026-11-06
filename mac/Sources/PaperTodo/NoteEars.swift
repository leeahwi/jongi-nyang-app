import AppKit
import SwiftUI

// 노트 창 위의 고양이 귀 (#151, the user's pick 2026-10-30): the peeking cat left the note's header; instead the note
// window has 메모 서랍's two ears standing on its top edge toward the right, in the note's own paper, so the window
// looks as if it rises into ears. The note is a titled window and can't draw outside its frame, so the ears are a
// small clear child panel above its top edge that follows it (NoteEarsController).

/// Where the ears' panel goes and when it shows — worked out from frames alone (scripts/test-note-ears.sh).
enum NoteEarsPlacement {
    /// The panel: the ears' 92 pt and room beside the far ear for it to twitch.
    nonisolated static let width: CGFloat = 100
    /// Room above the tips (a twitching ear's tip and its edge line).
    nonisolated static let room: CGFloat = 3
    /// The ears' feet run this far down over the note's top edge, so no seam shows where they meet it.
    nonisolated static let overlap: CGFloat = 1
    nonisolated static var height: CGFloat { room + CatEars.height + overlap }
    /// The note's top edge, from the panel's top (where the ears stand).
    nonisolated static var edge: CGFloat { room + CatEars.height }

    /// The panel's frame for the note's frame (screen coordinates, y up): flush with its right edge, over its top.
    nonisolated static func frame(note: NSRect) -> NSRect {
        NSRect(x: note.maxX - width, y: note.maxY - overlap, width: width, height: height)
    }

    /// The ears show while the note does — not minimised, folded or hidden (`visible`), not in full screen — and only
    /// with room above it on its screen (`visibleFrame`, under the menu bar). Off every screen (`screen` nil) they
    /// show only in the off-screen checks, where they stay off-screen with the note.
    nonisolated static func shows(note: NSRect, screen: NSRect?, visible: Bool, minimized: Bool, fullScreen: Bool, offscreen: Bool) -> Bool {
        guard visible, !minimized, !fullScreen else { return false }
        guard let screen else { return offscreen }
        return note.maxY + CatEars.height <= screen.maxY + 0.5
    }
}

/// The ears' colours: the note's paper (the paper drawn, #244), and the drawer's pink inside (`DrawerPalette.innerEar` of a
/// light paper, of a dark one at night).
enum NoteEarsColors {
    static var paper: Color { PaperTheme.paper }
    static let inner = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.isNight ? NSColor(paperHex: "#7d555a")! : NSColor(paperHex: "#f2c9c6")!.withAlphaComponent(0.8)
    })
    /// A hairline along the ears' sides, the shade of the window's own edge: the ears have no shadow (it would fall on
    /// the note), so on a desktop or window of nearly the paper's colour this keeps them from melting away.
    static let edge = Color(nsColor: NSColor(name: nil) { appearance in
        appearance.isNight ? NSColor.white.withAlphaComponent(0.16) : NSColor(red: 60 / 255, green: 50 / 255, blue: 30 / 255, alpha: 0.2)
    })
}

/// Each ear's twitches: a change of its count plays one.
@MainActor
final class NoteEarsState: ObservableObject {
    @Published var twitches = [0, 0]
}

/// The two ears, drawn in a `NoteEarsPlacement.width × height` box whose bottom runs over the note's top edge.
struct NoteEarsView: View {
    @ObservedObject var state: NoteEarsState
    /// A press on an ear (index 0 the left one).
    var onPoke: (Int) -> Void = { _ in }
    /// Snapshots: each ear's tip held this far sideways (points), as in the middle of a twitch.
    var previewTilt: [CGFloat] = [0, 0]
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        let width = NoteEarsPlacement.width, height = NoteEarsPlacement.height, edge = NoteEarsPlacement.edge
        ZStack(alignment: .topLeading) {
            ForEach(0..<CatEars.bases.count, id: \.self) { index in
                let base = CatEars.base(index, width: width, right: true)
                // The tip flicks sideways while the foot stays on the edge: the far ear outward (left), the near one the
                // other way.
                let flick: CGFloat = index == 0 ? -4 : 4
                NoteEar(a: base.a, b: base.b, edge: edge, strongEdge: contrast == .increased)
                    .modifier(EarFlick(tip: previewTilt[index], edge: edge))
                    .keyframeAnimator(initialValue: CGFloat(0), trigger: state.twitches[index]) { content, tip in
                        content.modifier(EarFlick(tip: tip, edge: edge))
                    } keyframes: { _ in
                        // ~0.4 s: out quickly, a little past the start, settled.
                        KeyframeTrack {
                            CubicKeyframe(flick, duration: 0.11)
                            CubicKeyframe(-flick / 3, duration: 0.14)
                            CubicKeyframe(0, duration: 0.15)
                        }
                    }
                    .contentShape(EarShape(a: base.a, b: base.b, edge: edge))
                    .onTapGesture { onPoke(index) }
            }
        }
        .frame(width: width, height: height)
        // The header cat's name and tooltip (#151 keeps them; the ears are the same small friend).
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(L("종이냥 캐릭터"))
        .accessibilityAddTraits(.isImage)
        .help(L("노트 위의 작은 친구, 종이냥"))
    }
}

/// An ear's twitch: a shear that moves its tip `tip` points sideways and leaves its foot (on `edge`) where it is.
/// (The desktop calendar widgets' ears twitch the same way, #234.)
struct EarFlick: GeometryEffect {
    var tip: CGFloat
    let edge: CGFloat
    var animatableData: CGFloat {
        get { tip }
        set { tip = newValue }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        // x' = x + k · (edge − y): nothing moves on the edge, the tip (CatEars.height above) by `tip`.
        let k = tip / CatEars.height
        return ProjectionTransform(CGAffineTransform(a: 1, b: 0, c: -k, d: 1, tx: k * edge, ty: 0))
    }
}

/// One ear: the paper, its hairline sides, the pink inside. (#234: the widgets' ears too, their paper at `fill` — at
/// least 85 % — while the hairline and the pink stay as they are.)
struct NoteEar: View {
    let a: CGFloat
    let b: CGFloat
    let edge: CGFloat
    let strongEdge: Bool
    var fill: Double = 1
    /// The paper, the pink inside and the hairline (the widgets pass their palette's, #244).
    var colors: (paper: Color, inner: Color, edge: Color) = (NoteEarsColors.paper, NoteEarsColors.inner, NoteEarsColors.edge)

    var body: some View {
        ZStack {
            EarShape(a: a, b: b, edge: edge, below: NoteEarsPlacement.overlap).fill(colors.paper.opacity(fill))
            EarSides(a: a, b: b, edge: edge).stroke(strongEdge ? PaperTheme.ink3 : colors.edge, lineWidth: strongEdge ? 1 : 0.6)
            EarInner(a: a, b: b, edge: edge).fill(colors.inner)
        }
    }
}

private struct EarShape: Shape {
    let a: CGFloat, b: CGFloat, edge: CGFloat
    var below: CGFloat = 0
    func path(in rect: CGRect) -> Path { CatEars.ear(from: a, to: b, edge: edge, below: below) }
}

private struct EarSides: Shape {
    let a: CGFloat, b: CGFloat, edge: CGFloat
    func path(in rect: CGRect) -> Path { CatEars.sides(from: a, to: b, edge: edge) }
}

private struct EarInner: Shape {
    let a: CGFloat, b: CGFloat, edge: CGFloat
    func path(in rect: CGRect) -> Path { CatEars.inner(from: a, to: b, edge: edge) }
}

/// The ears' window: clear, borderless, never key, never activating the app. Its clear parts let the mouse through
/// (the window server passes a press on a fully clear pixel of a non-opaque window on to what is under it, as long as
/// `ignoresMouseEvents` is left unset), so only the ears' own shape takes clicks — no mouse watching needed.
final class NoteEarsPanel: NSPanel {
    init() {
        super.init(contentRect: NSRect(x: 0, y: 0, width: NoteEarsPlacement.width, height: NoteEarsPlacement.height),
                   styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        title = L("종이냥 캐릭터")
        isOpaque = false
        backgroundColor = .clear
        // A shadow would fall on the note under the ears.
        hasShadow = false
        hidesOnDeactivate = false
        isReleasedWhenClosed = false
        isExcludedFromWindowsMenu = true
        animationBehavior = .none
        collectionBehavior = [.ignoresCycle, .fullScreenAuxiliary]
    }

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
    /// Never pulled onto a screen (the off-screen checks keep it 40,000 points away with the note).
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect { frameRect }
}

/// Takes the first click even while another app is in front (the panel never activates this one).
private final class NoteEarsHostingView: NSHostingView<NoteEarsView> {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override var mouseDownCanMoveWindow: Bool { false }
}

/// Keeps the ears on the note: a child window `.above` it, so AppKit moves it with the note, takes it along to other
/// Spaces and hides it with the note; on every move, resize, minimise, full screen, screen change, show or hide (and
/// a change of the note's level, 항상 위에 두기) the frame, the level and whether it shows are worked out again.
@MainActor
final class NoteEarsController {
    let state = NoteEarsState()
    private weak var note: NoteWindow?
    private let panel = NoteEarsPanel()
    private var observers: [NSObjectProtocol] = []
    /// Between `willEnterFullScreen` and `didExitFullScreen` (the style mask says so only once it's in).
    private var fullScreen = false
    private var lastTwitch = Date.distantPast

    init(note: NoteWindow) {
        self.note = note
        let hosting = NoteEarsHostingView(rootView: NoteEarsView(state: state, onPoke: { [weak self] ear in self?.twitch(ear) }))
        hosting.sizingOptions = []
        hosting.frame = NSRect(x: 0, y: 0, width: NoteEarsPlacement.width, height: NoteEarsPlacement.height)
        panel.contentView = hosting
        let center = NotificationCenter.default
        let names: [NSNotification.Name] = [
            NSWindow.didMoveNotification, NSWindow.didResizeNotification, NSWindow.didMiniaturizeNotification,
            NSWindow.didDeminiaturizeNotification, NSWindow.didChangeScreenNotification, NSWindow.didChangeOcclusionStateNotification,
            NSWindow.didEnterFullScreenNotification,
        ]
        // Delivered at once (no queue): a header drag moves the note inside its own event loop.
        for name in names {
            observers.append(center.addObserver(forName: name, object: note, queue: nil) { [weak self] _ in
                MainActor.assumeIsolated { self?.sync() }
            })
        }
        observers.append(center.addObserver(forName: NSWindow.willEnterFullScreenNotification, object: note, queue: nil) { [weak self] _ in
            MainActor.assumeIsolated { self?.fullScreen = true; self?.sync() }
        })
        observers.append(center.addObserver(forName: NSWindow.didExitFullScreenNotification, object: note, queue: nil) { [weak self] _ in
            MainActor.assumeIsolated { self?.fullScreen = false; self?.sync() }
        })
        observers.append(center.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: nil) { [weak self] _ in
            MainActor.assumeIsolated { self?.sync() }
        })
        note.onLevelChange = { [weak self] in self?.sync() }
        sync()
    }

    /// Whether the ears are up (checks).
    var isShowing: Bool { panel.isVisible }
    var frame: NSRect { panel.frame }

    /// Shows, hides or moves the ears to match the note now.
    func sync() {
        guard let note else { return }
        let shows = NoteEarsPlacement.shows(note: note.frame, screen: note.screen?.visibleFrame, visible: note.isVisible,
                                            minimized: note.isMiniaturized, fullScreen: fullScreen || note.styleMask.contains(.fullScreen),
                                            offscreen: note.keepsOffscreen)
        if shows {
            if panel.level != note.level { panel.level = note.level }
            let frame = NoteEarsPlacement.frame(note: note.frame)
            if panel.frame != frame { panel.setFrame(frame, display: false) }
            if panel.parent !== note { note.addChildWindow(panel, ordered: .above) }
            if !panel.isVisible { panel.orderFront(nil) }
        } else if panel.parent != nil || panel.isVisible {
            // Detached as well, so showing the note again doesn't bring the ears back where they have no place.
            panel.parent?.removeChildWindow(panel)
            panel.orderOut(nil)
        }
    }

    /// One twitch of an ear (index 0 the left one): a to-do finished, or a press on it. Not with Reduce Motion, and at
    /// most once a second.
    func twitch(_ ear: Int = 0) {
        guard state.twitches.indices.contains(ear), !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion else { return }
        let now = Date()
        guard now.timeIntervalSince(lastTwitch) >= 1 else { return }
        lastTwitch = now
        state.twitches[ear] += 1
    }
}
