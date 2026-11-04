import AppKit
import PaperCore
import SwiftUI

// 메모 서랍's cards (1.44, design ③ 날짜 묶음 + 카드): every card the same places — the title (the short time or the
// paw at its right), up to three preview lines (#14: a checklist's first three items; dense two), and a kind row when
// a link, a phone number or a checklist is found (a chip at the left, the time at the right). A piece of tape on every card. Opened in place: its text, then the bar —
// [크게 보기 · 복사 · ⚙] · `5:38 고침` · [폴더로 옮기기 · 지우기].

/// One memo in the list: collapsed (a card) or open in place.
struct MemoCard: View {
    @ObservedObject var drawer: MemoDrawer
    let memo: Memo
    /// The drawer's paper (the memo may have its own).
    let palette: DrawerPalette
    let font: NotebookFont
    /// The date group it's under (its short time follows it).
    let group: MemoCards.Group
    @State private var hovering = false

    private var expanded: Bool { drawer.expandedID == memo.id }
    private var selected: Bool { drawer.selectedID == memo.id }
    private var pinned: Bool { drawer.folders.isPinned(memo.id) }
    private var folderID: String { drawer.folders.folderID(of: memo.id) }
    private var folderColor: MemoFolders.Color { drawer.folders.folder(folderID)?.colorKey ?? .lavender }
    /// The memo's own paper, or the drawer's.
    private var sheet: DrawerPalette { drawer.folders.paper(of: memo.id).map { DrawerPalette.of(DrawerPalette.Kind(rawValue: $0.rawValue)!) } ?? palette }

    var body: some View {
        let sheet = sheet, dense = drawer.dense
        VStack(alignment: .leading, spacing: 0) {
            if expanded {
                OpenMemo(drawer: drawer, memo: memo, palette: sheet, font: font, editing: drawer.editing)
            } else {
                closed(sheet)
            }
        }
        .modifier(MemoSlipStyle(palette: sheet, drawer: palette,
                                state: .init(open: expanded, selected: selected, folder: folderColor,
                                             minHeight: expanded ? 0 : (dense ? MemoSlipStyle.denseHeight : MemoSlipStyle.cardHeight),
                                             floating: drawer.shownBackdrop == .none, dense: dense && !expanded)))
        .overlay(alignment: .top) { CardTape(id: memo.id, color: palette.tab(folderColor).tape) }
        .overlay {
            // A right-click: the memo's menu (while typing, the text's own menu with `이 메모` added).
            if !(expanded && drawer.editing) {
                DrawerContextArea(drawer: drawer) { DrawerMenus.memo(drawer, memo.id) }
            }
        }
        .overlay(alignment: .topTrailing) {
            if (hovering || drawer.previewHover == memo.id) && !expanded {
                HoverPill(drawer: drawer, memo: memo, palette: sheet)
                    .padding(.top, 7)
                    .padding(.trailing, 7)
            }
        }
        .onHover { hovering = $0 }
        .onTapGesture { if !expanded { drawer.expand(memo.id) } }
        .draggableIf(!expanded, "memo:" + memo.id) { DragCard(title: drawer.cardTitle(memo), palette: sheet, font: font) }
        .modifier(CardAccessibility(drawer: drawer, memo: memo, group: group, expanded: expanded, selected: selected, pinned: pinned))
        .modifier(MemoArrive(active: drawer.justArrived(memo.id)))
    }

    @ViewBuilder private func closed(_ sheet: DrawerPalette) -> some View {
        let card = drawer.card(memo)
        let title = card.title, kind = card.kind
        let limit = drawer.dense ? 2 : 3
        let time = MemoCards.shortTime(drawer.sortDate(memo), in: group, now: drawer.now(), language: .current)
        let paw = pinned && group == .pinned
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                CardTitle(words: Text(verbatim: title.handwritten), font: font, color: sheet.ink)
                Spacer(minLength: 4)
                if paw {
                    Image(systemName: "pin.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(sheet.paw)
                        .accessibilityLabel(L("고정"))
                }
                if kind == nil { TimeText(text: time, palette: sheet) }
            }
            .frame(height: MemoSlipStyle.titleRow)
            if !card.rows.isEmpty {
                PreviewRows(rows: card.rows, limit: limit, palette: sheet, text: drawer.text)
            }
            if let kind {
                KindRow(drawer: drawer, kind: kind, time: time, palette: sheet)
                    .frame(height: MemoSlipStyle.kindRow)
            }
        }
    }
}

/// #119 (VoiceOver): a closed card is one element read as `제목, 오늘 오전 9:20, 고정, 체크 목록 2/4` with its preview as
/// the value (not the chips one by one, nor a checklist's count twice); ↩ / VO-Space opens it, and the hover pill's and
/// the kind chip's actions are its custom actions (복사 · 고정 · 폴더로 옮기기 · 지우기 · 링크 열기 · 번호 복사). An open
/// memo keeps its parts (the words, the bar) as children.
struct CardAccessibility: ViewModifier {
    @ObservedObject var drawer: MemoDrawer
    let memo: Memo
    let group: MemoCards.Group
    let expanded: Bool
    let selected: Bool
    let pinned: Bool

    func body(content: Content) -> some View {
        if expanded {
            // The open memo: its title names the group around its words and its bar.
            content.accessibilityElement(children: .contain).accessibilityLabel(drawer.card(memo).title)
        } else {
            let card = drawer.card(memo)
            content
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(label(card))
                .accessibilityValue(card.rows.prefix(3).map { $0.checked == nil ? $0.text : ($0.checked == true ? L("완료됨") : L("미완료")) + " " + $0.text }.joined(separator: ", "))
                .accessibilityAddTraits(selected ? [.isButton, .isSelected] : .isButton)
                .accessibilityAction { drawer.expand(memo.id) }
                .accessibilityAction(named: L("복사")) { drawer.copy(memo.id) }
                .accessibilityAction(named: pinned ? L("고정 풀기") : String(localized: "고정", table: "Drawer")) { drawer.togglePin(memo.id) }
                .accessibilityAction(named: L("폴더로 옮기기")) { drawer.openMoveList(memo.id) }
                .accessibilityAction(named: L("지우기")) { drawer.delete(memo.id) }
                .modifier(KindActions(drawer: drawer, kind: card.kind))
        }
    }

    private func label(_ card: MemoDrawer.Card) -> String {
        var parts = [card.title, MemoCards.dayTime(drawer.sortDate(memo), now: drawer.now(), language: .current)]
        if pinned { parts.append(String(localized: "고정", table: "Drawer")) }
        switch card.kind {
        case .checklist(let done, let total): parts.append(L("체크 목록 \(done)/\(total)"))
        case .link(_, let label): parts.append(label)
        case .phone(let number): parts.append(number)
        case nil: break
        }
        return parts.joined(separator: ", ")
    }
}

/// A card's kind chip as an action of the card (VoiceOver can't reach the chip inside a card read as one).
private struct KindActions: ViewModifier {
    let drawer: MemoDrawer
    let kind: MemoCards.Kind?

    func body(content: Content) -> some View {
        switch kind {
        case .link(let url, _):
            content.accessibilityAction(named: L("링크 열기")) {
                if let target = URL(string: url) { NSWorkspace.shared.open(target) }
            }
        case .phone(let number):
            content.accessibilityAction(named: L("번호 복사")) {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(number, forType: .string)
                drawer.say(L("복사했어요"))
            }
        default:
            content
        }
    }
}

/// A handwritten title (#14, option B): 22 pt, the strokes a hair heavier — the same words drawn again 0.25 pt to the
/// right, which darkens them as much as the open memo's 0.7 pt text stroke (DrawerTextView) and about as the Windows
/// app's 0.35 px one; the clean face is already medium and stays as it is.
struct CardTitle: View {
    let words: Text
    let font: NotebookFont
    let color: Color
    var size: CGFloat = 22

    var body: some View {
        let words = words.font(font.handFont(MemoDrawerView.hand(size)))
        words
            .foregroundStyle(color)
            .lineLimit(1)
            .truncationMode(.tail)
            .overlay(alignment: .leading) {
                if font != .clean {
                    words.foregroundStyle(color).lineLimit(1).truncationMode(.tail).offset(x: 0.25).accessibilityHidden(true)
                }
            }
    }
}

/// A card's lines under its title (#14): a memo's words wrapped into at most `limit` lines with … at the end of the
/// last, or a checklist's first items one per line with small boxes. Only the lines there are (no empty ones).
struct PreviewRows: View {
    let rows: [MemoCards.PreviewRow]
    let limit: Int
    let palette: DrawerPalette
    /// The drawer's face and size step (#84, #198): the preview is in the words' face, its code lines in the code face.
    var text = MemoText()

    var body: some View {
        if rows.first?.checked != nil {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(rows.prefix(limit).enumerated()), id: \.offset) { _, row in
                    let done = row.checked == true
                    HStack(spacing: 6) {
                        CheckBox(checked: done, palette: palette, size: 11)
                        Text(verbatim: row.text.keepingParticles)
                            .font(Font(text.previewFont))
                            .foregroundStyle(done ? palette.faint : palette.preview)
                            .strikethrough(done, color: palette.faint)
                            .lineLimit(1)
                            .truncationMode(.tail)
                    }
                    .frame(height: text.previewLine)
                }
            }
            .accessibilityElement(children: .combine)
        } else {
            Text(words)
                .font(Font(text.previewFont))
                .foregroundStyle(palette.preview)
                .truncationMode(.tail)
                .modifier(PreviewLines(text: text, limit: limit))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The rows joined by line breaks; a code block's line and an old code line in the fixed-width face.
    private var words: AttributedString {
        var all = AttributedString()
        for (index, row) in rows.prefix(limit).enumerated() {
            if index > 0 { all.append(AttributedString("\n")) }
            let code = row.code || Checklist.isCode(row.text)
            var part = AttributedString(code ? row.text : row.text.keepingParticles)
            if code { part.font = Font(text.previewCodeFont) }
            all.append(part)
        }
        return all
    }
}

/// A preview's wrapped lines each the preview's line tall (보통 20 pt, #198), in any face: the face's own line plus the
/// room to it. A Latin handwriting face's own line is taller than that (Caveat 24 → 30, Kalam 17 → 27): from macOS 26
/// the lines are set to the preview's exactly (the letters reach a little past them, as in the open memo, and the card
/// keeps its height); before it they keep the face's own.
struct PreviewLines: ViewModifier {
    let text: MemoText
    var limit: Int?

    func body(content: Content) -> some View {
        let own = text.previewTextLine
        if own > text.previewLine, #available(macOS 26, *) {
            content
                .lineHeight(.exact(points: text.previewLine))
                .lineLimit(limit)
                .fixedSize(horizontal: false, vertical: true)
        } else {
            let spacing = max(0, text.previewLine - own)
            content
                .lineSpacing(spacing)
                .lineLimit(limit)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.vertical, spacing / 2)
        }
    }
}

/// The card's time (small, faint).
struct TimeText: View {
    let text: String
    let palette: DrawerPalette

    var body: some View {
        Text(text)
            .font(.system(size: 11).monospacedDigit())
            .foregroundStyle(palette.faint)
            .lineLimit(1)
            .fixedSize()
    }
}

/// The kind row: a chip (link: its address, opened on click; phone: its number, copied on click; checklist: `2/4` with
/// its bar) and the time at the right.
struct KindRow: View {
    @ObservedObject var drawer: MemoDrawer
    let kind: MemoCards.Kind
    let time: String
    let palette: DrawerPalette

    var body: some View {
        HStack(spacing: 7) {
            switch kind {
            case .checklist(let done, let total):
                Chip(symbol: "checklist.checked", text: "\(done)/\(total)", palette: palette)
                    .accessibilityLabel(L("체크 목록 \(done)/\(total)"))
                ProgressTrack(done: done, total: total, palette: palette)
                    .frame(width: 46)
            case .link(let url, let label):
                Button {
                    if let target = URL(string: url) ?? URL(string: url.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? "") {
                        NSWorkspace.shared.open(target)
                    }
                } label: {
                    Chip(symbol: "link", text: label, palette: palette)
                }
                .buttonStyle(.plain)
                .help(L("브라우저에서 열기"))
                .accessibilityLabel(L("링크 열기: \(label)"))
            case .phone(let number):
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(number, forType: .string)
                    drawer.say(L("복사했어요"))
                } label: {
                    Chip(symbol: "phone", text: number, palette: palette)
                }
                .buttonStyle(.plain)
                .help(L("번호 복사"))
                .accessibilityLabel(L("번호 복사: \(number)"))
            }
            Spacer(minLength: 6)
            TimeText(text: time, palette: palette)
        }
    }
}

struct Chip: View {
    let symbol: String
    let text: String
    let palette: DrawerPalette

    var body: some View {
        HStack(spacing: 4) {
            Image(systemName: symbol).font(.system(size: 9.5, weight: .medium))
            Text(verbatim: text)
                .font(.system(size: 11))
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .foregroundStyle(palette.secondary)
        .padding(.horizontal, 7)
        .frame(height: 18)
        .background(palette.pill, in: Capsule())
        .frame(maxWidth: 170, alignment: .leading)
        .fixedSize(horizontal: false, vertical: true)
    }
}

struct ProgressTrack: View {
    let done: Int
    let total: Int
    let palette: DrawerPalette

    var body: some View {
        GeometryReader { geometry in
            ZStack(alignment: .leading) {
                Capsule().fill(palette.pillEdge)
                Capsule().fill(palette.check).frame(width: total == 0 ? 0 : geometry.size.width * CGFloat(done) / CGFloat(total))
            }
        }
        .frame(height: 4)
        .accessibilityHidden(true)
    }
}

/// What a dragged card looks like under the pointer: its title on a sheet (no hover buttons).
private struct DragCard: View {
    let title: String
    let palette: DrawerPalette
    let font: NotebookFont

    var body: some View {
        Text(title.handwritten)
            .font(font.handFont(MemoDrawerView.hand(19)))
            .foregroundStyle(palette.ink)
            .lineLimit(1)
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
            .frame(maxWidth: 220, alignment: .leading)
            .background(palette.sheet)
            .overlay { Rectangle().strokeBorder(palette.sheetEdge, lineWidth: 1) }
    }
}

extension View {
    @ViewBuilder func draggableIf<P: View>(_ on: Bool, _ payload: String, @ViewBuilder preview: () -> P) -> some View {
        if on { draggable(payload, preview: preview) } else { self }
    }
}

/// Over a collapsed card under the pointer: 복사 · 고정 · ⋯ (the memo's menu).
private struct HoverPill: View {
    @ObservedObject var drawer: MemoDrawer
    let memo: Memo
    let palette: DrawerPalette

    var body: some View {
        let pinned = drawer.folders.isPinned(memo.id)
        HStack(spacing: 0) {
            BarButton(symbol: "doc.on.doc", palette: palette, help: L("복사 (⇧⌘C)")) { drawer.copy(memo.id) }
            BarButton(symbol: pinned ? "pin.fill" : "pin", palette: palette, help: pinned ? L("고정 풀기") : L("고정하기"), tint: pinned ? palette.check : nil) {
                drawer.togglePin(memo.id)
            }
            BarMenuButton(drawer: drawer, symbol: "ellipsis", palette: palette, help: L("더 보기")) { DrawerMenus.memo(drawer, memo.id) }
        }
        .padding(.horizontal, 3)
        .padding(.vertical, 1)
        .background(palette.sheet, in: Capsule())
        .overlay { Capsule().strokeBorder(palette.pillEdge, lineWidth: 0.5) }
        .shadow(color: palette.shadow, radius: 3, y: 2)
    }
}

/// A small round button on the bar and the hover pill: 15 pt thin icons (or a few letters: the bar's Aa, #112).
struct BarButton: View {
    let symbol: String
    var text: String?
    let palette: DrawerPalette
    let help: String
    var tint: Color?
    var role: Color?
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Group {
                if let text {
                    Text(verbatim: text).font(.system(size: 12, weight: .semibold))
                } else {
                    Image(systemName: symbol).font(.system(size: 13, weight: .light))
                }
            }
                .frame(width: 24, height: 24)
                .background(palette.ink.opacity(hovering ? 0.08 : 0), in: Capsule())
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .foregroundStyle(role ?? tint ?? palette.icon)
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

/// A bar button whose click opens a menu under it.
struct BarMenuButton: View {
    @ObservedObject var drawer: MemoDrawer
    let symbol: String
    let palette: DrawerPalette
    let help: String
    /// Reached with Tab (full keyboard access) and opened with Space · ↩ (#112: the open memo's ⋯).
    var keyboard = false
    let items: @MainActor () -> [DrawerMenuItem]
    @State private var hovering = false

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 13, weight: .light))
            .foregroundStyle(palette.icon)
            // #119: the menu button over it is what VoiceOver reads (the image said ‘더 보기’ a second time).
            .accessibilityHidden(true)
            .frame(width: 24, height: 24)
            .background(palette.ink.opacity(hovering ? 0.08 : 0), in: Capsule())
            .onHover { hovering = $0 }
            .overlay { DrawerMenuButtonArea(drawer: drawer, label: help, items: items, keyboard: keyboard) }
    }
}

/// A memo open in place: its boxes to tick (or its text to type), then the bar.
struct OpenMemo: View {
    @ObservedObject var drawer: MemoDrawer
    let memo: Memo
    let palette: DrawerPalette
    let font: NotebookFont
    /// Typing (the text view) or reading (its lines), as the card said while it was open (#3): a card closing keeps the
    /// face it had while it slides shut — read from the drawer, a 1 MB memo put away with Esc was drawn line by line as
    /// read for the 0.16 s it took to go (5 s of work).
    let editing: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if editing {
                SlipEditor(drawer: drawer, memo: memo, palette: palette, font: font)
            } else {
                CheckedText(drawer: drawer, memo: memo, palette: palette, font: font)
            }
            if editing, drawer.linkEdit != nil {
                LinkBar(drawer: drawer, palette: palette).padding(.top, 8)
            }
            if editing, drawer.formatBarOpen {
                FormatBar(drawer: drawer, palette: palette).padding(.top, 8)
            }
            MemoBar(drawer: drawer, memo: memo, palette: palette, big: false)
                .padding(.top, 8)
        }
    }
}

/// The open memo's bar (#112, SideNotes): [Aa] [⤢] [⋯] at the left, `5:38 고침` at the right. Aa opens the format bar
/// (typing the memo if it wasn't); ⋯ is the memo's right-click menu — copy, pin, move, its paper, delete … are there.
struct MemoBar: View {
    @ObservedObject var drawer: MemoDrawer
    let memo: Memo
    let palette: DrawerPalette
    let big: Bool

    var body: some View {
        HStack(spacing: 6) {
            BarPill(palette: palette) {
                BarButton(symbol: "", text: "Aa", palette: palette, help: L("서식"), tint: drawer.editing && drawer.formatBarOpen ? palette.check : nil) {
                    if drawer.editing {
                        drawer.formatBarOpen.toggle()
                    } else {
                        drawer.edit(memo.id)
                        drawer.formatBarOpen = true
                    }
                }
            }
            BarPill(palette: palette) {
                BarButton(symbol: big ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right", palette: palette,
                          help: big ? L("작게 보기") : L("크게 보기")) {
                    if big { drawer.bigID = nil } else { drawer.showBig(memo.id) }
                }
            }
            BarPill(palette: palette) {
                BarMenuButton(drawer: drawer, symbol: "ellipsis", palette: palette, help: L("더 보기"), keyboard: true) { DrawerMenus.memo(drawer, memo.id) }
            }
            // Narrow drawers: `오후 5:38 고침`, else just the time, else nothing. 크게 보기 adds the letters (#113):
            // `어제 21:40 고침 · 412자`.
            ViewThatFits(in: .horizontal) {
                let edited = MemoCards.edited(memo.updatedAt, now: drawer.now(), language: .current)
                if big { when(edited + " · " + MemoCards.characters(MemoCards.characterCount(memo.text), language: .current)) }
                when(edited)
                when(MemoCards.dayTime(memo.updatedAt, now: drawer.now(), language: .current))
                Color.clear.frame(height: 1)
            }
        }
        .frame(height: 30)
    }
}

extension MemoBar {
    fileprivate func when(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11).monospacedDigit())
            .foregroundStyle(palette.faint)
            .lineLimit(1)
            .fixedSize()
            .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// 서식 막대 (Aa, #84 — SideNotes' way): what the keys do, as buttons on the open memo, on the selection or at the caret
/// (a line's format on the caret's line; a second press takes it off); then the drawer's face, size and 기호 늘 보이기.
struct FormatBar: View {
    @ObservedObject var drawer: MemoDrawer
    let palette: DrawerPalette

    private var buttons: [(DrawerTextView.KeyTextView.Format, String, String)] { [
        (.bold, "bold", L("굵게 (⌘B)")), (.italic, "italic", L("기울임 (⌘I)")), (.strike, "strikethrough", L("취소선 (⇧⌘X)")),
        (.heading, "number", L("제목 (⌃⌘1–3)")), (.list, "list.bullet", L("목록")), (.olist, "list.number", L("번호 목록")),
        (.check, "checklist", L("체크 목록 (⇧⌘L)")), (.quote, "text.quote", L("인용")), (.code, "chevron.left.forwardslash.chevron.right", L("코드 (⌥⌘C)")),
        (.rule, "minus", L("가로줄")), (.link, "link", L("링크 (⌘K)")),
    ] }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            FlowRow(spacing: 0) {
                ForEach(buttons, id: \.1) { format, symbol, help in
                    BarButton(symbol: symbol, palette: palette, help: help) { drawer.format(format) }
                }
            }
            HStack(spacing: 6) {
                Menu {
                    Picker(L("글꼴"), selection: $drawer.bodyFace) { ForEach(MemoText.Face.allCases) { Text($0.title).tag($0) } }.pickerStyle(.inline)
                    Picker(L("글자 크기"), selection: $drawer.textSize) { ForEach(MemoText.Size.allCases) { Text($0.title).tag($0) } }.pickerStyle(.inline)
                } label: {
                    Text(verbatim: "Aa  \(drawer.bodyFace.title) · \(drawer.textSize.title)")
                        .font(.system(size: 11))
                        .foregroundStyle(palette.icon)
                        .lineLimit(1)
                }
                .menuStyle(.borderlessButton)
                .menuIndicator(.hidden)
                .fixedSize()
                .help(L("글꼴과 글자 크기"))
                Spacer(minLength: 4)
                BarButton(symbol: drawer.showMarks ? "eye" : "eye.slash", palette: palette, help: L("기호 늘 보이기 (⇧⌘R)"),
                          tint: drawer.showMarks ? palette.check : nil) { drawer.showMarks.toggle() }
            }
        }
        .padding(.horizontal, 4)
        .padding(.vertical, 3)
        .background(palette.pill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(palette.pillEdge, lineWidth: 0.5) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(L("서식"))
    }
}

/// 링크 (#135, SideNotes' way): ⌘K on chosen words (or in a link) opens this small field under the memo — the address,
/// Return to finish (the words become `[words](address)`, or the link's address changes), Esc to leave it; in a link,
/// 링크 빼기 (or an empty address) takes the link out. The memo changes once, at Return (one undo).
struct LinkBar: View {
    @ObservedObject var drawer: MemoDrawer
    let palette: DrawerPalette
    @State private var url = ""
    @FocusState private var focused: Bool

    var body: some View {
        let existing = drawer.linkEdit?.existing == true
        VStack(alignment: .leading, spacing: 5) {
            Text(existing ? L("링크 고치기") : L("링크 넣기"))
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(palette.label)
                .accessibilityAddTraits(.isHeader)
            HStack(spacing: 6) {
                Image(systemName: "link")
                    .font(.system(size: 12))
                    .foregroundStyle(palette.icon)
                    .accessibilityHidden(true)
                TextField(L("링크 주소"), text: $url, prompt: Text(verbatim: "https://").foregroundStyle(palette.placeholder))
                    .textFieldStyle(.plain)
                    .font(.system(size: 13))
                    .foregroundStyle(palette.ink)
                    .focused($focused)
                    .onSubmit { drawer.finishLink(url) }
                    .accessibilityLabel(L("링크 주소"))
            }
            .padding(.horizontal, 8)
            .frame(height: 28)
            .background(palette.slip, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
            .overlay { RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(focused ? palette.check : palette.slipEdge, lineWidth: focused ? 1 : 0.5) }
            HStack(spacing: 8) {
                Text(existing ? L("↩ 고치기 · Esc 그만") : L("↩ 넣기 · Esc 그만"))
                    .font(.system(size: 11))
                    .foregroundStyle(palette.faint)
                    // Never cut: a long language in a narrow drawer takes a second line.
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 4)
                if existing {
                    Button(L("링크 빼기")) { drawer.finishLink("") }
                        .buttonStyle(.plain)
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(palette.secondary)
                        .fixedSize()
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 7)
        .background(palette.pill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(palette.pillEdge, lineWidth: 0.5) }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(existing ? L("링크 고치기") : L("링크 넣기"))
        .onAppear {
            url = drawer.linkEdit?.url ?? ""
            focused = true
        }
        .onChange(of: drawer.linkEdit) { _, edit in
            if let edit { url = edit.url; focused = true }
        }
    }
}

/// Buttons in rows: as many as fit, the rest on the next row (the Aa bar in a narrow drawer).
struct FlowRow: Layout {
    var spacing: CGFloat = 0

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews)
        return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: rows.map(\.height).reduce(0, +))
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews) {
            var x = bounds.minX
            for index in row.items {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
                x += size.width + spacing
            }
            y += row.height
        }
    }

    private func arrange(width: CGFloat, _ subviews: Subviews) -> [(items: [Int], width: CGFloat, height: CGFloat)] {
        var rows: [(items: [Int], width: CGFloat, height: CGFloat)] = []
        var current: [Int] = [], x: CGFloat = 0, height: CGFloat = 0
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.unspecified)
            if !current.isEmpty, x + size.width > width {
                rows.append((current, x - spacing, height))
                current = []; x = 0; height = 0
            }
            current.append(index)
            x += size.width + spacing
            height = max(height, size.height)
        }
        if !current.isEmpty { rows.append((current, x - spacing, height)) }
        return rows
    }
}

/// A fully rounded group of bar buttons: ink at 6 %, a hairline inside.
private struct BarPill<Content: View>: View {
    let palette: DrawerPalette
    @ViewBuilder let content: Content

    var body: some View {
        HStack(spacing: 0) { content }
            .padding(.horizontal, 2)
            .padding(.vertical, 1)
            .background(palette.pill, in: Capsule())
            .overlay { Capsule().strokeBorder(palette.pillEdge, lineWidth: 0.5) }
            .fixedSize()
    }
}

/// An open memo with checklist lines: the title, each line (boxes to tick), a click on the words to type. #84: the other
/// lines styled as the editor styles them (MemoStyler), in the drawer's face and size.
struct CheckedText: View {
    @ObservedObject var drawer: MemoDrawer
    let memo: Memo
    let palette: DrawerPalette
    let font: NotebookFont
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let lines = MemoMarkdown.lines(memo.text)
        let text = drawer.text
        let styler = MemoStyler(text: text, ink: NSColor(palette.ink), soft: NSColor(palette.preview), accent: NSColor(palette.check))
        let titleIndex = lines.firstIndex { !String(decoding: $0.units, as: UTF16.self).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        // 문단 간격 (#141): the room under each paragraph's last line (a list's lines stay together).
        let ends = lines.indices.map { text.paragraph > 0 && TextSteps.endsParagraph(lines[$0].read.kind, next: $0 + 1 < lines.count ? lines[$0 + 1].read.kind : nil) }
        // #209: lazy — only the lines in view (and near it) are made; a 2,000-line checklist made every line's views on
        // ↩ (1.8–3 s). The card is as tall as the lines made so far say, refined as the list scrolls.
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { index, line in
                let raw = String(decoding: line.units, as: UTF16.self)
                Group {
                    if let item = Checklist.lines(raw).first {
                        HStack(alignment: .firstTextBaseline, spacing: 7) {
                            Button { drawer.tickInCard(memo.id, line: index, motion: !reduceMotion) } label: {
                                CheckBox(checked: item.checked, palette: palette)
                            }
                            .buttonStyle(.plain)
                            .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
                            .accessibilityLabel(item.text)
                            .accessibilityValue(item.checked ? L("완료됨") : L("미완료"))
                            // #163: once the box is filled, the words fade to done (struck through, faint).
                            ZStack(alignment: .leading) {
                                Text(itemWords(line, styler))
                                    .foregroundStyle(palette.ink)
                                    .opacity(item.checked ? 0 : 1)
                                Text(itemWords(line, styler))
                                    .foregroundStyle(palette.faint)
                                    .strikethrough(true, color: palette.faint)
                                    .opacity(item.checked ? 1 : 0)
                            }
                                .font(Font(text.font()))
                                .animation(item.checked ? Motion.animation(.change, reduce: reduceMotion)?.delay(Motion.enter.duration)
                                           : Motion.exit(.quick, reduce: reduceMotion), value: item.checked)
                                .modifier(OnTheLines(text: text))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                                .onTapGesture { edit(at: index) }
                        }
                    } else if index == titleIndex {
                        let words = (MemoMarkdown.linePlain(line.units, line.read) ?? raw).trimmingCharacters(in: .whitespaces)
                        CardTitle(words: Text(verbatim: words.handwritten), font: font, color: palette.ink)
                            .frame(maxWidth: .infinity, minHeight: MemoSlipStyle.titleRow, maxHeight: MemoSlipStyle.titleRow, alignment: .leading)
                            .contentShape(Rectangle())
                            .onTapGesture { edit(at: index) }
                    } else if !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || line.read.kind == .code {
                        MarkdownLine(line: line, raw: raw, styler: styler, palette: palette)
                            .contentShape(Rectangle())
                            .onTapGesture { edit(at: index) }
                    }
                }
                .padding(.bottom, ends[index] && index != titleIndex ? text.paragraph : 0)
            }
        }
    }

    /// A checklist item's words after its box, its marks styled.
    private func itemWords(_ line: MemoMarkdown.Line, _ styler: MemoStyler) -> AttributedString {
        let styled = styler.swiftUI(line.units, line.read, base: Font(styler.text.font()), hide: !styler.text.showMarks)
        let words = String(decoding: line.units[..<line.read.end], as: UTF16.self)
        guard let start = Range(NSRange(location: min(line.read.words, (words as NSString).length), length: 0), in: words),
              let from = AttributedString.Index(start.lowerBound, within: styled) else { return styled }
        return AttributedString(styled[from...])
    }

    private func edit(at line: Int) {
        drawer.editLine = line
        drawer.editing = true
    }
}

/// One line of an open memo that isn't a checklist item (#84): a heading larger and bold, a list item's words hanging
/// after its mark, a quote beside its bar, a code block's line fixed-width on its tint, a rule's line; the marks faint.
private struct MarkdownLine: View {
    let line: MemoMarkdown.Line
    let raw: String
    let styler: MemoStyler
    let palette: DrawerPalette
    /// The marks left out (#84, 2026-10-30), unless 기호 늘 보이기.
    private var hide: Bool { !styler.text.showMarks }

    var body: some View {
        let text = styler.text
        let read = line.read
        let base = Font(text.font())
        switch read.kind {
        case .code, .fence:
            Text(verbatim: read.kind == .fence && hide ? " " : raw)
                .font(Font(text.codeFont))
                .foregroundStyle(read.kind == .fence ? Color(nsColor: styler.faint) : palette.ink)
                .modifier(OnTheLines(text: text))
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color(nsColor: styler.tint))
        case .heading:
            let scale = MemoStyler.headingScale[max(0, min(2, read.level - 1))]
            Text(styler.swiftUI(line.units, read, base: base, scale: scale, hide: hide))
                .font(Font(text.font(scale: scale)).bold())
                .foregroundStyle(palette.ink)
                .modifier(OnTheLines(text: text, height: (text.line * scale).rounded()))
                .frame(maxWidth: .infinity, alignment: .leading)
        case .list, .olist:
            let styled = styler.swiftUI(line.units, read, base: base)
            let shown = hide ? styler.swiftUI(line.units, read, base: base, hide: true) : styled
            // Hidden marks (#84): a list's `- ` drawn as •, a number as it is.
            let bullet = hide && read.kind == .list
            let head = bullet ? AttributedString(String(decoding: line.units[..<read.markFrom], as: UTF16.self) + "• ") : split(styled, at: read.words).head
            HStack(alignment: .firstTextBaseline, spacing: 0) {
                Text(head).font(base).foregroundStyle(bullet ? palette.preview : palette.ink)
                Text(split(shown, at: bullet ? read.markFrom : read.words).tail).font(base).foregroundStyle(palette.ink)
                    .modifier(OnTheLines(text: text))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        case .quote:
            HStack(alignment: .top, spacing: MemoStyler.quoteIndent - 2) {
                Rectangle().fill(Color(nsColor: styler.faint)).frame(width: 2).padding(.vertical, 2)
                Text(styler.swiftUI(line.units, read, base: base, hide: hide)).font(base).foregroundStyle(palette.preview)
                    .modifier(OnTheLines(text: text))
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        case .rule:
            Text(hide ? AttributedString(" ") : styler.swiftUI(line.units, read, base: base)).font(base)
                .modifier(OnTheLines(text: text))
                .frame(maxWidth: .infinity, alignment: .leading)
                .background { Rectangle().fill(Color(nsColor: styler.faint)).frame(height: 1) }
        default:
            let words = String(decoding: line.units[..<read.end], as: UTF16.self)
            let code = !words.contains("`") && Checklist.isCode(words)
            Text(code ? AttributedString(words) : styler.swiftUI(line.units, read, base: base, hide: hide))
                .font(code ? Font(text.codeFont) : base)
                .foregroundStyle(palette.ink)
                .modifier(OnTheLines(text: text))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// The styled line cut where its words start (a list item's mark, then its words).
    private func split(_ styled: AttributedString, at offset: Int) -> (head: AttributedString, tail: AttributedString) {
        let words = String(decoding: line.units[..<line.read.end], as: UTF16.self)
        guard let cut = Range(NSRange(location: min(offset, (words as NSString).length), length: 0), in: words),
              let index = AttributedString.Index(cut.lowerBound, within: styled) else { return (AttributedString(), styled) }
        return (AttributedString(styled[..<index]), AttributedString(styled[index...]))
    }
}

/// An open memo's text: each line exactly the setting's line (보통 26 pt) tall, its words centred in it — the same lines
/// as while it's typed, so opening the editor doesn't move them.
struct OnTheLines: ViewModifier {
    var text = MemoText()
    /// A heading's taller line.
    var height: CGFloat?
    var lines: Int?

    func body(content: Content) -> some View {
        let line = height ?? text.line
        let spacing = max(0, line - MemoText.lineHeight(text.font()))
        content
            .lineSpacing(spacing)
            .lineLimit(lines)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, spacing / 2)
            .frame(minHeight: line)
    }
}

struct CheckBox: View {
    let checked: Bool
    let palette: DrawerPalette
    /// 15 in an open memo (#163; 13 before, the note's are 17–19); 11 on a card's preview (#14).
    var size: CGFloat = MemoBox.size
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let corner = size * 3.5 / 15
        ZStack {
            RoundedRectangle(cornerRadius: corner, style: .continuous).strokeBorder(palette.box, lineWidth: 1.2)
                .opacity(checked ? 0 : 1)
            // #163: ticked, the box fills (0.18 s) and its mark draws in; unticked, back quicker. Reduce motion: at once.
            RoundedRectangle(cornerRadius: corner, style: .continuous).fill(palette.check)
                .scaleEffect(checked ? 1 : 0.82)
                .opacity(checked ? 1 : 0)
            CheckMark()
                .trim(from: 0, to: checked ? 1 : 0)
                .stroke(palette.checkOn, style: StrokeStyle(lineWidth: size < 13 ? 1.5 : 1.9, lineCap: .round, lineJoin: .round))
        }
        .frame(width: size, height: size)
        .animation(checked ? Motion.animation(.enter, reduce: reduceMotion) : Motion.exit(.quick, reduce: reduceMotion), value: checked)
        // As generous as the note's boxes: about 25 × 25 round its middle.
        .contentShape(Rectangle().inset(by: -(MemoBox.target - size) / 2))
    }
}

/// The box's mark as two strokes (the editor's MemoBox draws the same), drawn in from its short arm.
struct CheckMark: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX + rect.width * 0.27, y: rect.minY + rect.height * 0.52))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.43, y: rect.minY + rect.height * 0.68))
        path.addLine(to: CGPoint(x: rect.minX + rect.width * 0.74, y: rect.minY + rect.height * 0.34))
        return path
    }
}

/// An open memo being typed: its raw text (boxes as `- [ ]`), the title in handwriting; its right-click is the
/// system's text menu with `이 메모` added.
/// M4 (#166): the memo that just came in rises into its place once with 등장 (8 pt, −0.6° straightened, as a slip
/// comes in); only that card, only as it is first drawn. Reduce Motion and snapshots: there at once.
struct MemoArrive: ViewModifier {
    let active: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var settled = false

    func body(content: Content) -> some View {
        let hidden = active && !settled && Motion.animation(.enter, reduce: reduceMotion) != nil
        content
            .opacity(hidden ? 0 : 1)
            .offset(y: hidden ? 8 : 0)
            .rotationEffect(.degrees(hidden ? -0.6 : 0))
            .onAppear {
                guard active, let animation = Motion.animation(.enter, reduce: reduceMotion) else { return }
                withAnimation(animation) { settled = true }
            }
    }
}

struct SlipEditor: View {
    @ObservedObject var drawer: MemoDrawer
    let memo: Memo
    let palette: DrawerPalette
    let font: NotebookFont
    var minHeight: CGFloat = 40
    @State private var text: String

    init(drawer: MemoDrawer, memo: Memo, palette: DrawerPalette, font: NotebookFont, minHeight: CGFloat = 40) {
        self.drawer = drawer
        self.memo = memo
        self.palette = palette
        self.font = font
        self.minHeight = minHeight
        _text = State(initialValue: memo.text)
    }

    var body: some View {
        let id = memo.id
        let memoText = drawer.text
        DrawerTextView(text: $text, palette: palette, bodyFont: memoText.font(), titleFont: font.handNSFont(MemoDrawerView.hand(22)),
                       titleStroke: font != .clean, lineHeight: memoText.line, titleLineHeight: MemoSlipStyle.titleRow,
                       onEscape: { drawer.collapse() }, focus: SlipMotion.enabled ? 1 : 0, caretLine: drawer.editLine, minHeight: minHeight,
                       onEdit: { old, new in drawer.edit(id, text: new, from: old) }, onBlur: { drawer.sendTyped() }, accessibilityLabel: L("메모 내용"),
                       extraMenu: { [weak drawer] in drawer.map { DrawerMenus.textSection($0, id) } ?? [] }, menuDrawer: drawer, markdown: memoText)
            .focusEffectDisabled()
            .onChange(of: memo.text) { _, newer in
                guard newer != text else { return }
                // Another change while keys wait here: they go first and are joined with it; the joined text comes
                // back through here.
                if drawer.isWaiting(id) { drawer.sendTyped() } else { text = newer }
            }
    }
}

/// 크게 보기: one memo the drawer's whole height, typed in place; ⤡ or Esc back to the list.
struct BigSlip: View {
    @ObservedObject var drawer: MemoDrawer
    let memo: Memo
    let palette: DrawerPalette
    let font: NotebookFont

    var body: some View {
        let folder = drawer.folders.folder(drawer.folders.folderID(of: memo.id))?.colorKey ?? .lavender
        let sheet = drawer.folders.paper(of: memo.id).map { DrawerPalette.of(DrawerPalette.Kind(rawValue: $0.rawValue)!) } ?? palette
        VStack(alignment: .leading, spacing: 0) {
            ScrollView {
                SlipEditor(drawer: drawer, memo: memo, palette: sheet, font: font, minHeight: 300)
                    .padding(.bottom, 8)
            }
            .scrollIndicators(.automatic)
            if drawer.linkEdit != nil { LinkBar(drawer: drawer, palette: sheet).padding(.bottom, 6) }
            if drawer.formatBarOpen { FormatBar(drawer: drawer, palette: sheet).padding(.bottom, 6) }
            MemoBar(drawer: drawer, memo: memo, palette: sheet, big: true)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .modifier(MemoSlipStyle(palette: sheet, drawer: palette, state: .init(open: true, folder: folder, big: true, floating: drawer.shownBackdrop == .none)))
    }
}

/// A search result (#114): the list's card — its tape, the handwritten title, the date (MemoCards.foundTime) — with the
/// found line in the preview's place (brought near its start, the query on a tint); a match in the title is marked there
/// with the next line under it, and a result the chips alone picked shows its preview rows. Its folder is the group's.
struct SearchSlip: View {
    @ObservedObject var drawer: MemoDrawer
    let hit: MemoFolders.Hit
    let palette: DrawerPalette
    let font: NotebookFont

    var body: some View {
        let memo = drawer.memo(hit.memoID)
        let selected = drawer.selectedID == hit.memoID
        let color = drawer.folders.folder(hit.folderID)?.colorKey ?? .lavender
        let sheet = drawer.folders.paper(of: hit.memoID).map { DrawerPalette.of(DrawerPalette.Kind(rawValue: $0.rawValue)!) } ?? palette
        let found = MemoFolders.snippet(hit.text, range: hit.range)
        Button { drawer.reveal(hit.memoID) } label: {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    CardTitle(words: Text(onTitle ? highlighted(found, sheet) : AttributedString(title.handwritten)), font: font, color: sheet.ink)
                    Spacer(minLength: 4)
                    if let memo { TimeText(text: MemoCards.foundTime(memo.updatedAt, now: drawer.now(), language: .current), palette: sheet) }
                }
                .frame(height: MemoSlipStyle.titleRow)
                if hit.range != nil, !onTitle {
                    // #198: the found line in the words' face, as the card's preview (a code line in the code face).
                    Text(highlighted(found, sheet))
                        .font(Font(Checklist.isCode(hit.text) ? drawer.text.previewCodeFont : drawer.text.previewFont))
                        .foregroundStyle(sheet.preview)
                        .modifier(PreviewLines(text: drawer.text, limit: 2))
                } else if let memo, case let rows = drawer.card(memo).rows, !rows.isEmpty {
                    PreviewRows(rows: rows, limit: 2, palette: sheet, text: drawer.text)
                }
            }
            .modifier(MemoSlipStyle(palette: sheet, drawer: palette, state: .init(selected: selected, folder: color,
                                                                                  minHeight: MemoSlipStyle.denseHeight,
                                                                                  floating: drawer.shownBackdrop == .none)))
        }
        .buttonStyle(.plain)
        .overlay(alignment: .top) { CardTape(id: hit.memoID, color: palette.tab(color).tape) }
    }

    private var title: String { drawer.memo(hit.memoID).map { drawer.cardTitle($0) } ?? "" }
    /// The match is in the title line: marked there, the next line under it.
    private var onTitle: Bool {
        guard hit.range != nil, let memo = drawer.memo(hit.memoID) else { return false }
        return hit.text == Checklist.summary(memo.text, language: .current).title
    }

    /// The query's letters on the check colour's tint.
    private func highlighted(_ found: (text: String, range: Range<Int>?), _ sheet: DrawerPalette) -> AttributedString {
        var text = AttributedString(found.text)
        guard let range = found.range else { return text }
        let scalars = Array(found.text.precomposedStringWithCanonicalMapping.unicodeScalars)
        guard range.upperBound <= scalars.count else { return text }
        let before = String(String.UnicodeScalarView(scalars[..<range.lowerBound])).count
        let inside = String(String.UnicodeScalarView(scalars[range])).count
        let chars = text.characters
        guard before + inside <= chars.count else { return text }
        let start = chars.index(chars.startIndex, offsetBy: before), end = chars.index(start, offsetBy: inside)
        text[start..<end].backgroundColor = sheet.check.opacity(sheet.scheme == .dark ? 0.35 : 0.22)
        text[start..<end].foregroundColor = sheet.ink
        return text
    }
}

/// A date group's header (Apple Notes style): a small label, its count, a hairline to the edge. 바탕 없음: the label
/// sits on a small sheet-coloured pill so it reads over the desktop.
struct DrawerGroupHeader: View {
    let title: String
    let count: Int
    let pinned: Bool
    let palette: DrawerPalette
    let floating: Bool

    var body: some View {
        HStack(spacing: 6) {
            HStack(spacing: 5) {
                if pinned {
                    Image(systemName: "pin.fill").font(.system(size: 9.5)).foregroundStyle(palette.paw)
                }
                Text(title).font(.system(size: 11, weight: .medium)).foregroundStyle(palette.groupHeader)
                Text("\(count)").font(.system(size: 11).monospacedDigit()).foregroundStyle(palette.faint)
            }
            .padding(.horizontal, floating ? 8 : 0)
            .padding(.vertical, floating ? 2 : 0)
            .background { if floating { Capsule().fill(palette.sheet).shadow(color: .black.opacity(0.18), radius: 3, y: 1) } }
            .fixedSize()
            if !floating {
                Rectangle().fill(palette.edge.opacity(0.6)).frame(height: 1)
            } else {
                Spacer(minLength: 0)
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, 4)
        .padding(.bottom, 8)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
