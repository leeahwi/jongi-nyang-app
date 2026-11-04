import Foundation

/// 찾기의 `#스페이스` (spaces 2c, C1–C3): the search's words read for a space, and the `Search.Only` that keeps to it.
/// Apart from TodoSpaces.swift so the tests that build the spaces without the search needn't build it.
extension Search {
    /// What a search's words mean for spaces (C1, C2): the words to look for, and the space to keep to — none when the
    /// query has no `#` naming a space or 일반 (then the whole query is looked for as it is, `#` and all), or when there
    /// are no spaces at all (M2).
    public struct SpaceReading: Equatable, Sendable {
        public var words: String
        /// nil: no space; `.some(nil)` is 일반.
        public var space: String??
    }

    public static func spaceReading(_ query: String, spaces: TodoSpaces) -> SpaceReading {
        let whole = SpaceReading(words: query.trimmingCharacters(in: .whitespacesAndNewlines), space: nil)
        guard !spaces.isEmpty, let token = SpaceToken.find(query) else { return whole }
        let words = SpaceToken.removing(token, from: query).trimmingCharacters(in: .whitespacesAndNewlines)
        switch SpaceToken.choices(token.name, in: spaces).first {
        case .space(let id)?: return SpaceReading(words: words, space: .some(id))
        case .noSpace?: return SpaceReading(words: words, space: .some(nil))
        case .new?, nil: return whole
        }
    }

    /// The `only` for `find`: to-dos by their place, record lines by C5 — nil without a space in the query.
    public static func only(_ reading: SpaceReading, spaces: TodoSpaces) -> Only? {
        guard case .some(let space) = reading.space else { return nil }
        return Only(space: space, item: { spaces.spaceID(of: $0) }, entry: { spaces.spaceID(of: $0) })
    }
}
