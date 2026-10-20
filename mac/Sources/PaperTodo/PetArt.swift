import AppKit

/// Optional hand-drawn poses for the desktop pet (see art/pet/PROMPTS.md). Any pose whose
/// image isn't bundled falls back to the sitting cat with drawn-on details, so the pet works
/// with just the original art and gets richer as pose images are added.
@MainActor
enum PetArt {
    enum Pose: String, CaseIterable {
        case idle, blink, happy, sleep, yawn, stretch, cheer, curious, groom, tea
        case walk1 = "walk-1", walk2 = "walk-2", walk3 = "walk-3", walk4 = "walk-4"
    }

    private static var cache: [Pose: NSImage] = [:]
    private static var missing = Set<Pose>()

    static func image(_ pose: Pose) -> NSImage? {
        if pose == .idle { return PaperTheme.mascot }
        if let image = cache[pose] { return image }
        if missing.contains(pose) { return nil }
        let url = Bundle.main.url(forResource: pose.rawValue, withExtension: "png", subdirectory: "Assets/Pet")
            ?? Bundle.module.url(forResource: pose.rawValue, withExtension: "png", subdirectory: "Assets/Pet")
        guard let url, let source = NSImage(contentsOf: url) else {
            missing.insert(pose)
            return nil
        }
        let image = PaperTheme.downsampled(source, maxPixels: 384)
        cache[pose] = image
        return image
    }

    static func has(_ pose: Pose) -> Bool { image(pose) != nil }

    /// The sitting cat with gently closed eyes, drawn once — used for blinks and sleep until
    /// `blink.png` / `sleep.png` exist. Baked into the image so it breathes with the cat.
    static let closedEyes: NSImage = {
        let base = PaperTheme.mascot
        let size = base.size
        return NSImage(size: size, flipped: true) { rect in
            base.draw(in: rect)
            let face = NSColor(srgbRed: 0.985, green: 0.955, blue: 0.895, alpha: 1)
            let ink = NSColor(srgbRed: 0.30, green: 0.22, blue: 0.16, alpha: 1)
            let w = size.width
            for x in [0.345, 0.648] {
                face.setFill()
                NSBezierPath(ovalIn: NSRect(x: w * (x - 0.0525), y: w * (0.462 - 0.05), width: w * 0.105, height: w * 0.1)).fill()
                let lid = NSBezierPath()
                lid.move(to: NSPoint(x: w * (x - 0.042), y: w * 0.455))
                lid.curve(to: NSPoint(x: w * (x + 0.042), y: w * 0.455),
                          controlPoint1: NSPoint(x: w * (x - 0.02), y: w * 0.49), controlPoint2: NSPoint(x: w * (x + 0.02), y: w * 0.49))
                lid.lineWidth = max(1.2, w * 0.022)
                lid.lineCapStyle = .round
                ink.setStroke()
                lid.stroke()
            }
            return true
        }
    }()

    /// Prefer the complete eight-frame image sequence; retain the older four-frame fallback.
    static let walkCycle: [NSImage]? = {
        let completeFrames = (1...8).compactMap { index -> NSImage? in
            let name = String(format: "walk-cycle-%02d", index)
            let url = Bundle.main.url(forResource: name, withExtension: "png", subdirectory: "Assets/Pet")
                ?? Bundle.module.url(forResource: name, withExtension: "png", subdirectory: "Assets/Pet")
            guard let url, let source = NSImage(contentsOf: url) else { return nil }
            return PaperTheme.downsampled(source, maxPixels: 384)
        }
        if completeFrames.count == 8 { return completeFrames }
        let frames = [Pose.walk1, .walk2, .walk3, .walk4].compactMap { image($0) }
        return frames.count == 4 ? frames : nil
    }()

    /// Target: 120px of planted-paw travel over 62.5% of a cycle, displayed at 92/1024 scale.
    static var walkStride: CGFloat { walkCycle?.count == 8 ? 192 * 92 / 1024 : 52 }
}
