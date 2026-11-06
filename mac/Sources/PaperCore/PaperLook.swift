import Foundation

/// 보이는 종이 (#244, docs/plans/paper-themes.md 3장 · 7장): which paper is drawn, how bright the system's controls are, how
/// the drawer follows the note, and how 1.47's settings read into 1.48's. The rules are the Windows app's `core/paper.ts`;
/// both read docs/plans/paper-themes-cases.json (scripts/test-paper-themes.sh).
public struct PaperLook: Equatable, Sendable {
    /// 낮 · 밤 (`paper.color`): 자동 follows macOS.
    public enum DayNight: String, CaseIterable, Sendable { case auto, day, night }

    /// The system controls (menus, scroll bars, a field's caret): the system's own look, or always light or dark.
    public enum Appearance: String, Sendable { case system, light, dark }

    public var dayNight: DayNight
    public var paper: PaperKind
    public var night: NightChoice

    public init(dayNight: DayNight = .auto, paper: PaperKind = .day, night: NightChoice = .night) {
        self.dayNight = dayNight
        self.paper = paper
        self.night = night
    }

    // MARK: The paper drawn (3-1)

    /// Night now: 낮 · 밤 is 밤, or it is 자동 and macOS is dark.
    public func isNight(systemDark: Bool) -> Bool {
        switch dayNight {
        case .auto: systemDark
        case .day: false
        case .night: true
        }
    }

    /// The paper drawn by day and the paper drawn at night: a dark paper is itself both times; a light paper gives way at
    /// night to 밤에는's paper (itself with 그대로).
    public var slots: (day: PaperKind, night: PaperKind) {
        guard !paper.isDark, let dark = night.paper else { return (paper, paper) }
        return (paper, dark)
    }

    /// The paper drawn now.
    public func shown(systemDark: Bool) -> PaperKind {
        isNight(systemDark: systemDark) ? slots.night : slots.day
    }

    /// The system controls follow the lightness of the paper drawn: a dark paper (or 밤 · night with 밤에는 a dark paper) is
    /// dark, a light paper kept at night is light; otherwise 낮 · 밤 as before (자동 = the system's).
    public var appearance: Appearance {
        let (day, night) = slots
        if day.scheme == night.scheme { return day.isDark ? .dark : .light }
        switch dayNight {
        case .auto: return .system
        case .day: return .light
        case .night: return .dark
        }
    }

    /// 밤에는 only matters for a light paper: dimmed for a dark one, with ‘어두운 종이는 밤에도 그대로예요.’ (K3).
    public var nightChoiceEnabled: Bool { !paper.isDark }

    // MARK: The drawer (6-2)

    /// The drawer's own paper when it doesn't follow the note (`drawer.sameAsNote` off).
    public struct Drawer: Equatable, Sendable {
        public var sameAsNote: Bool
        public var paper: PaperKind
        public var night: NightChoice

        public init(sameAsNote: Bool = true, paper: PaperKind = .day, night: NightChoice = .night) {
            self.sameAsNote = sameAsNote
            self.paper = paper
            self.night = night
        }
    }

    /// The drawer's paper drawn now: the note's when it is the same as the note's, else its own with its own 밤에는 (the
    /// app's 낮 · 밤 decides night for both).
    public func drawerShown(_ drawer: Drawer, systemDark: Bool) -> PaperKind {
        if drawer.sameAsNote { return shown(systemDark: systemDark) }
        return PaperLook(dayNight: dayNight, paper: drawer.paper, night: drawer.night).shown(systemDark: systemDark)
    }

    // MARK: Reading what is saved (7-1)

    /// A paper as saved: an unknown one (a newer app's, a typo) is 낮 종이.
    public static func readPaper(_ value: Any?) -> PaperKind {
        (value as? String).flatMap(PaperKind.init(rawValue:)) ?? .day
    }

    /// 밤에는 as saved: an unknown value, or a light paper, is 밤 종이.
    public static func readNight(_ value: Any?) -> NightChoice {
        (value as? String).flatMap(NightChoice.init(rawValue:)) ?? .night
    }

    public static func readDayNight(_ value: Any?) -> DayNight {
        (value as? String).flatMap(DayNight.init(rawValue:)) ?? .auto
    }

    // MARK: 1.47's drawer paper (moved here from TextSteps, #142)

    /// 1.45–1.47's `drawer.theme` and 밤에는 밤 종이로: the paper picked for the day, and whether it gave way to 밤 종이 at
    /// night. `auto` is 낮 종이 with the switch on; a paper picked by name stayed as it was at night (the switch off until
    /// it was turned on).
    public static func drawerPaper(theme: String?, nightPaper: Bool?) -> (paper: String, nightPaper: Bool) {
        switch theme {
        case nil, "auto": ("day", true)
        case "day": ("day", false)
        case let paper?: (paper, nightPaper ?? false)
        }
    }

    /// What `drawer.theme` is written as: `auto` for 낮 종이 with the switch on, so 1.45–1.47 still follow day and night.
    public static func drawerThemeValue(paper: String, nightPaper: Bool) -> String {
        paper == "day" && nightPaper ? "auto" : paper
    }

    /// The papers that were dark in 1.47: 밤에는 밤 종이로 left them as they were.
    public static let darkPapers: Set<String> = Set(PaperKind.dark.map(\.rawValue))

    /// 1.47's paper drawn: a light paper turned to 밤 종이 at night when the switch was on; a dark paper stayed.
    public static func drawerShownPaper(paper: String, nightPaper: Bool, night: Bool) -> String {
        night && nightPaper && !darkPapers.contains(paper) ? "night" : paper
    }

    // MARK: Moving 1.47's settings (7-2)

    /// The drawer as 1.48 reads it. `sameAsNote` saved: the drawer's own paper from `drawer.theme`, its 밤에는 from the old
    /// switch (on: 밤 종이) and `drawer.night` (off: 그대로, or the dark paper it names). Not saved yet (the first 1.48 run): 1.47's ‘자동’ (낮 종이 with 밤에는 밤 종이로,
    /// the default) is the note's paper — the note starts as 낮 종이 + 밤 종이 too, so nothing on screen changes; any other
    /// paper stays the drawer's own, with 밤에는 밤 종이 if the switch was on and 그대로 if it was off.
    public static func readDrawer(sameAsNote: Bool?, theme: String?, nightPaper: Bool?, night: String?) -> Drawer {
        let old = drawerPaper(theme: theme, nightPaper: nightPaper)
        let paper = readPaper(old.paper)
        // The old switch decides on or off (1.47 may have flipped it since 1.48 wrote `drawer.night`); `drawer.night` adds which
        // dark paper when it is off (먹색 · 밤하늘 · 칠판 are written as off for 1.47).
        let saved = night.flatMap(NightChoice.init(rawValue:))
        let nightChoice: NightChoice = old.nightPaper ? .night : (saved == .night ? .keep : saved ?? .keep)
        let same = sameAsNote ?? (theme == nil || theme == "auto")
        return Drawer(sameAsNote: same, paper: paper, night: nightChoice)
    }

    /// What is written to the old keys too, so 1.47 opened on the same Mac still shows a drawer: `drawer.theme` (`auto` for
    /// 낮 종이 + 밤 종이) and `drawer.nightPaper` (on only for 밤에는 밤 종이). They hold the drawer's own pick, kept while it
    /// follows the note so turning 노트와 같은 종이 off brings it back. A paper 1.47 doesn't know reads there as 낮 종이.
    public static func storedDrawer(_ drawer: Drawer) -> (theme: String, nightPaper: Bool) {
        let on = drawer.night == .night
        return (drawerThemeValue(paper: drawer.paper.rawValue, nightPaper: on), on)
    }
}
