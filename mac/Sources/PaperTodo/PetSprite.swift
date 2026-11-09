import AppKit
import PaperCore
import SwiftUI

/// The desktop cat itself (#64): its picture and its shadow, drawn by Core Animation across the whole floor strip.
///
/// A clip (a walk, a tilt, a hop …) is handed to the window server once, when it starts: `PetMotion.frame` is sampled
/// as often as the clip moves (`PetMotion.frameInterval`) and the samples become keyframe animations of the cat's
/// transform, its picture and its shadow. The window server plays them, so the app does no work between the start and
/// the end of a clip. Until 1.48 a `TimelineView` laid the whole cat out again 30–60 times a second while it moved,
/// which was most of what the app did at rest.
struct PetSprite: NSViewRepresentable {
    let activity: PetActivity
    let homeX: CGFloat
    let size: CGFloat
    let reduceMotion: Bool

    func makeNSView(context: Context) -> PetSpriteView { PetSpriteView() }

    func updateNSView(_ view: PetSpriteView, context: Context) {
        view.show(PetSpriteView.Scene(activity: activity, homeX: homeX, size: size, reduceMotion: reduceMotion))
    }
}

final class PetSpriteView: NSView {
    struct Scene: Equatable {
        var activity: PetActivity
        var homeX: CGFloat
        var size: CGFloat
        var reduceMotion: Bool
    }

    /// How far the cat's paws sit above the strip's bottom edge (as the SwiftUI layout had it).
    static let floor: CGFloat = 2
    private let floorShadow = CAShapeLayer()
    /// The pose: flip, squash, tilt, lift and the place along the floor, as one transform.
    private let body = CALayer()
    /// The picture, breathing while the cat rests (anchored at its paws, as `BreathingLayerView`).
    private let picture = CALayer()
    private var scene: Scene?
    private var breathing: BreathingImage.Style?
    private var pictures: [ObjectIdentifier: CGImage] = [:]

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        floorShadow.fillColor = CGColor(srgbRed: 0, green: 0, blue: 0, alpha: 0.10)
        body.anchorPoint = .zero
        body.position = .zero
        picture.contentsGravity = .resizeAspect
        picture.anchorPoint = CGPoint(x: 0.5, y: 0.07)
        layer?.addSublayer(floorShadow)
        layer?.addSublayer(body)
        body.addSublayer(picture)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override var isFlipped: Bool { false }
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        rescale()
    }

    override func viewDidChangeBackingProperties() {
        super.viewDidChangeBackingProperties()
        rescale()
    }

    private func rescale() {
        let scale = window?.backingScaleFactor ?? 2
        picture.contentsScale = scale
        floorShadow.contentsScale = scale
    }

    func show(_ next: Scene) {
        guard next != scene else { return }
        let resized = next.size != scene?.size
        scene = next
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        if resized { lay(next.size) }
        apply(next)
        CATransaction.commit()
    }

    private func lay(_ size: CGFloat) {
        body.bounds = CGRect(x: 0, y: 0, width: size, height: size)
        picture.bounds = body.bounds
        picture.position = CGPoint(x: size / 2, y: size * 0.07)
    }

    private func apply(_ scene: Scene) {
        body.removeAnimation(forKey: "clip")
        floorShadow.removeAnimation(forKey: "clip")
        floorShadow.removeAnimation(forKey: "clip.opacity")
        picture.removeAnimation(forKey: "clip")
        let size = scene.size, activity = scene.activity
        let now = Date()
        let frame = PetMotion.frame(activity, homeX: scene.homeX, at: scene.reduceMotion ? activity.start : now, size: size)
        place(frame, image: Self.image(frame), size: size)
        breathe(frame.walkFrame != nil || !activity.action.isResting ? .still : frame.sleepy ? .asleep : .awake)
        let elapsed = max(0, now.timeIntervalSince(activity.start))
        guard !scene.reduceMotion, let every = PetMotion.frameInterval(of: activity.action), elapsed < activity.duration else { return }
        PerfProbe.count("petClip." + activity.action.name)
        let count = max(2, Int((activity.duration / every).rounded(.up)) + 1)
        let frames = (0..<count).map { index in
            PetMotion.frame(activity, homeX: scene.homeX, at: activity.start.addingTimeInterval(activity.duration * Double(index) / Double(count - 1)), size: size)
        }
        let times = (0..<count).map { NSNumber(value: Double($0) / Double(count - 1)) }
        // In the layers' own time: begun `elapsed` ago, and held at its last frame until the next scene replaces it.
        let begin = body.convertTime(CACurrentMediaTime(), from: nil) - elapsed
        func clip(_ path: String, _ values: [Any], times: [NSNumber], discrete: Bool = false) -> CAKeyframeAnimation {
            let animation = CAKeyframeAnimation(keyPath: path)
            animation.values = values
            animation.keyTimes = times
            animation.calculationMode = discrete ? .discrete : .linear
            animation.duration = activity.duration
            animation.beginTime = begin
            animation.fillMode = .forwards
            animation.isRemovedOnCompletion = false
            return animation
        }
        body.add(clip("transform", frames.map { NSValue(caTransform3D: Self.transform($0, size: size)) }, times: times), forKey: "clip")
        if frames.contains(where: { $0.pose.lift != 0 }) || frames.first?.x != frames.last?.x {
            floorShadow.add(clip("transform", frames.map { NSValue(caTransform3D: shadowTransform($0, size: size)) }, times: times), forKey: "clip")
            floorShadow.add(clip("opacity", frames.map { NSNumber(value: Self.shadowOpacity($0)) }, times: times), forKey: "clip.opacity")
        }
        // The pictures: only where one changes (a walk's steps, closed eyes, a stretch), each held until the next.
        var images: [CGImage] = [], keys: [NSNumber] = []
        var last: NSImage?
        for (index, frame) in frames.enumerated() {
            let image = Self.image(frame)
            guard image !== last, let drawn = cgImage(image) else { continue }
            last = image
            images.append(drawn)
            keys.append(times[index])
        }
        if images.count > 1 {
            keys.append(1)
            picture.add(clip("contents", images, times: keys, discrete: true), forKey: "clip")
        }
    }

    /// The layers as they are at one moment, with no animation (at rest, the cushion, a clip's present moment).
    private func place(_ frame: PetFrame, image: NSImage, size: CGFloat) {
        body.transform = Self.transform(frame, size: size)
        // The shadow's edges on the screen's pixels where the cat sits, as SwiftUI laid the ellipse out until 1.48.
        let scale = window?.backingScaleFactor ?? 2
        func pixel(_ value: CGFloat) -> CGFloat { (value * scale).rounded() / scale }
        let width = size * 0.58, left = pixel(frame.x - width / 2), right = pixel(frame.x + width / 2)
        let bounds = CGRect(x: 0, y: 0, width: right - left, height: pixel(size * 0.07))
        if floorShadow.bounds != bounds {
            floorShadow.bounds = bounds
            floorShadow.path = CGPath(ellipseIn: bounds, transform: nil)
        }
        shadowShift = (left + right) / 2 - frame.x
        floorShadow.transform = shadowTransform(frame, size: size)
        floorShadow.opacity = Self.shadowOpacity(frame)
        if (picture.contents as AnyObject?) !== image { picture.contents = image }
    }

    private func breathe(_ style: BreathingImage.Style) {
        let effective: BreathingImage.Style = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion ? .still : style
        guard effective != breathing else { return }
        breathing = effective
        BreathingLayerView.breathe(picture, style: effective)
    }

    /// A picture as a bitmap for the keyframes (the 384-pixel art as it is; the drawn closed eyes at twice its size).
    private func cgImage(_ image: NSImage) -> CGImage? {
        if let known = pictures[ObjectIdentifier(image)] { return known }
        var rect = CGRect(origin: .zero, size: image.size)
        let drawn = image.cgImage(forProposedRect: &rect, context: nil, hints: [.ctm: AffineTransform(scale: 2)])
        pictures[ObjectIdentifier(image)] = drawn
        return drawn
    }

    @MainActor
    static func image(_ frame: PetFrame) -> NSImage {
        frame.walkFrame.flatMap { PetArt.walkCycle?[$0] }
            ?? (frame.eyesClosed ? PetArt.closedEyes : PetArt.image(frame.image) ?? PaperTheme.mascot)
    }

    /// The cat's square placed on the strip (y up): the flip, squash and tilt as the SwiftUI cat had them (worked out in
    /// the square with y down, about the same anchors), then lifted and moved along the floor.
    static func transform(_ frame: PetFrame, size s: CGFloat) -> CATransform3D {
        func about(_ x: CGFloat, _ y: CGFloat, _ change: CGAffineTransform) -> CGAffineTransform {
            CGAffineTransform(translationX: -x, y: -y).concatenating(change).concatenating(CGAffineTransform(translationX: x, y: y))
        }
        var down = CGAffineTransform.identity
        if frame.facingRight && frame.walkFrame != nil { down = down.concatenating(about(s / 2, s / 2, CGAffineTransform(scaleX: -1, y: 1))) }
        down = down.concatenating(about(s * 0.5, s * 0.93, CGAffineTransform(scaleX: frame.pose.scaleX, y: frame.pose.scaleY)))
        down = down.concatenating(about(s * frame.pose.pivot.x, s * frame.pose.pivot.y,
                                        CGAffineTransform(rotationAngle: CGFloat(frame.pose.rotation * .pi / 180))))
        let flip = CGAffineTransform(a: 1, b: 0, c: 0, d: -1, tx: 0, ty: s)
        let placed = flip.concatenating(down).concatenating(flip)
            // #304: a bigger cat hops as much higher (×1 at 보통).
            .concatenating(CGAffineTransform(translationX: frame.x - s / 2, y: floor + frame.pose.lift * (s / CatSize.petBase)))
        return CATransform3DMakeAffineTransform(placed)
    }

    /// How far the shadow's middle sits from the cat's once its edges are on pixels.
    private var shadowShift: CGFloat = 0

    /// The shadow under the cat (3 % of its size above the floor): narrower while it is in the air.
    private func shadowTransform(_ frame: PetFrame, size s: CGFloat) -> CATransform3D {
        CATransform3DConcat(CATransform3DMakeScale(1 - 0.02 * frame.pose.lift, 1, 1),
                            CATransform3DMakeTranslation(frame.x + shadowShift, Self.floor + s * 0.03 + floorShadow.bounds.height / 2, 0))
    }

    /// The shadow's 10 % black, fainter while the cat is in the air.
    static func shadowOpacity(_ frame: PetFrame) -> Float { Float(max(0, 1 - 0.06 * frame.pose.lift)) }
}
