import AppKit
import PaperCore
import SwiftUI

// 메모 서랍's cards (1.44, design ③ 날짜 묶음 + 카드): every card the same places — the title (the short time or the
// paw at its right), one preview line, and a kind row when a link, a phone number or a checklist is found (a chip at
// the left, the time at the right). A piece of tape on every card. Opened in place: its text, then the bar —
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
        let sheet = sheet
        VStack(alignment: .leading, spacing: 0) {
            if expanded {
                OpenMemo(drawer: drawer, memo: memo, palette: sheet, font: font)
            } else {
                closed(sheet)
            }
        }
        .modifier(MemoSlipStyle(palette: sheet, drawer: palette,
                                state: .init(open: expanded, selected: selected, folder: folderColor,
                                             minHeight: expanded ? 0 : (drawer.dense ? MemoSlipStyle.denseHeight : MemoSlipStyle.cardHeight),
                                             floating: drawer.shownBackdrop == .none, dense: drawer.dense && !expanded)))
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
        .draggableIf(!expanded, "memo:" + memo.id) { DragCard(title: MemoCards.title(memo.text, language: .current), palette: sheet, font: font) }
        .accessibilityElement(children: expanded ? .contain : .combine)
        .accessibilityAddTraits(expanded ? [] : .isButton)
        .accessibilityAction { drawer.expand(memo.id) }
    }

    @ViewBuilder private func closed(_ sheet: DrawerPalette) -> some View {
        let card = drawer.card(memo)
        let title = card.title, preview = card.preview, kind = card.kind
        let time = MemoCards.shortTime(drawer.sortDate(memo), in: group, now: drawer.now(), language: .current)
        let paw = pinned && group == .pinned
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(title.handwritten)
                    .font(font.handFont(MemoDrawerView.hand(20)))
                    .foregroundStyle(sheet.ink)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Spacer(minLength: 4)
                if paw {
                    Image(systemName: "pawprint.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(sheet.paw)
                        .accessibilityLabel(L("고정"))
                }
                if kind == nil { TimeText(text: time, palette: sheet) }
            }
            .frame(height: MemoSlipStyle.titleRow)
            if let preview {
                Text(verbatim: Checklist.isCode(preview) ? preview : preview.keepingParticles)
                    .font(Checklist.isCode(preview) ? .system(size: 11.5, design: .monospaced) : .system(size: MemoSlipStyle.bodySize))
                    .foregroundStyle(sheet.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .frame(height: MemoSlipStyle.line)
            }
            if let kind {
                KindRow(drawer: drawer, kind: kind, time: time, palette: sheet)
                    .frame(height: MemoSlipStyle.line)
            }
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
            BarButton(symbol: pinned ? "pawprint.fill" : "pawprint", palette: palette, help: pinned ? L("고정 풀기") : L("고정하기"), tint: pinned ? palette.check : nil) {
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

/// A small round button on the bar and the hover pill: 15 pt thin icons.
struct BarButton: View {
    let symbol: String
    let palette: DrawerPalette
    let help: String
    var tint: Color?
    var role: Color?
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 13, weight: .light))
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
    let items: @MainActor () -> [DrawerMenuItem]
    @State private var hovering = false

    var body: some View {
        Image(systemName: symbol)
            .font(.system(size: 13, weight: .light))
            .foregroundStyle(palette.icon)
            .frame(width: 24, height: 24)
            .background(palette.ink.opacity(hovering ? 0.08 : 0), in: Capsule())
            .onHover { hovering = $0 }
            .overlay { DrawerMenuButtonArea(drawer: drawer, label: help, items: items) }
    }
}

/// A memo open in place: its boxes to tick (or its text to type), then the bar.
struct OpenMemo: View {
    @ObservedObject var drawer: MemoDrawer
    let memo: Memo
    let palette: DrawerPalette
    let font: NotebookFont

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if drawer.editing {
                SlipEditor(drawer: drawer, memo: memo, palette: palette, font: font)
            } else {
                CheckedText(drawer: drawer, memo: memo, palette: palette, font: font)
            }
            MemoBar(drawer: drawer, memo: memo, palette: palette, big: false)
                .padding(.top, 8)
        }
    }
}

/// The open memo's bar (SideNotes): [크게 보기 · 복사 · ⚙] · `5:38 고침` · [폴더로 옮기기 · 지우기].
struct MemoBar: View {
    @ObservedObject var drawer: MemoDrawer
    let memo: Memo
    let palette: DrawerPalette
    let big: Bool

    var body: some View {
        HStack(spacing: 6) {
            BarPill(palette: palette) {
                BarButton(symbol: big ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right", palette: palette,
                          help: big ? L("작게 보기") : L("크게 보기")) {
                    if big { drawer.bigID = nil } else { drawer.showBig(memo.id) }
                }
                BarButton(symbol: "doc.on.doc", palette: palette, help: L("복사 (⇧⌘C)")) { drawer.copy(memo.id) }
                BarMenuButton(drawer: drawer, symbol: "gearshape", palette: palette, help: L("이 메모")) { DrawerMenus.memoGear(drawer, memo.id) }
            }
            // Narrow drawers: `오후 5:38 고침`, else just the time, else nothing.
            ViewThatFits(in: .horizontal) {
                when(MemoCards.edited(memo.updatedAt, now: drawer.now(), language: .current))
                when(MemoCards.dayTime(memo.updatedAt, now: drawer.now(), language: .current))
                Color.clear.frame(height: 1)
            }
            BarPill(palette: palette) {
                BarMenuButton(drawer: drawer, symbol: "tray.and.arrow.down", palette: palette, help: L("폴더로 옮기기")) { DrawerMenus.move(drawer, memo.id) }
                BarButton(symbol: "trash", palette: palette, help: L("지우기 (⌘⌫)"), role: palette.danger) { drawer.delete(memo.id) }
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
            .frame(maxWidth: .infinity)
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

/// An open memo with checklist lines: the title, each line (boxes to tick), a click on the words to type.
struct CheckedText: View {
    @ObservedObject var drawer: MemoDrawer
    let memo: Memo
    let palette: DrawerPalette
    let font: NotebookFont

    var body: some View {
        let lines = Checklist.split(memo.text)
        let titleIndex = lines.firstIndex { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(lines.enumerated()), id: \.offset) { index, raw in
                let line = raw.trimmingCharacters(in: .newlines)
                if let item = Checklist.lines(raw).first {
                    HStack(alignment: .firstTextBaseline, spacing: 7) {
                        Button { drawer.model.toggleChecklist(memo.id, line: index) } label: {
                            CheckBox(checked: item.checked, palette: palette)
                        }
                        .buttonStyle(.plain)
                        .alignmentGuide(.firstTextBaseline) { $0[VerticalAlignment.center] + 4 }
                        .accessibilityLabel(item.text)
                        .accessibilityValue(item.checked ? L("끝냄") : L("안 끝냄"))
                        Text(verbatim: item.text.keepingParticles)
                            .font(.system(size: MemoSlipStyle.bodySize))
                            .foregroundStyle(item.checked ? palette.faint : palette.ink)
                            .strikethrough(item.checked, color: palette.faint)
                            .modifier(OnTheRules())
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                            .onTapGesture { edit(at: index) }
                    }
                } else if index == titleIndex {
                    Text(line.trimmingCharacters(in: .whitespaces).handwritten)
                        .font(font.handFont(MemoDrawerView.hand(20)))
                        .foregroundStyle(palette.ink)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, minHeight: MemoSlipStyle.titleRow, maxHeight: MemoSlipStyle.titleRow, alignment: .leading)
                        .contentShape(Rectangle())
                        .onTapGesture { edit(at: index) }
                } else if !line.trimmingCharacters(in: .whitespaces).isEmpty {
                    Text(verbatim: Checklist.isCode(line) ? line : line.keepingParticles)
                        .font(Checklist.isCode(line) ? .system(size: 11.5, design: .monospaced) : .system(size: MemoSlipStyle.bodySize))
                        .foregroundStyle(palette.ink)
                        .modifier(OnTheRules())
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                        .onTapGesture { edit(at: index) }
                }
            }
        }
    }

    private func edit(at line: Int) {
        drawer.editLine = line
        drawer.editing = true
    }
}

/// Text whose lines sit one per rule of the memo sheet (22 pt each, centred in its band).
struct OnTheRules: ViewModifier {
    var lines: Int?

    func body(content: Content) -> some View {
        content
            .lineSpacing(MemoSlipStyle.lineSpacing)
            .lineLimit(lines)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.vertical, MemoSlipStyle.lineSpacing / 2)
            .frame(minHeight: MemoSlipStyle.line)
    }
}

struct CheckBox: View {
    let checked: Bool
    let palette: DrawerPalette

    var body: some View {
        RoundedRectangle(cornerRadius: 3, style: .continuous)
            .fill(checked ? palette.check : .clear)
            .overlay {
                if !checked { RoundedRectangle(cornerRadius: 3, style: .continuous).strokeBorder(palette.box, lineWidth: 1.2) }
            }
            .overlay {
                if checked { Image(systemName: "checkmark").font(.system(size: 7.5, weight: .bold)).foregroundStyle(palette.checkOn) }
            }
            .frame(width: 13, height: 13)
            .contentShape(Rectangle().inset(by: -4))
    }
}

/// An open memo being typed: its raw text (boxes as `- [ ]`), the title in handwriting; its right-click is the
/// system's text menu with `이 메모` added.
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
        DrawerTextView(text: $text, palette: palette, bodyFont: .systemFont(ofSize: MemoSlipStyle.bodySize), titleFont: font.handNSFont(MemoDrawerView.hand(20)),
                       lineHeight: MemoSlipStyle.line, titleLineHeight: MemoSlipStyle.titleRow,
                       onEscape: { drawer.collapse() }, focus: SlipMotion.enabled ? 1 : 0, caretLine: drawer.editLine, minHeight: minHeight,
                       onEdit: { old, new in drawer.edit(id, text: new, from: old) }, accessibilityLabel: L("메모 내용"),
                       extraMenu: { [weak drawer] in drawer.map { DrawerMenus.textSection($0, id) } ?? [] }, menuDrawer: drawer)
            .onChange(of: memo.text) { _, newer in if newer != text { text = newer } }
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
            MemoBar(drawer: drawer, memo: memo, palette: sheet, big: true)
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .modifier(MemoSlipStyle(palette: sheet, drawer: palette, state: .init(open: true, folder: folder, big: true, floating: drawer.shownBackdrop == .none)))
    }
}

/// A search result: the matching line (the query on a tint), the memo's folder small at the right.
struct SearchSlip: View {
    @ObservedObject var drawer: MemoDrawer
    let hit: MemoFolders.Hit
    let palette: DrawerPalette
    let font: NotebookFont

    var body: some View {
        let memo = drawer.memo(hit.memoID)
        let selected = drawer.selectedID == hit.memoID
        let folder = drawer.folders.folder(hit.folderID)
        let sheet = drawer.folders.paper(of: hit.memoID).map { DrawerPalette.of(DrawerPalette.Kind(rawValue: $0.rawValue)!) } ?? palette
        Button { drawer.reveal(hit.memoID) } label: {
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(onTitle ? highlighted(sheet) : AttributedString(title.handwritten))
                        .font(font.handFont(MemoDrawerView.hand(19)))
                        .foregroundStyle(sheet.ink)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if let memo { TimeText(text: MemoCards.dayTime(memo.updatedAt, now: drawer.now(), language: .current), palette: sheet) }
                    if let folder {
                        let colors = palette.tab(folder.colorKey)
                        Text(folder.displayName(.current))
                            .font(.system(size: 10.5, weight: .medium))
                            .foregroundStyle(colors.ink)
                            .lineLimit(1)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1.5)
                            .background(colors.a, in: Capsule())
                            .fixedSize()
                    }
                }
                .frame(height: MemoSlipStyle.titleRow)
                if !onTitle {
                    Text(highlighted(sheet))
                        .font(.system(size: MemoSlipStyle.bodySize))
                        .foregroundStyle(sheet.secondary)
                        .modifier(OnTheRules(lines: 2))
                } else if let next = memo.flatMap({ MemoCards.preview($0.text) }) {
                    Text(verbatim: next.keepingParticles)
                        .font(.system(size: MemoSlipStyle.bodySize))
                        .foregroundStyle(sheet.secondary)
                        .lineLimit(1)
                        .frame(height: MemoSlipStyle.line)
                }
            }
            .modifier(MemoSlipStyle(palette: sheet, drawer: palette, state: .init(selected: selected, folder: folder?.colorKey ?? .lavender,
                                                                                  floating: drawer.shownBackdrop == .none)))
        }
        .buttonStyle(.plain)
    }

    private var title: String { drawer.memo(hit.memoID).map { MemoCards.title($0.text, language: .current) } ?? "" }
    /// The match is in the title line: marked there, the next line under it.
    private var onTitle: Bool {
        guard hit.range != nil, let memo = drawer.memo(hit.memoID) else { return false }
        return hit.text == Checklist.summary(memo.text, language: .current).title
    }

    /// The query's letters on the check colour's tint.
    private func highlighted(_ sheet: DrawerPalette) -> AttributedString {
        var text = AttributedString(hit.text)
        guard let range = hit.range else { return text }
        let scalars = Array(hit.text.precomposedStringWithCanonicalMapping.unicodeScalars)
        guard range.upperBound <= scalars.count else { return text }
        let before = String(String.UnicodeScalarView(scalars[..<range.lowerBound])).count
        let inside = String(String.UnicodeScalarView(scalars[range])).count
        let chars = text.characters
        guard before + inside <= chars.count else { return text }
        let start = chars.index(chars.startIndex, offsetBy: before), end = chars.index(start, offsetBy: inside)
        text[start..<end].backgroundColor = sheet.check.opacity(sheet.kind == .night ? 0.35 : 0.22)
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
                    Image(systemName: "pawprint.fill").font(.system(size: 9.5)).foregroundStyle(palette.paw)
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
