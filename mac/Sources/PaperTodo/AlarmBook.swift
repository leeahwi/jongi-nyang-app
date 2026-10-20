import AppKit
import Combine
import PaperCore

/// 시계 알람, in alarms.json next to todos.json (a shared folder shares them, read again when
/// another device writes, like events). Which rings this Mac already handled stays on this Mac
/// (`alarm.handled`, three days): every running device rings its own.
@MainActor
final class AlarmBook: ObservableObject {
    @Published private(set) var alarms: [Alarm] = []
    @Published private(set) var problem: String?
    /// "<id>@yyyy-MM-ddTHH:mm" of the rings handled here.
    private(set) var handled: Set<String>

    private let preferences: UserDefaults
    private let url: URL
    /// alarms.json as this Mac last read or wrote it; anything else there came from another device.
    private var known: Data?
    private var stopped = false

    init(preferences: UserDefaults, folder: URL) {
        self.preferences = preferences
        url = folder.appendingPathComponent("alarms.json")
        handled = Set(preferences.stringArray(forKey: "alarm.handled") ?? [])
        load()
    }

    // MARK: Reading

    /// By time of day, as the list shows them.
    var sorted: [Alarm] {
        alarms.sorted { ($0.clock.map { $0.hour * 60 + $0.minute } ?? 0, $0.createdAt) < ($1.clock.map { $0.hour * 60 + $0.minute } ?? 0, $1.createdAt) }
    }

    func alarm(_ id: String) -> Alarm? { alarms.first { $0.id == id } }

    /// The soonest ring of the alarms that are on.
    func next(now: Date = Date()) -> (alarm: Alarm, fire: Date)? { Alarm.next(alarms, now: now, handled: handled) }

    // MARK: Changing

    /// `+ 알람 추가`: 07:00 on weekdays, on. Returns its id (to open it for editing).
    @discardableResult
    func add(now: Date = Date()) -> String {
        reloadIfChanged()
        let alarm = Alarm.new(now: now)
        alarms.append(alarm)
        skipPastRing(alarm, now: now)
        save()
        return alarm.id
    }

    /// 입력 줄 (`알람 7시 평일`): an alarm that's on. Returns its id.
    @discardableResult
    func add(time: String, days: [Int], label: String, now: Date = Date()) -> String {
        reloadIfChanged()
        let alarm = Alarm(time: time, label: label, days: days, createdAt: now)
        alarms.append(alarm)
        skipPastRing(alarm, now: now)
        save()
        return alarm.id
    }

    /// The editor's 완료: the alarm as it was edited.
    func update(_ edited: Alarm, now: Date = Date()) {
        reloadIfChanged()
        guard let index = alarms.firstIndex(where: { $0.id == edited.id }) else { return }
        var alarm = edited
        alarm.updatedAt = alarms[index].updatedAt
        guard alarm != alarms[index] else { return }
        alarm.updatedAt = Date(timeIntervalSince1970: now.timeIntervalSince1970.rounded(.down))
        alarms[index] = alarm
        skipPastRing(alarm, now: now)
        save()
    }

    func setEnabled(_ id: String, _ enabled: Bool, now: Date = Date()) {
        guard var alarm = alarm(id), alarm.enabled != enabled else { return }
        alarm.enabled = enabled
        update(alarm, now: now)
    }

    func delete(_ id: String) {
        reloadIfChanged()
        alarms.removeAll { $0.id == id }
        save()
    }

    /// A ring this Mac has shown (or skipped): it doesn't ring again here.
    func markHandled(_ key: String, now: Date = Date()) {
        var kept = Alarm.recentHandled(handled, now: now)
        kept.insert(key)
        handled = kept
        preferences.set(Array(kept).sorted(), forKey: "alarm.handled")
    }

    /// Made or changed here just after its time (say 07:03 for 07:00): that ring is over,
    /// rather than going off the moment it's saved.
    private func skipPastRing(_ alarm: Alarm, now: Date) {
        guard alarm.enabled, let fire = Alarm.lastFire(alarm, now: now), now.timeIntervalSince(fire) < Alarm.lateLimit else { return }
        markHandled(Alarm.key(alarm, fire), now: now)
    }

    // MARK: The file

    private func load() {
        guard let data = try? Data(contentsOf: url) else {
            alarms = []
            known = nil
            return
        }
        do {
            alarms = try Alarm.File.decode(data).alarms
            known = data
            problem = nil
        } catch {
            // Never saved over: the file stays for the person (or another device) to fix.
            problem = L("알람 파일을 읽지 못했어요.") + "\n\(url.path)"
        }
    }

    /// Another device wrote alarms.json (a shared folder is checked every two seconds).
    func reloadIfChanged() {
        guard let data = try? Data(contentsOf: url), data != known else { return }
        load()
    }

    func stopSaving() { stopped = true }

    private func save() {
        guard problem == nil, !stopped else { return }
        let started = PerfProbe.now
        defer { PerfProbe.io("alarms", since: started) }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            let data = try Alarm.File(alarms: alarms).encoded()
            try data.write(to: url, options: .atomic)
            known = data
        } catch {
            problem = L("알람을 저장하지 못했어요.") + "\n\(url.path)"
        }
    }

    // MARK: Snapshots

    func showForSnapshot(_ alarms: [Alarm]) {
        self.alarms = alarms
    }
}
