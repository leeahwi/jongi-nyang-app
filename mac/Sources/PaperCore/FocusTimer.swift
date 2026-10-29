import Foundation

/// Pomodoro lengths. Defaults follow the classic technique: 25 minutes of focus, 5 of rest,
/// and a longer 15-minute rest after every 4 focus rounds.
public struct PomodoroSettings: Codable, Equatable, Sendable {
    public var focusMinutes: Int
    public var restMinutes: Int
    public var longRestMinutes: Int
    public var roundsBeforeLongRest: Int

    public init(focusMinutes: Int = 25, restMinutes: Int = 5, longRestMinutes: Int = 15, roundsBeforeLongRest: Int = 4) {
        self.focusMinutes = focusMinutes
        self.restMinutes = restMinutes
        self.longRestMinutes = longRestMinutes
        self.roundsBeforeLongRest = roundsBeforeLongRest
    }
}

public enum FocusPhase: String, Codable, Sendable {
    /// A one-off countdown
    case timer
    case focus
    case rest
    case longRest
}

/// A countdown the pet holds up. Pure value type: every question is answered for a given
/// `now`, so it survives sleep, relaunch (it's Codable) and is easy to test.
public struct FocusTimer: Codable, Equatable, Sendable {
    public private(set) var phase: FocusPhase
    public private(set) var duration: TimeInterval
    /// Set while running; nil while paused.
    public private(set) var endsAt: Date?
    /// Set while paused.
    public private(set) var pausedRemaining: TimeInterval?
    /// Finished focus rounds in this Pomodoro session.
    public private(set) var completedRounds: Int
    public private(set) var pomodoro: PomodoroSettings?

    public static func countdown(minutes: Int, now: Date) -> FocusTimer {
        let duration = TimeInterval(max(1, minutes) * 60)
        return FocusTimer(phase: .timer, duration: duration, endsAt: now.addingTimeInterval(duration), pausedRemaining: nil, completedRounds: 0, pomodoro: nil)
    }

    public static func pomodoro(_ settings: PomodoroSettings, now: Date) -> FocusTimer {
        let duration = TimeInterval(max(1, settings.focusMinutes) * 60)
        return FocusTimer(phase: .focus, duration: duration, endsAt: now.addingTimeInterval(duration), pausedRemaining: nil, completedRounds: 0, pomodoro: settings)
    }

    public var isPaused: Bool { endsAt == nil }

    public func remaining(at now: Date) -> TimeInterval {
        if let pausedRemaining { return pausedRemaining }
        return max(0, endsAt!.timeIntervalSince(now))
    }

    /// 1 when a phase starts, 0 when it ends — the size of the shrinking disc.
    public func fraction(at now: Date) -> Double {
        duration > 0 ? remaining(at: now) / duration : 0
    }

    public func isFinished(at now: Date) -> Bool { !isPaused && remaining(at: now) <= 0 }

    public mutating func pause(at now: Date) {
        guard !isPaused else { return }
        pausedRemaining = remaining(at: now)
        endsAt = nil
    }

    public mutating func resume(at now: Date) {
        guard let pausedRemaining else { return }
        endsAt = now.addingTimeInterval(pausedRemaining)
        self.pausedRemaining = nil
    }

    /// Adds (or with a negative value, removes) minutes to the current phase.
    public mutating func adjust(minutes: Int, at now: Date) {
        let change = TimeInterval(minutes * 60)
        duration = max(60, duration + change)
        if let pausedRemaining { self.pausedRemaining = min(duration, max(0, pausedRemaining + change)) }
        if let endsAt { self.endsAt = max(now, endsAt.addingTimeInterval(change)) }
    }

    /// 5분 더: like `adjust`, but once the time is up the extra minutes run from `now` (the minutes
    /// already run stay counted, the time the card waited for a button doesn't).
    public mutating func extend(minutes: Int, at now: Date) {
        guard isFinished(at: now) else { return adjust(minutes: minutes, at: now) }
        let change = TimeInterval(max(1, minutes) * 60)
        duration += change
        endsAt = now.addingTimeInterval(change)
    }

    /// How long this phase has run so far (pauses left out).
    public func elapsed(at now: Date) -> TimeInterval { max(0, duration - remaining(at: now)) }

    /// The next Pomodoro phase after this one ends (starting at `now`), or nil for a one-off timer.
    public func next(at now: Date) -> FocusTimer? {
        guard let pomodoro else { return nil }
        var next = self
        switch phase {
        case .focus:
            next.completedRounds += 1
            let long = next.completedRounds % max(1, pomodoro.roundsBeforeLongRest) == 0
            next.phase = long ? .longRest : .rest
            next.duration = TimeInterval(max(1, long ? pomodoro.longRestMinutes : pomodoro.restMinutes) * 60)
        case .rest, .longRest, .timer:
            next.phase = .focus
            next.duration = TimeInterval(max(1, pomodoro.focusMinutes) * 60)
        }
        next.endsAt = now.addingTimeInterval(next.duration)
        next.pausedRemaining = nil
        return next
    }

    /// "24:13", or "1:02:05" past an hour; rounds up so a timer never shows 0:00 while running.
    public static func clock(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded(.up))
        let hours = total / 3600, minutes = (total % 3600) / 60, rest = total % 60
        return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, rest) : String(format: "%02d:%02d", minutes, rest)
    }

    /// #46: the time left as a length, never in a clock's form ("20:50" beside "다음 일정 20:40" read as 8:50 PM).
    /// Whole minutes rounded up ("21분" · "21 min" for 20:50), from an hour with its minutes ("1시간 5분" · "1 h 5 min" ·
    /// "1 u 5 min", "1시간" on the hour), the last minute in seconds ("45초" · "45 sec"). The day strip's rule (#19).
    /// Same as glance.ts `timerLength`.
    public static func lengthText(_ seconds: TimeInterval, language: AppLanguage) -> String {
        let total = Int(max(0, seconds).rounded(.up))
        if total < 60 { return ["\(total)초", "\(total) sec", "\(total) sec"][language.index] }
        let minutes = (total + 59) / 60
        let h = minutes / 60, m = minutes % 60
        let rest = ["\(m)분", "\(m) min", "\(m) min"][language.index]
        if h == 0 { return rest }
        let hours = ["\(h)시간", "\(h) h", "\(h) u"][language.index]
        return m == 0 ? hours : hours + " " + rest
    }

    /// The small word beside the length on the timer card: "남음" · "left" after it, Dutch "nog" before it
    /// ("nog 21 min" — "21 min te gaan" didn't fit a third of the 오늘 창).
    public static func leftWord(_ language: AppLanguage) -> String { ["남음", "left", "nog"][language.index] }
    public static func leftWordFirst(_ language: AppLanguage) -> Bool { language == .nl }

    /// Said in full: "21분 남음" · "21 min left" · "nog 21 min".
    public static func leftText(_ seconds: TimeInterval, language: AppLanguage) -> String {
        let length = lengthText(seconds, language: language)
        return leftWordFirst(language) ? leftWord(language) + " " + length : length + " " + leftWord(language)
    }

    /// Board caption: "집중 2/4", "휴식", "긴 휴식", "타이머".
    public var caption: String { caption(.ko) }

    /// en "Focus 2/4", "Break", "Long break", "Timer"; nl "Focus 2/4", "Pauze", "Lange pauze", "Timer".
    public func caption(_ language: AppLanguage) -> String {
        guard phase == .focus else { return phaseName(language) }
        let rounds = max(1, pomodoro?.roundsBeforeLongRest ?? 4)
        return "\(phaseName(language)) \(completedRounds % rounds + 1)/\(rounds)"
    }

    /// The phase pill: "집중", "휴식", "긴 휴식", "타이머" (Windows: phaseName).
    public func phaseName(_ language: AppLanguage = .ko) -> String {
        let names: [String] = switch language {
        case .ko: ["타이머", "집중", "휴식", "긴 휴식"]
        case .en: ["Timer", "Focus", "Break", "Long break"]
        case .nl: ["Timer", "Focus", "Pauze", "Lange pauze"]
        }
        switch phase {
        case .timer: return names[0]
        case .focus: return names[1]
        case .rest: return names[2]
        case .longRest: return names[3]
        }
    }
}
