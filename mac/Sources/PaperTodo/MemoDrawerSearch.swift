import AppKit
import PaperCore
import SwiftUI

// 메모 찾기 (#114, docs/plans/drawer-ux-plan.md B1 · mock ④): two rows of chips under the field — where to look (모든 폴더 ·
// {지금 폴더}만) and what to keep to (안 한 체크 · 링크 · 고정) — and the results by folder, each group under its colour, name
// and count; every result the list's card (its tape, the handwritten title, the date) with the found line in the preview's
// place, the words looked for on a tint. The rules are PaperCore's (MemoFolders.find · snippet, MemoCards.foundTime).

/// The chips under the search field: 모든 폴더 · {이름}만 (one of the two), then 안 한 체크 · 링크 · 고정 (any of them).
struct SearchChips: View {
    @ObservedObject var drawer: MemoDrawer
    let palette: DrawerPalette

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            FlowRow(spacing: 5) {
                SearchChip(title: L("모든 폴더"), on: !drawer.searchHere, palette: palette) { drawer.setSearchHere(false) }
                SearchChip(title: L("\(drawer.hereName)만"), on: drawer.searchHere, palette: palette) { drawer.setSearchHere(true) }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(L("찾는 곳"))
            FlowRow(spacing: 5) {
                ForEach(Self.filters, id: \.1) { filter, title in
                    SearchChip(title: title, on: drawer.searchFilters.contains(filter), palette: palette, toggles: true) { drawer.toggleFilter(filter) }
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(L("거르기"))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    static var filters: [(MemoFolders.SearchFilters, String)] {
        [(.open, L("안 한 체크")), (.link, L("링크")), (.pinned, L("고정"))]
    }
}

/// One chip: a small capsule, the picked ones on the slip's paper with a green edge.
private struct SearchChip: View {
    let title: String
    let on: Bool
    let palette: DrawerPalette
    /// A filter (on · off) rather than one of two places.
    var toggles = false
    let action: () -> Void
    @State private var hovering = false

    var body: some View {
        Button(action: action) {
            Text(verbatim: title.keepingParticles)
                .font(.system(size: 11.5, weight: on ? .semibold : .regular))
                .foregroundStyle(on ? palette.ink : palette.secondary)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 9)
                .frame(height: 22)
                .background(on ? palette.slip : (hovering ? palette.pillEdge : palette.pill), in: Capsule())
                .overlay { Capsule().strokeBorder(on ? palette.check : palette.pillEdge, lineWidth: on ? 1.2 : 0.5) }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityLabel(title)
        .accessibilityValue(toggles ? (on ? L("켜짐") : L("꺼짐")) : "")
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The results: a group per folder (its colour, name and count, a hairline), its cards under it; what was looked for
/// when nothing is found (#39), the 초성 hint before anything is asked.
struct DrawerSearchResults: View {
    @ObservedObject var drawer: MemoDrawer
    let palette: DrawerPalette
    let font: NotebookFont
    let floating: Bool

    var body: some View {
        let groups = drawer.found
        let asked = !drawer.searchedQuery.trimmingCharacters(in: .whitespaces).isEmpty || !drawer.searchFilters.isEmpty
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(groups, id: \.folderID) { group in
                        SearchGroupHeader(folder: drawer.folders.folder(group.folderID), count: group.hits.count, palette: palette, floating: floating)
                        ForEach(group.hits, id: \.memoID) { hit in
                            SearchSlip(drawer: drawer, hit: hit, palette: palette, font: font)
                                .padding(.bottom, 14)
                                .id(hit.memoID)
                        }
                    }
                    if groups.isEmpty {
                        // One shape for every search that finds nothing (#39): the words looked for, then 없어요.
                        Text(asked ? Search.emptyText(lookedFor, suggest: !drawer.searchedQuery.trimmingCharacters(in: .whitespaces).isEmpty, language: .current).keepingParticles : L("초성으로도 찾을 수 있어요 (예: ㅂㄱㅅ → 보고서)"))
                            .font(.system(size: 12))
                            .foregroundStyle(palette.secondary)
                            .multilineTextAlignment(.center)
                            .fixedSize(horizontal: false, vertical: true)
                            .padding(.horizontal, 18)
                            .padding(.top, 24)
                            .frame(maxWidth: .infinity)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 8)
                .padding(.bottom, 14)
            }
            .scrollIndicators(.never)
            .onChange(of: drawer.selectedID) { _, id in
                guard let id else { return }
                proxy.scrollTo(id)
            }
        }
    }

    /// The words looked for, or (no words) the filters' names: `‘안 한 체크 · 링크’에 맞는 게 없어요`.
    private var lookedFor: String {
        let query = drawer.searchedQuery.trimmingCharacters(in: .whitespaces)
        if !query.isEmpty { return query }
        return SearchChips.filters.filter { drawer.searchFilters.contains($0.0) }.map(\.1).joined(separator: " · ")
    }
}

/// A folder's group in the results: its colour as a small square, its name and count, a hairline to the edge.
private struct SearchGroupHeader: View {
    let folder: MemoFolders.Folder?
    let count: Int
    let palette: DrawerPalette
    let floating: Bool

    var body: some View {
        let colors = palette.tab(folder?.colorKey ?? .lavender)
        HStack(spacing: 6) {
            HStack(spacing: 5) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(colors.a)
                    .overlay { RoundedRectangle(cornerRadius: 2, style: .continuous).strokeBorder(colors.edge, lineWidth: 1) }
                    .frame(width: 9, height: 9)
                Text(folder?.displayName(.current) ?? "").font(.system(size: 11, weight: .medium)).foregroundStyle(palette.groupHeader).lineLimit(1)
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
        .padding(.bottom, 10)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}
