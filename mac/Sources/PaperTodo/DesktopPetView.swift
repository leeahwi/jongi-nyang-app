import PaperCore
import SwiftUI

/// The timer board's colours: the focus card's — clay for focus, sage for rest (marks), and their
/// text tokens for words, so a session looks the same on the card and on the board.
enum FocusColor {
    static let focus = PaperTheme.clay
    static let rest = PaperTheme.sage
    static let focusText = PaperTheme.clayText
    static let restText = PaperTheme.sageText
}

@MainActor
final class PetState: ObservableObject {
    @Published var activity = PetActivity(.sit)
    /// Where the pet rests along the floor (centre x, in the strip's coordinates).
    @Published var homeX: CGFloat = 200
    @Published var message: String?
    /// 종이냥 한마디 asking something: a bubble with answer buttons.
    @Published var question: PetChatter.Line?
    /// How wide the bubble above the cat is (for keeping it on screen and for its clickable area).
    var bubbleWidth: CGFloat = 0
    @Published var hovering = false
    let size: CGFloat = 92
}

/// The pet and its effects, drawn inside the transparent floor strip.
struct DesktopPetView: View {
    @ObservedObject var state: PetState
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var onTap: () -> Void = {}
    var onDoubleTap: () -> Void = {}
    var onDrag: (CGFloat) -> Void = { _ in }
    var onDragEnd: () -> Void = {}
    var onAnswer: (Int) -> Void = { _ in }
    @State private var bubbleWidth: CGFloat = 0

    var body: some View {
        GeometryReader { geometry in
            // Only moving clips need frames; resting poses draw once.
            TimelineView(.animation(minimumInterval: 1.0 / 60, paused: state.activity.action.isResting || reduceMotion)) { context in
                let _ = PerfProbe.count("petFrame")
                let frame = PetMotion.frame(state.activity, homeX: state.homeX, at: reduceMotion ? state.activity.start : context.date)
                pet(frame: frame, shift: PetBubble.shift(centerX: frame.x, width: bubbleWidth, stripWidth: geometry.size.width))
                    .position(x: frame.x, y: geometry.size.height - petHeight / 2 - 2)
            }
        }
    }

    /// Taller while a question with answer buttons is up (still inside the 250-point strip).
    private var petHeight: CGFloat { state.size + (state.question == nil ? 70 : 150) }

    /// `shift` moves the bubble sideways so it stays on screen when the cat sits near an edge.
    private func pet(frame: PetFrame, shift: CGFloat) -> some View {
        let size = state.size
        return VStack(spacing: 4) {
            Spacer(minLength: 0)
            Group {
                if let question = state.question {
                    QuestionBubble(line: question, pointer: PetBubble.pointer(shift: shift, width: bubbleWidth), onAnswer: onAnswer)
                } else if let message = state.message {
                    SpeechBubble(text: message, pointer: PetBubble.pointer(shift: shift, width: bubbleWidth))
                        .accessibilityHidden(true)
                }
            }
            .fixedSize()
            .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width in
                bubbleWidth = width
                state.bubbleWidth = width
            }
            .offset(x: shift)
            .transition(.scale(scale: 0.6, anchor: .bottom).combined(with: .opacity))
            ZStack(alignment: .bottom) {
                Ellipse()
                    .fill(.black.opacity(0.10 - 0.006 * Double(frame.pose.lift)))
                    .frame(width: size * 0.58 * (1 - 0.02 * frame.pose.lift), height: size * 0.07)
                    .offset(y: -size * 0.03)
                cat(frame: frame, size: size)
                    .offset(y: -frame.pose.lift)
                effects(frame: frame, size: size)
            }
            .frame(width: size + 40, height: size + 8, alignment: .bottom)
            // Only the cat takes taps and drags; the bubble's buttons are its own.
            .contentShape(Rectangle().inset(by: 10).offset(y: 6))
            .onTapGesture(count: 2, perform: onDoubleTap)
            .onTapGesture(perform: onTap)
            .gesture(DragGesture(minimumDistance: 4, coordinateSpace: .global)
                .onChanged { onDrag($0.translation.width) }
                .onEnded { _ in onDragEnd() })
            .onHover { state.hovering = $0 }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("종이냥")
            .accessibilityValue(state.message ?? "")
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { onTap() }
        }
        .frame(width: size + 120, height: petHeight)
    }

    @ViewBuilder
    private func cat(frame: PetFrame, size: CGFloat) -> some View {
        let image: NSImage = frame.walkFrame.flatMap { PetArt.walkCycle?[$0] }
            ?? (frame.eyesClosed ? PetArt.closedEyes : PetArt.image(frame.image) ?? PaperTheme.mascot)
        let breathing: BreathingImage.Style = frame.walkFrame != nil || !state.activity.action.isResting ? .still
            : frame.sleepy ? .asleep : .awake
        BreathingImage(image: image, style: breathing)
        .frame(width: size, height: size)
        .scaleEffect(x: frame.facingRight && frame.walkFrame != nil ? -1 : 1, y: 1)
        .scaleEffect(x: frame.pose.scaleX, y: frame.pose.scaleY, anchor: UnitPoint(x: 0.5, y: 0.93))
        .rotationEffect(.degrees(frame.pose.rotation), anchor: frame.pose.pivot)
    }

    @ViewBuilder
    private func effects(frame: PetFrame, size: CGFloat) -> some View {
        if let hearts = frame.hearts {
            ForEach(0..<3, id: \.self) { index in
                let delay = Double(index) * 0.18
                let u = max(0, min(1, (hearts - delay) / 0.7))
                Image(systemName: "heart.fill")
                    .font(.system(size: 11 + CGFloat(index) * 2))
                    .foregroundStyle(Color(red: 0.93, green: 0.55, blue: 0.55))
                    .opacity(u > 0 ? 1 - u : 0)
                    .offset(x: CGFloat(index - 1) * size * 0.22, y: -size * 0.75 - CGFloat(u) * 28)
            }
        }
        if let sparkles = frame.sparkles {
            ForEach(0..<4, id: \.self) { index in
                let angle = Double(index) * .pi / 2 + .pi / 4
                let u = sparkles
                Image(systemName: "sparkle")
                    .font(.system(size: 10))
                    .foregroundStyle(Color(red: 0.86, green: 0.68, blue: 0.25))
                    .opacity(sin(.pi * u))
                    .offset(x: cos(angle) * size * (0.35 + 0.25 * u), y: -size * 0.5 + sin(angle) * size * (0.35 + 0.25 * u))
            }
        }
        if frame.sleepy {
            SleepyZs().offset(x: size * 0.36, y: -size * 0.72)
        }
    }
}

/// Three slowly rising Z's. Sleep can last all night, so the motion is a Core Animation layer
/// animation (like `BreathingImage`): the window server runs it and the app does no work.
private struct SleepyZs: NSViewRepresentable {
    func makeNSView(context: Context) -> SleepyZsView { SleepyZsView() }
    func updateNSView(_ view: SleepyZsView, context: Context) {}
    func sizeThatFits(_ proposal: ProposedViewSize, nsView: SleepyZsView, context: Context) -> CGSize? {
        CGSize(width: 44, height: 56)
    }
}

final class SleepyZsView: NSView {
    private let period: CFTimeInterval = 3

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        guard let layer, window != nil, layer.sublayers?.isEmpty ?? true else { return }
        let scale = window?.backingScaleFactor ?? 2
        let color = NSColor(PaperTheme.secondary).cgColor
        let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let start = CGPoint(x: 22, y: 28)
        for index in 0..<3 {
            let size = 9 + CGFloat(index) * 2
            let text = CATextLayer()
            let base = NSFont.systemFont(ofSize: size, weight: .semibold)
            text.font = NSFont(descriptor: base.fontDescriptor.withDesign(.rounded) ?? base.fontDescriptor, size: size)
            text.fontSize = size
            text.string = "z"
            text.foregroundColor = color
            text.contentsScale = scale
            text.alignmentMode = .center
            text.bounds = CGRect(x: 0, y: 0, width: size, height: size * 1.3)
            text.position = start
            layer.addSublayer(text)
            if reduced {
                text.position = CGPoint(x: start.x + 4 + CGFloat(index) * 3, y: start.y + 6 + CGFloat(index) * 7)
                continue
            }
            // Rise up and to the right, fading in and out; the three are a third of a period apart.
            let rise = CABasicAnimation(keyPath: "position")
            rise.fromValue = NSValue(point: start)
            rise.toValue = NSValue(point: CGPoint(x: start.x + 10, y: start.y + 22))
            let fade = CAKeyframeAnimation(keyPath: "opacity")
            fade.values = [0, 1, 0]
            fade.keyTimes = [0, 0.5, 1]
            let group = CAAnimationGroup()
            group.animations = [rise, fade]
            group.duration = period
            group.repeatCount = .infinity
            group.timeOffset = period * (1 - Double(index) / 3)
            text.opacity = 0
            text.add(group, forKey: "rise")
        }
    }
}

/// The focus timer's paper tag, held up by the cat: a Time Timer–style disc that shrinks as
/// time passes, the time left in big rounded digits, the phase as a coloured pill with dots
/// for the pomodoro rounds, and round pause / stop buttons always in reach.
struct TimerBoard: View {
    let timer: FocusTimer
    /// 집중: the to-do's title under the time (and 집중 on the pill).
    var focusTitle: String?
    var onPause: () -> Void = {}
    var onStop: () -> Void = {}
    /// Tests and snapshots: a fixed now.
    var now: Date?
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let now = self.now ?? context.date
            let resting = timer.phase == .rest || timer.phase == .longRest
            let color = timer.isPaused ? PaperTheme.secondary : resting ? FocusColor.restText : FocusColor.focusText
            HStack(spacing: 10) {
                ShrinkingDisc(fraction: timer.fraction(at: now), color: resting ? FocusColor.rest : FocusColor.focus)
                    .frame(width: 40, height: 40)
                    .opacity(timer.isPaused ? 0.75 : 1)
                VStack(alignment: .leading, spacing: 3) {
                    // 1.40: as wide as the widest time of its form ("88:88", "8:88:88"), so the tag never changes width
                    // as the seconds tick (only when it passes an hour).
                    TabularClock(text: FocusTimer.clock(timer.remaining(at: now)),
                                 font: .system(size: 19, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(PaperTheme.ink)
                    HStack(spacing: 5) {
                        // A state here ("Paused"), where menus say the action ("Pause").
                        Text(timer.isPaused ? String(localized: "일시정지", table: "Timer")
                             : focusTitle != nil && timer.phase == .timer ? Focus.topLine(language: .current) : timer.phaseName(.current))
                            .font(.system(size: 9.5, weight: .bold))
                            .foregroundStyle(color)
                            .padding(.horizontal, 6)
                            .frame(height: 15)
                            .background(color.opacity(0.13), in: Capsule())
                        if let pomodoro = timer.pomodoro {
                            RoundDots(done: timer.completedRounds % max(1, pomodoro.roundsBeforeLongRest),
                                      total: max(1, pomodoro.roundsBeforeLongRest),
                                      focusing: timer.phase == .focus, color: FocusColor.focus)
                        }
                    }
                    if let focusTitle {
                        Text(focusTitle.handwritten)
                            .font(HandwritingFont.swiftUI(face: .pen, size: 15))
                            .foregroundStyle(PaperTheme.ink)
                            .lineLimit(1)
                            .frame(maxWidth: 112, alignment: .leading)
                    }
                }
                .fixedSize()
                VStack(spacing: 4) {
                    BoardButton(symbol: timer.isPaused ? "play.fill" : "pause.fill",
                                help: timer.isPaused ? L("계속") : L("일시정지"), action: onPause)
                    BoardButton(symbol: "stop.fill", help: L("타이머 종료"), action: onStop)
                }
            }
            .padding(.leading, 10)
            .padding(.trailing, 8)
            .padding(.top, 11)
            .padding(.bottom, 9)
            .background {
                PaperTheme.card
                    .overlay { if scheme != .dark { Image(nsImage: PaperTheme.texture).resizable().scaledToFill().opacity(0.18) } }
                    .clipShape(RoundedRectangle(cornerRadius: 6))
                    .overlay { RoundedRectangle(cornerRadius: 6).strokeBorder(PaperTheme.rule, lineWidth: scheme == .dark ? 0.8 : 0) }
                .shadow(color: .black.opacity(0.14), radius: 5, y: 3)
                .shadow(color: .black.opacity(0.06), radius: 1, y: 0.5)
            }
            .overlay(alignment: .top) {
                // The cat's paws rest on the top edge.
                HStack(spacing: 22) {
                    PaperPaw().frame(width: 14, height: 13)
                    PaperPaw().frame(width: 14, height: 13)
                }
                .offset(y: -6)
            }
            .rotationEffect(.degrees(-3))
        }
    }

}

/// A running time in tabular digits that takes the width of the widest text of its form — every digit drawn as an
/// 8 — so nothing beside it moves while it counts ("09:59" and "10:00" are as wide; "1:00:00" is its own form).
struct TabularClock: View {
    let text: String
    let font: Font
    var alignment: Alignment = .leading

    /// "12:30" → "88:88", "1:02:05" → "8:88:88".
    static func template(_ text: String) -> String {
        String(text.map { $0.isNumber ? "8" : $0 })
    }

    var body: some View {
        Text(Self.template(text))
            .font(font)
            .lineLimit(1)
            .hidden()
            .overlay(alignment: alignment) {
                Text(text).font(font).lineLimit(1).fixedSize()
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(text)
    }
}

/// Pomodoro rounds: filled for the ones done, a ring for the one in progress.
private struct RoundDots: View {
    let done: Int
    let total: Int
    let focusing: Bool
    let color: Color

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<total, id: \.self) { index in
                Circle()
                    .fill(index < done ? color : Color.clear)
                    .overlay { Circle().stroke(index < done || (focusing && index == done) ? color : PaperTheme.rule, lineWidth: 1) }
                    .frame(width: 5, height: 5)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(total)번 중 \(done)번 했어요")
    }
}

/// Round pause / stop buttons on the tag.
private struct BoardButton: View {
    let symbol: String
    let help: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 8, weight: .bold))
                .foregroundStyle(hovering ? PaperTheme.onSage : PaperTheme.secondary)
                .frame(width: 20, height: 20)
                .background(hovering ? PaperTheme.sage : PaperTheme.sage.opacity(0.12), in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

/// The remaining time as a coloured wedge that starts at 12 o'clock and shrinks toward it,
/// on a white face with minute ticks, like a Time Timer.
struct ShrinkingDisc: View {
    let fraction: Double
    let color: Color

    var body: some View {
        Canvas { context, size in
            let rect = CGRect(origin: .zero, size: size).insetBy(dx: 1.5, dy: 1.5)
            let center = CGPoint(x: rect.midX, y: rect.midY)
            context.fill(Circle().path(in: rect), with: .color(PaperTheme.card))
            let face = rect.insetBy(dx: 3, dy: 3)
            if fraction > 0 {
                var wedge = Path()
                wedge.move(to: center)
                wedge.addArc(center: center, radius: face.width / 2, startAngle: .degrees(-90),
                             endAngle: .degrees(-90 - 360 * min(1, fraction)), clockwise: true)
                wedge.closeSubpath()
                context.fill(wedge, with: .color(color))
            }
            for tick in 0..<12 {
                let angle = Double(tick) / 12 * 2 * .pi
                let inner = tick % 3 == 0 ? 0.36 : 0.42
                var mark = Path()
                mark.move(to: CGPoint(x: center.x + cos(angle) * rect.width * inner, y: center.y + sin(angle) * rect.width * inner))
                mark.addLine(to: CGPoint(x: center.x + cos(angle) * rect.width * 0.47, y: center.y + sin(angle) * rect.width * 0.47))
                context.stroke(mark, with: .color(PaperTheme.ink.opacity(tick % 3 == 0 ? 0.45 : 0.25)), lineWidth: tick % 3 == 0 ? 1 : 0.7)
            }
            context.stroke(Circle().path(in: rect), with: .color(PaperTheme.ink.opacity(0.3)), lineWidth: 1)
            context.fill(Circle().path(in: CGRect(x: center.x - 2.5, y: center.y - 2.5, width: 5, height: 5)), with: .color(PaperTheme.card))
            context.stroke(Circle().path(in: CGRect(x: center.x - 2.5, y: center.y - 2.5, width: 5, height: 5)), with: .color(PaperTheme.ink.opacity(0.6)), lineWidth: 1.2)
        }
        .accessibilityHidden(true)
    }
}

/// Keeps the cat's bubble on screen: near an edge it slides inward, and its little pointer
/// slides back the other way so it still points at the cat.
enum PetBubble {
    static let margin: CGFloat = 6

    static func shift(centerX: CGFloat, width: CGFloat, stripWidth: CGFloat) -> CGFloat {
        guard width > 0, stripWidth > width + 2 * margin else { return 0 }
        let half = width / 2
        if centerX - half < margin { return margin - (centerX - half) }
        if centerX + half > stripWidth - margin { return stripWidth - margin - (centerX + half) }
        return 0
    }

    /// The pointer's offset from the bubble's middle, kept clear of the rounded corners.
    static func pointer(shift: CGFloat, width: CGFloat) -> CGFloat {
        let limit = max(0, width / 2 - 18)
        return min(max(-shift, -limit), limit)
    }
}

/// A question from the cat with two or three answer buttons, on the same paper as SpeechBubble.
struct QuestionBubble: View {
    let line: PetChatter.Line
    var pointer: CGFloat = 0
    var onAnswer: (Int) -> Void

    var body: some View {
        VStack(spacing: 8) {
            Text(BubbleText.wrap(line.text, language: .current))
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(PaperTheme.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 5) {
                ForEach(Array(line.answers.enumerated()), id: \.offset) { index, answer in
                    Button { onAnswer(index) } label: {
                        Text(answer.label)
                            .font(.system(size: 11.5, weight: .medium))
                            .lineLimit(1)
                            .padding(.horizontal, 9)
                            .frame(height: 24)
                            .background(index == 0 ? PaperTheme.sage2 : PaperTheme.paper2, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay { if index == 0 { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(PaperTheme.sage, lineWidth: 1.5) } }
                            .foregroundStyle(index == 0 ? PaperTheme.sageText : PaperTheme.ink2)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(answer.label)
                }
            }
        }
        .frame(maxWidth: 220)
        .padding(.horizontal, 10)
        .padding(.top, 9)
        .padding(.bottom, 9)
        .background(PaperTheme.paper, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(PaperTheme.rule, lineWidth: 1) }
        .overlay(alignment: .bottom) {
            BubblePointer().fill(PaperTheme.paper).overlay { BubblePointer(open: true).stroke(PaperTheme.rule, lineWidth: 1) }
                .frame(width: 12, height: 7).offset(x: pointer, y: 6)
        }
        .shadow(color: .black.opacity(0.10), radius: 5, y: 2)
        .padding(.bottom, 4)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("종이냥의 질문: \(line.text)")
    }
}

struct SpeechBubble: View {
    let text: String
    var pointer: CGFloat = 0

    var body: some View {
        Text(BubbleText.wrap(text, language: .current))
            .font(.system(size: 13, weight: .medium))
            .foregroundStyle(PaperTheme.ink)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 220)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(PaperTheme.paper, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(PaperTheme.rule, lineWidth: 1) }
            .overlay(alignment: .bottom) {
                BubblePointer().fill(PaperTheme.paper).overlay { BubblePointer(open: true).stroke(PaperTheme.rule, lineWidth: 1) }
                    .frame(width: 12, height: 7).offset(x: pointer, y: 6)
            }
            .shadow(color: .black.opacity(0.10), radius: 4, y: 2)
            .padding(.bottom, 4)
    }
}

/// The bubble's pointer; `open` leaves out its top edge (for the outline, so it joins the bubble).
private struct BubblePointer: Shape {
    var open = false

    func path(in rect: CGRect) -> Path {
        var path = Path()
        if open {
            path.move(to: CGPoint(x: rect.minX, y: rect.minY))
            path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
            return path
        }
        path.move(to: CGPoint(x: rect.minX, y: rect.minY - 1))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.minY - 1))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.closeSubpath()
        return path
    }
}
