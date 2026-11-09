import AppKit
import PaperCore
import SwiftUI

// MARK: - 기기마다 보일 스페이스 in the model (#196, docs/plans/spaces-device.md)

/// What this Mac hides: the rules (`spaces.device`, a device setting), what they hide now (worked out on the minute, on
/// waking and when the time zone changes), and 잠깐 보기. The note leaves hidden to-dos out (its tabs, counts, groups,
/// day strip and timetable); the 오늘 창, the focus card's picks, 저녁 정리, the menu bar, the Dock badge, the cat and the
/// reminders leave them out even while they are peeked at. 완료 기록 shows everything.
extension AppModel {
    // MARK: Reading

    /// The note leaves this to-do out: its space is hidden here and not peeked at.
    func noteHides(_ item: TodoItem) -> Bool {
        !hiddenOnNote.isEmpty && hiddenOnNote.contains(SpaceDevice.key(spaceIndex[item.id]?.id))
    }

    /// This Mac hides this to-do, peeked at or not (the 오늘 창, the menu bar, the cat, the reminders).
    func hidesHere(_ item: TodoItem) -> Bool {
        !hiddenHere.isEmpty && hiddenHere.contains(SpaceDevice.key(spaceIndex[item.id]?.id))
    }

    /// The same by id (찾기's results).
    func hidesHere(id: UUID) -> Bool { !hiddenHere.isEmpty && hiddenHere.contains(SpaceDevice.key(spaceIndex[id]?.id)) }

    /// Today's sheet with nothing left out (the list's export, the desk's counts — D13).
    var allTodayItems: [TodoItem] {
        guard !hiddenOnNote.isEmpty else { return todayItems }
        let now = Date()
        return items.filter { Shelf.page(of: $0, now: now) == .today }
    }

    /// Today's sheet as this Mac shows it outside the note: what it hides is left out even while peeked at.
    var hereTodayItems: [TodoItem] {
        peeked.isEmpty ? todayItems : allTodayItems.filter { !hidesHere($0) }
    }

    /// Every to-do but the ones this Mac hides (저녁 정리, the cat's deadlines).
    var hereItems: [TodoItem] { hiddenHere.isEmpty ? items : items.filter { !hidesHere($0) } }

    /// #274: the repeating to-dos the calendar draws ahead, but the ones whose rule's space this Mac hides.
    var hereSeries: [Series] {
        hiddenHere.isEmpty ? series : series.filter { !hiddenHere.contains(SpaceDevice.key(todoSpaces.seriesSpaceID(of: $0.id))) }
    }

    /// Today's open to-dos outside the note: the menu bar, the Dock badge, the 오늘 창, the periodic reminder.
    var hereRemainingCount: Int { peeked.isEmpty ? remainingCount : hereTodayItems.reduce(0) { $0 + ($1.isCompleted ? 0 : 1) } }

    /// A space's 이 기기에서 (nil: 보이기); `none` for 일반.
    func deviceRule(_ key: String) -> SpaceDevice.Rule? { deviceRules[key] }

    /// Whether a space (`none`: 일반) is hidden on this Mac now.
    func isHiddenHere(_ key: String) -> Bool { hiddenHere.contains(key) }

    /// D9: the spaces the end of a list names — hidden ones with an open to-do there, and the ones peeked at — only while
    /// no lens is on (with a lens, G7's line is the only one).
    func deviceLine(open: [TodoItem]) -> (hidden: [String], peeking: [String]) {
        guard !hiddenHere.isEmpty, spaceShown == .all else { return ([], []) }
        let keys = open.filter { !$0.isCompleted }.map { SpaceDevice.key(spaceIndex[$0.id]?.id) }
        return (SpaceDevice.lineKeys(open: keys, among: hiddenOnNote, spaces: todoSpaces),
                SpaceDevice.lineKeys(open: keys, among: peeked.intersection(hiddenHere), spaces: todoSpaces))
    }

    /// The 오늘 tab's end line.
    var todayDeviceLine: (hidden: [String], peeking: [String]) {
        guard !hiddenHere.isEmpty else { return ([], []) }
        let now = Date()
        return deviceLine(open: items.filter { Shelf.page(of: $0, now: now) == .today })
    }

    /// The 앞으로 tab's end line.
    func aheadDeviceLine(now: Date = Date()) -> (hidden: [String], peeking: [String]) {
        guard !hiddenHere.isEmpty else { return ([], []) }
        return deviceLine(open: items.filter { Ahead.isAhead($0, now: now) })
    }

    /// The names the end line says (일반 by its name).
    func deviceNames(_ keys: [String]) -> [String] {
        keys.map { $0 == SpaceDevice.none ? generalName : todoSpaces.space($0)?.name ?? generalName }
    }

    /// D12: the toast's words when a line put a to-do where this Mac hides it; nil when it shows.
    func addedHiddenText(space: String?) -> String? {
        let key = SpaceDevice.key(todoSpaces.space(space)?.id)
        guard hiddenHere.contains(key) else { return nil }
        return SpaceDevice.added(to: key == SpaceDevice.none ? generalName : todoSpaces.space(key)?.name ?? generalName, .current)
    }

    // MARK: Changing

    /// 이 기기에서 for a space (`none`: 일반): nil 보이기, `.hide`, or `.times`. Made visible (or its times changed), what
    /// came due before stays quiet (D10); its 잠깐 보기 ends (D6).
    func setDeviceRule(_ key: String, _ rule: SpaceDevice.Rule?, now: Date = Date()) {
        let before = deviceRules[key]
        guard before != rule else { return }
        if before != nil, rule != .hide {
            deviceShown[key] = now
            saveDeviceShown(now: now)
        }
        if peeked.contains(key) { setDeviceView(peeked: peeked.subtracting([key])) }
        var rules = deviceRules
        rules[key] = rule
        deviceRules = SpaceDevice.cleaned(rules, spaces: todoSpaces)
    }

    /// 잠깐 보기: the spaces the end line names show on the note until the app quits or 다시 숨기기.
    func peekHidden(_ keys: [String]) {
        setDeviceView(peeked: peeked.union(keys))
    }

    /// 다시 숨기기: every 잠깐 보기 ends.
    func hideAgain() { setDeviceView(peeked: []) }

    private func saveDeviceShown(now: Date) {
        // Two days are enough: older reminders are past the reminder controller's own memory.
        deviceShown = deviceShown.filter { now.timeIntervalSince($0.value) < 2 * 86_400 }
        preferences.set(deviceShown.mapValues(\.timeIntervalSince1970), forKey: "spaces.deviceShown")
    }

    // MARK: Reminders (D10)

    /// Whether this to-do's reminder rings on this Mac: its space shows now and showed at the reminder's time, and the
    /// reminder isn't from before the space was made visible here.
    func reminderRingsHere(_ item: TodoItem, now: Date = Date()) -> Bool {
        guard let alert = item.reminderAt, !deviceRules.isEmpty || !deviceShown.isEmpty, !todoSpaces.isEmpty else { return true }
        let key = SpaceDevice.key(spaceIndex[item.id]?.id)
        return SpaceDevice.rings(deviceRules[key], alert: alert, now: now, shownSince: deviceShown[key])
    }

    // MARK: The clock (D4)

    /// At launch: the rules, when each was made visible, and the clock.
    func loadSpaceDevice() {
        deviceRules = SpaceDevice.decode(preferences.data(forKey: "spaces.device"))
        let shown = preferences.dictionary(forKey: "spaces.deviceShown") as? [String: Double] ?? [:]
        deviceShown = shown.mapValues { Date(timeIntervalSince1970: $0) }
        refreshDeviceHidden()
        guard deviceObservers.isEmpty else { return }
        let again: @Sendable (Notification) -> Void = { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.deviceClock?.invalidate()
                self?.deviceClock = nil
                self?.refreshDeviceHidden()
            }
        }
        deviceObservers = [
            NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main, using: again),
            NotificationCenter.default.addObserver(forName: .NSSystemTimeZoneDidChange, object: nil, queue: .main, using: again),
            NotificationCenter.default.addObserver(forName: .NSSystemClockDidChange, object: nil, queue: .main, using: again),
        ]
    }

    /// What the rules hide now; a lens on a space that just went hidden lets go (D7). Draws again only on a change.
    func refreshDeviceHidden(now: Date = Date()) {
        let hidden = SpaceDevice.hidden(deviceRules, spaces: todoSpaces, at: now)
        setDeviceView(hidden: hidden)
        if let lens = spaceLens, hiddenOnNote.contains(lens.spaceId) { spaceLens = nil }
        armDeviceClock(now: now)
    }

    /// A tick on each minute while a time rule is set (none otherwise, so an idle Mac does nothing).
    private func armDeviceClock(now: Date) {
        let timed = deviceRules.values.contains { if case .times = $0 { true } else { false } }
        guard timed else {
            deviceClock?.invalidate()
            deviceClock = nil
            return
        }
        guard deviceClock == nil else { return }
        let next = Date(timeIntervalSince1970: (now.timeIntervalSince1970 / 60).rounded(.down) * 60 + 60.2)
        let timer = Timer(fire: next, interval: 60, repeats: true) { [weak self] _ in
            Task { @MainActor [weak self] in self?.refreshDeviceHidden() }
        }
        timer.tolerance = 1
        RunLoop.main.add(timer, forMode: .common)
        deviceClock = timer
    }
}
