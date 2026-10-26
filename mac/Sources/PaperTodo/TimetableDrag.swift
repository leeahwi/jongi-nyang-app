import AppKit
import Observation
import PaperCore
import SwiftUI

/// 하루 일정표 (1.41): a block being dragged — moved whole, or stretched from its top or bottom edge.
///
/// Kept out of the timetable's own state on purpose. The timetable reads only `id` and `settling` (which change when a
/// drag starts, drops and has settled); `points`, which changes every tick, is read only by the dragged block and its
/// ghost, so a tick redraws those two and nothing else. The pointer is measured in the timetable's viewport (not in the
/// block, which moves under it — the 1.40 jitter), and what the timetable scrolled since the press is added, so the block
/// stays exactly under the pointer. The model is written once, on the drop (DayTimetable.drop).
@MainActor
@Observable
final class TimetableDrag {
    /// The block being dragged or settling after its drop.
    private(set) var id: String?
    private(set) var edge: TimeBlock.Edge = .whole
    private(set) var kind: DayStrip.Kind = .task
    /// Its span (logical minutes) when it was picked up.
    private(set) var start = 0
    private(set) var end = 0
    /// How far it has been dragged, in the grid's points: the pointer's move plus what the timetable scrolled since.
    var points: CGFloat = 0
    /// Dropped, easing into its slot (no ghost, no time label).
    private(set) var settling = false

    @ObservationIgnored private var startHour = 8
    @ObservationIgnored private var endHour = 24
    /// Where the pointer was pressed and is now, in the viewport's points.
    @ObservationIgnored private(set) var startPointer: CGFloat = 0
    @ObservationIgnored private var pointer: CGFloat = 0
    @ObservationIgnored private var startScroll: CGFloat = 0
    /// Esc: the rest of this press is ignored (the block went back).
    @ObservationIgnored var cancelled = false
    @ObservationIgnored let scroller = TimetableScroller()

    init() {
        scroller.onScroll = { [weak self] in self?.update() }
    }

    /// Snapshots: a block already dragged this far (`settling` false).
    init(preview id: String, kind: DayStrip.Kind, edge: TimeBlock.Edge, start: Int, end: Int, points: CGFloat, startHour: Int, endHour: Int) {
        self.id = id; self.kind = kind; self.edge = edge; self.start = start; self.end = end; self.points = points
        self.startHour = startHour; self.endHour = endHour
    }

    var isDragging: Bool { id != nil && !settling }

    func begin(id: String, kind: DayStrip.Kind, edge: TimeBlock.Edge, start: Int, end: Int, startHour: Int, endHour: Int, pointer: CGFloat) {
        self.id = id; self.kind = kind; self.edge = edge; self.start = start; self.end = end
        self.startHour = startHour; self.endHour = endHour
        startPointer = pointer
        self.pointer = pointer
        startScroll = scroller.top
        settling = false
        cancelled = false
        points = 0
    }

    /// The pointer at `y` in the viewport (`height` high): the block follows; near an edge the timetable scrolls.
    func move(to y: CGFloat, viewport height: CGFloat) {
        pointer = y
        update()
        scroller.follow(pointer: y, height: height)
    }

    private func update() {
        guard isDragging else { return }
        let next = pointer - startPointer + scroller.top - startScroll
        if next != points { points = next }
    }

    /// The day's hours (a to-do's end not at 04:00: R6, W3).
    private var bounds: ClosedRange<Int> { DayStrip.stretchBounds(startHour: startHour, endHour: endHour, kind: kind) }

    /// Where the block is drawn now: exactly where the pointer took it (minutes with fractions).
    var following: (start: Double, end: Double) {
        DayStrip.following(start: start, end: end, edge: edge, points: Double(points), bounds: bounds)
    }

    /// Where it lands: a quarter-hour step moved (`dragged`), or the stretched edge on a quarter hour (`resized`).
    var landing: (start: Int, end: Int) {
        edge == .whole
            ? DayStrip.dragged(start: start, end: end, edge: .whole, points: Double(points), bounds: bounds)
            : DayStrip.resized(start: start, end: end, edge: edge, points: Double(points), bounds: bounds)
    }

    /// Dropped (or sent back): `points` set to where `target` is, so the block eases there (in the caller's animation).
    func settle(to target: (start: Int, end: Int)) {
        scroller.stop()
        settling = true
        let minutes = edge == .end ? target.end - end : target.start - start
        points = CGFloat(minutes) / 60 * CGFloat(DayStrip.hourHeight)
    }

    /// Settled: the block is drawn from the model again.
    func finish(_ id: String?) {
        guard self.id == id, settling else { return }
        self.id = nil
        settling = false
        points = 0
    }
}

/// Scrolls the timetable while a dragged block is held near (or past) the top or bottom of its viewport: from 24 pt
/// inside the edge, faster the deeper, in step with the display. SwiftUI's ScrollView on the Mac is an NSScrollView;
/// `TimetableScrollFinder` hands it over.
@MainActor
final class TimetableScroller: NSObject {
    weak var view: NSScrollView? {
        didSet { report() }
    }
    var onScroll: (() -> Void)?
    private var link: CADisplayLink?
    private var speed: CGFloat = 0
    private var last: CFTimeInterval = 0
    static let zone: CGFloat = 24

    /// From the top of the hours, in points.
    var top: CGFloat {
        guard let view, let document = view.documentView else { return 0 }
        let clip = view.contentView.bounds
        return document.isFlipped ? clip.minY : document.frame.height - clip.maxY
    }

    private func scroll(to value: CGFloat) {
        guard let view, let document = view.documentView else { return }
        let clip = view.contentView
        let most = max(0, document.frame.height - clip.bounds.height)
        let top = min(max(0, value), most)
        clip.scroll(to: NSPoint(x: clip.bounds.minX, y: document.isFlipped ? top : most - top))
        view.reflectScrolledClipView(clip)
        report()
    }

    private func report() {
        #if DEBUG
        TimetableProbe.scroll = top
        TimetableProbe.foundScrollView = view != nil
        #endif
    }

    /// Points a second for a pointer `y` into a viewport `height` high: 0 away from the edges.
    static func speed(pointer y: CGFloat, height: CGFloat) -> CGFloat {
        let depth = y < zone ? y - zone : y > height - zone ? y - (height - zone) : 0
        guard depth != 0 else { return 0 }
        return (depth < 0 ? -1 : 1) * min(900, 120 + abs(depth) * 14)
    }

    func follow(pointer y: CGFloat, height: CGFloat) {
        speed = Self.speed(pointer: y, height: height)
        if speed == 0 { stop(); return }
        guard link == nil, let view else { return }
        last = 0
        let link = view.displayLink(target: self, selector: #selector(step(_:)))
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    func stop() {
        link?.invalidate()
        link = nil
        speed = 0
    }

    @objc private func step(_ link: CADisplayLink) {
        let now = link.timestamp
        let elapsed = last == 0 ? 1.0 / 60 : min(0.05, now - last)
        last = now
        let before = top
        scroll(to: before + speed * elapsed)
        if top != before { onScroll?() }
    }
}

/// Inside the timetable's ScrollView: finds its NSScrollView for the scroller.
struct TimetableScrollFinder: NSViewRepresentable {
    let scroller: TimetableScroller

    final class Finder: NSView {
        weak var scroller: TimetableScroller?
        override func viewDidMoveToWindow() {
            super.viewDidMoveToWindow()
            scroller?.view = enclosingScrollView
        }
        override func hitTest(_ point: NSPoint) -> NSView? { nil }
    }

    func makeNSView(context: Context) -> Finder {
        let finder = Finder()
        finder.scroller = scroller
        return finder
    }

    func updateNSView(_ finder: Finder, context: Context) {
        finder.scroller = scroller
        if scroller.view == nil { scroller.view = finder.enclosingScrollView }
    }
}

/// What a block's drag gesture does with its readings (the press and the pointer, in the viewport's points), and on
/// letting go.
struct TimetableDragHandlers {
    let changed: (_ from: CGFloat, _ to: CGFloat) -> Void
    let ended: () -> Void
}

/// The timetable's vertical scale: 50 pt an hour from the first hour, under 8 pt of room for its label.
struct TimetableScale {
    let firstMinute: Int
    func y(_ minutes: Double) -> CGFloat { 8 + CGFloat(minutes - Double(firstMinute)) / 60 * CGFloat(DayStrip.hourHeight) }
}

/// Places one layer of a block (its words, or its fill): where the model has it — or, while it's dragged, where the
/// pointer took it. Only the dragged block's slots read the drag's `points`, so only they redraw as it moves.
struct TimetableSlot<Content: View>: View {
    let drag: TimetableDrag
    let id: String
    let scale: TimetableScale
    let x: CGFloat
    let width: CGFloat
    let start: Int
    let end: Int
    /// A reminder's pill: 20 pt high.
    var pill = false
    /// The words' layer: reports its frame to the debug replay, carries the time label.
    var front = false
    /// Its height, the times to show (where it lands while dragged), and whether it's being dragged.
    @ViewBuilder let content: (_ height: CGFloat, _ shown: (Int, Int), _ lifted: Bool) -> Content

    var body: some View {
        let lifted = drag.id == id
        let active = lifted && !drag.settling
        let live = lifted ? drag.following : (start: Double(start), end: Double(end))
        let shown = lifted ? drag.landing : (start: start, end: end)
        // While it slides, on whole half points (the pixels of a Retina screen), so the words stay sharp.
        func pixel(_ value: CGFloat) -> CGFloat { lifted ? (value * 2).rounded() / 2 : value }
        let top = pixel(scale.y(live.start) + 1)
        let height = pill ? 20 : max(18, pixel(scale.y(live.end) - scale.y(live.start) - 2))
        let below = active && drag.edge == .end
        if front { TimetableProbe.count("block:" + id) }
        return content(height, shown, active)
            .frame(width: width, height: height, alignment: .topLeading)
            .overlay(alignment: below ? .bottomTrailing : .topTrailing) {
                // Stretching the bottom of a tall block: inside its (empty) bottom corner, off the block under it.
                if front && active { TimetableTimeLabel(shown: shown, offset: !below ? -19 : height >= 44 ? -5 : 19) }
            }
            .probeFrame(front ? id : "")
            .modifier(TimetableSlotOffset(x: x, y: top, probe: front ? id : nil))
    }
}

/// A slot's place: an offset whose every frame of an animation (the settle after a drop) the debug replay can see.
struct TimetableSlotOffset: GeometryEffect {
    var x: CGFloat
    var y: CGFloat
    var probe: String?

    var animatableData: AnimatablePair<CGFloat, CGFloat> {
        get { AnimatablePair(x, y) }
        set { x = newValue.first; y = newValue.second }
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        #if DEBUG
        if let probe, TimetableProbe.drawnOn { TimetableProbe.drawn[probe] = y }
        #endif
        return ProjectionTransform(CGAffineTransform(translationX: x, y: y))
    }
}

/// The small label at a dragged block's moving edge: where it will land (`14:15–15:45`), in quarter hours.
struct TimetableTimeLabel: View {
    let shown: (Int, Int)
    /// From the edge it sits at: above the top (−19), under the bottom (19), or just inside the bottom (−5).
    var offset: CGFloat = -19

    var body: some View {
        Text(TimeRange(start: shown.0, end: shown.1).text(.current))
            .font(.system(size: 10, weight: .semibold).monospacedDigit())
            .foregroundStyle(PaperTheme.toastText)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 6)
            .frame(height: 16)
            .background(PaperTheme.toastBack, in: Capsule())
            .shadow(color: .black.opacity(0.18), radius: 3, y: 1)
            .padding(.trailing, 4)
            // Off the block's own words: above its top, or at its bottom.
            .offset(y: offset)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

/// Where the dragged block will land: a faint dashed outline in its column, a quarter hour at a time.
struct TimetableGhost: View {
    let drag: TimetableDrag
    let scale: TimetableScale
    let x: CGFloat
    let width: CGFloat
    let color: Color

    var body: some View {
        TimetableProbe.count("ghost")
        let landing = drag.landing
        let shape = RoundedRectangle(cornerRadius: 7, style: .continuous)
        return shape.fill(color.opacity(0.1))
            .overlay { shape.strokeBorder(color.opacity(0.85), style: StrokeStyle(lineWidth: 1.5, dash: [4, 3])) }
            .frame(width: width, height: max(18, scale.y(Double(landing.end)) - scale.y(Double(landing.start)) - 2))
            .offset(x: x, y: scale.y(Double(landing.start)) + 1)
            .accessibilityHidden(true)
    }
}

/// A block's top and bottom bands (ribbon-cases.md R1): on one, the ↕ cursor and a grab bar on that edge's outline, and
/// a drag there stretches the block from it; elsewhere on the block the open hand (a drag moves it). `leading` keeps the
/// bands off a to-do's box. While the block is dragged the bars give way to its time label.
struct TimetableBands<Stretch: Gesture>: ViewModifier {
    let item: DayStrip.Item
    let height: CGFloat
    let leading: CGFloat
    let color: Color
    /// Around the bar, so it reads on the outline: the block's own paper.
    let halo: Color
    let enabled: Bool
    /// Being dragged: by which edge.
    let lifted: TimeBlock.Edge?
    /// Snapshots: the pointer on this band.
    let preview: TimeBlock.Edge?
    let stretch: (TimeBlock.Edge) -> Stretch
    @State private var hovered: TimeBlock.Edge?

    private var band: CGFloat { CGFloat(DayStrip.stretchBand(height: Double(height))) }

    func body(content: Content) -> some View {
        content
            .overlay(alignment: .top) { if enabled && band > 0 { edge(.start) } }
            .overlay(alignment: .bottom) { if enabled && band > 0 { edge(.end) } }
            .onContinuousHover(coordinateSpace: .local) { phase in
                guard enabled else { return }
                switch phase {
                case .active(let point):
                    let zone: TimeBlock.Edge = point.x < leading || band == 0 ? .whole : point.y < band ? .start : point.y > height - band ? .end : .whole
                    if hovered != zone { hovered = zone }
                    (zone == .whole ? NSCursor.openHand : NSCursor.resizeUpDown).set()
                case .ended:
                    hovered = nil
                    NSCursor.arrow.set()
                }
            }
    }

    private func edge(_ edge: TimeBlock.Edge) -> some View {
        let shown = (hovered == edge && lifted == nil) || preview == edge
        return ZStack(alignment: edge == .start ? .top : .bottom) {
            Color.clear
            // On the outline (its paper rim just outside the block, short of the block next to it).
            Capsule().fill(color)
                .frame(width: 22, height: 4)
                .padding(1.5)
                .background(halo, in: Capsule())
                .offset(y: edge == .start ? -1.5 : 1.5)
                .opacity(shown ? 1 : 0)
                .allowsHitTesting(false)
        }
        .frame(maxWidth: .infinity)
        .frame(height: band)
        .contentShape(LeadingInset(inset: leading))
        .highPriorityGesture(stretch(edge))
        .help(edge == .start ? L("끌어서 시작 시간 바꾸기") : L("끌어서 끝 시간 바꾸기"))
    }
}

/// A rectangle without its leading `inset` (the bands' hit area beside a to-do's box).
struct LeadingInset: Shape {
    let inset: CGFloat
    func path(in rect: CGRect) -> Path { Path(CGRect(x: rect.minX + inset, y: rect.minY, width: max(0, rect.width - inset), height: rect.height)) }
}

/// Snapshots: a block of the timetable dragged (`points` down, by `edge`) or, with `hover`, the pointer on its band.
struct TimetablePreview {
    var id: String
    var edge: TimeBlock.Edge = .whole
    var points: CGFloat = 0
    var hover = false

    @MainActor
    func drag(spans: [DayStrip.Span], startHour: Int, endHour: Int) -> TimetableDrag {
        guard !hover, let span = spans.first(where: { $0.id == id }) else { return TimetableDrag() }
        return TimetableDrag(preview: id, kind: span.kind, edge: edge, start: span.start, end: span.end, points: points, startHour: startHour, endHour: endHour)
    }
}
