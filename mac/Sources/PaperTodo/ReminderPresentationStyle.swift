import AppKit

enum ReminderPresentationStyle: String, CaseIterable, Identifiable {
    case compact, paper, character

    var id: String { rawValue }
    var title: String {
        switch self {
        case .compact: L("미니")
        case .paper: L("쪽지")
        case .character: L("친구")
        }
    }
    var detail: String {
        switch self {
        case .compact: L("캐릭터 없이, 할 일만 작게")
        case .paper: L("작은 친구가 건네는 알림 쪽지")
        case .character: L("옆에서 인사하는 친구와 말풍선")
        }
    }
    var mascotGutter: CGFloat { self == .compact ? 0 : self == .paper ? 72 : 96 }

    var size: NSSize {
        switch self {
        case .compact: NSSize(width: 344, height: 142)
        case .paper: NSSize(width: 416, height: 142)
        case .character: NSSize(width: 440, height: 148)
        }
    }
}
