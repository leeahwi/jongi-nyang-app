import AppKit
import Observation
import PaperCore
import SwiftUI

extension PaperLook {
    /// The paper the app draws now (#244): `PaperTheme`'s tokens read it.
    static let shared = PaperLookStore()

    /// A token of the paper drawn (`PaperTheme.ink` …).
    static func color(_ token: NotePalette.Token) -> Color { shared.colors[token] }

    /// An event's mark on the paper drawn.
    static func mark(_ color: LocalEvent.Color) -> Color {
        let token: NotePalette.Token = switch color {
        case .blue: .markBlue
        case .sage: .markSage
        case .coral: .markCoral
        case .purple: .markPurple
        case .yellow: .markYellow
        case .gray: .markGray
        }
        return shared.colors[token]
    }
}

/// The note's colours of one paper choice, as SwiftUI colours. Each resolves for the appearance it is drawn in (by day the
/// paper, at night 밤에는's), reading the paper drawn when it resolves — so a colour an AppKit view kept (a window's
/// background, a field's text) shows the new paper at its next redraw too. A new set is made each time the paper changes,
/// so SwiftUI sees new colours where a view reads them.
final class NoteColors: Sendable {
    private let colors: [Color]

    init(_ store: PaperLookStore) {
        colors = NotePalette.Token.allCases.map { token in
            Color(nsColor: NSColor(name: nil) { [unowned store] appearance in store.resolve(token, night: appearance.isNight) })
        }
    }

    subscript(_ token: NotePalette.Token) -> Color { colors[token.rawValue] }
}

/// The paper drawn and its colours (#244, docs/plans/paper-themes.md 8-1). Observable: a view whose `body` reads a token
/// (`PaperTheme.ink` reads `colors`) redraws when the paper changes, and only then — nothing runs while the app is idle.
/// Read from any thread (colours resolve where they are drawn); changed on the main thread only.
final class PaperLookStore: Observable, @unchecked Sendable {
    private let registrar = ObservationRegistrar()
    private let lock = NSLock()
    // Guarded by `lock`.
    private var current = PaperLook()
    private var slotPalettes = (day: NotePalette.day, night: NotePalette.night)
    private var resolved: (day: [NSColor], night: [NSColor])
    private var set: NoteColors!
    private var changes = 0
    private var systemChanges = 0

    fileprivate init() {
        resolved = (Self.resolve(NotePalette.day), Self.resolve(NotePalette.night))
        set = NoteColors(self)
        DistributedNotificationCenter.default().addObserver(forName: Notification.Name("AppleInterfaceThemeChangedNotification"), object: nil, queue: .main) { [weak self] _ in
            // macOS turned light or dark: what depends on it while the app's look is fixed (the drawer's own paper).
            guard let self else { return }
            self.registrar.withMutation(of: self, keyPath: \.systemRevision) { self.locked { self.systemChanges += 1 } }
        }
    }

    private func locked<T>(_ body: () -> T) -> T {
        lock.lock()
        defer { lock.unlock() }
        return body()
    }

    private static func resolve(_ palette: NotePalette) -> [NSColor] {
        NotePalette.Token.allCases.map { NSColor(paperHex: palette.hex($0))! }
    }

    // MARK: Reading

    /// 낮 · 밤, the paper and 밤에는.
    var look: PaperLook {
        registrar.access(self, keyPath: \.look)
        return locked { current }
    }

    var colors: NoteColors {
        registrar.access(self, keyPath: \.colors)
        return locked { set }
    }

    /// The paper drawn by day (`dark` false) or at night: its ruling, its grain.
    func paper(dark: Bool) -> PaperKind {
        registrar.access(self, keyPath: \.colors)
        return locked { dark ? slotPalettes.night.kind : slotPalettes.day.kind }
    }

    /// How many times the paper changed (the redraw check, W3).
    var revision: Int {
        registrar.access(self, keyPath: \.colors)
        return locked { changes }
    }

    /// How many times macOS turned light or dark (what `systemDark` is read with).
    var systemRevision: Int {
        registrar.access(self, keyPath: \.systemRevision)
        return locked { systemChanges }
    }

    /// Whether macOS is in dark mode, whatever the app's own look (the drawer's own 밤에는 under 낮 · 밤 자동).
    @MainActor var systemDark: Bool {
        _ = systemRevision
        if NSApp?.appearance == nil, let appearance = NSApp?.effectiveAppearance { return appearance.isNight }
        return UserDefaults.standard.string(forKey: "AppleInterfaceStyle") == "Dark"
    }

    /// The colour a token resolves to in the paper drawn now (untracked: called while drawing).
    func resolve(_ token: NotePalette.Token, night: Bool) -> NSColor {
        locked { (night ? resolved.night : resolved.day)[token.rawValue] }
    }

    // MARK: Changing

    @MainActor func update(dayNight: PaperLook.DayNight) {
        var look = locked { current }
        look.dayNight = dayNight
        apply(look)
    }

    @MainActor func update(paper: PaperKind, night: NightChoice) {
        var look = locked { current }
        look.paper = paper
        look.night = night
        apply(look)
    }

    /// Takes the new look: new colours only when the papers drawn change (one redraw of what reads them), and the app's
    /// appearance from 낮 · 밤 and the paper's lightness.
    @MainActor func apply(_ look: PaperLook) {
        let before = locked { current }
        let slots = look.slots
        let palettes = (NotePalette.of(slots.day), NotePalette.of(slots.night))
        let papersChanged = locked { palettes.0.kind != slotPalettes.day.kind || palettes.1.kind != slotPalettes.night.kind }
        if before != look {
            registrar.withMutation(of: self, keyPath: \.look) { locked { current = look } }
        }
        if papersChanged {
            let made = (Self.resolve(palettes.0), Self.resolve(palettes.1))
            registrar.withMutation(of: self, keyPath: \.colors) {
                locked {
                    slotPalettes = palettes
                    resolved = made
                    changes += 1
                }
                let fresh = NoteColors(self)
                locked { set = fresh }
            }
        }
        NSApplication.shared.appearance = switch look.appearance {
        case .system: nil
        case .light: NSAppearance(named: .aqua)
        case .dark: NSAppearance(named: .darkAqua)
        }
        // What AppKit drew with a kept colour (a window's background, a field's text) redraws once, between two light
        // papers too (no appearance change tells it to).
        if papersChanged { Self.redrawWindows() }
    }

    @MainActor private static func redrawWindows() {
        for window in NSApp.windows {
            if let background = window.backgroundColor { window.backgroundColor = background }
            window.contentView?.needsDisplay = true
            window.contentView?.subviews.forEach { redraw($0) }
            window.invalidateShadow()
        }
    }

    @MainActor private static func redraw(_ view: NSView) {
        view.needsDisplay = true
        if let text = view as? NSTextView {
            text.textColor = text.textColor
            text.insertionPointColor = text.insertionPointColor
        }
        view.subviews.forEach { redraw($0) }
    }
}
