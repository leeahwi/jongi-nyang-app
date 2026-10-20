import Foundation

/// Line breaks for the cat's speech bubbles: between sentences rather than wherever the width runs
/// out ("첫 번째 체크가 제일 어려워요." / "할 수 있어요!"), and a sentence too long for one line
/// is cut after a comma, or else at the space nearest its middle so the two lines come out even —
/// never inside ‘quotes’ (a task's name). Breaks written into a line (\n) are kept. Same steps as
/// the Windows app (bubbleText.ts).
public enum BubbleText {
    /// About how many characters fit on one line of a bubble.
    public static let lineLimit = 18
    private static let sentenceEnds: Set<Character> = [".", "!", "?", "…", "~"]

    /// About how many characters fit on one line in English and Dutch (Latin letters are about half as wide).
    public static let latinLineLimit = 28

    public static func wrap(_ text: String, limit: Int = lineLimit) -> String {
        text.components(separatedBy: "\n").map { wrapPart($0, limit: limit) }.joined(separator: "\n")
    }

    /// In English and Dutch lines break only at spaces: between sentences when they fit, else
    /// after a comma, else at the space that evens the lines out — never inside a word or a quote
    /// (‘…’, “…”; an apostrophe as in I’m doesn't close one). Long sentences take as many lines as
    /// they need. Korean keeps its own steps.
    public static func wrap(_ text: String, language: AppLanguage) -> String {
        guard language != .ko else { return wrap(text) }
        return text.components(separatedBy: "\n").map { latinPart($0, limit: latinLineLimit) }.joined(separator: "\n")
    }

    private static func latinPart(_ text: String, limit: Int) -> String {
        let characters = Array(text)
        guard characters.count > limit else { return text }
        // Sentences: up to . ! ? … followed by a space.
        var sentences: [[Character]] = []
        var current: [Character] = []
        var index = 0
        while index < characters.count {
            current.append(characters[index])
            if latinEnds.contains(characters[index]), index + 1 < characters.count, characters[index + 1] == " " {
                sentences.append(current)
                current = []
                index += 1
            }
            index += 1
        }
        if !current.isEmpty { sentences.append(current) }
        // Sentences share a line when they fit; a long one is spread over lines, and its last
        // piece may still take the next sentence.
        var lines: [[Character]] = []
        var line: [Character] = []
        for sentence in sentences {
            if !line.isEmpty && line.count + 1 + sentence.count <= limit {
                line += [" "] + sentence
                continue
            }
            if !line.isEmpty { lines.append(line) }
            let pieces = latinBreak(sentence, limit: limit)
            lines += pieces.dropLast()
            line = pieces.last ?? []
        }
        if !line.isEmpty { lines.append(line) }
        return lines.map { String($0) }.joined(separator: "\n")
    }

    private static let latinEnds: Set<Character> = [".", "!", "?", "…"]

    /// One sentence over as few lines as it needs, each break at a space outside quotes: after a
    /// comma when the first line then fits and the rest still fits in the lines left, otherwise at
    /// the space nearest an even share (the earlier one on a tie) that keeps the first line short enough.
    private static func latinBreak(_ line: [Character], limit: Int) -> [[Character]] {
        guard line.count > limit else { return [line] }
        var spaces: [Int] = []
        var quoted = false
        for (index, character) in line.enumerated() {
            let next: Character? = index + 1 < line.count ? line[index + 1] : nil
            if character == "‘" || character == "“" { quoted = true }
            else if character == "”" || (character == "’" && !(next?.isLetter ?? false)) { quoted = false }
            else if character == " " && !quoted { spaces.append(index) }
        }
        let count = (line.count + limit) / (limit + 1) // lines needed at best
        let target = Double(line.count) / Double(max(2, count))
        let fitting = spaces.filter { $0 <= limit && $0 > 0 }
        let rest = { (space: Int) in line.count - space - 1 }
        let commas = fitting.filter { line[$0 - 1] == "," && rest($0) <= limit * (max(2, count) - 1) }
        let nearest = { (candidates: [Int]) -> Int? in candidates.min { abs(Double($0) - target) < abs(Double($1) - target) } }
        guard let split = nearest(commas) ?? nearest(fitting) ?? spaces.first else { return [line] }
        return [Array(line[..<split])] + latinBreak(Array(line[(split + 1)...]), limit: limit)
    }

    private static func wrapPart(_ text: String, limit: Int) -> String {
        guard text.count > limit else { return text }
        var sentences: [String] = []
        var current = ""
        let characters = Array(text)
        var index = 0
        while index < characters.count {
            let character = characters[index]
            current.append(character)
            if sentenceEnds.contains(character), index + 1 < characters.count, characters[index + 1] == " " {
                sentences.append(current)
                current = ""
                index += 1 // the space between sentences
            }
            index += 1
        }
        if !current.isEmpty { sentences.append(current) }

        var lines: [String] = []
        var line = ""
        for sentence in sentences {
            if line.isEmpty {
                line = sentence
            } else if line.count + 1 + sentence.count <= limit {
                line += " " + sentence
            } else {
                lines.append(line)
                line = sentence
            }
        }
        if !line.isEmpty { lines.append(line) }
        return lines.flatMap { $0.count > limit ? halves($0) : [$0] }.joined(separator: "\n")
    }

    /// One long sentence in two: after the comma nearest the middle when both halves then fit,
    /// otherwise at the space nearest the middle (the earlier one on a tie). Spaces inside ‘…’
    /// don't count.
    private static func halves(_ line: String) -> [String] {
        let characters = Array(line)
        let middle = Double(characters.count) / 2
        var spaces: [Int] = []
        var quoted = false
        for (index, character) in characters.enumerated() {
            if character == "‘" { quoted = true } else if character == "’" { quoted = false } else if character == " " && !quoted { spaces.append(index) }
        }
        let nearest = { (candidates: [Int]) -> Int? in
            candidates.min { abs(Double($0) - middle) < abs(Double($1) - middle) }
        }
        let limit = lineLimit
        let commas = spaces.filter { $0 > 0 && characters[$0 - 1] == "," && $0 <= limit && characters.count - $0 - 1 <= limit }
        guard let split = nearest(commas) ?? nearest(spaces) else { return [line] }
        return [String(characters[..<split]), String(characters[(split + 1)...])]
    }
}
