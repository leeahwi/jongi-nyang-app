import AppKit
import PaperCore
import SwiftUI

/// 메모 서랍 (1.43; 1.44 design ③): the drawer as it comes out of the screen's edge — bookmarks for the folders on its
/// inner side, the paper with its cat ears, the 메모 서랍 line and the folder's name (▾ opens the folder list), the
/// quick-write slip with its tape, the memos as cards under date headers, and the footer (⚙, the count, the shortcut).
/// 바탕: the paper solid, see-through over a blur (the panel draws the blur), or none at all (the sheets float).
struct MemoDrawerView: View {
    @ObservedObject var drawer: MemoDrawer
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// How tall the bookmarks are (#164: the close tab goes under them when they reach the middle).
    @State private var bookmarksHeight: CGFloat = 0

    static let tabsWidth: CGFloat = 34
    /// Room above the paper for its cat ears (DrawerCat).
    static let catRoom: CGFloat = DrawerCat.earHeight + 2
    /// Room on the inner side for the shadow.
    static let shadowRoom: CGFloat = 14
    /// Handwriting in the drawer: the Latin faces (Caveat, Kalam) run larger than the Korean one at the same size, so
    /// English and Dutch use 90 % (like the note's tabs).
    static func hand(_ size: CGFloat) -> CGFloat { AppLanguage.current == .ko ? size : (size * 0.9).rounded() }

    /// The picked bookmark covers the paper's edge by this much.
    static let tabOverlap: CGFloat = 2

    private var palette: DrawerPalette { drawer.palette(scheme) }
    private var right: Bool { drawer.side == .right }
    private var font: NotebookFont { drawer.titleFont }
    private var backdrop: MemoDrawer.Backdrop { drawer.shownBackdrop }
    private var floating: Bool { backdrop == .none }

    var body: some View {
        HStack(alignment: .top, spacing: 0) {
            if right {
                Color.clear.frame(width: Self.shadowRoom)
                tabs
                paper
            } else {
                paper
                tabs
                Color.clear.frame(width: Self.shadowRoom)
            }
        }
        .environment(\.colorScheme, palette.scheme)
        .environment(\.layoutDirection, .leftToRight)
    }

    // MARK: The paper

    private var paperShape: UnevenRoundedRectangle {
        right ? UnevenRoundedRectangle(topLeadingRadius: 14, bottomLeadingRadius: 14, style: .continuous)
            : UnevenRoundedRectangle(bottomTrailingRadius: 14, topTrailingRadius: 14, style: .continuous)
    }

    private var paper: some View {
        VStack(spacing: 0) {
            header
            if drawer.searching {
                searchResults
            } else if let id = drawer.bigID, let memo = drawer.memo(id) {
                BigSlip(drawer: drawer, memo: memo, palette: palette, font: font)
                    .padding(.horizontal, 10)
                    .padding(.top, 6)
                    .padding(.bottom, 10)
            } else {
                QuickSlip(drawer: drawer, palette: palette, font: font, tape: tapeColor, floating: floating)
                    .padding(.horizontal, 14)
                    .padding(.top, 8)
                    .padding(.bottom, 14)
                list
            }
            footer
        }
        // The window's width less the bookmarks (and the shadow): the user's, or 크게 보기's while it slides wider (#113).
        .frame(minWidth: drawer.width, maxWidth: .infinity)
        .frame(maxHeight: .infinity)
        .background(alignment: .top) {
            if !floating {
                PaperBack(palette: palette, shape: DrawerPaperShape(right: right), opacity: backdrop.paperOpacity,
                          desktop: drawer.previewDesktop && backdrop != .opaque, strong: backdrop == .strong)
                    .overlay(alignment: .top) { DrawerCat(palette: palette, right: right) }
                    .padding(.top, -DrawerCat.earHeight)
            } else {
                // Nearly nothing, so a right-click or a scroll between the floating sheets still lands in the drawer.
                Color.white.opacity(0.005)
            }
        }
        // A right-click on the empty paper or the header: the ⚙ menu (cards and bookmarks have their own).
        .background { DrawerContextArea(drawer: drawer) { DrawerMenus.drawer(drawer) } }
        .overlay(alignment: .bottom) { toast }
        .overlay { folderSheet }
        .overlay { trashSheet }
        // 크게 보기 has its own width (#113): the edge doesn't resize while it shows.
        .overlay(alignment: right ? .leading : .trailing) { if drawer.bigID == nil { WidthGrip(drawer: drawer) } }
        // #164: 서랍 닫기 is no longer on the paper: it is a tab outside it, beside the bookmarks (`tabs`).
        .padding(.top, Self.catRoom)
    }

    private var tapeColor: Color {
        switch drawer.tab {
        case .pinned: palette.pinTape
        case .folder: palette.tab(drawer.currentFolder?.colorKey ?? .lavender).tape
        }
    }

    // MARK: Header

    private var title: String {
        if drawer.searching { return L("모든 폴더") }
        switch drawer.tab {
        case .pinned: return L("고정")
        case .folder: return drawer.currentFolder?.displayName(.current) ?? ""
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(L("메모 서랍"))
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(palette.label)
            HStack(alignment: .center, spacing: 6) {
                if drawer.searching {
                    SearchField(drawer: drawer, palette: palette)
                } else {
                    FolderName(drawer: drawer, title: title, palette: palette, font: font)
                }
                Spacer(minLength: 4)
                HStack(spacing: 2) {
                    DrawerIconButton(symbol: drawer.searching ? "xmark.circle" : "magnifyingglass", palette: palette,
                                     help: drawer.searching ? L("검색 닫기") : L("검색 (⌘F)")) { drawer.toggleSearch() }
                    // #83: no × here any more; the small bar on the paper's inner edge closes the drawer (and Esc, the shortcut).
                    // #111: nor the pin — 다른 창 위에 띄우기 is in the ⚙ menu and Desk → 메모 서랍 (it read as 고정).
                }
                .padding(.top, 4)
            }
            .frame(minHeight: 40)
            // #114: where to look and what to keep to, under the field.
            if drawer.searching {
                SearchChips(drawer: drawer, palette: palette)
                    .padding(.top, 6)
                    .padding(.bottom, 4)
            }
        }
        .padding(.top, floating ? 6 : 8)
        .padding(.horizontal, floating ? 12 : 16)
        .padding(.bottom, floating ? 6 : 2)
        .background {
            // 바탕 없음: the header floats as a pill of sheet paper.
            if floating {
                RoundedRectangle(cornerRadius: 16, style: .continuous).fill(palette.sheet)
                    .shadow(color: .black.opacity(0.22), radius: 7, y: 3)
            }
        }
        .padding(.horizontal, floating ? 8 : 0)
        .padding(.top, floating ? 4 : 0)
    }

    // MARK: The list

    private var list: some View {
        // Worked out once per change (the footer and every card read the same).
        let shown = drawer.list
        let sections = shown.sections, byID = shown.byID
        let hasPinned = sections.contains { $0.group == .pinned }
        let gap: CGFloat = shown.titles ? MemoTitleRow.gap : (shown.dense ? 12 : 16)
        return ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(sections, id: \.group) { section in
                        if section.group != .rest || hasPinned {
                            DrawerGroupHeader(title: MemoCards.header(section.group, now: drawer.now(), language: .current), count: section.ids.count,
                                        pinned: section.group == .pinned, palette: palette, floating: floating)
                        }
                        ForEach(section.ids, id: \.self) { id in
                            if let memo = byID[id] {
                                // #115: 제목만 — one line a memo; the open one is its card, where it was.
                                if shown.titles && drawer.expandedID != id {
                                    MemoTitleRow(drawer: drawer, memo: memo, palette: palette, font: font, group: section.group)
                                        .padding(.bottom, gap)
                                        .id(id)
                                } else {
                                    MemoCard(drawer: drawer, memo: memo, palette: palette, font: font, group: section.group)
                                        .padding(.bottom, shown.titles ? 10 : gap)
                                        .padding(.top, shown.titles ? 4 : 0)
                                        .id(id)
                                }
                            }
                        }
                    }
                    if sections.isEmpty { emptyNote }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 14)
                // M3: a memo opened or put away, the cards under it move with 바뀜 (Motion; none under Reduce Motion).
                .animation(Motion.animation(.change, reduce: reduceMotion), value: drawer.expandedID)
            }
            .scrollIndicators(.never)
            .onChange(of: drawer.selectedID) { _, id in
                guard let id else { return }
                withAnimation(Motion.animation(.quick, reduce: reduceMotion)) { proxy.scrollTo(id) }
            }
        }
    }

    private var emptyNote: some View {
        VStack(spacing: 6) {
            // The app's empty-sheet cat, small, inside the drawer.
            Image(nsImage: MemoDrawerArt.emptyCat)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(width: 58, height: 58)
                .accessibilityHidden(true)
            Text(drawer.tab == .pinned ? L("메모를 펼쳐 핀을 누르면 여기에 모여요.") : L("위 쪽지에 적거나, 다른 폴더의 메모를 이\u{00A0}책갈피로 끌어 와 보세요.").keepingParticles)
                .font(.system(size: 12))
                .foregroundStyle(palette.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 22)
        .padding(.vertical, floating ? 12 : 0)
        .background { if floating { RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.sheet) } }
        .padding(.top, 28)
        .frame(maxWidth: .infinity)
    }

    /// #114: the results by folder (MemoDrawerSearch.swift).
    private var searchResults: some View {
        DrawerSearchResults(drawer: drawer, palette: palette, font: font, floating: floating)
    }

    // MARK: Footer

    private var footerText: String {
        if drawer.searching { return MemoFolders.searchFooter(count: drawer.hits.count, folders: drawer.found.count, language: .current) }
        switch drawer.tab {
        case .pinned: return MemoFolders.pinnedFooterShort(count: drawer.shown.count, language: .current)
        case .folder: return MemoFolders.footerShort(folder: drawer.currentFolder?.displayName(.current) ?? "", count: drawer.shown.count, language: .current)
        }
    }

    private var footer: some View {
        HStack(spacing: 8) {
            GearButton(drawer: drawer, palette: palette)
            HStack(spacing: 5) {
                Image(systemName: "pawprint.fill")
                    .font(.system(size: 10))
                    .foregroundStyle(palette.paw)
                    .accessibilityHidden(true)
                Text(footerText.keepingParticles)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .padding(.horizontal, floating ? 9 : 0)
            .padding(.vertical, floating ? 4 : 0)
            .background { if floating { Capsule().fill(palette.sheet).shadow(color: .black.opacity(0.2), radius: 4, y: 2) } }
            Spacer(minLength: 8)
            if let shortcut = drawer.shortcut {
                Text(shortcut.text)
                    .font(.system(size: 10.5).monospacedDigit())
                    .lineLimit(1)
                    .fixedSize()
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background { if floating { RoundedRectangle(cornerRadius: 5).fill(palette.sheet) } }
                    .overlay { RoundedRectangle(cornerRadius: 5).strokeBorder(palette.pillEdge, lineWidth: 0.5) }
                    .help(L("\(shortcut.text)로 열고 닫아요"))
            }
        }
        .font(.system(size: 11))
        .foregroundStyle(palette.faint)
        .padding(.horizontal, 12)
        .frame(height: 44)
        .overlay(alignment: .top) { if !floating { Rectangle().fill(palette.edge.opacity(palette.kind == .day ? 0.6 : 1)).frame(height: 0.5) } }
    }

    // MARK: Toast

    /// M14 (#166): as the note's toast (N10), it rises 6 pt as it comes in with 등장 and fades with 살짝 as it goes; at
    /// once under Reduce Motion and in snapshots (`toastMotion`). The ZStack stays, so the toast's coming and going animate.
    private var toast: some View {
        ZStack {
            if let toast = drawer.toast { toastSlip(toast) }
        }
        .toastMotion(shown: drawer.toast != nil)
    }

    private func toastSlip(_ toast: MemoDrawer.DrawerToast) -> some View {
        HStack(spacing: 10) {
            Text(toast.text.keepingParticles)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            if let action = toast.action {
                Button(action) { drawer.performToast() }
                    .buttonStyle(.plain)
                    .fontWeight(.semibold)
                    .underline()
            }
        }
        .font(.system(size: 12))
        .foregroundStyle(palette.toastText)
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .background(palette.toast, in: RoundedRectangle(cornerRadius: 9, style: .continuous))
        .shadow(color: .black.opacity(0.18), radius: 6, y: 2)
        .padding(.horizontal, 16)
        .padding(.bottom, 52)
        .transition(.toast)
        .id(toast.id)
    }

    // MARK: Folder sheet

    @ViewBuilder private var folderSheet: some View {
        if drawer.folderSheet != nil {
            ZStack(alignment: .top) {
                paperShape.fill(Color.black.opacity(palette.scheme == .dark ? 0.35 : 0.12))
                    .onTapGesture { drawer.folderSheet = nil }
                FolderSheetView(drawer: drawer, palette: palette, font: font)
                    .padding(.horizontal, 14)
                    .padding(.top, 74)
            }
        }
    }

    /// 지운 메모 (#120): its slip over the paper, as the folder sheet (MemoDrawerTrash.swift).
    @ViewBuilder private var trashSheet: some View {
        if drawer.trashOpen {
            ZStack(alignment: .top) {
                paperShape.fill(Color.black.opacity(palette.scheme == .dark ? 0.35 : 0.12))
                    .onTapGesture { drawer.closeTrash() }
                TrashSheetView(drawer: drawer, palette: palette, font: font)
                    .padding(.horizontal, 14)
                    .padding(.top, 74)
            }
        }
    }

    // MARK: Bookmarks

    /// The bookmarks, and #164's 서랍 닫기: a tab out of the paper's inner edge, as the handle comes out of the screen's — in
    /// the middle of the edge, or 12 pt under the bookmarks when they reach that far; when there's no room for it there
    /// (a short screen, many folders) it keeps the lowest place above the footer and the bookmarks scroll above it.
    private var tabs: some View {
        GeometryReader { geometry in
            let height = geometry.size.height
            let room = CloseTab.room.height
            let middle = Self.catRoom + (height - Self.catRoom) / 2
            let lowest = max(middle, height - room / 2 - 52)
            let wanted = max(middle, Self.bookmarksTop + bookmarksHeight + 12 + room / 2)
            let y = min(wanted, lowest)
            ZStack(alignment: .top) {
                bookmarks.frame(height: wanted > lowest ? max(0, y - room / 2 - 12) : height, alignment: .top)
                CloseTab(drawer: drawer)
                    .position(x: right ? geometry.size.width - Self.tabOverlap - CloseTab.room.width / 2 : Self.tabOverlap + CloseTab.room.width / 2, y: y)
            }
        }
        .frame(width: Self.tabsWidth + Self.tabOverlap)
        .padding(right ? .trailing : .leading, -Self.tabOverlap)
        .zIndex(1)
    }

    static let bookmarksTop = catRoom + 104

    private var bookmarks: some View {
        ScrollView(.vertical) {
            let visible = drawer.folders.visible
            // #116: first letters that collide among the un-picked bookmarks get a second one. #114: the folder shown stays
            // picked while searching.
            let picked = visible.firstIndex { drawer.tab == .folder($0.id) }
            let letters = MemoFolders.bookmarkLetters(visible.map { $0.displayName(.current) }, picked: picked)
            VStack(alignment: right ? .trailing : .leading, spacing: 5) {
                ForEach(Array(visible.enumerated()), id: \.element.id) { index, folder in
                    FolderTab(drawer: drawer, folder: folder, number: index + 1, letters: letters[index], palette: palette, font: font, right: right)
                }
                PinTab(drawer: drawer, palette: palette, right: right)
                AddTab(drawer: drawer, palette: palette, right: right)
            }
            .frame(width: Self.tabsWidth + Self.tabOverlap, alignment: right ? .trailing : .leading)
            // Its height (not where it is): scrolling the bookmarks never moves the close tab.
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { bookmarksHeight = $0 }
            .padding(.top, Self.bookmarksTop)
            .padding(.bottom, 40)
        }
        .scrollIndicators(.never)
        .frame(width: Self.tabsWidth + Self.tabOverlap)
    }
}

/// The folder's name in the header with its ▾: a click (or ⌘L) opens the folder list.
private struct FolderName: View {
    @ObservedObject var drawer: MemoDrawer
    let title: String
    let palette: DrawerPalette
    let font: NotebookFont
    @State private var hovering = false

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 5) {
            Text(title.handwritten)
                .font(font.handFont(MemoDrawerView.hand(31)))
                .foregroundStyle(palette.title)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .accessibilityAddTraits(.isHeader)
            Image(systemName: "chevron.down")
                .font(.system(size: 9.5, weight: .semibold))
                .foregroundStyle(palette.faint)
                // #119: VoiceOver read the symbol's own name (‘아래로 이동’); the menu button says what it does.
                .accessibilityHidden(true)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 1)
        .background(palette.pill.opacity(hovering ? 1 : 0), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .padding(.leading, -6)
        .onHover { hovering = $0 }
        .overlay {
            DrawerMenuButtonArea(drawer: drawer, label: L("폴더 목록 (⌘L)"), items: { DrawerMenus.folderList(drawer) },
                                 register: { [weak drawer] open in drawer?.openFolderList = open },
                                 registerPop: { [weak drawer] pop in drawer?.popUnderName = pop })
        }
    }
}

/// The footer's round ⚙: the drawer's menu (the same as a right-click on its empty paper).
private struct GearButton: View {
    @ObservedObject var drawer: MemoDrawer
    let palette: DrawerPalette
    @State private var hovering = false

    var body: some View {
        Image(systemName: "gearshape")
            .font(.system(size: 13, weight: .light))
            .foregroundStyle(palette.icon)
            .accessibilityHidden(true)
            .frame(width: 26, height: 26)
            .background(drawer.shownBackdrop == .none ? palette.sheet : palette.pill, in: Circle())
            .background(palette.ink.opacity(hovering ? 0.06 : 0), in: Circle())
            .overlay { Circle().strokeBorder(palette.pillEdge, lineWidth: 0.5) }
            .onHover { hovering = $0 }
            .overlay { DrawerMenuButtonArea(drawer: drawer, label: L("메모 서랍 메뉴"), items: { DrawerMenus.drawer(drawer) }) }
    }
}

// MARK: - Art

@MainActor
enum MemoDrawerArt {
    static let sitting = PaperTheme.mascot
    static let sleep: NSImage = PetArt.image(.sleep).map { PaperTheme.downsampled($0, maxPixels: 256) } ?? PaperTheme.mascot
    static let texture = PaperTheme.texture
    static let emptyCat: NSImage = PetArt.image(.tea).map { PaperTheme.downsampled($0, maxPixels: 200) } ?? PaperTheme.mascot
}

/// The drawer's paper: its colour, its texture (kraft grain, grid squares; #111: no ruled lines), its edge and shadow.
/// 반투명 / 투명: the paper at 82 % / 62 % over the blur the panel puts behind it (snapshots draw a blurred desktop).
private struct PaperBack<S: Shape>: View {
    let palette: DrawerPalette
    let shape: S
    var opacity: Double = 1
    var desktop = false
    var strong = false

    var body: some View {
        shape.fill(palette.paper.opacity(opacity))
            .background { if desktop { DrawerDesktop().blur(radius: 18).clipShape(shape) } }
            .overlay {
                if palette.texture > 0 {
                    Image(nsImage: MemoDrawerArt.texture)
                        .resizable(resizingMode: .tile)
                        .blendMode(.multiply)
                        .opacity(palette.texture * opacity)
                        .clipShape(shape)
                }
            }
            .overlay {
                Canvas { context, size in
                    switch palette.background {
                    case .grid:
                        var path = Path()
                        var x: CGFloat = 0
                        while x < size.width { path.addRect(CGRect(x: x, y: 0, width: 1, height: size.height)); x += 14 }
                        var y: CGFloat = 0
                        while y < size.height { path.addRect(CGRect(x: 0, y: y, width: size.width, height: 1)); y += 14 }
                        context.fill(path, with: .color(palette.rule))
                    case .plain:
                        break
                    }
                }
                .clipShape(shape)
                .allowsHitTesting(false)
            }
            .overlay { shape.stroke(palette.edge, lineWidth: 0.6) }
            .shadow(color: .black.opacity((palette.scheme == .dark ? 0.45 : 0.16) * (opacity < 1 ? 0.6 : 1)), radius: 10, x: 0, y: 2)
            .accessibilityHidden(true)
    }
}

/// Drag the drawer's inner edge: 260–480 pt (its middle is the close bar, which drags the same way).
private struct WidthGrip: View {
    @ObservedObject var drawer: MemoDrawer
    @State private var hovering = false
    @State private var start: CGFloat?

    var body: some View {
        Color.clear
            .frame(width: 6)
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
            .onHover { inside in
                hovering = inside
                if inside { NSCursor.resizeLeftRight.push() } else { NSCursor.pop() }
            }
            .gesture(DragGesture(minimumDistance: 1, coordinateSpace: .global)
                .onChanged { _ in
                    // The screen's mouse, not the view's: the window moves under the pointer as it widens.
                    let mouse = NSEvent.mouseLocation.x
                    if start == nil { start = mouse }
                    drawer.onWidth(mouse)
                }
                .onEnded { _ in start = nil })
            .accessibilityHidden(true)
    }
}

/// 서랍 닫기 (#83, like SideNotes; #164): a tab out of the paper's inner edge, on the desktop's side, as the handle comes
/// out of the screen's edge when the drawer is shut — the handle's cream, edge and shadow, rounded on the outer side,
/// with the way it closes (› on a right drawer, ‹ on a left one). In the middle of the edge (under the bookmarks when
/// they reach that far, `MemoDrawerView.tabs`); it follows the edge as the drawer widens (#113). Under the pointer or the
/// keyboard it comes out 4 pt more; with the keyboard its edge is drawn in the paw's ink too. A click closes the drawer;
/// a press that moves more than `slop` is the edge being dragged, so the width follows as on the rest of the edge
/// (`WidthGrip`). Tab reaches it; Space or ↩ presses it. The paper itself carries no line any more.
struct CloseTab: View {
    @ObservedObject var drawer: MemoDrawer
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pointerOn = false
    @State private var start: CGPoint?
    @State private var dragged = false
    @FocusState private var focused: Bool

    private var lit: Bool { pointerOn || focused || drawer.previewEdgeHover }
    /// The tab at rest and how much more it comes out, its room, and how far a press may move and still close.
    static let tab = CGSize(width: 18, height: 46)
    static let peek: CGFloat = 4
    static let room = CGSize(width: 24, height: 50)
    static let slop: CGFloat = 3

    var body: some View {
        let right = drawer.side == .right
        let shape = right ? UnevenRoundedRectangle(topLeadingRadius: 10, bottomLeadingRadius: 10, style: .continuous)
            : UnevenRoundedRectangle(bottomTrailingRadius: 10, topTrailingRadius: 10, style: .continuous)
        HStack(spacing: 0) {
            if right { Spacer(minLength: 0) }
            ZStack {
                shape.fill(DrawerHandleView.fill)
                shape.strokeBorder(focused ? DrawerHandleView.paw : DrawerHandleView.edge, lineWidth: focused ? 1.5 : 1)
                    // No edge on the paper's side: the tab comes out from under the paper.
                    .mask(Rectangle().padding(right ? .trailing : .leading, 1))
                Image(systemName: right ? "chevron.right" : "chevron.left")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(DrawerHandleView.paw)
                    .offset(x: right ? 1 : -1)
            }
            .frame(width: Self.tab.width + (lit ? Self.peek : 0), height: Self.tab.height)
            .shadow(color: .black.opacity(0.18), radius: 3, x: right ? -1 : 1, y: 1)
            if !right { Spacer(minLength: 0) }
        }
            .frame(width: Self.room.width, height: Self.room.height)
            .contentShape(Rectangle())
            .onHover { inside in
                withAnimation(Motion.animation(.quick, reduce: reduceMotion)) { pointerOn = inside }
            }
            .gesture(DragGesture(minimumDistance: 0, coordinateSpace: .global)
                .onChanged { _ in
                    // The screen's mouse, not the view's: the window moves under the pointer as it widens.
                    let mouse = NSEvent.mouseLocation
                    if start == nil { start = mouse }
                    if let start, !dragged, hypot(mouse.x - start.x, mouse.y - start.y) > Self.slop { dragged = true }
                    if dragged { drawer.onWidth(mouse.x) }
                }
                .onEnded { _ in
                    if !dragged { drawer.onClose() }
                    dragged = false
                    start = nil
                })
            // Reached with Tab only (a click or the drawer opening doesn't focus it), and no system blue ring: the tab
            // coming out, its edge in the paw's ink, is its focus mark.
            .focusable(true, interactions: .activate)
            .focusEffectDisabled()
            .focused($focused)
            .onKeyPress(.space) {
                drawer.onClose()
                return .handled
            }
            .onChange(of: focused) { _, on in drawer.closeBarFocused = on }
            .onDisappear { drawer.closeBarFocused = false }
            .help(L("서랍 닫기"))
            .accessibilityElement()
            .accessibilityLabel(L("서랍 닫기"))
            .accessibilityAddTraits(.isButton)
            .accessibilityAction { drawer.onClose() }
    }
}

// MARK: - Bookmarks

/// A folder's bookmark: its colour (solid on every paper since 1.45) with a 1 pt edge in the folder's edge colour; an
/// un-picked one shows the name's first letter, the picked one is wider, joined to the paper, the name written down it.
/// Hover: `장보기 · 세 장 · ⌘3`. Right-click: the folder's menu. Drop a memo on it to move it there; drag bookmarks to
/// reorder them.
private struct FolderTab: View {
    @ObservedObject var drawer: MemoDrawer
    let folder: MemoFolders.Folder
    let number: Int
    /// What it shows un-picked (#116): its first letter, or two where another starts the same.
    let letters: String
    let palette: DrawerPalette
    let font: NotebookFont
    let right: Bool
    @State private var targeted = false

    private var picked: Bool { drawer.tab == .folder(folder.id) }

    var body: some View {
        let colors = palette.tab(folder.colorKey)
        let name = folder.displayName(.current)
        let shape = right ? UnevenRoundedRectangle(topLeadingRadius: 9, bottomLeadingRadius: 9, style: .continuous)
            : UnevenRoundedRectangle(bottomTrailingRadius: 9, topTrailingRadius: 9, style: .continuous)
        let back = picked ? palette.pickedTab?.back : nil
        let count = drawer.folderCount(folder.id)
        let hint = MemoFolders.bookmarkLabel(name, count: count, key: number <= 9 ? "⌘\(number)" : nil, language: .current)
        Button { drawer.show(.folder(folder.id)) } label: {
            ZStack {
                shape.fill(back ?? colors.a)
                if picked {
                    VerticalName(name: name, font: font, color: palette.pickedTab?.ink ?? colors.ink)
                        .padding(.vertical, 8)
                } else if letters.count > 1, VerticalName.stacked(letters) {
                    // Two Hangul letters stacked, as the picked name is (#116).
                    VStack(spacing: -1) {
                        ForEach(Array(letters.enumerated()), id: \.offset) { _, letter in
                            Text(String(letter).handwritten).font(font.handFont(13)).foregroundStyle(colors.ink)
                        }
                    }
                    .offset(x: right ? 1 : -1)
                } else if !letters.isEmpty {
                    Text(letters.handwritten)
                        .font(font.handFont(letters.count > 1 ? 13 : 15))
                        .foregroundStyle(colors.ink)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                        .offset(x: right ? 1 : -1)
                }
            }
            .frame(width: picked ? 30 : 22, height: picked ? VerticalName.height(name, font: font) : 40)
            .overlay {
                shape.strokeBorder(picked ? (palette.pickedTab?.edge ?? colors.edge) : colors.edge, lineWidth: picked ? 0.5 : 1)
                    .mask(Rectangle().padding(right ? .trailing : .leading, picked ? 1 : 0))
            }
            .overlay {
                if targeted { shape.strokeBorder(palette.check, lineWidth: 1.5) }
            }
            .offset(x: targeted ? (right ? -4 : 4) : 0)
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        // The picked one reaches over the paper's edge, so the two read as one sheet.
        .padding(right ? .trailing : .leading, picked ? 0 : MemoDrawerView.tabOverlap)
        .help(hint)
        .accessibilityLabel(name)
        .accessibilityValue(MemoFolders.sheetCount(count, language: .current))
        .accessibilityAddTraits(picked ? .isSelected : [])
        .overlay { DrawerContextArea(drawer: drawer) { DrawerMenus.folder(drawer, folder.id) } }
        .draggable("folder:" + folder.id)
        .dropDestination(for: String.self) { items, _ in
            guard let item = items.first else { return false }
            if item.hasPrefix("memo:") {
                drawer.move(String(item.dropFirst(5)), to: folder.id)
                return true
            }
            if item.hasPrefix("folder:") {
                let moving = String(item.dropFirst(7))
                guard moving != folder.id else { return false }
                var ids = drawer.folders.visible.map(\.id).filter { $0 != moving }
                ids.insert(moving, at: ids.firstIndex(of: folder.id) ?? ids.count)
                drawer.model.reorderMemoFolders(ids)
                return true
            }
            return false
        } isTargeted: { targeted = $0 }
    }
}

/// 고정: the paw bookmark at the bottom (pinned memos from every folder).
private struct PinTab: View {
    @ObservedObject var drawer: MemoDrawer
    let palette: DrawerPalette
    let right: Bool
    @State private var targeted = false

    private var picked: Bool { drawer.tab == .pinned }

    var body: some View {
        let shape = right ? UnevenRoundedRectangle(topLeadingRadius: 9, bottomLeadingRadius: 9, style: .continuous)
            : UnevenRoundedRectangle(bottomTrailingRadius: 9, topTrailingRadius: 9, style: .continuous)
        Button { drawer.show(.pinned) } label: {
            ZStack {
                shape.fill(palette.pinTab)
                Image(systemName: "pin.fill")
                    .font(.system(size: picked ? 12 : 10))
                    .foregroundStyle(palette.pinTabInk)
            }
            .frame(width: picked ? 30 : 22, height: picked ? 46 : 40)
            .overlay { shape.strokeBorder(palette.pinTabEdge, lineWidth: picked ? 0.5 : 1) }
            .overlay { if targeted { shape.strokeBorder(palette.check, lineWidth: 1.5) } }
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .padding(right ? .trailing : .leading, picked ? 0 : MemoDrawerView.tabOverlap)
        .help(MemoFolders.bookmarkLabel(L("고정"), count: drawer.folders.pinnedMemos(drawer.memos).count, key: "⌘0", language: .current))
        .accessibilityLabel(L("고정"))
        // #119: its count, as the folders' bookmarks say theirs.
        .accessibilityValue(MemoFolders.sheetCount(drawer.folders.pinnedMemos(drawer.memos).count, language: .current))
        .accessibilityAddTraits(picked ? .isSelected : [])
        .overlay { DrawerContextArea(drawer: drawer) { DrawerMenus.pinned(drawer) } }
        .dropDestination(for: String.self) { items, _ in
            guard let item = items.first, item.hasPrefix("memo:") else { return false }
            let id = String(item.dropFirst(5))
            if !drawer.folders.isPinned(id) { drawer.togglePin(id) }
            return true
        } isTargeted: { targeted = $0 }
    }
}

/// 새 폴더 (#82): an empty bookmark under 고정 — the un-picked bookmarks' shape, a little shorter (22 × 30), in the
/// sheet's paper with a dashed edge in the open checkbox's colour and a 12.5 pt + in the secondary ink (3:1 or more on
/// every paper); under the pointer a touch darker, the + in ink. A click opens the new-folder slip.
private struct AddTab: View {
    @ObservedObject var drawer: MemoDrawer
    let palette: DrawerPalette
    let right: Bool
    @State private var pointerOn = false

    private var lit: Bool { pointerOn || drawer.previewEdgeHover }
    static let size = CGSize(width: 22, height: 30)

    var body: some View {
        let shape = right ? UnevenRoundedRectangle(topLeadingRadius: 9, bottomLeadingRadius: 9, style: .continuous)
            : UnevenRoundedRectangle(bottomTrailingRadius: 9, topTrailingRadius: 9, style: .continuous)
        Button { drawer.newFolder() } label: {
            ZStack {
                shape.fill(palette.sheet)
                shape.fill(palette.ink.opacity(lit ? 0.06 : 0))
                Image(systemName: "plus")
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(lit ? palette.ink : palette.secondary)
                    .offset(x: right ? 1 : -1)
            }
            .frame(width: Self.size.width, height: Self.size.height)
            .overlay {
                // No edge on the paper's side, so it reads as a tab coming out from under the paper.
                shape.strokeBorder(lit ? palette.icon : palette.box, style: StrokeStyle(lineWidth: 1, dash: [3, 2]))
                    .mask(Rectangle().padding(right ? .trailing : .leading, 1))
            }
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .onHover { pointerOn = $0 }
        .padding(right ? .trailing : .leading, MemoDrawerView.tabOverlap)
        .help(L("새 폴더"))
        .accessibilityLabel(L("새 폴더"))
    }
}

/// The picked bookmark's name, down the tab: Korean letters stacked, Latin words turned. #55 D-2: the whole name
/// (the others show their colour and first letter); only a name longer than the tab can be (150 pt) is cut with "…",
/// as on Windows — a Latin one by its width, not after six letters ("Boodschappen" whole, not "Boods…").
private struct VerticalName: View {
    let name: String
    let font: NotebookFont
    let color: Color

    /// Stacked letters: six fit in 150 pt.
    static let limit = 6
    /// A turned name's longest run, so the tab stays within 150 pt.
    static let longest: CGFloat = 126

    static func stacked(_ name: String) -> Bool {
        name.unicodeScalars.contains { (0xAC00...0xD7A3).contains($0.value) || (0x3131...0x318E).contains($0.value) }
    }

    @MainActor static func shown(_ name: String, font: NotebookFont) -> String {
        if stacked(name) { return name.count > limit ? String(name.prefix(limit - 1)) + "…" : name }
        let face = font.handNSFont(17)
        func width(_ text: String) -> CGFloat { (text as NSString).size(withAttributes: [.font: face]).width }
        guard width(name) > longest else { return name }
        var cut = name
        while cut.count > 1, width(cut + "…") > longest { cut.removeLast() }
        return cut.trimmingCharacters(in: .whitespaces) + "…"
    }

    @MainActor static func height(_ name: String, font: NotebookFont) -> CGFloat {
        let text = shown(name, font: font)
        if stacked(name) { return max(62, CGFloat(text.count) * 19 + 20) }
        let width = (text as NSString).size(withAttributes: [.font: font.handNSFont(17)]).width
        return max(62, min(150, ceil(width) + 24))
    }

    var body: some View {
        let text = Self.shown(name, font: font)
        if Self.stacked(name) {
            VStack(spacing: 0) {
                ForEach(Array(text.enumerated()), id: \.offset) { _, letter in
                    Text(String(letter)).frame(height: 19)
                }
            }
            .font(font.handFont(18))
            .foregroundStyle(color)
        } else {
            Text(text.handwritten)
                .font(font.handFont(17))
                .foregroundStyle(color)
                .fixedSize()
                .rotationEffect(.degrees(90))
                .frame(width: 30)
        }
    }
}

/// The quick-write slip: lined paper with a tape, `여기에 바로 적어요`; ↩ makes a memo in this folder (in 고정: in
/// 메모, pinned), ⇧↩ a new line. #117: once something is written, a line under it says where it goes and the keys.
private struct QuickSlip: View {
    @ObservedObject var drawer: MemoDrawer
    let palette: DrawerPalette
    let font: NotebookFont
    let tape: Color
    var floating = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ZStack(alignment: .topLeading) {
                DrawerTextView(text: $drawer.quickText, palette: palette, bodyFont: font.handNSFont(MemoDrawerView.hand(19)), submitsOnReturn: true,
                               onSubmit: { drawer.quickWrite() }, onEscape: { drawer.onEscape() },
                               focus: drawer.focusQuick, minHeight: 24, accessibilityLabel: L("여기에 바로 적어요"))
                if drawer.quickText.isEmpty {
                    Text(L("여기에 바로 적어요").handwritten)
                        .font(font.handFont(MemoDrawerView.hand(19)))
                        .foregroundStyle(palette.placeholder)
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }
            }
            if !drawer.quickText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                hint
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 12)
        .padding(.bottom, 9)
        .background(palette.slip, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(palette.slipEdge, lineWidth: 1) }
        .shadow(color: floating ? .black.opacity(0.22) : palette.shadow, radius: floating ? 7 : 3, y: floating ? 4 : 1)
        .overlay(alignment: .top) {
            Rectangle().fill(tape.opacity(0.9))
                .frame(width: 52, height: 12)
                .rotationEffect(.degrees(-2))
                .offset(y: -6)
                .allowsHitTesting(false)
        }
        .help(L("↩ 새 메모 · ⇧↩ 줄 바꿈 · ⌘N"))
    }

    /// `회사에 넣어요 · ↩ 넣기 · ⇧↩ 줄 바꿈` under a thin line (the 빠른 메모 slip shows its folder and keys too).
    private var hint: some View {
        let target = drawer.folders.quickWriteTarget(drawer.tab)
        let name = target.pinned ? L("고정") : drawer.folders.folder(target.folder)?.displayName(.current) ?? ""
        let place = Text(L("\(name)에 넣어요"))
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(palette.secondary)
            .lineLimit(1)
            .fixedSize()
        let keys = Text(L("↩ 넣기 · ⇧↩ 줄 바꿈"))
            .font(.system(size: 11))
            .foregroundStyle(palette.faint)
            .lineLimit(1)
            .fixedSize()
        // A narrow drawer in a long language: the keys under where it goes, never cut.
        return ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { place; Spacer(minLength: 4); keys }
            VStack(alignment: .leading, spacing: 2) { place; keys }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 7)
        .overlay(alignment: .top) {
            Rectangle().fill(palette.slipEdge).frame(height: 0.5).padding(.top, 3)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The search field in the header (⌘F; Esc closes it).
private struct SearchField: View {
    @ObservedObject var drawer: MemoDrawer
    let palette: DrawerPalette
    @FocusState private var focused: Bool

    var body: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 12)).foregroundStyle(palette.icon).accessibilityHidden(true)
            TextField(drawer.searchHere ? L("\(drawer.hereName)에서 찾기") : L("모든 폴더에서 찾기"), text: $drawer.query)
                // #119: the field had no name for VoiceOver (only its placeholder).
                .accessibilityLabel(L("메모 찾기"))
                .textFieldStyle(.plain)
                .font(.system(size: 14))
                .foregroundStyle(palette.ink)
                .focused($focused)
                .onSubmit {
                    drawer.searchNow()
                    _ = drawer.selectedID.map { drawer.reveal($0) } ?? drawer.hits.first.map { drawer.reveal($0.memoID) }
                }
        }
        .padding(.horizontal, 9)
        .frame(height: 30)
        .background(palette.slip, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 7, style: .continuous).strokeBorder(focused ? palette.check : palette.slipEdge, lineWidth: focused ? 1 : 0.5) }
        .onAppear { if SlipMotion.enabled { focused = true } }
        .onChange(of: drawer.focusSearch) { focused = true }
    }
}

/// 새 폴더 · 이름 · 색 바꾸기: a slip over the drawer — the name, eight colours, and for a folder that isn't 메모, 지우기.
private struct FolderSheetView: View {
    @ObservedObject var drawer: MemoDrawer
    let palette: DrawerPalette
    let font: NotebookFont
    @FocusState private var focused: Bool

    var body: some View {
        let sheet = drawer.folderSheet ?? MemoDrawer.FolderSheet(id: nil, name: "", color: .lavender)
        let isNew = sheet.id == nil
        VStack(alignment: .leading, spacing: 12) {
            Text(isNew ? L("새 폴더") : L("폴더 이름 · 색"))
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(palette.label)
            TextField(L("폴더 이름"), text: Binding(get: { drawer.folderSheet?.name ?? "" }, set: { drawer.folderSheet?.name = $0 }))
                .textFieldStyle(.plain)
                .font(font.handFont(24))
                .foregroundStyle(palette.ink)
                .focused($focused)
                .onSubmit { drawer.saveFolderSheet() }
                .padding(.bottom, 4)
                .overlay(alignment: .bottom) { Rectangle().fill(focused ? palette.check : palette.slipEdge).frame(height: 1.2) }
            HStack(spacing: 6) {
                ForEach(MemoFolders.Color.allCases, id: \.self) { color in
                    let colors = palette.tab(color)
                    let picked = sheet.color == color
                    Button { drawer.folderSheet?.color = color } label: {
                        Circle().fill(colors.a)
                            .overlay { Circle().strokeBorder(colors.edge, lineWidth: 0.8) }
                            .frame(width: 20, height: 20)
                            .padding(3)
                            .overlay { if picked { Circle().strokeBorder(palette.ink, lineWidth: 1.5) } }
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .help(color.title)
                    .accessibilityLabel(color.title)
                    .accessibilityAddTraits(picked ? .isSelected : [])
                }
            }
            HStack(spacing: 8) {
                if let id = sheet.id, id != MemoFolders.inbox {
                    Button(L("지우기")) { drawer.deleteFolder(id) }
                        .buttonStyle(.plain)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(Color(drawerHex: palette.scheme == .dark ? "#e29a7c" : "#955842"))
                        .help(L("폴더만 지워요. 안의 메모는 ‘메모’ 폴더로 가요."))
                }
                Spacer()
                Button(L("취소")) { drawer.folderSheet = nil }
                    .buttonStyle(.plain)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(palette.secondary)
                    .padding(.horizontal, 6)
                Button(isNew ? L("만들기") : L("저장")) { drawer.saveFolderSheet() }
                    .buttonStyle(.plain)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(palette.checkOn)
                    .padding(.horizontal, 12)
                    .frame(height: 26)
                    .background(palette.check, in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                    .disabled(MemoFolders.cleanName(sheet.name).isEmpty)
                    .opacity(MemoFolders.cleanName(sheet.name).isEmpty ? 0.5 : 1)
            }
        }
        .padding(14)
        .background(palette.slip, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay { RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(palette.slipEdge, lineWidth: 0.5) }
        .shadow(color: .black.opacity(0.18), radius: 10, y: 3)
        .onAppear { if SlipMotion.enabled { focused = true } }
    }
}

/// The header's quiet icons.
struct DrawerIconButton: View {
    let symbol: String
    let palette: DrawerPalette
    let help: String
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 14))
                .foregroundStyle(palette.icon)
                .frame(width: 26, height: 26)
                .background(palette.ink.opacity(hovering ? 0.07 : 0), in: RoundedRectangle(cornerRadius: 6))
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .help(help)
        .accessibilityLabel(help)
    }
}

extension MemoFolders.Color {
    /// "라벤더" · "Lavender" · "Lavendel" …
    var title: String {
        switch self {
        case .lavender: L("라벤더")
        case .pink: L("분홍")
        case .mint: L("민트")
        case .yellow: L("노랑")
        case .sky: L("하늘")
        case .peach: L("살구")
        case .sand: L("모래")
        case .gray: L("회색")
        }
    }
}
