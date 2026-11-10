import Foundation

/// 바탕화면 달력 위젯 (#234): the rules of the calendar widgets on the desktop — what each kind shows, how the paper fades
/// and the text stays readable, where a widget sits on which display, what a line typed into its quick entry makes, and
/// when it draws again. The cells themselves come from `CalendarMonth.Page` (the desk calendar's), with the to-dos of
/// the spaces this device hides already left out (`AppModel.hereItems`). Days run midnight to midnight, like the
/// calendar. Same rules and shared cases as the Windows app (core/calendarWidget.ts, docs/plans/calendar-widget-cases.json).
public enum CalendarWidget {
    // MARK: Kinds and settings

    public enum Kind: String, Codable, CaseIterable, Sendable {
        case today, week, month, agenda
    }

    public enum Style: String, Codable, CaseIterable, Sendable {
        case simple, detail
        /// 벽 달력: the month detailed at a wall calendar's size (this month only).
        case wall
    }

    /// `desktop`: under every other window (바탕화면에 두기, the default); `top`: 항상 위에 두기.
    public enum Level: String, Codable, CaseIterable, Sendable {
        case desktop, top
    }

    /// Where a widget is: the display's id and its top-left corner as a share (0–1) of the room it can move in on that
    /// display's usable area (the area less the widget's own size), so it stays whole on any size of display.
    public struct Place: Codable, Equatable, Sendable {
        public var display: String
        public var x: Double
        public var y: Double

        public init(display: String, x: Double, y: Double) {
            self.display = display; self.x = x; self.y = y
        }
    }

    public struct Settings: Codable, Equatable, Sendable {
        public var id: String
        public var kind: Kind
        public var style: Style
        /// 20–100 in steps of 5.
        public var opacity: Int
        public var solidOnHover: Bool
        public var clickThrough: Bool
        public var locked: Bool
        public var level: Level
        public var allSpaces: Bool
        public var place: Place?
        /// 크기 (#271): one of `scales` (보통 1, the size before #271).
        public var scale: Double

        public init(id: String, kind: Kind, style: Style = .simple, opacity: Int = CalendarWidget.defaultOpacity, solidOnHover: Bool = true,
                    clickThrough: Bool = false, locked: Bool = false, level: Level = .desktop, allSpaces: Bool = true, place: Place? = nil,
                    scale: Double = CalendarWidget.defaultScale) {
            self.id = id; self.kind = kind
            self.style = CalendarWidget.styles(kind).contains(style) ? style : (style == .wall && kind == .week ? .detail : .simple)
            self.opacity = CalendarWidget.opacity(opacity)
            self.solidOnHover = solidOnHover; self.clickThrough = clickThrough; self.locked = locked
            self.level = level; self.allSpaces = allSpaces; self.place = place
            self.scale = CalendarWidget.scale(scale)
        }
    }

    /// A device keeps at most four (each is a window and its memory).
    public static let limit = 4
    public static let defaultOpacity = 85

    /// Only the week and the month come in 간단히 and 자세히.
    public static func hasStyles(_ kind: Kind) -> Bool { kind == .week || kind == .month }
    /// The month also comes as 벽 달력.
    public static func styles(_ kind: Kind) -> [Style] {
        switch kind {
        case .month: [.simple, .detail, .wall]
        case .week: [.simple, .detail]
        case .today, .agenda: [.simple]
        }
    }

    /// The settings as stored (`calendar.widgets` on the Mac, `prefs.calendarWidgets` on Windows): an entry of the wrong
    /// shape is dropped (S1), a value out of range is read as the nearest one, the fifth and later aren't read (S2),
    /// today and agenda are always simple (S3), and a missing key takes its default (S4). The same id twice: the first.
    /// A size that isn't a number is 보통, as a widget from before #271 (S7).
    public static func read(_ value: Any?) -> [Settings] {
        guard let list = value as? [Any] else { return [] }
        var found: [Settings] = []
        for (index, raw) in list.enumerated() {
            guard found.count < limit, let entry = raw as? [String: Any] else { continue }
            guard let kindName = entry["kind"] as? String, let kind = Kind(rawValue: kindName) else { continue }
            var style = Style.simple
            if let value = entry["style"] {
                guard let name = value as? String, let read = Style(rawValue: name) else { continue }
                style = read
            }
            var level = Level.desktop
            if let value = entry["level"] {
                guard let name = value as? String, let read = Level(rawValue: name) else { continue }
                level = read
            }
            var place: Place?
            if let value = entry["place"], !(value is NSNull) {
                guard let p = value as? [String: Any], let display = p["display"] as? String,
                      let x = number(p["x"]), let y = number(p["y"]) else { continue }
                place = Place(display: display, x: share(x), y: share(y))
            }
            let id = (entry["id"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "w-\(index + 1)"
            if found.contains(where: { $0.id == id }) { continue }
            func flag(_ key: String, _ fallback: Bool) -> Bool { entry[key] as? Bool ?? fallback }
            found.append(Settings(id: id, kind: kind, style: style, opacity: number(entry["opacity"]).map { Int($0.rounded()) } ?? defaultOpacity,
                                  solidOnHover: flag("solidOnHover", true), clickThrough: flag("clickThrough", false),
                                  locked: flag("locked", false), level: level, allSpaces: flag("allSpaces", true), place: place,
                                  scale: number(entry["scale"]) ?? defaultScale))
        }
        return found
    }

    /// The settings to store, in the same shape `read` takes.
    public static func write(_ settings: [Settings]) -> [[String: Any]] {
        settings.prefix(limit).map { s in
            var entry: [String: Any] = ["id": s.id, "kind": s.kind.rawValue, "style": s.style.rawValue, "opacity": s.opacity,
                                        "solidOnHover": s.solidOnHover, "clickThrough": s.clickThrough, "locked": s.locked,
                                        "level": s.level.rawValue, "allSpaces": s.allSpaces, "scale": s.scale]
            if let place = s.place { entry["place"] = ["display": place.display, "x": place.x, "y": place.y] }
            return entry
        }
    }

    /// A new widget's id: "w-" and four hex digits not taken yet.
    public static func newID(taken: [String], random: () -> UInt16 = { UInt16.random(in: .min ... .max) }) -> String {
        while true {
            let id = "w-" + String(format: "%04x", random())
            if !taken.contains(id) { return id }
        }
    }

    private static func number(_ value: Any?) -> Double? {
        if value is Bool { return nil }
        if let n = value as? NSNumber { return n.doubleValue }
        return nil
    }

    private static func share(_ value: Double) -> Double { value.isFinite ? min(1, max(0, value)) : 0 }

    // MARK: Sizes

    /// The paper's size in points (Windows: the same number of DIPs). Fixed per kind: each cell then holds a known
    /// number of lines, the same in both apps.
    public static func size(_ kind: Kind, _ style: Style) -> (width: Double, height: Double) {
        switch (kind, style) {
        case (.today, _): (170, 170)
        case (.week, _): (344, 170)
        case (.month, .simple): (344, 344)
        case (.month, .detail): (560, 440)
        case (.month, .wall): (880, 680)
        case (.agenda, _): (200, 360)
        }
    }

    /// The ears' scale (the note's ears are 1): small 0.6, medium 0.75, large 0.9, the biggest and the tall list 1.
    public static func earScale(_ kind: Kind, _ style: Style) -> Double {
        switch (kind, style) {
        case (.today, _): 0.6
        case (.week, _): 0.75
        case (.month, .simple): 0.9
        case (.month, .detail), (.agenda, _): 1
        case (.month, .wall): 1.15
        }
    }

    /// The ears stand this far above the paper (the note's ears are 16 pt tall).
    public static func earHeight(_ kind: Kind, _ style: Style) -> Double { 16 * earScale(kind, style) }

    /// The window: the paper and the ears above it, at a size (`scales`). Placing works on this frame, so the ears stay
    /// on screen too.
    public static func windowSize(_ kind: Kind, _ style: Style, scale: Double = 1) -> (width: Double, height: Double) {
        let paper = size(kind, style)
        return (paper.width * scale, (paper.height + earHeight(kind, style)) * scale)
    }

    // MARK: 크기 (#271)

    /// 작게 · 보통 · 크게 · 아주 크게: the whole paper (its text, cells, margins and ears) drawn this many times as big, so
    /// each cell keeps the lines it holds (`size`) — a size picked freely would cut names at some sizes and leave cells
    /// empty at others. 보통 is the size before #271.
    public static let scales: [Double] = [0.85, 1, 1.25, 1.5]
    public static let defaultScale = 1.0

    /// Read as the nearest of `scales` (the smaller one when halfway) (Z1).
    public static func scale(_ value: Double) -> Double {
        guard value.isFinite else { return defaultScale }
        return scales.min { abs($0 - value) < abs($1 - value) } ?? defaultScale
    }

    /// The widget, ears and all, fits in a display's usable area at this size (Z3). One that doesn't is greyed out in the
    /// settings and the menu.
    public static func fits(_ kind: Kind, _ style: Style, scale: Double, area: Rect) -> Bool {
        let window = windowSize(kind, style, scale: scale)
        return window.width <= area.width && window.height <= area.height
    }

    /// The size drawn on a display: the size picked, else the largest smaller one that fits there (a smaller display
    /// came, Z4). The size picked stays remembered, so it comes back on a display with room.
    public static func shownScale(_ scale: Double, _ kind: Kind, _ style: Style, area: Rect) -> Double {
        let picked = CalendarWidget.scale(scale)
        return scales.filter { $0 <= picked && fits(kind, style, scale: $0, area: area) }.last ?? scales[0]
    }

    /// "작게", "Small", "Klein" … (the settings slip and the menu, Z2).
    public static func scaleName(_ scale: Double, _ language: AppLanguage = .ko) -> String {
        let names = [["작게", "Small", "Klein"], ["보통", "Regular", "Normaal"], ["크게", "Large", "Groot"], ["아주 크게", "Extra large", "Extra groot"]]
        let index = scales.firstIndex(of: CalendarWidget.scale(scale)) ?? 1
        return names[index][language.index]
    }

    /// Where the two ears stand, from the window's right edge inward (the note's ears: 16–48 and 62–92), scaled.
    public static func ears(_ kind: Kind, _ style: Style) -> [(near: Double, far: Double)] {
        let k = earScale(kind, style)
        return [(16 * k, 48 * k), (62 * k, 92 * k)]
    }

    /// The smallest a thing one clicks may be (`+N`, ‹ ›, the + of 오늘 and 오늘 목록), in points.
    public static let target = 24.0

    // MARK: Opacity (#234 Q5–Q8)

    /// Read as 20–100 in steps of 5 (O1).
    public static func opacity(_ value: Int) -> Int {
        let stepped = Int((Double(value) / 5).rounded()) * 5
        return min(100, max(20, stepped))
    }

    /// Below 85 % a paper backing (the paper at 85 %) goes behind every line of text and every mark (O2), so the text
    /// sits on the same colour as on an 85 % paper whatever the wallpaper is.
    public static let backingOpacity = 85

    /// The paper's floor (#234): the faintest the paper may be with ink on it alone keeping 4.5:1 over the worst wallpaper
    /// (black behind a light paper, white behind a dark one) — in 5 % steps. Fainter than that, the text gets its outline of
    /// paper (`backing`, #321). Day paper 60,
    /// kraft 65, night 75 (docs/plans/calendar-widget-cases.json `floors`, every paper of #244).
    public static func floor(paper: (Double, Double, Double), ink: (Double, Double, Double), dark: Bool) -> Int {
        let worst = dark ? (1.0, 1.0, 1.0) : (0.0, 0.0, 0.0), other = dark ? (0.0, 0.0, 0.0) : (1.0, 1.0, 1.0)
        for step in stride(from: 20, through: 100, by: 5) {
            let a = Double(step) / 100
            if contrast(ink, mix(paper, a, worst)) >= 4.5 && contrast(ink, mix(paper, a, other)) >= 4.5 { return step }
        }
        return 100
    }

    /// The weekend and holiday tiles' colour: the paper with its clay2 mixed in (55 %). It has its own floor (`floor` of
    /// the tint), a step higher than the plain paper's on light papers (day 65), as the tint darkens it (O10).
    public static let tintShare = 0.55
    public static func weekendTint(clay2: (Double, Double, Double), paper: (Double, Double, Double)) -> (Double, Double, Double) {
        mix(clay2, tintShare, paper)
    }

    /// Today's sage outline keeps a ring of solid paper inside it below 100 %, as every mark does (O11).
    public static func todayRing(_ drawn: Int) -> Bool { halo(drawn) }

    /// A day's tile (the month and the week): the paper as drawn (#321: it fades with the paper, so the desktop shows
    /// through it as through the paper; the text on it keeps 4.5:1 by its outline, `backing`).
    public static func tile(_ drawn: Int) -> Int { drawn }

    /// #321: every text (on a tile or off it) gets an outline of solid paper (1 pt round each letter) once the paper is
    /// fainter than its floor, so ink keeps the paper's own contrast on any wallpaper while the desktop shows through.
    /// It was a block of paper at the floor behind the text off the tiles, and the tiles never went below the floor (O2).
    public static func backing(_ drawn: Int, floor: Int) -> Bool { drawn < floor }

    /// sRGB (0–1, rounded to 0–255 as the app's colours are): `alpha` of `a` over `b`.
    static func mix(_ a: (Double, Double, Double), _ alpha: Double, _ b: (Double, Double, Double)) -> (Double, Double, Double) {
        func m(_ x: Double, _ y: Double) -> Double { ((x * alpha + y * (1 - alpha)) * 255).rounded() / 255 }
        return (m(a.0, b.0), m(a.1, b.1), m(a.2, b.2))
    }

    /// WCAG contrast of two sRGB colours (0–1).
    public static func contrast(_ a: (Double, Double, Double), _ b: (Double, Double, Double)) -> Double {
        func channel(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        func luminance(_ c: (Double, Double, Double)) -> Double { 0.2126 * channel(c.0) + 0.7152 * channel(c.1) + 0.0722 * channel(c.2) }
        let (x, y) = (luminance(a), luminance(b))
        return (max(x, y) + 0.05) / (min(x, y) + 0.05)
    }

    /// Below 100 % ink2 · ink3 · sageText · clayText are drawn in ink (O3): only ink passes 4.5:1 on an 85 % paper over
    /// the worst wallpaper (day paper over black, night paper over white).
    public static func inkOnly(_ drawn: Int) -> Bool { drawn < 100 }

    /// Below 85 % the day numbers are a step bolder, and the marks (event bars, dots, the today circle) get a thin ring
    /// of paper so they keep their edge on a busy wallpaper.
    public static func bolder(_ drawn: Int) -> Bool { drawn < backingOpacity }
    public static func halo(_ drawn: Int) -> Bool { drawn < 100 }

    /// The paper as drawn (O4, O6): 100 with 투명도 줄이기, and while the pointer is over it (마우스를 올리면 선명하게).
    public static func drawn(_ opacity: Int, reduceTransparency: Bool, hover: Bool, solidOnHover: Bool) -> Int {
        if reduceTransparency || (hover && solidOnHover) { return 100 }
        return CalendarWidget.opacity(opacity)
    }

    /// The ears fade with the paper (#321) but never below half (O5), as the edge line (O8): they are the handle to find,
    /// move and open the widget, also while clicks pass. (At 85 they stood dark over a faint paper.)
    public static let earFloor = 50
    public static func earOpacity(_ drawn: Int) -> Int { max(drawn, earFloor) }

    /// The edge line's strength (0–1): never fainter than half, so the widget's border reads on any wallpaper.
    public static func edgeStrength(_ drawn: Int) -> Double { max(0.5, Double(drawn) / 100) }

    // MARK: Lines

    /// One thing on a day as a widget shows it.
    public struct Line: Equatable, Sendable {
        /// `repeating` (#274): a day a repeating to-do comes back on.
        public enum Kind: String, Sendable { case event, deadline, reminder, range, repeating = "repeat" }
        public var kind: Kind
        public var title: String
        /// The clock ("10:00", "10:00 AM"), "~01:00" for an event from the day before, a to-do's range ("14:00–15:30");
        /// nil for an all-day event and a deadline (drawn as 종일 · 마감).
        public var time: String?
        /// An event's "#RRGGBB"; `clay` for a deadline, `sage` for a reminder or a time range (the dots' colours, #227);
        /// #274: `sage` for a repeat's next day, `faint` (sage, faded) for the ones after it.
        public var color: String
        public var allDay: Bool
        public var eventKey: String?
        public var taskId: UUID?
        /// When it starts (the event, the reminder, the range) and ends; nil for all-day events and deadlines.
        public var at: Date?
        public var end: Date?
        /// #274: a repeat's rule (it opens the rule when it has no open copy), and whether it is after the next one (faded).
        public var seriesId: String?
        public var ahead: Bool

        public init(kind: Kind, title: String, time: String? = nil, color: String, allDay: Bool = false, eventKey: String? = nil,
                    taskId: UUID? = nil, at: Date? = nil, end: Date? = nil, seriesId: String? = nil, ahead: Bool = false) {
            self.kind = kind; self.title = title; self.time = time; self.color = color; self.allDay = allDay
            self.eventKey = eventKey; self.taskId = taskId; self.at = at; self.end = end
            self.seriesId = seriesId; self.ahead = ahead
        }

        /// #274: a repeat's line from the calendar's (its alert on `day`, when it has one).
        static func repeating(_ task: CalendarMonth.DayTask, on day: String, calendar: Calendar) -> Line {
            let parts = task.remindAt?.split(separator: ":").compactMap { Int($0) } ?? []
            let at = parts.count == 2 ? calendar.date(bySettingHour: parts[0], minute: parts[1], second: 0, of: CalendarMonth.date(day, calendar: calendar)) : nil
            return Line(kind: .repeating, title: task.title, time: task.time, color: task.ahead ? "faint" : "sage", taskId: task.taskId, at: at,
                        seriesId: task.seriesId, ahead: task.ahead)
        }

        /// Gone by at `now`: an event or a range once it ended, a reminder once its time came (all-day events and
        /// deadlines stay the whole day).
        public func over(_ now: Date) -> Bool {
            switch kind {
            case .deadline: return false
            case .event:
                guard !allDay, let at else { return false }
                let end = end ?? at
                return end == at ? at < now : end <= now
            case .reminder, .repeating: return (at ?? .distantFuture) <= now
            case .range: return (end ?? .distantFuture) <= now
            }
        }
    }

    /// A day's things in time order: all-day events, then the events, reminders and time ranges by time (an event
    /// first at the same time), then the deadlines by title (the agenda, the day sheet, the 오늘 widget).
    public static func dayLines(_ day: String, page: CalendarMonth.Page, tasks: [TodoItem], now: Date, calendar: Calendar = .paper,
                                language: AppLanguage = .ko) -> [Line] {
        let midnight = CalendarMonth.date(day, calendar: calendar)
        var allDay: [Line] = []
        var timed: [(Date, Int, Line)] = []
        for event in page.events(on: day) {
            let wholeDay = event.allDay || (event.start < midnight && event.end > calendar.date(byAdding: .day, value: 1, to: midnight)!)
            if wholeDay {
                allDay.append(Line(kind: .event, title: event.title, color: event.color, allDay: true, eventKey: event.key))
                continue
            }
            let time = event.start < midnight ? CalendarMonth.agendaTime(event, on: day, calendar: calendar, language: language)
                : clock(event.start, calendar: calendar, language: language)
            timed.append((event.start, 0, Line(kind: .event, title: event.title, time: time, color: event.color, eventKey: event.key,
                                               at: event.start, end: event.end)))
        }
        let byId = Dictionary(tasks.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var deadlines: [Line] = []
        // #274: a repeat with its time goes among the timed lines, one without after the deadlines.
        var untimed: [Line] = []
        for task in page.tasks(on: day) {
            let item = task.taskId.flatMap { byId[$0] }
            switch task.kind {
            case .deadline:
                deadlines.append(Line(kind: .deadline, title: task.title, color: "clay", taskId: task.taskId))
            case .reminder:
                let at = item?.reminderAt
                timed.append((at ?? midnight, 1, Line(kind: .reminder, title: task.title, time: task.time, color: "sage", taskId: task.taskId, at: at)))
            case .range:
                let span = item.flatMap { TimeBlock.interval(of: $0, now: now, calendar: calendar) }
                timed.append((span?.start ?? midnight, 1, Line(kind: .range, title: task.title, time: task.time, color: "sage", taskId: task.taskId,
                                                               at: span?.start, end: span?.end)))
            case .repeating:
                let line = Line.repeating(task, on: day, calendar: calendar)
                if let at = line.at { timed.append((at, 2, line)) } else { untimed.append(line) }
            }
        }
        let ordered = timed.enumerated().sorted { a, b in
            if a.element.0 != b.element.0 { return a.element.0 < b.element.0 }
            if a.element.1 != b.element.1 { return a.element.1 < b.element.1 }
            return a.offset < b.offset
        }.map(\.element.2)
        return allDay + ordered + deadlines + untimed
    }

    /// 오늘 · 이번 주 간단히: what is still to come today, the first `limit`, and how many more (K1, K2).
    public static func upcoming(_ day: String, page: CalendarMonth.Page, tasks: [TodoItem], now: Date, limit: Int = 3,
                                calendar: Calendar = .paper, language: AppLanguage = .ko) -> (lines: [Line], more: Int) {
        let left = dayLines(day, page: page, tasks: tasks, now: now, calendar: calendar, language: language).filter { !$0.over(now) }
        return (Array(left.prefix(limit)), max(0, left.count - limit))
    }

    /// A month cell's line as a widget line (the desk calendar's cell: events, then deadlines, then reminders).
    public static func line(_ item: CalendarMonth.CellItem, calendar: Calendar = .paper, language: AppLanguage = .ko) -> Line {
        switch item {
        case .event(let event):
            return Line(kind: .event, title: event.title, time: event.allDay ? nil : clock(event.start, calendar: calendar, language: language),
                        color: event.color, allDay: event.allDay, eventKey: event.key, at: event.allDay ? nil : event.start, end: event.end)
        case .task(let task) where task.kind == .repeating:
            return Line(kind: .repeating, title: task.title, time: task.time, color: task.ahead ? "faint" : "sage", taskId: task.taskId,
                        seriesId: task.seriesId, ahead: task.ahead)
        case .task(let task):
            return Line(kind: task.kind == .deadline ? .deadline : task.kind == .reminder ? .reminder : .range, title: task.title,
                        time: task.kind == .deadline ? nil : task.time, color: task.kind == .deadline ? "clay" : "sage", taskId: task.taskId)
        }
    }

    /// #274: a repeat's spoken name ("분리수거, 09:00, 반복 예정"); nil for the other lines (read as drawn).
    public static func spoken(_ line: Line, language: AppLanguage = .ko) -> String? {
        guard line.kind == .repeating else { return nil }
        return CalendarMonth.spoken(CalendarMonth.DayTask(title: line.title, kind: .repeating, time: line.time, ahead: line.ahead), language: language)
    }

    /// 간단히 (week, month): the cell's first three marks' colours, and whether there are more (a small + instead of a
    /// fourth dot) (K3, K5).
    /// #296 `folding` (the month's cells): no dot for a faded daily · weekday repeat.
    public static func dots(_ day: String, page: CalendarMonth.Page, folding: Bool = false) -> (colors: [String], plus: Bool) {
        let cell = page.cell(day, limit: 3, folding: folding)
        return (cell.items.map { line($0).color }, cell.more > 0)
    }

    /// 이번 주 자세히: a day's row — its first thing and how many more (K4).
    public static func weekRow(_ day: String, page: CalendarMonth.Page, calendar: Calendar = .paper,
                               language: AppLanguage = .ko) -> (first: Line?, more: Int) {
        let cell = page.cell(day, limit: 1)
        return (cell.items.first.map { line($0, calendar: calendar, language: language) }, cell.more)
    }

    /// 이번 달 자세히: two titles a cell, the rest as +N beside the day's number (K6).
    public static let detailLines = 2
    /// 벽 달력: four (K12).
    public static func lines(_ style: Style) -> Int { style == .wall ? 4 : detailLines }
    public static func monthCell(_ day: String, page: CalendarMonth.Page, style: Style = .detail, calendar: Calendar = .paper,
                                 language: AppLanguage = .ko) -> (lines: [Line], more: Int) {
        // #296: a month cell folds the faded daily · weekday repeats into its head.
        let cell = page.cell(day, limit: lines(style), folding: true)
        return (cell.items.map { line($0, calendar: calendar, language: language) }, cell.more)
    }

    /// 오늘 목록: today and tomorrow, each in time order with its deadlines last (K7).
    public static func agenda(_ today: String, page: CalendarMonth.Page, tasks: [TodoItem], now: Date, calendar: Calendar = .paper,
                              language: AppLanguage = .ko) -> [(day: String, lines: [Line])] {
        [today, CalendarMonth.adding(1, to: today, calendar: calendar)].map {
            ($0, dayLines($0, page: page, tasks: tasks, now: now, calendar: calendar, language: language))
        }
    }

    /// The days a widget's page asks `CalendarMonth.Page` about.
    public static func pageDays(_ kind: Kind, today: String, offset: Int = 0, calendar: Calendar = .paper, language: AppLanguage = .ko) -> [String] {
        switch kind {
        case .today: return [today]
        case .agenda: return [today, CalendarMonth.adding(1, to: today, calendar: calendar)]
        case .week:
            return Array(Set(CalendarMonth.weekDays(CalendarMonth.adding(7 * offset, to: today, calendar: calendar), calendar: calendar,
                                                    language: language) + [today])).sorted()
        case .month:
            let (year, month) = shifted(today, months: offset)
            return Array(Set(CalendarMonth.monthGrid(year: year, month: month, calendar: calendar, language: language) + [today])).sorted()
        }
    }

    /// The month `months` after today's.
    public static func shifted(_ today: String, months: Int) -> (year: Int, month: Int) {
        let p = CalendarMonth.parts(today)
        let index = p.year * 12 + (p.month - 1) + months
        return (index / 12, index % 12 + 1)
    }

    /// 오늘은 비어 있어요 (K9).
    public static func emptyText(_ language: AppLanguage = .ko) -> String {
        ["오늘은 비어 있어요", "Nothing today", "Niets vandaag"][language.index]
    }

    // MARK: The day sheet (busy days)

    /// The day sheet beside the widget (a click on a day, on its +N, or on 오늘 · 오늘 목록's +): every thing of that
    /// day with its time, in `dayLines`' order, and the quick entry below (D1–D3). It lists the whole day, also what is
    /// over, so a busy day can always be read in full.
    public static func sheetLines(_ day: String, page: CalendarMonth.Page, tasks: [TodoItem], now: Date, calendar: Calendar = .paper,
                                  language: AppLanguage = .ko) -> [Line] {
        dayLines(day, page: page, tasks: tasks, now: now, calendar: calendar, language: language)
    }

    /// calendar-flows (11): a day cell's lunar date beside its number — only in a cell at least `lunarCellWidth` wide (the
    /// narrowest desk's cells, ≈57, have room for the number alone: the date pushed the row out of line), and where a +N shares the
    /// number's line only on the lunar month's first day (음 9.1 · 윤 4.1). The day's list and the tooltip still say it.
    public static let lunarCellWidth = 60.0
    public static func showsLunar(lunarDay: Int, cellWidth: Double, moreInHead: Bool) -> Bool {
        guard cellWidth >= lunarCellWidth else { return false }
        return !moreInHead || lunarDay == 1
    }

    /// #295 · #296: what a month cell's head shows, by the widths it takes (pt on the Mac, px on Windows; 0 for what the day
    /// doesn't have): the number, the repeat mark and its count (from two folded repeats), +N, the lunar date and its short
    /// form ("10.1"), each after a `gap`. The first that fits `room`: all; the lunar date short; the mark without its count
    /// (the lunar date kept: it differs every day, the count is in the tooltip and the spoken label); no lunar date; the
    /// number and +N only. The lunar date may already be off by `showsLunar`. Same as Windows (calendarWidget.ts `headFit`).
    public enum HeadLunar: String, Sendable { case full, short, none }
    public static func headFit(room: Double, number: Double, mark: Double, count: Double, more: Double, lunar: Double, short: Double,
                               gap: Double) -> (lunar: HeadLunar, count: Bool, mark: Bool) {
        func width(_ lunarWidth: Double, count shown: Bool, mark drawn: Bool) -> Double {
            number + (drawn && mark > 0 ? gap + mark + (shown ? count : 0) : 0) + (more > 0 ? gap + more : 0) + (lunarWidth > 0 ? gap + lunarWidth : 0)
        }
        let tries: [(HeadLunar, Bool, Bool)] = [(.full, true, true), (.short, true, true), (.full, false, true), (.short, false, true),
                                                (.none, true, true), (.none, false, true), (.none, false, false)]
        for (lunarShown, shown, drawn) in tries {
            let lunarWidth = lunarShown == .full ? lunar : lunarShown == .short ? short : 0
            if lunarShown != .none && lunar <= 0 { continue }
            if width(lunarWidth, count: shown, mark: drawn) <= room + 0.5 {
                return (lunar > 0 ? lunarShown : .none, shown && mark > 0, drawn && mark > 0)
            }
        }
        return (.none, false, false)
    }

    /// The sheet's first line on a holiday (calendar-flows): ‘공휴일’ in the time's column and the holiday's name beside
    /// it, as a month cell's first line is the holiday's name.
    public static func holidayWord(_ language: AppLanguage = .ko) -> String { ["공휴일", "Holiday", "Feestdag"][language.index] }

    /// ⌥← · ⌥→ (Windows Alt+← · Alt+→) in the sheet: the day before or after (D4).
    public static func step(_ day: String, by days: Int, calendar: Calendar = .paper) -> String {
        CalendarMonth.adding(days, to: day, calendar: calendar)
    }

    /// The sheet's heading: "11월 14일 토요일" (the calendar's day title).
    public static func sheetTitle(_ day: String, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String {
        CalendarMonth.dayTitle(day, calendar: calendar, language: language)
    }

    /// The +N's spoken name: "3개 더 보기", "3 more", "nog 3".
    public static func moreLabel(_ count: Int, _ language: AppLanguage = .ko) -> String {
        ["\(count)개 더 보기", "\(count) more", "nog \(count)"][language.index]
    }

    // MARK: Quick entry (#234 Q9, Q10)

    /// What a line typed on a day makes, best first: the input line's reading (`Intent.read`), on the clicked day when
    /// the text names no day (`QuickParse.saysDay`), else on the day it names (read from today). Only to-dos and events
    /// are made here: an alarm becomes a to-do with a reminder at its time (Q4), a timer or a memo is left out (its
    /// to-do reading stays, Q5), and a repeating line stays repeating (Q9). A line that offers no event gets the day's
    /// new event (the desk calendar's 09:00–10:00, or the next half hour today) to Tab to.
    public static func candidates(_ text: String, day: String, now: Date, calendar: Calendar = .paper,
                                  language: AppLanguage = .ko) -> [Intent.Candidate] {
        let read = Intent.read(text, now: now, calendar: calendar, language: language)
        guard !read.isEmpty else { return [] }
        let said = QuickParse.saysDay(text, now: now, calendar: calendar, language: language)
        if case .alarm(let time, _, let label) = read.first {
            let parts = time.split(separator: ":").compactMap { Int($0) }
            let title = label.isEmpty ? text.trimmingCharacters(in: .whitespacesAndNewlines) : label
            let at = calendar.date(bySettingHour: parts.first ?? 9, minute: parts.count > 1 ? parts[1] : 0, second: 0,
                                   of: CalendarMonth.date(day, calendar: calendar))!
            return [.todo(onDay(QuickParse(title: title, reminderAt: at), day: day, now: now, calendar: calendar))]
        }
        var found: [Intent.Candidate] = []
        for candidate in read {
            switch candidate {
            case .todo(let parsed): found.append(.todo(said ? parsed : onDay(parsed, day: day, now: now, calendar: calendar)))
            case .event(var guess):
                if !said && guess.rule == nil { guess.date = day }
                found.append(.event(guess))
            case .repeating: found.append(candidate)
            case .timer, .alarm, .memo: break
            }
        }
        if found.isEmpty { found = [.todo(onDay(QuickParse(title: text.trimmingCharacters(in: .whitespacesAndNewlines)), day: day, now: now, calendar: calendar))] }
        let slashed = Intent.slashKind(text, language: language) != nil
        if !slashed, !found.contains(where: { $0.kind == .event }), case .todo(let parsed)? = found.first(where: { $0.kind == .todo }) {
            let draft = CalendarMonth.draftForDay(todoDay(parsed, now: now, calendar: calendar), now: now, calendar: calendar)
            found.append(.event(Intent.EventGuess(title: parsed.title, date: draft.date, start: draft.startMinutes, end: draft.endMinutes)))
        }
        return found
    }

    /// A to-do read from today, put on `day` instead: its reminder or range at the same clock on that day — never in the
    /// past (then it's due that day without one) — and a to-do with no time due that day (`addParsed`'s `defaultDue`).
    public static func onDay(_ parsed: QuickParse, day: String, now: Date, calendar: Calendar = .paper) -> QuickParse {
        var moved = parsed
        let midnight = CalendarMonth.date(day, calendar: calendar)
        let logicalToday = Archive.dayKey(now, calendar: calendar)
        if let range = parsed.range {
            moved.dueDate = day == logicalToday ? nil : day
            let start = calendar.date(byAdding: .minute, value: range.start, to: midnight)!
            moved.reminderAt = start > now ? start : nil
            if moved.reminderAt == nil && moved.dueDate == nil { moved.dueDate = day }
            return moved
        }
        if let at = parsed.reminderAt {
            let p = calendar.dateComponents([.hour, .minute], from: at)
            let moment = calendar.date(bySettingHour: p.hour!, minute: p.minute!, second: 0, of: midnight)!
            if moment > now {
                moved.reminderAt = moment
                moved.dueDate = nil
            } else {
                moved.reminderAt = nil
                moved.dueDate = day
            }
            return moved
        }
        moved.dueDate = day
        return moved
    }

    /// The day a to-do lands on: its range's or deadline's day, else its reminder's, else today.
    public static func todoDay(_ parsed: QuickParse, now: Date, calendar: Calendar = .paper) -> String {
        if let due = parsed.dueDate { return due }
        if let at = parsed.reminderAt { return CalendarDraft.day(at, calendar: calendar) }
        return CalendarDraft.day(now, calendar: calendar)
    }

    /// The day a candidate lands on (the toast says it).
    public static func day(of candidate: Intent.Candidate, now: Date, calendar: Calendar = .paper) -> String {
        switch candidate {
        case .todo(let parsed): todoDay(parsed, now: now, calendar: calendar)
        case .event(let guess): guess.date
        default: CalendarDraft.day(now, calendar: calendar)
        }
    }

    /// The chip's two halves: the kind's name and when — "할 일" "14일(토) 마감", "할 일" "알림 14일(토) 15:00",
    /// "일정" "14일(토) 15:00–16:00", "일정" "14일(토) 종일"; a repeating one as the input line writes it.
    public static func chipParts(_ candidate: Intent.Candidate, now: Date, calendar: Calendar = .paper,
                                 language: AppLanguage = .ko) -> (kind: String, when: String) {
        let i = language.index
        let today = CalendarDraft.day(now, calendar: calendar)
        func chipDay(_ day: String) -> String { CalendarWidget.chipDay(day, today: today, calendar: calendar, language: language) }
        switch candidate {
        case .todo(let parsed):
            let head = Intent.kindName(.todo, language: language)
            if let range = parsed.range {
                return (head, chipDay(todoDay(parsed, now: now, calendar: calendar)) + " " + range.text(language))
            }
            if let at = parsed.reminderAt {
                return (head, ["알림", "reminder", "herinnering"][i] + " " + chipDay(CalendarDraft.day(at, calendar: calendar))
                        + " " + clock(at, calendar: calendar, language: language))
            }
            if let due = parsed.dueDate {
                let day = chipDay(due)
                return (head, language == .ko ? day + " 마감" : ["", "due ", "deadline "][i] + day)
            }
            return (head, "")
        case .event(let guess) where guess.rule == nil:
            let day = chipDay(guess.date)
            let when = guess.allDay ? (language == .ko ? CalendarDay.allDayText(language) : CalendarDay.allDayText(language).lowercased())
                : language.timeRange(from: (guess.start / 60, guess.start % 60), to: ((guess.end / 60) % 24, guess.end % 60))
            return (Intent.kindName(.event, language: language), day + " " + when)
        default:
            let chip = candidate.chip(language, now: now, calendar: calendar)
            let parts = chip.components(separatedBy: " · ")
            return (parts.first ?? chip, parts.dropFirst().joined(separator: " · "))
        }
    }

    public static func chip(_ candidate: Intent.Candidate, now: Date, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String {
        let parts = chipParts(candidate, now: now, calendar: calendar, language: language)
        return parts.when.isEmpty ? parts.kind : parts.kind + " · " + parts.when
    }

    /// "14일(토)", "Sat 14", "za 14"; another month than today's: "12월 2일(수)", "Wed, Dec 2", "wo 2 dec".
    public static func chipDay(_ day: String, today: String? = nil, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String {
        let p = CalendarMonth.parts(day)
        let weekday = calendar.component(.weekday, from: CalendarMonth.date(day, calendar: calendar)) - 1
        let short = language.weekdayShort(weekday)
        let sameMonth = today.map { CalendarMonth.parts($0).month == p.month && CalendarMonth.parts($0).year == p.year } ?? true
        if sameMonth {
            switch language {
            case .ko: return "\(p.day)일(\(short))"
            case .en: return "\(short) \(p.day)"
            case .nl: return "\(short) \(p.day)"
            }
        }
        return language == .ko ? language.dayMonth(month: p.month, day: p.day) + "(\(short))"
            : language.shortDate(month: p.month, day: p.day, weekday: weekday)
    }

    /// The toast once made (Q8): "{날} {할 일|일정}에 넣었어요" — the day is 오늘 · 내일, a weekday within the week ahead,
    /// else "11월 21일"; en "Added a to-do for Thursday", nl "Taak toegevoegd voor donderdag". 되돌리기 follows.
    public static func addedText(day: String, event: Bool, now: Date, calendar: Calendar = .paper, language: AppLanguage = .ko) -> String {
        let today = calendar.startOfDay(for: now)
        let target = CalendarMonth.date(day, calendar: calendar)
        let offset = calendar.dateComponents([.day], from: today, to: target).day ?? 99
        let p = CalendarMonth.parts(day)
        let when: String
        switch offset {
        case 0, 1: when = language == .ko ? language.dayWord(offset)! : language.dayWord(offset)!.lowercased()
        case 2...6: when = language.weekdayName(calendar.component(.weekday, from: target) - 1)
        default: when = language.dayMonth(month: p.month, day: p.day)
        }
        switch language {
        case .ko: return "\(when) \(event ? "일정" : "할 일")에 넣었어요"
        case .en: return "Added \(event ? "an event" : "a to-do") for \(when)"
        case .nl: return "\(event ? "Afspraak" : "Taak") toegevoegd voor \(when)"
        }
    }

    // MARK: Places (#234 P1–P6)

    /// A rectangle with its origin at the top left and y growing downward (the Mac turns its frames over).
    public struct Rect: Equatable, Sendable {
        public var x: Double, y: Double, width: Double, height: Double
        public init(x: Double, y: Double, width: Double, height: Double) {
            self.x = x; self.y = y; self.width = width; self.height = height
        }
        public var maxX: Double { x + width }
        public var maxY: Double { y + height }
        public func overlaps(_ other: Rect) -> Bool { x < other.maxX && other.x < maxX && y < other.maxY && other.y < maxY }
        func overlap(_ other: Rect) -> Double {
            max(0, min(maxX, other.maxX) - max(x, other.x)) * max(0, min(maxY, other.maxY) - max(y, other.y))
        }
    }

    /// A display: its id and the area a window may use (without the menu bar and the Dock · the taskbar).
    public struct Screen: Equatable, Sendable {
        public var id: String
        public var area: Rect
        public init(id: String, area: Rect) { self.id = id; self.area = area }
    }

    /// The window's frame for a place (P1): on its display, else on the main one (the first) at the same shares (P2).
    /// The remembered display isn't forgotten, so the widget goes back once that display returns (P3).
    public static func frame(_ place: Place, width: Double, height: Double, screens: [Screen]) -> Rect {
        guard let screen = screens.first(where: { $0.id == place.display }) ?? screens.first else {
            return Rect(x: 0, y: 0, width: width, height: height)
        }
        let area = screen.area
        let frame = Rect(x: area.x + share(place.x) * max(0, area.width - width), y: area.y + share(place.y) * max(0, area.height - height),
                         width: width, height: height)
        return inside(frame, area: area)
    }

    /// The place of a frame (where a drag left it): the display it is mostly on, and its shares there.
    public static func place(of frame: Rect, screens: [Screen]) -> Place? {
        guard let screen = screens.max(by: { frame.overlap($0.area) < frame.overlap($1.area) }) ?? screens.first else { return nil }
        let area = screen.area
        func ratio(_ offset: Double, _ room: Double) -> Double { room <= 0 ? 0 : (min(1, max(0, offset / room)) * 10_000).rounded() / 10_000 }
        return Place(display: screen.id, x: ratio(frame.x - area.x, area.width - frame.width), y: ratio(frame.y - area.y, area.height - frame.height))
    }

    /// A frame pushed back inside the area, the whole widget and its ears (P4); one bigger than the area keeps its top left.
    public static func inside(_ frame: Rect, area: Rect) -> Rect {
        var moved = frame
        moved.x = min(max(frame.x, area.x), max(area.x, area.maxX - frame.width))
        moved.y = min(max(frame.y, area.y), max(area.y, area.maxY - frame.height))
        return moved
    }

    /// Where a dropped frame snaps (P5): an edge within 8 pt of the area's edge, or of another widget's edge (beside it,
    /// or lined up with it), goes onto that edge. Then it is pushed inside the area.
    public static let snapDistance = 8.0
    public static func snap(_ frame: Rect, area: Rect, others: [Rect]) -> Rect {
        func nearest(_ value: Double, _ targets: [Double]) -> Double {
            let best = targets.min { abs($0 - value) < abs($1 - value) }
            return best.map { abs($0 - value) <= snapDistance ? $0 : value } ?? value
        }
        var xs = [area.x, area.maxX - frame.width]
        var ys = [area.y, area.maxY - frame.height]
        for other in others {
            // Beside it only when the two are level enough to touch (and lined up only when they're beside each other).
            if frame.y < other.maxY + snapDistance && other.y < frame.maxY + snapDistance {
                xs += [other.maxX, other.x - frame.width]
                ys += [other.y, other.maxY - frame.height]
            }
            if frame.x < other.maxX + snapDistance && other.x < frame.maxX + snapDistance {
                ys += [other.maxY, other.y - frame.height]
                xs += [other.x, other.maxX - frame.width]
            }
        }
        var snapped = frame
        snapped.x = nearest(frame.x, xs)
        snapped.y = nearest(frame.y, ys)
        return inside(snapped, area: area)
    }

    /// A new widget's place (P6): the main display's top right, 16 pt in; below the widgets already there (12 pt apart),
    /// then a column further left once the column is full.
    public static func newPlace(width: Double, height: Double, screen: Screen, others: [Rect]) -> Place {
        let area = screen.area, margin = 16.0, gap = 12.0
        var x = area.maxX - margin - width
        while x >= area.x {
            var y = area.y + margin
            while y + height <= area.maxY {
                let spot = Rect(x: x, y: y, width: width, height: height)
                guard let blocking = others.filter({ $0.overlaps(Rect(x: spot.x - gap / 2, y: spot.y - gap / 2, width: width + gap, height: height + gap)) })
                    .max(by: { $0.maxY < $1.maxY }) else {
                    return place(of: spot, screens: [screen])!
                }
                y = blocking.maxY + gap
            }
            x -= width + gap
        }
        return place(of: Rect(x: area.maxX - margin - width, y: area.y + margin, width: width, height: height), screens: [screen])!
    }

    // MARK: Drawing again (#234 T1–T4)

    /// When a widget must draw again with no change of data: the next midnight, and for 오늘 · 오늘 목록 also the next
    /// time what is still to come changes (an event's start or end, a reminder's time, a range's start or end). One
    /// timer at a time, set again each time — nothing runs while it waits.
    public static func nextRedraw(_ kind: Kind, now: Date, lines: [Line], calendar: Calendar = .paper) -> Date {
        let midnight = calendar.date(byAdding: .day, value: 1, to: calendar.startOfDay(for: now))!
        guard kind == .today || kind == .agenda || kind == .week else { return midnight }
        let moments = lines.flatMap { [$0.at, $0.end] }.compactMap { $0 }.filter { $0 > now && $0 < midnight }
        return moments.min() ?? midnight
    }

    /// After ‹ › nobody touched it for 2 minutes: back to this week · this month (T3).
    public static let backAfter: TimeInterval = 120
    public static func offset(_ offset: Int, touched: Date, now: Date) -> Int {
        now.timeIntervalSince(touched) >= backAfter ? 0 : offset
    }

    /// The day a widget's page is for: today's calendar day at `now` (worked out again on waking and when the time zone
    /// changes, T4).
    public static func today(_ now: Date, calendar: Calendar = .paper) -> String { CalendarDraft.day(now, calendar: calendar) }

    // MARK: Words

    /// "오늘", "이번 주 · 간단히", "이번 달 · 자세히", "오늘 목록" (the desk's rows, the gallery, the settings slip).
    public static func name(_ kind: Kind, _ style: Style, _ language: AppLanguage = .ko) -> String {
        let i = language.index
        let kindName = [
            Kind.today: ["오늘", "Today", "Vandaag"], .week: ["이번 주", "This week", "Deze week"],
            .month: ["이번 달", "This month", "Deze maand"], .agenda: ["오늘 목록", "Today list", "Lijst van vandaag"],
        ][kind]![i]
        guard hasStyles(kind) else { return kindName }
        return kindName + " · " + styleName(style, language)
    }

    public static func styleName(_ style: Style, _ language: AppLanguage = .ko) -> String {
        switch style {
        case .simple: ["간단히", "Simple", "Eenvoudig"][language.index]
        case .detail: ["자세히", "Detailed", "Uitgebreid"][language.index]
        case .wall: ["벽 달력", "Wall calendar", "Wandkalender"][language.index]
        }
    }

    fileprivate static func clock(_ date: Date, calendar: Calendar, language: AppLanguage) -> String {
        let p = calendar.dateComponents([.hour, .minute], from: date)
        return language.clock(hour: p.hour!, minute: p.minute!)
    }
}
