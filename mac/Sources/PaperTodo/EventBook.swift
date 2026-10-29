import AppKit
import Combine
import PaperCore

/// 일정: the app's own events, in events.json next to todos.json (a shared folder shares them,
/// read again when another device writes, like memos). The strip, the alerts, the 달력 window
/// and the cat all read the dated occurrences from here.
@MainActor
final class EventBook: ObservableObject {
    @Published private(set) var events: [LocalEvent] = []
    @Published var showsStrip: Bool { didSet { preferences.set(showsStrip, forKey: "calendar.strip") } }
    /// 하루 띠 (1.40): the day ("yyyy-MM-dd", 4 a.m. rule) whose strip is opened into the whole day; the next day
    /// starts closed again.
    @Published var openDay: String? { didSet { preferences.set(openDay, forKey: "calendar.openDay") } }
    /// Minutes before an event to show it in a bubble; 0 = off.
    @Published var alertMinutes: Int { didSet { preferences.set(alertMinutes, forKey: "calendar.alertMinutes") } }
    /// The event sheet open over the strip (new, change, remove, or a quick-entry event to finish).
    @Published var sheet: CalendarSheetRequest?
    /// Asks the 달력 window to show this day ("yyyy-MM-dd").
    @Published var windowDay: String?
    @Published private(set) var problem: String?

    static let alertChoices = [0, 5, 10, 15, 30]

    private let preferences: UserDefaults
    private let url: URL
    /// events.json as this Mac last read or wrote it; anything else there came from another device.
    private var known: Data?

    init(preferences: UserDefaults, folder: URL) {
        self.preferences = preferences
        url = folder.appendingPathComponent("events.json")
        showsStrip = preferences.object(forKey: "calendar.strip") == nil ? true : preferences.bool(forKey: "calendar.strip")
        openDay = preferences.string(forKey: "calendar.openDay")
        // Until 1.39: today's event list under the ribbon, open or folded (the whole day replaces it).
        preferences.removeObject(forKey: "calendar.stripCollapsed")
        alertMinutes = preferences.object(forKey: "calendar.alertMinutes") == nil ? 10 : preferences.integer(forKey: "calendar.alertMinutes")
        load()
    }

    // MARK: Reading

    var hasEvents: Bool { !events.isEmpty }
    var lastColor: LocalEvent.Color { LocalEvent.Color(rawValue: preferences.string(forKey: "calendar.lastColor") ?? "") ?? .blue }

    /// Every occurrence in [from, to).
    func occurrences(from: Date, to: Date) -> [CalendarEvent] { LocalEvent.expand(events, from: from, to: to, language: .current) }

    /// Yesterday to a month ahead: for alerts and the cat.
    var visibleEvents: [CalendarEvent] {
        let (dayStart, _) = CalendarDay.window(Date())
        return occurrences(from: Calendar.paper.date(byAdding: .day, value: -1, to: dayStart)!,
                           to: Calendar.paper.date(byAdding: .day, value: 31, to: dayStart)!)
    }

    /// Today's sheet (4 a.m. to 4 a.m.).
    func todayEvents(now: Date) -> [CalendarEvent] {
        let (start, end) = CalendarDay.window(now)
        return CalendarDay.today(occurrences(from: Calendar.paper.date(byAdding: .day, value: -1, to: start)!, to: end), now: now)
    }

    func event(_ id: String) -> LocalEvent? { events.first { $0.id == id } }

    /// The 하루 띠 is opened into the whole day today.
    func isDayOpen(now: Date) -> Bool { openDay == Archive.dayKey(now) }

    func setDayOpen(_ open: Bool, now: Date) { openDay = open ? Archive.dayKey(now) : nil }

    /// Put on the calendar from this to-do.
    func isSent(_ taskID: UUID) -> Bool { events.contains { $0.taskId == taskID.uuidString } }

    // MARK: Changing

    enum Change {
        case create(CalendarDraft)
        case update(String, CalendarDraft)
        case delete(String)
        /// 이 날만 지우기: one day out of a repeating event.
        case skip(String, day: String)
        /// AI 연결's undo (1.42): an event put back as it was (replaced, or added again).
        case put(LocalEvent)
    }

    /// Set by the app: an event changed here (not by Claude's undo) loses its AI stamp.
    var onEdited: ((String) -> Void)?

    /// Returns the new event's id when one was made.
    @discardableResult
    func perform(_ change: Change, now: Date = Date()) -> String? {
        AIWriteLock.with { performHeld(change, now: now) }
    }

    private func performHeld(_ change: Change, now: Date) -> String? {
        reloadIfChanged()
        var made: String?
        switch change {
        case .create(let draft):
            let id = UUID().uuidString
            events.append(draft.event(id: id, now: now))
            made = id
            preferences.set(draft.color.rawValue, forKey: "calendar.lastColor")
        case .update(let id, let draft):
            guard let index = events.firstIndex(where: { $0.id == id }) else { return nil }
            events[index] = draft.event(id: id, now: now, existing: events[index])
            preferences.set(draft.color.rawValue, forKey: "calendar.lastColor")
            onEdited?(id)
        case .delete(let id):
            events.removeAll { $0.id == id }
            onEdited?(id)
        case .skip(let id, let day):
            guard let index = events.firstIndex(where: { $0.id == id }), !events[index].skip.contains(day) else { return nil }
            events[index].skip.append(day)
            events[index].updatedAt = now
            onEdited?(id)
        case .put(let event):
            if let index = events.firstIndex(where: { $0.id == event.id }) { events[index] = event } else { events.append(event) }
        }
        save()
        return made
    }

    // MARK: The file

    private func load() {
        guard let data = try? Data(contentsOf: url) else {
            events = []
            known = nil
            return
        }
        do {
            events = try Self.decoder.decode(LocalEvent.File.self, from: data).events
            known = data
            problem = nil
        } catch {
            // Never saved over: the file stays for the person (or another device) to fix.
            problem = L("일정 파일을 읽지 못했어요.") + "\n\(url.path)"
        }
    }

    /// Another device wrote events.json (a shared folder is checked every two seconds).
    func reloadIfChanged() {
        guard let data = try? Data(contentsOf: url), data != known else { return }
        load()
    }

    private var stopped = false
    func stopSaving() { stopped = true }

    private func save() {
        guard problem == nil, !stopped else { return }
        let started = PerfProbe.now
        defer { PerfProbe.io("events", since: started) }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try Self.encoder.encode(LocalEvent.File(events: events))
            try data.write(to: url, options: .atomic)
            known = data
        } catch {
            problem = L("일정을 저장하지 못했어요.") + "\n\(url.path)"
        }
    }

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return encoder
    }()

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }()

    // MARK: Leftovers of the Google connection (until 1.30)

    /// Tokens, the event copy and the Tasks record go; nothing of an old connection stays.
    static func removeLegacy(preferences: UserDefaults) {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Bundle.main.bundleIdentifier ?? "com.noa.PaperTodo", isDirectory: true)
        for name in ["google.json", "calendar-cache.json", "tasks-sync.json"] {
            try? FileManager.default.removeItem(at: folder.appendingPathComponent(name))
        }
        for key in ["calendar.email", "calendar.hidden", "calendar.sent", "calendar.lastCalendar", "calendar.tasksSync",
                    "calendar.tasksList", "calendar.apple"] {
            preferences.removeObject(forKey: key)
        }
    }

    // MARK: Snapshots

    func showForSnapshot(_ events: [LocalEvent]) {
        self.events = events
    }
}
