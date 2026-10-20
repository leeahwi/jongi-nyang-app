import AppKit

/// ⋯ → 화면 오른쪽에 붙이기 / 왼쪽에 붙이기 (1.38): the note against that edge of its screen's work area at full
/// height (its width kept); the same again puts it back where it was. The frame before is remembered
/// (`note.docked`), so it comes back after a restart too.
@MainActor
enum NoteDocking {
    private struct Saved: Codable {
        var side: String
        var previous: [Double]
    }

    private static let key = "note.docked"

    static func frame(for window: NSWindow, side: DockSide) -> NSRect? {
        guard let area = (window.screen ?? NSScreen.main)?.visibleFrame else { return nil }
        let width = window.frame.width
        let height = min(area.height, window.contentMaxSize.height)
        return NSRect(x: side == .left ? area.minX : area.maxX - width, y: area.maxY - height, width: width, height: height)
    }

    /// The side it's docked to now (nil once it was moved or resized away).
    static func side(of window: NSWindow?, preferences: UserDefaults) -> DockSide? {
        guard let window, let saved = load(preferences), let side = DockSide(rawValue: saved.side),
              let docked = frame(for: window, side: side), close(window.frame, docked) else { return nil }
        return side
    }

    static func toggle(_ window: NSWindow, side: DockSide, preferences: UserDefaults) {
        let current = Self.side(of: window, preferences: preferences)
        if current == side, let saved = load(preferences), saved.previous.count == 4 {
            let p = saved.previous
            window.setFrame(NSRect(x: p[0], y: p[1], width: p[2], height: p[3]), display: true, animate: !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
            preferences.removeObject(forKey: key)
            return
        }
        guard let target = frame(for: window, side: side) else { return }
        // Docked on the other side: the frame from before docking stays the one to go back to.
        let previous = current != nil ? (load(preferences)?.previous ?? []) : [window.frame.minX, window.frame.minY, window.frame.width, window.frame.height].map(Double.init)
        if let data = try? JSONEncoder().encode(Saved(side: side.rawValue, previous: previous)) { preferences.set(data, forKey: key) }
        window.setFrame(target, display: true, animate: !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion)
    }

    private static func load(_ preferences: UserDefaults) -> Saved? {
        preferences.data(forKey: key).flatMap { try? JSONDecoder().decode(Saved.self, from: $0) }
    }

    private static func close(_ a: NSRect, _ b: NSRect) -> Bool {
        abs(a.minX - b.minX) < 2 && abs(a.minY - b.minY) < 2 && abs(a.width - b.width) < 2 && abs(a.height - b.height) < 2
    }
}
