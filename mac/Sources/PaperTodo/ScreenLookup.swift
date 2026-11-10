import AppKit
import PaperCore

/// #327: the displays as ScreenFit sees them, and the display a window or a point is on (ScreenFit.swift). Not
/// `NSScreen.main`: that is the display of the key window — often another app's — not of the window being placed.
extension NSScreen {
    static var fitDisplays: [ScreenFit.Display] {
        screens.map { ScreenFit.Display(frame: $0.frame, visible: $0.visibleFrame) }
    }

    /// The display `rect` is mostly on, or the nearest.
    static func holding(_ rect: NSRect) -> NSScreen? {
        let all = screens
        return ScreenFit.index(of: rect, in: all.map { ScreenFit.Display(frame: $0.frame, visible: $0.visibleFrame) }).map { all[$0] }
    }

    /// The display `point` is on (its top edge too), or the nearest; `nearest` false: nil off every display.
    static func at(_ point: NSPoint, nearest: Bool = true) -> NSScreen? {
        let all = screens
        return ScreenFit.index(at: point, in: all.map { ScreenFit.Display(frame: $0.frame, visible: $0.visibleFrame) }, nearest: nearest).map { all[$0] }
    }

    /// The display with the pointer.
    static var withPointer: NSScreen? { at(NSEvent.mouseLocation) }

    /// #331: this display's id (NSScreenNumber), kept with a place on it.
    var displayID: String {
        (deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.stringValue ?? "main"
    }

    /// #331: the displays with their ids, as the typing cat's 옮긴 자리 sees them.
    static var typingScreens: [TypingCorner.Screen] {
        screens.map { TypingCorner.Screen(id: $0.displayID, display: ScreenFit.Display(frame: $0.frame, visible: $0.visibleFrame)) }
    }
}
