import AppKit
import SwiftUI

/// An image that gently breathes and sways forever. The motion is a Core Animation layer
/// animation, so it runs in the window server: the app itself does no per-frame work, and an
/// idle pet stays at ~0% CPU while still looking alive.
struct BreathingImage: NSViewRepresentable {
    let image: NSImage
    /// 0 = still (walking frames, reduced motion), 1 = awake, 2 = asleep (slower, deeper)
    var style: Style = .awake

    enum Style: Equatable { case still, awake, asleep }

    func makeNSView(context: Context) -> BreathingLayerView {
        let view = BreathingLayerView()
        view.update(image: image, style: style)
        return view
    }

    func updateNSView(_ view: BreathingLayerView, context: Context) {
        view.update(image: image, style: style)
    }
}

final class BreathingLayerView: NSView {
    private let imageLayer = CALayer()
    private var currentStyle: BreathingImage.Style?
    private weak var currentImage: NSImage?

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.addSublayer(imageLayer)
        imageLayer.contentsGravity = .resizeAspect
        // Breathe from the paws, which sit about 7% above the bottom of the art.
        imageLayer.anchorPoint = CGPoint(x: 0.5, y: 0.07)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { nil }

    override var isFlipped: Bool { false }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        imageLayer.bounds = bounds
        imageLayer.position = CGPoint(x: bounds.midX, y: bounds.minY + bounds.height * 0.07)
        imageLayer.contentsScale = window?.backingScaleFactor ?? 2
        CATransaction.commit()
    }

    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    func update(image: NSImage, style: BreathingImage.Style) {
        if image !== currentImage {
            currentImage = image
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            imageLayer.contents = image
            CATransaction.commit()
        }
        let reduced = NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        let effective: BreathingImage.Style = reduced ? .still : style
        guard effective != currentStyle else { return }
        currentStyle = effective
        imageLayer.removeAllAnimations()
        guard effective != .still else { return }
        let asleep = effective == .asleep

        // Breathing: a little taller and narrower on the in-breath.
        let breathe = CAKeyframeAnimation(keyPath: "transform")
        let depth: CGFloat = asleep ? 0.028 : 0.016
        breathe.values = [
            CATransform3DIdentity,
            CATransform3DMakeScale(1 - depth * 0.35, 1 + depth, 1),
            CATransform3DIdentity,
        ].map { NSValue(caTransform3D: $0) }
        breathe.keyTimes = [0, 0.45, 1]
        breathe.timingFunctions = [CAMediaTimingFunction(name: .easeInEaseOut), CAMediaTimingFunction(name: .easeInEaseOut)]
        breathe.duration = asleep ? 3.4 : 2.6
        breathe.repeatCount = .infinity
        imageLayer.add(breathe, forKey: "breathe")

        // A slow sway on a different period, so the motion never looks mechanical.
        if !asleep {
            let sway = CAKeyframeAnimation(keyPath: "transform.rotation.z")
            let angle = 1.1 * CGFloat.pi / 180
            sway.values = [0, angle, 0, -angle, 0]
            sway.keyTimes = [0, 0.25, 0.5, 0.75, 1]
            sway.timingFunctions = Array(repeating: CAMediaTimingFunction(name: .easeInEaseOut), count: 4)
            sway.duration = 5.3
            sway.repeatCount = .infinity
            sway.isAdditive = true
            imageLayer.add(sway, forKey: "sway")
        }
    }
}
