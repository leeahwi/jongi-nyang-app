import Foundation

/// 글꼴 설정 (#141, docs/plans/settings-plan.md F1 · F2): the size steps of the note and the drawer, how a 1.45 setting
/// reads into them, and the drawer's line and paragraph spacing — the same numbers as the Windows app (textSteps.ts;
/// the shared cases in docs/plans/settings-cases.json). Device settings only, never in the shared folder or a backup.
public enum TextSteps {
    // MARK: The note (노트 글꼴)

    /// Seven steps that all still fit the 44 pt ruled line; 1.45's four (작게 · 보통 · 크게 · 아주 크게) are the 1st,
    /// 3rd, 5th and 7th, so no one's size changes.
    public static let noteScales: [Double] = [0.87, 0.93, 1, 1.07, 1.13, 1.2, 1.26]
    public static let noteDefault = 2
    /// 1.45's `textSize` → its step.
    public static let noteLegacy: [String: Int] = ["small": 0, "regular": 2, "large": 4, "extraLarge": 6]

    /// The step a saved note setting means: `textStep` if this version wrote it, else 1.45's `textSize`, else 보통.
    public static func noteStep(saved step: Int?, legacy: String?) -> Int {
        if let step, noteScales.indices.contains(step) { return step }
        return legacy.flatMap { noteLegacy[$0] } ?? noteDefault
    }

    /// What 1.45's `textSize` gets beside `textStep` (an older version reads it): the nearest of its four sizes.
    public static func noteLegacyName(_ step: Int) -> String {
        nearest(noteScales[clampNote(step)], in: noteLegacy.map { ($0.key, noteScales[$0.value]) })
    }

    public static func clampNote(_ step: Int) -> Int { min(max(step, 0), noteScales.count - 1) }

    // MARK: The drawer (메모 글꼴)

    /// Nine steps of a point each, 12–20 (14: 보통).
    public static let drawerPoints = Array(12...20)
    public static let drawerDefault = 14
    /// 1.45's `drawer.textSize` → its points.
    public static let drawerLegacy: [String: Int] = ["small": 13, "regular": 14, "large": 16, "extraLarge": 18]

    public static func drawerPoint(saved points: Int?, legacy: String?) -> Int {
        if let points, drawerPoints.contains(points) { return points }
        return legacy.flatMap { drawerLegacy[$0] } ?? drawerDefault
    }

    public static func drawerLegacyName(_ points: Int) -> String {
        nearest(Double(points), in: drawerLegacy.map { ($0.key, Double($0.value)) })
    }

    /// A card's preview at each step: 11 · 12 · 13 · 13 · 14 · 14 · 15 · 15 · 16 (1.45's 13 → 12 · 14 → 13 · 16 → 14 ·
    /// 18 → 15 as they were).
    public static func drawerPreview(_ points: Int) -> Int {
        [11, 12, 13, 13, 14, 14, 15, 15, 16][min(max(points, 12), 20) - 12]
    }

    /// 줄 간격 (F2): the words' line as a share of their size.
    public enum LineSpacing: String, CaseIterable, Sendable {
        case tight, regular, loose
        public var factor: Double {
            switch self {
            case .tight: 1.6
            case .regular: 1.85
            case .loose: 2.1
            }
        }
    }

    /// 문단 간격 (F2): the room after a paragraph (a block of the memo's markdown), as a share of a line.
    public enum ParagraphSpacing: String, CaseIterable, Sendable {
        case regular, wide, wider
        public var lines: Double {
            switch self {
            case .regular: 0
            case .wide: 0.35
            case .wider: 0.7
            }
        }
    }

    /// The numbers one setting draws with (pt on the Mac, px on Windows).
    public struct DrawerMetrics: Equatable, Sendable {
        public var body: Int
        public var line: Int
        public var paragraph: Int
        public var preview: Int
        public var previewLine: Int
    }

    public static func drawerMetrics(points: Int, line: LineSpacing = .regular, paragraph: ParagraphSpacing = .regular) -> DrawerMetrics {
        let body = min(max(points, 12), 20)
        let height = Int((Double(body) * line.factor).rounded())
        let preview = drawerPreview(body)
        return DrawerMetrics(body: body, line: height, paragraph: Int((Double(height) * paragraph.lines).rounded()),
                             preview: preview, previewLine: Int((Double(preview) * 20 / 13).rounded()))
    }

    // MARK: The drawer's faces (메모 글꼴)

    /// The size a drawer face draws words of `size` at: the handwriting faces as much larger as the notebook's (pen
    /// 23 : 15, brush 22 : 15), so they read as large as the plain face; 고정폭 a point under; the plain face as it is.
    /// `face` is the setting's name (clean · pen · brush · mono).
    public static func faceSize(_ face: String, _ size: Double) -> Double {
        switch face {
        case "pen": (size * 23 / 15).rounded()
        case "brush": (size * 22 / 15).rounded()
        case "mono": (size - 1).rounded()
        default: size
        }
    }

    /// What one face draws with (#198): the body's size, and a card's preview in the same face (its size scaled as the
    /// body's) on the preview's lines. The Korean pen and brush fit the preview's lines at every step; the Latin pen
    /// (Caveat, English and Dutch) reaches higher and lower than its size, so its preview lines are a quarter taller
    /// (보통 20 → 25) — its letters neither touch the next line's nor are cut at the card's last line.
    public struct FaceMetrics: Equatable, Sendable {
        public var size: Int
        public var previewSize: Int
        public var previewLine: Int
    }

    public static func drawerFaceMetrics(points: Int, face: String, latin: Bool) -> FaceMetrics {
        let metrics = drawerMetrics(points: points)
        let line = face == "pen" && latin ? Int((Double(metrics.previewLine) * 1.25).rounded()) : metrics.previewLine
        return FaceMetrics(size: Int(faceSize(face, Double(metrics.body))), previewSize: Int(faceSize(face, Double(metrics.preview))),
                           previewLine: line)
    }

    // MARK: Paragraphs

    /// The block a line belongs to (nil: a blank line). A heading and a rule are each a block of their own.
    static func block(_ kind: MemoMarkdown.LineKind) -> String? {
        switch kind {
        case .blank: nil
        case .text: "text"
        case .list, .olist, .check: "list"
        case .quote: "quote"
        case .fence, .code: "code"
        case .heading: "heading"
        case .rule: "rule"
        }
    }

    /// Whether the room after a paragraph goes under this line: it ends its block (a blank line or another block
    /// follows) and something follows it. A list's lines stay together, and so do a code block's.
    public static func endsParagraph(_ kind: MemoMarkdown.LineKind, next: MemoMarkdown.LineKind?) -> Bool {
        guard let next, let this = block(kind) else { return false }
        guard let that = block(next) else { return true }
        return this != that || this == "heading" || this == "rule"
    }

    /// The same for every line of a text (the memo's title, its first line, included as a line).
    public static func paragraphEnds(_ text: String) -> [Bool] {
        let kinds = MemoMarkdown.lines(text).map(\.read.kind)
        return kinds.indices.map { endsParagraph(kinds[$0], next: $0 + 1 < kinds.count ? kinds[$0 + 1] : nil) }
    }

    // The drawer's paper (#142) moved to PaperLook.swift with the fifteen papers (#244).

    private static func nearest(_ value: Double, in table: [(String, Double)]) -> String {
        // Ties go to the smaller (the order is by value, so the first of two equally near).
        table.sorted { $0.1 < $1.1 }.min { abs($0.1 - value) < abs($1.1 - value) }!.0
    }
}
