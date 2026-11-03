import AppKit
import PaperCore
import SwiftUI

/// ⋯ → 키보드 단축키 (#86): the app's keys on a slip, in eight groups — 입력 · 이동 · 고른 할 일 · 어디서든 · 집중 · 메모 서랍 on
/// the left, 메모 서랍 안에서 · 메모 고치기 on the right (#118) — each row what it does and its keys, one cap per key (⌘ N; a
/// second key after a gap, ⌘N ⌘F). The keys that can be changed (the note's, the drawer's) show the one chosen, or ‘끔’.
/// Taller than the screen, the groups scroll. ⌘/ in the drawer shows its two groups alone. The same groups, order and
/// words as on Windows (shortcutQuestion in windows/src/main/main.ts).
@MainActor
enum ShortcutList {
    struct Row {
        let title: String
        /// nil: 끔.
        let caps: [String]?
        /// A second key for the same row, after a gap (새 메모 · 찾기: ⌘N ⌘F).
        var also: [String]?
    }

    struct Group {
        let title: String
        let rows: [Row]
    }

    static func groups(note: GlobalShortcut?, drawer: GlobalShortcut?) -> [Group] {
        [
            Group(title: L("입력"), rows: [
                Row(title: L("입력 줄로 가기"), caps: ["⌘", "N"]),
                Row(title: L("넣기 · 고치기 끝"), caps: ["↩"]),
                Row(title: L("고치기 취소"), caps: ["Esc"]),
                Row(title: String(localized: "실행 취소", table: "Keys"), caps: ["⌘", "Z"]),
                Row(title: L("다시 실행"), caps: ["⇧", "⌘", "Z"]),
                Row(title: String(localized: "목록 복사", table: "Keys"), caps: ["⇧", "⌘", "C"]),
                Row(title: L("텍스트로 내보내기"), caps: ["⌘", "E"]),
            ]),
            Group(title: L("이동"), rows: [
                Row(title: L("오늘"), caps: ["⌘", "1"]),
                Row(title: L("앞으로"), caps: ["⌘", "2"]),
                Row(title: L("검색"), caps: ["⌘", "F"]),
                Row(title: L("포스트잇으로 접기"), caps: ["⌘", "M"]),
                Row(title: L("책상"), caps: ["⌘", "D"]),
            ]),
            Group(title: L("고른 할 일"), rows: [
                Row(title: L("하루 뒤로"), caps: ["⌥", "→"]),
                Row(title: L("하루 앞으로"), caps: ["⌥", "←"]),
                Row(title: L("언젠가로"), caps: ["⌥", "↓"]),
                Row(title: L("집중 시작"), caps: ["F"]),
            ]),
            Group(title: L("어디서든"), rows: [
                Row(title: L("빠른 입력"), caps: GlobalShortcut.quickEntry.caps),
                Row(title: L("빠른 메모"), caps: GlobalShortcut.quickMemo.caps),
                Row(title: L("노트 보이기 · 숨기기"), caps: note?.caps),
            ]),
            Group(title: L("집중"), rows: [
                Row(title: L("일시정지 · 계속"), caps: [L("Space")]),
                Row(title: L("다 했어요"), caps: ["⌘", "↩"]),
                Row(title: L("5분 더"), caps: ["⌘", "="]),
                Row(title: L("그만두기"), caps: ["Esc"]),
            ]),
            Group(title: L("메모 서랍"), rows: [
                Row(title: L("어디서든 열고 닫기"), caps: drawer?.caps),
                Row(title: L("노트에서 열기"), caps: ["⌘", "3"]),
                Row(title: L("새 메모"), caps: ["⇧", "⌘", "N"]),
            ]),
        ] + drawerGroups()
    }

    /// #118: the drawer's own keys (a memo picked or open), and the keys while a memo is typed.
    static func drawerGroups() -> [Group] {
        [
            Group(title: L("메모 서랍 안에서"), rows: [
                Row(title: L("고르기"), caps: ["↑"], also: ["↓"]),
                Row(title: L("펼치기 · 접기"), caps: ["↩"], also: ["Esc"]),
                Row(title: L("새 메모 · 찾기"), caps: ["⌘", "N"], also: ["⌘", "F"]),
                Row(title: L("폴더 · 고정"), caps: ["⌘", "1–9"], also: ["⌘", "0"]),
                Row(title: L("폴더 목록"), caps: ["⌘", "L"]),
                Row(title: L("폴더로 옮기기"), caps: ["⇧", "⌘", "M"]),
                Row(title: L("크게 보기"), caps: ["⌘", "↩"]),
                Row(title: L("복사"), caps: ["⇧", "⌘", "C"]),
                Row(title: L("지우기"), caps: ["⌘", "⌫"]),
                Row(title: L("이 목록"), caps: ["⌘", "/"]),
            ]),
            Group(title: L("메모 고치기"), rows: [
                Row(title: L("굵게 · 기울임"), caps: ["⌘", "B"], also: ["⌘", "I"]),
                Row(title: L("취소선"), caps: ["⇧", "⌘", "X"]),
                Row(title: L("코드"), caps: ["⌥", "⌘", "C"]),
                Row(title: L("링크 칸"), caps: ["⌘", "K"]),
                Row(title: L("제목 줄"), caps: ["⌃", "⌘", "1–3"]),
                Row(title: L("체크 목록"), caps: ["⇧", "⌘", "L"]),
                Row(title: L("체크 · 체크 풀기"), caps: ["⇧", "⌘", "U"]),
                Row(title: L("기호 늘 보이기"), caps: ["⇧", "⌘", "R"]),
                Row(title: L("줄 옮기기"), caps: ["⌥", "↑"], also: ["⌥", "↓"]),
            ]),
        ]
    }

    /// ⌘/ in the drawer: its two groups on a slip of their own.
    static func showDrawer() {
        SlipAlert.present(title: L("메모 서랍의 키")) { done in
            ShortcutListSlip(groups: drawerGroups(), title: L("메모 서랍의 키"), footnote: false, onClose: done)
        }
    }

    /// Shows the slip till 확인, Return or Esc; the groups scroll when the slip would be taller than the screen.
    static func show(note: GlobalShortcut?, drawer: GlobalShortcut?) {
        let groups = groups(note: note, drawer: drawer)
        let screen = NSScreen.screens.first { $0.frame.contains(NSEvent.mouseLocation) } ?? NSScreen.main
        let room = (screen?.visibleFrame.height ?? 800) - SlipMetrics.margin.top - SlipMetrics.margin.bottom - 40
        SlipAlert.present(title: L("종이냥 단축키")) { done in
            ShortcutListSlip(groups: groups, scrollHeight: ShortcutListSlip.scrollHeight(groups, room: room), onClose: done)
        }
    }
}

struct ShortcutListSlip: View {
    static let width: CGFloat = 640
    let groups: [ShortcutList.Group]
    /// The groups' height when they scroll (the slip would be taller than the screen); nil: all of them shown.
    var scrollHeight: CGFloat?
    var title = L("종이냥 단축키")
    /// The two lines under the groups (the note's and the drawer's keys are changed on the desk).
    var footnote = true
    var onClose: () -> Void = {}

    /// How tall the groups may be so the slip fits in `room` points, or nil when it fits as it is.
    @MainActor static func scrollHeight(_ groups: [ShortcutList.Group], room: CGFloat) -> CGFloat? {
        let whole = NSHostingView(rootView: ShortcutListSlip(groups: groups)).fittingSize.height
        guard whole > room else { return nil }
        let lists = NSHostingView(rootView: ShortcutColumns(groups: groups).frame(width: width)).fittingSize.height
        return max(160, lists - (whole - room))
    }

    var body: some View {
        PaperSlip(kind: .confirm, width: Self.width) {
            VStack(alignment: .leading, spacing: 0) {
                SlipHeader(kind: .confirm, symbol: "keyboard", title: title, onClose: onClose)
                if let scrollHeight {
                    ScrollView { ShortcutColumns(groups: groups) }
                        .frame(height: scrollHeight)
                } else {
                    ShortcutColumns(groups: groups)
                }
                VStack(alignment: .leading, spacing: 3) {
                    if footnote {
                        Text(L("할 일을 누르면 바로 고칠 수 있어요. 줄 왼쪽 손잡이를 끌거나 우클릭 메뉴로 순서를 바꿔요."))
                        Text(L("노트와 메모 서랍의 키는 책상에서 바꿔요."))
                    } else {
                        Text(L("메모를 고르거나 펼친 채로 눌러요."))
                    }
                }
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(PaperTheme.ink3)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 18)
                .padding(.top, 14)
                SlipFooter {
                    // Esc closes it too.
                    Button("") { onClose() }
                        .keyboardShortcut(.cancelAction)
                        .opacity(0)
                        .frame(width: 0, height: 0)
                        .accessibilityHidden(true)
                } trailing: {
                    Button(L("확인")) { onClose() }
                        .buttonStyle(SlipButtonStyle(role: .primary, key: "↩"))
                        .keyboardShortcut(.defaultAction)
                }
            }
        }
    }
}

/// The groups in two columns, split where the two are nearest in rows (#118: the drawer's two groups on the right).
private struct ShortcutColumns: View {
    let groups: [ShortcutList.Group]

    /// How many groups go on the left: the split with the least difference in rows (headings counted as two rows).
    static func split(_ groups: [ShortcutList.Group]) -> Int {
        let sizes = groups.map { $0.rows.count + 2 }
        let total = sizes.reduce(0, +)
        var best = (groups.count + 1) / 2, gap = Int.max, left = 0
        for index in 1..<max(2, groups.count) where index <= sizes.count {
            left += sizes[index - 1]
            let difference = abs(total - 2 * left)
            if difference < gap { gap = difference; best = index }
        }
        return best
    }

    var body: some View {
        let half = Self.split(groups)
        HStack(alignment: .top, spacing: 28) {
            column(groups.prefix(half))
            column(groups.dropFirst(half))
        }
        .padding(.horizontal, 18)
        .padding(.top, 14)
    }

    private func column(_ part: ArraySlice<ShortcutList.Group>) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(part.enumerated()), id: \.offset) { _, group in
                ShortcutGroupView(group: group)
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

private struct ShortcutGroupView: View {
    let group: ShortcutList.Group

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(group.title)
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(PaperTheme.ink3)
                .accessibilityAddTraits(.isHeader)
                .padding(.bottom, 5)
            ForEach(Array(group.rows.enumerated()), id: \.offset) { index, row in
                if index > 0 { Rectangle().fill(PaperTheme.rule).frame(height: 0.5) }
                HStack(spacing: 10) {
                    Text(row.title.keepingParticles)
                        .font(.system(size: 13))
                        .foregroundStyle(PaperTheme.ink)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 6)
                    if let caps = row.caps {
                        HStack(spacing: 3) {
                            ForEach(Array(caps.enumerated()), id: \.offset) { _, cap in ListKeyCap(text: cap) }
                            if let also = row.also {
                                Color.clear.frame(width: 6, height: 1)
                                ForEach(Array(also.enumerated()), id: \.offset) { _, cap in ListKeyCap(text: cap) }
                            }
                        }
                        .fixedSize()
                    } else {
                        Text(L("끔"))
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(PaperTheme.ink3)
                            .fixedSize()
                    }
                }
                .padding(.vertical, 4)
                .frame(minHeight: 28)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(row.title)
                .accessibilityValue(row.caps.map { $0.joined(separator: " ") + (row.also.map { ", " + $0.joined(separator: " ") } ?? "") } ?? L("끔"))
            }
        }
    }
}

/// One key on the slip: a small rounded cap (a touch larger than the footers' KeyCap), its 2 pt bottom edge.
private struct ListKeyCap: View {
    let text: String

    var body: some View {
        Text(text)
            .font(.system(size: 11.5, weight: .semibold))
            .foregroundStyle(PaperTheme.ink2)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 6)
            .frame(minWidth: 22, minHeight: 20)
            .background(PaperTheme.card, in: RoundedRectangle(cornerRadius: 5))
            .overlay { RoundedRectangle(cornerRadius: 5).strokeBorder(PaperTheme.rule, lineWidth: 1) }
            .overlay(alignment: .bottom) {
                RoundedRectangle(cornerRadius: 5)
                    .fill(PaperTheme.rule)
                    .frame(height: 2)
                    .mask(alignment: .bottom) { RoundedRectangle(cornerRadius: 5).frame(height: 2) }
            }
    }
}
