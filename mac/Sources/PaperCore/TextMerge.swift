import Foundation

/// Joins two edits of one memo made on two devices from the same starting text (`base`).
/// Lines changed on only one side take that side; a line both sides changed is merged
/// character by character when the edits don't touch the same spot; text both sides added at
/// the same place keeps both (this device's first); anything else keeps both versions of the
/// lines, so nothing typed is lost. Same steps as the Windows app (textMerge.ts).
public enum TextMerge {
    public static func merge(base: String, ours: String, theirs: String) -> String {
        if ours == theirs || theirs == base { return ours }
        if ours == base { return theirs }
        let lines = { (text: String) in text.components(separatedBy: "\n") }
        let merged = diff3(lines(base), lines(ours), lines(theirs)) { o, a, b in
            if o.isEmpty { return a + b }
            if let joined = mergeCharacters(o.joined(separator: "\n"), a.joined(separator: "\n"), b.joined(separator: "\n")) {
                return joined.components(separatedBy: "\n")
            }
            return keepBoth(a, b)
        }
        return (merged ?? keepBoth(lines(ours), lines(theirs))).joined(separator: "\n")
    }

    /// Both versions of lines that couldn't be joined: this device's, then the other's lines it
    /// doesn't already have, without blank lines when there is any text.
    private static func keepBoth(_ ours: [String], _ theirs: [String]) -> [String] {
        let both = ours + theirs.filter { !ours.contains($0) }
        let written = both.filter { !$0.isEmpty }
        return written.isEmpty ? both : written
    }

    /// Where a caret (a UTF-16 offset, as in a text view) belongs once `old` became `new`: when
    /// the change lies after it, it stays; when before it, it moves along with the text.
    /// Same steps as movedCaret in the Windows app.
    public static func caret(_ caret: Int, from old: String, to new: String) -> Int {
        let a = Array(old.utf16), b = Array(new.utf16)
        var prefix = 0
        while prefix < a.count && prefix < b.count && a[prefix] == b[prefix] { prefix += 1 }
        var suffix = 0
        while suffix < a.count - prefix && suffix < b.count - prefix && a[a.count - 1 - suffix] == b[b.count - 1 - suffix] { suffix += 1 }
        if caret <= prefix { return caret }
        if caret >= a.count - suffix { return max(0, b.count - (a.count - caret)) }
        return max(0, min(b.count, caret + b.count - a.count))
    }

    /// Within lines both sides changed: works only when the edits are apart (or both insert at
    /// one spot); nil when they replace the same characters differently.
    private static func mergeCharacters(_ base: String, _ ours: String, _ theirs: String) -> String? {
        let scalars = { (text: String) in Array(text.unicodeScalars) }
        guard let merged = diff3(scalars(base), scalars(ours), scalars(theirs), conflict: { o, a, b in o.isEmpty ? a + b : nil }) else { return nil }
        var text = String.UnicodeScalarView()
        text.append(contentsOf: merged)
        return String(text)
    }

    /// Walks the base: stretches kept by both sides stay; between them, the side that changed
    /// wins, equal changes count once, and real overlaps go to `conflict` (nil gives up).
    static func diff3<T: Equatable>(_ o: [T], _ a: [T], _ b: [T], conflict: ([T], [T], [T]) -> [T]?) -> [T]? {
        let inA = matches(o, a), inB = matches(o, b)
        var out: [T] = []
        var io = 0, ia = 0, ib = 0
        while true {
            var k = io
            while k < o.count && (inA[k] < 0 || inB[k] < 0) { k += 1 }
            let ea = k < o.count ? inA[k] : a.count
            let eb = k < o.count ? inB[k] : b.count
            let oPart = Array(o[io..<k]), aPart = Array(a[ia..<ea]), bPart = Array(b[ib..<eb])
            if aPart == oPart { out += bPart } else if bPart == oPart || aPart == bPart { out += aPart } else {
                guard let resolved = conflict(oPart, aPart, bPart) else { return nil }
                out += resolved
            }
            if k >= o.count { return out }
            out.append(o[k])
            io = k + 1; ia = ea + 1; ib = eb + 1
        }
    }

    /// For each element of `o`, where it sits in `x` along a longest common subsequence, or -1.
    /// The shared start and end are matched directly; a very long middle is left unmatched.
    static func matches<T: Equatable>(_ o: [T], _ x: [T]) -> [Int] {
        var result = Array(repeating: -1, count: o.count)
        var start = 0
        while start < o.count && start < x.count && o[start] == x[start] { result[start] = start; start += 1 }
        var endO = o.count, endX = x.count
        while endO > start && endX > start && o[endO - 1] == x[endX - 1] { endO -= 1; endX -= 1; result[endO] = endX }
        let n = endO - start, m = endX - start
        guard n > 0, m > 0, n * m <= 2_000_000 else { return result }
        // lengths[i][j]: longest common subsequence of o[start+i..<endO] and x[start+j..<endX].
        var lengths = Array(repeating: 0, count: (n + 1) * (m + 1))
        for i in stride(from: n - 1, through: 0, by: -1) {
            for j in stride(from: m - 1, through: 0, by: -1) {
                lengths[i * (m + 1) + j] = o[start + i] == x[start + j]
                    ? lengths[(i + 1) * (m + 1) + j + 1] + 1
                    : max(lengths[(i + 1) * (m + 1) + j], lengths[i * (m + 1) + j + 1])
            }
        }
        var i = 0, j = 0
        while i < n && j < m {
            if o[start + i] == x[start + j] {
                result[start + i] = start + j; i += 1; j += 1
            } else if lengths[(i + 1) * (m + 1) + j] >= lengths[i * (m + 1) + j + 1] {
                i += 1
            } else {
                j += 1
            }
        }
        return result
    }
}
