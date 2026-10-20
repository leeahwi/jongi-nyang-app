import Foundation

/// 타이머 시간 직접 정하기: the length typed for a one-off timer, and the recent ones that come
/// back in every timer menu. Same rules and test cases as the Windows app (duration.ts).
public enum TimerLength {
    /// The fixed choices in every timer menu.
    public static let presets = [5, 15, 25, 50]
    /// From one minute to three hours.
    public static let range = 1...180
    /// How many typed lengths the menus remember.
    public static let recentLimit = 3

    /// Minutes from what was typed, or nil when it isn't a length from 1 minute to 3 hours.
    /// Every language's words are understood whatever `language` is (Hangul and Latin words
    /// don't clash): `40`, `1:30` (h:mm, two-digit minutes), `40분`, `1시간 30분`, `1시간 반`, `40m`,
    /// `40 min`, `90 minutes`, `1h`, `1h 30m`, `1.5h`, `1u`, `1 uur`, `1u 30m`, `anderhalf uur`,
    /// `half uur`, `half an hour`. Case and spaces don't matter. Dutch also takes a decimal comma
    /// (`1,5 uur`). Same rules as the Windows app (duration.ts: parseDuration).
    public static func parseDuration(_ text: String, language: AppLanguage = .ko) -> Int? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            .split(whereSeparator: \.isWhitespace).joined(separator: " ")
        guard !value.isEmpty else { return nil }
        let decimal = language == .nl ? #"[0-9]+(?:[.,][0-9]+)?"# : #"[0-9]+(?:\.[0-9]+)?"#
        func number(_ raw: String) -> Double? { Double(language == .nl ? raw.replacingOccurrences(of: ",", with: ".") : raw) }
        var minutes: Double?
        if let m = match(#"^[0-9]+$"#, value) {
            minutes = Double(m[0])
        } else if let m = match(#"^([0-9]+):([0-9]{2})$"#, value) {
            minutes = Double(m[2])! < 60 ? Double(m[1])! * 60 + Double(m[2])! : nil
        } else if let m = match("^(\(decimal)) ?(?:\(hourWords))$", value) {
            minutes = number(m[1]).map { $0 * 60 }
        } else if let m = match("^([0-9]+) ?(?:\(hourWords)) ?([0-9]+) ?(?:\(minuteWords))?$", value) {
            minutes = Double(m[1])! * 60 + Double(m[2])!
        } else if let m = match(#"^([0-9]+) ?시간 ?반$"#, value) {
            minutes = Double(m[1])! * 60 + 30
        } else if let m = match("^([0-9]+) ?(?:\(minuteWords))$", value) {
            minutes = Double(m[1])
        } else {
            minutes = phrases[value]
        }
        guard let minutes, minutes.isFinite else { return nil }
        let rounded = Int(minutes.rounded())
        return range.contains(rounded) ? rounded : nil
    }

    /// The parsed length as the sheet shows it: ko `40분` · `1시간 30분` · `2시간`, en `40 min` ·
    /// `1 h 30 min`, nl `40 min` · `1 u 30 min`.
    public static func text(_ minutes: Int, language: AppLanguage = .ko) -> String {
        let hours = minutes / 60, rest = minutes % 60
        let (h, m, gap) = switch language {
        case .ko: ("시간", "분", "")
        case .en: ("h", "min", " ")
        case .nl: ("u", "min", " ")
        }
        var parts: [String] = []
        if hours > 0 { parts.append("\(hours)\(gap)\(h)") }
        if rest > 0 || hours == 0 { parts.append("\(rest)\(gap)\(m)") }
        return parts.joined(separator: " ")
    }

    /// The recent list after starting a timer of `minutes`: newest first, at most three, never a
    /// preset (they're in the menu already) or a length out of range.
    public static func remember(_ minutes: Int, in recent: [Int]) -> [Int] {
        guard range.contains(minutes), !presets.contains(minutes) else { return cleaned(recent) }
        return cleaned([minutes] + recent)
    }

    /// A saved list made safe: in range, no presets, no repeats, at most three.
    public static func cleaned(_ recent: [Int]) -> [Int] {
        var seen = Set<Int>()
        return Array(recent.filter { range.contains($0) && !presets.contains($0) && seen.insert($0).inserted }.prefix(recentLimit))
    }

    // MARK: Reading

    private static let hourWords = "시간|hours|hour|hrs|hr|h|uur|u"
    private static let minuteWords = "분|minutes|minute|minuten|minuut|mins|min|m"
    private static let phrases: [String: Double] = [
        "anderhalf uur": 90, "half uur": 30, "een half uur": 30, "een uur": 60, "één uur": 60,
        "half an hour": 30, "an hour": 60, "반시간": 30,
    ]

    /// The whole match and its groups, or nil. (Patterns use [0-9]: only ASCII digits are numbers here.)
    private static func match(_ pattern: String, _ text: String) -> [String]? {
        guard let regex = RegexCache.regex(pattern),
              let result = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)) else { return nil }
        return (0..<result.numberOfRanges).map { index in
            Range(result.range(at: index), in: text).map { String(text[$0]) } ?? ""
        }
    }
}
